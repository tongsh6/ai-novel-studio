// B84 A2：AU-15 准备检查器的真实 CLI/IO 测试（原 CLI 真 IO 用例迁出纯规则文件）。
// 运行：node --test scripts/lib/quality/au15_preregistration_check_io.test.mjs
//
// 只读前置由外层 run scope 在 before 内一次物化；每个负例先取隔离工作副本
// （createWorkingCopy），报告只写副本根。缺文件/坏 JSON/YAML/非 mapping 在读边界
// 非零，且读取校验前不创建输出目录；报告生成成功可 exit 0（仅表示报告生成，不表示
// 运行通过）。
//
// 真实边界不是靠测试读真实 artifact 后比对 hash，而是用 Node 标准 `--import`
// 给真正的 CLI 入口（node CHECKER --root ...）装一个共享静态 preload。preload 只
// 装配 fs hooks，不 import/call SUT；argv、invokedDirectly、main 与 process.exitCode
// 都由实际 CLI 文件执行。CLI 代码本身不感知验收开关；guard 拒绝访问真实
// repo/artifacts（测试自有 scope 例外），并把拒绝事实写到本进程的 worker 日志。
// 诊断程序是独立 `--eval` 模块，用静态命名 `readFileSync` 负控制证明 hook 作用到
// named import。
//
// 同一外层 run 可被串行/并行启动多次，因此这里区分两类路径：
//   - run 只读资产：项目模板与固定 GUARD_SOURCE 都经 materializeFixture 按内容
//     指纹唯一物化，同 run 的所有进程复用同一 preload，不各自重写；
//   - worker 可变隔离：每个测试进程在 before 用 mkdtemp 申请自己的 worker 目录，
//     guard 日志与哨兵都只落在这里；after 先核对日志，再释放自己的叶子，最后
//     close scope（借用只归还，不碰父目录或别的 worker）。
// 本文件不初始化仓内 tmp，不依赖预建 repo/tmp。

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWorkingCopy, materializeFixture, openTestRunScope } from "../test_env.mjs";
import { main } from "../../au15_preregistration_check.mjs";
import {
  OUT_DIR,
  PREREG_PATH,
  SCENARIO_PATH,
  fixtureProjectSpec,
} from "./au15_preregistration_fixture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const CHECKER = path.join(REPO_ROOT, "scripts/au15_preregistration_check.mjs");
const REAL_ARTIFACTS_ROOT = path.join(REPO_ROOT, "artifacts");
const REAL_PREREG = path.join(REPO_ROOT, PREREG_PATH);

// 共享静态 guard：作为 Node 标准 ESM preload 装配 fs hooks，不 import/call SUT。
// 内容固定，不含任何 case 的绝对路径；真实/允许根与日志路径全部由测试侧 env 传入。
const GUARD_SOURCE = `
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

const realArtifacts = path.resolve(process.env.AU15_GUARD_REAL_ROOT);
const allowedRoots = (process.env.AU15_GUARD_ALLOWED || "")
  .split(path.delimiter)
  .filter(Boolean)
  .map((entry) => path.resolve(entry));
const denialLog = process.env.AU15_GUARD_LOG || "";

function within(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const originalAppendFileSync = fs.appendFileSync;
function deny(target) {
  if (denialLog) {
    originalAppendFileSync(denialLog, JSON.stringify({ path: target }) + "\\n");
  }
  const error = new Error("au15-real-artifact-guard: denied " + target);
  error.code = "AU15_GUARD_DENIED";
  return error;
}

function check(target) {
  if (typeof target !== "string" && !(target instanceof URL)) return;
  const absolute = path.resolve(target instanceof URL ? target.pathname : target);
  if (!within(absolute, realArtifacts)) return;
  if (allowedRoots.some((root) => within(absolute, root))) return;
  throw deny(absolute);
}

for (const name of [
  "readFileSync",
  "writeFileSync",
  "appendFileSync",
  "existsSync",
  "statSync",
  "lstatSync",
  "readdirSync",
  "mkdirSync",
  "rmSync",
  "openSync",
  "accessSync",
  "copyFileSync",
  "renameSync",
  "unlinkSync",
]) {
  const original = fs[name];
  fs[name] = function (target, ...rest) {
    check(target);
    return original.call(this, target, ...rest);
  };
}
syncBuiltinESMExports();
`;

// 诊断程序是独立的 --eval 模块，不是 SUT CLI；静态命名 readFileSync 用来证明
// preload 的 hook 真的作用到 named import，而不是只改了 fs.readFileSync 属性。
const PROBE_SOURCE = `
import { readFileSync } from "node:fs";

const target = process.env.AU15_GUARD_PROBE_PATH;
const expected = process.env.AU15_GUARD_PROBE_EXPECT;
try {
  readFileSync(target, "utf8");
  console.log("guard-probe: allowed");
  process.exitCode = expected === "allowed" ? 0 : 3;
} catch (error) {
  if (error && error.code === "AU15_GUARD_DENIED") {
    console.log("guard-probe: denied " + error.message);
    process.exitCode = expected === "denied" ? 0 : 4;
  } else {
    console.log("guard-probe: unexpected " + String(error && error.message));
    process.exitCode = 4;
  }
}
`;

// 固定 preload 作为只读代码 fixture 走 materializeFixture 的统一初始化：内容不含
// 任何 case 绝对路径，同 run 的所有进程按同一内容指纹复用同一文件。
const GUARD_FIXTURE_NAME = "au15-io-guard";
const GUARD_FILE = "au15-real-artifact-guard.mjs";

function guardFixtureSpec() {
  return { name: GUARD_FIXTURE_NAME, files: { [GUARD_FILE]: GUARD_SOURCE } };
}

let scope;
let fixture;
let guardFixture;
let workerDir;
let preloadUrl;
let guardSequence = 0;
const guardedRuns = [];

before(() => {
  scope = openTestRunScope();
  try {
    fixture = materializeFixture(fixtureProjectSpec(), { scope });
    guardFixture = materializeFixture(guardFixtureSpec(), { scope });
    fs.mkdirSync(scope.workDir, { recursive: true });
    workerDir = fs.mkdtempSync(path.join(scope.workDir, "au15-io-worker-"));
    preloadUrl = pathToFileURL(guardFixture.files.get(GUARD_FILE)).href;
  } catch (error) {
    try {
      releaseWorkerDir();
    } catch {
      // 初始化失败的收口错误不能遮住原始失败。
    }
    try {
      if (scope) scope.close();
    } catch {
      // 同上；after 会再尝试一次并保留 close 失败事实。
    }
    throw error;
  }
});

after(() => {
  let failure = null;
  try {
    for (const run of guardedRuns) assertNoGuardDenial(run);
  } catch (error) {
    failure = error;
  }
  try {
    releaseWorkerDir();
  } catch (error) {
    failure ??= error;
  }
  try {
    if (scope) scope.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
});

// 只释放本进程在 scope.workDir 下申请的叶子；父 scope（可能借用）与别的 worker
// 目录都不在本函数的删除范围内。
function releaseWorkerDir() {
  if (!workerDir) return;
  const dir = workerDir;
  assert.equal(path.dirname(dir), scope?.workDir, "只允许释放本进程 worker 叶子");
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(dir), false, "worker 可变目录必须释放");
  workerDir = "";
}

function workingCopy(t) {
  return createWorkingCopy(fixture, { scope, context: t });
}

function reportPath(root) {
  return path.join(root, OUT_DIR, "readiness.json");
}

function guardLogPath() {
  guardSequence += 1;
  return path.join(workerDir, `guard-${guardSequence}.jsonl`);
}

function guardedEnv({ realRoot = REAL_ARTIFACTS_ROOT, allowedRoot = scope.dir, log, extra = {} } = {}) {
  return scope.env({
    AU15_GUARD_REAL_ROOT: realRoot,
    AU15_GUARD_ALLOWED: allowedRoot,
    AU15_GUARD_LOG: log,
    ...extra,
  });
}

// 真正 Node 入口：preload 只装配 fs hooks，不负责调用 SUT；argv/main guard/
// process.exitCode 由实际 CLI 文件执行，因此正反例都穿过 CLI 的退出路径。
function spawnCli(root) {
  const log = guardLogPath();
  const result = spawnSync(process.execPath, ["--import", preloadUrl, CHECKER, "--root", root], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
    env: guardedEnv({ log }),
  });
  result.guard_log = log;
  return result;
}

function runChecker(root) {
  const result = spawnCli(root);
  guardedRuns.push(result);
  return result;
}

// 独立 --eval 诊断程序：只验证 preload 的 hook，不冒充 SUT CLI。
function spawnProbe({
  expected,
  probePath,
  realRoot = REAL_ARTIFACTS_ROOT,
  allowedRoot = scope.dir,
}) {
  const log = guardLogPath();
  const result = spawnSync(
    process.execPath,
    ["--import", preloadUrl, "--input-type=module", "--eval", PROBE_SOURCE],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 30_000,
      env: guardedEnv({
        realRoot,
        allowedRoot,
        log,
        extra: {
          AU15_GUARD_PROBE_PATH: probePath,
          AU15_GUARD_PROBE_EXPECT: expected,
        },
      }),
    },
  );
  result.guard_log = log;
  return result;
}

function readDenials(log) {
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function assertNoGuardDenial(run) {
  assert.deepEqual(readDenials(run.guard_log), [], "CLI 不得访问真实 repo/artifacts");
}

function readReport(root) {
  return JSON.parse(fs.readFileSync(reportPath(root), "utf8"));
}

function statusOf(report, id) {
  return report.checks.find((check) => check.id === id)?.status;
}

function writeJson(copy, relativePath, value) {
  fs.writeFileSync(copy.files.get(relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

test("合成项目根生成 not_ready 报告（exit 0），报告只落在副本根", (t) => {
  const copy = workingCopy(t);
  const run = runChecker(copy.dir);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /not_ready/u);
  const report = readReport(copy.dir);
  assert.equal(report.schema, "au15-prep-readiness/v1");
  assert.equal(report.overall, "not_ready");
  assert.equal(report.mode, "preparation_only_no_model_no_provider_no_product_write");
  assert.equal(report.preregistration.path, PREREG_PATH);
  assert.equal(report.preregistration.status, "blocked_pending_author_resource_and_setup");
  assert.equal(report.scenario, SCENARIO_PATH);
  assert.equal(statusOf(report, "budget_matches_v1"), "ready");
  assert.equal(statusOf(report, "scenario_preparation_declared"), "ready");
  assert.equal(statusOf(report, "d6a_precondition"), "blocked");
  assert.equal(statusOf(report, "author_semantic_review"), "unknown");
  assert.equal(statusOf(report, "resource_window"), "unknown");
  assert.ok(fs.readFileSync(reportPath(copy.dir), "utf8").endsWith("\n"));
  assertNoGuardDenial(run);
});

test("缺 prereg.status：报告不伪造状态，resource_window 仍 unknown 且 overall not_ready", (t) => {
  const copy = workingCopy(t);
  const prereg = JSON.parse(fs.readFileSync(copy.files.get(PREREG_PATH), "utf8"));
  delete prereg.status;
  writeJson(copy, PREREG_PATH, prereg);

  const run = runChecker(copy.dir);

  assert.equal(run.status, 0, run.stderr);
  const report = readReport(copy.dir);
  assert.equal(report.preregistration.status, undefined);
  assert.equal(statusOf(report, "resource_window"), "unknown");
  assert.equal(report.overall, "not_ready");
  assertNoGuardDenial(run);
});

test("缺预注册文件：读边界非零，且不先创建输出目录/半成品报告", (t) => {
  const copy = workingCopy(t);
  fs.rmSync(copy.files.get(PREREG_PATH));

  const run = runChecker(copy.dir);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /缺少预注册/u);
  assert.equal(fs.existsSync(path.join(copy.dir, OUT_DIR)), false);
  assertNoGuardDenial(run);
});

test("缺场景 manifest：读边界非零，且不先创建输出目录/半成品报告", (t) => {
  const copy = workingCopy(t);
  fs.rmSync(copy.files.get(SCENARIO_PATH));

  const run = runChecker(copy.dir);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /缺少场景 manifest/u);
  assert.equal(fs.existsSync(path.join(copy.dir, OUT_DIR)), false);
  assertNoGuardDenial(run);
});

test("坏 JSON：读边界非零，不写报告", (t) => {
  const copy = workingCopy(t);
  fs.writeFileSync(copy.files.get(PREREG_PATH), "{not json\n");

  const run = runChecker(copy.dir);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /JSON/u);
  assert.equal(fs.existsSync(reportPath(copy.dir)), false);
  assertNoGuardDenial(run);
});

test("坏 YAML：标准解析桥报错并在读边界非零，不写报告", (t) => {
  const copy = workingCopy(t);
  fs.writeFileSync(copy.files.get(SCENARIO_PATH), "status: [unclosed\n");

  const run = runChecker(copy.dir);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /YAML/u);
  assert.equal(fs.existsSync(reportPath(copy.dir)), false);
  assertNoGuardDenial(run);
});

test("非 mapping 输入：JSON 数组与 YAML 序列都在读边界非零", (t) => {
  const jsonCopy = workingCopy(t);
  fs.writeFileSync(jsonCopy.files.get(PREREG_PATH), "[]\n");
  const jsonRun = runChecker(jsonCopy.dir);
  assert.equal(jsonRun.status, 2);
  assert.match(jsonRun.stderr, /mapping/u);
  assert.equal(fs.existsSync(reportPath(jsonCopy.dir)), false);

  const yamlCopy = workingCopy(t);
  fs.writeFileSync(yamlCopy.files.get(SCENARIO_PATH), "- one\n- two\n");
  const yamlRun = runChecker(yamlCopy.dir);
  assert.equal(yamlRun.status, 2);
  assert.match(yamlRun.stderr, /mapping/u);
  assert.equal(fs.existsSync(reportPath(yamlCopy.dir)), false);
  assertNoGuardDenial(jsonRun);
  assertNoGuardDenial(yamlRun);
});

test("预算不符：报告可 exit 0，但 overall not_ready 且 budget_matches_v1 blocked", (t) => {
  const copy = workingCopy(t);
  const prereg = JSON.parse(fs.readFileSync(copy.files.get(PREREG_PATH), "utf8"));
  prereg.budget.turn_timeout_ms = 1;
  writeJson(copy, PREREG_PATH, prereg);

  const run = runChecker(copy.dir);

  assert.equal(run.status, 0, run.stderr);
  const report = readReport(copy.dir);
  assert.equal(report.overall, "not_ready");
  assert.equal(statusOf(report, "budget_matches_v1"), "blocked");
  assert.ok(report.blockers.includes("budget_matches_v1"));
  assertNoGuardDenial(run);
});

test("四项 unknown 输入：overall 必须 not_ready，checks 保留 unknown 状态", (t) => {
  const copy = workingCopy(t);
  const prereg = JSON.parse(fs.readFileSync(copy.files.get(PREREG_PATH), "utf8"));
  prereg.no_run_until = ["资源窗口待定", "D6-A 前置完成", "预注册复核"];
  writeJson(copy, PREREG_PATH, prereg);
  const scenarioFile = copy.files.get(SCENARIO_PATH);
  const scenario = fs.readFileSync(scenarioFile, "utf8");
  const stripped = scenario.replace(/^  d6a_precondition:.*\n/m, "");
  assert.notEqual(stripped, scenario, "测试输入必须真的移除 d6a_precondition 声明");
  fs.writeFileSync(scenarioFile, stripped);

  const run = runChecker(copy.dir);

  assert.equal(run.status, 0, run.stderr);
  const report = readReport(copy.dir);
  assert.equal(report.overall, "not_ready");
  for (const id of [
    "d6a_precondition",
    "author_semantic_review",
    "resource_window",
    "b39_d6a_setup",
  ]) {
    assert.equal(statusOf(report, id), "unknown", id);
    assert.ok(report.blockers.includes(id), `${id} 必须阻止 ready`);
  }
  assertNoGuardDenial(run);
});

test("显式缺 D6-A 前置：d6a_precondition unknown 且不能 ready", (t) => {
  const copy = workingCopy(t);
  const scenarioFile = copy.files.get(SCENARIO_PATH);
  const original = fs.readFileSync(scenarioFile, "utf8");
  const stripped = original.replace(/^  d6a_precondition:.*\n/m, "");
  fs.writeFileSync(scenarioFile, stripped);

  const run = runChecker(copy.dir);

  assert.equal(run.status, 0, run.stderr);
  const report = readReport(copy.dir);
  assert.equal(statusOf(report, "d6a_precondition"), "unknown");
  assert.equal(statusOf(report, "b39_d6a_setup"), "unknown");
  assert.equal(report.overall, "not_ready");
  assertNoGuardDenial(run);
});

test("模型声明不一致：不把固定 strata/iq3_s 当通用正确性，blocked", (t) => {
  const copy = workingCopy(t);
  const prereg = JSON.parse(fs.readFileSync(copy.files.get(PREREG_PATH), "utf8"));
  prereg.model.model = "another-model";
  writeJson(copy, PREREG_PATH, prereg);

  const run = runChecker(copy.dir);

  assert.equal(run.status, 0, run.stderr);
  const report = readReport(copy.dir);
  assert.equal(statusOf(report, "prereg_model_matches_scenario"), "blocked");
  assert.ok(report.blockers.includes("prereg_model_matches_scenario"));
  assertNoGuardDenial(run);
});

test("已声明的 setup.provider 与预注册/default 冲突：必须 blocked", (t) => {
  const copy = workingCopy(t);
  const scenarioFile = copy.files.get(SCENARIO_PATH);
  const original = fs.readFileSync(scenarioFile, "utf8");
  const conflicted = original.replace(/^  provider: strata$/mu, "  provider: different-provider");
  assert.notEqual(conflicted, original, "测试输入必须真的改写 setup.provider");
  fs.writeFileSync(scenarioFile, conflicted);

  const run = runChecker(copy.dir);

  assert.equal(run.status, 0, run.stderr);
  const report = readReport(copy.dir);
  assert.equal(statusOf(report, "prereg_model_matches_scenario"), "blocked");
  assert.ok(report.blockers.includes("prereg_model_matches_scenario"));
  assertNoGuardDenial(run);
});

test("main 直接入口：成功 0、读失败 2、参数错误 2（同一 finalization 边界）", (t) => {
  const copy = workingCopy(t);
  const stdout = [];
  const stderr = [];
  const sink = { stdout: { write: (text) => stdout.push(text) }, stderr: { write: (text) => stderr.push(text) } };
  assert.equal(main(["--root", copy.dir], sink), 0, stderr.join(""));
  assert.match(stdout.join(""), /not_ready/u);

  const missing = workingCopy(t);
  fs.rmSync(missing.files.get(PREREG_PATH));
  assert.equal(main(["--root", missing.dir], sink), 2);
  assert.match(stderr.join(""), /缺少预注册/u);

  assert.equal(main(["--unknown"], sink), 2);
  assert.equal(main(["--root"], sink), 2);
  assert.equal(fs.existsSync(reportPath(missing.dir)), false);
});

test("报告落点隔离：只写显式 root，测试自有借用哨兵不被改写", (t) => {
  const copy = workingCopy(t);
  const sentinelRoot = path.join(workerDir, "sentinel-artifacts");
  const sentinel = path.join(sentinelRoot, OUT_DIR, "readiness.json");
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, "sentinel-not-a-report\n");
  t.after(() => fs.rmSync(sentinelRoot, { recursive: true, force: true }));

  const run = runChecker(copy.dir);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "sentinel-not-a-report\n");
  assert.equal(fs.existsSync(reportPath(copy.dir)), true);
  assertNoGuardDenial(run);
});

test("真实 CLI 指向 repo root：guard 拒绝真实 artifacts，进程非零且不写真实输出", () => {
  const run = spawnCli(REPO_ROOT);

  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /au15-real-artifact-guard: denied/u);
  const denials = readDenials(run.guard_log);
  assert.ok(denials.length >= 1, "真实 CLI 的 named fs import 必须被 preload 拦截");
  assert.equal(denials[0].path, REAL_PREREG);
});

test("guard 负控制：静态命名 fs 导入读真实 artifact 被拒绝并落 scope 日志", () => {
  const probe = spawnProbe({ expected: "denied", probePath: REAL_PREREG });

  assert.equal(probe.status, 0, probe.stderr);
  assert.match(probe.stdout, /guard-probe: denied/u);
  const denials = readDenials(probe.guard_log);
  assert.equal(denials.length, 1, "拒绝事实必须记录在测试自有 scope 日志");
  assert.equal(denials[0].path, REAL_PREREG);
});

test("guard 允许测试自有 scope：即使 scope 位于 denied root 下也不误拒绝", (t) => {
  const simulatedRoot = path.join(workerDir, "simulated-artifacts");
  const ownedFile = path.join(simulatedRoot, "owned.txt");
  fs.mkdirSync(simulatedRoot, { recursive: true });
  fs.writeFileSync(ownedFile, "owned\n");
  t.after(() => fs.rmSync(simulatedRoot, { recursive: true, force: true }));

  const probe = spawnProbe({
    expected: "allowed",
    probePath: ownedFile,
    realRoot: simulatedRoot,
    allowedRoot: simulatedRoot,
  });

  assert.equal(probe.status, 0, probe.stderr);
  assert.match(probe.stdout, /guard-probe: allowed/u);
  assert.deepEqual(readDenials(probe.guard_log), []);
});
