// B71 §16.9 逐调用证据的 SQLite 合成模板构造规格。
//
// 只服务 `../authoring_call_evidence_io.test.mjs`：复用真实 producer 的 1 表 9 个
// 被消费列与 2 行 seed（owned + foreign），不 import 被测 reader/join，也不把
// 最小查询投影称为生产完整 Schema。纯数据构造在 `./authoring_call_fixture.mjs`；
// 本模块负责 SQLite 文件方式创建、DELETE journal 封存与真实构建指纹材料；
// 同一 JOURNAL_PRAGMAS 配置驱动实际 PRAGMA 执行和指纹，运行时版本直接取
// process.versions，不在申请/构造前提前打开数据库。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pair } from "./authoring_call_fixture.mjs";

export const AUTHORING_CALL_DB_REL = "database/ai_novel_studio_test.sqlite3";
const PROVIDER_RUNS_DDL =
  "CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT, " +
  "workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, status TEXT, " +
  "finite_mode_name TEXT)";
// 同一真实配置既驱动 PRAGMA 执行，也进入指纹；不维护第二份易漂移的声明字符串。
const JOURNAL_PRAGMAS = Object.freeze({ journal_mode: "DELETE", synchronous: "FULL" });
const JOURNAL_CONFIG = Object.entries(JOURNAL_PRAGMAS)
  .map(([key, value]) => `${key}=${value}`)
  .join("; ");

function ownedRow() {
  return { ...pair(1), finite_mode_name: "standalone_operation" };
}

function foreignRow() {
  return {
    ...pair(9, {
      id: "prun-foreign",
      provider_call_ref: "pcall-foreign",
      agent_run_id: "run-foreign",
    }),
    finite_mode_name: null,
  };
}

function seedRows() {
  return [ownedRow(), foreignRow()];
}

function insertRow(db, row) {
  db.prepare(
    "INSERT INTO provider_runs (id, provider_call_ref, agent_run_id, workspace_id, work_id, session_id, parent_turn_ref, status, finite_mode_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    row.id,
    row.provider_call_ref,
    row.agent_run_id,
    row.workspace_id,
    row.work_id,
    row.session_id,
    row.parent_turn_ref,
    row.status,
    row.finite_mode_name,
  );
}

function applyJournalPragmas(db) {
  for (const [name, value] of Object.entries(JOURNAL_PRAGMAS)) db.exec(`PRAGMA ${name} = ${value}`);
}

// 指纹材料显式包含 schema、seed、journal 配置、真实 builder 源码与纯依赖源码；
// 直接读取当前文件字节，因此未提交变化也进入规格，不靠 callback.toString 猜闭包。
function fingerprintMaterial(rows) {
  return {
    schema: PROVIDER_RUNS_DDL,
    seed: JSON.stringify(rows),
    config: JOURNAL_CONFIG,
    builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
    pure_fixture_source: fs.readFileSync(new URL("./authoring_call_fixture.mjs", import.meta.url), "utf8"),
    runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
  };
}

/** 当前唯一的 authoring_call SQLite 构造规格；builder 只在 claim 后同步执行。 */
export function authoringCallFixtureSpec() {
  const rows = seedRows();
  return {
    name: "authoring-call-db",
    inputs: fingerprintMaterial(rows),
    build(staging) {
      const file = path.join(staging, AUTHORING_CALL_DB_REL);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const db = new DatabaseSync(file);
      try {
        applyJournalPragmas(db);
        db.exec(PROVIDER_RUNS_DDL);
        for (const row of rows) insertRow(db, row);
      } finally {
        db.close();
      }
      return [AUTHORING_CALL_DB_REL];
    },
  };
}
