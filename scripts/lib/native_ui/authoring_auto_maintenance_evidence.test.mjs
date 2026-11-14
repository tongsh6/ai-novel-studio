// A3 安全点自动维护判据 C1–C10 的纯事实正反例：只消费内存事实与纯判定，不创建
// 目录、SQLite 或子进程。需要真实 AX/capture/DB/端到端 verify 的用例在邻接
// `authoring_auto_maintenance_evidence_io.test.mjs`；两者共享同一组 facts。
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAutoMaintenance } from "./authoring_auto_maintenance_evidence.mjs";
import {
  AFTER_STARTED_AT,
  CALL_ID,
  EVENT_AT,
  FAILURE_REASON,
  FAIL_RUN,
  OTHER_SESSION,
  RECOVERY_RUN,
  RUN,
  SESSION,
  afterRecord,
  afterWireMessages,
  beforeRecord,
  checkpointMessage,
  dbFactsFor,
  driverLogFor,
  llmRecords,
} from "./fixtures/authoring_auto_maintenance_facts.mjs";

function evaluate(overrides = {}) {
  return evaluateAutoMaintenance({
    config: { slice_id: "b71-first-consumer", journey: "auto-maintenance", provider: "strata" },
    dbFacts: overrides.dbFacts ?? dbFactsFor(),
    checkpoints: { start: { authoring_canon: { tables: {} } }, final: { authoring_canon: { tables: {} } } },
    driverLog: overrides.driverLog ?? driverLogFor(),
    cleanup: overrides.cleanup ?? { remaining: [], process_observation: { method: "pgrep+lsof" } },
    strataSlot: overrides.strataSlot ?? { unloaded: true },
    llmRecords: overrides.llmRecords ?? llmRecords(),
    appLog: overrides.appLog ?? [
      { event: "agent_run.auto_maintenance.error", run_id: FAIL_RUN, reason: FAILURE_REASON },
    ],
    dir: overrides.dir ?? null,
    multiTurn: overrides.multiTurn ?? null,
  });
}

test("A3 反例：压力不足/无事件 分别 fail", () => {
  const noPressure = evaluate({
    llmRecords: llmRecords().map((record) => ({ ...record, response: { usage: { input_tokens: 500 } } })),
  });
  assert.equal(noPressure.checks.C1_real_pressure.ok, false);
  const noEvents = evaluate({ dbFacts: { ...dbFactsFor(), agent_events: [] } });
  assert.equal(noEvents.checks.C2_auto_maintenance_committed.ok, false);
});

test("A3 反例：精简泄漏/ canonical 缺失/ 失败可见 分别 fail", () => {
  const leak = evaluate({
    llmRecords: [beforeRecord(), afterRecord({ messages: afterWireMessages({ replayCall: true, replayResult: true }) })],
  });
  assert.equal(leak.checks.C5_next_request_compact.ok, false);
  assert.equal(leak.checks.C5_next_request_compact.reason, "covered_call_ids_still_in_next_request");
  const canonical = evaluate({
    dbFacts: {
      ...dbFactsFor(),
      authoring_session_messages: [],
    },
  });
  assert.equal(canonical.checks.C6_canonical_complete.ok, false);
  const visibleFailure = evaluate({
    driverLog: { ...driverLogFor(), failure_injection: { ...driverLogFor().failure_injection, author_error_visible: true } },
  });
  assert.equal(visibleFailure.checks.C8_failure_silent.ok, false);
});

test("C5 正例：有效 checkpoint 文本显式携带 call_id 不算泄漏，只排除结构化 tool_call/tool_result 重放", () => {
  const messages = afterWireMessages({ summary: `已整理的较早记录（原文含 ${CALL_ID}）` });
  assert(messages.some((message) => typeof message.content === "string" && message.content.includes(CALL_ID)));
  const result = evaluate({ llmRecords: [beforeRecord(), afterRecord({ messages })] });
  const c5 = result.checks.C5_next_request_compact;
  assert.equal(c5.ok, true);
  assert(c5.detail.checks[0].wire_checkpoint_covers.some((ids) => ids.includes(CALL_ID)));
  assert.deepEqual(c5.detail.checks[0].replayed_call_ids, []);
});

test("C5 反例：其他会话 / IR 代替 wire / 首请求缺证时第 2 请求不能补位 → unknown", () => {
  const otherSession = evaluate({
    dbFacts: dbFactsFor({ afterSession: OTHER_SESSION }),
    llmRecords: [beforeRecord(), afterRecord({ sessionId: OTHER_SESSION })],
  });
  assert.equal(otherSession.checks.C5_next_request_compact.ok, null);
  assert.equal(otherSession.checks.C5_next_request_compact.reason, "next_request_evidence_missing");
  assert(otherSession.required.includes("C5_next_request_compact"));
  assert(otherSession.failed.includes("C5_next_request_compact"));

  const irRecord = {
    ...afterRecord(),
    request_format: "authoring-request-ir/v1",
    request_body: {
      ir_version: "authoring-request-ir/v1",
      messages: [
        { role: "application_base", provenance: "application", blocks: [{ type: "text", text: "base" }] },
        { role: "user", provenance: "author", blocks: [{ type: "text", text: "继续读第03章" }] },
        checkpointMessage(),
      ],
      tools: [],
    },
  };
  delete irRecord.request;
  const ir = evaluate({ llmRecords: [beforeRecord(), irRecord] });
  assert.equal(ir.checks.C5_next_request_compact.ok, null);
  assert.equal(ir.checks.C5_next_request_compact.reason, "next_request_evidence_missing");

  const notAfterEvent = evaluate({
    dbFacts: dbFactsFor({ afterEmittedAt: EVENT_AT }),
    llmRecords: [beforeRecord(), afterRecord()],
  });
  assert.equal(notAfterEvent.checks.C5_next_request_compact.ok, null);

  const maskedFacts = dbFactsFor();
  maskedFacts.provider_runs = [
    ...maskedFacts.provider_runs,
    { id: "prun-first", provider_call_ref: "pcall-first", provider_id: "strata", agent_run_id: RUN, session_id: SESSION, purpose: "planner", started_at: null, inserted_at: null },
  ];
  maskedFacts.provider_events = [
    ...maskedFacts.provider_events,
    { id: "pevt-first", provider_run_id: "prun-first", provider_call_ref: "pcall-first", event_type: "started", emitted_at: "2026-11-04T10:00:00.100Z" },
  ];
  const masked = evaluate({ dbFacts: maskedFacts, llmRecords: [beforeRecord(), afterRecord()] });
  assert.equal(masked.checks.C5_next_request_compact.ok, null);
  assert.equal(masked.checks.C5_next_request_compact.reason, "next_request_evidence_missing");
});

test("C6 反例：covers 保留但真实 tool 结果被移除 / 顺序错误 / 旧 checkpoint 形状 → fail", () => {
  const missingResultFacts = dbFactsFor();
  missingResultFacts.authoring_session_messages = missingResultFacts.authoring_session_messages.filter(
    (row) => JSON.parse(row.message).role !== "tool",
  );
  const missingResult = evaluate({ dbFacts: missingResultFacts });
  assert.equal(missingResult.checks.C6_canonical_complete.ok, false);
  assert(
    missingResult.checks.C6_canonical_complete.detail.failures.some(
      (failure) => failure.call_id === CALL_ID && failure.result_count === 0,
    ),
  );

  const swappedRows = dbFactsFor().authoring_session_messages.map((row) => ({ ...row }));
  const callIndex = swappedRows.findIndex((row) => JSON.parse(row.message).role === "assistant");
  const resultIndex = swappedRows.findIndex((row) => JSON.parse(row.message).role === "tool");
  [swappedRows[callIndex].sequence, swappedRows[resultIndex].sequence] = [
    swappedRows[resultIndex].sequence,
    swappedRows[callIndex].sequence,
  ];
  const outOfOrder = evaluate({ dbFacts: { ...dbFactsFor(), authoring_session_messages: swappedRows } });
  assert.equal(outOfOrder.checks.C6_canonical_complete.ok, false);
  assert.equal(outOfOrder.checks.C6_canonical_complete.detail.failures[0].call_count, 1);
  assert.equal(outOfOrder.checks.C6_canonical_complete.detail.failures[0].result_count, 1);

  const legacyFacts = dbFactsFor();
  legacyFacts.authoring_session_messages = legacyFacts.authoring_session_messages.map((row) => {
    const message = JSON.parse(row.message);
    return message.role === "checkpoint"
      ? { ...row, message: JSON.stringify({ role: "checkpoint", call_ids: [CALL_ID] }) }
      : row;
  });
  const legacy = evaluate({ dbFacts: legacyFacts });
  assert.equal(legacy.checks.C6_canonical_complete.ok, false);
  assert.equal(legacy.checks.C6_canonical_complete.reason, "checkpoint_call_ids_missing");
});

test("C6：多条 canonical checkpoint 每条都必须有 covers，任一无 covers 不因另一条合法而假通过", () => {
  const rows = dbFactsFor().authoring_session_messages;
  const appendCheckpoint = (message) => ({
    run_id: RUN,
    session_id: SESSION,
    sequence: rows.length + 1,
    run_sequence: rows.length + 1,
    message: JSON.stringify(message),
  });
  const allCovered = evaluate({
    dbFacts: { ...dbFactsFor(), authoring_session_messages: [...rows, appendCheckpoint(checkpointMessage())] },
  });
  assert.equal(allCovered.checks.C6_canonical_complete.ok, true);

  const oneUncovered = evaluate({
    dbFacts: {
      ...dbFactsFor(),
      authoring_session_messages: [...rows, appendCheckpoint(checkpointMessage({ callIds: [] }))],
    },
  });
  assert.equal(oneUncovered.checks.C6_canonical_complete.ok, false);
  assert.equal(oneUncovered.checks.C6_canonical_complete.reason, "checkpoint_call_ids_missing");
  assert.deepEqual(oneUncovered.checks.C6_canonical_complete.detail.checkpoints_without_covers, [rows.length + 1]);
});

test("C5 反例：wire 存在 malformed call/tool message 时不得通过（缺证语义只留给真缺失）", () => {
  const malformedCallMessages = afterWireMessages();
  malformedCallMessages.push({ role: "assistant", content: "", tool_calls: "not-an-array" });
  const malformedCall = evaluate({ llmRecords: [beforeRecord(), afterRecord({ messages: malformedCallMessages })] });
  assert.equal(malformedCall.checks.C5_next_request_compact.ok, false);
  assert.equal(malformedCall.checks.C5_next_request_compact.reason, "next_request_wire_malformed");
  assert.equal(malformedCall.checks.C5_next_request_compact.detail.checks[0].malformed_calls, 1);
  assert(malformedCall.failed.includes("C5_next_request_compact"));

  const malformedResultMessages = afterWireMessages();
  malformedResultMessages.push({ role: "tool", content: JSON.stringify({ type: "observation", status: "ok" }) });
  const malformedResult = evaluate({ llmRecords: [beforeRecord(), afterRecord({ messages: malformedResultMessages })] });
  assert.equal(malformedResult.checks.C5_next_request_compact.ok, false);
  assert.equal(malformedResult.checks.C5_next_request_compact.reason, "next_request_wire_malformed");
  assert.equal(malformedResult.checks.C5_next_request_compact.detail.checks[0].malformed_tool_messages, 1);
});

test("G6 multi-turn 反例：缺 steer 或未 resume → C11 fail（不放宽）", () => {
  const noSteer = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [],
      resumes: [],
      rounds: [],
      stop_reason: "steer_budget_exhausted",
      max_steers: 6,
      checkpoint_events: 0,
    },
  });
  assert.equal(noSteer.checks.C11_multi_turn_same_run.ok, false);
  assert(noSteer.failed.includes("C11_multi_turn_same_run"));

  const noResume = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: {
            question_text: "请确认要看哪一章的正文与章计划？",
            answer_source: "option",
            answer_text: "选项A",
          },
        },
      ],
      resumes: [{ index: 1, resumed: false, status: "awaiting_author" }],
      rounds: [],
      stop_reason: "resume_failed",
      max_steers: 6,
      checkpoint_events: 0,
    },
  });
  assert.equal(noResume.checks.C11_multi_turn_same_run.ok, false);
  assert(noResume.failed.includes("C11_multi_turn_same_run"));
});

test("G6 跨 turn 正例：首 run 结束后补发 turn 推进 + 选项观察 → C11 pass（cross_turn）", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          kind: "choice",
          label: "保留悬念",
          observation: {
            question_text: "",
            option_titles: ["保留悬念", "当章收束"],
            answer_source: "option",
            answer_text: "保留悬念",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "completed" }],
      rounds: [{ index: 1, pause_kind: "terminal", exchange_facts: { complete_exchanges: 3 } }],
      extra_rounds: [
        { round: 1, index: 2, run_status: "completed", checkpoint_events_after: 0 },
        { round: 2, index: 3, run_status: "failed", checkpoint_events_after: 1 },
      ],
      stop_reason: "run_terminal",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, true);
  assert.equal(result.checks.C11_multi_turn_same_run.detail.scenario, "cross_turn");
  assert(!result.failed.includes("C11_multi_turn_same_run"));
});

test("G6 跨 turn 反例：无推进 turn 或回答未观察 → C11 fail（不放宽）", () => {
  const noAdvanced = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: {
            question_text: "",
            option_titles: ["保留悬念", "当章收束"],
            answer_source: "option",
            answer_text: "保留悬念",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "completed" }],
      extra_rounds: [{ round: 1, index: 2, run_status: "running" }],
      stop_reason: "run_terminal",
      checkpoint_events: 0,
    },
  });
  assert.equal(noAdvanced.checks.C11_multi_turn_same_run.ok, false);
  assert(noAdvanced.failed.includes("C11_multi_turn_same_run"));

  const noObservation = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: { question_text: "", option_titles: [], answer_source: "fallback", answer_text: "按你的判断继续。" },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "completed" }],
      extra_rounds: [{ round: 1, index: 2, run_status: "completed" }],
      stop_reason: "run_terminal",
      checkpoint_events: 1,
    },
  });
  assert.equal(noObservation.checks.C11_multi_turn_same_run.ok, false);
  assert(noObservation.failed.includes("C11_multi_turn_same_run"));
});

test("C8 反例：恢复他 run / 仅改报告无 DB 行 / 日志、计数、结算不符均 fail", () => {
  const base = driverLogFor();
  const withInjection = (patch) => ({
    driverLog: { ...base, failure_injection: { ...base.failure_injection, ...patch } },
  });
  const appLog = (runId, reason = FAILURE_REASON) => [
    { event: "agent_run.auto_maintenance.error", run_id: runId, reason },
  ];

  const otherRun = evaluate({ ...withInjection({}), appLog: appLog("run-other") });
  assert.equal(otherRun.checks.C8_failure_silent.ok, false);
  assert.equal(otherRun.checks.C8_failure_silent.detail.failure_log_run_id, null);

  const wrongReason = evaluate({ ...withInjection({}), appLog: appLog(FAIL_RUN, "maintenance unavailable") });
  assert.equal(wrongReason.checks.C8_failure_silent.ok, false);
  assert.equal(wrongReason.checks.C8_failure_silent.detail.failure_log_reason, "maintenance unavailable");

  const recoveryOtherRun = evaluate(
    withInjection({ recovery_request: { index: 4, run_id: "run-other", settled: true } }),
  );
  assert.equal(recoveryOtherRun.checks.C8_failure_silent.ok, false);
  assert.equal(recoveryOtherRun.checks.C8_failure_silent.detail.recovery_checkpoint_event_count, 0);
  assert.equal(recoveryOtherRun.checks.C8_failure_silent.detail.recovery_checkpoint_message_count, 0);

  const noDbRow = dbFactsFor();
  noDbRow.agent_events = noDbRow.agent_events.filter((event) => event.run_id !== RECOVERY_RUN);
  noDbRow.authoring_session_messages = noDbRow.authoring_session_messages.filter(
    (row) => row.run_id !== RECOVERY_RUN,
  );
  const reportOnly = evaluate({ ...withInjection({}), dbFacts: noDbRow });
  assert.equal(reportOnly.checks.C8_failure_silent.ok, false);
  assert.equal(reportOnly.checks.C8_failure_silent.detail.recovery_checkpoint_event_count, 0);
  assert.equal(reportOnly.checks.C8_failure_silent.detail.recovery_checkpoint_message_count, 0);

  const axUnread = evaluate(withInjection({ author_error_visible: null }));
  assert.equal(axUnread.checks.C8_failure_silent.ok, false);
  assert.equal(axUnread.checks.C8_failure_silent.detail.author_error_visible, null);

  const nullCount = evaluate(withInjection({ checkpoint_events_after_failure: null }));
  assert.equal(nullCount.checks.C8_failure_silent.ok, false);

  const messageGrew = evaluate(withInjection({ checkpoint_messages_after_failure: 2 }));
  assert.equal(messageGrew.checks.C8_failure_silent.ok, false);

  const failureUnsettled = evaluate(
    withInjection({ failure_request: { index: 3, run_id: FAIL_RUN, settled: false } }),
  );
  assert.equal(failureUnsettled.checks.C8_failure_silent.ok, false);

  const failedFailureRun = dbFactsFor();
  failedFailureRun.agent_runs = failedFailureRun.agent_runs.map((row) =>
    row.id === FAIL_RUN ? { ...row, status: "failed" } : row,
  );
  const failedRun = evaluate({ ...withInjection({}), dbFacts: failedFailureRun });
  assert.equal(failedRun.checks.C8_failure_silent.ok, false);
  assert.equal(failedRun.checks.C8_failure_silent.detail.failure_run_status, "failed");

  const cancelledRecoveryRun = dbFactsFor();
  cancelledRecoveryRun.agent_runs = cancelledRecoveryRun.agent_runs.map((row) =>
    row.id === RECOVERY_RUN ? { ...row, status: "cancelled" } : row,
  );
  const cancelledRun = evaluate({ ...withInjection({}), dbFacts: cancelledRecoveryRun });
  assert.equal(cancelledRun.checks.C8_failure_silent.ok, false);
  assert.equal(cancelledRun.checks.C8_failure_silent.detail.recovery_run_status, "cancelled");

  const missingRun = dbFactsFor();
  missingRun.agent_runs = missingRun.agent_runs.filter((row) => row.id !== RECOVERY_RUN);
  const noRunStatus = evaluate({ ...withInjection({}), dbFacts: missingRun });
  assert.equal(noRunStatus.checks.C8_failure_silent.ok, false);
  assert.equal(noRunStatus.checks.C8_failure_silent.detail.recovery_run_status, null);
});

test("跨 run A3 场景：C11 不判（ok=null，不进 required）", () => {
  const result = evaluate();
  assert.equal(result.checks.C11_multi_turn_same_run.ok, null);
  assert(!result.required.includes("C11_multi_turn_same_run"));
});

test("G6 multi-turn 反例：回答全为 fallback（未基于真实问题观察）→ C11 fail", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: {
            question_text: "请确认要看哪一章的正文与章计划？",
            answer_source: "fallback",
            answer_text: "按你的判断继续。",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "running" }],
      rounds: [],
      stop_reason: "triggered",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, false);
  assert.equal(result.checks.C11_multi_turn_same_run.reason, "multi_turn_not_observation_driven");
  assert(result.failed.includes("C11_multi_turn_same_run"));
});

test("G6 multi-turn 反例：缺少问题文本绑定 → C11 fail", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [{ index: 1, ok: true, observation: { question_text: "", answer_source: "extracted_text" } }],
      resumes: [{ index: 1, resumed: true, status: "running" }],
      rounds: [],
      stop_reason: "triggered",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, false);
  assert.equal(result.checks.C11_multi_turn_same_run.reason, "multi_turn_not_observation_driven");
});
