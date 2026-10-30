#!/usr/bin/env bash
# B39 CP1 AU-15 A0/A1/A2：外部原生 Tauri + 真实模型证据批次编排。
#
# 前置：预注册已落盘（artifacts/model-contracts/b39-cp1/au15-preregistration.json）、
# Strata 单槽可用、作者/Lead 授权资源窗口。一次批次只加载一个模型；结束/失败由 driver
# unload，batch 再核验 strata loaded=null。失败计入分母并只读保留，不重试刷分。
#
# 用法：
#   bash scripts/native_au15_evidence_seeking_batch.sh <tag>             # 前台执行
#   bash scripts/native_au15_evidence_seeking_batch.sh --detach <tag>    # detached 执行
#   bash scripts/native_au15_evidence_seeking_batch.sh --status <tag>    # 查看批次状态
#
# 产物：
#   证据目录 artifacts/slice-verify/b39-au15-<tag>-native/（新目录，不覆盖既有批次）
#   批次状态 artifacts/model-contracts/b39-cp1/batch-<tag>.state.json / .runner.log / .driver.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIRST="${1:-}"
case "$FIRST" in
  --detach | --status)
    MODE="$FIRST"
    TAG="${2:-au15cp1a}"
    ;;
  run)
    MODE="run"
    TAG="${2:-au15cp1a}"
    ;;
  *)
    MODE="run"
    TAG="${1:-au15cp1a}"
    ;;
esac
STATE_DIR="$ROOT/artifacts/model-contracts/b39-cp1"
PREREG="$STATE_DIR/au15-preregistration.json"
STATE="$STATE_DIR/batch-$TAG.state.json"
RUNNER_LOG="$STATE_DIR/batch-$TAG.runner.log"
DRIVER_LOG="$STATE_DIR/batch-$TAG.driver.log"
HEARTBEAT="$STATE_DIR/batch-$TAG.heartbeat.jsonl"
PIDFILE="$STATE_DIR/batch-$TAG.pid"
PREREG_CHECK="$STATE_DIR/batch-$TAG.prereg-check.json"
# 证据目录 = 预注册 b39-au15-<batch>-native 前缀；内部 runs/<A0|A1|A2>-runN/ 分 run 保存。
DIR="$ROOT/artifacts/slice-verify/b39-au15-$TAG-native"
SETUP_MODE="${AU15_SETUP_MODE:-isolated_fixture}"
STRATA="${NOVEL_STRATA_ENDPOINT:-http://127.0.0.1:47831}"
STRATA_BASE="${STRATA%/v1}"
if [[ "$SETUP_MODE" == "d6a" ]]; then
  SETUP_PRECONDITION="driver_required"
else
  SETUP_PRECONDITION="not_satisfied"
fi
export AU15_SETUP_MODE="$SETUP_MODE"
mkdir -p "$STATE_DIR"

write_state() {
  local status="$1"
  local extra="${2:-}"
  if [[ -n "$extra" ]]; then
    echo "{\"status\":\"$status\",\"tag\":\"$TAG\",\"dir\":\"$DIR\",\"pid\":$$,\"updated_at\":\"$(date -u +%FT%TZ)\",$extra}" > "$STATE"
  else
    echo "{\"status\":\"$status\",\"tag\":\"$TAG\",\"dir\":\"$DIR\",\"pid\":$$,\"updated_at\":\"$(date -u +%FT%TZ)\"}" > "$STATE"
  fi
}

fail() {
  write_state "fail" "\"reason\":\"$1\""
  echo "[au15-batch] fail: $1" >&2
  exit 64
}

if [[ "$MODE" == "--status" ]]; then
  cat "$STATE" 2>/dev/null || echo '{"status":"unknown"}'
  exit 0
fi

if [[ "$MODE" == "--detach" ]]; then
  if [[ -e "$DIR" ]]; then
    echo "[au15-batch] artifact dir already exists (immutable): $DIR" >&2
    exit 64
  fi
  nohup bash "$0" run "$TAG" >>"$STATE_DIR/batch-$TAG.detached.log" 2>&1 &
  echo "$!" > "$PIDFILE"
  echo "[au15-batch] detached pid=$(cat "$PIDFILE") tag=$TAG dir=$DIR"
  exit 0
fi

[[ "$MODE" == "run" ]] || fail "unknown_mode:$MODE"
[[ -f "$PREREG" ]] || fail "missing_preregistration"
if [[ -e "$DIR" ]]; then
  fail "artifact_dir_exists:prior_batches_are_immutable"
fi
curl -s --max-time 3 "$STRATA_BASE/api/models" >/dev/null || fail "strata_unreachable"

# 预注册逐项校验（schema/单槽/unload/分型预算/独立 run 数/证据清单/分层口径）。
node - "$PREREG" "$PREREG_CHECK" <<'NODE' || fail "invalid_preregistration"
const fs = require("node:fs");
const [file, out] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(file, "utf8"));
const checks = [];
const add = (id, ok, detail = null) => checks.push({ id, ok, detail });
add("schema", p.schema === "au15-cp1-preregistration/v1", p.schema);
add(
  "scenarios_a0_a1_a2",
  Array.isArray(p.scope?.scenarios) &&
    ["SC-AU15-A0", "SC-AU15-A1", "SC-AU15-A2"].every((id) => p.scope.scenarios.includes(id)),
  p.scope?.scenarios ?? null,
);
add("single_slot", p.model?.single_slot === true, p.model?.single_slot ?? null);
add("unload_after", p.model?.unload_after === true, p.model?.unload_after ?? null);
add("model_identity", p.model?.provider === "strata" && p.model?.model === "iq3_s", {
  provider: p.model?.provider ?? null,
  model: p.model?.model ?? null,
});
add("budget_input_120s", p.budget?.input_timeout_ms === 120000, p.budget?.input_timeout_ms ?? null);
add("budget_turn_360s", p.budget?.turn_timeout_ms === 360000, p.budget?.turn_timeout_ms ?? null);
add("budget_candidate_300s", p.budget?.candidate_timeout_ms === 300000, p.budget?.candidate_timeout_ms ?? null);
add("budget_adoption_180s", p.budget?.adoption_timeout_ms === 180000, p.budget?.adoption_timeout_ms ?? null);
add(
  "budget_maintenance_300s",
  p.budget?.maintenance_timeout_ms === 300000,
  p.budget?.maintenance_timeout_ms ?? null,
);
add("heartbeat_10s", p.budget?.heartbeat_ms === 10000, p.budget?.heartbeat_ms ?? null);
add(
  "max_author_question_replies_2",
  p.budget?.max_author_question_replies === 2,
  p.budget?.max_author_question_replies ?? null,
);
add("a1_a2_independent_runs_2", p.budget?.A1_A2_runs === 2, p.budget?.A1_A2_runs ?? null);
add("no_retries", p.budget?.retries === 0, p.budget?.retries ?? null);
add(
  "evidence_required",
  Array.isArray(p.evidence?.required) && p.evidence.required.length >= 8,
  p.evidence?.required?.length ?? null,
);
add("layering_declared", typeof p.criteria?.layering === "string", p.criteria?.layering ?? null);
add("unknown_not_pass", typeof p.criteria?.unknown === "string", p.criteria?.unknown ?? null);
add("setup_rule_declared", typeof p.setup?.rule === "string", p.setup?.rule ?? null);
const result = {
  schema: "au15-preregistration-check/v1",
  preregistration: file,
  checks,
  ok: checks.every((check) => check.ok),
  checked_at: new Date().toISOString(),
};
fs.writeFileSync(out, JSON.stringify(result, null, 2));
if (!result.ok) {
  console.error(`[au15-batch] preregistration checks failed: ${checks.filter((c) => !c.ok).map((c) => c.id).join(",")}`);
  process.exit(64);
}
NODE

# setup 与测量分账：本批 setup 是隔离 fixture（scripts/seed_au15_evidence_seeking.exs），
# 不是 D6-A 真实创作/采纳；如实写进 batch state，正式验收仍 blocked。
write_state "preregistration_verified" "\"preregistration\":\"$PREREG\",\"prereg_check\":\"$PREREG_CHECK\",\"setup_mode\":\"$SETUP_MODE\",\"d6a_precondition\":\"$SETUP_PRECONDITION\",\"authorization\":\"lead_task_request\""

PREFLIGHT="$(curl -s --max-time 3 "$STRATA_BASE/api/models" || echo '{}')"
PREFLIGHT_LOADED="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(JSON.stringify(j.loaded??null))}catch{process.stdout.write("unknown")}})' <<<"$PREFLIGHT")"
write_state "running" "\"preregistration\":\"$PREREG\",\"preflight\":$PREFLIGHT,\"preflight_loaded\":$PREFLIGHT_LOADED,\"setup_mode\":\"$SETUP_MODE\",\"d6a_precondition\":\"$SETUP_PRECONDITION\",\"started_at\":\"$(date -u +%FT%TZ)\""

export TAURI_NATIVE_SYSTEM_DRIVER=1
export TAURI_NATIVE_TRANSPORT_PROXY=1
export SLICE_VERIFY_PROVIDER=strata
export TAURI_NATIVE_ARTIFACT_TAG="$TAG"
export TAURI_NATIVE_ARTIFACT_DIR="$DIR"
export NOVEL_STRATA_ENDPOINT="${STRATA%/}/v1"
# 可选的 run 子集（仅调试/smoke；正式批次不设置，driver 默认 A0+A1x2+A2x2）。
export AU15_SCENARIO_RUN_IDS="${AU15_SCENARIO_RUN_IDS:-}"
# 证据目录必须由 runner 新建；这里只记录目标路径。
bash "$ROOT/scripts/tauri_slice_verify.sh" au15-evidence-seeking-native >"$RUNNER_LOG" 2>&1 &
RUNNER=$!
echo "$RUNNER" > "$STATE_DIR/batch-$TAG.runner.pid"
write_state "runner_started" "\"preregistration\":\"$PREREG\",\"runner_pid\":$RUNNER,\"artifact_dir\":\"$DIR\""

READY=0
for i in $(seq 1 300); do
  if [[ -f "$DIR/native-driver-ready.json" ]]; then READY=1; break; fi
  if ! kill -0 "$RUNNER" 2>/dev/null; then fail "runner_exited_before_ready"; fi
  if (( i % 10 == 0 )); then
    echo "{\"at\":\"$(date -u +%FT%TZ)\",\"phase\":\"wait_ready\",\"elapsed_s\":$((i * 2))}" >>"$HEARTBEAT"
  fi
  sleep 2
done
if [[ "$READY" != "1" ]]; then
  fail "driver_ready_timeout"
fi

cp "$PREREG" "$DIR/preregistration.json"
cp "$PREREG_CHECK" "$DIR/preregistration-check.json"
write_state "driver_running" "\"preregistration\":\"$PREREG\",\"runner_pid\":$RUNNER,\"artifact_dir\":\"$DIR\""

set +e
node "$ROOT/scripts/native_au15_evidence_seeking_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
DRIVER_RC=$?
set -e
write_state "driver_finished" "\"preregistration\":\"$PREREG\",\"runner_pid\":$RUNNER,\"driver_rc\":$DRIVER_RC,\"artifact_dir\":\"$DIR\""

set +e
wait "$RUNNER"
RUNNER_RC=$?
set -e

# 模型生命周期终验：driver 已 unload；batch 再核验 loaded=null（不触碰 LM Studio）。
LOADED_AFTER="unknown"
for _ in $(seq 1 15); do
  STATE_JSON="$(curl -s --max-time 3 "$STRATA_BASE/api/models" || echo '{}')"
  LOADED_AFTER="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(JSON.stringify(j.loaded??null))}catch{process.stdout.write("unknown")}})' <<<"$STATE_JSON")"
  if [[ "$LOADED_AFTER" == "null" ]]; then
    break
  fi
  curl -s --max-time 5 -X POST -H 'Content-Type: application/json' -d '{}' "$STRATA_BASE/api/models/unload" >/dev/null 2>&1 || true
  sleep 1
done

# 批次证据索引：setup 与测量分账、失败分母、目录映射（不覆盖任何既有批次）。
if [[ -d "$DIR" ]]; then
  node - "$DIR" "$TAG" "$DRIVER_RC" "$RUNNER_RC" "$LOADED_AFTER" "$SETUP_MODE" <<'NODE' || true
const fs = require("node:fs");
const path = require("node:path");
const [dir, tag, driverRc, runnerRc, loadedAfter, setupMode] = process.argv.slice(2);
const runs = fs.existsSync(path.join(dir, "runs"))
  ? fs.readdirSync(path.join(dir, "runs")).sort().map((runId) => ({
      run_id: runId,
      run_json: fs.existsSync(path.join(dir, "runs", runId, "run.json")),
      sidecar: fs.existsSync(path.join(dir, "runs", runId, "au15-evidence-sidecar.json")),
    }))
  : [];
const summaryPath = path.join(dir, "summary.json");
const summary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, "utf8")) : null;
const batch = {
  schema: "au15-native-batch/v1",
  tag,
  evidence_dir: path.relative(path.resolve(dir, "../../.."), dir),
  preregistration_evidence_dir_template: "artifacts/slice-verify/b39-au15-<A0|A1|A2>-native-<batch>",
  dir_mapping_note:
    "预注册模板的每场景目录由本批单目录 runs/<A0|A1|A2>-runN/ 承载；setup 与 measurement 分账见 setup 字段。",
  setup: (() => {
    const setupJson = fs.existsSync(path.join(dir, "setup.json"))
      ? JSON.parse(fs.readFileSync(path.join(dir, "setup.json"), "utf8"))
      : null;
    return {
      mode: setupMode,
      seed: "scripts/seed_au15_evidence_seeking.exs",
      d6a_precondition:
        setupMode === "d6a" ? (setupJson?.ok === true ? "satisfied_by_driver" : "failed_or_missing") : "not_satisfied",
      evidence: setupJson,
      note:
        setupMode === "d6a"
          ? "setup 由真实模型创作 + 外部页面采纳；setup 与测量分账，正式 A1/A2 仍待作者/指定评审。"
          : "setup 使用隔离 fixture（非 D6-A 真实模型创作 + 外部页面采纳）；正式 A1/A2 验收仍 blocked。",
    };
  })(),
  measurement: {
    planned_runs: 5,
    attempted_runs: runs.length,
    driver_rc: Number(driverRc),
    runner_rc: Number(runnerRc),
    model_loaded_after: (() => {
      try {
        return JSON.parse(loadedAfter);
      } catch {
        return loadedAfter;
      }
    })(),
  },
  runs,
  summary_status: summary
    ? {
        mechanism: summary.mechanism?.status ?? null,
        model_behavior: summary.model_behavior?.status ?? null,
        formal_acceptance: summary.formal_acceptance?.status ?? null,
        loaded_before: summary.model_lifecycle?.loaded_before ?? null,
        loaded_after: summary.model_lifecycle?.loaded_after ?? null,
      }
    : null,
  generated_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(dir, "batch.json"), JSON.stringify(batch, null, 2));
NODE
fi

SETUP_OK=1
if [[ "$SETUP_MODE" == "d6a" ]]; then
  SETUP_OK=0
  if [[ -f "$DIR/setup.json" ]] && node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(j.ok===true?0:1)' "$DIR/setup.json"; then
    SETUP_OK=1
  fi
fi

if [[ "$DRIVER_RC" -eq 0 && "$RUNNER_RC" -eq 0 && "$LOADED_AFTER" == "null" && "$SETUP_OK" -eq 1 ]]; then
  write_state "finished" "\"preregistration\":\"$PREREG\",\"driver_rc\":$DRIVER_RC,\"runner_rc\":$RUNNER_RC,\"loaded_after\":null,\"artifact_dir\":\"$DIR\",\"finished_at\":\"$(date -u +%FT%TZ)\""
  echo "[au15-batch] passed driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC loaded_after=null dir=$DIR"
  exit 0
fi

write_state "failed" "\"preregistration\":\"$PREREG\",\"driver_rc\":$DRIVER_RC,\"runner_rc\":$RUNNER_RC,\"loaded_after\":$LOADED_AFTER,\"artifact_dir\":\"$DIR\",\"finished_at\":\"$(date -u +%FT%TZ)\""
echo "[au15-batch] failed driver_rc=$DRIVER_RC runner_rc=$RUNNER_RC loaded_after=$LOADED_AFTER dir=$DIR" >&2
[[ "$LOADED_AFTER" == "null" ]] || echo "[au15-batch] WARNING: strata model still loaded; inspect $DIR/model-lifecycle-after.json" >&2
exit 1
