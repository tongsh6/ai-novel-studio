import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5768";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "slice-verify", "vs10-observability-spine");
const appLogDir = process.env.SLICE_VERIFY_APP_LOG_DIR ?? path.join(artifactDir, "app-log");

const keyEvents = [
  "channel.user_message.start",
  "dialogue_gateway.handle_input.start",
  "context.assemble.done",
  "planner.form_frame.done",
  "planner.form_micro_plan.done",
  "dialogue_gateway.handle_input.done",
  "channel.user_message.done",
];
const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';

fs.mkdirSync(artifactDir, { recursive: true });

const frames = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

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
  if (decoded) {
    frames.push({ direction, ...decoded });
    if (direction === "received" && decoded.event === "turn_result") {
      page
        .evaluate(() => {
          window.__vs10TurnResultReceived = true;
        })
        .catch(() => {});
    }
  }
}

function jsonlPath() {
  const localDate = new Date();
  const today = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
  return path.join(appLogDir, `${today}.jsonl`);
}

function readAppLogRecords() {
  const file = jsonlPath();
  if (!fs.existsSync(file)) return [];

  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function eventuallyReadKeyRecords(turnId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const records = readAppLogRecords();
    const turnRecords = records.filter((record) => record.turn_id === turnId);

    if (keyEvents.every((event) => turnRecords.some((record) => record.event === event))) {
      return turnRecords;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const records = readAppLogRecords();
  throw new Error(
    `Timed out waiting for VS-10 log events for turn ${turnId}; got ${JSON.stringify(
      records.map((record) => ({ event: record.event, turn_id: record.turn_id })),
    )}`,
  );
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
  await page
    .getByText(/^服务: 已连接/)
    .first()
    .waitFor({ timeout: 30_000 });

  await page.getByText("打开档案", { exact: false }).click();
  await page.getByRole("button", { name: "发起伏笔调整" }).click();

  await page.waitForFunction(() => window.__vs10TurnResultReceived === true, { timeout: 30_000 });

  const turnResultFrame = frames.find(
    (frame) => frame.direction === "received" && frame.event === "turn_result",
  );

  assert(turnResultFrame, "No turn_result Phoenix frame was received by the workbench");
  assert(turnResultFrame.body?.turn_id, "turn_result did not include turn_id");

  const turnId = turnResultFrame.body.turn_id;
  const records = await eventuallyReadKeyRecords(turnId);

  for (const event of keyEvents) {
    const record = records.find((candidate) => candidate.event === event);
    assert(record, `Missing app log event ${event}`);
    assert(record.turn_id === turnId, `${event} has wrong turn_id: ${record.turn_id}`);
    assert(record.workspace_id, `${event} is missing workspace_id`);
    assert(record.work_id, `${event} is missing work_id`);
    assert(typeof record.duration_ms === "number", `${event} is missing duration_ms`);
    assert(record.outcome, `${event} is missing outcome`);
  }

  fs.writeFileSync(path.join(artifactDir, "frames.json"), JSON.stringify(frames, null, 2));
  fs.writeFileSync(
    path.join(artifactDir, "turn-result.json"),
    JSON.stringify(turnResultFrame.body, null, 2),
  );
  fs.writeFileSync(path.join(artifactDir, "app-log.json"), JSON.stringify(records, null, 2));
  await page.screenshot({
    path: path.join(artifactDir, "vs10-observability-spine.png"),
    fullPage: true,
  });
} catch (error) {
  await page.screenshot({
    path: path.join(artifactDir, "failure.png"),
    fullPage: true,
  });
  fs.writeFileSync(path.join(artifactDir, "frames.json"), JSON.stringify(frames, null, 2));
  fs.writeFileSync(
    path.join(artifactDir, "app-log.json"),
    JSON.stringify(readAppLogRecords(), null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
