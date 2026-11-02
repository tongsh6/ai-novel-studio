// 选择器测试：只允许 B70 冻结 cases 原文与已批准 pilot 组；拒绝现场造输入。
import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_CASE_SCHEMA,
  PILOT_CASE_IDS,
  PILOT_GROUP_CASE_IDS,
  loadLiveCaseCorpus,
  selectLiveCase,
  selectPilotCases,
} from "./author_behavior_live_cases.mjs";

const bundle = loadLiveCaseCorpus();

test("冻结 corpus 校验通过且可索引", () => {
  assert.equal(bundle.validation.ok, true);
  assert.equal(bundle.caseById.size > 20, true);
  assert.equal(bundle.targetById.size, 5);
  assert.equal(bundle.stateById.size, 4);
  assert.equal(bundle.personas.length, 12);
});

test("C-F1-003：holdout 零写输入取原文，state/persona/allowed 记录正确", () => {
  const record = selectLiveCase(bundle, "C-F1-003");
  assert.equal(record.schema, LIVE_CASE_SCHEMA);
  assert.equal(record.split, "holdout");
  assert.equal(record.state_id, "S1-partial-multichapter");
  assert.equal(record.expression, "嗯……先别动手，我就想知道眼下写到哪儿了。");
  assert.match(record.expression_sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(record.expected.allowed_actions, ["reply", "explore"]);
  assert.deepEqual(record.expected.allowed_effects, []);
  assert(record.expected.oracle_refs.includes("HO1-no-unauthorized-canon-write"));
  assert.equal(record.persona.persona_id, "p-fuzzy-explorer");
  assert.equal(record.persona.role, "expression_style_record_only");
  assert.equal(record.driver.message, record.expression);
  assert.equal(record.driver.state_env, "S1-partial-multichapter");
  assert.equal(record.state.seed.chapters, 3);
});

test("C-F3-002：regression 保存请求输入取原文，execute/append 与 oracle 记录正确", () => {
  const record = selectLiveCase(bundle, "C-F3-002");
  assert.equal(record.split, "regression");
  assert.equal(record.expression, "这个设定捋一下，能落成一条规则就存下来。");
  assert.deepEqual(record.expected.allowed_actions, ["execute", "explore"]);
  assert.deepEqual(record.expected.allowed_effects, ["append"]);
  assert(record.expected.oracle_refs.includes("HO3-no-duplicate-side-effect"));
  assert.equal(record.persona.persona_id, "p-worldbuilder");
});

test("pilot 组：批准 8 条全部可选，首轮两条正确", () => {
  const group = selectPilotCases(bundle);
  assert.deepEqual(PILOT_CASE_IDS, ["C-F1-003", "C-F3-002"]);
  assert.equal(group.length, 2);
  assert.deepEqual(group.map((record) => record.case_id), PILOT_CASE_IDS);
  const all = PILOT_GROUP_CASE_IDS.map((caseId) => selectLiveCase(bundle, caseId));
  assert.equal(all.length, 8);
  assert(new Set(all.map((record) => record.target_id)).size, 5);
  assert(new Set(all.map((record) => record.state_id)).size, 4);
});

test("拒绝现场造输入：未知 case、expression_frozen=false、非批准 pilot 组", () => {
  assert.throws(() => selectLiveCase(bundle, "C-UNKNOWN-001"), /未知 case/u);
  const mutated = {
    ...bundle,
    caseById: new Map(bundle.caseById),
  };
  mutated.caseById.set("C-F1-003", { ...bundle.caseById.get("C-F1-003"), expression_frozen: false });
  assert.throws(() => selectLiveCase(mutated, "C-F1-003"), /expression_frozen 必须为 true/u);
  assert.throws(() => selectPilotCases(bundle, ["C-F3-E01"]), /不在已批准的 pilot 8 条内/u);
});

test("explore split 默认拒绝（显式 allowExplore 才允许且输入仍取原文）", () => {
  const exploreCase = "C-F3-E01";
  assert.throws(() => selectLiveCase(bundle, exploreCase), /explore split 默认不进入实模批次/u);
  const record = selectLiveCase(bundle, exploreCase, { allowExplore: true });
  assert.equal(record.split, "explore");
  assert.equal(record.expression_frozen, undefined);
  assert.equal(record.expression, "先只记录这份资料，不要生成候选：主角沈砚在雨港经营旧书铺，正在寻找失踪的姐姐。资料校验标识B73MULTI。");
});

test("generated_frozen 必须带 generator/generated_at（B72 冻结流程校验）", () => {
  const generatedId = "C-F3-G01";
  const record = selectLiveCase(bundle, generatedId);
  assert.equal(record.provenance.kind, "generated_frozen");
  assert.equal(typeof record.provenance.generator, "string");
  assert.equal(typeof record.provenance.generated_at, "string");
  const mutated = { ...bundle, caseById: new Map(bundle.caseById) };
  mutated.caseById.set(generatedId, {
    ...bundle.caseById.get(generatedId),
    provenance: { ...bundle.caseById.get(generatedId).provenance, generator: undefined },
  });
  assert.throws(() => selectLiveCase(mutated, generatedId), /generator\/generated_at/u);
});
