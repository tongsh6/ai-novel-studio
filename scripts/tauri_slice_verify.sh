#!/usr/bin/env bash
#
# Native Tauri slice verification entrypoint.
#
# Usage:
#   bash scripts/tauri_slice_verify.sh --list
#   bash scripts/tauri_slice_verify.sh vs10-observability-spine
#
# The script starts the deterministic test backend and a native Tauri dev
# window. In the native window, an env-gated verifier clicks the same
# data-slice-verify UI controls used by the browser scenario, then the script
# validates the app JSONL log spine for the selected slice.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLICE_ID="${1:-}"
PHOENIX_PORT="${PHOENIX_PORT:-4657}"
VITE_PORT="${VITE_DEV_PORT:-5768}"
API_URL="http://127.0.0.1:${PHOENIX_PORT}"
WS_URL="ws://127.0.0.1:${PHOENIX_PORT}/socket"
TAURI_WAIT_SECONDS="${TAURI_SLICE_VERIFY_TIMEOUT_SECONDS:-180}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/tauri_slice_verify.sh --list
  bash scripts/tauri_slice_verify.sh <slice-id>

Available native Tauri slice ids:
  vs10-observability-spine

Native automation for vs10-observability-spine:
  The script opens the AI Novel Studio Tauri window and enables
  VITE_SLICE_VERIFY_AUTORUN=vs10-observability-spine, which drives the
  real workbench controls in the native window. No manual operation is
  required; the script exits only after the correlated logs are verified.
EOF
}

if [[ -z "$SLICE_ID" || "$SLICE_ID" == "-h" || "$SLICE_ID" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$SLICE_ID" == "--list" ]]; then
  usage
  exit 0
fi

if [[ "$SLICE_ID" != "vs10-observability-spine" ]]; then
  echo "Unknown native Tauri slice verification id: $SLICE_ID" >&2
  usage >&2
  exit 64
fi

ARTIFACT_DIR="$PROJECT_ROOT/artifacts/slice-verify/${SLICE_ID}-tauri"
APP_LOG_DIR="$ARTIFACT_DIR/app-log"
rm -rf "$ARTIFACT_DIR"
mkdir -p "$APP_LOG_DIR"

PHX_PID=""
TAURI_PID=""

cleanup() {
  if [[ -n "$TAURI_PID" ]]; then
    kill "$TAURI_PID" 2>/dev/null || true
    wait "$TAURI_PID" 2>/dev/null || true
  fi
  if [[ -n "$PHX_PID" ]]; then
    kill "$PHX_PID" 2>/dev/null || true
    wait "$PHX_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_url() {
  local url="$1"
  local label="$2"
  local max="${3:-30}"

  for _ in $(seq 1 "$max"); do
    if curl -s "$url" >/dev/null 2>&1; then
      echo "[tauri-slice-verify] $label ready: $url"
      return 0
    fi
    sleep 1
  done

  echo "[tauri-slice-verify] $label did not become ready: $url" >&2
  return 1
}

wait_for_tauri_dev_app() {
  local log_file="$1"
  local max="${2:-120}"

  for _ in $(seq 1 "$max"); do
    if grep -q 'Running.*target/debug/app' "$log_file" 2>/dev/null; then
      echo "[tauri-slice-verify] Tauri native app launched"
      return 0
    fi
    sleep 1
  done

  echo "[tauri-slice-verify] Tauri native app did not launch" >&2
  tail -80 "$log_file" >&2 || true
  return 1
}

verify_log_spine() {
  node - "$APP_LOG_DIR" "$ARTIFACT_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [appLogDir, artifactDir] = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);
const jsonlPath = path.join(appLogDir, `${today}.jsonl`);
const keyEvents = [
  "channel.user_message.start",
  "dialogue_gateway.handle_input.start",
  "context.assemble.done",
  "planner.form_frame.error",
  "planner.form_micro_plan.error",
  "dialogue_gateway.handle_input.done",
  "channel.user_message.done",
];

if (!fs.existsSync(jsonlPath)) {
  process.exit(1);
}

const records = fs
  .readFileSync(jsonlPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const byTurn = new Map();
for (const record of records) {
  if (!record.turn_id) continue;
  const turnRecords = byTurn.get(record.turn_id) ?? [];
  turnRecords.push(record);
  byTurn.set(record.turn_id, turnRecords);
}

for (const [turnId, turnRecords] of byTurn.entries()) {
  const hasAllEvents = keyEvents.every((event) =>
    turnRecords.some((record) => record.event === event),
  );
  if (!hasAllEvents) continue;

  for (const event of keyEvents) {
    const record = turnRecords.find((candidate) => candidate.event === event);
    if (!record.workspace_id) throw new Error(`${event} missing workspace_id`);
    if (!record.work_id) throw new Error(`${event} missing work_id`);
    if (typeof record.duration_ms !== "number") throw new Error(`${event} missing duration_ms`);
    if (!record.outcome) throw new Error(`${event} missing outcome`);
  }

  fs.writeFileSync(
    path.join(artifactDir, "app-log.json"),
    JSON.stringify(turnRecords, null, 2),
  );
  fs.writeFileSync(
    path.join(artifactDir, "summary.json"),
    JSON.stringify({ slice_id: "vs10-observability-spine", surface: "tauri", turn_id: turnId, key_events: keyEvents }, null, 2),
  );
  console.log(`[tauri-slice-verify] verified turn_id=${turnId}`);
  process.exit(0);
}

process.exit(1);
NODE
}

echo "[tauri-slice-verify] slice: $SLICE_ID"
echo "[tauri-slice-verify] artifacts: $ARTIFACT_DIR"

cd "$PROJECT_ROOT"
MIX_ENV=test mix ecto.create --quiet >/dev/null 2>&1 || true
MIX_ENV=test mix ecto.migrate --quiet >/dev/null

MIX_ENV=test \
  PHOENIX_TEST_PORT="$PHOENIX_PORT" \
  PHOENIX_PORT="$PHOENIX_PORT" \
  SLICE_VERIFY_APP_LOG_DIR="$APP_LOG_DIR" \
  mix run --no-start --no-halt scripts/slice_verify_server.exs >"$ARTIFACT_DIR/backend.log" 2>&1 &
PHX_PID=$!
wait_for_url "$API_URL/health" "Phoenix"

cd "$PROJECT_ROOT/frontend"
VITE_API_ENDPOINT="$API_URL" \
  VITE_WS_ENDPOINT="$WS_URL" \
  VITE_DEV_PORT="$VITE_PORT" \
  VITE_SLICE_VERIFY_AUTORUN="$SLICE_ID" \
  pnpm tauri dev >"$ARTIFACT_DIR/tauri.log" 2>&1 &
TAURI_PID=$!

wait_for_tauri_dev_app "$ARTIFACT_DIR/tauri.log" 120

cat <<EOF
[tauri-slice-verify] Native window is starting.
[tauri-slice-verify] Env-gated native verifier is driving:
[tauri-slice-verify]   open archive panel -> click new action -> wait for assistant turn result
[tauri-slice-verify] Polling up to ${TAURI_WAIT_SECONDS}s for correlated app JSONL events...
EOF

for _ in $(seq 1 "$TAURI_WAIT_SECONDS"); do
  if verify_log_spine; then
    echo "[tauri-slice-verify] passed: $SLICE_ID"
    exit 0
  fi
  sleep 1
done

echo "[tauri-slice-verify] timed out waiting for native VS-10 log spine" >&2
echo "[tauri-slice-verify] recent Tauri log:" >&2
tail -80 "$ARTIFACT_DIR/tauri.log" >&2 || true
echo "[tauri-slice-verify] recent backend log:" >&2
tail -80 "$ARTIFACT_DIR/backend.log" >&2 || true
exit 1
