// B84 A2：AU-15 准备检查器的唯一合成输入 owner。
//
// 这里只放普通 JS 字面值/纯构造函数，不 import 被测实现（au15_preregistration_check.mjs），
// 不读真实 artifacts/预注册/场景，也不定义 DSL：
//   - preregFixture/scenarioFixture：纯判定测试的内存输入；
//   - scenarioYaml/fixtureProjectSpec：IO 测试需要的「相对路径 + 内容」规格；
//   - inputFixture：两测试共享的完整输入形状（纯测试直接改字段构造反例）。
//
// 现有 au15_evidence/native_au15 fixtures 是响应/运行证据，不是同一个预注册规格，
// 因此不复用；本文件是这一契约的唯一合成输入来源。

export const PREREG_PATH = "artifacts/model-contracts/b39-cp1/au15-preregistration.json";
export const SCENARIO_PATH = "quality/acceptance/scenarios/au15-evidence-seeking-native.yml";
export const OUT_DIR = "artifacts/b42-prep";

export const HARNESS_FILES = Object.freeze([
  "scripts/native_au15_evidence_seeking_batch.sh",
  "scripts/native_au15_evidence_seeking_drive.mjs",
  "scripts/native_au15_evidence_seeking_evidence.mjs",
  "scripts/seed_au15_evidence_seeking.exs",
]);

const EVIDENCE_REQUIRED = Object.freeze([
  "native AX/截图",
  "native-transport",
  "app-log",
  "llm-calls",
  "observations",
  "trace summary",
  "只读 DB 快照",
]);

// 旧 v1 预算/单槽声明（不新增 frozen 字段）。
export function preregFixture() {
  return {
    schema: "au15-cp1-preregistration/v1",
    status: "blocked_pending_author_resource_and_setup",
    model: {
      provider: "strata",
      model: "iq3_s",
      single_slot: true,
      unload_after: true,
    },
    setup: {
      mode: "d6a",
      rule: "D6-A：前置章节由真实模型创作 + 外部真实页面采纳",
    },
    budget: {
      input_timeout_ms: 120000,
      turn_timeout_ms: 360000,
      heartbeat_ms: 10000,
      A1_A2_runs: 2,
      retries: 0,
    },
    evidence: { required: [...EVIDENCE_REQUIRED] },
    no_run_until: [
      "作者授权资源窗口",
      "D6-A 前置章节真实创作/采纳完成",
      "本预注册落盘复核",
    ],
  };
}

export function scenarioFixture() {
  return {
    id: "au15-evidence-seeking-native",
    status: "blocked",
    default_provider: "strata",
    setup: {
      provider: "strata",
      model: "iq3_s",
      d6a_precondition: "not_satisfied",
    },
  };
}

export function scenarioYaml() {
  return [
    "id: au15-evidence-seeking-native",
    'title: "AU-15 合成准备材料"',
    "tier: release-real-llm",
    "surface: tauri",
    "default_provider: strata",
    "status: blocked",
    "setup:",
    "  provider: strata",
    "  model: iq3_s",
    "  d6a_precondition: not_satisfied",
    "",
  ].join("\n");
}

/** 完整输入形状；纯测试只改字段，不从 SUT 导出期望常量。 */
export function inputFixture() {
  return {
    preregPath: PREREG_PATH,
    scenarioPath: SCENARIO_PATH,
    prereg: preregFixture(),
    scenario: scenarioFixture(),
    harnessFiles: HARNESS_FILES.map((path) => ({ path, exists: true })),
  };
}

/** IO 测试用「相对路径 + 内容」规格；由 materializeFixture 在 before 内一次物化。 */
export function fixtureProjectSpec() {
  const files = {
    [PREREG_PATH]: `${JSON.stringify(preregFixture(), null, 2)}\n`,
    [SCENARIO_PATH]: scenarioYaml(),
  };
  for (const file of HARNESS_FILES) files[file] = "";
  return { name: "au15-prereg", files };
}
