#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCENARIO_INDEX="$PROJECT_ROOT/quality/acceptance/scenarios.yml"

SCENARIO_ID=""
SURFACE=""
PROVIDER="${SLICE_VERIFY_PROVIDER:-slice_verify}"
TIER=""
LIST=false

usage() {
  cat <<'EOF'
Usage:
  bash scripts/quality_accept.sh --list
  bash scripts/quality_accept.sh <scenario-id>
  bash scripts/quality_accept.sh <scenario-id> --surface browser
  bash scripts/quality_accept.sh <scenario-id> --surface tauri
  bash scripts/quality_accept.sh <scenario-id> --provider slice_verify
  bash scripts/quality_accept.sh <scenario-id> --provider lmstudio
  bash scripts/quality_accept.sh --tier pr-smoke
  bash scripts/quality_accept.sh --tier nightly --surface tauri
EOF
}

query_scenarios() {
  node --input-type=module - "$SCENARIO_INDEX" "$@" <<'NODE'
import fs from "node:fs";

const [indexPath, command, ...args] = process.argv.slice(2);

function clean(value) {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function parseIndex(text) {
  const scenarios = [];
  let current = null;

  for (const line of text.split("\n")) {
    const idMatch = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (idMatch) {
      current = { id: clean(idMatch[1]) };
      scenarios.push(current);
      continue;
    }

    const fieldMatch = line.match(/^\s{4}([A-Za-z_]+):\s*(.*)$/);
    if (current && fieldMatch) {
      current[fieldMatch[1]] = clean(fieldMatch[2]);
    }
  }

  return scenarios;
}

if (!fs.existsSync(indexPath)) {
  console.error(`Missing scenario index: ${indexPath}`);
  process.exit(66);
}

const scenarios = parseIndex(fs.readFileSync(indexPath, "utf8"));

if (command === "list") {
  console.log("id\ttier\tstatus\tsurface\tdriver\tentrypoint");
  for (const scenario of scenarios) {
    console.log([
      scenario.id,
      scenario.tier,
      scenario.status || "active",
      scenario.surface,
      scenario.driver,
      scenario.entrypoint,
    ].join("\t"));
  }
  process.exit(0);
}

if (command === "ids-by-tier") {
  const [tier, surface] = args;
  for (const scenario of scenarios) {
    if (scenario.tier === tier && (!surface || scenario.surface === surface)) {
      console.log(scenario.id);
    }
  }
  process.exit(0);
}

if (command === "field") {
  const [id, field] = args;
  const scenario = scenarios.find((item) => item.id === id);
  if (!scenario) {
    console.error(`Unknown scenario id: ${id}`);
    process.exit(64);
  }
  console.log(scenario[field] ?? "");
  process.exit(0);
}

console.error(`Unknown query command: ${command}`);
process.exit(64);
NODE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)
      LIST=true
      shift
      ;;
    --tier)
      TIER="${2:-}"
      shift 2
      ;;
    --surface)
      SURFACE="${2:-}"
      shift 2
      ;;
    --provider)
      PROVIDER="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$SCENARIO_ID" ]]; then
        SCENARIO_ID="$1"
      else
        echo "Unexpected argument: $1" >&2
        usage >&2
        exit 64
      fi
      shift
      ;;
  esac
done

if [[ "$LIST" == true ]]; then
  query_scenarios list
  exit 0
fi

run_scenario() {
  local scenario_id="$1"
  local scenario_surface="$SURFACE"
  local scenario_status
  local blocked_reason
  local manifest
  local artifact_dir

  if [[ -z "$scenario_surface" ]]; then
    scenario_surface="$(query_scenarios field "$scenario_id" surface)"
  fi

  scenario_status="$(query_scenarios field "$scenario_id" status)"
  if [[ "$scenario_status" == "blocked" ]]; then
    blocked_reason="$(query_scenarios field "$scenario_id" blocked_reason)"
    echo "[quality-accept] blocked scenario: $scenario_id" >&2
    echo "[quality-accept] reason: ${blocked_reason:-not specified}" >&2
    exit 65
  fi

  manifest="$(query_scenarios field "$scenario_id" manifest)"
  if [[ ! -f "$PROJECT_ROOT/$manifest" ]]; then
    echo "[quality-accept] Missing manifest for $scenario_id: $manifest" >&2
    exit 66
  fi

  case "$scenario_surface" in
    browser)
      artifact_dir="$PROJECT_ROOT/artifacts/slice-verify/$scenario_id"
      ;;
    tauri)
      if [[ "$PROVIDER" == "lmstudio" ]]; then
        artifact_dir="$PROJECT_ROOT/artifacts/slice-verify/${scenario_id}-tauri-lmstudio"
      else
        artifact_dir="$PROJECT_ROOT/artifacts/slice-verify/${scenario_id}-tauri"
      fi
      ;;
    *)
      echo "[quality-accept] Unsupported surface: $scenario_surface" >&2
      exit 64
      ;;
  esac

  cat <<EOF
[quality-accept] scenario: $scenario_id
[quality-accept] surface: $scenario_surface
[quality-accept] provider: $PROVIDER
[quality-accept] manifest: $manifest
[quality-accept] artifacts: $artifact_dir
EOF

  case "$scenario_surface" in
    browser)
      if ! bash "$PROJECT_ROOT/scripts/slice_verify.sh" "$scenario_id"; then
        echo "[quality-accept] failed: $scenario_id" >&2
        echo "[quality-accept] inspect artifacts: $artifact_dir" >&2
        exit 1
      fi
      ;;
    tauri)
      if ! bash "$PROJECT_ROOT/scripts/tauri_slice_verify.sh" --provider "$PROVIDER" "$scenario_id"; then
        echo "[quality-accept] failed: $scenario_id" >&2
        echo "[quality-accept] inspect artifacts: $artifact_dir" >&2
        exit 1
      fi
      ;;
  esac

  echo "[quality-accept] passed: $scenario_id"
}

if [[ -n "$TIER" ]]; then
  mapfile -t scenario_ids < <(query_scenarios ids-by-tier "$TIER" "$SURFACE")
  if [[ "${#scenario_ids[@]}" -eq 0 ]]; then
    echo "[quality-accept] No scenarios found for tier=$TIER surface=${SURFACE:-any}" >&2
    exit 65
  fi

  for id in "${scenario_ids[@]}"; do
    run_scenario "$id"
  done
  exit 0
fi

if [[ -z "$SCENARIO_ID" ]]; then
  usage >&2
  exit 64
fi

run_scenario "$SCENARIO_ID"
