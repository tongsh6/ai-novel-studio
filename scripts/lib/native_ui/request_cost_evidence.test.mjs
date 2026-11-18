// B87 R01 成本纯投影测试：只验证分类、字节、守恒、来源与 usage 事实，不启动 GUI/模型。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  REQUEST_COST_SCHEMA,
  analyzeRequestCost,
  normalizeUsage,
  sha256Hex,
  stableJson,
  utf8Bytes,
} from "./request_cost_evidence.mjs";

const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const recordOf = ({ messages, tools = [], usage, responseBody = null, model = "local/Q4-PLE4" }) => ({
  provider: "splash",
  turn_id: "turn-1",
  session_id: "session-1",
  provider_call_ref: "pcall-1",
  provider_run_ref: "prun-1",
  request: { body: { model, messages, tools, tool_choice: "auto", stream: true } },
  response: {
    model: "splash",
    usage,
    body: responseBody,
  },
});

const authorBinding = (index, text) => ({ messageIndex: index, text, sha256: sha(text) });

test("独立核验的应用材料不冒充作者，绑定不能跨调用或覆盖额外作者", () => {
  const text = "【应用数据 · application_base · 非作者原话】\n完整引用材料\n";
  const record = recordOf({ messages: [{ role: "user", content: text }] });
  const binding = { messageIndex: 0, text, sha256: sha(text), operation: "transcript_compaction",
    provider_call_ref: "pcall-1", provider_run_ref: "prun-1" };
  const actual = analyzeRequestCost(record, { applicationBinding: binding, purpose: "other" });
  assert.equal(actual.ok, true, actual.reason);
  assert.equal(actual.category_bytes.application_base, Buffer.byteLength(text));
  assert.equal(actual.category_bytes.current_author, 0);
  assert.equal(actual.cross.author_message_count, 0);
  assert.equal(actual.cross.current_author_index, null);
  assert.deepEqual(actual.provenance.trusted_application_messages, [0]);
  for (const field of ["provider_call_ref", "provider_run_ref", "sha256", "text", "operation"]) {
    assert.equal(analyzeRequestCost(record, { applicationBinding: { ...binding, [field]: "incorrect" } }).ok,
      false, field);
  }
  const withAuthor = recordOf({ messages: [{ role: "user", content: text }, { role: "user", content: "真正作者" }] });
  assert.equal(analyzeRequestCost(withAuthor, { applicationBinding: binding }).ok, false);
  assert.equal(analyzeRequestCost(record, { applicationBinding: binding, authorBinding: authorBinding(0, text) }).ok, false);
});

test("wire 消息互斥分类：内容 UTF-8 字节 + JSON 包装开销守恒", () => {
  const tools = [
    {
      type: "function",
      function: {
        name: "read_chapter",
        description: "读取章节",
        parameters: { type: "object", properties: { chapter: { type: "string" } } },
      },
    },
  ];
  const messages = [
    { role: "system", content: "系统提示" },
    { role: "user", content: "【应用数据 · application_base】作品资料" },
    { role: "user", content: "【应用数据 · scope_update】范围：作者甲😀" },
    { role: "user", content: "作者甲😀" },
    {
      role: "assistant",
      content: "上一轮回复",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "read_chapter",
            arguments: JSON.stringify({ chapter: "第01章", quote: '"引号"' }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({
        type: "observation",
        call_id: "call_1",
        status: "ok",
        content: { text: "观察正文" },
      }),
    },
  ];
  const record = recordOf({
    messages,
    tools,
    usage: {
      model: "local/Q4-PLE4",
      input_tokens: 100,
      cached_tokens: 40,
      output_tokens: 5,
      ttft_ms: 10,
      latency_ms: 20,
    },
    responseBody: { source: "sse_decoder", tool_calls: [{ id: "new_call" }] },
  });

  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(3, "作者甲😀") });
  assert.equal(analysis.schema, REQUEST_COST_SCHEMA);
  assert.equal(analysis.ok, true);
  assert.equal(analysis.status, "valid");
  assert.equal(analysis.category_bytes.system, utf8Bytes("系统提示"));
  assert.equal(
    analysis.category_bytes.application_base,
    utf8Bytes("【应用数据 · application_base】作品资料"),
  );
  assert.equal(
    analysis.category_bytes.scope,
    utf8Bytes("【应用数据 · scope_update】范围：作者甲😀"),
  );
  assert.equal(analysis.category_bytes.current_author, utf8Bytes("作者甲😀"));
  assert.equal(analysis.category_bytes.observation, utf8Bytes(messages[5].content));
  assert.equal(analysis.category_bytes.tools, utf8Bytes(stableJson(tools)));
  assert.equal(analysis.category_bytes.unclassified, 0);
  assert.equal(analysis.cross.author_message_count, 1);
  assert.equal(analysis.cross.scope_contains_author_bytes, true);
  assert.equal(analysis.cross.replay_tool_calls, 1);
  assert.equal(analysis.cross.history_assistant_messages, 1);
  assert.equal(analysis.cross.replay_assistant_text_bytes, utf8Bytes("上一轮回复"));
  assert.equal(analysis.response.actual_tool_calls, 1);
  assert.equal(analysis.response.raw_sse_collected, false);
  assert.equal(analysis.response.raw_source_scope, "llm_call_log_only");
  assert.match(analysis.response.raw_sse_note, /不判断批次外部传输原件/u);
  assert.equal(analysis.response.raw_assistant_text_collected, false);

  const categorySum = Object.values(analysis.category_bytes).reduce((sum, value) => sum + value, 0);
  assert.equal(categorySum, analysis.totals.content_utf8_bytes);
  assert.equal(
    analysis.totals.content_utf8_bytes + analysis.totals.envelope_bytes,
    analysis.totals.stable_json_bytes,
  );
  assert.ok(analysis.totals.envelope_bytes >= 0);
  assert.equal(analysis.request.sha256, sha(stableJson(record.request.body)));
  assert.equal(analysis.request.raw_http_bytes, null);
  assert.equal(analysis.usage.input_tokens, 100);
  assert.equal(analysis.usage.cached_tokens, 40);
  assert.equal(analysis.usage.cached_within_input, true);
  assert.equal(analysis.usage.ttft_basis, "app_activity");
  assert.equal(analysis.usage.identity.request_model, "local/Q4-PLE4");
  assert.equal(analysis.usage.identity.response_label, "splash");
});

test("role=tool 按真实 type 拆 observation/validation，未知不伪造观察", () => {
  const validation = recordOf({
    messages: [
      { role: "user", content: "作者" },
      {
        role: "tool",
        tool_call_id: "call-v",
        content: JSON.stringify({
          type: "validation_result",
          call_id: "call-v",
          status: "failed",
          reason_code: "invalid",
        }),
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const validationAnalysis = analyzeRequestCost(validation, {
    authorBinding: authorBinding(0, "作者"),
  });
  assert.equal(validationAnalysis.ok, true);
  assert.ok(validationAnalysis.category_bytes.validation > 0);
  assert.equal(validationAnalysis.category_bytes.observation, 0);

  const unknown = recordOf({
    messages: [
      { role: "user", content: "作者" },
      { role: "tool", tool_call_id: "call-u", content: JSON.stringify({ type: "mystery" }) },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const unknownAnalysis = analyzeRequestCost(unknown, { authorBinding: authorBinding(0, "作者") });
  assert.equal(unknownAnalysis.ok, false);
  assert.ok(unknownAnalysis.category_bytes.tool_unknown > 0);
  assert.equal(unknownAnalysis.category_bytes.observation, 0);
});

test("坏 request 结构走 invalidAnalysis：零分类、not_collected，不伪造", () => {
  const analysis = analyzeRequestCost({
    provider: "splash",
    request: { body: { messages: "not-an-array" } },
    response: { model: "splash", body: null },
  });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.status, "malformed");
  assert.equal(analysis.request.sha256, null);
  assert.equal(analysis.totals.content_utf8_bytes, 0);
  assert.equal(analysis.usage.present, false);
  assert.equal(analysis.provenance.trusted, false);
});

test("未知应用 marker 显式 unclassified，不吞消息", () => {
  const record = recordOf({
    messages: [
      { role: "user", content: "【应用数据 · unknown_payload】不能静默归类" },
      { role: "user", content: "作者输入" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(1, "作者输入") });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.status, "unclassified");
  assert.ok(analysis.category_bytes.unclassified > 0);
  assert.equal(analysis.category_bytes.history, 0);
  assert.match(analysis.reason, /unknown_application_marker|unclassified/);
});

test("作者绑定必须命中独立 user 字节，application 头不能伪造作者", () => {
  const text = "作者原话";
  const record = recordOf({
    messages: [
      { role: "user", content: `【应用数据 · application_base】${text}` },
      { role: "user", content: "另一条作者输入" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(0, text) });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.reason, "author_binding_mismatch");
  assert.equal(analysis.cross.author_message_count, 1);
});

test("缓存是 input 子集：cached>input 显式违规且不相加", () => {
  const usage = normalizeUsage(
    { input_tokens: 10, cached_tokens: 20, output_tokens: 1, ttft_ms: 1, latency_ms: 2 },
    { requestModel: "local/Q4-PLE4" },
  );
  assert.equal(usage.input_tokens, 10);
  assert.equal(usage.cached_tokens, 20);
  assert.equal(usage.cached_within_input, false);
  assert.deepEqual(usage.violations, ["cached_tokens_exceeds_input"]);
  assert.equal(usage.cost_input_tokens, 10);
});

test("负数/非整数 tokens 与负 timing 拒绝为 null，不洗成 0", () => {
  const usage = normalizeUsage(
    { input_tokens: -1, cached_tokens: 1.5, output_tokens: 2, ttft_ms: -1 },
    { requestModel: "local/Q4-PLE4" },
  );
  assert.equal(usage.input_tokens, null);
  assert.equal(usage.cached_tokens, null);
  assert.equal(usage.output_tokens, 2);
  assert.ok(usage.violations.includes("invalid_token_or_timing_fields"));
  assert.deepEqual(usage.invalid_fields.sort(), ["cached_tokens", "input_tokens", "ttft_ms"]);
  assert.equal(usage.ttft_ms, null);
  assert.equal(usage.cost_input_tokens, null);
});

test("Writer purpose 来自真实 record.step/purpose 并只作交叉维度", () => {
  const record = recordOf({
    messages: [
      { role: "user", content: "作者" },
      { role: "assistant", content: "正文" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  record.step = "writer";
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(0, "作者") });
  assert.equal(analysis.cross.purpose, "writer");
  assert.equal(analysis.cross.writer_purpose, true);
  assert.equal(analysis.cross.writer_input_bytes, analysis.totals.content_utf8_bytes);
  assert.equal(
    Object.values(analysis.category_bytes).reduce((sum, value) => sum + value, 0),
    analysis.totals.content_utf8_bytes,
  );
});

test("缺 usage 不填 0，逐字段 not_collected", () => {
  const usage = normalizeUsage(undefined, { requestModel: "local/Q4-PLE4" });
  assert.equal(usage.present, false);
  assert.equal(usage.input_tokens, null);
  assert.equal(usage.cached_tokens, null);
  assert.equal(usage.output_tokens, null);
  assert.equal(usage.ttft_ms, null);
  assert.ok(usage.not_collected.includes("input_tokens"));
  assert.ok(usage.not_collected.includes("cached_tokens"));
  assert.equal(usage.cost_input_tokens, null);
});

test("实际响应 tool_calls 与请求历史回放分开计数", () => {
  const record = recordOf({
    messages: [
      { role: "user", content: "作者" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "replay-1", function: { name: "a", arguments: "{}" } },
          { id: "replay-2", function: { name: "b", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "replay-1", content: "{}" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
    responseBody: { source: "sse_decoder", tool_calls: [{ id: "actual-1" }] },
  });
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(0, "作者") });
  assert.equal(analysis.cross.replay_tool_calls, 2);
  assert.equal(analysis.category_bytes.history, 4, "两个 raw_arguments {} 必须精确相加");
  assert.equal(analysis.response.actual_tool_calls, 1);
  assert.equal(analysis.response.raw_sse_collected, false);
  assert.equal(analysis.response.body_kind, "decoded_object");
});

test("改一个作者字节：绑定失败且请求 hash 改变", () => {
  const body = {
    model: "local/Q4-PLE4",
    messages: [
      { role: "system", content: "系统" },
      { role: "user", content: "作者甲" },
    ],
    tools: [],
  };
  const record = (author) => ({
    provider: "splash",
    request: { body: { ...body, messages: [body.messages[0], { role: "user", content: author }] } },
    response: { usage: { input_tokens: 1, output_tokens: 1 }, body: null },
  });
  const first = analyzeRequestCost(record("作者甲"), { authorBinding: authorBinding(1, "作者甲") });
  const second = analyzeRequestCost(record("作者乙"), { authorBinding: authorBinding(1, "作者甲") });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "author_binding_mismatch");
  assert.notEqual(first.request.sha256, second.request.sha256);
  assert.equal(second.response.body_kind, "absent");
  assert.equal(second.response.raw_sse_collected, false);
});

test("canonical IR 不能冒充已完整计量的 native Chat wire", () => {
  // 现役 IR 的规则在 system envelope，tool message 可含多种结果块；成本入口
  // 没有这类真实消费者，必须明确不支持，不能漏算材料后仍返回 valid。
  const analysis = analyzeRequestCost({
    request_format: "authoring-request-ir/v1",
    request_body: {
      ir_version: "authoring-request-ir/v1",
      system: { instructions: "系统规则" },
      tools: [],
      messages: [
        { role: "user", provenance: "author", blocks: [{ type: "text", text: "作者" }] },
        { role: "tool", provenance: "tool_result", blocks: [
          { type: "observation", call_id: "c1", status: "ok", content: { text: "观察" } },
          { type: "validation_result", call_id: "c2", status: "failed", reason_code: "invalid" },
        ] },
      ],
    },
    response: { usage: { input_tokens: 20, output_tokens: 1 } },
  });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.status, "unsupported");
  assert.equal(analysis.reason, "request_cost_requires_native_chat_wire");
  assert.equal(analysis.request.sha256, null);
  assert.equal(analysis.request.conservation, false);
  assert.equal(analysis.provenance.trusted, false);
  assert.ok(Object.values(analysis.category_bytes).every((bytes) => bytes === 0));
  assert.equal(analysis.usage.input_tokens, 20, "保留日志已观察用量，不伪造分类");
});

test("外部绑定只授信本轮作者，历史同文本仍标 untrusted", () => {
  const record = recordOf({
    messages: [
      { role: "user", content: "重复作者" },
      { role: "assistant", content: "上一轮" },
      { role: "user", content: "重复作者" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(2, "重复作者") });
  assert.equal(analysis.ok, true);
  assert.deepEqual(analysis.provenance.trusted_author_messages, [2]);
  assert.deepEqual(analysis.provenance.untrusted_author_messages, [0]);
});

test("无外部绑定的原生 wire 不静默授信", () => {
  const record = recordOf({
    messages: [
      { role: "system", content: "系统" },
      { role: "user", content: "作者" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const analysis = analyzeRequestCost(record);
  assert.equal(analysis.ok, false);
  assert.equal(analysis.status, "unverified");
  assert.equal(analysis.provenance.untrusted_author_messages.length, 1);
});

test("原生 content 数组里的未知材料块不得被吞进 envelope 后仍判 valid", () => {
  // leader-cost-review.json case `unknown_native_material`：content 数组中的未知块既不是
  // text 也不是已识别的可计量类型，必须显式进入 unclassified 并使分析失败；不能只算 text
  // 后把未知字节留给 stable_json - categories 的 envelope。
  const unknownPart = { type: "unrecognized_material", data: "不能藏入结构开销的材料" };
  const record = {
    provider: "splash",
    turn_id: "turn-1",
    session_id: "session-1",
    provider_call_ref: "pcall-1",
    provider_run_ref: "prun-1",
    request: {
      body: {
        model: "fixture-model",
        messages: [
          { role: "system", content: "规则" },
          { role: "user", content: "当前有几章内容" },
          { role: "assistant", content: [{ type: "text", text: "已知文本" }, unknownPart] },
        ],
        tools: [],
      },
    },
    response: {
      usage: { input_tokens: 10, output_tokens: 1, cached_tokens: 0 },
      body: { source: "sse_decoder", tool_calls: [] },
    },
  };
  const analysis = analyzeRequestCost(record, {
    authorBinding: authorBinding(1, "当前有几章内容"),
  });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.status, "unclassified");
  assert.equal(analysis.reason, "unclassified_messages");
  assert.ok(analysis.category_bytes.unclassified > 0, "未知材料字节必须显式归类");
  assert.ok(analysis.cross.unclassified_messages >= 1);
  assert.ok(
    analysis.totals.content_utf8_bytes >= utf8Bytes(stableJson(unknownPart)),
    "未知材料必须计入内容字节",
  );
  assert.equal(analysis.request.conservation, true);
});

test("原生 wire 的 null 消息不崩溃，也不被当成有效材料", () => {
  const record = {
    provider: "splash",
    turn_id: "turn-1",
    session_id: "session-1",
    provider_call_ref: "pcall-1",
    provider_run_ref: "prun-1",
    request: {
      body: {
        model: "fixture-model",
        messages: [
          null,
          { role: "system", content: "规则" },
          { role: "user", content: "当前有几章内容" },
        ],
      },
    },
    response: { usage: { input_tokens: 10, output_tokens: 1, cached_tokens: 0 } },
  };
  const analysis = analyzeRequestCost(record, {
    authorBinding: authorBinding(2, "当前有几章内容"),
  });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.status, "unclassified");
  assert.ok(analysis.cross.unclassified_messages >= 1);
});

test("请求体没有 tools 字段时 tools 字节为 0，不把缺省空数组算成 2 字节", () => {
  // leader-cost-review.json case `absent_tools`：tools 字段完全不存在，不能按 `[]` 的
  // JSON 字节计 2；字段存在且为空数组时才是真实 wire 内容。
  const body = {
    model: "fixture-model",
    messages: [
      { role: "system", content: "规则" },
      { role: "user", content: "当前有几章内容" },
    ],
  };
  assert.equal(Object.hasOwn(body, "tools"), false);
  const record = {
    provider: "splash",
    turn_id: "turn-1",
    session_id: "session-1",
    provider_call_ref: "pcall-1",
    provider_run_ref: "prun-1",
    request: { body },
    response: {
      usage: { input_tokens: 10, output_tokens: 1, cached_tokens: 0 },
      body: { source: "sse_decoder", tool_calls: [] },
    },
  };
  const analysis = analyzeRequestCost(record, {
    authorBinding: authorBinding(1, "当前有几章内容"),
  });
  assert.equal(analysis.ok, true);
  assert.equal(analysis.category_bytes.tools, 0);
  assert.equal(analysis.cross.tools_field_present, false);
  assert.equal(analysis.evidence_layers.raw_sse, "not_collected");
  assert.equal(analysis.evidence_layers.raw_http_bytes, "not_collected");
  assert.equal(analysis.evidence_layers.usage, "app_reported_response_usage");
  assert.equal(analysis.evidence_layers.ttft, "not_collected");

  const present = analyzeRequestCost(
    {
      ...record,
      request: { body: { ...body, tools: [] } },
    },
    { authorBinding: authorBinding(1, "当前有几章内容") },
  );
  assert.equal(present.ok, true);
  assert.equal(present.category_bytes.tools, 2);
  assert.equal(present.cross.tools_field_present, true);
});

test("响应缺失/未解码/无工具字段是未知；明确 tool_calls:[] 才是 0", () => {
  const text = "当前有几章内容";
  const analyze = (responseBody, omitBody = false) =>
    analyzeRequestCost(
      {
        provider: "splash",
        request: {
          body: { model: "splash", messages: [{ role: "user", content: text }], tools: [] },
        },
        response: {
          model: "splash",
          usage: { input_tokens: 1, output_tokens: 1 },
          ...(omitBody ? {} : { body: responseBody }),
        },
      },
      { authorBinding: authorBinding(0, text) },
    );

  const missing = analyze(null, true);
  assert.equal(missing.response.body_kind, "absent");
  assert.equal(missing.response.actual_tool_calls, null);
  assert.equal(missing.response.actual_tool_calls_observed, false);

  const undecoded = analyze("event_stream");
  assert.equal(undecoded.response.actual_tool_calls, null);
  assert.equal(undecoded.response.actual_tool_calls_observed, false);

  const unavailableField = analyze({ source: "sse_decoder" });
  assert.equal(unavailableField.response.actual_tool_calls, null);
  assert.equal(unavailableField.response.actual_tool_calls_observed, false);

  const empty = analyze({ source: "sse_decoder", tool_calls: [] });
  assert.equal(empty.response.actual_tool_calls, 0);
  assert.equal(empty.response.actual_tool_calls_observed, true);
  assert.equal(empty.response.actual_tool_calls_basis, "decoded_log_observation");

  const nonEmpty = analyze({ source: "sse_decoder", tool_calls: [{ id: "c1" }] });
  assert.equal(nonEmpty.response.actual_tool_calls, 1);
  assert.equal(nonEmpty.response.actual_tool_calls_observed, true);

  const choiceEmpty = analyze({ choices: [{ message: { tool_calls: [] } }] });
  assert.equal(choiceEmpty.response.actual_tool_calls, 0);
  assert.equal(choiceEmpty.response.actual_tool_calls_observed, true);

  const choiceMissing = analyze({ choices: [{ message: {} }] });
  assert.equal(choiceMissing.response.actual_tool_calls, null);
  assert.equal(choiceMissing.response.actual_tool_calls_observed, false);
});

// ---- 公共契约反例：非法/缺证/未知字段必须是显式事实，不靠默认值猜 ----
test("非法记录返回完整零投影，不伪造字节、作者或授信", () => {
  for (const record of [
    null,
    {},
    { request: { body: { messages: "not-an-array" } } },
  ]) {
    const analysis = analyzeRequestCost(record);
    assert.equal(analysis.ok, false);
    assert.deepEqual(analysis.request, {
      sha256: null,
      stable_json_bytes: 0,
      content_utf8_bytes: 0,
      envelope_bytes: 0,
      raw_http_bytes: null,
      conservation: false,
    });
    assert.deepEqual(analysis.totals, {
      content_utf8_bytes: 0,
      stable_json_bytes: 0,
      envelope_bytes: 0,
      category_sum_bytes: 0,
    });
    assert.deepEqual(analysis.category_bytes, {
      system: 0,
      tools: 0,
      application_base: 0,
      scope: 0,
      history: 0,
      observation: 0,
      validation: 0,
      tool_unknown: 0,
      current_author: 0,
      application_other: 0,
      unclassified: 0,
    });
    assert.deepEqual(analysis.cross, {
      author_message_count: 0,
      current_author_index: null,
      history_message_count: 0,
      scope_block_count: 0,
      observation_message_count: 0,
      replay_tool_calls: 0,
      scope_contains_author_bytes: false,
      unclassified_messages: 0,
      malformed_calls: 0,
      malformed_tool_messages: 0,
      writer_purpose: false,
      writer_input_bytes: null,
    });
    assert.equal(analysis.provenance.trusted, false);
    assert.equal(analysis.usage.present, false);
    assert.equal(analysis.response.body_kind, "absent");
    assert.equal(analysis.response.actual_tool_calls, null);
  }
});

test("未知 request_format 保留原始字符串，不把空串洗成 null", () => {
  const analysis = analyzeRequestCost({ request_format: "" });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.format, "");
  assert.equal(analysis.evidence_layers.request_format, "");
  assert.equal(analysis.provenance.basis, "");
});

test("usage 零值/缺失/模型身份边界：0 合法，未知保持未知", () => {
  const zero = normalizeUsage(
    { model: "m", input_tokens: 0, cached_tokens: 0, output_tokens: 0, ttft_ms: 0, latency_ms: 0 },
    { requestModel: "m", responseLabel: "resp" },
  );
  assert.equal(zero.present, true);
  assert.deepEqual(zero.invalid_fields, []);
  assert.deepEqual(zero.violations, []);
  assert.equal(zero.cached_within_input, true);
  assert.equal(zero.identity.usage_model, "m");
  assert.equal(zero.identity.model_matches_request, true);
  assert.equal(zero.ttft_basis, "app_activity");

  const unknownInput = normalizeUsage({ cached_tokens: 5, output_tokens: 1 }, { requestModel: "m" });
  assert.equal(unknownInput.input_tokens, null);
  assert.equal(unknownInput.cached_within_input, null);
  assert.deepEqual(unknownInput.violations, []);
  assert.equal(unknownInput.identity.model_matches_request, null);

  const allMissing = normalizeUsage({}, { requestModel: "m" });
  assert.equal(allMissing.present, false);
  assert.deepEqual(allMissing.not_collected.sort(), [
    "cached_tokens",
    "input_tokens",
    "latency_ms",
    "output_tokens",
    "ttft_ms",
  ]);

  const equal = normalizeUsage({ input_tokens: 10, cached_tokens: 10, output_tokens: 1 });
  assert.equal(equal.cached_within_input, true);
  assert.deepEqual(equal.violations, []);
});

test("字节/hash 辅助函数把 0/false 当真实值而非空", () => {
  assert.equal(utf8Bytes(0), 1);
  assert.equal(utf8Bytes(false), 5);
  assert.equal(utf8Bytes(null), 0);
  assert.equal(sha256Hex(0), sha("0"));
  assert.equal(sha256Hex(null), sha(""));
});

test("坏 tool exchange 显式 unsupported，不混成 unclassified/守恒失败", () => {
  const badCalls = recordOf({
    messages: [
      { role: "user", content: "作者" },
      { role: "assistant", content: "", tool_calls: "not-an-array" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const callsAnalysis = analyzeRequestCost(badCalls, { authorBinding: authorBinding(0, "作者") });
  assert.equal(callsAnalysis.ok, false);
  assert.equal(callsAnalysis.status, "unsupported");
  assert.equal(callsAnalysis.reason, "malformed_tool_exchange");
  assert.equal(callsAnalysis.cross.malformed_calls, 1);
  assert.equal(callsAnalysis.cross.unclassified_messages, 0);
  assert.equal(callsAnalysis.request.conservation, true);

  const badTool = recordOf({
    messages: [
      { role: "user", content: "作者" },
      { role: "tool", tool_call_id: "c1", content: "not-json" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const toolAnalysis = analyzeRequestCost(badTool, { authorBinding: authorBinding(0, "作者") });
  assert.equal(toolAnalysis.ok, false);
  assert.equal(toolAnalysis.status, "unclassified");
  assert.equal(toolAnalysis.reason, "unclassified_messages");
  assert.equal(toolAnalysis.cross.malformed_tool_messages, 1);
  assert.ok(toolAnalysis.category_bytes.tool_unknown > 0);
});

test("原生 content part：字符串/text 已知，未知块精确计字节且不被吞", () => {
  const unknown = { type: "audio", data: "x" };
  const textPart = { type: "text", text: "正文" };
  const badText = { type: "text", text: 7 };
  const body = {
    model: "m",
    messages: [
      { role: "user", content: "作者" },
      { role: "assistant", content: ["纯字符串", textPart, unknown, badText] },
    ],
    tools: [],
  };
  const analysis = analyzeRequestCost(
    { request: { body }, response: { usage: { input_tokens: 1, output_tokens: 1 } } },
    { authorBinding: authorBinding(0, "作者") },
  );
  assert.equal(analysis.status, "unclassified");
  assert.equal(
    analysis.category_bytes.unclassified,
    utf8Bytes(stableJson(unknown)) + utf8Bytes(stableJson(badText)),
  );
  assert.equal(analysis.cross.unclassified_messages, 1);
  assert.equal(analysis.request.conservation, true);
});

test("作者原话出现次数只认独立 user；空文本/应用头/assistant 不冒充作者", () => {
  const text = "重复作者";
  const record = recordOf({
    messages: [
      { role: "user", content: `【应用数据 · scope_update】${text}` },
      { role: "user", content: text },
      { role: "assistant", content: text },
      { role: "user", content: text },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(3, text) });
  assert.equal(analysis.cross.author_text_occurrences, 2);
  assert.equal(analysis.cross.scope_contains_author_bytes, true);

  const assistantBinding = analyzeRequestCost(record, { authorBinding: authorBinding(2, text) });
  assert.equal(assistantBinding.reason, "author_binding_mismatch");

  const emptyText = recordOf({
    messages: [
      { role: "user", content: "【应用数据 · scope_update】范围" },
      { role: "user", content: "" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const empty = analyzeRequestCost(emptyText, { authorBinding: authorBinding(1, "") });
  assert.equal(empty.cross.author_text_occurrences, 0);
  assert.equal(empty.cross.scope_contains_author_bytes, false);
  assert.equal(empty.category_bytes.current_author, 0);
});

test("作者绑定越界/哈希不符 fail closed，不崩溃", () => {
  const record = recordOf({
    messages: [{ role: "user", content: "作者" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const outOfRange = analyzeRequestCost(record, {
    authorBinding: { messageIndex: 9, text: "作者", sha256: sha("作者") },
  });
  assert.equal(outOfRange.reason, "author_binding_mismatch");
  const badSha = analyzeRequestCost(record, {
    authorBinding: { messageIndex: 0, text: "作者", sha256: sha("别的") },
  });
  assert.equal(badSha.reason, "author_binding_mismatch");
});

test("purpose 从真实 step 派生，空白命中回退且不保留虚构别名", () => {
  const record = recordOf({
    messages: [{ role: "user", content: "作者" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  record.step = "judgment";
  const blank = analyzeRequestCost(record, {
    authorBinding: authorBinding(0, "作者"),
    purpose: "   ",
  });
  assert.equal(blank.cross.purpose, "judgment");
  assert.equal(blank.cross.writer_purpose, false);
  const writer = analyzeRequestCost(record, {
    authorBinding: authorBinding(0, "作者"),
    purpose: "writer",
  });
  assert.equal(writer.cross.purpose, "writer");
  assert.equal(writer.cross.writer_purpose, true);
  assert.equal(writer.cross.writer_input_bytes, writer.totals.content_utf8_bytes);
});

test("响应模型标签保留空字符串，未知 usage model 不伪造匹配", () => {
  const record = recordOf({
    messages: [{ role: "user", content: "作者" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  record.response.model = "";
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(0, "作者") });
  assert.equal(analysis.response.response_model_label, "");
  assert.equal(analysis.usage.identity.response_label, "");
  assert.equal(analysis.usage.identity.usage_model, null);
  assert.equal(analysis.usage.identity.model_matches_request, null);
});

test("缺省 tool arguments/空 tool content 不崩溃且不计假字节", () => {
  const noArguments = recordOf({
    messages: [
      { role: "user", content: "作者" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "noop" } }] },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const noArgs = analyzeRequestCost(noArguments, { authorBinding: authorBinding(0, "作者") });
  assert.equal(noArgs.ok, true);
  assert.equal(noArgs.category_bytes.history, 0);
  assert.equal(noArgs.cross.replay_tool_calls, 1);

  const emptyTool = recordOf({
    messages: [
      { role: "user", content: "作者" },
      { role: "tool", tool_call_id: "c1", content: "" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const empty = analyzeRequestCost(emptyTool, { authorBinding: authorBinding(0, "作者") });
  assert.equal(empty.ok, false);
  assert.equal(empty.cross.malformed_tool_messages, 1);
  assert.equal(empty.category_bytes.observation, 0);
});

test("wire 应用通知/检查点 marker 归 application_other，不静默 unclassified", () => {
  const record = recordOf({
    messages: [
      { role: "user", content: "作者" },
      { role: "user", content: "【应用数据 · application_notice】通知" },
      { role: "user", content: "【应用数据 · checkpoint】检查点" },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(0, "作者") });
  assert.equal(analysis.ok, true);
  assert.ok(analysis.category_bytes.application_other > 0);
  assert.equal(analysis.category_bytes.unclassified, 0);
});

test("usage 非数值 token 保持未知，不把字符串当成本", () => {
  const record = recordOf({
    messages: [{ role: "user", content: "作者" }],
    usage: { input_tokens: "10", output_tokens: 1 },
  });
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(0, "作者") });
  assert.equal(analysis.usage.input_tokens, null);
  assert.ok(analysis.usage.not_collected.includes("input_tokens"));
});

test("响应缺少 choices/message 时 tool_calls 未知且不崩溃", () => {
  const text = "作者";
  const analyze = (body) =>
    analyzeRequestCost(
      {
        request: { body: { model: "m", messages: [{ role: "user", content: text }], tools: [] } },
        response: { usage: { input_tokens: 1 }, body },
      },
      { authorBinding: authorBinding(0, text) },
    );
  for (const body of [{ source: "sse_decoder" }, { source: "sse_decoder", choices: [{}] }]) {
    const analysis = analyze(body);
    assert.equal(analysis.response.actual_tool_calls, null);
    assert.equal(analysis.response.actual_tool_calls_observed, false);
  }
});

test("未绑定 wire 的作者位置只作观察；最后一条/无作者仍不授信", () => {
  const analysis = analyzeRequestCost(recordOf({
    messages: [
      { role: "user", content: "第一句" },
      { role: "assistant", content: "回复" },
      { role: "user", content: "第二句" },
    ],
    usage: { input_tokens: 1 },
  }));
  assert.equal(analysis.ok, false);
  assert.equal(analysis.status, "unverified");
  assert.equal(analysis.cross.current_author_index, 2);
  assert.equal(analysis.category_bytes.current_author, utf8Bytes("第二句"));
  assert.equal(analysis.category_bytes.history, utf8Bytes("第一句") + utf8Bytes("回复"));

  const noAuthor = analyzeRequestCost(recordOf({
    messages: [{ role: "system", content: "系统" }],
    usage: { input_tokens: 1 },
  }));
  assert.equal(noAuthor.ok, false);
  assert.equal(noAuthor.cross.current_author_index, null);
  assert.equal(noAuthor.category_bytes.current_author, 0);
});

test("已知 wire 消息不增加 unclassified 计数；未知角色恰计一次", () => {
  const known = analyzeRequestCost(recordOf({
    messages: [
      { role: "system", content: "系统" },
      { role: "user", content: "作者" },
    ],
    usage: { input_tokens: 1 },
  }), { authorBinding: authorBinding(1, "作者") });
  assert.equal(known.ok, true);
  assert.equal(known.cross.unclassified_messages, 0);

  const unknown = analyzeRequestCost(recordOf({
    messages: [
      { role: "user", content: "作者" },
      { role: "mystery", content: "未知角色" },
    ],
    usage: { input_tokens: 1 },
  }), { authorBinding: authorBinding(0, "作者") });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.cross.unclassified_messages, 1);
});

test("记录完全缺 response 时 usage 记为未采集，不崩溃", () => {
  const record = {
    request: { body: { model: "m", messages: [{ role: "user", content: "作者" }], tools: [] } },
  };
  const analysis = analyzeRequestCost(record, { authorBinding: authorBinding(0, "作者") });
  assert.equal(analysis.usage.present, false);
  assert.equal(analysis.response.body_kind, "absent");
});
