#!/usr/bin/env node
// B41 CP4：quality verdict v2 reader/writer CLI，供 bash runner 调用；stdout 只输出 JSON。
// 读取规则：缺 verdict.json / 缺 status / 结构无效一律 evidence_missing（退出码 67），绝不默认 PASS。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXIT_CODES,
  SCHEMA_VERSION,
  VERDICT_FILE,
  exitCodeForStatus,
  readVerdict,
  validateVerdict,
  writeVerdict,
} from "./verdict.mjs";

const USAGE = `verdict-cli：quality verdict v2（${SCHEMA_VERSION}）读写入口，供 bash runner 调用。

用法：
  node scripts/lib/quality/verdict_cli.mjs read <artifact_dir>
  node scripts/lib/quality/verdict_cli.mjs write <artifact_dir> <verdict.json>
  node scripts/lib/quality/verdict_cli.mjs validate <verdict.json>

read 退出码（按 verdict.status 映射）：
  0   pass
  1   fail
  65  skipped（批次内 blocked 语义）
  67  evidence_missing（缺 verdict.json / 缺 status / 结构无效同样 67）
  69  not_run
write：0 写入成功；1 输入 verdict 无效、拒绝覆盖 PASS 或 IO 失败。
validate：0 有效；1 无效。
通用：64 用法错误；66 未预期配置/环境错误。
`;

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printFailure(context, message) {
  process.stderr.write(`verdict-cli: ${context}: ${message}\n`);
}

function readCommand(artifactDir) {
  const result = readVerdict(artifactDir);
  if (result.ok) {
    emit(result.verdict);
    return exitCodeForStatus(result.verdict.status);
  }
  emit({
    schema_version: SCHEMA_VERSION,
    scenario_id: null,
    status: "evidence_missing",
    reason: result.reason,
    reason_codes: result.reason_codes ?? ["verdict_missing"],
    artifact_dir: result.artifact_dir,
    legacy_summary: result.legacy_summary === true,
    errors: result.errors,
  });
  return EXIT_CODES.evidence_missing;
}

function writeCommand(artifactDir, file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const errors = [`读取/解析 verdict JSON 失败：${error.message}`];
    printFailure("write", errors[0]);
    emit({ ok: false, errors });
    return EXIT_CODES.fail;
  }
  try {
    const written = writeVerdict(artifactDir, raw);
    emit(written);
    return 0;
  } catch (error) {
    const errors = error.errors?.length ? error.errors : [error.message];
    printFailure("write", error.message);
    emit({ ok: false, code: error.code ?? "write_failed", errors });
    return EXIT_CODES.fail;
  }
}

function validateCommand(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const errors = [`读取/解析 verdict JSON 失败：${error.message}`];
    printFailure("validate", errors[0]);
    emit({ ok: false, errors });
    return EXIT_CODES.fail;
  }
  const errors = validateVerdict(raw);
  if (errors.length > 0) {
    printFailure("validate", `未通过结构校验（${errors.length} 项）`);
    emit({ ok: false, errors });
    return EXIT_CODES.fail;
  }
  emit({ ok: true });
  return 0;
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === undefined) {
    process.stderr.write(USAGE);
    return EXIT_CODES.usage;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === "read") {
    if (args.length !== 1) {
      process.stderr.write(USAGE);
      return EXIT_CODES.usage;
    }
    return readCommand(args[0]);
  }
  if (command === "write") {
    if (args.length !== 2) {
      process.stderr.write(USAGE);
      return EXIT_CODES.usage;
    }
    return writeCommand(args[0], args[1]);
  }
  if (command === "validate") {
    if (args.length !== 1) {
      process.stderr.write(USAGE);
      return EXIT_CODES.usage;
    }
    return validateCommand(args[0]);
  }
  printFailure("usage", `未知命令 ${command}（支持 read / write / validate）`);
  process.stderr.write(USAGE);
  return EXIT_CODES.usage;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    printFailure("unexpected", error.message);
    process.exitCode = EXIT_CODES.config;
  }
}

export { main, readCommand, writeCommand, validateCommand };
