// B87 R01 受控实验的**唯一 runtime recipe owner**：batch 注入 env、候选 manifest 声明
// 校验、startup facts 核对都从这里读取，不在 bash/Elixir/候选 JSON 里各写一份。
// 注意：这是本批受控实验参数，不是产品默认值，也不代表 Splash/模型的真实能力。
import assert from "node:assert/strict";

export const RUNTIME_PROFILE_ID = "b87-r01-controlled-splash-high";
export const COMPACTION_RUNTIME_PROFILE_ID = "b87-r03-splash-product-maintenance-budget";

export const RUNTIME_PROFILES = Object.freeze({
  [RUNTIME_PROFILE_ID]: Object.freeze({
    id: RUNTIME_PROFILE_ID,
    provider: "splash",
    model: "local/Q4-PLE4",
    thinking: "enabled",
    reasoning_effort: "high",
    max_tokens: 32_000,
    timeout_ms: 300_000,
    context_window: 262_144,
    maintenance_window: 262_144,
    context_window_key: "splash",
    auto_maintenance: Object.freeze({ enabled: true, keep_recent_items: 4 }),
    sync_summary_maintenance: false,
  }),
  [COMPACTION_RUNTIME_PROFILE_ID]: Object.freeze({
    id: COMPACTION_RUNTIME_PROFILE_ID,
    provider: "splash", model: "local/Q4-PLE4", thinking: "enabled", reasoning_effort: "high",
    max_tokens: 32_000, timeout_ms: 300_000,
    context_window: 262_144,
    // 现役产品 ContextPressure 的保守维护预算；不声称模型实际能力变小。
    maintenance_window: 32_000, context_window_key: "splash",
    auto_maintenance: Object.freeze({ enabled: true, keep_recent_items: 4 }),
    sync_summary_maintenance: false,
  }),
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function getRuntimeProfile(profileId = RUNTIME_PROFILE_ID) {
  const profile = RUNTIME_PROFILES[profileId];
  assert(profile, `未知 runtime profile: ${profileId}`);
  return profile;
}

// batch 用数据行（KEY=VALUE）消费；不含 shell 语法、值不含换行，调用方只做变量赋值。
export function runtimeEnv(profileId = RUNTIME_PROFILE_ID) {
  const profile = getRuntimeProfile(profileId);
  return {
    SLICE_VERIFY_PROVIDER: profile.provider,
    NOVEL_SPLASH_MODEL: profile.model,
    NOVEL_SPLASH_THINKING: profile.thinking,
    NOVEL_SPLASH_REASONING_EFFORT: profile.reasoning_effort,
    NOVEL_SPLASH_MAX_TOKENS: String(profile.max_tokens),
    NOVEL_CONTEXT_WINDOW_OVERRIDES: `${profile.context_window_key}:${profile.maintenance_window}`,
    NOVEL_AUTO_MAINTENANCE_ENABLED: String(profile.auto_maintenance.enabled),
    NOVEL_SYNC_SUMMARY_MAINTENANCE: String(profile.sync_summary_maintenance),
  };
}

export function runtimeEnvLines(profileId = RUNTIME_PROFILE_ID) {
  return Object.entries(runtimeEnv(profileId)).map(([key, value]) => {
    assert(/^[A-Z][A-Z0-9_]*$/u.test(key), `非法 env 名: ${key}`);
    return `${key}=${value}`;
  });
}

function assertManifestProvider(model, profile) {
  for (const [key, expected] of [
    ["provider", profile.provider],
    ["model", profile.model],
    ["thinking", profile.thinking],
    ["reasoning_effort", profile.reasoning_effort],
    ["max_tokens", profile.max_tokens],
    ["timeout_ms", profile.timeout_ms],
    ["context_window", profile.context_window],
  ]) {
    // assertManifestRuntime 已先校验 manifest.model 是对象，这里不再重复可选链。
    assert.equal(
      model[key],
      expected,
      `manifest.model.${key} 与 runtime profile 不一致`,
    );
  }
}

function assertManifestMaintenance(manifest, profile) {
  const auto = manifest.runtime.auto_maintenance;
  assert(isObject(auto), "native manifest 缺少 runtime.auto_maintenance");
  assert.equal(
    auto.enabled,
    profile.auto_maintenance.enabled,
    "manifest.runtime.auto_maintenance.enabled 与 runtime profile 不一致",
  );
  assert.equal(
    auto.keep_recent_items,
    profile.auto_maintenance.keep_recent_items,
    "manifest.runtime.auto_maintenance.keep_recent_items 与 runtime profile 不一致",
  );
  assert.equal(
    manifest.runtime.sync_summary_maintenance,
    profile.sync_summary_maintenance,
    "manifest.runtime.sync_summary_maintenance 与 runtime profile 不一致",
  );
}

// 候选 manifest 必须显式声明这些值；与 recipe 不一致时 preflight 直接失败。
export function assertManifestRuntime(manifest) {
  assert(isObject(manifest), "manifest 必须是对象");
  assert(isObject(manifest.runtime), "native manifest 缺少 runtime");
  assert(isObject(manifest.model), "native manifest 缺少 model");
  const profile = getRuntimeProfile(manifest.runtime.profile);
  assertManifestProvider(manifest.model, profile);
  assertManifestMaintenance(manifest, profile);
  if (profile.id === COMPACTION_RUNTIME_PROFILE_ID) {
    assert.deepEqual(manifest.runtime.context_pressure, { window: 32_000, maintenance_ratio: 0.70 },
      "R03 manifest 必须明确维护预算 32000 / 0.70，与模型能力分开");
  }
  return profile;
}

// 同一进程启动后实际观察到的事实应满足的期望值；只覆盖本批白名单字段。
export function expectedRuntimeFacts(profileId = RUNTIME_PROFILE_ID) {
  const profile = getRuntimeProfile(profileId);
  return {
    mix_env: "test",
    // 只声明 Gateway 只读 options/metadata 实际可消费的字段；module/thinking/
    // max_tokens/timeout 不是 Gateway 公开观察，不能在这里冒充实际路由事实。
    provider: {
      selected: profile.provider,
      model: profile.model,
    },
    context_pressure: {
      provider: profile.provider,
      window: profile.maintenance_window,
      maintenance_ratio: 0.70,
    },
    auto_maintenance: {
      enabled: profile.auto_maintenance.enabled,
      keep_recent_items: profile.auto_maintenance.keep_recent_items,
    },
    sync_summary_maintenance: profile.sync_summary_maintenance,
  };
}

// endpoint 由作者/部署环境决定，manifest 不冻结该值；但 facts 必须给出脱敏后的可用地址。
function assertSafeEndpoint(endpoint) {
  assert(typeof endpoint === "string", "runtime facts provider.endpoint 缺失");
  assert(endpoint.trim() !== "", "runtime facts provider.endpoint 缺失");
  assert(!/[@?#]/u.test(endpoint), "runtime facts provider.endpoint 未脱敏（含 userinfo/query/fragment）");
  assert(/^[a-z][a-z0-9+.-]*:\/\//iu.test(endpoint), "runtime facts provider.endpoint 不是安全 URL");
}

export function assertRuntimeFacts(facts, profileId = RUNTIME_PROFILE_ID) {
  assert(isObject(facts), "runtime facts 必须是对象");
  const expected = expectedRuntimeFacts(profileId);
  assert.equal(facts.schema, "b87-r01-runtime-facts/v1", "runtime facts schema 不符");
  assert.equal(facts.mix_env, expected.mix_env, "runtime facts mix_env 不符");

  for (const [key, value] of Object.entries(expected.provider)) {
    assert.deepEqual(facts.provider?.[key], value, `runtime facts provider.${key} 不符`);
  }
  assertSafeEndpoint(facts.provider.endpoint);

  for (const [key, value] of Object.entries(expected.context_pressure)) {
    assert.deepEqual(facts.context_pressure?.[key], value, `runtime facts context_pressure.${key} 不符`);
  }
  for (const [key, value] of Object.entries(expected.auto_maintenance)) {
    assert.deepEqual(facts.auto_maintenance?.[key], value, `runtime facts auto_maintenance.${key} 不符`);
  }
  assert.equal(
    facts.sync_summary_maintenance,
    expected.sync_summary_maintenance,
    "runtime facts sync_summary_maintenance 不符",
  );
  return true;
}
