// VS00G 输入路径观察证据：不签业务验收。
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertCommonEvidence, read, writeNativeSummary } from "./lib/native_ui/scenario_evidence.mjs";

export function verify(dir) {
  const report = read(dir, "native-vs00g-input-path.json");
  const methods = (process.env.VS00G_INPUT_METHODS ?? "axshowmenu,cgevent").split(",");
  const { ready, ui, ledger } = assertCommonEvidence(dir, {
    sliceId: "vs00g-trigger-c",
    minScreenshots: methods.length,
    minimumWaits: 2 + methods.length,
    requiredKinds: ["maintenance"],
  });
  assert.equal(report.scope, "input_path_observation");
  assert.equal(report.business_actions_executed, false);
  const attempts = report.log.filter((event) => event.op === "input_path_attempt");
  assert.deepEqual(attempts.map((event) => event.method), methods);
  assert(attempts.every((event) => event.frontmost?.bundle_identifier), "frontmost 证据缺失");
  assert(attempts.every((event) => event.click), "点击返回缺失");
  assert(attempts.every((event) => event.main && event.all), "AX 投影证据缺失");
  const successful = report.successful_methods;
  assert(successful.length >= 1, "没有成功输入路径，不得写观察 summary");
  const checks = {
    real_tauri_window_launched: ui.driver === "ax-native-system-ui" && ready.browser_driver_started === false,
    input_paths_attempted_once: attempts.length === methods.length,
    frontmost_and_click_recorded: attempts.every((event) => event.frontmost?.bundle_identifier && event.click),
    target_menu_path_proven: successful.length >= 1,
    no_business_action: report.business_actions_executed === false,
    wait_ledger_complete: ledger.waits >= 2 + methods.length && ui.screenshots.length >= methods.length,
  };
  const summary = writeNativeSummary(dir, {
    sliceId: "vs00g-trigger-c",
    checks,
    scope: "input_path_observation",
    measured: { successful_methods: successful, surface: "tauri" },
    extra: {
      pass_scope: "input_path_observation",
      full_matrix_established: false,
      behavior: { name: "axshowmenu_vs_cgevent_input_path_observation", assertions: Object.keys(checks).filter((key) => checks[key]) },
      known_limits: ["只证明菜单输入路径，不证明作品切换或 CP1 业务闭环；未执行作者动作"],
    },
  });
  assert.equal(summary.all_checks_passed, true, `输入路径观察失败: ${JSON.stringify(checks)}`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verify(path.resolve(process.argv[3] ?? process.argv[2] ?? ""));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
