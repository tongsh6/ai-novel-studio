// 测试/验收入口统一运行时作用域的 Node 侧薄适配（与 test_env.sh 同一契约）。
//
// 只负责三件事：
//   1. 一次外层 run 拥有 scratch：创建或借用已有运行目录，给子进程传
//      NOVEL_TEST_RUN_DIR 与进程局部 TMPDIR/TMP/TEMP（不改全局）；
//   2. 只读文件 fixture：规格是「相对路径 + 内容」的普通 JS 数据，同一 run 内
//      按内容指纹由唯一 owner 构建并发布一次，其余消费者等待其完整结果；
//      模板只读，需要写入的 case 另取隔离工作副本；
//   3. 结束收口：先等/停止本 run 拥有的子进程，再归档简明结果、回收 owned scratch。
//
// 它不是测试发现器、断言库、fixture DSL 或服务/数据库管理器；不建库、不启动
// 服务、不扫描全仓。嵌套入口（已有合法 NOVEL_TEST_RUN_DIR）只借用，不重复
// 创建也不删除父 scope。
//
// 用法（由 test_env.sh 的 novel_node_test_scope 委托）：
//   node scripts/lib/test_env.mjs run [--timeout-ms N] [--archive DIR] [--base DIR] -- CMD [ARGS...]

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const RUN_DIR_ENV = "NOVEL_TEST_RUN_DIR";
export const RUN_BASE_ENV = "NOVEL_TEST_RUN_BASE";
export const RUN_MARKER = ".novel-test-run-owner.json";

const RUN_KIND = "ai-novel-test-run";
const RUN_DIR_PREFIX = "ai-novel-test-run.";
const PROCESS_TREE = path.join(HERE, "process_tree.sh");
const FIXTURE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/u;

// 运行作用域错误类型由本 owner 保留为标准 Error 子类；名称/消息/instanceof 契约稳定。
export class TestEnvError extends Error {
  constructor(message) {
    super(message);
    this.name = "TestEnvError";
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function markerKindMatches(marker) {
  return Boolean(marker) && marker.kind === RUN_KIND;
}

function parseJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function validRunMarker(marker) {
  return markerKindMatches(marker) ? marker : null;
}

function readRunMarker(dir) {
  const markerPath = path.join(dir, RUN_MARKER);
  return fs.existsSync(markerPath) ? validRunMarker(parseJsonFile(markerPath)) : null;
}

function archiveCandidate(options) {
  return options.archiveDir ? options.archiveDir : process.env.NOVEL_TEST_RUN_ARCHIVE;
}

function resolveArchiveDir(options) {
  const raw = archiveCandidate(options);
  return nonEmptyString(raw) ? path.resolve(raw) : "";
}

// 只生成子进程环境，不改本进程或系统全局变量。
function scopeEnv(scope, extra = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = String(value);
  }
  // 作用域身份与 scratch 路径由 owner 最终派生：普通 extra 可补其他变量，
  // 但不能覆盖或删除 RUN_DIR/TMPDIR/TMP/TEMP（完整转发 process.env 是正常用法）。
  env[RUN_DIR_ENV] = scope.dir;
  env.TMPDIR = scope.tmpDir;
  env.TMP = scope.tmpDir;
  env.TEMP = scope.tmpDir;
  // owned archive 同样由 owner 派生；借用 scope 不携带归档位置，
  // 避免嵌套入口把结果写到父 run 之外。
  if (scope.archiveDir) env.NOVEL_TEST_RUN_ARCHIVE = scope.archiveDir;
  else delete env.NOVEL_TEST_RUN_ARCHIVE;
  return env;
}

// 归档简明结果（命令、退出码/信号、耗时、cleanup 事实）；归档目录是借用证据位置，不属于 scratch。
function writeArchive(scope, state, summary) {
  if (!scope.archiveDir) return null;
  fs.mkdirSync(scope.archiveDir, { recursive: true });
  state.archiveSequence += 1;
  const file = path.join(
    scope.archiveDir,
    `${scope.runId}-${process.pid}-${state.archiveSequence}.json`,
  );
  const payload = {
    kind: "ai-novel-test-run-result/v1",
    run_id: scope.runId,
    scope: { dir: scope.dir, borrowed: scope.borrowed, owned: scope.owned },
    ...summary,
    archived_at: new Date().toISOString(),
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

// 公共 close：借用永不删除；owned 清理失败抛异常（不再返回软错误）。
// 成功 close 幂等：首次关闭的事实被固定，重复调用不再次删除目录。
function closeScope(scope, state) {
  if (state.closed) return state.closeResult;
  if (scope.borrowed) {
    state.closed = true;
    state.closeResult = { dir: scope.dir, borrowed: true, removed: false };
    return state.closeResult;
  }
  fs.rmSync(scope.dir, { recursive: true, force: true });
  if (fs.existsSync(scope.dir)) {
    throw new TestEnvError(`owned scratch 回收后仍然存在: ${scope.dir}`);
  }
  state.closed = true;
  state.closeResult = { dir: scope.dir, borrowed: false, removed: true };
  return state.closeResult;
}

function makeScope({ dir, marker, borrowed, archiveDir }) {
  const state = { closed: false, archiveSequence: 0 };
  const scope = {
    dir,
    runId: marker.runId,
    borrowed,
    owned: !borrowed,
    tmpDir: path.join(dir, "tmp"),
    fixturesDir: path.join(dir, "fixtures"),
    workDir: path.join(dir, "work"),
    archiveDir: borrowed ? "" : archiveDir,
  };
  scope.env = (extra) => scopeEnv(scope, extra);
  scope.archiveResult = (summary) => writeArchive(scope, state, summary);
  scope.close = () => closeScope(scope, state);
  return scope;
}

function borrowRunScope(borrowedDir) {
  const dir = path.resolve(borrowedDir);
  const marker = readRunMarker(dir);
  if (!marker) {
    throw new TestEnvError(`借用运行作用域缺少合法 ${RUN_MARKER}: ${dir}`);
  }
  const tmpDir = path.join(dir, "tmp");
  if (!fs.existsSync(tmpDir) || !fs.statSync(tmpDir).isDirectory()) {
    throw new TestEnvError(`借用运行作用域缺少 tmp 目录: ${dir}`);
  }
  return makeScope({ dir, marker, borrowed: true, archiveDir: "" });
}

function baseCandidate(options) {
  if (nonEmptyString(options.baseDir)) return options.baseDir;
  return process.env[RUN_BASE_ENV];
}

function resolveRunBase(options) {
  const raw = baseCandidate(options);
  return nonEmptyString(raw) ? path.resolve(raw) : os.tmpdir();
}

function createRunScope(baseDir, archiveDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(baseDir, RUN_DIR_PREFIX));
  const marker = {
    kind: RUN_KIND,
    owner: "test-env",
    runId: crypto.randomBytes(8).toString("hex"),
    pid: process.pid,
    createdAt: new Date().toISOString(),
    version: 1,
  };
  try {
    fs.mkdirSync(path.join(dir, "tmp"));
    fs.mkdirSync(path.join(dir, "fixtures"));
    fs.mkdirSync(path.join(dir, "work"));
    fs.writeFileSync(path.join(dir, RUN_MARKER), `${JSON.stringify(marker, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return makeScope({ dir, marker, borrowed: false, archiveDir });
}

/**
 * 创建（owned）或借用（borrowed）一次测试运行作用域。
 *
 * - 环境已有合法 NOVEL_TEST_RUN_DIR：借用父 scope，不创建/不删除；
 * - 否则在 baseDir 下创建独立 scratch；baseDir 仅供测试/受限环境指定，
 *   默认系统临时目录，且仍由本 run 回收。
 *
 * @param {{baseDir?: string, archiveDir?: string}} [options]
 */
export function openTestRunScope(options = {}) {
  const borrowedDir = (process.env[RUN_DIR_ENV] ?? "").trim();
  if (borrowedDir) return borrowRunScope(borrowedDir);
  return createRunScope(resolveRunBase(options), resolveArchiveDir(options));
}

function signalExitCode(signal) {
  const number = os.constants.signals[signal];
  return typeof number === "number" ? 128 + number : 1;
}

function processTreeFailure(result) {
  if (result.error) return result.error.message;
  return result.status === 0 ? "" : `process_tree status=${result.status}`;
}

// 复用既有 process_tree.sh：只按本 run 子进程身份回收其子孙/进程组，不按全局名字 pkill。
// 检查 spawnSync 的 status/error（不能只 try/catch：非零状态和超时会作为返回值）；
// groupCheck 时进一步确认 detached 子进程组已经消失，失败如实返回事实。
function finalizeProcessTree(pid, { groupCheck }) {
  const script = [
    'source "$1" || exit 90',
    'kill_process_tree "$2" 3 || exit 91',
    'if [[ -n "$3" ]]; then',
    "  i=0",
    '  while kill -0 -- "-$3" 2>/dev/null; do',
    "    i=$((i+1))",
    '    if [[ "$i" -ge 20 ]]; then exit 2; fi',
    "    sleep 0.1",
    "  done",
    "fi",
    "exit 0",
  ].join("\n");
  const result = spawnSync(
    "/bin/bash",
    ["-c", script, "test-env", PROCESS_TREE, String(pid), groupCheck ? String(pid) : ""],
    { stdio: "ignore", timeout: 30000 },
  );
  const failure = processTreeFailure(result);
  return {
    attempted: true,
    ok: failure === "",
    group_checked: groupCheck,
    status: result.status,
    signal: result.signal,
    error: failure || undefined,
  };
}

/**
 * 在作用域内运行一个子进程；结束前等待其退出，SIGINT/SIGTERM/超时只回收本进程树。
 *
 * @returns {Promise<{command: string, args: string[], exitCode: number, child_exit_code?: number|null,
 *   timed_out: boolean, stopped_by?: string, signal?: string|null, tree_owner: string,
 *   tree_finalized?: boolean, tree_error?: string, duration_ms: number, stdout?: string,
 *   stderr?: string}>}
 */
function spawnScoped(scope, command, args, options, stdio) {
  return spawn(command, args, {
    cwd: options.cwd,
    env: scope.env(options.env),
    stdio,
    // 只有 scope owner 建立可收口的独立进程组；嵌套借用入口保持在外层组内，
    // 由外层 owner 统一收口，避免创建父级无法回收的脱离组。
    detached: process.platform !== "win32" && !scope.borrowed,
  });
}

function unsupportedOwnedTree() {
  return {
    attempted: false,
    ok: false,
    group_checked: false,
    unsupported: true,
    owner: "this-run",
    finalized: false,
    error: "win32 进程树收口未实现（本批显式不支持，不按成功处理）",
  };
}

function finalizeOwnedTree(scope, pid) {
  // parent-scope 借用由真正的外层 owner 统一收口，与“平台未实现”不是同一事实。
  if (scope.borrowed) {
    return { attempted: false, ok: true, group_checked: false, owner: "parent-scope" };
  }
  if (process.platform === "win32") return unsupportedOwnedTree();
  const tree = finalizeProcessTree(pid, { groupCheck: true });
  return { ...tree, owner: "this-run", finalized: tree.ok };
}

// 有效退出码只从既有结果事实派生：超时优先 124，其次第一次取消信号，
// 最后才是子进程退出/信号；不保存第二份可变 stopCode。
function effectiveExitCode({ timedOut, stoppedBy, code, signal }) {
  if (timedOut) return 124;
  if (stoppedBy) return signalExitCode(stoppedBy);
  return code ?? signalExitCode(signal);
}

// 进程结果 + 进程树事实 → 单一 summary；归档/输出/返回都用这一份。
function treeFailureNotice(facts) {
  if (facts.stopError) return facts.stopError;
  return facts.tree.ok ? "" : facts.tree.error;
}

function completionSummary(facts) {
  const treeError = treeFailureNotice(facts);
  const effective = effectiveExitCode(facts);
  const summary = {
    // 树失败时 0 退出不能当成功；非零原始退出码保持不变。
    exitCode: Math.max(effective, treeError ? 1 : 0),
    child_exit_code: facts.code,
    signal: facts.signal,
    timed_out: facts.timedOut,
    stopped_by: facts.stoppedBy,
    tree_owner: facts.tree.owner,
    tree_finalized: facts.tree.finalized,
  };
  if (treeError) summary.tree_error = treeError;
  return summary;
}

function makeRunState({ scope, command, args, startedAt, startedMs, capture, timeoutMs }) {
  return {
    scope,
    command,
    args,
    startedAt,
    startedMs,
    capture,
    timeoutMs,
    stdout: "",
    stderr: "",
    timedOut: false,
    stoppedBy: undefined,
    treeError: "",
    treeFacts: null,
    exitInfo: null,
    settled: false,
    timer: null,
    drainTimer: null,
    cleanup: () => {},
  };
}

function captureOutput(child, state) {
  if (!state.capture) return;
  child.stdout?.on("data", (chunk) => {
    state.stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    state.stderr += chunk;
  });
}

function stopForSignal(child, state, signal) {
  state.stoppedBy = state.stoppedBy || signal;
  const tree = finalizeProcessTree(child.pid, { groupCheck: false });
  if (!tree.ok) state.treeError = tree.error || `process_tree status=${tree.status}`;
}

function registerStopSignals(child, state, stop) {
  const handlers = {
    onSigint: () => stop("SIGINT"),
    onSigterm: () => stop("SIGTERM"),
  };
  process.on("SIGINT", handlers.onSigint);
  process.on("SIGTERM", handlers.onSigterm);
  return handlers;
}

function scheduleTimeout(state, stop) {
  if (!(Number.isFinite(state.timeoutMs) && state.timeoutMs > 0)) return;
  state.timer = setTimeout(() => {
    state.timedOut = true;
    stop("SIGKILL");
  }, state.timeoutMs);
}

function cleanupStopHandlers(state, handlers) {
  if (state.timer) clearTimeout(state.timer);
  if (state.drainTimer) clearTimeout(state.drainTimer);
  process.removeListener("SIGINT", handlers.onSigint);
  process.removeListener("SIGTERM", handlers.onSigterm);
}

function installStopHandlers(child, state) {
  const stop = (signal) => stopForSignal(child, state, signal);
  const handlers = registerStopSignals(child, state, stop);
  scheduleTimeout(state, stop);
  return () => cleanupStopHandlers(state, handlers);
}

function finishRun(state, resolve, extra) {
  if (state.settled) return;
  state.settled = true;
  state.cleanup();
  const summary = {
    command: state.command,
    args: state.args,
    started_at: state.startedAt,
    duration_ms: Date.now() - state.startedMs,
    ...extra,
  };
  if (state.capture) {
    summary.stdout = state.stdout;
    summary.stderr = state.stderr;
  }
  resolve(summary);
}

function finalizeOnce(state) {
  if (!state.treeFacts) {
    // spawn 失败时没有可收口的子进程身份；这不是“已收口”，只是无可收口对象。
    state.treeFacts = state.childPid
      ? finalizeOwnedTree(state.scope, state.childPid)
      : {
          attempted: false,
          ok: true,
          group_checked: false,
          skipped: "no-child-pid",
          owner: "this-run",
          finalized: true,
        };
  }
  return state.treeFacts;
}

function completeRun(state, resolve, code, signal) {
  const tree = finalizeOnce(state);
  finishRun(
    state,
    resolve,
    completionSummary({
      code,
      signal,
      timedOut: state.timedOut,
      stoppedBy: state.stoppedBy,
      stopError: state.treeError,
      tree,
    }),
  );
}

function spawnFailureResult(state, error) {
  return {
    command: state.command,
    args: state.args,
    started_at: state.startedAt,
    duration_ms: Date.now() - state.startedMs,
    exitCode: 1,
    timed_out: false,
    error: error.message,
  };
}

function wireChild(child, state, resolve) {
  child.on("error", (error) => {
    finishRun(state, resolve, {
      exitCode: 1,
      timed_out: state.timedOut,
      error: error.message,
    });
  });
  // 顶层进程一退出就收口进程组：后台孙进程可能继承 stdio 管道，
  // 若只等 close 会被外部进程拖住。收口后最多再等 500ms 让管道排空。
  child.on("exit", (code, signal) => {
    state.exitInfo = { code, signal };
    finalizeOnce(state);
    state.drainTimer = setTimeout(() => completeRun(state, resolve, code, signal), 500);
    state.drainTimer.unref?.();
  });
  child.on("close", (code, signal) => {
    if (state.drainTimer) {
      clearTimeout(state.drainTimer);
      state.drainTimer = null;
    }
    const info = state.exitInfo ?? { code, signal };
    completeRun(state, resolve, info.code, info.signal);
  });
}

export function runInScope(scope, command, args = [], options = {}) {
  const stdio = options.stdio ?? "inherit";
  const capture = Array.isArray(stdio) && stdio[1] === "pipe";
  const state = makeRunState({
    scope,
    command,
    args,
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
    capture,
    timeoutMs: options.timeoutMs,
  });

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnScoped(scope, command, args, options, stdio);
    } catch (error) {
      resolve(spawnFailureResult(state, error));
      return;
    }
    state.childPid = child.pid;
    captureOutput(child, state);
    state.cleanup = installStopHandlers(child, state);
    wireChild(child, state, resolve);
  });
}

// 发布事实控制记录是与 payload 同目录封存的私有文件名；不进入文件 Map/工作副本。
const FIXTURE_CONTROL_FILE = ".fixture-control.json";

function assertFixtureName(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TestEnvError("fixture 规格必须是普通对象");
  }
  if (!nonEmptyString(spec.name) || !FIXTURE_NAME_RE.test(spec.name)) {
    throw new TestEnvError(`fixture name 必须是小写 kebab-case: ${JSON.stringify(spec.name)}`);
  }
}

function assertFixtureFormExclusive(hasFiles, hasInputs, hasBuild) {
  if (hasFiles && (hasInputs || hasBuild)) {
    throw new TestEnvError("fixture 规格不能同时提供 files 与 inputs/build");
  }
}

function assertFixtureBuildPair(hasInputs, hasBuild) {
  if (hasInputs && !hasBuild) {
    throw new TestEnvError("fixture inputs 必须与 build 一起提供");
  }
  if (hasBuild && !hasInputs) {
    throw new TestEnvError("fixture 构造形式缺少 inputs");
  }
}

function assertFixtureFormPresent(hasFiles, hasBuild) {
  if (!hasFiles && !hasBuild) {
    throw new TestEnvError("fixture 规格必须提供 files 或 inputs+build");
  }
}

function assertFixtureShape(spec) {
  assertFixtureName(spec);
  const hasFiles = spec.files !== undefined;
  const hasInputs = spec.inputs !== undefined;
  const hasBuild = spec.build !== undefined;
  assertFixtureFormExclusive(hasFiles, hasInputs, hasBuild);
  assertFixtureBuildPair(hasInputs, hasBuild);
  assertFixtureFormPresent(hasFiles, hasBuild);
  return hasFiles ? "literal" : "built";
}

function normalizeFixturePath(rel) {
  if (!nonEmptyString(rel) || path.isAbsolute(rel) || rel.includes("\\")) {
    throw new TestEnvError(`fixture 路径必须是 repo 相对 POSIX 路径: ${JSON.stringify(rel)}`);
  }
  const parts = rel.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new TestEnvError(`fixture 路径不得包含空段/./..: ${rel}`);
  }
  if (rel === FIXTURE_CONTROL_FILE) {
    throw new TestEnvError(`fixture 路径不得占用私有控制记录: ${rel}`);
  }
  return rel;
}

function normalizeFixtureFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new TestEnvError("fixture 规格缺少 files 普通对象");
  }
  const normalized = {};
  for (const rel of Object.keys(files).sort()) {
    const content = files[rel];
    if (typeof content !== "string") {
      throw new TestEnvError(`fixture 内容必须是字符串: ${rel}`);
    }
    normalized[normalizeFixturePath(rel)] = content;
  }
  if (Object.keys(normalized).length === 0) {
    throw new TestEnvError("fixture 至少需要一个文件");
  }
  return normalized;
}

function normalizeFixtureInputs(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new TestEnvError("fixture 构造形式缺少 inputs 普通对象");
  }
  const keys = Object.keys(inputs).sort();
  if (keys.length === 0) {
    throw new TestEnvError("fixture inputs 至少需要一个 input");
  }
  const normalized = {};
  for (const key of keys) {
    const value = inputs[key];
    if (!nonEmptyString(key)) {
      throw new TestEnvError(`fixture input 键必须是非空文本: ${JSON.stringify(key)}`);
    }
    // 空字符串是合法输入值（空 seed/空配置有意义）；缺键由 Object.keys 决定，不写占位。
    if (typeof value !== "string") {
      throw new TestEnvError(`fixture input 值必须是字符串: ${JSON.stringify(key)}`);
    }
    normalized[key] = value;
  }
  return normalized;
}

/**
 * 校验并规范化只读 fixture 规格：字面形式 {name, files: {相对路径: 内容}}，
 * 或构造形式 {name, inputs: {文本键: 文本值}, build(stagingDir) => 相对路径[]}。
 * 规格是普通 JS 数据，不引入 DSL；不读取被测实现生成期望。
 */
export function normalizeFixtureSpec(spec) {
  const form = assertFixtureShape(spec);
  if (form === "literal") {
    return { name: spec.name, form, files: normalizeFixtureFiles(spec.files) };
  }
  if (typeof spec.build !== "function") {
    throw new TestEnvError("fixture build 必须是函数");
  }
  return {
    name: spec.name,
    form,
    inputs: normalizeFixtureInputs(spec.inputs),
    build: spec.build,
  };
}

function fixtureDigest(spec) {
  const hash = crypto.createHash("sha256");
  if (spec.form === "built") {
    hash.update("form:built\n");
    hash.update(`name:${spec.name}\n`);
    for (const key of Object.keys(spec.inputs)) {
      hash.update(`input:${key}\n`);
      hash.update(`len:${Buffer.byteLength(spec.inputs[key])}\n`);
      hash.update(spec.inputs[key]);
    }
    return hash.digest("hex");
  }
  for (const rel of Object.keys(spec.files)) {
    hash.update(`file:${rel}\n`);
    hash.update(`len:${Buffer.byteLength(spec.files[rel])}\n`);
    hash.update(spec.files[rel]);
  }
  return hash.digest("hex");
}

// 只接受普通文件与真实目录：symlink/设备等不会被递归跟随，也不会被 chmod。
function inspectTree(root) {
  const files = [];
  const dirs = [];
  const invalid = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        invalid.push(rel);
      } else if (entry.isDirectory()) {
        dirs.push(rel);
        walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      } else {
        invalid.push(rel);
      }
    }
  };
  walk(root, "");
  return { files: files.sort(), dirs: dirs.sort(), invalid: invalid.sort() };
}

function payloadDirs(paths) {
  const dirs = new Set();
  for (const rel of paths) {
    let dir = path.posix.dirname(rel);
    while (dir !== ".") {
      dirs.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  return [...dirs].sort();
}

// 实际完整文件集合/目录集合必须与声明一致；控制记录是唯一允许额外存在的私有文件。
function assertPayloadTree(dir, expected, label, allowControl) {
  const tree = inspectTree(dir);
  if (tree.invalid.length > 0) {
    throw new TestEnvError(`${label} 含非普通文件/symlink: ${tree.invalid.join(", ")}`);
  }
  const actual = allowControl
    ? tree.files.filter((rel) => rel !== FIXTURE_CONTROL_FILE)
    : tree.files;
  const missing = expected.filter((rel) => !actual.includes(rel));
  if (missing.length > 0) {
    throw new TestEnvError(`${label} 不完整，缺少 ${missing.join(", ")}`);
  }
  const extra = actual.filter((rel) => !expected.includes(rel));
  if (extra.length > 0) {
    throw new TestEnvError(`${label} 含规格外文件: ${extra.join(", ")}`);
  }
  const expectedDirs = payloadDirs(expected);
  if (tree.dirs.length !== expectedDirs.length || tree.dirs.some((rel, index) => rel !== expectedDirs[index])) {
    throw new TestEnvError(`${label} 含规格外目录: ${tree.dirs.join(", ")}`);
  }
}

function sha256Bytes(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// 读取声明文件的事实；调用前必须已通过集合校验，避免跟随 symlink 读借用目标。
function payloadFacts(dir, expected, label) {
  return expected.map((rel) => {
    const absolute = path.join(dir, rel);
    let content;
    try {
      content = fs.readFileSync(absolute);
    } catch (error) {
      throw new TestEnvError(`${label} 不完整，缺少 ${rel}: ${error.message}`);
    }
    return { path: rel, bytes: content.length, sha256: sha256Bytes(content), content };
  });
}

function assertLiteralContent(facts, spec, label) {
  for (const fact of facts) {
    if (Buffer.compare(fact.content, Buffer.from(spec.files[fact.path], "utf8")) !== 0) {
      throw new TestEnvError(`${label} 内容与规格不一致: ${fact.path}`);
    }
  }
}

function assertRecordFacts(record, facts, label) {
  const expected = record.files;
  for (let index = 0; index < expected.length; index += 1) {
    const declared = expected[index];
    const actual = facts[index];
    if (declared.path !== actual.path || declared.bytes !== actual.bytes || declared.sha256 !== actual.sha256) {
      throw new TestEnvError(`${label} 控制记录与payload字节哈希不一致: ${actual.path}`);
    }
  }
}

function freezePayload(dir, facts) {
  for (const fact of facts) {
    fs.chmodSync(path.join(dir, fact.path), 0o444);
  }
}

function fixtureDescriptor(scope, spec, digest, dir, paths) {
  const files = new Map();
  for (const rel of paths) files.set(rel, path.join(dir, rel));
  return { scope, name: spec.name, digest, dir, files };
}

// 每个 (run, fixture 内容指纹) 的初始化归属记录，只有两个消费者：
//   - owner：用 claim 的原子独占创建取得唯一初始化权；
//   - 等待者：用 claim/failed 得知 owner 是否仍在初始化，绝不自行构建。
// 记录放在 run scope 的 fixtures/.claims 下，随 scope 回收；不是全局锁服务。
// 发布事实不再外置：完整 payload 清单/字节哈希/规格 digest 与 payload 同目录，
// 控制记录先写进 staging，再由一次 rename 整体发布。
const FIXTURE_RECORD_KIND = "ai-novel-test-fixture-init/v1";
const FIXTURE_CONTROL_KIND = "ai-novel-test-fixture-payload/v2";
const FIXTURE_CLAIMS_DIR = ".claims";
const FIXTURE_WAIT_MS = 30000;
const FIXTURE_WAIT_POLL_MS = 20;

function fixtureRecordPaths(scope, base) {
  const dir = path.join(scope.fixturesDir, FIXTURE_CLAIMS_DIR);
  return {
    dir,
    claim: path.join(dir, `${base}.claim`),
    failed: path.join(dir, `${base}.failed`),
  };
}

function readFixtureRecord(file, digest) {
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record?.digest === digest ? record : null;
  } catch {
    // claim 可能刚创建、内容尚未写完；等待者按「尚无结果」继续等。
    return null;
  }
}

function writeFixtureRecord(finalPath, payload) {
  const tmp = `${finalPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tmp, finalPath);
}

// 文件系统级原子独占创建：并发进程里只有一个能成为 owner。
function acquireFixtureClaim(paths, normalized, digest) {
  const claim = {
    kind: FIXTURE_RECORD_KIND,
    name: normalized.name,
    digest,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  let fd;
  try {
    fd = fs.openSync(paths.claim, "wx");
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw new TestEnvError(`fixture ${normalized.name} 初始化归属记录失败: ${error.message}`);
  }
  try {
    fs.writeSync(fd, `${JSON.stringify(claim)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fixtureFailedMessage(normalized, failed) {
  return `fixture ${normalized.name} 初始化已失败（owner pid=${failed.pid ?? "?"}）：${
    failed.message ?? "unknown"
  }；本 run 不再重建`;
}

function normalizeControlFileEntry(entry, name) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TestEnvError(`fixture ${name} 控制记录文件条目必须是普通对象`);
  }
  const rel = normalizeFixturePath(entry.path);
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
    throw new TestEnvError(`fixture ${name} 控制记录字节数非法: ${rel}`);
  }
  if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
    throw new TestEnvError(`fixture ${name} 控制记录字节哈希非法: ${rel}`);
  }
  return { path: rel, bytes: entry.bytes, sha256: entry.sha256 };
}

function normalizeControlFiles(files, name) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TestEnvError(`fixture ${name} 控制记录缺少非空payload清单`);
  }
  const normalized = files.map((entry) => normalizeControlFileEntry(entry, name));
  const seen = new Set();
  for (const entry of normalized) {
    if (seen.has(entry.path)) {
      throw new TestEnvError(`fixture ${name} 控制记录含重复路径: ${entry.path}`);
    }
    seen.add(entry.path);
  }
  // 控制记录顺序只描述它自己的 payload；接受判定与字节核对按记录路径逐项进行，
  // 不依赖排序，因此不再引入第二套 locale/比较器次序。
  return normalized;
}

function verifyControlRecord(record, normalized, digest) {
  if (record.kind !== FIXTURE_CONTROL_KIND) {
    throw new TestEnvError(`fixture ${normalized.name} 控制记录格式不受支持（旧格式不兼容）`);
  }
  if (record.name !== normalized.name || record.form !== normalized.form) {
    throw new TestEnvError(`fixture ${normalized.name} 控制记录身份与规格不一致`);
  }
  if (record.digest !== digest) {
    throw new TestEnvError(`fixture ${normalized.name} 控制记录规格 digest 不一致`);
  }
  const files = normalizeControlFiles(record.files, normalized.name);
  if (normalized.form === "literal") {
    const expected = Object.keys(normalized.files).sort();
    const actual = files.map((entry) => entry.path).sort();
    if (actual.length !== expected.length || actual.some((rel, index) => rel !== expected[index])) {
      throw new TestEnvError(`fixture ${normalized.name} 控制记录路径与字面规格不一致`);
    }
  }
  return { ...record, files };
}

function controlRecordPath(dir) {
  return path.join(dir, FIXTURE_CONTROL_FILE);
}

// 目标目录存在时只接受同一 staging 目录内已封存的控制记录；旧 ready/裸目录不兼容。
function readControlRecord(dir) {
  const file = controlRecordPath(dir);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) {
    throw new TestEnvError(`fixture 控制记录必须是普通文件: ${file}`);
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new TestEnvError(`fixture 控制记录不可解析: ${error.message}`);
  }
  return record;
}

function controlRecordFromFacts(normalized, digest, facts) {
  return {
    kind: FIXTURE_CONTROL_KIND,
    name: normalized.name,
    form: normalized.form,
    digest,
    files: facts.map(({ path: rel, bytes, sha256 }) => ({ path: rel, bytes, sha256 })),
    pid: process.pid,
    finishedAt: new Date().toISOString(),
  };
}

function writeControlRecord(dir, record) {
  const file = controlRecordPath(dir);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  fs.chmodSync(file, 0o444);
}

// 复用前先核规格与真实字节事实；任何漂移都失败，不静默修补。
function publishedFixture(request, normalized) {
  const { scope, digest, target } = request;
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory()) {
    throw new TestEnvError(`fixture ${normalized.name} 发布路径不是目录: ${target}`);
  }
  const record = readControlRecord(target);
  if (!record) {
    throw new TestEnvError(
      `fixture ${normalized.name} 目标目录缺少控制记录（旧格式不兼容，不做 fallback）`,
    );
  }
  const verified = verifyControlRecord(record, normalized, digest);
  const expected = verified.files.map((entry) => entry.path);
  assertPayloadTree(target, expected, target, true);
  const facts = payloadFacts(target, expected, target);
  if (normalized.form === "literal") assertLiteralContent(facts, normalized, target);
  assertRecordFacts(verified, facts, target);
  freezePayload(target, facts);
  return fixtureDescriptor(scope, normalized, digest, target, expected);
}

// 调用边界只解析一次：作用域、等待期限、内容指纹与记录坐标。
function resolveFixtureRequest(normalized, options) {
  const scope = options.scope;
  if (!scope || typeof scope.env !== "function" || !nonEmptyString(scope.fixturesDir)) {
    throw new TestEnvError("materializeFixture 需要外层 run scope（openTestRunScope 的返回值）");
  }
  const waitMs = options.waitTimeoutMs ?? FIXTURE_WAIT_MS;
  if (!Number.isFinite(waitMs) || waitMs <= 0) {
    throw new TestEnvError("waitTimeoutMs 必须是正数");
  }
  const digest = fixtureDigest(normalized);
  const base = `${normalized.name}-${digest}`;
  const target = path.join(scope.fixturesDir, base);
  fs.mkdirSync(scope.fixturesDir, { recursive: true });
  const paths = fixtureRecordPaths(scope, base);
  fs.mkdirSync(paths.dir, { recursive: true });
  return { scope, digest, target, paths, waitMs };
}

function recordFixtureFailure(normalized, request, failure) {
  try {
    writeFixtureRecord(request.paths.failed, {
      kind: FIXTURE_RECORD_KIND,
      name: normalized.name,
      digest: request.digest,
      pid: process.pid,
      message: failure.message,
      failedAt: new Date().toISOString(),
    });
  } catch {
    // 失败记录本身写不进去时保留原始错误；等待者会因无发布事实而超时失败。
  }
  const message = `fixture ${normalized.name} 初始化失败: ${failure.message}`;
  if (failure instanceof AggregateError) {
    // 双失败：保留 primary 与 cleanup 两段事实，调用者不只看 cleanup。
    return new AggregateError(failure.errors, message);
  }
  const wrapped = new TestEnvError(message);
  wrapped.cause = failure;
  return wrapped;
}

function writeStagingFiles(staging, normalized) {
  for (const [rel, content] of Object.entries(normalized.files)) {
    const absolute = path.join(staging, rel);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, { flag: "wx" });
  }
  return Object.keys(normalized.files).sort();
}

// 构造回调只在 claim 成功后运行；声明路径必须非空、唯一、留在 staging 内。
function runFixtureBuilder(staging, normalized) {
  let declared;
  try {
    declared = normalized.build(staging);
  } catch (error) {
    throw new TestEnvError(`fixture ${normalized.name} builder 执行失败: ${error.message}`);
  }
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new TestEnvError(`fixture ${normalized.name} builder 必须返回非空的相对payload路径数组`);
  }
  const paths = declared.map((rel) => normalizeFixturePath(rel));
  const unique = new Set(paths);
  if (unique.size !== paths.length) {
    throw new TestEnvError(`fixture ${normalized.name} builder 声明了重复payload路径`);
  }
  return paths.sort();
}

function snapshotStaging(staging, expected, normalized, label) {
  assertPayloadTree(staging, expected, label, false);
  const facts = payloadFacts(staging, expected, label);
  if (normalized.form === "literal") assertLiteralContent(facts, normalized, label);
  return facts;
}

// 只回收本 owner 在失败路径上仍持有的 staging；借用资源不在此处触碰。
function cleanupStaging(staging) {
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    return null;
  } catch (error) {
    return error;
  }
}

// 同一失败边界同时保留 primary 与 cleanup：不吞 cleanup，也不让 cleanup 顶替 primary。
// label 只决定消息里的资源名，调用者仍拿到同一个标准 AggregateError 形状。
function failureWithCleanup(primary, cleanupError, label = "staging") {
  if (!cleanupError) return primary;
  return new AggregateError(
    [primary, cleanupError],
    `${primary.message}；${label} 清理失败: ${cleanupError.message}`,
  );
}

// 只有 claim 的 owner 进入这里；完整构建 + 校验 + 控制记录后才 rename 整体发布。
// 发布成功后 staging 路径已原子转移给 target，所有权结束；只有失败路径才回收 staging。
function buildFixturePayload(request, normalized) {
  const { scope, digest, target } = request;
  const staging = fs.mkdtempSync(path.join(scope.fixturesDir, ".staging-"));
  try {
    const expected =
      normalized.form === "literal"
        ? writeStagingFiles(staging, normalized)
        : runFixtureBuilder(staging, normalized);
    const facts = snapshotStaging(staging, expected, normalized, staging);
    freezePayload(staging, facts);
    writeControlRecord(staging, controlRecordFromFacts(normalized, digest, facts));
    const descriptor = fixtureDescriptor(scope, normalized, digest, target, expected);
    fs.renameSync(staging, target);
    return descriptor;
  } catch (primary) {
    const cleanupError = cleanupStaging(staging);
    throw recordFixtureFailure(normalized, request, failureWithCleanup(primary, cleanupError));
  }
}

// 等待者的单次判定：只接受 owner 已发布的事实，绝不自行构建。
function ownerOutcome(request, normalized) {
  const { digest, paths } = request;
  const failed = readFixtureRecord(paths.failed, digest);
  if (failed) throw new TestEnvError(fixtureFailedMessage(normalized, failed));
  return publishedFixture(request, normalized);
}

function awaitFixtureOwner(request, normalized) {
  const { digest, paths, waitMs } = request;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const outcome = ownerOutcome(request, normalized);
    if (outcome) return outcome;
    // 每轮重读 claim：首次读取可能撞上 owner 刚创建、内容尚未写完的文件。
    const claim = readFixtureRecord(paths.claim, digest);
    if (claim?.pid && claim.pid !== process.pid && !processAlive(claim.pid)) {
      throw new TestEnvError(
        `fixture ${normalized.name} 初始化 owner(pid=${claim.pid}) 已退出且未发布完整模板/failed，` +
          "本 run 按基础设施失败处理",
      );
    }
    sleepSync(FIXTURE_WAIT_POLL_MS);
  }
  throw new TestEnvError(
    `fixture ${normalized.name} 等待 fixture 初始化超时（${waitMs}ms），不自行构建`,
  );
}

/**
 * 在同一 run scope 内只物化一次只读 fixture。
 *
 * 并发进程先原子取得该 (run, 规格指纹) 的唯一初始化权（claim），只有 owner
 * 在 staging 构建并校验完整后写控制记录、一次 rename 整体发布；其余进程等待
 * owner 的完整结果，绝不各自构建后竞争。初始化失败会写 failed，等待者在本 run
 * 明确失败而不是重建；owner 被杀或等待期限耗尽同样按基础设施失败处理。
 * 消费者拿到目录与文件路径，不能修改模板（文件只读；复用时校验规格 digest、
 * 完整文件集合与每文件字节哈希）。
 *
 * @param {{name: string, files: Record<string, string>}
 *   | {name: string, inputs: Record<string, string>, build: (stagingDir: string) => string[]}} spec
 * @param {{scope: object, waitTimeoutMs?: number}} options
 */
export function materializeFixture(spec, options = {}) {
  const normalized = normalizeFixtureSpec(spec);
  const request = resolveFixtureRequest(normalized, options);
  const published = publishedFixture(request, normalized);
  if (published) return published;
  const failed = readFixtureRecord(request.paths.failed, request.digest);
  if (failed) throw new TestEnvError(fixtureFailedMessage(normalized, failed));
  if (!acquireFixtureClaim(request.paths, normalized, request.digest)) {
    return awaitFixtureOwner(request, normalized);
  }
  return buildFixturePayload(request, normalized);
}

/** 重新读取模板内容计算哈希，供调用方核对消费者没有改坏模板。 */
export function fixtureTemplateHash(fixture) {
  const hash = crypto.createHash("sha256");
  for (const rel of [...fixture.files.keys()].sort()) {
    hash.update(`file:${rel}\n`);
    hash.update(fs.readFileSync(fixture.files.get(rel)));
  }
  return hash.digest("hex");
}

function copyFixtureFiles(fixture, dir) {
  const files = new Map();
  for (const [rel, source] of fixture.files) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, 0o644);
    files.set(rel, target);
  }
  return files;
}

/**
 * 为确实需要写文件的 case 建立隔离工作副本；传入 node:test TestContext 时
 * 通过 t.after 绑定退出清理。工作副本不反向影响只读模板。
 */
export function createWorkingCopy(fixture, options = {}) {
  const scope = options.scope ?? fixture.scope;
  if (!scope || !nonEmptyString(scope.workDir)) {
    throw new TestEnvError("createWorkingCopy 需要 run scope");
  }
  fs.mkdirSync(scope.workDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scope.workDir, `${fixture.name}-`));
  // 清理成功后才标记完成：重复 cleanup 不再触碰旧路径（宿主可能已在上面重建
  // 资源）；清理失败保持未完成，后续仍可重试，不能提前放弃 owned 目录。
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    fs.rmSync(dir, { recursive: true, force: true });
    cleaned = true;
  };
  // 释放责任先于复制建立：复制中途失败时，除了本函数立即关闭，已注册的 after
  // 也只能对同一目录做幂等收口。
  try {
    if (options.context && typeof options.context.after === "function") {
      options.context.after(cleanup);
    }
    const files = copyFixtureFiles(fixture, dir);
    return { dir, files, cleanup, fixture };
  } catch (primary) {
    let cleanupError = null;
    try {
      cleanup();
    } catch (error) {
      cleanupError = error;
    }
    // 复制失败是 primary；已创建目录的回收失败是附加事实，二者都不能被掩盖。
    throw failureWithCleanup(primary, cleanupError, "工作副本");
  }
}

/**
 * 同步组合 createWorkingCopy 与 use：正常结果在副本关闭后返回；use 抛错也关闭副本，
 * use 与 cleanup 同时失败时用 failureWithCleanup 同时保留两者，单错误原样抛出。
 * use 必须是同步函数；不在这里引入 Promise/async 回调协议。
 */
export function withWorkingCopy(fixture, use, options = {}) {
  const copy = createWorkingCopy(fixture, options);
  let result;
  try {
    result = use(copy);
  } catch (primary) {
    let cleanupError = null;
    try {
      copy.cleanup();
    } catch (error) {
      cleanupError = error;
    }
    throw failureWithCleanup(primary, cleanupError, "工作副本");
  }
  copy.cleanup();
  return result;
}

const RUN_OPTIONS = Object.freeze({
  "--timeout-ms": "timeoutMs",
  "--archive": "archiveDir",
  "--base": "baseDir",
});

function applyRunOption(options, token, value) {
  if (token !== "--timeout-ms") {
    options[RUN_OPTIONS[token]] = value;
    return;
  }
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TestEnvError("--timeout-ms 需要正数");
  }
  options.timeoutMs = timeoutMs;
}

function parseRunArgs(argv) {
  const options = { timeoutMs: 0, archiveDir: "", baseDir: "" };
  let index = 0;
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      index += 1;
      break;
    }
    if (!RUN_OPTIONS[token]) throw new TestEnvError(`run 未知参数: ${token}`);
    const value = argv[index + 1];
    if (!nonEmptyString(value)) throw new TestEnvError(`${token} 需要参数`);
    applyRunOption(options, token, value);
    index += 1;
  }
  const [command, ...args] = argv.slice(index);
  if (!command) throw new TestEnvError("run 需要 -- 之后的命令");
  return { options, command, args };
}

function usage() {
  console.error(
    [
      "用法：node scripts/lib/test_env.mjs run [选项] -- COMMAND [ARGS...]",
      "  --timeout-ms N   超时后只回收本 run 子进程树，退出码 124",
      "  --archive DIR    将简明运行结果写入该证据目录（借用，不删除）",
      "  --base DIR       新建 owned scratch 的父目录（默认系统临时目录）",
    ].join("\n"),
  );
}

function parseRunArgsOrReport(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "run") {
    usage();
    return null;
  }
  try {
    return parseRunArgs(rest);
  } catch (error) {
    console.error(`[test-env] ${error.message}`);
    return null;
  }
}

function openScopeOrReport(options) {
  try {
    return openTestRunScope(options);
  } catch (error) {
    console.error(`[test-env] 初始化运行作用域失败：${error.message}`);
    return null;
  }
}

function isTreeFailed(result) {
  return result.tree_error !== undefined || result.tree_finalized === false;
}

// owned 收口只在拥有者且树已收口时执行；树失败时保留可能仍在使用的 scratch。
// 借用路径交给 public close 自然 no-op。CLI 是唯一把 close 异常转换为
// cleanup_error 的边界；Node 测试 after 直接调用 close()，由 framework 接收异常
// 并真实失败。
function closeOwnedScope(scope, treeFailed) {
  if (scope.owned && treeFailed) return { removed: false };
  try {
    return scope.close();
  } catch (error) {
    return { removed: false, error: error.message };
  }
}

function scratchRetained(scope, result) {
  if (scope.borrowed) return Boolean(result.tree_error || result.cleanup_error);
  return result.scope_removed === false;
}

function archiveResultIfConfigured(scope, result) {
  if (!scope.archiveDir) return;
  try {
    result.archive = scope.archiveResult(result);
  } catch (error) {
    result.archive_error = error.message;
    result.exitCode = result.exitCode || 1;
  }
}

/**
 * CLI 的最终出口：先确定拥有的资源是否收口，再把同一份结果归档、输出、返回。
 * cleanup 失败不会被掩成子进程成功；归档失败也按非通过处理。
 */
function finalizeRun(scope, result) {
  const closed = closeOwnedScope(scope, isTreeFailed(result));
  result.scope_removed = Boolean(closed.removed);
  if (closed.error) result.cleanup_error = closed.error;
  if (result.cleanup_error) result.exitCode = result.exitCode || 1;
  result.scratch_retained = scratchRetained(scope, result);
  archiveResultIfConfigured(scope, result);
  return result;
}

async function main(argv) {
  const parsed = parseRunArgsOrReport(argv);
  if (!parsed) return 64;
  const scope = openScopeOrReport(parsed.options);
  if (!scope) return 1;
  const result = finalizeRun(
    scope,
    await runInScope(scope, parsed.command, parsed.args, {
      timeoutMs: parsed.options.timeoutMs,
    }),
  );
  console.error(`[test-env] ${describeRunResult(result, scope).join(" ")}`);
  return result.exitCode;
}

// 总结果身份：run/exit/耗时与原始子进程退出事实。
function describeCore(result, scope) {
  const parts = [`run=${scope.runId}`, `exit=${result.exitCode}`, `duration_ms=${result.duration_ms}`];
  if (result.child_exit_code !== undefined && result.child_exit_code !== null) {
    parts.push(`child_exit=${result.child_exit_code}`);
  }
  return parts;
}

function describeStopSignal(result) {
  const parts = [];
  if (result.stopped_by) parts.push(`stopped_by=${result.stopped_by}`);
  if (result.signal) parts.push(`signal=${result.signal}`);
  return parts;
}

function describeSignals(result) {
  return [...(result.timed_out ? ["timed_out=true"] : []), ...describeStopSignal(result)];
}

function describeField(name, value) {
  return value === undefined ? "" : `${name}=${value}`;
}

function describeErrorField(name, value) {
  return value === undefined ? "" : `${name}=${JSON.stringify(value)}`;
}

// 资源事实：进程树是否收口、归档是否写出；二者都是同一 run 的退出资源。
function describeResource(result) {
  return [
    describeField("tree_finalized", result.tree_finalized),
    describeErrorField("tree_error", result.tree_error),
    describeField("archive", result.archive),
    describeField("archive_error", result.archive_error),
  ].filter(Boolean);
}

function describeCleanupError(result) {
  return [describeErrorField("cleanup_error", result.cleanup_error)].filter(Boolean);
}

function describeScratch(result, scope) {
  if (!result.scratch_retained) return [];
  return [scope.borrowed ? `parent_scope=${scope.dir}` : `scratch_retained=${scope.dir}`];
}

function describeRunResult(result, scope) {
  return [
    ...describeCore(result, scope),
    ...describeSignals(result),
    ...describeResource(result),
    ...describeCleanupError(result),
    ...describeScratch(result, scope),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
