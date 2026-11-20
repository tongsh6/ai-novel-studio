// B71 auto-maintenance 证据族的纯事实 owner：只提供内存字节/行，不创建目录、DB
// 或子进程。真实文件与 8 表 SQLite 模板在 `authoring_auto_maintenance_io_fixture.mjs`；
// 纯评估测试与 IO 测试共享本文件的同一组事实，避免各自复制期望。
import { discussionMaintenanceFacts } from "./authoring_discussion_facts.mjs";
import { scopeWireMessage } from "./authoring_request_ir.mjs";

export const WORK = "work-auto-1";
export const SESSION = "session-auto-1";
export const OTHER_SESSION = "session-auto-2";
export const RUN = "run-auto-1";
export const FAIL_RUN = "run-auto-fail";
export const RECOVERY_RUN = "run-auto-recovery";
export const FAILURE_REASON = ":checkpoint_persistence_failed";
export const CALL_ID = "call_auto_1";
export const EVENT_AT = "2026-11-04T10:00:00.000Z";
export const BEFORE_STARTED_AT = "2026-11-04T09:59:20.000Z";
export const AFTER_STARTED_AT = "2026-11-04T10:00:00.500Z";
export const READY_AT = "2026-11-04T09:00:00.000Z";

// 两次响应先按独立 recipe 固定；canonical 与后续 wire 共用原文，不从请求反造回复。
const AFTER_REPLY_TEXT = "继续核对第03章。";
const RECOVERY_REPLY_TEXT = "继续核对恢复后的来源。";

export const AUTO_EXECUTABLE = "/fixture/AI Novel Studio.app/Contents/MacOS/app";

export function autoMaintenanceConfig() {
  return { slice_id: "b71-first-consumer", journey: "auto-maintenance", provider: "splash",
    runtime: { profile: "b87-r03-splash-product-maintenance-budget", observed: {
      schema: "b87-r01-runtime-facts/v1", mix_env: "test",
      provider: { selected: "splash", model: "local/Q4-PLE4", endpoint: "http://127.0.0.1:8000/v1" },
      context_pressure: { provider: "splash", window: 32000, maintenance_ratio: 0.7 },
      auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false,
    } } };
}

// 纯判据/IO编排夹具的明确观测输入；不声称这些测试启动过 Tauri 或占用过端口。
export function autoMaintenanceRuntime() {
  return { executable: AUTO_EXECUTABLE, app_processes: 0,
    owned_ports: { backend: null, transport: null }, ports: { backend: false, transport: false },
    llm_calls: 3, process_observation: { method: "fixture", processes: [] } };
}

// 真实 b81-c5-c6-resume-02 after-maintenance.ax.txt:218 的现行 AX 细条形状。
export const MAINTENANCE_STRIP_AX =
  "\t\t0/0/0/0/0/50/3 AXButton, 查看已整理的较早创作过程, enabled=true, focused=false, Actions: AXPress, AXShowMenu, AXScrollToVisible";

export function png() {
  return Buffer.from("89504e470d0a1a0a", "hex");
}

// checkpoint canonical 形状（CP3 后）：covers.call_ids 在 blocks 内，不再读取旧字段。
export function checkpointMessage({ callIds = [CALL_ID], summary = `已整理的较早记录（覆盖 ${CALL_ID}）` } = {}) {
  return {
    role: "checkpoint",
    provenance: "application",
    blocks: [
      {
        type: "checkpoint",
        summary,
        omissions: ["未闭合交换不折叠"],
        source_refs: ["source-1"],
        versions: {},
        covers: { call_ids: callIds, message_refs: [], turn_range: "turn-1" },
      },
    ],
  };
}

export function transcriptRecord() {
  return {
    transcript: {
      messages: [
        { role: "application_base", provenance: "application", blocks: [{ type: "text", text: "base" }] },
        { role: "user", provenance: "author", blocks: [{ type: "text", text: "先读一下第01章的正文和章计划。" }] },
        {
          role: "assistant",
          provenance: "model",
          blocks: [{ type: "tool_call", call_id: CALL_ID, name: "explore", raw_arguments: "{}" }],
        },
        {
          role: "tool",
          provenance: "tool_result",
          blocks: [{ type: "observation", call_id: CALL_ID, status: "ok", source_refs: ["source-1"], versions: {} }],
        },
        { role: "user", provenance: "author", blocks: [{ type: "text", text: "继续读第03章" }] },
        checkpointMessage(),
      ],
    },
  };
}

// checkpoint 在 native wire 中是 user 消息文本；cover 与 summary 都显式携带 call_id。
export function wireCheckpointMessage({
  callIds = [CALL_ID],
  summary = `已整理的较早记录（覆盖 ${CALL_ID}）`,
} = {}) {
  const covers = JSON.stringify({ call_ids: callIds, message_refs: [], turn_range: "turn-1" });
  return {
    role: "user",
    content:
      "【应用数据 · checkpoint · 非作者原话】\n" +
      `【应用数据 · checkpoint · 覆盖 ${covers}】\n` +
      "来源：[\"source-1\"]\n版本：{}\n省略：未闭合交换不折叠\n" +
      summary,
  };
}

export function afterWireMessages({ replayCall = false, replayResult = false, summary } = {}) {
  const messages = [
    { role: "user", content: "【应用数据 · application_base · 非作者原话】\nbase" },
    { role: "user", content: "先读一下第01章的正文和章计划。" },
    { role: "user", content: "继续读第03章" },
    wireCheckpointMessage({ summary }),
  ];
  if (replayCall) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [{ id: CALL_ID, type: "function", function: { name: "explore", arguments: "{}" } }],
    });
  }
  if (replayResult) {
    messages.push({
      role: "tool",
      tool_call_id: CALL_ID,
      content: JSON.stringify({ type: "observation", call_id: CALL_ID, status: "ok" }),
    });
  }
  return messages;
}

export function providerRunsFor({ afterSession = SESSION } = {}) {
  return [
    {
      id: "prun-before",
      provider_call_ref: "pcall-before",
      provider_id: "splash",
      agent_run_id: RUN,
      session_id: SESSION,
      purpose: "planner",
      started_at: BEFORE_STARTED_AT,
      inserted_at: AFTER_STARTED_AT,
    },
    {
      id: "prun-after",
      provider_call_ref: "pcall-after",
      provider_id: "splash",
      agent_run_id: RUN,
      session_id: afterSession,
      purpose: "planner",
      started_at: AFTER_STARTED_AT,
      inserted_at: AFTER_STARTED_AT,
    },
  ];
}

export function providerEventsFor({ afterEmittedAt = AFTER_STARTED_AT } = {}) {
  return [
    {
      id: "pevt-before",
      provider_run_id: "prun-before",
      provider_call_ref: "pcall-before",
      event_type: "started",
      emitted_at: BEFORE_STARTED_AT,
    },
    {
      id: "pevt-after",
      provider_run_id: "prun-after",
      provider_call_ref: "pcall-after",
      event_type: "started",
      emitted_at: afterEmittedAt,
    },
  ];
}

function runFact(id, extra = {}) {
  return { id, workspace_id: WORK, work_id: WORK, session_id: SESSION,
    parent_turn_ref: "turn-" + id, status: "completed", ...extra };
}

function canonicalRow(runId, sequence, runSequence, message) {
  if (message.role === "user" && message.provenance === "author" && !Object.hasOwn(message, "source_refs"))
    message = { ...message, source_refs: [{ ref: "turn-" + runId + "-" + runSequence, version: 1 }] };
  return { id: "row-" + sequence, workspace_id: WORK, work_id: WORK, run_id: runId,
    session_id: SESSION, sequence, run_sequence: runSequence, role: message.role,
    format_version: "authoring-session-message/v1", message: JSON.stringify(message) };
}

export function dbFactsFor({ afterSession = SESSION, afterEmittedAt = AFTER_STARTED_AT } = {}) {
  const baseMessages = [
    ...transcriptRecord().transcript.messages,
    { role: "assistant", provenance: "model", provider_call_ref: "pcall-after", provider_run_ref: "prun-after",
      blocks: [{ type: "text", text: AFTER_REPLY_TEXT }] },
  ].map((message, index) => canonicalRow(RUN, index + 1, index + 1, message));
  const recoveryCall = "call_recovery_1";
  const recoveryMessages = [
    { role: "user", provenance: "author", blocks: [{ type: "text", text: "核对恢复来源" }] },
    { role: "assistant", provenance: "model", blocks: [{ type: "tool_call", call_id: recoveryCall, name: "chapter_read" }] },
    { role: "tool", provenance: "tool_result", blocks: [{ type: "observation", call_id: recoveryCall, status: "ok", source_refs: ["source-1"], versions: {} }] },
    { role: "user", provenance: "author", blocks: [{ type: "text", text: "新工作回合核对恢复后的来源" }] },
    checkpointMessage({ callIds: [recoveryCall], summary: "恢复后的整理记录" }),
    { role: "assistant", provenance: "model", provider_call_ref: "pcall-after-recovery", provider_run_ref: "prun-after-recovery",
      blocks: [{ type: "text", text: RECOVERY_REPLY_TEXT }] },
  ].map((message, index) => canonicalRow(RECOVERY_RUN, baseMessages.length + index + 1, index + 1, message));
  return {
    agent_events: [
      {
        id: "evt-1",
        run_id: RUN,
        event_type: "checkpoint_created",
        visibility: "author",
        sequence: 2,
        payload: JSON.stringify({
          covered_counts: { tool_exchanges: 1, scope_updates: 0, discussion_messages: 0 },
          retained_items: 0,
          scope: "earlier_work_turns",
          sources: ["资料查阅"],
        }),
        inserted_at: EVENT_AT,
      },
      {
        id: "evt-recovery",
        run_id: RECOVERY_RUN,
        event_type: "checkpoint_created",
        visibility: "author",
        sequence: 1,
        payload: JSON.stringify({
          covered_counts: { tool_exchanges: 1, scope_updates: 0, discussion_messages: 0 },
          retained_items: 0,
          scope: "earlier_work_turns",
          sources: ["资料查阅"],
        }),
        inserted_at: "2026-11-04T10:05:00.000Z",
      },
    ],
    agent_runs: [
      runFact(RUN), runFact(FAIL_RUN), runFact(RECOVERY_RUN),
    ],
    authoring_session_messages: [...baseMessages, ...recoveryMessages],
    provider_runs: [...providerRunsFor({ afterSession }), { id: "prun-after-recovery", provider_call_ref: "pcall-after-recovery",
      provider_id: "splash", agent_run_id: RECOVERY_RUN, session_id: afterSession, purpose: "planner" }],
    provider_outputs: [],
    provider_events: [...providerEventsFor({ afterEmittedAt }), { id: "recovery-start", provider_run_id: "prun-after-recovery",
      provider_call_ref: "pcall-after-recovery", event_type: "started", emitted_at: "2026-11-04T10:05:01.000Z" }],
    interactions: [],
    mutations: [],
  };
}

export function afterRecord({
  messages = afterWireMessages(),
  sessionId = SESSION,
  providerRunRef = "prun-after",
  providerCallRef = "pcall-after",
  ts = "2026-11-04T10:00:05.000Z",
  inputTokens = 23000,
  responseText = AFTER_REPLY_TEXT,
} = {}) {
  return {
    ts,
    provider: "splash",
    turn_id: "turn-after",
    session_id: sessionId,
    provider_run_ref: providerRunRef,
    provider_call_ref: providerCallRef,
    request: { body: { messages } },
    response: { status: 200, usage: { input_tokens: inputTokens, output_tokens: 40 },
      body: { choices: [{ index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop" }] } },
  };
}

export function beforeRecord() {
  return {
    ts: "2026-11-04T09:59:30.000Z",
    provider: "splash",
    turn_id: "turn-before",
    session_id: SESSION,
    provider_run_ref: "prun-before",
    provider_call_ref: "pcall-before",
    request: {
      body: {
        messages: [
          { role: "user", content: "读第01章" },
          {
            role: "tool",
            tool_call_id: CALL_ID,
            content: JSON.stringify({ type: "observation", call_id: CALL_ID, status: "ok" }),
          },
        ],
      },
    },
    response: { status: 200, usage: { input_tokens: 1200, output_tokens: 50 } },
  };
}

export function llmRecords() {
  return [beforeRecord(), afterRecord(), afterRecord({ providerRunRef: "prun-after-recovery", providerCallRef: "pcall-after-recovery",
    ts: "2026-11-04T10:05:02.000Z", responseText: RECOVERY_REPLY_TEXT, messages: [
      ...afterWireMessages().slice(1),
      { role: "assistant", content: AFTER_REPLY_TEXT },
      { role: "user", content: "核对恢复来源" },
      { role: "user", content: "新工作回合核对恢复后的来源" },
      wireCheckpointMessage({ callIds: ["call_recovery_1"], summary: "恢复后的整理记录" }),
    ] })];
}

export function driverLogFor() {
  return {
    requests: [{ index: 1 }, { index: 2 }],
    triggered: true,
    first_trigger_index: 2,
    maintenance_strip: { found: true, clicked: true },
    refresh: {
      before_checkpoint_events: 1,
      after_checkpoint_events: 1,
      before_checkpoint_messages: 1,
      after_checkpoint_messages: 1,
    },
    termination: { llm_calls: 3 },
  };
}

// 交错 A/B 续行：B 仅整理更早已完成讨论，A 等待中的问题与交换完整保留；回答 A 后验证新请求。
// 纯事实同时持有原 canonical 与独立 native wire，不从被测读取器生成期望。

export function interleavedResumeFacts() {
  const answerText = "\n  保留悬念，使用「青龙𝄞」\\尾声。\n  ";
  const firstText = "先核对第一章。";
  const laterText = "再检查一次。";
  const keepCall = "call-kept";
  const questionRef = "question-waiting-a";
  const startedAt = "2026-11-04T10:00:02.000Z";
  const sourceRefs = [{ ref: "chapter:kept", version: 2 }];
  const observation = {
    type: "observation", call_id: keepCall, status: "ok",
    source_refs: sourceRefs, versions: { chapter: 2 }, content: { summary: "已核对原章。" },
  };
  const scope = {
    role: "scope_update", provenance: "application",
    versions: { goal: 2, scope_revision: 1 }, source_refs: sourceRefs,
    blocks: [{
      type: "scope",
      content: {
        work_id: WORK,
        facts: { chapters: [{ ref: "chapter:kept", work_id: WORK, seq: 1, title: "第一章" }] },
        operation: { exploration: { allowed: false, tools: [] } },
      },
    }],
  };
  const scopeWire = scopeWireMessage(scope.blocks[0].content, {
    versions: scope.versions, sourceRefs,
  });
  const early = discussionMaintenanceFacts({ workId: WORK, sessionId: SESSION });
  const earlyAuthor = early.messages[0].blocks[0].text;
  const waitingQuestion = "风险表还未完成；请选择结尾揭密方式。";
  const bScope = { ...scope, versions: { goal: 1, scope_revision: 1 } };
  const checkpoint = early.messages[5];
  const summaryRun = { ...early.options.providerRuns[0], agent_run_id: RECOVERY_RUN,
    parent_turn_ref: "turn-" + RECOVERY_RUN, provider_id: "splash" };
  const summaryOutput = { ...early.options.providerOutputs[0], agent_run_id: RECOVERY_RUN };
  const entries = [
    ["early", { role: "application_base", provenance: "application", blocks: [{ type: "text", text: "创作助手" }] }],
    ["early", early.messages[0]], ["early", early.messages[1]], ["early", early.messages[2]],
    [RUN, { role: "user", provenance: "author", blocks: [{ type: "text", text: firstText }] }],
    [RUN, { role: "assistant", provenance: "model", blocks: [{ type: "tool_call", call_id: CALL_ID, name: "chapter_read", arguments: {} }] }],
    [RUN, { role: "tool", provenance: "tool_result", blocks: [{ type: "observation", call_id: CALL_ID, status: "ok", source_refs: ["source-1"], versions: {} }] }],
    [RUN, { role: "assistant", provenance: "model", blocks: [{ type: "text", text: waitingQuestion }] }],
    [RECOVERY_RUN, { role: "user", provenance: "author", blocks: [{ type: "text", text: laterText }] }],
    [RECOVERY_RUN, { role: "assistant", provenance: "model", blocks: [{ type: "tool_call", call_id: keepCall, name: "chapter_read", arguments: {} }] }],
    [RECOVERY_RUN, { role: "tool", provenance: "tool_result", blocks: [observation] }],
    [RECOVERY_RUN, bScope],
    [RECOVERY_RUN, checkpoint],
    [RUN, {
      role: "user", provenance: "author", author_turn: { question_ref: questionRef },
      source_refs: [{ ref: "turn-a:steer:2" }], blocks: [{ type: "text", text: answerText }],
    }],
    [RUN, scope],
    [RUN, {
      role: "assistant", provenance: "model", provider_call_ref: "pcall-after", provider_run_ref: "prun-after",
      blocks: [{ type: "text", text: "已核对。" }],
    }],
  ];
  const perRun = new Map();
  const rows = entries.map(([runId, message], index) => {
    const runSequence = (perRun.get(runId) ?? 0) + 1;
    perRun.set(runId, runSequence);
    const { canonical_ref: _coordinate, ...body } = message;
    return canonicalRow(runId, index + 1, runSequence, body);
  });
  const topic = "workspace:" + WORK;
  const action = {
    action_id: "answer-a", action_type: "author_choice", target_ref: RUN,
    payload: { question_ref: questionRef, expected_goal_version: 1, text: answerText },
  };
  const result = {
    trace: { waiting_run_id: RUN, later_run_id: RECOVERY_RUN, waiting_question_ref: questionRef, waiting_goal_version: 1, warmup_run_ids: ["early"] },
    db: {
      agent_runs: [
        runFact(RUN, { goal_version: 2 }),
        runFact(RECOVERY_RUN, { goal_version: 1 }),
        runFact("early"),
      ],
      agent_events: [{ id: "event-b-checkpoint", run_id: RECOVERY_RUN, event_type: "checkpoint_created", sequence: 1, inserted_at: EVENT_AT }],
      authoring_session_messages: rows,
      provider_runs: [...providerRunsFor(), summaryRun],
      provider_outputs: [summaryOutput],
      provider_events: providerEventsFor({ afterEmittedAt: startedAt }),
    },
    wire: [
      { at: "2026-11-04T10:00:00.700Z", direction: "received", frame: ["join-a", null, topic, "turn_result", { turn_id: "turn-" + RECOVERY_RUN, work_id: WORK, session_id: SESSION,
        agent_run: { run_id: RECOVERY_RUN, parent_turn_ref: "turn-" + RECOVERY_RUN, status: "running" } }] },
      { at: "2026-11-04T10:00:01.000Z", direction: "sent", frame: ["join-a", "reply-a", topic, "author_action", { action }] },
      { at: "2026-11-04T10:00:01.100Z", direction: "received", frame: ["join-a", "reply-a", topic, "phx_reply", {
        status: "ok", response: {
          received: true, duplicate: false, action_status: "accepted",
          action_id: action.action_id, run_id: RUN, question_ref: questionRef, goal_version: 2,
        },
      }] },
    ],
    llmRecords: [{
      provider_run_ref: "prun-after", provider_call_ref: "pcall-after",
      request: { body: { messages: [
        { role: "user", content: earlyAuthor },
        { role: "user", content: firstText },
        { role: "assistant", content: "", tool_calls: [{ id: CALL_ID, type: "function", function: { name: "chapter_read", arguments: "{}" } }] },
        { role: "tool", tool_call_id: CALL_ID, content: JSON.stringify({
          type: "observation", call_id: CALL_ID, status: "ok", source_refs: ["source-1"], versions: {},
        }) },
        { role: "assistant", content: waitingQuestion },
        { role: "user", content: laterText },
        { role: "assistant", content: "", tool_calls: [{ id: keepCall, type: "function", function: { name: "chapter_read", arguments: "{}" } }] },
        { role: "tool", tool_call_id: keepCall, content: JSON.stringify(observation) },
        scopeWireMessage(bScope.blocks[0].content, { versions: bScope.versions, sourceRefs }),
        early.checkpointWire,
        { role: "user", content: answerText },
        scopeWire,
      ], tools: [] } },
    }, early.summaryRecord],
  };
  const before = structuredClone(result.db);
  before.agent_runs.find((run) => run.id === RUN).status = "awaiting_author";
  before.agent_runs.find((run) => run.id === RUN).goal_version = 1;
  const checkpointRow = rows.find((row) => row.run_id === RECOVERY_RUN && row.role === "checkpoint");
  before.authoring_session_messages = before.authoring_session_messages.filter((row) => row.sequence <= checkpointRow.sequence);
  before.provider_runs = before.provider_runs.filter((run) => run.id !== "prun-after");
  before.provider_events = before.provider_events.filter((event) => event.provider_run_id !== "prun-after");
  const waiting = structuredClone(before);
  const firstB = rows.find((row) => row.run_id === RECOVERY_RUN).sequence;
  waiting.authoring_session_messages = waiting.authoring_session_messages.filter((row) => row.sequence < firstB);
  waiting.agent_runs = waiting.agent_runs.filter((run) => run.id !== RECOVERY_RUN);
  waiting.agent_events = [];
  waiting.provider_runs = waiting.provider_runs.filter((run) => run.id !== "prun-summary");
  waiting.provider_outputs = [];
  result.options = { provider: "splash", waitingSnapshot: waiting, beforeAnswerSnapshot: before,
    warmupAuthors: [{ text: earlyAuthor }], controls: [{ text: firstText }, { text: laterText }, { text: answerText }] };
  return result;
}
