// B71 capture 证据族唯一的真实 SQLite fixture owner。
//
// 只服务 `../authoring_capture_evidence_io.test.mjs`：12 表是 prepare/capture 实际
// 读取的投影（`targetFor`/`planningCanonSnapshot`/`productionTableCounts`），不声称
// 可启动完整生产应用；种子对应既有合成批次，不读取作者源数据。默认批次与
// `works` 无主键 + 重复行的负例是不同 DB 规格，按 A2 规则各自物化，不合并模板。
//
// 模板以 DELETE journal 封存（无 -wal/-shm），正常只读共享；需要写 config/seed/
// 证据文件或运行 prepare/capture 的 case 经 `withWorkingCopy` 取隔离副本。
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { AT, CHAPTER, WORK } from "./authoring_capture_facts.mjs";

export const CAPTURE_DB_REL = "database/ai_novel_studio_test.sqlite3";

const STATIC_TABLES_SQL = `
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE work_sessions (id TEXT PRIMARY KEY);
    CREATE TABLE drafts (id TEXT PRIMARY KEY);
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY, work_id TEXT, volume_id TEXT, title TEXT, seq INTEGER,
      status TEXT, inserted_at TEXT, updated_at TEXT, summary TEXT, plan_direction TEXT
    );
    CREATE TABLE volumes (id TEXT PRIMARY KEY);
    CREATE TABLE scenes (id TEXT PRIMARY KEY);
    CREATE TABLE characters (id TEXT PRIMARY KEY);
    CREATE TABLE memory_items (
      id TEXT PRIMARY KEY, work_id TEXT, reference_count INTEGER, last_referenced_at TEXT
    );
    CREATE TABLE ledger_entries (id TEXT PRIMARY KEY);
    CREATE TABLE author_action_receipts (id TEXT PRIMARY KEY);
    CREATE TABLE memory_reference_logs (
      id TEXT PRIMARY KEY, memory_id TEXT, work_id TEXT, task_id TEXT,
      conversation_id TEXT, reference_scene TEXT, reference_reason TEXT, inserted_at TEXT
    );
`;

// 负例「重名作品」只放宽 works 主键并插入重复行，其余 11 表与正例同规格。
function captureSchemaSql({ duplicateWork = false } = {}) {
  return `
    CREATE TABLE works (id TEXT${duplicateWork ? "" : " PRIMARY KEY"}, title TEXT);
    ${STATIC_TABLES_SQL}
  `;
}

function seedFacts({ duplicateWork = false } = {}) {
  return {
    works: [
      { id: WORK, title: "测试作品" },
      ...(duplicateWork ? [{ id: WORK, title: "重复作品" }] : []),
    ],
    chapters: [
      {
        id: CHAPTER,
        work_id: WORK,
        title: "第02章：矿区追击战",
        seq: 2,
        status: "PLANNED",
        inserted_at: AT,
        updated_at: AT,
        summary: "章摘要",
        plan_direction: JSON.stringify({ chapter_role: "动作章" }),
      },
    ],
  };
}

function seedDatabase(file, { schema, facts }) {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(schema);
    const insertWork = db.prepare("INSERT INTO works (id, title) VALUES (?, ?)");
    for (const work of facts.works) insertWork.run(work.id, work.title);
    const insertChapter = db.prepare(
      "INSERT INTO chapters (id, work_id, title, seq, status, inserted_at, updated_at, summary, plan_direction) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const chapter of facts.chapters) {
      insertChapter.run(
        chapter.id,
        chapter.work_id,
        chapter.title,
        chapter.seq,
        chapter.status,
        chapter.inserted_at,
        chapter.updated_at,
        chapter.summary,
        chapter.plan_direction,
      );
    }
  } finally {
    db.close();
  }
}

/**
 * capture 批次的 12 表模板规格：同一规格（duplicateWork）在 run 内只物化一次。
 * 返回的列表即发布 payload 的完整文件集合；config/ready/seed/预注册等小文件属于
 * case 上下文，由 IO 测试在隔离副本上写。
 */
export function captureFixtureSpec({ duplicateWork = false } = {}) {
  const schema = captureSchemaSql({ duplicateWork });
  const facts = seedFacts({ duplicateWork });
  return {
    name: "b71-capture-batch",
    inputs: {
      duplicate_work: String(duplicateWork),
      schema,
      seed: JSON.stringify(facts),
      journal: "DELETE",
      builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
      facts_source: fs.readFileSync(new URL("./authoring_capture_facts.mjs", import.meta.url), "utf8"),
      runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
    },
    build(staging) {
      fs.mkdirSync(`${staging}/database`, { recursive: true });
      seedDatabase(`${staging}/${CAPTURE_DB_REL}`, { schema, facts });
      return [CAPTURE_DB_REL];
    },
  };
}
