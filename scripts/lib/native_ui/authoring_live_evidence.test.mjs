// CP3b 实模机制判据（L1–L12）正反例：只验证结构事实，不要求固定文本/调用次数；
// 模型未触发的切片进 not_signed，不伪造覆盖。
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as liveEvidence from "./authoring_live_evidence.mjs";
import { CANON_TABLES, buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import { b71LiveModelBehavior } from "./authoring_live_evidence.mjs";
import { scopeWireMessage, toolResultContent } from "./fixtures/authoring_request_ir.mjs";

const AUTHOR = "先看看第01章现在的设定和正文，再写一段更紧张的开场：主角在雨夜收到一封没有署名的信。";
const TURN = "message_live_1";
const RUN = "run_live_1";

const system = () => ({ role: "system", content: "你在 AI Novel Studio 中工作，作者是唯一裁决者。" });
const appBase = (extra = "") => ({
  role: "user",
  content: `【应用数据 · application_base · 非作者原话】\n创作判断器规则。\n${extra}`,
});
const author = (text = AUTHOR) => ({ role: "user", content: text });
// 独立预置的会话事实，不从待测 wire 或其解析结果反推 canonical。
const canonicalInput = (extra = "") => [
  { role: "application_base", provenance: "application",
    blocks: [{ type: "text", text: `创作判断器规则。\n${extra}` }], source_refs: [], base_refs: [], versions: {} },
  { role: "user", provenance: "author",
    blocks: [{ type: "text", text: AUTHOR }], source_refs: [], versions: {} },
];
const scope = () => ({ role: "user", content: "【应用数据 · scope_update · 以最新版本为准】\n版本：{\"scope_revision\":1}" });

const config = { journey: "live", provider: "strata", message: AUTHOR, slice_id: "b71-first-consumer" };

function record(messages, overrides = {}) {
  return {
    ts: overrides.ts ?? "2026-11-03T10:00:01.000Z",
    turn_id: TURN,
    provider_call_ref: overrides.provider_call_ref ?? "pcall_1",
    provider_run_ref: overrides.provider_run_ref ?? "prun_1",
    provider: "strata",
    request: { body: overrides.request_body ?? { messages, tools: [], tool_choice: "auto" } },
    response:
      overrides.response ?? {
        status: 200,
        body: { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, content: "好的。", tool_calls: [] },
      },
  };
}

function checkpoint(name, { canonHash = "canon-content", counts = {}, tables = null, chapters = null, design = "design-1" } = {}) {
  return {
    checkpoint: name,
    at: "2026-11-03T10:00:00.000Z",
    db_production_counts: {
      mutations: 0,
      author_action_receipts: 0,
      memory_items: 0,
      chapters: 0,
      drafts: 0,
      ...counts,
    },
    authoring_canon: {
      version: 2,
      at: "2026-11-03T10:00:00.000Z",
      chapters: chapters ?? {
        "chapter-row": { approved_sha256: "approved-chapter", design_state_sha256: design },
      },
      tables:
        tables ??
        {
          works: { row_count: 1, rows_sha256: "works-rows", canon_sha256: canonHash },
          author_action_receipts: { row_count: 0, rows_sha256: "receipts", canon_sha256: "receipts" },
        },
    },
  };
}

function turnBody(overrides = {}) {
  return {
    turn_id: TURN,
    status: "conversational",
    agent_run: { run_id: RUN, status: "completed" },
    assistant_message: { text: "我建议先核对现有材料，再给出候选。" },
    adoption_state: { pending: [] },
    available_actions: [],
    ...overrides,
  };
}

function wire(body = turnBody()) {
  return [{ at: "2026-11-03T10:00:02.000Z", direction: "received", frame: [null, null, "workspace:test", "turn_result", body] }];
}

function driverLog(why = { opened: true, before: { llm_records: 1, provider_runs: 1 }, after: { llm_records: 1, provider_runs: 1 } }) {
  return { model: "iq3_s", run: { status: "completed" }, why };
}

function evaluate({ llmRecords, start = checkpoint("start"), final = checkpoint("final", { design: "design-1" }), body = turnBody(), log = driverLog(), dbFacts = null } = {}) {
  return b71LiveModelBehavior({
    dir: "/tmp/unused",
    config,
    llmRecords,
    wire: wire(body),
    startCheckpoint: start,
    finalCheckpoint: final,
    driverLog: log,
    dbFacts,
    model: "iq3_s",
  });
}

function designDbFacts({
  mission = {},
  usedRefs = [],
  providerCallRef = "pcall_1",
  providerRunRef = "prun_1",
  segmentUsedRefs = [],
  requestPrefix = [],
  agentEventRefs = ["obs_1"],
  traces = [{ trace_id: "trace_1", turn_id: TURN, context_refs: null }],
  mutations = 0,
} = {}) {
  const messages = usedRefs.length > 0
    ? [{
        role: "assistant",
        provenance: "model",
        provider_call_ref: providerCallRef,
        provider_run_ref: providerRunRef,
        blocks: [{ type: "tool_call", call_id: `call-${providerCallRef}`, name: "submit_tentative_artifact",
          arguments: { self_report: { used_context_refs: usedRefs } } }],
      }]
    : [];
  return {
    mutations_count: mutations,
    chapters_rows: [
      {
        id: "chapter-row",
        title: "第一章",
        plan_direction: JSON.stringify({
          chapter_mission: {
            mission_id: "cm_live_1",
            statement: "为第1章开场起头。",
            source: "model",
            status: "TENTATIVE",
            provider_call_ref: "pcall_1",
            must_advance: [{ text: "推进", basis_ref: "observation:obs_1" }],
            must_avoid: [],
            ...mission,
          },
        }),
      },
    ],
    agent_events: [{ event_type: "exploration_observed", refs: JSON.stringify(agentEventRefs) }],
    decision_traces: traces.map((trace) => ({ trace_id: trace.trace_id, turn_id: trace.turn_id, context_refs: trace.context_refs })),
    segment_transcript: { messages: structuredClone([...requestPrefix, ...messages]), used_refs: segmentUsedRefs },
    sessionMessages: [...requestPrefix, ...messages],
  };
}

test("机制正例：单请求结构/作者字节/零写入/usage/Why 零调用成立，未触发工具进 not_signed", () => {
  const checks = evaluate({ llmRecords: [record([system(), appBase(), author(), scope()])] });
  assert.deepEqual(checks.failed_mechanism, []);
  for (const key of [
    "ir_projection_structure",
    "no_giant_user_document",
    "no_user_pseudo_correction",
    "append_only_prefix",
    "author_bytes_exact",
    "unadopted_zero_write",
    "usage_collected",
    "why_replay_zero_provider",
  ]) {
    assert.equal(checks.checks.mechanism[key], true, key);
  }
  assert.equal(checks.checks.mechanism.tool_call_result_binding, null);
  assert.equal(checks.checks.mechanism.observation_reaches_next_request, null);
  assert.equal(checks.checks.mechanism.used_context_refs_within_boundary, null);
  assert.equal(checks.model_behavior.provider_calls, 1);
  assert.equal(checks.model_behavior.tool_call_count, 0);
  assert(checks.not_signed.includes("G2_observation_roundtrip_not_triggered"));
  assert(checks.not_signed.includes("G4_tentative_candidate_not_triggered"));
  assert(checks.not_signed.includes("I10_literary_quality_not_signed"));
});

test("L2 反例：application_base 与作者原话挤在同一条 user（giant user）", () => {
  const checks = evaluate({
    llmRecords: [record([system(), { role: "user", content: `【应用数据 · application_base · 非作者原话】规则\n${AUTHOR}` }, scope()])],
  });
  assert.equal(checks.checks.mechanism.no_giant_user_document, false);
  assert(checks.failed_mechanism.includes("no_giant_user_document"));
});

test("L3 反例：author 之后出现非应用数据的 user 伪纠错", () => {
  const checks = evaluate({
    llmRecords: [
      record([
        system(),
        appBase(),
        author(),
        { role: "assistant", content: "我先读一下。" },
        { role: "user", content: "你漏了第02章，重新看一遍。" },
      ]),
    ],
  });
  assert.equal(checks.checks.mechanism.no_user_pseudo_correction, false);
});

test("L4 反例：同一 turn 的后续真实请求不是追加式前缀", () => {
  const first = [system(), appBase(), author(), scope()];
  const second = [system(), appBase("改写了应用数据"), author(), scope()];
  const checks = evaluate({
    llmRecords: [
      record(first, { ts: "2026-11-03T10:00:01.000Z", provider_call_ref: "pcall_1" }),
      record(second, { ts: "2026-11-03T10:00:03.000Z", provider_call_ref: "pcall_2" }),
    ],
  });
  assert.equal(checks.checks.mechanism.append_only_prefix, false);
});

test("L5/L6 正例：tool_call 与 tool result 按 call_id 绑定且 observation 进入后续请求", () => {
  const call = {
    id: "call_read_1",
    type: "function",
    function: { name: "read_chapter", arguments: "{\"chapter_ref\":\"ch_01\"}" },
  };
  const first = [system(), appBase(), author(), scope()];
  const second = [
    ...first,
    { role: "assistant", content: "", tool_calls: [call] },
    { role: "tool", tool_call_id: "call_read_1", content: toolResultContent({ type: "observation", call_id: "call_read_1", status: "ok", source_refs: [], content: { summary: "第01章正文：雨夜，旧书铺。" } }) },
  ];
  const checks = evaluate({
    llmRecords: [
      record(first, {
        ts: "2026-11-03T10:00:01.000Z",
        provider_call_ref: "pcall_1",
        response: { status: 200, body: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, content: "", tool_calls: [call] } },
      }),
      record(second, { ts: "2026-11-03T10:00:03.000Z", provider_call_ref: "pcall_2" }),
    ],
    body: turnBody({ adoption_state: { pending: [{ artifact_id: "as_1", artifact_type: "chapter_draft", adoption_status: "TENTATIVE" }] } }),
  });
  assert.equal(checks.checks.mechanism.tool_call_result_binding, true);
  assert.equal(checks.checks.mechanism.observation_reaches_next_request, true);
  assert.equal(checks.model_behavior.tool_call_count, 1);
  assert(checks.not_signed.includes("G4_tentative_candidate_not_triggered") === false);
});

test("L5/L6 反例：实时响应发出 tool_calls 但后续请求没有 tool result 回流", () => {
  const call = { id: "call_read_1", type: "function", function: { name: "read_chapter", arguments: "{}" } };
  const first = [system(), appBase(), author(), scope()];
  const second = [...first, { role: "assistant", content: "", tool_calls: [call] }];
  const checks = evaluate({
    llmRecords: [
      record(first, {
        ts: "2026-11-03T10:00:01.000Z",
        provider_call_ref: "pcall_1",
        response: { status: 200, body: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, tool_calls: [call] } },
      }),
      record(second, { ts: "2026-11-03T10:00:03.000Z", provider_call_ref: "pcall_2" }),
    ],
  });
  assert.equal(checks.checks.mechanism.tool_call_result_binding, false);
  assert.equal(checks.checks.mechanism.observation_reaches_next_request, false);
});

test("L5/L6：只有 messages 回放、无实时响应 tool_calls 时不伪造触发（记 null + replay_only）", () => {
  const call = { id: "call_replay_1", type: "function", function: { name: "read_chapter", arguments: "{}" } };
  const first = [system(), appBase(), author(), scope()];
  const second = [
    ...first,
    { role: "assistant", content: "", tool_calls: [call] },
    { role: "tool", tool_call_id: "call_replay_1", content: toolResultContent({ type: "observation", call_id: "call_replay_1", status: "ok", source_refs: [], content: { summary: "第01章正文" } }) },
  ];
  const checks = evaluate({
    llmRecords: [
      record(first, { ts: "2026-11-03T10:00:01.000Z", provider_call_ref: "pcall_1" }),
      record(second, { ts: "2026-11-03T10:00:03.000Z", provider_call_ref: "pcall_2" }),
    ],
  });
  assert.equal(checks.checks.mechanism.tool_call_result_binding, null);
  assert.equal(checks.checks.mechanism.observation_reaches_next_request, null);
  assert.equal(checks.measured.replay_only_tool_calls > 0, true);
  assert.equal(checks.model_behavior.tool_call_count, 0);
});

test("L7：原生 wire 已绑定 Scope 但缺同次 Base 登记时明确缺证", () => {
  const nativeScope = {
    role: "scope_update", provenance: "application",
    blocks: [{ type: "scope", content: { context: {} } }],
    source_refs: [{ ref: "observation:obs_1" }], versions: { scope_revision: 1 },
  };
  const messages = [
    system(),
    appBase("材料：chapter:ch-1；执行简述：execution_brief:chapter:ch-1"),
    author(),
    scopeWireMessage(nativeScope.blocks[0].content, { versions: nativeScope.versions, sourceRefs: nativeScope.source_refs }),
  ];
  const records = [record(messages)];
  const requestPrefix = [
    ...canonicalInput("材料：chapter:ch-1；执行简述：execution_brief:chapter:ch-1"), nativeScope,
  ];
  const outFacts = designDbFacts({ usedRefs: ["observation:obs_out_of_boundary"], requestPrefix });
  const outOfBoundary = evaluate({ llmRecords: records, dbFacts: outFacts });
  assert.equal(outOfBoundary.checks.mechanism.used_context_refs_within_boundary, null);
  assert.equal(outOfBoundary.measured.refs.reason, "request_base_refs_unavailable");
  assert.deepEqual(outOfBoundary.measured.refs.violations, []);
  assert.equal(outOfBoundary.measured.refs.reports[0].provider_call_ref, "pcall_1");
  assert.equal(outOfBoundary.measured.refs.reports[0].provider_run_ref, "prun_1");
  const legalFacts = designDbFacts({ usedRefs: ["observation:obs_1", "execution_brief:chapter:ch-1"], requestPrefix });
  const legal = evaluate({ llmRecords: records, dbFacts: legalFacts });
  assert.equal(legal.checks.mechanism.used_context_refs_within_boundary, null);
  assert.equal(legal.measured.refs.reason, "request_base_refs_unavailable");
  assert.equal(legal.measured.refs.reports.length, 1);
  assert.deepEqual(legal.measured.refs.reports[0].base_refs, []);
  assert.deepEqual(legal.measured.refs.reports[0].observation_refs, []);
  const unknown = evaluate({ llmRecords: records });
  assert.equal(unknown.checks.mechanism.used_context_refs_within_boundary, null);
});

test("L7 live 消费会话 Scope 前缀，历史 run 自报不混入当前段", () => {
  const priorScope = {
    role: "scope_update", provenance: "application",
    blocks: [{ type: "scope", content: { goal: { text: "历史轮" } } }],
    source_refs: [{ ref: "chapter:prior" }], versions: { scope_revision: 1 },
  };
  const currentScope = structuredClone(priorScope);
  currentScope.blocks[0].content.goal.text = "当前轮";
  currentScope.versions.scope_revision = 2;
  const facts = designDbFacts({ usedRefs: ["chapter:current"] });
  const currentReply = facts.segment_transcript.messages[0];
  const previousArguments = { self_report: { used_context_refs: ["chapter:prior"] } };
  const previousResult = { type: "validation_result", call_id: "call-prior", status: "failed", reason_code: "invalid_tool_arguments" };
  const priorReply = {
    role: "assistant", provenance: "model", provider_call_ref: "pcall_prior", provider_run_ref: "prun_prior",
    blocks: [{ type: "tool_call", call_id: "call-prior", name: "submit_tentative_artifact", arguments: previousArguments }],
  };
  const [currentBase, currentAuthor] = canonicalInput();
  facts.segment_transcript.messages = [currentBase, currentAuthor, currentScope, currentReply];
  facts.sessionMessages = [currentBase, priorScope, priorReply,
    { role: "tool", provenance: "tool_result", blocks: [previousResult] },
    currentAuthor, currentScope, currentReply];
  const messages = [
    system(), appBase(),
    scopeWireMessage(priorScope.blocks[0].content, { versions: priorScope.versions, sourceRefs: priorScope.source_refs }),
    { role: "assistant", content: "", tool_calls: [{ id: "call-prior", type: "function",
      function: { name: "submit_tentative_artifact", arguments: JSON.stringify(previousArguments) } }] },
    { role: "tool", tool_call_id: "call-prior", content: toolResultContent(previousResult) },
    author(),
    scopeWireMessage(currentScope.blocks[0].content, { versions: currentScope.versions, sourceRefs: currentScope.source_refs }),
  ];
  const llmRecords = [record(messages)];
  const checks = evaluate({ llmRecords, dbFacts: facts });
  assert.equal(checks.measured.refs.reason, "request_base_refs_unavailable");
  assert.equal(checks.measured.refs.sources.self_report_count, 1);
  assert.equal(checks.measured.refs.reports.length, 1);
  assert.equal(checks.measured.refs.reports[0].provider_call_ref, "pcall_1");
  delete facts.sessionMessages;
  const missing = evaluate({ llmRecords, dbFacts: facts });
  assert.equal(missing.measured.refs.reason, "scope_provenance_unbound");
});

test("L8 反例：真实请求中的作者原话被改写", () => {
  const checks = evaluate({ llmRecords: [record([system(), appBase(), author("帮我写一段开场，主角收到信。"), scope()])] });
  assert.equal(checks.checks.mechanism.author_bytes_exact, false);
});

test("L9 反例：未采纳前 canon 内容变化 / 生产表写入 / 候选非 TENTATIVE 都失败", () => {
  const canonChanged = evaluate({ llmRecords: [record([system(), appBase(), author(), scope()])], final: checkpoint("final", { canonHash: "changed" }) });
  assert.equal(canonChanged.checks.mechanism.unadopted_zero_write, false);
  const written = evaluate({
    llmRecords: [record([system(), appBase(), author(), scope()])],
    final: checkpoint("final", { counts: { mutations: 1 } }),
  });
  assert.equal(written.checks.mechanism.unadopted_zero_write, false);
  const adopted = evaluate({
    llmRecords: [record([system(), appBase(), author(), scope()])],
    body: turnBody({ adoption_state: { pending: [{ artifact_id: "as_1", adoption_status: "ACCEPTED" }] } }),
  });
  assert.equal(adopted.checks.mechanism.unadopted_zero_write, false);
});

test("L10 反例：真实调用缺 usage 时不冒充回收", () => {
  const checks = evaluate({
    llmRecords: [
      record([system(), appBase(), author(), scope()], {
        response: { status: 200, body: { content: "好的。", tool_calls: [] } },
      }),
    ],
  });
  assert.equal(checks.checks.mechanism.usage_collected, false);
});

test("L11：Why 未打开记 null 不计入必过；打开后 Provider 计数变化则失败", () => {
  const notOpened = evaluate({ llmRecords: [record([system(), appBase(), author(), scope()])], log: driverLog({ opened: false }) });
  assert.equal(notOpened.checks.mechanism.why_replay_zero_provider, null);
  assert(!notOpened.required_mechanism.includes("why_replay_zero_provider"));
  const providerCalled = evaluate({
    llmRecords: [record([system(), appBase(), author(), scope()])],
    log: driverLog({ opened: true, before: { llm_records: 1, provider_runs: 1 }, after: { llm_records: 2, provider_runs: 2 } }),
  });
  assert.equal(providerCalled.checks.mechanism.why_replay_zero_provider, false);
});

test("有候选且全部 TENTATIVE 时零写入成立，模型行为记录候选事实", () => {
  const checks = evaluate({
    llmRecords: [record([system(), appBase(), author(), scope()])],
    body: turnBody({
      adoption_state: { pending: [{ artifact_id: "as_1", artifact_type: "chapter_draft", adoption_status: "TENTATIVE" }] },
    }),
  });
  assert.equal(checks.checks.mechanism.unadopted_zero_write, true);
  assert.equal(checks.model_behavior.pending_artifact_count, 1);
  assert.equal(checks.model_behavior.had_candidate, true);
});

test("真实 strata 记录形状：request.body.messages + response.usage + response.body 字符串同样判过", () => {
  const reply = "我先核对现有材料，再给出候选。";
  const record = {
    ts: "2026-11-03T10:00:01.000Z",
    step: "judgment",
    turn_id: TURN,
    provider_call_ref: "pcall_strata_1",
    provider_run_ref: "prun_strata_1",
    provider: "strata",
    request: { body: { messages: [system(), appBase(), author(), scope()], tools: [], tool_choice: "auto" } },
    response: {
      status: 200,
      usage: { model: "iq3_s", input_tokens: 9009, output_tokens: 11, cached_tokens: 0, latency_ms: 14701, ttft_ms: null },
      body: JSON.stringify({
        id: "chatcmpl-real-shape",
        object: "chat.completion",
        model: "iq3_s",
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        usage: { prompt_tokens: 9009, completion_tokens: 11, total_tokens: 9020 },
      }),
    },
  };
  const checks = evaluate({ llmRecords: [record] });
  assert.deepEqual(checks.failed_mechanism, []);
  assert.equal(checks.checks.mechanism.ir_projection_structure, true);
  assert.equal(checks.checks.mechanism.author_bytes_exact, true);
  assert.equal(checks.checks.mechanism.usage_collected, true);
  const usage = checks.measured.usage[0];
  assert.equal(usage.present, true);
  assert(usage.fields.includes("input_tokens"));
});

test("同一 run 的 <turn>:agent:N step turn 合并：前缀连续、跨段工具回放、最后一次调用由终局证明", () => {
  const call = (id) => ({ id, type: "function", function: { name: "read_chapter", arguments: "{}" } });
  const base = [system(), appBase(), author(), scope()];
  const req1 = base;
  const req2 = [...base, { role: "assistant", content: "", tool_calls: [call("call_1")] }, { role: "tool", tool_call_id: "call_1", content: toolResultContent({ type: "observation", call_id: "call_1", status: "ok", source_refs: [], content: { summary: "观察 1" } }) }];
  // 最后一次请求（run 内第 3 次）发出的 call_3 不再有后续请求：由 run 终局证明。
  const req3 = [...req2, { role: "assistant", content: "", tool_calls: [call("call_2")] }, { role: "tool", tool_call_id: "call_2", content: toolResultContent({ type: "observation", call_id: "call_2", status: "ok", source_refs: [], content: { summary: "观察 2" } }) }];
  const records = [
    record(req1, { ts: "2026-11-03T10:00:01.000Z", provider_call_ref: "pcall_1", turn_id: TURN, response: { status: 200, body: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, tool_calls: [call("call_1")] } } }),
    record(req2, { ts: "2026-11-03T10:00:03.000Z", provider_call_ref: "pcall_2", turn_id: `${TURN}:agent:7`, response: { status: 200, body: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, tool_calls: [call("call_2")] } } }),
    record(req3, { ts: "2026-11-03T10:00:05.000Z", provider_call_ref: "pcall_3", turn_id: `${TURN}:agent:7`, response: { status: 200, body: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, tool_calls: [call("call_3")] } } }),
  ];
  const checks = evaluate({ llmRecords: records });
  assert.equal(checks.checks.mechanism.append_only_prefix, true, "跨 step turn 的前缀连续");
  assert.equal(checks.checks.mechanism.tool_call_result_binding, true, "call_1/call_2 跨段回放绑定");
  assert.equal(checks.checks.mechanism.observation_reaches_next_request, true);
  const terminal = checks.measured.tool_binding.find((b) => b.call_id === "call_3");
  assert.equal(terminal.terminal_without_replay, true, "最后一次调用由 run 终局证明，不要求回放");
  assert.equal(checks.measured.tool_binding.filter((b) => !b.terminal_without_replay).length, 2);
});


test("L7 逐调用反例：A 自报的 ref 只在 B 的请求/事件/段头出现 → false", () => {
  const nativeScope = {
    role: "scope_update", provenance: "application", source_refs: [], base_refs: [], versions: { scope_revision: 1 },
    blocks: [{ type: "scope", content: { context: {} } }],
  };
  const base = [system(), appBase("材料：chapter:ch-base"), author(),
    scopeWireMessage(nativeScope.blocks[0].content, { versions: nativeScope.versions })];
  const call = { id: "call_b", type: "function", function: { name: "read_chapter", arguments: "{}" } };
  const recordA = record(base, {
    provider_call_ref: "pcall_A",
    provider_run_ref: "prun_A",
  });
  recordA.request.refs = { base_refs: [], observation_refs: [], used_refs: [] };
  const recordB = record(
    [
      ...base,
      { role: "assistant", content: "", tool_calls: [call] },
      {
        role: "tool",
        tool_call_id: "call_b",
        content: toolResultContent({
          type: "observation",
          call_id: "call_b",
          status: "ok",
          source_refs: ["observation:obs_b"],
        }),
      },
    ],
    {
      provider_call_ref: "pcall_B",
      provider_run_ref: "prun_B",
    },
  );
  const checks = evaluate({
    llmRecords: [recordA, recordB],
    dbFacts: designDbFacts({
      usedRefs: ["observation:obs_b"],
      providerCallRef: "pcall_A",
      providerRunRef: "prun_A",
      requestPrefix: [...canonicalInput("材料：chapter:ch-base"), nativeScope],
      segmentUsedRefs: [{ ref: "observation:obs_b" }],
      agentEventRefs: ["observation:obs_b"],
    }),
  });
  assert.equal(checks.checks.mechanism.used_context_refs_within_boundary, false);
  assert.equal(checks.measured.refs.reports[0].provider_call_ref, "pcall_A");
  assert.equal(checks.measured.refs.reason, "used_ref_out_of_boundary");
  assert.equal(checks.measured.refs.reports[0].provider_run_ref, "prun_A");
  assert(checks.measured.refs.violations.some((violation) => violation.ref === "observation:obs_b"));
});

test("L9 分层：有 pcall/decision_trace/basis_ref 支撑的 TENTATIVE 设计态派生允许，并单列", () => {
  const messages = [system(), appBase("材料：chapter:ch-1"), author(), scope()];
  const checks = evaluate({
    llmRecords: [record(messages)],
    dbFacts: designDbFacts({ usedRefs: ["observation:obs_1"] }),
    final: checkpoint("final", { design: "design-2" }),
  });
  assert.equal(checks.checks.mechanism.unadopted_zero_write, true);
  const layers = checks.measured.canon;
  assert.equal(layers.other_tables_equal, true);
  assert.equal(layers.chapters_approved_equal, true);
  assert.equal(layers.tentative_design_derivations.length, 1);
  assert.equal(layers.tentative_design_derivations[0].valid, true);
  assert.equal(layers.tentative_design_derivations[0].provider_call_ref, "pcall_1");
  assert(layers.tentative_design_derivations[0].basis_refs.includes("observation:obs_1"));
});

test("L9 分层反例：派生无真实 pcall / 来源非 model / 已采纳字段变化都失败", () => {
  const messages = [system(), appBase("材料：chapter:ch-1"), author(), scope()];
  const bogusPcall = evaluate({
    llmRecords: [record(messages)],
    dbFacts: designDbFacts({ usedRefs: ["observation:obs_1"], mission: { provider_call_ref: "pcall_not_in_llm" } }),
    final: checkpoint("final", { design: "design-2" }),
  });
  assert.equal(bogusPcall.checks.mechanism.unadopted_zero_write, false);
  assert(bogusPcall.measured.canon.invalid_design_derivations.length > 0);
  const authorSource = evaluate({
    llmRecords: [record(messages)],
    dbFacts: designDbFacts({ usedRefs: ["observation:obs_1"], mission: { source: "author" } }),
    final: checkpoint("final", { design: "design-2" }),
  });
  assert.equal(authorSource.checks.mechanism.unadopted_zero_write, false);
  const approvedChanged = evaluate({
    llmRecords: [record(messages)],
    dbFacts: designDbFacts({ usedRefs: ["observation:obs_1"] }),
    final: checkpoint("final", {
      chapters: { "chapter-row": { approved_sha256: "approved-changed", design_state_sha256: "design-2" } },
    }),
  });
  assert.equal(approvedChanged.checks.mechanism.unadopted_zero_write, false);
});

function splashMechanism(records, overrides = {}) {
  return b71LiveModelBehavior({
    dir: "/tmp/unused",
    config: { ...config, journey: "behavior", provider: "splash" },
    llmRecords: records,
    wire: wire(),
    startCheckpoint: checkpoint("start"),
    finalCheckpoint: checkpoint("final"),
    driverLog: { ...driverLog(), provider: "splash", model: "local/Q4-PLE4" },
    model: "local/Q4-PLE4",
    ...overrides,
  });
}

test("R08 既有 live 机制直接消费冻结 Splash provider，不借 Strata 调用兜底", () => {
  const actual = { ...record([system(), appBase(), author(), scope()]), provider: "splash" };
  const checks = splashMechanism([actual]);
  assert.deepEqual(checks.failed_mechanism, []);
  assert.equal(checks.measured.provider, "splash");
  assert.equal(checks.measured.provider_calls, 1);
  assert.deepEqual(checks.measured.provider_call_refs, ["pcall_1"]);
  assert.equal(checks.model, "local/Q4-PLE4");
  assert.equal(checks.checks.mechanism.author_bytes_exact, true);
});

test("R08 冻结 Splash 批次只有 Strata 记录时不能取得任何有效调用证明", () => {
  assert.throws(() => splashMechanism([record([system(), appBase(), author(), scope()])]), /provider|供应商|splash|调用/u);
});

test("R08 Splash 与原 live 共用作者字节及未采纳零写入硬门", () => {
  const corrupted = { ...record([system(), appBase(), author(AUTHOR + "被补写"), scope()]), provider: "splash" };
  const changed = splashMechanism([corrupted], { finalCheckpoint: checkpoint("final", { canonHash: "changed" }) });
  assert.equal(changed.checks.mechanism.author_bytes_exact, false);
  assert.equal(changed.checks.mechanism.unadopted_zero_write, false);
  assert(changed.failed_mechanism.includes("author_bytes_exact"));
  assert(changed.failed_mechanism.includes("unadopted_zero_write"));
});

function terminalDecisionRecord() {
  return { ...record([system(), appBase(), author(), scope()]), provider: "splash",
    response: { status: 200, usage: { input_tokens: 100, output_tokens: 10 },
      body: { source: "sse_decoder", tool_calls: [
        { id: "call-terminal", name: "judgment_decision", arguments: { action: "execute",
          capability: "prose_writing", dialogue_goal: "生成开场候选", author_reasoning: "按现有正文生成候选。" } },
      ] } } };
}

test("R08 真实终局最后工具无后续观察义务时L6未触发，不伪造回流通过", () => {
  const checks = splashMechanism([terminalDecisionRecord()]);
  assert.equal(checks.checks.mechanism.observation_reaches_next_request, null);
  assert(!checks.required_mechanism.includes("observation_reaches_next_request"));
  assert(!checks.failed_mechanism.includes("observation_reaches_next_request"));
  assert(checks.not_signed.includes("G2_observation_roundtrip_not_triggered"));
});

test("R08 缺实际终局时不能只因调用排最后就免除工具闭合证明", () => {
  const checks = splashMechanism([terminalDecisionRecord()], {
    wire: [], driverLog: { ...driverLog(), run: { status: "running" } },
  });
  assert.equal(checks.checks.mechanism.tool_call_result_binding, false);
  assert(checks.failed_mechanism.includes("tool_call_result_binding"));
});
test("R08 DB停等但尚无公开业务回包时，最后工具不能取得L6豁免", () => {
  const checks = splashMechanism([terminalDecisionRecord()], {
    wire: [], driverLog: { ...driverLog(), run: { status: "awaiting_author" } },
    dbFacts: { agent_run: { id: RUN, parent_turn_ref: TURN, status: "awaiting_author",
      workspace_id: "test", work_id: "work-live", session_id: "session-live" } },
  });
  assert.equal(checks.checks.mechanism.tool_call_result_binding, false);
  assert.equal(checks.checks.mechanism.observation_reaches_next_request, false);
  assert(checks.failed_mechanism.includes("tool_call_result_binding"));
});

const repairSha = bytes => createHash("sha256").update(bytes).digest("hex");
const repairTime = second => `2026-11-24T12:00:${second}Z`;

function repairSse(text) {
  return Buffer.from([
    "data: " + JSON.stringify({ id: "fixture-response",
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] }),
    "data: " + JSON.stringify({ id: "fixture-response",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    "data: [DONE]", "",
  ].join("\n\n"));
}

// 仅将独立手写输入行编码为现快照；不调用维护判据反推 expected。
function refreshRepairCanon(proof) {
  for (const snapshot of Object.values(proof.snapshots)) {
    const tables = Object.fromEntries(CANON_TABLES.map(name => [name, []]));
    tables.works = structuredClone(snapshot.works);
    tables.chapters = snapshot.chapters.map(({ chapter_id, ...row }) => ({ id: chapter_id, ...row }));
    for (const name of ["drafts", "scenes", "ledger_entries"]) {
      tables[name] = structuredClone(snapshot.scope_rows[name]);
    }
    tables.author_action_receipts = structuredClone(snapshot.action_receipts);
    snapshot.authoring_canon = buildAuthoringCanonSnapshot({
      tables, referenceLogs: [], at: snapshot.at, includeChapterFacts: false, includeWorkFacts: true,
    });
  }
}

// 修改请求后重新封 hash 是刻意的反例：合法 byte seal 本身不能证明源材料正确。
function rebuildRepairTransport(proof) {
  const bytes = new Map(), events = [];
  proof.transportBytes = bytes;
  proof.providerStream = {
    directory: proof.config.preregistration.proxy_dir,
    ready: { mode: "observe", endpoint: proof.config.endpoint,
      upstream_endpoint: "http://127.0.0.1:7999/v1", max_upstream_requests: null,
      upstream_requests_admitted: 0, budget_requests_rejected: 0 },
    events,
    readBytes(name) {
      assert(bytes.has(name), "Missing fixture original: " + name);
      return bytes.get(name);
    },
  };
  const capture = (id, method, request, response, start, end) => {
    const admitted = events.filter(row => row.event === "upstream_request_forwarded").length;
    const emit = (event, fields = {}) => events.push({
      sequence: events.length + 1, event, request_id: id,
      at: ["upstream_end", "transparent_complete"].includes(event) ? end : start,
      max_upstream_requests: null, upstream_requests_admitted: admitted + 1,
      budget_requests_rejected: 0, ...fields,
    });
    bytes.set(id + ".bin", request);
    bytes.set(id + ".received.bin", response);
    bytes.set(id + ".delivered.bin", Buffer.from(response));
    emit("request_registered", { method,
      path: method === "POST" ? "/v1/chat/completions" : "/v1/models",
      request_sha256: repairSha(request), upstream_admitted: false,
      forwarded: false, upstream_requests_admitted: admitted });
    emit("upstream_request_forwarded", { upstream_admitted: true, forwarded: true });
    emit("response_headers", { response_status: 200, response_encoding: "identity",
      content_type: method === "POST" ? "text/event-stream" : "application/json" });
    emit("upstream_end");
    emit("transparent_complete", { response_complete: true, received_bytes: response.length,
      delivered_bytes: response.length, received_sha256: repairSha(response),
      delivered_sha256: repairSha(response) });
  };
  proof.llmRecords.forEach((record, index) => {
    const [start, end] = proof.callWindows[record.provider_call_ref];
    capture("request-" + (index + 1), "POST", Buffer.from(JSON.stringify(record.request.body)),
      proof.rawResponses[record.provider_call_ref], start, end);
  });
  capture("request-" + (proof.llmRecords.length + 1), "GET", Buffer.alloc(0),
    Buffer.from('{"data":[]}'), repairTime("08.000"), repairTime("08.010"));
}

function missionRepairFixture({ maintenance = true } = {}) {
  const work = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const endpoint = "http://127.0.0.1:8000/v1", model = "local/Q4-PLE4";
  const summaryA = "【情节推进】陆青捡起铜钥。\n【人物状态与弧光】陆青留意桥下动静。\n【伏笔动作】（无）\n【情绪基调】警觉。";
  const summaryB = "【情节推进】陆青交出铜钥。\n【人物状态与弧光】陆青取得守门人的信任。\n【伏笔动作】（无）\n【情绪基调】平静。";
  const sourceA = "陆青在桥下捡起铜钥。\n他听见桥上传来脚步声。";
  const sourceB = "陆青把铜钥交给守门人。";
  const record = (suffix, chapter, text, at) => ({
    provider: "splash", provider_call_ref: "pcall-" + suffix, provider_run_ref: "prun-" + suffix,
    work_id: work, session_id: "session-repair",
    step: chapter ? "chapter_summary" : "author_reasoning",
    turn_id: chapter ? "unknown" : "turn-repair:agent:1", ts: at,
    request: {
      method: "POST", url: endpoint + "/chat/completions",
      refs: { base_refs: chapter ? ["summary_repair:" + chapter, "chapter:" + chapter] : [],
        observation_refs: [], used_refs: [] },
      body: { model, stream: true, reasoning_effort: "high", max_tokens: 32000,
        messages: [
          { role: "system", content: chapter
            ? "本轮任务：章节摘要。目标章 ref：chapter:" + chapter : "请依据已供应材料回应作者。" },
          { role: "user", content: chapter
            ? "【应用数据 · application_base · 非作者原话】\n## 本次材料正文\n已采纳正文：\n" + text
            : "请按已有三章往后规划接下来三章的章节大纲，保持为待采纳草稿。" },
        ],
      },
    },
    response: { status: 200, body: { source: "sse_decoder", tool_calls: [] } },
  });
  const scope = { runId: "run-repair", turnId: "turn-repair", workspaceId: "workspace-repair",
    workId: work, sessionId: "session-repair" };
  const ledger = (id, fields) => ({ id, work_id: work, design_ref: null, adoption_status: "ACCEPTED",
    revision: 1, inserted_at: repairTime("03.050"), updated_at: repairTime("03.100"), ...fields });
  const old = ledger("old-other-work", {
    work_id: other, ledger: "arc", subject_kind: "character", subject_ref: "other-character",
    subject_label: "另一作品人物", status: "ON_TRACK", payload: { last_seen_seq: 1 },
    source_refs: ["chapter_summary:other-chapter"], last_event_chapter: "other-chapter",
    inserted_at: "2026-11-23T12:00:00.000Z", updated_at: "2026-11-23T12:00:00.000Z",
  });
  const start = {
    at: repairTime("00.000"), action_receipts: [],
    works: [work, other].map(id => ({ id, title: id === work ? "桥下铜钥" : "另一作品", genre: "悬疑",
      planning_direction: "{}", revision: 1,
      inserted_at: "2026-11-23T12:00:00.000Z", updated_at: repairTime("00.000") })),
    chapters: [a, b].map((chapter_id, index) => ({
      chapter_id, work_id: work, seq: index + 1, title: index ? "第02章：守门人" : "第01章：桥下",
      status: "DRAFTING", updated_at: repairTime("00.000"),
    })),
    scope_rows: {
      scenes: [
        { id: "scene-a1", chapter_id: a, seq: 1 }, { id: "scene-a2", chapter_id: a, seq: 2 },
        { id: "scene-b1", chapter_id: b, seq: 1 },
      ],
      drafts: [
        { id: "draft-a1", work_id: work, scene_id: "scene-a1", status: "ACCEPTED", revision: 2,
          content: "陆青在桥下捡起铜钥。" },
        { id: "draft-a2", work_id: work, scene_id: "scene-a2", status: "ACCEPTED", revision: 5,
          content: "他听见桥上传来脚步声。" },
        { id: "draft-b1", work_id: work, scene_id: "scene-b1", status: "ACCEPTED", revision: 7,
          content: sourceB },
      ],
      chapter_summaries: [], ledger_entries: [old],
    },
  };
  const final = structuredClone(start);
  final.at = repairTime("10.000");
  if (maintenance) {
    final.scope_rows.chapter_summaries = [
      { id: "summary-a", chapter_id: a, summary_text: summaryA, at: "03.000" },
      { id: "summary-b", chapter_id: b, summary_text: summaryB, at: "07.000" },
    ].map(({ at, ...row }) => ({
      ...row, work_id: work, source_ref: "summary_repair:" + row.chapter_id,
      revision_base: null, status: "ACCEPTED", inserted_at: repairTime(at), updated_at: repairTime(at),
    }));
    final.scope_rows.ledger_entries.push(
      ledger("arc-both", {
        ledger: "arc", subject_kind: "character", subject_ref: "hero-luqing", subject_label: "陆青",
        status: "ON_TRACK", payload: { last_seen_seq: 2 },
        source_refs: ["chapter_summary:" + a, "chapter_summary:" + b], last_event_chapter: b,
        revision: 2, updated_at: repairTime("07.100"),
      }),
      ...[a, b].map((chapter, index) => ledger("emotion-" + index, {
        ledger: "emotion_curve", subject_kind: "chapter", subject_ref: chapter,
        subject_label: index ? "第02章·情绪" : "第01章·情绪", status: "UNPLANNED",
        payload: { intended: null, realized: index ? "平静。" : "警觉。", seq: index + 1 },
        source_refs: ["chapter_summary:" + chapter], last_event_chapter: chapter,
        inserted_at: repairTime(index ? "07.050" : "03.050"),
        updated_at: repairTime(index ? "07.100" : "03.100"),
      })),
      ledger("genre", {
        ledger: "promise", subject_kind: "promise", subject_ref: "genre", subject_label: "类型承诺：悬疑",
        status: "OPEN", payload: { promise_kind: "genre", content: "悬疑" },
        source_refs: ["work_profile:" + work], last_event_chapter: null,
      }),
    );
  }
  const proof = {
    config: { provider: "splash", model, endpoint, target: { work_id: work, session_id: scope.sessionId },
      preregistration: { path: "/frozen/wr02/preregistration.json", sha256: "a".repeat(64),
        proxy_dir: "/frozen/wr02/proxy-01", max_upstream_requests: null } },
    scenarioScopes: [scope],
    providerRuns: [{ id: "prun-author", provider_call_ref: "pcall-author", provider_id: "splash",
      model, agent_run_id: scope.runId, parent_turn_ref: scope.turnId, workspace_id: scope.workspaceId,
      work_id: work, session_id: scope.sessionId, status: "completed", purpose: "author_reasoning" }],
    llmRecords: [record("author", null, null, repairTime("01.000")), ...(maintenance ? [
      record("summary-a", a, sourceA, repairTime("02.000")),
      record("summary-b", b, sourceB, repairTime("06.000")),
    ] : [])],
    snapshots: { start, final },
    appRecords: maintenance ? [a, b].flatMap((chapter, index) => [
      { event: "chapter_summary_maintenance.run.done", outcome: "ok", work_id: work,
        chapter_id: chapter, status: "ACCEPTED", four_column: true,
        timestamp: repairTime(index ? "07.000" : "03.000") },
      { event: "ledger.update.done", outcome: "ok", work_id: work, chapter_id: chapter,
        timestamp: repairTime(index ? "07.200" : "03.200") },
    ]) : [],
    rawResponses: { "pcall-author": repairSse("三个后续章节已保留为待采纳草稿。"),
      "pcall-summary-a": repairSse(summaryA), "pcall-summary-b": repairSse(summaryB) },
    callWindows: { "pcall-author": [repairTime("01.000"), repairTime("01.500")],
      "pcall-summary-a": [repairTime("02.000"), repairTime("02.800")],
      "pcall-summary-b": [repairTime("06.000"), repairTime("06.800")] },
  };
  refreshRepairCanon(proof);
  rebuildRepairTransport(proof);
  return proof;
}

const repairPassed = report => Object.keys(report.checks).length > 0 &&
  Object.values(report.checks).every(value => value === true);

test("WR02 两章 repair 绑定源版本，允许同一 arc 跨两个真实维护窗口更新", () => {
  const proof = missionRepairFixture();
  const result = liveEvidence.missionRepairEvidence(proof);
  assert.equal(repairPassed(result), true, JSON.stringify(result));
  assert.equal(result.auxiliary.length, 2);
  assert.deepEqual(result.authorRecords, [proof.llmRecords[0]]);
  assert.deepEqual(result.auxiliary.map(fact => fact.source_rows.map(row => [row.id, row.revision])),
    [[["draft-a1", 2], ["draft-a2", 5]], [["draft-b1", 7]]]);
  assert(result.auxiliary.every(fact => fact.revision_base === null));
  assert.equal(result.transport.model_POST, 3);
  assert.equal(result.transport.GET, 1);
  assert.equal(result.transport.admitted, 4);
  assert.equal(result.transport.max_upstream_requests, null);
  assert(proof.snapshots.final.scope_rows.chapter_summaries.every(row => row.revision_base === null));
  assert(proof.snapshots.final.scope_rows.ledger_entries
    .flatMap(row => row.source_refs).every(ref => !ref.includes("@")));
  assert(result.maintenanceEvidence);
});

test("WR02 零维护保留真实作者调用和 HTTP 分母，并保持原严格零写边界", () => {
  const proof = missionRepairFixture({ maintenance: false });
  const result = liveEvidence.missionRepairEvidence(proof);
  assert.equal(repairPassed(result), true, JSON.stringify(result));
  assert.deepEqual(result.auxiliary, []);
  assert.deepEqual(result.authorRecords, [proof.llmRecords[0]]);
  assert.equal(result.transport.model_POST, 1);
  assert.equal(result.transport.GET, 1);
  assert.equal(result.maintenanceEvidence, null);
  assert.deepEqual(proof.snapshots.final.scope_rows, proof.snapshots.start.scope_rows);
  proof.snapshots.final.scope_rows.ledger_entries[0].payload.last_seen_seq = 99;
  refreshRepairCanon(proof);
  assert.equal(repairPassed(liveEvidence.missionRepairEvidence(proof)), false);
});

for (const [name, change] of [
  ["原始请求与 seal 一起改写，但已采纳正文没有该句", p => {
    p.llmRecords[1].request.body.messages[1].content += "\n这是未采纳的新句。";
    rebuildRepairTransport(p);
  }],
  ["正文相同但实际源 draft revision 已变", p => {
    p.snapshots.final.scope_rows.drafts[0].revision += 1;
    refreshRepairCanon(p);
  }],
  ["开场候选不能冒充已采纳源", p => {
    p.snapshots.start.scope_rows.drafts[0].status = "TENTATIVE";
    p.snapshots.final.scope_rows.drafts[0].status = "TENTATIVE";
    refreshRepairCanon(p);
  }],
  ["正文场次顺序与原请求不一致", p => {
    for (const snapshot of Object.values(p.snapshots)) {
      snapshot.scope_rows.scenes[0].seq = 2;
      snapshot.scope_rows.scenes[1].seq = 1;
    }
    refreshRepairCanon(p);
  }],
  ["辅助记录只有一半身份命中真实 ProviderRun", p => {
    p.providerRuns.push({ ...p.providerRuns[0], id: "prun-summary-a", provider_call_ref: "pcall-unrelated" });
  }],
  ["辅助调用伪装成本轮作者 ProviderRun", p => {
    p.llmRecords[1].turn_id = "turn-repair:agent:2";
    p.providerRuns.push({ ...p.providerRuns[0], id: "prun-summary-a", provider_call_ref: "pcall-summary-a" });
  }],
  ["未知辅助角色不得按摘要调用排除", p => { p.llmRecords[1].step = "unknown_background_task"; }],
  ["完整 byte seal 不能代替完整 SSE 终局", p => {
    p.rawResponses["pcall-summary-a"] = Buffer.from(
      'data: {"choices":[{"index":0,"delta":{"content":"未结束"},"finish_reason":null}]}\n\n');
    rebuildRepairTransport(p);
  }],
  ["原始响应被遗漏", p => { p.transportBytes.delete("request-2.received.bin"); }],
  ["其中一章缺实际 ledger 终态", p => { p.appRecords.splice(3, 1); }],
  ["只有旧 ledger 成功日志", p => { p.appRecords[3].timestamp = "2026-11-23T12:00:07.200Z"; }],
  ["同章两个本场 ACCEPTED 摘要造成歧义", p => {
    p.snapshots.final.scope_rows.chapter_summaries.push({
      ...p.snapshots.final.scope_rows.chapter_summaries[0], id: "summary-duplicate" });
  }],
  ["原始摘要和实际存储不同", p => {
    p.snapshots.final.scope_rows.chapter_summaries[0].summary_text += "未返回的字句。";
  }],
  ["repair不能伪造一个产品未写入的revision_base", p => {
    p.snapshots.final.scope_rows.chapter_summaries[0].revision_base = "draft:draft-a1:2";
  }],
  ["同作品维护不能豁免另一作品原行内容变化", p => {
    p.snapshots.final.scope_rows.ledger_entries[0].payload.last_seen_seq = 88;
    refreshRepairCanon(p);
  }],
  ["删除旧 ledger 行", p => {
    p.snapshots.final.scope_rows.ledger_entries.shift();
    refreshRepairCanon(p);
  }],
  ["emotion写向未绑定章", p => {
    const row = p.snapshots.final.scope_rows.ledger_entries.find(row => row.id === "emotion-0");
    row.subject_ref = row.last_event_chapter = "unread-chapter";
    refreshRepairCanon(p);
  }],
  ["引入不属于本场的摘要来源", p => {
    p.snapshots.final.scope_rows.ledger_entries.find(row => row.id === "arc-both")
      .source_refs.push("chapter_summary:unrelated");
    refreshRepairCanon(p);
  }],
  ["ledger更新时间落在两个真实维护窗口之间的空档", p => {
    p.snapshots.final.scope_rows.ledger_entries.find(row => row.id === "arc-both")
      .updated_at = repairTime("05.000");
    refreshRepairCanon(p);
  }],
  ["emotion不能借另一章的维护窗口更新", p => {
    p.snapshots.final.scope_rows.ledger_entries.find(row => row.id === "emotion-0")
      .updated_at = repairTime("07.100");
    refreshRepairCanon(p);
  }],
  ["已有有效ACCEPTED摘要不得以repair无故替换", p => {
    const old = { ...p.snapshots.final.scope_rows.chapter_summaries[0], id: "already-current",
      summary_text: "【情节推进】已有摘要。\n【人物状态与弧光】（无）\n【伏笔动作】（无）\n【情绪基调】平静。",
      inserted_at: "2026-11-23T12:00:00.000Z", updated_at: "2026-11-23T12:00:00.000Z" };
    p.snapshots.start.scope_rows.chapter_summaries.push(structuredClone(old));
    p.snapshots.final.scope_rows.chapter_summaries.push({
      ...old, status: "SUPERSEDED", updated_at: repairTime("03.000") });
  }],
  ["新增作者采纳回执", p => {
    p.snapshots.final.action_receipts.push({ id: "unrequested-adoption", work_id: p.config.target.work_id });
    refreshRepairCanon(p);
  }],
  ["原null HTTP cap被替换为有限预算", p => {
    p.providerStream.ready.max_upstream_requests = 32;
  }],
]) {
  test("WR02 repair 拒绝：" + name, () => {
    const proof = missionRepairFixture();
    change(proof);
    assert.equal(repairPassed(liveEvidence.missionRepairEvidence(proof)), false);
  });
}

test("WR02 真实日志形态允许辅助缺owner字段、作者unknown step及原样保留旧information账", () => {
  const proof = missionRepairFixture();
  for (const record of proof.llmRecords.slice(1)) {
    delete record.work_id;
    delete record.session_id;
    delete record.workspace_id;
  }
  proof.llmRecords[0].step = "unknown";
  proof.providerRuns[0].purpose = "planner";
  for (const snapshot of Object.values(proof.snapshots)) {
    const old = snapshot.scope_rows.ledger_entries[0];
    old.work_id = proof.config.target.work_id;
    old.ledger = "information";
    old.subject_kind = "information";
  }
  const arc = proof.snapshots.final.scope_rows.ledger_entries.find(row => row.id === "arc-both");
  arc.revision = 3;
  arc.source_refs.reverse();
  refreshRepairCanon(proof);
  const result = liveEvidence.missionRepairEvidence(proof);
  assert.equal(repairPassed(result), true, JSON.stringify(result));
  assert.equal(result.auxiliary.length, 2);
  assert.deepEqual(result.authorRecords, [proof.llmRecords[0]]);
});

test("R08 question子turn由同run终局绑定，真实发布ask可停等并保留未触发L6", () => {
  const args = { question: "请选择要续写的章节。", options: [] };
  const actual = { ...terminalDecisionRecord(), response: { status: 200,
    usage: { input_tokens: 100, output_tokens: 10 }, body: { source: "sse_decoder",
      tool_calls: [{ id: "call-question", name: "ask_author", arguments: args }] } } };
  const questionTurn = `${TURN}:question:one`;
  const body = { ...turnBody(), turn_id: questionTurn, work_id: "work-live", session_id: "session-live",
    agent_run: { run_id: RUN, parent_turn_ref: TURN, status: "awaiting_author" },
    assistant_message: { text: args.question }, adoption_state: { pending: [] },
    phase: "awaiting_author", next_action: "waiting_for_author",
    author_question: { question_ref: "question:one", run_id: RUN, source_turn_ref: questionTurn,
      goal_version: 1, question: args.question, options: [], status: "open", provider_call_ref: "pcall_1" },
    available_actions: [{ action_type: "author_choice", enabled: true, question_ref: "question:one",
      target_ref: RUN, source_turn_ref: questionTurn, expected_goal_version: 1, trace_ref: "pcall_1" }] };
  const checks = splashMechanism([actual], {
    wire: wire(body), driverLog: { ...driverLog(), run: { status: "awaiting_author" } },
    dbFacts: { agent_run: { id: RUN, parent_turn_ref: TURN, status: "awaiting_author",
      workspace_id: "test", work_id: "work-live", session_id: "session-live" },
      segment_transcript: { messages: [{ role: "assistant", provenance: "model",
        provider_call_ref: "pcall_1", provider_run_ref: "prun_1",
        blocks: [{ type: "tool_call", call_id: "call-question", name: "ask_author", arguments: args }] }] } },
  });
  assert.equal(checks.checks.mechanism.tool_call_result_binding, true);
  assert.equal(checks.checks.mechanism.observation_reaches_next_request, null);
  assert.equal(checks.model_behavior.ask_author, true);
});
