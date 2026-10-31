// VS00G 输入路径对照：AXShowMenu 与 CGEvent 各一次，只打开菜单，不选择作品。
import path from "node:path";
import { click, clickAt, dumpAll, frontmost, readJson, textOf } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_vs00g_trigger_c_input_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_vs00g_trigger_c_evidence.mjs");
const harness = new NativeScenarioHarness(dir);
const { pressKey, sleep } = await import("./lib/native_ui/driver.mjs");
const methods = (process.env.VS00G_INPUT_METHODS ?? "axshowmenu,cgevent").split(",");
if (methods.length > 2 || new Set(methods).size !== methods.length || methods.some((method) => !["axshowmenu", "cgevent"].includes(method))) {
  throw new Error(`invalid_input_methods:${methods.join(",")}`);
}

function targetState(nodes, title) {
  const matches = nodes.filter((node) => textOf(node).includes(title));
  return {
    menu_count: nodes.filter((node) => node.role === "AXMenu").length,
    menu_item_count: nodes.filter((node) => node.role === "AXMenuItem").length,
    target_present: matches.some((node) => ["AXMenuItem", "AXButton", "AXRow", "AXLink"].includes(node.role)),
    target_matches: matches.map((node) => ({ role: node.role, path: node.path, text: textOf(node), frame: node.frame })),
  };
}

async function openWith(method, trigger, title) {
  const result = method === "axshowmenu"
    ? click(trigger, harness.APP, "AXShowMenu")
    : clickAt(harness.APP, trigger.frame[0] + trigger.frame[2] / 2, trigger.frame[1] + trigger.frame[3] / 2);
  await sleep(800);
  const main = targetState(harness.dumpNodes(), title);
  let all;
  try {
    all = targetState(dumpAll(harness.APP, 16_000), title);
  } catch (error) {
    all = { error: error.message };
  }
  harness.log.push({ op: "input_path_attempt", method, at: harness.nowIso(), click: result, main, all, frontmost: frontmost() });
  const success = main.target_present || all.target_present === true;
  harness.capture(`0${method === "axshowmenu" ? "1" : "2"}-${method}-menu`);
  await pressKey(harness.APP, "escape");
  await sleep(300);
  return success;
}

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-vs00g-config.json"));
  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready", () => harness.rawWaitWorkbenchSettled("input"));
  const wireStart = harness.transport().length;
  const outcomes = [];
  for (const method of methods) {
    await harness.runStep("maintenance", `open_menu:${method}`, async () => {
      const trigger = harness.dumpNodes().find((node) => node.role === "AXPopUpButton" && String(node.desc ?? "") === "作品");
      if (!trigger) throw new Error("work_menu_trigger_not_found");
      const success = await openWith(method, trigger, config.dismiss.work_title);
      outcomes.push({ method, success });
    });
  }
  const wire = harness.transport().slice(wireStart).map((record) => ({ direction: record.direction, event: record.frame?.[3], method: record.method, path: record.path }));
  const successful = outcomes.filter((outcome) => outcome.success).map((outcome) => outcome.method);
  harness.writeDriverLog("native-vs00g-input-path.json", {
    slice_id: config.slice_id,
    scope: "input_path_observation",
    target_work_title: config.dismiss.work_title,
    outcomes,
    successful_methods: successful,
    business_actions_executed: false,
    wire_since_menu: wire,
  });
  if (successful.length === 0) throw new Error("all_input_paths_failed_to_open_target_menu");
  harness.writeUiComplete(config.slice_id);
  console.log(`VS00G 输入对照完成: ${successful.join(",")}`);
}

run().catch((error) => harness.fail(error));
