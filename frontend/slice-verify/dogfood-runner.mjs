// P1-100k-dogfood-run 长跑 driver（docs/product/novel-output-milestones.md §7 #6）。
//
// 外部 Playwright 站在产品之外，像作者一样操作真实工作台逐章推进：
//   读阅读投影找未达标章 → 对话框自然语言「写第NN章首稿 / 接着往下写」→ 确认创建采纳
//   → 循环直到全部章 ≥ min-words（或本次 --chapters 限额）→ 阅读模式导出全书
// 产物落 artifacts/novel-output/p1-100k-dogfood/（summary/word-count/chapter-quality/
// continuity/export/progress.jsonl）。产品代码无任何狗粮感知逻辑。
//
// 用法（由 scripts/dogfood_run.sh 启动）：
//   node slice-verify/dogfood-runner.mjs
// 环境变量：
//   SLICE_VERIFY_BASE_URL   工作台地址
//   DOGFOOD_ARTIFACT_DIR    产物目录
//   DOGFOOD_MAX_CHAPTERS    本次最多推进的章数（0 = 不限）
//   DOGFOOD_MIN_WORDS       每章有效字数下限（默认 1000）
//   DOGFOOD_TARGET_WORDS    全书目标有效字数（0 = 不扩章；>0 时全部章达标而总字数
//                           未达标则自动发增量规划指令扩章，消费 p1-plan-incremental 链）
//   DOGFOOD_PROVIDER        slice_verify | lmstudio（仅记录进 summary）
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5769";
const artifactDir =
  process.env.DOGFOOD_ARTIFACT_DIR ??
  path.resolve("..", "artifacts", "novel-output", "p1-100k-dogfood");
const maxChapters = Number(process.env.DOGFOOD_MAX_CHAPTERS ?? "0");
const minWords = Number(process.env.DOGFOOD_MIN_WORDS ?? "1000");
const targetWords = Number(process.env.DOGFOOD_TARGET_WORDS ?? "0");
const provider = process.env.DOGFOOD_PROVIDER ?? "lmstudio";
const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';

fs.mkdirSync(artifactDir, { recursive: true });
fs.mkdirSync(path.join(artifactDir, "export"), { recursive: true });
const progressPath = path.join(artifactDir, "progress.jsonl");

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

// fromIndex：只匹配该下标之后到达的帧。长跑会话里历史帧大量累积（含旧轮的
// needs_confirmation / pending），不限定起点会误匹配历史帧、走错分支。
async function waitForFrame(predicate, message, timeoutMs = 60_000, fromIndex = 0) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = frames.slice(fromIndex).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(message);
}

function log(message) {
  console.log(`[dogfood] ${new Date().toISOString()} ${message}`);
}

function appendProgress(entry) {
  fs.appendFileSync(
    progressPath,
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  );
}

// 进入阅读模式触发 get_toc，取最新投影后返回工作台。
async function readToc(page) {
  const before = frames.length;
  await page.getByRole("button", { name: /\[阅读模式\]/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes("阅读模式"), null, {
    timeout: 15_000,
  });

  const started = Date.now();
  let resp = null;
  while (Date.now() - started < 20_000) {
    const match = frames
      .slice(before)
      .find(
        (frame) =>
          frame.direction === "received" &&
          Array.isArray((frame.body?.response ?? frame.body)?.volumes),
      );
    if (match) {
      resp = match.body?.response ?? match.body;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!resp) throw new Error("No get_toc projection frame after entering reading mode");

  // 异常恢复路径下页面状态可能不在预期（残卡/弹层），点击失败不立即抛——
  // 以下一行「对话输入框可见」为准（仍不可见则诚实失败）。
  await page
    .getByRole("button", { name: "返回工作台" })
    .click({ timeout: 10_000 })
    .catch(() => {});
  await page.locator(chatInputSelector).waitFor({ timeout: 10_000 });
  return resp;
}

function flatChapters(toc) {
  return (toc?.volumes ?? []).flatMap((volume) => volume.chapters ?? []);
}

function nextPendingChapter(toc, skippedTitles) {
  return (
    flatChapters(toc).find(
      (chapter) => Number(chapter.word_count ?? 0) < minWords && !skippedTitles.has(chapter.title),
    ) ?? null
  );
}

async function adoptPendingDraft(page, chapterTitle, fromIndex) {
  const freshProse = (f) =>
    f.direction === "received" &&
    f.event === "turn_result" &&
    f.body?.tool_result?.tool_name === "prose_writing" &&
    f.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment";

  // 系统可能把指令判为高风险（如重写语义）并出确认卡（AU-04）；
  // runner 像真实作者一样点「确认执行」，re-gate 后继续等正文产出。
  // 所有帧匹配从本轮发送之后开始（fromIndex），不与历史轮串。
  let draftFrame = await waitForFrame(
    (f) =>
      freshProse(f) ||
      (f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.status === "needs_confirmation" &&
        (f.body?.available_actions ?? []).some(
          (action) => action.action_type === "confirm_before_execute",
        )),
    `No prose_fragment or confirmation turn_result for ${chapterTitle}`,
    300_000,
    fromIndex,
  );

  if (draftFrame.body?.status === "needs_confirmation") {
    log(`${chapterTitle}: confirmation required — confirming execution`);
    await page.waitForFunction(() => document.body.innerText.includes("确认执行"), null, {
      timeout: 15_000,
    });
    // 失败重试可能在页面留下多张卡：永远点最新一张（消息流尾部）。
    await page.getByRole("button", { name: "确认执行" }).last().click();
    draftFrame = await waitForFrame(
      freshProse,
      `No prose_fragment turn_result after confirmation for ${chapterTitle}`,
      300_000,
      fromIndex,
    );
  }

  const pending = draftFrame.body.adoption_state.pending[0];

  await page.waitForFunction(() => document.body.innerText.includes("确认创建"), null, {
    timeout: 15_000,
  });
  // 同上：多卡堆积时 .first() 会点到旧 turn 的卡（其 accept 永远 needs_confirmation），
  // 本轮 artifact 永远等不到 resolved —— 必须点最新卡。
  await page.getByRole("button", { name: "确认创建" }).last().click();

  // accept 可能因目标章已有正文被采纳层判覆盖确认（needs_confirmation 的 action_result）；
  // runner 像真实作者一样点「确认执行」完成覆盖替换（overwrite-confirm 链）。
  const settle = await waitForFrame(
    (f) =>
      (f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.truthfulness?.artifact_adopted === true &&
        f.body?.adoption_state?.resolved?.some(
          (entry) => entry.artifact_id === pending.artifact_id,
        )) ||
      (f.direction === "received" &&
        f.event === "action_result" &&
        f.body?.status === "needs_confirmation" &&
        f.body?.artifact_id === pending.artifact_id),
    `No adoption or overwrite-confirmation result for ${chapterTitle}`,
    120_000,
    fromIndex,
  );

  if (settle.event === "action_result") {
    log(`${chapterTitle}: overwrite confirmation — confirming replace`);
    await page.waitForFunction(() => document.body.innerText.includes("确认执行"), null, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "确认执行" }).last().click();
    await waitForFrame(
      (f) =>
        f.direction === "received" &&
        f.event === "turn_result" &&
        f.body?.truthfulness?.artifact_adopted === true &&
        f.body?.adoption_state?.resolved?.some(
          (entry) => entry.artifact_id === pending.artifact_id,
        ),
      `No adoption turn_result after overwrite confirmation for ${chapterTitle}`,
      120_000,
      fromIndex,
    );
  }

  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some(
          (btn) => (btn.textContent ?? "").trim() === "确认创建",
        ),
      null,
      { timeout: 15_000 },
    )
    .catch(() => {
      // 历史失败轮残留的旧卡可能让按钮无法清零；以帧证据（上方 resolved）为准，不阻塞。
    });
  return draftFrame.body.turn_id;
}

// 增量扩章：作者自然语言要求接续生成新一批章节计划并采纳（p1-plan-incremental 链）。
async function planMoreChapters(page) {
  const fromIndex = frames.length;
  await page
    .locator(chatInputSelector)
    .fill(
      "已有章节剧情推进得不错，请接着已有章节继续生成后续剧情的章节大纲，从下一章接续编号，再生成一批新章节计划。",
    );
  await page.getByRole("button", { name: /^发送$/ }).click();

  const outlineFrame = await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.tool_result?.tool_name === "plot_outline" &&
      f.body?.tool_result?.output?.artifact_type === "outline_draft" &&
      Number(f.body?.adoption_state?.pending?.[0]?.payload?.chapter_count ?? 0) >= 5,
    "No incremental outline_draft turn_result while expanding the plan",
    300_000,
    fromIndex,
  );
  const pending = outlineFrame.body.adoption_state.pending[0];

  await page.waitForFunction(() => document.body.innerText.includes("确认创建"), null, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "确认创建" }).last().click();

  await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.truthfulness?.artifact_adopted === true &&
      (f.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === pending.artifact_id,
      ),
    "No adoption turn_result while expanding the plan",
    120_000,
    fromIndex,
  );

  return Number(pending.payload?.chapter_count ?? 0);
}

async function driveChapterTurn(page, chapter) {
  const words = Number(chapter.word_count ?? 0);
  const summary = String(chapter.summary ?? "").trim();
  const instruction =
    words === 0
      ? `请根据已采纳章节计划生成${chapter.title}：${summary}正文草稿，保持为待采纳草稿。`
      : `接着${chapter.title}往下写一段正文，自然衔接前文，推进本章情节。`;

  const fromIndex = frames.length;
  await page.locator(chatInputSelector).fill(instruction);
  await page.getByRole("button", { name: /^发送$/ }).click();
  return adoptPendingDraft(page, chapter.title, fromIndex);
}

async function exportBook(page) {
  await page.getByRole("button", { name: /\[阅读模式\]/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes("阅读模式"), null, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "导出全书" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("已导出到"), null, {
    timeout: 30_000,
  });
  const visibleText = await page.locator("body").innerText();
  const match = /已导出到\s+([^\n]+\.md)/.exec(visibleText);
  return match?.[1] ?? "";
}

function writeArtifacts(toc, exportPath, runMeta) {
  const chapters = flatChapters(toc);
  const total = Number(toc?.total_word_count ?? 0);
  const belowMin = chapters.filter((c) => Number(c.word_count ?? 0) < minWords);

  fs.writeFileSync(
    path.join(artifactDir, "word-count.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        min_words_per_chapter: minWords,
        total_word_count: total,
        chapter_count: chapters.length,
        chapters_below_min: belowMin.length,
        chapters: chapters.map((c) => ({
          title: c.title,
          seq: c.seq,
          word_count: c.word_count,
          audit_status: c.audit_status,
        })),
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(artifactDir, "summary.json"),
    JSON.stringify(
      {
        milestone: "P1-100k-dogfood-run",
        generated_at: new Date().toISOString(),
        provider,
        surface: "tauri",
        total_word_count: total,
        chapter_count: chapters.length,
        chapters_at_or_above_min: chapters.length - belowMin.length,
        chapters_below_min: belowMin.map((c) => c.title),
        p1_target_word_count: 100_000,
        p1_word_target_met: total >= 100_000,
        export_path: exportPath,
        ...runMeta,
      },
      null,
      2,
    ),
  );

  const qualityLines = [
    "# P1 狗粮章节质量抽样",
    "",
    `生成时间：${new Date().toISOString()}`,
    `每章下限：${minWords} 有效字`,
    "",
    "| 章 | 有效字数 | 审计状态 |",
    "|---|---:|---|",
    ...chapters.map((c) => `| ${c.title} | ${c.word_count} | ${c.audit_status ?? ""} |`),
    "",
    "> 正文抽样请直接查阅 export/ 下的导出文件（同一份已采纳作品事实）。",
  ];
  fs.writeFileSync(path.join(artifactDir, "chapter-quality.md"), qualityLines.join("\n"));

  const continuityLines = [
    "# P1 狗粮连续性报告（最小版）",
    "",
    "- 续写连贯性由产品主链保证：续写/重写轮把目标章已采纳正文注入 prose_writing 上下文",
    "  （observability 事件 `turn_execution.continuation_context.done`，见 app-log）。",
    "- 重复段落 / 缺章率的自动检测属 P1-word-count-audit checkpoint B/C（NEXT Order 19，",
    "  按「质量放后」延后），本报告不替代该门禁。",
    "- 人工抽样指引：从 export/ 导出文件抽 ≥10 章，检查无断裂、无系统泄漏、无空章、无重复章。",
  ];
  fs.writeFileSync(path.join(artifactDir, "continuity-report.md"), continuityLines.join("\n"));

  if (exportPath && fs.existsSync(exportPath)) {
    fs.copyFileSync(exportPath, path.join(artifactDir, "export", path.basename(exportPath)));
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("websocket", (ws) => {
  ws.on("framesent", (event) => recordFrame("sent", event.payload));
  ws.on("framereceived", (event) => recordFrame("received", event.payload));
});

const startedAt = Date.now();
let chaptersAdvanced = 0;
const failures = [];

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.body.innerText.includes("服务: 已连接"), null, {
    timeout: 30_000,
  });

  let toc = await readToc(page);
  log(`start: ${flatChapters(toc).length} chapters, total ${toc.total_word_count} words`);

  // 逐章推进：每轮处理一个未达标章的一次产出（首稿或续写），失败重试一次后跳过。
  // maxChapters 限制的是“本次推进了多少个不同的章”，0 = 跑到全部达标。
  const advancedTitles = new Set();
  const skippedTitles = new Set();
  let planFailures = 0;

  for (;;) {
    const chapter = nextPendingChapter(toc, skippedTitles);

    // 全部章达标但总字数未到目标 → 增量扩章（targetWords=0 时不扩，保持原行为）。
    if (!chapter && targetWords > 0 && Number(toc.total_word_count ?? 0) < targetWords) {
      if (planFailures >= 2) {
        log("plan expansion failed twice — stopping");
        break;
      }

      try {
        const added = await planMoreChapters(page);
        toc = await readToc(page);
        log(
          `plan expanded: +${added} chapters (now ${flatChapters(toc).length} chapters, ${toc.total_word_count} words)`,
        );
        appendProgress({ plan_expanded_by: added, chapter_count: flatChapters(toc).length });
      } catch (error) {
        planFailures += 1;
        appendProgress({ plan_expansion_error: String(error?.message ?? error) });
        log(`plan expansion error: ${error?.message ?? error}`);
        toc = await readToc(page);
      }
      continue;
    }

    if (!chapter) {
      log("no pending chapters left (all at min words or skipped)");
      break;
    }

    if (
      maxChapters > 0 &&
      !advancedTitles.has(chapter.title) &&
      advancedTitles.size >= maxChapters
    ) {
      log(`chapter limit ${maxChapters} reached`);
      break;
    }

    if (failures.filter((f) => f.title === chapter.title).length >= 2) {
      log(`skip ${chapter.title} after repeated failures — moving on`);
      skippedTitles.add(chapter.title);
      continue;
    }

    const wordsBefore = Number(chapter.word_count ?? 0);
    const turnStarted = Date.now();

    try {
      const turnId = await driveChapterTurn(page, chapter);
      advancedTitles.add(chapter.title);
      chaptersAdvanced = advancedTitles.size;
      toc = await readToc(page);
      const after = flatChapters(toc).find((c) => c.title === chapter.title);
      appendProgress({
        chapter: chapter.title,
        turn_id: turnId,
        words_before: wordsBefore,
        words_after: Number(after?.word_count ?? 0),
        duration_ms: Date.now() - turnStarted,
      });
      log(`${chapter.title}: ${wordsBefore} -> ${after?.word_count} words`);
    } catch (error) {
      failures.push({ title: chapter.title, error: String(error?.message ?? error) });
      appendProgress({ chapter: chapter.title, error: String(error?.message ?? error) });
      log(`retry ${chapter.title} after error: ${error?.message ?? error}`);
      toc = await readToc(page);
    }
  }

  // 导出后页面停在阅读模式；最终 toc 用循环尾的最新投影（导出不改变字数事实）。
  const exportPath = await exportBook(page);
  log(`exported to ${exportPath}`);

  writeArtifacts(toc, exportPath, {
    chapters_advanced_this_run: chaptersAdvanced,
    failures,
    run_duration_ms: Date.now() - startedAt,
  });

  await page.screenshot({
    path: path.join(artifactDir, "dogfood-final.png"),
    fullPage: true,
  });
  log("artifacts written");
} catch (error) {
  await page.screenshot({
    path: path.join(artifactDir, "dogfood-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
