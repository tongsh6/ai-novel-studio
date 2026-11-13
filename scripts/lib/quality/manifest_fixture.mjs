// B41 manifest 测试的唯一合成 fixture owner。
//
// 这里只放普通 JS 字面值/纯构造函数，不 import 被测实现（manifest.mjs），
// 不读 artifacts/真实作者数据，也不定义 DSL：
//   - minimalManifest/scenarioEntry/draftEntry：独立期望输入；
//   - fixtureIndex/fixtureProjectSpec：需要真实 YAML/文件发现的 IO 测试规格
//     （相对路径 + 内容）；
//   - memoryFixtureProject：纯语义测试用的内存 Project/事实值，不先写文件再读回。
//
// 旧复制（manifest.test.mjs 内的 minimalManifest/buildFixtureProject）已退役；
// 新增测试只能复用本文件，避免两份 fixture 漂移。

export const SCENARIO_IDS = Object.freeze([
  "alpha-one",
  "alpha-two",
  "alpha-three",
  "alpha-four",
  "alpha-five",
]);

export const DRIVER_PATH = "frontend/slice-verify/fixture-driver.mjs";

// B41 CP0 修复过、必须能被标准解析器读取的真实仓库回归样本。
export const REPAIRED_YAML = Object.freeze([
  "quality/acceptance/scenarios/agentic-loop-budget-deviation-replan.yml",
  "quality/acceptance/scenarios/au13-review-adjudication-roundtrip.yml",
  "quality/acceptance/scenarios/b27-prompt-lifecycle-consistency.yml",
]);

export const MINIMAL_MANIFEST = Object.freeze({
  title: "fixture manifest",
  tier: "nightly",
  surface: "browser",
  contract: ["docs/design/00-vision-and-engineering-roadmap.md"],
  invariants: ["fixture-invariant"],
  setup: { provider: "slice_verify" },
  user_flow: [{ open: "real workbench" }],
  evidence: { required: ["summary_json"], artifact_dir: "artifacts/slice-verify/fixture" },
  assertions: { ui: ["fixture assertion"] },
  anti_hooks: {
    product_acceptance_logic_added: false,
    data_testid_required: false,
    hidden_dom_metadata_required: false,
    product_autorun_required: false,
  },
});

function compact(value) {
  const result = { ...value };
  for (const key of Object.keys(result)) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}

/** undefined 表示省略该键（与旧 JSON 物化后再解析的语义一致，不是 DSL 指令）。 */
export function minimalManifest(id, overrides = {}) {
  return compact({
    ...MINIMAL_MANIFEST,
    id,
    title: `fixture ${id}`,
    entrypoint: `bash scripts/quality_accept.sh ${id} --surface browser`,
    ...overrides,
  });
}

export function scenarioEntry(id, overrides = {}) {
  return compact({
    id,
    title: `fixture ${id}`,
    tier: "nightly",
    surface: "browser",
    manifest: `quality/acceptance/scenarios/${id}.yml`,
    driver: DRIVER_PATH,
    entrypoint: `bash scripts/quality_accept.sh ${id} --surface browser`,
    ...overrides,
  });
}

export function draftEntry(id, manifestPath, reason = "fixture draft") {
  return { id, manifest: manifestPath, reason };
}

export function fixtureIndex() {
  const lines = ["scenarios:"];
  for (const id of SCENARIO_IDS) {
    const entry = scenarioEntry(id);
    lines.push(
      `  - id: ${entry.id}`,
      `    title: ${JSON.stringify(entry.title)}`,
      `    tier: ${entry.tier}`,
      `    surface: ${entry.surface}`,
      `    manifest: ${entry.manifest}`,
      `    driver: ${entry.driver}`,
      `    entrypoint: ${entry.entrypoint}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** 真实 IO 测试的只读 fixture 规格（由 test_env.mjs 原子发布一次）。 */
export function fixtureProjectSpec() {
  const files = {
    [DRIVER_PATH]: "// fixture driver\n",
    "quality/acceptance/scenarios.yml": fixtureIndex(),
  };
  for (const id of SCENARIO_IDS) {
    files[`quality/acceptance/scenarios/${id}.yml`] = `${JSON.stringify(minimalManifest(id))}\n`;
  }
  return { name: "quality-manifest", files };
}

/**
 * 纯语义测试的内存 Project：显式给出 registry、manifest 记录与 IO 事实
 * （manifestFiles/existingDrivers），不触发任何文件读取。
 */
export function memoryFixtureProject({
  scenarioOverrides = {},
  extraScenarios = [],
  drafts = [],
  manifestOverrides = {},
  extraManifests = {},
  manifestFiles,
  existingDrivers,
} = {}) {
  const scenarios = [];
  for (const id of SCENARIO_IDS) {
    const override = scenarioOverrides[id] ?? {};
    const entry = scenarioEntry(id, override);
    if (override.status === "blocked" && !("blocked_reason" in override)) {
      entry.blocked_reason = "fixture blocked";
    }
    scenarios.push(entry);
  }
  scenarios.push(...extraScenarios.map(compact));

  const manifests = {};
  for (const id of SCENARIO_IDS) {
    manifests[`quality/acceptance/scenarios/${id}.yml`] = minimalManifest(
      id,
      manifestOverrides[id] ?? {},
    );
  }
  Object.assign(manifests, extraManifests);

  const files = new Map(
    Object.keys(manifests)
      .sort()
      .map((rel) => [rel, { path: rel, ok: true, data: manifests[rel] }]),
  );
  const filesOnDisk =
    manifestFiles ??
    Object.keys(manifests)
      .filter((rel) => rel.startsWith("quality/acceptance/scenarios/"))
      .sort();

  return {
    projectRoot: "/quality-manifest-memory-fixture",
    registry: { scenarios, drafts },
    scenarios,
    drafts,
    files,
    manifestFiles: [...filesOnDisk].sort(),
    existingDrivers: new Set(existingDrivers ?? [DRIVER_PATH]),
    python: "memory",
    pyyaml: "memory",
  };
}
