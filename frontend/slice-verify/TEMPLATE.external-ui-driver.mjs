import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// Copy this file for a new slice driver.
// Keep the driver outside product code. Do not add product-only data-testid,
// slice-specific data-* attributes, autorun flags, or UI-state reporting events.

const sliceId = process.argv[2];
const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5769";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "slice-verify", sliceId ?? "unknown");

if (!sliceId) {
  throw new Error("Usage: node slice-verify/<driver>.mjs <slice-id>");
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

async function writeArtifacts(page, records, screenshotName) {
  fs.writeFileSync(path.join(artifactDir, "ui-frames.json"), JSON.stringify(frames, null, 2));
  fs.writeFileSync(path.join(artifactDir, "ui-state.json"), JSON.stringify(records, null, 2));
  await page.screenshot({
    path: path.join(artifactDir, screenshotName),
    fullPage: true,
  });
}

async function waitForWorkbench(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Prefer visible product semantics: role, label, placeholder, button text,
  // and visible status text. Do not add hooks to product code for this.
  await page
    .getByPlaceholder("输入你的想法、问题或指令...")
    .waitFor({ timeout: 30_000 });
  await page.getByText(/^服务:/).first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () => document.body.innerText.includes("服务: 已连接"),
    { timeout: 30_000 },
  );
}

async function driveScenario(page) {
  // Replace this with the slice scenario:
  // 1. Fill visible fields.
  // 2. Click visible controls by role/name.
  // 3. Wait for product-visible feedback and network frames.
  // 4. Assert business-visible outcome.
  //
  // Example shape:
  // await page.getByPlaceholder("输入你的想法、问题或指令...").fill("...");
  // await page.getByRole("button", { name: /^发送$/ }).click();
  // await page.waitForFunction(() => document.body.innerText.includes("..."));

  const visibleText = await page.locator("body").innerText();
  assert(visibleText.length > 0, "Workbench did not render visible text");

  return [
    {
      event: "external_ui_driver.placeholder",
      slice_id: sliceId,
      visible_text_sample: visibleText.slice(0, 300),
      websocket_frame_count: frames.length,
    },
  ];
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("websocket", (ws) => {
  ws.on("framesent", (event) => recordFrame("sent", event.payload));
  ws.on("framereceived", (event) => recordFrame("received", event.payload));
});

try {
  await waitForWorkbench(page);
  const records = await driveScenario(page);
  await writeArtifacts(page, records, `${sliceId}-external-ui.png`);
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
