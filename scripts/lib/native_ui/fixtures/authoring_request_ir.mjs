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

function applicationRole(text) {
  return text.startsWith(SCOPE_PREFIX) ? "scope_update" : "application_base";
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

function toolBlocks(message) {
  if (typeof message?.content !== "string") return [];
  try {
    const payload = JSON.parse(message.content);
    if (!isRecord(payload) || !["observation", "validation_result"].includes(payload.type)) {
      return [];
    }
    return [payload];
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
    if (text.startsWith(APPLICATION_PREFIX)) {
      return {
        role: applicationRole(text),
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
