// B71 auto-maintenance 证据族的纯事实 owner：只提供内存字节/行，不创建目录、DB
// 或子进程。真实文件与 7 表 SQLite 模板在 `authoring_auto_maintenance_io_fixture.mjs`；
// 纯评估测试与 IO 测试共享本文件的同一组事实，避免各自复制期望。
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
        covers: { call_ids: callIds, turn_range: "turn-1" },
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
          provenance: "assistant",
          blocks: [{ type: "tool_call", call_id: CALL_ID, name: "explore", raw_arguments: "{}" }],
        },
        {
          role: "tool",
          provenance: "tool",
          blocks: [{ type: "observation", call_id: CALL_ID, status: "ok", refs: [] }],
        },
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
  const covers = JSON.stringify({ call_ids: callIds, turn_range: "turn-1" });
  return {
    role: "user",
    content:
      "【应用数据 · checkpoint · 非作者原话】\n" +
      `【应用数据 · checkpoint · 覆盖 ${covers}】\n` +
      "来源：[]\n版本：{}\n省略：未闭合交换不折叠\n" +
      summary,
  };
}

export function afterWireMessages({ replayCall = false, replayResult = false, summary } = {}) {
  const messages = [
    { role: "application_base", content: "base" },
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
      provider_id: "strata",
      agent_run_id: RUN,
      session_id: SESSION,
      purpose: "planner",
      started_at: BEFORE_STARTED_AT,
      inserted_at: AFTER_STARTED_AT,
    },
    {
      id: "prun-after",
      provider_call_ref: "pcall-after",
      provider_id: "strata",
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

export function dbFactsFor({ afterSession = SESSION, afterEmittedAt = AFTER_STARTED_AT } = {}) {
  const baseMessages = transcriptRecord().transcript.messages.map((message, index) => ({
    run_id: RUN,
    session_id: SESSION,
    sequence: index + 1,
    run_sequence: index + 1,
    message: JSON.stringify(message),
  }));
  return {
    agent_events: [
      {
        id: "evt-1",
        run_id: RUN,
        event_type: "checkpoint_created",
        visibility: "author",
        sequence: 2,
        payload: JSON.stringify({
          covered_exchanges: 1,
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
          covered_exchanges: 1,
          retained_items: 0,
          scope: "earlier_work_turns",
          sources: ["资料查阅"],
        }),
        inserted_at: "2026-11-04T10:05:00.000Z",
      },
    ],
    agent_runs: [
      { id: RUN, status: "completed", session_id: SESSION },
      { id: FAIL_RUN, status: "completed", session_id: SESSION },
      { id: RECOVERY_RUN, status: "completed", session_id: SESSION },
    ],
    authoring_session_messages: [
      ...baseMessages,
      {
        run_id: RECOVERY_RUN,
        session_id: SESSION,
        sequence: 7,
        run_sequence: 1,
        message: JSON.stringify(checkpointMessage({ summary: `恢复后的整理记录（覆盖 ${CALL_ID}）` })),
      },
    ],
    provider_runs: providerRunsFor({ afterSession }),
    provider_events: providerEventsFor({ afterEmittedAt }),
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
  inputTokens = 3000,
} = {}) {
  return {
    ts,
    provider: "strata",
    turn_id: "turn-after",
    session_id: sessionId,
    provider_run_ref: providerRunRef,
    provider_call_ref: providerCallRef,
    request: { body: { messages } },
    response: { status: 200, usage: { input_tokens: inputTokens, output_tokens: 40 } },
  };
}

export function beforeRecord() {
  return {
    ts: "2026-11-04T09:59:30.000Z",
    provider: "strata",
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
  return [beforeRecord(), afterRecord()];
}

export function driverLogFor() {
  return {
    env: { auto_maintenance_enabled: "1", window_overrides: "strata:4096" },
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
    failure_injection: {
      trigger_created: true,
      author_error_visible: false,
      checkpoint_events_before_failure: 1,
      checkpoint_events_after_failure: 1,
      checkpoint_messages_before_failure: 1,
      checkpoint_messages_after_failure: 1,
      failure_request: { index: 3, run_id: FAIL_RUN, settled: true, run_status: "completed" },
      recovery_request: { index: 4, run_id: RECOVERY_RUN, settled: true, run_status: "completed" },
    },
    termination: { llm_calls: 2 },
  };
}
