// B61 CP1 原生验收外部驱动：AU11×2（质量诊断普通回复来源/覆盖、缺 WorkState 诚实不编造）。
//
// 用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生窗口 + 真实 Phoenix 后端 + 嵌入真实前端）：
// 打开工作台 → 选中场景作品 → 在可见输入框发送场景用户话术 → 等回复可见 → 点击「为什么」
// → 读可见文本。证据由 scripts/native_au11_evidence.mjs 只读核验；本驱动不写任何断言结论。
// 产品代码不读取本文件；驱动只用用户可见语义（窗口标题/按钮文案/输入框/AX 可见文本）。
// 用法：node scripts/native_au11_drive.mjs <batch-run-dir>
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pressKey, readJson, sleep } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_au11_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_au11_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-au11-config.json"));
  const sliceId = config.slice_id;
  const quality = config.scenario === "quality_diagnosis";

  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () =>
    harness.rawWaitWorkbenchSettled("initial"),
  );
  await ensureWorkSelected(
    harness,
    config.target.work_id,
    config.target.work_title,
    "initial",
  );
  harness.capture("01-workbench");
  runEvidenceMode(EVIDENCE, "capture", dir, ["start"]);

  await harness.runStep("maintenance", "input_ready", () => harness.rawWaitInputReady("turn"));
  const sent = await harness.runStep("input", "type_send", () =>
    harness.rawTypeAndSend(config.message_text, "turn"),
  );
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  if (!turnId) throw new Error("user_message_without_turn_id");
  await harness.runStep("ack", "ack", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, "ack"),
  );
  const resultRecord = await harness.runStep("turn", "turn_result", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            Array.isArray(entry.frame) &&
            entry.frame.length >= 5 &&
            entry.frame[3] === "turn_result" &&
            String(entry.frame[4]?.turn_id ?? "") === turnId &&
            entry.frame[4]?.trace_summary != null,
        ) ?? null,
      110_000,
      "turn_result",
    ),
  );
  const turnResult = frameBody(resultRecord);
  const assistantText = String(turnResult?.assistant_message?.text ?? "");

  // 等真实窗口渲染出本轮 AI 回复（用户可见语义；质量诊断要求具体取舍三要素，
  // 缺 WorkState 要求索要目标章材料且不宣称已读）。
  const replyVisible = (text) =>
    quality
      ? text.includes("阻力") && text.includes("代价") && text.includes("读者回报")
      : text.includes("缺少当前章节摘要或正文");
  await harness.runStep("maintenance", "reply_visible", () =>
    harness.pollAx(replyVisible, 60_000, "reply_visible"),
  );
  harness.capture("02-reply");

  // 点击该条 AI 回复上的「为什么」：可见作者安全决策溯源面板。
  const why = await harness.runStep("maintenance", "why_open", () => harness.rawOpenWhy("turn"));
  harness.capture("03-why");
  await sleep(400);
  try {
    pressKey(harness.APP, "escape");
  } catch {
    /* dialog may already be closed */
  }
  await sleep(700);
  harness.capture("04-final");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);

  harness.writeDriverLog("native-au11-driver-log.json", {
    slice_id: sliceId,
    provider: harness.provider,
    scenario: config.scenario,
    work_id: config.target.work_id,
    session_id: config.target.session_id,
    message_text: config.message_text,
    turn_id: turnId,
    assistant_text: assistantText,
    why_text: why.afterText,
    why_visible_after_click: why.afterText.includes("参考来源"),
  });
  harness.writeUiComplete(sliceId);
  console.log(
    `AU11 原生驱动完成: slice=${sliceId} scenario=${config.scenario} turn_id=${turnId} ` +
      `screenshots=${harness.screenshots.length}`,
  );
}

run().catch((error) => harness.fail(error));
