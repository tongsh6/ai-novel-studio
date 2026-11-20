// 原生工作台证据边界：AX 文本投影与本批完成文件的唯一生产入口。
import path from "node:path";
import { jsonWrite, textOf } from "./driver.mjs";

export function flatText(nodes) {
  return nodes.map(textOf).filter(Boolean).join("\n");
}

// target 由调用方的现有输入归属链绑定；完成文件只保留原件，不替代目标校验。
export function writeUiComplete(
  batchDir,
  { target, runRef, screenshots, driver = "ax-native-system-ui", scope },
) {
  jsonWrite(path.join(batchDir, "native-ui-complete.json"), {
    harness_run_ref: runRef,
    driver,
    app_bundle: target.bundle_identifier,
    input_target: target,
    screenshots,
    scope,
  });
}
