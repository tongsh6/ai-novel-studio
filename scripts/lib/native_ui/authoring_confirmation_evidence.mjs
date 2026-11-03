// B71 §16.14 工具确认/拒绝原生场景证据与判据（C1–C11，缺证据不得 PASS）。
//
// 场景：真实作者高风险请求 → needs_confirmation（awaiting_author behavior +
// confirm_before_execute/reject_or_cancel_confirmation）→ 作者点击确认/拒绝（按用户
// 可见语义 + 所属消息块定位）→ 确认子执行 / 拒绝零副作用 → Why（必须真正打开，前后
// Provider/llm-calls delta=0）→ 重复点击幂等 → 重启恢复（决定/创作结果可见 + 零重放
// delta）→ 终止观测（app/端口/llm-calls 停止）。
//
// 判据硬门禁（独立复核 P0-A/P0-B/P1 修复）：
// - C5 幂等：必须 duplicate 分支真实成立（attempted+duplicate ack，或按钮不可见/disabled
//   且 child run 唯一 + provider/agent_runs/receipts/llm-calls delta=0），否则 fail。
// - C6 拒绝零副作用：采样窗口=点击前→收到决定后（action-scoped），delta 非 null 且全 0；
//   receipt decision=CANCELLED/decided_by=author；decision_traces.decision_type=cancel_waiting。
// - C9 Why：why.opened===true 且 llm-calls 前后实测值、delta=0；null 一律 fail。
// - C10 恢复：决定/创作结果 AX 可见、source 卡关闭、重启前后 provider/agent_runs/receipts/
//   llm-calls delta=0。
// - C11 清理：cleanup remaining=[]、process_observation 无 EPERM 降级；并在批次运行后实测
//   app 进程=0、4657/4661 不监听、llm-calls 与 driver 终止观测一致（不再增长）。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

export function parseJsonField(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// 确认卡所属消息块定位：用确认卡用户可见文案行 + 真实按钮名；复用 pending 消息块模型。
export function locateConfirmationButton(nodes, { label, cardTitle, cardBody, knownItems = [] } = {}) {
  if (typeof cardTitle !== "string" || cardTitle.trim() === "") return { ok: false, reason: "card_evidence_missing" };
  if (typeof cardBody !== "string" || cardBody.trim() === "") return { ok: false, reason: "card_evidence_missing" };
  const known = Array.isArray(knownItems) && knownItems.length > 0 ? knownItems : [cardTitle, cardBody];
  return locateScopedButton(nodes, { itemTitle: cardTitle, itemBody: cardBody, label, knownItems: known });
}

// 从 AX 纯文本中提取确认卡可定位文案行（「需要确认」标题行 + 块内唯一正文行）。
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
// 真实动作形状没有 source_turn_ref（候选动作才有）；存在时才校验一致性。
export function selectConfirmationAction(turnResult, actionType) {
  const turnId = String(turnResult?.turn_id ?? "");
  assert(turnId !== "", "needs_confirmation TurnResult 缺 turn_id");
  const matches = list(turnResult.available_actions).filter((action) => action?.action_type === actionType);
  assert.equal(matches.length, 1, `confirmation action ${actionType} 必须唯一，实测 ${matches.length}`);
  const action = matches[0];
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
      list(frameBody(record)?.available_actions).some((action) => action?.action_type === "confirm_before_execute"),
  );
}

// 点击后确认子执行帧：带真实 tool_result 的 received turn_result（时间窗按点击起点之前）。
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

// ── wire facts ────────────────────────────────────────────────────────────────
function replyBodyOf(record) {
  const body = frameBody(record) ?? {};
  return body.response ?? body;
}

export function confirmationWireFacts(wire, { sourceTurnId, action, receiptResult = {}, driverLog = null } = {}) {
  const needs = needsConfirmationTurnResult(wire);
  const sentAction = list(wire).find(
    (record) =>
      record?.direction === "sent" &&
      frameEvent(record) === "author_action" &&
      frameBody(record)?.action?.action_id === action?.action_id &&
      frameBody(record)?.action?.action_type === action?.action_type,
  );
  const sentBody = sentAction ? frameBody(sentAction)?.action ?? null : null;
  const ref = sentAction?.frame?.[1] ?? null;
  const joinRef = sentAction?.frame?.[0] ?? null;
  const ackReplies = list(wire).filter(
    (record) =>
      record?.direction === "received" &&
      Array.isArray(record.frame) &&
      record.frame[3] === "phx_reply" &&
      record.frame[1] === ref &&
      record.frame[0] === joinRef,
  );
  const ack = ackReplies.length === 1 ? ackReplies[0] : null;
  const ackBody = ack ? frameBody(ack) ?? {} : null;
  const ackResponse = ackBody ? ackBody.response ?? ackBody : null;
  const actionResultFrame = list(wire).find(
    (record) =>
      record?.direction === "received" &&
      frameEvent(record) === "action_result" &&
      frameBody(record)?.action_id === action?.action_id &&
      frameBody(record)?.action_type === action?.action_type,
  );
  const clickAt = String(driverLog?.source?.click_at ?? "");
  const receiptTurnId = String(receiptResult?.turn_id ?? "");
  const decisionTurn = receiptTurnId
    ? list(wire).find(
        (record) =>
          record?.direction === "received" &&
          frameEvent(record) === "turn_result" &&
          String(frameBody(record)?.turn_id ?? "") === receiptTurnId,
      ) ?? null
    : list(wire).find(
        (record) =>
          record?.direction === "received" &&
          frameEvent(record) === "turn_result" &&
          String(frameBody(record)?.parent_turn_id ?? "") === String(sourceTurnId ?? ""),
      ) ?? null;
  const executedTurn = clickAt
    ? executedConfirmationTurnResult(wire, clickAt)
    : list(wire).find(
        (record) =>
          record?.direction === "received" &&
          Array.isArray(record.frame) &&
          record.frame[3] === "turn_result" &&
          String(frameBody(record)?.turn_id ?? "").startsWith(String(sourceTurnId ?? "")) &&
          frameBody(record)?.tool_result !== null &&
          frameBody(record)?.tool_result !== undefined,
      ) ?? null;
  const userTurnId = String(driverLog?.source?.user_turn_id ?? "");
  const rejectTurn = clickAt ? rejectConfirmationTurnResult(wire, clickAt, { sourceTurnId, userTurnId }) : null;
  return {
    needs_confirmation_body: needs ? frameBody(needs) : null,
    sent_action_body: sentBody,
    ack_count: ackReplies.length,
    ack_body: ackBody,
    ack_response: ackResponse,
    action_result_body: actionResultFrame ? frameBody(actionResultFrame) : null,
    decision_turn_result_body: decisionTurn ? frameBody(decisionTurn) : null,
    executed_turn_result_body: executedTurn ? frameBody(executedTurn) : null,
    reject_turn_result_body: rejectTurn ? frameBody(rejectTurn) : null,
    click_at: clickAt || null,
  };
}

// ── DB facts（只读）────────────────────────────────────────────────────────────
export function readConfirmationDbFacts(dir) {
  return withDb(dir, (db) => {
    const count = (table) => {
      try {
        return Number(all(db, `SELECT COUNT(*) AS c FROM ${table}`)[0]?.c ?? 0);
      } catch {
        return 0;
      }
    };
    const rows = (table) => {
      try {
        return all(db, `SELECT * FROM ${table} ORDER BY inserted_at, id`);
      } catch {
        return [];
      }
    };
    return {
      receipts: rows("author_action_receipts"),
      agent_runs: rows("agent_runs"),
      interactions: rows("interactions"),
      provider_runs: rows("provider_runs"),
      agent_events: rows("agent_events"),
      decision_traces: rows("decision_traces"),
      mutations_count: count("mutations"),
      memory_count: count("memory_items"),
      receipts_count: count("author_action_receipts"),
      provider_runs_count: count("provider_runs"),
      agent_runs_count: count("agent_runs"),
    };
  });
}

function interactionTurnResult(interactions, turnId) {
  for (const row of list(interactions)) {
    if (row?.turn_id !== turnId) continue;
    const content = parseJsonField(row.content);
    const turnResult = isObject(content?.turn_result) ? content.turn_result : null;
    if (turnResult) return { row, content, turn_result: turnResult };
  }
  return null;
}

function behaviorHistoryEntry(interactions, behaviorRef) {
  for (const row of list(interactions)) {
    const content = parseJsonField(row?.content) ?? {};
    const history = content?.turn_result?.behavior_state?.history;
    const entry = list(history).find(
      (candidate) =>
        String(candidate?.behavior_id ?? "") === String(behaviorRef) &&
        ["resolved", "cancelled"].includes(String(candidate?.lifecycle_status ?? "")),
    );
    if (entry) return entry;
  }
  return null;
}

function canonTableHashes(checkpoint) {
  return checkpoint?.authoring_canon?.tables ?? null;
}

function canonContentEqual(left, right) {
  const leftTables = canonTableHashes(left);
  const rightTables = canonTableHashes(right);
  if (!isObject(leftTables) || !isObject(rightTables)) return { equal: false, changed: [], reason: "canon_evidence_missing" };
  const names = new Set([...Object.keys(leftTables), ...Object.keys(rightTables)]);
  const changed = [];
  for (const name of names) {
    const a = leftTables[name];
    const b = rightTables[name];
    if (!a || !b || a.row_count !== b.row_count || a.canon_sha256 !== b.canon_sha256) changed.push(name);
  }
  return { equal: changed.length === 0, changed };
}

function countLlmCallsIn(dir) {
  const logDir = path.join(dir, "llm-calls");
  if (!fs.existsSync(logDir)) return 0;
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .reduce(
      (total, file) =>
        total + fs.readFileSync(path.join(logDir, file), "utf8").split("\n").filter((line) => line.includes("{")).length,
      0,
    );
}

function countAppProcesses() {
  try {
    return execFileSync("pgrep", ["-f", "AI Novel Studio.app/Contents/MacOS/app"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

function portListening(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split("\n").filter((line) => line.includes("LISTEN")).length > 0;
  } catch {
    return false;
  }
}

export function runtimeAfterBatch(dir) {
  return {
    app_processes: countAppProcesses(),
    ports: { backend_4657: portListening(4657), transport_4661: portListening(4661) },
    llm_calls: countLlmCallsIn(dir),
  };
}

function receiptApproval(receiptResult) {
  return {
    approval_policy_ref: receiptResult?.approval_policy_ref ?? null,
    risk_class: receiptResult?.risk_class ?? null,
    decision: receiptResult?.decision ?? null,
    decided_by: receiptResult?.decided_by ?? null,
    target_artifact_ref: receiptResult?.target_artifact_ref ?? null,
  };
}

function decisionTraceFor(dbFacts, turnIds) {
  const wanted = new Set(turnIds.filter(Boolean).map(String));
  return list(dbFacts?.decision_traces).find((trace) => {
    const turnId = String(trace?.turn_id ?? "");
    if (!turnId) return false;
    if (wanted.has(turnId)) return true;
    return [...wanted].some((want) => turnId.includes(want) || want.includes(turnId));
  });
}

export function evaluateConfirmation({
  mode,
  wire,
  dbFacts,
  checkpoints,
  driverLog = null,
  cleanup = null,
  llmRecords = [],
  dir = null,
}) {
  const spec = CONFIRMATION_MODES[mode];
  assert(spec, `未知 confirmation mode: ${mode}`);
  const sourceTurn = needsConfirmationTurnResult(wire);
  assert(sourceTurn, "wire 中未收到 needs_confirmation TurnResult（真实页面未触发）");
  const sourceBody = frameBody(sourceTurn);
  const sourceTurnId = String(sourceBody.turn_id ?? "");
  const action = selectConfirmationAction(sourceBody, spec.action_type);
  const db = dbFacts ?? {};
  const receipts = list(db.receipts);
  const actionReceipts = receipts.filter((receipt) => receipt.action_id === action.action_id);
  const actionReceipt = actionReceipts[0] ?? null;
  const receiptResult = parseJsonField(actionReceipt?.result) ?? {};
  const facts = confirmationWireFacts(wire, { sourceTurnId, action, receiptResult, driverLog });
  const agentRuns = list(db.agent_runs);
  const sourceInteraction = interactionTurnResult(db.interactions, sourceTurnId);
  const sourceRunId = String(
    facts.needs_confirmation_body?.agent_run?.run_id ?? sourceInteraction?.content?.agent_run_id ?? "",
  );
  const receiptTurnId = String(receiptResult?.turn_id ?? "");
  const clickAt = String(driverLog?.source?.click_at ?? "");
  const why = driverLog?.why ?? null;
  const duplicate = driverLog?.duplicate ?? null;
  const restore = driverLog?.restore ?? null;
  const termination = driverLog?.termination ?? driverLog?.sampling?.termination ?? null;
  const sampling = driverLog?.sampling ?? null;
  const childRunId = String(receiptResult?.run_id ?? "");
  const childRun = agentRuns.find((row) => String(row.id) === childRunId) ?? null;
  const childTrigger = parseJsonField(childRun?.trigger) ?? {};
  const behaviorRef = String(action.behavior_ref ?? "");

  // C1 source 真实持久（并与本批 user turn 关联）。
  const sourcePersisted =
    Boolean(sourceInteraction) &&
    String(sourceInteraction?.turn_result?.status ?? "") === "needs_confirmation" &&
    String(sourceInteraction?.content?.agent_run_id ?? "") !== "";
  const sourceLinked =
    String(driverLog?.source?.turn_id ?? "") === sourceTurnId &&
    String(driverLog?.source?.user_turn_id ?? "") !== "";
  const c1 = {
    ok: sourcePersisted && sourceLinked,
    reason: sourcePersisted && sourceLinked ? null : "source_persisted_turn_missing_or_unlinked",
    detail: { turn_id: sourceTurnId, source_run_id: sourceRunId, user_turn_id: driverLog?.source?.user_turn_id ?? null },
  };

  // C2 确认受理身份：reply ok/received/action_status + trigger 字段 + receipt/turn 交叉 + sent source_turn_ref。
  const ackResponse = facts.ack_response;
  const ackTrigger = ackResponse?.trigger ?? {};
  const ackTurnIds = list(ackResponse?.turn_results).map((entry) => String(entry?.turn_id ?? ""));
  const c2 = {
    ok:
      facts.ack_count === 1 &&
      String(facts.ack_body?.status ?? "") === "ok" &&
      ackResponse?.received === true &&
      typeof ackResponse?.action_status === "string" &&
      ackResponse.action_status !== "" &&
      String(ackTrigger?.action_id ?? "") === action.action_id &&
      String(ackTrigger?.action_type ?? "") === action.action_type &&
      String(ackTrigger?.receipt_id ?? "") === String(actionReceipt?.id ?? "") &&
      String(ackTrigger?.behavior_ref ?? "") === behaviorRef &&
      String(ackResponse?.receipt_id ?? "") === String(actionReceipt?.id ?? "") &&
      (receiptTurnId === "" || ackTurnIds.includes(receiptTurnId)) &&
      String(facts.sent_action_body?.source_turn_ref ?? "") === sourceTurnId,
    reason: null,
    detail: {
      action_id: action.action_id,
      ack_status: facts.ack_body?.status ?? null,
      received: ackResponse?.received ?? null,
      action_status: ackResponse?.action_status ?? null,
      trigger: ackTrigger,
      ack_receipt_id: ackResponse?.receipt_id ?? null,
      ack_turn_ids: ackTurnIds,
      sent_source_turn_ref: facts.sent_action_body?.source_turn_ref ?? null,
    },
  };
  if (!c2.ok) c2.reason = "confirmation_ack_or_result_identity_mismatch";

  // C3 作者动作 run：handoff 新 AgentRun（tool_confirmation_v1）+ source run handoff。
  const runRow = agentRuns.find((row) => String(row.id) === sourceRunId) ?? null;
  const sourceTrigger = parseJsonField(runRow?.trigger) ?? {};
  const handoff = sourceTrigger?.handoff ?? {};
  const c3 = {
    ok:
      Boolean(childRun) &&
      childRunId !== sourceRunId &&
      String(childRun?.profile_ref ?? "") === "tool_confirmation_v1" &&
      String(childRun?.run_mode ?? "") === "bounded" &&
      String(childRun?.parent_turn_ref ?? "") === sourceTurnId &&
      String(childRun?.status ?? "") === "completed" &&
      String(childTrigger?.receipt_id ?? "") === String(actionReceipt?.id ?? "") &&
      String(childTrigger?.kind ?? "") === "author_action" &&
      String(childTrigger?.source_run_id ?? "") === sourceRunId &&
      String(childTrigger?.behavior_ref ?? "") === behaviorRef &&
      String(receiptResult?.source_run_id ?? "") === sourceRunId &&
      String(handoff?.receipt_id ?? "") === String(actionReceipt?.id ?? "") &&
      String(handoff?.successor_run_id ?? "") === childRunId &&
      String(runRow?.status ?? "") === "completed",
    reason: null,
    detail: {
      source_run_id: sourceRunId,
      child_run_id: childRunId,
      child_profile_ref: childRun?.profile_ref ?? null,
      child_parent_turn_ref: childRun?.parent_turn_ref ?? null,
      child_trigger_kind: childTrigger?.kind ?? null,
      source_handoff_receipt_id: handoff?.receipt_id ?? null,
      source_handoff_successor: handoff?.successor_run_id ?? null,
    },
  };
  if (!c3.ok) c3.reason = "author_action_run_not_bound_to_receipt";

  // C4 行为唯一消费：active awaiting_author + receipt.behavior_ref 唯一 + history 关闭。
  const sourceBehaviorState = sourceInteraction?.turn_result?.behavior_state ?? null;
  const activeBehavior = sourceBehaviorState?.active ?? null;
  const activeBehaviorRef = String(activeBehavior?.behavior_id ?? "");
  const behaviorReceipts = receipts.filter((receipt) => String(receipt.behavior_ref ?? "") === behaviorRef);
  const closure = behaviorHistoryEntry(db.interactions, behaviorRef);
  const closureStatus = String(closure?.lifecycle_status ?? "");
  const c4 = {
    ok:
      activeBehaviorRef === behaviorRef &&
      String(activeBehavior?.lifecycle_status ?? "awaiting_author") === "awaiting_author" &&
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

  // C5 重复幂等（硬门禁）：attempted+duplicate ack，或 not_actionable + child run 唯一 + 零 delta。
  const childRuns = agentRuns.filter((row) => String(row?.profile_ref ?? "") === "tool_confirmation_v1");
  const dupAck = duplicate?.duplicate_ack ?? null;
  const dupAckOk =
    Boolean(dupAck) &&
    (String(dupAck?.response?.action_status ?? "") === "duplicate" ||
      dupAck?.response?.duplicate === true ||
      String(dupAck?.action_status ?? "") === "duplicate" ||
      dupAck?.duplicate === true);
  const attemptedOk = duplicate?.attempted === true && duplicate?.clicked === true && dupAckOk;
  const dupDelta = duplicate?.delta ?? null;
  const deltaAllZero = (delta) =>
    isObject(delta) &&
    ["provider_runs", "agent_runs", "receipts", "llm_calls"].every((key) => Number(delta[key]) === 0);
  const notActionableOk =
    duplicate?.attempted === false &&
    typeof duplicate?.reason === "string" &&
    duplicate.reason.startsWith("not_actionable:") &&
    deltaAllZero(dupDelta);
  const c5 = {
    ok: actionReceipts.length === 1 && childRuns.length === 1 && (attemptedOk || notActionableOk),
    reason: null,
    detail: {
      action_receipts: actionReceipts.length,
      child_runs: childRuns.length,
      duplicate_attempted: duplicate?.attempted ?? null,
      duplicate_reason: duplicate?.reason ?? null,
      duplicate_ack_observed: Boolean(dupAckOk),
      duplicate_delta: dupDelta,
    },
  };
  if (!c5.ok) {
    c5.reason =
      actionReceipts.length !== 1
        ? "duplicate_receipt"
        : childRuns.length !== 1
          ? "child_run_not_unique"
          : "duplicate_not_exercised_or_delta_nonzero";
  }

  // C6 拒绝零副作用（reject mode，action-scoped 采样 click_before→decision_after；null 不 pass）。
  const canon = canonContentEqual(checkpoints?.start, checkpoints?.final);
  const clickBefore = sampling?.click_before ?? null;
  const decisionAfter = sampling?.decision_after ?? null;
  const scopedDelta = (key) =>
    isObject(clickBefore) && isObject(decisionAfter) ? Number(decisionAfter[key]) - Number(clickBefore[key]) : null;
  const rejectReceipts = receipts.filter((receipt) => receipt.action_type === "reject_or_cancel_confirmation");
  const rejectResult = parseJsonField(rejectReceipts[0]?.result) ?? {};
  const rejectTrace = decisionTraceFor(db, [receiptTurnId, `${sourceTurnId}:author_action`]);
  const c6 =
    mode === "reject"
      ? {
          ok:
            canon.equal &&
            scopedDelta("provider_runs") === 0 &&
            scopedDelta("agent_runs") === 0 &&
            scopedDelta("receipts") <= 1 &&
            scopedDelta("llm_calls") === 0 &&
            Number(db.mutations_count ?? 0) === 0 &&
            rejectReceipts.length === 1 &&
            String(rejectResult?.decision ?? "") === "CANCELLED" &&
            String(rejectResult?.decided_by ?? "") === "author" &&
            String(rejectTrace?.decision_type ?? "") === "cancel_waiting" &&
            closureStatus === "cancelled",
          reason: null,
          detail: {
            canon,
            scoped_delta: {
              provider_runs: scopedDelta("provider_runs"),
              agent_runs: scopedDelta("agent_runs"),
              receipts: scopedDelta("receipts"),
              llm_calls: scopedDelta("llm_calls"),
              mutations_total: Number(db.mutations_count ?? 0),
            },
            reject_receipts: rejectReceipts.length,
            reject_decision: rejectResult?.decision ?? null,
            reject_decided_by: rejectResult?.decided_by ?? null,
            decision_trace_type: rejectTrace?.decision_type ?? null,
            closure_status: closureStatus,
          },
        }
      : { ok: null, reason: "confirm_mode", detail: {} };
  if (c6.ok === false) c6.reason = "reject_side_effect_or_receipt_invalid";

  // C7 确认子执行（executed / gate-blocked / tool-failed 三分支）。
  const executedBody = facts.executed_turn_result_body;
  const childProviderRuns = list(db.provider_runs).filter((row) => String(row.agent_run_id ?? "") === childRunId);
  const childLlmRecords = list(llmRecords).filter((record) => record.provider === "slice_verify");
  const truthfulness = executedBody?.truthfulness ?? facts.decision_turn_result_body?.truthfulness ?? {};
  const toolResult = executedBody?.tool_result ?? null;
  const traceForDecision = decisionTraceFor(db, [receiptTurnId, childRunId]);
  const executedBranch =
    isObject(toolResult) &&
    String(toolResult?.status ?? "") !== "failed" &&
    childProviderRuns.length >= 1 &&
    childLlmRecords.length >= 1;
  const blockedBranch =
    !isObject(toolResult) &&
    (truthfulness?.execution_blocked === true || String(truthfulness?.first_blocking_gate ?? "") !== "") &&
    Boolean(traceForDecision);
  const failedBranch =
    isObject(toolResult) &&
    String(toolResult?.status ?? "") === "failed" &&
    Boolean(traceForDecision) &&
    String(truthfulness?.tool_status ?? "") === "failed";
  const c7 =
    mode === "confirm"
      ? {
          ok: executedBranch || blockedBranch || failedBranch,
          reason: null,
          detail: {
            executed_turn_id: executedBody?.turn_id ?? null,
            tool_name: toolResult?.tool_name ?? null,
            tool_status: toolResult?.status ?? null,
            pending_artifact_type: list(executedBody?.adoption_state?.pending)[0]?.artifact_type ?? null,
            child_run_id: childRunId,
            child_provider_runs: childProviderRuns.length,
            llm_records: childLlmRecords.length,
            branch: executedBranch ? "executed" : blockedBranch ? "gate_blocked" : failedBranch ? "tool_failed" : "none",
            truthfulness,
          },
        }
      : { ok: null, reason: "reject_mode", detail: {} };
  if (c7.ok === false) c7.reason = "confirmed_child_execution_missing";

  // C8 作者字节：恰好一条非 application-data 的 user 消息逐字节等于作者原话；不得冒充作者。
  const userTurnId = String(sourceTurnId).includes(":agent:") ? String(sourceTurnId).split(":agent:")[0] : "";
  const userInteraction = list(db.interactions).find(
    (row) => String(row.role ?? "") === "user" && String(row.turn_id ?? "") === userTurnId,
  );
  const userContent = parseJsonField(userInteraction?.content) ?? {};
  const sourceAuthorText = String(userContent?.text ?? "");
  // 每条真实请求必须恰好一条非 application-data 的 user 消息逐字节等于作者原话；
  // application-data 消息不得被当作作者原话；按钮/确认文案不得以 author 身份出现。
  const buttonPattern = /确认执行|拒绝|保存为章节正文|已确认「prose_writing」/u;
  const perRecord = childLlmRecords.map((record) => {
    const messages = record?.request_body?.messages ?? record?.request?.body?.messages ?? [];
    const userMessages = list(messages)
      .filter((message) => message?.role === "user")
      .map((message) => (typeof message.content === "string" ? message.content : ""));
    const appData = userMessages.filter((content) => content.includes("【应用数据"));
    const author = userMessages.filter((content) => !content.includes("【应用数据"));
    return {
      author_messages: author.length,
      exact: author.filter((content) => content === sourceAuthorText).length,
      button_leak: author.some((content) => buttonPattern.test(content)),
      app_data: appData.length,
    };
  });
  const recordsOk = childLlmRecords.length >= 1 && perRecord.every((entry) => entry.exact === 1 && !entry.button_leak && entry.author_messages === 1);
  const c8 = {
    ok: sourceAuthorText !== "" && recordsOk,
    reason: null,
    detail: {
      source_author_chars: sourceAuthorText.length,
      records_checked: perRecord.length,
      exact_matches_per_record: perRecord.map((entry) => entry.exact),
      author_messages_per_record: perRecord.map((entry) => entry.author_messages),
      application_data_per_record: perRecord.map((entry) => entry.app_data),
      button_text_leaked_as_author: perRecord.some((entry) => entry.button_leak),
    },
  };
  if (!c8.ok) c8.reason = "author_bytes_not_preserved_or_misattributed";

  // C9 Why（硬门禁）：必须真正打开 + llm-calls 前后实测 + delta=0 + receipt 决定。
  const whyBefore = Number(why?.before?.llm_calls);
  const whyAfter = Number(why?.after?.llm_calls);
  const whyDelta = Number.isFinite(whyBefore) && Number.isFinite(whyAfter) ? whyAfter - whyBefore : null;
  const receiptApprovalOk =
    mode === "confirm"
      ? String(receiptResult?.decision ?? "") === "CONFIRMED" && String(receiptResult?.decided_by ?? "") === "author"
      : String(receiptResult?.decision ?? "") === "CANCELLED" &&
        String(receiptResult?.decided_by ?? "") === "author" &&
        String(rejectTrace?.decision_type ?? "") === "cancel_waiting";
  const c9 = {
    ok: why?.opened === true && whyDelta === 0 && receiptApprovalOk,
    reason: null,
    detail: {
      why_opened: why?.opened ?? false,
      why_attempts: why?.attempts ?? null,
      llm_calls_before: Number.isFinite(whyBefore) ? whyBefore : null,
      llm_calls_after: Number.isFinite(whyAfter) ? whyAfter : null,
      llm_calls_delta: whyDelta,
      approval_policy_ref: receiptApproval(receiptResult).approval_policy_ref,
      risk_class: receiptApproval(receiptResult).risk_class,
      decision: receiptResult?.decision ?? null,
      decided_by: receiptResult?.decided_by ?? null,
    },
  };
  if (!c9.ok) c9.reason = "why_not_opened_or_provider_delta_nonzero";

  // C10 恢复：决定/创作结果可见 + source 卡关闭 + 重启前后零重放。
  const restartDelta = restore?.restart_delta ?? null;
  const c10 = {
    ok:
      restore?.resumed === true &&
      restore?.decision_text_visible === true &&
      restore?.source_card_closed === true &&
      (mode === "reject" || restore?.creative_result_visible === true) &&
      deltaAllZero(restartDelta),
    reason: null,
    detail: {
      resumed: restore?.resumed ?? null,
      decision_text_visible: restore?.decision_text_visible ?? null,
      creative_result_visible: restore?.creative_result_visible ?? null,
      source_card_closed: restore?.source_card_closed ?? null,
      restart_delta: restartDelta,
    },
  };
  if (!c10.ok) c10.reason = "restore_evidence_or_zero_replay_missing";

  // C11 清理（强化）：remaining=[]、process_observation 有效（EPERM 降级不 pass）、批次后
  // 实测 app=0/端口不监听/llm-calls 与 driver 终止观测一致。
  const remaining = list(cleanup?.remaining);
  const fallback = cleanup?.process_observation?.fallback_reason ?? null;
  const runtime = dir ? runtimeAfterBatch(dir) : null;
  const terminationLlm = Number(termination?.llm_calls);
  const llmStopped = Boolean(runtime) && Number.isFinite(terminationLlm) && Number(runtime.llm_calls) === terminationLlm;
  // 运行态停止必须由独立实测证明（app=0/端口不监听/llm-calls 不再增长）；cleanup 自身的
  // EPERM 降级只记 unverified，不能替代独立检查，也不能单独否决独立检查通过的结果。
  const runtimeStopped =
    Boolean(runtime) &&
    runtime.app_processes === 0 &&
    runtime.ports.backend_4657 === false &&
    runtime.ports.transport_4661 === false &&
    llmStopped;
  const c11 = {
    // C11 以**批次完成（cleanup 之后）**的终止证据为准：supervisor 的
    // native-app-cleanup.json（remaining=[]）+ verify 时实测无 app/端口/llm-calls 增长。
    // driver 的 termination 快照只是「driver 结束时观测」事实（当时 app 仍运行是预期的），
    // 不作为「批次后未清理」判据；它仅用于 llm-calls 停止增长的基线。
    ok: remaining.length === 0 && runtimeStopped,
    reason: null,
    detail: {
      remaining: remaining.length,
      process_observation: cleanup?.process_observation ?? null,
      cleanup_observation_degraded: fallback !== null,
      runtime_after_batch: runtime,
      llm_calls_stopped: llmStopped,
      llm_calls_baseline_termination: Number.isFinite(terminationLlm) ? terminationLlm : null,
      runtime_stopped: runtimeStopped,
      driver_termination_snapshot: {
        // 仅记录 driver 结束时的观测；此时 supervisor cleanup 尚未发生，app 仍运行属预期。
        at: termination?.at ?? null,
        app_processes: termination?.app_processes ?? null,
        ports: termination?.ports ?? null,
        llm_calls: Number.isFinite(terminationLlm) ? terminationLlm : null,
      },
    },
  };
  if (!c11.ok) c11.reason = "cleanup_unverified_or_runtime_not_stopped";

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
  const approval = receiptApproval(receiptResult);
  return {
    schema: CONFIRMATION_CHECK_SCHEMA,
    mode,
    source_turn_id: sourceTurnId,
    source_run_id: sourceRunId,
    child_run_id: childRunId,
    click_at: clickAt || null,
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
      canon,
      executed_tool: toolResult?.tool_name ?? null,
      pending_artifact_type: list(executedBody?.adoption_state?.pending)[0]?.artifact_type ?? null,
      approval,
      why_delta: whyDelta,
      duplicate_delta: dupDelta,
      restart_delta: restartDelta,
      runtime_after_batch: runtime,
    },
    model_behavior: {
      executed: executedBody
        ? {
            turn_id: executedBody?.turn_id ?? null,
            tool_name: toolResult?.tool_name ?? null,
            tool_status: toolResult?.status ?? null,
            pending_artifact_type: list(executedBody?.adoption_state?.pending)[0]?.artifact_type ?? null,
            truthfulness,
            branch: c7.detail?.branch ?? null,
          }
        : null,
      gate_blocked: Boolean(c7.detail?.branch === "gate_blocked"),
      tool_failed: Boolean(c7.detail?.branch === "tool_failed"),
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
    dir,
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
    `B71 confirmation 判据通过: mode=${mode} source_turn=${result.source_turn_id} executed=${result.measured.executed_tool ?? "-"} why_delta=${result.measured.why_delta}`,
  );
  return { result, summary };
}
