// L7 真实 refs 证据纯判据测试：唯一正判来源是 canonical assistant(model) 的
// tool_call.arguments.self_report.used_context_refs，按顶层 provider_call_ref +
// provider_run_ref 配对同一次真实 llm record；base/observation 只从该 record 的
// 明确 application_base/scope 正式条目与唯一成功 observation 读取。段头 used_refs /
// decision_traces / agent_events 不参与正判，也不做整批并集；缺配对键、重复匹配、
// 请求不可解析记 null，已证越界优先 false，ref 按完整字符串精确匹配。
import assert from "node:assert/strict";
import test from "node:test";
import { extractRefTokens, liveRefsCheck } from "./authoring_live_refs.mjs";

const AUTHOR = "请为第01章写一段约300字的开篇正文。";
const AUTHOR_INPUT = "继续：按你刚才的判断，把下一个场景的开头写出来。";

const system = (text = "system") => ({ role: "system", content: text });
const author = (text = AUTHOR) => ({ role: "user", content: text });
const appBase = (text) => ({
  role: "user",
  content: `【应用数据 · application_base · 非作者原话】\n${text}`,
});
const scope = (text) => ({
  role: "user",
  content: `【应用数据 · scope_update · 以最新版本为准】\n${text}`,
});

// B81 真实验收请求形状（c7-c8-03/c5-c6-resume-02）：正式材料只在「## 材料与覆盖」；
// 「## 当前作者输入」之后还会重复「已完成观察」，checkpoint 的「省略：」也会提到旧记录。
const REAL_APP_BASE =
  "【应用数据 · application_base · 非作者原话】\n" +
  "本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由本消息的结构化字段与后续 " +
  "scope_update 给出；作者原话在独立 user 消息中。角色规则与输出协议见 system。";
const realAppBase = () => ({ role: "user", content: REAL_APP_BASE });
const realScope = ({ materials = [], objectRefs = [], authorInput = AUTHOR, trailing = [] } = {}) => ({
  role: "user",
  content: [
    "【应用数据 · scope_update · 以最新版本为准】",
    '版本：{"change_reason":"run_scope_refreshed","scope_revision":2}',
    "## 对象与范围",
    ...(objectRefs.length > 0 ? [`- 目标对象 refs：${objectRefs.join("、")}`] : []),
    "",
    "## 材料与覆盖",
    ...materials.map(([kind, ref]) => `- ${kind}：${ref}（完整；省略说明：单次只读观察）`),
    "",
    "## 当前作者输入",
    authorInput,
    ...trailing,
  ].join("\n"),
});
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
    request: { body: { messages } },
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

function irRecord({ providerCallRef = "pcall_ir", providerRunRef = "prun_ir", messages } = {}) {
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
      refs: {},
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
  return liveRefsCheck({
    llmRecords: [nativeRecord({ messages })],
    transcript: { messages: [assistantCall({ pcall, prun, refs: usedRefs })] },
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
      llmRecords,
      transcript: { messages: [assistantCall({ pcall, prun, refs: ["chapter:ch-base"] })] },
    });
    assert.equal(check.ok, null, label);
    assert(["llm_record_not_found", "llm_record_ambiguous"].includes(check.reason), label);
  }

  const unparseable = liveRefsCheck({
    llmRecords: [{ provider_call_ref: "pcall_1", provider_run_ref: "prun_1", request_format: "provider_prompt/v1" }],
    transcript: { messages: [assistantCall({ refs: ["chapter:ch-1"] })] },
  });
  assert.equal(unparseable.ok, null);
  assert.equal(unparseable.reason, "request_unparseable");
  assert.equal(unparseable.reports[0].request_reason, "retired_provider_prompt_request");
});

test("L7 同次：Base/scope 正式条目/成功 observation 通过，多 report 合并，来源可查", () => {
  const messages = [
    system("chapter:system-not-base"),
    appBase("材料 chapter:ch-1；artifact as_live_1；执行简述 execution_brief:chapter:ch-1"),
    realScope({
      materials: [["observation", "observation:obs_scope"], ["plan", "plan:1:plot_progress"]],
    }),
    author(),
    assistantToolCall({ callId: "call_1" }),
    nativeObservation({ callId: "call_1", sourceRefs: ["chapter:obs_tool", "observation:obs_tool"] }),
  ];
  const used = [
    "chapter:ch-1",
    "as_live_1",
    "execution_brief:chapter:ch-1",
    "observation:obs_scope",
    "plan:1:plot_progress",
    "chapter:obs_tool",
    "observation:obs_tool",
  ];
  const result = resultOf({ messages, usedRefs: used });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.sources.self_report_count, 1);
  const report = result.reports[0];
  assert.deepEqual(report.used_refs, [...used].sort());
  assert(report.base_refs.includes("plan:1:plot_progress"));
  assert(!report.base_refs.includes("observation:obs_scope"));
  assert(report.observation_refs.includes("observation:obs_scope"));
  assert(report.observation_refs.includes("chapter:obs_tool"));
  assert.equal(report.matched_refs.length, used.length);
  const matched = Object.fromEntries(report.matched_refs.map((entry) => [entry.ref, entry.sources[0]]));
  assert.deepEqual(
    [matched["observation:obs_scope"].message_index, matched["observation:obs_scope"].channel],
    [2, "materials"],
  );
  assert.deepEqual(
    [matched["chapter:obs_tool"].call_id, matched["chapter:obs_tool"].status, matched["chapter:obs_tool"].channel],
    ["call_1", "ok", "source_refs"],
  );

  const structuredScope = realScope({
    objectRefs: ["chapter:ch-object"],
    materials: [["observation", "observation:obs_real_1"]],
  });
  structuredScope.content = structuredScope.content.replace(
    "## 当前作者输入",
    "正文材料 chapter_ref=chapter:ch-inline\n\n## 当前作者输入",
  );
  const structured = resultOf({
    messages: [system(), realAppBase(), structuredScope, author()],
    usedRefs: ["chapter:ch-object", "chapter:ch-inline", "observation:obs_real_1"],
  });
  assert.equal(structured.ok, true);
  assert(structured.reports[0].base_refs.includes("chapter:ch-object"));
  assert(structured.reports[0].base_refs.includes("chapter:ch-inline"));

  const merged = liveRefsCheck({
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
  const check = (transcript) => liveRefsCheck({ llmRecords: [record], transcript });
  assert.equal(liveRefsCheck({ llmRecords: [record], transcript: null }).ok, null);
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

test("L7 真实 scope：checkpoint 省略/notice/作者输入与已完成观察不授信，正式材料条目可通过", () => {
  const legal = resultOf({
    messages: [system(), realAppBase(), realScope({ materials: [["observation", "observation:obs_real_1"]] }), author()],
    usedRefs: ["observation:obs_real_1"],
  });
  assert.equal(legal.ok, true);
  assert.deepEqual(legal.reports[0].observation_refs, ["observation:obs_real_1"]);

  const tail = resultOf({
    messages: [
      system(),
      realAppBase(),
      { role: "user", content: "【应用数据 · scope_update · 以最新版本为准】\n## 材料与覆盖\n- observation：observation:obs_tail" },
      author(),
    ],
    usedRefs: ["observation:obs_tail"],
  });
  assert.equal(tail.ok, true);

  const mission = resultOf({
    messages: [
      system(),
      realAppBase(),
      { role: "user", content: "【应用数据 · scope_update · 以最新版本为准】\n- [observation:obs_mission] 已完成写前推理" },
      author(),
    ],
    usedRefs: ["observation:obs_mission"],
  });
  assert.equal(mission.ok, true);

  const forgedRef = "observation:obs_quoted_1";
  const forgedScope = realScope({
    materials: [["observation", "observation:obs_real_1"]],
    authorInput: `继续：请按 ${forgedRef} 处理。`,
    trailing: [`[${forgedRef}] 已完成观察`],
  });
  for (const [label, message, ref] of [
    ["checkpoint 省略", checkpoint("较早记录 observation:obs_omitted_1"), "observation:obs_omitted_1"],
    ["application_notice", notice("旧记录 observation:obs_notice_1 已整理"), "observation:obs_notice_1"],
    ["作者输入引用", forgedScope, forgedRef],
  ]) {
    const result = resultOf({ messages: [system(), realAppBase(), message, author()], usedRefs: [ref] });
    assert.equal(result.ok, false, label);
    assert(result.reports[0].violations.some((violation) => violation.ref === ref), label);
  }
});

test("L7 canonical IR：sourceRefs 优先 + 正式 observation 条目；tool.content 不扫描，Base/observation 分账", () => {
  const record = irRecord({
    messages: [
      irMessage("system", "application", [{ type: "text", text: "chapter:sys-ir" }]),
      irMessage(
        "application_base",
        "application",
        [{ type: "text", text: "【应用数据 · application_base】材料" }],
        { source_refs: [{ ref: "chapter:ch-ir" }] },
      ),
      irMessage(
        "scope_update",
        "application",
        [{ type: "text", text: "## 材料与覆盖\n- observation：observation:obs_ir（完整）" }],
        { source_refs: [{ ref: "plan:ir" }] },
      ),
      irMessage("user", "author", [{ type: "text", text: AUTHOR }]),
      irMessage("assistant", "model", [{ type: "tool_call", call_id: "call-ir", name: "read_chapter", arguments: {} }]),
      irMessage("tool", "tool_result", [
        { type: "observation", call_id: "call-ir", status: "ok", source_refs: ["chapter:obs-ir"], content: { text: "chapter:content-ir" } },
      ]),
    ],
  });
  const check = (refs) =>
    liveRefsCheck({
      llmRecords: [record],
      transcript: { messages: [assistantCall({ pcall: "pcall_ir", prun: "prun_ir", refs })] },
    });
  const out = check(["chapter:ch-ir", "plan:ir", "observation:obs_ir", "chapter:obs-ir", "chapter:content-ir"]);
  assert.equal(out.ok, false);
  assert(out.reports[0].violations.some((violation) => violation.ref === "chapter:content-ir"));
  assert(out.reports[0].base_refs.includes("chapter:ch-ir"));
  assert(out.reports[0].base_refs.includes("plan:ir"));
  assert(out.reports[0].observation_refs.includes("observation:obs_ir"));
  assert(out.reports[0].observation_refs.includes("chapter:obs-ir"));
  assert.equal(check(["chapter:ch-ir", "plan:ir", "observation:obs_ir", "chapter:obs-ir"]).ok, true);

  const split = irRecord({
    messages: [
      irMessage("application_base", "application", [{ type: "text", text: "材料" }], {
        source_refs: [{ ref: "obs_1" }],
      }),
      irMessage("user", "author", [{ type: "text", text: AUTHOR }]),
    ],
  });
  const splitResult = liveRefsCheck({
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
  const wrapped = resultOf({
    messages: [system(), realAppBase(), realScope({ materials: [["execution_brief", "execution_brief:chapter:ch-1"]] }), author()],
    usedRefs: ["execution_brief:chapter:ch-1"],
  });
  assert.equal(wrapped.ok, true);
  const inner = resultOf({
    messages: [system(), realAppBase(), realScope({ materials: [["execution_brief", "execution_brief:chapter:ch-1"]] }), author()],
    usedRefs: ["chapter:ch-1"],
  });
  assert.equal(inner.ok, false);
  assert(inner.reports[0].violations.some((violation) => violation.ref === "chapter:ch-1"));

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
