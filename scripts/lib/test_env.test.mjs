// 测试/验收入口统一运行时前置 helper（scripts/lib/test_env.sh）的行为与接线回归。
// 使用临时目录 + fake mix + 本地回环 HTTP，不启动真实数据库/GUI/模型。

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER = path.join(ROOT, "scripts/lib/test_env.sh");
const TEST_ENV_MJS = path.join(ROOT, "scripts/lib/test_env.mjs");
const TEST_ENV_URL = pathToFileURL(TEST_ENV_MJS).href;
const STATIC_SCAN = path.join(ROOT, "scripts/ai_static_scan.sh");
const TASK_DONE = path.join(ROOT, "scripts/task_done.sh");

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// fake mix：把每次调用写进 FAKE_MIX_LOG，migrate 可按 FAKE_MIGRATE_EXIT 失败。
// 行为测试只验证 helper 的调用序列与退出语义，不建真实数据库。
function writeFakeMix(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const mixPath = path.join(binDir, "mix");
  fs.writeFileSync(
    mixPath,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$*" >> "$FAKE_MIX_LOG"',
      'if [ -n "${FAKE_MIX_ENV_LOG:-}" ]; then',
      '  printf "%s\\t%s\\t%s\\t%s\\n" "${NOVEL_TEST_RUN_DIR:-}" "${TMPDIR:-}" "${NOVEL_TEST_DB_DIR:-}" "$*" >> "$FAKE_MIX_ENV_LOG"',
      'fi',
      'case "$*" in',
      '  *"ecto.migrate"*) exit "${FAKE_MIGRATE_EXIT:-0}" ;;',
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  fs.chmodSync(mixPath, 0o755);
}

function helperEnv(t, extraEnv) {
  const binDir = tempDir(t, "test-env-bin-");
  writeFakeMix(binDir);
  const logPath = path.join(tempDir(t, "test-env-log-"), "mix.log");
  const env = {
    PATH: `${binDir}:${process.env.PATH}`,
    HOME: process.env.HOME,
    // 子进程白名单也要带受控 TMPDIR（而非隐含落到全局 /tmp）；需要独立 scratch 的
    // 用例仍通过 extraEnv 传入测试独有目录。
    TMPDIR: process.env.TMPDIR,
    HELPER_PATH: HELPER,
    FAKE_MIX_LOG: logPath,
    ...extraEnv,
  };
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key];
  }
  return { env, logPath };
}

function readMixLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readEnvLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [run, tmp, db, ...args] = line.split("\t");
      return { run, tmp, db, args: args.join("\t") };
    });
}

function archiveEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

function runEntry(t, script, args, extraEnv = {}) {
  const { env, logPath } = helperEnv(t, extraEnv);
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync("/bin/bash", [script, ...args], {
    encoding: "utf8",
    env,
    cwd: ROOT,
  });
  result.mixLog = readMixLog(logPath);
  return result;
}

function createParentScope(t, base) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { openTestRunScope } from ${JSON.stringify(TEST_ENV_URL)};
const scope = openTestRunScope({ baseDir: process.env.PARENT_BASE });
console.log(JSON.stringify({ dir: scope.dir, tmp: scope.tmpDir }));`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PARENT_BASE: base },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return JSON.parse(result.stdout);
}

function recordEvidence(name, payload) {
  const dir = process.env.B84_EVIDENCE_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

function cleanupNewTaskDoneDirs(t) {
  const dir = path.join(ROOT, "artifacts/task-done");
  const before = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  t.after(() => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!before.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  });
}

function runWithHelper(t, body, extraEnv = {}) {
  const { env, logPath } = helperEnv(t, extraEnv);
  const result = spawnSync("/bin/bash", ["-c", `set -u\nsource "$HELPER_PATH"\n${body}`], {
    encoding: "utf8",
    env,
  });
  result.mixLog = readMixLog(logPath);
  return result;
}

// 需要同时跑真实本地 HTTP 服务时用异步版本：spawnSync 会阻塞 node 事件循环，
// 父进程内的 server 无法应答子进程的 curl。
function runWithHelperAsync(t, body, extraEnv = {}) {
  const { env, logPath } = helperEnv(t, extraEnv);
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-c", `set -u\nsource "$HELPER_PATH"\n${body}`], {
      env,
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
    child.on("close", (status) => {
      resolve({ status, stdout, stderr, mixLog: readMixLog(logPath) });
    });
  });
}

function listenOnLoopback() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

test("novel_test_db_dir --dir 创建目录，直接调用时导出目录", (t) => {
  const base = tempDir(t, "test-env-db-parent-");
  const target = path.join(base, "database");
  const result = runWithHelper(
    t,
    'novel_test_db_dir --dir "$DB_TARGET" >/dev/null || exit 91\nprintf "exported=%s\\n" "${NOVEL_TEST_DB_DIR:-}"',
    { DB_TARGET: target, NOVEL_TEST_DB_DIR: "", TMPDIR: base },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `exported=${target}`);
  assert.ok(fs.statSync(target).isDirectory());
});

test("novel_test_db_dir --dir 在命令替换中返回目录路径", (t) => {
  const base = tempDir(t, "test-env-db-parent-");
  const target = path.join(base, "database");
  const result = runWithHelper(
    t,
    'dir="$(novel_test_db_dir --dir "$DB_TARGET")" || exit 91\nprintf "dir=%s\\n" "$dir"',
    { DB_TARGET: target, NOVEL_TEST_DB_DIR: "", TMPDIR: base },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `dir=${target}`);
});

test("novel_test_db_dir 未指定时在 TMPDIR 下创建一次性目录并导出", (t) => {
  const tmp = tempDir(t, "test-env-tmp-");
  const result = runWithHelper(
    t,
    'novel_test_db_dir >/dev/null || exit 91\nprintf "exported=%s\\n" "${NOVEL_TEST_DB_DIR:-}"',
    { NOVEL_TEST_DB_DIR: "", TMPDIR: tmp },
  );
  assert.equal(result.status, 0, result.stderr);
  const dir = result.stdout.trim().slice("exported=".length);
  assert.ok(dir.startsWith(tmp), `expected ${dir} under ${tmp}`);
  assert.ok(fs.statSync(dir).isDirectory());
});

test("novel_test_db_prepare 先 create 后 migrate，并导出目录", (t) => {
  const projectRoot = tempDir(t, "test-env-project-");
  const dbDir = path.join(tempDir(t, "test-env-db-"), "database");
  const result = runWithHelper(
    t,
    'novel_test_db_prepare --dir "$DB_TARGET" --root "$PROJECT_ROOT_ARG" || exit 91\nprintf "exported=%s\\n" "${NOVEL_TEST_DB_DIR:-}"',
    { DB_TARGET: dbDir, PROJECT_ROOT_ARG: projectRoot },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.mixLog, ["ecto.create --quiet", "ecto.migrate --quiet"]);
  assert.equal(result.stdout.trim(), `exported=${dbDir}`);
});

test("novel_test_db_prepare --reset 先 drop 再 create/migrate", (t) => {
  const projectRoot = tempDir(t, "test-env-project-");
  const dbDir = path.join(tempDir(t, "test-env-db-"), "database");
  const result = runWithHelper(
    t,
    'novel_test_db_prepare --reset --dir "$DB_TARGET" --root "$PROJECT_ROOT_ARG" || exit 91',
    { DB_TARGET: dbDir, PROJECT_ROOT_ARG: projectRoot },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.mixLog, [
    "ecto.drop --quiet",
    "ecto.create --quiet",
    "ecto.migrate --quiet",
  ]);
});

test("migrate 失败时 novel_test_db_prepare fail-closed", (t) => {
  const projectRoot = tempDir(t, "test-env-project-");
  const dbDir = path.join(tempDir(t, "test-env-db-"), "database");
  const result = runWithHelper(
    t,
    'novel_test_db_prepare --dir "$DB_TARGET" --root "$PROJECT_ROOT_ARG"',
    { DB_TARGET: dbDir, PROJECT_ROOT_ARG: projectRoot, FAKE_MIGRATE_EXIT: "1" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /测试库迁移失败/);
});

test("novel_wait_for_http 在端点就绪时返回 0", async (t) => {
  const { server, port } = await listenOnLoopback();
  t.after(() => server.close());
  const result = await runWithHelperAsync(
    t,
    'novel_wait_for_http "$WAIT_URL" "端到端服务" 5 || exit 92',
    { WAIT_URL: `http://127.0.0.1:${port}/health` },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("novel_wait_for_http 超时非 0 且不伪造 ready", (t) => {
  const result = runWithHelper(
    t,
    'novel_wait_for_http "http://127.0.0.1:1/health" "未启动服务" 1 || exit 93',
    {},
  );
  assert.equal(result.status, 93, result.stderr);
  assert.match(result.stderr, /未就绪/);
});

test("novel_ports_precheck 占用返回非 0、空闲返回 0", async (t) => {
  const { server, port } = await listenOnLoopback();
  const occupied = runWithHelper(t, 'novel_ports_precheck "$PORT"', { PORT: String(port) });
  assert.notEqual(occupied.status, 0);
  assert.match(occupied.stderr, new RegExp(`端口 ${port} 已被占用`));

  await new Promise((resolve) => server.close(resolve));
  const free = runWithHelper(t, 'novel_ports_precheck "$PORT"', { PORT: String(port) });
  assert.equal(free.status, 0, free.stderr);
});

test("novel_node_test_scope 委托 Node 作用域：无建库、TMPDIR 本地化、退出码透传", (t) => {
  const tmp = tempDir(t, "test-env-node-");
  const body = [
    'novel_node_test_scope -- /bin/bash -c \'printf "run=%s\\ntmp=%s\\n" "$NOVEL_TEST_RUN_DIR" "$TMPDIR"\' || exit 94',
  ].join("\n");
  const result = runWithHelper(t, body, { TMPDIR: tmp, NOVEL_TEST_RUN_DIR: "" });
  assert.equal(result.status, 0, result.stderr);
  const values = {};
  for (const line of result.stdout.trim().split("\n")) {
    const [key, ...rest] = line.split("=");
    values[key] = rest.join("=");
  }
  assert.ok(values.run.startsWith(tmp), `run=${values.run}`);
  assert.equal(values.tmp, `${values.run}/tmp`);
  assert.deepEqual(result.mixLog, [], "Node 作用域不得创建/迁移数据库");
  assert.equal(fs.existsSync(values.run), false, "owned scratch 应被回收");

  const failing = runWithHelper(t, 'novel_node_test_scope -- /bin/bash -c "exit 3"', {
    TMPDIR: tmp,
    NOVEL_TEST_RUN_DIR: "",
  });
  assert.equal(failing.status, 3);
  assert.deepEqual(failing.mixLog, []);
});

test("novel_node_test_scope 嵌套复用父 run 且不删父 scope", (t) => {
  const tmp = tempDir(t, "test-env-node-nested-");
  const nestedScript = path.join(tmp, "nested.sh");
  fs.writeFileSync(
    nestedScript,
    [
      "#!/bin/bash",
      "set -u",
      'touch "$NOVEL_TEST_RUN_DIR/sentinel"',
      'source "$HELPER_PATH"',
      'inner="$(novel_node_test_scope -- /bin/bash -c \'printf "%s" "$NOVEL_TEST_RUN_DIR"\' 2>/dev/null)"',
      'printf "outer=%s\\ninner=%s\\nsentinel=%s\\n" "$NOVEL_TEST_RUN_DIR" "$inner" ' +
        '"$(test -f "$NOVEL_TEST_RUN_DIR/sentinel" && echo yes || echo no)"',
      "",
    ].join("\n"),
  );
  const result = runWithHelper(t, 'novel_node_test_scope -- /bin/bash "$NESTED_SCRIPT" || exit 96', {
    TMPDIR: tmp,
    NOVEL_TEST_RUN_DIR: "",
    NESTED_SCRIPT: nestedScript,
    HELPER_PATH: HELPER,
  });
  assert.equal(result.status, 0, result.stderr);
  const values = {};
  for (const line of result.stdout.trim().split("\n")) {
    const [key, ...rest] = line.split("=");
    values[key] = rest.join("=");
  }
  assert.equal(values.inner, values.outer, "嵌套入口应复用父 run 目录");
  assert.equal(values.sentinel, "yes", "嵌套入口不得删除父 scope 内容");
  assert.deepEqual(result.mixLog, []);
  assert.equal(fs.existsSync(values.outer), false, "外层退出后回收 owned scratch");
});

test("验收/测试入口统一 source 前置 helper，不再各自实现建库三连", () => {
  const entrypoints = [
    "scripts/ai_static_scan.sh",
    "scripts/slice_verify.sh",
    "scripts/tauri_slice_verify.sh",
    "scripts/dogfood_run.sh",
  ];
  for (const entry of entrypoints) {
    const source = fs.readFileSync(path.join(ROOT, entry), "utf8");
    assert.match(source, /source .*scripts\/lib\/test_env\.sh/, `${entry} 应 source test_env.sh`);
    assert.doesNotMatch(
      source,
      /mix ecto\.drop[\s\S]{0,400}mix ecto\.create[\s\S]{0,400}mix ecto\.migrate/,
      `${entry} 不应再自带 drop/create/migrate 三连`,
    );
  }

  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /source scripts\/lib\/test_env\.sh/);
  assert.doesNotMatch(ci, /run: MIX_ENV=test mix ecto\.create && MIX_ENV=test mix ecto\.migrate/);
});

test("工程裸入口 ai_static_scan：资源前只申请一次 run，argv/退出/DB 归属保持", (t) => {
  const tmp = tempDir(t, "entry-scan-");
  const base = path.join(tmp, "base");
  const archive = path.join(tmp, "archive");
  const envLog = path.join(tmp, "mix-env.log");
  fs.mkdirSync(base);
  fs.mkdirSync(archive);
  const result = runEntry(t, STATIC_SCAN, ["--top", "7", "--quick"], {
    TMPDIR: tmp,
    NOVEL_TEST_RUN_BASE: base,
    NOVEL_TEST_RUN_ARCHIVE: archive,
    FAKE_MIX_ENV_LOG: envLog,
    FAKE_MIGRATE_EXIT: "1",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(fs.readdirSync(base), [], "owned scratch 应回收");
  const receipts = archiveEntries(archive);
  assert.equal(receipts.length, 1, "裸入口只申请一次 run");
  assert.deepEqual(receipts[0].args, [STATIC_SCAN, "--top", "7", "--quick"], "原始 argv 不得丢失");
  assert.equal(receipts[0].exitCode, 1, "真实退出码应透传");
  assert.equal(receipts[0].scope_removed, true);
  const lines = readEnvLog(envLog);
  assert.equal(lines.length, 2, "create + migrate");
  const last = lines[lines.length - 1];
  assert.equal(last.run, receipts[0].scope.dir);
  assert.equal(last.tmp, path.join(receipts[0].scope.dir, "tmp"));
  assert.ok(
    last.db.startsWith(`${path.join(receipts[0].scope.dir, "tmp", "ai-novel-test-db.")}`),
    last.db,
  );
  assert.equal(fs.existsSync(last.db), false, "默认测试库随 scope 回收");
  assert.equal(fs.existsSync(receipts[0].scope.dir), false);
  recordEvidence("bare-static-scan", {
    status: result.status,
    receipt: receipts[0],
    mix_env: lines,
    base_remaining: fs.readdirSync(base),
  });
});

test("工程嵌套入口 task_done→ai_static_scan：继承同一 run，不重复申请", (t) => {
  cleanupNewTaskDoneDirs(t);
  const tmp = tempDir(t, "entry-taskdone-");
  const base = path.join(tmp, "base");
  const archive = path.join(tmp, "archive");
  const envLog = path.join(tmp, "mix-env.log");
  fs.mkdirSync(base);
  fs.mkdirSync(archive);
  const result = runEntry(t, TASK_DONE, ["--quick", "--top", "7"], {
    TMPDIR: tmp,
    NOVEL_TEST_RUN_BASE: base,
    NOVEL_TEST_RUN_ARCHIVE: archive,
    FAKE_MIX_ENV_LOG: envLog,
    FAKE_MIGRATE_EXIT: "1",
  });
  assert.equal(result.status, 1, result.stderr);
  const receipts = archiveEntries(archive);
  assert.equal(receipts.length, 1, "嵌套入口不得新建第二个 owned run");
  assert.deepEqual(
    receipts[0].args,
    [TASK_DONE, "--quick", "--top", "7"],
    "task_done 原始 argv 不得丢失",
  );
  const lines = readEnvLog(envLog);
  assert.ok(lines.length >= 2, "static_scan 必须在嵌套 scope 内执行 DB 前置");
  assert.deepEqual(
    [...new Set(lines.map((line) => line.run))],
    [receipts[0].scope.dir],
    "task_done 与 static_scan 必须共用同一 run",
  );
  for (const line of lines) {
    assert.equal(line.tmp, path.join(receipts[0].scope.dir, "tmp"));
    assert.ok(line.db.startsWith(`${line.tmp}${path.sep}ai-novel-test-db.`), line.db);
  }
  assert.deepEqual(fs.readdirSync(base), []);
  recordEvidence("nested-task-done", {
    status: result.status,
    receipt: receipts[0],
    mix_env: lines,
    base_remaining: fs.readdirSync(base),
  });
});

test("工程入口借用已有父 scope：父目录/显式 DB sentinel 均不变", (t) => {
  const tmp = tempDir(t, "entry-borrow-");
  const parentBase = path.join(tmp, "parent-base");
  fs.mkdirSync(parentBase);
  const parent = createParentScope(t, parentBase);
  const dbDir = path.join(tmp, "explicit-db");
  const sentinel = path.join(dbDir, "sentinel");
  fs.mkdirSync(dbDir);
  fs.writeFileSync(sentinel, "keep\n");
  const archive = path.join(tmp, "archive");
  const envLog = path.join(tmp, "mix-env.log");
  fs.mkdirSync(archive);
  const result = runEntry(t, STATIC_SCAN, ["--top", "1"], {
    TMPDIR: tmp,
    NOVEL_TEST_RUN_DIR: parent.dir,
    NOVEL_TEST_DB_DIR: dbDir,
    NOVEL_TEST_RUN_ARCHIVE: archive,
    FAKE_MIX_ENV_LOG: envLog,
    FAKE_MIGRATE_EXIT: "1",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(fs.existsSync(parent.dir), true, "借用入口不得删除父 scope");
  assert.equal(fs.existsSync(path.join(parent.dir, ".novel-test-run-owner.json")), true);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep\n", "显式 DB 目录不得被删/重置");
  assert.deepEqual(archiveEntries(archive), [], "借用 scope 不写父 run 归档");
  const last = readEnvLog(envLog).at(-1);
  assert.equal(last.run, parent.dir);
  assert.equal(last.tmp, parent.tmp);
  assert.equal(last.db, dbDir);
  assert.deepEqual(
    fs.readdirSync(parentBase).filter((name) => name.startsWith("ai-novel-test-run.")),
    [path.basename(parent.dir)],
    "不得新建第二个 run",
  );
  recordEvidence("borrowed-parent", {
    status: result.status,
    parent,
    db_dir: dbDir,
    sentinel: fs.readFileSync(sentinel, "utf8"),
    mix_env: readEnvLog(envLog),
    parent_base_entries: fs.readdirSync(parentBase),
  });
});

test("工程入口委托：参数/退出码原样保留；--help 与无效 env 不构造资源", (t) => {
  const tmp = tempDir(t, "entry-delegate-");
  const base = path.join(tmp, "base");
  const archive = path.join(tmp, "archive");
  fs.mkdirSync(base);
  fs.mkdirSync(archive);
  const ok = runWithHelper(
    t,
    'novel_node_test_scope_ensure bash -c \'printf "a1=%s\\na2=%s\\n" "$1" "$2"\' probe --quick --top 7',
    { TMPDIR: tmp, NOVEL_TEST_RUN_BASE: base, NOVEL_TEST_RUN_ARCHIVE: archive },
  );
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /a1=--quick/);
  assert.match(ok.stdout, /a2=--top/);
  const receipt = archiveEntries(archive)[0];
  assert.deepEqual(receipt.args.slice(-4), ["probe", "--quick", "--top", "7"]);
  assert.equal(fs.existsSync(receipt.scope.dir), false);

  const failing = runWithHelper(
    t,
    'novel_node_test_scope_ensure bash -c "exit 3"',
    { TMPDIR: tmp, NOVEL_TEST_RUN_BASE: base, NOVEL_TEST_RUN_ARCHIVE: archive },
  );
  assert.equal(failing.status, 3, "子命令非零退出必须原样透传");

  const beforeHelp = archiveEntries(archive).length;
  const help = runEntry(t, STATIC_SCAN, ["--help"], {
    TMPDIR: tmp,
    NOVEL_TEST_RUN_BASE: base,
    NOVEL_TEST_RUN_ARCHIVE: archive,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /AI 静态扫描闭环入口/);
  assert.equal(archiveEntries(archive).length, beforeHelp, "--help 不得构造 run");
  assert.deepEqual(fs.readdirSync(base), []);

  const invalid = path.join(tmp, "invalid-scope");
  fs.mkdirSync(invalid);
  const invalidEnvLog = path.join(tmp, "invalid-mix.log");
  const invalidResult = runEntry(t, STATIC_SCAN, [], {
    TMPDIR: tmp,
    NOVEL_TEST_RUN_DIR: invalid,
    NOVEL_TEST_RUN_BASE: base,
    FAKE_MIX_ENV_LOG: invalidEnvLog,
  });
  assert.equal(invalidResult.status, 65, "不可借用的外部 scope 必须 fail-closed");
  assert.equal(fs.existsSync(invalidEnvLog), false, "无效 scope 不得继续建库");
  assert.deepEqual(fs.readdirSync(base), []);
  recordEvidence("delegate-args-help-invalid", {
    ok_status: ok.status,
    ok_stdout: ok.stdout,
    failing_status: failing.status,
    help_status: help.status,
    help_created_run: archiveEntries(archive).length !== beforeHelp,
    invalid_status: invalidResult.status,
    invalid_mix_log: fs.existsSync(invalidEnvLog),
  });
});
