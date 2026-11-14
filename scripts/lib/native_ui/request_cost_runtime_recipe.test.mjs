// B87 R01 runtime recipe：唯一的受控实验参数来源。测试只验证声明/注入/事实核对，
// 不启动后端、不发模型请求。
import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_PROFILE_ID,
  assertManifestRuntime,
  assertRuntimeFacts,
  expectedRuntimeFacts,
  getRuntimeProfile,
  runtimeEnv,
  runtimeEnvLines,
} from "./request_cost_runtime_recipe.mjs";

const PROFILE = getRuntimeProfile(RUNTIME_PROFILE_ID);

function manifest(overrides = {}) {
  return {
    model: {
      provider: PROFILE.provider,
      model: PROFILE.model,
      thinking: PROFILE.thinking,
      reasoning_effort: PROFILE.reasoning_effort,
      max_tokens: PROFILE.max_tokens,
      timeout_ms: PROFILE.timeout_ms,
      context_window: PROFILE.context_window,
    },
    runtime: {
      profile: RUNTIME_PROFILE_ID,
      auto_maintenance: { ...PROFILE.auto_maintenance },
      sync_summary_maintenance: PROFILE.sync_summary_maintenance,
    },
    ...overrides,
  };
}

function facts(overrides = {}) {
  const expected = expectedRuntimeFacts(RUNTIME_PROFILE_ID);
  return {
    schema: "b87-r01-runtime-facts/v1",
    captured_at: "2026-11-13T00:00:00.000Z",
    pid: "1",
    ...expected,
    provider: { ...expected.provider, endpoint: "http://127.0.0.1:8000/v1", extra_providers: ["stub"] },
    context_pressure: { ...expected.context_pressure, maintenance_ratio: 0.7, hard_ratio: 0.9 },
    ...overrides,
  };
}

test("runtime env 由 recipe 单点生成，值和实验声明一致", () => {
  assert.deepEqual(runtimeEnv(), {
    SLICE_VERIFY_PROVIDER: "splash",
    NOVEL_SPLASH_MODEL: "local/Q4-PLE4",
    NOVEL_SPLASH_THINKING: "enabled",
    NOVEL_SPLASH_REASONING_EFFORT: "high",
    NOVEL_SPLASH_MAX_TOKENS: "32000",
    NOVEL_CONTEXT_WINDOW_OVERRIDES: "splash:262144",
    NOVEL_AUTO_MAINTENANCE_ENABLED: "true",
    NOVEL_SYNC_SUMMARY_MAINTENANCE: "false",
  });
  const lines = runtimeEnvLines();
  assert.equal(lines.length, 8);
  assert.ok(lines.every((line) => /^[A-Z][A-Z0-9_]*=[^\n\r]+$/u.test(line)));
  assert.ok(lines.includes("NOVEL_SPLASH_THINKING=enabled"));
  assert.ok(lines.includes("NOVEL_CONTEXT_WINDOW_OVERRIDES=splash:262144"));
});

test("manifest 与 runtime profile 必须逐字段一致", () => {
  assert.equal(assertManifestRuntime(manifest()).id, RUNTIME_PROFILE_ID);
  for (const [label, value] of [
    ["model.provider", { model: { ...manifest().model, provider: "strata" } }],
    ["model.model", { model: { ...manifest().model, model: "other" } }],
    ["model.thinking", { model: { ...manifest().model, thinking: "disabled" } }],
    ["model.reasoning_effort", { model: { ...manifest().model, reasoning_effort: "low" } }],
    ["model.max_tokens", { model: { ...manifest().model, max_tokens: 1 } }],
    ["model.timeout_ms", { model: { ...manifest().model, timeout_ms: 1 } }],
    ["model.context_window", { model: { ...manifest().model, context_window: 32_000 } }],
    [
      "runtime.auto_maintenance",
      { runtime: { ...manifest().runtime, auto_maintenance: { enabled: false, keep_recent_items: 4 } } },
    ],
    [
      "runtime.sync_summary_maintenance",
      { runtime: { ...manifest().runtime, sync_summary_maintenance: true } },
    ],
  ]) {
    assert.throws(() => assertManifestRuntime({ ...manifest(), ...value }), /不一致/, label);
  }
  assert.throws(
    () => assertManifestRuntime({ ...manifest(), runtime: { ...manifest().runtime, profile: "missing" } }),
    /未知 runtime profile/,
  );
  assert.throws(() => assertManifestRuntime({}), /runtime/);
  assert.throws(() => assertManifestRuntime({ ...manifest(), runtime: undefined }), /runtime/);
});

test("runtime facts 只核对 Gateway 可观察字段；未暴露配置不冒充实际，且 endpoint 已脱敏", () => {
  assert.equal(assertRuntimeFacts(facts()), true);
  for (const [label, value] of [
    ["provider.selected", { provider: { ...facts().provider, selected: "strata" } }],
    ["provider.model", { provider: { ...facts().provider, model: "other" } }],
    ["context.window", { context_pressure: { ...facts().context_pressure, window: 32_000 } }],
    ["auto.enabled", { auto_maintenance: { ...facts().auto_maintenance, enabled: false } }],
    ["auto.keep", { auto_maintenance: { ...facts().auto_maintenance, keep_recent_items: 1 } }],
    ["summary", { sync_summary_maintenance: true }],
  ]) {
    assert.throws(() => assertRuntimeFacts({ ...facts(), ...value }), /不符/, label);
  }
  assert.throws(
    () => assertRuntimeFacts({ ...facts(), provider: { ...facts().provider, endpoint: "http://u:p@h/v1?x=1" } }),
    /脱敏/,
  );
  assert.throws(
    () => assertRuntimeFacts({ ...facts(), provider: { ...facts().provider, endpoint: "" } }),
    /endpoint/,
  );
  assert.throws(() => assertRuntimeFacts({ ...facts(), mix_env: "prod" }), /mix_env/);
  assert.throws(() => assertRuntimeFacts({ ...facts(), schema: "other" }), /schema/);
  assert.throws(() => assertRuntimeFacts(null), /对象/);
});

test("manifest 缺 model/auto_maintenance 时明确 assert，不 TypeError", () => {
  assert.throws(() => assertManifestRuntime({ ...manifest(), model: undefined }), /model/);
  assert.throws(() => assertManifestRuntime({ ...manifest(), model: null }), /model/);
  assert.throws(
    () =>
      assertManifestRuntime({
        ...manifest(),
        runtime: { ...manifest().runtime, auto_maintenance: undefined },
      }),
    /auto_maintenance/,
  );
  assert.throws(
    () =>
      assertManifestRuntime({
        ...manifest(),
        runtime: { ...manifest().runtime, sync_summary_maintenance: undefined },
      }),
    /不一致/,
  );
});

test("runtime facts 缺 provider/context/auto 时给字段级失败，不 TypeError", () => {
  assert.throws(
    () => assertRuntimeFacts({ ...facts(), provider: undefined }),
    /provider\.selected 不符/,
  );
  assert.throws(
    () => assertRuntimeFacts({ ...facts(), context_pressure: undefined }),
    /context_pressure\.(provider|window) 不符/,
  );
  assert.throws(
    () => assertRuntimeFacts({ ...facts(), auto_maintenance: undefined }),
    /auto_maintenance\.enabled 不符/,
  );
  for (const endpoint of [null, 42, {}, ""]) {
    assert.throws(
      () => assertRuntimeFacts({ ...facts(), provider: { ...facts().provider, endpoint } }),
      /endpoint 缺失/,
      String(endpoint),
    );
  }
});
