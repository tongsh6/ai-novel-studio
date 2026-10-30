#!/usr/bin/env node
// B70 CP3：从失败轨迹生成 regression case 候选（不自动写 corpus）。
//   node scripts/author_behavior_promote_regression.mjs --trace <failure-trace.json> --out <candidate.yml> [--ledger <regressions.json>]
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus } from "./lib/quality/author_behavior.mjs";
import { promoteFailureToRegression } from "./lib/quality/author_behavior_promote.mjs";

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
};
const tracePath = valueOf("--trace");
const outPath = valueOf("--out");
const ledgerPath = valueOf("--ledger");
if (!tracePath || !outPath) {
  console.error("usage: node scripts/author_behavior_promote_regression.mjs --trace <failure-trace.json> --out <candidate.yml> [--ledger <regressions.json>]");
  process.exit(64);
}

const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
const corpus = loadAuthorBehaviorCorpus(DEFAULT_PROJECT_ROOT);
const ledgerFile = ledgerPath ? path.resolve(ledgerPath) : path.join(DEFAULT_PROJECT_ROOT, "quality/acceptance/author-behavior/regressions.json");
const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, "utf8")) : { schema: "author-behavior-regressions/v1", promoted: [] };
const existingFingerprints = (ledger.promoted ?? []).map((entry) => entry.fingerprint);

try {
  const result = promoteFailureToRegression({ failureTrace: trace, corpus, existingFingerprints });
  const yaml = [
    `  - id: ${result.candidate.id}`,
    `    target_id: ${result.candidate.target_id}`,
    `    state_id: ${result.candidate.state_id}`,
    `    split: regression`,
    `    tier: nightly`,
    `    provenance:`,
    `      kind: derived_frozen`,
    `      source_refs:`,
    ...result.candidate.provenance.source_refs.map((ref) => `        - ${ref}`),
    `      frozen_at: "${result.candidate.provenance.frozen_at}"`,
    `    expression: ${JSON.stringify(result.candidate.expression)}`,
    `    expression_frozen: true`,
    `    expected:`,
    `      allowed_actions: [${result.candidate.expected.allowed_actions.join(", ")}]`,
    `      allowed_effects: [${result.candidate.expected.allowed_effects.join(", ")}]`,
    `      forbidden_behaviors: [${result.candidate.expected.forbidden_behaviors.join(", ")}]`,
    `      oracle_refs: [${result.candidate.expected.oracle_refs.join(", ")}]`,
    `    notes: ${JSON.stringify(result.candidate.notes)}`,
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), yaml);
  ledger.schema = "author-behavior-regressions/v1";
  ledger.promoted = [...(ledger.promoted ?? []), result.ledger_entry];
  fs.writeFileSync(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
  console.error(`已生成 regression 候选: ${outPath}；fingerprint=${result.fingerprint}`);
} catch (error) {
  console.error(`未生成候选: ${error.message}`);
  process.exit(66);
}
