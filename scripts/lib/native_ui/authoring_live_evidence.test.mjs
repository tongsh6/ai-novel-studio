// CP3b 实模机制判据（L1–L12）正反例：只验证结构事实，不要求固定文本/调用次数；
// 模型未触发的切片进 not_signed，不伪造覆盖。
import assert from "node:assert/strict";
import test from "node:test";
import { b71LiveModelBehavior } from "./authoring_live_evidence.mjs";

const AUTHOR = "先看看第01章现在的设定和正文，再写一段更紧张的开场：主角在雨夜收到一封没有署名的信。";
const TURN = "message_live_1";
const RUN = "run_live_1";

const system = () => ({ role: "system", content: "你在 AI Novel Studio 中工作，作者是唯一裁决者。" });
const appBase = (extra = "") => ({
  role: "user",
  content: `【应用数据 · application_base · 非作者原话】\n创作判断器规则。\n${extra}`,
});
const author = (text = AUTHOR) => ({ role: "user", content: text });
const scope = () => ({ role: "user", content: "【应用数据 · scope_update · 以最新版本为准】\n版本：{\"scope_revision\":1}" });

const config = { journey: "live", provider: "strata", message: AUTHOR, slice_id: "b71-first-consumer" };

function record(messages, overrides = {}) {
  return {
    ts: overrides.ts ?? "2026-11-03T10:00:01.000Z",
    turn_id: TURN,
    provider_call_ref: overrides.provider_call_ref ?? "pcall_1",
    provider: "strata",
    request_body: overrides.request_body ?? { messages, tools: [], tool_choice: "auto" },
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

function designDbFacts({ mission = {}, transcriptUsed = [], agentEventRefs = ["obs_1"], traces = [{ trace_id: "trace_1", turn_id: TURN, context_refs: null }], mutations = 0 } = {}) {
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
    transcripts: [{ authoring_transcript: JSON.stringify({ self_report: { used_context_refs: transcriptUsed } }) }],
    transcript_text: JSON.stringify({ self_report: { used_context_refs: transcriptUsed } }),
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
    { role: "tool", tool_call_id: "call_read_1", content: "第01章正文：雨夜，旧书铺。" },
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
    { role: "tool", tool_call_id: "call_replay_1", content: "第01章正文" },
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

test("L7：used 从持久结构读取——越界失败、合法通过、不可提取记 null", () => {
  const messages = [system(), appBase("材料：chapter:ch-1"), author(), scope()];
  const records = [record(messages)];
  const outOfBoundary = evaluate({
    llmRecords: records,
    dbFacts: designDbFacts({ transcriptUsed: ["observation:obs_out_of_boundary"] }),
  });
  assert.equal(outOfBoundary.checks.mechanism.used_context_refs_within_boundary, false);
  assert(outOfBoundary.measured.refs.violations.length > 0);
  const legal = evaluate({
    llmRecords: records,
    dbFacts: designDbFacts({ transcriptUsed: ["observation:obs_1", "execution_brief:chapter:ch-1"] }),
  });
  assert.equal(legal.checks.mechanism.used_context_refs_within_boundary, true);
  const unknown = evaluate({ llmRecords: records });
  assert.equal(unknown.checks.mechanism.used_context_refs_within_boundary, null);
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
  const req2 = [...base, { role: "assistant", content: "", tool_calls: [call("call_1")] }, { role: "tool", tool_call_id: "call_1", content: "观察 1" }];
  // 最后一次请求（run 内第 3 次）发出的 call_3 不再有后续请求：由 run 终局证明。
  const req3 = [...req2, { role: "assistant", content: "", tool_calls: [call("call_2")] }, { role: "tool", tool_call_id: "call_2", content: "观察 2" }];
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


test("L9 分层：有 pcall/decision_trace/basis_ref 支撑的 TENTATIVE 设计态派生允许，并单列", () => {
  const messages = [system(), appBase("材料：chapter:ch-1"), author(), scope()];
  const checks = evaluate({
    llmRecords: [record(messages)],
    dbFacts: designDbFacts({ transcriptUsed: ["observation:obs_1"] }),
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
    dbFacts: designDbFacts({ transcriptUsed: ["observation:obs_1"], mission: { provider_call_ref: "pcall_not_in_llm" } }),
    final: checkpoint("final", { design: "design-2" }),
  });
  assert.equal(bogusPcall.checks.mechanism.unadopted_zero_write, false);
  assert(bogusPcall.measured.canon.invalid_design_derivations.length > 0);
  const authorSource = evaluate({
    llmRecords: [record(messages)],
    dbFacts: designDbFacts({ transcriptUsed: ["observation:obs_1"], mission: { source: "author" } }),
    final: checkpoint("final", { design: "design-2" }),
  });
  assert.equal(authorSource.checks.mechanism.unadopted_zero_write, false);
  const approvedChanged = evaluate({
    llmRecords: [record(messages)],
    dbFacts: designDbFacts({ transcriptUsed: ["observation:obs_1"] }),
    final: checkpoint("final", {
      chapters: { "chapter-row": { approved_sha256: "approved-changed", design_state_sha256: "design-2" } },
    }),
  });
  assert.equal(approvedChanged.checks.mechanism.unadopted_zero_write, false);
});
