// B41 CP3：E2E 聚合器状态判定纯函数回归（node --test）。
//
// 全部用内存 fixture，不依赖真实 artifacts、不跑 Tauri/模型。
// 重点负例：旧 summary 存在但无 git_head → stale；registry blocked（历史 E4 降级场景）即使
// 新 verdict/summary 判 pass 也必须 blocked；fail 优先于 blocked/evidence_missing。
// B40 CP3：e2e-01-downgrade-real-page 已退役，E4 聚合矩阵改指 agent-step-regate；
// 新增回归用例验证 replacement 只有在 current fresh verdict 下才 pass。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AGGREGATE_EXIT_CODES,
  AGGREGATE_SCHEMA_VERSION,
  AGGREGATE_STATUSES,
  SCENARIO_STATUSES,
  aggregateExitCode,
  aggregateStatus,
  buildAggregateSummary,
  buildAggregateVerdict,
  checkArtifactContent,
  checkFreshness,
  commitMatches,
  classifyArtifact,
  classifyCommand,
  classifyRegistryEntry,
  evaluateScenario,
  exitCodeForAggregateStatus,
  scenarioStatusCounts,
} from "./e2e_status.mjs";

const HEAD = "ad6b7ae8fc72d61186147c83a51c7d332e196bea";
const OLD_HEAD = "bf879e7d0123456789abcdef0123456789abcdef";
const ARTIFACT = "artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio/summary.json";
const SLICE_ID = "au01-ordinary-chat-two-turn-roundtrip";
const GENERATED_AT = "2026-10-27T12:00:00.000Z";
const STARTED_AT = "2026-10-27T11:58:00.000Z";

function legacySummary(overrides = {}) {
  return {
    slice_id: SLICE_ID,
    provider: "lmstudio",
    surface: "tauri",
    lmstudio: { request_count: 2 },
    behavior: { assertions: ["lmstudio_form_frame_called_per_turn"] },
    ...overrides,
  };
}

function contentExpectations(overrides = {}) {
  return {
    slice_ids: [SLICE_ID],
    provider: "lmstudio",
    surface: "tauri",
    assertions: ["lmstudio_form_frame_called_per_turn"],
    ...overrides,
  };
}

function registryEntry(status = "active", overrides = {}) {
  return {
    scenario_id: SLICE_ID,
    entry: {
      id: SLICE_ID,
      status,
      blocked_reason: status === "blocked" ? "测试用 blocked 原因" : null,
      tier: "nightly",
      surface: "tauri",
      ...overrides,
    },
  };
}

function artifactFixture(overrides = {}) {
  return {
    rel_path: ARTIFACT,
    found: true,
    summary: legacySummary(),
    expectations: contentExpectations(),
    ...overrides,
  };
}

function freeVerdict(overrides = {}) {
  return {
    schema_version: "quality-verdict/v2",
    scenario_id: SLICE_ID,
    tier: "nightly",
    surface: "tauri",
    status: "pass",
    reason: "fixture verdict",
    reason_codes: [],
    driver: "external-ui-driver",
    provider: "lmstudio",
    model: "fixture-model",
    actual_model: "fixture-model",
    git_head: HEAD,
    artifact_dir: "artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio",
    generated_at: GENERATED_AT,
    artifact_links: [],
    evidence_required: [],
    evidence_present: [],
    evidence_missing: [],
    mechanism: { status: "pass", evidence_refs: [] },
    model_behavior: { status: "pass", evidence_refs: [] },
    final_refs: [],
    failure_refs: [],
    scoped_refs: [],
    ...overrides,
  };
}

function evaluateOne(overrides = {}) {
  return evaluateScenario({
    id: "E1",
    name: "普通聊天全链路",
    registry_entries: [registryEntry()],
    artifacts: [artifactFixture()],
    commands: [],
    current_head: HEAD,
    expected_surface: "tauri",
    ...overrides,
  });
}

function blockedE4(artifactOverrides = {}) {
  return evaluateScenario({
    id: "E4",
    name: "Provider 策略降级",
    registry_entries: [
      {
        scenario_id: "e2e-01-downgrade-real-page",
        entry: {
          id: "e2e-01-downgrade-real-page",
          status: "blocked",
          blocked_reason:
            "判断纪元（ADR-0025）后生产主链已无 multi-step MicroPlan 生产者；待 B40 重锚或退役",
          tier: "nightly",
          surface: "tauri",
        },
      },
    ],
    artifacts: [
      {
        rel_path: "artifacts/slice-verify/e2e-01-downgrade-real-page-tauri-lmstudio/summary.json",
        found: true,
        verdict: freeVerdict({
          scenario_id: "e2e-01-downgrade-real-page",
          git_head: HEAD,
        }),
        summary: legacySummary({ slice_id: "e2e-01-downgrade-real-page" }),
        expectations: contentExpectations({
          slice_ids: ["e2e-01-downgrade-real-page"],
          assertions: [],
        }),
        ...artifactOverrides,
      },
    ],
    commands: [],
    current_head: HEAD,
    expected_surface: "tauri",
  });
}

// ---------------------------------------------------------------- 词表/退出码

test("内部场景词表与聚合词表/退出码冻结，聚合 verdict 不冒充 CP4 v2", () => {
  assert.deepEqual([...SCENARIO_STATUSES], [
    "pass",
    "fail",
    "blocked",
    "stale",
    "evidence_missing",
    "not_run",
  ]);
  // 聚合专有词表：blocked 是 manifest 状态，不作为聚合执行结果。
  assert.deepEqual([...AGGREGATE_STATUSES], [
    "pass",
    "fail",
    "skipped",
    "not_run",
    "evidence_missing",
  ]);
  assert.ok(!AGGREGATE_STATUSES.includes("blocked"));
  assert.deepEqual({ ...AGGREGATE_EXIT_CODES }, {
    pass: 0,
    fail: 1,
    skipped: 69,
    not_run: 69,
    evidence_missing: 67,
  });
  assert.equal(AGGREGATE_SCHEMA_VERSION, "quality-aggregate/v1");
  assert.equal(exitCodeForAggregateStatus("pass"), 0);
  assert.equal(exitCodeForAggregateStatus("fail"), 1);
  assert.equal(exitCodeForAggregateStatus("skipped"), 69);
  assert.equal(exitCodeForAggregateStatus("not_run"), 69);
  assert.equal(exitCodeForAggregateStatus("evidence_missing"), 67);
  assert.throws(() => exitCodeForAggregateStatus("blocked"), /未知聚合状态/);
  // 只有整批 blocked（无任何执行）才用 65；有 pass 的批量按 0 语义。
  assert.equal(aggregateExitCode({ status: "skipped", scenarios: [{ status: "blocked" }] }), 65);
  assert.equal(
    aggregateExitCode({ status: "pass", scenarios: [{ status: "pass" }, { status: "blocked" }] }),
    0,
  );
});

// ------------------------------------------------------------------ freshness

test("freshness：git_head 与当前 HEAD 一致才 current", () => {
  const fresh = checkFreshness({ git_head: HEAD }, HEAD);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.source, "git_head");
});

test("freshness：显式 current 标记可证明 current", () => {
  assert.equal(checkFreshness({ current: true }, HEAD).fresh, true);
  assert.equal(checkFreshness({ freshness: "current" }, HEAD).fresh, true);
  assert.equal(checkFreshness({ freshness: { status: "current" } }, HEAD).fresh, true);
});

test("freshness：旧证据无 git_head/current 标记 → stale（存在不等于 PASS）", () => {
  const result = checkFreshness(legacySummary(), HEAD);
  assert.equal(result.fresh, false);
  assert.equal(result.git_head, null);
  assert.match(result.reason, /没有 git_head\/current 标记/);
});

test("freshness：git_head 与当前 HEAD 不一致 → stale", () => {
  const result = checkFreshness({ git_head: OLD_HEAD }, HEAD);
  assert.equal(result.fresh, false);
  assert.match(result.reason, /不一致/);
  assert.equal(result.git_head, OLD_HEAD);
});

test("freshness：git_head 为当前 HEAD 的合法短哈希（≥7 位）→ fresh（B40/B41 hotfix）", () => {
  const shortHead = HEAD.slice(0, 7);
  const result = checkFreshness({ git_head: shortHead }, HEAD);
  assert.equal(result.fresh, true);
  assert.match(result.reason, /短哈希/);
  assert.equal(commitMatches(shortHead, HEAD), true);
  assert.equal(commitMatches(HEAD.slice(0, 12), HEAD), true);
});

test("freshness：短哈希不是当前 HEAD 前缀或短于 7 位 → stale", () => {
  assert.equal(checkFreshness({ git_head: OLD_HEAD.slice(0, 7) }, HEAD).fresh, false);
  assert.equal(commitMatches("ad6b7ae", HEAD), true);
  assert.equal(commitMatches("ad6b7a", HEAD), false);
  assert.equal(commitMatches("deadbee", HEAD), false);
  assert.equal(checkFreshness({ current: true, git_head: HEAD.slice(0, 7) }, HEAD).fresh, true);
});

test("freshness：当前 HEAD 不可用或 current 标记与 git_head 矛盾 → 不 fresh", () => {
  assert.equal(checkFreshness({ git_head: HEAD }, null).fresh, false);
  assert.equal(checkFreshness({ git_head: HEAD }, "").fresh, false);
  assert.equal(checkFreshness({ git_head: OLD_HEAD, current: true }, HEAD).fresh, false);
});

test("freshness：非对象证据记录 → 不 fresh", () => {
  assert.equal(checkFreshness(null, HEAD).fresh, false);
});

// ------------------------------------------------------------- artifact 内容

test("内容校验：来源与断言齐全的 legacy summary 通过", () => {
  const result = checkArtifactContent(legacySummary(), contentExpectations(), {
    source: "summary",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("内容校验：slice_id / provider / surface 不匹配分别报错", () => {
  const slice = checkArtifactContent(legacySummary({ slice_id: "other-slice" }), contentExpectations(), {
    source: "summary",
  });
  assert.deepEqual(slice.sourceErrors.map((error) => error.code), ["slice_mismatch"]);

  const provider = checkArtifactContent(legacySummary({ provider: "slice_verify" }), contentExpectations(), {
    source: "summary",
  });
  assert.deepEqual(provider.sourceErrors.map((error) => error.code), ["provider_mismatch"]);

  const surface = checkArtifactContent(legacySummary({ surface: "browser" }), contentExpectations(), {
    source: "summary",
  });
  assert.deepEqual(surface.sourceErrors.map((error) => error.code), ["surface_mismatch"]);
});

test("内容校验：缺断言与 lmstudio 调用数为 0 → 内容错误", () => {
  const missing = checkArtifactContent(
    legacySummary({ behavior: { assertions: [] } }),
    contentExpectations(),
    { source: "summary" },
  );
  assert.deepEqual(missing.contentErrors.map((error) => error.code), ["assertion_missing"]);

  const noRequest = checkArtifactContent(
    legacySummary({ lmstudio: { request_count: 0 } }),
    contentExpectations(),
    { source: "summary" },
  );
  assert.deepEqual(noRequest.contentErrors.map((error) => error.code), ["lmstudio_request_missing"]);
});

test("内容校验：legacy summary 自带 failed/blocked 状态不能当通过证据", () => {
  for (const status of ["failed", "blocked", "error"]) {
    const result = checkArtifactContent(legacySummary({ status }), contentExpectations(), {
      source: "summary",
    });
    assert.deepEqual(result.sourceErrors.map((error) => error.code), ["summary_status_not_pass"]);
  }
});

test("内容校验：verdict 缺 driver 视为来源链不完整", () => {
  const result = checkArtifactContent(freeVerdict({ driver: null }), contentExpectations(), {
    source: "verdict",
  });
  assert.deepEqual(result.sourceErrors.map((error) => error.code), ["driver_missing"]);
});

test("artifact：verdict 缺 driver/provider → evidence_missing（CP4 R2 来源链无效）", () => {
  for (const override of [{ driver: null }, { provider: null }]) {
    const result = classifyArtifact({
      rel_path: ARTIFACT,
      found: true,
      verdict: freeVerdict(override),
      summary: legacySummary({ git_head: HEAD }),
      expectations: contentExpectations(),
      current_head: HEAD,
    });
    assert.equal(result.status, "evidence_missing");
    assert.deepEqual(result.reason_codes, ["verdict_source_incomplete"]);
  }
});

// ------------------------------------------------------------------ registry

test("registry：active / blocked / draft / null / 未知状态的判定", () => {
  assert.equal(classifyRegistryEntry(registryEntry().entry, { scenarioId: SLICE_ID }).status, "active");

  const blocked = classifyRegistryEntry(
    registryEntry("blocked", { blocked_reason: "多步 MicroPlan 不可达" }).entry,
    { scenarioId: "e2e-01-downgrade-real-page" },
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blocked_reason, "多步 MicroPlan 不可达");

  assert.equal(classifyRegistryEntry(registryEntry("draft").entry, { scenarioId: SLICE_ID }).status, "fail");
  assert.equal(
    classifyRegistryEntry({ id: SLICE_ID, status: null }, { scenarioId: SLICE_ID }).status,
    "fail",
  );
  assert.equal(
    classifyRegistryEntry({ id: SLICE_ID, status: "retired" }, { scenarioId: SLICE_ID }).status,
    "fail",
  );
  assert.equal(classifyRegistryEntry(null, { scenarioId: SLICE_ID }).status, "fail");
});

test("registry：blocked 缺 reason 也不能静默通过", () => {
  const result = classifyRegistryEntry({ id: SLICE_ID, status: "blocked", blocked_reason: null });
  assert.equal(result.status, "blocked");
  assert.match(result.blocked_reason, /未提供 blocked_reason/);
});

// --------------------------------------------------------- classifyArtifact

test("artifact：不存在 → evidence_missing", () => {
  const result = classifyArtifact({ rel_path: ARTIFACT, found: false });
  assert.equal(result.status, "evidence_missing");
  assert.deepEqual(result.reason_codes, ["artifact_missing"]);
});

test("artifact：旧 summary 存在但无 git_head → stale，绝不 pass", () => {
  const result = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    summary: legacySummary(),
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(result.status, "stale");
  assert.equal(result.evidence_source, "legacy_summary");
  assert.match(result.reason, /不是当前 HEAD 证据（存在不等于 PASS）/);
  assert.notEqual(result.status, "pass");
});

test("artifact：旧 summary 带当前 git_head 且内容齐全 → pass", () => {
  const result = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    summary: legacySummary({ git_head: HEAD }),
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(result.status, "pass");
  assert.equal(result.freshness.fresh, true);
});

test("artifact：旧 summary 旧 git_head → stale", () => {
  const result = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    summary: legacySummary({ git_head: OLD_HEAD }),
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(result.status, "stale");
  assert.equal(result.freshness.git_head, OLD_HEAD);
});

test("artifact：provider 不匹配即使历史证据也 fail（来源检查优先）", () => {
  const result = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    summary: legacySummary({ provider: "slice_verify" }),
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.reason_codes, ["provider_mismatch"]);
});

test("artifact：当前 HEAD summary 缺断言 → fail", () => {
  const result = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    summary: legacySummary({ git_head: HEAD, behavior: { assertions: [] } }),
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.reason_codes, ["assertion_missing"]);
});

test("artifact：verdict_cli 判定 legacy_summary 时回落 summary 判定（旧证据 stale）", () => {
  const result = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    verdict: { status: "evidence_missing", legacy_summary: true },
    legacy_summary: true,
    summary: legacySummary(),
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(result.evidence_source, "legacy_summary");
  assert.equal(result.status, "stale");
});

test("artifact：fresh verdict pass → pass；旧 HEAD verdict pass → stale", () => {
  const fresh = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    verdict: freeVerdict(),
    summary: legacySummary(),
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(fresh.status, "pass");
  assert.equal(fresh.evidence_source, "verdict");

  const stale = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    verdict: freeVerdict({ git_head: OLD_HEAD }),
    summary: legacySummary(),
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(stale.status, "stale");
});

test("artifact：verdict 判 fail/skipped/evidence_missing/非法状态各自映射", () => {
  const base = {
    rel_path: ARTIFACT,
    found: true,
    summary: legacySummary(),
    expectations: contentExpectations(),
    current_head: HEAD,
  };
  assert.equal(classifyArtifact({ ...base, verdict: freeVerdict({ status: "fail" }) }).status, "fail");
  assert.equal(
    classifyArtifact({ ...base, verdict: freeVerdict({ status: "skipped" }) }).status,
    "not_run",
  );
  assert.equal(
    classifyArtifact({ ...base, verdict: freeVerdict({ status: "not_run" }) }).status,
    "not_run",
  );
  assert.equal(
    classifyArtifact({ ...base, verdict: freeVerdict({ status: "evidence_missing" }) }).status,
    "evidence_missing",
  );
  const invalid = classifyArtifact({ ...base, verdict: freeVerdict({ status: "accepted" }) });
  assert.equal(invalid.status, "evidence_missing");
  assert.deepEqual(invalid.reason_codes, ["verdict_invalid"]);
});

test("artifact：verdict 读取失败与 summary 解析失败都是 fail，不静默缺失", () => {
  const verdictError = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    verdict: freeVerdict(),
    verdict_read_error: "CLI exit 67",
    summary: legacySummary(),
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(verdictError.status, "fail");
  assert.deepEqual(verdictError.reason_codes, ["verdict_read_error"]);

  const summaryError = classifyArtifact({
    rel_path: ARTIFACT,
    found: true,
    summary_read_error: "Unexpected token",
    expectations: contentExpectations(),
    current_head: HEAD,
  });
  assert.equal(summaryError.status, "fail");
  assert.deepEqual(summaryError.reason_codes, ["summary_read_error"]);
});

// ------------------------------------------------------------------- command

test("命令判定：exit 0=pass、非 0=fail、显式 skip=skipped、无记录=not_run", () => {
  assert.equal(classifyCommand({ name: "a", exit_code: 0 }).status, "pass");
  assert.equal(classifyCommand({ name: "a", exit_code: 1 }).status, "fail");
  assert.equal(
    classifyCommand({ name: "mix-real-lmstudio", skipped_reason: "provider is slice_verify" }).status,
    "skipped",
  );
  assert.equal(classifyCommand({ name: "b", exit_code: null }).status, "not_run");
});

// ---------------------------------------------------------- evaluateScenario

test("场景：registry blocked（E4）即使旧 summary 存在且新 verdict 判 pass 也必须 blocked", () => {
  const scenario = blockedE4();
  assert.equal(scenario.status, "blocked");
  assert.match(scenario.blocked_reason, /MicroPlan 生产者/);
  assert.match(scenario.reason, /registry=blocked/);
  assert.equal(scenario.artifact_checks[0].status, "pass");
  assert.notEqual(scenario.status, "pass");
});

test("场景：registry blocked 优先于 artifact fail（不把 blocked 当普通失败/通过）", () => {
  const scenario = blockedE4({ verdict: freeVerdict({ status: "fail" }) });
  assert.equal(scenario.status, "blocked");
});

test("场景：registry status=null（未注册）→ fail", () => {
  const scenario = evaluateOne({
    registry_entries: [{ scenario_id: SLICE_ID, entry: { id: SLICE_ID, status: null } }],
  });
  assert.equal(scenario.status, "fail");
  assert.deepEqual(scenario.reason_codes, ["registry_source_mismatch"]);
});

test("场景：registry surface 与期望证据 surface 不匹配 → fail", () => {
  const scenario = evaluateOne({
    registry_entries: [registryEntry("active", { surface: "browser" })],
  });
  assert.equal(scenario.status, "fail");
  assert.deepEqual(scenario.reason_codes, ["registry_surface_mismatch"]);
});

test("场景：fresh summary 内容齐全 → pass", () => {
  const scenario = evaluateOne({
    artifacts: [artifactFixture({ summary: legacySummary({ git_head: HEAD }) })],
  });
  assert.equal(scenario.status, "pass");
  assert.equal(scenario.mechanism.status, "not_applicable");
});

test("场景：旧 summary 存在但缺 freshness → stale（不是 pass）", () => {
  const scenario = evaluateOne();
  assert.equal(scenario.status, "stale");
  assert.notEqual(scenario.status, "pass");
});

test("场景：fail 优先于 stale，stale 优先于缺失", () => {
  const failPlusStale = evaluateOne({
    artifacts: [
      artifactFixture(),
      artifactFixture({ rel_path: "artifacts/slice-verify/other/summary.json" }),
    ],
  });
  assert.equal(failPlusStale.status, "stale");

  const failed = evaluateOne({
    artifacts: [
      artifactFixture(),
      artifactFixture({
        rel_path: "artifacts/slice-verify/other/summary.json",
        summary: legacySummary({ provider: "slice_verify" }),
      }),
    ],
  });
  assert.equal(failed.status, "fail");

  const stalePlusMissing = evaluateOne({
    artifacts: [
      artifactFixture(),
      artifactFixture({ rel_path: "artifacts/slice-verify/missing/summary.json", found: false, summary: null }),
    ],
  });
  assert.equal(stalePlusMissing.status, "stale");

  const missing = evaluateOne({
    artifacts: [artifactFixture({ found: false, summary: null })],
  });
  assert.equal(missing.status, "evidence_missing");
});

test("场景：命令失败 → fail（机制失败不可被证据状态掩盖）", () => {
  const scenario = evaluateOne({
    artifacts: [artifactFixture({ summary: legacySummary({ git_head: HEAD }) })],
    commands: [{ name: "mix-e2e-integration", exit_code: 1, log: "mix-e2e-integration.log" }],
  });
  assert.equal(scenario.status, "fail");
  assert.deepEqual(scenario.reason_codes, ["command_failed"]);
  assert.equal(scenario.mechanism.status, "fail");
});

test("场景：没有独立真实页面 artifact（E10 型）→ evidence_missing，不冒充已验收", () => {
  const scenario = evaluateScenario({
    id: "E10",
    name: "持久化闭环",
    registry_entries: [],
    artifacts: [],
    commands: [
      { name: "mix-e2e-integration", exit_code: 0, log: "mix-e2e-integration.log" },
      { name: "mix-application-real-loop", exit_code: 0, log: "mix-application-real-loop.log" },
    ],
    current_head: HEAD,
  });
  assert.equal(scenario.status, "evidence_missing");
  assert.deepEqual(scenario.reason_codes, ["no_acceptance_artifact"]);
  assert.equal(scenario.mechanism.status, "pass");
});

test("场景：verdict skipped → not_run", () => {
  const scenario = evaluateOne({
    artifacts: [artifactFixture({ verdict: freeVerdict({ status: "skipped" }) })],
  });
  assert.equal(scenario.status, "not_run");
});

// --------------------------------------------------------------- 聚合判定

test("聚合：全部场景 pass 且命令成功 → pass/0", () => {
  const scenarios = [
    evaluateOne({ artifacts: [artifactFixture({ summary: legacySummary({ git_head: HEAD }) })] }),
  ];
  const aggregate = aggregateStatus({
    scenarios,
    commands: [{ name: "mix-e2e-integration", exit_code: 0 }],
  });
  assert.equal(aggregate.status, "pass");
  assert.equal(exitCodeForAggregateStatus(aggregate.status), 0);
});

test("聚合：任一场景 fail → fail/1", () => {
  const scenarios = [
    evaluateOne({ artifacts: [artifactFixture({ summary: legacySummary({ git_head: HEAD }) })] }),
    evaluateOne({
      id: "E2",
      artifacts: [artifactFixture({ summary: legacySummary({ provider: "slice_verify" }) })],
    }),
  ];
  const aggregate = aggregateStatus({ scenarios, commands: [] });
  assert.equal(aggregate.status, "fail");
  assert.equal(exitCodeForAggregateStatus(aggregate.status), 1);
});

test("聚合：fail 优先于 blocked（有 fail 优先 1）", () => {
  const scenarios = [blockedE4(), evaluateOne({ artifacts: [artifactFixture()] })];
  // 构造一个 fail 场景：内容来源不匹配
  scenarios.push(
    evaluateOne({
      id: "E2",
      artifacts: [artifactFixture({ summary: legacySummary({ provider: "slice_verify" }) })],
    }),
  );
  const aggregate = aggregateStatus({ scenarios, commands: [] });
  assert.equal(aggregate.status, "fail");
  assert.equal(exitCodeForAggregateStatus(aggregate.status), 1);
});

test("聚合：blocked + stale → evidence_missing/67（blocked 不是执行结果，stale 缺口优先）", () => {
  const scenarios = [blockedE4(), evaluateOne()];
  const aggregate = aggregateStatus({ scenarios, commands: [] });
  assert.equal(aggregate.status, "evidence_missing");
  assert.equal(aggregateExitCode({ status: aggregate.status, scenarios }), 67);
  assert.ok(!AGGREGATE_STATUSES.includes("blocked"));
});

test("聚合：整批 blocked（没有任何执行）→ skipped，退出码 65", () => {
  const scenarios = [blockedE4()];
  const aggregate = aggregateStatus({ scenarios, commands: [] });
  assert.equal(aggregate.status, "skipped");
  assert.deepEqual(aggregate.reason_codes, ["blocked_batch"]);
  assert.equal(aggregateExitCode({ status: aggregate.status, scenarios }), 65);
});

test("聚合：有 pass 且有 blocked → 批量 pass/0，blocked 明细不隐藏", () => {
  const passScenario = evaluateOne({
    artifacts: [artifactFixture({ summary: legacySummary({ git_head: HEAD }) })],
  });
  const scenarios = [passScenario, blockedE4()];
  const aggregate = aggregateStatus({ scenarios, commands: [] });
  assert.equal(aggregate.status, "pass");
  assert.deepEqual(aggregate.skipped_scenarios, ["E4"]);
  assert.equal(aggregateExitCode({ status: aggregate.status, scenarios }), 0);
});

test("聚合：有 pass 且有 stale → evidence_missing/67，不因部分 pass 判绿", () => {
  const scenarios = [
    evaluateOne({ artifacts: [artifactFixture({ summary: legacySummary({ git_head: HEAD }) })] }),
    evaluateOne({ id: "E2" }),
  ];
  const aggregate = aggregateStatus({ scenarios, commands: [] });
  assert.equal(aggregate.status, "evidence_missing");
  assert.equal(aggregateExitCode({ status: aggregate.status, scenarios }), 67);
});

test("聚合：无 blocked 但有 stale/缺失 → evidence_missing/67", () => {
  const aggregate = aggregateStatus({ scenarios: [evaluateOne()], commands: [] });
  assert.equal(aggregate.status, "evidence_missing");
  assert.equal(exitCodeForAggregateStatus(aggregate.status), 67);
});

test("聚合：命令失败 → fail，即使所有场景证据 pass", () => {
  const scenarios = [
    evaluateOne({ artifacts: [artifactFixture({ summary: legacySummary({ git_head: HEAD }) })] }),
  ];
  const aggregate = aggregateStatus({
    scenarios,
    commands: [{ name: "mix-e2e-integration", exit_code: 2 }],
  });
  assert.equal(aggregate.status, "fail");
  assert.deepEqual(aggregate.reason_codes, ["command_failed"]);
});

test("聚合：空场景 → not_run/69，不判 pass", () => {
  const aggregate = aggregateStatus({ scenarios: [], commands: [] });
  assert.equal(aggregate.status, "not_run");
  assert.equal(aggregateExitCode({ status: aggregate.status, scenarios: [] }), 69);
});

test("场景计数：六种词表键齐全且按状态累计", () => {
  const counts = scenarioStatusCounts([
    { status: "pass" },
    { status: "stale" },
    { status: "stale" },
    { status: "blocked" },
  ]);
  assert.deepEqual(counts, {
    pass: 1,
    fail: 0,
    blocked: 1,
    stale: 2,
    evidence_missing: 0,
    not_run: 0,
  });
});

// ------------------------------------------------------- verdict/summary 形状

test("verdict：聚合专有 quality-aggregate/v1 字段齐全，不冒充 CP4 v2", () => {
  const verdict = buildAggregateVerdict({
    scenarios: [blockedE4(), evaluateOne()],
    commands: [{ name: "mix-e2e-integration", exit_code: 0, log: "mix-e2e-integration.log" }],
    skipped_commands: [],
    provider: "lmstudio",
    git_head: HEAD,
    generated_at: GENERATED_AT,
    started_at: STARTED_AT,
    artifact_dir: "artifacts/slice-verify/e2e-01-full-chain",
  });
  for (const field of [
    "schema_version",
    "scenario_id",
    "tier",
    "surface",
    "status",
    "artifact_dir",
    "generated_at",
    "git_head",
  ]) {
    assert.ok(field in verdict, `verdict 缺必填字段 ${field}`);
  }
  assert.equal(verdict.schema_version, "quality-aggregate/v1");
  assert.notEqual(verdict.schema_version, "quality-verdict/v2");
  assert.equal(verdict.scenario_id, "e2e-01-full-chain");
  assert.ok(AGGREGATE_STATUSES.includes(verdict.status));
  assert.equal(verdict.status, "evidence_missing");
  assert.ok(["pass", "fail", "unknown", "not_applicable"].includes(verdict.mechanism.status));
  assert.ok(["pass", "fail", "unknown", "not_applicable"].includes(verdict.model_behavior.status));
  for (const link of verdict.artifact_links) {
    assert.ok(["required", "optional", "failure", "scoped"].includes(link.role));
  }
  assert.ok(verdict.scoped_refs.length > 0, "stale/blocked 历史证据应进入 scoped_refs");
  assert.equal(verdict.duration_ms, 120000);
});

test("verdict：命令失败 → mechanism=fail；有 skipped 命令 → mechanism=unknown", () => {
  const failed = buildAggregateVerdict({
    scenarios: [evaluateOne()],
    commands: [{ name: "mix-e2e-integration", exit_code: 1, log: "mix-e2e-integration.log" }],
    git_head: HEAD,
    generated_at: GENERATED_AT,
  });
  assert.equal(failed.mechanism.status, "fail");

  const skipped = buildAggregateVerdict({
    scenarios: [evaluateOne()],
    commands: [{ name: "mix-e2e-integration", exit_code: 0, log: "mix-e2e-integration.log" }],
    skipped_commands: [{ name: "mix-real-lmstudio", status: "skipped", reason: "provider is slice_verify" }],
    git_head: HEAD,
    generated_at: GENERATED_AT,
  });
  assert.equal(skipped.mechanism.status, "unknown");
});

test("verdict：model_behavior 分层——stale lmstudio 证据 unknown、fresh pass 才 pass", () => {
  const stale = buildAggregateVerdict({
    scenarios: [evaluateOne()],
    commands: [],
    provider: "slice_verify",
    git_head: HEAD,
    generated_at: GENERATED_AT,
  });
  assert.equal(stale.model_behavior.status, "unknown");

  const fresh = buildAggregateVerdict({
    scenarios: [evaluateOne({ artifacts: [artifactFixture({ summary: legacySummary({ git_head: HEAD }) })] })],
    commands: [],
    provider: "lmstudio",
    git_head: HEAD,
    generated_at: GENERATED_AT,
  });
  assert.equal(fresh.model_behavior.status, "pass");

  const noModelEvidence = buildAggregateVerdict({
    scenarios: [
      evaluateOne({
        artifacts: [
          artifactFixture({
            summary: legacySummary({ provider: "slice_verify", lmstudio: undefined, git_head: HEAD }),
            expectations: contentExpectations({
              provider: "slice_verify",
              assertions: ["lmstudio_form_frame_called_per_turn"],
            }),
          }),
        ],
      }),
    ],
    commands: [],
    provider: "slice_verify",
    git_head: HEAD,
    generated_at: GENERATED_AT,
  });
  assert.equal(noModelEvidence.model_behavior.status, "not_applicable");
});

test("summary：E4 blocked + 其他场景 stale → 聚合 evidence_missing(67)，blocked 明细保留，不写已验收", () => {
  const summary = buildAggregateSummary({
    scenarios: [blockedE4(), evaluateOne()],
    commands: [{ name: "mix-e2e-integration", exit_code: 0, log: "mix-e2e-integration.log" }],
    skipped_commands: [],
    provider: "lmstudio",
    git_head: HEAD,
    generated_at: GENERATED_AT,
    started_at: STARTED_AT,
    artifact_dir: "artifacts/slice-verify/e2e-01-full-chain",
  });
  assert.equal(summary.status, "evidence_missing");
  assert.equal(summary.exit_code, 67);
  assert.equal(summary.verdict.status, "evidence_missing");
  assert.equal(summary.verdict.schema_version, "quality-aggregate/v1");
  assert.equal(summary.verdict.git_head, HEAD);
  assert.deepEqual(summary.scenario_status_counts, {
    pass: 0,
    fail: 0,
    blocked: 1,
    stale: 1,
    evidence_missing: 0,
    not_run: 0,
  });
  assert.equal(summary.blocked_scenarios.length, 1);
  assert.equal(summary.blocked_scenarios[0].id, "E4");
  assert.match(summary.blocked_scenarios[0].blocked_reason, /MicroPlan/);
  assert.ok(summary.blocked_scenarios[0].artifact_present, "旧 summary 存在也必须 blocked");
  assert.equal(summary.stale_scenarios.length, 1);
  assert.equal(summary.stale_scenarios[0].id, "E1");
  for (const row of summary.e2e_scenarios) {
    assert.ok(!["已验收", "已测试"].includes(row.status), `场景状态不得是旧硬编码词 ${row.status}`);
  }
  assert.ok(!["已验收", "已测试"].includes(summary.status));
  // 旧字段仍存在
  for (const field of [
    "scenario_id",
    "title",
    "generated_at",
    "provider",
    "status",
    "artifact_dir",
    "scenario_status_counts",
    "e2e_scenarios",
    "commands",
    "skipped_commands",
    "artifact_checks",
    "assertions",
    "remaining_gaps",
  ]) {
    assert.ok(field in summary, `summary 缺旧字段 ${field}`);
  }
});

test("summary：status 旧字段与 verdict 不矛盾（pass↔passed、fail↔failed）", () => {
  const passSummary = buildAggregateSummary({
    scenarios: [
      evaluateOne({ artifacts: [artifactFixture({ summary: legacySummary({ git_head: HEAD }) })] }),
    ],
    commands: [{ name: "mix-e2e-integration", exit_code: 0, log: "mix-e2e-integration.log" }],
    provider: "lmstudio",
    git_head: HEAD,
    generated_at: GENERATED_AT,
    artifact_dir: "artifacts/slice-verify/e2e-01-full-chain",
  });
  assert.equal(passSummary.verdict.status, "pass");
  assert.equal(passSummary.status, "passed");
  assert.equal(passSummary.exit_code, 0);
  assert.ok(passSummary.assertions.includes("required_true_page_tauri_artifacts_checked"));

  const failSummary = buildAggregateSummary({
    scenarios: [
      evaluateOne({
        artifacts: [artifactFixture({ summary: legacySummary({ provider: "slice_verify" }) })],
      }),
    ],
    commands: [],
    provider: "slice_verify",
    git_head: HEAD,
    generated_at: GENERATED_AT,
    artifact_dir: "artifacts/slice-verify/e2e-01-full-chain",
  });
  assert.equal(failSummary.verdict.status, "fail");
  assert.equal(failSummary.status, "failed");
  assert.equal(failSummary.exit_code, 1);
});

test("summary：无 blocked 且证据全 stale → evidence_missing(67)", () => {
  const summary = buildAggregateSummary({
    scenarios: [evaluateOne()],
    commands: [],
    provider: "slice_verify",
    git_head: HEAD,
    generated_at: GENERATED_AT,
    artifact_dir: "artifacts/slice-verify/e2e-01-full-chain",
  });
  assert.equal(summary.verdict.status, "evidence_missing");
  assert.equal(summary.status, "evidence_missing");
  assert.equal(summary.exit_code, 67);
  assert.equal(summary.evidence_missing_scenarios.length, 0);
  assert.equal(summary.stale_scenarios.length, 1);
});

test("summary：E10 无 artifact 时 remaining_gaps 按其新状态诚实登记", () => {
  const e10 = evaluateScenario({
    id: "E10",
    name: "持久化闭环",
    registry_entries: [],
    artifacts: [],
    commands: [{ name: "mix-e2e-integration", exit_code: 0, log: "mix-e2e-integration.log" }],
    current_head: HEAD,
  });
  const summary = buildAggregateSummary({
    scenarios: [e10],
    commands: [{ name: "mix-e2e-integration", exit_code: 0, log: "mix-e2e-integration.log" }],
    provider: "slice_verify",
    git_head: HEAD,
    generated_at: GENERATED_AT,
    artifact_dir: "artifacts/slice-verify/e2e-01-full-chain",
  });
  assert.equal(e10.status, "evidence_missing");
  assert.equal(summary.remaining_gaps.length, 1);
  assert.equal(summary.remaining_gaps[0].scenario_id, "E10");
  assert.equal(summary.remaining_gaps[0].status, "evidence_missing");
  assert.equal(summary.e2e_scenarios[0].mechanism.status, "pass");
});

test("summary：e2e_scenarios 状态全部来自新词表，不含硬编码已验收/已测试", () => {
  const summary = buildAggregateSummary({
    scenarios: [blockedE4(), evaluateOne()],
    commands: [],
    provider: "lmstudio",
    git_head: HEAD,
    generated_at: GENERATED_AT,
    artifact_dir: "artifacts/slice-verify/e2e-01-full-chain",
  });
  for (const row of summary.e2e_scenarios) {
    assert.ok(SCENARIO_STATUSES.includes(row.status), `非法场景状态 ${row.status}`);
    assert.ok(row.reason.length > 0);
  }
  assert.equal(summary.verdict.status, "evidence_missing");
  assert.ok(summary.blocked_scenarios.some((row) => row.id === "E4"));
  assert.ok(summary.stale_scenarios.some((row) => row.id === "E1"));
  for (const row of summary.e2e_scenarios) {
    assert.ok(!["已验收", "已测试"].includes(row.status));
  }
  for (const key of Object.keys(summary.scenario_status_counts)) {
    assert.ok(SCENARIO_STATUSES.includes(key), `scenario_status_counts 出现词表外键 ${key}`);
  }
});

// ---------------------------------------------- runner 静态防回归（去假绿）

test("runner：不得残留硬编码「已验收/已测试」场景矩阵，状态必须由 e2e_status 计算", () => {
  const runnerSource = readFileSync(
    new URL("../../e2e_01_full_chain_check.sh", import.meta.url),
    "utf8",
  );
  assert.ok(!/status:\s*"已验收"/.test(runnerSource), "runner 不得硬编码已验收");
  assert.ok(!/status:\s*"已测试"/.test(runnerSource), "runner 不得硬编码已测试");
  assert.ok(!runnerSource.includes("scenarioMatrix"), "旧 scenarioMatrix 硬编码矩阵必须移除");
  assert.ok(runnerSource.includes("scripts/lib/quality/e2e_status.mjs"));
  assert.ok(runnerSource.includes("statusLib.evaluateScenario"));
  assert.ok(runnerSource.includes("statusLib.buildAggregateSummary"));
  assert.ok(runnerSource.includes("manifest_cli.mjs"));
  assert.ok(runnerSource.includes("verdict_cli.mjs"));
  assert.ok(runnerSource.includes("registry-status"));
  assert.ok(runnerSource.includes("summary.exit_code"));
});

// ---------------------------------------------------------------- B40 CP3：E4 retired→replacement

test("E4 replacement agent-step-regate passes only with a current fresh verdict", () => {
  const scenario = evaluateScenario({
    id: "E4",
    name: "Provider/Gate 策略（判断纪元 allow 路径；旧降级场景已退役）",
    registry_entries: [
      {
        scenario_id: "agent-step-regate",
        entry: {
          id: "agent-step-regate",
          status: "active",
          blocked_reason: null,
          tier: "nightly",
          surface: "tauri",
        },
      },
    ],
    artifacts: [
      {
        rel_path: "artifacts/slice-verify/agent-step-regate-tauri/summary.json",
        found: true,
        verdict: freeVerdict({
          scenario_id: "agent-step-regate",
          provider: "slice_verify",
          model: "deterministic",
          actual_model: null,
          model_behavior: { status: "not_applicable", evidence_refs: [] },
          artifact_dir: "artifacts/slice-verify/agent-step-regate-tauri",
        }),
        expectations: {
          slice_ids: ["agent-step-regate"],
          provider: "slice_verify",
          surface: "tauri",
        },
      },
    ],
    commands: [],
    current_head: HEAD,
    expected_surface: "tauri",
  });

  assert.equal(scenario.status, "pass");
  assert.equal(scenario.registry_checks[0].status, "active");
  assert.equal(scenario.artifact_checks[0].status, "pass");
});
