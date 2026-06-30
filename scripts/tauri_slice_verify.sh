#!/usr/bin/env bash
#
# Native Tauri slice verification entrypoint.
#
# Usage:
#   bash scripts/tauri_slice_verify.sh --list
#   bash scripts/tauri_slice_verify.sh au03-long-session-compression
#   bash scripts/tauri_slice_verify.sh au03-context-source-ui
#   bash scripts/tauri_slice_verify.sh su01-model-provider-switching
#   bash scripts/tauri_slice_verify.sh au02-candidate-continuation
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
  su01-provider-health-model
  su01-lmstudio-disconnected-health
  su01-provider-endpoint-validation
  su01-provider-model-list-success
  su01-provider-test-failure-ui
  su01-api-key-secret-redaction
  su01-provider-vendor-matrix
  su01-local-secret-file-roundtrip
  au02-candidate-continuation
  au02-natural-exploration-no-slot-form
  au02-candidate-fallback-ui
  au02-candidate-multiturn-context
  au02-freeform-followup-after-candidate
  au02-unadopted-candidate-no-reading-fact
  au02-candidate-adoption-bridge
  su01-model-provider-switching
  su02-work-switching
  su02-artifact-projection-trace-isolation
  su02-empty-start-unnamed-work
  su02-pending-result-work-isolation
  su02-work-lifecycle-management
  su02-work-restart-recovery
  su03-assistant-display-name
  au01-ordinary-chat-two-turn-roundtrip
  au01-empty-message-guard
  au01-garbage-json-recovery
  au01-frame-validation-friendly-error
  au01-turnresult-recorder-ui-consistency
  au05-adoption-safety-freshness
  au05-stale-conflict-cross-work-freshness
  au05-conflict-cross-work-recovery
  au05-canon-conflict-recovery
  au05-discard-author-action
  p1-chapter-plan-minimum
  p1-chapter-draft-generation
  p1-prose-execution-brief
  p1-prose-revision-candidate
  p1-prose-quality-finding-roundtrip
  p1-prose-quality-evaluator-degrade
  p1-prose-quality-adoption-boundary
  agent-prose-drafting-with-quality
  agent-conversation-turn
  agent-plot-outline-with-context
  agent-character-evolution-with-context
  ua01-agent-bounded-roster-to-character-design
  agent-bounded-roster-to-character-design
  agent-step-regate
  agent-no-multistep-plan-bypass
  agent-event-author-safe
  agent-channel-fast-ack
  agent-interrupt-safe-point
  agent-cancel-target-binding
  agent-steer-replan
  agent-natural-language-steer
  agent-loop-budget-limit
  agent-no-progress-stop
  agent-archive-read-during-run
  agent-tentative-boundary
  agent-revision-orchestrator-boundary
  agent-replay-no-provider
  agent-work-isolation
  agent-provider-call-budget
  agent-durable-resume-long-run-task
  agent-provider-execution-stream-unified
  agent-provider-execution-activity-restored
  agent-provider-execution-error-author-safe
  agent-provider-streaming-progress
  agent-provider-cancel-honest-boundary
  agent-readonly-batch-profile
  p1-chapter-adoption-reading
  p1-word-count-audit
  p1-chapter-edit-then-accept
  p1-chapter-overwrite-confirm
  p1-chapter-expansion
  p1-chapter-expansion-multichapter
  p1-chapter-word-count-target
  p1-export-minimum
  au08-reading-readonly-no-write
  au08-reading-return-context
  p1-plan-incremental
  au04-confirm-before-execute
  au04-confirmation-tool-failure-recovery
  au04-confirm-idempotency-ui
  au04-stale-confirmation-ui
  au06-single-active-confirmation
  au04-confirmation-ttl-ui
  au04-disabled-confirmation-action-ui
  au04-history-confirmation-readonly
  au04-cross-work-confirmation-guard
  au04-latest-context-rebase-confirmation
  vs00c-cp0-missing-chapter-block
  vs00c-cp3-structured-context
  vs00c-cp4-chapter-plan-structure
  vs00c-cp5-reader-effect-brief
  au09-memory-create-recall
  au09-archive-stats-current
  au09-memory-management-entry
  au09-memory-management-filter-matrix
  au09-memory-list-ux-redesign
  au09-memory-trace-roundtrip
  au09-adopt-setting-recall
  au09-memory-taxonomy-write-policy
  au09-character-dossier-roundtrip
  au09-character-role-taxonomy-protagonist-policy
  au09-character-candidate-per-item-adoption
  au09-validity-window-recall
  au09-cross-work-memory-isolation
  au09-au03-session-memory-layering
  au03-session-history-readonly
  au03-session-new-active
  au03-branch-from-history
  au03-archive-session-filter
  au03-current-work-context-ssot
  au11-quality-diagnosis-message-envelope
  au11-missing-workstate-policy
  au03-long-session-compression
  au03-context-source-ui
  au07-trace-why-entry
  au07-gate-reason-why
  au07-persisted-trace-query
  au07-partial-replay-ui
  au07-trace-query-scope-negative-matrix
  au07-tooltrace-registry-redacted-io
  au07-state-trace-adoption-replay
  au07-behavior-trace-terminal-replay
  au10-workbench-matrix-layout
  au10-workbench-recovery-taskstate
  au10-workbench-recovery-disconnect-timeout
  au10-workbench-recovery-provider-timeout
  au10-workbench-recovery-reconnect
  au10-workbench-recovery-cancel-waiting
  e2e-01-downgrade-real-page
  e2e-01-readonly-tool-trace
  e2e-01-replay-report
  e2e-01-channel-action-security
  au12-work-profile-overview
  au12-profile-read-failure-degrade
  au12-correction-intent-roundtrip
  au12-archive-concurrent-model-run-read-snapshot
  au12-work-profile-status-isolation
  desktop-stage-process-ownership

Native capability probes:
  su01-keychain-webview-capability

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

is_ua01_acceptance_alias() {
  case "$1" in
    agent-bounded-roster-to-character-design | \
      agent-step-regate | \
      agent-no-multistep-plan-bypass | \
      agent-event-author-safe | \
      agent-channel-fast-ack | \
      agent-interrupt-safe-point | \
      agent-cancel-target-binding | \
      agent-steer-replan | \
      agent-natural-language-steer | \
      agent-loop-budget-limit | \
      agent-no-progress-stop | \
      agent-archive-read-during-run | \
      agent-tentative-boundary | \
      agent-revision-orchestrator-boundary | \
      agent-replay-no-provider | \
      agent-work-isolation | \
      agent-provider-call-budget | \
      agent-durable-resume-long-run-task | \
      agent-provider-execution-stream-unified | \
      agent-provider-execution-activity-restored | \
      agent-provider-execution-error-author-safe | \
      agent-provider-streaming-progress | \
      agent-provider-cancel-honest-boundary | \
      agent-readonly-batch-profile | \
      agent-conversation-turn | \
      agent-plot-outline-with-context | \
      agent-character-evolution-with-context)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if [[ -z "$SLICE_ID" || "$SLICE_ID" == "-h" || "$SLICE_ID" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$SLICE_ID" == "--list" ]]; then
  usage
  exit 0
fi

if [[ "$SLICE_ID" != "au05-discard-author-action" && "$SLICE_ID" != "au06-single-active-confirmation" && "$SLICE_ID" != "au07-trace-why-entry" && "$SLICE_ID" != "au07-gate-reason-why" && "$SLICE_ID" != "au07-persisted-trace-query" && "$SLICE_ID" != "au07-partial-replay-ui" && "$SLICE_ID" != "au07-trace-query-scope-negative-matrix" && "$SLICE_ID" != "au07-tooltrace-registry-redacted-io" && "$SLICE_ID" != "au07-state-trace-adoption-replay" && "$SLICE_ID" != "au07-behavior-trace-terminal-replay" ]]; then
if [[ "$SLICE_ID" != "su01-provider-health-model" && "$SLICE_ID" != "su01-lmstudio-disconnected-health" && "$SLICE_ID" != "su01-provider-endpoint-validation" && "$SLICE_ID" != "su01-provider-model-list-success" && "$SLICE_ID" != "su01-provider-test-failure-ui" && "$SLICE_ID" != "su01-api-key-secret-redaction" && "$SLICE_ID" != "su01-provider-vendor-matrix" && "$SLICE_ID" != "su01-local-secret-file-roundtrip" && "$SLICE_ID" != "su01-keychain-webview-capability" && "$SLICE_ID" != "au02-candidate-continuation" && "$SLICE_ID" != "au02-natural-exploration-no-slot-form" && "$SLICE_ID" != "au02-candidate-fallback-ui" && "$SLICE_ID" != "au02-candidate-multiturn-context" && "$SLICE_ID" != "au02-freeform-followup-after-candidate" && "$SLICE_ID" != "au02-unadopted-candidate-no-reading-fact" && "$SLICE_ID" != "au02-candidate-adoption-bridge" && "$SLICE_ID" != "su01-model-provider-switching" && "$SLICE_ID" != "su02-work-switching" && "$SLICE_ID" != "su02-artifact-projection-trace-isolation" && "$SLICE_ID" != "su02-empty-start-unnamed-work" && "$SLICE_ID" != "su02-pending-result-work-isolation" && "$SLICE_ID" != "su02-work-lifecycle-management" && "$SLICE_ID" != "su02-work-restart-recovery" && "$SLICE_ID" != "su03-assistant-display-name" && "$SLICE_ID" != "au01-ordinary-chat-two-turn-roundtrip" && "$SLICE_ID" != "au01-empty-message-guard" && "$SLICE_ID" != "au01-garbage-json-recovery" && "$SLICE_ID" != "au01-frame-validation-friendly-error" && "$SLICE_ID" != "au01-turnresult-recorder-ui-consistency" && "$SLICE_ID" != "au05-adoption-safety-freshness" && "$SLICE_ID" != "au05-stale-conflict-cross-work-freshness" && "$SLICE_ID" != "au05-conflict-cross-work-recovery" && "$SLICE_ID" != "au05-canon-conflict-recovery" && "$SLICE_ID" != "p1-chapter-plan-minimum" && "$SLICE_ID" != "p1-chapter-draft-generation" && "$SLICE_ID" != "p1-chapter-adoption-reading" && "$SLICE_ID" != "p1-word-count-audit" && "$SLICE_ID" != "p1-chapter-edit-then-accept" && "$SLICE_ID" != "p1-chapter-overwrite-confirm" && "$SLICE_ID" != "p1-chapter-expansion" && "$SLICE_ID" != "p1-chapter-expansion-multichapter" && "$SLICE_ID" != "p1-chapter-word-count-target" && "$SLICE_ID" != "p1-export-minimum" && "$SLICE_ID" != "au08-reading-readonly-no-write" && "$SLICE_ID" != "au08-reading-return-context" && "$SLICE_ID" != "p1-plan-incremental" && "$SLICE_ID" != "au04-confirm-before-execute" && "$SLICE_ID" != "au04-confirmation-tool-failure-recovery" && "$SLICE_ID" != "au04-confirm-idempotency-ui" && "$SLICE_ID" != "au04-stale-confirmation-ui" && "$SLICE_ID" != "au04-confirmation-ttl-ui" && "$SLICE_ID" != "au04-disabled-confirmation-action-ui" && "$SLICE_ID" != "au04-history-confirmation-readonly" && "$SLICE_ID" != "au04-cross-work-confirmation-guard" && "$SLICE_ID" != "au04-latest-context-rebase-confirmation" && "$SLICE_ID" != "vs00c-cp0-missing-chapter-block" && "$SLICE_ID" != "vs00c-cp3-structured-context" && "$SLICE_ID" != "vs00c-cp4-chapter-plan-structure" && "$SLICE_ID" != "vs00c-cp5-reader-effect-brief" && "$SLICE_ID" != "au09-memory-create-recall" && "$SLICE_ID" != "au09-archive-stats-current" && "$SLICE_ID" != "au09-memory-management-entry" && "$SLICE_ID" != "au09-memory-management-filter-matrix" && "$SLICE_ID" != "au09-memory-list-ux-redesign" && "$SLICE_ID" != "au09-memory-trace-roundtrip" && "$SLICE_ID" != "au09-adopt-setting-recall" && "$SLICE_ID" != "au09-memory-taxonomy-write-policy" && "$SLICE_ID" != "au09-character-dossier-roundtrip" && "$SLICE_ID" != "au09-character-role-taxonomy-protagonist-policy" && "$SLICE_ID" != "au09-character-candidate-per-item-adoption" && "$SLICE_ID" != "au09-validity-window-recall" && "$SLICE_ID" != "au09-cross-work-memory-isolation" && "$SLICE_ID" != "au09-au03-session-memory-layering" && "$SLICE_ID" != "au03-session-history-readonly" && "$SLICE_ID" != "au03-session-new-active" && "$SLICE_ID" != "au03-branch-from-history" && "$SLICE_ID" != "au03-archive-session-filter" && "$SLICE_ID" != "au03-current-work-context-ssot" && "$SLICE_ID" != "au11-quality-diagnosis-message-envelope" && "$SLICE_ID" != "au11-missing-workstate-policy" && "$SLICE_ID" != "au03-long-session-compression" && "$SLICE_ID" != "au03-context-source-ui" && "$SLICE_ID" != "au10-workbench-matrix-layout" && "$SLICE_ID" != "au10-workbench-recovery-taskstate" && "$SLICE_ID" != "au10-workbench-recovery-disconnect-timeout" && "$SLICE_ID" != "au10-workbench-recovery-provider-timeout" && "$SLICE_ID" != "au10-workbench-recovery-reconnect" && "$SLICE_ID" != "au10-workbench-recovery-cancel-waiting" && "$SLICE_ID" != "e2e-01-downgrade-real-page" && "$SLICE_ID" != "e2e-01-readonly-tool-trace" && "$SLICE_ID" != "e2e-01-replay-report" && "$SLICE_ID" != "e2e-01-channel-action-security" && "$SLICE_ID" != "au12-work-profile-overview" && "$SLICE_ID" != "au12-archive-concurrent-model-run-read-snapshot" && "$SLICE_ID" != "au12-profile-read-failure-degrade" && "$SLICE_ID" != "au12-correction-intent-roundtrip" && "$SLICE_ID" != "au12-work-profile-status-isolation" && "$SLICE_ID" != "desktop-stage-process-ownership" && "$SLICE_ID" != "p1-prose-execution-brief" && "$SLICE_ID" != "p1-prose-revision-candidate" && "$SLICE_ID" != "p1-prose-quality-finding-roundtrip" && "$SLICE_ID" != "p1-prose-quality-evaluator-degrade" && "$SLICE_ID" != "p1-prose-quality-adoption-boundary" && "$SLICE_ID" != "agent-prose-drafting-with-quality" && "$SLICE_ID" != "agent-conversation-turn" && "$SLICE_ID" != "ua01-agent-bounded-roster-to-character-design" ]] && ! is_ua01_acceptance_alias "$SLICE_ID"; then
  echo "Unknown native Tauri slice verification id: $SLICE_ID" >&2
  usage >&2
  exit 64
fi
fi
if [[ "$SLICE_VERIFY_PROVIDER" != "slice_verify" && "$SLICE_VERIFY_PROVIDER" != "lmstudio" ]]; then
  echo "Unsupported slice verify provider: $SLICE_VERIFY_PROVIDER" >&2
  exit 64
fi

if [[ "$SLICE_ID" == "desktop-stage-process-ownership" ]]; then
  bash "$PROJECT_ROOT/scripts/verify_stage_process_ownership.sh"
  exit 0
fi

if [[ "$SLICE_ID" != "au05-discard-author-action" && "$SLICE_ID" != "au06-single-active-confirmation" && "$SLICE_ID" != "au07-trace-why-entry" && "$SLICE_ID" != "au07-gate-reason-why" && "$SLICE_ID" != "au07-persisted-trace-query" && "$SLICE_ID" != "au07-partial-replay-ui" && "$SLICE_ID" != "au07-trace-query-scope-negative-matrix" && "$SLICE_ID" != "au07-tooltrace-registry-redacted-io" && "$SLICE_ID" != "au07-state-trace-adoption-replay" && "$SLICE_ID" != "au07-behavior-trace-terminal-replay" ]]; then
if [[ "$SLICE_ID" != "su01-provider-health-model" && "$SLICE_ID" != "su01-lmstudio-disconnected-health" && "$SLICE_ID" != "su01-provider-endpoint-validation" && "$SLICE_ID" != "su01-provider-model-list-success" && "$SLICE_ID" != "su01-provider-test-failure-ui" && "$SLICE_ID" != "su01-api-key-secret-redaction" && "$SLICE_ID" != "su01-provider-vendor-matrix" && "$SLICE_ID" != "su01-local-secret-file-roundtrip" && "$SLICE_ID" != "su01-keychain-webview-capability" && "$SLICE_ID" != "au02-candidate-continuation" && "$SLICE_ID" != "au02-natural-exploration-no-slot-form" && "$SLICE_ID" != "au02-candidate-fallback-ui" && "$SLICE_ID" != "au02-candidate-multiturn-context" && "$SLICE_ID" != "au02-freeform-followup-after-candidate" && "$SLICE_ID" != "au02-unadopted-candidate-no-reading-fact" && "$SLICE_ID" != "au02-candidate-adoption-bridge" && "$SLICE_ID" != "su01-model-provider-switching" && "$SLICE_ID" != "su02-work-switching" && "$SLICE_ID" != "su02-artifact-projection-trace-isolation" && "$SLICE_ID" != "su02-empty-start-unnamed-work" && "$SLICE_ID" != "su02-pending-result-work-isolation" && "$SLICE_ID" != "su02-work-lifecycle-management" && "$SLICE_ID" != "su02-work-restart-recovery" && "$SLICE_ID" != "su03-assistant-display-name" && "$SLICE_ID" != "au01-ordinary-chat-two-turn-roundtrip" && "$SLICE_ID" != "au01-empty-message-guard" && "$SLICE_ID" != "au01-garbage-json-recovery" && "$SLICE_ID" != "au01-frame-validation-friendly-error" && "$SLICE_ID" != "au01-turnresult-recorder-ui-consistency" && "$SLICE_ID" != "au05-adoption-safety-freshness" && "$SLICE_ID" != "au05-stale-conflict-cross-work-freshness" && "$SLICE_ID" != "au05-conflict-cross-work-recovery" && "$SLICE_ID" != "au05-canon-conflict-recovery" && "$SLICE_ID" != "p1-chapter-plan-minimum" && "$SLICE_ID" != "p1-chapter-draft-generation" && "$SLICE_ID" != "p1-chapter-adoption-reading" && "$SLICE_ID" != "p1-word-count-audit" && "$SLICE_ID" != "p1-chapter-edit-then-accept" && "$SLICE_ID" != "p1-chapter-overwrite-confirm" && "$SLICE_ID" != "p1-chapter-expansion" && "$SLICE_ID" != "p1-chapter-expansion-multichapter" && "$SLICE_ID" != "p1-chapter-word-count-target" && "$SLICE_ID" != "p1-export-minimum" && "$SLICE_ID" != "au08-reading-readonly-no-write" && "$SLICE_ID" != "au08-reading-return-context" && "$SLICE_ID" != "p1-plan-incremental" && "$SLICE_ID" != "au04-confirm-before-execute" && "$SLICE_ID" != "au04-confirmation-tool-failure-recovery" && "$SLICE_ID" != "au04-confirm-idempotency-ui" && "$SLICE_ID" != "au04-stale-confirmation-ui" && "$SLICE_ID" != "au04-confirmation-ttl-ui" && "$SLICE_ID" != "au04-disabled-confirmation-action-ui" && "$SLICE_ID" != "au04-history-confirmation-readonly" && "$SLICE_ID" != "au04-cross-work-confirmation-guard" && "$SLICE_ID" != "au04-latest-context-rebase-confirmation" && "$SLICE_ID" != "vs00c-cp0-missing-chapter-block" && "$SLICE_ID" != "vs00c-cp3-structured-context" && "$SLICE_ID" != "vs00c-cp4-chapter-plan-structure" && "$SLICE_ID" != "vs00c-cp5-reader-effect-brief" && "$SLICE_ID" != "au09-memory-create-recall" && "$SLICE_ID" != "au09-archive-stats-current" && "$SLICE_ID" != "au09-memory-management-entry" && "$SLICE_ID" != "au09-memory-management-filter-matrix" && "$SLICE_ID" != "au09-memory-list-ux-redesign" && "$SLICE_ID" != "au09-memory-trace-roundtrip" && "$SLICE_ID" != "au09-adopt-setting-recall" && "$SLICE_ID" != "au09-memory-taxonomy-write-policy" && "$SLICE_ID" != "au09-character-dossier-roundtrip" && "$SLICE_ID" != "au09-character-role-taxonomy-protagonist-policy" && "$SLICE_ID" != "au09-character-candidate-per-item-adoption" && "$SLICE_ID" != "au09-validity-window-recall" && "$SLICE_ID" != "au09-cross-work-memory-isolation" && "$SLICE_ID" != "au09-au03-session-memory-layering" && "$SLICE_ID" != "au03-session-history-readonly" && "$SLICE_ID" != "au03-session-new-active" && "$SLICE_ID" != "au03-branch-from-history" && "$SLICE_ID" != "au03-archive-session-filter" && "$SLICE_ID" != "au03-current-work-context-ssot" && "$SLICE_ID" != "au11-quality-diagnosis-message-envelope" && "$SLICE_ID" != "au11-missing-workstate-policy" && "$SLICE_ID" != "au03-long-session-compression" && "$SLICE_ID" != "au03-context-source-ui" && "$SLICE_ID" != "au10-workbench-matrix-layout" && "$SLICE_ID" != "au10-workbench-recovery-taskstate" && "$SLICE_ID" != "au10-workbench-recovery-disconnect-timeout" && "$SLICE_ID" != "au10-workbench-recovery-provider-timeout" && "$SLICE_ID" != "au10-workbench-recovery-reconnect" && "$SLICE_ID" != "au10-workbench-recovery-cancel-waiting" && "$SLICE_ID" != "e2e-01-downgrade-real-page" && "$SLICE_ID" != "e2e-01-readonly-tool-trace" && "$SLICE_ID" != "e2e-01-replay-report" && "$SLICE_ID" != "e2e-01-channel-action-security" && "$SLICE_ID" != "au12-work-profile-overview" && "$SLICE_ID" != "au12-archive-concurrent-model-run-read-snapshot" && "$SLICE_ID" != "au12-profile-read-failure-degrade" && "$SLICE_ID" != "au12-correction-intent-roundtrip" && "$SLICE_ID" != "au12-work-profile-status-isolation" && "$SLICE_ID" != "p1-prose-execution-brief" && "$SLICE_ID" != "p1-prose-revision-candidate" && "$SLICE_ID" != "p1-prose-quality-finding-roundtrip" && "$SLICE_ID" != "p1-prose-quality-evaluator-degrade" && "$SLICE_ID" != "p1-prose-quality-adoption-boundary" && "$SLICE_ID" != "agent-prose-drafting-with-quality" && "$SLICE_ID" != "ua01-agent-bounded-roster-to-character-design" ]] && ! is_ua01_acceptance_alias "$SLICE_ID"; then
  echo "No external UI driver is implemented for: $SLICE_ID" >&2
  echo "Add a Playwright driver in frontend/slice-verify/external-ui-driver.mjs; do not add product-code autorun hooks." >&2
  exit 65
fi
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

run_capability_command() {
  local label="$1"
  local seconds="$2"
  shift 2

  local stdout_file="$ARTIFACT_DIR/${label}.stdout"
  local stderr_file="$ARTIFACT_DIR/${label}.stderr"
  local status_file="$ARTIFACT_DIR/${label}.exit-code"
  local timeout_file="$ARTIFACT_DIR/${label}.timeout"

  rm -f "$stdout_file" "$stderr_file" "$status_file" "$timeout_file"

  "$@" >"$stdout_file" 2>"$stderr_file" &
  local cmd_pid=$!

  (
    sleep "$seconds"
    if kill -0 "$cmd_pid" 2>/dev/null; then
      echo "timed_out_after_${seconds}s" >"$timeout_file"
      kill "$cmd_pid" 2>/dev/null || true
    fi
  ) &
  local watchdog_pid=$!

  set +e
  wait "$cmd_pid"
  local status=$?
  set -e

  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true

  if [[ -f "$timeout_file" ]]; then
    status=124
  fi

  printf '%s\n' "$status" >"$status_file"
}

run_keychain_webview_capability_probe() {
  echo "[tauri-slice-verify] native capability probe: $SLICE_ID"

  run_capability_command "tauri-cli-version" 5 "$PROJECT_ROOT/frontend/node_modules/.bin/tauri" --version
  run_capability_command "tauri-cli-driver-help" 5 "$PROJECT_ROOT/frontend/node_modules/.bin/tauri" driver --help
  run_capability_command "tauri-driver-version" 5 tauri-driver --version
  run_capability_command "safaridriver-version" 5 safaridriver --version
  run_capability_command "security-cli-help" 5 /usr/bin/security -h
  run_capability_command "system-events-count" 6 osascript -e 'tell application "System Events" to count processes'
  run_capability_command "swift-ax-trusted" 8 env CLANG_MODULE_CACHE_PATH=/private/tmp/ans-keychain-probe-clang swift -e 'import ApplicationServices; print(AXIsProcessTrusted())'

  node --input-type=module - "$ARTIFACT_DIR" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const artifactDir = process.argv[2];

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readExitCode(label) {
  const raw = readText(path.join(artifactDir, `${label}.exit-code`)).trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function command(label, commandLine) {
  const stdout = readText(path.join(artifactDir, `${label}.stdout`));
  const stderr = readText(path.join(artifactDir, `${label}.stderr`));
  const timeout = readText(path.join(artifactDir, `${label}.timeout`)).trim();
  const exitCode = readExitCode(label);

  return {
    command: commandLine,
    exit_code: exitCode,
    timed_out: Boolean(timeout),
    timeout,
    stdout: stdout.trim().slice(0, 2000),
    stderr: stderr.trim().slice(0, 2000),
  };
}

const checks = {
  tauri_cli_version: command("tauri-cli-version", "frontend/node_modules/.bin/tauri --version"),
  tauri_cli_driver_help: command("tauri-cli-driver-help", "frontend/node_modules/.bin/tauri driver --help"),
  tauri_driver_binary: command("tauri-driver-version", "tauri-driver --version"),
  safaridriver: command("safaridriver-version", "safaridriver --version"),
  security_cli: command("security-cli-help", "/usr/bin/security -h"),
  system_events: command("system-events-count", "osascript System Events count processes"),
  swift_ax: command("swift-ax-trusted", "swift AXIsProcessTrusted"),
};

const tauriCliDriverAvailable = checks.tauri_cli_driver_help.exit_code === 0;
const tauriDriverAvailable = checks.tauri_driver_binary.exit_code === 0;
const tauriDriverBinaryFound =
  checks.tauri_driver_binary.exit_code !== 127 &&
  !/command not found|No such file or directory/i.test(
    `${checks.tauri_driver_binary.stdout}\n${checks.tauri_driver_binary.stderr}`,
  );
const tauriDriverPlatformSupported =
  tauriDriverAvailable &&
  !/not supported on this platform/i.test(checks.tauri_driver_binary.stdout);
const systemEventsResponsive = checks.system_events.exit_code === 0;
const swiftAxTrusted = checks.swift_ax.exit_code === 0 && checks.swift_ax.stdout.trim() === "true";
const nativeSystemUiAvailable = systemEventsResponsive && swiftAxTrusted;
const canDriveTauriWebview =
  tauriCliDriverAvailable || tauriDriverPlatformSupported || nativeSystemUiAvailable;

const summary = {
  slice_id: "su01-keychain-webview-capability",
  target_slice_id: "su01-keychain-webview-roundtrip",
  surface: "tauri",
  target_surface: "tauri-native-webview",
  status: canDriveTauriWebview ? "available" : "blocked",
  can_verify_keychain_webview_roundtrip: canDriveTauriWebview,
  product_code_acceptance_hooks_added: false,
  acceptance_evidence: false,
  checked_at: new Date().toISOString(),
  capability_decision: {
    tauri_cli_driver_available: tauriCliDriverAvailable,
    tauri_driver_binary_found: tauriDriverBinaryFound,
    tauri_driver_binary_available: tauriDriverAvailable,
    tauri_driver_platform_supported: tauriDriverPlatformSupported,
    system_events_responsive: systemEventsResponsive,
    swift_ax_trusted: swiftAxTrusted,
    native_system_ui_available: nativeSystemUiAvailable,
    safaridriver_available: checks.safaridriver.exit_code === 0,
    safaridriver_usable_for_tauri_webview: false,
    security_cli_available: checks.security_cli.exit_code === 0,
  },
  blocker_reason: canDriveTauriWebview
    ? null
    : "No approved native WebView automation path is currently available. Browser Playwright can exercise the Vite DOM but cannot prove isTauri=true, @tauri-apps/api/core.invoke, or macOS Keychain write/read from the Tauri WebView. tauri-driver may be installed but is only usable here if it reports platform support; macOS support is not available in tauri-driver 2.0.6.",
  required_next_steps: canDriveTauriWebview
    ? [
        "Add an external native WebView driver that opens the real Tauri window, performs the model settings API key save/read flow, and records Keychain and UI/log redaction evidence without product hooks.",
      ]
    : [
        "Install or enable an approved native driver such as tauri-driver/Appium, or grant a responsive macOS Accessibility/System Events path for this runner.",
        "Then implement su01-keychain-webview-roundtrip as a real Tauri WebView scenario, not as a browser-side Playwright scenario.",
      ],
  checks,
};

fs.writeFileSync(path.join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`[tauri-slice-verify] capability status=${summary.status}`);
console.log(`[tauri-slice-verify] summary=${path.join(artifactDir, "summary.json")}`);
NODE
}

if [[ "$SLICE_ID" == "su01-keychain-webview-capability" ]]; then
  run_keychain_webview_capability_probe
  exit 0
fi

PHX_PID=""
TAURI_PID=""
TAURI_CONF="$PROJECT_ROOT/frontend/src-tauri/tauri.conf.json"
TAURI_CONF_BACKUP=""

restore_tauri_conf() {
  if [[ -n "$TAURI_CONF_BACKUP" && -f "$TAURI_CONF_BACKUP" ]]; then
    cp -p "$TAURI_CONF_BACKUP" "$TAURI_CONF" 2>/dev/null || true
    rm -f "$TAURI_CONF_BACKUP" 2>/dev/null || true
  fi
}

sync_tauri_conf() {
  local vite_port="$1"
  local phoenix_port="$2"
  local tmp_conf

  tmp_conf="$(mktemp -t ai-novel-tauri-slice-conf-sync.XXXXXX)"
  cp -p "$TAURI_CONF" "$tmp_conf"

  TAURI_DEV_URL="http://127.0.0.1:${vite_port}" \
  TAURI_CONNECT_SRC="http://localhost:${phoenix_port} http://127.0.0.1:${phoenix_port} ws://localhost:${phoenix_port} ws://127.0.0.1:${phoenix_port}" \
  TAURI_BEFORE_DEV_COMMAND="bash ${PROJECT_ROOT}/scripts/before-tauri-dev.sh" \
    perl -0pi -e 's#"devUrl":\s*"http://(?:localhost|127\.0\.0\.1):[0-9]+"#"devUrl": "$ENV{TAURI_DEV_URL}"#g; s#connect-src '\''self'\''[^"]*"#connect-src '\''self'\'' $ENV{TAURI_CONNECT_SRC}"#g; s#"beforeDevCommand":\s*"[^"]+"#"beforeDevCommand": "$ENV{TAURI_BEFORE_DEV_COMMAND}"#g' "$tmp_conf"

  if ! cmp -s "$tmp_conf" "$TAURI_CONF"; then
    cp -p "$tmp_conf" "$TAURI_CONF"
  fi
  rm -f "$tmp_conf"
}

reset_test_db() {
  cd "$PROJECT_ROOT"
  MIX_ENV=test mix ecto.drop --quiet >/dev/null 2>&1 || true
  MIX_ENV=test mix ecto.create --quiet >/dev/null 2>&1 || true
  MIX_ENV=test mix ecto.migrate --quiet >/dev/null
}

setup_isolated_macos_keychain() {
  if [[ "$SLICE_ID" != "su01-keychain-webview-roundtrip" ]]; then
    return 0
  fi
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi

  local keychain_dir="$TAURI_SLICE_HOME/Library/Keychains"
  local keychain_path="$keychain_dir/login.keychain-db"
  local log_path="$ARTIFACT_DIR/keychain-setup.log"
  mkdir -p "$keychain_dir"

  {
    echo "[tauri-slice-verify] creating isolated macOS keychain: $keychain_path"
    HOME="$TAURI_SLICE_HOME" security create-keychain -p "" "$keychain_path" 2>/dev/null || true
    HOME="$TAURI_SLICE_HOME" security list-keychains -d user -s "$keychain_path"
    HOME="$TAURI_SLICE_HOME" security default-keychain -d user -s "$keychain_path"
    HOME="$TAURI_SLICE_HOME" security unlock-keychain -p "" "$keychain_path"
    HOME="$TAURI_SLICE_HOME" security set-keychain-settings -lut 21600 "$keychain_path"
  } >"$log_path" 2>&1
}

cleanup() {
  # 整棵进程树回收：pnpm tauri dev 之下的 vite node、cargo、target/debug/app
  # 与 mix 之下的 beam.smp 必须一并终止，否则会留下孤儿 Tauri 窗口/端口。
  kill_process_tree "$TAURI_PID" || true
  wait "$TAURI_PID" 2>/dev/null || true
  kill_process_tree "$PHX_PID" || true
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

start_tauri_app() {
  local log_file="$1"

  cd "$PROJECT_ROOT/frontend"
  HOME="$TAURI_SLICE_HOME" \
  COREPACK_HOME="${COREPACK_HOME:-${ORIGINAL_HOME}/.cache/node/corepack}" \
  AI_NOVEL_DESKTOP_PROFILE="slice-verify" \
  CARGO_HOME="${CARGO_HOME:-${ORIGINAL_HOME}/.cargo}" \
  RUSTUP_HOME="${RUSTUP_HOME:-${ORIGINAL_HOME}/.rustup}" \
  VITE_API_ENDPOINT="" \
    VITE_PROXY_TARGET="$API_URL" \
    VITE_WS_ENDPOINT="$VITE_WS_URL" \
    VITE_DEV_PORT="$VITE_PORT" \
    pnpm tauri dev >"$log_file" 2>&1 &
  TAURI_PID=$!

  wait_for_tauri_dev_app "$log_file" 120
  wait_for_url "http://127.0.0.1:${VITE_PORT}" "Vite"
}

native_action_description() {
  case "$SLICE_ID" in
    su01-provider-health-model)
      echo "launch real workbench -> wait for backend provider health polling -> verify the model/provider badge displays backend health metadata"
      ;;
    su01-lmstudio-disconnected-health)
      echo "configure runtime provider to unreachable LM Studio -> reload real workbench -> verify visible disconnected model badge and author-readable reason"
      ;;
    su01-provider-endpoint-validation)
      echo "open model settings from real workbench -> select LM Studio -> enter an invalid endpoint -> verify visible validation and no provider model request"
      ;;
    su01-provider-model-list-success)
      echo "open model settings from real workbench -> load selectable model lists for DeepSeek, Anthropic, and LM Studio through provider adapter boundaries"
      ;;
    su01-provider-test-failure-ui)
      echo "open model settings from real workbench -> load an LM Studio model -> test an unreachable endpoint -> verify author-readable failure, preserved draft, and successful retry"
      ;;
    su01-api-key-secret-redaction)
      echo "open model settings from real workbench -> select DeepSeek -> enter API key -> load model list through adapter HTTP boundary -> save -> verify provider options, UI, browser settings, business logs, and backend logs do not expose the secret"
      ;;
    su01-provider-vendor-matrix)
      echo "open model settings from real workbench -> verify OpenAI/Minimax/Zhipu/Kimi/Gemini come from the backend registry -> confirm the OpenAI subscription auth hint -> enter a fake OpenAI key -> failing test connection keeps runtime unchanged -> save -> verify provider options redact the secret and distinguish both OpenAI auth methods"
      ;;
    su01-local-secret-file-roundtrip)
      echo "drive the real Tauri WebView with macOS CGEvent -> select DeepSeek -> save a fake API key -> verify provider-secrets.json 0600 storage, restart readback, and redaction without product hooks"
      ;;
    su01-model-provider-switching)
      echo "open model settings from real workbench -> select Stub provider -> test connection -> save -> send the next message -> verify provider_gateway routed that turn through stub without losing the dialogue"
      ;;
    su02-work-switching)
      echo "select a persisted source work -> send a message -> create a second work from the visible work menu -> verify the workbench rejoins the new workspace channel and does not show the previous work message"
      ;;
    su02-artifact-projection-trace-isolation)
      echo "seed an adopted chapter plan -> generate a source-work prose artifact -> switch to a second work -> verify pending artifact, reading projection, and trace/why stay scoped to their work_id"
      ;;
    su02-empty-start-unnamed-work)
      echo "start from an empty Work database -> verify the real workbench creates an unnamed work, keeps its messages through rename, and distinguishes duplicate unnamed works"
      ;;
    su02-pending-result-work-isolation)
      echo "select a persisted source work -> send a deliberately slow message -> switch to a second work before completion -> verify the delayed result does not pollute the target work and is restored when returning to the source"
      ;;
    su02-work-lifecycle-management)
      echo "select a persisted source work -> create a named work from the visible work menu -> rename it -> delete it with confirmation -> verify fallback work and default list filtering"
      ;;
    su02-work-restart-recovery)
      echo "select a persisted work -> reload the workbench and restore it from lastOpened -> make that stored work stale/discarded -> reload again and verify fallback to a real available work"
      ;;
    su03-assistant-display-name)
      echo "select a persisted work -> set AI display name from the real dialog -> create another work -> verify default name there -> switch back and verify the original work-scoped name is restored"
      ;;
    au01-ordinary-chat-two-turn-roundtrip)
      echo "open real workbench -> send two ordinary creative chat messages -> verify visible user/assistant order, thinking clears, no micro-plan, no action/candidate/adoption cards"
      ;;
    au01-empty-message-guard)
      echo "open real workbench -> try to send blank chat input -> verify no user_message frame or visible message is created -> send a valid follow-up chat message successfully"
      ;;
    au01-garbage-json-recovery)
      echo "open real workbench -> trigger malformed provider frame JSON -> verify friendly fallback, no raw payload, input/channel recovery, and a following ordinary chat turn"
      ;;
    au01-frame-validation-friendly-error)
      echo "open real workbench -> trigger provider frame with forbidden execution semantics -> verify friendly fallback, no internal validation reason in UI or turn_result, and a following ordinary chat turn"
      ;;
    au01-turnresult-recorder-ui-consistency)
      echo "open real workbench -> send ordinary chat -> verify websocket turn_result, interaction recorder transcript, and reloaded UI all show the same assistant text"
      ;;
    au02-candidate-continuation)
      echo "send fuzzy creative input -> click visible candidate continuation -> verify user_message carries candidate_selection without adoption or production write"
      ;;
    au02-natural-exploration-no-slot-form)
      echo "send fuzzy creative input -> verify natural creative_exploration reply, candidate panel, no slot form, no MicroPlan, and no execution/adoption write"
      ;;
    au02-candidate-fallback-ui)
      echo "send malformed candidate exploration prompt -> verify Planner fallback candidates render as not_adopted cards without action/adoption/write"
      ;;
    au02-candidate-multiturn-context)
      echo "send nonce candidate prompt -> click candidate continuation -> type a plain follow-up -> verify the reply reflects prior candidate context without action/adoption/write"
      ;;
    au02-freeform-followup-after-candidate)
      echo "send fuzzy creative input -> leave candidate buttons untouched -> type a freeform follow-up -> verify plain user_message without candidate_selection, adoption, or production write"
      ;;
    au02-unadopted-candidate-no-reading-fact)
      echo "send fuzzy creative input -> do not click candidate actions -> open reading mode -> verify empty TOC and candidate text stays out of reading/work facts"
      ;;
    au02-candidate-adoption-bridge)
      echo "send fuzzy creative input -> click authorized candidate adoption -> verify adoption boundary decision without production write"
      ;;
    au05-adoption-safety-freshness)
      echo "send high-risk exploratory candidate request -> click visible authorized adoption -> verify AdoptionBoundary returns needs_confirmation without production write"
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
    au05-discard-author-action)
      echo "seed adopted chapter plan -> generate chapter 1 prose draft -> click visible discard action -> verify author_action discard resolves DISCARDED without reading projection or production write"
      ;;
    p1-chapter-plan-minimum)
      echo "open real archive outline -> click start planning -> generate 12 chapter plan -> adopt -> reopen archive outline and verify adopted chapter plan"
      ;;
    p1-chapter-draft-generation)
      echo "seed adopted chapter plan -> open real archive outline -> click generate draft for chapter 1 -> verify tentative prose draft and empty reading mode"
      ;;
    p1-prose-execution-brief)
      echo "seed chapter plan with structured chapter-2 direction -> open real archive outline -> generate chapter 2 draft -> verify scene execution brief projected (has_plan_direction + prose_execution_brief.built non-degraded with stable brief_ref) entered the prose request/trace, draft stays tentative"
      ;;
    p1-prose-revision-candidate)
      echo "seed chapter plan with an action chapter -> open real archive outline -> generate the action-chapter draft -> verify quality review surfaces a finding + 按这些问题重写 action -> click it -> verify a sibling tentative revision draft is generated (revision_base points at the original), original retained, nothing auto-adopted"
      ;;
    p1-prose-quality-finding-roundtrip)
      echo "seed chapter plan with an action chapter -> open real archive outline -> generate the action-chapter draft -> verify the independent quality review completes and its finding summary is displayed verbatim on the real page, the finding does not leak into the prose body, and the draft stays tentative (finding is not a story fact)"
      ;;
    p1-prose-quality-evaluator-degrade)
      echo "seed chapter plan with a degrade chapter (summary carries a CN degrade marker) -> open real archive outline -> generate that chapter's draft -> verify the independent evaluator fails and the review honestly degrades to unavailable (本次质量复核未完成) without faking a completed/passed verdict or fabricating findings, the marker never leaks into the prose body, and the draft still stays tentative"
      ;;
    p1-prose-quality-adoption-boundary)
      echo "seed chapter plan with an action chapter -> open real archive outline -> generate the draft (finding) -> 按这些问题重写 to get a sibling revision draft -> with both drafts pending, adopt the revision through the real adoption boundary and verify the original is NOT auto-resolved (stays independently tentative, one accept action left): revision and original each traverse their own adoption states"
      ;;
    ua01-agent-bounded-roster-to-character-design)
      echo "send compound author request from the real workbench -> verify bounded AgentRun fast ack, roster observation, re-gated character_design step, author-visible run events, and tentative character_seed without production write"
      ;;
    agent-bounded-roster-to-character-design)
      echo "run the UA-01 bounded roster-to-character-design scene and verify the observation handoff into character_design"
      ;;
    agent-step-regate)
      echo "run the UA-01 bounded scene and verify each AgentStep re-enters ExecutionOrchestrator as allow_tool before Toolbox execution"
      ;;
    agent-no-multistep-plan-bypass)
      echo "run the UA-01 bounded scene and verify the parent AgentRun is not executed as a multi-tool batch"
      ;;
    agent-event-author-safe)
      echo "run the UA-01 bounded scene and verify agent_event payloads expose author-safe summaries/refs only"
      ;;
    agent-channel-fast-ack)
      echo "run the UA-01 bounded scene and verify user_message returns run_id before the final TurnResult"
      ;;
    agent-interrupt-safe-point)
      echo "send a slow bounded AgentRun from the real workbench -> click pause -> verify interrupt_requested and paused state for the same run_id without requesting provider execution cancel"
      ;;
    agent-cancel-target-binding)
      echo "send a slow bounded AgentRun from the real workbench -> click cancel -> verify the command targets the active run_id and requests provider execution cancel"
      ;;
    agent-steer-replan)
      echo "send a slow bounded AgentRun from the real workbench -> submit a visible steer command -> verify plan_adjusted and adjusted run goal state for the same run_id"
      ;;
    agent-natural-language-steer)
      echo "send a slow bounded AgentRun from the real workbench -> submit steering text through the main chat input -> verify it becomes agent_command steer for the active run_id without creating a second user_message or run"
      ;;
    agent-loop-budget-limit)
      echo "send a bounded AgentRun request with an explicit one-step author budget -> verify the run stops awaiting_author at budget_exhausted before character_design"
      ;;
    agent-no-progress-stop)
      echo "send a repeated roster-read AgentRun request -> verify two readonly roster steps then awaiting_author no_progress without provider or character_design call"
      ;;
    agent-archive-read-during-run)
      echo "send a slow bounded AgentRun from the real workbench -> open the work archive before final TurnResult -> verify the archive snapshot remains readable and read-only"
      ;;
    agent-tentative-boundary)
      echo "run the UA-01 bounded scene and verify generated character_seed remains tentative without auto adoption or production write"
      ;;
    agent-revision-orchestrator-boundary)
      echo "run the VS-00E revision candidate scene and verify revise_from_findings re-enters Orchestrator before revision Toolbox execution"
      ;;
    agent-replay-no-provider)
      echo "run the VS-00E revision candidate scene and verify revision replay_policy uses recorded frame with recall_provider=false"
      ;;
    agent-work-isolation)
      echo "send a slow bounded AgentRun from a source work -> switch to a target work before source completion -> verify late source output does not pollute the target UI"
      ;;
    agent-provider-call-budget)
      echo "run the UA-01 bounded scene and verify consumed step/tool/provider call budget counters"
      ;;
    agent-durable-resume-long-run-task)
      echo "send a durable AgentRun request from the real workbench -> checkpoint at one-step budget -> restart Phoenix -> verify recovered run_state carries LongRunTask ref and stale resume does not rerun tools"
      ;;
    agent-provider-streaming-progress)
      echo "send a provider progress AgentRun from the real workbench -> verify author-safe provider execution progress events on the unified runtime"
      ;;
    agent-provider-execution-stream-unified)
      echo "send a plain conversation AgentRun from the real workbench -> verify provider execution facts project into author-safe activity without using the historical provider_progress profile"
      ;;
    agent-provider-execution-activity-restored)
      echo "send a plain conversation AgentRun -> restore the workbench session -> verify persisted provider execution activity remains visible in the same assistant dialogue flow"
      ;;
    agent-provider-execution-error-author-safe)
      echo "send a plain conversation AgentRun that hits a provider error -> verify provider error facts project into author-safe activity and the final TurnResult stays safe"
      ;;
    agent-provider-cancel-honest-boundary)
      echo "send a slow provider progress AgentRun -> click cancel -> verify run_id binding, cancelling state, provider execution cancel request, and terminal cancelled state"
      ;;
    agent-readonly-batch-profile)
      echo "send a readonly batch AgentRun from the real workbench -> verify batch item events, no provider calls, no artifact/adoption, and replay recall_provider=false"
      ;;
    agent-prose-drafting-with-quality)
      echo "seed chapter plan -> send direct prose request from the real workbench -> verify bounded AgentRun fast ack, next-step planning, re-gated prose-quality execution, provider usage UI, and tentative prose_fragment without production write"
      ;;
    agent-conversation-turn)
      echo "send plain conversation input from the real workbench -> verify bounded AgentRun fast ack, conversation_turn_v1 profile, final TurnResult, and no tool/write/adoption"
      ;;
    agent-plot-outline-with-context)
      echo "send a chapter outline request from the real workbench -> verify bounded AgentRun fast ack, plot_outline_with_context_v1 profile, re-gated plot_outline execution, and tentative outline_draft without production write"
      ;;
    agent-character-evolution-with-context)
      echo "create an existing character, then send a character evolution request from the real workbench -> verify bounded AgentRun fast ack, character_evolution_with_context_v1 profile, re-gated character_evolution execution, and tentative character_evolution_seed without production write"
      ;;
    p1-chapter-adoption-reading)
      echo "seed adopted chapter plan -> generate chapter 1 prose draft -> click accept -> open reading mode -> verify chapter prose and effective word counts (book total + chapter) match the visible adopted prose"
      ;;
    au07-state-trace-adoption-replay)
      echo "seed adopted chapter plan -> generate chapter 1 prose draft -> click accept through adoption boundary -> verify adoption/projection carry replayable StateTrace refs"
      ;;
    au07-behavior-trace-terminal-replay)
      echo "seed adopted chapter plan -> request high-risk rewrite -> click visible reject/cancel -> verify cancelled action turn records terminal BehaviorTrace close/resolution refs for replay"
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
    au04-confirmation-tool-failure-recovery)
      echo "seed adopted chapter plan -> type a high-risk rewrite request that makes the test provider fail during confirmed prose_writing -> click confirm -> verify failed TurnResult is visible and no pending draft or production write is created"
      ;;
    au04-confirm-idempotency-ui)
      echo "seed adopted chapter plan -> type a high-risk rewrite request in chat -> confirmation card arrives -> rapidly click confirm twice -> verify duplicate confirm is suppressed or deduped and prose_writing/pending artifact stay single-shot"
      ;;
    au04-stale-confirmation-ui)
      echo "seed adopted chapter plan -> type a high-risk rewrite request in chat -> confirmation card arrives -> send a follow-up message before confirming -> click old confirm if visible -> verify stale confirm cannot dispatch prose_writing or create a pending draft"
      ;;
    au06-single-active-confirmation)
      echo "seed adopted chapter plan -> type two high-risk rewrite requests before confirming -> verify the old confirmation is hidden/disabled/stale and only the latest active confirmation can execute once"
      ;;
    au04-confirmation-ttl-ui)
      echo "seed an expired confirmation turn_result -> restore it in the real workbench -> click visible confirm -> verify expired confirm is rejected without prose_writing or pending draft"
      ;;
    au04-disabled-confirmation-action-ui)
      echo "seed a confirmation turn_result with disabled confirm action -> restore it in the real workbench -> verify confirm is visible but disabled and no author_action/tool/pending draft is produced"
      ;;
    au04-history-confirmation-readonly)
      echo "seed a historical exited session containing a live confirmation turn_result -> open it from the real workbench read-only view -> verify confirmation actions are hidden and no author_action/tool/pending draft is produced"
      ;;
    au04-cross-work-confirmation-guard)
      echo "seed source and target works -> verify source confirmation is visible in source work -> switch to target work through real menu -> verify source confirmation is hidden and no author_action/tool/pending draft is produced -> return to source work"
      ;;
    au04-latest-context-rebase-confirmation)
      echo "seed a restored confirmation turn_result -> select it in the real workbench -> rename the current work through the real work menu -> click confirm -> verify ConfirmationBinding and trace consume the renamed work revision/title"
      ;;
    au10-workbench-matrix-layout)
      echo "seed adopted chapter plan -> launch real workbench at 1280x800 -> verify top/status/input/rail layout -> send ordinary message and open why -> drive candidate authorized action -> save prose draft -> read adopted projection"
      ;;
    au10-workbench-recovery-taskstate)
      echo "seed adopted chapter plan -> generate and adopt prose from real workbench -> click real export button -> verify task_state RUNNING/CHECKPOINT/COMPLETED streams to the workbench status bar"
      ;;
    au10-workbench-recovery-disconnect-timeout)
      echo "configure an unreachable provider through the product provider API -> send a real workbench message -> verify recoverable failure clears loading and the following turn succeeds after provider recovery"
      ;;
    au10-workbench-recovery-provider-timeout)
      echo "start a hanging OpenAI-compatible endpoint -> configure LM Studio runtime to it -> send real workbench message -> verify provider timeout clears loading and following turn succeeds after provider recovery"
      ;;
    au10-workbench-recovery-reconnect)
      echo "stop the slice Phoenix service from the external driver -> verify the real workbench disables input and shows offline -> restart the service -> verify websocket rejoins and a following turn succeeds"
      ;;
    au10-workbench-recovery-cancel-waiting)
      echo "seed adopted chapter plan -> type a high-risk rewrite request -> verify confirmation waiting state -> click visible reject/cancel -> verify cancelled TurnResult closes behavior without writes and a following turn succeeds"
      ;;
    e2e-01-downgrade-real-page)
      echo "seed adopted chapter plan -> open real archive -> click visible new action -> real planner returns a multi-step MicroPlan -> orchestrator downgrades at action_scope with no tool, author_action, adoption, or production write"
      ;;
    e2e-01-readonly-tool-trace)
      echo "seed accepted character dossier -> type a visible read-only character list request -> planner allows character_roster -> toolbox succeeds without writes -> external query proves TraceRepository.list_by_turn contains tool trace refs"
      ;;
    e2e-01-replay-report)
      echo "seed accepted character dossier -> type a visible read-only character list request -> build ReplayReport from persisted trace -> verify no-provider structural replay and VS-06 six required questions"
      ;;
    au07-tooltrace-registry-redacted-io)
      echo "seed accepted character dossier -> type a visible read-only character list request -> verify persisted ToolTrace carries registry snapshot, contract/grant summary, redacted IO summaries, and no-provider ReplayReport chain"
      ;;
    e2e-01-channel-action-security)
      echo "open a real Tauri workbench -> join the same work/session with an external protocol socket -> send forged author_action payloads -> verify server-held turn_result rejects invented and stale actions"
      ;;
    au12-work-profile-overview)
      echo "create a real work with seed profile fields -> open real workbench archive -> click profile overview -> verify work genre/selling point/target reader/tone render from get_work_profile without leaking internal ids"
      ;;
    au12-profile-read-failure-degrade)
      echo "create a real work with seed profile fields -> externally stop the slice Phoenix service -> open real archive overview -> verify honest profile read failure and no-write boundary -> restart service -> click retry -> verify real fields recover"
      ;;
    au12-correction-intent-roundtrip)
      echo "create a real work -> open real archive profile overview -> click visible profile correction action -> verify user_message/MicroPlan/world_building produces pending world_setting adoption without direct write"
      ;;
    au12-work-profile-status-isolation)
      echo "seed accepted and empty works -> switch through the real work menu -> verify profile status, missing fields, archive tab isolation, UUID redaction, and no-write boundary"
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
    vs00c-cp5-reader-effect-brief)
      echo "open real archive outline -> generate structured chapter plan -> adopt -> click generated chapter draft -> verify ReaderEffectBrief and non-authoritative self_report reach prose_writing"
      ;;
    p1-export-minimum)
      echo "seed adopted chapter plan -> generate + adopt chapter 1 prose -> reading mode -> click export -> backend assembles full markdown from accepted work facts and writes the file -> driver reads the real exported file and verifies ordered toc, adopted prose and honest placeholders"
      ;;
    au08-reading-readonly-no-write)
      echo "seed adopted chapter plan -> generate + adopt chapter 1 prose -> enter reading mode -> verify export/return stay readonly with no author_action, adoption, tool execution, user_message, or production write"
      ;;
    au08-reading-return-context)
      echo "seed adopted chapter plan -> generate + adopt chapter 1 prose -> enter reading mode -> return to workbench -> send follow-up and verify same work/session context"
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
    au09-archive-stats-current)
      echo "seed a current work with accepted character, confirmed memories, structure, and drafts -> open real workbench archive -> verify overview stats, foreshadowing detail, rule tab, and foreign-work exclusion from current archive"
      ;;
    au09-memory-management-entry)
      echo "open memory page from real workbench -> create + confirm + lock memory -> locked memory still recalls -> unlock + deprecate it, create + archive another memory -> later related message excludes deprecated/archived memories from context and why"
      ;;
    au09-memory-management-filter-matrix)
      echo "open memory page from real workbench -> create distinct current-work memories -> drive visible keyword/type/scope/status/locked filters -> verify each filter and a combined matrix isolate only the matching rows"
      ;;
    au09-memory-trace-roundtrip)
      echo "open memory page from real workbench -> create + confirm + lock memory -> view lifecycle trace -> recall locked memory -> unlock + deprecate and archive memories -> verify trace explains terminal exclusion and why omits terminal content"
      ;;
    au09-adopt-setting-recall)
      echo "generate an explicit foreshadowing/rule artifact from the archive -> adopt it into confirmed recallable governed memory -> send a related message -> setting recalled into context/prompt -> why panel shows it as an author-safe source"
      ;;
    au09-character-dossier-roundtrip)
      echo "open real archive character tab -> click create character -> generate character_seed -> adopt through the adoption boundary -> reopen character tab and verify the Character dossier is visible -> click create again and verify the next role-design turn receives existing Character context"
      ;;
    au09-character-role-taxonomy-protagonist-policy)
      echo "ask 'who is the protagonist' before any protagonist -> assistant honestly reports a missing protagonist with no write -> design a protagonist character with structured narrative_role and adopt it -> archive character tab shows the 主角 label -> ask 'who is the protagonist' again -> assistant answers the protagonist name, still read-only"
      ;;
    au09-memory-taxonomy-write-policy)
      echo "design a character and adopt it into the Character dossier (writes no memory) -> memory page has no character memory -> update the character's current state and adopt the character_evolution_seed -> a typed character memory (当前状态) is written and shown in the memory page with the input nonce preserved"
      ;;
    au09-memory-list-ux-redesign)
      echo "create memories of different types and confirm one / deprecate another -> the memory list renders on the global light theme with semantic status labels (已确认/已弃用 not raw enums), type labels, per-row recall value, de-emphasized terminal rows, and no overlap"
      ;;
    au09-character-candidate-per-item-adoption)
      echo "design two character candidates in one turn -> each candidate gets its own adopt button -> adopt only the second candidate -> the first candidate keeps its adopt button and never enters the work -> archive character tab shows only the adopted candidate"
      ;;
    au12-archive-concurrent-model-run-read-snapshot)
      echo "load the work archive once -> send a deliberately slow chat turn -> open the archive during model execution -> overview keeps the last-known work profile snapshot (not blank) with an honest loading indicator and no extra user_message/author_action -> archive refreshes after the turn completes"
      ;;
    au09-validity-window-recall)
      echo "seed current position=chapter 5 + an out-of-window memory (ch1-2) + an unwindowed memory -> send a message matching both -> only the in-window memory recalls -> why panel shows the in-window source and excludes the out-of-window one"
      ;;
    au09-cross-work-memory-isolation)
      echo "seed two works with conflicting memory keywords -> switch A then B from the real work menu -> verify B archive/memory page/recall/why only show current-work memories and exclude A"
      ;;
    au09-au03-session-memory-layering)
      echo "seed one work with active session + historical session + confirmed memory -> open history read-only -> return active -> verify context/why separates current work, active session transcript, and governed memory without history leakage"
      ;;
    au03-session-history-readonly)
      echo "search historical session from real workbench -> open read-only transcript -> verify input/send disabled and pending adoption not restored -> return to active session"
      ;;
    au03-session-new-active)
      echo "seed active session -> click new session from real workbench -> verify previous active exits/read-only -> send first new-session turn with empty conversation context"
      ;;
    au03-branch-from-history)
      echo "search historical session from real workbench -> open read-only transcript -> click from-here continue -> verify a new active branch session records source_session_ref/source_turn_ref without copying old transcript"
      ;;
    au03-archive-session-filter)
      echo "search historical session from real workbench -> open read-only transcript -> archive it -> verify default list hides archived session while explicit search can reopen it read-only"
      ;;
    au03-current-work-context-ssot)
      echo "open a historical read-only session, return to active session, send a work-fact question -> verify latest Work snapshot and active session transcript enter prompt without historical transcript leakage"
      ;;
    au11-quality-diagnosis-message-envelope)
      echo "seed work with adopted chapter context -> send a quality diagnosis request from the real workbench -> open why -> verify VS-00D three-layer envelope, concrete tradeoffs, and no tool/adoption/write"
      ;;
    au11-missing-workstate-policy)
      echo "create a real work with no chapter/prose/person state -> send missing-context quality diagnosis from the real workbench -> verify explicit WorkState missing, honest assistant response, why summary, and no tool/adoption/write"
      ;;
    au03-context-source-ui)
      echo "seed work/session/memory context -> send real workbench turn -> open why panel -> verify author-safe source summaries"
      ;;
    au07-trace-why-entry)
      echo "send real workbench discussion turn -> open why panel from the message stream -> verify author-safe trace summary, no provider replay, and no production write"
      ;;
    au07-gate-reason-why)
      echo "seed adopted chapter plan -> open real archive -> click visible multi-step revision action -> verify action_scope downgrade -> open why panel -> verify author-safe gate/reason explanation, no provider replay, and no production write"
      ;;
    au07-persisted-trace-query)
      echo "send real workbench discussion turn -> persist trace -> reload restored old turn -> open why panel -> verify scoped persisted replay query, no provider replay, and no production write"
      ;;
    au07-partial-replay-ui)
      echo "send real workbench discussion turn -> insert an incomplete persisted trace in the same work/session/turn scope from the external harness -> reload restored old turn -> open why panel -> verify partial replay warning, missing refs, no provider replay, and no production write"
      ;;
    au07-trace-query-scope-negative-matrix)
      echo "send real workbench discussion turn -> persist trace -> reload restored old turn -> verify valid replay works and cross-work/cross-session/missing-turn replay API requests return 404 without trace body or UI side effects"
      ;;
    au07-tooltrace-registry-redacted-io)
      echo "seed accepted character dossier -> type a visible read-only character list request -> verify persisted ToolTrace carries registry snapshot, contract/grant summary, redacted IO summaries, and no-provider ReplayReport chain"
      ;;
    *)
      echo "seed long active session -> send real workbench turn -> verify prompt uses early summary plus latest transcript window"
      ;;
  esac
}

drive_external_ui() {
  cd "$PROJECT_ROOT/frontend"
  if [[ "$SLICE_ID" == "su01-local-secret-file-roundtrip" ]]; then
    CLANG_MODULE_CACHE_PATH=/private/tmp/ans-local-secret-file-clang \
      HOME="$TAURI_SLICE_HOME" \
      SLICE_VERIFY_SECRET_FILE_PHASE="save" \
      SLICE_VERIFY_BASE_URL="http://127.0.0.1:${VITE_PORT}" \
      SLICE_VERIFY_API_URL="$API_URL" \
      SLICE_VERIFY_ARTIFACT_DIR="$ARTIFACT_DIR" \
      SLICE_VERIFY_PROJECT_ROOT="$PROJECT_ROOT" \
      SLICE_VERIFY_PHOENIX_PID="$PHX_PID" \
      SLICE_VERIFY_PHOENIX_PORT="$PHOENIX_PORT" \
      SLICE_VERIFY_APP_LOG_DIR="$APP_LOG_DIR" \
      SLICE_VERIFY_LLM_LOG_DIR="$LLM_LOG_DIR" \
      SLICE_VERIFY_PROVIDER="$SLICE_VERIFY_PROVIDER" \
      SLICE_VERIFY_TAURI_HOME="$TAURI_SLICE_HOME" \
      SLICE_VERIFY_BACKEND_LOG="$ARTIFACT_DIR/backend.log" \
      AI_NOVEL_DESKTOP_PROFILE="slice-verify" \
      swift "$PROJECT_ROOT/scripts/macos_cgevent_local_secret_file_driver.swift"

    echo "[tauri-slice-verify] Restarting Tauri app to verify local secret file readback."
    kill_process_tree "$TAURI_PID" || true
    wait "$TAURI_PID" 2>/dev/null || true
    start_tauri_app "$ARTIFACT_DIR/tauri-restart.log"

    CLANG_MODULE_CACHE_PATH=/private/tmp/ans-local-secret-file-clang \
      HOME="$TAURI_SLICE_HOME" \
      SLICE_VERIFY_SECRET_FILE_PHASE="readback" \
      SLICE_VERIFY_BASE_URL="http://127.0.0.1:${VITE_PORT}" \
      SLICE_VERIFY_API_URL="$API_URL" \
      SLICE_VERIFY_ARTIFACT_DIR="$ARTIFACT_DIR" \
      SLICE_VERIFY_PROJECT_ROOT="$PROJECT_ROOT" \
      SLICE_VERIFY_PHOENIX_PID="$PHX_PID" \
      SLICE_VERIFY_PHOENIX_PORT="$PHOENIX_PORT" \
      SLICE_VERIFY_APP_LOG_DIR="$APP_LOG_DIR" \
      SLICE_VERIFY_LLM_LOG_DIR="$LLM_LOG_DIR" \
      SLICE_VERIFY_PROVIDER="$SLICE_VERIFY_PROVIDER" \
      SLICE_VERIFY_TAURI_HOME="$TAURI_SLICE_HOME" \
      SLICE_VERIFY_BACKEND_LOG="$ARTIFACT_DIR/backend.log" \
      AI_NOVEL_DESKTOP_PROFILE="slice-verify" \
      swift "$PROJECT_ROOT/scripts/macos_cgevent_local_secret_file_driver.swift"
    return
  fi

  SLICE_VERIFY_BASE_URL="http://127.0.0.1:${VITE_PORT}" \
    SLICE_VERIFY_API_URL="$API_URL" \
    SLICE_VERIFY_ARTIFACT_DIR="$ARTIFACT_DIR" \
    SLICE_VERIFY_PROJECT_ROOT="$PROJECT_ROOT" \
    SLICE_VERIFY_PHOENIX_PID="$PHX_PID" \
    SLICE_VERIFY_PHOENIX_PORT="$PHOENIX_PORT" \
    SLICE_VERIFY_APP_LOG_DIR="$APP_LOG_DIR" \
    SLICE_VERIFY_LLM_LOG_DIR="$LLM_LOG_DIR" \
    SLICE_VERIFY_PROVIDER="$SLICE_VERIFY_PROVIDER" \
    SLICE_VERIFY_TAURI_HOME="$TAURI_SLICE_HOME" \
    SLICE_VERIFY_BACKEND_LOG="$ARTIFACT_DIR/backend.log" \
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
  const displayedTurnId = evidence.turn_id ?? evidence.turn_ids?.[0] ?? "n/a";
  console.log(`[tauri-slice-verify] verified ${sliceId} turn_id=${displayedTurnId}`);
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
cp -p "$TAURI_CONF" "$TAURI_CONF_BACKUP"
sync_tauri_conf "$VITE_PORT" "$PHOENIX_PORT"

case "$SLICE_ID" in
  su02-empty-start-unnamed-work)
    SEED_SCRIPT=""
    ;;
  su02-artifact-projection-trace-isolation)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
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
  au05-discard-author-action)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-chapter-draft-generation)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-prose-execution-brief)
    SEED_SCRIPT="scripts/seed_p1_prose_execution_brief.exs"
    ;;
  p1-prose-revision-candidate)
    SEED_SCRIPT="scripts/seed_p1_prose_revision_candidate.exs"
    ;;
  p1-prose-quality-finding-roundtrip)
    SEED_SCRIPT="scripts/seed_p1_prose_revision_candidate.exs"
    ;;
  p1-prose-quality-evaluator-degrade)
    SEED_SCRIPT="scripts/seed_p1_prose_quality_evaluator_degrade.exs"
    ;;
  p1-prose-quality-adoption-boundary)
    SEED_SCRIPT="scripts/seed_p1_prose_revision_candidate.exs"
    ;;
  agent-prose-drafting-with-quality)
    SEED_SCRIPT="scripts/seed_p1_prose_revision_candidate.exs"
    ;;
  agent-conversation-turn)
    SEED_SCRIPT=""
    ;;
  agent-plot-outline-with-context)
    SEED_SCRIPT=""
    ;;
  agent-character-evolution-with-context)
    SEED_SCRIPT=""
    ;;
  ua01-agent-bounded-roster-to-character-design)
    SEED_SCRIPT=""
    ;;
  agent-bounded-roster-to-character-design | \
    agent-step-regate | \
    agent-no-multistep-plan-bypass | \
    agent-event-author-safe | \
    agent-channel-fast-ack | \
    agent-interrupt-safe-point | \
    agent-cancel-target-binding | \
    agent-steer-replan | \
    agent-natural-language-steer | \
    agent-loop-budget-limit | \
    agent-no-progress-stop | \
    agent-archive-read-during-run | \
    agent-work-isolation | \
    agent-tentative-boundary | \
    agent-provider-call-budget | \
    agent-durable-resume-long-run-task | \
    agent-provider-execution-stream-unified | \
    agent-provider-execution-activity-restored | \
    agent-provider-execution-error-author-safe | \
    agent-provider-streaming-progress | \
    agent-provider-cancel-honest-boundary | \
    agent-readonly-batch-profile)
    SEED_SCRIPT=""
    ;;
  agent-revision-orchestrator-boundary)
    SEED_SCRIPT="scripts/seed_p1_prose_revision_candidate.exs"
    ;;
  agent-replay-no-provider)
    SEED_SCRIPT="scripts/seed_p1_prose_revision_candidate.exs"
    ;;
  p1-chapter-adoption-reading)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au07-state-trace-adoption-replay)
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
  au04-confirmation-tool-failure-recovery)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au04-confirm-idempotency-ui)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au04-stale-confirmation-ui)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au06-single-active-confirmation)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au04-confirmation-ttl-ui)
    SEED_SCRIPT="scripts/seed_au04_confirmation_ttl_ui.exs"
    ;;
  au04-disabled-confirmation-action-ui)
    SEED_SCRIPT="scripts/seed_au04_disabled_confirmation_action_ui.exs"
    ;;
  au04-history-confirmation-readonly)
    SEED_SCRIPT="scripts/seed_au04_history_confirmation_readonly.exs"
    ;;
  au04-cross-work-confirmation-guard)
    SEED_SCRIPT="scripts/seed_au04_cross_work_confirmation_guard.exs"
    ;;
  au04-latest-context-rebase-confirmation)
    SEED_SCRIPT="scripts/seed_au04_latest_context_rebase_confirmation.exs"
    ;;
  au10-workbench-matrix-layout)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au10-workbench-recovery-taskstate)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au10-workbench-recovery-cancel-waiting)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  e2e-01-downgrade-real-page)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au07-gate-reason-why)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  e2e-01-readonly-tool-trace)
    SEED_SCRIPT="scripts/seed_e2e_01_readonly_tool_trace.exs"
    ;;
  e2e-01-replay-report)
    SEED_SCRIPT="scripts/seed_e2e_01_readonly_tool_trace.exs"
    ;;
  au07-tooltrace-registry-redacted-io)
    SEED_SCRIPT="scripts/seed_e2e_01_readonly_tool_trace.exs"
    ;;
  e2e-01-channel-action-security)
    SEED_SCRIPT=""
    ;;
  au07-behavior-trace-terminal-replay)
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
  au08-reading-readonly-no-write)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au08-reading-return-context)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  p1-plan-incremental)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-memory-create-recall)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-archive-stats-current)
    SEED_SCRIPT="scripts/seed_au09_archive_stats_current.exs"
    ;;
  au09-memory-management-entry)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-memory-management-filter-matrix)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-memory-trace-roundtrip)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-adopt-setting-recall)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-character-dossier-roundtrip)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-character-role-taxonomy-protagonist-policy)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-memory-taxonomy-write-policy)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-memory-list-ux-redesign)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-character-candidate-per-item-adoption)
    SEED_SCRIPT="scripts/seed_p1_chapter_draft_generation.exs"
    ;;
  au09-validity-window-recall)
    SEED_SCRIPT="scripts/seed_au09_validity_window.exs"
    ;;
  au09-cross-work-memory-isolation)
    SEED_SCRIPT="scripts/seed_au09_cross_work_memory_isolation.exs"
    ;;
  au09-au03-session-memory-layering)
    SEED_SCRIPT="scripts/seed_au09_au03_session_memory_layering.exs"
    ;;
  au03-session-history-readonly)
    SEED_SCRIPT="scripts/seed_au03_session_history_readonly.exs"
    ;;
  au03-session-new-active)
    SEED_SCRIPT="scripts/seed_au03_session_history_readonly.exs"
    ;;
  au03-branch-from-history)
    SEED_SCRIPT="scripts/seed_au03_session_history_readonly.exs"
    ;;
  au03-archive-session-filter)
    SEED_SCRIPT="scripts/seed_au03_session_history_readonly.exs"
    ;;
  au03-current-work-context-ssot)
    SEED_SCRIPT="scripts/seed_au03_current_work_context_ssot.exs"
    ;;
  au11-quality-diagnosis-message-envelope)
    SEED_SCRIPT="scripts/seed_au11_quality_diagnosis_message_envelope.exs"
    ;;
  au11-missing-workstate-policy)
    SEED_SCRIPT=""
    ;;
  au12-work-profile-status-isolation)
    SEED_SCRIPT="scripts/seed_au12_work_profile_status_isolation.exs"
    ;;
  au12-archive-concurrent-model-run-read-snapshot)
    SEED_SCRIPT=""
    ;;
  *)
    SEED_SCRIPT="scripts/seed_au03_long_session_compression.exs"
    ;;
esac

if [[ -n "$SEED_SCRIPT" ]]; then
  MIX_ENV=test mix run "$SEED_SCRIPT" >"$ARTIFACT_DIR/seed.log" 2>&1
else
  echo "[tauri-slice-verify] seed: none" >"$ARTIFACT_DIR/seed.log"
fi

LMSTUDIO_TIMEOUT_MS="${NOVEL_LMSTUDIO_TIMEOUT_MS:-300000}"
if [[ "$SLICE_ID" == "au10-workbench-recovery-provider-timeout" ]]; then
  LMSTUDIO_TIMEOUT_MS="${NOVEL_LMSTUDIO_TIMEOUT_MS:-750}"
fi

MIX_ENV=test \
  PHOENIX_TEST_PORT="$PHOENIX_PORT" \
  PHOENIX_PORT="$PHOENIX_PORT" \
  SLICE_VERIFY_APP_LOG_DIR="$APP_LOG_DIR" \
  SLICE_VERIFY_LLM_LOG_DIR="$LLM_LOG_DIR" \
  SLICE_VERIFY_PROVIDER="$SLICE_VERIFY_PROVIDER" \
  SLICE_VERIFY_SKIP_DEFAULT_WORK_SEED="$([[ "$SLICE_ID" == "su02-empty-start-unnamed-work" ]] && echo 1 || echo 0)" \
  SLICE_VERIFY_DEEPSEEK_HTTP_FIXTURE="$([[ "$SLICE_ID" == "su01-api-key-secret-redaction" || "$SLICE_ID" == "su01-local-secret-file-roundtrip" ]] && echo 1 || echo 0)" \
  SLICE_VERIFY_PROVIDER_MODELS_FIXTURE="$([[ "$SLICE_ID" == "su01-provider-model-list-success" || "$SLICE_ID" == "su01-provider-test-failure-ui" ]] && echo 1 || echo 0)" \
  NOVEL_LMSTUDIO_TIMEOUT_MS="$LMSTUDIO_TIMEOUT_MS" \
  AI_NOVEL_DESKTOP_PROFILE="slice-verify" \
  mix run --no-start --no-halt scripts/slice_verify_server.exs >"$ARTIFACT_DIR/backend.log" 2>&1 &
PHX_PID=$!
wait_for_url "$API_URL/health" "Phoenix"

cd "$PROJECT_ROOT/frontend"
setup_isolated_macos_keychain
start_tauri_app "$ARTIFACT_DIR/tauri.log"

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
