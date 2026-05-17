#!/usr/bin/env bash
#
# Native Tauri slice verification entrypoint.
#
# Usage:
#   bash scripts/tauri_slice_verify.sh --list
#   bash scripts/tauri_slice_verify.sh --real-lmstudio au01-ordinary-chat-two-turn-roundtrip
#   bash scripts/tauri_slice_verify.sh stage-startup-context-contract
#   bash scripts/tauri_slice_verify.sh workspace-runtime-state
#   bash scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip
#   bash scripts/tauri_slice_verify.sh au02-candidate-continuation
#   bash scripts/tauri_slice_verify.sh au10-micro-plan-entry
#   bash scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan
#   bash scripts/tauri_slice_verify.sh au03c-work-session-resume
#   bash scripts/tauri_slice_verify.sh au05-adoption-boundary
#   bash scripts/tauri_slice_verify.sh au05-adoption-followup-routing
#   bash scripts/tauri_slice_verify.sh au05-discard-boundary
#   bash scripts/tauri_slice_verify.sh au05-modify-draft-boundary
#   bash scripts/tauri_slice_verify.sh au08-adoption-reading-projection
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
VITE_PORT="${VITE_DEV_PORT:-5769}"
API_URL="http://127.0.0.1:${PHOENIX_PORT}"
WS_URL="ws://127.0.0.1:${PHOENIX_PORT}/socket"
VITE_WS_URL="ws://localhost:${VITE_PORT}/socket"
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
  au02-candidate-continuation
  stage-startup-context-contract
  workspace-runtime-state
  au03c-work-session-resume
  au05-adoption-boundary
  au05-adoption-followup-routing
  au05-discard-boundary
  au05-modify-draft-boundary
  au08-adoption-reading-projection
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

if [[ "$SLICE_ID" != "au01-ordinary-chat-two-turn-roundtrip" && "$SLICE_ID" != "au02-candidate-continuation" && "$SLICE_ID" != "stage-startup-context-contract" && "$SLICE_ID" != "workspace-runtime-state" && "$SLICE_ID" != "au03c-work-session-resume" && "$SLICE_ID" != "au05-adoption-boundary" && "$SLICE_ID" != "au05-adoption-followup-routing" && "$SLICE_ID" != "au05-discard-boundary" && "$SLICE_ID" != "au05-modify-draft-boundary" && "$SLICE_ID" != "au08-adoption-reading-projection" && "$SLICE_ID" != "au10-micro-plan-entry" && "$SLICE_ID" != "au10-ordinary-chat-no-micro-plan" && "$SLICE_ID" != "vs10-observability-spine" ]]; then
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
    au02-candidate-continuation)
      echo "type fuzzy creative direction -> receive candidate cards -> click continue direction -> verify candidate continuation stays dialogue-only"
      ;;
    stage-startup-context-contract)
      echo "seed persisted active session -> start Tauri -> verify restored startup UI has same work/session, no welcome injection, connected service state"
      ;;
    workspace-runtime-state)
      echo "seed persisted active session -> start Tauri -> derive runtime state -> switch Reading Mode -> verify title, welcome, pending count, and empty projection"
      ;;
    au05-adoption-boundary)
      echo "open archive panel -> click new action -> wait for pending artifact -> click accept -> verify persisted adoption"
      ;;
    au05-adoption-followup-routing)
      echo "type character request -> accept setting artifact -> verify resolved card has no reading follow-up and no reading projection"
      ;;
    au05-discard-boundary)
      echo "open archive panel -> click new action -> wait for pending artifact -> click discard -> verify discarded resolution"
      ;;
    au05-modify-draft-boundary)
      echo "open archive panel -> click new action -> wait for pending artifact -> edit then accept -> verify edited acceptance"
      ;;
    au08-adoption-reading-projection)
      echo "type prose request -> wait for pending artifact -> click accept -> switch to reading mode -> verify TOC and chapter content"
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

print_native_slice_diagnostics() {
  node --input-type=module - "$SLICE_ID" "$APP_LOG_DIR" "$SLICE_VERIFY_PROVIDER" "$LLM_LOG_DIR" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { keyEventsForSlice } from "./slice-verify/native-tauri-verifier.mjs";

const [sliceId, appLogDir, provider, llmLogDir] = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);
const jsonlPath = path.join(appLogDir, `${today}.jsonl`);
const keyEvents = keyEventsForSlice(sliceId);

console.error("[tauri-slice-verify] app JSONL diagnostics:");
console.error(`  path: ${jsonlPath}`);

if (!fs.existsSync(jsonlPath)) {
  console.error("  status: missing app JSONL file");
  const files = fs.existsSync(appLogDir) ? fs.readdirSync(appLogDir) : [];
  console.error(`  app-log files: ${files.length > 0 ? files.join(", ") : "(none)"}`);
  process.exit(0);
}

const lines = fs.readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean);
const records = lines.flatMap((line, index) => {
  try {
    return [JSON.parse(line)];
  } catch (error) {
    console.error(`  parse_error: line=${index + 1} ${error.message}`);
    return [];
  }
});

console.error(`  records: ${records.length}`);

const eventCounts = new Map();
for (const record of records) {
  eventCounts.set(record.event ?? "(missing)", (eventCounts.get(record.event ?? "(missing)") ?? 0) + 1);
}

const topEvents = [...eventCounts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 20)
  .map(([event, count]) => `${event}=${count}`);
console.error(`  top_events: ${topEvents.length > 0 ? topEvents.join(", ") : "(none)"}`);

const keyEventCounts = keyEvents.map((event) => `${event}=${eventCounts.get(event) ?? 0}`);
console.error(`  key_events: ${keyEventCounts.length > 0 ? keyEventCounts.join(", ") : "(none)"}`);

const errorRecords = records.filter((record) => String(record.event ?? "").endsWith(".error"));
console.error(`  error_events: ${errorRecords.length}`);
for (const record of errorRecords.slice(-10)) {
  console.error(
    `    ${record.timestamp ?? ""} ${record.event} turn_id=${record.turn_id ?? ""} reason=${record.reason_code ?? ""} detail=${record.outcome_detail ?? ""}`,
  );
}

const byTurn = new Map();
for (const record of records) {
  if (!record.turn_id) continue;
  if (!byTurn.has(record.turn_id)) byTurn.set(record.turn_id, []);
  byTurn.get(record.turn_id).push(record);
}

const candidateTurns = [...byTurn.entries()]
  .filter(([, turnRecords]) => turnRecords.some((record) => record.event === "channel.user_message.start"))
  .slice(-5);

if (candidateTurns.length === 0) {
  console.error("  candidate_turns: none with channel.user_message.start");
} else {
  console.error("  candidate_turns:");
  for (const [turnId, turnRecords] of candidateTurns) {
    const turnEvents = new Set(turnRecords.map((record) => record.event));
    const missing = keyEvents.filter((event) => !turnEvents.has(event));
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    console.error(
      `    turn_id=${turnId} generate_micro_plan=${start?.generate_micro_plan ?? ""} records=${turnRecords.length} missing_key_events=${missing.length > 0 ? missing.join(",") : "(none)"}`,
    );
  }
}

console.error("  recent_records:");
for (const record of records.slice(-20)) {
  console.error(
    `    ${record.timestamp ?? ""} ${record.event ?? ""} turn_id=${record.turn_id ?? ""} work_id=${record.work_id ?? ""} session_id=${record.session_id ?? ""} status=${record.action_status ?? record.status ?? ""}`,
  );
}

if (provider === "lmstudio") {
  const llmPath = path.join(llmLogDir, `${today}.jsonl`);
  const llmLines = fs.existsSync(llmPath)
    ? fs.readFileSync(llmPath, "utf8").split("\n").filter(Boolean)
    : [];
  console.error(`  lmstudio_jsonl: ${fs.existsSync(llmPath) ? llmPath : "(missing)"}`);
  console.error(`  lmstudio_records: ${llmLines.length}`);
}
NODE
}

echo "[tauri-slice-verify] slice: $SLICE_ID"
echo "[tauri-slice-verify] provider: $SLICE_VERIFY_PROVIDER"
echo "[tauri-slice-verify] artifacts: $ARTIFACT_DIR"

cd "$PROJECT_ROOT"
reset_test_db

if [[ "$SLICE_ID" == "stage-startup-context-contract" || "$SLICE_ID" == "workspace-runtime-state" ]]; then
  MIX_ENV=test mix run scripts/seed_stage_startup_context.exs >"$ARTIFACT_DIR/seed.log" 2>&1
fi

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
VITE_API_ENDPOINT="" \
  VITE_PROXY_TARGET="$API_URL" \
  VITE_WS_ENDPOINT="$VITE_WS_URL" \
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

  VITE_API_ENDPOINT="" \
    VITE_PROXY_TARGET="$API_URL" \
    VITE_WS_ENDPOINT="$VITE_WS_URL" \
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
print_native_slice_diagnostics
echo "[tauri-slice-verify] recent Tauri log:" >&2
tail -80 "$ARTIFACT_DIR/tauri.log" >&2 || true
echo "[tauri-slice-verify] recent backend log:" >&2
tail -80 "$ARTIFACT_DIR/backend.log" >&2 || true
exit 1
