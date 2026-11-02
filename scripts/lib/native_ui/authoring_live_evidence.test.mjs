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

function checkpoint(name, { canonHash = "canon-content", counts = {}, tables = null } = {}) {
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

function evaluate({ llmRecords, start = checkpoint("start"), final = checkpoint("final"), body = turnBody(), log = driverLog() } = {}) {
  return b71LiveModelBehavior({
    dir: "/tmp/unused",
    config,
    llmRecords,
    wire: wire(body),
    startCheckpoint: start,
    finalCheckpoint: final,
    driverLog: log,
    model: "iq3_s",
  });
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

test("L7 反例：工具参数引用越出 base_refs ∪ observation_refs", () => {
  const messages = [
    system(),
    appBase('材料：{"ref":"ref_base_1"}'),
    author(),
    scope(),
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "read_chapter", arguments: '{"chapter_ref":"ref_out_of_boundary"}' } }],
    },
    { role: "tool", tool_call_id: "call_1", content: "第01章正文" },
  ];
  const checks = evaluate({ llmRecords: [record(messages)] });
  assert.equal(checks.checks.mechanism.used_context_refs_within_boundary, false);
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
