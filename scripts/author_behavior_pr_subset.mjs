#!/usr/bin/env node
// B70 CP3：PR 受影响子集 CLI。
//   node scripts/author_behavior_pr_subset.mjs --paths a,b
//   node scripts/author_behavior_pr_subset.mjs --git-range origin/main...HEAD
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus } from "./lib/quality/author_behavior.mjs";
import { selectPrSubset } from "./lib/quality/author_behavior_pr_subset.mjs";

const argv = process.argv.slice(2);
let paths = [];
let gitRange = null;
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--paths") paths = String(argv[index + 1] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  else if (argv[index] === "--git-range") gitRange = argv[index + 1] ?? null;
}
if (gitRange) {
  const output = execFileSync("git", ["diff", "--name-only", gitRange], { cwd: DEFAULT_PROJECT_ROOT, encoding: "utf8" });
  paths = output.split("\n").map((line) => line.trim()).filter(Boolean);
}
const corpus = loadAuthorBehaviorCorpus(DEFAULT_PROJECT_ROOT);
const result = selectPrSubset({ paths, corpus });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
