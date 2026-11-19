// R03 B29：独立 seed/作者字节/动作前事实，不启动模型、产品或原生窗口。
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as evidence from "./lib/native_ui/authoring_character_candidate_evidence.mjs";

const WORK = "work-b29";
const REF = "character:shen-id";
const FP = "b87f4f22d6bb5994fa0d69f60a218507d25ad0aa903126ec38e9f97800f02cf0";
const INPUT = "指定老沈为主角";
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
  content: "【应用数据 · scope_update · 以最新版本为准】\n版本：" +
    JSON.stringify({ goal: 1 }) + "\n来源：" +
    JSON.stringify([{ ref: "work:" + WORK }]) + "\n" + JSON.stringify(scope),
});
function call(id, arguments_) {
  return message("assistant", "model", [{
    type: "tool_call", call_id: "call-" + id, name: "judgment_decision", arguments: arguments_,
  }], { provider_call_ref: "pcall-" + id, provider_run_ref: "prun-" + id });
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
  const executeArgs = { action: "execute", capability: "revise_character_profile", character_ref: REF };
  const base = [
    message("application_base", "application", [text("固定判断契约；作品事实按需探索。")]),
    scopeMessage(), message("user", "author", [text(INPUT)], { source_refs: [{ ref: "turn-b29" }] }),
  ];
  const messages = [...base, call("directory", directoryArgs),
    message("tool", "tool_result", [directory]), call("detail", detailArgs),
    message("tool", "tool_result", [detail]), call("execute", executeArgs)];
  const wireBase = [{ role: "user", content: "【应用数据 · application_base】固定判断契约；作品事实按需探索。" },
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
    messages, records, starts, candidate };
}
const evaluate = (input) => evidence.characterReadCandidateEvidence(input);
const check = (input, name) => evaluate(input).checks[name];

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
