#!/usr/bin/env bash
#
# Native Tauri slice verification entrypoint.
#
# Usage:
#   bash scripts/tauri_slice_verify.sh --list
#   bash scripts/tauri_slice_verify.sh --real-lmstudio au01-ordinary-chat-two-turn-roundtrip
#   bash scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip
#   bash scripts/tauri_slice_verify.sh au10-micro-plan-entry
#   bash scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan
#   bash scripts/tauri_slice_verify.sh au03c-work-session-resume
#   bash scripts/tauri_slice_verify.sh au05-adoption-boundary
#   bash scripts/tauri_slice_verify.sh vs10-observability-spine
#
# The script starts a slice backend and a native Tauri dev window. By default
# the backend uses a deterministic provider; with --real-lmstudio it calls the
# local LM Studio OpenAI-compatible endpoint and verifies the LLM HTTP log.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLICE_ID=""
SLICE_VERIFY_PROVIDER="${SLICE_VERIFY_PROVIDER:-slice_verify}"
PHOENIX_PORT="${PHOENIX_PORT:-4657}"
VITE_PORT="${VITE_DEV_PORT:-5768}"
API_URL="http://127.0.0.1:${PHOENIX_PORT}"
WS_URL="ws://127.0.0.1:${PHOENIX_PORT}/socket"
TAURI_WAIT_SECONDS="${TAURI_SLICE_VERIFY_TIMEOUT_SECONDS:-180}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --real-lmstudio)
      SLICE_VERIFY_PROVIDER="lmstudio"
      shift
      ;;
    --provider)
      SLICE_VERIFY_PROVIDER="${2:-}"
      shift 2
      ;;
    *)
      if [[ -z "$SLICE_ID" ]]; then
        SLICE_ID="$1"
      else
        echo "Unexpected argument: $1" >&2
        exit 64
      fi
      shift
      ;;
  esac
done

usage() {
  cat <<'EOF'
Usage:
  bash scripts/tauri_slice_verify.sh --list
  bash scripts/tauri_slice_verify.sh <slice-id>
  bash scripts/tauri_slice_verify.sh --real-lmstudio <slice-id>

Available native Tauri slice ids:
  au01-ordinary-chat-two-turn-roundtrip
  au03c-work-session-resume
  au05-adoption-boundary
  au10-micro-plan-entry
  au10-ordinary-chat-no-micro-plan
  vs10-observability-spine

Native automation:
  The script opens the AI Novel Studio Tauri window and enables
  VITE_SLICE_VERIFY_AUTORUN=<slice-id>, which drives the real workbench
  controls in the native window. No manual operation is required; the script
  exits only after the correlated logs are verified.

Real LM Studio mode:
  --real-lmstudio uses NovelAgent.Provider.LMStudio and verifies that the
  correlated turn_id has a POST /v1/chat/completions log with HTTP 2xx under
  artifacts/slice-verify/<slice-id>-tauri-lmstudio/llm-calls/.
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

if [[ "$SLICE_ID" != "au01-ordinary-chat-two-turn-roundtrip" && "$SLICE_ID" != "au03c-work-session-resume" && "$SLICE_ID" != "au05-adoption-boundary" && "$SLICE_ID" != "au10-micro-plan-entry" && "$SLICE_ID" != "au10-ordinary-chat-no-micro-plan" && "$SLICE_ID" != "vs10-observability-spine" ]]; then
  echo "Unknown native Tauri slice verification id: $SLICE_ID" >&2
  usage >&2
  exit 64
fi

if [[ "$SLICE_VERIFY_PROVIDER" != "slice_verify" && "$SLICE_VERIFY_PROVIDER" != "lmstudio" ]]; then
  echo "Unsupported slice verify provider: $SLICE_VERIFY_PROVIDER" >&2
  exit 64
fi

ARTIFACT_SUFFIX="-tauri"
if [[ "$SLICE_VERIFY_PROVIDER" == "lmstudio" ]]; then
  ARTIFACT_SUFFIX="-tauri-lmstudio"
fi

ARTIFACT_DIR="$PROJECT_ROOT/artifacts/slice-verify/${SLICE_ID}${ARTIFACT_SUFFIX}"
APP_LOG_DIR="$ARTIFACT_DIR/app-log"
LLM_LOG_DIR="$ARTIFACT_DIR/llm-calls"
rm -rf "$ARTIFACT_DIR"
mkdir -p "$APP_LOG_DIR" "$LLM_LOG_DIR"

PHX_PID=""
TAURI_PID=""

reset_test_db() {
  cd "$PROJECT_ROOT"
  MIX_ENV=test mix ecto.drop --quiet >/dev/null 2>&1 || true
  MIX_ENV=test mix ecto.create --quiet >/dev/null 2>&1 || true
  MIX_ENV=test mix ecto.migrate --quiet >/dev/null
}

cleanup() {
  if [[ -n "$TAURI_PID" ]]; then
    kill "$TAURI_PID" 2>/dev/null || true
    wait "$TAURI_PID" 2>/dev/null || true
  fi
  if [[ -n "$PHX_PID" ]]; then
    kill "$PHX_PID" 2>/dev/null || true
    wait "$PHX_PID" 2>/dev/null || true
  fi
  reset_test_db >/dev/null 2>&1 || true
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

native_action_description() {
  case "$SLICE_ID" in
    au10-ordinary-chat-no-micro-plan)
      echo "type ordinary chat -> click send -> verify generate_micro_plan=false"
      ;;
    au01-ordinary-chat-two-turn-roundtrip)
      echo "type ordinary chat -> receive result -> continue second ordinary turn"
      ;;
    au05-adoption-boundary)
      echo "open archive panel -> click new action -> wait for pending artifact -> click accept -> verify persisted adoption"
      ;;
    au03c-work-session-resume)
      echo "open archive panel -> generate pending artifact -> restart Tauri -> verify same active session transcript and pending item are restored"
      ;;
    au10-micro-plan-entry|vs10-observability-spine)
      echo "open archive panel -> click new action -> wait for assistant turn result"
      ;;
    *)
      echo "drive native workbench controls"
      ;;
  esac
}

wait_for_au03c_seed() {
  local max="${1:-90}"

  for _ in $(seq 1 "$max"); do
    if node --input-type=module - "$APP_LOG_DIR" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const [appLogDir] = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);
const jsonlPath = path.join(appLogDir, `${today}.jsonl`);
if (!fs.existsSync(jsonlPath)) process.exit(1);

const records = fs
  .readFileSync(jsonlPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const start = records.find(
  (record) =>
    record.event === "channel.user_message.start" &&
    record.generate_micro_plan === true &&
    record.session_id,
);
if (!start) process.exit(1);

const hasTool = records.some(
  (record) => record.turn_id === start.turn_id && record.event === "toolbox.execute.done",
);
const hasDone = records.some(
  (record) => record.turn_id === start.turn_id && record.event === "channel.user_message.done",
);
process.exit(hasTool && hasDone ? 0 : 1);
NODE
    then
      echo "[tauri-slice-verify] AU-03C seed pending artifact generated"
      return 0
    fi
    sleep 1
  done

  echo "[tauri-slice-verify] AU-03C seed did not finish before restart" >&2
  return 1
}

verify_native_slice() {
  node --input-type=module - "$SLICE_ID" "$APP_LOG_DIR" "$ARTIFACT_DIR" "$SLICE_VERIFY_PROVIDER" "$LLM_LOG_DIR" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import {
  findLmStudioEvidence,
  findNativeSliceEvidence,
  findSliceBehaviorEvidence,
  keyEventsForSlice,
} from "./slice-verify/native-tauri-verifier.mjs";

const [sliceId, appLogDir, artifactDir, provider, llmLogDir] = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);
const jsonlPath = path.join(appLogDir, `${today}.jsonl`);

if (!fs.existsSync(jsonlPath)) {
  process.exit(1);
}

const records = fs
  .readFileSync(jsonlPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const evidence = findNativeSliceEvidence(sliceId, records);

if (evidence) {
  const keyEvents = keyEventsForSlice(sliceId);
  const evidenceTurnIds = evidence.turn_ids ?? [evidence.turn_id];
  const allTurnRecords = records.filter((record) => evidenceTurnIds.includes(record.turn_id));
  const keyTurnRecords = allTurnRecords.filter((record) => keyEvents.includes(record.event));
  fs.writeFileSync(path.join(artifactDir, "app-log.json"), JSON.stringify(keyTurnRecords, null, 2));

  let lmstudioEvidence = null;
  let llmRecords = [];
  if (provider === "lmstudio") {
    const llmPath = path.join(llmLogDir, `${today}.jsonl`);
    if (!fs.existsSync(llmPath)) {
      process.exit(1);
    }

    llmRecords = fs
      .readFileSync(llmPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.replace(/^\[[^\]]+\]\s+/, "")));

    lmstudioEvidence = findLmStudioEvidence(evidenceTurnIds, llmRecords);
    if (!lmstudioEvidence) {
      process.exit(1);
    }

    const matchedRecords = llmRecords.filter((record) => evidenceTurnIds.includes(record.turn_id));
    fs.writeFileSync(
      path.join(artifactDir, "lmstudio-log.json"),
      JSON.stringify(matchedRecords, null, 2),
    );
  }

  const behaviorEvidence = findSliceBehaviorEvidence(sliceId, records, evidence, {
    provider,
    llmRecords,
  });
  if (!behaviorEvidence) {
    process.exit(1);
  }

  fs.writeFileSync(
    path.join(artifactDir, "summary.json"),
    JSON.stringify(
      {
        ...evidence,
        provider,
        behavior: behaviorEvidence,
        lmstudio: lmstudioEvidence,
        surface: "tauri",
      },
      null,
      2,
    ),
  );
  console.log(`[tauri-slice-verify] verified ${sliceId} turn_id=${evidence.turn_id}`);
  process.exit(0);
}

process.exit(1);
NODE
}

echo "[tauri-slice-verify] slice: $SLICE_ID"
echo "[tauri-slice-verify] provider: $SLICE_VERIFY_PROVIDER"
echo "[tauri-slice-verify] artifacts: $ARTIFACT_DIR"

cd "$PROJECT_ROOT"
reset_test_db

MIX_ENV=test \
  PHOENIX_TEST_PORT="$PHOENIX_PORT" \
  PHOENIX_PORT="$PHOENIX_PORT" \
  SLICE_VERIFY_APP_LOG_DIR="$APP_LOG_DIR" \
  SLICE_VERIFY_LLM_LOG_DIR="$LLM_LOG_DIR" \
  SLICE_VERIFY_PROVIDER="$SLICE_VERIFY_PROVIDER" \
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

if [[ "$SLICE_ID" == "au03c-work-session-resume" ]]; then
  wait_for_au03c_seed 90
  echo "[tauri-slice-verify] restarting Tauri to verify resume hydration"
  kill "$TAURI_PID" 2>/dev/null || true
  wait "$TAURI_PID" 2>/dev/null || true
  TAURI_PID=""

  VITE_API_ENDPOINT="$API_URL" \
    VITE_WS_ENDPOINT="$WS_URL" \
    VITE_DEV_PORT="$VITE_PORT" \
    VITE_SLICE_VERIFY_AUTORUN="$SLICE_ID" \
    pnpm tauri dev >>"$ARTIFACT_DIR/tauri.log" 2>&1 &
  TAURI_PID=$!
  wait_for_tauri_dev_app "$ARTIFACT_DIR/tauri.log" 120
fi

cat <<EOF
[tauri-slice-verify] Native window is starting.
[tauri-slice-verify] Env-gated native verifier is driving:
[tauri-slice-verify]   $(native_action_description)
[tauri-slice-verify] Polling up to ${TAURI_WAIT_SECONDS}s for correlated app JSONL evidence...
EOF

for _ in $(seq 1 "$TAURI_WAIT_SECONDS"); do
  if verify_native_slice; then
    echo "[tauri-slice-verify] passed: $SLICE_ID"
    exit 0
  fi
  sleep 1
done

echo "[tauri-slice-verify] timed out waiting for native slice evidence: $SLICE_ID" >&2
echo "[tauri-slice-verify] recent Tauri log:" >&2
tail -80 "$ARTIFACT_DIR/tauri.log" >&2 || true
echo "[tauri-slice-verify] recent backend log:" >&2
tail -80 "$ARTIFACT_DIR/backend.log" >&2 || true
exit 1
