// B84 A2 + B71 §16.14 confirmation 测试族的唯一 IO fixture owner。
//
// 只服务本族两个真实 IO 消费者：`../authoring_confirmation_evidence_io.test.mjs`
// 与 `../authoring_confirmation_batch_evidence.test.mjs`。纯事实仍留在
// `./authoring_confirmation_scenarios.mjs`；本模块只负责文件/SQLite 构造：
//   - 8 表 DDL 取既有 batch reader 的 `SELECT *` 投影，reader 与 batch 的 seed
//     按各自真实断言区分，但复用同一 `writeDatabase`；连接在 finally 关闭，
//     DELETE journal 封存不产生 -wal/-shm，不 import 被测 reader/verify；
//   - batch 模板把 wire/canon/AX/PNG/合成 app 文件/DB 封进同一只读 payload；
//     当前 case 的绝对 app_path、ready_at 与 heartbeat 在可写副本上装配，
//     staging 绝对路径与 Date.now 不进入规格指纹；
//   - 缺失/污染反例由 case 在正常副本上做最小真实变更，不重建 Schema；
//   - 只读 AX/可见文本按“本 case 明确文件名+固定内容”生成字面规格，不建 DB、
//     不取副本；不同固定输入是不同内容规格，同 run 相同输入由 owner 复用。
// 不把这里的最小查询投影称为生产完整 Schema，也不与 call/R01 族合并。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONFIRMATION_REQUEST } from "../authoring_confirmation_constants.mjs";
import { APP_BUNDLE, NATIVE_DRIVER } from "../scenario_evidence.mjs";
import { irBodyFromWire } from "./authoring_request_ir.mjs";
import {
  USER_TURN,
  canonSnapshot,
  dbFactsFor,
  driverLogFor,
  sentFrame,
  wireFor,
  withoutChildAgentEvents,
} from "./authoring_confirmation_scenarios.mjs";

export const CONFIRMATION_DB_REL = "database/ai_novel_studio_test.sqlite3";
const CONFIRMATION_APP_REL = "B71 Synthetic.app";
export const BATCH_SCREENSHOTS = Object.freeze(["01-source.png", "02-card.png", "03-why.png", "04-restored.png"]);

const RUN_REF = "run-ref-confirmation-batch";
const SLICE_ID = "b71-first-consumer";
const PNG_HEX = "89504e470d0a1a0a";
const READY_AT_PLACEHOLDER = "2026-11-03T10:00:00.000Z";
const SAFE_VISIBLE_COPY = [
  "需要确认",
  "确认对象：第01章正文草稿",
  "确认前不会调用工具",
  "确认后系统会重新检查当前作品状态",
  "待确认正文片段",
].join("\n");
const WAIT_KINDS = ["input", "ack", "turn", "maintenance", "restore", "input", "ack", "turn", "maintenance"];

// 同一真实配置既驱动 PRAGMA 执行，也进入指纹；不维护第二份易漂移的声明字符串。
const JOURNAL_PRAGMAS = Object.freeze({ journal_mode: "DELETE", synchronous: "FULL" });
const JOURNAL_CONFIG = Object.entries(JOURNAL_PRAGMAS)
  .map(([key, value]) => `${key}=${value}`)
  .join("; ");

// 8 表取既有 batch reader（SELECT *）实际消费的列；只读 reader 的列是其子集。
const CONFIRMATION_SCHEMA_SQL = `
  CREATE TABLE author_action_receipts (id TEXT, source_turn_ref TEXT, action_id TEXT, action_type TEXT, idempotency_key TEXT, behavior_ref TEXT, status TEXT, result TEXT, inserted_at TEXT);
  CREATE TABLE agent_runs (id TEXT, profile_ref TEXT, run_mode TEXT, status TEXT, active_behavior_ref TEXT, trigger TEXT, parent_turn_ref TEXT, inserted_at TEXT);
  CREATE TABLE interactions (id TEXT, role TEXT, turn_id TEXT, content TEXT, inserted_at TEXT);
  CREATE TABLE provider_runs (id TEXT, agent_run_id TEXT, purpose TEXT, inserted_at TEXT);
  CREATE TABLE agent_events (id TEXT, run_id TEXT, sequence INTEGER, event_type TEXT, summary TEXT, reason_codes TEXT, refs TEXT, payload TEXT, inserted_at TEXT);
  CREATE TABLE decision_traces (id TEXT, trace_id TEXT, turn_id TEXT, decision_type TEXT, inserted_at TEXT);
  CREATE TABLE mutations (id TEXT, inserted_at TEXT);
  CREATE TABLE memory_items (id TEXT, inserted_at TEXT);
`;

const JSON_COLUMNS = Object.freeze({
  author_action_receipts: ["result"],
  agent_runs: ["trigger"],
  interactions: ["content"],
  agent_events: ["reason_codes", "refs", "payload"],
});

const SEED_TABLES = Object.freeze([
  ["author_action_receipts", "receipts"],
  ["agent_runs", "agent_runs"],
  ["interactions", "interactions"],
  ["provider_runs", "provider_runs"],
  ["agent_events", "agent_events"],
  ["decision_traces", "decision_traces"],
  ["mutations", "mutations"],
  ["memory_items", "memory_items"],
]);

function readSource(rel) {
  return fs.readFileSync(new URL(rel, import.meta.url), "utf8");
}

// 指纹材料显式包含 schema、seed、journal 配置、真实 builder/依赖源码与运行时；
// 直接读当前文件字节，因此未提交变化也进入规格。
function fingerprintMaterial(seed) {
  return {
    schema: CONFIRMATION_SCHEMA_SQL,
    seed: JSON.stringify(seed),
    config: JOURNAL_CONFIG,
    builder_source: readSource(import.meta.url),
    runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
  };
}

function applyJournalPragmas(db) {
  for (const [name, value] of Object.entries(JOURNAL_PRAGMAS)) db.exec(`PRAGMA ${name} = ${value}`);
}

// 只使用真实 reader 查询的列/表，不制造缺列兼容。当前 dbFactsFor 的
// interactions/provider_runs/decision_traces 行没有 id，id 缺省仍有真实消费者；
// inserted_at 缺省同时服务 batch 的 ORDER BY inserted_at,id 与读边界，不删。
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

function writeDatabase(dir, facts) {
  const dbDir = path.join(dir, "database");
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, CONFIRMATION_DB_REL));
  try {
    applyJournalPragmas(db);
    db.exec(CONFIRMATION_SCHEMA_SQL);
    for (const [table, key] of SEED_TABLES) insertRows(db, table, facts[key] ?? []);
  } finally {
    db.close();
  }
}

// 只读 reader 的真实 seed：列/JSON 文本/独立排序与计数各自有当前断言。
// agent_events 的插入顺序与 ORDER BY inserted_at,id 相反，同 inserted_at 靠 id 定序。
function readerSeed() {
  return {
    receipts: [{ id: "r1", inserted_at: "2026-11-03T10:00:00Z", action_id: "a1", result: { turn_id: "turn_dec" } }],
    agent_runs: [{ id: "run-child", inserted_at: "2026-11-03T10:00:01Z", status: "completed" }],
    interactions: [{ id: "i1", inserted_at: "2026-11-03T10:00:02Z", turn_id: "turn_dec", content: { text: "作者原话" } }],
    provider_runs: [{ id: "p1", inserted_at: "2026-11-03T10:00:03Z", agent_run_id: "run-child" }],
    agent_events: [
      { id: "e-b", inserted_at: "2026-11-03T10:00:05Z", run_id: "run-child", event_type: "run_completed" },
      { id: "e-c", inserted_at: "2026-11-03T10:00:04Z", run_id: "run-child", event_type: "tool_started" },
      { id: "e-a", inserted_at: "2026-11-03T10:00:05Z", run_id: "run-child", event_type: "run_started" },
    ],
    decision_traces: [{ id: "d1", inserted_at: "2026-11-03T10:00:06Z", turn_id: "turn_dec" }],
    mutations: [{ id: "m1", inserted_at: "2026-11-03T10:00:07Z" }],
    memory_items: [{ id: "mem1", inserted_at: "2026-11-03T10:00:08Z" }],
  };
}

/** 只读 reader 的 SQLite 模板规格；builder 只在 claim 后同步执行。 */
export function confirmationReaderFixtureSpec() {
  const seed = readerSeed();
  return {
    name: "authoring-confirmation-reader-db",
    inputs: fingerprintMaterial(seed),
    build(staging) {
      writeDatabase(staging, seed);
      return [CONFIRMATION_DB_REL];
    },
  };
}

/** runtime 观察的最小文件模板：真实 app 可执行文件 + 两条 llm-calls 记录。 */
export function confirmationRuntimeFixtureSpec() {
  return {
    name: "authoring-confirmation-runtime",
    files: {
      "AI Novel Studio.app/Contents/MacOS/app": "fixture-executable",
      "llm-calls/2026-11-03.jsonl": `${JSON.stringify({ provider: "slice_verify" })}\n`.repeat(2),
    },
  };
}

/** 当前 case 的 AX/可见文本固定输入：只读扫描，不需要可写副本。 */
export function confirmationAxFixtureSpec(file, content) {
  return {
    name: "authoring-confirmation-ax",
    files: { [file]: content },
  };
}

/** 由本批 ready 的绝对 app_path/真实 executable 派生 runtime 观察输入。 */
export function confirmationRuntimeReady(dir) {
  const appPath = path.join(dir, "AI Novel Studio.app");
  return {
    dir,
    executable: fs.realpathSync(path.join(appPath, "Contents", "MacOS", "app")),
    ready: {
      driver: "external-system-ui",
      run_ref: "run-runtime-fixture",
      bundle_identifier: "com.ai-novel-studio.runtime-fixture",
      app_path: appPath,
      native_executable: "app",
    },
  };
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function jsonlText(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function waitCommands() {
  return WAIT_KINDS.flatMap((kind, index) => [
    { op: "begin", id: `wait-${index}`, kind },
    { op: "finish", id: `wait-${index}`, kind },
  ]);
}

function waitEvents() {
  return WAIT_KINDS.flatMap((kind, index) => [
    { event: "wait_start", kind, at: 1000 + index * 100, id: `wait-${index}` },
    { event: "wait_end", kind, ended_at: 1050 + index * 100, id: `wait-${index}` },
  ]);
}

function transportFrames() {
  const frames = [
    sentFrame("user_message", { text: CONFIRMATION_REQUEST, turn_id: USER_TURN }, READY_AT_PLACEHOLDER),
    ...wireFor("confirm").frames,
  ];
  frames.push({
    at: "2026-11-03T10:00:00.500Z",
    direction: "http",
    method: "GET",
    path: "/api/works/work-1/sessions/resume",
    status: 200,
  });
  return frames;
}

function llmRecord() {
  return {
    provider: "slice_verify",
    request_format: "authoring-request-ir/v1",
    request_body: irBodyFromWire({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "【应用数据 · application_base · 非作者原话】材料" },
        { role: "user", content: CONFIRMATION_REQUEST },
      ],
    }),
  };
}

// 模板只封静态事实：ready 的绝对 app_path/ready_at 与 heartbeat 时刻由 case
// 在副本上装配，避免 staging 路径和 Date.now 成为相同静态资产的规格差异；模板
// 不预置 ready/heartbeat 占位，assemble 在副本上直接写出真实 metadata。
function batchTextFiles() {
  return {
    "native-ui-complete.json": jsonText({
      harness_run_ref: RUN_REF,
      driver: NATIVE_DRIVER,
      app_bundle: APP_BUNDLE,
      scope: SLICE_ID,
      screenshots: BATCH_SCREENSHOTS,
    }),
    "native-driver-commands.jsonl": jsonlText(waitCommands()),
    "wait-events.jsonl": jsonlText(waitEvents()),
    "wait-stats.json": jsonText({ active: null, completed: WAIT_KINDS.length }),
    "app-log/2026-11-03.jsonl": jsonlText([
      { at: READY_AT_PLACEHOLDER, event: "provider_gateway.complete.start", provider: "slice_verify" },
    ]),
    "llm-calls/2026-11-03.jsonl": jsonlText([llmRecord()]),
    "native-transport.jsonl": jsonlText(transportFrames()),
    "native-b71-config.json": jsonText({
      slice_id: SLICE_ID,
      journey: "confirmation",
      provider: "slice_verify",
      target: { work_id: "work-1", work_title: "B71 confirmation", session_id: "session-1" },
      message: CONFIRMATION_REQUEST,
      confirmation: { mode: "confirm" },
    }),
    "b71-start.json": jsonText(canonSnapshot()),
    "b71-final.json": jsonText(canonSnapshot()),
    "native-b71-driver-log.json": jsonText(driverLogFor("confirm")),
    "native-app-cleanup.json": jsonText({
      remaining: [],
      process_observation: { method: "ps", fallback_reason: null, actions: [] },
    }),
    "02-card.text.txt": `${SAFE_VISIBLE_COPY}\n`,
    "03-why.text.txt": `${SAFE_VISIBLE_COPY}\n`,
    "04-restored.text.txt": `${SAFE_VISIBLE_COPY}\n`,
    [`${CONFIRMATION_APP_REL}/Contents/MacOS/app`]: "",
  };
}

function writeFile(root, rel, content) {
  const absolute = path.join(root, rel);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

/** 合成完整批次的静态模板规格；DB 与文本文件由同一 builder 在 claim 后写一次。 */
export function confirmationBatchFixtureSpec() {
  const textFiles = batchTextFiles();
  const binaryFiles = Object.fromEntries(BATCH_SCREENSHOTS.map((name) => [name, PNG_HEX]));
  const seed = dbFactsFor("confirm");
  return {
    name: "authoring-confirmation-batch",
    inputs: {
      ...fingerprintMaterial(seed),
      files: JSON.stringify({ text: textFiles, binary: binaryFiles }),
      scenarios_source: readSource("./authoring_confirmation_scenarios.mjs"),
      request_ir_source: readSource("./authoring_request_ir.mjs"),
      constants_source: readSource("../authoring_confirmation_constants.mjs"),
    },
    build(staging) {
      for (const [rel, content] of Object.entries(textFiles)) writeFile(staging, rel, content);
      for (const [rel, hex] of Object.entries(binaryFiles)) writeFile(staging, rel, Buffer.from(hex, "hex"));
      writeDatabase(staging, seed);
      return [...Object.keys(textFiles), ...Object.keys(binaryFiles), CONFIRMATION_DB_REL];
    },
  };
}

function readJsonl(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
}

function updateJsonFile(dir, name, update) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, jsonText(update(JSON.parse(fs.readFileSync(file, "utf8")))));
}

function dropCopyTables(file, tables) {
  const db = new DatabaseSync(file);
  try {
    for (const table of tables) db.exec(`DROP TABLE ${table}`);
  } finally {
    db.close();
  }
}

// transport 帧反例：只服务既有 userMessage/withoutChildEvents 两个选项。两个选项都
// 未声明时不读写 transport，正例副本保持原字节；次序保持先 userMessage 再 child 事件。
function rewriteTransportFrames(dir, options) {
  if (options.userMessage !== false && options.withoutChildEvents !== true) return;
  let records = readJsonl(path.join(dir, "native-transport.jsonl"));
  if (options.userMessage === false) records = records.filter((record) => record.frame?.[3] !== "user_message");
  if (options.withoutChildEvents === true) records = withoutChildAgentEvents(records);
  fs.writeFileSync(path.join(dir, "native-transport.jsonl"), jsonlText(records));
}

/**
 * 在正常批次副本上做当前 case 的装配与单一缺输入变更。
 *
 * ready.json 的绝对 app_path、ready_at 与 heartbeat 用本副本现算；其余反例只
 * 改动真实消费者会读到的那个文件/表，不重建模板或 Schema。
 */
export function assembleConfirmationBatchCase(dir, options = {}) {
  const readyAt = new Date(Date.now() - 3600_000).toISOString();
  fs.writeFileSync(
    path.join(dir, "native-driver-ready.json"),
    jsonText({
      driver: "external-system-ui",
      browser_driver_started: false,
      run_ref: RUN_REF,
      provider: "slice_verify",
      slice_id: SLICE_ID,
      ready_at: readyAt,
      app_path: path.join(dir, CONFIRMATION_APP_REL),
      bundle_identifier: "com.ai-novel-studio.app",
      native_executable: "app",
    }),
  );
  fs.writeFileSync(path.join(dir, "heartbeat.jsonl"), jsonlText([{ at: readyAt }]));

  if (options.omitLlmCalls === true) fs.rmSync(path.join(dir, "llm-calls"), { recursive: true, force: true });
  if (options.omitStartCheckpoint === true) fs.rmSync(path.join(dir, "b71-start.json"), { force: true });
  if (options.providerStart === false) {
    fs.writeFileSync(
      path.join(dir, "app-log", "2026-11-03.jsonl"),
      jsonlText([{ at: READY_AT_PLACEHOLDER, event: "provider_gateway.complete.finish", provider: "slice_verify" }]),
    );
  }
  if (options.screenshots) {
    updateJsonFile(dir, "native-ui-complete.json", (ui) => ({ ...ui, screenshots: options.screenshots }));
  }
  if (options.journey) {
    updateJsonFile(dir, "native-b71-config.json", (config) => ({ ...config, journey: options.journey }));
  }
  rewriteTransportFrames(dir, options);
  if (options.dropTables?.length) dropCopyTables(path.join(dir, CONFIRMATION_DB_REL), options.dropTables);
}
