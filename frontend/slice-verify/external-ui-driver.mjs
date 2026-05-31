import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sliceId = process.argv[2];
const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5769";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "slice-verify", sliceId ?? "unknown");
const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';

if (!sliceId) {
  throw new Error("Usage: node slice-verify/external-ui-driver.mjs <slice-id>");
}

fs.mkdirSync(artifactDir, { recursive: true });

const frames = [];

function decodePhoenixFrame(payload) {
  try {
    const frame = JSON.parse(payload);
    if (Array.isArray(frame) && frame.length >= 5) {
      const [, , topic, event, body] = frame;
      return { topic, event, body };
    }
  } catch {
    return null;
  }

  return null;
}

function recordFrame(direction, payload) {
  const decoded = decodePhoenixFrame(payload);
  if (decoded) frames.push({ direction, ...decoded });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function textContent(page, selector) {
  return page.locator(selector).first().textContent().then((value) => value?.trim() ?? "").catch(() => "");
}

function serviceStatus(page) {
  return page.getByText(/^服务:/).first();
}

function workTitle(page) {
  return page.locator('button[title="作品"]').first();
}

function latestSentUserMessage() {
  return frames
    .filter((frame) => frame.direction === "sent" && frame.event === "user_message")
    .at(-1);
}

function latestTurnResult() {
  return frames
    .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
    .at(-1)?.body;
}

function latestActionResult() {
  return frames
    .filter((frame) => frame.direction === "received" && frame.event === "action_result")
    .at(-1)?.body;
}

function latestSentEvent(event) {
  return frames.filter((frame) => frame.direction === "sent" && frame.event === event).at(-1);
}

async function waitForFrame(predicate, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = frames.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(message);
}

async function commonUiState(page, turnResult, sentMessage) {
  const visibleText = await page.locator("body").innerText();

  return {
    event: "slice_verify.ui_state.done",
    slice_id: sliceId,
    turn_id: turnResult.turn_id,
    workspace_id: sentMessage.body?.work_id,
    work_id: sentMessage.body?.work_id,
    session_id: sentMessage.body?.session_id,
    context_work_id: sentMessage.body?.work_id,
    active_session_id: sentMessage.body?.session_id,
    restored_turn_id: turnResult.turn_id,
    socket_connected: true,
    message_count: frames.filter((frame) => frame.event === "turn_result").length * 2 + 1,
    welcome_message_count: visibleText.includes("欢迎使用 AI Novel Studio") ? 1 : 0,
    pending_adoption_count: await page.getByRole("button", { name: /采纳/ }).count(),
    first_message_text: visibleText.slice(0, 300),
    service_status_text: await serviceStatus(page).textContent().then((value) => value?.trim() ?? ""),
    title_text: await workTitle(page).textContent().then((value) => value?.trim() ?? ""),
    long_session_visible_text: visibleText,
    duration_ms: 0,
    outcome: "done",
  };
}

async function driveLongSessionCompression(page) {
  await page.locator(chatInputSelector).fill("继续最新设定");
  await page.getByRole("button", { name: /^发送$/ }).click();

  await page.waitForFunction(
    () => document.body.innerText.includes("继续最新设定"),
    { timeout: 10_000 },
  );
  for (let attempt = 0; attempt < 120 && !latestTurnResult(); attempt += 1) {
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(300);

  const sentMessage = latestSentUserMessage();
  const turnResult = latestTurnResult();
  assert(sentMessage, "No user_message websocket frame was sent");
  assert(turnResult, "No turn_result websocket frame was received");
  assert(turnResult.trace_summary, "Turn result did not include trace summary");

  const uiState = await commonUiState(page, turnResult, sentMessage);

  assert(
    uiState.long_session_visible_text.includes("继续最新设定"),
    "Real UI did not display the user message",
  );

  return [uiState];
}

async function openLatestWhyDialog(page) {
  const whyButton = page.getByRole("button", { name: /为什么/ }).last();
  await whyButton.waitFor({ timeout: 10_000 });
  await whyButton.click();

  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () => document.body.innerText.includes("参考来源"),
    { timeout: 10_000 },
  );

  return dialog.innerText();
}

async function driveContextSourceUi(page) {
  await page.locator(chatInputSelector).fill("林烬为什么要去灵源矿区？");
  await page.getByRole("button", { name: /^发送$/ }).click();

  await page.waitForFunction(
    () => document.body.innerText.includes("林烬为什么要去灵源矿区？"),
    { timeout: 10_000 },
  );
  for (let attempt = 0; attempt < 120 && !latestTurnResult(); attempt += 1) {
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(300);

  const sentMessage = latestSentUserMessage();
  const turnResult = latestTurnResult();
  assert(sentMessage, "No user_message websocket frame was sent");
  assert(turnResult, "No turn_result websocket frame was received");
  assert(turnResult.trace_summary, "Turn result did not include trace summary");

  const whyText = await openLatestWhyDialog(page);
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;

  assert(whyText.includes("参考来源"), "Why dialog did not show the source section");
  assert(whyText.includes("当前作品背景"), "Why dialog did not show current work source");
  assert(whyText.includes("近期对话"), "Why dialog did not show recent dialogue source");
  assert(whyText.includes("已确认设定"), "Why dialog did not show memory source");
  assert(whyText.includes("灵源纪元"), "Why dialog did not show work summary text");
  assert(whyText.includes("灵源矿区"), "Why dialog did not show memory or session summary text");
  assert(!unsafePattern.test(whyText), "Why dialog exposed unsafe trace or prompt text");

  return [
    {
      ...uiState,
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
    },
  ];
}

async function driveCandidateAdoptionBridge(page) {
  await page.locator(chatInputSelector).fill("我想写一个赛博修仙故事，但还没想好小说创作方向。");
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sourceTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      Array.isArray(frame.body?.candidate_directions) &&
      frame.body.candidate_directions.length > 0,
    "No candidate turn_result websocket frame was received",
  );
  const sourceTurnResult = sourceTurnFrame.body;
  const candidate = sourceTurnResult.candidate_directions[0];
  const availableAction = (sourceTurnResult.available_actions ?? []).find(
    (action) =>
      action.action_type === "choose_candidate" &&
      (action.candidate_ref === candidate.direction_id || action.target_ref === candidate.direction_id),
  ) ?? (
    sourceTurnResult.candidate_directions.length === 1 &&
    (sourceTurnResult.available_actions ?? []).filter((action) => action.action_type === "choose_candidate").length === 1
      ? (sourceTurnResult.available_actions ?? []).find((action) => action.action_type === "choose_candidate")
      : null
  );

  assert(availableAction, "Candidate turn_result did not include a matching choose_candidate available_action");

  await page.getByRole("button", { name: /继续聊这个方向/ }).first().click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_id === availableAction.action_id &&
      frame.body?.action?.action_type === availableAction.action_type &&
      frame.body?.action?.source_turn_ref === (availableAction.source_turn_ref ?? sourceTurnResult.turn_id) &&
      frame.body?.action?.target_ref === availableAction.target_ref &&
      frame.body?.action?.candidate_ref === availableAction.candidate_ref &&
      frame.body?.action?.candidate_set_ref === availableAction.candidate_set_ref,
    "Real workbench did not send server-provided choose_candidate author_action from candidate continuation",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === availableAction.candidate_ref,
    "No choose_candidate action_result websocket frame was received",
  );

  const adoptionTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === sourceTurnResult.turn_id &&
      frame.body?.adoption_decision?.decision_type === "adopt_tentative",
    "No candidate adoption decision turn_result websocket frame was received",
  );
  const adoptionTurnResult = adoptionTurnFrame.body;

  await page.waitForFunction(
    () => document.body.innerText.includes("候选方向已采用"),
    { timeout: 10_000 },
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptionTurnResult, sentMessage);
  const visibleText = await page.locator("body").innerText();

  assert(visibleText.includes("继续聊这个方向"), "Candidate continuation button was not rendered");
  assert(visibleText.includes("采用这个方向"), "Candidate adoption button was not rendered");
  assert(
    adoptionTurnResult.truthfulness?.candidate_selected === true,
    "Adoption turn_result did not mark candidate_selected",
  );
  assert(
    adoptionTurnResult.truthfulness?.candidate_adopted === true,
    "Adoption turn_result did not mark candidate_adopted",
  );
  assert(
    adoptionTurnResult.truthfulness?.production_write_performed === false,
    "Candidate adoption bridge claimed a production write",
  );

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      continuation_turn_id: null,
      adoption_turn_id: adoptionTurnResult.turn_id,
      candidate_ref: availableAction.candidate_ref,
      candidate_set_ref: availableAction.candidate_set_ref,
      candidate_panel_count: await page.locator("[class*=candidatePanel]").count(),
      candidate_continue_clicked: true,
      candidate_adopt_clicked: false,
      continuation_author_action: actionFrame.body.action,
      author_action: actionFrame.body.action,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: adoptionTurnResult.adoption_decision.decision_type,
      candidate_selected: adoptionTurnResult.truthfulness.candidate_selected,
      candidate_adopted: adoptionTurnResult.truthfulness.candidate_adopted,
      production_write_performed: adoptionTurnResult.truthfulness.production_write_performed,
      visible_adoption_result: visibleText.includes("候选方向已采用"),
    },
  ];
}

async function driveAdoptionSafetyFreshness(page) {
  await page
    .locator(chatInputSelector)
    .fill("我想写一个高风险、会覆盖主线设定的小说创作方向。");
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sourceTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      Array.isArray(frame.body?.candidate_directions) &&
      frame.body.candidate_directions.some((candidate) => candidate.risk_hint === "high"),
    "No high-risk candidate turn_result websocket frame was received",
  );
  const sourceTurnResult = sourceTurnFrame.body;
  const candidate = sourceTurnResult.candidate_directions.find(
    (item) => item.risk_hint === "high",
  );

  assert(candidate, "High-risk candidate was not present in source turn_result");

  await page.getByRole("button", { name: /采用这个方向/ }).first().click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === candidate.direction_id &&
      frame.body?.action?.candidate_set_ref === `candidate_set:${sourceTurnResult.turn_id}`,
    "Real workbench did not send authorized high-risk choose_candidate author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === candidate.direction_id &&
      frame.body?.status === "needs_confirmation" &&
      frame.body?.adoption_decision?.decision_type === "require_confirmation",
    "No high-risk candidate confirmation action_result websocket frame was received",
  );

  const confirmationTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === sourceTurnResult.turn_id &&
      frame.body?.status === "needs_confirmation" &&
      frame.body?.adoption_decision?.decision_type === "require_confirmation",
    "No high-risk candidate confirmation turn_result websocket frame was received",
  );
  const confirmationTurnResult = confirmationTurnFrame.body;

  await page.waitForFunction(
    () => document.body.innerText.includes("候选方向待确认"),
    { timeout: 10_000 },
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, confirmationTurnResult, sentMessage);
  const visibleText = await page.locator("body").innerText();

  assert(visibleText.includes("采用这个方向"), "Candidate adoption button was not rendered");
  assert(
    confirmationTurnResult.truthfulness?.candidate_selected === true,
    "Confirmation turn_result did not mark candidate_selected",
  );
  assert(
    confirmationTurnResult.truthfulness?.candidate_adopted === false,
    "High-risk confirmation turn_result incorrectly marked candidate_adopted",
  );
  assert(
    confirmationTurnResult.truthfulness?.production_write_performed === false,
    "High-risk confirmation turn_result claimed a production write",
  );

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      confirmation_turn_id: confirmationTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      candidate_risk_hint: candidate.risk_hint,
      candidate_adopt_clicked: true,
      author_action: actionFrame.body.action,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: confirmationTurnResult.adoption_decision.decision_type,
      adoption_reason_codes: confirmationTurnResult.adoption_decision.reason_codes,
      candidate_selected: confirmationTurnResult.truthfulness.candidate_selected,
      candidate_adopted: confirmationTurnResult.truthfulness.candidate_adopted,
      production_write_performed: confirmationTurnResult.truthfulness.production_write_performed,
      visible_confirmation_result: visibleText.includes("候选方向待确认"),
    },
  ];
}

async function driveStaleConflictCrossWorkFreshness(page) {
  await page.waitForFunction(
    () => document.body.innerText.includes("旧版主线覆盖"),
    { timeout: 20_000 },
  );

  await page.getByRole("button", { name: /采用这个方向/ }).first().click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === "dir_au05_stale_1" &&
      frame.body?.action?.candidate_set_ref === "candidate_set:turn_au05_stale_candidate_seed",
    "Real workbench did not send authorized stale choose_candidate author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === "dir_au05_stale_1" &&
      frame.body?.status === "rejected" &&
      frame.body?.adoption_decision?.decision_type === "reject",
    "No stale candidate rejection action_result websocket frame was received",
  );

  const rejectionTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === "turn_au05_stale_candidate_seed" &&
      frame.body?.status === "cancelled" &&
      frame.body?.adoption_decision?.decision_type === "reject",
    "No stale candidate rejection turn_result websocket frame was received",
  );
  const rejectionTurnResult = rejectionTurnFrame.body;

  await page.waitForFunction(
    () => document.body.innerText.includes("候选方向未采用"),
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const topic = actionFrame.topic ?? "";
  const workId = topic.startsWith("workspace:") ? topic.slice("workspace:".length) : undefined;

  assert(
    rejectionTurnResult.truthfulness?.candidate_selected === true,
    "Stale rejection turn_result did not mark candidate_selected",
  );
  assert(
    rejectionTurnResult.truthfulness?.candidate_adopted === false,
    "Stale rejection turn_result incorrectly marked candidate_adopted",
  );
  assert(
    rejectionTurnResult.truthfulness?.production_write_performed === false,
    "Stale rejection turn_result claimed a production write",
  );
  assert(
    rejectionTurnResult.truthfulness?.reason_codes?.includes("source_turn_stale"),
    "Stale rejection turn_result did not include source_turn_stale reason",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: rejectionTurnResult.turn_id,
      work_id: workId,
      workspace_id: workId,
      source_turn_id: "turn_au05_stale_candidate_seed",
      rejection_turn_id: rejectionTurnResult.turn_id,
      candidate_ref: "dir_au05_stale_1",
      candidate_set_ref: "candidate_set:turn_au05_stale_candidate_seed",
      candidate_adopt_clicked: true,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: rejectionTurnResult.adoption_decision.decision_type,
      adoption_reason_codes: rejectionTurnResult.adoption_decision.reason_codes,
      candidate_selected: rejectionTurnResult.truthfulness.candidate_selected,
      candidate_adopted: rejectionTurnResult.truthfulness.candidate_adopted,
      production_write_performed: rejectionTurnResult.truthfulness.production_write_performed,
      visible_rejection_result: visibleText.includes("候选方向未采用"),
      restored_stale_candidate_visible: visibleText.includes("旧版主线覆盖"),
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveConflictCrossWorkRecovery(page) {
  await page.waitForFunction(
    () => document.body.innerText.includes("外部作品主线移植"),
    { timeout: 20_000 },
  );

  await page.getByRole("button", { name: /采用这个方向/ }).first().click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === "dir_au05_cross_work_1" &&
      frame.body?.action?.candidate_set_ref ===
        "candidate_set:turn_au05_cross_work_candidate_seed",
    "Real workbench did not send authorized cross-work choose_candidate author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === "dir_au05_cross_work_1" &&
      frame.body?.status === "failed" &&
      frame.body?.adoption_decision?.decision_type === "fail_with_recovery",
    "No cross-work candidate recovery failure action_result websocket frame was received",
  );

  const failureTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === "turn_au05_cross_work_candidate_seed" &&
      frame.body?.status === "failed" &&
      frame.body?.adoption_decision?.decision_type === "fail_with_recovery",
    "No cross-work candidate recovery failure turn_result websocket frame was received",
  );
  const failureTurnResult = failureTurnFrame.body;

  await page.waitForFunction(
    () => document.body.innerText.includes("候选方向采用失败"),
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const topic = actionFrame.topic ?? "";
  const workId = topic.startsWith("workspace:") ? topic.slice("workspace:".length) : undefined;

  assert(
    failureTurnResult.truthfulness?.candidate_selected === true,
    "Cross-work failure turn_result did not mark candidate_selected",
  );
  assert(
    failureTurnResult.truthfulness?.candidate_adopted === false,
    "Cross-work failure turn_result incorrectly marked candidate_adopted",
  );
  assert(
    failureTurnResult.truthfulness?.production_write_performed === false,
    "Cross-work failure turn_result claimed a production write",
  );
  assert(
    failureTurnResult.truthfulness?.reason_codes?.includes("work_id_mismatch"),
    "Cross-work failure turn_result did not include work_id_mismatch reason",
  );
  assert(
    failureTurnResult.truthfulness?.reason_codes?.includes("cross_work_adoption_rejected"),
    "Cross-work failure turn_result did not include cross_work_adoption_rejected reason",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: failureTurnResult.turn_id,
      work_id: workId,
      workspace_id: workId,
      source_turn_id: "turn_au05_cross_work_candidate_seed",
      failure_turn_id: failureTurnResult.turn_id,
      candidate_ref: "dir_au05_cross_work_1",
      candidate_set_ref: "candidate_set:turn_au05_cross_work_candidate_seed",
      candidate_adopt_clicked: true,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: failureTurnResult.adoption_decision.decision_type,
      adoption_reason_codes: failureTurnResult.adoption_decision.reason_codes,
      candidate_selected: failureTurnResult.truthfulness.candidate_selected,
      candidate_adopted: failureTurnResult.truthfulness.candidate_adopted,
      production_write_performed: failureTurnResult.truthfulness.production_write_performed,
      visible_failure_result: visibleText.includes("候选方向采用失败"),
      cross_work_candidate_visible: visibleText.includes("外部作品主线移植"),
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveCanonConflictRecovery(page) {
  await page.waitForFunction(
    () => document.body.innerText.includes("年龄设定覆盖"),
    { timeout: 20_000 },
  );

  await page.getByRole("button", { name: /采用这个方向/ }).first().click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === "dir_au05_canon_conflict_1" &&
      frame.body?.action?.candidate_set_ref ===
        "candidate_set:turn_au05_canon_conflict_candidate_seed",
    "Real workbench did not send authorized canon-conflict choose_candidate author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === "dir_au05_canon_conflict_1" &&
      frame.body?.status === "failed" &&
      frame.body?.adoption_decision?.decision_type === "fail_with_recovery",
    "No canon-conflict candidate recovery failure action_result websocket frame was received",
  );

  const failureTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.parent_turn_id === "turn_au05_canon_conflict_candidate_seed" &&
      frame.body?.status === "failed" &&
      frame.body?.adoption_decision?.decision_type === "fail_with_recovery",
    "No canon-conflict candidate recovery failure turn_result websocket frame was received",
  );
  const failureTurnResult = failureTurnFrame.body;

  await page.waitForFunction(
    () => document.body.innerText.includes("候选方向采用失败"),
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const topic = actionFrame.topic ?? "";
  const workId = topic.startsWith("workspace:") ? topic.slice("workspace:".length) : undefined;

  assert(
    failureTurnResult.truthfulness?.candidate_selected === true,
    "Canon-conflict failure turn_result did not mark candidate_selected",
  );
  assert(
    failureTurnResult.truthfulness?.candidate_adopted === false,
    "Canon-conflict failure turn_result incorrectly marked candidate_adopted",
  );
  assert(
    failureTurnResult.truthfulness?.production_write_performed === false,
    "Canon-conflict failure turn_result claimed a production write",
  );
  assert(
    failureTurnResult.truthfulness?.reason_codes?.includes("canon_conflict_detected"),
    "Canon-conflict failure turn_result did not include canon_conflict_detected reason",
  );
  assert(
    failureTurnResult.truthfulness?.reason_codes?.includes("conflict_recovery_required"),
    "Canon-conflict failure turn_result did not include conflict_recovery_required reason",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: failureTurnResult.turn_id,
      work_id: workId,
      workspace_id: workId,
      source_turn_id: "turn_au05_canon_conflict_candidate_seed",
      failure_turn_id: failureTurnResult.turn_id,
      candidate_ref: "dir_au05_canon_conflict_1",
      candidate_set_ref: "candidate_set:turn_au05_canon_conflict_candidate_seed",
      candidate_adopt_clicked: true,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      adoption_decision_type: failureTurnResult.adoption_decision.decision_type,
      adoption_reason_codes: failureTurnResult.adoption_decision.reason_codes,
      candidate_selected: failureTurnResult.truthfulness.candidate_selected,
      candidate_adopted: failureTurnResult.truthfulness.candidate_adopted,
      production_write_performed: failureTurnResult.truthfulness.production_write_performed,
      visible_failure_result: visibleText.includes("候选方向采用失败"),
      canon_conflict_candidate_visible: visibleText.includes("年龄设定覆盖"),
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveP1ChapterPlanMinimum(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.getByRole("button", { name: "开始规划" }).click();

  const planMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("章节大纲"),
    "Real workbench did not send chapter plan user_message with micro plan enabled",
  );

  const generationFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "plot_outline" &&
      frame.body?.tool_result?.output?.artifact_type === "outline_draft" &&
      frame.body?.adoption_state?.pending?.[0]?.payload?.chapter_count === 12,
    "No P1 chapter plan outline_draft turn_result websocket frame was received",
  );
  const generationTurnResult = generationFrame.body;
  const pendingArtifact = generationTurnResult.adoption_state.pending[0];

  await page.waitForFunction(() => document.body.innerText.includes("章节计划待采纳"), {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: /^采纳$/ }).first().click();

  const adoptFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "adopt" &&
      frame.body?.artifact_id === pendingArtifact.artifact_id &&
      frame.body?.artifact_type === "outline_draft",
    "Real workbench did not send adopt event for outline_draft artifact",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "accepted" &&
      frame.body?.artifact_id === pendingArtifact.artifact_id &&
      frame.body?.artifact_type === "outline_draft",
    "No accepted outline_draft action_result websocket frame was received",
  );

  const adoptionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.adoption_state?.resolved?.[0]?.artifact_id === pendingArtifact.artifact_id &&
      frame.body?.adoption_state?.resolved?.[0]?.adoption_status === "ACCEPTED",
    "No accepted outline_draft adoption turn_result websocket frame was received",
  );
  const adoptionTurnResult = adoptionFrame.body;

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已采纳") &&
      document.body.innerText.includes("P1 10 万字章节计划"),
    { timeout: 10_000 },
  );

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();

  await waitForFrame(
    (frame) => frame.direction === "sent" && frame.event === "get_chapter_plans",
    "Real workbench did not request adopted chapter plans through the archive channel",
  );

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes("第01章：底层灵气账单") &&
      document.body.innerText.includes("第12章：第一卷终局：灵气回流"),
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const chapterTitleMatches = visibleText.match(/第\d{2}章：/g) ?? [];
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, generationTurnResult, sentMessage);

  assert(chapterTitleMatches.length >= 12, "Accepted chapter plan did not render 12 visible chapters");
  assert(
    actionResultFrame.body?.persistence?.reading_projection == null,
    "Outline adoption unexpectedly materialized a reading projection",
  );

  return [
    {
      ...uiState,
      turn_id: generationTurnResult.turn_id,
      generation_turn_id: generationTurnResult.turn_id,
      adoption_turn_id: adoptionTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_count: pendingArtifact.payload.chapter_count,
      chapter_titles_visible_count: chapterTitleMatches.length,
      chapter_plan_visible: visibleText.includes("已采纳章节计划"),
      first_chapter_visible: visibleText.includes("第01章：底层灵气账单"),
      final_chapter_visible: visibleText.includes("第12章：第一卷终局：灵气回流"),
      outline_adopt_clicked: true,
      outline_adopted: true,
      reading_projection_materialized: Boolean(actionResultFrame.body?.persistence?.reading_projection),
      adopt_payload: adoptFrame.body,
      chapter_plan_request_sent: Boolean(latestSentEvent("get_chapter_plans")),
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      user_message_text: planMessageFrame.body?.text,
    },
  ];
}

async function driveP1ChapterDraftGeneration(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes("第01章：底层灵气账单"),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "生成正文草稿" }).first().click();

  const draftMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("第01章：底层灵气账单") &&
      String(frame.body?.text ?? "").includes("正文草稿"),
    "Real workbench did not send chapter draft user_message with micro plan enabled",
  );

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No P1 chapter draft prose_fragment turn_result websocket frame was received",
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];
  const draftBody = pendingArtifact.payload?.items?.[0]?.body ?? "";
  const draftLeakMarker = "灵气账单从屋檐下垂落";

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("待确认的创作材料") &&
      document.body.innerText.includes("灵气账单从屋檐下垂落") &&
      document.body.innerText.includes("底层灵气账单"),
    { timeout: 10_000 },
  );

  await page.getByRole("button", { name: /\[阅读模式\]/ }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  assert(draftBody.includes("底层灵气账单"), "Draft payload did not contain prose body text");
  assert(
    !frames.some((frame) => frame.direction === "sent" && frame.event === "adopt"),
    "Draft generation unexpectedly submitted an adopt event",
  );
  assert(
    visibleText.includes("暂无已采纳的章节内容"),
    "Reading mode did not remain empty before draft adoption",
  );
  assert(
    !visibleText.includes(draftLeakMarker) || visibleText.includes("暂无已采纳的章节内容"),
    "Unadopted draft leaked into reading mode content",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: "第01章：底层灵气账单",
      draft_generated: true,
      draft_pending: true,
      draft_body_chars: String(draftBody).length,
      draft_card_visible: true,
      reading_mode_empty_before_adoption: visibleText.includes("暂无已采纳的章节内容"),
      unadopted_draft_visible_in_reading:
        visibleText.includes(draftLeakMarker) && !visibleText.includes("暂无已采纳的章节内容"),
      adopt_event_sent: frames.some((frame) => frame.direction === "sent" && frame.event === "adopt"),
      user_message_text: draftMessageFrame.body?.text,
    },
  ];
}

// 从可见文本里解析「全书/本章有效字数 1,234 字」中的数字（去千分位逗号）。
// 使用硬编码字面量正则（避免动态 RegExp），文本为产品 UI 渲染、非用户输入。
function parseWordCount(match) {
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function parseBookTotalWords(text) {
  return parseWordCount(/全书有效字数\s*([\d,]+)\s*字/.exec(text));
}

function parseChapterWords(text) {
  return parseWordCount(/本章有效字数\s*([\d,]+)\s*字/.exec(text));
}

// 正文有效字数：与后端 NovelDomain.ProseWordCount 同口径（仅字母/表意文字与数字）。
function effectiveWordCount(text) {
  return String(text ?? "").replace(/[^\p{L}\p{N}]/gu, "").length;
}

async function driveP1ChapterAdoptionReading(page) {
  // 复用 p1-chapter-draft-generation：打开档案大纲 → 生成第 1 章正文草稿。
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes("第01章：底层灵气账单"),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "生成正文草稿" }).first().click();

  // 真实 LM Studio 生成整章正文可能较慢，给足窗口（确定性 provider 会立即命中）。
  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No P1 chapter draft prose_fragment turn_result websocket frame was received",
    170_000,
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("待确认的创作材料") &&
      document.body.innerText.includes("确认创建"),
    { timeout: 10_000 },
  );

  // 作者点击「确认创建」采纳正文草稿（accept author_action → 采纳边界 → 持久化）。
  await page.getByRole("button", { name: "确认创建" }).first().click();

  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id,
    "Real workbench did not send an accept author_action for the prose draft",
  );

  const adoptTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some(
        (entry) => entry.artifact_id === pendingArtifact.artifact_id,
      ),
    "No resolved adoption turn_result websocket frame was received after accept",
    120_000,
  );
  const adoptTurnResult = adoptTurnFrame.body;

  // 采纳后旧草稿卡的「确认创建」必须消失，否则作者会重复点击、重复提交同一动作。
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "确认创建",
      ),
    { timeout: 10_000 },
  );
  const acceptButtonCleared =
    (await page.getByRole("button", { name: "确认创建" }).count()) === 0;

  // 进入阅读模式：采纳后的正文应进入投影，并显示有效字数。
  await page.getByRole("button", { name: /\[阅读模式\]/ }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 15_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptTurnResult, sentMessage);

  const totalWords = parseBookTotalWords(visibleText);
  const chapterWords = parseChapterWords(visibleText);

  // 取阅读区真实渲染的正文段落（叶子 div，排除「本章有效字数」元信息行），
  // 用与后端同口径计算有效字数，验证"显示的字数 == 读者实际看到的正文字数"。
  const renderedProse = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1")].find((el) => el.textContent?.trim());
    const block = heading?.parentElement;
    if (!block) return "";
    return [...block.querySelectorAll("div")]
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent ?? "")
      .filter((text) => !text.startsWith("本章有效字数"))
      .join("");
  });
  const visibleProseWords = effectiveWordCount(renderedProse);

  assert(visibleProseWords > 0, "No visible prose found in reading mode to count");
  assert(Number(totalWords) > 0, "Book total effective word count not visible/positive in reading mode");
  assert(Number(chapterWords) > 0, "Chapter effective word count not visible/positive in reading mode");
  assert(
    chapterWords === visibleProseWords,
    `Displayed chapter word count ${chapterWords} != effective count of visible prose ${visibleProseWords}`,
  );
  assert(
    totalWords === chapterWords,
    `Book total ${totalWords} != single adopted chapter ${chapterWords}`,
  );
  assert(
    !visibleText.includes("暂无已采纳的章节内容"),
    "Reading mode stayed empty after adoption",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      adopt_turn_id: adoptTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: "第01章：底层灵气账单",
      accept_event_sent: true,
      accept_action_type: acceptActionFrame.body?.action?.action_type,
      accept_button_cleared_after_adoption: acceptButtonCleared,
      artifact_adopted: adoptTurnResult.truthfulness?.artifact_adopted === true,
      reading_mode_populated_after_adoption: !visibleText.includes("暂无已采纳的章节内容"),
      total_word_count: totalWords,
      chapter_word_count: chapterWords,
      expected_word_count: visibleProseWords,
      word_count_matches_adopted_prose:
        chapterWords === visibleProseWords && totalWords === chapterWords,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1WordCountAudit(page) {
  // 复用采纳到阅读链路：确定性 provider 生成的正文草稿天然 < 1000 字，
  // 采纳后即为短章，用于验证 ReadingMode 的短章标记与 P1 达标进度。
  const [base] = await driveP1ChapterAdoptionReading(page);

  // 此时 page 已停在 ReadingMode：目录该章应标「短章」，顶栏显示「P1 进度」。
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return text.includes("短章") && text.includes("P1 进度");
    },
    { timeout: 10_000 },
  );

  const shortBadgeVisible = (await page.getByText("短章", { exact: true }).count()) > 0;
  const milestoneMet = (await page.getByText("已达 P1 目标").count()) > 0;
  const visibleText = await page.locator("body").innerText();
  const milestoneProgressVisible = visibleText.includes("P1 进度");
  const belowMinChapter = Number(base.chapter_word_count ?? 0) < 1000;

  assert(
    shortBadgeVisible,
    "短章 badge not visible in TOC for a sub-1000-word adopted chapter",
  );
  assert(
    milestoneProgressVisible,
    "P1 milestone progress not visible in reading mode top bar",
  );
  assert(
    !milestoneMet,
    "Milestone must not be marked met for a single short chapter",
  );
  assert(
    belowMinChapter,
    `Adopted chapter ${base.chapter_word_count} should be below the 1000-word P1 minimum`,
  );

  return [
    {
      ...base,
      short_chapter_marked: shortBadgeVisible,
      milestone_progress_visible: milestoneProgressVisible,
      milestone_met: milestoneMet,
      below_min_chapter: belowMinChapter,
    },
  ];
}

async function driveP1ChapterEditThenAccept(page) {
  // 复用 p1-chapter-draft-generation：生成第 1 章正文草稿。
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes("第01章：底层灵气账单"),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "生成正文草稿" }).first().click();

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No P1 chapter draft prose_fragment turn_result websocket frame was received",
    170_000,
  );
  const pendingArtifact = draftTurnFrame.body.adoption_state.pending[0];

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("待确认的创作材料") &&
      document.body.innerText.includes("修改后采纳"),
    { timeout: 10_000 },
  );

  // 点「修改后采纳」打开编辑弹窗，作者改写全文后再采纳。
  await page.getByRole("button", { name: "修改后采纳" }).first().click();

  const editedText =
    "林澈在灵气账单的红光里睁开眼，城市在脚下安静地呼吸，他知道反垄断的第一刀终于该落下了。";
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ timeout: 10_000 });
  await textarea.fill(editedText);

  await page.getByRole("button", { name: "采纳修改后的版本" }).click();

  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "edit_then_accept" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id &&
      frame.body?.action?.payload?.edited_content === editedText,
    "Real workbench did not send edit_then_accept author_action carrying edited_content",
  );

  const adoptTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) =>
          entry.artifact_id === pendingArtifact.artifact_id &&
          entry.adoption_status === "EDITED_ACCEPTED",
      ),
    "No EDITED_ACCEPTED resolved turn_result websocket frame after edit_then_accept",
    120_000,
  );
  const adoptTurnResult = adoptTurnFrame.body;

  // 采纳后「修改后采纳」按钮必须消失，避免重复提交。
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "修改后采纳",
      ),
    { timeout: 10_000 },
  );
  const editButtonCleared =
    (await page.getByRole("button", { name: "修改后采纳" }).count()) === 0;

  await page.getByRole("button", { name: /\[阅读模式\]/ }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 15_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptTurnResult, sentMessage);

  const totalWords = parseBookTotalWords(visibleText);
  const chapterWords = parseChapterWords(visibleText);
  const editedWords = effectiveWordCount(editedText);
  const editedTextShown = visibleText.includes(editedText);

  assert(editedWords > 0, "Edited text had no effective words");
  assert(editedTextShown, "Author-edited prose was not shown in reading mode");
  assert(Number(totalWords) > 0, "Book total effective word count not visible/positive");
  assert(Number(chapterWords) > 0, "Chapter effective word count not visible/positive");
  assert(
    chapterWords === editedWords,
    `Displayed chapter word count ${chapterWords} != effective count of EDITED prose ${editedWords}`,
  );
  assert(
    totalWords === chapterWords,
    `Book total ${totalWords} != single adopted chapter ${chapterWords}`,
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnFrame.body.turn_id,
      draft_turn_id: draftTurnFrame.body.turn_id,
      adopt_turn_id: adoptTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: "第01章：底层灵气账单",
      edit_then_accept_event_sent: true,
      accept_action_type: acceptActionFrame.body?.action?.action_type,
      edit_button_cleared_after_adoption: editButtonCleared,
      artifact_edited_accepted: (adoptTurnResult.adoption_state?.resolved ?? []).some(
        (entry) => entry.adoption_status === "EDITED_ACCEPTED",
      ),
      edited_text_shown_in_reading: editedTextShown,
      total_word_count: totalWords,
      chapter_word_count: chapterWords,
      expected_word_count: editedWords,
      word_count_matches_edited_prose: chapterWords === editedWords && totalWords === chapterWords,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1ChapterOverwriteConfirm(page) {
  const seen = new Set();

  async function generatePendingDraft() {
    await page.getByText("打开档案").first().click();
    await page.getByRole("tab", { name: "大纲与结构" }).click();
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("已采纳章节计划") &&
        document.body.innerText.includes("第01章：底层灵气账单"),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "生成正文草稿" }).first().click();

    const frame = await waitForFrame(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
        !seen.has(f.body.adoption_state.pending[0].artifact_id),
      "No new prose_fragment draft frame was received",
      170_000,
    );
    const artifact = frame.body.adoption_state.pending[0];
    seen.add(artifact.artifact_id);
    await page.waitForFunction(
      () => document.body.innerText.includes("确认创建"),
      { timeout: 10_000 },
    );
    // 生成 turn 才是带 LLM 调用的轮次（采纳/确认 turn 不调 LLM）。
    return { artifact, generateTurnId: frame.body.turn_id };
  }

  async function waitAdopted(artifactId) {
    return waitForFrame(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.truthfulness?.artifact_adopted === true &&
        (f.body?.adoption_state?.resolved ?? []).some((e) => e.artifact_id === artifactId),
      "No adoption resolved turn_result frame was received",
      120_000,
    );
  }

  // ── Cycle 1：首次采纳第 1 章正文（无既有 → 直接采纳）。
  const cycle1 = await generatePendingDraft();
  const artifact1 = cycle1.artifact;
  await page.getByRole("button", { name: "确认创建" }).first().click();
  await waitAdopted(artifact1.artifact_id);

  // ── Cycle 2：再次生成并采纳第 1 章正文（覆盖已有 → 需确认）。
  const cycle2 = await generatePendingDraft();
  const artifact2 = cycle2.artifact;
  await page.getByRole("button", { name: "确认创建" }).first().click();

  const confirmFrame = await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.adoption_decision?.decision_type === "require_confirmation" &&
      f.body?.truthfulness?.artifact_adopted === false,
    "Overwrite did not produce a require_confirmation turn_result",
    120_000,
  );
  const requireConfirmation = confirmFrame.body;

  // 确认前不写：高风险确认态，出现「确认执行」/「拒绝」。
  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  // ── 作者确认执行 → 重新 gate → 覆盖采纳。
  await page.getByRole("button", { name: "确认执行" }).first().click();
  const overwriteAdopt = await waitAdopted(artifact2.artifact_id);

  // ── 打开阅读模式：同一章显示采纳后正文，章节不重复。
  await page.getByRole("button", { name: /\[阅读模式\]/ }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 15_000 },
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, overwriteAdopt.body, sentMessage);

  assert(
    requireConfirmation.behavior_state?.active?.behavior_type === "confirmation",
    "Overwrite require_confirmation did not open a confirmation behavior",
  );
  assert(
    requireConfirmation.truthfulness?.production_write_performed === false,
    "Overwrite require_confirmation claimed a production write before confirmation",
  );

  return [
    {
      ...uiState,
      turn_id: overwriteAdopt.body.turn_id,
      first_generate_turn_id: cycle1.generateTurnId,
      second_generate_turn_id: cycle2.generateTurnId,
      first_artifact_id: artifact1.artifact_id,
      second_artifact_id: artifact2.artifact_id,
      cycle1_adopted: true,
      cycle2_required_confirmation: true,
      confirmation_behavior_opened:
        requireConfirmation.behavior_state?.active?.behavior_type === "confirmation",
      no_write_before_confirmation:
        requireConfirmation.truthfulness?.production_write_performed === false,
      confirmed_overwrite_adopted: overwriteAdopt.body.truthfulness?.artifact_adopted === true,
      confirm_action_clicked: true,
    },
  ];
}

async function driveAu09MemoryCreateRecall(page) {
  const nonce = "灵市拍卖行";
  const memoryContent = `${nonce}是本城唯一可以合法买卖灵气的拍卖交易所，由九大家族共管，禁止散修私下交易灵气。`;

  // ── 打开记忆管理页（真实工作台头部入口）。
  await page.getByRole("button", { name: /记忆/ }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), { timeout: 10_000 });

  // ── 新建一条设定（后端强制从 DRAFT 开始）。
  await page.getByRole("button", { name: "+ 新建记忆" }).click();
  await page.locator("textarea").first().fill(memoryContent);
  await page.getByRole("button", { name: "创建" }).click();
  // 注意 Playwright 签名 waitForFunction(fn, arg, options)：arg 在前、options 在后。
  await page.waitForFunction((n) => document.body.innerText.includes(n), nonce, { timeout: 10_000 });

  // ── 打开详情并确认（CONFIRMED + recallable 才进召回）。
  await page.getByText(new RegExp(nonce)).first().click();
  await page.getByRole("button", { name: "确认" }).click();
  // 确认后 DRAFT 专属的「确认」按钮消失 → 证明该记忆已转为 CONFIRMED（不依赖 body 里
  // 既有的 CONFIRMED 文本，避免被种子记忆的状态误判）。
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "确认",
      ),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "×" }).first().click();

  // ── 返回工作台。
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  // ── 发一条与该设定相关的消息：召回应命中并进入 prompt + trace。
  const message = `请继续推进${nonce}的剧情，写一段灵气拍卖的场景。`;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after memory-grounded message",
    170_000,
  );
  const turnResult = turnFrame.body;

  // ── 打开「为什么」面板：应显示「已确认设定」记忆来源。
  await openLatestWhyDialog(page);
  await page.waitForFunction(() => document.body.innerText.includes("已确认设定"), { timeout: 10_000 });

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, turnResult, sentMessage);

  const whyShowsMemorySource = visibleText.includes("已确认设定");
  assert(whyShowsMemorySource, "Why panel did not show the confirmed-memory source");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      recall_turn_id: turnResult.turn_id,
      memory_nonce: nonce,
      memory_created: true,
      memory_confirmed: true,
      message_text: message,
      why_shows_memory_source: whyShowsMemorySource,
    },
  ];
}

async function driveAu09AdoptSettingRecall(page) {
  // ── 从作品档案触发 AI 生成一条设定（world_setting）。
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "角色" }).click();
  await page.getByRole("button", { name: "创建角色" }).click();

  // 设定类创作 artifact（非正文）：world_setting / outline_draft / character_seed 等。
  // 真实 LLM 可能为同一档案按钮选择不同创作工具，故只要求"非正文且需采纳"。
  const draftFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.adoption_state?.pending?.[0]?.requires_adoption === true &&
      !["prose_fragment", "scene_draft"].includes(
        frame.body.adoption_state.pending[0].artifact_type,
      ),
    "No non-prose setting tentative artifact websocket frame was received",
    170_000,
  );
  const artifact = draftFrame.body.adoption_state.pending[0];
  const settingContent =
    artifact.payload?.content ??
    (artifact.payload?.items ?? []).map((item) => item?.body ?? "").join("") ??
    "";
  // 取一段设定正文的可匹配子串（仅字/数），后续消息带上它以保证召回命中本条设定。
  const chunk = settingContent.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 8);

  // 档案面板可能在发送后已自动关闭；存在才关闭。
  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive.first().click().catch(() => {});
  }
  await page.waitForFunction(() => document.body.innerText.includes("确认创建"), { timeout: 10_000 });

  // ── 采纳该设定 → 进入 confirmed + recallable governed memory。
  await page.getByRole("button", { name: "确认创建" }).first().click();
  const adoptFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === artifact.artifact_id,
      ),
    "No adoption resolved turn_result websocket frame was received",
    120_000,
  );

  // ── 发一条带该设定内容的消息 → 召回应命中已采纳设定。
  const seenTurnIds = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id),
  );
  const message = `请基于这条已确认设定继续展开剧情：${chunk}`;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const recallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenTurnIds.has(frame.body.turn_id) &&
      frame.body?.assistant_message != null,
    "No recall turn_result websocket frame was received",
    170_000,
  );
  const recallTurnResult = recallFrame.body;

  // ── 「为什么」面板显示「已确认设定」记忆来源。
  await openLatestWhyDialog(page);
  await page.waitForFunction(() => document.body.innerText.includes("已确认设定"), { timeout: 10_000 });

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, recallTurnResult, sentMessage);

  const whyShowsMemorySource = visibleText.includes("已确认设定");
  assert(chunk.length > 0, "Adopted setting had no matchable content");
  assert(
    adoptFrame.body.truthfulness?.production_write_performed === false ||
      adoptFrame.body.truthfulness?.artifact_adopted === true,
    "Setting was not adopted",
  );
  assert(whyShowsMemorySource, "Why panel did not show the adopted setting as a confirmed-memory source");

  return [
    {
      ...uiState,
      turn_id: recallTurnResult.turn_id,
      recall_turn_id: recallTurnResult.turn_id,
      setting_artifact_id: artifact.artifact_id,
      setting_artifact_type: artifact.artifact_type,
      setting_chunk: chunk,
      setting_adopted: adoptFrame.body.truthfulness?.artifact_adopted === true,
      why_shows_memory_source: whyShowsMemorySource,
      message_text: message,
    },
  ];
}

async function driveAu09ValidityWindowRecall(page) {
  // 种子：当前位置=第5章；窗口外设定「盘古碑（仅序章设定）」(1-2章)；无窗口设定「玄铁令（全书核心信物）」。
  const inWindowPhrase = "全书核心信物";
  const outOfWindowPhrase = "仅序章设定";

  // 一条同时与两条设定相关的消息：召回应只命中无窗口设定，窗口外设定被排除。
  const message = "请讲讲盘古碑和玄铁令在剧情里的关系。";
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after memory-grounded message",
    170_000,
  );
  const turnResult = turnFrame.body;

  // 「为什么」面板只展示真正被召回的设定来源（已确认设定 + 摘要）。
  const whyText = await openLatestWhyDialog(page);
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, turnResult, sentMessage);

  const whyShowsInWindow = whyText.includes(inWindowPhrase);
  const whyExcludesOutOfWindow = !whyText.includes(outOfWindowPhrase);

  assert(whyShowsInWindow, "Why panel did not show the in-window memory source");
  assert(
    whyExcludesOutOfWindow,
    "Why panel leaked an out-of-window memory (validity window not enforced)",
  );

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      recall_turn_id: turnResult.turn_id,
      in_window_phrase: inWindowPhrase,
      out_of_window_phrase: outOfWindowPhrase,
      why_shows_in_window: whyShowsInWindow,
      why_excludes_out_of_window: whyExcludesOutOfWindow,
      message_text: message,
    },
  ];
}

const drivers = {
  "au02-candidate-adoption-bridge": driveCandidateAdoptionBridge,
  "au05-adoption-safety-freshness": driveAdoptionSafetyFreshness,
  "au05-stale-conflict-cross-work-freshness": driveStaleConflictCrossWorkFreshness,
  "au05-conflict-cross-work-recovery": driveConflictCrossWorkRecovery,
  "au05-canon-conflict-recovery": driveCanonConflictRecovery,
  "p1-chapter-plan-minimum": driveP1ChapterPlanMinimum,
  "p1-chapter-draft-generation": driveP1ChapterDraftGeneration,
  "p1-chapter-adoption-reading": driveP1ChapterAdoptionReading,
  "p1-word-count-audit": driveP1WordCountAudit,
  "p1-chapter-edit-then-accept": driveP1ChapterEditThenAccept,
  "p1-chapter-overwrite-confirm": driveP1ChapterOverwriteConfirm,
  "au09-memory-create-recall": driveAu09MemoryCreateRecall,
  "au09-adopt-setting-recall": driveAu09AdoptSettingRecall,
  "au09-validity-window-recall": driveAu09ValidityWindowRecall,
  "au03-long-session-compression": driveLongSessionCompression,
  "au03-context-source-ui": driveContextSourceUi,
};

const driver = drivers[sliceId];
if (!driver) {
  throw new Error(`No external UI driver is implemented for ${sliceId}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("websocket", (ws) => {
  ws.on("framesent", (event) => recordFrame("sent", event.payload));
  ws.on("framereceived", (event) => recordFrame("received", event.payload));
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await serviceStatus(page).waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () => document.body.innerText.includes("服务: 已连接"),
    { timeout: 30_000 },
  );

  const uiRecords = await driver(page);

  fs.writeFileSync(path.join(artifactDir, "ui-frames.json"), JSON.stringify(frames, null, 2));
  fs.writeFileSync(path.join(artifactDir, "ui-state.json"), JSON.stringify(uiRecords, null, 2));
  await page.screenshot({
    path: path.join(artifactDir, `${sliceId}-external-ui.png`),
    fullPage: true,
  });
} catch (error) {
  fs.writeFileSync(path.join(artifactDir, "ui-frames.json"), JSON.stringify(frames, null, 2));
  await page.screenshot({
    path: path.join(artifactDir, "external-ui-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
