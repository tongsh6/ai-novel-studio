// scripts/lib/test_env.mjs 的 Node 运行作用域行为测试（与 test_env.test.mjs 的 Shell 前置回归分开）。
//
// 覆盖：owned scratch 与进程局部 TMPDIR、嵌套借用不删父 scope、成功/断言失败/
// 初始化失败、取消(SIGTERM)/超时、子进程被杀后的 parent 收口、受控 env 所有权、
// 正常/失败/取消时后台孙进程的进程组收口、嵌套借用不清理父组且由外层 owner 收口、
// 只读 fixture 同 run 单次物化与并发复用、两真实子进程竞争的 payload 写入计数、
// 初始化失败/owner 被杀/等待超时的明确失败、必要工作副本隔离与同步
// withWorkingCopy 的正常/单失败/双失败。全部使用真实 CLI/子进程与本文件专属
// scratch，不用打印的 PASS 自证。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createWorkingCopy,
  fixtureTemplateHash,
  materializeFixture,
  normalizeFixtureSpec,
  openTestRunScope,
  reapOrphanScopes,
  runInScope,
  withWorkingCopy,
} from "./test_env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEST_ENV = path.join(ROOT, "scripts/lib/test_env.mjs");
const HELPER = path.join(ROOT, "scripts/lib/test_env.sh");
const TEST_ENV_URL = pathToFileURL(TEST_ENV).href;
const MARKER = ".novel-test-run-owner.json";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-env-scope-"));
after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve) => {
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  return { child, done };
}

function runProcess(command, args, options = {}) {
  return startProcess(command, args, options).done;
}

function runAdapter(args, options = {}) {
  return runProcess(process.execPath, [TEST_ENV, "run", ...args], options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`等待条件超时（${timeoutMs}ms）`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 测试自己创建的 PID 先注册清理，防回归例本身留下进程。
function trackPid(t, pid) {
  if (!Number.isFinite(pid) || pid <= 0) return;
  t.after(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 已退出即无需处理。
    }
  });
}

// 用例创建的 CLI/owner 子进程在 after 里结束；断言提前抛出也要收口，不能只靠
// 成功路径末尾的 kill。stop 复用 startProcess 的 done 事实，不另建退出体系。
function stopStarted(started) {
  if (started.child.exitCode === null && started.child.signalCode === null) {
    started.child.kill("SIGKILL");
  }
  return started.done;
}

function trackStarted(t, started) {
  t.after(() => stopStarted(started));
}

// 子进程脚本已把真实 PID 写盘时，立刻登记该 PID；即使后续等待/断言先失败，
// 也能在释放父 scope 前杀掉实际作业进程。
function trackPidFile(t, file) {
  t.after(() => {
    if (!fs.existsSync(file)) return;
    const pid = Number(fs.readFileSync(file, "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0 || !isAlive(pid)) return;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 已退出即无需处理。
    }
  });
}

async function waitUntilDead(pid) {
  await waitFor(() => !isAlive(pid), 5000);
}

function writeFakeExecutable(binDir, name) {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, name),
    `#!/bin/sh\nprintf "%s %s\\n" "$0" "$*" >> "$SPAWN_LOG"\n`,
    { mode: 0o755 },
  );
}

function archiveEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

// 测试侧边界故障注入：只包裹 node:fs / node:child_process 的真实调用，
// 不改 SUT，也不给 SUT 任何验收开关。
function writePreload(dir, name, lines) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

const MANIFEST_IO = path.join(ROOT, "scripts/lib/quality/manifest_io.test.mjs");

// 裸 node:test 直接入口：清掉继承的 run 作用域变量与测试 runner 内部上下文，
// 只给本测试自有的 TMPDIR 父目录，让子进程按真实入口自行申请/回收 scratch。
function directEntryEnv(parent) {
  const env = { ...process.env, TMPDIR: parent, TMP: parent, TEMP: parent };
  for (const key of [
    "NOVEL_TEST_RUN_DIR",
    "NOVEL_TEST_RUN_ARCHIVE",
    "NOVEL_TEST_RUN_BASE",
    "NODE_TEST_CONTEXT",
  ]) {
    delete env[key];
  }
  return env;
}

function runDirectEntry(env, { preload, pattern } = {}) {  const args = [];
  if (preload) args.push("--require", preload);
  args.push("--test");
  if (pattern) args.push(`--test-name-pattern=${pattern}`);
  args.push(MANIFEST_IO);
  return runProcess(process.execPath, args, { env });
}

function cliRun(args, env) {
  return runProcess(process.execPath, [TEST_ENV, "run", ...args], { env });
}

function scratchEntries(base) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter((name) => name.startsWith("ai-novel-test-run."));
}

test("owned run：子进程拿到 run 目录与进程局部 TMPDIR，成功后 scratch 回收", async () => {
  const base = path.join(scratch, "base-success");
  const script =
    'printf "run=%s\\ntmp=%s\\ntmp2=%s\\ntmp3=%s\\nfile=%s\\n" ' +
    '"$NOVEL_TEST_RUN_DIR" "$TMPDIR" "$TMP" "$TEMP" "$(mktemp "$TMPDIR/tmp.XXXXXX")"';
  const result = await runAdapter(["--base", base, "--", "/bin/bash", "-c", script]);
  assert.equal(result.status, 0, result.stderr);
  const values = {};
  for (const line of result.stdout.trim().split("\n")) {
    const [key, ...rest] = line.split("=");
    values[key] = rest.join("=");
  }
  assert.ok(values.run.startsWith(`${base}${path.sep}`), `run=${values.run}`);
  assert.equal(values.tmp, path.join(values.run, "tmp"));
  assert.equal(values.tmp2, values.tmp);
  assert.equal(values.tmp3, values.tmp);
  assert.ok(values.file.startsWith(`${values.tmp}${path.sep}`), `file=${values.file}`);
  assert.equal(fs.existsSync(values.run), false, "owned scratch 应被回收");
  assert.equal(fs.existsSync(base), true, "base 是借用父目录，不属于本 run scratch");
  assert.match(result.stderr, /\[test-env\] run=\S+ exit=0/);
});

test("Node 作用域不建库：未触发 mix / YAML 桥", async () => {
  const base = path.join(scratch, "base-no-db");
  const binDir = path.join(scratch, "fake-bin");
  const spawnLog = path.join(scratch, "spawn.log");
  writeFakeExecutable(binDir, "mix");
  writeFakeExecutable(binDir, "python3");
  const result = await runAdapter(
    ["--base", base, "--", process.execPath, "-e", "process.exit(0)"],
    {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        SPAWN_LOG: spawnLog,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  // process_tree 的 pgid 探测可能调用 python3（只读 os.getpgid），但不得触发
  // 建库命令或 YAML 解析桥。
  const calls = fs.existsSync(spawnLog) ? fs.readFileSync(spawnLog, "utf8") : "";
  assert.doesNotMatch(calls, /\/mix /u, "Node 纯运行不得触发建库");
  assert.doesNotMatch(calls, /yaml_bridge\.py/u, "Node 纯运行不得触发 YAML 解析");
});

test("断言失败：真实 node 断言失败退出码透传，owned scratch 回收", async () => {
  const base = path.join(scratch, "base-failure");
  const result = await runAdapter([
    "--base",
    base,
    "--",
    process.execPath,
    "-e",
    "require('node:assert/strict').equal(1, 2)",
  ]);
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(fs.readdirSync(base), []);
});

test("初始化失败：fail-closed，不创建 semi-scope，借用父目录不变", async () => {
  const notADir = path.join(scratch, "not-a-dir");
  fs.writeFileSync(notADir, "sentinel\n");
  const result = await runAdapter(["--base", notADir, "--", "/bin/bash", "-c", "exit 0"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /初始化运行作用域失败/);
  assert.equal(fs.readFileSync(notADir, "utf8"), "sentinel\n");
});

test("超时：只回收本 run 进程树，退出 124，结果归档且 scratch 回收", async () => {
  const base = path.join(scratch, "base-timeout");
  const archive = path.join(scratch, "archive-timeout");
  const ready = path.join(scratch, "ready-timeout");
  fs.mkdirSync(ready);
  const script =
    'sleep 60 & echo $! > "$READY_DIR/grandchild.pid"; ' +
    'echo $$ > "$READY_DIR/child.pid"; wait';
  const result = await runAdapter(
    [
      "--base",
      base,
      "--archive",
      archive,
      "--timeout-ms",
      "1200",
      "--",
      "/bin/bash",
      "-c",
      script,
    ],
    { env: { ...process.env, READY_DIR: ready } },
  );
  assert.equal(result.status, 124, result.stderr);
  const childPid = Number(fs.readFileSync(path.join(ready, "child.pid"), "utf8").trim());
  const grandchildPid = Number(
    fs.readFileSync(path.join(ready, "grandchild.pid"), "utf8").trim(),
  );
  await waitUntilDead(childPid);
  await waitUntilDead(grandchildPid);
  assert.deepEqual(fs.readdirSync(base), [], "超时后不得残留 owned scratch");
  const archived = archiveEntries(archive);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].exitCode, 124);
  assert.equal(archived[0].timed_out, true);
});

test("取消(SIGTERM)：父 owner 停止本 run 子进程树、退出 143、scratch 回收", async (t) => {
  const base = path.join(scratch, "base-cancel");
  const archive = path.join(scratch, "archive-cancel");
  const ready = path.join(scratch, "ready-cancel");
  fs.mkdirSync(ready);
  const script =
    'sleep 60 & echo $! > "$READY_DIR/grandchild.pid"; ' +
    'echo $$ > "$READY_DIR/child.pid"; wait';
  const started = startProcess(
    process.execPath,
    [
      TEST_ENV,
      "run",
      "--base",
      base,
      "--archive",
      archive,
      "--",
      "/bin/bash",
      "-c",
      script,
    ],
    { env: { ...process.env, READY_DIR: ready } },
  );
  trackPidFile(t, path.join(ready, "child.pid"));
  trackPidFile(t, path.join(ready, "grandchild.pid"));
  trackStarted(t, started);
  await waitFor(() => fs.existsSync(path.join(ready, "child.pid")));
  started.child.kill("SIGTERM");
  const result = await started.done;
  assert.equal(result.status, 143, result.stderr);
  const childPid = Number(fs.readFileSync(path.join(ready, "child.pid"), "utf8").trim());
  const grandchildPid = Number(
    fs.readFileSync(path.join(ready, "grandchild.pid"), "utf8").trim(),
  );
  await waitUntilDead(childPid);
  await waitUntilDead(grandchildPid);
  assert.deepEqual(fs.readdirSync(base), []);
  const archived = archiveEntries(archive);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].exitCode, 143);
  assert.equal(archived[0].stopped_by, "SIGTERM");
});

test("子进程被杀：parent 观察信号退出、收口后台孙进程、仍归档并回收 scratch", async (t) => {
  const base = path.join(scratch, "base-child-killed");
  const archive = path.join(scratch, "archive-child-killed");
  const ready = path.join(scratch, "ready-child-killed");
  fs.mkdirSync(ready);
  const script =
    'sleep 60 & echo $! > "$READY_DIR/grandchild.pid"; ' +
    'echo $$ > "$READY_DIR/child.pid"; exec sleep 60';
  const started = startProcess(
    process.execPath,
    [TEST_ENV, "run", "--base", base, "--archive", archive, "--", "/bin/bash", "-c", script],
    { env: { ...process.env, READY_DIR: ready } },
  );
  trackPidFile(t, path.join(ready, "child.pid"));
  trackPidFile(t, path.join(ready, "grandchild.pid"));
  trackStarted(t, started);
  await waitFor(
    () =>
      fs.existsSync(path.join(ready, "child.pid")) &&
      fs.existsSync(path.join(ready, "grandchild.pid")),
  );
  const childPid = Number(fs.readFileSync(path.join(ready, "child.pid"), "utf8").trim());
  const grandchildPid = Number(
    fs.readFileSync(path.join(ready, "grandchild.pid"), "utf8").trim(),
  );
  trackPid(t, childPid);
  trackPid(t, grandchildPid);
  process.kill(childPid, "SIGKILL");
  const result = await started.done;
  assert.equal(result.status, 137, result.stderr);
  await waitUntilDead(childPid);
  await waitUntilDead(grandchildPid);
  assert.deepEqual(fs.readdirSync(base), []);
  const archived = archiveEntries(archive);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].exitCode, 137);
  assert.equal(archived[0].signal, "SIGKILL");
  assert.equal(archived[0].tree_finalized, true);
});

test("超时后父 SIGTERM：timeout 语义优先，退出 124 而非取消 143", async (t) => {
  const base = path.join(scratch, "base-timeout-then-cancel");
  const archive = path.join(scratch, "archive-timeout-then-cancel");
  const ready = path.join(scratch, "ready-timeout-then-cancel");
  fs.mkdirSync(ready);
  const childCode = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'fs.writeFileSync(path.join(process.env.READY_DIR, "child.pid"), String(process.pid));',
    'process.on("SIGTERM", () => {});',
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const started = startProcess(
    process.execPath,
    [
      TEST_ENV,
      "run",
      "--base",
      base,
      "--archive",
      archive,
      "--timeout-ms",
      "300",
      "--",
      process.execPath,
      "-e",
      childCode,
    ],
    { env: { ...process.env, READY_DIR: ready } },
  );
  trackPidFile(t, path.join(ready, "child.pid"));
  trackStarted(t, started);
  await waitFor(() => fs.existsSync(path.join(ready, "child.pid")));
  const childPid = Number(fs.readFileSync(path.join(ready, "child.pid"), "utf8").trim());
  trackPid(t, childPid);
  // timeout 已由 300ms 触发；500ms 后再显式取消，不能把 timeout 改成 cancel。
  await sleep(500);
  started.child.kill("SIGTERM");
  const result = await started.done;
  assert.equal(result.status, 124, result.stderr);
  await waitUntilDead(childPid);
  const archived = archiveEntries(archive);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].exitCode, 124, "timeout 优先于后续取消");
  assert.equal(archived[0].timed_out, true);
  assert.equal(archived[0].stopped_by, "SIGKILL");
  assert.equal(archived[0].child_exit_code, null);
  assert.equal(archived[0].signal, "SIGKILL");
  assert.equal(archived[0].scope_removed, true);
  recordEvidence("timeout-then-cancel", {
    exit: result.status,
    stderr: result.stderr.trim(),
    archived: archived[0],
    child_alive_after_run: isAlive(childPid),
  });
});

test("CLI finalization 顺序：先收口 owned scratch，再写归档，成功码一致", async (t) => {
  const harness = fs.mkdtempSync(path.join(scratch, "finalize-order-"));
  t.after(() => fs.rmSync(harness, { recursive: true, force: true }));
  const base = path.join(harness, "base");
  const archive = path.join(harness, "archive");
  const probeLog = path.join(harness, "probe.json");
  const preload = writePreload(harness, "observe-close.cjs", [
    'const fs = require("node:fs");',
    "const original = fs.rmSync;",
    "fs.rmSync = function (target, ...rest) {",
    "  const p = String(target);",
    '  if (p.includes("ai-novel-test-run.")) {',
    "    fs.writeFileSync(process.env.PROBE_LOG, JSON.stringify({",
    "      archive_count_at_close: fs.existsSync(process.env.PROBE_ARCHIVE)",
    "        ? fs.readdirSync(process.env.PROBE_ARCHIVE).length",
    "        : 0,",
    "      scratch_exists_at_close: fs.existsSync(p),",
    "    }));",
    "  }",
    "  return original.call(this, target, ...rest);",
    "};",
  ]);
  const result = await cliRun(
    ["--base", base, "--archive", archive, "--", process.execPath, "-e", "process.exit(0)"],
    {
      ...process.env,
      TMPDIR: harness,
      NODE_OPTIONS: `--require=${preload}`,
      PROBE_LOG: probeLog,
      PROBE_ARCHIVE: archive,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(fs.readFileSync(probeLog, "utf8"));
  assert.equal(observed.archive_count_at_close, 0, "归档必须在 owned scratch 收口之后写");
  assert.equal(observed.scratch_exists_at_close, true);
  const archived = archiveEntries(archive);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].exitCode, 0);
  assert.equal(archived[0].scope_removed, true);
  assert.deepEqual(fs.readdirSync(base), []);
  recordEvidence("cli-finalization-order", {
    observed,
    archived: archived[0],
    scratch_entries: fs.readdirSync(base).length,
  });
});

test("CLI cleanup 失败：真实 CLI 非零、归档同一失败、保留 scratch 由父层 finally 回收", async (t) => {
  const harness = fs.mkdtempSync(path.join(scratch, "finalize-cleanup-fail-"));
  t.after(() => fs.rmSync(harness, { recursive: true, force: true }));
  const base = path.join(harness, "base");
  const archive = path.join(harness, "archive");
  const leftovers = [];
  t.after(() => {
    for (const dir of leftovers) fs.rmSync(dir, { recursive: true, force: true });
  });
  const preload = writePreload(harness, "fail-close.cjs", [
    'const fs = require("node:fs");',
    "const original = fs.rmSync;",
    "fs.rmSync = function (target, ...rest) {",
    "  const p = String(target);",
    '  if (p.includes("ai-novel-test-run.")) {',
    '    const error = new Error("injected_owned_cleanup_failure");',
    '    error.code = "EACCES";',
    "    throw error;",
    "  }",
    "  return original.call(this, target, ...rest);",
    "};",
  ]);
  const result = await cliRun(
    ["--base", base, "--archive", archive, "--", process.execPath, "-e", "process.exit(0)"],
    { ...process.env, TMPDIR: harness, NODE_OPTIONS: `--require=${preload}` },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /cleanup_error=/);
  assert.match(result.stderr, /scratch_retained=/);
  const archived = archiveEntries(archive);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].child_exit_code, 0, "保留原始子进程退出事实");
  assert.equal(archived[0].exitCode, 1, "cleanup 失败不得归档为成功");
  assert.equal(archived[0].scope_removed, false);
  assert.match(archived[0].cleanup_error, /EACCES|injected_owned_cleanup_failure/u);
  leftovers.push(...scratchEntries(base).map((name) => path.join(base, name)));
  assert.equal(leftovers.length, 1, "cleanup 失败必须保留可能仍在使用的 scratch");
  recordEvidence("cli-cleanup-failure", {
    cli_exit: result.status,
    stderr: result.stderr.trim(),
    archived: archived[0],
    scratch_entries: leftovers.map((dir) => path.basename(dir)),
  });
});

test("归档退出码与失败子进程一致；cleanup 失败不掩原失败码", async (t) => {
  const harness = fs.mkdtempSync(path.join(scratch, "finalize-failure-code-"));
  t.after(() => fs.rmSync(harness, { recursive: true, force: true }));
  const leftovers = [];
  t.after(() => {
    for (const dir of leftovers) fs.rmSync(dir, { recursive: true, force: true });
  });
  const normalBase = path.join(harness, "normal");
  const normalArchive = path.join(harness, "normal-archive");
  const failed = await cliRun(
    ["--base", normalBase, "--archive", normalArchive, "--", process.execPath, "-e", "process.exit(7)"],
    { ...process.env, TMPDIR: harness },
  );
  assert.equal(failed.status, 7, failed.stderr);
  const normalArchived = archiveEntries(normalArchive);
  assert.equal(normalArchived.length, 1);
  assert.equal(normalArchived[0].exitCode, 7, "归档码必须与真实 CLI 退出码一致");
  assert.equal(normalArchived[0].child_exit_code, 7);
  assert.equal(normalArchived[0].scope_removed, true);

  const preload = writePreload(harness, "fail-close-nonzero.cjs", [
    'const fs = require("node:fs");',
    "const original = fs.rmSync;",
    "fs.rmSync = function (target, ...rest) {",
    "  const p = String(target);",
    '  if (p.includes("ai-novel-test-run.")) {',
    '    const error = new Error("injected_owned_cleanup_failure");',
    '    error.code = "EACCES";',
    "    throw error;",
    "  }",
    "  return original.call(this, target, ...rest);",
    "};",
  ]);
  const failedBase = path.join(harness, "cleanup-failure");
  const failedArchive = path.join(harness, "cleanup-failure-archive");
  const cleanupFailed = await cliRun(
    [
      "--base",
      failedBase,
      "--archive",
      failedArchive,
      "--",
      process.execPath,
      "-e",
      "process.exit(3)",
    ],
    { ...process.env, TMPDIR: harness, NODE_OPTIONS: `--require=${preload}` },
  );
  assert.equal(cleanupFailed.status, 3, cleanupFailed.stderr);
  const cleanupArchived = archiveEntries(failedArchive);
  assert.equal(cleanupArchived.length, 1);
  assert.equal(cleanupArchived[0].exitCode, 3, "cleanup 失败不得把子进程失败改写成别的码");
  assert.equal(cleanupArchived[0].child_exit_code, 3);
  assert.match(cleanupArchived[0].cleanup_error, /EACCES|injected_owned_cleanup_failure/u);
  leftovers.push(...scratchEntries(failedBase).map((name) => path.join(failedBase, name)));
  assert.equal(leftovers.length, 1);
  recordEvidence("cli-failure-code", {
    normal: { cli_exit: failed.status, archived: normalArchived[0] },
    cleanup_failure: { cli_exit: cleanupFailed.status, archived: cleanupArchived[0] },
  });
});

test("CLI 树收口失败：非零、tree_error 入档、保留 scratch 且不伪成功", async (t) => {
  const harness = fs.mkdtempSync(path.join(scratch, "finalize-tree-fail-"));
  t.after(() => fs.rmSync(harness, { recursive: true, force: true }));
  const base = path.join(harness, "base");
  const archive = path.join(harness, "archive");
  const leftovers = [];
  t.after(() => {
    for (const dir of leftovers) fs.rmSync(dir, { recursive: true, force: true });
  });
  const preload = writePreload(harness, "fail-tree.cjs", [
    'const cp = require("node:child_process");',
    "const original = cp.spawnSync;",
    "cp.spawnSync = function (command, args, ...rest) {",
    '  if (String(command) === "/bin/bash" && Array.isArray(args) &&',
    '      args.some((arg) => String(arg).includes("process_tree.sh"))) {',
    "    return { status: 91, signal: null, error: undefined };",
    "  }",
    "  return original.call(this, command, args, ...rest);",
    "};",
  ]);
  const result = await cliRun(
    ["--base", base, "--archive", archive, "--", process.execPath, "-e", "process.exit(0)"],
    { ...process.env, TMPDIR: harness, NODE_OPTIONS: `--require=${preload}` },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /tree_error=/);
  assert.match(result.stderr, /scratch_retained=/);
  const archived = archiveEntries(archive);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].exitCode, 1, "树收口失败不得归档为成功");
  assert.equal(archived[0].tree_finalized, false);
  assert.match(archived[0].tree_error, /process_tree status=91/u);
  assert.equal(archived[0].scope_removed, false);
  leftovers.push(...scratchEntries(base).map((name) => path.join(base, name)));
  assert.equal(leftovers.length, 1, "树收口失败必须保留 scratch");
  recordEvidence("cli-tree-failure", {
    cli_exit: result.status,
    stderr: result.stderr.trim(),
    archived: archived[0],
    scratch_entries: leftovers.map((dir) => path.basename(dir)),
  });
});

test("作用域受控 env 不可被 extra 覆盖/删除：完整 process.env 转发仍写 owned tmp", async (t) => {
  const borrowed = fs.mkdtempSync(path.join(scratch, "borrowed-env-"));
  t.after(() => fs.rmSync(borrowed, { recursive: true, force: true }));
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-env-owner") });
  t.after(() => parent.close());
  const script =
    'printf "run=%s\\ntmp=%s\\ntmp2=%s\\n" "$NOVEL_TEST_RUN_DIR" "$TMPDIR" "$TMP"\n' +
    'f="$(mktemp "$TMPDIR/child.XXXXXX")"\n' +
    'printf "file=%s\\n" "$f"';
  const parse = (stdout) => {
    const values = {};
    for (const line of stdout.trim().split("\n")) {
      const [key, ...rest] = line.split("=");
      values[key] = rest.join("=");
    }
    return values;
  };

  const forwarded = await runInScope(parent, "/bin/bash", ["-c", script], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NOVEL_TEST_RUN_DIR: borrowed,
      TMPDIR: borrowed,
      TMP: borrowed,
      TEMP: borrowed,
    },
  });
  assert.equal(forwarded.exitCode, 0, forwarded.stderr);
  const values = parse(forwarded.stdout);
  assert.equal(values.run, parent.dir, "RUN_DIR 必须由 scope owner 决定");
  assert.equal(values.tmp, parent.tmpDir, "TMPDIR 必须由 scope owner 决定");
  assert.equal(values.tmp2, parent.tmpDir);
  assert.ok(values.file.startsWith(`${parent.tmpDir}${path.sep}`), values.file);
  assert.deepEqual(fs.readdirSync(borrowed), [], "子进程临时物不得落到借用/外部目录");

  const deleted = await runInScope(parent, "/bin/bash", ["-c", script], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NOVEL_TEST_RUN_DIR: undefined,
      TMPDIR: undefined,
      TMP: undefined,
      TEMP: undefined,
    },
  });
  assert.equal(deleted.exitCode, 0, deleted.stderr);
  const deletedValues = parse(deleted.stdout);
  assert.equal(deletedValues.run, parent.dir, "extra 删除不得移除 scope 身份");
  assert.equal(deletedValues.tmp, parent.tmpDir);

  const closed = parent.close();
  assert.equal(closed.removed, true);
  assert.equal(fs.existsSync(values.file), false, "scope 回收后临时物不应留在外面");
  assert.deepEqual(fs.readdirSync(borrowed), []);
});

test("owned 正常/失败退出：后台孙进程必须随进程组收口", async (t) => {
  for (const [suffix, code] of [
    ["normal", 0],
    ["failure", 7],
  ]) {
    const parent = openTestRunScope({ baseDir: path.join(scratch, `base-tree-${suffix}`) });
    t.after(() => parent.close());
    const pidFile = path.join(scratch, `tree-${suffix}-grandchild.pid`);
    const result = await runInScope(
      parent,
      "/bin/bash",
      ["-c", 'sleep 60 & echo $! > "$PID_FILE"; exit "$EXIT_CODE"'],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { PID_FILE: pidFile, EXIT_CODE: String(code) },
      },
    );
    assert.equal(result.exitCode, code, result.stderr);
    assert.equal(result.tree_finalized, true);
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    trackPid(t, pid);
    await waitUntilDead(pid);
    const closed = parent.close();
    assert.equal(closed.removed, true, `${suffix}: scratch 应回收`);
  }
});

test("取消：子进程捕获 SIGTERM 后 exit 0 仍报取消，且孙进程收口", async (t) => {
  const base = path.join(scratch, "base-cancel-graceful");
  const archive = path.join(scratch, "archive-cancel-graceful");
  const ready = path.join(scratch, "ready-cancel-graceful");
  fs.mkdirSync(ready);
  const childCode = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const { spawn } = require("node:child_process");',
    "const grandchild = spawn(process.execPath,",
    '  ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    'fs.writeFileSync(path.join(process.env.READY_DIR, "grandchild.pid"), String(grandchild.pid));',
    'fs.writeFileSync(path.join(process.env.READY_DIR, "child.pid"), String(process.pid));',
    'process.on("SIGTERM", () => process.exit(0));',
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const started = startProcess(
    process.execPath,
    [
      TEST_ENV,
      "run",
      "--base",
      base,
      "--archive",
      archive,
      "--",
      process.execPath,
      "-e",
      childCode,
    ],
    { env: { ...process.env, READY_DIR: ready } },
  );
  trackPidFile(t, path.join(ready, "child.pid"));
  trackPidFile(t, path.join(ready, "grandchild.pid"));
  trackStarted(t, started);
  await waitFor(
    () =>
      fs.existsSync(path.join(ready, "child.pid")) &&
      fs.existsSync(path.join(ready, "grandchild.pid")),
  );
  const childPid = Number(fs.readFileSync(path.join(ready, "child.pid"), "utf8").trim());
  const grandchildPid = Number(
    fs.readFileSync(path.join(ready, "grandchild.pid"), "utf8").trim(),
  );
  trackPid(t, childPid);
  trackPid(t, grandchildPid);
  started.child.kill("SIGTERM");
  const result = await started.done;
  assert.equal(result.status, 143, result.stderr);
  await waitUntilDead(grandchildPid);
  assert.deepEqual(fs.readdirSync(base), [], "取消后 owned scratch 应回收");
  const archived = archiveEntries(archive);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].exitCode, 143, "取消不得返回成功");
  assert.equal(archived[0].child_exit_code, 0, "保留原始子进程退出 0");
  assert.equal(archived[0].stopped_by, "SIGTERM");
  assert.equal(archived[0].tree_finalized, true);
});

test("嵌套借用：内层不清理父组，外层 owner 收口嵌套孙进程", async (t) => {
  const base = path.join(scratch, "base-nested-trees");
  const outerPidFile = path.join(scratch, "nested-outer-sleep.pid");
  const innerPidFile = path.join(scratch, "nested-inner-sleep.pid");
  const script = [
    'touch "$NOVEL_TEST_RUN_DIR/sentinel"',
    'sleep 60 & echo $! > "$OUTER_PID"',
    'node "$TEST_ENV_PATH" run -- /bin/bash -c \'sleep 60 & echo $! > "$INNER_PID"; exit 0\'',
    "inner_status=$?",
    'outer_alive=no; kill -0 "$(cat "$OUTER_PID")" 2>/dev/null && outer_alive=yes',
    'printf "inner_status=%s\\nouter_alive=%s\\nsentinel=%s\\n" "$inner_status" ' +
      '"$outer_alive" "$(test -f "$NOVEL_TEST_RUN_DIR/sentinel" && echo yes || echo no)"',
  ].join("\n");
  const result = await runAdapter(["--base", base, "--", "/bin/bash", "-c", script], {
    env: {
      ...process.env,
      TEST_ENV_PATH: TEST_ENV,
      OUTER_PID: outerPidFile,
      INNER_PID: innerPidFile,
    },
  });
  // 先登记 PID 文件里的真实进程，再断言；外层命令已退出时残留的 sleep 仍能被
  // 本用例收口，而不是留给文件级 scratch 清理。
  trackPidFile(t, outerPidFile);
  trackPidFile(t, innerPidFile);
  assert.equal(result.status, 0, result.stderr);
  const values = {};
  for (const line of result.stdout.trim().split("\n")) {
    const [key, ...rest] = line.split("=");
    values[key] = rest.join("=");
  }
  assert.equal(values.inner_status, "0");
  assert.equal(values.outer_alive, "yes", "内层借用不得清理父进程组");
  assert.equal(values.sentinel, "yes", "内层借用不得删除父 scope 内容");
  const outerPid = Number(fs.readFileSync(outerPidFile, "utf8").trim());
  const innerPid = Number(fs.readFileSync(innerPidFile, "utf8").trim());
  trackPid(t, outerPid);
  trackPid(t, innerPid);
  await waitUntilDead(outerPid);
  await waitUntilDead(innerPid);
  assert.deepEqual(fs.readdirSync(base), [], "外层 owner 回收包含嵌套进程的 scratch");
});

test("嵌套入口借用父 scope：不重复创建、不删除父 scope 与 sentinel", async () => {
  const base = path.join(scratch, "base-nested");
  const script =
    'touch "$NOVEL_TEST_RUN_DIR/sentinel"\n' +
    'inner="$(node "$TEST_ENV_PATH" run -- /bin/bash -c \'printf "%s" "$NOVEL_TEST_RUN_DIR"\' 2>/dev/null)"\n' +
    'printf "outer=%s\\ninner=%s\\nsentinel=%s\\n" "$NOVEL_TEST_RUN_DIR" "$inner" ' +
    '"$(test -f "$NOVEL_TEST_RUN_DIR/sentinel" && echo yes || echo no)"';
  const result = await runAdapter(["--base", base, "--", "/bin/bash", "-c", script], {
    env: { ...process.env, TEST_ENV_PATH: TEST_ENV },
  });
  assert.equal(result.status, 0, result.stderr);
  const values = {};
  for (const line of result.stdout.trim().split("\n")) {
    const [key, ...rest] = line.split("=");
    values[key] = rest.join("=");
  }
  assert.equal(values.inner, values.outer, "嵌套入口必须复用父 run 目录");
  assert.equal(values.sentinel, "yes", "嵌套入口不得删除父 scope 内容");
  assert.equal(fs.existsSync(values.outer), false, "外层退出后回收 owned scratch");
});

test("借用已有 scope：只运行子进程，不删除父目录和 owner marker", async () => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-borrowed") });
  const sentinel = path.join(parent.dir, "sentinel");
  fs.writeFileSync(sentinel, "borrowed\n");
  const markerBefore = fs.readFileSync(path.join(parent.dir, MARKER), "utf8");
  try {
    const result = await runAdapter(
      ["--", "/bin/bash", "-c", 'printf "%s" "$NOVEL_TEST_RUN_DIR"'],
      { env: { ...process.env, NOVEL_TEST_RUN_DIR: parent.dir } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), parent.dir);
    assert.doesNotMatch(result.stderr, /parent_scope=/u, "借用成功不应伪报保留父 scope");
    assert.equal(fs.readFileSync(sentinel, "utf8"), "borrowed\n");
    assert.equal(fs.readFileSync(path.join(parent.dir, MARKER), "utf8"), markerBefore);
  } finally {
    parent.close();
  }
});

test("作用域 env：extra 的 undefined 表示删除而不是字符串化", () => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-env-undefined") });
  process.env.PROBE_DROP_UNDEFINED = "outer";
  try {
    const env = parent.env({ PROBE_KEEP_DEFINED: "kept", PROBE_DROP_UNDEFINED: undefined });
    assert.equal(env.PROBE_KEEP_DEFINED, "kept");
    assert.equal("PROBE_DROP_UNDEFINED" in env, false, "undefined 必须删除变量");
    assert.equal(env.TMPDIR, parent.tmpDir);
  } finally {
    delete process.env.PROBE_DROP_UNDEFINED;
    assert.equal(parent.close().removed, true);
  }
});

test("close 契约：owned/借用幂等、清理失败抛异常、外部回收事实", (t) => {
  const owned = openTestRunScope({ baseDir: path.join(scratch, "base-close-owned") });
  const first = owned.close();
  const second = owned.close();
  for (const closed of [first, second]) {
    assert.equal(closed.borrowed, false);
    assert.equal(closed.removed, true);
    assert.equal("error" in closed, false, "成功 close 不再用软错误字段表达");
  }

  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-close-borrowed") });
  t.after(() => parent.close());
  const sentinel = path.join(parent.dir, "sentinel");
  fs.writeFileSync(sentinel, "keep\n");
  const previous = process.env.NOVEL_TEST_RUN_DIR;
  process.env.NOVEL_TEST_RUN_DIR = parent.dir;
  let borrowed;
  try {
    borrowed = openTestRunScope();
  } finally {
    if (previous === undefined) delete process.env.NOVEL_TEST_RUN_DIR;
    else process.env.NOVEL_TEST_RUN_DIR = previous;
  }
  for (const closed of [borrowed.close(), borrowed.close()]) {
    assert.equal(closed.borrowed, true);
    assert.equal(closed.removed, false);
    assert.equal("error" in closed, false);
  }
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep\n", "借用 close 不得删除父 scope");

  const failing = openTestRunScope({ baseDir: path.join(scratch, "base-close-failure") });
  const original = fs.rmSync;
  fs.rmSync = function (target, ...rest) {
    if (String(target) === failing.dir) {
      const error = new Error("injected closeScope rm failure");
      error.code = "EACCES";
      throw error;
    }
    return original.call(fs, target, ...rest);
  };
  try {
    assert.throws(() => failing.close(), /injected closeScope rm failure/u);
  } finally {
    fs.rmSync = original;
  }
  assert.equal(fs.existsSync(failing.dir), true, "cleanup 失败必须保留 scratch 供核验");
  fs.rmSync(failing.dir, { recursive: true, force: true });

  const gone = openTestRunScope({ baseDir: path.join(scratch, "base-close-gone") });
  fs.rmSync(gone.dir, { recursive: true, force: true });
  const goneClosed = gone.close();
  assert.equal(goneClosed.borrowed, false);
  assert.equal(goneClosed.removed, true, "force 必须容忍外部已回收");
  assert.equal("error" in goneClosed, false);
});

test("close 契约：成功 close 幂等，旧路径后来重建的哨兵不被第二次 close 删除", (t) => {
  const owned = openTestRunScope({ baseDir: path.join(scratch, "base-close-idempotent-recreated") });
  const first = owned.close();
  assert.equal(first.borrowed, false);
  assert.equal(first.removed, true);

  // 真实外部效果：首次 close 回收后，测试宿主在旧路径重建一个哨兵，代表后来
  // 落到该路径的资源；第二次 close 只能复用关闭事实，不能再删除它。
  const sentinel = path.join(owned.dir, "recreated-resource.txt");
  fs.mkdirSync(owned.dir, { recursive: true });
  fs.writeFileSync(sentinel, "later-resource\n");
  t.after(() => {
    fs.rmSync(sentinel, { force: true });
    try {
      fs.rmdirSync(owned.dir);
    } catch {
      // 第二次 close 若已删除目录，哨兵断言会先失败；这里只回收自己重建的空目录。
    }
  });

  const second = owned.close();
  assert.equal(second.borrowed, false);
  assert.equal(second.removed, true, "关闭事实必须保持");
  assert.equal("error" in second, false);
  assert.equal(
    fs.readFileSync(sentinel, "utf8"),
    "later-resource\n",
    "第二次 close 不得再次删除旧路径上后来重建的资源",
  );
});

// 直接 node:test 入口的真实消费者回归：初始化在 before 内，失败后 after 仍须
// 收口 owned scratch；cleanup 事实必须进入退出状态，借用只归还父 scope。
test("直接 node 入口：fixture 初始化失败退出非零且不残留 owned scratch", async () => {
  const parent = fs.mkdtempSync(path.join(scratch, "direct-entry-init-"));
  const preload = writePreload(parent, "init-failure.cjs", [
    'const fs = require("node:fs");',
    "const original = fs.writeFileSync;",
    "fs.writeFileSync = function (file, ...rest) {",
    '  if (String(file).includes(".staging-")) {',
    '    const error = new Error("ENOSPC: injected fixture staging write failure");',
    '    error.code = "ENOSPC";',
    "    throw error;",
    "  }",
    "  return original.call(fs, file, ...rest);",
    "};",
  ]);
  try {
    const result = await runDirectEntry(directEntryEnv(parent), {
      preload,
      pattern: "自足 IO fixture",
    });
    const remaining = scratchEntries(parent);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, "初始化失败不得被当成通过");
    assert.deepEqual(remaining, [], "before 失败后 after 仍须回收 owned scratch");
    assert.match(output, /ENOSPC|初始化失败/u);
    recordEvidence("direct-entry-init-failure", {
      status: result.status,
      remaining,
      output,
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("直接 node 入口：owned cleanup 失败不能被判 PASS", async () => {
  const parent = fs.mkdtempSync(path.join(scratch, "direct-entry-cleanup-"));
  const preload = writePreload(parent, "cleanup-failure.cjs", [
    'const fs = require("node:fs");',
    'const nodePath = require("node:path");',
    `const BASE = ${JSON.stringify(parent)};`,
    "const original = fs.rmSync;",
    "fs.rmSync = function (target, options) {",
    "  const resolved = nodePath.resolve(String(target));",
    "  if (",
    "    nodePath.dirname(resolved) === BASE &&",
    '    nodePath.basename(resolved).startsWith("ai-novel-test-run.")',
    "  ) {",
    '    const error = new Error("EPERM: injected owned scratch cleanup failure");',
    '    error.code = "EPERM";',
    "    throw error;",
    "  }",
    "  return original.call(fs, target, options);",
    "};",
  ]);
  try {
    const result = await runDirectEntry(directEntryEnv(parent), {
      preload,
      pattern: "自足 IO fixture",
    });
    const remaining = scratchEntries(parent);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, "cleanup 失败不得让 framework 判 PASS");
    assert.equal(remaining.length, 1, "cleanup 失败应保留 scratch 供宿主核验");
    assert.match(output, /EPERM|清理失败/u);
    recordEvidence("direct-entry-cleanup-failure", {
      status: result.status,
      remaining,
      output,
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("直接 node 入口：外层 owned run + 内层借用不删除父 scope", async () => {
  const base = path.join(scratch, "base-direct-entry-borrowed");
  const parent = openTestRunScope({ baseDir: base });
  const marker = path.join(parent.dir, MARKER);
  try {
    const borrowedEnv = parent.env();
    delete borrowedEnv.NODE_TEST_CONTEXT;
    const result = await runDirectEntry(borrowedEnv, { pattern: "自足 IO fixture" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(parent.dir), true, "内层借用不得删除父 scope");
    assert.equal(fs.existsSync(marker), true, "父 owner marker 必须保留");
    const fixtures = fs.readdirSync(parent.fixturesDir);
    assert.ok(
      fixtures.some((name) => name.startsWith("quality-manifest-")),
      "内层必须在父 scope 内真实物化 fixture",
    );
    recordEvidence("direct-entry-borrowed", {
      status: result.status,
      parent_dir: parent.dir,
      fixtures,
    });
  } finally {
    const closed = parent.close();
    assert.equal(closed.removed, true, "父 owner 自回收 scratch");
    assert.deepEqual(scratchEntries(base), []);
  }
});

test("直接 node 入口：原 11 个 IO 证明全量通过且正常回收", async () => {
  const parent = fs.mkdtempSync(path.join(scratch, "direct-entry-normal-"));
  try {
    const result = await runDirectEntry(directEntryEnv(parent));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ℹ pass 11\b/u, "原 11 个 IO 证明不得丢失");
    assert.match(result.stdout, /ℹ fail 0\b/u, "正常直接入口不得有失败");
    const remaining = scratchEntries(parent);
    assert.deepEqual(remaining, [], "正常退出后 owned scratch 必须回收");
    recordEvidence("direct-entry-normal", {
      status: result.status,
      remaining,
      pass_line: result.stdout.match(/ℹ pass \d+/u)?.[0],
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("同一 fixture 规格在 run 内只物化一次；并发子进程复用同一路径/inode", async (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture") });
  t.after(() => parent.close());
  const spec = {
    name: "scope-fixture",
    files: { "alpha.txt": "alpha\n", "nested/beta.txt": "beta\n" },
  };
  const first = materializeFixture(spec, { scope: parent });
  const second = materializeFixture(spec, { scope: parent });
  assert.equal(second.dir, first.dir);

  const childCode = `
import fs from "node:fs";
import path from "node:path";
import { materializeFixture, openTestRunScope } from ${JSON.stringify(TEST_ENV_URL)};
const scope = openTestRunScope();
const fixture = materializeFixture(${JSON.stringify(spec)}, { scope });
const ino = fs.statSync(path.join(fixture.dir, "alpha.txt")).ino;
const closed = scope.close();
console.log(JSON.stringify({
  dir: fixture.dir,
  ino,
  scope: scope.dir,
  existsAfterClose: fs.existsSync(fixture.dir),
  borrowedCloseRemoved: closed.removed,
}));
`;
  const runChild = () =>
    runProcess(process.execPath, ["--input-type=module", "-e", childCode], {
      env: parent.env(),
    });
  const [left, right] = await Promise.all([runChild(), runChild()]);
  assert.equal(left.status, 0, left.stderr);
  assert.equal(right.status, 0, right.stderr);
  const leftReport = JSON.parse(left.stdout);
  const rightReport = JSON.parse(right.stdout);
  assert.equal(leftReport.dir, first.dir);
  assert.equal(rightReport.dir, first.dir);
  assert.equal(leftReport.ino, rightReport.ino);
  assert.equal(leftReport.scope, parent.dir);
  assert.equal(leftReport.existsAfterClose, true, "借用入口不得删除父 fixture");
  assert.equal(rightReport.existsAfterClose, true);
  assert.equal(leftReport.borrowedCloseRemoved, false);
  const materialized = fs
    .readdirSync(parent.fixturesDir)
    .filter((name) => name.startsWith(`${spec.name}-`));
  assert.deepEqual(materialized, [path.basename(first.dir)]);
  assert.ok(fs.existsSync(first.files.get("alpha.txt")));
});

// 真实并发反例：两个 Node 子进程在同一 run/同一规格上同时起跑。
// 起跑用 barrier 对齐；首个进入 payload 写入的子进程等待第二个写者（受控慢写），
// 旧实现「各自构建再 rename 竞争」必然让两个子进程都写同一批 fixture 文件。
// 观测点在测试侧包装 node:fs 边界，只记录 fixtures/ 下（排除 .claims 归属记录）
// 的实际 writeFileSync；不依赖最终目录数量，也不给 SUT 任何验收开关。
function writeRaceHarness(dir) {
  const preload = path.join(dir, "fixture-write-probe.cjs");
  fs.writeFileSync(
    preload,
    [
      'const fs = require("node:fs");',
      'const nodePath = require("node:path");',
      "const LOG = process.env.FIXTURE_PROBE_LOG;",
      "const original = fs.writeFileSync;",
      'const MARK = `${nodePath.sep}fixtures${nodePath.sep}`;',
      'const CLAIMS = `${nodePath.sep}.claims${nodePath.sep}`;',
      'const CONTROL = ".fixture-control.json";',
      "let arrived = false;",
      "function append(entry) {",
      '  fs.appendFileSync(LOG, `${JSON.stringify(entry)}\\n`);',
      "}",
      "function arrivedPids() {",
      "  const pids = new Set();",
      '  let lines = "";',
      '  try { lines = fs.readFileSync(LOG, "utf8"); } catch { return pids; }',
      "  for (const line of lines.split(\"\\n\")) {",
      "    if (!line) continue;",
      "    try {",
      "      const entry = JSON.parse(line);",
      '      if (entry.kind === "arrive") pids.add(entry.pid);',
      "    } catch { /* 半行由 append 原子性保证不会出现业务判断 */ }",
      "  }",
      "  return pids;",
      "}",
      "fs.writeFileSync = function (file, ...rest) {",
      "  const target = String(file);",
      "  const isPayload = target.includes(MARK) && !target.includes(CLAIMS) && !target.endsWith(CONTROL);",
      "  if (isPayload) {",
      "    if (!arrived) {",
      "      arrived = true;",
      '      append({ kind: "arrive", pid: process.pid, at: Date.now() });',
      "      const deadline = Date.now() + 2000;",
      "      while (arrivedPids().size < 2 && Date.now() < deadline) {",
      "        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);",
      "      }",
      "      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);",
      "    }",
      '    append({ kind: "write", pid: process.pid, path: target, at: Date.now() });',
      "  }",
      "  return original.call(fs, file, ...rest);",
      "};",
      "",
    ].join("\n"),
  );

  const driver = path.join(dir, "fixture-race-driver.mjs");
  fs.writeFileSync(
    driver,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      `import { materializeFixture, openTestRunScope } from ${JSON.stringify(TEST_ENV_URL)};`,
      "const spec = JSON.parse(process.env.FIXTURE_SPEC);",
      "const barrier = process.env.FIXTURE_BARRIER;",
      "const scope = openTestRunScope();",
      'fs.writeFileSync(path.join(barrier, `arrived-${process.pid}`), "x");',
      "const started = Date.now();",
      "while (Date.now() - started < 20000) {",
      '  const arrivals = fs.readdirSync(barrier).filter((name) => name.startsWith("arrived-")).length;',
      "  if (arrivals >= 2) break;",
      "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);",
      "}",
      "const fixture = materializeFixture(spec, { scope, waitTimeoutMs: 15000 });",
      "scope.close();",
      "console.log(JSON.stringify({ dir: fixture.dir, pid: process.pid }));",
      "",
    ].join("\n"),
  );
  return { preload, driver };
}

function readProbeLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// REV-04：把“waiter 先读到未发布、owner 在其存活判断前发布并正常退出”的精确时序
// 固化为双进程回归。owner preload 停在首个 payload 写入前；waiter preload 停在
// 对 owner PID 的存活判断前，由测试进程按确定顺序放行，不依赖 sleep 猜调度。
function writePublicationRaceHarness(dir) {
  const preload = path.join(dir, "publication-race-preload.cjs");
  fs.writeFileSync(
    preload,
    [
      'const fs = require("node:fs");',
      'const nodePath = require("node:path");',
      "const role = process.env.RACE_ROLE;",
      'if (role === "owner") {',
      "  const original = fs.writeFileSync;",
      "  let stalled = false;",
      "  fs.writeFileSync = function (file, ...rest) {",
      "    const target = String(file);",
      "    const isPayload = target.includes(`${nodePath.sep}fixtures${nodePath.sep}`) &&",
      "      !target.includes(`${nodePath.sep}.claims${nodePath.sep}`) &&",
      '      !target.endsWith(".fixture-control.json");',
      "    if (isPayload && !stalled) {",
      "      stalled = true;",
      "      original.call(fs, process.env.RACE_OWNER_STARTED, String(process.pid));",
      "      while (!fs.existsSync(process.env.RACE_OWNER_RELEASE)) {",
      "        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);",
      "      }",
      "    }",
      "    return original.call(fs, file, ...rest);",
      "  };",
      "}",
      'if (role === "waiter") {',
      "  const original = process.kill;",
      "  let paused = false;",
      "  process.kill = function (pid, signal) {",
      "    if (!paused && signal === 0 && pid === Number(process.env.RACE_OWNER_PID)) {",
      "      paused = true;",
      "      fs.writeFileSync(process.env.RACE_WAITER_AT_CHECK, String(process.pid));",
      "      while (!fs.existsSync(process.env.RACE_WAITER_RELEASE)) {",
      "        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);",
      "      }",
      "    }",
      "    return original.call(process, pid, signal);",
      "  };",
      "}",
      "",
    ].join("\n"),
  );

  const ownerDriver = path.join(dir, "publication-race-owner.mjs");
  fs.writeFileSync(
    ownerDriver,
    [
      "import fs from \"node:fs\";",
      `import { materializeFixture, openTestRunScope } from ${JSON.stringify(TEST_ENV_URL)};`,
      "const scope = openTestRunScope();",
      "const fixture = materializeFixture(JSON.parse(process.env.FIXTURE_SPEC), {",
      "  scope,",
      "  waitTimeoutMs: 15000,",
      "});",
      "scope.close();",
      "console.log(JSON.stringify({ role: \"owner\", dir: fixture.dir, pid: process.pid }));",
      "",
    ].join("\n"),
  );

  const waiterDriver = path.join(dir, "publication-race-waiter.mjs");
  fs.writeFileSync(
    waiterDriver,
    [
      "import fs from \"node:fs\";",
      `import { materializeFixture, openTestRunScope } from ${JSON.stringify(TEST_ENV_URL)};`,
      "const scope = openTestRunScope();",
      "const fixture = materializeFixture(JSON.parse(process.env.FIXTURE_SPEC), {",
      "  scope,",
      "  waitTimeoutMs: 15000,",
      "});",
      "scope.close();",
      "console.log(JSON.stringify({",
      "  role: \"waiter\",",
      "  accepted: true,",
      "  dir: fixture.dir,",
      "  bytes: fs.readFileSync(fixture.files.get(\"alpha.txt\"), \"utf8\"),",
      "}));",
      "",
    ].join("\n"),
  );

  return { preload, ownerDriver, waiterDriver };
}

test("发布竞争：owner 在 waiter 未发布观察与存活判断之间发布并退出，waiter 复用模板", async (t) => {
  const parent = openTestRunScope({
    baseDir: path.join(scratch, "base-fixture-publication-race"),
  });
  const harness = path.join(scratch, "fixture-publication-race-harness");
  fs.mkdirSync(harness, { recursive: true });
  const { preload, ownerDriver, waiterDriver } = writePublicationRaceHarness(harness);
  const spec = { name: "publication-race-fixture", files: { "alpha.txt": "alpha\n" } };
  const ownerStarted = path.join(harness, "owner-started");
  const ownerRelease = path.join(harness, "owner-release");
  const waiterAtCheck = path.join(harness, "waiter-at-check");
  const waiterRelease = path.join(harness, "waiter-release");
  const started = [];

  t.after(async () => {
    for (const item of started) await stopStarted(item);
    parent.close();
  });

  const owner = startProcess(process.execPath, [ownerDriver], {
    env: {
      ...parent.env(),
      NODE_OPTIONS: `--require=${preload}`,
      RACE_ROLE: "owner",
      FIXTURE_SPEC: JSON.stringify(spec),
      RACE_OWNER_STARTED: ownerStarted,
      RACE_OWNER_RELEASE: ownerRelease,
    },
  });
  started.push(owner);

  try {
    await waitFor(() => fs.existsSync(ownerStarted), 10000);
    assert.equal(claimRecords(parent).length, 1, "owner 必须先取得唯一初始化权");
    assert.equal(
      fs.existsSync(path.join(parent.fixturesDir, "publication-race-fixture")),
      false,
      "owner 在 waiter 观察时仍未发布",
    );

    const waiter = startProcess(process.execPath, [waiterDriver], {
      env: {
        ...parent.env(),
        NODE_OPTIONS: `--require=${preload}`,
        RACE_ROLE: "waiter",
        FIXTURE_SPEC: JSON.stringify(spec),
        RACE_OWNER_PID: String(owner.child.pid),
        RACE_WAITER_AT_CHECK: waiterAtCheck,
        RACE_WAITER_RELEASE: waiterRelease,
      },
    });
    started.push(waiter);

    // waiter 已读到“未发布”并停在 owner 存活判断之前；此刻 owner 仍卡在 payload 写入。
    await waitFor(() => fs.existsSync(waiterAtCheck), 10000);
    fs.writeFileSync(ownerRelease, "go");
    const ownerResult = await owner.done;
    assert.equal(ownerResult.status, 0, ownerResult.stderr);
    assert.equal(owner.child.exitCode, 0);

    // owner 已发布并正常退出，才放行 waiter 的存活判断。
    fs.writeFileSync(waiterRelease, "go");
    const waiterResult = await waiter.done;
    assert.equal(waiterResult.status, 0, waiterResult.stderr);

    const ownerReport = JSON.parse(ownerResult.stdout);
    const waiterReport = JSON.parse(waiterResult.stdout);
    assert.equal(waiterReport.accepted, true);
    assert.equal(waiterReport.dir, ownerReport.dir, "waiter 必须复用 owner 已发布的模板");
    assert.equal(waiterReport.bytes, "alpha\n");
    assert.equal(fs.readFileSync(path.join(ownerReport.dir, "alpha.txt"), "utf8"), "alpha\n");
    assert.deepEqual(
      fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(spec.name)),
      [path.basename(ownerReport.dir)],
      "不得残留 staging 或 waiter 重建副本",
    );
    recordEvidence("fixture-publication-exit-race", {
      spec,
      owner_exit: ownerResult.status,
      waiter_exit: waiterResult.status,
      owner_report: ownerReport,
      waiter_report: waiterReport,
      claims: claimRecords(parent),
    });
  } finally {
    if (!fs.existsSync(ownerRelease)) fs.writeFileSync(ownerRelease, "go");
    if (!fs.existsSync(waiterRelease)) fs.writeFileSync(waiterRelease, "go");
  }
});


// 仅测试侧证据落盘：设置 B84_EVIDENCE_DIR 时把本轮可观测事实写成 JSON。
// 不参与断言，也不是 SUT 的验收开关。
function recordEvidence(name, payload) {
  const dir = process.env.B84_EVIDENCE_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

test("fixture 调用边界：缺少 run scope / 非法等待期限 fail-closed", () => {
  assert.throws(
    () => materializeFixture({ name: "no-scope", files: { "alpha.txt": "alpha\n" } }),
    /需要外层 run scope/u,
  );
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-boundary") });
  try {
    assert.throws(
      () =>
        materializeFixture(
          { name: "bad-wait", files: { "alpha.txt": "alpha\n" } },
          { scope: parent, waitTimeoutMs: 0 },
        ),
      /waitTimeoutMs 必须是正数/u,
    );
  } finally {
    parent.close();
  }
});

test("发布事实与payload同目录：不依赖外置 ready，owner 退出后可直接复用", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-crash-window") });
  t.after(() => parent.close());
  const spec = { name: "crash-window-fixture", files: { "alpha.txt": "alpha\n" } };
  const first = materializeFixture(spec, { scope: parent });
  const claimsDir = path.join(parent.fixturesDir, ".claims");
  assert.deepEqual(
    fs.readdirSync(claimsDir).filter((name) => name.endsWith(".ready")),
    [],
    "不再写外置 ready 发布窗口",
  );
  // owner 已发布并退出后，claim 不再是可用性前提；目标目录内的控制记录自描述。
  for (const name of fs.readdirSync(claimsDir)) {
    if (name.endsWith(".claim")) fs.rmSync(path.join(claimsDir, name));
  }
  const reused = materializeFixture(spec, { scope: parent });
  assert.equal(reused.dir, first.dir);
  assert.equal(fs.readFileSync(reused.files.get("alpha.txt"), "utf8"), "alpha\n");
  assert.deepEqual(
    fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(spec.name)),
    [path.basename(first.dir)],
  );

  const control = path.join(first.dir, ".fixture-control.json");
  const controlBytes = fs.readFileSync(control);
  const controlMode = fs.statSync(control).mode & 0o777;
  fs.chmodSync(control, 0o644);
  try {
    fs.rmSync(control);
    assert.throws(
      () => materializeFixture(spec, { scope: parent }),
      /控制记录|旧格式|不完整/u,
      "裸目录/旧格式不得 fallback 为可用模板",
    );
  } finally {
    // 断言先抛出也要恢复控制记录与权限，避免把借来的模板留在被篡改状态。
    fs.writeFileSync(control, controlBytes);
    fs.chmodSync(control, controlMode);
  }
});

test("反例：两个真实 Node 子进程同 scope/规格竞争，payload 只构建一次", async (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-race") });
  t.after(() => parent.close());
  const harness = path.join(scratch, "fixture-race-harness");
  fs.mkdirSync(harness, { recursive: true });
  const barrier = path.join(harness, "barrier");
  fs.mkdirSync(barrier);
  const probeLog = path.join(harness, "probe.jsonl");
  const { preload, driver } = writeRaceHarness(harness);
  const spec = {
    name: "race-fixture",
    files: { "alpha.txt": "alpha\n", "nested/beta.txt": "beta\n" },
  };
  const env = {
    ...parent.env(),
    NODE_OPTIONS: `--require=${preload}`,
    FIXTURE_PROBE_LOG: probeLog,
    FIXTURE_SPEC: JSON.stringify(spec),
    FIXTURE_BARRIER: barrier,
  };

  const [left, right] = await Promise.all([
    runProcess(process.execPath, [driver], { env }),
    runProcess(process.execPath, [driver], { env }),
  ]);
  assert.equal(left.status, 0, left.stderr);
  assert.equal(right.status, 0, right.stderr);
  const leftReport = JSON.parse(left.stdout);
  const rightReport = JSON.parse(right.stdout);
  assert.equal(leftReport.dir, rightReport.dir, "两个消费者必须拿到同一发布目录");

  const events = readProbeLog(probeLog);
  const writes = events.filter((entry) => entry.kind === "write");
  const payloadWrites = (suffix) => writes.filter((entry) => entry.path.endsWith(suffix));
  assert.equal(payloadWrites("/alpha.txt").length, 1, "alpha.txt 必须只被构建一次");
  assert.equal(payloadWrites("/nested/beta.txt").length, 1, "nested/beta.txt 必须只被构建一次");
  assert.equal(writes.length, 2, `fixture payload 写入总数应为 2，实际 ${writes.length}`);
  assert.equal(
    new Set(writes.map((entry) => entry.pid)).size,
    1,
    "payload 只能由一个 owner 进程构建",
  );

  const payloadDirs = fs
    .readdirSync(parent.fixturesDir)
    .filter((name) => !name.startsWith(".claims"))
    .filter((name) => name.startsWith(spec.name));
  assert.deepEqual(payloadDirs, [path.basename(leftReport.dir)], "不得残留 staging 等副本");
  for (const rel of Object.keys(spec.files)) {
    assert.equal(
      fs.readFileSync(path.join(leftReport.dir, rel), "utf8"),
      spec.files[rel],
      `发布内容必须与规格一致: ${rel}`,
    );
  }
  const claimsDir = path.join(parent.fixturesDir, ".claims");
  const records = fs.readdirSync(claimsDir);
  assert.ok(records.some((name) => name.endsWith(".claim")), "必须留下唯一初始化归属记录");
  assert.ok(
    records.every((name) => !name.endsWith(".ready")),
    "不得再写外置 ready 发布记录",
  );
  assert.equal(
    fs.existsSync(path.join(leftReport.dir, ".fixture-control.json")),
    true,
    "发布事实必须与payload同目录封存",
  );
  recordEvidence("fixture-race", {
    spec,
    child_exit: { left: left.status, right: right.status },
    consumers: [leftReport, rightReport],
    payload_dirs: payloadDirs,
    records,
    control_record: JSON.parse(
      fs.readFileSync(path.join(leftReport.dir, ".fixture-control.json"), "utf8"),
    ),
    arrive_pids: [...new Set(events.filter((e) => e.kind === "arrive").map((e) => e.pid))],
    payload_writes: writes,
  });
});

test("fixture 初始化失败：不发布半成品，后续等待者明确失败且不重建", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-failure") });
  t.after(() => parent.close());
  const spec = { name: "failing-fixture", files: { "alpha.txt": "alpha\n" } };
  const stagingMarker = `${path.sep}fixtures${path.sep}.staging-`;
  const original = fs.writeFileSync;
  let attempts = 0;
  fs.writeFileSync = function (file, ...rest) {
    const target = String(file);
    if (target.includes(stagingMarker) && target.endsWith(`${path.sep}alpha.txt`)) {
      attempts += 1;
      const error = new Error("EACCES: injected fixture write failure");
      error.code = "EACCES";
      throw error;
    }
    return original.call(fs, file, ...rest);
  };
  try {
    assert.throws(
      () => materializeFixture(spec, { scope: parent }),
      /fixture .*初始化失败|EACCES/u,
    );
  } finally {
    fs.writeFileSync = original;
  }
  assert.equal(attempts, 1, "owner 只尝试构建一次");
  const published = fs
    .readdirSync(parent.fixturesDir)
    .filter((name) => name.startsWith(spec.name));
  assert.deepEqual(published, [], "失败不得发布半成品");
  assert.deepEqual(
    fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(".staging-")),
    [],
    "失败后不得残留 staging",
  );
  const claimsDir = path.join(parent.fixturesDir, ".claims");
  assert.ok(
    fs.readdirSync(claimsDir).some((name) => name.endsWith(".failed")),
    "必须留下失败事实，供等待者 fail-closed",
  );

  let followerError = "";
  try {
    materializeFixture(spec, { scope: parent });
  } catch (error) {
    followerError = error.message;
  }
  assert.match(followerError, /初始化已失败/u, "等待者不得静默重新构建");
  assert.deepEqual(
    fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(spec.name)),
    [],
  );
  recordEvidence("fixture-init-failure", {
    spec,
    build_attempts: attempts,
    published_dirs: published,
    claims: fs.readdirSync(claimsDir),
    follower_error: followerError,
  });
});

// 真实 stalled owner：子进程已取得初始化权并落盘 claim，随后卡在 payload 写入
// （ready/failed 都未写）。用于验证等待者遇 owner 被杀 / 等待期限耗尽时的
// 基础设施失败语义：明确失败、不重建、不无限等待。
function startStalledOwner(parent, spec, harness) {
  fs.mkdirSync(harness, { recursive: true });
  const preload = path.join(harness, "stall-probe.cjs");
  fs.writeFileSync(
    preload,
    [
      'const fs = require("node:fs");',
      'const nodePath = require("node:path");',
      'const MARK = `${nodePath.sep}fixtures${nodePath.sep}`;',
      'const CLAIMS = `${nodePath.sep}.claims${nodePath.sep}`;',
      "const original = fs.writeFileSync;",
      "fs.writeFileSync = function (file, ...rest) {",
      "  const target = String(file);",
      "  if (target.includes(MARK) && !target.includes(CLAIMS)) {",
      "    original.call(fs, process.env.FIXTURE_STALL_MARKER, String(process.pid));",
      "    while (true) {",
      "      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);",
      "    }",
      "  }",
      "  return original.call(fs, file, ...rest);",
      "};",
      "",
    ].join("\n"),
  );
  const driver = path.join(harness, "stall-driver.mjs");
  fs.writeFileSync(
    driver,
    [
      `import { materializeFixture, openTestRunScope } from ${JSON.stringify(TEST_ENV_URL)};`,
      "const scope = openTestRunScope();",
      "materializeFixture(JSON.parse(process.env.FIXTURE_SPEC), { scope });",
      "scope.close();",
      "",
    ].join("\n"),
  );
  const markerDir = path.join(harness, "stalled");
  fs.mkdirSync(markerDir);
  const started = startProcess(process.execPath, [driver], {
    env: {
      ...parent.env(),
      NODE_OPTIONS: `--require=${preload}`,
      FIXTURE_SPEC: JSON.stringify(spec),
      FIXTURE_STALL_MARKER: path.join(markerDir, "stalled"),
    },
  });
  return { started, markerDir };
}

async function waitForStalledOwner(markerDir) {
  await waitFor(() => fs.existsSync(path.join(markerDir, "stalled")), 10000);
}

async function stopStalledOwner(started) {
  await stopStarted(started);
}

function claimRecords(parent) {
  const claimsDir = path.join(parent.fixturesDir, ".claims");
  if (!fs.existsSync(claimsDir)) return [];
  return fs.readdirSync(claimsDir).filter((name) => name.endsWith(".claim"));
}

test("fixture owner 被杀：等待者明确基础设施失败，不重建不无限等待", async (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-dead-owner") });
  let started = null;
  // 同一个 after 先停本用例的 stalled owner，再释放父 scope；断言先抛出也不会
  // 让子进程活过 parent.close。
  t.after(async () => {
    if (started) await stopStalledOwner(started);
    parent.close();
  });
  const spec = { name: "dead-owner-fixture", files: { "alpha.txt": "alpha\n" } };
  const owner = startStalledOwner(
    parent,
    spec,
    path.join(scratch, "dead-owner-harness"),
  );
  started = owner.started;
  const { markerDir } = owner;
  try {
    await waitForStalledOwner(markerDir);
    assert.equal(claimRecords(parent).length, 1, "owner 必须先取得唯一初始化权");
    started.child.kill("SIGKILL");
    await started.done;
    assert.equal(started.child.signalCode, "SIGKILL");
    const startedAt = Date.now();
    let awaitedError = "";
    try {
      materializeFixture(spec, { scope: parent, waitTimeoutMs: 5000 });
    } catch (error) {
      awaitedError = error.message;
    }
    assert.match(awaitedError, /owner.*已退出/u);
    assert.ok(Date.now() - startedAt < 3000, "owner 已死时不得等满期限");
    recordEvidence("fixture-dead-owner", {
      spec,
      owner_pid: started.child.pid,
      owner_signal: started.child.signalCode,
      claim: claimRecords(parent),
      wait_ms: Date.now() - startedAt,
      waiter_error: awaitedError,
    });
    assert.deepEqual(
      fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(spec.name)),
      [],
      "owner 被杀后等待者不得自行构建",
    );
  } finally {
    await stopStalledOwner(started);
  }
});

test("fixture 等待期限耗尽：明确超时失败，不重建", async (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-timeout") });
  let started = null;
  // 先停 stalled owner，再释放 base-fixture-timeout；等待超时断言失败时同样按此顺序。
  t.after(async () => {
    if (started) await stopStalledOwner(started);
    parent.close();
  });
  const spec = { name: "stuck-owner-fixture", files: { "alpha.txt": "alpha\n" } };
  const owner = startStalledOwner(
    parent,
    spec,
    path.join(scratch, "timeout-harness"),
  );
  started = owner.started;
  const { markerDir } = owner;
  try {
    await waitForStalledOwner(markerDir);
    const startedAt = Date.now();
    let awaitedError = "";
    try {
      materializeFixture(spec, { scope: parent, waitTimeoutMs: 150 });
    } catch (error) {
      awaitedError = error.message;
    }
    assert.match(awaitedError, /等待 fixture 初始化超时/u);
    recordEvidence("fixture-wait-timeout", {
      spec,
      owner_pid: started.child.pid,
      claim: claimRecords(parent),
      wait_timeout_ms: 150,
      elapsed_ms: Date.now() - startedAt,
      waiter_error: awaitedError,
    });
    assert.deepEqual(
      fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(spec.name)),
      [],
    );
  } finally {
    await stopStalledOwner(started);
  }
});

test("必要工作副本彼此隔离、绑定 TestContext 清理、模板哈希与只读性不变", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-workcopy") });
  t.after(() => parent.close());
  const fixture = materializeFixture(
    { name: "workcopy-fixture", files: { "alpha.txt": "alpha\n", "nested/beta.txt": "beta\n" } },
    { scope: parent },
  );
  const before = fixtureTemplateHash(fixture);

  const left = createWorkingCopy(fixture, { scope: parent, context: t });
  const right = createWorkingCopy(fixture, { scope: parent, context: t });
  assert.notEqual(left.dir, right.dir);
  fs.writeFileSync(left.files.get("alpha.txt"), "changed-left\n");
  fs.writeFileSync(right.files.get("alpha.txt"), "changed-right\n");
  assert.equal(fs.readFileSync(left.files.get("alpha.txt"), "utf8"), "changed-left\n");
  assert.equal(fs.readFileSync(right.files.get("alpha.txt"), "utf8"), "changed-right\n");
  assert.equal(fixtureTemplateHash(fixture), before);

  assert.throws(
    () => fs.writeFileSync(fixture.files.get("alpha.txt"), "tampered\n"),
    /EACCES|EPERM/u,
    "只读模板不应被消费者修改",
  );

  left.cleanup();
  assert.equal(fs.existsSync(left.dir), false);
  assert.equal(fs.existsSync(right.dir), true, "right 由 t.after 在测试结束后清理");
});

test("Shell 入口 novel_node_test_scope 使用同一作用域并透传退出码", async () => {
  const base = path.join(scratch, "base-shell-entry");
  const script =
    'source "$HELPER_PATH"\n' +
    'novel_node_test_scope --base "$SCOPE_BASE" -- /bin/bash -c \'printf "%s" "$NOVEL_TEST_RUN_DIR"\'\n';
  const result = await runProcess("/bin/bash", ["-c", script], {
    env: { ...process.env, TMPDIR: scratch, HELPER_PATH: HELPER, SCOPE_BASE: base },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /ai-novel-test-run\./);
  assert.ok(result.stdout.trim().startsWith(`${base}${path.sep}`), "独立入口应落在测试独有父目录");
  assert.equal(fs.existsSync(result.stdout.trim()), false);
});

test("CLI 参数与借用边界 fail-closed，独立入口不散入全局 tmp", async () => {
  const base = path.join(scratch, "base-cli-boundary");
  const cases = [
    [["--wat", "--", "/bin/bash", "-c", "exit 0"], 64, /未知参数/u],
    [["--timeout-ms", "0", "--", "/bin/bash", "-c", "exit 0"], 64, /需要正数/u],
    [["--archive"], 64, /需要参数/u],
    [["--"], 64, /需要 -- 之后的命令/u],
    [[], 64, /需要 -- 之后的命令/u],
  ];
  for (const [args, status, message] of cases) {
    const result = await runAdapter(args, { env: { ...process.env, TMPDIR: scratch } });
    assert.equal(result.status, status, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, message);
  }
  const noSubcommand = await runProcess(process.execPath, [TEST_ENV], {
    env: { ...process.env, TMPDIR: scratch },
  });
  assert.equal(noSubcommand.status, 64);
  assert.match(noSubcommand.stderr, /用法：/u);

  const valid = await runAdapter(
    ["--base", base, "--", "/bin/bash", "-c", "exit 0"],
    { env: { ...process.env, TMPDIR: scratch } },
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(fs.readdirSync(base), []);
});

test("借用边界：缺 marker / 缺 tmp 与外层 scope 都 fail-closed", async (t) => {
  const missingMarker = fs.mkdtempSync(path.join(scratch, "borrow-missing-marker-"));
  t.after(() => fs.rmSync(missingMarker, { recursive: true, force: true }));
  const noMarker = await runAdapter(["--", "/bin/bash", "-c", "exit 0"], {
    env: { ...process.env, TMPDIR: scratch, NOVEL_TEST_RUN_DIR: missingMarker },
  });
  assert.notEqual(noMarker.status, 0);
  assert.match(noMarker.stderr, /缺少合法 .novel-test-run-owner\.json/u);

  const missingTmp = fs.mkdtempSync(path.join(scratch, "borrow-missing-tmp-"));
  t.after(() => fs.rmSync(missingTmp, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(missingTmp, MARKER),
    `${JSON.stringify({ kind: "ai-novel-test-run", runId: "fixture" })}\n`,
  );
  const noTmp = await runAdapter(["--", "/bin/bash", "-c", "exit 0"], {
    env: { ...process.env, TMPDIR: scratch, NOVEL_TEST_RUN_DIR: missingTmp },
  });
  assert.notEqual(noTmp.status, 0);
  assert.match(noTmp.stderr, /缺少 tmp 目录/u);
});

test("fixture 规格纯校验：非法形状/名称/路径/内容 fail-closed", () => {
  const cases = [
    [null, /普通对象/u],
    [[], /普通对象/u],
    [{ name: "Bad_Name", files: { "a.txt": "a" } }, /kebab-case/u],
    [{ name: "ok", files: [] }, /files 普通对象/u],
    // leader-review/file-shape-non-equivalence.json：字符串是可迭代的 key 集合，
    // 但不是 files mapping；不能因两个 || 任一改 && 就被 Object.keys 拆成 index→char。
    [{ name: "ok", files: "abc" }, /files 普通对象/u],
    [{ name: "ok", files: null }, /files 普通对象/u],
    [{ name: "ok", files: 123 }, /files 普通对象/u],
    [{ name: "ok", files: {} }, /至少需要一个文件/u],
    [{ name: "ok", files: { "/abs.txt": "a" } }, /repo 相对 POSIX/u],
    [{ name: "ok", files: { "a\\b.txt": "a" } }, /repo 相对 POSIX/u],
    [{ name: "ok", files: { "a/../b.txt": "a" } }, /不得包含/u],
    [{ name: "ok", files: { "a//b.txt": "a" } }, /不得包含/u],
    [{ name: "ok", files: { "a.txt": 1 } }, /内容必须是字符串/u],
  ];
  for (const [spec, message] of cases) {
    assert.throws(() => normalizeFixtureSpec(spec), message);
  }
  const normalized = normalizeFixtureSpec({
    name: "ok-name",
    files: { "b.txt": "b", "a.txt": "a" },
  });
  assert.deepEqual(Object.keys(normalized.files), ["a.txt", "b.txt"]);
});

test("fixture 复用前校验缺失/内容漂移/额外文件", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-verify") });
  t.after(() => parent.close());
  const spec = {
    name: "verify-fixture",
    files: { "alpha.txt": "alpha\n", "nested/beta.txt": "beta\n" },
  };
  const fixture = materializeFixture(spec, { scope: parent });
  const claimsDir = path.join(parent.fixturesDir, ".claims");
  const removeReady = () => {
    for (const name of fs.readdirSync(claimsDir)) {
      if (name.endsWith(".ready")) fs.rmSync(path.join(claimsDir, name));
    }
  };
  const alpha = fixture.files.get("alpha.txt");
  const alphaMode = fs.statSync(alpha).mode & 0o777;
  fs.chmodSync(alpha, 0o644);
  try {
    fs.writeFileSync(alpha, "tampered\n");
    removeReady();
    assert.throws(() => materializeFixture(spec, { scope: parent }), /内容与规格不一致/u);
  } finally {
    fs.writeFileSync(alpha, "alpha\n");
    fs.chmodSync(alpha, alphaMode);
  }

  const extra = path.join(fixture.dir, "extra.txt");
  try {
    fs.writeFileSync(extra, "extra\n");
    assert.throws(() => materializeFixture(spec, { scope: parent }), /含规格外文件/u);
  } finally {
    fs.rmSync(extra, { force: true });
  }

  fs.rmSync(fixture.files.get("nested/beta.txt"));
  assert.throws(() => materializeFixture(spec, { scope: parent }), /缺少 nested\/beta\.txt/u);
});

test("工作副本：无 context 时由调用方 cleanup，缺 scope fail-closed", (t) => {
  assert.throws(
    () => createWorkingCopy({ name: "no-scope", files: new Map() }),
    /需要 run scope/u,
  );
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-workcopy-manual") });
  t.after(() => parent.close());
  const fixture = materializeFixture(
    { name: "manual-fixture", files: { "alpha.txt": "alpha\n" } },
    { scope: parent },
  );
  const copy = createWorkingCopy(fixture, { scope: parent });
  assert.equal(fs.existsSync(copy.dir), true);
  copy.cleanup();
  copy.cleanup();
  assert.equal(fs.existsSync(copy.dir), false);
  // scope 只接受真实 run scope 对象；空字符串不能被 ??.|| 回退成 fixture.scope。
  assert.throws(
    () => createWorkingCopy(fixture, { scope: "" }),
    /需要 run scope/u,
  );
  // 没有 TestContext/after 的普通对象不注册钩子，由调用方 cleanup。
  const noAfter = createWorkingCopy(fixture, { scope: parent, context: {} });
  assert.equal(fs.existsSync(noAfter.dir), true);
  noAfter.cleanup();
  assert.equal(fs.existsSync(noAfter.dir), false);
});

test("工作副本 cleanup：失败不提前标完成，成功后旧路径重建的宿主资源不被第二次删除", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-workcopy-idempotent") });
  t.after(() => parent.close());
  const fixture = materializeFixture(
    { name: "workcopy-idempotent", files: { "alpha.txt": "alpha\n" } },
    { scope: parent },
  );
  const copy = createWorkingCopy(fixture, { scope: parent });

  // 清理失败不能提前标记完成：目录仍由本 owner 持有，下一次 cleanup 必须能重试。
  const originalRmSync = fs.rmSync;
  fs.rmSync = function (target, ...rest) {
    if (String(target) === copy.dir) {
      const error = new Error("EACCES: injected workcopy cleanup failure");
      error.code = "EACCES";
      throw error;
    }
    return originalRmSync.call(fs, target, ...rest);
  };
  try {
    assert.throws(() => copy.cleanup(), /injected workcopy cleanup failure/u);
  } finally {
    fs.rmSync = originalRmSync;
  }
  assert.equal(fs.existsSync(copy.dir), true, "清理失败必须保留目录供重试/核验");

  copy.cleanup();
  assert.equal(fs.existsSync(copy.dir), false, "失败后重试应完成清理");

  // 真实外部效果：成功清理后宿主在旧路径重建资源；第二次 cleanup 只能复用完成
  // 事实，不得再删除这个后来者。
  const sentinel = path.join(copy.dir, "later-resource.txt");
  fs.mkdirSync(copy.dir, { recursive: true });
  fs.writeFileSync(sentinel, "later-resource\n");
  copy.cleanup();
  assert.equal(
    fs.readFileSync(sentinel, "utf8"),
    "later-resource\n",
    "成功后重复 cleanup 不得触碰旧路径上的新资源",
  );
});

test("工作副本复制中途失败：首个文件真实落盘，第二个边界失败时关闭本 case 目录", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-workcopy-copy-failure") });
  t.after(() => parent.close());
  const fixture = materializeFixture(
    { name: "workcopy-copy-failure", files: { "alpha.txt": "alpha\n", "nested/beta.txt": "beta\n" } },
    { scope: parent },
  );
  const workPrefix = `${parent.workDir}${path.sep}${fixture.name}-`;
  const isWorkCopyTarget = (target) => String(target).startsWith(workPrefix);
  const originalCopyFileSync = fs.copyFileSync;
  const originalRmSync = fs.rmSync;

  // 单失败：第一个 copyFileSync 走真实实现并落盘，第二个才在边界抛错；证明 partial
  // copy 真实存在，而不是“第一次就失败”的空目录。
  let copyCalls = 0;
  let copyDir = "";
  let firstTarget = "";
  let firstContent = "";
  let firstPresentAtSecond = false;
  fs.copyFileSync = function (source, target, ...rest) {
    if (!isWorkCopyTarget(target)) {
      return originalCopyFileSync.call(fs, source, target, ...rest);
    }
    copyCalls += 1;
    if (copyCalls === 1) {
      const result = originalCopyFileSync.call(fs, source, target, ...rest);
      copyDir = path.dirname(String(target));
      firstTarget = String(target);
      firstContent = fs.readFileSync(firstTarget, "utf8");
      return result;
    }
    if (copyCalls === 2) {
      firstPresentAtSecond = fs.existsSync(firstTarget);
      const error = new Error("EACCES: injected workcopy copy failure");
      error.code = "EACCES";
      throw error;
    }
    return originalCopyFileSync.call(fs, source, target, ...rest);
  };
  let copyFailure = null;
  try {
    try {
      createWorkingCopy(fixture, { scope: parent, context: t });
    } catch (error) {
      copyFailure = error;
    }
  } finally {
    fs.copyFileSync = originalCopyFileSync;
  }
  assert.equal(copyCalls, 2, "复制必须走到第二个文件才失败");
  assert.equal(path.basename(firstTarget), "alpha.txt");
  assert.equal(firstContent, "alpha\n", "第一个 copyFileSync 必须真实成功落盘");
  assert.equal(firstPresentAtSecond, true, "第二个复制失败前，第一个文件已在工作副本中");
  assert.match(copyFailure?.message ?? "", /injected workcopy copy failure/u);
  assert.notEqual(copyDir, "");
  assert.ok(copyDir.startsWith(workPrefix), "失败目录必须是本 case 新建的工作副本");
  assert.equal(fs.existsSync(copyDir), false, "第二个文件失败后必须关闭本 case 的工作目录");

  // 双失败：同一 partial copy 边界 + 本 case 目录清理失败；只定位本 case 捕获的
  // copyDir 清场，不触碰共享 workDir 里的其他 owner 资源。
  let doubleCalls = 0;
  let doubleCopyDir = "";
  let doubleFirstTarget = "";
  let doubleFirstContent = "";
  let doubleFirstPresentAtSecond = false;
  fs.copyFileSync = function (source, target, ...rest) {
    if (!isWorkCopyTarget(target)) {
      return originalCopyFileSync.call(fs, source, target, ...rest);
    }
    doubleCalls += 1;
    if (doubleCalls === 1) {
      const result = originalCopyFileSync.call(fs, source, target, ...rest);
      doubleCopyDir = path.dirname(String(target));
      doubleFirstTarget = String(target);
      doubleFirstContent = fs.readFileSync(doubleFirstTarget, "utf8");
      return result;
    }
    if (doubleCalls === 2) {
      doubleFirstPresentAtSecond = fs.existsSync(doubleFirstTarget);
      const error = new Error("EACCES: injected workcopy copy failure");
      error.code = "EACCES";
      throw error;
    }
    return originalCopyFileSync.call(fs, source, target, ...rest);
  };
  fs.rmSync = function (target, ...rest) {
    if (doubleCopyDir && String(target) === doubleCopyDir) {
      const error = new Error("EPERM: injected workcopy cleanup failure");
      error.code = "EPERM";
      throw error;
    }
    return originalRmSync.call(fs, target, ...rest);
  };
  let doubleFailure = null;
  try {
    try {
      createWorkingCopy(fixture, { scope: parent });
    } catch (error) {
      doubleFailure = error;
    }
  } finally {
    // 无论断言/构建如何结束，两个注入都从真实函数恢复。
    fs.copyFileSync = originalCopyFileSync;
    fs.rmSync = originalRmSync;
  }
  assert.equal(doubleCalls, 2, "双失败也必须先真实写完第一个文件");
  assert.equal(path.basename(doubleFirstTarget), "alpha.txt");
  assert.equal(doubleFirstContent, "alpha\n");
  assert.equal(doubleFirstPresentAtSecond, true);
  assert.ok(doubleFailure instanceof AggregateError, "双失败必须同时携带 primary 与 cleanup");
  assert.equal(doubleFailure.errors.length, 2);
  assert.match(doubleFailure.message, /injected workcopy copy failure/u);
  assert.match(doubleFailure.message, /injected workcopy cleanup failure/u);
  assert.match(doubleFailure.errors[0].message, /injected workcopy copy failure/u);
  assert.equal(doubleFailure.errors[0].code, "EACCES");
  assert.match(doubleFailure.errors[1].message, /injected workcopy cleanup failure/u);
  assert.equal(doubleFailure.errors[1].code, "EPERM");
  assert.notEqual(doubleCopyDir, "");
  assert.ok(doubleCopyDir.startsWith(workPrefix), "双失败目录必须是本 case 新建的工作副本");
  assert.equal(fs.existsSync(doubleCopyDir), true, "cleanup 失败时保留本 case 自己的目录");
  assert.equal(
    fs.existsSync(path.join(doubleCopyDir, "alpha.txt")),
    true,
    "双失败时 partial copy 事实仍在",
  );

  // 只清本 case 捕获的目录；共享 workDir 中其他 owner 的资源不参与清场。
  fs.rmSync(doubleCopyDir, { recursive: true, force: true });
  assert.equal(fs.existsSync(doubleCopyDir), false);
});

// 只让目标工作副本的 rmSync 失败；返回的恢复函数必须在 finally 调用。
function injectWorkCopyCleanupFailure(holder) {
  const originalRmSync = fs.rmSync;
  fs.rmSync = function (target, ...rest) {
    if (holder.dir && String(target) === holder.dir) {
      const error = new Error("EACCES: injected withWorkingCopy cleanup failure");
      error.code = "EACCES";
      throw error;
    }
    return originalRmSync.call(fs, target, ...rest);
  };
  return () => {
    fs.rmSync = originalRmSync;
  };
}

test("withWorkingCopy：正常返回在关闭副本后交回结果，借用父 scope 不被删除", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-with-workcopy") });
  t.after(() => parent.close());
  const sentinel = path.join(parent.dir, "borrowed-sentinel.txt");
  fs.writeFileSync(sentinel, "kept\n");
  const fixture = materializeFixture(
    { name: "with-workcopy-normal", files: { "alpha.txt": "alpha\n" } },
    { scope: parent },
  );
  let copyDir;
  const value = withWorkingCopy(
    fixture,
    (copy) => {
      copyDir = copy.dir;
      assert.equal(fs.readFileSync(path.join(copy.dir, "alpha.txt"), "utf8"), "alpha\n");
      return "used";
    },
    { scope: parent },
  );
  assert.equal(value, "used", "正常返回必须交回回调结果");
  assert.ok(copyDir.startsWith(`${parent.workDir}${path.sep}`), "副本由 createWorkingCopy 建在本 run 的 workDir 下");
  assert.equal(fs.existsSync(copyDir), false, "正常返回后必须关闭本 case 副本");
  assert.equal(fs.readFileSync(sentinel, "utf8"), "kept\n", "借用父 scope 的资源不被删除");
});

test("withWorkingCopy：回调单失败与 cleanup 单失败各自原样抛出，副本仍实际回收", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-with-workcopy-single") });
  t.after(() => parent.close());
  const fixture = materializeFixture(
    { name: "with-workcopy-single", files: { "alpha.txt": "alpha\n" } },
    { scope: parent },
  );

  let callbackDir;
  let callbackFailure;
  try {
    withWorkingCopy(
      fixture,
      (copy) => {
        callbackDir = copy.dir;
        throw new Error("injected withWorkingCopy callback failure");
      },
      { scope: parent },
    );
  } catch (error) {
    callbackFailure = error;
  }
  assert.match(callbackFailure?.message ?? "", /injected withWorkingCopy callback failure/u);
  assert.equal(callbackFailure instanceof AggregateError, false, "单失败保持原错误形状");
  assert.equal(fs.existsSync(callbackDir), false, "回调失败后仍必须关闭副本");

  const holder = { dir: "" };
  let cleanupCopy;
  let cleanupFailure;
  const restore = injectWorkCopyCleanupFailure(holder);
  try {
    withWorkingCopy(
      fixture,
      (copy) => {
        cleanupCopy = copy;
        holder.dir = copy.dir;
        return "ok";
      },
      { scope: parent },
    );
  } catch (error) {
    cleanupFailure = error;
  } finally {
    restore();
  }
  assert.match(cleanupFailure?.message ?? "", /injected withWorkingCopy cleanup failure/u);
  assert.equal(cleanupFailure instanceof AggregateError, false, "cleanup 单失败也保持原错误形状");
  assert.equal(cleanupFailure.code, "EACCES");
  assert.equal(fs.existsSync(holder.dir), true, "cleanup 失败时目录保留供核验");
  cleanupCopy.cleanup();
  assert.equal(fs.existsSync(holder.dir), false, "恢复注入后重试实际回收副本");
});

test("withWorkingCopy：回调与 cleanup 双失败同时保留，恢复注入后可回收", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-with-workcopy-double") });
  t.after(() => parent.close());
  const fixture = materializeFixture(
    { name: "with-workcopy-double", files: { "alpha.txt": "alpha\n" } },
    { scope: parent },
  );
  const holder = { dir: "" };
  let doubleCopy;
  let doubleFailure;
  const restore = injectWorkCopyCleanupFailure(holder);
  try {
    withWorkingCopy(
      fixture,
      (copy) => {
        doubleCopy = copy;
        holder.dir = copy.dir;
        throw new Error("injected withWorkingCopy callback primary");
      },
      { scope: parent },
    );
  } catch (error) {
    doubleFailure = error;
  } finally {
    restore();
  }
  assert.ok(doubleFailure instanceof AggregateError, "双失败必须同时携带 primary 与 cleanup");
  assert.equal(doubleFailure.errors.length, 2);
  assert.match(doubleFailure.errors[0].message, /injected withWorkingCopy callback primary/u);
  assert.match(doubleFailure.errors[1].message, /injected withWorkingCopy cleanup failure/u);
  assert.match(doubleFailure.message, /工作副本 清理失败/u);
  assert.equal(fs.existsSync(holder.dir), true, "双失败时目录保留供核验");
  doubleCopy.cleanup();
  assert.equal(fs.existsSync(holder.dir), false, "恢复注入后实际回收副本");
});

// ── 构造形式（{name, inputs, build}）：与字面形式共享 claim/发布/复用/工作副本 ──
// 观测点在测试侧 builder 与真实目录/文件边界，不给 SUT 增加验收开关；构造形式只核对
// 声明输出、完整文件集合与字节哈希，业务正确性仍由各自领域测试独立证明。

function appendBuildMarker(marker, kind = "build") {
  fs.appendFileSync(marker, `${JSON.stringify({ kind, pid: process.pid })}\n`);
}

function markerEvents(marker) {
  if (!fs.existsSync(marker)) return [];
  return fs
    .readFileSync(marker, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildPayloadSpec(name, marker, inputs = { schema: "provider_runs/v1", seed: "two-rows" }) {
  return {
    name,
    inputs,
    build(staging) {
      appendBuildMarker(marker);
      fs.writeFileSync(path.join(staging, "payload.txt"), `${inputs.seed}\n`);
      return ["payload.txt"];
    },
  };
}

function builtFixtureEntries(fixture) {
  return fs.readdirSync(fixture.dir).sort();
}

function controlRecord(fixture) {
  return JSON.parse(
    fs.readFileSync(path.join(fixture.dir, ".fixture-control.json"), "utf8"),
  );
}

test("构造形式规格：inputs 非空文本、build 函数、与 files 互斥", () => {
  const build = (staging) => {
    fs.writeFileSync(path.join(staging, "a.txt"), "a");
    return ["a.txt"];
  };
  const normalized = normalizeFixtureSpec({
    name: "built-shape",
    inputs: { schema: "s", seed: "x" },
    build,
  });
  assert.equal(normalized.form, "built");
  assert.deepEqual(Object.keys(normalized.inputs), ["schema", "seed"]);
  assert.equal(normalizeFixtureSpec({ name: "literal-shape", files: { "a.txt": "a" } }).form, "literal");
  // 空值是可构造输入（空 seed/空配置），与缺键不同；键仍必须是非空文本。
  const withEmptyValue = normalizeFixtureSpec({ name: "built-empty-value", inputs: { seed: "" }, build });
  assert.deepEqual(withEmptyValue.inputs, { seed: "" });
  assert.equal(Object.hasOwn(withEmptyValue.inputs, "seed"), true);

  const cases = [
    [{ name: "ok" }, /必须提供 files 或 inputs\+build/u],
    [
      { name: "ok", files: { "a.txt": "a" }, inputs: { a: "x" }, build },
      /不能同时提供/u,
    ],
    [{ name: "ok", files: { "a.txt": "a" }, inputs: { a: "x" } }, /不能同时提供/u],
    [{ name: "ok", files: { "a.txt": "a" }, build }, /不能同时提供/u],
    [{ name: "ok", inputs: {}, build }, /至少需要一个 input/u],
    [{ name: "ok", inputs: null, build }, /缺少 inputs 普通对象/u],
    [{ name: "ok", inputs: [], build }, /缺少 inputs 普通对象/u],
    [{ name: "ok", inputs: { "": "x" }, build }, /input 键必须是非空文本/u],
    [{ name: "ok", inputs: { "  ": "x" }, build }, /input 键必须是非空文本/u],
    [{ name: "ok", inputs: { a: 1 }, build }, /input 值必须是字符串/u],
    [{ name: "ok", inputs: { a: null }, build }, /input 值必须是字符串/u],
    [{ name: "ok", inputs: { a: "x" } }, /inputs 必须与 build/u],
    [{ name: "ok", inputs: { a: "x" }, build: "no" }, /build 必须是函数/u],
    [{ name: "ok", build }, /缺少 inputs/u],
  ];
  for (const [spec, message] of cases) {
    assert.throws(() => normalizeFixtureSpec(spec), message, JSON.stringify(Object.keys(spec)));
  }
});

test("构造形式：空值输入可物化且与非空值规格区分，不发明占位", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-empty-value") });
  t.after(() => parent.close());
  const marker = path.join(scratch, "built-empty-value.jsonl");
  const emptySpec = buildPayloadSpec("built-empty-value", marker, { schema: "s", seed: "" });
  const empty = materializeFixture(emptySpec, { scope: parent });
  const nonEmpty = materializeFixture(
    buildPayloadSpec("built-empty-value", marker, { schema: "s", seed: "two-rows" }),
    { scope: parent },
  );
  assert.notEqual(nonEmpty.dir, empty.dir, "空 seed 与非空 seed 属于不同规格");
  assert.equal(markerEvents(marker).length, 2, "两种规格各真实构建一次");
  assert.equal(fs.readFileSync(empty.files.get("payload.txt"), "utf8"), "\n");
  assert.notEqual(controlRecord(empty).digest, controlRecord(nonEmpty).digest);
  assert.equal(materializeFixture(emptySpec, { scope: parent }).dir, empty.dir);
  assert.equal(markerEvents(marker).length, 2, "空值规格复用时不得重建");
});

test("构造形式：同 run 串行复用同一构建，控制记录不进入工作副本", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-serial") });
  t.after(() => parent.close());
  const marker = path.join(scratch, "built-serial.jsonl");
  const spec = buildPayloadSpec("built-serial", marker);
  const first = materializeFixture(spec, { scope: parent });
  const second = materializeFixture(spec, { scope: parent });

  assert.equal(second.dir, first.dir);
  assert.equal(markerEvents(marker).length, 1, "同 run 同 inputs 只能真实构建一次");
  assert.deepEqual([...first.files.keys()], ["payload.txt"]);
  assert.deepEqual(builtFixtureEntries(first), [".fixture-control.json", "payload.txt"]);
  const record = controlRecord(first);
  assert.equal(record.kind, "ai-novel-test-fixture-payload/v2");
  assert.equal(record.name, spec.name);
  assert.equal(record.form, "built");
  assert.equal(record.files.length, 1);
  assert.equal(record.files[0].path, "payload.txt");
  assert.match(record.files[0].sha256, /^[0-9a-f]{64}$/u);

  const before = fixtureTemplateHash(first);
  const copy = createWorkingCopy(first, { scope: parent, context: t });
  assert.deepEqual([...copy.files.keys()], ["payload.txt"]);
  assert.deepEqual(fs.readdirSync(copy.dir).sort(), ["payload.txt"]);
  fs.writeFileSync(copy.files.get("payload.txt"), "changed\n");
  assert.equal(fixtureTemplateHash(first), before);
  assert.equal(fs.readFileSync(first.files.get("payload.txt"), "utf8"), "two-rows\n");
});

test("构造形式反例：两个真实子进程同 inputs 竞争，builder 只执行一次", async (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-race") });
  t.after(() => parent.close());
  const harness = path.join(scratch, "built-race-harness");
  const barrier = path.join(harness, "barrier");
  fs.mkdirSync(barrier, { recursive: true });
  const buildLog = path.join(harness, "build.jsonl");
  const driver = path.join(harness, "built-race-driver.mjs");
  fs.writeFileSync(
    driver,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      `import { materializeFixture, openTestRunScope } from ${JSON.stringify(TEST_ENV_URL)};`,
      "const scope = openTestRunScope();",
      'fs.writeFileSync(path.join(process.env.FIXTURE_BARRIER, `arrived-${process.pid}`), "x");',
      "const started = Date.now();",
      "while (Date.now() - started < 20000) {",
      '  const arrivals = fs.readdirSync(process.env.FIXTURE_BARRIER).filter((name) => name.startsWith("arrived-")).length;',
      "  if (arrivals >= 2) break;",
      "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);",
      "}",
      "const fixture = materializeFixture({",
      '  name: "built-race",',
      "  inputs: JSON.parse(process.env.FIXTURE_INPUTS),",
      "  build(staging) {",
      '    fs.appendFileSync(process.env.FIXTURE_BUILD_LOG, `${JSON.stringify({ kind: "build", pid: process.pid })}\\n`);',
      '    fs.writeFileSync(path.join(staging, "payload.txt"), "race\\n");',
      '    fs.appendFileSync(process.env.FIXTURE_BUILD_LOG, `${JSON.stringify({ kind: "payload", pid: process.pid })}\\n`);',
      '    return ["payload.txt"];',
      "  },",
      "}, { scope, waitTimeoutMs: 15000 });",
      "scope.close();",
      "console.log(JSON.stringify({ dir: fixture.dir, pid: process.pid }));",
      "",
    ].join("\n"),
  );
  const env = {
    ...parent.env(),
    FIXTURE_BUILD_LOG: buildLog,
    FIXTURE_INPUTS: JSON.stringify({ schema: "provider_runs/v1", seed: "race" }),
    FIXTURE_BARRIER: barrier,
  };
  const [left, right] = await Promise.all([
    runProcess(process.execPath, [driver], { env }),
    runProcess(process.execPath, [driver], { env }),
  ]);
  assert.equal(left.status, 0, left.stderr);
  assert.equal(right.status, 0, right.stderr);
  const reports = [left, right].map((result) => JSON.parse(result.stdout));
  assert.equal(reports[0].dir, reports[1].dir, "两个消费者必须拿到同一发布目录");
  const events = markerEvents(buildLog);
  assert.equal(events.filter((event) => event.kind === "build").length, 1);
  assert.equal(events.filter((event) => event.kind === "payload").length, 1);
  assert.equal(new Set(events.map((event) => event.pid)).size, 1, "payload 只能由一个 owner 构建");
  assert.deepEqual(
    fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith("built-race-")),
    [path.basename(reports[0].dir)],
    "不得残留 staging 等副本",
  );
  const record = JSON.parse(
    fs.readFileSync(path.join(reports[0].dir, ".fixture-control.json"), "utf8"),
  );
  assert.equal(record.files[0].path, "payload.txt");
  assert.deepEqual(
    markerEvents(buildLog).map((event) => event.kind),
    ["build", "payload"],
    "真实 builder/payload 构造计数都必须是 1",
  );
});

test("构造形式：inputs 变化产生新规格且不污染旧模板", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-inputs") });
  t.after(() => parent.close());
  const marker = path.join(scratch, "built-inputs.jsonl");
  const makeSpec = (seed) => ({
    name: "built-inputs",
    inputs: { schema: "provider_runs/v1", seed },
    build(staging) {
      appendBuildMarker(marker);
      fs.writeFileSync(path.join(staging, "payload.txt"), `${seed}\n`);
      return ["payload.txt"];
    },
  });
  const first = materializeFixture(makeSpec("v1"), { scope: parent });
  const second = materializeFixture(makeSpec("v2"), { scope: parent });
  assert.notEqual(second.dir, first.dir);
  assert.equal(markerEvents(marker).length, 2);
  assert.equal(fs.readFileSync(first.files.get("payload.txt"), "utf8"), "v1\n");
  assert.equal(fs.readFileSync(second.files.get("payload.txt"), "utf8"), "v2\n");
  const firstDigest = controlRecord(first).digest;
  const secondDigest = controlRecord(second).digest;
  assert.notEqual(firstDigest, secondDigest);

  const firstAgain = materializeFixture(makeSpec("v1"), { scope: parent });
  assert.equal(firstAgain.dir, first.dir);
  assert.equal(markerEvents(marker).length, 2, "旧 inputs 复用时不得重建");
  assert.equal(controlRecord(first).digest, firstDigest);
});

test("构造形式失败矩阵：异常/空声明/缺输出/多余文件/路径越界/symlink 均不发布", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-failure") });
  t.after(() => parent.close());
  const sentinel = path.join(scratch, "built-sentinel.txt");
  fs.writeFileSync(sentinel, "sentinel\n");
  fs.chmodSync(sentinel, 0o644);
  const sentinelBefore = {
    content: fs.readFileSync(sentinel, "utf8"),
    mode: fs.statSync(sentinel).mode & 0o777,
  };
  const written = (staging, rel, content = "x\n") => {
    fs.mkdirSync(path.dirname(path.join(staging, rel)), { recursive: true });
    fs.writeFileSync(path.join(staging, rel), content);
  };
  const cases = [
    {
      name: "built-throw",
      pattern: /初始化失败|injected builder failure/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        throw new Error("injected builder failure");
      },
    },
    {
      name: "built-empty",
      pattern: /非空/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        return [];
      },
    },
    {
      name: "built-missing",
      pattern: /缺少|不完整/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        written(staging, "present.txt");
        return ["missing.txt"];
      },
    },
    {
      name: "built-extra",
      pattern: /规格外|含规格外文件/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        written(staging, "payload.txt");
        written(staging, "extra.txt");
        return ["payload.txt"];
      },
    },
    {
      // 声明文件在多级目录下时，规格外目录排序在期望目录之后；dirs 长度比较
      // 任一 || 变 && 会把 extra 目录放过去，必须按完整目录集合拒绝。
      name: "built-extra-dir",
      pattern: /规格外目录/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        written(staging, "nested/payload.txt");
        fs.mkdirSync(path.join(staging, "zzz-extra-dir"));
        return ["nested/payload.txt"];
      },
    },
    {
      // 私有控制记录只能由 owner 写；builder 在 staging 伪造同名文件必须按规格外
      // 文件拒绝，不能靠随后 control 记录的 wx 失败来“碰巧”失败。
      name: "built-control-forge",
      pattern: /含规格外文件/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        written(staging, "payload.txt");
        written(staging, ".fixture-control.json", "{}\n");
        return ["payload.txt"];
      },
    },
    {
      name: "built-absolute",
      pattern: /repo 相对 POSIX/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        return ["/tmp/escape.txt"];
      },
    },
    {
      name: "built-traversal",
      pattern: /不得包含/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        return ["../escape.txt"];
      },
    },
    {
      name: "built-symlink",
      pattern: /普通文件|symlink/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        fs.symlinkSync(sentinel, path.join(staging, "link.txt"));
        return ["link.txt"];
      },
    },
    {
      name: "built-symlink-extra",
      pattern: /普通文件|symlink/u,
      build(staging, marker) {
        appendBuildMarker(marker);
        written(staging, "payload.txt");
        fs.symlinkSync(sentinel, path.join(staging, "link.txt"));
        return ["payload.txt"];
      },
    },
  ];
  for (const item of cases) {
    const marker = path.join(scratch, `built-failure-${item.name}.jsonl`);
    const spec = {
      name: item.name,
      inputs: { case: item.name },
      build: (staging) => item.build(staging, marker),
    };
    assert.throws(() => materializeFixture(spec, { scope: parent }), item.pattern, item.name);
    assert.equal(markerEvents(marker).length, 1, `${item.name}: builder 只执行一次`);
    assert.deepEqual(
      fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(`${item.name}-`)),
      [],
      `${item.name}: 失败不得发布半成品`,
    );
    assert.deepEqual(
      fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(".staging-")),
      [],
      `${item.name}: 失败后不得残留 staging`,
    );
    const claims = fs.readdirSync(path.join(parent.fixturesDir, ".claims"));
    assert.ok(
      claims.some((name) => name.startsWith(`${item.name}-`) && name.endsWith(".failed")),
      `${item.name}: 必须留下失败事实`,
    );
    let follower = "";
    try {
      materializeFixture(spec, { scope: parent });
    } catch (error) {
      follower = error.message;
    }
    assert.match(follower, /初始化已失败/u, `${item.name}: 同 run 不得擅自再构造`);
    assert.equal(markerEvents(marker).length, 1, `${item.name}: 等待者不得重建`);
  }
  assert.deepEqual(
    { content: fs.readFileSync(sentinel, "utf8"), mode: fs.statSync(sentinel).mode & 0o777 },
    sentinelBefore,
    "不得对 symlink 指向的借用文件 chmod/改写",
  );
});

test("构造形式失败：primary 不被 staging 清理失败掩盖，正常/单失败/双失败分别可见", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-double-failure") });
  const stagingResidue = () =>
    fs.existsSync(parent.fixturesDir)
      ? fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(".staging-"))
      : [];
  const failedRecordOf = (name) => {
    const claimsDir = path.join(parent.fixturesDir, ".claims");
    const file = fs
      .readdirSync(claimsDir)
      .find((entry) => entry.startsWith(`${name}-`) && entry.endsWith(".failed"));
    assert.ok(file, `${name}: 必须留下 failed 事实`);
    return JSON.parse(fs.readFileSync(path.join(claimsDir, file), "utf8"));
  };
  const caught = (fn) => {
    try {
      fn();
    } catch (error) {
      return error;
    }
    assert.fail("期望初始化失败但成功发布");
  };
  t.after(() => {
    for (const name of stagingResidue()) {
      try {
        fs.chmodSync(path.join(parent.fixturesDir, name), 0o755);
      } catch {
        // 仅用于失败路径清场。
      }
      try {
        fs.rmSync(path.join(parent.fixturesDir, name), { recursive: true, force: true });
      } catch {
        // 仅用于失败路径清场。
      }
    }
  });
  // 先恢复 staging 权限并清场，再释放父 scope；否则 parent.close 可能先撞上 0555
  // 目录而无法回收。该顺序在断言提前抛出时同样成立。
  t.after(() => parent.close());
  const failingSpec = (name, mutate) => ({
    name,
    inputs: { case: name },
    build(staging) {
      fs.writeFileSync(path.join(staging, "partial.txt"), "partial\n");
      mutate?.(staging);
      throw new Error("primary-builder-failure");
    },
  });

  // 正常：成功发布、无 staging 残留。
  const ok = materializeFixture(
    {
      name: "built-cleanup-ok",
      inputs: { case: "ok" },
      build(staging) {
        fs.writeFileSync(path.join(staging, "payload.txt"), "ok\n");
        return ["payload.txt"];
      },
    },
    { scope: parent },
  );
  assert.deepEqual([...ok.files.keys()], ["payload.txt"]);
  assert.deepEqual(stagingResidue(), [], "正常发布后 staging 所有权已随 rename 转移");

  // 单失败：调用者看到 primary；staging 仍被清理；failed 记录准确。
  const single = caught(() => materializeFixture(failingSpec("built-cleanup-single"), { scope: parent }));
  assert.match(single.message, /primary-builder-failure/u);
  assert.doesNotMatch(single.message, /清理失败/u, "单失败不得凭空出现清理失败");
  assert.equal(single instanceof AggregateError, false);
  assert.deepEqual(stagingResidue(), [], "单失败仍必须尝试并完成 owned staging 清理");
  assert.match(failedRecordOf("built-cleanup-single").message, /primary-builder-failure/u);

  // 双失败：staging 清理被真实文件系统拒绝（父目录不可写 → ENOTEMPTY/EACCES），
  // primary 与 cleanup 都必须到达调用者和 failed 事实，不能只留 primary 在文件里。
  const doubleName = "built-cleanup-double";
  try {
    const double = caught(() =>
      materializeFixture(
        failingSpec(doubleName, (staging) => fs.chmodSync(staging, 0o555)),
        { scope: parent },
      ),
    );
    assert.ok(double instanceof AggregateError, "双失败必须同时携带 primary 与 cleanup");
    assert.match(double.message, /primary-builder-failure/u);
    assert.match(double.message, /清理失败|staging/u);
    assert.match(double.errors[0].message, /primary-builder-failure/u);
    assert.ok(
      ["EACCES", "EPERM", "ENOTEMPTY"].includes(double.errors[1].code),
      double.errors[1].message,
    );
    const doubleRecord = failedRecordOf(doubleName);
    assert.match(doubleRecord.message, /primary-builder-failure/u);
    assert.match(doubleRecord.message, /清理失败|staging/u);
    const retained = stagingResidue();
    assert.equal(retained.length, 1, "清理失败时 staging 作为诊断事实保留，不伪装成已清理");
  } finally {
    // 无论断言是否抛出，都先恢复 0555 staging 的权限再删除，避免把只读目录留给
    // 父 scope 回收或污染后续用例。
    for (const name of stagingResidue()) {
      try {
        fs.chmodSync(path.join(parent.fixturesDir, name), 0o755);
      } catch {
        // 仅用于失败路径清场。
      }
      try {
        fs.rmSync(path.join(parent.fixturesDir, name), { recursive: true, force: true });
      } catch {
        // 仅用于失败路径清场。
      }
    }
  }
  assert.deepEqual(stagingResidue(), []);

  // builder 自己删掉 staging 后再失败：清理缺失不是第二个失败，primary 仍必须直出。
  const vanished = caught(() =>
    materializeFixture(
      {
        name: "built-staging-gone",
        inputs: { case: "gone" },
        build(staging) {
          fs.rmSync(staging, { recursive: true, force: true });
          throw new Error("primary-builder-failure");
        },
      },
      { scope: parent },
    ),
  );
  assert.match(vanished.message, /primary-builder-failure/u);
  assert.equal(vanished instanceof AggregateError, false, "staging 已不存在不得伪造清理失败");
  assert.deepEqual(stagingResidue(), []);
});

test("构造形式：owner 发布后退出，另一进程直接复用；缺控制记录不 fallback", async (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-exit") });
  t.after(() => parent.close());
  const marker = path.join(scratch, "built-exit.jsonl");
  const inputs = { schema: "provider_runs/v1", seed: "exit" };
  const driver = path.join(scratch, "built-exit-driver.mjs");
  fs.writeFileSync(
    driver,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      `import { materializeFixture, openTestRunScope } from ${JSON.stringify(TEST_ENV_URL)};`,
      "const scope = openTestRunScope();",
      "const fixture = materializeFixture({",
      '  name: "built-exit",',
      "  inputs: JSON.parse(process.env.FIXTURE_INPUTS),",
      "  build(staging) {",
      '    fs.appendFileSync(process.env.FIXTURE_BUILD_LOG, `${JSON.stringify({ kind: "build", pid: process.pid })}\\n`);',
      '    fs.writeFileSync(path.join(staging, "payload.txt"), "exit\\n");',
      '    return ["payload.txt"];',
      "  },",
      "}, { scope });",
      "scope.close();",
      "console.log(JSON.stringify({ dir: fixture.dir }));",
      "",
    ].join("\n"),
  );
  const child = await runProcess(process.execPath, [driver], {
    env: {
      ...parent.env(),
      FIXTURE_BUILD_LOG: marker,
      FIXTURE_INPUTS: JSON.stringify(inputs),
    },
  });
  assert.equal(child.status, 0, child.stderr);
  const childReport = JSON.parse(child.stdout);
  assert.equal(fs.existsSync(path.join(childReport.dir, ".fixture-control.json")), true);

  const reused = materializeFixture(buildPayloadSpec("built-exit", marker, inputs), { scope: parent });
  assert.equal(reused.dir, childReport.dir, "发布后 owner 退出仍可直接复用");
  assert.equal(markerEvents(marker).length, 1, "复用不得重跑 builder");
  assert.equal(fs.readFileSync(reused.files.get("payload.txt"), "utf8"), "exit\n");

  const control = path.join(reused.dir, ".fixture-control.json");
  const controlBytes = fs.readFileSync(control);
  const controlMode = fs.statSync(control).mode & 0o777;
  fs.chmodSync(control, 0o644);
  try {
    fs.rmSync(control);
    assert.throws(
      () => materializeFixture(buildPayloadSpec("built-exit", marker, inputs), { scope: parent }),
      /控制记录|旧格式|不完整/u,
      "缺控制记录的目标不能被当作可用模板",
    );
  } finally {
    fs.writeFileSync(control, controlBytes);
    fs.chmodSync(control, controlMode);
  }
  assert.equal(markerEvents(marker).length, 1);
});

test("构造形式：builder 取得 staging 与最终发布位置，发布前 target 不存在且最终路径可读", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-publication") });
  t.after(() => parent.close());
  const marker = path.join(scratch, "built-publication.jsonl");
  let observed = null;
  const spec = {
    name: "built-publication",
    inputs: { schema: "publication/v1" },
    build(staging, publicationDir) {
      appendBuildMarker(marker);
      observed = {
        staging,
        publicationDir,
        targetBeforePublish: fs.existsSync(publicationDir),
      };
      // 只把发布后位置序列进 staging 内的 payload；文件仍只在 staging 构造。
      fs.writeFileSync(path.join(staging, "payload.txt"), `${publicationDir}\n`);
      return ["payload.txt"];
    },
  };

  const fixture = materializeFixture(spec, { scope: parent });
  assert.ok(observed, "builder 必须在 owner 内真实执行");
  assert.notEqual(observed.staging, observed.publicationDir, "staging 与最终位置必须是不同路径");
  assert.ok(observed.staging.startsWith(`${parent.fixturesDir}${path.sep}`), observed.staging);
  assert.equal(observed.publicationDir, fixture.dir, "第二个参数就是本次实际发布目标");
  assert.equal(observed.targetBeforePublish, false, "发布前 target 不能被预建");
  assert.equal(
    fs.readFileSync(fixture.files.get("payload.txt"), "utf8"),
    `${fixture.dir}\n`,
    "payload 序列化的是发布后路径，不是临时 staging 路径",
  );
  assert.equal(fs.existsSync(fixture.dir), true, "发布后声明的最终路径可读");
  assert.equal(fs.existsSync(observed.staging), false, "发布后 staging 已整体 rename");

  const reused = materializeFixture(spec, { scope: parent });
  assert.equal(reused.dir, fixture.dir);
  assert.equal(markerEvents(marker).length, 1, "复用不得再次执行 builder");
  assert.equal(fs.readFileSync(reused.files.get("payload.txt"), "utf8"), `${fixture.dir}\n`);
});

test("构造形式复用前校验：字节漂移/额外文件/缺文件/控制记录 digest 均失败", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-drift") });
  t.after(() => parent.close());
  const marker = path.join(scratch, "built-drift.jsonl");
  const spec = buildPayloadSpec("built-drift", marker);
  const fixture = materializeFixture(spec, { scope: parent });
  const payload = fixture.files.get("payload.txt");
  const recordFile = path.join(fixture.dir, ".fixture-control.json");
  const original = fs.readFileSync(payload);
  const originalRecord = fs.readFileSync(recordFile, "utf8");

  const payloadMode = fs.statSync(payload).mode & 0o777;
  const recordMode = fs.statSync(recordFile).mode & 0o777;
  const restorePayload = () => {
    if (fs.existsSync(payload)) fs.chmodSync(payload, 0o644);
    fs.writeFileSync(payload, original);
    fs.chmodSync(payload, payloadMode);
  };
  const restoreRecord = () => {
    fs.chmodSync(recordFile, 0o644);
    fs.writeFileSync(recordFile, originalRecord);
    fs.chmodSync(recordFile, recordMode);
  };

  fs.chmodSync(payload, 0o644);
  try {
    fs.writeFileSync(payload, "tampered\n");
    assert.throws(() => materializeFixture(spec, { scope: parent }), /字节哈希|内容/u);
  } finally {
    restorePayload();
  }

  const extra = path.join(fixture.dir, "extra.txt");
  try {
    fs.writeFileSync(extra, "extra\n");
    assert.throws(() => materializeFixture(spec, { scope: parent }), /规格外|完整文件集合/u);
  } finally {
    fs.rmSync(extra, { force: true });
  }

  try {
    fs.rmSync(payload);
    assert.throws(() => materializeFixture(spec, { scope: parent }), /缺少|不完整/u);
  } finally {
    restorePayload();
  }

  const record = JSON.parse(originalRecord);
  record.digest = "0".repeat(64);
  try {
    fs.chmodSync(recordFile, 0o644);
    fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
    assert.throws(() => materializeFixture(spec, { scope: parent }), /规格 digest|digit|控制记录/u);
  } finally {
    restoreRecord();
  }

  assert.equal(markerEvents(marker).length, 1, "漂移失败不得触发重建或静默修补");
  assert.equal(materializeFixture(spec, { scope: parent }).dir, fixture.dir);
});

test("构造形式控制记录反例：空清单/坏条目/越界路径/坏字节/坏哈希/重复路径均失败", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-built-control") });
  t.after(() => parent.close());
  const marker = path.join(scratch, "built-control.jsonl");
  const spec = buildPayloadSpec("built-control", marker);
  const fixture = materializeFixture(spec, { scope: parent });
  const recordFile = path.join(fixture.dir, ".fixture-control.json");
  const original = fs.readFileSync(recordFile, "utf8");
  const recordMode = fs.statSync(recordFile).mode & 0o777;
  const rewrite = (mutate) => {
    const record = JSON.parse(original);
    mutate(record);
    fs.chmodSync(recordFile, 0o644);
    fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  };
  const cases = [
    [(record) => { record.files = []; }, /非空payload清单/u],
    [(record) => { record.files = ["bad"]; }, /普通对象/u],
    [(record) => { record.name = "other-name"; }, /身份与规格不一致/u],
    [(record) => { record.form = "literal"; }, /身份与规格不一致/u],
    [(record) => { record.files[0].path = "/abs.txt"; }, /repo 相对 POSIX/u],
    [(record) => { record.files[0].path = "../escape.txt"; }, /不得包含/u],
    [(record) => { record.files[0].bytes = -1; }, /字节数非法/u],
    [(record) => { record.files[0].sha256 = "abc"; }, /字节哈希非法/u],
    // 声明事实漂移：类型合法但与真实 payload 不一致，也必须逐项拒绝。
    [(record) => { record.files[0].bytes += 1; }, /字节哈希不一致/u],
    [(record) => { record.files[0].sha256 = "0".repeat(64); }, /字节哈希不一致/u],
    [(record) => { record.files.push({ ...record.files[0] }); }, /重复路径/u],
  ];
  for (const [mutate, pattern] of cases) {
    rewrite(mutate);
    try {
      assert.throws(() => materializeFixture(spec, { scope: parent }), pattern);
    } finally {
      // 断言失败也要把控制记录恢复为原字节与原权限，避免残留被篡改的只读模板。
      fs.chmodSync(recordFile, 0o644);
      fs.writeFileSync(recordFile, original);
      fs.chmodSync(recordFile, recordMode);
    }
  }
  assert.equal(markerEvents(marker).length, 1, "控制记录反例不得触发重建");
  assert.equal(materializeFixture(spec, { scope: parent }).dir, fixture.dir);
});

test("字面fixture允许空文件，控制记录字节数为0", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-empty-file") });
  t.after(() => parent.close());
  const spec = { name: "empty-file-fixture", files: { "empty.txt": "" } };
  const fixture = materializeFixture(spec, { scope: parent });
  assert.equal(fs.readFileSync(fixture.files.get("empty.txt"), "utf8"), "");
  const record = controlRecord(fixture);
  assert.deepEqual(record.files, [
    { path: "empty.txt", bytes: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  ]);
  assert.equal(materializeFixture(spec, { scope: parent }).dir, fixture.dir);
});

test("fixture 调用边界：非法 scope 形状与最小正等待期限", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-scope-shape") });
  t.after(() => parent.close());
  const literal = { name: "scope-shape", files: { "alpha.txt": "alpha\n" } };
  assert.throws(
    () => materializeFixture(literal, { scope: { env() {} } }),
    /需要外层 run scope/u,
  );
  assert.throws(
    () => materializeFixture(literal, { scope: { fixturesDir: "not-a-scope" } }),
    /需要外层 run scope/u,
  );
  const fixture = materializeFixture(
    { name: "one-ms-wait", files: { "alpha.txt": "alpha\n" } },
    { scope: parent, waitTimeoutMs: 1 },
  );
  assert.equal(fs.readFileSync(fixture.files.get("alpha.txt"), "utf8"), "alpha\n");
  for (const waitTimeoutMs of [0, -1, Number.NaN, "10"]) {
    assert.throws(
      () => materializeFixture(literal, { scope: parent, waitTimeoutMs }),
      /waitTimeoutMs 必须是正数/u,
      `非法等待期限必须拒绝: ${waitTimeoutMs}`,
    );
  }
});

test("等待者遇到不可读 claim 仍按有界超时失败，不抛类型错误", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-unreadable-claim") });
  t.after(() => parent.close());
  const marker = path.join(scratch, "unreadable-claim.jsonl");
  const spec = buildPayloadSpec("unreadable-claim", marker);
  const fixture = materializeFixture(spec, { scope: parent });
  const claimsDir = path.join(parent.fixturesDir, ".claims");
  const claimFile = fs
    .readdirSync(claimsDir)
    .find((name) => name.startsWith(`${spec.name}-`) && name.endsWith(".claim"));
  assert.ok(claimFile, "必须先存在归属记录");
  fs.rmSync(fixture.dir, { recursive: true, force: true });
  fs.writeFileSync(path.join(claimsDir, claimFile), "{}\n");
  const started = Date.now();
  assert.throws(
    () => materializeFixture(spec, { scope: parent, waitTimeoutMs: 50 }),
    /等待 fixture 初始化超时/u,
  );
  assert.ok(Date.now() - started < 2000, "不可读 claim 不得无限等待");
  assert.equal(markerEvents(marker).length, 1);
});

test("字面fixture大小写混排路径可跨调用/进程复用", async (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-mixed-case-paths") });
  t.after(() => parent.close());
  const spec = {
    name: "mixed-case-paths",
    files: {
      // leader-review/path-order.json 的原始两文件：READ M E 与 config 的首字符
      // 大小写关系正是 localeCompare 与 code-unit 次序分歧的最小形状。
      "README.md": "# readme\n",
      "config.yml": "key: value\n",
      "Beta.txt": "B\n",
      "alpha.txt": "A\n",
      "nested/Zeta.txt": "Z\n",
    },
  };
  const first = materializeFixture(spec, { scope: parent });
  assert.equal(materializeFixture(spec, { scope: parent }).dir, first.dir);
  const childCode = `
import { materializeFixture, openTestRunScope } from ${JSON.stringify(TEST_ENV_URL)};
const scope = openTestRunScope();
const fixture = materializeFixture(JSON.parse(process.env.MIXED_CASE_SPEC), { scope });
scope.close();
console.log(JSON.stringify({ dir: fixture.dir }));
`;
  const child = await runProcess(process.execPath, ["--input-type=module", "-e", childCode], {
    env: { ...parent.env(), MIXED_CASE_SPEC: JSON.stringify(spec) },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).dir, first.dir, "跨进程必须复用同一发布目录");
  for (const [rel, content] of Object.entries(spec.files)) {
    assert.equal(fs.readFileSync(first.files.get(rel), "utf8"), content);
  }
});

test("字面控制记录必须包含规格的完整文件集合，缺项/多项均拒绝", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-literal-completeness") });
  t.after(() => parent.close());
  const spec = {
    name: "literal-completeness",
    files: { "alpha.txt": "alpha\n", "beta.txt": "beta\n" },
  };
  const fixture = materializeFixture(spec, { scope: parent });
  const recordFile = path.join(fixture.dir, ".fixture-control.json");
  const original = fs.readFileSync(recordFile, "utf8");
  const recordMode = fs.statSync(recordFile).mode & 0o777;
  const rewrite = (mutate) => {
    const record = JSON.parse(original);
    mutate(record);
    fs.chmodSync(recordFile, 0o644);
    fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  };
  const restoreRecord = () => {
    fs.chmodSync(recordFile, 0o644);
    fs.writeFileSync(recordFile, original);
    fs.chmodSync(recordFile, recordMode);
  };
  rewrite((record) => {
    record.files = record.files.filter((entry) => entry.path !== "beta.txt");
  });
  const tampered = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  assert.equal(tampered.digest, JSON.parse(original).digest, "反例保留原 digest");
  assert.deepEqual(tampered.files.map((entry) => entry.path), ["alpha.txt"]);
  // leader-review/literal-completeness.json：同时删掉测试自有目录里的 beta.txt，
  // 独立字面输入仍要求它；期望集合只能来自 normalized.files，不能被 metadata 缩小。
  const betaFile = path.join(fixture.dir, "beta.txt");
  const betaMode = fs.statSync(betaFile).mode & 0o777;
  try {
    fs.chmodSync(betaFile, 0o644);
    fs.rmSync(betaFile);
    assert.throws(
      () => materializeFixture(spec, { scope: parent }),
      /控制记录路径与字面规格不一致/u,
      "控制记录缺项时不得只核对剩余文件就通过",
    );
  } finally {
    fs.writeFileSync(betaFile, "beta\n");
    fs.chmodSync(betaFile, betaMode);
    restoreRecord();
  }
  rewrite((record) => {
    record.files.push({ path: "gamma.txt", bytes: 1, sha256: "0".repeat(64) });
  });
  try {
    assert.throws(
      () => materializeFixture(spec, { scope: parent }),
      /控制记录路径与字面规格不一致/u,
      "控制记录多项时必须拒绝",
    );
  } finally {
    restoreRecord();
  }
  assert.equal(materializeFixture(spec, { scope: parent }).dir, fixture.dir);
});

test("借用 owner 已失联的 scope：fail-closed，不复用死 owner 的 scratch", async () => {
  const dir = path.join(scratch, "dead-owner-scope");
  fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const deadPid = child.pid;
  await new Promise((resolve) => child.on("exit", resolve));
  let dead = false;
  try {
    process.kill(deadPid, 0);
  } catch (error) {
    dead = error?.code === "ESRCH";
  }
  assert.equal(dead, true, "fixture pid 必须已退出");
  fs.writeFileSync(
    path.join(dir, MARKER),
    JSON.stringify({
      kind: "ai-novel-test-run",
      owner: "test-env",
      runId: "dead-owner",
      pid: deadPid,
      createdAt: new Date().toISOString(),
      version: 1,
    }),
  );
  const previous = process.env.NOVEL_TEST_RUN_DIR;
  process.env.NOVEL_TEST_RUN_DIR = dir;
  try {
    assert.throws(() => openTestRunScope(), /owner 已不在|失联/u);
  } finally {
    if (previous === undefined) delete process.env.NOVEL_TEST_RUN_DIR;
    else process.env.NOVEL_TEST_RUN_DIR = previous;
  }
});


const CHILDREN_JOURNAL_FILE = ".novel-test-run-children.jsonl";

// 合成 scope 的登记头：声明“完整登记且无子进程”。空文件/缺失文件不能当同义。
function writeCompleteChildrenJournal(dir) {
  fs.writeFileSync(
    path.join(dir, CHILDREN_JOURNAL_FILE),
    `${JSON.stringify({ kind: "ai-novel-test-run-children", version: 2, at: new Date().toISOString() })}\n`,
  );
}

function ageTree(dir, when = new Date(Date.now() - 120_000)) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.lstatSync(full).isDirectory()) ageTree(full, when);
    fs.utimesSync(full, when, when);
  }
  fs.utimesSync(dir, when, when);
}

test("reap：只归档 owner 失联且过期的 scope，保留 live 与未过期目录", async () => {
  const base = path.join(scratch, "reap-base");
  fs.mkdirSync(base, { recursive: true });
  const writeMarker = (dir, pid) => {
    fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, MARKER),
      JSON.stringify({
        kind: "ai-novel-test-run",
        owner: "test-env",
        runId: path.basename(dir),
        pid,
        createdAt: new Date().toISOString(),
        version: 1,
      }),
    );
    writeCompleteChildrenJournal(dir);
  };
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const deadPid = child.pid;
  await new Promise((resolve) => child.on("exit", resolve));
  const dead = path.join(base, "ai-novel-test-run.dead");
  const liveOld = path.join(base, "ai-novel-test-run.live-old");
  const liveFresh = path.join(base, "ai-novel-test-run.live-fresh");
  for (const [dir, pid] of [
    [dead, deadPid],
    [liveOld, process.pid],
    [liveFresh, process.pid],
  ]) {
    writeMarker(dir, pid);
  }
  ageTree(dead);
  const result = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.deepEqual(result.reaped.map((entry) => entry.dir), [dead]);
  assert.equal(fs.existsSync(dead), false);
  assert.equal(fs.existsSync(liveOld), true, "owner 存活不得归档");
  assert.equal(fs.existsSync(liveFresh), true, "未过期不得归档");
  const orphaned = fs.readdirSync(path.join(base, ".orphaned"));
  assert.equal(orphaned.length, 1);
  assert.equal(fs.existsSync(path.join(base, ".orphaned", orphaned[0], "tmp")), true);
});


test("reap：活动资源未结束时保留现场，结束后才归档", async () => {
  const base = path.join(scratch, "reap-active");
  fs.mkdirSync(base, { recursive: true });
  const writeMarker = (dir, pid) => {
    fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, MARKER),
      JSON.stringify({
        kind: "ai-novel-test-run",
        owner: "test-env",
        runId: path.basename(dir),
        pid,
        createdAt: new Date().toISOString(),
        version: 1,
      }),
    );
    // 登记完整且无子进程：活动迹象检查是登记之外的第二道防线。
    writeCompleteChildrenJournal(dir);
  };
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const deadPid = child.pid;
  await new Promise((resolve) => child.on("exit", resolve));
  const recent = path.join(base, "ai-novel-test-run.recent");
  const opened = path.join(base, "ai-novel-test-run.opened");
  const referenced = path.join(base, "ai-novel-test-run.referenced");
  for (const dir of [recent, opened, referenced]) {
    writeMarker(dir, deadPid);
    ageTree(dir);
  }
  // 近期写入：payload 仍在本 scope 内产生活动文件。
  fs.writeFileSync(path.join(recent, "tmp", "fresh.txt"), "fresh\n");
  // 打开句柄：文件 mtime 保持旧，但仍有进程持有。
  const heldFile = path.join(opened, "tmp", "held.txt");
  fs.writeFileSync(heldFile, "held\n");
  ageTree(opened);
  const holder = spawn(
    process.execPath,
    ["-e", 'require("node:fs").openSync(process.argv[1], "r");setInterval(() => {}, 1000)', heldFile],
    { stdio: "ignore" },
  );
  // 命令行引用：无打开句柄、无近期写入，但进程命令行仍引用本 scope。
  const refChild = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", referenced],
    { stdio: "ignore" },
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  const kept = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.deepEqual(kept.reaped, []);
  const reasons = Object.fromEntries(
    kept.kept.filter((entry) => [recent, opened, referenced].includes(entry.dir)).map((entry) => [
      path.basename(entry.dir),
      entry.reason,
    ]),
  );
  assert.equal(reasons["ai-novel-test-run.recent"], "recent_write");
  assert.equal(reasons["ai-novel-test-run.opened"], "open_handles");
  assert.equal(reasons["ai-novel-test-run.referenced"], "process_reference");
  for (const dir of [recent, opened, referenced]) assert.equal(fs.existsSync(dir), true);
  // 活动资源结束后，归档才允许发生。
  holder.kill("SIGKILL");
  refChild.kill("SIGKILL");
  await Promise.all([
    new Promise((resolve) => holder.on("exit", resolve)),
    new Promise((resolve) => refChild.on("exit", resolve)),
  ]);
  fs.rmSync(path.join(recent, "tmp", "fresh.txt"));
  ageTree(recent);
  ageTree(opened);
  ageTree(referenced);
  const archived = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.equal(archived.reaped.length, 3);
  for (const dir of [recent, opened, referenced]) assert.equal(fs.existsSync(dir), false);
});


test("reap：真实启动链登记下，仅经 env 持有 TMPDIR 的静默 payload 阻止归档", async (t) => {
  const base = path.join(scratch, "reap-real-silent");
  const scope = openTestRunScope({ baseDir: base });
  t.after(() => {
    try {
      scope.close();
    } catch {
      // 已归档或不存在的目录无需处理。
    }
  });
  const pidFile = path.join(scratch, "reap-real-silent.pid");
  const script = path.join(scratch, "reap-real-silent.mjs");
  fs.writeFileSync(
    script,
    [
      'import fs from "node:fs";',
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      "setInterval(() => {}, 1000);",
    ].join("\n"),
  );
  // payload 只通过 owner 传入的 TMPDIR 持有 scope，不写文件/不开句柄/命令行不含 scope 路径。
  const running = runInScope(scope, process.execPath, [script], { stdio: "ignore" });
  let payloadPid = 0;
  t.after(async () => {
    if (payloadPid > 0) {
      try {
        process.kill(payloadPid, "SIGKILL");
      } catch {
        // 已退出即无需处理。
      }
    }
    await running;
  });
  await waitFor(() => fs.existsSync(pidFile), 5000);
  payloadPid = Number(fs.readFileSync(pidFile, "utf8"));
  trackPid(t, payloadPid);
  // 登记必须来自真实 spawnScoped，而不是测试手工写入 journal。
  const journal = fs.readFileSync(path.join(scope.dir, CHILDREN_JOURNAL_FILE), "utf8");
  assert.match(journal, /"kind":"spawn_registered"/u);
  assert.match(journal, new RegExp(`"pid":${payloadPid}`, "u"));
  // 模拟宿主失联：marker 指向已退出进程，目录整体过期。
  const markerPath = path.join(scope.dir, MARKER);
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const deadPid = dead.pid;
  await new Promise((resolve) => dead.on("exit", resolve));
  fs.writeFileSync(markerPath, JSON.stringify({ ...marker, pid: deadPid }));
  ageTree(scope.dir);
  const kept = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.deepEqual(kept.reaped, []);
  const entry = kept.kept.find((item) => item.dir === scope.dir);
  assert.equal(entry?.reason, "live_children");
  assert.equal(entry?.children_state, "complete");
  assert.equal(fs.existsSync(scope.dir), true);
  process.kill(payloadPid, "SIGKILL");
  await running;
  ageTree(scope.dir);
  const archived = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.equal(archived.reaped.length, 1);
  assert.equal(fs.existsSync(scope.dir), false);
});

test("reap：缺失 child journal 的旧 scope 默认保留现场", async () => {
  const base = path.join(scratch, "reap-no-journal");
  fs.mkdirSync(base, { recursive: true });
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const deadPid = child.pid;
  await new Promise((resolve) => child.on("exit", resolve));
  const scope = path.join(base, "ai-novel-test-run.legacy");
  fs.mkdirSync(path.join(scope, "tmp"), { recursive: true });
  fs.writeFileSync(
    path.join(scope, MARKER),
    JSON.stringify({
      kind: "ai-novel-test-run",
      owner: "test-env",
      runId: "legacy",
      pid: deadPid,
      createdAt: new Date().toISOString(),
      version: 1,
    }),
  );
  const old = new Date(Date.now() - 120_000);
  for (const name of fs.readdirSync(scope)) {
    fs.utimesSync(path.join(scope, name), old, old);
  }
  fs.utimesSync(scope, old, old);
  const kept = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.deepEqual(kept.reaped, []);
  assert.equal(kept.kept.find((entry) => entry.dir === scope)?.reason, "children_unverifiable");
  assert.equal(fs.existsSync(scope), true);
});

test("reap：真实启动链登记完整且子进程结束后可归档", async (t) => {
  const base = path.join(scratch, "reap-real-complete");
  const scope = openTestRunScope({ baseDir: base });
  t.after(() => {
    try {
      scope.close();
    } catch {
      // 已归档或不存在的目录无需处理。
    }
  });
  const journalPath = path.join(scope.dir, CHILDREN_JOURNAL_FILE);
  assert.match(fs.readFileSync(journalPath, "utf8"), /"kind":"ai-novel-test-run-children"/u);
  await runInScope(scope, process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const lines = fs
    .readFileSync(journalPath, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines.filter((entry) => entry.kind === "spawn_intent").length, 1);
  assert.equal(lines.filter((entry) => entry.kind === "spawn_registered").length, 1);
  // 模拟宿主失联：marker 指向已退出进程，目录整体过期。
  const markerPath = path.join(scope.dir, MARKER);
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const deadPid = dead.pid;
  await new Promise((resolve) => dead.on("exit", resolve));
  fs.writeFileSync(markerPath, JSON.stringify({ ...marker, pid: deadPid }));
  ageTree(scope.dir);
  const result = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.deepEqual(result.reaped.map((entry) => entry.dir), [scope.dir]);
  assert.equal(fs.existsSync(scope.dir), false);
});

test("spawnScoped：启动意图写入失败时拒绝启动，不留不可核实子进程", async (t) => {
  const base = path.join(scratch, "reap-intent-failure");
  const scope = openTestRunScope({ baseDir: base });
  t.after(() => {
    try {
      scope.close();
    } catch {
      // 已回收即无需处理。
    }
  });
  const journalPath = path.join(scope.dir, CHILDREN_JOURNAL_FILE);
  const startedFlag = path.join(scratch, "reap-intent-failure.started");
  fs.rmSync(startedFlag, { force: true });
  const script = path.join(scratch, "reap-intent-failure.mjs");
  fs.writeFileSync(
    script,
    `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(startedFlag)}, "started");\n`,
  );
  const originalAppend = fs.appendFileSync;
  fs.appendFileSync = (file, data, options) => {
    if (String(file) === journalPath) {
      throw Object.assign(new Error("injected child journal append failure"), { code: "EIO" });
    }
    return originalAppend(file, data, options);
  };
  let result;
  try {
    result = await runInScope(scope, process.execPath, [script], { stdio: "ignore" });
  } finally {
    fs.appendFileSync = originalAppend;
  }
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /无法登记子进程启动意图/u);
  assert.equal(fs.existsSync(startedFlag), false, "意图写入失败不得启动子进程");
  assert.equal(fs.readFileSync(journalPath, "utf8").includes("spawn_intent"), false);
});

test("reap：旧登记后追加失败保留 children_incomplete，显式允许才归档", async (t) => {
  const base = path.join(scratch, "reap-registration-failure");
  const scope = openTestRunScope({ baseDir: base });
  t.after(() => {
    try {
      scope.close();
    } catch {
      // 已归档或不存在的目录无需处理。
    }
  });
  // 先建立一条完整旧登记，再让下一次登记停留在“意图已写、登记失败”。
  await runInScope(scope, process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const journalPath = path.join(scope.dir, CHILDREN_JOURNAL_FILE);
  const pidFile = path.join(scratch, "reap-registration-failure.pid");
  fs.rmSync(pidFile, { force: true });
  const script = path.join(scratch, "reap-registration-failure.mjs");
  fs.writeFileSync(
    script,
    [
      'import fs from "node:fs";',
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      "setInterval(() => {}, 1000);",
    ].join("\n"),
  );
  const originalAppend = fs.appendFileSync;
  let journalAppends = 0;
  fs.appendFileSync = (file, data, options) => {
    if (String(file) === journalPath) {
      journalAppends += 1;
      // 意图放行、登记失败：子进程已启动但身份未落盘。
      if (journalAppends === 2) {
        throw Object.assign(new Error("injected child journal append failure"), { code: "EIO" });
      }
    }
    return originalAppend(file, data, options);
  };
  let running;
  try {
    running = runInScope(scope, process.execPath, [script], { stdio: "ignore" });
    await waitFor(() => fs.existsSync(pidFile), 5000);
  } finally {
    fs.appendFileSync = originalAppend;
  }
  const payloadPid = Number(fs.readFileSync(pidFile, "utf8"));
  trackPid(t, payloadPid);
  t.after(async () => {
    try {
      process.kill(payloadPid, "SIGKILL");
    } catch {
      // 已退出即无需处理。
    }
    await running;
  });
  const records = fs
    .readFileSync(journalPath, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.filter((entry) => entry.kind === "spawn_intent").length, 2);
  assert.equal(records.filter((entry) => entry.kind === "spawn_registered").length, 1, "第二次登记必须失败");
  // 模拟宿主失联：marker 指向已退出进程，目录整体过期。
  const markerPath = path.join(scope.dir, MARKER);
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const deadPid = dead.pid;
  await new Promise((resolve) => dead.on("exit", resolve));
  fs.writeFileSync(markerPath, JSON.stringify({ ...marker, pid: deadPid }));
  ageTree(scope.dir);
  const kept = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  const entry = kept.kept.find((item) => item.dir === scope.dir);
  assert.deepEqual(kept.reaped, []);
  assert.equal(entry?.reason, "children_incomplete");
  assert.equal(entry?.children_state, "incomplete");
  assert.equal(entry?.open_intents?.length, 1);
  // 子进程结束后仍不能自动归档：未登记身份无法证明归属。
  process.kill(payloadPid, "SIGKILL");
  await running;
  ageTree(scope.dir);
  const again = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.deepEqual(again.reaped, []);
  assert.equal(fs.existsSync(scope.dir), true);
  // 显式人工允许时才归档现场。
  const forced = reapOrphanScopes({
    baseDir: base,
    olderThanMs: 60_000,
    allowUnverifiedChildren: true,
  });
  assert.deepEqual(forced.reaped.map((item) => item.dir), [scope.dir]);
});

test("reap：启动失败闭合意图后仍可归档，不把未启动当成未登记", async (t) => {
  const base = path.join(scratch, "reap-spawn-failure");
  const scope = openTestRunScope({ baseDir: base });
  t.after(() => {
    try {
      scope.close();
    } catch {
      // 已归档或不存在的目录无需处理。
    }
  });
  const journalPath = path.join(scope.dir, CHILDREN_JOURNAL_FILE);
  const result = await runInScope(
    scope,
    path.join(scratch, "definitely-missing-binary"),
    [],
    { stdio: "ignore" },
  );
  assert.equal(result.exitCode, 1);
  const records = fs
    .readFileSync(journalPath, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.filter((entry) => entry.kind === "spawn_intent").length, 1);
  assert.equal(records.filter((entry) => entry.kind === "spawn_failed").length, 1);
  assert.equal(records.filter((entry) => entry.kind === "spawn_registered").length, 0);
  // 启动失败没有留下子进程，闭合意图后登记仍完整，可以归档。
  const markerPath = path.join(scope.dir, MARKER);
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const deadPid = dead.pid;
  await new Promise((resolve) => dead.on("exit", resolve));
  fs.writeFileSync(markerPath, JSON.stringify({ ...marker, pid: deadPid }));
  ageTree(scope.dir);
  const resultAfter = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.deepEqual(resultAfter.reaped.map((entry) => entry.dir), [scope.dir]);
});

test("reap：空/损坏/旧格式/未闭合/未配对登记都不自动归档", async () => {
  const base = path.join(scratch, "reap-unverifiable-states");
  fs.mkdirSync(base, { recursive: true });
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const deadPid = dead.pid;
  await new Promise((resolve) => dead.on("exit", resolve));
  const header = `${JSON.stringify({
    kind: "ai-novel-test-run-children",
    version: 2,
    at: new Date().toISOString(),
  })}\n`;
  const entries = {
    "ai-novel-test-run.empty": "",
    "ai-novel-test-run.corrupt-tail": `${header}{"kind":"spawn_intent","id":"half`,
    "ai-novel-test-run.identity-missing":
      `${header}${JSON.stringify({ kind: "spawn_intent", id: "a" })}\n` +
      `${JSON.stringify({ kind: "spawn_registered", id: "a", started_at: new Date().toISOString() })}\n`,
    "ai-novel-test-run.unpaired": `${header}${JSON.stringify({
      kind: "spawn_registered",
      id: "x",
      pid: deadPid,
      pgid: null,
      started_at: new Date().toISOString(),
    })}\n`,
    "ai-novel-test-run.incomplete": `${header}${JSON.stringify({
      kind: "spawn_intent",
      id: "open",
      at: new Date().toISOString(),
    })}\n`,
    "ai-novel-test-run.legacy": `${JSON.stringify({
      pid: deadPid,
      pgid: null,
      started_at: new Date().toISOString(),
    })}\n`,
  };
  for (const [name, journal] of Object.entries(entries)) {
    const dir = path.join(base, name);
    fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, MARKER),
      JSON.stringify({
        kind: "ai-novel-test-run",
        owner: "test-env",
        runId: name,
        pid: deadPid,
        createdAt: new Date().toISOString(),
        version: 1,
      }),
    );
    fs.writeFileSync(path.join(dir, CHILDREN_JOURNAL_FILE), journal);
    ageTree(dir);
  }
  const result = reapOrphanScopes({ baseDir: base, olderThanMs: 60_000 });
  assert.deepEqual(result.reaped, []);
  const byName = Object.fromEntries(
    result.kept.map((entry) => [path.basename(entry.dir), entry]),
  );
  assert.equal(byName["ai-novel-test-run.empty"]?.reason, "children_unverifiable");
  assert.equal(byName["ai-novel-test-run.empty"]?.children_state, "empty");
  assert.equal(byName["ai-novel-test-run.corrupt-tail"]?.reason, "children_corrupt");
  assert.equal(byName["ai-novel-test-run.corrupt-tail"]?.detail, "unterminated_line");
  assert.equal(byName["ai-novel-test-run.identity-missing"]?.reason, "children_corrupt");
  assert.equal(
    byName["ai-novel-test-run.identity-missing"]?.detail,
    "registered_identity_missing",
  );
  assert.equal(byName["ai-novel-test-run.unpaired"]?.reason, "children_corrupt");
  assert.equal(byName["ai-novel-test-run.unpaired"]?.detail, "unpaired_registration");
  assert.equal(byName["ai-novel-test-run.incomplete"]?.reason, "children_incomplete");
  assert.equal(byName["ai-novel-test-run.incomplete"]?.children_state, "incomplete");
  assert.equal(byName["ai-novel-test-run.legacy"]?.reason, "children_legacy");
  assert.equal(byName["ai-novel-test-run.legacy"]?.children_state, "legacy");
  for (const name of Object.keys(entries)) {
    assert.equal(fs.existsSync(path.join(base, name)), true);
  }
  // 显式人工允许时仍可归档这些现场。
  const forced = reapOrphanScopes({
    baseDir: base,
    olderThanMs: 60_000,
    allowUnverifiedChildren: true,
  });
  assert.equal(forced.reaped.length, Object.keys(entries).length);
});
