// B71 §16.14 C1–C4：作者动作的来源、受理、run 绑定与行为唯一消费。
// 只消费 authoring_confirmation_facts 已归一的事实，不再读取 wire/DB。
import { field, list, textField } from "./authoring_confirmation_facts.mjs";

const CLOSURE_STATUS = Object.freeze({ confirm: "resolved", reject: "cancelled" });

// C1 source 真实持久（并与本批 user turn 关联）；可选 wire 摘要出现时必须与持久来源一致。
export function sourcePersistedCheck(facts) {
  const wireSummaryMatches = facts.sourceWireRunId === null || facts.sourceWireRunId === facts.sourceRunId;
  const sourcePersisted = [
    Boolean(facts.sourceInteraction),
    textField(field(facts.sourceInteraction, "turn_result"), "status") === "needs_confirmation",
    facts.sourceRunId !== "",
    wireSummaryMatches,
  ].every(Boolean);
  const sourceLinked = [
    facts.sourceDriverTurnId === facts.sourceTurnId,
    facts.sourceDriverUserTurnId !== "",
  ].every(Boolean);
  const ok = [sourcePersisted, sourceLinked].every(Boolean);
  return {
    ok,
    reason: ok ? null : "source_persisted_turn_missing_or_unlinked",
    detail: {
      turn_id: facts.sourceTurnId,
      source_run_id: facts.sourceRunId,
      user_turn_id: facts.sourceDriverUserTurnIdRaw,
    },
  };
}

// C2 确认受理身份：reply ok/received/action_status + trigger 字段 + receipt/turn 交叉 + sent source_turn_ref。
export function confirmationAcceptedCheck(facts) {
  const { ack_body: ackBody, ack_response: ackResponse, action, actionReceiptId, behaviorRef, sourceTurnId, receiptTurnId } = facts;
  const actionStatus = field(ackResponse, "action_status");
  const trigger = field(ackResponse, "trigger") ?? {};
  const ackTurnIds = list(field(ackResponse, "turn_results")).map((entry) => textField(entry, "turn_id"));
  const ok = [
    facts.ack_count === 1,
    field(ackBody, "status") === "ok",
    field(ackResponse, "received") === true,
    typeof actionStatus === "string" && actionStatus !== "",
    field(trigger, "action_id") === action.action_id,
    field(trigger, "action_type") === action.action_type,
    field(trigger, "receipt_id") === actionReceiptId,
    field(trigger, "behavior_ref") === behaviorRef,
    field(ackResponse, "receipt_id") === actionReceiptId,
    receiptTurnId === "" || ackTurnIds.includes(receiptTurnId),
    field(facts.sent_action_body, "source_turn_ref") === sourceTurnId,
  ].every(Boolean);
  return {
    ok,
    reason: ok ? null : "confirmation_ack_or_result_identity_mismatch",
    detail: {
      action_id: action.action_id,
      ack_status: field(ackBody, "status"),
      received: field(ackResponse, "received"),
      action_status: actionStatus,
      trigger,
      ack_receipt_id: field(ackResponse, "receipt_id"),
      ack_turn_ids: ackTurnIds,
      sent_source_turn_ref: field(facts.sent_action_body, "source_turn_ref"),
    },
  };
}

const CHILD_STATUSES = Object.freeze({
  confirm: Object.freeze(["completed"]),
  reject: Object.freeze(["cancelled", "completed"]),
});

// C3 作者动作 run：handoff 新 AgentRun（tool_confirmation_v1）+ source run handoff。
export function authorActionRunBoundCheck(facts) {
  const ok = [
    Boolean(facts.childRun),
    facts.childRunId !== facts.sourceRunId,
    facts.childProfileRef === "tool_confirmation_v1",
    facts.childRunMode === "bounded",
    facts.childParentTurnRef === facts.sourceTurnId,
    CHILD_STATUSES[facts.mode].includes(facts.childRunStatus),
    facts.childTrigger.receiptId === facts.actionReceiptId,
    facts.childTrigger.kind === "author_action",
    facts.childTrigger.sourceRunId === facts.sourceRunId,
    facts.childTrigger.behaviorRef === facts.behaviorRef,
    facts.receiptSourceRunId === facts.sourceRunId,
    facts.sourceHandoff.receiptId === facts.actionReceiptId,
    facts.sourceHandoff.successorRunId === facts.childRunId,
    facts.sourceRunStatus === "completed",
  ].every(Boolean);
  return {
    ok,
    reason: ok ? null : "author_action_run_not_bound_to_receipt",
    detail: {
      source_run_id: facts.sourceRunId,
      child_run_id: facts.childRunId,
      child_profile_ref: field(facts.childRun, "profile_ref"),
      child_status: field(facts.childRun, "status"),
      child_parent_turn_ref: field(facts.childRun, "parent_turn_ref"),
      child_trigger_kind: field(facts.childTriggerRaw, "kind"),
      source_handoff_receipt_id: field(facts.sourceHandoffRaw, "receipt_id"),
      source_handoff_successor: field(facts.sourceHandoffRaw, "successor_run_id"),
    },
  };
}

// C4 行为唯一消费：active awaiting_author + receipt.behavior_ref 唯一 + history 关闭。
export function behaviorConsumedCheck(facts) {
  const ok = [
    facts.activeBehaviorRef === facts.behaviorRef,
    facts.activeBehaviorStatus === "awaiting_author",
    facts.behaviorReceipts.length === 1,
    facts.closureStatus === CLOSURE_STATUS[facts.mode],
  ].every(Boolean);
  return {
    ok,
    reason: ok ? null : "behavior_not_uniquely_consumed",
    detail: {
      active_behavior_ref: facts.activeBehaviorRef,
      active_behavior_status: facts.activeBehaviorStatus,
      behavior_receipts: facts.behaviorReceipts.length,
      closure_status: facts.closureStatus,
    },
  };
}
