// B71 CP3b 实模驱动：run 终局等待与模型行为分类（纯函数，不启动 GUI/Mix）。
//
// 真实模型行为不确定：可能不调用工具直接回复、调用一次或多次、ask_author 停等。
// 驱动只等待「本 turn 的 run 终局」并如实分类，不轮询固定回复文本、不假设调用次数。
import { frameBody, frameEvent, frameOf } from "./scenario_evidence.mjs";

export const LIVE_RUN_SCHEMA = "b71-live-run/v1";

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "awaiting_author", "needs_confirmation"]);
const FAILURE_RUN_STATES = new Set(["failed", "cancelled"]);

function nonBlank(value) {
  return typeof value === "string" && value.trim() !== "";
}

function runIdOf(body) {
  return body?.agent_run?.run_id ?? body?.run_id ?? body?.run_ref ?? null;
}

function sameScope(body, { workId, sessionId }) {
  return body?.work_id === workId && body?.session_id === sessionId;
}

function sameParent(body, turnId) {
  const parent = body?.agent_run?.parent_turn_ref ?? body?.parent_turn_ref ?? body?.parent_turn_id;
  return parent === turnId || (parent === undefined && body?.turn_id === turnId);
}

function versionReached(version, minimum) {
  return minimum === 0 || (Number.isInteger(version) && version >= minimum);
}

function wireRunFact(records, identity) {
  let latest = null;
  for (const record of records) {
    const body = frameBody(record) ?? {};
    if (frameEvent(record) === "agent_run_state" && body.run_id === identity.runId &&
        body.workspace_id === identity.workspaceId && sameScope(body, identity) && sameParent(body, identity.turnId) &&
        versionReached(body.goal?.version, identity.minimumGoalVersion)) {
      latest = { status: body.status, record, body, source: "wire" };
    } else if (frameEvent(record) === "agent_event" && runIdOf(body) === identity.runId &&
        (body.work_id === undefined || body.work_id === identity.workId) &&
        (body.session_id === undefined || body.session_id === identity.sessionId)) {
      // AgentEvent 的实际归属是 owning topic + run_ref；它没有父回合或 goal 字段。
      const status = { run_completed: "completed", run_failed: "failed", run_cancelled: "cancelled" }[body.event_type];
      if (status && identity.minimumGoalVersion === 0)
        latest = { status, record, body, source: "wire" };
    }
  }
  return latest;
}

// 唯一完成组合：业务结果已送达 + 同 run 真实终态。TurnResult 中的状态只作原始业务材料。
// 离线校验可用绑定的 runRow；驱动 requireWireTerminal 时还须观察到运行事实回包。
export function wireTerminal(wire, options = {}) {
  const identity = { minimumGoalVersion: 0, resultPosition: "first", requireWireTerminal: false, ...options };
  const { turnId, runId, topic, workId, sessionId, since, runRow } = identity;
  if (!Array.isArray(wire) || ![turnId, runId, topic, workId, sessionId].every(nonBlank) ||
      !Number.isInteger(identity.minimumGoalVersion) || identity.minimumGoalVersion < 0 ||
      !["first", "last"].includes(identity.resultPosition)) return null;
  if (!topic.startsWith("workspace:") || !nonBlank(topic.slice("workspace:".length))) return null;
  const workspaceId = topic.slice("workspace:".length);
  if (identity.workspaceId !== undefined && identity.workspaceId !== workspaceId) return null;
  identity.workspaceId = workspaceId;
  const records = wire.filter((record) => record?.direction === "received" && frameOf(record)?.[2] === topic &&
    (since === undefined || (nonBlank(record.at) && record.at >= since)));
  const results = records.filter((record) => frameEvent(record) === "turn_result" &&
    runIdOf(frameBody(record)) === runId && nonBlank(frameBody(record)?.turn_id) &&
    sameScope(frameBody(record), identity) && sameParent(frameBody(record), turnId));
  const wireFact = wireRunFact(records, identity);
  let fact = wireFact;
  if (runRow !== undefined) {
    if (!runRow || runRow.id !== runId || runRow.parent_turn_ref !== turnId || !sameScope(runRow, identity) ||
        runRow.workspace_id !== workspaceId ||
        !versionReached(runRow.goal_version, identity.minimumGoalVersion)) return null;
    fact = { status: runRow.status, record: null, body: runRow, source: "db" };
    // 新鲜 DB running 不可被旧 wire 终态越过；在线也不可只凭 DB 抢在页面回包之前推进。
    if (identity.requireWireTerminal && wireFact?.status !== runRow.status) return null;
  }
  const terminal = dbTerminal(fact?.body && { status: fact.status });
  if (!terminal || (terminal.kind === "completed" && results.length === 0)) return null;
  const result = identity.resultPosition === "last" ? results.at(-1) : results[0];
  return { ...terminal, record: terminal.kind === "completed" ? result : fact.record,
    body: terminal.kind === "completed" ? frameBody(result) : fact.body,
    results, run_record: fact.record, run_body: fact.body, source: fact.source };
}

// 只分类已经存在的运行状态；成功推进统一交给 wireTerminal 配对业务结果。
export function dbTerminal(row) {
  if (row === null || row === undefined) return null;
  const status = String(row.status ?? "");
  if (!TERMINAL_RUN_STATES.has(status)) return null;
  if (FAILURE_RUN_STATES.has(status)) return { kind: "failed", status };
  if (status === "awaiting_author") return { kind: "awaiting_author", status };
  if (status === "needs_confirmation") return { kind: "needs_confirmation", status };
  return { kind: "completed", status };
}

// 业务 TurnResult 的模型行为分类：只记录事实，不据此判定运行终态或要求固定行为。
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

// 真实记录双形状：确定性 provider 用 `request_body`/`response.body` 对象；
// 真实 strata llm-calls 用 `request.body.messages` 与 `response.body`（chat.completion
// JSON 字符串）+ `response.usage`（归一字段）。判据只读取真实存在的字段。
export function recordRequestMessages(record) {
  const body = record?.request_body ?? record?.request?.body ?? null;
  return Array.isArray(body?.messages) ? body.messages : null;
}

export function recordResponseBody(record) {
  const body = record?.response?.body;
  if (body !== null && typeof body === "object" && !Array.isArray(body)) return body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function recordResponseToolCalls(record) {
  const body = recordResponseBody(record);
  if (Array.isArray(body?.tool_calls)) return body.tool_calls;
  const choiceCalls = body?.choices?.[0]?.message?.tool_calls;
  return Array.isArray(choiceCalls) ? choiceCalls : [];
}

export function recordUsageFacts(record) {
  const response = record?.response ?? {};
  const direct = response?.usage;
  const body = recordResponseBody(record);
  const usage =
    direct !== null && typeof direct === "object" && Object.keys(direct).length > 0
      ? direct
      : body?.usage ?? null;
  if (usage === null || typeof usage !== "object") return { present: false, known_pair: false, fields: [] };
  const fields = Object.keys(usage).filter((key) => usage[key] !== null && usage[key] !== undefined);
  const knownPair =
    (typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number") ||
    (typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number") ||
    typeof usage.total_tokens === "number";
  return { present: fields.length > 0, known_pair: knownPair, fields };
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
    const responseCalls = recordResponseToolCalls(record);
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
    const messages = recordRequestMessages(record) ?? [];
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
