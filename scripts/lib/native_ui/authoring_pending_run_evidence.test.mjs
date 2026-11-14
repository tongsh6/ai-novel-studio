// B71 pending 运行证据 I/O 边界：命名 checkpoint 读取与 capture 写入前校验。
// 不启动 GUI/Mix，不写产品路径；完整 DB/WS 链路由 native_b71_pending_test 回归。
//
// 每个反例需要独立的可写 config/checkpoint 目录，属于 case 级独立状态，不共享只读
// 模板；目录统一落在外层 run scope 的 work 区，由 scope 退出时回收，不再落系统
// TMPDIR 裸目录。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  capturePending,
  readPendingCheckpoint,
} from "./authoring_pending_run_evidence.mjs";
import { openTestRunScope } from "../test_env.mjs";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function tempDir() {
  return fs.mkdtempSync(path.join(runScope.workDir, "b71-pending-run-evidence-"));
}

function writeConfig(dir, value) {
  fs.writeFileSync(path.join(dir, "native-b71-config.json"), JSON.stringify(value));
}

test("readPendingCheckpoint 只按名称读取本批次 checkpoint，缺失显式失败", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "b71-start.json"), JSON.stringify({ checkpoint: "start", n: 1 }));
  assert.deepEqual(readPendingCheckpoint(dir, "start"), { checkpoint: "start", n: 1 });
  assert.throws(() => readPendingCheckpoint(dir, "missing"), /ENOENT/);
});

test("capturePending 在写 DB 前拒绝错 journey/未知 checkpoint/覆盖/跳步", () => {
  const wrongJourney = tempDir();
  writeConfig(wrongJourney, { journey: "other" });
  assert.throws(() => capturePending(wrongJourney, "start"), /pending capture 只属于/);

  const unknown = tempDir();
  writeConfig(unknown, { journey: "pending" });
  assert.throws(() => capturePending(unknown, "nope"), /未知 pending checkpoint/);

  const overwrite = tempDir();
  writeConfig(overwrite, { journey: "pending" });
  fs.writeFileSync(path.join(overwrite, "b71-start.json"), "{}");
  assert.throws(() => capturePending(overwrite, "start"), /不得覆盖/);

  const skip = tempDir();
  writeConfig(skip, { journey: "pending" });
  assert.throws(() => capturePending(skip, "after-source"), /必须在 start 之后登记/);
});
