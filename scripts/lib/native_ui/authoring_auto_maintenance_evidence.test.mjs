// A3 安全点自动维护判据 C1–C10 正反例 + 全类别 AX 扫描 + 合成目录端到端。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { spawn } from "node:child_process";
import {
  evaluateAutoMaintenance,
  scanAuthorVisibleFiles,
  verifyAutoMaintenanceBatch,
  waitForEvidenceFile,
} from "./authoring_auto_maintenance_evidence.mjs";

const WORK = "work-auto-1";
const SESSION = "session-auto-1";
const RUN = "run-auto-1";
const CALL_ID = "call_auto_1";
const EVENT_AT = "2026-11-04T10:00:00.000Z";
const readyAt = new Date(Date.now() - 3600_000).toISOString();

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
const png = () => Buffer.from("89504e470d0a1a0a", "hex");

function transcriptRecord() {
  return {
    transcript: {
      messages: [
        { role: "application_base", content: "base" },
        { role: "user", content: "先读一下第01章的正文和章计划。" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: CALL_ID, type: "function", function: { name: "explore", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: CALL_ID, content: "{\"chapter\":\"第01章\"}" },
        { role: "checkpoint", content: "已整理的较早记录", call_ids: [CALL_ID], covered_exchanges: 1 },
      ],
    },
  };
}

function dbFactsFor() {
  return {
    agent_events: [
      {
        id: "evt-1",
        run_id: RUN,
        event_type: "checkpoint_created",
        visibility: "author",
        sequence: 2,
        payload: JSON.stringify({ covered_exchanges: 1, retained_items: 0, scope: "earlier_work_turns", sources: ["资料查阅"] }),
        inserted_at: EVENT_AT,
      },
    ],
    agent_runs: [{ id: RUN, status: "completed", authoring_transcript: JSON.stringify(transcriptRecord()) }],
    provider_runs: [
      { id: "prun-1", provider_id: "strata", agent_run_id: RUN, purpose: "planner", inserted_at: "2026-11-04T09:59:10.000Z" },
    ],
    interactions: [],
    mutations: [],
  };
}

function llmRecords() {
  return [
    {
      ts: "2026-11-04T09:59:30.000Z",
      provider: "strata",
      turn_id: "turn-before",
      request: { body: { messages: [{ role: "user", content: "读第01章" }, { role: "tool", tool_call_id: CALL_ID, content: "旧观察" }] } },
      response: { status: 200, usage: { input_tokens: 1200, output_tokens: 50 } },
    },
    {
      ts: "2026-11-04T10:00:05.000Z",
      provider: "strata",
      turn_id: "turn-after",
      request: { body: { messages: [{ role: "application_base", content: "base" }, { role: "user", content: "继续读第03章" }] } },
      response: { status: 200, usage: { input_tokens: 3000, output_tokens: 40 } },
    },
  ];
}

function driverLogFor() {
  return {
    env: { auto_maintenance_enabled: "1", window_overrides: "strata:4096" },
    requests: [{ index: 1 }, { index: 2 }],
    triggered: true,
    first_trigger_index: 2,
    maintenance_strip: { found: true, clicked: true },
    refresh: { before_checkpoint_events: 1, after_checkpoint_events: 1 },
    failure_injection: {
      trigger_created: true,
      author_error_visible: false,
      checkpoint_events_before_failure: 1,
      checkpoint_events_after_failure: 1,
      recovered_after_drop: true,
    },
    termination: { llm_calls: 2 },
  };
}

function buildDir({ strip = true, expanded = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-auto-maint-"));
  fs.mkdirSync(path.join(dir, "database"), { recursive: true });
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });
  fs.mkdirSync(path.join(dir, "app-log"), { recursive: true });
  writeJson(path.join(dir, "native-driver-ready.json"), {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-ref-auto",
    provider: "strata",
    slice_id: "b71-first-consumer",
    ready_at: readyAt,
    app_path: "/tmp/B71 Auto Maintenance.app",
  });
  writeJson(path.join(dir, "native-b71-config.json"), {
    slice_id: "b71-first-consumer",
    journey: "auto-maintenance",
    provider: "strata",
    target: { work_id: WORK, work_title: "自动维护验证作品", session_id: SESSION },
    message: "先读一下第01章的正文和章计划，我想知道现在的进度。",
    auto_maintenance: { requests: [] },
  });
  const screenshots = ["01-workbench.jpg", "after-input.jpg", "final.jpg"];
  for (const name of screenshots) fs.writeFileSync(path.join(dir, name), png());
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: "run-ref-auto",
    driver: "ax-native-system-ui",
    app_bundle: "com.ai-novel-studio.app",
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
      { event: "wait_start", kind, at: Date.now() - 6000, id: `wait-${index}` },
      { event: "wait_end", kind, ended_at: Date.now() - 5000, id: `wait-${index}` },
    ]),
  );
  writeJson(path.join(dir, "wait-stats.json"), { active: null, completed: kinds.length });
  writeJsonl(path.join(dir, "heartbeat.jsonl"), [{ at: readyAt }]);
  writeJsonl(path.join(dir, "native-transport.jsonl"), [
    { at: "2026-11-04T09:59:15.000Z", direction: "http", method: "GET", path: "/api/works/w/sessions/resume", status: 200 },
    { at: "2026-11-04T09:59:20.000Z", direction: "sent", frame: [null, null, "workspace:test", "user_message", { turn_id: "turn-a", text: "先读一下第01章" }] },
    { at: "2026-11-04T09:59:40.000Z", direction: "received", frame: [null, null, "workspace:test", "turn_result", { turn_id: "turn-a", status: "conversational" }] },
    { at: "2026-11-04T09:59:50.000Z", direction: "sent", frame: [null, null, "workspace:test", "user_message", { turn_id: "turn-b", text: "再读一下第02章" }] },
    { at: "2026-11-04T10:00:10.000Z", direction: "received", frame: [null, null, "workspace:test", "turn_result", { turn_id: "turn-b", status: "conversational" }] },
  ]);
  writeJsonl(path.join(dir, "app-log", "2026-11-04.jsonl"), [
    { at: "2026-11-04T09:59:10.000Z", event: "provider_gateway.complete.start", provider: "strata" },
    { at: "2026-11-04T10:00:02.000Z", event: "agent_run.auto_maintenance.error", run_id: RUN, reason: "maintenance unavailable" },
  ]);
  writeJsonl(path.join(dir, "llm-calls", "2026-11-04.jsonl"), llmRecords());
  writeJson(path.join(dir, "native-b71-driver-log.json"), driverLogFor());
  writeJson(path.join(dir, "native-app-cleanup.json"), { remaining: [], process_observation: { method: "pgrep+lsof", actions: [] } });
  writeJson(path.join(dir, "strata-slot.json"), {
    schema: "b71-strata-slot/v1",
    model: "iq3_s",
    loaded_before: false,
    loaded_after: false,
    unloaded: true,
  });
  for (const name of ["start", "final"]) {
    writeJson(path.join(dir, `b71-${name}.json`), {
      checkpoint: name,
      db_production_counts: {},
      authoring_canon: { tables: { works: { row_count: 1, rows_sha256: "w", canon_sha256: "w" } } },
    });
  }
  const stripText = strip ? "较早的 1 项创作过程已整理" : "普通消息";
  fs.writeFileSync(path.join(dir, "after-maintenance.ax.txt"), `\t\t0/0/0/0/0/10 AXButton, ${stripText}\n`);
  const expandedText = expanded
    ? "已整理的较早记录\n为了保持这次创作始终清晰连贯，系统整理了较早的 1 项已完成操作。\n原始记录仍然保留，不会被删除或改写。\n涉及：资料查阅\n查看完整记录\n"
    : "普通内容\n";
  fs.writeFileSync(path.join(dir, "after-expanded.ax.txt"), expandedText);
  fs.writeFileSync(path.join(dir, "after-refresh.ax.txt"), `\t\t0/0/0/0/0/10 AXButton, ${stripText}\n`);
  fs.writeFileSync(path.join(dir, "after-failure.ax.txt"), "\t\t0/0/0/0/0/11 AXStaticText, Value: 已停止\n");
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  db.exec(`
    CREATE TABLE agent_events (id TEXT, run_id TEXT, event_type TEXT, visibility TEXT, sequence INTEGER, payload TEXT, inserted_at TEXT);
    CREATE TABLE agent_runs (id TEXT, status TEXT, authoring_transcript TEXT);
    CREATE TABLE provider_runs (id TEXT, provider_id TEXT, agent_run_id TEXT, purpose TEXT, inserted_at TEXT);
    CREATE TABLE interactions (id TEXT, turn_id TEXT, content TEXT);
    CREATE TABLE mutations (id TEXT);
  `);
  db.prepare("INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)").run("evt-1", RUN, "checkpoint_created", "author", 2, JSON.stringify({ covered_exchanges: 1, scope: "earlier_work_turns", sources: ["资料查阅"] }), EVENT_AT);
  db.prepare("INSERT INTO agent_runs VALUES (?,?,?)").run(RUN, "completed", JSON.stringify(transcriptRecord()));
  db.prepare("INSERT INTO provider_runs VALUES (?,?,?,?,?)").run("prun-1", "strata", RUN, "planner", "2026-11-04T09:59:10.000Z");
  db.close();
  return dir;
}

function evaluate(overrides = {}) {
  const dir = overrides.dir ?? buildDir(overrides.build);
  return evaluateAutoMaintenance({
    config: { slice_id: "b71-first-consumer", journey: "auto-maintenance", provider: "strata" },
    dbFacts: overrides.dbFacts ?? dbFactsFor(),
    checkpoints: { start: { authoring_canon: { tables: {} } }, final: { authoring_canon: { tables: {} } } },
    driverLog: overrides.driverLog ?? driverLogFor(),
    cleanup: overrides.cleanup ?? { remaining: [], process_observation: { method: "pgrep+lsof" } },
    strataSlot: overrides.strataSlot ?? { unloaded: true },
    llmRecords: overrides.llmRecords ?? llmRecords(),
    appLog: overrides.appLog ?? [{ event: "agent_run.auto_maintenance.error" }],
    dir,
  });
}

test("A3 正例：C1–C10 全过（真实压力/事件+checkpoint/细条/四要素/精简/canonical/幂等/失败静默/扫描/清理）", () => {
  const result = evaluate();
  assert.deepEqual(result.failed, []);
  assert.equal(result.checks.C1_real_pressure.ok, true);
  assert.equal(result.checks.C2_auto_maintenance_committed.ok, true);
  assert.equal(result.checks.C3_strip_visible.ok, true);
  assert.equal(result.checks.C4_expanded_factors.ok, true);
  assert.equal(result.checks.C5_next_request_compact.ok, true);
  assert.equal(result.checks.C6_canonical_complete.ok, true);
  assert.equal(result.checks.C7_refresh_idempotent.ok, true);
  assert.equal(result.checks.C8_failure_silent.ok, true);
  assert.equal(result.checks.C9_author_visible_no_internal_tokens.ok, true);
  assert.equal(result.checks.C10_cleanup.ok, true);
});

test("A3 反例：压力不足/无事件/细条缺失/四要素缺失 分别 fail", () => {
  const noPressure = evaluate({ llmRecords: llmRecords().map((record) => ({ ...record, response: { usage: { input_tokens: 500 } } })) });
  assert.equal(noPressure.checks.C1_real_pressure.ok, false);
  const noEvents = evaluate({ dbFacts: { ...dbFactsFor(), agent_events: [] } });
  assert.equal(noEvents.checks.C2_auto_maintenance_committed.ok, false);
  const noStrip = evaluate({ build: { strip: false } });
  assert.equal(noStrip.checks.C3_strip_visible.ok, false);
  const noExpanded = evaluate({ build: { expanded: false } });
  assert.equal(noExpanded.checks.C4_expanded_factors.ok, false);
});

test("A3 反例：精简泄漏/ canonical 缺失/刷新不幂等/失败可见/清理失败 分别 fail", () => {
  const leak = evaluate({
    llmRecords: llmRecords().map((record, index) =>
      index === 1
        ? { ...record, request: { body: { messages: [{ role: "tool", tool_call_id: CALL_ID, content: "旧观察" }, { role: "user", content: "x" }, { role: "user", content: "y" }] } } }
        : record,
    ),
  });
  assert.equal(leak.checks.C5_next_request_compact.ok, false);
  const canonical = evaluate({
    dbFacts: {
      ...dbFactsFor(),
      agent_runs: [{ id: RUN, status: "completed", authoring_transcript: JSON.stringify({ transcript: { messages: [{ role: "user", content: "hi" }] } }) }],
    },
  });
  assert.equal(canonical.checks.C6_canonical_complete.ok, false);
  const refresh = evaluate({ driverLog: { ...driverLogFor(), refresh: { before_checkpoint_events: 1, after_checkpoint_events: 2 } } });
  assert.equal(refresh.checks.C7_refresh_idempotent.ok, false);
  const visibleFailure = evaluate({
    driverLog: { ...driverLogFor(), failure_injection: { ...driverLogFor().failure_injection, author_error_visible: true } },
  });
  assert.equal(visibleFailure.checks.C8_failure_silent.ok, false);
  const cleanup = evaluate({ cleanup: { remaining: [{ pid: 1 }], process_observation: {} } });
  assert.equal(cleanup.checks.C10_cleanup.ok, false);
  const strata = evaluate({ strataSlot: { unloaded: false } });
  assert.equal(strata.checks.C10_cleanup.ok, false);
});

test("A3 反例：AX 全类别泄漏命中（prose_writing / 工作过程）→ C9 fail", () => {
  const clean = scanAuthorVisibleFiles(buildDir());
  assert.equal(clean.ok, true);
  const dir = buildDir();
  fs.writeFileSync(path.join(dir, "after-maintenance.ax.txt"), "\t\t0/0/0/0/0/10 AXStaticText, Value: 已确认「prose_writing」操作\n");
  const leak = scanAuthorVisibleFiles(dir);
  assert.equal(leak.ok, false);
  assert(leak.hits.some((hit) => hit.token === "prose_writing"));
});

test("A3 合成目录端到端：verify 通过并写 summary；细条缺失时失败关闭", () => {
  const dir = buildDir();
  const { result, summary } = verifyAutoMaintenanceBatch(dir);
  assert.deepEqual(result.failed, []);
  assert.equal(summary.verdict.mechanism, "pass");
  assert.equal(summary.verdict.auto_maintenance_loop_closed, true);
  fs.rmSync(dir, { recursive: true, force: true });

  const failing = buildDir({ strip: false });
  assert.throws(() => verifyAutoMaintenanceBatch(failing), /auto-maintenance 判据失败/u);
  fs.rmSync(failing, { recursive: true, force: true });
});


test("verify 前有界等待 finally 证据：延迟落盘的 strata-slot.json 会被等待到", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-wait-"));
  const file = path.join(dir, "strata-slot.json");
  // 子进程 300ms 后落盘（verify 主线程用 Atomics.wait 阻塞，同进程 setTimeout 无法执行）。
  spawn(process.execPath, ["-e", `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(file)}, "{}"), 300)`], {
    stdio: "ignore",
  });
  assert.equal(waitForEvidenceFile(dir, "strata-slot.json", 5_000), true);
  fs.rmSync(dir, { recursive: true, force: true });

  const missing = fs.mkdtempSync(path.join(os.tmpdir(), "b71-wait-"));
  assert.equal(waitForEvidenceFile(missing, "strata-slot.json", 600), false);
  fs.rmSync(missing, { recursive: true, force: true });
});
