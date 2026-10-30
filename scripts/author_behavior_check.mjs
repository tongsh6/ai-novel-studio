#!/usr/bin/env node
// B70 CP0：author-behavior 冻结语料/状态/oracle/覆盖报告格式校验入口。
//
// 用法：
//   node scripts/author_behavior_check.mjs [--root <repo>] [--json]
//   node scripts/author_behavior_check.mjs --report <coverage-report.json>
//   node scripts/author_behavior_check.mjs --write-example <quality/.../coverage-report.example.json>
//
// 退出码：0 通过；66 语料/报告格式或引用错误；64 usage；2 环境（PyYAML）不可用。
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PROJECT_ROOT,
  AuthorBehaviorError,
  loadAuthorBehaviorCorpus,
  validateAuthorBehaviorCorpus,
  validateCoverageReport,
  readCoverageReport,
  coverageReportExample,
} from "./lib/quality/author_behavior.mjs";

function parseArgs(argv) {
  const options = { root: DEFAULT_PROJECT_ROOT, json: false, report: null, writeExample: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = path.resolve(argv[(index += 1)] ?? "");
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--report") {
      options.report = path.resolve(argv[(index += 1)] ?? "");
    } else if (arg === "--write-example") {
      options.writeExample = path.resolve(argv[(index += 1)] ?? "");
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      console.error(`未知参数: ${arg}`);
      process.exit(64);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "usage: node scripts/author_behavior_check.mjs [--root <repo>] [--json] " +
        "[--report <coverage-report.json>] [--write-example <path>]",
    );
    return 0;
  }

  let corpus;
  try {
    corpus = loadAuthorBehaviorCorpus(options.root);
  } catch (error) {
    if (error instanceof AuthorBehaviorError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  const validation = validateAuthorBehaviorCorpus(corpus);
  const reportFailures = [];
  if (options.report) {
    let report;
    try {
      report = readCoverageReport(options.report);
    } catch (error) {
      console.error(`无法读取覆盖报告 ${options.report}: ${error.message}`);
      return 66;
    }
    const reportValidation = validateCoverageReport(report, corpus, validation);
    if (!reportValidation.ok) reportFailures.push(...reportValidation.errors);
  }

  if (options.writeExample) {
    const example = coverageReportExample(corpus, validation);
    fs.writeFileSync(options.writeExample, `${JSON.stringify(example, null, 2)}\n`);
    console.log(`已写入覆盖报告格式示例: ${options.writeExample}`);
  }

  const output = {
    ok: validation.ok && reportFailures.length === 0,
    stats: validation.stats,
    errors: validation.errors,
    warnings: validation.warnings,
    report_errors: reportFailures,
    report: options.report,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(
      `[author-behavior] targets=${validation.stats.targets} states=${validation.stats.states} ` +
        `cases=${validation.stats.cases} splits=${JSON.stringify(validation.stats.splits)} ` +
        `tiers=${JSON.stringify(validation.stats.tiers)} corpus_sha=${validation.stats.corpus_sha.slice(0, 12)}`,
    );
    for (const error of validation.errors) console.error(`  ERROR ${error.code}: ${error.detail}`);
    for (const error of reportFailures) console.error(`  REPORT ERROR ${error.code}: ${error.detail}`);
    for (const warning of validation.warnings) console.error(`  WARN ${warning.code}: ${warning.detail}`);
  }

  return output.ok ? 0 : 66;
}

process.exit(main());
