// Tauri 工具链定位 helper 的行为与接线回归。
// 只使用临时 fake toolchain 与最小 PATH，不读取用户凭证、不运行真实构建。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER = path.join(ROOT, "scripts/lib/tauri_toolchain.sh");
const RUNNER = path.join(ROOT, "scripts/tauri_slice_verify.sh");
const AUDIT = path.join(ROOT, "scripts/frontend_audit.sh");

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeTool(t, binDir, name) {
  fs.mkdirSync(binDir, { recursive: true });
  const toolPath = path.join(binDir, name);
  fs.writeFileSync(toolPath, `#!/bin/sh\necho "${name} fake"\n`);
  fs.chmodSync(toolPath, 0o755);
  t.after(() => fs.rmSync(toolPath, { force: true }));
}

function writeToolchain(t, binDir) {
  writeTool(t, binDir, "cargo");
  writeTool(t, binDir, "rustc");
}

function runWithHelper(body, env) {
  return spawnSync("/bin/bash", ["-c", `set -u\nsource "$HELPER_PATH"\n${body}`], {
    encoding: "utf8",
    env: {
      HELPER_PATH: HELPER,
      PATH: env.PATH,
      HOME: env.HOME,
      ...(env.CARGO_HOME === undefined ? {} : { CARGO_HOME: env.CARGO_HOME }),
      ...(env.TEST_HOME === undefined ? {} : { TEST_HOME: env.TEST_HOME }),
      ...(env.TEST_CARGO_HOME === undefined ? {} : { TEST_CARGO_HOME: env.TEST_CARGO_HOME }),
    },
  });
}

function ensureBody() {
  return [
    'if ! tauri_toolchain_ensure "${TEST_HOME:-}" "${TEST_CARGO_HOME:-}"; then exit 91; fi',
    'printf "cargo=%s\\n" "$(command -v cargo)"',
    'printf "rustc=%s\\n" "$(command -v rustc)"',
    'printf "path=%s\\n" "$PATH"',
  ].join("\n");
}

function parseOutput(stdout) {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function assertFakeToolchainUsed(t, result, expectedBinDir) {
  assert.equal(result.status, 0, result.stderr);
  const output = parseOutput(result.stdout);
  assert.equal(output.cargo, path.join(expectedBinDir, "cargo"));
  assert.equal(output.rustc, path.join(expectedBinDir, "rustc"));
}

test("PATH 缺失时使用原始用户 home 下已安装的 .cargo/bin", (t) => {
  const emptyPath = tempDir(t, "tauri-toolchain-empty-path-");
  const originalHome = tempDir(t, "tauri-toolchain-original-home-");
  const binDir = path.join(originalHome, ".cargo/bin");
  writeToolchain(t, binDir);

  const result = runWithHelper(ensureBody(), {
    PATH: emptyPath,
    HOME: tempDir(t, "tauri-toolchain-isolated-home-"),
    TEST_HOME: originalHome,
    TEST_CARGO_HOME: "",
  });

  assertFakeToolchainUsed(t, result, binDir);
  assert.match(result.stderr, /tauri-toolchain/);
});

test("已配置且含空格的 CARGO_HOME 优先于原始 home", (t) => {
  const emptyPath = tempDir(t, "tauri-toolchain-empty-path-");
  const originalHome = tempDir(t, "tauri-toolchain-original-home-");
  const configuredHome = path.join(tempDir(t, "tauri-toolchain-cargo-home-"), "cargo home");
  const configuredBin = path.join(configuredHome, "bin");
  writeToolchain(t, configuredBin);
  writeToolchain(t, path.join(originalHome, ".cargo/bin"));

  const result = runWithHelper(ensureBody(), {
    PATH: emptyPath,
    HOME: tempDir(t, "tauri-toolchain-isolated-home-"),
    CARGO_HOME: configuredHome,
    TEST_HOME: originalHome,
    TEST_CARGO_HOME: configuredHome,
  });

  assertFakeToolchainUsed(t, result, configuredBin);
  assert.ok(parseOutput(result.stdout).path.startsWith(`${configuredBin}:`));
});

test("CARGO_HOME 不完整时回退到原始用户 home", (t) => {
  const emptyPath = tempDir(t, "tauri-toolchain-empty-path-");
  const originalHome = tempDir(t, "tauri-toolchain-original-home-");
  const configuredHome = tempDir(t, "tauri-toolchain-cargo-home-");
  writeTool(t, path.join(configuredHome, "bin"), "cargo");
  const homeBin = path.join(originalHome, ".cargo/bin");
  writeToolchain(t, homeBin);

  const result = runWithHelper(ensureBody(), {
    PATH: emptyPath,
    HOME: tempDir(t, "tauri-toolchain-isolated-home-"),
    CARGO_HOME: configuredHome,
    TEST_HOME: originalHome,
    TEST_CARGO_HOME: configuredHome,
  });

  assertFakeToolchainUsed(t, result, homeBin);
});

test("现有 PATH 中可用的 cargo/rustc 不被替换", (t) => {
  const pathBin = tempDir(t, "tauri-toolchain-path-bin-");
  const fallbackHome = tempDir(t, "tauri-toolchain-fallback-home-");
  writeToolchain(t, pathBin);
  writeToolchain(t, path.join(fallbackHome, ".cargo/bin"));
  const originalPath = pathBin;

  const result = runWithHelper(ensureBody(), {
    PATH: originalPath,
    HOME: tempDir(t, "tauri-toolchain-isolated-home-"),
    TEST_HOME: fallbackHome,
    TEST_CARGO_HOME: "",
  });

  assert.equal(result.status, 0, result.stderr);
  const output = parseOutput(result.stdout);
  assert.equal(output.cargo, path.join(pathBin, "cargo"));
  assert.equal(output.rustc, path.join(pathBin, "rustc"));
  assert.equal(output.path, originalPath);
});

test("隔离 HOME 不被当作 Rust 工具链根", (t) => {
  const emptyPath = tempDir(t, "tauri-toolchain-empty-path-");
  const isolatedHome = tempDir(t, "tauri-toolchain-isolated-home-");
  writeToolchain(t, path.join(isolatedHome, ".cargo/bin"));
  const originalHome = tempDir(t, "tauri-toolchain-original-home-");

  const result = runWithHelper(
    ['if tauri_toolchain_ensure "${TEST_HOME:-}" "${TEST_CARGO_HOME:-}"; then exit 0; fi', 'printf "path=%s\\n" "$PATH"', "exit 1"].join("\n"),
    {
      PATH: emptyPath,
      HOME: isolatedHome,
      TEST_HOME: originalHome,
      TEST_CARGO_HOME: "",
    },
  );

  assert.equal(result.status, 1, result.stderr);
  assert.equal(parseOutput(result.stdout).path, emptyPath);
  assert.match(result.stderr, /cargo/);
  assert.match(result.stderr, /rustc/);
});

test("cargo/rustc 都缺失时清楚失败且不改 PATH", (t) => {
  const emptyPath = tempDir(t, "tauri-toolchain-empty-path-");
  const originalHome = tempDir(t, "tauri-toolchain-original-home-");
  const configuredHome = tempDir(t, "tauri-toolchain-cargo-home-");

  const result = runWithHelper(
    ['if tauri_toolchain_ensure "${TEST_HOME:-}" "${TEST_CARGO_HOME:-}"; then exit 0; fi', 'printf "path=%s\\n" "$PATH"', "exit 1"].join("\n"),
    {
      PATH: emptyPath,
      HOME: tempDir(t, "tauri-toolchain-isolated-home-"),
      CARGO_HOME: configuredHome,
      TEST_HOME: originalHome,
      TEST_CARGO_HOME: configuredHome,
    },
  );

  assert.equal(result.status, 1, result.stderr);
  assert.equal(parseOutput(result.stdout).path, emptyPath);
  assert.match(result.stderr, /未找到可用的 Rust 工具链/);
  assert.match(result.stderr, /cargo/);
  assert.match(result.stderr, /rustc/);
});

test("原始 home 与 CARGO_HOME 都为空时仍清楚失败（bash 3.2 空数组）", (t) => {
  const emptyPath = tempDir(t, "tauri-toolchain-empty-path-");

  const result = runWithHelper(
    ['if tauri_toolchain_ensure "" ""; then exit 0; fi', 'printf "path=%s\\n" "$PATH"', "exit 1"].join("\n"),
    {
      PATH: emptyPath,
      HOME: tempDir(t, "tauri-toolchain-isolated-home-"),
      TEST_HOME: "",
      TEST_CARGO_HOME: "",
    },
  );

  assert.equal(result.status, 1, result.stderr);
  assert.equal(parseOutput(result.stdout).path, emptyPath);
  assert.match(result.stderr, /未找到可用的 Rust 工具链/);
});

test("Tauri runner 在成本步骤前预检，dev/build 两入口共用同一 helper", () => {
  const source = fs.readFileSync(RUNNER, "utf8");
  assert.match(source, /source "\$PROJECT_ROOT\/scripts\/lib\/tauri_toolchain\.sh"/);

  const start = source.indexOf("start_tauri_app() {");
  const end = source.indexOf("\nnative_action_description() {", start);
  assert.ok(start >= 0 && end > start, "缺少 start_tauri_app 函数");
  const startTauriApp = source.slice(start, end);
  const startEnsure = startTauriApp.indexOf("tauri_toolchain_ensure");
  const devCommand = startTauriApp.indexOf("pnpm tauri dev");
  const buildCommand = startTauriApp.indexOf("pnpm tauri build");
  assert.ok(startEnsure >= 0, "start_tauri_app 必须复用 tauri_toolchain_ensure");
  assert.ok(startEnsure < devCommand, "tauri dev 入口前必须完成工具链定位");
  assert.ok(startEnsure < buildCommand, "tauri build 入口前必须完成工具链定位");

  const preflight = source.indexOf("tauri_toolchain_ensure");
  const artifactDir = source.indexOf('ARTIFACT_DIR="$PROJECT_ROOT');
  const cleanupStart = source.indexOf("cleanup() {");
  const trapInstall = source.indexOf("trap cleanup EXIT");
  const dbReset = source.indexOf("else\n  reset_test_db\nfi");
  const seedRun = source.indexOf('mix run "$SEED_SCRIPT"');
  const phoenixStart = source.indexOf("mix run --no-start --no-halt scripts/slice_verify_server.exs");
  assert.ok(preflight >= 0, "主流程缺少工具链预检");
  assert.ok(preflight < artifactDir, "工具链预检必须早于 artifact 目录创建/清理");
  assert.ok(preflight < cleanupStart, "工具链预检必须早于 cleanup 定义/安装");
  assert.ok(preflight < trapInstall, "预检失败不得触发 cleanup 的 test DB 重置");
  assert.ok(preflight < dbReset, "工具链预检必须早于 test DB 重置");
  assert.ok(preflight < seedRun, "工具链预检必须早于 seed");
  assert.ok(preflight < phoenixStart, "工具链预检必须早于 Phoenix 启动");
});

test("frontend_audit 非 quick 构建复用同一 helper，quick 不探测构建工具", () => {
  const source = fs.readFileSync(AUDIT, "utf8");
  assert.match(source, /source "\$PROJECT_ROOT\/scripts\/lib\/tauri_toolchain\.sh"/);

  const quickBranchStart = source.indexOf('if [[ "$QUICK_MODE" == true ]]');
  const elseBranch = source.indexOf("\nelse\n", quickBranchStart);
  assert.ok(quickBranchStart >= 0 && elseBranch > quickBranchStart, "缺少 quick/完整构建分支");
  assert.doesNotMatch(source.slice(quickBranchStart, elseBranch), /tauri_toolchain_ensure/);
  assert.match(source.slice(elseBranch), /tauri_toolchain_ensure/);
  assert.ok(source.indexOf("tauri_toolchain_ensure") < source.indexOf("npx tauri build"));
});
