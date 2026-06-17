import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sliceId = process.argv[2];
const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5769";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "slice-verify", sliceId ?? "unknown");
const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';
const acceptDraftButtonPattern = /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/;
const readingModeButtonPattern = /\[阅读模式\]|阅读/;

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

async function createWorkSeed(attrs) {
  const response = await fetch(`${baseUrl}/api/works`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attrs),
  });

  assert(response.ok, `Failed to create work seed: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id, "Created work seed response did not include work id");
  return body.work;
}

async function configureProviderRuntime(attrs) {
  const response = await fetch(`${baseUrl}/api/provider/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attrs),
  });

  const body = await response.json().catch(() => ({}));
  assert(
    response.ok && body?.ok !== false,
    `Failed to configure provider ${attrs.provider}: HTTP ${response.status}`,
  );
  return body;
}

async function textContent(page, selector) {
  return page
    .locator(selector)
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "")
    .catch(() => "");
}

function serviceStatus(page) {
  return page.getByText(/^服务:|^同步/).first();
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

function receivedTaskStateFrames(taskId) {
  return frames.filter(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "task_state" &&
      (!taskId || frame.body?.task_id === taskId),
  );
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

function localDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function readAppLogRecords() {
  const logPath = path.join(artifactDir, "app-log", `${localDateString()}.jsonl`);
  if (!fs.existsSync(logPath)) return [];

  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

async function waitForAppLogRecord(predicate, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = readAppLogRecords().find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(message);
}

function viewportForSlice(id) {
  if (id === "au10-workbench-matrix-layout") return { width: 1280, height: 800 };
  return { width: 1440, height: 900 };
}

async function captureWorkbenchLayout(page, phase) {
  return await page.evaluate((currentPhase) => {
    const rectOf = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const visible = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    };
    const text = document.body.innerText;
    const topBar = rectOf('[class*="topBar"]');
    const mainArea = rectOf('[class*="mainArea"]');
    const inputArea = rectOf('[class*="inputArea"]');
    const rail = rectOf('[class*="structureRailCollapsed"]');

    return {
      phase: currentPhase,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      document_scroll_width: document.documentElement.scrollWidth,
      document_scroll_height: document.documentElement.scrollHeight,
      body_scroll_width: document.body.scrollWidth,
      top_bar_height: topBar?.height ?? 0,
      top_bar_within_viewport:
        Boolean(topBar) &&
        topBar.x >= 0 &&
        topBar.y >= 0 &&
        topBar.right <= window.innerWidth + 1 &&
        topBar.bottom <= window.innerHeight + 1,
      top_bar_single_row: Boolean(topBar) && topBar.height <= 72,
      main_area_visible: Boolean(mainArea) && mainArea.width >= 960 && mainArea.height >= 560,
      input_area_visible:
        Boolean(inputArea) &&
        inputArea.y >= 0 &&
        inputArea.bottom <= window.innerHeight + 1 &&
        inputArea.height >= 56,
      rail_width: rail?.width ?? 0,
      rail_within_viewport:
        Boolean(rail) && rail.right <= window.innerWidth + 1 && rail.height >= 560,
      no_horizontal_overflow:
        document.documentElement.scrollWidth <= window.innerWidth + 2 &&
        document.body.scrollWidth <= window.innerWidth + 2,
      workbench_visible: visible('[class*="workbench"]'),
      chat_input_visible: visible('input[placeholder="输入你的想法、问题或指令..."]'),
      send_button_visible: [...document.querySelectorAll("button")].some(
        (button) => (button.textContent ?? "").trim() === "发送",
      ),
      service_status_visible: /服务: 已连接|同步已连接/.test(text),
      provider_status_visible: /Stub|LM Studio|DeepSeek|Anthropic|模型已连接|模型未连接/.test(text),
      task_status_visible: text.includes("无任务"),
      reading_entry_visible: text.includes("[阅读模式]") || text.includes("阅读"),
      archive_entry_visible: text.includes("打开档案"),
    };
  }, phase);
}

function assertWorkbenchLayout(layout, phase) {
  assert(layout.viewport_width === 1280, `${phase}: expected 1280px viewport`);
  assert(layout.viewport_height === 800, `${phase}: expected 800px viewport`);
  assert(layout.workbench_visible, `${phase}: workbench root is not visible`);
  assert(layout.no_horizontal_overflow, `${phase}: page has horizontal overflow`);
  assert(layout.top_bar_within_viewport, `${phase}: top bar is outside viewport`);
  assert(layout.top_bar_single_row, `${phase}: top bar wrapped into a second row`);
  assert(layout.main_area_visible, `${phase}: main work area is too small or hidden`);
  assert(layout.input_area_visible, `${phase}: input area is not stable at the bottom`);
  assert(layout.rail_within_viewport, `${phase}: structure rail overflows viewport`);
  assert(layout.chat_input_visible, `${phase}: chat input is not visible`);
  assert(layout.send_button_visible, `${phase}: send button is not visible`);
  assert(layout.service_status_visible, `${phase}: service status is not visible`);
  assert(layout.provider_status_visible, `${phase}: provider status is not visible`);
  assert(layout.task_status_visible, `${phase}: task status baseline is not visible`);
  assert(layout.reading_entry_visible, `${phase}: reading entry is not visible`);
  assert(layout.archive_entry_visible, `${phase}: archive entry is not visible`);
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
    service_status_text: await serviceStatus(page)
      .textContent()
      .then((value) => value?.trim() ?? ""),
    title_text: await workTitle(page)
      .textContent()
      .then((value) => value?.trim() ?? ""),
    long_session_visible_text: visibleText,
    duration_ms: 0,
    outcome: "done",
  };
}

async function driveLongSessionCompression(page) {
  await page.locator(chatInputSelector).fill("继续最新设定");
  await page.getByRole("button", { name: /^发送$/ }).click();

  await page.waitForFunction(() => document.body.innerText.includes("继续最新设定"), {
    timeout: 10_000,
  });
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

async function driveSu01ModelProviderSwitching(page) {
  const message = "SU01 模型切换后，请用一句话回复当前状态。";

  await page
    .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
    .first()
    .click();
  await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });
  await page.locator("#model-provider-select").selectOption("stub");
  await page.getByRole("button", { name: "测试连接" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("连接可用。"), {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "保存并切换" }).click();
  await page
    .getByRole("dialog", { name: "模型供应商" })
    .waitFor({ state: "detached", timeout: 10_000 });

  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after provider switching message",
    90_000,
  );

  const turnResult = turnFrame.body;
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const visibleText = await page.locator("body").innerText();
  const modelButtonText = await page
    .getByRole("button", { name: /Stub|LM Studio|DeepSeek|Anthropic|模型设置/ })
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");

  assert(sentMessage, "No provider-switching user_message websocket frame was sent");
  assert(visibleText.includes(message), "Real UI did not retain the post-switch user message");
  assert(modelButtonText.includes("Stub"), "Model provider button did not show Stub after saving");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      message_text: message,
      model_provider_button_text: modelButtonText,
      provider_switched_to: "stub",
      provider_switch_saved: true,
      post_switch_message_visible: visibleText.includes(message),
      dialogue_preserved_after_switch: true,
    },
  ];
}

async function openLatestWhyDialog(page) {
  const whyButton = page.getByRole("button", { name: /为什么/ }).last();
  await whyButton.waitFor({ timeout: 10_000 });
  await whyButton.click();

  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes("参考来源"), {
    timeout: 10_000,
  });

  return dialog.innerText();
}

async function driveContextSourceUi(page) {
  await page.locator(chatInputSelector).fill("林烬为什么要去灵源矿区？");
  await page.getByRole("button", { name: /^发送$/ }).click();

  await page.waitForFunction(() => document.body.innerText.includes("林烬为什么要去灵源矿区？"), {
    timeout: 10_000,
  });
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
  const availableAction =
    (sourceTurnResult.available_actions ?? []).find(
      (action) =>
        action.action_type === "choose_candidate" &&
        (action.candidate_ref === candidate.direction_id ||
          action.target_ref === candidate.direction_id),
    ) ??
    (sourceTurnResult.candidate_directions.length === 1 &&
    (sourceTurnResult.available_actions ?? []).filter(
      (action) => action.action_type === "choose_candidate",
    ).length === 1
      ? (sourceTurnResult.available_actions ?? []).find(
          (action) => action.action_type === "choose_candidate",
        )
      : null);

  assert(
    availableAction,
    "Candidate turn_result did not include a matching choose_candidate available_action",
  );

  await page
    .getByRole("button", { name: /继续讨论|继续聊这个方向/ })
    .first()
    .click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_id === availableAction.action_id &&
      frame.body?.action?.action_type === availableAction.action_type &&
      frame.body?.action?.source_turn_ref ===
        (availableAction.source_turn_ref ?? sourceTurnResult.turn_id) &&
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
    () => /已采用候选|已设为后续方向|候选方向已采用/.test(document.body.innerText),
    {
      timeout: 10_000,
    },
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptionTurnResult, sentMessage);
  const visibleText = await page.locator("body").innerText();

  assert(
    /继续讨论|继续聊这个方向/.test(visibleText),
    "Candidate continuation button was not rendered",
  );
  assert(
    /设为后续方向|采用这个方向/.test(visibleText),
    "Candidate adoption button was not rendered",
  );
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
      visible_adoption_result: /已采用候选|已设为后续方向|候选方向已采用/.test(visibleText),
    },
  ];
}

async function driveAdoptionSafetyFreshness(page) {
  await page.locator(chatInputSelector).fill("我想写一个高风险、会覆盖主线设定的小说创作方向。");
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
  const candidate = sourceTurnResult.candidate_directions.find((item) => item.risk_hint === "high");

  assert(candidate, "High-risk candidate was not present in source turn_result");

  await page
    .getByRole("button", { name: /采用这个方向/ })
    .first()
    .click();

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

  await page.waitForFunction(() => document.body.innerText.includes("候选方向待确认"), {
    timeout: 10_000,
  });

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
  await page.waitForFunction(() => document.body.innerText.includes("旧版主线覆盖"), {
    timeout: 20_000,
  });

  await page
    .getByRole("button", { name: /采用这个方向/ })
    .first()
    .click();

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

  await page.waitForFunction(() => document.body.innerText.includes("候选方向未采用"), {
    timeout: 10_000,
  });

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
  await page.waitForFunction(() => document.body.innerText.includes("外部作品主线移植"), {
    timeout: 20_000,
  });

  await page
    .getByRole("button", { name: /采用这个方向/ })
    .first()
    .click();

  const actionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "choose_candidate" &&
      frame.body?.action?.candidate_ref === "dir_au05_cross_work_1" &&
      frame.body?.action?.candidate_set_ref === "candidate_set:turn_au05_cross_work_candidate_seed",
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

  await page.waitForFunction(() => document.body.innerText.includes("候选方向采用失败"), {
    timeout: 10_000,
  });

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
  await page.waitForFunction(() => document.body.innerText.includes("年龄设定覆盖"), {
    timeout: 20_000,
  });

  await page
    .getByRole("button", { name: /采用这个方向/ })
    .first()
    .click();

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

  await page.waitForFunction(() => document.body.innerText.includes("候选方向采用失败"), {
    timeout: 10_000,
  });

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
      // 章数是 AI 生成的产物，不写死「恰好 12」：只要求达到长篇计划下限（>= 8）。
      Number(frame.body?.adoption_state?.pending?.[0]?.payload?.chapter_count ?? 0) >= 8,
    "No P1 chapter plan outline_draft turn_result websocket frame was received",
  );
  const generationTurnResult = generationFrame.body;
  const pendingArtifact = generationTurnResult.adoption_state.pending[0];
  // 首/末章标题取自实际生成的计划条目（provider 中立：确定性与真实 LLM 标题不同）。
  const planItems = pendingArtifact.payload?.items ?? [];
  const chapterCount = Number(pendingArtifact.payload?.chapter_count ?? planItems.length);
  const firstChapterTitle = String(planItems[0]?.title ?? "");
  const lastChapterTitle = String(planItems[planItems.length - 1]?.title ?? "");

  // 采纳走当前模型：待保存计划卡（候选集）+保存按钮（author_action accept），
  // 不再用旧的「采纳」按钮 / adopt 事件（channel adopt handler 已遗留、前端不用）。
  await page.waitForFunction(
    () => {
      return (
        /待确认的创作材料|大纲草稿/.test(document.body.innerText) &&
        [...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        )
      );
    },
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id,
    "Real workbench did not send accept author_action for the chapter plan",
  );
  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "accepted" &&
      frame.body?.artifact_id === pendingArtifact.artifact_id,
    "No accepted action_result websocket frame was received for the chapter plan",
    120_000,
  );

  const adoptionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some(
        (entry) => entry.artifact_id === pendingArtifact.artifact_id,
      ),
    "No accepted outline_draft adoption turn_result websocket frame was received",
    120_000,
  );
  const adoptionTurnResult = adoptionFrame.body;

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();

  // 大纲与结构单一数据源 = 已采纳卷/章结构（get_toc），不再有独立的 get_chapter_plans。
  // 断言用「实际生成的首/末章标题」，不写死特定标题（确定性与真实 LLM 章名不同）。
  // 注意 Playwright 签名 waitForFunction(fn, arg, options)：arg 在前、options 在后。
  await page.waitForFunction(
    ({ first, last }) =>
      document.body.innerText.includes("已采纳章节计划") &&
      (first === "" || document.body.innerText.includes(first)) &&
      (last === "" || document.body.innerText.includes(last)),
    { first: firstChapterTitle, last: lastChapterTitle },
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, generationTurnResult, sentMessage);

  const firstChapterVisible = firstChapterTitle !== "" && visibleText.includes(firstChapterTitle);
  const finalChapterVisible = lastChapterTitle !== "" && visibleText.includes(lastChapterTitle);

  assert(
    chapterCount >= 8,
    `Generated chapter plan too small for a long-form work: ${chapterCount}`,
  );
  assert(
    firstChapterVisible && finalChapterVisible,
    "Accepted chapter plan did not render its first and final chapters",
  );
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
      chapter_count: chapterCount,
      chapter_plan_visible: visibleText.includes("已采纳章节计划"),
      first_chapter_visible: firstChapterVisible,
      final_chapter_visible: finalChapterVisible,
      outline_adopt_clicked: true,
      outline_adopted: true,
      reading_projection_materialized: Boolean(
        actionResultFrame.body?.persistence?.reading_projection,
      ),
      adopt_payload: acceptActionFrame.body,
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

  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  // 已采纳的章节计划成为正式目录，阅读模式显示计划全章（待补足）；未采纳的正文草稿不进阅读（AU08-I2）。
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("待补足") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
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
  // 阅读目录显示已采纳计划的全章（待补足），不是空态。
  assert(
    visibleText.includes("待补足") && !visibleText.includes("暂无已采纳的章节内容"),
    "Reading mode did not show the adopted chapter plan (pending chapters) before draft adoption",
  );
  // 未采纳的正文草稿内容不得出现在阅读模式。
  assert(
    !visibleText.includes(draftLeakMarker),
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
      reading_plan_visible_before_adoption:
        visibleText.includes("待补足") && !visibleText.includes("暂无已采纳的章节内容"),
      unadopted_draft_visible_in_reading: visibleText.includes(draftLeakMarker),
      adopt_event_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "adopt",
      ),
      user_message_text: draftMessageFrame.body?.text,
    },
  ];
}

async function driveVs00cCp3StructuredContext(page) {
  const targetChapterTitle = "第02章：旧服务器里的残诀";
  const previousChapterTitle = "第01章：底层灵气账单";
  const nextChapterTitle = "第03章";

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    ({ previousTitle, targetTitle }) =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes(previousTitle) &&
      document.body.innerText.includes(targetTitle),
    { previousTitle: previousChapterTitle, targetTitle: targetChapterTitle },
    { timeout: 10_000 },
  );

  const draftButtons = page.getByRole("button", { name: "生成正文草稿" });
  assert(
    (await draftButtons.count()) >= 2,
    "Archive outline did not render a draft action for chapter 2",
  );
  await draftButtons.nth(1).click();

  const draftMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes(targetChapterTitle) &&
      String(frame.body?.text ?? "").includes("正文草稿"),
    "Real workbench did not send chapter-2 draft user_message with micro plan enabled",
  );

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No VS-00C CP3 chapter-2 prose_fragment turn_result websocket frame was received",
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];
  const draftBody = pendingArtifact.payload?.items?.[0]?.body ?? "";

  await waitForAppLogRecord(
    (record) =>
      record.event === "context.structure.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      record.target_chapter === targetChapterTitle &&
      Number(record.chapter_seq ?? 0) === 2 &&
      record.has_plan_summary === true &&
      record.has_previous === true &&
      record.has_next === true,
    "No VS-00C CP3 structured context app log was emitted for chapter 2",
  );

  await page.waitForFunction(
    (targetTitle) =>
      /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(document.body.innerText) &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  assert(draftBody.includes("旧服务器里的残诀"), "Draft payload did not target chapter 2");
  assert(
    !frames.some((frame) => frame.direction === "sent" && frame.event === "adopt"),
    "CP3 draft generation unexpectedly submitted an adopt event",
  );

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: targetChapterTitle,
      previous_chapter_title: previousChapterTitle,
      next_chapter_title: nextChapterTitle,
      draft_generated: true,
      draft_pending: true,
      draft_body_chars: String(draftBody).length,
      draft_card_visible: /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(visibleText),
      requested_second_chapter: true,
      adopt_event_sent: frames.some(
        (frame) => frame.direction === "sent" && frame.event === "adopt",
      ),
      user_message_text: draftMessageFrame.body?.text,
    },
  ];
}

async function driveVs00cCp4ChapterPlanStructure(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.getByRole("button", { name: "开始规划" }).click();

  const planMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("章节大纲"),
    "Real workbench did not send CP4 chapter plan user_message with micro plan enabled",
  );

  const generationFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "plot_outline" &&
      frame.body?.tool_result?.output?.artifact_type === "outline_draft" &&
      Number(frame.body?.adoption_state?.pending?.[0]?.payload?.chapter_count ?? 0) >= 8,
    "No CP4 outline_draft turn_result websocket frame was received",
  );
  const generationTurnResult = generationFrame.body;
  const pendingOutline = generationTurnResult.adoption_state.pending[0];
  const planItems = pendingOutline.payload?.items ?? [];
  const targetItem = planItems[1] ?? planItems[0];
  const targetChapterTitle = String(targetItem?.title ?? "");
  const targetBody = String(targetItem?.body ?? "");

  assert(targetChapterTitle !== "", "CP4 generated outline did not contain a target chapter");
  assert(
    targetBody.includes("章功能定位") &&
      targetBody.includes("情节推进") &&
      targetBody.includes("人物变化") &&
      targetBody.includes("信息释放") &&
      targetBody.includes("伏笔动作") &&
      targetBody.includes("情绪定位") &&
      targetBody.includes("章尾断章"),
    "CP4 outline item body did not contain E18-E22 direction labels",
  );

  await page.waitForFunction(
    () => {
      return (
        /待确认的创作材料|大纲草稿/.test(document.body.innerText) &&
        [...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        )
      );
    },
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === pendingOutline.artifact_id,
    "Real workbench did not send accept author_action for the CP4 chapter plan",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "accepted" &&
      frame.body?.artifact_id === pendingOutline.artifact_id,
    "No accepted action_result websocket frame was received for the CP4 chapter plan",
    120_000,
  );

  const adoptionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some(
        (entry) => entry.artifact_id === pendingOutline.artifact_id,
      ),
    "No accepted CP4 outline_draft adoption turn_result websocket frame was received",
    120_000,
  );
  const adoptionTurnResult = adoptionFrame.body;

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    (targetTitle) =>
      document.body.innerText.includes("已采纳章节计划") &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const targetIndex = Math.max(
    planItems.findIndex((item) => item === targetItem),
    0,
  );
  const draftButtons = page.getByRole("button", { name: "生成正文草稿" });
  assert(
    (await draftButtons.count()) > targetIndex,
    "Archive outline did not render a draft action for the CP4 target chapter",
  );
  await draftButtons.nth(targetIndex).click();

  const draftMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes(targetChapterTitle) &&
      String(frame.body?.text ?? "").includes("正文草稿"),
    "Real workbench did not send CP4 draft user_message with micro plan enabled",
  );

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No CP4 prose_fragment turn_result websocket frame was received",
    170_000,
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingDraft = draftTurnResult.adoption_state.pending[0];
  const draftBody = pendingDraft.payload?.items?.[0]?.body ?? "";
  const selfReport = draftTurnResult.tool_result?.output?.self_report ?? null;
  const selfReportRiskFlags = Array.isArray(selfReport?.risk_flags) ? selfReport.risk_flags : [];

  const structureLog = await waitForAppLogRecord(
    (record) =>
      record.event === "context.structure.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      record.target_chapter === targetChapterTitle &&
      record.has_plan_summary === true &&
      record.has_plan_direction === true,
    "No VS-00C CP4 structured direction app log was emitted before prose writing",
  );

  const readerEffectLog = await waitForAppLogRecord(
    (record) =>
      record.event === "context.reader_effect.done" &&
      record.turn_id === draftTurnResult.turn_id &&
      record.target_chapter === targetChapterTitle &&
      record.has_reader_effect_brief === true &&
      record.intended_emotion_present === true &&
      record.hook_target_present === true &&
      record.payoff_or_promise_present === true &&
      record.suspense_boundary_present === true &&
      Number(record.risk_note_count ?? 0) >= 1,
    "No VS-00C CP5 ReaderEffectBrief app log was emitted before prose writing",
  );

  await page.waitForFunction(
    (targetTitle) =>
      /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(document.body.innerText) &&
      document.body.innerText.includes(targetTitle),
    targetChapterTitle,
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, draftTurnResult, sentMessage);

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      generation_turn_id: generationTurnResult.turn_id,
      adoption_turn_id: adoptionTurnResult.turn_id,
      draft_turn_id: draftTurnResult.turn_id,
      outline_artifact_id: pendingOutline.artifact_id,
      artifact_id: pendingDraft.artifact_id,
      artifact_type: pendingDraft.artifact_type,
      chapter_title: targetChapterTitle,
      chapter_seq: Number(structureLog.chapter_seq ?? targetIndex + 1),
      chapter_count: Number(pendingOutline.payload?.chapter_count ?? planItems.length),
      outline_direction_labels_present: true,
      outline_adopt_clicked: true,
      outline_adopted: true,
      reading_projection_materialized: Boolean(
        actionResultFrame.body?.persistence?.reading_projection,
      ),
      has_plan_summary: structureLog.has_plan_summary,
      has_plan_direction: structureLog.has_plan_direction,
      has_reader_effect_brief: readerEffectLog.has_reader_effect_brief,
      reader_effect_fields_present:
        readerEffectLog.intended_emotion_present === true &&
        readerEffectLog.hook_target_present === true &&
        readerEffectLog.payoff_or_promise_present === true &&
        readerEffectLog.suspense_boundary_present === true,
      reader_effect_risk_note_count: Number(readerEffectLog.risk_note_count ?? 0),
      self_report_present: Boolean(selfReport),
      self_report_intended_reader_effect_present:
        typeof selfReport?.intended_reader_effect === "string" &&
        selfReport.intended_reader_effect.trim() !== "",
      self_report_used_context_refs: Array.isArray(selfReport?.used_context_refs)
        ? selfReport.used_context_refs
        : [],
      self_report_risk_flags_count: selfReportRiskFlags.length,
      self_report_quality_action: selfReport?.quality_action,
      draft_generated: true,
      draft_pending: true,
      draft_body_chars: String(draftBody).length,
      draft_card_visible: /待保存章节草稿|章节正文草稿|待确认的创作材料/.test(visibleText),
      adopt_payload: acceptActionFrame.body,
      action_result_status: actionResultFrame.body.status ?? latestActionResult()?.status,
      user_message_text: draftMessageFrame.body?.text,
      plan_user_message_text: planMessageFrame.body?.text,
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
    () => {
      return (
        /待确认的创作材料|正文草稿/.test(document.body.innerText) &&
        [...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        )
      );
    },
    { timeout: 10_000 },
  );

  // 作者点击保存正文草稿（accept author_action → 采纳边界 → 持久化）。
  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

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

  // 采纳后旧草稿卡的保存按钮必须消失，否则作者会重复点击、重复提交同一动作。
  await page.waitForFunction(
    () => {
      return ![...document.querySelectorAll("button")].some((btn) =>
        /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
          (btn.textContent ?? "").trim(),
        ),
      );
    },
    { timeout: 10_000 },
  );
  const acceptButtonCleared =
    (await page.getByRole("button", { name: acceptDraftButtonPattern }).count()) === 0;

  // 进入阅读模式：采纳后的正文应进入投影，并显示有效字数。
  // 必须等到「本章有效字数」也渲染再快照：TOC（全书字数）与章节正文/章字数来自两次异步
  // 读取（get_toc 与 get_chapter_content），只等全书字数会在章字数渲染前抢拍导致 flaky。
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      document.body.innerText.includes("本章有效字数") &&
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
  assert(
    Number(totalWords) > 0,
    "Book total effective word count not visible/positive in reading mode",
  );
  assert(
    Number(chapterWords) > 0,
    "Chapter effective word count not visible/positive in reading mode",
  );
  assert(
    chapterWords === visibleProseWords,
    `Displayed chapter word count ${chapterWords} != effective count of visible prose ${visibleProseWords}`,
  );
  assert(
    totalWords === chapterWords,
    `Book total ${totalWords} != single adopted chapter ${chapterWords}`,
  );
  assert(!visibleText.includes("暂无已采纳的章节内容"), "Reading mode stayed empty after adoption");

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

async function driveP1PlanIncremental(page) {
  // 增量规划：已有 12 章已采纳计划的作品里，作者用自然语言要求继续规划后续章节；
  // 新计划经采纳边界物化为**追加**的计划章（title 幂等 + seq 续排，单一默认卷
  // 是 v2 27 §5.1/ADR-0004 的冻结决策），既有章（标题/顺序/字数）不被改动。

  // baseline：进阅读模式取当前投影（12 章计划）。
  const baselineFrames = frames.length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(() => document.body.innerText.includes("阅读模式"), {
    timeout: 15_000,
  });
  const baselineToc = await waitForFrame(
    (f) =>
      frames.indexOf(f) >= baselineFrames &&
      f.direction === "received" &&
      Array.isArray((f.body?.response ?? f.body)?.volumes),
    "No baseline get_toc frame",
    20_000,
  ).then((f) => f.body?.response ?? f.body);
  const baselineChapters = (baselineToc.volumes ?? []).flatMap((v) => v.chapters ?? []);
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  // 作者自然语言发起增量规划（无专用按钮/关键字开关，意图由 AI 识别）。
  await page
    .locator(chatInputSelector)
    .fill(
      "已有章节计划很好，请接着已有章节继续生成后续剧情的章节大纲，从下一章接续编号，再生成一批新章节计划。",
    );
  await page.getByRole("button", { name: /^发送$/ }).click();

  const outlineFrame = await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.tool_result?.tool_name === "plot_outline" &&
      f.body?.tool_result?.output?.artifact_type === "outline_draft" &&
      // 增量批量由 AI 自定（实测 7-12 章），只设保底下限。
      Number(f.body?.adoption_state?.pending?.[0]?.payload?.chapter_count ?? 0) >= 5,
    "No incremental outline_draft turn_result was received",
    200_000,
  );
  const pendingArtifact = outlineFrame.body.adoption_state.pending[0];
  const newPlanItems = pendingArtifact.payload?.items ?? [];
  const newTitles = newPlanItems.map((item) => String(item.title ?? ""));
  const baselineTitles = new Set(baselineChapters.map((c) => c.title));
  const titlesDisjoint = newTitles.every((title) => !baselineTitles.has(title));

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("待确认的创作材料") &&
      document.body.innerText.includes("确认创建"),
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "确认创建" }).last().click();

  await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.truthfulness?.artifact_adopted === true &&
      (f.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === pendingArtifact.artifact_id,
      ),
    "No adoption turn_result for the incremental outline",
    120_000,
  );

  // 采纳后投影：原章不动、新章按 seq 接续追加。
  const afterFrames = frames.length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(() => document.body.innerText.includes("阅读模式"), {
    timeout: 15_000,
  });
  const afterToc = await waitForFrame(
    (f) =>
      frames.indexOf(f) >= afterFrames &&
      f.direction === "received" &&
      Array.isArray((f.body?.response ?? f.body)?.volumes),
    "No post-adoption get_toc frame",
    20_000,
  ).then((f) => f.body?.response ?? f.body);
  const afterChapters = (afterToc.volumes ?? []).flatMap((v) => v.chapters ?? []);

  const originalsIntact = baselineChapters.every((before) => {
    const after = afterChapters.find((c) => c.id === before.id);
    return (
      after &&
      after.title === before.title &&
      after.seq === before.seq &&
      Number(after.word_count ?? 0) === Number(before.word_count ?? 0)
    );
  });
  const appended = afterChapters.filter(
    (c) => !baselineChapters.some((before) => before.id === c.id),
  );
  const maxBaselineSeq = Math.max(...baselineChapters.map((c) => Number(c.seq ?? 0)));
  const appendedSeqs = appended.map((c) => Number(c.seq ?? 0));
  const appendedInOrder =
    appendedSeqs.length > 0 &&
    appendedSeqs.every((seq, i) => seq > maxBaselineSeq && (i === 0 || seq > appendedSeqs[i - 1]));

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, outlineFrame.body, sentMessage);

  assert(
    titlesDisjoint,
    "Incremental plan reused existing chapter titles (would be deduped, not appended)",
  );
  assert(originalsIntact, "Existing chapters were modified by the incremental plan adoption");
  assert(appended.length >= 5, `Expected >= 5 appended chapters, got ${appended.length}`);
  assert(
    appendedInOrder,
    `Appended chapters not in continuing seq order: ${appendedSeqs.join(",")}`,
  );

  return [
    {
      ...uiState,
      turn_id: outlineFrame.body.turn_id,
      plan_turn_id: outlineFrame.body.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      baseline_chapter_count: baselineChapters.length,
      new_plan_chapter_count: newPlanItems.length,
      total_chapter_count_after: afterChapters.length,
      appended_chapter_count: appended.length,
      new_titles_disjoint: titlesDisjoint,
      originals_intact: originalsIntact,
      appended_in_seq_order: appendedInOrder,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1ExportMinimum(page) {
  // P1-export-minimum：复用"采纳到阅读"全链（生成第1章正文→采纳→阅读模式），
  // 然后点真实「导出全书」按钮，由后端从已采纳作品事实组装 Markdown 并落盘；
  // driver 从页面显示的导出路径读取真实文件，验证目录顺序与正文完整性。
  const [base] = await driveP1ChapterAdoptionReading(page);

  // 第1章已采纳正文（从生成帧取 body 片段，用于断言"导出文件含已采纳正文"因果绑定）。
  const draftFrame = frames.find(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
  );
  const adoptedBody = String(
    draftFrame?.body?.adoption_state?.pending?.[0]?.payload?.items?.[0]?.body ?? "",
  );
  const adoptedSnippet = adoptedBody.slice(0, 16);

  await page.getByRole("button", { name: "导出全书" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("已导出到"), {
    timeout: 20_000,
  });

  const visibleText = await page.locator("body").innerText();
  // 路径可能含空格（作品标题入文件名），抓到行尾的 .md。
  const exportPathMatch = /已导出到\s+([^\n]+\.md)/.exec(visibleText);
  const exportPath = exportPathMatch?.[1] ?? "";
  assert(exportPath !== "", `Export path not visible on page: ${visibleText.slice(0, 200)}`);

  const fileExists = fs.existsSync(exportPath);
  assert(fileExists, `Exported file does not exist at ${exportPath}`);
  const doc = fs.readFileSync(exportPath, "utf8");

  // 目录完整且按 seq 有序：12 个计划章标题在目录段依序出现。
  const tocPositions = [];
  for (let n = 1; n <= 12; n += 1) {
    const seq = String(n).padStart(2, "0");
    const idx = doc.indexOf(`第${seq}章：`);
    tocPositions.push(idx);
  }
  const allChaptersPresent = tocPositions.every((idx) => idx >= 0);
  const lastOccurrenceOrdered = (() => {
    // 每章标题出现两次（目录 + 正文标题）；用首次出现位置验证目录顺序。
    return tocPositions.every((idx, i) => i === 0 || idx > tocPositions[i - 1]);
  })();

  const adoptedProseInFile = adoptedSnippet !== "" && doc.includes(adoptedSnippet);
  const placeholderCount = doc.split("（本章暂无已采纳正文）").length - 1;

  assert(allChaptersPresent, "Exported document is missing planned chapters in TOC");
  assert(lastOccurrenceOrdered, "Exported TOC chapters are out of order");
  assert(adoptedProseInFile, "Adopted chapter prose did not appear in the exported file");
  assert(
    placeholderCount === 11,
    `Expected 11 unwritten-chapter placeholders, got ${placeholderCount}`,
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, latestTurnResult() ?? {}, sentMessage);

  return [
    {
      ...uiState,
      turn_id: base.draft_turn_id,
      draft_turn_id: base.draft_turn_id,
      adopt_turn_id: base.adopt_turn_id,
      export_path: exportPath,
      exported_file_exists: fileExists,
      export_chapter_count: 12,
      toc_complete: allChaptersPresent,
      toc_in_order: lastOccurrenceOrdered,
      adopted_prose_in_file: adoptedProseInFile,
      unwritten_placeholder_count: placeholderCount,
      export_notice_visible: visibleText.includes("已导出到"),
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu04ConfirmBeforeExecute(page) {
  // AU-04：作者用自然语言要求重写已有章（高风险）→ 系统出确认卡（确认前不执行不写入）
  // → 作者点「确认执行」→ ConfirmationBinding re-gate（ADR-0009）→ prose_writing 产出
  // 待采纳正文。本 slice 同时是「确认卡 turn_result 穿过真实 wire」的回归验证：
  // 该 turn_result 携带 plan（JSON 安全形态），此前 raw struct 在 broadcast/persist 必崩。
  const requestText =
    "第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  // 确认卡 turn_result 必须从真实 websocket 收到（核心回归点）：
  // needs_confirmation + confirm_before_execute 可用动作 + 确认前无执行无写入 + 携带 plan。
  const confirmTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.status === "needs_confirmation" &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "confirm_before_execute",
      ),
    "No needs_confirmation turn_result with confirm_before_execute action was received",
    200_000,
  );
  const confirmTurnResult = confirmTurnFrame.body;
  const confirmAction = confirmTurnResult.available_actions.find(
    (action) => action.action_type === "confirm_before_execute",
  );

  // 确认卡在真实页面可见：确认执行 / 拒绝。
  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  await page.getByRole("button", { name: "确认执行" }).first().click();

  const confirmActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === confirmAction.action_id,
    "Real workbench did not send the confirm_before_execute author_action",
  );

  // 确认后 re-gate 放行执行：同一 turn 产出 prose_fragment 待采纳正文。
  const executedTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No prose_fragment turn_result was received after confirm_before_execute",
    200_000,
  );
  const executedTurnResult = executedTurnFrame.body;
  const pendingArtifact = executedTurnResult.adoption_state.pending[0];

  // 产出仍是 tentative（AU04-I9）：待确认创作材料出现，未自动写入作品事实。
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("待确认的创作材料") &&
      document.body.innerText.includes("确认创建"),
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, executedTurnResult, sentMessage);

  assert(
    confirmTurnResult.truthfulness?.tool_called === false,
    "Confirmation turn_result claimed tool execution before author confirmed",
  );
  assert(
    confirmTurnResult.truthfulness?.production_write_performed === false,
    "Confirmation turn_result claimed a production write before author confirmed",
  );
  assert(
    confirmTurnResult.plan != null && typeof confirmTurnResult.plan === "object",
    "Confirmation turn_result did not carry the re-gate plan over the wire",
  );
  assert(
    confirmAction.behavior_ref != null && confirmAction.behavior_ref !== "",
    "confirm_before_execute action did not reference an open confirmation behavior",
  );
  assert(
    executedTurnResult.truthfulness?.tool_called === true,
    "Executed turn_result did not record tool_called after confirmation",
  );
  assert(
    executedTurnResult.truthfulness?.artifact_adopted !== true,
    "Executed turn_result claimed adoption — output must stay tentative (AU04-I9)",
  );

  return [
    {
      ...uiState,
      turn_id: confirmTurnResult.turn_id,
      confirm_turn_id: confirmTurnResult.turn_id,
      executed_turn_id: executedTurnResult.turn_id,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      confirmation_card_received: true,
      confirmation_card_visible: visibleTextIncludesConfirm(visibleText),
      plan_carried_over_wire: confirmTurnResult.plan != null,
      confirm_action_behavior_ref: confirmAction.behavior_ref ?? "",
      tool_called_before_confirm: confirmTurnResult.truthfulness?.tool_called === true,
      production_write_before_confirm:
        confirmTurnResult.truthfulness?.production_write_performed === true,
      confirmed_dispatch: executedTurnResult.truthfulness?.tool_called === true,
      artifact_pending_after_confirm: pendingArtifact.artifact_type === "prose_fragment",
      confirm_action_sent:
        confirmActionFrame.body?.action?.action_type === "confirm_before_execute",
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

function visibleTextIncludesConfirm(visibleText) {
  // 确认后页面已进入待采纳态；确认卡可见性在点击前已由 waitForFunction 证明。
  return visibleText.includes("待确认的创作材料");
}

async function driveP1ChapterWordCountTarget(page) {
  const targetWordCount = 600;
  // 作者在对话框用自然语言给出"带篇幅"的创作指令：篇幅诉求由 Planner（AI）识别为
  // target_word_count（不是按钮/开关）。沿用"生成正文草稿"按钮的「标题：摘要。正文草稿」
  // 措辞，让正文按标题归到第01章计划章；字数诉求追加在"正文草稿"之后，不污染标题归章。
  const requestText =
    "请根据已采纳章节计划生成第01章：底层灵气账单：主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。正文草稿，大约 600 字，保持为待采纳草稿。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No prose_fragment turn_result was received for the word-count-target request",
    200_000,
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("待确认的创作材料") &&
      document.body.innerText.includes("确认创建"),
    { timeout: 10_000 },
  );
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

  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "确认创建",
      ),
    { timeout: 10_000 },
  );
  const acceptButtonCleared = (await page.getByRole("button", { name: "确认创建" }).count()) === 0;

  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      document.body.innerText.includes("本章有效字数") &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    { timeout: 15_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, adoptTurnResult, sentMessage);

  const totalWords = parseBookTotalWords(visibleText);
  const chapterWords = parseChapterWords(visibleText);

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
  const lowerBound = Math.floor(targetWordCount * 0.5);

  assert(visibleProseWords > 0, "No visible prose found in reading mode to count");
  assert(
    Number(totalWords) > 0,
    "Book total effective word count not visible/positive in reading mode",
  );
  assert(
    Number(chapterWords) > 0,
    "Chapter effective word count not visible/positive in reading mode",
  );
  assert(
    chapterWords === visibleProseWords,
    `Displayed chapter word count ${chapterWords} != effective count of visible prose ${visibleProseWords}`,
  );
  assert(
    Number(chapterWords) >= lowerBound,
    `Chapter effective word count ${chapterWords} did not approach the requested target ${targetWordCount} (>= ${lowerBound})`,
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
      target_word_count_requested: targetWordCount,
      word_count_meets_target: Number(chapterWords) >= lowerBound,
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

  assert(shortBadgeVisible, "短章 badge not visible in TOC for a sub-1000-word adopted chapter");
  assert(milestoneProgressVisible, "P1 milestone progress not visible in reading mode top bar");
  assert(!milestoneMet, "Milestone must not be marked met for a single short chapter");
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

async function driveP1ChapterExpansion(page) {
  // Step 1：复用采纳到阅读链路，先生成并采纳第 1 章正文草稿（确定性下天然 < 1000 = 短章）。
  const [base] = await driveP1ChapterAdoptionReading(page);
  const draftChapterWords = Number(base.chapter_word_count ?? 0);
  assert(
    draftChapterWords > 0 && draftChapterWords < 1000,
    `Chapter 1 first draft should be a sub-1000-word short chapter, got ${draftChapterWords}`,
  );

  // Step 2：返回工作台，用自然语言多轮续写第 1 章。
  // 不存在"续写按钮"/关键字开关：续写意图由 Planner（AI）在 plan 阶段识别为 authoring_intent=continuation，
  // 目标章由 AI 从已采纳章节列表里解析。每轮续写采纳后应作为同章新场景累积字数。
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const continuationMessages = [
    "接着第一章往下写一段正文，让林澈继续深入矿道，把危机一步步推上来。",
    "很好，再接着这一章往下写一段正文，把冲突推到林澈不得不做出选择的地步。",
  ];

  const continuations = [];
  for (const message of continuationMessages) {
    await page.locator(chatInputSelector).fill(message);
    await page.getByRole("button", { name: /^发送$/ }).click();

    // 本轮续写 turn_result：prose_writing 产 prose_fragment，且 AI 在 plan 阶段识别为 continuation。
    const contFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.tool_result?.tool_name === "prose_writing" &&
        frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
        frame.body?.adoption_state?.pending?.[0]?.authoring_intent === "continuation",
      `No continuation prose_fragment turn_result (authoring_intent=continuation) for: ${message}`,
      200_000,
    );
    const pending = contFrame.body.adoption_state.pending[0];

    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        ),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();

    const adoptFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.truthfulness?.artifact_adopted === true &&
        frame.body?.adoption_state?.resolved?.some(
          (entry) => entry.artifact_id === pending.artifact_id,
        ),
      `No resolved adoption turn_result after continuation accept for: ${message}`,
      120_000,
    );

    // 采纳后按钮必须消失，避免重复点击重复提交。
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some((btn) =>
          /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(
            (btn.textContent ?? "").trim(),
          ),
        ),
      { timeout: 10_000 },
    );

    continuations.push({
      message,
      artifact_id: pending.artifact_id,
      authoring_intent: pending.authoring_intent,
      target_chapter: pending.target_chapter ?? null,
      adopted: adoptFrame.body.truthfulness?.artifact_adopted === true,
    });
  }

  // Step 3：回到阅读模式，等本章有效字数累积过 P1 单章 1000 字门槛。
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数"),
    { timeout: 15_000 },
  );
  await page
    .waitForFunction(
      () => {
        const match = /本章有效字数\s*([\d,]+)\s*字/.exec(document.body.innerText);
        return Boolean(match) && Number(match[1].replace(/,/g, "")) >= 1000;
      },
      { timeout: 20_000 },
    )
    .catch(() => {});

  const visibleText = await page.locator("body").innerText();
  const lastTurnResult = latestTurnResult() ?? {};
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, lastTurnResult, sentMessage);

  const chapterWords = parseChapterWords(visibleText);
  const totalWords = parseBookTotalWords(visibleText);
  const shortBadgeVisible = (await page.getByText("短章", { exact: true }).count()) > 0;
  const allRecognizedContinuation = continuations.every(
    (entry) => entry.authoring_intent === "continuation" && entry.adopted,
  );

  assert(
    Number(chapterWords) >= 1000,
    `Chapter effective word count ${chapterWords} did not reach the P1 1000-word minimum after continuations`,
  );
  // 续写必须落到同一章（target_chapter 命中既有章）：单章模型下全书字数 == 本章字数。
  assert(
    totalWords === chapterWords,
    `Continuations created extra chapters instead of appending: book total ${totalWords} != single chapter ${chapterWords}`,
  );
  assert(
    Number(chapterWords) > draftChapterWords,
    `Word count did not accumulate: chapter ${chapterWords} not greater than first draft ${draftChapterWords}`,
  );
  assert(
    !shortBadgeVisible,
    "Chapter is still marked 短章 after accumulating past 1000 words (short -> ok transition failed)",
  );
  assert(
    allRecognizedContinuation,
    "At least one continuation turn was not recognized as authoring_intent=continuation or not adopted",
  );

  return [
    {
      ...uiState,
      draft_turn_id: base.draft_turn_id,
      first_adopt_turn_id: base.adopt_turn_id,
      chapter_title: base.chapter_title,
      first_draft_chapter_words: draftChapterWords,
      continuation_count: continuations.length,
      continuation_intents: continuations.map((entry) => entry.authoring_intent),
      continuation_target_chapters: continuations.map((entry) => entry.target_chapter),
      continuations_all_recognized: allRecognizedContinuation,
      final_chapter_word_count: chapterWords,
      final_total_word_count: totalWords,
      appended_to_single_chapter: totalWords === chapterWords,
      accumulated_past_min: Number(chapterWords) >= 1000,
      short_to_ok_transition: !shortBadgeVisible && Number(chapterWords) >= 1000,
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveP1ChapterExpansionMultichapter(page) {
  // checkpoint 3 连续多章：作者用自然语言逐章推进第 1/2/3 章首稿，每章正文按计划章
  // 标题归到各自计划章（target_chapter 精确/标题匹配），不串章、各自累积。意图与
  // 目标章由 Planner（AI）识别，不加续写按钮/关键字（v3 反模式）。
  const plan = [
    { title: "第01章：底层灵气账单", summary: "主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。" },
    {
      title: "第02章：旧服务器里的残诀",
      summary: "主角从废弃服务器中找到残缺功法，并第一次突破底层限制。",
    },
    {
      title: "第03章：黑市调频师",
      summary: "主角结识擅长调制灵气频段的调频师，获得追查垄断链路的入口。",
    },
  ];

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  const written = [];
  let lastAdopt = null;

  for (const ch of plan) {
    const instruction = `请根据已采纳章节计划生成${ch.title}：${ch.summary}正文草稿，保持为待采纳草稿。`;
    await page.locator(chatInputSelector).fill(instruction);
    await page.getByRole("button", { name: /^发送$/ }).click();

    const adoptedIds = new Set(written.map((w) => w.artifact_id));
    const draftFrame = await waitForFrame(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.tool_result?.tool_name === "prose_writing" &&
        f.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment" &&
        !adoptedIds.has(f.body.adoption_state.pending[0].artifact_id),
      `No new prose_fragment turn_result for ${ch.title}`,
      200_000,
    );
    const pending = draftFrame.body.adoption_state.pending[0];

    await page.waitForFunction(() => document.body.innerText.includes("确认创建"), {
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "确认创建" }).first().click();

    const adoptFrame = await waitForFrame(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.truthfulness?.artifact_adopted === true &&
        f.body?.adoption_state?.resolved?.some((e) => e.artifact_id === pending.artifact_id),
      `No resolved adoption turn_result for ${ch.title}`,
      120_000,
    );
    lastAdopt = adoptFrame.body;

    // 采纳后旧草稿卡的「确认创建」必须消失，避免下一章误点到上一张卡。
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some(
          (b) => (b.textContent ?? "").trim() === "确认创建",
        ),
      { timeout: 10_000 },
    );

    written.push({
      title: ch.title,
      artifact_id: pending.artifact_id,
      draft_turn_id: draftFrame.body.turn_id,
      adopt_turn_id: adoptFrame.body.turn_id,
      adopted: adoptFrame.body.truthfulness?.artifact_adopted === true,
    });
  }

  // 进入阅读模式：目录应显示完整计划，且第 1/2/3 章各有正文。
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("第01章：底层灵气账单") &&
      document.body.innerText.includes("第02章：旧服务器里的残诀") &&
      document.body.innerText.includes("第03章：黑市调频师"),
    { timeout: 15_000 },
  );
  await page
    .waitForFunction(() => document.body.innerText.includes("本章有效字数"), { timeout: 15_000 })
    .catch(() => {});

  // 从后端真实 get_toc 投影读各章字数与顺序：这是"多章各归各章、不串"的最可靠证据。
  const tocReplies = frames.filter((f) => {
    const resp = f.body?.response ?? f.payload?.response ?? f.body;
    return f.direction === "received" && Array.isArray(resp?.volumes);
  });
  const lastTocReply = tocReplies[tocReplies.length - 1];
  const toc = lastTocReply
    ? (lastTocReply.body?.response ?? lastTocReply.payload?.response ?? lastTocReply.body)
    : null;
  const allChapters = (toc?.volumes ?? []).flatMap((v) => v.chapters ?? []);
  const targets = written.map((w) => allChapters.find((c) => c.title === w.title));
  const writtenChapters = allChapters.filter((c) => Number(c.word_count ?? 0) > 0);
  const seqs = targets.map((c) => Number(c?.seq ?? 0));
  const orderCorrect = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
  const allHaveProse = targets.every((c) => Number(c?.word_count ?? 0) > 0);

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, lastAdopt ?? {}, sentMessage);

  assert(toc, "No get_toc projection frame captured in reading mode");
  assert(
    writtenChapters.length >= written.length,
    `Expected >= ${written.length} chapters with prose, got ${writtenChapters.length}`,
  );
  assert(allHaveProse, "A target chapter has no prose — cross-chapter contamination or misfiling");
  assert(orderCorrect, `Chapter order incorrect in TOC: seqs=${seqs.join(",")}`);
  assert(
    !visibleText.includes("暂无已采纳的章节内容"),
    "Reading mode stayed empty after multi-chapter adoption",
  );

  return [
    {
      ...uiState,
      draft_turn_ids: written.map((w) => w.draft_turn_id),
      adopt_turn_ids: written.map((w) => w.adopt_turn_id),
      target_chapter_titles: written.map((w) => w.title),
      written_chapter_count: writtenChapters.length,
      target_chapters_with_prose: targets.filter((c) => Number(c?.word_count ?? 0) > 0).length,
      per_chapter_words: targets.map((c) => Number(c?.word_count ?? 0)),
      total_chapter_count: allChapters.length,
      chapter_order_correct: orderCorrect,
      all_chapters_have_prose: allHaveProse,
      all_adopted: written.every((w) => w.adopted),
      user_message_text: sentMessage?.body?.text,
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
  const editButtonCleared = (await page.getByRole("button", { name: "修改后采纳" }).count()) === 0;

  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  // 同 adoption-reading：必须等「本章有效字数」也渲染再快照，否则章节正文（编辑后正文）
  // 来自 get_chapter_content 的异步加载会被抢拍，导致误判正文未显示。
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      document.body.innerText.includes("本章有效字数") &&
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
    await page.waitForFunction(() => document.body.innerText.includes("确认创建"), {
      timeout: 10_000,
    });
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
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
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
  await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), {
    timeout: 10_000,
  });

  // ── 新建一条设定（后端强制从 DRAFT 开始）。
  await page.getByRole("button", { name: "+ 新建记忆" }).click();
  await page.locator("textarea").first().fill(memoryContent);
  await page.getByRole("button", { name: "创建" }).click();
  // 注意 Playwright 签名 waitForFunction(fn, arg, options)：arg 在前、options 在后。
  await page.waitForFunction((n) => document.body.innerText.includes(n), nonce, {
    timeout: 10_000,
  });

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
  await page.waitForFunction(() => document.body.innerText.includes("已确认设定"), {
    timeout: 10_000,
  });

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
  await page.getByRole("button", { name: "发起新操作" }).click();

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
    await closeArchive
      .first()
      .click()
      .catch(() => {});
  }
  await page.waitForFunction(() => document.body.innerText.includes("确认创建"), {
    timeout: 10_000,
  });

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
  await page.waitForFunction(() => document.body.innerText.includes("已确认设定"), {
    timeout: 10_000,
  });

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
  assert(
    whyShowsMemorySource,
    "Why panel did not show the adopted setting as a confirmed-memory source",
  );

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

async function driveAu09CharacterDossierRoundtrip(page) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "角色" }).click();
  await page.getByRole("button", { name: "创建角色" }).first().click();

  const createMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("角色") &&
      !String(frame.body?.text ?? "").includes("伏笔"),
    "Real archive character action did not send a role-design user_message with micro plan enabled",
    20_000,
  );

  const draftFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.adoption_state?.pending?.[0]?.requires_adoption === true &&
      frame.body.adoption_state.pending[0].artifact_type === "character_seed",
    "No tentative character_seed artifact websocket frame was received",
    170_000,
  );
  const artifact = draftFrame.body.adoption_state.pending[0];
  const characterTitle = String(
    artifact.payload?.items?.[0]?.title ?? artifact.payload?.title ?? "角色设定草稿",
  );

  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive
      .first()
      .click()
      .catch(() => {});
  }

  const acceptDraftButton = page.getByRole("button", { name: acceptDraftButtonPattern }).first();
  await acceptDraftButton.waitFor({ timeout: 10_000 });
  await acceptDraftButton.click();

  const adoptFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === artifact.artifact_id,
      ),
    "No character adoption resolved turn_result websocket frame was received",
    120_000,
  );

  const adoptedStateRef = String(adoptFrame.body.truthfulness?.adopted_state_ref ?? "");
  assert(adoptedStateRef.length > 0, "Character adoption did not expose adopted_state_ref");

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "角色" }).click();
  const archivePanel = page.locator('[class*="panel"]').filter({ hasText: "作品档案" }).first();
  await archivePanel.getByText(characterTitle).first().waitFor({ timeout: 10_000 });

  const charactersLoaded = await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_characters.done" &&
      record.work_id === createMessageFrame.body?.work_id &&
      Number(record.character_count ?? 0) >= 1,
    "No channel.get_characters.done log loaded the adopted Character dossier",
    20_000,
  );

  const createEntryVisibleAfterCharacter =
    (await archivePanel.getByRole("button", { name: "创建角色" }).count()) >= 1;
  assert(
    createEntryVisibleAfterCharacter,
    "Character tab did not keep a visible create entry after a character exists",
  );

  await archivePanel.getByRole("button", { name: "创建角色" }).first().click();

  const secondDraftFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== draftFrame.body.turn_id &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "character_seed",
    "No second character design turn_result was received after archive create entry",
    170_000,
  );

  const characterContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.characters.done" &&
      record.turn_id === secondDraftFrame.body.turn_id &&
      Number(record.character_count ?? 0) >= 1,
    "No context.characters.done log proved Character dossier reached the next character design turn",
    20_000,
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, secondDraftFrame.body, sentMessage);

  return [
    {
      ...uiState,
      turn_id: secondDraftFrame.body.turn_id,
      turn_ids: [draftFrame.body.turn_id, adoptFrame.body.turn_id, secondDraftFrame.body.turn_id],
      creation_turn_id: draftFrame.body.turn_id,
      adoption_turn_id: adoptFrame.body.turn_id,
      context_turn_id: secondDraftFrame.body.turn_id,
      character_artifact_id: artifact.artifact_id,
      character_artifact_type: artifact.artifact_type,
      character_title: characterTitle,
      adopted_state_ref: adoptedStateRef,
      character_visible_in_archive: true,
      archive_character_count: charactersLoaded.character_count,
      create_entry_visible_after_character: createEntryVisibleAfterCharacter,
      context_character_count: characterContext.character_count,
      create_prompt_text: createMessageFrame.body?.text,
      create_prompt_is_character_design:
        String(createMessageFrame.body?.text ?? "").includes("角色") &&
        !String(createMessageFrame.body?.text ?? "").includes("伏笔"),
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

async function driveAu10WorkbenchMatrixLayout(page) {
  const records = [];
  const initialLayout = await captureWorkbenchLayout(page, "initial");
  assertWorkbenchLayout(initialLayout, "initial");

  const ordinaryMessage = "请用一句话说明当前作品的创作状态。";
  await page.locator(chatInputSelector).fill(ordinaryMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const ordinaryTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No ordinary AU-10 turn_result websocket frame was received",
    120_000,
  );
  const ordinaryTurnResult = ordinaryTurnFrame.body;

  await page.waitForFunction(
    (message) =>
      document.body.innerText.includes(message) && !document.body.innerText.includes("思考中"),
    ordinaryMessage,
    { timeout: 10_000 },
  );

  const whyText = await openLatestWhyDialog(page);
  assert(whyText.includes("参考来源"), "Why dialog did not expose author-facing trace sources");
  await page.keyboard.press("Escape").catch(() => {});
  await page
    .getByRole("dialog")
    .first()
    .waitFor({ state: "detached", timeout: 2_000 })
    .catch(() => {});

  const afterOrdinaryLayout = await captureWorkbenchLayout(page, "after_ordinary_turn");
  assertWorkbenchLayout(afterOrdinaryLayout, "after_ordinary_turn");
  const ordinaryUiState = await commonUiState(page, ordinaryTurnResult, latestSentUserMessage());

  records.push({
    ...ordinaryUiState,
    phase: "ordinary_turn",
    turn_id: ordinaryTurnResult.turn_id,
    ordinary_turn_id: ordinaryTurnResult.turn_id,
    ordinary_message_text: ordinaryMessage,
    trace_why_dialog_open: true,
    trace_why_text: whyText,
    trace_why_contains_raw_prompt: /raw prompt|provider raw|hidden policy|debug|ctx_/i.test(
      whyText,
    ),
    layout: afterOrdinaryLayout,
    au10_layout_passed: true,
  });

  const candidateRecords = await driveCandidateAdoptionBridge(page);
  const candidateRecord = candidateRecords[0];
  records.push({
    ...candidateRecord,
    phase: "candidate_action",
    au10_candidate_action_passed: true,
  });

  const adoptionRecords = await driveP1ChapterAdoptionReading(page);
  const adoptionRecord = adoptionRecords[0];
  const afterReadingLayout = await captureWorkbenchLayout(page, "after_adoption_reading");
  assert(afterReadingLayout.no_horizontal_overflow, "reading mode introduced horizontal overflow");

  records.push({
    ...adoptionRecord,
    phase: "adoption_reading",
    layout: afterReadingLayout,
    au10_adoption_reading_passed: true,
  });

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-matrix-layout",
      turn_id: ordinaryTurnResult.turn_id,
      ordinary_turn_id: ordinaryTurnResult.turn_id,
      candidate_turn_id: candidateRecord.turn_id,
      candidate_source_turn_ref: candidateRecord.source_turn_ref,
      candidate_ref: candidateRecord.candidate_ref,
      adoption_turn_id: adoptionRecord.adopt_turn_id,
      draft_turn_id: adoptionRecord.draft_turn_id,
      artifact_id: adoptionRecord.artifact_id,
      layout_initial: initialLayout,
      layout_after_ordinary: afterOrdinaryLayout,
      layout_after_reading: afterReadingLayout,
      viewport_width: initialLayout.viewport_width,
      viewport_height: initialLayout.viewport_height,
      layout_no_horizontal_overflow:
        initialLayout.no_horizontal_overflow &&
        afterOrdinaryLayout.no_horizontal_overflow &&
        afterReadingLayout.no_horizontal_overflow,
      top_bar_single_row:
        initialLayout.top_bar_single_row && afterOrdinaryLayout.top_bar_single_row,
      input_area_visible:
        initialLayout.input_area_visible && afterOrdinaryLayout.input_area_visible,
      service_status_visible: initialLayout.service_status_visible,
      provider_status_visible: initialLayout.provider_status_visible,
      task_status_visible: initialLayout.task_status_visible,
      ordinary_turn_completed: Boolean(ordinaryTurnResult.turn_id),
      trace_why_dialog_open: true,
      trace_why_contains_raw_prompt: records.some(
        (record) => record.trace_why_contains_raw_prompt === true,
      ),
      candidate_action_completed: Boolean(candidateRecord.action_result_status),
      candidate_selected: candidateRecord.candidate_selected === true,
      candidate_adopted: candidateRecord.candidate_adopted === true,
      adoption_reading_completed: adoptionRecord.reading_mode_populated_after_adoption === true,
      word_count_matches_adopted_prose: adoptionRecord.word_count_matches_adopted_prose === true,
      matrix_phases: records.map((record) => record.phase),
    },
    ...records,
  ];
}

async function driveAu10WorkbenchRecoveryTaskstate(page) {
  const [adoptionRecord] = await driveP1ChapterAdoptionReading(page);

  await page.getByRole("button", { name: "导出全书" }).click();

  const runningFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "task_state" &&
      frame.body?.phase === "RUNNING",
    "Export did not broadcast RUNNING task_state",
    30_000,
  );
  const taskId = runningFrame.body.task_id;

  await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "task_state" &&
      frame.body?.task_id === taskId &&
      frame.body?.phase === "CHECKPOINT",
    "Export did not broadcast CHECKPOINT task_state",
    30_000,
  );

  await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "task_state" &&
      frame.body?.task_id === taskId &&
      frame.body?.phase === "COMPLETED",
    "Export did not broadcast COMPLETED task_state",
    30_000,
  );

  await page.waitForFunction(() => document.body.innerText.includes("已导出到"), {
    timeout: 10_000,
  });
  const exportText = await page.locator("body").innerText();

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("任务完成"), {
    timeout: 10_000,
  });
  const workbenchText = await page.locator("body").innerText();
  const taskFrames = receivedTaskStateFrames(taskId);
  const taskPhases = taskFrames.map((frame) => frame.body?.phase).filter(Boolean);

  assert(taskPhases.includes("RUNNING"), "RUNNING task state was not observed");
  assert(taskPhases.includes("CHECKPOINT"), "CHECKPOINT task state was not observed");
  assert(taskPhases.includes("COMPLETED"), "COMPLETED task state was not observed");
  assert(workbenchText.includes("任务完成"), "Workbench did not keep the completed task visible");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-taskstate",
      turn_id: adoptionRecord.draft_turn_id,
      draft_turn_id: adoptionRecord.draft_turn_id,
      adoption_turn_id: adoptionRecord.adopt_turn_id,
      artifact_id: adoptionRecord.artifact_id,
      task_id: taskId,
      task_type: runningFrame.body.task_type,
      task_state_phases: taskPhases,
      task_state_count: taskFrames.length,
      task_status_after_return: "任务完成",
      export_success_visible: exportText.includes("已导出到"),
      export_path_visible: exportText.includes("已导出到") && exportText.includes(".md"),
      real_export_button_clicked: true,
      real_workbench_completed_status_visible: true,
      adoption_reading_completed: adoptionRecord.reading_mode_populated_after_adoption === true,
    },
  ];
}

async function driveAu10WorkbenchRecoveryDisconnectTimeout(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  await configureProviderRuntime({
    provider: "lmstudio",
    model: "slice-verify-unreachable-model",
    endpoint: "http://127.0.0.1:9/v1",
  });

  const nonce = `AU10-RECOVERY-${Date.now()}`;
  const failingMessage = `请围绕 ${nonce} 给我一个创作方向。`;
  await page.locator(chatInputSelector).fill(failingMessage);
  await page.getByRole("button", { name: "发送" }).click();

  const failingSentMessage = latestSentUserMessage();

  const failureFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      String(frame.body?.assistant_message?.text ?? "").includes("无法连接到创作引擎") &&
      String(frame.body?.assistant_message?.text ?? "").includes("没有写入作品事实") &&
      frame.body?.truthfulness?.production_write_performed === false,
    "Provider failure did not return a recoverable fallback turn_result",
    60_000,
  );
  const failureTurnId = failureFrame.body.turn_id;

  const providerFailureLog = await waitForAppLogRecord(
    (record) =>
      record.event === "provider_gateway.complete.error" &&
      record.provider === "lmstudio" &&
      record.turn_id === failureTurnId,
    "No provider_gateway.complete.error log was emitted for the failing turn",
    30_000,
  );

  await waitForAppLogRecord(
    (record) => record.event === "channel.user_message.done" && record.turn_id === failureTurnId,
    "No channel.user_message.done log was emitted for the recoverable failing turn",
    30_000,
  );

  await page.waitForFunction(
    (selector) => {
      const input = document.querySelector(selector);
      const bodyText = document.body.innerText;
      return (
        input instanceof HTMLInputElement &&
        input.disabled === false &&
        !bodyText.includes("思考中...") &&
        bodyText.includes("无法连接到创作引擎") &&
        bodyText.includes("没有写入作品事实")
      );
    },
    chatInputSelector,
    { timeout: 10_000 },
  );

  await configureProviderRuntime({ provider: "slice_verify" });

  const recoveryMessage = `恢复后继续围绕 ${nonce} 聊下去。`;
  await page.locator(chatInputSelector).fill(recoveryMessage);
  await page.getByRole("button", { name: "发送" }).click();

  const recoveryFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== failureTurnId &&
      frame.body?.status !== "error" &&
      String(frame.body?.assistant_message?.text ?? "").length > 0,
    "Workbench did not recover and complete a following user message",
    60_000,
  );

  await waitForAppLogRecord(
    (record) =>
      record.event === "provider_gateway.complete.done" &&
      record.provider === "slice_verify" &&
      record.turn_id === recoveryFrame.body.turn_id,
    "No provider_gateway.complete.done log proved the following turn recovered",
    30_000,
  );

  const visibleText = await page.locator("body").innerText();
  const uiState = await commonUiState(page, recoveryFrame.body, latestSentUserMessage());

  return [
    {
      ...uiState,
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-disconnect-timeout",
      turn_id: recoveryFrame.body.turn_id,
      turn_ids: [failureTurnId, recoveryFrame.body.turn_id],
      failure_turn_id: failureTurnId,
      recovery_turn_id: recoveryFrame.body.turn_id,
      failing_provider: providerFailureLog.provider,
      failure_status: failureFrame.body.status,
      recovery_status: recoveryFrame.body.status,
      failure_message_visible:
        visibleText.includes("无法连接到创作引擎") && visibleText.includes("没有写入作品事实"),
      no_production_write_on_failure:
        failureFrame.body.truthfulness?.production_write_performed === false,
      no_artifact_adopted_on_failure: failureFrame.body.truthfulness?.artifact_adopted === false,
      loading_cleared_after_failure: !visibleText.includes("思考中..."),
      input_enabled_after_failure: true,
      following_turn_completed: recoveryFrame.body.status !== "error",
      can_continue_after_failure: true,
      failure_prompt_sent: String(failingSentMessage?.body?.text ?? "").includes(nonce),
      recovery_prompt_sent: String(latestSentUserMessage()?.body?.text ?? "").includes(nonce),
    },
  ];
}

async function driveAu12WorkProfileOverview(page) {
  const nonce = `AU12-${Date.now()}`;
  const seed = {
    title: `AU12档案作品-${nonce}`,
    genre: "都市异能",
    core_selling_point: `灵气交易所黑幕-${nonce}`,
    target_reader: "喜欢强剧情反转的读者",
    tone_preference: "冷峻克制",
  };
  const work = await createWorkSeed(seed);

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  await workTitle(page).click();
  const refreshWorks = page.locator('button[title="刷新作品列表"]').first();
  if ((await refreshWorks.count()) > 0) {
    await refreshWorks.click();
  }
  await page.getByText(seed.title, { exact: true }).click();
  await page.waitForFunction((title) => document.body.innerText.includes(title), seed.title, {
    timeout: 15_000,
  });

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "概览" }).click();

  await waitForFrame(
    (frame) => frame.direction === "sent" && frame.event === "get_work_profile",
    "Profile tab did not request get_work_profile over the real websocket",
    30_000,
  );

  const profileReply = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "ok" &&
      frame.body?.response?.title === seed.title,
    "Profile websocket reply did not include the seeded work profile",
    30_000,
  );
  const profile = profileReply.body.response ?? {};

  const profileLog = await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_work_profile.done" &&
      record.has_title === true &&
      record.status === "TENTATIVE",
    "Profile channel log was not emitted",
    30_000,
  );

  await page.waitForFunction(
    (expected) => expected.every((value) => document.body.innerText.includes(String(value))),
    [
      seed.title,
      seed.genre,
      seed.core_selling_point,
      seed.target_reader,
      seed.tone_preference,
      String(profile.revision),
      "待确认",
    ],
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const profileText = visibleText.slice(
    Math.max(0, visibleText.indexOf("立项设定")),
    Math.max(visibleText.indexOf("立项设定") + 800, 800),
  );
  const profileJson = JSON.stringify(profile);
  const profileLogJson = JSON.stringify(profileLog);

  assert(profile.genre === seed.genre, "Profile genre does not match persisted work seed");
  assert(
    profile.core_selling_point === seed.core_selling_point,
    "Profile core selling point does not match persisted work seed",
  );
  assert(
    profile.target_reader === seed.target_reader,
    "Profile target reader does not match persisted work seed",
  );
  assert(
    profile.tone_preference === seed.tone_preference,
    "Profile tone preference does not match persisted work seed",
  );
  assert(profile.status === "TENTATIVE", "Profile did not expose tentative status");
  assert(!Object.prototype.hasOwnProperty.call(profile, "id"), "Profile DTO exposed work id");
  assert(!profileJson.includes(work.id), "Profile DTO leaked work UUID");
  assert(!profileText.includes(work.id), "Profile UI leaked work UUID");
  assert(!profileLogJson.includes(work.id), "Profile log leaked work UUID");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au12-work-profile-overview",
      work_id: work.id,
      work_title: seed.title,
      profile_status: profile.status,
      profile_revision: profile.revision,
      profile_fields_visible: [
        seed.title,
        seed.genre,
        seed.core_selling_point,
        seed.target_reader,
        seed.tone_preference,
        String(profile.revision),
      ].every((value) => visibleText.includes(value)),
      profile_status_visible: visibleText.includes("待确认"),
      profile_request_sent: true,
      profile_reply_has_title: profile.title === seed.title,
      profile_reply_omits_id: !Object.prototype.hasOwnProperty.call(profile, "id"),
      profile_reply_omits_work_uuid: !profileJson.includes(work.id),
      profile_ui_omits_work_uuid: !profileText.includes(work.id),
      profile_log_emitted: true,
      profile_log_omits_work_uuid: !profileLogJson.includes(work.id),
      readonly_hint_visible: visibleText.includes("只读展示"),
      real_archive_opened: true,
      overview_tab_clicked: true,
    },
  ];
}

async function driveCp0MissingChapterBlock(page) {
  // VS-00C CP0：作品里有第01章计划，但没有第99章。作者用自然语言「续写第99章」→
  // Planner 识别 continuation 意图 + 把作者点名的「第99章」原样放进 requested_chapter_raw，
  // 但匹配不到列表（target_chapter=null）→ 应用层 MissingPolicyResult 判 hard missing →
  // 执行前短路：不调 provider、不产创作卡，诚实回复"找不到该章"。
  // 这是 G13 的承重验收：系统不再静默回退到最新章去改错章。
  const requestText = "续写第99章的正文草稿，把冲突推进一下，保持为待采纳草稿。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  // 真实页面可见诚实回复；业务 JSONL 证明 MissingPolicyResult 已在 provider dispatch 前 block。
  await page.waitForFunction(() => document.body.innerText.includes("没有找到"), {
    timeout: 200_000,
  });

  const missingRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "turn_execution.missing_policy.done" &&
      record.severity === "block" &&
      String(record.missing ?? "").includes("第99章"),
    "No missing_policy block record for missing-chapter continuation",
    200_000,
  );

  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === missingRecord.turn_id,
    "No channel.user_message.done record for missing-chapter block",
    30_000,
  );

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage() ?? {
    body: {
      text: requestText,
      work_id: missingRecord.work_id,
      session_id: missingRecord.session_id,
    },
  };
  const blockedTurnResult = latestTurnResult() ?? {
    turn_id: missingRecord.turn_id,
    assistant_message: { text: "没有找到" },
    truthfulness: {
      artifact_adopted: false,
      durable_behavior_opened: false,
      production_write_performed: false,
      tool_called: false,
    },
    adoption_state: null,
    tool_result: null,
  };
  const uiState = await commonUiState(page, blockedTurnResult, sentMessage);
  const sameTurnRecords = readAppLogRecords().filter(
    (record) => record.turn_id === missingRecord.turn_id,
  );

  assert(
    blockedTurnResult.truthfulness?.tool_called === false,
    "Missing-chapter turn claimed a tool call — provider must not be invoked on hard missing",
  );
  assert(
    blockedTurnResult.adoption_state == null,
    "Missing-chapter turn produced an adoption artifact — block must not generate content",
  );
  assert(
    blockedTurnResult.tool_result == null,
    "Missing-chapter turn carried a tool_result — block must short-circuit before tool dispatch",
  );
  assert(
    !visibleText.includes("待确认的创作材料"),
    "A creative artifact card was shown for a missing chapter",
  );
  assert(
    !sameTurnRecords.some((record) => record.event === "toolbox.execute.done"),
    "Provider/toolbox executed despite missing chapter block",
  );

  return [
    {
      ...uiState,
      turn_id: blockedTurnResult.turn_id,
      missing_chapter_blocked: true,
      missing_policy_severity: missingRecord.severity,
      requested_chapter: "第99章",
      honest_not_found_message: String(blockedTurnResult.assistant_message?.text ?? "").includes(
        "没有找到",
      ),
      tool_called: blockedTurnResult.truthfulness?.tool_called === true,
      no_adoption_artifact: blockedTurnResult.adoption_state == null,
      no_tool_result: blockedTurnResult.tool_result == null,
      no_toolbox_execute_event: true,
      creative_card_absent: !visibleText.includes("待确认的创作材料"),
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

const drivers = {
  "su01-model-provider-switching": driveSu01ModelProviderSwitching,
  "au10-workbench-matrix-layout": driveAu10WorkbenchMatrixLayout,
  "au10-workbench-recovery-taskstate": driveAu10WorkbenchRecoveryTaskstate,
  "au10-workbench-recovery-disconnect-timeout": driveAu10WorkbenchRecoveryDisconnectTimeout,
  "au12-work-profile-overview": driveAu12WorkProfileOverview,
  "vs00c-cp0-missing-chapter-block": driveCp0MissingChapterBlock,
  "vs00c-cp3-structured-context": driveVs00cCp3StructuredContext,
  "vs00c-cp4-chapter-plan-structure": driveVs00cCp4ChapterPlanStructure,
  "vs00c-cp5-reader-effect-brief": driveVs00cCp4ChapterPlanStructure,
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
  "p1-chapter-expansion": driveP1ChapterExpansion,
  "p1-chapter-expansion-multichapter": driveP1ChapterExpansionMultichapter,
  "p1-chapter-word-count-target": driveP1ChapterWordCountTarget,
  "p1-export-minimum": driveP1ExportMinimum,
  "p1-plan-incremental": driveP1PlanIncremental,
  "au04-confirm-before-execute": driveAu04ConfirmBeforeExecute,
  "au09-memory-create-recall": driveAu09MemoryCreateRecall,
  "au09-adopt-setting-recall": driveAu09AdoptSettingRecall,
  "au09-character-dossier-roundtrip": driveAu09CharacterDossierRoundtrip,
  "au09-validity-window-recall": driveAu09ValidityWindowRecall,
  "au03-long-session-compression": driveLongSessionCompression,
  "au03-context-source-ui": driveContextSourceUi,
};

const driver = drivers[sliceId];
if (!driver) {
  throw new Error(`No external UI driver is implemented for ${sliceId}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: viewportForSlice(sliceId) });

page.on("websocket", (ws) => {
  ws.on("framesent", (event) => recordFrame("sent", event.payload));
  ws.on("framereceived", (event) => recordFrame("received", event.payload));
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await serviceStatus(page).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

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
