#!/usr/bin/env bash
# AU08 原生阅读投影故障恢复批次：runner ready 后启动外部 AX driver，独立状态/证据目录。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLICE="au08-reading-projection-failure-recovery"
MODE="run"
TAG=""
case "${1:-}" in
  --detach | --status)
    [[ "$1" == "--detach" ]] && MODE="detach"
    [[ "$1" == "--status" ]] && MODE="status"
    TAG="${2:-}"
    ;;
  *) TAG="${1:-}" ;;
esac

STATE_DIR="$ROOT/artifacts/au08-channel-fault"
PREREG="$ROOT/artifacts/model-contracts/au08-channel-fault/preregistration.json"
if [[ -z "$TAG" ]]; then
  echo "usage: bash scripts/native_au08_projection_batch.sh [--detach|--status] <tag>" >&2
  exit 64
fi
if [[ ! "$TAG" =~ ^[a-z0-9-]+$ || ${#TAG} -gt 32 ]]; then
  echo "invalid tag: $TAG" >&2
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
  echo "[au08-batch] fail: $1" >&2
  exit 64
}

if [[ "$MODE" == "status" ]]; then
  cat "$STATE" 2>/dev/null || echo '{"status":"unknown"}'
  exit 0
fi
[[ -f "$PREREG" ]] || fail "missing_preregistration"
[[ ! -e "$DIR" ]] || fail "artifact_dir_exists:prior_batches_are_immutable"

if [[ "$MODE" == "detach" ]]; then
  nohup bash "$0" "$TAG" >>"$STATE_DIR/batch-$TAG.detached.log" 2>&1 &
  echo "$!" > "$PIDFILE"
  echo "[au08-batch] detached pid=$(cat "$PIDFILE") tag=$TAG dir=$DIR"
  exit 0
fi

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
node "$ROOT/scripts/native_au08_projection_drive.mjs" "$DIR" > "$DRIVER_LOG" 2>&1
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
  echo "[au08-batch] PASS driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC dir=$DIR"
  exit 0
fi
write_state "fail" "\"reason\":\"driver_or_runner_failed\",\"driver_rc\":$DRIVER_RC,\"runner_rc\":$RUNNER_RC"
echo "[au08-batch] FAIL driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC dir=$DIR" >&2
echo "[au08-batch] runner log: $RUNNER_LOG" >&2
echo "[au08-batch] driver log: $DRIVER_LOG" >&2
exit 1
