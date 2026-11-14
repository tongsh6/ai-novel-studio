// B71 capture 邻接 IO：真实 12 表 SQLite 批次上的 prepare/capture/readConfig 与
// 冻结预注册校验。DB 模板由 `fixtures/authoring_capture_io_fixture.mjs` 在 run 内
// 物化一次（只读共享）；需要写 config/seed/证据文件或运行 prepare/capture 的 case
// 取 `withWorkingCopy` 隔离副本。作者可见场景选择本身是纯判定，留在邻接
// `authoring_capture_evidence.test.mjs`，不建目录/DB。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  capture,
  prepare,
  readConfig,
  validatePreregistrationFile,
} from "./authoring_capture_evidence.mjs";
import { pendingSourceMessage } from "./authoring_pending_evidence.mjs";
import { shaFile } from "./scenario_evidence.mjs";
import { materializeFixture, openTestRunScope, withWorkingCopy } from "../test_env.mjs";
import {
  CHAPTER,
  DEFAULT_LIVE_MESSAGE,
  G2_MESSAGE,
  G2_VISIBLE_TARGET,
  G3_MESSAGE,
  LIVE_MODEL,
  SESSION,
  WORK,
} from "./fixtures/authoring_capture_facts.mjs";
import { captureFixtureSpec } from "./fixtures/authoring_capture_io_fixture.mjs";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function template(options = {}) {
  return materializeFixture(captureFixtureSpec(options), { scope: runScope });
}

// 不建 DB 的作者可见批次目录：只放冻结预注册、ready 与配置，最后按 case 回收。
function tempDir(tag = "b71-capture-visible-") {
  return fs.mkdtempSync(path.join(runScope.workDir, tag));
}

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
}

function writeJourneyConfig(dir, journey) {
  writeJson(dir, "native-b71-config.json", { journey });
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

// 直接按封存预注册构造 live 配置：只含作者可见目标，不写 DB/work/session 身份。
function writeVisibleConfig(dir, { message = G2_MESSAGE } = {}) {
  const record = validatePreregistrationFile(path.join(dir, "preregistration.json"), { dir });
  writeJson(dir, "native-b71-config.json", {
    slice_id: "b71-first-consumer",
    journey: "live",
    provider: "strata",
    author_visible_target: G2_VISIBLE_TARGET,
    preregistration: { id: record.id, sha256: record.sha256, model: LIVE_MODEL },
    message,
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
    scenarioId = "b82-g2",
  } = {},
) {
  const scenario = {
    id: scenarioId,
    ...(authorVisibleTarget ? { author_visible_target: authorVisibleTarget } : {}),
    message,
    evidence: { dir: evidenceDir },
  };
  writeJson(dir, "preregistration.json", {
    id: `${scenarioId}-live-test`,
    model: { provider: "strata", model },
    scenarios: extraScenario ? [scenario, { ...scenario, id: `${scenarioId}-extra` }] : [scenario],
  });
}

test("before-revision 为修订批次登记一次独立 checkpoint，含真实 canon 章设计态见证", () => {
  withWorkingCopy(template(), (copy) => {
    writeJourneyConfig(copy.dir, "revision");
    capture(copy.dir, "start");
    capture(copy.dir, "before-revision");
    const value = JSON.parse(
      fs.readFileSync(path.join(copy.dir, "b71-before-revision.json"), "utf8"),
    );
    assert.equal(value.checkpoint, "before-revision");
    assert.equal(value.db_production_counts.chapters, 1);
    assert.equal(value.authoring_canon.version, 2);
    assert.equal(value.authoring_canon.chapters[CHAPTER].title, "第02章：矿区追击战");
    assert.deepEqual(value.authoring_canon.chapters[CHAPTER].mission, null);
    assert.match(value.authoring_canon.chapters[CHAPTER].protected_sha256, /^[0-9a-f]{64}$/);
    assert.throws(() => capture(copy.dir, "before-revision"), /证据不得覆盖/);
  });
});

test("pending prepare 从 seed 取 work/session，并生成带 nonce 的原作者输入", () => {
  withWorkingCopy(template(), (copy) => {
    ready(copy.dir, "b71-authoring-pending");
    seedLive(copy.dir);
    prepare(copy.dir);
    const config = readConfig(copy.dir);
    assert.equal(config.journey, "pending");
    assert.equal(config.target.work_id, WORK);
    assert.equal(config.target.session_id, SESSION);
    assert.match(config.nonce, /^[0-9a-f]{16}$/);
    assert.equal(config.message, pendingSourceMessage(config.nonce));
    assert.equal(config.revision_message, "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。");
    assert.equal(config.followup_message, "资料处理进度怎么样？");
  });
});

test("planning start 仍写 canon 快照；before-revision 不属于非修订 journey", () => {
  withWorkingCopy(template(), (copy) => {
    writeJourneyConfig(copy.dir, "planning");
    capture(copy.dir, "start");
    const value = JSON.parse(fs.readFileSync(path.join(copy.dir, "b71-start.json"), "utf8"));
    assert.equal(value.authoring_canon.version, 2);
  });
});

test("before-revision 不属于非修订 journey，也不接受未知 checkpoint", () => {
  for (const journey of ["planning", "continuation", "character-design"]) {
    withWorkingCopy(template(), (copy) => {
      writeJourneyConfig(copy.dir, journey);
      assert.throws(() => capture(copy.dir, "before-revision"), /只属于修订批次/);
      assert.equal(fs.existsSync(path.join(copy.dir, "b71-before-revision.json")), false);
    });
  }
  withWorkingCopy(template(), (copy) => {
    writeJourneyConfig(copy.dir, "revision");
    assert.throws(() => capture(copy.dir, "middle"), /未知 checkpoint/);
  });
});

test("prepare 为修订批次写出空聊天文案、明确章标题、目标作品与生产指纹", () => {
  withWorkingCopy(template(), (copy) => {
    ready(copy.dir);
    seed(copy.dir);
    prepare(copy.dir);
    const config = readConfig(copy.dir);
    assert.equal(config.slice_id, "b71-authoring-revision");
    assert.equal(config.journey, "revision");
    assert.equal(config.message, "");
    assert.equal(config.chapter_title, "第02章：矿区追击战");
    assert.deepEqual(config.target, { work_id: WORK, work_title: "测试作品" });
    const before = JSON.parse(
      fs.readFileSync(path.join(copy.dir, "production-sources-before.json"), "utf8"),
    );
    assert.match(before.head, /^[0-9a-f]{40}$/);
    assert.ok(before.file_count > 0);
  });
});

test("prepare 为其它 journey 写各自真实聊天文案且不带修订章标题", () => {
  const cases = [
    ["b71-first-consumer", "full-read", "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。"],
    ["b71-authoring-transcript", "continuation", "先写第01章正文草稿，再做质量复核；这是一项可恢复的长任务。"],
    ["b71-authoring-profiles", "character-design", "先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派；这是一项可恢复的长任务。"],
    ["b71-authoring-planning", "planning", "请按先核对再补齐计划设计一个角色，再设计相关世界设定；这是一项可恢复的长任务。"],
  ];
  for (const [sliceId, journey, message] of cases) {
    withWorkingCopy(template(), (copy) => {
      ready(copy.dir, sliceId);
      seed(copy.dir);
      prepare(copy.dir);
      const config = readConfig(copy.dir);
      assert.equal(config.journey, journey);
      assert.equal(config.message, message);
      assert.equal(Object.hasOwn(config, "chapter_title"), false);
    });
  }
});

test("prepare 在目标作品缺失、重名或 ready slice 未知时失败且不写配置", () => {
  withWorkingCopy(template(), (copy) => {
    ready(copy.dir);
    seed(copy.dir, "99999999-9999-4999-8999-999999999999");
    assert.throws(() => prepare(copy.dir), /seed 作品不存在/);
    assert.equal(fs.existsSync(path.join(copy.dir, "native-b71-config.json")), false);
    assert.equal(fs.existsSync(path.join(copy.dir, "production-sources-before.json")), false);
  });
  withWorkingCopy(template({ duplicateWork: true }), (copy) => {
    ready(copy.dir);
    seed(copy.dir);
    assert.throws(() => prepare(copy.dir), /seed 作品不存在/);
    assert.equal(fs.existsSync(path.join(copy.dir, "production-sources-before.json")), false);
  });
  withWorkingCopy(template(), (copy) => {
    ready(copy.dir, "b71-unknown");
    seed(copy.dir);
    assert.throws(() => prepare(copy.dir), /未知原生 slice/);
    assert.equal(fs.existsSync(path.join(copy.dir, "production-sources-before.json")), false);
  });
});

test("普通 live 批次只按冻结预注册副本取作者输入，不依赖 seed/DB", () => {
  const dir = tempDir();
  try {
    liveReady(dir);
    preregistration(dir);
    // 零 seed、零 DB：作者可见批次不得从内部作品/会话 ID 派生场景目标。
    prepare(dir);
    const config = readConfig(dir);
    assert.equal(config.journey, "live");
    assert.equal(config.message, G2_MESSAGE);
    assert.equal(Object.hasOwn(config, "target"), false);
    assert.equal(Object.hasOwn(config, "work_id"), false);
    assert.equal(Object.hasOwn(config, "session_id"), false);
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

test("G3 只读批次同样只按冻结作者可见目标建批，不依赖 seed/DB", () => {
  const dir = tempDir();
  try {
    liveReady(dir);
    preregistration(dir, { scenarioId: "b82-g3", message: G3_MESSAGE });
    // 零 seed、零 DB：G3 与 G2 共用同一目标契约，不从内部作品/会话 ID 派生。
    prepare(dir);
    const config = readConfig(dir);
    assert.equal(config.journey, "live");
    assert.equal(config.scenario_id, "b82-g3");
    assert.equal(config.message, G3_MESSAGE, "作者只读原话按冻结字节发送");
    assert.equal(Object.hasOwn(config, "target"), false);
    assert.equal(Object.hasOwn(config, "work_id"), false);
    assert.equal(Object.hasOwn(config, "session_id"), false);
    assert.deepEqual(config.author_visible_target, G2_VISIBLE_TARGET);
    assert.equal(config.preregistration.id, "b82-g3-live-test");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("G3 作者可见目标同样受预注册哈希绑定，改写或补造都拒绝", () => {
  const dir = tempDir();
  try {
    liveReady(dir);
    preregistration(dir, { scenarioId: "b82-g3", message: G3_MESSAGE });
    writeVisibleConfig(dir, { message: G3_MESSAGE });
    const configPath = path.join(dir, "native-b71-config.json");
    const original = JSON.parse(fs.readFileSync(configPath, "utf8"));

    fs.writeFileSync(configPath, JSON.stringify({
      ...original,
      author_visible_target: { ...G2_VISIBLE_TARGET, reading_excerpt: "另一段原文" },
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
});

test("readConfig 按配置冻结模型复核，不按当前 env 推定", () => {
  const dir = tempDir();
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
  withWorkingCopy(template(), (copy) => {
    liveReady(copy.dir);
    seedLive(copy.dir);
    prepare(copy.dir);
    const config = readConfig(copy.dir);
    assert.equal(config.journey, "live");
    assert.equal(config.message, DEFAULT_LIVE_MESSAGE);
    assert.equal(Object.hasOwn(config, "preregistration"), false);
  });
});

test("预注册作者输入为空、模型/目录不符时 prepare 失败且不落配置", () => {
  const cases = [
    [{ message: "" }, /message 不能为空/],
    [{ message: "   " }, /message 不能为空/],
    [{ model: `not-${LIVE_MODEL}` }, /预注册模型/],
    [{ evidenceDir: path.join(runScope.workDir, "b82-other-batch") }, /evidence\.dir/],
    [{ extraScenario: true }, /恰好一项/],
    [{ authorVisibleTarget: null }, /author_visible_target/],
    [{ authorVisibleTarget: { ...G2_VISIBLE_TARGET, reading_excerpt: "  " } }, /reading_excerpt/],
  ];
  for (const [options, pattern] of cases) {
    const dir = tempDir();
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
  withWorkingCopy(template(), (copy) => {
    ready(copy.dir);
    seed(copy.dir);
    preregistration(copy.dir);
    assert.throws(() => prepare(copy.dir), /只属于普通 live 批次/);
    assert.equal(fs.existsSync(path.join(copy.dir, "native-b71-config.json")), false);
  });
});

test("旧缺 author_visible_target 的 b82-g2 预注册仍可哈希诊断，但不能新 prepare", () => {
  const dir = tempDir();
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
  const dir = tempDir();
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

  const historical = tempDir("b71-capture-historical-");
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
  const dir = tempDir();
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
