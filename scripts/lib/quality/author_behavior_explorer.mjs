// B70 CP2：author-behavior 状态驱动探索器（确定性种子、转移覆盖、失败轨迹与缩化）。
//
// 外部页面 runner 只消费本模块生成的计划；探索动作仍通过真实可见 UI 执行。
// 本模块不判语义正确性：每步正确性由 author_behavior_oracle 独立判卷。
import crypto from "node:crypto";

export const EXPLORER_VERSION = "author-behavior-explorer/v1";

/** mulberry32：小而确定的 seeded PRNG（跨进程同 seed 同序列）。 */
export function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function corpusCases(corpus) {
  return Array.isArray(corpus?.cases) ? corpus.cases : corpus?.cases?.cases ?? [];
}

function corpusStates(corpus) {
  return Array.isArray(corpus?.states) ? corpus.states : corpus?.states?.states ?? [];
}

function stateWorkTitle(states, stateId) {
  return (
    states.find((state) => state.id === stateId)?.fixture?.work_title ??
    (stateId === "S1-partial-multichapter"
      ? "B70 S1 部分多章"
      : stateId === "S2-empty-skeleton"
        ? "B70 S2 空骨架"
        : stateId === "S3-pending-candidate-context"
          ? "B70 S3 待采纳候选"
          : null)
  );
}

/**
 * 生成 seeded 探索计划：所有 pool case 至少发送一次，顺序随机；
 * 在发送之间随机插入真实作品切换（不改变 corpus/判据）。
 */
export function buildExplorationPlan(corpus, { seed, poolCaseIds, extraSwitchSteps = 2 } = {}) {
  const cases = new Map(corpusCases(corpus).map((testCase) => [testCase.id, testCase]));
  const pool = (poolCaseIds ?? []).map((caseId) => {
    const testCase = cases.get(caseId);
    if (!testCase) throw new Error(`unknown exploration case: ${caseId}`);
    return testCase;
  });
  if (pool.length === 0) throw new Error("exploration pool is empty");

  const random = createSeededRandom(seed);
  const states = corpusStates(corpus);
  const stateIds = [...new Set(pool.map((testCase) => testCase.state_id))];
  const shuffledPool = shuffle(pool, random);
  const steps = [];
  let currentStateId = null;

  const pushSwitch = (stateId) => {
    const workTitle = stateWorkTitle(states, stateId);
    if (!workTitle) throw new Error(`state without work title: ${stateId}`);
    currentStateId = stateId;
    steps.push({ index: steps.length, action: "switch_work", state_id: stateId, work_title: workTitle });
  };

  const maybeExtraSwitch = () => {
    if (steps.length === 0 || extraSwitchSteps <= 0) return;
    if (random() >= 0.35) return;
    const candidates = stateIds.filter((stateId) => stateId !== currentStateId);
    if (candidates.length === 0) return;
    const target = candidates[Math.floor(random() * candidates.length)];
    pushSwitch(target);
  };

  for (const testCase of shuffledPool) {
    if (currentStateId !== testCase.state_id) {
      pushSwitch(testCase.state_id);
    }
    maybeExtraSwitch();
    if (currentStateId !== testCase.state_id) {
      pushSwitch(testCase.state_id);
    }
    steps.push({
      index: steps.length,
      action: "send",
      case_id: testCase.id,
      state_id: testCase.state_id,
      expression: testCase.expression,
    });
  }

  const planHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ seed: Number(seed) >>> 0, steps }))
    .digest("hex");

  return {
    explorer_version: EXPLORER_VERSION,
    seed: Number(seed) >>> 0,
    plan_hash: planHash,
    steps,
  };
}

/** 把 plan 与 stepResults 汇总成转移/覆盖/失败报告。 */
export function summarizeExploration({ plan, stepResults, corpusSha }) {
  const transitions = [];
  const failures = [];
  const violations = [];
  let currentState = null;

  for (const step of plan.steps) {
    const result = stepResults.find((entry) => entry.step_index === step.index) ?? null;
    if (!result) {
      failures.push({ step_index: step.index, reason: "step_result_missing", action: step.action });
      continue;
    }
    if (step.action === "switch_work") {
      transitions.push({ from: currentState, action: "switch_work", to: step.state_id });
      currentState = step.state_id;
      continue;
    }

    const runState =
      result.observed?.action === "ask_author" ? "awaiting_author" : result.observed?.action === "reply" ? "completed" : "unknown";
    transitions.push({ from: currentState, action: `send:${step.case_id}`, to: currentState, run_state: runState });
    if (result.status === "fail" || result.status === "unknown") {
      failures.push({ step_index: step.index, case_id: step.case_id, status: result.status, reasons: result.reasons });
    }
    for (const violation of result.violations ?? []) {
      violations.push({ step_index: step.index, case_id: step.case_id, ...violation });
    }
  }

  const stateCoverage = [...new Set(transitions.flatMap((transition) => [transition.from, transition.to]).filter(Boolean))];
  const transitionKeys = [...new Set(transitions.map((transition) => `${transition.from ?? "start"}->${transition.action}->${transition.to ?? "none"}`))];

  return {
    explorer_version: EXPLORER_VERSION,
    seed: plan.seed,
    plan_hash: plan.plan_hash,
    corpus_sha: corpusSha,
    steps: plan.steps.length,
    sent_cases: [...new Set(plan.steps.filter((step) => step.action === "send").map((step) => step.case_id))],
    transitions,
    coverage: {
      states_visited: stateCoverage,
      states_declared: [...new Set(plan.steps.map((step) => step.state_id))],
      transition_keys: transitionKeys,
      send_actions: plan.steps.filter((step) => step.action === "send").length,
      switch_actions: plan.steps.filter((step) => step.action === "switch_work").length,
    },
    invariants_checked: [
      "G1-no-unauthorized-canon-write",
      "G2-object-identity",
      "G3-no-duplicate-side-effect",
      "G4-truthful-completion",
      "G5-supplied-vs-used",
      "G6-unknown-not-empty",
    ],
    failures,
    violations,
    status: failures.length === 0 && violations.length === 0 ? "pass" : "fail",
  };
}

/**
 * 失败缩化：贪心删除可去掉的步骤，保留与原始失败**同一违规类别**（或同一失败原因）的
 * 最小步骤序列。不把“另一个更短的失败”冒充原失败；无法保留同一类别时返回 null。
 */
export function shrinkFailureTrace({ plan, stepResults, violationCode = null, failureReason = null }) {
  const matchesFailure = (result) => {
    if (violationCode) return (result.violations ?? []).some((violation) => violation.behavior === violationCode);
    if (failureReason) return (result.reasons ?? []).includes(failureReason);
    return result.status === "fail" || result.status === "unknown";
  };
  const failingIndexes = new Set(stepResults.filter(matchesFailure).map((result) => result.step_index));
  if (failingIndexes.size === 0) return null;

  let keptSteps = plan.steps.filter((step) => stepResults.some((result) => result.step_index === step.index));
  const stillFails = () => {
    const keptIndexes = new Set(keptSteps.map((step) => step.index));
    return stepResults.some((result) => keptIndexes.has(result.step_index) && matchesFailure(result));
  };
  if (!stillFails()) return null;

  // 先删除不影响失败复现的 switch 步骤（优先删除位置靠前者；保留至少一个失败发送步骤）。
  for (const step of keptSteps.filter((entry) => entry.action === "switch_work")) {
    const candidate = keptSteps.filter((entry) => entry.index !== step.index);
    if (candidate.length === 0) continue;
    const keptIndexes = new Set(candidate.map((entry) => entry.index));
    if (stepResults.some((result) => keptIndexes.has(result.step_index) && matchesFailure(result))) {
      keptSteps = candidate;
    }
  }

  // 再删除不承载失败证据的 send 步骤，直到只剩复现同一失败所需的最小序列。
  for (const step of keptSteps.filter((entry) => entry.action === "send")) {
    const candidate = keptSteps.filter((entry) => entry.index !== step.index);
    const candidateIndexes = new Set(candidate.map((entry) => entry.index));
    if (![...failingIndexes].some((index) => candidateIndexes.has(index))) continue;
    if (stepResults.some((result) => candidateIndexes.has(result.step_index) && matchesFailure(result))) {
      keptSteps = candidate;
    }
  }

  return {
    minimal_steps: keptSteps,
    removed: plan.steps.length - keptSteps.length,
    preserved: violationCode ?? failureReason ?? "failure",
  };
}

export function failureFingerprint({ violationCode = null, failureReason = null, corpusSha, planHash }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ violationCode, failureReason, corpusSha, planHash }))
    .digest("hex");
}
