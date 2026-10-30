// B70 CP1：oracle 评估器正反例（确定性判卷；负例必须能被抓到，unknown 不判 PASS）。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus, validateAuthorBehaviorCorpus, validateCoverageReport } from "./author_behavior.mjs";
import { evaluateCase, evaluateCorpus, buildCoverageReport } from "./author_behavior_oracle.mjs";


const ROOT = DEFAULT_PROJECT_ROOT;
const CLI = path.join(ROOT, "scripts/author_behavior_check.mjs");
const CORPUS = loadAuthorBehaviorCorpus(ROOT);
const CASES = CORPUS.cases.cases;

function allowedObservation(testCase) {
  const allowedActions = testCase.expected.allowed_actions;
  const action = allowedActions.includes("reply") ? "reply" : allowedActions[0];
  const effects = action === "execute" ? testCase.expected.allowed_effects.slice(0, 1) : [];
  return {
    action,
    capability: action === "execute" ? "world_building" : null,
    effects,
    canon_write_delta: {},
    adoption_receipts: 0,
    author_action: false,
    claims_completion: false,
    object_mismatch: false,
    duplicate_side_effect: false,
    supplied_status: "known",
    unknown_reason: null,
  };
}

function caseById(caseId) {
  const found = CASES.find((testCase) => testCase.id === caseId);
  assert.ok(found, caseId);
  return found;
}

test("全部 case 按允许结果集合可判 pass（正例）", () => {
  const observations = {
    cases: CASES.map((testCase) => ({ case_id: testCase.id, observed: allowedObservation(testCase) })),
  };
  const evaluation = evaluateCorpus(CORPUS, observations);
  assert.equal(evaluation.total, CASES.length);
  assert.equal(evaluation.counts.pass, CASES.length, JSON.stringify(evaluation.results.filter((r) => r.status !== "pass")));
  assert.equal(evaluation.counts.fail, 0);
  assert.equal(evaluation.counts.unknown, 0);
});

test("负例：disallowed action 被抓", () => {
  const testCase = caseById("C-F3-002");
  const observation = { ...allowedObservation(testCase), action: "adopt" };
  const result = evaluateCase(CORPUS, testCase, { observed: observation });
  assert.equal(result.status, "fail");
  assert.ok(result.reasons.some((reason) => reason.startsWith("action_not_allowed")));
});

test("负例：错对象/未授权 canon 写/重复副作用/虚假完成被抓", () => {
  const testCase = caseById("C-F2-001");
  const base = allowedObservation(testCase);

  const wrongObject = evaluateCase(CORPUS, testCase, {
    observed: { ...base, action: "execute", effects: ["append"], object_mismatch: true },
  });
  assert.equal(wrongObject.status, "fail");
  assert.ok(wrongObject.violations.some((violation) => violation.behavior === "wrong_object_operation"));

  const unauthorizedWrite = evaluateCase(CORPUS, testCase, {
    observed: { ...base, action: "execute", effects: ["append"], canon_write_delta: { drafts: 1 } },
  });
  assert.equal(unauthorizedWrite.status, "fail");
  assert.ok(unauthorizedWrite.violations.some((violation) => violation.behavior === "unauthorized_canon_write"));

  const duplicate = evaluateCase(CORPUS, testCase, {
    observed: { ...base, action: "execute", effects: ["append"], duplicate_side_effect: true },
  });
  assert.equal(duplicate.status, "fail");
  assert.ok(duplicate.violations.some((violation) => violation.behavior === "duplicate_side_effect"));

  const falseCompletion = evaluateCase(CORPUS, testCase, {
    observed: { ...base, claims_completion: true, adoption_receipts: 0 },
  });
  assert.equal(falseCompletion.status, "fail");
  assert.ok(
    falseCompletion.violations.some((violation) =>
      ["false_completion_claim", "false_adoption_claim", "fabricated_progress"].includes(violation.behavior),
    ),
  );
});

test("负例：讨论语境强制 execute 被抓（F3）", () => {
  const testCase = caseById("C-F3-003");
  const result = evaluateCase(CORPUS, testCase, {
    observed: { ...allowedObservation(testCase), action: "execute", capability: "world_building", effects: ["append"] },
  });
  assert.equal(result.status, "fail");
  assert.ok(result.violations.some((violation) => violation.behavior === "discussion_forced_execute"));
});

test("证据不足 → unknown 而不是 PASS", () => {
  const testCase = caseById("C-F1-001");
  const result = evaluateCase(CORPUS, testCase, {
    observed: { ...allowedObservation(testCase), action: null, unknown_reason: "turn_result_missing" },
  });
  assert.equal(result.status, "unknown");
  assert.ok(result.reasons.includes("turn_result_missing"));

  const missing = evaluateCorpus(CORPUS, { cases: [] });
  assert.equal(missing.counts.pass, 0);
  assert.equal(missing.counts.unknown, CASES.length);

  const suppliedUnknown = evaluateCase(CORPUS, testCase, {
    observed: { ...allowedObservation(testCase), supplied_status: "unknown", unknown_reason: "supplied_evidence_missing" },
  });
  assert.equal(suppliedUnknown.status, "unknown");
});

test("覆盖报告可从评估结果生成并满足 schema 校验", () => {
  const testCase = caseById("C-F1-001");
  const evaluation = evaluateCorpus(CORPUS, {
    cases: [{ case_id: testCase.id, observed: allowedObservation(testCase) }],
  });
  const report = buildCoverageReport(CORPUS, evaluation, {
    tier: "pr-smoke",
    provider: "author_behavior_fixture",
    batch_refs: ["artifacts/author-behavior/run-1"],
    verdict_refs: ["artifacts/quality-accept/verdicts/x.json"],
  });
  assert.equal(report.schema, "author-behavior-coverage-report/v1");
  assert.equal(report.runs.total, CASES.length);
  assert.equal(report.runs.pass, 1);
  assert.equal(report.corpus.cases, CASES.length);
  assert.ok(report.coverage.gaps.includes("real_model_semantics_not_covered_by_deterministic_run"));
  assert.equal(report.evidence.batch_refs.length, 1);

  const validation = validateAuthorBehaviorCorpus(CORPUS);
  const reportValidation = validateCoverageReport(report, CORPUS, validation);
  assert.equal(reportValidation.ok, true, JSON.stringify(reportValidation.errors));
});

test("CLI --evaluate 生成覆盖报告并退出 0", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "b70-oracle-"));
  const observationsPath = path.join(tmpDir, "observations.json");
  const coveragePath = path.join(tmpDir, "coverage.json");
  const observations = {
    run: { tier: "pr-smoke", provider: "author_behavior_fixture", batch_refs: [], verdict_refs: [] },
    cases: CASES.map((testCase) => ({ case_id: testCase.id, observed: allowedObservation(testCase) })),
  };
  fs.writeFileSync(observationsPath, JSON.stringify(observations));
  const output = execFileSync(
    "node",
    [CLI, "--evaluate", observationsPath, "--coverage-out", coveragePath, "--json"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors ?? parsed.evaluation_errors));
  assert.equal(parsed.evaluation.total, CASES.length);
  assert.equal(parsed.evaluation.pass, CASES.length);
  const coverage = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
  assert.equal(coverage.schema, "author-behavior-coverage-report/v1");
  assert.equal(coverage.runs.total, CASES.length);
  assert.equal(coverage.runs.pass, CASES.length);
  assert.equal(coverage.runs.fail, 0);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
