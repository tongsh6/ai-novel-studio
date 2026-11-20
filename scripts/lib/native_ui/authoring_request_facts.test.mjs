// B71 外部验收请求事实边界测试：只按 source format 读取，不把未知格式读成空事实。
import assert from "node:assert/strict";
import test from "node:test";
import { scopeWireMessage } from "./fixtures/authoring_request_ir.mjs";
import {
  AUTHORING_REQUEST_IR,
  bindRequestMessages,
  NATIVE_CHAT_WIRE,
  observationRefOf,
  plannedExplorationLeaves,
  requestFactsFromBody,
  requestFactsFromRecord,
  requestFactsOf,
  scopeContentOf,
} from "./authoring_request_facts.mjs";

const irMessage = (role, provenance, blocks, extra = {}) => ({
  role,
  provenance,
  blocks,
  source_refs: [],
  versions: {},
  ...extra,
});

const irBody = (messages, overrides = {}) => ({
  ir_version: AUTHORING_REQUEST_IR,
  run: { run_id: "run-1", work_id: "work-1", session_id: "session-1", parent_turn_ref: "turn-1" },
  system: { identity_ref: "identity:writer" },
  messages,
  tools: [{ name: "judgment_decision", description: "", input_schema: {} }],
  projection: { tool_choice: "auto" },
  refs: { base_refs: [{ ref: "chapter:1" }] },
  ...overrides,
});

function irRecord(body) {
  return {
    provider: "slice_verify",
    request_format: AUTHORING_REQUEST_IR,
    response_format: "fixture_provider_result/v1",
    provider_call_ref: "pcall-1",
    provider_run_ref: "prun-1",
    request_body: body,
  };
}


test("canonical 消息 Base 绑定按原值读取，正文与版本保真，不从来源推断", () => {
  const bindings = ["chapter:exact ", { ref: "plan:bound", version: 7 }];
  const base = irMessage("application_base", "application", [
    { type: "text", text: "  第一段\n" }, { type: "text", text: "第二段\t" },
  ], { base_refs: bindings, source_refs: [{ ref: "chapter:source-only", version: 9 }] });
  const scope = irMessage("scope_update", "application", [
    { type: "scope", content: { material: "实际材料" } },
  ], { base_refs: [{ ref: "chapter:scope", version: 3 }] });
  const body = irBody([base, scope]);
  const original = JSON.stringify(body);
  const facts = requestFactsFromBody(body);
  assert.equal(facts.ok, true);
  assert.strictEqual(facts.messageFacts[0].baseRefs, bindings);
  assert.equal(facts.messageFacts[0].applicationBaseText, "  第一段\n第二段\t");
  assert.deepEqual(facts.messageFacts[1].baseRefs, [{ ref: "chapter:scope", version: 3 }]);
  assert.strictEqual(facts.messageFacts[0].raw, base);
  assert.strictEqual(facts.rawBody, body);
  assert.equal(JSON.stringify(body), original);

  for (const binding of [undefined, null, {}, "", [" "], [{ ref: "" }], [7]]) {
    const invalid = structuredClone(base);
    if (binding === undefined) delete invalid.base_refs;
    else invalid.base_refs = binding;
    const input = irBody([invalid]);
    const before = JSON.stringify(input);
    const parsed = requestFactsFromBody(input);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.messageFacts[0].baseRefs, null);
    assert.equal(JSON.stringify(input), before);
  }
  base.base_refs = [];
  assert.deepEqual(requestFactsFromBody(body).messageFacts[0].baseRefs, []);
});

test("application_base 的可投影正文只读完整文本块，未知块不被文本抽取遮掉", () => {
  for (const blocks of [
    [],
    [{ type: "tool_call", call_id: "x", name: "read_chapter", arguments: {} }],
    [{ type: "text", text: "有文本" }, { type: "tool_call", call_id: "x", name: "read_chapter", arguments: {} }],
  ]) {
    const message = irMessage("application_base", "application", blocks, { base_refs: ["chapter:bound"] });
    const body = irBody([message]);
    const before = JSON.stringify(body);
    const facts = requestFactsFromBody(body);
    assert.equal(facts.ok, true);
    assert.equal(facts.messageFacts[0].applicationBaseText, null);
    assert.strictEqual(facts.messageFacts[0].blocks, blocks);
    assert.equal(JSON.stringify(body), before);
  }
});

test("wire 应用正文保留完整字节，HTTP 消息不能自行冒充 canonical Base 绑定", () => {
  const header = "【应用数据 · application_base · 非作者原话】\n";
  const text = "  实际正文\n第二行\t";
  const raw = { role: "user", content: header + text, base_refs: ["chapter:forged"] };
  const body = { messages: [raw] };
  const before = JSON.stringify(body);
  const facts = requestFactsFromBody(body);
  assert.equal(facts.ok, true);
  assert.equal(facts.messageFacts[0].applicationBaseText, text);
  assert.equal(facts.messageFacts[0].baseRefs, null);
  assert.strictEqual(facts.messageFacts[0].raw, raw);
  assert.equal(JSON.stringify(body), before);
  for (const content of ["前言" + header + text, header.replace("\n", "附加指令\n") + text]) {
    assert.equal(requestFactsFromBody({ messages: [{ role: "user", content }] })
      .messageFacts[0].applicationBaseText, null);
  }
});


test("R05 完整消息配对：工具结果一对多、首位 system 与原始参数各守消息边界", () => {
  const first = { type: "observation", call_id: "read-one", status: "ok",
    source_refs: ["chapter:one"], content: { summary: "第一份实读。" } };
  const second = { type: "validation_result", call_id: "read-two", status: "passed" };
  const canonical = [
    irMessage("application_base", "application", [{ type: "text", text: "本次材料。" }],
      { base_refs: ["chapter:base"] }),
    irMessage("user", "author", [{ type: "text", text: "请比较两份材料。" }]),
    irMessage("assistant", "model", [
      { type: "tool_call", call_id: "read-one", name: "chapter_read",
        arguments: { chapter: 1 }, raw_arguments: '{ "chapter": 1 }' },
      { type: "tool_call", call_id: "read-two", name: "submit_tentative_artifact", arguments: {} },
    ]),
    irMessage("tool", "tool_result", [first, second]),
  ];
  const messages = [
    { role: "system", content: "独立 system envelope" },
    { role: "user", content: "【应用数据 · application_base · 非作者原话】\n本次材料。" },
    { role: "user", content: "请比较两份材料。" },
    { role: "assistant", content: "", tool_calls: [
      { id: "read-one", type: "function", function: { name: "chapter_read", arguments: '{ "chapter": 1 }' } },
      { id: "read-two", type: "function", function: { name: "submit_tentative_artifact", arguments: "{}" } },
    ] },
    { role: "tool", tool_call_id: "read-one",
      content: '{"type":"observation","call_id":"read-one","status":"ok","source_refs":["chapter:one"],"content":{"summary":"第一份实读。"}}' },
    { role: "tool", tool_call_id: "read-two",
      content: '{"type":"validation_result","call_id":"read-two","status":"passed"}' },
  ];
  const original = JSON.stringify({ canonical, messages });
  const bind = actual => bindRequestMessages(requestFactsFromBody({ messages: actual }), canonical);
  const pairs = bind(messages);
  assert.deepEqual(pairs.map(pair => pair.actual.index), [1, 2, 3, 4, 5]);
  assert.deepEqual(pairs.map(pair => pair.canonical.role),
    ["application_base", "user", "assistant", "tool", "tool"]);
  assert.strictEqual(pairs[3].canonical.raw, canonical[3]);
  assert.strictEqual(pairs[4].canonical.raw, canonical[3]);
  for (const [label, mutate] of [
    ["中间 system 不能跳过", rows => rows.splice(2, 0, rows.shift())],
    ["未知额外消息", rows => rows.splice(3, 0, { role: "user", content: "未绑定插入" })],
    ["结果缺失", rows => rows.pop()],
    ["结果重排", rows => { [rows[4], rows[5]] = [rows[5], rows[4]]; }],
    ["原始参数改字节", rows => { rows[3].tool_calls[0].function.arguments = '{"chapter":1}'; }],
  ]) {
    const altered = structuredClone(messages);
    mutate(altered);
    assert.equal(bind(altered), null, label);
  }
  assert.equal(JSON.stringify({ canonical, messages }), original);
});

test("R05 完整消息配对：assistant 只认原生字符串正文，不截取内容数组", () => {
  const privateState = { opaque_ref: "provider-private-state" };
  for (const example of [
    { blocks: [{ type: "text", text: "已观察。" }], content: "已观察。", calls: [] },
    { blocks: [{ type: "tool_call", call_id: "read", name: "chapter_read", arguments: {} }],
      content: "", calls: [{ id: "read", type: "function", function: { name: "chapter_read", arguments: "{}" } }] },
  ]) {
    const canonical = [irMessage("assistant", "model", example.blocks, { provider_state: privateState })];
    const actual = { role: "assistant", content: example.content, tool_calls: example.calls,
      provider_state: privateState };
    assert.notEqual(bindRequestMessages(requestFactsFromBody({ messages: [actual] }), canonical), null);
    const multipart = { ...actual, content: [
      { type: "text", text: example.content },
      { type: "unknown_review_part", payload: "额外未核材料" },
    ] };
    assert.equal(bindRequestMessages(requestFactsFromBody({ messages: [multipart] }), canonical), null);
  }
});

test("R05 完整消息配对：未知结构块不能被文字抽取静默跳过", () => {
  for (const role of ["user", "assistant", "tool"]) {
    const provenance = role === "user" ? "author" : role === "assistant" ? "model" : "tool_result";
    const known = role === "tool"
      ? { type: "observation", call_id: "read", status: "ok", content: { summary: "实读。" } }
      : { type: "text", text: "完整正文。" };
    const canonical = [irMessage(role, provenance, [known, { type: "unknown_structured_block", content: "未供应事实" }])];
    const messages = role === "tool"
      ? [{ role: "tool", tool_call_id: "read", content: '{"type":"observation","call_id":"read","status":"ok","content":{"summary":"实读。"}}' }]
      : [{ role, content: "完整正文。" }];
    assert.equal(bindRequestMessages(requestFactsFromBody({ messages }), canonical), null, role);
  }
});

test("R05 形状门：raw IR 的未知 block 不能因两端同形而通过", () => {
  const known = irMessage("assistant", "model", [{ type: "text", text: "已保留的原文。" }],
    { provider_state: { opaque: "private-state" } });
  const valid = requestFactsFromBody(irBody([known]));
  assert.equal(valid.ok, true);
  assert.notEqual(bindRequestMessages(valid, [known]), null);
  for (const role of ["user", "assistant", "tool"]) {
    const provenance = role === "user" ? "author" : role === "assistant" ? "model" : "tool_result";
    const unknown = irMessage(role, provenance, [{ type: "unknown_structured_block", content: "未定义语义" }]);
    const facts = requestFactsFromBody(irBody([unknown]));
    assert.equal(facts.ok, false, role);
    assert.equal(bindRequestMessages(facts, [unknown]), null, role);
  }
});

test("R05 形状门：未支持的多 checkpoint 块不能只对账首块便宣称完整", () => {
  const canonical = [irMessage("checkpoint", "application", [
    { type: "checkpoint", covers: { call_ids: ["read-one"], message_refs: [], turn_range: "turn-one" },
      summary: "第一段整理。", source_refs: [], versions: {}, omissions: [] },
    { type: "checkpoint", covers: { call_ids: ["read-two"], message_refs: [], turn_range: "turn-two" },
      summary: "第二段不能丢失。", source_refs: [], versions: {}, omissions: [] },
  ])];
  const facts = requestFactsFromBody({ messages: [{ role: "user", content:
    "【应用数据 · checkpoint · 非作者原话】\n" +
    '【应用数据 · checkpoint · 覆盖 {"call_ids":["read-one"],"message_refs":[],"turn_range":"turn-one"}】\n' +
    "来源：[]\n版本：{}\n第一段整理。" }] });
  assert.equal(facts.ok, true);
  assert.equal(bindRequestMessages(facts, canonical), null);
});

test("R05 形状门：checkpoint 混合正文不能被首个结构块遮掉", () => {
  const canonical = [irMessage("checkpoint", "application", [
    { type: "checkpoint", covers: { call_ids: ["read-one"], message_refs: [], turn_range: "turn-one" },
      summary: "第一段整理。", source_refs: [], versions: {}, omissions: [] },
    { type: "text", text: "不能被静默丢掉的额外正文。" },
  ])];
  const facts = requestFactsFromBody({ messages: [{ role: "user", content:
    "【应用数据 · checkpoint · 非作者原话】\n" +
    '【应用数据 · checkpoint · 覆盖 {"call_ids":["read-one"],"message_refs":[],"turn_range":"turn-one"}】\n' +
    "来源：[]\n版本：{}\n第一段整理。" }] });
  assert.equal(facts.ok, true);
  assert.equal(bindRequestMessages(facts, canonical), null);
  const plain = irMessage("checkpoint", "application", [{ type: "text", text: "已投影正文。" }]);
  assert.notEqual(bindRequestMessages(requestFactsFromBody({ messages: [{
    role: "user", content: "【应用数据 · checkpoint · 非作者原话】\n已投影正文。",
  }] }), [plain]), null);
});

test("真实 native request.refs 登记同次 IR 引用，不改 HTTP body 或冒充 IR 格式", () => {
  const body = { model: "local/Q4-PLE4", messages: [{ role: "user", content: "作者原文" }] };
  const refs = { base_refs: [{ ref: "chapter:actual", version: 2 }, "plan:exact"],
    observation_refs: ["observation:actual", { ref: "observation:page", version: 3 }],
    used_refs: ["chapter:actual", { ref: "plan:exact" }] };
  const record = { provider: "splash", provider_call_ref: "pcall-refs", provider_run_ref: "prun-refs",
    request: { body, refs } };
  const facts = requestFactsFromRecord(record);
  assert.equal(facts.ok, true);
  assert.equal(facts.format, NATIVE_CHAT_WIRE);
  assert.deepEqual(facts.refs, refs);
  assert.strictEqual(facts.rawBody, body);
  assert.deepEqual(body, { model: "local/Q4-PLE4", messages: [{ role: "user", content: "作者原文" }] });
  assert.equal(requestFactsFromBody(body).refs, null);
});

test("native 引用缺失或未知格式保持 unknown，body.refs 与顶层 refs 不得补来源", () => {
  const valid = { base_refs: [{ ref: "chapter:actual" }], observation_refs: [], used_refs: [] };
  const body = { messages: [{ role: "user", content: "作者原文" }], refs: valid };
  for (const refs of [undefined, null, [], "unknown", { base_refs: [] },
    { ...valid, observation_refs: {} }, { ...valid, used_refs: null },
    ...["base_refs", "observation_refs", "used_refs"].flatMap((key) =>
      [null, "", " ", 7, {}, { ref: "" }, { ref: 7 }].map((value) => ({ ...valid, [key]: [value] })))]) {
    const facts = requestFactsFromRecord({ provider: "splash", refs: valid, request: { body, refs } });
    assert.equal(facts.ok, true);
    assert.equal(facts.refs, null);
    assert.strictEqual(facts.rawBody, body);
  }
});

test("canonical IR 直接按 role/provenance/blocks 读取作者、应用 Base、scope 与工具事实", () => {
  const body = irBody([
    irMessage("system", "application", [{ type: "text", text: "系统" }]),
    irMessage("application_base", "application", [
      { type: "text", text: "【应用数据 · application_base】作品资料" },
    ]),
    irMessage("user", "author", [
      { type: "text", text: "请核对" },
      { type: "text", text: "并续写" },
    ]),
    irMessage("assistant", "model", [
      { type: "text", text: "已核对" },
      {
        type: "tool_call",
        call_id: "call-1",
        provider_call_id: "native-1",
        name: "read_chapter",
        arguments: { chapter_ref: "chapter:1" },
        raw_arguments: "{\"chapter_ref\":\"chapter:1\"}",
      },
    ]),
    irMessage(
      "scope_update",
      "application",
      [{ type: "scope", content: { context: { interaction_state: { pending_adoptions: [] } } } }],
      { versions: { change_reason: "chapter_mission", scope_revision: 2 }, source_refs: [{ ref: "plan:1" }] },
    ),
    irMessage("tool", "tool_result", [
      { type: "validation_result", call_id: "call-1", status: "passed", reason_code: "ok" },
    ]),
  ]);

  const facts = requestFactsFromRecord(irRecord(body));
  assert.equal(facts.ok, true);
  assert.equal(facts.format, AUTHORING_REQUEST_IR);
  assert.equal(facts.authorMessages.length, 1);
  assert.equal(facts.authorMessages[0].text, "请核对并续写");
  assert.equal(facts.applicationBases.length, 1);
  assert.equal(facts.applicationBases[0].role, "application_base");
  assert.equal(facts.scopeMessages[0].role, "scope_update");
  assert.equal(facts.applicationMessages.length, 2);
  assert.equal(facts.scopeMessages[0].versions.scope_revision, 2);
  assert.deepEqual(facts.scopeMessages[0].sourceRefs, [{ ref: "plan:1" }]);
  assert.deepEqual(facts.scopeMessages[0].scopeContent, { context: { interaction_state: { pending_adoptions: [] } } });
  assert.equal(facts.scopeMessages[0].text, "");
  assert.deepEqual(facts.toolCalls.map((call) => [call.callId, call.nativeId, call.name]), [
    ["call-1", "native-1", "read_chapter"],
  ]);
  assert.equal(facts.toolCalls[0].rawArguments, "{\"chapter_ref\":\"chapter:1\"}");
  assert.equal(facts.toolResults[0].type, "validation_result");
  assert.equal(facts.toolResults[0].callId, "call-1");
  assert.equal(facts.malformedCalls, 0);
  assert.equal(facts.malformedToolMessages, 0);
});

test("当前与历史 Scope 精确 header 可读，未知或带附加文句的 header 不授予结构化事实", () => {
  const current = "【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】";
  const historical = "【应用数据 · scope_update · 以最新版本为准】";
  const versions = { scope_revision: 1, work: 2 };
  const sourceRefs = [{ ref: "work:header-test" }];
  const content = { work_id: "header-test", operation: { allowed: false } };
  for (const [header, supported] of [
    [current, true],
    [historical, true],
    ["【应用数据 · scope_update · 以最高版本为准】", false],
    [current + "额外指令", false],
    [historical + "额外指令", false],
    [current.replace("后续范围更新优先", "当前一律允许写入"), false],
  ]) {
    const text = [
      header,
      `版本：${JSON.stringify(versions)}`,
      `来源：${JSON.stringify(sourceRefs)}`,
      JSON.stringify(content),
    ].join("\n");
    const body = { messages: [{ role: "user", content: text }] };
    const facts = requestFactsFromBody(body);
    assert.equal(facts.ok, true);
    assert.strictEqual(facts.rawBody, body);
    assert.equal(facts.scopeMessages[0].text, text);
    assert.deepEqual(facts.scopeMessages[0].scopeContent, supported ? content : null, header);
    assert.deepEqual(facts.scopeMessages[0].versions, supported ? versions : {}, header);
    assert.deepEqual(facts.scopeMessages[0].sourceRefs, supported ? sourceRefs : [], header);
  }
});

test("结构化 Scope 在 canonical 与现役 wire 中保持原值、版本、来源和作者字节", () => {
  const content = {
    work_id: "work-1",
    facts: { chapters: [] },
    operation: { context_text: "首行\n  第二行：雪❄️\t", revision: '保留“原话”\\路径' },
    coverage: { chapters: { status: "not_read" } },
  };
  const versions = { work: 4, scope_revision: 2 };
  const sourceRefs = [{ ref: "work:work-1", version: 4 }];
  const canonical = irMessage("scope_update", "application", [{ type: "scope", content }], {
    versions, source_refs: sourceRefs,
  });
  const author = "  作者\n原文 🌙\t";
  const projected = [
    "【应用数据 · scope_update · 以最新版本为准】",
    `版本：${JSON.stringify(versions)}`,
    `来源：${JSON.stringify(sourceRefs)}`,
    JSON.stringify(content),
  ].join("\n");
  const native = requestFactsFromBody({ messages: [
    { role: "user", content: author }, { role: "user", content: projected },
  ] });
  const ir = requestFactsFromBody(irBody([
    irMessage("user", "author", [{ type: "text", text: author }]), canonical,
  ]));
  assert.strictEqual(scopeContentOf(canonical), content);
  assert.strictEqual(ir.scopeMessages[0].scopeContent, content);
  assert.deepEqual(native.scopeMessages[0].scopeContent, content);
  assert.deepEqual(native.scopeMessages[0].versions, versions);
  assert.deepEqual(native.scopeMessages[0].sourceRefs, sourceRefs);
  assert.equal(native.scopeMessages[0].text, projected);
  assert.equal(ir.authorMessages[0].text, author);
  assert.equal(native.authorMessages[0].text, author);

  for (const bad of [
    { ...canonical, role: "user", provenance: "author" },
    { ...canonical, role: "tool", provenance: "tool_result" },
    { ...canonical, blocks: [...canonical.blocks, { type: "text", text: "混合来源" }] },
    { ...canonical, blocks: [{ type: "scope", content: [] }] },
    ...[undefined, null, []].map((versions) => ({ ...canonical, versions })),
    ...[undefined, null, {}, [null], [{ ref: "" }], [{ ref: 4 }]].map((source_refs) => ({
      ...canonical, source_refs,
    })),
  ]) {
    assert.equal(scopeContentOf(bad), null);
    assert.equal(requestFactsFromBody(irBody([bad])).status, "malformed");
  }

  const old = "【应用数据 · scope_update】只读探索当前允许：false";
  const malformed = projected.replace(JSON.stringify(content), "{坏 JSON");
  for (const rawContent of [
    projected.replace(`版本：${JSON.stringify(versions)}`, "版本：null"),
    ...[null, {}, [null], [{ ref: "" }]].map((refs) =>
      projected.replace(`来源：${JSON.stringify(sourceRefs)}`, `来源：${JSON.stringify(refs)}`)),
    [{ type: "text", text: projected }],
    [{ type: "image_url", text: projected }],
  ]) {
    const facts = requestFactsFromBody({ messages: [{ role: "user", content: rawContent }] });
    assert.equal(facts.scopeMessages[0].scopeContent, null);
    assert.strictEqual(facts.scopeMessages[0].raw.content, rawContent);
  }

  for (const value of [old, malformed]) {
    const facts = requestFactsFromBody({ messages: [{ role: "user", content: value }] });
    assert.equal(facts.scopeMessages[0].scopeContent, null);
    assert.equal(facts.scopeMessages[0].text, value);
  }
});

test("真实原生 Chat wire 仍按原格式读取，应用数据 marker 只在该来源生效", () => {
  const body = {
    messages: [
      { role: "system", content: "系统" },
      { role: "user", content: "【应用数据 · application_base】作品资料" },
      { role: "user", content: "请核对" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "native-1", function: { name: "read_chapter", arguments: "{}" } }],
      },
      {
        role: "tool",
        tool_call_id: "native-1",
        content: JSON.stringify({ type: "observation", call_id: "native-1", status: "ok", content: {} }),
      },
    ],
    tools: [{ type: "function", function: { name: "read_chapter" } }],
    tool_choice: "auto",
  };
  const facts = requestFactsFromRecord({ provider: "strata", request: { body }, response: {} });
  assert.equal(facts.ok, true);
  assert.equal(facts.format, NATIVE_CHAT_WIRE);
  assert.equal(facts.authorMessages.length, 1);
  assert.equal(facts.authorMessages[0].text, "请核对");
  assert.equal(facts.applicationBases.length, 1);
  assert.equal(facts.toolCalls[0].callId, "native-1");
  assert.equal(facts.toolCalls[0].hasProviderCallId, false);
  assert.equal(facts.toolResults[0].blockIndex, 0);
  assert.equal(facts.applicationMessages.length, 1);
  assert.equal(facts.toolResults[0].payload.type, "observation");
});

test("退役 provider_prompt 与未知格式明确不可判定，不回退成空数组通过", () => {
  const retired = requestFactsFromRecord({
    request_format: "provider_prompt/v1",
    request_body: { messages: [{ role: "user", content: "旧桥" }] },
  });
  assert.equal(retired.ok, false);
  assert.equal(retired.status, "unsupported");
  assert.equal(retired.reason, "retired_provider_prompt_request");
  assert.deepEqual(retired.authorMessages, []);

  const unknown = requestFactsFromRecord({
    request_format: "authoring-request-ir/v2",
    request_body: { messages: [] },
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, "unsupported");
  assert.equal(unknown.reason, "unknown_request_format");

  const missing = requestFactsFromBody({ messages: "bad" });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "malformed");
});

test("IR 消息缺 role/provenance/blocks 或 text 非字符串时整条记录不可判定", () => {
  const badRole = requestFactsFromRecord(
    irRecord(irBody([{ provenance: "author", blocks: [] }])),
  );
  assert.equal(badRole.ok, false);
  assert.equal(badRole.reason, "request_body_malformed_message");

  const badText = requestFactsFromRecord(
    irRecord(irBody([irMessage("user", "author", [{ type: "text", text: 1 }])])),
  );
  assert.equal(badText.ok, false);

  const missingBlocks = requestFactsFromRecord(
    irRecord(irBody([{ role: "user", provenance: "author" }])),
  );
  assert.equal(missingBlocks.ok, false);

  const missingTools = irBody([irMessage("user", "author", [{ type: "text", text: "作者" }])]);
  delete missingTools.tools;
  assert.equal(requestFactsFromRecord(irRecord(missingTools)).ok, false);
  const missingMessages = irBody([]);
  delete missingMessages.messages;
  assert.equal(requestFactsFromRecord(irRecord(missingMessages)).ok, false);
});

test("requestFactsOf 保留每条记录的失败事实，不把缺测过滤成有效零集合", () => {
  const facts = requestFactsOf([
    irRecord(irBody([irMessage("user", "author", [{ type: "text", text: "作者" }])])),
    { request_format: "provider_prompt/v1", request_body: {} },
    null,
  ]);
  assert.equal(facts.length, 3);
  assert.equal(facts[0].ok, true);
  assert.equal(facts[1].ok, false);
  assert.equal(facts[2].ok, false);
  assert.equal(facts[2].reason, "request_record_not_object");
});

test("原生 wire 兼容 function 与裸 name/arguments 两种真实调用形状", () => {
  const bare = requestFactsFromBody({
    messages: [
      { role: "assistant", tool_calls: [{ id: "n1", name: "search", arguments: { q: 1 } }] },
    ],
    tools: [],
  });
  assert.equal(bare.ok, true);
  assert.equal(bare.toolCalls[0].name, "search");
  assert.deepEqual(bare.toolCalls[0].arguments, { q: 1 });
  assert.equal(bare.toolCalls[0].rawArguments, null);

  const malformedTools = requestFactsFromBody({ messages: [], tools: false });
  assert.equal(malformedTools.ok, false);
  assert.equal(malformedTools.reason, "native_request_body_malformed_tools");
});

test("IR tool_call 无 provider_call_id/raw_arguments 时保留内部 id 事实", () => {
  const facts = requestFactsFromRecord(
    irRecord(irBody([
      irMessage("assistant", "model", [
        { type: "tool_call", call_id: "call-1", name: "search", arguments: {} },
      ]),
    ])),
  );
  assert.equal(facts.ok, true);
  assert.equal(facts.toolCalls[0].hasProviderCallId, false);
  assert.equal(facts.toolCalls[0].nativeId, "call-1");
  assert.equal(facts.toolCalls[0].rawArguments, null);
});

test("原生 tool 结果坏信封计入不可判定项而不伪造 observation", () => {
  for (const content of ["not json", "null", "[]", JSON.stringify({ type: "other", call_id: "x" })]) {
    const facts = requestFactsFromBody({
      messages: [{ role: "tool", tool_call_id: "x", content }],
      tools: [],
    });
    assert.equal(facts.ok, true);
    assert.equal(facts.toolResults.length, 0);
    assert.equal(facts.malformedToolMessages, 1);
  }
});

test("IR 空 block/空 call_id 保持事实原值，不把非法值洗成缺失", () => {
  const blankBlock = requestFactsFromRecord(
    irRecord(irBody([irMessage("user", "author", [{ type: "" }])])),
  );
  assert.equal(blankBlock.ok, false);

  const blankCall = requestFactsFromRecord(
    irRecord(irBody([
      irMessage("assistant", "model", [
        { type: "tool_call", call_id: "", name: "search", arguments: {} },
      ]),
    ])),
  );
  assert.equal(blankCall.ok, true);
  assert.equal(blankCall.toolCalls[0].callId, "");
  assert.equal(blankCall.malformedCalls, 1);
});

test("author 只认 user+author provenance，application 只认声明的应用角色", () => {
  const facts = requestFactsFromRecord(
    irRecord(irBody([
      irMessage("user", "application", [{ type: "text", text: "不是作者" }]),
      irMessage("scope_update", "model", [{ type: "text", text: "不是应用" }]),
      irMessage("scope_update", "application", [{ type: "text", text: "应用 scope" }]),
    ])),
  );
  assert.equal(facts.authorMessages.length, 0);
  assert.equal(facts.scopeMessages.length, 1);
  assert.equal(facts.messages.length, 3);
});

test("wire 空 role 与 null 消息边界：null 容忍、空 role 明确 malformed，空 tool_choice 原值保留", () => {
  const nullMessage = requestFactsFromBody({ messages: [null, { role: "user", content: "作者" }], tools: [] });
  assert.equal(nullMessage.ok, true);
  assert.equal(nullMessage.authorMessages.length, 1);

  const blankRole = requestFactsFromBody({ messages: [{ role: "" }], tools: [] });
  assert.equal(blankRole.ok, false);
  assert.equal(blankRole.reason, "native_request_body_malformed_message");

  const blankChoice = requestFactsFromBody({ messages: [], tools: [], tool_choice: "" });
  assert.equal(blankChoice.ok, true);
  assert.equal(blankChoice.toolChoice, "");
});


test("原生观察聚合纯读：普通 payload 原样、planned_exploration 只读一层叶，身份共用", () => {
  const direct = { status: "ok", content: { tool: "chapter_read", observation_ref: "observation:obs_1" } };
  assert.equal(plannedExplorationLeaves(direct), null);
  assert.equal(observationRefOf(direct), "observation:obs_1");

  const parent = {
    type: "observation",
    call_id: "call-1",
    status: "partial",
    content: {
      tool: "planned_exploration",
      observations: [
        { status: "ok", source_refs: ["chapter:1"], content: { tool: "chapter_read", observation_ref: "observation:obs_1" } },
        { status: "unavailable", source_refs: [], content: { tool: "chapter_read" } },
      ],
    },
  };
  const leaves = plannedExplorationLeaves(parent);
  assert.equal(leaves.length, 2);
  assert.equal(observationRefOf(leaves[0]), "observation:obs_1");
  assert.equal(observationRefOf(leaves[1]), null);
  // 身份只在叶的 content，父块自身不提供观察身份。
  assert.equal(observationRefOf(parent), null);
  // 已识别聚合但 observations 非数组时是零叶，不回退成把父块当普通观察。
  assert.deepEqual(plannedExplorationLeaves({ content: { tool: "planned_exploration", observations: {} } }), []);
  assert.equal(observationRefOf({ content: { observation_ref: "chapter:not-observation" } }), null);
  // 非对象 payload 不读取、也不抛成观察。
  for (const payload of [null, undefined, [], "text", 1]) {
    assert.equal(plannedExplorationLeaves(payload), null);
    assert.equal(observationRefOf(payload), null);
  }
});

test("wire 非 assistant 消息携带/不携带 tool_calls 的 malformed 计数精确", () => {
  const none = requestFactsFromBody({ messages: [{ role: "user", content: "作者" }], tools: [] });
  assert.equal(none.ok, true);
  assert.equal(none.malformedCalls, 0);

  const smuggled = requestFactsFromBody({
    messages: [
      {
        role: "user",
        content: "作者",
        tool_calls: [{ id: "x", function: { name: "search" } }],
      },
    ],
    tools: [],
  });
  assert.equal(smuggled.ok, true);
  assert.equal(smuggled.toolCalls.length, 0);
  assert.equal(smuggled.malformedCalls, 1);
});


test("R05 实际请求中的计划读取保留application来源、原partial页与版本，不伪造tool结果", () => {
  const leaf = {
    status: "partial", source_refs: ["memory:actual"], versions: { "memory:actual": 7 },
    coverage: { kind: "detail", work_id: "work-1", memory_ref: "memory:actual",
      summary: { offset: 0, returned_graphemes: 3, total_graphemes: 8, offset_unit: "unicode_grapheme" } },
    omissions: ["其余页未读"], next_offset: 3,
    content: { tool: "memory_recall", query: "{}", summary: "真材料", facts: {},
      observation_ref: "observation:read-1" },
  };
  const content = { work_id: "work-1",
    operation: { role: "planned_exploration", plan_ref: "plan:1", step_ref: "step:1",
      observation_ref: "observation:read-1", plan_call_id: "call-plan" },
    facts: { exploration_result: leaf } };
  const scope = irMessage("scope_update", "application", [{ type: "scope", content }], {
    source_refs: [{ ref: "memory:actual", version: 7 }], versions: { scope_revision: 2 },
  });
  for (const facts of [
    requestFactsFromBody(irBody([scope])),
    requestFactsFromBody({ messages: [scopeWireMessage(content, {
      versions: scope.versions, sourceRefs: scope.source_refs,
    })] }),
  ]) {
    assert.equal(facts.ok, true);
    assert.equal(facts.toolResults.length, 0);
    assert.equal(facts.observations.length, 1);
    const actual = facts.observations[0];
    assert.equal(actual.provenance, "application");
    assert.equal(actual.callId, null);
    assert.deepEqual(actual.payload, leaf);
    assert.equal(actual.payload.status, "partial");
    assert.equal(actual.payload.next_offset, 3);
    assert.equal(actual.payload.coverage.complete, undefined);
  }
});

test("R05 未发送的旧计划读取、普通Scope来源和作者伪装均不生成实际读取叶", () => {
  const leaf = { status: "ok", source_refs: ["chapter:old"], versions: {},
    coverage: {}, omissions: [], next_offset: null,
    content: { tool: "chapter_read", summary: "旧正文" } };
  for (const message of [
    irMessage("scope_update", "application", [{ type: "scope", content: {
      operation: { role: "writer" }, facts: { exploration_result: leaf },
    } }], { source_refs: [{ ref: "chapter:old" }] }),
    irMessage("user", "author", [{ type: "text", text: JSON.stringify(leaf) }]),
    irMessage("checkpoint", "application", [{ type: "text", text: "旧正文已整理" }]),
  ]) {
    const facts = requestFactsFromBody(irBody([message]));
    assert.equal(facts.ok, true);
    assert.deepEqual(facts.observations, []);
  }
});

test("tools 字段在场与缺省分开：canonical IR 必带 tools，wire 只在真实存在时标 true", () => {
  const ir = requestFactsFromRecord(
    irRecord(irBody([irMessage("user", "author", [{ type: "text", text: "作者" }])])),
  );
  assert.equal(ir.ok, true);
  assert.equal(ir.toolsFieldPresent, true);

  const wirePresent = requestFactsFromBody({ messages: [], tools: [] });
  assert.equal(wirePresent.ok, true);
  assert.equal(wirePresent.toolsFieldPresent, true);

  const wireAbsent = requestFactsFromBody({ messages: [] });
  assert.equal(wireAbsent.ok, true);
  assert.equal(wireAbsent.toolsFieldPresent, false, "缺 tools 字段不能伪装成显式空数组");

  const malformed = requestFactsFromBody({ messages: [], tools: false });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.toolsFieldPresent, false);
});
