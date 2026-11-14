// 引用日志无损读取边界：SQLite TEXT 列里实际是 16 原始字节（含 NUL/非法 UTF-8）时，
// 必须经 SQLite 投影成规范 UUID，而不是让 Node 按 TEXT 解码后损坏。测试只读合成 DB。
//
// DB 模板由 `fixtures/request_cost_cli_reference_io_fixture.mjs` 在 run 内按规格唯一
// 物化（正常 16 字节 TEXT 投影 / 非 16 字节 BLOB 反例是两套不同 seed，不合并）；
// 只读打开、连接 finally 关闭，不遗留 -wal/-shm。
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CANON_TABLES,
  buildAuthoringCanonSnapshot,
} from "./authoring_canon_evidence.mjs";
import {
  REFERENCE_LOG_UUID_COLUMNS,
  referenceLogRows,
} from "./reference_log_evidence.mjs";
import { materializeFixture, openTestRunScope } from "../test_env.mjs";
import {
  REFERENCE_LOG_DB_REL,
  referenceLogBytesFixtureSpec,
  referenceLogInvalidUuidFixtureSpec,
} from "./fixtures/request_cost_cli_reference_io_fixture.mjs";

const ID = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const MEMORY = Buffer.from("ffeeddccbbaa99887766554433221100", "hex");
const WORK = Buffer.from("0123456789abcdef0123456789abcdef", "hex");

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function emptyTables() {
  return Object.fromEntries(CANON_TABLES.map((table) => [table, []]));
}

function openFixture(spec) {
  const template = materializeFixture(spec(), { scope: runScope });
  const file = template.files.get(REFERENCE_LOG_DB_REL);
  return { db: new DatabaseSync(file, { readOnly: true }), file };
}

function assertNoJournalSidecars(file) {
  for (const suffix of ["-wal", "-shm"]) {
    assert.equal(fs.existsSync(`${file}${suffix}`), false, `不应遗留 ${suffix}`);
  }
}

test("16 字节 UUID（含 NUL/非法 UTF-8）经 SQLite 投影无损读取且 canon 可解析", () => {
  const { db, file } = openFixture(referenceLogBytesFixtureSpec);
  try {
    // 原始 SQL 事实：storage class 是 TEXT，但实际字节长度是 16。
    const lengths = db
      .prepare(
        `SELECT typeof(id) AS id_type, ${REFERENCE_LOG_UUID_COLUMNS.map(
          (column) => `length(CAST(${column} AS BLOB)) AS ${column}_len`,
        ).join(", ")} FROM memory_reference_logs ORDER BY inserted_at`,
      )
      .all();
    assert.equal(lengths[0].id_type, "text");
    assert.deepEqual({ ...lengths[0] }, {
      id_type: "text",
      id_len: 16,
      memory_id_len: 16,
      work_id_len: 16,
      task_id_len: null,
      conversation_id_len: null,
    });

    const rows = referenceLogRows(db);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, ID.toString("hex"));
    assert.equal(rows[0].memory_id, MEMORY.toString("hex"));
    assert.equal(rows[0].work_id, WORK.toString("hex"));
    assert.equal(rows[1].id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const canon = buildAuthoringCanonSnapshot({
      tables: emptyTables(),
      referenceLogs: rows,
      at: "2026-11-13T08:00:02.000000Z",
    });
    assert.deepEqual(
      canon.memory_reference_logs.map((log) => log.id),
      [
        "00112233-4455-6677-8899-aabbccddeeff",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ],
    );
    assert.deepEqual(canon.memory_reference_logs[0], {
      id: "00112233-4455-6677-8899-aabbccddeeff",
      memory_id: "ffeeddcc-bbaa-9988-7766-554433221100",
      work_id: "01234567-89ab-cdef-0123-456789abcdef",
      task_id: null,
      conversation_id: null,
      reference_scene: "dialogue_context",
      reference_reason: "dialogue context recall",
      inserted_at: "2026-11-13T08:00:00.000000Z",
    });
  } finally {
    db.close();
  }
  assertNoJournalSidecars(file);
});

test("非 16 字节 BLOB 不被投影，canon 明确拒绝而不是猜测", () => {
  const { db, file } = openFixture(referenceLogInvalidUuidFixtureSpec);
  try {
    const rows = referenceLogRows(db);
    assert.ok(rows[0].id instanceof Uint8Array);
    assert.throws(
      () => buildAuthoringCanonSnapshot({
        tables: emptyTables(),
        referenceLogs: rows,
        at: "2026-11-13T08:00:01.000000Z",
      }),
      /invalid_authoring_canon_snapshot/,
    );
  } finally {
    db.close();
  }
  assertNoJournalSidecars(file);
});
