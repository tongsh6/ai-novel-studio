// B42 CP1：release / release-real-llm 分层结果层测试。
// 运行：node --test scripts/lib/quality/release_layer.test.mjs
//
// 覆盖：空 tier（已知事实）不是 PASS；确定性 nightly 结果不得提升成真实模型 PASS；
// HTTP 200/单次运行/缺保留措辞/缺 actual_model 不得写成模型语义 PASS；blocked 不得 PASS；
// 以及 CLI 读取真实历史 batch/verdict/artifact 的只读验证（artifacts 缺失时跳过）。
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PLANNED_RUNS,
  RELEASE_LAYER_SCHEMA_VERSION,
  RELEASE_LAYER_STATUSES,
  RELEASE_TIERS,
  TIER_CLASS,
  buildReleaseLayerSummary,
  evaluateModelBehaviorEvidence,
  exitCodeForReleaseStatus,
  resultsFromBatch,
  validateReleaseLayerSummary,
  writeReleaseLayerSummary,
} from "./release_layer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const CLI = path.join(HERE, "release_layer_cli.mjs");
const schema = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "quality/acceptance/evidence-schema.json"), "utf8"),
);
const RELEASE_SCHEMA = schema.$defs.release_layer_summary;

function tmpDir(t, prefix = "release-layer-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function deterministicResult(overrides = {}) {
  return {
    scenario_id: "release-det-scenario",
    status: "pass",
    provider: "slice_verify",
    surface: "tauri",
    driver: "frontend/slice-verify/external-ui-driver.mjs",
    model: "deterministic",
    actual_model: null,
    attempt: 1,
    timeouts: 0,
    git_head: "1ce14d5b",
    generated_at: "2026-10-27T12:00:00.000Z",
    artifact_dir: "artifacts/slice-verify/release-det-scenario-tauri",
    mechanism: { status: "pass", evidence_refs: ["artifacts/slice-verify/x/summary.json"] },
    model_behavior: { status: "not_applicable", evidence_refs: [] },
    ...overrides,
  };
}

function realModelResult(overrides = {}) {
  return {
    scenario_id: "au15-a1-real",
    status: "pass",
    provider: "strata",
    surface: "tauri",
    driver: "ax-native-system-ui",
    model: "iq3_s",
    actual_model: "iq3_s",
    attempt: 2,
    timeouts: 0,
    params: { temperature: 0.7, max_tokens: 4096 },
    git_head: "1ce14d5b",
    generated_at: "2026-10-27T12:00:00.000Z",
    artifact_dir: "artifacts/slice-verify/au15-a1-real-tauri-strata",
    mechanism: { status: "pass", evidence_refs: ["app-log.jsonl"] },
    model_behavior: { status: "pass", evidence_refs: ["llm-calls.jsonl"] },
    model_behavior_evidence: {
      real_provider_calls: 3,
      provider_responses_with_body: 3,
      http_2xx: 3,
    },
    runs: [
      { attempt: 1, status: "pass" },
      { attempt: 2, status: "pass" },
    ],
    evidence_chain: {
      binding: {
        binding_status: "verified",
        reason_codes: [],
        observation_link_count: 1,
        real_observation_link_count: 1,
        used_bound_count: 1,
        used_unbound_count: 0,
      },
    },
    retention_wording: { text: "换个说法再写一版，别提前用提示词调过", ref: "artifacts/x/retention.md", tuned: false },
    ...overrides,
  };
}

function retention() {
  return { text: "换个说法再写一版，别提前用提示词调过", ref: "artifacts/x/retention.md", tuned: false };
}

// ---------- schema / 常量同源 ----------

test("schema $defs 与模块常量同源（quality-release-layer/v1）", () => {
  assert.equal(RELEASE_SCHEMA.properties.schema_version.const, RELEASE_LAYER_SCHEMA_VERSION);
  assert.deepEqual([...RELEASE_SCHEMA.properties.tier.enum].sort(), [...RELEASE_TIERS].sort());
  assert.deepEqual(
    [...RELEASE_SCHEMA.properties.status.enum].sort(),
    [...RELEASE_LAYER_STATUSES].sort(),
  );
  assert.deepEqual(
    [...RELEASE_SCHEMA.properties.tier_class.enum].sort(),
    [...new Set(Object.values(TIER_CLASS))].sort(),
  );
  assert.equal(exitCodeForReleaseStatus("pass"), 0);
  assert.equal(exitCodeForReleaseStatus("fail"), 1);
  assert.equal(exitCodeForReleaseStatus("skipped"), 65);
  assert.equal(exitCodeForReleaseStatus("evidence_missing"), 67);
  assert.equal(exitCodeForReleaseStatus("not_run"), 69);
});

// ---------- 空 tier 已知事实 ----------

test("空 release tier → not_run + empty_tier（exit 65），绝不是 PASS", () => {
  const summary = buildReleaseLayerSummary({ tier: "release" });
  assert.equal(summary.status, "not_run");
  assert.equal(summary.exit_code, 65);
  assert.ok(summary.reason_codes.includes("empty_tier"));
  assert.ok(summary.reason_codes.includes("known_fact_empty_tier"));
  assert.equal(summary.counts.planned, 0);
  assert.ok(summary.known_fact.includes("0 注册场景"));
  assert.deepEqual(validateReleaseLayerSummary(summary), []);
});

test("空 release-real-llm tier → not_run（exit 65），不得当“全部通过”", () => {
  const summary = buildReleaseLayerSummary({ tier: "release-real-llm" });
  assert.equal(summary.status, "not_run");
  assert.equal(summary.exit_code, 65);
  assert.equal(summary.known_fact !== null, true);
  assert.deepEqual(validateReleaseLayerSummary(summary), []);
});

test("registry 有场景但没有 batch 结果 → not_run + batch_missing（不是已知空事实）", () => {
  const summary = buildReleaseLayerSummary({ tier: "release", registered_scenarios: 2 });
  assert.equal(summary.status, "not_run");
  assert.ok(summary.reason_codes.includes("batch_missing"));
  assert.equal(summary.reason_codes.includes("known_fact_empty_tier"), false);
  assert.equal(summary.known_fact, null);
  assert.deepEqual(validateReleaseLayerSummary(summary), []);
});

test("非法 tier 拒绝（release layer 不得承载 nightly）", () => {
  assert.throws(() => buildReleaseLayerSummary({ tier: "nightly" }), /release layer 只接受/);
  assert.throws(() => buildReleaseLayerSummary({}), /release layer 只接受/);
});

// ---------- 确定性 release 层 ----------

test("确定性 release 层：机制 pass + model_behavior=not_applicable → pass 且分层记录", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release",
    surface: "tauri",
    provider: "slice_verify",
    results: [deterministicResult()],
    git_head: "1ce14d5b",
  });
  assert.equal(summary.status, "pass");
  assert.equal(summary.exit_code, 0);
  assert.deepEqual(summary.counts, { planned: 1, executed: 1, pass: 1, fail: 0, skipped: 0, not_run: 0, evidence_missing: 0 });
  assert.equal(summary.layers.mechanism.pass, 1);
  assert.equal(summary.layers.model_behavior.not_applicable, 1);
  assert.equal(summary.layers.model_behavior.pass, 0);
  assert.equal(summary.separation.single_verdict_allowed, false);
  assert.deepEqual(validateReleaseLayerSummary(summary), []);
});

test("确定性 provider 批次写成 model_behavior=pass → fail（stub 不得代签真实模型行为）", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release",
    results: [
      deterministicResult({
        model_behavior: { status: "pass", evidence_refs: ["http-200"] },
      }),
    ],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("deterministic_tier_model_behavior_pass"));
});

test("release 层混入真实 provider 结果 → fail provider class mismatch（不合并单一 PASS）", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release",
    results: [deterministicResult(), realModelResult()],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("tier_provider_class_mismatch"));
  assert.equal(summary.separation.mixed_provider_classes, true);
});

test("nightly 确定性 batch 的 pass 不能提升为 release-real-llm PASS", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    provider: "slice_verify",
    results: [deterministicResult({ model_behavior: { status: "not_applicable", evidence_refs: [] } })],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("tier_provider_class_mismatch"));
});

// ---------- 真实模型层反假绿 ----------

test("真实模型 PASS：只有 HTTP 200（无响应正文）→ fail http_200_only", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [
      realModelResult({
        model_behavior_evidence: { real_provider_calls: 4, provider_responses_with_body: 0, http_2xx: 4 },
      }),
    ],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("http_200_only"));
  assert.equal(summary.layers.model_behavior.pass, 1, "层记录保留，但结果层已判 fail");
});

test("真实模型 PASS：没有真实 provider 调用 → fail no_real_provider_call", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [
      realModelResult({
        model_behavior_evidence: { real_provider_calls: 0, provider_responses_with_body: 0, http_2xx: 0 },
      }),
    ],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("no_real_provider_call"));
});

test("真实模型 PASS：独立重复不足 2 次 → fail insufficient_repeats", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [
      realModelResult({
        attempt: 1,
        runs: [{ attempt: 1, status: "pass" }],
      }),
    ],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("insufficient_repeats"));
  assert.equal(DEFAULT_PLANNED_RUNS["release-real-llm"], 2);
});

test("真实模型 PASS：重复中出现失败（入分母）→ fail repeat_failure_in_denominator", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [
      realModelResult({
        runs: [
          { attempt: 1, status: "pass" },
          { attempt: 2, status: "fail", reason: "format_invalid_json" },
        ],
      }),
    ],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("repeat_failure_in_denominator"));
});

test("真实模型 PASS：缺少未调词保留措辞 → fail missing_retention_wording", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    results: [realModelResult({ retention_wording: null })],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("missing_retention_wording"));
});

test("真实模型 PASS：实际模型身份缺失 → evidence_missing（不是 PASS，也不是伪造 fail 结论）", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [realModelResult({ actual_model: null })],
  });
  assert.equal(summary.status, "evidence_missing");
  assert.equal(summary.exit_code, 67);
  assert.ok(summary.reason_codes.includes("missing_model_identity"));
});

test("真实模型 PASS：缺少参数/驱动身份 → evidence_missing", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [realModelResult({ params: null, driver: null })],
  });
  assert.equal(summary.status, "evidence_missing");
  assert.ok(summary.reason_codes.includes("missing_model_params"));
  assert.ok(summary.reason_codes.includes("missing_driver_identity"));
});

test("真实模型 PASS：观察未进入后续真实请求（CP2 链接为空）→ fail observation_not_linked", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [
      realModelResult({
        requires_observation_link: true,
        evidence_chain: {
          binding: {
            binding_status: "partial",
            reason_codes: ["observation_not_linked_to_provider_call"],
            observation_link_count: 1,
            real_observation_link_count: 0,
            used_bound_count: 0,
            used_unbound_count: 0,
          },
        },
      }),
    ],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("observation_not_linked"));
});

test("真实模型 PASS：完全没有 CP2 证据链（局部证据）→ evidence_missing", () => {
  const result = realModelResult();
  delete result.evidence_chain;
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [result],
  });
  assert.equal(summary.status, "evidence_missing");
  assert.ok(summary.reason_codes.includes("evidence_chain_missing"));
});

test("真实模型 PASS：CP2 证据链越界 → fail evidence_chain_violated", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [
      realModelResult({
        evidence_chain: {
          binding: {
            binding_status: "violated",
            reason_codes: ["unbound_ref"],
            observation_link_count: 1,
            real_observation_link_count: 1,
            used_bound_count: 0,
            used_unbound_count: 1,
          },
        },
      }),
    ],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("evidence_chain_violated"));
});

test("真实模型 PASS：CP3 原生 run 失败（final/failure 并存）→ fail native_failure_present", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [
      realModelResult({
        native_run: {
          status: "fail",
          failure: { found: true },
          full_matrix_established: false,
        },
      }),
    ],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("native_failure_present"));
});

test("真实模型 PASS：scoped 原生 run 不得当全矩阵 → fail native_scope_not_full", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [
      realModelResult({
        requires_full_matrix: true,
        native_run: { status: "pass", failure: { found: false }, full_matrix_established: false },
      }),
    ],
  });
  assert.equal(summary.status, "fail");
  assert.ok(summary.reason_codes.includes("native_scope_not_full"));
});

test("真实模型 PASS：重复/保留措辞/身份/证据链全部满足 → pass（机制与模型行为分开记录）", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    surface: "tauri",
    provider: "strata",
    results: [realModelResult()],
    retention_wording: retention(),
    git_head: "1ce14d5b",
  });
  assert.equal(summary.status, "pass");
  assert.equal(summary.exit_code, 0);
  assert.equal(summary.layers.model_behavior.pass, 1);
  assert.equal(summary.layers.mechanism.pass, 1);
  assert.equal(summary.replay.scenes[0].actual_model, "iq3_s");
  assert.equal(summary.replay.scenes[0].retention_wording_ref, "artifacts/x/retention.md");
  assert.deepEqual(validateReleaseLayerSummary(summary), []);
});

// ---------- blocked / fail 汇总 ----------

test("blocked/skipped 场景（凭据缺失）→ 整 tier skipped exit 65，不得 PASS", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    results: [
      {
        scenario_id: "au15-a1-real",
        status: "skipped",
        reason: "credential_blocked: LM Studio 不可用",
        provider: "strata",
      },
    ],
  });
  assert.equal(summary.status, "skipped");
  assert.equal(summary.exit_code, 65);
  assert.ok(summary.reason_codes.includes("blocked_scenarios_present"));
  assert.equal(summary.blocked_scenarios.length, 1);
});

test("执行失败的场景 → 整 tier fail exit 1（fail 优先于 evidence_missing）", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release",
    results: [deterministicResult(), deterministicResult({ scenario_id: "release-fail", status: "fail", reason: "assertion_failed" })],
  });
  assert.equal(summary.status, "fail");
  assert.equal(summary.exit_code, 1);
  assert.equal(summary.counts.fail, 1);
});

test("resultsFromBatch：batch.json 的 fail/evidence_missing 状态原样保留，不臆造 PASS", () => {
  const batch = {
    schema_version: "quality-batch/v1",
    batch_id: "b1",
    tier: "release",
    provider: "slice_verify",
    scenarios: [
      { scenario_id: "a", status: "pass", artifact_dir: "artifacts/x/a" },
      { scenario_id: "b", status: "evidence_missing", artifact_dir: "artifacts/x/b" },
    ],
  };
  const results = resultsFromBatch(batch);
  assert.equal(results.length, 2);
  assert.equal(results[1].status, "evidence_missing");
  assert.equal(results[1].mechanism, null);
  // mechanism 缺失 → evidence_missing（不得因 batch status=pass 就 PASS）。
  const summary = buildReleaseLayerSummary({ tier: "release", results });
  assert.equal(summary.status, "evidence_missing");
});

test("writeReleaseLayerSummary 拒绝覆盖既有结果（只增不删）", (t) => {
  const dir = tmpDir(t);
  const summary = buildReleaseLayerSummary({ tier: "release" });
  const written = writeReleaseLayerSummary(dir, summary);
  assert.ok(fs.existsSync(written.path));
  assert.throws(() => writeReleaseLayerSummary(dir, summary), /拒绝覆盖/);
  assert.equal(writeReleaseLayerSummary(dir, summary, { overwrite: true }).ok, true);
});

test("validateReleaseLayerSummary：status=pass 但含 model_behavior=fail 的 history 被拒绝", () => {
  const summary = buildReleaseLayerSummary({
    tier: "release-real-llm",
    retention_wording: retention(),
    results: [realModelResult()],
    git_head: "1ce14d5b",
  });
  const broken = {
    ...summary,
    layers: { ...summary.layers, model_behavior: { ...summary.layers.model_behavior, fail: 1 } },
  };
  assert.ok(validateReleaseLayerSummary(broken).length > 0);
});

// ---------- CLI：真实历史证据只读验证 ----------

const AU10_DIR = path.join(REPO_ROOT, "artifacts/slice-verify/au10-micro-plan-entry");
const P1_NATIVE_DIR = path.join(REPO_ROOT, "artifacts/slice-verify/p1-chapter-draft-generation-native");

function writeBatchFixture(t, { tier, provider, rows }) {
  const dir = tmpDir(t, "release-layer-batch-");
  const batch = {
    schema_version: "quality-batch/v1",
    batch_id: "fixture-batch",
    tier,
    surface: "tauri",
    provider,
    git_head: "1ce14d5b",
    started_at: "2026-10-27T13:00:00Z",
    finished_at: "2026-10-27T13:01:00Z",
    exit_code: 0,
    counts: { pass: rows.length, fail: 0, skipped: 0, evidence_missing: 0, not_run: 0 },
    scenarios: rows,
  };
  const file = path.join(dir, "batch.json");
  fs.writeFileSync(file, JSON.stringify(batch, null, 2));
  return file;
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env },
  });
}

test("CLI：空 release-real-llm tier → exit 65 + JSON status=not_run + known_fact", () => {
  const result = runCli(["summarize", "--tier", "release-real-llm", "--json"]);
  assert.equal(result.status, 65, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.schema_version, RELEASE_LAYER_SCHEMA_VERSION);
  assert.equal(summary.status, "not_run");
  assert.equal(summary.exit_code, 65);
  assert.equal(summary.known_fact !== null, true);
});

test("CLI：tier 与 batch 不一致 → exit 66（跨 tier 不合并）", () => {
  const file = writeBatchFixture(test, {
    tier: "release",
    provider: "slice_verify",
    rows: [{ scenario_id: "x", status: "pass", artifact_dir: "artifacts/slice-verify/x" }],
  });
  const result = runCli(["summarize", "--tier", "release-real-llm", "--batch", file]);
  assert.equal(result.status, 66);
  assert.match(result.stderr, /tier/);
});

test("CLI：真实 au10 verdict 作为 release 层机制证据 → pass；输出 JSON 可回放", { skip: !fs.existsSync(path.join(AU10_DIR, "verdict.json")) }, () => {
  const file = writeBatchFixture(test, {
    tier: "release",
    provider: "slice_verify",
    rows: [
      {
        scenario_id: "au10-micro-plan-entry",
        status: "pass",
        artifact_dir: AU10_DIR,
      },
    ],
  });
  const outDir = path.join(os.tmpdir(), `release-layer-out-${process.pid}-${Date.now()}`);
  test.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const result = runCli(["summarize", "--tier", "release", "--batch", file, "--json", "--out", outDir, "--overwrite"]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, "pass");
  assert.equal(summary.layers.model_behavior.not_applicable, 1);
  assert.equal(summary.replay.scenes[0].provider, "slice_verify");
  assert.equal(summary.replay.scenes[0].provider_class, "deterministic");
  assert.ok(fs.existsSync(path.join(outDir, "release-layer.json")));
  assert.equal(validateReleaseLayerSummary(summary).length, 0);
});

test("CLI：真实原生实模旧证据不能提升成 release-real-llm PASS → evidence_missing exit 67", { skip: !fs.existsSync(P1_NATIVE_DIR) }, () => {
  const file = writeBatchFixture(test, {
    tier: "release-real-llm",
    provider: "strata",
    rows: [
      {
        scenario_id: "p1-chapter-draft-generation",
        status: "pass",
        artifact_dir: P1_NATIVE_DIR,
      },
    ],
  });
  const result = runCli([
    "summarize",
    "--tier",
    "release-real-llm",
    "--batch",
    file,
    "--retention-text",
    "未参与调词的保留措辞",
    "--retention-ref",
    "artifacts/p1-retention.md",
    "--json",
  ]);
  assert.equal(result.status, 67, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, "evidence_missing");
  assert.equal(summary.layers.model_behavior.pass, 0);
  assert.equal(summary.separation.single_verdict_allowed, false);
  // 历史 artifact 缺 verdict/model_behavior/重复元数据 → 只能是 evidence_missing，不能冒充 PASS。
  assert.ok(summary.reason_codes.some((code) => code.startsWith("missing_") || code === "mechanism_layer_missing"));
});
