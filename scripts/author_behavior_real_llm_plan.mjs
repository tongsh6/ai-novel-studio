#!/usr/bin/env node
// B70 CP3：生成 holdout-only 真实模型预注册（只写预注册，不加载模型）。
//   node scripts/author_behavior_real_llm_plan.mjs --out artifacts/author-behavior/real-llm-prereg.json
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus } from "./lib/quality/author_behavior.mjs";
import { buildRealLlmPreregistration } from "./lib/quality/author_behavior_real_llm.mjs";

const argv = process.argv.slice(2);
const out = argv.includes("--out") ? path.resolve(argv[argv.indexOf("--out") + 1]) : null;
if (!out) {
  console.error("usage: node scripts/author_behavior_real_llm_plan.mjs --out <prereg.json> [--evidence-dir <dir>]");
  process.exit(64);
}
const evidenceDirIndex = argv.indexOf("--evidence-dir");
const evidenceDir = evidenceDirIndex >= 0 ? argv[evidenceDirIndex + 1] : "artifacts/author-behavior/real-llm-subset";
let gitHead = null;
try {
  const { execFileSync } = await import("node:child_process");
  gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: DEFAULT_PROJECT_ROOT, encoding: "utf8" }).trim();
} catch {
  gitHead = null;
}
try {
  const corpus = loadAuthorBehaviorCorpus(DEFAULT_PROJECT_ROOT);
  const prereg = buildRealLlmPreregistration({ corpus, evidenceDir, gitHead });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(prereg, null, 2)}\n`);
  console.error(`已写入真实模型预注册（未加载模型）: ${out}`);
  console.error(`holdout cases=${prereg.scope.case_ids.length} status=${prereg.status}`);
} catch (error) {
  console.error(`预注册生成失败: ${error.message}`);
  process.exit(66);
}
