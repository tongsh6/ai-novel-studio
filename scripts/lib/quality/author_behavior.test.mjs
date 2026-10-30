// B70 CP0：author-behavior 冻结语料/覆盖报告校验器的正反例。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DEFAULT_PROJECT_ROOT,
  COVERAGE_REPORT_SCHEMA,
  loadAuthorBehaviorCorpus,
  validateAuthorBehaviorCorpus,
  validateCoverageReport,
  coverageReportExample,
  readCoverageReport,
} from "./author_behavior.mjs";

const ROOT = DEFAULT_PROJECT_ROOT;
const CORPUS = loadAuthorBehaviorCorpus(ROOT);
const EXAMPLE_PATH = path.join(ROOT, "quality/acceptance/author-behavior/coverage-report.example.json");
const CLI = path.join(ROOT, "scripts/author_behavior_check.mjs");

function cloneCorpus() {
  return structuredClone(CORPUS);
}

function expectError(corpus, code) {
  const result = validateAuthorBehaviorCorpus(corpus);
  assert.equal(result.ok, false, `期望失败但通过: ${code}`);
  assert.ok(
    result.errors.some((error) => error.code === code),
    `缺少错误 ${code}: ${JSON.stringify(result.errors)}`,
  );
}

test("冻结语料通过校验且统计稳定", () => {
  const result = validateAuthorBehaviorCorpus(CORPUS);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.stats.targets, 3);
  assert.equal(result.stats.states, 3);
  assert.equal(result.stats.cases, 12);
  assert.equal(result.stats.splits.dev, 6);
  assert.equal(result.stats.splits.regression, 3);
  assert.equal(result.stats.splits.holdout, 3);
  assert.equal(
    result.stats.splits.dev + result.stats.splits.regression + result.stats.splits.holdout + result.stats.splits.explore,
    result.stats.cases,
  );
  assert.match(result.stats.corpus_sha, /^[0-9a-f]{64}$/);
});

test("覆盖报告格式示例与报告校验通过", () => {
  const report = readCoverageReport(EXAMPLE_PATH);
  assert.equal(report.schema, COVERAGE_REPORT_SCHEMA);
  const validation = validateAuthorBehaviorCorpus(CORPUS);
  const reportValidation = validateCoverageReport(report, CORPUS, validation);
  assert.equal(reportValidation.ok, true, JSON.stringify(reportValidation.errors));

  const generated = coverageReportExample(CORPUS, validation);
  assert.equal(generated.corpus.corpus_sha, validation.stats.corpus_sha);
  assert.equal(generated.runs.total, 0);
  assert.ok(Array.isArray(generated.coverage.gaps));
});

test("重复 case id 被拒绝", () => {
  const corpus = cloneCorpus();
  corpus.cases.cases[1].id = corpus.cases.cases[0].id;
  expectError(corpus, "case_duplicate");
});

test("未知 target/state/oracle 引用被拒绝", () => {
  const corpus = cloneCorpus();
  corpus.cases.cases[0].target_id = "F9-missing";
  corpus.cases.cases[1].state_id = "S9-missing";
  corpus.cases.cases[2].expected.oracle_refs = ["HO9-missing"];
  const result = validateAuthorBehaviorCorpus(corpus);
  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("case_unknown_target"));
  assert.ok(codes.has("case_unknown_state"));
  assert.ok(codes.has("case_unknown_oracle_ref"));
});

test("holdout 表达泄漏到 dev/regression 被拒绝", () => {
  const corpus = cloneCorpus();
  const holdout = corpus.cases.cases.find((testCase) => testCase.split === "holdout");
  const dev = corpus.cases.cases.find((testCase) => testCase.split === "dev");
  dev.expression = holdout.expression;
  expectError(corpus, "holdout_expression_leak");
});

test("derived/generated provenance 缺 source_refs 被拒绝", () => {
  const corpus = cloneCorpus();
  const testCase = corpus.cases.cases[0];
  testCase.provenance.kind = "derived_frozen";
  delete testCase.provenance.source_refs;
  expectError(corpus, "case_provenance_source_refs_missing");

  const corpus2 = cloneCorpus();
  const generated = corpus2.cases.cases[0];
  generated.provenance.kind = "generated_frozen";
  generated.provenance.source_refs = ["template:F1"];
  delete generated.provenance.generator;
  expectError(corpus2, "case_generated_provenance_incomplete");
});

test("未知动作/效果/禁止行为被拒绝", () => {
  const corpus = cloneCorpus();
  corpus.cases.cases[0].expected.allowed_actions = ["teleport"];
  corpus.cases.cases[1].expected.allowed_effects = ["rewrite_universe"];
  corpus.cases.cases[2].expected.forbidden_behaviors = ["unknown_behavior"];
  const result = validateAuthorBehaviorCorpus(corpus);
  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("case_unknown_action"));
  assert.ok(codes.has("case_unknown_effect"));
  assert.ok(codes.has("case_unknown_forbidden_behavior"));
});

test("目标族无案例/状态无案例被拒绝", () => {
  const corpus = cloneCorpus();
  corpus.cases.cases = corpus.cases.cases.filter((testCase) => testCase.target_id !== "F3-world-foreshadow-boundary");
  const result = validateAuthorBehaviorCorpus(corpus);
  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("target_without_cases"));
});

test("覆盖报告 corpus 计数/stat sha 不一致被拒绝", () => {
  const validation = validateAuthorBehaviorCorpus(CORPUS);
  const report = readCoverageReport(EXAMPLE_PATH);
  const bad = structuredClone(report);
  bad.corpus.cases = 999;
  bad.corpus.corpus_sha = "0".repeat(64);
  const result = validateCoverageReport(bad, CORPUS, validation);
  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("report_case_count_mismatch"));
  assert.ok(codes.has("report_corpus_sha_mismatch"));
});

test("CLI 通过（valid corpus + example report）", () => {
  const output = execFileSync("node", [CLI, "--json", "--report", EXAMPLE_PATH], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.report_errors.length, 0);
});
