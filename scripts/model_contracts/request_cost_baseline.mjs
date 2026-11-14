// B87 R01 成本测量薄 CLI：只做参数解析、命令分派和退出码。
// 历史 analyze / 完整副本 prepare/capture/verify 的 IO 与判据在
// request_cost_capture.mjs，纯 manifest 在 request_cost_manifest.mjs，
// 纯批次报告在 request_cost_batch_evidence.mjs。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_REPORT_SCHEMA } from "../lib/native_ui/request_cost_batch_evidence.mjs";
import {
  assertRuntimeFacts,
  runtimeEnvLines,
} from "../lib/native_ui/request_cost_runtime_recipe.mjs";
import {
  BEFORE_SCHEMA,
  analyzeHistory,
  captureBatch,
  prepareBatch,
  preflightNative,
  readManifest,
  rebuildSnapshot,
  restoreSnapshot,
  verifyBatch,
} from "../lib/native_ui/request_cost_capture.mjs";

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function rebuildSnapshotCommand(rest) {
  const outDir = argValue(rest, "--out");
  const fullPath = argValue(rest, "--full");
  assert(outDir, "usage: rebuild-snapshot --out <new-dir> [--full <v2-full>]");
  return rebuildSnapshot({ fullPath: fullPath ?? undefined, outDir });
}

function restoreSnapshotCommand(rest) {
  const [batchDir, snapshotDir] = rest;
  assert(batchDir && snapshotDir, "usage: restore-snapshot <batch-dir> <snapshot-dir>");
  return restoreSnapshot({ batchDir, snapshotDir });
}

function preflightCommand(rest) {
  const manifestPath = rest[0];
  const length = Number(argValue(rest, "--length"));
  const snapshotDir = argValue(rest, "--snapshot");
  const outDir = argValue(rest, "--out");
  assert(
    manifestPath && snapshotDir && outDir,
    "usage: preflight <manifest> --length N --snapshot <dir> --out <new-dir>",
  );
  return preflightNative({ manifestPath, snapshotDir, outDir, length });
}

function manifestFieldCommand(rest) {
  const [manifestPath, field] = rest;
  assert(manifestPath && field, "usage: manifest-field <manifest> <dotted.path>");
  const { manifest } = readManifest(manifestPath);
  const value = field.split(".").reduce((current, key) => (current == null ? current : current[key]), manifest);
  assert(
    ["string", "number", "boolean"].includes(typeof value),
    `manifest 字段不存在或不是标量: ${field}`,
  );
  const text = String(value);
  assert(!text.includes("\n") && !text.includes("\r"), `manifest 字段不能含换行: ${field}`);
  process.stdout.write(text);
}

function runtimeEnvCommand(rest) {
  const profile = argValue(rest, "--profile");

  if (profile) {
    process.stdout.write(`${runtimeEnvLines(profile).join("\n")}\n`);
    return;
  }

  const [manifestPath] = rest;
  assert(manifestPath, "usage: runtime-env <manifest> | runtime-env --profile <id>");
  const { manifest } = readManifest(manifestPath);
  // readManifest 已校验 runtime.profile 非空；这里不再复制同一守卫。
  process.stdout.write(`${runtimeEnvLines(manifest.runtime.profile).join("\n")}\n`);
}

function verifyRuntimeFactsCommand(rest) {
  const [factsPath] = rest;
  const profile = argValue(rest, "--profile");
  assert(factsPath, "usage: verify-runtime-facts <facts.json> [--profile <id>]");
  const facts = JSON.parse(fs.readFileSync(path.resolve(factsPath), "utf8"));
  assertRuntimeFacts(facts, profile ?? undefined);
  process.stdout.write(`${JSON.stringify({ ok: true, profile: profile ?? null })}\n`);
}

function analyzeCommand(rest) {
  const [manifestPath, outDir] = rest;
  assert(manifestPath && outDir, "usage: analyze <manifest> <out-dir>");
  return analyzeHistory({ manifestPath, outDir });
}

function prepareCommand(rest) {
  const [manifestPath, batchDir, ...args] = rest;
  const length = Number(argValue(args, "--length"));
  assert(manifestPath && batchDir && length, "usage: prepare <manifest> <batch-dir> --length 3|10|20");
  return prepareBatch({ manifestPath, batchDir, length });
}

function captureCommand(rest) {
  const [batchDir, checkpoint] = rest;
  assert(batchDir && checkpoint, "usage: capture <batch-dir> <start|final>");
  return captureBatch({ batchDir, checkpoint });
}

function verifyCommand(rest) {
  const [batchDir, ...args] = rest;
  assert(batchDir, "usage: verify <batch-dir> [--out <dir>]");
  return verifyBatch({ batchDir, outDir: argValue(args, "--out") ?? null });
}

const COMMANDS = Object.freeze({
  analyze: analyzeCommand,
  "manifest-field": manifestFieldCommand,
  "runtime-env": runtimeEnvCommand,
  "verify-runtime-facts": verifyRuntimeFactsCommand,
  prepare: prepareCommand,
  capture: captureCommand,
  verify: verifyCommand,
  "rebuild-snapshot": rebuildSnapshotCommand,
  "restore-snapshot": restoreSnapshotCommand,
  preflight: preflightCommand,
});

// CLI 退出码是其公开契约的一部分（pass/partial/fail 与 history 报告），单独可测。
export function exitCodeFor(report) {
  if (report?.schema === BEFORE_SCHEMA) return report.status === "pass" ? 0 : 1;
  if (report?.schema === NATIVE_REPORT_SCHEMA) {
    return report.status === "pass" ? 0 : report.status === "partial" ? 65 : 1;
  }
  return 0;
}

export function main(argv) {
  const [mode, ...rest] = argv;
  try {
    const command = COMMANDS[mode];
    assert(command, `unknown mode: ${mode}`);
    process.exitCode = exitCodeFor(command(rest));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
