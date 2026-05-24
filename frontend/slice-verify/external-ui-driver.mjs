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

  await page.getByRole("button", { name: /继续聊这个方向/ }).first().click();

  const continuationFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.candidate_selection?.candidate_ref === candidate.direction_id &&
      frame.body?.candidate_selection?.source_turn_ref === sourceTurnResult.turn_id,
    "Real workbench did not send candidate_selection for continuation",
  );

  const continuationTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id !== sourceTurnResult.turn_id &&
      !frame.body?.adoption_decision,
    "No continuation turn_result websocket frame was received",
  );

  await page.getByRole("button", { name: /采用这个方向/ }).first().click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === candidate.direction_id &&
      frame.body?.action?.candidate_set_ref === `candidate_set:${sourceTurnResult.turn_id}`,
    "Real workbench did not send authorized choose_candidate author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.action_type === "choose_candidate" &&
      frame.body?.candidate_ref === candidate.direction_id,
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
      continuation_turn_id: continuationTurnFrame.body.turn_id,
      adoption_turn_id: adoptionTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      candidate_panel_count: await page.locator("[class*=candidatePanel]").count(),
      candidate_continue_clicked: true,
      candidate_adopt_clicked: true,
      continuation_candidate_selection: continuationFrame.body.candidate_selection,
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

const drivers = {
  "au02-candidate-adoption-bridge": driveCandidateAdoptionBridge,
  "au05-adoption-safety-freshness": driveAdoptionSafetyFreshness,
  "au05-stale-conflict-cross-work-freshness": driveStaleConflictCrossWorkFreshness,
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
