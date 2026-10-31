#!/usr/bin/env bash
# AU12 P2 原生验收批次编排：外部 AX/CGEvent 驱动真实 Tauri 窗口（嵌入真实前端与 Phoenix）。
#
# 两段式原生验收需要一个编排者：tauri_slice_verify.sh 在 native 模式下只负责启动真实
# 窗口并等待外部 driver 的 typed wait 账；driver 必须由本脚本在 ready 之后拉起，否则
# supervisor 会按 driver_idle 预算 fail-fast（不是产品缺陷）。
#
# 前置：预注册 artifacts/au12-writeback/preregistration.json；provider=slice_verify，
# 不加载真实模型；批次失败只读保留，不覆盖既有目录。
#
# 用法：
#   bash scripts/native_au12_batch.sh <tag>             # 前台执行
#   bash scripts/native_au12_batch.sh --detach <tag>    # detached 执行（pidfile/state）
#   bash scripts/native_au12_batch.sh --status <tag>    # 查看批次状态
#
# 产物：
#   证据 artifacts/slice-verify/au12-correction-intent-roundtrip-tauri-native-<tag>/
#   编排状态 artifacts/au12-writeback/batch-<tag>.state.json / .runner.log / .driver.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLICE="au12-correction-intent-roundtrip"
MODE="run"
TAG=""

case "${1:-}" in
  --detach | --status)
    MODE="run"
    [[ "$1" == "--detach" ]] && MODE="detach"
    [[ "$1" == "--status" ]] && MODE="status"
    TAG="${2:-}"
    ;;
  *)
    TAG="${1:-}"
    ;;
esac

STATE_DIR="$ROOT/artifacts/au12-writeback"
PREREG="$STATE_DIR/preregistration.json"
if [[ -z "$TAG" ]]; then
  echo "usage: bash scripts/native_au12_batch.sh [--detach|--status] <tag>" >&2
  exit 64
fi
if [[ ! "$TAG" =~ ^[a-z0-9-]+$ || ${#TAG} -gt 32 ]]; then
  echo "tag must be lowercase letters, digits or hyphens, at most 32 chars: $TAG" >&2
  exit 64
fi

DIR="$ROOT/artifacts/slice-verify/${SLICE}-tauri-native-$TAG"
STATE="$STATE_DIR/batch-$TAG.state.json"
RUNNER_LOG="$STATE_DIR/batch-$TAG.runner.log"
DRIVER_LOG="$STATE_DIR/batch-$TAG.driver.log"
PIDFILE="$STATE_DIR/batch-$TAG.pid"
mkdir -p "$STATE_DIR"

write_state() {
  local status="$1" extra="${2:-}"
  if [[ -n "$extra" ]]; then
    printf '{"status":"%s","tag":"%s","dir":"%s","pid":%s,"updated_at":"%s",%s}\n' \
      "$status" "$TAG" "$DIR" "$$" "$(date -u +%FT%TZ)" "$extra" > "$STATE"
  else
    printf '{"status":"%s","tag":"%s","dir":"%s","pid":%s,"updated_at":"%s"}\n' \
      "$status" "$TAG" "$DIR" "$$" "$(date -u +%FT%TZ)" > "$STATE"
  fi
}

fail() {
  write_state "fail" "\"reason\":\"$1\""
  echo "[au12-batch] fail: $1" >&2
  exit 64
}

if [[ "$MODE" == "status" ]]; then
  cat "$STATE" 2>/dev/null || echo '{"status":"unknown"}'
  exit 0
fi

[[ -f "$PREREG" ]] || fail "missing_preregistration"
if [[ -e "$DIR" ]]; then
  fail "artifact_dir_exists:prior_batches_are_immutable"
fi

if [[ "$MODE" == "detach" ]]; then
  nohup bash "$0" "$TAG" >>"$STATE_DIR/batch-$TAG.detached.log" 2>&1 &
  echo "$!" > "$PIDFILE"
  echo "[au12-batch] detached pid=$(cat "$PIDFILE") tag=$TAG dir=$DIR"
  exit 0
fi

[[ "$MODE" == "run" ]] || fail "unknown_mode:$MODE"
node -e 'const p=require(process.argv[1]); if (p.criteria?.summary_surface !== "tauri") process.exit(64)' \
  "$PREREG" || fail "invalid_preregistration"
write_state "starting"

export TAURI_NATIVE_SYSTEM_DRIVER=1
export TAURI_NATIVE_TRANSPORT_PROXY=1
export TAURI_NATIVE_ARTIFACT_TAG="$TAG"
bash "$ROOT/scripts/tauri_slice_verify.sh" "$SLICE" > "$RUNNER_LOG" 2>&1 &
RUNNER=$!
echo "$RUNNER" > "$STATE_DIR/batch-$TAG.runner.pid"

READY=0
for _ in $(seq 1 180); do
  if [[ -f "$DIR/native-driver-ready.json" ]]; then READY=1; break; fi
  if ! kill -0 "$RUNNER" 2>/dev/null; then fail "runner_exited_before_ready"; fi
  sleep 2
done
[[ "$READY" == "1" ]] || fail "driver_ready_timeout"
write_state "driver_running"

cp "$PREREG" "$DIR/preregistration.json"
set +e
node "$ROOT/scripts/native_au12_drive.mjs" "$DIR" > "$DRIVER_LOG" 2>&1
DRIVER_RC=$?
wait "$RUNNER"
RUNNER_RC=$?
set -e

SUMMARY_STATE=""
if [[ -f "$DIR/summary.json" ]]; then
  SUMMARY_STATE="$(node -e '
const s=require(process.argv[1]);
process.stdout.write(JSON.stringify({surface:s.surface,passed:s.checks_passed,total:s.checks_total,all:s.all_checks_passed}));
' "$DIR/summary.json" 2>/dev/null || echo '')"
fi

if [[ "$DRIVER_RC" -eq 0 && "$RUNNER_RC" -eq 0 ]]; then
  write_state "finished" "\"driver_rc\":$DRIVER_RC,\"runner_rc\":$RUNNER_RC,\"summary\":${SUMMARY_STATE:-null}"
  echo "[au12-batch] PASS driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC dir=$DIR"
  exit 0
fi

write_state "fail" "\"reason\":\"driver_or_runner_failed\",\"driver_rc\":$DRIVER_RC,\"runner_rc\":$RUNNER_RC"
echo "[au12-batch] FAIL driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC dir=$DIR" >&2
echo "[au12-batch] runner log: $RUNNER_LOG" >&2
echo "[au12-batch] driver log: $DRIVER_LOG" >&2
exit 1
