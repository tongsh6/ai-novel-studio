// scripts/lib/process_tree.sh 的返回契约回归：正常回收、信号失败/目标仍存活不得
// 报告成功、不存在/空 PID 幂等、子孙树一并回收。真实 bash/sleep 子进程，不用
// 打印 PASS 自证；信号失败用本 shell 的函数覆盖，干净进程用 builtin kill 回收。
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER = path.join(ROOT, "scripts/lib/process_tree.sh");

function runBash(script) {
  return spawnSync("/bin/bash", ["-c", script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20_000,
  });
}

function parseValues(stdout) {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=")];
      }),
  );
}

test("process_tree：正常终止返回 0，目标已不存在", () => {
  const result = runBash(
    [
      `source "${HELPER}"`,
      "sleep 30 & pid=$!",
      'kill_process_tree "$pid" 1; echo "helper=$?"',
      'kill -0 "$pid" 2>/dev/null && echo "alive=yes" || echo "alive=no"',
      'builtin kill -9 "$pid" 2>/dev/null || true',
    ].join("\n"),
  );
  assert.equal(result.status, 0, result.stderr);
  const values = parseValues(result.stdout);
  assert.equal(values.helper, "0");
  assert.equal(values.alive, "no");
});

test("process_tree：信号被拒绝且目标仍存活时不得返回成功", () => {
  const result = runBash(
    [
      `source "${HELPER}"`,
      "sleep 30 & pid=$!",
      "kill() {",
      '  case "$1" in',
      '    -0) builtin kill "$@" ;;',
      '    -TERM|-KILL|-9|-15) return 1 ;;',
      '    *) builtin kill "$@" ;;',
      "  esac",
      "}",
      'kill_process_tree "$pid" 0; echo "helper=$?"',
      'builtin kill -0 "$pid" 2>/dev/null && echo "alive=yes" || echo "alive=no"',
      'builtin kill -9 "$pid" 2>/dev/null || true',
    ].join("\n"),
  );
  assert.equal(result.status, 0, result.stderr);
  const values = parseValues(result.stdout);
  assert.equal(values.helper, "1");
  assert.equal(values.alive, "yes");
});

test("process_tree：不存在 PID 与空 PID 幂等返回 0", () => {
  const result = runBash(
    [
      `source "${HELPER}"`,
      'kill_process_tree 999999 0; echo "missing=$?"',
      'kill_process_tree "" 0; echo "empty=$?"',
    ].join("\n"),
  );
  assert.equal(result.status, 0, result.stderr);
  const values = parseValues(result.stdout);
  assert.equal(values.missing, "0");
  assert.equal(values.empty, "0");
});

test("process_tree：root 及其子进程树一并回收", () => {
  const result = runBash(
    [
      `source "${HELPER}"`,
      "bash -c 'sleep 30 & wait' & root=$!",
      "sleep 0.3",
      'kill_process_tree "$root" 1; echo "helper=$?"',
      'kill -0 "$root" 2>/dev/null && echo "root_alive=yes" || echo "root_alive=no"',
      'pgrep -P "$root" 2>/dev/null | head -1 || true',
    ].join("\n"),
  );
  assert.equal(result.status, 0, result.stderr);
  const values = parseValues(result.stdout);
  assert.equal(values.helper, "0");
  assert.equal(values.root_alive, "no");
});
