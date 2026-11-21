// R03 B29：独立 seed/作者字节/动作前事实，不启动模型、产品或原生窗口。
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as evidence from "./lib/native_ui/authoring_character_candidate_evidence.mjs";
import { loadForbiddenTokens } from "./lib/author_visible/leak_scan.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as nativeEvidence from "./native_b29_evidence.mjs";
import { flatText } from "./lib/native_ui/workbench.mjs";
import * as r05Evidence from "./lib/native_ui/authoring_r05_evidence.mjs";

function capturedCandidateFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b29-raw-"));
  const at = (second) => `2026-01-01T00:00:0${second}.000Z`;
  const sent = { at: at(2), direction: "sent", frame: ["j", "m", "workspace:workspace-b29", "user_message",
    { work_id: "work-b29", session_id: "session-b29", turn_id: "turn-b29", text: "指定老沈为主角" }] };
  const result = { work_id: "work-b29", session_id: "session-b29", turn_id: "turn-b29",
    agent_run: { run_id: "run-b29", parent_turn_ref: "turn-b29" }, adoption_state: { pending: [] } };
  const ack = { at: at(3), direction: "received", frame: ["j", "m", sent.frame[2], "phx_reply",
    { status: "ok", response: { turn_id: "turn-b29", run_id: "run-b29" } }] };
  const wire = [sent, ack,
    { at: at(4), direction: "received", frame: ["j", null, sent.frame[2], "turn_result", result] },
    { at: at(5), direction: "received", frame: ["j", null, sent.frame[2], "agent_run_state",
      { run_id: "run-b29", workspace_id: "workspace-b29", work_id: "work-b29", session_id: "session-b29",
        parent_turn_ref: "turn-b29", status: "completed" }] }];
  const nodes = nativeCandidateView().nodes;
  nodes.find((node) => node.role === "AXPopUpButton").title = nativeEvidence.WORK_TITLE;
  const baseline = nodes.filter((node) => !node.path.startsWith("0/1/1/"));
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const captures = [["before", baseline, at(1)], ["candidate", nodes, at(6)]].map(([name, raw, capturedAt]) => {
    const text = flatText(raw), shot = Buffer.from("89504e470d0a1a0a00000000", "hex");
    fs.writeFileSync(path.join(dir, name + ".ax.json"), JSON.stringify(raw));
    fs.writeFileSync(path.join(dir, name + ".ax.txt"), "handwritten independent AX fixture");
    fs.writeFileSync(path.join(dir, name + ".text.txt"), text);
    fs.writeFileSync(path.join(dir, name + ".jpg"), shot);
    return { name, at: capturedAt, nodes: raw.length, ax_sha256: hash(JSON.stringify(raw)),
      text_sha256: hash(text), screenshot: { ok: true, sha256: hash(shot) } };
  });
  const driver = { run_ref: "harness-b29", captures, inputs: [{ turn_id: "turn-b29", run_id: "run-b29",
    message: sent.frame[4].text, baseline_capture: "before", baseline_author_count: 0 }] };
  const write = (file, data) => fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
  write("native-driver-ready.json", { run_ref: "harness-b29", ready_at: at(0) });
  write("native-ui-complete.json", { harness_run_ref: "harness-b29", screenshots: ["before.jpg", "candidate.jpg"] });
  write("b29-native-driver-log.json", driver);
  fs.writeFileSync(path.join(dir, "native-transport.jsonl"), wire.map((row) => JSON.stringify(row)).join("\n"));
  return { dir, nodes, driver, wire, write, turn: { turnId: "turn-b29", message: sent, ack, result } };
}

test("B29 reader 从 raw、截图和文本重算当前作者，不采信 driver 成功标志", () => {
  const fixture = capturedCandidateFixture();
  try {
    const view = nativeEvidence.readB29NativeView(fixture.dir, "candidate", fixture.turn);
    assert.deepEqual(view.nodes, fixture.nodes);
    assert.equal(view.baselineAuthorCount, 0);
    assert.equal(evidence.b29RoleCandidateVisible({ ...displayedCandidate(), nativeView: view }), true);
  } finally { fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test("B29 内容替换、重复 capture、错运行、错作者基线和交付前截图均拒绝", () => {
  for (const alter of [
    ({ dir, nodes, write }) => { const raw = clone(nodes); raw.at(-1).frame[1] = -200; write("candidate.ax.json", raw); },
    ({ dir }) => fs.appendFileSync(path.join(dir, "candidate.text.txt"), "借入旧卡"),
    ({ dir }) => fs.appendFileSync(path.join(dir, "candidate.jpg"), "other screenshot"),
    ({ driver, write }) => { driver.captures.push(clone(driver.captures[1])); write("b29-native-driver-log.json", driver); },
    ({ driver, write }) => { driver.run_ref = "other"; write("b29-native-driver-log.json", driver); },
    ({ driver, write }) => { driver.inputs[0].baseline_author_count = 1; write("b29-native-driver-log.json", driver); },
    ({ driver, write }) => { driver.inputs[0].run_id = "other"; write("b29-native-driver-log.json", driver); },
    ({ driver, write }) => { driver.captures[1].at = "2026-01-01T00:00:03.500Z"; write("b29-native-driver-log.json", driver); },
  ]) {
    const fixture = capturedCandidateFixture();
    try {
      assert.doesNotThrow(() => nativeEvidence.readB29NativeView(fixture.dir, "candidate", fixture.turn));
      alter(fixture); assert.throws(() => nativeEvidence.readB29NativeView(fixture.dir, "candidate", fixture.turn));
    }
    finally { fs.rmSync(fixture.dir, { recursive: true, force: true }); }
  }
});

const NO_CHANGE_MODEL = "MODEL_41c9\n老沈的主角身份已经登记。";
const NO_CHANGE_SYSTEM = "沈砚（别名：老沈；灯楼查账人；主角）本次无需修改；角色档案未发生变更。";
function noChangeFixture() {
  const nativeView = nativeCandidateView();
  nativeView.nodes.push({ path: "0/1/2", role: "AXPopUpButton", desc: "助手名称", title: "AI 助手" });
  Object.assign(nativeView.nodes.find((node) => node.path === "0/1/1/3/0"),
    { value: NO_CHANGE_MODEL, frame: [20, 200, 700, 60] });
  nativeView.nodes.find((node) => node.path === "0/1/1/5/0").value = "系统核对结果";
  nativeView.nodes.find((node) => node.path === "0/1/1/5/1").value = NO_CHANGE_SYSTEM;
  nativeView.nodes = nativeView.nodes.filter((node) => node.path !== "0/1/1/6");
  return { nativeView, tokens: loadForbiddenTokens(), turnResult: { assistant_message: { text: NO_CHANGE_MODEL }, actions: [],
    adoption_state: { pending: [] }, ui_cards: [
      { card_type: "result_card", title: "系统核对结果", body: NO_CHANGE_SYSTEM, actions: [] },
    ] } };
}

test("同轮 no_change 保留模型换行原文并交付唯一无动作系统结果", () => {
  assert.equal(evidence.b29RoleNoChangeVisible(noChangeFixture()), true);
  for (const alter of [
    (v) => { v.turnResult.assistant_message.text = NO_CHANGE_SYSTEM; },
    (v) => { v.turnResult.ui_cards.push(clone(v.turnResult.ui_cards[0])); },
    (v) => { v.turnResult.adoption_state.pending.push({ artifact_type: "character_profile_revision" }); },
    (v) => { v.turnResult.actions.push({ action_id: "save" }); },
    (v) => { v.turnResult.ui_cards[0].actions.push({ action_id: "save" }); },
    (v) => { v.nativeView.nodes.find((node) => node.path === "0/1/1/3/0").frame[1] = -200; },
    (v) => { v.nativeView.baselineAuthorCount = 1; },
    (v) => { v.nativeView.nodes.find((node) => node.path === "0/1/1/5/1").frame[1] = 710; },
  ]) {
    const value = noChangeFixture(); alter(value);
    assert.equal(evidence.b29RoleNoChangeVisible(value), false);
  }
});

test("no_change 原文来源由真实 metadata 定位，不拿相同字符串猜另一渠道", () => {
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const request = { provider_call_ref: "call-role", provider_run_ref: "provider-role" };
  const makeWitness = (sourceType, field = "author_narrative") => ({
    event: { run_id: "role-run", event_type: "judgment_decided", payload: {
      action: "execute", author_narrative: NO_CHANGE_MODEL, author_narrative_source: {
        source_type: sourceType, ...request, provider_output_ref: request.provider_run_ref,
        ...(sourceType === "provider_output_tool_narrative" ? {
          tool_call_name: "judgment_decision", tool_call_narrative_field: field,
        } : {}), source_hash: hash(NO_CHANGE_MODEL), narrative_hash: hash(NO_CHANGE_MODEL),
        source_byte_range: { start: 0, length: Buffer.byteLength(NO_CHANGE_MODEL) },
      },
    } },
    output: { run_id: "role-run", role: "assistant", provenance: "model", ...request,
      blocks: [{ type: "text", text: NO_CHANGE_MODEL }, { type: "tool_call", name: "judgment_decision",
        arguments: { action: "execute", capability: "revise_character_profile", [field]: NO_CHANGE_MODEL } }] },
  });
  for (const witness of [makeWitness("provider_output"), makeWitness("provider_output_tool_narrative"),
    makeWitness("provider_output_tool_narrative", "reason")]) {
    assert.equal(r05Evidence.judgmentNarrativeSourceBound(witness, request, "role-run", NO_CHANGE_MODEL, "execute"), true);
  }
  for (const alter of [
    (w) => { w.event.payload.author_narrative_source.tool_call_name = "other"; },
    (w) => { w.event.payload.author_narrative_source.tool_call_narrative_field = "reason"; },
    (w) => { w.output.blocks[1].arguments.author_narrative = "different\nmodel"; },
    (w) => { w.event.payload.author_narrative_source.provider_call_ref = "other"; },
    (w) => { w.event.payload.author_narrative_source.source_byte_range.start = 1; },
    (w) => { w.event.payload.author_narrative_source.narrative_hash = "0".repeat(64); },
  ]) {
    const witness = makeWitness("provider_output_tool_narrative"); alter(witness);
    assert.equal(r05Evidence.judgmentNarrativeSourceBound(witness, request, "role-run", NO_CHANGE_MODEL, "execute"), false);
  }
});

const WORK = "work-b29";
const REF = "character:shen-id";
const FP = "b87f4f22d6bb5994fa0d69f60a218507d25ad0aa903126ec38e9f97800f02cf0";
const INPUT = "指定老沈为主角";
const EXECUTE_NARRATIVE = "ROLE_5e8a\n已核对老沈的角色档案，主角身份修订候选等待你采纳。";
const SOURCE = {
  id: "shen-id", name: "沈砚", aliases: ["老沈"], role: "灯楼查账人",
  narrative_role: "ENSEMBLE_POV", summary: "群像视角中的查账人，熟悉灯楼旧账与井底黑泉",
  status: "ACCEPTED", updated_at: "2026-11-15T00:00:00.123456",
};
const FIELDS = ["character_ref", "name", "aliases", "role", "narrative_role", "status", "updated_at", "base_fingerprint"];
const clone = (value) => structuredClone(value);
const message = (role, provenance, blocks, extra = {}) =>
  ({ role, provenance, blocks, versions: {}, source_refs: [], ...extra });
const text = (value) => ({ type: "text", text: value });
const scope = {
  facts: { work: { ref: "work:" + WORK, work_id: WORK, title: "B29 已有角色叙事身份复现作品", version: 1 } },
  coverage: { characters: "not_read", chapters: "not_read", chapter_prose: "not_read" },
  goal: { version: 1, source_input_ref: "turn-b29" },
  operation: { available_operations: ["revise_character_profile"] },
};
const scopeMessage = () => message("scope_update", "application", [{ type: "scope", content: clone(scope) }],
  { versions: { goal: 1 }, source_refs: [{ ref: "work:" + WORK }] });
const scopeWire = () => ({
  role: "user",
  content: "【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】\n版本：" +
    JSON.stringify({ goal: 1 }) + "\n来源：" +
    JSON.stringify([{ ref: "work:" + WORK }]) + "\n" + JSON.stringify(scope),
});
function call(id, arguments_) {
  return message("assistant", "model", [{
    type: "tool_call", call_id: "call-" + id, name: "judgment_decision", arguments: arguments_,
  }], { provider_call_ref: "pcall-" + id, provider_run_ref: "prun-" + id });
}
function judgmentWitness(id, args) {
  const hash = createHash("sha256").update(EXECUTE_NARRATIVE).digest("hex");
  return {
    event: { run_id: "run-b29", event_type: "judgment_decided", payload: {
      action: "execute", capability: "revise_character_profile", author_narrative: EXECUTE_NARRATIVE,
      author_narrative_source: {
        source_type: "provider_output_tool_narrative", provider_call_ref: "pcall-" + id,
        provider_run_ref: "prun-" + id, provider_output_ref: "prun-" + id,
        tool_call_name: "judgment_decision", tool_call_narrative_field: "reason",
        source_hash: hash, narrative_hash: hash,
        source_byte_range: { start: 0, length: Buffer.byteLength(EXECUTE_NARRATIVE) },
      },
    } },
    output: { run_id: "run-b29", role: "assistant", provenance: "model",
      provider_call_ref: "pcall-" + id, provider_run_ref: "prun-" + id,
      blocks: [{ type: "tool_call", call_id: "call-" + id, name: "judgment_decision", arguments: clone(args) }],
    },
  };
}
function wireCall(id, arguments_) {
  return { role: "assistant", content: "", tool_calls: [{
    id: "call-" + id, type: "function",
    function: { name: "judgment_decision", arguments: JSON.stringify(arguments_) },
  }] };
}
function observation(id, kind, query, extra = {}) {
  return {
    type: "observation", call_id: "call-" + id, status: "ok",
    source_refs: [REF], versions: { [REF]: FP }, omissions: [], next_offset: null,
    coverage: { kind, facet: "characters", work_id: WORK },
    content: { tool: "archive_read", query, summary: "", facts: {} }, ...extra,
  };
}
function fixture() {
  const source = clone(SOURCE);
  const before = {
    work_id: WORK, characters: [
      source, { id: "gu-id", name: "顾青", aliases: [], narrative_role: "PROTAGONIST" },
      { id: "small-shen-id", name: "沈砚", aliases: ["小沈"], narrative_role: "MINOR" },
      { id: "yuan-id", name: "阿鸢", aliases: [], narrative_role: "SUPPORTING" },
    ],
    character_count: 4, memory_count: 1,
    memories: [{ id: "memory-1", content: "已采纳设定", content_sha256: "memory-sha" }],
    drafts: [{ id: "draft-1", content_sha256: "original-prose-sha" }],
  };
  const directory = observation("directory", "directory", "characters");
  directory.content.summary = "沈砚（老沈） " + REF;
  directory.omissions = ["目录只供定位，未读取对象正文或角色修订基线。"];
  const query = JSON.stringify({ facet: "characters", ref: REF, offset: 0 });
  const detail = observation("detail", "detail", query);
  detail.coverage.ref = REF;
  detail.coverage.complete_fields = [...FIELDS];
  detail.coverage.summary = {
    offset: 0, returned_graphemes: Array.from(source.summary).length,
    total_graphemes: Array.from(source.summary).length, offset_unit: "unicode_grapheme",
  };
  detail.content.summary = source.summary;
  detail.content.facts.character = {
    character_ref: REF, name: source.name, aliases: [...source.aliases], role: source.role,
    narrative_role: source.narrative_role, status: source.status,
    updated_at: "2026-11-15T00:00:00.123456Z", base_fingerprint: FP,
  };
  const directoryArgs = { action: "explore", explore_request: { tool: "archive_read", query: "characters" } };
  const detailArgs = { action: "explore", explore_request: { tool: "archive_read", query } };
  const executeArgs = { action: "execute", capability: "revise_character_profile", character_ref: REF,
    reason: EXECUTE_NARRATIVE };
  const base = [
    message("application_base", "application", [text("固定判断契约；作品事实按需探索。")]),
    scopeMessage(), message("user", "author", [text(INPUT)], { source_refs: [{ ref: "turn-b29" }] }),
  ];
  const messages = [...base, call("directory", directoryArgs),
    message("tool", "tool_result", [directory]), call("detail", detailArgs),
    message("tool", "tool_result", [detail]), call("execute", executeArgs),
    message("tool", "tool_result", [{ type: "validation_result", call_id: "call-execute",
      status: "passed", reason_code: "judgment_validated",
      detail: { execution_authorized: false, canon_written: false } }])];
  const wireBase = [{ role: "user", content: "【应用数据 · application_base · 非作者原话】\n固定判断契约；作品事实按需探索。" },
    scopeWire(), { role: "user", content: INPUT }];
  const dirPair = [wireCall("directory", directoryArgs),
    { role: "tool", tool_call_id: "call-directory", content: JSON.stringify(directory) }];
  const detailPair = [wireCall("detail", detailArgs),
    { role: "tool", tool_call_id: "call-detail", content: JSON.stringify(detail) }];
  const records = [
    ["directory", wireBase], ["detail", [...wireBase, ...dirPair]],
    ["execute", [...wireBase, ...dirPair, ...detailPair]],
  ].map(([id, wireMessages]) => ({
    provider: "splash", provider_call_ref: "pcall-" + id, provider_run_ref: "prun-" + id,
    response: { body: { tool_calls: [{ id: "call-" + id, name: "judgment_decision",
      arguments: { directory: directoryArgs, detail: detailArgs, execute: executeArgs }[id] }] } },
    request: { body: { model: "local/Q4-PLE4", messages: wireMessages, tools: [] },
      refs: { base_refs: [{ ref: "work:" + WORK }], observation_refs: [], used_refs: [] } },
  }));
  const starts = ["directory", "detail", "execute"].map((id) =>
    ({ provider_call_ref: "pcall-" + id, provider_run_id: "prun-" + id }));
  const candidate = {
    artifact_id: "pending-role", artifact_type: "character_profile_revision", adoption_status: "TENTATIVE",
    payload: { object_kind: "character_profile_revision", character_ref: REF, character_name: "沈砚", base_fingerprint: FP,
      changes: [{ field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST" }],
      effects: ["character_field_update"], other_character_changes: [], suggested_other_character_changes: [],
      adoption_effect: { mode: "character_field_update", character_ref: REF } },
  };
  return { before, after: clone(before), sourceCharacterId: source.id, workId: WORK,
    messages, records, starts, candidate, runId: "run-b29", reply: EXECUTE_NARRATIVE,
    judgmentSource: judgmentWitness("execute", executeArgs) };
}
const evaluate = (input) => evidence.characterReadCandidateEvidence(input);
const check = (input, name) => evaluate(input).checks[name];
const DISPLAY_TITLE = "沈砚（别名：老沈；身份：灯楼查账人；当前：群像视角） · 叙事身份修订";
const DISPLAY_BODY = "- 叙事身份：群像视角 → 主角\n候选尚未采纳，角色档案尚未修改。";
function displayedCandidate(body = DISPLAY_BODY, title = DISPLAY_TITLE) {
  const candidate = fixture().candidate;
  candidate.payload.items = [{ title, body }];
  return { candidate, knownArtifacts: [candidate], visibleText: title + "\n" + body, tokens: loadForbiddenTokens() };
}

test("作者读到可辨认的老沈、中文原身份和未生效候选，内部枚举仍留在payload", () => {
  const input = displayedCandidate();
  assert.equal(evidence.b29RoleCandidateVisible(input), true);
  assert.equal(input.candidate.payload.changes[0].old, "ENSEMBLE_POV");
  assert.equal(input.candidate.payload.changes[0].new, "PROTAGONIST");
});
test("错误目标、旧英文模板、缺正文和借用背景文字都不能冒充中文候选", () => {
  for (const input of [
    displayedCandidate(DISPLAY_BODY, DISPLAY_TITLE.replace("老沈", "小沈")),
    displayedCandidate("- narrative_role：ENSEMBLE_POV → PROTAGONIST"),
    { ...displayedCandidate(), visibleText: DISPLAY_TITLE },
    { ...displayedCandidate(), visibleText: DISPLAY_TITLE + "\n另一份角色候选\n" + DISPLAY_BODY },
    { ...displayedCandidate(), visibleText: DISPLAY_TITLE + "\n群像视角\n主角\n候选尚未采纳" },
    displayedCandidate(DISPLAY_BODY + "\ncharacter:e9fe5f90-c939-4f9e-abee-da235d1eaa45"),
  ]) assert.equal(evidence.b29RoleCandidateVisible(input), false);
});
function nativeCandidateView() {
  const node = (path, role, extra = {}) => ({ path, role, frame: [20, 200, 700, 30], ...extra });
  return { message: INPUT, baselineAuthorCount: 0, workTitle: "角色验收作品", nodes: [
    node("0", "AXWindow", { frame: [0, 0, 1280, 800] }),
    node("0/1", "AXWebArea", { frame: [0, 0, 1280, 800] }),
    node("0/1/0", "AXPopUpButton", { desc: "作品", title: "角色验收作品" }),
    node("0/1/1", "AXGroup", { title: "会话消息", subrole: "AXLandmarkRegion",
      frame: [0, 100, 1000, 600] }),
    node("0/1/1/0", "AXGroup"), node("0/1/1/0/0", "AXStaticText", { value: "你" }),
    node("0/1/1/1", "AXGroup"), node("0/1/1/1/0", "AXStaticText", { value: INPUT }),
    node("0/1/1/2", "AXGroup"), node("0/1/1/2/0", "AXStaticText", { value: "AI 助手" }),
    node("0/1/1/3", "AXGroup"), node("0/1/1/3/0", "AXStaticText", { value: "已核对老沈的身份。" }),
    node("0/1/1/4", "AXButton", { title: "为什么", desc: "查看这轮回应的依据" }),
    node("0/1/1/5", "AXGroup", { frame: [20, 300, 700, 120] }),
    node("0/1/1/5/0", "AXStaticText", { value: DISPLAY_TITLE, frame: [20, 300, 700, 30] }),
    node("0/1/1/5/1", "AXStaticText", { value: DISPLAY_BODY, frame: [20, 330, 700, 90] }),
    node("0/1/1/6", "AXButton", { title: "保存到作品", enabled: true, frame: [20, 430, 140, 30] }),
  ] };
}
test("当前作者的真实单候选与保存入口在实际视口内", () => {
  assert.equal(evidence.b29RoleCandidateVisible({ ...displayedCandidate(), nativeView: nativeCandidateView() }), true);
});
test("B29 保存入口保留完整 artifact 归属，缺组或同名另一候选不能代签", () => {
  const input = displayedCandidate();
  for (const knownArtifacts of [
    undefined, [],
    [{ ...input.candidate, artifact_id: "other-role" }],
    [{ ...input.candidate, source_tool_result_ref: "other-result" }],
    [input.candidate, { ...input.candidate, artifact_id: "other-role" }],
  ]) {
    assert.equal(evidence.b29RoleCandidateVisible({ ...input, knownArtifacts, nativeView: nativeCandidateView() }), false);
  }
});

test("全页相同文字不能代替当前作者、目标卡和真实可见视口", () => {
  const view = nativeCandidateView();
  const cases = [
    { ...clone(view), baselineAuthorCount: 1 },
    { ...clone(view), workTitle: "另一作品" },
    { ...clone(view), nodes: view.nodes.filter((node) => node.path !== "0/1/1/0/0") },
    { ...clone(view), nodes: view.nodes.map((node) =>
      node.path === "0/1/1/5/1" ? { ...node, frame: [20, 710, 700, 90] } : node) },
    { ...clone(view), nodes: view.nodes.map((node) =>
      node.path === "0/1/1/6" ? { ...node, path: "0/2/0" } : node) },
    { ...clone(view), baselineAuthorCount: 1, nodes: [...clone(view.nodes),
      { path: "0/1/1/8", role: "AXGroup" }, { path: "0/1/1/8/0", role: "AXStaticText", value: "你" },
      { path: "0/1/1/9", role: "AXGroup" }, { path: "0/1/1/9/0", role: "AXStaticText", value: INPUT }] },
  ];
  for (const nativeView of cases) {
    assert.equal(evidence.b29RoleCandidateVisible({ ...displayedCandidate(), nativeView }), false);
  }
});
test("成功回执仅闭合协议，实际接受来源、目标及待采纳候选共同成立才通过", () => {
  const input = fixture(), result = evaluate(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.measured.execute_provider_call_ref, "pcall-execute");
  assert.deepEqual(input.messages.at(-1).blocks[0], {
    type: "validation_result", call_id: "call-execute", status: "passed",
    reason_code: "judgment_validated", detail: { execution_authorized: false, canon_written: false },
  });
  assert.equal(input.candidate.adoption_status, "TENTATIVE");
  assert.deepEqual(input.before, input.after);
});

test("缺失、失败、错call、错状态或乱序的回执不能借正确候选冒充接受", () => {
  for (const [label, alter] of [
    ["missing", (v) => { v.messages.pop(); }],
    ["failed", (v) => { Object.assign(v.messages.at(-1).blocks[0],
      { status: "failed", reason_code: "author_visible_narrative_invalid" }); }],
    ["wrong call", (v) => { v.messages.at(-1).blocks[0].call_id = "call-other"; }],
    ["unknown status", (v) => { v.messages.at(-1).blocks[0].status = "ok"; }],
    ["wrong success reason", (v) => { v.messages.at(-1).blocks[0].reason_code = "agent_plan_validated"; }],
    ["duplicate", (v) => { v.messages.push(clone(v.messages.at(-1))); }],
    ["before call", (v) => { [v.messages[7], v.messages[8]] = [v.messages[8], v.messages[7]]; }],
    ["wrong provenance", (v) => { v.messages.at(-1).provenance = "model"; }],
    ["wrong capability", (v) => { v.messages[7].blocks[0].arguments.capability = "propose_structure"; }],
    ["wrong target", (v) => { v.messages[7].blocks[0].arguments.character_ref = "character:gu-id"; }],
  ]) {
    const input = fixture(); alter(input);
    assert.equal(check(input, "model_execute_matches_source"), false, label);
  }
});

test("passed 回执不能代替真实接受来源或当前待采纳候选", () => {
  for (const [label, alter] of [
    ["missing source", (v) => { v.judgmentSource = null; }],
    ["wrong run", (v) => { v.judgmentSource.event.run_id = "other-run"; }],
    ["wrong provider call", (v) => { v.judgmentSource.event.payload.author_narrative_source.provider_call_ref = "other-call"; }],
    ["wrong provider output", (v) => { v.judgmentSource.event.payload.author_narrative_source.provider_output_ref = "other-output"; }],
    ["wrong accepted capability", (v) => { v.judgmentSource.event.payload.capability = "propose_structure"; }],
    ["wrong accepted tool call", (v) => { v.judgmentSource.output.blocks[0].call_id = "call-other"; }],
    ["wrong accepted target", (v) => { v.judgmentSource.output.blocks[0].arguments.character_ref = "character:gu-id"; }],
    ["wrong narrative hash", (v) => { v.judgmentSource.event.payload.author_narrative_source.narrative_hash = "0".repeat(64); }],
    ["wrong range", (v) => { v.judgmentSource.event.payload.author_narrative_source.source_byte_range.length -= 1; }],
    ["replaced final text", (v) => { v.reply = "系统已完成任务。"; }],
    ["missing candidate", (v) => { v.candidate = null; }],
    ["wrong candidate", (v) => { v.candidate.payload.character_ref = "character:gu-id"; }],
    ["already adopted", (v) => { v.candidate.adoption_status = "ACCEPTED"; }],
  ]) {
    const input = fixture(); alter(input);
    assert.equal(evaluate(input).ok, false, label);
  }
});

test("只排除原call已失败闭合的execute，接受的纠正决定仍唯一并带真实详情", () => {
  const input = fixture();
  const args = clone(input.messages[7].blocks[0].arguments);
  const failure = { type: "validation_result", call_id: "call-execute", status: "failed",
    reason_code: "author_visible_narrative_invalid" };
  input.messages[8] = message("tool", "tool_result", [failure]);
  input.messages.push(call("corrected", args), message("tool", "tool_result", [{
    type: "validation_result", call_id: "call-corrected", status: "passed",
    reason_code: "judgment_validated", detail: { execution_authorized: false, canon_written: false },
  }]));
  input.judgmentSource = judgmentWitness("corrected", args);
  const record = clone(input.records.at(-1));
  record.provider_call_ref = "pcall-corrected"; record.provider_run_ref = "prun-corrected";
  record.response.body.tool_calls[0].id = "call-corrected";
  record.request.body.messages.push(wireCall("execute", args),
    { role: "tool", tool_call_id: "call-execute", content: JSON.stringify(failure) });
  input.records.push(record);
  input.starts.push({ provider_call_ref: "pcall-corrected", provider_run_id: "prun-corrected" });
  assert.equal(evaluate(input).ok, true);
  assert.equal(evaluate(input).measured.execute_provider_call_ref, "pcall-corrected");
  const withModelText = clone(input), originalText = "FAILED_MODEL_82d1\n正在核对角色。";
  withModelText.messages[7].blocks.unshift(text(originalText));
  withModelText.records[2].response.body.content = originalText;
  withModelText.records.at(-1).request.body.messages.at(-2).content = originalText;
  assert.equal(evaluate(withModelText).ok, true);
  withModelText.records.at(-1).request.body.messages.at(-2).content = originalText.replace("\n", " ");
  assert.equal(check(withModelText, "model_execute_matches_source"), false);
  const unknownCapability = clone(input);
  const invalidArgs = { ...args, capability: "unknown_role_operation" };
  unknownCapability.messages[7].blocks[0].arguments = invalidArgs;
  unknownCapability.records[2].response.body.tool_calls[0].arguments = invalidArgs;
  unknownCapability.records.at(-1).request.body.messages.at(-2).tool_calls[0].function.arguments = JSON.stringify(invalidArgs);
  assert.equal(evaluate(unknownCapability).ok, true);
  unknownCapability.records.at(-1).request.body.messages.splice(-2);
  assert.equal(check(unknownCapability, "model_execute_matches_source"), false,
    "未识别 capability 的失败同样必须进入真实下一请求");
  for (const mutate of [
    (request) => { request.messages = request.messages.slice(0, -2); },
    (request) => { request.messages.at(-2).content = "并非模型原文的纠错说明"; },
    (request) => { request.messages.at(-1).content = JSON.stringify({ ...failure, reason_code: "other_failure" }); },
    (request) => { request.messages.at(-2).tool_calls[0].function.arguments = JSON.stringify({ ...args, character_ref: "character:other" }); },
  ]) {
    const changed = clone(input); mutate(changed.records.at(-1).request.body);
    assert.equal(check(changed, "model_execute_matches_source"), false);
  }
  for (const bad of [
    (rows) => { rows[8].blocks[0].call_id = "call-other"; },
    (rows) => { rows[8].blocks[0].status = "ok"; },
    (rows) => { rows.push(clone(rows[8])); },
    (rows) => { [rows[7], rows[8]] = [rows[8], rows[7]]; },
  ]) {
    const changed = clone(input); bad(changed.messages);
    assert.equal(check(changed, "model_execute_matches_source"), false);
  }
});


test("动作前真实行的已知 SHA256 向量保留 UTC 六位精度", () => {
  assert.equal(evidence.characterSourceFingerprint(SOURCE), FP);
  assert.equal(evidence.characterSourceFingerprint({ ...SOURCE, updated_at: SOURCE.updated_at + "Z" }), FP);
  assert.equal(evidence.characterSourceFingerprint({ ...SOURCE, updated_at: "2026-11-15 00:00:00.123456" }), FP);
  assert.notEqual(evidence.characterSourceFingerprint({ ...SOURCE, updated_at: "2026-11-15T00:00:00.123457" }), FP);
});
test("真实目录→详情→紧邻判断请求→精确候选，作者未采纳", () => {
  const result = evaluate(fixture());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.measured.source_fingerprint, FP);
  assert.equal(result.measured.character_ref, REF);
  assert.equal(result.measured.detail.source.provider_call_ref, "pcall-detail");
  assert.equal(result.measured.detail.next.provider_call_ref, "pcall-execute");
});
test("猜中合法 ref/指纹不能替代真实读取", () => {
  const input = fixture();
  input.messages = input.messages.filter((row) => row.role !== "tool");
  assert.equal(check(input, "detail_observed"), false);
});
test("目录携带相同元数据不能冒充详情", () => {
  const input = fixture();
  input.messages[6].blocks[0].coverage.kind = "directory";
  assert.equal(check(input, "detail_observed"), false);
});
for (const field of ["name", "aliases", "role", "narrative_role", "summary", "status", "updated_at"]) {
  test("动作前源字段篡改不能用观察自证指纹: " + field, () => {
    const input = fixture();
    input.before.characters[0][field] = field === "aliases" ? ["另一别名"] : "篡改";
    input.after = clone(input.before);
    assert.equal(check(input, "detail_matches_source"), false);
  });
}
for (const field of ["character_ref", "base_fingerprint"]) {
  test("候选必须绑定同一次真实详情: " + field, () => {
    const input = fixture();
    input.candidate.payload[field] = "wrong";
    assert.equal(check(input, "candidate_matches_observed_source"), false);
  });
}
test("观察与候选同时携带错误指纹仍拒绝", () => {
  const input = fixture();
  const detail = input.messages[6].blocks[0];
  detail.versions[REF] = "wrong";
  detail.content.facts.character.base_fingerprint = "wrong";
  input.candidate.payload.base_fingerprint = "wrong";
  input.records[2].request.body.messages.at(-1).content = JSON.stringify(detail);
  assert.equal(check(input, "detail_matches_source"), false);
});
test("缺完整身份字段不可证明读到修订基线", () => {
  const input = fixture();
  delete input.messages[6].blocks[0].content.facts.character.status;
  assert.equal(check(input, "detail_matches_source"), false);
});
test("同名另一作品详情不授本作品资格", () => {
  const input = fixture();
  input.messages[6].blocks[0].coverage.work_id = "foreign-work";
  assert.equal(check(input, "detail_observed"), false);
});
test("目录查询顺序必须先于详情", () => {
  const input = fixture();
  const directory = input.messages.splice(3, 2);
  input.messages.splice(5, 0, ...directory);
  assert.equal(check(input, "directory_precedes_detail"), false);
});
test("详情本身合法但下一次判断请求未供应原观察", () => {
  const input = fixture();
  input.records[2].request.body.messages.pop();
  assert.equal(check(input, "detail_in_next_request"), false);
});
test("后继请求篡改观察字段不得按 call id 放行", () => {
  const input = fixture();
  const payload = JSON.parse(input.records[2].request.body.messages.at(-1).content);
  payload.content.facts.character.role = "冒充";
  input.records[2].request.body.messages.at(-1).content = JSON.stringify(payload);
  assert.equal(check(input, "detail_in_next_request"), false);
});
test("迟到回放不得冒充紧邻请求供应", () => {
  const input = fixture();
  const late = clone(input.records[2]);
  input.records[2].request.body.messages.pop();
  late.provider_call_ref = "pcall-late";
  late.provider_run_ref = "prun-late";
  input.records.push(late);
  input.starts.push({ provider_call_ref: "pcall-late", provider_run_id: "prun-late" });
  assert.equal(check(input, "detail_in_next_request"), false);
});
test("源请求不可能已经含自己尚未返回的结果", () => {
  const input = fixture();
  input.records[1].request.body.messages.push(clone(input.records[2].request.body.messages.at(-1)));
  assert.equal(check(input, "detail_in_next_request"), false);
});
test("候选 ref 正确但模型实际 execute 绑定另一人物仍拒绝", () => {
  const input = fixture();
  input.messages[7].blocks[0].arguments.character_ref = "character:gu-id";
  assert.equal(check(input, "model_execute_matches_source"), false);
});
test("首请求预装角色全文不能当按需求证正例", () => {
  const input = fixture();
  input.records[0].request.body.messages[0].content += "\n" + SOURCE.summary;
  assert.equal(check(input, "initial_materials_minimal"), false);
});
test("完整权威角色未采纳时必须不变", () => {
  const input = fixture();
  input.after.characters[0].narrative_role = "PROTAGONIST";
  assert.equal(check(input, "authoritative_facts_unchanged"), false);
});
test("数量不变但正文被写入仍拒绝", () => {
  const input = fixture();
  input.after.drafts[0].content_sha256 = "changed-prose";
  assert.equal(check(input, "authoritative_facts_unchanged"), false);
});
test("数量不变但记忆内容被写入仍拒绝", () => {
  const input = fixture();
  input.after.memories[0].content = "changed";
  assert.equal(check(input, "authoritative_facts_unchanged"), false);
});
test("已采纳候选不能冒充停止于待采纳", () => {
  const input = fixture();
  input.candidate.adoption_status = "ACCEPTED";
  assert.equal(check(input, "candidate_pending"), false);
});
test("额外人物变更不能附带进入单字段候选", () => {
  const input = fixture();
  input.candidate.payload.other_character_changes = [{ character_ref: "character:gu-id" }];
  assert.equal(check(input, "candidate_effects_exact"), false);
});
test("长 summary 的真实首页足够单字段修订，未读尾页明确保留", () => {
  const input = fixture();
  const summary = "评".repeat(6000) + "未读尾页";
  const fingerprint = createHash("sha256").update([
    "shen-id", "沈砚", "老沈", "ENSEMBLE_POV", "灯楼查账人", summary,
    "ACCEPTED", "2026-11-15T00:00:00.123456Z",
  ].join("|")).digest("hex");
  input.before.characters[0].summary = summary;
  input.after = clone(input.before);
  const directory = input.messages[4].blocks[0];
  const detail = input.messages[6].blocks[0];
  directory.versions[REF] = fingerprint;
  detail.versions[REF] = fingerprint;
  detail.content.facts.character.base_fingerprint = fingerprint;
  detail.content.summary = "评".repeat(6000);
  detail.coverage.summary = { offset: 0, returned_graphemes: 6000,
    total_graphemes: 6004, offset_unit: "unicode_grapheme" };
  detail.next_offset = 6000;
  detail.omissions = ["其余正文尚未读取"];
  input.records[1].request.body.messages.at(-1).content = JSON.stringify(directory);
  input.records[2].request.body.messages[4].content = JSON.stringify(directory);
  input.records[2].request.body.messages.at(-1).content = JSON.stringify(detail);
  input.candidate.payload.base_fingerprint = fingerprint;
  const result = evaluate(input);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("候选采纳效果若指向另一人物不能通过", () => {
  const input = fixture();
  input.candidate.payload.adoption_effect.character_ref = "character:gu-id";
  assert.equal(check(input, "candidate_effects_exact"), false);
});

test("观察范围计量必须等于真实原文字数", () => {
  const input = fixture();
  const detail = input.messages[6].blocks[0];
  detail.coverage.summary.returned_graphemes -= 1;
  assert.equal(check(input, "detail_matches_source"), false);
});
