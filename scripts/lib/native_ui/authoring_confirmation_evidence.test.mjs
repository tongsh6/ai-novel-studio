// B71 §16.14 确认/拒绝判据 C1–C11 与消息块按钮定位正反例（确定性合成证据）。
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIRMATION_REQUEST,
  confirmationCardLines,
  evaluateConfirmation,
  executedConfirmationTurnResult,
  locateConfirmationButton,
  rejectConfirmationTurnResult,
  selectConfirmationAction,
} from "./authoring_confirmation_evidence.mjs";

const JOIN_REF = "5";
const REF = "9";
const TOPIC = "workspace:test";
const SOURCE_TURN = "message_test:agent:5";
const USER_TURN = "message_test";
const SOURCE_RUN = "run-src";
const CHILD_RUN = "run-child";

const received = (event, body, at = "2026-11-03T10:00:10.000Z") => ({
  at,
  direction: "received",
  frame: [JOIN_REF, REF, TOPIC, event, body],
});
const sent = (event, body, at = "2026-11-03T10:00:09.000Z") => ({
  at,
  direction: "sent",
  frame: [JOIN_REF, REF, TOPIC, event, body],
});

function actionFrame(action) {
  return { direction: "sent", at: "2026-11-03T10:00:09.000Z", frame: [JOIN_REF, REF, TOPIC, "author_action", { action }] };
}

function ackFrame(action, extra = {}) {
  return received("phx_reply", {
    action_id: action.action_id,
    action_status: "accepted",
    idempotency_key: action.idempotency_key,
    ...extra,
  });
}

function canonSnapshot(hash = "canon-1") {
  return {
    authoring_canon: {
      version: 2,
      chapters: { "chapter-row": { approved_sha256: "a", design_state_sha256: "d" } },
      tables: {
        works: { row_count: 1, rows_sha256: "w", canon_sha256: "w" },
        chapters: { row_count: 1, rows_sha256: "c", canon_sha256: hash },
        author_action_receipts: { row_count: 0, rows_sha256: "r", canon_sha256: "r" },
        memory_items: { row_count: 0, rows_sha256: "m", canon_sha256: "m" },
      },
    },
  };
}

function confirmActions() {
  return [
    {
      action_id: "confirm:as_1",
      action_type: "confirm_before_execute",
      target_ref: "as_1",
      behavior_ref: "behavior:b1",
      idempotency_key: "idem:confirm:as_1",
      source_turn_ref: SOURCE_TURN,
      enabled: true,
    },
    {
      action_id: "reject:as_1",
      action_type: "reject_or_cancel_confirmation",
      target_ref: "as_1",
      behavior_ref: "behavior:b1",
      idempotency_key: "idem:reject:as_1",
      source_turn_ref: SOURCE_TURN,
      enabled: true,
    },
  ];
}

function needsBody(overrides = {}) {
  return {
    turn_id: SOURCE_TURN,
    status: "needs_confirmation",
    agent_run: { run_id: SOURCE_RUN, status: "awaiting_author" },
    available_actions: confirmActions(),
    behavior_state: { lifecycle_status: "awaiting_author", target_ref: "as_1" },
    truthfulness: { tool_called: false, production_write_performed: false },
    plan: { steps: [] },
    ...overrides,
  };
}

function dbFactsFor(mode, overrides = {}) {
  const action = confirmActions().find(
    (entry) => entry.action_type === (mode === "confirm" ? "confirm_before_execute" : "reject_or_cancel_confirmation"),
  );
  const closureStatus = mode === "confirm" ? "resolved" : "cancelled";
  return {
    receipts: [
      {
        id: "receipt-1",
        work_id: "work-1",
        session_id: "session-1",
        source_turn_ref: SOURCE_TURN,
        action_id: action.action_id,
        action_type: action.action_type,
        idempotency_key: action.idempotency_key,
        behavior_ref: action.behavior_ref,
        status: "accepted",
        result: {
          action_id: action.action_id,
          action_type: action.action_type,
          admission_version: 2,
          approval_policy_ref: "approval_policy.long_run_budget_gate",
          author_turn_ref: USER_TURN,
          behavior_ref: action.behavior_ref,
          decided_by: "author",
          decision: "CONFIRMED",
          idempotency_key: action.idempotency_key,
          profile_ref: "tool_confirmation_v1",
          receipt_id: "receipt-1",
          risk_class: "HIGH",
          run_id: CHILD_RUN,
          run_mode: "bounded",
          source_run_id: SOURCE_RUN,
          source_turn_ref: SOURCE_TURN,
          status: "accepted",
          target_artifact_ref: "prose_writing",
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
        trigger: { handoff: { receipt_id: "receipt-1", successor_run_id: CHILD_RUN }, handoff_reason: "author_action_handoff" },
      },
      {
        id: CHILD_RUN,
        profile_ref: "tool_confirmation_v1",
        run_mode: "bounded",
        status: "completed",
        active_behavior_ref: null,
        trigger: {
          action_id: action.action_id,
          action_type: action.action_type,
          author_turn_ref: USER_TURN,
          behavior_ref: action.behavior_ref,
          kind: "author_action",
          receipt_id: "receipt-1",
          source_run_id: SOURCE_RUN,
        },
      },
    ],
    interactions: [
      {
        role: "user",
        turn_id: USER_TURN,
        content: { text: CONFIRMATION_REQUEST, agent_run_id: SOURCE_RUN },
      },
      {
        role: "assistant",
        turn_id: SOURCE_TURN,
        content: {
          agent_run_id: SOURCE_RUN,
          turn_result: {
            status: "needs_confirmation",
            behavior_state: {
              active: {
                behavior_id: action.behavior_ref,
                lifecycle_status: "awaiting_author",
                required_next_action: "confirm_before_execute",
                available_actions: confirmActions(),
              },
              history: [],
            },
            trace_summary: {},
          },
        },
      },
      {
        role: "assistant",
        turn_id: `${SOURCE_TURN}:author_action:receipt-1`,
        content: {
          agent_run_id: CHILD_RUN,
          turn_result: {
            behavior_state: {
              active: null,
              history: [{ behavior_id: action.behavior_ref, lifecycle_status: closureStatus }],
            },
          },
        },
      },
    ],
    provider_runs: [{ agent_run_id: CHILD_RUN }],
    mutations_count: 0,
    memory_count: 0,
    receipts_count: 1,
    provider_runs_count: 1,
    agent_runs_count: 2,
    ...overrides,
  };
}

function wireFor(mode, overrides = {}) {
  const action = confirmActions().find((entry) => entry.action_type === (mode === "confirm" ? "confirm_before_execute" : "reject_or_cancel_confirmation"));
  const closureStatus = mode === "confirm" ? "resolved" : "cancelled";
  const frames = [
    received("turn_result", needsBody()),
    actionFrame(action),
    ackFrame(action),
    received("turn_result", { turn_id: "turn_dec", parent_turn_id: SOURCE_TURN, status: "completed", behavior_state: { lifecycle_status: closureStatus } }),
  ];
  if (mode === "confirm") {
    frames.push(
      received("turn_result", {
        turn_id: "turn_exec",
        parent_turn_id: SOURCE_TURN,
        status: "conversational",
        tool_result: { tool_name: "prose_writing", status: "ok" },
        adoption_state: { pending: [{ artifact_type: "prose_fragment", adoption_status: "TENTATIVE" }] },
        truthfulness: { tool_called: true, artifact_adopted: false },
      }),
    );
  } else {
    frames.push(
      received("turn_result", {
        turn_id: "turn_cancel",
        parent_turn_id: SOURCE_TURN,
        status: "conversational",
        assistant_message: { text: "已取消采纳；未覆盖正文，草稿仍保留为待采纳。" },
        truthfulness: { tool_called: false, production_write_performed: false },
      }),
    );
  }
  return { frames, action, ...overrides };
}

function driverLogFor(mode) {
  return {
    why: { opened: true, before: { llm_records: 1 }, after: { llm_records: 1 }, provider_delta: 0 },
    provider: { before: 0, after: mode === "confirm" ? 1 : 0 },
    restore: { resumed: true, confirmation_actionable: false },
  };
}

function evaluate(mode, overrides = {}) {
  const wire = wireFor(mode);
  return evaluateConfirmation({
    mode,
    wire: wire.frames,
    dbFacts: dbFactsFor(mode, overrides.dbFacts),
    checkpoints: { start: canonSnapshot(), final: canonSnapshot(overrides.finalHash ?? "canon-1") },
    driverLog: overrides.driverLog ?? driverLogFor(mode),
    cleanup: overrides.cleanup ?? { remaining: [] },
    llmRecords: overrides.llmRecords ?? [
      { provider: "slice_verify", request_body: { messages: [{ role: "user", content: CONFIRMATION_REQUEST }] } },
    ],
    providerBefore: overrides.providerBefore ?? 0,
    providerAfter: overrides.providerAfter ?? (mode === "confirm" ? 1 : 0),
  });
}

test("confirm 正例：C1–C11 全通过（确认受理/子执行/幂等/Why/恢复/清理）", () => {
  const result = evaluate("confirm");
  assert.deepEqual(result.failed, []);
  assert.equal(result.checks.C1_source_persisted.ok, true);
  assert.equal(result.checks.C2_confirmation_accepted.ok, true);
  assert.equal(result.checks.C3_author_action_run_bound.ok, true);
  assert.equal(result.checks.C3_author_action_run_bound.detail.child_profile_ref, "tool_confirmation_v1");
  assert.notEqual(result.checks.C3_author_action_run_bound.detail.child_run_id, result.checks.C3_author_action_run_bound.detail.source_run_id);
  assert.equal(result.checks.C4_behavior_uniquely_consumed.ok, true);
  assert.equal(result.checks.C4_behavior_uniquely_consumed.detail.closure_status, "resolved");
  assert.equal(result.checks.C5_duplicate_idempotent.ok, true);
  assert.equal(result.checks.C6_reject_zero_side_effect.ok, null);
  assert.equal(result.checks.C7_confirmed_child_execution.ok, true);
  assert.equal(result.checks.C8_author_bytes.ok, true);
  assert.equal(result.checks.C9_why_replay_zero_provider.ok, true);
  assert.equal(result.checks.C10_restore_not_actionable.ok, true);
  assert.equal(result.checks.C11_cleanup.ok, true);
  assert.equal(result.measured.executed_tool, "prose_writing");
  assert.equal(result.measured.pending_artifact_type, "prose_fragment");
});

test("reject 正例：零 Provider/零 canon/零 mutation、行为 cancelled、C7 不适用", () => {
  const result = evaluate("reject");
  assert.deepEqual(result.failed, []);
  assert.equal(result.checks.C6_reject_zero_side_effect.ok, true);
  assert.equal(result.checks.C7_confirmed_child_execution.ok, null);
  assert.equal(result.measured.provider_delta, 0);
});

test("反例：重复 receipt 破坏幂等（C5 fail）", () => {
  const facts = dbFactsFor("confirm");
  facts.receipts.push({ ...facts.receipts[0], id: "receipt-2" });
  const result = evaluate("confirm", { dbFacts: facts });
  assert.equal(result.checks.C5_duplicate_idempotent.ok, false);
  assert(result.failed.includes("C5_duplicate_idempotent"));
});

test("反例：拒绝路径产生 Provider 调用或 canon 变化（C6 fail）", () => {
  const provider = evaluate("reject", { providerBefore: 0, providerAfter: 1 });
  assert.equal(provider.checks.C6_reject_zero_side_effect.ok, false);
  const canon = evaluate("reject", { finalHash: "canon-changed" });
  assert.equal(canon.checks.C6_reject_zero_side_effect.ok, false);
});

test("反例：缺 CONFIRMED approval（C9 fail）与恢复后仍可触发（C10 fail）", () => {
  const facts = dbFactsFor("confirm");
  facts.receipts[0].result = { ...facts.receipts[0].result, decision: "PENDING" };
  const noApproval = evaluate("confirm", { dbFacts: facts });
  assert.equal(noApproval.checks.C9_why_replay_zero_provider.ok, false);
  const restore = evaluate("confirm", {
    driverLog: { ...driverLogFor("confirm"), restore: { resumed: true, confirmation_actionable: true } },
  });
  assert.equal(restore.checks.C10_restore_not_actionable.ok, false);
});

test("反例：cleanup 残留（C11 fail）与确认后无真实子执行（C7 fail）", () => {
  const cleanup = evaluate("confirm", { cleanup: { remaining: [{ pid: 1 }] } });
  assert.equal(cleanup.checks.C11_cleanup.ok, false);
  const noExecuted = evaluateConfirmation({
    mode: "confirm",
    wire: wireFor("confirm").frames.filter((frame) => frame.frame[4]?.turn_id !== "turn_exec"),
    dbFacts: dbFactsFor("confirm"),
    checkpoints: { start: canonSnapshot(), final: canonSnapshot() },
    driverLog: driverLogFor("confirm"),
    cleanup: { remaining: [] },
    llmRecords: [],
    providerBefore: 0,
    providerAfter: 0,
  });
  assert.equal(noExecuted.checks.C7_confirmed_child_execution.ok, false);
});

test("无 needs_confirmation 帧时如实报不可触发（不合成）", () => {
  assert.throws(
    () =>
      evaluateConfirmation({
        mode: "confirm",
        wire: [],
        dbFacts: dbFactsFor("confirm"),
        checkpoints: { start: canonSnapshot(), final: canonSnapshot() },
        driverLog: driverLogFor("confirm"),
        cleanup: { remaining: [] },
      }),
    /needs_confirmation/u,
  );
});

test("selectConfirmationAction：真实确认动作（无 source_turn_ref）可用；唯一/启用校验保留", () => {
  const realShape = [
    {
      action_id: "act_confirm_decision_mw0ty12z_1d",
      action_type: "confirm_before_execute",
      target_ref: "prose_writing",
      idempotency_key: "confirm_decision_mw0ty12z_1d",
      trace_ref: "decision_trace:message:agent:5",
      behavior_ref: "bh_mw0ty134_1e",
      expires_at: "2026-11-03T15:30:41.440507Z",
    },
    {
      action_id: "act_reject_decision_mw0ty12z_1d",
      action_type: "reject_or_cancel_confirmation",
      target_ref: "prose_writing",
      idempotency_key: "reject_decision_mw0ty12z_1d",
      behavior_ref: "bh_mw0ty134_1e",
    },
  ];
  const body = needsBody({ available_actions: realShape });
  const confirm = selectConfirmationAction(body, "confirm_before_execute");
  assert.equal(confirm.action_id, "act_confirm_decision_mw0ty12z_1d");
  assert.equal(confirm.target_ref, "prose_writing");
  const reject = selectConfirmationAction(body, "reject_or_cancel_confirmation");
  assert.equal(reject.action_id, "act_reject_decision_mw0ty12z_1d");
  const withSource = confirmActions();
  assert.equal(selectConfirmationAction(needsBody({ available_actions: withSource }), "confirm_before_execute").action_id, "confirm:as_1");
  assert.throws(() => selectConfirmationAction(needsBody(), "accept"), /必须唯一/u);
  assert.throws(
    () => selectConfirmationAction(needsBody({ available_actions: confirmActions().map((entry) => ({ ...entry, enabled: false })) }), "confirm_before_execute"),
    /enabled=false/u,
  );
  assert.throws(
    () =>
      selectConfirmationAction(
        needsBody({ available_actions: [{ ...confirmActions()[0], source_turn_ref: "turn-other" }] }),
        "confirm_before_execute",
      ),
    /source_turn_ref 与 TurnResult 不一致/u,
  );
});

test("locateConfirmationButton：按所属消息块定位，不借用兄弟块按钮，禁用/歧义失败", () => {
  const node = (path, role, fields = {}) => ({ path, role, frame: [10, 10, 200, 20], ...fields });
  const text = (path, value) => node(path, "AXStaticText", { value });
  const cardTitle = "需要确认";
  const cardBody = "确认对象：正文草稿生成";
  const nodes = [
    node("0/1", "AXGroup"),
    text("0/1/0", "AI"),
    text("0/1/1", cardTitle),
    text("0/1/2", cardBody),
    text("0/1/3", "确认前不会调用工具或写入作品事实"),
    node("0/1/4", "AXButton", { title: "确认执行", enabled: true }),
    node("0/1/5", "AXButton", { title: "拒绝", enabled: true }),
    node("0/2", "AXGroup"),
    text("0/2/0", "旧候选正文草稿"),
    node("0/2/1", "AXButton", { title: "保存到作品档案", enabled: true }),
  ];
  const knownItems = [cardTitle, cardBody, "确认前不会调用工具或写入作品事实"];
  const confirm = locateConfirmationButton(nodes, { label: "确认执行", cardTitle, cardBody, knownItems });
  assert.equal(confirm.ok, true);
  assert.equal(confirm.button.path, "0/1/4");
  const reject = locateConfirmationButton(nodes, { label: "拒绝", cardTitle, cardBody, knownItems });
  assert.equal(reject.ok, true);
  assert.equal(reject.button.path, "0/1/5");
  const disabled = locateConfirmationButton(
    nodes.map((entry) => (entry.path === "0/1/4" ? { ...entry, enabled: false } : entry)),
    { label: "确认执行", cardTitle, cardBody, knownItems },
  );
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, "action_disabled");
  const missing = locateConfirmationButton(nodes, { label: "确认执行", cardTitle, cardBody: "没有确认卡的消息", knownItems });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "item_missing");
  assert.equal(locateConfirmationButton(nodes, { label: "确认执行", cardTitle: null, cardBody }).reason, "card_evidence_missing");
});


test("executedConfirmationTurnResult：时间窗起点在点击前才命中子执行帧（01e 缺口回归）", () => {
  const executed = received(
    "turn_result",
    {
      turn_id: "turn_exec",
      tool_result: { tool_name: "prose_writing", status: "succeeded" },
      adoption_state: { pending: [{ artifact_type: "prose_fragment" }] },
    },
    "2026-11-03T15:20:35.009Z",
  );
  const wire = [received("turn_result", needsBody()), executed];
  assert.equal(
    executedConfirmationTurnResult(wire, "2026-11-03T15:20:34.800Z")?.frame?.[4]?.turn_id,
    "turn_exec",
    "点击前起点命中（真实 01e 场景）",
  );
  assert.equal(
    executedConfirmationTurnResult(wire, "2026-11-03T15:20:36.000Z"),
    null,
    "ACK 之后起点会排除已到达帧——调用方必须取点击前时刻",
  );
  assert.equal(executedConfirmationTurnResult([received("turn_result", needsBody())], "2020-01-01T00:00:00.000Z"), null);
});

test("rejectConfirmationTurnResult：parent 绑定或取消文案命中，无关帧不误判", () => {
  const cancel = received(
    "turn_result",
    { turn_id: "turn_cancel", parent_turn_id: SOURCE_TURN, assistant_message: { text: "已取消采纳；未覆盖正文。" } },
    "2026-11-03T15:20:40.000Z",
  );
  const unrelated = received("turn_result", { turn_id: "turn_other", parent_turn_id: "turn-x" }, "2026-11-03T15:20:41.000Z");
  assert.equal(rejectConfirmationTurnResult([cancel, unrelated], "2026-11-03T15:20:39.000Z", { sourceTurnId: SOURCE_TURN, userTurnId: "turn-user" })?.frame?.[4]?.turn_id, "turn_cancel");
  assert.equal(rejectConfirmationTurnResult([unrelated], "2020-01-01T00:00:00.000Z", { sourceTurnId: SOURCE_TURN, userTurnId: "turn-user" }), null);
});
