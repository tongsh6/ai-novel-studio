// B70 CP1：离线确定性生成器正反例（生成候选可被 validator 接受；非法候选被拒绝）。
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus, validateAuthorBehaviorCorpus } from "./author_behavior.mjs";
import { GENERATOR_VERSION, generateCaseCandidates } from "./author_behavior_generator.mjs";

const ROOT = DEFAULT_PROJECT_ROOT;
const CORPUS = loadAuthorBehaviorCorpus(ROOT);

function corpusWithCandidates(candidates) {
  const clone = structuredClone(CORPUS);
  clone.cases.cases.push(...candidates);
  return clone;
}

test("生成候选带 generated_frozen provenance 且可被 validator 接受", () => {
  const result = generateCaseCandidates(CORPUS);
  assert.equal(result.generator_version, GENERATOR_VERSION);
  assert.ok(result.candidates.length >= 6, `candidates=${result.candidates.length}`);

  for (const candidate of result.candidates) {
    assert.equal(candidate.provenance.kind, "generated_frozen");
    assert.equal(candidate.provenance.generator, GENERATOR_VERSION);
    assert.ok(candidate.provenance.source_refs.length >= 2);
    assert.notEqual(candidate.split, "holdout");
    assert.equal(candidate.expression_frozen, true);
  }

  const validation = validateAuthorBehaviorCorpus(corpusWithCandidates(result.candidates));
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("生成器不修改输入语料，且候选 id 不冲突", () => {
  const before = JSON.stringify(CORPUS);
  const result = generateCaseCandidates(CORPUS);
  assert.equal(JSON.stringify(CORPUS), before);
  const ids = result.candidates.map((candidate) => candidate.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("非法生成候选（缺 generator/source_refs）被 validator 拒绝", () => {
  const result = generateCaseCandidates(CORPUS);
  const bad = structuredClone(result.candidates[0]);
  delete bad.provenance.generator;
  const validation = validateAuthorBehaviorCorpus(corpusWithCandidates([bad]));
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.code === "case_generated_provenance_incomplete"));
});
