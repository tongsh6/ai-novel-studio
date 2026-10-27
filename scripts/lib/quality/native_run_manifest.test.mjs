// B42 CP3：原生证据发现（quality-native-run/v1）的扫描/判定测试。
// 运行：node --test scripts/lib/quality/native_run_manifest.test.mjs
//
// 真实验证资产（存在才跑；artifacts/ 已 gitignore，CI 缺失时跳过）：
// - artifacts/slice-verify/p1-chapter-draft-generation-native（pass，scoped）
// - artifacts/slice-verify/b28-native-20261025-a1（final+failure 并存 → fail）
// - artifacts/slice-verify/b28-format-native-20261026-r3（TERM 143 → fail）
// - artifacts/slice-verify/b29-existing-character-role-revision-native（pass，full）
// - artifacts/slice-verify/b29-existing-character-role-revision-native-strata（failure → fail）
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  NATIVE_RUN_SCHEMA_VERSION,
  NATIVE_RUN_STATUSES,
  SCOPE_CLASSES,
  evaluateNativeRun,
  scanNativeArtifactDir,
  validateNativeRunManifest,
  writeNativeRunManifest,
} from "./native_run_manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const SLICE_VERIFY = path.join(REPO_ROOT, "artifacts/slice-verify");
const schema = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "quality/acceptance/evidence-schema.json"), "utf8"),
);
const NATIVE_SCHEMA = schema.$defs.native_run_manifest;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

/**
 * 合成一个最小原生 artifact 目录，验证扫描器语义（不进入工作树、不冒充真实运行）。
 */
function makeNativeFixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-run-manifest-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = path.join(dir, "run");
  fs.mkdirSync(run, { recursive: true });
  const summary =
    overrides.summary === undefined
      ? {
          slice_id: "fixture-native-scenario",
          surface: "tauri",
          driver: "ax-native-system-ui",
          provider: "slice_verify",
          model: "iq3_s",
          scope: "full_deterministic_matrix",
          verified_at: "2026-10-27T10:00:00.000Z",
          checks_passed: 3,
          checks_total: 3,
          all_checks_passed: true,
          failed_checks: [],
          trials: ["T1"],
          run_ref: "run-fixture",
        }
      : overrides.summary;
  if (summary !== null) writeJson(path.join(run, "summary.json"), summary);
  if (overrides.final !== null) {
    writeJson(
      path.join(run, "final.json"),
      overrides.final ?? {
        at: "2026-10-27T10:05:00.000Z",
        checkpoint: "final",
        facts: { work_id: "work-fixture" },
      },
    );
  }
  if (overrides.failure) {
    writeJson(path.join(run, "failure.json"), overrides.failure);
  }
  writeJson(
    path.join(dir, "termination.json"),
    overrides.termination ?? {
      at: "2026-10-27T10:06:00.000Z",
      signal: "EXIT",
      exit_code: 0,
      pid: 1,
    },
  );
  writeJson(
    path.join(dir, "detached-meta.json"),
    overrides.detachedMeta ?? {
      started_at: "2026-10-27T10:00:00.000Z",
      head: "1ce14d5b",
      source_hashes: { "scripts/dogfood_run_detached.sh": "a" },
    },
  );
  const checks = overrides.checks ?? { native_ui_complete_bound_to_run: true, no_acceptance_hooks_added: true, production_sources_unchanged: true };
  if (checks !== null) {
    writeJson(path.join(run, "fixture-native-checks.json"), { checks });
  }
  if (overrides.nativeEvidence !== undefined) {
    writeJson(path.join(run, "native-evidence.json"), overrides.nativeEvidence);
  }
  if (overrides.productionSources !== null) {
    writeJson(
      path.join(run, "production-sources-before.json"),
      overrides.productionSources ?? {
        "apps/novel_agent/lib/novel_agent.ex": "hash-a",
        "apps/novel_application/lib/novel_application/x.ex": "hash-b",
      },
    );
  }
  if (overrides.transport !== null) {
    writeJsonl(path.join(run, "native-transport.jsonl"), [
      { at: "2026-10-27T10:00:01.000Z", direction: "http", method: "GET", path: "/health", status: 200 },
      {
        at: "2026-10-27T10:00:02.000Z",
        direction: "received",
        frame: [null, null, "workspace:x", "turn_result", { status: "conversational" }],
      },
      { at: "2026-10-27T10:00:03.000Z", direction: "http", method: "POST", path: "/api/fail", status: 500 },
    ]);
  }
  for (const [name, content] of Object.entries(overrides.textFiles ?? {})) {
    fs.writeFileSync(path.join(run, name), content);
  }
  if (overrides.db !== null) {
    fs.mkdirSync(path.join(run, "database"), { recursive: true });
    fs.writeFileSync(path.join(run, "database", "fixture.sqlite3"), "sqlite-fixture");
  }
  return dir;
}

// ---------- schema / 常量同源 ----------

test("schema $defs 与模块常量同源（quality-native-run/v1）", () => {
  assert.equal(NATIVE_SCHEMA.properties.schema_version.const, NATIVE_RUN_SCHEMA_VERSION);
  assert.deepEqual(
    [...NATIVE_SCHEMA.properties.status.enum].sort(),
    [...NATIVE_RUN_STATUSES].sort(),
  );
  assert.deepEqual(
    [...NATIVE_SCHEMA.properties.scoped.properties.scope_class.enum].sort(),
    [...SCOPE_CLASSES].sort(),
  );
  for (const key of ["run", "final", "failure", "scoped", "checks", "termination", "native_transport", "ax", "db_snapshot", "production_fingerprint"]) {
    assert.ok(NATIVE_SCHEMA.required.includes(key), `schema 必须要求 ${key}`);
  }
});

// ---------- 合成 fixture：判定语义 ----------

test("干净 run（summary all pass + final + EXIT 0 + full scope）→ pass full_scope", (t) => {
  const dir = makeNativeFixture(t);
  const manifest = scanNativeArtifactDir(dir);
  assert.deepEqual(validateNativeRunManifest(manifest), []);
  assert.equal(manifest.status, "pass");
  assert.equal(manifest.pass_scope, "full_scope");
  assert.equal(manifest.full_matrix_established, true);
  assert.equal(manifest.run.driver, "ax-native-system-ui");
  assert.equal(manifest.run.driver_is_native, true);
  assert.equal(manifest.run.provider, "slice_verify");
  assert.equal(manifest.run.provider_class, "deterministic");
  assert.equal(manifest.final.found, true);
  assert.equal(manifest.failure.found, false);
});

test("final 与 failure 并存：只看 final 写 PASS 被禁止（failure 胜出）", (t) => {
  const dir = makeNativeFixture(t, {
    summary: { slice_id: "fixture", driver: "ax-native-system-ui", provider: "strata", scope: "full", all_checks_passed: true, failed_checks: [] },
    failure: { at: "2026-10-27T10:04:00.000Z", phase: "fixture", reason: "fixture_failure" },
  });
  const manifest = scanNativeArtifactDir(dir);
  assert.equal(manifest.final.found, true);
  assert.equal(manifest.failure.found, true);
  assert.equal(manifest.status, "fail");
  assert.ok(manifest.reason_codes.includes("failure_present"));
  assert.ok(manifest.reason_codes.includes("final_failure_coexist"));
  assert.equal(manifest.pass_scope, null);
});

test("termination 非 0/非 EXIT → fail（被 TERM 的 run 不是通过）", (t) => {
  const dir = makeNativeFixture(t, {
    termination: { at: "2026-10-27T10:06:00.000Z", signal: "TERM", exit_code: 143, pid: 1 },
  });
  const manifest = scanNativeArtifactDir(dir);
  assert.equal(manifest.status, "fail");
  assert.ok(manifest.reason_codes.includes("termination_not_clean"));
});

test("缺少 final 与 failure → evidence_missing（summary 存在也不等于 PASS）", (t) => {
  const dir = makeNativeFixture(t, { final: null, failure: null });
  const manifest = scanNativeArtifactDir(dir);
  assert.equal(manifest.status, "evidence_missing");
  assert.ok(manifest.reason_codes.includes("final_missing"));
});

test("目录没有任何 run 证据 → evidence_missing run_evidence_missing", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-run-empty-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = scanNativeArtifactDir(dir);
  assert.equal(manifest.status, "evidence_missing");
  assert.ok(manifest.reason_codes.includes("run_evidence_missing"));
});

test("native checks 失败 → fail checks_failed（不得只看 summary 的 checks_passed 字段）", (t) => {
  const dir = makeNativeFixture(t, {
    checks: { native_ui_complete_bound_to_run: false, production_sources_unchanged: true },
  });
  const manifest = scanNativeArtifactDir(dir);
  assert.equal(manifest.status, "fail");
  assert.ok(manifest.reason_codes.includes("checks_failed"));
  assert.ok(manifest.reason_codes.includes("native_check_failed:native_ui_complete_bound_to_run"));
});

test("run identity 跨来源冲突 → fail identity_conflict", (t) => {
  const dir = makeNativeFixture(t, {
    nativeEvidence: { provider: "lmstudio", driver: "ax-native-system-ui", model: "other" },
  });
  const manifest = scanNativeArtifactDir(dir);
  assert.equal(manifest.status, "fail");
  assert.ok(manifest.reason_codes.some((code) => code.startsWith("identity_conflict:provider")));
});

test("scoped scope → pass 但 pass_scope=scoped_scope_only 且 full_matrix_established=false", (t) => {
  const dir = makeNativeFixture(t, {
    summary: {
      slice_id: "fixture-scoped",
      driver: "ax-native-system-ui",
      provider: "strata",
      model: "iq3_s",
      scope: "scoped_native_creation",
      all_checks_passed: true,
      failed_checks: [],
      limitations: ["scoped 四项能力证据，不重跑 canonical 全矩阵"],
    },
  });
  const manifest = scanNativeArtifactDir(dir);
  assert.equal(manifest.status, "pass");
  assert.equal(manifest.pass_scope, "scoped_scope_only");
  assert.equal(manifest.full_matrix_established, false);
  assert.equal(manifest.scoped.scope_class, "scoped");
});

test("生产指纹与证据面统计：DB snapshot / transport / AX / 指纹两种历史格式", (t) => {
  const dir = makeNativeFixture(t, {
    textFiles: { "T1-reading.ax.txt": "AX", "T1-reading.text.txt": "text" },
    productionSources: {
      head: "f75a2bb0",
      file_count: 2,
      files: {
        "apps/novel_agent/lib/novel_agent.ex": "hash-a",
        "apps/novel_application/lib/x.ex": "hash-b",
      },
    },
  });
  const manifest = scanNativeArtifactDir(dir);
  assert.equal(manifest.db_snapshot.found, true);
  assert.equal(manifest.db_snapshot.primary.path.includes("database/"), true);
  assert.equal(manifest.native_transport.frames, 1);
  assert.equal(manifest.native_transport.http_requests, 2);
  assert.equal(manifest.native_transport.http_2xx, 1);
  assert.equal(manifest.native_transport.http_failures.length, 1);
  assert.equal(manifest.ax.ax_dumps, 1);
  assert.equal(manifest.ax.text_dumps, 1);
  assert.equal(manifest.production_fingerprint.production_sources_snapshot.source_count, 2);
  assert.equal(manifest.production_fingerprint.production_sources_snapshot.declared_file_count, 2);
  assert.equal(manifest.production_fingerprint.head, "1ce14d5b");
  assert.equal(manifest.production_fingerprint.production_sources_head, "f75a2bb0");
  assert.equal(manifest.production_fingerprint.production_sources_unchanged, true);
});

// ---------- 校验与写入 ----------

test("validateNativeRunManifest：pass 不得带 failure / 非干净 termination / 缺 pass_scope", () => {
  const base = {
    schema_version: NATIVE_RUN_SCHEMA_VERSION,
    artifact_dir: "artifacts/slice-verify/fixture",
    layout: "nested-run",
    scanned_at: "2026-10-27T10:00:00.000Z",
    run: {},
    final: {},
    failure: { found: false },
    scoped: { scope_class: "full" },
    checks: {},
    termination: { found: true, signal: "EXIT", exit_code: 0 },
    native_transport: {},
    ax: {},
    db_snapshot: {},
    production_fingerprint: {},
    run_evidence: {},
    status: "pass",
    reason_codes: [],
    pass_scope: "full_scope",
    full_matrix_established: true,
  };
  assert.deepEqual(validateNativeRunManifest(base), []);
  assert.ok(
    validateNativeRunManifest({ ...base, failure: { found: true } }).some((error) =>
      error.includes("failure 存在"),
    ),
  );
  assert.ok(
    validateNativeRunManifest({
      ...base,
      termination: { found: true, signal: "TERM", exit_code: 143 },
    }).some((error) => error.includes("termination")),
  );
  assert.ok(
    validateNativeRunManifest({ ...base, pass_scope: null }).some((error) =>
      error.includes("pass_scope"),
    ),
  );
  assert.ok(
    validateNativeRunManifest({ ...base, status: "fail", pass_scope: "full_scope" }).some((error) =>
      error.includes("不得声明 pass_scope"),
    ),
  );
  assert.ok(
    validateNativeRunManifest({ ...base, schema_version: "quality-native-run/v0" }).some((error) =>
      error.includes("schema_version"),
    ),
  );
  assert.ok(validateNativeRunManifest({ ...base, scoped: { scope_class: "partial" } }).length > 0);
});

test("writeNativeRunManifest 默认拒绝覆盖（旧证据只读）；显式 out 可写", (t) => {
  const dir = makeNativeFixture(t);
  const manifest = scanNativeArtifactDir(dir);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "native-run-out-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const out = path.join(outDir, "native-run-manifest.json");
  const written = writeNativeRunManifest(manifest, { out });
  assert.ok(fs.existsSync(written.path));
  assert.throws(() => writeNativeRunManifest(manifest, { out }), /拒绝覆盖/);
  // 默认写回 artifact_dir 首次允许（新证据），但第二次必须拒绝覆盖，避免改写历史证据。
  writeNativeRunManifest(manifest);
  assert.throws(() => writeNativeRunManifest(manifest), /拒绝覆盖/);
  fs.rmSync(path.join(dir, "native-run-manifest.json"), { force: true });
});

// ---------- 历史真实原生 artifact（只读；缺失即跳过） ----------

function realDir(name) {
  return path.join(SLICE_VERIFY, name);
}

test("真实 p1 原生实模 run：pass 但 scoped（不得外推全矩阵）", { skip: !fs.existsSync(realDir("p1-chapter-draft-generation-native")) }, () => {
  const manifest = scanNativeArtifactDir(realDir("p1-chapter-draft-generation-native"));
  assert.equal(manifest.status, "pass");
  assert.equal(manifest.pass_scope, "scoped_scope_only");
  assert.equal(manifest.full_matrix_established, false);
  assert.equal(manifest.run.provider, "strata");
  assert.equal(manifest.run.model, "iq3_s");
  assert.equal(manifest.run.driver_is_native, true);
  assert.equal(manifest.ax.ax_dumps > 0, true);
  assert.equal(manifest.db_snapshot.found, true);
  assert.equal(manifest.production_fingerprint.head.length >= 7, true);
  assert.equal(manifest.failure.found, false);
  assert.equal(manifest.termination.exit_code, 0);
});

test("真实 b28 native a1：final+failure 并存 → fail（不只看 final）", { skip: !fs.existsSync(realDir("b28-native-20261025-a1")) }, () => {
  const manifest = scanNativeArtifactDir(realDir("b28-native-20261025-a1"));
  assert.equal(manifest.final.found, true);
  assert.equal(manifest.failure.found, true);
  assert.equal(manifest.status, "fail");
  assert.ok(manifest.reason_codes.includes("final_failure_coexist"));
  assert.equal(manifest.pass_scope, null);
});

test("真实 b28 format r3：TERM 143 无 final/failure → fail termination_not_clean", { skip: !fs.existsSync(realDir("b28-format-native-20261026-r3")) }, () => {
  const manifest = scanNativeArtifactDir(realDir("b28-format-native-20261026-r3"));
  assert.equal(manifest.status, "fail");
  assert.ok(manifest.reason_codes.includes("termination_not_clean"));
  assert.equal(manifest.termination.signal, "TERM");
});

test("真实 b29 确定性 native：pass full_scope", { skip: !fs.existsSync(realDir("b29-existing-character-role-revision-native")) }, () => {
  const manifest = scanNativeArtifactDir(realDir("b29-existing-character-role-revision-native"));
  assert.equal(manifest.status, "pass");
  assert.equal(manifest.pass_scope, "full_scope");
  assert.equal(manifest.full_matrix_established, true);
  assert.equal(manifest.checks.failed.length, 0);
});

test("真实 b29 实模失败批次：failure → fail，失败证据保留可定位", { skip: !fs.existsSync(realDir("b29-existing-character-role-revision-native-strata")) }, () => {
  const manifest = scanNativeArtifactDir(realDir("b29-existing-character-role-revision-native-strata"));
  assert.equal(manifest.status, "fail");
  assert.equal(manifest.failure.found, true);
  assert.ok(manifest.failure.reason);
  assert.equal(manifest.failure.path.includes("failure.json"), true);
});

test("历史旧布局（只有 summary，无 final/failure）→ evidence_missing，旧 summary 存在不是 PASS", { skip: !fs.existsSync(realDir("b29-cp0-pass-final-20261025T0730")) }, () => {
  const manifest = scanNativeArtifactDir(realDir("b29-cp0-pass-final-20261025T0730"));
  assert.equal(manifest.status, "evidence_missing");
  assert.ok(manifest.reason_codes.includes("final_missing"));
});

test("evaluateNativeRun 是纯函数：final+failure 并存直接判 fail", () => {
  const verdict = evaluateNativeRun({
    schema_version: NATIVE_RUN_SCHEMA_VERSION,
    artifact_dir: "artifacts/slice-verify/x",
    run: { found: true },
    final: { found: true },
    failure: { found: true },
    termination: { found: true, signal: "EXIT", exit_code: 0 },
    checks: { failed: [], summary: { all_checks_passed: true } },
    scoped: { scope_class: "full" },
  });
  assert.equal(verdict.status, "fail");
  assert.ok(verdict.reason_codes.includes("final_failure_coexist"));
  assert.equal(verdict.full_matrix_established, false);
});

// ---------- CLI（真实可用入口；不执行产品/不启动 Tauri） ----------

const NATIVE_CLI = path.join(HERE, "native_run_manifest_cli.mjs");

function runNativeCli(args) {
  return spawnSync(process.execPath, [NATIVE_CLI, ...args], { encoding: "utf8" });
}

test("CLI scan：真实 p1 原生目录输出 pass/scoped JSON", { skip: !fs.existsSync(realDir("p1-chapter-draft-generation-native")) }, () => {
  const result = runNativeCli(["scan", realDir("p1-chapter-draft-generation-native"), "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.schema_version, NATIVE_RUN_SCHEMA_VERSION);
  assert.equal(manifest.status, "pass");
  assert.equal(manifest.pass_scope, "scoped_scope_only");
});

test("CLI scan：缺少目录返回 66；--out 拒绝覆盖", (t) => {
  const usage = runNativeCli(["scan", path.join(os.tmpdir(), `missing-native-${process.pid}`)]);
  assert.equal(usage.status, 66);
  const dir = makeNativeFixture(t);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "native-run-cli-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const out = path.join(outDir, "native-run-manifest.json");
  assert.equal(runNativeCli(["scan", dir, "--out", out]).status, 0);
  assert.ok(fs.existsSync(out));
  assert.equal(runNativeCli(["scan", dir, "--out", out]).status, 66);
});
