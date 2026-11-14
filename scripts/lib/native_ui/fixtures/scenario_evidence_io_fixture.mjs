// B61/B71 scenario 证据族唯一的真实文件/SQLite fixture owner。
//
// 只服务 `../scenario_evidence_io.test.mjs`：native 批次通用证据（ready/ui-complete/
// 截图/等待账/心跳）、单条 capture 记录、provider/transport 批次与 10 张生产表的
// 只读计数投影。10 表是 `productionTableCounts` 实际查询的当前投影，不声称可启动
// 完整生产应用；表清单独立声明，不 import 被测 SUT，SUT 表集合漂移会在真实查询处失败。
//
// 全部规格经 `{name, inputs, build}` 由 `materializeFixture` 在 run 内唯一构建，模板
// 以 DELETE journal 封存、连接 finally 关闭；正常只读共享，需要改文件的反例经
// `withWorkingCopy` 取隔离副本。不同证据批次保持不同规格，不合并成共享模板。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const PRODUCTION_DB_REL = "database/ai_novel_studio_test.sqlite3";
const PRODUCTION_TABLE_NAMES = Object.freeze([
  "works",
  "workspaces",
  "work_sessions",
  "chapters",
  "volumes",
  "scenes",
  "characters",
  "memory_items",
  "ledger_entries",
  "author_action_receipts",
]);

const READY_AT = "2026-11-02T02:00:00.000Z";
const SCOPE = "slice-x";
const TOPIC = "workspace:scope";
const T0 = "2026-11-02T02:00:00.000Z";
const T1 = "2026-11-02T02:00:00.100Z";
const JPEG_HEX = "ffd8ffe000000000";

const WAIT_COMMANDS = Object.freeze([
  { op: "begin", id: "wait-1" },
  { op: "finish", id: "wait-1" },
]);
const WAIT_EVENTS = Object.freeze([
  { event: "wait_start", at: 1000, kind: "input" },
  { event: "wait_end", at: 1000, ended_at: 2000, kind: "input" },
]);
const WAIT_STATS = Object.freeze({ active: null, completed: 1 });

const PRODUCTION_SCHEMA_SQL = PRODUCTION_TABLE_NAMES.map(
  (table) => `CREATE TABLE ${table} (id TEXT PRIMARY KEY);`,
).join("\n");
const PRODUCTION_SEED = Object.freeze({ works: ["work-1"] });

const JOURNAL_PRAGMAS = Object.freeze({ journal_mode: "DELETE", synchronous: "FULL" });
const JOURNAL_CONFIG = Object.entries(JOURNAL_PRAGMAS)
  .map(([key, value]) => `${key}=${value}`)
  .join("; ");

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function ledgerFiles(overrides = {}) {
  const ledger = {
    commands: WAIT_COMMANDS,
    events: WAIT_EVENTS,
    stats: WAIT_STATS,
    heartbeat: true,
    ...overrides,
  };
  const files = {
    "native-driver-commands.jsonl": ledger.commands.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "wait-events.jsonl": ledger.events.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "wait-stats.json": JSON.stringify(ledger.stats),
  };
  if (ledger.heartbeat) files["heartbeat.jsonl"] = "{}\n";
  return files;
}

// 可写副本上的等待账最小变更：默认值与模板同源，heartbeat=false 时删除文件。
export function writeWaitLedger(dir, overrides = {}) {
  const files = ledgerFiles(overrides);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  if (!Object.hasOwn(files, "heartbeat.jsonl")) {
    fs.rmSync(path.join(dir, "heartbeat.jsonl"), { force: true });
  }
}

function frame(joinRef, requestRef, topic, event, body, direction, at) {
  return { direction, at, frame: [joinRef, requestRef, topic, event, body] };
}

function providerBatchFiles(provider) {
  return {
    "app-log/a.jsonl": [{ event: "provider_gateway.complete.start", provider }],
    "llm-calls/a.jsonl": [{ provider, request_format: "provider_prompt/v1" }],
    "native-transport.jsonl": [
      frame("join-1", "request-1", TOPIC, "user_message", { turn_id: "t1", text: "hi" }, "sent", T0),
      frame(null, null, TOPIC, "turn_result", { turn_id: "t1" }, "received", T1),
      { direction: "http", at: T1, path: "/api/x", status: 200 },
    ],
  };
}

// 可写副本上的 provider 批次最小变更：同一 transport，只替换 provider 来源。
export function writeProviderBatch(dir, provider = "slice_verify") {
  for (const [rel, rows] of Object.entries(providerBatchFiles(provider))) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJsonl(file, rows);
  }
}

function builderInputs(extra) {
  return {
    ...extra,
    builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
    runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
  };
}

export function waitLedgerFixtureSpec() {
  const files = ledgerFiles();
  return {
    name: "b61-wait-ledger",
    inputs: builderInputs({ ledgers: JSON.stringify(files) }),
    build(staging) {
      writeWaitLedger(staging);
      return Object.keys(files);
    },
  };
}

export function recordFixtureSpec() {
  const files = {
    "cap.ax.txt": "ax",
    "cap.text.txt": "text",
    "cap.jpg": JPEG_HEX,
  };
  return {
    name: "b61-capture-record",
    inputs: builderInputs({ capture_files: JSON.stringify(files) }),
    build(staging) {
      fs.writeFileSync(path.join(staging, "cap.ax.txt"), files["cap.ax.txt"]);
      fs.writeFileSync(path.join(staging, "cap.text.txt"), files["cap.text.txt"]);
      fs.writeFileSync(path.join(staging, "cap.jpg"), Buffer.from(JPEG_HEX, "hex"));
      return ["cap.ax.txt", "cap.text.txt", "cap.jpg"];
    },
  };
}

export function providerBatchFixtureSpec() {
  return {
    name: "b61-provider-batch",
    inputs: builderInputs({ provider: "slice_verify" }),
    build(staging) {
      writeProviderBatch(staging, "slice_verify");
      return ["app-log/a.jsonl", "llm-calls/a.jsonl", "native-transport.jsonl"];
    },
  };
}

export function commonBatchFixtureSpec() {
  const ledger = ledgerFiles();
  const ready = {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-x",
    ready_at: READY_AT,
  };
  const ui = {
    harness_run_ref: "run-x",
    driver: "ax-native-system-ui",
    app_bundle: "com.ai-novel-studio.app",
    scope: SCOPE,
    screenshots: ["shot.jpg"],
  };
  return {
    name: "b61-common-batch",
    inputs: builderInputs({
      ready: JSON.stringify(ready),
      ui: JSON.stringify(ui),
      ledgers: JSON.stringify(ledger),
      screenshot_hex: JPEG_HEX,
    }),
    build(staging) {
      writeJson(path.join(staging, "native-driver-ready.json"), ready);
      writeJson(path.join(staging, "native-ui-complete.json"), ui);
      fs.writeFileSync(path.join(staging, "shot.jpg"), Buffer.from(JPEG_HEX, "hex"));
      writeWaitLedger(staging);
      return [
        "native-driver-ready.json",
        "native-ui-complete.json",
        "shot.jpg",
        ...Object.keys(ledger),
      ];
    },
  };
}

function seedProductionDatabase(file) {
  const db = new DatabaseSync(file);
  try {
    for (const [name, value] of Object.entries(JOURNAL_PRAGMAS)) {
      db.exec(`PRAGMA ${name} = ${value}`);
    }
    db.exec(PRODUCTION_SCHEMA_SQL);
    for (const id of PRODUCTION_SEED.works) db.prepare("INSERT INTO works (id) VALUES (?)").run(id);
  } finally {
    db.close();
  }
}

export function productionDbFixtureSpec() {
  return {
    name: "b61-production-counts",
    inputs: builderInputs({
      schema: PRODUCTION_SCHEMA_SQL,
      seed: JSON.stringify(PRODUCTION_SEED),
      journal: JOURNAL_CONFIG,
    }),
    build(staging) {
      const file = path.join(staging, PRODUCTION_DB_REL);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      seedProductionDatabase(file);
      return [PRODUCTION_DB_REL];
    },
  };
}
