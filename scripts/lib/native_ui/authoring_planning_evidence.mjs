// B71：从实际请求与持久 canonical 事实核验计划消费链；本模块无 I/O。
import { isDeepStrictEqual } from "node:util";
const STAGES = Object.freeze([
  "agent_plan_draft", "agent_plan_revision",
  "submit_tentative_artifact", "submit_tentative_artifact",
]);
const CALLS = Object.freeze(["judgment_decision", ...STAGES]);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function invalid(path, expected) {
  throw new TypeError(`invalid_planning_evidence: ${path} must be ${expected}`);
}

function requireArray(value, path) {
  if (!Array.isArray(value)) invalid(path, "an array");
  return value;
}

function requireRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path, "an object");
  return value;
}

function requireString(value, path) {
  if (typeof value !== "string") invalid(path, "a string");
  return value;
}

function optionalArray(value, path) {
  return value == null ? [] : requireArray(value, path);
}

function optionalRecord(value, path) {
  return value == null ? {} : requireRecord(value, path);
}

function parseToolName(value, path) {
  const tool = requireRecord(value, path);
  if (tool.function == null) return requireString(tool.name, `${path}.name`);
  return requireString(requireRecord(tool.function, `${path}.function`).name, `${path}.function.name`);
}

const CONTROL_CHOICES = Object.freeze(["auto", "required", "none"]);

// provider 中立桥把具名 choice 发成裸工具名，OpenAI 形状发成 function 对象；
// 两者在此统一为 named，控制词保持 literal，工具身份仍由阶段检查精确匹配。
function parseChoice(value, path) {
  if (value == null) return { kind: "missing" };
  if (typeof value === "string") {
    return CONTROL_CHOICES.includes(value)
      ? { kind: "literal", value }
      : { kind: "named", value };
  }
  const choice = requireRecord(value, path);
  if (requireString(choice.type, `${path}.type`) !== "function") return { kind: "other" };
  const fn = requireRecord(choice.function, `${path}.function`);
  return { kind: "named", value: requireString(fn.name, `${path}.function.name`) };
}

function parseWireResult(message, path) {
  if (message.role !== "tool") return null;
  const id = requireString(message.tool_call_id, `${path}.tool_call_id`);
  const content = requireString(message.content, `${path}.content`);
  let payload;
  try { payload = JSON.parse(content); } catch { invalid(`${path}.content`, "native result JSON"); }
  requireRecord(payload, `${path}.content`);
  requireString(payload.type, `${path}.content.type`);
  requireString(payload.status, `${path}.content.status`);
  if (payload.call_id !== id) invalid(`${path}.content.call_id`, "the original tool_call_id");
  return { ...payload, detail: optionalRecord(payload.detail, `${path}.content.detail`) };
}

function parseWireMessage(value, path) {
  const message = requireRecord(value, path);
  requireString(message.role, `${path}.role`);
  const calls = optionalArray(message.tool_calls, `${path}.tool_calls`).map((call, index) => {
    const callPath = `${path}.tool_calls[${index}]`;
    const name = parseToolName(call, callPath);
    return { id: requireString(call.id, `${callPath}.id`), name };
  });
  if (calls.length > 0 && message.role !== "assistant") invalid(path, "an assistant tool-call message");
  return { source: message, calls, result: parseWireResult(message, path) };
}

function parseBody(value, index) {
  const path = `bodies[${index}]`;
  const body = requireRecord(value, path);
  const messages = requireArray(body.messages, `${path}.messages`)
    .map((message, ordinal) => parseWireMessage(message, `${path}.messages[${ordinal}]`));
  return {
    messages: messages.map((message) => message.source),
    calls: messages.flatMap((message) => message.calls),
    results: messages.flatMap((message) => message.result ? [message.result] : []),
    names: requireArray(body.tools, `${path}.tools`).map((tool, ordinal) => parseToolName(tool, `${path}.tools[${ordinal}]`)),
    choice: parseChoice(body.tool_choice, `${path}.tool_choice`),
  };
}

function parseCanonicalBlock(value, path) {
  const block = requireRecord(value, path);
  requireString(block.type, `${path}.type`);
  if (block.type === "tool_call") {
    requireString(block.call_id, `${path}.call_id`);
    requireString(block.name, `${path}.name`);
  }
  if (["validation_result", "observation"].includes(block.type)) {
    requireString(block.call_id, `${path}.call_id`);
    requireString(block.status, `${path}.status`);
    return { ...block, detail: optionalRecord(block.detail, `${path}.detail`) };
  }
  return block;
}

function parseCanonicalMessage(value, index) {
  const path = `messages[${index}]`;
  const message = requireRecord(value, path);
  requireString(message.role, `${path}.role`);
  const blocks = requireArray(message.blocks, `${path}.blocks`)
    .map((block, ordinal) => parseCanonicalBlock(block, `${path}.blocks[${ordinal}]`));
  return { ...message, blocks };
}

// 边界只解析一次；调用判定不再用空数组或备用名称掩盖类型错误。
function parseEvidence(value) {
  const evidence = requireRecord(value, "evidence");
  return {
    ...evidence,
    bodies: requireArray(evidence.bodies, "bodies").map(parseBody),
    messages: requireArray(evidence.messages, "messages").map(parseCanonicalMessage),
  };
}

const toolNames = (body) => body.names;
const canonicalCalls = (messages) => messages.flatMap((message) =>
  message.blocks.filter((block) => block.type === "tool_call")
    .map((block) => ({ id: block.call_id, name: block.name })),
);

const canonicalResults = (messages) => messages.flatMap((message) =>
  message.blocks.filter((block) => ["validation_result", "observation"].includes(block.type)),
);

function requestPrefixPreserved(bodies) {
  return bodies.length === CALLS.length && bodies.slice(1).every((body, index) => {
    const previous = bodies[index].messages;
    return body.messages.length > previous.length &&
      same(body.messages.slice(0, previous.length), previous);
  });
}

function judgmentCatalogMatches(body) {
  return body.names.includes("judgment_decision") && new Set(body.names).size === body.names.length &&
    body.choice.kind === "literal" && body.choice.value === "auto";
}

function stageToolsMatch(bodies) {
  return bodies.length === CALLS.length && judgmentCatalogMatches(bodies[0]) && bodies.slice(1).every((body, index) => {
    if (!same(body.names, [STAGES[index]])) return false;
    if (index < 2) return body.choice.kind === "literal" && body.choice.value === "auto";
    return body.choice.kind === "named" && body.choice.value === STAGES[index];
  });
}

function historyMatchesRequests(bodies, calls, results) {
  return same(calls.map((call) => call.name), CALLS) &&
    bodies.length === calls.length && results.length === calls.length && bodies.every((body, index) =>
      same(body.calls, calls.slice(0, index)) && isDeepStrictEqual(body.results, results.slice(0, index)),
    );
}

function acceptCalls(state, blocks) {
  const calls = blocks.filter((block) => block.type === "tool_call");
  return calls.every((call) => {
    if (!call.call_id || state.seen.has(call.call_id)) return false;
    state.seen.add(call.call_id);
    state.pending.add(call.call_id);
    return true;
  });
}

function acceptResults(state, blocks) {
  return blocks.length > 0 && blocks.every((result) => {
    if (!["validation_result", "observation"].includes(result.type)) return false;
    if (!["passed", "ok"].includes(result.status) || !state.pending.has(result.call_id)) return false;
    state.pending.delete(result.call_id);
    return true;
  });
}

function acceptMessage(state, message) {
  const blocks = message.blocks;
  if (message.role === "tool") return acceptResults(state, blocks);
  if (state.pending.size > 0) return false;
  if (message.role === "assistant") return acceptCalls(state, blocks);
  return !blocks.some((block) => block.type === "tool_call");
}

function exchangesClosed(messages) {
  const state = { seen: new Set(), pending: new Set() };
  return messages.every((message) => acceptMessage(state, message)) &&
    state.seen.size === CALLS.length && state.pending.size === 0;
}

function planValidationBoundary(messages, calls) {
  const planIds = calls.filter((call) => call.name.startsWith("agent_plan_")).map((call) => call.id);
  const results = messages.flatMap((message) => message.blocks).filter((block) =>
    block.type === "validation_result" && planIds.includes(block.call_id),
  );
  return planIds.length === 2 && results.length === 2 && results.every((result) =>
    result.status === "passed" && result.detail.execution_authorized === false &&
    result.detail.canon_written === false,
  );
}

export function planningProtocolEvidence(evidence) {
  const { bodies, messages, planVersion, replans, providerCalls } = parseEvidence(evidence);
  const calls = canonicalCalls(messages);
  return {
    checks: {
      planning_stage_order: same(bodies.slice(1).map(toolNames), STAGES.map((name) => [name])),
      planning_request_prefix: requestPrefixPreserved(bodies),
      planning_stage_tools: stageToolsMatch(bodies),
      canonical_history_matches_requests: historyMatchesRequests(bodies, calls, canonicalResults(messages)),
      canonical_exchanges_closed: exchangesClosed(messages),
      plan_validation_does_not_authorize_execution: planValidationBoundary(messages, calls),
      plan_revision_committed_once: planVersion === 2 && replans === 1,
      provider_budget_matches_requests: bodies.length === CALLS.length && providerCalls === bodies.length,
    },
    measured: {
      request_count: bodies.length,
      stage_tools: bodies.map(toolNames),
      canonical_calls: calls,
      plan_version: planVersion,
      replans,
      provider_calls: providerCalls,
    },
  };
}

// 以事件发生时间核对，避免异步日志晚落盘被误认为 Why 触发了新调用。
export function providerFreeInterval({ appRecords, llmRecords, start, end }) {
  const from = Date.parse(start);
  const until = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until < from) return false;
  const starts = appRecords.filter((record) => record.event === "provider_gateway.complete.start");
  if (starts.length === 0 || llmRecords.length === 0) return false;
  const timestamps = [...starts.map((record) => record.timestamp), ...llmRecords.map((record) => record.ts)];
  return timestamps.every((value) => {
    const time = Date.parse(value);
    return Number.isFinite(time) && (time < from || time > until);
  });
}
