// scoped 启动诊断证据：只证明作品选择前置，不证明 CP1 业务闭环。
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  assertCommonEvidence,
  axText,
  read,
  writeNativeSummary,
} from "./lib/native_ui/scenario_evidence.mjs";

export function verify(dir) {
  const config = read(dir, "native-vs00g-config.json");
  const report = read(dir, "native-vs00g-startup-report.json");
  const { ready, ui, ledger } = assertCommonEvidence(dir, {
    sliceId: "vs00g-trigger-c",
    minScreenshots: 1,
    minimumWaits: 3,
    requiredKinds: ["maintenance"],
  });
  assert.equal(report.scope, "precondition_only");
  assert.equal(report.business_actions_executed, false);
  const visible = axText(dir, "01-startup-work-selected").includes(config.dismiss.work_title);
  const checks = {
    real_tauri_window_launched: ui.driver === "ax-native-system-ui" && ready.browser_driver_started === false,
    target_work_selected: visible && report.selected_work_id === config.dismiss.work_id,
    diagnostic_not_business_acceptance: report.business_actions_executed === false,
    wait_ledger_complete: ledger.waits >= 3,
  };
  const summary = writeNativeSummary(dir, {
    sliceId: "vs00g-trigger-c",
    checks,
    scope: "precondition_only",
    measured: { selected_work_id: config.dismiss.work_id, business_actions_executed: false, surface: "tauri" },
    extra: {
      pass_scope: "precondition_only",
      full_matrix_established: false,
      behavior: { name: "native_startup_work_selection_only", assertions: Object.keys(checks).filter((key) => checks[key]) },
      known_limits: ["只证明窗口激活与作品选择；不证明 R5 提议、关闭、去重或显式盘点业务闭环"],
    },
  });
  assert.equal(summary.all_checks_passed, true, `启动诊断失败: ${JSON.stringify(checks)}`);
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
