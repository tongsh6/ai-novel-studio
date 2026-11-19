// B82 §7 G2 页级证据：两页真实形状、前置非页调用、错版本、缺版本与迟到回放。
// 只构造 fixture IR / provider_events / llm-calls 的采集形状，不启动产品、不读真实档案。
import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORING_REQUEST_IR } from "./authoring_request_facts.mjs";
import {
  axAuthorMessages,
  axTurnOutcome,
  countAxAuthorMessages,
  g2CandidateEvidence,
  g2PageEvidence,
  g2PageUsageEvidence,
  g2VisibleEvidence,
  g3VisibleEvidence,
} from "./authoring_g2_evidence.mjs";
import { g2UsageReport } from "./authoring_run_evidence.mjs";

const TOTAL = 7000;
const PROSE = Array.from({ length: TOTAL }, (_, index) => String.fromCodePoint(0x4e00 + index)).join("");
const CHAPTER = "chapter:target";
const DRAFT = "draft:target";
const VERSION_KEY = DRAFT;

const message = (role, provenance, blocks, extra = {}) => ({
  role, provenance, blocks, source_refs: [], versions: {}, ...extra,
});
const text = (value) => ({ type: "text", text: value });
const pageBody = (start, end) => PROSE.slice(start - 1, end);

function observation({ callId, start, end, versions, chapter = CHAPTER, observationRef = null }) {
  const body = pageBody(start, end);
  const trailer = end === 6000 ? `\n【续读】剩余 ${TOTAL - end} 字符；用 {"offset":6000} 继续。` : "";
  return {
    type: "observation",
    call_id: callId,
    status: "ok",
    versions,
    coverage: { chapter_ref: chapter, prose_range: { start, end }, prose_total_chars: TOTAL },
    next_offset: end === 6000 ? end : null,
    content: {
      tool: "chapter_read",
      query: JSON.stringify({ chapter_ref: chapter, offset: start - 1 }),
      ...(observationRef === null ? {} : { observation_ref: observationRef }),
      summary: `「灰烬中的手印」\n【正文】第 ${start}–${end} 字符 / 共 ${TOTAL} 字符\n${body}${trailer}`,
    },
    source_refs: [chapter],
    omissions: [],
  };
}

const call = (id) => message("assistant", "model", [{
  type: "tool_call",
  call_id: `call-${id}`,
  name: "judgment_decision",
  arguments: { action: "explore", explore_request: { tool: "chapter_read" } },
}], { provider_call_ref: `pcall-${id}`, provider_run_ref: `prun-${id}` });
const tool = (payload) => message("tool", "tool_result", [payload]);
const record = (id, messages) => ({
  request_format: AUTHORING_REQUEST_IR,
  provider_call_ref: `pcall-${id}`,
  provider_run_ref: `prun-${id}`,
  request_body: { ir_version: AUTHORING_REQUEST_IR, messages, tools: [], run: {}, projection: {}, refs: {} },
});
const start = (id) => ({ provider_run_id: `prun-${id}`, provider_call_ref: `pcall-${id}`, emitted_at: `t${id}` });

function fixture({ versions = { [VERSION_KEY]: 2 }, page2 = null, pageRefs = [] } = {}) {
  const base = [
    message("application_base", "application", [text("本 run 的应用数据")], { source_refs: [{ ref: "ctx-1" }] }),
    message("user", "author", [text("请核对正文")], { source_refs: [{ ref: "msg-1" }] }),
  ];
  const pre = call(0);
  const preObservation = observation({ callId: "call-0", start: 1, end: 6000, chapter: "chapter:other", versions });
  const first = call(3);
  const firstObservation = observation({
    callId: "call-3", start: 1, end: 6000, versions, observationRef: pageRefs[0] ?? null,
  });
  const second = call(4);
  const secondObservation = page2 ?? observation({
    callId: "call-4", start: 6001, end: 7000, versions, observationRef: pageRefs[1] ?? null,
  });
  const before = [...base, pre, tool(preObservation)];
  return {
    transcript: { messages: [pre, tool(preObservation), first, tool(firstObservation), second, tool(secondObservation)] },
    records: [
      record(0, base),
      record(1, before),
      record(2, before),
      record(3, before),
      record(4, [...before, first, tool(firstObservation)]),
      record(5, [...before, first, tool(firstObservation), second, tool(secondObservation)]),
    ],
    starts: [0, 1, 2, 3, 4, 5].map(start),
  };
}

function plannedParent({ callId, status = "ok", leaves }) {
  return {
    type: "observation",
    call_id: callId,
    status,
    source_refs: [...new Set(leaves.flatMap((entry) => entry.source_refs))],
    coverage: { coverage_note: "计划内只读", continuation_hint: null },
    omissions: leaves.flatMap((entry) => entry.omissions),
    content: {
      tool: "planned_exploration",
      query: leaves.map((entry) => entry.content.tool).join(" / "),
      summary: `计划内只读检索完成（${leaves.length} 次：chapter_read）`,
      observations: leaves,
    },
  };
}

// 叶没有 type/call_id；真正调用身份属于父块。
function leafOf(block) {
  const { type, call_id, ...leaf } = block;
  return leaf;
}

// 单一真实 native 调用（call-3）的聚合父 observation 内放两页，父后紧邻下一请求。
function aggregateFixture({
  parentStatus = "ok",
  versions = { [VERSION_KEY]: 2 },
  page2Versions = versions,
  pageRefs = [],
} = {}) {
  const base = [
    message("application_base", "application", [text("本 run 的应用数据")], { source_refs: [{ ref: "ctx-1" }] }),
    message("user", "author", [text("请核对正文")], { source_refs: [{ ref: "msg-1" }] }),
  ];
  const first = call(3);
  const parent = plannedParent({
    callId: "call-3",
    status: parentStatus,
    leaves: [
      leafOf(observation({
        callId: "call-3", start: 1, end: 6000, versions, observationRef: pageRefs[0] ?? null,
      })),
      leafOf(observation({
        callId: "call-3", start: 6001, end: 7000, versions: page2Versions, observationRef: pageRefs[1] ?? null,
      })),
    ],
  });
  return {
    transcript: { messages: [first, tool(parent)] },
    records: [
      record(0, base),
      record(1, base),
      record(2, base),
      record(3, base),
      record(4, [...base, first, tool(parent)]),
    ],
    starts: [0, 1, 2, 3, 4].map(start),
  };
}

const run = (input) => g2PageEvidence({ chapterRef: CHAPTER, draftRef: DRAFT, revision: 2, prose: PROSE, ...input });

test("两页 revision 2：前置非页调用后仍按 call_id 找到第 4 条 started 和紧邻请求", () => {
  const result = run(fixture());
  assert.equal(result.ok, true);
  assert.deepEqual(result.pages.map((page) => page.range), [[1, 6000], [6001, 7000]]);
  assert.equal(result.pages[0].source.started_index, 3);
  assert.equal(result.pages[0].next.started_index, 4);
  assert.equal(result.pages[1].source.started_index, 4);
  assert.equal(result.pages[1].next.started_index, 5);
  assert.deepEqual(result.pages.map((page) => page.reason), [null, null]);
  assert.equal(JSON.stringify(result).includes(pageBody(1, 6000)), false);
});

test("错版本必须逐页失败，另一页仍通过", () => {
  const result = run(fixture({ page2: observation({ callId: "call-4", start: 6001, end: 7000, versions: { [VERSION_KEY]: 1 } }) }));
  assert.equal(result.ok, false);
  assert.equal(result.pages[0].reason, null);
  assert.equal(result.pages[1].reason, "version_mismatch");
});

test("真实 c7-c8-03 形状：版本缺失不代签，但保留来源与下一请求", () => {
  const result = run(fixture({ versions: {} }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.pages.map((page) => page.reason), ["version_missing", "version_missing"]);
  assert.equal(result.pages[0].source.started_index, 3);
  assert.equal(result.pages[0].next.started_index, 4);
});

test("源请求已经带有自己的结果时拒绝", () => {
  const input = fixture();
  const secondObservation = observation({ callId: "call-4", start: 6001, end: 7000, versions: { [VERSION_KEY]: 2 } });
  input.records[4].request_body.messages = [...input.records[4].request_body.messages, tool(secondObservation)];
  const result = run(input);
  assert.equal(result.pages[0].reason, null);
  assert.equal(result.pages[1].reason, "source_already_has_result");
});

test("观察迟到到后续请求而不是紧邻请求时拒绝", () => {
  const input = fixture();
  const secondObservation = observation({ callId: "call-4", start: 6001, end: 7000, versions: { [VERSION_KEY]: 2 } });
  input.records[5].request_body.messages = input.records[5].request_body.messages.slice(0, -1);
  input.records.push(record(6, [...input.records[5].request_body.messages, tool(secondObservation)]));
  input.starts.push(start(6));
  const result = run(input);
  assert.equal(result.pages[1].reason, "late_replay");
});

test("下一请求 payload 与 canonical 观察深等", () => {
  const input = fixture();
  const second = observation({ callId: "call-4", start: 6001, end: 7000, versions: { [VERSION_KEY]: 2 } });
  second.content.summary = second.content.summary.replace("灰", "烬");
  input.records[5].request_body.messages[input.records[5].request_body.messages.length - 1] = tool(second);
  const result = run(input);
  assert.equal(result.pages[1].reason, "next_payload_mismatch");
});

// ── planned_exploration 聚合父块：同一次真实调用内两页各自核对 ──────────────
test("同一实际父调用聚合两页：各自核对版本/范围，共享真正父 call_id 与紧邻请求", () => {
  const result = run(aggregateFixture({ pageRefs: ["observation:obs-page-1", "observation:obs-page-2"] }));
  assert.equal(result.ok, true, JSON.stringify(result.pages));
  assert.deepEqual(result.pages.map((page) => page.call_id), ["call-3", "call-3"]);
  assert.deepEqual(result.pages.map((page) => page.source.started_index), [3, 3]);
  assert.deepEqual(result.pages.map((page) => page.next.started_index), [4, 4]);
  assert.deepEqual(
    result.pages.map((page) => page.observation_ref),
    ["observation:obs-page-1", "observation:obs-page-2"],
  );
});

test("聚合父内一页错版本或缺版本时逐页失败，另一页仍通过", () => {
  const mismatch = run(aggregateFixture({ page2Versions: { [VERSION_KEY]: 1 } }));
  assert.equal(mismatch.ok, false);
  assert.deepEqual(mismatch.pages.map((page) => page.reason), [null, "version_mismatch"]);

  const missing = run(aggregateFixture({ page2Versions: {} }));
  assert.deepEqual(missing.pages.map((page) => page.reason), [null, "version_missing"]);
});

test("紧邻请求改动聚合内任一叶时完整父 payload 不一致，两页都不签", () => {
  const input = aggregateFixture();
  const next = structuredClone(input.records[4].request_body.messages.at(-1));
  const leaf = next.blocks[0].content.observations[1];
  leaf.content.summary = leaf.content.summary.replace("灰", "烬");
  input.records[4].request_body.messages = [
    ...input.records[4].request_body.messages.slice(0, -1),
    next,
  ];
  const result = run(input);
  assert.equal(result.ok, false);
  assert.deepEqual(result.pages.map((page) => page.reason), ["next_payload_mismatch", "next_payload_mismatch"]);
});

test("聚合内非 chapter_read 叶不认页", () => {
  const input = aggregateFixture();
  const other = leafOf(observation({ callId: "call-3", start: 1, end: 6000, versions: { [VERSION_KEY]: 2 } }));
  other.content.tool = "memory_search";
  input.transcript.messages[1].blocks[0].content.observations.push(other);
  input.records[4].request_body.messages.at(-1).blocks[0].content.observations.push(structuredClone(other));
  const result = run(input);
  assert.equal(result.ok, true, JSON.stringify(result.pages));
  assert.deepEqual(result.pages.map((page) => page.call_id), ["call-3", "call-3"]);
});

test("聚合父 status unavailable 时即使叶 status=ok 也不通过", () => {
  const result = run(aggregateFixture({ parentStatus: "unavailable" }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.pages.map((page) => page.reason), ["observation_status", "observation_status"]);
});

// ── B82 §7/§16.9 候选证据：实际 B28 scope3 形状 ────────────────────────────
const TOPIC = "workspace:test";
const RUN = "run-g2-1";
const ACK_AT = "2026-11-03T10:00:00.600Z";
const RESULT_AT = "2026-11-03T10:00:02.000Z";
const ITEM = {
  item_id: "item-g2-1",
  title: "第 2 章指定片段修订",
  body: "雨声压在窗棂上，沈砚把信纸翻到背面。",
  rationale: "只改指定片段。",
  provider_call_ref: "pcall-writer",
};
const WRITER = {
  id: "call-writer",
  name: "submit_tentative_artifact",
  arguments: { items: [ITEM] },
};
const CANDIDATE = {
  artifact_id: "as-g2-1",
  artifact_type: "prose_fragment",
  adoption_status: "TENTATIVE",
  target_chapter_ref: CHAPTER,
  payload: {
    modification_scope: "target_segments",
    adoption_effect: { mode: "replace_segments" },
    items: [ITEM],
  },
};

const resultRecord = (body, at = RESULT_AT) => ({
  at,
  direction: "received",
  frame: [null, null, TOPIC, "turn_result", body],
});
const ackRecord = () => ({
  at: ACK_AT,
  direction: "received",
  frame: ["3", "4", TOPIC, "phx_reply", { status: "ok", response: { turn_id: "turn-g2-1", run_id: RUN } }],
});
const turnBody = (overrides = {}) => ({
  turn_id: "turn-g2-1:agent:2",
  status: "conversational",
  work_id: "work-g2",
  session_id: "session-g2",
  agent_run: { run_id: RUN, parent_turn_ref: "turn-g2-1", status: "running" },
  adoption_state: { pending: [CANDIDATE], resolved: [] },
  ...overrides,
});
const runRow = (overrides = {}) => ({
  id: RUN,
  workspace_id: "test",
  work_id: "work-g2",
  session_id: "session-g2",
  parent_turn_ref: "turn-g2-1",
  status: "completed",
  ...overrides,
});
const writerRecord = (items = [ITEM]) => ({
  provider_call_ref: ITEM.provider_call_ref,
  response: { status: 200, body: { source: "sse_decoder", tool_calls: [{ ...WRITER, arguments: { items } }] } },
});
const candidateInput = (overrides = {}) => ({
  facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(turnBody())] },
  run: runRow(),
  pending: [CANDIDATE.artifact_id],
  chapterRef: CHAPTER,
  records: [writerRecord()],
  beforeText: "工作台\n等待创作请求\n",
  finalText: `${ITEM.title}\n${ITEM.body}\n保存为章节正文\n`,
  ...overrides,
});
const candidateRun = (overrides = {}) => g2CandidateEvidence(candidateInput(overrides));

test("候选证据正例：唯一 completed 终局、本 run pending、scope/effect 与 writer 字节成立", () => {
  const result = candidateRun();
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.reason, null);
  assert.equal(result.pending_ref, CANDIDATE.artifact_id);
  assert.deepEqual(result.item_refs, [ITEM.item_id]);
  assert.equal(result.provider_call_ref, ITEM.provider_call_ref);
  assert.equal(result.writer_item_count, 1);
  assert.equal(result.visible.before_has_item, false);
  assert.equal(result.visible.final_has_item, true);
  assert.equal(JSON.stringify(result).includes(ITEM.body), false);
});

test("候选证据只认 ACK 后本 run 的唯一 completed 终局", () => {
  const foreign = turnBody({ agent_run: { run_id: "run-foreign", status: "completed" } });
  assert.equal(candidateRun({ facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(foreign)] } }).reason, "completed_result_missing");
  assert.equal(candidateRun({ facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(turnBody(), "2026-11-03T10:00:00.500Z")] } }).reason, "completed_result_missing");
  assert.equal(candidateRun({ facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(turnBody()), resultRecord(turnBody(), "2026-11-03T10:00:03.000Z")] } }).reason, "completed_result_ambiguous");
  assert.equal(candidateRun({ run: runRow({ status: "running" }) }).reason, "run_not_completed");
  assert.equal(candidateRun({ run: runRow({ status: undefined }) }).reason, "run_not_completed");
  assert.equal(candidateRun({ run: runRow({ status: "running" }),
    facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(turnBody({
      agent_run: { run_id: RUN, parent_turn_ref: "turn-g2-1", status: "completed" } }))] } }).reason, "run_not_completed");
  assert.equal(candidateRun({ facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(turnBody({ work_id: "work-other" }))] } }).reason, "work_mismatch");
});

test("候选证据：终局身份必须精确等于 run，缺字段不签", () => {
  const withBody = (body) => ({
    facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(body)] },
  });
  assert.equal(candidateRun(withBody(turnBody({ work_id: undefined }))).reason, "work_mismatch");
  assert.equal(candidateRun(withBody(turnBody({ work_id: null }))).reason, "work_mismatch");
  assert.equal(candidateRun(withBody(turnBody({ session_id: undefined }))).reason, "session_mismatch");
  assert.equal(candidateRun(withBody(turnBody({ session_id: "session-other" }))).reason, "session_mismatch");
});

test("候选证据必须唯一落在目标章且在本 run pending ids", () => {
  const otherChapter = { ...CANDIDATE, target_chapter_ref: "chapter:other" };
  assert.equal(candidateRun({ facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(turnBody({ adoption_state: { pending: [otherChapter] } }))] } }).reason, "candidate_missing");
  assert.equal(candidateRun({ pending: [] }).reason, "pending_missing");
  assert.equal(candidateRun({ pending: ["as-other"] }).reason, "pending_not_in_run");
  const duplicate = { ...CANDIDATE, artifact_id: "as-g2-2" };
  assert.equal(candidateRun({ facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(turnBody({ adoption_state: { pending: [CANDIDATE, duplicate] } }))] }, pending: [CANDIDATE.artifact_id, duplicate.artifact_id] }).reason, "candidate_ambiguous");
});

test("候选证据：历史同章候选同帧并存时不抢占当前候选", () => {
  const historical = {
    ...CANDIDATE,
    artifact_id: "as-g2-old",
    payload: { ...CANDIDATE.payload, items: [{ ...ITEM, item_id: "item-g2-old" }] },
  };
  const body = turnBody({ adoption_state: { pending: [historical, CANDIDATE] } });
  const result = candidateRun({
    facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(body)] },
    pending: [CANDIDATE.artifact_id],
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.pending_ref, CANDIDATE.artifact_id);
  assert.deepEqual(result.item_refs, [ITEM.item_id]);
});

test("候选证据 scope/effect 必须精确匹配实际 B28 scope3", () => {
  const scoped = (payload) => turnBody({ adoption_state: { pending: [{ ...CANDIDATE, payload: { ...CANDIDATE.payload, ...payload } }] } });
  assert.equal(candidateRun({ facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(scoped({ modification_scope: "whole_chapter" }))] } }).reason, "scope_mismatch");
  assert.equal(candidateRun({ facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(scoped({ adoption_effect: { mode: "replace_scope" } }))] } }).reason, "effect_mismatch");
});

test("候选证据 writer 原字节被篡改时不签", () => {
  const tampered = { ...ITEM, title: `${ITEM.title}（改）` };
  const body = turnBody({ adoption_state: { pending: [{ ...CANDIDATE, payload: { ...CANDIDATE.payload, items: [tampered] } }] } });
  assert.equal(candidateRun({ facts: { turnId: "turn-g2-1", ack: ackRecord(), results: [resultRecord(body)] } }).reason, "writer_item_field_mismatch");
});

test("候选证据要求 baseline 与最终可见，且输入前不是同一 item 文本", () => {
  assert.equal(candidateRun({ beforeText: null }).reason, "baseline_visible_missing");
  assert.equal(candidateRun({ beforeText: "" }).reason, "baseline_visible_missing");
  assert.equal(candidateRun({ beforeText: " \n\t" }).reason, "baseline_visible_missing");
  assert.equal(candidateRun({ finalText: `${ITEM.title}\n` }).reason, "final_visible_missing");
  assert.equal(candidateRun({ finalText: null }).reason, "final_visible_missing");
  assert.equal(candidateRun({ beforeText: `${ITEM.title}\n${ITEM.body}\n` }).reason, "visible_preexisting");
});

// ── B82 §7 G2 页级使用证据：writer 自报报告里的 content observation 身份 ──────
const PAGE_REFS = ["observation:obs-page-1", "observation:obs-page-2"];
const PAGE_CALLS = ["call-3", "call-4"];

function usageReport({
  pcall = ITEM.provider_call_ref,
  refs = PAGE_REFS,
  calls = PAGE_CALLS,
  channels = ["content_observation_ref", "content_observation_ref"],
  status = "verified",
} = {}) {
  return {
    provider_call_ref: pcall,
    provider_run_ref: "prun-writer",
    status,
    matched_refs: refs.map((ref, index) => ({
      ref,
      kind: "observation",
      sources: [{ channel: channels[index], call_id: calls[index], status: "ok" }],
    })),
  };
}

const usagePages = () => run(fixture({ pageRefs: PAGE_REFS }));
const usageRun = (overrides = {}) => g2PageUsageEvidence({
  pages: usagePages(),
  candidate: candidateRun(),
  reports: [usageReport()],
  ...overrides,
});

test("页证据携带 canonical observation 的现有 call_id 与 observation_ref", () => {
  const result = run(fixture({ pageRefs: PAGE_REFS }));
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.pages.map((page) => [page.call_id, page.observation_ref]),
    [[PAGE_CALLS[0], PAGE_REFS[0]], [PAGE_CALLS[1], PAGE_REFS[1]]],
  );
});

test("旧档案页没有 content.observation_ref：页证据仍通过，usage 缺证", () => {
  const result = run(fixture());
  assert.equal(result.ok, true);
  assert.deepEqual(result.pages.map((page) => page.observation_ref), [null, null]);
  assert.equal(
    g2PageUsageEvidence({ pages: result, candidate: candidateRun(), reports: [usageReport()] }).ok,
    false,
  );
});

test("页级使用证据正例：writer 自报报告按 pcall 唯一绑定并逐页命中 content observation 身份", () => {
  const result = usageRun();
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.reason, null);
  assert.equal(result.writer_report_ref, ITEM.provider_call_ref);
  assert.deepEqual(
    result.pages.map((page) => [page.observation_ref, page.call_id, page.reason]),
    [
      [PAGE_REFS[0], PAGE_CALLS[0], null],
      [PAGE_REFS[1], PAGE_CALLS[1], null],
    ],
  );
  assert.equal(JSON.stringify(result).includes(pageBody(1, 6000)), false);
});

test("页级使用证据：同一父 call_id 下两页不同 observation_ref 仍各自成立", () => {
  const pages = run(aggregateFixture({ pageRefs: PAGE_REFS }));
  const report = usageReport({ calls: [PAGE_CALLS[0], PAGE_CALLS[0]] });
  const result = g2PageUsageEvidence({ pages, candidate: candidateRun(), reports: [report] });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.reason, null);
  assert.deepEqual(
    result.pages.map((page) => [page.observation_ref, page.call_id, page.reason]),
    [
      [PAGE_REFS[0], PAGE_CALLS[0], null],
      [PAGE_REFS[1], PAGE_CALLS[0], null],
    ],
  );
});

test("页级使用证据：两页同 ref 且该 ref 来源含两 call 时歧义拒签", () => {
  const report = {
    provider_call_ref: ITEM.provider_call_ref,
    provider_run_ref: "prun-writer",
    status: "verified",
    matched_refs: [{
      ref: PAGE_REFS[0],
      kind: "observation",
      sources: PAGE_CALLS.map((call_id) => ({
        channel: "content_observation_ref",
        call_id,
        status: "ok",
      })),
    }],
  };
  const result = usageRun({
    pages: run(fixture({ pageRefs: [PAGE_REFS[0], PAGE_REFS[0]] })),
    reports: [report],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "page_observation_ref_ambiguous");
  assert.deepEqual(result.pages.map((page) => page.reason), [null, null]);
});

test("页级使用证据只在页与候选成立后判定", () => {
  assert.equal(
    g2PageUsageEvidence({
      pages: run(fixture({ versions: {} })),
      candidate: candidateRun(),
      reports: [usageReport()],
    }).reason,
    "pages_not_ok",
  );
  assert.equal(
    g2PageUsageEvidence({
      pages: usagePages(),
      candidate: candidateRun({ beforeText: null }),
      reports: [usageReport()],
    }).reason,
    "candidate_not_ok",
  );
});

test("页级使用证据：另一 writer 的报告不能补证", () => {
  assert.equal(usageRun({ reports: [usageReport({ pcall: "pcall-other" })] }).reason, "writer_report_missing");
  const other = usageReport({ pcall: "pcall-other" });
  const bare = usageReport({ refs: [], calls: [] });
  assert.equal(usageRun({ reports: [bare, other] }).reason, "page_usage_missing");
});

test("页级使用证据：同一 pcall 出现多份自报报告时不签", () => {
  const duplicate = { ...usageReport(), provider_run_ref: "prun-writer-2" };
  assert.equal(usageRun({ reports: [usageReport(), duplicate] }).reason, "writer_report_ambiguous");
});

test("页级使用证据：self_report 未验证时缺证", () => {
  assert.equal(usageRun({ reports: [usageReport({ status: "empty" })] }).reason, "writer_report_not_verified");
  assert.equal(usageRun({ reports: [usageReport({ status: "unknown" })] }).reason, "writer_report_not_verified");
});

test("页级使用证据：同 ref 错 call 不能补证该页", () => {
  const result = usageRun({ reports: [usageReport({ calls: ["call-other", PAGE_CALLS[1]] })] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "page_usage_missing");
  assert.equal(result.pages[0].reason, "page_observation_ref_unmatched");
  assert.equal(result.pages[1].reason, null);
});

test("页级使用证据：Base 与 scope-only 来源不能补证", () => {
  for (const channel of ["source_refs", "text", "materials", "scope_object", "chapter_ref"]) {
    const result = usageRun({
      reports: [usageReport({ channels: [channel, "content_observation_ref"] })],
    });
    assert.equal(result.pages[0].reason, "page_observation_ref_unmatched", channel);
    assert.equal(result.pages[1].reason, null, channel);
  }
});

test("页级使用证据：另一观察 ID 不能补证", () => {
  const result = usageRun({
    reports: [usageReport({ refs: ["observation:obs-other", PAGE_REFS[1]] })],
  });
  assert.equal(result.pages[0].reason, "page_observation_ref_unmatched");
  assert.equal(result.pages[1].reason, null);
});

test("页级使用证据：页 observation_ref 缺失时逐页缺证", () => {
  const pages = run(fixture({ pageRefs: [PAGE_REFS[0]] }));
  const result = g2PageUsageEvidence({ pages, candidate: candidateRun(), reports: [usageReport()] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.pages.map((page) => page.reason), [null, "observation_ref_missing"]);
});

test("页级使用证据报告只含 refs/理由", () => {
  const result = usageRun();
  assert.equal(JSON.stringify(result).includes(ITEM.title), false);
  assert.equal(JSON.stringify(result).includes(ITEM.body), false);
});

test("g2UsageReport 合入既有报告：只带 refs/理由且不签 G2", () => {
  const report = g2UsageReport({
    config: { scenario_id: "b82-g2" },
    pages: usagePages(),
    candidate: candidateRun(),
    refs: { reports: [usageReport()] },
  });
  assert.equal(report.ok, true, report.reason);
  assert.equal(report.signed_scope, "page_usage_only");
  assert.equal(report.g2_signed, false);
  assert.deepEqual(report.not_signed, ["final"]);
  assert.deepEqual(report.pages.map((page) => page.reason), [null, null]);
});

test("g2UsageReport：页未成立时按缺证拒绝，不越过页证据", () => {
  const report = g2UsageReport({
    config: { scenario_id: "b82-g2" },
    pages: run(fixture({ versions: {} })),
    candidate: candidateRun(),
    refs: { reports: [usageReport()] },
  });
  assert.equal(report.ok, false);
  assert.equal(report.reason, "pages_not_ok");
});

// AX 树归属判据：只构造与本机真实工作台同结构的最小节点（无小说正文）。
const axNode = (path, role, title = "", value = "") => ({ path, role, title, value });

function axMessageGroup(path, text) {
  return [axNode(path, "AXGroup"), axNode(`${path}/0`, "AXStaticText", "", text)];
}

function axProcessGroup(path, statuses = []) {
  return [
    axNode(path, "AXGroup", "本轮创作过程"),
    ...statuses.map((value, index) => axNode(`${path}/${index}`, "AXStaticText", "", value)),
  ];
}

const AX_CONTAINER = "0/0/0/0/0";

function visibleTurnNodes({ author, reply, status = "已完成" }) {
  return [
    axNode("0", "AXWindow"), axNode(AX_CONTAINER, "AXWebArea"),
    { ...axNode(`${AX_CONTAINER}/1`, "AXPopUpButton", "AI 助手"), desc: "助手名称" },
    axNode(`${AX_CONTAINER}/3`, "AXStaticText", "", "无任务"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, author),
    ...axMessageGroup(`${AX_CONTAINER}/12`, "AI 助手"),
    ...axMessageGroup(`${AX_CONTAINER}/13`, reply),
    ...axProcessGroup(`${AX_CONTAINER}/14`, [status]),
    { ...axNode(`${AX_CONTAINER}/16`, "AXButton", "为什么"), desc: "查看这轮回应的依据" },
  ];
}

// ── B82 G2 作者可见判据：只构造实际可达的页面文本形状 ──────────────────────────
const VISIBLE_TARGET = Object.freeze({
  work_title: "灰烬手印验证作品",
  chapter_title: "第02章：灰烬中的手印",
  reading_excerpt: "井底浮现第七枚手印",
});
const VISIBLE_MESSAGE =
  "请先读第02章《灰烬中的手印》已经保存的正文，前后都核对一下，再把发现的重复写法改成一段候选给我看，先不要保存。";
const READING_PAGE = [
  "阅读模式",
  "灰烬手印验证作品",
  "目录",
  "第02章：灰烬中的手印",
  "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。",
  "末页锚点：井底浮现第七枚手印",
].join("\n");
const AFTER_INPUT = [
  "灰烬手印验证作品",
  "你",
  VISIBLE_MESSAGE,
  "AI 助手",
  "当前创作任务工作区",
  "(value=进行中 · 创作)",
].join("\n");
const FIRST_READ =
  "(value=已阅读章节正文「灰烬中的手印」（第 2 章；第 1–6000 字符 / 共 7000 字符）。)";
const LAST_READ = "(value=已阅读章节正文「灰烬中的手印」（第 2 章；第 6001–7000 字符 / 共 7000 字符）。)";
const FINAL_PAGE = [
  "灰烬手印验证作品",
  "你",
  VISIBLE_MESSAGE,
  "AI 助手",
  "本轮创作过程",
  FIRST_READ,
  LAST_READ,
  "第02章：灰烬中的手印（指定段落修订稿）",
  "这是待保存章节草稿。确认保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。预览：指定段落修订稿",
  "指定段落修订稿 他把第七枚手印按进灰里。 创作依据：按作者要求保留原稿其余字句。",
  "修订稿候选",
  "保存修订稿",
  "放弃修订稿",
  "(value=已完成)",
].join("\n");

function visibleEvidence(overrides = {}) {
  return g2VisibleEvidence({
    target: VISIBLE_TARGET,
    message: VISIBLE_MESSAGE,
    afterInputText: AFTER_INPUT,
    finalNodes: visibleTurnNodes({ author: VISIBLE_MESSAGE,
      reply: "指定段落修订稿 他把第七枚手印按进灰里。 创作依据：按作者要求保留原稿其余字句。" }),
    finalText: FINAL_PAGE,
    readingBeforeText: READING_PAGE,
    readingAfterText: READING_PAGE,
    ...overrides,
  });
}



test("G2 作者可见正例：真实原话、完整阅读、末页原文前后不变、同章局部修订候选", () => {
  const result = visibleEvidence();
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(result.observed.author_message, true);
  assert.equal(result.observed.after_input_has_message, true);
  assert.equal(result.observed.reading_excerpt_before, true);
  assert.equal(result.observed.reading_excerpt_after, true);
  assert.equal(result.observed.reading_unchanged, true);
  assert.equal(result.observed.reading_complete, true);
  assert.equal(result.observed.pending_candidate, true);
  assert.equal(result.observed.candidate_same_chapter, true);
  assert.equal(result.observed.outcome, "completed");
  assert.equal(result.observed.completed, true);
  assert.equal(result.observed.author_visible_clean, true);
  assert.deepEqual(result.leak.hits, []);
});

test("G2 候选和完整读证已出现，缺终态或仍在运行/等待/失败/维护都不能签", () => {
  const nodesFor = (status) => visibleTurnNodes({ author: VISIBLE_MESSAGE,
    reply: "指定段落修订稿 他把第七枚手印按进灰里。 创作依据：按作者要求保留原稿其余字句。", status });
  const maintenance = nodesFor("进行中");
  maintenance.find((node) => node.path === `${AX_CONTAINER}/3`).value = "1 个任务进行中";
  maintenance.push(...axDock(`${AX_CONTAINER}/20`, "进行中"));
  for (const [label, finalNodes, kind] of [
    ["missing", undefined, "unknown"],
    ["running", nodesFor("进行中"), "running"],
    ["waiting", nodesFor("等待你回复"), "waiting"],
    ["failed", nodesFor("失败"), "failed"],
    ["maintenance_after_delivery", maintenance, "running"],
  ]) {
    const result = visibleEvidence({ finalNodes });
    assert.equal(result.observed.pending_candidate, true, label);
    assert.equal(result.observed.reading_complete, true, label);
    assert.equal(result.observed.outcome, kind, label);
    assert.equal(result.observed.completed, false, label);
    assert.equal(result.ok, false, label);
    assert(result.failures.includes("author_visible_outcome_not_completed"), label);
  }
  const old = visibleEvidence({ baselineAuthorCount: 1 });
  assert.equal(old.observed.pending_candidate, true);
  assert.equal(old.observed.completed, false);
  assert.equal(old.ok, false);
});
test("G2 未显示完整阅读：只有手工阅读页摘要/末页一行时缺证", () => {
  const noActivity = visibleEvidence({
    finalText: FINAL_PAGE
      .split(`${FIRST_READ}\n`).join("")
      .split(`${LAST_READ}\n`).join(""),
  });
  assert.equal(noActivity.ok, false);
  assert(noActivity.failures.includes("reading_activity_missing"));
  assert.equal(noActivity.observed.reading_complete, false);

  const onlyLast = visibleEvidence({
    finalText: FINAL_PAGE.split(`${FIRST_READ}\n`).join(""),
  });
  assert.equal(onlyLast.ok, false);
  assert(onlyLast.failures.includes("reading_not_complete"));
  assert.equal(onlyLast.observed.reading_complete, false);
});

test("G2 完整阅证只认可见范围连续覆盖：无首页范围/缺中页/总长不一致都缺证", () => {
  // 生产首页读活动目前只显示有效字数；未标范围的初次活动不能补首页缺口。
  const noFirstRange = visibleEvidence({
    finalText: FINAL_PAGE.replace(
      FIRST_READ,
      "(value=已阅读章节正文「灰烬中的手印」（第 2 章）（有效字数 6244）。)",
    ),
  });
  assert.equal(noFirstRange.ok, false);
  assert.equal(noFirstRange.observed.reading_complete, false);
  assert(noFirstRange.failures.includes("reading_not_complete"));

  const missingMiddle = visibleEvidence({
    finalText: FINAL_PAGE.replace(
      FIRST_READ,
      "(value=已阅读章节正文「灰烬中的手印」（第 2 章；第 1–3000 字符 / 共 7000 字符）。)",
    ),
  });
  assert.equal(missingMiddle.ok, false);
  assert.equal(missingMiddle.observed.reading_complete, false);
  assert(missingMiddle.failures.includes("reading_not_complete"));

  const inconsistentTotal = visibleEvidence({
    finalText: FINAL_PAGE.replace(
      LAST_READ,
      "(value=已阅读章节正文「灰烬中的手印」（第 2 章；第 6001–8000 字符 / 共 8000 字符）。)",
    ),
  });
  assert.equal(inconsistentTotal.observed.reading_complete, false);
  assert(inconsistentTotal.failures.includes("reading_not_complete"));

  const singleFullRange = visibleEvidence({
    finalText: FINAL_PAGE.replace(
      FIRST_READ,
      "(value=已阅读章节正文「灰烬中的手印」（第 2 章；第 1–7000 字符 / 共 7000 字符）。)",
    ).replace(LAST_READ, ""),
  });
  assert.equal(singleFullRange.ok, true, singleFullRange.failures.join(","));
  assert.equal(singleFullRange.observed.reading_complete, true);
});

test("G2 阅读页投影未 fresh：重建中/已过期/重建失败都拒绝，不能把旧投影当未修改", () => {
  for (const banner of [
    "投影状态：重建中\n正在读取最新章节，请稍候。",
    "投影状态：已过期\n底层设定已有变更，当前阅读的可能不是最新版本。",
    "投影状态：重建失败\n未能完整读取最新章节，请重试。正文没有被改动。",
  ]) {
    const result = visibleEvidence({ readingBeforeText: `${READING_PAGE}\n${banner}` });
    assert.equal(result.ok, false);
    assert(result.failures.includes("reading_before_projection_not_fresh"));
    assert.equal(result.observed.reading_unchanged, false);
  }
  const staleBoth = visibleEvidence({
    readingBeforeText: `${READING_PAGE}\n投影状态：已过期`,
    readingAfterText: `${READING_PAGE}\n投影状态：已过期`,
  });
  assert.equal(staleBoth.observed.reading_unchanged, false);
  assert(staleBoth.failures.includes("reading_before_projection_not_fresh"));
  assert(staleBoth.failures.includes("reading_after_projection_not_fresh"));
});

test("G2 阅读变更：只改非摘录正文也必须拒绝（完整同页比较）", () => {
  const result = visibleEvidence({
    readingAfterText: READING_PAGE.replace(
      "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。",
      "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。（正文其它位置被改）",
    ),
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("reading_changed"));
});

test("G2 阅读页作品名/章序不可辨时缺证", () => {
  const wrongWork = visibleEvidence({
    readingAfterText: READING_PAGE.replace("灰烬手印验证作品", "另一部作品"),
  });
  assert.equal(wrongWork.ok, false);
  assert(wrongWork.failures.includes("reading_after_work_title_missing"));

  const noOrder = visibleEvidence({
    target: { ...VISIBLE_TARGET, chapter_title: "灰烬中的手印" },
  });
  assert.equal(noOrder.ok, false);
  assert(noOrder.failures.includes("chapter_label_incomplete"));

  const pageNoOrder = visibleEvidence({
    readingBeforeText: READING_PAGE.replace("第02章：灰烬中的手印", "灰烬中的手印"),
    readingAfterText: READING_PAGE.replace("第02章：灰烬中的手印", "灰烬中的手印"),
  });
  assert.equal(pageNoOrder.ok, false);
  assert(pageNoOrder.failures.includes("reading_before_chapter_title_missing"));
  assert(pageNoOrder.failures.includes("reading_after_chapter_title_missing"));
});

test("G2 旧失败批次：只有失败状态而没有候选时按缺证拒绝", () => {
  const result = visibleEvidence({
    finalNodes: visibleTurnNodes({ author: VISIBLE_MESSAGE,
      reply: "这次候选处理未完成，目标可能已被处理或修订未成功。没有据此采纳或写入作品事实，请核对当前候选后继续。", status: "失败" }),
    finalText: [
      "灰烬手印验证作品",
      "你",
      VISIBLE_MESSAGE,
      "AI 助手",
      "这次候选处理未完成，目标可能已被处理或修订未成功。没有据此采纳或写入作品事实，请核对当前候选后继续。",
      "(value=失败)",
      "(value=第 3/3 步)",
    ].join("\n"),
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("pending_candidate_missing"));
});

test("G2 等待状态：可见等待但不自动作答，也不因此签页面", () => {
  const result = visibleEvidence({
    finalNodes: visibleTurnNodes({ author: VISIBLE_MESSAGE, reply: "我需要你补充要修订的段落。", status: "等待你回复" }),
    finalText: [
      "灰烬手印验证作品",
      "你",
      VISIBLE_MESSAGE,
      "AI 助手",
      "我需要你补充要修订的段落。",
      "(value=等待你回复)",
    ].join("\n"),
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("pending_candidate_missing"));
});

test("G2 缺证：阅读后页缺失或仍在加载时拒绝", () => {
  const missing = visibleEvidence({ readingAfterText: "" });
  assert.equal(missing.ok, false);
  assert(missing.failures.includes("reading_after_missing"));

  const loading = visibleEvidence({ readingAfterText: `${READING_PAGE}\n加载中…` });
  assert.equal(loading.ok, false);
  assert(loading.failures.includes("reading_after_loading"));
});

test("G2 泄露：澄清或候选里出现技术术语/编号形式时拒绝", () => {
  const result = visibleEvidence({
    finalText: `${FINAL_PAGE}\n本轮候选由 call_id 关联。`,
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("author_visible_internal_token_leak"));
  assert(result.leak.hits.some((hit) => hit.token === "call_id"));
});

test("G2 同章约束：另一章的局部修订候选不能签", () => {
  const result = visibleEvidence({
    finalText: FINAL_PAGE.replace(
      "第02章：灰烬中的手印（指定段落修订稿）",
      "第01章：夜潮（指定段落修订稿）",
    ),
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("pending_candidate_missing"));
  assert.equal(result.observed.candidate_same_chapter, false);
});

test("G2 真实作者消息缺失时不签，且不用整页里的旧候选", () => {
  const result = visibleEvidence({
    afterInputText: "灰烬手印验证作品\nAI 助手\n(value=进行中 · 创作)",
    finalText: FINAL_PAGE.split(`${VISIBLE_MESSAGE}\n`).join(""),
    finalNodes: visibleTurnNodes({ author: "上一轮原话", reply: "上一轮的候选。" }),
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("author_message_visible_missing"));
  assert(result.failures.includes("pending_candidate_missing"));
  assert.equal(result.observed.pending_candidate, false);
});

test("G2 旧回合候选不能签本次作者消息之后的空终局", () => {
  const result = visibleEvidence({
    finalNodes: visibleTurnNodes({ author: VISIBLE_MESSAGE, reply: "", status: "失败" }),
    finalText: [
      "第02章：灰烬中的手印（指定段落修订稿）",
      "这是待保存章节草稿。确认保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。预览：指定段落修订稿",
      "指定段落修订稿 他把第七枚手印按进灰里。 创作依据：旧回合。",
      "修订稿候选",
      "保存修订稿",
      "你",
      VISIBLE_MESSAGE,
      "AI 助手",
      "(value=失败)",
    ].join("\n"),
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("pending_candidate_missing"));
  assert.equal(result.observed.pending_candidate, false);
});



// ── B82 G3 只读作者可见判据：自然只读原话、真实已读范围、完成态与无新候选 ────────
const G3_MESSAGE = "我想先安静读一遍第02章已经保存的正文，只核对，不改也不保存。";
const G3_REPLY = "我按你的要求只读了现有正文，没有改动，也没有生成候选或保存。";
const G3_FINAL_PAGE = [
  VISIBLE_TARGET.work_title,
  "你",
  G3_MESSAGE,
  "AI 助手",
  G3_REPLY,
  "本轮创作过程",
  FIRST_READ,
  "(value=已完成)",
].join("\n");
const G3_AFTER_INPUT = [
  VISIBLE_TARGET.work_title,
  "你",
  G3_MESSAGE,
  "AI 助手",
  "(value=进行中 · 创作)",
].join("\n");



function g3Evidence(overrides = {}) {
  return g3VisibleEvidence({
    target: VISIBLE_TARGET,
    message: G3_MESSAGE,
    afterInputText: G3_AFTER_INPUT,
    finalNodes: visibleTurnNodes({ author: G3_MESSAGE, reply: G3_REPLY }),
    finalText: G3_FINAL_PAGE,
    readingBeforeText: READING_PAGE,
    readingAfterText: READING_PAGE,
    ...overrides,
  });
}

test("G3 作者可见正例：自然只读原话后有真实回复并完成，一个带范围的真实页即签", () => {
  const result = g3Evidence();
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(result.observed.author_message, true);
  assert.equal(result.observed.after_input_has_message, true);
  assert.equal(result.observed.outcome, "completed");
  assert.equal(result.observed.completed, true);
  assert.equal(result.observed.reply_visible, true);
  assert.equal(result.observed.reading_activity, true);
  assert.deepEqual(result.observed.reading_range, { start: 1, end: 6000, total: 7000 });
  assert.equal(result.observed.reading_unchanged, true);
  assert.equal(result.observed.pending_candidate, false);
  assert.equal(result.observed.save_action, false);
  assert.equal(result.observed.author_visible_clean, true);
  assert.deepEqual(result.leak.hits, []);
});

test("G3 缺最终AX或只有旧作者副本时，完成文字不能替代本轮终态", () => {
  for (const finalNodes of [undefined, [], visibleTurnNodes({ author: "上一轮只读请求", reply: G3_REPLY })]) {
    const result = g3Evidence({ finalNodes });
    assert.equal(result.ok, false);
    assert.equal(result.observed.completed, false);
    assert(result.failures.includes("author_visible_outcome_not_completed"));
  }
  const old = g3Evidence({ baselineAuthorCount: 1 });
  assert.equal(old.ok, false);
  assert.equal(old.observed.completed, false);
});

test("G3 只要求至少一个真实范围页，不要求读完整个目标章", () => {
  const lastPage = g3Evidence({ finalText: G3_FINAL_PAGE.replace(FIRST_READ, LAST_READ) });
  assert.equal(lastPage.ok, true, lastPage.failures.join(","));
  assert.deepEqual(lastPage.observed.reading_range, { start: 6001, end: 7000, total: 7000 });
});

test("G3 读活动没有可见范围时不签（有效字数不能代替真实页）", () => {
  const result = g3Evidence({
    finalText: G3_FINAL_PAGE.replace(
      FIRST_READ,
      "(value=已阅读章节正文「灰烬中的手印」（第 2 章）（有效字数 6244）。)",
    ),
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("reading_range_missing"));
  assert.equal(result.observed.reading_activity, true);
  assert.equal(result.observed.reading_range, null);
});

test("G3 没有任何目标章读活动时不签", () => {
  const result = g3Evidence({
    finalText: G3_FINAL_PAGE.split(`${FIRST_READ}\n`).join(""),
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("reading_activity_missing"));
  assert.equal(result.observed.reading_activity, false);
});

test("G3 本次失败或等待终局只留证不签", () => {
  for (const [status, kind] of [["失败", "failed"], ["等待你回复", "waiting"]]) {
    const result = g3Evidence({
      finalText: G3_FINAL_PAGE.replace("(value=已完成)", `(value=${status})`),
      finalNodes: visibleTurnNodes({ author: G3_MESSAGE, reply: G3_REPLY, status }),
    });
    assert.equal(result.ok, false, status);
    assert.equal(result.observed.outcome, kind);
    assert.equal(result.observed.completed, false);
    assert(result.failures.includes("author_visible_outcome_not_completed"));
  }
});

test("G3 只有完成状态或只有读活动、没有真实回复时不签", () => {
  const result = g3Evidence({
    finalNodes: visibleTurnNodes({ author: G3_MESSAGE, reply: "" }),
    finalText: [
      VISIBLE_TARGET.work_title,
      "你",
      G3_MESSAGE,
      "AI 助手",
      "本轮创作过程",
      FIRST_READ,
      "(value=已完成)",
    ].join("\n"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.observed.reply_visible, false);
  assert.equal(result.observed.reading_activity, true);
  assert(result.failures.includes("author_reply_missing"));
});

test("G3 本次出现新候选或保存操作时拒绝", () => {
  const result = g3Evidence({
    finalText: G3_FINAL_PAGE.replace(
      "(value=已完成)",
      [
        "第02章：灰烬中的手印（指定段落修订稿）",
        "修订稿候选",
        "保存修订稿",
        "(value=已完成)",
      ].join("\n"),
    ),
  });
  assert.equal(result.ok, false);
  assert.equal(result.observed.pending_candidate, true);
  assert.equal(result.observed.save_action, true);
  assert(result.failures.includes("unexpected_pending_candidate"));
  assert(result.failures.includes("unexpected_save_action"));
});

test("G3 回复里提到保存字样但没有可见保存控件时不算保存操作", () => {
  const result = g3Evidence({
    finalText: G3_FINAL_PAGE.replace(
      G3_REPLY,
      "我只读了正文，不会保存修订稿，也没有生成候选。",
    ),
  });
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(result.observed.save_action, false);
  assert.equal(result.observed.pending_candidate, false);
});

test("G3 旧回合候选不在本回合，不影响只读完成判定", () => {
  const result = g3Evidence({
    finalText: [
      "第02章：灰烬中的手印（指定段落修订稿）",
      "修订稿候选",
      "保存修订稿",
      G3_FINAL_PAGE,
    ].join("\n"),
  });
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(result.observed.pending_candidate, false);
  assert.equal(result.observed.save_action, false);
});

test("G3 缺当前作者原话时不用整页旧状态或旧候选", () => {
  const result = g3Evidence({
    finalText: G3_FINAL_PAGE.split(`${G3_MESSAGE}\n`).join(""),
    finalNodes: visibleTurnNodes({ author: "上一轮只读请求", reply: G3_REPLY }),
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("author_message_visible_missing"));
  assert.equal(result.observed.author_message, false);
  assert.equal(result.observed.completed, false);
});

test("G3 阅读内容改变或泄漏内部词时不签", () => {
  const changed = g3Evidence({
    readingAfterText: READING_PAGE.replace(
      "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。",
      "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。（正文被改）",
    ),
  });
  assert.equal(changed.ok, false);
  assert(changed.failures.includes("reading_changed"));

  const leaked = g3Evidence({
    finalText: `${G3_FINAL_PAGE}\n本轮读取由 call_id 关联。`,
  });
  assert.equal(leaked.ok, false);
  assert(leaked.failures.includes("author_visible_internal_token_leak"));
  assert(leaked.leak.hits.some((hit) => hit.token === "call_id"));
});



function axQuestionGroup(path, status = "等待你的回答") {
  return [
    axNode(path, "AXGroup", "创作问题记录"),
    axNode(`${path}/0`, "AXGroup"),
    axNode(`${path}/0/0`, "AXStaticText", "", "问题正文"),
    axNode(`${path}/1`, "AXStaticText", "", status),
  ];
}

function axDock(path, label = "等待你回复 · 创作") {
  return [
    axNode(path, "AXGroup", "当前创作任务操作"),
    axNode(`${path}/0`, "AXGroup"),
    axNode(`${path}/0/0`, "AXGroup"),
    axNode(`${path}/0/0/0/0`, "AXStaticText", "", label),
  ];
}


test("普通 Markdown 回复：交付入口与空闲同时成立，不能借旧轮或在途状态", () => {
  const message = "本轮只讨论";
  const nodes = [
    axNode("0", "AXWindow"), axNode(AX_CONTAINER, "AXWebArea"),
    { ...axNode(`${AX_CONTAINER}/1`, "AXPopUpButton", "自定义助手"), desc: "助手名称" },
    axNode(`${AX_CONTAINER}/3`, "AXStaticText", "", "无任务"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, message),
    ...axMessageGroup(`${AX_CONTAINER}/12`, "自定义助手"),
    axNode(`${AX_CONTAINER}/13`, "AXGroup"),
    axNode(`${AX_CONTAINER}/13/0`, "AXHeading", "", "分析"),
    axNode(`${AX_CONTAINER}/13/0/0`, "AXStaticText", "", "实际回复"),
    ...axMessageGroup(`${AX_CONTAINER}/14`, "第二个 Markdown 段落"),
    axNode(`${AX_CONTAINER}/15`, "AXList"),
    axNode(`${AX_CONTAINER}/15/0`, "AXStaticText", "", "列表项"),
    { ...axNode(`${AX_CONTAINER}/16`, "AXButton", "为什么"), desc: "查看这轮回应的依据" },
  ];
  assert.equal(axTurnOutcome(nodes, { message }).kind, "completed");
  assert.equal(axTurnOutcome(nodes.filter((n) => n.value !== "无任务"), { message }).kind, "unknown");
  assert.equal(axTurnOutcome(nodes.filter((n) => n.role !== "AXWindow"), { message }).kind, "unknown");
  assert.equal(axTurnOutcome(nodes.filter((n) => n.title !== "为什么"), { message }).kind, "unknown");
  assert.equal(axTurnOutcome(nodes.filter((n) => ![13, 14, 15].some((i) =>
    n.path === `${AX_CONTAINER}/${i}` || n.path.startsWith(`${AX_CONTAINER}/${i}/`))), { message }).kind, "unknown");
  assert.equal(axTurnOutcome(nodes.filter((n) => n.role !== "AXPopUpButton"), { message }).kind, "unknown");
  assert.equal(axTurnOutcome([...nodes, ...axDock(`${AX_CONTAINER}/20`, "进行中")], { message }).kind, "unknown");
  const next = [...nodes, ...axMessageGroup(`${AX_CONTAINER}/17`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/18`, "新的一轮")];
  assert.equal(axTurnOutcome(next, { message: "新的一轮" }).kind, "unknown");
  assert.equal(axTurnOutcome(next, { message }).kind, "unknown");
});


test("整理记录不是运行态：同轮回复与空闲成立才完成，细条或面板不能冒充正文", () => {
  const message = "讨论完成后保留整理记录";
  const group = `${AX_CONTAINER}/15`;
  const base = [
    axNode("0", "AXWindow"), axNode(AX_CONTAINER, "AXWebArea"),
    { ...axNode(`${AX_CONTAINER}/1`, "AXPopUpButton", "AI 助手"), desc: "助手名称" },
    axNode(`${AX_CONTAINER}/3`, "AXStaticText", "", "无任务"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, message),
    ...axMessageGroup(`${AX_CONTAINER}/12`, "AI 助手"),
    ...axMessageGroup(`${AX_CONTAINER}/13`, "独立交付的实际回复"),
    { ...axNode(`${AX_CONTAINER}/16`, "AXButton", "为什么"), desc: "查看这轮回应的依据" },
  ];
  const notice = [axNode(group, "AXGroup", "本轮创作过程"),
    axNode(`${group}/0`, "AXButton", "查看已整理的较早创作过程")];
  const panel = [axNode(`${group}/1`, "AXGroup", "已整理的较早记录"),
    axNode(`${group}/1/0`, "AXStaticText", "", "原始记录仍然保留，不会被删除或改写。"),
    axNode(`${group}/1/1`, "AXStaticText", "", "进行中"),
    axNode(`${group}/1/2`, "AXButton", "查看完整记录")];
  for (const records of [notice, [...notice, ...panel]]) {
    const nodes = [...base, ...records];
    assert.equal(axTurnOutcome(nodes, { message }).kind, "completed");
    const cases = [
      nodes.filter((node) => !node.path.startsWith(`${AX_CONTAINER}/13`)),
      nodes.filter((node) => node.value !== "无任务"),
      nodes.filter((node) => node.title !== "为什么"),
      nodes.filter((node) => node.role !== "AXWindow"),
      [...nodes, ...axDock(`${AX_CONTAINER}/20`, "进行中")],
      [...nodes, ...axMessageGroup(`${AX_CONTAINER}/17`, "你"), ...axMessageGroup(`${AX_CONTAINER}/18`, "下一轮")],
      [...nodes, axNode(`${group}/2`, "AXGroup", "未知过程内容")],
      [...nodes, axNode(`${AX_CONTAINER}/14`, "AXGroup", "本轮创作过程")],
    ];
    for (const unknown of cases) assert.equal(axTurnOutcome(unknown, { message }).kind, "unknown");
    for (const [status, kind] of [["进行中", "running"], ["失败", "failed"], ["等待你回复", "waiting"]]) {
      assert.equal(axTurnOutcome([...nodes, axNode(`${group}/2`, "AXStaticText", "", status)], { message }).kind, kind);
      assert.equal(axTurnOutcome([...nodes, ...axProcessGroup(`${AX_CONTAINER}/14`, [status])], { message }).kind, kind);
    }
  }
});

test("AX 本轮终态：旧页底等待+新 running 不能判 terminal；旧终局不算新结果", () => {
  const message = "第三条";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/8`, "你"),
    ...axProcessGroup(`${AX_CONTAINER}/9`, ["已完成"]),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, message),
    axNode(`${AX_CONTAINER}/12`, "AXGroup", "本轮创作过程"),
    axNode(`${AX_CONTAINER}/12/0`, "AXGroup"),
    axNode(`${AX_CONTAINER}/12/0/0`, "AXStaticText", "", "已核查章节：尚无正文。"),
    axNode(`${AX_CONTAINER}/13`, "AXGroup", "AXApplicationStatus"),
    axNode(`${AX_CONTAINER}/13/0`, "AXStaticText", "", "当前任务在等待你的回答。"),
    axNode(`${AX_CONTAINER}/14`, "AXGroup", "回答当前问题"),
    axNode(`${AX_CONTAINER}/14/0`, "AXStaticText", "", "需要你决定"),
    ...axDock(`${AX_CONTAINER}/15`),
  ];
  const outcome = axTurnOutcome(nodes, { message });
  assert.equal(outcome.kind, "unknown", JSON.stringify(outcome));
  assert.equal(outcome.group_path, `${AX_CONTAINER}/12`);
});

test("AX 本轮终态：快速 completed、本轮问题记录 waiting、failed 精确状态行", () => {
  const message = "问题";
  const base = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, message),
  ];
  assert.equal(
    axTurnOutcome([...base, ...axProcessGroup(`${AX_CONTAINER}/12`, ["已完成"])], { message }).kind,
    "completed",
  );
  assert.equal(
    axTurnOutcome([...base, ...axProcessGroup(`${AX_CONTAINER}/12`, ["失败"])], { message }).kind,
    "failed",
  );
  assert.equal(
    axTurnOutcome([...base, ...axQuestionGroup(`${AX_CONTAINER}/12`)], { message }).kind,
    "waiting",
  );
  assert.equal(
    axTurnOutcome([...base, ...axProcessGroup(`${AX_CONTAINER}/12`, ["进行中"])], { message }).kind,
    "running",
  );
});

test("AX 本轮终态：重复作者文本取新增最后一条，模型引用同文本不算作者", () => {
  const message = "重复原话";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, message),
    ...axProcessGroup(`${AX_CONTAINER}/12`, ["已完成"]),
    ...axMessageGroup(`${AX_CONTAINER}/13`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/14`, message),
    ...axProcessGroup(`${AX_CONTAINER}/15`, []),
    // 模型正文恰好原样引用同一句：父组前一个兄弟是「AI 助手」，不是作者消息。
    axNode(`${AX_CONTAINER}/16`, "AXGroup"),
    axNode(`${AX_CONTAINER}/16/0`, "AXStaticText", "", "AI 助手"),
    axNode(`${AX_CONTAINER}/17`, "AXGroup"),
    axNode(`${AX_CONTAINER}/17/0`, "AXStaticText", "", message),
  ];
  assert.equal(axAuthorMessages(nodes, message).length, 2);
  assert.equal(
    axTurnOutcome(nodes, { message, baselineAuthorCount: 1 }).kind,
    "unknown",
  );
  assert.equal(axTurnOutcome(nodes, { message, baselineAuthorCount: 2 }).kind, "unknown");
});

test("AX 本轮终态：旧过程组内正文的状态词不参与，只有精确状态行才生效", () => {
  const message = "当前有几章内容";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, message),
    axNode(`${AX_CONTAINER}/12`, "AXGroup", "本轮创作过程"),
    axNode(`${AX_CONTAINER}/12/0`, "AXStaticText", "", "上一轮已完成；现在等待你回复"),
  ];
  assert.equal(axTurnOutcome(nodes, { message }).kind, "unknown");
});

test("本轮过程组的真实AX状态值可剥离创作徽标", () => {
  const message = "作者原话";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, message),
    ...axProcessGroup(`${AX_CONTAINER}/12`, ["已完成 · 创作"]),
  ];
  assert.equal(axTurnOutcome(nodes, { message }).kind, "completed");
});

test("AX 终态不跨下一条作者消息借用后一轮状态；同轮多组取最新", () => {
  const first = "第一句";
  const second = "第二句";
  const third = "第三句";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, first),
    ...axMessageGroup(`${AX_CONTAINER}/12`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/13`, second),
    ...axProcessGroup(`${AX_CONTAINER}/14`, ["已完成"]),
    ...axMessageGroup(`${AX_CONTAINER}/15`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/16`, third),
  ];
  // 第一句之后没有自己的过程组；不能借用第二句的 14，也不能把后一轮组当本轮组。
  const firstOutcome = axTurnOutcome(nodes, { message: first });
  assert.equal(firstOutcome.kind, "unknown");
  assert.equal(firstOutcome.group_title, null);
  assert.equal(axTurnOutcome(nodes, { message: second }).kind, "completed");
  assert.equal(axTurnOutcome(nodes, { message: third }).kind, "unknown");

  const sameTurn = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/20`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/21`, first),
    ...axProcessGroup(`${AX_CONTAINER}/22`, ["进行中"]),
    ...axProcessGroup(`${AX_CONTAINER}/23`, ["已完成"]),
  ];
  assert.equal(axTurnOutcome(sameTurn, { message: first }).kind, "completed");
});

const axDescNode = (path, role, desc, title = "", value = "") => ({
  path,
  role,
  desc,
  title,
  value,
});

function axCapabilityGap(path, goal, reply = "这条目标当前能力做不到。", replyPath = null, whyPath = null) {
  const parts = path.split("/");
  const order = Number(parts.pop());
  const head = parts.join("/");
  const answerPath = replyPath ?? `${head}/${order + 1}`;
  const why = whyPath ?? `${head}/${order + 2}`;
  return [
    axDescNode(path, "AXGroup", `能力缺口：${goal}`),
    axNode(`${path}/0`, "AXStaticText", "", "能力缺口"),
    axNode(answerPath, "AXGroup"),
    axNode(`${answerPath}/0`, "AXStaticText", "", reply),
    axDescNode(why, "AXButton", "查看这轮回应的依据", "为什么"),
  ];
}

test("现役 capability_gap 结构：真实说明+直接标记+回复+为什么才识别", () => {
  const second = "卷纲不对";
  const base = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, "第一句"),
    ...axMessageGroup(`${AX_CONTAINER}/12`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/13`, second),
  ];
  const gap = axTurnOutcome([...base, ...axCapabilityGap(`${AX_CONTAINER}/14`, "目标A")], {
    message: second,
  });
  assert.equal(gap.kind, "capability_gap");
  assert.equal(gap.gap.goal, "目标A");
  assert.equal(gap.gap.marker_path, `${AX_CONTAINER}/14`);

  // 模型正文引用「能力缺口」但没有结构标记：不能当 gap。
  const textOnly = [
    ...base,
    axNode(`${AX_CONTAINER}/14`, "AXGroup"),
    axNode(`${AX_CONTAINER}/14/0`, "AXStaticText", "", "能力缺口：这只是正文引用"),
    ...axMessageGroup(`${AX_CONTAINER}/15`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/16`, "下一句"),
  ];
  assert.equal(axTurnOutcome(textOnly, { message: second }).kind, "unknown");

  // 只有标记、缺对应回复/为什么：不能当 gap。
  const markerOnly = [
    ...base,
    axDescNode(`${AX_CONTAINER}/14`, "AXGroup", "能力缺口：目标B"),
    axNode(`${AX_CONTAINER}/14/0`, "AXStaticText", "", "能力缺口"),
  ];
  assert.equal(axTurnOutcome(markerOnly, { message: second }).kind, "unknown");
});

test("capability_gap 不借旧回合；重复作者只取新增；过程 completed 更具体", () => {
  const second = "第二句";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, "第一句"),
    ...axCapabilityGap(`${AX_CONTAINER}/12`, "旧 gap", undefined, `${AX_CONTAINER}/13`, `${AX_CONTAINER}/14`),
    ...axMessageGroup(`${AX_CONTAINER}/15`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/16`, second),
    ...axCapabilityGap(`${AX_CONTAINER}/17`, "新 gap", undefined, `${AX_CONTAINER}/18`, `${AX_CONTAINER}/19`),
  ];
  assert.equal(axTurnOutcome(nodes, { message: "第一句" }).kind, "capability_gap");
  assert.equal(
    axTurnOutcome(nodes, { message: second, baselineAuthorCount: 0 }).kind,
    "capability_gap",
  );
  assert.equal(
    axTurnOutcome(nodes, { message: second, baselineAuthorCount: 1 }).kind,
    "unknown",
  );

  const withProcess = [
    ...nodes,
    ...axProcessGroup(`${AX_CONTAINER}/20`, ["已完成"]),
  ];
  assert.equal(axTurnOutcome(withProcess, { message: second }).kind, "completed");
});



test("AX 终态只取本消息流容器内、本条作者之后的组；页底旧组不覆盖已完成", () => {
  const message = "第四条";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/8`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/9`, "旧输入"),
    ...axProcessGroup(`${AX_CONTAINER}/10`, ["已完成"]),
    ...axMessageGroup(`${AX_CONTAINER}/11`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/12`, message),
    ...axProcessGroup(`${AX_CONTAINER}/13`, ["已完成"]),
    axNode(`${AX_CONTAINER}/14`, "AXGroup", "回答当前问题"),
    axNode(`${AX_CONTAINER}/14/0`, "AXStaticText", "", "等待你回复"),
    ...axDock(`${AX_CONTAINER}/15`),
  ];
  const done = axTurnOutcome(nodes, { message });
  assert.equal(done.kind, "completed");
  assert.equal(done.group_path, `${AX_CONTAINER}/13`);

  // 本轮还没有自己的过程组时，不能把作者之前的旧组当成本轮状态。
  const beforeOnly = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axProcessGroup(`${AX_CONTAINER}/11`, ["已完成"]),
    ...axMessageGroup(`${AX_CONTAINER}/12`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/13`, message),
    ...axDock(`${AX_CONTAINER}/14`),
  ];
  const early = axTurnOutcome(beforeOnly, { message });
  assert.equal(early.kind, "unknown");
  assert.equal(early.group_title, null);
});

test("capability_gap 结构边界：按钮身份/标题/说明、回复组、回复必须先于为什么", () => {
  const message = "卷纲重做";
  const second = "第二句";
  const base = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, "第一句"),
    ...axMessageGroup(`${AX_CONTAINER}/12`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/13`, message),
  ];
  const marker = (path, goal) => [
    axDescNode(path, "AXGroup", `能力缺口：${goal}`),
    axNode(`${path}/0`, "AXStaticText", "", "能力缺口"),
  ];
  const reply = (path, text = "这个目标做不到。") => [
    axNode(path, "AXGroup"),
    axNode(`${path}/0`, "AXStaticText", "", text),
  ];
  const why = (path, title = "为什么", desc = "查看这轮回应的依据") =>
    [axDescNode(path, "AXButton", desc, title)];

  assert.equal(
    axTurnOutcome([
      ...base,
      ...marker(`${AX_CONTAINER}/14`, "A"),
      ...reply(`${AX_CONTAINER}/15`),
      ...why(`${AX_CONTAINER}/16`),
    ], { message }).kind,
    "capability_gap",
  );
  // 为什么必须是真实 AXButton：同说明的分组不算入口。
  assert.equal(
    axTurnOutcome([
      ...base,
      ...marker(`${AX_CONTAINER}/14`, "A"),
      ...reply(`${AX_CONTAINER}/15`),
      axDescNode(`${AX_CONTAINER}/16`, "AXGroup", "查看这轮回应的依据", "为什么"),
    ], { message }).kind,
    "unknown",
  );
  assert.equal(
    axTurnOutcome([
      ...base,
      ...marker(`${AX_CONTAINER}/14`, "A"),
      ...reply(`${AX_CONTAINER}/15`),
      ...why(`${AX_CONTAINER}/16`, "为什么？"),
    ], { message }).kind,
    "unknown",
  );
  assert.equal(
    axTurnOutcome([
      ...base,
      ...marker(`${AX_CONTAINER}/14`, "A"),
      ...reply(`${AX_CONTAINER}/15`),
      ...why(`${AX_CONTAINER}/16`, "为什么", "其他说明"),
    ], { message }).kind,
    "unknown",
  );
  // 没有回复组：不能把为什么之前的普通文本当回复。
  assert.equal(
    axTurnOutcome([
      ...base,
      ...marker(`${AX_CONTAINER}/14`, "A"),
      axNode(`${AX_CONTAINER}/15`, "AXStaticText", "", "只是普通文本"),
      ...why(`${AX_CONTAINER}/16`),
    ], { message }).kind,
    "unknown",
  );
  // 回复组在为什么之后：顺序不成立。
  assert.equal(
    axTurnOutcome([
      ...base,
      ...marker(`${AX_CONTAINER}/14`, "A"),
      ...why(`${AX_CONTAINER}/15`),
      ...reply(`${AX_CONTAINER}/16`),
    ], { message }).kind,
    "unknown",
  );
  // 只有直接文本「能力缺口」、没有能力缺口说明：不算。
  assert.equal(
    axTurnOutcome([
      ...base,
      axNode(`${AX_CONTAINER}/14`, "AXGroup"),
      axNode(`${AX_CONTAINER}/14/0`, "AXStaticText", "", "能力缺口"),
      ...reply(`${AX_CONTAINER}/15`),
      ...why(`${AX_CONTAINER}/16`),
    ], { message }).kind,
    "unknown",
  );
  // 有说明文字但不是「能力缺口：」前缀：不算。
  assert.equal(
    axTurnOutcome([
      ...base,
      ...marker(`${AX_CONTAINER}/14`, "A").map((node) =>
        node.desc === undefined ? node : { ...node, desc: "其他说明" }),
      ...reply(`${AX_CONTAINER}/15`),
      ...why(`${AX_CONTAINER}/16`),
    ], { message }).kind,
    "unknown",
  );
  // 标记组自己的直接文本只有标签；即使混入普通文本，也不能把标记组本身当回复组。
  assert.equal(
    axTurnOutcome([
      ...base,
      axDescNode(`${AX_CONTAINER}/14`, "AXGroup", "能力缺口：A"),
      axNode(`${AX_CONTAINER}/14/0`, "AXStaticText", "", "能力缺口"),
      axNode(`${AX_CONTAINER}/14/1`, "AXStaticText", "", "混在标记里的说明"),
      ...why(`${AX_CONTAINER}/15`),
    ], { message }).kind,
    "unknown",
  );
  // 同一轮多个完整度不同的标记：从最新向前找第一个完整结构。
  const two = [
    ...base,
    ...marker(`${AX_CONTAINER}/14`, "较早"),
    ...reply(`${AX_CONTAINER}/15`),
    ...why(`${AX_CONTAINER}/16`),
    ...marker(`${AX_CONTAINER}/17`, "较晚但缺回复"),
  ];
  const picked = axTurnOutcome(two, { message });
  assert.equal(picked.kind, "capability_gap");
  assert.equal(picked.gap.marker_path, `${AX_CONTAINER}/14`);
  assert.equal(
    axTurnOutcome(
      [...two, ...axMessageGroup(`${AX_CONTAINER}/18`, "你"), ...axMessageGroup(`${AX_CONTAINER}/19`, second)],
      { message },
    ).kind,
    "capability_gap",
  );
});

test("capability_gap 不借用其他容器或下一轮作者之后的标记", () => {
  const message = "第二句";
  const otherContainer = "0/0/0/0/9";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    axNode(otherContainer, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, message),
    // 其他容器里的旧缺口结构：不属于本消息流。
    axDescNode(`${otherContainer}/2`, "AXGroup", "能力缺口：旧任务"),
    axNode(`${otherContainer}/2/0`, "AXStaticText", "", "能力缺口"),
    axNode(`${otherContainer}/3`, "AXGroup"),
    axNode(`${otherContainer}/3/0`, "AXStaticText", "", "旧回复"),
    axDescNode(`${otherContainer}/4`, "AXButton", "查看这轮回应的依据", "为什么"),
  ];
  assert.equal(axTurnOutcome(nodes, { message }).kind, "unknown");

  const afterNext = [
    ...nodes,
    ...axMessageGroup(`${AX_CONTAINER}/12`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/13`, "下一句"),
    axDescNode(`${AX_CONTAINER}/14`, "AXGroup", "能力缺口：下一轮"),
    axNode(`${AX_CONTAINER}/14/0`, "AXStaticText", "", "能力缺口"),
    axNode(`${AX_CONTAINER}/15`, "AXGroup"),
    axNode(`${AX_CONTAINER}/15/0`, "AXStaticText", "", "下一轮回复"),
    axDescNode(`${AX_CONTAINER}/16`, "AXButton", "查看这轮回应的依据", "为什么"),
  ];
  assert.equal(axTurnOutcome(afterNext, { message }).kind, "unknown");
});

test("作者消息只认 AXStaticText：按钮/分组值即使相同也不属于作者原话", () => {
  const message = "开始新讨论";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    axNode(`${AX_CONTAINER}/10`, "AXGroup"),
    axNode(`${AX_CONTAINER}/10/0`, "AXStaticText", "", "你"),
    axNode(`${AX_CONTAINER}/11`, "AXButton", "", message),
  ];
  assert.deepEqual(axAuthorMessages(nodes, message), []);
  assert.equal(countAxAuthorMessages(nodes, message), 0);
});

test("重复作者游标相等时明确返回无新增作者，不拿旧作者当本轮", () => {
  const message = "重复原话";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/10`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/11`, message),
    ...axProcessGroup(`${AX_CONTAINER}/12`, ["已完成"]),
    ...axMessageGroup(`${AX_CONTAINER}/13`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/14`, message),
    ...axProcessGroup(`${AX_CONTAINER}/15`, ["已完成"]),
  ];
  const outcome = axTurnOutcome(nodes, { message, baselineAuthorCount: 2 });
  assert.equal(outcome.kind, "unknown");
  assert.equal(outcome.author_path, null);
  assert.equal(outcome.author_count, 2);
});

test("AX 路径按数值段排序：第 10 组晚于第 9 组", () => {
  const message = "路径排序";
  const nodes = [
    axNode("0", "AXWindow"),
    axNode(AX_CONTAINER, "AXGroup"),
    ...axMessageGroup(`${AX_CONTAINER}/5`, "你"),
    ...axMessageGroup(`${AX_CONTAINER}/6`, message),
    ...axProcessGroup(`${AX_CONTAINER}/9`, ["已完成"]),
    ...axProcessGroup(`${AX_CONTAINER}/10`, ["失败"]),
  ];
  // 数值序下 10 晚于 9；字符串序会把 "10" 排到 "9" 前面而误取旧状态。
  assert.equal(axTurnOutcome(nodes, { message }).kind, "failed");
});
