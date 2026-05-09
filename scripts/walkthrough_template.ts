/**
 * 产品体验走查模板 — Playwright GUI 自动化
 *
 * 用法：
 *   1. 启动服务：bash scripts/dev.sh --web
 *   2. 确保 LM Studio 已启动并加载模型
 *   3. 执行走查：npx tsx scripts/walkthrough_template.ts
 *
 * 依赖：playwright（npm install -D playwright）
 */

import { chromium, type Page } from "playwright";
import * as fs from "fs";

const BASE = "http://localhost:5768";
const LLM_TIMEOUT = 90_000; // 模型响应可能较慢
const SCREENSHOT_DIR = "walkthroughs/latest";

// 确保截图目录存在
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

/** 发送消息并等待 AI 回复 */
async function sendMessage(
  page: Page,
  name: string,
  text: string
): Promise<void> {
  console.log(`\n[${name}] 输入: ${text}`);
  const t0 = Date.now();

  // 获取当前的最后一条回复内容（作为差异对比基准）
  const prevLastReply = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-role="assistant"]');
    return msgs[msgs.length - 1]?.textContent || "";
  });

  // 清空并输入
  const input = page.locator("input, textarea").first();
  await input.fill(text);
  await page.locator("button").filter({ hasText: "发送" }).click();

  // 等待新消息出现（需要满足：1. 思考中状态消失；2. 最后一条消息内容发生变化）
  try {
    await page.waitForFunction(
      (prev) => {
        const asstMsgs = document.querySelectorAll('[data-role="assistant"]');
        const last = asstMsgs[asstMsgs.length - 1];
        if (!last) return false;
        
        const isThinking = last.getAttribute('data-status') === 'thinking';
        const currentText = last.textContent || "";
        
        // 判定成功：不再处于思考中，且内容与上一轮不同，且内容不为空
        return !isThinking && currentText !== prev && currentText.length > 5;
      },
      { timeout: LLM_TIMEOUT },
      prevLastReply
    );
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ⏱  ${elapsed}s`);

    // 提取最新 AI 回复
    const reply = await page.evaluate(() => {
      const msgs = Array.from(document.querySelectorAll('[data-role="assistant"]'));
      const last = msgs[msgs.length - 1];
      const textEl = last?.querySelector('[class*="text"]');
      return textEl?.textContent?.trim().slice(0, 120) ?? "";
    });
    console.log(`  💬 ${reply || "(空)"}`);

    // 截图
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${name}.png`,
      fullPage: true,
    });
    check(name, reply.length > 5, `${reply.slice(0, 50)}`);
  } catch {
    // 失败时截图便于分析
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${name}-timeout.png`,
      fullPage: true,
    });
    check(name, false, "AI 回复超时");
  }
}

(async () => {
  console.log("=== AI Novel Studio 产品体验走查 ===\n");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(BASE, { timeout: 15_000 });

  // 页面加载验证
  const title = await page.title();
  check("页面标题", title === "AI Novel Studio", title);

  // WebSocket 连接验证 (寻找 data-status="ok")
  try {
    await page.waitForFunction(
      () => document.querySelector('[data-status="ok"]') !== null,
      { timeout: 15_000 },
    );
    check("WebSocket 已连接", true);
  } catch {
    check("WebSocket 已连接", false);
  }

  // ============================================================
  // 走查路线
  // ============================================================

  await sendMessage(page, "step-01", "你好，我想开始写小说");
  await sendMessage(page, "step-02", "帮我构思一个主角");
  await sendMessage(page, "step-03", "帮我写第一章开头");

  // ============================================================

  await browser.close();

  console.log(`\n=== 结果 ===`);
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);
  console.log(`截图: ${SCREENSHOT_DIR}/`);

  if (failed > 0) process.exit(1);
})();
