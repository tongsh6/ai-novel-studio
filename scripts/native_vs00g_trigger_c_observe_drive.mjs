// VS00G 作品菜单根因观察：不重启、不执行业务动作，保存点击/焦点/AX/传输事实。
import path from "node:path";
import { appPid, frontmost, readJson } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_vs00g_trigger_c_observe_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_vs00g_trigger_c_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

function wireSummary(records) {
  const events = {};
  const http = [];
  const authorActions = [];
  for (const record of records) {
    const event = record.frame?.[3];
    if (event) events[event] = (events[event] ?? 0) + 1;
    if (record.direction === "http") {
      http.push({ at: record.at, method: record.method, path: record.path ?? record.url, status: record.status });
    }
    if (record.direction === "sent" && event === "author_action") authorActions.push(record.frame?.[4]);
  }
  return { events, http, author_actions: authorActions };
}

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-vs00g-config.json"));
  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready", () => harness.rawWaitWorkbenchSettled("observe"));
  const wireStart = harness.transport().length;
  let switchError = null;
  await harness.runStep("maintenance", "activate_and_open_work_menu", async () => {
    harness.log.push({
      op: "before_activate",
      at: harness.nowIso(),
      app_pid: appPid(harness.APP),
      frontmost: frontmost(),
      target_work_title: config.dismiss.work_title,
    });
    const { activate } = await import("./lib/native_ui/driver.mjs");
    activate(harness.APP);
    harness.log.push({ op: "after_activate", at: harness.nowIso(), frontmost: frontmost() });
    try {
      await harness.rawSwitchWork(config.dismiss.work_title, "observe");
    } catch (error) {
      switchError = error.message;
      harness.log.push({ op: "work_switch_error", at: harness.nowIso(), error: switchError });
    }
  });
  harness.capture("01-work-menu-observation");
  const wire = wireSummary(harness.transport().slice(wireStart));
  harness.writeDriverLog("native-vs00g-observation.json", {
    slice_id: config.slice_id,
    scope: "observation_only",
    target_work_id: config.dismiss.work_id,
    target_work_title: config.dismiss.work_title,
    switch_error: switchError,
    business_actions_executed: false,
    wire_since_menu: wire,
    final_frontmost: frontmost(),
  });
  if (switchError) throw new Error(`observation_completed_with_switch_failure:${switchError}`);
  harness.writeUiComplete(config.slice_id);
  console.log(`VS00G 菜单观察完成: ${config.dismiss.work_title}`);
}

run().catch((error) => harness.fail(error));
