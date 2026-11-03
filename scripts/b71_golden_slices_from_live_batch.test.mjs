#!/usr/bin/env node
// b71_golden_slices_from_live_batch.mjs 的正式测试：
// 追加式前缀、application_base/author/scope_update 分类、G1 结构、G2 唯一 call_id 绑定、
// G4 候选工具、G5/G6 不覆盖——全部纯函数级，不读真实批次、不跑 GUI。

import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMessage,
  extractJsonArrayAfterKey,
  goldenSlices,
  prefixIsAppend,
  pairToolCalls,
  sliceRequest,
} from "./b71_golden_slices_from_live_batch.mjs";

const sha = (value) => JSON.stringify(value);

function request(messages, tools = []) {
  return { request: { body: { messages, tools } } };
}

function wire(roles, extra = {}) {
  return roles.map((role) => ({ role, content: `${role}-content`, ...(extra[role] ?? {}) }));
}

test("classifyMessage 区分 system/application_base/scope_update/author/assistant/tool", () => {
  assert.equal(classifyMessage({ role: "system", content: "x" }).kind, "system");
  assert.equal(
    classifyMessage({ role: "user", content: "【应用数据 · application_base · 非作者原话】x" }).kind,
    "user:application_base",
  );
  assert.equal(
    classifyMessage({ role: "user", content: "【应用数据 · scope_update · 以最新版本为准】x" }).kind,
    "user:scope_update",
  );
  assert.equal(classifyMessage({ role: "user", content: "作者原话" }).kind, "user:author");
  assert.equal(
    classifyMessage({ role: "assistant", content: "", tool_calls: [{ id: "c1" }] }).kind,
    "assistant",
  );
  assert.equal(classifyMessage({ role: "tool", content: "{}", tool_call_id: "c1" }).kind, "tool_result");
});

test("prefixIsAppend：严格前缀相等才通过，收缩或改动失败", () => {
  const base = [wire(["system"]), wire(["user"])];
  const same = [
    { rawMessages: [{ role: "system", content: "system-content" }, { role: "user", content: "user-content" }] },
    {
      rawMessages: [
        { role: "system", content: "system-content" },
        { role: "user", content: "user-content" },
        { role: "assistant", content: "a" },
      ],
    },
  ];
  assert.equal(prefixIsAppend(same[0], same[1]).ok, true);
  const changed = [
    same[0],
    { rawMessages: [{ role: "system", content: "changed" }, { role: "user", content: "user-content" }] },
  ];
  assert.equal(prefixIsAppend(changed[0], changed[1]).ok, false);
  const shrunk = [same[1], same[0]];
  assert.equal(prefixIsAppend(shrunk[0], shrunk[1]).ok, false);
  assert.equal(prefixIsAppend(base, null).ok, false);
});

test("sliceRequest：作者字节独立、tool_call/result id 与工具目录如实提取", () => {
  const messages = [
    { role: "system", content: "constitution" },
    { role: "user", content: "【应用数据 · application_base · 非作者原话】base" },
    { role: "user", content: "作者原话" },
    { role: "user", content: "【应用数据 · scope_update · 以最新版本为准】scope" },
    { role: "assistant", content: "", tool_calls: [{ id: "call-1", function: { name: "judgment_decision", arguments: "{}" } }] },
    { role: "tool", content: '{"status":"ok"}', tool_call_id: "call-1" },
  ];
  const slice = sliceRequest(request(messages, [{ function: { name: "judgment_decision" } }]), 0);
  assert.deepEqual(slice.kinds, [
    "system",
    "user:application_base",
    "user:author",
    "user:scope_update",
    "assistant",
    "tool_result",
  ]);
  assert.equal(slice.author_messages.length, 1);
  assert.equal(slice.tool_calls[0].id, "call-1");
  assert.deepEqual(slice.tool_result_call_ids, ["call-1"]);
  assert.deepEqual(slice.tool_names, ["judgment_decision"]);
});

test("goldenSlices：G1 要求 application_base 在 author 前且存在 system；G2 按唯一 call_id 去重", () => {
  const first = sliceRequest(
    request([
      { role: "system", content: "constitution" },
      { role: "user", content: "【应用数据 · application_base · 非作者原话】base" },
      { role: "user", content: "作者原话" },
      { role: "assistant", content: "", tool_calls: [{ id: "call-1", function: { name: "judgment_decision", arguments: "{}" } }] },
      { role: "tool", content: '{"status":"ok"}', tool_call_id: "call-1" },
    ]),
    0,
  );
  // 第二条请求回放同一 call（追加式 transcript），不应把回放算成第二次调用。
  const second = sliceRequest(
    request([
      { role: "system", content: "constitution" },
      { role: "user", content: "【应用数据 · application_base · 非作者原话】base" },
      { role: "user", content: "作者原话" },
      { role: "assistant", content: "", tool_calls: [{ id: "call-1", function: { name: "judgment_decision", arguments: "{}" } }] },
      { role: "tool", content: '{"status":"ok"}', tool_call_id: "call-1" },
      { role: "assistant", content: "", tool_calls: [{ id: "call-2", function: { name: "prose_writing", arguments: "{}" } }] },
      { role: "tool", content: '{"status":"ok"}', tool_call_id: "call-2" },
    ]),
    1,
  );
  const slices = goldenSlices([first, second]);
  const g1 = slices.find((s) => s.id === "G1");
  assert.equal(g1.ok, true);
  assert.equal(g1.facts.application_base_before_author, true);
  const g2 = slices.find((s) => s.id === "G2");
  assert.equal(g2.ok, true);
  assert.equal(g2.facts.unique_tool_call_ids, 2);
  assert.equal(g2.facts.call_ids_bound, 2);
  assert.equal(g2.facts.replayed_occurrences_total, 3);
});

test("goldenSlices：缺少 application_base 或 author 时 G1 不通过；G5/G6 永远不代签", () => {
  const bad = sliceRequest(
    request([
      { role: "system", content: "constitution" },
      { role: "user", content: "作者原话" },
    ]),
    0,
  );
  const slices = goldenSlices([bad]);
  assert.equal(slices.find((s) => s.id === "G1").ok, false);
  assert.equal(slices.find((s) => s.id === "G5").ok, false);
  assert.equal(slices.find((s) => s.id === "G6").ok, false);
});

test("goldenSlices：G4 仅在出现创作/候选工具时通过", () => {
  const noCreative = slideWithTools(["judgment_decision", "explore"]);
  assert.equal(goldenSlices([noCreative]).find((s) => s.id === "G4").ok, false);
  const creative = slideWithTools(["judgment_decision", "submit_tentative_artifact"]);
  assert.equal(goldenSlices([creative]).find((s) => s.id === "G4").ok, true);
});

function slideWithTools(names) {
  const messages = [
    { role: "system", content: "constitution" },
    { role: "user", content: "【应用数据 · application_base · 非作者原话】base" },
    { role: "user", content: "作者原话" },
    ...names.flatMap((name, index) => [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: `call-${index}`, function: { name, arguments: "{}" } }],
      },
      { role: "tool", content: '{"status":"ok"}', tool_call_id: `call-${index}` },
    ]),
  ];
  return sliceRequest(request(messages), 0);
}

test("extractJsonArrayAfterKey：嵌套数组按括号深度完整提取（不截断）", () => {
  const text = 'base {"resolved_adoptions":[{"status":"DISCARDED","available_operations":[]},{"status":"ACCEPTED","revision_of":"as_1"}],"tail":1}';
  const extracted = extractJsonArrayAfterKey(text, "resolved_adoptions");
  assert.ok(extracted, "应提取到数组");
  const rows = JSON.parse(extracted);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.status),
    ["DISCARDED", "ACCEPTED"],
  );
  assert.equal(extractJsonArrayAfterKey(text, "missing_key"), null);
});

test("extractJsonArrayAfterKey：字符串内的括号/转义不影响配对", () => {
  const text = 'x {"k":[{"note":"包含 ] 和 \\" 引号"},{"note":"ok"}],"y":0}';
  const rows = JSON.parse(extractJsonArrayAfterKey(text, "k"));
  assert.equal(rows.length, 2);
});

test("pairToolCalls：唯一配对、缺失/孤儿/重复/顺序错误全部报出", () => {
  const clean = pairToolCalls([
    { role: "assistant", content: "", tool_calls: [{ id: "c1" }, { id: "c2" }] },
    { role: "tool", content: "{}", tool_call_id: "c1" },
    { role: "tool", content: "{}", tool_call_id: "c2" },
  ]);
  assert.deepEqual(clean, {
    call_count: 2,
    result_count: 2,
    duplicate_calls: [],
    duplicate_results: [],
    missing_results: [],
    orphan_results: [],
    order_violations: [],
  });
  const broken = pairToolCalls([
    { role: "tool", content: "{}", tool_call_id: "orphan" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1" }, { id: "c1" }] },
    { role: "tool", content: "{}", tool_call_id: "c1" },
    { role: "tool", content: "{}", tool_call_id: "c1" },
  ]);
  assert.deepEqual(broken.duplicate_calls, ["c1"]);
  assert.deepEqual(broken.duplicate_results, ["c1"]);
  assert.deepEqual(broken.orphan_results, ["orphan"]);
  assert.deepEqual(broken.missing_results, []);
});

test("goldenSlices：G5 要求非空处置数据 + 边界后新 turn，空事实不误报", () => {
  const build = (turnId, messages) => {
    const slice = sliceRequest({ request_body: { messages }, turn_id: turnId }, 0);
    return { ...slice, turn_id: turnId, rawMessages: messages };
  };
  const emptyFact = build("turn-src", [
    { role: "system", content: "constitution" },
    { role: "user", content: "【应用数据 · application_base · 非作者原话】base" },
    { role: "user", content: "作者原话" },
    { role: "user", content: '{"resolved_adoptions":[],"pending_adoption_count":0}' },
  ]);
  const nonEmptyFact = build("turn-followup", [
    { role: "system", content: "constitution" },
    { role: "user", content: "【应用数据 · application_base · 非作者原话】base" },
    { role: "user", content: "作者原话" },
    { role: "user", content: '{"resolved_adoptions":[{"status":"ACCEPTED","available_operations":[]}]}' },
  ]);
  const emptyOnly = goldenSlices([emptyFact]);
  assert.equal(emptyOnly.find((s) => s.id === "G5").ok, false);
  const withReal = goldenSlices([emptyFact, nonEmptyFact]);
  const g5 = withReal.find((s) => s.id === "G5");
  assert.equal(g5.ok, true);
  assert.equal(g5.facts.disposition_detail[0].resolved_adoptions_non_empty, true);
});
