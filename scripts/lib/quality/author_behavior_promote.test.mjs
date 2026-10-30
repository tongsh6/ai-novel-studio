import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus, validateAuthorBehaviorCorpus } from "./author_behavior.mjs";
import { promoteFailureToRegression } from "./author_behavior_promote.mjs";

const CORPUS = loadAuthorBehaviorCorpus(DEFAULT_PROJECT_ROOT);
const SEND_CASE = CORPUS.cases.cases.find((testCase) => testCase.split === "dev");

function trace(overrides = {}) {
  return {
    plan_hash: "a".repeat(64),
    dedupe_fingerprint: "f".repeat(64),
    shrink: { preserved: "wrong_object_operation", minimal_steps: [] },
    exploration: {
      failures: [{ step_index: 1, case_id: SEND_CASE.id, status: "fail", reasons: ["wrong_object_operation"] }],
      violations: [{ step_index: 1, case_id: SEND_CASE.id, behavior: "wrong_object_operation", invariant: "G2" }],
      ...overrides,
    },
  };
}

test("硬违规失败可生成新 regression 候选且 validator 接受", () => {
  const result = promoteFailureToRegression({ failureTrace: trace(), corpus: CORPUS });
  assert.equal(result.candidate.split, "regression");
  assert.notEqual(result.candidate.id, SEND_CASE.id);
  assert.equal(result.candidate.target_id, SEND_CASE.target_id);
  assert.ok(result.candidate.provenance.source_refs.some((ref) => ref.startsWith("failure:")));
  const clone = structuredClone(CORPUS);
  clone.cases.cases.push(result.candidate);
  const validation = validateAuthorBehaviorCorpus(clone);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("无硬违规/重复指纹被拒绝（fixture 不兼容不得转回归）", () => {
  assert.throws(() => promoteFailureToRegression({ failureTrace: trace({ violations: [] }), corpus: CORPUS }), /no_invariant_violation/u);
  assert.throws(
    () => promoteFailureToRegression({ failureTrace: trace(), corpus: CORPUS, existingFingerprints: ["f".repeat(64)] }),
    /已登记/u,
  );
});
