// B71 §16.14 confirmation 场景的事实边界：把真实 wire / SQLite 行 / driver log / checkpoint
// 归一为一份已解析事实。判据模块只消费这份事实，不重复 optional-chain / String / Number /
// 列表兜底，也不在这里做 PASS/FAIL 决策。
import assert from "node:assert/strict";
import { frameBody, frameEvent } from "./scenario_evidence.mjs";
import { CONFIRMATION_MODES } from "./authoring_confirmation_constants.mjs";

export const list = (value) => (Array.isArray(value) ? value : []);
export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const firstOrNull = (values) => (values.length > 0 ? values[0] : null);

// 外部 JSON 列只在这里解码一次。
export function parseJsonField(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// 外部对象字段的唯一读取边界：缺失与 null 都归一为 null，调用方不再写 ?./??。
export function field(object, key) {
  if (object === null || object === undefined) return null;
  return object[key] ?? null;
}

export function textField(object, key) {
  return String(field(object, key) ?? "");
}

export function pathField(object, keys) {
  let current = object;
  for (const key of keys) {
    current = field(current, key);
    if (current === null) return null;
  }
  return current;
}

export function textPath(object, keys) {
  return String(pathField(object, keys) ?? "");
}

// 计数只接受真实数字；缺失/null/字符串保持 unknown（NaN），不转成 0。
export const numberValue = (value) => (Number.isFinite(value) ? value : Number.NaN);
const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);

const ZERO_DELTA_KEYS = Object.freeze(["provider_runs", "agent_runs", "receipts", "llm_calls"]);

// 零 delta：四个计数必须都真实测得为数字 0。缺 key/null/字符串/非零都不等于 0。
export function deltaAllZero(delta) {
  return isObject(delta) && ZERO_DELTA_KEYS.every((key) => delta[key] === 0);
}

// ── wire 定位（driver 与 evaluator 共用同一语义）──────────────────────────────
const isReceived = (record) => field(record, "direction") === "received";
const isConfirmAction = (action) => field(action, "action_type") === "confirm_before_execute";

export function needsConfirmationTurnResult(wire) {
  return list(wire).find(
    (record) =>
      isReceived(record) &&
      frameEvent(record) === "turn_result" &&
      textField(frameBody(record), "status") === "needs_confirmation" &&
      list(field(frameBody(record), "available_actions")).some(isConfirmAction),
  );
}

const hasToolResult = (record) => field(frameBody(record), "tool_result") !== null;
const atOrAfter = (record, sinceIso) => textField(record, "at") >= String(sinceIso ?? "");

// 确认/拒绝动作只能来自 needs_confirmation TurnResult 的真实 available_actions。
// 真实动作形状没有 source_turn_ref（候选动作才有）；存在时才校验一致性。
export function selectConfirmationAction(turnResult, actionType) {
  const turnId = textField(turnResult, "turn_id");
  assert(turnId !== "", "needs_confirmation TurnResult 缺 turn_id");
  const matches = list(field(turnResult, "available_actions")).filter(
    (action) => field(action, "action_type") === actionType,
  );
  assert.equal(matches.length, 1, `confirmation action ${actionType} 必须唯一，实测 ${matches.length}`);
  const action = matches[0];
  for (const name of ["action_id", "idempotency_key", "target_ref", "behavior_ref"]) {
    assert(typeof field(action, name) === "string" && field(action, name).trim() !== "", `confirmation action 缺 ${name}`);
  }
  const sourceTurnRef = field(action, "source_turn_ref");
  if (typeof sourceTurnRef === "string" && sourceTurnRef !== "") {
    assert.equal(sourceTurnRef, turnId, "confirmation action source_turn_ref 与 TurnResult 不一致");
  }
  assert.notEqual(field(action, "enabled"), false, "confirmation action enabled=false");
  return action;
}

// 点击后确认子执行帧：带真实 tool_result 的 received turn_result（时间窗按点击起点之前）。
export function executedConfirmationTurnResult(wire, sinceIso) {
  return (
    list(wire).find(
      (record) =>
        isReceived(record) &&
        frameEvent(record) === "turn_result" &&
        atOrAfter(record, sinceIso) &&
        hasToolResult(record),
    ) ?? null
  );
}

function parentMatches(body, sourceTurnId, userTurnId) {
  const parent = textField(body, "parent_turn_id");
  return parent === String(sourceTurnId ?? "") || parent === String(userTurnId ?? "");
}

function assistantTextSaysRejected(body) {
  return /取消|拒绝|未启动/.test(textField(field(body, "assistant_message"), "text"));
}

function isRejectTurnRecord(record) {
  return isReceived(record) && frameEvent(record) === "turn_result";
}

function matchesRejectIdentity(record, sinceIso, sourceTurnId, userTurnId) {
  const body = frameBody(record) ?? {};
  return (
    atOrAfter(record, sinceIso) &&
    (parentMatches(body, sourceTurnId, userTurnId) || assistantTextSaysRejected(body))
  );
}

function isRejectDecisionTurn(record, sinceIso, sourceTurnId, userTurnId) {
  return isRejectTurnRecord(record) && matchesRejectIdentity(record, sinceIso, sourceTurnId, userTurnId);
}

// 拒绝路径决定帧：parent 绑定 source/user turn，或正文明确取消/拒绝。
export function rejectConfirmationTurnResult(wire, sinceIso, { sourceTurnId, userTurnId } = {}) {
  return list(wire).find((record) => isRejectDecisionTurn(record, sinceIso, sourceTurnId, userTurnId)) ?? null;
}

function isSentActionFor(record, action) {
  return (
    field(record, "direction") === "sent" &&
    frameEvent(record) === "author_action" &&
    field(field(frameBody(record), "action"), "action_id") === field(action, "action_id") &&
    field(field(frameBody(record), "action"), "action_type") === field(action, "action_type")
  );
}

function sentActionFacts(wire, action) {
  const sentAction = list(wire).find((record) => isSentActionFor(record, action));
  if (!sentAction) return { sentAction: null, sentBody: null, ref: null, joinRef: null };
  const frame = list(field(sentAction, "frame"));
  return {
    sentAction,
    sentBody: field(frameBody(sentAction), "action"),
    ref: frame[1] ?? null,
    joinRef: frame[0] ?? null,
  };
}

function isAckFor(record, sent) {
  const frame = field(record, "frame");
  return (
    field(record, "direction") === "received" &&
    Array.isArray(frame) &&
    frame[3] === "phx_reply" &&
    frame[1] === sent.ref &&
    frame[0] === sent.joinRef
  );
}

function ackFacts(wire, sent) {
  const ackReplies = sent.sentAction ? list(wire).filter((record) => isAckFor(record, sent)) : [];
  const ack = ackReplies.length === 1 ? ackReplies[0] : null;
  const ackBody = ack ? frameBody(ack) ?? {} : null;
  return {
    ackReplies,
    ack,
    ackBody,
    ackResponse: ackBody ? field(ackBody, "response") ?? ackBody : null,
  };
}

function decisionTurn(wire, receiptTurnId, sourceTurnId) {
  return (
    list(wire).find((record) => {
      if (!isReceived(record) || frameEvent(record) !== "turn_result") return false;
      const body = frameBody(record) ?? {};
      return receiptTurnId
        ? textField(body, "turn_id") === receiptTurnId
        : textField(body, "parent_turn_id") === String(sourceTurnId ?? "");
    }) ?? null
  );
}

function isLegacyExecutedTurn(record, sourceTurnId) {
  return (
    isReceived(record) &&
    frameEvent(record) === "turn_result" &&
    textField(frameBody(record), "turn_id").startsWith(String(sourceTurnId ?? "")) &&
    hasToolResult(record)
  );
}

function legacyExecutedTurn(wire, sourceTurnId) {
  return list(wire).find((record) => isLegacyExecutedTurn(record, sourceTurnId)) ?? null;
}

function executedTurn(wire, clickAt, sourceTurnId) {
  return clickAt ? executedConfirmationTurnResult(wire, clickAt) : legacyExecutedTurn(wire, sourceTurnId);
}

const bodyOrNull = (record) => (record ? frameBody(record) : null);

function confirmationWireFacts(wire, { sourceTurn, sourceTurnId, action, receiptResult, driverLog }) {
  const sent = sentActionFacts(wire, action);
  const ack = ackFacts(wire, sent);
  const receiptTurnId = textField(receiptResult, "turn_id");
  const decision = decisionTurn(wire, receiptTurnId, sourceTurnId);
  const clickAt = textPath(driverLog, ["source", "click_at"]);
  const executed = executedTurn(wire, clickAt, sourceTurnId);
  return {
    needs_confirmation_body: frameBody(sourceTurn),
    sent_action_body: sent.sentBody,
    ack_count: ack.ackReplies.length,
    ack_body: ack.ackBody,
    ack_response: ack.ackResponse,
    decision_turn_result_body: bodyOrNull(decision),
    executed_turn_result_body: bodyOrNull(executed),
    click_at: clickAt || null,
  };
}

// ── DB / driver 事实 ──────────────────────────────────────────────────────────
function findById(rows, id) {
  return list(rows).find((row) => String(field(row, "id") ?? "") === id) ?? null;
}

function parseInteractionRows(rows) {
  return list(rows).map((row) => ({ row, content: parseJsonField(field(row, "content")) }));
}

function interactionTurnResult(interactions, turnId) {
  for (const entry of interactions) {
    if (field(entry.row, "turn_id") !== turnId) continue;
    const turnResult = isObject(field(entry.content, "turn_result")) ? field(entry.content, "turn_result") : null;
    if (turnResult) return { ...entry, turn_result: turnResult };
  }
  return null;
}

function isClosureFor(candidate, behaviorRef) {
  return (
    textField(candidate, "behavior_id") === String(behaviorRef) &&
    ["resolved", "cancelled"].includes(textField(candidate, "lifecycle_status"))
  );
}

function behaviorHistoryEntry(interactions, behaviorRef) {
  for (const interaction of interactions) {
    const history = list(
      field(field(field(interaction.content, "turn_result"), "behavior_state"), "history"),
    );
    const entry = history.find((candidate) => isClosureFor(candidate, behaviorRef));
    if (entry) return entry;
  }
  return null;
}

export function decisionTraceFor(dbFacts, turnIds) {
  const wanted = new Set(turnIds.filter(Boolean).map(String));
  return list(field(dbFacts, "decision_traces")).find((trace) => traceMatches(trace, wanted)) ?? null;
}

function traceMatches(trace, wanted) {
  const turnId = textField(trace, "turn_id");
  if (turnId === "") return false;
  if (wanted.has(turnId)) return true;
  return [...wanted].some((want) => turnId.includes(want) || want.includes(turnId));
}

function canonTableHashes(checkpoint) {
  return field(field(checkpoint, "authoring_canon"), "tables");
}

function unionTableNames(left, right) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])];
}

function sameCanonTable(left, right) {
  return (
    Boolean(left) &&
    Boolean(right) &&
    field(left, "row_count") === field(right, "row_count") &&
    field(left, "canon_sha256") === field(right, "canon_sha256")
  );
}

export function canonContentEqual(left, right) {
  const leftTables = canonTableHashes(left);
  const rightTables = canonTableHashes(right);
  if (!isObject(leftTables) || !isObject(rightTables)) {
    return { equal: false, changed: [], reason: "canon_evidence_missing" };
  }
  const changed = unionTableNames(leftTables, rightTables).filter(
    (name) => !sameCanonTable(leftTables[name], rightTables[name]),
  );
  return { equal: changed.length === 0, changed };
}

// C6 只排除行为受理 receipt 表；其余作品 canon 表与表外证据仍逐表比较。
export function canonWorksEqual(left, right) {
  const leftTables = canonTableHashes(left);
  const rightTables = canonTableHashes(right);
  if (!isObject(leftTables) || !isObject(rightTables)) {
    return { equal: false, changed: ["canon_evidence_missing"] };
  }
  const changed = unionTableNames(leftTables, rightTables)
    .filter((name) => name !== "author_action_receipts")
    .filter((name) => !sameCanonTable(leftTables[name], rightTables[name]));
  return { equal: changed.length === 0, changed };
}

export function receiptApproval(receiptResult) {
  return {
    approval_policy_ref: field(receiptResult, "approval_policy_ref"),
    risk_class: field(receiptResult, "risk_class"),
    decision: field(receiptResult, "decision"),
    decided_by: field(receiptResult, "decided_by"),
    target_artifact_ref: field(receiptResult, "target_artifact_ref"),
  };
}

export function normalizeAgentEvents(rows) {
  return list(rows).map((row) => ({
    id: field(row, "id"),
    run_id: field(row, "run_id"),
    sequence: field(row, "sequence"),
    event_type: field(row, "event_type"),
    summary: field(row, "summary"),
    reason_codes: parseJsonField(field(row, "reason_codes")),
    refs: parseJsonField(field(row, "refs")),
  }));
}

export function pendingArtifactType(body) {
  return field(firstOrNull(list(field(field(body, "adoption_state"), "pending"))), "artifact_type");
}

function childExecutionBranch({ toolResult, truthfulness, childProviderRuns, childLlmRecords, traceForDecision }) {
  if (isExecutedBranch({ toolResult, childProviderRuns, childLlmRecords })) return "executed";
  if (isBlockedBranch({ toolResult, truthfulness, traceForDecision })) return "gate_blocked";
  if (isFailedBranch({ toolResult, truthfulness, traceForDecision })) return "tool_failed";
  return "none";
}

function isExecutedBranch({ toolResult, childProviderRuns, childLlmRecords }) {
  return (
    isObject(toolResult) &&
    String(field(toolResult, "status") ?? "") !== "failed" &&
    childProviderRuns.length >= 1 &&
    childLlmRecords.length >= 1
  );
}

function isBlockedBranch({ toolResult, truthfulness, traceForDecision }) {
  return (
    !isObject(toolResult) &&
    (field(truthfulness, "execution_blocked") === true ||
      String(field(truthfulness, "first_blocking_gate") ?? "") !== "") &&
    Boolean(traceForDecision)
  );
}

function isFailedBranch({ toolResult, truthfulness, traceForDecision }) {
  return (
    isObject(toolResult) &&
    String(field(toolResult, "status") ?? "") === "failed" &&
    Boolean(traceForDecision) &&
    String(field(truthfulness, "tool_status") ?? "") === "failed"
  );
}

function receiptFacts(db, actionId) {
  const receipts = list(field(db, "receipts"));
  const actionReceipts = receipts.filter((receipt) => field(receipt, "action_id") === actionId);
  const actionReceipt = firstOrNull(actionReceipts);
  const receiptResult = parseJsonField(field(actionReceipt, "result")) ?? {};
  return {
    receipts,
    actionReceipts,
    actionReceipt,
    receiptResult,
    receiptTurnId: textField(receiptResult, "turn_id"),
  };
}

function authorFacts(interactions, sourceTurnId) {
  const userTurnId = sourceTurnId.includes(":agent:") ? sourceTurnId.split(":agent:")[0] : "";
  const userInteraction = interactions.find(
    (entry) => textField(entry.row, "role") === "user" && textField(entry.row, "turn_id") === userTurnId,
  );
  return { sourceAuthorText: textField(userInteraction?.content, "text") };
}

function childExecutionFacts(db, llmRecords, receiptTurnId, childRunId, wireFacts) {
  const childProviderRuns = list(field(db, "provider_runs")).filter(
    (row) => textField(row, "agent_run_id") === childRunId,
  );
  const childLlmRecords = list(llmRecords).filter((record) => field(record, "provider") === "slice_verify");
  const executedBody = wireFacts.executed_turn_result_body;
  const decisionBody = wireFacts.decision_turn_result_body;
  const truthfulness = field(executedBody, "truthfulness") ?? field(decisionBody, "truthfulness") ?? {};
  const toolResult = field(executedBody, "tool_result");
  const traceForDecision = decisionTraceFor(db, [receiptTurnId, childRunId]);
  return {
    childProviderRuns,
    childLlmRecords,
    executedBody,
    truthfulness,
    toolResult,
    pendingArtifactType: pendingArtifactType(executedBody),
    childExecutionBranch: childExecutionBranch({
      toolResult,
      truthfulness,
      childProviderRuns,
      childLlmRecords,
      traceForDecision,
    }),
  };
}

function driverFacts(driverLog) {
  const why = field(driverLog, "why");
  const whyBefore = numberValue(pathField(why, ["before", "llm_calls"]));
  const whyAfter = numberValue(pathField(why, ["after", "llm_calls"]));
  const duplicate = field(driverLog, "duplicate");
  const duplicateAck = field(duplicate, "duplicate_ack");
  const duplicateAckResponse = field(duplicateAck, "response");
  const restore = field(driverLog, "restore");
  const termination = field(driverLog, "termination") ?? field(field(driverLog, "sampling"), "termination");
  return {
    sourceDriverTurnId: textPath(driverLog, ["source", "turn_id"]),
    sourceDriverUserTurnId: textPath(driverLog, ["source", "user_turn_id"]),
    sourceDriverUserTurnIdRaw: field(field(driverLog, "source"), "user_turn_id"),
    clickAt: textPath(driverLog, ["source", "click_at"]),
    why: {
      opened: field(why, "opened"),
      attempts: field(why, "attempts"),
      llmCallsBefore: finiteOrNull(whyBefore),
      llmCallsAfter: finiteOrNull(whyAfter),
      delta: Number.isFinite(whyBefore) && Number.isFinite(whyAfter) ? whyAfter - whyBefore : null,
    },
    duplicate: {
      attempted: field(duplicate, "attempted"),
      clicked: field(duplicate, "clicked"),
      reason: field(duplicate, "reason"),
      delta: field(duplicate, "delta"),
      ack: duplicateAck,
      ackResponseActionStatus: field(duplicateAckResponse, "action_status"),
      ackResponseDuplicate: field(duplicateAckResponse, "duplicate"),
      ackActionStatus: field(duplicateAck, "action_status"),
      ackDuplicate: field(duplicateAck, "duplicate"),
    },
    restore: {
      resumed: field(restore, "resumed"),
      decisionTextVisible: field(restore, "decision_text_visible"),
      creativeResultVisible: field(restore, "creative_result_visible"),
      sourceCardClosed: field(restore, "source_card_closed"),
      restartDelta: field(restore, "restart_delta"),
      visibleTextSample: textField(restore, "visible_text_sample"),
    },
    sampling: field(driverLog, "sampling"),
    terminationLlmCalls: numberValue(field(termination, "llm_calls")),
    termination: termination,
  };
}

function canonFacts(checkpoints) {
  const beforeCanon = field(checkpoints, "click-before") ?? field(checkpoints, "start");
  const afterCanon = field(checkpoints, "decision-after") ?? field(checkpoints, "final");
  return {
    beforeCanon,
    afterCanon,
    canonAll: canonContentEqual(beforeCanon, afterCanon),
    canonWorks: canonWorksEqual(beforeCanon, afterCanon),
  };
}

function behaviorFacts(interactions, sourceInteraction, behaviorRef, receipts) {
  const sourceBehaviorState = field(field(sourceInteraction, "turn_result"), "behavior_state");
  const activeBehavior = field(sourceBehaviorState, "active");
  const activeStatus = field(activeBehavior, "lifecycle_status");
  const closure = behaviorHistoryEntry(interactions, behaviorRef);
  return {
    activeBehaviorRef: textField(activeBehavior, "behavior_id"),
    activeBehaviorStatus: activeStatus === null ? "awaiting_author" : String(activeStatus),
    behaviorReceipts: receipts.filter((receipt) => textField(receipt, "behavior_ref") === behaviorRef),
    closureStatus: textField(closure, "lifecycle_status"),
  };
}

function rejectFacts(db, receiptTurnId, sourceTurnId, closureStatus, childRun) {
  const rejectReceipts = list(field(db, "receipts")).filter(
    (receipt) => field(receipt, "action_type") === "reject_or_cancel_confirmation",
  );
  const rejectResult = parseJsonField(field(firstOrNull(rejectReceipts), "result")) ?? {};
  const rejectTrace = decisionTraceFor(db, [receiptTurnId, `${sourceTurnId}:author_action`]);
  return {
    rejectReceipts,
    rejectResult,
    rejectTrace,
    rejectTraceDecisionType: field(rejectTrace, "decision_type"),
    rejectClosureStatus: closureStatus,
    rejectChildRunStatus: field(childRun, "status"),
  };
}

function baseConfirmationFacts(input) {
  const spec = CONFIRMATION_MODES[input.mode];
  assert(spec, `未知 confirmation mode: ${input.mode}`);
  const sourceTurn = needsConfirmationTurnResult(input.wire);
  assert(sourceTurn, "wire 中未收到 needs_confirmation TurnResult（真实页面未触发）");
  const sourceBody = frameBody(sourceTurn) ?? {};
  const sourceTurnId = textField(sourceBody, "turn_id");
  const action = selectConfirmationAction(sourceBody, spec.action_type);
  const db = input.dbFacts ?? {};
  const receipt = receiptFacts(db, textField(action, "action_id"));
  const wireFacts = confirmationWireFacts(input.wire, {
    sourceTurn,
    sourceTurnId,
    action,
    receiptResult: receipt.receiptResult,
    driverLog: input.driverLog,
  });
  return { spec, sourceTurnId, action, db, receipt, wireFacts };
}

function sourceOwnershipFacts(db, wireFacts, sourceTurnId, interactions) {
  const sourceInteraction = interactionTurnResult(interactions, sourceTurnId);
  // 来源 run 只取已选中的持久 Interaction；wire 摘要只作可选事实，不参与来源选择。
  const sourceRunId = textField(field(sourceInteraction, "content"), "agent_run_id");
  const sourceWireRunId = field(field(wireFacts.needs_confirmation_body, "agent_run"), "run_id");
  const sourceRun = findById(field(db, "agent_runs"), sourceRunId);
  const sourceTrigger = parseJsonField(field(sourceRun, "trigger")) ?? {};
  return { sourceInteraction, sourceRunId, sourceWireRunId, sourceRun, sourceTrigger };
}

function childOwnershipFacts(db, receipt, action, sourceInteraction, interactions) {
  const childRunId = String(field(receipt.receiptResult, "run_id") ?? "");
  const childRun = findById(field(db, "agent_runs"), childRunId);
  const childTrigger = parseJsonField(field(childRun, "trigger")) ?? {};
  const behaviorRef = textField(action, "behavior_ref");
  return {
    childRunId,
    childRun,
    childTrigger,
    behaviorRef,
    behavior: behaviorFacts(interactions, sourceInteraction, behaviorRef, receipt.receipts),
  };
}

export function assembleConfirmationFacts(input) {
  const base = baseConfirmationFacts(input);
  const { db, receipt, wireFacts, sourceTurnId, action } = base;
  const interactions = parseInteractionRows(field(db, "interactions"));
  const source = sourceOwnershipFacts(db, wireFacts, sourceTurnId, interactions);
  const child = childOwnershipFacts(db, receipt, action, source.sourceInteraction, interactions);
  const { childRunId, childRun, childTrigger, behaviorRef, behavior } = child;
  const childExecution = childExecutionFacts(db, input.llmRecords, receipt.receiptTurnId, childRunId, wireFacts);
  const driver = driverFacts(input.driverLog);
  const canonical = canonFacts(input.checkpoints);
  const author = authorFacts(interactions, sourceTurnId);
  const rejected = rejectFacts(db, receipt.receiptTurnId, sourceTurnId, behavior.closureStatus, childRun);
  return {
    mode: input.mode,
    wire: input.wire,
    db,
    cleanup: input.cleanup,
    runtime: input.runtime,
    sourceTurnId,
    action,
    actionId: textField(action, "action_id"),
    behaviorRef,
    actionReceipts: receipt.actionReceipts,
    actionReceiptId: textField(receipt.actionReceipt, "id"),
    receiptResult: receipt.receiptResult,
    receiptTurnId: receipt.receiptTurnId,
    receipts: receipt.receipts,
    childRuns: list(field(db, "agent_runs")).filter(
      (row) => textField(row, "profile_ref") === "tool_confirmation_v1",
    ),
    receiptApproval: receiptApproval(receipt.receiptResult),
    sourceInteraction: source.sourceInteraction,
    sourceRunId: source.sourceRunId,
    sourceWireRunId: source.sourceWireRunId,
    sourceRunStatus: textField(source.sourceRun, "status"),
    childRunId,
    childRun,
    childRunStatus: textField(childRun, "status"),
    childProfileRef: textField(childRun, "profile_ref"),
    childRunMode: textField(childRun, "run_mode"),
    childParentTurnRef: textField(childRun, "parent_turn_ref"),
    childTriggerRaw: childTrigger,
    childTrigger: {
      receiptId: textField(childTrigger, "receipt_id"),
      kind: textField(childTrigger, "kind"),
      sourceRunId: textField(childTrigger, "source_run_id"),
      behaviorRef: textField(childTrigger, "behavior_ref"),
    },
    sourceHandoffRaw: field(source.sourceTrigger, "handoff") ?? {},
    sourceHandoff: {
      receiptId: textField(field(source.sourceTrigger, "handoff"), "receipt_id"),
      successorRunId: textField(field(source.sourceTrigger, "handoff"), "successor_run_id"),
    },
    receiptSourceRunId: textField(receipt.receiptResult, "source_run_id"),
    ...wireFacts,
    ...behavior,
    ...childExecution,
    ...driver,
    ...canonical,
    ...author,
    ...rejected,
    dbAgentEvents: normalizeAgentEvents(field(db, "agent_events")),
  };
}
