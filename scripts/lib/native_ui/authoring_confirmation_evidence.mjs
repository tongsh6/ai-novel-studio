// B71 §16.14 工具确认/拒绝原生场景证据与判据（C1–C11）。
//
// 场景：真实作者高风险请求 → needs_confirmation（awaiting_author behavior +
// confirm_before_execute/reject_or_cancel_confirmation 可用动作）→ 作者点击确认/拒绝
// （按用户可见语义 + 所属消息块定位）→ 确认子执行 / 拒绝零 Provider → Why → 重复点击
// 幂等 → 重启恢复不可再触发。
//
// 本模块只读真实 wire/DB/AX/cleanup 证据；不手造 needs_confirmation 帧、不改产品代码。
// 判据分层：mechanism C1–C11 必过；model_behavior（确认子 run 是否产出候选/被 gate 阻止/
// 工具失败）如实记录；不代签 I10/完整 G1–G6。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  frameBody,
  frameEvent,
  read,
  withDb,
  writeNativeFrames,
} from "./scenario_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import { locateScopedButton } from "./authoring_pending_evidence.mjs";

import {
  CONFIRMATION_CHECKPOINTS,
  CONFIRMATION_MODES,
  CONFIRMATION_REQUEST,
} from "./authoring_confirmation_constants.mjs";

export const CONFIRMATION_CHECK_SCHEMA = "b71-confirmation-checks/v1";
export { CONFIRMATION_CHECKPOINTS, CONFIRMATION_MODES, CONFIRMATION_REQUEST };

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);

function messageContent(message) {
  return typeof message?.content === "string" ? message.content : "";
}

// 确认卡所属消息块定位：用确认卡的**用户可见文案行**（如「需要确认」+「确认对象：正文
// 草稿生成」）作为消息块身份，按钮文案取真实可见名；复用 pending 的消息块模型（扁平 AX
// 树），禁止借用兄弟候选/其它块的按钮。两个文案行必须真实存在于 AX 文本中。
export function locateConfirmationButton(nodes, { label, cardTitle, cardBody, knownItems = [] } = {}) {
  if (typeof cardTitle !== "string" || cardTitle.trim() === "") {
    return { ok: false, reason: "card_evidence_missing" };
  }
  if (typeof cardBody !== "string" || cardBody.trim() === "") {
    return { ok: false, reason: "card_evidence_missing" };
  }
  const known = Array.isArray(knownItems) && knownItems.length > 0 ? knownItems : [cardTitle, cardBody];
  return locateScopedButton(nodes, { itemTitle: cardTitle, itemBody: cardBody, label, knownItems: known });
}

// 从 AX 纯文本中提取确认卡的可定位文案行（「需要确认」标题行 + 块内唯一正文行）。
// 失败返回 null，由调用方如实报「不可定位/不可触发」，不合成证据。
export function confirmationCardLines(axText) {
  const lines = String(axText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const titleLine = lines.find((line) => line === "需要确认" || line.startsWith("需要确认"));
  const bodyLine = lines.find(
    (line) =>
      (line.includes("确认对象") || line.includes("确认前不会调用工具") || line.includes("确认后系统会重新检查当前作品状态")) &&
      line !== titleLine,
  );
  if (!titleLine || !bodyLine) return null;
  return { title: titleLine, body: bodyLine };
}

// 确认/拒绝动作只能来自 needs_confirmation TurnResult 的真实 available_actions。
export function selectConfirmationAction(turnResult, actionType) {
  const turnId = String(turnResult?.turn_id ?? "");
  assert(turnId !== "", "needs_confirmation TurnResult 缺 turn_id");
  const matches = list(turnResult.available_actions).filter(
    (action) => action?.action_type === actionType,
  );
  assert.equal(matches.length, 1, `confirmation action ${actionType} 必须唯一，实测 ${matches.length}`);
  const action = matches[0];
  // 真实确认动作形状（cp4b-confirmation-01d 实测）：
  // { action_id:"act_confirm_decision_…", action_type, target_ref:"prose_writing",
  //   idempotency_key:"confirm_decision_…", behavior_ref:"bh_…", trace_ref, expires_at }
  // ——没有 source_turn_ref（前端 schema 中该字段可选）；不得按候选动作形状要求它。
  for (const field of ["action_id", "idempotency_key", "target_ref", "behavior_ref"]) {
    assert(
      typeof action[field] === "string" && action[field].trim() !== "",
      `confirmation action 缺 ${field}`,
    );
  }
  if (typeof action.source_turn_ref === "string" && action.source_turn_ref !== "") {
    assert.equal(action.source_turn_ref, turnId, "confirmation action source_turn_ref 与 TurnResult 不一致");
  }
  assert.notEqual(action.enabled, false, "confirmation action enabled=false");
  return action;
}

export function needsConfirmationTurnResult(wire) {
  return list(wire).find(
    (record) =>
      record?.direction === "received" &&
      frameEvent(record) === "turn_result" &&
      String(frameBody(record)?.status ?? "") === "needs_confirmation" &&
      list(frameBody(record)?.available_actions).some(
        (action) => action?.action_type === "confirm_before_execute",
      ),
  );
}

function replyRecords(wire, frame) {
  const ref = frame?.frame?.[1] ?? null;
  const joinRef = frame?.frame?.[0] ?? null;
  return list(wire).filter(
    (record) =>
      record?.direction === "received" &&
      Array.isArray(record.frame) &&
      record.frame[3] === "phx_reply" &&
      record.frame[1] === ref &&
      record.frame[0] === joinRef,
  );
}

export function confirmationWireFacts(wire, { sourceTurnId, action }) {
  const needs = needsConfirmationTurnResult(wire);
  const sourceBody = needs ? frameBody(needs) : null;
  const sentAction = list(wire).find(
    (record) =>
      record?.direction === "sent" &&
      frameEvent(record) === "author_action" &&
      frameBody(record)?.action?.action_id === action?.action_id &&
      frameBody(record)?.action?.action_type === action?.action_type,
  );
  const acks = sentAction ? replyRecords(wire, sentAction) : [];
  const actionResultFrame = list(wire).find(
    (record) =>
      record?.direction === "received" &&
      frameEvent(record) === "action_result" &&
      frameBody(record)?.action_id === action?.action_id &&
      frameBody(record)?.action_type === action?.action_type,
  );
  const decisionTurnResult = list(wire).find(
    (record) =>
      record?.direction === "received" &&
      frameEvent(record) === "turn_result" &&
      String(frameBody(record)?.parent_turn_id ?? "") === String(sourceTurnId ?? ""),
  );
  const executedTurnResult = list(wire).find(
    (record) =>
      record?.direction === "received" &&
      frameEvent(record) === "turn_result" &&
      isObject(frameBody(record)?.tool_result),
  );
  return {
    needs_confirmation_turn_id: sourceTurnId ?? null,
    needs_confirmation_body: sourceBody,
    sent_action: sentAction ?? null,
    sent_action_body: sentAction ? frameBody(sentAction)?.action ?? null : null,
    acks,
    ack_body: acks.length === 1 ? frameBody(acks[0]) ?? {} : null,
    action_result: actionResultFrame ?? null,
    action_result_body: actionResultFrame ? frameBody(actionResultFrame) : null,
    decision_turn_result: decisionTurnResult ?? null,
    decision_turn_result_body: decisionTurnResult ? frameBody(decisionTurnResult) : null,
    executed_turn_result: executedTurnResult ?? null,
    executed_turn_result_body: executedTurnResult ? frameBody(executedTurnResult) : null,
  };
}

// 点击后确认子执行帧：带真实 tool_result 的 received turn_result（时间窗按点击起点）。
// 注意：确定性 provider 的子执行帧可能在 ACK 之后极快到达，调用方的起点必须取
// 「点击动作之前」，不能用 ACK 返回之后的时刻（cp4b-confirmation-01e 的真实缺口）。
export function executedConfirmationTurnResult(wire, sinceIso) {
  return (
    list(wire).find(
      (record) =>
        record?.direction === "received" &&
        Array.isArray(record.frame) &&
        record.frame[3] === "turn_result" &&
        String(record.at ?? "") >= String(sinceIso ?? "") &&
        frameBody(record)?.tool_result !== null &&
        frameBody(record)?.tool_result !== undefined,
    ) ?? null
  );
}

// 拒绝路径决定帧：parent 绑定 source/user turn，或正文明确取消/拒绝。
export function rejectConfirmationTurnResult(wire, sinceIso, { sourceTurnId, userTurnId } = {}) {
  return (
    list(wire).find((record) => {
      if (record?.direction !== "received" || !Array.isArray(record.frame)) return false;
      if (record.frame[3] !== "turn_result") return false;
      if (String(record.at ?? "") < String(sinceIso ?? "")) return false;
      const body = frameBody(record) ?? {};
      const parent = String(body.parent_turn_id ?? "");
      const text = String(body.assistant_message?.text ?? "");
      return parent === String(sourceTurnId ?? "") || parent === String(userTurnId ?? "") || /取消|拒绝|未启动/.test(text);
    }) ?? null
  );
}

// ── DB facts（只读）────────────────────────────────────────────────────────────
export function readConfirmationDbFacts(dir) {
  return withDb(dir, (db) => {
    const tableCount = (table) => {
      try {
        return Number(all(db, `SELECT COUNT(*) AS c FROM ${table}`)[0]?.c ?? 0);
      } catch {
        return 0;
      }
    };
    const receipts = all(db, "SELECT * FROM author_action_receipts ORDER BY inserted_at, id");
    const agentRuns = all(db, "SELECT * FROM agent_runs ORDER BY inserted_at, id");
    const interactions = all(db, "SELECT * FROM interactions ORDER BY inserted_at, id");
    const providerRuns = all(db, "SELECT * FROM provider_runs ORDER BY inserted_at, id");
    const agentEvents = all(db, "SELECT event_type, refs, payload FROM agent_events ORDER BY inserted_at, id");
    return {
      receipts,
      agent_runs: agentRuns,
      interactions,
      provider_runs: providerRuns,
      agent_events: agentEvents,
      mutations_count: tableCount("mutations"),
      memory_count: tableCount("memory_items"),
      receipts_count: receipts.length,
      provider_runs_count: providerRuns.length,
      agent_runs_count: agentRuns.length,
    };
  });
}

function parseJsonField(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function interactionTurnResult(interactions, turnId) {
  for (const row of list(interactions)) {
    if (row?.turn_id !== turnId) continue;
    let content = row.content;
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        content = null;
      }
    }
    const turnResult = isObject(content?.turn_result) ? content.turn_result : null;
    if (turnResult) return { row, content, turn_result: turnResult };
  }
  return null;
}

function canonTableHashes(checkpoint) {
  return checkpoint?.authoring_canon?.tables ?? null;
}

function canonContentEqual(left, right) {
  const leftTables = canonTableHashes(left);
  const rightTables = canonTableHashes(right);
  if (!isObject(leftTables) || !isObject(rightTables)) return { equal: false, reason: "canon_evidence_missing" };
  const names = new Set([...Object.keys(leftTables), ...Object.keys(rightTables)]);
  const changed = [];
  for (const name of names) {
    const a = leftTables[name];
    const b = rightTables[name];
    if (!a || !b || a.row_count !== b.row_count || a.canon_sha256 !== b.canon_sha256) changed.push(name);
  }
  return { equal: changed.length === 0, changed };
}

function approvalsOf(dbFacts, sourceTurnId) {
  const interaction = interactionTurnResult(dbFacts?.interactions, sourceTurnId);
  const summary = interaction?.turn_result?.trace_summary ?? {};
  return list(summary.approvals);
}

export function evaluateConfirmation({
  mode,
  wire,
  dbFacts,
  checkpoints,
  driverLog = null,
  cleanup = null,
  llmRecords = [],
  providerBefore = null,
  providerAfter = null,
}) {
  const spec = CONFIRMATION_MODES[mode];
  assert(spec, `未知 confirmation mode: ${mode}`);
  const sourceTurn = needsConfirmationTurnResult(wire);
  assert(sourceTurn, "wire 中未收到 needs_confirmation TurnResult（真实页面未触发）");
  const sourceBody = frameBody(sourceTurn);
  const sourceTurnId = String(sourceBody.turn_id ?? "");
  const action = selectConfirmationAction(sourceBody, spec.action_type);
  const facts = confirmationWireFacts(wire, { sourceTurnId, action });
  const db = dbFacts ?? {};
  const receipts = list(db.receipts);
  const actionReceipts = receipts.filter((receipt) => receipt.action_id === action.action_id);
  const sourceInteraction = interactionTurnResult(db.interactions, sourceTurnId);
  const sourceRunId = String(
    facts.needs_confirmation_body?.agent_run?.run_id ??
      sourceInteraction?.content?.agent_run_id ??
      "",
  );
  const sourcePersisted =
    Boolean(sourceInteraction) &&
    String(sourceInteraction?.turn_result?.status ?? "") === "needs_confirmation" &&
    String(sourceInteraction?.content?.agent_run_id ?? "") !== "";
  const sourceBehavior = sourceInteraction?.turn_result?.behavior_state ?? null;
  const behaviorRef = String(action.behavior_ref ?? "");

  // C1 source 来自持久真实 run（非 fixture 手造）
  const c1 = {
    ok: Boolean(sourcePersisted),
    reason: sourcePersisted ? null : "source_persisted_turn_missing",
    detail: { turn_id: sourceTurnId, source_run_id: sourceRunId },
  };

  // C2 确认受理身份一致：sent action ↔ ACK ↔（若有）action_result
  const ackBody = facts.ack_body;
  const ackActionId = ackBody?.action_id ?? ackBody?.response?.action_id ?? null;
  const ackIdempotency = ackBody?.idempotency_key ?? ackBody?.response?.idempotency_key ?? null;
  const actionResultBody = facts.action_result_body;
  const c2 = {
    ok:
      Boolean(facts.sent_action_body) &&
      facts.acks.length === 1 &&
      (ackActionId === null || ackActionId === action.action_id) &&
      (ackIdempotency === null || ackIdempotency === action.idempotency_key) &&
      (actionResultBody === null ||
        (actionResultBody.action_id === action.action_id &&
          actionResultBody.action_type === action.action_type)),
    reason: null,
    detail: {
      action_id: action.action_id,
      idempotency_key: action.idempotency_key,
      ack_count: facts.acks.length,
      ack_action_id: ackActionId,
      action_result_present: Boolean(actionResultBody),
    },
  };
  if (!c2.ok) c2.reason = "confirmation_ack_or_result_identity_mismatch";

  // C3 作者动作 run：真实产品为 handoff 后的**新 AgentRun**（profile_ref=tool_confirmation_v1、
  // trigger.kind=author_action、trigger.receipt_id/source_run_id 绑定本次 receipt），source run
  // 的 trigger.handoff 记录 successor；不继承 source 剩余授权（新 run 有独立 authority/profile）。
  const runRow = list(db.agent_runs).find((row) => String(row.id) === sourceRunId) ?? null;
  const actionReceipt = actionReceipts[0] ?? null;
  const receiptResult = parseJsonField(actionReceipt?.result) ?? {};
  const childRunId = String(receiptResult?.run_id ?? "");
  const childRun = list(db.agent_runs).find((row) => String(row.id) === childRunId) ?? null;
  const childTrigger = parseJsonField(childRun?.trigger) ?? {};
  const sourceTrigger = parseJsonField(runRow?.trigger) ?? {};
  const handoff = sourceTrigger?.handoff ?? {};
  const receiptId = String(actionReceipt?.id ?? "");
  const c3 = {
    ok:
      Boolean(childRun) &&
      childRunId !== sourceRunId &&
      String(childRun?.profile_ref ?? "") === "tool_confirmation_v1" &&
      String(childRun?.run_mode ?? "") === "bounded" &&
      String(childTrigger?.receipt_id ?? "") === receiptId &&
      String(childTrigger?.kind ?? "") === "author_action" &&
      String(childTrigger?.source_run_id ?? "") === sourceRunId &&
      String(childTrigger?.behavior_ref ?? "") === behaviorRef &&
      String(receiptResult?.source_run_id ?? "") === sourceRunId &&
      String(handoff?.receipt_id ?? "") === receiptId &&
      String(handoff?.successor_run_id ?? "") === childRunId,
    reason: null,
    detail: {
      source_run_id: sourceRunId,
      child_run_id: childRunId,
      child_profile_ref: childRun?.profile_ref ?? null,
      child_run_mode: childRun?.run_mode ?? null,
      child_trigger_kind: childTrigger?.kind ?? null,
      child_trigger_source_run: childTrigger?.source_run_id ?? null,
      source_handoff_receipt_id: handoff?.receipt_id ?? null,
      source_handoff_successor: handoff?.successor_run_id ?? null,
    },
  };
  if (!c3.ok) c3.reason = "author_action_run_not_bound_to_receipt";

  // C4 行为唯一消费：source turn 的 active behavior 处于 awaiting_author + receipt.behavior_ref
  // 唯一 + 受理后 behavior 关闭（history 里同 behavior 进入 resolved/cancelled）。
  const sourceBehaviorState = sourceInteraction?.turn_result?.behavior_state ?? null;
  const activeBehavior = sourceBehaviorState?.active ?? null;
  const activeBehaviorRef = String(activeBehavior?.behavior_id ?? "");
  const sourceBehaviorOk =
    activeBehaviorRef === behaviorRef &&
    String(activeBehavior?.lifecycle_status ?? "awaiting_author") === "awaiting_author";
  const behaviorReceipts = receipts.filter((receipt) => String(receipt.behavior_ref ?? "") === behaviorRef);
  let closure = null;
  for (const row of list(db.interactions)) {
    const content = parseJsonField(row?.content) ?? {};
    const history = content?.turn_result?.behavior_state?.history;
    const entry = list(history).find(
      (candidate) =>
        String(candidate?.behavior_id ?? "") === behaviorRef &&
        ["resolved", "cancelled"].includes(String(candidate?.lifecycle_status ?? "")),
    );
    if (entry) {
      closure = entry;
      break;
    }
  }
  const closureStatus = String(closure?.lifecycle_status ?? "");
  const c4 = {
    ok:
      Boolean(activeBehaviorRef) &&
      sourceBehaviorOk &&
      behaviorReceipts.length === 1 &&
      (mode === "reject" ? closureStatus === "cancelled" : closureStatus === "resolved"),
    reason: null,
    detail: {
      active_behavior_ref: activeBehaviorRef,
      active_behavior_status: String(activeBehavior?.lifecycle_status ?? "awaiting_author"),
      behavior_receipts: behaviorReceipts.length,
      closure_status: closureStatus,
    },
  };
  if (!c4.ok) c4.reason = "behavior_not_uniquely_consumed";

  // C5 重复确认/拒绝幂等：同 action 只一条 receipt、无新增 run/provider 调用
  const duplicateAck = list(wire).filter(
    (record) =>
      record?.direction === "received" &&
      frameEvent(record) === "phx_reply" &&
      (frameBody(record)?.action_status === "duplicate" || frameBody(record)?.duplicate === true),
  );
  const c5 = {
    ok: actionReceipts.length === 1,
    reason: actionReceipts.length === 1 ? null : `duplicate_receipt:${actionReceipts.length}`,
    detail: {
      action_receipts: actionReceipts.length,
      duplicate_ack_observed: duplicateAck.length,
      agent_runs: db.agent_runs_count,
      provider_runs: db.provider_runs_count,
    },
  };

  // C6 拒绝零 Provider/零 canon/零 mutation（reject mode）；confirm mode 记 not_applicable
  const canon = canonContentEqual(checkpoints?.start, checkpoints?.final);
  const providerDelta =
    providerBefore === null || providerAfter === null
      ? null
      : Number(providerAfter) - Number(providerBefore);
  const rejectReceipts = receipts.filter(
    (receipt) => receipt.action_type === "reject_or_cancel_confirmation",
  );
  const c6 =
    mode === "reject"
      ? {
          ok:
            canon.equal &&
            Number(db.mutations_count ?? 0) === 0 &&
            (providerDelta === null || providerDelta === 0) &&
            rejectReceipts.length === 1 &&
            closureStatus === "cancelled",
          reason: null,
          detail: { canon, provider_delta: providerDelta, reject_receipts: rejectReceipts.length, closure_status: closureStatus },
        }
      : { ok: null, reason: "confirm_mode", detail: {} };
  if (c6.ok === false) c6.reason = "reject_side_effect_detected";

  // C7 确认子 run 真实执行（confirm mode）：executed turn_result 有真实 tool_result +
  // 子执行绑定真实 ProviderRun/llm-calls；gate 阻止/失败如实记录。
  const executedBody = facts.executed_turn_result_body;
  const childProviderRuns = list(db.provider_runs).filter(
    (row) => String(row.agent_run_id ?? "") === childRunId,
  );
  const childLlmRecords = list(llmRecords).filter((record) => record.provider === "slice_verify");
  const c7 =
    mode === "confirm"
      ? {
          ok:
            Boolean(executedBody) &&
            isObject(executedBody?.tool_result) &&
            childProviderRuns.length >= 1 &&
            childLlmRecords.length >= 1,
          reason: null,
          detail: {
            executed_turn_id: executedBody?.turn_id ?? null,
            tool_name: executedBody?.tool_result?.tool_name ?? null,
            pending_artifact_type: list(executedBody?.adoption_state?.pending)[0]?.artifact_type ?? null,
            child_run_id: childRunId,
            child_provider_runs: childProviderRuns.length,
            llm_records: childLlmRecords.length,
            truthfulness: executedBody?.truthfulness ?? null,
          },
        }
      : { ok: null, reason: "reject_mode", detail: {} };
  if (c7.ok === false) c7.reason = "confirmed_child_execution_missing";

  // C8 作者字节：确认动作不冒充作者原话；子请求中的作者消息来自持久 source 作者消息。
  const userTurnId = String(sourceTurnId).includes(":agent:") ? String(sourceTurnId).split(":agent:")[0] : "";
  const userInteraction = list(db.interactions).find(
    (row) => String(row.role ?? "") === "user" && String(row.turn_id ?? "") === userTurnId,
  );
  const userContent = parseJsonField(userInteraction?.content) ?? {};
  const sourceAuthorText = String(userContent?.text ?? "");
  const childAuthorBytes = childLlmRecords.some((record) => {
    const messages = record?.request_body?.messages ?? record?.request?.body?.messages ?? [];
    const authorMessage = list(messages).find((message) => message?.role === "user" && messageContent(message) === sourceAuthorText);
    return sourceAuthorText === "" || Boolean(authorMessage);
  });
  const c8 = {
    ok: sourceAuthorText !== "" && childAuthorBytes,
    reason: null,
    detail: { source_author_chars: sourceAuthorText.length, child_author_bytes_match: childAuthorBytes },
  };
  if (!c8.ok) c8.reason = "author_bytes_not_preserved";

  // C9 Why/replay：持久 approvals 记录（confirm 必须有 CONFIRMED/author；reject 记录取消）
  // + Why 打开前后 Provider 调用 delta=0。
  const receiptResultApproval = {
    approval_policy_ref: receiptResult?.approval_policy_ref ?? null,
    risk_class: receiptResult?.risk_class ?? null,
    decision: receiptResult?.decision ?? null,
    decided_by: receiptResult?.decided_by ?? null,
    target_artifact_ref: receiptResult?.target_artifact_ref ?? null,
  };
  const confirmedApproval =
    String(receiptResult?.decision ?? "") === "CONFIRMED" &&
    String(receiptResult?.decided_by ?? "") === "author"
      ? receiptResultApproval
      : null;
  const why = driverLog?.why ?? null;
  const whyDelta =
    why?.opened === true && why?.before && why?.after
      ? Number(why.after.llm_records ?? 0) - Number(why.before.llm_records ?? 0)
      : null;
  const c9 = {
    ok:
      (mode === "reject" || Boolean(confirmedApproval)) &&
      (whyDelta === null || whyDelta === 0),
    reason: null,
    detail: {
      approval_policy_ref: confirmedApproval?.approval_policy_ref ?? null,
      risk_class: confirmedApproval?.risk_class ?? null,
      decision: confirmedApproval?.decision ?? null,
      decided_by: confirmedApproval?.decided_by ?? null,
      why_opened: why?.opened ?? false,
      why_provider_delta: whyDelta,
    },
  };
  if (!c9.ok) c9.reason = "why_or_approval_replay_missing";

  // C10 恢复不可再触发：restored 采集的 AX 文本不再出现可点击确认/拒绝。
  const restore = driverLog?.restore ?? null;
  const c10 = {
    ok:
      restore?.resumed === true &&
      restore?.confirmation_actionable === false,
    reason: null,
    detail: { resumed: restore?.resumed ?? null, confirmation_actionable: restore?.confirmation_actionable ?? null },
  };
  if (!c10.ok) c10.reason = "restored_confirmation_still_actionable";

  // C11 清理：cleanup remaining=[] 且（确定性批次）provider 侧无残留。
  const remaining = list(cleanup?.remaining);
  const c11 = {
    ok: remaining.length === 0,
    reason: remaining.length === 0 ? null : "cleanup_remaining_processes",
    detail: { remaining: remaining.length, process_observation: cleanup?.process_observation ?? null },
  };

  const checks = {
    C1_source_persisted: c1,
    C2_confirmation_accepted: c2,
    C3_author_action_run_bound: c3,
    C4_behavior_uniquely_consumed: c4,
    C5_duplicate_idempotent: c5,
    C6_reject_zero_side_effect: c6,
    C7_confirmed_child_execution: c7,
    C8_author_bytes: c8,
    C9_why_replay_zero_provider: c9,
    C10_restore_not_actionable: c10,
    C11_cleanup: c11,
  };
  const required = Object.entries(checks)
    .filter(([, value]) => value.ok !== null)
    .map(([key]) => key);
  const failed = Object.entries(checks)
    .filter(([, value]) => value.ok === false)
    .map(([key]) => key);
  return {
    schema: CONFIRMATION_CHECK_SCHEMA,
    mode,
    source_turn_id: sourceTurnId,
    source_run_id: sourceRunId,
    action: {
      action_id: action.action_id,
      action_type: action.action_type,
      idempotency_key: action.idempotency_key,
      target_ref: action.target_ref,
      behavior_ref: behaviorRef,
    },
    checks,
    required,
    failed,
    measured: {
      receipts: receipts.length,
      action_receipts: actionReceipts.length,
      provider_runs: db.provider_runs_count,
      provider_delta: providerDelta,
      canon,
      executed_tool: executedBody?.tool_result?.tool_name ?? null,
      pending_artifact_type: list(executedBody?.adoption_state?.pending)[0]?.artifact_type ?? null,
      approvals: confirmedApproval ? 1 : 0,
    },
    model_behavior: {
      executed: executedBody
        ? {
            tool_name: executedBody?.tool_result?.tool_name ?? null,
            tool_status: executedBody?.tool_result?.status ?? null,
            pending_artifact_type: list(executedBody?.adoption_state?.pending)[0]?.artifact_type ?? null,
            truthfulness: executedBody?.truthfulness ?? null,
          }
        : null,
      gate_blocked:
        String(facts.decision_turn_result_body?.status ?? "") === "failed" ||
        String(executedBody?.tool_result?.status ?? "") === "failed",
    },
    not_signed: ["I10_literary_quality_not_signed", "G1_G6_full_signed=false", "other_profiles_not_signed"],
  };
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function readLogs(logDir) {
  if (!fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) =>
      fs
        .readFileSync(path.join(logDir, file), "utf8")
        .split("\n")
        .filter((line) => line.includes("{"))
        .map((line) => {
          try {
            return JSON.parse(line.slice(line.indexOf("{")));
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
}

export function verifyConfirmationBatch(dir) {
  const config = readConfig(dir);
  assert.equal(config.journey, "confirmation", "confirmation verifier 只接受 journey=confirmation");
  const mode = String(config.confirmation?.mode ?? "");
  assert(CONFIRMATION_MODES[mode], `未知 confirmation mode: ${mode}`);
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: 4,
    minimumWaits: 8,
    requiredKinds: ["input", "ack", "turn", "maintenance", "restore"],
  });
  const evidence = assertProviderAndWire(dir, {
    minUserMessages: 1,
    minTurnResults: 2,
    minProviderStarts: 0,
    expectProviders: ["slice_verify"],
  });
  const wire = evidence.wire;
  const checkpoints = Object.fromEntries(
    CONFIRMATION_CHECKPOINTS.map((name) => [name, readJsonIfExists(path.join(dir, `b71-${name}.json`))]),
  );
  for (const name of ["start", "final"]) {
    assert(checkpoints[name], `缺少 checkpoint b71-${name}.json（canon 快照）`);
  }
  const dbFacts = readConfirmationDbFacts(dir);
  const driverLog = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  const cleanup = readJsonIfExists(path.join(dir, "native-app-cleanup.json"));
  const llmRecords = readLogs(path.join(dir, "llm-calls"));
  const result = evaluateConfirmation({
    mode,
    wire,
    dbFacts,
    checkpoints,
    driverLog,
    cleanup,
    llmRecords,
    providerBefore: driverLog?.provider?.before ?? null,
    providerAfter: driverLog?.provider?.after ?? null,
  });
  writeNativeFrames(dir);
  const summary = {
    schema: "b71-confirmation-summary/v1",
    slice_id: config.slice_id,
    surface: "tauri-native",
    driver: "ax-native-system-ui",
    provider: config.provider,
    mode,
    request: config.message,
    verified_at: new Date().toISOString(),
    checks: Object.fromEntries(Object.entries(result.checks).map(([key, value]) => [key, value.ok])),
    checks_detail: result.checks,
    required: result.required,
    failed: result.failed,
    measured: result.measured,
    model_behavior: result.model_behavior,
    not_signed: result.not_signed,
    wait_ledger: common.ledger,
    screenshots: common.ui.screenshots,
    verdict: {
      mechanism: result.failed.length === 0 ? "pass" : "fail",
      model_behavior: result.model_behavior,
      full_g1_g6_signed: false,
      i10_signed: false,
    },
  };
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  assert.equal(result.failed.length, 0, `B71 confirmation 判据失败: ${result.failed.join(", ")}`);
  console.log(
    `B71 confirmation 判据通过: mode=${mode} source_turn=${result.source_turn_id} executed=${result.measured.executed_tool ?? "-"}`,
  );
  return { result, summary };
}
