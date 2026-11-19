// B87 R01 快照/恢复 IO 边界：只做冻结 full 的路径与 SHA 防护、SQLite 一致性完整复制、
// 副本字节镜像、canon 内容签名、运行清单与恢复。不做作品裁剪/keep-set，不实现通用
// 备份框架；其它作品与真实引用关系是背景数据，必须原样保留。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { sha256Hex, stableJson } from "./request_cost_evidence.mjs";
import {
  CANON_TABLES,
  buildAuthoringCanonSnapshot,
  compareAuthoringCanonSnapshots,
} from "./authoring_canon_evidence.mjs";
import { referenceLogRows } from "./reference_log_evidence.mjs";

export const SNAPSHOT_SCHEMA = "b87-r01-source-snapshot/v2";
export const FROZEN_FULL = "artifacts/model-contracts/b87-r01/20261113/source-snapshot/20261113-real-v2/full.sqlite3";
export const FROZEN_FULL_SHA256 = "c5732f99ca320ad526069d8b578162265eac1e481ba8d15e24760e8657a559db";
const SNAPSHOT_PREFIX = "artifacts/model-contracts/b87-r01/20261113/source-snapshot/";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

// 运营时间不是作品内容：打开作品会 touch works.updated_at，批次间也没有同一时刻。
// 内容权威只比较 canon 表，且对 works 仅排除 updated_at；setup 的 title/revision
// 变化由 reconcileSetupDelta 单独按声明字段核对，不能靠归一化掩盖。
const CONTENT_PROJECTION = Object.freeze({ works: Object.freeze(["updated_at"]) });
const SETUP_WORK_FIELDS = Object.freeze(["title", "revision", "updated_at"]);

const tableExists = (db, table) =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?")
      .get(table),
  );

const tableNames = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => row.name);

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function normalize(value) {
  if (value instanceof Uint8Array) return { $blob: Buffer.from(value).toString("hex") };
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

function projectedRows(table, rows) {
  const fields = CONTENT_PROJECTION[table] ?? [];
  if (fields.length === 0) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) delete copy[field];
    return copy;
  });
}

function tableRows(db, table) {
  return tableExists(db, table) ? all(db, `SELECT * FROM "${table}"`) : [];
}

function canonTables(db) {
  return Object.fromEntries(
    CANON_TABLES.map((table) => [table, projectedRows(table, tableRows(db, table))]),
  );
}

// 原始行签名：包含 rows_sha256（memory 运营列也在内），只用于快照/恢复身份，
// 不能拿它判断运行期业务内容是否变化。
function canonicalContentSha(canonSnapshot) {
  return sha256Hex(stableJson(canonSnapshot.tables));
}

// canon 业务内容签名：只取每张 canon 表的 row_count + canon_sha256。canon_sha256 已按
// BOOKKEEPING_COLUMNS 排除 memory 的 reference_count/last_referenced_at 和 works.updated_at，
// 因此正常运行期引用记账变化不会冒充作品内容变化。不含 at/报告时间，可独立复算。
export function businessContentSha(canonSnapshot) {
  const business = Object.fromEntries(
    CANON_TABLES.map((table) => [
      table,
      {
        row_count: canonSnapshot.tables[table].row_count,
        canon_sha256: canonSnapshot.tables[table].canon_sha256,
      },
    ]),
  );
  return sha256Hex(stableJson(business));
}

// 成本快照只需内容签名，不把使命设计字段齐全作为复制条件；完整设计解析仍由其 owner 默认执行。
// 复用现役 CANON_TABLES/buildAuthoringCanonSnapshot；引用日志经唯一无损读取边界进入，不能丢证。
function contentCanon(db, at = new Date().toISOString()) {
  return buildAuthoringCanonSnapshot({
    tables: canonTables(db),
    referenceLogs: referenceLogRows(db),
    at,
    includeChapterFacts: false,
  });
}

export function contentCanonSnapshot(db, at = new Date().toISOString()) {
  return contentCanon(db, at);
}

export function contentCanonSha(db) {
  return canonicalContentSha(contentCanon(db));
}

export function businessContentCanonSha(db, at = new Date().toISOString()) {
  return businessContentSha(contentCanon(db, at));
}

// 引用日志原始行签名：只做 SQLite 16 字节 -> hex 的无损投影，保留其余列；
// 与 canon 解析后的引用记账、作品业务内容签名分开。
export function referenceLogsSignature(db) {
  const rows = referenceLogRows(db);
  return {
    count: rows.length,
    sha256: sha256Hex(stableJson(normalize(rows))),
  };
}

export function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// 冻结 full 的唯一路径准入规则：只做规范化与路径等值，不触达文件系统。完整校验
// （存在性/符号链接/SHA/WAL）与 rebuildSnapshot 的读前拒绝共用这一处，避免复制判断。
export function assertFrozenFullPath(fullPath, frozenPath = FROZEN_FULL) {
  const full = path.resolve(fullPath);
  assert.equal(full, path.resolve(ROOT, frozenPath), "快照源固定为 v2 只读 full.sqlite3");
  return full;
}

function assertFrozenFull(fullPath, expectedSha256, frozenPath = FROZEN_FULL) {
  const full = assertFrozenFullPath(fullPath, frozenPath);
  assert(fs.existsSync(full), "快照源不存在");
  assert(!fs.lstatSync(full).isSymbolicLink(), "快照源不能是符号链接");
  assert.equal(sha256File(full), expectedSha256, "快照源 full hash 不符");
  const wal = `${full}-wal`;
  const walSize = fs.existsSync(wal) ? fs.statSync(wal).size : 0;
  assert.equal(walSize, 0, "快照源存在未 checkpoint 的 WAL，拒绝复制不一致状态");
  return full;
}

function snapshotPaths({ outDir, allowedPrefix }) {
  const target = path.resolve(outDir);
  assert(
    target.startsWith(`${path.resolve(ROOT, allowedPrefix)}${path.sep}`),
    `快照目录必须在 ${allowedPrefix} 下`,
  );
  assert(!fs.existsSync(target), "快照目录必须不存在，拒绝覆盖");
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  return {
    target,
    full: path.join(target, "full.sqlite3"),
    work: path.join(target, "work.sqlite3"),
  };
}

// 实际运行清单的唯一 SQL 读取入口：agent_runs/long_run_tasks/provider_runs 是当前
// 完整快照安全判断的必要运行表。缺表直接让 SQLite 报错，不用 [] 冒充“已观察空表”；
// 未知不等于空，不能把缺证闭合为内部安全值域。
export function readRunInventory(db) {
  const runs = all(db, "SELECT run_mode, COUNT(*) AS n FROM agent_runs GROUP BY run_mode");
  const tasks = all(db, "SELECT id, status FROM long_run_tasks ORDER BY id");
  const providerRuns = all(db, "SELECT id, provider_call_ref FROM provider_runs ORDER BY id");
  return {
    runs_by_mode: Object.fromEntries(runs.map((row) => [row.run_mode, Number(row.n)])),
    long_run_tasks: tasks.map((row) => ({ id: row.id, status: row.status })),
    provider_run_count: providerRuns.length,
    provider_call_refs: providerRuns
      .map((row) => row.provider_call_ref)
      .filter((ref) => typeof ref === "string" && ref !== "")
      .sort(),
  };
}

// 外部 JSON 运行清单声明的唯一结构校验：manifest/恢复记录读取边界共用。它只证明
// 落盘声明符合完整清单的类型要求，不声称已观察 DB；实际事实仍来自 readRunInventory。
// 缺记录是真实可达输入，内部消费者信任已解析事实，不再逐处重验 shape。
function assertRunInventoryDeclaration(inventory) {
  assert(
    inventory !== null && typeof inventory === "object" && !Array.isArray(inventory),
    "运行清单缺失：缺失/未知不等于已观察到的空清单",
  );
  assert(
    inventory.runs_by_mode !== null &&
      typeof inventory.runs_by_mode === "object" &&
      !Array.isArray(inventory.runs_by_mode),
    "运行清单缺少 runs_by_mode",
  );
  assert(Array.isArray(inventory.long_run_tasks), "运行清单缺少 long_run_tasks");
  assert(
    Number.isInteger(inventory.provider_run_count) && inventory.provider_run_count >= 0,
    "运行清单缺少 provider_run_count",
  );
  assert(Array.isArray(inventory.provider_call_refs), "运行清单缺少 provider_call_refs");
  return inventory;
}

// 声明与实际的事实对账：双方都已在各自边界解析；这里只比较内容并返回实际事实。
export function assertRunInventoryMatches(actual, declared) {
  assert.deepEqual(declared, actual, "运行清单声明与数据库事实不一致");
  return actual;
}

// 安全目标不是“当前行数恰好是多少”，而是“启动后不会意外恢复/调用旧任务”。
// - bounded run 不进入 durable 恢复路径，任意数量（含 0）都可接受；
// - 任何非 bounded run_mode 都可能被恢复执行，本批明确拒绝（未知即危险，不猜）；
// - long_run_tasks 只有产品定义的终止态是安全的，0 个或任意多个终止任务都可接受；
// - 非终止/未知状态必须拒绝，不能改原状态伪造安全。实际是否发生调用仍由启动观察判据证明。
const TERMINAL_LONG_RUN_STATUSES = Object.freeze(new Set(["DONE", "CANCELLED", "ERROR"]));

function nonBoundedModes(modeCounts) {
  return Object.entries(modeCounts)
    .filter(([mode, count]) => mode !== "bounded" && Number(count) > 0)
    .map(([mode]) => mode);
}

function assertTerminalLongRunTasks(tasks) {
  for (const task of tasks) {
    assert(
      TERMINAL_LONG_RUN_STATUSES.has(task.status),
      `long_run_task(${task.id ?? "?"}) 非终止状态，可能被恢复: ${task.status}`,
    );
  }
}

// 纯安全规则只消费它真正需要的两个已观察字段；provider 清单不参与安全判断，
// 不在本函数重复解析/校验。JSON 结构边界见 assertRunInventoryDeclaration。
export function assertSnapshotRunInventory(inventory) {
  const modeCounts = inventory.runs_by_mode;
  assert.deepEqual(
    nonBoundedModes(modeCounts),
    [],
    "存在非 bounded run，可能被恢复执行",
  );
  const tasks = inventory.long_run_tasks;
  assertTerminalLongRunTasks(tasks);
  return {
    bounded_runs: Number(modeCounts.bounded ?? 0),
    long_run_tasks: tasks,
    long_run_task_count: tasks.length,
  };
}

export function createCompleteSnapshot({
  outDir,
  fullPath = FROZEN_FULL,
  frozenPath = FROZEN_FULL,
  expectedSha256 = FROZEN_FULL_SHA256,
  allowedPrefix = SNAPSHOT_PREFIX,
  provenance = null,
} = {}) {
  const full = assertFrozenFull(fullPath, expectedSha256, frozenPath);
  const paths = snapshotPaths({ outDir, allowedPrefix });
  // 源 WAL 已确认 checkpoint 且只读；字节复制是完整副本最直接的证明，任何裁剪/漏行
  // 都会让 source/full/work 三者 hash 分离。
  fs.copyFileSync(full, paths.full, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(paths.full, 0o600);
  fs.copyFileSync(paths.full, paths.work, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(paths.work, 0o600);
  assert.equal(sha256File(paths.full), sha256File(paths.work), "快照 full/work 不是字节一致镜像");
  assert.equal(sha256File(paths.full), expectedSha256, "快照 full 与冻结源不是字节一致副本");

  const db = new DatabaseSync(paths.full, { readOnly: true });
  let canon;
  let inventory;
  let tableCounts;
  let referenceLogs;
  try {
    canon = contentCanon(db);
    inventory = readRunInventory(db);
    referenceLogs = referenceLogsSignature(db);
    tableCounts = Object.fromEntries(
      tableNames(db).map((table) => [table, Number(all(db, `SELECT COUNT(*) AS n FROM "${table}"`)[0].n)]),
    );
  } finally {
    db.close();
  }
  const manifest = {
    schema: SNAPSHOT_SCHEMA,
    source: {
      path: path.relative(ROOT, full),
      sha256: expectedSha256,
      captured_at: new Date().toISOString(),
    },
    provenance,
    snapshot: {
      dir: path.relative(ROOT, paths.target),
      full_sha256: sha256File(paths.full),
      work_sha256: sha256File(paths.work),
      content_sha256: canonicalContentSha(canon),
      business_content_sha256: businessContentSha(canon),
      reference_logs: referenceLogs,
      canon,
      table_counts: tableCounts,
      run_inventory: inventory,
    },
    captured_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(paths.target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  return manifest;
}

// manifest.json 与 request-cost-snapshot.json 是同一 schema/清单声明形状的两个文件
// 位置：存在性、JSON 解析、schema 与清单声明结构只在本私有入口校验一次；两个公开
// 入口各自保留文件定位和既有可识别错误消息。缺记录是真实可达输入。
function readSnapshotJson(file, label) {
  assert(fs.existsSync(file), `${label} 缺失`);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(payload.schema, SNAPSHOT_SCHEMA, `${label} schema 不符`);
  assertRunInventoryDeclaration(payload.snapshot?.run_inventory);
  return payload;
}

// 快照 manifest 的唯一 JSON 入口（restore 与 capture.preflight 共用）。
export function readSnapshotManifest(snapshotDir) {
  return readSnapshotJson(
    path.join(path.resolve(snapshotDir), "manifest.json"),
    "快照 manifest",
  );
}

function walSize(file) {
  const wal = `${file}-wal`;
  return fs.existsSync(wal) ? fs.statSync(wal).size : 0;
}

function verifySnapshotFiles(snapshotDir, manifest) {
  const dir = path.resolve(snapshotDir);
  const fullFile = path.join(dir, "full.sqlite3");
  const workFile = path.join(dir, "work.sqlite3");
  for (const file of [fullFile, workFile]) {
    assert(fs.existsSync(file), `快照文件缺失: ${path.basename(file)}`);
    assert(!fs.lstatSync(file).isSymbolicLink(), "快照文件不能是符号链接");
    assert.equal(walSize(file), 0, `快照文件存在未 checkpoint 的 WAL: ${path.basename(file)}`);
  }
  assert.equal(sha256File(workFile), manifest.snapshot.work_sha256, "快照 work hash 不符");
  assert.equal(sha256File(fullFile), manifest.snapshot.full_sha256, "快照 full hash 不符");
  assert.equal(manifest.snapshot.full_sha256, manifest.snapshot.work_sha256, "快照 full/work 不是字节一致镜像");
  return { fullFile, workFile };
}

export function restoreSnapshot({ batchDir, snapshotDir }) {
  const manifest = readSnapshotManifest(snapshotDir);
  const declaredInventory = manifest.snapshot.run_inventory;
  const { workFile } = verifySnapshotFiles(snapshotDir, manifest);
  const db = new DatabaseSync(workFile, { readOnly: true });
  let canonSha;
  let businessSha;
  let referenceLogs;
  let counts;
  try {
    canonSha = contentCanonSha(db);
    businessSha = businessContentCanonSha(db);
    referenceLogs = referenceLogsSignature(db);
    // restore 到 batch DB 是现有运行入口：复制前同时核对实际清单安全与 metadata
    // 一致。createCompleteSnapshot 则是完整备份，允许原样包含危险任务、不改状态；
    // 两者职责分开，不靠裁剪源制造安全。
    const actualInventory = readRunInventory(db);
    assertSnapshotRunInventory(actualInventory);
    assertRunInventoryMatches(actualInventory, declaredInventory);
    counts = Object.fromEntries(
      tableNames(db).map((table) => [table, Number(all(db, `SELECT COUNT(*) AS n FROM "${table}"`)[0].n)]),
    );
  } finally {
    db.close();
  }
  assert.equal(canonSha, manifest.snapshot.content_sha256, "快照 canon 内容 hash 不符");
  if (manifest.snapshot.business_content_sha256) {
    assert.equal(
      businessSha,
      manifest.snapshot.business_content_sha256,
      "快照业务内容 hash 不符",
    );
  }
  if (manifest.snapshot.reference_logs) {
    assert.deepEqual(referenceLogs, manifest.snapshot.reference_logs, "快照引用日志原始行签名不符");
  }
  assert.deepEqual(counts, manifest.snapshot.table_counts, "快照表行数不符");
  const targetDb = path.join(batchDir, "database", "ai_novel_studio_test.sqlite3");
  assert(!fs.existsSync(targetDb), "批次数据库已存在，拒绝覆盖");
  fs.mkdirSync(path.dirname(targetDb), { recursive: true });
  fs.copyFileSync(workFile, targetDb, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(targetDb, 0o600);
  // 旧快照 manifest 可能没有业务内容签名；记录里必须补上当前完整副本的实际值，
  // 供 prepare 与冻结候选对账，但不改写旧快照 manifest 本身。
  const restoredManifest = {
    ...manifest,
    snapshot: {
      ...manifest.snapshot,
      business_content_sha256: businessSha,
      reference_logs: referenceLogs,
    },
  };
  writeSnapshotRecord({ batchDir, manifest: restoredManifest, restoredDb: targetDb });
  return restoredManifest;
}

function writeSnapshotRecord({ batchDir, manifest, restoredDb }) {
  fs.writeFileSync(
    path.join(batchDir, "request-cost-snapshot.json"),
    `${JSON.stringify(
      {
        schema: SNAPSHOT_SCHEMA,
        source: manifest.source,
        snapshot: manifest.snapshot,
        restored_at: new Date().toISOString(),
        restored_sha256: sha256File(restoredDb),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

export function readSnapshotRecord(batchDir) {
  return readSnapshotJson(
    path.join(batchDir, "request-cost-snapshot.json"),
    "request-cost-snapshot.json",
  );
}

function sameValue(left, right) {
  return stableJson(normalize(left)) === stableJson(normalize(right));
}

function diffFields(before, after) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.filter((key) => !sameValue(before[key], after[key]));
}

function workRow(db, workId) {
  const rows = tableRows(db, "works").filter((row) => row.id === workId);
  assert.equal(rows.length, 1, "对账目标作品必须恰好一行");
  return rows[0];
}

function sessionsOf(db, workId) {
  return tableRows(db, "work_sessions").filter((row) => row.work_id === workId);
}

function projectWorksRow(tables, workId, sourceWork) {
  const existing = tables.works ?? [];
  return {
    ...tables,
    works: existing.map((row) => {
      if (row.id !== workId) return row;
      const copy = { ...row };
      for (const field of SETUP_WORK_FIELDS) {
        if (Object.hasOwn(copy, field)) copy[field] = sourceWork[field];
      }
      return copy;
    }),
  };
}

function assertSessionDelta({ sourceDb, afterDb, workId, expectedSession, seed }) {
  const before = sessionsOf(sourceDb, workId);
  const after = sessionsOf(afterDb, workId);
  const beforeById = new Map(before.map((row) => [row.id, row]));
  const afterById = new Map(after.map((row) => [row.id, row]));
  const removed = before.filter((row) => !afterById.has(row.id));
  assert.equal(removed.length, 0, `setup 不得删除旧 session: ${removed.map((row) => row.id).join(",")}`);
  assert.equal(after.length, before.length + 1, "setup 必须恰好新增一个 session");
  const added = after.filter((row) => !beforeById.has(row.id));
  assert.equal(added.length, 1, "setup 新增 session 不唯一");
  const newSession = added[0];
  assert.equal(newSession.id, expectedSession, "seed session_id 与实际新增 session 不一致");
  assert.equal(newSession.status, "ACTIVE", "新 session 必须是 ACTIVE");
  assert.equal(newSession.work_id, workId, "新 session work 不一致");
  assert.equal(newSession.title, seed.session_title, "新 session 标题与冻结值不一致");
  for (const [id, row] of beforeById) {
    const current = afterById.get(id);
    assert(current, `setup 不得删除旧 session: ${id}`);
    const changed = diffFields(row, current);
    if (row.status === "ACTIVE") {
      assert(
        changed.every((field) => ["status", "updated_at"].includes(field)),
        "旧 ACTIVE session 只允许退出与运营时间变化",
      );
      assert.equal(current.status, "EXITED", "旧 ACTIVE session 必须退出");
      if (changed.includes("updated_at")) {
        assert(
          String(current.updated_at) >= String(row.updated_at),
          "旧 ACTIVE session 的 updated_at 不能回退",
        );
      }
    } else {
      assert.deepEqual(changed, [], `旧 session(${id}) 不得在 setup 改变`);
    }
  }
  const otherWorkBefore = tableRows(sourceDb, "work_sessions").filter((row) => row.work_id !== workId);
  const otherWorkAfter = tableRows(afterDb, "work_sessions").filter((row) => row.work_id !== workId);
  assert.equal(
    sha256Hex(stableJson(normalize(otherWorkBefore))),
    sha256Hex(stableJson(normalize(otherWorkAfter))),
    "setup 不得改变其它作品的 session",
  );
  return {
    work_id: workId,
    old_session_ids: before.map((row) => row.id).sort(),
    new_session_id: newSession.id,
    exited_session_ids: before.filter((row) => row.status === "ACTIVE").map((row) => row.id).sort(),
    other_work_sessions_sha256: sha256Hex(stableJson(normalize(otherWorkAfter))),
  };
}

function assertWorkDelta({ sourceDb, afterDb, workId, seed }) {
  const before = workRow(sourceDb, workId);
  const after = workRow(afterDb, workId);
  const changed = diffFields(before, after).sort();
  // 只允许声明集合内的字段变化；不要求运营时钟一定变化（同一 tick 合法）。
  assert(
    changed.every((field) => SETUP_WORK_FIELDS.includes(field)),
    "setup 只允许改变 title/revision/updated_at",
  );
  // 必须的声明效果直接检验，而不是靠 changed 集合反推。
  assert.equal(after.title, seed.title, "目标作品可见名与冻结值不一致");
  assert.equal(Number(after.revision), Number(before.revision) + 1, "rename 必须把 revision 加一");
  if (changed.includes("updated_at")) {
    assert(
      String(after.updated_at) >= String(before.updated_at),
      "rename 的 updated_at 不能早于源值",
    );
  }
  return {
    work_id: workId,
    title_before: before.title,
    title_after: after.title,
    revision_before: Number(before.revision),
    revision_after: Number(after.revision),
    updated_at_before: before.updated_at,
    updated_at_after: after.updated_at,
    changed_fields: changed,
  };
}

// setup 独立对账：目标 works 只允许 title/revision/updated_at，且 actual 值必须与
// 冻结 seed 声明一致；其余 canon 表在把目标 works 三个声明字段还原为源值后，必须与
// 源 canon 逐表一致（使用现役 compareAuthoringCanonSnapshots）。session 变化单列。
export function reconcileSetupDelta({
  sourceDb,
  afterDb,
  workId,
  seed,
  sourceAt = new Date().toISOString(),
  afterAt = new Date().toISOString(),
}) {
  assert.equal(workId, seed.work_id, "对账 work_id 与冻结 seed 不一致");
  const work = assertWorkDelta({ sourceDb, afterDb, workId, seed });
  const session = assertSessionDelta({
    sourceDb,
    afterDb,
    workId,
    expectedSession: seed.session_id,
    seed,
  });
  // 原始引用行（含 16 字节 UUID 的 SQLite 无损投影）必须逐行不变；这是 setup 的
  // 原始行签名，和纯 canon/business 内容签名分开。
  const sourceReferenceLogs = referenceLogRows(sourceDb);
  const afterReferenceLogs = referenceLogRows(afterDb);
  const sourceReferenceSha = sha256Hex(stableJson(normalize(sourceReferenceLogs)));
  const afterReferenceSha = sha256Hex(stableJson(normalize(afterReferenceLogs)));
  assert.equal(afterReferenceSha, sourceReferenceSha, "setup 不得改变 memory_reference_logs 原始行");
  const beforeTables = canonTables(sourceDb);
  const afterTables = projectWorksRow(canonTables(afterDb), workId, workRow(sourceDb, workId));
  const beforeCanon = buildAuthoringCanonSnapshot({
    tables: beforeTables,
    referenceLogs: sourceReferenceLogs,
    at: sourceAt,
    includeChapterFacts: false,
  });
  const afterCanon = buildAuthoringCanonSnapshot({
    tables: afterTables,
    referenceLogs: afterReferenceLogs,
    at: afterAt,
    includeChapterFacts: false,
  });
  const comparison = compareAuthoringCanonSnapshots(beforeCanon, afterCanon);
  assert.equal(comparison.checks.no_canon_write, true, "setup 改变了声明字段以外的作品内容");
  assert.equal(
    comparison.checks.memory_reference_updates_accounted,
    true,
    "setup 产生了未声明的 memory 引用变化",
  );
  const projectedSha = businessContentSha(afterCanon);
  const sourceSha = businessContentSha(beforeCanon);
  assert.equal(projectedSha, sourceSha, "setup 后投影业务内容与源内容不一致");
  // 原始 setup 后 canon（works.updated_at 已被现役 canon 排除）跨批次应一致；
  // title/revision 是声明变化，session 不在 canon 中。业务内容签名不含引用运营列。
  const rawAfterCanon = buildAuthoringCanonSnapshot({
    tables: canonTables(afterDb),
    referenceLogs: afterReferenceLogs,
    at: afterAt,
    includeChapterFacts: false,
  });
  return {
    work,
    session,
    content_sha256: businessContentSha(rawAfterCanon),
    source_content_sha256: sourceSha,
    projected_content_sha256: projectedSha,
    reference_logs_sha256: afterReferenceSha,
    source_reference_logs_sha256: sourceReferenceSha,
    reference_logs_count: afterReferenceLogs.length,
    compared_tables: CANON_TABLES.length,
    projection: { works: [...CONTENT_PROJECTION.works] },
  };
}
