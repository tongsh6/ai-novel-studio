// VS00G scoped 启动诊断：只验证真实窗口激活与作品选择，不执行业务动作。
import path from "node:path";
import { activate, readJson } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_vs00g_trigger_c_startup_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_vs00g_trigger_c_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-vs00g-config.json"));
  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready", () => harness.rawWaitWorkbenchSettled("startup"));
  await harness.runStep("maintenance", "activate_before_work_menu", async () => {
    activate(harness.APP);
  });
  await ensureWorkSelected(harness, config.dismiss.work_id, config.dismiss.work_title, "startup");
  const selected = await harness.runStep("maintenance", "selected_work_visible", () =>
    harness.pollAx(
      (_text, nodes) => harness.visibleWorkTitle(nodes) === config.dismiss.work_title,
      30_000,
      "selected_work_visible",
    ),
  );
  if (!selected) throw new Error("selected_work_not_visible");
  harness.capture("01-startup-work-selected");
  harness.writeDriverLog("native-vs00g-startup-report.json", {
    slice_id: config.slice_id,
    scope: "precondition_only",
    selected_work_id: config.dismiss.work_id,
    selected_work_title: config.dismiss.work_title,
    business_actions_executed: false,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(`VS00G 启动诊断通过: ${config.dismiss.work_title}`);
}

run().catch((error) => harness.fail(error));
