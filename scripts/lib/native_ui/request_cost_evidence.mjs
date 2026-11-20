// B87 R01 native Chat wire 成本纯投影：只消费现役 request facts 与响应字段读取。
// 历史 CLI 与原生批次都提供真实 Chat wire；不实现无成本消费者的 canonical IR 投影。
// 不读文件、不启动进程、不调用模型，其他格式明确 unsupported。
import { createHash } from "node:crypto";
import { NATIVE_CHAT_WIRE, requestFactsFromRecord } from "./authoring_request_facts.mjs";
import { recordResponseBody } from "./live_run_wait.mjs";

export const REQUEST_COST_SCHEMA = "b87-request-cost/v1";

export const COST_CATEGORIES = Object.freeze([
  "system",
  "tools",
  "application_base",
  "scope",
  "history",
  "observation",
  "validation",
  "tool_unknown",
  "current_author",
  "application_other",
  "unclassified",
]);

const APPLICATION_PREFIX = "【应用数据 · ";
const APPLICATION_BASE_PREFIX = "【应用数据 · application_base";
const SCOPE_PREFIX = "【应用数据 · scope_update";
const APPLICATION_OTHER_PREFIXES = Object.freeze([
  "【应用数据 · application_notice",
  "【应用数据 · checkpoint",
]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const textOf = (value) => (typeof value === "string" ? value : "");
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";

export function utf8Bytes(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

export function stableJson(value) {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

export function sha256Hex(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function knownApplicationCategory(message) {
  const text = textOf(message.text);
  if (text.startsWith(APPLICATION_BASE_PREFIX)) {
    return "application_base";
  }
  if (text.startsWith(SCOPE_PREFIX)) return "scope";
  if (APPLICATION_OTHER_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    return "application_other";
  }
  return null;
}

function wireAuthorCategory(message) {
  if (message.role !== "user") return null;
  const text = textOf(message.text);
  if (text.startsWith(APPLICATION_PREFIX)) return null;
  return "author";
}

function toolCategory(toolType) {
  if (toolType === "observation") return "observation";
  if (toolType === "validation_result") return "validation";
  return "tool_unknown";
}

function categoryOf(message, currentAuthorIndex, toolType = null) {
  if (message.role === "system") return "system";
  if (message.role === "tool") return toolCategory(toolType);
  if (message.role === "user" && message.index === currentAuthorIndex) return "current_author";
  if (wireAuthorCategory(message) === "author") return "history";
  if (message.role === "assistant") return "history";
  return knownApplicationCategory(message) ?? "unclassified";
}

function toolArgumentBytes(message) {
  return message.toolCalls.reduce((sum, call) => {
    if (typeof call.rawArguments === "string") return sum + utf8Bytes(call.rawArguments);
    if (call.arguments !== undefined) return sum + utf8Bytes(stableJson(call.arguments));
    return sum;
  }, 0);
}

// 原生 wire 的 content 允许字符串或 part 数组。已识别的 part 只有 text；其它类型
// （图像/音频/厂商自定义块等）本产品未实现，必须按原字节显式计入 unclassified，
// 不能只取 text 后把未知材料留在 stable_json - categories 的 envelope 里。
function isKnownWirePart(part) {
  return (
    typeof part === "string" ||
    (isObject(part) && part.type === "text" && typeof part.text === "string")
  );
}

function unknownWireContentBytes(message) {
  const content = message.raw?.content;
  if (!Array.isArray(content)) return 0;
  return content
    .filter((part) => !isKnownWirePart(part))
    .reduce((sum, part) => sum + utf8Bytes(stableJson(part)), 0);
}

function emptyCategoryBytes() {
  return Object.fromEntries(COST_CATEGORIES.map((category) => [category, 0]));
}

function usageField(usage, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => (isObject(current) ? current[part] : null), usage);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function tokenField(key, value, invalid) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    invalid.push(key);
    return null;
  }
  return value;
}

function timingField(key, value, invalid) {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    invalid.push(key);
    return null;
  }
  return value;
}

function usageNumbers(source) {
  const pick = (keys) => (source ? usageField(source, keys) : null);
  const invalid = [];
  return {
    input: tokenField("input_tokens", pick(["input_tokens", "prompt_tokens"]), invalid),
    output: tokenField("output_tokens", pick(["output_tokens", "completion_tokens"]), invalid),
    cached: tokenField("cached_tokens", pick([
      "cached_tokens",
      "prompt_tokens_details.cached_tokens",
      "prompt_cache_hit_tokens",
      "cache_read_input_tokens",
    ]), invalid),
    ttft: timingField("ttft_ms", pick(["ttft_ms"]), invalid),
    latency: timingField("latency_ms", pick(["latency_ms"]), invalid),
    model: source && typeof source.model === "string" ? source.model : null,
    invalid,
  };
}

function usageViolations(numbers) {
  const violations = [];
  if (numbers.cached !== null && numbers.input !== null && numbers.cached > numbers.input) {
    violations.push("cached_tokens_exceeds_input");
  }
  if (numbers.invalid.length > 0) violations.push("invalid_token_or_timing_fields");
  return violations;
}

function usageNotCollected(numbers) {
  return [
    ["input_tokens", numbers.input],
    ["output_tokens", numbers.output],
    ["cached_tokens", numbers.cached],
    ["ttft_ms", numbers.ttft],
    ["latency_ms", numbers.latency],
  ]
    .filter(([, value]) => value === null)
    .map(([key]) => key);
}

function usageIdentity(model, requestModel, responseLabel) {
  return {
    request_model: requestModel,
    usage_model: model,
    response_label: responseLabel,
    model_matches_request:
      model === null || requestModel === null ? null : model === requestModel,
  };
}

export function normalizeUsage(usage, { requestModel = null, responseLabel = null } = {}) {
  const source = isObject(usage) ? usage : null;
  const numbers = usageNumbers(source);
  const present = Boolean(
    source &&
      [numbers.input, numbers.output, numbers.cached, numbers.ttft, numbers.latency].some(
        (value) => value !== null,
      ),
  );
  const cachedWithinInput =
    numbers.cached === null || numbers.input === null ? null : numbers.cached <= numbers.input;
  const violations = usageViolations(numbers);
  return {
    present,
    input_tokens: numbers.input,
    output_tokens: numbers.output,
    cached_tokens: numbers.cached,
    ttft_ms: numbers.ttft,
    latency_ms: numbers.latency,
    cost_input_tokens: numbers.input,
    cached_within_input: cachedWithinInput,
    violations,
    not_collected: usageNotCollected(numbers),
    invalid_fields: numbers.invalid,
    ttft_basis: numbers.ttft === null ? null : "app_activity",
    identity: usageIdentity(numbers.model, requestModel, responseLabel),
  };
}

function responseBodyKind(rawBody, parsed) {
  if (parsed === null) return "absent";
  if (typeof rawBody === "string") return "string_json";
  return parsed.source === "sse_decoder" ? "decoded_object" : "object";
}

// 已解码日志里的 tool_calls 观察：只有字段存在且确实是数组才算已知；
// 响应缺失、未解码或字段不可用一律保持未知，不能当作“调用 0 次”。
function decodedToolCalls(record) {
  const body = recordResponseBody(record);
  if (body === null) return null;
  if (Array.isArray(body.tool_calls)) return body.tool_calls;
  const choiceCalls = body.choices?.[0]?.message?.tool_calls;
  return Array.isArray(choiceCalls) ? choiceCalls : null;
}

function responseFacts(record) {
  const rawBody = record?.response?.body;
  const parsed = recordResponseBody(record);
  const toolCalls = decodedToolCalls(record);
  return {
    body_kind: responseBodyKind(rawBody, parsed),
    source: typeof parsed?.source === "string" ? parsed.source : null,
    raw_sse_collected: false,
    raw_source_scope: "llm_call_log_only",
    raw_sse_note: "本条 llm-calls 不含原始 SSE；不判断批次外部传输原件是否采集",
    actual_tool_calls: toolCalls === null ? null : toolCalls.length,
    actual_tool_calls_observed: toolCalls !== null,
    actual_tool_calls_basis: "decoded_log_observation",
    raw_assistant_text_collected: false,
    raw_assistant_text_note: "response.body 只保存 source/tool_calls；纯回复文本未作为原始响应保存",
    response_model_label:
      typeof record?.response?.model === "string" ? record.response.model : null,
  };
}

function emptyCostRequest() {
  return {
    sha256: null,
    stable_json_bytes: 0,
    content_utf8_bytes: 0,
    envelope_bytes: 0,
    raw_http_bytes: null,
    conservation: false,
  };
}

function emptyTotals() {
  return {
    content_utf8_bytes: 0,
    stable_json_bytes: 0,
    envelope_bytes: 0,
    category_sum_bytes: 0,
  };
}

function emptyCross(facts) {
  return {
    author_message_count: 0,
    current_author_index: null,
    history_message_count: 0,
    scope_block_count: 0,
    observation_message_count: 0,
    replay_tool_calls: 0,
    scope_contains_author_bytes: false,
    unclassified_messages: 0,
    malformed_calls: facts.malformedCalls,
    malformed_tool_messages: facts.malformedToolMessages,
    writer_purpose: false,
    writer_input_bytes: null,
  };
}

function responseLabelOf(record) {
  return record?.response?.model ?? null;
}

function invalidProvenance(facts) {
  return {
    basis: facts.format,
    trusted: false,
    untrusted_author_messages: [],
  };
}

function evidenceLayers({ format, response, usage }) {
  return {
    request_format: format ?? null,
    request_bytes: "decoded_json",
    response_body: response.body_kind,
    response_body_source: response.source,
    usage: usage.present ? "app_reported_response_usage" : "not_collected",
    ttft: usage.ttft_ms === null ? "not_collected" : "app_activity",
    raw_sse: "not_collected",
    raw_http_bytes: "not_collected",
  };
}

function invalidResponseContext(record) {
  const usage = normalizeUsage(record?.response?.usage, {
    requestModel: null,
    responseLabel: responseLabelOf(record),
  });
  return { usage, response: responseFacts(record) };
}

function invalidAnalysis({ record, facts, reason, status = "unsupported" }) {
  const { usage, response } = invalidResponseContext(record);
  return {
    schema: REQUEST_COST_SCHEMA,
    ok: false,
    status,
    reason,
    format: facts.format,
    request: emptyCostRequest(),
    category_bytes: emptyCategoryBytes(),
    totals: emptyTotals(),
    cross: emptyCross(facts),
    usage,
    response,
    evidence_layers: evidenceLayers({ format: facts.format, response, usage }),
    provenance: invalidProvenance(facts),
  };
}

function bindingMatches(bound, authorBinding) {
  if (bound === null) return false;
  return (
    bound.role === "user" &&
    bound.text === authorBinding.text &&
    sha256Hex(bound.text) === authorBinding.sha256
  );
}

function resolveAuthorState(facts, authorBinding) {
  const authorIndexes = facts.authorMessages.map((message) => message.index);
  const state = {
    authorIndexes,
    currentAuthorIndex: authorIndexes.length > 0 ? authorIndexes.at(-1) : null,
    bindingIndex: null,
    bindingStatus: "none",
    bindingError: null,
  };
  if (!authorBinding) return state;
  const bound = facts.messageFacts[authorBinding.messageIndex] ?? null;
  if (!bindingMatches(bound, authorBinding)) {
    state.bindingError = "author_binding_mismatch";
    return state;
  }
  // 已核原文字节的当前作者位置优先于标记文本；不据此授信其它历史同文消息。
  state.authorIndexes = [...new Set([...authorIndexes, bound.index])].sort((left, right) => left - right);
  state.bindingIndex = bound.index;
  state.currentAuthorIndex = bound.index;
  state.bindingStatus = "external_binding";
  return state;
}

// 应用材料的 canonical 审计由外部来源 owner 完成；此边界重新核同次调用和原字节，
// 不能把可信绑定借给另一请求，也不能把 application_base 伪装成当前作者。
function resolveSourceState(record, facts, authorBinding, applicationBinding) {
  if (!applicationBinding) return resolveAuthorState(facts, authorBinding);
  const state = resolveAuthorState(facts, null);
  const bound = facts.messageFacts[applicationBinding.messageIndex] ?? null;
  const matches = !authorBinding && applicationBinding.operation === "transcript_compaction" &&
    nonBlank(record.provider_call_ref) && nonBlank(record.provider_run_ref) &&
    record.provider_call_ref === applicationBinding.provider_call_ref &&
    record.provider_run_ref === applicationBinding.provider_run_ref &&
    facts.authorMessages.length === 0 && facts.applicationBases.length === 1 &&
    facts.applicationBases[0].index === applicationBinding.messageIndex &&
    facts.messageFacts.every((message) => message.role === "system" || message.index === applicationBinding.messageIndex) &&
    facts.tools.length === 0 && bindingMatches(bound, applicationBinding);
  if (!matches) return { ...state, bindingError: "application_binding_mismatch" };
  return { ...state, currentAuthorIndex: null, applicationIndex: bound.index,
    bindingStatus: "external_application_binding" };
}

function addMessageBytes({ message, category, categoryBytes, categoryIndexes }) {
  categoryBytes[category] += utf8Bytes(message.text);
  categoryIndexes[category].push(message.index);
  if (message.role === "assistant") categoryBytes.history += toolArgumentBytes(message);
  return category === "unclassified" || category === "tool_unknown";
}

function summarizeCategoryBytes(facts, currentAuthorIndex) {
  const categoryBytes = emptyCategoryBytes();
  const categoryIndexes = Object.fromEntries(COST_CATEGORIES.map((category) => [category, []]));
  const toolTypes = new Map(
    facts.toolResults.map((result) => [result.messageIndex, result.type]),
  );
  let unclassifiedMessages = 0;
  for (const message of facts.messageFacts) {
    const category = categoryOf(message, currentAuthorIndex, toolTypes.get(message.index) ?? null);
    if (addMessageBytes({ message, category, categoryBytes, categoryIndexes })) {
      unclassifiedMessages += 1;
    }
    const unknownWireBytes = unknownWireContentBytes(message);
    if (unknownWireBytes > 0) {
      categoryBytes.unclassified += unknownWireBytes;
      unclassifiedMessages += 1;
    }
  }
  categoryBytes.tools = facts.toolsFieldPresent
    ? utf8Bytes(stableJson(facts.tools))
    : 0;
  return { categoryBytes, categoryIndexes, unclassifiedMessages };
}

function costEnvelope(body, categoryBytes) {
  const stable = stableJson(body);
  const stableBytes = utf8Bytes(stable);
  const contentBytes = Object.values(categoryBytes).reduce((sum, value) => sum + value, 0);
  return {
    stable,
    stableBytes,
    contentBytes,
    envelopeBytes: stableBytes - contentBytes,
  };
}

function verdictStatus(ok, bindingOk, unclassifiedOk, conservationOk, malformedOk) {
  if (ok) return "valid";
  if (!bindingOk) return "invalid";
  if (!unclassifiedOk) return "unclassified";
  return !conservationOk || !malformedOk ? "unsupported" : "unverified";
}

function verdictReason(ok, bindingOk, author, unclassifiedOk, conservationOk, malformedOk) {
  if (ok) return null;
  if (!bindingOk) return author.bindingError;
  if (!unclassifiedOk) return "unclassified_messages";
  if (!conservationOk) return "conservation_violation";
  return !malformedOk ? "malformed_tool_exchange" : "author_provenance_unverified";
}

function malformedFree(facts) {
  return facts.malformedCalls === 0 && facts.malformedToolMessages === 0;
}

function costVerdict({ envelope, unclassifiedMessages, facts, author }) {
  const conservationOk = envelope.envelopeBytes >= 0;
  const unclassifiedOk = unclassifiedMessages === 0;
  const malformedOk = malformedFree(facts);
  const bindingOk = author.bindingError === null;
  const trusted = bindingOk &&
    ["external_binding", "external_application_binding"].includes(author.bindingStatus);
  const ok = conservationOk && unclassifiedOk && malformedOk && bindingOk && trusted;
  return {
    ok,
    status: verdictStatus(ok, bindingOk, unclassifiedOk, conservationOk, malformedOk),
    reason: verdictReason(ok, bindingOk, author, unclassifiedOk, conservationOk, malformedOk),
    conservationOk,
    trusted,
  };
}

function assistantHistoryFacts(facts, categoryIndexes) {
  const assistantIndexes = categoryIndexes.history.filter(
    (index) => facts.messageFacts[index].role === "assistant",
  );
  return {
    count: assistantIndexes.length,
    textBytes: assistantIndexes.reduce(
      (sum, index) => sum + utf8Bytes(facts.messageFacts[index].text),
      0,
    ),
  };
}

function currentAuthorText(facts, author) {
  return author.currentAuthorIndex === null
    ? ""
    : facts.messageFacts[author.currentAuthorIndex].text;
}

function authorTextOccurrences(facts, author) {
  const text = currentAuthorText(facts, author);
  if (text === "") return 0;
  return facts.messageFacts.filter(
    (message) =>
      author.authorIndexes.includes(message.index) && message.text === text,
  ).length;
}

function resolvePurpose(purpose, record) {
  if (nonBlank(purpose)) return purpose;
  const step = record.step;
  if (step === "writer") return "writer";
  return nonBlank(step) ? step : null;
}

function buildCross({ facts, author, categories, purpose, contentBytes, scopeContainsAuthor }) {
  const { categoryIndexes, unclassifiedMessages } = categories;
  const assistantHistory = assistantHistoryFacts(facts, categoryIndexes);
  return {
    author_message_count: author.authorIndexes.length,
    author_text_occurrences: authorTextOccurrences(facts, author),
    current_author_index: author.currentAuthorIndex,
    history_message_count: categoryIndexes.history.length,
    history_assistant_messages: assistantHistory.count,
    replay_assistant_text_bytes: assistantHistory.textBytes,
    scope_block_count: facts.scopeMessages.filter((message) => message.index !== author.bindingIndex).length,
    observation_message_count: categoryIndexes.observation.length,
    replay_tool_calls: facts.toolCalls.length,
    scope_contains_author_bytes: scopeContainsAuthor,
    unclassified_messages: unclassifiedMessages,
    tools_field_present: facts.toolsFieldPresent === true,
    malformed_calls: facts.malformedCalls,
    malformed_tool_messages: facts.malformedToolMessages,
    purpose,
    writer_purpose: purpose === "writer",
    writer_input_bytes: purpose === "writer" ? contentBytes : null,
  };
}

export function analyzeRequestCost(
  record,
  { authorBinding = null, applicationBinding = null, purpose = null } = {},
) {
  const facts = requestFactsFromRecord(record);
  if (!facts.ok) {
    return invalidAnalysis({
      record,
      facts,
      reason: `${facts.status}:${facts.reason ?? "unknown"}`,
      status: facts.status === "malformed" ? "malformed" : "unsupported",
    });
  }

  if (facts.format !== NATIVE_CHAT_WIRE) {
    return invalidAnalysis({
      record,
      facts,
      reason: "request_cost_requires_native_chat_wire",
    });
  }

  const author = resolveSourceState(record, facts, authorBinding, applicationBinding);
  const resolvedPurpose = resolvePurpose(purpose, record);
  const categories = summarizeCategoryBytes(facts, author.currentAuthorIndex);
  const envelope = costEnvelope(facts.rawBody, categories.categoryBytes);
  const verdict = costVerdict({
    envelope,
    unclassifiedMessages: categories.unclassifiedMessages,
    facts,
    author,
  });
  const scopeContainsAuthor = scopeContainsAuthorBytes(facts, author);
  const usage = normalizeUsage(record?.response?.usage, {
    requestModel: typeof facts.rawBody?.model === "string" ? facts.rawBody.model : null,
    responseLabel: responseLabelOf(record),
  });
  const response = responseFacts(record);
  return buildAnalysis({
    record,
    facts,
    author,
    categories,
    envelope,
    verdict,
    usage,
    response,
    scopeContainsAuthor,
    purpose: resolvedPurpose,
  });
}

function scopeContainsAuthorBytes(facts, author) {
  const text = currentAuthorText(facts, author);
  return text !== "" && facts.scopeMessages.some((message) =>
    message.index !== author.bindingIndex && message.text.includes(text));
}

function trustedAuthorIndexes(author, verdict) {
  if (!verdict.trusted) return [];
  return author.bindingIndex === null ? [] : [author.bindingIndex];
}

function analysisProvenance(author, verdict) {
  const trustedIndexes = trustedAuthorIndexes(author, verdict);
  return {
    basis: verdict.ok
      ? author.bindingStatus
      : author.bindingError
        ? "external_binding_mismatch"
        : author.bindingStatus,
    trusted: verdict.trusted,
    trusted_author_messages: trustedIndexes,
    ...(author.applicationIndex !== undefined ? {
      trusted_application_messages: verdict.trusted ? [author.applicationIndex] : [],
    } : {}),
    untrusted_author_messages: author.authorIndexes.filter(
      (index) => !trustedIndexes.includes(index),
    ),
  };
}

function buildAnalysis({
  record,
  facts,
  author,
  categories,
  envelope,
  verdict,
  usage,
  response,
  scopeContainsAuthor,
  purpose,
}) {
  return {
    schema: REQUEST_COST_SCHEMA,
    ok: verdict.ok,
    status: verdict.status,
    reason: verdict.reason,
    format: facts.format,
    request: {
      sha256: sha256Hex(envelope.stable),
      stable_json_bytes: envelope.stableBytes,
      content_utf8_bytes: envelope.contentBytes,
      envelope_bytes: envelope.envelopeBytes,
      raw_http_bytes: null,
      conservation: verdict.conservationOk,
    },
    category_bytes: categories.categoryBytes,
    category_indexes: categories.categoryIndexes,
    totals: {
      content_utf8_bytes: envelope.contentBytes,
      stable_json_bytes: envelope.stableBytes,
      envelope_bytes: envelope.envelopeBytes,
      category_sum_bytes: envelope.contentBytes,
    },
    cross: buildCross({
      facts,
      author,
      categories,
      purpose,
      contentBytes: envelope.contentBytes,
      scopeContainsAuthor,
    }),
    usage,
    response,
    evidence_layers: evidenceLayers({ format: facts.format, response, usage }),
    provenance: analysisProvenance(author, verdict),
  };
}
