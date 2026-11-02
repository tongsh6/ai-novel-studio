// Strata 单槽生命周期证据的纯函数测试：解析 /v1/models 与 /api/models 观测，
// 单槽判据、卸载核验与 error 如实保留；fetch 注入，不发真实网络。
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStrataState,
  strataSlotCheck,
  strataLifecycleRecord,
  readStrataState,
  unloadStrata,
  DEFAULT_STRATA_MODEL,
} from "./strata_lifecycle.mjs";

const loadedModels = { ok: true, status: 200, body: { data: [{ id: DEFAULT_STRATA_MODEL }] } };
const loadedApi = {
  ok: true,
  status: 200,
  body: { mode: "chat", current: DEFAULT_STRATA_MODEL, loaded: DEFAULT_STRATA_MODEL },
};
const unloadedModels = { ok: true, status: 200, body: { data: [] } };
const unloadedApi = { ok: true, status: 200, body: { mode: "chat", current: null, loaded: null } };

test("parseStrataState 投影 /v1/models 与 /api/models 的观测事实", () => {
  const state = parseStrataState({ models: loadedModels, api: loadedApi });
  assert.deepEqual(state.model_ids, [DEFAULT_STRATA_MODEL]);
  assert.equal(state.loaded, DEFAULT_STRATA_MODEL);
  assert.equal(state.current, DEFAULT_STRATA_MODEL);
  assert.equal(state.error, null);
  const missing = parseStrataState({ models: { ok: false, error: "ECONNREFUSED" }, api: null });
  assert.equal(missing.models_ok, false);
  assert.equal(missing.model_ids, null);
  assert.equal(missing.error, "ECONNREFUSED");
});

test("单槽判据：恰为 iq3_s 且卸载态 loaded=null 分别成立，多模型/未知状态失败关闭", () => {
  const loaded = strataSlotCheck(parseStrataState({ models: loadedModels, api: loadedApi }));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.loaded, true);
  assert.equal(loaded.unloaded, false);
  const unloaded = strataSlotCheck(parseStrataState({ models: unloadedModels, api: unloadedApi }));
  assert.equal(unloaded.ok, true);
  assert.equal(unloaded.loaded, false);
  assert.equal(unloaded.unloaded, true);
  // 真实 cp3b smoke 形状：/v1/models 列出可用 iq3_s、/api/models loaded=null。
  // 是否加载只看 loaded：null=未加载（既是批次前常态，也是批次后卸载核验口径）；
  // /v1/models 列表只是可用模型目录，不当作「已加载」或「未卸载」证据。
  const catalogOnly = strataSlotCheck(
    parseStrataState({
      models: loadedModels,
      api: { ok: true, status: 200, body: { mode: "real", current: "local-internal-id", loaded: null } },
    }),
  );
  assert.equal(catalogOnly.ok, true);
  assert.equal(catalogOnly.loaded, false);
  assert.equal(catalogOnly.unloaded, true);
  const multi = strataSlotCheck(
    parseStrataState({
      models: { ok: true, body: { data: [{ id: "iq3_s" }, { id: "other" }] } },
      api: loadedApi,
    }),
  );
  assert.equal(multi.ok, false);
  assert.match(multi.reason, /strata_single_slot_violation/u);
  const unknown = strataSlotCheck(parseStrataState({ models: null, api: null }));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.loaded, null);
  assert.equal(unknown.reason, "models_unavailable");
  assert.equal(strataSlotCheck(null).reason, "state_missing");
  const error = strataSlotCheck(parseStrataState({ models: { ok: false, error: "boom" }, api: null }));
  assert.equal(error.ok, false);
  assert.match(error.reason, /strata_error/u);
});

test("readStrataState 读取 /v1/models 与 /api/models；error 不当作已卸载", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/v1/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "iq3_s" }] }) };
    if (url.endsWith("/api/models")) {
      return { ok: true, status: 200, json: async () => ({ mode: "chat", current: "iq3_s", loaded: "iq3_s" }) };
    }
    throw new Error("unexpected url");
  };
  const state = await readStrataState({ fetchImpl });
  assert.deepEqual(calls.sort(), ["http://127.0.0.1:47831/api/models", "http://127.0.0.1:47831/v1/models"]);
  assert.equal(strataSlotCheck(state).loaded, true);
  const failing = await readStrataState({
    fetchImpl: async () => {
      throw new Error("down");
    },
  });
  assert.equal(failing.error, "down");
  assert.equal(strataSlotCheck(failing).ok, false);
});

test("unloadStrata 先 unload 再核验 loaded=null；unload 失败如实保留", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/api/models/unload")) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url.endsWith("/v1/models")) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    return { ok: true, status: 200, json: async () => ({ mode: "chat", current: null, loaded: null }) };
  };
  const result = await unloadStrata({ fetchImpl });
  assert.equal(result.unload.ok, true);
  assert.equal(result.slot.ok, true);
  assert.equal(result.slot.loaded, false);
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`).sort(),
    [
      "GET http://127.0.0.1:47831/api/models",
      "GET http://127.0.0.1:47831/v1/models",
      "POST http://127.0.0.1:47831/api/models/unload",
    ],
  );
  const failure = await unloadStrata({
    fetchImpl: async (url) => {
      if (url.endsWith("/unload")) throw new Error("unload down");
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });
  assert.equal(failure.unload.ok, false);
  assert.equal(failure.unload.error, "unload down");
  assert.equal(failure.slot.ok, false);
});

test("strataLifecycleRecord 记录 loaded_before/after 与 unloaded，只由真实读取决定", () => {
  const before = parseStrataState({ models: loadedModels, api: loadedApi });
  const after = parseStrataState({ models: unloadedModels, api: unloadedApi });
  const record = strataLifecycleRecord({ before, after, unload: { ok: true } });
  assert.equal(record.schema, "b71-strata-slot/v1");
  assert.equal(record.model, DEFAULT_STRATA_MODEL);
  assert.equal(record.loaded_before, true);
  assert.equal(record.loaded_after, false);
  assert.equal(record.unloaded, true);
  const failed = strataLifecycleRecord({
    before,
    after: parseStrataState({ models: { ok: false, error: "down" }, api: null }),
  });
  assert.equal(failed.unloaded, false);
  assert.equal(failed.loaded_after, null);
});
