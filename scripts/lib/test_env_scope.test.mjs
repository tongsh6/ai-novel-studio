// scripts/lib/test_env.mjs 的 Node 运行作用域行为测试（与 test_env.test.mjs 的 Shell 前置回归分开）。
//
// 覆盖：owned scratch 与进程局部 TMPDIR、嵌套借用不删父 scope、成功/断言失败/
// 初始化失败、取消(SIGTERM)/超时、子进程被杀后的 parent 收口、受控 env 所有权、
// 正常/失败/取消时后台孙进程的进程组收口、嵌套借用不清理父组且由外层 owner 收口、
// 只读 fixture 同 run 单次物化与并发复用、两真实子进程竞争的 payload 写入计数、
// 初始化失败/owner 被杀/等待超时的明确失败、必要工作副本隔离。全部使用真实
// CLI/子进程与本文件专属 scratch，不用打印的 PASS 自证。

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
  runInScope,
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

test("取消(SIGTERM)：父 owner 停止本 run 子进程树、退出 143、scratch 回收", async () => {
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
      "  if (target.includes(MARK) && !target.includes(CLAIMS)) {",
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

test("owner 发布后、写 ready 前退出的崩溃窗口：完整目标可直接复用，不重建", (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-crash-window") });
  t.after(() => parent.close());
  const spec = { name: "crash-window-fixture", files: { "alpha.txt": "alpha\n" } };
  const first = materializeFixture(spec, { scope: parent });
  const claimsDir = path.join(parent.fixturesDir, ".claims");
  for (const name of fs.readdirSync(claimsDir)) {
    if (name.endsWith(".ready")) fs.rmSync(path.join(claimsDir, name));
  }
  const reused = materializeFixture(spec, { scope: parent });
  assert.equal(reused.dir, first.dir);
  assert.equal(fs.readFileSync(reused.files.get("alpha.txt"), "utf8"), "alpha\n");
  assert.deepEqual(
    fs.readdirSync(parent.fixturesDir).filter((name) => name.startsWith(spec.name)),
    [path.basename(first.dir)],
  );
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
  assert.ok(records.some((name) => name.endsWith(".ready")), "必须留下完成事实");
  recordEvidence("fixture-race", {
    spec,
    child_exit: { left: left.status, right: right.status },
    consumers: [leftReport, rightReport],
    payload_dirs: payloadDirs,
    records,
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
  if (started.child.exitCode === null && started.child.signalCode === null) {
    started.child.kill("SIGKILL");
  }
  await started.done;
}

function claimRecords(parent) {
  const claimsDir = path.join(parent.fixturesDir, ".claims");
  if (!fs.existsSync(claimsDir)) return [];
  return fs.readdirSync(claimsDir).filter((name) => name.endsWith(".claim"));
}

test("fixture owner 被杀：等待者明确基础设施失败，不重建不无限等待", async (t) => {
  const parent = openTestRunScope({ baseDir: path.join(scratch, "base-fixture-dead-owner") });
  t.after(() => parent.close());
  const spec = { name: "dead-owner-fixture", files: { "alpha.txt": "alpha\n" } };
  const { started, markerDir } = startStalledOwner(
    parent,
    spec,
    path.join(scratch, "dead-owner-harness"),
  );
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
  t.after(() => parent.close());
  const spec = { name: "stuck-owner-fixture", files: { "alpha.txt": "alpha\n" } };
  const { started, markerDir } = startStalledOwner(
    parent,
    spec,
    path.join(scratch, "timeout-harness"),
  );
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
  fs.chmodSync(alpha, 0o644);
  fs.writeFileSync(alpha, "tampered\n");
  removeReady();
  assert.throws(() => materializeFixture(spec, { scope: parent }), /内容与规格不一致/u);

  fs.writeFileSync(alpha, "alpha\n");
  fs.writeFileSync(path.join(fixture.dir, "extra.txt"), "extra\n");
  assert.throws(() => materializeFixture(spec, { scope: parent }), /含规格外文件/u);
  fs.rmSync(path.join(fixture.dir, "extra.txt"));

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
});
