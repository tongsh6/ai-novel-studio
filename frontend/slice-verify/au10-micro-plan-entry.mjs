import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5768";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "slice-verify", "au10-micro-plan-entry");

fs.mkdirSync(artifactDir, { recursive: true });

const frames = [];
const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';

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

function recordFrame(payload) {
  const decoded = decodePhoenixFrame(payload);
  if (decoded) frames.push(decoded);
}

async function waitForUserMessage(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const message = frames
      .filter((frame) => frame.event === "user_message" && frame.topic.startsWith("workspace:"))
      .find(predicate);

    if (message) return message;
    await page.waitForTimeout(100);
  }

  return null;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("websocket", (ws) => {
  ws.on("framesent", (event) => recordFrame(event.payload));
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

  const lastMessage = await waitForUserMessage(
    (frame) => frame.body?.text === "我想调整或新增伏笔",
    10_000,
  );

  assert(lastMessage, "No user_message Phoenix frame was sent from the workbench");
  assert(
    lastMessage.body?.generate_micro_plan === true,
    `Expected generate_micro_plan=true, got ${JSON.stringify(lastMessage.body)}`,
  );
  assert(
    lastMessage.body?.text === "我想调整或新增伏笔",
    `Expected panel action text, got ${JSON.stringify(lastMessage.body?.text)}`,
  );

  fs.writeFileSync(path.join(artifactDir, "frames.json"), JSON.stringify(frames, null, 2));
  await page.screenshot({
    path: path.join(artifactDir, "au10-micro-plan-entry.png"),
    fullPage: true,
  });
} catch (error) {
  await page.screenshot({
    path: path.join(artifactDir, "failure.png"),
    fullPage: true,
  });
  fs.writeFileSync(path.join(artifactDir, "frames.json"), JSON.stringify(frames, null, 2));
  throw error;
} finally {
  await browser.close();
}
