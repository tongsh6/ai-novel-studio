// B82 §7 G2 页级证据：两页真实形状、前置非页调用、错版本、缺版本与迟到回放。
// 只构造 fixture IR / provider_events / llm-calls 的采集形状，不启动产品、不读真实档案。
import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORING_REQUEST_IR } from "./authoring_request_facts.mjs";
import { g2PageEvidence } from "./authoring_g2_evidence.mjs";

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

function observation({ callId, start, end, versions, chapter = CHAPTER }) {
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

function fixture({ versions = { [VERSION_KEY]: 2 }, page2 = null } = {}) {
  const base = [
    message("application_base", "application", [text("本 run 的应用数据")], { source_refs: [{ ref: "ctx-1" }] }),
    message("user", "author", [text("请核对正文")], { source_refs: [{ ref: "msg-1" }] }),
  ];
  const pre = call(0);
  const preObservation = observation({ callId: "call-0", start: 1, end: 6000, chapter: "chapter:other", versions });
  const first = call(3);
  const firstObservation = observation({ callId: "call-3", start: 1, end: 6000, versions });
  const second = call(4);
  const secondObservation = page2 ?? observation({ callId: "call-4", start: 6001, end: 7000, versions });
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
