// B71 first-consumer run 证据族的纯事实 owner：帧、canonical transcript、ACK/完成
// 结果与 llm 记录只作为内存数据。真实 4 表 SQLite + config 在
// `authoring_run_io_fixture.mjs`；纯测试与 IO 测试共享同一组事实。
import { irBodyFromWire } from "./authoring_request_ir.mjs";

export const F_WORK = "work-first";
export const F_WORKSPACE = "workspace-first";
export const F_SESSION = "session-first";
export const F_PARENT = "message-first";
export const F_RUN = "run-first";
export const F_DECOY = "run-decoy";
export const F_MESSAGE = "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。";
export const F_TOPIC = `workspace:${F_WORKSPACE}`;
export const F_T0 = "2026-11-02T01:00:00.000Z";
export const F_T1 = "2026-11-02T01:00:00.100Z";
export const F_T2 = "2026-11-02T01:00:00.200Z";
export const F_T3 = "2026-11-02T01:00:00.300Z";
export const F_T4 = "2026-11-02T01:00:01.000Z";

export const F_FIRST_SPEC = Object.freeze({
  message: F_MESSAGE,
  missingInput: "缺全章核对输入",
  missingAck: "缺真实输入 ack run_id",
  missingCompleted: "缺同一 bounded run 的完成结果",
  completedTurn: "first",
  requireRunMode: "bounded",
});

export const SEGMENT_VERSION = "authoring-run-segment/v1";
export const MESSAGE_FORMAT_VERSION = "authoring-session-message/v1";

export function frame(event, body, direction = "received", at = "2026-11-01T08:00:00.000Z") {
  return { direction, at, frame: ["join", "ref", "room:test", event, body] };
}

export function wf(joinRef, requestRef, event, body, direction = "received", at = F_T0) {
  return { direction, at, frame: [joinRef, requestRef, F_TOPIC, event, body] };
}

export function boundedTranscript(
  runId = F_RUN,
  calls = ["pcall-1", "prun-1", "call-1", "pcall-2", "prun-2", "call-2"],
) {
  const [pcall1, prun1, call1, pcall2, prun2, call2] = calls;
  return {
    version: "authoring-transcript/v1",
    transcript: {
      run: {
        run_id: runId,
        workspace_id: F_WORKSPACE,
        work_id: F_WORK,
        session_id: F_SESSION,
        parent_turn_ref: F_PARENT,
        profile_ref: "judgment_loop_v1",
      },
      system: { identity_ref: "identity:authoring/v1" },
      messages: [
        { role: "user", provenance: "author", blocks: [{ type: "text", text: F_MESSAGE }] },
        {
          role: "assistant",
          provenance: "model",
          provider_call_ref: pcall1,
          provider_run_ref: prun1,
          blocks: [{ type: "tool_call", call_id: call1, name: "search", arguments: {} }],
        },
        { role: "tool", blocks: [{ type: "observation", call_id: call1, content: { query: "{}" } }] },
        {
          role: "assistant",
          provenance: "model",
          provider_call_ref: pcall2,
          provider_run_ref: prun2,
          blocks: [{ type: "tool_call", call_id: call2, name: "search", arguments: {} }],
        },
        { role: "tool", blocks: [{ type: "observation", call_id: call2, content: { query: "{}" } }] },
      ],
      tools: [{ name: "search" }],
      base_refs: [],
      observation_refs: [],
      used_refs: [],
      projection: { target: "chat_completions" },
      call_ids: [call1, call2],
    },
  };
}

export function firstConsumerEvidence() {
  const join = wf("join-3", "join-3", "phx_join", { work_id: F_WORK, session_id: F_SESSION }, "sent", F_T0);
  const joinReply = wf(
    "join-3",
    "join-3",
    "phx_reply",
    { status: "ok", response: { joined: true, work_id: F_WORK, session_id: F_SESSION } },
    "received",
    F_T1,
  );
  const sent = wf(
    "join-3",
    "request-4",
    "user_message",
    { text: F_MESSAGE, turn_id: F_PARENT, work_id: F_WORK, session_id: F_SESSION },
    "sent",
    F_T2,
  );
  const ack = wf(
    "join-3",
    "request-4",
    "phx_reply",
    { status: "ok", response: { turn_id: F_PARENT, run_id: F_RUN, run_mode: "bounded" } },
    "received",
    F_T3,
  );
  const result = wf(
    "join-3",
    "request-4",
    "turn_result",
    {
      turn_id: F_PARENT,
      work_id: F_WORK, session_id: F_SESSION,
      agent_run: { run_id: F_RUN, parent_turn_ref: F_PARENT, status: "running", run_mode: "bounded" },
      adoption_state: { pending: [] },
    },
    "received",
    F_T4,
  );
  const unrelatedResult = wf("join-3", "request-4", "turn_result", { turn_id: "turn-other" }, "received", F_T4);
  const wire = [join, joinReply, sent, ack, result, unrelatedResult];
  const exchange = (n, turnId = `${F_PARENT}:agent:${n}`) => ({
    provider: "slice_verify",
    request_format: "authoring-request-ir/v1",
    response_format: "fixture_provider_result/v1",
    provider_call_ref: `pcall-${n}`,
    provider_run_ref: `prun-${n}`,
    work_id: F_WORK,
    session_id: F_SESSION,
    turn_id: turnId,
    request_body: irBodyFromWire({ messages: [{ role: "user", content: F_MESSAGE }] }),
    response: {
      status: "ok",
      body: { content: "", tool_calls: [{ id: `call-${n}`, name: "search", arguments: {} }] },
    },
  });
  const llmRecords = [exchange(1), exchange(2), exchange(9)];
  return { wire, sent, ack, result, llmRecords, evidence: { wire, userMessages: [sent], llmRecords } };
}

export function fullReadScenarioFacts(directoryQuery = "chapters") {
  const lastPageAnchor = "井底浮现第七枚手印";
  // 独立固定事实；不从待测 reader 的返回值生成事件或预期，也不声称核准原库正文。
  const chapterRef = "chapter:22222222-2222-4222-8222-222222222222";
  const decoyRef = "chapter:11111111-1111-4111-8111-111111111111";
  const draftRef = "draft:33333333-3333-4333-8333-333333333333";
  const firstQuery = '{"chapter_ref":"' + chapterRef + '","offset":0}';
  const lastQuery = '{"chapter_ref":"' + chapterRef + '","offset":6000}';
  const directorySummary = [
    JSON.stringify({ ref: decoyRef, seq: 1, title: "灰烬中的手印", volume: "第一卷", has_prose: false }),
    JSON.stringify({ ref: chapterRef, seq: 2, title: "灰烬中的手印", volume: "第一卷", has_prose: true }),
  ].join("\n");
  const firstSummary = "「灰烬中的手印」（第 2 章）\n【计划】追查手印\n【摘要】（尚无章摘要）\n" +
    "【正文】第 1–6000 字符 / 共 7000 字符\n" + "灰".repeat(6000) +
    "\n【续读】剩余 1000 字符；用 " + lastQuery + " 继续。";
  const lastSummary = "「灰烬中的手印」（第 2 章）\n【正文】第 6001–7000 字符 / 共 7000 字符\n" +
    "烬".repeat(1000 - lastPageAnchor.length) + lastPageAnchor;
  const directoryCoverage = {
    kind: "directory", facet: "chapters", work_id: "work-full-read", offset: 0, offset_unit: "item",
    returned_items: 2, total_items: 2, complete_fields: ["has_prose", "ref", "seq", "title", "volume"],
  };
  const firstCoverage = {
    chapter_plan: {
      status: "partial", representation: "preview", source_ref: chapterRef, offset: 0,
      returned_graphemes: 4, total_graphemes: 4, offset_unit: "unicode_grapheme",
      read_query: '{"facet":"chapters","ref":"' + chapterRef + '","offset":0}',
    },
    chapter_summary: {
      status: "unavailable",
      read_query: '{"facet":"chapters","ref":"' + chapterRef + '","offset":0}',
    },
  };
  const eventPayloads = [
    {
      stage: "exploration_observed", tool: "archive_read", query: directoryQuery, summary: directorySummary,
      outcome: "observed", facts: { total_count: 2, returned_count: 2 },
      refs: [decoyRef, chapterRef], source_refs: [decoyRef, chapterRef], versions: {},
      coverage: directoryCoverage, observation_ref: "observation:directory", next_offset: null,
    },
    {
      stage: "exploration_observed", tool: "chapter_read", query: firstQuery, summary: firstSummary,
      outcome: "observed", facts: { prose_chars: 7000 },
      refs: [chapterRef], source_refs: [chapterRef], versions: { [draftRef]: 1 },
      coverage: firstCoverage, observation_ref: "observation:first-page",
      chapter_ref: chapterRef, chapter_seq: 2, prose_range: { start: 1, end: 6000 },
      prose_total_chars: 7000, next_offset: 6000,
    },
    {
      stage: "exploration_observed", tool: "chapter_read", query: lastQuery, summary: lastSummary,
      outcome: "observed", facts: { prose_chars: 7000 },
      refs: [chapterRef], source_refs: [chapterRef], versions: { [draftRef]: 1 },
      coverage: {}, observation_ref: "observation:last-page",
      chapter_ref: chapterRef, chapter_seq: 2, prose_range: { start: 6001, end: 7000 },
      prose_total_chars: 7000, next_offset: null,
    },
  ];
  const observations = [
    {
      type: "observation", call_id: "call-directory", status: "ok",
      source_refs: [decoyRef, chapterRef], versions: {},
      coverage: { ...directoryCoverage, coverage_note: null, continuation_hint: null }, next_offset: null,
      content: {
        tool: "archive_read", query: directoryQuery, summary: directorySummary,
        facts: { total_count: 2, returned_count: 2 }, observation_ref: "observation:directory",
      },
    },
    {
      type: "observation", call_id: "call-first-page", status: "ok",
      source_refs: [chapterRef], versions: { [draftRef]: 1 },
      coverage: {
        ...firstCoverage, prose_range: { start: 1, end: 6000 }, prose_byte_range: { start: 0, end: 18000 },
        prose_total_chars: 7000, chapter_ref: chapterRef, coverage_note: null, continuation_hint: null,
      },
      next_offset: 6000,
      content: {
        tool: "chapter_read", query: firstQuery, summary: firstSummary,
        facts: { prose_chars: 7000 }, observation_ref: "observation:first-page",
      },
    },
    {
      type: "observation", call_id: "call-last-page", status: "ok",
      source_refs: [chapterRef], versions: { [draftRef]: 1 },
      coverage: {
        prose_range: { start: 6001, end: 7000 }, prose_byte_range: { start: 18000, end: 21000 },
        prose_total_chars: 7000, chapter_ref: chapterRef, coverage_note: null, continuation_hint: null,
      },
      next_offset: null,
      content: {
        tool: "chapter_read", query: lastQuery, summary: lastSummary,
        facts: { prose_chars: 7000 }, observation_ref: "observation:last-page",
      },
    },
  ];
  const calls = [
    {
      id: "call-directory", type: "function",
      function: {
        name: "judgment_decision",
        arguments: JSON.stringify({ action: "explore", explore_request: { tool: "archive_read", query: directoryQuery } }),
      },
    },
    {
      id: "call-first-page", type: "function",
      function: {
        name: "judgment_decision",
        arguments: JSON.stringify({ action: "explore", explore_request: { tool: "chapter_read", query: firstQuery } }),
      },
    },
    {
      id: "call-last-page", type: "function",
      function: {
        name: "judgment_decision",
        arguments: JSON.stringify({ action: "explore", explore_request: { tool: "chapter_read", query: lastQuery } }),
      },
    },
  ];
  return { chapterRef, decoyRef, draftRef, firstQuery, lastQuery, firstSummary, eventPayloads, observations, calls };
}
