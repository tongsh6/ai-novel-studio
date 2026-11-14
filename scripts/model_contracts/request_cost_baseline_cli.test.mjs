// R01 薄 CLI 纯规则：未知/缺参 fail closed 与退出码契约；不建目录、不启动子进程。
// 真实 node 子进程读取 manifest/runtime facts、usage 打印与路径含空格等 IO 边界在邻接
// `request_cost_baseline_cli_io.test.mjs`。
import assert from "node:assert/strict";
import test from "node:test";
import { exitCodeFor, main } from "./request_cost_baseline.mjs";
import { BEFORE_SCHEMA } from "../lib/native_ui/request_cost_capture.mjs";
import { NATIVE_REPORT_SCHEMA } from "../lib/native_ui/request_cost_batch_evidence.mjs";

test("未知/缺参命令统一 fail closed，不启动外部进程", () => {
  const originalExit = process.exitCode;
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const argv of [[], ["unknown"], ["analyze"], ["prepare"], ["capture"], ["verify"], ["snapshot"], ["rebuild-snapshot"], ["restore-snapshot"], ["preflight"], ["manifest-field"], ["runtime-env"], ["verify-runtime-facts"]]) {
      process.exitCode = 0;
      assert.doesNotThrow(() => main(argv));
      assert.equal(process.exitCode, 1, JSON.stringify(argv));
    }
  } finally {
    console.error = originalError;
    process.exitCode = originalExit;
  }
});

test("CLI 退出码契约：history pass=0/其余=1；native pass=0/partial=65/fail=1", () => {
  assert.equal(exitCodeFor({ schema: BEFORE_SCHEMA, status: "pass" }), 0);
  assert.equal(exitCodeFor({ schema: BEFORE_SCHEMA, status: "fail" }), 1);
  assert.equal(exitCodeFor({ schema: BEFORE_SCHEMA, status: "partial" }), 1);
  assert.equal(exitCodeFor({ schema: NATIVE_REPORT_SCHEMA, status: "pass" }), 0);
  assert.equal(exitCodeFor({ schema: NATIVE_REPORT_SCHEMA, status: "partial" }), 65);
  assert.equal(exitCodeFor({ schema: NATIVE_REPORT_SCHEMA, status: "fail" }), 1);
  assert.equal(exitCodeFor({ schema: "something-else", status: "fail" }), 0);
  assert.equal(exitCodeFor(null), 0);
});
