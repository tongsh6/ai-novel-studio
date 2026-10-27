// B62 CP1/CP2 原生验收外部驱动：B40 CP3 家族 6 个 tauri 场景（聊天族 4 + au02 + agent-step-regate）。
//
// 用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生窗口 + 真实 Phoenix 后端 + 嵌入真实前端）：
// 打开工作台 → 选中场景作品 → 在可见输入框按场景话术发送 → 等真实 WS/HTTP 帧与可见回复/候选卡/
// 「为什么」面板 → 采集 AX 树 + 可见文本 + 窗口截图。证据由 scripts/native_b40_family_evidence.mjs
// 只读核验；本驱动不写任何断言结论，也不采纳任何候选。
// 产品代码不读取本文件；驱动只用用户可见语义（窗口标题/按钮文案/输入框/AX 可见文本）。
//
// 用法：node scripts/native_b40_family_drive.mjs <batch-run-dir>
import path from "node:path";
import { pressKey, readJson, sleep, typeText } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b40_family_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_b40_family_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

// 判断纪元普通聊天在确定性 provider 下约 300ms 完成；活动条只在运行窗口内渲染。
// 文案来自产品 copy（正在推理…/正在执行… 等），且完成后不应残留。
const AX_ACTIVITY =
  /当前创作请求的工作过程|创作执行|思考中|正在推理|正在执行|正在起草|正在查阅|正在生成|AI 正在/;

const sentCount = (wire) =>
  wire.filter(
    (entry) => entry.direction === "sent" && Array.isArray(entry.frame) && entry.frame[3] === "user_message",
  ).length;

// 可见消息气泡：真实窗口里 user/assistant 每条消息各带一行角色标签（「你」/「AI」）。
const bubbleCounts = (text) => {
  const lines = String(text ?? "").split("\n").map((line) => line.trim());
  return {
    user: lines.filter((line) => line === "你").length,
    assistant: lines.filter((line) => line === "AI").length,
  };
};

// 取回复最后一段的尾部作为可见锚点：Markdown 分段后单个节点内仍包含该段落尾部，
// 避免因换行渲染差异把「整段字节匹配」误判成不可见。
const replyAnchor = (assistantText) => {
  const text = String(assistantText ?? "").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  return last.length >= 8 ? last.slice(-18) : text.slice(-12);
};

function findTurnResult(wire, turnId, predicate = () => true) {
  return (
    wire.find(
      (entry) =>
        entry.direction === "received" &&
        Array.isArray(entry.frame) &&
        entry.frame.length >= 5 &&
        entry.frame[3] === "turn_result" &&
        String(entry.frame[4]?.turn_id ?? "") === turnId &&
        predicate(entry.frame[4]),
    ) ?? null
  );
}

// 等本轮 turn_result；期间顺带观察 AgentRun 活动条是否在真实窗口出现过
// （浏览器 canonical 用 DOM 观察，这里用 AX 可见文本；只在等待窗口内如实记录，不伪造）。
async function waitTurnResult(turnId, label, { timeoutMs = 130_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let activityObserved = false;
  let activityText = "";
  while (Date.now() < deadline) {
    harness.checkSupervisor();
    const record = findTurnResult(harness.transport(), turnId);
    if (record) return { record, turnResult: frameBody(record), activityObserved, activityText };
    try {
      const text = harness.axText(harness.dumpNodes());
      if (AX_ACTIVITY.test(text)) {
        activityObserved = true;
        activityText = text.slice(-800);
      }
    } catch {
      /* window may be mid-render */
    }
    await sleep(250);
  }
  throw new Error(`wait_turn_result_timeout:${label}`);
}

async function waitVisibleReply(assistantText, label, timeoutMs = 70_000) {
  const anchor = replyAnchor(assistantText);
  if (!anchor) throw new Error(`assistant_text_missing:${label}`);
  return harness.pollAx((text) => text.includes(anchor), timeoutMs, `reply_visible:${label}`);
}

// 只输入不发送（空消息守卫需要「填了空白但发送不可用」的真实可见状态）。
async function rawTypeOnly(text, label) {
  let nodes = harness.dumpNodes();
  let composer = harness.findComposer(nodes);
  if (!composer) throw new Error("composer_not_found");
  harness.safeClick(composer, `${label}:composer`);
  await sleep(300);
  const value = String(composer.value ?? "");
  if (value !== "") {
    pressKey(harness.APP, "cmd+a");
    pressKey(harness.APP, "delete");
    await sleep(200);
  }
  typeText(harness.APP, text);
  await sleep(500);
  nodes = harness.dumpNodes();
  composer = harness.findComposer(nodes);
  if (composer && String(composer.value ?? "") !== text) {
    // CGEvent 偶发丢字：以 AX 读回的输入框值复核，必要时重打一次。
    harness.safeClick(composer, `${label}:composer-retry`);
    await sleep(200);
    pressKey(harness.APP, "cmd+a");
    pressKey(harness.APP, "delete");
    await sleep(150);
    typeText(harness.APP, text);
    await sleep(400);
    nodes = harness.dumpNodes();
  }
  return nodes;
}

function attemptClickSend(nodes) {
  const button = harness.findSendButton(nodes);
  if (!button) {
    pressKey(harness.APP, "return");
    return null;
  }
  try {
    harness.safeClick(button, "send-button-attempt");
  } catch {
    /* disabled button may reject AXPress; the attempt is the evidence */
  }
  return button;
}

// 确定性 provider 普通聊天一轮约 300ms 完成：点击发送后必须立刻采样 AX，否则运行活动条
// 会在等待 user_message/turn_result 之前消失（浏览器 canonical 用 DOM observer 捕捉）。
// 采样是只读 AX 遍历，不改变产品行为；只如实记录是否在可见文本中出现过活动文案。
async function rawTypeSendWithProbe(message, label) {
  harness.checkSupervisor();
  const startedAt = harness.nowIso();
  let nodes = harness.dumpNodes();
  let composer = harness.findComposer(nodes);
  if (!composer) throw new Error("composer_not_found");
  harness.safeClick(composer, `${label}:composer`);
  await sleep(350);
  if (String(composer.value ?? "") !== "") {
    pressKey(harness.APP, "cmd+a");
    pressKey(harness.APP, "delete");
    await sleep(200);
  }
  typeText(harness.APP, message);
  await sleep(700);
  nodes = harness.dumpNodes();
  composer = harness.findComposer(nodes);
  const typedValue = String(composer?.value ?? "");
  if (typedValue.trim() !== "" && !typedValue.includes(message.slice(0, 3))) {
    // CGEvent 偶发丢字：以 AX 读回的输入框值复核，必要时重打一次。
    harness.safeClick(composer, `${label}:composer-retry`);
    await sleep(250);
    pressKey(harness.APP, "cmd+a");
    pressKey(harness.APP, "delete");
    await sleep(200);
    typeText(harness.APP, message);
    await sleep(600);
    nodes = harness.dumpNodes();
  }
  const button = harness.findSendButton(nodes);
  if (button) harness.safeClick(button, `${label}:send`);
  else pressKey(harness.APP, "return");

  let activityObserved = false;
  let activityText = "";
  const probes = [];
  for (let attempt = 0; attempt < 4 && !activityObserved; attempt += 1) {
    try {
      const text = harness.axText(harness.dumpNodes());
      probes.push({ at: harness.nowIso(), chars: text.length });
      if (AX_ACTIVITY.test(text)) {
        activityObserved = true;
        activityText = text.slice(-1200);
      }
    } catch {
      probes.push({ at: harness.nowIso(), error: "dump_failed" });
    }
  }
  let sent = await harness.tryPollWire(
    (wire) => harness.sentUserMessageSince(wire, startedAt, message),
    8_000,
  );
  if (!sent) {
    await sleep(400);
    const retryButton = harness.findSendButton(harness.dumpNodes());
    if (retryButton) harness.safeClick(retryButton, `${label}:send-retry`);
    else pressKey(harness.APP, "return");
    sent = await harness.pollWire(
      (wire) => harness.sentUserMessageSince(wire, startedAt, message),
      10_000,
      `${label}:user_message_sent`,
    );
  }
  return { sent, activityObserved, activityText, probes };
}

async function sendAndAwaitTurn(message, label, { observeActivity = false } = {}) {
  await harness.runStep("maintenance", `input_ready:${label}`, () =>
    harness.rawWaitInputReady(label),
  );
  const typed = await harness.runStep("input", `type_send:${label}`, () =>
    observeActivity
      ? rawTypeSendWithProbe(message, label)
      : harness.rawTypeAndSend(message, label),
  );
  const sent = observeActivity ? typed.sent : typed;
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  if (!turnId) throw new Error(`user_message_without_turn_id:${label}`);
  if (String(frameBody(sent)?.text ?? "") !== message) {
    throw new Error(`user_message_text_mismatch:${label}`);
  }
  await harness.runStep("ack", `ack:${label}`, () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, `ack:${label}`),
  );
  const observed = await harness.runStep("turn", `turn_result:${label}`, () =>
    waitTurnResult(turnId, label),
  );
  return {
    sent,
    turnId,
    turnResult: observed.turnResult,
    activityObserved: observeActivity ? typed.activityObserved : observed.activityObserved,
    activityText: observeActivity ? typed.activityText : observed.activityText,
    activityProbes: observeActivity ? typed.probes : [],
  };
}

async function bootstrap(config) {
  const sliceId = config.slice_id;
  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () =>
    harness.rawWaitWorkbenchSettled("initial"),
  );
  await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, "initial");
  harness.capture("01-workbench");
  runEvidenceMode(EVIDENCE, "capture", dir, ["start"]);
  return sliceId;
}

function baseDriverLog(config, extra) {
  return {
    slice_id: config.slice_id,
    provider: harness.provider,
    work_id: config.target.work_id,
    work_title: config.target.work_title,
    session_id: config.target.session_id ?? null,
    ...extra,
  };
}

// ── CP1 聊天族：普通聊天两轮（au01-ordinary-chat / pr-smoke-core-reply）────────────
async function flowOrdinaryChat(config) {
  await bootstrap(config);
  const turns = [];
  for (let index = 0; index < config.messages.length; index += 1) {
    const label = `turn${index + 1}`;
    const message = config.messages[index];
    const sent = await sendAndAwaitTurn(message, label, { observeActivity: true });
    const assistantText = String(sent.turnResult?.assistant_message?.text ?? "");
    await harness.runStep("maintenance", `reply_visible:${label}`, () =>
      waitVisibleReply(assistantText, label),
    );
    harness.capture(index === 0 ? "02-turn1" : "03-turn2");
    turns.push({
      message,
      turn_id: sent.turnId,
      assistant_text: assistantText,
      activity_observed: sent.activityObserved,
      activity_text: sent.activityText,
      activity_probes: sent.activityProbes,
    });
  }
  harness.capture("04-final");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);
  harness.writeDriverLog(
    "native-b40-driver-log.json",
    baseDriverLog(config, {
      scenario: config.scenario,
      turns,
      sent_user_message_frames: sentCount(harness.transport()),
    }),
  );
  harness.writeUiComplete(config.slice_id);
  console.log(
    `B40 家族原生驱动完成: slice=${config.slice_id} turns=${turns.length} ` +
      `screenshots=${harness.screenshots.length}`,
  );
}

// ── CP1 空消息守卫：空白输入发送不可用 → 后续正常轮可发 ─────────────────────────────
async function flowEmptyMessageGuard(config) {
  await bootstrap(config);
  await harness.runStep("maintenance", "input_ready:blank", () =>
    harness.rawWaitInputReady("blank"),
  );
  const beforeNodes = harness.dumpNodes();
  const beforeText = harness.axText(beforeNodes);
  const beforeCounts = bubbleCounts(beforeText);
  const beforeSent = sentCount(harness.transport());

  const typedNodes = await harness.runStep("input", "blank_input", () =>
    rawTypeOnly(config.blank_text, "blank"),
  );
  const sendButton = harness.findSendButton(typedNodes);
  const sendButtonEnabled = sendButton ? sendButton.enabled : null;
  const sendButtonDisabled = sendButtonEnabled === false;
  attemptClickSend(typedNodes);
  await sleep(1_500);

  const afterNodes = harness.dumpNodes();
  const afterText = harness.axText(afterNodes);
  const afterCounts = bubbleCounts(afterText);
  const afterSent = sentCount(harness.transport());
  harness.capture("02-blank");

  // 恢复：清空 composer 后正常发送（发送可用性由真实发送成功证明）。
  const recovery = await sendAndAwaitTurn(config.recovery_message, "recovery", {
    observeActivity: true,
  });
  const recoveryAssistant = String(recovery.turnResult?.assistant_message?.text ?? "");
  await harness.runStep("maintenance", "reply_visible:recovery", () =>
    waitVisibleReply(recoveryAssistant, "recovery"),
  );
  harness.capture("03-recovery");
  harness.capture("04-final");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);
  harness.writeDriverLog(
    "native-b40-driver-log.json",
    baseDriverLog(config, {
      scenario: config.scenario,
      blank: {
        text: config.blank_text,
        send_button_enabled: sendButtonEnabled,
        send_button_disabled: sendButtonDisabled,
        user_message_frames_added: afterSent - beforeSent,
        user_bubbles_before: beforeCounts.user,
        user_bubbles_after: afterCounts.user,
        assistant_bubbles_before: beforeCounts.assistant,
        assistant_bubbles_after: afterCounts.assistant,
        thinking_visible_after_blank: afterText.includes("思考中"),
      },
      recovery_turn_id: recovery.turnId,
      recovery_assistant_text: recoveryAssistant,
      activity_observed: recovery.activityObserved,
    }),
  );
  harness.writeUiComplete(config.slice_id);
  console.log(
    `B40 家族原生驱动完成: slice=${config.slice_id} blank_disabled=${sendButtonDisabled} ` +
      `blank_frames=${afterSent - beforeSent} recovery=${recovery.turnId}`,
  );
}

// ── CP1 frame 校验友好错误：协议损坏安全失败 → 后续正常轮完成 ────────────────────────
async function flowFrameValidation(config) {
  await bootstrap(config);
  const invalid = await sendAndAwaitTurn(config.invalid_message, "invalid");
  const fallbackText = String(invalid.turnResult?.assistant_message?.text ?? "");
  await harness.runStep("maintenance", "fallback_visible", () =>
    harness.pollAx(
      (text) => text.includes("重试") && text.includes("校验"),
      70_000,
      "fallback_visible",
    ),
  );
  harness.capture("02-fallback");

  const recovery = await sendAndAwaitTurn(config.recovery_message, "recovery", {
    observeActivity: true,
  });
  const recoveryAssistant = String(recovery.turnResult?.assistant_message?.text ?? "");
  await harness.runStep("maintenance", "reply_visible:recovery", () =>
    waitVisibleReply(recoveryAssistant, "recovery"),
  );
  harness.capture("03-recovery");
  harness.capture("04-final");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);
  harness.writeDriverLog(
    "native-b40-driver-log.json",
    baseDriverLog(config, {
      scenario: config.scenario,
      invalid_turn_id: invalid.turnId,
      invalid_status: invalid.turnResult?.status ?? null,
      fallback_text: fallbackText,
      recovery_turn_id: recovery.turnId,
      recovery_assistant_text: recoveryAssistant,
      activity_observed: recovery.activityObserved,
    }),
  );
  harness.writeUiComplete(config.slice_id);
  console.log(
    `B40 家族原生驱动完成: slice=${config.slice_id} invalid=${invalid.turnId} ` +
      `recovery=${recovery.turnId}`,
  );
}

// ── CP2 au02 自然探索：模糊输入 → creative_exploration 候选卡渲染 → 无 slot 表单 ────
async function flowNaturalExploration(config) {
  await bootstrap(config);
  const turn = await sendAndAwaitTurn(config.message, "explore");
  const candidateDirections = Array.isArray(turn.turnResult?.candidate_directions)
    ? turn.turnResult.candidate_directions
    : [];
  if (candidateDirections.length === 0) throw new Error("candidate_directions_missing");
  const assistantText = String(turn.turnResult?.assistant_message?.text ?? "");
  const firstCandidateTitle = String(candidateDirections[0]?.title ?? "");
  await harness.runStep("maintenance", "candidate_visible", () =>
    harness.pollAx(
      (text) => text.includes(firstCandidateTitle) && text.includes(replyAnchor(assistantText)),
      70_000,
      "candidate_visible",
    ),
  );
  harness.capture("02-candidates");
  harness.capture("03-final");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);
  harness.writeDriverLog(
    "native-b40-driver-log.json",
    baseDriverLog(config, {
      scenario: config.scenario,
      turn_id: turn.turnId,
      assistant_text: assistantText,
      candidate_titles: candidateDirections.map((item) => String(item?.title ?? "")),
      candidate_pitches: candidateDirections.map((item) => String(item?.pitch ?? "")),
      activity_observed: turn.activityObserved,
    }),
  );
  harness.writeUiComplete(config.slice_id);
  console.log(
    `B40 家族原生驱动完成: slice=${config.slice_id} turn=${turn.turnId} ` +
      `candidates=${candidateDirections.length}`,
  );
}

// ── CP2 agent-step-regate：bounded AgentRun 多步 re-gate + author-safe why ───────────
async function flowAgentStepRegate(config) {
  await bootstrap(config);
  await harness.runStep("maintenance", "input_ready:run", () =>
    harness.rawWaitInputReady("run"),
  );
  const sent = await harness.runStep("input", "type_send:run", () =>
    harness.rawTypeAndSend(config.message, "run"),
  );
  const sentBody = frameBody(sent);
  await harness.runStep("ack", "ack:run", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, "ack:run"),
  );
  const ackRecord = await harness.pollWire(
    (wire) => harness.ackFor(wire, sent),
    5_000,
    "ack:run:replay",
  );
  const ackBody = frameBody(ackRecord);
  const runId = String(ackBody?.response?.run_id ?? "");
  if (!runId) throw new Error("bounded_run_id_missing");

  // 第一步：真实只读 character_roster 工具步 turn_result 广播。
  const rosterRecord = await harness.runStep("turn", "roster_step", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            Array.isArray(entry.frame) &&
            entry.frame.length >= 5 &&
            entry.frame[3] === "turn_result" &&
            entry.frame[4]?.tool_result?.tool_name === "character_roster" &&
            entry.frame[4]?.tool_result?.status === "succeeded",
        ) ?? null,
      130_000,
      "roster_step",
    ),
  );
  const rosterTurn = frameBody(rosterRecord);
  const rosterReply = String(rosterTurn?.assistant_message?.text ?? "");
  await harness.runStep("maintenance", "roster_reply_visible", () =>
    waitVisibleReply(rosterReply, "roster"),
  );
  harness.capture("02-roster-step");

  // 第二步：character_design 最终 TurnResult（bounded run 终态 + 待采纳候选）。
  const finalRecord = await harness.runStep("turn", "character_design_step", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            Array.isArray(entry.frame) &&
            entry.frame.length >= 5 &&
            entry.frame[3] === "turn_result" &&
            entry.frame[4]?.agent_run?.run_id === runId &&
            entry.frame[4]?.tool_result?.tool_name === "character_design" &&
            entry.frame[4]?.tool_result?.status === "succeeded",
        ) ?? null,
      130_000,
      "character_design_step",
    ),
  );
  const finalTurn = frameBody(finalRecord);
  await harness.runStep("turn", "run_completed_state", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            Array.isArray(entry.frame) &&
            entry.frame.length >= 5 &&
            entry.frame[3] === "agent_run_state" &&
            entry.frame[4]?.run_id === runId &&
            entry.frame[4]?.status === "completed",
        ) ?? null,
      90_000,
      "run_completed_state",
    ),
  );
  const pendingArtifact = finalTurn?.adoption_state?.pending?.[0] ?? null;
  const candidateTitle = String(pendingArtifact?.payload?.items?.[0]?.title ?? "");
  if (!candidateTitle) throw new Error("pending_candidate_title_missing");
  await harness.runStep("maintenance", "candidate_visible", () =>
    harness.pollAx((text) => text.includes(candidateTitle), 70_000, "candidate_visible"),
  );
  harness.capture("03-final");

  // author-safe「为什么」：工具决定 + 回放不重新调用模型 + 无 raw/gate 文本。
  const why = await harness.runStep("maintenance", "why_open", () => harness.rawOpenWhy("final"));
  harness.capture("04-why");
  await sleep(400);
  try {
    pressKey(harness.APP, "escape");
  } catch {
    /* dialog may already be closed */
  }
  await sleep(600);
  harness.capture("05-final-after-why");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);
  harness.writeDriverLog(
    "native-b40-driver-log.json",
    baseDriverLog(config, {
      scenario: config.scenario,
      message: config.message,
      parent_turn_id: String(sentBody?.turn_id ?? ""),
      run_id: runId,
      run_mode: String(ackBody?.response?.run_mode ?? ""),
      roster_turn_id: String(rosterTurn?.turn_id ?? ""),
      roster_reply: rosterReply,
      final_turn_id: String(finalTurn?.turn_id ?? ""),
      candidate_title: candidateTitle,
      final_assistant_text: String(finalTurn?.assistant_message?.text ?? ""),
      why_text: why.afterText,
      why_visible_after_click: why.afterText.includes("参考来源"),
    }),
  );
  harness.writeUiComplete(config.slice_id);
  console.log(
    `B40 家族原生驱动完成: slice=${config.slice_id} run=${runId} ` +
      `final_turn=${finalTurn?.turn_id} screenshots=${harness.screenshots.length}`,
  );
}

const FLOWS = {
  ordinary_chat_two_turn: flowOrdinaryChat,
  empty_message_guard: flowEmptyMessageGuard,
  frame_validation_friendly_error: flowFrameValidation,
  natural_exploration: flowNaturalExploration,
  agent_step_regate: flowAgentStepRegate,
};

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-b40-config.json"));
  const flow = FLOWS[config.scenario];
  if (!flow) throw new Error(`unknown_scenario:${config.scenario}`);
  await flow(config);
}

run().catch((error) => harness.fail(error));
