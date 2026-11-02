// B71 实模作者行为覆盖：从 B70 冻结 corpus 选择真实作者输入（不现场编）。
//
// Lead 决策（2026-11-03）：pilot 8 条来自 cases.yml 冻结表达；首轮只跑
// #1 C-F1-003（holdout 零写）+ #6 C-F3-002（regression 保存请求）。输入必须是
// cases.expression 原文，expression_frozen=true；persona 只作为表达风格记录维度，
// 不参与评分、不生成新输入。本模块只读消费 quality/acceptance/author-behavior/。
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PROJECT_ROOT,
  PROVENANCE_KINDS,
  SPLITS,
  loadAuthorBehaviorCorpus,
  validateAuthorBehaviorCorpus,
} from "./author_behavior.mjs";

export const LIVE_CASE_SCHEMA = "author-behavior-live-case/v1";
export const CORPUS_PERSONAS_PATH = "quality/acceptance/author-behavior/personas.json";

// 首批 pilot 两条（Lead 决策：异族异境——零写讨论 vs 明确保存请求）。
export const PILOT_CASE_IDS = Object.freeze(["C-F1-003", "C-F3-002"]);

// 设计 §2.1 的 8 条覆盖组（后续批次按需扩展；选择器只允许这 8 条 + pilot 2 条）。
export const PILOT_GROUP_CASE_IDS = Object.freeze([
  "C-F1-003",
  "C-F1-002",
  "C-F2-003",
  "C-F2-004",
  "C-F3-003",
  "C-F3-002",
  "C-F4-001",
  "C-F5-001",
]);

// persona 是输入风格记录维度（人工指派），不参与评分、不据此新增输入。
export const PERSONA_IDS_BY_CASE = Object.freeze({
  "C-F1-003": "p-fuzzy-explorer",
  "C-F1-002": "p-ellipsis-referencer",
  "C-F2-003": "p-careful-controller",
  "C-F2-004": "p-multi-work-parallel",
  "C-F3-003": "p-genre-expert",
  "C-F3-002": "p-worldbuilder",
  "C-F4-001": "p-ellipsis-referencer",
  "C-F5-001": "p-newbie-writer",
});

// 原生批次 state seed 对应 states.yml 的合成状态。
export const STATE_BY_CASE = Object.freeze({
  "C-F1-003": "S1-partial-multichapter",
  "C-F1-002": "S3-pending-candidate-context",
  "C-F2-003": "S1-partial-multichapter",
  "C-F2-004": "S4-same-title-chapters",
  "C-F3-003": "S3-pending-candidate-context",
  "C-F3-002": "S1-partial-multichapter",
  "C-F4-001": "S1-partial-multichapter",
  "C-F5-001": "S2-empty-skeleton",
});

const sha256 = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function indexById(rows, key) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (isObject(row) && typeof row[key] === "string") map.set(row[key], row);
  }
  return map;
}

export function loadLiveCaseCorpus(projectRoot = DEFAULT_PROJECT_ROOT) {
  const corpus = loadAuthorBehaviorCorpus(projectRoot);
  const validation = validateAuthorBehaviorCorpus(corpus);
  if (validation.ok !== true) {
    throw new Error(`author-behavior corpus 校验失败: ${JSON.stringify(validation.errors?.slice(0, 3))}`);
  }
  const personasFile = path.join(projectRoot, CORPUS_PERSONAS_PATH);
  const personas = fs.existsSync(personasFile)
    ? JSON.parse(fs.readFileSync(personasFile, "utf8"))
    : { personas: [] };
  return {
    corpus,
    validation,
    personas: Array.isArray(personas.personas) ? personas.personas : [],
    personaById: indexById(personas.personas, "persona_id"),
    caseById: indexById(corpus.cases?.cases, "id"),
    targetById: indexById(corpus.targets?.targets, "id"),
    stateById: indexById(corpus.states?.states, "id"),
    oracles: corpus.oracles ?? {},
  };
}

function caseRecordError(message) {
  const error = new Error(`author-behavior live case: ${message}`);
  error.code = "author_behavior_live_case_invalid";
  return error;
}

export function selectLiveCase(bundle, caseId, { allowExplore = false } = {}) {
  if (typeof caseId !== "string" || caseId === "") throw caseRecordError("case id 必须是非空字符串");
  const testCase = bundle.caseById.get(caseId);
  if (!testCase) throw caseRecordError(`未知 case: ${caseId}`);
  if (testCase.expression_frozen !== true) {
    throw caseRecordError(`${caseId}: expression_frozen 必须为 true（禁止现场造输入）`);
  }
  if (typeof testCase.expression !== "string" || testCase.expression.trim() === "") {
    throw caseRecordError(`${caseId}: expression 必须是非空字符串`);
  }
  if (!SPLITS.includes(testCase.split)) throw caseRecordError(`${caseId}: 未知 split ${testCase.split}`);
  if (testCase.split === "explore" && !allowExplore) {
    throw caseRecordError(`${caseId}: explore split 默认不进入实模批次（显式 allowExplore 才允许）`);
  }
  if (!isObject(testCase.provenance) || !PROVENANCE_KINDS.includes(testCase.provenance.kind)) {
    throw caseRecordError(`${caseId}: provenance.kind 非法`);
  }
  if (testCase.provenance.kind === "generated_frozen") {
    if (typeof testCase.provenance.generator !== "string" || typeof testCase.provenance.generated_at !== "string") {
      throw caseRecordError(`${caseId}: generated_frozen 必须带 generator/generated_at`);
    }
  }
  const stateId = STATE_BY_CASE[caseId] ?? testCase.state_id;
  const state = bundle.stateById.get(stateId);
  if (!state) throw caseRecordError(`${caseId}: 未知 state ${stateId}`);
  const target = bundle.targetById.get(testCase.target_id);
  if (!target) throw caseRecordError(`${caseId}: 未知 target ${testCase.target_id}`);
  const personaId = PERSONA_IDS_BY_CASE[caseId] ?? null;
  if (personaId && !bundle.personaById.has(personaId)) {
    throw caseRecordError(`${caseId}: persona ${personaId} 不存在于 personas.json`);
  }
  const expected = isObject(testCase.expected) ? testCase.expected : {};
  const allowedActions = Array.isArray(expected.allowed_actions) ? expected.allowed_actions : [];
  const allowedEffects = Array.isArray(expected.allowed_effects) ? expected.allowed_effects : [];
  const forbiddenBehaviors = Array.isArray(expected.forbidden_behaviors) ? expected.forbidden_behaviors : [];
  const oracleRefs = Array.isArray(expected.oracle_refs) ? expected.oracle_refs : [];
  const targetAllowedActions = Array.isArray(target.allowed_actions) ? target.allowed_actions : allowedActions;
  const targetAllowedEffects = Array.isArray(target.allowed_effects) ? target.allowed_effects : allowedEffects;
  const targetForbidden = Array.isArray(target.forbidden_behaviors) ? target.forbidden_behaviors : forbiddenBehaviors;
  const negativeTraps = Array.isArray(target.negative_traps) ? target.negative_traps : [];
  const trapIds = Array.isArray(testCase.negative_trap_ids) ? testCase.negative_trap_ids : [];
  return {
    schema: LIVE_CASE_SCHEMA,
    case_id: caseId,
    target_id: testCase.target_id,
    target_family: target.family ?? null,
    state_id: stateId,
    split: testCase.split,
    tier: testCase.tier ?? null,
    provenance: testCase.provenance,
    expression: testCase.expression,
    expression_sha256: sha256(testCase.expression),
    expected: {
      allowed_actions: allowedActions,
      allowed_effects: allowedEffects,
      forbidden_behaviors: forbiddenBehaviors,
      oracle_refs: oracleRefs,
    },
    target: {
      family: target.family ?? null,
      goal: target.goal ?? null,
      allowed_actions: targetAllowedActions,
      allowed_effects: targetAllowedEffects,
      forbidden_behaviors: targetForbidden,
      negative_traps: negativeTraps,
    },
    state: {
      id: state.id,
      summary: state.summary ?? null,
      seed: state.seed ?? null,
      dimensions: state.dimensions ?? {},
      fixture: state.fixture ?? {},
    },
    persona: personaId
      ? {
          persona_id: personaId,
          label: bundle.personaById.get(personaId)?.experience ?? null,
          role: "expression_style_record_only",
        }
      : null,
    negative_trap_ids: trapIds,
    driver: {
      message: testCase.expression,
      state_env: stateId,
    },
  };
}

export function selectPilotCases(bundle, caseIds = PILOT_CASE_IDS) {
  const selected = [];
  for (const caseId of caseIds) {
    if (!PILOT_GROUP_CASE_IDS.includes(caseId)) {
      throw caseRecordError(`${caseId}: 不在已批准的 pilot 8 条内（禁止现场加输入）`);
    }
    selected.push(selectLiveCase(bundle, caseId));
  }
  return selected;
}
