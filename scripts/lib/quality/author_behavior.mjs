// B70 CP0：author-behavior 冻结语料/状态/oracle/覆盖报告格式的加载与校验。
//
// 本模块只做验证工具语义校验：YAML 语法与重复键交给既有标准解析桥
// （scripts/lib/quality/yaml_bridge.py，单一 YAML 解析源），不另写 regex YAML。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseYamlFiles } from "./manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = path.resolve(HERE, "../../..");

export const CORPUS_DIR = "quality/acceptance/author-behavior";
export const CORPUS_PATHS = Object.freeze({
  targets: `${CORPUS_DIR}/target-templates.yml`,
  states: `${CORPUS_DIR}/states.yml`,
  cases: `${CORPUS_DIR}/cases.yml`,
  oracles: `${CORPUS_DIR}/oracles.yml`,
  fixtures: `${CORPUS_DIR}/fixtures.yml`,
});
export const COVERAGE_REPORT_SCHEMA = "author-behavior-coverage-report/v1";

export const SCHEMAS = Object.freeze({
  targets: "author-behavior-targets/v1",
  states: "author-behavior-states/v1",
  cases: "author-behavior-cases/v1",
  oracles: "author-behavior-oracles/v1",
  fixtures: "author-behavior-fixtures/v1",
});

export const SPLITS = Object.freeze(["dev", "regression", "holdout", "explore"]);
export const TIERS = Object.freeze(["pr-smoke", "nightly", "explore"]);
export const PROVENANCE_KINDS = Object.freeze(["human_template", "derived_frozen", "generated_frozen"]);
export const FIXTURE_ACTIONS = Object.freeze(["reply", "ask_author"]);

export class AuthorBehaviorError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "AuthorBehaviorError";
    this.errors = errors;
  }
}

function normalizeExpression(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function corpusSha(corpus) {
  const canonical = JSON.stringify({
    targets: corpus.targets,
    states: corpus.states,
    cases: corpus.cases,
    oracles: corpus.oracles,
    fixtures: corpus.fixtures,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function loadAuthorBehaviorCorpus(projectRoot = DEFAULT_PROJECT_ROOT) {
  const bundle = parseYamlFiles(projectRoot, Object.values(CORPUS_PATHS));
  const corpus = {};

  for (const [key, relativePath] of Object.entries(CORPUS_PATHS)) {
    const record = bundle.files.find((file) => file.path === relativePath) ?? bundle.files.shift();
    if (!record || record.ok !== true) {
      const where = record?.line ? `:${record.line}:${record.column ?? 0}` : "";
      throw new AuthorBehaviorError(
        `${relativePath}${where}: YAML 解析失败：${record?.error ?? "unknown error"}`,
      );
    }
    corpus[key] = record.data;
  }

  return corpus;
}

/**
 * 校验冻结语料。返回 {ok, errors, warnings, stats}；纯函数便于测试变异输入。
 */
export function validateAuthorBehaviorCorpus(corpus) {
  const errors = [];
  const warnings = [];
  const addError = (code, detail) => errors.push({ code, detail });
  const addWarning = (code, detail) => warnings.push({ code, detail });

  for (const [key, expected] of Object.entries(SCHEMAS)) {
    const data = corpus[key];
    if (!isPlainObject(data)) {
      addError("collection_missing", `${key}: 缺少集合或不是 map`);
      continue;
    }
    if (data.schema !== expected) {
      addError("schema_mismatch", `${key}: schema=${data.schema} 期望 ${expected}`);
    }
    if (!hasText(data.frozen_at) || !hasText(data.frozen_by)) {
      addError("freeze_metadata_missing", `${key}: 缺少 frozen_at/frozen_by`);
    }
  }

  const targets = Array.isArray(corpus.targets?.targets) ? corpus.targets.targets : [];
  const states = Array.isArray(corpus.states?.states) ? corpus.states.states : [];
  const cases = Array.isArray(corpus.cases?.cases) ? corpus.cases.cases : [];
  const oracles = corpus.oracles ?? {};

  if (targets.length === 0) addError("targets_empty", "targets 至少 1 个");
  if (states.length === 0) addError("states_empty", "states 至少 1 个");
  if (cases.length === 0) addError("cases_empty", "cases 至少 1 个");

  const outcomeActions = new Set(
    Array.isArray(corpus.targets?.outcome_vocabulary?.actions)
      ? corpus.targets.outcome_vocabulary.actions
      : [],
  );
  const outcomeEffects = new Set(
    Array.isArray(corpus.targets?.outcome_vocabulary?.adoption_effects)
      ? corpus.targets.outcome_vocabulary.adoption_effects
      : [],
  );

  const invariantIds = new Set();
  for (const invariant of Array.isArray(corpus.states?.global_invariants)
    ? corpus.states.global_invariants
    : []) {
    if (!hasText(invariant?.id) || !hasText(invariant?.description)) {
      addError("invariant_invalid", `global invariant 缺 id/description: ${JSON.stringify(invariant)}`);
      continue;
    }
    if (invariantIds.has(invariant.id)) addError("invariant_duplicate", invariant.id);
    invariantIds.add(invariant.id);
  }

  const behaviorVocabulary = isPlainObject(oracles.behavior_vocabulary)
    ? oracles.behavior_vocabulary
    : {};
  for (const [behavior, invariant] of Object.entries(behaviorVocabulary)) {
    if (!invariantIds.has(invariant)) {
      addError("behavior_vocabulary_unknown_invariant", `${behavior} -> ${invariant}`);
    }
  }

  const targetIds = new Set();
  const stateDimensionKeys = new Set();
  for (const state of states) {
    if (!isPlainObject(state?.dimensions)) {
      addError("state_dimensions_invalid", String(state?.id));
      continue;
    }
    for (const dimension of Object.keys(state.dimensions)) stateDimensionKeys.add(dimension);
  }

  for (const target of targets) {
    if (!hasText(target?.id)) {
      addError("target_id_missing", JSON.stringify(target));
      continue;
    }
    if (targetIds.has(target.id)) addError("target_duplicate", target.id);
    targetIds.add(target.id);
    if (!hasText(target.goal)) addError("target_goal_missing", target.id);
    if (!Array.isArray(target.allowed_actions) || target.allowed_actions.length === 0) {
      addError("target_allowed_actions_missing", target.id);
    } else {
      for (const action of target.allowed_actions) {
        if (!outcomeActions.has(action)) addError("target_unknown_action", `${target.id}:${action}`);
      }
    }
    for (const effect of Array.isArray(target.allowed_effects) ? target.allowed_effects : []) {
      if (!outcomeEffects.has(effect)) addError("target_unknown_effect", `${target.id}:${effect}`);
    }
    if (!Array.isArray(target.forbidden_behaviors) || target.forbidden_behaviors.length === 0) {
      addError("target_forbidden_missing", target.id);
    }
    for (const behavior of Array.isArray(target.forbidden_behaviors) ? target.forbidden_behaviors : []) {
      if (!(behavior in behaviorVocabulary)) {
        addError("target_unknown_forbidden_behavior", `${target.id}:${behavior}`);
      }
    }
    for (const dimension of Array.isArray(target.state_dimensions) ? target.state_dimensions : []) {
      if (!stateDimensionKeys.has(dimension)) {
        addError("target_unknown_state_dimension", `${target.id}:${dimension}`);
      }
    }
    for (const trap of Array.isArray(target.negative_traps) ? target.negative_traps : []) {
      if (!hasText(trap)) addError("target_negative_trap_invalid", `${target.id}:${trap}`);
    }
  }

  const stateIds = new Set();
  for (const state of states) {
    if (!hasText(state?.id)) {
      addError("state_id_missing", JSON.stringify(state));
      continue;
    }
    if (stateIds.has(state.id)) addError("state_duplicate", state.id);
    stateIds.add(state.id);
    if (!isPlainObject(state.seed) || !hasText(state.seed.kind)) {
      addError("state_seed_invalid", state.id);
    }
  }

  const hardOracleIds = new Set();
  for (const oracle of Array.isArray(oracles.hard_oracles) ? oracles.hard_oracles : []) {
    if (!hasText(oracle?.id)) {
      addError("hard_oracle_id_missing", JSON.stringify(oracle));
      continue;
    }
    if (hardOracleIds.has(oracle.id)) addError("hard_oracle_duplicate", oracle.id);
    hardOracleIds.add(oracle.id);
    if (!invariantIds.has(oracle.invariant)) {
      addError("hard_oracle_unknown_invariant", `${oracle.id}:${oracle.invariant}`);
    }
    if (!hasText(oracle.kind) || !hasText(oracle.description) || !hasText(oracle.evidence)) {
      addError("hard_oracle_incomplete", oracle.id);
    }
  }

  const targetOracleIds = new Set();
  for (const targetOracle of Array.isArray(oracles.target_oracles) ? oracles.target_oracles : []) {
    if (!hasText(targetOracle?.target_id)) {
      addError("target_oracle_id_missing", JSON.stringify(targetOracle));
      continue;
    }
    if (targetOracleIds.has(targetOracle.target_id)) addError("target_oracle_duplicate", targetOracle.target_id);
    targetOracleIds.add(targetOracle.target_id);
    if (!targetIds.has(targetOracle.target_id)) {
      addError("target_oracle_unknown_target", targetOracle.target_id);
    }
    if (!Array.isArray(targetOracle.allowed_result_sets) || targetOracle.allowed_result_sets.length === 0) {
      addError("target_oracle_result_sets_missing", targetOracle.target_id);
    }
    if (!hasText(targetOracle.semantic_policy)) {
      addError("target_oracle_policy_missing", targetOracle.target_id);
    }
    const trapIds = new Set(
      (Array.isArray(targetOracle.negative_traps) ? targetOracle.negative_traps : []).map((trap) => trap?.id),
    );
    const target = targets.find((item) => item.id === targetOracle.target_id);
    for (const trap of Array.isArray(target?.negative_traps) ? target.negative_traps : []) {
      if (!trapIds.has(trap)) addError("target_oracle_trap_missing", `${targetOracle.target_id}:${trap}`);
    }
  }

  for (const target of targets) {
    if (hasText(target?.id) && !targetOracleIds.has(target.id)) {
      addError("target_oracle_missing", target.id);
    }
  }

  const fixtures = Array.isArray(corpus.fixtures?.fixtures) ? corpus.fixtures.fixtures : [];
  const fixtureCaseIds = new Set();
  for (const fixture of fixtures) {
    if (!hasText(fixture?.case_id) || !hasText(fixture?.expression) || !hasText(fixture?.note)) {
      addError("fixture_incomplete", JSON.stringify(fixture));
      continue;
    }
    if (fixtureCaseIds.has(fixture.case_id)) addError("fixture_duplicate_case", fixture.case_id);
    fixtureCaseIds.add(fixture.case_id);
    if (!FIXTURE_ACTIONS.includes(fixture.action)) addError("fixture_invalid_action", `${fixture.case_id}:${fixture.action}`);
  }

  const caseIds = new Set();
  const expressionIndex = new Map();
  const targetCaseCounts = new Map();
  const usedStates = new Set();
  const usedOracles = new Set();
  const coveredBehaviors = new Set();

  for (const testCase of cases) {
    if (!hasText(testCase?.id)) {
      addError("case_id_missing", JSON.stringify(testCase));
      continue;
    }
    if (caseIds.has(testCase.id)) addError("case_duplicate", testCase.id);
    caseIds.add(testCase.id);
    if (!targetIds.has(testCase.target_id)) {
      addError("case_unknown_target", `${testCase.id}:${testCase.target_id}`);
    } else {
      targetCaseCounts.set(testCase.target_id, (targetCaseCounts.get(testCase.target_id) ?? 0) + 1);
    }
    if (!stateIds.has(testCase.state_id)) addError("case_unknown_state", `${testCase.id}:${testCase.state_id}`);
    usedStates.add(testCase.state_id);
    if (!SPLITS.includes(testCase.split)) addError("case_invalid_split", `${testCase.id}:${testCase.split}`);
    if (!TIERS.includes(testCase.tier)) addError("case_invalid_tier", `${testCase.id}:${testCase.tier}`);
    if (testCase.expression_frozen !== true) {
      addError("case_expression_not_frozen", testCase.id);
    }
    const expression = normalizeExpression(testCase.expression);
    if (expression.length < 2) addError("case_expression_empty", testCase.id);
    const indexEntry = expressionIndex.get(expression) ?? [];
    indexEntry.push(testCase);
    expressionIndex.set(expression, indexEntry);

    const provenance = testCase.provenance ?? {};
    if (!PROVENANCE_KINDS.includes(provenance.kind)) {
      addError("case_provenance_invalid", `${testCase.id}:${provenance.kind}`);
    }
    if (["derived_frozen", "generated_frozen"].includes(provenance.kind)) {
      if (!Array.isArray(provenance.source_refs) || provenance.source_refs.length === 0) {
        addError("case_provenance_source_refs_missing", testCase.id);
      }
    }
    if (provenance.kind === "generated_frozen" && (!hasText(provenance.generator) || !hasText(provenance.generated_at))) {
      addError("case_generated_provenance_incomplete", testCase.id);
    }
    if (!hasText(provenance.frozen_at)) addError("case_provenance_frozen_at_missing", testCase.id);

    const expected = testCase.expected ?? {};
    if (!Array.isArray(expected.allowed_actions) || expected.allowed_actions.length === 0) {
      addError("case_allowed_actions_missing", testCase.id);
    } else {
      for (const action of expected.allowed_actions) {
        if (!outcomeActions.has(action)) addError("case_unknown_action", `${testCase.id}:${action}`);
      }
    }
    for (const effect of Array.isArray(expected.allowed_effects) ? expected.allowed_effects : []) {
      if (!outcomeEffects.has(effect)) addError("case_unknown_effect", `${testCase.id}:${effect}`);
    }
    if (!Array.isArray(expected.forbidden_behaviors) || expected.forbidden_behaviors.length === 0) {
      addError("case_forbidden_missing", testCase.id);
    }
    for (const behavior of Array.isArray(expected.forbidden_behaviors) ? expected.forbidden_behaviors : []) {
      if (!(behavior in behaviorVocabulary)) {
        addError("case_unknown_forbidden_behavior", `${testCase.id}:${behavior}`);
      } else {
        coveredBehaviors.add(behavior);
      }
    }
    if (!Array.isArray(expected.oracle_refs) || expected.oracle_refs.length === 0) {
      addError("case_oracle_refs_missing", testCase.id);
    }
    const fixture = fixtures.find((entry) => entry.case_id === testCase.id);
    if (fixture && normalizeExpression(fixture.expression) !== expression) {
      addError("fixture_expression_mismatch", testCase.id);
    }
    if (!fixture && testCase.tier === "pr-smoke") {
      addError("fixture_missing_for_pr_smoke_case", testCase.id);
    }
    for (const oracleRef of Array.isArray(expected.oracle_refs) ? expected.oracle_refs : []) {
      if (!hardOracleIds.has(oracleRef)) addError("case_unknown_oracle_ref", `${testCase.id}:${oracleRef}`);
      else usedOracles.add(oracleRef);
    }
  }

  for (const [expression, matching] of expressionIndex.entries()) {
    const splits = new Set(matching.map((testCase) => testCase.split));
    if (splits.has("holdout") && (splits.has("dev") || splits.has("regression"))) {
      addError(
        "holdout_expression_leak",
        `${expression} 同时出现在 holdout 与 dev/regression: ${matching.map((c) => c.id).join(",")}`,
      );
    }
    if (splits.has("dev") && splits.has("regression")) {
      addWarning(
        "dev_regression_expression_shared",
        `${expression} 同时出现在 dev 与 regression: ${matching.map((c) => c.id).join(",")}`,
      );
    }
    if (matching.length > 2) {
      addWarning("expression_multi_reuse", `${expression} 出现在 ${matching.length} 个 case`);
    }
  }

  for (const target of targets) {
    if (!hasText(target?.id)) continue;
    if ((targetCaseCounts.get(target.id) ?? 0) === 0) addError("target_without_cases", target.id);
  }
  for (const state of states) {
    if (hasText(state?.id) && !usedStates.has(state.id)) addError("state_without_cases", state.id);
  }
  for (const oracleId of hardOracleIds) {
    if (!usedOracles.has(oracleId)) addWarning("oracle_without_case_refs", oracleId);
  }
  for (const behavior of Object.keys(behaviorVocabulary)) {
    if (!coveredBehaviors.has(behavior)) addWarning("behavior_without_case", behavior);
  }
  if (!hasText(oracles.semantic_unknown_policy)) addError("semantic_unknown_policy_missing", "oracles");
  if (!hasText(oracles.excluded)) addError("excluded_policy_missing", "oracles");

  const stats = {
    targets: targets.length,
    states: states.length,
    cases: cases.length,
    splits: Object.fromEntries(SPLITS.map((split) => [split, cases.filter((c) => c.split === split).length])),
    tiers: Object.fromEntries(TIERS.map((tier) => [tier, cases.filter((c) => c.tier === tier).length])),
    fixtures: fixtures.length,
    hard_oracles: hardOracleIds.size,
    covered_behaviors: coveredBehaviors.size,
    corpus_sha: corpusSha(corpus),
  };

  return { ok: errors.length === 0, errors, warnings, stats };
}

export function validateCoverageReport(report, corpus, corpusValidation) {
  const errors = [];
  const addError = (code, detail) => errors.push({ code, detail });

  if (!isPlainObject(report)) return { ok: false, errors: [{ code: "report_not_object", detail: "" }] };

  if (report.schema !== COVERAGE_REPORT_SCHEMA) {
    addError("report_schema_mismatch", String(report.schema));
  }
  if (!hasText(report.generated_at)) addError("report_generated_at_missing", "");
  if (!isPlainObject(report.corpus)) {
    addError("report_corpus_missing", "");
  } else {
    if (report.corpus.targets !== corpusValidation.stats.targets) addError("report_target_count_mismatch", "");
    if (report.corpus.states !== corpusValidation.stats.states) addError("report_state_count_mismatch", "");
    if (report.corpus.cases !== corpusValidation.stats.cases) addError("report_case_count_mismatch", "");
    if (report.corpus.corpus_sha !== corpusValidation.stats.corpus_sha) {
      addError("report_corpus_sha_mismatch", String(report.corpus.corpus_sha));
    }
  }
  if (!isPlainObject(report.coverage)) {
    addError("report_coverage_missing", "");
  } else {
    if (!Array.isArray(report.coverage.targets) || report.coverage.targets.length === 0) {
      addError("report_coverage_targets_missing", "");
    }
    for (const field of [
      "negative_traps_declared",
      "negative_traps_evaluated",
      "oracles_declared",
      "oracles_executed",
      "oracles_evaluated"
    ]) {
      if (!Array.isArray(report.coverage[field])) addError("report_coverage_field_missing", field);
    }
    if (!Array.isArray(report.coverage.gaps)) addError("report_gaps_missing", "");
  }
  if (!isPlainObject(report.runs)) {
    addError("report_runs_missing", "");
  } else {
    for (const key of ["tier", "provider", "total", "pass", "fail", "unknown", "blocked"]) {
      if (!(key in report.runs)) addError("report_runs_field_missing", key);
    }
    const counts = ["total", "pass", "fail", "unknown", "blocked"].map((key) => report.runs[key]);
    if (counts.every((value) => Number.isInteger(value) && value >= 0)) {
      if (report.runs.pass + report.runs.fail + report.runs.unknown + report.runs.blocked > report.runs.total) {
        addError("report_runs_overcount", "");
      }
    } else {
      addError("report_runs_counts_invalid", "");
    }
  }
  if (!isPlainObject(report.evidence) || !Array.isArray(report.evidence.batch_refs) || !Array.isArray(report.evidence.verdict_refs)) {
    addError("report_evidence_invalid", "");
  }
  if (!hasText(report.unknown_policy)) addError("report_unknown_policy_missing", "");

  if (isPlainObject(corpus) && Array.isArray(corpus.targets?.targets)) {
    const targetIds = new Set(corpus.targets.targets.map((target) => target.id));
    for (const row of Array.isArray(report.coverage?.targets) ? report.coverage.targets : []) {
      if (!targetIds.has(row?.target_id)) addError("report_unknown_target", String(row?.target_id));
    }
  }

  return { ok: errors.length === 0, errors };
}

export function coverageReportExample(corpus, corpusValidation) {
  const cases = Array.isArray(corpus.cases?.cases) ? corpus.cases.cases : [];
  const targetIds = (corpus.targets?.targets ?? []).map((target) => target.id);
  return {
    schema: COVERAGE_REPORT_SCHEMA,
    generated_at: new Date().toISOString(),
    corpus: {
      targets: corpusValidation.stats.targets,
      states: corpusValidation.stats.states,
      cases: corpusValidation.stats.cases,
      splits: corpusValidation.stats.splits,
      corpus_sha: corpusValidation.stats.corpus_sha,
    },
    coverage: {
      targets: targetIds.map((targetId) => ({
        target_id: targetId,
        cases: cases.filter((testCase) => testCase.target_id === targetId).length,
        states: [...new Set(cases.filter((testCase) => testCase.target_id === targetId).map((testCase) => testCase.state_id))],
        splits: [...new Set(cases.filter((testCase) => testCase.target_id === targetId).map((testCase) => testCase.split))],
      })),
      // 示例报告区分 declared/executed/evaluated；未运行 → executed/evaluated 为空，
      // 不得把声明复制成执行结果。
      negative_traps_declared: (corpus.oracles?.target_oracles ?? []).flatMap((oracle) =>
        (oracle.negative_traps ?? []).map((trap) => trap.id),
      ),
      negative_traps_evaluated: [],
      oracles_declared: [...new Set(cases.flatMap((testCase) => testCase.expected?.oracle_refs ?? []))],
      oracles_executed: [],
      oracles_evaluated: [],
      gaps: ["not_run:example_report_only"],
    },
    runs: { tier: "not_run", provider: "none", total: 0, pass: 0, fail: 0, unknown: 0, blocked: 0 },
    evidence: { batch_refs: [], verdict_refs: [] },
    unknown_policy: "未知/未触发允许集记 unknown，不判 PASS；文学质量 I10 由作者/独立流程评价。",
  };
}

export function readCoverageReport(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}
