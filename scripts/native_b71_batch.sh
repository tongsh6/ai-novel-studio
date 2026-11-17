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

if [[ "${B71_AUTO_MAINTENANCE:-0}" == "1" ]]; then
  B71_PROVIDER="${B71_PROVIDER:-splash}"
else
  B71_PROVIDER="${B71_PROVIDER:-slice_verify}"
fi
if [[ "$B71_PROVIDER" != "slice_verify" && "$B71_PROVIDER" != "streaming_slice_verify" && "$B71_PROVIDER" != "strata" && "$B71_PROVIDER" != "splash" ]]; then
  echo "unsupported B71_PROVIDER: $B71_PROVIDER (slice_verify|streaming_slice_verify|strata|splash)" >&2
  exit 64
fi
# B71 §16.14 工具确认/拒绝原生场景（确定性 slice_verify provider，真实高风险来源）。
CONFIRMATION_ACTION="${B71_CONFIRMATION_ACTION:-}"
CONFIRMATION=0
if [[ -n "$CONFIRMATION_ACTION" ]]; then
  CONFIRMATION=1
  case "$CONFIRMATION_ACTION" in
    confirm | reject) ;;
    *)
      echo "B71_CONFIRMATION_ACTION 只能是 confirm 或 reject，实测: $CONFIRMATION_ACTION" >&2
      exit 64
      ;;
  esac
  if [[ "$B71_PROVIDER" != "slice_verify" ]]; then
    echo "confirmation batch 只接受 B71_PROVIDER=slice_verify（确定性确认链），实测: $B71_PROVIDER" >&2
    exit 64
  fi
  if [[ "$SLICE" != "b71-first-consumer" ]]; then
    echo "confirmation batch 只接受 B71_SLICE=b71-first-consumer，实测: $SLICE" >&2
    exit 64
  fi
fi

# B70 作者行为覆盖：B71_BEHAVIOR_CASE 给出时进入 behavior journey（输入取冻结 case 原文）。
BEHAVIOR_CASE="${B71_BEHAVIOR_CASE:-}"
BEHAVIOR=0
if [[ -n "$BEHAVIOR_CASE" ]]; then
  BEHAVIOR=1
  if [[ "$CONFIRMATION" == "1" ]]; then
    echo "B71_BEHAVIOR_CASE 与 B71_CONFIRMATION_ACTION 不能同时设置" >&2
    exit 64
  fi
  if [[ "$B71_PROVIDER" != "strata" ]]; then
    echo "behavior batch 只接受 B71_PROVIDER=strata，实测: $B71_PROVIDER" >&2
    exit 64
  fi
  if [[ "$SLICE" != "b71-first-consumer" ]]; then
    echo "behavior batch 只接受 B71_SLICE=b71-first-consumer，实测: $SLICE" >&2
    exit 64
  fi
fi

if [[ "$B71_PROVIDER" == "streaming_slice_verify" ]]; then
  # B71 R2 预览页面证据：确定性替身经真实 SSE 发送写作正文；分片延迟让页面
  # 在生成过程中可观测到预览（默认 30ms/6 graphemes 一片）。
  export SLICE_VERIFY_PROVIDER=streaming_slice_verify
  export SLICE_VERIFY_STREAM_DELAY_MS="${SLICE_VERIFY_STREAM_DELAY_MS:-80}"
fi

LIVE=0
if [[ "$B71_PROVIDER" == "strata" || ( "$B71_PROVIDER" == "splash" && "${B71_AUTO_MAINTENANCE:-0}" != "1" ) ]]; then
  LIVE=1
  if [[ "$SLICE" != "b71-first-consumer" ]]; then
    echo "live model batch 只接受 B71_SLICE=b71-first-consumer，实测: $SLICE" >&2
    exit 64
  fi
fi

# 现役 R03 原生交错/取消/恢复：Splash 产品维护预算，参数只来自既有 runtime recipe。
AUTO_MAINTENANCE="${B71_AUTO_MAINTENANCE:-}"
if [[ -n "$AUTO_MAINTENANCE" ]]; then
  if [[ "$AUTO_MAINTENANCE" != "1" ]]; then
    echo "B71_AUTO_MAINTENANCE 只能是 1，实测: $AUTO_MAINTENANCE" >&2
    exit 64
  fi
  if [[ "$B71_PROVIDER" != "splash" ]]; then
    echo "auto-maintenance batch 只接受 B71_PROVIDER=splash，实测: $B71_PROVIDER" >&2
    exit 64
  fi
  if [[ "$SLICE" != "b71-first-consumer" ]]; then
    echo "auto-maintenance batch 只接受 B71_SLICE=b71-first-consumer，实测: $SLICE" >&2
    exit 64
  fi
  if [[ "$CONFIRMATION" == "1" || "$BEHAVIOR" == "1" ]]; then
    echo "B71_AUTO_MAINTENANCE 与 confirmation/behavior 不能同时设置" >&2
    exit 64
  fi
fi
if [[ "$B71_PROVIDER" == "splash" && "$LIVE" == "1" && -z "${B71_LIVE_PREREGISTRATION:-}" ]]; then
  echo "Splash live 必须提供冻结的 B71_LIVE_PREREGISTRATION（b82-g2/runtime profile）" >&2
  exit 64
fi
if [[ "$AUTO_MAINTENANCE" == "1" ]]; then
  for retired in B71_AUTO_MAINT_SMOKE B71_AUTO_MAINT_MULTI_TURN B71_AUTO_MAINT_INTERLEAVED_RESUME B71_AUTO_MAINT_MAX_STEERS; do
    if [[ -n "${!retired:-}" ]]; then
      echo "$retired 已退役；R03 使用冻结交错/取消/恢复顺序" >&2
      exit 64
    fi
  done
fi

# 回答模式 gate（等待即回答，确定性 slice_verify + ask_author fixture）。
# 变量在使用前定义：ANSWER_MODE 的互斥检查引用 MEMORY_DETAIL（set -u 下未定义会 unbound）。
ANSWER_MODE="${B71_ANSWER_MODE:-}"
MEMORY_DETAIL="${B71_MEMORY_DETAIL:-}"
if [[ -n "$ANSWER_MODE" ]]; then
  if [[ "$ANSWER_MODE" != "1" ]]; then
    echo "B71_ANSWER_MODE 只能是 1，实测: $ANSWER_MODE" >&2
    exit 64
  fi
  if [[ "$B71_PROVIDER" != "slice_verify" ]]; then
    echo "answer-mode batch 只接受 B71_PROVIDER=slice_verify，实测: $B71_PROVIDER" >&2
    exit 64
  fi
  if [[ "$SLICE" != "b71-first-consumer" ]]; then
    echo "answer-mode batch 只接受 B71_SLICE=b71-first-consumer，实测: $SLICE" >&2
    exit 64
  fi
  if [[ "$CONFIRMATION" == "1" || "$BEHAVIOR" == "1" || "$AUTO_MAINTENANCE" == "1" || "$MEMORY_DETAIL" == "1" ]]; then
    echo "B71_ANSWER_MODE 与其它 journey 不能同时设置" >&2
    exit 64
  fi
fi

# 记忆详情/列表 P0 泄漏回归（确定性 slice_verify；需真实记忆数据 seed）。
if [[ -n "$MEMORY_DETAIL" ]]; then
  if [[ "$MEMORY_DETAIL" != "1" ]]; then
    echo "B71_MEMORY_DETAIL 只能是 1，实测: $MEMORY_DETAIL" >&2
    exit 64
  fi
  if [[ "$B71_PROVIDER" != "slice_verify" ]]; then
    echo "memory-detail batch 只接受 B71_PROVIDER=slice_verify，实测: $B71_PROVIDER" >&2
    exit 64
  fi
  if [[ "$SLICE" != "b71-first-consumer" ]]; then
    echo "memory-detail batch 只接受 B71_SLICE=b71-first-consumer，实测: $SLICE" >&2
    exit 64
  fi
  if [[ "$CONFIRMATION" == "1" || "$BEHAVIOR" == "1" || "$AUTO_MAINTENANCE" == "1" ]]; then
    echo "B71_MEMORY_DETAIL 与 confirmation/behavior/auto-maintenance 不能同时设置" >&2
    exit 64
  fi
fi

STATE_DIR="$ROOT/artifacts/b71-native"
RUNNER_LOG="$STATE_DIR/batch-$TAG.runner.log"
DRIVER_LOG="$STATE_DIR/batch-$TAG.driver.log"
STRATA_BEFORE="$STATE_DIR/batch-$TAG.strata-before.json"
STRATA_AFTER="$STATE_DIR/batch-$TAG.strata-after.json"
mkdir -p "$STATE_DIR"

if [[ "$ANSWER_MODE" == "1" ]]; then
  # 回答模式 gate 批次目录与预注册一致；仍必须位于 artifacts/ 且不存在。
  DIR="${B71_ANSWER_MODE_ARTIFACT_DIR:-$ROOT/artifacts/slice-verify/b71-answer-mode-ax-$TAG}"
  if [[ "$DIR" != "$ROOT/artifacts/"* ]]; then
    echo "B71_ANSWER_MODE_ARTIFACT_DIR 必须位于 $ROOT/artifacts/ 下: $DIR" >&2
    exit 64
  fi
elif [[ "$MEMORY_DETAIL" == "1" ]]; then
  # 记忆详情回归批次目录与预注册一致；仍必须位于 artifacts/ 且不存在。
  DIR="${B71_MEMORY_DETAIL_ARTIFACT_DIR:-$ROOT/artifacts/slice-verify/b71-memory-detail-ax-$TAG}"
  if [[ "$DIR" != "$ROOT/artifacts/"* ]]; then
    echo "B71_MEMORY_DETAIL_ARTIFACT_DIR 必须位于 $ROOT/artifacts/ 下: $DIR" >&2
    exit 64
  fi
elif [[ "$AUTO_MAINTENANCE" == "1" ]]; then
  # A3 自动维护批次目录与预注册一致；仍必须位于 artifacts/ 且不存在。
  DIR="${B71_AUTO_MAINTENANCE_ARTIFACT_DIR:-$ROOT/artifacts/slice-verify/b71-first-consumer-auto-maint-$TAG}"
  if [[ "$DIR" != "$ROOT/artifacts/"* ]]; then
    echo "B71_AUTO_MAINTENANCE_ARTIFACT_DIR 必须位于 $ROOT/artifacts/ 下: $DIR" >&2
    exit 64
  fi
elif [[ "$CONFIRMATION" == "1" ]]; then
  # §16.14 确认/拒绝批次目录与预注册一致；仍必须位于 artifacts/ 且不存在。
  DIR="${B71_CONFIRMATION_ARTIFACT_DIR:-$ROOT/artifacts/slice-verify/b71-authoring-confirmation-tauri-native-$TAG}"
  if [[ "$DIR" != "$ROOT/artifacts/"* ]]; then
    echo "B71_CONFIRMATION_ARTIFACT_DIR 必须位于 $ROOT/artifacts/ 下: $DIR" >&2
    exit 64
  fi
elif [[ "$BEHAVIOR" == "1" ]]; then
  # 行为覆盖批次目录与预注册一致；仍必须位于 artifacts/ 且不存在。
  DIR="${B71_BEHAVIOR_ARTIFACT_DIR:-$ROOT/artifacts/slice-verify/${SLICE}-behavior-$TAG}"
  if [[ "$DIR" != "$ROOT/artifacts/"* ]]; then
    echo "B71_BEHAVIOR_ARTIFACT_DIR 必须位于 $ROOT/artifacts/ 下: $DIR" >&2
    exit 64
  fi
elif [[ "$LIVE" == "1" ]]; then
  # CP3b 预注册可指定精确 live 证据目录（仍必须位于 artifacts/ 且不存在）。
  DIR="${B71_LIVE_ARTIFACT_DIR:-$ROOT/artifacts/slice-verify/${SLICE}-live-$TAG}"
  if [[ "$DIR" != "$ROOT/artifacts/"* ]]; then
    echo "B71_LIVE_ARTIFACT_DIR 必须位于 $ROOT/artifacts/ 下: $DIR" >&2
    exit 64
  fi
else
  DIR="$ROOT/artifacts/slice-verify/${SLICE}-tauri-native-$TAG"
fi
if [[ -e "$DIR" ]]; then
  echo "prior batch is immutable: $DIR" >&2
  exit 64
fi

# B82 冻结输入：仅普通 live 批次可用；启动前只读一次源到 STATE_DIR 快照，
# 此后封存只链接同一快照，绝不再读源。判据只在 validatePreregistrationFile 中定义。
preregistration_check() {
  local scenario_args=()
  if [[ "$B71_PROVIDER" == "splash" ]]; then scenario_args=(b82-g2); fi
  node "$ROOT/scripts/lib/native_ui/authoring_capture_evidence.mjs" \
    validate-preregistration "$1" "$DIR" "$B71_PROVIDER" "${scenario_args[@]}"
}

PREREG_SNAPSHOT=""
cleanup_prereg_snapshot() {
  if [[ -n "$PREREG_SNAPSHOT" ]]; then
    rm -f "$PREREG_SNAPSHOT"
    PREREG_SNAPSHOT=""
  fi
}
trap cleanup_prereg_snapshot EXIT

seal_live_preregistration() {
  # 只对启动前快照做 ln；Tauri 要求批次目录启动时不存在，故只能此刻写入。
  [[ -n "$PREREG_SNAPSHOT" && -f "$PREREG_SNAPSHOT" ]] || return 1
  preregistration_check "$PREREG_SNAPSHOT" >/dev/null &&
    ln "$PREREG_SNAPSHOT" "$DIR/preregistration.json" &&
    preregistration_check "$DIR/preregistration.json"
}

# 冻结模式沿用既有 strataSlotCheck 判据：mode=real、单一模型（slot.ok）。
strata_precheck_ok() {
  if [[ -n "$LIVE_PREREGISTRATION" ]]; then
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j.slot?.ok===true&&j.state?.mode==="real"&&Array.isArray(j.state?.model_ids)&&j.state.model_ids.length===1?0:1)' "$1"
  else
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j.state?.models_ok===true?0:1)' "$1"
  fi
}

LIVE_PREREGISTRATION="${B71_LIVE_PREREGISTRATION:-}"
if [[ -n "$LIVE_PREREGISTRATION" ]]; then
  if [[ "$LIVE" != "1" || "$SLICE" != "b71-first-consumer" ]]; then
    echo "B71_LIVE_PREREGISTRATION 只用于 B71_SLICE=b71-first-consumer 的真实 live 批次" >&2
    exit 64
  fi
  if [[ "$BEHAVIOR" == "1" || "$AUTO_MAINTENANCE" == "1" || "$CONFIRMATION" == "1" || "$ANSWER_MODE" == "1" || "$MEMORY_DETAIL" == "1" ]]; then
    echo "B71_LIVE_PREREGISTRATION 不能与 behavior/auto-maintenance/confirmation/answer-mode/memory-detail 混用" >&2
    exit 64
  fi
  if [[ ! -f "$LIVE_PREREGISTRATION" ]]; then
    echo "B71_LIVE_PREREGISTRATION 文件不存在: $LIVE_PREREGISTRATION" >&2
    exit 64
  fi
  # 批次目录尚未创建：只读这一次源，校验失败不消耗目录。
  PREREG_SNAPSHOT="$(mktemp "$STATE_DIR/prereg-$TAG.XXXXXX")" || exit 1
  cat "$LIVE_PREREGISTRATION" >"$PREREG_SNAPSHOT" || exit 1
  preregistration_check "$PREREG_SNAPSHOT" >/dev/null || exit 1
fi

export TAURI_NATIVE_SYSTEM_DRIVER=1
export TAURI_NATIVE_TRANSPORT_PROXY=1
export TAURI_NATIVE_ARTIFACT_TAG="$TAG"
if [[ "$LIVE" == "1" ]]; then
  # 真实 provider 与冻结输入一致。Splash 仅消费外部服务，预检归现役 tauri runner。
  export SLICE_VERIFY_PROVIDER="$B71_PROVIDER"
  export TAURI_NATIVE_ARTIFACT_DIR="$DIR"
fi
if [[ "$LIVE" == "1" && "$B71_PROVIDER" == "strata" ]]; then
  node "$ROOT/scripts/native_b71_strata_state.mjs" >"$STRATA_BEFORE" 2>/dev/null || true
  if ! strata_precheck_ok "$STRATA_BEFORE"; then
    if [[ -n "$LIVE_PREREGISTRATION" ]]; then
      echo "Strata 单槽预检失败（要求 mode=real、单一模型、slot.ok）: $STRATA_BEFORE" >&2
    else
      echo "Strata 单槽不可达（GET /v1/models 失败）: $STRATA_BEFORE" >&2
    fi
    exit 1
  fi
fi

if [[ "$CONFIRMATION" == "1" ]]; then
  # 确认/拒绝：证据目录必须与预注册一致（显式传 runner），seed 用真实已采纳章节计划来源。
  export B71_CONFIRMATION_ACTION="$CONFIRMATION_ACTION"
  export TAURI_NATIVE_ARTIFACT_DIR="$DIR"
  export TAURI_NATIVE_SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
fi

if [[ "$ANSWER_MODE" == "1" ]]; then
  # 回答模式 gate：确定性 ask_author fixture（请求触发问题卡 → 回答「保留悬念」→ 同 run 继续）。
  export B71_ANSWER_MODE=1
  export TAURI_NATIVE_ARTIFACT_DIR="$DIR"
  export TAURI_NATIVE_SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
fi

if [[ "$MEMORY_DETAIL" == "1" ]]; then
  # 记忆详情回归：seed 用 B70 S1 记忆夹具（真实记忆条目），驱动只导航不输入。
  export B71_MEMORY_DETAIL=1
  export TAURI_NATIVE_ARTIFACT_DIR="$DIR"
  export TAURI_NATIVE_SEED_SCRIPT="scripts/seed_author_behavior_states.exs"
  export B70_AUTHOR_BEHAVIOR_STATE="S1-partial-multichapter"
fi

if [[ "$AUTO_MAINTENANCE" == "1" || ( "$LIVE" == "1" && "$B71_PROVIDER" == "splash" ) ]]; then
  if [[ "$AUTO_MAINTENANCE" == "1" ]]; then export B71_AUTO_MAINTENANCE=1; fi
  export TAURI_NATIVE_ARTIFACT_DIR="$DIR"
  RUNTIME_ENV="$(node --input-type=module - <<'RECIPE'
import { COMPACTION_RUNTIME_PROFILE_ID, runtimeEnvLines } from "./scripts/lib/native_ui/request_cost_runtime_recipe.mjs";
console.log(runtimeEnvLines(COMPACTION_RUNTIME_PROFILE_ID).join("\n"));
RECIPE
)" || exit 1
  while IFS= read -r assignment; do export "$assignment"; done <<<"$RUNTIME_ENV"
fi

if [[ "$BEHAVIOR" == "1" ]]; then
  # 作者行为覆盖：seed 用 B70 状态夹具（S1–S4 合成样书），输入取冻结 case 原文。
  export B71_BEHAVIOR_CASE="$BEHAVIOR_CASE"
  BEHAVIOR_STATE="$(node "$ROOT/scripts/author_behavior_live_case.mjs" --case "$BEHAVIOR_CASE" --field state_env)" || {
    echo "behavior case 读取失败: $BEHAVIOR_CASE" >&2
    exit 1
  }
  export B70_AUTHOR_BEHAVIOR_STATE="$BEHAVIOR_STATE"
  export TAURI_NATIVE_SEED_SCRIPT="scripts/seed_author_behavior_states.exs"
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

# runner 已建好本批目录、尚未启动 App 窗口：用启动前同一快照 ln 封存，driver 的
# prepare 只消费该副本；封存/校验失败不启动 App。
if [[ -n "$LIVE_PREREGISTRATION" ]] && ! seal_live_preregistration; then
  echo "预注册封存或校验失败，未启动 App: $DIR" >&2
  kill "$RUNNER" 2>/dev/null || true
  wait "$RUNNER" 2>/dev/null || true
  exit 1
fi

set +e
if [[ "$CONFIRMATION" == "1" ]]; then
  node "$ROOT/scripts/native_b71_confirmation_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
elif [[ "$AUTO_MAINTENANCE" == "1" ]]; then
  node "$ROOT/scripts/native_b71_auto_maintenance_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
elif [[ "$MEMORY_DETAIL" == "1" ]]; then
  node "$ROOT/scripts/native_b71_memory_detail_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
elif [[ "$ANSWER_MODE" == "1" ]]; then
  node "$ROOT/scripts/native_b71_auto_maintenance_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
elif [[ "$BEHAVIOR" == "1" ]]; then
  node "$ROOT/scripts/native_b71_behavior_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
elif [[ "$LIVE" == "1" ]]; then
  node "$ROOT/scripts/native_b71_live_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
else
  node "$ROOT/scripts/native_b71_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
fi
DRIVER_RC=$?
wait "$RUNNER"
RUNNER_RC=$?
set -e

if [[ "$LIVE" == "1" && "$B71_PROVIDER" == "strata" ]]; then
  # 仅本 Strata 路线核验单槽卸载；外部 Splash 不属于本批拥有的进程。
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
