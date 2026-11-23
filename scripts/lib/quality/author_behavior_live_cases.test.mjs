// 选择器测试：只允许 B70 冻结 cases 原文与已批准 pilot 组；拒绝现场造输入。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  LIVE_CASE_SCHEMA,
  PILOT_CASE_IDS,
  PILOT_GROUP_CASE_IDS,
  loadLiveCaseCorpus,
  selectLiveCase,
  selectLiveCaseSteps,
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

test("R08 五个独立批次保留现 corpus 的 journey 顺序、完整预期和20条原文字节", () => {
  const groups = [
    ["J-R08-SOURCE-HISTORY", "S1-partial-multichapter", [
      "C-F3-R08-HISTORY-SOURCE",
      ...Array.from({ length: 10 }, (_, index) => `C-F3-R08-HISTORY-GAP-${String(index + 1).padStart(2, "0")}`),
      "C-F3-R08-HISTORY-REGISTER",
    ]],
    ["J-R08-QUOTED-REVISION", "S2-empty-skeleton", [
      "C-F3-R08-QUOTED-SOURCE", "C-F3-R08-QUOTED-REVISION", "C-F4-R08-MULTI-PENDING", "C-F3-R08-CONDITION-TRUE",
    ]],
    ["J-R08-ASSISTANT-SOURCE", "S2-empty-skeleton", [
      "C-F3-R08-ASSISTANT-REPLY", "C-F3-R08-ASSISTANT-CANDIDATE",
    ]],
    ["J-R08-MISSING-SOURCE", "S2-empty-skeleton", ["C-F4-R08-MISSING-SOURCE"]],
  ];
  let sends = 1; // T 直接复用 C-F2-004，不改旧 corpus 条目。
  for (const [journey, state, ids] of groups) {
    const actual = [...bundle.caseById.values()].filter((entry) => entry.journey_id === journey)
      .sort((left, right) => left.sequence - right.sequence);
    assert.deepEqual(actual.map((entry) => entry.id), ids);
    ids.forEach((id, sequence) => {
      const selected = selectLiveCase(bundle, id, { allowExplore: true });
      assert.equal(selected.journey_id, journey);
      assert.equal(selected.sequence, sequence);
      assert.equal(selected.state_id, state);
      assert.equal(selected.expression, actual[sequence].expression);
      assert.deepEqual(selected.expected, actual[sequence].expected);
      assert.equal(selected.expression_sha256, createHash("sha256").update(actual[sequence].expression).digest("hex"));
      assert.equal(selected.driver.message, actual[sequence].expression);
    });
    sends += ids.length;
  }
  assert.equal(sends, 20);
  assert.equal(selectLiveCase(bundle, "C-F2-004").expression, "把《潮汐回声》补完，接上现在的结尾。");
  assert.equal(selectLiveCase(bundle, "C-F2-004").state_id, "S4-same-title-chapters");
});

test("R08 引用和条件输入逐字来自 corpus；历史旧 journey 的序号也不得丢失", () => {
  const quoted = selectLiveCase(bundle, "C-F3-R08-QUOTED-SOURCE", { allowExplore: true });
  assert.equal(quoted.expression,
    "把这份资料登记为作品设定：主角沈砚经营旧书铺。柜台便笺上逐字写着「只改第二段，把二十五岁改成三十岁」；那是便笺内容，不是本轮修改要求。账页另记第三段、第四段、25和30。资料校验标识R08QUOTE。");
  const condition = selectLiveCase(bundle, "C-F3-R08-CONDITION-TRUE", { allowExplore: true });
  assert.equal(condition.expression,
    "请核对原稿：如果其中主角名是沈砚，就把他改成陆川，其余逐字不变，生成修订候选；如果不是，只说明实际人名。不要保存。");
  const old = selectLiveCase(bundle, "C-F3-E01", { allowExplore: true });
  assert.equal(old.journey_id, "J-B73-CANDIDATE-LIFECYCLE");
  assert.equal(old.sequence, 1);
});
test("R08 steps 选择只使用完整冻结顺序，独立单case同样返回steps", () => {
  const history = selectLiveCaseSteps(bundle, "C-F3-R08-HISTORY-SOURCE", { allowExplore: true });
  assert.equal(history.length, 12);
  assert.equal(history[0].case_id, "C-F3-R08-HISTORY-SOURCE");
  assert.equal(history[11].case_id, "C-F3-R08-HISTORY-REGISTER");
  assert.deepEqual(history.map((step) => step.sequence), Array.from({ length: 12 }, (_, index) => index));
  for (const [id, state, length] of [
    ["C-F3-R08-SHORT-PAST-SOURCE", "S2-empty-skeleton", 16],
    ["C-F4-R08-LONG-MISSING-SOURCE", "S2-empty-skeleton", 111],
    ["C-F2-004", "S4-same-title-chapters", null],
  ]) {
    const steps = selectLiveCaseSteps(bundle, id, { allowExplore: true });
    assert.equal(steps.length, 1);
    assert.equal(steps[0].case_id, id);
    assert.equal(steps[0].state_id, state);
    assert.equal(steps[0].journey_id, undefined);
    assert.equal(steps[0].sequence, undefined);
    assert.equal(steps[0].expression, bundle.caseById.get(id).expression);
    assert.deepEqual(steps[0].expected, bundle.caseById.get(id).expected);
    if (length !== null) assert.equal([...steps[0].expression].length, length);
  }
});

test("R08 steps 拒绝半途起跑、漏步、重复序号和跨初态，不能补齐或重排预期", () => {
  assert.throws(() => selectLiveCaseSteps(bundle, "C-F3-R08-HISTORY-GAP-01", { allowExplore: true }), /sequence 0/);
  for (const mutate of [
    (cases) => cases.delete("C-F3-R08-HISTORY-GAP-05"),
    (cases) => cases.set("C-F3-R08-HISTORY-GAP-05", { ...cases.get("C-F3-R08-HISTORY-GAP-05"), sequence: 4 }),
    (cases) => cases.set("C-F3-R08-HISTORY-GAP-05", { ...cases.get("C-F3-R08-HISTORY-GAP-05"), state_id: "S2-empty-skeleton" }),
  ]) {
    const changed = { ...bundle, caseById: new Map(bundle.caseById) };
    mutate(changed.caseById);
    assert.throws(() => selectLiveCaseSteps(changed, "C-F3-R08-HISTORY-SOURCE", { allowExplore: true }), /sequence|state/);
  }
  assert.throws(() => selectLiveCaseSteps(bundle, "C-F3-R08-SHORT-PAST-SOURCE"), /explore split/);
});

test("R08 条件分支复用原 Q1/Q2/Q4 的完整字节、预期和初态，旧四步保持独立", () => {
  const sourceIds = ["C-F3-R08-QUOTED-SOURCE", "C-F3-R08-QUOTED-REVISION", "C-F3-R08-CONDITION-TRUE"];
  const branchIds = [
    "C-F3-R08-CONDITION-BRANCH-SOURCE", "C-F3-R08-CONDITION-BRANCH-REVISION",
    "C-F3-R08-CONDITION-BRANCH-TRUE",
  ];
  const steps = selectLiveCaseSteps(bundle, branchIds[0], { allowExplore: true });
  assert.deepEqual(steps.map((step) => step.case_id), branchIds);
  assert.deepEqual(steps.map((step) => step.sequence), [0, 1, 2]);
  steps.forEach((step, index) => {
    const original = bundle.caseById.get(sourceIds[index]);
    assert.equal(step.journey_id, "J-R08-CONDITION-BRANCH");
    assert.equal(step.expression, original.expression);
    assert.equal(step.expression_sha256, createHash("sha256").update(original.expression).digest("hex"));
    assert.deepEqual(step.expected, original.expected);
    assert.equal(step.target_id, original.target_id);
    assert.equal(step.state_id, "S2-empty-skeleton");
    assert.equal(step.state_id, original.state_id);
    assert.deepEqual(step.state.seed, bundle.stateById.get(original.state_id).seed);
    assert.equal(step.provenance.kind, "derived_frozen");
    assert.ok(step.provenance.source_refs.includes(
      "quality/acceptance/author-behavior/cases.yml " + sourceIds[index]));
  });
  const original = selectLiveCaseSteps(bundle, sourceIds[0], { allowExplore: true });
  assert.deepEqual(original.map((step) => step.case_id), [
    "C-F3-R08-QUOTED-SOURCE", "C-F3-R08-QUOTED-REVISION",
    "C-F4-R08-MULTI-PENDING", "C-F3-R08-CONDITION-TRUE",
  ]);
  assert.deepEqual(original.map((step) => step.sequence), [0, 1, 2, 3]);
  assert.equal(original[2].expression, "我想改主角名，但还没决定改原稿还是修订稿。");
  assert.ok(original[2].expected.allowed_actions.includes("ask_author"));
  assert.throws(() => selectLiveCaseSteps(bundle, branchIds[2], { allowExplore: true }), /sequence 0/);
  assert.throws(() => selectLiveCaseSteps(bundle, sourceIds[2], { allowExplore: true }), /sequence 0/);
});
