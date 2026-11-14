// B27 §9 CP3 证据核验器正反例：memory 供给/观察回流/M2 描述性“已采纳”/生命周期。
// 真实驱动 JSONL/app-log/4 表 SQLite 模板由
// `lib/native_ui/fixtures/native_b27_request_source_io_fixture.mjs` 在 run 内物化一次
// （只读共享）；写 summary 的正例与改生命周期的反例取 `withWorkingCopy` 隔离副本。
// 目录归 `openTestRunScope` 的 work area，退出时由 run scope 统一回收。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { materializeFixture, openTestRunScope, withWorkingCopy } from "./lib/test_env.mjs";
import { lifecycleAfterLoaded } from "./lib/native_ui/fixtures/native_b27_request_source_facts.mjs";
import {
  B27_LIFECYCLE_AFTER,
  b27RequestSourceFixtureSpec,
} from "./lib/native_ui/fixtures/native_b27_request_source_io_fixture.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/native_b27_request_source_evidence.mjs");

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function fixture() {
  return materializeFixture(b27RequestSourceFixtureSpec(), { scope: runScope });
}

function verify(dir, options = {}) {
  return execFileSync(process.execPath, [SCRIPT, "verify", dir], {
    encoding: "utf8",
    env: runScope.env(),
    ...options,
  });
}

test("机制证据齐全 + 描述性“已采纳”不被误判 → pass", () => {
  withWorkingCopy(fixture(), (copy) => {
    const output = verify(copy.dir);
    assert.match(output, /status=pass/u);
    const summary = JSON.parse(fs.readFileSync(path.join(copy.dir, "summary.json"), "utf8"));
    assert.equal(summary.status, "pass");
    assert.deepEqual(summary.m1_request_indexes, [0]);
    assert.ok(summary.m1_recall_request_indexes.includes(1));
  });
});

test("生命周期未卸载 → fail 退出码非 0", () => {
  withWorkingCopy(fixture(), (copy) => {
    fs.writeFileSync(
      path.join(copy.dir, B27_LIFECYCLE_AFTER),
      JSON.stringify(lifecycleAfterLoaded()),
    );
    assert.throws(() => verify(copy.dir, { stdio: "pipe" }), /Command failed/u);
  });
});
