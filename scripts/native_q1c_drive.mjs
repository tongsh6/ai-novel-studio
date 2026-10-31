// Q1c 原生页面补验外部驱动：真实 Tauri 窗口（嵌入前端 + 真实 Phoenix + slice_verify）。
//
// 与 browser canonical driver 同义路径：发送源设定原文 → 采纳为已保存设定 →
// 发送修订（年龄 25→30）→ 采纳修订（覆盖确认）→ 追问年龄 → 断言读到新值。
// 通过 macOS AX/CGEvent 操作真实窗口；证据由 native_q1c_evidence.mjs 只读核验。
// 产品代码不读取本文件；输入与文案为用户真实语义（见 Q1c 文档 S1 输入清单）。
//
// 用法：node scripts/native_q1c_drive.mjs <batch-run-dir>
import path from "node:path";
import { readJson } from "./lib/native_ui/driver.mjs";
import {
  actionMatchesArtifact,
  isOverwriteConfirmation,
} from "./lib/native_ui/adoption_contract.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_q1c_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_q1c_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

const findByTitle = (nodes, title) =>
  harness.findButton(nodes, title) ??
  nodes.find(
    (candidate) =>
      (candidate.role === "AXButton" || candidate.role === "AXStaticText") &&
      (candidate.title === title || candidate.value === title),
  );

const clickByTitle = (title, label) => {
  const node = findByTitle(harness.dumpNodes(), title);
  if (!node) return false;
  harness.safeClick(node, label);
  return true;
};

const wireFrames = (wire, direction, event) =>
  wire.filter((record) => {
    const frame = Array.isArray(record.frame) ? record.frame : null;
    return record.direction === direction && frame?.[3] === event;
  });

const pendingOf = (turnResult) =>
  (turnResult?.adoption_state?.pending ?? []).find(
    (entry) =>
      entry.artifact_type === "memory_item" ||
      entry.artifact_type === "world_setting" ||
      entry.artifact_type === "character_profile" ||
      Boolean(entry.artifact_type),
  );

async function sendMessage(text, label) {
  const sent = await harness.runStep("input", `${label}_send`, () =>
    harness.rawTypeAndSend(text, label),
  );
  await harness.runStep("ack", `${label}_ack`, () =>
    harness.pollWire((records) => harness.ackFor(records, sent), 30_000, `${label}_ack`),
  );
  return sent;
}

async function waitPending(turnId, label) {
  return harness.runStep("turn", label, () =>
    harness.pollWire(
      (records) =>
        wireFrames(records, "received", "turn_result").find((record) => {
          const body = frameBody(record);
          return body.turn_id === turnId && (body.adoption_state?.pending ?? []).length > 0;
        }) ?? null,
      120_000,
      label,
    ),
  );
}

async function acceptPending(pending, label) {
  const artifactId = pending?.artifact_id;
  if (!artifactId) throw new Error(`${label}_pending_artifact_missing`);
  const acceptLabel = pending.artifact_type === "world_setting" ? "保存到作品档案" : "保存到作品";
  await harness.runStep("candidate", `${label}_accept_visible`, () =>
    harness.pollAx(
      (_text, nodes) => Boolean(findByTitle(nodes, acceptLabel) || findByTitle(nodes, "保存到作品")),
      45_000,
      `${label}_accept_visible`,
    ),
  );
  return harness.runStep("adoption", `${label}_accept`, async () => {
    const startedAt = harness.nowIso();
    const clicked =
      clickByTitle(acceptLabel, `${label}_accept`) || clickByTitle("保存到作品", `${label}_accept`);
    if (!clicked) throw new Error(`${label}_accept_button_missing:${acceptLabel}`);
    const actionSent = await harness.pollWire(
      (records) =>
        wireFrames(records, "sent", "author_action").find((record) => {
          const body = frameBody(record);
          return record.at >= startedAt && body.action?.target_ref === artifactId;
        }) ?? null,
      30_000,
      `${label}_author_action_sent`,
    );
    const actionId = frameBody(actionSent)?.action?.action_id ?? null;
    return harness.pollWire(
      (records) =>
        wireFrames(records, "received", "action_result").find((record) => {
          const body = frameBody(record);
          return (
            record.at >= actionSent.at &&
            actionMatchesArtifact(body, artifactId, actionId) &&
            (body.status === "accepted" || isOverwriteConfirmation(body))
          );
        }) ?? null,
      60_000,
      `${label}_action_result`,
    );
  });
}

async function confirmIfRequired(actionResult, captureName) {
  if (!isOverwriteConfirmation(frameBody(actionResult))) return false;
  await harness.runStep("adoption", "confirm_overwrite", async () => {
    await harness.pollAx(
      (_text, nodes) => Boolean(findByTitle(nodes, "确认执行")),
      30_000,
      "confirm_overwrite_visible",
    );
    harness.capture(captureName);
    if (!clickByTitle("确认执行", "confirm_overwrite")) {
      throw new Error("confirm_button_missing");
    }
    return true;
  });
  return true;
}

async function waitAdopted(artifactId, label) {
  return harness.runStep("ack", label, () =>
    harness.pollWire(
      (records) =>
        wireFrames(records, "received", "turn_result").find((record) => {
          const body = frameBody(record);
          return (
            body.truthfulness?.artifact_adopted === true &&
            (body.adoption_state?.resolved ?? []).some((entry) => entry.artifact_id === artifactId)
          );
        }) ?? null,
      120_000,
      label,
    ),
  );
}

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-q1c-config.json"));

  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () =>
    harness.rawWaitWorkbenchSettled("initial"),
  );
  await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, "initial");
  harness.capture("00-workbench");
  runEvidenceMode(EVIDENCE, "capture", dir, ["start"]);

  const sourceSent = await sendMessage(config.messages.source, "source");
  const sourceTurnId = String(frameBody(sourceSent)?.turn_id ?? "");
  const sourcePendingRecord = await waitPending(sourceTurnId, "source_pending");
  const sourcePending = pendingOf(frameBody(sourcePendingRecord));
  harness.capture("01-source-pending");
  await acceptPending(sourcePending, "source");
  const sourceAdopted = await waitAdopted(sourcePending?.artifact_id, "source_adopted");
  harness.capture("02-source-adopted");

  const revisionSent = await sendMessage(config.messages.revision, "revision");
  const revisionTurnId = String(frameBody(revisionSent)?.turn_id ?? "");
  const revisionPendingRecord = await waitPending(revisionTurnId, "revision_pending");
  const revisionPending = pendingOf(frameBody(revisionPendingRecord));
  harness.capture("03-revision-pending");
  const actionResult = await acceptPending(revisionPending, "revision");
  const confirmationRequired = await confirmIfRequired(actionResult, "03b-revision-confirmation");
  const revisionAdopted = await waitAdopted(revisionPending?.artifact_id, "revision_adopted");
  harness.capture("04-revision-adopted");

  await harness.runStep("restore", "close_relaunch_after_revision", () =>
    harness.rawCloseAppAndRelaunch(),
  );
  await harness.runStep("maintenance", "workbench_ready:final", () =>
    harness.rawWaitWorkbenchSettled("final"),
  );
  await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, "final");
  harness.capture("04b-restarted");

  const followupSent = await sendMessage(config.messages.followup, "followup");
  const followupTurnId = String(frameBody(followupSent)?.turn_id ?? "");
  const followupRecord = await harness.runStep("turn", "followup_turn_result", () =>
    harness.pollWire(
      (records) =>
        wireFrames(records, "received", "turn_result").find((record) => {
          const body = frameBody(record);
          return body.turn_id === followupTurnId && body.assistant_message != null;
        }) ?? null,
      120_000,
      "followup_turn_result",
    ),
  );
  await harness.runStep("maintenance", "followup_new_value_visible", () =>
    harness.pollAx(
      (text) => text.includes(config.expected.new_age),
      45_000,
      "followup_new_value_visible",
    ),
  );
  harness.capture("05-followup");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);

  harness.writeDriverLog("native-q1c-report.json", {
    slice_id: config.slice_id,
    audit: "q1c-adopted-content-revision-native",
    generated_at: new Date().toISOString(),
    provider: config.provider,
    nonce: config.nonce,
    source: { turn_id: sourceTurnId, adopted_turn: frameBody(sourceAdopted)?.turn_id ?? null },
    revision: {
      turn_id: revisionTurnId,
      adopted_turn: frameBody(revisionAdopted)?.turn_id ?? null,
      confirmation_required: confirmationRequired,
    },
    followup: {
      turn_id: followupTurnId,
      assistant_message: frameBody(followupRecord)?.assistant_message?.text ?? null,
      new_value_visible: true,
    },
  });
  harness.writeUiComplete(config.slice_id);
  console.log(
    `Q1c 原生驱动完成: work=${config.target.work_id} source=${sourceTurnId} ` +
      `revision=${revisionTurnId} followup=${followupTurnId} screenshots=${harness.screenshots.length}`,
  );
}

run().catch((error) => harness.fail(error));
