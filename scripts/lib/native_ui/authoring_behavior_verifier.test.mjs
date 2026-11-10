// behavior verifier 合成目录端到端：合法 case 通过并写分层 summary；违规/unknown 失败关闭。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { verifyBehaviorBatch } from "./authoring_behavior_evidence.mjs";
import { APP_BUNDLE, NATIVE_DRIVER } from "./scenario_evidence.mjs";
import { loadLiveCaseCorpus, selectLiveCase } from "../quality/author_behavior_live_cases.mjs";

const bundle = loadLiveCaseCorpus();
const CASE = selectLiveCase(bundle, "C-F1-003");
const AUTHOR = CASE.expression;
const TURN = "message_behavior_1";
const RUN = "run_behavior_1";
const WORK = "work-behavior-1";
const WORKSPACE = "test";
const SESSION = "session-behavior-1";
const SEGMENT_VERSION = "authoring-run-segment/v1";
const MESSAGE_VERSION = "authoring-session-message/v1";
const readyAt = new Date(Date.now() - 3600_000).toISOString();

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

const png = () => Buffer.from("89504e470d0a1a0a", "hex");

function llmRecord() {
  return {
    ts: "2026-11-03T10:00:01.000Z",
    turn_id: TURN,
    provider_call_ref: "pcall_behavior_1",
    provider_run_ref: "prun_behavior_1",
    provider: "strata",
    request: {
      body: {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "【应用数据 · application_base · 非作者原话】规则" },
          { role: "user", content: AUTHOR },
          { role: "user", content: "【应用数据 · scope_update · 以最新版本为准】材料" },
        ],
      },
    },
    response: {
      status: 200,
      usage: { model: "iq3_s", input_tokens: 100, output_tokens: 10, cached_tokens: 0, latency_ms: 1000, ttft_ms: null },
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: "眼下写到第03章的计划，前两章有正文。" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    },
  };
}

function turnBody(assistantText = "眼下写到第03章的计划，前两章有正文。") {
  return {
    turn_id: TURN,
    status: "conversational",
    agent_run: { run_id: RUN, status: "completed" },
    assistant_message: { text: assistantText },
    adoption_state: { pending: [] },
    available_actions: [],
    truthfulness: { degraded: false },
  };
}

function canonSnapshot() {
  return {
    version: 2,
    at: "2026-11-03T10:00:00.000Z",
    chapters: {
      "chapter-row": { approved_sha256: "approved-1", design_state_sha256: "design-1" },
    },
    tables: {
      works: { row_count: 1, rows_sha256: "w", canon_sha256: "w" },
      chapters: { row_count: 1, rows_sha256: "c", canon_sha256: "c" },
      author_action_receipts: { row_count: 0, rows_sha256: "r", canon_sha256: "r" },
      memory_items: { row_count: 0, rows_sha256: "m", canon_sha256: "m" },
      drafts: { row_count: 1, rows_sha256: "d", canon_sha256: "d" },
    },
  };
}

function checkpoint(name) {
  return {
    checkpoint: name,
    at: "2026-11-03T10:00:00.000Z",
    db_production_counts: { author_action_receipts: 0, memory_items: 0, chapters: 1, drafts: 1 },
    authoring_canon: canonSnapshot(),
  };
}

// canonical 执行段：agent_runs 只保留身份/模式列，消息与 refs 在段头/消息行。
function insertCanonicalRun(db, { runId = RUN, sessionId = SESSION, workId = WORK, usedRefs = [] } = {}) {
  const run = { run_id: runId, workspace_id: WORKSPACE, work_id: workId, session_id: sessionId, parent_turn_ref: TURN, profile_ref: "judgment_loop_v1" };
  const message =
    usedRefs.length > 0
      ? { role: "assistant", provenance: "model", blocks: [{ type: "tool_call", call_id: "call-self-report", name: "submit_tentative_artifact", arguments: { self_report: { used_context_refs: usedRefs } } }] }
      : { role: "assistant", provenance: "model", blocks: [{ type: "text", text: "眼下写到第03章的计划，前两章有正文。" }] };
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

function writeDatabase(dir) {
  const dbDir = path.join(dir, "database");
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, "ai_novel_studio_test.sqlite3"));
  db.exec(`
    CREATE TABLE chapters (id TEXT PRIMARY KEY, work_id TEXT, volume_id TEXT, title TEXT, seq INTEGER, status TEXT, inserted_at TEXT, updated_at TEXT, summary TEXT, plan_direction TEXT);
    CREATE TABLE drafts (id TEXT, scene_id TEXT, content TEXT, status TEXT);
    CREATE TABLE agent_events (id TEXT, run_id TEXT, event_type TEXT, refs TEXT);
    CREATE TABLE decision_traces (trace_id TEXT, workspace_id TEXT, session_id TEXT, turn_id TEXT, context_refs TEXT);
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, long_run_task_ref TEXT, run_mode TEXT, status TEXT, plan_version INTEGER, consumed_budget TEXT, pending_artifact_refs TEXT);
    CREATE TABLE authoring_run_segments (run_id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, header TEXT, message_count INTEGER, first_sequence INTEGER, last_sequence INTEGER, format_version TEXT);
    CREATE TABLE authoring_session_messages (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, run_id TEXT, sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT, format_version TEXT);
    CREATE TABLE mutations (id TEXT);
    CREATE TABLE author_action_receipts (id TEXT, action_type TEXT);
    CREATE TABLE memory_items (id TEXT);
  `);
  // B10：批次 DB 状态必须与冻结 states.yml 的 S1 声明一致（3 章/2 accepted 正文/
  // 3 章计划/0 pending/2 memory_items），否则 state_not_constructed。
  const insertChapter = db.prepare(
    "INSERT INTO chapters (id, work_id, volume_id, title, seq, status, inserted_at, updated_at, summary, plan_direction) VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  insertChapter.run("chapter-row", WORK, null, "第01章：灯楼夜话", 1, "DRAFTING", "2026-11-03T10:00:00.000Z", "2026-11-03T10:00:00.000Z", "章摘要", "{}");
  insertChapter.run("chapter-row-2", WORK, null, "第02章：井底回声", 2, "DRAFTING", "2026-11-03T10:00:00.000Z", "2026-11-03T10:00:00.000Z", "章摘要", "{}");
  insertChapter.run("chapter-row-3", WORK, null, "第03章：潮汐账页", 3, "PLANNED", "2026-11-03T10:00:00.000Z", "2026-11-03T10:00:00.000Z", "章摘要", "{}");
  const insertDraft = db.prepare("INSERT INTO drafts (id, scene_id, content, status) VALUES (?,?,?,?)");
  insertDraft.run("draft-1", "scene-1", "第01章正文：雨港的灯楼立在旧码头尽头。", "ACCEPTED");
  insertDraft.run("draft-2", "scene-2", "第02章正文：井底传来回声。", "ACCEPTED");
  const insertMemory = db.prepare("INSERT INTO memory_items (id) VALUES (?)");
  insertMemory.run("mem-1");
  insertMemory.run("mem-2");
  db.prepare("INSERT INTO agent_events (id, run_id, event_type, refs) VALUES (?,?,?,?)").run("ev-1", RUN, "exploration_observed", '["obs_1"]');
  db.prepare("INSERT INTO decision_traces (trace_id, workspace_id, session_id, turn_id, context_refs) VALUES (?,?,?,?,?)").run("trace_1", WORKSPACE, SESSION, TURN, null);
  insertCanonicalRun(db);
  db.close();
}

function buildDir({ assistantText } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-behavior-verify-"));
  fs.mkdirSync(path.join(dir, "app-log"), { recursive: true });
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });
  writeJson(path.join(dir, "native-driver-ready.json"), {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-ref-behavior",
    provider: "strata",
    slice_id: "b71-first-consumer",
    ready_at: readyAt,
    app_path: "/tmp/B71 Behavior.app",
  });
  const screenshots = ["01-workbench.png", "after-input.png", "final.png"];
  for (const name of screenshots) fs.writeFileSync(path.join(dir, name), png());
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: "run-ref-behavior",
    driver: NATIVE_DRIVER,
    app_bundle: APP_BUNDLE,
    scope: "b71-first-consumer",
    screenshots,
  });
  const kinds = ["input", "ack", "turn", "maintenance", "maintenance", "maintenance"];
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
  writeJsonl(path.join(dir, "llm-calls", "2026-11-03.jsonl"), [llmRecord()]);
  writeJsonl(path.join(dir, "native-transport.jsonl"), [
    { at: "2026-11-03T10:00:00.300Z", direction: "sent", frame: ["3", "3", "workspace:test", "phx_join", { work_id: WORK, session_id: SESSION }] },
    { at: "2026-11-03T10:00:00.400Z", direction: "received", frame: ["3", "3", "workspace:test", "phx_reply", { status: "ok", response: { joined: true, work_id: WORK, session_id: SESSION } }] },
    { at: "2026-11-03T10:00:00.500Z", direction: "sent", frame: ["3", "4", "workspace:test", "user_message", { text: AUTHOR, turn_id: TURN, work_id: WORK, session_id: SESSION }] },
    { at: "2026-11-03T10:00:00.600Z", direction: "received", frame: ["3", "4", "workspace:test", "phx_reply", { status: "ok", response: { turn_id: TURN, run_id: RUN } }] },
    { at: "2026-11-03T10:00:02.000Z", direction: "received", frame: [null, null, "workspace:test", "turn_result", turnBody(assistantText)] },
    { at: "2026-11-03T10:00:00.400Z", direction: "http", method: "GET", path: "/api/works/w/sessions/resume", status: 200 },
  ]);
  writeJson(path.join(dir, "native-b71-config.json"), {
    slice_id: "b71-first-consumer",
    journey: "behavior",
    provider: "strata",
    target: { work_id: WORK, work_title: "B70 S1 部分多章", session_id: SESSION },
    message: AUTHOR,
    behavior: { case_id: CASE.case_id, target_id: CASE.target_id, state_id: CASE.state_id, split: CASE.split, expression_sha256: CASE.expression_sha256 },
  });
  writeJson(path.join(dir, "behavior-case.json"), CASE);
  writeJson(path.join(dir, "b71-start.json"), checkpoint("start"));
  writeJson(path.join(dir, "b71-final.json"), checkpoint("final"));
  writeJson(path.join(dir, "native-b71-driver-log.json"), {
    slice_id: "b71-first-consumer",
    provider: "strata",
    model: "iq3_s",
    behavior: { case_id: CASE.case_id },
    run: { status: "completed" },
    why: { opened: false, reason: "why_button_not_in_ax_tree" },
  });
  writeJson(path.join(dir, "strata-slot.json"), {
    schema: "b71-strata-slot/v1",
    model: "iq3_s",
    loaded_before: false,
    loaded_after: false,
    unloaded: true,
  });
  writeDatabase(dir);
  return dir;
}

test("behavior verifier：C-F1-003 合法目录通过并写分层 summary", () => {
  const dir = buildDir();
  const { verdict, summary } = verifyBehaviorBatch(dir);
  assert.equal(verdict.case_id, "C-F1-003");
  assert.equal(verdict.pass, true);
  assert.deepEqual(verdict.observed.actions, ["reply"]);
  assert.equal(summary.verdict.protocol, "pass");
  assert.equal(summary.verdict.author_behavior, "pass");
  assert.equal(summary.verdict.i10_signed, false);
  assert.equal(summary.author_behavior.case_id, "C-F1-003");
  assert(fs.existsSync(path.join(dir, "behavior-verdict.json")));
  assert(fs.existsSync(path.join(dir, "summary.json")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("behavior verifier：完成声明无事实（violation）失败关闭", () => {
  const dir = buildDir({ assistantText: "已经保存到作品档案。" });
  assert.throws(() => verifyBehaviorBatch(dir), /oracle 违规/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("behavior verifier：缺少 behavior-case / strata 未卸载时失败关闭", () => {
  const dir = buildDir();
  fs.rmSync(path.join(dir, "behavior-case.json"));
  assert.throws(() => verifyBehaviorBatch(dir), /缺少 behavior-case\.json/u);
  fs.rmSync(dir, { recursive: true, force: true });
  const unloaded = buildDir();
  const slotFile = path.join(unloaded, "strata-slot.json");
  const slot = JSON.parse(fs.readFileSync(slotFile, "utf8"));
  writeJson(slotFile, { ...slot, unloaded: false });
  assert.throws(() => verifyBehaviorBatch(unloaded), /strata 批次结束必须核验 loaded=null/u);
  fs.rmSync(unloaded, { recursive: true, force: true });
});

test("behavior verifier：run 与本批 session 错绑时失败关闭", () => {
  const dir = buildDir();
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  try {
    db.prepare("UPDATE agent_runs SET session_id = ? WHERE id = ?").run("session-other", RUN);
  } finally {
    db.close();
  }
  assert.throws(() => verifyBehaviorBatch(dir), /恰好一行/u);
  fs.rmSync(dir, { recursive: true, force: true });
});
