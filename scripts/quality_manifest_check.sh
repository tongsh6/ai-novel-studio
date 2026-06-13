#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node --input-type=module - "$PROJECT_ROOT" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [projectRoot] = process.argv.slice(2);
const indexPath = path.join(projectRoot, "quality/acceptance/scenarios.yml");
const ciDocPath = path.join(projectRoot, "quality/gates/ci.md");
const errors = [];
const warnings = [];

function clean(value) {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function parseScenarioIndex(text) {
  const scenarios = [];
  let current = null;

  for (const line of text.split("\n")) {
    const idMatch = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (idMatch) {
      current = { id: clean(idMatch[1]) };
      scenarios.push(current);
      continue;
    }

    const fieldMatch = line.match(/^\s{4}([A-Za-z_]+):\s*(.*)$/);
    if (current && fieldMatch) {
      current[fieldMatch[1]] = clean(fieldMatch[2]);
    }
  }

  return scenarios;
}

function parseScalar(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escaped}:\\s*(.+)$`, "m"));
  return match ? clean(match[1]) : "";
}

function hasTopLevelKey(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}:`, "m").test(text);
}

function hasNestedFalse(text, parent, key) {
  const escapedParent = parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedParent}:\\n(?:[ \\t].*\\n)*[ \\t]+${escapedKey}:\\s*false\\b`, "m").test(text);
}

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

function defaultRunnerForSurface(surface) {
  return surface === "tauri" ? "tauri_slice_verify" : "slice_verify";
}

function parseTauriList(output) {
  const ids = new Set();
  let inImplementedBlock = false;

  for (const line of output.split("\n")) {
    if (line.includes("Implemented external UI driver slice ids:")) {
      inImplementedBlock = true;
      continue;
    }
    if (!inImplementedBlock) continue;
    if (!line.trim()) break;

    const id = line.trim();
    if (/^[a-z0-9][a-z0-9-]+$/.test(id)) {
      ids.add(id);
    }
  }

  return ids;
}

if (!fs.existsSync(indexPath)) {
  errors.push("quality/acceptance/scenarios.yml is missing");
} else {
  const scenarios = parseScenarioIndex(fs.readFileSync(indexPath, "utf8"));
  const ids = new Set();
  const byId = new Map();

  requireCondition(
    scenarios.length >= 5,
    `quality/acceptance/scenarios.yml: expected at least 5 scenarios, found ${scenarios.length}`,
  );

  for (const scenario of scenarios) {
    if (!scenario.id) {
      errors.push("quality/acceptance/scenarios.yml: scenario without id");
      continue;
    }

    if (ids.has(scenario.id)) {
      errors.push(`quality/acceptance/scenarios.yml: duplicate scenario id ${scenario.id}`);
    }
    ids.add(scenario.id);
    byId.set(scenario.id, scenario);

    for (const field of ["id", "title", "tier", "surface", "manifest", "driver", "entrypoint"]) {
      if (!scenario[field]) {
        errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} missing ${field}`);
      }
    }

    if (scenario.surface && !["browser", "tauri"].includes(scenario.surface)) {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} unsupported surface ${scenario.surface}`);
    }

    const runner = scenario.runner || defaultRunnerForSurface(scenario.surface);
    if (!["slice_verify", "tauri_slice_verify", "dogfood_run"].includes(runner)) {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} unsupported runner ${runner}`);
    }

    if (scenario.status === "blocked" && !scenario.blocked_reason) {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} is blocked but missing blocked_reason`);
    }

    if (scenario.driver && !fs.existsSync(path.join(projectRoot, scenario.driver))) {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} driver missing: ${scenario.driver}`);
    }

    if (runner === "slice_verify" && scenario.surface !== "browser") {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} runner slice_verify requires surface browser`);
    }

    if (runner === "tauri_slice_verify" && scenario.surface !== "tauri") {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} runner tauri_slice_verify requires surface tauri`);
    }

    if (runner === "dogfood_run") {
      if (scenario.surface !== "browser") {
        errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} dogfood_run must declare surface browser`);
      }
      if (scenario.default_provider !== "lmstudio") {
        errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} dogfood_run must declare default_provider lmstudio`);
      }
      if (!/scripts\/dogfood_run\.sh\b/.test(scenario.entrypoint ?? "")) {
        errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} dogfood_run entrypoint must route to scripts/dogfood_run.sh`);
      }
      if (/scripts\/quality_accept\.sh\b/.test(scenario.entrypoint ?? "")) {
        errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} dogfood_run entrypoint must not route through quality_accept.sh`);
      }
      if (scenario.driver && !scenario.driver.endsWith("/dogfood-runner.mjs")) {
        errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} dogfood_run driver must be dogfood-runner.mjs`);
      }
    }

    if (runner === "tauri_slice_verify" && /scripts\/slice_verify\.sh\b/.test(scenario.entrypoint ?? "")) {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} tauri scenario routes to browser slice_verify.sh`);
    }

    if (runner === "slice_verify" && /scripts\/tauri_slice_verify\.sh\b/.test(scenario.entrypoint ?? "")) {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} browser scenario routes to tauri_slice_verify.sh`);
    }

    if (["slice_verify", "tauri_slice_verify"].includes(runner) && scenario.surface && scenario.entrypoint && !scenario.entrypoint.includes(`--surface ${scenario.surface}`)) {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} entrypoint does not include --surface ${scenario.surface}`);
    }

    if (!scenario.manifest) continue;

    const manifestAbs = path.join(projectRoot, scenario.manifest);
    if (!fs.existsSync(manifestAbs)) {
      errors.push(`quality/acceptance/scenarios.yml: ${scenario.id} manifest missing: ${scenario.manifest}`);
      continue;
    }

    const manifestText = fs.readFileSync(manifestAbs, "utf8");
    const manifestFile = scenario.manifest;

    for (const key of [
      "id",
      "title",
      "tier",
      "surface",
      "entrypoint",
      "contract",
      "invariants",
      "setup",
      "user_flow",
      "evidence",
      "assertions",
      "anti_hooks",
    ]) {
      requireCondition(hasTopLevelKey(manifestText, key), `${manifestFile}: missing required key ${key}`);
    }

    requireCondition(
      /^evidence:\n(?:[ \t].*\n)*[ \t]+required:/m.test(manifestText),
      `${manifestFile}: missing required key evidence.required`,
    );

    for (const key of [
      "product_acceptance_logic_added",
      "data_testid_required",
      "hidden_dom_metadata_required",
      "product_autorun_required",
    ]) {
      requireCondition(
        hasNestedFalse(manifestText, "anti_hooks", key),
        `${manifestFile}: anti_hooks.${key} must be false`,
      );
    }

    const manifestId = parseScalar(manifestText, "id");
    if (manifestId && manifestId !== scenario.id) {
      errors.push(`${manifestFile}: id ${manifestId} does not match scenarios.yml id ${scenario.id}`);
    }

    const manifestTier = parseScalar(manifestText, "tier");
    if (manifestTier && manifestTier !== scenario.tier) {
      errors.push(`${manifestFile}: tier ${manifestTier} does not match scenarios.yml tier ${scenario.tier}`);
    }

    const manifestSurface = parseScalar(manifestText, "surface");
    if (manifestSurface && manifestSurface !== scenario.surface) {
      errors.push(`${manifestFile}: surface ${manifestSurface} does not match scenarios.yml surface ${scenario.surface}`);
    }

    const manifestRunner = parseScalar(manifestText, "runner");
    if (manifestRunner && manifestRunner !== runner) {
      errors.push(`${manifestFile}: runner ${manifestRunner} does not match scenarios.yml runner ${runner}`);
    }

    const manifestEntrypoint = parseScalar(manifestText, "entrypoint");
    if (manifestEntrypoint && manifestEntrypoint !== scenario.entrypoint) {
      errors.push(`${manifestFile}: entrypoint does not match scenarios.yml entrypoint`);
    }

    if (runner === "dogfood_run") {
      const manifestDefaultProvider = parseScalar(manifestText, "default_provider");
      if (manifestRunner !== "dogfood_run") {
        errors.push(`${manifestFile}: dogfood scenario must declare runner: dogfood_run`);
      }
      if (manifestDefaultProvider !== "lmstudio") {
        errors.push(`${manifestFile}: dogfood scenario must declare default_provider: lmstudio`);
      }
      if (!/scripts\/dogfood_run\.sh\b/.test(manifestEntrypoint)) {
        errors.push(`${manifestFile}: dogfood entrypoint must route to scripts/dogfood_run.sh`);
      }
    }
  }

  const verifyDir = path.join(projectRoot, "frontend/slice-verify");
  if (fs.existsSync(verifyDir)) {
    const ignored = new Set([
      "external-ui-driver.mjs",
      "native-tauri-verifier.mjs",
      "native-tauri-verifier.test.mjs",
      "TEMPLATE.external-ui-driver.mjs",
    ]);

    for (const fileName of fs.readdirSync(verifyDir)) {
      if (!fileName.endsWith(".mjs")) continue;
      if (ignored.has(fileName)) continue;
      if (fileName.endsWith(".test.mjs")) continue;

      const scenarioId = fileName.replace(/\.mjs$/, "");
      if (!ids.has(scenarioId)) {
        errors.push(`frontend/slice-verify/${fileName}: real browser driver is not registered in quality/acceptance/scenarios.yml`);
      }
    }
  }

  try {
    const output = execFileSync("bash", ["scripts/tauri_slice_verify.sh", "--list"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tauriIds = parseTauriList(output);
    const requiredTauriIds = [
      "p1-chapter-plan-minimum",
      "p1-chapter-draft-generation",
      "au02-candidate-adoption-bridge",
      "au05-adoption-safety-freshness",
      "au03-context-source-ui",
    ];

    for (const id of requiredTauriIds) {
      if (!tauriIds.has(id)) {
        errors.push(`scripts/tauri_slice_verify.sh --list: required scenario missing from implemented list: ${id}`);
      }
      const scenario = byId.get(id);
      if (!scenario) {
        errors.push(`quality/acceptance/scenarios.yml: missing manifest entry for implemented Tauri scenario ${id}`);
      } else if (scenario.surface !== "tauri") {
        errors.push(`quality/acceptance/scenarios.yml: ${id} is implemented by tauri_slice_verify but surface is ${scenario.surface}`);
      }
    }

    for (const id of tauriIds) {
      if (id === "desktop-stage-process-ownership") continue;
      const scenario = byId.get(id);
      if (!scenario) {
        warnings.push(`scripts/tauri_slice_verify.sh --list: ${id} has no quality acceptance manifest`);
      } else if (scenario.surface !== "tauri") {
        errors.push(`quality/acceptance/scenarios.yml: ${id} has surface ${scenario.surface}, expected tauri`);
      }
    }
  } catch (error) {
    errors.push(`failed to inspect scripts/tauri_slice_verify.sh --list: ${error.message}`);
  }

  if (fs.existsSync(ciDocPath)) {
    const ciDoc = fs.readFileSync(ciDocPath, "utf8");
    const releasePlanned = /## Release Candidate[\s\S]*?Status:\s*planned,\s*not yet enforced\./.test(ciDoc);
    const targetOnly = /target commands[\s\S]*?until release-tier scenarios are registered/.test(ciDoc);

    for (const tier of ["release", "release-real-llm"]) {
      const hasTier = scenarios.some((scenario) => scenario.tier === tier);
      if (!hasTier && !(releasePlanned && targetOnly)) {
        errors.push(`quality/gates/ci.md declares ${tier} command as current but scenarios.yml has no ${tier} scenarios`);
      }
    }
  } else {
    errors.push("quality/gates/ci.md is missing");
  }
}

for (const warning of warnings) {
  console.warn(`[quality-manifest-check] WARN ${warning}`);
}

if (errors.length > 0) {
  console.error("[quality-manifest-check] failed");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("[quality-manifest-check] passed");
NODE
