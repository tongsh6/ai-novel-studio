// B71 capture 邻接 IO：真实 13 表 SQLite 批次上的 prepare/capture/readConfig 与
// 冻结预注册校验。DB 模板由 `fixtures/authoring_capture_io_fixture.mjs` 在 run 内
// 物化一次（只读共享）；需要写 config/seed/证据文件或运行 prepare/capture 的 case
// 取 `withWorkingCopy` 隔离副本。作者可见场景选择本身是纯判定，留在邻接
// `authoring_capture_evidence.test.mjs`，不建目录/DB。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { main as evidenceMain } from "../../native_b71_evidence.mjs";
import { createQuestionTransportProxy } from "../../native_question_transport_proxy.mjs";
import {
  capture,
  prepare,
  readConfig,
  readAutoMaintenanceInputs,
  validatePreregistrationFile,
} from "./authoring_capture_evidence.mjs";
import { pendingSourceMessage } from "./authoring_pending_evidence.mjs";
import { sha256, shaFile } from "./scenario_evidence.mjs";
import { createWorkingCopy, materializeFixture, openTestRunScope, withWorkingCopy } from "../test_env.mjs";
import {
  CHAPTER,
  DEFAULT_LIVE_MESSAGE,
  G2_MESSAGE,
  G2_VISIBLE_TARGET,
  G3_MESSAGE,
  LIVE_MODEL,
  R05_BUDGET,
  R05_CASES,
  R06_BUDGET,
  R06_CASES,
  SESSION,
  WORK,
} from "./fixtures/authoring_capture_facts.mjs";
import { CAPTURE_DB_REL, captureFixtureSpec } from "./fixtures/authoring_capture_io_fixture.mjs";
import { loadLiveCaseCorpus, selectLiveCase } from "../quality/author_behavior_live_cases.mjs";

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

test("预注册文件拒绝未登记的修订入口", () => {
  withWorkingCopy(template(), (copy) => {
    ready(copy.dir);
    seed(copy.dir);
    preregistration(copy.dir);
    assert.throws(() => prepare(copy.dir), /只属于 live\/mission\/behavior 批次/);
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
  const g2 = R06_CASES[0];
  preregistration(dir, {
    authorVisibleTarget: g2.target,
    provider: "splash", model: "local/Q4-PLE4",
    modelFields: { thinking: "enabled", reasoning_effort: "high", max_tokens: 32000,
      timeout_ms: 300000, context_window: 262144 },
    runtime: { profile: "b87-r03-splash-product-maintenance-budget",
      context_pressure: { window: 32000, maintenance_ratio: 0.70 },
      auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false },
    ...options,
  });
  if ((options.scenarioId ?? g2.id) === g2.id) {
    const value = JSON.parse(fs.readFileSync(path.join(dir, "preregistration.json"), "utf8"));
    value.budget = { ...R06_BUDGET };
    value.scenarios[0].slice_id = g2.slice_id;
    value.scenarios[0].seed = { script: g2.seed_script, sha256: shaFile(path.resolve(g2.seed_script)) };
    writeJson(dir, "preregistration.json", value);
  }
}

function splashReady(dir) {
  writeJson(dir, "native-driver-ready.json", { slice_id: "b71-first-consumer", provider: "splash" });
  writeJson(dir, "runtime-facts.json", splashRuntimeFacts());
}

test("G2 Splash 凭冻结输入、seed字节和同进程 runtime 建批，不取 DB 身份或 Strata 槽位", () => {
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
    assert.deepEqual(config.author_visible_target, R06_CASES[0].target);
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
    [{ scenarioId: "b82-g3" }, /只接受已登记场景/],
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
    assert.throws(() => prepare(dir), /只接受已登记场景/);
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


function r06Preregistration(dir, scenario) {
  splashPreregistration(dir, { scenarioId: scenario.id, message: scenario.message,
    authorVisibleTarget: scenario.target });
  const value = JSON.parse(fs.readFileSync(path.join(dir, "preregistration.json"), "utf8"));
  value.budget = { ...R06_BUDGET };
  value.scenarios[0].slice_id = scenario.slice_id;
  value.scenarios[0].seed = {
    script: scenario.seed_script, sha256: shaFile(path.resolve(scenario.seed_script)),
  };
  writeJson(dir, "preregistration.json", value);
  return value;
}

for (const scenario of R06_CASES) {
  test(`R06 ${scenario.id} 同一owner封存原话、真实slice、seed与900秒预算`, () => {
    const dir = tempDir("r06-capture-");
    try {
      splashReady(dir);
      writeJson(dir, "native-driver-ready.json", { slice_id: scenario.slice_id, provider: "splash" });
      const manifest = r06Preregistration(dir, scenario);
      const record = validatePreregistrationFile(path.join(dir, "preregistration.json"), {
        dir, provider: "splash", b71Live: true, requireAuthorVisibleTarget: true,
      });
      assert.deepEqual(record.seed, manifest.scenarios[0].seed);
      assert.deepEqual(record.budget, R06_BUDGET);
      assert.deepEqual(record.author_visible_target, scenario.target);
      prepare(dir);
      const config = readConfig(dir);
      assert.equal(config.slice_id, scenario.slice_id);
      assert.equal(config.scenario_id, scenario.id);
      assert.equal(config.message, scenario.message);
      assert.deepEqual(config.seed, manifest.scenarios[0].seed);
      assert.deepEqual(config.budget, R06_BUDGET);
      assert.deepEqual(config.author_visible_target, scenario.target);
      assert.equal(config.target, undefined);
      assert.equal(fs.existsSync(path.join(dir, "strata-slot.json")), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

for (const scenario of R06_CASES) {
  test(`R06 ${scenario.id} provider stream 在 validate、prepare、readConfig 中保留同一登记身份`, () => {
    const dir = tempDir("r06-provider-stream-");
    try {
      splashReady(dir);
      writeJson(dir, "native-driver-ready.json", { slice_id: scenario.slice_id, provider: "splash" });
      const manifest = r06Preregistration(dir, scenario);
      const stream = { dir: path.join(dir, "proxy-01"), mode: "observe",
        upstream_endpoint: "http://127.0.0.1:8000/v1", max_upstream_requests: null };
      manifest.scenarios[0].evidence.provider_stream = stream;
      writeJson(dir, "preregistration.json", manifest);
      const record = validatePreregistrationFile(path.join(dir, "preregistration.json"), {
        dir, provider: "splash", b71Live: true, requireAuthorVisibleTarget: true,
      });
      assert.deepEqual(record.provider_stream, stream);
      prepare(dir);
      const config = readConfig(dir);
      assert.deepEqual(config.preregistration.provider_stream, stream);
      assert.equal(config.preregistration.sha256, shaFile(path.join(dir, "preregistration.json")));
      assert.deepEqual(config.budget, R06_BUDGET);
      assert.deepEqual(config.seed, manifest.scenarios[0].seed);
      assert.equal(config.message, scenario.message);
      assert.equal(config.target, undefined);
      assert.equal(config.provider_stream, undefined);
      assert.equal(fs.existsSync(stream.dir), false, "登记证据位置不创建或伪造代理原件");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test("R06 provider stream 不接受路径猜测、注入模式、新HTTP预算或借用其它场景", () => {
  const dir = tempDir("r06-provider-stream-invalid-");
  try {
    const scenario = R06_CASES.find(item => item.id === "wr02-planning-mission-before-outline");
    const original = r06Preregistration(dir, scenario);
    const stream = { dir: path.join(dir, "proxy-01"), mode: "observe",
      upstream_endpoint: "http://127.0.0.1:8000/v1", max_upstream_requests: null };
    const invalid = [
      ["相对路径", { ...stream, dir: "proxy-01" }],
      ["注入模式", { ...stream, mode: "inject" }],
      ["改变HTTP预算", { ...stream, max_upstream_requests: 128 }],
      ["非HTTP上游", { ...stream, upstream_endpoint: "file:///tmp/provider-stream" }],
    ];
    const options = { dir, provider: "splash", b71Live: true, requireAuthorVisibleTarget: true };
    for (const [label, registration] of invalid) {
      const bad = structuredClone(original);
      bad.scenarios[0].evidence.provider_stream = registration;
      writeJson(dir, "preregistration.json", bad);
      assert.throws(() => validatePreregistrationFile(path.join(dir, "preregistration.json"), options),
        undefined, label);
      assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);
    }
    for (const other of R05_CASES.filter(item => !R06_CASES.some(registered => registered.id === item.id))) {
      const manifest = r05Preregistration(dir, other);
      manifest.scenarios[0].evidence.provider_stream = stream;
      writeJson(dir, "preregistration.json", manifest);
      assert.throws(() => validatePreregistrationFile(path.join(dir, "preregistration.json"), options),
        /only belongs to registered R06/u);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("R06 WR02 provider stream 配置副本和冻结原文必须同时核回", () => {
  const dir = tempDir("r06-provider-stream-binding-");
  try {
    const scenario = R06_CASES.find(item => item.id === "wr02-planning-mission-before-outline");
    splashReady(dir);
    writeJson(dir, "native-driver-ready.json", { slice_id: scenario.slice_id, provider: "splash" });
    const manifest = r06Preregistration(dir, scenario);
    const stream = { dir: path.join(dir, "proxy-01"), mode: "observe",
      upstream_endpoint: "http://127.0.0.1:8000/v1", max_upstream_requests: null };
    manifest.scenarios[0].evidence.provider_stream = stream;
    writeJson(dir, "preregistration.json", manifest);
    prepare(dir);
    const original = readConfig(dir);
    for (const registration of [
      undefined,
      { ...stream, dir: path.join(dir, "another-proxy") },
      { ...stream, upstream_endpoint: "http://127.0.0.1:8001/v1" },
      { ...stream, max_upstream_requests: 128 },
    ]) {
      const changed = structuredClone(original);
      if (registration === undefined) delete changed.preregistration.provider_stream;
      else changed.preregistration.provider_stream = registration;
      writeJson(dir, "native-b71-config.json", changed);
      assert.throws(() => readConfig(dir), /provider stream metadata differs/u);
    }
    const changedManifest = structuredClone(manifest);
    changedManifest.scenarios[0].evidence.provider_stream.dir = path.join(dir, "another-proxy");
    const matchingMarker = structuredClone(original);
    matchingMarker.preregistration.provider_stream = changedManifest.scenarios[0].evidence.provider_stream;
    writeJson(dir, "preregistration.json", changedManifest);
    writeJson(dir, "native-b71-config.json", matchingMarker);
    assert.throws(() => readConfig(dir), /预注册文件已被篡改/u);
    writeJson(dir, "preregistration.json", manifest);
    writeJson(dir, "native-b71-config.json", original);
    assert.deepEqual(readConfig(dir).preregistration.provider_stream, stream);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("R06 三场景启动前拒绝改原话、换slice/作品/seed、追加发送或人工重试", () => {
  const changes = [
    ["原话", (value) => { value.scenarios[0].message += "再多写一章"; }],
    ["slice", (value) => { value.scenarios[0].slice_id = "b71-authoring-planning"; }],
    ["作品", (value) => { value.scenarios[0].author_visible_target.work_title = "另一作品"; }],
    ["seed", (value) => { value.scenarios[0].seed.script = "scripts/seed_p1_chapter_draft_generation.exs"; }],
    ["seed字节", (value) => { value.scenarios[0].seed.sha256 = "0".repeat(64); }],
    ["缺seed", (value) => { delete value.scenarios[0].seed; }],
    ["缺预算", (value) => { delete value.budget; }],
    ["第二次发送", (value) => { value.budget.author_sends = 2; }],
    ["人工重试", (value) => { value.budget.manual_retries = 1; }],
    ["超900秒", (value) => { value.budget.scenario_seconds = 901; }],
  ];
  for (const scenario of R06_CASES) {
    const dir = tempDir("r06-prereg-negative-");
    try {
      const original = r06Preregistration(dir, scenario);
      const file = path.join(dir, "preregistration.json");
      const options = { dir, provider: "splash", b71Live: true, requireAuthorVisibleTarget: true };
      assert.doesNotThrow(() => validatePreregistrationFile(file, options), scenario.id);
      for (const [label, change] of changes) {
        const bad = structuredClone(original);
        change(bad);
        writeJson(dir, "preregistration.json", bad);
        assert.throws(() => validatePreregistrationFile(file, options), undefined, `${scenario.id}: ${label}`);
        assert.equal(fs.existsSync(path.join(dir, "native-b71-config.json")), false);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

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
        /作者可见目标与冻结场景不符/u);
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

const PENDING_INPUTS = Object.freeze({
  nonce: "d8f0a1b2c3d4e5f6",
  message: "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺。校验标识d8f0a1b2c3d4e5f6。",
  revision_message: "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。",
  followup_message: "资料处理进度怎么样？",
});
const PENDING_BUDGET = Object.freeze({
  batches: 1, author_sends: 3, manual_retries: 0, scenario_seconds: 900,
  input_timeout_ms: 30000, turn_timeout_ms: 240000,
});
function pendingPreregistration(dir) {
  splashPreregistration(dir, {
    scenarioId: "b87-r08-pending", message: PENDING_INPUTS.message, authorVisibleTarget: null,
  });
  const value = JSON.parse(fs.readFileSync(path.join(dir, "preregistration.json"), "utf8"));
  value.budget = { ...PENDING_BUDGET };
  const scenario = value.scenarios[0];
  scenario.nonce = PENDING_INPUTS.nonce;
  scenario.message = PENDING_INPUTS.message;
  scenario.revision_message = PENDING_INPUTS.revision_message;
  scenario.followup_message = PENDING_INPUTS.followup_message;
  scenario.slice_id = "b71-authoring-pending";
  scenario.seed = {
    script: "scripts/seed_b71_authoring_pending.exs",
    sha256: shaFile(path.resolve("scripts/seed_b71_authoring_pending.exs")),
  };
  writeJson(dir, "preregistration.json", value);
  return value;
}
function pendingSplashReady(dir) {
  splashReady(dir);
  writeJson(dir, "native-driver-ready.json", { slice_id: "b71-authoring-pending", provider: "splash" });
  seedLive(dir);
}

test("R08 pending 在启动前冻结三条原文、nonce、现 seed 与预算，Splash 不变成 live", () => {
  withWorkingCopy(template(), (copy) => {
    pendingSplashReady(copy.dir);
    const manifest = pendingPreregistration(copy.dir);
    const record = validatePreregistrationFile(path.join(copy.dir, "preregistration.json"), {
      dir: copy.dir, provider: "splash", scenarioId: "b87-r08-pending",
    });
    assert.equal(record.scenario_id, "b87-r08-pending");
    assert.equal(record.slice_id, "b71-authoring-pending");
    assert.deepEqual(record.budget, PENDING_BUDGET);
    assert.deepEqual(record.seed, manifest.scenarios[0].seed);
    for (const [key, value] of Object.entries(PENDING_INPUTS)) assert.equal(record[key], value);
    prepare(copy.dir);
    const config = readConfig(copy.dir);
    assert.equal(config.journey, "pending");
    assert.equal(config.provider, "splash");
    assert.equal(config.scenario_id, "b87-r08-pending");
    assert.equal(config.target.work_id, WORK);
    assert.equal(config.target.session_id, SESSION);
    assert.deepEqual(config.seed, manifest.scenarios[0].seed);
    assert.deepEqual(config.budget, PENDING_BUDGET);
    for (const [key, value] of Object.entries(PENDING_INPUTS)) assert.equal(config[key], value);
    assert.equal(config.preregistration.sha256, shaFile(path.join(copy.dir, "preregistration.json")));
    assert.equal(config.runtime.profile, "b87-r03-splash-product-maintenance-budget");
    assert.equal(fs.existsSync(path.join(copy.dir, "strata-slot.json")), false);
  });
});

test("R08 pending 预注册拒绝错场景、缺/改任一原文、nonce、seed 或预算", () => {
  const mutations = [
    (v) => { v.scenarios[0].slice_id = "b71-first-consumer"; },
    (v) => { delete v.scenarios[0].nonce; },
    (v) => { v.scenarios[0].nonce = "other"; },
    (v) => { v.scenarios[0].message += " 补答"; },
    (v) => { delete v.scenarios[0].revision_message; },
    (v) => { v.scenarios[0].revision_message = "保存并改写"; },
    (v) => { delete v.scenarios[0].followup_message; },
    (v) => { v.scenarios[0].followup_message += " 已完成"; },
    (v) => { v.scenarios[0].seed.script = "scripts/seed_p1_chapter_draft_generation.exs"; },
    (v) => { v.scenarios[0].seed.sha256 = "0".repeat(64); },
    (v) => { v.budget.author_sends = 4; },
    (v) => { v.budget.manual_retries = 1; },
    (v) => { v.budget.turn_timeout_ms = 360000; },
  ];
  for (const mutate of mutations) {
    const dir = tempDir("pending-prereg-");
    const value = pendingPreregistration(dir);
    mutate(value);
    writeJson(dir, "preregistration.json", value);
    assert.throws(() => validatePreregistrationFile(path.join(dir, "preregistration.json"), {
      dir, provider: "splash", scenarioId: "b87-r08-pending",
    }), /pending|原文|nonce|seed|预算|budget|slice/);
  }
});

test("R08 pending readConfig 不信可改写的 nonce/后两条消息/seed/budget 或被换成 live 的配置", () => {
  withWorkingCopy(template(), (copy) => {
    pendingSplashReady(copy.dir);
    pendingPreregistration(copy.dir);
    prepare(copy.dir);
    const original = readConfig(copy.dir);
    for (const patch of [
      { nonce: "0000000000000000" }, { revision_message: "另改一次" },
      { followup_message: "忽略之前" }, { journey: "live" },
      { seed: { script: original.seed.script, sha256: "0".repeat(64) } },
      { budget: { ...original.budget, author_sends: 4 } },
    ]) {
      writeJson(copy.dir, "native-b71-config.json", { ...original, ...patch });
      assert.throws(() => readConfig(copy.dir), /pending|预注册|seed|budget|journey/);
    }
    writeJson(copy.dir, "native-b71-config.json", { ...original, preregistration: undefined });
    assert.throws(() => readConfig(copy.dir), /preregistration/);
  });
});

test("R08 pending 错供应商、缺预注册或混用其它 journey 在写配置之前拒绝", () => {
  for (const mode of ["strata", "no-prereg", "answer-mode"]) {
    withWorkingCopy(template(), (copy) => {
      pendingSplashReady(copy.dir);
      pendingPreregistration(copy.dir);
      if (mode === "strata") writeJson(copy.dir, "native-driver-ready.json", {
        slice_id: "b71-authoring-pending", provider: "strata",
      });
      if (mode === "no-prereg") fs.rmSync(path.join(copy.dir, "preregistration.json"));
      const old = process.env.B71_ANSWER_MODE;
      if (mode === "answer-mode") process.env.B71_ANSWER_MODE = "1";
      try {
        assert.throws(() => prepare(copy.dir), /pending|Splash|冻结预注册|只接受确定性/);
        assert.equal(fs.existsSync(path.join(copy.dir, "native-b71-config.json")), false);
      } finally {
        if (old === undefined) delete process.env.B71_ANSWER_MODE;
        else process.env.B71_ANSWER_MODE = old;
      }
    });
  }
});

test("R08 pending 现 batch 接受 Splash route 并在缺预注册处停下，Strata 启动前拒绝", () => {
  const route = spawnSync("bash", ["scripts/native_b71_batch.sh", "--route", "b71-authoring-pending"],
    { encoding: "utf8" });
  assert.equal(route.status, 0, route.stderr);
  assert.match(route.stdout, /journey=pending .*seed=scripts\/seed_b71_authoring_pending\.exs/);
  const env = { ...process.env, B71_SLICE: "b71-authoring-pending", B71_LIVE_PREREGISTRATION: "",
    B71_AUTO_MAINTENANCE: "", B71_BEHAVIOR_CASE: "", B71_CONFIRMATION_ACTION: "",
    B71_ANSWER_MODE: "", B71_MEMORY_DETAIL: "" };
  for (const [provider, expected] of [["splash", /必须提供冻结的 B71_LIVE_PREREGISTRATION/],
    ["strata", /pending 实模场景只接受 Splash/]]) {
    const result = spawnSync("bash", ["scripts/native_b71_batch.sh", "r08-preflight-only"],
      { encoding: "utf8", env: { ...env, B71_PROVIDER: provider } });
    assert.equal(result.status, 64);
    assert.match(result.stderr, expected);
  }
});

const R08_BEHAVIOR_GROUPS = [
  { selector: "C-F3-R08-HISTORY-SOURCE", journey: "J-R08-SOURCE-HISTORY", sends: 12, seconds: 1800 },
  { selector: "C-F3-R08-QUOTED-SOURCE", journey: "J-R08-QUOTED-REVISION", sends: 4, seconds: 1200 },
  { selector: "C-F3-R08-ASSISTANT-REPLY", journey: "J-R08-ASSISTANT-SOURCE", sends: 2, seconds: 900 },
  { selector: "C-F4-R08-MISSING-SOURCE", journey: "J-R08-MISSING-SOURCE", sends: 1, seconds: 900 },
  { selector: "C-F2-004", journey: null, sends: 1, seconds: 900 },
  { selector: "C-F3-R08-SHORT-PAST-SOURCE", journey: null, sends: 1, seconds: 900 },
  { selector: "C-F4-R08-LONG-MISSING-SOURCE", journey: null, sends: 1, seconds: 900 },
  { selector: "C-F3-R08-CONDITION-BRANCH-SOURCE", journey: "J-R08-CONDITION-BRANCH", sends: 3, seconds: 1200 },
];

function behaviorPreregistration(dir, group) {
  const corpus = loadLiveCaseCorpus();
  const selected = corpus.caseById.get(group.selector);
  const raw = group.journey
    ? [...corpus.caseById.values()].filter((entry) => entry.journey_id === group.journey)
      .sort((left, right) => left.sequence - right.sequence)
    : [selected];
  const steps = raw.map((entry) => ({
    ...selectLiveCase(corpus, entry.id, { allowExplore: true }),
    ...(entry.journey_id ? { journey_id: entry.journey_id, sequence: entry.sequence } : {}),
  }));
  const value = {
    id: "r08-behavior-test",
    model: { provider: "splash", model: "local/Q4-PLE4", thinking: "enabled",
      reasoning_effort: "high", max_tokens: 32000, timeout_ms: 300000, context_window: 262144 },
    runtime: { profile: "b87-r01-controlled-splash-high",
      context_pressure: { window: 262144, maintenance_ratio: 0.70 },
      auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false },
    budget: { batches: 1, author_sends: group.sends, manual_retries: 0,
      input_timeout_ms: 120000, turn_timeout_ms: 360000, scenario_seconds: group.seconds },
    scenarios: [{
      id: group.journey ?? group.selector, slice_id: "b71-first-consumer",
      case_id: group.selector, message: selected.expression, steps,
      seed: { script: "scripts/seed_author_behavior_states.exs",
        sha256: shaFile(path.resolve("scripts/seed_author_behavior_states.exs")) },
      evidence: { dir },
    }],
  };
  writeJson(dir, "preregistration.json", value);
  return value;
}

function withBehavior(copy, group, fn) {
  const saved = Object.fromEntries(["B71_BEHAVIOR_CASE", "B71_AUTO_MAINTENANCE",
    "B71_CONFIRMATION_ACTION", "B71_ANSWER_MODE", "B71_MEMORY_DETAIL"].map((key) => [key, process.env[key]]));
  try {
    for (const key of Object.keys(saved)) delete process.env[key];
    process.env.B71_BEHAVIOR_CASE = group.selector;
    splashReady(copy.dir);
    writeJson(copy.dir, "runtime-facts.json", { ...splashRuntimeFacts(),
      context_pressure: { provider: "splash", window: 262144, maintenance_ratio: 0.70 } });
    seedLive(copy.dir);
    return fn(behaviorPreregistration(copy.dir, group));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("R08 behavior 已登记组直接冻结现 corpus steps、单work/session、原话和完整预期", () => {
  for (const group of R08_BEHAVIOR_GROUPS) {
    withWorkingCopy(template(), (copy) => withBehavior(copy, group, (manifest) => {
      prepare(copy.dir);
      const config = readConfig(copy.dir);
      assert.equal(config.journey, "behavior");
      assert.equal(config.provider, "splash");
      assert.equal(config.runtime.profile, "b87-r01-controlled-splash-high");
      assert.equal(config.runtime.observed.context_pressure.window, 262144);
      assert.equal(config.target.work_id, WORK);
      assert.equal(config.target.session_id, SESSION);
      assert.equal(config.message, manifest.scenarios[0].message);
      assert.deepEqual(config.steps, manifest.scenarios[0].steps);
      assert.equal(config.steps.length, group.sends);
      assert.equal(new Set(config.steps.map((step) => step.state_id)).size, 1);
      assert.deepEqual(config.budget, manifest.budget);
      assert.deepEqual(config.seed, manifest.scenarios[0].seed);
      assert.equal(config.preregistration.sha256, shaFile(path.join(copy.dir, "preregistration.json")));
      assert.equal(fs.existsSync(path.join(copy.dir, "strata-slot.json")), false);
      assert.equal(fs.existsSync(path.join(copy.dir, "behavior-case.json")), false);
    }));
  }
});

test("R08 behavior 启动前拒绝改字节、改expected、换序、漏步、重复步和预算", () => {
  const group = R08_BEHAVIOR_GROUPS[1];
  const mutations = [
    (v) => { v.scenarios[0].case_id = "C-F3-R08-HISTORY-SOURCE"; },
    (v) => { v.scenarios[0].id = "C-F1-003"; },
    (v) => { v.scenarios[0].steps[0].expression += "被补写"; },
    (v) => { v.scenarios[0].steps[1].expected.allowed_actions = ["reply"]; },
    (v) => { v.scenarios[0].steps.reverse(); },
    (v) => { v.scenarios[0].steps.pop(); },
    (v) => { v.scenarios[0].steps[1] = structuredClone(v.scenarios[0].steps[0]); },
    (v) => { v.scenarios[0].steps[1].state_id = "S1-partial-multichapter"; },
    (v) => { v.scenarios[0].seed.sha256 = "0".repeat(64); },
    (v) => { v.budget.author_sends += 1; },
    (v) => { v.budget.manual_retries = 1; },
    (v) => { v.model.reasoning_effort = "low"; },
    (v) => { v.model.max_tokens = 4096; },
    (v) => { v.runtime.profile = "b87-r03-splash-product-maintenance-budget"; },
  ];
  for (const mutate of mutations) {
    withWorkingCopy(template(), (copy) => withBehavior(copy, group, (manifest) => {
      mutate(manifest);
      writeJson(copy.dir, "preregistration.json", manifest);
      assert.throws(() => prepare(copy.dir), /冻结|case|steps|step|原文|expected|seed|预算|budget|runtime|profile|model|sequence|顺序/u);
      assert.equal(fs.existsSync(path.join(copy.dir, "native-b71-config.json")), false);
    }));
  }
});

test("R08 behavior readConfig 不能信任被改写的steps、预算或供应商副本", () => {
  withWorkingCopy(template(), (copy) => withBehavior(copy, R08_BEHAVIOR_GROUPS[0], () => {
    prepare(copy.dir);
    const original = readConfig(copy.dir);
    for (const mutate of [
      (v) => { v.steps[0].expression = "替换作者原文"; },
      (v) => { v.steps[11].expected.allowed_actions = ["reply"]; },
      (v) => { v.steps.reverse(); },
      (v) => { v.budget.author_sends = 1; },
      (v) => { v.provider = "strata"; },
    ]) {
      const forged = structuredClone(original);
      mutate(forged);
      writeJson(copy.dir, "native-b71-config.json", forged);
      assert.throws(() => readConfig(copy.dir), /冻结|预注册|steps|step|case|原文|budget|provider|供应商/u);
    }
  }));
});

test("R08 behavior 现batch在缺预注册处停止，Splash不得被旧Strata限定拒绝", () => {
  const env = { ...process.env, B71_PROVIDER: "splash", B71_SLICE: "b71-first-consumer",
    B71_BEHAVIOR_CASE: "C-F3-R08-HISTORY-SOURCE", B71_LIVE_PREREGISTRATION: "",
    B71_AUTO_MAINTENANCE: "", B71_CONFIRMATION_ACTION: "", B71_ANSWER_MODE: "", B71_MEMORY_DETAIL: "" };
  const result = spawnSync("bash", ["scripts/native_b71_batch.sh", "r08-behavior-preflight-only"],
    { encoding: "utf8", env });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /必须提供冻结的 B71_LIVE_PREREGISTRATION/);
  assert.doesNotMatch(result.stderr, /只接受 B71_PROVIDER=strata/);
});


async function listenSessionCaptureServer(server) {
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  return server.address().port;
}

async function closeSessionCaptureServer(server, stop) {
  const closed = server.listening ? once(server, "close") : null;
  stop();
  server.closeAllConnections();
  if (closed) await closed;
}

for (const { encoding, corruptRecordedBody = false } of [
  { encoding: "identity" },
  { encoding: "gzip" },
  { encoding: "identity", corruptRecordedBody: true },
]) {
  const name = corruptRecordedBody
    ? "R08 capture CLI 拒绝落盘body被替换但原响应hash未变"
    : `R08 capture CLI 经真实transport读取${encoding}原响应并保留session证据`;
  test(name,
    { timeout: 30_000 }, async () => {
      const copy = createWorkingCopy(template());
      let upstream, proxy;
      let bodyMutationApplied = false, bodyMutationFailure = null;
      try {
        withBehavior(copy, R08_BEHAVIOR_GROUPS[3], () => prepare(copy.dir));
        const body = {
          work: { id: WORK },
          session: { id: SESSION, work_id: WORK, status: "ACTIVE" },
          read_only: false,
          transcript: [],
          transcript_page: { returned_count: 0, has_more: true },
          pending_adoptions: [
            { artifact_id: "as_writer", adoption_status: "TENTATIVE", source_session_id: SESSION },
            { artifact_id: "as_direct", adoption_status: "TENTATIVE", source_session_id: SESSION },
          ],
          pending_adoption_turn_results: [{
            turn_id: "source-turn",
            adoption_state: { pending: [
              { artifact_id: "as_writer", adoption_status: "TENTATIVE" },
              { artifact_id: "as_resolved", adoption_status: "TENTATIVE" },
            ], resolved: [] },
          }],
          resolved_adoptions: [{ artifact_id: "as_resolved", adoption_status: "ACCEPTED" }],
          inbox_pending_adoptions: [{
            artifact_id: "as_inbox", adoption_status: "TENTATIVE", source_session_id: "other-session",
          }],
          inbox_pending_adoption_turn_results: [],
          inbox_resolved_adoptions: [],
          source_note: "两空格  与换行\n均来自原始回包",
        };
        const raw = Buffer.from(JSON.stringify(body, null, 2) + "\n", "utf8");
        const encoded = encoding === "gzip" ? gzipSync(raw) : raw;
        const expectedHash = createHash("sha256").update(raw).digest("hex");
        assert.notEqual(expectedHash, createHash("sha256").update(JSON.stringify(body)).digest("hex"));
        const expectedPath = `/api/works/${WORK}/sessions/${SESSION}`;
        const seen = [], proxied = [];
        upstream = http.createServer((request, response) => {
          seen.push({ method: request.method, path: request.url });
          if (request.method !== "GET" || request.url !== expectedPath) {
            response.writeHead(405);
            response.end();
            return;
          }
          response.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Encoding": encoding,
            "Content-Length": encoded.length,
          });
          response.end(encoded);
        });
        const backendPort = await listenSessionCaptureServer(upstream);
        const logPath = path.join(copy.dir, "native-transport.jsonl");
        fs.writeFileSync(logPath, "");
        proxy = createQuestionTransportProxy({
          target: `http://127.0.0.1:${backendPort}`,
          controlPath: path.join(copy.dir, "transport-control.json"),
          logPath,
        });
        proxy.server.on("request", (request, response) => {
          proxied.push({ method: request.method, path: request.url });
          if (corruptRecordedBody) response.once("finish", () => {
            try {
              // 原代理先记录完整响应，再结束下游；只破坏隔离证据，不改变真实回包。
              const records = fs.readFileSync(logPath, "utf8").trim().split("\n")
                .map((line) => JSON.parse(line));
              const record = records.at(-1);
              record.body.pending_adoptions = [{
                artifact_id: "as_replaced", adoption_status: "TENTATIVE", source_session_id: SESSION,
              }];
              fs.writeFileSync(logPath, records.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
              bodyMutationApplied = true;
            } catch (error) {
              bodyMutationFailure = error;
            }
          });
        });
        const transportPort = await listenSessionCaptureServer(proxy.server);
        const readyFile = path.join(copy.dir, "native-driver-ready.json");
        const readyValue = JSON.parse(fs.readFileSync(readyFile, "utf8"));
        writeJson(copy.dir, "native-driver-ready.json", {
          ...readyValue, api_url: `http://127.0.0.1:${backendPort}`,
          owned_ports: { backend: backendPort, transport: transportPort,
            provider_stream: null, provider_stream_control: null },
        });

        if (corruptRecordedBody) {
          const failure = await evidenceMain(["capture", copy.dir, "start"])
            .then(() => null, (error) => error);
          assert.ifError(bodyMutationFailure);
          assert.equal(bodyMutationApplied, true, "负例必须实际改动代理已落盘的body");
          assert.notEqual(failure, null, "落盘body与真实HTTP回包不同时必须拒收");
          assert.match(failure.message, /session capture/);
          assert.deepEqual(seen, [{ method: "GET", path: expectedPath }]);
          assert.deepEqual(proxied, seen);
          const records = fs.readFileSync(logPath, "utf8").trim().split("\n")
            .map((line) => JSON.parse(line));
          assert.equal(records.length, 1);
          assert.equal(records[0].body_state.sha256, expectedHash, "原HTTP字节hash仍然真实");
          assert.deepEqual(records[0].body.pending_adoptions.map((entry) => entry.artifact_id), ["as_replaced"]);
          assert.notDeepEqual(records[0].body, body);
          assert.equal(fs.existsSync(path.join(copy.dir, "b71-start.json")), false);
          return;
        }

        await evidenceMain(["capture", copy.dir, "start", "step-0-before"]);

        assert.deepEqual(seen, [
          { method: "GET", path: expectedPath }, { method: "GET", path: expectedPath },
        ]);
        assert.deepEqual(proxied, seen, "两个GET必须逐个经过transport，不能直连backend");
        const records = fs.readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        assert.equal(records.length, 2);
        assert.equal(new Set(records.map((record) => record.request_id)).size, 2);
        const checkpoints = ["start", "step-0-before"].map((name) =>
          JSON.parse(fs.readFileSync(path.join(copy.dir, `b71-${name}.json`), "utf8")));
        for (const [index, checkpoint] of checkpoints.entries()) {
          const record = records[index];
          assert.deepEqual(checkpoint.session_capture, record);
          assert.deepEqual(record.body, body, "原始body及源TurnResult不能被裁剪或重算");
          assert.deepEqual(record.response_scope, {
            kind: "session_show", work_id: WORK, session_id: SESSION, turn_id: null,
          });
          assert.equal(record.body_state.sha256, expectedHash);
          assert.equal(record.body_state.bytes, encoded.length);
          assert.equal(record.body_state.content_encoding, encoding);
          assert.equal(record.body_state.complete, true);
          assert.equal(record.body_state.truncated, false);
          assert.equal(checkpoint.session_capture_window.body_sha256, expectedHash);
          assert(checkpoint.session_capture_window.started_at <= record.at);
          assert(record.at <= checkpoint.session_capture_window.completed_at);
          assert.deepEqual(checkpoint.state_facts.pending_artifact_ids, ["as_direct", "as_writer"]);
          assert.equal(checkpoint.state_facts.pending_artifact_count, 2);
        }
        assert(checkpoints[0].session_capture_window.completed_at <=
          checkpoints[1].session_capture_window.started_at);
      } finally {
        try {
          if (proxy) await closeSessionCaptureServer(proxy.server, () => proxy.close());
        } finally {
          try {
            if (upstream) await closeSessionCaptureServer(upstream, () => upstream.close());
          } finally {
            copy.cleanup();
          }
        }
      }
    });
}
function sessionStateCapture(ids = []) {
  const body = {
    work: { id: WORK }, session: { id: SESSION, work_id: WORK, status: "ACTIVE" },
    read_only: false, transcript: [], transcript_page: { has_more: true },
    pending_adoptions: ids.map((artifact_id) => ({ artifact_id, adoption_status: "TENTATIVE" })),
    pending_adoption_turn_results: [], resolved_adoptions: [],
    inbox_pending_adoptions: [{ artifact_id: "other-session-pending", adoption_status: "TENTATIVE" }],
  };
  return {
    direction: "http", method: "GET", path: `/api/works/${WORK}/sessions/${SESSION}`,
    at: "2026-11-23T13:00:00.000Z", request_id: "http-session-checkpoint", status: 200,
    scope: { kind: "session_show", work_id: WORK, session_id: SESSION, turn_id: null },
    response_scope: { kind: "session_show", work_id: WORK, session_id: SESSION, turn_id: null },
    body_state: { complete: true, json: "valid", truncated: false, sha256: sha256(JSON.stringify(body)) }, body,
  };
}

function sessionStateWindow(record) {
  return {
    started_at: "2026-11-23T12:59:59.999Z", completed_at: "2026-11-23T13:00:00.001Z",
    body_sha256: record?.body_state?.sha256 ?? null,
  };
}

function checkpointSessionEvidence(ids = []) {
  const sessionCapture = sessionStateCapture(ids);
  return { sessionCapture, sessionCaptureWindow: sessionStateWindow(sessionCapture) };
}


test("R08 checkpoint 从真实session show保存直接登记及Writer候选，不能依赖AgentRun并集", () => {
  for (const [ids, stale] of [
    [["direct-registration"], []],
    [["direct-registration", "writer-candidate"], ["writer-candidate"]],
    [["remaining"], ["already-accepted", "already-discarded", "remaining"]],
    [["historical-before-visible-page"], ["historical-before-visible-page", "historical-before-visible-page"]],
  ]) withWorkingCopy(template(), (copy) => withBehavior(copy, R08_BEHAVIOR_GROUPS[3], () => {
    const db = new DatabaseSync(path.join(copy.dir, CAPTURE_DB_REL));
    try {
      db.prepare("INSERT INTO agent_runs (id, work_id, session_id, pending_artifact_refs) VALUES (?, ?, ?, ?)")
        .run("history-run", WORK, SESSION, JSON.stringify(stale));
      prepare(copy.dir);
      const source = sessionStateCapture(ids);
      capture(copy.dir, "start", { sessionCapture: source, sessionCaptureWindow: sessionStateWindow(source) });
      const actual = JSON.parse(fs.readFileSync(path.join(copy.dir, "b71-start.json"), "utf8"));
      assert.equal(actual.state_facts.pending_artifact_count, ids.length);
      assert.deepEqual(actual.state_facts.pending_artifact_ids, [...ids].sort());
      assert.deepEqual(actual.session_capture, source, "原始响应与采集身份必须保留");
    } finally { db.close(); }
  }));
});

test("R08 checkpoint 缺少或不完整的同会话show不能补零、借inbox或历史run授信", () => {
  const mutations = [
    () => null,
    (r) => { delete r.request_id; },
    (r) => { r.method = "POST"; },
    (r) => { r.path += "/resume"; },
    (r) => { r.status = 500; },
    (r) => { r.body_state.complete = false; },
    (r) => { r.body_state.truncated = true; },
    (r) => { r.scope.work_id = "other-work"; },
    (r) => { r.scope.session_id = "other-session"; },
    (r) => { r.body.work.id = "other-work"; },
    (r) => { r.body.session.id = "other-session"; },
    (r) => { r.body.session.work_id = "other-work"; },
    (r) => { r.body.session.status = "ARCHIVED"; },
    (r) => { r.body.read_only = true; },
    (r) => { delete r.body.pending_adoptions; },
    (r) => { r.body.pending_adoptions = null; },
    (r) => { r.body.pending_adoptions = [{ artifact_id: "", adoption_status: "TENTATIVE" }]; },
    (r) => { r.body.pending_adoptions = [{ artifact_id: "a" }, { artifact_id: "a" }]; },
    (r) => { r.body.pending_adoptions = [{ artifact_id: "accepted", adoption_status: "ACCEPTED" }]; },
    (r) => { delete r.body.pending_adoption_turn_results; },
    (r) => { delete r.body.resolved_adoptions; },
    (r) => { r.body.resolved_adoptions = [{ artifact_id: "a", adoption_status: "DISCARDED" }];
      r.body.pending_adoptions = [{ artifact_id: "a", adoption_status: "TENTATIVE" }]; },
  ];
  for (const mutate of mutations) withWorkingCopy(template(), (copy) =>
    withBehavior(copy, R08_BEHAVIOR_GROUPS[3], () => {
      prepare(copy.dir);
      const input = sessionStateCapture();
      const result = mutate(input);
      const source = result === null ? null : input;
      assert.throws(() => capture(copy.dir, "start", { sessionCapture: source, sessionCaptureWindow: sessionStateWindow(source) }),
        /session|capture|scope|pending|会话|采集|身份|响应|状态/u);
      assert.equal(fs.existsSync(path.join(copy.dir, "b71-start.json")), false);
    }));
});


test("R08 session checkpoint 拒绝早已在途响应、缺窗口或原字节hash不一致", () => {
  for (const mutate of [
    (proof) => { delete proof.sessionCaptureWindow; },
    (proof) => { proof.sessionCaptureWindow.started_at = "2026-11-23T13:00:00.001Z"; },
    (proof) => { proof.sessionCaptureWindow.completed_at = "2026-11-23T12:59:59.999Z"; },
    (proof) => { proof.sessionCaptureWindow.body_sha256 = "0".repeat(64); },
    (proof) => { proof.sessionCapture.at = "2026-11-23T12:59:00.000Z"; },
    (proof) => { delete proof.sessionCapture.body_state.sha256; },
    (proof) => { delete proof.sessionCapture.response_scope; },
  ]) withWorkingCopy(template(), (copy) => withBehavior(copy, R08_BEHAVIOR_GROUPS[3], () => {
    prepare(copy.dir);
    const proof = checkpointSessionEvidence();
    mutate(proof);
    assert.throws(() => capture(copy.dir, "start", proof), /session|capture|window|hash|scope|窗口|采集|身份|响应/u);
    assert.equal(fs.existsSync(path.join(copy.dir, "b71-start.json")), false);
  }));
});

test("R08 behavior checkpoint 从各轮真实边界读状态，仅计同work/session候选", () => {
  withWorkingCopy(template(), (copy) => withBehavior(copy, R08_BEHAVIOR_GROUPS[1], () => {
    const db = new DatabaseSync(path.join(copy.dir, CAPTURE_DB_REL));
    try {
      db.exec("DELETE FROM chapters");
      const foreignWork = "f1000000-0000-4000-8000-000000000001";
      const foreignChapter = "f2000000-0000-4000-8000-000000000001";
      db.prepare("INSERT INTO works (id, title) VALUES (?, ?)").run(foreignWork, "另一作品");
      db.prepare("INSERT INTO chapters (id, work_id, title, seq) VALUES (?, ?, ?, ?)").run(
        foreignChapter, foreignWork, "另一作品的章节", 1);
      db.prepare("INSERT INTO drafts (id, work_id, chapter_id, status, text) VALUES (?, ?, ?, ?, ?)").run(
        "f3000000-0000-4000-8000-000000000001", foreignWork, foreignChapter, "ACCEPTED", "另一作品正文");
      db.prepare("INSERT INTO memory_items (id, work_id, reference_count, last_referenced_at) VALUES (?, ?, ?, ?)").run(
        "f4000000-0000-4000-8000-000000000001", foreignWork, 0, null);
      const insertRun = db.prepare("INSERT INTO agent_runs (id, work_id, session_id, pending_artifact_refs) VALUES (?, ?, ?, ?)");
      insertRun.run("foreign-run", foreignWork, SESSION, '["foreign-pending"]');
      insertRun.run("other-session-run", WORK, "other-session", '["other-session-pending"]');
      prepare(copy.dir);
      assert.throws(() => capture(copy.dir, "step-0-after"), /step-0-before/);
      assert.throws(() => capture(copy.dir, "step-1-before"), /step-0-after/);
      assert.throws(() => capture(copy.dir, "step-4-before"), /未知 checkpoint/);
      capture(copy.dir, "start", checkpointSessionEvidence());
      capture(copy.dir, "step-0-before", checkpointSessionEvidence());
      insertRun.run("current-run", WORK, SESSION, '["current-pending"]');
      capture(copy.dir, "step-0-after", checkpointSessionEvidence(["current-pending"]));
      capture(copy.dir, "step-1-before", checkpointSessionEvidence(["current-pending"]));
      const before = JSON.parse(fs.readFileSync(path.join(copy.dir, "b71-step-0-before.json"), "utf8"));
      const after = JSON.parse(fs.readFileSync(path.join(copy.dir, "b71-step-0-after.json"), "utf8"));
      const next = JSON.parse(fs.readFileSync(path.join(copy.dir, "b71-step-1-before.json"), "utf8"));
      assert.deepEqual(before.state_facts, {
        chapters_rows: [], drafts_rows: [], memory_count: 0, pending_artifact_count: 0, pending_artifact_ids: [],
      });
      assert.deepEqual(after.state_facts, { ...before.state_facts, pending_artifact_count: 1, pending_artifact_ids: ["current-pending"] });
      assert.deepEqual(next.state_facts, after.state_facts);
      // 中途合法待答可以结束采集；缺失后继仍由 verifier 据真实步骤拒绝签完整组。
      capture(copy.dir, "final", checkpointSessionEvidence(["current-pending"]));
      assert.throws(() => capture(copy.dir, "step-0-after", checkpointSessionEvidence(["current-pending"])), /证据不得覆盖/);
    } finally {
      db.close();
    }
  }));
});

test("R08 behavior 状态读取失败或pending字段缺失不能冒充显式零", () => {
  for (const missingTable of [false, true]) {
    withWorkingCopy(template(), (copy) => withBehavior(copy, R08_BEHAVIOR_GROUPS[3], () => {
      const db = new DatabaseSync(path.join(copy.dir, CAPTURE_DB_REL));
      try {
        db.exec("DELETE FROM chapters");
        const proof = checkpointSessionEvidence();
        if (missingTable) db.exec("DROP TABLE memory_items");
        else delete proof.sessionCapture.body.pending_adoptions;
        prepare(copy.dir);
        assert.throws(() => capture(copy.dir, "start", proof), /memory_items|pending|capture/);
        assert.equal(fs.existsSync(path.join(copy.dir, "b71-start.json")), false);
      } finally {
        db.close();
      }
    }));
  }
});

test("R08 behavior 的启动与读取共用登记合同，缺selector或换seed目标即拒绝", () => {
  withWorkingCopy(template(), (copy) => withBehavior(copy, R08_BEHAVIOR_GROUPS[3], () => {
    assert.throws(() => validatePreregistrationFile(path.join(copy.dir, "preregistration.json"), {
      dir: copy.dir, provider: "splash", b71Live: true,
    }), /behavior.*启动 case/);
    prepare(copy.dir);
    const config = readConfig(copy.dir);
    for (const field of ["work_id", "session_id"]) {
      const forged = structuredClone(config);
      forged.target[field] = "foreign-target";
      writeJson(copy.dir, "native-b71-config.json", forged);
      assert.throws(() => readConfig(copy.dir), /target.*seed work\/session/);
    }
  }));
});

test("R08 退役 Strata 裸behavior入口：capture在任何seed/runtime前拒绝旧pilot", () => {
  const keys = ["B71_BEHAVIOR_CASE", "B71_AUTO_MAINTENANCE", "B71_CONFIRMATION_ACTION",
    "B71_ANSWER_MODE", "B71_MEMORY_DETAIL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.B71_BEHAVIOR_CASE = "C-F1-003";
    for (const hasSeed of [true, false]) {
      withWorkingCopy(template(), (copy) => {
        liveReady(copy.dir);
        if (hasSeed) seedLive(copy.dir);
        assert.throws(() => prepare(copy.dir), /Strata.*behavior.*退役|behavior.*Strata.*退役/);
        assert.equal(fs.existsSync(path.join(copy.dir, "native-b71-config.json")), false);
        assert.equal(fs.existsSync(path.join(copy.dir, "production-sources-before.json")), false);
      });
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("R08 退役 Strata 裸behavior入口：shell在任何初始化前拒绝", () => {
  const guard = tempDir("retired-behavior-guard-");
  fs.writeFileSync(path.join(guard, "mkdir"),
    "#!/bin/sh\nprintf '%s\\n' 'r08-retired-behavior-setup-reached' >&2\nexit 77\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${guard}:${process.env.PATH ?? ""}`,
    B71_PROVIDER: "strata", B71_SLICE: "b71-first-consumer", B71_BEHAVIOR_CASE: "C-F1-003",
    B71_LIVE_PREREGISTRATION: "", B71_AUTO_MAINTENANCE: "", B71_CONFIRMATION_ACTION: "",
    B71_ANSWER_MODE: "", B71_MEMORY_DETAIL: "" };
  const result = spawnSync("bash", ["scripts/native_b71_batch.sh", "r08-retired-behavior"],
    { encoding: "utf8", env, timeout: 10000 });
  assert.equal(result.status, 64, result.stderr);
  assert.match(result.stderr, /Strata.*behavior.*退役|behavior.*Strata.*退役/);
  assert.doesNotMatch(result.stderr, /r08-retired-behavior-setup-reached/);
});
