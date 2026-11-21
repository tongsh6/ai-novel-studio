// R01 批次纯报告：模型行为/缺证与测量状态分离，不读文件/DB。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  analyzeAuthorCall,
  canonicalAuthorMessage,
  joinRootRun,
  NATIVE_REPORT_SCHEMA,
  buildNativeReport,
  freshnessFromObservation,
  modelBehaviorOf,
  nativeSummary,
  observationCostSummary,
  observedEffectsOf,
  referenceInvariantsOf,
  semanticReviewOf,
  verifyCallIdentity,
  verifyCheckpoints,
  verifyConfigMatches,
  verifyDriverShape,
  verifySuccessorVisible,
  verifyTurns,
} from "./request_cost_batch_evidence.mjs";
import { analyzeRequestCost } from "./request_cost_evidence.mjs";
import { nativeManifest } from "./fixtures/request_cost_manifest_fixture.mjs";
import { scopeWireMessage } from "./fixtures/authoring_request_ir.mjs";

const turn = (index, kind, fresh = true) => ({
  turn: index,
  author_id: `round-${index}`,
  calls: [
    {
      analysis: {
        ok: true,
        response: { actual_tool_calls: 1 },
        usage: { input_tokens: 10, cached_tokens: 0, output_tokens: 2, cached_within_input: true, cost_input_tokens: 10 },
        request: { sha256: `request-${index}` },
        category_bytes: {
          scope: 1, history: 2, observation: 3, validation: 4, tool_unknown: 0,
          current_author: 5, application_base: 6, tools: 7,
        },
        cross: {
          replay_tool_calls: 2, unclassified_messages: 0, tools_field_present: true,
        },
        totals: { stable_json_bytes: 20 },
      },
    },
  ],
  driver: {
    visible_outcome: { kind },
    run_id: `run-${index}`,
    freshness: { new_author_echo: fresh, terminal_after_new_echo: fresh },
  },
});

test("模型失败/等待是 behavior outcome，不是 measurement fail", () => {
  const behavior = modelBehaviorOf([turn(1, "completed"), turn(2, "failed"), turn(3, "waiting")]);
  assert.equal(behavior.signed, false);
  assert.equal(behavior.scope, "before_only");
  assert.deepEqual(behavior.outcome_counts, { completed: 1, failed: 1, waiting: 1 });
  assert.equal(behavior.outcomes[1].run_id, "run-2");
  assert.equal(behavior.gaps.includes("raw_sse_not_collected"), true);
  const incomplete = modelBehaviorOf([{ turn: 1, author_id: "a", calls: [], driver: null }]);
  assert.equal(incomplete.outcomes[0].visible_outcome, "not_collected");
  assert.equal(incomplete.outcomes[0].provider_calls, 0);
});

test("v2批次采集态与log-only成本子窗口分责，不冒充独立核验", () => {
  assert.equal(NATIVE_REPORT_SCHEMA,"b87-request-cost-native-report/v2");
  const base={config:{length:1},turnReports:[],allCalls:[]};
  const rawTransport={source_scope:"batch_provider_transport_artifacts",raw_http_bytes:"collected_unverified",raw_sse:"collection_incomplete"};
  const current=nativeSummary({...base,rawTransport});
  assert.equal(current.raw_sse,"collection_incomplete");
  assert.equal(current.raw_http_bytes,"collected_unverified");
  assert.equal(current.raw_source_scope,rawTransport.source_scope);
  const logOnly=nativeSummary(base);
  assert.equal(logOnly.raw_sse,"not_collected");
  assert.equal(logOnly.raw_source_scope,"llm_call_logs_only");
});

test("token 聚合保留 known_sum/missing，缺测 total null", () => {
  const calls = [
    turn(1, "completed").calls[0],
    { analysis: { usage: { input_tokens: null, cached_tokens: null, output_tokens: null } } },
  ];
  const summary = nativeSummary({ config: { length: 2 }, turnReports: [], allCalls: calls });
  assert.equal(summary.input_tokens.known_sum, 10);
  assert.equal(summary.input_tokens.missing_calls, 1);
  assert.equal(summary.input_tokens.total, null);
});

test("buildNativeReport 由 hard failure/缺证推导 status 并声明 scope", () => {
  const base = {
    batchDir: "/tmp/r01",
    config: {
      length: 2,
      work: { title: "work" },
      session_id: "session",
      manifest: { id: "m" },
      model: { model: "m" },
      seed: { content_sha256: "seed-hash" },
      semantic_targets: [
        { author_id: "round-1", id: "chapter-count", question: "询问当前有几章内容", review_focus: ["区分结构章位/设计态/已采纳正文"] },
        { author_id: "round-2", id: "outline-anomaly", question: "指出第一章是卷纲异常", review_focus: ["异议不能自动升级为修改授权"] },
      ],
    },
    checks: { turn_count_ok: true, driver_completed: true, visible_outcomes_recorded: true, freshness_recorded: true },
    failures: [],
    hardFailures: [],
    notCollected: ["raw_sse"],
    turnReports: [turn(1, "completed"), turn(2, "waiting")],
    allCalls: [turn(1, "completed").calls[0], turn(2, "waiting").calls[0]],
  };
  const pass = buildNativeReport(base);
  assert.equal(pass.schema, NATIVE_REPORT_SCHEMA);
  assert.equal(pass.status, "pass");
  assert.equal(buildNativeReport({ ...base, checks: { ...base.checks, successor_visible: false } }).status, "partial");
  assert.equal(buildNativeReport({ ...base, checks: { ...base.checks, successor_visible: true } }).status, "pass");
  assert.equal(pass.signed, false);
  assert.equal(pass.scope, "r01_measurement_only");
  const fail = buildNativeReport({ ...base, hardFailures: ["join:bad"] });
  assert.equal(fail.status, "fail");
  const partial = buildNativeReport({ ...base, checks: { ...base.checks, freshness_recorded: false } });
  assert.equal(partial.status, "partial");
  assert.equal(
    buildNativeReport({ ...base, checks: { ...base.checks, turn_count_ok: false } }).status,
    "partial",
  );
  assert.equal(
    buildNativeReport({ ...base, checks: { ...base.checks, driver_completed: false } }).status,
    "partial",
  );
  assert.equal(
    buildNativeReport({ ...base, notCollected: ["production_counts"] }).status,
    "partial",
  );
  // run_inventory 读取失败的缺证必须贯穿 report 分类：partial 且不得伪报 unsafe。
  const runInventoryGap = buildNativeReport({
    ...base,
    checks: { ...base.checks, run_inventory_safe: null },
    notCollected: [...base.notCollected, "run_inventory"],
  });
  assert.equal(runInventoryGap.status, "partial");
  assert.equal(runInventoryGap.measurement_status, "partial");
  assert.equal(runInventoryGap.checks.run_inventory_safe, null);
  assert.equal(runInventoryGap.not_collected.includes("run_inventory"), true);
  assert.equal(
    runInventoryGap.failures.some((entry) => entry.includes("unsafe_run_inventory_in_batch")),
    false,
  );
  const prefix = buildNativeReport({
    ...base,
    allCalls: [{ ...base.allCalls[0], prefix_change: { kind: "compressed", shared: 2 } }],
  });
  assert.equal(prefix.prefix_changes.length, 1);
  assert.equal(prefix.prefix_changes[0].kind, "compressed");
});

test("语义报告只做目标映射与证据索引：默认待独立评审，绝不自动签符合", () => {
  const config = {
    length: 4,
    work: { title: "work" },
    session_id: "session",
    manifest: { id: "m" },
    model: { model: "m" },
    seed: { content_sha256: "seed-hash" },
    semantic_targets: [
      { author_id: "round-1", id: "chapter-count", question: "询问当前有几章内容", review_focus: ["区分结构章位/设计态/已采纳正文"] },
      { author_id: "round-2", id: "outline-anomaly", question: "指出第一章是卷纲异常", review_focus: ["异议不能自动升级为修改授权"] },
    ],
  };
  const report = buildNativeReport({
    batchDir: "/tmp/r01",
    config,
    checks: { turn_count_ok: true, driver_completed: true, visible_outcomes_recorded: true, freshness_recorded: true },
    failures: [],
    hardFailures: [],
    notCollected: ["raw_sse"],
    turnReports: [
      turn(1, "failed"),
      { turn: 2, author_id: "round-2", calls: [], driver: null },
      { turn: 3, author_id: "round-3", calls: [], driver: null },
    ],
    allCalls: [turn(1, "failed").calls[0]],
  });
  const review = report.semantic_review;
  assert.equal(review.signed, false);
  assert.equal(review.scope, "target_mapping_and_evidence_index");
  assert.deepEqual(review.verdicts.includes("conforms"), true);
  const row1 = review.rows[0];
  assert.equal(row1.target_id, "chapter-count");
  assert.equal(row1.target_question, "询问当前有几章内容");
  assert.equal(row1.verdict, "pending_independent_review");
  assert.equal(row1.intent, "not_measured");
  assert.equal(row1.target_effect_and_authorization, "not_measured");
  assert.equal(row1.facts_classification.provider_calls, 1);
  assert.deepEqual(row1.evidence_refs, ["turns[0].calls[0]"]);
  assert.ok(row1.review_focus.length > 0);
  assert.equal(review.rows[1].target_id, "outline-anomaly");
  assert.equal(review.rows[1].verdict, "insufficient_evidence");
  assert.equal(review.rows[2].target_id, null);
  assert.equal(review.rows[2].verdict, "insufficient_evidence");
  // 模型失败/未回答只影响行为结果，测量报告 status 仍由测量完整性决定。
  assert.equal(report.status, "pass");
});

test("响应工具调用聚合区分已知和缺证，不把 null 当 0", () => {
  const analysis = (actual) => ({
    ok: true,
    response: { actual_tool_calls: actual },
    usage: {},
    request: {},
    category_bytes: {
      observation: 0, validation: 0, scope: 0, history: 0,
      current_author: 0, application_base: 0, tools: 0,
    },
    cross: { replay_tool_calls: 0, unclassified_messages: 0, tools_field_present: false },
  });
  const known = { analysis: analysis(2) };
  const unknown = { analysis: analysis(null) };
  const behavior = modelBehaviorOf([
    { turn: 1, author_id: "a", calls: [known, unknown], driver: null },
    { turn: 2, author_id: "b", calls: [known], driver: null },
  ]);
  assert.deepEqual(behavior.outcomes[0].actual_tool_calls, {
    known_sum: 2,
    known_calls: 1,
    missing_calls: 1,
    total: null,
  });
  assert.deepEqual(behavior.outcomes[1].actual_tool_calls, {
    known_sum: 2,
    known_calls: 1,
    missing_calls: 0,
    total: 2,
  });

  const review = semanticReviewOf([{ turn: 1, author_id: "a", calls: [known, unknown] }], []);
  assert.deepEqual(review.rows[0].facts_classification.actual_tool_calls, {
    known_sum: 2,
    known_calls: 1,
    missing_calls: 1,
    total: null,
  });
});

test("capability_gap 是完整测量下的可见结果，不被 verifier 当 missing", () => {
  const gapTurn = turn(1, "capability_gap");
  const report = buildNativeReport({
    batchDir: "/tmp/r01-gap",
    config: {
      length: 1,
      work: { title: "work" },
      session_id: "session",
      manifest: { id: "m" },
      model: { model: "m" },
      seed: { content_sha256: "seed-hash" },
      semantic_targets: [],
    },
    checks: {
      turn_count_ok: true,
      driver_completed: true,
      visible_outcomes_recorded: true,
      freshness_recorded: true,
    },
    failures: [],
    hardFailures: [],
    notCollected: [],
    turnReports: [gapTurn],
    allCalls: gapTurn.calls,
  });
  assert.equal(report.status, "pass", JSON.stringify(report.failures));
  assert.equal(report.checks.visible_outcomes_recorded, true);
  assert.equal(report.model_behavior.outcome_counts.capability_gap, 1);
  assert.equal(report.model_behavior.signed, false);
  assert.equal(report.semantic_review.signed, false);
});


test("绑定作者在所有内部调用都按 root turn 归属，不按 callIndex 清零", () => {
  const text = "这是本轮作者原文";
  const record = {
    provider_call_ref: "pcall-later",
    request: { body: { model: "local/Q4-PLE4", messages: [
      { role: "system", content: "系统" },
      { role: "user", content: text },
    ] } },
    response: { usage: { input_tokens: 1, output_tokens: 1 } },
  };
  const failures = [];
  const analysis = analyzeAuthorCall({
    record,
    author: { text, sha256: createHash("sha256").update(text, "utf8").digest("hex") },
    found: { index: 1 },
    callIndex: 1,
    purposes: new Map(),
    prefix: "turn_1_call_2",
    config: { model: { model: "local/Q4-PLE4" } },
    fail: (key, reason) => failures.push(`${key}:${reason}`),
    notCollected: [],
  });
  assert.equal(analysis.category_bytes.current_author, Buffer.byteLength(text));
  assert.equal(analysis.category_bytes.history, 0);
  assert.equal(analysis.cross.current_author_index, 1);
  assert.deepEqual(failures, []);
});

// 真实 AX 形状：作者消息组带「你」标签；模型回复组前一个兄弟是作者消息组，
// 因此模型引用同一句不会被归为作者消息。
function axNodes({ authors = [], quote = null, status = null } = {}) {
  const container = "0/0/0/0/0";
  const nodes = [
    { path: "0", role: "AXWindow" },
    { path: container, role: "AXGroup" },
  ];
  let next = 10;
  for (const message of authors) {
    const label = `${container}/${next++}`;
    nodes.push({ path: label, role: "AXGroup" });
    nodes.push({ path: `${label}/0`, role: "AXStaticText", value: "你" });
    const group = `${container}/${next++}`;
    nodes.push({ path: group, role: "AXGroup" });
    nodes.push({ path: `${group}/0`, role: "AXStaticText", value: message });
  }
  if (quote !== null) {
    const group = `${container}/${next++}`;
    nodes.push({ path: group, role: "AXGroup" });
    nodes.push({ path: `${group}/0`, role: "AXStaticText", value: "AI 助手" });
    nodes.push({ path: `${group}/1`, role: "AXStaticText", value: quote });
  }
  if (status !== null) {
    const group = `${container}/${next++}`;
    nodes.push({ path: group, role: "AXGroup", title: "本轮创作过程" });
    nodes.push({ path: `${group}/0`, role: "AXStaticText", value: status });
  }
  return nodes;
}

function flatCount(nodes, needle) {
  return nodes
    .map((node) => node.value ?? "")
    .join("\n")
    .split(needle)
    .length - 1;
}

test("模型引用同原话+旧过程折叠使平面计数不增，但 AX 新作者节点+新结果仍判 fresh", () => {
  const baseline = axNodes({ authors: ["重复作者"], quote: "重复作者", status: "进行中" });
  const current = axNodes({ authors: ["重复作者", "重复作者"], status: "已完成" });
  assert.equal(flatCount(baseline, "重复作者"), 2);
  assert.equal(flatCount(current, "重复作者"), 2, "平面出现次数没有增加");
  const facts = freshnessFromObservation({
    author_message: "重复作者",
    baseline_author_count: 1,
    last: { outcome: { kind: "completed" }, nodes: current },
  });
  assert.equal(facts.author_count, 2);
  assert.equal(facts.new_author_echo, true);
  assert.equal(facts.terminal_kind, "completed");
  assert.equal(facts.terminal_after_new_echo, true);
});

test("模型引用原话但没有新作者节点：不算新回合，也不因 completed 结束等待", () => {
  const facts = freshnessFromObservation({
    author_message: "重复作者",
    baseline_author_count: 1,
    last: { outcome: { kind: "completed" }, nodes: axNodes({ authors: ["重复作者"], quote: "重复作者", status: "已完成" }) },
  });
  assert.equal(facts.author_count, 1);
  assert.equal(facts.new_author_echo, false);
  assert.equal(facts.terminal_after_new_echo, false);
});

test("缺 observation 不伪造 fresh；非法/缺字段只返回 null", () => {
  assert.equal(freshnessFromObservation(null), null);
  assert.equal(freshnessFromObservation({}), null);
});

test("observed_effects 与 reference_invariants 分开：变化不自动等于产品偏离", () => {
  const effects = observedEffectsOf({
    runtime_business_content_intact: false,
    post_run_works_revision_matches: false,
    memory_reference_updates_accounted: false,
    reference_logs_target_work_only: false,
    other_work_reference_bookkeeping_intact: true,
    production_counts_unchanged: true,
  });
  assert.deepEqual(effects, {
    canon_content_changed: null,
    business_content_changed: true,
    production_counts_changed: false,
    works_title_changed: null,
    works_revision_changed: true,
    session_changed: null,
  });
  const invariants = referenceInvariantsOf({
    memory_reference_updates_accounted: false,
    reference_logs_target_work_only: false,
    other_work_reference_bookkeeping_intact: true,
  });
  assert.deepEqual(invariants, {
    unaccounted_reference_updates: true,
    reference_logs_other_work: true,
    other_work_reference_changed: false,
  });
  const behavior = modelBehaviorOf([], { checks: { runtime_business_content_intact: false } });
  assert.equal(behavior.observed_effects.business_content_changed, true);
  assert.equal(behavior.reference_invariants.unaccounted_reference_updates, null);
  assert.equal(behavior.signed, false);
});

test("纯聚合边界：计数/字节/tool_calls/verdict 精确，不接受近似", () => {
  const calls = [
    {
      analysis: {
        ok: true,
        response: { actual_tool_calls: 2 },
        usage: {
          input_tokens: 10, cached_tokens: 4, output_tokens: 1,
          cached_within_input: true, cost_input_tokens: 10,
        },
        request: { sha256: "r1" },
        category_bytes: {
          observation: 3, validation: 4, scope: 5, history: 6,
          current_author: 7, application_base: 8, tools: 9, tool_unknown: 0,
        },
        cross: { replay_tool_calls: 2, unclassified_messages: 0, tools_field_present: true },
        totals: { stable_json_bytes: 1 },
      },
      prefix_change: { kind: "compressed" },
    },
    {
      analysis: {
        ok: true,
        response: { actual_tool_calls: null },
        usage: {
          input_tokens: 5, cached_tokens: 0, output_tokens: 2,
          cached_within_input: false, cost_input_tokens: 5,
        },
        request: { sha256: null },
        category_bytes: {
          observation: 0, validation: 1, scope: 0, history: 0,
          current_author: 0, application_base: 0, tools: 0, tool_unknown: 0,
        },
        cross: { replay_tool_calls: 3, unclassified_messages: 0, tools_field_present: false },
        totals: { stable_json_bytes: 0 },
      },
      prefix_change: { kind: "append" },
    },
  ];
  const summary = nativeSummary({
    config: { length: 1 },
    turnReports: [{ status: "completed" }],
    allCalls: calls,
  });
  assert.equal(summary.turns_expected, 1);
  assert.equal(summary.turns_completed, 1);
  assert.equal(summary.calls, 2);
  assert.equal(summary.input_tokens.known_sum, 15);
  assert.equal(summary.cached_tokens.known_sum, 4);
  assert.equal(summary.output_tokens.known_sum, 3);
  assert.equal(summary.cached_is_input_subset, false, "任一条 cached>input 都必须暴露");
  assert.equal(summary.no_cached_double_add, true);
  assert.equal(summary.prefix_change_count, 1, "append 不算前缀变更");

  const turn = { turn: 1, author_id: "a", calls };
  const behavior = modelBehaviorOf([turn]);
  assert.deepEqual(behavior.outcomes[0], {
    turn: 1,
    author_id: "a",
    visible_outcome: "not_collected",
    run_id: null,
    freshness: null,
    provider_calls: 2,
    actual_tool_calls: { known_sum: 2, known_calls: 1, missing_calls: 1, total: null },
  });
  assert.deepEqual(behavior.outcome_counts, { not_collected: 1 });

  const review = semanticReviewOf([turn], [], { observed_effects: {} });
  const row = review.rows[0];
  assert.equal(review.signed, false);
  assert.equal(review.unresolved, 1);
  assert.equal(row.verdict, "pending_independent_review");
  assert.equal(row.verdict_basis, "evidence_present_semantics_pending_leader_review");
  assert.deepEqual(row.evidence_refs, ["turns[0].calls[0]", "turns[0].calls[1]"]);
  assert.deepEqual(row.facts_classification, {
    provider_calls: 2,
    analysis_ok: true,
    input_tokens: 15,
    actual_tool_calls: { known_sum: 2, known_calls: 1, missing_calls: 1, total: null },
    replay_tool_calls: 5,
    observation_calls: 1,
    validation_calls: 2,
    observation_bytes: 3,
    validation_bytes: 5,
    scope_bytes: 5,
    history_bytes: 6,
    current_author_bytes: 7,
    application_base_bytes: 8,
    tools_bytes: 9,
    unclassified_messages: 0,
    tools_field_present: true,
    request_sha256: ["r1", null],
  });
  assert.deepEqual(row.continuity_and_evidence_seeking, {
    history_bytes: 6,
    replay_tool_calls: 5,
    observation_calls: 1,
    scope_bytes: 5,
  });

  const broken = semanticReviewOf([
    { turn: 2, author_id: "b", calls: [{ analysis: analyzeRequestCost({}) }] },
  ], []);
  assert.equal(broken.rows[0].verdict, "insufficient_evidence");
  assert.equal(broken.rows[0].verdict_basis, "missing_or_unusable_evidence");
});

test("targetFor 按 author_id 映射；无目标时返回 null 而不是近似映射", () => {
  const review = semanticReviewOf(
    [{ turn: 1, author_id: "legacy", calls: [] }],
    [{ author_id: "legacy", id: "t1", question: "q", review_focus: ["f"] }],
  );
  assert.equal(review.rows[0].target_id, "t1");
  assert.equal(review.targets[0].author_id, "legacy");
  const missing = semanticReviewOf([{ turn: 2, author_id: "nobody", calls: [] }], []);
  assert.equal(missing.rows[0].target_id, null);
  assert.deepEqual(missing.rows[0].review_focus, []);
});

// ---- 公共契约反例：verifyTurns/verifyDriverShape/verifyConfigMatches 直接吃真实记录形状 ----
const AUTHOR_TEXT = "作者原文";
const AUTHOR_SHA = createHash("sha256").update(AUTHOR_TEXT, "utf8").digest("hex");
function shiftedCanonicalAuthorFixture() {
  const scope = { run_id: "run-1", workspace_id: "ws", work_id: "work",
    session_id: "session", parent_turn_ref: "turn-1", run_status: "completed" };
  const ref = (run, sequence) => ({ ...scope, run_id: run, run_sequence: sequence,
    parent_turn_ref: run === "old" ? "old-turn" : "turn-1" });
  const author = (run, sequence) => ({ role: "user", provenance: "author",
    canonical_ref: ref(run, sequence), source_refs: [{ ref: run === "old" ? "old-turn" : "turn-1" }],
    blocks: [{ type: "text", text: AUTHOR_TEXT }] });
  const oldScope = { role: "scope_update", provenance: "application",
    canonical_ref: ref("old", 1), source_refs: [], versions: {},
    blocks: [{ type: "scope", content: {} }] };
  const currentScope = { ...oldScope, canonical_ref: ref("run-1", 1) };
  const reply = (pcall, prun, sequence) => ({ role: "assistant", provenance: "model",
    canonical_ref: ref("run-1", sequence), provider_call_ref: pcall, provider_run_ref: prun,
    blocks: [{ type: "text", text: "观察" }] });
  const checkpoint = { role: "checkpoint", provenance: "application",
    canonical_ref: ref("run-1", 4), blocks: [{ type: "checkpoint",
      covers: { call_ids: [], message_refs: [{ role: "scope_update", run_id: "old",
        run_sequence: 1, source_refs: [], versions: {} }] },
      omissions: ["旧范围已覆盖"], source_refs: [{ ref: "session_message:old:1", version: 1 }],
      versions: {}, summary: "范围已更新" }] };
  const checkpointWire = { role: "user", content:
    '【应用数据 · checkpoint · 非作者原话】\n' +
    '【应用数据 · checkpoint · 覆盖 {"call_ids":[],"message_refs":[{"role":"scope_update","run_id":"old","run_sequence":1,"source_refs":[],"versions":{}}]}】\n' +
    '来源：[{"ref":"session_message:old:1","version":1}]\n版本：{}\n省略：旧范围已覆盖\n范围已更新' };
  const user = { role: "user", content: AUTHOR_TEXT };
  const first = syntheticRecord({ messages: [scopeWireMessage({}), user, scopeWireMessage({}), user] });
  const second = syntheticRecord({ pcall: "p2", prun: "r2",
    messages: [user, scopeWireMessage({}), user, { role: "assistant", content: "观察" }, checkpointWire] });
  const transcript = { run: scope, messages: [oldScope, author("old", 2), currentScope,
    author("run-1", 2), reply("p1", "r1", 3), checkpoint, reply("p2", "r2", 5)] };
  const records = [first, second];
  const sessionMessages = transcript.messages;
  // Real history shape: the local run segment has no cross-run canonical coordinates.
  transcript.messages = sessionMessages.slice(2).map(({ canonical_ref, ...message }) => message);
  const setup = syntheticSetup(records, { transcript });
  setup.binding.history.sessionMessages = sessionMessages;
  return { records, setup };
}


test("R05 成本作者绑定按完整消息身份定位，同文Scope不冒充作者", () => {
  const quote = "【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】\n版本：{}\n来源：[]\n{}";
  const { records, setup } = shiftedCanonicalAuthorFixture();
  const messages = setup.binding.history.sessionMessages;
  for (const message of messages.filter(message => message.role === "user" && message.provenance === "author"))
    message.blocks = [{ type: "text", text: quote }];
  for (const [record, indexes] of [[records[0], [1, 3]], [records[1], [0, 2]]])
    for (const index of indexes) record.request.body.messages[index].content = quote;
  const view = { ...setup.binding.history.transcript, messages };
  for (const [index, expected] of [[0, 3], [1, 2]]) {
    const found = canonicalAuthorMessage(records[index], { text: quote }, view);
    assert.notEqual(found, null);
    assert.equal(found.index, expected);
    assert.strictEqual(found.message, records[index].request.body.messages[expected]);
  }
});

for (const [label, recordIndex, mutate] of [
  ["Scope版本被改写", 0, rows => { rows[0].content = rows[0].content.replace("版本：{}", '版本：{"forged":1}'); }],
  ["checkpoint正文被改写", 1, rows => { rows[4].content = rows[4].content.replace("范围已更新", "未声明的摘要"); }],
  ["额外Scope插入", 1, rows => { rows.splice(1, 0, structuredClone(rows[1])); }],
]) test("R05 成本作者绑定拒绝" + label + "，同文作者不能补全请求", () => {
  const { records, setup } = shiftedCanonicalAuthorFixture();
  const record = records[recordIndex];
  const view = { ...setup.binding.history.transcript, messages: setup.binding.history.sessionMessages };
  assert.notEqual(canonicalAuthorMessage(record, { text: AUTHOR_TEXT }, view), null);
  mutate(record.request.body.messages);
  assert.equal(canonicalAuthorMessage(record, { text: AUTHOR_TEXT }, view), null);
});

test("canonical 合法覆盖移动作者位置，原序同文历史不能取代当前作者", () => {
  const { records, setup } = shiftedCanonicalAuthorFixture();
  const result = runVerify(records, setup);
  assert.deepEqual(result.failures, []);
  assert.equal(result.allCalls.length, 2);
  assert.equal(result.allCalls[0].analysis.cross.current_author_index, 3);
  assert.equal(result.allCalls[1].analysis.cross.current_author_index, 2);
});

test("canonical 作者来源保留父输入，真实数值 step turn 不成为另一作者", () => {
  const { records, setup } = shiftedCanonicalAuthorFixture();
  records[1].turn_id = "turn-1:agent:7";
  const result = runVerify(records, setup);
  assert.deepEqual(result.failures, []);
  assert.equal(result.allCalls.length, 2);
  assert.equal(result.allCalls[1].turn_id, "turn-1:agent:7");
  assert.equal(result.allCalls[1].analysis.cross.current_author_index, 2);
  assert.deepEqual(setup.binding.history.sessionMessages[3].source_refs, [{ ref: "turn-1" }]);
});

test("canonical step 调用拒绝伪父轮次、坏语法、错调用身份和缺失作者来源", async (t) => {
  const cases = [
    ["错父轮次", "other-turn:agent:7", () => {}],
    ...["turn-1:agent:0", "turn-1:agent:01", "turn-1:agent:-1", "turn-1:agent:7:extra",
      "turn-1:agent:7\n"].map(turnId => [JSON.stringify(turnId), turnId, () => {}]),
    ["错 canonical run", "turn-1", ({ setup }) => {
      setup.binding.history.sessionMessages[6].canonical_ref.run_id = "other-run";
    }],
    ["错 pcall", "turn-1:agent:7", ({ records }) => { records[1].provider_call_ref = "other-call"; }],
    ["错 prun", "turn-1:agent:7", ({ records }) => { records[1].provider_run_ref = "other-provider-run"; }],
    ["缺 source_refs", "turn-1:agent:7", ({ setup }) => {
      delete setup.binding.history.sessionMessages[3].source_refs;
    }, 0],
    ["step 伪作作者来源", "turn-1:agent:7", ({ setup }) => {
      setup.binding.history.sessionMessages[3].source_refs = [{ ref: "turn-1:agent:7" }];
    }, 0],
    ["重复作者来源", "turn-1:agent:7", ({ setup }) => {
      setup.binding.history.sessionMessages[3].source_refs = [{ ref: "turn-1" }, { ref: "turn-1" }];
    }, 0],
  ];
  for (const [label, turnId, mutate, expectedCalls = 1] of cases) await t.test(label, () => {
    const value = shiftedCanonicalAuthorFixture();
    value.records[1].turn_id = turnId;
    mutate(value);
    const result = runVerify(value.records, value.setup);
    assert.ok(result.failures.includes("turn_1_call_2_author:author_message_missing_or_ambiguous"));
    assert.equal(result.allCalls.length, expectedCalls);
  });
});

test("canonical 作者重定位拒绝缺失/增添/改写/乱序和错误来源，不回退到相同文本", () => {
  const mutations = [
    ({ records }) => records[1].request.body.messages.splice(2, 1),
    ({ setup }) => { delete setup.binding.history.sessionMessages; },
    ({ setup }) => { setup.binding.history.sessionMessages = []; },
    ({ setup }) => { setup.binding.history.sessionMessages = setup.binding.history.sessionMessages.slice(2); },
    ({ records }) => records[1].request.body.messages.push({ role: "user", content: AUTHOR_TEXT }),
    ({ records }) => { records[1].request.body.messages[0].content = "历史被改写"; },
    ({ records, setup }) => {
      setup.binding.history.sessionMessages[1].blocks[0].text = "另一条历史";
      records[0].request.body.messages[1] = { role: "user", content: "另一条历史" };
      records[1].request.body.messages[2] = { role: "user", content: "另一条历史" };
    },
    ({ setup }) => { setup.binding.history.sessionMessages[3].canonical_ref.run_id = "other"; },
    ({ setup }) => { setup.binding.history.sessionMessages[3].source_refs = [{ ref: "wrong-turn" }]; },
    ({ setup }) => { setup.binding.history.sessionMessages[5].blocks[0].covers.message_refs[0].run_sequence = 99; },
    ({ setup }) => { setup.binding.history.sessionMessages[6].provider_run_ref = "wrong-pair"; },
  ];
  for (const mutate of mutations) {
    const fixture = shiftedCanonicalAuthorFixture();
    mutate(fixture);
    const result = runVerify(fixture.records, fixture.setup);
    assert.ok(result.failures.some((failure) => failure.includes("author_message_missing_or_ambiguous")));
  }
});


function syntheticRecord({
  messages,
  model = "m",
  reasoning = "high",
  pcall = "p1",
  prun = "r1",
  session = "session",
  work = "work",
  turnId = "turn-1",
  usage = { input_tokens: 1, cached_tokens: 0, output_tokens: 1 },
} = {}) {
  return {
    provider_call_ref: pcall,
    provider_run_ref: prun,
    session_id: session,
    work_id: work,
    turn_id: turnId,
    request: { body: { model, reasoning_effort: reasoning, messages, tools: [] } },
    response: { usage },
  };
}

function syntheticSetup(records, { checkpoint = null, transcript = { messages: [] } } = {}) {
  const source = { authors: [{ id: "round-1", text: AUTHOR_TEXT, sha256: AUTHOR_SHA }] };
  const config = {
    length: 1,
    plan: [{ turn: 1, author_id: "round-1", author_sha256: AUTHOR_SHA }],
    model: { model: "m", reasoning_effort: "high" },
    session_id: "session",
    work: { id: "work" },
  };
  const binding = {
    root: { id: "run-1", workspace_id: "ws", work_id: "work", session_id: "session", parent_turn_ref: "turn-1", status: "completed" },
    providerRuns: [{ id: "prun-1" }],
    records,
    history: { checkpoint, transcript, budget: { provider_calls: records.length } },
    purposes: new Map(),
    counts: { provider_runs: records.length },
  };
  const driver = { turns: [{ index: 1, author_sha256: AUTHOR_SHA, turn_id: "turn-1", run_id: "run-1" }] };
  const wire = [{ direction: "received", at: "2026-11-15T00:00:01Z",
    frame: [null, null, "workspace:ws", "turn_result", { turn_id: "turn-1",
      work_id: "work", session_id: "session", agent_run: { run_id: "run-1", parent_turn_ref: "turn-1", status: "running" } }] }];
  return { source, config, binding, driver, wire };
}

function runVerify(records, setup = syntheticSetup(records)) {
  const failures = [];
  const notCollected = [];
  const result = verifyTurns({
    config: setup.config,
    source: setup.source,
    driver: setup.driver,
    bindings: [setup.binding],
    wire: setup.wire,
    records,
    fail: (key, reason) => failures.push(`${key}:${reason}`),
    notCollected,
  });
  return { ...result, failures, notCollected };
}

test("真实非成功流与后续成功同轮：join到成本汇总保留两次调用和缺失用量", () => {
  const records = [
    syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }], usage: {} }),
    syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }], pcall: "p2", prun: "r2" }),
  ];
  records[0].response.status = 0;
  records[0].response.body = "event_stream";
  records[1].response.status = 200;
  records[1].response.body = { source: "sse_decoder", tool_calls: [] };
  const setup = syntheticSetup(records);
  const scope = { run_id: "run-1", workspace_id: "ws", work_id: "work",
    session_id: "session", parent_turn_ref: "turn-1" };
  setup.binding.providerRuns = records.map((record, index) => ({
    ...scope, agent_run_id: scope.run_id, id: record.provider_run_ref,
    provider_call_ref: record.provider_call_ref, status: index === 0 ? "failed" : "completed",
    recorded_outputs: index === 0 ? [{ provider_run_id: "r1", provider_call_ref: "p1",
      agent_run_id: "run-1", status: "error" }] : [],
  }));
  setup.binding.history.transcript = { run: scope, messages: [
    { role: "assistant", provider_call_ref: "p2", provider_run_ref: "r2", blocks: [] },
  ] };
  const joinFailures = [];
  const bound = joinRootRun({ scope, history: setup.binding.history,
    providerRuns: setup.binding.providerRuns, records, plan: setup.config.plan[0],
    fail: (...args) => joinFailures.push(args) });
  assert.deepEqual(joinFailures, []);
  assert.equal(bound.counts.errors, 1);
  setup.binding.records = bound.records;
  setup.binding.counts = bound.counts;
  const verified = runVerify(records, setup);
  assert.deepEqual(verified.failures, []);
  assert.equal(verified.allCalls.length, 2);
  assert(verified.notCollected.includes("turn_1_call_1_usage"));
  const summary = nativeSummary({ config: setup.config, ...verified });
  assert.equal(summary.calls, 2);
  assert.equal(summary.input_tokens.total, null);
  assert.equal(summary.input_tokens.missing_calls, 1);
});

test("verifyTurns 公共契约：合法记录 call_index/root_run/缺测字段精确", () => {
  const record = syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }] });
  const { turnReports, allCalls, failures, notCollected } = runVerify([record]);
  assert.deepEqual(failures, []);
  assert.equal(turnReports[0].status, "completed");
  assert.deepEqual(turnReports[0].root_run, {
    run_id: "run-1",
    workspace_id: "ws",
    parent_turn_ref: "turn-1",
    provider_run_count: 1,
    status: "completed",
    provider_call_count: 1,
  });
  assert.equal(allCalls[0].call_index, 1);
  assert.equal(allCalls[0].provider_call_ref, "p1");
  assert.equal(allCalls[0].provider_run_ref, "r1");
  assert.equal(allCalls[0].turn_id, "turn-1");
  assert.equal(turnReports[0].calls[0].analysis.cross.current_author_index, 0);
  assert.ok(notCollected.includes("turn_1_call_1_ttft"));
  assert.ok(notCollected.includes("turn_1_call_1_latency"));
});

test("verifyTurns：先交付 running 业务结果，随后真实完成才闭合；DB 失败仍保留测量语义", () => {
  const record = syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }] });
  const setup = syntheticSetup([record]);
  assert.equal(setup.wire[0].frame[4].agent_run.status, "running");
  assert.equal(runVerify([record], setup).turnReports[0].status, "completed");
  setup.binding.root.status = "failed";
  const measured = runVerify([record], setup);
  assert.equal(measured.turnReports[0].status, "completed");
  assert.equal(measured.turnReports[0].root_run.status, "failed");
});

test("verifyTurns：缺真实运行、只有结果、错 run 或结果未交付不能签齐", () => {
  const record = syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }] });
  for (const mutate of [
    (s) => { delete s.binding.root.status; },
    (s) => { s.binding.root.status = "running"; },
    (s) => { s.wire = []; },
    (s) => { s.wire[0].frame[4].agent_run.run_id = "foreign"; },
    (s) => { s.driver.turns[0].run_id = "foreign"; },
    (s) => { s.wire[0].frame[4].agent_run.status = "completed"; s.binding.root.status = "running"; },
  ]) {
    const setup = syntheticSetup([record]); mutate(setup);
    const result = runVerify([record], setup);
    assert.equal(result.turnReports[0].status, "fail");
    assert(result.failures.includes("turn_1_runtime:business_result_or_actual_terminal_missing"));
  }
});

test("坏记录缺 request 时 verifyTurns fail closed 而不抛异常", () => {
  const record = syntheticRecord({ messages: [] });
  delete record.request;
  const { turnReports, failures } = runVerify([record]);
  assert.equal(turnReports[0].status, "fail");
  assert.ok(failures.some((entry) => entry.includes("author_message_missing_or_ambiguous")));
});

test("作者定位按 root 首调 index，后置同文本不是本轮输入", () => {
  const first = syntheticRecord({
    messages: [{ role: "user", content: AUTHOR_TEXT }],
    pcall: "p1",
  });
  const second = syntheticRecord({
    messages: [
      { role: "user", content: AUTHOR_TEXT },
      { role: "assistant", content: "回复" },
      { role: "user", content: AUTHOR_TEXT },
    ],
    pcall: "p2",
  });
  const { turnReports, failures } = runVerify([first, second]);
  assert.deepEqual(failures, []);
  assert.equal(turnReports[0].calls[1].analysis.cross.current_author_index, 0);
  assert.equal(
    turnReports[0].calls[1].analysis.category_bytes.current_author,
    Buffer.byteLength(AUTHOR_TEXT),
  );
});

test("同文本 assistant/尾部独立 user 都使作者定位 fail closed", () => {
  const assistantEcho = syntheticRecord({
    messages: [
      { role: "user", content: AUTHOR_TEXT },
      { role: "assistant", content: AUTHOR_TEXT },
      { role: "user", content: "【应用数据 · scope_update】范围" },
    ],
  });
  const echoed = runVerify([assistantEcho]);
  assert.ok(
    echoed.failures.some((entry) => entry.includes("author_message_missing_or_ambiguous")),
    JSON.stringify(echoed.failures),
  );

  const nullMessage = syntheticRecord({
    messages: [null, { role: "user", content: AUTHOR_TEXT }],
  });
  const nulled = runVerify([nullMessage]);
  assert.equal(nulled.turnReports[0].status, "fail");
  assert.ok(nulled.failures.some((entry) => entry.includes("turn_1_call_1_analysis")));

  const tailUser = syntheticRecord({
    messages: [{ role: "user", content: AUTHOR_TEXT }, null],
  });
  const tailed = runVerify([tailUser]);
  assert.ok(tailed.failures.some((entry) => entry.includes("author_message_missing_or_ambiguous")));
});

test("前缀压缩只在 checkpoint 证据存在时放行", () => {
  const first = syntheticRecord({
    messages: [
      { role: "system", content: "系统" },
      { role: "user", content: AUTHOR_TEXT },
      { role: "user", content: "【应用数据 · scope_update】范围" },
    ],
    pcall: "p1",
  });
  const second = syntheticRecord({
    messages: [
      { role: "system", content: "系统" },
      { role: "user", content: AUTHOR_TEXT },
    ],
    pcall: "p2",
  });
  const allowed = runVerify([first, second], syntheticSetup([first, second], { checkpoint: { id: "cp" } }));
  assert.equal(
    allowed.failures.some((entry) => entry.includes("request_prefix_compressed")),
    false,
  );
  const transcriptAllowed = runVerify(
    [first, second],
    syntheticSetup([first, second], { transcript: { messages: [{ role: "checkpoint" }] } }),
  );
  assert.equal(
    transcriptAllowed.failures.some((entry) => entry.includes("request_prefix_compressed")),
    false,
  );
  const denied = runVerify([first, second], syntheticSetup([first, second]));
  assert.ok(denied.failures.some((entry) => entry.includes("request_prefix_compressed")));
});

test("verifyPcall/usage/model 判据：重复 ref、错模型/推理、缺 usage 模型与零值 usage", () => {
  const duplicate = runVerify([
    syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }], pcall: "same" }),
    syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }], pcall: "same" }),
  ]);
  assert.ok(duplicate.failures.some((entry) => entry.includes("duplicate_provider_call_ref")));

  const missingRef = syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }] });
  delete missingRef.provider_call_ref;
  const missing = runVerify([missingRef]);
  assert.ok(missing.failures.some((entry) => entry.includes("provider_call_ref_missing")));

  const wrongModel = runVerify([
    syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }], model: "other" }),
  ]);
  assert.ok(wrongModel.failures.some((entry) => entry.includes("request_model_mismatch")));

  const wrongReasoning = runVerify([
    syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }], reasoning: "low" }),
  ]);
  assert.ok(wrongReasoning.failures.some((entry) => entry.includes("reasoning_effort_mismatch")));

  const unknownUsageModel = runVerify([
    syntheticRecord({
      messages: [{ role: "user", content: AUTHOR_TEXT }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  ]);
  assert.equal(
    unknownUsageModel.failures.some((entry) => entry.includes("usage_model_mismatch")),
    false,
  );

  const wrongUsageModel = runVerify([
    syntheticRecord({
      messages: [{ role: "user", content: AUTHOR_TEXT }],
      usage: { model: "other", input_tokens: 1, output_tokens: 1 },
    }),
  ]);
  assert.ok(wrongUsageModel.failures.some((entry) => entry.includes("usage_model_mismatch")));

  const zeroUsage = runVerify([
    syntheticRecord({
      messages: [{ role: "user", content: AUTHOR_TEXT }],
      usage: { input_tokens: 0, cached_tokens: 0, output_tokens: 0 },
    }),
  ]);
  assert.deepEqual(zeroUsage.failures, []);
  assert.equal(zeroUsage.turnReports[0].calls[0].analysis.usage.input_tokens, 0);
});

test("verifyCallIdentity 允许缺 work_id，错 session/work 才失败", () => {
  const check = (record) => {
    const failures = [];
    verifyCallIdentity({
      record,
      prefix: "p",
      config: { session_id: "session", work: { id: "work" } },
      fail: (key, reason) => failures.push(`${key}:${reason}`),
    });
    return failures;
  };
  assert.deepEqual(check({ session_id: "session", work_id: null }), []);
  assert.deepEqual(check({ session_id: "session" }), []);
  assert.ok(check({ session_id: "other", work_id: "work" }).some((entry) => entry.includes("session_mismatch")));
  assert.ok(check({ session_id: "session", work_id: "other" }).some((entry) => entry.includes("work_mismatch")));
});

test("verifyDriverShape 缺 driver 返回空 turns 并明确 fail，不崩溃", () => {
  const failures = [];
  const checks = {};
  const turns = verifyDriverShape({
    driver: null,
    config: { length: 1 },
    checks,
    fail: (key, reason) => failures.push(`${key}:${reason}`),
    turnObservations: [],
  });
  assert.deepEqual(turns, []);
  assert.equal(checks.driver_present, false);
  assert.equal(checks.turn_count_ok, false);
  assert.equal(checks.driver_completed, false);
  assert.equal(checks.visible_outcomes_recorded, false);
  assert.equal(checks.freshness_recorded, false);
  assert.ok(failures.includes("driver_log:missing"));
  assert.ok(failures.includes("turns:0/1"));
  assert.ok(failures.includes("driver_completion:not_completed"));
  assert.ok(failures.includes("visible_outcomes:missing"));
  assert.ok(failures.includes("freshness:missing"));
});

test("verifyDriverShape 不给空 turns 伪签 visible/fresh", () => {
  const checks = {};
  const failures = [];
  verifyDriverShape({
    driver: { turns: [], completed: true },
    config: { length: 1 },
    checks,
    fail: (key, reason) => failures.push(`${key}:${reason}`),
    turnObservations: [],
  });
  assert.equal(checks.visible_outcomes_recorded, false);
  assert.equal(checks.freshness_recorded, false);
});

test("verifyConfigMatches 逐字段核对 length/plan/model/seed/snapshot", () => {
  const manifest = {
    source: nativeManifest().source,
    model: { model: "m", reasoning_effort: "high" },
    snapshot: { business_content_sha256: "seed", content_sha256: "snap" },
  };
  const config = {
    length: 3,
    plan: [{}, {}, {}],
    model: manifest.model,
    seed: { source_content_sha256: "seed" },
    snapshot: { content_sha256: "snap" },
  };
  const check = (candidate) => {
    const checks = {};
    const failures = [];
    verifyConfigMatches({
      config: candidate,
      loaded: { manifest },
      checks,
      fail: (key, reason) => failures.push(`${key}:${reason}`),
    });
    return { checks, failures };
  };
  assert.equal(check(config).checks.config_matches_manifest, true);
  for (const candidate of [
    { ...config, length: 4 },
    { ...config, plan: [{}, {}] },
    { ...config, model: { model: "other", reasoning_effort: "high" } },
    { ...config, seed: { source_content_sha256: "other" } },
    { ...config, snapshot: { content_sha256: "other" } },
  ]) {
    const result = check(candidate);
    assert.equal(result.checks.config_matches_manifest, false);
    assert.ok(result.failures.includes("config:manifest_config_mismatch"));
  }
});

test("后继配置只从v2冻结声明启用，v1及3轮拒绝注入", () => {
  const authors = Array.from({length:20}, (_,i) => ({id:"a"+i,sha256:"a".repeat(64),target:{id:"t"+i},obligations:[]}));
  const observation = {source:{path:"scripts/lib/native_ui/fixtures/successor.json",sha256:"b".repeat(64),expected_turns:1},
    author:{id:"next",sha256:"c".repeat(64)},lengths:[10,20],count:1};
  const source = {authors,successorAuthor:{id:"next",sha256:"c".repeat(64)}};
  const manifest = {...nativeManifest(),schema:"b87-r01-request-cost-manifest/v2",
    source:{kind:"preregistered_author_inputs"},successor_observation:observation};
  const configFor = length => ({length,plan:authors.slice(0,length).map((a,i)=>({turn:i+1,author_id:a.id,author_sha256:a.sha256,target:a.target})),
    model:manifest.model,seed:{source_content_sha256:manifest.snapshot.business_content_sha256},
    snapshot:{content_sha256:manifest.snapshot.content_sha256},preregistered_obligations:[],
    compaction_history_check:{required:length>=10,require_outside_initial_page:length===20},
    ...(length>=10?{successor_observation:structuredClone(observation)}:{})});
  const check = (config, m=manifest, s=source) => {
    const checks={}; verifyConfigMatches({config,loaded:{manifest:m},source:s,checks,fail:()=>{}});
    return checks.config_matches_manifest;
  };
  assert.equal(check(configFor(10)),true);
  assert.equal(check(configFor(20)),true);
  assert.equal(check(configFor(3)),true);
  const absent=configFor(10); delete absent.successor_observation;
  assert.equal(check(absent),false);
  assert.equal(check(configFor(10),manifest,{...source,successorAuthor:null}),false);
  assert.equal(check(configFor(10),manifest,{...source,successorAuthor:{id:"other",sha256:"c".repeat(64)}}),false);
  for(const mutate of [o=>o.count=2,o=>o.author.sha256="d".repeat(64),o=>o.extra=true]) {
    const config=configFor(10); mutate(config.successor_observation); assert.equal(check(config),false);
  }
  assert.equal(check({...configFor(3),successor_observation:observation}),false);
  const old={...manifest,schema:"b87-r01-request-cost-manifest/v1"};delete old.successor_observation;
  assert.equal(check(absent,old),true);
  assert.equal(check(configFor(10),old),false);
});

test("主体/后继/总成本分责，多调用与未知usage不漏计、不重复加cached", () => {
  const subject=[{...turn(1,"completed"),status:"completed"}];
  const successor={...turn(2,"completed"),status:"completed"};
  successor.calls.push({analysis:{usage:{input_tokens:null,cached_tokens:null,output_tokens:null,
    cost_input_tokens:null,cached_within_input:null}}});
  const result=observationCostSummary(subject,successor,{length:10,successor_observation:{count:1}});
  assert.equal(result.subject.turns_expected,10);
  assert.equal(result.subject.turns_completed,1);
  assert.equal(result.successor.turns_expected,1);
  assert.equal(result.successor.calls,2);
  assert.equal(result.total.turns_expected,11);
  assert.equal(result.total.turns_completed,2);
  assert.equal(result.total.calls,3);
  assert.deepEqual(result.total.input_tokens,{known_sum:20,known_calls:2,missing_calls:1,total:null});
  assert.equal(result.total.no_cached_double_add,true);
  const missing=observationCostSummary(subject,null,{length:10,successor_observation:{count:1}});
  assert.equal(missing.successor.turns_expected,1);
  assert.equal(missing.successor.turns_completed,0);
  const old=observationCostSummary(subject,null,{length:3});
  assert.equal(old.successor.turns_expected,0);
  assert.equal(old.total.turns_expected,3);
});

test("verifyCheckpoints：缺失只记缺证，相同/变化都不改硬状态", () => {
  const absent = { checks: {}, failures: [], notCollected: [] };
  const missing = verifyCheckpoints({
    start: null,
    final: { production_counts: { works: 1 } },
    checks: absent.checks,
    fail: (key, reason) => absent.failures.push(`${key}:${reason}`),
    notCollected: absent.notCollected,
  });
  assert.deepEqual(missing, {
    present: false,
    unchanged: null,
    start: null,
    final: { production_counts: { works: 1 } },
  });
  assert.equal(absent.checks.production_counts_present, null);
  assert.equal(absent.checks.production_counts_unchanged, null);
  assert.deepEqual(absent.notCollected, ["production_counts"]);
  assert.deepEqual(absent.failures, []);

  const same = { checks: {}, failures: [], notCollected: [] };
  const sameResult = verifyCheckpoints({
    start: { a: 1 },
    final: { a: 1 },
    checks: same.checks,
    fail: (key, reason) => same.failures.push(`${key}:${reason}`),
    notCollected: same.notCollected,
  });
  assert.equal(sameResult.unchanged, true);
  assert.equal(sameResult.present, true);
  assert.equal(same.checks.production_counts_present, true);
  assert.deepEqual(same.failures, []);

  const changed = { checks: {}, failures: [], notCollected: [] };
  assert.equal(
    verifyCheckpoints({
      start: { a: 1 },
      final: { a: 2 },
      checks: changed.checks,
      fail: (key, reason) => changed.failures.push(`${key}:${reason}`),
      notCollected: changed.notCollected,
    }).unchanged,
    false,
  );
  assert.equal(changed.checks.production_counts_unchanged, false);
  assert.deepEqual(changed.failures, ["checkpoints:production_changed"]);
});

test("semantic_review 空行不签；零调用 analysis_ok=false 而非真空真", () => {
  const empty = semanticReviewOf([], []);
  assert.equal(empty.signed, false);
  assert.equal(empty.unresolved, 0);
  const row = semanticReviewOf([{ turn: 1, author_id: "a", calls: [] }], []).rows[0];
  assert.equal(row.facts_classification.provider_calls, 0);
  assert.equal(row.facts_classification.analysis_ok, false);
  assert.equal(row.verdict, "insufficient_evidence");
  assert.equal(row.verdict_basis, "missing_or_unusable_evidence");
});

test("nativeSummary 未知 cached 不误报越界；evidence_boundaries 保留 0 条引用", () => {
  const unknown = nativeSummary({
    config: { length: 0 },
    turnReports: [],
    allCalls: [{ analysis: { usage: { cached_within_input: null, cost_input_tokens: 1, input_tokens: 1 } } }],
  });
  assert.equal(unknown.cached_is_input_subset, true);
  const report = buildNativeReport({
    batchDir: "/tmp/r01-boundaries",
    config: {
      length: 0,
      work: { title: "work" },
      session_id: "session",
      manifest: { id: "m" },
      model: { model: "m" },
      seed: { content_sha256: "seed-hash" },
      semantic_targets: [],
      setup: { reference_logs_count: 0, reference_logs_sha256: "" },
    },
    checks: { turn_count_ok: true, driver_completed: true, visible_outcomes_recorded: true, freshness_recorded: true },
    failures: [],
    hardFailures: [],
    notCollected: [],
    turnReports: [],
    allCalls: [],
  });
  assert.equal(report.evidence_boundaries.data_validity.reference_logs, 0);
  assert.equal(report.evidence_boundaries.data_validity.source_reference_logs_sha256, "");
});

test("freshnessFromObservation 缺 baseline 按 0；缺 outcome 保持未知而非猜测", () => {
  const nodes = axNodes({ authors: [AUTHOR_TEXT] });
  const noBaseline = freshnessFromObservation({
    author_message: AUTHOR_TEXT,
    last: { outcome: { kind: "completed" }, nodes },
  });
  assert.equal(noBaseline.baseline_author_count, 0);
  assert.equal(noBaseline.author_count, 1);
  assert.equal(noBaseline.new_author_echo, true);
  const noOutcome = freshnessFromObservation({
    author_message: AUTHOR_TEXT,
    baseline_author_count: 0,
    last: { nodes },
  });
  assert.equal(noOutcome.terminal_kind, null);
  assert.equal(noOutcome.terminal_after_new_echo, false);
});

test("turn 身份不符 fail closed，不把错 turn 当完成", () => {
  const record = syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }] });
  const setup = syntheticSetup([record]);
  setup.driver.turns[0].author_sha256 = "other-sha";
  const { turnReports, failures } = runVerify([record], setup);
  assert.equal(turnReports[0].status, "fail");
  assert.ok(failures.some((entry) => entry.includes("driver_turn_identity_mismatch")));
});

test("usage 有值但缺 input/output 时记缺测，不伪造 total", () => {
  const record = syntheticRecord({
    messages: [{ role: "user", content: AUTHOR_TEXT }],
    usage: { input_tokens: 1, output_tokens: null },
  });
  const { turnReports, notCollected, failures } = runVerify([record]);
  assert.deepEqual(failures, []);
  assert.ok(notCollected.includes("turn_1_call_1_tokens"));
  assert.equal(turnReports[0].calls[0].analysis.usage.input_tokens, 1);
  assert.equal(turnReports[0].calls[0].analysis.usage.output_tokens, null);
});

test("source 作者 plan 不匹配时 turn fail closed", () => {
  const record = syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }] });
  const setup = syntheticSetup([record]);
  setup.source.authors[0].sha256 = "other-sha";
  const { turnReports, failures } = runVerify([record], setup);
  assert.equal(turnReports[0].status, "fail");
  assert.ok(failures.some((entry) => entry.includes("author_plan_mismatch")));
});

test("语义评审没有人工输入时永不自签；空/非空都按实际自动待审行数计 unresolved", () => {
  const empty = semanticReviewOf([], []);
  assert.equal(empty.signed, false);
  assert.equal(empty.unresolved, 0);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.verdicts, [
    "pending_independent_review",
    "conforms",
    "deviates",
    "insufficient_evidence",
  ]);

  const known = {
    analysis: {
      ok: true,
      response: { actual_tool_calls: 0 },
      usage: {},
      request: {},
      category_bytes: {
        observation: 0, validation: 0, scope: 0, history: 0,
        current_author: 0, application_base: 0, tools: 0,
      },
      cross: { replay_tool_calls: 0, unclassified_messages: 0, tools_field_present: false },
    },
  };
  const review = semanticReviewOf(
    [
      { turn: 1, author_id: "a", calls: [known] },
      { turn: 2, author_id: "b", calls: [{ analysis: { ...known.analysis, ok: false } }] },
    ],
    [],
  );
  assert.equal(review.signed, false);
  assert.equal(review.rows.length, 2);
  assert.deepEqual(review.rows.map((row) => row.verdict), [
    "pending_independent_review",
    "insufficient_evidence",
  ]);
  assert.equal(review.unresolved, 2, "待审与缺证都是未解决，不能只算 conforms/deviates 的补集");
});

test("verifyDriverShape 真实 fresh observation 通过时不伪造 freshness 失败", () => {
  const message = "第三句";
  const nodes = axNodes({ authors: [message], status: "已完成" });
  const checks = {};
  const failures = [];
  const turns = verifyDriverShape({
    driver: { turns: [{ visible_outcome: { kind: "completed" } }], completed: true },
    config: { length: 1 },
    checks,
    fail: (key, reason) => failures.push(`${key}:${reason}`),
    turnObservations: [{
      author_message: message,
      baseline_author_count: 0,
      last: { outcome: { kind: "completed" }, nodes },
    }],
  });
  assert.equal(turns.length, 1);
  assert.equal(checks.freshness_recorded, true);
  assert.equal(turns[0].freshness.terminal_after_new_echo, true);
  assert.equal(failures.includes("freshness:missing"), false);
});

test("nativeSummary 缓存子集与前缀变更：真实 true/false/append 都有反例", () => {
  const call = (cached_within_input, kind) => ({
    analysis: {
      usage: {
        input_tokens: 1, cached_tokens: 0, output_tokens: 0,
        cached_within_input, cost_input_tokens: 1,
      },
    },
    prefix_change: { kind },
  });
  const summary = nativeSummary({
    config: { length: 1 },
    turnReports: [],
    allCalls: [call(true, "append"), call(false, "rewrite")],
  });
  assert.equal(summary.cached_is_input_subset, false);
  assert.equal(summary.prefix_change_count, 1);
  const good = nativeSummary({
    config: { length: 1 },
    turnReports: [],
    allCalls: [call(true, "append"), call(true, "append")],
  });
  assert.equal(good.cached_is_input_subset, true);
  assert.equal(good.prefix_change_count, 0);
});

test("model behavior 对缺 driver / 空 driver 保留 not_collected 与 null，不崩溃", () => {
  const calls = [{
    analysis: {
      ok: true,
      response: { actual_tool_calls: 0 },
      usage: {},
      request: {},
      category_bytes: {},
      cross: { replay_tool_calls: 0, unclassified_messages: 0, tools_field_present: false },
    },
  }];
  const behavior = modelBehaviorOf([
    { turn: 1, author_id: "a", calls, driver: null },
    { turn: 2, author_id: "b", calls, driver: {} },
  ]);
  assert.deepEqual(behavior.outcomes.map((outcome) => outcome.visible_outcome), [
    "not_collected", "not_collected",
  ]);
  assert.deepEqual(behavior.outcomes.map((outcome) => outcome.run_id), [null, null]);
  assert.deepEqual(behavior.outcomes.map((outcome) => outcome.freshness), [null, null]);
});

test("semantic_review facts 汇总真实 unclassified/replay 计数，不把 0 当唯一输入", () => {
  const call = (unclassified, replay) => ({
    analysis: {
      ok: true,
      response: { actual_tool_calls: 0 },
      usage: {},
      request: { sha256: "req" },
      category_bytes: {
        observation: 0, validation: 0, scope: 0, history: 0,
        current_author: 0, application_base: 0, tools: 0,
      },
      cross: { replay_tool_calls: replay, unclassified_messages: unclassified, tools_field_present: false },
    },
  });
  const review = semanticReviewOf(
    [{ turn: 1, author_id: "a", calls: [call(2, 3), call(1, 4)] }],
    [],
  );
  assert.equal(review.rows[0].facts_classification.unclassified_messages, 3);
  assert.equal(review.rows[0].facts_classification.replay_tool_calls, 7);
  assert.equal(review.rows[0].verdict, "insufficient_evidence");
  assert.equal(review.unresolved, 1);
});

test("verifyDriverShape 对坏 turn/null turn 软失败 hard:false，不崩溃也不伪签", () => {
  const soft = [];
  const checks = {};
  verifyDriverShape({
    driver: { turns: [null], completed: true },
    config: { length: 1 },
    checks,
    fail: (key, reason, options) => soft.push({ key, reason, hard: options?.hard }),
    turnObservations: [],
  });
  assert.equal(checks.turn_count_ok, true);
  assert.equal(checks.driver_completed, true);
  assert.equal(checks.visible_outcomes_recorded, false);
  assert.equal(checks.freshness_recorded, false);
  assert.deepEqual(soft, [
    { key: "visible_outcomes", reason: "missing", hard: false },
    { key: "freshness", reason: "missing", hard: false },
  ]);

  const incomplete = [];
  const checks2 = {};
  verifyDriverShape({
    driver: { turns: [], completed: false },
    config: { length: 1 },
    checks: checks2,
    fail: (key, reason, options) => incomplete.push({ key, reason, hard: options?.hard }),
    turnObservations: [],
  });
  assert.deepEqual(incomplete.slice(0, 2), [
    { key: "turns", reason: "0/1", hard: false },
    { key: "driver_completion", reason: "not_completed", hard: false },
  ]);
});

test("tools_field_present 只在真实 true 时计：全 false 不得被当作携带", () => {
  const call = {
    analysis: {
      ok: true,
      response: { actual_tool_calls: 0 },
      usage: {},
      request: { sha256: "r" },
      category_bytes: {
        observation: 0, validation: 0, scope: 0, history: 0,
        current_author: 0, application_base: 0, tools: 0,
      },
      cross: { replay_tool_calls: 0, unclassified_messages: 0, tools_field_present: false },
    },
  };
  const review = semanticReviewOf([{ turn: 1, author_id: "a", calls: [call] }], []);
  assert.equal(review.rows[0].facts_classification.tools_field_present, false);
});

test("坏记录缺 body / 末条 user 文本不符时 fail closed 而不崩溃或误认", () => {
  const bodyless = syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }] });
  bodyless.request = {};
  const result = runVerify([bodyless]);
  assert.equal(result.turnReports[0].status, "fail");
  assert.ok(result.failures.some((entry) => entry.includes("author_message_missing_or_ambiguous")));

  const otherUser = syntheticRecord({ messages: [{ role: "user", content: "另一句" }] });
  const other = runVerify([otherUser]);
  assert.ok(other.failures.some((entry) => entry.includes("author_message_missing_or_ambiguous")));
});

test("运行预算为 0 或缺失时都按真实 history 完成，不把 0 读成缺测", () => {
  const record = syntheticRecord({ messages: [{ role: "user", content: AUTHOR_TEXT }] });
  const zero = syntheticSetup([record]);
  zero.binding.history.budget = { provider_calls: 0 };
  assert.equal(runVerify([record], zero).turnReports[0].status, "completed");
  const noBudget = syntheticSetup([record]);
  delete noBudget.binding.history.budget;
  assert.equal(runVerify([record], noBudget).turnReports[0].status, "completed");
});

test("单轮可见结果与缺 outcome/last 的 observation：fresh 明确", () => {
  const message = "第三句";
  const nodes = axNodes({ authors: [message], status: "已完成" });
  const checks = {};
  const failures = [];
  const turns = verifyDriverShape({
    driver: { turns: [{ visible_outcome: { kind: "completed" } }], completed: true },
    config: { length: 1 },
    checks,
    fail: (key, reason) => failures.push(`${key}:${reason}`),
    turnObservations: [{
      author_message: message,
      baseline_author_count: 0,
      last: { outcome: { kind: "completed" }, nodes },
    }],
  });
  assert.equal(checks.visible_outcomes_recorded, true);
  assert.equal(turns[0].freshness.terminal_after_new_echo, true);

  const lastNoOutcome = freshnessFromObservation({
    author_message: message,
    baseline_author_count: 0,
    last: { nodes },
  });
  assert.equal(lastNoOutcome.terminal_kind, null);
  assert.equal(lastNoOutcome.terminal_after_new_echo, false);

  const noFreshness = {};
  verifyDriverShape({
    driver: { turns: [{}], completed: true },
    config: { length: 1 },
    checks: noFreshness,
    fail: () => {},
    turnObservations: [{}],
  });
  assert.equal(noFreshness.freshness_recorded, false);
});

test("后继可见完成必须由原文和原始AX新回显复核，不能信driver自报", () => {
  const author={text:"核已有交付，不替我作决定。"};
  const turn={visible_outcome:{kind:"completed"},freshness:{new_author_echo:true,terminal_after_new_echo:true}};
  const observation={author_message:author.text,baseline_author_count:0,
    last:{nodes:axNodes({authors:[author.text],status:"已完成"}),outcome:{kind:"completed"}}};
  const result=verifySuccessorVisible({turn,author,observation});
  assert.equal(result.ok,true);
  assert.equal(result.freshness.author_count,1);
  for(const mutate of [
    s=>s.observation=null,
    s=>s.observation.author_message="别的输入",
    s=>s.observation.last.nodes=[],
    s=>delete s.observation.last.nodes,
    s=>s.observation.baseline_author_count=1,
    s=>s.observation.baseline_author_count=-1,
    s=>delete s.observation.baseline_author_count,
    s=>s.observation.last.nodes=axNodes({authors:[author.text],status:"进行中"}),
    s=>s.turn.visible_outcome.kind="failed",
    s=>s.turn=null,
  ]) {
    const sample=structuredClone({turn,author,observation});mutate(sample);
    assert.equal(verifySuccessorVisible(sample).ok,false,mutate.toString());
  }
  const web="0/0/0/0/0",container=web+"/10";
  const ordinaryNodes=[
    {path:web,role:"AXWebArea"},
    ...axNodes({authors:[author.text]}).map(node=>node.path===web
      ? {...node,path:container,title:"会话消息",subrole:"AXLandmarkRegion"}
      : node.path.startsWith(web+"/") ? {...node,path:container+node.path.slice(web.length)} : node),
    {path:web+"/1",role:"AXPopUpButton",title:"AI 助手",desc:"助手名称"},
    {path:web+"/3",role:"AXStaticText",value:"无任务"},
    {path:container+"/12",role:"AXGroup"},
    {path:container+"/12/0",role:"AXStaticText",value:"AI 助手"},
    {path:container+"/13",role:"AXGroup"},
    {path:container+"/13/0",role:"AXStaticText",value:"已交付的是前文分析，尚未交付的是正文。"},
    {path:container+"/14",role:"AXButton",title:"为什么",desc:"查看这轮回应的依据"},
  ];
  const ordinary=structuredClone({turn,author,observation});
  ordinary.observation.last.nodes=ordinaryNodes;
  assert.equal(verifySuccessorVisible(ordinary).ok,true);
  for(const nodes of [
    axNodes({authors:[author.text],status:"进行中"}),
    ordinaryNodes.filter(n=>!n.path.startsWith(container+"/13")),
    ordinaryNodes.filter(n=>n.title!=="为什么"),
    [...ordinaryNodes,{path:container+"/20",role:"AXGroup",title:"当前创作任务操作"}],
  ]) {
    const forged=structuredClone(ordinary);
    forged.observation.last.nodes=nodes;
    assert.equal(verifySuccessorVisible(forged).ok,false,"raw AX must override claimed completed outcome");
  }
  const driverDisagrees=structuredClone(turn);
  driverDisagrees.freshness={new_author_echo:false,terminal_after_new_echo:false};
  assert.equal(verifySuccessorVisible({turn:driverDisagrees,author,observation}).ok,true);
  const staleOutcome=structuredClone(observation);
  staleOutcome.last.outcome.kind="waiting";
  assert.equal(verifySuccessorVisible({turn,author,observation:staleOutcome}).ok,true,
    "last.outcome is derived metadata, raw AX is authoritative");
});

test("freshness 需要新作者 echo 和本轮终态同时成立，不能被 || 放宽", () => {
  const message = "第三句";
  const nodes = axNodes({ authors: [message], status: null });
  const checks = {};
  const failures = [];
  verifyDriverShape({
    driver: { turns: [{ visible_outcome: { kind: "completed" } }], completed: true },
    config: { length: 1 },
    checks,
    fail: (key, reason) => failures.push(`${key}:${reason}`),
    turnObservations: [{
      author_message: message,
      baseline_author_count: 0,
      last: { outcome: { kind: null }, nodes },
    }],
  });
  assert.equal(checks.freshness_recorded, false);
  assert.ok(failures.includes("freshness:missing"));
});

test("后续调用期望位置的 user 文本不符时明确 missing，不把任意 user 当作者", () => {
  const first = syntheticRecord({
    messages: [{ role: "user", content: AUTHOR_TEXT }],
    pcall: "p1",
  });
  const second = syntheticRecord({
    messages: [{ role: "user", content: "另一句" }],
    pcall: "p2",
  });
  const setup = syntheticSetup([first, second]);
  const { failures } = runVerify([first, second], setup);
  assert.ok(
    failures.some((entry) => entry.includes("author_message_missing_or_ambiguous")),
    failures.join(","),
  );
});