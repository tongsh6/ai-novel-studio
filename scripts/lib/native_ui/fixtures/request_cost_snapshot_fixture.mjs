// B87 R01 快照/恢复测试族的唯一源 DB fixture owner。
//
// 只服务 `../request_cost_snapshot_io.test.mjs`（快照/恢复）与
// `../../../model_contracts/request_cost_capture.test.mjs`（native 准备）的真实
// SQLite 输入。14 表是当前快照/canon 查询实际消费的投影，不声称可启动完整生产
// 应用，也不为 R01 新增生产关系或 Schema。种子按当前 foundation 枚举值域选取
// （AdoptionStatus/NarrativeRole/ProvisionalSource/MemoryType/MemoryScope/
// MemoryStatus/MemorySourceType），未知值/opaque 字节另由 case 在副本上单列透传，
// 不在本 builder 或 SUT 清洗作者源。
//
// builder 用 `DatabaseSync` 文件方式创建，连接在 finally 关闭，并以 DELETE journal
// 封存（不产生 -wal/-shm，模板可只读共享）。DDL、seed、journal 配置、真实 builder
// 源码与运行时版本全部进入 `inputs` 指纹；正常源只读复用，需要改源的 case 才取
// `withWorkingCopy` 隔离副本。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SOURCE_DB_REL = "source.sqlite3";

export const WORK = "11111111-1111-4111-8111-111111111111";
export const OTHER_WORK = "22222222-2222-4222-8222-222222222222";
export const OLD_SESSION = "33333333-3333-4333-8333-333333333333";
export const NEW_SESSION = "44444444-4444-4444-8444-444444444444";
export const DRAFT = "55555555-5555-4555-8555-555555555555";
export const OTHER_DRAFT = "66666666-6666-4666-8666-666666666666";
export const CHARACTER = "77777777-7777-4777-8777-777777777777";
export const MEMORY = "88888888-8888-4888-8888-888888888888";
export const CHAPTER = "99999999-9999-4999-8999-999999999999";
export const REFERENCE_LOG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const BLOB_REFERENCE_LOG_ID = "00112233445566778899aabbccddeeff";
export const BLOB_MEMORY_ID = "ffeeddccbbaa99887766554433221100";
export const BLOB_REFERENCE_WORK_ID = "0123456789abcdef0123456789abcdef";
export const TIME = "2026-11-12T17:21:30.000000Z";
export const LATER = "2026-11-13T08:00:00.000000Z";

// 同一真实配置既驱动 PRAGMA 执行，也进入指纹；不维护第二份易漂移的声明字符串。
const JOURNAL_PRAGMAS = Object.freeze({ journal_mode: "DELETE", synchronous: "FULL" });
const JOURNAL_CONFIG = Object.entries(JOURNAL_PRAGMAS)
  .map(([key, value]) => `${key}=${value}`)
  .join("; ");

// 14 表取当前快照/canon 实际读取的列；reference_log_evidence 依赖 memory_reference_logs
// 的真实 TEXT/BLOB 形状，因此保留该表全部被消费列，不写缺列兼容。
const SOURCE_SCHEMA_SQL = `
  CREATE TABLE works (id TEXT PRIMARY KEY, title TEXT, genre TEXT, status TEXT, premise TEXT,
    tone_preference TEXT, revision INTEGER, inserted_at TEXT, updated_at TEXT);
  CREATE TABLE work_sessions (id TEXT PRIMARY KEY, work_id TEXT, title TEXT, summary TEXT,
    status TEXT, source_session_ref TEXT, source_turn_ref TEXT, last_opened_at TEXT,
    inserted_at TEXT, updated_at TEXT);
  CREATE TABLE drafts (id TEXT PRIMARY KEY, work_id TEXT, scene_id TEXT, content TEXT, status TEXT,
    revision INTEGER, inserted_at TEXT, updated_at TEXT);
  CREATE TABLE chapters (id TEXT PRIMARY KEY, work_id TEXT, volume_id TEXT, title TEXT, seq INTEGER,
    status TEXT, inserted_at TEXT, updated_at TEXT, summary TEXT, plan_direction TEXT);
  CREATE TABLE volumes (id TEXT PRIMARY KEY, work_id TEXT, title TEXT, seq INTEGER, status TEXT,
    inserted_at TEXT, updated_at TEXT, blueprint TEXT);
  CREATE TABLE scenes (id TEXT PRIMARY KEY, work_id TEXT, chapter_id TEXT, title TEXT, seq INTEGER,
    status TEXT, inserted_at TEXT, updated_at TEXT);
  CREATE TABLE characters (id TEXT PRIMARY KEY, work_id TEXT, name TEXT, aliases TEXT, role TEXT,
    summary TEXT, status TEXT, inserted_at TEXT, updated_at TEXT, narrative_role TEXT,
    provisional_source TEXT, provisional_active INTEGER);
  CREATE TABLE memory_items (id TEXT PRIMARY KEY, work_id TEXT, volume_id TEXT, arc_id TEXT,
    chapter_id TEXT, content TEXT, summary TEXT, type TEXT, scope TEXT, status TEXT,
    source_type TEXT, reference_count INTEGER, weight REAL, confidence REAL, source_confidence REAL,
    locked INTEGER, recallable INTEGER, common_sense INTEGER, valid_from TEXT, valid_until TEXT,
    expire_condition TEXT, version INTEGER, tags TEXT, source_id TEXT, last_referenced_at TEXT,
    inserted_at TEXT, updated_at TEXT, supersedes_ref TEXT, superseded_by_ref TEXT);
  CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, work_id TEXT, ledger TEXT, subject_kind TEXT,
    subject_ref TEXT, subject_label TEXT, design_ref TEXT, status TEXT, payload TEXT,
    source_refs TEXT, last_event_chapter TEXT, adoption_status TEXT, revision INTEGER,
    inserted_at TEXT, updated_at TEXT);
  CREATE TABLE author_action_receipts (id TEXT PRIMARY KEY, work_id TEXT, session_id TEXT,
    source_turn_ref TEXT, action_id TEXT, action_type TEXT, idempotency_key TEXT, status TEXT,
    result TEXT, inserted_at TEXT, updated_at TEXT, behavior_ref TEXT);
  CREATE TABLE memory_reference_logs (id TEXT PRIMARY KEY, memory_id TEXT, work_id TEXT,
    task_id TEXT, conversation_id TEXT, reference_scene TEXT, reference_reason TEXT,
    inserted_at TEXT);
  CREATE TABLE agent_runs (id TEXT PRIMARY KEY, run_mode TEXT);
  CREATE TABLE long_run_tasks (id TEXT PRIMARY KEY, status TEXT);
  CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_call_ref TEXT);
`;

// 普通投影种子只用当前合法枚举值；未知值反例由 case 在隔离副本上写入。
// draft/character 的 status 属 AdoptionStatus，memory 的 type/scope/status/source_type
// 属各自 foundation 枚举，不能沿用旧 WIP 的 ADOPTED/CONFIRMED/fact/work/ACTIVE/author。
function sourceSeed({ workTitle }) {
  return {
    works: [
      [WORK, workTitle, "仙侠", "TENTATIVE", "前提", "克制", 1, TIME, TIME],
      [OTHER_WORK, "未命名作品", "都市", "ACCEPTED", "别作前提", "轻快", 3, TIME, TIME],
    ],
    work_sessions: [
      [OLD_SESSION, WORK, "默认会话", null, "ACTIVE", null, null, TIME, TIME, TIME],
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", OTHER_WORK, "别作会话", null, "ACTIVE", null, null, TIME, TIME, TIME],
    ],
    drafts: [
      [DRAFT, WORK, null, "受测正文", "ACCEPTED", 1, TIME, TIME],
      [OTHER_DRAFT, OTHER_WORK, null, "别作正文", "ACCEPTED", 1, TIME, TIME],
    ],
    chapters: [[CHAPTER, WORK, null, "第01章", 1, "DRAFTING", TIME, TIME, "摘要", null]],
    characters: [
      [
        CHARACTER,
        WORK,
        "沈砚",
        "[]",
        "PROTAGONIST",
        "角色摘要",
        "TENTATIVE",
        TIME,
        TIME,
        "PROTAGONIST",
        "AI_ASSUMPTION",
        1,
      ],
    ],
    memory_items: [
      [
        MEMORY,
        WORK,
        null,
        null,
        null,
        "记忆正文",
        "记忆摘要",
        "PLOT_FACT",
        "WORK",
        "DRAFT",
        "AUTHOR_CREATED",
        0,
        1.0,
        1.0,
        1.0,
        0,
        1,
        0,
        null,
        null,
        null,
        1,
        "[]",
        null,
        null,
        TIME,
        TIME,
        null,
        null,
      ],
    ],
    memory_reference_logs: [
      [REFERENCE_LOG, MEMORY, WORK, null, null, "dialogue_context", "dialogue context recall", TIME],
      // 真实 schema 的 binary_id 以 16 原始字节存进 TEXT 列；含 NUL 的字节不能被当
      // UTF-8 解码。该行作为 opaque 透传证据保留，不在 builder 里转字符串。
      [
        Buffer.from(BLOB_REFERENCE_LOG_ID, "hex"),
        Buffer.from(BLOB_MEMORY_ID, "hex"),
        Buffer.from(BLOB_REFERENCE_WORK_ID, "hex"),
        null,
        null,
        "dialogue_context",
        "dialogue recall matched author input: 记忆正文",
        TIME,
      ],
    ],
    agent_runs: [["run-1", "bounded"]],
    long_run_tasks: [["task-1", "DONE"]],
    provider_runs: [["prun-1", "pcall-old"]],
  };
}

function applyJournalPragmas(db) {
  for (const [name, value] of Object.entries(JOURNAL_PRAGMAS)) db.exec(`PRAGMA ${name} = ${value}`);
}

function insertRows(db, table, rows) {
  if (rows.length === 0) return;
  const placeholders = rows[0].map(() => "?").join(",");
  const statement = db.prepare(`INSERT INTO ${table} VALUES (${placeholders})`);
  for (const row of rows) statement.run(...row);
}

function writeSource(dir, seed) {
  const db = new DatabaseSync(path.join(dir, SOURCE_DB_REL));
  try {
    applyJournalPragmas(db);
    db.exec(SOURCE_SCHEMA_SQL);
    for (const [table, rows] of Object.entries(seed)) insertRows(db, table, rows);
  } finally {
    db.close();
  }
}

function readSource(rel) {
  return fs.readFileSync(new URL(rel, import.meta.url), "utf8");
}

/** 源 DB 的只读 fixture 规格；builder 只在 claim 后同步执行。 */
export function sourceSnapshotFixtureSpec({ workTitle = "未命名作品" } = {}) {
  const seed = sourceSeed({ workTitle });
  return {
    name: "b87-r01-source-snapshot",
    inputs: {
      schema: SOURCE_SCHEMA_SQL,
      seed: JSON.stringify(seed),
      config: JOURNAL_CONFIG,
      builder_source: readSource(import.meta.url),
      runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
    },
    build(staging) {
      writeSource(staging, seed);
      return [SOURCE_DB_REL];
    },
  };
}

/**
 * setup 声明效果的可写操作：目标作品改名/revision+1，旧 ACTIVE session 退出并建立
 * 指定新 session。只用于恢复后的 case 输出副本，不触碰只读源模板。
 */
export function renameAndCreateSession(
  file,
  { title = "未命名作品·副本", sessionId = NEW_SESSION, updatedAt = LATER } = {},
) {
  const db = new DatabaseSync(file);
  try {
    db.prepare("UPDATE works SET title = ?, revision = revision + 1, updated_at = ? WHERE id = ?").run(
      title,
      updatedAt,
      WORK,
    );
    db.prepare("UPDATE work_sessions SET status = 'EXITED', updated_at = ? WHERE id = ?").run(
      updatedAt,
      OLD_SESSION,
    );
    db.prepare("INSERT INTO work_sessions VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      sessionId,
      WORK,
      "R01基线新会话",
      null,
      "ACTIVE",
      null,
      null,
      LATER,
      LATER,
      LATER,
    );
  } finally {
    db.close();
  }
}
