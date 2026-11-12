#!/usr/bin/env node

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const args = parseArgs(process.argv.slice(2));
const staleToleranceMs = 2_000;
// 只承认当前原生验收生产者显式写出的 surface + driver 组合；surface 字符串本身不代签。
const nativeSurfaces = new Set(["tauri", "tauri-native"]);
const nativeDrivers = new Set([
  "ax-native-system-ui",
  "cua-native-system-ui",
  "macos-cgevent",
  "macos-cgevent-plan-matrix",
]);

try {
  if (args["ui-required"]) {
    console.log(detectUiRequired(getTouchedFiles()) ? "true" : "false");
    process.exit(0);
  }

  if (args["latest-ui-summary"]) {
    const latest = findLatestUiSummary();
    if (latest) {
      console.log(latest);
    }
    process.exit(latest ? 0 : 1);
  }

  if (args["write-manifest"]) {
    writeManifest();
    process.exit(0);
  }

  checkManifest();
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function writeManifest() {
  const artifactDir = path.resolve(args["artifact-dir"] ?? "artifacts/task-done/latest");
  const touchedFiles = getTouchedFiles();
  const uiFiles = touchedFiles.filter(isUiRelevantFile);
  const uiRequired = uiFiles.length > 0;
  const uiSummary = normalizeOptionalPath(args["ui-summary"]);
  const uiStatus = args["ui-status"] ?? (uiRequired ? "missing" : "not_required");
  const manifestPath = path.join(artifactDir, "manifest.json");

  mkdirSync(artifactDir, { recursive: true });

  const manifest = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    git_head: readCommand("git rev-parse HEAD").trim() || null,
    touched_files: touchedFiles,
    touched_file_hashes: hashTouchedFiles(touchedFiles),
    ui_required: uiRequired,
    ui_touched_files: uiFiles,
    ui: {
      status: uiStatus,
      slice_id: optionalString(args["slice-id"]),
      summary_path: uiSummary,
      artifact_dir: uiSummary ? normalizePath(path.dirname(path.resolve(rootDir, uiSummary))) : null,
    },
    checks: [
      {
        id: "task-done-manifest",
        status: "passed",
        log_path: normalizeOptionalPath(args["checks-log"]),
      },
    ],
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(manifestPath);
}

function checkManifest() {
  const touchedFiles = getTouchedFiles();

  if (touchedFiles.length === 0) {
    console.log("task-done: no touched files; manifest not required");
    return;
  }

  const requestedManifest = args.manifest ?? process.env.TASK_DONE_MANIFEST;
  const manifestPath = requestedManifest
    ? path.resolve(rootDir, requestedManifest)
    : findLatestManifest();

  if (!manifestPath) {
    throw new Error("task-done: missing manifest. Run `bash scripts/task_done.sh` before final scan.");
  }

  const manifest = readJson(manifestPath);
  const generatedAt = Date.parse(manifest.generated_at ?? "");

  if (!Number.isFinite(generatedAt)) {
    throw new Error(`task-done: invalid generated_at in ${normalizePath(manifestPath)}`);
  }

  const latestTouched = latestMtime(touchedFiles);
  if (
    latestTouched > 0 &&
    generatedAt + staleToleranceMs < latestTouched &&
    !manifestContentMatches(manifest, touchedFiles)
  ) {
    throw new Error(
      [
        "task-done: manifest is stale.",
        `manifest=${normalizePath(manifestPath)}`,
        `latest_touched=${new Date(latestTouched).toISOString()}`,
        "Run `bash scripts/task_done.sh` again after the latest edits.",
      ].join("\n"),
    );
  }

  const uiFiles = touchedFiles.filter(isUiRelevantFile);
  const currentUiRequired = uiFiles.length > 0;

  if (currentUiRequired) {
    if (manifest.ui_required !== true || manifest.ui?.status !== "verified") {
      throw new Error(
        [
          "task-done: UI evidence is required but not verified.",
          `manifest=${normalizePath(manifestPath)}`,
          "Run `bash scripts/task_done.sh --slice <slice-id>` so the real UI path is exercised.",
        ].join("\n"),
      );
    }

    const summaryPath = resolveOptionalPath(manifest.ui?.summary_path);
    if (!summaryPath || !existsSync(summaryPath)) {
      throw new Error(`task-done: UI summary is missing: ${manifest.ui?.summary_path ?? "<empty>"}`);
    }

    const summaryMtime = statSync(summaryPath).mtimeMs;
    const latestUiTouched = latestMtime(uiFiles);
    if (latestUiTouched > 0 && summaryMtime + staleToleranceMs < latestUiTouched) {
      throw new Error(
        [
          "task-done: UI evidence is older than the latest UI edit.",
          `summary=${normalizePath(summaryPath)}`,
          `latest_ui_touched=${new Date(latestUiTouched).toISOString()}`,
          "Rerun the slice UI verification.",
        ].join("\n"),
      );
    }

    const summary = readJson(summaryPath);
    const problem = nativeUiProblem(
      summary,
      path.dirname(summaryPath),
      optionalString(manifest.ui?.slice_id),
    );
    if (problem) {
      throw new Error(
        [
          "task-done: UI summary is not accepted native evidence.",
          `summary=${normalizePath(summaryPath)}`,
          `reason=${problem}`,
          "Use a current native summary (surface=tauri/tauri-native, explicit AX/CUA/macos-cgevent driver, no failure) for this slice.",
        ].join("\n"),
      );
    }
  }

  console.log(`task-done: manifest ok (${normalizePath(manifestPath)})`);
}

function manifestContentMatches(manifest, touchedFiles) {
  const recorded = manifest.touched_file_hashes;
  if (!recorded || typeof recorded !== "object") {
    return false;
  }

  const current = hashTouchedFiles(touchedFiles);
  return JSON.stringify(recorded) === JSON.stringify(current);
}

function getTouchedFiles() {
  const files = new Set();

  for (const command of [
    "git diff --name-only HEAD --",
    "git ls-files --others --exclude-standard",
  ]) {
    for (const file of readCommand(command).split("\n").filter(Boolean)) {
      const normalized = normalizePath(file);
      if (!isIgnorableTouchedFile(normalized)) {
        files.add(normalized);
      }
    }
  }

  return [...files].sort();
}

function hashTouchedFiles(files) {
  return Object.fromEntries(
    files.map((file) => {
      const absolute = path.resolve(rootDir, file);
      if (!existsSync(absolute)) {
        return [file, null];
      }

      const hash = createHash("sha256").update(readFileSync(absolute)).digest("hex");
      return [file, hash];
    }),
  );
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

function isIgnorableTouchedFile(file) {
  return file.endsWith(".bak") || file.endsWith(".tmp") || file === ".DS_Store";
}

function latestMtime(files) {
  return files.reduce((latest, file) => {
    const absolute = path.resolve(rootDir, file);
    if (!existsSync(absolute)) {
      return latest;
    }

    return Math.max(latest, statSync(absolute).mtimeMs);
  }, 0);
}

function findLatestManifest() {
  const taskDoneDir = path.join(rootDir, "artifacts/task-done");
  if (!existsSync(taskDoneDir)) {
    return null;
  }

  return readdirSync(taskDoneDir)
    .map((entry) => path.join(taskDoneDir, entry, "manifest.json"))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] ?? null;
}

function findLatestUiSummary() {
  const sliceVerifyDir = path.join(rootDir, "artifacts/slice-verify");
  if (!existsSync(sliceVerifyDir)) {
    return null;
  }

  const expectedSliceId = optionalString(args["slice-id"]);
  return readdirSync(sliceVerifyDir, { recursive: true })
    .filter((entry) => path.basename(entry) === "summary.json")
    .map((entry) => path.join(sliceVerifyDir, entry))
    .filter(existsSync)
    .filter((file) => acceptedNativeUiSummary(file, expectedSliceId))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    .map(normalizePath)[0] ?? null;
}

function acceptedNativeUiSummary(file, expectedSliceId) {
  try {
    return nativeUiProblem(readJson(file), path.dirname(file), expectedSliceId) === null;
  } catch {
    return false;
  }
}

// 显式摘要与 latest 选择共用同一判据，避免两条路径对“原生通过”给出不同答案。
function nativeUiProblem(summary, dir, expectedSliceId = null) {
  if (!nativeSurfaces.has(summary.surface)) {
    return `surface=${JSON.stringify(summary.surface)} is not tauri/tauri-native`;
  }

  if (!nativeDrivers.has(summary.driver)) {
    return `driver=${JSON.stringify(summary.driver)} is not an explicit native driver`;
  }

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

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`task-done: cannot read JSON ${normalizePath(file)}: ${error.message}`);
  }
}

function readCommand(command) {
  try {
    return execSync(command, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function normalizeOptionalPath(file) {
  if (typeof file !== "string" || file.length === 0) {
    return null;
  }

  return normalizePath(path.resolve(rootDir, file));
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolveOptionalPath(file) {
  if (!file) {
    return null;
  }

  return path.resolve(rootDir, file);
}

function normalizePath(file) {
  return path.relative(rootDir, path.resolve(rootDir, file)).replaceAll(path.sep, "/");
}
