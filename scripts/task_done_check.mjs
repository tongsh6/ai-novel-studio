#!/usr/bin/env node

import { execSync } from "node:child_process";
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
    ui_required: uiRequired,
    ui_touched_files: uiFiles,
    ui: {
      status: uiStatus,
      slice_id: args["slice-id"] || null,
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

  const manifestPath = args.manifest
    ? path.resolve(rootDir, args.manifest)
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
  if (latestTouched > 0 && generatedAt + staleToleranceMs < latestTouched) {
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
    if (summary.surface !== "tauri") {
      throw new Error(`task-done: UI summary must come from Tauri surface: ${normalizePath(summaryPath)}`);
    }
  }

  console.log(`task-done: manifest ok (${normalizePath(manifestPath)})`);
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

function detectUiRequired(files) {
  return files.some(isUiRelevantFile);
}

function isUiRelevantFile(file) {
  return (
    file.startsWith("frontend/src/") ||
    file.startsWith("frontend/slice-verify/") ||
    file.startsWith("frontend/src-tauri/") ||
    file === "scripts/tauri_slice_verify.sh" ||
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

  return readdirSync(sliceVerifyDir, { recursive: true })
    .filter((entry) => entry.endsWith("summary.json"))
    .map((entry) => path.join(sliceVerifyDir, entry))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    .map(normalizePath)[0] ?? null;
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
  if (!file) {
    return null;
  }

  return normalizePath(path.resolve(rootDir, file));
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
