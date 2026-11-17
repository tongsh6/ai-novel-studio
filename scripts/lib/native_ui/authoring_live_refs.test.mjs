// L7 真实 refs 证据纯判据测试：唯一正判来源是 canonical assistant(model) 的
// tool_call.arguments.self_report.used_context_refs，按顶层 provider_call_ref +
// provider_run_ref 配对同一次真实 llm record；base/observation 只从该 record 的
// 明确 application_base/同次 IR.refs.base_refs 与唯一成功 observation 读取。段头累计 refs /
// decision_traces / agent_events 不参与正判，也不做整批并集；缺配对键、重复匹配、
// 请求不可解析记 null，已证越界优先 false，ref 按完整字符串精确匹配。
import assert from "node:assert/strict";
import test from "node:test";
import { extractRefTokens, liveRefsCheck } from "./authoring_live_refs.mjs";
import { scopeWireMessage } from "./fixtures/authoring_request_ir.mjs";

const AUTHOR = "请为第01章写一段约300字的开篇正文。";
const AUTHOR_INPUT = "继续：按你刚才的判断，把下一个场景的开头写出来。";

const system = (text = "system") => ({ role: "system", content: text });
const author = (text = AUTHOR) => ({ role: "user", content: text });
const appBase = (text) => ({
  role: "user",
  content: `【应用数据 · application_base · 非作者原话】\n${text}`,
});

// 当前请求沿用真实 application_base；Scope 由独立共享 fixture 按原生结构构造。
// 旧文本仅作为负例证据，不再重建旧材料区或作者输入区。
const REAL_APP_BASE =
  "【应用数据 · application_base · 非作者原话】\n" +
  "本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由本消息的结构化字段与后续 " +
  "scope_update 给出；作者原话在独立 user 消息中。角色规则与输出协议见 system。";
const realAppBase = () => ({ role: "user", content: REAL_APP_BASE });
const realScope = ({ sourceRefs = [], content = {} } = {}) => irMessage(
  "scope_update", "application", [{ type: "scope", content }], {
    versions: { change_reason: "run_scope_refreshed", scope_revision: 2 },
    source_refs: sourceRefs.map((ref) => ({ ref })),
  },
);
const checkpoint = (text) => ({
  role: "user",
  content: `【应用数据 · checkpoint · 覆盖 ["materials"]】\n来源：[]\n版本：{}\n省略：${text}\n`,
});
const notice = (text) => ({ role: "user", content: `【应用数据 · application_notice · 非作者原话】\n${text}` });

function nativeRecord({ providerCallRef = "pcall_1", providerRunRef = "prun_1", messages } = {}) {
  return {
    provider: "strata",
    turn_id: "turn_1",
    provider_call_ref: providerCallRef,
    provider_run_ref: providerRunRef,
    request: { body: { messages: messages.map((message) => message.role === "scope_update"
      ? scopeWireMessage(message.blocks[0].content, { versions: message.versions, sourceRefs: message.source_refs })
      : message) } },
  };
}

function assistantCall({ pcall = "pcall_1", prun = "prun_1", refs, callId = "call_1" } = {}) {
  return {
    role: "assistant",
    provenance: "model",
    provider_call_ref: pcall,
    provider_run_ref: prun,
    blocks: [
      {
        type: "tool_call",
        call_id: callId,
        name: "submit_tentative_artifact",
        arguments: { self_report: { used_context_refs: refs } },
      },
    ],
  };
}

function assistantToolCall({ callId = "call_1" } = {}) {
  return {
    role: "assistant",
    content: "",
    tool_calls: [{ id: callId, type: "function", function: { name: "read_chapter", arguments: "{}" } }],
  };
}

function nativeObservation({ callId = "call_1", outerCallId = callId, type = "observation", status = "ok", sourceRefs = [], content = null } = {}) {
  return {
    role: "tool",
    tool_call_id: outerCallId,
    content: JSON.stringify({
      type,
      call_id: callId,
      status,
      source_refs: sourceRefs,
      ...(content === null ? {} : { content }),
    }),
  };
}

// planned_exploration 叶没有 type/call_id；身份与调用属于父块。
function observationLeaf({ status = "ok", sourceRefs = [], observationRef = null, tool = "chapter_read" } = {}) {
  return {
    status,
    source_refs: sourceRefs,
    versions: {},
    coverage: { chapter_ref: "chapter:1" },
    omissions: [],
    next_offset: null,
    content: {
      tool,
      query: "{}",
      summary: "观察",
      facts: {},
      ...(observationRef === null ? {} : { observation_ref: observationRef }),
    },
  };
}

function nativePlannedObservation({ callId = "call_1", outerCallId = callId, status = "ok", leaves = [] } = {}) {
  return {
    role: "tool",
    tool_call_id: outerCallId,
    content: JSON.stringify({
      type: "observation",
      call_id: callId,
      status,
      source_refs: [...new Set(leaves.flatMap((leaf) => leaf.source_refs))],
      versions: {},
      coverage: {},
      omissions: [],
      next_offset: null,
      content: {
        tool: "planned_exploration",
        query: leaves.map((leaf) => leaf.content.tool).join(" / "),
        summary: `计划内只读检索完成（${leaves.length} 次）`,
        observations: leaves,
      },
    }),
  };
}

function irRecord({ providerCallRef = "pcall_ir", providerRunRef = "prun_ir", messages, baseRefs } = {}) {
  return {
    provider: "slice_verify",
    provider_call_ref: providerCallRef,
    provider_run_ref: providerRunRef,
    request_format: "authoring-request-ir/v1",
    request_body: {
      ir_version: "authoring-request-ir/v1",
      messages,
      tools: [],
      projection: { tool_choice: null },
      refs: baseRefs === undefined ? {} : { base_refs: baseRefs },
    },
  };
}

const irMessage = (role, provenance, blocks, extra = {}) => ({
  role,
  provenance,
  blocks,
  source_refs: [],
  versions: {},
  ...extra,
});

function resultOf({ messages, usedRefs, pcall = "pcall_1", prun = "prun_1" }) {
  const sessionMessages = [
    ...structuredClone(messages.filter((message) => message.role === "scope_update")),
    assistantCall({ pcall, prun, refs: usedRefs }),
  ];
  return liveRefsCheck({
    llmRecords: [nativeRecord({ messages })],
    transcript: { messages: sessionMessages },
    sessionMessages,
  });
}

function irResultOf({ messages, baseRefs, usedRefs }) {
  const sessionMessages = [
    ...structuredClone(messages),
    assistantCall({ pcall: "pcall_ir", prun: "prun_ir", refs: usedRefs }),
  ];
  return liveRefsCheck({
    llmRecords: [irRecord({ messages, baseRefs })],
    transcript: { messages: sessionMessages },
    sessionMessages,
  });
}

function assertViolation(messages, ref, label) {
  const result = resultOf({ messages, usedRefs: [ref] });
  assert.equal(result.ok, false, label);
  assert(result.reports[0].violations.some((violation) => violation.ref === ref), label);
}

test("L7 逐调用：A 的 ref 只在 B 的请求/整批事件/段头出现 → false，无 pcall/prun 或记录不唯一 → null", () => {
  const recordA = nativeRecord({
    providerCallRef: "pcall_A",
    providerRunRef: "prun_A",
    messages: [system(), appBase("材料 chapter:ch-base"), author()],
  });
  const recordB = nativeRecord({
    providerCallRef: "pcall_B",
    providerRunRef: "prun_B",
    messages: [
      system(),
      appBase("材料 chapter:ch-base"),
      author(),
      assistantToolCall({ callId: "call_b" }),
      nativeObservation({ callId: "call_b", sourceRefs: ["observation:obs_b"] }),
    ],
  });
  const result = liveRefsCheck({
    sessionMessages: [],
    llmRecords: [recordA, recordB],
    transcript: {
      messages: [assistantCall({ pcall: "pcall_A", prun: "prun_A", refs: ["observation:obs_b"] })],
      used_refs: [{ ref: "observation:obs_b" }],
      base_refs: ["chapter:ch-base"],
      observation_refs: ["observation:obs_b"],
    },
    agentEvents: [{ event_type: "exploration_observed", refs: '["observation:obs_b"]' }],
    decisionTraces: [{ trace_id: "trace_1", context_refs: '["observation:obs_b"]' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "used_ref_out_of_boundary");
  const report = result.reports[0];
  assert.deepEqual(
    [report.provider_call_ref, report.provider_run_ref, report.message_indexes, report.base_refs, report.observation_refs],
    ["pcall_A", "prun_A", [0], ["chapter:ch-base"], []],
  );
  assert.equal(result.violations[0].provider_call_ref, "pcall_A");
  assert.equal(result.violations[0].provider_run_ref, "prun_A");

  const missingKey = liveRefsCheck({
    sessionMessages: [],
    llmRecords: [recordA],
    transcript: { messages: [assistantCall({ pcall: "pcall_A", prun: null, refs: ["chapter:ch-base"] })] },
  });
  assert.equal(missingKey.ok, null);
  assert.equal(missingKey.reason, "pairing_key_missing");
  assert.deepEqual(missingKey.issues[0].used_refs, ["chapter:ch-base"]);

  for (const [label, llmRecords, pcall, prun] of [
    ["record missing", [recordA], "pcall_X", "prun_X"],
    ["half key", [recordA], "pcall_A", "prun_other"],
    ["record ambiguous", [recordA, nativeRecord({ providerCallRef: "pcall_A", providerRunRef: "prun_A", messages: [system()] })], "pcall_A", "prun_A"],
  ]) {
    const check = liveRefsCheck({
      sessionMessages: [],
      llmRecords,
      transcript: { messages: [assistantCall({ pcall, prun, refs: ["chapter:ch-base"] })] },
    });
    assert.equal(check.ok, null, label);
    assert(["llm_record_not_found", "llm_record_ambiguous"].includes(check.reason), label);
  }

  const unparseable = liveRefsCheck({
    sessionMessages: [],
    llmRecords: [{ provider_call_ref: "pcall_1", provider_run_ref: "prun_1", request_format: "provider_prompt/v1" }],
    transcript: { messages: [assistantCall({ refs: ["chapter:ch-1"] })] },
  });
  assert.equal(unparseable.ok, null);
  assert.equal(unparseable.reason, "request_unparseable");
  assert.equal(unparseable.reports[0].request_reason, "retired_provider_prompt_request");
});

test("L7 同次：既有 application_base/成功 observation 通过，多 report 合并，来源可查", () => {
  const messages = [
    system("chapter:system-not-base"),
    appBase("材料 chapter:ch-1；artifact as_live_1；执行简述 execution_brief:chapter:ch-1"),
    author(),
    assistantToolCall({ callId: "call_1" }),
    nativeObservation({ callId: "call_1", sourceRefs: ["chapter:obs_tool", "observation:obs_tool"] }),
  ];
  const used = [
    "chapter:ch-1",
    "as_live_1",
    "execution_brief:chapter:ch-1",
    "chapter:obs_tool",
    "observation:obs_tool",
  ];
  const result = resultOf({ messages, usedRefs: used });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.sources.self_report_count, 1);
  const report = result.reports[0];
  assert.deepEqual(report.used_refs, [...used].sort());
  assert(report.observation_refs.includes("chapter:obs_tool"));
  assert.equal(report.matched_refs.length, used.length);
  const matched = Object.fromEntries(report.matched_refs.map((entry) => [entry.ref, entry.sources[0]]));
  assert.deepEqual(
    [matched["chapter:obs_tool"].call_id, matched["chapter:obs_tool"].status, matched["chapter:obs_tool"].channel],
    ["call_1", "ok", "source_refs"],
  );

  const structuredScope = realScope({
    sourceRefs: ["chapter:ch-object", "observation:obs_real_1"],
    content: {
      goal: { text: "作者引用 chapter_ref=chapter:ch-goal" },
      operation: { context_text: "正文材料 chapter_ref=chapter:ch-inline" },
    },
  });
  const structured = resultOf({
    messages: [system(), realAppBase(), structuredScope, author()],
    usedRefs: ["chapter:ch-object", "chapter:ch-inline", "chapter:ch-goal", "observation:obs_real_1"],
  });
  assert.equal(structured.ok, null);
  assert.equal(structured.reason, "request_base_refs_unavailable");
  assert.deepEqual(structured.reports[0].base_refs, []);
  assert.deepEqual(structured.reports[0].observation_refs, []);

  const merged = liveRefsCheck({
    sessionMessages: [],
    llmRecords: [nativeRecord({ messages: [system(), appBase("材料 chapter:ch-1"), author()] })],
    transcript: {
      messages: [
        assistantCall({ refs: ["chapter:ch-1"], callId: "call_1" }),
        assistantCall({ refs: ["observation:obs_missing"], callId: "call_2" }),
      ],
    },
  });
  assert.equal(merged.reports.length, 1);
  assert.deepEqual(merged.reports[0].message_indexes, [0, 1]);
  assert.deepEqual(merged.reports[0].call_ids, ["call_1", "call_2"]);
  assert.equal(merged.ok, false);
});

test("L7 缺证/坏自报：空自报仍 null，越界优先 false，合法报告不能覆盖坏报告", () => {
  const messages = [system(), appBase("材料 chapter:ch-1"), author()];
  const record = nativeRecord({ messages });
  const check = (transcript) => liveRefsCheck({ llmRecords: [record], transcript, sessionMessages: transcript.messages });
  assert.equal(liveRefsCheck({ llmRecords: [record], transcript: null, sessionMessages: [] }).ok, null);
  assert.equal(resultOf({ messages, usedRefs: [] }).reason, "used_context_refs_unavailable");
  assert.equal(check({ messages: [{ role: "assistant", provenance: "model", blocks: [{ type: "text", text: "无自报" }] }] }).ok, null);

  const mixed = check({
    messages: [
      assistantCall({ refs: ["observation:obs_out"] }),
      assistantCall({ pcall: "pcall_1", prun: null, refs: ["chapter:ch-1"], callId: "call_2" }),
    ],
  });
  assert.equal(mixed.ok, false);
  assert(mixed.issues.some((issue) => issue.reason === "pairing_key_missing"));

  const bad = (refs) => ({
    role: "assistant",
    provenance: "model",
    provider_call_ref: "pcall_1",
    provider_run_ref: "prun_1",
    blocks: [
      { type: "tool_call", call_id: "call_no_args" },
      { type: "tool_call", call_id: "call_bad", arguments: { self_report: { used_context_refs: refs } } },
    ],
  });
  const malformedOnly = check({ messages: [bad("chapter:ch-1")] });
  assert.equal(malformedOnly.reason, "self_report_malformed");
  const malformedMerged = check({ messages: [bad("chapter:ch-1"), assistantCall({ refs: ["chapter:ch-1"] })] });
  assert.equal(malformedMerged.reason, "self_report_malformed");
  assert.deepEqual(malformedMerged.reports[0].message_indexes, [0, 1]);
});

test("L7 不授信来源：system/author/history assistant/失败 observation/validation_result/call 不一致/无前序调用/content 文本", () => {
  const base = [system(), appBase("材料 chapter:ch-1"), author()];
  const cases = [
    ["system", [system("chapter:sys"), appBase("材料 chapter:ch-1"), author()], "chapter:sys"],
    ["author", [system(), appBase("材料 chapter:ch-1"), author("chapter:author")], "chapter:author"],
    ["history assistant", [...base, { role: "assistant", content: "chapter:history", tool_calls: [{ id: "h" }] }], "chapter:history"],
    ["failed observation", [...base, assistantToolCall(), nativeObservation({ status: "failed", sourceRefs: ["chapter:failed"] })], "chapter:failed"],
    ["validation_result", [...base, assistantToolCall(), nativeObservation({ type: "validation_result", sourceRefs: ["chapter:validation"] })], "chapter:validation"],
    ["call id mismatch", [...base, assistantToolCall(), nativeObservation({ outerCallId: "call_other", sourceRefs: ["chapter:mismatch"] })], "chapter:mismatch"],
    ["no preceding call", [...base, nativeObservation({ sourceRefs: ["chapter:no-call"] })], "chapter:no-call"],
    ["content text", [...base, assistantToolCall(), nativeObservation({ sourceRefs: [], content: { text: "chapter:content-only" } })], "chapter:content-only"],
  ];
  for (const [label, messages, ref] of cases) assertViolation(messages, ref, label);
});


test("L7 native Scope 只消费同 pcall/prun 的 request.refs，保留真实 Scope 与观察核验", () => {
  const scope = realScope({ sourceRefs: ["chapter:actual", "chapter:source-only"] });
  const record = nativeRecord({ messages: [scope] });
  record.provider = "splash";
  record.request.refs = { base_refs: [{ ref: "chapter:actual", version: 2 }],
    observation_refs: [{ ref: "observation:metadata-only" }], used_refs: ["chapter:actual"] };
  const check = (used, records = [record], scopes = [scope]) => {
    const call = assistantCall({ refs: used });
    const messages = [...scopes, call];
    return liveRefsCheck({ llmRecords: records, transcript: { messages }, sessionMessages: messages });
  };
  const result = check(["chapter:actual"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.reports[0].base_refs, ["chapter:actual"]);
  assert.deepEqual(result.reports[0].observation_refs, []);
  assert.equal(check(["chapter:source-only"]).ok, false);
  assert.equal(check(["observation:metadata-only"]).ok, false);
  const altered = structuredClone(scope);
  altered.versions.scope_revision += 1;
  assert.equal(check(["chapter:actual"], [record], [altered]).reason, "scope_provenance_unbound");
  const wrongRun = structuredClone(record);
  wrongRun.provider_run_ref = "prun-other";
  assert.equal(check(["chapter:actual"], [wrongRun]).ok, null);
});

test("L7 native request.refs 不跨调用借用，缺失或坏格式不由累计 refs 补齐", () => {
  const scope = realScope({ sourceRefs: ["chapter:actual"] });
  const first = nativeRecord({ messages: [scope] });
  const second = nativeRecord({ providerCallRef: "pcall_2", providerRunRef: "prun_2", messages: [scope] });
  second.request.refs = { base_refs: [{ ref: "chapter:actual" }], observation_refs: [], used_refs: [] };
  const call = assistantCall({ refs: ["chapter:actual"] });
  const messages = [scope, call];
  for (const refs of [undefined, { base_refs: [] }, { base_refs: [{ ref: "" }], observation_refs: [], used_refs: [] }]) {
    first.request.refs = refs;
    const result = liveRefsCheck({ llmRecords: [first, second],
      transcript: { base_refs: [{ ref: "chapter:actual" }], messages }, sessionMessages: messages });
    assert.equal(result.ok, null);
    assert.equal(result.reason, "request_base_refs_unavailable");
  }
});

test("L7 现役 Scope：普通来源不授 Base，缺同次 Base 登记为 unknown，旧文本与引用不授信", () => {
  const actualScope = realScope({ sourceRefs: ["turn:author", "chapter:material", "observation:source-only"] });
  const actualAuthor = irMessage("user", "author", [{ type: "text", text: AUTHOR }], {
    source_refs: [{ ref: "turn:author" }],
  });
  const current = [actualScope, actualAuthor];
  const check = (usedRefs, baseRefs = [{ ref: "chapter:material", version: 3 }]) =>
    irResultOf({ messages: current, baseRefs, usedRefs });
  const legal = check(["chapter:material"]);
  assert.equal(legal.ok, true);
  assert.deepEqual(legal.reports[0].base_refs, ["chapter:material"]);
  assert.deepEqual(legal.reports[0].observation_refs, []);
  for (const ref of ["turn:author", "observation:source-only"]) {
    const rejected = check([ref]);
    assert.equal(rejected.ok, false, ref);
    assert(rejected.reports[0].violations.some((violation) => violation.ref === ref));
  }
  assert.deepEqual(actualAuthor.source_refs, [{ ref: "turn:author" }]);
  assert.equal(check(["chapter:material"], []).ok, false);
  for (const baseRefs of [null, {}, [""], [{ ref: null }]]) {
    const missing = check(["chapter:material"], baseRefs);
    assert.equal(missing.ok, null);
    assert.equal(missing.reason, "request_base_refs_unavailable");
  }

  const scope = realScope({ sourceRefs: ["observation:obs_real_1"] });
  const record = nativeRecord({ messages: [scope] });
  const call = assistantCall({ refs: ["observation:obs_real_1"] });
  const missingCanonical = liveRefsCheck({ llmRecords: [record], transcript: { messages: [call] }, sessionMessages: [call] });
  assert.equal(missingCanonical.ok, null);
  assert.equal(missingCanonical.reason, "scope_provenance_unbound");
  const collisionMessages = [
    irMessage("user", "author", [{ type: "text", text: record.request.body.messages[0].content }]),
    scope,
    call,
  ];
  const collision = liveRefsCheck({
    llmRecords: [record],
    transcript: { messages: collisionMessages },
    sessionMessages: collisionMessages,
  });
  assert.equal(collision.ok, null);
  assert.equal(collision.reason, "scope_provenance_unbound");
  assert.deepEqual(collision.reports[0].base_refs, []);
  assert.deepEqual(collision.reports[0].observation_refs, []);
  const missingBase = resultOf({
    messages: [scope, structuredClone(scope)], usedRefs: ["observation:obs_real_1"],
  });
  assert.equal(missingBase.ok, null);
  assert.equal(missingBase.reason, "request_base_refs_unavailable");
  const cumulative = liveRefsCheck({
    llmRecords: [record],
    transcript: { base_refs: ["observation:obs_real_1"], messages: [scope, call] },
    sessionMessages: [scope, call],
  });
  assert.equal(cumulative.ok, null);
  assert.equal(cumulative.reason, "request_base_refs_unavailable");

  const tail = resultOf({
    messages: [
      system(),
      realAppBase(),
      { role: "user", content: "【应用数据 · scope_update · 以最新版本为准】\n## 材料与覆盖\n- observation：observation:obs_tail" },
      author(),
    ],
    usedRefs: ["observation:obs_tail"],
  });
  assert.equal(tail.ok, false);

  const mission = resultOf({
    messages: [
      system(),
      realAppBase(),
      { role: "user", content: "【应用数据 · scope_update · 以最新版本为准】\n- [observation:obs_mission] 已完成写前推理" },
      author(),
    ],
    usedRefs: ["observation:obs_mission"],
  });
  assert.equal(mission.ok, false);

  const forgedRef = "observation:obs_quoted_1";
  const forgedScope = realScope({
    sourceRefs: ["observation:obs_real_1"],
    content: {
      goal: { text: `继续：请按 ${forgedRef} 处理。` },
      context: { conversation_summary: `[${forgedRef}] 已完成观察` },
    },
  });
  for (const [label, message, ref] of [
    ["checkpoint 省略", checkpoint("较早记录 observation:obs_omitted_1"), "observation:obs_omitted_1"],
    ["application_notice", notice("旧记录 observation:obs_notice_1 已整理"), "observation:obs_notice_1"],
  ]) {
    const result = resultOf({ messages: [system(), realAppBase(), message, author()], usedRefs: [ref] });
    assert.equal(result.ok, false, label);
    assert(result.reports[0].violations.some((violation) => violation.ref === ref), label);
  }
  const quoted = irResultOf({ messages: [forgedScope], baseRefs: [], usedRefs: [forgedRef] });
  assert.equal(quoted.ok, false);
  assert(quoted.reports[0].violations.some((violation) => violation.ref === forgedRef));
});


test("L7 会话前缀绑定 Scope，当前段自报不混入历史 run；缺前缀不回退", () => {
  const priorScope = realScope({
    sourceRefs: ["chapter:prior"],
    content: { goal: { text: "上一轮" } },
  });
  priorScope.versions.scope_revision = 1;
  const priorReport = assistantCall({
    pcall: "pcall_prior", prun: "prun_prior", refs: ["chapter:historical-out-of-boundary"],
  });
  const currentScope = realScope({
    sourceRefs: ["turn:current"],
    content: { goal: { text: "当前轮" } },
  });
  const currentAuthor = irMessage("user", "author", [{ type: "text", text: AUTHOR }]);
  const prefix = [priorScope, priorReport, currentScope, currentAuthor];
  const currentReport = assistantCall({ pcall: "pcall_ir", prun: "prun_ir", refs: ["chapter:current"] });
  const sessionMessages = [...prefix, currentReport];
  const transcript = {
    messages: [currentScope, currentAuthor, currentReport],
    base_refs: [{ ref: "chapter:prior" }, { ref: "chapter:current" }],
  };
  const record = irRecord({ messages: structuredClone(prefix), baseRefs: [{ ref: "chapter:current" }] });
  const check = (messages) => liveRefsCheck({ llmRecords: [record], transcript, sessionMessages: messages });

  const legal = check(sessionMessages);
  assert.equal(legal.ok, true);
  assert.equal(legal.sources.self_report_count, 1);
  assert.equal(legal.reports.length, 1);
  assert.equal(legal.reports[0].provider_call_ref, "pcall_ir");
  assert.deepEqual(legal.reports[0].message_indexes, [2]);
  assert.deepEqual(legal.reports[0].used_refs, ["chapter:current"]);
  assert.deepEqual(legal.reports[0].base_refs, ["chapter:current"]);

  const alteredContent = structuredClone(sessionMessages);
  alteredContent[0].blocks[0].content.goal.text = "被改写";
  const alteredVersion = structuredClone(sessionMessages);
  alteredVersion[0].versions.scope_revision += 1;
  const alteredSources = structuredClone(sessionMessages);
  alteredSources[0].source_refs = [{ ref: "chapter:forged" }];
  for (const [label, messages] of [
    ["missing", undefined],
    ["run-only", transcript.messages],
    ["missing prior Scope", sessionMessages.slice(1)],
    ["extra Scope", [priorScope, ...sessionMessages]],
    ["reordered Scope", [currentScope, priorReport, priorScope, currentAuthor, currentReport]],
    ["tampered prior content", alteredContent],
    ["tampered prior version", alteredVersion],
    ["tampered prior sources", alteredSources],
  ]) {
    const rejected = check(messages);
    assert.equal(rejected.ok, null, label);
    assert.equal(rejected.reason, "scope_provenance_unbound", label);
  }

  // 证明 Scope 来源及段头累计 refs 都不能补同次 Base。
  record.request_body.refs = {};
  const missingBase = check(sessionMessages);
  assert.equal(missingBase.ok, null);
  assert.equal(missingBase.reason, "request_base_refs_unavailable");
  assert.deepEqual(missingBase.reports[0].base_refs, []);
  record.request_body.refs = { base_refs: [] };
  assert.equal(check(sessionMessages).ok, false);
});

test("L7 canonical IR：当前请求 Base 登记与真实 observation 分账；Scope 来源不授信", () => {
  const legacy = irMessage("scope_update", "application",
    [{ type: "text", text: "## 材料与覆盖\n- chapter：chapter:legacy" }],
    { source_refs: [{ ref: "chapter:legacy" }] });
  const record = irRecord({
    baseRefs: [{ ref: "chapter:ch-ir" }, { ref: "plan:ir" }],
    messages: [
      irMessage("system", "application", [{ type: "text", text: "chapter:sys-ir" }]),
      legacy,
      irMessage(
        "application_base",
        "application",
        [{ type: "text", text: "【应用数据 · application_base】材料" }],
        { source_refs: [{ ref: "chapter:ch-ir" }] },
      ),
      irMessage(
        "scope_update",
        "application",
        [{ type: "scope", content: { context: {} } }],
        { source_refs: [{ ref: "plan:ir" }, { ref: "observation:obs_ir" }] },
      ),
      irMessage("user", "author", [{ type: "text", text: AUTHOR }]),
      irMessage("assistant", "model", [{ type: "tool_call", call_id: "call-ir", name: "read_chapter", arguments: {} }]),
      irMessage("tool", "tool_result", [
        { type: "observation", call_id: "call-ir", status: "ok", source_refs: ["chapter:obs-ir"], content: { text: "chapter:content-ir" } },
      ]),
    ],
  });
  const check = (refs) => {
    const sessionMessages = [
      ...structuredClone(record.request_body.messages),
      assistantCall({ pcall: "pcall_ir", prun: "prun_ir", refs }),
    ];
    return liveRefsCheck({ llmRecords: [record], transcript: { messages: sessionMessages }, sessionMessages });
  };
  const out = check(["chapter:ch-ir", "plan:ir", "observation:obs_ir", "chapter:obs-ir", "chapter:content-ir"]);
  assert.equal(out.ok, false);
  assert(out.reports[0].violations.some((violation) => violation.ref === "chapter:content-ir"));
  assert(out.reports[0].base_refs.includes("chapter:ch-ir"));
  assert(out.reports[0].base_refs.includes("plan:ir"));
  assert(!out.reports[0].observation_refs.includes("observation:obs_ir"));
  assert(out.reports[0].violations.some((violation) => violation.ref === "observation:obs_ir"));
  assert(out.reports[0].observation_refs.includes("chapter:obs-ir"));
  assert.equal(check(["chapter:ch-ir", "plan:ir", "chapter:obs-ir"]).ok, true);
  assert.equal(check(["observation:obs_ir"]).ok, false);
  const savedBase = record.request_body.refs;
  record.request_body.refs = {};
  assert.equal(check(["chapter:ch-ir"]).reason, "request_base_refs_unavailable");
  record.request_body.refs = savedBase;
  assert.equal(check(["chapter:legacy"]).ok, false);
  assert.deepEqual(record.request_body.messages[1], legacy);

  const split = irRecord({
    messages: [
      irMessage("application_base", "application", [{ type: "text", text: "材料" }], {
        source_refs: [{ ref: "obs_1" }],
      }),
      irMessage("user", "author", [{ type: "text", text: AUTHOR }]),
    ],
  });
  const splitResult = liveRefsCheck({
    sessionMessages: [],
    llmRecords: [split],
    transcript: { messages: [assistantCall({ pcall: "pcall_ir", prun: "prun_ir", refs: ["observation:obs_1"] })] },
  });
  assert.equal(splitResult.ok, false);
  assert(splitResult.reports[0].base_refs.includes("obs_1"));
  assert.deepEqual(splitResult.reports[0].observation_refs, []);
});

test("L7 自报只认 canonical assistant+model；格式坏记缺证", () => {
  const record = nativeRecord({ messages: [system(), appBase("材料 chapter:ch-1"), author()] });
  const fake = liveRefsCheck({
    sessionMessages: [],
    llmRecords: [record],
    transcript: {
      messages: [
        { ...assistantCall({ refs: ["chapter:ch-1"] }), provenance: "application" },
        { ...assistantCall({ refs: ["chapter:ch-1"] }), role: "tool" },
        { ...assistantCall({ refs: ["chapter:ch-1"] }), provenance: "author" },
        { role: "assistant", provenance: "model", blocks: [{ type: "observation", arguments: { self_report: { used_context_refs: ["chapter:ch-1"] } } }] },
      ],
    },
  });
  assert.equal(fake.ok, null);
  assert.equal(fake.sources.self_report_count, 0);
  assert.deepEqual(fake.reports, []);

  // 真实 B81 形状：self_report 只有 assumptions、没有 used_context_refs，不是坏自报。
  const ignored = liveRefsCheck({
    sessionMessages: [],
    llmRecords: [record],
    transcript: {
      messages: [
        {
          role: "assistant",
          provenance: "model",
          provider_call_ref: "pcall_1",
          provider_run_ref: "prun_1",
          blocks: [{ type: "tool_call", call_id: "call_a", arguments: { self_report: { assumptions: ["x"] } } }],
        },
        assistantCall({ refs: ["chapter:ch-1"] }),
      ],
    },
  });
  assert.equal(ignored.ok, true);
  assert.equal(ignored.reports.length, 1);
});

test("L7 完整 ref / 唯一观察：不拆 wrapper、不做子串匹配，重复 call 或 result 不算观察", () => {
  const messages = [realScope({ sourceRefs: ["execution_brief:chapter:ch-1"] })];
  const baseRefs = [{ ref: "execution_brief:chapter:ch-1" }];
  const wrapped = irResultOf({ messages, baseRefs, usedRefs: ["execution_brief:chapter:ch-1"] });
  assert.equal(wrapped.ok, true);
  const inner = irResultOf({ messages, baseRefs, usedRefs: ["chapter:ch-1"] });
  assert.equal(inner.ok, false);
  assert(inner.reports[0].violations.some((violation) => violation.ref === "chapter:ch-1"));

  const spaced = irResultOf({
    messages: [realScope({ sourceRefs: [" chapter:exact "] })],
    baseRefs: [{ ref: " chapter:exact " }],
    usedRefs: ["chapter:exact"],
  });
  assert.equal(spaced.ok, false);
  assert.deepEqual(spaced.reports[0].base_refs, [" chapter:exact "]);

  const base = [system(), appBase("材料 chapter:ch-1"), author()];
  assertViolation(
    [...base, assistantToolCall(), nativeObservation({ sourceRefs: ["observation:obs_dup_1"] }), nativeObservation({ sourceRefs: ["observation:obs_dup_1"] })],
    "observation:obs_dup_1",
    "duplicate result",
  );
  assertViolation(
    [...base, assistantToolCall(), assistantToolCall(), nativeObservation({ sourceRefs: ["observation:obs_dup_2"] })],
    "observation:obs_dup_2",
    "duplicate call",
  );

  assert.deepEqual([...extractRefTokens("x mychapter:ch-1 chapter:ch-1")].sort(), ["chapter:ch-1"]);
  assert.deepEqual([...extractRefTokens("x xas_live_1 as_live_1")].sort(), ["as_live_1"]);
});

test("L7 同请求 observation 身份：content.observation_ref 与 source_refs 同边界，报告保留 call_id", () => {
  const messages = [
    system(),
    appBase("材料 chapter:ch-1"),
    author(),
    assistantToolCall({ callId: "call_page" }),
    nativeObservation({
      callId: "call_page",
      sourceRefs: ["chapter:ch-1"],
      content: { observation_ref: "observation:obs_page_1" },
    }),
  ];
  const result = resultOf({ messages, usedRefs: ["observation:obs_page_1"] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  const match = result.reports[0].matched_refs.find(
    (entry) => entry.ref === "observation:obs_page_1",
  );
  assert.deepEqual(
    [match.kind, match.sources[0].call_id, match.sources[0].status, match.sources[0].channel],
    ["observation", "call_page", "ok", "content_observation_ref"],
  );
  assert(result.reports[0].observation_refs.includes("chapter:ch-1"));
  assert(result.reports[0].observation_refs.includes("observation:obs_page_1"));

  const viaIr = liveRefsCheck({
    sessionMessages: [],
    llmRecords: [
      irRecord({
        messages: [
          irMessage("user", "author", [{ type: "text", text: AUTHOR }]),
          irMessage("assistant", "model", [
            { type: "tool_call", call_id: "call-ir-page", name: "read_chapter", arguments: {} },
          ]),
          irMessage("tool", "tool_result", [
            {
              type: "observation",
              call_id: "call-ir-page",
              status: "ok",
              source_refs: [],
              content: { observation_ref: "observation:obs-ir-page" },
            },
          ]),
        ],
      }),
    ],
    transcript: {
      messages: [
        assistantCall({
          pcall: "pcall_ir",
          prun: "prun_ir",
          refs: ["observation:obs-ir-page"],
        }),
      ],
    },
  });
  assert.equal(viaIr.ok, true);

  // 身份只在本请求的合法 observation 内兑现；别的请求/非 observation: 身份/文本都不授信。
  const other = liveRefsCheck({
    sessionMessages: [],
    llmRecords: [
      nativeRecord({ providerCallRef: "pcall_1", providerRunRef: "prun_1", messages }),
      nativeRecord({
        providerCallRef: "pcall_other",
        providerRunRef: "prun_other",
        messages: [
          system(),
          assistantToolCall({ callId: "call_other" }),
          nativeObservation({
            callId: "call_other",
            content: { observation_ref: "observation:obs_other" },
          }),
        ],
      }),
    ],
    transcript: { messages: [assistantCall({ refs: ["observation:obs_other"] })] },
  });
  assert.equal(other.ok, false);
  assert(other.reports[0].violations.some((violation) => violation.ref === "observation:obs_other"));

  const base = [system(), appBase("材料 chapter:ch-1"), author()];
  for (const [label, content] of [
    ["非 observation: 身份", { observation_ref: "chapter:identity_only" }],
    ["content 文本", { text: "observation:obs_text_only" }],
    ["非对象 content", "observation:obs_string_content"],
  ]) {
    assertViolation(
      [
        ...base,
        assistantToolCall({ callId: "call_content" }),
        nativeObservation({ callId: "call_content", content }),
      ],
      label === "非 observation: 身份" ? "chapter:identity_only" : label === "content 文本" ? "observation:obs_text_only" : "observation:obs_string_content",
      label,
    );
  }

  assertViolation(
    [
      ...base,
      assistantToolCall({ callId: "call_failed" }),
      nativeObservation({
        callId: "call_failed",
        status: "failed",
        content: { observation_ref: "observation:obs_failed_identity" },
      }),
    ],
    "observation:obs_failed_identity",
    "失败 observation 身份",
  );
});

test("L7 planned_exploration 聚合：ok/partial 父只授信 ok 叶自己的 refs，报告记同一父 call_id", () => {
  const good = observationLeaf({
    sourceRefs: ["chapter:leaf_ok"],
    observationRef: "observation:obs_leaf_ok",
  });
  const bad = observationLeaf({
    status: "unavailable",
    sourceRefs: ["chapter:leaf_bad"],
    observationRef: "observation:obs_leaf_bad",
  });
  const messages = [
    system(),
    appBase("材料 chapter:ch-1"),
    author(),
    assistantToolCall({ callId: "call_agg" }),
    nativePlannedObservation({ callId: "call_agg", status: "partial", leaves: [good, bad] }),
  ];
  const result = resultOf({
    messages,
    usedRefs: ["chapter:leaf_ok", "observation:obs_leaf_ok"],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reports[0].observation_refs, ["chapter:leaf_ok", "observation:obs_leaf_ok"]);
  assert.deepEqual(
    result.reports[0].matched_refs.map((match) => [
      match.ref,
      match.sources[0].channel,
      match.sources[0].call_id,
      match.sources[0].status,
    ]),
    [
      ["chapter:leaf_ok", "source_refs", "call_agg", "ok"],
      ["observation:obs_leaf_ok", "content_observation_ref", "call_agg", "ok"],
    ],
  );
  // 父块合并的 source_refs 与不可用叶自己的 ref 都不能代签。
  assert(!result.reports[0].observation_refs.includes("chapter:leaf_bad"));
  assertViolation(messages, "chapter:leaf_bad", "不可用叶来源");
  assertViolation(messages, "observation:obs_leaf_bad", "不可用叶身份");
});

test("L7 planned_exploration 父不可用/重复/未绑定时不授信任何叶", () => {
  const leaf = () => observationLeaf({
    sourceRefs: ["chapter:leaf_ok"],
    observationRef: "observation:obs_leaf_ok",
  });
  const base = [system(), appBase("材料 chapter:ch-1"), author(), assistantToolCall({ callId: "call_agg" })];
  for (const [label, messages] of [
    ["父不可用", [...base, nativePlannedObservation({ callId: "call_agg", status: "unavailable", leaves: [leaf()] })]],
    ["父未绑定", [...base, nativePlannedObservation({ callId: "call_agg", outerCallId: "call_other", leaves: [leaf()] })]],
    ["重复父结果", [...base, nativePlannedObservation({ callId: "call_agg", leaves: [leaf()] }), nativePlannedObservation({ callId: "call_agg", leaves: [leaf()] })]],
  ]) {
    assertViolation(messages, "chapter:leaf_ok", label);
  }
});
