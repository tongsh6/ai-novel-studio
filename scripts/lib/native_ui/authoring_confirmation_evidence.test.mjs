// B71 §16.14 确认/拒绝判据 C1–C12 正反例（硬门禁：缺证据不得 PASS）。
// 本文件只保留纯判据/解析/按钮定位；runtime 观察、AX 文件扫描与 SQLite reader
// 等真实 IO 集合在邻接 `authoring_confirmation_evidence_io.test.mjs`。
import assert from "node:assert/strict";
import test from "node:test";
import { CONFIRMATION_REQUEST } from "./authoring_confirmation_constants.mjs";
import { irBodyFromWire } from "./fixtures/authoring_request_ir.mjs";
import {
  confirmationCardLines,
  evaluateConfirmation,
  executedConfirmationTurnResult,
  locateConfirmationButton,
  rejectConfirmationTurnResult,
  selectConfirmationAction,
} from "./authoring_confirmation_evidence.mjs";
import { assembleConfirmationFacts } from "./authoring_confirmation_facts.mjs";
import {
  CHILD_COMPLETED_EVENT,
  CHILD_STARTED_EVENT,
  CHILD_TOOL_STARTED_EVENT,
  JOIN_REF,
  OTHER_RUN,
  REF,
  SOURCE_RUN,
  SOURCE_TURN,
  TOPIC,
  USER_TURN,
  canonSnapshot,
  childAgentEventFrame,
  childWireEvents,
  confirmActions,
  confirmationInput,
  counts,
  dbFactsFor,
  driverLogFor,
  needsBody,
  received,
  runtimeObservation,
  wireFor,
  withoutChildAgentEvents,
} from "./fixtures/authoring_confirmation_scenarios.mjs";

function evaluate(mode, overrides = {}) {
  return evaluateConfirmation(confirmationInput(mode, overrides));
}

function wireWithNeedsBody(body) {
  return wireFor("confirm").frames.map((record) =>
    record.frame?.[3] === "turn_result" && record.frame?.[4]?.status === "needs_confirmation"
      ? received("turn_result", body, record.at)
      : record,
  );
}

function needsBodyWithoutAgentRun() {
  const body = needsBody();
  delete body.agent_run;
  return body;
}

function dbWithoutSourceAgentRunId() {
  const dbFacts = dbFactsFor("confirm");
  return {
    ...dbFacts,
    interactions: dbFacts.interactions.map((interaction) => {
      if (interaction.turn_id !== SOURCE_TURN) return interaction;
      const content = { ...interaction.content };
      delete content.agent_run_id;
      return { ...interaction, content };
    }),
  };
}

test("confirm 正例：C1–C12 全过（硬门禁均有真实证据）", () => {
  const result = evaluate("confirm");
  assert.deepEqual(result.failed, []);
  assert.equal(result.checks.C1_source_persisted.ok, true);
  assert.equal(result.checks.C2_confirmation_accepted.ok, true);
  assert.equal(result.checks.C3_author_action_run_bound.ok, true);
  assert.equal(result.checks.C4_behavior_uniquely_consumed.ok, true);
  assert.equal(result.checks.C5_duplicate_idempotent.ok, true);
  assert.equal(result.checks.C6_reject_zero_side_effect.ok, null);
  assert.equal(result.checks.C7_confirmed_child_execution.ok, true);
  assert.equal(result.checks.C7_confirmed_child_execution.detail.branch, "executed");
  assert.equal(result.checks.C12_child_live_startup_events.ok, true);
  assert.deepEqual(result.checks.C12_child_live_startup_events.detail.required_types, ["run_started", "tool_started"]);
  assert.deepEqual(
    result.checks.C12_child_live_startup_events.detail.events.map((entry) => [entry.order, entry.event_id, entry.sequence, entry.event_type]),
    [
      [1, CHILD_STARTED_EVENT, 1, "run_started"],
      [2, CHILD_TOOL_STARTED_EVENT, 2, "tool_started"],
      [3, CHILD_COMPLETED_EVENT, 19, "run_completed"],
    ],
  );
  assert.equal(result.checks.C8_author_bytes.ok, true);
  assert.equal(result.checks.C9_why_replay_zero_provider.ok, true);
  assert.equal(result.checks.C10_restore_not_actionable.ok, true);
  assert.equal(result.checks.C11_cleanup.ok, true);
});

test("reject 正例：C6 零副作用（采样窗 delta=0/decision CANCELLED/author/cancel_waiting）", () => {
  const result = evaluate("reject");
  assert.deepEqual(result.failed, []);
  assert.equal(result.checks.C6_reject_zero_side_effect.ok, true);
  assert.equal(result.checks.C6_reject_zero_side_effect.detail.child_run_status, "cancelled");
  assert.equal(result.checks.C6_reject_zero_side_effect.detail.canon.works, true);
  assert.equal(result.checks.C7_confirmed_child_execution.ok, null);
  assert.equal(result.checks.C12_child_live_startup_events.ok, null);
  assert.equal(result.checks.C12_child_live_startup_events.reason, "not_applicable");
});

test("C12 正例：同源 child 启动事件 id/seq 与 DB 一致且先于终局 → pass；payload 仅作者投影不要求相等", () => {
  const result = evaluate("confirm");
  const c12 = result.checks.C12_child_live_startup_events;
  assert.equal(c12.ok, true);
  assert.equal(c12.detail.terminal.event_id, CHILD_COMPLETED_EVENT);
  assert.equal(c12.detail.terminal.sequence, 19);
  assert.equal(c12.detail.terminal.order, 3);
  assert.deepEqual(
    c12.detail.startup_events.map((entry) => [entry.order, entry.event_id, entry.sequence, entry.event_type, entry.db_ok, entry.db_reason]),
    [
      [1, CHILD_STARTED_EVENT, 1, "run_started", true, null],
      [2, CHILD_TOOL_STARTED_EVENT, 2, "tool_started", true, null],
    ],
  );
  assert.equal(c12.detail.events[0].summary, "AgentRun 已启动。");
  assert.equal(c12.detail.events[0].pre_terminal, true);
  // 终局后的 reconnect/重复推送不参与判定。
  const replay = [...childWireEvents().map(childAgentEventFrame), childAgentEventFrame(childWireEvents()[0])];
  const replayed = evaluate("confirm", {
    wire: [...withoutChildAgentEvents(wireFor("confirm").frames), ...replay],
  });
  assert.equal(replayed.checks.C12_child_live_startup_events.ok, true);
  assert.equal(replayed.checks.C12_child_live_startup_events.detail.after_terminal_ignored, 1);
  // 无关/空记录不得让采集本身抛错，也不得冒充 child 事件。
  const withNull = evaluate("confirm", { wire: [...wireFor("confirm").frames, null] });
  assert.equal(withNull.checks.C12_child_live_startup_events.ok, true);
});

function twoToolStartedFixture() {
  const extraId = "evt-child-tool-started-2";
  const extraSequence = 3;
  const facts = dbFactsFor("confirm");
  const toolIndex = facts.agent_events.findIndex((row) => row.id === CHILD_TOOL_STARTED_EVENT);
  const extraRow = {
    ...facts.agent_events[toolIndex],
    id: extraId,
    sequence: extraSequence,
    summary: "第二次工具开始。",
    reason_codes: JSON.stringify(["second_tool_started"]),
    refs: JSON.stringify(["plan-child-2"]),
  };
  facts.agent_events = [
    ...facts.agent_events.slice(0, toolIndex + 1),
    extraRow,
    ...facts.agent_events.slice(toolIndex + 1),
  ];
  const [started, toolStarted, terminal] = childWireEvents();
  const secondTool = {
    at: "2026-11-03T10:00:09.300Z",
    body: {
      ...toolStarted.body,
      event_id: extraId,
      sequence: extraSequence,
      summary: extraRow.summary,
      reason_codes: ["second_tool_started"],
      refs: ["plan-child-2"],
    },
  };
  return {
    facts,
    extraId,
    extraSequence,
    wire: [
      ...withoutChildAgentEvents(wireFor("confirm").frames),
      childAgentEventFrame(started),
      childAgentEventFrame(toolStarted),
      childAgentEventFrame(secondTool),
      childAgentEventFrame(terminal),
    ],
  };
}

test("C12 正例：多个合法 tool_started 不同 id/seq 各自与 DB 同源 → pass", () => {
  const { facts, wire, extraId, extraSequence } = twoToolStartedFixture();
  const c12 = evaluate("confirm", { wire, dbFacts: facts }).checks.C12_child_live_startup_events;
  assert.equal(c12.ok, true);
  assert.equal(c12.reason, null);
  assert.deepEqual(
    c12.detail.startup_events.map((entry) => [entry.event_id, entry.sequence, entry.event_type, entry.db_ok]),
    [
      [CHILD_STARTED_EVENT, 1, "run_started", true],
      [CHILD_TOOL_STARTED_EVENT, 2, "tool_started", true],
      [extraId, extraSequence, "tool_started", true],
    ],
  );
});

test("C12 红：第二个 tool_started 的 DB 字段不一致也 fail（不能只验第一个）", () => {
  const { facts, wire, extraId } = twoToolStartedFixture();
  facts.agent_events.find((row) => row.id === extraId).summary = "DB 侧不同摘要";
  const c12 = evaluate("confirm", { wire, dbFacts: facts }).checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.equal(c12.reason, "startup_event_db_mismatch");
  const measured = c12.detail.startup_events.find((entry) => entry.event_id === extraId);
  assert(measured.mismatches.some((mismatch) => mismatch.field === "summary"));
});

test("C12 红：DB 有完整 child 启动/tool 事实但 WS 只到终局（01k2 缺口）→ fail", () => {
  const terminal = childWireEvents().find((entry) => entry.body.event_type === "run_completed");
  const wire = [...withoutChildAgentEvents(wireFor("confirm").frames), childAgentEventFrame(terminal)];
  const result = evaluate("confirm", { wire });
  const c12 = result.checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.equal(c12.reason, "child_live_startup_missing");
  assert.deepEqual(c12.detail.missing, ["run_started", "tool_started"]);
  assert.equal(c12.detail.db_has_tool_started, true);
  assert.equal(c12.detail.tool_started_after_run_started, true);
  assert.deepEqual(c12.detail.events.map((entry) => entry.event_id), [CHILD_COMPLETED_EVENT]);
});

test("C12 红：其他 run 的同类事件不算 child 实时启动证据", () => {
  const events = childWireEvents();
  const terminal = events.find((entry) => entry.body.event_type === "run_completed");
  const otherRunStartup = events
    .filter((entry) => entry.body.event_type !== "run_completed")
    .map((entry) => ({
      ...entry,
      body: { ...entry.body, run_id: OTHER_RUN, run_ref: OTHER_RUN },
    }));
  const wire = [
    ...withoutChildAgentEvents(wireFor("confirm").frames),
    ...otherRunStartup.map(childAgentEventFrame),
    childAgentEventFrame(terminal),
  ];
  const result = evaluate("confirm", { wire });
  const c12 = result.checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.deepEqual(c12.detail.missing, ["run_started", "tool_started"]);
  assert.deepEqual(c12.detail.events.map((entry) => entry.event_id), [CHILD_COMPLETED_EVENT]);
});

test("C12 红：伪装成 phx_reply 的启动/tool 推送不算 agent_event 实时证据", () => {
  const events = childWireEvents();
  const terminal = events.find((entry) => entry.body.event_type === "run_completed");
  const fakeReplies = events
    .filter((entry) => entry.body.event_type !== "run_completed")
    .map((entry) => ({
      ...childAgentEventFrame(entry),
      frame: [JOIN_REF, REF, TOPIC, "phx_reply", entry.body],
    }));
  const wire = [...withoutChildAgentEvents(wireFor("confirm").frames), ...fakeReplies, childAgentEventFrame(terminal)];
  const result = evaluate("confirm", { wire });
  const c12 = result.checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.deepEqual(c12.detail.missing, ["run_started", "tool_started"]);
  assert.deepEqual(c12.detail.events.map((entry) => entry.event_id), [CHILD_COMPLETED_EVENT]);
});

test("C12 红：同 event_id 的 DB run_id/sequence/event_type/summary/reason_codes/refs 任一不一致 fail", () => {
  const mutations = [
    ["run_id", OTHER_RUN],
    ["sequence", 9],
    ["event_type", "goal_understood"],
    ["summary", "被篡改的摘要"],
    ["reason_codes", JSON.stringify(["tampered"])],
    ["refs", JSON.stringify(["tampered"])],
  ];
  for (const [field, value] of mutations) {
    const facts = dbFactsFor("confirm");
    facts.agent_events = facts.agent_events.map((row) =>
      row.id === CHILD_STARTED_EVENT ? { ...row, [field]: value } : row,
    );
    const result = evaluate("confirm", { dbFacts: facts });
    const c12 = result.checks.C12_child_live_startup_events;
    assert.equal(c12.ok, false, field);
    assert.equal(c12.reason, "startup_event_db_mismatch", field);
    const measured = c12.detail.startup_events.find((entry) => entry.event_id === CHILD_STARTED_EVENT);
    assert(measured.mismatches.some((mismatch) => mismatch.field === field), field);
  }
});

test("C12 红：终局前重复事件不能靠 Set 吞掉后算过", () => {
  const events = childWireEvents();
  const [started, toolStarted, terminal] = events;
  const sameIdDuplicate = evaluate("confirm", {
    wire: [
      ...withoutChildAgentEvents(wireFor("confirm").frames),
      childAgentEventFrame(started),
      childAgentEventFrame({ ...started, at: "2026-11-03T10:00:09.150Z" }),
      childAgentEventFrame(toolStarted),
      childAgentEventFrame(terminal),
    ],
  });
  const c12SameId = sameIdDuplicate.checks.C12_child_live_startup_events;
  assert.equal(c12SameId.ok, false);
  assert.equal(c12SameId.reason, "duplicate_event_id_before_terminal");
  assert.deepEqual(c12SameId.detail.duplicate_event_ids, [CHILD_STARTED_EVENT]);

  const sameSeqDuplicate = evaluate("confirm", {
    wire: [
      ...withoutChildAgentEvents(wireFor("confirm").frames),
      childAgentEventFrame(started),
      childAgentEventFrame({
        ...started,
        body: { ...started.body, event_id: `${CHILD_STARTED_EVENT}-copy` },
      }),
      childAgentEventFrame(toolStarted),
      childAgentEventFrame(terminal),
    ],
  });
  const c12SameSeq = sameSeqDuplicate.checks.C12_child_live_startup_events;
  assert.equal(c12SameSeq.ok, false);
  assert.equal(c12SameSeq.reason, "duplicate_sequence_before_terminal");
  assert.deepEqual(c12SameSeq.detail.duplicate_sequences, [1]);
});

test("C12 红：启动/tool 事件在第一次终局后到达不算，终局后重放本身被截断忽略", () => {
  const [started, toolStarted, terminal] = childWireEvents();
  const afterTerminal = evaluate("confirm", {
    wire: [
      ...withoutChildAgentEvents(wireFor("confirm").frames),
      childAgentEventFrame(terminal),
      childAgentEventFrame(started),
      childAgentEventFrame(toolStarted),
    ],
  });
  const c12 = afterTerminal.checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.equal(c12.reason, "child_live_startup_missing");
  assert.deepEqual(c12.detail.missing, ["run_started", "tool_started"]);
  assert.equal(c12.detail.after_terminal_ignored, 2);
});

test("C12 红：run_started 起始序号必须为 1", () => {
  const events = childWireEvents();
  const facts = dbFactsFor("confirm");
  facts.agent_events = facts.agent_events.map((row) => {
    if (row.id === CHILD_STARTED_EVENT) return { ...row, sequence: 2 };
    if (row.id === CHILD_TOOL_STARTED_EVENT) return { ...row, sequence: 3 };
    return row;
  });
  const result = evaluate("confirm", {
    wire: [
      ...withoutChildAgentEvents(wireFor("confirm").frames),
      ...events.map((entry) => {
        if (entry.body.event_type === "run_started") {
          return childAgentEventFrame({ ...entry, body: { ...entry.body, sequence: 2 } });
        }
        if (entry.body.event_type === "tool_started") {
          return childAgentEventFrame({ ...entry, body: { ...entry.body, sequence: 3 } });
        }
        return childAgentEventFrame(entry);
      }),
    ],
    dbFacts: facts,
  });
  const c12 = result.checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.equal(c12.reason, "run_started_sequence_not_one");
  assert.equal(c12.detail.run_started_sequence, 2);
});

test("C12 红：两个 run_started 即使 id/seq 不同也违反唯一性", () => {
  const [started, , terminal] = childWireEvents();
  const secondStarted = {
    at: "2026-11-03T10:00:09.150Z",
    body: { ...started.body, event_id: "evt-child-run-started-2", sequence: 3 },
  };
  const c12 = evaluate("confirm", {
    wire: [
      ...withoutChildAgentEvents(wireFor("confirm").frames),
      childAgentEventFrame(started),
      childAgentEventFrame(secondStarted),
      childAgentEventFrame(terminal),
    ],
  }).checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.equal(c12.reason, "startup_event_not_unique");
  assert.equal(c12.detail.run_started_count, 2);
});

test("C12 红：缺 run_started 时不得由 tool_started 顶替，也不得在顺序比较中抛错", () => {
  const events = childWireEvents().filter((entry) => entry.body.event_type !== "run_started");
  const result = evaluate("confirm", {
    wire: [...withoutChildAgentEvents(wireFor("confirm").frames), ...events.map(childAgentEventFrame)],
  });
  const c12 = result.checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.equal(c12.reason, "child_live_startup_missing");
  assert.deepEqual(c12.detail.missing, ["run_started"]);
  assert.equal(c12.detail.tool_started_after_run_started, true);
});

test("C12 红：child run_id 缺失时如实 fail，detail 不伪造 run id", () => {
  const facts = dbFactsFor("confirm");
  facts.receipts[0].result = { ...facts.receipts[0].result, run_id: "" };
  const result = evaluate("confirm", { dbFacts: facts });
  const c12 = result.checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.equal(c12.reason, "child_run_id_missing");
  assert.equal(c12.detail.child_run_id, null);
});

test("C12 红：run_started 序号 0 不是起点 1", () => {
  const facts = dbFactsFor("confirm");
  facts.agent_events = facts.agent_events.map((row) =>
    row.id === CHILD_STARTED_EVENT ? { ...row, sequence: 0 } : row,
  );
  const events = childWireEvents().map((entry) =>
    entry.body.event_type === "run_started"
      ? { ...entry, body: { ...entry.body, sequence: 0 } }
      : entry,
  );
  const result = evaluate("confirm", {
    wire: [...withoutChildAgentEvents(wireFor("confirm").frames), ...events.map(childAgentEventFrame)],
    dbFacts: facts,
  });
  const c12 = result.checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.equal(c12.reason, "run_started_sequence_not_one");
  assert.equal(c12.detail.run_started_sequence, 0);
});

test("C12 红：event_id 缺失/DB 无同 id/摘要缺失均 fail 且不伪装", () => {
  const missingDb = dbFactsFor("confirm");
  missingDb.agent_events = missingDb.agent_events.filter((row) => row.id !== CHILD_STARTED_EVENT);
  const dbMissing = evaluate("confirm", { dbFacts: missingDb }).checks.C12_child_live_startup_events;
  assert.equal(dbMissing.ok, false);
  const dbMissingEvent = dbMissing.detail.startup_events.find((entry) => entry.event_type === "run_started");
  assert.equal(dbMissingEvent.db_ok, false);
  assert.equal(dbMissingEvent.db_reason, "db_event_missing");

  const emptyIdEvents = childWireEvents().map((entry) =>
    entry.body.event_type === "run_started"
      ? { ...entry, body: { ...entry.body, event_id: "" } }
      : entry,
  );
  const emptyId = evaluate("confirm", {
    wire: [...withoutChildAgentEvents(wireFor("confirm").frames), ...emptyIdEvents.map(childAgentEventFrame)],
  }).checks.C12_child_live_startup_events;
  assert.equal(emptyId.ok, false);
  const emptyIdEvent = emptyId.detail.startup_events.find((entry) => entry.event_type === "run_started");
  assert.equal(emptyIdEvent.db_ok, false);
  assert.equal(emptyIdEvent.db_reason, "event_id_missing");

  const noSummaryEvents = childWireEvents().map((entry) => {
    if (entry.body.event_type !== "run_started") return entry;
    const body = { ...entry.body };
    delete body.summary;
    return { ...entry, body };
  });
  const noSummary = evaluate("confirm", {
    wire: [...withoutChildAgentEvents(wireFor("confirm").frames), ...noSummaryEvents.map(childAgentEventFrame)],
  }).checks.C12_child_live_startup_events;
  assert.equal(noSummary.ok, false);
  assert.equal(noSummary.detail.events[0].summary, null);
  assert(
    noSummary.detail.startup_events
      .find((entry) => entry.event_type === "run_started")
      .mismatches.some((mismatch) => mismatch.field === "summary"),
  );
});

test("C12：gate_blocked 分支无 DB tool_started 事实时不虚构要求；DB 有事实则仍要求 WS 到达", () => {
  const blockedFrames = withoutChildAgentEvents(wireFor("confirm").frames)
    .filter((record) => record.frame?.[4]?.turn_id !== "turn_exec")
    .map((record) =>
      record.frame?.[4]?.turn_id === "turn_dec"
        ? received(
            "turn_result",
            {
              ...record.frame[4],
              truthfulness: { tool_called: false, execution_blocked: true, first_blocking_gate: "gate:dry_run" },
            },
            record.at,
          )
        : record,
    );
  const terminal = childWireEvents().find((entry) => entry.body.event_type === "run_completed");
  const started = childWireEvents().find((entry) => entry.body.event_type === "run_started");
  const wire = [...blockedFrames, childAgentEventFrame(started), childAgentEventFrame(terminal)];

  const noToolFact = dbFactsFor("confirm");
  noToolFact.agent_events = noToolFact.agent_events.filter((row) => row.event_type !== "tool_started");
  const allowed = evaluate("confirm", { wire, dbFacts: noToolFact });
  assert.equal(allowed.checks.C7_confirmed_child_execution.detail.branch, "gate_blocked");
  assert.equal(allowed.checks.C12_child_live_startup_events.ok, true);
  assert.deepEqual(allowed.checks.C12_child_live_startup_events.detail.required_types, ["run_started"]);
  assert.equal(allowed.checks.C12_child_live_startup_events.detail.db_has_tool_started, false);

  const withToolFact = dbFactsFor("confirm");
  const missingTool = evaluate("confirm", { wire, dbFacts: withToolFact });
  assert.equal(missingTool.checks.C12_child_live_startup_events.ok, false);
  assert.deepEqual(missingTool.checks.C12_child_live_startup_events.detail.missing, ["tool_started"]);
});

test("C9 硬门禁：Why 未打开或计数缺失/非零 delta 一律 fail", () => {
  const closed = evaluate("confirm", {
    driverLog: driverLogFor("confirm", { why: { opened: false, reason: "why_button_scrolled_but_not_visible" } }),
  });
  assert.equal(closed.checks.C9_why_replay_zero_provider.ok, false);
  const delta = evaluate("confirm", {
    driverLog: driverLogFor("confirm", {
      why: { ...driverLogFor("confirm").why, after: counts(2), llm_calls_delta: 1 },
    }),
  });
  assert.equal(delta.checks.C9_why_replay_zero_provider.ok, false);
});

test("C5 硬门禁：duplicate 未验证（无 attempted/ack 且 delta 非零）fail；不可点+零 delta 合法", () => {
  const unverified = evaluate("confirm", {
    driverLog: driverLogFor("confirm", {
      duplicate: { attempted: false, reason: null, delta: null },
    }),
  });
  assert.equal(unverified.checks.C5_duplicate_idempotent.ok, false);
  const clicked = evaluate("confirm", {
    driverLog: driverLogFor("confirm", {
      duplicate: {
        attempted: true,
        clicked: true,
        actionable: true,
        duplicate_ack: { response: { action_status: "duplicate" } },
        before: counts(1),
        after: counts(1),
        delta: { provider_runs: 0, agent_runs: 0, receipts: 0, llm_calls: 0 },
      },
    }),
  });
  assert.equal(clicked.checks.C5_duplicate_idempotent.ok, true);
  const nonzero = evaluate("confirm", {
    driverLog: driverLogFor("confirm", {
      duplicate: { attempted: false, reason: "not_actionable:action_missing", delta: { provider_runs: 1, agent_runs: 0, receipts: 0, llm_calls: 0 } },
    }),
  });
  assert.equal(nonzero.checks.C5_duplicate_idempotent.ok, false);
});

test("C10 硬门禁：恢复后决定/创作结果不可见或重启非零 delta fail", () => {
  const invisible = evaluate("confirm", {
    driverLog: driverLogFor("confirm", {
      restore: {
        ...driverLogFor("confirm").restore,
        decision_text_visible: false,
        // sample 也不含决定/取消文案：旧 driver 正则遗漏时只靠字段不能通过，必须无证据 → fail。
        visible_text_sample: "普通消息列表，没有决定文案。",
      },
    }),
  });
  assert.equal(invisible.checks.C10_restore_not_actionable.ok, false);
  const replay = evaluate("confirm", {
    driverLog: driverLogFor("confirm", {
      restore: { ...driverLogFor("confirm").restore, restart_delta: { provider_runs: 1, agent_runs: 0, receipts: 0, llm_calls: 0 } },
    }),
  });
  assert.equal(replay.checks.C10_restore_not_actionable.ok, false);
});

const ZERO_DELTA = Object.freeze({ provider_runs: 0, agent_runs: 0, receipts: 0, llm_calls: 0 });

function duplicateLogWithDelta(delta) {
  return driverLogFor("confirm", {
    duplicate: {
      attempted: false,
      clicked: false,
      actionable: false,
      reason: "not_actionable:action_missing",
      duplicate_ack: null,
      delta,
    },
  });
}

function restoreLogWithDelta(restartDelta) {
  return driverLogFor("confirm", {
    restore: { ...driverLogFor("confirm").restore, restart_delta: restartDelta },
  });
}

test("C5 硬门禁：duplicate delta 只接受四个完整数字 0；缺测/空对象/null/字符串/非零都 fail", () => {
  const passing = evaluate("confirm", { driverLog: duplicateLogWithDelta({ ...ZERO_DELTA }) });
  assert.equal(passing.checks.C5_duplicate_idempotent.ok, true);

  const failing = [
    ["空对象", {}],
    ["缺 llm_calls", { provider_runs: 0, agent_runs: 0, receipts: 0 }],
    ["delta 为 null", null],
    ["llm_calls 为 null", { ...ZERO_DELTA, llm_calls: null }],
    ["llm_calls 为字符串 0", { ...ZERO_DELTA, llm_calls: "0" }],
    ["llm_calls 非零", { ...ZERO_DELTA, llm_calls: 1 }],
  ];
  for (const [label, delta] of failing) {
    const result = evaluate("confirm", { driverLog: duplicateLogWithDelta(delta) });
    assert.equal(result.checks.C5_duplicate_idempotent.ok, false, label);
  }
});

test("C10 硬门禁：restart delta 只接受四个完整数字 0；缺测/空对象/null/字符串/非零都 fail", () => {
  const passing = evaluate("confirm", { driverLog: restoreLogWithDelta({ ...ZERO_DELTA }) });
  assert.equal(passing.checks.C10_restore_not_actionable.ok, true);

  const failing = [
    ["空对象", {}],
    ["缺 receipts", { provider_runs: 0, agent_runs: 0, llm_calls: 0 }],
    ["delta 为 null", null],
    ["provider_runs 为 null", { ...ZERO_DELTA, provider_runs: null }],
    ["provider_runs 为字符串 0", { ...ZERO_DELTA, provider_runs: "0" }],
    ["agent_runs 非零", { ...ZERO_DELTA, agent_runs: 1 }],
  ];
  for (const [label, delta] of failing) {
    const result = evaluate("confirm", { driverLog: restoreLogWithDelta(delta) });
    assert.equal(result.checks.C10_restore_not_actionable.ok, false, label);
  }
});

test("C6/C9 计数缺测或字符串不得按 0 假通过", () => {
  const missingSamplingCount = evaluate("reject", {
    driverLog: driverLogFor("reject", {
      sampling: {
        click_before: { provider_runs: 1, receipts: 0, mutations: 0 },
        decision_after: { provider_runs: 1, receipts: 1, mutations: 0 },
      },
    }),
  });
  assert.equal(missingSamplingCount.checks.C6_reject_zero_side_effect.ok, false);
  assert.equal(
    missingSamplingCount.checks.C6_reject_zero_side_effect.detail.scoped_delta.llm_calls,
    null,
    "缺测保持 null，不转换成 0/NaN",
  );

  const oneSidedSampling = { ...counts(1) };
  delete oneSidedSampling.llm_calls;
  const oneSidedMissing = evaluate("reject", {
    driverLog: driverLogFor("reject", {
      sampling: { click_before: counts(1), decision_after: oneSidedSampling },
    }),
  });
  assert.equal(oneSidedMissing.checks.C6_reject_zero_side_effect.ok, false);
  assert.equal(oneSidedMissing.checks.C6_reject_zero_side_effect.detail.scoped_delta.llm_calls, null);

  const stringSamplingCount = evaluate("reject", {
    driverLog: driverLogFor("reject", {
      sampling: {
        click_before: { ...counts(1), llm_calls: "1" },
        decision_after: { ...counts(1), llm_calls: "1" },
      },
    }),
  });
  assert.equal(stringSamplingCount.checks.C6_reject_zero_side_effect.ok, false);

  const stringWhyCount = evaluate("confirm", {
    driverLog: driverLogFor("confirm", {
      why: {
        ...driverLogFor("confirm").why,
        before: { llm_calls: "1" },
        after: { llm_calls: "1" },
      },
    }),
  });
  assert.equal(stringWhyCount.checks.C9_why_replay_zero_provider.ok, false);
});

test("C11 硬门禁：运行态停止必须独立实测；EPERM 只记 unverified 不能替代；llm-calls 增长 fail", () => {
  // 独立实测通过（测试环境无 app/端口、llm-calls 与 termination 一致）：EPERM 降级记录但不否决。
  const degraded = evaluate("confirm", {
    cleanup: { remaining: [], process_observation: { method: "pgrep+lsof", fallback_reason: "EPERM" } },
  });
  assert.equal(degraded.checks.C11_cleanup.ok, true);
  assert.equal(degraded.checks.C11_cleanup.detail.cleanup_observation_degraded, true);
  // 运行态未停止（llm-calls 数量与 driver 终止观测不一致）→ fail。
  const growing = evaluate("confirm", { llmCalls: 2 });
  assert.equal(growing.checks.C11_cleanup.ok, false);
  assert.equal(growing.checks.C11_cleanup.detail.runtime_stopped, false);
  // cleanup remaining 非空 → fail。
  const lingering = evaluate("confirm", { cleanup: { remaining: [{ pid: 1 }], process_observation: {} } });
  assert.equal(lingering.checks.C11_cleanup.ok, false);
  // driver termination 快照显示 app 运行中（driver 结束时的预期观测）不影响判定：
  // C11 以 cleanup 之后实测为准（测试环境静止 + cleanup remaining=[] → pass）。
  const driverSnapshotRunning = evaluate("confirm", {
    driverLog: driverLogFor("confirm", {
      termination: { llm_calls: 1, app_processes: 1, ports: { backend_4657: true, transport_4661: true } },
    }),
  });
  assert.equal(driverSnapshotRunning.checks.C11_cleanup.ok, true);
  assert.equal(driverSnapshotRunning.checks.C11_cleanup.detail.driver_termination_snapshot.app_processes, 1);
});

test("evaluateConfirmation 纯计算：只消费显式 runtime，不读取 dir、不伪造缺失运行态", () => {
  const input = confirmationInput("confirm");
  const explicitRuntime = evaluateConfirmation({
    ...input,
    runtime: runtimeObservation(1),
    dir: "/nonexistent/b71-confirmation-runtime-does-not-exist",
  });
  assert.equal(explicitRuntime.checks.C11_cleanup.ok, true);
  assert.deepEqual(explicitRuntime.measured.runtime_after_batch, runtimeObservation(1));

  const stringLlmCalls = evaluateConfirmation({
    ...input,
    runtime: { ...runtimeObservation(1), llm_calls: "1" },
  });
  assert.equal(stringLlmCalls.checks.C11_cleanup.ok, false);
});

test("反例：拒绝路径出现 Provider 调用/canon 变化/非 CANCELLED receipt fail", () => {
  const provider = evaluate("reject", {
    driverLog: driverLogFor("reject", {
      sampling: { click_before: counts(1), decision_after: { ...counts(1), provider_runs: 2 } },
    }),
  });
  assert.equal(provider.checks.C6_reject_zero_side_effect.ok, false);
  const canon = evaluate("reject", { finalHash: "canon-changed" });
  assert.equal(canon.checks.C6_reject_zero_side_effect.ok, false);
  const facts = dbFactsFor("reject");
  facts.receipts[0].result = { ...facts.receipts[0].result, decision: "CONFIRMED" };
  assert.equal(evaluate("reject", { dbFacts: facts }).checks.C6_reject_zero_side_effect.ok, false);
  // scoped mutations 增长（点击前→决定后）→ fail
  const mutated = evaluate("reject", {
    driverLog: driverLogFor("reject", {
      sampling: { click_before: counts(1), decision_after: { ...counts(1), mutations: 1 } },
    }),
  });
  assert.equal(mutated.checks.C6_reject_zero_side_effect.ok, false);
});

test("反例：C2 ACK 身份/trigger 与 sent source_turn_ref 不符 fail", () => {
  const wire = wireFor("confirm").frames.map((record) => {
    if (record.frame?.[3] !== "phx_reply") return record;
    const body = record.frame[4];
    return { ...record, frame: [record.frame[0], record.frame[1], TOPIC, "phx_reply", { ...body, response: { ...body.response, trigger: { ...body.response.trigger, action_id: "other" } } }] };
  });
  assert.equal(evaluate("confirm", { wire }).checks.C2_confirmation_accepted.ok, false);
  const noSource = wireFor("confirm").frames.map((record) => {
    if (record.frame?.[3] !== "author_action") return record;
    const action = { ...record.frame[4].action };
    delete action.source_turn_ref;
    return { ...record, frame: [record.frame[0], record.frame[1], TOPIC, "author_action", { action }] };
  });
  assert.equal(evaluate("confirm", { wire: noSource }).checks.C2_confirmation_accepted.ok, false);
});

test("反例：重复 receipt 破坏幂等（C5 fail）", () => {
  const facts = dbFactsFor("confirm");
  facts.receipts.push({ ...facts.receipts[0], id: "receipt-2" });
  assert.equal(evaluate("confirm", { dbFacts: facts }).checks.C5_duplicate_idempotent.ok, false);
});

test("反例：确认后无真实子执行且无 blocked/failed 证据（C7 fail）", () => {
  const wire = wireFor("confirm").frames.filter((record) => record.frame?.[4]?.turn_id !== "turn_exec");
  assert.equal(evaluate("confirm", { wire }).checks.C7_confirmed_child_execution.ok, false);
});

test("无 needs_confirmation 帧时如实报不可触发（不合成）", () => {
  assert.throws(() => evaluateConfirmation({
    mode: "confirm",
    wire: [],
    dbFacts: dbFactsFor("confirm"),
    checkpoints: { start: canonSnapshot(), final: canonSnapshot() },
    driverLog: driverLogFor("confirm"),
    cleanup: { remaining: [], process_observation: {} },
    llmRecords: [],
    runtime: runtimeObservation(),
  }), /needs_confirmation/u);
});

test("selectConfirmationAction：真实确认动作（无 source_turn_ref）可用；唯一/启用校验保留", () => {
  const realShape = [
    {
      action_id: "act_confirm_decision_placeholder",
      action_type: "confirm_before_execute",
      target_ref: "prose_writing",
      idempotency_key: "confirm_decision_placeholder",
      behavior_ref: "bh_placeholder",
      expires_at: "2026-11-03T15:30:41.440507Z",
    },
    {
      action_id: "act_reject_decision_placeholder",
      action_type: "reject_or_cancel_confirmation",
      target_ref: "prose_writing",
      idempotency_key: "reject_decision_placeholder",
      behavior_ref: "bh_placeholder",
    },
  ];
  const body = needsBody({ available_actions: realShape });
  assert.equal(selectConfirmationAction(body, "confirm_before_execute").action_id, "act_confirm_decision_placeholder");
  assert.throws(() => selectConfirmationAction(needsBody(), "accept"), /必须唯一/u);
  assert.throws(
    () => selectConfirmationAction(needsBody({ available_actions: confirmActions().map((entry) => ({ ...entry, enabled: false })) }), "confirm_before_execute"),
    /enabled=false/u,
  );
});

test("locateConfirmationButton：按所属消息块定位；禁用/缺文案失败", () => {
  const node = (nodePath, role, fields = {}) => ({ path: nodePath, role, frame: [10, 10, 200, 20], ...fields });
  const text = (nodePath, value) => node(nodePath, "AXStaticText", { value });
  const cardTitle = "需要确认";
  const cardBody = "确认对象：正文草稿生成";
  const nodes = [
    node("0/1", "AXGroup"),
    text("0/1/0", "AI"),
    text("0/1/1", cardTitle),
    text("0/1/2", cardBody),
    node("0/1/3", "AXButton", { title: "确认执行", enabled: true }),
    node("0/1/4", "AXButton", { title: "拒绝", enabled: true }),
    node("0/2", "AXGroup"),
    text("0/2/0", "旧候选正文草稿"),
    node("0/2/1", "AXButton", { title: "保存到作品档案", enabled: true }),
  ];
  const knownItems = [cardTitle, cardBody];
  assert.equal(locateConfirmationButton(nodes, { label: "确认执行", cardTitle, cardBody, knownItems }).button.path, "0/1/3");
  assert.equal(locateConfirmationButton(nodes, { label: "拒绝", cardTitle, cardBody, knownItems }).button.path, "0/1/4");
  const disabled = locateConfirmationButton(
    nodes.map((entry) => (entry.path === "0/1/3" ? { ...entry, enabled: false } : entry)),
    { label: "确认执行", cardTitle, cardBody, knownItems },
  );
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, "action_disabled");
  assert.equal(locateConfirmationButton(nodes, { label: "确认执行", cardTitle: null, cardBody }).reason, "card_evidence_missing");
});

test("executedConfirmationTurnResult / rejectConfirmationTurnResult：时间窗与身份口径", () => {
  const executed = received(
    "turn_result",
    { turn_id: "turn_exec", tool_result: { tool_name: "prose_writing", status: "succeeded" } },
    "2026-11-03T15:20:35.009Z",
  );
  const wire = [received("turn_result", needsBody()), executed];
  assert.equal(executedConfirmationTurnResult(wire, "2026-11-03T15:20:34.800Z")?.frame?.[4]?.turn_id, "turn_exec");
  assert.equal(executedConfirmationTurnResult(wire, "2026-11-03T15:20:36.000Z"), null);
  const cancel = received(
    "turn_result",
    { turn_id: "turn_cancel", parent_turn_id: SOURCE_TURN, assistant_message: { text: "已取消采纳；未覆盖正文。" } },
    "2026-11-03T15:20:40.000Z",
  );
  assert.equal(rejectConfirmationTurnResult([cancel], "2026-11-03T15:20:39.000Z", { sourceTurnId: SOURCE_TURN, userTurnId: USER_TURN })?.frame?.[4]?.turn_id, "turn_cancel");
});


test("confirmationCardLines：标题/三类正文语义与缺失边界", () => {
  assert.deepEqual(confirmationCardLines("  需要确认  \n 确认对象：正文草稿 "), {
    title: "需要确认",
    body: "确认对象：正文草稿",
  });
  assert.deepEqual(confirmationCardLines("需要确认\n确认前不会调用工具"), {
    title: "需要确认",
    body: "确认前不会调用工具",
  });
  assert.deepEqual(confirmationCardLines("需要确认\n确认后系统会重新检查当前作品状态"), {
    title: "需要确认",
    body: "确认后系统会重新检查当前作品状态",
  });
  assert.equal(confirmationCardLines("需要确认\n其它文案"), null);
  assert.equal(confirmationCardLines("确认对象：正文草稿"), null);
});

test("C7 tool_failed：真实失败 tool_result + trace + truthfulness 才成立", () => {
  const input = confirmationInput("confirm");
  const executed = received("turn_result", {
    turn_id: "turn_exec",
    parent_turn_id: SOURCE_TURN,
    status: "conversational",
    tool_result: { tool_name: "prose_writing", status: "failed" },
    truthfulness: { tool_called: true, tool_status: "failed" },
  });
  const wire = [
    ...withoutChildAgentEvents(input.wire).filter((record) => record.frame?.[4]?.turn_id !== "turn_exec"),
    executed,
    ...childWireEvents().map(childAgentEventFrame),
  ];
  const result = evaluateConfirmation({ ...input, wire });
  assert.equal(result.checks.C7_confirmed_child_execution.ok, true);
  assert.equal(result.checks.C7_confirmed_child_execution.detail.branch, "tool_failed");
  assert.equal(result.model_behavior.tool_failed, true);
  assert.equal(result.model_behavior.gate_blocked, false);
});

test("C1/C2 硬门禁：source 未持久/未关联、ACK 缺失均不得 PASS", () => {
  const missingSource = evaluate("confirm", { dbFacts: dbFactsFor("confirm", { interactions: [] }) });
  assert.equal(missingSource.checks.C1_source_persisted.ok, false);
  assert.equal(missingSource.checks.C1_source_persisted.reason, "source_persisted_turn_missing_or_unlinked");

  const unlinked = evaluate("confirm", {
    driverLog: driverLogFor("confirm", {
      source: { turn_id: SOURCE_TURN, user_turn_id: "", click_at: "2026-11-03T10:00:09.000Z" },
    }),
  });
  assert.equal(unlinked.checks.C1_source_persisted.ok, false);

  const withoutAck = evaluate("confirm", {
    wire: wireFor("confirm").frames.filter((record) => record.frame?.[3] !== "phx_reply"),
  });
  assert.equal(withoutAck.checks.C2_confirmation_accepted.ok, false);
  assert.equal(withoutAck.checks.C2_confirmation_accepted.reason, "confirmation_ack_or_result_identity_mismatch");
});

test("C1 正例：wire agent_run 摘要与持久 Interaction source 同源 → pass", () => {
  const result = evaluate("confirm");
  assert.equal(result.checks.C1_source_persisted.ok, true);
  assert.equal(result.checks.C1_source_persisted.detail.source_run_id, SOURCE_RUN);
  assert.deepEqual(result.failed, []);
});

test("C1 正例：无可选 wire summary 时仍以持久 Interaction source 绑定通过", () => {
  const result = evaluate("confirm", { wire: wireWithNeedsBody(needsBodyWithoutAgentRun()) });
  assert.equal(result.checks.C1_source_persisted.ok, true);
  assert.equal(result.checks.C1_source_persisted.detail.source_run_id, SOURCE_RUN);
  assert.deepEqual(result.failed, []);
});

test("C1 红：wire agent_run 摘要错绑持久 Interaction source → fail", () => {
  const wire = wireWithNeedsBody(
    needsBody({ agent_run: { run_id: "run-wrong-summary", status: "awaiting_author" } }),
  );
  const result = evaluate("confirm", { wire });
  assert.equal(result.checks.C1_source_persisted.ok, false);
  assert.equal(result.checks.C1_source_persisted.reason, "source_persisted_turn_missing_or_unlinked");
  assert(result.failed.includes("C1_source_persisted"));
});

test("C1 红：持久 Interaction 缺 source id 时 wire 摘要不能补造 → fail", () => {
  const result = evaluate("confirm", { dbFacts: dbWithoutSourceAgentRunId() });
  assert.equal(result.checks.C1_source_persisted.ok, false);
  assert.equal(result.checks.C1_source_persisted.reason, "source_persisted_turn_missing_or_unlinked");
  assert.equal(result.checks.C1_source_persisted.detail.source_run_id, "");
  assert(result.failed.includes("C1_source_persisted"));
});

test("C1 红：显式空 wire summary 不回退到持久 source → fail", () => {
  const wire = wireWithNeedsBody(needsBody({ agent_run: { run_id: "", status: "awaiting_author" } }));
  const result = evaluate("confirm", { wire });
  assert.equal(result.checks.C1_source_persisted.ok, false);
  assert.equal(result.checks.C1_source_persisted.reason, "source_persisted_turn_missing_or_unlinked");
  assert(result.failed.includes("C1_source_persisted"));
});

test("sourceOwnership：wire summary 仅作可选事实，缺失为 null、显式空串保持空串", () => {
  const missing = assembleConfirmationFacts(
    confirmationInput("confirm", { wire: wireWithNeedsBody(needsBodyWithoutAgentRun()) }),
  );
  assert.equal(missing.sourceRunId, SOURCE_RUN);
  assert.equal(missing.sourceWireRunId, null);

  const empty = assembleConfirmationFacts(
    confirmationInput("confirm", {
      wire: wireWithNeedsBody(needsBody({ agent_run: { run_id: "", status: "awaiting_author" } })),
    }),
  );
  assert.equal(empty.sourceRunId, SOURCE_RUN);
  assert.equal(empty.sourceWireRunId, "");
});

test("executedConfirmationTurnResult：无 click_at 时按 source turn 前缀定位真实执行帧", () => {
  const input = confirmationInput("confirm");
  const executed = received("turn_result", {
    turn_id: `${SOURCE_TURN}:exec`,
    parent_turn_id: SOURCE_TURN,
    status: "conversational",
    tool_result: { tool_name: "prose_writing", status: "succeeded" },
    truthfulness: { tool_called: true },
  });
  const wire = [
    ...withoutChildAgentEvents(input.wire).filter((record) => record.frame?.[4]?.turn_id !== "turn_exec"),
    executed,
    ...childWireEvents().map(childAgentEventFrame),
  ];
  const result = evaluateConfirmation({
    ...input,
    wire,
    driverLog: driverLogFor("confirm", {
      source: { turn_id: SOURCE_TURN, user_turn_id: USER_TURN, click_at: "" },
    }),
  });
  assert.equal(result.checks.C7_confirmed_child_execution.detail.branch, "executed");
  assert.equal(result.checks.C7_confirmed_child_execution.detail.executed_turn_id, `${SOURCE_TURN}:exec`);
});

test("C8 红：application-data 冒充作者/字节改写/按钮文案/重复作者消息", () => {
  const records = (messages) => [{
    provider: "slice_verify",
    request_format: "authoring-request-ir/v1",
    request_body: irBodyFromWire({ messages }),
  }];
  const appOnly = evaluate("confirm", {
    llmRecords: records([{ role: "user", content: "【应用数据 · application_base】材料" }]),
  });
  assert.equal(appOnly.checks.C8_author_bytes.ok, false);
  assert.equal(appOnly.checks.C8_author_bytes.detail.author_messages_per_record[0], 0);

  const altered = evaluate("confirm", {
    llmRecords: records([{ role: "user", content: "作者原话被改写" }]),
  });
  assert.equal(altered.checks.C8_author_bytes.ok, false);
  assert.equal(altered.checks.C8_author_bytes.detail.exact_matches_per_record[0], 0);

  const button = evaluate("confirm", {
    llmRecords: records([{ role: "user", content: "确认执行" }]),
  });
  assert.equal(button.checks.C8_author_bytes.ok, false);
  assert.equal(button.checks.C8_author_bytes.detail.button_text_leaked_as_author, true);

  const duplicated = evaluate("confirm", {
    llmRecords: records([
      { role: "user", content: CONFIRMATION_REQUEST },
      { role: "user", content: CONFIRMATION_REQUEST },
    ]),
  });
  assert.equal(duplicated.checks.C8_author_bytes.ok, false);
  assert.equal(duplicated.checks.C8_author_bytes.detail.author_messages_per_record[0], 2);
});

test("C2 红：ACK 状态/计数/receipt/turn/trigger 任一不符都失败", () => {
  const base = wireFor("confirm").frames;
  const mutateAck = (change) =>
    base.map((record) =>
      record.frame?.[3] === "phx_reply"
        ? { ...record, frame: [...record.frame.slice(0, 4), change(record.frame[4])] }
        : record,
    );
  const variants = [
    mutateAck((body) => ({ ...body, response: { ...body.response, received: false } })),
    mutateAck((body) => ({ ...body, response: { ...body.response, action_status: "" } })),
    mutateAck((body) => ({ ...body, status: "error" })),
    mutateAck((body) => ({ ...body, response: { ...body.response, receipt_id: "other" } })),
    mutateAck((body) => ({
      ...body,
      response: { ...body.response, trigger: { ...body.response.trigger, behavior_ref: "other" } },
    })),
    mutateAck((body) => ({
      ...body,
      response: { ...body.response, trigger: { ...body.response.trigger, receipt_id: "other" } },
    })),
    mutateAck((body) => ({ ...body, response: { ...body.response, turn_results: [] } })),
    [...base, base.find((record) => record.frame?.[3] === "phx_reply")],
  ];
  for (const wire of variants) {
    assert.equal(evaluate("confirm", { wire }).checks.C2_confirmation_accepted.ok, false);
  }
});

test("C6 采样窗 receipts 允许受理本身 delta=1，拒绝额外增长或缺 receipt", () => {
  const allowed = evaluate("reject", {
    driverLog: driverLogFor("reject", {
      sampling: {
        click_before: { ...counts(1), receipts: 0 },
        decision_after: { ...counts(1), receipts: 1 },
      },
    }),
  });
  assert.equal(allowed.checks.C6_reject_zero_side_effect.ok, true);
  assert.equal(allowed.checks.C6_reject_zero_side_effect.detail.scoped_delta.receipts, 1);

  const extra = evaluate("reject", {
    driverLog: driverLogFor("reject", {
      sampling: {
        click_before: { ...counts(1), receipts: 0 },
        decision_after: { ...counts(1), receipts: 2 },
      },
    }),
  });
  assert.equal(extra.checks.C6_reject_zero_side_effect.ok, false);

  const missingReceipt = evaluate("reject", { dbFacts: dbFactsFor("reject", { receipts: [] }) });
  assert.equal(missingReceipt.checks.C6_reject_zero_side_effect.ok, false);
});

test("C6 红：canon 快照缺 authoring_canon.tables 时如实失败", () => {
  const input = confirmationInput("reject");
  const result = evaluateConfirmation({ ...input, checkpoints: { start: {}, final: {} } });
  assert.equal(result.checks.C6_reject_zero_side_effect.ok, false);
  assert.equal(result.checks.C6_reject_zero_side_effect.detail.canon.all, false);
  assert.deepEqual(result.checks.C6_reject_zero_side_effect.detail.canon.changed_all, []);
});

test("C12 红：有启动/工具但无终局 → fail，detail 仍标记 pre_terminal", () => {
  const events = childWireEvents().filter((entry) => entry.body.event_type !== "run_completed");
  const wire = [...withoutChildAgentEvents(wireFor("confirm").frames), ...events.map(childAgentEventFrame)];
  const c12 = evaluate("confirm", { wire }).checks.C12_child_live_startup_events;
  assert.equal(c12.ok, false);
  assert.equal(c12.reason, "child_terminal_event_missing");
  assert(c12.detail.events.every((entry) => entry.pre_terminal === true));
});

test("C7 tool_failed 缺 trace 时不成立（失败证据必须闭合）", () => {
  const input = confirmationInput("confirm");
  const executed = received("turn_result", {
    turn_id: "turn_exec",
    parent_turn_id: SOURCE_TURN,
    status: "conversational",
    tool_result: { tool_name: "prose_writing", status: "failed" },
    truthfulness: { tool_called: true, tool_status: "failed" },
  });
  const wire = [
    ...withoutChildAgentEvents(input.wire).filter((record) => record.frame?.[4]?.turn_id !== "turn_exec"),
    executed,
    ...childWireEvents().map(childAgentEventFrame),
  ];
  const result = evaluateConfirmation({ ...input, wire, dbFacts: dbFactsFor("confirm", { decision_traces: [] }) });
  assert.equal(result.checks.C7_confirmed_child_execution.ok, false);
  assert.equal(result.checks.C7_confirmed_child_execution.detail.branch, "none");
});

test("rejectConfirmationTurnResult：user turn 父绑定/正文取消语义均可定位；无关系不借用", () => {
  const at = "2026-11-03T15:20:40.000Z";
  const userParent = received("turn_result", {
    turn_id: "turn_user",
    parent_turn_id: USER_TURN,
    assistant_message: { text: "继续" },
  }, at);
  assert.equal(
    rejectConfirmationTurnResult([userParent], "2026-11-03T15:20:39.000Z", {
      sourceTurnId: SOURCE_TURN,
      userTurnId: USER_TURN,
    })?.frame?.[4]?.turn_id,
    "turn_user",
  );
  const textOnly = received("turn_result", {
    turn_id: "turn_text",
    parent_turn_id: "other",
    assistant_message: { text: "拒绝执行" },
  }, at);
  assert.equal(
    rejectConfirmationTurnResult([textOnly], "2026-11-03T15:20:39.000Z", {
      sourceTurnId: SOURCE_TURN,
      userTurnId: USER_TURN,
    })?.frame?.[4]?.turn_id,
    "turn_text",
  );
  const unrelated = received("turn_result", {
    turn_id: "turn_other",
    parent_turn_id: "other",
    assistant_message: { text: "继续" },
  }, at);
  assert.equal(
    rejectConfirmationTurnResult([unrelated], "2026-11-03T15:20:39.000Z", {
      sourceTurnId: SOURCE_TURN,
      userTurnId: USER_TURN,
    }),
    null,
  );
});
