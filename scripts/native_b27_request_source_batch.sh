#!/usr/bin/env bash
# B27 §9 CP3：外部原生 Tauri + 真实模型 M1/M2 批次编排（detached 可运行）。
# 前置：预注册已写入；Strata 单槽可用。批次结束/失败必须 unload 并核验 loaded=null。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-cp3}"
PREREG="$ROOT/artifacts/model-contracts/b27-cp3/preregistration.json"
STATE_DIR="$ROOT/artifacts/model-contracts/b27-cp3"
STATE="$STATE_DIR/batch-$TAG.state.json"
RUNNER_LOG="$STATE_DIR/batch-$TAG.runner.log"
DRIVER_LOG="$STATE_DIR/batch-$TAG.driver.log"
DIR="$ROOT/artifacts/slice-verify/b27-request-source-native-tauri-strata-native-$TAG"
STRATA="${NOVEL_STRATA_ENDPOINT:-http://127.0.0.1:47831}"
STRATA_BASE="${STRATA%/v1}"
mkdir -p "$STATE_DIR"

fail() {
  echo "{\"status\":\"fail\",\"reason\":\"$1\",\"at\":\"$(date -u +%FT%TZ)\"}" > "$STATE"
  echo "[b27-batch] fail: $1" >&2
  exit 64
}

[[ -f "$PREREG" ]] || fail "missing_preregistration"
node -e 'const p=require(process.argv[1]); if (!p.scope || p.model_lifecycle?.single_slot !== true) process.exit(64)' "$PREREG" || fail "invalid_preregistration"
curl -s --max-time 3 "$STRATA_BASE/api/models" >/dev/null || fail "strata_unreachable"
BEFORE="$(curl -s --max-time 3 "$STRATA_BASE/api/models")"
echo "{\"status\":\"running\",\"tag\":\"$TAG\",\"dir\":\"$DIR\",\"preflight\":$BEFORE,\"started_at\":\"$(date -u +%FT%TZ)\"}" > "$STATE"

export TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_NATIVE_TRANSPORT_PROXY=1 SLICE_VERIFY_PROVIDER=strata
export TAURI_NATIVE_ARTIFACT_TAG="$TAG"
export NOVEL_STRATA_ENDPOINT="${STRATA%/}/v1"
bash "$ROOT/scripts/tauri_slice_verify.sh" b27-request-source-native > "$RUNNER_LOG" 2>&1 &
RUNNER=$!
echo "$RUNNER" > "$STATE_DIR/batch-$TAG.runner.pid"

READY=0
for _ in $(seq 1 180); do
  if [[ -f "$DIR/native-driver-ready.json" ]]; then READY=1; break; fi
  if ! kill -0 "$RUNNER" 2>/dev/null; then fail "runner_exited_before_ready"; fi
  sleep 2
done
[[ "$READY" == "1" ]] || fail "driver_ready_timeout"
echo "{\"status\":\"driver_running\",\"tag\":\"$TAG\",\"dir\":\"$DIR\",\"started_at\":\"$(date -u +%FT%TZ)\"}" > "$STATE"
cp "$PREREG" "$DIR/preregistration.json"

node "$ROOT/scripts/native_b27_request_source_drive.mjs" "$DIR" > "$DRIVER_LOG" 2>&1
DRIVER_RC=$?
set +e
wait "$RUNNER"
RUNNER_RC=$?
set -e
AFTER="$(curl -s --max-time 3 "$STRATA_BASE/api/models" || echo '{}')"
echo "{\"status\":\"finished\",\"tag\":\"$TAG\",\"dir\":\"$DIR\",\"driver_rc\":$DRIVER_RC,\"runner_rc\":$RUNNER_RC,\"strata_after\":$AFTER,\"finished_at\":\"$(date -u +%FT%TZ)\"}" > "$STATE"
echo "[b27-batch] driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC dir=$DIR"
[[ "$DRIVER_RC" -eq 0 && "$RUNNER_RC" -eq 0 ]]
