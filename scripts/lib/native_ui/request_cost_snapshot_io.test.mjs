// B87 R01 快照/恢复邻接 IO：只读源 fixture、完整副本、canon、setup 对账与公开
// preflight/restore 的运行清单事实来源。
//
// file 级 `before` 只申请/借用 run scope，`after` 关闭；源 DB 由
// `fixtures/request_cost_snapshot_fixture.mjs` 在首个真正需要它的 case 经
// `materializeFixture` 物化成唯一只读模板（DELETE journal 封存、无 -wal/-shm）。
// 正常源只读复用；需要改源的反例经 `withWorkingCopy` 取隔离副本。快照/恢复输出
// 是 case 可变资源，落在 run.workDir 的必要叶子上并由 `t.after` 立即绑定退出，
// 不为申请输出目录伪造空 fixture。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  fixtureTemplateHash,
  materializeFixture,
  openTestRunScope,
  withWorkingCopy,
} from "../test_env.mjs";
import { preflightNative } from "./request_cost_capture.mjs";
import {
  businessContentSha,
  contentCanonSha,
  contentCanonSnapshot,
  createCompleteSnapshot,
  readSnapshotManifest,
  readSnapshotRecord,
  reconcileSetupDelta,
  restoreSnapshot,
  sha256File,
} from "./request_cost_snapshot.mjs";
import { nativeManifest } from "./fixtures/request_cost_manifest_fixture.mjs";
import {
  BLOB_REFERENCE_LOG_ID,
  CHAPTER,
  CHARACTER,
  DRAFT,
  LATER,
  MEMORY,
  NEW_SESSION,
  OLD_SESSION,
  OTHER_WORK,
  REFERENCE_LOG,
  SOURCE_DB_REL,
  TIME,
  WORK,
  renameAndCreateSession,
  sourceSnapshotFixtureSpec,
} from "./fixtures/request_cost_snapshot_fixture.mjs";

const BLOB_LOG_UUID = "00112233-4455-6677-8899-aabbccddeeff";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function sourceFixture() {
  return materializeFixture(sourceSnapshotFixtureSpec(), { scope: runScope });
}

function sourceFile(fixture) {
  return fixture.files.get(SOURCE_DB_REL);
}

// 独立 oracle：只使用 Node crypto/Buffer 读取真实字节，不拿被测 sha256File 当答案。
function independentSha(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function caseLeaf(t, label) {
  const leaf = fs.mkdtempSync(path.join(runScope.workDir, `${label}-`));
  t.after(() => fs.rmSync(leaf, { recursive: true, force: true }));
  return leaf;
}

function snapshotOf(t, source, { label = "snapshot" } = {}) {
  const leaf = caseLeaf(t, label);
  const outDir = path.join(leaf, "snapshot");
  const manifest = createCompleteSnapshot({
    outDir,
    fullPath: source,
    frozenPath: source,
    expectedSha256: sha256File(source),
    allowedPrefix: leaf,
  });
  return { leaf, outDir, manifest };
}

function withDb(file, fn) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function seedFor(overrides = {}) {
  return {
    work_id: WORK,
    title: "未命名作品·副本",
    session_id: NEW_SESSION,
    session_title: "R01基线新会话",
    ...overrides,
  };
}

function reconcile({ source, batchDb, seed = seedFor() }) {
  const sourceDb = new DatabaseSync(source, { readOnly: true });
  try {
    const afterDb = new DatabaseSync(batchDb, { readOnly: true });
    try {
      return reconcileSetupDelta({ sourceDb, afterDb, workId: WORK, seed });
    } finally {
      afterDb.close();
    }
  } finally {
    sourceDb.close();
  }
}

function setup(t, { workTitle, updatedAt } = {}) {
  const fixture = materializeFixture(sourceSnapshotFixtureSpec({ workTitle }), { scope: runScope });
  const source = sourceFile(fixture);
  const sourceSha = sha256File(source);
  const snap = snapshotOf(t, source, { label: "setup" });
  const batchDir = path.join(snap.leaf, "batch");
  restoreSnapshot({ batchDir, snapshotDir: snap.outDir });
  const batchDb = path.join(batchDir, "database", "ai_novel_studio_test.sqlite3");
  renameAndCreateSession(batchDb, { updatedAt });
  return { fixture, source, sourceSha, ...snap, batchDir, batchDb };
}

function nativeLaunchManifest(snapshot) {
  const manifest = nativeManifest();
  manifest.seed = { ...manifest.seed, work_id: WORK };
  manifest.snapshot = {
    ...manifest.snapshot,
    source_sha256: snapshot.manifest.snapshot.full_sha256,
    work_sha256: snapshot.manifest.snapshot.work_sha256,
    content_sha256: snapshot.manifest.snapshot.content_sha256,
    business_content_sha256: snapshot.manifest.snapshot.business_content_sha256,
  };
  return manifest;
}

function preflight(snapshot) {
  const manifestPath = path.join(snapshot.leaf, "native-manifest.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(nativeLaunchManifest(snapshot), null, 2)}\n`,
  );
  return preflightNative({
    manifestPath,
    snapshotDir: snapshot.outDir,
    outDir: path.join(snapshot.leaf, "out"),
    length: 3,
  });
}

function editSnapshotManifest(snapshot, update) {
  const file = path.join(snapshot.outDir, "manifest.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const next = update(raw);
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}

test("完整副本：full/work 字节镜像、逐表行数与 canon 内容一致、源文件不变", (t) => {
  const fx = setup(t);
  const templateHash = fixtureTemplateHash(fx.fixture);
  // setup 返回的是 restoreSnapshot 的 manifest，不是落盘记录；恢复 hash 必须从
  // 实际 request-cost-snapshot.json 读取核对。
  assert.equal(
    readSnapshotRecord(fx.batchDir).restored_sha256,
    fx.manifest.snapshot.work_sha256,
  );

  // 源/full/work 的字节与 hash 用独立 Node crypto/Buffer 核对，不使用被测 sha256File。
  const sourceBytes = fs.readFileSync(fx.source);
  const full = path.join(fx.outDir, "full.sqlite3");
  const work = path.join(fx.outDir, "work.sqlite3");
  const fullBytes = fs.readFileSync(full);
  const workBytes = fs.readFileSync(work);
  assert.equal(independentSha(fx.source), fx.sourceSha, "创建快照不得改写源库");
  assert.equal(Buffer.compare(fullBytes, sourceBytes), 0, "full 必须与源字节一致");
  assert.equal(Buffer.compare(workBytes, fullBytes), 0, "work 必须与 full 字节一致");
  assert.equal(independentSha(full), fx.manifest.snapshot.full_sha256);
  assert.equal(independentSha(work), fx.manifest.snapshot.work_sha256);
  assert.equal(fixtureTemplateHash(fx.fixture), templateHash, "普通源模板不得被消费改变");

  const sourceTables = withDb(fx.source, (db) =>
    Object.fromEntries(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((row) => [
          row.name,
          Number(db.prepare(`SELECT COUNT(*) AS n FROM "${row.name}"`).get().n),
        ]),
    ),
  );
  assert.deepEqual(fx.manifest.snapshot.table_counts, sourceTables, "完整副本不得删行");
  assert.equal(
    fx.manifest.snapshot.content_sha256,
    withDb(fx.source, (db) => contentCanonSha(db)),
    "canon 内容签名必须与原库一致",
  );
  assert.equal(
    fx.manifest.snapshot.business_content_sha256,
    withDb(fx.source, (db) => businessContentSha(contentCanonSnapshot(db, TIME))),
    "canon 业务内容签名必须与原库一致",
  );
  assert.equal(
    fx.manifest.snapshot.canon.memory_reference_logs.length,
    2,
    "快照 canon 必须保留真实引用日志，不能写成空数组",
  );
  assert.deepEqual(
    fx.manifest.snapshot.canon.memory_reference_logs.map((log) => log.id),
    [BLOB_LOG_UUID, REFERENCE_LOG],
  );
  assert.deepEqual(fx.manifest.snapshot.run_inventory.runs_by_mode, { bounded: 1 });
  assert.deepEqual(fx.manifest.snapshot.run_inventory.long_run_tasks, [
    { id: "task-1", status: "DONE" },
  ]);
  assert.deepEqual(fx.manifest.snapshot.run_inventory.provider_call_refs, ["pcall-old"]);
  assert.deepEqual(fx.manifest.snapshot.run_inventory.provider_run_count, 1);
  const record = readSnapshotRecord(fx.batchDir);
  assert.equal(record.snapshot.content_sha256, fx.manifest.snapshot.content_sha256);
  assert.equal(record.restored_sha256, fx.manifest.snapshot.work_sha256);
});

test("快照防护：错误 hash/非冻结路径/越界目录/已存在目录都拒绝", (t) => {
  const fixture = sourceFixture();
  const source = sourceFile(fixture);
  const leaf = caseLeaf(t, "guard");
  const base = {
    fullPath: source,
    frozenPath: source,
    expectedSha256: sha256File(source),
    allowedPrefix: leaf,
  };
  assert.throws(
    () => createCompleteSnapshot({ ...base, outDir: path.join(leaf, "a"), expectedSha256: "wrong" }),
    /快照源 full hash 不符/,
  );
  assert.throws(
    () =>
      createCompleteSnapshot({
        ...base,
        outDir: path.join(leaf, "b"),
        frozenPath: path.join(leaf, "other.sqlite3"),
      }),
    /快照源固定/,
  );
  assert.throws(
    () =>
      createCompleteSnapshot({
        ...base,
        outDir: path.join(leaf, "c"),
        allowedPrefix: path.join(leaf, "inside"),
      }),
    /快照目录必须在/,
  );
  const existing = path.join(leaf, "d");
  fs.mkdirSync(existing);
  assert.throws(
    () => createCompleteSnapshot({ ...base, outDir: existing }),
    /必须不存在/,
  );
});

test("恢复：源/副本 hash 与 canon 不符失败，目标库已存在拒绝覆盖", (t) => {
  const fx = setup(t);
  assert.throws(() => restoreSnapshot({ batchDir: fx.batchDir, snapshotDir: fx.outDir }), /已存在/);
  const tampered = path.join(fx.leaf, "tampered");
  fs.cpSync(fx.outDir, tampered, { recursive: true });
  fs.appendFileSync(path.join(tampered, "work.sqlite3"), "x");
  assert.throws(
    () => restoreSnapshot({ batchDir: path.join(fx.leaf, "batch-2"), snapshotDir: tampered }),
    /work hash 不符/,
  );
});

test("setup 对账：只声明 title/revision/updated_at 与新 session，投影内容与源一致", (t) => {
  const fx = setup(t);
  const delta = reconcile({ source: fx.source, batchDb: fx.batchDb });
  assert.deepEqual(delta.work.changed_fields, ["revision", "title", "updated_at"]);
  assert.equal(delta.work.title_before, "未命名作品");
  assert.equal(delta.work.title_after, "未命名作品·副本");
  assert.equal(delta.work.revision_before, 1);
  assert.equal(delta.work.revision_after, 2);
  assert.equal(delta.session.new_session_id, NEW_SESSION);
  assert.deepEqual(delta.session.exited_session_ids, [OLD_SESSION]);
  assert.equal(delta.projected_content_sha256, delta.source_content_sha256);
  assert.equal(delta.projected_content_sha256, fx.manifest.snapshot.business_content_sha256);
});

test("setup 反例：正文/角色/记忆/别作内容变化即使行数不变也必须失败", (t) => {
  for (const [sql, params] of [
    ["UPDATE drafts SET content = ? WHERE id = ?", ["被篡改正文", DRAFT]],
    ["UPDATE characters SET summary = ? WHERE id = ?", ["被篡改角色", CHARACTER]],
    ["UPDATE memory_items SET content = ? WHERE id = ?", ["被篡改记忆", MEMORY]],
    ["UPDATE works SET title = ? WHERE id = ?", ["别作被改名", OTHER_WORK]],
    ["UPDATE work_sessions SET title = ? WHERE work_id = ?", ["别作会话被改名", OTHER_WORK]],
    ["UPDATE chapters SET title = ? WHERE id = ?", ["第01章被改名", CHAPTER]],
  ]) {
    const fx = setup(t);
    const db = new DatabaseSync(fx.batchDb);
    try {
      db.prepare(sql).run(...params);
    } finally {
      db.close();
    }
    assert.throws(
      () => reconcile({ source: fx.source, batchDb: fx.batchDb }),
      /setup 改变了声明字段以外的作品内容|setup 不得改变其它作品的 session/,
    );
  }
});

test("setup 反例：标题/revision/session 实际值不符合冻结声明必须失败", (t) => {
  {
    const fx = setup(t);
    assert.throws(
      () => reconcile({ source: fx.source, batchDb: fx.batchDb, seed: seedFor({ title: "另一个名字" }) }),
      /可见名与冻结值不一致/,
    );
  }
  {
    const fx = setup(t);
    const db = new DatabaseSync(fx.batchDb);
    try {
      db.prepare("UPDATE works SET revision = 7 WHERE id = ?").run(WORK);
    } finally {
      db.close();
    }
    assert.throws(() => reconcile({ source: fx.source, batchDb: fx.batchDb }), /revision 加一/);
  }
  {
    const fx = setup(t);
    const db = new DatabaseSync(fx.batchDb);
    try {
      db.prepare("DELETE FROM work_sessions WHERE id = ?").run(OLD_SESSION);
    } finally {
      db.close();
    }
    assert.throws(() => reconcile({ source: fx.source, batchDb: fx.batchDb }), /不得删除旧 session/);
  }
  {
    const fx = setup(t);
    const db = new DatabaseSync(fx.batchDb);
    try {
      db.prepare("UPDATE work_sessions SET status = 'ARCHIVED' WHERE id = ?").run(OLD_SESSION);
    } finally {
      db.close();
    }
    assert.throws(
      () => reconcile({ source: fx.source, batchDb: fx.batchDb }),
      /必须退出|只允许退出与运营时间变化/,
    );
  }
});

test("canon 内容签名对正文/角色/记忆的单字节变化可见（行数不变）", (t) => {
  for (const [sql, params] of [
    ["UPDATE drafts SET content = ?", ["受测正文!"]],
    ["UPDATE characters SET summary = ?", ["角色摘要!"]],
    ["UPDATE memory_items SET content = ?", ["记忆正文!"]],
  ]) {
    const fx = setup(t);
    const before = withDb(fx.batchDb, (db) => contentCanonSha(db));
    const db = new DatabaseSync(fx.batchDb);
    try {
      db.prepare(sql).run(...params);
    } finally {
      db.close();
    }
    const after = withDb(fx.batchDb, (db) => contentCanonSha(db));
    assert.notEqual(after, before, `行数不变的内容变化必须改变 canon: ${sql}`);
  }
});

test("setup 不强制运营时钟变化：updated_at 同 tick 合法，声明效果仍直接检验", (t) => {
  const fx = setup(t, { updatedAt: TIME });
  const delta = reconcile({ source: fx.source, batchDb: fx.batchDb });
  assert.deepEqual(delta.work.changed_fields, ["revision", "title"]);
  assert.equal(delta.work.updated_at_before, TIME);
  assert.equal(delta.work.updated_at_after, TIME);
  assert.equal(delta.projected_content_sha256, delta.source_content_sha256);
});

test("setup 不强制 title 字段变化：源已是冻结可见名时只要求 title 实际值正确", (t) => {
  const fx = setup(t, { workTitle: "未命名作品·副本" });
  const delta = reconcile({ source: fx.source, batchDb: fx.batchDb });
  assert.equal(delta.work.title_before, "未命名作品·副本");
  assert.equal(delta.work.title_after, "未命名作品·副本");
  assert.deepEqual(delta.work.changed_fields, ["revision", "updated_at"]);
});

test("setup 不得改写引用日志原始行（含 16 字节 UUID 的 SQLite 投影）", (t) => {
  const fx = setup(t);
  const db = new DatabaseSync(fx.batchDb);
  try {
    db.prepare("UPDATE memory_reference_logs SET reference_reason = ? WHERE id = ?").run(
      "被改写的理由",
      REFERENCE_LOG,
    );
  } finally {
    db.close();
  }
  assert.throws(() => reconcile({ source: fx.source, batchDb: fx.batchDb }), /参考行|原始行|引用/);
});

test("业务内容签名排除引用运营列，原始行签名仍保留它们", (t) => {
  const fx = setup(t);
  const snapshot = () =>
    withDb(fx.batchDb, (db) => {
      const canon = contentCanonSnapshot(db, TIME);
      return { raw: contentCanonSha(db), business: businessContentSha(canon) };
    });
  const before = snapshot();
  const db = new DatabaseSync(fx.batchDb);
  try {
    db.prepare(
      "UPDATE memory_items SET reference_count = reference_count + 1, last_referenced_at = ? WHERE id = ?",
    ).run(LATER, MEMORY);
  } finally {
    db.close();
  }
  const after = snapshot();
  assert.equal(after.business, before.business, "引用运营列不应改变业务内容签名");
  assert.notEqual(after.raw, before.raw, "原始行签名必须仍包含引用运营列");
});

test("setup 时间回退必须失败；同一 tick 不进入 changed", (t) => {
  const earlier = "2026-11-11T00:00:00.000000Z";
  {
    const fx = setup(t, { updatedAt: earlier });
    assert.throws(() => reconcile({ source: fx.source, batchDb: fx.batchDb }), /不能回退|不能早于/);
  }
  {
    const fx = setup(t, { updatedAt: TIME });
    const delta = reconcile({ source: fx.source, batchDb: fx.batchDb });
    assert.equal(delta.work.updated_at_before, TIME);
    assert.equal(delta.work.updated_at_after, TIME);
    assert.equal(delta.work.changed_fields.includes("updated_at"), false);
  }
});

test("完整副本 canon 保留章节设计态事实，不退化为 live 摘要", (t) => {
  const fx = setup(t);
  const canon = withDb(fx.source, (db) => contentCanonSnapshot(db, TIME));
  const fact = canon.chapters[CHAPTER];
  assert.equal(fact.seq, 1);
  assert.equal(fact.title, "第01章");
  assert.equal(fact.status, "DRAFTING");
  assert.equal(Object.hasOwn(fact, "approved_sha256"), false);
});

test("快照目录递归创建缺失的中间目录", (t) => {
  const fixture = sourceFixture();
  const source = sourceFile(fixture);
  const leaf = caseLeaf(t, "recursive");
  const outDir = path.join(leaf, "missing", "deeper", "snapshot");
  createCompleteSnapshot({
    outDir,
    fullPath: source,
    frozenPath: source,
    expectedSha256: sha256File(source),
    allowedPrefix: leaf,
  });
  assert.equal(fs.existsSync(path.join(outDir, "manifest.json")), true);
});

test("运行清单只保留真实非空 provider_call_ref，不把 null/空串算调用", (t) => {
  const fixture = sourceFixture();
  withWorkingCopy(
    fixture,
    (copy) => {
      const source = copy.files.get(SOURCE_DB_REL);
      const db = new DatabaseSync(source);
      try {
        db.prepare("INSERT INTO provider_runs VALUES (?,?)").run("pr-null", null);
        db.prepare("INSERT INTO provider_runs VALUES (?,?)").run("pr-empty", "");
        db.prepare("INSERT INTO provider_runs VALUES (?,?)").run("pr-valid", "pcall-valid");
      } finally {
        db.close();
      }
      const snap = snapshotOf(t, source, { label: "provider-refs" });
      assert.deepEqual(snap.manifest.snapshot.run_inventory.provider_call_refs, [
        "pcall-old",
        "pcall-valid",
      ]);
      assert.equal(snap.manifest.snapshot.run_inventory.provider_run_count, 4);
    },
    { scope: runScope, context: t },
  );
});

test("内容 canon 排除 works.updated_at 运营列", (t) => {
  const fx = setup(t);
  const snapshot = () =>
    withDb(fx.batchDb, (db) => ({
      raw: contentCanonSha(db),
      business: businessContentSha(contentCanonSnapshot(db, TIME)),
    }));
  const before = snapshot();
  const db = new DatabaseSync(fx.batchDb);
  try {
    db.prepare("UPDATE works SET updated_at = ? WHERE id = ?").run(
      "2026-11-13T08:00:00.000001Z",
      WORK,
    );
  } finally {
    db.close();
  }
  const after = snapshot();
  assert.equal(after.business, before.business, "works.updated_at 不应改变业务内容签名");
  assert.equal(after.raw, before.raw, "works.updated_at 不应改变内容 canon");
});

test("原始未知枚举值与 16 字节 opaque 引用行原样透传，SUT 不清洗作者源", (t) => {
  const fixture = sourceFixture();
  withWorkingCopy(
    fixture,
    (copy) => {
      const source = copy.files.get(SOURCE_DB_REL);
      const db = new DatabaseSync(source);
      try {
        // 旧 WIP 的非法值仅作为“未知/历史作者源”透传反例，不进入普通投影种子。
        db.prepare("UPDATE drafts SET status = ? WHERE id = ?").run("ADOPTED", DRAFT);
        db.prepare("UPDATE characters SET status = ?, narrative_role = ?, provisional_source = ? WHERE id = ?").run(
          "CONFIRMED",
          "protagonist",
          "model",
          CHARACTER,
        );
        db.prepare("UPDATE memory_items SET type = ?, scope = ?, status = ?, source_type = ? WHERE id = ?").run(
          "fact",
          "work",
          "ACTIVE",
          "author",
          MEMORY,
        );
      } finally {
        db.close();
      }
      const snap = snapshotOf(t, source, { label: "opaque-values" });
      const batchDir = path.join(snap.leaf, "batch");
      restoreSnapshot({ batchDir, snapshotDir: snap.outDir });
      const restored = path.join(batchDir, "database", "ai_novel_studio_test.sqlite3");
      assert.equal(independentSha(restored), independentSha(source), "恢复必须保留源字节");
      const restoredDb = new DatabaseSync(restored, { readOnly: true });
      try {
        assert.equal(
          restoredDb.prepare("SELECT status FROM drafts WHERE id = ?").get(DRAFT).status,
          "ADOPTED",
        );
        const character = restoredDb
          .prepare("SELECT status, narrative_role, provisional_source FROM characters WHERE id = ?")
          .get(CHARACTER);
        // node:sqlite 行对象是 null prototype；显式展开为普通对象后按字段内容比较，
        // 不改变 SUT/生产类型，也不减 opaque 字段断言。
        assert.deepEqual({ ...character }, {
          status: "CONFIRMED",
          narrative_role: "protagonist",
          provisional_source: "model",
        });
        const memory = restoredDb
          .prepare("SELECT type, scope, status, source_type FROM memory_items WHERE id = ?")
          .get(MEMORY);
        assert.deepEqual({ ...memory }, {
          type: "fact",
          scope: "work",
          status: "ACTIVE",
          source_type: "author",
        });
        const blob = restoredDb
          .prepare(
            "SELECT length(CAST(id AS BLOB)) AS bytes FROM memory_reference_logs WHERE lower(hex(id)) = ?",
          )
          .get(BLOB_REFERENCE_LOG_ID);
        assert.equal(Number(blob.bytes), 16, "opaque 引用行必须保留 16 字节外观");
      } finally {
        restoredDb.close();
      }
    },
    { scope: runScope, context: t },
  );
});

test("危险完整源可原样 create 备份，但不能 restore 成可启动 batch", (t) => {
  const fixture = sourceFixture();
  withWorkingCopy(
    fixture,
    (copy) => {
      const source = copy.files.get(SOURCE_DB_REL);
      const db = new DatabaseSync(source);
      try {
        db.prepare("INSERT INTO agent_runs VALUES (?,?)").run("run-durable", "durable");
      } finally {
        db.close();
      }
      const sourceSha = independentSha(source);
      const snap = snapshotOf(t, source, { label: "danger-backup" });
      // create 是完整备份：保留危险 run 与终止 task，源字节/状态不变。
      assert.equal(independentSha(source), sourceSha, "create 不得改写源");
      assert.deepEqual(snap.manifest.snapshot.run_inventory.runs_by_mode, {
        bounded: 1,
        durable: 1,
      });
      assert.deepEqual(snap.manifest.snapshot.run_inventory.long_run_tasks, [
        { id: "task-1", status: "DONE" },
      ]);
      assert.equal(
        independentSha(path.join(snap.outDir, "work.sqlite3")),
        sourceSha,
        "create 必须原样复制完整源，不裁剪危险任务",
      );
      // restore 到 batch DB 是运行入口：同一完整源也不能安装成可启动 batch。
      const batchDir = path.join(snap.leaf, "batch");
      assert.throws(() => restoreSnapshot({ batchDir, snapshotDir: snap.outDir }), /非 bounded/);
      assert.equal(
        fs.existsSync(path.join(batchDir, "database", "ai_novel_studio_test.sqlite3")),
        false,
      );
    },
    { scope: runScope, context: t },
  );
});

test("preflight 以实际 work DB 判断：完整伪空 JSON 不能掩盖 durable run", (t) => {
  const fixture = sourceFixture();
  withWorkingCopy(
    fixture,
    (copy) => {
      const source = copy.files.get(SOURCE_DB_REL);
      const db = new DatabaseSync(source);
      try {
        db.prepare("INSERT INTO agent_runs VALUES (?,?)").run("run-durable", "durable");
      } finally {
        db.close();
      }
      const snap = snapshotOf(t, source, { label: "durable" });
      assert.deepEqual(snap.manifest.snapshot.run_inventory.runs_by_mode, {
        bounded: 1,
        durable: 1,
      });
      // 只改 JSON 声明，DB/字节/hash 都不变；实际预检仍必须拒绝。
      editSnapshotManifest(snap, (raw) => ({
        ...raw,
        snapshot: {
          ...raw.snapshot,
          run_inventory: {
            runs_by_mode: {},
            long_run_tasks: [],
            provider_run_count: 0,
            provider_call_refs: [],
          },
        },
      }));
      assert.throws(() => preflight(snap), /非 bounded/);
    },
    { scope: runScope, context: t },
  );
});

test("preflight 拒绝缺失清单：null/缺字段都是未知，不等于空清单", (t) => {
  const fixture = sourceFixture();
  const snap = snapshotOf(t, sourceFile(fixture), { label: "missing-inventory" });
  editSnapshotManifest(snap, (raw) => ({
    ...raw,
    snapshot: { ...raw.snapshot, run_inventory: null },
  }));
  assert.throws(() => preflight(snap), /运行清单缺失/);
  editSnapshotManifest(snap, (raw) => {
    const next = structuredClone(raw);
    delete next.snapshot.run_inventory;
    return next;
  });
  assert.throws(() => preflight(snap), /运行清单缺失/);
});

test("两处外部 JSON 入口共享清单声明结构边界：v2 中类型篡改必须拒绝", (t) => {
  const fx = setup(t);
  const manifestFile = path.join(fx.outDir, "manifest.json");
  const recordFile = path.join(fx.batchDir, "request-cost-snapshot.json");
  const baseline = {
    manifest: fs.readFileSync(manifestFile, "utf8"),
    record: fs.readFileSync(recordFile, "utf8"),
  };
  assert.equal(readSnapshotManifest(fx.outDir).schema, "b87-r01-source-snapshot/v2");
  assert.equal(readSnapshotRecord(fx.batchDir).schema, "b87-r01-source-snapshot/v2");

  const tamper = (text, key, value) => {
    const raw = JSON.parse(text);
    raw.snapshot.run_inventory[key] = value;
    return `${JSON.stringify(raw, null, 2)}\n`;
  };

  // 两个公开入口委托同一私有解析：用代表性跨入口样本覆盖类型边界，不重复整套矩阵。
  fs.writeFileSync(manifestFile, tamper(baseline.manifest, "runs_by_mode", []));
  assert.throws(() => readSnapshotManifest(fx.outDir), /runs_by_mode/);
  fs.writeFileSync(recordFile, tamper(baseline.record, "runs_by_mode", "bounded"));
  assert.throws(() => readSnapshotRecord(fx.batchDir), /runs_by_mode/);

  fs.writeFileSync(manifestFile, tamper(baseline.manifest, "provider_run_count", 1.5));
  assert.throws(() => readSnapshotManifest(fx.outDir), /provider_run_count/);
  fs.writeFileSync(recordFile, tamper(baseline.record, "provider_run_count", 2.5));
  assert.throws(() => readSnapshotRecord(fx.batchDir), /provider_run_count/);
});

test("preflight 对账声明与实际；结构完整但事实不一致必须拒绝", (t) => {
  const fixture = sourceFixture();
  const snap = snapshotOf(t, sourceFile(fixture), { label: "declaration-mismatch" });
  editSnapshotManifest(snap, (raw) => ({
    ...raw,
    snapshot: {
      ...raw.snapshot,
      run_inventory: {
        ...raw.snapshot.run_inventory,
        long_run_tasks: [{ id: "ghost-task", status: "DONE" }],
      },
    },
  }));
  assert.throws(() => preflight(snap), /不一致/);
});

test("preflight 在关键运行表缺失时直接失败，不回退空清单", (t) => {
  const fixture = sourceFixture();
  const snap = snapshotOf(t, sourceFile(fixture), { label: "missing-table" });
  const workFile = path.join(snap.outDir, "work.sqlite3");
  const db = new DatabaseSync(workFile);
  try {
    db.exec("DROP TABLE agent_runs");
  } finally {
    db.close();
  }
  // 让文件 hash 与声明一致，失败点落在实际清单 SQL，而不是 hash 防护。
  const workSha = independentSha(workFile);
  snap.manifest.snapshot.work_sha256 = workSha;
  editSnapshotManifest(snap, (raw) => ({
    ...raw,
    snapshot: { ...raw.snapshot, work_sha256: workSha },
  }));
  assert.throws(() => preflight(snap), /no such table|agent_runs/);
});

test("真实完整空清单可通过 preflight 与 restore：安全空表实测 0 任务", (t) => {
  const fixture = sourceFixture();
  withWorkingCopy(
    fixture,
    (copy) => {
      const source = copy.files.get(SOURCE_DB_REL);
      const db = new DatabaseSync(source);
      try {
        db.exec("DELETE FROM agent_runs; DELETE FROM long_run_tasks; DELETE FROM provider_runs;");
      } finally {
        db.close();
      }
      const snap = snapshotOf(t, source, { label: "safe-empty" });
      const result = preflight(snap);
      assert.equal(result.ok, true);
      assert.deepEqual(result.inventory, {
        runs_by_mode: {},
        long_run_tasks: [],
        provider_run_count: 0,
        provider_call_refs: [],
      });
      assert.equal(result.work.id, WORK);

      const batchDir = path.join(snap.leaf, "batch");
      const record = restoreSnapshot({ batchDir, snapshotDir: snap.outDir });
      assert.deepEqual(record.snapshot.run_inventory, result.inventory);
      assert.equal(
        fs.existsSync(path.join(batchDir, "database", "ai_novel_studio_test.sqlite3")),
        true,
      );
    },
    { scope: runScope, context: t },
  );
});

test("restore 以实际副本 DB 核对清单：缺清单与声明不一致都在复制前拒绝", (t) => {
  const fixture = sourceFixture();
  const snap = snapshotOf(t, sourceFile(fixture), { label: "restore-inventory" });
  const batchDir = path.join(snap.leaf, "batch");
  const targetDb = path.join(batchDir, "database", "ai_novel_studio_test.sqlite3");

  editSnapshotManifest(snap, (raw) => {
    const next = structuredClone(raw);
    delete next.snapshot.run_inventory;
    return next;
  });
  assert.throws(() => restoreSnapshot({ batchDir, snapshotDir: snap.outDir }), /运行清单缺失/);
  assert.equal(fs.existsSync(targetDb), false, "缺清单拒绝时不得写出 batch DB");

  editSnapshotManifest(snap, (raw) => ({
    ...raw,
    snapshot: {
      ...raw.snapshot,
      run_inventory: {
        runs_by_mode: { bounded: 1 },
        long_run_tasks: [{ id: "task-1", status: "DONE" }],
        provider_run_count: 99,
        provider_call_refs: ["pcall-old"],
      },
    },
  }));
  assert.throws(() => restoreSnapshot({ batchDir, snapshotDir: snap.outDir }), /不一致/);
  assert.equal(fs.existsSync(targetDb), false, "声明不一致拒绝时不得写出 batch DB");
});
