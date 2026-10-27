#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SCENARIO_ID=""
SURFACE=""
PROVIDER="${SLICE_VERIFY_PROVIDER:-slice_verify}"
PROVIDER_SET=false
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
  bash scripts/quality_accept.sh <scenario-id> --provider deepseek
  bash scripts/quality_accept.sh <scenario-id> --provider strata
  bash scripts/quality_accept.sh su01-provider-strata-local --surface tauri
  bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio
  bash scripts/quality_accept.sh --tier pr-smoke
  bash scripts/quality_accept.sh --tier nightly --surface tauri
EOF
}

query_scenarios() {
  # B41 CP1：统一经 manifest CLI 读取 registry（单一解析源，不做正则 YAML 解析）。
  node "$PROJECT_ROOT/scripts/lib/quality/manifest_cli.mjs" "$@" --root "$PROJECT_ROOT"
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
      PROVIDER_SET=true
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

# B41 CP1：非法 manifest 不得进入运行。执行/查询前统一做一次 manifest 门禁校验；
# 校验失败返回 66（配置错误），与 runner 失败的 1 区分。
if ! node "$PROJECT_ROOT/scripts/lib/quality/manifest_cli.mjs" validate --root "$PROJECT_ROOT" >/dev/null 2>&1; then
  echo "[quality-accept] manifest 校验失败，拒绝执行；运行 bash scripts/quality_manifest_check.sh 查看详情" >&2
  exit 66
fi

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
  local scenario_runner
  local scenario_default_provider
  local scenario_provider="$PROVIDER"
  local entrypoint

  if [[ -z "$scenario_surface" ]]; then
    scenario_surface="$(query_scenarios field "$scenario_id" surface)"
  fi

  scenario_runner="$(query_scenarios field "$scenario_id" runner)"
  if [[ -z "$scenario_runner" ]]; then
    case "$scenario_surface" in
      browser)
        scenario_runner="slice_verify"
        ;;
      tauri)
        scenario_runner="tauri_slice_verify"
        ;;
      *)
        echo "[quality-accept] Unsupported surface: $scenario_surface" >&2
        exit 64
        ;;
    esac
  fi

  scenario_default_provider="$(query_scenarios field "$scenario_id" default_provider)"
  if [[ "$PROVIDER_SET" == false && -n "$scenario_default_provider" ]]; then
    scenario_provider="$scenario_default_provider"
  fi

  entrypoint="$(query_scenarios field "$scenario_id" entrypoint)"

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

  case "$scenario_runner" in
    slice_verify)
      artifact_dir="$PROJECT_ROOT/artifacts/slice-verify/$scenario_id"
      ;;
    tauri_slice_verify)
      if [[ "$scenario_provider" == "slice_verify" ]]; then
        artifact_dir="$PROJECT_ROOT/artifacts/slice-verify/${scenario_id}-tauri"
      else
        artifact_dir="$PROJECT_ROOT/artifacts/slice-verify/${scenario_id}-tauri-${scenario_provider}"
      fi
      ;;
    dogfood_run)
      artifact_dir="$PROJECT_ROOT/artifacts/novel-output/p1-100k-dogfood"
      ;;
    e2e_aggregate)
      artifact_dir="$PROJECT_ROOT/artifacts/slice-verify/$scenario_id"
      ;;
    *)
      echo "[quality-accept] Unsupported runner: $scenario_runner" >&2
      exit 64
      ;;
  esac

  cat <<EOF
[quality-accept] scenario: $scenario_id
[quality-accept] surface: $scenario_surface
[quality-accept] runner: $scenario_runner
[quality-accept] provider: $scenario_provider
[quality-accept] entrypoint: $entrypoint
[quality-accept] manifest: $manifest
[quality-accept] artifacts: $artifact_dir
EOF

  case "$scenario_runner" in
    slice_verify)
      if [[ "$scenario_surface" != "browser" ]]; then
        echo "[quality-accept] runner slice_verify requires surface=browser, got $scenario_surface" >&2
        exit 64
      fi
      if ! bash "$PROJECT_ROOT/scripts/slice_verify.sh" "$scenario_id"; then
        echo "[quality-accept] failed: $scenario_id" >&2
        echo "[quality-accept] inspect artifacts: $artifact_dir" >&2
        exit 1
      fi
      ;;
    tauri_slice_verify)
      if [[ "$scenario_surface" != "tauri" ]]; then
        echo "[quality-accept] runner tauri_slice_verify requires surface=tauri, got $scenario_surface" >&2
        exit 64
      fi
      if ! bash "$PROJECT_ROOT/scripts/tauri_slice_verify.sh" --provider "$scenario_provider" "$scenario_id"; then
        echo "[quality-accept] failed: $scenario_id" >&2
        echo "[quality-accept] inspect artifacts: $artifact_dir" >&2
        exit 1
      fi
      ;;
    dogfood_run)
      if [[ "$scenario_provider" != "lmstudio" && "$scenario_provider" != "slice_verify" ]]; then
        echo "[quality-accept] dogfood_run supports provider lmstudio|slice_verify, got $scenario_provider" >&2
        exit 64
      fi

      local dogfood_args=(--provider "$scenario_provider")
      if [[ -n "${DOGFOOD_QUALITY_CHAPTERS:-}" ]]; then
        dogfood_args+=(--chapters "$DOGFOOD_QUALITY_CHAPTERS")
      fi
      if [[ -n "${DOGFOOD_QUALITY_MIN_WORDS:-}" ]]; then
        dogfood_args+=(--min-words "$DOGFOOD_QUALITY_MIN_WORDS")
      fi
      if [[ -n "${DOGFOOD_QUALITY_TARGET_WORDS:-}" ]]; then
        dogfood_args+=(--target-words "$DOGFOOD_QUALITY_TARGET_WORDS")
      fi
      if [[ "${DOGFOOD_QUALITY_RESUME:-false}" == "true" ]]; then
        dogfood_args+=(--resume)
      fi

      if ! bash "$PROJECT_ROOT/scripts/dogfood_run.sh" "${dogfood_args[@]}"; then
        echo "[quality-accept] failed: $scenario_id" >&2
        echo "[quality-accept] inspect artifacts: $artifact_dir" >&2
        exit 1
      fi
      ;;
    e2e_aggregate)
      if [[ "$scenario_surface" != "browser" ]]; then
        echo "[quality-accept] runner e2e_aggregate requires surface=browser, got $scenario_surface" >&2
        exit 64
      fi
      if [[ "$scenario_provider" != "lmstudio" && "$scenario_provider" != "slice_verify" ]]; then
        echo "[quality-accept] e2e_aggregate supports provider lmstudio|slice_verify, got $scenario_provider" >&2
        exit 64
      fi
      if ! bash "$PROJECT_ROOT/scripts/e2e_01_full_chain_check.sh" --provider "$scenario_provider"; then
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
