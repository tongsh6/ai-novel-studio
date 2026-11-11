// AU12 A 原生验收外部驱动：真实 Tauri 窗口（嵌入前端 + 真实 Phoenix + slice_verify provider）。
//
// 通过 macOS AX/CGEvent 操作真实窗口，路径与浏览器 canonical driver 同义：
// 打开工作台 → 选中作品 → 打开档案/概览 → 点击「提出立项修订」→ pending 候选
// → 点击「采纳为全书规划」→ works.main_goal 回写 → 概览显示新值。
// 证据由 scripts/native_au12_evidence.mjs 只读核验；产品代码不读取本文件。
// 用法：node scripts/native_au12_drive.mjs <batch-run-dir>
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sleep, pressKey } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_au12_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_au12_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

const clickByTitle = (title, label) => {
  const nodes = harness.dumpNodes();
  const button = harness.findButton(nodes, title);
  if (button) {
    harness.safeClick(button, label);
    return true;
  }
  const node = nodes.find((candidate) =>
    (candidate.role === "AXButton" || candidate.role === "AXStaticText") &&
    (candidate.title === title || candidate.value === title));
  if (!node) return false;
  harness.safeClick(node, label);
  return true;
};

const openArchiveOverview = async (label) => {
  const opened = await harness.runStep("maintenance", `open_archive:${label}`, async () => {
    if (!clickByTitle("打开档案", `open_archive:${label}`)) {
      throw new Error(`open_archive_button_missing:${label}`);
    }
    return harness.pollAx(
      (text) => text.includes("立项设定") && text.includes("概览"),
      30_000,
      `archive_open:${label}`,
    );
  });
  await harness.runStep("maintenance", `overview_tab:${label}`, async () => {
    clickByTitle("概览", `overview_tab:${label}`);
    return harness.pollAx((text) => text.includes("立项设定"), 20_000, `overview:${label}`);
  });
  return opened;
};

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-au12-config.json"));

  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () =>
    harness.rawWaitWorkbenchSettled("initial"),
  );
  await ensureWorkSelected(harness, config.target.work_title, "initial");
  harness.capture("01-workbench");
  runEvidenceMode(EVIDENCE, "capture", dir, ["start"]);

  await openArchiveOverview("initial");

  // 点击可见的「提出立项修订」；真实 user_message 必须携带 generate_micro_plan。
  const sent = await harness.runStep("input", "revise_from_overview", async () => {
    if (!clickByTitle("提出立项修订", "revise_button")) {
      throw new Error("profile_revise_button_missing");
    }
    return harness.pollWire(
      (wire) =>
        wire.find((record) => {
          const frame = Array.isArray(record.frame) ? record.frame : null;
          const body = frame?.[4] ?? {};
          return record.direction === "sent" && frame?.[3] === "user_message" &&
            body.work_id === config.target.work_id &&
            body.text === config.user_text && body.generate_micro_plan === true;
        }) ?? null,
      30_000,
      "profile_revise_user_message",
    );
  });
  const sentBody = frameBody(sent);
  const turnRecord = await harness.runStep("turn", "pending_candidate", () =>
    harness.pollWire(
      (wire) =>
        wire.find((record) => {
          const frame = Array.isArray(record.frame) ? record.frame : null;
          const body = frame?.[4] ?? {};
          return record.direction === "received" && frame?.[3] === "turn_result" &&
            body.turn_id === sentBody.turn_id &&
            (body.adoption_state?.pending ?? []).some(
              (entry) => entry.artifact_type === "work_skeleton_suggestion",
            );
        }) ?? null,
      120_000,
      "pending_candidate",
    ),
  );
  const pendingTurn = frameBody(turnRecord);
  const pending = (pendingTurn.adoption_state?.pending ?? []).find(
    (entry) => entry.artifact_type === "work_skeleton_suggestion");
  const item = pending?.payload?.items?.[0] ?? pending?.items?.[0] ?? null;
  await harness.runStep("maintenance", "pending_visible", () =>
    harness.pollAx(
      (text) => text.includes("全书规划建议") && text.includes("采纳为全书规划"),
      60_000,
      "pending_visible",
    ),
  );
  harness.capture("02-pending");

  // 真实作者动作：采纳为全书规划 → action_result accepted → artifact_adopted turn。
  await harness.runStep("adoption", "accept_profile_revision", async () => {
    if (!clickByTitle("采纳为全书规划", "accept_revision")) {
      throw new Error("accept_profile_revision_button_missing");
    }
    return harness.pollWire(
      (wire) =>
        wire.find((record) => {
          const frame = Array.isArray(record.frame) ? record.frame : null;
          const body = frame?.[4] ?? {};
          return record.direction === "received" && frame?.[3] === "action_result" &&
            body.status === "accepted" && body.action_type === "adopt";
        }) ?? null,
      60_000,
      "accept_action_result",
    );
  });
  const adopted = await harness.runStep("ack", "adoption_turn_result", () =>
    harness.pollWire(
      (wire) =>
        wire.find((record) => {
          const frame = Array.isArray(record.frame) ? record.frame : null;
          const body = frame?.[4] ?? {};
          return record.direction === "received" && frame?.[3] === "turn_result" &&
            body.truthfulness?.artifact_adopted === true;
        }) ?? null,
      120_000,
      "adoption_turn_result",
    ),
  );

  // 关闭档案再重新打开概览，确认作者可见值同源更新。
  await harness.runStep("maintenance", "close_archive", async () => {
    clickByTitle("关闭档案", "close_archive");
    await sleep(500);
    try { pressKey(harness.APP, "escape"); } catch { /* no dialog */ }
    return true;
  });
  await openArchiveOverview("after_adoption");
  await harness.runStep("maintenance", "adopted_value_visible", () =>
    harness.pollAx((text) => text.includes(config.expected.value), 45_000, "adopted_value_visible"),
  );
  harness.capture("03-adopted-overview");

  // 采纳后真实新请求：模型上下文必须消费新的 works.main_goal（不是只写库）。
  await harness.runStep("maintenance", "close_archive_after_read", async () => {
    clickByTitle("关闭档案", "close_archive_after_read");
    await sleep(500);
    await harness.pollAx((text) => text.includes("发送"), 20_000, "workbench_after_read");
    return true;
  });
  const followupSent = await harness.runStep("input", "followup_after_adoption", () =>
    harness.rawTypeAndSend("请围绕刚刚修订的主线目标，继续推进下一段冲突。", "followup"),
  );
  const followupTurnId = String(frameBody(followupSent)?.turn_id ?? "");
  const followupTurn = await harness.runStep("turn", "followup_turn_result", () =>
    harness.pollWire(
      (wire) =>
        wire.find((record) => {
          const frame = Array.isArray(record.frame) ? record.frame : null;
          const body = frame?.[4] ?? {};
          return record.direction === "received" && frame?.[3] === "turn_result" &&
            body.turn_id === followupTurnId && body.assistant_message != null;
        }) ?? null,
      120_000,
      "followup_turn_result",
    ),
  );
  harness.capture("04-followup");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);

  const adoptedBody = frameBody(adopted);
  harness.writeDriverLog("native-au12-driver-log.json", {
    slice_id: config.slice_id,
    provider: harness.provider,
    work_id: config.target.work_id,
    work_title: config.target.work_title,
    user_message_turn_id: sentBody.turn_id,
    pending_turn_id: pendingTurn.turn_id,
    adopted_turn_id: adoptedBody.turn_id,
    followup_turn_id: followupTurnId,
    followup_turn_id_echo: frameBody(followupTurn)?.turn_id,
    pending_field: item?.skeleton_field,
    pending_value: item?.skeleton_value,
    adopted_value_visible: true,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(
    `AU12 原生驱动完成: work=${config.target.work_id} turn=${sentBody.turn_id} ` +
      `adopted_turn=${adoptedBody.turn_id} followup_turn=${followupTurnId} ` +
      `screenshots=${harness.screenshots.length}`,
  );
}

run().catch((error) => harness.fail(error));
