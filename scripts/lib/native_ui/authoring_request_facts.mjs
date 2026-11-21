// B71 外部验收请求读取的唯一事实边界。
//
// 两条现役来源都按实际记录的 source format 读取，互不伪装：
// - fixture provider 的 `request_format=authoring-request-ir/v1`，request_body 是
//   canonical IR（role/provenance/blocks/versions/source_refs）；
// - 真实模型日志的 `request.body`，仍是原生 Chat wire（role/content/tool_calls/tool 结果）。
//
// 这里只保留原始 record/body 与可直接引用的事实（作者字节、应用消息、按原顺序的
// 工具调用/结果、scope 版本与来源）。不会重建一个 Chat body，也不会把缺测/未知格式
// 当成空数组或 0 的有效证据；退役的 provider_prompt/v1 明确 unsupported。

import { isDeepStrictEqual } from "node:util";

export const AUTHORING_REQUEST_IR = "authoring-request-ir/v1";
export const NATIVE_CHAT_WIRE = "native-chat-wire";
export const RETIRED_PROVIDER_PROMPT = "provider_prompt/v1";

const APPLICATION_PREFIX = "【应用数据 · ";
const SCOPE_PREFIX = "【应用数据 · scope_update";
// 已保存原生证据的旧 header 保持只读；现役 renderer 仅生成新 header。
const SCOPE_HEADERS = new Set([
  "【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】",
  "【应用数据 · scope_update · 以最新版本为准】",
]);
const APPLICATION_BASE_PREFIX = "【应用数据 · application_base";
const APPLICATION_BASE_HEADER = "【应用数据 · application_base · 非作者原话】\n";

// Common.RequestIR 的闭合 block type 契约；未知块不能因未投影文字而被忽略。
const IR_BLOCK_TYPES = new Set([
  "text", "scope", "tool_call", "observation", "validation_result",
  "tentative_artifact", "author_exit", "checkpoint",
]);

const IR_APPLICATION_ROLES = new Set([
  "application_base",
  "application_notice",
  "scope_update",
  "checkpoint",
]);

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const validRefValues = (value) => Array.isArray(value) &&
  value.every((source) => nonBlank(source) || (isRecord(source) && nonBlank(source.ref)));

function decodedJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function validScopeMetadata(versions, sourceRefs) {
  return isRecord(versions) && Array.isArray(sourceRefs) &&
    sourceRefs.every((source) => isRecord(source) && nonBlank(source.ref));
}

function scopeBlockContent(blocks) {
  if (!Array.isArray(blocks) || blocks.length !== 1) return null;
  const block = blocks[0];
  return block?.type === "scope" && isRecord(block.content) ? block.content : null;
}

// Canonical Scope 的唯一读取；历史 text 块只保留原证据，不反向解析自然语言事实。
export function scopeContentOf(message) {
  if (!isRecord(message)) return null;
  if (message.role !== "scope_update" || message.provenance !== "application") return null;
  if (!validScopeMetadata(message.versions, message.source_refs)) return null;
  return scopeBlockContent(message.blocks);
}

// 只接受当前或已保存历史 renderer 的精确 header、版本、来源列表、原结构 JSON。
// 原 wire 文本始终保留；未知 header/缺失/非结构文本/坏 JSON 不被升格为结构化事实。
function wireScopeAttributes(content) {
  if (typeof content !== "string") return null;
  const [header, versionLine, sourceLine, ...payload] = content.split("\n");
  if (!SCOPE_HEADERS.has(header)) return null;
  if (!versionLine?.startsWith("版本：") || !sourceLine?.startsWith("来源：")) return null;
  const versions = decodedJson(versionLine.slice("版本：".length));
  const sourceRefs = decodedJson(sourceLine.slice("来源：".length));
  const scopeContent = decodedJson(payload.join("\n"));
  if (!validScopeMetadata(versions, sourceRefs) || !isRecord(scopeContent)) return null;
  return { versions, sourceRefs, scopeContent };
}

function invalid(format, reason, extra = {}) {
  return {
    ok: false,
    status: "malformed",
    format,
    reason,
    record: extra.record ?? null,
    rawBody: extra.rawBody ?? null,
    messages: [],
    messageFacts: [],
    tools: [],
    toolsFieldPresent: false,
    toolChoice: null,
    run: null,
    system: null,
    refs: null,
    projection: null,
    authorMessages: [],
    applicationMessages: [],
    scopeMessages: [],
    applicationBases: [],
    toolCalls: [],
    toolResults: [],
    observations: [],
    malformedCalls: 0,
    malformedToolMessages: 0,
  };
}

function unsupportedRequest(format, reason, extra = {}) {
  return {
    ...invalid(format, reason, extra),
    status: "unsupported",
  };
}

function messageTextParts(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return typeof part?.text === "string" ? part.text : "";
    })
    .join("");
}

function irText(blocks) {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
}

function parseIrBlock(block) {
  if (!isRecord(block) || !IR_BLOCK_TYPES.has(block.type)) return { malformed: true };
  if (block.type === "text" && typeof block.text !== "string") return { malformed: true };
  return { malformed: false };
}

function irToolCall(block, messageIndex, blockIndex) {
  return {
    messageIndex,
    blockIndex,
    callId: block.call_id ?? null,
    nativeId: hasOwn(block, "provider_call_id") ? block.provider_call_id : block.call_id,
    hasProviderCallId: hasOwn(block, "provider_call_id"),
    name: block.name ?? null,
    rawArguments: typeof block.raw_arguments === "string" ? block.raw_arguments : null,
    arguments: block.arguments,
    raw: block,
  };
}

function irToolResult(block, messageIndex, blockIndex) {
  return {
    messageIndex,
    blockIndex,
    callId: block.call_id ?? null,
    toolCallId: block.call_id ?? null,
    type: block.type,
    status: block.status,
    reasonCode: block.reason_code ?? null,
    payload: canonicalToolResult(block),
    raw: block,
  };
}

function irCalls(blocks, messageIndex) {
  return blocks.flatMap((block, blockIndex) =>
    block.type === "tool_call" ? [irToolCall(block, messageIndex, blockIndex)] : []);
}

function irResults(blocks, messageIndex) {
  return blocks.flatMap((block, blockIndex) =>
    ["observation", "validation_result"].includes(block.type)
      ? [irToolResult(block, messageIndex, blockIndex)]
      : []);
}

function validIrMessageShape(message) {
  return isRecord(message) && nonBlank(message.role) && nonBlank(message.provenance) &&
    Array.isArray(message.blocks) &&
    message.blocks.every((block) => !parseIrBlock(block).malformed);
}

export function parseIrMessage(message, index) {
  if (!validIrMessageShape(message)) return { malformed: true };
  const blocks = message.blocks;
  const scopeContent = scopeContentOf(message);
  if (blocks.some((block) => block.type === "scope") && scopeContent === null) {
    return { malformed: true };
  }
  const calls = irCalls(blocks, index);
  const results = irResults(blocks, index);
  return {
    malformed: false,
    message: {
      index,
      role: message.role,
      provenance: message.provenance,
      text: irText(blocks),
      scopeContent,
      blocks,
      sourceRefs: list(message.source_refs),
      baseRefs: validRefValues(message.base_refs) ? message.base_refs : null,
      applicationBaseText: message.role === "application_base" && message.provenance === "application" &&
        blocks.length > 0 && blocks.every(block => block.type === "text") ? irText(blocks) : null,
      versions: isRecord(message.versions) ? message.versions : {},
      raw: message,
      toolCalls: calls,
      toolResults: results,
    },
    calls,
    results,
    toolMessageWithoutResult: message.role === "tool" && results.length === 0,
  };
}

function parsedIrMessages(body) {
  const parsed = body.messages.map((message, index) => parseIrMessage(message, index));
  return parsed.some((entry) => entry.malformed) ? null : parsed;
}

function irClassification(messages) {
  const authorMessages = messages.filter(
    (message) => message.role === "user" && message.provenance === "author",
  );
  const applicationMessages = messages.filter(
    (message) => IR_APPLICATION_ROLES.has(message.role) && message.provenance === "application",
  );
  return {
    authorMessages,
    applicationMessages,
    scopeMessages: applicationMessages.filter((message) => message.role === "scope_update"),
    applicationBases: applicationMessages.filter((message) => message.role === "application_base"),
    toolCalls: messages.flatMap((message) => message.toolCalls),
    toolResults: messages.flatMap((message) => message.toolResults),
    observations: observationFacts(messages),
  };
}

function irShapeReason(body) {
  if (!isRecord(body) || body.ir_version !== AUTHORING_REQUEST_IR) {
    return "request_body_missing_ir_version";
  }
  if (!Array.isArray(body.messages) || !Array.isArray(body.tools)) {
    return "request_body_missing_messages_or_tools";
  }
  return null;
}

function irFacts(record, body) {
  const shapeReason = irShapeReason(body);
  if (shapeReason !== null) {
    return invalid(AUTHORING_REQUEST_IR, shapeReason, { record, rawBody: body });
  }
  const parsed = parsedIrMessages(body);
  if (parsed === null) {
    return invalid(AUTHORING_REQUEST_IR, "request_body_malformed_message", { record, rawBody: body });
  }
  const messages = parsed.map((entry) => entry.message);
  const classified = irClassification(messages);
  return {
    ok: true,
    status: "valid",
    format: AUTHORING_REQUEST_IR,
    reason: null,
    record,
    rawBody: body,
    messages: body.messages,
    messageFacts: messages,
    tools: body.tools,
    toolsFieldPresent: true,
    toolChoice: isRecord(body.projection) ? body.projection.tool_choice ?? null : null,
    run: isRecord(body.run) ? body.run : null,
    system: isRecord(body.system) ? body.system : null,
    refs: isRecord(body.refs) ? body.refs : null,
    projection: isRecord(body.projection) ? body.projection : null,
    ...classified,
    malformedCalls: classified.toolCalls.filter((call) => !nonBlank(call.callId)).length,
    malformedToolMessages: parsed.filter((entry) => entry.toolMessageWithoutResult).length,
  };
}

function wireCallPayload(call) {
  const fn = isRecord(call.function) ? call.function : null;
  return {
    name: (fn ? fn.name ?? call.name : call.name) ?? null,
    arguments: fn ? fn.arguments : call.arguments,
  };
}

function wireToolCall(call, messageIndex, callIndex) {
  if (!isRecord(call)) return null;
  const payload = wireCallPayload(call);
  return {
    messageIndex,
    blockIndex: callIndex,
    callId: call.id ?? null,
    nativeId: call.id ?? null,
    hasProviderCallId: false,
    name: payload.name,
    rawArguments: typeof payload.arguments === "string" ? payload.arguments : null,
    arguments: payload.arguments,
    raw: call,
  };
}

// 只把缺失恢复事实表示为 null；原 canonical 行与原始 wire 始终留在 raw。
export function canonicalToolResult(block) {
  if (!isRecord(block)) return block;
  return { ...block, retryable: block.retryable ?? null, budget_after: block.budget_after ?? null };
}

function wireToolResult(message, messageIndex) {
  if (typeof message.content !== "string" || !nonBlank(message.tool_call_id)) return null;
  const envelope = decodedJson(message.content);
  const keys = ["budget_after", "data", "error_code", "message", "observation_ref", "ok", "retryable"];
  if (!isRecord(envelope) || !isDeepStrictEqual(Object.keys(envelope).sort(), keys)) return null;
  const data = envelope.data;
  if (!isRecord(data) || !["observation", "validation_result"].includes(data.type) ||
      ["call_id", "retryable", "budget_after"].some(key => Object.hasOwn(data, key)) ||
      !(envelope.retryable === null || typeof envelope.retryable === "boolean") ||
      !(envelope.budget_after === null || isRecord(envelope.budget_after))) return null;

  const observation = data.type === "observation";
  if (observation ? !validRefValues(data.source_refs) : !nonBlank(data.reason_code)) return null;
  if (!observation && Object.hasOwn(data, "detail") && !isRecord(data.detail)) return null;
  const statuses = observation ? ["ok", "partial", "truncated", "unavailable", "stale"] : ["passed", "failed"];
  if (!statuses.includes(data.status)) return null;
  const ok = observation ? ["ok", "partial", "truncated"].includes(data.status) : data.status === "passed";
  if ((observation || ok) && envelope.retryable === true) return null;
  const errorCode = ok ? null : observation ? data.status : data.reason_code;
  const actualMessage = observation ? (ok ? null : data.content?.summary) : data.detail?.message;
  const diagnostic = typeof actualMessage === "string" ? actualMessage : null;
  const observationRef = observation ? observationRefOf(data) : null;
  if (envelope.ok !== ok || envelope.error_code !== errorCode || envelope.message !== diagnostic ||
      envelope.observation_ref !== observationRef) return null;

  const payload = {
    ...data,
    call_id: message.tool_call_id,
    retryable: envelope.retryable,
    budget_after: envelope.budget_after,
  };
  return {
    messageIndex,
    blockIndex: 0,
    callId: message.tool_call_id,
    toolCallId: message.tool_call_id,
    type: data.type,
    status: data.status,
    reasonCode: data.reason_code ?? null,
    payload,
    raw: message,
  };
}

function wireCallsOf(raw, index) {
  if (raw.tool_calls !== undefined && !Array.isArray(raw.tool_calls)) {
    return { calls: [], malformed: 1 };
  }
  if (raw.role !== "assistant") {
    return { calls: [], malformed: list(raw.tool_calls).length > 0 ? 1 : 0 };
  }
  const calls = list(raw.tool_calls)
    .map((call, callIndex) => wireToolCall(call, index, callIndex));
  return {
    calls: calls.filter(Boolean),
    malformed: calls.filter((call) => call === null).length,
  };
}

function wireResultsOf(raw, index) {
  if (raw.role !== "tool") return { results: [], malformed: 0 };
  const result = wireToolResult(raw, index);
  return result ? { results: [result], malformed: 0 } : { results: [], malformed: 1 };
}

function emptyWireMessageFact(index, raw) {
  return {
    index,
    role: null,
    provenance: null,
    text: "",
    scopeContent: null,
    blocks: null,
    sourceRefs: [],
    baseRefs: null,
    applicationBaseText: null,
    versions: {},
    raw,
    toolCalls: [],
    toolResults: [],
  };
}

function wireMessageFact(raw, index) {
  if (raw === null || raw === undefined) {
    return { fact: emptyWireMessageFact(index, raw), malformedCalls: 0, malformedToolMessages: 0 };
  }
  const calls = wireCallsOf(raw, index);
  const results = wireResultsOf(raw, index);
  const text = messageTextParts(raw);
  const scope = raw.role === "user" ? wireScopeAttributes(raw.content) : null;
  return {
    fact: {
      ...emptyWireMessageFact(index, raw),
      role: raw.role,
      text,
      applicationBaseText: raw.role === "user" && text.startsWith(APPLICATION_BASE_HEADER)
        ? text.slice(APPLICATION_BASE_HEADER.length) : null,
      ...scope,
      toolCalls: calls.calls,
      toolResults: results.results,
    },
    malformedCalls: calls.malformed,
    malformedToolMessages: results.malformed,
  };
}

function wireMessageFacts(rawMessages) {
  const facts = [];
  let malformedCalls = 0;
  let malformedToolMessages = 0;
  for (const [index, raw] of rawMessages.entries()) {
    const parsed = wireMessageFact(raw, index);
    facts.push(parsed.fact);
    malformedCalls += parsed.malformedCalls;
    malformedToolMessages += parsed.malformedToolMessages;
  }
  return { messageFacts: facts, malformedCalls, malformedToolMessages };
}

function wireClassification(messageFacts) {
  const authorMessages = messageFacts.filter(
    (message) => message.role === "user" && !message.text.startsWith(APPLICATION_PREFIX),
  );
  const applicationMessages = messageFacts.filter(
    (message) => message.role === "user" && message.text.startsWith(APPLICATION_PREFIX),
  );
  return {
    authorMessages,
    applicationMessages,
    scopeMessages: applicationMessages.filter((message) => message.text.startsWith(SCOPE_PREFIX)),
    applicationBases: applicationMessages.filter((message) =>
      message.text.startsWith(APPLICATION_BASE_PREFIX)),
    toolCalls: messageFacts.flatMap((message) => message.toolCalls),
    toolResults: messageFacts.flatMap((message) => message.toolResults),
    observations: observationFacts(messageFacts),
  };
}

function wireShapeReason(body) {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return "native_request_body_missing_messages";
  }
  if (body.tools !== undefined && !Array.isArray(body.tools)) {
    return "native_request_body_malformed_tools";
  }
  const malformed = body.messages.some((message) =>
    message !== null && message !== undefined && (!isRecord(message) || !nonBlank(message.role)));
  return malformed ? "native_request_body_malformed_message" : null;
}

// 同一真实调用的 IR 引用由 Gateway/LLMLog 登记在 request 元数据，不进入 HTTP body。
// 缺失或未知形状保留 null；不从 Scope 来源、wire 文本或其它调用反推。
function nativeRequestRefs(record) {
  const refs = record?.request?.refs;
  if (!isRecord(refs)) return null;
  // RequestIR.ref_key 同时接受原始 ref 字符串和带版本的 {ref}；只读保留真实形状。
  return validRefValues(refs.base_refs) && validRefValues(refs.observation_refs) &&
    validRefValues(refs.used_refs) ? refs : null;
}

function wireFacts(record, body) {
  const shapeReason = wireShapeReason(body);
  if (shapeReason !== null) {
    return invalid(NATIVE_CHAT_WIRE, shapeReason, { record, rawBody: body });
  }
  const parsed = wireMessageFacts(body.messages);
  const classified = wireClassification(parsed.messageFacts);
  return {
    ok: true,
    status: "valid",
    format: NATIVE_CHAT_WIRE,
    reason: null,
    record,
    rawBody: body,
    messages: body.messages,
    messageFacts: parsed.messageFacts,
    tools: list(body.tools),
    toolsFieldPresent: hasOwn(body, "tools"),
    toolChoice: body.tool_choice ?? null,
    run: null,
    system: null,
    refs: nativeRequestRefs(record),
    projection: null,
    ...classified,
    malformedCalls: parsed.malformedCalls,
    malformedToolMessages: parsed.malformedToolMessages,
  };
}

// 按实际 body 的 source format 读取。IR 由 ir_version 显式标识；原生 wire 没有
// ir_version 但必须具备 Chat messages，绝不按文本内容猜测格式。
export function requestFactsFromBody(body, extra = {}) {
  if (!isRecord(body)) {
    return invalid(null, "request_body_not_object", { ...extra, rawBody: body });
  }
  if (hasOwn(body, "ir_version") || body.ir_version !== undefined) {
    return irFacts(extra.record ?? null, body);
  }
  if (Array.isArray(body.messages)) {
    return wireFacts(extra.record ?? null, body);
  }
  return invalid(null, "request_body_unknown_format", { ...extra, rawBody: body });
}

// 真实记录的唯一读取入口：fixture IR 只读 request_body，真实模型 wire 只读 request.body。
export function requestFactsFromRecord(record) {
  if (!isRecord(record)) return invalid(null, "request_record_not_object", { record });
  const format = record.request_format;
  if (format === AUTHORING_REQUEST_IR) {
    if (hasOwn(record, "request_body")) return irFacts(record, record.request_body);
    return invalid(AUTHORING_REQUEST_IR, "missing_request_body", { record });
  }
  if (format === RETIRED_PROVIDER_PROMPT) {
    return unsupportedRequest(RETIRED_PROVIDER_PROMPT, "retired_provider_prompt_request", { record });
  }
  if (format !== undefined) {
    return unsupportedRequest(String(format), "unknown_request_format", { record });
  }
  if (isRecord(record.request) && hasOwn(record.request, "body")) {
    return wireFacts(record, record.request.body);
  }
  return unsupportedRequest(null, "request_source_missing", { record });
}

// 显式 checkpoint covers 保留原值；不补 call_ids/message_refs，不把坏形状归一成空选择。
export function checkpointSelectionsFromFacts(facts) {
  const prefix = "【应用数据 · checkpoint · 覆盖 ";
  const covers = [];
  for (const message of list(facts?.applicationMessages)) {
    const text = typeof message?.text === "string" ? message.text : "";
    let cursor = 0;
    while (true) {
      const start = text.indexOf(prefix, cursor);
      if (start < 0) break;
      const end = text.indexOf("】", start + prefix.length);
      if (end < 0) break;
      try {
        const value = JSON.parse(text.slice(start + prefix.length, end));
        if (isRecord(value)) covers.push(value);
      } catch { /* 非合法 JSON 不供应覆盖事实。 */ }
      cursor = end + 1;
    }
  }
  return covers;
}


// 已保留 canonical 消息与真实请求逐条绑定；不生成请求正文，也不从文字猜 provenance。
// Provider system envelope 不属于会话消息，仅可占真实 wire 的额外首位；它不供应 Base。
export function bindRequestMessages(facts, canonicalMessages, { actualMessages = facts.messageFacts, checkpoints = new Map() } = {}) {
  const parsed = canonicalMessages.map(parseIrMessage);
  if (parsed.some(entry => entry.malformed)) return null;
  const canonical = parsed.map(entry => entry.message);
  if (facts.format === AUTHORING_REQUEST_IR) {
    if (actualMessages.length !== canonical.length) return null;
    return actualMessages.every((actual, index) => sameIrRequestMessage(actual, canonical[index]))
      ? actualMessages.map((actual, index) => ({ actual, canonical: canonical[index] })) : null;
  }
  if (facts.format !== NATIVE_CHAT_WIRE) return null;
  const units = [];
  for (const message of canonical) {
    const current = nativeMessageUnits(message, checkpoints.get(message.raw));
    if (current === null) return null;
    units.push(...current);
  }
  const envelope = actualMessages.length === units.length + 1 &&
    actualMessages[0]?.role === "system" ? 1 : 0;
  const actual = actualMessages.slice(envelope);
  if (actual.length !== units.length) return null;
  return actual.every((message, index) => nativeMessageMatches(message, units[index]))
    ? actual.map((message, index) => ({ actual: message, canonical: units[index].message })) : null;
}

function sameIrRequestMessage(actual, canonical) {
  return actual.role === canonical.role && actual.provenance === canonical.provenance &&
    isDeepStrictEqual(actual.blocks, canonical.blocks) &&
    isDeepStrictEqual(actual.sourceRefs, canonical.sourceRefs) &&
    isDeepStrictEqual(actual.versions, canonical.versions) &&
    isDeepStrictEqual(actual.baseRefs, canonical.baseRefs);
}

function nativeMessageUnits(message, checkpoint) {
  const role = message.role;
  const allowedBlocks = {
    system: ["text"], user: ["text"], application_base: ["text"], application_notice: ["text"],
    scope_update: ["scope"], assistant: ["text", "tool_call"],
    tool: ["observation", "validation_result"], checkpoint: ["text", "checkpoint"],
    tentative_artifact: ["tentative_artifact"], author_exit: ["author_exit"],
  }[role];
  if (!allowedBlocks || message.blocks.some(block => !allowedBlocks.includes(block.type))) return null;
  if (["tentative_artifact", "author_exit"].includes(role)) return [];
  if (role === "tool" && message.provenance === "tool_result") {
    return message.blocks.map(result => ({ message, result }));
  }
  const expectedProvenance = role === "user" ? "author" : role === "assistant" ? "model" : "application";
  if (message.provenance !== expectedProvenance ||
      !["system", "user", "assistant", "application_base", "application_notice", "scope_update", "checkpoint"].includes(role)) {
    return null;
  }
  if (["system", "user", "application_base", "application_notice"].includes(role) && message.text === "") return [];
  if (role === "checkpoint" && message.text === "" && !message.blocks.some(block => block.type === "checkpoint")) return [];
  return [{ message, checkpoint }];
}

function sameRequestCall(actual, canonical) {
  if (actual.callId !== canonical.callId || actual.name !== canonical.name) return false;
  if (canonical.rawArguments !== null) return actual.rawArguments === canonical.rawArguments;
  return isDeepStrictEqual(typeof actual.arguments === "string" ? decodedJson(actual.arguments) : actual.arguments,
    canonical.arguments);
}

function nativeMessageMatches(actual, { message: canonical, result, checkpoint }) {
  switch (canonical.role) {
    case "system":
    case "user":
      return actual.role === canonical.role && typeof actual.raw.content === "string" &&
        actual.text === canonical.text;
    case "application_base":
    case "application_notice":
      return actual.role === "user" && typeof actual.raw.content === "string" &&
        actual.text === "【应用数据 · " + canonical.role + " · 非作者原话】\n" + canonical.text;
    case "scope_update":
      return actual.role === "user" && actual.scopeContent !== null &&
        isDeepStrictEqual(actual.scopeContent, canonical.scopeContent) &&
        isDeepStrictEqual(actual.versions, canonical.versions) &&
        isDeepStrictEqual(actual.sourceRefs, canonical.sourceRefs);
    case "assistant":
      return actual.role === "assistant" && typeof actual.raw.content === "string" && actual.text === canonical.text &&
        actual.toolCalls.length === canonical.toolCalls.length &&
        actual.toolCalls.every((call, index) => sameRequestCall(call, canonical.toolCalls[index]));
    case "tool":
      return actual.role === "tool" && actual.toolResults.length === 1 &&
        actual.toolResults[0].toolCallId === result.call_id &&
        isDeepStrictEqual(actual.toolResults[0].payload, canonicalToolResult(result));
    case "checkpoint":
      return sameCheckpointMessage(actual, canonical, checkpoint);
    default:
      return false;
  }
}

function sameCheckpointMessage(actual, canonical, checkpoint) {
  if (actual.role !== "user" || typeof actual.raw.content !== "string") return false;
  const header = "【应用数据 · checkpoint · 非作者原话】\n";
  const block = canonical.blocks.find(candidate => candidate.type === "checkpoint");
  if (!block) return actual.text === header + canonical.text;
  // 当前 producer 每消息只有一个 checkpoint；未支持的多块/混合块不能截短核对。
  if (canonical.blocks.length !== 1) return false;
  if (!actual.text.startsWith(header)) return false;
  const text = actual.text.slice(header.length);
  const prefix = "【应用数据 · checkpoint · 覆盖 ";
  if (!text.startsWith(prefix)) return false;
  const end = text.indexOf("】\n", prefix.length);
  if (end < 0 || !isDeepStrictEqual(decodedJson(text.slice(prefix.length, end)), block.covers)) return false;
  const [sources, versions, ...tail] = text.slice(end + 2).split("\n");
  if (!sources.startsWith("来源：") || !versions?.startsWith("版本：") ||
      !isDeepStrictEqual(decodedJson(sources.slice(3)), block.source_refs ?? []) ||
      !isDeepStrictEqual(decodedJson(versions.slice(3)), block.versions ?? {})) return false;
  const omissions = list(block.omissions);
  if (omissions.length > 0 && tail.shift() !== "省略：" + omissions.join("; ")) return false;
  return sameCheckpointSummary(tail.join("\n"), block, checkpoint);
}


function sameCheckpointSummary(text, block, checkpoint) {
  const summary = block.summary ?? "";
  if (block.discussion == null) return text === summary;
  if (!checkpoint || !Array.isArray(checkpoint.entries)) return false;
  const notice = "\n【模型派生的历史讨论摘要 · 非当前事实、非执行结果、非授权】\n" +
    "摘要与保留片段不是穷尽清单，未提及不证明原文不存在；" +
    "需要核对历史材料时，沿各条 source/locator 用 session_message_read 按需回查，" +
    "以实际原文及 coverage/omissions 限定结论。\n";
  if (!text.startsWith(summary + notice)) return false;
  const actual = decodedJson(text.slice(summary.length + notice.length));
  const selected = checkpoint.selected.filter(source => source.role === "assistant");
  if (selected.length !== checkpoint.entries.length) return false;
  const expected = { provenance: "model_derived_history", authority: "none",
    entries: selected.map((source, index) => ({
      source: { ref: "session_message:" + source.run_id + ":" + source.run_sequence, version: 1 },
      locator: { run_id: source.run_id, run_sequence: source.run_sequence },
      summary: checkpoint.entries[index].summary,
      retained_source_fragments: checkpoint.entries[index].retained_obligations,
    })) };
  return isDeepStrictEqual(actual, expected);
}

export function requestFactsOf(records) {
  return list(records).map((record) => requestFactsFromRecord(record));
}

const OBSERVATION_REF_PREFIX = "observation:";
const PLANNED_EXPLORATION_TOOL = "planned_exploration";

// 仅用于调用方已证明“单 accepted draft”的章页；不把多 draft 集合压成一个版本。
export function singleDraftVersionReason(block, draftRef, revision) {
  const versions = block.versions;
  const keys = isRecord(versions) ? Object.keys(versions) : [];
  if (keys.length === 0) return "version_missing";
  if (keys.length !== 1) return "version_ambiguous";
  if (keys[0] !== draftRef) return "version_mismatch";
  return versions[draftRef] === revision ? null : "version_mismatch";
}

// 只核章页原字节；页大小、范围、时序与全文资格由各实际消费者判断。
export function proseObservationBodyReason(block, expected) {
  const marker = "【正文】";
  const summary = typeof block.content?.summary === "string" ? block.content.summary : "";
  if (summary.split(marker).length !== 2) return "prose_body_missing";
  const after = summary.slice(summary.indexOf(marker) + marker.length);
  const newline = after.indexOf("\n");
  if (newline < 0) return "prose_body_missing";
  const body = after.slice(newline + 1);
  if (body === expected) return null;
  return body.startsWith(expected) && body.slice(expected.length).startsWith("\n【")
    ? null
    : "prose_mismatch";
}

// 原生 observation 身份只在 content.observation_ref，且必须是完整 observation: token；
// 保留原始完整字符串，不修剪或补写；content 其它字段与文本不参与。
export function observationRefOf(payload) {
  const content = isRecord(payload) && isRecord(payload.content) ? payload.content : null;
  const ref = content && typeof content.observation_ref === "string"
    ? content.observation_ref
    : "";
  return ref.startsWith(OBSERVATION_REF_PREFIX) && ref.length > OBSERVATION_REF_PREFIX.length ? ref : null;
}

// 已识别的 planned_exploration 聚合父块只读取一层叶（按 content.observations 执行顺序）；
// 普通观察返回 null，调用方直接使用原 payload。叶没有 type/call_id，父块才是调用身份。
export function plannedExplorationLeaves(payload) {
  const content = isRecord(payload) && isRecord(payload.content) ? payload.content : null;
  if (content === null || content.tool !== PLANNED_EXPLORATION_TOOL) return null;
  return list(content.observations).filter(isRecord);
}


// 只归一当前实际请求内的读取叶；不扫描会话历史或累计 refs，不补调用身份。
// 原生结果仍要求同请求在先唯一调用/唯一结果；计划执行的应用 Scope 保留独立来源。
function observationFacts(messages) {
  const totals = new Map();
  for (const message of messages) {
    for (const result of message.toolResults) {
      if (nonBlank(result.callId)) totals.set(result.callId, (totals.get(result.callId) ?? 0) + 1);
    }
  }
  const earlierCalls = new Map();
  const observations = [];
  for (const message of messages) {
    const scope = message.scopeContent;
    const leaf = scope?.facts?.exploration_result;
    if (scope?.operation?.role === "planned_exploration" && isRecord(leaf)) {
      observations.push({
        messageIndex: message.index, provenance: "application", callId: null,
        planCallId: scope.operation.plan_call_id ?? null, payload: leaf,
      });
    }
    for (const result of message.toolResults) {
      if (result.type !== "observation" || !nonBlank(result.callId) ||
          result.callId !== result.toolCallId || earlierCalls.get(result.callId) !== 1 ||
          totals.get(result.callId) !== 1) continue;
      for (const payload of plannedExplorationLeaves(result.payload) ?? [result.payload]) {
        observations.push({
          messageIndex: message.index, provenance: "tool", callId: result.callId,
          parentStatus: result.status, payload,
        });
      }
    }
    for (const call of message.toolCalls) {
      if (nonBlank(call.callId)) earlierCalls.set(call.callId, (earlierCalls.get(call.callId) ?? 0) + 1);
    }
  }
  return observations;
}

export { isRecord, list, nonBlank };
