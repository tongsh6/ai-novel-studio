#!/usr/bin/env bash
#
# Unified task completion exit.
#
# Usage:
#   bash scripts/task_done.sh
#   bash scripts/task_done.sh --slice au05-adoption-followup-routing
#   bash scripts/task_done.sh --slice au05-adoption-followup-routing --quick
#   bash scripts/task_done.sh --slice au05-adoption-followup-routing \
#     --ui-summary artifacts/slice-verify/<slice>-tauri-native-<tag>/summary.json
#   TAURI_NATIVE_SYSTEM_DRIVER=1 bash scripts/task_done.sh --slice au05-adoption-followup-routing
#   bash scripts/task_done.sh --skip-static-scan
#
# The script creates artifacts/task-done/<timestamp>/manifest.json.
# If frontend/Tauri/UI files changed, it requires fresh Tauri UI evidence.
# --ui-summary reuses an already-produced native/browser Tauri summary instead of
# rerunning the slice; freshness (summary mtime vs UI edits) is still enforced by
# `task_done_check.mjs --manifest`. TAURI_NATIVE_SYSTEM_DRIVER=1 reruns the slice
# through the AX native driver and records the matching -tauri-native-<tag> summary.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT_DIR="$ROOT_DIR/artifacts/task-done/$STAMP"
CHECKS_LOG="$ARTIFACT_DIR/checks.log"
SLICE_ID=""
QUICK=false
SKIP_STATIC_SCAN=false
TOP=10
UI_SUMMARY_OVERRIDE=""
NATIVE_SYSTEM_DRIVER="${TAURI_NATIVE_SYSTEM_DRIVER:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slice)
      SLICE_ID="${2:-}"
      shift 2
      ;;
    --ui-summary)
      UI_SUMMARY_OVERRIDE="${2:-}"
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
      sed -n '1,22p' "$0"
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

  if [[ -n "$UI_SUMMARY_OVERRIDE" ]]; then
    echo "==> Reusing provided UI summary (no rerun): $UI_SUMMARY_OVERRIDE"
    UI_SUMMARY="$UI_SUMMARY_OVERRIDE"
  elif [[ -n "$SLICE_ID" ]]; then
    echo "==> Tauri slice verification: $SLICE_ID"
    if [[ "$NATIVE_SYSTEM_DRIVER" == "1" ]]; then
      NATIVE_TAG="${TAURI_NATIVE_ARTIFACT_TAG:-td-$(date -u +%Y%m%dt%H%M%Sz)}"
      if [[ ! "$NATIVE_TAG" =~ ^[a-z0-9-]+$ || ${#NATIVE_TAG} -gt 32 ]]; then
        echo "Invalid native artifact tag: $NATIVE_TAG" >&2
        exit 2
      fi
      export TAURI_NATIVE_ARTIFACT_TAG="$NATIVE_TAG"
      if [[ "$SLICE_ID" != "au12-correction-intent-roundtrip" ]]; then
        echo "native task_done batch is not wired for $SLICE_ID; pass --ui-summary <summary.json> instead" >&2
        exit 2
      fi
      (
        cd "$ROOT_DIR"
        bash scripts/native_au12_batch.sh "$NATIVE_TAG"
      ) >> "$CHECKS_LOG" 2>&1
      CANDIDATE_REL="artifacts/slice-verify/$SLICE_ID-tauri-native-$NATIVE_TAG/summary.json"
      CANDIDATE_SUMMARY="$ROOT_DIR/$CANDIDATE_REL"
    else
      (
        cd "$ROOT_DIR"
        bash scripts/tauri_slice_verify.sh "$SLICE_ID"
      ) >> "$CHECKS_LOG" 2>&1
      CANDIDATE_REL="artifacts/slice-verify/$SLICE_ID-tauri/summary.json"
      CANDIDATE_SUMMARY="$ROOT_DIR/$CANDIDATE_REL"
    fi

    if [[ -f "$CANDIDATE_SUMMARY" ]]; then
      UI_SUMMARY="$CANDIDATE_REL"
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
