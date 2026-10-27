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

Exit codes (B41 CP2):
  0   pass（单场景通过；批量在无 fail/evidence_missing 且至少 1 个 pass 时为 0）
  1   fail（runner/断言失败）
  64  usage/config error
  65  blocked（单场景；批量中记 skipped 并继续，不中止整批）
  66  manifest/gate 配置错误（执行前 manifest 校验失败）
  67  evidence_missing（runner 通过但无证据产物）
  69  not_run（批量中没有任何场景实际执行，例如全部 blocked/skipped）
EOF
}

query_scenarios() {
  # B41 CP1：统一经 manifest CLI 读取 registry（单一解析源，不做正则 YAML 解析）。
  node "$PROJECT_ROOT/scripts/lib/quality/manifest_cli.mjs" "$@" --root "$PROJECT_ROOT"
}

# B41 CP4：每次场景运行后写 quality-verdict/v2（生成/校验/写入经 verdict.mjs 单一实现）。
# 退出码：0 写入成功；2 真实 provider pass 待 B42（不写 PASS）；3 pass 降级 evidence_missing；
# 其他为写入失败（调用方不得记 PASS）。
record_verdict() {
  local status="$1" reason="$2" codes="${3:-}"
  local -a args=(
    --scenario "$scenario_id"
    --status "$status"
    --exit-code 0
    --artifact-dir "$artifact_dir"
    --provider "$scenario_provider"
    --finished-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  )
  if [[ -n "${RUN_STARTED_AT:-}" ]]; then
    args+=(--started-at "$RUN_STARTED_AT")
  fi
  if [[ -n "$reason" ]]; then
    args+=(--reason "$reason")
  fi
  if [[ -n "$codes" ]]; then
    args+=(--reason-code "$codes")
  fi
  node "$PROJECT_ROOT/scripts/lib/quality/accept_verdict.mjs" "${args[@]}" 1>&2
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
if [[ "${QUALITY_ACCEPT_MANIFEST_VERIFIED:-0}" != "1" ]]; then
  if ! node "$PROJECT_ROOT/scripts/lib/quality/manifest_cli.mjs" validate --root "$PROJECT_ROOT" >/dev/null 2>&1; then
    echo "[quality-accept] manifest 校验失败，拒绝执行；运行 bash scripts/quality_manifest_check.sh 查看详情" >&2
    exit 66
  fi
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
  local RUN_STARTED_AT
  RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

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
        record_verdict fail "runner_failed" quality_accept_runner_failed || true
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
        record_verdict fail "runner_failed" quality_accept_runner_failed || true
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
        record_verdict fail "runner_failed" quality_accept_runner_failed || true
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
      local e2e_rc=0
      bash "$PROJECT_ROOT/scripts/e2e_01_full_chain_check.sh" --provider "$scenario_provider" || e2e_rc=$?
      if [[ "$e2e_rc" -ne 0 ]]; then
        echo "[quality-accept] failed: $scenario_id（aggregate exit=$e2e_rc）" >&2
        # B41 CP3/CP4：聚合器的 blocked/evidence_missing/not_run 不得压成 fail，透传退出码。
        case "$e2e_rc" in
          65) record_verdict skipped "aggregate_all_blocked" quality_accept_aggregate_blocked || true ;;
          67) record_verdict evidence_missing "aggregate_evidence_missing" quality_accept_aggregate_evidence_missing || true ;;
          69) record_verdict not_run "aggregate_not_run" quality_accept_aggregate_not_run || true ;;
          *) record_verdict fail "aggregate_failed" quality_accept_aggregate_failed || true ;;
        esac
        echo "[quality-accept] inspect artifacts: $artifact_dir" >&2
        exit "$e2e_rc"
      fi
      ;;
  esac

  # B41 CP2：runner 退出 0 但没有任何证据产物 → evidence_missing（不得记 PASS）。
  if [[ -n "${artifact_dir:-}" ]]; then
    if [[ ! -d "$artifact_dir" ]] || [[ -z "$(ls -A "$artifact_dir" 2>/dev/null)" ]]; then
      echo "[quality-accept] evidence_missing: ${scenario_id}（artifact_dir ${artifact_dir} 不存在或为空）" >&2
      record_verdict evidence_missing "artifact_dir_empty" quality_accept_artifact_dir_empty || true
      exit 67
    fi
  fi

  local verdict_rc=0
  record_verdict pass "" quality_accept_pass || verdict_rc=$?
  if [[ "$verdict_rc" -eq 3 ]]; then
    echo "[quality-accept] evidence_missing（verdict 降级：必需证据缺失）：$scenario_id" >&2
    exit 67
  elif [[ "$verdict_rc" -eq 2 ]]; then
    echo "[quality-accept] $scenario_id：真实 provider pass 的模型行为证据归 B42；本次不写 PASS verdict（读方为 evidence_missing）" >&2
  elif [[ "$verdict_rc" -ne 0 ]]; then
    echo "[quality-accept] verdict 写入失败（rc=$verdict_rc），不记 PASS：$scenario_id" >&2
    exit 67
  fi

  echo "[quality-accept] passed: $scenario_id"
}

# 批量执行：blocked=skipped+reason 并继续；分别统计 pass/fail/skipped/not_run/evidence_missing；
# 整批不得因 skipped 变 PASS，也不在首个 blocked 处中止（B41 CP2）。
run_tier_batch() {
  local tier="$1" surface="$2"
  local -a tier_rows
  mapfile -t tier_rows < <(query_scenarios tier-rows "$tier" "$surface")
  if [[ "${#tier_rows[@]}" -eq 0 ]]; then
    echo "[quality-accept] No scenarios found for tier=$tier surface=${surface:-any}" >&2
    exit 65
  fi

  local batch_id="${tier}${surface:+-${surface}}-$(date -u +%Y%m%dT%H%M%SZ)"
  local batch_dir="artifacts/quality-accept/batches/${batch_id}"
  local results_tsv="$PROJECT_ROOT/$batch_dir/results.tsv"
  local logs_dir="$PROJECT_ROOT/$batch_dir/logs"
  mkdir -p "$logs_dir"
  : > "$results_tsv"

  local pass_count=0 fail_count=0 skip_count=0 missing_count=0 not_run_count=0
  local started_at finished_at git_head
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git_head="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"

  local row id status blocked_reason
  for row in "${tier_rows[@]}"; do
    IFS=$'\t' read -r id status blocked_reason <<< "$row"
    if [[ "$status" == "blocked" ]]; then
      echo "[quality-accept] skip blocked: $id — ${blocked_reason:-no reason}" >&2
      skip_count=$((skip_count + 1))
      printf '%s\tskipped\t65\tblocked: %s\t%s\n' "$id" "${blocked_reason:-no reason}" "" >> "$results_tsv"
      continue
    fi
    if [[ "$status" != "active" ]]; then
      echo "[quality-accept] skip non-active: $id — status=$status" >&2
      not_run_count=$((not_run_count + 1))
      printf '%s\tnot_run\t69\tstatus=%s\t%s\n' "$id" "$status" "" >> "$results_tsv"
      continue
    fi

    local -a child_args=("$id")
    [[ -n "$surface" ]] && child_args+=(--surface "$surface")
    [[ "$PROVIDER_SET" == true ]] && child_args+=(--provider "$PROVIDER")

    local output rc
    set +e
    output="$(QUALITY_ACCEPT_MANIFEST_VERIFIED=1 bash "$PROJECT_ROOT/scripts/quality_accept.sh" "${child_args[@]}" 2>&1)"
    rc=$?
    set -e
    printf '%s\n' "$output" > "$logs_dir/${id}.log"
    printf '%s\n' "$output" | grep -E '^\[quality-accept\] (passed|failed|blocked scenario|evidence_missing|skip)' >&2 || true
    if [[ "$rc" -ne 0 && "$rc" -ne 65 ]]; then
      echo "[quality-accept] $id 失败详情：$batch_dir/logs/${id}.log（末 5 行）" >&2
      printf '%s\n' "$output" | tail -5 >&2 || true
    fi

    local artifact_dir_rel reason result
    artifact_dir_rel="$(printf '%s\n' "$output" | sed -n 's/^\[quality-accept\] artifacts: //p' | tail -1)"
    case "$rc" in
      0) result="pass"; pass_count=$((pass_count + 1)) ;;
      65) result="skipped"; skip_count=$((skip_count + 1)) ;;
      67) result="evidence_missing"; missing_count=$((missing_count + 1)) ;;
      69) result="not_run"; not_run_count=$((not_run_count + 1)) ;;
      *) result="fail"; fail_count=$((fail_count + 1)) ;;
    esac
    reason="$(printf '%s\n' "$output" | { grep -E '^\[quality-accept\] (failed|blocked scenario|evidence_missing)' || true; } | head -1)"
    reason="${reason#\[quality-accept\] }"
    if [[ "$rc" == "65" ]]; then
      reason="blocked: $(printf '%s\n' "$output" | { grep -m1 '^\[quality-accept\] reason: ' || true; } | head -1)"
      reason="${reason/\[quality-accept\] reason: /}"
    fi
    reason="${reason//$'\t'/ }"
    printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$result" "$rc" "$reason" "$artifact_dir_rel" >> "$results_tsv"
  done

  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local batch_exit=0
  if [[ "$fail_count" -gt 0 ]]; then
    batch_exit=1
  elif [[ "$missing_count" -gt 0 ]]; then
    batch_exit=67
  elif [[ "$pass_count" -gt 0 ]]; then
    batch_exit=0
  else
    batch_exit=69
  fi

  BATCH_ID="$batch_id" BATCH_DIR="$batch_dir" BATCH_RESULTS_TSV="$results_tsv" \
  BATCH_TIER="$tier" BATCH_SURFACE="$surface" BATCH_PROVIDER="$PROVIDER" \
  BATCH_STARTED_AT="$started_at" BATCH_FINISHED_AT="$finished_at" BATCH_GIT_HEAD="$git_head" \
  BATCH_PASS="$pass_count" BATCH_FAIL="$fail_count" BATCH_SKIP="$skip_count" \
  BATCH_MISSING="$missing_count" BATCH_NOT_RUN="$not_run_count" BATCH_EXIT="$batch_exit" \
  node --input-type=module - "$PROJECT_ROOT" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const [projectRoot] = process.argv.slice(2);
const env = process.env;
const resultsPath = env.BATCH_RESULTS_TSV;
const rows = fs.readFileSync(resultsPath, "utf8").split("\n").filter(Boolean).map((line) => {
  const [scenario_id, status, exit_code, reason, artifact_dir] = line.split("\t");
  return { scenario_id, status, exit_code: Number(exit_code), reason: reason || null, artifact_dir: artifact_dir || null };
});
const counts = {
  pass: Number(env.BATCH_PASS ?? 0),
  fail: Number(env.BATCH_FAIL ?? 0),
  skipped: Number(env.BATCH_SKIP ?? 0),
  evidence_missing: Number(env.BATCH_MISSING ?? 0),
  not_run: Number(env.BATCH_NOT_RUN ?? 0),
};
const summary = {
  schema_version: "quality-batch/v1",
  batch_id: env.BATCH_ID,
  tier: env.BATCH_TIER,
  surface: env.BATCH_SURFACE || null,
  provider: env.BATCH_PROVIDER,
  git_head: env.BATCH_GIT_HEAD,
  started_at: env.BATCH_STARTED_AT,
  finished_at: env.BATCH_FINISHED_AT,
  exit_code: Number(env.BATCH_EXIT ?? 0),
  counts,
  scenarios: rows,
};
const batchDir = path.join(projectRoot, env.BATCH_DIR);
fs.mkdirSync(batchDir, { recursive: true });
fs.writeFileSync(path.join(batchDir, "batch.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log("[quality-accept] batch: " + env.BATCH_ID);
console.log("[quality-accept] counts: pass=" + counts.pass + " fail=" + counts.fail + " skipped=" + counts.skipped +
  " evidence_missing=" + counts.evidence_missing + " not_run=" + counts.not_run);
for (const row of rows) {
  if (row.status !== "pass") console.log("[quality-accept]   " + row.scenario_id + ": " + row.status + (row.reason ? " — " + row.reason : ""));
}
console.log("[quality-accept] batch summary: " + path.join(env.BATCH_DIR, "batch.json"));
NODE

  if [[ "$batch_exit" -ne 0 ]]; then
    echo "[quality-accept] batch failed: tier=$tier surface=${surface:-any} exit=$batch_exit" >&2
  fi
  exit "$batch_exit"
}

if [[ -n "$TIER" ]]; then
  run_tier_batch "$TIER" "$SURFACE"
  exit 0
fi

if [[ -z "$SCENARIO_ID" ]]; then
  usage >&2
  exit 64
fi

run_scenario "$SCENARIO_ID"
