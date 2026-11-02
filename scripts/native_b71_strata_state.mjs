// B71 CP3b 实模批次前后 Strata 单槽状态 CLI（只读/卸载核验，供 batch 入口调用）。
// 用法：node scripts/native_b71_strata_state.mjs [--unload] [--endpoint URL]
import {
  DEFAULT_STRATA_ENDPOINT,
  readStrataState,
  strataSlotCheck,
  unloadStrata,
} from "./lib/native_ui/strata_lifecycle.mjs";

const args = process.argv.slice(2);
const unload = args.includes("--unload");
const endpointIndex = args.indexOf("--endpoint");
// 允许传 .../v1（产品侧常见形式），统一剥掉 /v1 后缀，避免拼成 /v1/v1/models。
const endpoint = String(
  endpointIndex >= 0 ? args[endpointIndex + 1] : process.env.NOVEL_STRATA_ENDPOINT ?? DEFAULT_STRATA_ENDPOINT,
)
  .replace(/\/v1\/?$/u, "")
  .replace(/\/+$/u, "");

if (unload) {
  const result = await unloadStrata({ endpoint });
  console.log(JSON.stringify({ at: new Date().toISOString(), endpoint, unload: result.unload, state: result.state, slot: result.slot }));
} else {
  const state = await readStrataState({ endpoint });
  console.log(JSON.stringify({ at: new Date().toISOString(), endpoint, state, slot: strataSlotCheck(state) }));
}
