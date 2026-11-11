// live verifier 端到端合成证据测试：构造一个 provider=strata 的完整批次目录，
// 验证机制判据通过并写 summary；缺 strata 卸载核验 / 错 journey / 截图不足时失败关闭。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { verifyLiveBatch } from "./authoring_live_evidence.mjs";
import { FIXTURE_RESPONSE_FORMAT } from "./authoring_call_evidence.mjs";
import { APP_BUNDLE, NATIVE_DRIVER, sha256 } from "./scenario_evidence.mjs";

const AUTHOR =
  "先看看第01章现在的设定和正文，再按现有设定写一段更紧张的开场：主角在雨夜收到一封没有署名的信，生成待采纳的候选，先不要保存。";
const G2_MESSAGE =
  "请先读第02章《灰烬中的手印》已经保存的正文，前后都核对一下，再把发现的重复写法改成一段候选给我看，先不要保存。";
const G2_VISIBLE_TARGET = Object.freeze({
  work_title: "灰烬手印验证作品",
  chapter_title: "第02章：灰烬中的手印",
  reading_excerpt: "井底浮现第七枚手印",
});
const G2_FIRST_READ =
  "(value=已阅读章节正文「灰烬中的手印」（第 2 章；第 1–6000 字符 / 共 7000 字符）。)";
const G2_LAST_READ =
  "(value=已阅读章节正文「灰烬中的手印」（第 2 章；第 6001–7000 字符 / 共 7000 字符）。)";
function visibleReadingPage() {
  return [
    "阅读模式",
    G2_VISIBLE_TARGET.work_title,
    "目录",
    "第02章：灰烬中的手印",
    "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。",
    `末页锚点：${G2_VISIBLE_TARGET.reading_excerpt}`,
  ].join("\n");
}
function visibleAfterInput(message = G2_MESSAGE) {
  return [
    G2_VISIBLE_TARGET.work_title,
    "你",
    message,
    "AI 助手",
    "当前创作任务工作区",
    "(value=进行中 · 创作)",
  ].join("\n");
}
function visibleFinal(message = G2_MESSAGE) {
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
const TURN = "message_live_1";
const RUN = "run_live_1";
const WORK = "work-live-1";
const WORKSPACE = "test";
const SESSION = "session-live-1";
const SEGMENT_VERSION = "authoring-run-segment/v1";
const MESSAGE_VERSION = "authoring-session-message/v1";
// B82 §7 G2：目标为第 2 章的单场景采纳稿，正文 7000 字符，版本以落库值为准。
const G2_CHAPTER = "chapter-target-2";
const G2_SCENE = "scene-target-2";
const G2_DRAFT = "draft-target-2";
const G2_PROSE = Array.from({ length: 7000 }, (_, index) => String.fromCodePoint(0x4e00 + (index % 2000))).join("");
// 实际 B28 scope3 候选：TENTATIVE prose_fragment / target_segments / replace_segments。
const G2_ARTIFACT = "as-g2-1";
const G2_ITEM = {
  item_id: "item-g2-1",
  title: "第 2 章指定片段修订",
  body: "雨声压在窗棂上，沈砚把信纸翻到背面。",
  rationale: "只改指定片段。",
  provider_call_ref: "pcall_live_2",
};
const G2_WRITER_CALL = {
  id: "call-g2-writer",
  name: "submit_tentative_artifact",
  arguments: { items: [G2_ITEM] },
};

const readyAt = new Date(Date.now() - 3600_000).toISOString();
const finishedAt = new Date(Date.now() - 1800_000).toISOString();

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

const png = () => Buffer.from("89504e470d0a1a0a", "hex");

const system = () => ({ role: "system", content: "你在 AI Novel Studio 中工作，作者是唯一裁决者。" });
const appBase = () => ({
  role: "user",
  content: "【应用数据 · application_base · 非作者原话】\n创作判断器规则。\n- [observation:obs_1]",
});
const author = () => ({ role: "user", content: AUTHOR });
const scope = () => ({ role: "user", content: "【应用数据 · scope_update · 以最新版本为准】\n版本：{\"scope_revision\":1}" });

const requestMessages = [system(), appBase(), author(), scope()];

function llmRecord({ usage = true } = {}) {
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
const SSE_CALL = Object.freeze({
  first: { pcall: "pcall_live_1", prun: "prun_live_1" },
  second: { pcall: "pcall_live_2", prun: "prun_live_2" },
});
const SSE_TOOL_CALL = Object.freeze({
  id: "call-1",
  name: "read_chapter",
  arguments: { chapter_ref: "chapter_1" },
});
const SSE_TOOL_ARGUMENTS = '{"chapter_ref":"chapter_1"}';

function sseRecord({ ref, ts, turnId = TURN, messages = requestMessages, toolCalls = [] }) {
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
function replayMessages() {
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

function sseRecords({ writerItem = null } = {}) {
  return [
    sseRecord({ ref: SSE_CALL.first, ts: "2026-11-03T10:00:01.000Z", toolCalls: [SSE_TOOL_CALL] }),
    sseRecord({
      ref: SSE_CALL.second,
      ts: "2026-11-03T10:00:02.000Z",
      messages: replayMessages(),
      toolCalls: writerItem ? [{ ...G2_WRITER_CALL, arguments: { items: [writerItem] } }] : [],
    }),
  ];
}

function g2PendingEntry() {
  return {
    artifact_id: G2_ARTIFACT,
    artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE",
    target_chapter_ref: `chapter:${G2_CHAPTER}`,
    payload: {
      title: "第 2 章正文草稿",
      target_chapter_ref: `chapter:${G2_CHAPTER}`,
      modification_scope: "target_segments",
      adoption_effect: { mode: "replace_segments", target_segment_ids: ["segment-0"] },
      items: [G2_ITEM],
    },
  };
}

const g2TurnBody = () => ({ ...turnBody, adoption_state: { pending: [g2PendingEntry()] } });

function rewriteRecords(dir, records) {
  writeJsonl(path.join(dir, "llm-calls", "2026-11-03.jsonl"), records);
}

// 只改本批 wire 中真实 turn_result 的 body，用于候选证据负例。
function rewriteTurnResult(dir, mutate) {
  const file = path.join(dir, "native-transport.jsonl");
  const rows = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  const row = rows.find((entry) => entry.frame?.[3] === "turn_result");
  mutate(row.frame[4]);
  writeJsonl(file, rows);
}

// 既有预注册形状：配置只存 id/sha256/model，文件冻结在批次目录内。
// scenarios[0].id 是冻结的 G2 专项标识（b82-g2）；缺省时不派生，保持普通冻结 live。
function writePreregistration(
  dir,
  { scenarioId = null, authorVisibleTarget = null, message = AUTHOR } = {},
) {
  const file = path.join(dir, "preregistration.json");
  const text = JSON.stringify(
    {
      id: "b82-live-sse-prereg",
      model: { provider: "strata", model: "iq3_s" },
      scenarios: [{
        ...(scenarioId ? { id: scenarioId } : {}),
        ...(authorVisibleTarget ? { author_visible_target: authorVisibleTarget } : {}),
        message,
        evidence: { dir },
      }],
    },
    null,
    2,
  );
  fs.writeFileSync(file, text);
  return { id: "b82-live-sse-prereg", sha256: sha256(text), model: "iq3_s" };
}

const turnBody = {
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

function checkpoint(name, { canonHash = "canon-content", counts = {}, design = "design-start" } = {}) {
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

// canonical 执行段：agent_runs 只保留身份/模式列，消息与 refs 在段头/消息行。
// L7 只认 assistant(model) 消息顶层的 pcall+prun 与真实 llm record 的配对。
function insertCanonicalRun(
  db,
  {
    runId = RUN,
    sessionId = SESSION,
    workId = WORK,
    usedRefs = ["observation:obs_1"],
    providerCallRef = "pcall_live_1",
    providerRunRef = "prun_live_1",
  } = {},
) {
  const run = { run_id: runId, workspace_id: WORKSPACE, work_id: workId, session_id: sessionId, parent_turn_ref: TURN, profile_ref: "judgment_loop_v1" };
  const message =
    usedRefs.length > 0
      ? {
          role: "assistant",
          provenance: "model",
          provider_call_ref: providerCallRef,
          provider_run_ref: providerRunRef,
          blocks: [{ type: "tool_call", call_id: "call-self-report", name: "submit_tentative_artifact", arguments: { self_report: { used_context_refs: usedRefs } } }],
        }
      : { role: "assistant", provenance: "model", blocks: [{ type: "text", text: "我先核对第01章现有内容。" }] };
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
  db.prepare(
    "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, run_mode, status, plan_version, consumed_budget, pending_artifact_refs) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(runId, WORKSPACE, workId, sessionId, TURN, null, "bounded", "completed", 1, null, "[]");
  db.prepare(
    "INSERT INTO authoring_run_segments (run_id, workspace_id, work_id, session_id, parent_turn_ref, header, message_count, first_sequence, last_sequence, format_version) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(runId, WORKSPACE, workId, sessionId, TURN, JSON.stringify(header), 1, 1, 1, SEGMENT_VERSION);
  db.prepare(
    "INSERT INTO authoring_session_messages (id, workspace_id, work_id, session_id, run_id, sequence, run_sequence, role, message, format_version) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(`msg-${runId}-1`, WORKSPACE, workId, sessionId, runId, 1, 1, "assistant", JSON.stringify(message), MESSAGE_VERSION);
}

function writeLiveDatabase(dir, { usedRefs = ["observation:obs_1"], nativeCall = false, g2 = false, g2Revision = 1 } = {}) {
  const dbDir = path.join(dir, "database");
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, "ai_novel_studio_test.sqlite3"));
  db.exec(`
    CREATE TABLE chapters (id TEXT PRIMARY KEY, work_id TEXT, volume_id TEXT, title TEXT, seq INTEGER, status TEXT, inserted_at TEXT, updated_at TEXT, summary TEXT, plan_direction TEXT);
    CREATE TABLE scenes (id TEXT PRIMARY KEY, chapter_id TEXT, work_id TEXT, seq INTEGER);
    CREATE TABLE drafts (id TEXT PRIMARY KEY, work_id TEXT, scene_id TEXT, content TEXT, status TEXT, revision INTEGER);
    CREATE TABLE agent_events (id TEXT, run_id TEXT, event_type TEXT, refs TEXT);
    CREATE TABLE decision_traces (trace_id TEXT, workspace_id TEXT, session_id TEXT, turn_id TEXT, context_refs TEXT);
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, long_run_task_ref TEXT, run_mode TEXT, status TEXT, plan_version INTEGER, consumed_budget TEXT, pending_artifact_refs TEXT);
    CREATE TABLE authoring_run_segments (run_id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, header TEXT, message_count INTEGER, first_sequence INTEGER, last_sequence INTEGER, format_version TEXT);
    CREATE TABLE authoring_session_messages (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, run_id TEXT, sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT, format_version TEXT);
    CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, status TEXT);
    CREATE TABLE provider_events (id TEXT PRIMARY KEY, provider_run_id TEXT, provider_call_ref TEXT, agent_run_id TEXT, event_type TEXT, emitted_at TEXT);
    CREATE TABLE mutations (id TEXT);
  `);
  const mission = {
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
  };
  db.prepare("INSERT INTO chapters (id, work_id, volume_id, title, seq, status, inserted_at, updated_at, summary, plan_direction) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("chapter-row", WORK, null, "第一章", 1, "PLANNED", "2026-11-03T10:00:00.000Z", "2026-11-03T10:00:00.000Z", null, JSON.stringify(mission));
  db.prepare("INSERT INTO agent_events (id, run_id, event_type, refs) VALUES (?,?,?,?)").run("ev-1", RUN, "exploration_observed", '["obs_1"]');
  db.prepare("INSERT INTO decision_traces (trace_id, workspace_id, session_id, turn_id, context_refs) VALUES (?,?,?,?,?)").run("trace_1", WORKSPACE, SESSION, TURN, null);
  if (nativeCall) insertNativeCallRun(db, { g2 });
  else insertCanonicalRun(db, { usedRefs });
  if (g2) insertG2Fixture(db, { revision: g2Revision });
  db.close();
}

// B82 §7 G2 零页反例：目标第 2 章有唯一 ACCEPTED draft 与同 run 的 started 序列，
// 但 canonical transcript 没有任何落在该章正文分页上的观察。
function insertG2Fixture(db, { revision = 1 } = {}) {
  db.prepare("INSERT INTO chapters (id, work_id, volume_id, title, seq, status, inserted_at, updated_at, summary, plan_direction) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(G2_CHAPTER, WORK, null, "灰烬中的手印", 2, "PLANNED", "2026-11-03T10:00:00.000Z", "2026-11-03T10:00:00.000Z", null, null);
  db.prepare("INSERT INTO scenes (id, chapter_id, work_id, seq) VALUES (?,?,?,?)")
    .run(G2_SCENE, G2_CHAPTER, WORK, 1);
  db.prepare("INSERT INTO drafts (id, work_id, scene_id, content, status, revision) VALUES (?,?,?,?,?,?)")
    .run(G2_DRAFT, WORK, G2_SCENE, G2_PROSE, "ACCEPTED", revision);
  const insertEvent = db.prepare(
    "INSERT INTO provider_events (id, provider_run_id, provider_call_ref, agent_run_id, event_type, emitted_at) VALUES (?,?,?,?,?,?)",
  );
  for (const [index, ref] of [SSE_CALL.first, SSE_CALL.second].entries()) {
    insertEvent.run(`pevt-g2-${index}`, ref.prun, ref.pcall, RUN, "started", `2026-11-03T10:00:0${index + 1}.000Z`);
  }
}

// B82：两轮真实 SSE 执行的 canonical 段 + 同 run 的 ProviderRun 行。
// assistant 按 pcall+prun 唯一绑定，数据来源仍是产品持久结构，不新增并行台账。
function insertNativeCallRun(db, { g2 = false } = {}) {
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
      blocks: [
        { type: "text", text: "我已核对第01章。" },
        ...(g2 ? [{
          type: "tool_call",
          call_id: G2_WRITER_CALL.id,
          name: G2_WRITER_CALL.name,
          arguments: { items: [G2_ITEM] },
        }] : []),
      ],
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
    call_ids: g2 ? [SSE_TOOL_CALL.id, G2_WRITER_CALL.id] : [SSE_TOOL_CALL.id],
  };
  db.prepare(
    "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, run_mode, status, plan_version, consumed_budget, pending_artifact_refs) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(RUN, WORKSPACE, WORK, SESSION, TURN, null, "bounded", "completed", 1, JSON.stringify({ provider_calls: messages.length - 1 }), g2 ? JSON.stringify([G2_ARTIFACT]) : "[]");
  db.prepare(
    "INSERT INTO authoring_run_segments (run_id, workspace_id, work_id, session_id, parent_turn_ref, header, message_count, first_sequence, last_sequence, format_version) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(RUN, WORKSPACE, WORK, SESSION, TURN, JSON.stringify(header), messages.length, 1, messages.length, SEGMENT_VERSION);
  const insertMessage = db.prepare(
    "INSERT INTO authoring_session_messages (id, workspace_id, work_id, session_id, run_id, sequence, run_sequence, role, message, format_version) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  messages.forEach((message, index) => {
    insertMessage.run(`msg-${RUN}-${index + 1}`, WORKSPACE, WORK, SESSION, RUN, index + 1, index + 1, message.role, JSON.stringify(message), MESSAGE_VERSION);
  });
  const insertRun = db.prepare(
    "INSERT INTO provider_runs (id, provider_call_ref, agent_run_id, workspace_id, work_id, session_id, parent_turn_ref, status) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (const ref of [SSE_CALL.first, SSE_CALL.second]) {
    insertRun.run(ref.prun, ref.pcall, RUN, WORKSPACE, WORK, SESSION, TURN, "completed");
  }
}

function buildDir({ withStrataUnloaded = true, screenshots = 3, usedRefs = ["observation:obs_1"], nativeCall = false, preregistration = false, scenarioId = null, g2 = false, g2Revision = 1, nativeScenarioId = null, message = AUTHOR, authorVisibleTarget = null, authorVisible = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-live-verify-"));
  // B82 作者可见批次只准备冻结目标/可见页面/监督/模型槽位；seed、DB、wire、
  // llm/app 日志都是应用内部信息，不能先写再删掉来证明判据没读它们。
  if (!authorVisible) {
    fs.mkdirSync(path.join(dir, "app-log"), { recursive: true });
    fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "seed.log"),
      `[g2-test-seed] work_id=${WORK} session_id=${SESSION} chapter_id=${G2_CHAPTER} chapter_seq=2\n`,
    );
  }

  writeJson(path.join(dir, "native-driver-ready.json"), {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-ref-live",
    provider: "strata",
    slice_id: "b71-first-consumer",
    ready_at: readyAt,
    app_path: "/tmp/B71 Live.app",
  });
  const shotNames = authorVisible
    ? ["01-workbench.png", "02-reading-before.png", "after-input.png", "final.png", "03-reading-after.png"]
    : ["01-workbench.png", "after-input.png", "final.png", "why.png"].slice(0, screenshots);
  for (const name of shotNames) fs.writeFileSync(path.join(dir, name), png());
  if (g2) {
    fs.writeFileSync(path.join(dir, "01-workbench.text.txt"), "工作台\n等待创作请求\n");
    fs.writeFileSync(path.join(dir, "final.text.txt"), `${G2_ITEM.title}\n${G2_ITEM.body}\n保存为章节正文\n`);
  }
  if (authorVisible) {
    fs.writeFileSync(path.join(dir, "01-workbench.text.txt"), `${G2_VISIBLE_TARGET.work_title}\n等待创作请求\n`);
    fs.writeFileSync(path.join(dir, "02-reading-before.text.txt"), visibleReadingPage());
    fs.writeFileSync(path.join(dir, "after-input.text.txt"), visibleAfterInput(message));
    fs.writeFileSync(path.join(dir, "final.text.txt"), visibleFinal(message));
    fs.writeFileSync(path.join(dir, "03-reading-after.text.txt"), visibleReadingPage());
  }
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: "run-ref-live",
    driver: NATIVE_DRIVER,
    app_bundle: APP_BUNDLE,
    scope: "b71-first-consumer",
    screenshots: shotNames,
  });

  const kinds = authorVisible
    ? ["maintenance", "maintenance", "maintenance", "input", "turn", "turn", "maintenance", "maintenance"]
    : ["input", "ack", "turn", "maintenance", "maintenance", "maintenance", "maintenance", "maintenance", "maintenance"];
  writeJsonl(
    path.join(dir, "native-driver-commands.jsonl"),
    kinds.flatMap((kind, index) => [
      { op: "begin", id: `wait-${index}`, kind },
      { op: "finish", id: `wait-${index}`, kind },
    ]),
  );
  writeJsonl(
    path.join(dir, "wait-events.jsonl"),
    kinds.flatMap((kind, index) => [
      { event: "wait_start", kind, at: Date.now() - (kinds.length - index) * 1000, id: `wait-${index}` },
      { event: "wait_end", kind, ended_at: Date.now() - (kinds.length - index) * 1000 + 500, id: `wait-${index}` },
    ]),
  );
  writeJson(path.join(dir, "wait-stats.json"), { active: null, completed: kinds.length });
  writeJsonl(path.join(dir, "heartbeat.jsonl"), [{ at: readyAt }]);

  if (!authorVisible) {
    writeJsonl(path.join(dir, "app-log", "2026-11-03.jsonl"), [
      { at: "2026-11-03T10:00:00.000Z", event: "provider_gateway.complete.start", provider: "strata" },
    ]);
    writeJsonl(
      path.join(dir, "llm-calls", "2026-11-03.jsonl"),
      nativeCall ? sseRecords({ writerItem: g2 ? G2_ITEM : null }) : [llmRecord()],
    );

    writeJsonl(path.join(dir, "native-transport.jsonl"), [
      {
        at: "2026-11-03T10:00:00.300Z",
        direction: "sent",
        frame: ["3", "3", "workspace:test", "phx_join", { work_id: WORK, session_id: SESSION }],
      },
      {
        at: "2026-11-03T10:00:00.400Z",
        direction: "received",
        frame: ["3", "3", "workspace:test", "phx_reply", { status: "ok", response: { joined: true, work_id: WORK, session_id: SESSION } }],
      },
      {
        at: "2026-11-03T10:00:00.500Z",
        direction: "sent",
        frame: ["3", "4", "workspace:test", "user_message", { text: message, turn_id: TURN, work_id: WORK, session_id: SESSION }],
      },
      {
        at: "2026-11-03T10:00:00.600Z",
        direction: "received",
        frame: ["3", "4", "workspace:test", "phx_reply", { status: "ok", response: { turn_id: TURN, run_id: RUN } }],
      },
      {
        at: "2026-11-03T10:00:02.000Z",
        direction: "received",
        frame: [null, null, "workspace:test", "turn_result", { ...(g2 ? g2TurnBody() : turnBody), turn_id: `${TURN}:agent:2` }],
      },
      {
        at: "2026-11-03T10:00:00.400Z",
        direction: "http",
        method: "GET",
        path: "/api/works/w/sessions/resume",
        status: 200,
      },
    ]);
  }

  const config = {
    slice_id: "b71-first-consumer",
    journey: "live",
    provider: "strata",
    target: authorVisible
      ? { work_title: authorVisibleTarget?.work_title ?? "作者可见目标缺失" }
      : { work_id: WORK, work_title: authorVisibleTarget?.work_title ?? "B71 live", session_id: SESSION },
    message,
  };
  if (authorVisibleTarget) config.author_visible_target = authorVisibleTarget;
  // 原生 config 不是冻结输入，不能凭它选择 G2；只在负例中模拟被写入的伪造字段。
  if (nativeScenarioId) config.scenario_id = nativeScenarioId;
  // 只有冻结批次带预注册标记；普通 live 批次保持原入口。
  if (preregistration) {
    config.preregistration = writePreregistration(dir, {
      scenarioId,
      authorVisibleTarget,
      message,
    });
  }
  writeJson(path.join(dir, "native-b71-config.json"), config);
  // 旧内部 checkpoints 只属于非作者可见的技术 fixture；B82 可见批次不生成 DB 快照。
  if (!authorVisible) {
    writeJson(path.join(dir, "b71-start.json"), checkpoint("start"));
    // 真实持久结构（L7/L9 的数据源）：DB 由 live 场景 seed 建出，verify 只读。
    writeLiveDatabase(dir, { usedRefs, nativeCall, g2, g2Revision });
    writeJson(path.join(dir, "b71-final.json"), checkpoint("final", { design: "design-final" }));
  }
  writeJson(path.join(dir, "native-b71-driver-log.json"), {
    slice_id: "b71-first-consumer",
    provider: "strata",
    model: "iq3_s",
    ...(authorVisible
      ? {
          author_visible_target: authorVisibleTarget,
          author_visible_outcome: { kind: "pending_candidate" },
        }
      : {
          run: { status: "completed" },
          why: { opened: true, before: { llm_records: 1, provider_runs: 1 }, after: { llm_records: 1, provider_runs: 1 } },
        }),
  });
  writeJson(path.join(dir, "strata-slot.json"), {
    schema: "b71-strata-slot/v1",
    model: "iq3_s",
    loaded_before: true,
    loaded_after: withStrataUnloaded ? false : true,
    unloaded: withStrataUnloaded,
    finished_at: finishedAt,
  });
  return dir;
}

test("live verifier：完整 provider=strata 批次通过机制判据并写 summary", () => {
  const dir = buildDir();
  const { checks, summary } = verifyLiveBatch(dir);
  assert.deepEqual(checks.failed_mechanism, []);
  assert.equal(checks.checks.mechanism.ir_projection_structure, true);
  assert.equal(checks.checks.mechanism.author_bytes_exact, true);
  assert.equal(checks.checks.mechanism.unadopted_zero_write, true);
  assert.equal(checks.checks.mechanism.usage_collected, true);
  assert.equal(checks.checks.mechanism.why_replay_zero_provider, true);
  assert.equal(summary.provider, "strata");
  assert.equal(summary.verdict.mechanism, "pass");
  assert.equal(summary.verdict.full_g1_g6_signed, false);
  assert(summary.not_signed.includes("I10_literary_quality_not_signed"));
  assert.equal(summary.tentative_design_derivations.length, 1);
  assert.equal(summary.tentative_design_derivations[0].provider_call_ref, "pcall_live_1");
  assert.equal(summary.refs.ok, true);
  assert(fs.existsSync(path.join(dir, "summary.json")));
  assert(fs.existsSync(path.join(dir, "native-b71-checks.json")));
  assert(fs.existsSync(path.join(dir, "native-ws-frames.json")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("live verifier：strata 未核验卸载时失败关闭", () => {
  const dir = buildDir({ withStrataUnloaded: false });
  assert.throws(() => verifyLiveBatch(dir), /strata 批次结束必须核验 loaded=null/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("live verifier：截图不足或缺 strata-slot 时失败关闭", () => {
  const fewShots = buildDir({ screenshots: 1 });
  assert.throws(() => verifyLiveBatch(fewShots), /原生截图不足/u);
  fs.rmSync(fewShots, { recursive: true, force: true });
  const dir = buildDir();
  fs.rmSync(path.join(dir, "strata-slot.json"));
  assert.throws(() => verifyLiveBatch(dir), /缺少 strata-slot\.json/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("live verifier：journey/provider 不匹配时拒绝", () => {
  const dir = buildDir();
  const configFile = path.join(dir, "native-b71-config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  writeJson(configFile, { ...config, journey: "pending" });
  assert.throws(() => verifyLiveBatch(dir), /live verifier 只接受 journey=live/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("live verifier：run 与本批 session 错绑时失败关闭，不扫描其它作品/会话", () => {
  const dir = buildDir();
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  try {
    db.prepare("UPDATE agent_runs SET session_id = ? WHERE id = ?").run("session-other", RUN);
  } finally {
    db.close();
  }
  assert.throws(() => verifyLiveBatch(dir), /恰好一行/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("live verifier：DB 中其它作品的 used_refs 不进入本批判定（只读本批段）", () => {
  const dir = buildDir({ usedRefs: [] });
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  try {
    insertCanonicalRun(db, {
      runId: "run_other_work",
      workId: "work-other",
      sessionId: "session-other",
      usedRefs: ["observation:obs_out_of_boundary"],
    });
    db.prepare("INSERT INTO decision_traces (trace_id, workspace_id, session_id, turn_id, context_refs) VALUES (?,?,?,?,?)")
      .run("trace_other", WORKSPACE, "session-other", TURN, '["chapter:foreign"]');
  } finally {
    db.close();
  }
  const { summary } = verifyLiveBatch(dir);
  // 本批段没有 used 声明 → unknown；若扫了别的作品行会误判为越界失败。
  assert.equal(summary.refs.ok, null);
  assert.equal(summary.refs.reason, "used_context_refs_unavailable");
  fs.rmSync(dir, { recursive: true, force: true });
});

// B82 §16.9：冻结的普通 live 批次必须做过真实 SSE 逐调用对账，且只对账内的记录
// 才能进入 b71LiveModelBehavior 签证；本单元只接对账，G2 页级仍未代签。
test("B82 冻结 live：真实 SSE 逐调用对账写入 measured.native_call 并只用对账后记录", () => {
  const dir = buildDir({ nativeCall: true, preregistration: true });
  const { summary } = verifyLiveBatch(dir);
  assert.equal(summary.measured.native_call.sse_decoder_tool_only_count, 2);
  assert.deepEqual(summary.measured.native_call.provider_call_refs, ["pcall_live_1", "pcall_live_2"]);
  assert.deepEqual(summary.measured.native_call.provider_run_refs, ["prun_live_1", "prun_live_2"]);
  assert.equal(summary.measured.native_call.bound_request_count, 2);
  assert.equal(summary.measured.provider_calls, 2);
  assert.equal(summary.verdict.mechanism, "pass");
  // 非 b82-g2 的冻结 live 不派生作者可见页面判据，保持原入口。
  assert.equal(summary.author_visible, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

// B82 G2 新批次只签作者可见页面：真实原话、末页阅读原文前后不变、同章局部
// 「指定段落修订稿」待采纳候选。旧内部页/候选对账保留在纯 helper 测试中诊断。
test("B82 冻结 live：b82-g2 只按作者可见消息/末页阅读/同章修订候选签页面", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  const { checks, summary } = verifyLiveBatch(dir);
  assert.equal(checks.author_visible.ok, true, checks.author_visible.failures.join(","));
  assert.equal(checks.author_visible.observed.author_message, true);
  assert.equal(checks.author_visible.observed.reading_unchanged, true);
  assert.equal(checks.author_visible.observed.reading_complete, true);
  assert.equal(checks.author_visible.observed.pending_candidate, true);
  assert.deepEqual(checks.failed, []);
  assert.equal(summary.verdict.author_visible, "pass");
  assert.equal(summary.verdict.full_g1_g6_signed, false);
  assert.equal(summary.scenario_id, "b82-g2");
  assert.equal(summary.surface, "tauri-native");
  assert.equal(summary.screenshots.length, 5);
  assert.equal(summary.wait_ledger.kinds.includes("ack"), false, "B82 不要求 ack 分型");
  assert.equal(summary.author_visible_target.chapter_title, G2_VISIBLE_TARGET.chapter_title);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 页面判据不生成也不读取 DB/wire", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  // 从构造开始就不写应用内部证据，而不是先写再删。
  for (const entry of ["database", "seed.log", "llm-calls", "app-log", "native-transport.jsonl", "b71-start.json", "b71-final.json"]) {
    assert.equal(fs.existsSync(path.join(dir, entry)), false, `作者可见批次不应生成 ${entry}`);
  }
  const { summary } = verifyLiveBatch(dir);
  assert.equal(summary.verdict.author_visible, "pass");
  assert.equal(summary.author_visible.observed.reading_complete, true);
  assert.equal(summary.author_visible.observed.pending_candidate, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 单槽模型与冻结模型不一致时拒绝", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  const slotPath = path.join(dir, "strata-slot.json");
  const slot = JSON.parse(fs.readFileSync(slotPath, "utf8"));
  fs.writeFileSync(slotPath, JSON.stringify({ ...slot, model: "other-model" }, null, 2));
  assert.throws(() => verifyLiveBatch(dir), /单槽模型与冻结模型不一致/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 旧失败批次只有失败/未完成时缺证拒绝并保留报告", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.writeFileSync(path.join(dir, "final.text.txt"), [
    G2_VISIBLE_TARGET.work_title,
    "你",
    G2_MESSAGE,
    "AI 助手",
    "这次候选处理未完成，目标可能已被处理或修订未成功。没有据此采纳或写入作品事实，请核对当前候选后继续。",
    "(value=失败)",
    "(value=第 3/3 步)",
  ].join("\n"));
  assert.throws(() => verifyLiveBatch(dir), /pending_candidate_missing/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.verdict.author_visible, "fail");
  assert(summary.author_visible.failures.includes("pending_candidate_missing"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 历史同章候选不能代签本次失败终局", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.writeFileSync(path.join(dir, "final.text.txt"), [
    "第02章：灰烬中的手印（指定段落修订稿）",
    "这是待保存章节草稿。确认保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。预览：指定段落修订稿",
    "指定段落修订稿 他把第七枚手印按进灰里。 创作依据：旧回合。",
    "修订稿候选",
    "保存修订稿",
    "你",
    G2_MESSAGE,
    "AI 助手",
    "(value=失败)",
  ].join("\n"));
  assert.throws(() => verifyLiveBatch(dir), /pending_candidate_missing/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.pending_candidate, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 可见等待不自动作答，也不因此签页面", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.writeFileSync(path.join(dir, "final.text.txt"), [
    G2_VISIBLE_TARGET.work_title,
    "你",
    G2_MESSAGE,
    "AI 助手",
    "我需要你补充要修订的段落。",
    "(value=等待你回复)",
  ].join("\n"));
  assert.throws(() => verifyLiveBatch(dir), /pending_candidate_missing/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.pending_candidate, false);
  assert(summary.author_visible.failures.includes("pending_candidate_missing"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 缺 final 页时缺证失败并保留报告", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.rmSync(path.join(dir, "final.text.txt"));
  assert.throws(() => verifyLiveBatch(dir), /final_visible_missing/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.verdict.author_visible, "fail");
  assert(summary.author_visible.failures.includes("final_visible_missing"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 缺阅读后页时缺证失败并保留报告", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.rmSync(path.join(dir, "03-reading-after.text.txt"));
  assert.throws(() => verifyLiveBatch(dir), /reading_after_missing/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.verdict.author_visible, "fail");
  assert(summary.author_visible.failures.includes("reading_after_missing"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 阅读页仍显示旧投影状态时拒绝", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.writeFileSync(
    path.join(dir, "02-reading-before.text.txt"),
    `${visibleReadingPage()}\n投影状态：重建中\n正在读取最新章节，请稍候。`,
  );
  assert.throws(() => verifyLiveBatch(dir), /reading_before_projection_not_fresh/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.reading_unchanged, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 首页读活动无可见范围时不补缺口", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.writeFileSync(
    path.join(dir, "final.text.txt"),
    visibleFinal().replace(
      G2_FIRST_READ,
      "(value=已阅读章节正文「灰烬中的手印」（第 2 章）（有效字数 6244）。)",
    ),
  );
  assert.throws(() => verifyLiveBatch(dir), /reading_not_complete/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.reading_complete, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 只改非摘录正文也必须拒绝（完整同页比较）", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.writeFileSync(
    path.join(dir, "03-reading-after.text.txt"),
    visibleReadingPage().replace(
      "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。",
      "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线。（正文其它位置被改）",
    ),
  );
  assert.throws(() => verifyLiveBatch(dir), /reading_changed/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.reading_unchanged, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 目标章缺少章序完整标签时缺证", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: { ...G2_VISIBLE_TARGET, chapter_title: "灰烬中的手印" },
    authorVisible: true,
    message: G2_MESSAGE,
  });
  assert.throws(() => verifyLiveBatch(dir), /chapter_label_incomplete/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert(summary.author_visible.failures.includes("chapter_label_incomplete"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 另一章候选不能签同章页面", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.writeFileSync(
    path.join(dir, "final.text.txt"),
    visibleFinal().replace(
      "第02章：灰烬中的手印（指定段落修订稿）",
      "第01章：夜潮（指定段落修订稿）",
    ),
  );
  assert.throws(() => verifyLiveBatch(dir), /pending_candidate_missing/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.candidate_same_chapter, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 未显示完整阅读时缺证（手工阅读页不能替代读证）", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.writeFileSync(
    path.join(dir, "final.text.txt"),
    visibleFinal().split(`${G2_FIRST_READ}\n`).join("").split(`${G2_LAST_READ}\n`).join(""),
  );
  assert.throws(() => verifyLiveBatch(dir), /reading_activity_missing/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.reading_complete, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 只显示末页读活动时不算读完整章", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.writeFileSync(
    path.join(dir, "final.text.txt"),
    visibleFinal().split(`${G2_FIRST_READ}\n`).join(""),
  );
  assert.throws(() => verifyLiveBatch(dir), /reading_not_complete/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.reading_complete, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 缺当前作者消息时不用整页旧候选", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  // after-input 仍保留作者消息，但当前 final AX 缺 marker：不得用整页旧候选。
  fs.writeFileSync(
    path.join(dir, "final.text.txt"),
    visibleFinal().split(`${G2_MESSAGE}\n`).join(""),
  );
  assert.throws(() => verifyLiveBatch(dir), /author_message_visible_missing/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.after_input_has_message, true);
  assert.equal(summary.author_visible.observed.pending_candidate, false);
  assert(summary.author_visible.failures.includes("pending_candidate_missing"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：b82-g2 候选/澄清泄漏技术术语时拒绝", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: G2_VISIBLE_TARGET,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  fs.appendFileSync(path.join(dir, "final.text.txt"), "\n本轮候选由 call_id 关联。\n");
  assert.throws(() => verifyLiveBatch(dir), /author_visible_internal_token_leak/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.author_visible.observed.author_visible_clean, false);
  assert(summary.author_visible.leak.hits.some((hit) => hit.token === "call_id"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：旧缺 author_visible_target 的 b82-g2 不能重签页面且保留旧报告", () => {
  const dir = buildDir({
    preregistration: true,
    scenarioId: "b82-g2",
    authorVisibleTarget: null,
    authorVisible: true,
    message: G2_MESSAGE,
  });
  assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  assert.throws(() => verifyLiveBatch(dir), /缺少冻结的作者可见目标/u);
  assert.equal(fs.existsSync(path.join(dir, "summary.json")), false, "缺目标时不得改写旧报告");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：原生 config 的 scenario_id 不能选择 b82-g2", () => {
  const dir = buildDir({
    nativeCall: true,
    preregistration: true,
    scenarioId: null,
    nativeScenarioId: "b82-g2",
  });
  const { summary } = verifyLiveBatch(dir);
  assert.equal(summary.author_visible, undefined);
  assert.equal(summary.verdict.mechanism, "pass");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：历史占位与缺响应不签", () => {
  const [first, second] = sseRecords();
  const placeholder = buildDir({ nativeCall: true, preregistration: true });
  rewriteRecords(placeholder, [first, { ...second, response: { ...second.response, body: "event_stream" } }]);
  assert.throws(() => verifyLiveBatch(placeholder), /native_call_pairs_bound/u);
  fs.rmSync(placeholder, { recursive: true, force: true });

  const missing = buildDir({ nativeCall: true, preregistration: true });
  rewriteRecords(missing, [first, { ...second, response: undefined }]);
  assert.throws(() => verifyLiveBatch(missing), /native_call_pairs_bound/u);
  fs.rmSync(missing, { recursive: true, force: true });
});

test("B82 冻结 live：ProviderRun 归属错误不签", () => {
  const dir = buildDir({ nativeCall: true, preregistration: true });
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  try {
    db.prepare("UPDATE provider_runs SET session_id = ? WHERE id = ?").run("session-other", SSE_CALL.first.prun);
  } finally {
    db.close();
  }
  assert.throws(() => verifyLiveBatch(dir), /native_call_pairs_owned/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B82 冻结 live：scope 外的 SSE 记录不进入模型行为签证", () => {
  const dir = buildDir({ nativeCall: true, preregistration: true });
  const foreign = sseRecord({
    ref: { pcall: "pcall_other_run", prun: "prun_other_run" },
    ts: "2026-11-03T10:00:03.000Z",
    turnId: "message_other_run",
  });
  rewriteRecords(dir, [...sseRecords(), foreign]);
  const { summary } = verifyLiveBatch(dir);
  assert.equal(summary.measured.provider_calls, 2);
  assert(!summary.measured.native_call.provider_call_refs.includes("pcall_other_run"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("普通 live 入口：无预注册标记时不启用逐调用对账", () => {
  const dir = buildDir({ nativeCall: true });
  const { summary } = verifyLiveBatch(dir);
  assert.equal(summary.measured.native_call, null);
  assert.equal(summary.measured.provider_calls, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

// §16.9 真实来源：共享对账同时接受 fixture 与 SSE，所以冻结入口必须拒绝 fixture
// 替身——即使作用域正确、形状合法、工具事实与 canonical 完全一致。
test("B82 冻结 live：合法 fixture 替身不得冒充真实 SSE 来源", () => {
  const dir = buildDir({ nativeCall: true, preregistration: true });
  const [first, second] = sseRecords();
  rewriteRecords(dir, [
    { ...first, response_format: FIXTURE_RESPONSE_FORMAT, response: { status: "ok", usage: first.response.usage, body: { content: null, tool_calls: [SSE_TOOL_CALL] } } },
    { ...second, response_format: FIXTURE_RESPONSE_FORMAT, response: { status: "ok", usage: second.response.usage, body: { content: "我已核对第01章。", tool_calls: [] } } },
  ]);
  assert.throws(() => verifyLiveBatch(dir), /真实 SSE/u);
  fs.rmSync(dir, { recursive: true, force: true });
});
