// B71 CP3b 实模 L7 证据：逐调用 used_context_refs ⊆ 同次 Base ∪ 同次 observation。
//
// 正判（VS-00L §7 G2/§16.9）：canonical assistant(model) 顶层 provider_call_ref +
// provider_run_ref 配对唯一真实 llm record；used 只取当前 run transcript 中该消息
// tool_call.arguments.self_report.used_context_refs。边界只从配对 record 经
// requestFactsFromRecord 读取：application_base 沿用其来源边界；现役结构化 Scope
// 必须经 sessionMessages 的同次 canonical 前缀逐项绑定，不能以当前 run 段代替
// 会话前缀；历史 run 自报不计入当前 used。Base 只取该请求 IR.refs.base_refs 的明确登记，
// 真实 wire 从同一 LLMLog request.refs 读取；HTTP body 与 pcall/prun 仍分别核对。
// Scope.source_refs 只是来源，prose、目标、引用和历史 text 块都不扩充 Base/observation。
// 原生调用未记录同次 Base 元数据时如实缺证，最终段头的累计 refs 不能代签。
// 成功 observation 只认前置唯一 assistant call、同请求唯一 result 的结构化 source_refs
// 与同请求原生 content.observation_ref 身份。ok/partial/truncated 叶只证明已供应部分可用，
// 不证明全文完整；还须实际供应内容并在同次目录登记。planned_exploration 父块也须有效，叶沿用真实父 call_id。
// 应用计划叶保持 Base；父块或不可用叶的合并来源不代签。checkpoint/notice、“省略：”、作者
// 原文、段头 used_refs、decision_traces、agent_events 不授信，不做跨调用并集；ref 按
// EvidenceUsage.validate 的完整字符串精确匹配。
import {
  AUTHORING_REQUEST_IR,
  observationRefOf,
  requestFactsFromRecord,
} from "./authoring_request_facts.mjs";
import { scopeForProviderCall } from "./authoring_call_evidence.mjs";
import { auditCanonicalCoverage } from "./authoring_checkpoint_coverage.mjs";

export const LIVE_REFS_SCHEMA = "b71-live-refs/v1";

const CORE_REF = "(?:chapter|plan|artifact|scene|volume|character|memory|observation)";
// 完整 ref（可带 execution_brief:/supplied: 等包装）整个 token 比较；不拆 wrapper。
const REF_TOKEN = new RegExp(
  `(?<![A-Za-z0-9_:-])(?:[a-z][a-z0-9_]*:)*${CORE_REF}:[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*(?![A-Za-z0-9_:-])`,
  "gu",
);
const ARTIFACT_TOKEN = /(?<![A-Za-z0-9_])as_[A-Za-z0-9_]+(?![A-Za-z0-9_])/gu;
const OBSERVATION_PREFIX = "observation:";
const APPLICATION_BASE_PREFIX = "【应用数据 · application_base";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const uniqueStrings = (values) => [...new Set(values.filter(nonBlank))].sort();

export function extractRefTokens(text) {
  const value = String(text ?? "");
  const refs = new Set();
  for (const match of value.matchAll(REF_TOKEN)) refs.add(match[0]);
  for (const match of value.matchAll(ARTIFACT_TOKEN)) refs.add(match[0]);
  return refs;
}

function refValues(values) {
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const ref = typeof value === "string" ? value : isObject(value) ? value.ref : null;
    return nonBlank(ref) ? [ref] : [];
  });
}

function pushRef(map, ref, source) {
  if (!map.has(ref)) map.set(ref, []);
  map.get(ref).push(source);
}
// 应用数据：observation: 条目归观察，其余归 Base；tool source_refs 全部归观察。
function addApplicationRef(boundary, ref, source) {
  pushRef(String(ref).startsWith(OBSERVATION_PREFIX) ? boundary.observation : boundary.base, ref, source);
}

function applicationKind(message) {
  const text = String(message.text ?? "");
  if (message.role === "application_base" || text.startsWith(APPLICATION_BASE_PREFIX)) {
    return "base";
  }
  return null;
}

function collectApplication(boundary, messages) {
  for (const message of messages) {
    if (applicationKind(message) !== "base") continue;
    const source = { message_index: message.index };
    const structured = refValues(message.sourceRefs);
    // 非原生 Scope 请求沿用 application_base 的既有证据；不扫描 Scope 文本或来源。
    const refs = structured.length > 0
      ? structured.map((ref) => [ref, "source_refs"])
      : [...extractRefTokens(message.text)].map((ref) => [ref, "text"]);
    for (const [ref, channel] of refs) addApplicationRef(boundary, ref, { ...source, channel });
  }
}

function suppliedRefs(facts, kind) {
  const refs = facts.refs?.[kind];
  if (!Array.isArray(refs)) return null;
  const values = refValues(refs);
  return values.length === refs.length ? values : null;
}

function scopeRefEvidence(record, sessionMessages, facts) {
  if (scopeForProviderCall(record, { messages: sessionMessages }) === null) {
    return { ok: false, reason: "scope_provenance_unbound" };
  }
  const baseRefs = suppliedRefs(facts, "base_refs");
  if (baseRefs === null) return { ok: false, reason: "request_base_refs_unavailable" };
  const observationRefs = suppliedRefs(facts, "observation_refs");
  if (observationRefs === null) return { ok: false, reason: "request_observation_refs_unavailable" };
  return { ok: true, baseRefs, observationRefs };
}

function observationContentSupplied(content) {
  if (nonBlank(content)) return true;
  if (!isObject(content)) return false;
  return nonBlank(content.summary) ||
    (isObject(content.facts) && Object.keys(content.facts).length > 0) ||
    (Array.isArray(content.facts) && content.facts.length > 0);
}

// 实际请求的观察归一由 request facts 唯一负责。应用计划读取属于明确 Base；
// 本处只认实际材料及有效父/叶状态；现役 Scope 还须与同次登记目录相交。
function collectToolObservations(boundary, facts, registeredRefs, retainedMessages) {
  const supplied = (ref) => registeredRefs === null || registeredRefs.has(ref);
  for (const unit of facts.observations) {
    if (retainedMessages !== null && !retainedMessages.has(facts.messages[unit.messageIndex])) continue;
    if (unit.provenance !== "tool" ||
        !["ok", "partial", "truncated"].includes(String(unit.parentStatus ?? "")) ||
        !["ok", "partial", "truncated"].includes(String(unit.payload.status ?? "")) ||
        !observationContentSupplied(unit.payload.content)) continue;
    for (const ref of refValues(unit.payload.source_refs).filter(supplied)) {
      pushRef(boundary.observation, ref, {
        message_index: unit.messageIndex, channel: "source_refs",
        call_id: unit.callId, status: unit.payload.status,
      });
    }
    const identity = observationRefOf(unit.payload);
    if (identity !== null && supplied(identity)) {
      pushRef(boundary.observation, identity, {
        message_index: unit.messageIndex, channel: "content_observation_ref",
        call_id: unit.callId, status: unit.payload.status,
      });
    }
  }
}

function requestBoundary(record, sessionMessages) {
  const facts = requestFactsFromRecord(record);
  if (!facts.ok) {
    return {
      ok: false, reason: "request_unparseable",
      request_reason: facts.reason ?? null, request_status: facts.status ?? null,
    };
  }
  // IR 保留追加式原历史；只复用覆盖 oracle 的保留消息判据，不重建 wire 或改写事实。
  // native wire 已是实际发送视图，不根据历史意图再过滤一次。
  let retainedMessages = null;
  if (facts.format === AUTHORING_REQUEST_IR) {
    const coverage = auditCanonicalCoverage(facts.messages);
    if (!coverage.ok) {
      return { ok: false, reason: "request_coverage_invalid", request_reason: coverage.reason };
    }
    retainedMessages = new Set(coverage.retainedMessages);
  }
  const hasNativeScope = facts.scopeMessages.some((message) => isObject(message.scopeContent));
  const boundary = { base: new Map(), observation: new Map() };
  let registeredObservationRefs = null;
  if (hasNativeScope) {
    const evidence = scopeRefEvidence(record, sessionMessages, facts);
    if (!evidence.ok) return evidence;
    for (const ref of evidence.baseRefs) pushRef(boundary.base, ref, { channel: "canonical_base_refs" });
    registeredObservationRefs = new Set(evidence.observationRefs);
  } else {
    collectApplication(boundary, facts.applicationMessages);
  }
  collectToolObservations(boundary, facts, registeredObservationRefs, retainedMessages);
  return { ok: true, boundary };
}

function isModelAssistantMessage(message) {
  return (
    isObject(message) &&
    message.role === "assistant" &&
    message.provenance === "model" &&
    Array.isArray(message.blocks)
  );
}

function readToolReport(block) {
  if (!isObject(block) || block.type !== "tool_call") return null;
  const report = block.arguments?.self_report;
  // 只有 assumptions 等字段、没有 used_context_refs 的 self_report 不是 refs 自报。
  if (!isObject(report) || !Object.hasOwn(report, "used_context_refs")) return null;
  const callId = nonBlank(block.call_id) ? block.call_id : null;
  const used = report.used_context_refs;
  if (!Array.isArray(used)) return { malformed: true, refs: [], callId };
  return { malformed: !used.every(nonBlank), refs: used.filter(nonBlank), callId };
}

// 一条 assistant(model) 消息的自报；多个 tool_call 的 report 属于同一次调用，合并。
function readSelfReport(message) {
  if (!isModelAssistantMessage(message)) return null;
  const refs = [];
  const callIds = [];
  let toolReports = 0;
  let malformed = false;
  for (const block of message.blocks) {
    const report = readToolReport(block);
    if (report === null) continue;
    toolReports += 1; malformed = malformed || report.malformed;
    refs.push(...report.refs); if (report.callId !== null) callIds.push(report.callId);
  }
  return toolReports === 0 ? null : { refs, callIds, toolReports, malformed };
}

function groupFor(groups, providerCallRef, providerRunRef) {
  const key = `${providerCallRef}\u0000${providerRunRef}`;
  if (!groups.has(key)) {
    groups.set(key, {
      provider_call_ref: providerCallRef, provider_run_ref: providerRunRef,
      message_indexes: [], call_ids: [], used_refs: [], malformed: false,
    });
  }
  return groups.get(key);
}

function collectReports(transcript) {
  const groups = new Map();
  const issues = [];
  let selfReportCount = 0;
  const messages = Array.isArray(transcript?.messages) ? transcript.messages : [];
  messages.forEach((message, index) => {
    const report = readSelfReport(message);
    if (report === null) return;
    selfReportCount += report.toolReports;
    const providerCallRef = nonBlank(message.provider_call_ref) ? message.provider_call_ref : null;
    const providerRunRef = nonBlank(message.provider_run_ref) ? message.provider_run_ref : null;
    if (providerCallRef === null || providerRunRef === null) {
      issues.push({
        status: "unknown", reason: "pairing_key_missing",
        provider_call_ref: providerCallRef, provider_run_ref: providerRunRef,
        message_indexes: [index], call_ids: uniqueStrings(report.callIds), used_refs: uniqueStrings(report.refs),
      });
      return;
    }
    const group = groupFor(groups, providerCallRef, providerRunRef);
    group.message_indexes.push(index);
    group.call_ids.push(...report.callIds);
    group.used_refs.push(...report.refs);
    group.malformed = group.malformed || report.malformed;
  });
  return { groups: [...groups.values()], issues, self_report_count: selfReportCount };
}

function matchingRecords(llmRecords, providerCallRef, providerRunRef) {
  return (Array.isArray(llmRecords) ? llmRecords : []).flatMap((record, index) =>
    isObject(record) &&
    record.provider_call_ref === providerCallRef &&
    record.provider_run_ref === providerRunRef
      ? [{ record, index }]
      : [],
  );
}

// observation: 自报只能由同次 observation 兑现；其余 ref 精确匹配 Base ∪ observation。
function lookupRef(ref, boundary) {
  if (!String(ref).startsWith(OBSERVATION_PREFIX)) {
    const sources = [...(boundary.base.get(ref) ?? []), ...(boundary.observation.get(ref) ?? [])];
    if (sources.length === 0) return null;
    return { ref, kind: boundary.base.has(ref) ? "base" : "observation", sources };
  }
  return boundary.observation.has(ref)
    ? { ref, kind: "observation", sources: boundary.observation.get(ref) }
    : null;
}

function matchUsedRefs(report, usedRefs, details) {
  for (const ref of usedRefs) {
    const match = lookupRef(ref, details);
    if (match === null) report.violations.push({ ref });
    else report.matched_refs.push(match);
  }
}

function evaluateGroup(group, llmRecords, sessionMessages) {
  const usedRefs = uniqueStrings(group.used_refs);
  const report = {
    provider_call_ref: group.provider_call_ref, provider_run_ref: group.provider_run_ref,
    message_indexes: [...group.message_indexes], call_ids: uniqueStrings(group.call_ids),
    used_refs: usedRefs, base_refs: [], observation_refs: [], matched_refs: [], violations: [],
  };
  const matches = matchingRecords(llmRecords, group.provider_call_ref, group.provider_run_ref);
  if (matches.length === 0) return { ...report, status: "unknown", reason: "llm_record_not_found" };
  if (matches.length > 1) {
    return {
      ...report, status: "unknown", reason: "llm_record_ambiguous",
      matched_record_indexes: matches.map((entry) => entry.index),
    };
  }
  const boundary = requestBoundary(matches[0].record, sessionMessages);
  report.matched_record_index = matches[0].index;
  if (!boundary.ok) {
    return {
      ...report, status: "unknown", reason: boundary.reason,
      request_reason: boundary.request_reason, request_status: boundary.request_status,
    };
  }
  const details = boundary.boundary;
  report.base_refs = [...details.base.keys()].sort();
  report.observation_refs = [...details.observation.keys()].sort();
  matchUsedRefs(report, usedRefs, details);
  // 已证越界优先 false；缺失/非法自报在无越界时仍记 null。
  if (report.violations.length > 0) return { ...report, status: "violation" };
  if (group.malformed) return { ...report, status: "unknown", reason: "self_report_malformed" };
  if (usedRefs.length === 0) return { ...report, status: "empty" };
  return { ...report, status: "verified" };
}

export function liveRefsCheck({ llmRecords = [], transcript = null, sessionMessages = null } = {}) {
  const { groups, issues, self_report_count } = collectReports(transcript);
  const reports = groups.map((group) => evaluateGroup(group, llmRecords, sessionMessages));
  const violations = reports.flatMap((report) =>
    report.violations.map((violation) => ({
      ...violation,
      provider_call_ref: report.provider_call_ref,
      provider_run_ref: report.provider_run_ref,
      message_indexes: report.message_indexes,
    })),
  );
  const unknown = [...reports, ...issues].find((entry) => entry.status === "unknown");
  const verified = reports.some((report) => report.status === "verified");
  const ok = violations.length > 0 ? false : unknown !== undefined || !verified ? null : true;
  const reason = violations.length > 0 ? "used_ref_out_of_boundary"
    : unknown !== undefined ? unknown.reason ?? "used_context_refs_unavailable"
    : verified ? null : "used_context_refs_unavailable";
  return {
    schema: LIVE_REFS_SCHEMA,
    ok,
    reason,
    reports,
    issues,
    violations,
    sources: {
      used: ["当前 run authoring_session_messages.message.blocks[tool_call].arguments.self_report.used_context_refs"],
      pairing: ["canonical assistant.provider_call_ref + provider_run_ref ↔ llm_calls 同名两键"],
      base: ["现役 Scope：同次请求 IR.refs.base_refs；其余请求：application_base.source_refs（优先）/ text"],
      observation: [
        "实际供应材料且前置唯一 call/唯一 result 的 tool source_refs 与 content.observation_ref；现役 Scope 须在同请求 observation_refs 登记",
        "planned_exploration 聚合父块与叶均为 ok/partial/truncated 时取已供应内容的来源与身份；沿用父 call_id，部分读取不证明全文完整",
      ],
      excluded: ["段头累计 base_refs / used_refs / Scope.source_refs / decision_traces / agent_events / checkpoint / notice / 省略 / 作者输入"],
      self_report_count,
    },
  };
}
