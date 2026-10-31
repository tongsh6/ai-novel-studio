#!/usr/bin/env bash
# VS00G scoped 启动诊断：一批 240s，独立 pid/state，不执行业务动作。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="run"
TAG="${1:-startup-01}"
if [[ "$TAG" == "--detach" ]]; then MODE="detach"; TAG="${2:-startup-01}"; fi
STATE_DIR="$ROOT/artifacts/model-contracts/vs00g-trigger-c-scoped"
PREREG="$STATE_DIR/preregistration.json"
DIR="$ROOT/artifacts/slice-verify/vs00g-trigger-c-tauri-native-$TAG"
STATE="$STATE_DIR/batch-$TAG.state.json"
RUNNER_LOG="$STATE_DIR/batch-$TAG.runner.log"
DRIVER_LOG="$STATE_DIR/batch-$TAG.driver.log"
mkdir -p "$STATE_DIR"
if [[ ! "$TAG" =~ ^[a-z0-9-]+$ || ${#TAG} -gt 32 ]]; then echo "invalid tag" >&2; exit 64; fi
if [[ "${2:-}" == "--detach" || "${1:-}" == "--detach" ]]; then
  TAG="${2:-startup-01}"
  nohup bash "$0" "$TAG" >>"$STATE_DIR/batch-$TAG.detached.log" 2>&1 &
  echo "$!" > "$STATE_DIR/batch-$TAG.pid"
  echo "[vs00g-startup] detached pid=$! dir=$DIR"
  exit 0
fi
[[ -f "$PREREG" ]] || { echo "missing preregistration" >&2; exit 64; }
[[ ! -e "$DIR" ]] || { echo "artifact dir exists; prior batches are immutable" >&2; exit 64; }
printf '{"status":"starting","tag":"%s","pid":%s,"updated_at":"%s"}\n' "$TAG" "$$" "$(date -u +%FT%TZ)" > "$STATE"
export TAURI_NATIVE_SYSTEM_DRIVER=1
export TAURI_NATIVE_TRANSPORT_PROXY=1
export TAURI_NATIVE_ARTIFACT_TAG="$TAG"
export VS00G_VERIFY_MODE=startup
bash "$ROOT/scripts/tauri_slice_verify.sh" vs00g-trigger-c > "$RUNNER_LOG" 2>&1 &
RUNNER=$!
READY=0
for _ in $(seq 1 120); do
  if [[ -f "$DIR/native-driver-ready.json" ]]; then READY=1; break; fi
  if ! kill -0 "$RUNNER" 2>/dev/null; then break; fi
  if (( SECONDS >= 240 )); then break; fi
  sleep 2
done
if [[ "$READY" != "1" ]]; then
  printf '{"status":"fail","reason":"driver_ready_timeout","tag":"%s"}\n' "$TAG" > "$STATE"
  exit 1
fi
cp "$PREREG" "$DIR/preregistration.json"
set +e
node "$ROOT/scripts/native_vs00g_trigger_c_startup_drive.mjs" "$DIR" > "$DRIVER_LOG" 2>&1
DRIVER_RC=$?
wait "$RUNNER"
RUNNER_RC=$?
set -e
if (( SECONDS > 240 )); then DRIVER_RC=124; RUNNER_RC=124; fi
if [[ "$DRIVER_RC" -eq 0 && "$RUNNER_RC" -eq 0 ]]; then
  printf '{"status":"finished","scope":"precondition_only","tag":"%s","driver_rc":0,"runner_rc":0,"elapsed_seconds":%s}\n' "$TAG" "$SECONDS" > "$STATE"
  echo "[vs00g-startup] PASS precondition only: $DIR"
  exit 0
fi
printf '{"status":"fail","reason":"driver_or_runner_failed","tag":"%s","driver_rc":%s,"runner_rc":%s}\n' "$TAG" "$DRIVER_RC" "$RUNNER_RC" > "$STATE"
echo "[vs00g-startup] FAIL dir=$DIR" >&2
exit 1
