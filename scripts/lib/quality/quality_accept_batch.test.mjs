// B41 CP2：quality_accept.sh 批量状态分层与退出码的集成测试。
// 运行：node --test scripts/lib/quality/quality_accept_batch.test.mjs
//
// 用 fixture 项目（复制 quality_accept.sh + scripts/lib/quality + 假 runner）验证：
// - blocked=skipped+reason 且不中止整批；
// - pass/fail/evidence_missing/skipped/not_run 分开统计；
// - 退出码矩阵（fail 优先 1、无执行 69、单场景 blocked 65、空 tier 65）；
// - batch.json 落盘且与结果一致。
// 不跑真实 Tauri/产品 driver；fixture 不进入工作树。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "quality-accept-batch-"));
}

function write(root, rel, content, mode) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  if (mode) fs.chmodSync(target, mode);
}

function copyTree(root, rel) {
  fs.cpSync(path.join(REPO_ROOT, rel), path.join(root, rel), { recursive: true });
}

function scenarioEntry(id, { status = "active", blockedReason, tier = "nightly" } = {}) {
  const lines = [
    `  - id: ${id}`,
    `    title: "fixture ${id}"`,
    `    tier: ${tier}`,
    `    surface: browser`,
    `    manifest: quality/acceptance/scenarios/${id}.yml`,
    `    driver: frontend/slice-verify/fixture-driver.mjs`,
    `    entrypoint: bash scripts/quality_accept.sh ${id} --surface browser`,
  ];
  if (status === "blocked") {
    lines.push("    status: blocked");
    lines.push(`    blocked_reason: "${blockedReason ?? "fixture blocked"}"`);
  }
  return lines.join("\n");
}

function buildFixture(scenarios, { skipped = false } = {}) {
  const root = mkFixtureRoot();
  copyTree(root, "scripts/quality_accept.sh");
  // quality_accept.sh 通过 PROJECT_ROOT 解析 scripts/lib；复制解析器与校验模块。
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
  assert.ok(!skipped || true);
  return root;
}

function runBatch(root, args) {
  return spawnSync("bash", [path.join(root, "scripts/quality_accept.sh"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, QUALITY_ACCEPT_MANIFEST_VERIFIED: "1" },
  });
}

function readLatestBatch(root) {
  const dir = path.join(root, "artifacts/quality-accept/batches");
  assert.ok(fs.existsSync(dir), "batch dir missing");
  const entries = fs
    .readdirSync(dir)
    .map((name) => ({ name, stat: fs.statSync(path.join(dir, name)) }))
    .filter((entry) => entry.stat.isDirectory())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  assert.ok(entries.length > 0, "no batch run");
  return JSON.parse(fs.readFileSync(path.join(dir, entries[0].name, "batch.json"), "utf8"));
}

test("批量：pass/fail/skipped(blocked)/evidence_missing 分层 + fail 优先退出 1", () => {
  const root = buildFixture([
    { id: "alpha-pass" },
    { id: "alpha-fail" },
    { id: "alpha-missing" },
    { id: "alpha-blocked", status: "blocked", blockedReason: "fixture blocked for batch" },
  ]);
  const result = runBatch(root, ["--tier", "nightly"]);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const batch = readLatestBatch(root);
  assert.equal(batch.exit_code, 1);
  assert.deepEqual(batch.counts, { pass: 1, fail: 1, skipped: 1, evidence_missing: 1, not_run: 0 });
  const byId = Object.fromEntries(batch.scenarios.map((row) => [row.scenario_id, row]));
  assert.equal(byId["alpha-pass"].status, "pass");
  assert.equal(byId["alpha-fail"].status, "fail");
  assert.equal(byId["alpha-missing"].status, "evidence_missing");
  assert.equal(byId["alpha-blocked"].status, "skipped");
  assert.match(byId["alpha-blocked"].reason, /blocked/);
  assert.ok(fs.existsSync(path.join(root, "artifacts/quality-accept/batches", batch.batch_id, "logs")), "logs dir missing");
});

test("批量：全部 active 通过退出 0；blocked 只记 skipped 且不中止整批", () => {
  const root = buildFixture([
    { id: "alpha-pass" },
    { id: "beta-pass" },
    { id: "alpha-blocked", status: "blocked" },
  ]);
  const result = runBatch(root, ["--tier", "nightly"]);
  assert.equal(result.status, 0, result.stderr);
  const batch = readLatestBatch(root);
  assert.deepEqual(batch.counts, { pass: 2, fail: 0, skipped: 1, evidence_missing: 0, not_run: 0 });
  assert.equal(batch.exit_code, 0);
  // blocked 必须出现在结果里（不能悄悄消失，也不能计 pass）
  assert.ok(batch.scenarios.some((row) => row.scenario_id === "alpha-blocked" && row.status === "skipped"));
});

test("批量：没有任何场景实际执行时退出 69（不得因 skipped 变 PASS）", () => {
  const root = buildFixture([{ id: "alpha-blocked", status: "blocked" }]);
  const result = runBatch(root, ["--tier", "nightly"]);
  assert.equal(result.status, 69, result.stderr);
  const batch = readLatestBatch(root);
  assert.deepEqual(batch.counts, { pass: 0, fail: 0, skipped: 1, evidence_missing: 0, not_run: 0 });
  assert.equal(batch.exit_code, 69);
});

test("单场景：blocked 返回专用退出码 65 且给出 reason", () => {
  const root = buildFixture([{ id: "alpha-blocked", status: "blocked", blockedReason: "because blocked" }]);
  const result = runBatch(root, ["alpha-blocked"]);
  assert.equal(result.status, 65);
  assert.match(result.stderr, /blocked scenario: alpha-blocked/);
  assert.match(result.stderr, /because blocked/);
});

test("空 tier 返回 65 并说明无场景", () => {
  const root = buildFixture([{ id: "alpha-pass" }]);
  const result = runBatch(root, ["--tier", "release"]);
  assert.equal(result.status, 65);
  assert.match(result.stderr, /No scenarios found for tier=release/);
});
