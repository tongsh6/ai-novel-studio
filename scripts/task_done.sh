#!/usr/bin/env bash
# Unified task completion owner. Design: quality-gates.md §2.3.1.
# Begin BEFORE implementation:
#   bash scripts/task_done.sh --begin artifacts/slice-verify/<scope>/scope.json --task tasks/<task>.md
# Complete the same scope (including committed and parallel changes):
#   bash scripts/task_done.sh --scope <scope.json> --slice <slice>
# Reuse ONLY an existing same-scope execution binding:
#   bash scripts/task_done.sh --scope <scope.json> --slice <slice> --ui-summary <summary> --ui-binding <binding>
# No --scope: whole-tree scan only, never a task completion declaration.
set -euo pipefail
ORIGINAL_ARGS=("$@")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$ROOT_DIR/scripts/lib/test_env.sh"
SCOPE=""; BEGIN=""; TASK=""; SLICE=""; UI_SUMMARY=""; UI_BINDING=""
QUICK=false; SKIP=false; TOP=10
while [[ $# -gt 0 ]]; do
  case "$1" in
    --begin|--task|--scope|--slice|--ui-summary|--ui-binding|--top)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { echo "Missing option value" >&2; exit 2; }
      case "$1" in
        --begin) BEGIN="$2";; --task) TASK="$2";; --scope) SCOPE="$2";;
        --slice) SLICE="$2";; --ui-summary) UI_SUMMARY="$2";;
        --ui-binding) UI_BINDING="$2";; --top) TOP="$2";;
      esac
      shift 2;;
    --quick) QUICK=true; shift;;
    --skip-static-scan) SKIP=true; shift;;
    -h|--help) sed -n '2,9p' "$0"; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
done
cd "$ROOT_DIR"
if [[ -n "$BEGIN" ]]; then
  [[ -n "$TASK" && -z "$SCOPE$SLICE$UI_SUMMARY$UI_BINDING" ]] || { echo "Invalid begin arguments" >&2; exit 2; }
  node scripts/task_done_check.mjs --begin "$BEGIN" --task "$TASK"
  exit
fi
[[ -z "$TASK" ]] || { echo "--task requires --begin" >&2; exit 2; }
if [[ ${#ORIGINAL_ARGS[@]} -gt 0 ]]; then
  novel_node_test_scope_ensure bash "$SCRIPT_PATH" "${ORIGINAL_ARGS[@]}" || exit $?
else
  novel_node_test_scope_ensure bash "$SCRIPT_PATH" || exit $?
fi
SCAN_ARGS=(--top "$TOP")
[[ "$QUICK" == false ]] || SCAN_ARGS+=(--quick)
if [[ -z "$SCOPE" ]]; then
  [[ -z "$SLICE$UI_SUMMARY$UI_BINDING" && "$SKIP" == false ]] || { echo "Task evidence requires --scope" >&2; exit 2; }
  echo "Whole-tree static scan only; no task completion asserted."
  TASK_DONE_CHECK_PURPOSE=whole-tree-inventory bash scripts/ai_static_scan.sh "${SCAN_ARGS[@]}"
  exit
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
ARTIFACT_DIR="$ROOT_DIR/artifacts/slice-verify/task-completion-$STAMP"
mkdir -p "$ARTIFACT_DIR"
CHECKS_START="$ARTIFACT_DIR/checks-start.json"
CHECKS_BINDING="$ARTIFACT_DIR/checks-binding.json"
MANIFEST="$ARTIFACT_DIR/manifest.json"
FINALIZED=0
: > "$ARTIFACT_DIR/native.log"
: > "$ARTIFACT_DIR/static-scan.log"
# Final logs are never appended after a content binding has been sealed.
on_exit() {
  local rc=$?
  trap - EXIT
  if [[ "$FINALIZED" == 0 ]]; then
    cat "$ARTIFACT_DIR/native.log" "$ARTIFACT_DIR/static-scan.log" > "$ARTIFACT_DIR/checks.log"
    if [[ -f "$CHECKS_START" && ! -f "$CHECKS_BINDING" ]]; then
      node scripts/task_done_check.mjs --finish-execution "$CHECKS_BINDING" --start "$CHECKS_START" \
        --log "$ARTIFACT_DIR/checks.log" --exit-code "${rc:-1}" --command "task_done interrupted before completion" || true
    fi
    node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({status:"failed",exit_code:Number(process.argv[2]),completion:false,reason:"execution_not_completed"},null,2))' \
      "$ARTIFACT_DIR/failure.json" "$rc"
  fi
  exit "$rc"
}
trap on_exit EXIT
SCAN_MODE=full
[[ "$QUICK" == false ]] || SCAN_MODE=quick
[[ "$SKIP" == false ]] || SCAN_MODE=skipped
node scripts/task_done_check.mjs --scope "$SCOPE" --start-execution "$CHECKS_START" --kind checks --scan-mode "$SCAN_MODE"
UI_REQUIRED="$(node scripts/task_done_check.mjs --scope "$SCOPE" --ui-required)"
if [[ "$UI_REQUIRED" == true ]]; then
  [[ -n "$SLICE" ]] || { echo "UI change requires explicit --slice" >&2; exit 1; }
  if [[ -n "$UI_SUMMARY" ]]; then
    [[ -n "$UI_BINDING" ]] || { echo "Reuse requires existing --ui-binding; cannot bind an old summary now" >&2; exit 1; }
  else
    [[ -z "$UI_BINDING" ]] || { echo "--ui-binding requires --ui-summary" >&2; exit 2; }
    NATIVE_START="$ARTIFACT_DIR/native-start.json"
    UI_BINDING="$ARTIFACT_DIR/native-binding.json"
    if [[ "${TAURI_NATIVE_SYSTEM_DRIVER:-0}" == 1 ]]; then
      [[ "$SLICE" == au12-correction-intent-roundtrip ]] || { echo "Native owner not wired for this slice; supply existing bound evidence" >&2; exit 2; }
      TAG="${TAURI_NATIVE_ARTIFACT_TAG:-td-$(date -u +%Y%m%dt%H%M%Sz)}"
      [[ "$TAG" =~ ^[a-z0-9-]+$ && ${#TAG} -le 32 ]] || exit 2
      export TAURI_NATIVE_ARTIFACT_TAG="$TAG"
      COMMAND="bash scripts/native_au12_batch.sh $TAG"
      UI_SUMMARY="artifacts/slice-verify/$SLICE-tauri-native-$TAG/summary.json"
      node scripts/task_done_check.mjs --scope "$SCOPE" --start-execution "$NATIVE_START" --kind native --slice-id "$SLICE" --ui-summary "$UI_SUMMARY"
      bash scripts/native_au12_batch.sh "$TAG" > "$ARTIFACT_DIR/native.log" 2>&1
    else
      COMMAND="bash scripts/tauri_slice_verify.sh $SLICE"
      UI_SUMMARY="artifacts/slice-verify/$SLICE-tauri/summary.json"
      node scripts/task_done_check.mjs --scope "$SCOPE" --start-execution "$NATIVE_START" --kind native --slice-id "$SLICE" --ui-summary "$UI_SUMMARY"
      bash scripts/tauri_slice_verify.sh "$SLICE" > "$ARTIFACT_DIR/native.log" 2>&1
    fi
    # No latest-summary fallback: only the selected execution's exact output.
    node scripts/task_done_check.mjs --finish-execution "$UI_BINDING" --start "$NATIVE_START" \
      --log "$ARTIFACT_DIR/native.log" --exit-code 0 --command "$COMMAND" --ui-summary "$UI_SUMMARY"
  fi
fi
PREPARE=(--prepare-manifest --scope "$SCOPE" --artifact-dir "$ARTIFACT_DIR" --checks-start "$CHECKS_START")
[[ -z "$SLICE" ]] || PREPARE+=(--slice-id "$SLICE")
[[ -z "$UI_SUMMARY" ]] || PREPARE+=(--ui-summary "$UI_SUMMARY")
[[ -z "$UI_BINDING" ]] || PREPARE+=(--ui-binding "$UI_BINDING")
node scripts/task_done_check.mjs "${PREPARE[@]}" > "$ARTIFACT_DIR/manifest-path.txt"
SCAN_RC=0
if [[ "$SKIP" == true ]]; then
  printf 'Static scan not run; evidence preparation only.\n' > "$ARTIFACT_DIR/static-scan.log"
else
  # The recursive checker only validates running evidence identity, not completion.
  TASK_DONE_MANIFEST="$MANIFEST" TASK_DONE_RUNNING_MANIFEST="$MANIFEST" \
    TASK_DONE_CHECK_PURPOSE=execution-preflight \
    bash scripts/ai_static_scan.sh "${SCAN_ARGS[@]}" > "$ARTIFACT_DIR/static-scan.log" 2>&1 || SCAN_RC=$?
fi
cat "$ARTIFACT_DIR/native.log" "$ARTIFACT_DIR/static-scan.log" > "$ARTIFACT_DIR/checks.log"
node scripts/task_done_check.mjs --finish-execution "$CHECKS_BINDING" --start "$CHECKS_START" \
  --log "$ARTIFACT_DIR/checks.log" --exit-code "$SCAN_RC" \
  --command "task_done selected native evidence; bash scripts/ai_static_scan.sh ${SCAN_ARGS[*]}; skipped=$SKIP" || true
FINALIZED=1
node scripts/task_done_check.mjs --finalize-manifest --manifest "$MANIFEST" \
  --checks-binding "$CHECKS_BINDING"
node scripts/task_done_check.mjs --manifest "$MANIFEST"