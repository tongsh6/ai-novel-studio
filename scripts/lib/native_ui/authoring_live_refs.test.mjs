// L7 真实 refs 证据纯判据测试：唯一正判来源是 canonical assistant(model) 的
// tool_call.arguments.self_report.used_context_refs，按顶层 provider_call_ref +
// provider_run_ref 配对同一次真实 llm record；base/observation 只从该 record 的
// 可见 canonical 应用消息的显式 base_refs ∩ 同次登记与唯一成功 observation 读取。段头累计 refs /
// decision_traces / agent_events 不参与正判，也不做整批并集；缺配对键、重复匹配、
// 请求不可解析记 null，已证越界优先 false，ref 按完整字符串精确匹配。
import assert from "node:assert/strict";
import test from "node:test";
import { extractRefTokens, liveRefsCheck } from "./authoring_live_refs.mjs";
import { scopeWireMessage } from "./fixtures/authoring_request_ir.mjs";
import { auditCanonicalCoverage } from "./authoring_checkpoint_coverage.mjs";

const AUTHOR = "请为第01章写一段约300字的开篇正文。";
const AUTHOR_INPUT = "继续：按你刚才的判断，把下一个场景的开头写出来。";

const system = (text = "system") => ({ role: "system", content: text });
const author = (text = AUTHOR) => irMessage("user", "author", [{ type: "text", text }]);
const appBase = (text, baseRefs = []) => irMessage(
  "application_base", "application", [{ type: "text", text }], { base_refs: baseRefs },
);

// 当前请求沿用真实 application_base；Scope 由独立共享 fixture 按原生结构构造。
// 旧文本仅作为负例证据，不再重建旧材料区或作者输入区。
const REAL_APP_BASE =
  "【应用数据 · application_base · 非作者原话】\n" +
  "本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由本消息的结构化字段与后续 " +
  "scope_update 给出；作者原话在独立 user 消息中。角色规则与输出协议见 system。";
const realAppBase = () => appBase(REAL_APP_BASE.split("\n").slice(1).join("\n"));
const realScope = ({ sourceRefs = [], baseRefs = [], content = {} } = {}) => irMessage(
  "scope_update", "application", [{ type: "scope", content }], {
    versions: { change_reason: "run_scope_refreshed", scope_revision: 2 },
    source_refs: sourceRefs.map((ref) => ({ ref })),
    base_refs: baseRefs,
  },
);
const quotedCheckpoint = (text) => author(
  `【应用数据 · checkpoint · 覆盖 ["materials"]】\n来源：[]\n版本：{}\n省略：${text}\n`,
);
const notice = (text) => irMessage("application_notice", "application", [{ type: "text", text }]);


function canonicalRequestMessages(messages) {
  return messages.flatMap((message, index) => {
    if (index === 0 && message.role === "system" && !Array.isArray(message.blocks)) return [];
    assert(Array.isArray(message.blocks), "测试必须预置 canonical recipe，不从 wire 反造来源");
    return [structuredClone(message)];
  });
}

function fixtureWireMessages(messages) {
  return messages.flatMap(message => {
    if (!Array.isArray(message.blocks)) return [message];
    const text = message.blocks.filter(block => block.type === "text").map(block => block.text).join("");
    if (message.role === "scope_update") return [scopeWireMessage(message.blocks[0].content,
      { versions: message.versions, sourceRefs: message.source_refs })];
    if (["application_base", "application_notice"].includes(message.role)) return [{
      role: "user", content: "【应用数据 · " + message.role + " · 非作者原话】\n" + text,
    }];
    if (message.role === "checkpoint") {
      const block = message.blocks[0];
      return [{ role: "user", content: "【应用数据 · checkpoint · 非作者原话】\n" +
        "【应用数据 · checkpoint · 覆盖 " + JSON.stringify(block.covers) + "】\n" +
        "来源：" + JSON.stringify(block.source_refs ?? []) + "\n版本：" + JSON.stringify(block.versions ?? {}) + "\n" +
        ((block.omissions ?? []).length ? "省略：" + block.omissions.join("; ") + "\n" : "") + (block.summary ?? "") }];
    }
    if (message.role === "tool") return message.blocks.map(block =>
      ({ role: "tool", tool_call_id: block.call_id, content: JSON.stringify(block) }));
    if (message.role === "assistant") {
      const calls = message.blocks.filter(block => block.type === "tool_call");
      return [{ role: "assistant", content: text,
        ...(calls.length ? { tool_calls: calls.map(block => ({ id: block.call_id, type: "function",
          function: { name: block.name, arguments: block.raw_arguments ?? JSON.stringify(block.arguments) } })) } : {}) }];
    }
    return [{ role: message.role, content: text }];
  });
}

function nativeRecord({ providerCallRef = "pcall_1", providerRunRef = "prun_1", messages } = {}) {
  return {
    provider: "strata",
    turn_id: "turn_1",
    provider_call_ref: providerCallRef,
    provider_run_ref: providerRunRef,
    request: { body: { messages: fixtureWireMessages(messages) } },
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
  return irMessage("assistant", "model", [
    { type: "tool_call", call_id: callId, name: "read_chapter", arguments: {} },
  ]);
}

function nativeObservation({ callId = "call_1", type = "observation", status = "ok", sourceRefs = [], content = { summary: "已读取本页材料。", facts: {} } } = {}) {
  return irMessage("tool", "tool_result", [{
    type, call_id: callId, status, source_refs: sourceRefs,
    ...(content === null ? {} : { content }),
  }]);
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

function nativePlannedObservation({ callId = "call_1", status = "ok", leaves = [] } = {}) {
  return irMessage("tool", "tool_result", [{
    type: "observation", call_id: callId, status,
    source_refs: [...new Set(leaves.flatMap(leaf => leaf.source_refs))],
    versions: {}, coverage: {}, omissions: [], next_offset: null,
    content: { tool: "planned_exploration",
      query: leaves.map(leaf => leaf.content.tool).join(" / "),
      summary: `计划内只读检索完成（${leaves.length} 次）`, observations: leaves },
  }]);
}

function irRecord({ providerCallRef = "pcall_ir", providerRunRef = "prun_ir", messages, baseRefs, observationRefs = [] } = {}) {
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
      refs: { ...(baseRefs === undefined ? {} : { base_refs: baseRefs }), observation_refs: observationRefs },
    },
  };
}

const irMessage = (role, provenance, blocks, extra = {}) => ({
  role,
  provenance,
  blocks,
  source_refs: [],
  base_refs: [],
  versions: {},
  ...extra,
});

function resultOf({ messages, usedRefs, baseRefs = [], pcall = "pcall_1", prun = "prun_1" }) {
  const sessionMessages = [
    ...canonicalRequestMessages(messages),
    assistantCall({ pcall, prun, refs: usedRefs }),
  ];
  const record = nativeRecord({ providerCallRef: pcall, providerRunRef: prun, messages });
  record.request.refs = { base_refs: baseRefs, observation_refs: [], used_refs: [] };
  return liveRefsCheck({
    llmRecords: [record],
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


// Base 供应的独立历史：原材料、两次明确覆盖和可选再次供应都先冻结，
// 不从 reader 输出构造预期；wire 只包含 coverage oracle 已验证的留存 Scope。
function baseCoverageFixture({ rebind = false, coverAgain = false } = {}) {
  const ref = "chapter:base-supply";
  const coordinate = (runId, sequence) => ({
    workspace_id: "work-base-coverage", work_id: "work-base-coverage", session_id: "session-base-coverage",
    parent_turn_ref: "turn-" + runId, run_id: runId, run_sequence: sequence,
    run_status: runId === "old" || (coverAgain && runId === "current") ? "completed" : "running",
  });
  const authorMessage = (runId, text) => irMessage("user", "author", [{ type: "text", text }], {
    source_refs: [{ ref: "turn-" + runId, version: 1 }], canonical_ref: coordinate(runId, 1),
  });
  const materialScope = (runId, version, supplied) => irMessage("scope_update", "application", [{
    type: "scope", content: supplied ? { material: { text: "第 " + version + " 次实际供应的正文。" } }
      : { goal: { text: "本请求没有重新供应旧材料。" } },
  }], {
    source_refs: supplied ? [{ ref, version }] : [],
    base_refs: supplied ? [{ ref, version }] : [],
    versions: { scope_revision: version }, canonical_ref: coordinate(runId, 2),
  });
  const covering = (runId, source) => {
    const selector = { run_id: source.canonical_ref.run_id, run_sequence: source.canonical_ref.run_sequence,
      role: source.role, source_refs: source.source_refs, versions: source.versions };
    return irMessage("checkpoint", "application", [{
      type: "checkpoint", covers: { call_ids: [], message_refs: [selector] },
      source_refs: [...source.source_refs, { ref: "session_message:" + selector.run_id + ":" + selector.run_sequence, version: 1 }],
      versions: {}, omissions: ["旧范围被本次明确覆盖，正文不再供应。"],
    }], { base_refs: [], canonical_ref: coordinate(runId, 3) });
  };
  const old = materialScope("old", 1, true);
  const current = materialScope("current", 2, rebind);
  const messages = [
    authorMessage("old", "核对早前材料。"), old,
    authorMessage("current", "继续处理本次任务。"), current, covering("current", old),
  ];
  if (coverAgain) {
    messages.push(authorMessage("latest", "结束本轮材料使用。"), materialScope("latest", 3, false),
      covering("latest", current));
  }
  const rawBytes = JSON.stringify(messages);
  const coverage = auditCanonicalCoverage(messages);
  assert.equal(coverage.ok, true, coverage.reason);
  assert.equal(coverage.retainedMessages.includes(old), false);
  assert.equal(coverage.retainedMessages.includes(current), !coverAgain);
  const record = nativeRecord({ messages: coverage.retainedMessages });
  record.request.refs = { base_refs: [{ ref, version: 1 }], observation_refs: [], used_refs: [ref] };
  const reply = assistantCall({ refs: [ref] });
  return {
    ref, messages, rawBytes, record, coverage,
    check: () => liveRefsCheck({ llmRecords: [record], transcript: { messages: [reply] },
      sessionMessages: [...messages, reply] }),
  };
}

test("R05 Base：目录和 source_refs 只有关联意义，明确空绑定拒绝，缺绑定保持未知", () => {
  const ref = "chapter:catalog-only";
  const scope = realScope({ sourceRefs: [ref], content: { goal: { text: "讨论当前目标。" } } });
  scope.base_refs = [];
  const supplied = [scope];
  assert.equal(irResultOf({ messages: supplied, baseRefs: [{ ref }], usedRefs: [ref] }).ok, false);
  const missing = structuredClone(scope);
  delete missing.base_refs;
  const unknown = irResultOf({ messages: [missing], baseRefs: [{ ref }], usedRefs: [ref] });
  assert.equal(unknown.ok, null);
  const duty = irMessage("application_base", "application", [{ type: "text", text: "只声明应用职责，关联 " + ref }], {
    source_refs: [{ ref }], base_refs: [],
  });
  assert.equal(irResultOf({ messages: [duty], baseRefs: [{ ref }], usedRefs: [ref] }).ok, false);
});

test("R05 Base：已覆盖 Scope 的绑定仍留目录，但实际 wire 不再供应，必须拒绝", () => {
  const fixture = baseCoverageFixture();
  const result = fixture.check();
  assert.equal(result.ok, false);
  assert.deepEqual(result.reports[0].base_refs, []);
  assert.deepEqual(result.reports[0].violations, [{ ref: fixture.ref }]);
  assert.equal(JSON.stringify(fixture.messages), fixture.rawBytes);
});

test("R05 Base：同 ref 在另一条可见材料消息明确再次供应，保留其使用资格", () => {
  const fixture = baseCoverageFixture({ rebind: true });
  const result = fixture.check();
  assert.equal(result.ok, true);
  assert.deepEqual(result.reports[0].base_refs, [fixture.ref]);
  assert.equal(JSON.stringify(fixture.messages), fixture.rawBytes);
});

test("R05 Base：再次供应的 Scope 也被后续合法覆盖后，不得由旧目录复活", () => {
  const fixture = baseCoverageFixture({ rebind: true, coverAgain: true });
  const result = fixture.check();
  assert.equal(result.ok, false);
  assert.deepEqual(result.reports[0].base_refs, []);
  assert.deepEqual(result.reports[0].violations, [{ ref: fixture.ref }]);
  assert.equal(JSON.stringify(fixture.messages), fixture.rawBytes);
});


for (const [label, options, expected] of [
  ["覆盖旧 Scope", {}, false],
  ["可见 Scope 再供", { rebind: true }, true],
  ["再次覆盖", { rebind: true, coverAgain: true }, false],
]) {
  test("R05 Base：原始 IR 保留历史，按同一覆盖事实读取当前资格：" + label, () => {
    const fixture = baseCoverageFixture(options);
    const result = irResultOf({ messages: fixture.messages, baseRefs: [{ ref: fixture.ref, version: 1 }],
      usedRefs: [fixture.ref] });
    assert.equal(result.ok, expected);
    assert.deepEqual(result.reports[0].base_refs, expected ? [fixture.ref] : []);
    assert.equal(JSON.stringify(fixture.messages), fixture.rawBytes);
  });
}

test("R05 Base：完整消息顺序、实际正文与同次绑定逐项对账，目录不代签", () => {
  const base = appBase("首份实际正文\n  保留空格", [{ ref: "chapter:body-a", version: 2 }]);
  const second = appBase("第二份实际正文", [{ ref: "chapter:body-b", version: 4 }]);
  const call = assistantCall({ refs: ["chapter:body-a"] });
  const sessionMessages = [base, second, call];
  const record = nativeRecord({ messages: [base, second] });
  record.request.refs = { base_refs: [{ ref: "chapter:body-a", version: 1 }, "chapter:body-b"],
    observation_refs: [], used_refs: [] };
  const check = (actual = record, canonical = sessionMessages) => liveRefsCheck({
    llmRecords: [actual], transcript: { messages: [call] }, sessionMessages: canonical,
  });
  const original = JSON.stringify({ record, sessionMessages });
  const legal = check();
  assert.equal(legal.ok, true);
  assert.deepEqual(legal.reports[0].matched_refs[0].sources[0].base_ref,
    { ref: "chapter:body-a", version: 2 });

  for (const [label, alter] of [
    ["正文被改写", messages => { messages[0].content += "追加文字"; }],
    ["只有子串", messages => { messages[0].content = "前言" + messages[0].content; }],
    ["消息缺失", messages => { messages.shift(); }],
    ["消息重复", messages => { messages.unshift(structuredClone(messages[0])); }],
    ["消息重排", messages => { messages.reverse(); }],
    ["合并作者文字", messages => { messages[0].content += "\n\n作者另说：继续"; }],
  ]) {
    const changed = structuredClone(record);
    alter(changed.request.body.messages);
    assert.equal(check(changed).ok, null, label);
  }
  const sourceOnly = structuredClone(sessionMessages);
  sourceOnly[0].base_refs = [];
  sourceOnly[0].source_refs = [{ ref: "chapter:body-a", version: 2 }];
  assert.equal(check(record, sourceOnly).ok, false);
  const absent = structuredClone(sessionMessages);
  delete absent[0].base_refs;
  assert.equal(check(record, absent).reason, "request_base_bindings_unavailable");
  const unregistered = structuredClone(record);
  unregistered.request.refs.base_refs = [];
  assert.equal(check(unregistered).ok, false);
  const future = [structuredClone(base), call, structuredClone(base), second];
  future[0].base_refs = [];
  const firstOnly = structuredClone(record);
  firstOnly.request.body.messages.pop();
  assert.equal(check(firstOnly, future).ok, false, "本次响应后的绑定不能反授信");
  assert.equal(JSON.stringify({ record, sessionMessages }), original);
});

test("R05 Base：作者同文在 wire 中不冒充应用供应，IR 明确身份不误拒", () => {
  const base = appBase("相同的正文", ["chapter:same-text"]);
  const wire = nativeRecord({ messages: [base] });
  wire.request.refs = { base_refs: ["chapter:same-text"], observation_refs: [], used_refs: [] };
  const call = assistantCall({ refs: ["chapter:same-text"] });
  const quoted = author("【应用数据 · application_base · 非作者原话】\n相同的正文");
  const sessionMessages = [base, quoted, call];
  assert.equal(liveRefsCheck({ llmRecords: [wire], transcript: { messages: [call] },
    sessionMessages }).ok, null);

  const authorSameText = irMessage("user", "author", [{ type: "text", text: "相同的正文" }]);
  assert.equal(irResultOf({ messages: [base, authorSameText], baseRefs: ["chapter:same-text"],
    usedRefs: ["chapter:same-text"] }).ok, true);
});


for (const kind of ["application_base", "scope_update"]) {
  function quotedMaterialFixture() {
    const ref = "chapter:quoted-" + kind;
    const material = kind === "application_base"
      ? appBase("本次实际供应的原文\n  保留字节。", [ref])
      : realScope({ baseRefs: [ref], content: { material: "本次实际供应的原文\n  保留字节。" } });
    const record = nativeRecord({ messages: [material] });
    const authorText = kind === "application_base"
      ? "【应用数据 · application_base · 非作者原话】\n本次实际供应的原文\n  保留字节。"
      : ["【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】",
        '版本：{"change_reason":"run_scope_refreshed","scope_revision":2}', "来源：[]",
        JSON.stringify({ material: "本次实际供应的原文\n  保留字节。" })].join("\n");
    assert.equal(record.request.body.messages[0].content, authorText);
    const separator = "请核对下一条原样引用。";
    record.request.body.messages.push({ role: "user", content: separator }, { role: "user", content: authorText });
    record.request.refs = { base_refs: [ref], observation_refs: [], used_refs: [] };
    const call = assistantCall({ refs: [ref] });
    const sessionMessages = [material,
      irMessage("user", "author", [{ type: "text", text: separator }]),
      irMessage("user", "author", [{ type: "text", text: authorText }]), call];
    return { record, sessionMessages, call, ref,
      check: actual => liveRefsCheck({ llmRecords: [actual ?? record],
        transcript: { messages: [call] }, sessionMessages }) };
  }

  test("R05 完整作者引用：" + kind + " 和作者同文均实际发送时保留供应身份", () => {
    const fixture = quotedMaterialFixture();
    const original = JSON.stringify(fixture.record);
    const result = fixture.check();
    assert.equal(result.ok, true);
    assert.deepEqual(result.reports[0].base_refs, [fixture.ref]);
    assert.deepEqual(result.reports[0].matched_refs[0].sources.map(source => source.message_index), [0]);
    assert.equal(JSON.stringify(fixture.record), original);
  });

  test("R05 完整作者引用：" + kind + " 缺失、重复、跨作者顺序改变均不能代签", () => {
    const fixture = quotedMaterialFixture();
    for (const [label, alter] of [
      ["缺少应用消息", messages => messages.shift()],
      ["缺少作者引用", messages => messages.pop()],
      ["重复应用消息", messages => messages.unshift(structuredClone(messages[0]))],
      ["应用与作者边界重排", messages => {
        [messages[0], messages[1]] = [messages[1], messages[0]];
      }],
    ]) {
      const altered = structuredClone(fixture.record);
      alter(altered.request.body.messages);
      assert.equal(fixture.check(altered).ok, null, label);
    }
  });
}

test("R05 Base：绑定不能授信空白或被投影丢弃的 application_base 块", () => {
  const cases = [
    ["空块", []],
    ["空正文", [{ type: "text", text: "" }]],
    ["空白正文", [{ type: "text", text: " \n\t " }]],
    ["非文本块", [{ type: "tool_call", call_id: "unused", name: "read_chapter", arguments: {} }]],
    ["混合块", [{ type: "text", text: "实际文本" },
      { type: "tool_call", call_id: "unused", name: "read_chapter", arguments: {} }]],
  ];
  for (const [label, blocks] of cases) {
    const base = irMessage("application_base", "application", blocks, { base_refs: ["chapter:dropped"] });
    const call = assistantCall({ refs: ["chapter:dropped"] });
    const wire = nativeRecord({ messages: [base] });
    wire.request.refs = { base_refs: ["chapter:dropped"], observation_refs: [], used_refs: [] };
    const native = liveRefsCheck({ llmRecords: [wire], transcript: { messages: [call] },
      sessionMessages: [base, call] });
    assert.equal(native.ok, null, label + " wire");
    assert.equal(native.reason, "base_material_not_projectable", label + " wire");
    const ir = irResultOf({ messages: [base], baseRefs: ["chapter:dropped"], usedRefs: ["chapter:dropped"] });
    assert.equal(ir.ok, null, label + " IR");
    assert.equal(ir.reason, "base_material_not_projectable", label + " IR");
  }
});

test("R05 成功状态与引用不能替代实际材料，真实空读摘要或零计数仍可使用", () => {
  const ref = "chapter:read-result";
  const check = (content) => resultOf({
    messages: [system(), author(), assistantToolCall(), nativeObservation({ sourceRefs: [ref], content })],
    usedRefs: [ref],
  });
  for (const content of [null, {}, { tool: "chapter_read", query: "仅索引", facts: {} }]) {
    assert.equal(check(content).ok, false);
  }
  for (const content of ["本页实际正文", { summary: "这一章尚未保存正文。", facts: {} }, { facts: { saved_count: 0 } }]) {
    assert.equal(check(content).ok, true);
  }
});

test("R05 现役 Scope 的实际成功观察还须在同次引用目录登记", () => {
  const ref = "chapter:registered-read";
  const scope = realScope();
  const supplied = [scope, assistantToolCall(), nativeObservation({ sourceRefs: [ref] })];
  const record = nativeRecord({ messages: supplied });
  const call = assistantCall({ refs: [ref] });
  const messages = [...canonicalRequestMessages(supplied), call];
  const check = (observationRefs) => {
    record.request.refs = { base_refs: [], observation_refs: observationRefs, used_refs: [] };
    return liveRefsCheck({ llmRecords: [record], transcript: { messages }, sessionMessages: messages });
  };
  assert.equal(check([ref]).ok, true);
  assert.equal(check([{ ref }]).ok, true);
  assert.equal(check([]).ok, false);
});

test("R05 IR压缩覆盖的旧观察仍留历史目录，但不得作为同次已供应材料授信", () => {
  const sourceRef = "chapter:covered-read";
  const observationRef = "observation:covered-read";
  const baseRef = "chapter:current-base";
  const coordinate = (runId, sequence) => ({
    workspace_id: "work-ref-coverage", work_id: "work-ref-coverage", session_id: "session-ref-coverage",
    parent_turn_ref: "turn-" + runId, run_id: runId, run_sequence: sequence,
    run_status: runId === "old" ? "completed" : "running",
  });
  const scope = realScope({ sourceRefs: [baseRef], baseRefs: [baseRef] });
  scope.canonical_ref = coordinate("current", 2);
  const original = [
    irMessage("user", "author", [{ type: "text", text: "读取旧章。" }], {
      source_refs: [{ ref: "turn-old", version: 1 }], canonical_ref: coordinate("old", 1),
    }),
    irMessage("assistant", "model", [{
      type: "tool_call", call_id: "covered-call", name: "judgment_decision",
      arguments: { action: "explore", explore_request: { tool: "chapter_read", query: "旧章" } },
    }], { canonical_ref: coordinate("old", 2) }),
    irMessage("tool", "tool_result", [{
      type: "observation", call_id: "covered-call", status: "ok",
      source_refs: [sourceRef], versions: { "draft:old": 1 }, coverage: {}, omissions: [], next_offset: null,
      content: { summary: "旧请求实际读取的正文。", observation_ref: observationRef },
    }], { canonical_ref: coordinate("old", 3) }),
    irMessage("user", "author", [{ type: "text", text: "处理当前章节。" }], {
      source_refs: [{ ref: "turn-current", version: 1 }], canonical_ref: coordinate("current", 1),
    }),
    scope,
  ];
  const checkpointMessage = irMessage("checkpoint", "application", [{
    type: "checkpoint", covers: { call_ids: ["covered-call"], message_refs: [] },
    source_refs: [sourceRef], versions: { "draft:old": 1 },
    omissions: ["旧工具交换由本 checkpoint 覆盖；原始历史保留。"],
  }], { canonical_ref: coordinate("current", 3) });
  const messages = [...original, checkpointMessage];
  const originalBytes = JSON.stringify(messages);
  const coverage = auditCanonicalCoverage(messages);
  assert.equal(coverage.ok, true, coverage.reason);
  assert.deepEqual(coverage.coveredCallIds, ["covered-call"]);
  assert.equal(coverage.retainedMessages.includes(original[2]), false);

  const check = (requestMessages, usedRefs) => {
    const report = assistantCall({ pcall: "pcall_ir", prun: "prun_ir", refs: usedRefs });
    return liveRefsCheck({
      llmRecords: [irRecord({ messages: requestMessages, baseRefs: [baseRef],
        observationRefs: [sourceRef, observationRef] })],
      transcript: { messages: [report] }, sessionMessages: [...requestMessages, report],
    });
  };
  assert.equal(check(original, [sourceRef, observationRef]).ok, true);
  const covered = check(messages, [sourceRef, observationRef]);
  assert.equal(covered.ok, false);
  assert.deepEqual(covered.reports[0].observation_refs, []);
  assert.deepEqual(covered.reports[0].violations.map(entry => entry.ref).sort(), [sourceRef, observationRef].sort());
  assert.equal(check(messages, [baseRef]).ok, true);
  assert.equal(JSON.stringify(messages), originalBytes);

  const malformedCoverage = structuredClone(messages);
  malformedCoverage.at(-1).blocks[0].covers.call_ids = ["absent-call"];
  const unknown = check(malformedCoverage, [baseRef]);
  assert.equal(unknown.ok, null);
  assert.equal(unknown.reason, "request_coverage_invalid");
});

test("R05观察身份按完整字符串精确匹配，不修剪后替同次登记兑现引用", () => {
  const ref = "observation:exact-read";
  const scope = realScope();
  const check = (identity, registeredRef = ref) => {
    const report = assistantCall({ refs: [registeredRef] });
    const supplied = [scope, assistantToolCall(), nativeObservation({
      content: { summary: "本次实际读取的正文。", observation_ref: identity },
    })];
    const record = nativeRecord({ messages: supplied });
    record.request.refs = { base_refs: [], observation_refs: [registeredRef], used_refs: [] };
    return liveRefsCheck({ llmRecords: [record], transcript: { messages: [report] },
      sessionMessages: [...canonicalRequestMessages(supplied), report] });
  };
  assert.equal(check(ref).ok, true);
  for (const identity of [" " + ref, ref + " "]) {
    const result = check(identity);
    assert.equal(result.ok, false);
    assert.deepEqual(result.reports[0].violations, [{ ref }]);
  }
  assert.equal(check(ref + " ", ref + " ").ok, true);
  assert.equal(check(" " + ref, " " + ref).ok, false);
});

test("R05 partial真实观察可被引用但仍保留partial，不声称完整全文", () => {
  const messages = [
    system(), author(), assistantToolCall({ callId: "call-partial" }),
    nativeObservation({ callId: "call-partial", status: "partial",
      sourceRefs: ["memory:page"], content: {
        tool: "memory_recall", summary: "只读到本页",
        observation_ref: "observation:memory-page",
      } }),
  ];
  const actual = resultOf({ messages, usedRefs: ["memory:page", "observation:memory-page"] });
  assert.equal(actual.ok, true);
  const report = actual.reports[0];
  assert.deepEqual(report.base_refs, []);
  assert.deepEqual(report.observation_refs, ["memory:page", "observation:memory-page"]);
  for (const entry of report.matched_refs) {
    assert(entry.sources.some((source) => source.call_id === "call-partial" && source.status === "partial"));
  }
});

test("R05 truncated观察仅授已供应部分，保留截断状态与原始覆盖", () => {
  const observed = nativeObservation({
    callId: "call-truncated", status: "truncated", sourceRefs: ["memory:truncated-page"],
    content: { tool: "memory_recall", summary: "只提供前半段",
      observation_ref: "observation:truncated-page" },
  });
  const payload = observed.blocks[0];
  payload.coverage = { offset: 0, "complete?": false, returned_chars: 6, total_chars: 12 };
  payload.omissions = ["后半段尚未提供"];
  payload.next_offset = 6;
  const messages = [system(), author(), assistantToolCall({ callId: "call-truncated" }), observed];
  const before = JSON.stringify(messages);

  const result = resultOf({
    messages, usedRefs: ["memory:truncated-page", "observation:truncated-page"],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reports[0].observation_refs,
    ["memory:truncated-page", "observation:truncated-page"]);
  for (const match of result.reports[0].matched_refs) {
    assert(match.sources.every((source) =>
      source.call_id === "call-truncated" && source.status === "truncated"));
  }
  assertViolation(messages, "memory:unread-remainder", "截断不授未提供的后半段");
  assert.equal(JSON.stringify(messages), before);
  assert.equal(observed.blocks[0].coverage["complete?"], false);
  assert.equal(observed.blocks[0].next_offset, 6);
});

test("R05 truncated聚合父叶各自检查，stale或unavailable不能借另一层授信", () => {
  const usedRefs = ["chapter:truncated-leaf", "observation:truncated-leaf"];
  const messagesFor = (parentStatus, leafStatus) => [
    system(), author(), assistantToolCall({ callId: "call-truncated-parent" }),
    nativePlannedObservation({
      callId: "call-truncated-parent", status: parentStatus,
      leaves: [observationLeaf({
        status: leafStatus, sourceRefs: ["chapter:truncated-leaf"],
        observationRef: "observation:truncated-leaf",
      })],
    }),
  ];

  for (const parentStatus of ["ok", "partial", "truncated"]) {
    for (const leafStatus of ["ok", "partial", "truncated"]) {
      const messages = messagesFor(parentStatus, leafStatus);
      const before = JSON.stringify(messages);
      const result = resultOf({ messages, usedRefs });
      assert.equal(result.ok, true, `parent=${parentStatus}, leaf=${leafStatus}`);
      assert.deepEqual(result.reports[0].observation_refs, usedRefs);
      assert(result.reports[0].matched_refs.every((match) =>
        match.sources.every((source) => source.status === leafStatus)));
      assert.equal(JSON.stringify(messages), before);
    }
  }

  for (const unavailable of ["stale", "unavailable"]) {
    for (const [parentStatus, leafStatus] of [
      [unavailable, "truncated"], ["truncated", unavailable],
    ]) {
      for (const ref of usedRefs) {
        assertViolation(messagesFor(parentStatus, leafStatus), ref,
          `parent=${parentStatus}, leaf=${leafStatus}`);
      }
    }
  }
});

test("L7 逐调用：A 的 ref 只在 B 的请求/整批事件/段头出现 → false，无 pcall/prun 或记录不唯一 → null", () => {
  const baseA = appBase("材料 chapter:ch-base", ["chapter:ch-base"]);
  const recordA = nativeRecord({
    providerCallRef: "pcall_A",
    providerRunRef: "prun_A",
    messages: [system(), baseA, author()],
  });
  recordA.request.refs = { base_refs: ["chapter:ch-base"], observation_refs: [], used_refs: [] };
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
  const reportA = assistantCall({ pcall: "pcall_A", prun: "prun_A", refs: ["observation:obs_b"] });
  const result = liveRefsCheck({
    sessionMessages: [...canonicalRequestMessages([baseA, author()]), reportA],
    llmRecords: [recordA, recordB],
    transcript: {
      messages: [reportA],
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
    appBase("材料 chapter:ch-1；artifact as_live_1；执行简述 execution_brief:chapter:ch-1",
      ["chapter:ch-1", "as_live_1", "execution_brief:chapter:ch-1"]),
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
  const result = resultOf({ messages, usedRefs: used,
    baseRefs: ["chapter:ch-1", "as_live_1", "execution_brief:chapter:ch-1"] });
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
  const duties = realAppBase();
  const structuredCall = assistantCall({
    refs: ["chapter:ch-object", "chapter:ch-inline", "chapter:ch-goal", "observation:obs_real_1"],
  });
  const structured = liveRefsCheck({
    llmRecords: [nativeRecord({ messages: [system(), duties, structuredScope, author()] })],
    transcript: { messages: [structuredCall] },
    sessionMessages: [...canonicalRequestMessages([duties, structuredScope, author()]), structuredCall],
  });
  assert.equal(structured.ok, null);
  assert.equal(structured.reason, "request_base_refs_unavailable");
  assert.deepEqual(structured.reports[0].base_refs, []);
  assert.deepEqual(structured.reports[0].observation_refs, []);

  const material = appBase("材料 chapter:ch-1", ["chapter:ch-1"]);
  const mergedCall = assistantCall({ refs: ["chapter:ch-1"], callId: "call_1" });
  mergedCall.blocks.push(...assistantCall({ refs: ["observation:obs_missing"], callId: "call_2" }).blocks);
  const mergedRecord = nativeRecord({ messages: [system(), material, author()] });
  mergedRecord.request.refs = { base_refs: ["chapter:ch-1"], observation_refs: [], used_refs: [] };
  const merged = liveRefsCheck({
    sessionMessages: [...canonicalRequestMessages([material, author()]), mergedCall], llmRecords: [mergedRecord],
    transcript: { messages: [mergedCall] },
  });
  assert.equal(merged.reports.length, 1);
  assert.deepEqual(merged.reports[0].message_indexes, [0]);
  assert.deepEqual(merged.reports[0].call_ids, ["call_1", "call_2"]);
  assert.equal(merged.ok, false);
});

test("L7 缺证/坏自报：空自报仍 null，越界优先 false，合法报告不能覆盖坏报告", () => {
  const material = appBase("材料 chapter:ch-1", ["chapter:ch-1"]);
  const messages = [system(), material, author()];
  const record = nativeRecord({ messages });
  record.request.refs = { base_refs: ["chapter:ch-1"], observation_refs: [], used_refs: [] };
  const check = (transcript) => liveRefsCheck({ llmRecords: [record], transcript,
    sessionMessages: [...canonicalRequestMessages(messages), ...transcript.messages] });
  assert.equal(liveRefsCheck({ llmRecords: [record], transcript: null, sessionMessages: [] }).ok, null);
  assert.equal(resultOf({ messages, usedRefs: [] }).reason, "used_context_refs_unavailable");
  assert.equal(check({ messages: [{ role: "assistant", provenance: "model", blocks: [{ type: "text", text: "无自报" }] }] }).ok, null);

  const mixed = check({
    messages: [
      assistantCall({ refs: ["observation:obs_out"] }),
      assistantCall({ pcall: null, prun: null, refs: ["chapter:ch-1"], callId: "call_2" }),
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
  const combined = bad("chapter:ch-1");
  combined.blocks.push(...assistantCall({ refs: ["chapter:ch-1"] }).blocks);
  const malformedMerged = check({ messages: [combined] });
  assert.equal(malformedMerged.reason, "self_report_malformed");
  assert.deepEqual(malformedMerged.reports[0].message_indexes, [0]);
  for (const invalid of [null, "", " ", 7, {}, { ref: "chapter:ch-1" }, ["chapter:ch-1"]]) {
    const result = check({ messages: [bad(["chapter:ch-1", invalid])] });
    assert.equal(result.ok, null, JSON.stringify(invalid));
    assert.equal(result.reason, "self_report_malformed");
    assert.deepEqual(result.reports[0].matched_refs.map(({ ref }) => ref), ["chapter:ch-1"]);
    const outside = check({ messages: [bad(["chapter:outside", invalid])] });
    assert.equal(outside.ok, false);
    assert.equal(outside.reason, "used_ref_out_of_boundary");
  }
});

test("L7 不授信来源：system/author/history assistant/失败 observation/validation_result/call 不一致/无前序调用/content 文本", () => {
  const base = [system(), appBase("材料 chapter:ch-1"), author()];
  const cases = [
    ["system", [system("chapter:sys"), appBase("材料 chapter:ch-1"), author()], "chapter:sys"],
    ["author", [system(), appBase("材料 chapter:ch-1"), author("chapter:author")], "chapter:author"],
    ["history assistant", [...base, irMessage("assistant", "model", [{ type: "text", text: "chapter:history" }])], "chapter:history"],
    ["failed observation", [...base, assistantToolCall(), nativeObservation({ status: "failed", sourceRefs: ["chapter:failed"] })], "chapter:failed"],
    ["validation_result", [...base, assistantToolCall(), nativeObservation({ type: "validation_result", sourceRefs: ["chapter:validation"] })], "chapter:validation"],
    ["call id mismatch", [...base, assistantToolCall(), nativeObservation({ callId: "call_other", sourceRefs: ["chapter:mismatch"] })], "chapter:mismatch"],
    ["no preceding call", [...base, nativeObservation({ sourceRefs: ["chapter:no-call"] })], "chapter:no-call"],
    ["content text", [...base, assistantToolCall(), nativeObservation({ sourceRefs: [], content: { text: "chapter:content-only" } })], "chapter:content-only"],
  ];
  for (const [label, messages, ref] of cases) assertViolation(messages, ref, label);
});


test("L7 native Scope 只消费同 pcall/prun 的 request.refs，保留真实 Scope 与观察核验", () => {
  const scope = realScope({ sourceRefs: ["chapter:actual", "chapter:source-only"],
    baseRefs: [{ ref: "chapter:actual", version: 2 }] });
  const record = nativeRecord({ messages: [scope] });
  record.provider = "splash";
  record.request.refs = { base_refs: [{ ref: "chapter:actual", version: 2 }],
    observation_refs: ["observation:metadata-only"], used_refs: ["chapter:actual"] };
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
  record.request.refs.base_refs = ["chapter:actual"];
  record.request.refs.used_refs = [{ ref: "chapter:actual" }];
  assert.equal(check(["chapter:actual"]).ok, true);
  assert.equal(check(["chapter:source-only"]).reason, "used_ref_out_of_boundary");
  const altered = structuredClone(scope);
  altered.versions.scope_revision += 1;
  assert.equal(check(["chapter:actual"], [record], [altered]).reason, "scope_provenance_unbound");
  const wrongRun = structuredClone(record);
  wrongRun.provider_run_ref = "prun-other";
  assert.equal(check(["chapter:actual"], [wrongRun]).ok, null);
});

test("L7 native request.refs 不跨调用借用，缺失或坏格式不由累计 refs 补齐", () => {
  const scope = realScope({ sourceRefs: ["chapter:actual"], baseRefs: ["chapter:actual"] });
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
  const actualScope = realScope({ sourceRefs: ["turn:author", "chapter:material", "observation:source-only"],
    baseRefs: [{ ref: "chapter:material", version: 3 }] });
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
    author(["【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】",
      '版本：{"change_reason":"run_scope_refreshed","scope_revision":2}',
      '来源：[{"ref":"observation:obs_real_1"}]', "{}"].join("\n")),
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
  const repeatedScope = structuredClone(scope);
  const missingBase = liveRefsCheck({
    llmRecords: [nativeRecord({ messages: [scope, repeatedScope] })],
    transcript: { messages: [call] }, sessionMessages: [scope, repeatedScope, call],
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
      author("【应用数据 · scope_update · 以最新版本为准】\n## 材料与覆盖\n- observation：observation:obs_tail"),
      author(),
    ],
    usedRefs: ["observation:obs_tail"],
  });
  assert.equal(tail.ok, false);

  const mission = resultOf({
    messages: [
      system(),
      realAppBase(),
      author("【应用数据 · scope_update · 以最新版本为准】\n- [observation:obs_mission] 已完成写前推理"),
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
    ["作者引用的旧 checkpoint 省略文本", quotedCheckpoint("较早记录 observation:obs_omitted_1"), "observation:obs_omitted_1"],
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
    sourceRefs: ["chapter:prior"], baseRefs: ["chapter:prior"],
    content: { goal: { text: "上一轮" } },
  });
  priorScope.versions.scope_revision = 1;
  const priorReport = assistantCall({
    pcall: "pcall_prior", prun: "prun_prior", refs: ["chapter:historical-out-of-boundary"],
  });
  const currentScope = realScope({
    sourceRefs: ["turn:current"], baseRefs: ["chapter:current"],
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
  record.request_body.refs = { base_refs: [], observation_refs: [] };
  assert.equal(check(sessionMessages).ok, false);
});

test("L7 canonical IR：当前请求 Base 登记与真实 observation 分账；Scope 来源不授信", () => {
  const legacy = irMessage("scope_update", "application",
    [{ type: "text", text: "## 材料与覆盖\n- chapter：chapter:legacy" }],
    { source_refs: [{ ref: "chapter:legacy" }] });
  const record = irRecord({
    baseRefs: [{ ref: "chapter:ch-ir" }, { ref: "plan:ir" }],
    observationRefs: ["chapter:obs-ir"],
    messages: [
      irMessage("system", "application", [{ type: "text", text: "chapter:sys-ir" }]),
      legacy,
      irMessage(
        "application_base",
        "application",
        [{ type: "text", text: "【应用数据 · application_base】材料" }],
        { source_refs: [{ ref: "chapter:ch-ir" }], base_refs: [{ ref: "chapter:ch-ir" }] },
      ),
      irMessage(
        "scope_update",
        "application",
        [{ type: "scope", content: { context: {} } }],
        { source_refs: [{ ref: "plan:ir" }, { ref: "observation:obs_ir" }], base_refs: [{ ref: "plan:ir" }] },
      ),
      irMessage("user", "author", [{ type: "text", text: AUTHOR }]),
      irMessage("assistant", "model", [{ type: "tool_call", call_id: "call-ir", name: "read_chapter", arguments: {} }]),
      irMessage("tool", "tool_result", [
        { type: "observation", call_id: "call-ir", status: "ok", source_refs: ["chapter:obs-ir"], content: { summary: "已读取本页。", text: "chapter:content-ir" } },
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
    baseRefs: ["obs_1"],
    messages: [
      irMessage("application_base", "application", [{ type: "text", text: "材料" }], {
        source_refs: [{ ref: "obs_1" }], base_refs: ["obs_1"],
      }),
      irMessage("user", "author", [{ type: "text", text: AUTHOR }]),
    ],
  });
  const splitCall = assistantCall({ pcall: "pcall_ir", prun: "prun_ir", refs: ["observation:obs_1"] });
  const splitResult = liveRefsCheck({
    sessionMessages: [...split.request_body.messages, splitCall], llmRecords: [split],
    transcript: { messages: [splitCall] },
  });
  assert.equal(splitResult.ok, false);
  assert(splitResult.reports[0].base_refs.includes("obs_1"));
  assert.deepEqual(splitResult.reports[0].observation_refs, []);
});

test("L7 自报只认 canonical assistant+model；格式坏记缺证", () => {
  const material = appBase("材料 chapter:ch-1", ["chapter:ch-1"]);
  const record = nativeRecord({ messages: [system(), material, author()] });
  record.request.refs = { base_refs: ["chapter:ch-1"], observation_refs: [], used_refs: [] };
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
  const actual = assistantCall({ refs: ["chapter:ch-1"] });
  actual.blocks.unshift({ type: "tool_call", call_id: "call_a",
    arguments: { self_report: { assumptions: ["x"] } } });
  const ignored = liveRefsCheck({
    sessionMessages: [...canonicalRequestMessages([material, author()]), actual],
    llmRecords: [record], transcript: { messages: [actual] },
  });
  assert.equal(ignored.ok, true);
  assert.equal(ignored.reports.length, 1);
});

test("L7 完整 ref / 唯一观察：不拆 wrapper、不做子串匹配，重复 call 或 result 不算观察", () => {
  const messages = [realScope({ sourceRefs: ["execution_brief:chapter:ch-1"], baseRefs: ["execution_brief:chapter:ch-1"] })];
  const baseRefs = [{ ref: "execution_brief:chapter:ch-1" }];
  const wrapped = irResultOf({ messages, baseRefs, usedRefs: ["execution_brief:chapter:ch-1"] });
  assert.equal(wrapped.ok, true);
  const inner = irResultOf({ messages, baseRefs, usedRefs: ["chapter:ch-1"] });
  assert.equal(inner.ok, false);
  assert(inner.reports[0].violations.some((violation) => violation.ref === "chapter:ch-1"));

  const spaced = irResultOf({
    messages: [realScope({ sourceRefs: [" chapter:exact "], baseRefs: [" chapter:exact "] })],
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
      content: { summary: "已读取本页。", observation_ref: "observation:obs_page_1" },
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
              content: { summary: "已读取本页。", observation_ref: "observation:obs-ir-page" },
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
  const actualRecord = nativeRecord({ providerCallRef: "pcall_1", providerRunRef: "prun_1", messages });
  actualRecord.request.refs = { base_refs: [], observation_refs: [], used_refs: [] };
  const otherCall = assistantCall({ refs: ["observation:obs_other"] });
  const other = liveRefsCheck({
    sessionMessages: [...canonicalRequestMessages(messages), otherCall],
    llmRecords: [
      actualRecord,
      nativeRecord({
        providerCallRef: "pcall_other",
        providerRunRef: "prun_other",
        messages: [
          system(),
          assistantToolCall({ callId: "call_other" }),
          nativeObservation({
            callId: "call_other",
            content: { summary: "另一请求的真实材料。", observation_ref: "observation:obs_other" },
          }),
        ],
      }),
    ],
    transcript: { messages: [otherCall] },
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

test("L7 planned_exploration 聚合：ok叶可引用、unavailable叶拒绝，报告保留真实父call_id", () => {
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

test("R05 planned_exploration partial叶仅授该页引用，保留partial/范围/续读且不升级完整", () => {
  const leaf = observationLeaf({ status: "partial", sourceRefs: ["memory:real-item"],
    observationRef: "observation:partial-page" });
  leaf.versions = { "memory:real-item": 9 };
  leaf.coverage = { kind: "memory_detail", offset: 0, "complete?": false };
  leaf.omissions = ["尚有后续正文"];
  leaf.next_offset = 6000;
  const messages = [system(), author(), assistantToolCall({ callId: "call_partial_parent" }),
    nativePlannedObservation({ callId: "call_partial_parent", status: "partial", leaves: [leaf] })];
  const result = resultOf({ messages, usedRefs: ["memory:real-item", "observation:partial-page"] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reports[0].base_refs, []);
  assert.deepEqual(result.reports[0].observation_refs, ["memory:real-item", "observation:partial-page"]);
  for (const match of result.reports[0].matched_refs) {
    assert(match.sources.every((source) =>
      source.call_id === "call_partial_parent" && source.status === "partial"));
  }
  const raw = messages.at(-1).blocks[0].content.observations[0];
  assert.equal(raw.coverage["complete?"], false);
  assert.equal(raw.next_offset, 6000);
  assert.deepEqual(raw.versions, { "memory:real-item": 9 });
});

test("L7 planned_exploration 父不可用/重复/未绑定时不授信任何叶", () => {
  const leaf = () => observationLeaf({
    sourceRefs: ["chapter:leaf_ok"],
    observationRef: "observation:obs_leaf_ok",
  });
  const base = [system(), appBase("材料 chapter:ch-1"), author(), assistantToolCall({ callId: "call_agg" })];
  for (const [label, messages] of [
    ["父不可用", [...base, nativePlannedObservation({ callId: "call_agg", status: "unavailable", leaves: [leaf()] })]],
    ["父未绑定", [...base, nativePlannedObservation({ callId: "call_other", leaves: [leaf()] })]],
    ["重复父结果", [...base, nativePlannedObservation({ callId: "call_agg", leaves: [leaf()] }), nativePlannedObservation({ callId: "call_agg", leaves: [leaf()] })]],
  ]) {
    assertViolation(messages, "chapter:leaf_ok", label);
  }
});
