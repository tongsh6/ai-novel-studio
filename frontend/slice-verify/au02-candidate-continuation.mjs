import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5768";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "slice-verify", "au02-candidate-continuation");

fs.mkdirSync(artifactDir, { recursive: true });

const frames = [];
const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  if (decoded) frames.push({ direction, ...decoded });
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

  await page.locator(chatInputSelector).fill("我想写一个赛博修仙方向");
  await page.getByRole("button", { name: /^发送$/ }).click();
  await page
    .getByRole("button", { name: /继续聊这个方向/ })
    .first()
    .waitFor({
      timeout: 30_000,
    });
  const frameBadge = page.getByText("探索方向").first();
  await frameBadge.waitFor({ timeout: 10_000 });
  const frameBadgeLabel = (await frameBadge.innerText()).trim();

  const firstTurnResult = frames.find(
    (frame) => frame.direction === "received" && frame.event === "turn_result",
  )?.body;
  const firstCandidate = page.getByRole("button", { name: /继续聊这个方向/ }).first();
  const candidateRef = firstTurnResult?.candidate_directions?.[0]?.direction_id;
  await firstCandidate.click();

  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return text.includes("继续聊") && text.includes("这个方向");
    },
    { timeout: 10_000 },
  );

  await page.waitForTimeout(1_000);

  const sentMessages = frames.filter(
    (frame) => frame.direction === "sent" && frame.event === "user_message",
  );
  const candidateMessage = sentMessages.find((frame) => frame.body?.candidate_selection);
  const receivedTurnResults = frames.filter(
    (frame) => frame.direction === "received" && frame.event === "turn_result",
  );
  const lastTurnResult = receivedTurnResults[receivedTurnResults.length - 1]?.body;

  assert(candidateRef, "Candidate button did not expose candidate ref");
  assert(frameBadgeLabel === "探索方向", `Exploration frame badge missing: ${frameBadgeLabel}`);
  assert(candidateMessage, "Candidate continuation did not send candidate_selection");
  assert(
    candidateMessage.body.generate_micro_plan === false,
    `Candidate continuation must stay dialogue-only, got ${JSON.stringify(candidateMessage.body)}`,
  );
  assert(
    candidateMessage.body.candidate_selection?.candidate_ref === candidateRef,
    `Candidate ref mismatch: ${JSON.stringify(candidateMessage.body.candidate_selection)}`,
  );
  assert(
    candidateMessage.body.candidate_selection?.source_turn_ref,
    "Candidate selection did not include source_turn_ref",
  );
  assert(lastTurnResult, "No turn_result received after candidate continuation");
  assert(
    lastTurnResult.truthfulness?.artifact_adopted === false,
    `Candidate continuation must not adopt artifacts: ${JSON.stringify(lastTurnResult.truthfulness)}`,
  );
  assert(
    lastTurnResult.truthfulness?.production_write_performed === false,
    `Candidate continuation must not write production state: ${JSON.stringify(lastTurnResult.truthfulness)}`,
  );

  const summary = {
    candidate_ref: candidateRef,
    frame_badge_label: frameBadgeLabel,
    source_turn_ref: candidateMessage.body.candidate_selection.source_turn_ref,
    continuation_turn_id: lastTurnResult.turn_id,
    artifact_adopted: lastTurnResult.truthfulness.artifact_adopted,
    production_write_performed: lastTurnResult.truthfulness.production_write_performed,
  };

  fs.writeFileSync(path.join(artifactDir, "frames.json"), JSON.stringify(frames, null, 2));
  fs.writeFileSync(path.join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
  await page.screenshot({
    path: path.join(artifactDir, "au02-candidate-continuation.png"),
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
