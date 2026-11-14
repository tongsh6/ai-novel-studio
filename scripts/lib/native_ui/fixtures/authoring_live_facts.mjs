// B71 live verifier / B82 作者可见页面证据族的纯事实 owner：批次身份、作者原话、
// llm/SSE 记录、canonical/native 段与 checkpoint 只作为内存数据。
// 真实文件批次与 10 表 SQLite 模板在 `authoring_live_io_fixture.mjs`；本模块不
// import fs/os/path、不建目录/DB、不 import 被测 SUT。时间字段固定为历史批次值，
// 使同一规格在 run 内只物化一次；纯 verifier 判据在
// `../authoring_live_evidence.test.mjs` 不消费本文件。
export const AUTHOR =
  "先看看第01章现在的设定和正文，再按现有设定写一段更紧张的开场：主角在雨夜收到一封没有署名的信，生成待采纳的候选，先不要保存。";
export const G2_MESSAGE =
  "请先读第02章《灰烬中的手印》已经保存的正文，前后都核对一下，再把发现的重复写法改成一段候选给我看，先不要保存。";
export const G3_MESSAGE = "我想先安静读一遍第02章已经保存的正文，只核对，不改也不保存。";
export const G2_VISIBLE_TARGET = Object.freeze({
  work_title: "灰烬手印验证作品",
  chapter_title: "第02章：灰烬中的手印",
  reading_excerpt: "井底浮现第七枚手印",
});
export const G2_FIRST_READ =
  "(value=已阅读章节正文「灰烬中的手印」（第 2 章；第 1–6000 字符 / 共 7000 字符）。)";
export const G2_LAST_READ =
  "(value=已阅读章节正文「灰烬中的手印」（第 2 章；第 6001–7000 字符 / 共 7000 字符）。)";

export function visibleReadingPage() {
  return [
    "阅读模式",
    G2_VISIBLE_TARGET.work_title,
    "目录",
    "第02章：灰烬中的手印",
    "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。",
    `末页锚点：${G2_VISIBLE_TARGET.reading_excerpt}`,
  ].join("\n");
}

export function visibleAfterInput(message = G2_MESSAGE) {
  return [
    G2_VISIBLE_TARGET.work_title,
    "你",
    message,
    "AI 助手",
    "当前创作任务工作区",
    "(value=进行中 · 创作)",
  ].join("\n");
}

export function visibleFinal(message = G2_MESSAGE) {
  return [
    G2_VISIBLE_TARGET.work_title,
    "你",
    message,
    "AI 助手",
    "本轮创作过程",
    G2_FIRST_READ,
    G2_LAST_READ,
    "第02章：灰烬中的手印（指定段落修订稿）",
    "这是待保存章节草稿。确认保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。预览：指定段落修订稿",
    "指定段落修订稿 他把第七枚手印按进灰里。 创作依据：按作者要求保留原稿其余字句。",
    "修订稿候选",
    "保存修订稿",
    "放弃修订稿",
    "(value=已完成)",
  ].join("\n");
}

// B82 G3 只读：自然原话后给可见回复，只读目标章的一个真实范围页，完成且无候选。
export function visibleReadOnlyFinal(message = G3_MESSAGE) {
  return [
    G2_VISIBLE_TARGET.work_title,
    "你",
    message,
    "AI 助手",
    "我按你的要求只读了现有正文，没有改动，也没有生成候选或保存。",
    "本轮创作过程",
    G2_FIRST_READ,
    "(value=已完成)",
  ].join("\n");
}

export const TURN = "message_live_1";
export const RUN = "run_live_1";
export const WORK = "work-live-1";
export const WORKSPACE = "test";
export const SESSION = "session-live-1";
export const SEGMENT_VERSION = "authoring-run-segment/v1";
export const MESSAGE_VERSION = "authoring-session-message/v1";
// 固定历史批次时间：截图/证据文件在副本上的 mtime 恒晚于 ready_at，模板内容
// 也不随构造时刻漂移。
export const READY_AT = "2026-11-03T09:00:00.000Z";
export const FINISHED_AT = "2026-11-03T09:30:00.000Z";

export function png() {
  return Buffer.from("89504e470d0a1a0a", "hex");
}

export const system = () => ({ role: "system", content: "你在 AI Novel Studio 中工作，作者是唯一裁决者。" });
export const appBase = () => ({
  role: "user",
  content: "【应用数据 · application_base · 非作者原话】\n创作判断器规则。\n- [observation:obs_1]",
});
export const author = () => ({ role: "user", content: AUTHOR });
export const scope = () => ({ role: "user", content: "【应用数据 · scope_update · 以最新版本为准】\n版本：{\"scope_revision\":1}" });

export const requestMessages = [system(), appBase(), author(), scope()];

export function llmRecord({ usage = true } = {}) {
  // 真实 strata llm-calls 形状（cp3b smoke 实测）：request.body.messages；
  // response.usage 为归一字段，response.body 是 chat.completion JSON 字符串。
  const reply = "我先核对第01章现有内容，再给出候选。";
  return {
    ts: "2026-11-03T10:00:01.000Z",
    step: "judgment",
    turn_id: TURN,
    provider_call_ref: "pcall_live_1",
    provider_run_ref: "prun_live_1",
    provider: "strata",
    request: { body: { messages: requestMessages, tools: [], tool_choice: "auto" } },
    response: {
      status: 200,
      ...(usage
        ? { usage: { model: "iq3_s", input_tokens: 1024, output_tokens: 128, cached_tokens: 0, latency_ms: 1000, ttft_ms: null } }
        : {}),
      body: JSON.stringify({
        id: "chatcmpl-smoke",
        object: "chat.completion",
        model: "iq3_s",
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1024, completion_tokens: 128, total_tokens: 1152 },
      }),
    },
  };
}

// B82 §16.9：真实 SSE 日志形状（cp3b 之后实测）：无 response_format，
// request.body 是原生 Chat wire，response.body 只有 decoder 交付的 tool_calls；
// 正文不进日志，所以对账只认工具事实。
export const SSE_CALL = Object.freeze({
  first: { pcall: "pcall_live_1", prun: "prun_live_1" },
  second: { pcall: "pcall_live_2", prun: "prun_live_2" },
});
export const SSE_TOOL_CALL = Object.freeze({
  id: "call-1",
  name: "read_chapter",
  arguments: { chapter_ref: "chapter_1" },
});
export const SSE_TOOL_ARGUMENTS = '{"chapter_ref":"chapter_1"}';

export function sseRecord({ ref, ts, turnId = TURN, messages = requestMessages, toolCalls = [] }) {
  return {
    ts,
    step: "judgment",
    turn_id: turnId,
    workspace_id: WORKSPACE,
    work_id: WORK,
    session_id: SESSION,
    provider_call_ref: ref.pcall,
    provider_run_ref: ref.prun,
    provider: "strata",
    request: { body: { messages, tools: [], tool_choice: "auto" } },
    response: {
      status: 200,
      usage: { model: "iq3_s", input_tokens: 1024, output_tokens: 128, cached_tokens: 0, latency_ms: 1000, ttft_ms: null },
      body: { source: "sse_decoder", tool_calls: toolCalls },
    },
  };
}

// 第二次请求回放首轮工具调用与结果：真实追加式前缀 + observation 回流的最小形状。
export function replayMessages() {
  return [
    ...requestMessages,
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: SSE_TOOL_CALL.id, type: "function", function: { name: SSE_TOOL_CALL.name, arguments: SSE_TOOL_ARGUMENTS } }],
    },
    { role: "tool", tool_call_id: SSE_TOOL_CALL.id, content: "第01章正文：雨夜。" },
  ];
}

export function sseRecords() {
  return [
    sseRecord({ ref: SSE_CALL.first, ts: "2026-11-03T10:00:01.000Z", toolCalls: [SSE_TOOL_CALL] }),
    sseRecord({
      ref: SSE_CALL.second,
      ts: "2026-11-03T10:00:02.000Z",
      messages: replayMessages(),
      toolCalls: [],
    }),
  ];
}

export const turnBody = {
  turn_id: TURN,
  status: "conversational",
  work_id: WORK,
  session_id: SESSION,
  agent_run: { run_id: RUN, status: "completed" },
  assistant_message: { text: "我先核对第01章现有内容，再给出候选。" },
  adoption_state: {
    pending: [{ artifact_id: "as_live_1", artifact_type: "chapter_draft", adoption_status: "TENTATIVE" }],
  },
  available_actions: [],
};

export function checkpoint(name, { canonHash = "canon-content", counts = {}, design = "design-start" } = {}) {
  return {
    checkpoint: name,
    at: "2026-11-03T10:00:00.000Z",
    db_production_counts: {
      mutations: 0,
      author_action_receipts: 0,
      memory_items: 0,
      chapters: 0,
      drafts: 0,
      ...counts,
    },
    authoring_canon: {
      version: 2,
      at: "2026-11-03T10:00:00.000Z",
      chapters: {
        "chapter-row": { approved_sha256: "approved-chapter", design_state_sha256: design },
      },
      tables: {
        works: { row_count: 1, rows_sha256: "works-rows", canon_sha256: canonHash },
        author_action_receipts: { row_count: 0, rows_sha256: "receipts", canon_sha256: "receipts" },
      },
    },
  };
}

// canonical 执行段纯数据：agent_runs 只保留身份/模式列，消息与 refs 在段头/消息行。
// L7 只认 assistant(model) 消息顶层的 pcall+prun 与真实 llm record 的配对。
export function canonicalRunFacts({
  runId = RUN,
  sessionId = SESSION,
  workId = WORK,
  usedRefs = ["observation:obs_1"],
  providerCallRef = "pcall_live_1",
  providerRunRef = "prun_live_1",
} = {}) {
  const run = { run_id: runId, workspace_id: WORKSPACE, work_id: workId, session_id: sessionId, parent_turn_ref: TURN, profile_ref: "judgment_loop_v1" };
  const messages =
    usedRefs.length > 0
      ? [
          {
            role: "assistant",
            provenance: "model",
            provider_call_ref: providerCallRef,
            provider_run_ref: providerRunRef,
            blocks: [{ type: "tool_call", call_id: "call-self-report", name: "submit_tentative_artifact", arguments: { self_report: { used_context_refs: usedRefs } } }],
          },
        ]
      : [{ role: "assistant", provenance: "model", blocks: [{ type: "text", text: "我先核对第01章现有内容。" }] }];
  const header = {
    version: SEGMENT_VERSION,
    run,
    system: { identity_ref: "identity:authoring/v1" },
    tools: [],
    projection: { target: "chat_completions" },
    base_refs: [],
    observation_refs: ["obs_1"],
    used_refs: [],
    call_ids: [],
  };
  return { run, messages, header };
}

// B82：两轮真实 SSE 执行的 canonical 段 + 同 run 的 ProviderRun 行。
// assistant 按 pcall+prun 唯一绑定，数据来源仍是产品持久结构，不新增并行台账。
export function nativeRunFacts() {
  const messages = [
    {
      role: "assistant",
      provenance: "model",
      provider_call_ref: SSE_CALL.first.pcall,
      provider_run_ref: SSE_CALL.first.prun,
      blocks: [{ type: "tool_call", call_id: SSE_TOOL_CALL.id, name: SSE_TOOL_CALL.name, arguments: SSE_TOOL_CALL.arguments }],
    },
    { role: "tool", blocks: [{ type: "tool_result", call_id: SSE_TOOL_CALL.id, status: "ok" }] },
    {
      role: "assistant",
      provenance: "model",
      provider_call_ref: SSE_CALL.second.pcall,
      provider_run_ref: SSE_CALL.second.prun,
      blocks: [{ type: "text", text: "我已核对第01章。" }],
    },
  ];
  const run = { run_id: RUN, workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION, parent_turn_ref: TURN, profile_ref: "judgment_loop_v1" };
  const header = {
    version: SEGMENT_VERSION,
    run,
    system: { identity_ref: "identity:authoring/v1" },
    tools: [],
    projection: { target: "chat_completions" },
    base_refs: [],
    observation_refs: ["obs_1"],
    used_refs: [],
    call_ids: [SSE_TOOL_CALL.id],
  };
  return {
    run,
    messages,
    header,
    providerRuns: [SSE_CALL.first, SSE_CALL.second].map((ref) => ({
      id: ref.prun,
      provider_call_ref: ref.pcall,
      agent_run_id: RUN,
      workspace_id: WORKSPACE,
      work_id: WORK,
      session_id: SESSION,
      parent_turn_ref: TURN,
      status: "completed",
    })),
  };
}

export const chapterMission = () => ({
  chapter_mission: {
    mission_id: "cm_live_1",
    statement: "为第1章开场起头。",
    source: "model",
    status: "TENTATIVE",
    provider_call_ref: "pcall_live_1",
    must_advance: [{ text: "推进", basis_ref: "observation:obs_1" }],
    must_avoid: [],
  },
  plot_progress: "同名的计划中干扰章。",
});

export function liveDriverLog() {
  return {
    slice_id: "b71-first-consumer",
    provider: "strata",
    model: "iq3_s",
    run: { status: "completed" },
    why: { opened: true, before: { llm_records: 1, provider_runs: 1 }, after: { llm_records: 1, provider_runs: 1 } },
  };
}

export function authorVisibleDriverLog({ readOnly = false } = {}) {
  return {
    slice_id: "b71-first-consumer",
    provider: "strata",
    model: "iq3_s",
    author_visible_target: G2_VISIBLE_TARGET,
    author_visible_outcome: { kind: readOnly ? "completed" : "pending_candidate" },
  };
}
