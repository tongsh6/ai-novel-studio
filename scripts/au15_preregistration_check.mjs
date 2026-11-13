#!/usr/bin/env node
// B42-PREP：AU-15 预注册/就绪检查（只读准备材料，不加载模型、不调 provider、不写产品数据）。
//
// 唯一 owner：
// - reader：从指定项目根读取预注册 JSON、场景 YAML（经 manifest.mjs 的标准 YAML 解析桥）
//   与 harness 文件存在性；任何缺失/坏 JSON/YAML/非 mapping 在这里非零失败，且不创建输出。
// - pure：evaluateReadiness 只消费已读取的输入事实；unknown/blocked 都不能使 overall ready。
// - writer：只把报告写到项目根的 artifacts/b42-prep/；模块 import 不读文件、不写报告。
// - CLI：--root 指定项目根（默认本 repo），inputs/out 路径均相对该 root。
//
// 本报告仅审查旧 v1 准备材料，不授予运行资格，不复制 native_au15 batch 的运行时 preflight。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYamlFiles } from "./lib/quality/manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "..");
const PREREG_PATH = "artifacts/model-contracts/b39-cp1/au15-preregistration.json";
const SCENARIO_PATH = "quality/acceptance/scenarios/au15-evidence-seeking-native.yml";
const OUT_DIR = "artifacts/b42-prep";
const HARNESS_FILES = Object.freeze([
  "scripts/native_au15_evidence_seeking_batch.sh",
  "scripts/native_au15_evidence_seeking_drive.mjs",
  "scripts/native_au15_evidence_seeking_evidence.mjs",
  "scripts/seed_au15_evidence_seeking.exs",
]);
const READINESS_SCHEMA = "au15-prep-readiness/v1";
const READINESS_MODE = "preparation_only_no_model_no_provider_no_product_write";

export class PreregCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreregCheckError";
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function readJsonMapping(root, name) {
  const file = join(root, name);
  if (!existsSync(file)) throw new PreregCheckError(`缺少预注册文件：${name}`);
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new PreregCheckError(`${name} 不是合法 JSON：${error.message}`);
  }
  if (!isPlainObject(value)) {
    throw new PreregCheckError(`${name} 顶层必须是 mapping（object）`);
  }
  return value;
}

function scenarioRecordError(record) {
  if (record.ok !== true) {
    return `场景 YAML 解析失败：${record.error ?? "unknown error"}`;
  }
  if (!isPlainObject(record.data)) {
    return `${SCENARIO_PATH} 顶层必须是 mapping（object）`;
  }
  return null;
}

function requireScenarioMapping(record) {
  const error = scenarioRecordError(record);
  if (error !== null) throw new PreregCheckError(error);
  return record.data;
}

function readScenarioMapping(root) {
  const file = join(root, SCENARIO_PATH);
  if (!existsSync(file)) throw new PreregCheckError(`缺少场景 manifest：${SCENARIO_PATH}`);
  const bundle = parseYamlFiles(root, [SCENARIO_PATH]);
  const record = bundle.files.find((entry) => entry.path === SCENARIO_PATH) ?? bundle.files[0];
  return requireScenarioMapping(record);
}

/** 读边界：所有输入读取/校验完成后才返回；不创建输出目录。 */
export function readInputs(projectRoot) {
  const root = resolve(projectRoot);
  return {
    projectRoot: root,
    preregPath: PREREG_PATH,
    scenarioPath: SCENARIO_PATH,
    prereg: readJsonMapping(root, PREREG_PATH),
    scenario: readScenarioMapping(root),
    harnessFiles: HARNESS_FILES.map((path) => ({
      path,
      exists: existsSync(join(root, path)),
    })),
  };
}

function budgetMatchesV1(budget) {
  return (
    budget.input_timeout_ms === 120000 &&
    budget.turn_timeout_ms === 360000 &&
    budget.heartbeat_ms === 10000 &&
    budget.A1_A2_runs === 2 &&
    budget.retries === 0
  );
}

function d6aStatus(scenario) {
  // 旧 v1 只有前置声明，没有独立完成证据字段；除明确 not_satisfied 外一律 unknown。
  return scenario.setup?.d6a_precondition === "not_satisfied" ? "blocked" : "unknown";
}

function declarationPair(label, expected, declared) {
  return { label, expected, declared };
}

// 身份核对的唯一 owner：预注册声明 vs 场景已声明的身份。setup.provider 只有
// 场景明确声明时才纳入，未声明不发明新的必填字段。
function modelIdentityPairs(prereg, scenario) {
  const preregProvider = prereg.model?.provider;
  const pairs = [declarationPair("provider", preregProvider, scenario.default_provider)];
  if (scenario.setup?.provider !== undefined) {
    pairs.push(declarationPair("setup_provider", preregProvider, scenario.setup.provider));
  }
  pairs.push(declarationPair("model", prereg.model?.model, scenario.setup?.model));
  return pairs;
}

function declarationConsistent({ expected, declared }) {
  return nonEmptyString(expected) && nonEmptyString(declared) && expected === declared;
}

function modelDeclarationStatus(prereg, scenario) {
  const pairs = modelIdentityPairs(prereg, scenario);
  const matched = pairs.every(declarationConsistent);
  return {
    id: "prereg_model_matches_scenario",
    status: matched ? "ready" : "blocked",
    evidence: pairs
      .map(
        ({ label, expected, declared }) =>
          `${label}: prereg=${String(expected)}, scenario=${String(declared)}`,
      )
      .join("; "),
  };
}

function schemaAndBudgetChecks(prereg) {
  const budget = prereg.budget ?? {};
  return [
    {
      id: "preregistration_schema",
      status: prereg.schema === "au15-cp1-preregistration/v1" ? "ready" : "blocked",
      evidence: `schema=${String(prereg.schema)}`,
    },
    {
      id: "budget_matches_v1",
      status: budgetMatchesV1(budget) ? "ready" : "blocked",
      evidence: `input=${String(budget.input_timeout_ms)}, turn=${String(budget.turn_timeout_ms)}, heartbeat=${String(budget.heartbeat_ms)}, A1_A2_runs=${String(budget.A1_A2_runs)}, retries=${String(budget.retries)}`,
    },
  ];
}

function singleSlotCheck(prereg) {
  const model = prereg.model ?? {};
  const ready = model.single_slot === true && model.unload_after === true;
  return {
    id: "single_slot_unload",
    status: ready ? "ready" : "blocked",
    evidence: `single_slot=${String(model.single_slot)}, unload_after=${String(model.unload_after)}`,
  };
}

function preregistrationChecks(prereg) {
  return [...schemaAndBudgetChecks(prereg), singleSlotCheck(prereg)];
}

function declarationChecks(prereg) {
  const noRunUntil = Array.isArray(prereg.no_run_until) ? prereg.no_run_until : [];
  const required = Array.isArray(prereg.evidence?.required) ? prereg.evidence.required : [];
  const resourceWindowDeclared = noRunUntil.some(
    (item) => typeof item === "string" && item.includes("作者授权资源窗口"),
  );
  return [
    {
      id: "no_run_until_declared",
      status: noRunUntil.length >= 3 ? "ready" : "blocked",
      evidence: `no_run_until=${JSON.stringify(noRunUntil)}（存在声明不等于已满足）`,
    },
    {
      id: "evidence_matrix_declared",
      status: required.length >= 7 ? "ready" : "blocked",
      evidence: `required_evidence=${required.length}`,
    },
    {
      id: "resource_window",
      // 条件文本只证明要求存在，不提供已满足/未满足的事实；两种输入都是 unknown。
      status: "unknown",
      evidence: resourceWindowDeclared
        ? "no_run_until 声明了作者授权资源窗口这一前置要求；输入未提供窗口已满足/未满足的完成事实"
        : "no_run_until 未声明作者授权资源窗口；输入也未提供窗口已满足/未满足的完成事实",
    },
  ];
}

function scenarioChecks(scenario) {
  const d6a = d6aStatus(scenario);
  return [
    {
      id: "scenario_preparation_declared",
      status: scenario.status === "blocked" ? "ready" : "blocked",
      evidence: `status=${String(scenario.status)}（准备态声明）`,
    },
    {
      id: "d6a_precondition",
      status: d6a,
      evidence:
        d6a === "blocked"
          ? "scenario 声明 D6-A 前置未满足（真实模型创作+外部页面采纳）"
          : "未找到 D6-A 前置满足的完成证据（声明缺失不等于满足）",
    },
    {
      id: "author_semantic_review",
      status: "unknown",
      evidence: "语义相容裁决不在 AI 权限内，需作者/指定评审完成证据；旧 v1 无该完成字段",
    },
    {
      id: "b39_d6a_setup",
      status: d6a === "blocked" ? "blocked" : "unknown",
      evidence:
        d6a === "blocked"
          ? "输入声明 D6-A 前置未满足（真实模型创作+外部页面采纳），缺少完成证据"
          : "输入未提供 D6-A 前置满足的完成证据",
    },
  ];
}

function harnessCheck(harnessFiles) {
  return {
    id: "harness_files_exist",
    status: harnessFiles.every((file) => file.exists) ? "ready" : "blocked",
    evidence: harnessFiles.map((file) => `${file.path}${file.exists ? "" : "（缺）"}`).join(", "),
  };
}

/** 纯判定：只消费 readInputs 的事实；unknown 与 blocked 都列入 blockers。 */
export function evaluateReadiness(inputs) {
  const { prereg, scenario, harnessFiles } = inputs;
  const checks = [
    ...preregistrationChecks(prereg),
    ...declarationChecks(prereg),
    ...scenarioChecks(scenario),
    harnessCheck(harnessFiles),
    modelDeclarationStatus(prereg, scenario),
  ];
  const blockers = checks.filter((check) => check.status !== "ready").map((check) => check.id);
  return {
    schema: READINESS_SCHEMA,
    mode: READINESS_MODE,
    preregistration: {
      path: inputs.preregPath,
      schema: prereg.schema,
      // 仅原样转录输入声明；status 不是完成/授权证据，也不参与任何 ready 判定。
      status: prereg.status,
    },
    scenario: inputs.scenarioPath,
    checks,
    blockers,
    overall: blockers.length === 0 ? "ready" : "not_ready",
    note: "ready 仅表示准备材料检查通过；unknown/blocked 均阻止 ready。本报告不授予运行资格，也不证明当前 Splash 方案或 AU-15 场景就绪。",
  };
}

function renderMarkdown(report) {
  return [
    "# B42-PREP AU-15 readiness",
    "",
    `- overall: **${report.overall}**`,
    `- mode: ${report.mode}`,
    "",
    "| check | status | evidence |",
    "|---|---|---|",
    ...report.checks.map((check) => `| ${check.id} | ${check.status} | ${check.evidence} |`),
    "",
    `blockers: ${report.blockers.join(", ") || "—"}`,
    "",
  ].join("\n");
}

/** 写边界：只在读取校验全部通过后创建输出目录并写报告。 */
export function writeReadinessReport(projectRoot, report) {
  const root = resolve(projectRoot);
  const outDir = join(root, OUT_DIR);
  const payload = { ...report, generated_at: new Date().toISOString() };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "readiness.json"), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(join(outDir, "readiness.md"), renderMarkdown(payload));
  return { outDir, report: payload };
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!nonEmptyString(value)) throw new PreregCheckError("--root 需要项目根路径");
      root = resolve(value);
      index += 1;
    } else {
      throw new PreregCheckError(`未知参数：${arg}`);
    }
  }
  return { root };
}

export function main(argv = process.argv.slice(2), output = process) {
  try {
    const { root } = parseArgs(argv);
    const inputs = readInputs(root);
    const { outDir, report } = writeReadinessReport(root, evaluateReadiness(inputs));
    output.stdout.write(
      `au15-prereg-check: ${report.overall} (${report.blockers.length} blockers) -> ${relative(root, outDir)}\n`,
    );
    return 0;
  } catch (error) {
    output.stderr.write(`[au15-prereg-check] ${error.message}\n`);
    return 2;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
