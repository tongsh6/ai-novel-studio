// B27 §9 CP3 证据核验器测试族唯一的真实文件/SQLite fixture owner。
//
// 只服务 `../../../native_b27_request_source_evidence.test.mjs`：真实驱动 JSONL、
// 生命周期 JSON、app-log 与 4 表 SQLite（零 canon 写判据实际 COUNT 的投影）。
// 内嵌 python sqlite3 构建器保留原构造方式；DDL/seed/DELETE journal/真实 builder
// 与纯事实源码/runtime 进入 `inputs` 指纹，连接在构建器内 finally 关闭、无 -wal/-shm。
// 模板正常只读共享；正例写 summary、反例改生命周期的 case 经 `withWorkingCopy`
// 取隔离副本。本模块不 import 被测 SUT，也不把最小查询投影称为生产完整 Schema。
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import {
  DB_REL,
  DB_SCHEMA_SQL,
  DB_SEED,
  appLogRecords,
  driverLog,
  lifecycleAfter,
  lifecycleBefore,
  llmCalls,
} from "./native_b27_request_source_facts.mjs";

export const B27_DB_REL = DB_REL;
export const B27_DRIVER_LOG = "b27-request-source-native-driver-log.json";
export const B27_LIFECYCLE_BEFORE = "model-lifecycle-before.json";
export const B27_LIFECYCLE_AFTER = "model-lifecycle-after.json";
export const B27_LLM_CALLS = "llm-calls/2026-10-30.jsonl";
export const B27_APP_LOG = "app-log/2026-10-30.jsonl";

const JOURNAL = "DELETE";

// 原构造方式保留：python sqlite3 建表/seed；python 版本作为真实 runtime 进入指纹。
let runtimeCache = "";
function pythonRuntime() {
  if (!runtimeCache) {
    const result = spawnSync("python3", ["--version"], { encoding: "utf8" });
    if (result.error) throw result.error;
    const version = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    runtimeCache = `node=${process.version}; ${version || `python exit=${result.status}`}`;
  }
  return runtimeCache;
}

const PYTHON_SEED = [
  "import sqlite3, sys, json",
  "db = sqlite3.connect(sys.argv[1])",
  "try:",
  `    db.execute('PRAGMA journal_mode = ${JOURNAL}')`,
  "    db.executescript(sys.argv[2])",
  "    for table, rows in json.loads(sys.argv[3]).items():",
  "        db.executemany('INSERT INTO %s (id) VALUES (?)' % table, [(row,) for row in rows])",
  "    db.commit()",
  "finally:",
  "    db.close()",
].join("\n");

function readJsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function build(staging) {
  fs.mkdirSync(`${staging}/database`, { recursive: true });
  fs.mkdirSync(`${staging}/llm-calls`, { recursive: true });
  fs.mkdirSync(`${staging}/app-log`, { recursive: true });
  fs.writeFileSync(`${staging}/${B27_DRIVER_LOG}`, JSON.stringify(driverLog()));
  fs.writeFileSync(`${staging}/${B27_LIFECYCLE_BEFORE}`, JSON.stringify(lifecycleBefore()));
  fs.writeFileSync(`${staging}/${B27_LIFECYCLE_AFTER}`, JSON.stringify(lifecycleAfter()));
  fs.writeFileSync(`${staging}/${B27_LLM_CALLS}`, readJsonl(llmCalls()));
  fs.writeFileSync(`${staging}/${B27_APP_LOG}`, readJsonl(appLogRecords()));
  execFileSync("python3", [
    "-c",
    PYTHON_SEED,
    `${staging}/${DB_REL}`,
    DB_SCHEMA_SQL,
    JSON.stringify(DB_SEED),
  ]);
  return [
    B27_DRIVER_LOG,
    B27_LIFECYCLE_BEFORE,
    B27_LIFECYCLE_AFTER,
    B27_LLM_CALLS,
    B27_APP_LOG,
    DB_REL,
  ];
}

/** 同一批事实在 run 内只物化一次；builder 只在 claim 后同步执行。 */
export function b27RequestSourceFixtureSpec() {
  return {
    name: "b27-request-source",
    inputs: {
      ddl: DB_SCHEMA_SQL,
      seed: JSON.stringify(DB_SEED),
      journal: JOURNAL,
      driver_log: JSON.stringify(driverLog()),
      lifecycle_before: JSON.stringify(lifecycleBefore()),
      lifecycle_after: JSON.stringify(lifecycleAfter()),
      llm_calls: JSON.stringify(llmCalls()),
      app_log: JSON.stringify(appLogRecords()),
      builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
      pure_fixture_source: fs.readFileSync(
        new URL("./native_b27_request_source_facts.mjs", import.meta.url),
        "utf8",
      ),
      runtime: pythonRuntime(),
    },
    build,
  };
}
