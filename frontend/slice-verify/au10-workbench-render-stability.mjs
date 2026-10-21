// AU10 CP0 render-stability baseline driver (browser surface).
//
// External measurement only: this script injects observers through Playwright
// (page.addInitScript / page.evaluate). It does not add product hooks, data-*,
// env switches or any acceptance-aware branch to frontend/src.
//
// Usage (normally via scripts/slice_verify.sh):
//   SLICE_VERIFY_BASE_URL=http://127.0.0.1:5768 \
//   SLICE_VERIFY_ARTIFACT_DIR=artifacts/slice-verify/au10-workbench-render-stability \
//   node frontend/slice-verify/au10-workbench-render-stability.mjs
//
// CP0 records baseline numbers against the frozen thresholds in
// tasks/slices/AU10-workbench-render-stability.md. Threshold violations are
// reported in the artifact (baseline verdict), not thrown: CP0's job is to
// measure before changing code.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5768";
const artifactDir =
  process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "slice-verify", "au10-workbench-render-stability");

fs.mkdirSync(artifactDir, { recursive: true });

const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';

const frames = [];
const sceneErrors = [];
let navigationCount = 0;

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
  if (decoded) frames.push({ direction, ...decoded, at: Date.now() });
}

const OBSERVER_SCRIPT = () => {
  const state = {
    samples: [],
    marks: [],
    layoutShifts: [],
    nodeEvents: [],
    userScrollTouchedAt: 0,
    startedAt: performance.now(),
  };

  const mark = (name) => {
    state.marks.push({ name, at: performance.now() });
  };

  const currentMessageNodes = () =>
    Array.from(
      document.querySelectorAll('[class*="userMsg"], [class*="assistantMsg"]'),
    ).filter((node) => (node.innerText ?? "").trim().length > 0);

  let previousNodes = new Map();
  let nodeSeq = 0;
  const nodeIds = new WeakMap();
  const idOf = (node) => {
    if (!nodeIds.has(node)) nodeIds.set(node, (nodeSeq += 1));
    return nodeIds.get(node);
  };

  const sample = () => {
    const chat = document.querySelector('[class*="chatArea"]');
    const inputArea = document.querySelector('[class*="inputArea"]');
    const composer = document.querySelector(
      '[class*="standardComposer"], [class*="agentRunWorkspace"]',
    );
    const composerRail = document.querySelector('[class*="composerRail"]');
    const nodes = currentMessageNodes();
    const nodeEntries = nodes.map((node) => ({
      id: idOf(node),
      text: (node.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    }));

    const nextNodes = new Map();
    const currentTexts = new Set(nodeEntries.map((entry) => entry.text));
    let detached = 0;
    let remounts = 0;
    for (const entry of nodeEntries) nextNodes.set(entry.id, entry);
    for (const [id, entry] of previousNodes.entries()) {
      if (!nextNodes.has(id)) {
        detached += 1;
        // 同一可见文本在下一帧换了 DOM 节点 = 真正的消息 remount（失败）。
        // 占位文案被最终内容替换（文本不同）只记 detached，不算 remount。
        if (currentTexts.has(entry.text)) remounts += 1;
        if (state.nodeEvents.length < 200) {
          state.nodeEvents.push({
            at: performance.now(),
            kind: remounts > 0 ? "remount" : "detached",
            id,
            text: entry.text,
          });
        }
      }
    }
    previousNodes = nextNodes;

    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Number(r.x.toFixed(1)),
        y: Number(r.y.toFixed(1)),
        width: Number(r.width.toFixed(1)),
        height: Number(r.height.toFixed(1)),
      };
    };

    state.samples.push({
      at: performance.now(),
      navEntries: performance.getEntriesByType("navigation").length,
      messageCount: nodes.length,
      detached,
      remounts,
      chatRect: rect(chat),
      inputRect: rect(inputArea),
      composerRect: rect(composer),
      composerRailRect: rect(composerRail),
      chatTextLength: chat ? (chat.innerText ?? "").trim().length : 0,
      chatScrollTop: chat ? Number(chat.scrollTop.toFixed(1)) : null,
      chatScrollHeight: chat ? chat.scrollHeight : null,
      lastUserScrollTouchedAt: state.userScrollTouchedAt,
    });

    if (state.samples.length > 30_000) state.samples.shift();
    requestAnimationFrame(sample);
  };

  const markUserScrollIntent = () => {
    state.userScrollTouchedAt = performance.now();
  };
  window.addEventListener("wheel", markUserScrollIntent, { passive: true });
  window.addEventListener("touchmove", markUserScrollIntent, { passive: true });
  // AU10 CP1：作者点击「发送」等 pointer 操作属于用户触发；滚动指标只应惩罚
  // 非用户意图的位移，否则会把「发消息后回到底部」误判成抢滚动。
  window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
  window.addEventListener("click", markUserScrollIntent, true);
  window.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      state.userScrollTouchedAt = performance.now();
    }
  });

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        state.layoutShifts.push({
          at: entry.startTime,
          value: entry.value,
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // layout-shift is Chromium-only; absence is recorded as null later.
  }

  window.__au10 = { state, mark };
  requestAnimationFrame(sample);
};

function scene(name) {
  return { name, startedAt: Date.now(), errors: [], marks: {} };
}

async function mark(page, name) {
  await page.evaluate((markName) => window.__au10?.mark(markName), name);
}

async function waitForReady(page) {
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page
    .getByText(/服务: 已连接|同步已连接/)
    .first()
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
}

async function waitForAnyMessage(page, timeout = 30_000) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[class*="userMsg"], [class*="assistantMsg"]').length > 0,
    { timeout },
  );
}

function turnResultCount() {
  return frames.filter(
    (frame) => frame.direction === "received" && frame.event === "turn_result",
  ).length;
}

async function waitForTurnResult(timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (turnResultCount() > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function waitForNewTurnResult(afterCount, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (turnResultCount() > afterCount) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function maxConsecutiveDelta(values) {
  let max = 0;
  for (let i = 1; i < values.length; i += 1) {
    const a = values[i - 1];
    const b = values[i];
    if (a === null || b === null) continue;
    max = Math.max(max, Math.abs(b - a));
  }
  return Number(max.toFixed(2));
}

function computeMetrics({ samples, layoutShifts, nodeEvents }) {
  const messageCounts = samples.map((sample) => sample.messageCount);
  const chatHeights = samples.map((sample) => sample.chatRect?.height ?? null);
  const inputHeights = samples.map((sample) => sample.inputRect?.height ?? null);
  const composerHeights = samples.map((sample) => sample.composerRailRect?.height ?? null);
  const scrollTops = samples.map((sample) => sample.chatScrollTop);

  let blankFrames = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i - 1].messageCount > 0 && samples[i].messageCount === 0) blankFrames += 1;
  }

  let scrollJumpsWithoutInput = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    const recentUserInput =
      current.lastUserScrollTouchedAt > 0 &&
      current.at - current.lastUserScrollTouchedAt < 1_500;
    if (recentUserInput) continue;
    if (previous.chatScrollTop === null || current.chatScrollTop === null) continue;
    if (Math.abs(current.chatScrollTop - previous.chatScrollTop) > 4) {
      scrollJumpsWithoutInput += 1;
    }
  }

  const remounts = samples.reduce((sum, sample) => sum + (sample.remounts ?? 0), 0);

  return {
    sampleCount: samples.length,
    messageCountRange:
      messageCounts.length > 0
        ? [Math.min(...messageCounts), Math.max(...messageCounts)]
        : [null, null],
    sameTextRemounts: remounts,
    detachedNodeEvents: nodeEvents.length,
    blankFrames,
    scrollJumpsWithoutInput,
    cumulativeLayoutShift: Number(
      layoutShifts.reduce((sum, shift) => sum + shift.value, 0).toFixed(4),
    ),
    maxChatHeightDelta: maxConsecutiveDelta(chatHeights),
    maxInputHeightDelta: maxConsecutiveDelta(inputHeights),
    maxComposerHeightDelta: maxConsecutiveDelta(composerHeights),
    maxScrollTopDelta: maxConsecutiveDelta(scrollTops),
  };
}

async function recordScene(name, page, fn, { before, after } = {}) {
  const item = scene(name);
  try {
    if (before) await before();
    await mark(page, `${name}:start`);
    await fn();
    await page.waitForTimeout(1_500);
    await mark(page, `${name}:end`);
    if (after) await after();
    await page.screenshot({
      path: path.join(artifactDir, `${name}.png`),
      fullPage: false,
    });

    const extracted = await page.evaluate((sceneName) => {
      const state = window.__au10?.state;
      if (!state) return { samples: [], layoutShifts: [], nodeEvents: [] };
      const start = state.marks.find((entry) => entry.name === `${sceneName}:start`)?.at ?? -Infinity;
      const end = state.marks.find((entry) => entry.name === `${sceneName}:end`)?.at ?? Infinity;
      const within = (at) => at >= start && at <= end;
      const payload = {
        samples: state.samples.filter((entry) => within(entry.at)),
        layoutShifts: state.layoutShifts.filter((entry) => within(entry.at)),
        nodeEvents: state.nodeEvents.filter((entry) => within(entry.at)),
      };
      state.samples = [];
      state.layoutShifts = [];
      state.nodeEvents = [];
      state.marks = [];
      return payload;
    }, name);

    item.metrics = computeMetrics(extracted);
    item.nodeEvents = extracted.nodeEvents;
  } catch (error) {
    item.errors.push(error instanceof Error ? error.message : String(error));
    sceneErrors.push({ scene: name, error: item.errors[item.errors.length - 1] });
    try {
      item.debug = await page.evaluate(() => {
        const input = document.querySelector('input[placeholder]');
        const bodyText = (document.body.innerText ?? "").replace(/\s+/g, " ").slice(0, 800);
        return {
          inputDisabled: input ? input.disabled : null,
          inputPlaceholder: input ? input.placeholder : null,
          chatInput: Array.from(document.querySelectorAll("input")).map((element) => ({
            placeholder: element.placeholder,
            disabled: element.disabled,
            type: element.type,
          })),
          bodyText,
        };
      });
      await page.screenshot({
        path: path.join(artifactDir, `${name}-error.png`),
        fullPage: false,
      });
    } catch {
      // diagnostics are best-effort
    }
  }
  item.durationMs = Date.now() - item.startedAt;
  return item;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("websocket", (ws) => {
  ws.on("framesent", (event) => recordFrame("sent", event.payload));
  ws.on("framereceived", (event) => recordFrame("received", event.payload));
});
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) navigationCount += 1;
});
page.on("pageerror", (error) => {
  sceneErrors.push({ scene: "pageerror", error: error.message });
});

await page.addInitScript(OBSERVER_SCRIPT);
await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
await waitForReady(page);

const scenes = [];

// Scene 1: cold start (initial mount) — sample a stable window.
scenes.push(
  await recordScene("s1-cold-start", page, async () => {
    await page.waitForTimeout(2_000);
  }),
);

// Scene 2: send message / AgentRun control area appears.
scenes.push(
  await recordScene(
    "s2-send-agentrun",
    page,
    async () => {
      await page.locator(chatInputSelector).fill("我想写一个赛博修仙方向");
      await page.getByRole("button", { name: /^发送$/ }).click();
      const gotTurn = await waitForTurnResult(90_000);
      if (!gotTurn) throw new Error("turn_result not received within 90s");
      await waitForAnyMessage(page);
      await page.waitForTimeout(1_000);
    },
    { after: async () => waitForReady(page) },
  ),
);

// Scene 3: session restore — reload after transcript exists.
let messageCountBeforeReload = 0;
try {
  messageCountBeforeReload = await page.evaluate(
    () => document.querySelectorAll('[class*="userMsg"], [class*="assistantMsg"]').length,
  );
} catch {
  messageCountBeforeReload = 0;
}

scenes.push(
  await recordScene(
    "s3-session-restore",
    page,
    async () => {
      await waitForReady(page);
      await waitForAnyMessage(page);
      await page.waitForTimeout(2_000);
    },
    {
      before: async () => {
        if (messageCountBeforeReload === 0) throw new Error("no transcript to restore");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      },
    },
  ),
);

// Scene 4: archive rail open/close geometry.
scenes.push(
  await recordScene("s4-archive-open", page, async () => {
    const archiveButton = page.getByRole("button", { name: "打开档案" });
    await archiveButton.waitFor({ timeout: 10_000 });
    await archiveButton.click();
    await page.getByText("作品档案").first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(2_000);
    const closeArchive = page.getByRole("button", { name: "关闭档案" });
    if (await closeArchive.isVisible().catch(() => false)) {
      await closeArchive.click();
    }
    await page.waitForTimeout(800);
  }),
);

// Scene 5: reconnect — offline/online around the same work/session.
scenes.push(
  await recordScene("s5-reconnect", page, async () => {
    await context.setOffline(true);
    await page.waitForTimeout(1_200);
    await context.setOffline(false);
    await page.waitForTimeout(2_500);
    await waitForReady(page);
  }),
);

// Scene 6: work switch between two content-bearing works.
// Creation + first message in the new work are preparation (not measured); the
// measured window is the real switch back to a work that already has content.
scenes.push(
  await recordScene(
    "s6-work-switch",
    page,
    async () => {
      await page.locator('button[title="作品"]').click();
      await page.getByRole("menuitem", { name: /Slice Verify Work/ }).click();
      await page.waitForTimeout(1_200);
    },
    {
      before: async () => {
        const archiveClose = page.getByRole("button", { name: "关闭档案" });
        if (await archiveClose.isVisible().catch(() => false)) await archiveClose.click();
        await page.locator('button[title="作品"]').click();
        await page.getByText("新建作品").click();
        await page.locator("#work-title-input").fill("AU10 Render Baseline Work");
        await page.getByRole("button", { name: "创建" }).click();
        await page.waitForFunction(
          (selector) => {
            const input = document.querySelector(selector);
            return input && !input.disabled;
          },
          chatInputSelector,
          { timeout: 30_000 },
        );
        const turnResultsBefore = turnResultCount();
        await page.locator(chatInputSelector).fill("第二部作品里写一个测试方向");
        await page.getByRole("button", { name: /^发送$/ }).click();
        const gotNewTurn = await waitForNewTurnResult(turnResultsBefore, 90_000);
        if (!gotNewTurn) throw new Error("second-work turn_result not received within 90s");
        await page.waitForTimeout(800);
      },
    },
  ),
);

const sceneMetrics = {};
for (const item of scenes) {
  sceneMetrics[item.name] = item.metrics ?? computeMetrics({ samples: [], layoutShifts: [], nodeEvents: [] });
}

const thresholds = {
  documentReloads: 0,
  blankFrames: 0,
  sameTextRemounts: 0,
  detachedExistingMessages: 0,
  scrollJumpsWithoutInput: 0,
  maxRegionHeightDeltaPx: 2,
  cumulativeLayoutShift: 0.1,
};

const violations = [];
const compare = (sceneName, metric, value, limit, comparator) => {
  if (value === null || value === undefined) return;
  const failed = comparator === "gt" ? value > limit : value !== limit;
  if (failed) violations.push({ scene: sceneName, metric, value, limit, comparator });
};

for (const [sceneName, metrics] of Object.entries(sceneMetrics)) {
  compare(sceneName, "blankFrames", metrics.blankFrames, thresholds.blankFrames, "gt");
  // 作品切换会按设计整体替换两个作品的消息内容（旧内容卸载、新内容挂载）；
  // 该场景的 same-text 复现不是 remount 失败，blank/mixed 才是失败线。
  if (sceneName !== "s6-work-switch") {
    compare(
      sceneName,
      "sameTextRemounts",
      metrics.sameTextRemounts,
      thresholds.sameTextRemounts,
      "gt",
    );
  }
  compare(
    sceneName,
    "scrollJumpsWithoutInput",
    metrics.scrollJumpsWithoutInput,
    thresholds.scrollJumpsWithoutInput,
    "gt",
  );
  compare(
    sceneName,
    "maxChatHeightDelta",
    metrics.maxChatHeightDelta,
    thresholds.maxRegionHeightDeltaPx,
    "gt",
  );
  compare(
    sceneName,
    "maxInputHeightDelta",
    metrics.maxInputHeightDelta,
    thresholds.maxRegionHeightDeltaPx,
    "gt",
  );
  compare(
    sceneName,
    "maxComposerHeightDelta",
    metrics.maxComposerHeightDelta,
    thresholds.maxRegionHeightDeltaPx,
    "gt",
  );
  compare(
    sceneName,
    "cumulativeLayoutShift",
    metrics.cumulativeLayoutShift,
    thresholds.cumulativeLayoutShift,
    "gt",
  );
}

const summary = {
  surface: "browser",
  generatedAt: new Date().toISOString(),
  baseUrl,
  cp0Protocol: "tasks/slices/AU10-workbench-render-stability.md · CP0 基线协议",
  thresholds,
  navigationCount,
  scenes: scenes.map((item) => ({
    ...item,
    metrics: sceneMetrics[item.name] ?? null,
  })),
  sceneErrors,
  violations,
  nodeEvents: scenes.flatMap((item) =>
    (item.nodeEvents ?? []).map((event) => ({ scene: item.name, ...event })),
  ),
  verdict: violations.length === 0 ? "baseline-within-threshold" : "baseline-violations-recorded",
  notes: [
    "CP0 baseline only: violations are expected findings, not pass claims.",
    "Thresholds frozen in AU10 slice CP0 protocol; CP1 targets the recorded violations.",
    "Work-switch scene creates a second work, gives it content, then switches back; content replacement detaches nodes by design — blank frame / mixed state are the failure lines there.",
    "Placeholder narration nodes replaced by final turn content are counted as detached (info), not same-text remounts.",
  ],
};

fs.writeFileSync(
  path.join(artifactDir, "render-baseline.json"),
  JSON.stringify(summary, null, 2),
);

const lines = [
  "# AU10 CP0 render-stability baseline (browser surface)",
  "",
  `Generated: ${summary.generatedAt}`,
  `Verdict: ${summary.verdict}`,
  `Navigations observed: ${summary.navigationCount}`,
  "",
  "| scene | samples | remounts | detached (info) | blank frames | scroll jumps (no input) | CLS | chat Δh | input Δh | composer Δh |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
];

for (const [sceneName, metrics] of Object.entries(sceneMetrics)) {
  lines.push(
    `| ${sceneName} | ${metrics.sampleCount} | ${metrics.sameTextRemounts} | ${metrics.detachedNodeEvents} | ${metrics.blankFrames} | ` +
      `${metrics.scrollJumpsWithoutInput} | ${metrics.cumulativeLayoutShift} | ` +
      `${metrics.maxChatHeightDelta} | ${metrics.maxInputHeightDelta} | ${metrics.maxComposerHeightDelta} |`,
  );
}

if (violations.length > 0) {
  lines.push("", "## Violations against frozen thresholds");
  for (const violation of violations) {
    lines.push(
      `- ${violation.scene} · ${violation.metric} = ${violation.value} (limit ${violation.limit})`,
    );
  }
}

if (sceneErrors.length > 0) {
  lines.push("", "## Scene errors");
  for (const error of sceneErrors) {
    lines.push(`- ${error.scene}: ${error.error}`);
  }
}

fs.writeFileSync(path.join(artifactDir, "render-baseline.md"), lines.join("\n") + "\n");

console.log(
  `[au10-cp0] ${summary.verdict}: scenes=${scenes.length} violations=${violations.length} errors=${sceneErrors.length}`,
);
for (const violation of violations.slice(0, 20)) {
  console.log(
    `[au10-cp0] ${violation.scene} ${violation.metric}=${violation.value} (limit ${violation.limit})`,
  );
}
for (const error of sceneErrors) {
  console.log(`[au10-cp0] scene-error ${error.scene}: ${error.error}`);
}

// The measurement is complete once artifacts are written. Chromium close can
// occasionally wait on a disconnected socket; do not let it hold slice_verify.
process.exit(0);
