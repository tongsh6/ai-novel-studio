#!/usr/bin/env node
// B39 CP1d：AU-15 证据 sidecar 校验 CLI（只读，不跑产品/模型）。
//   node scripts/au15_evidence.mjs verify <dir> --scenario A1
import fs from "node:fs";
import path from "node:path";
import { buildAu15Evidence, readAu15Artifacts } from "./lib/quality/au15_evidence.mjs";

const argv = process.argv.slice(2);
const mode = argv[0] ?? "verify";
const dir = argv[1] ?? "";
const scenarioArg = argv.includes("--scenario") ? argv[argv.indexOf("--scenario") + 1] : null;
if (mode !== "verify" || !dir) {
  console.error("usage: node scripts/au15_evidence.mjs verify <dir> --scenario A0|A1|A2");
  process.exit(64);
}
const { driverLog, llmCalls, dbCounts } = readAu15Artifacts(dir);
const scenario = scenarioArg ?? driverLog?.scenario ?? null;
if (!scenario) {
  console.error("missing --scenario");
  process.exit(64);
}
const evidence = buildAu15Evidence({ scenario, driverLog, llmCalls, dbCounts });
fs.writeFileSync(path.join(path.resolve(dir), "au15-evidence-sidecar.json"), JSON.stringify(evidence, null, 2));
console.log(
  `[au15-evidence] scenario=${scenario} mechanism=${evidence.mechanism.status} ` +
    `model_behavior=${evidence.model_behavior.status} observed_in_calls=${evidence.model_behavior.observed_in_calls}`,
);
if (evidence.mechanism.status === "fail") process.exit(1);
