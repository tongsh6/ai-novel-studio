// B71 采集边界的纯判定：作者可见场景选择只取决于冻结场景 id，与批次目录/DB
// 无关。真实 DB/文件批次在邻接 `authoring_capture_evidence_io.test.mjs`，本文件
// 不建目录/DB、不启动子进程。
import assert from "node:assert/strict";
import test from "node:test";
import { authorVisibleScenario } from "./authoring_capture_evidence.mjs";

test("作者可见场景判定：G2/G3 共用冻结目标契约，普通 live 不派生", () => {
  assert.equal(authorVisibleScenario("b82-g2"), "candidate");
  assert.equal(authorVisibleScenario("b82-g3"), "read_only");
  assert.equal(authorVisibleScenario("b71-first-consumer"), null);
  assert.equal(authorVisibleScenario(null), null);
});
