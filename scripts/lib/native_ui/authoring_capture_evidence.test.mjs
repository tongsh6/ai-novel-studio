// B71 采集边界的纯判定：作者可见场景选择只取决于冻结场景 id，与批次目录/DB
// 无关。真实 DB/文件批次在邻接 `authoring_capture_evidence_io.test.mjs`，本文件
// 不建目录/DB、不启动子进程。
import assert from "node:assert/strict";
import test from "node:test";
import { authorVisibleScenario } from "./authoring_capture_evidence.mjs";
import { validateAuthorInputs } from "./request_cost_manifest.mjs";

test("作者可见场景判定：G2/G3 共用冻结目标契约，普通 live 不派生", () => {
  assert.equal(authorVisibleScenario("b82-g2"), "candidate");
  assert.equal(authorVisibleScenario("b82-g3"), "read_only");
  assert.equal(authorVisibleScenario("b71-first-consumer"), null);
  assert.equal(authorVisibleScenario(null), null);
});

test("冻结作者输入可显式5条，默认20不变，义务检查不越界", () => {
  const input = {
    schema: "b87-author-inputs/v1", frozen: true,
    turns: Array.from({ length: 5 }, (_, index) => ({
      id: "control-" + index, text: "冻结原文" + index, sha256: "a".repeat(64),
      target: { id: "target-" + index, question: "保留原文", review_focus: ["身份与顺序"] },
      obligations: [],
    })),
  };
  assert.equal(validateAuthorInputs(input, { expectedCount: 5 }), input);
  assert.throws(() => validateAuthorInputs(input), /恰好20条/);
  for (const expectedCount of [0, -1, 1.5, NaN]) {
    assert.throws(() => validateAuthorInputs(input, { expectedCount }), /正整数/);
  }
  input.turns[4].obligations = [{ id: "unclosed", requirement: "待交付",
    review_at_turns: [5], forbidden_inferences: ["已交付"] }];
  validateAuthorInputs(input, { expectedCount: 5 });
  for (const outside of [4, 6]) {
    input.turns[4].obligations[0].review_at_turns = [outside];
    assert.throws(() => validateAuthorInputs(input, { expectedCount: 5 }), /义务检查轮次非法/);
  }
});
