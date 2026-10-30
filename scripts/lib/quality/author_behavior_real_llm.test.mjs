import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus } from "./author_behavior.mjs";
import { buildRealLlmPreregistration } from "./author_behavior_real_llm.mjs";

const CORPUS = loadAuthorBehaviorCorpus(DEFAULT_PROJECT_ROOT);

test("预注册只含 holdout case，且要求单槽/卸载/不代签文学质量", () => {
  const prereg = buildRealLlmPreregistration({ corpus: CORPUS, evidenceDir: "artifacts/x", gitHead: "abc" });
  assert.equal(prereg.schema, "author-behavior-real-llm-preregistration/v1");
  assert.equal(prereg.scope.holdout_only, true);
  assert.ok(prereg.scope.case_ids.length >= 1);
  for (const testCase of prereg.scope.cases) {
    assert.equal(CORPUS.cases.cases.find((entry) => entry.id === testCase.case_id).split, "holdout");
  }
  assert.equal(prereg.model_requirements.single_slot, true);
  assert.ok(prereg.model_requirements.cleanup.lmstudio.some((command) => command.includes("unload")));
  assert.ok(prereg.criteria.literary_quality.includes("I10"));
  assert.equal(prereg.status, "blocked_pending_authorization");
});

test("无 holdout 或 holdout 表达与 dev 重复时拒绝预注册", () => {
  const noHoldout = structuredClone(CORPUS);
  for (const testCase of noHoldout.cases.cases) testCase.split = "dev";
  assert.throws(() => buildRealLlmPreregistration({ corpus: noHoldout, evidenceDir: "x" }), /没有 holdout/u);

  const leaked = structuredClone(CORPUS);
  const devExpression = leaked.cases.cases.find((testCase) => testCase.split === "dev").expression;
  const holdoutCase = leaked.cases.cases.find((testCase) => testCase.split === "holdout");
  holdoutCase.expression = devExpression;
  assert.throws(() => buildRealLlmPreregistration({ corpus: leaked, evidenceDir: "x" }), /表达与 dev\/regression 重复/u);
});
