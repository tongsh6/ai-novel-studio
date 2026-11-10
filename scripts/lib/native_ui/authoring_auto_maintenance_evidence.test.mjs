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
const OTHER_SESSION = "session-auto-2";
const RUN = "run-auto-1";
const CALL_ID = "call_auto_1";
const EVENT_AT = "2026-11-04T10:00:00.000Z";
const BEFORE_STARTED_AT = "2026-11-04T09:59:20.000Z";
const AFTER_STARTED_AT = "2026-11-04T10:00:00.500Z";
const readyAt = new Date(Date.now() - 3600_000).toISOString();

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
const png = () => Buffer.from("89504e470d0a1a0a", "hex");

// 真实 b81-c5-c6-resume-02 after-maintenance.ax.txt:218 的现行 AX 细条形状。
const MAINTENANCE_STRIP_AX =
  "\t\t0/0/0/0/0/50/3 AXButton, 查看已整理的较早创作过程, enabled=true, focused=false, Actions: AXPress, AXShowMenu, AXScrollToVisible";

// checkpoint canonical 形状（CP3 后）：covers.call_ids 在 blocks 内，不再读取旧字段。
function checkpointMessage({ callIds = [CALL_ID], summary = `已整理的较早记录（覆盖 ${CALL_ID}）` } = {}) {
  return {
    role: "checkpoint",
    provenance: "application",
    blocks: [
      {
        type: "checkpoint",
        summary,
        omissions: ["未闭合交换不折叠"],
        source_refs: ["source-1"],
        versions: {},
        covers: { call_ids: callIds, turn_range: "turn-1" },
      },
    ],
  };
}

function transcriptRecord() {
  return {
    transcript: {
      messages: [
        { role: "application_base", provenance: "application", blocks: [{ type: "text", text: "base" }] },
        { role: "user", provenance: "author", blocks: [{ type: "text", text: "先读一下第01章的正文和章计划。" }] },
        {
          role: "assistant",
          provenance: "assistant",
          blocks: [{ type: "tool_call", call_id: CALL_ID, name: "explore", raw_arguments: "{}" }],
        },
        {
          role: "tool",
          provenance: "tool",
          blocks: [{ type: "observation", call_id: CALL_ID, status: "ok", refs: [] }],
        },
        checkpointMessage(),
      ],
    },
  };
}

// checkpoint 在 native wire 中是 user 消息文本；cover 与 summary 都显式携带 call_id。
function wireCheckpointMessage({ callIds = [CALL_ID], summary = `已整理的较早记录（覆盖 ${CALL_ID}）` } = {}) {
  const covers = JSON.stringify({ call_ids: callIds, turn_range: "turn-1" });
  return {
    role: "user",
    content:
      "【应用数据 · checkpoint · 非作者原话】\n" +
      `【应用数据 · checkpoint · 覆盖 ${covers}】\n` +
      "来源：[]\n版本：{}\n省略：未闭合交换不折叠\n" +
      summary,
  };
}

function afterWireMessages({ replayCall = false, replayResult = false, summary } = {}) {
  const messages = [
    { role: "application_base", content: "base" },
    { role: "user", content: "继续读第03章" },
    wireCheckpointMessage({ summary }),
  ];
  if (replayCall) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [{ id: CALL_ID, type: "function", function: { name: "explore", arguments: "{}" } }],
    });
  }
  if (replayResult) {
    messages.push({
      role: "tool",
      tool_call_id: CALL_ID,
      content: JSON.stringify({ type: "observation", call_id: CALL_ID, status: "ok" }),
    });
  }
  return messages;
}

function providerRunsFor({ afterSession = SESSION } = {}) {
  return [
    {
      id: "prun-before",
      provider_call_ref: "pcall-before",
      provider_id: "strata",
      agent_run_id: RUN,
      session_id: SESSION,
      purpose: "planner",
      started_at: BEFORE_STARTED_AT,
      inserted_at: AFTER_STARTED_AT,
    },
    {
      id: "prun-after",
      provider_call_ref: "pcall-after",
      provider_id: "strata",
      agent_run_id: RUN,
      session_id: afterSession,
      purpose: "planner",
      started_at: AFTER_STARTED_AT,
      inserted_at: AFTER_STARTED_AT,
    },
  ];
}

function providerEventsFor({ afterEmittedAt = AFTER_STARTED_AT } = {}) {
  return [
    { id: "pevt-before", provider_run_id: "prun-before", provider_call_ref: "pcall-before", event_type: "started", emitted_at: BEFORE_STARTED_AT },
    { id: "pevt-after", provider_run_id: "prun-after", provider_call_ref: "pcall-after", event_type: "started", emitted_at: afterEmittedAt },
  ];
}

function dbFactsFor({ afterSession = SESSION, afterEmittedAt = AFTER_STARTED_AT } = {}) {
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
    agent_runs: [{ id: RUN, status: "completed", session_id: SESSION }],
    authoring_session_messages: transcriptRecord().transcript.messages.map((message, index) => ({
      run_id: RUN,
      session_id: SESSION,
      sequence: index + 1,
      run_sequence: index + 1,
      message: JSON.stringify(message),
    })),
    provider_runs: providerRunsFor({ afterSession }),
    provider_events: providerEventsFor({ afterEmittedAt }),
    interactions: [],
    mutations: [],
  };
}

function afterRecord({
  messages = afterWireMessages(),
  sessionId = SESSION,
  providerRunRef = "prun-after",
  providerCallRef = "pcall-after",
  ts = "2026-11-04T10:00:05.000Z",
  inputTokens = 3000,
} = {}) {
  return {
    ts,
    provider: "strata",
    turn_id: "turn-after",
    session_id: sessionId,
    provider_run_ref: providerRunRef,
    provider_call_ref: providerCallRef,
    request: { body: { messages } },
    response: { status: 200, usage: { input_tokens: inputTokens, output_tokens: 40 } },
  };
}

function beforeRecord() {
  return {
    ts: "2026-11-04T09:59:30.000Z",
    provider: "strata",
    turn_id: "turn-before",
    session_id: SESSION,
    provider_run_ref: "prun-before",
    provider_call_ref: "pcall-before",
    request: {
      body: {
        messages: [
          { role: "user", content: "读第01章" },
          { role: "tool", tool_call_id: CALL_ID, content: JSON.stringify({ type: "observation", call_id: CALL_ID, status: "ok" }) },
        ],
      },
    },
    response: { status: 200, usage: { input_tokens: 1200, output_tokens: 50 } },
  };
}

function llmRecords() {
  return [beforeRecord(), afterRecord()];
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
    CREATE TABLE agent_runs (id TEXT, status TEXT, session_id TEXT);
    CREATE TABLE authoring_session_messages (id TEXT, run_id TEXT, session_id TEXT, sequence INTEGER, run_sequence INTEGER, message TEXT, format_version TEXT);
    CREATE TABLE provider_runs (id TEXT, provider_call_ref TEXT, provider_id TEXT, agent_run_id TEXT, session_id TEXT, purpose TEXT, started_at TEXT, inserted_at TEXT);
    CREATE TABLE provider_events (id TEXT, provider_run_id TEXT, provider_call_ref TEXT, event_type TEXT, emitted_at TEXT);
    CREATE TABLE interactions (id TEXT, turn_id TEXT, content TEXT);
    CREATE TABLE mutations (id TEXT);
  `);
  db.prepare("INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)").run("evt-1", RUN, "checkpoint_created", "author", 2, JSON.stringify({ covered_exchanges: 1, scope: "earlier_work_turns", sources: ["资料查阅"] }), EVENT_AT);
  db.prepare("INSERT INTO agent_runs VALUES (?,?,?)").run(RUN, "completed", SESSION);
  transcriptRecord().transcript.messages.forEach((message, index) => {
    db.prepare("INSERT INTO authoring_session_messages VALUES (?,?,?,?,?,?,?)").run(
      `msg-${index + 1}`,
      RUN,
      SESSION,
      index + 1,
      index + 1,
      JSON.stringify(message),
      "authoring-session-message/v1",
    );
  });
  for (const run of providerRunsFor()) {
    db.prepare("INSERT INTO provider_runs VALUES (?,?,?,?,?,?,?,?)").run(
      run.id,
      run.provider_call_ref,
      run.provider_id,
      run.agent_run_id,
      run.session_id,
      run.purpose,
      run.started_at,
      run.inserted_at,
    );
  }
  for (const event of providerEventsFor()) {
    db.prepare("INSERT INTO provider_events (id, provider_run_id, provider_call_ref, event_type, emitted_at) VALUES (?,?,?,?,?)").run(
      event.id,
      event.provider_run_id,
      event.provider_call_ref,
      event.event_type,
      event.emitted_at,
    );
  }
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
    multiTurn: overrides.multiTurn ?? null,
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
  assert(result.checks.C5_next_request_compact.detail.covered_call_ids.includes(CALL_ID));
  assert(result.checks.C5_next_request_compact.detail.checks[0].wire_checkpoint_covers.some((ids) => ids.includes(CALL_ID)));
  assert.equal(result.checks.C6_canonical_complete.ok, true);
  assert(result.checks.C6_canonical_complete.detail.covered_call_ids.includes(CALL_ID));
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

test("C3/C7 正例：现行 AXButton accessible name（enabled=true）识别为可见细条", () => {
  const dir = buildDir();
  fs.writeFileSync(path.join(dir, "after-maintenance.ax.txt"), `${MAINTENANCE_STRIP_AX}\n`);
  fs.writeFileSync(path.join(dir, "after-refresh.ax.txt"), `${MAINTENANCE_STRIP_AX}\n`);
  const result = evaluate({ dir });
  assert.equal(result.checks.C3_strip_visible.ok, true);
  assert.match(String(result.checks.C3_strip_visible.detail.matched ?? ""), /AXButton, 查看已整理的较早创作过程, enabled=true/u);
  assert.equal(result.checks.C7_refresh_idempotent.ok, true);
  assert.equal(result.checks.C7_refresh_idempotent.detail.strip_visible_after_refresh, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("C3/C7 反例：同名非 AXButton / 纯文本 / disabled AXButton 都不算可见细条", () => {
  const cases = [
    ["同文本静态元素", "\t\t0/0/0/0/0/50/3 AXStaticText, 查看已整理的较早创作过程, enabled=true"],
    ["同文本纯可见文本", "查看已整理的较早创作过程"],
    ["同名 disabled AXButton", "\t\t0/0/0/0/0/50/3 AXButton, 查看已整理的较早创作过程, enabled=false, Actions: AXPress"],
  ];
  for (const [name, line] of cases) {
    const dir = buildDir();
    fs.writeFileSync(path.join(dir, "after-maintenance.ax.txt"), `${line}\n`);
    fs.writeFileSync(path.join(dir, "after-refresh.ax.txt"), `${line}\n`);
    const result = evaluate({ dir });
    assert.equal(result.checks.C3_strip_visible.ok, false, name);
    assert.equal(result.checks.C7_refresh_idempotent.ok, false, name);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("A3 反例：精简泄漏/ canonical 缺失/刷新不幂等/失败可见/清理失败 分别 fail", () => {
  const leak = evaluate({
    llmRecords: [beforeRecord(), afterRecord({ messages: afterWireMessages({ replayCall: true, replayResult: true }) })],
  });
  assert.equal(leak.checks.C5_next_request_compact.ok, false);
  assert.equal(leak.checks.C5_next_request_compact.reason, "covered_call_ids_still_in_next_request");
  const canonical = evaluate({
    dbFacts: {
      ...dbFactsFor(),
      authoring_session_messages: [],
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

test("C5 正例：有效 checkpoint 文本显式携带 call_id 不算泄漏，只排除结构化 tool_call/tool_result 重放", () => {
  const messages = afterWireMessages({ summary: `已整理的较早记录（原文含 ${CALL_ID}）` });
  assert(messages.some((message) => typeof message.content === "string" && message.content.includes(CALL_ID)));
  const result = evaluate({ llmRecords: [beforeRecord(), afterRecord({ messages })] });
  const c5 = result.checks.C5_next_request_compact;
  assert.equal(c5.ok, true);
  assert(c5.detail.checks[0].wire_checkpoint_covers.some((ids) => ids.includes(CALL_ID)));
  assert.deepEqual(c5.detail.checks[0].replayed_call_ids, []);
});

test("C5 反例：其他会话 / IR 代替 wire / 首请求缺证时第 2 请求不能补位 → unknown", () => {
  const otherSession = evaluate({
    dbFacts: dbFactsFor({ afterSession: OTHER_SESSION }),
    llmRecords: [beforeRecord(), afterRecord({ sessionId: OTHER_SESSION })],
  });
  assert.equal(otherSession.checks.C5_next_request_compact.ok, null);
  assert.equal(otherSession.checks.C5_next_request_compact.reason, "next_request_evidence_missing");
  assert(otherSession.required.includes("C5_next_request_compact"));
  assert(otherSession.failed.includes("C5_next_request_compact"));

  const irRecord = {
    ...afterRecord(),
    request_format: "authoring-request-ir/v1",
    request_body: {
      ir_version: "authoring-request-ir/v1",
      messages: [
        { role: "application_base", provenance: "application", blocks: [{ type: "text", text: "base" }] },
        { role: "user", provenance: "author", blocks: [{ type: "text", text: "继续读第03章" }] },
        checkpointMessage(),
      ],
      tools: [],
    },
  };
  delete irRecord.request;
  const ir = evaluate({ llmRecords: [beforeRecord(), irRecord] });
  assert.equal(ir.checks.C5_next_request_compact.ok, null);
  assert.equal(ir.checks.C5_next_request_compact.reason, "next_request_evidence_missing");

  const notAfterEvent = evaluate({
    dbFacts: dbFactsFor({ afterEmittedAt: EVENT_AT }),
    llmRecords: [beforeRecord(), afterRecord()],
  });
  assert.equal(notAfterEvent.checks.C5_next_request_compact.ok, null);

  const maskedFacts = dbFactsFor();
  maskedFacts.provider_runs = [
    ...maskedFacts.provider_runs,
    { id: "prun-first", provider_call_ref: "pcall-first", provider_id: "strata", agent_run_id: RUN, session_id: SESSION, purpose: "planner", started_at: null, inserted_at: null },
  ];
  maskedFacts.provider_events = [
    ...maskedFacts.provider_events,
    { id: "pevt-first", provider_run_id: "prun-first", provider_call_ref: "pcall-first", event_type: "started", emitted_at: "2026-11-04T10:00:00.100Z" },
  ];
  const masked = evaluate({ dbFacts: maskedFacts, llmRecords: [beforeRecord(), afterRecord()] });
  assert.equal(masked.checks.C5_next_request_compact.ok, null);
  assert.equal(masked.checks.C5_next_request_compact.reason, "next_request_evidence_missing");
});

test("C6 反例：covers 保留但真实 tool 结果被移除 / 顺序错误 / 旧 checkpoint 形状 → fail", () => {
  const missingResultFacts = dbFactsFor();
  missingResultFacts.authoring_session_messages = missingResultFacts.authoring_session_messages.filter(
    (row) => JSON.parse(row.message).role !== "tool",
  );
  const missingResult = evaluate({ dbFacts: missingResultFacts });
  assert.equal(missingResult.checks.C6_canonical_complete.ok, false);
  assert(
    missingResult.checks.C6_canonical_complete.detail.failures.some(
      (failure) => failure.call_id === CALL_ID && failure.result_count === 0,
    ),
  );

  const swappedRows = dbFactsFor().authoring_session_messages.map((row) => ({ ...row }));
  const callIndex = swappedRows.findIndex((row) => JSON.parse(row.message).role === "assistant");
  const resultIndex = swappedRows.findIndex((row) => JSON.parse(row.message).role === "tool");
  [swappedRows[callIndex].sequence, swappedRows[resultIndex].sequence] = [
    swappedRows[resultIndex].sequence,
    swappedRows[callIndex].sequence,
  ];
  const outOfOrder = evaluate({ dbFacts: { ...dbFactsFor(), authoring_session_messages: swappedRows } });
  assert.equal(outOfOrder.checks.C6_canonical_complete.ok, false);
  assert.equal(outOfOrder.checks.C6_canonical_complete.detail.failures[0].call_count, 1);
  assert.equal(outOfOrder.checks.C6_canonical_complete.detail.failures[0].result_count, 1);

  const legacyFacts = dbFactsFor();
  legacyFacts.authoring_session_messages = legacyFacts.authoring_session_messages.map((row) => {
    const message = JSON.parse(row.message);
    return message.role === "checkpoint"
      ? { ...row, message: JSON.stringify({ role: "checkpoint", call_ids: [CALL_ID] }) }
      : row;
  });
  const legacy = evaluate({ dbFacts: legacyFacts });
  assert.equal(legacy.checks.C6_canonical_complete.ok, false);
  assert.equal(legacy.checks.C6_canonical_complete.reason, "checkpoint_call_ids_missing");
});

test("C6：多条 canonical checkpoint 每条都必须有 covers，任一无 covers 不因另一条合法而假通过", () => {
  const rows = dbFactsFor().authoring_session_messages;
  const appendCheckpoint = (message) => ({
    run_id: RUN,
    session_id: SESSION,
    sequence: rows.length + 1,
    run_sequence: rows.length + 1,
    message: JSON.stringify(message),
  });
  const allCovered = evaluate({
    dbFacts: { ...dbFactsFor(), authoring_session_messages: [...rows, appendCheckpoint(checkpointMessage())] },
  });
  assert.equal(allCovered.checks.C6_canonical_complete.ok, true);

  const oneUncovered = evaluate({
    dbFacts: {
      ...dbFactsFor(),
      authoring_session_messages: [...rows, appendCheckpoint(checkpointMessage({ callIds: [] }))],
    },
  });
  assert.equal(oneUncovered.checks.C6_canonical_complete.ok, false);
  assert.equal(oneUncovered.checks.C6_canonical_complete.reason, "checkpoint_call_ids_missing");
  assert.deepEqual(oneUncovered.checks.C6_canonical_complete.detail.checkpoints_without_covers, [rows.length + 1]);
});

test("C5 反例：wire 存在 malformed call/tool message 时不得通过（缺证语义只留给真缺失）", () => {
  const malformedCallMessages = afterWireMessages();
  malformedCallMessages.push({ role: "assistant", content: "", tool_calls: "not-an-array" });
  const malformedCall = evaluate({ llmRecords: [beforeRecord(), afterRecord({ messages: malformedCallMessages })] });
  assert.equal(malformedCall.checks.C5_next_request_compact.ok, false);
  assert.equal(malformedCall.checks.C5_next_request_compact.reason, "next_request_wire_malformed");
  assert.equal(malformedCall.checks.C5_next_request_compact.detail.checks[0].malformed_calls, 1);
  assert(malformedCall.failed.includes("C5_next_request_compact"));

  const malformedResultMessages = afterWireMessages();
  malformedResultMessages.push({ role: "tool", content: JSON.stringify({ type: "observation", status: "ok" }) });
  const malformedResult = evaluate({ llmRecords: [beforeRecord(), afterRecord({ messages: malformedResultMessages })] });
  assert.equal(malformedResult.checks.C5_next_request_compact.ok, false);
  assert.equal(malformedResult.checks.C5_next_request_compact.reason, "next_request_wire_malformed");
  assert.equal(malformedResult.checks.C5_next_request_compact.detail.checks[0].malformed_tool_messages, 1);
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

test("G6 multi-turn 正例：同 run pause/steer/resume 成立 → C11 pass，C7/C8 不判", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          kind: "composer_free_text",
          observation: {
            question_text: "请确认要看哪一章的正文与章计划？",
            answer_source: "extracted_text",
            answer_text: "继续核对正文与章计划的一致性：先给出依据再继续；不要提前结束。",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "running" }],
      rounds: [{ index: 1, pause_kind: "paused", exchange_facts: { complete_exchanges: 0 } }],
      stop_reason: "triggered",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, true);
  assert.equal(result.checks.C7_refresh_idempotent.ok, null);
  assert.equal(result.checks.C8_failure_silent.ok, null);
  assert(!result.required.includes("C7_refresh_idempotent"));
  assert(!result.required.includes("C8_failure_silent"));
  assert(result.required.includes("C11_multi_turn_same_run"));
  assert(!result.failed.includes("C11_multi_turn_same_run"));
  assert.deepEqual(result.failed, []);
  assert(result.not_signed.includes("C7_refresh_not_in_scope_multi_turn"));
  assert(result.not_signed.includes("C8_failure_injection_not_in_scope_multi_turn"));
});

test("G6 multi-turn 反例：缺 steer 或未 resume → C11 fail（不放宽）", () => {
  const noSteer = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [],
      resumes: [],
      rounds: [],
      stop_reason: "steer_budget_exhausted",
      max_steers: 6,
      checkpoint_events: 0,
    },
  });
  assert.equal(noSteer.checks.C11_multi_turn_same_run.ok, false);
  assert(noSteer.failed.includes("C11_multi_turn_same_run"));

  const noResume = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: {
            question_text: "请确认要看哪一章的正文与章计划？",
            answer_source: "option",
            answer_text: "选项A",
          },
        },
      ],
      resumes: [{ index: 1, resumed: false, status: "awaiting_author" }],
      rounds: [],
      stop_reason: "resume_failed",
      max_steers: 6,
      checkpoint_events: 0,
    },
  });
  assert.equal(noResume.checks.C11_multi_turn_same_run.ok, false);
  assert(noResume.failed.includes("C11_multi_turn_same_run"));
});

test("G6 跨 turn 正例：首 run 结束后补发 turn 推进 + 选项观察 → C11 pass（cross_turn）", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          kind: "choice",
          label: "保留悬念",
          observation: {
            question_text: "",
            option_titles: ["保留悬念", "当章收束"],
            answer_source: "option",
            answer_text: "保留悬念",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "completed" }],
      rounds: [{ index: 1, pause_kind: "terminal", exchange_facts: { complete_exchanges: 3 } }],
      extra_rounds: [
        { round: 1, index: 2, run_status: "completed", checkpoint_events_after: 0 },
        { round: 2, index: 3, run_status: "failed", checkpoint_events_after: 1 },
      ],
      stop_reason: "run_terminal",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, true);
  assert.equal(result.checks.C11_multi_turn_same_run.detail.scenario, "cross_turn");
  assert(!result.failed.includes("C11_multi_turn_same_run"));
});

test("G6 跨 turn 反例：无推进 turn 或回答未观察 → C11 fail（不放宽）", () => {
  const noAdvanced = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: {
            question_text: "",
            option_titles: ["保留悬念", "当章收束"],
            answer_source: "option",
            answer_text: "保留悬念",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "completed" }],
      extra_rounds: [{ round: 1, index: 2, run_status: "running" }],
      stop_reason: "run_terminal",
      checkpoint_events: 0,
    },
  });
  assert.equal(noAdvanced.checks.C11_multi_turn_same_run.ok, false);
  assert(noAdvanced.failed.includes("C11_multi_turn_same_run"));

  const noObservation = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: { question_text: "", option_titles: [], answer_source: "fallback", answer_text: "按你的判断继续。" },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "completed" }],
      extra_rounds: [{ round: 1, index: 2, run_status: "completed" }],
      stop_reason: "run_terminal",
      checkpoint_events: 1,
    },
  });
  assert.equal(noObservation.checks.C11_multi_turn_same_run.ok, false);
  assert(noObservation.failed.includes("C11_multi_turn_same_run"));
});

test("跨 run A3 场景：C11 不判（ok=null，不进 required），C7/C8 仍判", () => {
  const result = evaluate();
  assert.equal(result.checks.C11_multi_turn_same_run.ok, null);
  assert(!result.required.includes("C11_multi_turn_same_run"));
  assert.equal(result.checks.C7_refresh_idempotent.ok, true);
  assert.equal(result.checks.C8_failure_silent.ok, true);
});

test("G6 multi-turn 反例：回答全为 fallback（未基于真实问题观察）→ C11 fail", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: {
            question_text: "请确认要看哪一章的正文与章计划？",
            answer_source: "fallback",
            answer_text: "按你的判断继续。",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "running" }],
      rounds: [],
      stop_reason: "triggered",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, false);
  assert.equal(result.checks.C11_multi_turn_same_run.reason, "multi_turn_not_observation_driven");
  assert(result.failed.includes("C11_multi_turn_same_run"));
});

test("G6 multi-turn 反例：缺少问题文本绑定 → C11 fail", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [{ index: 1, ok: true, observation: { question_text: "", answer_source: "extracted_text" } }],
      resumes: [{ index: 1, resumed: true, status: "running" }],
      rounds: [],
      stop_reason: "triggered",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, false);
  assert.equal(result.checks.C11_multi_turn_same_run.reason, "multi_turn_not_observation_driven");
});
