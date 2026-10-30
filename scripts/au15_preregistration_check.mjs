#!/usr/bin/env node
// B42-PREP：AU-15 预注册/就绪检查（不加载模型、不调 provider、不写产品数据）。
// 只读预注册 JSON、场景 manifest、driver/verifier 文件，输出准备矩阵与阻塞项。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const preregPath = join(root, "artifacts/model-contracts/b39-cp1/au15-preregistration.json");
const scenarioPath = join(root, "quality/acceptance/scenarios/au15-evidence-seeking-native.yml");
const outDir = join(root, "artifacts/b42-prep");
mkdirSync(outDir, { recursive: true });

function fail(message) {
  console.error(`[au15-prereg-check] ${message}`);
  process.exit(2);
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${relative(root, path)}: ${error.message}`);
  }
}
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read ${relative(root, path)}: ${error.message}`);
  }
}
const prereg = readJson(preregPath);
const scenario = readText(scenarioPath);
const checks = [];
function add(id, status, evidence) {
  checks.push({ id, status, evidence });
}

add(
  "preregistration_schema",
  prereg.schema === "au15-cp1-preregistration/v1" ? "ready" : "blocked",
  `schema=${prereg.schema}`,
);
add(
  "single_slot_unload",
  prereg.model?.single_slot === true && prereg.model?.unload_after === true ? "ready" : "blocked",
  `single_slot=${prereg.model?.single_slot}, unload_after=${prereg.model?.unload_after}`,
);
add(
  "budget_frozen",
  prereg.budget?.input_timeout_ms === 120000 &&
    prereg.budget?.turn_timeout_ms === 360000 &&
    prereg.budget?.heartbeat_ms === 10000 &&
    prereg.budget?.A1_A2_runs === 2 &&
    prereg.budget?.retries === 0
    ? "ready"
    : "blocked",
  `input=${prereg.budget?.input_timeout_ms}, turn=${prereg.budget?.turn_timeout_ms}, heartbeat=${prereg.budget?.heartbeat_ms}, A1_A2_runs=${prereg.budget?.A1_A2_runs}, retries=${prereg.budget?.retries}`,
);
add(
  "no_run_until_declared",
  Array.isArray(prereg.no_run_until) && prereg.no_run_until.length >= 3 ? "ready" : "blocked",
  `no_run_until=${JSON.stringify(prereg.no_run_until ?? [])}`,
);
add(
  "evidence_matrix_declared",
  Array.isArray(prereg.evidence?.required) && prereg.evidence.required.length >= 7
    ? "ready"
    : "blocked",
  `required_evidence=${prereg.evidence?.required?.length ?? 0}`,
);
add(
  "scenario_blocked_and_strata",
  /status:\s*blocked/.test(scenario) &&
    /default_provider:\s*strata/.test(scenario) &&
    /model:\s*iq3_s/.test(scenario)
    ? "ready"
    : "blocked",
  "manifest status=blocked/default_provider=strata/model=iq3_s",
);
const d6aBlocked = /d6a_precondition:\s*not_satisfied/.test(scenario);
add(
  "d6a_precondition",
  d6aBlocked ? "blocked" : "unknown",
  d6aBlocked
    ? "scenario 声明 D6-A 前置未满足（真实模型创作+外部页面采纳）"
    : "未找到 d6a_precondition 声明",
);
const authorReviewBlocked = /人工复核|作者\/指定评审/.test(scenario + JSON.stringify(prereg));
add(
  "author_semantic_review",
  authorReviewBlocked ? "blocked" : "unknown",
  "语义相容裁决不在 AI 权限内，需作者/指定评审",
);
const resourceWindow = /作者授权资源窗口/.test(JSON.stringify(prereg.no_run_until ?? []));
add(
  "resource_window",
  resourceWindow ? "blocked" : "unknown",
  "预注册 no_run_until 含“作者授权资源窗口”",
);
const harnessFiles = [
  "scripts/native_au15_evidence_seeking_batch.sh",
  "scripts/native_au15_evidence_seeking_drive.mjs",
  "scripts/native_au15_evidence_seeking_evidence.mjs",
  "scripts/seed_au15_evidence_seeking.exs",
];
add(
  "harness_files_exist",
  harnessFiles.every((file) => existsSync(join(root, file))) ? "ready" : "blocked",
  harnessFiles.join(", "),
);
add(
  "b39_d6a_setup",
  /D6-A/.test(JSON.stringify(prereg.setup ?? {})) && /not_satisfied/.test(scenario)
    ? "blocked"
    : "unknown",
  "B39 D6-A setup 未完成：setup 与测量未分账就绪",
);

const blockers = checks.filter((check) => check.status === "blocked").map((check) => check.id);
const report = {
  schema: "au15-prep-readiness/v1",
  generated_at: new Date().toISOString(),
  mode: "preparation_only_no_model_no_provider_no_product_write",
  preregistration: { path: relative(root, preregPath), schema: prereg.schema, status: prereg.status },
  scenario: relative(root, scenarioPath),
  checks,
  blockers,
  overall: blockers.length === 0 ? "ready" : "not_ready",
  note: "ready 仅表示准备文档/接口可审阅；D6-A setup、作者语义裁决、单槽资源窗口未满足，不登记场景、不运行真实模型。",
};
writeFileSync(join(outDir, "readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# B42-PREP AU-15 readiness",
  "",
  `- overall: **${report.overall}**`,
  `- mode: ${report.mode}`,
  "",
  "| check | status | evidence |",
  "|---|---|---|",
  ...checks.map((check) => `| ${check.id} | ${check.status} | ${check.evidence} |`),
  "",
  `blockers: ${blockers.join(", ") || "—"}`,
  "",
];
writeFileSync(join(outDir, "readiness.md"), md.join("\n"));
console.log(`au15-prereg-check: ${report.overall} (${blockers.length} blockers) -> ${relative(root, outDir)}`);
