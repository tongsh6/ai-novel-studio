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

LIVE=0
if [[ "$B71_PROVIDER" == "strata" ]]; then
  LIVE=1
  if [[ "$SLICE" != "b71-first-consumer" ]]; then
    echo "live model batch 只接受 B71_SLICE=b71-first-consumer，实测: $SLICE" >&2
    exit 64
  fi
fi

# §16.16 第 2 类入口（安全点自动维护）：A3 批次（真实 strata + 小窗口压力）。
AUTO_MAINTENANCE="${B71_AUTO_MAINTENANCE:-}"
if [[ -n "$AUTO_MAINTENANCE" ]]; then
  if [[ "$AUTO_MAINTENANCE" != "1" ]]; then
    echo "B71_AUTO_MAINTENANCE 只能是 1，实测: $AUTO_MAINTENANCE" >&2
    exit 64
  fi
  if [[ "$B71_PROVIDER" != "strata" ]]; then
    echo "auto-maintenance batch 只接受 B71_PROVIDER=strata，实测: $B71_PROVIDER" >&2
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
  LIVE=1
fi

# A3b 非验收 smoke（真实能力探查：不产验收证据；仅 A3 驱动观测）。
A3B_SMOKE="${B71_AUTO_MAINT_SMOKE:-0}"
if [[ "$A3B_SMOKE" == "1" && "$AUTO_MAINTENANCE" != "1" ]]; then
  echo "B71_AUTO_MAINT_SMOKE=1 需要同时设置 B71_AUTO_MAINTENANCE=1（A3 驱动 smoke）" >&2
  exit 64
fi

# 记忆详情/列表 P0 泄漏回归（确定性 slice_verify；需真实记忆数据 seed）。
MEMORY_DETAIL="${B71_MEMORY_DETAIL:-}"
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

if [[ "$MEMORY_DETAIL" == "1" ]]; then
  # 记忆详情回归批次目录与预注册一致；仍必须位于 artifacts/ 且不存在。
  DIR="${B71_MEMORY_DETAIL_ARTIFACT_DIR:-$ROOT/artifacts/slice-verify/b71-memory-detail-ax-$TAG}"
  if [[ "$DIR" != "$ROOT/artifacts/"* ]]; then
    echo "B71_MEMORY_DETAIL_ARTIFACT_DIR 必须位于 $ROOT/artifacts/ 下: $DIR" >&2
    exit 64
  fi
elif [[ "$AUTO_MAINTENANCE" == "1" && "$A3B_SMOKE" == "1" ]]; then
  # A3b smoke：非验收观测目录（artifacts/ 下独立命名，不进入 slice-verify 验收证据）。
  DIR="${B71_AUTO_MAINT_SMOKE_ARTIFACT_DIR:-$ROOT/artifacts/b71-native/a3b-smoke-$TAG}"
  if [[ "$DIR" != "$ROOT/artifacts/"* ]]; then
    echo "B71_AUTO_MAINT_SMOKE_ARTIFACT_DIR 必须位于 $ROOT/artifacts/ 下: $DIR" >&2
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

if [[ "$CONFIRMATION" == "1" ]]; then
  # 确认/拒绝：证据目录必须与预注册一致（显式传 runner），seed 用真实已采纳章节计划来源。
  export B71_CONFIRMATION_ACTION="$CONFIRMATION_ACTION"
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

if [[ "$AUTO_MAINTENANCE" == "1" ]]; then
  # A3：显式开启安全点自动维护 + 小窗口压力（产品化运维配置，默认关闭）。
  export B71_AUTO_MAINTENANCE=1
  export NOVEL_AUTO_MAINTENANCE_ENABLED="${NOVEL_AUTO_MAINTENANCE_ENABLED:-1}"
  export NOVEL_CONTEXT_WINDOW_OVERRIDES="${NOVEL_CONTEXT_WINDOW_OVERRIDES:-strata:4096}"
  export TAURI_NATIVE_ARTIFACT_DIR="$DIR"
  if [[ "$A3B_SMOKE" == "1" ]]; then
    # A3b smoke：同 run 多回合（真实控制坞 steer）+ 只观测不产验收证据。
    export B71_AUTO_MAINT_SMOKE=1
    export B71_AUTO_MAINT_MULTI_TURN=1
  fi
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

set +e
if [[ "$CONFIRMATION" == "1" ]]; then
  node "$ROOT/scripts/native_b71_confirmation_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
elif [[ "$AUTO_MAINTENANCE" == "1" ]]; then
  node "$ROOT/scripts/native_b71_auto_maintenance_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
elif [[ "$MEMORY_DETAIL" == "1" ]]; then
  node "$ROOT/scripts/native_b71_memory_detail_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
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

if [[ "$LIVE" == "1" ]]; then
  # 批次结束/失败/中断都必须卸载并核验 loaded=null；driver 已卸载，batch 再独立核验。
  node "$ROOT/scripts/native_b71_strata_state.mjs" --unload >"$STRATA_AFTER" 2>/dev/null || true
  if ! node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j.slot?.ok===true&&j.slot?.loaded===false?0:1)' "$STRATA_AFTER"; then
    echo "[b71-native] FAIL strata not unloaded: $STRATA_AFTER" >&2
    echo "[b71-native] FAIL driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC dir=$DIR" >&2
    exit 1
  fi
fi

if [[ "$A3B_SMOKE" == "1" ]]; then
  # 非验收 smoke：只要求驱动完成（runner verify 对观测目录无意义，忽略其退出码）。
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const mt=j.multi_turn??{}; console.log("[a3b-smoke] " + JSON.stringify({driver_ok:true,pause:mt.pause??null,steer_ok:mt.steer?.ok??null,exchange_facts:mt.exchange_facts??null,usage_facts:mt.usage_facts??null,checkpoint_events:j.termination?.checkpoint_events??null,strip:mt.strip??null,run_events:mt.run_events??null}, null, 1));' "$DIR/native-b71-driver-log.json" 2>/dev/null || true
  if [[ "$DRIVER_RC" -eq 0 ]]; then
    echo "[b71-native] SMOKE 完成 dir=$DIR"
    exit 0
  fi
  echo "[b71-native] SMOKE FAIL driver_rc=$DRIVER_RC dir=$DIR" >&2
  echo "runner log: $RUNNER_LOG; driver log: $DRIVER_LOG" >&2
  exit 1
fi

if [[ "$DRIVER_RC" -eq 0 && "$RUNNER_RC" -eq 0 ]]; then
  echo "[b71-native] PASS dir=$DIR"
  exit 0
fi

echo "[b71-native] FAIL driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC dir=$DIR" >&2
echo "runner log: $RUNNER_LOG; driver log: $DRIVER_LOG" >&2
exit 1
