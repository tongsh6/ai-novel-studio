// B71 §16.14 确认批次 I/O/报告编排测试（合成完整批次，不启动真实 App）。
//
// 入口是生产公开的 verifyConfirmationBatch；测试在临时目录写真实文件与临时 SQLite，
// 复用 fixtures 的真实 wire/DB/canon 形状。OS 观察只 mock child_process.execFileSync
// 的 ps/lsof 边界（明确模拟无目标进程/无监听），其它命令仍交回真实 exec。
// 不访问 UserNotificationCenter/SystemNotificationCenter，也不依赖用户当前进程/端口。
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { mock } from "node:test";
import { verifyConfirmationBatch } from "./authoring_confirmation_evidence.mjs";
import { CONFIRMATION_REQUEST } from "./authoring_confirmation_constants.mjs";
import { APP_BUNDLE, NATIVE_DRIVER } from "./scenario_evidence.mjs";
import {
  CHILD_RUN,
  CLICK_AT,
  SOURCE_RUN,
  SOURCE_TURN,
  USER_TURN,
  canonSnapshot,
  dbFactsFor,
  driverLogFor,
  sentFrame,
  wireFor,
  withoutChildAgentEvents,
} from "./fixtures/authoring_confirmation_scenarios.mjs";

const realExecFileSync = childProcess.execFileSync;

// 只替换 ps/lsof（以及 ps 失败后才会用到的 pgrep）边界：明确声明无目标进程、无监听。
// git 等其它只读调用原样交回真实 exec；生产实现没有 test 注入开关。
test.before(() => {
  mock.method(childProcess, "execFileSync", (command, args, options) => {
    if (command === "ps") return "";
    if (command === "lsof" || command === "pgrep") {
      const error = new Error(`${command}: no matching entries`);
      error.status = 1;
      throw error;
    }
    return realExecFileSync(command, args, options);
  });
  syncBuiltinESMExports();
});

test.after(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
});

const readyAt = new Date(Date.now() - 3600_000).toISOString();
const runRef = "run-ref-confirmation-batch";
const png = () => Buffer.from("89504e470d0a1a0a", "hex");
const shotNames = ["01-source.png", "02-card.png", "03-why.png", "04-restored.png"];
const SAFE_VISIBLE_COPY = [
  "需要确认",
  "确认对象：第01章正文草稿",
  "确认前不会调用工具",
  "确认后系统会重新检查当前作品状态",
  "待确认正文片段",
].join("\n");

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

// 真实等待账形状：begin/finish 平衡 + 分型 wait-events；confirmation 必须有 restore。
function waitLedger(dir) {
  const kinds = ["input", "ack", "turn", "maintenance", "restore", "input", "ack", "turn", "maintenance"];
  const commands = kinds.flatMap((kind, index) => [
    { op: "begin", id: `wait-${index}`, kind },
    { op: "finish", id: `wait-${index}`, kind },
  ]);
  writeJsonl(path.join(dir, "native-driver-commands.jsonl"), commands);
  writeJsonl(
    path.join(dir, "wait-events.jsonl"),
    kinds.flatMap((kind, index) => [
      { event: "wait_start", kind, at: 1000 + index * 100, id: `wait-${index}` },
      { event: "wait_end", kind, ended_at: 1050 + index * 100, id: `wait-${index}` },
    ]),
  );
  writeJson(path.join(dir, "wait-stats.json"), { active: null, completed: kinds.length });
  writeJsonl(path.join(dir, "heartbeat.jsonl"), [{ at: readyAt }]);
}

function schemaSql() {
  return `
    CREATE TABLE author_action_receipts (id TEXT, source_turn_ref TEXT, action_id TEXT, action_type TEXT, idempotency_key TEXT, behavior_ref TEXT, status TEXT, result TEXT, inserted_at TEXT);
    CREATE TABLE agent_runs (id TEXT, profile_ref TEXT, run_mode TEXT, status TEXT, active_behavior_ref TEXT, trigger TEXT, parent_turn_ref TEXT, inserted_at TEXT);
    CREATE TABLE interactions (id TEXT, role TEXT, turn_id TEXT, content TEXT, inserted_at TEXT);
    CREATE TABLE provider_runs (id TEXT, agent_run_id TEXT, purpose TEXT, inserted_at TEXT);
    CREATE TABLE agent_events (id TEXT, run_id TEXT, sequence INTEGER, event_type TEXT, summary TEXT, reason_codes TEXT, refs TEXT, payload TEXT, inserted_at TEXT);
    CREATE TABLE decision_traces (id TEXT, trace_id TEXT, turn_id TEXT, decision_type TEXT, inserted_at TEXT);
    CREATE TABLE mutations (id TEXT, inserted_at TEXT);
    CREATE TABLE memory_items (id TEXT, inserted_at TEXT);
  `;
}

const JSON_COLUMNS = Object.freeze({
  author_action_receipts: ["result"],
  agent_runs: ["trigger"],
  interactions: ["content"],
  agent_events: ["reason_codes", "refs", "payload"],
});

function insertRows(db, table, rows) {
  rows.forEach((row, index) => {
    const record = {
      ...row,
      id: row.id ?? `${table}-${index + 1}`,
      inserted_at: row.inserted_at ?? `2026-11-03T10:00:${String(index).padStart(2, "0")}.000Z`,
    };
    const columns = Object.keys(record);
    const values = columns.map((column) =>
      JSON_COLUMNS[table]?.includes(column) && typeof record[column] !== "string"
        ? JSON.stringify(record[column])
        : record[column],
    );
    db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(
      ...values,
    );
  });
}

// 临时 SQLite 只使用当前 confirmation reader 实际查询的列/表，不制造缺列兼容。
function writeDatabase(dir, facts, { dropTables = [] } = {}) {
  const dbDir = path.join(dir, "database");
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, "ai_novel_studio_test.sqlite3"));
  try {
    db.exec(schemaSql());
    insertRows(db, "author_action_receipts", facts.receipts);
    insertRows(db, "agent_runs", facts.agent_runs);
    insertRows(db, "interactions", facts.interactions);
    insertRows(db, "provider_runs", facts.provider_runs);
    insertRows(db, "agent_events", facts.agent_events);
    insertRows(db, "decision_traces", facts.decision_traces);
    for (const table of dropTables) db.exec(`DROP TABLE ${table}`);
  } finally {
    db.close();
  }
}

function writeAxCaptures(dir) {
  for (const name of ["02-card", "03-why", "04-restored"]) {
    fs.writeFileSync(path.join(dir, `${name}.text.txt`), `${SAFE_VISIBLE_COPY}\n`);
  }
}

function makeAppBundle(dir) {
  const appPath = path.join(dir, "B71 Synthetic.app");
  fs.mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(appPath, "Contents", "MacOS", "app"), "");
  return appPath;
}

// 完整批次：ready/uiComplete/分型等待账/真实 wire/DB/源与 child/receipt/events/
// llm 记录/canon 快照/AX 可见 copy。options 只做单一真实缺输入，不改变正例形状。
function writeBatch(dir, options = {}) {
  const mode = options.mode ?? "confirm";
  const appPath = makeAppBundle(dir);
  fs.mkdirSync(path.join(dir, "app-log"), { recursive: true });
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });

  writeJson(path.join(dir, "native-driver-ready.json"), {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: runRef,
    provider: "slice_verify",
    slice_id: "b71-first-consumer",
    ready_at: readyAt,
    app_path: appPath,
    bundle_identifier: "com.ai-novel-studio.app",
    native_executable: "app",
  });

  for (const name of shotNames) fs.writeFileSync(path.join(dir, name), png());
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: runRef,
    driver: NATIVE_DRIVER,
    app_bundle: APP_BUNDLE,
    scope: "b71-first-consumer",
    screenshots: options.screenshots ?? shotNames,
  });

  waitLedger(dir);

  if (options.providerStart === false) {
    writeJsonl(path.join(dir, "app-log", "2026-11-03.jsonl"), [
      { at: "2026-11-03T10:00:00.000Z", event: "provider_gateway.complete.finish", provider: "slice_verify" },
    ]);
  } else {
    writeJsonl(path.join(dir, "app-log", "2026-11-03.jsonl"), [
      { at: "2026-11-03T10:00:00.000Z", event: "provider_gateway.complete.start", provider: "slice_verify" },
    ]);
  }

  if (options.omitLlmCalls !== true) {
    writeJsonl(path.join(dir, "llm-calls", "2026-11-03.jsonl"), [
      {
        provider: "slice_verify",
        request_body: {
          messages: [
            { role: "system", content: "system" },
            { role: "user", content: "【应用数据 · application_base · 非作者原话】材料" },
            { role: "user", content: CONFIRMATION_REQUEST },
          ],
        },
      },
    ]);
  }

  const wire = [...wireFor(mode).frames];
  if (options.userMessage !== false) {
    wire.unshift(sentFrame("user_message", { text: CONFIRMATION_REQUEST, turn_id: USER_TURN }, "2026-11-03T10:00:00.000Z"));
  }
  const batchWire = options.withoutChildEvents ? withoutChildAgentEvents(wire) : wire;
  writeJsonl(path.join(dir, "native-transport.jsonl"), [
    ...batchWire,
    {
      at: "2026-11-03T10:00:00.500Z",
      direction: "http",
      method: "GET",
      path: "/api/works/work-1/sessions/resume",
      status: 200,
    },
  ]);

  writeJson(path.join(dir, "native-b71-config.json"), {
    slice_id: "b71-first-consumer",
    journey: options.journey ?? "confirmation",
    provider: "slice_verify",
    target: { work_id: "work-1", work_title: "B71 confirmation", session_id: "session-1" },
    message: CONFIRMATION_REQUEST,
    confirmation: { mode },
  });

  if (options.omitStartCheckpoint !== true) {
    writeJson(path.join(dir, "b71-start.json"), canonSnapshot());
  }
  writeJson(path.join(dir, "b71-final.json"), canonSnapshot());

  writeJson(path.join(dir, "native-b71-driver-log.json"), driverLogFor(mode));
  writeJson(path.join(dir, "native-app-cleanup.json"), {
    remaining: [],
    process_observation: { method: "ps", fallback_reason: null, actions: [] },
  });
  writeDatabase(dir, dbFactsFor(mode), { dropTables: options.dropTables ?? [] });
  writeAxCaptures(dir);
  return { dir, wire: batchWire };
}

function withBatch(options, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-confirmation-batch-"));
  try {
    const batch = writeBatch(dir, options);
    return fn(batch);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const confirmationChecks = [
  "C1_source_persisted",
  "C2_confirmation_accepted",
  "C3_author_action_run_bound",
  "C4_behavior_uniquely_consumed",
  "C5_duplicate_idempotent",
  "C6_reject_zero_side_effect",
  "C7_confirmed_child_execution",
  "C8_author_bytes",
  "C9_why_replay_zero_provider",
  "C10_restore_not_actionable",
  "C11_cleanup",
  "C12_child_live_startup_events",
];
const expectedChecks = [...confirmationChecks, "author_visible_no_internal_tokens"];

test("完整确认批次：verifyConfirmationBatch 生成 summary/checks/ws frames 并通过 C1–C12", () => {
  withBatch({}, ({ dir }) => {
    const { result, summary } = verifyConfirmationBatch(dir);

    assert.equal(result.schema, "b71-confirmation-checks/v1");
    assert.deepEqual(result.failed, []);
    assert.deepEqual(Object.keys(result.checks), expectedChecks);
    for (const key of expectedChecks) {
      assert.equal(
        result.checks[key].ok,
        key === "C6_reject_zero_side_effect" ? null : true,
        `${key} 结果不符`,
      );
    }
    assert.equal(result.checks.C6_reject_zero_side_effect.reason, "confirm_mode");
    assert.deepEqual(result.required, expectedChecks.filter((key) => key !== "C6_reject_zero_side_effect"));

    // 关键同源 id：wire 选中的 source turn / child run / 点击时刻必须与 fixture 一致。
    assert.equal(result.source_turn_id, SOURCE_TURN);
    assert.equal(result.source_run_id, SOURCE_RUN);
    assert.equal(result.child_run_id, CHILD_RUN);
    assert.equal(result.click_at, CLICK_AT);
    assert.equal(result.action.action_id, "act_confirm_decision_1");
    assert.equal(result.measured.receipts, 1);
    assert.equal(result.measured.executed_tool, "prose_writing");
    assert.equal(result.measured.pending_artifact_type, "prose_fragment");
    assert.equal(result.measured.runtime_after_batch.app_processes, 0);
    assert.deepEqual(result.measured.runtime_after_batch.ports, {
      backend_4657: false,
      transport_4661: false,
    });
    assert.equal(result.measured.runtime_after_batch.llm_calls, 1);

    assert.equal(summary.schema, "b71-confirmation-summary/v1");
    assert.equal(summary.mode, "confirm");
    assert.equal(summary.surface, "tauri-native");
    assert.equal(summary.driver, "ax-native-system-ui");
    assert.equal(summary.request, CONFIRMATION_REQUEST);
    assert.deepEqual(summary.required, result.required);
    assert.deepEqual(summary.failed, []);
    assert.equal(summary.verdict.mechanism, "pass");
    assert.equal(summary.verdict.model_behavior.executed.branch, "executed");
    assert.equal(summary.verdict.full_g1_g6_signed, false);
    assert.equal(summary.verdict.i10_signed, false);
    assert.deepEqual(summary.checks, Object.fromEntries(expectedChecks.map((key) => [key, result.checks[key].ok])));
    assert.equal(summary.author_visible.ok, true);
    assert.deepEqual(summary.author_visible.hits, []);
    assert(summary.author_visible.scanned_files.includes("02-card.text.txt"));
    assert.equal(summary.wait_ledger.waits, 9);
    assert(summary.wait_ledger.kinds.includes("restore"));

    // 三个报告/帧产物必须是本次真实写出，不是手填输入。
    for (const name of ["summary.json", "native-b71-checks.json", "native-ws-frames.json"]) {
      assert(fs.existsSync(path.join(dir, name)), `${name} 未生成`);
    }
    const savedChecks = JSON.parse(fs.readFileSync(path.join(dir, "native-b71-checks.json"), "utf8"));
    assert.deepEqual(savedChecks, result);
    const savedSummary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    assert.equal(savedSummary.verdict.mechanism, "pass");
    const frames = JSON.parse(fs.readFileSync(path.join(dir, "native-ws-frames.json"), "utf8"));
    assert(frames.length > 0);
    assert(frames.every((frame) => frame.direction !== "http"));
    assert(frames.some((frame) => frame.event === "agent_event" && frame.body.run_id === CHILD_RUN));
  });
});

test("缺 child 实时启动 WS（DB 完整）：判据失败且报告只写 fail 结论", () => {
  withBatch({ withoutChildEvents: true }, ({ dir }) => {
    assert.throws(
      () => verifyConfirmationBatch(dir),
      /B71 confirmation 判据失败: C12_child_live_startup_events/,
    );

    // verify 在断言前落盘报告；失败批次必须留下可核验的 fail，而不是 pass。
    const savedChecks = JSON.parse(fs.readFileSync(path.join(dir, "native-b71-checks.json"), "utf8"));
    assert.deepEqual(savedChecks.failed, ["C12_child_live_startup_events"]);
    assert.equal(savedChecks.checks.C12_child_live_startup_events.ok, false);
    assert.equal(savedChecks.checks.C12_child_live_startup_events.detail.db_has_tool_started, true);
    const savedSummary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    assert.equal(savedSummary.verdict.mechanism, "fail");
    assert.deepEqual(savedSummary.failed, ["C12_child_live_startup_events"]);
    assert.equal(savedSummary.checks.C12_child_live_startup_events, false);
    assert.notEqual(savedSummary.verdict.mechanism, "pass");
  });
});

test("缺 llm-calls 目录：批次读取失败关闭，不生成报告", () => {
  withBatch({ omitLlmCalls: true }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /缺少 llm-calls 调用记录/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
    assert.equal(fs.existsSync(path.join(dir, "native-b71-checks.json")), false);
  });
});

test("缺真实 user_message 帧：输入证据不足时失败关闭", () => {
  withBatch({ userMessage: false }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /真实工作台输入帧不足: 0/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("缺 provider_gateway.complete.start：provider 来源证据不足时失败关闭", () => {
  withBatch({ providerStart: false }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /批次 provider 必须是 slice_verify，实测: /);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("缺 canon start checkpoint：批次读取失败关闭", () => {
  withBatch({ omitStartCheckpoint: true }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /缺少 checkpoint b71-start\.json/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("DB 缺 mutations 表：只读计数失败关闭，不伪造 0", () => {
  withBatch({ dropTables: ["mutations"] }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /no such table: mutations/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("截图不足：原生证据门槛失败关闭", () => {
  withBatch({ screenshots: shotNames.slice(0, 3) }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /原生截图不足: 3 < 4/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("非 confirmation journey：批次入口拒绝", () => {
  withBatch({ journey: "live" }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /只接受 journey=confirmation/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

// 保留一个不依赖 mock 的正例对照：runtime 的 ps/lsof 边界只在上面被替换，
// 这里用显式 exec 证明 observeConfirmationRuntime 的无进程/无监听事实来自 mock 注入，
// 而 git 等其它命令仍可按真实 exec 执行（读只读 HEAD）。
test("mock 只拦截 ps/lsof：其它只读命令仍走真实 exec", () => {
  const head = childProcess.execFileSync("git", ["-C", process.cwd(), "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
  assert.match(head, /^[0-9a-f]{7,}$/);
});
