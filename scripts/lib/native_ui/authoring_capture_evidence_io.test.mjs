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
  readAutoMaintenanceInputs,
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
  R05_BUDGET,
  R05_CASES,
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
    provider = "strata",
    modelFields = {},
    runtime = null,
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
    model: { provider, model, ...modelFields },
    ...(runtime ? { runtime } : {}),
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


function splashRuntimeFacts() {
  return {
    schema: "b87-r01-runtime-facts/v1", mix_env: "test",
    provider: { selected: "splash", model: "local/Q4-PLE4", endpoint: "http://127.0.0.1:8000" },
    context_pressure: { provider: "splash", window: 32000, maintenance_ratio: 0.70 },
    auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false,
  };
}

function splashPreregistration(dir, options = {}) {
  preregistration(dir, {
    provider: "splash", model: "local/Q4-PLE4",
    modelFields: { thinking: "enabled", reasoning_effort: "high", max_tokens: 32000,
      timeout_ms: 300000, context_window: 262144 },
    runtime: { profile: "b87-r03-splash-product-maintenance-budget",
      context_pressure: { window: 32000, maintenance_ratio: 0.70 },
      auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false },
    ...options,
  });
}

function splashReady(dir) {
  writeJson(dir, "native-driver-ready.json", { slice_id: "b71-first-consumer", provider: "splash" });
  writeJson(dir, "runtime-facts.json", splashRuntimeFacts());
}

test("G2 Splash 只凭冻结输入和同进程实际 runtime 建批，不取 seed/DB 或 Strata 槽位", () => {
  const dir = tempDir();
  try {
    splashReady(dir);
    splashPreregistration(dir);
    prepare(dir);
    const config = readConfig(dir);
    assert.equal(config.journey, "live");
    assert.equal(config.provider, "splash");
    assert.equal(config.scenario_id, "b82-g2");
    assert.equal(config.message, G2_MESSAGE);
    assert.deepEqual(config.author_visible_target, G2_VISIBLE_TARGET);
    assert.equal(config.runtime.profile, "b87-r03-splash-product-maintenance-budget");
    assert.deepEqual(config.runtime.observed, splashRuntimeFacts());
    assert.equal(config.runtime.facts_sha256, shaFile(path.join(dir, "runtime-facts.json")));
    assert.equal(config.target, undefined);
    assert.equal(config.auto_maintenance, undefined);
    assert.equal(fs.existsSync(path.join(dir, "strata-slot.json")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("G2 Splash 缺实际 runtime 或缺冻结输入时在产出配置前拒绝", () => {
  for (const missing of ["runtime-facts.json", "preregistration.json"]) {
    const dir = tempDir();
    try {
      splashReady(dir);
      splashPreregistration(dir);
      fs.rmSync(path.join(dir, missing));
      assert.throws(() => prepare(dir), missing === "runtime-facts.json" ? /ENOENT/ : /冻结预注册/);
      assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("G2 Splash 冻结 provider/model/runtime 必须与实际 route 和唯一 recipe 相符", () => {
  for (const [options, pattern] of [
    [{ provider: "strata" }, /provider/],
    [{ model: "wrong-model" }, /模型|model/],
    [{ scenarioId: "b82-g3" }, /b82-g2/],
    [{ modelFields: { thinking: "enabled", reasoning_effort: "high", max_tokens: 32000,
      timeout_ms: 300000, context_window: 32000 } }, /context_window/],
    [{ runtime: { profile: "b87-r03-splash-product-maintenance-budget",
      context_pressure: { window: 4096, maintenance_ratio: 0.70 },
      auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false } }, /维护预算/],
  ]) {
    const dir = tempDir();
    try {
      splashReady(dir);
      splashPreregistration(dir, options);
      assert.throws(() => prepare(dir), pattern);
      assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("G2 Splash readConfig 拒绝实际 runtime 被替换、篡改或与配置哈希不符", () => {
  const dir = tempDir();
  try {
    splashReady(dir);
    splashPreregistration(dir);
    prepare(dir);
    const config = readConfig(dir);
    writeJson(dir, "native-b71-config.json", { ...config, runtime: { ...config.runtime, facts_sha256: "0".repeat(64) } });
    assert.throws(() => readConfig(dir), /runtime facts/);
    writeJson(dir, "native-b71-config.json", config);
    writeJson(dir, "runtime-facts.json", { ...splashRuntimeFacts(), provider: { ...splashRuntimeFacts().provider, model: "other" } });
    assert.throws(() => readConfig(dir), /provider.model/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("同一预注册读取 owner 由 G2/B29 caller 显式绑定场景，不能互相借资格", () => {
  const dir = tempDir();
  try {
    splashPreregistration(dir, { scenarioId: "b29-r03-candidate", message: "指定老沈为主角" });
    const file = path.join(dir, "preregistration.json");
    const frozen = validatePreregistrationFile(file, { dir, provider: "splash", scenarioId: "b29-r03-candidate" });
    assert.equal(frozen.message, "指定老沈为主角");
    assert.equal(frozen.scenario_id, "b29-r03-candidate");
    assert.throws(() => validatePreregistrationFile(file, { dir, provider: "splash" }), /显式绑定/);
    assert.throws(() => validatePreregistrationFile(file, { dir, provider: "splash", scenarioId: "b82-g2" }), /b82-g2/);
    splashReady(dir);
    assert.throws(() => prepare(dir), /b82-g2/);
    assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("G2 Splash 预检 CLI 按显式 provider 校验同一冻结副本", () => {
  const dir = tempDir();
  try {
    splashPreregistration(dir);
    const file = path.join(dir, "preregistration.json");
    const cli = path.resolve("scripts/lib/native_ui/authoring_capture_evidence.mjs");
    const ok = spawnSync(process.execPath, [cli, "validate-preregistration", file, dir, "splash", "b82-g2"], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    const wrong = spawnSync(process.execPath, [cli, "validate-preregistration", file, dir, "strata"], { encoding: "utf8" });
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /provider/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


function r05Preregistration(dir, scenario = R05_CASES[0]) {
  splashPreregistration(dir, { scenarioId: scenario.id, message: scenario.message,
    authorVisibleTarget: scenario.target });
  const value = JSON.parse(fs.readFileSync(path.join(dir, "preregistration.json"), "utf8"));
  value.budget = { ...R05_BUDGET };
  value.scenarios[0].slice_id = "b71-first-consumer";
  value.scenarios[0].seed = {
    script: scenario.seed_script, sha256: shaFile(path.resolve(scenario.seed_script)),
  };
  writeJson(dir, "preregistration.json", value);
  return value;
}

// 标题取原 seed（AU11 第15行、CA04 第11/17行）及真实阅读页，不取生产登记表。
for (const [id, title, wrongTitle] of [
  ["b87-r05-quality", "第01章：灵源账单", "第1章：灵源账单"],
  ["b87-r05-style-material", "第01章：黑市对账夜", "第1章：黑市对账夜"],
]) {
  test(`R05 ${id} 保留真实章名第01并拒绝漏零第1`, () => {
    const scenario = R05_CASES.find((item) => item.id === id);
    const dir = tempDir("r05-title-");
    try {
      const value = r05Preregistration(dir, { ...scenario,
        target: { ...scenario.target, chapter_title: title } });
      const file = path.join(dir, "preregistration.json");
      const options = { dir, provider: "splash", scenarioId: id };
      const record = validatePreregistrationFile(file, options);
      assert.equal(record.author_visible_target.chapter_title, title);
      value.scenarios[0].author_visible_target.chapter_title = wrongTitle;
      writeJson(dir, "preregistration.json", value);
      assert.throws(() => validatePreregistrationFile(file, options),
        /R05 作者可见目标与冻结场景不符/u);
      assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test("R05 prepare/readConfig 共用冻结场景、原文、目标、seed字节和900秒owned预算", () => {
  for (const scenario of R05_CASES) {
    const dir = tempDir("r05-capture-");
    try {
      splashReady(dir);
      const manifest = r05Preregistration(dir, scenario);
      const record = validatePreregistrationFile(path.join(dir, "preregistration.json"), {
        dir, provider: "splash", scenarioId: scenario.id,
      });
      assert.deepEqual(record.author_visible_target, scenario.target);
      assert.deepEqual(record.seed, manifest.scenarios[0].seed);
      assert.deepEqual(record.budget, R05_BUDGET);
      prepare(dir);
      const config = readConfig(dir);
      assert.equal(config.scenario_id, scenario.id);
      assert.equal(config.message, scenario.message);
      assert.deepEqual(config.author_visible_target, scenario.target);
      assert.deepEqual(config.seed, manifest.scenarios[0].seed);
      assert.deepEqual(config.budget, R05_BUDGET);
      assert.equal(config.target, undefined);
      assert.equal(fs.existsSync(path.join(dir, "strata-slot.json")), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("R05 错原文/对象/seed/预算/slice 的预登记在启动之前拒绝，不能借任意Splash场景过关", () => {
  const changes = [
    ["作者原文", (value) => { value.scenarios[0].message += "另加要求"; }],
    ["作品", (value) => { value.scenarios[0].author_visible_target.work_title = "另一作品"; }],
    ["章节", (value) => { value.scenarios[0].author_visible_target.chapter_title = "第1章：灰烬中的手印"; }],
    ["摘录", (value) => { value.scenarios[0].author_visible_target.reading_excerpt = "伪造摘录"; }],
    ["缺种子", (value) => { delete value.scenarios[0].seed; }],
    ["错种子", (value) => { value.scenarios[0].seed = {
      script: "scripts/seed_ca04_carry_gaps.exs",
      sha256: shaFile(path.resolve("scripts/seed_ca04_carry_gaps.exs")),
    }; }],
    ["错字节", (value) => { value.scenarios[0].seed.sha256 = "0".repeat(64); }],
    ["缺预算", (value) => { delete value.budget; }],
    ["加发送", (value) => { value.budget.author_sends = 2; }],
    ["加重试", (value) => { value.budget.manual_retries = 1; }],
    ["延长整批", (value) => { value.budget.scenario_seconds = 901; }],
    ["换slice", (value) => { value.scenarios[0].slice_id = "b71-authoring-revision"; }],
  ];
  for (const [label, change] of changes) {
    const dir = tempDir("r05-invalid-");
    try {
      const value = r05Preregistration(dir);
      change(value);
      writeJson(dir, "preregistration.json", value);
      assert.throws(() => validatePreregistrationFile(path.join(dir, "preregistration.json"), {
        dir, provider: "splash", scenarioId: R05_CASES[0].id,
      }), undefined, label);
      assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("R05 不能借Strata或篡改后配置恢复本批资格", () => {
  const dir = tempDir("r05-binding-");
  try {
    splashReady(dir);
    const value = r05Preregistration(dir);
    value.model.provider = "strata";
    value.model.model = LIVE_MODEL;
    writeJson(dir, "preregistration.json", value);
    assert.throws(() => validatePreregistrationFile(path.join(dir, "preregistration.json"), {
      dir, provider: "strata", model: LIVE_MODEL, scenarioId: R05_CASES[0].id,
    }), /R05|splash|provider/u);
    r05Preregistration(dir);
    prepare(dir);
    const config = readConfig(dir);
    writeJson(dir, "native-b71-config.json", { ...config,
      seed: { ...config.seed, sha256: "0".repeat(64) } });
    assert.throws(() => readConfig(dir), /seed|种子/u);
    writeJson(dir, "native-b71-config.json", { ...config,
      budget: { ...config.budget, scenario_seconds: 901 } });
    assert.throws(() => readConfig(dir), /budget|预算/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function withAutoMaintenance(copy, fn) {
  const previous = process.env.B71_AUTO_MAINTENANCE;
  process.env.B71_AUTO_MAINTENANCE = "1";
  try {
    writeJson(copy.dir, "native-driver-ready.json", { slice_id: "b71-first-consumer", provider: "splash" });
    seedLive(copy.dir);
    writeJson(copy.dir, "runtime-facts.json", splashRuntimeFacts());
    return fn();
  } finally {
    if (previous === undefined) delete process.env.B71_AUTO_MAINTENANCE;
    else process.env.B71_AUTO_MAINTENANCE = previous;
  }
}

test("R03 prepare 封存同源20+5原文与实际 runtime，修改内容或同hash引用均拒绝", () => {
  withWorkingCopy(template(), (copy) => withAutoMaintenance(copy, () => {
    prepare(copy.dir);
    const config = readConfig(copy.dir);
    const inputs = readAutoMaintenanceInputs(copy.dir, config);
    assert.equal(inputs.discussions.length, 20);
    assert.equal(inputs.controls.length, 5);
    assert.equal(inputs.controls[0].id, "r03-waiting-a");
    assert.equal(config.message, inputs.discussions[0].text);
    assert.equal(config.runtime.observed.context_pressure.window, 32000);
    assert.equal(config.auto_maintenance.requests, undefined);
    const file = path.join(copy.dir, inputs.input_sources.controls.file);
    const original = fs.readFileSync(file);
    const altered = JSON.parse(original);
    altered.turns[0].text += "修改";
    fs.writeFileSync(file, JSON.stringify(altered));
    assert.throws(() => readConfig(copy.dir), /作者原文 hash 不符/);
    fs.writeFileSync(file, original);
    const changedConfig = structuredClone(config);
    changedConfig.auto_maintenance.input_sources.controls.source_path = "another.json";
    writeJson(copy.dir, "native-b71-config.json", changedConfig);
    assert.throws(() => readConfig(copy.dir), /冻结输入引用不符/);
    writeJson(copy.dir, "native-b71-config.json", config);
    const runtime = JSON.parse(fs.readFileSync(path.join(copy.dir, "runtime-facts.json")));
    runtime.context_pressure.window = 4096;
    writeJson(copy.dir, "runtime-facts.json", runtime);
    assert.throws(() => readConfig(copy.dir), /runtime facts context_pressure.window/);
  }));
});

test("R03 错provider/缺实际runtime在封存和配置前失败；冻结副本不能覆盖", () => {
  withWorkingCopy(template(), (copy) => withAutoMaintenance(copy, () => {
    writeJson(copy.dir, "native-driver-ready.json", { slice_id: "b71-first-consumer", provider: "strata" });
    assert.throws(() => prepare(copy.dir), /Splash runtime profile/);
    assert.equal(fs.existsSync(path.join(copy.dir, "native-b71-config.json")), false);
    writeJson(copy.dir, "native-driver-ready.json", { slice_id: "b71-first-consumer", provider: "splash" });
    fs.rmSync(path.join(copy.dir, "runtime-facts.json"));
    assert.throws(() => prepare(copy.dir), /ENOENT/);
    assert.equal(fs.existsSync(path.join(copy.dir, "r03-discussion-author-inputs.json")), false);
  }));
  withWorkingCopy(template(), (copy) => withAutoMaintenance(copy, () => {
    prepare(copy.dir);
    assert.throws(() => prepare(copy.dir), /EEXIST/);
  }));
});
