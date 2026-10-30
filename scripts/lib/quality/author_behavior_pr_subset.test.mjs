import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus } from "./author_behavior.mjs";
import { selectPrSubset } from "./author_behavior_pr_subset.mjs";

const CORPUS = loadAuthorBehaviorCorpus(DEFAULT_PROJECT_ROOT);

test("仅文档变更 → 不跑页面语义子集", () => {
  const result = selectPrSubset({ paths: ["docs/design/acceptance/x.md", "tasks/NEXT.md"], corpus: CORPUS });
  assert.equal(result.selected_cases.length, 0);
  assert.equal(result.tier, "none");
  assert.equal(result.conservative_all, false);
});

test("判断核心变更 → 全量语义子集（含 5 目标族）", () => {
  const result = selectPrSubset({ paths: ["apps/novel_application/lib/novel_application/judgment_protocol.ex"], corpus: CORPUS });
  assert.equal(result.selected_cases.length, CORPUS.cases.cases.length);
  assert.equal(result.selected_targets.length, 5);
  assert.equal(result.tier, "nightly");
});

test("未知路径 → 保守全选并记录 unmapped", () => {
  const result = selectPrSubset({ paths: ["some/unknown/path.ts"], corpus: CORPUS });
  assert.equal(result.selected_cases.length, CORPUS.cases.cases.length);
  assert.deepEqual(result.unmapped_paths, ["some/unknown/path.ts"]);
  assert.equal(result.conservative_all, true);
});

test("corpus 资产变更 → 全选；空变更 → none", () => {
  const corpusChange = selectPrSubset({ paths: ["quality/acceptance/author-behavior/cases.yml"], corpus: CORPUS });
  assert.equal(corpusChange.selected_cases.length, CORPUS.cases.cases.length);
  const none = selectPrSubset({ paths: [], corpus: CORPUS });
  assert.equal(none.tier, "none");
  assert.equal(none.selected_cases.length, 0);
});
