// R05 独立目标反例：输入取现 request reader 归一的真实形状；不调用产品 projector。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { r05GoalEvidence, r05VisibleEvidence } from "./authoring_r05_evidence.mjs";
import { requestFactsFromBody } from "./authoring_request_facts.mjs";
import { g2VisibleEvidence, g3VisibleEvidence } from "./authoring_g2_evidence.mjs";
import { scopeWireMessage } from "./fixtures/authoring_request_ir.mjs";
import { G2_VISIBLE_TARGET, visibleAfterInput, visibleReadingPage } from "./fixtures/authoring_live_facts.mjs";
import flatPending from "./fixtures/b71-pending-flat-ax-dual-candidates.json" with { type: "json" };

const CHAPTER = "chapter:r05-source";
const DRAFT = "draft:r05-accepted";
const SOURCE = Object.freeze({ work_id: "work-r05", chapter_ref: CHAPTER, draft_ref: DRAFT, revision: 7,
  prose: "开头保留铜铃。" + "灰".repeat(6986) + "结尾保留手印。",
  style: { ref: "memory:style-real-id", version: 4, body: "多用对白推进情节，少用心理独白。" } });
const EXPECTED_VERSIONS = [{ ref: DRAFT, version: 7 }];
const countScope = () => ({
  work_id: "work-r05", facts: { work: { work_id: "work-r05", chapter_statistics: {
    structure_chapter_count: 2, written_chapter_count: 1, empty_chapter_count: 1,
    total_word_count: 7000,
  } } }, coverage: { chapter_statistics: { status: "complete" } },
});
const writerScope = () => ({
  operation: { role: "creative_execution", capability: "prose_writing", context_text: SOURCE.prose },
  authoring_task: {
    scope: { object_kind: "chapter_prose", modification_scope: "whole_chapter",
      target_chapter_ref: CHAPTER, expected_base_versions: structuredClone(EXPECTED_VERSIONS) },
    materials: [{ kind: "chapter_prose", ref: DRAFT, version: 7, "complete?": true }],
  },
});
function request(content, { call = "pcall:writer", leaves = [] } = {}) {
  const messages = leaves.map((leaf, index) => scopeWireMessage({
    operation: { role: "planned_exploration", plan_ref: "plan:r05", step_ref: `step:${index}` },
    facts: { exploration_result: leaf },
  }, { sourceRefs: leaf.source_refs.map((ref) => ({ ref })), versions: leaf.versions }));
  messages.push(scopeWireMessage(content));
  const facts = requestFactsFromBody({ messages, tools: [] });
  assert.equal(facts.ok, true);
  return { provider_call_ref: call, provider_run_ref: `prun:${call}`,
    facts, scope: facts.scopeMessages.at(-1) };
}
function nativePagedRequest(content, {
  prose = SOURCE.prose, ranges = [[1, 6000, 0, 18000], [6001, 7000, 18000, 21000]], changePage = null,
} = {}) {
  const messages = ranges.flatMap(([start, end, byteStart, byteEnd], index) => {
    const callId = "native-page-" + (index + 1);
    const page = {
      type: "observation", call_id: callId, status: "ok", source_refs: [CHAPTER],
      versions: { [DRAFT]: 7 },
      coverage: { chapter_ref: CHAPTER, prose_range: { start, end }, prose_total_chars: 7000,
        prose_byte_range: { start: byteStart, end: byteEnd } },
      omissions: index === 0 ? ["计划仅展示预览"] : [], next_offset: index === 0 ? 6000 : null,
      content: { tool: "chapter_read", observation_ref: "observation:page-" + (index + 1),
        source_hash: createHash("sha256").update(prose, "utf8").digest("hex"),
        summary: "第02章\n【正文】\n" + [...prose].slice(start - 1, end).join("") },
    };
    if (changePage) changePage(page, index);
    return [
      { role: "assistant", content: "", tool_calls: [{ id: callId,
        type: "function", function: { name: "chapter_content_read",
          arguments: JSON.stringify({ chapter_ref: CHAPTER, offset: start - 1 }) } }] },
      { role: "tool", tool_call_id: callId, content: JSON.stringify(page) },
    ];
  });
  messages.push(scopeWireMessage(content));
  const facts = requestFactsFromBody({ messages, tools: [] });
  assert.equal(facts.ok, true);
  assert.equal(facts.observations.length, 2);
  assert(facts.observations.every((unit) => unit.provenance === "tool"));
  return { provider_call_ref: "pcall:writer", provider_run_ref: "prun:pcall:writer",
    facts, scope: facts.scopeMessages.at(-1) };
}
function proseLeaf(source = SOURCE) {
  return { status: "ok", source_refs: [source.chapter_ref],
    versions: { [source.draft_ref]: source.revision },
    coverage: { chapter_ref: source.chapter_ref, prose_range: { start: 1, end: [...source.prose].length },
      prose_total_chars: [...source.prose].length }, omissions: [], next_offset: null,
    content: { tool: "chapter_read", observation_ref: "observation:body",
      summary: `第02章\n【正文】\n${source.prose}` } };
}
function styleLeaf() {
  return { status: "ok", source_refs: [SOURCE.style.ref], versions: { [SOURCE.style.ref]: 4 },
    coverage: { kind: "detail", work_id: SOURCE.work_id, memory_ref: SOURCE.style.ref,
      summary: { offset: 0, returned_graphemes: [...SOURCE.style.body].length,
        total_graphemes: [...SOURCE.style.body].length, offset_unit: "unicode_grapheme" } },
    omissions: [], next_offset: null,
    content: { tool: "memory_recall", summary: SOURCE.style.body } };
}
function candidate() {
  return { artifact_id: "artifact:r05", artifact_type: "prose_fragment",
    target_chapter_ref: CHAPTER, adoption_status: "TENTATIVE", payload: {
      modification_scope: "whole_chapter",
      adoption_effect: { mode: "replace_scope", coverage: "complete",
        covered: [`${DRAFT}:7`], expected_base_versions: structuredClone(EXPECTED_VERSIONS) },
      scope: { target_chapter_ref: CHAPTER },
      items: [{ item_id: "i1", title: "整章修订稿", body: "保留两端线索的全章新正文。" }],
    } };
}
function goalInput(goal = "whole") {
  const writer = request(writerScope(), { leaves: goal === "style" ? [styleLeaf()] : [] });
  return { goal, source: structuredClone(SOURCE), requests: [request(countScope(), { call: "pcall:first" }), writer],
    consumer_call_ref: writer.provider_call_ref, reply: "已准备修订候选，尚未保存。",
    candidate: candidate(), writer: { ok: true, provider_call_ref: writer.provider_call_ref },
    refs: { ok: true, reports: [{ status: "verified", provider_call_ref: writer.provider_call_ref,
      provider_run_ref: writer.provider_run_ref, matched_refs: [{ ref: CHAPTER, kind: "base" },
        { ref: SOURCE.style.ref, kind: "base" }] }] }, zero_write: { ok: true } };
}
// 测试独立用标准 UTF8/SHA256 构造契约；不调用被测 verifier 或产品 sanitizer。
function replySource(reply, call, prefix = "") {
  const raw = prefix + reply;
  const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
  return {
    event: { run_id: "run:r05", event_type: "judgment_decided", payload: {
      action: "reply", author_narrative: reply, author_narrative_source: {
        source_type: "provider_output", provider_call_ref: call, provider_run_ref: `prun:${call}`,
        provider_output_ref: `prun:${call}`, source_hash: hash(raw),
        source_byte_range: { start: Buffer.byteLength(prefix, "utf8"), length: Buffer.byteLength(reply, "utf8") },
        narrative_hash: hash(reply),
      },
    } },
    output: { run_id: "run:r05", role: "assistant", provenance: "model",
      provider_call_ref: call, provider_run_ref: `prun:${call}`,
      blocks: [{ type: "text", text: raw }] },
  };
}
function countInput() {
  return { ...goalInput("count"), requests: [request(countScope(), { call: "pcall:first" })],
    consumer_call_ref: "pcall:first", reply: "共2章，有正文1章，未写正文1章。",
    candidate: null, writer: null, pending_count: 0, run_id: "run:r05",
    reply_source: replySource("共2章，有正文1章，未写正文1章。", "pcall:first") };
}
function qualityInput() {
  const source = { ...SOURCE, prose: "林野靠临时断电夺回账牌，但妹妹的名字仍在井底屏幕上。" };
  return { ...goalInput("quality"), source,
    requests: [request(countScope(), { call: "pcall:first" }),
      request({ operation: { available_operations: [] } }, { call: "pcall:answer", leaves: [proseLeaf(source)] })],
    consumer_call_ref: "pcall:answer", candidate: null, writer: null, pending_count: 0,
    reply: "断电暂时解决追捕，妹妹仍被控制；可以增加断电的代价。", run_id: "run:r05",
    reply_source: replySource("断电暂时解决追捕，妹妹仍被控制；可以增加断电的代价。", "pcall:answer") };
}

test("R05 N-NARR 合法原始前缀与可见叙事不同，按真实UTF8字节范围绑定回复消费者", () => {
  const input = countInput(); input.reply = "正确答案";
  input.reply_source = replySource(input.reply, "pcall:first", "[assistant reasoning omitted]\n");
  assert.deepEqual(input.reply_source.event.payload.author_narrative_source.source_byte_range,
    { start: 30, length: 12 });
  const report = r05GoalEvidence(input);
  assert.equal(report.checks.reply_source_bound, true, JSON.stringify(report));
  assert.equal(report.ok, true, JSON.stringify(report));
});
test("R05 N-NARR 同字串不能借跨call/旧run/错误原文hash或UTF8范围授信", () => {
  for (const change of [
    (value) => { value.reply_source.event.payload.author_narrative_source.provider_call_ref = "pcall:other"; },
    (value) => { value.reply_source.event.payload.author_narrative_source.provider_run_ref = "prun:other"; },
    (value) => { value.reply_source.event.payload.author_narrative_source.provider_output_ref = "prun:other"; },
    (value) => { value.reply_source.event.run_id = "run:old"; },
    (value) => { value.reply_source.output.run_id = "run:old"; },
    (value) => { value.reply_source.output.provider_call_ref = "pcall:other"; },
    (value) => { value.reply_source.output.provider_run_ref = "prun:other"; },
    (value) => { value.reply_source.event.payload.author_narrative_source.source_hash = "0".repeat(64); },
    (value) => { value.reply_source.event.payload.author_narrative_source.narrative_hash = "0".repeat(64); },
    (value) => { value.reply_source.event.payload.author_narrative_source.source_byte_range.start = 29; },
    (value) => { value.reply_source.event.payload.author_narrative_source.source_byte_range.length = 4; },
    (value) => { value.reply_source.event.payload.author_narrative_source.source_type = "application"; },
    (value) => { value.reply_source.output.blocks.push({ type: "tool_call", call_id: "c1", name: "judgment_decision", arguments: {} }); },
  ]) {
    const input = countInput(); input.reply = "正确答案";
    input.reply_source = replySource(input.reply, "pcall:first", "[assistant reasoning omitted]\n");
    change(input);
    assert.equal(r05GoalEvidence(input).checks.reply_source_bound, false);
  }
});

test("R05 章数首问直接消费真实 Base 的 2/1/1，无章正文读取也成立", () => {
  const report = r05GoalEvidence(countInput());
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.checks.initial_statistics, true);
  assert.equal(report.checks.initial_no_full_prose, true);
});
test("R05 章数不能用缺失/混淆统计、跨作品事实、默认整章或候选冒充材料达标", () => {
  for (const change of [
    (input) => { input.requests[0] = request({ facts: { work: {} } }); },
    (input) => { const scope = countScope(); scope.facts.work.chapter_statistics.structure_chapter_count = 1; input.requests[0] = request(scope); },
    (input) => { const scope = countScope(); scope.coverage.chapter_statistics.status = "not_read"; input.requests[0] = request(scope); },
    (input) => { const scope = countScope(); scope.facts.work.work_id = "work-other"; input.requests[0] = request(scope); },
    (input) => { const scope = countScope(); scope.operation = { context_text: SOURCE.prose }; input.requests[0] = request(scope); },
    (input) => { input.requests[0] = request(countScope(), { call: "pcall:first", leaves: [proseLeaf()] }); },
    (input) => { input.pending_count = 1; },
  ]) {
    const input = countInput(); change(input);
    assert.equal(r05GoalEvidence(input).ok, false);
  }
});
test("R05 结构化Scope/tool叶内含换行全文也属于首请求默认夹带", () => {
  const input = countInput();
  input.source.prose = "开头\n" + "灰".repeat(6994) + "\n结尾";
  assert(input.source.prose.includes("\n"));
  assert.equal([...input.source.prose].length, 7000);
  input.requests[0] = request(countScope(), { call: "pcall:first", leaves: [proseLeaf(input.source)] });
  assert.equal(r05GoalEvidence(input).checks.initial_no_full_prose, false);
});
test("R05 数字否定句和编号列表均不自动签回答语义，原文与独立2/1/1预期留给审读", () => {
  for (const reply of ["不是2、1、1。", "共1章，有正文1章，未写正文0章。",
    "1. 总章数：2\n2. 有正文：1\n3. 未写正文：1"]) {
    const input = countInput(); input.reply = reply;
    const report = r05GoalEvidence(input);
    assert.equal(report.signed_scope, "request_materials_and_scope");
    assert.equal(report.semantic_review.status, "pending_independent_review");
    assert.equal(report.semantic_review.reply, reply);
    assert.deepEqual(report.semantic_review.expected, { structure: 2, written: 1, empty: 1 });
    assert(report.not_signed.includes("model_semantic_correctness"));
    assert.equal(report.checks.answer_counts_match, undefined);
  }
});
test("R05 质量判断由实际请求中的同版本全文成立，文学评价保持待独立审读", () => {
  const report = r05GoalEvidence(qualityInput());
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.checks.full_prose_supplied, true);
  assert(report.not_signed.includes("literary_quality"));
});
test("R05 质量目录只有 ref/摘要，或已隐藏的旧 canonical 读取，均不能算全文供应", () => {
  for (const change of [
    (input) => { const leaf = proseLeaf(input.source); leaf.content = { tool: "archive_read", summary: "第02章，正文已保存。" }; leaf.coverage = { kind: "directory", "complete?": true }; input.requests[1] = request({}, { call: "pcall:answer", leaves: [leaf] }); },
    (input) => { input.requests[1] = request({ source_refs: [CHAPTER, DRAFT], summary: input.source.prose }, { call: "pcall:answer" }); },
    (input) => { input.requests[0] = input.requests[1]; input.requests[1] = request({}, { call: "pcall:answer" }); input.requests[0].provider_call_ref = "pcall:old"; },
    (input) => { input.requests[1].scope = null; },
    (input) => { input.pending_count = 1; },
  ]) {
    const input = qualityInput(); change(input);
    assert.equal(r05GoalEvidence(input).ok, false);
  }
});
test("R05 已存在的完整正文资格不由 partial、缺范围、跨版本拼页或换 pcall 补成", () => {
  for (const change of [
    (leaves) => { leaves[0].status = "partial"; leaves[0].omissions = ["未读后页"]; },
    (leaves) => { delete leaves[0].coverage.prose_range; },
    (leaves) => { leaves[0].versions[DRAFT] = 6; },
    (leaves, source) => {
      const body = source.prose; const half = Math.floor([...body].length / 2);
      leaves[0].content.summary = [...body].slice(0, half).join("");
      leaves[0].coverage.prose_range.end = half; leaves[0].next_offset = half;
      leaves.push(proseLeaf(source));
      leaves[1].content.summary = [...body].slice(half).join("");
      leaves[1].coverage.prose_range.start = half + 1; leaves[1].versions[DRAFT] = 8;
    },
  ]) {
    const input = qualityInput(); const leaves = [proseLeaf(input.source)]; change(leaves, input.source);
    input.requests[1] = request({}, { call: "pcall:answer", leaves });
    assert.equal(r05GoalEvidence(input).ok, false);
  }
});
test("R05 冻结长章夹具独立为7000字符，并保留两端原文", () => {
  assert.equal([...SOURCE.prose].length, 7000);
  assert(SOURCE.prose.startsWith("开头保留铜铃。"));
  assert(SOURCE.prose.endsWith("结尾保留手印。"));
});
test("R05 同请求旧高version正确Scope不能越过后来低version别章当前Scope", () => {
  const input = goalInput();
  const latest = { operation: { role: "creative_execution", capability: "prose_writing",
    context_text: "另一章正文" }, authoring_task: { scope: {
    object_kind: "chapter_prose", modification_scope: "whole_chapter",
    target_chapter_ref: "chapter:other", expected_base_versions: [{ ref: "draft:other", version: 1 }],
  } } };
  const facts = requestFactsFromBody({ messages: [
    scopeWireMessage(writerScope(), { versions: { scope: 99 } }),
    scopeWireMessage(latest, { versions: { scope: 1 } }),
  ], tools: [] });
  input.requests[1] = { provider_call_ref: "pcall:writer", provider_run_ref: "prun:pcall:writer",
    facts, scope: facts.scopeMessages[0] };
  assert.equal(r05GoalEvidence(input).ok, false);
});
test("R05 整条Writer请求6000+1000原生页再加完整7000 Scope必须判重复", () => {
  const input = goalInput();
  input.requests[1] = nativePagedRequest(writerScope());
  assert.equal(Buffer.byteLength(SOURCE.prose, "utf8"), 21000);
  assert.equal(r05GoalEvidence(input).checks.baseline_once, false);
});
test("R05 同次原生两页已完整供应时无需新Scope再复制全文，设计预览omissions不否定正文", () => {
  const input = goalInput(), scope = writerScope();
  scope.operation.context_text = "本章原文由本次请求中已读取的两页提供。";
  input.requests[1] = nativePagedRequest(scope);
  const report = r05GoalEvidence(input);
  assert.equal(report.checks.full_prose_supplied, true, JSON.stringify(report));
  assert.equal(report.checks.baseline_once, true, JSON.stringify(report));
  assert.equal(report.ok, true, JSON.stringify(report));
});
test("R05 页供应必须同fresh版本/hash/原文/字节范围，目录或坏证据不能补足整章", () => {
  for (const change of [
    (page) => { page.versions[DRAFT] = 8; },
    (page) => { page.versions["draft:unrelated"] = 7; },
    (page) => { page.content.source_hash = "0".repeat(64); },
    (page) => { page.coverage.prose_byte_range.end -= 1; },
    (page) => { page.content.summary = "第02章，已读全文。"; },
    (page) => { page.status = "unavailable"; },
    (page) => { delete page.coverage.prose_range; page.coverage.kind = "directory"; },
  ]) {
    const input = goalInput(), scope = writerScope();
    scope.operation.context_text = "正文已读取，引用现有页。";
    input.requests[1] = nativePagedRequest(scope, { changePage: (page, index) => { if (index === 1) change(page); } });
    assert.equal(r05GoalEvidence(input).checks.full_prose_supplied, false);
  }
});
test("R05 页字节边界来自实际UTF8，ASCII/LF章不能按字符乘三假算", () => {
  const input = goalInput(), scope = writerScope();
  input.source.prose = "首A\n" + "灰".repeat(6996) + "尾";
  assert.equal([...input.source.prose].length, 7000);
  assert.equal(Buffer.byteLength(input.source.prose, "utf8"), 20996);
  scope.operation.context_text = "正文由现有页完整提供。";
  input.requests[1] = nativePagedRequest(scope, { prose: input.source.prose,
    ranges: [[1, 6000, 0, 17996], [6001, 7000, 17996, 20996]] });
  assert.equal(r05GoalEvidence(input).checks.baseline_once, true);
});
test("R05 Writer仅报Observation IDs时须覆盖完整正文，不能只借一个页ref", () => {
  const input = goalInput(), scope = writerScope();
  scope.operation.context_text = "正文由当前两页提供。";
  input.requests[1] = nativePagedRequest(scope);
  input.refs.reports[0].matched_refs = [
    { ref: "observation:page-1", kind: "observation" }, { ref: "observation:page-2", kind: "observation" },
  ];
  assert.equal(r05GoalEvidence(input).checks.used_refs_bound, true);
  for (const ref of ["observation:page-1", "observation:page-2"]) {
    input.refs.reports[0].matched_refs = [{ ref, kind: "observation" }];
    assert.equal(r05GoalEvidence(input).checks.used_refs_bound, false);
  }
});
test("R05 整章修订需要同次 writer 的完整一次 baseline 与准确全章版本范围", () => {
  const report = r05GoalEvidence(goalInput());
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.checks.whole_scope, true);
  assert.equal(report.checks.baseline_once, true);
});
test("R05 当前应用写入的creative_brief副本不能与必要baseline重复供应整章", () => {
  const input = goalInput(); const scope = writerScope();
  scope.operation.creative_brief = "修改要求\n" + SOURCE.prose;
  input.requests[1] = request(scope);
  assert.equal(r05GoalEvidence(input).checks.baseline_once, false);
});
test("R05 refs/material metadata/目录不能替代 writer operation.context_text 原文", () => {
  for (const content of [
    { ...writerScope(), operation: { role: "prose_writer" } },
    { ...writerScope(), operation: { role: "prose_writer", context_text: SOURCE.prose.slice(0, 6000) } },
    { ...writerScope(), operation: { role: "prose_writer", context_text: "正文已全部读取，参考 draft:r05-accepted。" } },
  ]) {
    const input = goalInput(); input.requests[1] = request(content);
    assert.equal(r05GoalEvidence(input).ok, false);
  }
});
test("R05 整章不能借 G2 目标段、错误章/版本/coverage 或重复 baseline 获签", () => {
  for (const change of [
    (input) => { input.candidate.payload.modification_scope = "target_segments"; input.candidate.payload.adoption_effect.mode = "replace_segments"; },
    (input) => { input.candidate.target_chapter_ref = "chapter:other"; },
    (input) => { input.candidate.payload.adoption_effect.expected_base_versions[0].version = 8; },
    (input) => { input.candidate.payload.adoption_effect.coverage = "partial"; },
    (input) => { input.candidate.adoption_status = "ACCEPTED"; },
    (input) => { const scope = writerScope(); scope.authoring_task.scope.modification_scope = "target_segments"; input.requests[1] = request(scope); },
    (input) => { const scope = writerScope(); scope.authoring_task.scope.expected_base_versions[0].version = 6; input.requests[1] = request(scope); },
    (input) => { const scope = writerScope(); scope.operation.context_text += "\n" + SOURCE.prose; input.requests[1] = request(scope); },
    (input) => { input.writer.provider_call_ref = "pcall:another"; },
    (input) => { input.refs.reports[0].provider_run_ref = "prun:another"; },
    (input) => { input.zero_write.ok = false; },
  ]) {
    const input = goalInput(); change(input);
    assert.equal(r05GoalEvidence(input).ok, false);
  }
});
test("R05 风格必须用实际 writer 请求中的真实 memory 身份/版本/全文，application 叶仍为 Base", () => {
  const report = r05GoalEvidence(goalInput("style"));
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.checks.style_body_supplied, true);
  assert.equal(report.materials.style.provenance, "application");
});
test("R05 Archive facet只用真实目标memory条目的完整范围，目录/他条/跨版不能补证", () => {
  const input = goalInput("style"), leaf = styleLeaf();
  leaf.content.tool = "archive_read";
  leaf.content.summary = "风格：对白优先：" + SOURCE.style.body;
  leaf.coverage = { kind: "facet", facet: "preferences", ref: "archive:preferences",
    work_id: SOURCE.work_id, summary: { offset: 0, returned_graphemes: 60, total_graphemes: 60 },
    sources: [{ ref: SOURCE.style.ref, version: 4, status: "CONFIRMED", source_type: "AUTHOR_CONFIRMED",
      offset: 0, returned_graphemes: [...SOURCE.style.body].length,
      total_graphemes: [...SOURCE.style.body].length, offset_unit: "unicode_grapheme", version_status: "known" }] };
  input.requests[1] = request(writerScope(), { leaves: [leaf] });
  assert.equal(r05GoalEvidence(input).ok, true);
  for (const change of [
    (value) => { value.coverage.kind = "directory"; },
    (value) => { value.coverage.sources[0].ref = "memory:other"; },
    (value) => { value.coverage.sources[0].version = 3; },
    (value) => { value.coverage.sources[0].offset = 1; },
    (value) => { value.coverage.sources[0].returned_graphemes -= 1; },
  ]) {
    const changed = structuredClone(leaf); change(changed);
    input.requests[1] = request(writerScope(), { leaves: [changed] });
    assert.equal(r05GoalEvidence(input).ok, false);
  }
});
test("R05 风格改写允许真实目标段修订，Task无虚构段字段，版本与operation目标块一致", () => {
  const input = goalInput("style"), scope = writerScope();
  input.source.prose = "开头保留铜铃。\n\n结尾保留手印。";
  scope.operation.context_text = input.source.prose;
  const segment = { segment_id: "segment:r05:1",
    sha256: createHash("sha256").update("开头保留铜铃。\n\n", "utf8").digest("hex"), text: "开头保留铜铃。" };
  scope.authoring_task.scope.modification_scope = "target_segments";
  scope.operation.context_text += "\n\n## 本轮局部修订目标段\n" + JSON.stringify([segment]);
  input.requests[1] = request(scope, { leaves: [styleLeaf()] });
  input.candidate.payload.modification_scope = "target_segments";
  const binding = { covered: [DRAFT + ":7"], base_versions: [{ ref: DRAFT, version: 7 }],
    target_segment_ids: [segment.segment_id],
    expected_segment_hashes: [{ segment_id: segment.segment_id, sha256: segment.sha256 }],
    base_draft_ref: DRAFT, base_version: 7 };
  input.candidate.payload.adoption_effect = { mode: "replace_segments", ...binding };
  input.candidate.payload.scope = { kind: "target_segments", target_chapter_ref: CHAPTER,
    covered_refs: [DRAFT], preserve_unmentioned_verbatim: true, ...binding };
  assert.equal(r05GoalEvidence(input).ok, true);
  for (const change of [
    (value) => { value.candidate.payload.adoption_effect.base_version = 8; },
    (value) => { value.candidate.payload.adoption_effect.base_versions[0].version = 8; },
    (value) => { value.candidate.payload.adoption_effect.target_segment_ids = ["segment:other"]; },
    (value) => { value.candidate.payload.adoption_effect.expected_segment_hashes[0].sha256 = "b".repeat(64); },
    (value) => { value.candidate.payload.scope.target_chapter_ref = "chapter:other"; },
    (value) => { value.candidate.payload.scope.preserve_unmentioned_verbatim = false; },
    (value) => {
      const changedScope = structuredClone(scope);
      changedScope.operation.context_text = input.source.prose;
      value.requests[1] = request(changedScope, { leaves: [styleLeaf()] });
    },
  ]) {
    const changed = structuredClone(input); change(changed);
    assert.equal(r05GoalEvidence(changed).ok, false);
  }
});
test("R05 风格改写不能由append新段候选代签", () => {
  const input = goalInput("style");
  input.candidate.payload.modification_scope = "append";
  input.candidate.payload.adoption_effect = { mode: "append" };
  assert.equal(r05GoalEvidence(input).ok, false);
});
test("R05 风格 summary、假 count-ref、旧版本、partial、历史请求及metadata均不授全文资格", () => {
  for (const change of [
    (leaf) => { leaf.content.summary = "风格：对白优先"; },
    (leaf) => { leaf.source_refs = ["memory:2"]; leaf.versions = { "memory:2": 4 }; },
    (leaf) => { leaf.versions[SOURCE.style.ref] = 3; },
    (leaf) => { leaf.status = "partial"; leaf.coverage.summary.returned_graphemes = 10; leaf.next_offset = 10; },
    (leaf) => { leaf.status = "unavailable"; },
  ]) {
    const input = goalInput("style"); const leaf = styleLeaf(); change(leaf);
    input.requests[1] = request(writerScope(), { leaves: [leaf] });
    assert.equal(r05GoalEvidence(input).ok, false);
  }
  const input = goalInput("style");
  input.requests.unshift(request({}, { call: "pcall:old", leaves: [styleLeaf()] }));
  input.requests[2] = request(writerScope());
  assert.equal(r05GoalEvidence(input).ok, false);
});

function candidateViews(items, message) {
  const [item] = items;
  const original = flatPending.items.revision;
  const knownItems = [flatPending.items.source, { itemTitle: item.title, itemBody: item.body }];
  const nodesFor = (entry) => structuredClone(flatPending.nodes).map((node) => {
    if (node.role === "AXPopUpButton" && node.desc === "作品") node.title = G2_VISIBLE_TARGET.work_title;
    if (node.path === "0/0/0/0/0/25/0") node.value = message;
    if (node.value === original.itemTitle) node.value = item.title;
    if (node.value === original.itemBody) node.value = item.body;
    if (node.path === "0/0/0/0/0/33/0/0") node.frame = [456, entry ? 180 : -1400, 400, 25];
    if (node.path === "0/0/0/0/0/33/1/0") node.frame = [456, entry ? 215 : -1600, 538, 1900];
    if (node.path === "0/0/0/0/0/33") node.frame = [443, entry ? 160 : -1650, 564, 2100];
    if (node.path === "0/0/0/0/0/34") {
      node.title = "保存修订稿";
      node.desc = "保存后替换本候选的修订范围。";
      node.frame = [443, entry ? 2200 : 360, 130, 39];
    }
    return node;
  });
  return { known_items: knownItems, candidate_views: [
    { capture: "r05-candidate-1-entry", nodes: nodesFor(true), screenshot_present: true, window_capture: true },
    { capture: "r05-candidate-1-action", nodes: nodesFor(false), screenshot_present: true, window_capture: true },
  ] };
}
function visibleInput(goal, { candidate = false } = {}) {
  const message = "请完成本次作者目标。";
  const reply = candidate ? "整章修订候选已就绪。" : "共2章，有正文1章，未写正文1章。";
  const items = candidate ? [{ title: "整章修订稿", body: SOURCE.prose }] : [];
  return { goal, target: G2_VISIBLE_TARGET, message, reply, items,
    ...(candidate ? candidateViews(items, message) : {}),
    afterInputText: visibleAfterInput(message), readingBeforeText: visibleReadingPage(),
    readingAfterText: visibleReadingPage(), finalText: [
      G2_VISIBLE_TARGET.work_title, "你", message, "AI 助手", reply,
      ...items.flatMap((item) => [item.title, item.body]),
      ...(candidate ? ["保存修订稿", "放弃修订稿"] : []), "(value=已完成)",
    ].join("\n") };
}
test("R05 count 页面不强迫 chapter_read，原 G3 的读活动规则仍独立拒绝", () => {
  const input = visibleInput("count");
  assert.equal(r05VisibleEvidence(input).ok, true);
  const old = g3VisibleEvidence(input);
  assert.equal(old.ok, false);
  assert(old.failures.includes("reading_activity_missing"));
});
test("R05 whole 长候选入口和所属保存按钮分屏可见，旧G2目标段oracle不代签", () => {
  const input = visibleInput("whole", { candidate: true });
  const report = r05VisibleEvidence(input);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.observed.candidate_entry_visible, true);
  assert.equal(report.observed.candidate_action_visible, true);
  assert.equal(g2VisibleEvidence(input).ok, false);
});
test("R05 候选截图不能借另一作品或缺当前作者原话的旧回合AX", () => {
  for (const change of [
    (node) => { if (node.role === "AXPopUpButton" && node.desc === "作品") node.title = "另一作品"; },
    (node) => { if (node.path === "0/0/0/0/0/25/0") node.value = "上一轮原话"; },
  ]) {
    const input = visibleInput("whole", { candidate: true });
    for (const view of input.candidate_views) view.nodes.forEach(change);
    assert.equal(r05VisibleEvidence(input).ok, false);
  }
});
test("R05 AX离屏全文/作者仍存在，但viewport仅剩输入框时不能签作者看见候选", () => {
  const input = visibleInput("whole", { candidate: true });
  for (const view of input.candidate_views) {
    for (const node of view.nodes) {
      if (node.path.startsWith("0/0/0/0/0/33") || node.path === "0/0/0/0/0/34") {
        node.frame[1] = 2500;
      }
    }
  }
  assert.equal(r05VisibleEvidence(input).ok, false);
});
test("R05 正文中的保存字样、兄弟候选按钮、disabled动作及缺窗口截图都不能代签", () => {
  for (const change of [
    (input) => {
      for (const view of input.candidate_views) {
        const node = view.nodes.find((entry) => entry.path === "0/0/0/0/0/34");
        node.role = "AXStaticText"; node.title = ""; node.desc = ""; node.value = "保存修订稿";
      }
    },
    (input) => {
      for (const view of input.candidate_views) {
        view.nodes = view.nodes.filter((entry) => entry.path !== "0/0/0/0/0/34");
        const old = view.nodes.find((entry) => entry.role === "AXButton" && entry.title === "保存到作品档案");
        assert(old); old.title = "保存修订稿";
      }
    },
    (input) => { input.candidate_views[1].nodes.find((node) => node.path === "0/0/0/0/0/34").enabled = false; },
    (input) => { input.candidate_views[0].screenshot_present = false; },
    (input) => { input.candidate_views[1].window_capture = false; },
    (input) => { input.candidate_views = []; },
  ]) {
    const input = visibleInput("whole", { candidate: true }); change(input);
    assert.equal(r05VisibleEvidence(input).ok, false);
  }
});
test("R05 页面仍拒绝旧作者回合、只剩状态徽标、错误当前候选和阅读被改写", () => {
  for (const change of [
    (input) => { input.finalText = input.finalText.replace(input.message, "上一轮原话"); },
    (input) => { input.finalText = input.finalText.replace(input.reply, ""); },
    (input) => { input.items[0].body = "另一个候选的全文"; },
    (input) => { input.readingAfterText += "\n正文已被采纳改写"; },
  ]) {
    const input = visibleInput("whole", { candidate: true }); change(input);
    assert.equal(r05VisibleEvidence(input).ok, false);
  }
});
