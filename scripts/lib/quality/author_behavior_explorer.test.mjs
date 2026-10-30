// B70 CP2：状态探索器正反例（种子复现/非固定顺序/转移覆盖/失败缩化保类别）。
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus } from "./author_behavior.mjs";
import {
  buildExplorationPlan,
  buildLifecycleActionPlan,
  createSeededRandom,
  failureFingerprint,
  shrinkFailureTrace,
  summarizeExploration,
} from "./author_behavior_explorer.mjs";

const ROOT = DEFAULT_PROJECT_ROOT;
const CORPUS = loadAuthorBehaviorCorpus(ROOT);
const POOL = [
  "C-F1-001",
  "C-F1-002",
  "C-F2-002",
  "C-F3-001",
  "C-F3-003",
  "C-F3-005",
];

function plan(seed, pool = POOL) {
  return buildExplorationPlan(CORPUS, { seed, poolCaseIds: pool });
}

function passResults(planValue) {
  return planValue.steps.map((step) => ({
    step_index: step.index,
    status: "pass",
    reasons: [],
    violations: [],
    observed: { action: step.action === "send" ? "reply" : null },
  }));
}

test("同 seed 计划完全可复现，不同 seed 顺序不同（非固定操作顺序）", () => {
  const first = plan(20261030);
  const second = plan(20261030);
  const other = plan(7);
  assert.deepEqual(first.steps, second.steps);
  assert.equal(first.plan_hash, second.plan_hash);
  assert.notEqual(first.plan_hash, other.plan_hash);
  assert.notDeepEqual(
    first.steps.map((step) => `${step.action}:${step.case_id ?? step.state_id}`),
    other.steps.map((step) => `${step.action}:${step.case_id ?? step.state_id}`),
  );
});

test("计划覆盖 pool 全部 case 且只发送一次，状态切换步骤合法", () => {
  const value = plan(99);
  const sends = value.steps.filter((step) => step.action === "send");
  assert.deepEqual(sends.map((step) => step.case_id).sort(), [...POOL].sort());
  for (const step of value.steps) {
    if (step.action === "switch_work") {
      assert.ok(step.work_title.startsWith("B70 "), step.work_title);
      assert.ok(["S1-partial-multichapter", "S2-empty-skeleton", "S3-pending-candidate-context"].includes(step.state_id));
    }
  }
  assert.match(value.plan_hash, /^[0-9a-f]{64}$/u);
});

test("seeded PRNG 跨调用稳定且值域 [0,1)", () => {
  const randomA = createSeededRandom(42);
  const randomB = createSeededRandom(42);
  const valuesA = Array.from({ length: 5 }, () => randomA());
  const valuesB = Array.from({ length: 5 }, () => randomB());
  assert.deepEqual(valuesA, valuesB);
  assert.ok(valuesA.every((value) => value >= 0 && value < 1));
});

test("状态/转移覆盖与逐步失败统计；未知不放行", () => {
  const value = plan(5);
  const results = passResults(value);
  const summary = summarizeExploration({ plan: value, stepResults: results, corpusSha: "sha-x" });
  assert.equal(summary.status, "pass");
  assert.equal(summary.steps, value.steps.length);
  assert.equal(summary.coverage.send_actions, POOL.length);
  assert.ok(summary.coverage.states_visited.length >= 2);
  assert.ok(summary.coverage.transition_keys.length >= 4);
  assert.equal(summary.violations.length, 0);

  const failedResults = results.map((result) =>
    result.step_index === value.steps.findIndex((step) => step.action === "send")
      ? { ...result, status: "unknown", reasons: ["evidence_insufficient"] }
      : result,
  );
  const failed = summarizeExploration({ plan: value, stepResults: failedResults, corpusSha: "sha-x" });
  assert.equal(failed.status, "fail");
  assert.equal(failed.failures.length, 1);
});

test("失败缩化：保留同一违规类别的最小动作序列，不冒充其他失败", () => {
  const value = plan(11);
  const sendSteps = value.steps.filter((step) => step.action === "send");
  const failingStep = sendSteps[2];
  const results = passResults(value).map((result) =>
    result.step_index === failingStep.index
      ? { ...result, status: "fail", reasons: ["wrong_object_operation"], violations: [{ behavior: "wrong_object_operation", invariant: "G2", detail: "x" }] }
      : result,
  );

  const shrunk = shrinkFailureTrace({ plan: value, stepResults: results, violationCode: "wrong_object_operation" });
  assert.ok(shrunk);
  assert.equal(shrunk.preserved, "wrong_object_operation");
  assert.equal(shrunk.minimal_steps.length, 1);
  assert.equal(shrunk.minimal_steps[0].index, failingStep.index);
  assert.ok(shrunk.removed > 0);

  // 另一个违规类别不能冒充原失败。
  assert.equal(shrinkFailureTrace({ plan: value, stepResults: results, violationCode: "false_completion_claim" }), null);
});

test("B73 生命周期行动计划可复现，包含真实作者动作并支持 seed 变化", () => {
  const first = buildLifecycleActionPlan(CORPUS, { seed: 42 });
  const second = buildLifecycleActionPlan(CORPUS, { seed: 42 });
  const other = buildLifecycleActionPlan(CORPUS, { seed: 7 });
  assert.deepEqual(first, second);
  assert.notEqual(first.plan_hash, other.plan_hash);
  assert.ok([1, 2].includes(first.cancel_edits));
  assert.ok([
    ["cross_work", "offline_reopen"],
    ["offline_reopen", "cross_work"],
  ].some((order) => JSON.stringify(order) === JSON.stringify(first.recovery_order)));
  const sends = first.steps.filter((step) => step.action === "send");
  assert.deepEqual(sends.map((step) => step.case_id), [
    "C-F2-E01", "C-F3-E01", "C-F3-E02", "C-F3-E03", "C-F3-E04",
    "C-F3-E05", "C-F3-E06", "C-F3-E07", "C-F3-E08", "C-F3-E09",
  ]);
  for (const action of [
    "double_accept", "reload_multi_candidate", "cross_work", "offline_reopen",
    "cancel_edit", "open_stale_editor", "repeat_pending_registration",
    "submit_stale_edit", "edit_then_accept", "repeat_accepted_registration",
  ]) {
    assert.ok(first.steps.some((step) => step.action === action), `missing action ${action}`);
  }

  const results = first.steps.map((step) => ({
    step_index: step.index,
    status: "pass",
    reasons: [],
    violations: [],
    observed: { action: step.action === "send" ? "reply" : null },
  }));
  const summary = summarizeExploration({ plan: first, stepResults: results, corpusSha: CORPUS.corpus_sha });
  assert.equal(summary.status, "pass");
  assert.equal(summary.steps, first.steps.length);
  assert.ok(summary.coverage.action_counts.double_accept === 1);
  assert.ok(summary.coverage.action_counts.cancel_edit === first.cancel_edits);
});

test("失败指纹稳定且随类别/语料/计划变化", () => {
  const base = { violationCode: "wrong_object_operation", corpusSha: "sha-x", planHash: "a".repeat(64) };
  assert.equal(failureFingerprint(base), failureFingerprint({ ...base }));
  assert.notEqual(failureFingerprint(base), failureFingerprint({ ...base, violationCode: "false_completion_claim" }));
  assert.notEqual(failureFingerprint(base), failureFingerprint({ ...base, corpusSha: "sha-y" }));
});
