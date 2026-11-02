#!/usr/bin/env bash
# B71 原生批次：runner 启动/监督真实窗口，外部 AX/CGEvent 驱动用户真实输入。
# B71 family eligibility 与 route（journey/seed/quality-revision retry env）只在本文件
# 集中定义；tauri_slice_verify.sh 通过 --family-check / --route 调用，避免多处复制名单。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

b71_family_check() {
  case "${1:-}" in
    b71-first-consumer | b71-authoring-transcript | b71-authoring-profiles | b71-authoring-planning | b71-authoring-revision | b71-authoring-pending)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

b71_route() {
  case "${1:-}" in
    b71-first-consumer)
      echo "journey=full-read slice=b71-first-consumer seed=scripts/seed_judgment_explore_chapter_full_read.exs quality_revision_retry=0"
      ;;
    b71-authoring-transcript)
      echo "journey=continuation slice=b71-authoring-transcript seed=scripts/seed_p1_chapter_draft_generation.exs quality_revision_retry=0"
      ;;
    b71-authoring-profiles)
      echo "journey=character-design slice=b71-authoring-profiles seed=scripts/seed_p1_chapter_draft_generation.exs quality_revision_retry=0"
      ;;
    b71-authoring-planning)
      echo "journey=planning slice=b71-authoring-planning seed=scripts/seed_p1_chapter_draft_generation.exs quality_revision_retry=0"
      ;;
    b71-authoring-revision)
      echo "journey=revision slice=b71-authoring-revision seed=scripts/seed_p1_prose_revision_candidate.exs quality_revision_retry=1"
      ;;
    b71-authoring-pending)
      echo "journey=pending slice=b71-authoring-pending seed=scripts/seed_b71_authoring_pending.exs quality_revision_retry=0"
      ;;
    *)
      return 1
      ;;
  esac
}

if [[ "${1:-}" == "--family-check" ]]; then
  b71_family_check "${2:-}"
  exit $?
fi
if [[ "${1:-}" == "--route" ]]; then
  b71_route "${2:-}"
  exit $?
fi

SLICE="${B71_SLICE:-b71-first-consumer}"
if ! b71_family_check "$SLICE"; then
  echo "unsupported B71_SLICE: $SLICE" >&2
  exit 64
fi
TAG="${1:-}"
if [[ -z "$TAG" || ! "$TAG" =~ ^[a-z0-9-]+$ || ${#TAG} -gt 32 ]]; then
  echo "usage: bash scripts/native_b71_batch.sh <lowercase-tag-at-most-32-chars>" >&2
  exit 64
fi

B71_PROVIDER="${B71_PROVIDER:-slice_verify}"
if [[ "$B71_PROVIDER" != "slice_verify" && "$B71_PROVIDER" != "strata" ]]; then
  echo "unsupported B71_PROVIDER: $B71_PROVIDER (slice_verify|strata)" >&2
  exit 64
fi
LIVE=0
if [[ "$B71_PROVIDER" == "strata" ]]; then
  LIVE=1
  if [[ "$SLICE" != "b71-first-consumer" ]]; then
    echo "live model batch 只接受 B71_SLICE=b71-first-consumer，实测: $SLICE" >&2
    exit 64
  fi
fi

STATE_DIR="$ROOT/artifacts/b71-native"
RUNNER_LOG="$STATE_DIR/batch-$TAG.runner.log"
DRIVER_LOG="$STATE_DIR/batch-$TAG.driver.log"
STRATA_BEFORE="$STATE_DIR/batch-$TAG.strata-before.json"
STRATA_AFTER="$STATE_DIR/batch-$TAG.strata-after.json"
mkdir -p "$STATE_DIR"

if [[ "$LIVE" == "1" ]]; then
  DIR="$ROOT/artifacts/slice-verify/${SLICE}-live-$TAG"
else
  DIR="$ROOT/artifacts/slice-verify/${SLICE}-tauri-native-$TAG"
fi
if [[ -e "$DIR" ]]; then
  echo "prior batch is immutable: $DIR" >&2
  exit 64
fi

export TAURI_NATIVE_SYSTEM_DRIVER=1
export TAURI_NATIVE_TRANSPORT_PROXY=1
export TAURI_NATIVE_ARTIFACT_TAG="$TAG"
if [[ "$LIVE" == "1" ]]; then
  # 实模批次：真实 provider=strata（单槽 iq3_s），证据目录用预注册 live 前缀。
  export SLICE_VERIFY_PROVIDER=strata
  export TAURI_NATIVE_ARTIFACT_DIR="$DIR"
  node "$ROOT/scripts/native_b71_strata_state.mjs" >"$STRATA_BEFORE" 2>/dev/null || true
  if ! node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j.state?.models_ok===true?0:1)' "$STRATA_BEFORE"; then
    echo "Strata 单槽不可达（GET /v1/models 失败）: $STRATA_BEFORE" >&2
    exit 1
  fi
fi
bash "$ROOT/scripts/tauri_slice_verify.sh" "$SLICE" >"$RUNNER_LOG" 2>&1 &
RUNNER=$!

READY=0
for _ in $(seq 1 180); do
  if [[ -f "$DIR/native-driver-ready.json" ]]; then READY=1; break; fi
  if ! kill -0 "$RUNNER" 2>/dev/null; then
    echo "runner exited before native driver ready: $RUNNER_LOG" >&2
    exit 1
  fi
  sleep 2
done
if [[ "$READY" != "1" ]]; then
  echo "native driver ready timeout: $RUNNER_LOG" >&2
  exit 1
fi

set +e
if [[ "$LIVE" == "1" ]]; then
  node "$ROOT/scripts/native_b71_live_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
else
  node "$ROOT/scripts/native_b71_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
fi
DRIVER_RC=$?
wait "$RUNNER"
RUNNER_RC=$?
set -e

if [[ "$LIVE" == "1" ]]; then
  # 批次结束/失败/中断都必须卸载并核验 loaded=null；driver 已卸载，batch 再独立核验。
  node "$ROOT/scripts/native_b71_strata_state.mjs" --unload >"$STRATA_AFTER" 2>/dev/null || true
  if ! node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j.slot?.ok===true&&j.slot?.loaded===false?0:1)' "$STRATA_AFTER"; then
    echo "[b71-native] FAIL strata not unloaded: $STRATA_AFTER" >&2
    echo "[b71-native] FAIL driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC dir=$DIR" >&2
    exit 1
  fi
fi

if [[ "$DRIVER_RC" -eq 0 && "$RUNNER_RC" -eq 0 ]]; then
  echo "[b71-native] PASS dir=$DIR"
  exit 0
fi

echo "[b71-native] FAIL driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC dir=$DIR" >&2
echo "runner log: $RUNNER_LOG; driver log: $DRIVER_LOG" >&2
exit 1
