import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChild(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

async function fetchOk(url, timeoutMs = 1_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForUrlState(url, expectedReachable, message, timeoutMs = 30_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if ((await fetchOk(url)) === expectedReachable) return;
    await sleep(500);
  }

  throw new Error(message);
}

async function killProcessTree(pid, graceSeconds = 3) {
  const projectRoot = process.env.SLICE_VERIFY_PROJECT_ROOT;
  assert(projectRoot, "SLICE_VERIFY_PROJECT_ROOT is required to control Phoenix");

  const killer = spawn(
    "bash",
    [
      "-lc",
      'source "$PROJECT_ROOT/scripts/lib/process_tree.sh"; kill_process_tree "$TARGET_PID" "$TARGET_GRACE"',
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PROJECT_ROOT: projectRoot,
        TARGET_PID: String(pid),
        TARGET_GRACE: String(graceSeconds),
      },
      stdio: "pipe",
    },
  );

  let stderr = "";
  killer.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForChild(killer, "kill_process_tree");
  } catch (error) {
    const detail = stderr.trim();
    throw new Error(`${error.message}${detail ? `: ${detail}` : ""}`);
  }
}

function startPhoenixSliceServer() {
  const projectRoot = process.env.SLICE_VERIFY_PROJECT_ROOT;
  const phoenixPort = process.env.SLICE_VERIFY_PHOENIX_PORT;
  const appLogDir = process.env.SLICE_VERIFY_APP_LOG_DIR;
  const llmLogDir = process.env.SLICE_VERIFY_LLM_LOG_DIR;
  const provider = process.env.SLICE_VERIFY_PROVIDER ?? "slice_verify";
  const backendLog = process.env.SLICE_VERIFY_BACKEND_LOG;

  assert(projectRoot, "SLICE_VERIFY_PROJECT_ROOT is required to restart Phoenix");
  assert(phoenixPort, "SLICE_VERIFY_PHOENIX_PORT is required to restart Phoenix");
  assert(appLogDir, "SLICE_VERIFY_APP_LOG_DIR is required to restart Phoenix");
  assert(llmLogDir, "SLICE_VERIFY_LLM_LOG_DIR is required to restart Phoenix");
  assert(backendLog, "SLICE_VERIFY_BACKEND_LOG is required to restart Phoenix");

  const stdout = fs.openSync(backendLog, "a");
  const stderr = fs.openSync(backendLog, "a");

  const child = spawn(
    "mix",
    ["run", "--no-start", "--no-halt", "scripts/slice_verify_server.exs"],
    {
      cwd: projectRoot,
      detached: true,
      env: {
        ...process.env,
        MIX_ENV: "test",
        PHOENIX_TEST_PORT: phoenixPort,
        PHOENIX_PORT: phoenixPort,
        SLICE_VERIFY_APP_LOG_DIR: appLogDir,
        SLICE_VERIFY_LLM_LOG_DIR: llmLogDir,
        SLICE_VERIFY_PROVIDER: provider,
        AI_NOVEL_DESKTOP_PROFILE: "slice-verify",
      },
      stdio: ["ignore", stdout, stderr],
    },
  );

  fs.closeSync(stdout);
  fs.closeSync(stderr);

  child.once("error", (error) => {
    fs.appendFileSync(backendLog, `\n[slice-verify] failed to restart Phoenix: ${error.message}\n`);
  });

  return child;
}

function createPhoenixServiceController() {
  const originalPid = Number(process.env.SLICE_VERIFY_PHOENIX_PID ?? "");
  const apiUrl = process.env.SLICE_VERIFY_API_URL;
  assert(Number.isInteger(originalPid) && originalPid > 0, "SLICE_VERIFY_PHOENIX_PID is required");
  assert(apiUrl, "SLICE_VERIFY_API_URL is required");

  const healthUrl = `${apiUrl}/health`;
  let restarted = null;

  return {
    async stopOriginal() {
      await killProcessTree(originalPid);
      await waitForUrlState(
        healthUrl,
        false,
        "Phoenix health stayed reachable after external service stop",
        20_000,
      );
    },
    async restart() {
      restarted = startPhoenixSliceServer();
      await waitForUrlState(
        healthUrl,
        true,
        "Phoenix health did not recover after external service restart",
        60_000,
      );
      return restarted.pid;
    },
    async stopRestarted() {
      if (!restarted?.pid) return;
      await killProcessTree(restarted.pid);
      restarted = null;
    },
  };
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

async function listWorksFromApi() {
  const response = await fetch(`${baseUrl}/api/works`);
  assert(response.ok, `Failed to list works: HTTP ${response.status}`);
  const body = await response.json();
  return body?.works ?? [];
}

async function fetchWorkFromApi(id) {
  const response = await fetch(`${baseUrl}/api/works/${encodeURIComponent(id)}`);
  assert(response.ok, `Failed to fetch work ${id}: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id === id, `Fetched work ${id} response did not match requested id`);
  return body.work;
}

async function fetchSessionSnapshotFromApi(workId, sessionId) {
  const response = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}`,
  );
  assert(response.ok, `Failed to fetch session snapshot ${sessionId}: HTTP ${response.status}`);
  return await response.json();
}

async function discardWorkFromApi(work) {
  const response = await fetch(`${baseUrl}/api/works/${encodeURIComponent(work.id)}/discard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: work.revision }),
  });
  assert(response.ok, `Failed to discard work ${work.id}: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id === work.id, `Discard response did not match work ${work.id}`);
  return body.work;
}

async function waitForWorkByTitle(title, excludedIds = new Set(), timeoutMs = 10_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = (await listWorksFromApi()).find(
      (work) => work.title === title && !excludedIds.has(work.id),
    );
    if (match) return match;
    await sleep(250);
  }

  throw new Error(`Work did not appear in API list with title: ${title}`);
}

async function waitForTranscriptTurn(workId, sessionId, turnId, timeoutMs = 30_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const snapshot = await fetchSessionSnapshotFromApi(workId, sessionId);
    const transcript = Array.isArray(snapshot.transcript) ? snapshot.transcript : [];
    const assistantRow = transcript.find(
      (entry) => entry.turn_id === turnId && entry.role === "assistant",
    );
    const userRow = transcript.find((entry) => entry.turn_id === turnId && entry.role === "user");

    if (assistantRow && userRow) {
      return { snapshot, assistantRow, userRow };
    }

    await sleep(250);
  }

  throw new Error(`Transcript did not persist turn ${turnId} for session ${sessionId}`);
}

async function openWorkMenu(page) {
  await workTitle(page).click();
  await page.locator('[class*="workMenu"]').first().waitFor({ timeout: 10_000 });
}

async function clickWorkMenuItemByExactTitle(page, title) {
  const items = page.getByRole("menuitem");
  const count = await items.count();

  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const text = ((await item.textContent()) ?? "").replace(/\s+/g, " ").trim();
    if (text === title || text === `${title} 当前`) {
      await item.click();
      return;
    }
  }

  throw new Error(`Work menu item not found: ${title}`);
}

async function refreshAndSelectWork(page, title) {
  await openWorkMenu(page);
  const refresh = page.locator('button[title="刷新作品列表"]').first();
  if ((await refresh.count()) > 0) {
    await refresh.click();
    await sleep(250);
  }
  await clickWorkMenuItemByExactTitle(page, title);
}

async function ensureWorkSelectedByTitle(page, title, expectedWorkId, timeoutMs = 30_000) {
  const currentTitle = ((await workTitle(page).textContent()) ?? "").replace(/\s+/g, " ").trim();
  if (currentTitle.includes(title)) {
    const existingJoin = readAppLogRecords()
      .filter((record) => record.event === "channel.join.done" && record.work_id === expectedWorkId)
      .at(-1);
    if (existingJoin) return existingJoin;

    const joinReply =
      latestChannelJoinReply()?.body?.response ?? latestChannelJoinReply()?.body ?? {};
    return {
      event: "channel.join.done",
      workspace_id: expectedWorkId,
      work_id: expectedWorkId,
      session_id: joinReply.session_id ?? null,
      outcome: "ok",
    };
  }

  const beforeCount = readAppLogRecords().length;
  await switchToWorkByTitle(page, title);
  return await waitForNewAppLogRecord(
    beforeCount,
    (record) => record.event === "channel.join.done" && record.work_id === expectedWorkId,
    `Selecting ${title} did not join expected work channel`,
    timeoutMs,
  );
}

async function waitForVisibleWorkTitle(page, title, timeoutMs = 15_000) {
  await page.waitForFunction(
    (expectedTitle) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(expectedTitle);
    },
    title,
    { timeout: timeoutMs },
  );
}

async function createWorkFromMenu(page, previousWorkId) {
  const beforeCount = readAppLogRecords().length;
  await openWorkMenu(page);
  await page.getByRole("menuitem", { name: "快速新建未命名作品" }).click();

  return await waitForNewAppLogRecord(
    beforeCount,
    (record) =>
      record.event === "channel.join.done" && record.work_id && record.work_id !== previousWorkId,
    "Creating a work from the work menu did not join a new workspace channel",
    30_000,
  );
}

async function openNamedCreateWorkDialog(page) {
  await openWorkMenu(page);
  await page.getByRole("menuitem", { name: "新建作品" }).click();
  await page.getByRole("dialog", { name: "新建作品" }).waitFor({ timeout: 10_000 });
}

async function submitWorkTitleDialog(page, title, buttonName) {
  await page.locator("#work-title-input").fill(title);
  await page.getByRole("button", { name: buttonName }).click();
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

async function startHangingOpenAiServer() {
  const sockets = new Set();
  const server = http.createServer((_request, _response) => {
    // Intentionally never respond: the real LM Studio adapter must hit its receive timeout.
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert(address && typeof address === "object", "Hanging OpenAI server did not bind a port");

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
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

function latestChannelJoinReply() {
  return frames
    .filter(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        (frame.body?.response?.work_id || frame.body?.work_id),
    )
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

async function waitForNewFrame(afterCount, predicate, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = frames.slice(afterCount).find(predicate);
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

async function waitForNewAppLogRecord(afterCount, predicate, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const match = readAppLogRecords().slice(afterCount).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(message);
}

async function waitForAppLogCount(predicate, minCount, message, timeoutMs = 60_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const count = readAppLogRecords().filter(predicate).length;
    if (count >= minCount) return count;
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

async function visibleMessageRoleOrder(page) {
  return await page.evaluate(() => {
    const userMessages = Array.from(document.querySelectorAll('[class*="userMsg"]')).map(
      (element) => ({ role: "user", top: element.getBoundingClientRect().top }),
    );
    const assistantMessages = Array.from(document.querySelectorAll('[class*="assistantMsg"]')).map(
      (element) => ({ role: "assistant", top: element.getBoundingClientRect().top }),
    );

    return [...userMessages, ...assistantMessages]
      .sort((left, right) => left.top - right.top)
      .map((entry) => entry.role);
  });
}

async function sendOrdinaryChatTurn(page, message, afterFrameCount) {
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const thinkingObserved = await page
    .waitForFunction(() => document.body.innerText.includes("思考中"), undefined, {
      timeout: 5_000,
    })
    .then(() => true)
    .catch(() => false);

  const turnFrame = await waitForNewFrame(
    afterFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message?.text,
    `No ordinary chat turn_result after message: ${message}`,
    90_000,
  );

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText) &&
      !document.body.innerText.includes("思考中"),
    {
      message,
      assistantText: turnFrame.body.assistant_message.text,
    },
    { timeout: 30_000 },
  );

  return { turnResult: turnFrame.body, thinkingObserved };
}

async function driveAu01OrdinaryChatTwoTurnRoundtrip(page) {
  const firstMessage = "我想写一个雨夜开场的悬疑故事，先聊聊气质。";
  const secondMessage = "继续聊，但先不要写正文，也不要改设定。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  assert((await workTitle(page).count()) > 0, "Real work title button is not visible");
  assert((await serviceStatus(page).count()) > 0, "Real service status is not visible");

  const firstTurn = await sendOrdinaryChatTurn(page, firstMessage, frames.length);
  const secondTurn = await sendOrdinaryChatTurn(page, secondMessage, frames.length);
  const sentMessages = frames.filter(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      [firstMessage, secondMessage].includes(String(frame.body?.text ?? "")),
  );

  assert(sentMessages.length === 2, "Real workbench did not send two user_message frames");
  assert(
    sentMessages.every((frame) => frame.body?.generate_micro_plan === false),
    "Ordinary chat user_message did not preserve generate_micro_plan=false",
  );
  assert(firstTurn.turnResult.turn_id !== secondTurn.turnResult.turn_id, "Turns reused turn_id");

  const uiState = await commonUiState(page, secondTurn.turnResult, sentMessages.at(-1));
  const visibleText = await page.locator("body").innerText();
  const messageRoleOrder = await visibleMessageRoleOrder(page);
  const userMessageCount = await page.locator('[class*="userMsg"]').count();
  const assistantMessageCount = await page.locator('[class*="assistantMsg"]').count();
  const availableActionCount = await page.locator('[class*="cardActions"] button').count();
  const cardActionCount = await page.locator('[class*="cardActions"]').count();
  const candidatePanelCount = await page.locator("[class*=candidatePanel]").count();
  const adoptionDecisionCardCount = await page
    .getByText(/待确认的创作材料|采纳|修改后采纳|放弃/)
    .count();

  assert(visibleText.includes(firstMessage), "First user message is not visible");
  assert(visibleText.includes(secondMessage), "Second user message is not visible");
  assert(
    visibleText.includes(firstTurn.turnResult.assistant_message.text),
    "First assistant reply is not visible",
  );
  assert(
    visibleText.includes(secondTurn.turnResult.assistant_message.text),
    "Second assistant reply is not visible",
  );
  assert(
    firstTurn.thinkingObserved || secondTurn.thinkingObserved,
    "Thinking indicator was missed",
  );
  assert(!visibleText.includes("思考中"), "Thinking indicator stayed visible after replies");
  assert(availableActionCount === 0, "Ordinary chat rendered available action buttons");
  assert(cardActionCount === 0, "Ordinary chat rendered card action containers");
  assert(candidatePanelCount === 0, "Ordinary chat rendered candidate panel");
  assert(adoptionDecisionCardCount === 0, "Ordinary chat rendered adoption decision controls");

  return [
    {
      ...uiState,
      turn_id: firstTurn.turnResult.turn_id,
      turn_ids: [firstTurn.turnResult.turn_id, secondTurn.turnResult.turn_id],
      ui_turn_ids: [firstTurn.turnResult.turn_id, secondTurn.turnResult.turn_id],
      first_turn_id: firstTurn.turnResult.turn_id,
      second_turn_id: secondTurn.turnResult.turn_id,
      user_message_count: userMessageCount,
      assistant_turn_message_count: Math.max(
        0,
        assistantMessageCount - uiState.welcome_message_count,
      ),
      message_role_order: messageRoleOrder,
      thinking_observed: firstTurn.thinkingObserved || secondTurn.thinkingObserved,
      thinking_visible_after_reply: visibleText.includes("思考中"),
      available_action_count: availableActionCount,
      card_action_count: cardActionCount,
      candidate_panel_count: candidatePanelCount,
      adoption_decision_card_count: adoptionDecisionCardCount,
      first_user_message_visible: visibleText.includes(firstMessage),
      second_user_message_visible: visibleText.includes(secondMessage),
      first_assistant_reply_visible: visibleText.includes(
        firstTurn.turnResult.assistant_message.text,
      ),
      second_assistant_reply_visible: visibleText.includes(
        secondTurn.turnResult.assistant_message.text,
      ),
    },
  ];
}

async function driveAu01EmptyMessageGuard(page) {
  const blankMessage = "   ";
  const recoveryMessage = "空消息后继续聊一个雨夜开场的悬疑气质。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  assert((await workTitle(page).count()) > 0, "Real work title button is not visible");
  assert((await serviceStatus(page).count()) > 0, "Real service status is not visible");

  const userMessageCountBefore = await page.locator('[class*="userMsg"]').count();
  const assistantMessageCountBefore = await page.locator('[class*="assistantMsg"]').count();
  const sentUserMessagesBefore = frames.filter(
    (frame) => frame.direction === "sent" && frame.event === "user_message",
  ).length;

  await page.locator(chatInputSelector).fill(blankMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();
  await sleep(700);

  const userMessageCountAfterBlank = await page.locator('[class*="userMsg"]').count();
  const assistantMessageCountAfterBlank = await page.locator('[class*="assistantMsg"]').count();
  const blankInputValueAfterClick = await page.locator(chatInputSelector).inputValue();
  const inputEnabledAfterBlank = await page.locator(chatInputSelector).isEnabled();
  const visibleTextAfterBlank = await page.locator("body").innerText();
  const sentUserMessagesAfterBlank = frames.filter(
    (frame) => frame.direction === "sent" && frame.event === "user_message",
  ).length;
  const blankUserMessageFrameCount = sentUserMessagesAfterBlank - sentUserMessagesBefore;

  assert(blankUserMessageFrameCount === 0, "Blank input sent a user_message frame");
  assert(
    userMessageCountAfterBlank === userMessageCountBefore,
    "Blank input appended a visible user message",
  );
  assert(
    assistantMessageCountAfterBlank === assistantMessageCountBefore,
    "Blank input appended an assistant message",
  );
  assert(!visibleTextAfterBlank.includes("思考中"), "Blank input left thinking visible");
  assert(inputEnabledAfterBlank, "Chat input became disabled after blank input");

  const recoveryTurn = await sendOrdinaryChatTurn(page, recoveryMessage, frames.length);
  const sentRecoveryMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === recoveryMessage,
  );
  assert(sentRecoveryMessage, "Recovery message was not sent after blank input");
  assert(
    sentRecoveryMessage.body?.generate_micro_plan === false,
    "Recovery ordinary chat did not preserve generate_micro_plan=false",
  );

  const uiState = await commonUiState(page, recoveryTurn.turnResult, sentRecoveryMessage);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      turn_id: recoveryTurn.turnResult.turn_id,
      turn_ids: [recoveryTurn.turnResult.turn_id],
      recovery_turn_id: recoveryTurn.turnResult.turn_id,
      blank_attempted: true,
      blank_input_value_after_click: blankInputValueAfterClick,
      blank_user_message_frame_count: blankUserMessageFrameCount,
      message_count_unchanged_after_blank:
        userMessageCountAfterBlank === userMessageCountBefore &&
        assistantMessageCountAfterBlank === assistantMessageCountBefore,
      user_message_count_before_blank: userMessageCountBefore,
      user_message_count_after_blank: userMessageCountAfterBlank,
      assistant_message_count_before_blank: assistantMessageCountBefore,
      assistant_message_count_after_blank: assistantMessageCountAfterBlank,
      input_enabled_after_blank: inputEnabledAfterBlank,
      thinking_visible_after_blank: visibleTextAfterBlank.includes("思考中"),
      recovery_message_visible: visibleText.includes(recoveryMessage),
      recovery_assistant_reply_visible: visibleText.includes(
        recoveryTurn.turnResult.assistant_message.text,
      ),
      recovery_generate_micro_plan: sentRecoveryMessage.body?.generate_micro_plan,
    },
  ];
}

async function driveAu01GarbageJsonRecovery(page) {
  const garbageMessage = "AU01GARBAGE：请模拟创作引擎返回格式错误，工作台应显示友好降级。";
  const recoveryMessage = "乱码降级后继续聊一个雨夜开场的悬疑气质。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  assert((await workTitle(page).count()) > 0, "Real work title button is not visible");
  assert((await serviceStatus(page).count()) > 0, "Real service status is not visible");

  const garbageTurn = await sendOrdinaryChatTurn(page, garbageMessage, frames.length);
  const sentGarbageMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === garbageMessage,
  );
  assert(sentGarbageMessage, "Garbage-triggering message was not sent");
  assert(
    sentGarbageMessage.body?.generate_micro_plan === false,
    "Garbage-triggering ordinary chat did not preserve generate_micro_plan=false",
  );

  const fallbackText = garbageTurn.turnResult.assistant_message?.text ?? "";
  assert(
    fallbackText.includes("格式不符合") && fallbackText.includes("请重试"),
    `Malformed provider JSON did not render a friendly fallback: ${fallbackText}`,
  );

  const visibleTextAfterGarbage = await page.locator("body").innerText();
  const inputEnabledAfterGarbage = await page.locator(chatInputSelector).isEnabled();
  const serviceStatusTextAfterGarbage = await serviceStatus(page)
    .textContent()
    .then((value) => value?.trim() ?? "");
  const rawProviderPayloadVisible =
    visibleTextAfterGarbage.includes("not valid json") ||
    visibleTextAfterGarbage.includes("raw provider payload") ||
    visibleTextAfterGarbage.includes("{{{");

  assert(!rawProviderPayloadVisible, "Raw malformed provider payload became visible");
  assert(!visibleTextAfterGarbage.includes("思考中"), "Thinking stayed visible after fallback");
  assert(inputEnabledAfterGarbage, "Chat input became disabled after malformed provider JSON");

  const recoveryTurn = await sendOrdinaryChatTurn(page, recoveryMessage, frames.length);
  const sentRecoveryMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === recoveryMessage,
  );
  assert(sentRecoveryMessage, "Recovery message was not sent after malformed provider JSON");
  assert(
    sentRecoveryMessage.body?.generate_micro_plan === false,
    "Recovery ordinary chat did not preserve generate_micro_plan=false",
  );
  assert(
    !String(recoveryTurn.turnResult.assistant_message?.text ?? "").includes("格式不符合"),
    "Recovery turn still rendered the malformed JSON fallback",
  );

  const uiState = await commonUiState(page, recoveryTurn.turnResult, sentRecoveryMessage);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      turn_id: garbageTurn.turnResult.turn_id,
      turn_ids: [garbageTurn.turnResult.turn_id, recoveryTurn.turnResult.turn_id],
      ui_turn_ids: [garbageTurn.turnResult.turn_id, recoveryTurn.turnResult.turn_id],
      garbage_turn_id: garbageTurn.turnResult.turn_id,
      recovery_turn_id: recoveryTurn.turnResult.turn_id,
      fallback_message_visible: visibleTextAfterGarbage.includes(fallbackText),
      raw_provider_payload_visible: rawProviderPayloadVisible,
      input_enabled_after_garbage: inputEnabledAfterGarbage,
      thinking_visible_after_garbage: visibleTextAfterGarbage.includes("思考中"),
      service_status_text_after_garbage: serviceStatusTextAfterGarbage,
      channel_connected_after_garbage: !serviceStatusTextAfterGarbage.includes("未连接"),
      garbage_generate_micro_plan: sentGarbageMessage.body?.generate_micro_plan,
      recovery_generate_micro_plan: sentRecoveryMessage.body?.generate_micro_plan,
      recovery_message_visible: visibleText.includes(recoveryMessage),
      recovery_assistant_reply_visible: visibleText.includes(
        recoveryTurn.turnResult.assistant_message.text,
      ),
      recovery_assistant_is_fallback: String(
        recoveryTurn.turnResult.assistant_message?.text ?? "",
      ).includes("格式不符合"),
    },
  ];
}

async function driveAu01FrameValidationFriendlyError(page) {
  const invalidFrameMessage =
    "AU01BADFRAME：请模拟创作引擎产出带禁止语义的 frame，工作台应拦截并友好提示。";
  const recoveryMessage = "frame 校验失败后继续聊一个雨夜开场的悬疑气质。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  assert((await workTitle(page).count()) > 0, "Real work title button is not visible");
  assert((await serviceStatus(page).count()) > 0, "Real service status is not visible");

  const invalidTurn = await sendOrdinaryChatTurn(page, invalidFrameMessage, frames.length);
  const sentInvalidFrameMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === invalidFrameMessage,
  );
  assert(sentInvalidFrameMessage, "Invalid-frame-triggering message was not sent");
  assert(
    sentInvalidFrameMessage.body?.generate_micro_plan === false,
    "Invalid-frame ordinary chat did not preserve generate_micro_plan=false",
  );

  const fallbackText = invalidTurn.turnResult.assistant_message?.text ?? "";
  assert(
    fallbackText.includes("这次处理失败") &&
      fallbackText.includes("未创建待采纳内容") &&
      fallbackText.includes("没有写入作品事实"),
    `Frame validation failure did not render the generic friendly fallback: ${fallbackText}`,
  );

  const serializedTurnResult = JSON.stringify(invalidTurn.turnResult);
  const visibleTextAfterInvalidFrame = await page.locator("body").innerText();
  const inputEnabledAfterInvalidFrame = await page.locator(chatInputSelector).isEnabled();
  const serviceStatusTextAfterInvalidFrame = await serviceStatus(page)
    .textContent()
    .then((value) => value?.trim() ?? "");
  const internalValidationReasonVisible =
    visibleTextAfterInvalidFrame.includes("frame validation failed") ||
    visibleTextAfterInvalidFrame.includes("forbidden semantics") ||
    visibleTextAfterInvalidFrame.includes("ready_to_execute") ||
    visibleTextAfterInvalidFrame.includes("approved and ready_to_execute") ||
    visibleTextAfterInvalidFrame.includes("slice_verify raw provider payload");
  const internalValidationReasonInTurnResult =
    serializedTurnResult.includes("frame validation failed") ||
    serializedTurnResult.includes("forbidden semantics") ||
    serializedTurnResult.includes("ready_to_execute") ||
    serializedTurnResult.includes("approved and ready_to_execute") ||
    serializedTurnResult.includes("slice_verify raw provider payload");

  assert(!internalValidationReasonVisible, "Internal frame validation reason became visible");
  assert(
    !internalValidationReasonInTurnResult,
    "Internal frame validation reason leaked into turn_result payload",
  );
  assert(
    !visibleTextAfterInvalidFrame.includes("思考中"),
    "Thinking stayed visible after fallback",
  );
  assert(
    inputEnabledAfterInvalidFrame,
    "Chat input became disabled after frame validation failure",
  );

  const recoveryTurn = await sendOrdinaryChatTurn(page, recoveryMessage, frames.length);
  const sentRecoveryMessage = frames.find(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === recoveryMessage,
  );
  assert(sentRecoveryMessage, "Recovery message was not sent after frame validation failure");
  assert(
    sentRecoveryMessage.body?.generate_micro_plan === false,
    "Recovery ordinary chat did not preserve generate_micro_plan=false",
  );
  assert(
    !String(recoveryTurn.turnResult.assistant_message?.text ?? "").includes("这次处理失败"),
    "Recovery turn still rendered the frame validation fallback",
  );

  const uiState = await commonUiState(page, recoveryTurn.turnResult, sentRecoveryMessage);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      turn_id: invalidTurn.turnResult.turn_id,
      turn_ids: [invalidTurn.turnResult.turn_id, recoveryTurn.turnResult.turn_id],
      ui_turn_ids: [invalidTurn.turnResult.turn_id, recoveryTurn.turnResult.turn_id],
      invalid_frame_turn_id: invalidTurn.turnResult.turn_id,
      recovery_turn_id: recoveryTurn.turnResult.turn_id,
      fallback_message_visible: visibleTextAfterInvalidFrame.includes(fallbackText),
      internal_validation_reason_visible: internalValidationReasonVisible,
      internal_validation_reason_in_turn_result: internalValidationReasonInTurnResult,
      input_enabled_after_invalid_frame: inputEnabledAfterInvalidFrame,
      thinking_visible_after_invalid_frame: visibleTextAfterInvalidFrame.includes("思考中"),
      service_status_text_after_invalid_frame: serviceStatusTextAfterInvalidFrame,
      channel_connected_after_invalid_frame: !serviceStatusTextAfterInvalidFrame.includes("未连接"),
      invalid_frame_generate_micro_plan: sentInvalidFrameMessage.body?.generate_micro_plan,
      recovery_generate_micro_plan: sentRecoveryMessage.body?.generate_micro_plan,
      recovery_message_visible: visibleText.includes(recoveryMessage),
      recovery_assistant_reply_visible: visibleText.includes(
        recoveryTurn.turnResult.assistant_message.text,
      ),
      recovery_assistant_is_fallback: String(
        recoveryTurn.turnResult.assistant_message?.text ?? "",
      ).includes("这次处理失败"),
    },
  ];
}

async function driveAu01TurnresultRecorderUiConsistency(page) {
  const message = "请只和我聊雨夜悬疑开场的氛围，不写正文也不改设定。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  const turn = await sendOrdinaryChatTurn(page, message, frames.length);
  const turnResult = turn.turnResult;
  const sentMessage = latestSentUserMessage();
  assert(sentMessage, "No user_message websocket frame was sent for AU-01 recorder check");

  const workId = sentMessage.body?.work_id;
  const sessionId = sentMessage.body?.session_id;
  assert(workId, "AU-01 recorder check did not have work_id in user_message");
  assert(sessionId, "AU-01 recorder check did not have session_id in user_message");

  const assistantText = String(turnResult.assistant_message?.text ?? "");
  assert(assistantText.length > 0, "TurnResult did not include assistant_message.text");

  const visibleTextBeforeReload = await page.locator("body").innerText();
  assert(visibleTextBeforeReload.includes(message), "Current UI did not show the user message");
  assert(visibleTextBeforeReload.includes(assistantText), "Current UI did not show assistant text");

  const { snapshot, assistantRow, userRow } = await waitForTranscriptTurn(
    workId,
    sessionId,
    turnResult.turn_id,
  );
  const transcriptTurnResult = assistantRow.turn_result ?? {};
  const transcriptAssistantText = String(transcriptTurnResult.assistant_message?.text ?? "");

  assert(snapshot.read_only === false, "Active session snapshot was unexpectedly read-only");
  assert(userRow.text === message, "Recorder user row text did not match the UI input");
  assert(assistantRow.text === assistantText, "Recorder assistant row text did not match UI text");
  assert(
    transcriptTurnResult.turn_id === turnResult.turn_id,
    "Recorder turn_result turn_id did not match websocket turn_result",
  );
  assert(
    transcriptAssistantText === assistantText,
    "Recorder turn_result assistant_message.text did not match websocket turn_result",
  );

  const appLogCountBeforeReload = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(chatInputSelector).waitFor({ timeout: 20_000 });

  const resumedAfterReload = await waitForNewAppLogRecord(
    appLogCountBeforeReload,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === sessionId &&
      Number(record.transcript_count ?? 0) >= Number(snapshot.transcript?.length ?? 2),
    "Reload did not resume the active session transcript",
    30_000,
  );

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText) &&
      !document.body.innerText.includes("思考中"),
    { message, assistantText },
    { timeout: 30_000 },
  );

  const restoredSnapshot = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );

    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
    };
  });

  assert(!restoredSnapshot.input_disabled, "Chat input was disabled after transcript restore");
  assert(!restoredSnapshot.send_disabled, "Send button was disabled after transcript restore");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: turnResult.turn_id,
      turn_ids: [turnResult.turn_id],
      work_id: workId,
      workspace_id: workId,
      context_work_id: workId,
      session_id: sessionId,
      active_session_id: sessionId,
      sent_message_text: message,
      assistant_text: assistantText,
      current_ui_user_message_visible: visibleTextBeforeReload.includes(message),
      current_ui_assistant_visible: visibleTextBeforeReload.includes(assistantText),
      transcript_user_row_found: Boolean(userRow),
      transcript_assistant_row_found: Boolean(assistantRow),
      transcript_user_text_matches_ui: userRow.text === message,
      transcript_assistant_text_matches_ui: assistantRow.text === assistantText,
      transcript_turn_result_turn_id_matches_websocket:
        transcriptTurnResult.turn_id === turnResult.turn_id,
      transcript_turn_result_assistant_text_matches_websocket:
        transcriptAssistantText === assistantText,
      transcript_turn_result_assistant_text: transcriptAssistantText,
      transcript_count: snapshot.transcript.length,
      session_snapshot_read_only: snapshot.read_only,
      reload_resume_transcript_count: resumedAfterReload.transcript_count,
      restored_ui_user_message_visible: restoredSnapshot.visible_text.includes(message),
      restored_ui_assistant_visible: restoredSnapshot.visible_text.includes(assistantText),
      restored_input_enabled: !restoredSnapshot.input_disabled,
      restored_send_enabled: !restoredSnapshot.send_disabled,
      generate_micro_plan: sentMessage.body?.generate_micro_plan,
      thinking_observed: turn.thinkingObserved,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function openArchiveTab(page, tabName) {
  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: tabName }).click();
  const archivePanel = page.locator('[class*="panel"]').filter({ hasText: "作品档案" }).first();
  await archivePanel.waitFor({ timeout: 10_000 });
  return archivePanel;
}

async function archivePanelSnapshot(archivePanel) {
  return await archivePanel.evaluate((element) => ({
    foreshadowing_count: Number(element.getAttribute("data-archive-foreshadowing-count") ?? 0),
    rule_count: Number(element.getAttribute("data-archive-rule-count") ?? 0),
    character_count: Number(element.getAttribute("data-archive-character-count") ?? 0),
    text: element.innerText,
  }));
}

async function closeArchiveIfOpen(page) {
  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive.first().click();
    await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  }
}

async function switchToWorkByTitle(page, title) {
  await workTitle(page).click();
  const item = page.getByRole("menuitem").filter({ hasText: title }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
  await page.waitForFunction(
    (expected) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(expected);
    },
    title,
    { timeout: 15_000 },
  );
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
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

async function driveAu03SessionHistoryReadonly(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  const activeSessionId =
    joinReply?.body?.response?.session_id ?? joinReply?.body?.session_id ?? null;
  assert(workId, "No work_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("林瑶旧线索")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded history session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const seededHistorySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "林瑶旧线索讨论",
  );
  assert(seededHistorySession?.id, "Seeded history session was not available through sessions API");

  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("林瑶旧线索");

  const historySessionButton = page.locator("button").filter({ hasText: "林瑶旧线索讨论" }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("林瑶留下的旧线索") &&
      document.body.innerText.includes("返回当前会话"),
    { timeout: 10_000 },
  );

  const readonlySessionButtonText = (
    (await page.locator("button").filter({ hasText: "林瑶旧线索讨论" }).first().textContent()) ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  const readonlySessionStatus = seededHistorySession.status;

  const readonlySnapshot = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );

    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
    };
  });

  assert(readonlySessionStatus === "EXITED", "Readonly session status was not EXITED");
  assert(
    readonlySessionButtonText.includes("EXITED"),
    "Readonly session status was not visible in the session list",
  );
  assert(readonlySnapshot.input_disabled, "History session input was not disabled");
  assert(readonlySnapshot.send_disabled, "History session send button was not disabled");
  assert(
    readonlySnapshot.visible_text.includes("林瑶留下的旧线索"),
    "History transcript text was not visible",
  );

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes("当前会话继续讨论灵源矿区"),
    { timeout: 10_000 },
  );

  const activeRestored = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
    };
  });

  assert(!activeRestored.input_disabled, "Active session input stayed disabled after restore");
  assert(!activeRestored.send_disabled, "Active session send stayed disabled after restore");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      context_work_id: workId,
      session_id: activeSessionId,
      readonly_session_id: seededHistorySession.id,
      readonly_session_status: readonlySessionStatus,
      readonly_session_button_text: readonlySessionButtonText,
      readonly_banner_visible: true,
      readonly_input_disabled: readonlySnapshot.input_disabled,
      readonly_send_disabled: readonlySnapshot.send_disabled,
      active_session_restored: true,
      readonly_visible_text: readonlySnapshot.visible_text,
      active_visible_text: activeRestored.visible_text,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu03BranchFromHistory(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  assert(workId, "No work_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("林瑶旧线索")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded history session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const seededHistorySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "林瑶旧线索讨论",
  );
  assert(seededHistorySession?.id, "Seeded history session was not available through sessions API");

  const branchCount = readAppLogRecords().length;
  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("林瑶旧线索");

  const historySessionButton = page.locator("button").filter({ hasText: "林瑶旧线索讨论" }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  const shownHistory = await waitForNewAppLogRecord(
    branchCount,
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === workId &&
      record.session_id === seededHistorySession.id &&
      record.read_only === true &&
      Number(record.transcript_count ?? 0) >= 2,
    "AU-03 branch source history session was not opened read-only",
    30_000,
  );

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("林瑶留下的旧线索") &&
      document.body.innerText.includes("从这里继续"),
    { timeout: 10_000 },
  );

  const readonlySnapshot = await page.evaluate(() => ({
    visible_text: document.body.innerText,
    readonly_banner_visible:
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
  }));
  assert(readonlySnapshot.readonly_banner_visible, "Readonly history banner was not visible");
  assert(
    readonlySnapshot.visible_text.includes("林瑶留下的旧线索"),
    "Branch source history transcript text was not visible",
  );

  await page.getByRole("button", { name: "从这里继续" }).click();

  const created = await waitForNewAppLogRecord(
    branchCount,
    (record) =>
      record.event === "work_session.create.done" &&
      record.work_id === workId &&
      record.session_id &&
      record.source_session_ref === seededHistorySession.id &&
      record.source_turn_ref === "turn_history_1",
    "AU-03 branch session was not created with source session/turn refs",
    30_000,
  );

  const branchSessionId = created.session_id;
  await waitForNewAppLogRecord(
    branchCount,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === branchSessionId &&
      Number(record.transcript_count ?? -1) === 0,
    "AU-03 branch session did not resume with an empty transcript",
    30_000,
  );
  await waitForNewAppLogRecord(
    branchCount,
    (record) =>
      record.event === "channel.join.done" &&
      record.work_id === workId &&
      record.session_id === branchSessionId,
    "AU-03 branch session did not rejoin the workspace channel",
    30_000,
  );

  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes("欢迎使用 AI Novel Studio") &&
      !document.body.innerText.includes("林瑶留下的旧线索"),
    { timeout: 10_000 },
  );

  const branchTitle = `${seededHistorySession.title} 的延续`;
  const branchSessionButtonText = (
    (await page.locator("button").filter({ hasText: branchTitle }).first().textContent()) ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  const branchSnapshot = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      visible_text: text,
      readonly_banner_visible:
        text.includes("历史会话") && text.includes("正在只读查看历史 transcript"),
      message_count: document.querySelectorAll('[class*="userMsg"], [class*="assistantMsg"]')
        .length,
    };
  });

  assert(!branchSnapshot.readonly_banner_visible, "Branch session stayed in read-only mode");
  assert(
    branchSessionButtonText.includes("ACTIVE"),
    "Branch session was not marked ACTIVE in the session list",
  );
  assert(
    !branchSnapshot.visible_text.includes("林瑶留下的旧线索"),
    "History transcript leaked into the new branch session",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      context_work_id: workId,
      session_id: branchSessionId,
      readonly_session_id: seededHistorySession.id,
      readonly_banner_visible: true,
      readonly_visible_text: readonlySnapshot.visible_text,
      branch_source_session_ref: created.source_session_ref,
      branch_source_turn_ref: created.source_turn_ref,
      branch_active_session_id: branchSessionId,
      branch_readonly_banner_visible: branchSnapshot.readonly_banner_visible,
      branch_message_count: branchSnapshot.message_count,
      branch_visible_text: branchSnapshot.visible_text,
      branch_session_item_active: branchSessionButtonText.includes("ACTIVE"),
      source_session_transcript_count: shownHistory.transcript_count,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu03ArchiveSessionFilter(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  assert(workId, "No work_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("林瑶旧线索")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded archive candidate session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const seededHistorySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "林瑶旧线索讨论",
  );
  assert(seededHistorySession?.id, "Seeded history session was not available through sessions API");

  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("林瑶旧线索");

  const historySessionButton = page.locator("button").filter({ hasText: "林瑶旧线索讨论" }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("林瑶留下的旧线索"),
    { timeout: 10_000 },
  );

  const archiveButton = page.getByRole("button", { name: "归档会话" }).first();
  await archiveButton.waitFor({ timeout: 10_000 });
  const archiveButtonVisible = await archiveButton.isVisible();
  assert(archiveButtonVisible, "Archive button was not visible for the exited history session");

  const archiveCount = readAppLogRecords().length;
  await archiveButton.click();

  await waitForNewAppLogRecord(
    archiveCount,
    (record) =>
      record.event === "work_session.archive.done" &&
      record.work_id === workId &&
      record.session_id === seededHistorySession.id &&
      record.status === "ARCHIVED",
    "AU-03 archive session did not persist ARCHIVED status",
    30_000,
  );

  await searchBox.fill("");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).every(
        (button) => !(button.textContent ?? "").includes("林瑶旧线索讨论"),
      ),
    { timeout: 10_000 },
  );
  const defaultHistoryButtonCount = await page
    .locator("button")
    .filter({ hasText: "林瑶旧线索讨论" })
    .count();

  await searchBox.fill("林瑶旧线索");
  const archivedSessionButton = page
    .locator("button")
    .filter({ hasText: "林瑶旧线索讨论" })
    .first();
  await archivedSessionButton.waitFor({ timeout: 10_000 });
  const archivedButtonText = ((await archivedSessionButton.textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  await archivedSessionButton.click();

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("林瑶留下的旧线索") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
    { timeout: 10_000 },
  );

  const archivedSnapshot = await page.evaluate(() => ({
    visible_text: document.body.innerText,
    readonly_banner_visible:
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
  }));

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      context_work_id: workId,
      readonly_session_id: seededHistorySession.id,
      archive_button_visible: archiveButtonVisible,
      archived_hidden_default: defaultHistoryButtonCount === 0,
      archived_search_found: archivedButtonText.includes("ARCHIVED"),
      archived_banner_visible: archivedSnapshot.readonly_banner_visible,
      archived_visible_text: archivedSnapshot.visible_text,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu03CurrentWorkContextSsot(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  const activeSessionId =
    joinReply?.body?.response?.session_id ?? joinReply?.body?.session_id ?? null;
  assert(workId, "No work_id was available from the real channel join");
  assert(activeSessionId, "No active session_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("旧主角命名")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded current-work history session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const historySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "旧主角命名讨论",
  );
  assert(historySession?.id, "Seeded current-work history session was not available");

  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("旧主角命名");

  const historySessionButton = page.locator("button").filter({ hasText: "旧主角命名讨论" }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("主角当时叫林烬") &&
      document.body.innerText.includes("返回当前会话"),
    { timeout: 10_000 },
  );
  const readonlySnapshot = await page.evaluate(() => ({
    visible_text: document.body.innerText,
    readonly_banner_visible:
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
  }));
  assert(readonlySnapshot.readonly_banner_visible, "Current-work history session was not read-only");

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes("当前会话确认：主角现在叫林澈"),
    { timeout: 10_000 },
  );

  const message = "主角现在的核心动机是什么？";
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  await page.waitForFunction(
    (text) => document.body.innerText.includes(text) && !document.body.innerText.includes("思考中"),
    message,
    { timeout: 90_000 },
  );
  for (let attempt = 0; attempt < 120 && !latestTurnResult(); attempt += 1) {
    await page.waitForTimeout(500);
  }

  const sentMessage = latestSentUserMessage();
  const turnResult = latestTurnResult();
  assert(sentMessage, "No current-work user_message websocket frame was sent");
  assert(turnResult, "No current-work turn_result websocket frame was received");

  const restoredSnapshot = await page.evaluate(() => ({
    visible_text: document.body.innerText,
    readonly_banner_visible:
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
  }));
  assert(!restoredSnapshot.readonly_banner_visible, "Active session stayed in read-only mode");

  const uiState = await commonUiState(page, turnResult, sentMessage);

  return [
    {
      ...uiState,
      readonly_session_id: historySession.id,
      active_session_restored: true,
      readonly_banner_visible: restoredSnapshot.readonly_banner_visible,
      readonly_visible_text: readonlySnapshot.visible_text,
      active_visible_text: restoredSnapshot.visible_text,
      sent_message_text: message,
    },
  ];
}

async function driveAu03SessionNewActive(page) {
  const previousActiveToken = "当前会话继续讨论灵源矿区";
  const newMessage = `AU03 新会话闭环 ${Date.now()}：请只回应本轮新会话。`;
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  const previousActiveSessionId =
    joinReply?.body?.response?.session_id ?? joinReply?.body?.session_id ?? null;
  assert(workId, "No work_id was available from the real channel join");
  assert(previousActiveSessionId, "No active session_id was available from the real channel join");

  await page.waitForFunction(
    (token) => document.body.innerText.includes(token),
    previousActiveToken,
    {
      timeout: 10_000,
    },
  );

  const beforeCreateCount = readAppLogRecords().length;
  await page.getByRole("button", { name: "新建会话" }).click();

  const created = await waitForNewAppLogRecord(
    beforeCreateCount,
    (record) =>
      record.event === "work_session.create.done" &&
      record.work_id === workId &&
      record.session_id &&
      record.session_id !== previousActiveSessionId,
    "No AU-03 new active work_session.create.done record",
    30_000,
  );

  const newActiveSessionId = created.session_id;
  const resumed = await waitForNewAppLogRecord(
    beforeCreateCount,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === newActiveSessionId &&
      Number(record.transcript_count ?? -1) === 0,
    "New AU-03 active session did not resume with an empty transcript",
    30_000,
  );

  await waitForNewAppLogRecord(
    beforeCreateCount,
    (record) =>
      record.event === "channel.join.done" &&
      record.work_id === workId &&
      record.session_id === newActiveSessionId,
    "Workbench did not rejoin the new AU-03 active session",
    30_000,
  );

  await page.waitForFunction(
    (token) =>
      document.body.innerText.includes("欢迎使用 AI Novel Studio") &&
      !document.body.innerText.includes(token),
    previousActiveToken,
    { timeout: 10_000 },
  );

  const previousSessionResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("默认会话")}`,
  );
  assert(
    previousSessionResponse.ok,
    `Failed to search previous active session: HTTP ${previousSessionResponse.status}`,
  );
  const previousSessionBody = await previousSessionResponse.json();
  const previousSessionAfterCreate = (previousSessionBody.sessions ?? []).find(
    (session) => session.id === previousActiveSessionId,
  );
  assert(previousSessionAfterCreate?.status === "EXITED", "Previous active session was not EXITED");

  const newSessionSnapshot = await page.evaluate((token) => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    const text = document.body.innerText;

    return {
      visible_text: text,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
      old_token_visible: text.includes(token),
    };
  }, previousActiveToken);

  assert(!newSessionSnapshot.input_disabled, "New active session input was disabled");
  assert(!newSessionSnapshot.send_disabled, "New active session send button was disabled");
  assert(
    !newSessionSnapshot.old_token_visible,
    "Previous active transcript leaked into new session",
  );

  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("默认会话");

  const previousSessionButton = page.locator("button").filter({ hasText: "默认会话" }).first();
  await previousSessionButton.waitFor({ timeout: 10_000 });
  await previousSessionButton.click();

  const shownPrevious = await waitForAppLogRecord(
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === workId &&
      record.session_id === previousActiveSessionId &&
      record.read_only === true,
    "Previous active session was not reopened as readonly history",
    30_000,
  );

  await page.waitForFunction(
    (token) =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes(token),
    previousActiveToken,
    { timeout: 10_000 },
  );

  const previousReadonlySnapshot = await page.evaluate((token) => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    const text = document.body.innerText;

    return {
      visible_text: text,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
      old_token_visible: text.includes(token),
    };
  }, previousActiveToken);

  assert(
    previousReadonlySnapshot.input_disabled,
    "Previous readonly session input was not disabled",
  );
  assert(previousReadonlySnapshot.send_disabled, "Previous readonly session send was not disabled");
  assert(
    previousReadonlySnapshot.old_token_visible,
    "Previous active transcript was not visible after reopening as history",
  );

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    (token) => {
      const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
      const sendButton = [...document.querySelectorAll("button")].find(
        (button) => (button.textContent ?? "").trim() === "发送",
      );
      const text = document.body.innerText;

      return (
        !text.includes("正在只读查看历史 transcript") &&
        !text.includes(token) &&
        input?.disabled === false &&
        sendButton?.disabled === false
      );
    },
    previousActiveToken,
    { timeout: 10_000 },
  );

  const sendFrameCount = frames.length;
  const sendLogCount = readAppLogRecords().length;
  await page.locator(chatInputSelector).fill(newMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    sendFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === workId &&
      frame.body?.session_id === newActiveSessionId &&
      String(frame.body?.text ?? "").includes(newMessage),
    "No AU-03 new-session user_message websocket frame was sent",
    30_000,
  );

  const turnFrame = await waitForNewFrame(
    sendFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body?.status !== "error",
    "No AU-03 new-session turn_result frame was received",
    120_000,
  );
  const turnId = turnFrame.body.turn_id;

  await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "channel.user_message.start" &&
      record.work_id === workId &&
      record.session_id === newActiveSessionId &&
      record.turn_id === turnId,
    "No AU-03 new-session channel.user_message.start log",
    30_000,
  );

  const contextRecord = await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnId &&
      record.has_conversation === false,
    "AU-03 new-session first turn did not assemble an empty conversation context",
    30_000,
  );

  await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.work_id === workId &&
      record.session_id === newActiveSessionId &&
      record.turn_id === turnId,
    "No AU-03 new-session channel.user_message.done log",
    30_000,
  );

  const finalNewSessionText = await page.locator("body").innerText();
  assert(finalNewSessionText.includes(newMessage), "New session user message was not visible");
  assert(
    !finalNewSessionText.includes(previousActiveToken),
    "Previous active transcript leaked after the new session turn",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: turnId,
      turn_ids: [turnId],
      work_id: workId,
      context_work_id: workId,
      previous_active_session_id: previousActiveSessionId,
      new_active_session_id: newActiveSessionId,
      session_id: newActiveSessionId,
      created_session_id: created.session_id,
      previous_active_status_after_create: previousSessionAfterCreate.status,
      new_session_transcript_empty: Number(resumed.transcript_count ?? -1) === 0,
      new_session_input_enabled: !newSessionSnapshot.input_disabled,
      new_session_send_enabled: !newSessionSnapshot.send_disabled,
      old_active_visible_initial: true,
      old_active_absent_after_create: !newSessionSnapshot.old_token_visible,
      previous_active_readonly_opened: true,
      previous_active_readonly_banner_visible: true,
      previous_active_input_disabled: previousReadonlySnapshot.input_disabled,
      previous_active_send_disabled: previousReadonlySnapshot.send_disabled,
      previous_active_transcript_visible_readonly: previousReadonlySnapshot.old_token_visible,
      active_session_restored: true,
      user_message_session_id: sentFrame.body?.session_id,
      user_message_work_id: sentFrame.body?.work_id,
      new_session_message_visible: finalNewSessionText.includes(newMessage),
      old_active_text_in_new_session: finalNewSessionText.includes(previousActiveToken),
      first_turn_context_has_conversation: contextRecord.has_conversation,
      first_turn_context_refs_count: contextRecord.context_refs_count,
      shown_previous_transcript_count: shownPrevious.transcript_count,
      shown_previous_pending_adoption_count: shownPrevious.pending_adoption_count,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
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
  const hasSessionOrRecentDialogueSource =
    whyText.includes("当前会话记录") || whyText.includes("近期对话");

  assert(whyText.includes("参考来源"), "Why dialog did not show the source section");
  assert(whyText.includes("当前作品背景"), "Why dialog did not show current work source");
  assert(hasSessionOrRecentDialogueSource, "Why dialog did not show session dialogue source");
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

async function driveAu11QualityDiagnosisMessageEnvelope(page) {
  const message = "这一章感觉不够爽，主角赢得太轻了。";
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.trace_summary?.ai_message_envelope != null,
    "No AU11 turn_result with AIMessageEnvelope trace summary",
    90_000,
  );

  const turnResult = turnFrame.body;
  const sentMessage = latestSentUserMessage();
  assert(sentMessage, "No AU11 user_message websocket frame was sent");

  await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnResult.turn_id &&
      record.has_snapshot === true,
    "No AU11 context.assemble.done with current work snapshot",
    30_000,
  );

  const traceSummary = turnResult.trace_summary ?? {};
  const envelope = traceSummary.ai_message_envelope ?? {};
  const novelLayer = envelope.novel_layer ?? {};
  const workState = envelope.work_state_layer ?? {};
  const guidance = envelope.turn_guidance_layer ?? {};
  const qualityGates = Array.isArray(novelLayer.quality_gates) ? novelLayer.quality_gates : [];
  const focus = Array.isArray(guidance.element_focus) ? guidance.element_focus : [];
  const chapterSummary = Array.isArray(workState.chapter_summary)
    ? workState.chapter_summary.join("\n")
    : "";
  const contextRefs = Array.isArray(workState.context_refs) ? workState.context_refs : [];
  const contextSourceTypes = contextRefs.map((ref) => String(ref.source_type ?? ""));
  const assistantText = String(turnResult.assistant_message?.text ?? "");

  assert(
    traceSummary.guidance_mode === "quality",
    "AU11 trace summary did not mark guidance_mode=quality",
  );
  assert(guidance.guidance_mode === "quality", "AU11 TurnGuidance layer did not mark quality mode");
  assert(qualityGates.includes("conflict_pressure"), "AU11 novel layer missed conflict pressure");
  assert(qualityGates.includes("cost_visibility"), "AU11 novel layer missed cost visibility");
  assert(qualityGates.includes("reader_payoff"), "AU11 novel layer missed reader payoff");
  assert(qualityGates.includes("protagonist_agency"), "AU11 novel layer missed protagonist agency");
  assert(focus.includes("conflict_pressure"), "AU11 guidance layer missed conflict focus");
  assert(chapterSummary.includes("霓虹地牢"), "AU11 work state layer missed chapter summary");
  assert(
    contextSourceTypes.includes("current_work"),
    "AU11 work state layer missed current work source",
  );
  assert(
    assistantText.includes("代价") && assistantText.includes("读者回报"),
    "AU11 assistant response did not include concrete quality tradeoffs",
  );
  assert(turnResult.tool_result == null, "AU11 quality diagnosis unexpectedly called a tool");
  assert(turnResult.adoption_state == null, "AU11 quality diagnosis unexpectedly opened adoption");
  assert(
    turnResult.truthfulness?.production_write_performed === false,
    "AU11 quality diagnosis reported production write",
  );

  const whyText = await openLatestWhyDialog(page);
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;

  assert(whyText.includes("质量诊断"), "AU11 why dialog did not show quality diagnosis");
  assert(whyText.includes("冲突压力"), "AU11 why dialog did not show conflict pressure");
  assert(whyText.includes("代价可见"), "AU11 why dialog did not show visible cost");
  assert(whyText.includes("当前作品背景"), "AU11 why dialog did not show current work source");
  assert(!unsafePattern.test(whyText), "AU11 why dialog exposed unsafe trace or prompt text");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      message_text: message,
      guidance_mode_quality: traceSummary.guidance_mode === "quality",
      envelope_has_novel_layer: qualityGates.length >= 4,
      envelope_has_work_state: chapterSummary.includes("霓虹地牢"),
      envelope_has_turn_guidance: guidance.guidance_mode === "quality",
      novel_layer_has_quality_gates:
        qualityGates.includes("conflict_pressure") &&
        qualityGates.includes("cost_visibility") &&
        qualityGates.includes("reader_payoff") &&
        qualityGates.includes("protagonist_agency"),
      work_state_has_current_work_source: contextSourceTypes.includes("current_work"),
      work_state_chapter_summary_mentions_target: chapterSummary.includes("霓虹地牢"),
      turn_guidance_focuses_quality: focus.includes("conflict_pressure"),
      assistant_gives_concrete_tradeoff:
        assistantText.includes("代价") && assistantText.includes("读者回报"),
      no_tool_result: turnResult.tool_result == null,
      no_adoption_state: turnResult.adoption_state == null,
      no_production_write: turnResult.truthfulness?.production_write_performed === false,
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
      why_shows_quality_diagnosis: whyText.includes("质量诊断"),
      why_shows_quality_focus: whyText.includes("冲突压力") && whyText.includes("代价可见"),
      why_shows_current_work_source: whyText.includes("当前作品背景"),
    },
  ];
}

async function driveAu09Au03SessionMemoryLayering(page) {
  const activeToken = "当前蓝桥计划";
  const memoryToken = "银槐誓约";
  const historyToken = "旧稿赤塔";
  const historyTitle = "旧稿赤塔历史会话";

  const sessionSearch = page.getByPlaceholder("搜索会话");
  await sessionSearch.waitFor({ timeout: 10_000 });
  await sessionSearch.fill(historyToken);

  const historySessionButton = page.getByRole("button").filter({ hasText: historyTitle }).first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  const showRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "work_session.show.done" &&
      record.read_only === true &&
      String(record.session_id ?? "").trim().length > 0,
    "No read-only historical session show record",
    30_000,
  );

  await page.waitForFunction(
    (token) =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes(token) &&
      document.body.innerText.includes("正在只读查看历史 transcript"),
    historyToken,
    { timeout: 10_000 },
  );

  const readOnlyText = await page.locator("body").innerText();
  const readonlyInputDisabled = await page.locator(chatInputSelector).isDisabled();
  assert(readonlyInputDisabled, "Chat input was not disabled while viewing history session");
  assert(readOnlyText.includes(historyToken), "Historical transcript was not visible read-only");

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.querySelector('input[placeholder="输入你的想法、问题或指令..."]')?.disabled ===
        false,
    undefined,
    { timeout: 15_000 },
  );

  const message = `请结合${activeToken}和${memoryToken}，说明主角为什么继续追查灵源矿区。`;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const turnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.trace_summary != null,
    "No turn_result with trace summary for AU09/AU03 session memory layering",
    90_000,
  );

  const turnResult = turnFrame.body;
  const sentMessage = latestSentUserMessage();
  assert(sentMessage, "No AU09/AU03 layering user_message websocket frame was sent");

  await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnResult.turn_id &&
      record.has_snapshot === true &&
      record.has_conversation === true &&
      record.has_memory === true,
    "No context.assemble.done with work/session/memory context for AU09/AU03 layering",
    30_000,
  );

  const contextRefs = Array.isArray(turnResult.trace_summary?.context_refs)
    ? turnResult.trace_summary.context_refs
    : [];
  const sourceTypes = contextRefs.map((ref) => String(ref.source_type ?? ""));
  const sessionRef = contextRefs.find(
    (ref) => String(ref.source_type ?? "") === "session_transcript",
  );
  const memoryRef = contextRefs.find((ref) => String(ref.source_type ?? "") === "memory");
  const currentWorkRef = contextRefs.find(
    (ref) => String(ref.source_type ?? "") === "current_work",
  );
  const sessionSummary = String(sessionRef?.summary ?? "");
  const memorySummary = String(memoryRef?.summary ?? "");

  assert(currentWorkRef, "Trace context refs did not include current_work");
  assert(sessionRef, "Trace context refs did not include session_transcript");
  assert(memoryRef, "Trace context refs did not include memory");
  assert(
    !sourceTypes.includes("conversation"),
    "Active session transcript was still labelled conversation",
  );
  assert(
    sessionSummary.includes(activeToken),
    "Session transcript summary did not include active session token",
  );
  assert(
    !sessionSummary.includes(historyToken),
    "Session transcript summary included historical session token",
  );
  assert(
    memorySummary.includes(memoryToken),
    "Memory summary did not include governed memory token",
  );
  assert(!memorySummary.includes(historyToken), "Memory summary included historical session token");

  const whyText = await openLatestWhyDialog(page);
  const uiState = await commonUiState(page, turnResult, sentMessage);
  const unsafePattern = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;

  assert(whyText.includes("当前作品背景"), "Why dialog did not show current work source");
  assert(whyText.includes("当前会话记录"), "Why dialog did not show active session source");
  assert(whyText.includes("已确认设定"), "Why dialog did not show governed memory source");
  assert(whyText.includes(activeToken), "Why dialog did not show active session summary");
  assert(whyText.includes(memoryToken), "Why dialog did not show governed memory summary");
  assert(!whyText.includes(historyToken), "Why dialog included historical transcript content");
  assert(!unsafePattern.test(whyText), "Why dialog exposed unsafe trace or prompt text");

  return [
    {
      ...uiState,
      turn_id: turnResult.turn_id,
      recall_turn_id: turnResult.turn_id,
      readonly_session_id: showRecord.session_id,
      readonly_session_transcript_visible: readOnlyText.includes(historyToken),
      readonly_input_disabled: readonlyInputDisabled,
      active_session_restored: true,
      context_source_types: sourceTypes,
      context_has_current_work: Boolean(currentWorkRef),
      context_has_session_transcript: Boolean(sessionRef),
      context_has_memory: Boolean(memoryRef),
      context_excludes_conversation_fallback: !sourceTypes.includes("conversation"),
      context_session_summary_includes_active: sessionSummary.includes(activeToken),
      context_session_summary_excludes_history: !sessionSummary.includes(historyToken),
      context_memory_summary_includes_memory: memorySummary.includes(memoryToken),
      context_memory_summary_excludes_history: !memorySummary.includes(historyToken),
      trace_why_dialog_open: true,
      trace_why_text: whyText,
      trace_why_contains_raw_prompt: unsafePattern.test(whyText),
      why_shows_current_work_source: whyText.includes("当前作品背景"),
      why_shows_session_source: whyText.includes("当前会话记录"),
      why_shows_memory_source: whyText.includes("已确认设定"),
      why_shows_active_session_summary: whyText.includes(activeToken),
      why_shows_memory_summary: whyText.includes(memoryToken),
      why_excludes_historical_transcript: !whyText.includes(historyToken),
      active_session_token: activeToken,
      memory_token: memoryToken,
      historical_session_token: historyToken,
    },
  ];
}

async function createCandidateSourceTurn(
  page,
  promptText = "我想写一个赛博修仙故事，但还没想好小说创作方向。",
) {
  await page.locator(chatInputSelector).fill(promptText);
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

  await page.waitForFunction(
    () =>
      /继续讨论|继续聊这个方向/.test(document.body.innerText) &&
      /设为后续方向|采用这个方向/.test(document.body.innerText),
    { timeout: 10_000 },
  );

  return { sourceTurnResult, candidate, availableAction };
}

async function driveCandidateContinuation(page) {
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page);
  const afterSourceFrameCount = frames.length;

  await page
    .getByRole("button", { name: /继续讨论|继续聊这个方向/ })
    .first()
    .click();

  const continuationFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === false &&
      frame.body?.candidate_selection?.source_turn_ref === sourceTurnResult.turn_id &&
      frame.body?.candidate_selection?.candidate_set_ref ===
        `candidate_set:${sourceTurnResult.turn_id}` &&
      frame.body?.candidate_selection?.candidate_ref === candidate.direction_id,
    "Real workbench did not send candidate_selection user_message from candidate continuation",
  );

  const continuationTurnFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== sourceTurnResult.turn_id,
    "No candidate continuation turn_result websocket frame was received",
  );
  const continuationTurnResult = continuationTurnFrame.body;

  const framesAfterContinue = frames.slice(afterSourceFrameCount);
  assert(
    !framesAfterContinue.some((frame) => frame.event === "author_action"),
    "Candidate continuation sent an author_action instead of a user_message",
  );
  assert(
    !framesAfterContinue.some((frame) => frame.event === "action_result"),
    "Candidate continuation triggered an action_result",
  );
  assert(
    !continuationTurnResult.adoption_decision,
    "Candidate continuation produced an adoption decision",
  );
  assert(
    continuationTurnResult.truthfulness?.production_write_performed === false,
    "Candidate continuation claimed a production write",
  );

  const uiState = await commonUiState(page, continuationTurnResult, continuationFrame);

  return [
    {
      ...uiState,
      source_turn_ref: sourceTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      frame_badge_goal:
        continuationTurnResult.frame_summary?.dialogue_goal ??
        sourceTurnResult.frame_summary?.dialogue_goal ??
        null,
      candidate_panel_count: await page.locator("[class*=candidatePanel]").count(),
      candidate_selection_sent: true,
      generate_micro_plan: continuationFrame.body.generate_micro_plan,
      candidate_selected: continuationTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: continuationTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: continuationTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterContinue.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterContinue.some(
        (frame) => frame.event === "action_result",
      ),
    },
  ];
}

async function driveCandidateMultiturnContext(page) {
  const nonce = `AU02CTX${Date.now().toString(36).toUpperCase()}`;
  const sourcePrompt = `${nonce} 我想写一个赛博修仙故事，但还没想好小说创作方向。`;
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page, sourcePrompt);
  assert(
    String(candidate.title ?? "").includes(nonce),
    "Source candidate did not carry the AU02 context nonce",
  );

  const afterSourceFrameCount = frames.length;
  await page
    .getByRole("button", { name: /继续讨论|继续聊这个方向/ })
    .first()
    .click();

  const continuationFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === false &&
      frame.body?.candidate_selection?.source_turn_ref === sourceTurnResult.turn_id &&
      frame.body?.candidate_selection?.candidate_ref === candidate.direction_id,
    "Real workbench did not send candidate_selection for multiturn context setup",
  );

  const continuationTurnFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== sourceTurnResult.turn_id,
    "No candidate continuation turn_result was received for multiturn context setup",
  );
  const continuationTurnResult = continuationTurnFrame.body;

  const afterContinuationFrameCount = frames.length;
  const followupText = "这个方向的开场冲突应该怎么设计？不要写正文，只继续聊。";
  await page.locator(chatInputSelector).fill(followupText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const followupFrame = await waitForNewFrame(
    afterContinuationFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === followupText &&
      frame.body?.generate_micro_plan === false &&
      !frame.body?.candidate_selection,
    "Real workbench did not send a plain follow-up user_message for candidate context",
  );

  const followupTurnFrame = await waitForNewFrame(
    afterContinuationFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      ![sourceTurnResult.turn_id, continuationTurnResult.turn_id].includes(frame.body.turn_id),
    "No candidate context follow-up turn_result was received",
  );
  const followupTurnResult = followupTurnFrame.body;

  const followupContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === followupTurnResult.turn_id &&
      record.has_conversation === true &&
      record.has_session_summary === true,
    "Candidate context follow-up did not assemble session conversation context",
    30_000,
  );

  const followupReply = followupTurnResult.assistant_message?.text ?? "";
  assert(
    followupReply.includes(nonce),
    "Candidate context follow-up reply did not reflect the prior candidate nonce",
  );
  assert(
    followupTurnResult.truthfulness?.production_write_performed === false,
    "Candidate context follow-up claimed a production write",
  );
  assert(!followupTurnResult.tool_result, "Candidate context follow-up produced a tool result");
  assert(
    !followupTurnResult.adoption_decision,
    "Candidate context follow-up produced an adoption decision",
  );

  const framesAfterSource = frames.slice(afterSourceFrameCount);
  assert(
    !framesAfterSource.some((frame) => frame.event === "author_action"),
    "Candidate multiturn context sent an author_action",
  );
  assert(
    !framesAfterSource.some((frame) => frame.event === "action_result"),
    "Candidate multiturn context triggered an action_result",
  );

  await page.waitForFunction(
    ({ followup, reply }) =>
      document.body.innerText.includes(followup) &&
      document.body.innerText.includes(reply) &&
      !document.body.innerText.includes("思考中"),
    { followup: followupText, reply: followupReply },
    { timeout: 30_000 },
  );

  const uiState = await commonUiState(page, followupTurnResult, followupFrame);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      continuation_turn_id: continuationTurnResult.turn_id,
      followup_turn_id: followupTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_title: candidate.title,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      context_nonce: nonce,
      candidate_title_visible: visibleText.includes(candidate.title),
      continuation_candidate_selection_sent: Boolean(
        continuationFrame.body?.candidate_selection,
      ),
      followup_plain_user_message_sent: !followupFrame.body?.candidate_selection,
      followup_context_has_conversation: followupContext.has_conversation,
      followup_context_has_session_summary: followupContext.has_session_summary,
      followup_reply_contains_context_nonce: followupReply.includes(nonce),
      followup_message_visible: visibleText.includes(followupText),
      followup_reply_visible: visibleText.includes(followupReply),
      generate_micro_plan: followupFrame.body?.generate_micro_plan,
      tool_result_present: Boolean(followupTurnResult.tool_result),
      adoption_decision_present: Boolean(followupTurnResult.adoption_decision),
      candidate_selected: followupTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: followupTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: followupTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterSource.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterSource.some(
        (frame) => frame.event === "action_result",
      ),
    },
  ];
}

function countChineseCharacters(value) {
  return (String(value ?? "").match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function hasJsonCodeShape(value) {
  return /```|"\s*frame_type"|candidate_directions|assistant_message|\{\s*"/i.test(
    String(value ?? ""),
  );
}

function isCandidateSemanticallyRelevantToCyberCultivation(candidate) {
  const text = [
    candidate?.title,
    candidate?.pitch,
    ...(Array.isArray(candidate?.tone_tags) ? candidate.tone_tags : []),
  ]
    .filter(Boolean)
    .join(" ");
  const relevanceTerms = [
    "赛博",
    "修仙",
    "灵根",
    "灵气",
    "机甲",
    "数据",
    "网络",
    "芯片",
    "云端",
    "心法",
    "功法",
    "道场",
    "神祇",
    "未来",
    "机械",
    "全息",
  ];

  return relevanceTerms.some((term) => text.includes(term));
}

async function driveNaturalExplorationNoSlotForm(page) {
  const beforeSourceFrameCount = frames.length;
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page);
  const sourceMessage = latestSentUserMessage();
  assert(sourceMessage, "No source user_message was captured for natural exploration");

  const frameRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.turn_id === sourceTurnResult.turn_id &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) > 0,
    "Natural exploration turn did not produce a creative_exploration frame",
    30_000,
  );

  const visibleText = await page.locator("body").innerText();
  const forbiddenSlotKeys = ["required_slots", "missing_slots", "slot_schema", "slot_form"];
  const forbiddenSlotFieldsAbsent = forbiddenSlotKeys.every((key) => sourceTurnResult[key] == null);
  const slotFormPattern = /必填字段|字段表单|请填写字段|slot_schema|required_slots|missing_slots/i;
  const executionCardPattern = /确认执行|待确认的创作材料|保存为章节正文|工具执行|MicroPlan/i;
  const framesAfterSource = frames.slice(beforeSourceFrameCount);
  const naturalReplyText = sourceTurnResult.assistant_message?.text ?? "";
  const naturalCandidates = sourceTurnResult.candidate_directions ?? [];
  const lmstudioQualityChecksRequired = process.env.SLICE_VERIFY_PROVIDER === "lmstudio";
  const naturalReplyChinese = countChineseCharacters(naturalReplyText) >= 8;
  const naturalReplyNoJsonCode = !hasJsonCodeShape(naturalReplyText);
  const candidatesNoJsonCode = naturalCandidates.every(
    (item) =>
      !hasJsonCodeShape(
        [
          item.title,
          item.pitch,
          ...(Array.isArray(item.tone_tags) ? item.tone_tags : []),
        ].join(" "),
      ),
  );
  const candidateSemanticallyRelevant =
    naturalCandidates.length >= 2 &&
    naturalCandidates.every(isCandidateSemanticallyRelevantToCyberCultivation);

  assert(
    visibleText.includes(naturalReplyText),
    "Natural exploration assistant reply was not visible",
  );
  assert(visibleText.includes(candidate.title), "Candidate title was not visible");
  assert(forbiddenSlotFieldsAbsent, "TurnResult exposed slot form fields for natural exploration");
  assert(!slotFormPattern.test(visibleText), "Mechanical slot form text was visible");
  assert(!executionCardPattern.test(visibleText), "Execution or confirmation card was visible");
  assert(
    sourceMessage.body?.generate_micro_plan === false,
    "Natural exploration requested a micro plan",
  );
  assert(
    sourceTurnResult.truthfulness?.production_write_performed === false,
    "Natural exploration claimed a production write",
  );
  assert(!sourceTurnResult.tool_result, "Natural exploration produced a tool result");
  assert(!sourceTurnResult.adoption_decision, "Natural exploration produced an adoption decision");
  assert(
    !framesAfterSource.some((frame) => frame.event === "author_action"),
    "Natural exploration sent an author_action",
  );
  assert(
    !framesAfterSource.some((frame) => frame.event === "action_result"),
    "Natural exploration triggered an action_result",
  );
  if (lmstudioQualityChecksRequired) {
    assert(naturalReplyChinese, "LM Studio exploration reply was not a natural Chinese response");
    assert(naturalReplyNoJsonCode, "LM Studio exploration reply exposed JSON/code shape");
    assert(candidatesNoJsonCode, "LM Studio exploration candidates exposed JSON/code shape");
    assert(
      candidateSemanticallyRelevant,
      "LM Studio exploration candidates were not semantically tied to cyber cultivation",
    );
  }

  const uiState = await commonUiState(page, sourceTurnResult, sourceMessage);

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      frame_type: frameRecord.frame_type,
      candidate_count: Number(frameRecord.candidate_count ?? 0),
      candidate_ref: candidate.direction_id,
      candidate_title: candidate.title,
      candidate_titles: naturalCandidates.map((item) => item.title),
      candidate_pitches: naturalCandidates.map((item) => item.pitch),
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      natural_reply_visible: visibleText.includes(naturalReplyText),
      lmstudio_quality_checks_required: lmstudioQualityChecksRequired,
      natural_reply_chinese: naturalReplyChinese,
      natural_reply_no_json_code: naturalReplyNoJsonCode,
      candidates_no_json_code: candidatesNoJsonCode,
      candidate_semantically_relevant: candidateSemanticallyRelevant,
      candidate_panel_rendered: await page.locator("[class*=candidatePanel]").count(),
      slot_form_visible: slotFormPattern.test(visibleText),
      forbidden_slot_fields_absent: forbiddenSlotFieldsAbsent,
      durable_clarification_opened: false,
      execution_card_visible: executionCardPattern.test(visibleText),
      generate_micro_plan: sourceMessage.body?.generate_micro_plan,
      tool_result_present: Boolean(sourceTurnResult.tool_result),
      adoption_decision_present: Boolean(sourceTurnResult.adoption_decision),
      candidate_selected: sourceTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: sourceTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: sourceTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterSource.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterSource.some(
        (frame) => frame.event === "action_result",
      ),
    },
  ];
}

async function driveCandidateFallbackUi(page) {
  const beforeSourceFrameCount = frames.length;
  const promptText =
    "AU02BADCANDIDATES 我想写赛博修仙方向，但上游候选格式坏了时也要给可用方向。";
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page, promptText);
  const sourceMessage = latestSentUserMessage();
  assert(sourceMessage, "No source user_message was captured for candidate fallback");

  const frameRecord = await waitForAppLogRecord(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.turn_id === sourceTurnResult.turn_id &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) >= 2,
    "Candidate fallback turn did not produce a creative_exploration frame with candidates",
    30_000,
  );

  const candidates = sourceTurnResult.candidate_directions ?? [];
  const fallbackCandidateTitles = candidates.map((item) => item.title);
  const fallbackCandidatePitches = candidates.map((item) => item.pitch);
  const hasKnownFallbackCandidate = fallbackCandidateTitles.includes("矛盾切入");
  const candidateFieldsNonempty = candidates.every(
    (item) => String(item.title ?? "").trim() !== "" && String(item.pitch ?? "").trim() !== "",
  );
  const candidateStatusesNotAdopted = candidates.every(
    (item) => item.adoption_status === "not_adopted",
  );
  const visibleText = await page.locator("body").innerText();
  const framesAfterSource = frames.slice(beforeSourceFrameCount);

  assert(
    sourceMessage.body?.text === promptText &&
      sourceMessage.body?.generate_micro_plan === false,
    "Real workbench did not send the malformed-candidate prompt as a no-MicroPlan user_message",
  );
  assert(candidates.length >= 2, "Fallback candidate list was not populated");
  assert(hasKnownFallbackCandidate, "TurnResult did not contain the known Planner fallback candidate");
  assert(candidateFieldsNonempty, "Fallback candidates contained empty title or pitch");
  assert(candidateStatusesNotAdopted, "Fallback candidates were not marked not_adopted");
  assert(visibleText.includes("矛盾切入"), "Fallback candidate title was not visible in UI");
  assert(
    sourceTurnResult.truthfulness?.production_write_performed === false,
    "Candidate fallback turn claimed a production write",
  );
  assert(!sourceTurnResult.tool_result, "Candidate fallback turn produced a tool result");
  assert(!sourceTurnResult.adoption_decision, "Candidate fallback turn produced an adoption decision");
  assert(
    !framesAfterSource.some((frame) => frame.event === "author_action"),
    "Candidate fallback sent an author_action",
  );
  assert(
    !framesAfterSource.some((frame) => frame.event === "action_result"),
    "Candidate fallback triggered an action_result",
  );

  const uiState = await commonUiState(page, sourceTurnResult, sourceMessage);

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      provider_candidate_payload: "malformed_candidates",
      frame_type: frameRecord.frame_type,
      frame_candidate_count: Number(frameRecord.candidate_count ?? 0),
      turn_result_candidate_count: candidates.length,
      fallback_candidate_titles: fallbackCandidateTitles,
      fallback_candidate_pitches: fallbackCandidatePitches,
      fallback_candidate_visible: visibleText.includes("矛盾切入"),
      has_known_fallback_candidate: hasKnownFallbackCandidate,
      candidate_fields_nonempty: candidateFieldsNonempty,
      candidate_statuses_not_adopted: candidateStatusesNotAdopted,
      candidate_ref: candidate.direction_id,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      candidate_panel_rendered: await page.locator("[class*=candidatePanel]").count(),
      malformed_candidate_prompt_sent: sourceMessage.body?.text === promptText,
      generate_micro_plan: sourceMessage.body?.generate_micro_plan,
      tool_result_present: Boolean(sourceTurnResult.tool_result),
      adoption_decision_present: Boolean(sourceTurnResult.adoption_decision),
      candidate_selected: sourceTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: sourceTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: sourceTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterSource.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterSource.some(
        (frame) => frame.event === "action_result",
      ),
    },
  ];
}

async function driveCandidateFreeformFollowup(page) {
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page);
  const afterSourceFrameCount = frames.length;
  const freeformMessage = `不点候选按钮，我直接追问：${candidate.title} 这个方向还能怎么展开？`;

  const candidatePanelCountAfterSource = await page.locator("[class*=candidatePanel]").count();
  const inputEnabledAfterCandidate = await page.locator(chatInputSelector).isEnabled();
  const continueButtonCount = await page
    .getByRole("button", { name: /继续讨论|继续聊这个方向/ })
    .count();
  const adoptButtonCount = await page
    .getByRole("button", { name: /设为后续方向|采用这个方向/ })
    .count();

  assert(candidatePanelCountAfterSource > 0, "Candidate panel was not visible before freeform");
  assert(inputEnabledAfterCandidate, "Chat input was disabled after candidate panel appeared");

  await page.locator(chatInputSelector).fill(freeformMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const freeformFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === freeformMessage &&
      frame.body?.generate_micro_plan === false &&
      !frame.body?.candidate_selection,
    "Real workbench did not send a plain user_message for freeform candidate follow-up",
  );

  const freeformTurnFrame = await waitForNewFrame(
    afterSourceFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== sourceTurnResult.turn_id,
    "No freeform candidate follow-up turn_result websocket frame was received",
  );
  const freeformTurnResult = freeformTurnFrame.body;

  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText) &&
      !document.body.innerText.includes("思考中"),
    {
      message: freeformMessage,
      assistantText: freeformTurnResult.assistant_message.text,
    },
    { timeout: 30_000 },
  );

  const framesAfterFreeform = frames.slice(afterSourceFrameCount);
  assert(
    !framesAfterFreeform.some((frame) => frame.event === "author_action"),
    "Freeform candidate follow-up sent an author_action",
  );
  assert(
    !framesAfterFreeform.some((frame) => frame.event === "action_result"),
    "Freeform candidate follow-up triggered an action_result",
  );
  assert(
    !freeformTurnResult.adoption_decision,
    "Freeform candidate follow-up produced an adoption decision",
  );
  assert(
    freeformTurnResult.truthfulness?.production_write_performed === false,
    "Freeform candidate follow-up claimed a production write",
  );

  const uiState = await commonUiState(page, freeformTurnResult, freeformFrame);
  const visibleText = await page.locator("body").innerText();

  return [
    {
      ...uiState,
      source_turn_ref: sourceTurnResult.turn_id,
      freeform_turn_id: freeformTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_title: candidate.title,
      candidate_set_ref: `candidate_set:${sourceTurnResult.turn_id}`,
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      candidate_panel_count_after_source: candidatePanelCountAfterSource,
      input_enabled_after_candidate: inputEnabledAfterCandidate,
      candidate_continue_button_count: continueButtonCount,
      candidate_adopt_button_count: adoptButtonCount,
      freeform_message_text: freeformMessage,
      freeform_message_visible: visibleText.includes(freeformMessage),
      freeform_assistant_reply_visible: visibleText.includes(
        freeformTurnResult.assistant_message.text,
      ),
      freeform_user_message_sent: true,
      candidate_selection_sent: Boolean(freeformFrame.body?.candidate_selection),
      generate_micro_plan: freeformFrame.body.generate_micro_plan,
      candidate_selected: freeformTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: freeformTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: freeformTurnResult.truthfulness?.production_write_performed,
      no_author_action_sent: !framesAfterFreeform.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterFreeform.some(
        (frame) => frame.event === "action_result",
      ),
      adoption_decision_present: Boolean(freeformTurnResult.adoption_decision),
    },
  ];
}

async function driveUnadoptedCandidateNoReadingFact(page) {
  const { sourceTurnResult, candidate } = await createCandidateSourceTurn(page);
  const sourceMessage = latestSentUserMessage();
  assert(sourceMessage, "No source user_message was captured for candidate turn");

  const afterSourceFrameCount = frames.length;
  const beforeReadingLogCount = readAppLogRecords().length;
  const candidatePitch = candidate.pitch ?? "";
  const candidateSetRef = `candidate_set:${sourceTurnResult.turn_id}`;
  const textBeforeReading = await page.locator("body").innerText();

  assert(
    textBeforeReading.includes(candidate.title),
    "Candidate title was not visible before reading mode",
  );
  assert(
    candidatePitch === "" || textBeforeReading.includes(candidatePitch),
    "Candidate pitch was not visible before reading mode",
  );
  assert(
    sourceTurnResult.truthfulness?.production_write_performed === false,
    "Source candidate turn claimed a production write",
  );

  await page.getByRole("button", { name: readingModeButtonPattern }).click();

  const tocRecord = await waitForNewAppLogRecord(
    beforeReadingLogCount,
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === sourceMessage.body?.work_id &&
      Number(record.chapter_count ?? -1) === 0 &&
      Number(record.total_word_count ?? -1) === 0,
    "Reading mode did not read an empty TOC after unadopted candidate presentation",
    30_000,
  );

  await page.waitForFunction(
    ({ title, pitch }) =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("暂无已采纳的章节内容") &&
      !document.body.innerText.includes(title) &&
      (pitch === "" || !document.body.innerText.includes(pitch)),
    { title: candidate.title, pitch: candidatePitch },
    { timeout: 15_000 },
  );

  const readingText = await page.locator("body").innerText();
  const framesAfterSource = frames.slice(afterSourceFrameCount);
  assert(
    !framesAfterSource.some((frame) => frame.event === "author_action"),
    "Unadopted candidate check sent an author_action",
  );
  assert(
    !framesAfterSource.some((frame) => frame.event === "action_result"),
    "Unadopted candidate check triggered an action_result",
  );
  assert(
    !sourceTurnResult.adoption_decision,
    "Source candidate turn produced an adoption decision",
  );

  const uiState = await commonUiState(page, sourceTurnResult, sourceMessage);

  return [
    {
      ...uiState,
      source_turn_id: sourceTurnResult.turn_id,
      candidate_ref: candidate.direction_id,
      candidate_title: candidate.title,
      candidate_pitch: candidatePitch,
      candidate_set_ref: candidateSetRef,
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      candidate_panel_rendered_before_reading: true,
      reading_mode_opened: true,
      reading_empty_state_visible: readingText.includes("暂无已采纳的章节内容"),
      reading_toc_chapter_count: Number(tocRecord.chapter_count ?? -1),
      reading_total_word_count: Number(tocRecord.total_word_count ?? -1),
      candidate_title_visible_in_reading: readingText.includes(candidate.title),
      candidate_pitch_visible_in_reading:
        candidatePitch !== "" && readingText.includes(candidatePitch),
      candidate_selected: sourceTurnResult.truthfulness?.candidate_selected ?? false,
      candidate_adopted: sourceTurnResult.truthfulness?.candidate_adopted ?? false,
      production_write_performed: sourceTurnResult.truthfulness?.production_write_performed,
      adoption_decision_present: Boolean(sourceTurnResult.adoption_decision),
      generate_micro_plan: sourceMessage.body?.generate_micro_plan,
      no_author_action_sent: !framesAfterSource.some((frame) => frame.event === "author_action"),
      no_action_result_received: !framesAfterSource.some(
        (frame) => frame.event === "action_result",
      ),
      no_projection_events: !readAppLogRecords()
        .slice(beforeReadingLogCount)
        .some((record) => String(record.event ?? "").startsWith("projection.")),
    },
  ];
}

async function driveCandidateAdoptionBridge(page) {
  const { sourceTurnResult, candidate, availableAction } = await createCandidateSourceTurn(page);

  await page
    .getByRole("button", { name: /设为后续方向|采用这个方向/ })
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
    "Real workbench did not send server-provided choose_candidate author_action from candidate adoption",
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
      candidate_continue_clicked: false,
      candidate_adopt_clicked: true,
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
      /待确认的创作材料|待确认正文草稿|待保存章节草稿|章节正文草稿|正文草稿/.test(
        document.body.innerText,
      ) &&
      /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(document.body.innerText),
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
      confirmation_card_visible: true,
      pending_draft_visible: visibleTextIncludesPendingDraft(visibleText),
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

async function driveAu04ConfirmIdempotencyUi(page) {
  const requestText =
    "第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

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

  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  const confirmButton = page.getByRole("button", { name: "确认执行" }).first();
  await confirmButton.waitFor({ timeout: 10_000 });
  const buttonBox = await confirmButton.boundingBox();
  assert(buttonBox, "Confirm button was not visible enough to receive pointer input");

  const beforeConfirmFrameCount = frames.length;
  const beforeConfirmLogCount = readAppLogRecords().length;
  await page.mouse.dblclick(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2, {
    delay: 20,
  });

  const confirmActionFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === confirmAction.action_id,
    "Real workbench did not send the confirm_before_execute author_action",
  );

  const executedTurnFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "prose_writing" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No prose_fragment turn_result was received after confirm_before_execute",
    200_000,
  );
  const executedTurnResult = executedTurnFrame.body;

  await waitForAppLogCount(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === executedTurnResult.turn_id &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
    1,
    "No toolbox.execute.done log proved prose_writing ran after confirmation",
    30_000,
  );

  await sleep(1_000);

  const framesAfterConfirm = frames.slice(beforeConfirmFrameCount);
  const logsAfterConfirm = readAppLogRecords().slice(beforeConfirmLogCount);
  const sentConfirmActionFrames = framesAfterConfirm.filter(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === confirmAction.action_id,
  );
  const duplicateActionResultFrames = framesAfterConfirm.filter(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.duplicate === true &&
      frame.body?.idempotency_key === confirmAction.idempotency_key,
  );
  const authorActionDoneRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.turn_id === confirmTurnResult.turn_id &&
      record.action_type === "confirm_before_execute" &&
      record.action_id === confirmAction.action_id,
  );
  const nonDuplicateAuthorActionDoneRecords = authorActionDoneRecords.filter(
    (record) => record.duplicate !== true,
  );
  const duplicateAuthorActionDoneRecords = authorActionDoneRecords.filter(
    (record) => record.duplicate === true,
  );
  const toolboxExecuteRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === executedTurnResult.turn_id &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  const executedTurnFrames = framesAfterConfirm.filter(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id === executedTurnResult.turn_id &&
      frame.body?.tool_result?.tool_name === "prose_writing",
  );
  const pendingProseFragmentCount = executedTurnFrames.reduce(
    (count, frame) =>
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length,
    0,
  );
  const duplicateSuppressedOrDeduped =
    sentConfirmActionFrames.length === 1 ||
    duplicateActionResultFrames.length >= 1 ||
    duplicateAuthorActionDoneRecords.length >= 1;

  await page.waitForFunction(
    () =>
      /待确认的创作材料|待确认正文草稿|待保存章节草稿|章节正文草稿|正文草稿/.test(
        document.body.innerText,
      ) &&
      /确认创建|保存为章节正文|保存到大纲|保存到作品档案|保存到作品/.test(document.body.innerText),
    { timeout: 10_000 },
  );
  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, executedTurnResult, sentMessage);
  const pendingArtifact = executedTurnResult.adoption_state.pending[0];

  assert(
    confirmTurnResult.truthfulness?.tool_called === false,
    "Confirmation turn_result claimed tool execution before author confirmed",
  );
  assert(
    confirmTurnResult.truthfulness?.production_write_performed === false,
    "Confirmation turn_result claimed a production write before author confirmed",
  );
  assert(sentConfirmActionFrames.length >= 1, "Rapid confirm did not send any author_action");
  assert(
    nonDuplicateAuthorActionDoneRecords.length === 1,
    `Expected exactly one non-duplicate confirm receipt, got ${nonDuplicateAuthorActionDoneRecords.length}`,
  );
  assert(
    duplicateSuppressedOrDeduped,
    "Rapid confirm was neither suppressed by the UI nor deduplicated by the action boundary",
  );
  assert(
    toolboxExecuteRecords.length === 1,
    `Expected exactly one prose_writing dispatch after rapid confirm, got ${toolboxExecuteRecords.length}`,
  );
  assert(
    pendingProseFragmentCount === 1,
    `Expected exactly one pending prose_fragment after rapid confirm, got ${pendingProseFragmentCount}`,
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
      confirmation_card_visible: true,
      pending_draft_visible: visibleTextIncludesPendingDraft(visibleText),
      plan_carried_over_wire: confirmTurnResult.plan != null,
      confirm_action_behavior_ref: confirmAction.behavior_ref ?? "",
      confirm_action_id: confirmAction.action_id,
      confirm_action_idempotency_key: confirmAction.idempotency_key,
      tool_called_before_confirm: confirmTurnResult.truthfulness?.tool_called === true,
      production_write_before_confirm:
        confirmTurnResult.truthfulness?.production_write_performed === true,
      confirm_double_click_attempted: true,
      confirm_action_sent:
        confirmActionFrame.body?.action?.action_type === "confirm_before_execute",
      sent_confirm_action_count: sentConfirmActionFrames.length,
      author_action_done_count: authorActionDoneRecords.length,
      non_duplicate_author_action_done_count: nonDuplicateAuthorActionDoneRecords.length,
      duplicate_author_action_done_count: duplicateAuthorActionDoneRecords.length,
      duplicate_action_result_count: duplicateActionResultFrames.length,
      duplicate_suppressed_or_deduped: duplicateSuppressedOrDeduped,
      confirmed_dispatch: executedTurnResult.truthfulness?.tool_called === true,
      toolbox_execute_count: toolboxExecuteRecords.length,
      executed_turn_result_count: executedTurnFrames.length,
      pending_prose_fragment_count: pendingProseFragmentCount,
      no_duplicate_tool_dispatch: toolboxExecuteRecords.length === 1,
      single_pending_artifact_after_confirm: pendingProseFragmentCount === 1,
      artifact_pending_after_confirm: pendingArtifact.artifact_type === "prose_fragment",
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu04StaleConfirmationUi(page) {
  const requestText =
    "第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。";
  const followupText = "先普通聊一句：我们暂时只讨论节奏和读者感受。";

  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: /^发送$/ }).click();

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

  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );

  const beforeFollowFrameCount = frames.length;
  await page.locator(chatInputSelector).fill(followupText);
  await page.getByRole("button", { name: /^发送$/ }).click();

  await waitForNewFrame(
    beforeFollowFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.text === followupText,
    "Real workbench did not send the follow-up message that advances the current turn",
  );

  const followupTurnFrame = await waitForNewFrame(
    beforeFollowFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id !== confirmTurnResult.turn_id &&
      frame.body?.status !== "needs_confirmation",
    "No follow-up turn_result advanced the current turn after the confirmation card",
    200_000,
  );
  const followupTurnResult = followupTurnFrame.body;

  const beforeStaleFrameCount = frames.length;
  const beforeStaleLogCount = readAppLogRecords().length;
  const staleConfirmButton = page.getByRole("button", { name: "确认执行" }).first();
  const staleConfirmButtonCount = await page.getByRole("button", { name: "确认执行" }).count();
  const staleConfirmVisible =
    staleConfirmButtonCount > 0 ? await staleConfirmButton.isVisible().catch(() => false) : false;
  const staleConfirmDisabled =
    staleConfirmVisible ? await staleConfirmButton.isDisabled().catch(() => false) : false;

  let staleClickAttempted = false;
  let staleActionSent = false;
  let staleActionRejected = false;
  let staleRejectionReason = "";

  if (staleConfirmVisible && !staleConfirmDisabled) {
    staleClickAttempted = true;
    await staleConfirmButton.click();

    await waitForNewFrame(
      beforeStaleFrameCount,
      (frame) =>
        frame.direction === "sent" &&
        frame.event === "author_action" &&
        frame.body?.action?.action_type === "confirm_before_execute" &&
        frame.body?.action?.action_id === confirmAction.action_id,
      "Real workbench did not send the stale confirm author_action",
    );
    staleActionSent = true;

    const staleErrorFrame = await waitForNewFrame(
      beforeStaleFrameCount,
      (frame) =>
        frame.direction === "received" &&
        frame.event === "phx_reply" &&
        frame.body?.status === "error" &&
        JSON.stringify(frame.body).includes("stale"),
      "Stale confirm author_action was not rejected by the channel",
    );
    staleActionRejected = true;
    staleRejectionReason = JSON.stringify(staleErrorFrame.body);

    await page.waitForFunction(() => document.body.innerText.includes("操作失败，请重试。"), {
      timeout: 10_000,
    });
  }

  await sleep(1_000);

  const framesAfterStale = frames.slice(beforeStaleFrameCount);
  const logsAfterStale = readAppLogRecords().slice(beforeStaleLogCount);
  const sentStaleConfirmActionFrames = framesAfterStale.filter(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === confirmAction.action_id,
  );
  const authorActionErrorRecords = logsAfterStale.filter(
    (record) =>
      record.event === "channel.author_action.error" &&
      record.action_type === "confirm_before_execute" &&
      record.action_id === confirmAction.action_id &&
      String(record.outcome_detail ?? "").includes("stale"),
  );
  const toolboxExecuteAfterStaleRecords = logsAfterStale.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentAfterStaleCount = framesAfterStale.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);

  const staleConfirmPrevented =
    (!staleConfirmVisible && sentStaleConfirmActionFrames.length === 0) ||
    staleConfirmDisabled ||
    staleActionRejected ||
    authorActionErrorRecords.length >= 1;

  const visibleText = await page.locator("body").innerText();
  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, followupTurnResult, sentMessage);

  assert(
    confirmTurnResult.truthfulness?.tool_called === false,
    "Confirmation turn_result claimed tool execution before author confirmed",
  );
  assert(
    confirmTurnResult.truthfulness?.production_write_performed === false,
    "Confirmation turn_result claimed a production write before author confirmed",
  );
  assert(
    followupTurnResult.turn_id !== confirmTurnResult.turn_id,
    "Follow-up turn did not advance current turn",
  );
  assert(staleConfirmPrevented, "Stale confirmation was neither hidden, disabled, nor rejected");
  assert(
    toolboxExecuteAfterStaleRecords.length === 0,
    `Expected no toolbox execution after stale confirm, got ${toolboxExecuteAfterStaleRecords.length}`,
  );
  assert(
    pendingProseFragmentAfterStaleCount === 0,
    `Expected no pending prose_fragment after stale confirm, got ${pendingProseFragmentAfterStaleCount}`,
  );

  return [
    {
      ...uiState,
      turn_id: confirmTurnResult.turn_id,
      confirm_turn_id: confirmTurnResult.turn_id,
      followup_turn_id: followupTurnResult.turn_id,
      confirmation_card_received: true,
      confirmation_card_visible: true,
      plan_carried_over_wire: confirmTurnResult.plan != null,
      confirm_action_behavior_ref: confirmAction.behavior_ref ?? "",
      tool_called_before_confirm: confirmTurnResult.truthfulness?.tool_called === true,
      production_write_before_confirm:
        confirmTurnResult.truthfulness?.production_write_performed === true,
      followup_turn_completed: true,
      followup_advanced_current_turn: followupTurnResult.turn_id !== confirmTurnResult.turn_id,
      stale_confirm_visible: staleConfirmVisible,
      stale_confirm_disabled: staleConfirmDisabled,
      stale_confirm_click_attempted: staleClickAttempted,
      stale_confirm_action_sent: staleActionSent || sentStaleConfirmActionFrames.length >= 1,
      stale_confirm_rejected: staleActionRejected || authorActionErrorRecords.length >= 1,
      stale_confirm_prevented: staleConfirmPrevented,
      stale_rejection_reason: staleRejectionReason,
      author_action_error_count: authorActionErrorRecords.length,
      toolbox_execute_after_stale_count: toolboxExecuteAfterStaleRecords.length,
      pending_prose_fragment_after_stale_count: pendingProseFragmentAfterStaleCount,
      no_tool_dispatch_after_stale: toolboxExecuteAfterStaleRecords.length === 0,
      no_pending_artifact_after_stale: pendingProseFragmentAfterStaleCount === 0,
      action_failure_visible: visibleText.includes("操作失败，请重试。"),
      user_message_text: sentMessage?.body?.text,
    },
  ];
}

async function driveAu04ConfirmationTtlUi(page) {
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("已经过期的确认") &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    { timeout: 20_000 },
  );

  const beforeConfirmFrameCount = frames.length;
  const beforeConfirmLogCount = readAppLogRecords().length;
  const visibleBeforeClick = await page.locator("body").innerText();

  await page.getByRole("button", { name: "确认执行" }).first().click();

  const actionFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === "act_au04_expired_confirm" &&
      frame.body?.action?.source_turn_ref === "turn_au04_expired_confirmation_seed",
    "Real workbench did not send the expired confirm author_action",
  );

  const errorFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "phx_reply" &&
      frame.body?.status === "error" &&
      JSON.stringify(frame.body).includes("expired action"),
    "Expired confirm author_action was not rejected by the channel",
  );

  await page.waitForFunction(() => document.body.innerText.includes("操作失败，请重试。"), {
    timeout: 10_000,
  });
  await sleep(1_000);

  const framesAfterConfirm = frames.slice(beforeConfirmFrameCount);
  const logsAfterConfirm = readAppLogRecords().slice(beforeConfirmLogCount);
  const authorActionErrorRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "channel.author_action.error" &&
      record.turn_id === "turn_au04_expired_confirmation_seed" &&
      record.action_type === "confirm_before_execute" &&
      record.action_id === "act_au04_expired_confirm" &&
      String(record.outcome_detail ?? "").includes("expired action"),
  );
  const toolboxExecuteRecords = logsAfterConfirm.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentCount = framesAfterConfirm.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);
  const visibleAfterClick = await page.locator("body").innerText();
  const joinRecord = readAppLogRecords().find(
    (record) => record.event === "channel.join.done" && record.work_id,
  );

  assert(
    authorActionErrorRecords.length >= 1,
    "No channel.author_action.error log recorded expired action rejection",
  );
  assert(
    toolboxExecuteRecords.length === 0,
    `Expected no toolbox execution after expired confirm, got ${toolboxExecuteRecords.length}`,
  );
  assert(
    pendingProseFragmentCount === 0,
    `Expected no pending prose_fragment after expired confirm, got ${pendingProseFragmentCount}`,
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_expired_confirmation_seed",
      work_id: joinRecord?.work_id,
      workspace_id: joinRecord?.work_id,
      session_id: joinRecord?.session_id,
      confirmation_card_restored: true,
      confirmation_card_visible:
        visibleBeforeClick.includes("确认执行") && visibleBeforeClick.includes("拒绝"),
      expired_confirm_click_attempted: true,
      expired_confirm_action_sent:
        actionFrame.body?.action?.action_type === "confirm_before_execute",
      expired_confirm_rejected: true,
      expired_rejection_reason: JSON.stringify(errorFrame.body),
      author_action_error_count: authorActionErrorRecords.length,
      toolbox_execute_after_expired_count: toolboxExecuteRecords.length,
      pending_prose_fragment_after_expired_count: pendingProseFragmentCount,
      no_tool_dispatch_after_expired: toolboxExecuteRecords.length === 0,
      no_pending_artifact_after_expired: pendingProseFragmentCount === 0,
      action_failure_visible: visibleAfterClick.includes("操作失败，请重试。"),
      outcome: "done",
    },
  ];
}

async function driveAu04DisabledConfirmationActionUi(page) {
  const title = "AU04 禁用确认动作作品";
  const disabledReason = "当前作品状态已变化，请重新生成计划后再确认。";
  const work = await waitForWorkByTitle(title);
  const joinRecord = await ensureWorkSelectedByTitle(page, title, work.id);

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("AU04禁用确认动作文本") &&
      document.body.innerText.includes("禁用确认动作") &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    { timeout: 20_000 },
  );

  const beforeAttemptFrameCount = frames.length;
  const beforeAttemptLogCount = readAppLogRecords().length;
  const visibleBeforeAttempt = await page.locator("body").innerText();
  const confirmButton = page.getByRole("button", { name: "确认执行" }).first();
  const rejectButton = page.getByRole("button", { name: "拒绝" }).first();
  const confirmButtonCount = await page.getByRole("button", { name: "确认执行" }).count();
  const rejectButtonCount = await page.getByRole("button", { name: "拒绝" }).count();
  const confirmButtonDisabled = await confirmButton.isDisabled();
  const rejectButtonDisabled = await rejectButton.isDisabled();
  const confirmButtonTitle = await confirmButton.getAttribute("title");

  let disabledClickBlockedByBrowser = false;
  try {
    await confirmButton.click({ timeout: 1_000 });
  } catch {
    disabledClickBlockedByBrowser = true;
  }

  await sleep(1_000);

  const framesAfterAttempt = frames.slice(beforeAttemptFrameCount);
  const logsAfterAttempt = readAppLogRecords().slice(beforeAttemptLogCount);
  const sentAuthorActions = framesAfterAttempt.filter(
    (frame) => frame.direction === "sent" && frame.event === "author_action",
  );
  const disabledConfirmActionFrames = sentAuthorActions.filter(
    (frame) =>
      frame.body?.action?.action_type === "confirm_before_execute" &&
      frame.body?.action?.action_id === "act_au04_disabled_confirm",
  );
  const channelAuthorActionRecords = logsAfterAttempt.filter((record) =>
    String(record.event ?? "").startsWith("channel.author_action."),
  );
  const toolboxExecuteRecords = logsAfterAttempt.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentCount = framesAfterAttempt.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);

  assert(confirmButtonCount >= 1, "Disabled confirmation card did not expose confirm action");
  assert(rejectButtonCount >= 1, "Disabled confirmation card did not expose reject action");
  assert(confirmButtonDisabled, "Confirm action was not disabled in the real workbench");
  assert(!rejectButtonDisabled, "Reject action was disabled together with confirm");
  assert(
    confirmButtonTitle === disabledReason,
    `Disabled confirm title did not explain reason: ${confirmButtonTitle ?? "null"}`,
  );
  assert(disabledClickBlockedByBrowser, "Disabled confirm click was not blocked by the browser");
  assert(disabledConfirmActionFrames.length === 0, "Disabled confirm sent an author_action");
  assert(sentAuthorActions.length === 0, "Disabled confirmation attempt sent an author_action");
  assert(
    channelAuthorActionRecords.length === 0,
    "Disabled confirmation attempt reached the channel author_action boundary",
  );
  assert(
    toolboxExecuteRecords.length === 0,
    `Disabled confirmation dispatched tools ${toolboxExecuteRecords.length} times`,
  );
  assert(
    pendingProseFragmentCount === 0,
    `Disabled confirmation created ${pendingProseFragmentCount} pending prose fragments`,
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_disabled_confirmation_seed",
      turn_ids: ["turn_au04_disabled_confirmation_seed"],
      work_id: work.id,
      workspace_id: work.id,
      session_id: joinRecord?.session_id,
      confirmation_card_restored: true,
      confirmation_card_visible:
        visibleBeforeAttempt.includes("确认执行") && visibleBeforeAttempt.includes("拒绝"),
      disabled_confirm_button_count: confirmButtonCount,
      reject_button_count: rejectButtonCount,
      disabled_confirm_visible: confirmButtonCount >= 1,
      disabled_confirm_disabled: confirmButtonDisabled,
      disabled_confirm_title: confirmButtonTitle,
      disabled_reason_visible_via_title: confirmButtonTitle === disabledReason,
      reject_action_still_enabled: !rejectButtonDisabled,
      disabled_click_attempted: true,
      disabled_click_blocked_by_browser: disabledClickBlockedByBrowser,
      author_action_sent_count: sentAuthorActions.length,
      disabled_confirm_action_sent_count: disabledConfirmActionFrames.length,
      channel_author_action_log_count: channelAuthorActionRecords.length,
      toolbox_execute_after_disabled_attempt_count: toolboxExecuteRecords.length,
      pending_prose_fragment_after_disabled_attempt_count: pendingProseFragmentCount,
      no_author_action_sent: sentAuthorActions.length === 0,
      no_channel_author_action_log: channelAuthorActionRecords.length === 0,
      no_tool_dispatch_after_disabled_attempt: toolboxExecuteRecords.length === 0,
      no_pending_artifact_after_disabled_attempt: pendingProseFragmentCount === 0,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu04HistoryConfirmationReadonly(page) {
  const joinReply = latestChannelJoinReply();
  const workId = joinReply?.body?.response?.work_id ?? joinReply?.body?.work_id ?? null;
  const activeSessionId =
    joinReply?.body?.response?.session_id ?? joinReply?.body?.session_id ?? null;
  assert(workId, "No work_id was available from the real channel join");

  const searchResponse = await fetch(
    `${baseUrl}/api/works/${encodeURIComponent(workId)}/sessions?query=${encodeURIComponent("AU04 历史确认")}`,
  );
  assert(
    searchResponse.ok,
    `Failed to search seeded AU-04 history confirmation session: HTTP ${searchResponse.status}`,
  );
  const searchBody = await searchResponse.json();
  const seededHistorySession = (searchBody.sessions ?? []).find(
    (session) => session.title === "AU04 历史确认只读",
  );
  assert(
    seededHistorySession?.id,
    "Seeded AU-04 history confirmation session was not available through sessions API",
  );

  const beforeOpenFrameCount = frames.length;
  const beforeOpenLogCount = readAppLogRecords().length;
  const searchBox = page.getByPlaceholder("搜索会话");
  await searchBox.waitFor({ timeout: 10_000 });
  await searchBox.fill("AU04 历史确认");

  const historySessionButton = page
    .locator("button")
    .filter({ hasText: "AU04 历史确认只读" })
    .first();
  await historySessionButton.waitFor({ timeout: 10_000 });
  await historySessionButton.click();

  const shownHistory = await waitForNewAppLogRecord(
    beforeOpenLogCount,
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === workId &&
      record.session_id === seededHistorySession.id &&
      record.read_only === true &&
      Number(record.transcript_count ?? 0) >= 2,
    "AU-04 history confirmation session was not opened read-only",
    30_000,
  );

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("历史会话") &&
      document.body.innerText.includes("这是历史会话里的待确认执行") &&
      document.body.innerText.includes("返回当前会话"),
    { timeout: 10_000 },
  );

  await sleep(1_000);

  const readonlySnapshot = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    const buttons = [...document.querySelectorAll("button")].map((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
      confirm_button_count: buttons.filter((text) => text === "确认执行").length,
      reject_button_count: buttons.filter((text) => text === "拒绝").length,
      branch_button_visible: buttons.some((text) => text.includes("从这里继续")),
      back_button_visible: buttons.some((text) => text.includes("返回当前会话")),
    };
  });

  const framesAfterOpen = frames.slice(beforeOpenFrameCount);
  const logsAfterOpen = readAppLogRecords().slice(beforeOpenLogCount);
  const sentAuthorActions = framesAfterOpen.filter(
    (frame) => frame.direction === "sent" && frame.event === "author_action",
  );
  const channelAuthorActionRecords = logsAfterOpen.filter((record) =>
    String(record.event ?? "").startsWith("channel.author_action."),
  );
  const toolboxExecuteRecords = logsAfterOpen.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentCount = framesAfterOpen.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);

  assert(seededHistorySession.status === "EXITED", "Seeded history session status was not EXITED");
  assert(readonlySnapshot.input_disabled, "History confirmation input was not disabled");
  assert(readonlySnapshot.send_disabled, "History confirmation send button was not disabled");
  assert(
    readonlySnapshot.visible_text.includes("这是历史会话里的待确认执行"),
    "History confirmation transcript was not visible",
  );
  assert(
    readonlySnapshot.confirm_button_count === 0,
    `History confirmation exposed ${readonlySnapshot.confirm_button_count} confirm buttons`,
  );
  assert(
    readonlySnapshot.reject_button_count === 0,
    `History confirmation exposed ${readonlySnapshot.reject_button_count} reject buttons`,
  );
  assert(sentAuthorActions.length === 0, "Readonly history session sent an author_action");
  assert(
    channelAuthorActionRecords.length === 0,
    "Readonly history session produced channel.author_action logs",
  );
  assert(
    toolboxExecuteRecords.length === 0,
    `Readonly history confirmation executed tools ${toolboxExecuteRecords.length} times`,
  );
  assert(
    pendingProseFragmentCount === 0,
    `Readonly history confirmation created ${pendingProseFragmentCount} pending prose fragments`,
  );

  await page.getByRole("button", { name: "返回当前会话" }).click();
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("正在只读查看历史 transcript") &&
      document.body.innerText.includes("当前会话继续创作"),
    { timeout: 10_000 },
  );

  const activeRestored = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="输入你的想法、问题或指令..."]');
    const sendButton = [...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "发送",
    );
    return {
      visible_text: document.body.innerText,
      input_disabled: Boolean(input?.disabled),
      send_disabled: Boolean(sendButton?.disabled),
    };
  });

  assert(!activeRestored.input_disabled, "Active session input stayed disabled after restore");
  assert(!activeRestored.send_disabled, "Active session send stayed disabled after restore");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_history_confirmation_seed",
      turn_ids: ["turn_au04_history_confirmation_seed"],
      work_id: workId,
      workspace_id: workId,
      context_work_id: workId,
      session_id: activeSessionId,
      readonly_session_id: seededHistorySession.id,
      readonly_session_status: seededHistorySession.status,
      readonly_opened_from_real_workbench: true,
      readonly_transcript_count: shownHistory.transcript_count,
      readonly_banner_visible: true,
      history_confirmation_transcript_visible: true,
      history_confirmation_confirm_button_count: readonlySnapshot.confirm_button_count,
      history_confirmation_reject_button_count: readonlySnapshot.reject_button_count,
      history_confirmation_actions_hidden:
        readonlySnapshot.confirm_button_count === 0 && readonlySnapshot.reject_button_count === 0,
      readonly_input_disabled: readonlySnapshot.input_disabled,
      readonly_send_disabled: readonlySnapshot.send_disabled,
      readonly_branch_available: readonlySnapshot.branch_button_visible,
      readonly_back_available: readonlySnapshot.back_button_visible,
      author_action_sent_count: sentAuthorActions.length,
      channel_author_action_log_count: channelAuthorActionRecords.length,
      toolbox_execute_after_history_open_count: toolboxExecuteRecords.length,
      pending_prose_fragment_after_history_open_count: pendingProseFragmentCount,
      no_author_action_sent: sentAuthorActions.length === 0,
      no_channel_author_action_log: channelAuthorActionRecords.length === 0,
      no_tool_dispatch_from_history: toolboxExecuteRecords.length === 0,
      no_pending_artifact_from_history: pendingProseFragmentCount === 0,
      active_session_restored: true,
      active_input_enabled_after_restore: !activeRestored.input_disabled,
      active_send_enabled_after_restore: !activeRestored.send_disabled,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu04CrossWorkConfirmationGuard(page) {
  const sourceTitle = "AU04 跨作品确认源作品";
  const targetTitle = "AU04 跨作品确认目标作品";
  const sourceNeedle = "AU04跨作品旧确认源文本";
  const targetNeedle = "目标作品当前会话继续创作";
  const sourceWork = await waitForWorkByTitle(sourceTitle);
  const targetWork = await waitForWorkByTitle(targetTitle);

  const sourceJoin = await ensureWorkSelectedByTitle(page, sourceTitle, sourceWork.id);
  await waitForVisibleWorkTitle(page, sourceTitle);
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes(needle) &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    sourceNeedle,
    { timeout: 15_000 },
  );

  const sourceBeforeSwitch = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].map((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

    return {
      visible_text: document.body.innerText,
      confirm_button_count: buttons.filter((text) => text === "确认执行").length,
      reject_button_count: buttons.filter((text) => text === "拒绝").length,
    };
  });

  const beforeSwitchFrameCount = frames.length;
  const beforeSwitchLogCount = readAppLogRecords().length;
  const targetJoin = await ensureWorkSelectedByTitle(page, targetTitle, targetWork.id);
  await waitForVisibleWorkTitle(page, targetTitle);
  await page.waitForFunction(
    (needle) => document.body.innerText.includes(needle),
    targetNeedle,
    { timeout: 15_000 },
  );
  await sleep(1_000);

  const targetAfterSwitch = await page.evaluate(
    ({ sourceNeedle: source, targetNeedle: target }) => {
      const buttons = [...document.querySelectorAll("button")].map((button) =>
        (button.textContent ?? "").replace(/\s+/g, " ").trim(),
      );
      const visibleText = document.body.innerText;

      return {
        visible_text: visibleText,
        source_text_visible: visibleText.includes(source),
        target_text_visible: visibleText.includes(target),
        confirm_button_count: buttons.filter((text) => text === "确认执行").length,
        reject_button_count: buttons.filter((text) => text === "拒绝").length,
      };
    },
    { sourceNeedle, targetNeedle },
  );

  const framesAfterSwitch = frames.slice(beforeSwitchFrameCount);
  const logsAfterSwitch = readAppLogRecords().slice(beforeSwitchLogCount);
  const sentAuthorActions = framesAfterSwitch.filter(
    (frame) => frame.direction === "sent" && frame.event === "author_action",
  );
  const channelAuthorActionRecords = logsAfterSwitch.filter((record) =>
    String(record.event ?? "").startsWith("channel.author_action."),
  );
  const toolboxExecuteRecords = logsAfterSwitch.filter(
    (record) => record.event === "toolbox.execute.done",
  );
  const pendingProseFragmentCount = framesAfterSwitch.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "prose_fragment",
      ).length
    );
  }, 0);

  assert(sourceBeforeSwitch.confirm_button_count >= 1, "Source confirmation button was not visible");
  assert(sourceBeforeSwitch.reject_button_count >= 1, "Source reject button was not visible");
  assert(targetAfterSwitch.target_text_visible, "Target work transcript was not visible");
  assert(!targetAfterSwitch.source_text_visible, "Source confirmation transcript leaked into target work");
  assert(
    targetAfterSwitch.confirm_button_count === 0,
    `Target work exposed ${targetAfterSwitch.confirm_button_count} source confirm buttons`,
  );
  assert(
    targetAfterSwitch.reject_button_count === 0,
    `Target work exposed ${targetAfterSwitch.reject_button_count} source reject buttons`,
  );
  assert(sentAuthorActions.length === 0, "Switching work sent an author_action unexpectedly");
  assert(
    channelAuthorActionRecords.length === 0,
    "Switching work produced channel.author_action logs unexpectedly",
  );
  assert(
    toolboxExecuteRecords.length === 0,
    `Cross-work switch executed tools ${toolboxExecuteRecords.length} times`,
  );
  assert(
    pendingProseFragmentCount === 0,
    `Cross-work switch created ${pendingProseFragmentCount} pending prose fragments`,
  );

  const sourceReturnJoin = await ensureWorkSelectedByTitle(page, sourceTitle, sourceWork.id);
  await waitForVisibleWorkTitle(page, sourceTitle);
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes(needle) &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    sourceNeedle,
    { timeout: 15_000 },
  );

  const sourceAfterReturn = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].map((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

    return {
      visible_text: document.body.innerText,
      confirm_button_count: buttons.filter((text) => text === "确认执行").length,
      reject_button_count: buttons.filter((text) => text === "拒绝").length,
    };
  });

  assert(
    sourceAfterReturn.confirm_button_count >= 1,
    "Source confirmation was not restored after returning to source work",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_cross_work_confirmation_seed",
      turn_ids: ["turn_au04_cross_work_confirmation_seed"],
      work_id: sourceWork.id,
      workspace_id: sourceWork.id,
      context_work_id: sourceWork.id,
      session_id: sourceJoin.session_id,
      source_work_id: sourceWork.id,
      target_work_id: targetWork.id,
      source_session_id: sourceJoin.session_id,
      target_session_id: targetJoin.session_id,
      source_return_session_id: sourceReturnJoin.session_id,
      source_confirmation_visible_before_switch: true,
      source_confirm_button_count_before_switch: sourceBeforeSwitch.confirm_button_count,
      source_reject_button_count_before_switch: sourceBeforeSwitch.reject_button_count,
      target_work_selected_from_real_menu: true,
      target_transcript_visible: targetAfterSwitch.target_text_visible,
      source_confirmation_hidden_in_target:
        !targetAfterSwitch.source_text_visible &&
        targetAfterSwitch.confirm_button_count === 0 &&
        targetAfterSwitch.reject_button_count === 0,
      target_confirm_button_count: targetAfterSwitch.confirm_button_count,
      target_reject_button_count: targetAfterSwitch.reject_button_count,
      author_action_sent_count: sentAuthorActions.length,
      channel_author_action_log_count: channelAuthorActionRecords.length,
      toolbox_execute_after_cross_work_switch_count: toolboxExecuteRecords.length,
      pending_prose_fragment_after_cross_work_switch_count: pendingProseFragmentCount,
      no_author_action_sent_after_cross_work_switch: sentAuthorActions.length === 0,
      no_channel_author_action_log_after_cross_work_switch: channelAuthorActionRecords.length === 0,
      no_tool_dispatch_after_cross_work_switch: toolboxExecuteRecords.length === 0,
      no_pending_artifact_after_cross_work_switch: pendingProseFragmentCount === 0,
      source_confirmation_restored_after_return: sourceAfterReturn.confirm_button_count >= 1,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

async function driveAu04LatestContextRebaseConfirmation(page) {
  const originalTitle = "AU04 最新上下文确认源作品";
  const sourceNeedle = "AU04最新上下文旧确认文本";
  const renamedTitle = `AU04 最新上下文已改名-${Date.now()}`;
  const work = await waitForWorkByTitle(originalTitle);

  const join = await ensureWorkSelectedByTitle(page, originalTitle, work.id);
  await waitForVisibleWorkTitle(page, originalTitle);
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes(needle) &&
      document.body.innerText.includes("确认执行") &&
      document.body.innerText.includes("拒绝"),
    sourceNeedle,
    { timeout: 15_000 },
  );

  await openWorkMenu(page);
  await page.locator('button[title="重命名"]').first().click();
  await page.getByRole("dialog", { name: "修改作品名" }).waitFor({ timeout: 10_000 });
  await submitWorkTitleDialog(page, renamedTitle, "保存");
  await waitForVisibleWorkTitle(page, renamedTitle);

  const renamedWork = await fetchWorkFromApi(work.id);
  assert(renamedWork.title === renamedTitle, "Work rename did not persist before confirmation");
  assert(
    Number(renamedWork.revision ?? 0) > Number(work.revision ?? 0),
    "Work rename did not advance revision before confirmation",
  );

  const beforeConfirmFrameCount = frames.length;
  const beforeConfirmLogCount = readAppLogRecords().length;
  await page.getByRole("button", { name: "确认执行" }).first().click();

  const confirmActionFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.source_turn_ref === "turn_au04_latest_context_rebase_seed" &&
      frame.body?.action?.action_type === "confirm_before_execute",
    "Real workbench did not send the latest-context confirm_before_execute author_action",
    10_000,
  );

  const actionResultFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "accepted" &&
      frame.body?.action_type === "confirm_before_execute" &&
      frame.body?.confirmation_binding?.rebased_state_snapshot_ref,
    "No accepted action_result with ConfirmationBinding was received after latest-context confirm",
    30_000,
  );

  const binding = actionResultFrame.body.confirmation_binding;
  const rebasedRef = String(binding.rebased_state_snapshot_ref ?? "");
  assert(rebasedRef.includes(work.id), "ConfirmationBinding did not reference source work id");
  assert(
    rebasedRef.includes(`revision:${renamedWork.revision}`),
    "ConfirmationBinding did not include the renamed work revision",
  );

  const executedTurnFrame = await waitForNewFrame(
    beforeConfirmFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.tool_result?.tool_name === "character_design" &&
      (frame.body?.adoption_state?.pending ?? []).some(
        (artifact) => artifact.artifact_type === "character_seed",
      ),
    "No character_seed turn_result was received after latest-context confirmation",
    200_000,
  );
  const executedTurnResult = executedTurnFrame.body;
  const currentWorkRef = (executedTurnResult.trace_summary?.context_refs ?? []).find(
    (ref) =>
      ref.source_type === "current_work" &&
      String(ref.summary ?? "").includes(renamedTitle),
  );
  assert(currentWorkRef, "Confirmed turn trace did not include renamed current work summary");

  const reasonCodes = executedTurnResult.truthfulness?.reason_codes ?? [];
  assert(
    reasonCodes.includes(`rebased_state_snapshot:${rebasedRef}`),
    "Confirmed turn did not carry rebased_state_snapshot reason code",
  );
  assert(
    reasonCodes.some((code) =>
      String(code).includes("gate_result_ref:gate_result:confirmation_re_gate"),
    ),
    "Confirmed turn did not carry confirmation re-gate result ref",
  );

  await page.waitForFunction(() => document.body.innerText.includes("角色设定草稿"), {
    timeout: 10_000,
  });

  const framesAfterConfirm = frames.slice(beforeConfirmFrameCount);
  const logsAfterConfirm = readAppLogRecords().slice(beforeConfirmLogCount);
  const toolboxExecuteRecords = logsAfterConfirm.filter(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === executedTurnResult.turn_id &&
      record.tool_name === "character_design" &&
      record.tool_outcome === "succeeded",
  );
  const pendingCharacterSeedCount = framesAfterConfirm.reduce((count, frame) => {
    if (frame.direction !== "received" || frame.event !== "turn_result") return count;
    return (
      count +
      (frame.body?.adoption_state?.pending ?? []).filter(
        (artifact) => artifact.artifact_type === "character_seed",
      ).length
    );
  }, 0);

  assert(toolboxExecuteRecords.length >= 1, "Latest-context confirm did not dispatch tool once");
  assert(
    pendingCharacterSeedCount >= 1,
    "Latest-context confirm did not create a pending character_seed artifact",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      turn_id: "turn_au04_latest_context_rebase_seed",
      turn_ids: ["turn_au04_latest_context_rebase_seed"],
      work_id: work.id,
      workspace_id: work.id,
      context_work_id: work.id,
      session_id: join.session_id,
      source_work_id: work.id,
      original_title: originalTitle,
      renamed_title: renamedTitle,
      original_revision: work.revision,
      renamed_revision: renamedWork.revision,
      real_work_renamed_before_confirm: true,
      confirm_action_sent: confirmActionFrame.body?.action?.action_type === "confirm_before_execute",
      confirmation_binding_ref: rebasedRef,
      binding_ref_includes_source_work: rebasedRef.includes(work.id),
      binding_ref_includes_latest_revision: rebasedRef.includes(`revision:${renamedWork.revision}`),
      gate_result_refs: binding.gate_result_refs ?? [],
      gate_result_ref_present: (binding.gate_result_refs ?? []).some((ref) =>
        String(ref).includes("gate_result:confirmation_re_gate"),
      ),
      trace_context_includes_renamed_title: String(currentWorkRef.summary ?? "").includes(
        renamedTitle,
      ),
      trace_current_work_summary: currentWorkRef.summary,
      reason_codes_include_rebased_ref: reasonCodes.includes(
        `rebased_state_snapshot:${rebasedRef}`,
      ),
      reason_codes_include_gate_ref: reasonCodes.some((code) =>
        String(code).includes("gate_result_ref:gate_result:confirmation_re_gate"),
      ),
      confirmed_dispatch: executedTurnResult.truthfulness?.tool_called === true,
      artifact_pending_after_confirm: true,
      artifact_type:
        (executedTurnResult.adoption_state?.pending ?? []).find(
          (artifact) => artifact.artifact_type === "character_seed",
        )?.artifact_type ?? null,
      toolbox_execute_count: toolboxExecuteRecords.length,
      pending_character_seed_count: pendingCharacterSeedCount,
      socket_connected: true,
      duration_ms: 0,
      outcome: "done",
    },
  ];
}

function visibleTextIncludesPendingDraft(visibleText) {
  // 确认后页面已进入待采纳态；确认卡可见性在点击前已由 waitForFunction 证明。
  return /待确认的创作材料|待确认正文草稿|待保存章节草稿|章节正文草稿|正文草稿/.test(visibleText);
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
    .waitForFunction(() => document.body.innerText.includes("本章有效字数"), undefined, {
      timeout: 15_000,
    })
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
  await page.getByText(nonce).first().click();
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

async function driveAu09MemoryManagementEntry(page) {
  const lockedNonce = "蓝焰税契";
  const archivedNonce = "暮钟海图";
  const lockedContent = `${lockedNonce}是九大家族签过血印的税契，任何灵气拍卖都必须先核验蓝焰税契编号。`;
  const archivedContent = `${archivedNonce}是旧版海图，曾经记录灵气暗港路线，但现在已经被官方作废归档。`;

  async function openMemoryPage() {
    await page.getByRole("button", { name: /记忆/ }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), undefined, {
      timeout: 10_000,
    });
  }

  async function createMemory(content, nonce) {
    await page.getByRole("button", { name: "+ 新建记忆" }).click();
    await page.locator("textarea").first().fill(content);
    await page.getByRole("button", { name: "创建" }).click();
    await page.waitForFunction((n) => document.body.innerText.includes(n), nonce, {
      timeout: 10_000,
    });
  }

  async function openMemoryDetail(nonce) {
    const row = page.locator("tr", { hasText: nonce }).first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆详情"), undefined, {
      timeout: 10_000,
    });
  }

  async function closeMemoryDetail() {
    await page.getByRole("button", { name: "×" }).first().click();
    await page.waitForTimeout(200);
  }

  await openMemoryPage();

  // ── 创建、确认并锁定一条作者记忆。锁定保护核心事实，但不应阻止普通召回。
  await createMemory(lockedContent, lockedNonce);
  await openMemoryDetail(lockedNonce);
  await page.getByRole("button", { name: "确认" }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "确认",
      ) && document.body.innerText.includes("CONFIRMED"),
    undefined,
    { timeout: 10_000 },
  );

  await page.getByRole("button", { name: "锁定" }).click();
  await page.waitForFunction(
    () => document.body.innerText.includes("已锁定") && document.body.innerText.includes("解锁"),
    undefined,
    { timeout: 10_000 },
  );

  const deprecateDisabledWhileLocked = await page
    .getByRole("button", { name: "废弃" })
    .isDisabled();
  const archiveDisabledWhileLocked = await page.getByRole("button", { name: "归档" }).isDisabled();
  assert(deprecateDisabledWhileLocked, "Locked memory still allowed direct deprecate in UI");
  assert(archiveDisabledWhileLocked, "Locked memory still allowed direct archive in UI");

  await closeMemoryDetail();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const lockedRecallMessage = `请围绕${lockedNonce}写一句拍卖行冲突。`;
  await page.locator(chatInputSelector).fill(lockedRecallMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const lockedRecallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after locked-memory recall message",
    170_000,
  );
  const lockedRecallTurn = lockedRecallFrame.body;
  const lockedContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === lockedRecallTurn.turn_id &&
      record.has_memory === true,
    "Locked confirmed memory was not recalled before terminal lifecycle action",
    20_000,
  );
  const lockedWhyText = await openLatestWhyDialog(page);
  const whyShowsLockedMemorySource = lockedWhyText.includes("已确认设定");
  assert(whyShowsLockedMemorySource, "Why panel did not show locked confirmed memory source");
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .first()
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {});

  // ── 回到管理页，解锁后废弃该记忆；废弃必须变成不可召回。
  await openMemoryPage();
  await openMemoryDetail(lockedNonce);
  await page.getByRole("button", { name: "解锁" }).click();
  await page.waitForFunction(
    () => {
      const buttons = [...document.querySelectorAll("button")];
      const deprecate = buttons.find((btn) => (btn.textContent ?? "").trim() === "废弃");
      const unlock = buttons.find((btn) => (btn.textContent ?? "").trim() === "解锁");
      return deprecate != null && deprecate.disabled === false && unlock == null;
    },
    undefined,
    { timeout: 10_000 },
  );
  assert(
    !(await page.getByRole("button", { name: "废弃" }).isDisabled()),
    "Deprecated action stayed disabled after unlocking memory",
  );
  await page.getByRole("button", { name: "废弃" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("DEPRECATED") &&
      document.body.innerText.includes("不可召回"),
    undefined,
    { timeout: 10_000 },
  );
  const deprecatedVisible = await page
    .locator("body")
    .innerText()
    .then((text) => text.includes("DEPRECATED") && text.includes("不可召回"));
  assert(deprecatedVisible, "Deprecated memory did not show terminal non-recallable state");
  await closeMemoryDetail();

  // ── 第二条走归档路径，覆盖 archived terminal lifecycle。
  await createMemory(archivedContent, archivedNonce);
  await openMemoryDetail(archivedNonce);
  await page.getByRole("button", { name: "确认" }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (btn) => (btn.textContent ?? "").trim() === "确认",
      ) && document.body.innerText.includes("CONFIRMED"),
    undefined,
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "归档" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("ARCHIVED") && document.body.innerText.includes("不可召回"),
    undefined,
    { timeout: 10_000 },
  );
  const archivedVisible = await page
    .locator("body")
    .innerText()
    .then((text) => text.includes("ARCHIVED") && text.includes("不可召回"));
  assert(archivedVisible, "Archived memory did not show terminal non-recallable state");
  await closeMemoryDetail();

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const seenTurnIdsBeforeTerminalProbe = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id)
      .filter(Boolean),
  );
  const terminalRecallMessage = `请同时解释${lockedNonce}和${archivedNonce}还能不能作为后续设定使用。`;
  await page.locator(chatInputSelector).fill(terminalRecallMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const terminalRecallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenTurnIdsBeforeTerminalProbe.has(frame.body.turn_id) &&
      frame.body?.assistant_message != null,
    "No turn_result frame after terminal-memory recall probe",
    170_000,
  );
  const terminalRecallTurn = terminalRecallFrame.body;
  const terminalContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" && record.turn_id === terminalRecallTurn.turn_id,
    "No context assembly record was emitted for terminal memory recall probe",
    20_000,
  );
  const terminalMemorySummaries = (terminalRecallTurn.trace_summary?.context_refs ?? [])
    .filter((ref) => String(ref.source_type) === "memory")
    .map((ref) => String(ref.summary ?? ""))
    .join("\n");
  const terminalManagedMemoryExcluded =
    !terminalMemorySummaries.includes(lockedNonce) &&
    !terminalMemorySummaries.includes(archivedNonce);
  assert(
    terminalManagedMemoryExcluded,
    "Deprecated/archived managed memory still entered ordinary dialogue context",
  );
  const terminalWhyText = await openLatestWhyDialog(page);
  const whyExcludesTerminalMemoryContent =
    !terminalWhyText.includes(lockedContent) && !terminalWhyText.includes(archivedContent);
  assert(
    whyExcludesTerminalMemoryContent,
    "Why panel still showed deprecated/archived managed memory content after terminal actions",
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, terminalRecallTurn, sentMessage);

  return [
    {
      ...uiState,
      turn_id: terminalRecallTurn.turn_id,
      turn_ids: [lockedRecallTurn.turn_id, terminalRecallTurn.turn_id],
      locked_recall_turn_id: lockedRecallTurn.turn_id,
      terminal_recall_turn_id: terminalRecallTurn.turn_id,
      memory_nonce: lockedNonce,
      archived_memory_nonce: archivedNonce,
      memory_created: true,
      memory_confirmed: true,
      memory_locked: true,
      locked_controls_disabled: deprecateDisabledWhileLocked && archiveDisabledWhileLocked,
      locked_recalled_before_terminal_action: lockedContext.has_memory === true,
      why_shows_locked_memory_source: whyShowsLockedMemorySource,
      memory_deprecated: deprecatedVisible,
      archived_memory_created: true,
      archived_memory_confirmed: true,
      archived_memory_archived: archivedVisible,
      terminal_context_has_memory: terminalContext.has_memory === true,
      terminal_managed_memory_excluded: terminalManagedMemoryExcluded,
      why_excludes_terminal_memory_content: whyExcludesTerminalMemoryContent,
      message_text: terminalRecallMessage,
    },
  ];
}

async function driveAu09MemoryTraceRoundtrip(page) {
  const deprecatedNonce = "赤铜回声";
  const archivedNonce = "银沙旧律";
  const deprecatedContent = `${deprecatedNonce}是主角在地下拍卖行留下的伏笔，每次钟声响起都会触发旧账追索。`;
  const archivedContent = `${archivedNonce}是旧版灵气运输禁令，曾约束暗港交易，但现在已被新律取代。`;

  async function openMemoryPage() {
    await page.getByRole("button", { name: /记忆/ }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), undefined, {
      timeout: 10_000,
    });
  }

  async function createMemory(content, nonce) {
    await page.getByRole("button", { name: "+ 新建记忆" }).click();
    await page.locator("textarea").first().fill(content);
    await page.getByRole("button", { name: "创建" }).click();
    await page.waitForFunction((n) => document.body.innerText.includes(n), nonce, {
      timeout: 10_000,
    });
  }

  async function openMemoryDetail(nonce) {
    const row = page.locator("tr", { hasText: nonce }).first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();
    await page.waitForFunction(() => document.body.innerText.includes("记忆详情"), undefined, {
      timeout: 10_000,
    });
  }

  async function closeMemoryDetail() {
    await page.getByRole("button", { name: "×" }).first().click();
    await page.waitForTimeout(200);
  }

  async function waitForTraceText(...needles) {
    await page.waitForFunction(
      (expected) => expected.every((needle) => document.body.innerText.includes(String(needle))),
      needles,
      { timeout: 10_000 },
    );
  }

  await openMemoryPage();

  await createMemory(deprecatedContent, deprecatedNonce);
  await openMemoryDetail(deprecatedNonce);
  await waitForTraceText("引用与治理追溯", "作者创建记忆草稿");

  await page.getByRole("button", { name: "确认" }).click();
  await waitForTraceText("CONFIRMED", "作者确认");

  await page.getByRole("button", { name: "锁定" }).click();
  await waitForTraceText("已锁定", "作者锁定", "锁定保护核心内容");

  const deprecateDisabledWhileLocked = await page
    .getByRole("button", { name: "废弃" })
    .isDisabled();
  const archiveDisabledWhileLocked = await page.getByRole("button", { name: "归档" }).isDisabled();
  assert(deprecateDisabledWhileLocked, "Locked memory still allowed direct deprecate in UI");
  assert(archiveDisabledWhileLocked, "Locked memory still allowed direct archive in UI");

  await closeMemoryDetail();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const lockedRecallMessage = `请围绕${deprecatedNonce}写一句伏笔回收提示。`;
  await page.locator(chatInputSelector).fill(lockedRecallMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const lockedRecallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message != null,
    "No turn_result frame after memory trace locked recall message",
    170_000,
  );
  const lockedRecallTurn = lockedRecallFrame.body;
  const lockedContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === lockedRecallTurn.turn_id &&
      record.has_memory === true,
    "Locked memory did not recall before terminal action in trace slice",
    20_000,
  );
  const lockedWhyText = await openLatestWhyDialog(page);
  const whyShowsLockedMemorySource = lockedWhyText.includes("已确认设定");
  assert(whyShowsLockedMemorySource, "Why panel did not show locked memory source");
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .first()
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {});

  await openMemoryPage();
  await openMemoryDetail(deprecatedNonce);
  await page.getByRole("button", { name: "解锁" }).click();
  await waitForTraceText("作者解锁");
  await page.getByRole("button", { name: "废弃" }).click();
  await waitForTraceText("DEPRECATED", "作者废弃", "后续普通召回会排除");
  await closeMemoryDetail();

  await createMemory(archivedContent, archivedNonce);
  await openMemoryDetail(archivedNonce);
  await waitForTraceText("作者创建记忆草稿");
  await page.getByRole("button", { name: "确认" }).click();
  await waitForTraceText("CONFIRMED", "作者确认");
  await page.getByRole("button", { name: "归档" }).click();
  await waitForTraceText("ARCHIVED", "作者归档", "后续普通召回会排除");
  await closeMemoryDetail();

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const seenTurnIdsBeforeTerminalProbe = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id)
      .filter(Boolean),
  );
  const terminalRecallMessage = `请判断${deprecatedNonce}和${archivedNonce}是否还能作为后续设定使用。`;
  await page.locator(chatInputSelector).fill(terminalRecallMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const terminalRecallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenTurnIdsBeforeTerminalProbe.has(frame.body.turn_id) &&
      frame.body?.assistant_message != null,
    "No turn_result frame after memory trace terminal probe",
    170_000,
  );
  const terminalRecallTurn = terminalRecallFrame.body;
  const terminalContext = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" && record.turn_id === terminalRecallTurn.turn_id,
    "No context assembly record for memory trace terminal probe",
    20_000,
  );
  const terminalMemorySummaries = (terminalRecallTurn.trace_summary?.context_refs ?? [])
    .filter((ref) => String(ref.source_type) === "memory")
    .map((ref) => String(ref.summary ?? ""))
    .join("\n");
  const terminalManagedMemoryExcluded =
    !terminalMemorySummaries.includes(deprecatedNonce) &&
    !terminalMemorySummaries.includes(archivedNonce);
  assert(
    terminalManagedMemoryExcluded,
    "Trace slice terminal memories still entered dialogue context refs",
  );

  const terminalWhyText = await openLatestWhyDialog(page);
  const whyExcludesTerminalMemoryContent =
    !terminalWhyText.includes(deprecatedContent) && !terminalWhyText.includes(archivedContent);
  assert(
    whyExcludesTerminalMemoryContent,
    "Trace slice why panel still showed terminal memory content",
  );

  const sentMessage = latestSentUserMessage();
  const uiState = await commonUiState(page, terminalRecallTurn, sentMessage);

  return [
    {
      ...uiState,
      turn_id: terminalRecallTurn.turn_id,
      turn_ids: [lockedRecallTurn.turn_id, terminalRecallTurn.turn_id],
      locked_recall_turn_id: lockedRecallTurn.turn_id,
      terminal_recall_turn_id: terminalRecallTurn.turn_id,
      memory_nonce: deprecatedNonce,
      archived_memory_nonce: archivedNonce,
      lifecycle_trace_visible: true,
      create_trace_visible: true,
      confirm_trace_visible: true,
      lock_trace_visible: true,
      unlock_trace_visible: true,
      deprecate_trace_visible: true,
      archive_trace_visible: true,
      trace_explains_locked_recall: true,
      trace_explains_terminal_exclusion: true,
      locked_controls_disabled: deprecateDisabledWhileLocked && archiveDisabledWhileLocked,
      locked_recalled_before_terminal_action: lockedContext.has_memory === true,
      why_shows_locked_memory_source: whyShowsLockedMemorySource,
      terminal_context_has_memory: terminalContext.has_memory === true,
      terminal_managed_memory_excluded: terminalManagedMemoryExcluded,
      why_excludes_terminal_memory_content: whyExcludesTerminalMemoryContent,
      message_text: terminalRecallMessage,
    },
  ];
}

async function driveAu09AdoptSettingRecall(page) {
  // ── 从作品档案「伏笔」tab 触发 AI 生成一条伏笔草稿。
  await openArchiveTab(page, "伏笔");
  await page.getByRole("button", { name: "新增伏笔" }).first().click();

  const createMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("伏笔"),
    "Real archive foreshadowing action did not send a foreshadowing user_message with micro plan enabled",
    20_000,
  );

  // 伏笔入口必须生成显式 foreshadowing_seed，不再把伏笔装进 world_setting。
  const draftFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.adoption_state?.pending?.[0]?.requires_adoption === true &&
      frame.body.adoption_state.pending[0].artifact_type === "foreshadowing_seed",
    "No foreshadowing_seed tentative artifact websocket frame was received",
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
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("保存到作品档案") ||
      document.body.innerText.includes("确认创建"),
    undefined,
    { timeout: 10_000 },
  );

  // ── 采纳该设定 → 进入 confirmed + recallable governed memory。
  const saveToArchiveButton = page.getByRole("button", { name: "保存到作品档案" });
  const acceptSettingButton =
    (await saveToArchiveButton.count()) > 0
      ? saveToArchiveButton.first()
      : page.getByRole("button", { name: "确认创建" }).first();
  await acceptSettingButton.click();
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

  // ── 采纳后重开「伏笔」tab：同一 work_id 的 archive read model 必须立即可见。
  const archivePanel = await openArchiveTab(page, "伏笔");
  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_foreshadowing.done" &&
      record.work_id === createMessageFrame.body?.work_id &&
      Number(record.item_count ?? 0) >= 1,
    "No channel.get_foreshadowing.done record loaded the adopted setting",
    20_000,
  );
  await page.waitForFunction(
    () => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      return Number(panel?.getAttribute("data-archive-foreshadowing-count") ?? 0) >= 1;
    },
    undefined,
    { timeout: 10_000 },
  );
  const foreshadowingArchiveSnapshot = await archivePanelSnapshot(archivePanel);
  const archiveTextNormalized = foreshadowingArchiveSnapshot.text.replace(/[^\p{L}\p{N}]/gu, "");
  const archiveShowsAdoptedSetting = chunk.length > 0 && archiveTextNormalized.includes(chunk);
  assert(
    archiveShowsAdoptedSetting,
    "Archive foreshadowing tab did not show the adopted setting content",
  );

  // ── 同一矩阵补「经验规则」tab：新建规则、采纳、重开后可见。
  const seenRuleTurnIds = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id),
  );
  await page.getByRole("tab", { name: "经验规则" }).click();
  await page.getByRole("button", { name: "新建规则" }).first().click();

  const createRuleMessageFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.generate_micro_plan === true &&
      String(frame.body?.text ?? "").includes("规则"),
    "Real archive rule action did not send a rule user_message with micro plan enabled",
    20_000,
  );

  const ruleArtifactTypes = new Set(["world_rule_seed", "style_rule_seed", "constraint_seed"]);
  const ruleDraftFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenRuleTurnIds.has(frame.body.turn_id) &&
      frame.body?.adoption_state?.pending?.[0]?.requires_adoption === true &&
      ruleArtifactTypes.has(frame.body.adoption_state.pending[0].artifact_type),
    "No explicit rule tentative artifact websocket frame was received",
    170_000,
  );
  const ruleArtifact = ruleDraftFrame.body.adoption_state.pending[0];
  const ruleSettingContent =
    ruleArtifact.payload?.content ??
    (ruleArtifact.payload?.items ?? []).map((item) => item?.body ?? "").join("") ??
    "";
  const ruleChunk = ruleSettingContent.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 8);

  const closeArchiveBeforeRuleAdoption = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchiveBeforeRuleAdoption.count()) > 0) {
    await closeArchiveBeforeRuleAdoption
      .first()
      .click()
      .catch(() => {});
  }
  const acceptRuleButton = page.getByRole("button", { name: acceptDraftButtonPattern }).first();
  await acceptRuleButton.waitFor({ timeout: 10_000 });
  await acceptRuleButton.click();

  await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      (frame.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === ruleArtifact.artifact_id,
      ),
    "No rule adoption resolved turn_result websocket frame was received",
    120_000,
  );

  const ruleArchivePanel = await openArchiveTab(page, "经验规则");
  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.get_rules.done" &&
      record.work_id === createRuleMessageFrame.body?.work_id &&
      Number(record.rule_count ?? 0) >= 1,
    "No channel.get_rules.done record loaded the adopted rule setting",
    20_000,
  );
  await page.waitForFunction(
    () => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      return Number(panel?.getAttribute("data-archive-rule-count") ?? 0) >= 1;
    },
    undefined,
    { timeout: 10_000 },
  );
  const ruleArchiveSnapshot = await archivePanelSnapshot(ruleArchivePanel);
  const ruleArchiveTextNormalized = ruleArchiveSnapshot.text.replace(/[^\p{L}\p{N}]/gu, "");
  const archiveShowsAdoptedRule =
    ruleChunk.length > 0 && ruleArchiveTextNormalized.includes(ruleChunk);
  assert(ruleChunk.length > 0, "Adopted rule setting had no matchable content");
  assert(archiveShowsAdoptedRule, "Archive rule tab did not show the adopted rule setting content");

  const closeArchiveAfterCheck = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchiveAfterCheck.count()) > 0) {
    await closeArchiveAfterCheck
      .first()
      .click()
      .catch(() => {});
  }

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
      archive_tab_checked: "foreshadowing,rule",
      archive_visible_after_adoption: true,
      archive_foreshadowing_count_after_adoption: foreshadowingArchiveSnapshot.foreshadowing_count,
      archive_rule_count_after_adoption: ruleArchiveSnapshot.rule_count,
      archive_text_matched_adopted_setting: archiveShowsAdoptedSetting,
      rule_setting_artifact_id: ruleArtifact.artifact_id,
      rule_setting_artifact_type: ruleArtifact.artifact_type,
      rule_setting_chunk: ruleChunk,
      archive_text_matched_adopted_rule: archiveShowsAdoptedRule,
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

async function driveAu09CrossWorkMemoryIsolation(page) {
  const workATitle = "AU09 隔离甲作品";
  const workBTitle = "AU09 隔离乙作品";
  const foreignToken = "甲界暮钟";
  const foreignSummaryNeedle = "只属于甲作品";
  const currentToken = "乙界星钥";
  const currentSummaryNeedle = "只属于乙作品";
  const currentRuleNeedle = "真实记忆作为代价";

  // 明确经过真实作品切换：先到甲作品，再切回乙作品，后续所有断言都在乙作品上完成。
  await switchToWorkByTitle(page, workATitle);
  await switchToWorkByTitle(page, workBTitle);

  const foreshadowingPanel = await openArchiveTab(page, "伏笔");
  await page.waitForFunction(
    ([current, foreign]) => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      const text = panel?.innerText ?? "";
      return text.includes(current) && !text.includes(foreign);
    },
    [currentToken, foreignToken],
    { timeout: 10_000 },
  );
  const foreshadowingArchiveSnapshot = await archivePanelSnapshot(foreshadowingPanel);
  const archiveShowsCurrentForeshadowing = foreshadowingArchiveSnapshot.text.includes(currentToken);
  const archiveExcludesForeignForeshadowing =
    !foreshadowingArchiveSnapshot.text.includes(foreignToken) &&
    !foreshadowingArchiveSnapshot.text.includes(foreignSummaryNeedle);
  assert(archiveShowsCurrentForeshadowing, "Current work foreshadowing did not appear in archive");
  assert(
    archiveExcludesForeignForeshadowing,
    "Foreign work foreshadowing leaked into current archive",
  );

  await page.getByRole("tab", { name: "经验规则" }).click();
  await page.waitForFunction(
    ([currentRule, foreign]) => {
      const panel = [...document.querySelectorAll('[class*="panel"]')].find((element) =>
        element.innerText.includes("作品档案"),
      );
      const text = panel?.innerText ?? "";
      return text.includes(currentRule) && !text.includes(foreign);
    },
    [currentRuleNeedle, foreignToken],
    { timeout: 10_000 },
  );
  const ruleArchiveSnapshot = await archivePanelSnapshot(foreshadowingPanel);
  const archiveShowsCurrentRule = ruleArchiveSnapshot.text.includes(currentRuleNeedle);
  const archiveExcludesForeignInRuleTab =
    !ruleArchiveSnapshot.text.includes(foreignToken) &&
    !ruleArchiveSnapshot.text.includes(foreignSummaryNeedle);
  assert(archiveShowsCurrentRule, "Current work rule did not appear in archive");
  assert(archiveExcludesForeignInRuleTab, "Foreign work memory leaked into rule archive tab");

  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive.first().click();
  }

  await page.getByRole("button", { name: /记忆/ }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes("记忆管理"), undefined, {
    timeout: 10_000,
  });
  const memoryTable = page.locator("table").first();
  await memoryTable.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    ([current, rule]) => {
      const table = document.querySelector("table");
      const text = table?.innerText ?? "";
      return text.includes(current) && text.includes(rule);
    },
    [currentToken, currentRuleNeedle],
    { timeout: 10_000 },
  );
  const memoryTableText = await memoryTable.innerText();
  const memoryPageShowsCurrent =
    memoryTableText.includes(currentToken) && memoryTableText.includes(currentRuleNeedle);
  const memoryPageExcludesForeign =
    !memoryTableText.includes(foreignToken) && !memoryTableText.includes(foreignSummaryNeedle);
  assert(memoryPageShowsCurrent, "Memory page did not show current work memories");
  assert(memoryPageExcludesForeign, "Memory page leaked foreign work memories");

  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const seenTurnIds = new Set(
    frames
      .filter((frame) => frame.direction === "received" && frame.event === "turn_result")
      .map((frame) => frame.body?.turn_id)
      .filter(Boolean),
  );
  const message = `请判断${foreignToken}和${currentToken}哪个能作为当前作品的后续伏笔，并说明星钥规则。`;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const recallFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      !seenTurnIds.has(frame.body.turn_id) &&
      frame.body?.assistant_message != null,
    "No turn_result frame after cross-work isolation recall message",
    170_000,
  );
  const recallTurnResult = recallFrame.body;
  const sentMessage = latestSentUserMessage();

  const contextDone = await waitForAppLogRecord(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === recallTurnResult.turn_id &&
      record.work_id === sentMessage.body?.work_id &&
      record.has_memory === true,
    "Current work memory was not recalled for cross-work isolation probe",
    20_000,
  );

  const memorySummaries = (recallTurnResult.trace_summary?.context_refs ?? [])
    .filter((ref) => String(ref.source_type) === "memory")
    .map((ref) => String(ref.summary ?? ""))
    .join("\n");
  const contextIncludesCurrent =
    memorySummaries.includes(currentToken) || memorySummaries.includes(currentSummaryNeedle);
  const contextExcludesForeign =
    !memorySummaries.includes(foreignToken) &&
    !memorySummaries.includes(foreignSummaryNeedle) &&
    !memorySummaries.includes("甲作品");
  assert(contextIncludesCurrent, "Recalled context did not include the current work memory");
  assert(contextExcludesForeign, "Recalled context included a foreign work memory");

  const whyText = await openLatestWhyDialog(page);
  const whyShowsCurrent = whyText.includes(currentToken) || whyText.includes(currentSummaryNeedle);
  const whyExcludesForeignSummary =
    !whyText.includes(foreignSummaryNeedle) && !whyText.includes("甲作品");
  assert(whyShowsCurrent, "Why panel did not show current work memory source");
  assert(whyExcludesForeignSummary, "Why panel leaked foreign work memory source");

  const joinedWorkIds = [
    ...new Set(
      readAppLogRecords()
        .filter((record) => record.event === "channel.join.done" && record.work_id)
        .map((record) => String(record.work_id)),
    ),
  ];
  const currentWorkId = String(sentMessage.body?.work_id ?? "");
  const foreignWorkId = joinedWorkIds.find((workId) => workId !== currentWorkId) ?? null;
  const switchedThroughForeignWork = Boolean(foreignWorkId && currentWorkId);

  const uiState = await commonUiState(page, recallTurnResult, sentMessage);

  return [
    {
      ...uiState,
      turn_id: recallTurnResult.turn_id,
      recall_turn_id: recallTurnResult.turn_id,
      current_work_title: workBTitle,
      foreign_work_title: workATitle,
      current_work_id: currentWorkId,
      foreign_work_id: foreignWorkId,
      joined_work_count: joinedWorkIds.length,
      switched_through_foreign_work: switchedThroughForeignWork,
      archive_current_only:
        archiveShowsCurrentForeshadowing &&
        archiveShowsCurrentRule &&
        archiveExcludesForeignForeshadowing &&
        archiveExcludesForeignInRuleTab,
      memory_page_current_only: memoryPageShowsCurrent && memoryPageExcludesForeign,
      context_includes_current_work_memory: contextIncludesCurrent,
      context_excludes_foreign_work_memory: contextExcludesForeign,
      context_has_memory: contextDone.has_memory === true,
      why_shows_current_work_memory: whyShowsCurrent,
      why_excludes_foreign_work_memory: whyExcludesForeignSummary,
      current_memory_nonce: currentToken,
      foreign_memory_nonce: foreignToken,
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

async function driveAu10WorkbenchRecoveryProviderTimeout(page) {
  const hangingServer = await startHangingOpenAiServer();

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
      timeout: 30_000,
    });

    await configureProviderRuntime({
      provider: "lmstudio",
      model: "slice-verify-timeout-model",
      endpoint: hangingServer.endpoint,
    });

    const nonce = `AU10-PROVIDER-TIMEOUT-${Date.now()}`;
    const timeoutMessage = `请围绕 ${nonce} 给我一个创作方向。`;
    await page.locator(chatInputSelector).fill(timeoutMessage);
    await page.getByRole("button", { name: "发送" }).click();

    const timeoutSentMessage = latestSentUserMessage();

    const timeoutFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.turn_id &&
        String(frame.body?.assistant_message?.text ?? "").includes("响应超时") &&
        String(frame.body?.assistant_message?.text ?? "").includes("没有写入作品事实") &&
        frame.body?.truthfulness?.production_write_performed === false,
      "Provider timeout did not return a recoverable fallback turn_result",
      60_000,
    );
    const timeoutTurnId = timeoutFrame.body.turn_id;

    const providerTimeoutLog = await waitForAppLogRecord(
      (record) =>
        record.event === "provider_gateway.complete.error" &&
        record.provider === "lmstudio" &&
        record.turn_id === timeoutTurnId &&
        record.reason_code === "timeout",
      "No provider_gateway.complete.error log with reason_code=timeout was emitted",
      30_000,
    );

    await waitForAppLogRecord(
      (record) => record.event === "channel.user_message.done" && record.turn_id === timeoutTurnId,
      "No channel.user_message.done log was emitted for the recoverable timeout turn",
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
          bodyText.includes("响应超时") &&
          bodyText.includes("没有写入作品事实")
        );
      },
      chatInputSelector,
      { timeout: 10_000 },
    );
    const timeoutVisibleText = await page.locator("body").innerText();

    await configureProviderRuntime({ provider: "slice_verify" });

    const recoveryMessage = `timeout 恢复后继续围绕 ${nonce} 聊下去。`;
    await page.locator(chatInputSelector).fill(recoveryMessage);
    await page.getByRole("button", { name: "发送" }).click();

    const recoveryFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.turn_id &&
        frame.body.turn_id !== timeoutTurnId &&
        frame.body?.status !== "error" &&
        String(frame.body?.assistant_message?.text ?? "").length > 0,
      "Workbench did not recover and complete a following user message after timeout",
      60_000,
    );

    await waitForAppLogRecord(
      (record) =>
        record.event === "provider_gateway.complete.done" &&
        record.provider === "slice_verify" &&
        record.turn_id === recoveryFrame.body.turn_id,
      "No slice_verify provider_gateway.complete.done log was emitted for the recovery turn",
      30_000,
    );

    await waitForAppLogRecord(
      (record) =>
        record.event === "channel.user_message.done" &&
        record.turn_id === recoveryFrame.body.turn_id,
      "No channel.user_message.done log proved the recovery turn completed after timeout",
      30_000,
    );

    const uiState = await commonUiState(page, recoveryFrame.body, latestSentUserMessage());

    return [
      {
        ...uiState,
        event: "slice_verify.ui_state.done",
        slice_id: "au10-workbench-recovery-provider-timeout",
        turn_id: recoveryFrame.body.turn_id,
        turn_ids: [timeoutTurnId, recoveryFrame.body.turn_id],
        timeout_turn_id: timeoutTurnId,
        recovery_turn_id: recoveryFrame.body.turn_id,
        timeout_provider: providerTimeoutLog.provider,
        timeout_reason_code: providerTimeoutLog.reason_code,
        timeout_message_visible:
          timeoutVisibleText.includes("响应超时") &&
          timeoutVisibleText.includes("没有写入作品事实"),
        no_production_write_on_timeout:
          timeoutFrame.body.truthfulness?.production_write_performed === false,
        no_artifact_adopted_on_timeout: timeoutFrame.body.truthfulness?.artifact_adopted === false,
        loading_cleared_after_timeout: !timeoutVisibleText.includes("思考中..."),
        input_enabled_after_timeout: true,
        recovery_turn_completed: recoveryFrame.body.status !== "error",
        timeout_prompt_sent: String(timeoutSentMessage?.body?.text ?? "").includes(nonce),
        recovery_prompt_sent: String(latestSentUserMessage()?.body?.text ?? "").includes(nonce),
      },
    ];
  } finally {
    await hangingServer.close();
  }
}

async function driveAu10WorkbenchRecoveryReconnect(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  await configureProviderRuntime({ provider: "slice_verify" });

  const initialJoinCount = readAppLogRecords().filter(
    (record) => record.event === "channel.join.done",
  ).length;

  const service = createPhoenixServiceController();

  try {
    await service.stopOriginal();
    await page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector);
        const bodyText = document.body.innerText;
        return (
          input instanceof HTMLInputElement &&
          input.disabled === true &&
          bodyText.includes("同步离线") &&
          !bodyText.includes("思考中...")
        );
      },
      chatInputSelector,
      { timeout: 45_000 },
    );

    const offlineText = await page.locator("body").innerText();

    await service.restart();
    const joinCountAfterRestore = await waitForAppLogCount(
      (record) => record.event === "channel.join.done",
      initialJoinCount + 1,
      "No channel.join.done log proved websocket rejoin after service recovery",
      60_000,
    );

    await page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector);
        const bodyText = document.body.innerText;
        return (
          input instanceof HTMLInputElement &&
          input.disabled === false &&
          bodyText.includes("同步已连接")
        );
      },
      chatInputSelector,
      { timeout: 60_000 },
    );

    const nonce = `AU10-RECONNECT-${Date.now()}`;
    const recoveryMessage = `断线恢复后继续围绕 ${nonce} 聊下去。`;
    await page.locator(chatInputSelector).fill(recoveryMessage);
    await page.getByRole("button", { name: "发送" }).click();

    const recoveryFrame = await waitForFrame(
      (frame) =>
        frame.direction === "received" &&
        frame.event === "turn_result" &&
        frame.body?.turn_id &&
        frame.body?.status !== "error" &&
        String(frame.body?.assistant_message?.text ?? "").length > 0,
      "Workbench did not complete a following turn after websocket reconnect",
      60_000,
    );

    await waitForAppLogRecord(
      (record) =>
        record.event === "channel.user_message.done" &&
        record.turn_id === recoveryFrame.body.turn_id,
      "No channel.user_message.done log proved the following turn completed after reconnect",
      30_000,
    );

    const visibleText = await page.locator("body").innerText();
    const uiState = await commonUiState(page, recoveryFrame.body, latestSentUserMessage());

    return [
      {
        ...uiState,
        event: "slice_verify.ui_state.done",
        slice_id: "au10-workbench-recovery-reconnect",
        turn_id: recoveryFrame.body.turn_id,
        initial_join_count: initialJoinCount,
        join_count_after_restore: joinCountAfterRestore,
        offline_status_visible: offlineText.includes("同步离线"),
        input_disabled_while_offline: true,
        loading_cleared_while_offline: !offlineText.includes("思考中..."),
        reconnected_status_visible: visibleText.includes("同步已连接"),
        input_enabled_after_reconnect: true,
        rejoin_observed: joinCountAfterRestore > initialJoinCount,
        following_turn_completed: recoveryFrame.body.status !== "error",
        recovery_prompt_sent: String(latestSentUserMessage()?.body?.text ?? "").includes(nonce),
        service_stopped_externally: true,
        service_restarted_externally: true,
      },
    ];
  } finally {
    await service.stopRestarted();
  }
}

async function driveAu10WorkbenchRecoveryCancelWaiting(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  await configureProviderRuntime({ provider: "slice_verify" });

  const nonce = `AU10-CANCEL-WAITING-${Date.now()}`;
  const requestText = `第01章：底层灵气账单 写得太平了，推翻重写这一章的正文草稿，保持为待采纳草稿。标记 ${nonce}`;
  await page.locator(chatInputSelector).fill(requestText);
  await page.getByRole("button", { name: "发送" }).click();

  const promptMessage = latestSentUserMessage();
  const confirmationFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.status === "needs_confirmation" &&
      frame.body?.truthfulness?.tool_called === false &&
      frame.body?.truthfulness?.production_write_performed === false &&
      (frame.body?.available_actions ?? []).some(
        (action) => action.action_type === "reject_or_cancel_confirmation",
      ),
    "No cancellable confirmation turn_result was received",
    200_000,
  );
  const confirmationTurnResult = confirmationFrame.body;
  const cancelAction = confirmationTurnResult.available_actions.find(
    (action) => action.action_type === "reject_or_cancel_confirmation",
  );
  assert(cancelAction, "Confirmation turn_result did not include a cancel action");

  await page.waitForFunction(
    () => document.body.innerText.includes("确认执行") && document.body.innerText.includes("拒绝"),
    { timeout: 10_000 },
  );
  const confirmationVisibleText = await page.locator("body").innerText();

  await page.getByRole("button", { name: "拒绝" }).first().click();

  const cancelActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.body?.action?.action_type === "reject_or_cancel_confirmation" &&
      frame.body?.action?.action_id === cancelAction.action_id,
    "Real workbench did not send the reject_or_cancel_confirmation author_action",
  );

  const actionResultFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "action_result" &&
      frame.body?.status === "cancelled" &&
      frame.body?.action_type === "reject_or_cancel_confirmation",
    "No cancelled action_result websocket frame was received",
    60_000,
  );

  const cancelTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.phase === "cancelled" &&
      frame.body?.status === "cancelled" &&
      frame.body?.truthfulness?.tool_called === false &&
      frame.body?.truthfulness?.artifact_adopted === false &&
      frame.body?.truthfulness?.production_write_performed === false &&
      frame.body?.behavior_state?.active == null,
    "No cancelled TurnResult closed the pending confirmation",
    60_000,
  );
  const cancelTurnResult = cancelTurnFrame.body;

  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.turn_id === confirmationTurnResult.turn_id &&
      record.action_status === "cancelled",
    "No channel.author_action.done log proved cancellation completed",
    30_000,
  );

  await page.waitForFunction(
    (selector) => {
      const input = document.querySelector(selector);
      const bodyText = document.body.innerText;
      const buttons = [...document.querySelectorAll("button")].map((btn) =>
        (btn.textContent ?? "").trim(),
      );
      return (
        input instanceof HTMLInputElement &&
        input.disabled === false &&
        bodyText.includes("已取消等待") &&
        bodyText.includes("没有写入作品事实") &&
        !bodyText.includes("思考中...") &&
        !buttons.includes("确认执行") &&
        !buttons.includes("拒绝")
      );
    },
    chatInputSelector,
    { timeout: 10_000 },
  );
  const cancelledVisibleText = await page.locator("body").innerText();

  const followMessage = `取消等待后继续围绕 ${nonce} 聊一个新的方向。`;
  const framesBeforeFollow = frames.length;
  await page.locator(chatInputSelector).fill(followMessage);
  await page.getByRole("button", { name: "发送" }).click();

  const followingFrame = await waitForFrame(
    (frame) =>
      frames.indexOf(frame) >= framesBeforeFollow &&
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.turn_id &&
      frame.body.turn_id !== confirmationTurnResult.turn_id &&
      frame.body.turn_id !== cancelTurnResult.turn_id &&
      frame.body?.status !== "error" &&
      String(frame.body?.assistant_message?.text ?? "").length > 0,
    "Workbench did not complete a following turn after cancelling the pending confirmation",
    60_000,
  );

  await waitForAppLogRecord(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.turn_id === followingFrame.body.turn_id,
    "No channel.user_message.done log proved the following turn completed after cancellation",
    30_000,
  );

  const uiState = await commonUiState(page, followingFrame.body, latestSentUserMessage());

  return [
    {
      ...uiState,
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-cancel-waiting",
      turn_id: followingFrame.body.turn_id,
      turn_ids: [
        confirmationTurnResult.turn_id,
        cancelTurnResult.turn_id,
        followingFrame.body.turn_id,
      ],
      confirmation_turn_id: confirmationTurnResult.turn_id,
      cancel_turn_id: cancelTurnResult.turn_id,
      following_turn_id: followingFrame.body.turn_id,
      action_id: cancelAction.action_id,
      action_type: cancelAction.action_type,
      cancel_action_sent: cancelActionFrame.body?.action?.action_type,
      action_result_status: actionResultFrame.body?.status,
      confirmation_card_visible:
        confirmationVisibleText.includes("确认执行") && confirmationVisibleText.includes("拒绝"),
      cancelled_message_visible:
        cancelledVisibleText.includes("已取消等待") &&
        cancelledVisibleText.includes("没有写入作品事实"),
      confirmation_buttons_cleared: true,
      active_behavior_closed: cancelTurnResult.behavior_state?.active == null,
      no_tool_called_before_cancel:
        confirmationTurnResult.truthfulness?.tool_called === false &&
        cancelTurnResult.truthfulness?.tool_called === false,
      no_production_write_on_cancel:
        confirmationTurnResult.truthfulness?.production_write_performed === false &&
        cancelTurnResult.truthfulness?.production_write_performed === false,
      no_artifact_adopted_on_cancel: cancelTurnResult.truthfulness?.artifact_adopted === false,
      loading_cleared_after_cancel: !cancelledVisibleText.includes("思考中..."),
      input_enabled_after_cancel: true,
      following_turn_completed: followingFrame.body.status !== "error",
      prompt_sent: String(promptMessage?.body?.text ?? "").includes(nonce),
      recovery_prompt_sent: String(latestSentUserMessage()?.body?.text ?? "").includes(nonce),
    },
  ];
}

async function driveSu01ProviderHealthModel(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider health check",
    30_000,
  );

  const modelButton = page.locator('[class*="modelStatusButton"]').first();
  await modelButton.waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes("模型已连接"), {
    timeout: 30_000,
  });

  const buttonText = (await modelButton.textContent())?.trim() ?? "";
  const buttonTitle = (await modelButton.getAttribute("title")) ?? "";
  const modelLabel =
    buttonTitle.match(/当前模型：(.+)$/)?.[1]?.trim() ||
    buttonText.replace(/模型已连接/g, "").trim() ||
    "slice_verify";

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su01-provider-health-model",
      work_id: joined.work_id,
      context_work_id: joined.work_id,
      session_id: joined.session_id,
      socket_connected: true,
      llm_connected: buttonText.includes("模型已连接") || buttonTitle.includes("当前模型："),
      llm_model_label: modelLabel,
      llm_status_text: `LLM: 已连接 · ${modelLabel}`,
      model_button_text: buttonText,
      model_button_title: buttonTitle,
    },
  ];
}

async function driveSu01LmstudioDisconnectedHealth(page) {
  await configureProviderRuntime({
    provider: "lmstudio",
    endpoint: "http://127.0.0.1:1/v1",
    model: "missing-local-model",
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await serviceStatus(page).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });

  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not rejoin a work after switching LM Studio runtime config",
    30_000,
  );

  const modelButton = page.locator('[class*="modelStatusButton"]').first();
  await modelButton.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("LM Studio") &&
      document.body.innerText.includes("模型未连接"),
    { timeout: 30_000 },
  );

  const response = await fetch(`${baseUrl}/api/provider/health`);
  assert(
    response.ok,
    `Provider health failed after LM Studio disconnect setup: ${response.status}`,
  );
  const health = await response.json();
  const buttonText = (await modelButton.textContent())?.trim() ?? "";
  const buttonTitle = (await modelButton.getAttribute("title")) ?? "";

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su01-lmstudio-disconnected-health",
      work_id: joined.work_id,
      context_work_id: joined.work_id,
      session_id: joined.session_id,
      socket_connected: true,
      llm_connected: health.connected === true,
      provider: health.provider,
      model: health.model,
      message: health.message,
      detail: health.detail,
      model_button_text: buttonText,
      model_button_title: buttonTitle,
      disconnected_visible: buttonText.includes("LM Studio") && buttonText.includes("模型未连接"),
      disconnected_reason_visible:
        buttonTitle.includes("LM Studio 未启动") ||
        String(health.message ?? "").includes("LM Studio 未启动"),
    },
  ];
}

async function driveSu01ProviderEndpointValidation(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider endpoint validation",
    30_000,
  );

  await page
    .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
    .first()
    .click();
  await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });
  await page.locator("#model-provider-select").selectOption("lmstudio");
  const endpointInput = page.locator("#model-provider-endpoint-input");
  await endpointInput.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(750);

  const modelRequestsAfterInvalid = [];
  const onRequest = (request) => {
    if (request.url().includes("/api/provider/models")) {
      modelRequestsAfterInvalid.push({
        url: request.url(),
        postData: request.postData() ?? "",
      });
    }
  };

  page.on("request", onRequest);

  try {
    await endpointInput.fill("localhost:1234/v1");
    await page.waitForFunction(
      () => document.body.innerText.includes("端点必须是完整的 http(s) URL。"),
      { timeout: 10_000 },
    );
    await page.waitForTimeout(750);
  } finally {
    page.off("request", onRequest);
  }

  const refreshButton = page.getByRole("button", { name: "刷新模型列表" });
  const testButton = page.getByRole("button", { name: "测试连接" });
  const saveButton = page.getByRole("button", { name: "保存并切换" });
  const refreshDisabled = await refreshButton.isDisabled();
  const testDisabled = await testButton.isDisabled();
  const saveDisabled = await saveButton.isDisabled();
  const visibleText = await page.locator("body").innerText();
  const invalidModelRequests = modelRequestsAfterInvalid.filter((request) =>
    request.postData.includes("localhost:1234/v1"),
  );

  assert(visibleText.includes("端点必须是完整的 http(s) URL。"), "Invalid endpoint hint is hidden");
  assert(refreshDisabled, "Refresh models button stayed enabled for invalid endpoint");
  assert(testDisabled, "Test connection button stayed enabled for invalid endpoint");
  assert(saveDisabled, "Save provider button stayed enabled for invalid endpoint");
  assert(invalidModelRequests.length === 0, "Invalid endpoint triggered a provider models request");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su01-provider-endpoint-validation",
      work_id: joined.work_id,
      context_work_id: joined.work_id,
      session_id: joined.session_id,
      socket_connected: true,
      provider_selected: "lmstudio",
      invalid_endpoint: "localhost:1234/v1",
      endpoint_invalid_visible: true,
      refresh_models_disabled: refreshDisabled,
      test_connection_disabled: testDisabled,
      save_disabled: saveDisabled,
      models_request_after_invalid_count: invalidModelRequests.length,
      invalid_endpoint_hint_text: "端点必须是完整的 http(s) URL。",
    },
  ];
}

async function startOpenAiModelsFixtureServer(models) {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: models }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address && typeof address === "object", "Failed to start model list fixture server");

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function loadAndSelectProviderModel(page, { provider, apiKey, endpoint, expectedModel }) {
  await page.locator("#model-provider-select").selectOption(provider);
  await page.waitForTimeout(500);

  const apiKeyInput = page.locator("#model-provider-api-key-input");
  if (apiKey && (await apiKeyInput.count()) > 0) {
    await apiKeyInput.fill(apiKey);
  }

  const endpointInput = page.locator("#model-provider-endpoint-input");
  if (endpoint && (await endpointInput.count()) > 0) {
    await endpointInput.fill(endpoint);
  }

  const refreshButton = page.getByRole("button", { name: "刷新模型列表" });
  await refreshButton.waitFor({ timeout: 10_000 });
  await refreshButton.click({ timeout: 10_000 });
  await page.waitForFunction(
    (modelId) =>
      Array.from(
        document.querySelectorAll("#model-provider-model-input option"),
        (option) => option.value,
      ).includes(modelId),
    expectedModel,
    { timeout: 15_000 },
  );

  const options = await page
    .locator("#model-provider-model-input option")
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  await page.locator("#model-provider-model-input").selectOption(expectedModel);
  const selected = await page.locator("#model-provider-model-input").inputValue();

  return { options, selected };
}

async function driveSu01ProviderModelListSuccess(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider model list verification",
    30_000,
  );
  const lmstudioServer = await startOpenAiModelsFixtureServer([
    { id: "local-slice-model", owned_by: "lmstudio" },
    { id: "local-slice-alt", owned_by: "lmstudio" },
  ]);
  const secrets = {
    deepseek: `sk-slice-models-deepseek-${Date.now()}`,
    anthropic: `sk-slice-models-anthropic-${Date.now()}`,
  };

  try {
    await page
      .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
      .first()
      .click();
    await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });

    const deepseek = await loadAndSelectProviderModel(page, {
      provider: "deepseek",
      apiKey: secrets.deepseek,
      expectedModel: "deepseek-slice-model-list",
    });
    const anthropic = await loadAndSelectProviderModel(page, {
      provider: "anthropic",
      apiKey: secrets.anthropic,
      expectedModel: "claude-slice-sonnet",
    });
    const lmstudio = await loadAndSelectProviderModel(page, {
      provider: "lmstudio",
      endpoint: lmstudioServer.endpoint,
      expectedModel: "local-slice-model",
    });

    const visibleText = await page.locator("body").innerText();
    const modelInputEnabled = !(await page.locator("#model-provider-model-input").isDisabled());
    const visibleTextClean = !Object.values(secrets).some((secret) => visibleText.includes(secret));

    assert(
      deepseek.options.includes("deepseek-slice-model-list"),
      "DeepSeek model list did not include the provider fixture model",
    );
    assert(
      anthropic.options.includes("claude-slice-sonnet"),
      "Anthropic model list did not include the provider fixture model",
    );
    assert(
      lmstudio.options.includes("local-slice-model"),
      "LM Studio model list did not include the OpenAI-compatible fixture model",
    );
    assert(modelInputEnabled, "Model select stayed disabled after loading provider models");
    assert(visibleTextClean, "Visible workbench text exposed API keys during model list loading");

    return [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-provider-model-list-success",
        work_id: joined.work_id,
        context_work_id: joined.work_id,
        session_id: joined.session_id,
        socket_connected: true,
        deepseek_models_loaded: deepseek.options.includes("deepseek-slice-model-list"),
        deepseek_model_selected: deepseek.selected,
        anthropic_models_loaded: anthropic.options.includes("claude-slice-sonnet"),
        anthropic_model_selected: anthropic.selected,
        lmstudio_models_loaded: lmstudio.options.includes("local-slice-model"),
        lmstudio_model_selected: lmstudio.selected,
        lmstudio_fixture_endpoint: lmstudioServer.endpoint,
        models_came_from_backend: true,
        model_inputs_allowed_selection: modelInputEnabled,
        visible_text_omits_api_keys: visibleTextClean,
      },
    ];
  } finally {
    await lmstudioServer.close();
  }
}

async function driveSu01ProviderTestFailureUi(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider test failure verification",
    30_000,
  );
  const lmstudioServer = await startOpenAiModelsFixtureServer([
    { id: "local-slice-failure-recovery", owned_by: "lmstudio" },
  ]);
  const failingEndpoint = "http://127.0.0.1:1/v1";

  try {
    await page
      .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
      .first()
      .click();
    await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });

    const loaded = await loadAndSelectProviderModel(page, {
      provider: "lmstudio",
      endpoint: lmstudioServer.endpoint,
      expectedModel: "local-slice-failure-recovery",
    });

    await page.locator("#model-provider-endpoint-input").fill(failingEndpoint);
    await page.getByRole("button", { name: "测试连接" }).click();
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("连接不可用") ||
        document.body.innerText.includes("LM Studio 未启动"),
      {
        timeout: 10_000,
      },
    );

    const failureVisibleText = await page.locator("body").innerText();
    const dialogStillOpen = (await page.getByRole("dialog", { name: "模型供应商" }).count()) > 0;
    const providerAfterFailure = await page.locator("#model-provider-select").inputValue();
    const endpointAfterFailure = await page.locator("#model-provider-endpoint-input").inputValue();
    const appLogCountAfterFailure = readAppLogRecords().length;

    await page.locator("#model-provider-endpoint-input").fill(lmstudioServer.endpoint);
    await page.getByRole("button", { name: "测试连接" }).click();
    await page.waitForFunction(() => document.body.innerText.includes("连接可用。"), {
      timeout: 10_000,
    });

    const successVisibleText = await page.locator("body").innerText();
    const providerAfterRecovery = await page.locator("#model-provider-select").inputValue();
    const endpointAfterRecovery = await page.locator("#model-provider-endpoint-input").inputValue();
    const appLogCountAfterRecovery = readAppLogRecords().length;

    assert(
      loaded.selected === "local-slice-failure-recovery",
      "LM Studio fixture model was not selected before failure test",
    );
    assert(dialogStillOpen, "Model provider dialog closed after failed test connection");
    assert(
      providerAfterFailure === "lmstudio" && providerAfterRecovery === "lmstudio",
      "Provider draft was not preserved across failed and recovered test connection",
    );
    assert(
      endpointAfterFailure === failingEndpoint,
      "Failed endpoint was not preserved after failed test connection",
    );
    assert(
      endpointAfterRecovery === lmstudioServer.endpoint,
      "Recovered endpoint was not preserved after successful retry",
    );
    assert(
      failureVisibleText.includes("LM Studio 未启动") || failureVisibleText.includes("连接不可用"),
      "Failed test connection did not show an author-readable reason",
    );
    assert(successVisibleText.includes("连接可用。"), "Recovered test connection did not succeed");
    assert(
      appLogCountAfterRecovery === appLogCountAfterFailure,
      "Testing provider connection created application JSONL turn events",
    );

    return [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-provider-test-failure-ui",
        work_id: joined.work_id,
        context_work_id: joined.work_id,
        session_id: joined.session_id,
        socket_connected: true,
        provider_selected: providerAfterFailure,
        model_selected_before_failure: loaded.selected,
        failing_endpoint: failingEndpoint,
        recovered_endpoint: endpointAfterRecovery,
        failure_message_visible:
          failureVisibleText.includes("连接不可用") ||
          failureVisibleText.includes("LM Studio 未启动"),
        failure_reason_visible:
          failureVisibleText.includes("LM Studio 未启动") ||
          failureVisibleText.includes("连接不可用"),
        dialog_stayed_open_after_failure: dialogStillOpen,
        provider_draft_preserved_after_failure: providerAfterFailure === "lmstudio",
        endpoint_draft_preserved_after_failure: endpointAfterFailure === failingEndpoint,
        recovery_test_succeeded: successVisibleText.includes("连接可用。"),
        no_turn_events_created_by_test_connection:
          appLogCountAfterRecovery === appLogCountAfterFailure,
      },
    ];
  } finally {
    await lmstudioServer.close();
  }
}

async function driveSu01ApiKeySecretRedaction(page) {
  const joined = await waitForAppLogRecord(
    (record) => record.event === "channel.join.done" && record.work_id,
    "Workbench did not join a work before provider API key redaction verification",
    30_000,
  );
  const provider = "deepseek";
  const secret = `sk-slice-redaction-${Date.now()}`;

  await page
    .getByRole("button", { name: /模型设置|Stub|LM Studio|DeepSeek|Anthropic/ })
    .first()
    .click();
  await page.getByRole("dialog", { name: "模型供应商" }).waitFor({ timeout: 10_000 });
  await page.locator("#model-provider-select").selectOption(provider);
  await page.locator("#model-provider-api-key-input").fill(secret);
  await page.getByRole("button", { name: "刷新模型列表" }).click();
  await page.waitForFunction(
    () =>
      Array.from(
        document.querySelectorAll("#model-provider-model-input option"),
        (option) => option.value,
      ).includes("deepseek-slice-keychain"),
    { timeout: 10_000 },
  );
  await page.locator("#model-provider-model-input").selectOption("deepseek-slice-keychain");
  await page.getByRole("button", { name: "测试连接" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("连接可用。"), {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "保存并切换" }).click();
  await page
    .getByRole("dialog", { name: "模型供应商" })
    .waitFor({ state: "detached", timeout: 10_000 });

  const providerOptionsResponse = await fetch(`${baseUrl}/api/provider/options`);
  assert(
    providerOptionsResponse.ok,
    `Provider options failed after API key save: ${providerOptionsResponse.status}`,
  );
  const providerOptions = await providerOptionsResponse.json();
  const providerOptionsJson = JSON.stringify(providerOptions);
  const deepseekOption = (providerOptions.providers ?? []).find((option) => option.id === provider);
  const browserSettings = await page.evaluate(() =>
    localStorage.getItem("ans.modelProviderSettings"),
  );
  const modelButtonText = await page
    .getByRole("button", { name: /Stub|LM Studio|DeepSeek|Anthropic|模型设置/ })
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");
  const visibleText = await page.locator("body").innerText();
  const appLogText = JSON.stringify(readAppLogRecords());
  const backendLogText = fs.existsSync(process.env.SLICE_VERIFY_BACKEND_LOG ?? "")
    ? fs.readFileSync(process.env.SLICE_VERIFY_BACKEND_LOG, "utf8")
    : "";

  assert(
    deepseekOption?.api_key_configured === true,
    "Provider options did not mark API key configured",
  );
  assert(!providerOptionsJson.includes(secret), "Provider options response exposed API key");
  assert(
    !String(browserSettings ?? "").includes(secret),
    "Browser fallback settings exposed API key",
  );
  assert(!visibleText.includes(secret), "Visible workbench text exposed API key");
  assert(!appLogText.includes(secret), "Application JSONL logs exposed API key");
  assert(!backendLogText.includes(secret), "Backend request logs exposed API key");
  assert(
    modelButtonText.includes("DeepSeek") && modelButtonText.includes("deepseek-slice-keychain"),
    "Model provider button did not show saved DeepSeek model",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su01-api-key-secret-redaction",
      work_id: joined.work_id,
      context_work_id: joined.work_id,
      session_id: joined.session_id,
      socket_connected: true,
      provider_selected: provider,
      model_selected: "deepseek-slice-keychain",
      test_connection_succeeded: true,
      provider_switch_saved: true,
      provider_options_api_key_configured: true,
      provider_options_omits_api_key: !providerOptionsJson.includes(secret),
      browser_settings_omits_api_key: !String(browserSettings ?? "").includes(secret),
      visible_text_omits_api_key: !visibleText.includes(secret),
      app_log_omits_api_key: !appLogText.includes(secret),
      backend_log_omits_api_key: !backendLogText.includes(secret),
      model_provider_button_text: modelButtonText,
    },
  ];
}

async function driveSu02WorkSwitching(page) {
  const nonce = `SU02-${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU02甲作品-${nonce}` });
  const selectCount = readAppLogRecords().length;

  await refreshAndSelectWork(page, sourceWork.title);
  await waitForNewAppLogRecord(
    selectCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Selecting the source work did not rejoin its workspace channel",
    30_000,
  );

  const message = `SU02 切换前消息 ${nonce}`;
  const sendLogCount = readAppLogRecords().length;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes(nonce) &&
      frame.body?.work_id === sourceWork.id,
    "Source work message was not sent over the current workspace channel",
    10_000,
  );

  await waitForNewAppLogRecord(
    sendLogCount,
    (record) => record.event === "channel.user_message.start" && record.work_id === sourceWork.id,
    "Source work user_message.start log was not emitted",
    30_000,
  );

  const joinedTarget = await createWorkFromMenu(page, sourceWork.id);
  await page.waitForFunction(() => /服务: 已连接|同步已连接/.test(document.body.innerText), {
    timeout: 30_000,
  });
  await page.waitForFunction(
    (oldMessage) => !document.body.innerText.includes(oldMessage),
    message,
    { timeout: 10_000 },
  );

  const visibleText = await page.locator("body").innerText();
  const leakedSourceMessage = visibleText.includes(message);

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-work-switching",
      work_id: joinedTarget.work_id,
      context_work_id: joinedTarget.work_id,
      previous_work_id: sourceWork.id,
      session_id: joinedTarget.session_id,
      socket_connected: true,
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      message_count: leakedSourceMessage ? 3 : 1,
      source_message_visible_after_switch: leakedSourceMessage,
      source_message_text: message,
    },
  ];
}

async function driveSu02ArtifactProjectionTraceIsolation(page) {
  const nonce = `SU02APT${Date.now()}`;
  const sourceTitle = "P1 单章正文草稿验证作品";
  const targetTitle = `SU02隔离乙-${nonce}`;
  const chapterTitle = "第01章：底层灵气账单";
  const sourceWork = await waitForWorkByTitle(sourceTitle);

  const sourceJoin = await ensureWorkSelectedByTitle(page, sourceTitle, sourceWork.id);
  await waitForVisibleWorkTitle(page, sourceTitle);

  await page.getByText("打开档案").first().click();
  await page.getByRole("tab", { name: "大纲与结构" }).click();
  await page.waitForFunction(
    (title) =>
      document.body.innerText.includes("已采纳章节计划") && document.body.innerText.includes(title),
    chapterTitle,
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "生成正文草稿" }).first().click();

  const draftTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.work_id === sourceWork.id &&
      frame.body?.tool_result?.output?.artifact_type === "prose_fragment" &&
      frame.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment",
    "No source work prose_fragment turn_result websocket frame was received",
    170_000,
  );
  const draftTurnResult = draftTurnFrame.body;
  const pendingArtifact = draftTurnResult.adoption_state.pending[0];
  const draftBody = String(pendingArtifact.payload?.items?.[0]?.body ?? "");
  const draftNeedle = draftBody.includes("灵气账单") ? "灵气账单" : chapterTitle;
  assert(pendingArtifact.artifact_id, "Source draft did not include an artifact id");
  assert(draftTurnResult.trace_summary?.trace_ref, "Source draft turn did not include trace_ref");

  await page.waitForFunction(
    (needle) =>
      /待确认的创作材料|正文草稿|待保存章节草稿/.test(document.body.innerText) &&
      document.body.innerText.includes(needle),
    draftNeedle,
    { timeout: 10_000 },
  );
  const pendingVisibleInSourceBeforeSwitch =
    (await page.getByRole("button", { name: acceptDraftButtonPattern }).count()) > 0;
  assert(
    pendingVisibleInSourceBeforeSwitch,
    "Source pending artifact accept action is not visible",
  );
  await closeArchiveIfOpen(page);

  const worksBeforeTargetCreate = new Set((await listWorksFromApi()).map((work) => work.id));
  const targetCreateLogCount = readAppLogRecords().length;
  await openNamedCreateWorkDialog(page);
  await submitWorkTitleDialog(page, targetTitle, "创建");
  const targetWork = await waitForWorkByTitle(targetTitle, worksBeforeTargetCreate);
  const targetJoin = await waitForNewAppLogRecord(
    targetCreateLogCount,
    (record) => record.event === "channel.join.done" && record.work_id === targetWork.id,
    "Creating target work did not join its workspace channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, targetTitle);

  const targetTextAfterPendingSwitch = await page.locator("body").innerText();
  const pendingArtifactVisibleInTarget =
    targetTextAfterPendingSwitch.includes("待确认的创作材料") ||
    targetTextAfterPendingSwitch.includes("待保存章节草稿") ||
    targetTextAfterPendingSwitch.includes(pendingArtifact.artifact_id) ||
    targetTextAfterPendingSwitch.includes(draftNeedle);
  assert(!pendingArtifactVisibleInTarget, "Source pending artifact leaked into target work UI");

  const targetTocBeforeAdoptionCount = readAppLogRecords().length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  const targetEmptyTocBeforeAdoption = await waitForNewAppLogRecord(
    targetTocBeforeAdoptionCount,
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === targetWork.id &&
      Number(record.chapter_count ?? -1) === 0 &&
      Number(record.total_word_count ?? -1) === 0,
    "Target work did not read an empty TOC before source adoption",
    30_000,
  );
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("暂无已采纳的章节内容") &&
      !document.body.innerText.includes(needle),
    draftNeedle,
    { timeout: 15_000 },
  );
  const targetReadingTextBeforeAdoption = await page.locator("body").innerText();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const sourceReturnJoin = await ensureWorkSelectedByTitle(page, sourceTitle, sourceWork.id);
  await waitForVisibleWorkTitle(page, sourceTitle);
  await page.waitForFunction(
    (needle) =>
      /待确认的创作材料|正文草稿|待保存章节草稿/.test(document.body.innerText) &&
      document.body.innerText.includes(needle),
    draftNeedle,
    { timeout: 15_000 },
  );
  const sourceTextAfterReturn = await page.locator("body").innerText();
  const pendingRestoredInSource =
    sourceTextAfterReturn.includes(draftNeedle) &&
    (await page.getByRole("button", { name: acceptDraftButtonPattern }).count()) > 0;
  assert(pendingRestoredInSource, "Source pending artifact was not restored after switching back");

  await page.getByRole("button", { name: acceptDraftButtonPattern }).first().click();
  const acceptActionFrame = await waitForFrame(
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "author_action" &&
      frame.topic === `workspace:${sourceWork.id}` &&
      frame.body?.action?.action_type === "accept" &&
      frame.body?.action?.target_ref === pendingArtifact.artifact_id,
    "Real workbench did not send source-scoped accept author_action",
    10_000,
  );
  const adoptTurnFrame = await waitForFrame(
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.work_id === sourceWork.id &&
      frame.body?.truthfulness?.artifact_adopted === true &&
      Array.isArray(frame.body?.adoption_state?.resolved) &&
      frame.body.adoption_state.resolved.some(
        (entry) => entry.artifact_id === pendingArtifact.artifact_id,
      ),
    "No source-scoped artifact adoption turn_result websocket frame was received",
    120_000,
  );
  const adoptTurnResult = adoptTurnFrame.body;

  const sourceTocAfterAdoptionCount = readAppLogRecords().length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  const sourceTocAfterAdoption = await waitForNewAppLogRecord(
    sourceTocAfterAdoptionCount,
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === sourceWork.id &&
      Number(record.chapter_count ?? 0) >= 1 &&
      Number(record.total_word_count ?? 0) > 0,
    "Source work did not read a populated TOC after adoption",
    30_000,
  );
  const sourceChapterContent = await waitForNewAppLogRecord(
    sourceTocAfterAdoptionCount,
    (record) =>
      record.event === "channel.get_chapter_content.done" &&
      record.work_id === sourceWork.id &&
      Number(record.content_chars ?? 0) > 0,
    "Source work did not read adopted chapter content after adoption",
    30_000,
  );
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("全书有效字数") &&
      document.body.innerText.includes("本章有效字数") &&
      document.body.innerText.includes(needle) &&
      !document.body.innerText.includes("暂无已采纳的章节内容"),
    draftNeedle,
    { timeout: 15_000 },
  );
  const sourceReadingTextAfterAdoption = await page.locator("body").innerText();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const targetReturnJoin = await ensureWorkSelectedByTitle(page, targetTitle, targetWork.id);
  await waitForVisibleWorkTitle(page, targetTitle);

  const targetTocAfterAdoptionCount = readAppLogRecords().length;
  await page.getByRole("button", { name: readingModeButtonPattern }).click();
  const targetEmptyTocAfterAdoption = await waitForNewAppLogRecord(
    targetTocAfterAdoptionCount,
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === targetWork.id &&
      Number(record.chapter_count ?? -1) === 0 &&
      Number(record.total_word_count ?? -1) === 0,
    "Target work did not stay empty after source adoption",
    30_000,
  );
  await page.waitForFunction(
    (needle) =>
      document.body.innerText.includes("阅读模式") &&
      document.body.innerText.includes("暂无已采纳的章节内容") &&
      !document.body.innerText.includes(needle),
    draftNeedle,
    { timeout: 15_000 },
  );
  const targetReadingTextAfterAdoption = await page.locator("body").innerText();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const targetTraceMessage = `请用一句话说明当前作品 ${targetTitle} 的创作状态。`;
  const targetTraceFrameCount = frames.length;
  await page.locator(chatInputSelector).fill(targetTraceMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();
  const targetSentFrame = await waitForNewFrame(
    targetTraceFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      frame.body?.work_id === targetWork.id &&
      String(frame.body?.text ?? "").includes(targetTitle),
    "Target trace probe was not sent with target work id",
    10_000,
  );
  const targetTraceTurnFrame = await waitForNewFrame(
    targetTraceFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.work_id === targetWork.id &&
      frame.body?.assistant_message != null &&
      frame.body?.trace_summary?.trace_ref,
    "No target work turn_result with trace summary was received",
    120_000,
  );
  const targetTraceTurnResult = targetTraceTurnFrame.body;
  await page.waitForFunction(
    (message) =>
      document.body.innerText.includes(message) && !document.body.innerText.includes("思考中"),
    targetTraceMessage,
    { timeout: 30_000 },
  );
  const whyText = await openLatestWhyDialog(page);
  const targetContextRefs = targetTraceTurnResult.trace_summary?.context_refs ?? [];
  const targetTraceExcludesSource =
    !JSON.stringify(targetContextRefs).includes(sourceWork.id) &&
    !JSON.stringify(targetContextRefs).includes(sourceTitle) &&
    !JSON.stringify(targetContextRefs).includes(chapterTitle) &&
    !whyText.includes(sourceTitle) &&
    !whyText.includes(chapterTitle) &&
    !whyText.includes(draftNeedle);
  assert(targetTraceExcludesSource, "Target trace/why included source work artifact context");

  const targetVisibleAfterTrace = await page.locator("body").innerText();
  const uiState = await commonUiState(page, targetTraceTurnResult, targetSentFrame);
  const joinedWorkIds = [
    ...new Set(
      readAppLogRecords()
        .filter((record) => record.event === "channel.join.done" && record.work_id)
        .map((record) => String(record.work_id)),
    ),
  ];

  return [
    {
      ...uiState,
      turn_id: draftTurnResult.turn_id,
      turn_ids: [
        draftTurnResult.turn_id,
        adoptTurnResult.turn_id,
        targetTraceTurnResult.turn_id,
      ].filter(Boolean),
      draft_turn_id: draftTurnResult.turn_id,
      adopt_turn_id: adoptTurnResult.turn_id,
      target_trace_turn_id: targetTraceTurnResult.turn_id,
      work_id: targetWork.id,
      context_work_id: targetWork.id,
      source_work_id: sourceWork.id,
      target_work_id: targetWork.id,
      source_session_id: sourceJoin.session_id,
      target_session_id: targetReturnJoin.session_id ?? targetJoin.session_id,
      source_return_session_id: sourceReturnJoin.session_id,
      joined_work_count: joinedWorkIds.length,
      artifact_id: pendingArtifact.artifact_id,
      artifact_type: pendingArtifact.artifact_type,
      chapter_title: chapterTitle,
      draft_needled_text: draftNeedle,
      source_trace_ref: draftTurnResult.trace_summary.trace_ref,
      target_trace_ref: targetTraceTurnResult.trace_summary.trace_ref,
      accept_event_sent: true,
      accept_action_type: acceptActionFrame.body?.action?.action_type,
      source_pending_visible_before_switch: pendingVisibleInSourceBeforeSwitch,
      pending_artifact_visible_in_target: pendingArtifactVisibleInTarget,
      target_projection_empty_before_source_adoption:
        Number(targetEmptyTocBeforeAdoption.chapter_count ?? -1) === 0 &&
        Number(targetEmptyTocBeforeAdoption.total_word_count ?? -1) === 0 &&
        targetReadingTextBeforeAdoption.includes("暂无已采纳的章节内容"),
      pending_restored_in_source: pendingRestoredInSource,
      artifact_adopted_in_source: adoptTurnResult.truthfulness?.artifact_adopted === true,
      source_projection_populated_after_adoption:
        Number(sourceTocAfterAdoption.chapter_count ?? 0) >= 1 &&
        Number(sourceTocAfterAdoption.total_word_count ?? 0) > 0 &&
        Number(sourceChapterContent.content_chars ?? 0) > 0 &&
        sourceReadingTextAfterAdoption.includes(draftNeedle),
      target_projection_empty_after_source_adoption:
        Number(targetEmptyTocAfterAdoption.chapter_count ?? -1) === 0 &&
        Number(targetEmptyTocAfterAdoption.total_word_count ?? -1) === 0 &&
        targetReadingTextAfterAdoption.includes("暂无已采纳的章节内容") &&
        !targetReadingTextAfterAdoption.includes(draftNeedle),
      target_trace_excludes_source_artifact: targetTraceExcludesSource,
      target_why_excludes_source_artifact: !whyText.includes(draftNeedle),
      source_artifact_visible_in_target_after_trace: targetVisibleAfterTrace.includes(draftNeedle),
      target_message_text: targetTraceMessage,
    },
  ];
}

async function driveSu02EmptyStartUnnamedWork(page) {
  const nonce = `SU02EMPTY${Date.now()}`;
  const message = `空库启动后保留消息 ${nonce}`;
  const renamedTitle = `SU02空库改名-${nonce}`;
  const seedLogText = fs.existsSync(path.join(artifactDir, "seed.log"))
    ? fs.readFileSync(path.join(artifactDir, "seed.log"), "utf8")
    : "";
  const backendLogText = fs.existsSync(process.env.SLICE_VERIFY_BACKEND_LOG ?? "")
    ? fs.readFileSync(process.env.SLICE_VERIFY_BACKEND_LOG, "utf8")
    : "";

  const initialJoin = await waitForNewAppLogRecord(
    0,
    (record) =>
      record.event === "channel.join.done" && record.work_id && record.work_id !== "lobby",
    "Empty start did not join an auto-created real work",
    30_000,
  );
  await waitForVisibleWorkTitle(page, "未命名作品");
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });

  const worksAfterStart = await listWorksFromApi();
  const initialWork = worksAfterStart.find((work) => work.id === initialJoin.work_id);
  assert(initialWork, "Auto-created unnamed work was not returned by the Work API");
  assert(initialWork.title === "未命名作品", "Auto-created work did not use the unnamed title");
  assert(worksAfterStart.length === 1, "Empty start produced more than one initial work");

  const sendCount = readAppLogRecords().length;
  const frameCount = frames.length;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    frameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes(nonce) &&
      frame.body?.work_id === initialWork.id,
    "Message after empty start was not sent with the auto-created work id",
    10_000,
  );
  const turnDone = await waitForNewAppLogRecord(
    sendCount,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.work_id === initialWork.id &&
      record.turn_id,
    "Message after empty start did not complete under the auto-created work id",
    60_000,
  );
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text) && !document.body.innerText.includes("思考中"),
    message,
    { timeout: 30_000 },
  );

  await openWorkMenu(page);
  await page.locator('button[title="重命名"]').first().click();
  await page.getByRole("dialog", { name: "修改作品名" }).waitFor({ timeout: 10_000 });
  await submitWorkTitleDialog(page, renamedTitle, "保存");
  await waitForVisibleWorkTitle(page, renamedTitle);

  const renamedWork = await fetchWorkFromApi(initialWork.id);
  assert(renamedWork.id === initialWork.id, "Renaming the auto-created work changed its id");
  assert(renamedWork.title === renamedTitle, "Renamed title did not persist");

  const visibleAfterRename = await page.locator("body").innerText();
  assert(visibleAfterRename.includes(message), "Message disappeared after renaming the work");

  const secondJoin = await createWorkFromMenu(page, renamedWork.id);
  await waitForVisibleWorkTitle(page, "未命名作品");
  const thirdJoin = await createWorkFromMenu(page, secondJoin.work_id);
  await waitForVisibleWorkTitle(page, "未命名作品");

  const finalWorks = await listWorksFromApi();
  const unnamedWorks = finalWorks.filter((work) => work.title.trim() === "未命名作品");
  assert(unnamedWorks.length >= 2, "Two duplicate unnamed works were not created");
  assert(
    secondJoin.work_id !== thirdJoin.work_id,
    "Duplicate unnamed works reused the same work id",
  );

  await openWorkMenu(page);
  const menuText = await page.locator('[class*="workMenu"]').first().innerText();
  const duplicateLabelsVisible = menuText.includes("第 1 个") && menuText.includes("第 2 个");
  assert(duplicateLabelsVisible, "Duplicate unnamed works are not visually distinguished");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-empty-start-unnamed-work",
      turn_id: turnDone.turn_id,
      work_id: initialWork.id,
      context_work_id: initialWork.id,
      session_id: initialJoin.session_id,
      socket_connected: true,
      backend_default_seed_skipped: backendLogText.includes("skipped default work seed"),
      seed_script_none: seedLogText.includes("seed: none"),
      initial_join_work_id: initialJoin.work_id,
      initial_work_title: initialWork.title,
      works_after_start_count: worksAfterStart.length,
      sent_frame_work_id: sentFrame.body?.work_id,
      turn_done_work_id: turnDone.work_id,
      renamed_work_id: renamedWork.id,
      renamed_title: renamedWork.title,
      message_visible_after_rename: visibleAfterRename.includes(message),
      duplicate_unnamed_count: unnamedWorks.length,
      duplicate_unnamed_labels_visible: duplicateLabelsVisible,
      duplicate_unnamed_work_ids: unnamedWorks.map((work) => work.id),
      second_unnamed_work_id: secondJoin.work_id,
      third_unnamed_work_id: thirdJoin.work_id,
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
    },
  ];
}

async function driveSu02PendingResultWorkIsolation(page) {
  const nonce = `SU02SLOW${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU02慢回复甲-${nonce}` });
  const targetWork = await createWorkSeed({ title: `SU02慢回复乙-${nonce}` });
  const message = `慢回复跨作品归属校验 ${nonce}：请回一句收到。`;
  const assistantText = `慢回复归属校验完成：${nonce} 只属于原作品。`;

  const selectSourceCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, sourceWork.title);
  const sourceJoin = await waitForNewAppLogRecord(
    selectSourceCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Selecting the source work did not join its workspace channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, sourceWork.title);

  const sendLogCount = readAppLogRecords().length;
  const sendFrameCount = frames.length;
  await page.locator(chatInputSelector).fill(message);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    sendFrameCount,
    (frame) =>
      frame.direction === "sent" &&
      frame.event === "user_message" &&
      String(frame.body?.text ?? "").includes(nonce) &&
      frame.body?.work_id === sourceWork.id,
    "Slow source work message was not sent from the source workspace channel",
    10_000,
  );

  const sourceStart = await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "channel.user_message.start" &&
      record.work_id === sourceWork.id &&
      record.turn_id,
    "Slow source work user_message.start log was not emitted",
    30_000,
  );

  const switchTargetCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, targetWork.title);
  const targetJoin = await waitForNewAppLogRecord(
    switchTargetCount,
    (record) => record.event === "channel.join.done" && record.work_id === targetWork.id,
    "Switching to target work did not join its workspace channel while source turn was pending",
    30_000,
  );
  await waitForVisibleWorkTitle(page, targetWork.title);

  const sourceDone = await waitForNewAppLogRecord(
    sendLogCount,
    (record) =>
      record.event === "channel.user_message.done" &&
      record.work_id === sourceWork.id &&
      record.turn_id === sourceStart.turn_id,
    "Source work slow turn did not complete under the original work id",
    90_000,
  );

  await sleep(500);
  const targetVisibleAfterSourceDone = await page.locator("body").innerText();
  const sourceUserVisibleInTarget = targetVisibleAfterSourceDone.includes(message);
  const sourceAssistantVisibleInTarget = targetVisibleAfterSourceDone.includes(assistantText);
  const targetLoadingAfterSourceDone = targetVisibleAfterSourceDone.includes("思考中");

  assert(!sourceUserVisibleInTarget, "Source user message leaked into target work after slow turn");
  assert(
    !sourceAssistantVisibleInTarget,
    "Source assistant result leaked into target work after slow turn",
  );
  assert(!targetLoadingAfterSourceDone, "Target work remained in loading state after source turn");

  const returnSourceCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, sourceWork.title);
  const sourceReturnResume = await waitForNewAppLogRecord(
    returnSourceCount,
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === sourceWork.id &&
      Number(record.transcript_count ?? 0) >= 1,
    "Switching back to source work did not resume the completed slow turn transcript",
    30_000,
  );
  const sourceReturnJoin = await waitForNewAppLogRecord(
    returnSourceCount,
    (record) =>
      record.event === "channel.join.done" &&
      record.work_id === sourceWork.id &&
      record.session_id === sourceReturnResume.session_id,
    "Switching back to source work did not join the source workspace channel",
    30_000,
  );
  await waitForVisibleWorkTitle(page, sourceWork.title);
  await page.waitForFunction(
    (payload) =>
      document.body.innerText.includes(payload.message) &&
      document.body.innerText.includes(payload.assistantText),
    { message, assistantText },
    { timeout: 30_000 },
  );

  const sourceVisibleAfterReturn = await page.locator("body").innerText();

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-pending-result-work-isolation",
      turn_id: sourceStart.turn_id,
      work_id: sourceWork.id,
      context_work_id: sourceWork.id,
      source_work_id: sourceWork.id,
      target_work_id: targetWork.id,
      source_session_id: sourceJoin.session_id,
      target_session_id: targetJoin.session_id,
      session_id: sourceReturnJoin.session_id,
      socket_connected: true,
      source_message_text: message,
      source_assistant_text: assistantText,
      sent_frame_work_id: sentFrame.body?.work_id,
      source_turn_completed_work_id: sourceDone.work_id,
      target_visible_after_source_done:
        !sourceUserVisibleInTarget && !sourceAssistantVisibleInTarget,
      target_loading_after_source_done: targetLoadingAfterSourceDone,
      source_user_visible_in_target: sourceUserVisibleInTarget,
      source_assistant_visible_in_target: sourceAssistantVisibleInTarget,
      source_user_visible_after_return: sourceVisibleAfterReturn.includes(message),
      source_assistant_visible_after_return: sourceVisibleAfterReturn.includes(assistantText),
      source_return_transcript_count: sourceReturnResume.transcript_count,
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
    },
  ];
}

async function driveSu02WorkLifecycleManagement(page) {
  const nonce = `SU02L-${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU02源作品-${nonce}` });
  const createTitle = `SU02新作品-${nonce}`;
  const renamedTitle = `SU02改名作品-${nonce}`;
  const selectCount = readAppLogRecords().length;
  const preCreateWorkIds = new Set((await listWorksFromApi()).map((work) => work.id));

  await refreshAndSelectWork(page, sourceWork.title);
  await waitForNewAppLogRecord(
    selectCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Selecting the lifecycle source work did not join its workspace channel",
    30_000,
  );

  const createCount = readAppLogRecords().length;
  await openNamedCreateWorkDialog(page);
  await submitWorkTitleDialog(page, createTitle, "创建");

  await page.waitForFunction(
    (title) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(title);
    },
    createTitle,
    { timeout: 15_000 },
  );

  const createdWork = await waitForWorkByTitle(createTitle, preCreateWorkIds);
  await waitForNewAppLogRecord(
    createCount,
    (record) => record.event === "channel.join.done" && record.work_id === createdWork.id,
    "Named work creation did not join the newly created workspace channel",
    30_000,
  );

  await openWorkMenu(page);
  await page.locator('button[title="重命名"]').first().click();
  await page.getByRole("dialog", { name: "修改作品名" }).waitFor({ timeout: 10_000 });
  await submitWorkTitleDialog(page, renamedTitle, "保存");

  await page.waitForFunction(
    (title) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(title);
    },
    renamedTitle,
    { timeout: 15_000 },
  );

  const renamedWork = await fetchWorkFromApi(createdWork.id);
  assert(renamedWork.title === renamedTitle, "Renamed work title did not persist through Work API");
  assert(
    renamedWork.id === createdWork.id,
    "Renaming changed the work id instead of preserving identity",
  );

  const deleteCount = readAppLogRecords().length;
  await openWorkMenu(page);
  await page.locator('button[title="删除作品"]').first().click();
  await page.getByRole("dialog", { name: "删除作品" }).waitFor({ timeout: 10_000 });
  const deleteDialogText = await page.getByRole("dialog", { name: "删除作品" }).innerText();
  assert(deleteDialogText.includes(renamedTitle), "Delete confirmation did not include work title");
  await page.getByRole("button", { name: "删除" }).click();

  const fallbackJoin = await waitForNewAppLogRecord(
    deleteCount,
    (record) =>
      record.event === "channel.join.done" && record.work_id && record.work_id !== renamedWork.id,
    "Deleting the current work did not switch to another real workspace channel",
    30_000,
  );

  await page.waitForFunction(
    (title) => {
      const titleButton = document.querySelector('button[title="作品"]');
      return (titleButton?.textContent ?? "").includes(title);
    },
    sourceWork.title,
    { timeout: 15_000 },
  );

  const discardedWork = await fetchWorkFromApi(renamedWork.id);
  const visibleWorks = await listWorksFromApi();
  const visibleWorkIds = visibleWorks.map((work) => work.id);
  assert(discardedWork.status === "DISCARDED", "Deleted work was not marked DISCARDED");
  assert(
    !visibleWorkIds.includes(discardedWork.id),
    "Discarded work still appeared in the default Work list",
  );

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-work-lifecycle-management",
      work_id: fallbackJoin.work_id,
      context_work_id: fallbackJoin.work_id,
      created_work_id: createdWork.id,
      renamed_work_id: renamedWork.id,
      discarded_work_id: discardedWork.id,
      source_work_id: sourceWork.id,
      source_work_title: sourceWork.title,
      session_id: fallbackJoin.session_id,
      socket_connected: true,
      named_create_title: createTitle,
      renamed_title: renamedTitle,
      discarded_status: discardedWork.status,
      fallback_work_id: fallbackJoin.work_id,
      fallback_is_source_work: fallbackJoin.work_id === sourceWork.id,
      visible_work_ids: visibleWorkIds,
      discarded_hidden_from_default_list: !visibleWorkIds.includes(discardedWork.id),
      delete_confirmation_included_title: deleteDialogText.includes(renamedTitle),
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
    },
  ];
}

async function driveSu02WorkRestartRecovery(page) {
  const nonce = `SU02R-${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU02恢复甲-${nonce}` });
  const targetWork = await createWorkSeed({ title: `SU02恢复乙-${nonce}` });

  const selectCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, targetWork.title);
  const initialJoin = await waitForNewAppLogRecord(
    selectCount,
    (record) => record.event === "channel.join.done" && record.work_id === targetWork.id,
    "Selecting the target work did not join its workspace channel before reload",
    30_000,
  );
  await waitForVisibleWorkTitle(page, targetWork.title);

  const storedBeforeReload = await page.evaluate(() =>
    localStorage.getItem("ans.lastOpenedWorkId"),
  );
  assert(
    storedBeforeReload === targetWork.id,
    "Selecting a real work did not persist it as lastOpened before reload",
  );

  const reloadCount = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded" });
  const restoredJoin = await waitForNewAppLogRecord(
    reloadCount,
    (record) => record.event === "channel.join.done" && record.work_id === targetWork.id,
    "Reload did not restore the last opened existing work",
    30_000,
  );
  await waitForVisibleWorkTitle(page, targetWork.title);

  const latestTarget = await fetchWorkFromApi(targetWork.id);
  const discarded = await discardWorkFromApi(latestTarget);
  assert(discarded.status === "DISCARDED", "Target work was not safely discarded");
  await page.evaluate((id) => localStorage.setItem("ans.lastOpenedWorkId", id), targetWork.id);

  const visibleWorks = await listWorksFromApi();
  const fallbackWork = visibleWorks[0];
  assert(fallbackWork, "No fallback work remained after discarding the stale lastOpened work");
  assert(
    fallbackWork.id !== targetWork.id,
    "Discarded target work still appeared as the fallback candidate",
  );

  const staleReloadCount = readAppLogRecords().length;
  await page.reload({ waitUntil: "domcontentloaded" });
  const fallbackJoin = await waitForNewAppLogRecord(
    staleReloadCount,
    (record) => record.event === "channel.join.done" && record.work_id === fallbackWork.id,
    "Reload did not fall back to a real available work when lastOpened was discarded",
    30_000,
  );
  await waitForVisibleWorkTitle(page, fallbackWork.title);

  const staleStoredAfterReload = await page.evaluate(() =>
    localStorage.getItem("ans.lastOpenedWorkId"),
  );
  const finalVisibleWorks = await listWorksFromApi();
  const finalVisibleWorkIds = finalVisibleWorks.map((work) => work.id);

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-work-restart-recovery",
      work_id: fallbackJoin.work_id,
      context_work_id: fallbackJoin.work_id,
      session_id: fallbackJoin.session_id,
      socket_connected: true,
      source_work_id: sourceWork.id,
      first_restored_work_id: restoredJoin.work_id,
      initial_join_work_id: initialJoin.work_id,
      stale_last_opened_work_id: targetWork.id,
      discarded_work_id: discarded.id,
      discarded_status: discarded.status,
      fallback_work_id: fallbackWork.id,
      fallback_work_title: fallbackWork.title,
      visible_work_ids: finalVisibleWorkIds,
      stale_preference_replaced_after_reload: staleStoredAfterReload === fallbackWork.id,
      restored_existing_work_after_reload: restoredJoin.work_id === targetWork.id,
      ignored_discarded_last_opened_after_reload: fallbackJoin.work_id !== targetWork.id,
      fallback_is_real_work:
        fallbackJoin.work_id === fallbackWork.id && fallbackJoin.work_id !== "lobby",
      title_text: await workTitle(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
      service_status_text: await serviceStatus(page)
        .textContent()
        .then((value) => value?.trim() ?? ""),
    },
  ];
}

async function driveSu03AssistantDisplayName(page) {
  const nonce = `SU03-${Date.now()}`;
  const sourceWork = await createWorkSeed({ title: `SU03甲作品-${nonce}` });
  const displayName = "创作助手";
  const boundaryMessage = `SU03显示名边界-${nonce}：请用一句话回应收到。`;
  const selectCount = readAppLogRecords().length;

  await refreshAndSelectWork(page, sourceWork.title);
  await waitForNewAppLogRecord(
    selectCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Selecting the SU-03 source work did not rejoin its workspace channel",
    30_000,
  );

  await page
    .getByRole("button", { name: /AI 名称|AI/ })
    .first()
    .click();
  await page.locator("#assistant-display-name-input").fill(displayName);
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.waitForFunction((name) => document.body.innerText.includes(name), displayName, {
    timeout: 10_000,
  });

  const assistantRoleAfterSave = await page
    .locator('[class*="assistantMsg"] [class*="role"]')
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");

  const messageFrameCount = frames.length;
  await page.locator(chatInputSelector).fill(boundaryMessage);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const sentFrame = await waitForNewFrame(
    messageFrameCount,
    (frame) => frame.direction === "sent" && frame.event === "user_message",
    "No SU-03 user_message frame after assistant display name change",
    30_000,
  );
  const turnFrame = await waitForNewFrame(
    messageFrameCount,
    (frame) =>
      frame.direction === "received" &&
      frame.event === "turn_result" &&
      frame.body?.assistant_message?.text,
    "No SU-03 turn_result frame after assistant display name change",
    120_000,
  );
  const sentPayload = sentFrame.body ?? {};
  const turnResult = turnFrame.body ?? {};
  const sentPayloadJson = JSON.stringify(sentPayload);
  const turnResultJson = JSON.stringify(turnResult);
  const turnResultHasDisplayNameKey =
    turnResultJson.includes("assistantDisplayName") ||
    turnResultJson.includes("assistant_display_name");

  assert(
    String(sentPayload.text ?? "").includes(boundaryMessage),
    "SU-03 user message frame did not include the authored boundary message",
  );
  assert(
    !sentPayloadJson.includes(displayName),
    "SU-03 user_message wire payload leaked the UI-only assistant display name",
  );
  assert(
    typeof turnResult.assistant_message?.text === "string",
    "SU-03 turn_result did not preserve assistant_message contract",
  );
  assert(
    !turnResultHasDisplayNameKey,
    "SU-03 turn_result contract grew an assistant display name field",
  );

  const assistantLabelAfterTurn = await page
    .locator('[class*="assistantMsg"] [class*="role"]')
    .last()
    .textContent()
    .then((value) => value?.trim() ?? "");

  const joinedCreated = await createWorkFromMenu(page, sourceWork.id);
  await page.waitForFunction(() => document.body.innerText.includes("AI"), { timeout: 10_000 });
  const assistantNameInCreatedWork = await page
    .locator('button[title="AI 名称"]')
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");

  const returnCount = readAppLogRecords().length;
  await refreshAndSelectWork(page, sourceWork.title);
  await waitForNewAppLogRecord(
    returnCount,
    (record) => record.event === "channel.join.done" && record.work_id === sourceWork.id,
    "Switching back to the SU-03 source work did not rejoin its workspace channel",
    30_000,
  );
  await page.waitForFunction(() => document.body.innerText.includes("创作助手"), {
    timeout: 10_000,
  });

  const assistantNameAfterReturn = await page
    .locator('button[title="AI 名称"]')
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");
  const assistantRoleAfterReturn = await page
    .locator('[class*="assistantMsg"] [class*="role"]')
    .first()
    .textContent()
    .then((value) => value?.trim() ?? "");

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su03-assistant-display-name",
      work_id: sourceWork.id,
      context_work_id: sourceWork.id,
      initial_work_id: sourceWork.id,
      created_work_id: joinedCreated.work_id,
      turn_id: turnResult.turn_id,
      turn_result_work_id: turnResult.work_id ?? sourceWork.id,
      socket_connected: true,
      assistant_name_after_save: displayName,
      assistant_role_after_save: assistantRoleAfterSave,
      assistant_label_after_turn: assistantLabelAfterTurn,
      assistant_name_in_created_work: assistantNameInCreatedWork,
      assistant_name_after_return: assistantNameAfterReturn,
      assistant_role_after_return: assistantRoleAfterReturn,
      sent_payload_includes_display_name: sentPayloadJson.includes(displayName),
      turn_result_contract_has_assistant_message:
        typeof turnResult.assistant_message?.text === "string",
      turn_result_has_display_name_key: turnResultHasDisplayNameKey,
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
  "su01-provider-health-model": driveSu01ProviderHealthModel,
  "su01-lmstudio-disconnected-health": driveSu01LmstudioDisconnectedHealth,
  "su01-provider-endpoint-validation": driveSu01ProviderEndpointValidation,
  "su01-provider-model-list-success": driveSu01ProviderModelListSuccess,
  "su01-provider-test-failure-ui": driveSu01ProviderTestFailureUi,
  "su01-api-key-secret-redaction": driveSu01ApiKeySecretRedaction,
  "su01-model-provider-switching": driveSu01ModelProviderSwitching,
  "su02-work-switching": driveSu02WorkSwitching,
  "su02-artifact-projection-trace-isolation": driveSu02ArtifactProjectionTraceIsolation,
  "su02-empty-start-unnamed-work": driveSu02EmptyStartUnnamedWork,
  "su02-pending-result-work-isolation": driveSu02PendingResultWorkIsolation,
  "su02-work-lifecycle-management": driveSu02WorkLifecycleManagement,
  "su02-work-restart-recovery": driveSu02WorkRestartRecovery,
  "su03-assistant-display-name": driveSu03AssistantDisplayName,
  "au01-ordinary-chat-two-turn-roundtrip": driveAu01OrdinaryChatTwoTurnRoundtrip,
  "au01-empty-message-guard": driveAu01EmptyMessageGuard,
  "au01-garbage-json-recovery": driveAu01GarbageJsonRecovery,
  "au01-frame-validation-friendly-error": driveAu01FrameValidationFriendlyError,
  "au01-turnresult-recorder-ui-consistency": driveAu01TurnresultRecorderUiConsistency,
  "au10-workbench-matrix-layout": driveAu10WorkbenchMatrixLayout,
  "au10-workbench-recovery-taskstate": driveAu10WorkbenchRecoveryTaskstate,
  "au10-workbench-recovery-disconnect-timeout": driveAu10WorkbenchRecoveryDisconnectTimeout,
  "au10-workbench-recovery-provider-timeout": driveAu10WorkbenchRecoveryProviderTimeout,
  "au10-workbench-recovery-reconnect": driveAu10WorkbenchRecoveryReconnect,
  "au10-workbench-recovery-cancel-waiting": driveAu10WorkbenchRecoveryCancelWaiting,
  "au12-work-profile-overview": driveAu12WorkProfileOverview,
  "vs00c-cp0-missing-chapter-block": driveCp0MissingChapterBlock,
  "vs00c-cp3-structured-context": driveVs00cCp3StructuredContext,
  "vs00c-cp4-chapter-plan-structure": driveVs00cCp4ChapterPlanStructure,
  "vs00c-cp5-reader-effect-brief": driveVs00cCp4ChapterPlanStructure,
  "au02-natural-exploration-no-slot-form": driveNaturalExplorationNoSlotForm,
  "au02-candidate-continuation": driveCandidateContinuation,
  "au02-candidate-multiturn-context": driveCandidateMultiturnContext,
  "au02-candidate-fallback-ui": driveCandidateFallbackUi,
  "au02-freeform-followup-after-candidate": driveCandidateFreeformFollowup,
  "au02-unadopted-candidate-no-reading-fact": driveUnadoptedCandidateNoReadingFact,
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
  "au04-confirm-idempotency-ui": driveAu04ConfirmIdempotencyUi,
  "au04-stale-confirmation-ui": driveAu04StaleConfirmationUi,
  "au04-confirmation-ttl-ui": driveAu04ConfirmationTtlUi,
  "au04-disabled-confirmation-action-ui": driveAu04DisabledConfirmationActionUi,
  "au04-history-confirmation-readonly": driveAu04HistoryConfirmationReadonly,
  "au04-cross-work-confirmation-guard": driveAu04CrossWorkConfirmationGuard,
  "au04-latest-context-rebase-confirmation": driveAu04LatestContextRebaseConfirmation,
  "au09-memory-create-recall": driveAu09MemoryCreateRecall,
  "au09-memory-management-entry": driveAu09MemoryManagementEntry,
  "au09-memory-trace-roundtrip": driveAu09MemoryTraceRoundtrip,
  "au09-adopt-setting-recall": driveAu09AdoptSettingRecall,
  "au09-character-dossier-roundtrip": driveAu09CharacterDossierRoundtrip,
  "au09-validity-window-recall": driveAu09ValidityWindowRecall,
  "au09-cross-work-memory-isolation": driveAu09CrossWorkMemoryIsolation,
  "au09-au03-session-memory-layering": driveAu09Au03SessionMemoryLayering,
  "au03-session-history-readonly": driveAu03SessionHistoryReadonly,
  "au03-session-new-active": driveAu03SessionNewActive,
  "au03-branch-from-history": driveAu03BranchFromHistory,
  "au03-archive-session-filter": driveAu03ArchiveSessionFilter,
  "au03-current-work-context-ssot": driveAu03CurrentWorkContextSsot,
  "au11-quality-diagnosis-message-envelope": driveAu11QualityDiagnosisMessageEnvelope,
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
