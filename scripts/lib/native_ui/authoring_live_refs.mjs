// B71 CP3b 实模 L7 证据：逐调用 used_context_refs ⊆ 同次 Base ∪ 同次 observation。
//
// 正判（VS-00L §7 G2/§16.9）：canonical assistant(model) 顶层 provider_call_ref +
// provider_run_ref 配对唯一真实 llm record；used 只取该消息
// tool_call.arguments.self_report.used_context_refs。边界只从配对 record 经
// requestFactsFromRecord 读取：明确的 application_base 与 scope_update；scope 文本
// 只解析真实 producer 的正式条目（「## 材料与覆盖」、「## 对象与范围」目标项、
// 正文 chapter_ref=、「- [observation:…]」使命条目），并停在「## 当前作者输入」之前。
// 成功 observation 只认前置唯一 assistant call、同请求唯一 result 的结构化 source_refs。
// checkpoint/notice、“省略：”、作者原文、段头 used_refs、decision_traces、agent_events
// 不授信，不做跨调用并集；ref 按 EvidenceUsage.validate 的完整字符串精确匹配。
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";

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
const SCOPE_PREFIX = "【应用数据 · scope_update";
const AUTHOR_INPUT_HEADING = "## 当前作者输入";
const MATERIALS_HEADING = "## 材料与覆盖";
const OBJECT_SCOPE_HEADING = "## 对象与范围";

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
    return nonBlank(ref) ? [ref.trim()] : [];
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

// scope 文本只看到作者输入之前；checkpoint/notice 根本不进入边界读取。
function beforeAuthorInput(text) {
  const value = String(text ?? "");
  const index = value.indexOf(AUTHOR_INPUT_HEADING);
  return index === -1 ? value : value.slice(0, index);
}

// 只取指定二级标题到下一个二级标题之间的行。
function sectionLines(text, heading) {
  const lines = String(text ?? "").split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && /^##\s/u.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

// 真实 scope 的正式 ref 形状：
// - 「## 材料与覆盖」的 `- observation：observation:…（…）`
// - 「## 对象与范围」的目标对象 refs / 目标章 ref / 基线对象
// - 正文材料里的 `chapter_ref=…`
// - 章节使命正式条目 `- [observation:…] 文本`
function materialRefs(visible) {
  const refs = [];
  for (const line of sectionLines(visible, MATERIALS_HEADING)) {
    const material = /^-\s*[^：:\s]+[：:]\s*([^\s（(]+)/u.exec(line);
    if (material) refs.push([material[1], "materials"]);
  }
  return refs;
}

function objectRefs(visible) {
  const refs = [];
  for (const line of sectionLines(visible, OBJECT_SCOPE_HEADING)) {
    const object = /^-\s*(?:目标对象 refs|目标章 ref|基线对象)[：:]\s*(.+)$/u.exec(line);
    if (!object) continue;
    for (const token of object[1].split(/[、,，\s]+/u)) {
      const ref = token.split("=")[0].trim();
      if (nonBlank(ref)) refs.push([ref, "scope_object"]);
    }
  }
  return refs;
}

function missionRefs(visible) {
  return visible
    .split("\n")
    .flatMap((line) => {
      const item = /^-\s*\[([^\]]+)\]/u.exec(line);
      return item ? [[item[1].trim(), "mission_item"]] : [];
    });
}

function scopeTextRefs(text) {
  const visible = beforeAuthorInput(text);
  const chapterRefs = [...visible.matchAll(/chapter_ref=([A-Za-z0-9_:-]+)/gu)].map((match) => [match[1], "chapter_ref"]);
  return [...materialRefs(visible), ...objectRefs(visible), ...chapterRefs, ...missionRefs(visible)];
}

function applicationKind(message) {
  const text = String(message.text ?? "");
  if (message.role === "application_base" || text.startsWith(APPLICATION_BASE_PREFIX)) {
    return "base";
  }
  if (message.role === "scope_update" || text.startsWith(SCOPE_PREFIX)) return "scope";
  return null;
}

function collectApplication(boundary, message, kind) {
  const source = { message_index: message.index };
  if (kind === "base") {
    const structured = refValues(message.sourceRefs);
    // canonical IR 首选 source_refs；只有没有结构化来源时才读 application_base 文本。
    const refs = structured.length > 0
      ? structured.map((ref) => [ref, "source_refs"])
      : [...extractRefTokens(message.text)].map((ref) => [ref, "text"]);
    for (const [ref, channel] of refs) addApplicationRef(boundary, ref, { ...source, channel });
    return;
  }
  for (const ref of refValues(message.sourceRefs)) {
    addApplicationRef(boundary, ref, { ...source, channel: "source_refs" });
  }
  for (const [ref, channel] of scopeTextRefs(message.text)) {
    addApplicationRef(boundary, ref, { ...source, channel });
  }
}

// 成功 observation 只认前置唯一 assistant call 与同请求唯一 result；重复声明/重复结果
// 都不是合法观察。只读结构化 source_refs，不扫描 tool.content 文本。
function resultTotals(facts) {
  const totals = new Map();
  for (const message of facts.messageFacts) {
    for (const result of message.toolResults) {
      if (nonBlank(result.callId)) totals.set(result.callId, (totals.get(result.callId) ?? 0) + 1);
    }
  }
  return totals;
}

function trustedObservation(result, earlierCalls, totals) {
  return (
    result.type === "observation" && String(result.status ?? "") === "ok" &&
    nonBlank(result.callId) && result.callId === result.toolCallId &&
    earlierCalls.get(result.callId) === 1 && totals.get(result.callId) === 1
  );
}

function collectToolObservations(boundary, facts) {
  const totals = resultTotals(facts);
  const earlierCalls = new Map();
  for (const message of facts.messageFacts) {
    for (const result of message.toolResults) {
      if (!trustedObservation(result, earlierCalls, totals)) continue;
      for (const ref of refValues(isObject(result.payload) ? result.payload.source_refs : [])) {
        pushRef(boundary.observation, ref, {
          message_index: message.index, channel: "source_refs", call_id: result.callId, status: result.status,
        });
      }
    }
    for (const call of message.toolCalls) {
      if (nonBlank(call.callId)) {
        earlierCalls.set(call.callId, (earlierCalls.get(call.callId) ?? 0) + 1);
      }
    }
  }
}

function requestBoundary(record) {
  const facts = requestFactsFromRecord(record);
  if (!facts.ok) {
    return {
      ok: false, reason: "request_unparseable",
      request_reason: facts.reason ?? null, request_status: facts.status ?? null,
    };
  }
  const boundary = { base: new Map(), observation: new Map() };
  for (const message of facts.applicationMessages) {
    const kind = applicationKind(message);
    if (kind !== null) collectApplication(boundary, message, kind);
  }
  collectToolObservations(boundary, facts);
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
  return { malformed: false, refs: used.filter(nonBlank), callId };
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

function evaluateGroup(group, llmRecords) {
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
  const boundary = requestBoundary(matches[0].record);
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

export function liveRefsCheck({ llmRecords = [], transcript = null } = {}) {
  const { groups, issues, self_report_count } = collectReports(transcript);
  const reports = groups.map((group) => evaluateGroup(group, llmRecords));
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
      used: ["authoring_session_messages.message.blocks[tool_call].arguments.self_report.used_context_refs"],
      pairing: ["canonical assistant.provider_call_ref + provider_run_ref ↔ llm_calls 同名两键"],
      base: ["application_base.source_refs（优先）/ text；scope_update.source_refs 与正式目标项"],
      observation: ["scope 正式 observation 条目；成功且前置唯一 call/唯一 result 的 tool source_refs"],
      excluded: ["段头 used_refs / decision_traces / agent_events / checkpoint / notice / 省略 / 作者输入"],
      self_report_count,
    },
  };
}
