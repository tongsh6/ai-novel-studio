// B71 采集边界：before-revision 只在修订 journey、source 完成且动作前登记一次，
// 并与其他 run checkpoint 一样保留真实只读 DB canon 快照。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { capture, prepare, readConfig } from "./authoring_capture_evidence.mjs";
import { pendingSourceMessage } from "./authoring_pending_evidence.mjs";

const WORK = "22222222-2222-4222-8222-222222222222";
const CHAPTER = "77777777-7777-4777-8777-777777777777";
const AT = "2026-11-02T06:14:42.000000Z";

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
}

function createDb(dir, { duplicateWork = false } = {}) {
  fs.mkdirSync(path.join(dir, "database"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  db.exec(`
    CREATE TABLE works (id TEXT${duplicateWork ? "" : " PRIMARY KEY"}, title TEXT);
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
  `);
  db.prepare("INSERT INTO works (id, title) VALUES (?, ?)").run(WORK, "测试作品");
  if (duplicateWork) db.prepare("INSERT INTO works (id, title) VALUES (?, ?)").run(WORK, "重复作品");
  db.prepare(
    "INSERT INTO chapters (id, work_id, title, seq, status, inserted_at, updated_at, summary, plan_direction) " +
    "VALUES (?, ?, ?, 2, 'PLANNED', ?, ?, '章摘要', ?)",
  ).run(CHAPTER, WORK, "第02章：矿区追击战", AT, AT, JSON.stringify({ chapter_role: "动作章" }));
  db.close();
}

function batch(journey = "revision", { duplicateWork = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-capture-"));
  createDb(dir, { duplicateWork });
  writeJson(dir, "native-b71-config.json", { journey });
  return dir;
}

function prepareBatch(journey = "revision", options = {}) {
  const dir = batch(journey, options);
  fs.rmSync(path.join(dir, "native-b71-config.json"));
  return dir;
}

function ready(dir, sliceId = "b71-authoring-revision") {
  writeJson(dir, "native-driver-ready.json", { slice_id: sliceId, provider: "slice_verify" });
}

function seed(dir, workId = WORK) {
  fs.writeFileSync(path.join(dir, "seed.log"), `run_ref=run-1 work_id=${workId}\n`);
}

test("before-revision 为修订批次登记一次独立 checkpoint，含真实 canon 章设计态见证", () => {
  const dir = batch();
  try {
    capture(dir, "start");
    capture(dir, "before-revision");
    const value = JSON.parse(fs.readFileSync(path.join(dir, "b71-before-revision.json"), "utf8"));
    assert.equal(value.checkpoint, "before-revision");
    assert.equal(value.db_production_counts.chapters, 1);
    assert.equal(value.authoring_canon.version, 2);
    assert.equal(value.authoring_canon.chapters[CHAPTER].title, "第02章：矿区追击战");
    assert.deepEqual(value.authoring_canon.chapters[CHAPTER].mission, null);
    assert.match(value.authoring_canon.chapters[CHAPTER].protected_sha256, /^[0-9a-f]{64}$/);
    assert.throws(() => capture(dir, "before-revision"), /证据不得覆盖/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pending prepare 从 seed 取 work/session，并生成带 nonce 的原作者输入", () => {
  const dir = prepareBatch("pending");
  try {
    ready(dir, "b71-authoring-pending");
    fs.writeFileSync(
      path.join(dir, "seed.log"),
      `run_ref=run-1 work_id=${WORK} session_id=88888888-8888-4888-8888-888888888888\n`,
    );
    prepare(dir);
    const config = readConfig(dir);
    assert.equal(config.journey, "pending");
    assert.equal(config.target.work_id, WORK);
    assert.equal(config.target.session_id, "88888888-8888-4888-8888-888888888888");
    assert.match(config.nonce, /^[0-9a-f]{16}$/);
    assert.equal(config.message, pendingSourceMessage(config.nonce));
    assert.equal(config.revision_message, "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。");
    assert.equal(config.followup_message, "资料处理进度怎么样？");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("planning start 仍写 canon 快照；before-revision 不属于非修订 journey", () => {
  const planning = batch("planning");
  try {
    capture(planning, "start");
    const value = JSON.parse(fs.readFileSync(path.join(planning, "b71-start.json"), "utf8"));
    assert.equal(value.authoring_canon.version, 2);
  } finally {
    fs.rmSync(planning, { recursive: true, force: true });
  }
});

test("before-revision 不属于非修订 journey，也不接受未知 checkpoint", () => {
  for (const journey of ["planning", "continuation", "character-design"]) {
    const dir = batch(journey);
    try {
      assert.throws(() => capture(dir, "before-revision"), /只属于修订批次/);
      assert.equal(fs.existsSync(path.join(dir, "b71-before-revision.json")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const revision = batch();
  try {
    assert.throws(() => capture(revision, "middle"), /未知 checkpoint/);
  } finally {
    fs.rmSync(revision, { recursive: true, force: true });
  }
});


test("prepare 为修订批次写出空聊天文案、明确章标题、目标作品与生产指纹", () => {
  const dir = prepareBatch("revision");
  ready(dir);
  seed(dir);
  try {
    prepare(dir);
    const config = readConfig(dir);
    assert.equal(config.slice_id, "b71-authoring-revision");
    assert.equal(config.journey, "revision");
    assert.equal(config.message, "");
    assert.equal(config.chapter_title, "第02章：矿区追击战");
    assert.deepEqual(config.target, { work_id: WORK, work_title: "测试作品" });
    const before = JSON.parse(fs.readFileSync(path.join(dir, "production-sources-before.json"), "utf8"));
    assert.match(before.head, /^[0-9a-f]{40}$/);
    assert.ok(before.file_count > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("prepare 为其它 journey 写各自真实聊天文案且不带修订章标题", () => {
  const cases = [
    ["b71-first-consumer", "full-read", "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。"],
    ["b71-authoring-transcript", "continuation", "先写第01章正文草稿，再做质量复核；这是一项可恢复的长任务。"],
    ["b71-authoring-profiles", "character-design", "先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派；这是一项可恢复的长任务。"],
    ["b71-authoring-planning", "planning", "请按先核对再补齐计划设计一个角色，再设计相关世界设定；这是一项可恢复的长任务。"],
  ];
  for (const [sliceId, journey, message] of cases) {
    const dir = prepareBatch(journey);
    ready(dir, sliceId);
    seed(dir);
    try {
      prepare(dir);
      const config = readConfig(dir);
      assert.equal(config.journey, journey);
      assert.equal(config.message, message);
      assert.equal(Object.hasOwn(config, "chapter_title"), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("prepare 在目标作品缺失、重名或 ready slice 未知时失败且不写配置", () => {
  const missing = prepareBatch();
  ready(missing);
  seed(missing, "99999999-9999-4999-8999-999999999999");
  try {
    assert.throws(() => prepare(missing), /seed 作品不存在/);
    assert.equal(fs.existsSync(path.join(missing, "native-b71-config.json")), false);
    assert.equal(fs.existsSync(path.join(missing, "production-sources-before.json")), false);
  } finally {
    fs.rmSync(missing, { recursive: true, force: true });
  }

  const duplicate = prepareBatch("revision", { duplicateWork: true });
  ready(duplicate);
  seed(duplicate);
  try {
    assert.throws(() => prepare(duplicate), /seed 作品不存在/);
    assert.equal(fs.existsSync(path.join(duplicate, "production-sources-before.json")), false);
  } finally {
    fs.rmSync(duplicate, { recursive: true, force: true });
  }

  const unknown = prepareBatch();
  ready(unknown, "b71-unknown");
  seed(unknown);
  try {
    assert.throws(() => prepare(unknown), /未知原生 slice/);
    assert.equal(fs.existsSync(path.join(unknown, "production-sources-before.json")), false);
  } finally {
    fs.rmSync(unknown, { recursive: true, force: true });
  }
});
