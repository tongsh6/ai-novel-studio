// B41 CP1：manifest 的真实 IO/接线测试（B84 A1/A2 拆分）。
// 运行：node --test scripts/lib/quality/manifest_io.test.mjs
//
// 这里只验证需要真实文件/YAML/目录枚举的边界：标准 YAML 解析、重复键、
// 缺文件/未注册文件发现、driver 存在性事实与真实仓库接线。纯语义规则与
// “零 fs/子进程”证明在 manifest.test.mjs；两者共用 manifest_fixture.mjs。
//
// 只读 fixture 由外层 run scope 原子发布一次；每个会改文件的负例先取隔离
// 工作副本，不修改模板；工作副本通过真实 TestContext(t.after) 回收。
// 本文件所有临时路径都归属已开 scope（case 隔离目录在 scope.tmpDir 内），
// case hook 异常时由文件级 after 的 close 兜底，不落到进程全局 TMPDIR。
//
// 作用域申请与 fixture 初始化放在 before 内：裸 node 入口若在模块求值阶段
// 初始化失败，node:test 尚未进入 hooks 生命周期，after 不会执行，owned scratch
// 会残留。before 抛错后 Node 仍执行 after（v24 实测），因此收口统一由 after
// 检查 close 事实；cleanup 失败会抛错让 framework 真实失败，借用 scope 只归还。

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_PROJECT_ROOT,
  collectScenarioManifestFiles,
  idsByTier,
  loadProject,
  loadRegistry,
  parseYamlFiles,
  validate,
  validateProject,
} from "./manifest.mjs";
import {
  DRIVER_PATH,
  REPAIRED_YAML,
  SCENARIO_IDS,
  fixtureProjectSpec,
  minimalManifest,
} from "./manifest_fixture.mjs";
import { createWorkingCopy, materializeFixture, openTestRunScope } from "../test_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let scope;
let fixture;

before(() => {
  scope = openTestRunScope();
  fixture = materializeFixture(fixtureProjectSpec(), { scope });
});

after(() => {
  // 清理失败直接抛给 framework；借用 scope 的 close 只归还，不删除父 scope。
  if (scope) scope.close();
});

function manifestPath(id) {
  return `quality/acceptance/scenarios/${id}.yml`;
}

function indexFile(dir) {
  return path.join(dir, "quality/acceptance/scenarios.yml");
}

function workingCopy(t) {
  return createWorkingCopy(fixture, { scope, context: t });
}

function writeFakeExecutable(binDir, name) {
  fs.writeFileSync(
    path.join(binDir, name),
    `#!/bin/sh\nprintf "%s %s\\n" "$0" "$*" >> "$SPAWN_LOG"\n`,
    { mode: 0o755 },
  );
}

// 零 IO 边界证明：validateProject 消费内存 Project/事实值，不读文件、不启动子进程。
// 这是真实进程/fs 边界证据，因此与 YAML/目录 IO 一起放在本文件；纯规则文件只留内存断言。
test("IO 边界：validateProject 不触发 fs/子进程/DB 初始化", (t) => {
  const binDir = fs.mkdtempSync(path.join(scope.tmpDir, "quality-manifest-pure-bin-"));
  assert.ok(binDir.startsWith(`${scope.tmpDir}${path.sep}`), "临时目录必须归属当前 run scope");
  const logPath = path.join(binDir, "spawn.log");
  t.after(() => fs.rmSync(binDir, { recursive: true, force: true }));
  writeFakeExecutable(binDir, "python3");
  writeFakeExecutable(binDir, "mix");

  const manifestUrl = pathToFileURL(path.join(HERE, "manifest.mjs")).href;
  const fixtureUrl = pathToFileURL(path.join(HERE, "manifest_fixture.mjs")).href;
  const probe = `
import fs from "node:fs";
const { validateProject } = await import(${JSON.stringify(manifestUrl)});
const { memoryFixtureProject } = await import(${JSON.stringify(fixtureUrl)});
const realExists = fs.existsSync.bind(fs);
const realRead = fs.readFileSync.bind(fs);
let fsCalls = 0;
for (const name of ["existsSync", "readdirSync", "readFileSync", "statSync", "openSync"]) {
  fs[name] = () => {
    fsCalls += 1;
    throw new Error("unexpected fs." + name);
  };
}
let errors = [];
try {
  errors = validateProject(memoryFixtureProject()).errors;
} catch (error) {
  errors = [String(error && error.message ? error.message : error)];
}
const spawnLog = realExists(process.env.SPAWN_LOG)
  ? String(realRead(process.env.SPAWN_LOG, "utf8")).trim()
  : "";
process.stdout.write(JSON.stringify({ errors, fs_calls: fsCalls, spawn_log: spawnLog }));
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      SPAWN_LOG: logPath,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []);
  assert.equal(report.fs_calls, 0, "纯规则路径不得读取文件系统");
  assert.equal(report.spawn_log, "", "纯规则路径不得启动 YAML/DB 子进程");
});

test("真实仓库：manifest 校验通过，声明集合与目录枚举完全一致", () => {
  const { project, errors } = validate(DEFAULT_PROJECT_ROOT);
  assert.deepEqual(errors, []);
  const scenarioIds = project.scenarios.map((entry) => entry.id);
  const draftIds = project.drafts.map((entry) => entry.id);
  assert.equal(new Set(scenarioIds).size, scenarioIds.length, "scenario id 重复");
  assert.equal(new Set(draftIds).size, draftIds.length, "draft id 重复");
  for (const id of draftIds) assert.equal(scenarioIds.includes(id), false, `draft ${id} 同时 active`);

  const declared = [...project.scenarios, ...project.drafts].map((entry) => entry.manifest).sort();
  const files = collectScenarioManifestFiles(DEFAULT_PROJECT_ROOT);
  assert.deepEqual(declared, files, "registry 声明与 scenarios/ 目录枚举不一致");
  assert.deepEqual(project.manifestFiles, files, "loadProject 未记录实际目录 manifest 列表");
  assert.deepEqual([...project.files.keys()].sort(), files, "project.files 未精确覆盖声明文件");
  for (const entry of [...project.scenarios, ...project.drafts]) {
    assert.ok(
      entry.manifest.startsWith("quality/acceptance/scenarios/"),
      `manifest 越界: ${entry.manifest}`,
    );
  }
  for (const scenario of project.scenarios) {
    assert.ok(
      project.existingDrivers.has(scenario.driver),
      `loadProject 未记录已存在 driver: ${scenario.driver}`,
    );
  }
});

test("自足 IO fixture：精确计数 + 只读复用 + 文件事实与声明一致", () => {
  const project = loadProject(fixture.dir);
  assert.equal(project.scenarios.length, 5);
  assert.equal(project.drafts.length, 0);
  assert.equal(project.files.size, 5);
  const expected = SCENARIO_IDS.map(manifestPath).sort();
  assert.deepEqual(project.manifestFiles, expected);
  assert.deepEqual([...project.files.keys()].sort(), expected);
  assert.ok(project.existingDrivers.has(DRIVER_PATH));
  assert.deepEqual(validateProject(project).errors, []);

  // 同 run 两次申请同一规格：沿用同一不可变模板，只物化一次。
  const again = materializeFixture(fixtureProjectSpec(), { scope });
  assert.equal(again.dir, fixture.dir);
  const materialized = fs
    .readdirSync(scope.fixturesDir)
    .filter((name) => name.startsWith(`${fixture.name}-`));
  assert.deepEqual(materialized, [path.basename(fixture.dir)]);
});

test("缺 manifest 文件必须被真实目录/解析边界发现", (t) => {
  const copy = workingCopy(t);
  fs.unlinkSync(copy.files.get(manifestPath("alpha-three")));
  const { errors } = validateProject(loadProject(copy.dir));
  assert.ok(
    errors.some(
      (error) =>
        error.includes("alpha-three.yml") &&
        (error.includes("manifest 缺失") || error.includes("YAML 解析失败")),
    ),
    errors.join("\n"),
  );
});

test("未注册 manifest 必须失败；登记为 draft 后通过并永不执行", (t) => {
  const copy = workingCopy(t);
  const draftManifest = "quality/acceptance/scenarios/stray-draft.yml";
  fs.writeFileSync(
    path.join(copy.dir, draftManifest),
    `${JSON.stringify(
      minimalManifest("stray-draft", {
        tier: "deterministic",
        surface: "test",
        status_note: "fixture draft",
      }),
    )}\n`,
  );

  let project = loadProject(copy.dir);
  assert.ok(
    validateProject(project).errors.some(
      (error) => error.includes("stray-draft.yml") && error.includes("未注册"),
    ),
  );

  fs.appendFileSync(
    indexFile(copy.dir),
    [
      "drafts:",
      "  - id: stray-draft",
      `    manifest: ${draftManifest}`,
      '    reason: "fixture draft not registered for execution"',
      "",
    ].join("\n"),
  );

  project = loadProject(copy.dir);
  assert.deepEqual(validateProject(project).errors, []);
  assert.equal(project.files.size, 6);
  assert.deepEqual(idsByTier(project, "nightly"), [...SCENARIO_IDS]);
  assert.equal(idsByTier(project, "nightly").includes("stray-draft"), false);
});

test("非法 YAML 必须硬失败（含行号）", (t) => {
  const copy = workingCopy(t);
  fs.writeFileSync(
    copy.files.get(manifestPath("alpha-one")),
    "id: alpha-one\ntitle: broken\n  unexpected: indent\n",
  );
  const { errors } = validateProject(loadProject(copy.dir));
  assert.ok(
    errors.some(
      (error) =>
        error.includes("alpha-one.yml") &&
        error.includes("YAML 解析失败") &&
        /:\d+:\d+/u.test(error),
    ),
    errors.join("\n"),
  );
});

test("YAML 重复键必须硬失败", (t) => {
  const copy = workingCopy(t);
  const file = copy.files.get(manifestPath("alpha-two"));
  const content = fs.readFileSync(file, "utf8");
  const duplicated = content.replace('"tier":"nightly"', '"tier":"nightly","tier":"nightly"');
  assert.notEqual(content, duplicated);
  fs.writeFileSync(file, duplicated);
  const { errors } = validateProject(loadProject(copy.dir));
  assert.ok(
    errors.some((error) => error.includes("duplicate key")),
    errors.join("\n"),
  );
});

test("driver 存在性来自 loadProject 事实，删除后必须失败", (t) => {
  const copy = workingCopy(t);
  fs.unlinkSync(copy.files.get(DRIVER_PATH));
  const project = loadProject(copy.dir);
  assert.equal(project.existingDrivers.has(DRIVER_PATH), false);
  const { errors } = validateProject(project);
  assert.ok(
    errors.some((error) => error.includes("driver 缺失") && error.includes(DRIVER_PATH)),
    errors.join("\n"),
  );
});

test("真实仓库：CP0 修复的 3 个 YAML 可被标准解析器读取（回归）", () => {
  const bundle = parseYamlFiles(DEFAULT_PROJECT_ROOT, REPAIRED_YAML);
  for (const record of bundle.files) {
    assert.equal(record.ok, true, `${record.path}: ${record.error}`);
  }
});

test("registry 解析失败给出可读错误（含行号）", (t) => {
  const copy = workingCopy(t);
  fs.writeFileSync(indexFile(copy.dir), "scenarios:\n  - id: broken\n    tier: [unclosed\n");
  assert.throws(
    () => loadRegistry(copy.dir),
    (error) => error.message.includes("scenarios.yml") && /:\d+:\d+/u.test(error.message),
  );
});

test("场景 manifest 文件集合只包含 scenarios/ 下 yml", () => {
  const files = collectScenarioManifestFiles(DEFAULT_PROJECT_ROOT);
  assert.ok(
    files.every(
      (file) => file.startsWith("quality/acceptance/scenarios/") && file.endsWith(".yml"),
    ),
  );
});
