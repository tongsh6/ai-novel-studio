// B71 §16.14 confirmation 判据的测试场景夹具：只被 Node 正反例与只读差分对账消费。
// 这里的事实形状来自真实批次（received/agent_event、SQLite 行、driver log），测试只替换
// 单个字段来构造反例，不另造一套与真实 wire/DB 不同的“完美输入”。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIRMATION_REQUEST } from "../authoring_confirmation_constants.mjs";
import { irBodyFromWire } from "./authoring_request_ir.mjs";

export const JOIN_REF = "5";
export const REF = "9";
export const TOPIC = "workspace:test";
export const SOURCE_TURN = "message_test:agent:5";
export const USER_TURN = "message_test";
export const SOURCE_RUN = "run-src";
export const CHILD_RUN = "run-child";
export const RECEIPT_ID = "receipt-1";
export const CLICK_AT = "2026-11-03T10:00:09.000Z";
export const OTHER_RUN = "run-other";
export const CHILD_STARTED_EVENT = "evt-child-run-started";
export const CHILD_TOOL_STARTED_EVENT = "evt-child-tool-started";
export const CHILD_COMPLETED_EVENT = "evt-child-run-completed";
export const CHILD_STARTED_AT = "2026-11-03T10:00:09.100Z";
export const CHILD_TOOL_STARTED_AT = "2026-11-03T10:00:09.200Z";
export const CHILD_COMPLETED_AT = "2026-11-03T10:00:09.900Z";

export const received = (event, body, at = "2026-11-03T10:00:10.000Z") => ({
  at,
  direction: "received",
  frame: [JOIN_REF, REF, TOPIC, event, body],
});
export const sentFrame = (event, body, at = CLICK_AT) => ({
  at,
  direction: "sent",
  frame: [JOIN_REF, REF, TOPIC, event, body],
});

export function confirmActions() {
  return [
    {
      action_id: "act_confirm_decision_1",
      action_type: "confirm_before_execute",
      target_ref: "prose_writing",
      behavior_ref: "bh_1",
      idempotency_key: "confirm_decision_1",
      source_turn_ref: SOURCE_TURN,
    },
    {
      action_id: "act_reject_decision_1",
      action_type: "reject_or_cancel_confirmation",
      target_ref: "prose_writing",
      behavior_ref: "bh_1",
      idempotency_key: "reject_decision_1",
      source_turn_ref: SOURCE_TURN,
    },
  ];
}

export function needsBody(overrides = {}) {
  return {
    turn_id: SOURCE_TURN,
    status: "needs_confirmation",
    agent_run: { run_id: SOURCE_RUN, status: "awaiting_author" },
    available_actions: confirmActions(),
    behavior_state: { active: { behavior_id: "bh_1", lifecycle_status: "awaiting_author" } },
    truthfulness: { tool_called: false, production_write_performed: false },
    plan: { steps: [] },
    ...overrides,
  };
}

// C12 child run 的 DB 事实：JSON 列按真实 SQLite 文本形态给出，payload 含私有字段。
export function childDbEvents() {
  return [
    {
      id: CHILD_STARTED_EVENT,
      run_id: CHILD_RUN,
      sequence: 1,
      event_type: "run_started",
      summary: "AgentRun 已启动。",
      reason_codes: JSON.stringify(["agent_run_started", "profile_selected"]),
      refs: JSON.stringify([]),
      payload: JSON.stringify({ profile_ref: "tool_confirmation_v1", turn_result: { private: true } }),
    },
    {
      id: CHILD_TOOL_STARTED_EVENT,
      run_id: CHILD_RUN,
      sequence: 2,
      event_type: "tool_started",
      summary: "已确认动作通过重新裁决，开始执行。",
      reason_codes: JSON.stringify(["author_confirmed_action_allowed"]),
      refs: JSON.stringify(["plan-child", "decision-child"]),
      payload: JSON.stringify({
        stage: "author_action_execution_started",
        tool_name: "prose_writing",
        checkpoint_data: { private: true },
      }),
    },
    {
      id: CHILD_COMPLETED_EVENT,
      run_id: CHILD_RUN,
      sequence: 19,
      event_type: "run_completed",
      summary: "AgentRun 已完成。",
      reason_codes: JSON.stringify(["goal_satisfied", "agent_loop_completed"]),
      refs: JSON.stringify(["and_child_tool_confirmation_done"]),
      payload: JSON.stringify({}),
    },
  ];
}

// C12 child run 的真实 WS 推送（received/agent_event）；payload 只给作者安全投影。
export function childWireEvents() {
  return [
    {
      at: CHILD_STARTED_AT,
      body: {
        event_id: CHILD_STARTED_EVENT,
        run_ref: CHILD_RUN,
        run_id: CHILD_RUN,
        sequence: 1,
        event_type: "run_started",
        visibility: "author",
        summary: "AgentRun 已启动。",
        reason_codes: ["agent_run_started", "profile_selected"],
        refs: [],
        payload: {},
      },
    },
    {
      at: CHILD_TOOL_STARTED_AT,
      body: {
        event_id: CHILD_TOOL_STARTED_EVENT,
        run_ref: CHILD_RUN,
        run_id: CHILD_RUN,
        sequence: 2,
        event_type: "tool_started",
        visibility: "author",
        summary: "已确认动作通过重新裁决，开始执行。",
        reason_codes: ["author_confirmed_action_allowed"],
        refs: ["plan-child", "decision-child"],
        payload: { stage: "author_action_execution_started", tool_name: "prose_writing" },
      },
    },
    {
      at: CHILD_COMPLETED_AT,
      body: {
        event_id: CHILD_COMPLETED_EVENT,
        run_ref: CHILD_RUN,
        run_id: CHILD_RUN,
        sequence: 19,
        event_type: "run_completed",
        visibility: "author",
        summary: "AgentRun 已完成。",
        reason_codes: ["goal_satisfied", "agent_loop_completed"],
        refs: ["and_child_tool_confirmation_done"],
        payload: {},
      },
    },
  ];
}

export const childAgentEventFrame = (entry) => received("agent_event", entry.body, entry.at);
export const withoutChildAgentEvents = (frames) => frames.filter((record) => record.frame?.[3] !== "agent_event");

export function canonSnapshot(hash = "canon-1") {
  return {
    authoring_canon: {
      version: 2,
      chapters: { "chapter-row": { approved_sha256: "a", design_state_sha256: "d" } },
      tables: {
        works: { row_count: 1, rows_sha256: "w", canon_sha256: "w" },
        chapters: { row_count: 1, rows_sha256: "c", canon_sha256: hash },
        author_action_receipts: { row_count: 1, rows_sha256: "r", canon_sha256: "r" },
        memory_items: { row_count: 0, rows_sha256: "m", canon_sha256: "m" },
      },
    },
  };
}

export function dbFactsFor(mode, overrides = {}) {
  const action = confirmActions().find(
    (entry) => entry.action_type === (mode === "confirm" ? "confirm_before_execute" : "reject_or_cancel_confirmation"),
  );
  const decision = mode === "confirm" ? "CONFIRMED" : "CANCELLED";
  const closureStatus = mode === "confirm" ? "resolved" : "cancelled";
  return {
    receipts: [
      {
        id: RECEIPT_ID,
        source_turn_ref: SOURCE_TURN,
        action_id: action.action_id,
        action_type: action.action_type,
        idempotency_key: action.idempotency_key,
        behavior_ref: action.behavior_ref,
        status: "accepted",
        result: {
          action_id: action.action_id,
          action_type: action.action_type,
          approval_policy_ref: "approval_policy.long_run_budget_gate",
          author_turn_ref: USER_TURN,
          behavior_ref: action.behavior_ref,
          decided_by: "author",
          decision,
          idempotency_key: action.idempotency_key,
          profile_ref: "tool_confirmation_v1",
          receipt_id: RECEIPT_ID,
          risk_class: "HIGH",
          run_id: CHILD_RUN,
          run_mode: "bounded",
          source_run_id: SOURCE_RUN,
          source_turn_ref: SOURCE_TURN,
          turn_id: "turn_dec",
        },
      },
    ],
    agent_runs: [
      {
        id: SOURCE_RUN,
        profile_ref: "prose_drafting_with_quality_v1",
        run_mode: "bounded",
        status: "completed",
        active_behavior_ref: null,
        trigger: { handoff: { receipt_id: RECEIPT_ID, successor_run_id: CHILD_RUN }, handoff_reason: "author_action_handoff" },
      },
      {
        id: CHILD_RUN,
        profile_ref: "tool_confirmation_v1",
        run_mode: "bounded",
        status: mode === "confirm" ? "completed" : "cancelled",
        parent_turn_ref: SOURCE_TURN,
        active_behavior_ref: null,
        trigger: {
          action_id: action.action_id,
          action_type: action.action_type,
          author_turn_ref: USER_TURN,
          behavior_ref: action.behavior_ref,
          kind: "author_action",
          receipt_id: RECEIPT_ID,
          source_run_id: SOURCE_RUN,
        },
      },
    ],
    interactions: [
      { role: "user", turn_id: USER_TURN, content: { text: CONFIRMATION_REQUEST, agent_run_id: SOURCE_RUN } },
      {
        role: "assistant",
        turn_id: SOURCE_TURN,
        content: {
          agent_run_id: SOURCE_RUN,
          turn_result: {
            status: "needs_confirmation",
            behavior_state: {
              active: { behavior_id: "bh_1", lifecycle_status: "awaiting_author" },
              history: [],
            },
            trace_summary: {},
          },
        },
      },
      {
        role: "assistant",
        turn_id: `${SOURCE_TURN}:author_action:${RECEIPT_ID}`,
        content: {
          agent_run_id: CHILD_RUN,
          turn_result: { behavior_state: { active: null, history: [{ behavior_id: "bh_1", lifecycle_status: closureStatus }] } },
        },
      },
    ],
    provider_runs: [{ agent_run_id: CHILD_RUN, purpose: "tool" }],
    agent_events: mode === "confirm" ? childDbEvents() : [],
    decision_traces: [
      {
        turn_id: "turn_dec",
        decision_type: mode === "confirm" ? "author_confirmed_action" : "cancel_waiting",
        trace_id: "trace-1",
      },
    ],
    mutations_count: 0,
    memory_count: 0,
    receipts_count: 1,
    provider_runs_count: 1,
    agent_runs_count: 2,
    ...overrides,
  };
}

export function counts(llmCalls = 1) {
  return { provider_runs: 1, receipts: 1, agent_runs: 2, mutations: 0, llm_calls: llmCalls };
}

export function driverLogFor(mode, overrides = {}) {
  const base = {
    source: { turn_id: SOURCE_TURN, user_turn_id: USER_TURN, click_at: CLICK_AT },
    why: {
      opened: true,
      attempts: [{ strategy: "visible_probe", ok: true }],
      before: counts(1),
      after: counts(1),
      llm_calls_delta: 0,
      provider_delta: 0,
    },
    duplicate: {
      attempted: false,
      clicked: false,
      actionable: false,
      reason: "not_actionable:action_missing",
      before: counts(1),
      after: counts(1),
      duplicate_ack: null,
      delta: { provider_runs: 0, agent_runs: 0, receipts: 0, llm_calls: 0 },
    },
    restore: {
      resumed: true,
      confirmation_actionable: false,
      actionable_buttons: 0,
      decision_text_visible: true,
      creative_result_visible: true,
      source_card_closed: true,
      before: counts(1),
      after: counts(1),
      restart_delta: { provider_runs: 0, agent_runs: 0, receipts: 0, llm_calls: 0 },
      visible_text_sample: "已确认「prose_writing」操作…待确认正文片段",
    },
    sampling: { click_before: counts(1), decision_after: counts(1) },
    termination: { llm_calls: 1, app_processes: 1, ports: { backend_4657: true, transport_4661: true } },
  };
  return { ...base, ...overrides };
}

export function wireFor(mode, overrides = {}) {
  const action = confirmActions().find(
    (entry) => entry.action_type === (mode === "confirm" ? "confirm_before_execute" : "reject_or_cancel_confirmation"),
  );
  const closureStatus = mode === "confirm" ? "resolved" : "cancelled";
  const ack = received("phx_reply", {
    status: "ok",
    response: {
      received: true,
      action_status: "accepted",
      trigger: {
        action_id: action.action_id,
        action_type: action.action_type,
        receipt_id: RECEIPT_ID,
        behavior_ref: "bh_1",
      },
      receipt_id: RECEIPT_ID,
      turn_results: [{ turn_id: "turn_dec" }],
    },
  });
  const frames = [
    received("turn_result", needsBody()),
    sentFrame("author_action", { action: { ...action, source_turn_ref: SOURCE_TURN } }),
    ack,
    received("turn_result", {
      turn_id: "turn_dec",
      parent_turn_id: SOURCE_TURN,
      status: mode === "confirm" ? "completed" : "cancelled",
      behavior_state: { lifecycle_status: closureStatus },
      truthfulness: mode === "reject" ? { execution_blocked: false } : {},
    }),
  ];
  if (mode === "confirm") {
    frames.push(
      received("turn_result", {
        turn_id: "turn_exec",
        parent_turn_id: SOURCE_TURN,
        status: "conversational",
        tool_result: { tool_name: "prose_writing", status: "succeeded" },
        adoption_state: { pending: [{ artifact_type: "prose_fragment", adoption_status: "TENTATIVE" }] },
        truthfulness: { tool_called: true, artifact_adopted: false, first_blocking_gate: null },
      }),
    );
  } else {
    frames.push(
      received("turn_result", {
        turn_id: "turn_cancel",
        parent_turn_id: SOURCE_TURN,
        assistant_message: { text: "已取消采纳；未覆盖正文，草稿仍保留为待采纳。" },
        truthfulness: { tool_called: false, production_write_performed: false },
      }),
    );
  }
  if (mode === "confirm") frames.push(...childWireEvents().map(childAgentEventFrame));
  return { frames, action, ...overrides };
}

export function testDir(llmCalls = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-confirmation-unit-"));
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });
  fs.writeFileSync(path.join(dir, "llm-calls", "2026-11-03.jsonl"), `${JSON.stringify({ provider: "slice_verify" })}\n`.repeat(llmCalls));
  return dir;
}

// 纯 evaluator 的显式运行态事实：批次后无 app/端口、llm-calls 与 termination 一致。
export function runtimeObservation(llmCalls = 1) {
  return {
    app_processes: 0,
    ports: { backend_4657: false, transport_4661: false },
    llm_calls: llmCalls,
  };
}

// 与 evaluateConfirmation 的输入契约逐字段一致；比较器只替换单一事实造成反例。
export function confirmationInput(mode, overrides = {}) {
  const wire = wireFor(mode);
  return {
    mode,
    wire: overrides.wire ?? wire.frames,
    dbFacts: overrides.dbFacts ?? dbFactsFor(mode),
    checkpoints: {
      start: canonSnapshot(),
      final: canonSnapshot(overrides.finalHash ?? "canon-1"),
    },
    driverLog: overrides.driverLog ?? driverLogFor(mode),
    cleanup: overrides.cleanup ?? { remaining: [], process_observation: { method: "pgrep+lsof", actions: [] } },
    llmRecords: overrides.llmRecords ?? [
      {
        provider: "slice_verify",
        request_format: "authoring-request-ir/v1",
        request_body: irBodyFromWire({
          messages: [
            { role: "system", content: "system" },
            { role: "user", content: "【应用数据 · application_base · 非作者原话】材料" },
            { role: "user", content: CONFIRMATION_REQUEST },
          ],
        }),
      },
    ],
    runtime: overrides.runtime ?? runtimeObservation(overrides.llmCalls ?? 1),
  };
}
