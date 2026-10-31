// VS00G 菜单观察证据：只证明观察完成，不签业务或产品验收。
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertCommonEvidence, read, writeNativeSummary } from "./lib/native_ui/scenario_evidence.mjs";

export function verify(dir) {
  const config = read(dir, "native-vs00g-config.json");
  const report = read(dir, "native-vs00g-observation.json");
  const { ready, ui, ledger } = assertCommonEvidence(dir, {
    sliceId: "vs00g-trigger-c",
    minScreenshots: 1,
    minimumWaits: 3,
    requiredKinds: ["maintenance"],
  });
  assert.equal(report.scope, "observation_only");
  assert.equal(report.business_actions_executed, false);
  assert.equal(report.switch_error, null);
  assert(Array.isArray(report.wire_since_menu.author_actions));
  const menuEvents = report.log.filter((event) => String(event.op).startsWith("work_menu_"));
  assert(menuEvents.some((event) => event.op === "work_menu_open"), "缺点击返回证据");
  assert(menuEvents.some((event) => event.op === "work_menu_after_dump"), "缺菜单 AX 投影证据");
  const checks = {
    real_tauri_window_launched: ui.driver === "ax-native-system-ui" && ready.browser_driver_started === false,
    click_result_recorded: menuEvents.some((event) => event.op === "work_menu_open" && event.click),
    menu_projection_recorded: menuEvents.some((event) => event.op === "work_menu_after_dump"),
    no_business_actions: report.business_actions_executed === false && report.wire_since_menu.author_actions.length === 0,
    observation_only_not_cp_pass: report.scope === "observation_only",
    wait_ledger_complete: ledger.waits >= 3,
  };
  const summary = writeNativeSummary(dir, {
    sliceId: "vs00g-trigger-c",
    checks,
    scope: "observation_only",
    measured: { target_work_id: config.dismiss.work_id, scope: "observation_only", surface: "tauri" },
    extra: {
      pass_scope: "observation_only",
      full_matrix_established: false,
      behavior: { name: "work_menu_root_cause_observation_only", assertions: Object.keys(checks).filter((key) => checks[key]) },
      known_limits: ["只证明菜单根因观察完成，不证明 CP1 业务闭环，也不证明产品缺陷存在或不存在"],
    },
  });
  assert.equal(summary.all_checks_passed, true, `观察证据不全: ${JSON.stringify(checks)}`);
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
