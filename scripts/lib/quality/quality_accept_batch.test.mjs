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
import { openTestRunScope } from "../test_env.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

function mkFixtureRoot() {
  // macOS /var 是符号链接；复制的 Node CLI 路径须与模块 URL 使用同一物理路径。
  return fs.realpathSync(fs.mkdtempSync(path.join(runScope.workDir, "quality-accept-batch-")));
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

function scenarioEntry(
  id,
  { status = "active", blockedReason, tier = "nightly", surface = "browser", entrypoint } = {},
) {
  const lines = [
    `  - id: ${id}`,
    `    title: "fixture ${id}"`,
    `    tier: ${tier}`,
    `    surface: ${surface}`,
    `    manifest: quality/acceptance/scenarios/${id}.yml`,
    `    driver: frontend/slice-verify/fixture-driver.mjs`,
    `    entrypoint: ${entrypoint ?? `bash scripts/quality_accept.sh ${id} --surface ${surface}`}`,
  ];
  if (status === "blocked") {
    lines.push("    status: blocked");
    lines.push(`    blocked_reason: "${blockedReason ?? "fixture blocked"}"`);
  }
  return lines.join("\n");
}

function buildFixture(scenarios, { skipped = false, nativeBatch = false } = {}) {
  const root = mkFixtureRoot();
  copyTree(root, "scripts/quality_accept.sh");
  for (const file of ["test_env.sh", "test_env.mjs", "process_tree.sh"]) {
    copyTree(root, `scripts/lib/${file}`);
  }
  const specs = Object.fromEntries(
    scenarios
      .filter((item) => item.mode)
      .map((item) => [
        item.id,
        {
          mode: item.mode,
          slice_id: item.id,
          seed_script: "scripts/fixture_mission_seed.exs",
          budget: {
            scenario_seconds: item.scenarioSeconds ?? 30,
            input_timeout_ms: item.inputTimeoutMs ?? 120_000,
            turn_timeout_ms: item.turnTimeoutMs ?? 360_000,
          },
        },
      ]),
  );
  write(
    root,
    "scripts/lib/native_ui/authoring_capture_evidence.mjs",
    `const specs = ${JSON.stringify(specs)};\nexport const authorVisibleScenarioSpec = (id) => specs[id] ?? null;\n`,
  );
  write(
    root,
    "native-fixture.json",
    JSON.stringify(Object.fromEntries(scenarios.map((item) => [item.id, item]))),
  );
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
  *-native)
    mkdir -p "$root/artifacts/slice-verify/$id"
    printf '{"slice_id":"%s","status":"passed","surface":"tauri","driver":"ax-native-system-ui"}\\n' "$id" > "$root/artifacts/slice-verify/$id/summary.json"
    echo "[fixture-runner] pass $id"
    ;;
  *)
    mkdir -p "$root/artifacts/slice-verify/$id"
    printf '{"slice_id":"%s","status":"passed"}\\n' "$id" > "$root/artifacts/slice-verify/$id/summary.json"
    echo "[fixture-runner] pass $id"
    ;;
esac
`,
    0o755,
  );

  // 只替换外部执行端；quality_accept 的路由、owned scope、预算和 verdict 均走真实入口。
  write(
    root,
    "scripts/native_b71_batch.sh",
    `#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
node --input-type=module - "$root" "$@" <<'NODE'
import fs from "node:fs";
import path from "node:path";
const [root, ...argv] = process.argv.slice(2);
const id = process.env.B71_SLICE;
const config = JSON.parse(fs.readFileSync(path.join(root, "native-fixture.json"), "utf8"))[id];
fs.writeFileSync(path.join(root, "native-invocation.json"), JSON.stringify({
  argv, slice: id, provider: process.env.B71_PROVIDER,
  run_dir: process.env.NOVEL_TEST_RUN_DIR, tmpdir: process.env.TMPDIR,
}), { flag: "wx" });
if (config.nativeExit === 64) process.exit(64);
if (config.nativeDelayMs) await new Promise((resolve) => setTimeout(resolve, config.nativeDelayMs));
const dir = path.join(root, "artifacts/slice-verify", "actual-native-" + id);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({
  slice_id: id, status: config.nativeExit ? "failed" : "passed",
  surface: "tauri", driver: "ax-native-system-ui",
}));
if (config.nativeReceipt !== false) {
  console.log("[b71-native] " + (config.nativeExit ? "FAIL driver_rc=1 runner_rc=0" : "PASS") + " dir=" + dir);
}
process.exit(config.nativeExit ?? 0);
NODE
`,
    0o755,
  );
  write(
    root,
    "scripts/tauri_slice_verify.sh",
    `#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
node --input-type=module - "$root" "$@" <<'NODE'
import fs from "node:fs";
import path from "node:path";
const [root, ...argv] = process.argv.slice(2);
const id = argv.at(-1);
const native = process.env.TAURI_NATIVE_SYSTEM_DRIVER === "1";
const provider = argv[0] === "--provider" ? argv[1] : process.env.SLICE_VERIFY_PROVIDER;
fs.writeFileSync(path.join(root, "tauri-invocation.json"), JSON.stringify(argv), { flag: "wx" });
const dir = native ? process.env.TAURI_NATIVE_ARTIFACT_DIR :
  path.join(root, "artifacts/slice-verify", id + "-tauri");
fs.writeFileSync(path.join(root, "tauri-environment.json"), JSON.stringify({
  native, provider, dir, seed: process.env.TAURI_NATIVE_SEED_SCRIPT,
  input_timeout_ms: process.env.B71_LIVE_INPUT_TIMEOUT_MS,
  turn_timeout_ms: process.env.B71_LIVE_TURN_TIMEOUT_MS,
  correction: process.env.SLICE_VERIFY_MISSION_CORRECTION,
  run_dir: process.env.NOVEL_TEST_RUN_DIR,
}), { flag: "wx" });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({
  slice_id: id, status: "passed", surface: "tauri", driver: "ax-native-system-ui",
}));
if (native) {
  fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({ slice_id: id, provider }));
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(path.join(dir, "fixture-driver-finished.json"))) {
    if (Date.now() >= deadline) throw new Error("fixture native driver did not finish");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
NODE
`,
    0o755,
  );
  if (nativeBatch) {
    copyTree(root, "scripts/native_b71_batch.sh");
    write(root, "scripts/fixture_mission_seed.exs", "# Fixture seed must never execute.\n");
    write(
      root,
      "scripts/native_b71_live_drive.mjs",
      `
import fs from "node:fs";
import path from "node:path";
fs.writeFileSync(path.join(process.argv[2], "fixture-driver-finished.json"), JSON.stringify({
  provider: process.env.SLICE_VERIFY_PROVIDER,
  seed: process.env.TAURI_NATIVE_SEED_SCRIPT,
  input_timeout_ms: process.env.B71_LIVE_INPUT_TIMEOUT_MS,
  turn_timeout_ms: process.env.B71_LIVE_TURN_TIMEOUT_MS,
  run_dir: process.env.NOVEL_TEST_RUN_DIR,
}), { flag: "wx" });
`,
    );
  }

  const index = ["scenarios:", ...scenarios.map((item) => scenarioEntry(item.id, item))].join("\n");
  write(root, "quality/acceptance/scenarios.yml", `${index}\n`);
  for (const item of scenarios) {
    write(root, `quality/acceptance/scenarios/${item.id}.yml`, `id: ${item.id}\ntitle: "fixture"\n`);
  }
  assert.ok(!skipped || true);
  return root;
}

function runBatch(root, args, env = {}) {
  return spawnSync("bash", [path.join(root, "scripts/quality_accept.sh"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: runScope.env({ ...process.env, ...env, QUALITY_ACCEPT_MANIFEST_VERIFIED: "1" }),
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

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

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

test("单场景：verdict.surface/driver 取证据 summary 的实际驱动面（native 不写回 browser）", () => {
  const root = buildFixture([{ id: "alpha-native" }]);
  const result = runBatch(root, ["alpha-native"]);
  assert.equal(result.status, 0, result.stderr);
  const verdictPath = path.join(root, "artifacts/slice-verify/alpha-native/verdict.json");
  assert.ok(fs.existsSync(verdictPath), "verdict.json missing");
  const verdict = JSON.parse(fs.readFileSync(verdictPath, "utf8"));
  // fixture scenario 的 registry surface=browser，但本次证据 summary 声明 tauri + 原生驱动：
  // verdict 必须如实记录证据驱动面，而不是照抄 registry 字段。
  assert.equal(verdict.surface, "tauri");
  assert.equal(verdict.driver, "ax-native-system-ui");
});

test("使命登记透明委派原生批次，保留 scope、合法 tag 与实际动态证据目录", () => {
  const id = "fixture-new-mission";
  const root = buildFixture([
    {
      id,
      mode: "mission",
      surface: "tauri",
      entrypoint: "touch SHOULD_NOT_RUN",
    },
  ]);
  const result = runBatch(root, [id, "--provider", "slice_verify"]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const invocation = JSON.parse(fs.readFileSync(path.join(root, "native-invocation.json"), "utf8"));
  assert.equal(invocation.slice, id);
  assert.equal(invocation.provider, "slice_verify");
  assert.equal(invocation.argv.length, 1);
  assert.match(invocation.argv[0], /^[a-z0-9-]{1,32}$/u);
  assert.equal(invocation.run_dir, runScope.dir);
  assert.equal(invocation.tmpdir, runScope.tmpDir);
  assert.equal(fs.existsSync(path.join(root, "tauri-invocation.json")), false);
  assert.equal(fs.existsSync(path.join(root, "SHOULD_NOT_RUN")), false);
  const actualDir = path.join(root, "artifacts/slice-verify", `actual-native-${id}`);
  const verdict = JSON.parse(fs.readFileSync(path.join(actualDir, "verdict.json"), "utf8"));
  assert.equal(verdict.surface, "tauri");
  assert.equal(verdict.driver, "ax-native-system-ui");
  assert.ok(result.stdout.includes(`[quality-accept] artifacts: ${actualDir}`));
  assert.equal(fs.existsSync(path.join(root, "artifacts/slice-verify", `${id}-tauri`)), false);
});

test("非使命登记保持现 tauri 入口，不误转原生使命批次", () => {
  const id = "fixture-other-native";
  const root = buildFixture([{ id, mode: "continuation", surface: "tauri" }]);
  const result = runBatch(root, [id]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "tauri-invocation.json"), "utf8")), [
    "--provider",
    "slice_verify",
    id,
  ]);
  assert.equal(fs.existsSync(path.join(root, "native-invocation.json")), false);
});

for (const [suffix, config, expectedExit] of [
  ["no-receipt", { nativeReceipt: false }, 67],
  ["config-failed", { nativeExit: 64 }, 64],
  ["runner-failed", { nativeExit: 1 }, 1],
]) {
  test(`使命原生批次 ${suffix} 不得记 PASS 或回退旧入口`, () => {
    const id = `fixture-mission-${suffix}`;
    const root = buildFixture([{ id, mode: "mission", surface: "tauri", ...config }]);
    const result = runBatch(root, [id]);
    assert.equal(result.status, expectedExit, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(root, "tauri-invocation.json")), false);
    assert.equal(fs.existsSync(path.join(root, "artifacts/slice-verify", `${id}-tauri`)), false);
    assert.doesNotMatch(result.stdout, /\[quality-accept\] passed:/u);
    if (config.nativeReceipt === false) {
      const actualDir = path.join(root, "artifacts/slice-verify", `actual-native-${id}`);
      assert.ok(fs.existsSync(path.join(actualDir, "summary.json")));
      assert.equal(fs.existsSync(path.join(actualDir, "verdict.json")), false);
    }
  });
}

test("使命原生批次使用登记的墙钟预算并透传超时退出码", () => {
  const id = "fixture-mission-deadline";
  const root = buildFixture([
    {
      id,
      mode: "mission",
      surface: "tauri",
      scenarioSeconds: 1,
      nativeDelayMs: 10_000,
    },
  ]);
  const result = runBatch(root, [id]);
  assert.equal(result.status, 124, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(path.join(root, "native-invocation.json")), true);
  assert.equal(fs.existsSync(path.join(root, "tauri-invocation.json")), false);
});

test("使命登记缺少有效预算或指定 browser 时在调用前拒绝", () => {
  for (const [scenarioSeconds, args] of [
    [0, []],
    [30, ["--surface", "browser"]],
  ]) {
    const id = "fixture-mission-config";
    const root = buildFixture([{ id, mode: "mission", surface: "tauri", scenarioSeconds }]);
    const result = runBatch(root, [id, ...args]);
    assert.equal(result.status, 64, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(root, "native-invocation.json")), false);
    assert.equal(fs.existsSync(path.join(root, "tauri-invocation.json")), false);
  }
});

test("真实原生批次透传指定 tag，并绑定 provider/dir、seed 与子预算到两个执行端", () => {
  const id = "fixture-owned-mission";
  const root = buildFixture(
    [
      {
        id,
        mode: "mission",
        surface: "tauri",
        inputTimeoutMs: 1_500,
        turnTimeoutMs: 2_500,
      },
    ],
    { nativeBatch: true },
  );
  const staleDir = path.join(root, "stale-native-dir");
  const seed = "scripts/fixture_mission_seed.exs";
  const tag = "r06-mission-fixture";
  const result = runBatch(root, [id, "--provider", "slice_verify"], {
    SLICE_VERIFY_PROVIDER: "splash",
    TAURI_NATIVE_ARTIFACT_DIR: staleDir,
    TAURI_NATIVE_ARTIFACT_TAG: tag,
    TAURI_NATIVE_SEED_SCRIPT: path.join(root, seed),
    B71_LIVE_INPUT_TIMEOUT_MS: "",
    B71_LIVE_TURN_TIMEOUT_MS: "",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const runner = JSON.parse(fs.readFileSync(path.join(root, "tauri-environment.json"), "utf8"));
  assert.equal(runner.native, true);
  assert.equal(runner.provider, "slice_verify");
  assert.equal(runner.seed, seed);
  assert.equal(runner.correction, "reject_then_valid");
  assert.equal(runner.input_timeout_ms, "1500");
  assert.equal(runner.turn_timeout_ms, "2500");
  assert.equal(runner.run_dir, runScope.dir);
  assert.equal(path.dirname(runner.dir), path.join(root, "artifacts/slice-verify"));
  assert.equal(runner.dir, path.join(root, "artifacts/slice-verify", `${id}-tauri-native-${tag}`));
  assert.notEqual(runner.dir, staleDir);
  assert.equal(fs.existsSync(staleDir), false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(runner.dir, "fixture-driver-finished.json"), "utf8")),
    {
      provider: "slice_verify",
      seed,
      input_timeout_ms: "1500",
      turn_timeout_ms: "2500",
      run_dir: runScope.dir,
    },
  );
  assert.ok(fs.existsSync(path.join(runner.dir, "verdict.json")));
});

for (const [env, reason] of [
  [{ TAURI_NATIVE_SEED_SCRIPT: "scripts/unregistered_seed.exs" }, "使命 seed 路径与登记场景不一致"],
  [{ B71_LIVE_INPUT_TIMEOUT_MS: "999" }, "使命等待预算与登记场景不一致"],
  [{ B71_LIVE_TURN_TIMEOUT_MS: "999" }, "使命等待预算与登记场景不一致"],
]) {
  test(`真实使命批次在执行端启动前拒绝矛盾 ${Object.keys(env)[0]}`, () => {
    const id = "fixture-owned-mission-conflict";
    const root = buildFixture([{ id, mode: "mission", surface: "tauri" }], { nativeBatch: true });
    const result = runBatch(root, [id, "--provider", "slice_verify"], {
      TAURI_NATIVE_SEED_SCRIPT: "",
      B71_LIVE_INPUT_TIMEOUT_MS: "",
      B71_LIVE_TURN_TIMEOUT_MS: "",
      ...env,
    });
    assert.equal(result.status, 64, `${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes(reason), result.stdout);
    assert.equal(fs.existsSync(path.join(root, "tauri-invocation.json")), false);
    assert.equal(fs.existsSync(path.join(root, "native-invocation.json")), false);
    assert.doesNotMatch(result.stdout, /\[quality-accept\] passed:/u);
  });
}


for (const [name, tag] of [
  ["empty", ""],
  ["invalid", "Bad_Tag"],
  ["too-long", "a".repeat(33)],
]) {
  test(`指定 ${name} 原生 tag 由真实 batch 在 runner 启动前拒绝`, () => {
    const id = "fixture-mission-tag";
    const root = buildFixture([{ id, mode: "mission", surface: "tauri" }], { nativeBatch: true });
    const result = runBatch(root, [id, "--provider", "slice_verify"], {
      TAURI_NATIVE_ARTIFACT_TAG: tag,
    });
    assert.equal(result.status, 64, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /lowercase-tag-at-most-32-chars/u);
    assert.equal(fs.existsSync(path.join(root, "tauri-invocation.json")), false);
    assert.equal(fs.existsSync(path.join(root, "native-invocation.json")), false);
    assert.doesNotMatch(result.stdout, /\[quality-accept\] passed:/u);
  });
}

test("空 tier 返回 65 并说明无场景", () => {
  const root = buildFixture([{ id: "alpha-pass" }]);
  const result = runBatch(root, ["--tier", "release"]);
  assert.equal(result.status, 65);
  assert.match(result.stderr, /No scenarios found for tier=release/);
});
