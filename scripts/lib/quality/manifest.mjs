// B41 CP1：质量验收 manifest 的唯一语义校验/查询实现。
//
// 设计约束（见 tasks/slices/B41-quality-evidence-foundation.md §6.2）：
// - YAML 语法与重复键由标准解析器（PyYAML，经 scripts/lib/quality/yaml_bridge.py）负责，
//   本模块绝不使用正则重新实现 YAML 解析。
// - quality_manifest_check.sh（门禁）与 quality_accept.sh（执行入口）都只经本模块/CLI
//   读取 scenarios.yml，避免出现第二份 registry 解析。
// - 任何非法 YAML、未注册文件、词表漂移、状态/层不合法都必须硬失败，不能静默放行。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = path.resolve(HERE, "../../..");
const YAML_BRIDGE = path.join(HERE, "yaml_bridge.py");

export const INDEX_PATH = "quality/acceptance/scenarios.yml";
export const SCENARIOS_DIR = "quality/acceptance/scenarios";
export const TIERS = Object.freeze(["pr-smoke", "nightly", "known-gap", "release", "release-real-llm"]);
export const SURFACES = Object.freeze(["browser", "tauri"]);
export const RUNNERS = Object.freeze(["slice_verify", "tauri_slice_verify", "dogfood_run", "e2e_aggregate"]);
export const MANIFEST_STATUSES = Object.freeze(["active", "blocked"]);
export const RESULT_STATUSES = Object.freeze(["pass", "fail", "skipped", "not_run", "evidence_missing"]);

// CP0 §6.2 item 6 冻结的 canonical evidence kinds（闭集）。
export const EVIDENCE_KINDS = Object.freeze([
  "screenshot",
  "websocket_frames",
  "app_jsonl",
  "turn_result",
  "action_result",
  "ui_state",
  "backend_log",
  "llm_http_log",
  "provider_secrets_metadata",
  "persistence_snapshot",
  "summary_json",
  "replay_api_response",
  "seed_log",
  "export_artifact",
  "progress_jsonl",
  "word_count_json",
  "native_screenshots",
  "native_transport_jsonl",
  "persisted_session",
  "memory_facts",
  "audit_report",
]);

// 旧 token → canonical kind 的迁移提示（迁移已在 CP1 完成；这里保留用于可读报错）。
export const EVIDENCE_ALIASES = Object.freeze({
  llm_calls: "llm_http_log",
  llm_calls_jsonl: "llm_http_log",
  llm_call_jsonl: "llm_http_log",
  llm_http: "llm_http_log",
  live_provider_http_jsonl_when_provider_variant: "llm_http_log（用 evidence.conditional_required）",
  exported_markdown: "export_artifact",
  exported_manuscript: "export_artifact",
  "audit-report.json": "audit_report",
  "summary.json": "summary_json",
  replay_api_response_matrix: "replay_api_response",
  native_screenshots: "native_screenshots",
});

const REQUIRED_MANIFEST_KEYS = Object.freeze([
  "id",
  "title",
  "tier",
  "surface",
  "entrypoint",
  "contract",
  "invariants",
  "setup",
  "user_flow",
  "evidence",
  "assertions",
  "anti_hooks",
]);

const ANTI_HOOK_KEYS = Object.freeze([
  "product_acceptance_logic_added",
  "data_testid_required",
  "hidden_dom_metadata_required",
  "product_autorun_required",
]);

const DOGFOOD_DRIVER = "dogfood-runner.mjs";
const E2E_DRIVER = "scripts/e2e_01_full_chain_check.sh";

export class ManifestLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManifestLoadError";
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 调用标准 YAML 解析桥。导出以便测试注入/直接断言。
 * @returns {{python: string, pyyaml: string, files: Array<object>}}
 */
export function parseYamlFiles(projectRoot, relativePaths, options = {}) {
  const request = JSON.stringify({ root: projectRoot, paths: relativePaths });
  const command = options.python ?? "python3";
  let stdout;
  try {
    stdout = execFileSync(command, [YAML_BRIDGE], {
      input: request,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim();
    const detail = stderr || String(error.message ?? error);
    throw new ManifestLoadError(
      [
        "[quality-manifest] 无法调用标准 YAML 解析器（PyYAML）。",
        "  本项目要求 python3 + PyYAML 6.0.3 作为唯一 YAML 解析源，不允许用正则替代。",
        "  安装：python3 -m pip install 'pyyaml==6.0.3'",
        `  底层错误：${detail}`,
      ].join("\n"),
    );
  }

  let bundle;
  try {
    bundle = JSON.parse(stdout);
  } catch (error) {
    throw new ManifestLoadError(`[quality-manifest] YAML bridge 返回非 JSON：${error.message}`);
  }
  if (!isPlainObject(bundle) || !Array.isArray(bundle.files)) {
    throw new ManifestLoadError("[quality-manifest] YAML bridge 返回结构非法");
  }
  return bundle;
}

/** 解析 scenarios.yml；返回 {data, record, bundle}，解析失败抛出可读错误。 */
export function loadRegistry(projectRoot = DEFAULT_PROJECT_ROOT) {
  const bundle = parseYamlFiles(projectRoot, [INDEX_PATH]);
  const record = bundle.files[0];
  if (!record || record.ok !== true) {
    const where = record?.line ? `:${record.line}:${record.column ?? 0}` : "";
    throw new ManifestLoadError(
      `${INDEX_PATH}${where}: YAML 解析失败：${record?.error ?? "unknown error"}`,
    );
  }
  const data = record.data;
  if (!isPlainObject(data) || !Array.isArray(data.scenarios)) {
    throw new ManifestLoadError(`${INDEX_PATH}: 顶层必须是包含 scenarios 数组的 mapping`);
  }
  return { data, record, bundle };
}

/** scenarios/ 目录下所有 yml 文件（repo-relative）。 */
export function collectScenarioManifestFiles(projectRoot = DEFAULT_PROJECT_ROOT) {
  const dir = path.join(projectRoot, SCENARIOS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".yml"))
    .sort()
    .map((name) => `${SCENARIOS_DIR}/${name}`);
}

/** 只解析 scenarios.yml（查询命令用；不做 manifest 全文校验，保证 CLI 查询轻量）。 */
export function loadRegistryScenarios(projectRoot = DEFAULT_PROJECT_ROOT) {
  const { data } = loadRegistry(projectRoot);
  return {
    projectRoot,
    registry: data,
    scenarios: normalizeList(data.scenarios),
    drafts: normalizeList(data.drafts),
  };
}

/** 一次性加载 registry + 所有 manifest 文件（含未被引用的 stray 文件）。 */
export function loadProject(projectRoot = DEFAULT_PROJECT_ROOT) {
  const { data, bundle } = loadRegistry(projectRoot);
  const manifestPaths = Array.from(
    new Set([
      ...collectScenarioManifestFiles(projectRoot),
      ...normalizeList(data.scenarios?.map?.((entry) => entry?.manifest)).filter(nonEmptyString),
      ...normalizeList(data.drafts?.map?.((entry) => entry?.manifest)).filter(nonEmptyString),
    ]),
  ).sort();
  const files = new Map();
  if (manifestPaths.length > 0) {
    const manifestBundle = parseYamlFiles(projectRoot, manifestPaths);
    for (const record of manifestBundle.files) {
      files.set(record.path, record);
    }
  }
  return {
    projectRoot,
    registry: data,
    scenarios: normalizeList(data.scenarios),
    drafts: normalizeList(data.drafts),
    files,
    python: bundle.python,
    pyyaml: bundle.pyyaml,
  };
}

export function scenarioRunner(scenario) {
  if (nonEmptyString(scenario.runner)) return scenario.runner;
  if (scenario.surface === "tauri") return "tauri_slice_verify";
  if (scenario.surface === "browser") return "slice_verify";
  return null;
}

export function scenarioStatus(scenario) {
  return nonEmptyString(scenario.status) ? scenario.status : "active";
}

export function isExecutable(scenario) {
  return scenarioStatus(scenario) === "active";
}

export function scenarioById(project, id) {
  return normalizeList(project.scenarios).find((scenario) => scenario.id === id) ?? null;
}

export function activeScenarios(project) {
  return normalizeList(project.scenarios).filter(isExecutable);
}

export function idsByTier(project, tier, surface = null) {
  return activeScenarios(project)
    .filter((scenario) => scenario.tier === tier)
    .filter((scenario) => !surface || scenario.surface === surface)
    .map((scenario) => scenario.id);
}

/**
 * registry-status：给执行入口/聚合器使用的稳定接口（JSON）。
 * 未知 scenario 返回 status=null。
 */
export function registryStatus(project, id) {
  const scenario = scenarioById(project, id);
  if (!scenario) return { id, status: null, blocked_reason: null, tier: null, surface: null };
  return {
    id: scenario.id,
    status: scenarioStatus(scenario),
    blocked_reason: nonEmptyString(scenario.blocked_reason) ? scenario.blocked_reason : null,
    tier: scenario.tier ?? null,
    surface: scenario.surface ?? null,
  };
}

function evidenceTokenProblem(token) {
  const alias = EVIDENCE_ALIASES[token];
  if (alias) {
    return `evidence.required token "${token}" 不在 canonical 词表中；请迁移为 "${alias}"`;
  }
  return (
    `evidence.required token "${token}" 不在 canonical 词表中；` +
    `允许值：${EVIDENCE_KINDS.join(", ")}`
  );
}

function checkEvidence(manifestFile, evidence, errors) {
  if (!isPlainObject(evidence)) {
    errors.push(`${manifestFile}: evidence 必须是 mapping`);
    return;
  }
  const required = evidence.required;
  if (!Array.isArray(required)) {
    errors.push(`${manifestFile}: 缺少 evidence.required 数组`);
    return;
  }
  if (required.length === 0) {
    errors.push(`${manifestFile}: evidence.required 不能为空`);
  }
  const seen = new Set();
  for (const raw of required) {
    if (typeof raw !== "string" || raw.trim() === "") {
      errors.push(`${manifestFile}: evidence.required 项必须是非空字符串（实际 ${JSON.stringify(raw)}）`);
      continue;
    }
    const token = raw.trim();
    if (seen.has(token)) {
      errors.push(`${manifestFile}: evidence.required 重复 token "${token}"`);
      continue;
    }
    seen.add(token);
    if (!EVIDENCE_KINDS.includes(token)) {
      errors.push(`${manifestFile}: ${evidenceTokenProblem(token)}`);
    }
  }

  const requiredArtifacts = evidence.required_artifacts;
  if (requiredArtifacts !== undefined) {
    if (!Array.isArray(requiredArtifacts)) {
      errors.push(`${manifestFile}: evidence.required_artifacts 必须是数组`);
    } else {
      const artifactSeen = new Set();
      for (const raw of requiredArtifacts) {
        const rel = typeof raw === "string" ? raw.trim() : "";
        if (!rel) {
          errors.push(`${manifestFile}: evidence.required_artifacts 项必须是非空字符串`);
          continue;
        }
        if (artifactSeen.has(rel)) {
          errors.push(`${manifestFile}: evidence.required_artifacts 重复路径 "${rel}"`);
          continue;
        }
        artifactSeen.add(rel);
        if (path.isAbsolute(rel) || rel.includes("..") || !rel.startsWith("artifacts/")) {
          errors.push(
            `${manifestFile}: evidence.required_artifacts 必须是 artifacts/ 下的 repo 相对路径（实际 "${rel}"）`,
          );
        }
      }
    }
  }

  const conditional = evidence.conditional_required;
  if (conditional !== undefined) {
    if (!Array.isArray(conditional)) {
      errors.push(`${manifestFile}: evidence.conditional_required 必须是数组`);
    } else {
      for (const item of conditional) {
        if (!isPlainObject(item) || !nonEmptyString(item.kind)) {
          errors.push(`${manifestFile}: evidence.conditional_required 项必须包含 kind`);
          continue;
        }
        if (!EVIDENCE_KINDS.includes(item.kind.trim())) {
          errors.push(`${manifestFile}: ${evidenceTokenProblem(item.kind.trim())}`);
        }
        if (!isPlainObject(item.when) || Object.keys(item.when).length === 0) {
          errors.push(`${manifestFile}: evidence.conditional_required[${item.kind}] 缺少非空 when 条件`);
        }
      }
    }
  }

  const optional = evidence.optional;
  if (optional !== undefined) {
    if (!Array.isArray(optional)) {
      errors.push(`${manifestFile}: evidence.optional 必须是数组`);
    } else {
      for (const raw of optional) {
        if (!nonEmptyString(raw)) {
          errors.push(`${manifestFile}: evidence.optional 项必须是非空字符串`);
          continue;
        }
        const token = raw.trim();
        if (!EVIDENCE_KINDS.includes(token)) {
          errors.push(`${manifestFile}: ${evidenceTokenProblem(token)}`);
        }
      }
    }
  }
  const optionalRealLmstudio = evidence.optional_real_lmstudio;
  if (optionalRealLmstudio !== undefined) {
    if (!Array.isArray(optionalRealLmstudio)) {
      errors.push(`${manifestFile}: evidence.optional_real_lmstudio 必须是数组`);
    } else {
      for (const raw of optionalRealLmstudio) {
        if (!nonEmptyString(raw)) {
          errors.push(`${manifestFile}: evidence.optional_real_lmstudio 项必须是非空字符串`);
        }
      }
    }
  }

  if (evidence.artifact_dir !== undefined) {
    const dir = evidence.artifact_dir;
    if (!nonEmptyString(dir) || path.isAbsolute(dir) || dir.includes("..") || !dir.startsWith("artifacts/")) {
      errors.push(`${manifestFile}: evidence.artifact_dir 必须是 artifacts/ 下的 repo 相对路径`);
    }
  }
  if (evidence.real_lmstudio_artifact_dir !== undefined) {
    const dir = evidence.real_lmstudio_artifact_dir;
    if (!nonEmptyString(dir) || path.isAbsolute(dir) || dir.includes("..") || !dir.startsWith("artifacts/")) {
      errors.push(`${manifestFile}: evidence.real_lmstudio_artifact_dir 必须是 artifacts/ 下的 repo 相对路径`);
    }
  }
  if (evidence.provider_variant_artifact_dirs !== undefined) {
    if (!isPlainObject(evidence.provider_variant_artifact_dirs)) {
      errors.push(`${manifestFile}: evidence.provider_variant_artifact_dirs 必须是 mapping`);
    } else {
      for (const [provider, dir] of Object.entries(evidence.provider_variant_artifact_dirs)) {
        if (!nonEmptyString(dir) || path.isAbsolute(dir) || dir.includes("..") || !dir.startsWith("artifacts/")) {
          errors.push(
            `${manifestFile}: evidence.provider_variant_artifact_dirs.${provider} 必须是 artifacts/ 下的 repo 相对路径`,
          );
        }
      }
    }
  }
}

function checkManifestConsistency(manifestFile, manifest, scenario, runner, errors) {
  for (const key of REQUIRED_MANIFEST_KEYS) {
    if (!(key in manifest)) {
      errors.push(`${manifestFile}: 缺少必需键 ${key}`);
    }
  }

  const evidence = manifest.evidence;
  if (isPlainObject(evidence) && !Array.isArray(evidence.required)) {
    errors.push(`${manifestFile}: 缺少必需键 evidence.required`);
  }

  const antiHooks = manifest.anti_hooks;
  for (const key of ANTI_HOOK_KEYS) {
    if (!isPlainObject(antiHooks) || antiHooks[key] !== false) {
      errors.push(`${manifestFile}: anti_hooks.${key} 必须为 false`);
    }
  }

  for (const [field, expected] of [
    ["id", scenario.id],
    ["tier", scenario.tier],
    ["surface", scenario.surface],
  ]) {
    if (manifest[field] !== undefined && String(manifest[field]) !== String(expected)) {
      errors.push(`${manifestFile}: ${field} ${manifest[field]} 与 scenarios.yml 的 ${expected} 不一致`);
    }
  }

  if (manifest.runner !== undefined && manifest.runner !== runner) {
    errors.push(`${manifestFile}: runner ${manifest.runner} 与 scenarios.yml 的 ${runner} 不一致`);
  }
  if (manifest.entrypoint !== undefined && manifest.entrypoint !== scenario.entrypoint) {
    errors.push(`${manifestFile}: entrypoint 与 scenarios.yml 的 entrypoint 不一致`);
  }
  if (manifest.status !== undefined && scenarioStatus(scenario) !== "active" && manifest.status !== scenario.status) {
    errors.push(`${manifestFile}: status ${manifest.status} 与 scenarios.yml 的 ${scenario.status} 不一致`);
  }

  if (runner === "dogfood_run") {
    if (manifest.runner !== "dogfood_run") {
      errors.push(`${manifestFile}: dogfood 场景必须声明 runner: dogfood_run`);
    }
    if (manifest.default_provider !== "lmstudio") {
      errors.push(`${manifestFile}: dogfood 场景必须声明 default_provider: lmstudio`);
    }
  }
  if (runner === "e2e_aggregate") {
    if (manifest.runner !== "e2e_aggregate") {
      errors.push(`${manifestFile}: e2e aggregate 场景必须声明 runner: e2e_aggregate`);
    }
    if (manifest.default_provider !== "lmstudio") {
      errors.push(`${manifestFile}: e2e aggregate 场景必须声明 default_provider: lmstudio`);
    }
  }

  checkEvidence(manifestFile, manifest.evidence, errors);
}

function checkDrafts(project, errors, drafts, scenariosById, referencedManifestPaths) {
  const draftIds = new Set();
  for (const draft of drafts) {
    if (!isPlainObject(draft)) {
      errors.push(`${INDEX_PATH}: drafts 项必须是 mapping`);
      continue;
    }
    const { id, manifest: manifestPath, reason } = draft;
    if (!nonEmptyString(id)) {
      errors.push(`${INDEX_PATH}: drafts 项缺少 id`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]+$/u.test(id)) {
      errors.push(`${INDEX_PATH}: draft id "${id}" 必须是小写 kebab-case`);
    }
    if (draftIds.has(id)) errors.push(`${INDEX_PATH}: draft id 重复 ${id}`);
    draftIds.add(id);
    if (!nonEmptyString(reason)) errors.push(`${INDEX_PATH}: draft ${id} 缺少 reason`);
    if (scenariosById.has(id)) {
      errors.push(`${INDEX_PATH}: draft ${id} 同时出现在 scenarios 中`);
    }
    if (!nonEmptyString(manifestPath)) {
      errors.push(`${INDEX_PATH}: draft ${id} 缺少 manifest`);
      continue;
    }
    referencedManifestPaths.add(manifestPath);
    if (!manifestPath.startsWith(`${SCENARIOS_DIR}/`)) {
      errors.push(`${INDEX_PATH}: draft ${id} 的 manifest 必须位于 ${SCENARIOS_DIR}/（实际 ${manifestPath}）`);
      continue;
    }
    const record = project.files.get(manifestPath);
    if (!record) {
      errors.push(`${INDEX_PATH}: draft ${id} manifest 缺失：${manifestPath}`);
      continue;
    }
    if (record.ok !== true) {
      errors.push(`${manifestPath}: YAML 解析失败：${record.error}`);
      continue;
    }
    const manifest = record.data;
    if (!isPlainObject(manifest)) {
      errors.push(`${manifestPath}: draft manifest 必须是 mapping`);
      continue;
    }
    if (manifest.id !== id) {
      errors.push(`${manifestPath}: id ${manifest.id} 与 draft 注册 id ${id} 不一致`);
    }
    if (!nonEmptyString(manifest.status_note)) {
      errors.push(`${manifestPath}: draft manifest 必须声明 status_note 说明未注册原因`);
    }
    const antiHooks = manifest.anti_hooks;
    if (antiHooks !== undefined) {
      if (!isPlainObject(antiHooks)) {
        errors.push(`${manifestPath}: anti_hooks 必须是 mapping`);
      } else {
        for (const key of ANTI_HOOK_KEYS) {
          if (antiHooks[key] !== undefined && antiHooks[key] !== false) {
            errors.push(`${manifestPath}: anti_hooks.${key} 必须为 false`);
          }
        }
      }
    }
  }
}

/**
 * 校验 registry + manifests。
 *
 * @param {object} project loadProject 的返回值
 * @param {object} [options]
 * @param {boolean} [options.skipExternalChecks] 跳过 frontend driver / tauri --list / ci.md 检查（供单元测试夹具使用）
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateProject(project, options = {}) {
  const { projectRoot, registry, scenarios, drafts } = project;
  const errors = [];
  const warnings = [];

  if (scenarios.length < 5) {
    errors.push(`${INDEX_PATH}: 至少应有 5 个 scenario，当前 ${scenarios.length}`);
  }

  const scenariosById = new Map();
  const manifestPathOwner = new Map();
  const referencedManifestPaths = new Set();

  for (const scenario of scenarios) {
    if (!isPlainObject(scenario)) {
      errors.push(`${INDEX_PATH}: scenario 项必须是 mapping`);
      continue;
    }
    const id = scenario.id;
    if (!nonEmptyString(id)) {
      errors.push(`${INDEX_PATH}: scenario 缺少 id`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]+$/u.test(id)) {
      errors.push(`${INDEX_PATH}: ${id} id 必须是小写 kebab-case`);
    }
    if (scenariosById.has(id)) {
      errors.push(`${INDEX_PATH}: scenario id 重复 ${id}`);
    }
    scenariosById.set(id, scenario);

    for (const field of ["id", "title", "tier", "surface", "manifest", "driver", "entrypoint"]) {
      if (!nonEmptyString(scenario[field])) {
        errors.push(`${INDEX_PATH}: ${id} 缺少 ${field}`);
      }
    }

    if (nonEmptyString(scenario.tier) && !TIERS.includes(scenario.tier)) {
      errors.push(`${INDEX_PATH}: ${id} 未知 tier ${scenario.tier}`);
    }
    if (nonEmptyString(scenario.surface) && !SURFACES.includes(scenario.surface)) {
      errors.push(`${INDEX_PATH}: ${id} 未知 surface ${scenario.surface}`);
    }
    if (scenario.status !== undefined) {
      if (!MANIFEST_STATUSES.includes(scenario.status)) {
        errors.push(
          `${INDEX_PATH}: ${id} 未知 status ${scenario.status}（manifest 只允许 active|blocked；draft 走 drafts 注册）`,
        );
      }
      if (scenario.status === "blocked" && !nonEmptyString(scenario.blocked_reason)) {
        errors.push(`${INDEX_PATH}: ${id} status=blocked 但缺少 blocked_reason`);
      }
    }

    const runner = scenarioRunner(scenario);
    if (!RUNNERS.includes(runner)) {
      errors.push(`${INDEX_PATH}: ${id} 不支持的 runner ${runner}`);
    }
    if (runner === "slice_verify" && scenario.surface !== "browser") {
      errors.push(`${INDEX_PATH}: ${id} runner slice_verify 要求 surface=browser`);
    }
    if (runner === "tauri_slice_verify" && scenario.surface !== "tauri") {
      errors.push(`${INDEX_PATH}: ${id} runner tauri_slice_verify 要求 surface=tauri`);
    }
    if (runner === "dogfood_run") {
      if (scenario.surface !== "browser") errors.push(`${INDEX_PATH}: ${id} dogfood_run 必须 surface=browser`);
      if (scenario.default_provider !== "lmstudio") {
        errors.push(`${INDEX_PATH}: ${id} dogfood_run 必须 default_provider=lmstudio`);
      }
      if (!/scripts\/dogfood_run\.sh\b/u.test(scenario.entrypoint ?? "")) {
        errors.push(`${INDEX_PATH}: ${id} dogfood_run entrypoint 必须指向 scripts/dogfood_run.sh`);
      }
      if (/scripts\/quality_accept\.sh\b/u.test(scenario.entrypoint ?? "")) {
        errors.push(`${INDEX_PATH}: ${id} dogfood_run entrypoint 不得经 quality_accept.sh`);
      }
      if (scenario.driver && !String(scenario.driver).endsWith(`/${DOGFOOD_DRIVER}`)) {
        errors.push(`${INDEX_PATH}: ${id} dogfood_run driver 必须是 ${DOGFOOD_DRIVER}`);
      }
    }
    if (runner === "e2e_aggregate") {
      if (scenario.surface !== "browser") errors.push(`${INDEX_PATH}: ${id} e2e_aggregate 必须 surface=browser`);
      if (scenario.default_provider !== "lmstudio") {
        errors.push(`${INDEX_PATH}: ${id} e2e_aggregate 必须 default_provider=lmstudio`);
      }
      if (!/scripts\/e2e_01_full_chain_check\.sh\b/u.test(scenario.entrypoint ?? "")) {
        errors.push(`${INDEX_PATH}: ${id} e2e_aggregate entrypoint 必须指向 scripts/e2e_01_full_chain_check.sh`);
      }
      if (/scripts\/quality_accept\.sh\b/u.test(scenario.entrypoint ?? "")) {
        errors.push(`${INDEX_PATH}: ${id} e2e_aggregate entrypoint 不得经 quality_accept.sh`);
      }
      if (
        scenario.driver &&
        scenario.driver !== E2E_DRIVER &&
        !String(scenario.driver).endsWith(`/${E2E_DRIVER}`)
      ) {
        errors.push(`${INDEX_PATH}: ${id} e2e_aggregate driver 必须是 ${E2E_DRIVER}`);
      }
    }
    if (runner === "tauri_slice_verify" && /scripts\/slice_verify\.sh\b/u.test(scenario.entrypoint ?? "")) {
      errors.push(`${INDEX_PATH}: ${id} tauri 场景不能路由到 browser slice_verify.sh`);
    }
    if (runner === "slice_verify" && /scripts\/tauri_slice_verify\.sh\b/u.test(scenario.entrypoint ?? "")) {
      errors.push(`${INDEX_PATH}: ${id} browser 场景不能路由到 tauri_slice_verify.sh`);
    }
    if (
      ["slice_verify", "tauri_slice_verify"].includes(runner) &&
      nonEmptyString(scenario.surface) &&
      nonEmptyString(scenario.entrypoint) &&
      !String(scenario.entrypoint).includes(`--surface ${scenario.surface}`)
    ) {
      errors.push(`${INDEX_PATH}: ${id} entrypoint 未包含 --surface ${scenario.surface}`);
    }

    if (nonEmptyString(scenario.driver) && !fs.existsSync(path.join(projectRoot, scenario.driver))) {
      errors.push(`${INDEX_PATH}: ${id} driver 缺失：${scenario.driver}`);
    }

    if (!nonEmptyString(scenario.manifest)) continue;
    const manifestPath = scenario.manifest;
    referencedManifestPaths.add(manifestPath);
    if (!manifestPath.startsWith(`${SCENARIOS_DIR}/`)) {
      errors.push(`${INDEX_PATH}: ${id} 的 manifest 必须位于 ${SCENARIOS_DIR}/（实际 ${manifestPath}）`);
      continue;
    }
    if (manifestPathOwner.has(manifestPath)) {
      errors.push(`${INDEX_PATH}: ${id} 与 ${manifestPathOwner.get(manifestPath)} 复用同一 manifest（${manifestPath}）`);
    } else {
      manifestPathOwner.set(manifestPath, id);
    }
    const record = project.files.get(manifestPath);
    if (!record) {
      errors.push(`${INDEX_PATH}: ${id} manifest 缺失：${manifestPath}`);
      continue;
    }
    if (record.ok !== true) {
      const where = record.line ? `:${record.line}:${record.column ?? 0}` : "";
      errors.push(`${manifestPath}${where}: YAML 解析失败：${record.error}`);
      continue;
    }
    if (!isPlainObject(record.data)) {
      errors.push(`${manifestPath}: manifest 顶层必须是 mapping`);
      continue;
    }
    checkManifestConsistency(manifestPath, record.data, scenario, runner, errors);
  }

  checkDrafts(project, errors, drafts, scenariosById, referencedManifestPaths);

  // stray manifest：scenarios/ 下每个 yml 必须被 scenarios 或 drafts 引用。
  for (const manifestPath of collectScenarioManifestFiles(projectRoot)) {
    if (!referencedManifestPaths.has(manifestPath)) {
      errors.push(
        `${manifestPath}: manifest 未注册（必须出现在 ${INDEX_PATH} 的 scenarios 或 drafts 中）`,
      );
    }
  }

  if (!options.skipExternalChecks) {
    validateExternalChecks(projectRoot, scenariosById, errors, warnings);
  }

  return { errors, warnings };
}

function validateExternalChecks(projectRoot, scenariosById, errors, warnings) {
  const verifyDir = path.join(projectRoot, "frontend/slice-verify");
  if (fs.existsSync(verifyDir)) {
    // 这些 .mjs 不是独立验收 driver（与旧门禁语义一致）：
    const ignored = new Set([
      "external-ui-driver.mjs",
      "native-tauri-verifier.mjs",
      "native-tauri-verifier.test.mjs",
      "TEMPLATE.external-ui-driver.mjs",
      "q1c-adopted-content-revision-audit.mjs",
      "au10-workbench-render-stability.mjs",
    ]);
    const ids = new Set(scenariosById.keys());
    for (const fileName of fs.readdirSync(verifyDir)) {
      if (!fileName.endsWith(".mjs") || fileName.endsWith(".test.mjs") || ignored.has(fileName)) continue;
      const scenarioId = fileName.replace(/\.mjs$/u, "");
      if (!ids.has(scenarioId)) {
        errors.push(`frontend/slice-verify/${fileName}: 真实 browser driver 未注册到 ${INDEX_PATH}`);
      }
    }
  }

  try {
    const output = execFileSync("bash", ["scripts/tauri_slice_verify.sh", "--list"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tauriIds = new Set();
    let inImplementedBlock = false;
    for (const line of output.split("\n")) {
      if (line.includes("Implemented external UI driver slice ids:")) {
        inImplementedBlock = true;
        continue;
      }
      if (!inImplementedBlock) continue;
      if (!line.trim()) break;
      const id = line.trim();
      if (/^[a-z0-9][a-z0-9-]+$/u.test(id)) tauriIds.add(id);
    }
    const requiredTauriIds = [
      "p1-chapter-plan-minimum",
      "p1-chapter-draft-generation",
      "au02-candidate-adoption-bridge",
      "au03-context-source-ui",
      "au13-review-adjudication-roundtrip",
    ];
    for (const id of requiredTauriIds) {
      if (!tauriIds.has(id)) {
        errors.push(`scripts/tauri_slice_verify.sh --list: 缺少必需已实现场景 ${id}`);
      }
      const scenario = scenariosById.get(id);
      if (!scenario) {
        errors.push(`${INDEX_PATH}: 缺少 tauri_slice_verify 已实现场景 ${id} 的登记`);
      } else if (scenario.surface !== "tauri") {
        errors.push(`${INDEX_PATH}: ${id} 由 tauri_slice_verify 实现但 surface=${scenario.surface}`);
      }
    }
    for (const id of tauriIds) {
      if (id === "desktop-stage-process-ownership") continue;
      const scenario = scenariosById.get(id);
      if (!scenario) {
        warnings.push(`scripts/tauri_slice_verify.sh --list: ${id} 没有质量验收 manifest`);
      } else if (scenario.surface !== "tauri") {
        errors.push(`${INDEX_PATH}: ${id} surface=${scenario.surface}，应为 tauri`);
      }
    }
  } catch (error) {
    errors.push(`无法检查 scripts/tauri_slice_verify.sh --list：${error.message}`);
  }

  const ciDocPath = path.join(projectRoot, "quality/gates/ci.md");
  if (!fs.existsSync(ciDocPath)) {
    errors.push("quality/gates/ci.md 缺失");
    return;
  }
  const ciDoc = fs.readFileSync(ciDocPath, "utf8");
  const releasePlanned = /## Release Candidate[\s\S]*?Status:\s*planned,\s*not yet enforced\./u.test(ciDoc);
  const targetOnly = /target commands[\s\S]*?until release-tier scenarios are registered/u.test(ciDoc);
  const scenarios = Array.from(scenariosById.values());
  for (const tier of ["release", "release-real-llm"]) {
    const hasTier = scenarios.some((scenario) => scenario.tier === tier);
    if (!hasTier && !(releasePlanned && targetOnly)) {
      errors.push(`quality/gates/ci.md 把 ${tier} 命令声明为当前门禁但 scenarios.yml 无该 tier 场景`);
    }
  }
}

/** 便捷入口：加载并校验，供 CLI/测试使用。 */
export function validate(projectRoot = DEFAULT_PROJECT_ROOT, options = {}) {
  const project = loadProject(projectRoot);
  const { errors, warnings } = validateProject(project, options);
  return { project, errors, warnings };
}
