#!/usr/bin/env bash
#
# Native Tauri slice verification entrypoint.
#
# Usage:
#   bash scripts/tauri_slice_verify.sh --list
#   bash scripts/tauri_slice_verify.sh au03-long-session-compression
#   bash scripts/tauri_slice_verify.sh au03-context-source-ui
#   bash scripts/tauri_slice_verify.sh su01-model-provider-switching
#   bash scripts/tauri_slice_verify.sh au02-candidate-adoption-bridge
#   bash scripts/tauri_slice_verify.sh au05-adoption-safety-freshness
#   bash scripts/tauri_slice_verify.sh au05-stale-conflict-cross-work-freshness
#   bash scripts/tauri_slice_verify.sh au05-conflict-cross-work-recovery
#   bash scripts/tauri_slice_verify.sh au05-canon-conflict-recovery
#   bash scripts/tauri_slice_verify.sh p1-chapter-plan-minimum
#   bash scripts/tauri_slice_verify.sh p1-chapter-draft-generation
#   bash scripts/tauri_slice_verify.sh --real-lmstudio au03-long-session-compression
#   bash scripts/tauri_slice_verify.sh desktop-stage-process-ownership
#
# The script starts a slice backend and a native Tauri dev window. UI actions
# are driven by an external Playwright driver against the real workbench DOM,
# not by product-code autorun hooks. By default the backend uses a deterministic
# provider; with --real-lmstudio it calls the local LM Studio OpenAI-compatible
# endpoint and verifies the LLM HTTP log.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORIGINAL_HOME="${HOME:-}"
source "$PROJECT_ROOT/scripts/lib/process_tree.sh"
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

Implemented external UI driver slice ids:
  au02-candidate-adoption-bridge
  su01-model-provider-switching
  au05-adoption-safety-freshness
  au05-stale-conflict-cross-work-freshness
  au05-conflict-cross-work-recovery
  au05-canon-conflict-recovery
  p1-chapter-plan-minimum
  p1-chapter-draft-generation
  p1-chapter-adoption-reading
  p1-word-count-audit
  p1-chapter-edit-then-accept
  p1-chapter-overwrite-confirm
  p1-chapter-expansion
  p1-chapter-expansion-multichapter
  p1-chapter-word-count-target
  p1-export-minimum
  p1-plan-incremental
  au04-confirm-before-execute
  vs00c-cp0-missing-chapter-block
  vs00c-cp3-structured-context
  vs00c-cp4-chapter-plan-structure
  au09-memory-create-recall
  au09-adopt-setting-recall
  au09-validity-window-recall
  au03-long-session-compression
  au03-context-source-ui
  au10-workbench-matrix-layout
  desktop-stage-process-ownership

Legacy slice ids must get an external driver before this script can run them.
Do not add product-code autorun hooks to make a slice pass.

Native automation:
  The script opens the AI Novel Studio Tauri window and runs an external
  Playwright UI driver against the real workbench DOM. Product React code does
  not know the slice id and does not auto-fill, auto-click, or report verifier
  state. The script exits only after correlated logs and external UI evidence
  are verified.

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

if [[ "$SLICE_ID" != "au02-candidate-adoption-bridge" && "$SLICE_ID" != "su01-model-provider-switching" && "$SLICE_ID" != "au05-adoption-safety-freshness" && "$SLICE_ID" != "au05-stale-conflict-cross-work-freshness" && "$SLICE_ID" != "au05-conflict-cross-work-recovery" && "$SLICE_ID" != "au05-canon-conflict-recovery" && "$SLICE_ID" != "p1-chapter-plan-minimum" && "$SLICE_ID" != "p1-chapter-draft-generation" && "$SLICE_ID" != "p1-chapter-adoption-reading" && "$SLICE_ID" != "p1-word-count-audit" && "$SLICE_ID" != "p1-chapter-edit-then-accept" && "$SLICE_ID" != "p1-chapter-overwrite-confirm" && "$SLICE_ID" != "p1-chapter-expansion" && "$SLICE_ID" != "p1-chapter-expansion-multichapter" && "$SLICE_ID" != "p1-chapter-word-count-target" && "$SLICE_ID" != "p1-export-minimum" && "$SLICE_ID" != "p1-plan-incremental" && "$SLICE_ID" != "au04-confirm-before-execute" && "$SLICE_ID" != "vs00c-cp0-missing-chapter-block" && "$SLICE_ID" != "vs00c-cp3-structured-context" && "$SLICE_ID" != "vs00c-cp4-chapter-plan-structure" && "$SLICE_ID" != "au09-memory-create-recall" && "$SLICE_ID" != "au09-adopt-setting-recall" && "$SLICE_ID" != "au09-validity-window-recall" && "$SLICE_ID" != "au03-long-session-compression" && "$SLICE_ID" != "au03-context-source-ui" && "$SLICE_ID" != "au10-workbench-matrix-layout" && "$SLICE_ID" != "desktop-stage-process-ownership" ]]; then
  echo "Unknown native Tauri slice verification id: $SLICE_ID" >&2
  usage >&2
  exit 64
fi

if [[ "$SLICE_VERIFY_PROVIDER" != "slice_verify" && "$SLICE_VERIFY_PROVIDER" != "lmstudio" ]]; then
  echo "Unsupported slice verify provider: $SLICE_VERIFY_PROVIDER" >&2
  exit 64
fi

if [[ "$SLICE_ID" == "desktop-stage-process-ownership" ]]; then
  bash "$PROJECT_ROOT/scripts/verify_stage_process_ownership.sh"
  exit 0
fi

if [[ "$SLICE_ID" != "au02-candidate-adoption-bridge" && "$SLICE_ID" != "su01-model-provider-switching" && "$SLICE_ID" != "au05-adoption-safety-freshness" && "$SLICE_ID" != "au05-stale-conflict-cross-work-freshness" && "$SLICE_ID" != "au05-conflict-cross-work-recovery" && "$SLICE_ID" != "au05-canon-conflict-recovery" && "$SLICE_ID" != "p1-chapter-plan-minimum" && "$SLICE_ID" != "p1-chapter-draft-generation" && "$SLICE_ID" != "p1-chapter-adoption-reading" && "$SLICE_ID" != "p1-word-count-audit" && "$SLICE_ID" != "p1-chapter-edit-then-accept" && "$SLICE_ID" != "p1-chapter-overwrite-confirm" && "$SLICE_ID" != "p1-chapter-expansion" && "$SLICE_ID" != "p1-chapter-expansion-multichapter" && "$SLICE_ID" != "p1-chapter-word-count-target" && "$SLICE_ID" != "p1-export-minimum" && "$SLICE_ID" != "p1-plan-incremental" && "$SLICE_ID" != "au04-confirm-before-execute" && "$SLICE_ID" != "vs00c-cp0-missing-chapter-block" && "$SLICE_ID" != "vs00c-cp3-structured-context" && "$SLICE_ID" != "vs00c-cp4-chapter-plan-structure" && "$SLICE_ID" != "au09-memory-create-recall" && "$SLICE_ID" != "au09-adopt-setting-recall" && "$SLICE_ID" != "au09-validity-window-recall" && "$SLICE_ID" != "au03-long-session-compression" && "$SLICE_ID" != "au03-context-source-ui" && "$SLICE_ID" != "au10-workbench-matrix-layout" ]]; then
  echo "No external UI driver is implemented for: $SLICE_ID" >&2
  echo "Add a Playwright driver in frontend/slice-verify/external-ui-driver.mjs; do not add product-code autorun hooks." >&2
  exit 65
fi

ARTIFACT_SUFFIX="-tauri"
if [[ "$SLICE_VERIFY_PROVIDER" == "lmstudio" ]]; then
  ARTIFACT_SUFFIX="-tauri-lmstudio"
fi

ARTIFACT_DIR="$PROJECT_ROOT/artifacts/slice-verify/${SLICE_ID}${ARTIFACT_SUFFIX}"
APP_LOG_DIR="$ARTIFACT_DIR/app-log"
LLM_LOG_DIR="$ARTIFACT_DIR/llm-calls"
TAURI_SLICE_HOME="$ARTIFACT_DIR/tauri-home"
rm -rf "$ARTIFACT_DIR"
mkdir -p "$APP_LOG_DIR" "$LLM_LOG_DIR" "$TAURI_SLICE_HOME"

PHX_PID=""
TAURI_PID=""
TAURI_CONF="$PROJECT_ROOT/frontend/src-tauri/tauri.conf.json"
TAURI_CONF_BACKUP=""

restore_tauri_conf() {
  if [[ -n "$TAURI_CONF_BACKUP" && -f "$TAURI_CONF_BACKUP" ]]; then
    cp "$TAURI_CONF_BACKUP" "$TAURI_CONF" 2>/dev/null || true
    rm -f "$TAURI_CONF_BACKUP" 2>/dev/null || true
  fi
}

sync_tauri_conf() {
  local vite_port="$1"
  local phoenix_port="$2"

  TAURI_DEV_URL="http://127.0.0.1:${vite_port}" \
  TAURI_CONNECT_SRC="http://localhost:${phoenix_port} http://127.0.0.1:${phoenix_port} ws://localhost:${phoenix_port} ws://127.0.0.1:${phoenix_port}" \
  TAURI_BEFORE_DEV_COMMAND="bash ${PROJECT_ROOT}/scripts/before-tauri-dev.sh" \
    perl -0pi -e 's#"devUrl":\s*"http://(?:localhost|127\.0\.0\.1):[0-9]+"#"devUrl": "$ENV{TAURI_DEV_URL}"#g; s#connect-src '\''self'\''[^"]*"#connect-src '\''self'\'' $ENV{TAURI_CONNECT_SRC}"#g; s#"beforeDevCommand":\s*"[^"]+"#"beforeDevCommand": "$ENV{TAURI_BEFORE_DEV_COMMAND}"#g' "$TAURI_CONF"
}

reset_test_db() {
  cd "$PROJECT_ROOT"
  MIX_ENV=test mix ecto.drop --quiet >/dev/null 2>&1 || true
  MIX_ENV=test mix ecto.create --quiet >/dev/null 2>&1 || true
  MIX_ENV=test mix ecto.migrate --quiet >/dev/null
}

cleanup() {
  # 整棵进程树回收：pnpm tauri dev 之下的 vite node、cargo、target/debug/app
  # 与 mix 之下的 beam.smp 必须一并终止，否则会留下孤儿 Tauri 窗口/端口。
  kill_process_tree "$TAURI_PID"
  wait "$TAURI_PID" 2>/dev/null || true
  kill_process_tree "$PHX_PID"
  wait "$PHX_PID" 2>/dev/null || true
  restore_tauri_conf
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
    su01-model-provider-switching)
      echo "open model settings from real workbench -> select Stub provider -> test connection -> save -> send the next message -> verify provider_gateway routed that turn through stub without losing the dialogue"
      ;;
    au02-candidate-adoption-bridge)
      echo "send fuzzy creative input -> click visible candidate continuation -> click authorized candidate adoption -> verify adoption boundary decision"
      ;;
    au05-stale-conflict-cross-work-freshness)
      echo "seed restored stale candidate -> click visible authorized adoption -> verify adoption boundary rejects without production write"
      ;;
    au05-conflict-cross-work-recovery)
      echo "seed cross-work candidate -> click visible authorized adoption -> verify adoption boundary fails with recovery without production write"
      ;;
    au05-canon-conflict-recovery)
      echo "seed canon-conflict candidate -> click visible authorized adoption -> verify adoption boundary fails with recovery without production write"
      ;;
    p1-chapter-plan-minimum)
      echo "open real archive outline -> click start planning -> generate 12 chapter plan -> adopt -> reopen archive outline and verify adopted chapter plan"
      ;;
    p1-chapter-draft-generation)
      echo "seed adopted chapter plan -> open real archive outline -> click generate draft for chapter 1 -> verify tentative prose draft and empty reading mode"
      ;;
    p1-chapter-adoption-reading)
      echo "seed adopted chapter plan -> generate chapter 1 prose draft -> click accept -> open reading mode -> verify chapter prose and effective word counts (book total + chapter) match the visible adopted prose"
      ;;
    p1-word-count-audit)
      echo "seed adopted chapter plan -> generate and adopt a sub-1000-word chapter -> open reading mode -> verify the chapter is marked 短章 and the P1 milestone progress shows not-met"
      ;;
    p1-chapter-word-count-target)
      echo "seed adopted chapter plan -> type a chapter-1 prose request with an explicit target length -> planner recognizes target_word_count -> generate + adopt -> reading mode shows chapter effective word count close to the requested target"
      ;;
    au04-confirm-before-execute)
      echo "seed adopted chapter plan -> type a high-risk rewrite request in chat -> confirmation card arrives over the real wire (no tool call, no production write) -> click confirm -> ConfirmationBinding re-gate allows -> prose_writing produces a tentative draft pending adoption"
      ;;
    au10-workbench-matrix-layout)
      echo "seed adopted chapter plan -> launch real workbench at 1280x800 -> verify top/status/input/rail layout -> send ordinary message and open why -> drive candidate authorized action -> save prose draft -> read adopted projection"
      ;;
    vs00c-cp0-missing-chapter-block)
      echo "seed adopted chapter plan (has chapter 1, no chapter 99) -> type a natural-language continuation request for a non-existent chapter -> planner names the chapter but cannot match it -> WritingCoordinate + MissingPolicyResult block before tool dispatch -> honest 'chapter not found' reply with no provider call and no creative card"
      ;;
    vs00c-cp3-structured-context)
      echo "seed adopted chapter plan -> open real archive outline -> click generate draft for chapter 2 -> verify structured chapter plan context (target summary + previous/next position) reaches prose_writing before provider call"
      ;;
    vs00c-cp4-chapter-plan-structure)
      echo "open real archive outline -> generate structured chapter plan -> adopt -> click generated chapter draft -> verify E18-E22 plan_direction materializes and reaches prose_writing before provider call"
      ;;
    p1-export-minimum)
      echo "seed adopted chapter plan -> generate + adopt chapter 1 prose -> reading mode -> click export -> backend assembles full markdown from accepted work facts and writes the file -> driver reads the real exported file and verifies ordered toc, adopted prose and honest placeholders"
      ;;
    p1-plan-incremental)
      echo "seed adopted 12-chapter plan -> type a natural-language request to continue planning -> outline_draft with continuing chapter numbers -> adopt -> toc appends new planned chapters in seq order without touching existing chapters"
      ;;
    p1-chapter-edit-then-accept)
      echo "seed adopted chapter plan -> generate chapter 1 prose draft -> click edit-then-accept -> rewrite prose in dialog -> adopt edited -> open reading mode -> verify edited prose shown and word count equals edited text"
      ;;
    p1-chapter-overwrite-confirm)
      echo "seed adopted chapter plan -> adopt chapter 1 prose -> re-generate + adopt same chapter -> overwrite requires confirmation -> click confirm -> re-gate adopts in place -> reading mode shows single chapter (no duplicate)"
      ;;
    p1-chapter-expansion)
      echo "seed adopted chapter plan -> generate + adopt chapter 1 (short) -> natural-language multi-turn continuation (AI recognizes continuation intent + target chapter) -> each continuation appends a new scene -> reading mode shows single chapter accumulating past 1000 words (短章 -> 达标)"
      ;;
    p1-chapter-expansion-multichapter)
      echo "seed adopted chapter plan -> type natural-language draft requests for chapters 1/2/3 in turn -> each chapter's prose files into its own planned chapter (no cross-chapter contamination) -> reading mode TOC shows full plan with chapters 1/2/3 written in order"
      ;;
    au09-memory-create-recall)
      echo "open memory page from real workbench -> create + confirm a governed memory -> back to workbench -> send a related message -> memory recalled into context/prompt -> why panel shows the confirmed memory as an author-safe source"
      ;;
    au09-adopt-setting-recall)
      echo "generate an AI setting (world_setting) from the archive -> adopt it into a confirmed recallable governed memory -> send a related message -> setting recalled into context/prompt -> why panel shows it as an author-safe source"
      ;;
    au09-validity-window-recall)
      echo "seed current position=chapter 5 + an out-of-window memory (ch1-2) + an unwindowed memory -> send a message matching both -> only the in-window memory recalls -> why panel shows the in-window source and excludes the out-of-window one"
      ;;
    au03-context-source-ui)
      echo "seed work/session/memory context -> send real workbench turn -> open why panel -> verify author-safe source summaries"
      ;;
    *)
      echo "seed long active session -> send real workbench turn -> verify prompt uses early summary plus latest transcript window"
      ;;
  esac
}

drive_external_ui() {
  cd "$PROJECT_ROOT/frontend"
  SLICE_VERIFY_BASE_URL="http://127.0.0.1:${VITE_PORT}" \
    SLICE_VERIFY_ARTIFACT_DIR="$ARTIFACT_DIR" \
    node slice-verify/external-ui-driver.mjs "$SLICE_ID"
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
const localDate = new Date();
const today = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
const jsonlPath = path.join(appLogDir, `${today}.jsonl`);

if (!fs.existsSync(jsonlPath)) {
  process.exit(1);
}

const records = fs
  .readFileSync(jsonlPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const uiStatePath = path.join(artifactDir, "ui-state.json");
if (fs.existsSync(uiStatePath)) {
  const uiRecords = JSON.parse(fs.readFileSync(uiStatePath, "utf8"));
  if (Array.isArray(uiRecords)) records.push(...uiRecords);
}

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
const localDate = new Date();
const today = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
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
echo "[tauri-slice-verify] isolated Tauri home: $TAURI_SLICE_HOME"

cd "$PROJECT_ROOT"
reset_test_db
TAURI_CONF_BACKUP="$(mktemp -t ai-novel-tauri-slice-conf.XXXXXX)"
cp "$TAURI_CONF" "$TAURI_CONF_BACKUP"
sync_tauri_conf "$VITE_PORT" "$PHOENIX_PORT"

case "$SLICE_ID" in
  au03-context-source-ui)
    SEED_SCRIPT="scripts/seed_au03_context_source_ui.exs"
    ;;
  au05-stale-conflict-cross-work-freshness)
    SEED_SCRIPT="scripts/seed_au05_stale_conflict_cross_work_freshness.exs"
    ;;
  au05-conflict-cross-work-recovery)
    SEED_SCRIPT="scripts/seed_au05_conflict_cross_work_recovery.exs"
    ;;
  au05-canon-conflict-recovery)
    SEED_SCRIPT="scripts/seed_au05_canon_conflict_recovery.exs"
    ;;
  p1-chapter-draft-generation)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-chapter-adoption-reading)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-word-count-audit)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-chapter-edit-then-accept)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-chapter-overwrite-confirm)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-chapter-expansion)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-chapter-expansion-multichapter)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-chapter-word-count-target)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au04-confirm-before-execute)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au10-workbench-matrix-layout)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  vs00c-cp0-missing-chapter-block)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  vs00c-cp3-structured-context)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-export-minimum)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-plan-incremental)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-memory-create-recall)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-adopt-setting-recall)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-validity-window-recall)
    SEED_SCRIPT="scripts/seed_au09_validity_window.exs"
    ;;
  *)
    SEED_SCRIPT="scripts/seed_au03_long_session_compression.exs"
    ;;
esac

MIX_ENV=test mix run "$SEED_SCRIPT" >"$ARTIFACT_DIR/seed.log" 2>&1

MIX_ENV=test \
  PHOENIX_TEST_PORT="$PHOENIX_PORT" \
  PHOENIX_PORT="$PHOENIX_PORT" \
  SLICE_VERIFY_APP_LOG_DIR="$APP_LOG_DIR" \
  SLICE_VERIFY_LLM_LOG_DIR="$LLM_LOG_DIR" \
  SLICE_VERIFY_PROVIDER="$SLICE_VERIFY_PROVIDER" \
  AI_NOVEL_DESKTOP_PROFILE="slice-verify" \
  mix run --no-start --no-halt scripts/slice_verify_server.exs >"$ARTIFACT_DIR/backend.log" 2>&1 &
PHX_PID=$!
wait_for_url "$API_URL/health" "Phoenix"

cd "$PROJECT_ROOT/frontend"
HOME="$TAURI_SLICE_HOME" \
AI_NOVEL_DESKTOP_PROFILE="slice-verify" \
CARGO_HOME="${CARGO_HOME:-${ORIGINAL_HOME}/.cargo}" \
RUSTUP_HOME="${RUSTUP_HOME:-${ORIGINAL_HOME}/.rustup}" \
VITE_API_ENDPOINT="" \
  VITE_PROXY_TARGET="$API_URL" \
  VITE_WS_ENDPOINT="$VITE_WS_URL" \
  VITE_DEV_PORT="$VITE_PORT" \
  pnpm tauri dev >"$ARTIFACT_DIR/tauri.log" 2>&1 &
TAURI_PID=$!

wait_for_tauri_dev_app "$ARTIFACT_DIR/tauri.log" 120
wait_for_url "http://127.0.0.1:${VITE_PORT}" "Vite"

cat <<EOF
[tauri-slice-verify] Native window is starting.
[tauri-slice-verify] External UI driver is driving:
[tauri-slice-verify]   $(native_action_description)
[tauri-slice-verify] Polling up to ${TAURI_WAIT_SECONDS}s for correlated app JSONL evidence...
EOF

drive_external_ui

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
