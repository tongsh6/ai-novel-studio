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

export const AUTHORING_REQUEST_IR = "authoring-request-ir/v1";
export const NATIVE_CHAT_WIRE = "native-chat-wire";
export const RETIRED_PROVIDER_PROMPT = "provider_prompt/v1";

const APPLICATION_PREFIX = "【应用数据 · ";
const SCOPE_PREFIX = "【应用数据 · scope_update";
const APPLICATION_BASE_PREFIX = "【应用数据 · application_base";

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
    malformedCalls: 0,
    malformedToolMessages: 0,
    allText: "",
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
  if (!isRecord(block) || !nonBlank(block.type)) return { malformed: true };
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
    payload: block,
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

function parseIrMessage(message, index) {
  if (!isRecord(message) || !nonBlank(message.role) || !nonBlank(message.provenance)) {
    return { malformed: true };
  }
  if (!Array.isArray(message.blocks)) return { malformed: true };
  if (message.blocks.some((block) => parseIrBlock(block).malformed)) return { malformed: true };
  const blocks = message.blocks;
  const calls = irCalls(blocks, index);
  const results = irResults(blocks, index);
  return {
    malformed: false,
    message: {
      index,
      role: message.role,
      provenance: message.provenance,
      text: irText(blocks),
      blocks,
      sourceRefs: list(message.source_refs),
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
    toolChoice: isRecord(body.projection) ? body.projection.tool_choice ?? null : null,
    run: isRecord(body.run) ? body.run : null,
    system: isRecord(body.system) ? body.system : null,
    refs: isRecord(body.refs) ? body.refs : null,
    projection: isRecord(body.projection) ? body.projection : null,
    ...classified,
    malformedCalls: classified.toolCalls.filter((call) => !nonBlank(call.callId)).length,
    malformedToolMessages: parsed.filter((entry) => entry.toolMessageWithoutResult).length,
    allText: messages.map((message) => message.text).join("\n"),
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

function wireToolResult(message, messageIndex) {
  if (typeof message.content !== "string") return null;
  let payload;
  try {
    payload = JSON.parse(message.content);
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  if (!["observation", "validation_result"].includes(payload.type)) return null;
  if (!nonBlank(payload.call_id)) return null;
  return {
    messageIndex,
    blockIndex: 0,
    callId: payload.call_id,
    toolCallId: message.tool_call_id ?? message.tool_call ?? null,
    type: payload.type,
    status: payload.status,
    reasonCode: payload.reason_code ?? null,
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
    blocks: null,
    sourceRefs: [],
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
  return {
    fact: {
      index,
      role: raw.role,
      provenance: null,
      text: messageTextParts(raw),
      blocks: null,
      sourceRefs: [],
      versions: {},
      raw,
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
    toolChoice: body.tool_choice ?? null,
    run: null,
    system: null,
    refs: null,
    projection: null,
    ...classified,
    malformedCalls: parsed.malformedCalls,
    malformedToolMessages: parsed.malformedToolMessages,
    allText: parsed.messageFacts.map((message) => message.text).join("\n"),
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

export function requestFactsOf(records) {
  return list(records).map((record) => requestFactsFromRecord(record));
}

const OBSERVATION_REF_PREFIX = "observation:";
const PLANNED_EXPLORATION_TOOL = "planned_exploration";

// 原生 observation 身份只在 content.observation_ref，且必须是完整 observation: token；
// content 的其它字段与文本不参与。两个证据消费者共用这一处读取。
export function observationRefOf(payload) {
  const content = isRecord(payload) && isRecord(payload.content) ? payload.content : null;
  const ref = content && typeof content.observation_ref === "string"
    ? content.observation_ref.trim()
    : "";
  return ref.startsWith(OBSERVATION_REF_PREFIX) ? ref : null;
}

// 已识别的 planned_exploration 聚合父块只读取一层叶（按 content.observations 执行顺序）；
// 普通观察返回 null，调用方直接使用原 payload。叶没有 type/call_id，父块才是调用身份。
export function plannedExplorationLeaves(payload) {
  const content = isRecord(payload) && isRecord(payload.content) ? payload.content : null;
  if (content === null || content.tool !== PLANNED_EXPLORATION_TOOL) return null;
  return list(content.observations).filter(isRecord);
}

export { isRecord, list, nonBlank };
