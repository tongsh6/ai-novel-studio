// 测试/验收入口统一运行时前置 helper（scripts/lib/test_env.sh）的行为与接线回归。
// 使用临时目录 + fake mix + 本地回环 HTTP，不启动真实数据库/GUI/模型。

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER = path.join(ROOT, "scripts/lib/test_env.sh");

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
