// B87 R01 CLI/drive/reference 族唯一 IO fixture owner。
//
// 只服务 `../../../model_contracts/request_cost_baseline_cli_io.test.mjs` 与
// `../reference_log_evidence.test.mjs`：
//   - 合成 native manifest 文本（不读真实 artifacts/作者日志）；
//   - `memory_reference_logs` 两套 SQLite 规格：16 原始字节存 TEXT 列的正常投影，
//     与非 16 字节 BLOB 的拒绝反例。两套 seed 语义不同，按规格分开物化，不合并。
//
// 1 表是 `referenceLogRows` 实际消费的当前投影，不声称可启动完整生产应用。模板以
// DELETE journal 封存、连接 finally 关闭；正常只读共享，不 import 被测 reader/CLI。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nativeManifest } from "./request_cost_manifest_fixture.mjs";

export const REFERENCE_LOG_DB_REL = "db.sqlite3";
const SCHEMA_SQL = `CREATE TABLE memory_reference_logs (
  id TEXT PRIMARY KEY, memory_id TEXT, work_id TEXT, task_id TEXT,
  conversation_id TEXT, reference_scene TEXT, reference_reason TEXT,
  inserted_at TEXT
);`;
const JOURNAL_PRAGMAS = Object.freeze({ journal_mode: "DELETE", synchronous: "FULL" });
const JOURNAL_CONFIG = Object.entries(JOURNAL_PRAGMAS)
  .map(([key, value]) => `${key}=${value}`)
  .join("; ");

const ID_HEX = "00112233445566778899aabbccddeeff";
const MEMORY_HEX = "ffeeddccbbaa99887766554433221100";
const WORK_HEX = "0123456789abcdef0123456789abcdef";

const TEXT16_ROWS = Object.freeze([
  {
    id: { hex: ID_HEX, storage: "text16" },
    memory_id: { hex: MEMORY_HEX, storage: "text16" },
    work_id: { hex: WORK_HEX, storage: "text16" },
    task_id: null,
    conversation_id: null,
    reference_scene: "dialogue_context",
    reference_reason: "dialogue context recall",
    inserted_at: "2026-11-13T08:00:00.000000Z",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    memory_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    work_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    task_id: null,
    conversation_id: null,
    reference_scene: "manual",
    reference_reason: "作者手动引用",
    inserted_at: "2026-11-13T08:00:01.000000Z",
  },
]);

const INVALID_UUID_ROWS = Object.freeze([
  {
    id: { hex: "0011", storage: "blob" },
    memory_id: { hex: MEMORY_HEX, storage: "blob" },
    work_id: { hex: WORK_HEX, storage: "blob" },
    task_id: null,
    conversation_id: null,
    reference_scene: "manual",
    reference_reason: null,
    inserted_at: "2026-11-13T08:00:00.000000Z",
  },
]);

function applyJournalPragmas(db) {
  for (const [name, value] of Object.entries(JOURNAL_PRAGMAS)) db.exec(`PRAGMA ${name} = ${value}`);
}

// TEXT16 行按真实 schema 的 binary_id 写法 CAST(? AS TEXT) 写入，storage class 保持 TEXT
// 且实际字节长度 16；规范 UUID 行原样写 TEXT。反例行直接写 BLOB，证明 reader 不猜测。
function seedReferenceLogs(db, rows, { castText16 = false } = {}) {
  const insert = castText16
    ? db.prepare(
        "INSERT INTO memory_reference_logs VALUES (CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),?,?,?,?,?)",
      )
    : db.prepare("INSERT INTO memory_reference_logs VALUES (?,?,?,?,?,?,?,?)");
  for (const row of rows) {
    const value = (column) => {
      const entry = row[column];
      return entry && typeof entry === "object" && !Buffer.isBuffer(entry)
        ? Buffer.from(entry.hex, "hex")
        : entry;
    };
    insert.run(
      value("id"),
      value("memory_id"),
      value("work_id"),
      row.task_id,
      row.conversation_id,
      row.reference_scene,
      row.reference_reason,
      row.inserted_at,
    );
  }
}

function referenceLogSpec({ name, rows, castText16 }) {
  return {
    name,
    inputs: {
      schema: SCHEMA_SQL,
      seed: JSON.stringify(rows),
      journal: JOURNAL_CONFIG,
      builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
      runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
    },
    build(staging) {
      const file = path.join(staging, REFERENCE_LOG_DB_REL);
      const db = new DatabaseSync(file);
      try {
        applyJournalPragmas(db);
        db.exec(SCHEMA_SQL);
        seedReferenceLogs(db, rows, { castText16 });
      } finally {
        db.close();
      }
      return [REFERENCE_LOG_DB_REL];
    },
  };
}

export function nativeManifestFixtureSpec() {
  return {
    name: "b87-r01-native-manifest",
    files: { "manifest.json": JSON.stringify(nativeManifest(), null, 2) },
  };
}

export function referenceLogBytesFixtureSpec() {
  return referenceLogSpec({
    name: "b87-r01-reference-log-bytes",
    rows: TEXT16_ROWS,
    castText16: true,
  });
}

export function referenceLogInvalidUuidFixtureSpec() {
  return referenceLogSpec({
    name: "b87-r01-reference-log-invalid-uuid",
    rows: INVALID_UUID_ROWS,
    castText16: false,
  });
}
