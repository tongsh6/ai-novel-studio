// behavior verifier 合成目录端到端：机械事实闭合，作者语义保留原文独立待审。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { verifyBehaviorBatch } from "./authoring_behavior_evidence.mjs";
import { APP_BUNDLE, NATIVE_DRIVER, shaFile } from "./scenario_evidence.mjs";
import { buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import { scopeWireMessage } from "./fixtures/authoring_request_ir.mjs";
import { loadLiveCaseCorpus, selectLiveCase } from "../quality/author_behavior_live_cases.mjs";

const bundle = loadLiveCaseCorpus();
const CASE = selectLiveCase(bundle, "C-F4-R08-MISSING-SOURCE", { allowExplore: true });
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
        choices: [{ index: 0, message: { role: "assistant", content: "请提供要登记的资料原文。" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    },
  };
}

function turnBody(assistantText = "请提供要登记的资料原文。") {
  return {
    turn_id: TURN, work_id: WORK, session_id: SESSION,
    status: "conversational",
    agent_run: { run_id: RUN, status: "completed" },
    assistant_message: { text: assistantText },
    adoption_state: { pending: [] },
    available_actions: [],
    truthfulness: { degraded: false },
  };
}

function canonSnapshot() {
  return buildAuthoringCanonSnapshot({
    at: "2026-11-03T10:00:00.000Z", includeChapterFacts: false, referenceLogs: [],
    tables: {
      works: [{ id: WORK, title: "B70 S2 空骨架" }],
      volumes: [{ id: "volume-empty", work_id: WORK, title: "第一卷" }],
      chapters: [], drafts: [], scenes: [], characters: [], memory_items: [],
      ledger_entries: [], author_action_receipts: [],
    },
  });
}

function checkpoint(name) {
  return {
    checkpoint: name,
    at: "2026-11-03T10:00:00.000Z",
    db_production_counts: { mutations: 0, author_action_receipts: 0, memory_items: 0, chapters: 0, drafts: 0 },
    authoring_canon: canonSnapshot(),
  };
}

const SESSION_CAPTURE_TIMES = Object.freeze({
  start: ["2026-11-03T10:00:00.405Z", "2026-11-03T10:00:00.410Z", "2026-11-03T10:00:00.420Z"],
  "step-0-before": ["2026-11-03T10:00:00.430Z", "2026-11-03T10:00:00.440Z", "2026-11-03T10:00:00.450Z"],
  "step-0-after": ["2026-11-03T10:00:02.090Z", "2026-11-03T10:00:02.100Z", "2026-11-03T10:00:02.110Z"],
  final: ["2026-11-03T10:00:02.190Z", "2026-11-03T10:00:02.200Z", "2026-11-03T10:00:02.210Z"],
});

function sessionCheckpoint(name, state) {
  const [startedAt, requestedAt, completedAt] = SESSION_CAPTURE_TIMES[name];
  const body = {
    work: { id: WORK },
    session: { id: SESSION, work_id: WORK, status: "ACTIVE" },
    read_only: false,
    pending_adoptions: [],
    pending_adoption_turn_results: [],
    resolved_adoptions: [],
    inbox_pending_adoptions: [],
    inbox_pending_adoption_turn_results: [],
    inbox_resolved_adoptions: [],
  };
  const rawBody = JSON.stringify(body, null, 2) + "\n";
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const record = {
    at: requestedAt, direction: "http", method: "GET",
    path: `/api/works/${WORK}/sessions/${SESSION}`,
    request_id: `http-session-${name}`, status: 200,
    scope: { kind: "session_show", work_id: WORK, session_id: SESSION, turn_id: null },
    response_scope: { kind: "session_show", work_id: WORK, session_id: SESSION, turn_id: null },
    body_state: {
      complete: true, json: "valid", truncated: false,
      bytes: Buffer.byteLength(rawBody), sha256: bodyHash,
      content_type: "application/json; charset=utf-8", content_encoding: null,
    },
    body,
  };
  return {
    ...checkpoint(name), at: completedAt,
    state_facts: { ...state, pending_artifact_ids: [] },
    session_capture: record,
    session_capture_window: { started_at: startedAt, completed_at: completedAt, body_sha256: bodyHash },
  };
}

// canonical 执行段：agent_runs 只保留身份/模式列，消息与 refs 在段头/消息行。
function insertCanonicalRun(db, { runId = RUN, sessionId = SESSION, workId = WORK, usedRefs = [] } = {}) {
  const firstSequence = db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS first_sequence FROM authoring_session_messages WHERE session_id = ?",
  ).get(sessionId).first_sequence;
  const run = { run_id: runId, workspace_id: WORKSPACE, work_id: workId, session_id: sessionId, parent_turn_ref: TURN, profile_ref: "judgment_loop_v1" };
  const message =
    usedRefs.length > 0
      ? { role: "assistant", provenance: "model", blocks: [{ type: "tool_call", call_id: "call-self-report", name: "submit_tentative_artifact", arguments: { self_report: { used_context_refs: usedRefs } } }] }
      : { role: "assistant", provenance: "model", blocks: [{ type: "text", text: "请提供要登记的资料原文。" }] };
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
  ).run(runId, WORKSPACE, workId, sessionId, TURN, JSON.stringify(header), 1, firstSequence, firstSequence, SEGMENT_VERSION);
  db.prepare(
    "INSERT INTO authoring_session_messages (id, workspace_id, work_id, session_id, run_id, sequence, run_sequence, role, message, format_version) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(`msg-${runId}-1`, WORKSPACE, workId, sessionId, runId, firstSequence, 1, "assistant", JSON.stringify(message), MESSAGE_VERSION);
}

function writeDatabase(dir) {
  const dbDir = path.join(dir, "database");
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, "ai_novel_studio_test.sqlite3"));
  db.exec(`
    CREATE TABLE works (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE volumes (id TEXT PRIMARY KEY, work_id TEXT, title TEXT);
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
  // S2 有真实作品元数据和空卷，章、正文、记忆、候选都为已知0。
  db.prepare("INSERT INTO works VALUES (?,?)").run(WORK, "B70 S2 空骨架");
  db.prepare("INSERT INTO volumes VALUES (?,?,?)").run("volume-empty", WORK, "第一卷");
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
    { at: "2026-11-03T10:00:02.050Z", direction: "received",
      frame: [null, null, "workspace:test", "agent_run_state", {
        run_id: RUN, workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION,
        parent_turn_ref: TURN, status: "completed",
      }] },
    { at: "2026-11-03T10:00:00.400Z", direction: "http", method: "GET", path: "/api/works/w/sessions/resume", status: 200 },
  ]);
  writeJson(path.join(dir, "native-b71-config.json"), {
    slice_id: "b71-first-consumer",
    journey: "behavior",
    provider: "strata",
    target: { work_id: WORK, work_title: "B70 S2 空骨架", session_id: SESSION },
    message: AUTHOR,
    behavior: { case_id: CASE.case_id, target_id: CASE.target_id, state_id: CASE.state_id, split: CASE.split, expression_sha256: CASE.expression_sha256 },
  });
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
  fs.writeFileSync(path.join(dir, "seed.log"),
    `[b70-author-behavior-seed] state=S2-empty-skeleton work_id=${WORK} work_title=B70 S2 空骨架 session_id=${SESSION}\n`);
  sealBehaviorFacts(dir, assistantText);
  return dir;
}


function sealBehaviorFacts(dir, assistantText = "请提供要登记的资料原文。") {
  const provider = "splash";
  const model = "local/Q4-PLE4";
  const pcall = "pcall_behavior_1";
  const prun = "prun_behavior_1";
  const scope = { facts: {}, coverage: {}, omissions: [] };
  const messages = [
    { role: "application_base", provenance: "application", blocks: [{ type: "text", text: "规则" }],
      source_refs: [], base_refs: [], versions: {} },
    { role: "user", provenance: "author", blocks: [{ type: "text", text: AUTHOR }],
      source_refs: [{ ref: "author_input:message_behavior_1" }], versions: {} },
    { role: "scope_update", provenance: "application", blocks: [{ type: "scope", content: scope }],
      source_refs: [], versions: { scope_revision: 1 } },
    { role: "assistant", provenance: "model", provider_call_ref: pcall, provider_run_ref: prun,
      blocks: [{ type: "text", text: assistantText }] },
  ];
  const record = {
    ts: "2026-11-03T10:00:01.000Z", step: "judgment",
    turn_id: TURN, workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION,
    provider_call_ref: pcall, provider_run_ref: prun, provider,
    request: { url: "http://127.0.0.1:8000/v1/chat/completions", body: {
      model, reasoning_effort: "high", max_tokens: 32000, stream: true, tools: [], tool_choice: "auto",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "【应用数据 · application_base · 非作者原话】\n规则" },
        { role: "user", content: AUTHOR },
        scopeWireMessage(scope, { versions: { scope_revision: 1 }, sourceRefs: [] }),
      ],
    } },
    response: { status: 200, model,
      usage: { model, input_tokens: 100, output_tokens: 10, cached_tokens: 0, latency_ms: 1000, ttft_ms: null },
      body: { source: "sse_decoder", tool_calls: [] } },
  };
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  let state;
  try {
    db.exec("CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, status TEXT, provider_id TEXT, model TEXT, purpose TEXT)");
    db.exec("CREATE TABLE provider_events (id TEXT PRIMARY KEY, provider_run_id TEXT, provider_call_ref TEXT, agent_run_id TEXT, event_type TEXT, emitted_at TEXT)");
    db.prepare("INSERT INTO provider_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(prun, pcall, RUN, WORKSPACE, WORK, SESSION, TURN, "completed", provider, model, "author_reasoning");
    db.prepare("UPDATE agent_runs SET consumed_budget=? WHERE id=?").run(JSON.stringify({ provider_calls: 1 }), RUN);
    const headerRow = db.prepare("SELECT header FROM authoring_run_segments WHERE run_id=?").get(RUN);
    const header = JSON.parse(headerRow.header);
    header.observation_refs = [];
    header.system = { identity_ref: "identity:authoring/v1", instructions: "system" };
    db.prepare("UPDATE authoring_run_segments SET header=?, message_count=?, first_sequence=1, last_sequence=? WHERE run_id=?")
      .run(JSON.stringify(header), messages.length, messages.length, RUN);
    db.prepare("DELETE FROM authoring_session_messages WHERE run_id=?").run(RUN);
    const insert = db.prepare("INSERT INTO authoring_session_messages VALUES (?,?,?,?,?,?,?,?,?,?)");
    messages.forEach((message, index) => insert.run(`msg-${RUN}-${index + 1}`, WORKSPACE, WORK, SESSION,
      RUN, index + 1, index + 1, message.role, JSON.stringify(message), MESSAGE_VERSION));
    state = { chapters_rows: db.prepare("SELECT * FROM chapters").all(),
      drafts_rows: db.prepare("SELECT * FROM drafts").all(), memory_count: 0, pending_artifact_count: 0 };
  } finally { db.close(); }
  writeJsonl(path.join(dir, "llm-calls", "2026-11-03.jsonl"), [record]);
  writeJsonl(path.join(dir, "app-log", "2026-11-03.jsonl"),
    [{ at: record.ts, event: "provider_gateway.complete.start", provider }]);
  const runtimeFacts = { schema: "b87-r01-runtime-facts/v1", mix_env: "test",
    provider: { selected: provider, model, endpoint: "http://127.0.0.1:8000" },
    context_pressure: { provider, window: 262144, maintenance_ratio: 0.70 },
    auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false };
  writeJson(path.join(dir, "runtime-facts.json"), runtimeFacts);
  const configFile = path.join(dir, "native-b71-config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const budget = { batches: 1, author_sends: 1, manual_retries: 0, scenario_seconds: 900,
    input_timeout_ms: 120000, turn_timeout_ms: 360000 };
  const seed = { script: "scripts/seed_author_behavior_states.exs",
    sha256: shaFile(path.resolve("scripts/seed_author_behavior_states.exs")) };
  const manifest = {
    id: "behavior-frozen-sse-test",
    model: { provider, model, thinking: "enabled", reasoning_effort: "high",
      max_tokens: 32000, timeout_ms: 300000, context_window: 262144 },
    runtime: { profile: "b87-r01-controlled-splash-high",
      context_pressure: { window: 262144, maintenance_ratio: 0.70 },
      auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false },
    budget, scenarios: [{ id: CASE.journey_id, slice_id: "b71-first-consumer", case_id: CASE.case_id,
      message: AUTHOR, steps: [CASE], seed, evidence: { dir } }],
  };
  writeJson(path.join(dir, "preregistration.json"), manifest);
  config.provider = provider;
  config.steps = [CASE];
  config.seed = seed;
  config.budget = budget;
  config.preregistration = {
    id: manifest.id, model, sha256: shaFile(path.join(dir, "preregistration.json")),
  };
  config.runtime = { profile: manifest.runtime.profile, observed: runtimeFacts,
    facts_sha256: shaFile(path.join(dir, "runtime-facts.json")) };
  writeJson(configFile, config);
  const readyFile = path.join(dir, "native-driver-ready.json");
  writeJson(readyFile, { ...JSON.parse(fs.readFileSync(readyFile, "utf8")), provider });
  const identity = { turn_id: TURN, run_id: RUN, topic: "workspace:test",
    work_id: WORK, session_id: SESSION, terminal_kind: "completed",
    terminal_status: "completed", terminal_source: "wire" };
  writeJson(path.join(dir, "native-b71-driver-log.json"), {
    slice_id: config.slice_id, provider, model, turn: identity, run: { status: "completed" },
    behavior: config.behavior, why: { opened: false, reason: "not_observed" },
    steps: [{ case_id: CASE.case_id, sequence: 0, turn: identity, run: { status: "completed" } }],
  });
  const transportFile = path.join(dir, "native-transport.jsonl");
  const wire = fs.readFileSync(transportFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  for (const name of ["start", "step-0-before", "step-0-after", "final"]) {
    const value = sessionCheckpoint(name, state);
    writeJson(path.join(dir, `b71-${name}.json`), value);
    wire.push(value.session_capture);
  }
  writeJsonl(transportFile, wire.sort((left, right) => left.at.localeCompare(right.at)));
  fs.rmSync(path.join(dir, "strata-slot.json"));
}

test("behavior verifier：C-F4-R08-MISSING-SOURCE 合法目录通过并写分层 summary", () => {
  const dir = buildDir();
  const { verdict, summary } = verifyBehaviorBatch(dir);
  assert.equal(verdict.case_id, "C-F4-R08-MISSING-SOURCE");
  assert.equal(verdict.pass, false);
  assert.equal(verdict.mechanism_pass, true);
  assert.equal(verdict.semantic_review.status, "pending_independent_review");
  assert.deepEqual(verdict.observed.actions, ["reply"]);
  assert.equal(summary.verdict.protocol, "pass");
  assert.notEqual(summary.verdict.author_behavior, "pass");
  assert.equal(summary.verdict.model_semantics, "pending_independent_review");
  assert.equal(summary.provider, "splash");
  assert.equal(summary.semantic_review.status, "pending_independent_review");
  assert(summary.not_signed.includes("model_semantic_correctness"));
  assert.equal(fs.existsSync(path.join(dir, "strata-slot.json")), false);
  assert.equal(summary.verdict.i10_signed, false);
  assert.equal(summary.author_behavior.case_id, "C-F4-R08-MISSING-SOURCE");
  assert(fs.existsSync(path.join(dir, "behavior-verdict.json")));
  assert(fs.existsSync(path.join(dir, "summary.json")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("behavior verifier：词面完整但无事实的声明留给独立语义审读", () => {
  const dir = buildDir({ assistantText: "已经保存到作品档案。" });
  const { verdict, summary } = verifyBehaviorBatch(dir);
  assert.equal(verdict.mechanism_pass, true);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.semantic_review.reply, "已经保存到作品档案。");
  assert.equal(verdict.semantic_review.status, "pending_independent_review");
  assert.notEqual(summary.verdict.author_behavior, "pass");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("behavior verifier：缺冻结steps或provider改写失败关闭，不要求卸载外部服务", () => {
  for (const mutate of [
    (config) => { delete config.steps; },
    (config) => { config.provider = "strata"; },
    (config) => { config.steps[0].expected.allowed_actions = ["execute"]; },
  ]) {
    const dir = buildDir();
    const file = path.join(dir, "native-b71-config.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(config);
    writeJson(file, config);
    assert.throws(() => verifyBehaviorBatch(dir), /冻结|steps|case|预注册|provider|供应商|expected/u);
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

for (const [name, mutate] of [
  ["缺调用", () => []],
  ["重复pcall/prun", (records) => [records[0], structuredClone(records[0])]],
  ["错pcall", (records) => { records[0].provider_call_ref = "pcall_other"; return records; }],
  ["错prun", (records) => { records[0].provider_run_ref = "prun_other"; return records; }],
  ["跨session", (records) => { records[0].session_id = "session-other"; return records; }],
  ["非SSE替身", (records) => { records[0].response.body = { choices: [] }; return records; }],
  ["错URL", (records) => { records[0].request.url = "http://127.0.0.1:9000/v1/chat/completions"; return records; }],
  ["错Base字节", (records) => { records[0].request.body.messages[1].content += "未登记规则"; return records; }],
  ["错model", (records) => { records[0].request.body.model = "other-model"; return records; }],
  ["错effort", (records) => { records[0].request.body.reasoning_effort = "low"; return records; }],
  ["错max_tokens", (records) => { records[0].request.body.max_tokens = 2048; return records; }],
]) {
  test(`R08 behavior verifier 真实逐调用证据拒绝${name}`, () => {
    const dir = buildDir();
    try {
      const file = path.join(dir, "llm-calls", "2026-11-03.jsonl");
      const records = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      writeJsonl(file, mutate(records));
      assert.throws(() => verifyBehaviorBatch(dir), /调用|对账|provider|SSE|来源|绑定|runtime|模型|model|URL|url|endpoint|effort|max_tokens|request|record/u);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test("R08 behavior verifier 每步前后检查点不能缺，末态不能补造起态", () => {
  for (const name of ["step-0-before", "step-0-after"]) {
    const dir = buildDir();
    try {
      fs.rmSync(path.join(dir, `b71-${name}.json`));
      assert.throws(() => verifyBehaviorBatch(dir), /checkpoint|检查点|before|after|ENOENT/u);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const dir = buildDir();
  try {
    const file = path.join(dir, "b71-step-0-before.json");
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    before.state_facts.pending_artifact_count = 1;
    writeJson(file, before);
    assert.throws(() => verifyBehaviorBatch(dir), /state|状态|pending|前态/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("R08 behavior verifier 不能以SSE和最后响应代替唯一ACK与实际run终局", () => {
  for (const fault of ["duplicate_ack", "run_still_running"]) {
    const dir = buildDir();
    try {
      if (fault === "duplicate_ack") {
        const file = path.join(dir, "native-transport.jsonl");
        const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        rows.push(structuredClone(rows.find((row) => row.frame?.[3] === "phx_reply" && row.frame?.[4]?.response?.run_id === RUN)));
        writeJsonl(file, rows);
      } else {
        const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
        try { db.prepare("UPDATE agent_runs SET status='running' WHERE id=?").run(RUN); }
        finally { db.close(); }
      }
      assert.throws(() => verifyBehaviorBatch(dir), /ACK|ack|唯一|恰好|terminal|终局|running|status|完成/u);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
test("R08 checkpoint衔接的canon变化不能被相同state计数隐藏", () => {
  for (const boundary of ["start", "final"]) {
    const dir = buildDir();
    try {
      const file = path.join(dir, `b71-${boundary}.json`);
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      value.authoring_canon.tables.works.canon_sha256 = "b".repeat(64);
      value.authoring_canon.tables.works.rows_sha256 = "b".repeat(64);
      writeJson(file, value);
      assert.throws(() => verifyBehaviorBatch(dir), /canon|前态|末态|连续|checkpoint/u);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
for (const [name, mutate] of [
  ["最终DBcompleted不能回填检查点前的运行终局", (wire) => {
    const completed = wire.find((record) => record.frame?.[3] === "agent_run_state");
    completed.at = "2026-11-03T10:00:03.000Z";
    const running = structuredClone(completed);
    running.at = "2026-11-03T10:00:02.050Z";
    running.frame[4].status = "running";
    wire.push(running);
  }],
  ["DBcompleted不能替代缺失的wire终态", (wire) => {
    wire.splice(wire.findIndex((record) => record.frame?.[3] === "agent_run_state"), 1);
  }],
]) {
  test(`R08 behavior verifier 拒绝${name}`, () => {
    const dir = buildDir();
    try {
      const wireFile = path.join(dir, "native-transport.jsonl");
      const wire = fs.readFileSync(wireFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      mutate(wire);
      writeJsonl(wireFile, wire.sort((left, right) => left.at.localeCompare(right.at)));
      const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"), { readOnly: true });
      try {
        assert.equal(db.prepare("SELECT status FROM agent_runs WHERE id=?").get(RUN).status, "completed");
      } finally {
        db.close();
      }
      assert.equal(wire.find((record) => record.frame?.[3] === "turn_result").at,
        "2026-11-03T10:00:02.000Z", "业务结果原件没有被改成运行终态");
      assert.throws(() => verifyBehaviorBatch(dir), /运行终态|运行终局|实际可交付终局|wire.*终态|terminal/u);
      assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [name, checkpointName, mutate, expected] of [
  ["缺原HTTP记录", "step-0-after", (value, wire) => {
    wire.splice(wire.findIndex((row) => row.request_id === value.session_capture.request_id), 1);
  }, /session capture 未绑定真实唯一 transport/u],
  ["原HTTP记录重复", "step-0-after", (value, wire) => {
    wire.push(structuredClone(value.session_capture));
  }, /session capture 未绑定真实唯一 transport/u],
  ["原HTTP记录的body被替换", "step-0-after", (value, wire) => {
    wire.find((row) => row.request_id === value.session_capture.request_id).body.extra = "不是checkpoint收到的原body";
  }, /session capture 未绑定真实唯一 transport/u],
  ["缺session capture", "step-0-after", (value) => {
    delete value.session_capture;
  }, /session capture 无效/u],
  ["缺采集窗口", "step-0-after", (value) => {
    delete value.session_capture_window;
  }, /session capture 无效: capture_window_missing/u],
  ["缺request_id", "step-0-after", (value) => {
    delete value.session_capture.request_id;
  }, /session capture 无效: capture_incomplete/u],
  ["跨checkpoint复用request_id", "final", (value, _wire, dir) => {
    const start = JSON.parse(fs.readFileSync(path.join(dir, "b71-start.json"), "utf8"));
    value.session_capture = start.session_capture;
    value.session_capture_window = start.session_capture_window;
  }, /重用 session capture request_id/u],
  ["缺pending身份集合", "step-0-after", (value) => {
    delete value.state_facts.pending_artifact_ids;
  }, /pending 身份不符/u],
  ["伪造pending身份", "step-0-after", (value) => {
    value.state_facts.pending_artifact_ids = ["not-in-session-show"];
  }, /pending 身份不符/u],
  ["伪造pending数量", "step-0-after", (value) => {
    value.state_facts.pending_artifact_count = 1;
  }, /pending 计数不符/u],
  ["窗口原字节SHA错误", "step-0-after", (value) => {
    value.session_capture_window.body_sha256 = "0".repeat(64);
  }, /原响应 hash 不符/u],
  ["记录缺原字节SHA", "step-0-after", (value) => {
    delete value.session_capture.body_state.sha256;
  }, /session capture 无效: capture_incomplete/u],
  ["前态采集跨过作者输入", "step-0-before", (value) => {
    value.session_capture_window.completed_at = "2026-11-03T10:00:00.550Z";
  }, /前态采集晚于作者发送/u],
  ["后态采集早于本轮结果", "step-0-after", (value) => {
    value.session_capture_window.started_at = "2026-11-03T10:00:01.900Z";
  }, /后态采集早于实际业务终态/u],
  ["早已在途的响应落入新日志", "step-0-after", (value) => {
    value.session_capture.at = "2026-11-03T10:00:02.080Z";
  }, /session capture 无效: capture_missing/u],
  ["相邻前态窗口重叠", "step-0-before", (value) => {
    value.session_capture_window.started_at = "2026-11-03T10:00:00.400Z";
  }, /session capture 时段不连续/u],
  ["末态窗口倒退", "final", (value, wire) => {
    value.session_capture_window.started_at = "2026-11-03T10:00:02.080Z";
    value.session_capture_window.completed_at = "2026-11-03T10:00:02.090Z";
    value.session_capture.at = "2026-11-03T10:00:02.085Z";
    wire.find((row) => row.request_id === value.session_capture.request_id).at = value.session_capture.at;
  }, /session capture 时段不连续/u],
]) {
  test(`R08 behavior verifier session证据拒绝${name}`, () => {
    const dir = buildDir();
    try {
      const file = path.join(dir, `b71-${checkpointName}.json`);
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      const wireFile = path.join(dir, "native-transport.jsonl");
      const wire = fs.readFileSync(wireFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      mutate(value, wire, dir);
      writeJson(file, value);
      writeJsonl(wireFile, wire);
      assert.throws(() => verifyBehaviorBatch(dir), expected);
      assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
