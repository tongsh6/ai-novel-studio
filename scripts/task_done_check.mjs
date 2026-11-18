#!/usr/bin/env node
// Existing completion owner; design: docs/engineering/quality-gates.md §2.3.1.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactPath, beginScope, readScope, snapshot, currentForScope, changedPaths,
  assertSameSource, beginExecution, finishExecution, verifyExecution,
  readJson, writeNewJson, digest, git,
} from "./lib/quality/task_done_identity.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const nativeSurfaces = new Set(["tauri", "tauri-native"]);
const nativeDrivers = new Set(["ax-native-system-ui", "cua-native-system-ui",
  "macos-cgevent", "macos-cgevent-plan-matrix"]);
const existsSync = fs.existsSync;
function must(ok, reason) { if (!ok) throw new Error("task-done: " + reason); }
try {
  if (args.begin) {
    beginScope(rootDir, required("begin"), required("task"));
    console.log("task-done: baseline captured; not authorization or completion");
  } else if (args["start-execution"]) {
    beginExecution(rootDir, required("scope"), required("start-execution"), required("kind"), text(args["slice-id"]), text(args["ui-summary"]), text(args["scan-mode"]));
  } else if (args["finish-execution"]) {
    const result = finishExecution(rootDir, required("start"), required("finish-execution"),
      required("log"), Number(required("exit-code")), required("command"), text(args["ui-summary"]));
    console.log(result.status);
    if (result.status !== "passed") process.exitCode = 1;
  } else if (args["ui-required"]) {
    const files = args.scope ? scopeState().files : dirtyFiles();
    console.log(detectUiRequired(files) ? "true" : "false");
  } else if (args["prepare-manifest"]) {
    prepareManifest();
  } else if (args["finalize-manifest"]) {
    finalizeManifest();
  } else {
    checkManifest();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
function parseArgs(argv) {
  const accepted = new Set(["begin", "task", "scope", "start-execution", "kind", "slice-id",
    "finish-execution", "start", "log", "exit-code", "command", "ui-summary", "ui-binding",
    "ui-required", "prepare-manifest", "artifact-dir", "checks-start", "finalize-manifest",
    "manifest", "checks-binding", "scan-mode"]);
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].slice(2);
    must(argv[i].startsWith("--") && accepted.has(key) && !(key in result), "unknown/duplicate argument");
    const next = argv[i + 1];
    result[key] = next && !next.startsWith("--") ? argv[++i] : true;
  }
  return result;
}
function text(value) { return typeof value === "string" && value.length > 0 ? value : null; }
function required(key) { const value = text(args[key]); must(value, "missing --" + key); return value; }
function scopeState(scopePath = required("scope")) {
  const scope = readScope(rootDir, scopePath);
  const current = currentForScope(rootDir, scope);
  return { scope, current, files: changedPaths(scope.value.baseline, current) };
}
function dirtyFiles() {
  return [...new Set([
    ...git(rootDir, ["diff", "--name-only", "-z", "HEAD", "--"]).split("\0"),
    ...git(rootDir, ["ls-files", "-z", "--others", "--exclude-standard"]).split("\0"),
  ].filter(Boolean))].sort();
}
function nativeEvidence(scope, current, files, ui) {
  if (!detectUiRequired(files)) return;
  must(ui?.summary_path && ui.binding_path && ui.slice_id, "UI delta requires explicit slice, summary and existing execution binding");
  verifyExecution(rootDir, scope, ui.binding_path, current, "native", ui.slice_id, ui.summary_path);
  const summaryPath = artifactPath(rootDir, ui.summary_path);
  const problem = nativeUiProblem(readJson(summaryPath), path.dirname(summaryPath), ui.slice_id);
  must(!problem, "native evidence rejected: " + problem);
}
function prepareManifest() {
  const { scope, current, files } = scopeState();
  const startPath = artifactPath(rootDir, required("checks-start"));
  const start = readJson(startPath);
  must(start.schema === "task-execution-start/v1" && start.kind === "checks" &&
    start.scope_sha256 === scope.sha256 && start.scope_id === scope.value.scope_id, "checks start mismatch");
  assertSameSource(start.source, current);
  const ui = { slice_id: text(args["slice-id"]), summary_path: text(args["ui-summary"]),
    binding_path: text(args["ui-binding"]) };
  nativeEvidence(scope, current, files, ui);
  const manifest = {
    schema_version: "task-completion/v2", status: "running", generated_at: new Date().toISOString(),
    scope_path: scope.path, scope_id: scope.value.scope_id, scope_sha256: scope.sha256,
    task_path: scope.value.task_path, source: current, changed_paths: files,
    baseline_wip: scope.value.baseline.wip_porcelain_z, ui_required: detectUiRequired(files), ui,
    checks_start_path: startPath, checks_start_sha256: digest(fs.readFileSync(startPath)),
    evidence_boundary: "Engineering execution identity only, not task PASS or full-matrix acceptance. Git-visible files exclude ignored runtime/build/dependency facts; actual owner evidence and task DoD remain required.",
    native_scope: ui.summary_path ? readJson(artifactPath(rootDir, ui.summary_path)).scope ?? "unknown" : null,
    task_acceptance: "not_asserted",
  };
  const file = artifactPath(rootDir, path.join(required("artifact-dir"), "manifest.json"));
  writeNewJson(file, manifest); console.log(file);
}
function inspectManifest(file) {
  const absolute = artifactPath(rootDir, file);
  const manifest = readJson(absolute);
  must(manifest.schema_version === "task-completion/v2", "unscoped or historical manifest cannot complete current task");
  const { scope, current, files } = scopeState(manifest.scope_path);
  must(scope.sha256 === manifest.scope_sha256 && scope.value.scope_id === manifest.scope_id &&
    scope.value.task_path === manifest.task_path, "manifest scope mismatch");
  if (args.scope) must(readScope(rootDir, required("scope")).sha256 === scope.sha256, "different requested scope");
  assertSameSource(manifest.source, current);
  must(JSON.stringify(files) === JSON.stringify(manifest.changed_paths), "task delta changed");
  const startPath = artifactPath(rootDir, manifest.checks_start_path);
  must(digest(fs.readFileSync(startPath)) === manifest.checks_start_sha256, "checks start changed");
  nativeEvidence(scope, current, files, manifest.ui);
  return { absolute, manifest, scope, current };
}
function finalizeManifest() {
  const file = artifactPath(rootDir, required("manifest"));
  const manifest = readJson(file);
  must(manifest.status === "running", "only running manifest can be finalized");
  let status = "failed", reason = null;
  const bindingPath = artifactPath(rootDir, required("checks-binding"));
  const binding = readJson(bindingPath);
  try {
    const state = inspectManifest(file);
    const start = readJson(state.manifest.checks_start_path);
    must(binding.execution_id === start.execution_id, "checks execution identity mismatch");
    verifyExecution(rootDir, state.scope, bindingPath, state.current, "checks");
    must(start.scan_mode === binding.scan_mode && binding.scan_mode === "full",
      "only execution-frozen full scan can complete engineering verification");
    status = "completed";
  } catch (error) { reason = error.message; }
  const final = { ...manifest, status, finished_at: new Date().toISOString(),
    checks_binding_path: bindingPath, checks_binding_sha256: digest(fs.readFileSync(bindingPath)),
    static_scan: binding.scan_mode === "skipped" ? "not_run" : binding.status,
    static_scan_mode: binding.scan_mode,
    completion_error: reason };
  fs.writeFileSync(file + ".tmp", JSON.stringify(final, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(file + ".tmp", file);
  console.log("task-done: " + status);
  if (status !== "completed") process.exitCode = 1;
}
function checkManifest() {
  const requested = text(args.manifest) ?? text(process.env.TASK_DONE_MANIFEST);
  if (!requested) {
    // This is the existing whole-tree scan consumer, not a task-completion assertion.
    snapshot(rootDir);
    must(process.env.TASK_DONE_CHECK_PURPOSE === "whole-tree-inventory", "scope/manifest missing; clean tree is not task completion");
    console.log("task-done: explicit whole-tree identity inventory only; no task completion asserted");
    return;
  }
  const state = inspectManifest(requested);
  const { manifest, scope, current, absolute } = state;
  if (manifest.status === "running") {
    must(process.env.TASK_DONE_CHECK_PURPOSE === "execution-preflight" &&
      path.resolve(process.env.TASK_DONE_RUNNING_MANIFEST ?? "") === absolute,
    "completion pending; running manifest is not completed");
    console.log("task-done: execution identity preflight only; completion pending");
    return;
  }
  must(manifest.status === "completed", "task is not completed");
  must(digest(fs.readFileSync(artifactPath(rootDir, manifest.checks_binding_path))) === manifest.checks_binding_sha256,
    "checks binding changed");
  const binding = verifyExecution(rootDir, scope, manifest.checks_binding_path, current, "checks");
  const start = readJson(manifest.checks_start_path);
  must(binding.execution_id === start.execution_id && binding.scan_mode === "full" && start.scan_mode === "full", "checks identity/mode mismatch");
  console.log("task-done: engineering execution binding verified; task DoD/full matrix and baseline WIP completion NOT asserted");
}

function detectUiRequired(files) {
  return files.some(isUiRelevantFile);
}

// 测试文件不产生 UI 证据需求：只有生产 UI 代码变更才要求 Tauri 页面证据。
// 否则 `apps/novel_web/test/**` 里含 workspace/ui/copy 等关键词的纯测试改动会被
// 误判为 UI 变更，迫使无关 slice 伪造页面证据或阻塞收口（2026-11-08 B81 CP1 发现）。
function isTestFile(file) {
  const normalized = `/${file}`;
  return (
    file.endsWith("_test.exs") ||
    normalized.includes("/test/") ||
    /\.test\.(?:mjs|js|ts|tsx)$/.test(file)
  );
}

// 验收 harness 不是产品 UI：`frontend/slice-verify/**` 与
// `scripts/tauri_slice_verify.sh` 是驱动真实页面的外部验收资产，改它们不改变产品
// 行为，其改动由 quality manifest + 对应真实批次证据校验。若不排除，browser-surface
// 场景（如 su01-provider-splash-local）会被强制要求 native 证据，只能伪造或阻塞
// 收口（与 2026-11-08「测试文件不产生 UI 证据需求」同族）。
function isAcceptanceHarnessFile(file) {
  return file.startsWith("frontend/slice-verify/") || file === "scripts/tauri_slice_verify.sh";
}

function isUiRelevantFile(file) {
  if (isTestFile(file) || isAcceptanceHarnessFile(file)) {
    return false;
  }

  return (
    file.startsWith("frontend/src/") ||
    file.startsWith("frontend/src-tauri/") ||
    /(^|\/)(ui|card|copy|socket|workspace|projection|adoption|reading|tauri|slice-verify)/i.test(file)
  );
}

// 显式摘要与 latest 选择共用同一判据，避免两条路径对“原生通过”给出不同答案。
function nativeUiProblem(summary, dir, expectedSliceId = null) {
  if (!nativeSurfaces.has(summary.surface)) {
    return `surface=${JSON.stringify(summary.surface)} is not tauri/tauri-native`;
  }

  if (!nativeDrivers.has(summary.driver)) {
    return `driver=${JSON.stringify(summary.driver)} is not an explicit native driver`;
  }

  if (summary.all_checks_passed !== true) return "positive all_checks_passed=true completion evidence missing";
  const failure = explicitFailure(summary, dir);
  if (failure) {
    return failure;
  }

  if (expectedSliceId && summary.slice_id !== expectedSliceId) {
    return `slice_id=${JSON.stringify(summary.slice_id)} does not match ${JSON.stringify(expectedSliceId)}`;
  }

  // 现代 tauri-native runner 都会落 native-ui-complete.json；缺它、driver 不一致或
  // scope 与 summary.slice_id 不一致都说明来源未证明，不能只凭 surface 字符串代签。
  // 老 tauri 归档允许没有该文件，但一旦存在就必须与 summary 的 driver 一致。
  const completePath = path.join(dir, "native-ui-complete.json");
  if (summary.surface === "tauri-native" && !existsSync(completePath)) {
    return "native-ui-complete.json is missing";
  }
  if (existsSync(completePath)) {
    const complete = readJson(completePath);
    if (!nativeDrivers.has(complete.driver) || complete.driver !== summary.driver) {
      return `native-ui-complete.json driver=${JSON.stringify(complete.driver)} does not match summary driver=${JSON.stringify(summary.driver)}`;
    }
    if (summary.surface === "tauri-native" && complete.scope !== summary.slice_id) {
      return `native-ui-complete.json scope=${JSON.stringify(complete.scope)} does not match summary slice_id=${JSON.stringify(summary.slice_id)}`;
    }
  }

  return null;
}

// 只读取现役 producer 真实写出的失败字段；未在真实归档出现的形状不猜。
function explicitFailure(summary, dir) {
  if (existsSync(path.join(dir, "failure.json"))) {
    return "failure.json is present";
  }
  if (summary.all_checks_passed === false) {
    return "all_checks_passed=false";
  }
  if (Array.isArray(summary.failed) && summary.failed.length > 0) {
    return `failed=${JSON.stringify(summary.failed)}`;
  }
  if (summary.verdict?.mechanism === "fail") {
    return 'verdict.mechanism="fail"';
  }
  if (summary.author_visible?.ok === false) {
    return "author_visible.ok=false";
  }
  if (summary.verdict?.author_visible !== undefined) {
    if (summary.verdict.author_visible !== "pass") {
      return `verdict.author_visible=${JSON.stringify(summary.verdict.author_visible)}`;
    }
    if (summary.author_visible?.ok !== true) {
      return "author_visible.ok is not true";
    }
  }

  return null;
}
