// R01 薄 CLI 的真实子进程 IO 边界：用真实 node 子进程验证 batch 消费的数据读取路径
// （manifest 是 JSON 而不是可 require 的 JS 模块），并覆盖相对路径、含空格路径、
// runtime facts 校验与 usage 打印。测试不启动 runner、不调用模型。
//
// 合成 native manifest 由 `../lib/native_ui/fixtures/request_cost_cli_reference_io_fixture.mjs`
// 在 run 内物化一次（只读共享）；需要改 manifest 的反例经 `withWorkingCopy` 取隔离副本。
// 纯 fail-closed/退出码判定留在邻接 `request_cost_baseline_cli.test.mjs`。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  RUNTIME_PROFILE_ID,
  expectedRuntimeFacts,
  runtimeEnv,
} from "../lib/native_ui/request_cost_runtime_recipe.mjs";
import { materializeFixture, openTestRunScope, withWorkingCopy } from "../lib/test_env.mjs";
import { nativeManifest } from "../lib/native_ui/fixtures/request_cost_manifest_fixture.mjs";
import { nativeManifestFixtureSpec } from "../lib/native_ui/fixtures/request_cost_cli_reference_io_fixture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BASELINE = path.join(HERE, "request_cost_baseline.mjs");

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function fixture() {
  return materializeFixture(nativeManifestFixtureSpec(), { scope: runScope });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [BASELINE, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}

function parseEnv(stdout) {
  return Object.fromEntries(
    stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

test("真实子进程按数据 JSON 读取相对 manifest 字段（不再 require 成 JS 模块）", () => {
  const template = fixture();
  const file = template.files.get("manifest.json");
  const relative = path.relative(ROOT, file);

  const field = run(["manifest-field", relative, "seed.work_id"]);
  assert.equal(field.status, 0, field.stderr);
  assert.equal(field.stdout, "work-1");

  // 路径含空格、字段值含空格都必须原样保留（shell 不得拆词/eval）。
  withWorkingCopy(template, (copy) => {
    const spacedFile = path.join(copy.dir, "path with spaces", "manifest with spaces.json");
    writeJson(spacedFile, {
      ...nativeManifest(),
      frozen: true,
      id: "fixture with spaces",
    });
    const title = run(["manifest-field", spacedFile, "id"]);
    assert.equal(title.status, 0, title.stderr);
    assert.equal(title.stdout, "fixture with spaces");
  });

  const missing = run(["manifest-field", relative, "seed.not_there"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /不存在或不是标量/);
});

test("真实子进程 runtime-env 只输出数据行，值与 recipe 单点定义一致", () => {
  const template = fixture();
  const file = template.files.get("manifest.json");
  const result = run(["runtime-env", path.relative(ROOT, file)]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseEnv(result.stdout), runtimeEnv());

  const byProfile = run(["runtime-env", "--profile", RUNTIME_PROFILE_ID]);
  assert.equal(byProfile.status, 0, byProfile.stderr);
  assert.deepEqual(parseEnv(byProfile.stdout), runtimeEnv());

  const unknown = run(["runtime-env", "--profile", "missing"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /未知 runtime profile/);
});

test("真实子进程 verify-runtime-facts 拒绝缺失/不一致/未脱敏事实", (t) => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "b87-r01-facts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const expected = expectedRuntimeFacts(RUNTIME_PROFILE_ID);
  const good = {
    schema: "b87-r01-runtime-facts/v1",
    captured_at: "2026-11-13T00:00:00.000Z",
    pid: "1",
    ...expected,
    provider: { ...expected.provider, endpoint: "http://127.0.0.1:8000/v1" },
  };
  const goodFile = path.join(dir, "good.json");
  writeJson(goodFile, good);
  const ok = run(["verify-runtime-facts", goodFile]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /"ok":true/);

  const badFile = path.join(dir, "bad.json");
  writeJson(badFile, { ...good, context_pressure: { ...good.context_pressure, window: 32_000 } });
  const bad = run(["verify-runtime-facts", badFile]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /window 不符/);

  const unsafeFile = path.join(dir, "unsafe.json");
  writeJson(unsafeFile, {
    ...good,
    provider: { ...good.provider, endpoint: "http://user:pass@host/v1?token=1" },
  });
  const unsafe = run(["verify-runtime-facts", unsafeFile]);
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /脱敏/);
});

test("缺参命令打印各自 usage，不把参数守卫退化成下游 TypeError/静默成功", () => {
  const cases = [
    [["rebuild-snapshot"], /usage: rebuild-snapshot/],
    [["restore-snapshot"], /usage: restore-snapshot/],
    [["restore-snapshot", ROOT], /usage: restore-snapshot/],
    [["preflight"], /usage: preflight/],
    [["preflight", "manifest.json"], /usage: preflight/],
    [["preflight", "manifest.json", "--snapshot", "snap"], /usage: preflight/],
    [["manifest-field"], /usage: manifest-field/],
    [["manifest-field", "manifest.json"], /usage: manifest-field/],
    [["runtime-env"], /usage: runtime-env/],
    [["analyze"], /usage: analyze/],
    [["analyze", "manifest.json"], /usage: analyze/],
    [["prepare"], /usage: prepare/],
    [["prepare", "manifest.json"], /usage: prepare/],
    [["prepare", "manifest.json", "batch"], /usage: prepare/],
    [["capture"], /usage: capture/],
    [["capture", ROOT], /usage: capture/],
    [["verify"], /usage: verify/],
    [["verify-runtime-facts"], /usage: verify-runtime-facts/],
  ];
  for (const [args, pattern] of cases) {
    const result = run(args);
    assert.equal(result.status, 1, `${JSON.stringify(args)}: ${result.stderr}`);
    assert.match(result.stderr, pattern, JSON.stringify(args));
  }
});

test("manifest-field 拒绝含换行的标量，不把换行写进 stdout", () => {
  const template = fixture();
  withWorkingCopy(template, (copy) => {
    const file = copy.files.get("manifest.json");
    writeJson(file, { ...nativeManifest(), frozen: true, id: "line1\nline2" });
    const result = run(["manifest-field", file, "id"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /不能含换行/);
  });
});

test("runtime-env 缺 runtime.profile 由 manifest 校验明确失败", () => {
  const template = fixture();
  withWorkingCopy(template, (copy) => {
    const file = copy.files.get("manifest.json");
    writeJson(file, { ...nativeManifest(), frozen: true, runtime: {} });
    const result = run(["runtime-env", file]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /manifest\.runtime\.profile 不能为空/);
  });
});
