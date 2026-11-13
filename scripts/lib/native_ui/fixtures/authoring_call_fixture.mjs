// B71 §16.9 逐调用外部证据的纯数据 fixture owner。
//
// 只放普通 JS 值/纯构造函数，不 import 被测实现、不读文件、不创建 SQLite/run scope。
// 由 `../authoring_call_evidence.test.mjs` 的纯判定与
// `../authoring_call_evidence_io.test.mjs` 的真实读边界共同消费；SQLite schema/seed
// 留在邻接的 `authoring_call_db_fixture.mjs`，不让本模块加载 SQLite。

export const RUN = "run-target";
export const WORK = "work-target";
export const WORKSPACE = "workspace-channel-7";
export const SESSION = "session-target";
export const PARENT = "message-parent";

export const scope = (overrides = {}) => ({
  run_id: RUN,
  workspace_id: WORKSPACE,
  work_id: WORK,
  session_id: SESSION,
  parent_turn_ref: PARENT,
  ...overrides,
});

export const pair = (n, overrides = {}) => ({
  id: `prun-${n}`,
  provider_call_ref: `pcall-${n}`,
  agent_run_id: RUN,
  workspace_id: WORKSPACE,
  work_id: WORK,
  session_id: SESSION,
  parent_turn_ref: PARENT,
  status: "completed",
  ...overrides,
});

export const call = (id, name, args, extra = {}) => ({ id, name, arguments: args, ...extra });

export function exchange(n, { status = "ok", content = "", calls = [], refs = {}, ...overrides } = {}) {
  const providerCallRef = refs.providerCallRef ?? `pcall-${n}`;
  const providerRunRef = refs.providerRunRef ?? `prun-${n}`;
  return {
    provider: "slice_verify",
    request_format: "authoring-request-ir/v1",
    response_format: "fixture_provider_result/v1",
    provider_call_ref: providerCallRef,
    provider_run_ref: providerRunRef,
    work_id: WORK,
    session_id: SESSION,
    turn_id: `${PARENT}:agent:${n}`,
    request_body: {
      ir_version: "authoring-request-ir/v1",
      run: scope(),
      system: { identity_ref: "identity:writer" },
      messages: [
        {
          role: "user",
          provenance: "author",
          blocks: [{ type: "text", text: `request-${n}` }],
          source_refs: [],
          versions: {},
        },
      ],
      tools: [],
      projection: { tool_choice: null },
      refs: {},
    },
    response:
      status === "ok"
        ? { status: "ok", body: { content, tool_calls: calls } }
        : { status: "error", body: { error: { reason: "transport_failed" } } },
    ...overrides,
  };
}

export const assistant = (n, blocks, overrides = {}) => ({
  role: "assistant",
  provenance: "model",
  provider_call_ref: `pcall-${n}`,
  provider_run_ref: `prun-${n}`,
  blocks,
  ...overrides,
});

export function base() {
  return {
    scope: scope(),
    providerRuns: [pair(1)],
    records: [
      exchange(1, {
        content: "已核对全章。",
        calls: [call("native-judgment", "judgment_decision", { action: "read" })],
      }),
    ],
    transcript: {
      run: scope(),
      messages: [
        { role: "user", blocks: [{ type: "text", text: "核对全章" }] },
        assistant(1, [
          { type: "text", text: "已核对全章。" },
          { type: "tool_call", call_id: "native-judgment", name: "judgment_decision", arguments: { action: "read" } },
        ]),
      ],
    },
    consumedProviderCalls: 1,
  };
}

// 74492267 之后的真实 SSE 成功日志：无 request_format/response_format，
// request.body 是原生 Chat wire，response.status 是 2xx 数字，
// response.body 只有 {source: "sse_decoder", tool_calls: Result.tool_calls}。
export function sseRequest(n) {
  return {
    method: "POST",
    url: "https://provider.test/v1/chat/completions",
    body: {
      model: "test-model",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: `request-${n}` },
      ],
      tools: [],
    },
  };
}

export function sseExchange(n, { calls = [], refs = {}, status = 200, source = "sse_decoder", body } = {}) {
  const providerCallRef = refs.providerCallRef ?? `pcall-${n}`;
  const providerRunRef = refs.providerRunRef ?? `prun-${n}`;
  return {
    provider: "openai_chat",
    provider_call_ref: providerCallRef,
    provider_run_ref: providerRunRef,
    work_id: WORK,
    session_id: SESSION,
    turn_id: `${PARENT}:agent:${n}`,
    request: sseRequest(n),
    response: {
      status,
      body: body === undefined ? { source, tool_calls: calls } : body,
      model: "test-model",
      usage: {},
      duration_ms: 10,
    },
  };
}

export function sseBase() {
  return {
    scope: scope(),
    providerRuns: [pair(1)],
    records: [
      sseExchange(1, { calls: [call("native-judgment", "judgment_decision", { action: "read" })] }),
    ],
    transcript: {
      run: scope(),
      messages: [
        { role: "user", blocks: [{ type: "text", text: "核对全章" }] },
        assistant(1, [
          { type: "text", text: "已核对全章。" },
          { type: "tool_call", call_id: "native-judgment", name: "judgment_decision", arguments: { action: "read" } },
        ]),
      ],
    },
    consumedProviderCalls: 1,
  };
}

export const nativeCall = (overrides = {}) => ({
  type: "tool_call",
  call_id: "read_character",
  provider_call_id: null,
  name: "read_character",
  arguments: { character_ref: "character:1" },
  ...overrides,
});

export const rawCall = (overrides = {}) => ({
  name: "read_character",
  arguments: { character_ref: "character:1" },
  ...overrides,
});
