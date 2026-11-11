// B71 外部验收请求事实边界测试：只按 source format 读取，不把未知格式读成空事实。
import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORING_REQUEST_IR,
  NATIVE_CHAT_WIRE,
  observationRefOf,
  plannedExplorationLeaves,
  requestFactsFromBody,
  requestFactsFromRecord,
  requestFactsOf,
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
      [{ type: "text", text: "## 消息处置与已有产物\n{}" }],
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
  assert.deepEqual(facts.toolCalls.map((call) => [call.callId, call.nativeId, call.name]), [
    ["call-1", "native-1", "read_chapter"],
  ]);
  assert.equal(facts.toolCalls[0].rawArguments, "{\"chapter_ref\":\"chapter:1\"}");
  assert.equal(facts.toolResults[0].type, "validation_result");
  assert.equal(facts.toolResults[0].callId, "call-1");
  assert.equal(facts.malformedCalls, 0);
  assert.equal(facts.malformedToolMessages, 0);
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
