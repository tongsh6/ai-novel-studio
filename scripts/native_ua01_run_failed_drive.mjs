// UA01-LOG 最终 run_failed 原生触发：真实工作台 + 既有 SliceVerify failure marker。
import path from "node:path";
import { readJson } from "./lib/native_ui/driver.mjs";
import { turnMatchesMessage } from "./lib/native_ui/adoption_contract.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_ua01_run_failed_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_ua01_run_failed_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-ua01-config.json"));
  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () =>
    harness.rawWaitWorkbenchSettled("initial"),
  );
  await ensureWorkSelected(harness, config.target.work_title, "initial");

  const text = "请根据已采纳章节计划生成第01章：底层灵气账单的正文草稿。UA01PROVIDERFAIL";
  const sent = await harness.runStep("input", "failure_send", () => harness.rawTypeAndSend(text, "failure"));
  await harness.runStep("ack", "failure_ack", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 30_000, "failure_ack"),
  );
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  const failed = await harness.runStep("turn", "final_run_failed", () =>
    harness.pollWire(
      (wire) =>
        wire.find((record) => {
          if (record.direction !== "received" || record.frame?.[3] !== "turn_result") return false;
          const body = frameBody(record);
          return (
            turnMatchesMessage(body, turnId) &&
            body.trace_summary?.decision_type === "run_failed" &&
            body.agent_run?.status === "failed" &&
            body.status === "failed_recoverable"
          );
        }) ?? null,
      120_000,
      "final_run_failed",
    ),
  );
  const runId = frameBody(failed)?.agent_run?.run_id;
  if (!runId) throw new Error("run_failed_missing_run_id");
  await harness.runStep("maintenance", "failure_visible", () =>
    harness.pollAx(
      (text) =>
        text.includes("无法连接到创作引擎") &&
        text.includes("没有创建待采纳内容") &&
        !text.includes("raw provider failure payload"),
      60_000,
      "failure_visible",
    ),
  );
  harness.capture("01-run-failed");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);

  harness.writeDriverLog("native-ua01-report.json", {
    slice_id: config.slice_id,
    provider: config.provider,
    source_turn_id: turnId,
    run_id: runId,
    failure_turn_id: frameBody(failed)?.turn_id ?? null,
    author_safe_failure: true,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(`UA01 原生 run_failed 完成: work=${config.target.work_id} turn=${turnId} run=${runId}`);
}

run().catch((error) => harness.fail(error));
