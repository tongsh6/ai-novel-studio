// B71 §16.14 确认/拒绝判据 C1–C11 正反例（硬门禁：缺证据不得 PASS）。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONFIRMATION_REQUEST,
  confirmationCardLines,
  evaluateConfirmation,
  executedConfirmationTurnResult,
  locateConfirmationButton,
  rejectConfirmationTurnResult,
  scanAuthorVisibleBatch,
  selectConfirmationAction,
} from "./authoring_confirmation_evidence.mjs";

const JOIN_REF = "5";
const REF = "9";
const TOPIC = "workspace:test";
const SOURCE_TURN = "message_test:agent:5";
const USER_TURN = "message_test";
const SOURCE_RUN = "run-src";
const CHILD_RUN = "run-child";
const RECEIPT_ID = "receipt-1";
const CLICK_AT = "2026-11-03T10:00:09.000Z";

const received = (event, body, at = "2026-11-03T10:00:10.000Z") => ({
  at,
  direction: "received",
  frame: [JOIN_REF, REF, TOPIC, event, body],
});
const sentFrame = (event, body, at = CLICK_AT) => ({
  at,
  direction: "sent",
  frame: [JOIN_REF, REF, TOPIC, event, body],
});

function confirmActions() {
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

function needsBody(overrides = {}) {
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

function canonSnapshot(hash = "canon-1") {
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

function dbFactsFor(mode, overrides = {}) {
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
    agent_events: [],
    decision_traces: [
      {
        turn_id: mode === "confirm" ? "turn_dec" : "turn_dec",
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

function counts(llmCalls = 1) {
  return { provider_runs: 1, receipts: 1, agent_runs: 2, mutations: 0, llm_calls: llmCalls };
}

function driverLogFor(mode, overrides = {}) {
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

function wireFor(mode, overrides = {}) {
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
  return { frames, action, ...overrides };
}

function testDir(llmCalls = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-confirmation-unit-"));
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });
  fs.writeFileSync(path.join(dir, "llm-calls", "2026-11-03.jsonl"), `${JSON.stringify({ provider: "slice_verify" })}\n`.repeat(llmCalls));
  return dir;
}

function evaluate(mode, overrides = {}) {
  const wire = wireFor(mode);
  const dir = overrides.dir ?? testDir(overrides.llmCalls ?? 1);
  return evaluateConfirmation({
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
        request_body: {
          messages: [
            { role: "system", content: "system" },
            { role: "user", content: "【应用数据 · application_base · 非作者原话】材料" },
            { role: "user", content: CONFIRMATION_REQUEST },
          ],
        },
      },
    ],
    dir,
  });
}

test("confirm 正例：C1–C11 全过（硬门禁均有真实证据）", () => {
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
    dir: testDir(1),
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


test("AX 断言层：迁移期 3 类内部 code 命中判红，internal_terms_zh 单列不阻塞", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-author-visible-"));
  fs.writeFileSync(path.join(dir, "01-source.ax.txt"), "\t\t0/0/0/0/0/8 AXPopUpButton, 模型已连接, Description: Stub · 当前模型：slice_verify, enabled=true\n");
  const leak = scanAuthorVisibleBatch(dir);
  assert.equal(leak.ok, false);
  assert(leak.hits.some((hit) => hit.token === "slice_verify" || hit.token === "Stub"));
  fs.rmSync(dir, { recursive: true, force: true });

  const prose = fs.mkdtempSync(path.join(os.tmpdir(), "b71-author-visible-"));
  fs.writeFileSync(path.join(prose, "02-after-confirm.ax.txt"), "\t\t0/0/0/0/0/27/0 AXStaticText, Value: 已确认「prose_writing」操作，正在处理。\n");
  const proseLeak = scanAuthorVisibleBatch(prose);
  assert.equal(proseLeak.ok, false);
  assert(proseLeak.hits.some((hit) => hit.token === "prose_writing"));
  fs.rmSync(prose, { recursive: true, force: true });

  const p1 = fs.mkdtempSync(path.join(os.tmpdir(), "b71-author-visible-"));
  fs.writeFileSync(path.join(p1, "02-after-confirm.ax.txt"), "\t\t0/0/0/0/0/1 AXStaticText, Value: 当前创作请求的工作过程\n");
  const p1Scan = scanAuthorVisibleBatch(p1);
  // 迁移期：中文内部术语不判红（P1 迁移完成后恢复全开），但必须输出清单供 P1。
  assert.equal(p1Scan.ok, true);
  assert(p1Scan.internal_terms_zh_hits.some((hit) => hit.token === "工作过程"));
  fs.rmSync(p1, { recursive: true, force: true });

  const clean = fs.mkdtempSync(path.join(os.tmpdir(), "b71-author-visible-"));
  fs.writeFileSync(path.join(clean, "01-source.ax.txt"), "\t\t0/0/0/0/0/2 AXStaticText, Value: 需要确认\n");
  const cleanScan = scanAuthorVisibleBatch(clean);
  assert.equal(cleanScan.ok, true);
  assert.deepEqual(cleanScan.hits, []);
  fs.rmSync(clean, { recursive: true, force: true });
});
