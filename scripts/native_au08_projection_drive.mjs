// AU08 原生阅读投影故障恢复：真实 Tauri + 外部 channel error，产品无验收感知。
import fs from "node:fs";
import path from "node:path";
import { readJson } from "./lib/native_ui/driver.mjs";
import { actionMatchesArtifact, turnMatchesMessage } from "./lib/native_ui/adoption_contract.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_au08_projection_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_au08_projection_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

const frames = (wire, direction, event) =>
  wire.filter((record) => record.direction === direction && record.frame?.[3] === event);

function click(title, label) {
  const nodes = harness.dumpNodes();
  const button = harness.findButton(nodes, title);
  if (!button) throw new Error(`button_not_found:${label}:${title}`);
  harness.safeClick(button, label);
}

async function sendSource() {
  const text = "请根据已采纳章节计划生成第01章：底层灵气账单的正文草稿。";
  const sent = await harness.runStep("input", "source_send", () => harness.rawTypeAndSend(text, "source"));
  await harness.runStep("ack", "source_ack", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 30_000, "source_ack"),
  );
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  const pendingRecord = await harness.runStep("turn", "source_pending", () =>
    harness.pollWire(
      (wire) =>
        frames(wire, "received", "turn_result").find((record) => {
          const body = frameBody(record);
          return (
            turnMatchesMessage(body, turnId) &&
            (body.adoption_state?.pending ?? []).some((entry) => entry.artifact_type === "prose_fragment")
          );
        }) ?? null,
      120_000,
      "source_pending",
    ),
  );
  return { turnId, pendingRecord };
}

async function adoptPending(pending) {
  const artifactId = pending?.artifact_id;
  if (!artifactId) throw new Error("source_prose_artifact_missing");
  await harness.runStep("candidate", "source_accept_visible", () =>
    harness.pollAx(
      (_text, nodes) => Boolean(harness.findButton(nodes, "保存为章节正文")),
      120_000,
      "source_accept_visible",
    ),
  );
  await harness.runStep("adoption", "source_accept", async () => {
    const startedAt = harness.nowIso();
    click("保存为章节正文", "source_accept");
    const actionSent = await harness.pollWire(
      (wire) =>
        frames(wire, "sent", "author_action").find(
          (record) => record.at >= startedAt && frameBody(record).action?.target_ref === artifactId,
        ) ?? null,
      30_000,
      "source_author_action",
    );
    const actionId = frameBody(actionSent)?.action?.action_id ?? null;
    return harness.pollWire(
      (wire) =>
        frames(wire, "received", "action_result").find((record) => {
          const body = frameBody(record);
          return (
            record.at >= actionSent.at &&
            actionMatchesArtifact(body, artifactId, actionId) &&
            body.status === "accepted"
          );
        }) ?? null,
      90_000,
      "source_action_result",
    );
  });
  return harness.runStep("ack", "source_adopted", () =>
    harness.pollWire(
      (wire) =>
        frames(wire, "received", "turn_result").find((record) => {
          const body = frameBody(record);
          return (
            body.truthfulness?.artifact_adopted === true &&
            (body.adoption_state?.resolved ?? []).some((entry) => entry.artifact_id === artifactId)
          );
        }) ?? null,
      120_000,
      "source_adopted",
    ),
  );
}

function probeOf(pending) {
  const body = String(pending?.payload?.items?.[0]?.body ?? "");
  const line = body.split("\n").map((value) => value.trim()).find((value) => value.length >= 8);
  if (!line) throw new Error("source_prose_probe_missing");
  return line.slice(0, 24);
}

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-au08-config.json"));
  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () =>
    harness.rawWaitWorkbenchSettled("initial"),
  );
  await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, "initial");

  const { turnId, pendingRecord } = await sendSource();
  const pending = (frameBody(pendingRecord).adoption_state?.pending ?? []).find(
    (entry) => entry.artifact_type === "prose_fragment",
  );
  const probe = probeOf(pending);
  const adoptedRecord = await adoptPending(pending);
  harness.capture("00-source-adopted");
  runEvidenceMode(EVIDENCE, "capture", dir, ["after_adoption"]);

  await harness.runStep("maintenance", "reading_open", async () => {
    click("阅读", "reading_open");
    return harness.pollAx(
      (text) =>
        text.includes("阅读模式") &&
        text.includes("投影状态：已过期") &&
        text.includes("刷新投影") &&
        text.includes(probe),
      90_000,
      "reading_stale_visible",
    );
  });
  harness.capture("01-reading-stale");

  fs.writeFileSync(
    path.join(dir, "transport-control.json"),
    JSON.stringify({ channel_faults: { get_chapter_content: { mode: "error", count: 1 } } }),
  );
  await harness.runStep("maintenance", "reading_refresh_error", async () => {
    click("刷新投影", "reading_refresh_error");
    return harness.pollAx(
      (text) =>
        text.includes("投影状态：重建失败") &&
        text.includes("未能完整读取最新章节，请重试。正文没有被改动。") &&
        text.includes("重试") &&
        !text.includes(probe),
      90_000,
      "reading_failed_visible",
    );
  });
  harness.capture("02-reading-failed");

  await harness.runStep("maintenance", "reading_retry_recovered", async () => {
    click("重试", "reading_retry_recovered");
    return harness.pollAx(
      (text) =>
        text.includes("阅读模式") &&
        text.includes(probe) &&
        !text.includes("投影状态：重建失败"),
      90_000,
      "reading_retry_recovered",
    );
  });
  harness.capture("03-reading-recovered");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);

  harness.writeDriverLog("native-au08-report.json", {
    slice_id: config.slice_id,
    provider: config.provider,
    source_turn_id: turnId,
    adopted_turn_id: frameBody(adoptedRecord)?.turn_id ?? null,
    chapter_probe: probe,
    fault: { event: "get_chapter_content", mode: "error", count: 1 },
    failed_visible: true,
    recovered_visible: true,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(`AU08 原生阅读故障恢复完成: work=${config.target.work_id} turn=${turnId}`);
}

run().catch((error) => harness.fail(error));
