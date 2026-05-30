#!/usr/bin/env bash
#
# Verifies the stage launcher owns the desktop process tree cleanup.
#
# The check starts the real stage Tauri path on isolated ports, waits for the
# native app to launch, terminates the Tauri dev process, and asserts that the
# stage launcher exits, Phoenix is no longer serving health checks, and
# tauri.conf.json is restored from its temporary mutation.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/process_tree.sh"
SLICE_ID="desktop-stage-process-ownership"
ARTIFACT_DIR="$PROJECT_ROOT/artifacts/slice-verify/${SLICE_ID}-tauri"
STAGE_LOG="$ARTIFACT_DIR/stage.log"
SUMMARY_PATH="$ARTIFACT_DIR/summary.json"
TAURI_CONF="$PROJECT_ROOT/frontend/src-tauri/tauri.conf.json"
ORIGINAL_CONF="$ARTIFACT_DIR/tauri.conf.original.json"
PHOENIX_PORT="${PHOENIX_PORT:-4662}"
VITE_DEV_PORT="${VITE_DEV_PORT:-5772}"
STAGE_PID=""

mkdir -p "$ARTIFACT_DIR"
rm -f "$STAGE_LOG" "$SUMMARY_PATH"
cp "$TAURI_CONF" "$ORIGINAL_CONF"

cleanup() {
  # 安全网：stage.sh 退出时已自清进程树；此处再整树兜底，避免本验证脚本
  # 被中断时漏掉 stage 启动的 Phoenix/Tauri/Vite 子树。
  [[ -n "$STAGE_PID" ]] || return 0
  kill_process_tree "$STAGE_PID"
  wait "$STAGE_PID" 2>/dev/null || true
}
trap cleanup EXIT

wait_for_log() {
  local pattern="$1"
  local label="$2"
  local max="${3:-120}"

  for _ in $(seq 1 "$max"); do
    if grep -q "$pattern" "$STAGE_LOG" 2>/dev/null; then
      echo "[stage-ownership] $label"
      return 0
    fi
    sleep 1
  done

  echo "[stage-ownership] timed out waiting for $label" >&2
  tail -120 "$STAGE_LOG" >&2 || true
  return 1
}

echo "[stage-ownership] starting stage on Phoenix ${PHOENIX_PORT}, Vite ${VITE_DEV_PORT}"
(
  cd "$PROJECT_ROOT"
  PHOENIX_PORT="$PHOENIX_PORT" \
  VITE_DEV_PORT="$VITE_DEV_PORT" \
  NOVEL_PROVIDER_DEFAULT="${NOVEL_PROVIDER_DEFAULT:-lmstudio}" \
    bash scripts/stage.sh
) >"$STAGE_LOG" 2>&1 &
STAGE_PID=$!

wait_for_log "Phoenix ready" "Phoenix ready"
wait_for_log "Tauri PID:" "Tauri launcher PID recorded"
wait_for_log "Running.*target/debug/app" "Tauri native app launched"

TAURI_PID="$(sed -n 's/.*Tauri PID: //p' "$STAGE_LOG" | tail -1)"
if [[ -z "$TAURI_PID" ]]; then
  echo "[stage-ownership] missing Tauri PID in stage log" >&2
  exit 1
fi

echo "[stage-ownership] terminating Tauri launcher pid ${TAURI_PID}"
kill "$TAURI_PID" 2>/dev/null || true

for _ in $(seq 1 60); do
  if ! kill -0 "$STAGE_PID" 2>/dev/null; then
    STAGE_PID=""
    break
  fi
  sleep 1
done

if [[ -n "$STAGE_PID" ]]; then
  echo "[stage-ownership] stage launcher did not exit after Tauri terminated" >&2
  exit 1
fi

if curl -s "http://127.0.0.1:${PHOENIX_PORT}/health" >/dev/null 2>&1; then
  echo "[stage-ownership] Phoenix health endpoint is still reachable after cleanup" >&2
  exit 1
fi

if ! cmp -s "$ORIGINAL_CONF" "$TAURI_CONF"; then
  echo "[stage-ownership] tauri.conf.json was not restored after stage cleanup" >&2
  exit 1
fi

node --input-type=module - "$SUMMARY_PATH" "$SLICE_ID" "$PHOENIX_PORT" "$VITE_DEV_PORT" <<'NODE'
import fs from "node:fs";

const [summaryPath, sliceId, phoenixPort, vitePort] = process.argv.slice(2);

const summary = {
  slice_id: sliceId,
  surface: "tauri",
  generated_at: new Date().toISOString(),
  action: "start stage -> wait native Tauri app -> terminate Tauri launcher -> verify launcher cleanup",
  phoenix_port: Number(phoenixPort),
  vite_port: Number(vitePort),
  assertions: {
    stage_launcher_exited_after_tauri_exit: true,
    phoenix_health_unreachable_after_cleanup: true,
    tauri_conf_restored: true,
  },
};

fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
NODE

echo "[stage-ownership] summary: ${SUMMARY_PATH#$PROJECT_ROOT/}"
