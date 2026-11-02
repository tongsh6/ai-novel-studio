// B71 CP3b 实模驱动：run 终局等待与模型行为分类（纯函数，不启动 GUI/Mix）。
//
// 真实模型行为不确定：可能不调用工具直接回复、调用一次或多次、ask_author 停等。
// 驱动只等待「本 turn 的 run 终局」并如实分类，不轮询固定回复文本、不假设调用次数。
import { frameBody, frameEvent, frameOf } from "./scenario_evidence.mjs";

export const LIVE_RUN_SCHEMA = "b71-live-run/v1";

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "awaiting_author", "needs_confirmation"]);
const FAILURE_RUN_STATES = new Set(["failed", "cancelled", "run_failed", "run_cancelled"]);

function nonBlank(value) {
  return typeof value === "string" && value.trim() !== "";
}

function runIdOf(body) {
  return body?.agent_run?.run_id ?? body?.run_id ?? body?.run_ref ?? null;
}

// 从 wire 帧判定本 turn 的 run 终局；只接受 received 方向与 owning turn/run 绑定。
export function wireTerminal(wire, { turnId, runId = null, since = null } = {}) {
  if (!Array.isArray(wire) || !nonBlank(turnId)) return null;
  const records = wire.filter((record) => {
    if (record?.direction !== "received") return false;
    if (!frameOf(record)) return false;
    if (typeof since === "string" && typeof record.at === "string" && record.at < since) return false;
    return true;
  });
  for (const record of records) {
    const event = frameEvent(record);
    const body = frameBody(record) ?? {};
    if (event === "turn_result") {
      const bodyTurnId = body.turn_id;
      const parentTurn = body.agent_run?.parent_turn_ref ?? body.parent_turn_id ?? null;
      const bodyRunId = runIdOf(body);
      const turnMatches = bodyTurnId === turnId || parentTurn === turnId;
      if (!turnMatches) continue;
      if (runId && bodyRunId !== runId) continue;
      const status = String(body.agent_run?.status ?? body.status ?? "");
      if (FAILURE_RUN_STATES.has(status) || body.status === "failed") {
        return { kind: "failed", status: status || "failed", record, body };
      }
      if (body.status === "needs_confirmation") {
        return { kind: "needs_confirmation", status: "needs_confirmation", record, body };
      }
      if (body.agent_run?.status === "completed") {
        return { kind: "completed", status: "completed", record, body };
      }
      continue;
    }
    if (event === "agent_run_state") {
      const bodyRunId = body.run_id ?? body.run_ref ?? null;
      if (runId ? bodyRunId !== runId : false) continue;
      const parent = body.parent_turn_ref ?? body.agent_run?.parent_turn_ref ?? null;
      // agent_run_state 必须能绑定到 owning turn（parent_turn_ref）或由 ACK 提供的 run_id
      // 精确绑定；两者都无的终态帧不属于本 turn，不能当作本 turn 的终局。
      const parentBound = parent === turnId;
      const runIdBound = Boolean(runId) && bodyRunId === runId;
      if (!parentBound && !runIdBound) continue;
      const status = String(body.status ?? "");
      if (!TERMINAL_RUN_STATES.has(status)) continue;
      if (FAILURE_RUN_STATES.has(status)) return { kind: "failed", status, record, body };
      if (status === "awaiting_author" || status === "needs_confirmation") {
        return { kind: status === "awaiting_author" ? "awaiting_author" : "needs_confirmation", status, record, body };
      }
      if (status === "completed") return { kind: "completed", status, record, body };
    }
    if (event === "agent_event") {
      const ref = body.run_ref ?? body.run_id ?? null;
      if (runId && ref !== runId) continue;
      const eventType = String(body.event_type ?? "");
      if (eventType === "run_failed") return { kind: "failed", status: "run_failed", record, body };
      if (eventType === "run_completed" && (!runId || ref === runId)) {
        return { kind: "completed", status: "run_completed", record, body };
      }
    }
  }
  return null;
}

// DB agent_runs 行兜底判定（WS 帧缺失/延迟时使用；仍以终态为准）。
export function dbTerminal(row) {
  if (row === null || row === undefined) return null;
  const status = String(row.status ?? "");
  if (FAILURE_RUN_STATES.has(status)) return { kind: "failed", status };
  if (status === "awaiting_author") return { kind: "awaiting_author", status };
  if (status === "needs_confirmation") return { kind: "needs_confirmation", status };
  if (status === "completed") return { kind: "completed", status };
  return null;
}

// 终局 TurnResult 的模型行为分类：只记录事实，不据此要求固定行为。
export function classifyTurnBody(body) {
  const pending = Array.isArray(body?.adoption_state?.pending) ? body.adoption_state.pending : [];
  const availableActions = Array.isArray(body?.available_actions) ? body.available_actions : [];
  const toolResultName = body?.tool_result?.tool_name ?? null;
  const assistantText = String(body?.assistant_message?.text ?? "");
  const runStatus = String(body?.agent_run?.status ?? body?.status ?? "");
  return {
    status: body?.status ?? null,
    run_id: runIdOf(body),
    run_status: runStatus || null,
    tool_result_name: toolResultName,
    pending_artifact_count: pending.length,
    pending_artifact_types: pending.map((artifact) => artifact?.artifact_type ?? null).filter(Boolean),
    pending_statuses: pending.map((artifact) => artifact?.adoption_status ?? null).filter(Boolean),
    needs_author_choice: availableActions.some((action) => action?.action_type === "author_choice"),
    needs_confirmation: String(body?.status ?? "") === "needs_confirmation",
    available_action_types: [...new Set(availableActions.map((action) => action?.action_type).filter(Boolean))],
    assistant_text_length: assistantText.length,
    assistant_text_present: assistantText.trim() !== "",
    truthfulness: body?.truthfulness ?? null,
  };
}

// 模型行为事实汇总（L12）：调用次数、是否工具调用、是否候选、是否停等作者。
export function summarizeModelBehavior({ turnBody = null, llmRecords = [], runStatus = null } = {}) {
  const classified = turnBody ? classifyTurnBody(turnBody) : null;
  const records = Array.isArray(llmRecords) ? llmRecords : [];
  // 唯一事实源 = 实时 provider 响应里的 tool_calls（模型真实输出）。请求 messages 中的
  // assistant.tool_calls 是追加式 transcript 的历史回放，只作为回放观测，不当作新调用；
  // 用 call_id 主键在聚合前归并，而不是收集后再过滤（后置去重会放大/掩盖事实）。
  const toolCallsById = new Map();
  const replayObservations = new Map();
  let replayOnlyCalls = 0;
  for (const record of records) {
    const body = record?.response?.body ?? {};
    const responseCalls = Array.isArray(body.tool_calls) ? body.tool_calls : [];
    for (const call of responseCalls) {
      const callId = call?.id ?? null;
      if (!callId || toolCallsById.has(callId)) continue;
      toolCallsById.set(callId, {
        provider_call_ref: record.provider_call_ref ?? null,
        name: call?.function?.name ?? call?.name ?? null,
        call_id: callId,
        arguments: call?.function?.arguments ?? call?.arguments ?? null,
      });
    }
    const messages = Array.isArray(record?.request_body?.messages) ? record.request_body.messages : [];
    for (const message of messages) {
      if (message?.role !== "assistant") continue;
      const messageCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      for (const call of messageCalls) {
        const callId = call?.id ?? null;
        if (!callId) continue;
        replayObservations.set(callId, (replayObservations.get(callId) ?? 0) + 1);
        if (!toolCallsById.has(callId)) replayOnlyCalls += 1;
      }
    }
  }
  const toolCalls = [...toolCallsById.values()];
  const providerCalls = records.length;
  const pendingCount = classified?.pending_artifact_count ?? 0;
  return {
    schema: LIVE_RUN_SCHEMA,
    provider_calls: providerCalls,
    replay_only_tool_calls: replayOnlyCalls,
    tool_call_replay_observations: Object.fromEntries(replayObservations),
    provider_call_refs: records.map((record) => record.provider_call_ref ?? null).filter(Boolean),
    tool_call_count: toolCalls.length,
    tool_calls: toolCalls,
    tool_names: [...new Set(toolCalls.map((call) => call.name).filter(Boolean))],
    pending_artifact_count: pendingCount,
    had_candidate: pendingCount > 0 || (classified?.tool_result_name ?? "").length > 0,
    ask_author:
      runStatus === "awaiting_author" ||
      (classified?.needs_author_choice ?? false) ||
      (classified?.status ?? "") === "needs_confirmation",
    run_status: runStatus ?? classified?.run_status ?? null,
    assistant_reply: {
      present: classified?.assistant_text_present ?? false,
      length: classified?.assistant_text_length ?? 0,
    },
    needs_confirmation: (classified?.status ?? "") === "needs_confirmation",
  };
}

// 由模型行为事实推导「未签名」清单（not_signed）：不因为模型没触发而伪造覆盖。
export function notSignedSlices(behavior) {
  const slices = [];
  if (!behavior || behavior.tool_call_count === 0) {
    slices.push("G2_observation_roundtrip_not_triggered", "G3_validation_failure_not_triggered");
  }
  if (!behavior || behavior.pending_artifact_count === 0) {
    slices.push("G4_tentative_candidate_not_triggered");
  }
  slices.push("G5_author_boundary_not_triggered");
  slices.push("G6_compression_not_triggered");
  slices.push("I10_literary_quality_not_signed");
  return slices;
}
