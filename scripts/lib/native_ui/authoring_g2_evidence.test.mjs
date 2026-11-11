// B82 §7 G2 页级证据：两页真实形状、前置非页调用、错版本、缺版本与迟到回放。
// 只构造 fixture IR / provider_events / llm-calls 的采集形状，不启动产品、不读真实档案。
import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORING_REQUEST_IR } from "./authoring_request_facts.mjs";
import {
  authorVisibleOutcome,
  g2CandidateEvidence,
  g2PageEvidence,
  g2PageUsageEvidence,
  g2VisibleEvidence,
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
  agent_run: { run_id: RUN, status: "completed" },
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
    finalText: FINAL_PAGE,
    readingBeforeText: READING_PAGE,
    readingAfterText: READING_PAGE,
    ...overrides,
  });
}

test("可见终局只认本次作者消息之后的状态：缺 marker/旧回合/无任务/作者等待词都不算终局", () => {
  assert.equal(
    authorVisibleOutcome(`旧回合\n(value=已完成)\n你\n${VISIBLE_MESSAGE}\nAI 助手\n(value=进行中 · 创作)`, {
      message: VISIBLE_MESSAGE,
    }).kind,
    "running",
  );
  assert.equal(
    authorVisibleOutcome("(value=已完成)", { message: VISIBLE_MESSAGE }).kind,
    "unknown",
    "当前作者原话不在 AX 文本时不得用整页状态",
  );
  assert.equal(
    authorVisibleOutcome(FINAL_PAGE.replace(`${VISIBLE_MESSAGE}\n`, ""), {
      message: VISIBLE_MESSAGE,
    }).kind,
    "unknown",
    "缺当前作者消息时即使页面有候选/完成状态也不得当终局",
  );
  assert.equal(
    authorVisibleOutcome(`灰烬手印验证作品\n(value=无任务)\n你\n${VISIBLE_MESSAGE}\nAI 助手\n`, {
      message: VISIBLE_MESSAGE,
    }).kind,
    "unknown",
    "顶部「无任务」不是这次 run 的终局",
  );
  const authorWaitWords = "请等待我确认，失败也不要停。";
  assert.equal(
    authorVisibleOutcome(`你\n${authorWaitWords}\nAI 助手\n(value=进行中 · 创作)`, {
      message: authorWaitWords,
    }).kind,
    "running",
    "作者原话里的等待/失败词不能被当成终局",
  );
  assert.equal(
    authorVisibleOutcome(`你\n${authorWaitWords}\n`, { message: authorWaitWords }).kind,
    "unknown",
  );
});

test("可见终局只认状态行：prose 里的失败/错误不算，实际 value 状态才认", () => {
  assert.equal(
    authorVisibleOutcome(`${VISIBLE_MESSAGE}\nAI 助手\n这次候选处理失败，请核对后重试。`, {
      message: VISIBLE_MESSAGE,
    }).kind,
    "unknown",
    "正文任意出现「失败」不能当终局",
  );
  assert.equal(
    authorVisibleOutcome(`${VISIBLE_MESSAGE}\nAI 助手\n(value=失败)`, {
      message: VISIBLE_MESSAGE,
    }).kind,
    "failed",
  );
  assert.equal(
    authorVisibleOutcome(`${VISIBLE_MESSAGE}\nAI 助手\n(value=已完成)`, {
      message: VISIBLE_MESSAGE,
    }).kind,
    "completed",
  );
  assert.equal(
    authorVisibleOutcome(`${VISIBLE_MESSAGE}\nAI 助手\n(value=等待你回复)`, {
      message: VISIBLE_MESSAGE,
    }).kind,
    "waiting",
  );
  assert.equal(
    authorVisibleOutcome(`${VISIBLE_MESSAGE}\nAI 助手\n(value=进行中 · 创作)`, {
      message: VISIBLE_MESSAGE,
    }).kind,
    "running",
  );
  assert.equal(
    authorVisibleOutcome(`${VISIBLE_MESSAGE}\nAI 助手\n等待你回复`, {
      message: VISIBLE_MESSAGE,
    }).kind,
    "waiting",
  );
  assert.equal(
    authorVisibleOutcome(FINAL_PAGE, { message: VISIBLE_MESSAGE }).kind,
    "pending_candidate",
    "候选卡片优先于状态行",
  );
});

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
  assert.equal(result.observed.author_visible_clean, true);
  assert.deepEqual(result.leak.hits, []);
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
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("author_message_visible_missing"));
  assert(result.failures.includes("pending_candidate_missing"));
  assert.equal(result.observed.pending_candidate, false);
});

test("G2 旧回合候选不能签本次作者消息之后的空终局", () => {
  const result = visibleEvidence({
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
