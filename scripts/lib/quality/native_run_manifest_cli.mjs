#!/usr/bin/env node
// B42 CP3：原生证据发现 CLI——扫描一个原生 artifact 目录并输出统一 run manifest。
//
// 用法：
//   node scripts/lib/quality/native_run_manifest_cli.mjs scan <artifact-dir> [--json]
//   node scripts/lib/quality/native_run_manifest_cli.mjs scan <artifact-dir> --out <file>
//
// 只读旧 artifact；--out 写出的 manifest 默认拒绝覆盖已有文件。
// 退出码：0 manifest 已产出（不等于场景 PASS，status 以 manifest 内字段为准）；
//         64 usage；66 目录/写入错误。

import fs from "node:fs";
import path from "node:path";
import {
  NATIVE_RUN_SCHEMA_VERSION,
  scanNativeArtifactDir,
  validateNativeRunManifest,
  writeNativeRunManifest,
} from "./native_run_manifest.mjs";

const USAGE = [
  "用法：node scripts/lib/quality/native_run_manifest_cli.mjs scan <artifact-dir> [options]",
  "  --json        stdout 输出 JSON（默认人类可读摘要）",
  "  --out <file>  写出统一 run manifest（默认拒绝覆盖）",
];

function parseArgs(argv) {
  const args = [...argv];
  if (args[0] !== "scan") {
    throw new Error(args[0] ? `未知子命令：${args[0]}` : "缺少子命令 scan");
  }
  args.shift();
  const options = { flags: new Set(), out: null, dir: null };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--json") {
      options.flags.add("json");
      continue;
    }
    if (token === "--out") {
      options.out = args[index + 1];
      if (!options.out) throw new Error("--out 缺少文件路径");
      index += 1;
      continue;
    }
    if (token.startsWith("--")) throw new Error(`未知参数：${token}`);
    if (options.dir) throw new Error(`多余参数：${token}`);
    options.dir = token;
  }
  if (!options.dir) throw new Error("缺少 artifact-dir");
  return options;
}

function humanSummary(manifest) {
  const lines = [
    `[native-run] schema=${NATIVE_RUN_SCHEMA_VERSION} artifact=${manifest.artifact_dir}`,
    `[native-run] status=${manifest.status} pass_scope=${manifest.pass_scope ?? "-"} full_matrix=${manifest.full_matrix_established}`,
    `[native-run] run: slice=${manifest.run.slice_id ?? "-"} driver=${manifest.run.driver ?? "-"} provider=${manifest.run.provider ?? "-"} model=${manifest.run.model ?? "-"} scope=${manifest.run.scope ?? "-"}`,
    `[native-run] final=${manifest.final.found} failure=${manifest.failure.found} termination=${manifest.termination.signal ?? "-"}/${manifest.termination.exit_code ?? "-"}`,
    `[native-run] checks=${manifest.checks.passed}/${manifest.checks.total} failed=${manifest.checks.failed.length} transport(frames=${manifest.native_transport.frames} http=${manifest.native_transport.http_requests})`,
    `[native-run] ax=${manifest.ax.ax_dumps} text=${manifest.ax.text_dumps} screenshots=${manifest.ax.screenshots} db=${manifest.db_snapshot.count} head=${manifest.production_fingerprint.head ?? "-"}`,
  ];
  if (manifest.reason_codes.length > 0) lines.push(`[native-run] reason_codes: ${manifest.reason_codes.join(",")}`);
  return lines.join("\n");
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE.join("\n"));
    return 64;
  }
  let manifest;
  try {
    manifest = scanNativeArtifactDir(options.dir);
  } catch (error) {
    console.error(`[native-run] 扫描失败：${error.message}`);
    return 66;
  }
  const errors = validateNativeRunManifest(manifest);
  if (errors.length > 0) {
    console.error(`[native-run] manifest 未通过校验：\n- ${errors.join("\n- ")}`);
    return 66;
  }
  if (options.out) {
    try {
      const written = writeNativeRunManifest(manifest, { out: path.resolve(options.out) });
      console.error(`[native-run] wrote ${written.path}`);
    } catch (error) {
      console.error(`[native-run] 写入失败：${error.message}`);
      return 66;
    }
  }
  if (options.flags.has("json")) console.log(JSON.stringify(manifest, null, 2));
  else console.log(humanSummary(manifest));
  return 0;
}

process.exit(main());
