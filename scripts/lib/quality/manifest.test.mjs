// B41 CP1：manifest 纯语义规则的负例与回归测试。
// 运行：node --test scripts/lib/quality/manifest.test.mjs
//
// 职责边界（B84 A1/A2）：
// - 本文件只验证 validateProject 对内存 Project/事实值的纯判定，不写临时项目、
//   不读 YAML、不启动子进程/数据库；IO 事实由 loadProject 提供，测试直接构造。
// - 真实 YAML 解析、重复键、缺文件/未注册文件发现与真实仓库接线在
//   manifest_io.test.mjs；fixture 唯一 owner 是同目录 manifest_fixture.mjs。
// 原则：非法 YAML、词表漂移、draft/注册错误都必须硬失败；不能放宽既有规则。

import test from "node:test";
import assert from "node:assert/strict";
import { idsByTier, validateProject } from "./manifest.mjs";
import {
  DRIVER_PATH,
  SCENARIO_IDS,
  draftEntry,
  memoryFixtureProject,
  minimalManifest,
  scenarioEntry,
} from "./manifest_fixture.mjs";

function scenarioManifestPath(id) {
  return `quality/acceptance/scenarios/${id}.yml`;
}

test("纯语义：精确计数 + 合法 draft 通过且永不执行", () => {
  const draftPath = scenarioManifestPath("alpha-draft");
  const project = memoryFixtureProject({
    drafts: [draftEntry("alpha-draft", draftPath)],
    extraManifests: {
      [draftPath]: minimalManifest("alpha-draft", { status_note: "fixture draft" }),
    },
  });
  assert.equal(project.scenarios.length, 5);
  assert.equal(project.drafts.length, 1);
  assert.equal(project.files.size, 6);
  assert.deepEqual(validateProject(project).errors, []);
  assert.deepEqual(idsByTier(project, "nightly"), [...SCENARIO_IDS]);
  assert.equal(idsByTier(project, "nightly").includes("alpha-draft"), false);
});

test("纯语义：重复 id、重复 manifest 路径、越界路径全部拒绝", () => {
  const duplicateId = validateProject(
    memoryFixtureProject({ extraScenarios: [scenarioEntry("alpha-one")] }),
  );
  assert.ok(
    duplicateId.errors.some((error) => error.includes("scenario id 重复")),
    duplicateId.errors.join("\n"),
  );

  const duplicatePath = validateProject(
    memoryFixtureProject({
      extraScenarios: [
        scenarioEntry("alpha-six", { manifest: scenarioManifestPath("alpha-one") }),
      ],
    }),
  );
  assert.ok(
    duplicatePath.errors.some((error) => error.includes("复用同一 manifest")),
    duplicatePath.errors.join("\n"),
  );

  const outside = validateProject(
    memoryFixtureProject({
      extraScenarios: [scenarioEntry("alpha-out", { manifest: "quality/acceptance/other.yml" })],
    }),
  );
  assert.ok(
    outside.errors.some((error) => error.includes("必须位于")),
    outside.errors.join("\n"),
  );
});

test("纯语义：未注册的目录 manifest 事实必须拒绝", () => {
  const strayPath = scenarioManifestPath("stray");
  const project = memoryFixtureProject({
    extraManifests: { [strayPath]: minimalManifest("stray") },
    manifestFiles: [...SCENARIO_IDS.map(scenarioManifestPath), strayPath],
  });
  const { errors } = validateProject(project);
  assert.ok(
    errors.some((error) => error.includes("stray.yml") && error.includes("manifest 未注册")),
    errors.join("\n"),
  );
});

test("纯语义：证据词表漂移必须失败并给出迁移提示", () => {
  const project = memoryFixtureProject({
    manifestOverrides: {
      "alpha-three": {
        evidence: {
          required: ["llm_calls"],
          artifact_dir: "artifacts/slice-verify/alpha-three",
        },
      },
    },
  });
  const { errors } = validateProject(project);
  assert.ok(
    errors.some((error) => error.includes("llm_calls") && error.includes("llm_http_log")),
    errors.join("\n"),
  );
});

test("纯语义：证据 required_artifacts 只允许 artifacts/ 下 repo 相对路径", () => {
  const project = memoryFixtureProject({
    manifestOverrides: {
      "alpha-four": {
        evidence: {
          required: ["summary_json"],
          required_artifacts: ["/tmp/absolute.json"],
          artifact_dir: "artifacts/slice-verify/alpha-four",
        },
      },
    },
  });
  const { errors } = validateProject(project);
  assert.ok(
    errors.some(
      (error) => error.includes("required_artifacts") && error.includes("/tmp/absolute.json"),
    ),
    errors.join("\n"),
  );
});

test("纯语义：缺少必需键、anti_hooks 非 false、fixture blocked 带 reason 不误报", () => {
  const project = memoryFixtureProject({
    scenarioOverrides: { "alpha-five": { status: "blocked" } },
    manifestOverrides: {
      "alpha-one": { assertions: undefined },
      "alpha-two": {
        anti_hooks: {
          product_acceptance_logic_added: true,
          data_testid_required: false,
          hidden_dom_metadata_required: false,
          product_autorun_required: false,
        },
      },
    },
  });
  const { errors } = validateProject(project);
  assert.ok(
    errors.some((error) => error.includes("缺少必需键 assertions")),
    errors.join("\n"),
  );
  assert.ok(
    errors.some((error) => error.includes("anti_hooks.product_acceptance_logic_added")),
    errors.join("\n"),
  );
  assert.ok(
    !errors.some((error) => error.includes("alpha-five") && error.includes("blocked_reason")),
    "fixture 已带 blocked_reason",
  );
});

test("纯语义：blocked 缺 blocked_reason 必须失败", () => {
  const project = memoryFixtureProject({
    scenarioOverrides: { "alpha-five": { status: "blocked", blocked_reason: "" } },
  });
  const { errors } = validateProject(project);
  assert.ok(
    errors.some((error) => error.includes("alpha-five") && error.includes("blocked_reason")),
    errors.join("\n"),
  );
});

test("纯语义：idsByTier 只返回 active 场景（blocked 不进入夜间批次）", () => {
  const project = memoryFixtureProject({
    scenarioOverrides: { "alpha-one": { status: "blocked" } },
  });
  const ids = idsByTier(project, "nightly");
  assert.ok(!ids.includes("alpha-one"));
  assert.ok(ids.includes("alpha-two"));
});

test("纯语义：draft 与 scenarios 重复登记必须失败", () => {
  const project = memoryFixtureProject({
    drafts: [draftEntry("alpha-one", scenarioManifestPath("alpha-one"), "dup")],
  });
  const { errors } = validateProject(project);
  assert.ok(
    errors.some((error) => error.includes("同时出现在 scenarios")),
    errors.join("\n"),
  );
});

test("纯语义：draft manifest 缺 status_note 必须失败", () => {
  const draftPath = scenarioManifestPath("stray-draft");
  const project = memoryFixtureProject({
    drafts: [draftEntry("stray-draft", draftPath)],
    extraManifests: {
      [draftPath]: minimalManifest("stray-draft", { tier: "deterministic", surface: "test" }),
    },
  });
  const { errors } = validateProject(project);
  assert.ok(
    errors.some((error) => error.includes("status_note")),
    errors.join("\n"),
  );
});

test("纯语义：runner/surface/entrypoint 规则矩阵全部硬失败", () => {
  const cases = [
    [
      { runner: "slice_verify", surface: "tauri" },
      /runner slice_verify 要求 surface=browser/u,
    ],
    [{ runner: "tauri_slice_verify" }, /runner tauri_slice_verify 要求 surface=tauri/u],
    [
      {
        runner: "dogfood_run",
        default_provider: "other",
        entrypoint: "bash scripts/quality_accept.sh x --surface browser",
        driver: "other.mjs",
      },
      /dogfood_run 必须 default_provider=lmstudio/u,
    ],
    [
      {
        runner: "dogfood_run",
        entrypoint: "bash scripts/quality_accept.sh x --surface browser",
      },
      /dogfood_run entrypoint 必须指向 scripts\/dogfood_run\.sh/u,
    ],
    [
      {
        runner: "dogfood_run",
        entrypoint: "bash scripts/dogfood_run.sh x --surface browser",
        driver: "other.mjs",
      },
      /dogfood_run driver 必须是 dogfood-runner\.mjs/u,
    ],
    [
      {
        runner: "e2e_aggregate",
        default_provider: "other",
        entrypoint: "bash scripts/quality_accept.sh x --surface browser",
        driver: "other.mjs",
      },
      /e2e_aggregate 必须 default_provider=lmstudio/u,
    ],
    [
      {
        runner: "e2e_aggregate",
        entrypoint: "bash scripts/quality_accept.sh x --surface browser",
      },
      /e2e_aggregate entrypoint 必须指向 scripts\/e2e_01_full_chain_check\.sh/u,
    ],
    [
      {
        runner: "e2e_aggregate",
        entrypoint: "bash scripts/e2e_01_full_chain_check.sh x --surface browser",
        driver: "other.mjs",
      },
      /e2e_aggregate driver 必须是 scripts\/e2e_01_full_chain_check\.sh/u,
    ],
    [{ runner: "bogus" }, /不支持的 runner bogus/u],
    [
      {
        runner: "tauri_slice_verify",
        surface: "tauri",
        entrypoint: "bash scripts/slice_verify.sh x --surface tauri",
      },
      /tauri 场景不能路由到 browser slice_verify\.sh/u,
    ],
    [
      {
        runner: "slice_verify",
        entrypoint: "bash scripts/tauri_slice_verify.sh x --surface browser",
      },
      /browser 场景不能路由到 tauri_slice_verify\.sh/u,
    ],
    [
      { entrypoint: "bash scripts/quality_accept.sh x" },
      /entrypoint 未包含 --surface browser/u,
    ],
    [{ tier: "nope" }, /未知 tier nope/u],
    [{ surface: "nope" }, /未知 surface nope/u],
    [{ status: "draft" }, /未知 status draft/u],
  ];
  for (const [override, message] of cases) {
    const { errors } = validateProject(
      memoryFixtureProject({ scenarioOverrides: { "alpha-one": override } }),
    );
    assert.ok(
      errors.some((error) => message.test(error)),
      `${JSON.stringify(override)} 缺少 ${message}: ${errors.join("\n")}`,
    );
  }
});

test("纯语义：合法 dogfood/e2e runner driver 正例（裸名与仓库路径）", () => {
  const dogfoodEntrypoint = "bash scripts/dogfood_run.sh --surface browser";
  const e2eEntrypoint = "bash scripts/e2e_01_full_chain_check.sh --surface browser";
  const dogfoodPath = scenarioManifestPath("alpha-dogfood");
  const barePath = scenarioManifestPath("alpha-dogfood-bare");
  const e2ePath = scenarioManifestPath("alpha-e2e");
  const project = memoryFixtureProject({
    extraScenarios: [
      scenarioEntry("alpha-dogfood", {
        runner: "dogfood_run",
        default_provider: "lmstudio",
        driver: "frontend/slice-verify/dogfood-runner.mjs",
        entrypoint: dogfoodEntrypoint,
      }),
      scenarioEntry("alpha-dogfood-bare", {
        runner: "dogfood_run",
        default_provider: "lmstudio",
        driver: "dogfood-runner.mjs",
        entrypoint: dogfoodEntrypoint,
      }),
      scenarioEntry("alpha-e2e", {
        runner: "e2e_aggregate",
        default_provider: "lmstudio",
        driver: "scripts/e2e_01_full_chain_check.sh",
        entrypoint: e2eEntrypoint,
      }),
    ],
    extraManifests: {
      [dogfoodPath]: minimalManifest("alpha-dogfood", {
        runner: "dogfood_run",
        default_provider: "lmstudio",
        entrypoint: dogfoodEntrypoint,
      }),
      [barePath]: minimalManifest("alpha-dogfood-bare", {
        runner: "dogfood_run",
        default_provider: "lmstudio",
        entrypoint: dogfoodEntrypoint,
      }),
      [e2ePath]: minimalManifest("alpha-e2e", {
        runner: "e2e_aggregate",
        default_provider: "lmstudio",
        entrypoint: e2eEntrypoint,
      }),
    },
    existingDrivers: [
      DRIVER_PATH,
      "frontend/slice-verify/dogfood-runner.mjs",
      "dogfood-runner.mjs",
      "scripts/e2e_01_full_chain_check.sh",
    ],
  });
  assert.deepEqual(validateProject(project).errors, []);
});

test("纯语义：非法 scenario 项、缺少字段与非法 manifest 数据 fail-closed", () => {
  const missingField = memoryFixtureProject({ scenarioOverrides: { "alpha-one": { title: undefined } } });
  assert.ok(
    validateProject(missingField).errors.some((error) => error.includes("alpha-one 缺少 title")),
  );

  const project = memoryFixtureProject({
    extraScenarios: [scenarioEntry("Bad_Id")],
    extraManifests: {
      [scenarioManifestPath("alpha-six")]: null,
    },
  });
  project.scenarios.push(null, { title: "no id" });
  project.scenarios.push(scenarioEntry("alpha-six", { manifest: scenarioManifestPath("alpha-six") }));
  project.files.set(scenarioManifestPath("alpha-six"), {
    path: scenarioManifestPath("alpha-six"),
    ok: true,
    data: null,
  });
  const { errors } = validateProject(project);
  for (const message of [
    "id 必须是小写 kebab-case",
    "scenario 项必须是 mapping",
    "scenario 缺少 id",
    "manifest 顶层必须是 mapping",
  ]) {
    assert.ok(errors.some((error) => error.includes(message)), `${message}: ${errors.join("\n")}`);
  }
});
