// B71 §16.9 外部 native 证据的逐 call 关联（只读、纯关联、失败不回退）。
//
// 唯一关联键是 Gateway 分配的真实执行引用对：ProviderRun.id === prun，
// ProviderRun.provider_call_ref === pcall。turn/time/tool name/hash 都不参与绑定；
// canonical 定位使用 assistant 顶层 provider_call_ref/provider_run_ref，而不是仅 call_id。
import assert from "node:assert/strict";
import { NATIVE_CHAT_WIRE, requestFactsFromRecord } from "./authoring_request_facts.mjs";
import { all, withDb } from "./scenario_evidence.mjs";

export const FIXTURE_RESPONSE_FORMAT = "fixture_provider_result/v1";

const SSE_DECODER_SOURCE = "sse_decoder";

// 来源由记录自身的显式标记决定：fixture 有 response_format；真实 SSE 没有，
// 但请求必须是已识别 native wire。响应体形状只用于该来源内的校验，不做嗅探。
const RECORD_SOURCE = Object.freeze({
  FIXTURE: "fixture",
  SSE_DECODER_TOOL_ONLY: "sse_decoder_tool_only",
});

const SCOPE_FIELDS = Object.freeze([
  "run_id",
  "workspace_id",
  "work_id",
  "session_id",
  "parent_turn_ref",
]);

// agent_run_id 是读取键；其余字段是同一 ProviderRun 的归属事实。
const OWNERSHIP_FIELDS = Object.freeze([
  ["agent_run_id", "run_id"],
  ["workspace_id", "workspace_id"],
  ["work_id", "work_id"],
  ["session_id", "session_id"],
  ["parent_turn_ref", "parent_turn_ref"],
]);

const ERROR_RUN_STATUSES = Object.freeze(["failed", "cancelled"]);

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const nonBlank = (value) => typeof value === "string" && value.trim() !== "";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function verifyTranscriptRun(run, scope, add) {
  if (!isRecord(run)) {
    add("missing", "ownership", { field: "transcript.run" });
    return;
  }
  for (const field of SCOPE_FIELDS) {
    if (!nonBlank(run[field])) {
      add("missing", "ownership", { field: `transcript.run.${field}` });
    } else if (run[field] !== scope[field]) {
      add("mismatched", "ownership", { field: `transcript.run.${field}` });
    }
  }
}

function normalizeScope(scope) {
  assert(isRecord(scope), "authoring_call: scope 必须是对象");
  return Object.fromEntries(
    SCOPE_FIELDS.map((field) => {
      assert(nonBlank(scope[field]), `authoring_call: scope.${field} 必须是非空字符串`);
      return [field, scope[field]];
    }),
  );
}

function normalizeInput({ scope, transcript, providerRuns, records, consumedProviderCalls }) {
  const identity = normalizeScope(scope);
  assert(Array.isArray(providerRuns), "authoring_call: providerRuns 必须是数组");
  assert(Array.isArray(records), "authoring_call: records 必须是数组");
  assert(isRecord(transcript) && Array.isArray(transcript.messages), "authoring_call: transcript.messages 必须是数组");
  const consumed = Number.isInteger(consumedProviderCalls) ? consumedProviderCalls : null;
  return { scope: identity, transcript, providerRuns, records, consumedProviderCalls: consumed };
}

function refsOfRun(row, extra = {}) {
  const refs = { ...extra };
  if (nonBlank(row.id)) refs.provider_run_ref = row.id;
  if (nonBlank(row.provider_call_ref)) refs.provider_call_ref = row.provider_call_ref;
  return refs;
}

function verifyOwnership(row, scope, add) {
  if (!isRecord(row)) {
    add("mismatched", "ownership", {});
    return false;
  }
  if (!nonBlank(row.id) || !nonBlank(row.provider_call_ref)) {
    add("missing", "ownership", refsOfRun(row, { field: "id_or_provider_call_ref" }));
    return false;
  }
  for (const [field, scopeField] of OWNERSHIP_FIELDS) {
    if (!nonBlank(row[field]) || row[field] !== scope[scopeField]) {
      add("mismatched", "ownership", refsOfRun(row, { field }));
      return false;
    }
  }
  return true;
}

// 请求只按实际 source format 读取：fixture canonical IR 或真实原生 wire。
// 退役/未知格式、坏 body 都显式 unsupported，不回退旧 Chat 读取。
function requestFailure(record) {
  const facts = requestFactsFromRecord(record);
  return facts.ok ? null : "unsupported";
}

function okBodyFailure(response) {
  const body = response.body;
  if (!isRecord(body) || !Array.isArray(body.tool_calls)) return "unsupported";
  return body.content === null || body.content === undefined || typeof body.content === "string"
    ? null
    : "unsupported";
}

function errorBodyFailure(response) {
  // fixture v1 的真实 logger 只写 {error: ...}；成功字段不得混进 error 事实。
  return isRecord(response.body) &&
    hasOwn(response.body, "error") &&
    Object.keys(response.body).length === 1
    ? null
    : "unsupported";
}

function responseFailure(record) {
  if (!isRecord(record.response)) return "unsupported";
  if (record.response.status === "ok") return okBodyFailure(record.response);
  if (record.response.status === "error") return errorBodyFailure(record.response);
  return "unsupported";
}

function fixtureFailure(record) {
  return requestFailure(record) ?? responseFailure(record);
}

function isHttpSuccessStatus(status) {
  return Number.isInteger(status) && status >= 200 && status <= 299;
}

// 真实 SSE 成功 body 只承载 decoder 交付的工具事实；event_stream 历史占位
// 是字符串，不构成成功证据。
function sseBodyFailure(response) {
  const body = response.body;
  return isRecord(body) &&
    body.source === SSE_DECODER_SOURCE &&
    Array.isArray(body.tool_calls)
    ? null
    : "unsupported";
}

function sseFailure(record) {
  // 只认真实 Chat wire 请求；fixture IR 或其它 wire 不得借 SSE body 签字。
  const facts = requestFactsFromRecord(record);
  if (!facts.ok || facts.format !== NATIVE_CHAT_WIRE) return "unsupported";
  if (!isRecord(record.response) || !isHttpSuccessStatus(record.response.status)) {
    return "unsupported";
  }
  return sseBodyFailure(record.response);
}

function classifyRecord(record) {
  if (record.response_format === FIXTURE_RESPONSE_FORMAT) {
    return { source: RECORD_SOURCE.FIXTURE, failure: fixtureFailure(record) };
  }
  if (record.response_format !== undefined) return { failure: "unsupported" };
  const failure = sseFailure(record);
  return failure ? { failure } : { source: RECORD_SOURCE.SSE_DECODER_TOOL_ONLY, failure: null };
}

// JSON 语义等价：键顺序无关，类型/数组长度/值严格；不修补也不序列化未知对象。
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function jsonEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

// fixture v1 的 Provider.Result / IR tool_call 都是扁平 {id,name,arguments[,raw_arguments]}；
// 不兼容 HTTP 的嵌套 function 形状。真实 producer 取值语义：
// raw_arguments || arguments，字符串原文保留为 raw，JSON 对象取该对象，不可解析/非对象解析为 {}。
function decodeArgumentsObject(raw) {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parsedArgumentObject(supplied) {
  if (isRecord(supplied)) return supplied;
  if (typeof supplied === "string") return decodeArgumentsObject(supplied);
  return null;
}

function unsupportedRawShape(hasRaw, raw, supplied) {
  if (!hasRaw) return false;
  if (typeof raw !== "string") return true;
  return typeof supplied === "string";
}

// 单一比较事实：{raw: 原始字节|null, parsed: 解析对象}。
// 不选择一侧、不补齐缺失字段。
function argumentsFact(call) {
  if (!isRecord(call)) return { failure: "encode_failed" };
  if (!hasOwn(call, "arguments")) return { failure: "encode_failed" };
  const supplied = call.arguments;
  const hasRaw = hasOwn(call, "raw_arguments");
  // 只支持 parsed-only、raw+parsed、arguments-string 三种 producer 形状；
  // raw 与 arguments 字符串并存不是真实形状，不能靠选择一侧静默通过。
  if (unsupportedRawShape(hasRaw, call.raw_arguments, supplied)) {
    return { failure: "encode_failed" };
  }
  const parsed = parsedArgumentObject(supplied);
  if (parsed === null) return { failure: "encode_failed" };
  if (!hasRaw) return { fact: { raw: typeof supplied === "string" ? supplied : null, parsed } };
  return { fact: { raw: call.raw_arguments, parsed } };
}

function rawFactFailure(canonicalRaw, responseRaw) {
  if (canonicalRaw === null && responseRaw === null) return null;
  if (canonicalRaw === null || responseRaw === null) return "encode_failed";
  return canonicalRaw === responseRaw ? null : "mismatched";
}

function parsedFactFailure(canonical, response) {
  // raw 是权威：两侧 raw 已相等时，核对 parsed 确实来自该原文，再核对两侧 parsed 一致。
  const { raw, parsed } = canonical.fact;
  if (raw !== null && !jsonEqual(parsed, decodeArgumentsObject(raw))) return "mismatched";
  return jsonEqual(parsed, response.fact.parsed) ? null : "mismatched";
}

function compareArguments(block, call) {
  const canonical = argumentsFact(block);
  if (canonical.failure) return canonical.failure;
  const response = argumentsFact(call);
  if (response.failure) return response.failure;
  // raw 是权威：一侧带原文时另一侧必须带且逐字相等；合法空白不 trim。
  const rawFailure = rawFactFailure(canonical.fact.raw, response.fact.raw);
  if (rawFailure) return rawFailure;
  return parsedFactFailure(canonical, response);
}

const NATIVE_ID = Object.freeze({
  PROVIDED: "provided",
  NOT_PROVIDED: "not_provided",
  SAME_AS_CALL_ID: "same_as_call_id",
  INVALID: "invalid",
});

// raw response 的 id 可选：缺失/null 是“未提供”，空白/非字符串是非法来源。
function responseNativeId(call) {
  if (!isRecord(call)) return { status: NATIVE_ID.INVALID };
  // `== null` 同时覆盖 missing(undefined) 与显式 null；空白/非字符串仍走 INVALID。
  if (!hasOwn(call, "id") || call.id == null) {
    return { status: NATIVE_ID.NOT_PROVIDED };
  }
  return nonBlank(call.id)
    ? { status: NATIVE_ID.PROVIDED, value: call.id }
    : { status: NATIVE_ID.INVALID };
}

// canonical 的 provider_call_id 是原 id 来源标记：
// - 缺 key：原 id 与内部 call_id 相同；
// - nil：Provider 未提供原 id（显式缺失标记）；
// - 字符串：重复原 id 的私有映射。
function canonicalNativeId(block) {
  if (!isRecord(block) || !nonBlank(block.call_id)) return { status: NATIVE_ID.INVALID };
  if (!hasOwn(block, "provider_call_id")) {
    return { status: NATIVE_ID.SAME_AS_CALL_ID, value: block.call_id };
  }
  if (block.provider_call_id === null) return { status: NATIVE_ID.NOT_PROVIDED };
  return nonBlank(block.provider_call_id)
    ? { status: NATIVE_ID.PROVIDED, value: block.provider_call_id }
    : { status: NATIVE_ID.INVALID };
}

// 缺 key 只在 raw 确有 id 且与 call_id 相同时成立；raw 无 id 是旧数据缺来源，
// 不能把内部 call_id 冒充 Provider 原 id。
function compareSameAsCallId(raw, canonical, refs, add) {
  if (raw.status === NATIVE_ID.NOT_PROVIDED) {
    add("missing", "success", { ...refs, field: "native_id_provenance" });
  } else if (raw.value !== canonical.value) {
    add("mismatched", "success", { ...refs, field: "native_id" });
  }
}

function compareNotProvided(raw, refs, add, nativeIdState) {
  if (raw.status === NATIVE_ID.NOT_PROVIDED) {
    nativeIdState.notProvided += 1;
  } else {
    add("mismatched", "success", { ...refs, field: "native_id" });
  }
}

function compareProvidedNativeId(raw, canonical, refs, add) {
  if (raw.status === NATIVE_ID.NOT_PROVIDED || raw.value !== canonical.value) {
    add("mismatched", "success", { ...refs, field: "native_id" });
  }
}

function compareNativeId(call, block, refs, add, nativeIdState) {
  const raw = responseNativeId(call);
  const canonical = canonicalNativeId(block);
  if (raw.status === NATIVE_ID.INVALID || canonical.status === NATIVE_ID.INVALID) {
    add("encode_failed", "success", { ...refs, field: "native_id" });
  } else if (canonical.status === NATIVE_ID.SAME_AS_CALL_ID) {
    compareSameAsCallId(raw, canonical, refs, add);
  } else if (canonical.status === NATIVE_ID.NOT_PROVIDED) {
    compareNotProvided(raw, refs, add, nativeIdState);
  } else {
    compareProvidedNativeId(raw, canonical, refs, add);
  }
}

function compareToolName(call, block, refs, add) {
  const name = isRecord(call) ? call.name : undefined;
  if (!nonBlank(name) || name !== block.name) {
    add("mismatched", "success", { ...refs, field: "tool_name" });
  }
}

function compareCallArguments(call, block, refs, add) {
  const failure = compareArguments(block, call);
  if (failure) add(failure, "success", { ...refs, field: "arguments" });
}

function compareCall(call, block, refs, add, nativeIdState) {
  compareNativeId(call, block, refs, add, nativeIdState);
  compareToolName(call, block, refs, add);
  compareCallArguments(call, block, refs, add);
}

function compareAssistantText(message, body, refs, add) {
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  const textBlocks = blocks.filter((block) => block.type === "text");
  if (textBlocks.some((block) => typeof block.text !== "string")) {
    add("encode_failed", "success", { ...refs, field: "assistant_text" });
    return;
  }
  const canonicalText = textBlocks.map((block) => block.text).join("");
  const responseText = body.content === null || body.content === undefined ? "" : body.content;
  if (canonicalText !== responseText) {
    add("mismatched", "success", { ...refs, field: "assistant_text" });
  }
}

function compareAssistantCalls(message, body, refs, add, nativeIdState) {
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  const toolBlocks = blocks.filter((block) => block.type === "tool_call");
  if (!Array.isArray(body.tool_calls) || body.tool_calls.length !== toolBlocks.length) {
    add("mismatched", "success", { ...refs, field: "call_count" });
  }
  const count = Math.min(body.tool_calls.length, toolBlocks.length);
  for (let index = 0; index < count; index += 1) {
    compareCall(
      body.tool_calls[index],
      toolBlocks[index],
      { ...refs, call_index: index },
      add,
      nativeIdState,
    );
  }
}

function compareAssistant(message, body, refs, add, nativeIdState) {
  compareAssistantText(message, body, refs, add);
  compareAssistantCalls(message, body, refs, add, nativeIdState);
}

function assistantRef(message) {
  if (message.role !== "assistant") return null;
  const pcall = nonBlank(message.provider_call_ref) ? message.provider_call_ref : null;
  const prun = nonBlank(message.provider_run_ref) ? message.provider_run_ref : null;
  if (!pcall && !prun) return null;
  return { pcall, prun };
}

function canonicalRefFailure(ref, runsByPrun) {
  const row = ref.prun ? runsByPrun.get(ref.prun) : null;
  return !row || row.provider_call_ref !== ref.pcall ? "mismatched" : null;
}

function canonicalBoundMessages(messages, runsByPrun, add) {
  const seen = new Set();
  for (const [index, message] of messages.entries()) {
    if (message.role !== "assistant") continue;
    const ref = assistantRef(message);
    if (!ref) {
      // 旧数据缺 ref 不得补造，也不能因“没 ref 就跳过”而被静默夹带。
      add("missing", "binding", { message_index: index, field: "assistant_refs" });
      continue;
    }
    const refs = {
      message_index: index,
      provider_run_ref: ref.prun,
      provider_call_ref: ref.pcall,
    };
    const failure = canonicalRefFailure(ref, runsByPrun);
    if (failure) {
      add(failure, "binding", { ...refs, field: "assistant_refs" });
      continue;
    }
    const key = `${ref.prun}\u0000${ref.pcall}`;
    if (seen.has(key)) {
      add("duplicate", "binding", { ...refs, field: "assistant" });
    } else {
      seen.add(key);
    }
  }
}

function collectRuns(providerRuns, scope, add) {
  const runs = [];
  const seenRunRefs = new Set();
  const seenCallRefs = new Set();
  for (const row of providerRuns) {
    if (!verifyOwnership(row, scope, add)) continue;
    if (seenRunRefs.has(row.id) || seenCallRefs.has(row.provider_call_ref)) {
      add("duplicate", "binding", refsOfRun(row));
      continue;
    }
    seenRunRefs.add(row.id);
    seenCallRefs.add(row.provider_call_ref);
    runs.push(row);
  }
  return runs;
}

function recordRefs(record) {
  return {
    pcall: nonBlank(record.provider_call_ref) ? record.provider_call_ref : null,
    prun: nonBlank(record.provider_run_ref) ? record.provider_run_ref : null,
  };
}

function pairRuns(pcall, prun, runsByPrun, runsByCall) {
  return {
    runByPrun: prun ? runsByPrun.get(prun) : null,
    runByCall: pcall ? runsByCall.get(pcall) : null,
  };
}

function pairFailure(pcall, prun, runByPrun, runByCall) {
  if (!pcall || !prun) return "missing";
  return runByPrun === runByCall ? null : "mismatched";
}

function resolvePair(record, runsByPrun, runsByCall) {
  const { pcall, prun } = recordRefs(record);
  const { runByPrun, runByCall } = pairRuns(pcall, prun, runsByPrun, runsByCall);
  const refs = { provider_run_ref: prun, provider_call_ref: pcall };
  if (!runByPrun && !runByCall) return { foreign: true, refs };
  const reason = pairFailure(pcall, prun, runByPrun, runByCall);
  return reason ? { reason, refs } : { run: runByPrun, refs };
}

// workSessionFailure/workspaceFailure 对 ProviderRun 核对；ProviderRun 已在 verifyOwnership
// 逐字段等于 scope，无需重复比较同一事实。
function workSessionFailure(record, row) {
  for (const field of ["work_id", "session_id"]) {
    if (!nonBlank(record[field])) return { reason: "missing", field };
    if (record[field] !== row[field]) return { reason: "mismatched", field };
  }
  return null;
}

function workspaceFailure(record, row) {
  if (!hasOwn(record, "workspace_id")) return null;
  if (!nonBlank(record.workspace_id)) return { reason: "missing", field: "workspace_id" };
  return record.workspace_id === row.workspace_id
    ? null
    : { reason: "mismatched", field: "workspace_id" };
}

const AGENT_STEP_TURN = /:agent:[1-9][0-9]*$/;

function turnScopeFailure(record, scope) {
  if (!nonBlank(record.turn_id) || record.turn_id === scope.parent_turn_ref) return null;
  const suffix = AGENT_STEP_TURN.exec(record.turn_id);
  // 只有精确已知的末尾 :agent:正整数 才是父轮次证据；其它格式按 pcall 归属，不猜父子关系。
  if (!suffix) return null;
  const parent = record.turn_id.slice(0, suffix.index);
  return parent === scope.parent_turn_ref
    ? null
    : { reason: "mismatched", field: "turn_id" };
}

function recordScopeFailure(record, row, scope) {
  return (
    workSessionFailure(record, row) ??
    workspaceFailure(record, row) ??
    turnScopeFailure(record, scope)
  );
}

function joinScopedRecords({ records, runsByPrun, runsByCall, scope, add }) {
  const bound = new Map();
  const scopedRecords = [];
  for (const [index, record] of records.entries()) {
    if (!isRecord(record)) continue;
    const pair = resolvePair(record, runsByPrun, runsByCall);
    if (pair.foreign) continue;
    const refs = { ...pair.refs, record_index: index };
    if (pair.reason) {
      add(pair.reason, "binding", refs);
      continue;
    }
    const scopeFailure = recordScopeFailure(record, pair.run, scope);
    if (scopeFailure) {
      add(scopeFailure.reason, "binding", { ...refs, field: scopeFailure.field });
      continue;
    }
    if (bound.has(pair.run.id)) {
      add("duplicate", "binding", refs);
      continue;
    }
    const classified = classifyRecord(record);
    if (classified.failure) {
      add(classified.failure, "binding", refs);
      continue;
    }
    bound.set(pair.run.id, { row: pair.run, record, source: classified.source });
    scopedRecords.push(record);
  }
  return { bound, scopedRecords };
}

function assistantMatches(assistantMessages, pcall, prun) {
  return {
    matching: assistantMessages.filter(
      (message) => message.provider_call_ref === pcall && message.provider_run_ref === prun,
    ),
    partial: assistantMessages.filter(
      (message) =>
        (message.provider_call_ref === pcall) !== (message.provider_run_ref === prun),
    ),
  };
}

// SSE 日志不记录正文，只对账 decoder 交付的工具事实；fixture 仍核对完整正文。
function compareSuccessBody(source, message, body, refs, add, nativeIdState) {
  if (source === RECORD_SOURCE.SSE_DECODER_TOOL_ONLY) {
    compareAssistantCalls(message, body, refs, add, nativeIdState);
    return;
  }
  compareAssistant(message, body, refs, add, nativeIdState);
}

function checkSuccessPair({ assistantMessages, row, record, source, add, nativeIdState }) {
  const refs = refsOfRun(row);
  if (row.status !== "completed") {
    add("mismatched", "success", { ...refs, field: "run_status" });
    return;
  }
  const { matching, partial } = assistantMatches(
    assistantMessages,
    row.provider_call_ref,
    row.id,
  );
  if (matching.length === 0) {
    add("missing", "success", { ...refs, field: "assistant" });
    return;
  }
  if (matching.length > 1) {
    add("duplicate", "success", { ...refs, field: "assistant" });
    return;
  }
  if (partial.length > 0) {
    add("mismatched", "success", { ...refs, field: "assistant_refs" });
  }
  compareSuccessBody(source, matching[0], record.response.body, refs, add, nativeIdState);
}

function checkErrorPair({ assistantMessages, row, add }) {
  const refs = refsOfRun(row);
  if (!ERROR_RUN_STATUSES.includes(row.status)) {
    add("mismatched", "error", { ...refs, field: "run_status" });
  }
  const leaked = assistantMessages.filter(
    (message) =>
      message.provider_call_ref === row.provider_call_ref || message.provider_run_ref === row.id,
  );
  if (leaked.length > 0) {
    add("mismatched", "error", { ...refs, field: "assistant" });
  }
}

function checkPairs({ bound, assistantMessages, add, nativeIdState }) {
  for (const { row, record, source } of bound.values()) {
    if (source === RECORD_SOURCE.SSE_DECODER_TOOL_ONLY || record.response.status === "ok") {
      checkSuccessPair({ assistantMessages, row, record, source, add, nativeIdState });
    } else {
      checkErrorPair({ assistantMessages, row, add });
    }
  }
}

function countBoundPairs(bound) {
  let completed = 0;
  let errors = 0;
  let sseToolOnly = 0;
  for (const { record, source } of bound.values()) {
    if (source === RECORD_SOURCE.SSE_DECODER_TOOL_ONLY) sseToolOnly += 1;
    if (source === RECORD_SOURCE.FIXTURE && record.response.status === "error") errors += 1;
    else completed += 1;
  }
  return { completed, errors, sseToolOnly };
}

function validateCanonicalCallIds(messages, add) {
  const seen = new Set();
  for (const [messageIndex, message] of messages.entries()) {
    if (message.role !== "assistant") continue;
    const blocks = Array.isArray(message.blocks) ? message.blocks : [];
    for (const [callIndex, block] of blocks.entries()) {
      if (!isRecord(block) || block.type !== "tool_call") continue;
      const refs = { message_index: messageIndex, call_index: callIndex };
      if (!nonBlank(block.call_id)) {
        add("missing", "canonical", { ...refs, field: "call_id" });
        continue;
      }
      if (seen.has(block.call_id)) {
        add("duplicate", "canonical", { ...refs, call_id: block.call_id });
      } else {
        seen.add(block.call_id);
      }
    }
  }
}

function buildChecks({ runs, failures, countsMatch }) {
  const hasPhase = (phase) => failures.some((failure) => failure.phase === phase);
  const ownershipClean = runs.length > 0 && !hasPhase("ownership");
  const canonicalClean = !hasPhase("canonical");
  // 内部 call_id 重复/为空使整个 run 调用图不唯一，不能再宣称配对成功。
  const bindingClean = ownershipClean && !hasPhase("binding") && canonicalClean;
  return {
    native_call_pairs_owned: ownershipClean,
    native_call_pairs_bound: bindingClean,
    native_call_success_matches_canonical: bindingClean && !hasPhase("success"),
    native_call_errors_have_no_assistant: bindingClean && !hasPhase("error"),
    native_call_counts_match_consumed: bindingClean && countsMatch,
  };
}

export function joinNativeCallEvidence(input) {
  const { scope, transcript, providerRuns, records, consumedProviderCalls } =
    normalizeInput(input);
  const failures = [];
  const add = (reason, phase, refs = {}) => failures.push({ reason, phase, refs });

  verifyTranscriptRun(transcript.run, scope, add);
  const runs = collectRuns(providerRuns, scope, add);
  const runsByPrun = new Map(runs.map((row) => [row.id, row]));
  const runsByCall = new Map(runs.map((row) => [row.provider_call_ref, row]));
  const messages = transcript.messages.filter((message) => isRecord(message));
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  canonicalBoundMessages(messages, runsByPrun, add);
  validateCanonicalCallIds(messages, add);
  const nativeIdState = { notProvided: 0 };

  const { bound, scopedRecords } = joinScopedRecords({
    records,
    runsByPrun,
    runsByCall,
    scope,
    add,
  });
  for (const row of runs) {
    if (!bound.has(row.id)) add("missing", "binding", refsOfRun(row));
  }
  checkPairs({ bound, assistantMessages, add, nativeIdState });

  const { completed, errors, sseToolOnly } = countBoundPairs(bound);
  const counts = {
    provider_runs: runs.length,
    bound_requests: bound.size,
    completed,
    errors,
    consumed_provider_calls: consumedProviderCalls,
  };
  const countsMatch =
    runs.length > 0 &&
    consumedProviderCalls === runs.length &&
    bound.size === runs.length &&
    completed + errors === runs.length;
  if (!countsMatch) {
    add(consumedProviderCalls === null ? "missing" : "mismatched", "counts", {
      field: "provider_calls",
    });
  }

  // VS-00L §6.4（2026-11-06 作者裁决 D）：有限模式进入持久事实后，验收读侧必须能
  // 报告本次运行是否受限；这里只做可读报告，不改变既有 PASS 判据（PASS 必要条件
  // 的启用留给后续批次单独裁决，旧证据不回溯）。
  const finiteModes = runs.map((row) => ({
    provider_run_ref: row.id,
    provider_call_ref: row.provider_call_ref,
    finite_mode_name: nonBlank(row.finite_mode_name) ? row.finite_mode_name : null,
  }));

  return {
    records: scopedRecords,
    finite_modes: {
      restricted: finiteModes.filter((item) => item.finite_mode_name !== null),
      complete_count: finiteModes.filter((item) => item.finite_mode_name === null).length,
    },
    refs: {
      provider_run_refs: runs.map((row) => row.id),
      provider_call_refs: runs.map((row) => row.provider_call_ref),
    },
    counts,
    checks: buildChecks({ runs, failures, countsMatch }),
    measured: {
      provider_run_refs: runs.map((row) => row.id),
      provider_call_refs: runs.map((row) => row.provider_call_ref),
      provider_run_count: counts.provider_runs,
      bound_request_count: counts.bound_requests,
      completed_count: counts.completed,
      error_count: counts.errors,
      consumed_provider_calls: counts.consumed_provider_calls,
      native_id_not_provided: nativeIdState.notProvided,
      // 真实 SSE 日志不记录正文，只能作为 tool-only 证据；fixture 仍做完整正文对账。
      sse_decoder_tool_only_count: sseToolOnly,
    },
    failures,
  };
}

// DB 边界只负责按 agent_run_id 读取；ownership 由纯函数再次逐字段核对。
export function readProviderRuns(dir, scope) {
  const identity = normalizeScope(scope);
  return withDb(dir, (db) =>
    all(
      db,
      "SELECT * FROM provider_runs WHERE agent_run_id = ? ORDER BY id",
      [identity.run_id],
    ),
  );
}
