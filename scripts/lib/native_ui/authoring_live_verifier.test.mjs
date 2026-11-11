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
const TURN = "message_live_1";
const RUN = "run_live_1";
const WORK = "work-live-1";
const WORKSPACE = "test";
const SESSION = "session-live-1";
const SEGMENT_VERSION = "authoring-run-segment/v1";
const MESSAGE_VERSION = "authoring-session-message/v1";

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

function sseRecords() {
  return [
    sseRecord({ ref: SSE_CALL.first, ts: "2026-11-03T10:00:01.000Z", toolCalls: [SSE_TOOL_CALL] }),
    sseRecord({ ref: SSE_CALL.second, ts: "2026-11-03T10:00:02.000Z", messages: replayMessages() }),
  ];
}

function rewriteRecords(dir, records) {
  writeJsonl(path.join(dir, "llm-calls", "2026-11-03.jsonl"), records);
}

// 既有预注册形状：配置只存 id/sha256/model，文件冻结在批次目录内。
function writePreregistration(dir) {
  const file = path.join(dir, "preregistration.json");
  const text = JSON.stringify(
    {
      id: "b82-live-sse-prereg",
      model: { provider: "strata", model: "iq3_s" },
      scenarios: [{ message: AUTHOR, evidence: { dir } }],
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

function writeLiveDatabase(dir, { usedRefs = ["observation:obs_1"], nativeCall = false } = {}) {
  const dbDir = path.join(dir, "database");
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, "ai_novel_studio_test.sqlite3"));
  db.exec(`
    CREATE TABLE chapters (id TEXT PRIMARY KEY, work_id TEXT, volume_id TEXT, title TEXT, seq INTEGER, status TEXT, inserted_at TEXT, updated_at TEXT, summary TEXT, plan_direction TEXT);
    CREATE TABLE agent_events (id TEXT, run_id TEXT, event_type TEXT, refs TEXT);
    CREATE TABLE decision_traces (trace_id TEXT, workspace_id TEXT, session_id TEXT, turn_id TEXT, context_refs TEXT);
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, long_run_task_ref TEXT, run_mode TEXT, status TEXT, plan_version INTEGER, consumed_budget TEXT, pending_artifact_refs TEXT);
    CREATE TABLE authoring_run_segments (run_id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, header TEXT, message_count INTEGER, first_sequence INTEGER, last_sequence INTEGER, format_version TEXT);
    CREATE TABLE authoring_session_messages (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, run_id TEXT, sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT, format_version TEXT);
    CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, status TEXT);
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
  if (nativeCall) insertNativeCallRun(db);
  else insertCanonicalRun(db, { usedRefs });
  db.close();
}

// B82：两轮真实 SSE 执行的 canonical 段 + 同 run 的 ProviderRun 行。
// assistant 按 pcall+prun 唯一绑定，数据来源仍是产品持久结构，不新增并行台账。
function insertNativeCallRun(db) {
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
  db.prepare(
    "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, run_mode, status, plan_version, consumed_budget, pending_artifact_refs) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(RUN, WORKSPACE, WORK, SESSION, TURN, null, "bounded", "completed", 1, JSON.stringify({ provider_calls: messages.length - 1 }), "[]");
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

function buildDir({ withStrataUnloaded = true, screenshots = 3, usedRefs = ["observation:obs_1"], nativeCall = false, preregistration = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-live-verify-"));
  fs.mkdirSync(path.join(dir, "app-log"), { recursive: true });
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });

  writeJson(path.join(dir, "native-driver-ready.json"), {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-ref-live",
    provider: "strata",
    slice_id: "b71-first-consumer",
    ready_at: readyAt,
    app_path: "/tmp/B71 Live.app",
  });
  const shotNames = ["01-workbench.png", "after-input.png", "final.png", "why.png"].slice(0, screenshots);
  for (const name of shotNames) fs.writeFileSync(path.join(dir, name), png());
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: "run-ref-live",
    driver: NATIVE_DRIVER,
    app_bundle: APP_BUNDLE,
    scope: "b71-first-consumer",
    screenshots: shotNames,
  });

  const kinds = ["input", "ack", "turn", "maintenance", "maintenance", "maintenance", "maintenance", "maintenance", "maintenance"];
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

  writeJsonl(path.join(dir, "app-log", "2026-11-03.jsonl"), [
    { at: "2026-11-03T10:00:00.000Z", event: "provider_gateway.complete.start", provider: "strata" },
  ]);
  writeJsonl(path.join(dir, "llm-calls", "2026-11-03.jsonl"), nativeCall ? sseRecords() : [llmRecord()]);

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
      frame: ["3", "4", "workspace:test", "user_message", { text: AUTHOR, turn_id: TURN, work_id: WORK, session_id: SESSION }],
    },
    {
      at: "2026-11-03T10:00:00.600Z",
      direction: "received",
      frame: ["3", "4", "workspace:test", "phx_reply", { status: "ok", response: { turn_id: TURN, run_id: RUN } }],
    },
    {
      at: "2026-11-03T10:00:02.000Z",
      direction: "received",
      frame: [null, null, "workspace:test", "turn_result", { ...turnBody, turn_id: `${TURN}:agent:2` }],
    },
    {
      at: "2026-11-03T10:00:00.400Z",
      direction: "http",
      method: "GET",
      path: "/api/works/w/sessions/resume",
      status: 200,
    },
  ]);

  const config = {
    slice_id: "b71-first-consumer",
    journey: "live",
    provider: "strata",
    target: { work_id: WORK, work_title: "B71 live", session_id: SESSION },
    message: AUTHOR,
  };
  // 只有冻结批次带预注册标记；普通 live 批次保持原入口。
  if (preregistration) config.preregistration = writePreregistration(dir);
  writeJson(path.join(dir, "native-b71-config.json"), config);
  writeJson(path.join(dir, "b71-start.json"), checkpoint("start"));
  // 真实持久结构（L7/L9 的数据源）：DB 由 live 场景 seed 建出，verify 只读。
  writeLiveDatabase(dir, { usedRefs, nativeCall });
  writeJson(path.join(dir, "b71-final.json"), checkpoint("final", { design: "design-final" }));
  writeJson(path.join(dir, "native-b71-driver-log.json"), {
    slice_id: "b71-first-consumer",
    provider: "strata",
    model: "iq3_s",
    run: { status: "completed" },
    why: { opened: true, before: { llm_records: 1, provider_runs: 1 }, after: { llm_records: 1, provider_runs: 1 } },
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
