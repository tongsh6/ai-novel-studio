#!/usr/bin/env bash
#
# Unified task completion exit.
#
# Usage:
#   bash scripts/task_done.sh
#   bash scripts/task_done.sh --slice au05-adoption-followup-routing
#   bash scripts/task_done.sh --slice au05-adoption-followup-routing --quick
#   bash scripts/task_done.sh --skip-static-scan
#
# The script creates artifacts/task-done/<timestamp>/manifest.json.
# If frontend/Tauri/UI files changed, it requires fresh Tauri UI evidence.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT_DIR="$ROOT_DIR/artifacts/task-done/$STAMP"
CHECKS_LOG="$ARTIFACT_DIR/checks.log"
SLICE_ID=""
QUICK=false
SKIP_STATIC_SCAN=false
TOP=10

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slice)
      SLICE_ID="${2:-}"
      shift 2
      ;;
    --quick)
      QUICK=true
      shift
      ;;
    --skip-static-scan)
      SKIP_STATIC_SCAN=true
      shift
      ;;
    --top)
      TOP="${2:-10}"
      shift 2
      ;;
    -h|--help)
      sed -n '1,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$ARTIFACT_DIR/screenshots"
: > "$CHECKS_LOG"

echo "==> Task completion manifest"
UI_REQUIRED="$(cd "$ROOT_DIR" && node scripts/task_done_check.mjs --ui-required)"
UI_STATUS="not_required"
UI_SUMMARY=""

if [[ "$UI_REQUIRED" == "true" ]]; then
  echo "    UI changes detected"

  if [[ -n "$SLICE_ID" ]]; then
    echo "==> Tauri slice verification: $SLICE_ID"
    (
      cd "$ROOT_DIR"
      bash scripts/tauri_slice_verify.sh "$SLICE_ID"
    ) >> "$CHECKS_LOG" 2>&1

    CANDIDATE_SUMMARY="$ROOT_DIR/artifacts/slice-verify/$SLICE_ID-tauri/summary.json"
    if [[ -f "$CANDIDATE_SUMMARY" ]]; then
      UI_SUMMARY="artifacts/slice-verify/$SLICE_ID-tauri/summary.json"
    else
      UI_SUMMARY="$(cd "$ROOT_DIR" && node scripts/task_done_check.mjs --latest-ui-summary)"
    fi
  else
    UI_SUMMARY="$(cd "$ROOT_DIR" && node scripts/task_done_check.mjs --latest-ui-summary || true)"
  fi

  if [[ -z "$UI_SUMMARY" ]]; then
    echo "UI evidence is required but no slice summary was found." | tee -a "$CHECKS_LOG" >&2
    echo "Run: bash scripts/task_done.sh --slice <slice-id>" >&2
    exit 1
  fi

  UI_STATUS="verified"
  echo "    UI evidence: $UI_SUMMARY"
else
  echo "    UI evidence not required"
fi

MANIFEST_PATH="$(
  cd "$ROOT_DIR"
  node scripts/task_done_check.mjs \
    --write-manifest \
    --artifact-dir "$ARTIFACT_DIR" \
    --slice-id "$SLICE_ID" \
    --ui-status "$UI_STATUS" \
    --ui-summary "$UI_SUMMARY" \
    --checks-log "$CHECKS_LOG"
)"

echo "    Manifest: ${MANIFEST_PATH#$ROOT_DIR/}"

(
  cd "$ROOT_DIR"
  node scripts/task_done_check.mjs --manifest "$MANIFEST_PATH"
) | tee -a "$CHECKS_LOG"

if [[ "$SKIP_STATIC_SCAN" == true ]]; then
  echo "==> Static scan skipped"
  exit 0
fi

SCAN_ARGS=(--top "$TOP")
if [[ "$QUICK" == true ]]; then
  SCAN_ARGS+=(--quick)
fi

echo "==> AI static scan"
(
  cd "$ROOT_DIR"
  bash scripts/ai_static_scan.sh "${SCAN_ARGS[@]}"
) | tee -a "$CHECKS_LOG"
