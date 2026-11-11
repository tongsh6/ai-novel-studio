// B71 采集边界：before-revision 只在修订 journey、source 完成且动作前登记一次，
// 并与其他 run checkpoint 一样保留真实只读 DB canon 快照。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  capture,
  prepare,
  readConfig,
  validatePreregistrationFile,
} from "./authoring_capture_evidence.mjs";
import { pendingSourceMessage } from "./authoring_pending_evidence.mjs";
import { shaFile } from "./scenario_evidence.mjs";

const WORK = "22222222-2222-4222-8222-222222222222";
const SESSION = "88888888-8888-4888-8888-888888888888";
const CHAPTER = "77777777-7777-4777-8777-777777777777";
const AT = "2026-11-02T06:14:42.000000Z";
const DEFAULT_LIVE_MESSAGE =
  "先看看第01章现在的设定和正文，再按现有设定写一段更紧张的开场：主角在雨夜收到一封没有署名的信，生成待采纳的候选，先不要保存。";
const G2_MESSAGE =
  "请先读第02章《灰烬中的手印》已经保存的正文，前后都核对一下，再把发现的重复写法改成一段候选给我看，先不要保存。";
const G2_VISIBLE_TARGET = Object.freeze({
  work_title: "灰烬手印验证作品",
  chapter_title: "灰烬中的手印",
  reading_excerpt: "井底浮现第七枚手印",
});
const LIVE_MODEL = process.env.B71_STRATA_MODEL || "iq3_s";

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

function liveReady(dir) {
  writeJson(dir, "native-driver-ready.json", { slice_id: "b71-first-consumer", provider: "strata" });
}

function seedLive(dir) {
  fs.writeFileSync(
    path.join(dir, "seed.log"),
    `run_ref=run-1 work_id=${WORK} session_id=${SESSION}\n`,
  );
}

// B82 作者可见批次不建应用 DB；prepare 的 runner seed 边界仍要 work/session，
// 这里用占位身份，作品只从封存的作者可见目标来，不注入应用域 ID。
function visibleBatch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "b71-capture-visible-"));
}

function seedVisibleBoundary(dir) {
  fs.writeFileSync(path.join(dir, "seed.log"), "run_ref=run-1 work_id=seed-work session_id=seed-session\n");
}

// 直接按封存预注册构造 live 配置：target 只含作者可见 title，不写 DB/work/session 身份。
function writeVisibleConfig(dir) {
  const record = validatePreregistrationFile(path.join(dir, "preregistration.json"), { dir });
  writeJson(dir, "native-b71-config.json", {
    slice_id: "b71-first-consumer",
    journey: "live",
    provider: "strata",
    target: { work_title: G2_VISIBLE_TARGET.work_title },
    author_visible_target: G2_VISIBLE_TARGET,
    preregistration: { id: record.id, sha256: record.sha256, model: LIVE_MODEL },
    message: G2_MESSAGE,
  });
  return record;
}

function preregistration(
  dir,
  {
    message = G2_MESSAGE,
    model = LIVE_MODEL,
    evidenceDir = dir,
    extraScenario = false,
    authorVisibleTarget = G2_VISIBLE_TARGET,
  } = {},
) {
  const scenario = {
    id: "b82-g2",
    ...(authorVisibleTarget ? { author_visible_target: authorVisibleTarget } : {}),
    message,
    evidence: { dir: evidenceDir },
  };
  writeJson(dir, "preregistration.json", {
    id: "b82-g2-live-test",
    model: { provider: "strata", model },
    scenarios: extraScenario ? [scenario, { ...scenario, id: "b82-g2-extra" }] : [scenario],
  });
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

test("普通 live 批次按冻结预注册副本取作者输入并保留 id/hash", () => {
  const dir = visibleBatch();
  try {
    liveReady(dir);
    seedVisibleBoundary(dir);
    preregistration(dir);
    // 可见批次不建 DB：prepare 仍能从封存目标写出配置，证明作品名不查库。
    prepare(dir);
    const config = readConfig(dir);
    assert.equal(config.journey, "live");
    assert.equal(config.message, G2_MESSAGE);
    assert.equal(config.target.work_title, G2_VISIBLE_TARGET.work_title);
    assert.deepEqual(config.author_visible_target, G2_VISIBLE_TARGET);
    assert.deepEqual(config.preregistration, {
      id: "b82-g2-live-test",
      sha256: shaFile(path.join(dir, "preregistration.json")),
      model: LIVE_MODEL,
    });
    assert.equal(readConfig(dir).message, G2_MESSAGE);
    assert.deepEqual(readConfig(dir).author_visible_target, G2_VISIBLE_TARGET);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readConfig 按配置冻结模型复核，不按当前 env 推定", () => {
  const dir = visibleBatch();
  try {
    liveReady(dir);
    preregistration(dir);
    writeVisibleConfig(dir);
    const moduleUrl = new URL("./authoring_capture_evidence.mjs", import.meta.url).href;
    const script =
      `import { readConfig } from ${JSON.stringify(moduleUrl)};` +
      "process.stdout.write(readConfig(process.argv[1]).message);";
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script, dir], {
      encoding: "utf8",
      env: { ...process.env, B71_STRATA_MODEL: "env-changed-after-freeze" },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, G2_MESSAGE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("无预注册的普通 live 批次保持历史默认输入且不写标记", () => {
  const dir = prepareBatch("live");
  try {
    liveReady(dir);
    seedLive(dir);
    prepare(dir);
    const config = readConfig(dir);
    assert.equal(config.journey, "live");
    assert.equal(config.message, DEFAULT_LIVE_MESSAGE);
    assert.equal(Object.hasOwn(config, "preregistration"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("预注册作者输入为空、模型/目录不符时 prepare 失败且不落配置", () => {
  const cases = [
    [{ message: "" }, /message 不能为空/],
    [{ message: "   " }, /message 不能为空/],
    [{ model: `not-${LIVE_MODEL}` }, /预注册模型/],
    [{ evidenceDir: path.join(os.tmpdir(), "b82-other-batch") }, /evidence\.dir/],
    [{ extraScenario: true }, /恰好一项/],
    [{ authorVisibleTarget: null }, /author_visible_target/],
    [{ authorVisibleTarget: { ...G2_VISIBLE_TARGET, reading_excerpt: "  " } }, /reading_excerpt/],
  ];
  for (const [options, pattern] of cases) {
    const dir = visibleBatch();
    try {
      liveReady(dir);
      preregistration(dir, options);
      assert.throws(() => prepare(dir), pattern);
      assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);
      assert.equal(fs.existsSync(path.join(dir, "production-sources-before.json")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("预注册文件只属于普通 live 批次", () => {
  const dir = prepareBatch("revision");
  try {
    ready(dir);
    seed(dir);
    preregistration(dir);
    assert.throws(() => prepare(dir), /只属于普通 live 批次/);
    assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("旧缺 author_visible_target 的 b82-g2 预注册仍可哈希诊断，但不能新 prepare", () => {
  const dir = visibleBatch();
  try {
    liveReady(dir);
    preregistration(dir, { authorVisibleTarget: null });
    const record = validatePreregistrationFile(path.join(dir, "preregistration.json"), { dir });
    assert.equal(record.scenario_id, "b82-g2");
    assert.equal(record.author_visible_target, null, "旧预注册保持通用哈希可读");
    assert.equal(record.sha256, shaFile(path.join(dir, "preregistration.json")));
    assert.throws(() => prepare(dir), /author_visible_target/);
    assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);

    // 历史已准备批次：配置里也没有该字段，readConfig 只做通用哈希复核。
    writeJson(dir, "native-b71-config.json", {
      slice_id: "b71-first-consumer",
      journey: "live",
      provider: "strata",
      target: { work_title: G2_VISIBLE_TARGET.work_title },
      preregistration: { id: record.id, sha256: record.sha256, model: LIVE_MODEL },
      message: G2_MESSAGE,
    });
    const config = readConfig(dir);
    assert.equal(config.scenario_id, "b82-g2");
    assert.equal(Object.hasOwn(config, "author_visible_target"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readConfig 拒绝改写、缺失或补造作者可见目标", () => {
  const dir = visibleBatch();
  try {
    liveReady(dir);
    preregistration(dir);
    writeVisibleConfig(dir);
    const configPath = path.join(dir, "native-b71-config.json");
    const original = JSON.parse(fs.readFileSync(configPath, "utf8"));

    fs.writeFileSync(configPath, JSON.stringify({
      ...original,
      author_visible_target: { ...G2_VISIBLE_TARGET, chapter_title: "另一章" },
    }, null, 2));
    assert.throws(() => readConfig(dir), /作者可见目标与预注册不一致/);

    fs.writeFileSync(configPath, JSON.stringify({
      ...original,
      author_visible_target: undefined,
    }, null, 2));
    assert.throws(() => readConfig(dir), /作者可见目标与预注册不一致/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const historical = visibleBatch();
  try {
    liveReady(historical);
    preregistration(historical, { authorVisibleTarget: null });
    const record = validatePreregistrationFile(path.join(historical, "preregistration.json"), {
      dir: historical,
    });
    writeJson(historical, "native-b71-config.json", {
      slice_id: "b71-first-consumer",
      journey: "live",
      provider: "strata",
      target: { work_title: G2_VISIBLE_TARGET.work_title },
      author_visible_target: G2_VISIBLE_TARGET,
      preregistration: { id: record.id, sha256: record.sha256, model: LIVE_MODEL },
      message: G2_MESSAGE,
    });
    assert.throws(() => readConfig(historical), /缺少冻结预注册来源/);
  } finally {
    fs.rmSync(historical, { recursive: true, force: true });
  }
});

test("readConfig 在预注册被删改或标记缺失时失败", () => {
  const dir = visibleBatch();
  try {
    liveReady(dir);
    preregistration(dir);
    writeVisibleConfig(dir);
    const preregPath = path.join(dir, "preregistration.json");
    const configPath = path.join(dir, "native-b71-config.json");
    const original = fs.readFileSync(preregPath);
    const originalConfig = fs.readFileSync(configPath);

    fs.writeFileSync(preregPath, original.toString("utf8").replace(G2_MESSAGE, "改成另一段输入"));
    assert.throws(() => readConfig(dir), /预注册文件已被篡改/);

    fs.writeFileSync(preregPath, original);
    const tampered = JSON.parse(originalConfig);
    tampered.message = "改写的发送输入";
    fs.writeFileSync(configPath, JSON.stringify(tampered, null, 2));
    assert.throws(() => readConfig(dir), /作者输入与预注册不一致/);

    tampered.preregistration.id = "b82-other";
    fs.writeFileSync(configPath, JSON.stringify({ ...tampered, message: G2_MESSAGE }, null, 2));
    assert.throws(() => readConfig(dir), /预注册 id 与配置不一致/);

    fs.writeFileSync(configPath, JSON.stringify({ ...tampered, preregistration: undefined }, null, 2));
    assert.throws(() => readConfig(dir), /缺少 preregistration 标记/);

    fs.writeFileSync(configPath, originalConfig);
    fs.rmSync(preregPath);
    assert.throws(() => readConfig(dir), /预注册文件缺失/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
