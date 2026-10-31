// Q1c 原生页面补验外部驱动：真实 Tauri 窗口（嵌入前端 + 真实 Phoenix + slice_verify）。
//
// 与 browser canonical driver 同义路径：发送源设定原文 → 采纳为已保存设定 →
// 发送修订（年龄 25→30）→ 采纳修订（覆盖确认）→ 追问年龄 → 断言读到新值。
// 通过 macOS AX/CGEvent 操作真实窗口；证据由 native_q1c_evidence.mjs 只读核验。
// 产品代码不读取本文件；输入与文案为用户真实语义（见 Q1c 文档 S1 输入清单）。
//
// 用法：node scripts/native_q1c_drive.mjs <batch-run-dir>
import path from "node:path";
import { readJson, sleep } from "./lib/native_ui/driver.mjs";
import { NativeScenarioHarness, ROOT, ensureWorkSelected, frameBody } from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_q1c_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const harness = new NativeScenarioHarness(dir);
const nonce = `Q1CNATIVE${Date.now()}`;

const SOURCE_TEXT = `岑舟今年二十五岁，是青云宗宗主，掌管东洲灵脉。资料校验标识${nonce}。`;
const SOURCE_MESSAGE = `请把以下原文登记为作品设定，不要改写：${SOURCE_TEXT}`;
const REVISION_MESSAGE = `请把已保存的设定里岑舟的年龄从二十五岁改成三十岁，其他内容保持不变。资料校验标识${nonce}。`;
const FOLLOWUP_MESSAGE = "岑舟今年多少岁？请依据当前已保存的作品设定回答。";

const clickByTitle = (title, label) => {
  const nodes = harness.dumpNodes();
  const button = harness.findButton(nodes, title);
  if (button) {
    harness.safeClick(button, label);
    return true;
  }
  const node = nodes.find(
    (candidate) =>
      (candidate.role === "AXButton" || candidate.role === "AXStaticText") &&
      (candidate.title === title || candidate.value === title),
  );
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
    (entry) => entry.artifact_type === "memory_item" || entry.artifact_type === "world_setting" || entry.artifact_type,
  );

async function sendMessage(text, label) {
  return harness.runStep("input", `${label}_send`, () => harness.rawTypeAndSend(text, label));
}

async function waitPending(turnId, label) {
  return harness.pollWire(
    (records) =>
      wireFrames(records, "received", "turn_result").find((record) => {
        const body = frameBody(record);
        return body.turn_id === turnId && (body.adoption_state?.pending ?? []).length > 0;
      }) ?? null,
    120_000,
    label,
  );
}

async function acceptPending(pending, label) {
  const acceptLabel = pending?.artifact_type === "world_setting" ? "保存到作品档案" : "保存到作品";
  await harness.runStep("adoption", `${label}_accept`, () => {
    const clicked =
      clickByTitle(acceptLabel, `${label}_accept`) || clickByTitle("保存到作品", `${label}_accept`);
    if (!clicked) throw new Error(`${label}_accept_button_missing:${acceptLabel}`);
    return true;
  });
  return harness.pollWire(
    (records) => {
      const action = wireFrames(records, "received", "action_result").find(
        (record) => frameBody(record).status === "accepted" || frameBody(record).status === "requires_confirmation",
      );
      return action ?? null;
    },
    60_000,
    `${label}_action_result`,
  );
}

async function confirmIfRequired(actionResult) {
  const body = frameBody(actionResult);
  if (body?.status !== "requires_confirmation" && body?.decision_type !== "require_confirmation") {
    return false;
  }
  await harness.runStep("adoption", "confirm_overwrite", () => {
    if (!clickByTitle("确认执行", "confirm_overwrite")) {
      throw new Error("confirm_button_missing");
    }
    return true;
  });
  return true;
}

async function waitAdopted(artifactId, label) {
  return harness.pollWire(
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
  );
}

async function run() {
  const configPath = path.join(dir, "native-q1c-config.json");
  let config = {};
  try {
    config = readJson(configPath);
  } catch {
    config = {};
  }

  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () =>
    harness.rawWaitWorkbenchSettled("initial"),
  );
  if (config.target?.work_id) {
    await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, "initial");
  }
  harness.capture("00-workbench");

  // 1. 源设定：登记原文 → pending → 采纳 → adopted。
  const sourceSent = await sendMessage(SOURCE_MESSAGE, "source");
  const sourceTurnId = String(frameBody(sourceSent)?.turn_id ?? "");
  const sourcePendingRecord = await waitPending(sourceTurnId, "source_pending");
  const sourcePending = pendingOf(frameBody(sourcePendingRecord));
  harness.capture("01-source-pending");
  await acceptPending(sourcePending, "source");
  const sourceAdopted = await waitAdopted(sourcePending?.artifact_id, "source_adopted");
  harness.capture("02-source-adopted");

  // 2. 修订：年龄 25→30 → pending（revision_of）→ 采纳 → 覆盖确认 → adopted。
  const revisionSent = await sendMessage(REVISION_MESSAGE, "revision");
  const revisionTurnId = String(frameBody(revisionSent)?.turn_id ?? "");
  const revisionPendingRecord = await waitPending(revisionTurnId, "revision_pending");
  const revisionPending = pendingOf(frameBody(revisionPendingRecord));
  harness.capture("03-revision-pending");
  const actionResult = await acceptPending(revisionPending, "revision");
  await confirmIfRequired(actionResult);
  const revisionAdopted = await waitAdopted(revisionPending?.artifact_id, "revision_adopted");
  harness.capture("04-revision-adopted");

  // 3. 追问：页面必须读到新值（30 岁）而非旧值。
  const followupSent = await sendMessage(FOLLOWUP_MESSAGE, "followup");
  const followupTurnId = String(frameBody(followupSent)?.turn_id ?? "");
  const followupRecord = await harness.pollWire(
    (records) =>
      wireFrames(records, "received", "turn_result").find((record) => {
        const body = frameBody(record);
        return body.turn_id === followupTurnId && body.assistant_message != null;
      }) ?? null,
    120_000,
    "followup_turn_result",
  );
  harness.capture("05-followup");
  await harness.runStep("maintenance", "followup_new_value_visible", () =>
    harness.pollAx((text) => text.includes("三十岁"), 45_000, "followup_new_value_visible"),
  );

  const report = {
    audit: "q1c-adopted-content-revision-native",
    generated_at: new Date().toISOString(),
    provider: "slice_verify",
    nonce,
    source: { turn_id: sourceTurnId, adopted_turn: frameBody(sourceAdopted)?.turn_id ?? null },
    revision: {
      turn_id: revisionTurnId,
      adopted_turn: frameBody(revisionAdopted)?.turn_id ?? null,
      confirmation_required: frameBody(actionResult)?.status === "requires_confirmation",
    },
    followup: {
      turn_id: followupTurnId,
      assistant_message: frameBody(followupRecord)?.assistant_message?.text ?? null,
      new_value_visible: true,
    },
  };
  const reportPath = path.join(dir, "native-q1c-report.json");
  await import("node:fs").then((fs) => fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`));
  await sleep(1_000);
}

run().catch((error) => {
  console.error(`[q1c-drive] error: ${error?.stack ?? error}`);
  try {
    harness.capture("99-error");
  } catch {
    /* ignore */
  }
  process.exit(1);
});
