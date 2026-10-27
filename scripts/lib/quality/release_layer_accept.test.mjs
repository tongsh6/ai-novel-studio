// B42 CP1：release / release-real-llm 结果层接入真实消费者（scripts/quality_accept.sh）
// 的集成测试。
//
// 运行：node --test scripts/lib/quality/release_layer_accept.test.mjs
//
// 用 fixture 项目（复制 quality_accept.sh + scripts/lib/quality + 假 runner）验证：
// - `--tier release|release-real-llm` 批次结束后写出 batch 目录内 release-layer.json；
// - 既有批次退出码与既有 tier 行为不变（pass=0 / fail=1 / 全 blocked=69 / 空 tier=65）；
// - 非 release tier 不产生 release-layer.json；
// - 确定性 provider 的 pass 不会被结果层写成真实模型 PASS（release-real-llm + strata
//   的 pass 结果层只能是 evidence_missing/fail）。
// 不进入真实产品驱动；fixture 不进入工作树。

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const RELEASE_LAYER_SCHEMA_VERSION = "quality-release-layer/v1";

function write(root, rel, content, mode) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  if (mode) fs.chmodSync(target, mode);
}

function scenarioEntry(id, { status = "active", blockedReason, tier = "release", surface = "browser" } = {}) {
  const lines = [
    `  - id: ${id}`,
    `    title: "fixture ${id}"`,
    `    tier: ${tier}`,
    `    surface: ${surface}`,
    `    manifest: quality/acceptance/scenarios/${id}.yml`,
    `    driver: frontend/slice-verify/fixture-driver.mjs`,
    `    entrypoint: bash scripts/quality_accept.sh ${id} --surface ${surface}`,
  ];
  if (status === "blocked") {
    lines.push("    status: blocked");
    lines.push(`    blocked_reason: "${blockedReason ?? "fixture blocked"}"`);
  }
  return lines.join("\n");
}

function buildFixture(scenarios) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-layer-accept-"));
  fs.cpSync(path.join(REPO_ROOT, "scripts/quality_accept.sh"), path.join(root, "scripts/quality_accept.sh"));
  fs.cpSync(path.join(REPO_ROOT, "scripts/lib/quality"), path.join(root, "scripts/lib/quality"), {
    recursive: true,
  });
  write(root, "frontend/slice-verify/fixture-driver.mjs", "// fixture driver\n");
  // 假 runner：pass 造 summary；fail 退出 1；missing 退出 0 但不留证据。
  write(
    root,
    "scripts/slice_verify.sh",
    `#!/usr/bin/env bash
set -euo pipefail
id="$1"
root="$(cd "$(dirname "$0")/.." && pwd)"
case "$id" in
  *-fail) echo "[fixture-runner] forced failure for $id" >&2; exit 1 ;;
  *-missing) echo "[fixture-runner] success without evidence for $id"; exit 0 ;;
  *)
    mkdir -p "$root/artifacts/slice-verify/$id"
    printf '{"slice_id":"%s","status":"passed"}\\n' "$id" > "$root/artifacts/slice-verify/$id/summary.json"
    echo "[fixture-runner] pass $id"
    ;;
esac
`,
    0o755,
  );
  const index = ["scenarios:", ...scenarios.map((item) => scenarioEntry(item.id, item))].join("\n");
  write(root, "quality/acceptance/scenarios.yml", `${index}\n`);
  for (const item of scenarios) {
    write(root, `quality/acceptance/scenarios/${item.id}.yml`, `id: ${item.id}\ntitle: "fixture"\n`);
  }
  return root;
}

function runBatch(root, args) {
  return spawnSync("bash", [path.join(root, "scripts/quality_accept.sh"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, QUALITY_ACCEPT_MANIFEST_VERIFIED: "1" },
  });
}

function latestBatchDir(root) {
  const batchRoot = path.join(root, "artifacts/quality-accept/batches");
  if (!fs.existsSync(batchRoot)) return null;
  const entries = fs
    .readdirSync(batchRoot)
    .map((name) => ({ name, stat: fs.statSync(path.join(batchRoot, name)) }))
    .filter((entry) => entry.stat.isDirectory())
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  return entries.length > 0 ? path.join(batchRoot, entries[0].name) : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function releaseLayerOf(batchDir) {
  const file = path.join(batchDir, "release-layer.json");
  assert.ok(fs.existsSync(file), `release-layer.json 缺失：${batchDir}`);
  return readJson(file);
}

test("release tier 批次：写出 release-layer.json，且既有 pass 退出码 0 不变", () => {
  const root = buildFixture([{ id: "rel-alpha-pass", tier: "release" }]);
  const result = runBatch(root, ["--tier", "release"]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /\[quality-accept\] release-layer: /);
  const batchDir = latestBatchDir(root);
  const batch = readJson(path.join(batchDir, "batch.json"));
  assert.equal(batch.schema_version, "quality-batch/v1");
  assert.equal(batch.exit_code, 0);
  assert.ok(fs.existsSync(path.join(batchDir, "release-layer.log")), "release-layer.log 缺失");
  const layer = releaseLayerOf(batchDir);
  assert.equal(layer.schema_version, RELEASE_LAYER_SCHEMA_VERSION);
  assert.equal(layer.tier, "release");
  assert.equal(layer.tier_class, "deterministic");
  assert.equal(layer.separation.single_verdict_allowed, false);
  assert.ok(["pass", "evidence_missing"].includes(layer.status), layer.status);
  if (layer.status === "pass") assert.equal(layer.exit_code, 0);
  // 确定性结果不得出现 model_behavior=pass。
  assert.equal(layer.layers.model_behavior.pass, 0);
});

test("release tier 批次含失败场景：批次退出码仍为 1，结果层不得 PASS", () => {
  const root = buildFixture([
    { id: "rel-alpha-pass", tier: "release" },
    { id: "rel-alpha-fail", tier: "release" },
  ]);
  const result = runBatch(root, ["--tier", "release"]);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const batchDir = latestBatchDir(root);
  const batch = readJson(path.join(batchDir, "batch.json"));
  assert.equal(batch.exit_code, 1);
  const layer = releaseLayerOf(batchDir);
  assert.notEqual(layer.status, "pass");
  assert.ok(layer.reason_codes.includes("batch_failure") || layer.counts.fail > 0);
});

test("release-real-llm + 默认确定性 provider：批次退出码不变，结果层不得 PASS（tier 归属不匹配）", () => {
  const root = buildFixture([{ id: "rel-real-pass", tier: "release-real-llm" }]);
  const result = runBatch(root, ["--tier", "release-real-llm"]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const batchDir = latestBatchDir(root);
  const batch = readJson(path.join(batchDir, "batch.json"));
  assert.equal(batch.exit_code, 0);
  const layer = releaseLayerOf(batchDir);
  assert.equal(layer.tier, "release-real-llm");
  assert.equal(layer.tier_class, "real_model");
  assert.notEqual(layer.status, "pass");
  assert.ok(layer.reason_codes.includes("tier_provider_class_mismatch"));
});

test("K5：真实 provider passthrough（runner 成功但无模型行为证据）→ 单场景 exit 67，不写 PASS verdict", () => {
  const root = buildFixture([{ id: "rel-real-pass", tier: "release-real-llm" }]);
  const result = runBatch(root, ["rel-real-pass", "--provider", "strata"]);
  assert.equal(result.status, 67, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /evidence_missing（真实 provider pass 缺 B42 模型行为证据/);
  assert.doesNotMatch(result.stdout, /\[quality-accept\] passed: rel-real-pass/);
  const artifactDir = path.join(root, "artifacts/slice-verify/rel-real-pass");
  assert.equal(fs.existsSync(path.join(artifactDir, "verdict.json")), false);
});

test("K5：release-real-llm + 真实 provider 批次 → 记 evidence_missing（exit 67），不计 batch PASS，结果层非 PASS", () => {
  const root = buildFixture([{ id: "rel-real-pass", tier: "release-real-llm" }]);
  const result = runBatch(root, ["--tier", "release-real-llm", "--provider", "strata"]);
  assert.equal(result.status, 67, `${result.stdout}\n${result.stderr}`);
  const batchDir = latestBatchDir(root);
  const batch = readJson(path.join(batchDir, "batch.json"));
  assert.equal(batch.exit_code, 67);
  assert.equal(batch.counts.pass, 0);
  assert.equal(batch.counts.evidence_missing, 1);
  const layer = releaseLayerOf(batchDir);
  assert.notEqual(layer.status, "pass");
  assert.equal(layer.layers.model_behavior.pass, 0);
});

test("既有确定性 provider 路径退出码不变：单场景 0 / usage 64 / blocked 65 / evidence_missing 67", () => {
  const root = buildFixture([
    { id: "det-pass", tier: "release" },
    { id: "det-missing", tier: "release" },
    { id: "det-blocked", tier: "release", status: "blocked", blockedReason: "fixture blocked" },
  ]);
  assert.equal(runBatch(root, ["det-pass"]).status, 0);
  assert.equal(runBatch(root, []).status, 64);
  assert.equal(runBatch(root, ["det-blocked"]).status, 65);
  assert.equal(runBatch(root, ["det-missing"]).status, 67);
});

test("release tier 全 blocked 批次：批次退出码 69 不变，结果层写 blocked/skipped 而非 PASS", () => {
  const root = buildFixture([
    { id: "rel-alpha-blocked", tier: "release", status: "blocked", blockedReason: "fixture blocked" },
  ]);
  const result = runBatch(root, ["--tier", "release"]);
  assert.equal(result.status, 69, `${result.stdout}\n${result.stderr}`);
  const batchDir = latestBatchDir(root);
  const layer = releaseLayerOf(batchDir);
  assert.notEqual(layer.status, "pass");
  assert.equal(layer.counts.skipped, 1);
  assert.ok(layer.reason_codes.includes("blocked_scenarios_present"));
});

test("非 release tier（nightly）不产生 release-layer.json，既有行为不变", () => {
  const root = buildFixture([{ id: "nightly-alpha-pass", tier: "nightly" }]);
  const result = runBatch(root, ["--tier", "nightly"]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const batchDir = latestBatchDir(root);
  assert.ok(fs.existsSync(path.join(batchDir, "batch.json")));
  assert.equal(fs.existsSync(path.join(batchDir, "release-layer.json")), false);
  assert.doesNotMatch(result.stderr, /release-layer: /);
});

test("空 release tier：保持既有 exit 65 与 no scenarios 行为，不生成批次/结果层", () => {
  const root = buildFixture([{ id: "nightly-alpha-pass", tier: "nightly" }]);
  const result = runBatch(root, ["--tier", "release"]);
  assert.equal(result.status, 65);
  assert.match(result.stderr, /No scenarios found for tier=release/);
  assert.equal(latestBatchDir(root), null);
});
