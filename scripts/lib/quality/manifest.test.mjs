// B41 CP1：manifest 校验/解析的负例与回归测试。
// 运行：node --test scripts/lib/quality/manifest.test.mjs
//
// 原则：非法 YAML、重复键、词表漂移、draft/注册错误都必须硬失败；
// 不能用正则解析替代标准解析器（测试直接覆盖 yaml_bridge 产物）。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_PROJECT_ROOT,
  collectScenarioManifestFiles,
  idsByTier,
  loadProject,
  loadRegistry,
  parseYamlFiles,
  validate,
  validateProject,
} from "./manifest.mjs";

const REPAIRED_YAML = [
  "quality/acceptance/scenarios/agentic-loop-budget-deviation-replan.yml",
  "quality/acceptance/scenarios/au13-review-adjudication-roundtrip.yml",
  "quality/acceptance/scenarios/b27-prompt-lifecycle-consistency.yml",
];

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root, rel, content) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function minimalManifest(id, overrides = {}) {
  const base = {
    id,
    title: `fixture ${id}`,
    tier: "nightly",
    surface: "browser",
    entrypoint: `bash scripts/quality_accept.sh ${id} --surface browser`,
    contract: ["docs/design/00-vision-and-engineering-roadmap.md"],
    invariants: ["fixture-invariant"],
    setup: { provider: "slice_verify" },
    user_flow: [{ open: "real workbench" }],
    evidence: { required: ["summary_json"], artifact_dir: `artifacts/slice-verify/${id}` },
    assertions: { ui: ["fixture assertion"] },
    anti_hooks: {
      product_acceptance_logic_added: false,
      data_testid_required: false,
      hidden_dom_metadata_required: false,
      product_autorun_required: false,
    },
  };
  return { ...base, ...overrides };
}

function buildFixtureProject({ scenarioOverrides = {}, extraManifests = {}, indexExtra = "" } = {}) {
  const root = mkdtemp("quality-manifest-");
  const scenarioIds = ["alpha-one", "alpha-two", "alpha-three", "alpha-four", "alpha-five"];
  writeFile(root, "frontend/slice-verify/fixture-driver.mjs", "// fixture driver\n");
  const indexEntries = [];
  for (const id of scenarioIds) {
    const override = scenarioOverrides[id] ?? {};
    const status = override.status ?? "active";
    const tone = status === "blocked" ? "blocked" : "active";
    const extra = status === "blocked" ? `    status: blocked\n    blocked_reason: "fixture blocked"\n` : "";
    indexEntries.push(
      [
        `  - id: ${id}`,
        `    title: "fixture ${id}"`,
        `    tier: nightly`,
        `    surface: browser`,
        `    manifest: quality/acceptance/scenarios/${id}.yml`,
        `    driver: frontend/slice-verify/fixture-driver.mjs`,
        `    entrypoint: bash scripts/quality_accept.sh ${id} --surface browser`,
        extra.trimEnd(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    writeFile(root, `quality/acceptance/scenarios/${id}.yml`, `${JSON.stringify(
      minimalManifest(id, { ...override, ...(override.manifestOverrides ?? {}) }),
    )}\n`);
  }
  for (const [rel, content] of Object.entries(extraManifests)) {
    writeFile(root, rel, content);
  }
  const index = ["scenarios:", ...indexEntries, indexExtra].join("\n");
  writeFile(root, "quality/acceptance/scenarios.yml", `${index}\n`);
  return root;
}

function validateFixture(root) {
  const project = loadProject(root);
  return validateProject(project, { skipExternalChecks: true });
}

// B40（2026-10-27）场景重锚后 registry 事实：退役 6（e2e-01-downgrade-real-page、
// au07-gate-reason-why、gap-wt04-non-exploration-frame-badges、agent-provider-streaming-progress、
// au10-micro-plan-entry、au01-garbage-json-recovery）+ 新增 pr-smoke-core-reply。
// B41 CP5 记录（212/2/214）是当时快照；本测试随当前 registry 事实维护，防止 manifest
// 集合漂移，不把历史数字当 PASS 依据。
test("真实仓库：manifest 校验通过，含 2 份 draft 与 209 份 manifest", () => {
  const { project, errors } = validate(DEFAULT_PROJECT_ROOT);
  assert.deepEqual(errors, []);
  assert.equal(project.scenarios.length, 207);
  assert.equal(project.drafts.length, 2);
  assert.equal(project.files.size, 209);
});

test("真实仓库：CP0 修复的 3 个 YAML 可被标准解析器读取（回归）", () => {
  const bundle = parseYamlFiles(DEFAULT_PROJECT_ROOT, REPAIRED_YAML);
  for (const record of bundle.files) {
    assert.equal(record.ok, true, `${record.path}: ${record.error}`);
  }
});

test("非法 YAML 必须硬失败（含行号）", () => {
  const root = buildFixtureProject();
  writeFile(
    root,
    "quality/acceptance/scenarios/alpha-one.yml",
    "id: alpha-one\ntitle: broken\n  unexpected: indent\n",
  );
  const { errors } = validateFixture(root);
  assert.ok(
    errors.some((error) => error.includes("alpha-one.yml") && error.includes("YAML 解析失败") && /:\d+:\d+/u.test(error)),
    errors.join("\n"),
  );
});

test("YAML 重复键必须硬失败", () => {
  const root = buildFixtureProject();
  const id = "alpha-two";
  const file = path.join(root, `quality/acceptance/scenarios/${id}.yml`);
  const content = fs.readFileSync(file, "utf8");
  const duplicated = content.replace('"tier":"nightly"', '"tier":"nightly","tier":"nightly"');
  assert.notEqual(content, duplicated);
  fs.writeFileSync(file, duplicated);
  const { errors } = validateFixture(root);
  assert.ok(errors.some((error) => error.includes("duplicate key")), errors.join("\n"));
});

test("证据词表漂移必须失败并给出迁移提示", () => {
  const root = buildFixtureProject({
    scenarioOverrides: {
      "alpha-three": { manifestOverrides: { evidence: { required: ["llm_calls"], artifact_dir: "artifacts/slice-verify/alpha-three" } } },
    },
  });
  const { errors } = validateFixture(root);
  assert.ok(
    errors.some((error) => error.includes("llm_calls") && error.includes("llm_http_log")),
    errors.join("\n"),
  );
});

test("证据 required_artifacts 只允许 artifacts/ 下 repo 相对路径", () => {
  const root = buildFixtureProject({
    scenarioOverrides: {
      "alpha-four": {
        manifestOverrides: {
          evidence: {
            required: ["summary_json"],
            required_artifacts: ["/tmp/absolute.json"],
            artifact_dir: "artifacts/slice-verify/alpha-four",
          },
        },
      },
    },
  });
  const { errors } = validateFixture(root);
  assert.ok(
    errors.some((error) => error.includes("required_artifacts") && error.includes("/tmp/absolute.json")),
    errors.join("\n"),
  );
});

test("缺少必需键、anti_hooks 非 false、blocked 缺 reason 都必须失败", () => {
  const root = buildFixtureProject({
    scenarioOverrides: {
      "alpha-one": { manifestOverrides: { assertions: undefined } },
      "alpha-two": { manifestOverrides: { anti_hooks: { product_acceptance_logic_added: true, data_testid_required: false, hidden_dom_metadata_required: false, product_autorun_required: false } } },
      "alpha-five": { status: "blocked" },
    },
  });
  const { errors } = validateFixture(root);
  assert.ok(errors.some((error) => error.includes("缺少必需键 assertions")), errors.join("\n"));
  assert.ok(errors.some((error) => error.includes("anti_hooks.product_acceptance_logic_added")), errors.join("\n"));
  assert.ok(!errors.some((error) => error.includes("alpha-five") && error.includes("blocked_reason")), "fixture 已带 blocked_reason");
});

test("blocked 缺 blocked_reason 必须失败", () => {
  const root = buildFixtureProject();
  const indexFile = path.join(root, "quality/acceptance/scenarios.yml");
  const content = fs.readFileSync(indexFile, "utf8");
  fs.writeFileSync(
    indexFile,
    content.replace(
      /  - id: alpha-five\n([\s\S]*?)entrypoint:.*\n/u,
      (match) => `${match}    status: blocked\n`,
    ),
  );
  const { errors } = validateFixture(root);
  assert.ok(errors.some((error) => error.includes("alpha-five") && error.includes("blocked_reason")), errors.join("\n"));
});

test("重复 scenario id 必须失败", () => {
  const root = buildFixtureProject();
  const indexFile = path.join(root, "quality/acceptance/scenarios.yml");
  const content = fs.readFileSync(indexFile, "utf8");
  fs.writeFileSync(indexFile, `${content}\n${content.split("\n")[1]}\n`);
  const { errors } = validateFixture(root);
  assert.ok(errors.some((error) => error.includes("scenario id 重复")), errors.join("\n"));
});

test("未注册 manifest 必须失败；登记为 draft 后通过并永不执行", () => {
  const root = buildFixtureProject();
  const strayPath = "quality/acceptance/scenarios/stray-draft.yml";
  writeFile(
    root,
    strayPath,
    `${JSON.stringify(minimalManifest("stray-draft", { tier: "deterministic", surface: "test", status_note: "draft fixture" }))}\n`,
  );

  let { errors } = validateFixture(root);
  assert.ok(errors.some((error) => error.includes("stray-draft.yml") && error.includes("未注册")), errors.join("\n"));

  const indexFile = path.join(root, "quality/acceptance/scenarios.yml");
  fs.appendFileSync(
    indexFile,
    [
      "drafts:",
      "  - id: stray-draft",
      `    manifest: ${strayPath}`,
      '    reason: "fixture draft not registered for execution"',
      "",
    ].join("\n"),
  );

  ({ errors } = validateFixture(root));
  assert.deepEqual(errors, []);
  const project = loadProject(root);
  assert.deepEqual(idsByTier(project, "nightly"), [
    "alpha-one",
    "alpha-two",
    "alpha-three",
    "alpha-four",
    "alpha-five",
  ]);
  assert.ok(!idsByTier(project, "nightly").includes("stray-draft"));
});

test("idsByTier 只返回 active 场景（blocked 不进入夜间批次）", () => {
  const root = buildFixtureProject({
    scenarioOverrides: {
      "alpha-one": { status: "blocked" },
    },
  });
  const project = loadProject(root);
  const ids = idsByTier(project, "nightly");
  assert.ok(!ids.includes("alpha-one"));
  assert.ok(ids.includes("alpha-two"));
});

test("draft 与 scenarios 重复登记必须失败", () => {
  const root = buildFixtureProject();
  const indexFile = path.join(root, "quality/acceptance/scenarios.yml");
  fs.appendFileSync(
    indexFile,
    ["drafts:", "  - id: alpha-one", "    manifest: quality/acceptance/scenarios/alpha-one.yml", '    reason: "dup"', ""].join("\n"),
  );
  const { errors } = validateFixture(root);
  assert.ok(errors.some((error) => error.includes("同时出现在 scenarios")), errors.join("\n"));
});

test("draft manifest 缺 status_note 必须失败", () => {
  const root = buildFixtureProject();
  const strayPath = "quality/acceptance/scenarios/stray-draft.yml";
  writeFile(
    root,
    strayPath,
    `${JSON.stringify(minimalManifest("stray-draft", { tier: "deterministic", surface: "test" }))}\n`,
  );
  const indexFile = path.join(root, "quality/acceptance/scenarios.yml");
  fs.appendFileSync(
    indexFile,
    ["drafts:", "  - id: stray-draft", `    manifest: ${strayPath}`, '    reason: "draft"', ""].join("\n"),
  );
  const { errors } = validateFixture(root);
  assert.ok(errors.some((error) => error.includes("status_note")), errors.join("\n"));
});

test("registry 解析失败给出可读错误（含行号）", () => {
  const root = mkdtemp("quality-manifest-bad-index-");
  writeFile(root, "quality/acceptance/scenarios.yml", "scenarios:\n  - id: broken\n    tier: [unclosed\n");
  assert.throws(
    () => loadRegistry(root),
    (error) => error.message.includes("scenarios.yml") && /:\d+:\d+/u.test(error.message),
  );
});

test("场景 manifest 文件集合只包含 scenarios/ 下 yml", () => {
  const files = collectScenarioManifestFiles(DEFAULT_PROJECT_ROOT);
  // B40 重锚后 207（原 214 − 首批退役 6 − au05-adoption-safety-freshness + pr-smoke-core-reply + b47-canon-freshness）；数字随当前 registry 事实维护。
  assert.equal(files.length, 209);
  assert.ok(files.every((file) => file.startsWith("quality/acceptance/scenarios/") && file.endsWith(".yml")));
});
