// B71 原生外部驱动：真实窗口中请求全章核对，不写验收结论、不执行作品写入。
import path from "node:path";
import { readJson, textOf } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  frameEvent,
  runEvidenceMode,
  turnIdMatches,
} from "./lib/native_ui/scenario_driver.mjs";
import { broadcastFrames, frameOf } from "./lib/native_ui/scenario_evidence.mjs";
import {
  actionResultFor,
  authorActionAck,
  chapterDraftTarget,
  isSourceGenerationMessage,
  revisionActionFrame,
} from "./lib/native_ui/authoring_revision_evidence.mjs";
import { drivePending } from "./lib/native_ui/authoring_pending_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b71_drive.mjs <batch-run-dir>");
  process.exit(64);
}

const evidence = path.join(ROOT, "scripts/native_b71_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

async function run() {
  runEvidenceMode(evidence, "prepare", dir);
  const config = readJson(path.join(dir, "native-b71-config.json"));
  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready", () =>
    harness.rawWaitWorkbenchSettled("b71"),
  );
  await ensureWorkSelected(harness, config.target.work_title, "b71");
  harness.capture("01-workbench");
  // start 快照由公共 run 在作品选定后、首轮业务动作前唯一负责；各 journey 只消费该基线。
  runEvidenceMode(evidence, "capture", dir, ["start"]);

  await harness.runStep("maintenance", "input_ready", () => harness.rawWaitInputReady("b71"));
  // B71 R2 后续 checkpoint：确定性流式替身（显式注入）经真实 OpenAI-compatible
  // SSE 发送写作正文；独立 journey 在 run 生成过程中从真实窗口 AX 采样
  // 「正文生成中」预览，再等待真实 turn_result（不读产品内部状态）。
  if (harness.provider === "streaming_slice_verify") return await driveStreamPreview(config);

  const journey = { continuation: driveContinuation, "character-design": driveCharacterDesign, planning: drivePlanning, revision: driveRevision, pending: drivePendingJourney }[config.journey];
  if (journey) return await journey(config);

  const sent = await harness.runStep("input", "whole_chapter_review", () =>
    harness.rawTypeAndSend(config.message, "b71"),
  );
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  if (!turnId) throw new Error("user_message_without_turn_id");

  await harness.runStep("ack", "user_message_ack", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, "b71:ack"),
  );

  const result = await harness.runStep("turn", "full_chapter_reply", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            frameEvent(entry) === "turn_result" &&
            turnIdMatches(String(frameBody(entry)?.turn_id ?? ""), turnId),
        ) ?? null,
      90_000,
      "b71:turn_result",
    ),
  );

  await harness.runStep("maintenance", "reply_visible", () =>
    harness.pollAx((text) => text.includes("井底浮现第七枚手印"), 45_000, "b71:reply"),
  );
  harness.capture("02-final");
  runEvidenceMode(evidence, "capture", dir, ["final"]);
  harness.writeDriverLog("native-b71-driver-log.json", {
    slice_id: config.slice_id,
    provider: harness.provider,
    turn_id: turnId,
    assistant_text: String(frameBody(result)?.assistant_message?.text ?? ""),
  });
  harness.writeUiComplete(config.slice_id);
  console.log(`B71 原生驱动完成: turn=${turnId} screenshots=${harness.screenshots.length}`);
}

async function sendBoundedRun(config) {
  const sent = await harness.runStep("input", "prose_draft", () =>
    harness.rawTypeAndSend(config.message, "b71"),
  );
  const parentTurnId = String(frameBody(sent)?.turn_id ?? "");
  const ack = await harness.runStep("ack", "bounded_run_ack", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, "b71:ack"),
  );
  const runId = String(frameBody(ack)?.response?.run_id ?? "");
  if (!parentTurnId || !runId) throw new Error("bounded_run_identity_missing");
  return { parentTurnId, runId };
}

function pollWriterTimeout(runId) {
  return harness.runStep("turn", "writer_timeout", () =>
    harness.pollWire(
      runWirePredicate(runId, (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            frameEvent(entry) === "agent_run_state" &&
            String(frameBody(entry)?.run_id ?? "") === runId &&
            frameBody(entry)?.status === "awaiting_author",
        ) ?? null),
      120_000,
      "b71:awaiting_author",
    ),
  );
}

async function retryTimedOutWriter(runId) {
  await pollWriterTimeout(runId);
  const awaiting = await harness.runStep("maintenance", "retry_visible", () =>
    harness.pollAx(
      (text) => text.includes("正文写作调用超时") && text.includes("先写第一场（500 字）"),
      30_000,
      "b71:retry",
    ),
  );
  harness.capture("02-awaiting");
  const retry = awaiting.nodes.find(
    (node) => node.role === "AXButton" && textOf(node) === "先写第一场（500 字）",
  );
  if (!retry) throw new Error("scoped_retry_button_missing");
  await harness.runStep("input", "scoped_retry", async () => harness.safeClick(retry, "scoped-retry"));
}

function pollRecoveredResult(runId) {
  return harness.runStep("turn", "recovered_candidate", () =>
    harness.pollWire(
      runWirePredicate(runId, (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            frameEvent(entry) === "turn_result" &&
            String(frameBody(entry)?.agent_run?.run_id ?? "") === runId &&
            frameBody(entry)?.agent_run?.status === "completed",
        ) ?? null),
      120_000,
      "b71:recovered",
    ),
  );
}

function pollRunCompleted(runId) {
  return harness.runStep("turn", "run_completed", () =>
    harness.pollWire(
      runWirePredicate(runId, (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            frameEvent(entry) === "agent_event" &&
            String(frameBody(entry)?.run_ref ?? "") === runId &&
            frameBody(entry)?.event_type === "run_completed",
        ) ?? null),
      30_000,
      "b71:completed",
    ),
  );
}

function failedRunFrame(wire, runId, scope) {
  const frames = scope
    ? broadcastFrames(wire, {
        topic: scope.topic,
        at: scope.at,
        event: "agent_event",
        runRef: runId,
      })
    : wire.filter(
        (entry) =>
          entry.direction === "received" &&
          frameEvent(entry) === "agent_event" &&
          frameBody(entry)?.run_ref === runId,
      );
  return frames.find((entry) => frameBody(entry)?.event_type === "run_failed") ?? null;
}

function runWirePredicate(runId, predicate, scope = null) {
  return (wire) => {
    const failed = failedRunFrame(wire, runId, scope);
    if (failed) throw new Error(`b71_run_failed:${frameBody(failed).reason_codes?.join(",") ?? "unknown"}`);
    return predicate(wire);
  };
}

async function awaitRecoveredCandidate(runId) {
  const result = await pollRecoveredResult(runId);
  await pollRunCompleted(runId);
  await harness.runStep("maintenance", "candidate_visible", () =>
    harness.pollAx(
      (text) => text.includes("正文草稿") && text.includes("保存为章节正文"),
      45_000,
      "b71:candidate",
    ),
  );
  return result;
}

function completeContinuation(config, parentTurnId, runId, result) {
  harness.capture("03-final");
  runEvidenceMode(evidence, "capture", dir, ["final"]);
  harness.writeDriverLog("native-b71-driver-log.json", {
    slice_id: config.slice_id,
    provider: harness.provider,
    parent_turn_id: parentTurnId,
    turn_id: String(frameBody(result)?.turn_id ?? ""),
    run_id: runId,
    assistant_text: String(frameBody(result)?.assistant_message?.text ?? ""),
  });
  harness.writeUiComplete(config.slice_id);
  console.log(`B71 原生驱动完成: run=${runId} screenshots=${harness.screenshots.length}`);
}

async function drivePendingJourney(config) {
  return drivePending(harness, config, {
    capture: (checkpoint) => runEvidenceMode(evidence, "capture", dir, [checkpoint]),
  });
}

async function driveStreamPreview(config) {
  const sent = await harness.runStep("input", "prose_draft", () =>
    harness.rawTypeAndSend(config.message, "b71"),
  );
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  if (!turnId) throw new Error("user_message_without_turn_id");

  await harness.runStep("ack", "bounded_run_ack", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, "b71:ack"),
  );

  // 生成中采样：预览容器文案只出现在真实流式正文渲染路径；正文片段断言确保
  // 渲染的是作品正文而非 JSON/协议字节/工具参数。
  await harness.runStep("turn", "prose_stream_visible", () =>
    harness.pollAx(
      (text) =>
        text.includes("正文生成中") &&
        text.includes("生成中，尚未保存为候选。") &&
        /夜色压在|灵气账单|雨幕|开场/.test(text),
      100_000,
      "b71:prose_preview",
    ),
  );
  harness.capture("02-prose-preview");

  const result = await harness.runStep("turn", "turn_result", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            frameEvent(entry) === "turn_result" &&
            turnIdMatches(String(frameBody(entry)?.turn_id ?? ""), turnId),
        ) ?? null,
      120_000,
      "b71:turn_result",
    ),
  );

  harness.capture("03-final");
  runEvidenceMode(evidence, "capture", dir, ["final"]);
  harness.writeDriverLog("native-b71-driver-log.json", {
    slice_id: config.slice_id,
    provider: harness.provider,
    turn_id: turnId,
    assistant_text: String(frameBody(result)?.assistant_message?.text ?? ""),
    preview_captured: true,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(`B71 streaming preview 驱动完成: turn=${turnId} screenshots=${harness.screenshots.length}`);
}

async function driveContinuation(config) {
  const { parentTurnId, runId } = await sendBoundedRun(config);
  await retryTimedOutWriter(runId);
  const result = await awaitRecoveredCandidate(runId);
  completeContinuation(config, parentTurnId, runId, result);
}

async function driveCharacterDesign(config) {
  const { parentTurnId, runId } = await sendBoundedRun(config);
  const result = await pollRecoveredResult(runId);
  await pollRunCompleted(runId);
  await harness.runStep("maintenance", "character_candidate_visible", () =>
    harness.pollAx(
      (text) => text.includes("角色设定草稿") && text.includes("保存所选方案到作品档案"),
      45_000,
      "b71:character-candidate",
    ),
  );
  harness.capture("03-candidate");
  await showWhyEvidence();
  completeContinuation(config, parentTurnId, runId, result);
}

async function drivePlanning(config) {
  const { parentTurnId, runId } = await sendBoundedRun(config);
  const result = await pollRecoveredResult(runId);
  await pollRunCompleted(runId);
  await harness.runStep("maintenance", "planning_candidates_visible", () =>
    harness.pollAx((text) => ["角色设定草稿", "世界设定草稿", "保存所选方案到作品档案"].every((label) => text.includes(label)),
      45_000, "b71:planning-candidates"),
  );
  harness.capture("03-candidate");
  runEvidenceMode(evidence, "capture", dir, ["before-why"]);
  await showWhyEvidence();
  runEvidenceMode(evidence, "capture", dir, ["after-why"]);
  completeContinuation(config, parentTurnId, runId, result);
}

async function showWhyEvidence() {
  const candidate = await harness.pollAx((text) => text.includes("为什么"), 15_000, "b71:why-button");
  const button = candidate.nodes.filter(
    (node) => node.role === "AXButton" && textOf(node).includes("为什么"),
  ).at(-1);
  if (!button) throw new Error("why_button_missing");
  await harness.runStep("maintenance", "open_why", () => harness.safeClick(button, "why"));
  const dialog = await harness.runStep("maintenance", "why_visible", () =>
    harness.pollAx(
      (text) => text.includes("回放只读取已保存记录，不会重新调用模型"),
      30_000,
      "b71:why-dialog",
    ),
  );
  harness.writeDriverLog("native-b71-why.json", { text: dialog.text });
}

// ── B71 质量发现局部修订：真实档案章行 → 源正文/质量卡 → 修订动作 → 子 run/Why ──
function sourceGenerationFrame(wire, identity) {
  return wire.find((entry) => isSourceGenerationMessage(entry, identity)) ?? null;
}

function actionFrameOrNull(wire, identity) {
  try {
    return revisionActionFrame(wire, identity);
  } catch (error) {
    if (String(error.message).includes("实测 0")) return null;
    throw error;
  }
}

function ackOrNull(wire, actionFrame) {
  try {
    return authorActionAck(wire, actionFrame);
  } catch (error) {
    if (String(error.message).includes("实测 0")) return null;
    throw error;
  }
}

function actionResultOrNull(wire, identity) {
  try {
    return actionResultFor(wire, identity);
  } catch (error) {
    if (String(error.message).includes("实测 0")) return null;
    throw error;
  }
}

function sourceQualityFrame(wire, sourceRunId, scope) {
  return (
    broadcastFrames(wire, {
      topic: scope.topic,
      at: scope.at,
      event: "turn_result",
      agentRunId: sourceRunId,
    }).find((entry) => {
      const body = frameBody(entry);
      return (
        body?.quality_review?.review_status === "completed" &&
        (body?.adoption_state?.pending ?? []).some(
          (artifact) => artifact?.artifact_type === "prose_fragment",
        ) &&
        (body?.available_actions ?? []).some(
          (action) => action?.action_type === "revise_from_findings",
        )
      );
    }) ?? null
  );
}

async function openArchiveOutline(harness, chapterTitle) {
  const opened = await harness.runStep("maintenance", "open_archive", async () => {
    const nodes = await harness.pollAx(
      (_text, current) =>
        current.some(
          (node) =>
            node.role === "AXButton" && (node.title === "打开档案" || node.value === "打开档案"),
        ),
      30_000,
      "b71:archive-entry",
    );
    const entry = nodes.nodes.find(
      (node) => node.role === "AXButton" && (node.title === "打开档案" || node.value === "打开档案"),
    );
    await harness.safeClick(entry, "b71:open-archive");
    return nodes;
  });
  void opened;
  const tabbed = await harness.runStep("maintenance", "archive_outline_tab", async () => {
    const nodes = await harness.pollAx(
      (_text, current) =>
        current.some(
          (node) =>
            node.role === "AXRadioButton" &&
            (node.title === "大纲与结构" || node.value === "大纲与结构"),
        ),
      30_000,
      "b71:archive-outline-tab",
    );
    const tab = nodes.nodes.find(
      (node) =>
        node.role === "AXRadioButton" &&
        (node.title === "大纲与结构" || node.value === "大纲与结构"),
    );
    await harness.safeClick(tab, "b71:archive-outline");
    return nodes;
  });
  void tabbed;
  const target = await harness.runStep("maintenance", "chapter_row_target", () =>
    harness.pollAx(
      (_text, nodes) => Boolean(chapterDraftTarget(nodes, chapterTitle)),
      45_000,
      "b71:chapter-row",
    ),
  );
  const button = chapterDraftTarget(target.nodes, chapterTitle);
  if (!button) throw new Error("chapter_draft_button_missing");
  harness.log.push({
    op: "chapter_draft_target",
    at: harness.nowIso(),
    chapter_title: chapterTitle,
    button: { path: button.path, title: button.title, frame: button.frame ?? null },
  });
  return button;
}

async function driveRevision(config) {
  const chapterTitle = String(config.chapter_title ?? "");
  if (!chapterTitle) throw new Error("revision_chapter_title_missing");
  const button = await openArchiveOutline(harness, chapterTitle);
  const since = new Date().toISOString();
  const sent = await harness.runStep("input", "generate_source_draft", async () => {
    await harness.safeClick(button, "b71:chapter-draft");
    return harness.pollWire(
      (wire) => sourceGenerationFrame(wire, { chapterTitle, since }),
      15_000,
      "b71:source-message",
    );
  });
  const topic = frameOf(sent)?.[2];
  if (!topic) throw new Error("revision_source_topic_missing");
  const sourceTurnId = String(frameBody(sent)?.turn_id ?? "");
  if (!sourceTurnId) throw new Error("revision_source_turn_missing");
  const sourceAck = await harness.runStep("ack", "source_ack", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 30_000, "b71:source-ack"),
  );
  const sourceRunId = String(frameBody(sourceAck)?.response?.run_id ?? "");
  if (!sourceRunId) throw new Error("revision_source_run_missing");
  const sourceResult = await harness.runStep("turn", "source_quality", () =>
    harness.pollWire(
      (wire) => sourceQualityFrame(wire, sourceRunId, { topic, at: since }),
      240_000,
      "b71:source-quality",
    ),
  );
  const sourceBody = frameBody(sourceResult);
  const sourceResultTurnId = String(sourceBody?.turn_id ?? "");
  const sourceArtifact = (sourceBody?.adoption_state?.pending ?? []).find(
    (artifact) => artifact?.artifact_type === "prose_fragment",
  );
  const sourceArtifactId = String(sourceArtifact?.artifact_id ?? "");
  if (!sourceResultTurnId || !sourceArtifactId) throw new Error("revision_source_identity_missing");

  await harness.runStep("maintenance", "quality_card_visible", () =>
    harness.pollAx(
      (text) =>
        text.includes("质量复核：发现") &&
        text.includes("局部修订所选问题") &&
        text.includes("原句") &&
        text.includes("判断理由"),
      45_000,
      "b71:quality-card",
    ),
  );
  harness.capture("02-quality");
  // source terminal 已到、质量卡已可见、作者动作尚未点击：唯一 before-revision 边界。
  runEvidenceMode(evidence, "capture", dir, ["before-revision"]);

  const actionFrame = await harness.runStep("input", "revision_action", async () => {
    const nodes = harness.dumpNodes();
    const action = harness.findButton(nodes, "局部修订所选问题");
    if (!action) throw new Error("revision_action_button_missing");
    await harness.safeClick(action, "b71:revision-action");
    return harness.pollWire(
      (wire) =>
        actionFrameOrNull(wire, {
          topic,
          since,
          sourceTurnRef: sourceResultTurnId,
          targetRef: sourceArtifactId,
        }),
      20_000,
      "b71:revision-action-frame",
    );
  });
  const ack = await harness.runStep("ack", "revision_ack", () =>
    harness.pollWire((wire) => ackOrNull(wire, actionFrame), 30_000, "b71:revision-ack"),
  );
  const childRunId = String(ack?.response?.run_id ?? "");
  const receiptId = String(ack?.response?.receipt_id ?? "");
  if (!childRunId || !receiptId) throw new Error("revision_child_identity_missing");
  const actionResult = await harness.runStep("ack", "revision_action_result", () =>
    harness.pollWire(
      (wire) =>
        actionResultOrNull(wire, {
          receiptId,
          runId: childRunId,
          sourceTurnRef: sourceResultTurnId,
          targetRef: sourceArtifactId,
          topic,
          at: actionFrame.at,
        }),
      30_000,
      "b71:revision-action-result",
    ),
  );
  void actionResult;
  const childWindow = { topic, at: actionFrame.at };
  await harness.runStep("turn", "revision_run_completed", () =>
    harness.pollWire(
      runWirePredicate(
        childRunId,
        (wire) =>
          broadcastFrames(wire, {
            topic,
            at: childWindow.at,
            event: "agent_run_state",
          }).find(
            (entry) =>
              frameBody(entry)?.run_id === childRunId &&
              frameBody(entry)?.status === "completed",
          ) ?? null,
        childWindow,
      ),
      240_000,
      "b71:revision-completed",
    ),
  );
  const childResult = await harness.runStep("turn", "revision_turn_result", () =>
    harness.pollWire(
      runWirePredicate(
        childRunId,
        (wire) =>
          broadcastFrames(wire, {
            topic,
            at: childWindow.at,
            event: "turn_result",
            agentRunId: childRunId,
          }).find((entry) => frameBody(entry)?.agent_run?.status === "completed") ?? null,
        childWindow,
      ),
      60_000,
      "b71:revision-turn-result",
    ),
  );
  const childTurnId = String(frameBody(childResult)?.turn_id ?? "");
  if (!childTurnId) throw new Error("revision_child_turn_missing");

  await harness.runStep("maintenance", "revision_candidate_visible", () =>
    harness.pollAx(
      (text) => text.includes("修订稿") && text.includes("保存修订稿") && text.includes("原稿"),
      45_000,
      "b71:revision-candidate",
    ),
  );
  harness.capture("03-revision");
  runEvidenceMode(evidence, "capture", dir, ["before-why"]);
  const why = await harness.runStep("maintenance", "revision_why", () =>
    harness.rawOpenWhy("b71:revision-why"),
  );
  harness.capture("04-why");
  runEvidenceMode(evidence, "capture", dir, ["after-why"]);
  runEvidenceMode(evidence, "capture", dir, ["final"]);
  harness.writeDriverLog("native-b71-driver-log.json", {
    slice_id: config.slice_id,
    provider: harness.provider,
    source_turn_id: sourceTurnId,
    source_result_turn_id: sourceResultTurnId,
    source_run_id: sourceRunId,
    source_artifact_id: sourceArtifactId,
    child_run_id: childRunId,
    child_turn_id: childTurnId,
    receipt_id: receiptId,
    assistant_text: String(frameBody(childResult)?.assistant_message?.text ?? ""),
    why_text: why.text,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(
    `B71 修订原生驱动完成: source=${sourceRunId} child=${childRunId} screenshots=${harness.screenshots.length}`,
  );
}

await harness.runJourney(run);
