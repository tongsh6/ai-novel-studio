// B41 CP4：verdict v2 契约的负例矩阵与生成/读取同源测试（node --test，无外部依赖）。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_ROLES,
  EXIT_CODES,
  LAYER_STATUSES,
  REQUIRED_FIELDS,
  SCHEMA_VERSION,
  STATUSES,
  SURFACES,
  VERDICT_FILE,
  VerdictError,
  buildVerdict,
  exitCodeForStatus,
  readVerdict,
  validateVerdict,
  writeVerdict,
} from "./verdict.mjs";

const GIT_HEAD = "ad6b7ae8";
const schema = JSON.parse(
  readFileSync(new URL("../../../quality/acceptance/verdict-schema.json", import.meta.url), "utf8"),
);
const cliPath = fileURLToPath(new URL("./verdict_cli.mjs", import.meta.url));

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "quality-verdict-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

function passOpts(overrides = {}) {
  return {
    scenario_id: "example-tauri-scenario",
    tier: "pr-smoke",
    surface: "tauri",
    status: "pass",
    reason: null,
    driver: "external-system-ui",
    provider: "slice_verify",
    model: null,
    actual_model: null,
    artifact_dir: "artifacts/slice-verify/example-tauri-scenario",
    generated_at: "2026-10-27T12:00:00.000Z",
    git_head: GIT_HEAD,
    mechanism: { status: "pass", evidence_refs: ["app-log.jsonl"] },
    model_behavior: { status: "not_applicable", evidence_refs: [] },
    evidence_required: ["screenshot", "app_jsonl"],
    evidence_present: ["screenshot", "app_jsonl"],
    artifact_links: [
      { kind: "screenshot", path: "screen.png", role: "required" },
      { kind: "app_jsonl", path: "app-log.jsonl", role: "required" },
    ],
    final_refs: ["screen.png", "app-log.jsonl"],
    ...overrides,
  };
}

function failOpts(overrides = {}) {
  return passOpts({
    status: "fail",
    reason: "断言失败：expected PASS",
    reason_codes: ["assertion_failed"],
    mechanism: { status: "fail", evidence_refs: ["app-log.jsonl"] },
    model_behavior: { status: "unknown", evidence_refs: [] },
    artifact_links: [
      { kind: "screenshot", path: "failure.png", role: "failure" },
      { kind: "app_jsonl", path: "app-log.jsonl", role: "required" },
    ],
    failure_refs: ["failure.png"],
    ...overrides,
  });
}

test("构造 pass verdict：默认值与必填字段完整且通过校验", () => {
  const verdict = buildVerdict(passOpts());
  assert.equal(verdict.schema_version, SCHEMA_VERSION);
  assert.equal(verdict.status, "pass");
  assert.equal(verdict.attempt, 1);
  assert.equal(verdict.timeouts, 0);
  assert.equal(verdict.reason, null);
  assert.equal(verdict.duration_ms, null);
  assert.equal(verdict.started_at, null);
  assert.equal(verdict.git_head, GIT_HEAD);
  assert.deepEqual(verdict.evidence_missing, []);
  assert.deepEqual(verdict.mechanism, { status: "pass", evidence_refs: ["app-log.jsonl"] });
  assert.deepEqual(verdict.batch, undefined);
  assert.deepEqual(validateVerdict(verdict), []);
  for (const field of REQUIRED_FIELDS) assert.ok(Object.hasOwn(verdict, field), field);
});

test("batch 0-based 位置与 duration_ms 推导", () => {
  const verdict = buildVerdict(
    passOpts({
      started_at: "2026-10-27T12:00:00.000Z",
      finished_at: "2026-10-27T12:00:02.500Z",
      batch: { id: "nightly-2026-10-27", index: 2, total: 5 },
    }),
  );
  assert.equal(verdict.duration_ms, 2500);
  assert.deepEqual(verdict.batch, { id: "nightly-2026-10-27", index: 2, total: 5 });
  assert.deepEqual(validateVerdict(verdict), []);
  assert.ok(
    validateVerdict({ ...verdict, batch: { id: "b", index: 3, total: 3 } }).some((item) =>
      item.includes("batch.index"),
    ),
  );
  assert.ok(
    validateVerdict({ ...verdict, batch: { id: "b", index: 0 } }).some((item) => item.includes("batch.total")),
  );
});

test("fail/skipped/not_run/evidence_missing 都能构造并保留原因", () => {
  const base = passOpts({
    mechanism: { status: "unknown", evidence_refs: [] },
    model_behavior: { status: "unknown", evidence_refs: [] },
  });
  for (const [status, reason] of [
    ["fail", "断言失败"],
    ["skipped", "manifest blocked：B40 重锚前不可执行"],
    ["not_run", "批次未执行"],
    ["evidence_missing", "缺少 screenshot"],
  ]) {
    const verdict = buildVerdict({ ...base, status, reason });
    assert.equal(verdict.status, status);
    assert.equal(verdict.reason, reason);
    assert.deepEqual(validateVerdict(verdict), []);
  }
});

test("fail/skipped/evidence_missing 缺 reason 被拒绝", () => {
  const base = passOpts({
    mechanism: { status: "unknown", evidence_refs: [] },
    model_behavior: { status: "unknown", evidence_refs: [] },
  });
  for (const status of ["fail", "skipped", "evidence_missing"]) {
    assert.throws(
      () => buildVerdict({ ...base, status, reason: undefined }),
      (error) => error instanceof VerdictError && error.errors.some((item) => item.includes("必须提供非空 reason")),
      status,
    );
    const valid = buildVerdict({ ...base, status: "not_run", reason: "未运行" });
    const invalid = { ...valid, status, reason: null };
    assert.ok(validateVerdict(invalid).some((item) => item.includes("必须提供非空 reason")), status);
  }
});

test("pass 不得声明缺失证据，也不得用 unknown/fail 分层冒充", () => {
  const verdict = buildVerdict(passOpts());
  assert.ok(
    validateVerdict({ ...verdict, evidence_missing: ["screenshot"] }).some((item) =>
      item.includes("不得声明 evidence_missing"),
    ),
  );
  // 显式传空 evidence_missing 不能绕过缺证据检查：required 必须全部 present。
  assert.ok(
    validateVerdict({ ...verdict, evidence_missing: [], evidence_present: ["app_jsonl"] }).some((item) =>
      item.includes("必须出现在 evidence_present"),
    ),
  );
  assert.throws(
    () => buildVerdict(passOpts({ evidence_missing: [], evidence_present: ["app_jsonl"] })),
    (error) =>
      error instanceof VerdictError &&
      error.errors.some((item) => item.includes("必须出现在 evidence_present")),
  );
  assert.ok(
    validateVerdict({ ...verdict, mechanism: { status: "unknown", evidence_refs: [] } }).some((item) =>
      item.includes("mechanism.status"),
    ),
  );
  assert.ok(
    validateVerdict({ ...verdict, model_behavior: { status: "fail", evidence_refs: [] } }).some((item) =>
      item.includes("model_behavior.status"),
    ),
  );
  const withoutLayer = { ...verdict };
  delete withoutLayer.model_behavior;
  assert.ok(
    validateVerdict(withoutLayer).some((item) => item.includes("必须显式提供 model_behavior")),
  );
  assert.throws(
    () => buildVerdict(passOpts({ mechanism: { status: "unknown", evidence_refs: [] } })),
    VerdictError,
  );
});

test("拒绝未知字段、非法枚举与坏 artifact link 角色", () => {
  const verdict = buildVerdict(passOpts());
  assert.ok(validateVerdict({ ...verdict, surprise: 1 }).some((item) => item.includes("未知字段 surprise")));
  assert.ok(validateVerdict({ ...verdict, surface: "windows" }).some((item) => item.includes("surface")));
  assert.ok(validateVerdict({ ...verdict, status: "blocked" }).some((item) => item.includes("status")));
  assert.ok(
    validateVerdict({
      ...verdict,
      artifact_links: [{ kind: "screenshot", path: "a.png", role: "final" }],
    }).some((item) => item.includes("artifact_links[0].role")),
  );
  assert.ok(
    validateVerdict({ ...verdict, mechanism: { status: "maybe", evidence_refs: [] } }).some((item) =>
      item.includes("mechanism.status"),
    ),
  );
  assert.ok(validateVerdict({ ...verdict, attempt: 0 }).some((item) => item.includes("attempt")));
  assert.ok(validateVerdict({ ...verdict, timeouts: -1 }).some((item) => item.includes("timeouts")));
  assert.ok(validateVerdict({ ...verdict, generated_at: null }).some((item) => item.includes("generated_at")));
});

test("artifact_links 角色与 final/failure/scoped 索引分离", () => {
  const verdict = buildVerdict(
    failOpts({
      artifact_links: [
        { kind: "screenshot", path: "failure.png", role: "failure" },
        { kind: "app_jsonl", path: "app-log.jsonl", role: "required" },
        { kind: "summary_json", path: "summary.json", role: "scoped" },
      ],
      final_refs: ["app-log.jsonl"],
      failure_refs: ["failure.png"],
      scoped_refs: ["summary.json"],
    }),
  );
  assert.deepEqual(
    verdict.artifact_links.map((link) => link.role),
    ["failure", "required", "scoped"],
  );
  assert.deepEqual(verdict.failure_refs, ["failure.png"]);
  assert.deepEqual(verdict.scoped_refs, ["summary.json"]);
  assert.deepEqual(validateVerdict(verdict), []);
});

test("evidence_missing 必须是 evidence_required 子集，required/present 推导 missing", () => {
  const verdict = buildVerdict(passOpts());
  assert.ok(
    validateVerdict({ ...verdict, evidence_missing: ["ui_state"] }).some((item) =>
      item.includes("evidence_missing 含未在 evidence_required"),
    ),
  );
  const failed = buildVerdict({
    ...passOpts({ status: "fail", reason: "缺少截图", evidence_present: ["app_jsonl"] }),
  });
  assert.deepEqual(failed.evidence_missing, ["screenshot"]);
  assert.deepEqual(validateVerdict(failed), []);
});

test("writeVerdict 落盘、readVerdict 读回，生成与读取同源", (t) => {
  const dir = tempDir(t);
  const verdict = buildVerdict(passOpts({ artifact_dir: dir }));
  const written = writeVerdict(dir, verdict);
  assert.deepEqual(written, { ok: true, path: path.join(dir, VERDICT_FILE), previous_status: null });
  assert.ok(existsSync(written.path));
  const read = readVerdict(dir);
  assert.equal(read.ok, true);
  assert.deepEqual(read.verdict, verdict);
  assert.equal(JSON.parse(readFileSync(written.path, "utf8")).schema_version, SCHEMA_VERSION);
  assert.throws(() => writeVerdict(dir, { ...verdict, status: undefined }), VerdictError);
});

test("拒绝用 fail 覆盖已有 PASS；同 PASS 新运行与显式允许才可写", (t) => {
  const dir = tempDir(t);
  writeVerdict(dir, buildVerdict(passOpts({ artifact_dir: dir })));
  const failVerdict = buildVerdict(failOpts({ artifact_dir: dir }));
  assert.throws(
    () => writeVerdict(dir, failVerdict),
    (error) => error instanceof VerdictError && error.code === "pass_verdict_protected",
  );
  assert.equal(readVerdict(dir).verdict.status, "pass");
  const newerPass = buildVerdict(passOpts({ artifact_dir: dir, git_head: "newer-head" }));
  assert.equal(writeVerdict(dir, newerPass).previous_status, "pass");
  assert.equal(readVerdict(dir).verdict.git_head, "newer-head");
  assert.equal(writeVerdict(dir, failVerdict, { allowOverwritePass: true }).previous_status, "pass");
  assert.equal(readVerdict(dir).verdict.status, "fail");
});

test("缺 verdict 但有 legacy summary：evidence_missing 且绝不 PASS", (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ status: "pass", scenario_id: "legacy" }));
  const read = readVerdict(dir);
  assert.equal(read.ok, false);
  assert.equal(read.status, "evidence_missing");
  assert.equal(read.legacy_summary, true);
  assert.ok(read.reason_codes.includes("verdict_missing"));
  assert.ok(read.reason.includes("不能据此判定 PASS"));
});

test("缺 verdict 且无 summary、或 artifact 目录不存在：都是 evidence_missing", (t) => {
  const dir = tempDir(t);
  const missing = readVerdict(dir);
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "evidence_missing");
  assert.equal(missing.legacy_summary, false);
  assert.deepEqual(missing.reason_codes, ["verdict_missing"]);
  const absentDir = readVerdict(path.join(dir, "does-not-exist"));
  assert.equal(absentDir.status, "evidence_missing");
  assert.ok(absentDir.reason_codes.includes("artifact_dir_missing"));
});

test("损坏或缺 status 的 verdict 读取一律 evidence_missing", (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, VERDICT_FILE), "{not json");
  const corrupt = readVerdict(dir);
  assert.equal(corrupt.status, "evidence_missing");
  assert.ok(corrupt.reason_codes.includes("verdict_invalid_json"));

  const verdict = buildVerdict(passOpts({ artifact_dir: dir }));
  delete verdict.status;
  writeFileSync(path.join(dir, VERDICT_FILE), JSON.stringify(verdict));
  writeFileSync(path.join(dir, "summary.json"), "{}");
  const invalid = readVerdict(dir);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, "evidence_missing");
  assert.equal(invalid.legacy_summary, true);
  assert.ok(invalid.errors.some((item) => item.includes("status")));
});

test("schema 常量与实现同源（draft 2020-12 / additionalProperties=false）", () => {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, SCHEMA_VERSION);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schema_version.const, SCHEMA_VERSION);
  assert.deepEqual(schema.properties.status.enum, [...STATUSES]);
  assert.deepEqual(schema.properties.surface.enum, [...SURFACES]);
  assert.deepEqual(schema.properties.artifact_links.items.properties.role.enum, [...ARTIFACT_ROLES]);
  assert.deepEqual(schema.properties.mechanism.properties.status.enum, [...LAYER_STATUSES]);
  assert.deepEqual(schema.properties.model_behavior.properties.status.enum, [...LAYER_STATUSES]);
  assert.deepEqual([...schema.required].sort(), [...REQUIRED_FIELDS].sort());
  assert.equal(schema.properties.artifact_links.items.additionalProperties, false);
  for (const field of ["mechanism", "model_behavior", "batch"]) {
    assert.equal(schema.properties[field].additionalProperties, false, field);
  }
});

test("schema 条件约束与校验器一致（pass 分层 / 缺 reason）", () => {
  const passRule = schema.allOf.find((rule) => rule.if?.properties?.status?.const === "pass");
  assert.ok(passRule, "schema 需要 pass 条件约束");
  assert.deepEqual(passRule.then.required, ["mechanism", "model_behavior"]);
  assert.deepEqual(passRule.then.properties.mechanism.properties.status.enum, ["pass", "not_applicable"]);
  assert.deepEqual(passRule.then.properties.model_behavior.properties.status.enum, ["pass", "not_applicable"]);
  assert.equal(passRule.then.properties.evidence_missing.maxItems, 0);
  for (const status of ["fail", "skipped", "evidence_missing"]) {
    const rule = schema.allOf.find((item) => item.if?.properties?.status?.const === status);
    assert.ok(rule, `schema 需要 ${status} 的 reason 条件约束`);
    assert.ok(rule.then.required.includes("reason"), status);
    assert.equal(rule.then.properties.reason.minLength, 1, status);
  }
});

test("未知 verdict status 没有退出码，read 映射覆盖闭集", () => {
  for (const status of STATUSES) {
    assert.ok(Number.isInteger(exitCodeForStatus(status)), status);
  }
  assert.equal(exitCodeForStatus("pass"), 0);
  assert.equal(exitCodeForStatus("fail"), 1);
  assert.equal(exitCodeForStatus("skipped"), 65);
  assert.equal(exitCodeForStatus("evidence_missing"), 67);
  assert.equal(exitCodeForStatus("not_run"), 69);
  assert.throws(() => exitCodeForStatus("blocked"), VerdictError);
});

test("非对象的 verdict 一律无效", () => {
  for (const value of [null, [], "verdict", 3]) {
    assert.notEqual(validateVerdict(value).length, 0, String(value));
  }
});

test("CLI read 按 status 映射退出码 0/1/65/67/69", (t) => {
  const dir = tempDir(t);
  const cases = [
    ["pass", passOpts({ artifact_dir: dir })],
    ["fail", failOpts({ artifact_dir: dir })],
    ["skipped", failOpts({ artifact_dir: dir, status: "skipped" })],
    ["not_run", failOpts({ artifact_dir: dir, status: "not_run" })],
    ["evidence_missing", failOpts({ artifact_dir: dir, status: "evidence_missing" })],
  ];
  for (const [status, opts] of cases) {
    writeVerdict(dir, buildVerdict({ ...opts, status }), { allowOverwritePass: true });
    const result = runCli("read", dir);
    assert.equal(result.status, EXIT_CODES[status], `${status}: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).status, status, status);
  }
});

test("CLI read 缺 verdict 输出 evidence_missing JSON 并 exit 67", (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, "summary.json"), "{}\n");
  const result = runCli("read", dir);
  assert.equal(result.status, 67, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "evidence_missing");
  assert.equal(output.legacy_summary, true);
  assert.equal(output.scenario_id, null);
  assert.deepEqual(output.reason_codes, ["verdict_missing", "legacy_summary"]);
});

test("CLI write/validate/usage 的落盘与退出码", (t) => {
  const dir = tempDir(t);
  const verdict = buildVerdict(passOpts({ artifact_dir: dir }));
  const input = path.join(dir, "input.json");
  writeFileSync(input, JSON.stringify(verdict));
  const write = runCli("write", dir, input);
  assert.equal(write.status, 0, write.stderr);
  assert.equal(JSON.parse(write.stdout).ok, true);
  assert.ok(existsSync(path.join(dir, VERDICT_FILE)));
  assert.equal(runCli("read", dir).status, 0);

  const validate = runCli("validate", path.join(dir, VERDICT_FILE));
  assert.equal(validate.status, 0, validate.stderr);
  assert.deepEqual(JSON.parse(validate.stdout), { ok: true });

  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ ...verdict, status: "blocked" }));
  const invalid = runCli("validate", bad);
  assert.equal(invalid.status, 1);
  assert.ok(JSON.parse(invalid.stdout).errors.some((item) => item.includes("status")));

  const subDir = path.join(dir, "sub");
  const badWrite = runCli("write", subDir, bad);
  assert.equal(badWrite.status, 1);
  assert.ok(!existsSync(path.join(subDir, VERDICT_FILE)));

  assert.equal(runCli().status, 64);
  assert.equal(runCli("read").status, 64);
  assert.equal(runCli("unknown").status, 64);
});
