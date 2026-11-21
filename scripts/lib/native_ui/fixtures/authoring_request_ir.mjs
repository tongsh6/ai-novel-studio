// 测试夹具构造器：把既有 native wire 形状的测试数据显式建造成 fixture producer
// 实际写出的 canonical IR 记录。它不是生产读取路径，也不会被 reader 反向使用；
// 生产 reader 只按记录自己的 source format 读取。
export const FIXTURE_IR_VERSION = "authoring-request-ir/v1";

const APPLICATION_PREFIX = "【应用数据 · ";
const SCOPE_PREFIX = "【应用数据 · scope_update";

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
    .join("");
}

function parsedArguments(value) {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// 现役 Scope 的测试 producer；与生产 reader 独立，直接按冻结投影协议构造。
export function scopeWireMessage(content, { versions = {}, sourceRefs = [] } = {}) {
  if (!isRecord(content)) throw new Error("scope fixture content must be an object");
  return {
    role: "user",
    content: [
      "【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】",
      `版本：${JSON.stringify(versions)}`,
      `来源：${JSON.stringify(sourceRefs)}`,
      JSON.stringify(content),
    ].join("\n"),
  };
}

function scopeFromWire(text) {
  const [header, versions, sources, ...payload] = text.split("\n");
  if (header !== "【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】" ||
      !versions?.startsWith("版本：") || !sources?.startsWith("来源：")) {
    throw new Error("scope fixture requires the current structured projection");
  }
  const content = JSON.parse(payload.join("\n"));
  if (!isRecord(content)) throw new Error("scope fixture content must be an object");
  return {
    role: "scope_update",
    provenance: "application",
    blocks: [{ type: "scope", content }],
    source_refs: JSON.parse(sources.slice("来源：".length)),
    versions: JSON.parse(versions.slice("版本：".length)),
  };
}

function textBlocks(message) {
  const text = messageText(message);
  return text === "" ? [] : [{ type: "text", text }];
}

function assistantBlocks(message) {
  const blocks = [];
  const text = messageText(message);
  if (text !== "") blocks.push({ type: "text", text });
  for (const call of list(message?.tool_calls)) {
    if (!isRecord(call)) continue;
    const fn = isRecord(call.function) ? call.function : null;
    blocks.push({
      type: "tool_call",
      call_id: call.id ?? null,
      name: (fn ? fn.name ?? call.name : call.name) ?? null,
      arguments: parsedArguments(fn ? fn.arguments : call.arguments),
    });
  }
  return blocks;
}

// 当前 native 夹具只生成七字段结果；旧 flat wire 不属于现 reader 的输入。
export function toolResultContent(block) {
  const { call_id: _callId, retryable = null, budget_after = null, ...data } = block;
  const observation = data.type === "observation";
  const ok = observation ? ["ok", "partial", "truncated"].includes(data.status) : data.status === "passed";
  const diagnostic = observation ? (ok ? null : data.content?.summary) : data.detail?.message;
  const identity = observation ? data.content?.observation_ref : null;
  return JSON.stringify({
    ok,
    data,
    error_code: ok ? null : observation ? data.status : data.reason_code ?? null,
    message: typeof diagnostic === "string" ? diagnostic : null,
    retryable,
    observation_ref: typeof identity === "string" && identity.startsWith("observation:") &&
      identity.length > "observation:".length ? identity : null,
    budget_after,
  });
}

function toolBlocks(message) {
  if (typeof message?.content !== "string") return [];
  try {
    const envelope = JSON.parse(message.content);
    if (!isRecord(envelope) || !isRecord(envelope.data) ||
        !["observation", "validation_result"].includes(envelope.data.type)) {
      return [];
    }
    return [{ ...envelope.data, call_id: message.tool_call_id,
      retryable: envelope.retryable, budget_after: envelope.budget_after }];
  } catch {
    return [];
  }
}

function irMessage(message) {
  if (!isRecord(message)) return null;
  if (message.role === "assistant") {
    return {
      role: "assistant",
      provenance: "model",
      blocks: assistantBlocks(message),
      source_refs: [],
      versions: {},
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      provenance: "tool_result",
      blocks: toolBlocks(message),
      source_refs: [],
      versions: {},
    };
  }
  const text = messageText(message);
  if (message.role === "system") {
    return {
      role: "system",
      provenance: "application",
      blocks: text === "" ? [] : [{ type: "text", text }],
      source_refs: [],
      versions: {},
    };
  }
  if (message.role === "user") {
    if (text.startsWith(SCOPE_PREFIX)) return scopeFromWire(text);
    if (text.startsWith(APPLICATION_PREFIX)) {
      return {
        role: "application_base",
        provenance: "application",
        blocks: [{ type: "text", text }],
        source_refs: [],
        versions: {},
      };
    }
    return {
      role: "user",
      provenance: "author",
      blocks: [{ type: "text", text }],
      source_refs: [],
      versions: {},
    };
  }
  return {
    role: message.role,
    provenance: "application",
    blocks: textBlocks(message),
    source_refs: [],
    versions: {},
  };
}

function irTools(tools) {
  return list(tools).map((tool) => {
    if (!isRecord(tool)) return tool;
    if (typeof tool.name === "string") return tool;
    const fn = isRecord(tool.function) ? tool.function : {};
    return {
      name: fn.name ?? null,
      description: fn.description ?? "",
      input_schema: isRecord(fn.parameters) ? fn.parameters : {},
    };
  });
}

export function irBodyFromWire({
  messages = [],
  tools = [],
  tool_choice = null,
  run = {},
  system = { identity_ref: "identity:fixture" },
  refs = {},
} = {}) {
  return {
    ir_version: FIXTURE_IR_VERSION,
    run,
    system,
    messages: list(messages).map(irMessage).filter(Boolean),
    tools: irTools(tools),
    projection: { tool_choice },
    refs,
  };
}

export function irRecord(record, body) {
  return {
    ...record,
    request_format: FIXTURE_IR_VERSION,
    request_body: body,
  };
}
