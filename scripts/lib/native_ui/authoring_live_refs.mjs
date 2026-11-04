// B71 CP3b 实模 L7 证据：used_context_refs ⊆ base_refs ∪ observation_refs。
//
// Lead 裁定（03 批前）：wire 是投影，refs 的真实来源在产品持久结构——
// used 从 `authoring_transcript` 的模型自报 `self_report.used_context_refs` 与
// `decision_traces.context_refs` 读取；observation 从 `agent_events.refs`（真实工具观察）
// 读取；base（supplied）从真实请求的应用数据消息读取。wire 启发式只作观测辅助。
// 无法提取 used 时记 null（unknown，不假过）。
import {
  AUTHORING_REQUEST_IR,
  requestFactsFromRecord,
} from "./authoring_request_facts.mjs";

export const LIVE_REFS_SCHEMA = "b71-live-refs/v1";

const REF_TOKEN = /(?:chapter|plan|artifact|scene|volume|character|memory|observation):[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*/gu;
const ARTIFACT_TOKEN = /\bas_[A-Za-z0-9_]+/gu;
const USED_CONTEXT_REFS = /"used_context_refs"\s*:\s*\[([^\]]*)\]/gu;
const APPLICATION_PREFIX = "【应用数据 · ";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function extractRefTokens(text) {
  const value = String(text ?? "");
  const refs = new Set();
  for (const match of value.matchAll(REF_TOKEN)) refs.add(match[0]);
  for (const match of value.matchAll(ARTIFACT_TOKEN)) refs.add(match[0]);
  return refs;
}

function messageContent(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

// supplied(refs)：真实请求中应用数据（application_base/scope_update/application_notice）
// 与 tool 观察的边界；tool 消息归 observation（真实工具结果回流），其余应用数据归 base。
function addRefs(target, value) {
  for (const ref of extractRefTokens(value)) target.add(ref);
}

function collectIrMessageRefs(message, base, observation) {
  if (message.role === "tool") {
    for (const result of message.toolResults) {
      addRefs(observation, JSON.stringify(result.payload));
    }
    return;
  }
  if (!["application_base", "scope_update", "application_notice"].includes(message.role)) return;
  addRefs(base, message.text);
}

function collectNativeMessageRefs(message, base, observation) {
  if (message.role === "tool") {
    addRefs(observation, messageContent(message.raw));
    return;
  }
  if (message.role !== "user") return;
  const content = messageContent(message.raw);
  if (content.startsWith(APPLICATION_PREFIX)) addRefs(base, content);
}

function collectRecordRefs(facts, base, observation) {
  for (const message of facts.messageFacts) {
    if (facts.format === AUTHORING_REQUEST_IR) collectIrMessageRefs(message, base, observation);
    else collectNativeMessageRefs(message, base, observation);
  }
}

export function collectWireRefs(llmRecords) {
  const base = new Set();
  const observation = new Set();
  for (const record of Array.isArray(llmRecords) ? llmRecords : []) {
    const facts = requestFactsFromRecord(record);
    if (facts.ok) collectRecordRefs(facts, base, observation);
  }
  return { base_refs: [...base].sort(), observation_refs: [...observation].sort() };
}

// agent_events.refs：真实工具观察（exploration_observed 等）的 refs。
export function parseAgentEventRefs(rows) {
  const observation = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    let refs = [];
    try {
      const parsed = JSON.parse(String(row?.refs ?? "[]"));
      refs = Array.isArray(parsed) ? parsed : [];
    } catch {
      refs = [];
    }
    if (String(row?.event_type ?? "") !== "exploration_observed") continue;
    for (const ref of refs) if (typeof ref === "string" && ref !== "") observation.add(ref);
  }
  return [...observation].sort();
}

// transcript 的模型自报 used_context_refs（非权威、非 APP 推算；B27 §9 / HO5）。
export function parseTranscriptUsedRefs(transcriptText) {
  const used = new Set();
  let selfReportCount = 0;
  for (const match of String(transcriptText ?? "").matchAll(USED_CONTEXT_REFS)) {
    try {
      const parsed = JSON.parse(`[${match[1]}]`);
      if (!Array.isArray(parsed)) continue;
      selfReportCount += 1;
      for (const ref of parsed) if (typeof ref === "string" && ref !== "") used.add(ref);
    } catch {
      // 坏片段不当作证据；保留 selfReportCount 不变。
    }
  }
  return { used_refs: [...used].sort(), self_report_count: selfReportCount };
}

// decision_traces.context_refs：产品持久记录的本轮 context refs（可能为空/缺失）。
export function parseDecisionTraceRefs(rows) {
  const refs = new Set();
  const traceIds = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = row?.context_refs;
    if (typeof raw !== "string" || raw.trim() === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : isObject(parsed) ? Object.values(parsed).flat() : [];
    for (const ref of list) if (typeof ref === "string" && ref !== "") refs.add(ref);
    if (Array.isArray(list) && list.length > 0) traceIds.push(String(row?.trace_id ?? ""));
  }
  return { context_refs: [...refs].sort(), trace_ids: traceIds };
}

// ref 归一：去掉 execution_brief/supplied/context 包装后比较内嵌对象身份；
// chapter 引用同时比较完整 token 与内嵌 chapter:<uuid>。
export function refVariants(ref) {
  const value = String(ref ?? "");
  const variants = new Set([value]);
  const inner = /^(?:execution_brief|supplied|context|observation):(.+)$/u.exec(value);
  if (inner) variants.add(inner[1]);
  const chapter = /^(?:execution_brief|supplied):(chapter:[^:]+)$/u.exec(value);
  if (chapter) variants.add(chapter[1]);
  return [...variants];
}

export function liveRefsCheck({ llmRecords = [], agentEvents = [], decisionTraces = [], transcriptText = "" } = {}) {
  const wire = collectWireRefs(llmRecords);
  const eventObservation = parseAgentEventRefs(agentEvents);
  const transcript = parseTranscriptUsedRefs(transcriptText);
  const traces = parseDecisionTraceRefs(decisionTraces);
  const used = new Set([...transcript.used_refs, ...traces.context_refs]);
  const base = new Set([...wire.base_refs]);
  const observation = new Set([...wire.observation_refs, ...eventObservation]);
  const sources = {
    used: ["authoring_transcript.self_report.used_context_refs", "decision_traces.context_refs"],
    base: ["wire.application_data_messages"],
    observation: ["wire.tool_messages", "agent_events.exploration_observed.refs"],
    self_report_count: transcript.self_report_count,
    wire_heuristic: "observation_only_not_used_for_verdict",
  };
  if (used.size === 0) {
    return {
      schema: LIVE_REFS_SCHEMA,
      ok: null,
      reason: "used_context_refs_unavailable",
      sources,
      used_refs: [],
      base_refs: [...base].sort(),
      observation_refs: [...observation].sort(),
      violations: [],
    };
  }
  const allowed = new Set([...base, ...observation]);
  const violations = [];
  for (const ref of used) {
    const variants = refVariants(ref);
    if (!variants.some((variant) => allowed.has(variant))) violations.push({ ref, variants });
  }
  return {
    schema: LIVE_REFS_SCHEMA,
    ok: violations.length === 0,
    reason: violations.length === 0 ? null : "used_ref_out_of_boundary",
    sources,
    used_refs: [...used].sort(),
    base_refs: [...base].sort(),
    observation_refs: [...observation].sort(),
    violations,
  };
}
