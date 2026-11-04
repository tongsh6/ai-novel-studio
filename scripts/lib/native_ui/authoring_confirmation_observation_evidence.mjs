// B71 §16.14 C5/C9/C10：重复点击、Why 零 Provider、重启恢复的外部观察与零副作用。
// 只消费 authoring_confirmation_facts 已归一的事实。
import { deltaAllZero, field } from "./authoring_confirmation_facts.mjs";

// C5 重复幂等（硬门禁）：attempted+duplicate ack，或 not_actionable + child run 唯一 + 零 delta。
export function duplicateIdempotentCheck(facts) {
  const duplicate = facts.duplicate;
  const dupAck = duplicate.ack;
  const dupAckOk =
    Boolean(dupAck) &&
    [
      duplicate.ackResponseActionStatus === "duplicate",
      duplicate.ackResponseDuplicate === true,
      duplicate.ackActionStatus === "duplicate",
      duplicate.ackDuplicate === true,
    ].some(Boolean);
  const attemptedOk = [duplicate.attempted === true, duplicate.clicked === true, dupAckOk].every(Boolean);
  const reasonIsNotActionable =
    typeof duplicate.reason === "string" && duplicate.reason.startsWith("not_actionable:");
  const notActionableOk = [
    duplicate.attempted === false,
    reasonIsNotActionable,
    deltaAllZero(duplicate.delta),
  ].every(Boolean);
  const ok = [
    facts.actionReceipts.length === 1,
    facts.childRuns.length === 1,
    attemptedOk || notActionableOk,
  ].every(Boolean);
  const reason =
    facts.actionReceipts.length !== 1
      ? "duplicate_receipt"
      : facts.childRuns.length !== 1
        ? "child_run_not_unique"
        : "duplicate_not_exercised_or_delta_nonzero";
  return {
    ok,
    reason: ok ? null : reason,
    detail: {
      action_receipts: facts.actionReceipts.length,
      child_runs: facts.childRuns.length,
      duplicate_attempted: duplicate.attempted,
      duplicate_reason: duplicate.reason,
      duplicate_ack_observed: Boolean(dupAckOk),
      duplicate_delta: duplicate.delta,
    },
  };
}

const APPROVAL_RULES = Object.freeze({
  confirm: Object.freeze({ decision: "CONFIRMED", decidedBy: "author", traceType: null }),
  reject: Object.freeze({ decision: "CANCELLED", decidedBy: "author", traceType: "cancel_waiting" }),
});

// C9 Why（硬门禁）：必须真正打开 + llm-calls 前后实测 + delta=0 + receipt 决定。
export function whyReplayCheck(facts) {
  const rule = APPROVAL_RULES[facts.mode];
  const receiptApprovalOk = [
    field(facts.receiptResult, "decision") === rule.decision,
    field(facts.receiptResult, "decided_by") === rule.decidedBy,
    rule.traceType === null || facts.rejectTraceDecisionType === rule.traceType,
  ].every(Boolean);
  const ok = [facts.why.opened === true, facts.why.delta === 0, receiptApprovalOk].every(Boolean);
  return {
    ok,
    reason: ok ? null : "why_not_opened_or_provider_delta_nonzero",
    detail: {
      why_opened: facts.why.opened ?? false,
      why_attempts: facts.why.attempts,
      llm_calls_before: facts.why.llmCallsBefore,
      llm_calls_after: facts.why.llmCallsAfter,
      llm_calls_delta: facts.why.delta,
      approval_policy_ref: facts.receiptApproval.approval_policy_ref,
      risk_class: facts.receiptApproval.risk_class,
      decision: field(facts.receiptResult, "decision"),
      decided_by: field(facts.receiptResult, "decided_by"),
    },
  };
}

const DECISION_TEXT_PATTERN = /已确认「[^」]{1,24}」|已取消采纳|已取消等待|不会执行|没有写入作品事实|已确认操作|已拒绝/u;

// C10 恢复：决定/创作结果可见 + source 卡关闭 + 重启前后零重放。
// driver 字段可能是旧正则产物；已采集的 visible_text_sample 是真实 AX 文本，可重算可见性。
export function restoreCheck(facts) {
  const restore = facts.restore;
  const decisionTextVisible =
    restore.decisionTextVisible === true || DECISION_TEXT_PATTERN.test(restore.visibleTextSample);
  const ok = [
    restore.resumed === true,
    decisionTextVisible,
    restore.sourceCardClosed === true,
    facts.mode === "reject" || restore.creativeResultVisible === true,
    deltaAllZero(restore.restartDelta),
  ].every(Boolean);
  return {
    ok,
    reason: ok ? null : "restore_evidence_or_zero_replay_missing",
    detail: {
      resumed: restore.resumed,
      decision_text_visible: restore.decisionTextVisible,
      decision_text_visible_from_sample: decisionTextVisible,
      creative_result_visible: restore.creativeResultVisible,
      source_card_closed: restore.sourceCardClosed,
      restart_delta: restore.restartDelta,
    },
  };
}
