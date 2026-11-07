// B71 CP3b 实模批次的 Strata 单槽生命周期证据（外部 harness，不进入产品）。
//
// 预注册要求：strata 单槽只加载预注册模型（历史批次 iq3_s；2026-11-07 q2_0 重冻结）；
// 批次结束/失败/中断后必须 unload 并核验 loaded=null。本模块只做只读状态解析与
// unload 请求编排；fetch 可注入，测试不发真实网络。
export const STRATA_SLOT_SCHEMA = "b71-strata-slot/v1";
export const DEFAULT_STRATA_ENDPOINT = "http://127.0.0.1:47831";
// 2026-11-07 作者裁决 A：CP3b/CP4b-2 实模窗口按当前 Strata 可用模型重新冻结；
// 单槽判据模型名可经 B71_STRATA_MODEL 指定，默认保持历史预注册 iq3_s。
export const DEFAULT_STRATA_MODEL = process.env.B71_STRATA_MODEL || "iq3_s";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function modelIdsFromModelsPayload(payload) {
  if (!isObject(payload)) return null;
  const data = payload.data;
  if (!Array.isArray(data)) return null;
  return data
    .map((entry) => (isObject(entry) ? entry.id ?? entry.name ?? null : typeof entry === "string" ? entry : null))
    .filter((id) => typeof id === "string" && id.trim() !== "");
}

function modelIdsFromApiPayload(payload) {
  if (!isObject(payload)) return null;
  const current = typeof payload.current === "string" ? payload.current : null;
  const loadedList = Array.isArray(payload.loaded) ? payload.loaded : null;
  const loadedSingle = typeof payload.loaded === "string" ? payload.loaded : null;
  const ids = [];
  if (current) ids.push(current);
  if (loadedSingle) ids.push(loadedSingle);
  if (loadedList) ids.push(...loadedList.filter((id) => typeof id === "string"));
  return ids.length > 0 ? ids : null;
}

// /api/models 返回 {mode,current,loaded}；/v1/models 返回 OpenAI {data:[{id}]}。
// 两者都可能有 missing 字段，解析只投影观测事实，不做默认成功。
export function parseStrataState({ models = null, api = null } = {}) {
  const modelsOk = isObject(models) && models.ok === true;
  const apiOk = isObject(api) && api.ok === true;
  const modelIds = modelsOk ? modelIdsFromModelsPayload(models.body) : null;
  const apiIds = apiOk ? modelIdsFromApiPayload(api.body) : null;
  const apiBody = apiOk && isObject(api.body) ? api.body : null;
  return {
    models_ok: modelsOk,
    api_ok: apiOk,
    model_ids: modelIds,
    api_model_ids: apiIds,
    loaded: apiBody ? apiBody.loaded ?? null : null,
    current: apiBody ? apiBody.current ?? null : null,
    mode: apiBody ? apiBody.mode ?? null : null,
    error: (models && models.error) || (api && api.error) || null,
  };
}

// 单槽判据：/v1/models 的可用模型集合只能是空或恰为 [预注册模型]；是否加载只看
// /api/models 的 loaded 字段（真实 strata 的 current 是内部 model id，不能替代 loaded）。
export function strataSlotCheck(state, { model = DEFAULT_STRATA_MODEL } = {}) {
  if (!state || typeof state !== "object") {
    return { ok: false, loaded: null, unloaded: false, reason: "state_missing" };
  }
  if (state.error) return { ok: false, loaded: null, unloaded: false, reason: `strata_error:${state.error}` };
  const modelIds = Array.isArray(state.model_ids) ? state.model_ids : null;
  if (modelIds === null) {
    return { ok: false, loaded: null, unloaded: false, reason: "models_unavailable" };
  }
  // 真实语义（cp3b smoke 校准）：/v1/models 列出**可用**模型，不等于已加载；
  // `/api/models` 的 loaded=null 才是「未加载」。加载态 loaded 是 provider 原生字段，
  // current 可能是内部 model id，不能当作「已加载 iq3_s」的替代证据。
  const loadedFacts = state.loaded ?? null;
  const loaded =
    loadedFacts === null
      ? false
      : !(Array.isArray(loadedFacts) && loadedFacts.length === 0);
  const single = modelIds.length === 0 || (modelIds.length === 1 && modelIds[0] === model);
  // 卸载核验以 `/api/models.loaded=null` 为准（cp3b smoke 实测：真实卸载后 /v1/models
  // 仍会列出可用模型 iq3_s，模型目录 ≠ 已加载）。/v1/models 列表只作为观测事实记录。
  const unloaded = loaded === false;
  if (!single) {
    return {
      ok: false,
      loaded,
      unloaded: false,
      reason: `strata_single_slot_violation:${modelIds.join(",")}`,
      model_ids: modelIds,
      loaded_state: loadedFacts,
    };
  }
  return {
    ok: true,
    loaded,
    unloaded,
    reason: null,
    model_ids: modelIds,
    loaded_state: loadedFacts,
    current: state.current ?? null,
    mode: state.mode ?? null,
  };
}

export async function readStrataState({ endpoint = DEFAULT_STRATA_ENDPOINT, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const base = String(endpoint).replace(/\/+$/, "");
  const get = async (path) => {
    try {
      const response = await fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { ok: response.ok, status: response.status, body };
    } catch (error) {
      return { ok: false, status: null, body: null, error: error.message };
    }
  };
  const [models, api] = await Promise.all([get("/v1/models"), get("/api/models")]);
  return parseStrataState({ models, api });
}

// 批次结束/失败/中断统一卸载：先 POST unload，再重读状态核验 loaded=null。
export async function unloadStrata({ endpoint = DEFAULT_STRATA_ENDPOINT, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const base = String(endpoint).replace(/\/+$/, "");
  let unload = { ok: false, status: null, error: "not_attempted" };
  try {
    const response = await fetchImpl(`${base}/api/models/unload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    });
    unload = { ok: response.ok, status: response.status, error: null };
  } catch (error) {
    unload = { ok: false, status: null, error: error.message };
  }
  const state = await readStrataState({ endpoint, fetchImpl, timeoutMs });
  const slot = strataSlotCheck(state);
  return { unload, state, slot };
}

// 生命周期记录：loaded_before / loaded_after / unloaded 只由真实读取决定；
// error 如实保留，不把读取失败当作“已卸载”。
export function strataLifecycleRecord({ before, after, unload, model = DEFAULT_STRATA_MODEL } = {}) {
  const beforeSlot = strataSlotCheck(before, { model });
  const afterSlot = strataSlotCheck(after, { model });
  return {
    schema: STRATA_SLOT_SCHEMA,
    model,
    loaded_before: beforeSlot.loaded ?? null,
    loaded_after: afterSlot.loaded ?? null,
    unloaded: afterSlot.unloaded === true,
    before: { slot: beforeSlot, state: before ?? null },
    after: { slot: afterSlot, state: after ?? null },
    unload: unload ?? null,
    checked_at: new Date().toISOString(),
  };
}
