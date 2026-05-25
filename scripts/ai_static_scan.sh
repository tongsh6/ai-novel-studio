#!/usr/bin/env bash
#
# AI 静态扫描闭环入口。
#
# 用法:
#   bash scripts/ai_static_scan.sh --top 10
#   bash scripts/ai_static_scan.sh --top 10 --quick
#   bash scripts/ai_static_scan.sh --write-baseline
#
# 输出:
#   artifacts/static-scan/report.json
#   artifacts/static-scan/top10.md
#   artifacts/static-scan/disposition.md
#   artifacts/static-scan/raw/*

set -uo pipefail

TOP=10
QUICK=false
WRITE_BASELINE=false
BASELINE="reports/static-scan/baseline.json"
DISPOSITIONS="reports/static-scan/dispositions.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --top)
      TOP="${2:-10}"
      shift 2
      ;;
    --quick)
      QUICK=true
      shift
      ;;
    --baseline)
      BASELINE="${2:-}"
      shift 2
      ;;
    --write-baseline)
      WRITE_BASELINE=true
      shift
      ;;
    --dispositions)
      DISPOSITIONS="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '1,32p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN_DIR="$ROOT_DIR/artifacts/static-scan"
RAW_DIR="$SCAN_DIR/raw"
MANIFEST="$SCAN_DIR/manifest.tsv"

mkdir -p "$RAW_DIR"
rm -f "$RAW_DIR"/* "$MANIFEST" "$SCAN_DIR/report.json" "$SCAN_DIR/top10.md"
rm -f "$SCAN_DIR/disposition.md"
: > "$MANIFEST"

export RAW_DIR

has_mix_task() {
  mix help "$1" >/dev/null 2>&1
}

now_ms() {
  node -e 'console.log(Date.now())'
}

append_manifest() {
  local id="$1"
  local name="$2"
  local category="$3"
  local severity="$4"
  local status="$5"
  local duration_ms="$6"
  local raw_file="$7"
  local command="$8"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$id" "$name" "$category" "$severity" "$status" "$duration_ms" "$raw_file" "$command" >> "$MANIFEST"
}

run_check() {
  local id="$1"
  local name="$2"
  local category="$3"
  local severity="$4"
  local command="$5"
  local raw_file="$RAW_DIR/$id.log"
  local start
  local end
  local status

  echo "==> $name"
  start="$(now_ms)"
  (cd "$ROOT_DIR" && bash -lc "$command") > "$raw_file" 2>&1
  status=$?
  end="$(now_ms)"

  append_manifest "$id" "$name" "$category" "$severity" "$status" "$((end - start))" "$raw_file" "$command"

  if [[ $status -eq 0 ]]; then
    echo "    PASS"
  else
    echo "    FAIL ($status)"
  fi
}

skip_check() {
  local id="$1"
  local name="$2"
  local category="$3"
  local severity="$4"
  local reason="$5"
  local raw_file="$RAW_DIR/$id.log"

  echo "==> $name"
  echo "Skipped: $reason" > "$raw_file"
  append_manifest "$id" "$name" "$category" "$severity" "skipped" "0" "$raw_file" "$reason"
  echo "    SKIP"
}

run_check "mix-compile" "Mix compile warnings-as-errors" "correctness" "critical" \
  "mix compile --warnings-as-errors"

run_check "xref-cycles" "Compile dependency cycle check" "architecture" "high" \
  "mix xref graph --format cycles --label compile-connected --fail-above 0"

run_check "arch-check" "Umbrella architecture boundary check" "architecture" "high" \
  "mix run --no-start scripts/arch_check.exs"

run_check "credo" "Credo strict static analysis" "maintainability" "medium" \
  "mix credo suggest --strict --format json"

run_check "scenario-invariants-i3" "Scenario invariants — I3 nonce propagation" "correctness" "critical" \
  "MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs"

run_check "scenario-invariants-i1" "Scenario invariants — I1 causal binding" "correctness" "critical" \
  "MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs"

run_check "scenario-invariants-i2" "Scenario invariants — I2 input variation" "correctness" "critical" \
  "MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs"

if has_mix_task "sobelow"; then
  run_check "sobelow" "Sobelow Phoenix security scan" "security" "high" \
    "mix sobelow --exit --format json"
else
  skip_check "sobelow" "Sobelow Phoenix security scan" "security" "high" \
    "mix task sobelow is unavailable; run mix deps.get after adding sobelow"
fi

if has_mix_task "deps.audit"; then
  run_check "mix-audit" "Hex dependency vulnerability scan" "security" "high" \
    "mix deps.audit"
else
  skip_check "mix-audit" "Hex dependency vulnerability scan" "security" "high" \
    "mix task deps.audit is unavailable; run mix deps.get after adding mix_audit"
fi

if [[ -f "$ROOT_DIR/frontend/package.json" ]]; then
  run_check "frontend-typecheck" "Frontend TypeScript typecheck" "correctness" "high" \
    "cd frontend && pnpm typecheck"
  run_check "frontend-lint" "Frontend ESLint" "maintainability" "medium" \
    "cd frontend && pnpm lint"

  if [[ "$QUICK" == true ]]; then
    skip_check "frontend-test" "Frontend unit tests" "correctness" "high" \
      "quick mode"
  else
    run_check "frontend-test" "Frontend unit tests" "correctness" "high" \
      "cd frontend && pnpm test"
  fi

  run_check "frontend-audit" "Frontend stack and Tauri audit" "architecture" "high" \
    "bash scripts/frontend_audit.sh --quick"
  run_check "design-trace" "Frontend design traceability check" "architecture" "medium" \
    "bash scripts/check_design_trace.sh"
  run_check "task-done-manifest" "Task completion manifest and UI evidence check" "process" "high" \
    "node scripts/task_done_check.mjs"
  run_check "next-task-check" "NEXT queue and user journey integrity check" "process" "high" \
    "node scripts/next_task_check.mjs"
else
  skip_check "frontend-typecheck" "Frontend TypeScript typecheck" "correctness" "high" \
    "frontend/package.json not found"
  skip_check "frontend-lint" "Frontend ESLint" "maintainability" "medium" \
    "frontend/package.json not found"
  skip_check "frontend-test" "Frontend unit tests" "correctness" "high" \
    "frontend/package.json not found"
  skip_check "frontend-audit" "Frontend stack and Tauri audit" "architecture" "high" \
    "frontend/package.json not found"
  skip_check "design-trace" "Frontend design traceability check" "architecture" "medium" \
    "frontend/package.json not found"
  run_check "task-done-manifest" "Task completion manifest and UI evidence check" "process" "high" \
    "node scripts/task_done_check.mjs"
  run_check "next-task-check" "NEXT queue and user journey integrity check" "process" "high" \
    "node scripts/next_task_check.mjs"
fi

if command -v gitleaks >/dev/null 2>&1; then
  run_check "gitleaks" "Secret leak scan" "security" "critical" \
    "gitleaks detect --source . --no-banner --redact --report-format json --report-path \"$RAW_DIR/gitleaks.json\""
else
  skip_check "gitleaks" "Secret leak scan" "security" "critical" \
    "gitleaks executable not found"
fi

if command -v semgrep >/dev/null 2>&1; then
  run_check "semgrep" "Semgrep static security scan" "security" "high" \
    "semgrep scan --config auto --json --output \"$RAW_DIR/semgrep.json\""
else
  skip_check "semgrep" "Semgrep static security scan" "security" "high" \
    "semgrep executable not found"
fi

if [[ "$BASELINE" == /* ]]; then
  BASELINE_PATH="$BASELINE"
else
  BASELINE_PATH="$ROOT_DIR/$BASELINE"
fi

if [[ "$DISPOSITIONS" == /* ]]; then
  DISPOSITIONS_PATH="$DISPOSITIONS"
else
  DISPOSITIONS_PATH="$ROOT_DIR/$DISPOSITIONS"
fi

REPORT_ARGS=(
  "$ROOT_DIR/scripts/ai_static_scan_report.mjs"
  "--scan-dir" "$SCAN_DIR"
  "--top" "$TOP"
  "--baseline" "$BASELINE_PATH"
  "--dispositions" "$DISPOSITIONS_PATH"
)

if [[ "$WRITE_BASELINE" == true ]]; then
  REPORT_ARGS+=("--write-baseline")
fi

node "${REPORT_ARGS[@]}"
REPORT_STATUS=$?

echo ""
echo "Report: $SCAN_DIR/top10.md"
echo "Triage: $SCAN_DIR/disposition.md"
echo "JSON:   $SCAN_DIR/report.json"

exit "$REPORT_STATUS"
