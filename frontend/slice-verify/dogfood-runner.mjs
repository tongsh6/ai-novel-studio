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
// 正文采纳按钮的真实文案集合：无质量发现=「保存为章节正文」；带发现时草稿归类
// 为「原稿」=「保存原稿」（VS-00E 质量主链语义）。两者都是产品正常行为。
const PROSE_ACCEPT_LABELS = ["保存为章节正文", "保存原稿"];

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

// 超时取证：近帧摘要（direction:event:turn:status:tool:pending 数），归因
// "server 完成而 runner 盲等"类间歇缺陷。
function frameDigest(fromIndex, limit = 15) {
  return frames
    .slice(Math.max(fromIndex, frames.length - limit))
    .map((f) => {
      const b = f.body ?? {};
      return `${f.direction}:${f.event}:${b.turn_id ?? ""}:${b.status ?? ""}:${
        b.tool_result?.tool_name ?? ""
      }:${(b.adoption_state?.pending ?? []).length}`;
    })
    .join(" | ");
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
  // 超时取证（M0：server 完成而 runner 盲等的间歇缺陷）——倾倒近帧摘要供归因。
  throw new Error(`${message}\n  recent frames: ${frameDigest(fromIndex)}`);
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
  await page.getByRole("button", { name: "阅读", exact: true }).click();
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
  // 活跃 run 期间输入框可能被运行态占位（M0 实锤：改进步仍在跑时读目录），
  // 等待放宽到 60s——run 收束后输入框恢复。
  await page.locator(chatInputSelector).waitFor({ timeout: 60_000 });
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

// 发送作者消息并取回本轮 turn_id（user_message ack 的 response.turn_id）。
// 后续帧匹配用它绑定本轮：AgentRun 可能在作者采纳后仍执行后续 step 并迟到广播
// turn_result（僵尸草稿帧），不绑定 turn 会把上一轮的迟到帧误认成本轮产出。
async function sendAuthorMessage(page, instruction) {
  const fromIndex = frames.length;
  // M2 实锤：上一轮超时放弃的 run 可能仍在服务端执行并占用输入框——像真实作者
  // 一样先等它完成（长等 10 分钟），等不到再点「取消」清场，绝不带病 fill。
  try {
    await page.locator(chatInputSelector).waitFor({ state: "visible", timeout: 600_000 });
  } catch (waitError) {
    const cancelButton = page.getByRole("button", { name: /终止任务|取消/ }).last();
    if ((await cancelButton.count()) > 0) {
      log("input blocked by an active run — cancelling it before sending");
      await cancelButton.click({ timeout: 10_000 }).catch(() => {});
      const confirmButton = page.getByRole("button", { name: /^确认终止$/ });
      if ((await confirmButton.count()) > 0) {
        await confirmButton.click({ timeout: 10_000 }).catch(() => {});
      }
      await page.locator(chatInputSelector).waitFor({ state: "visible", timeout: 60_000 });
    } else {
      throw waitError;
    }
  }
  await page.locator(chatInputSelector).fill(instruction);
  await page.getByRole("button", { name: /^发送$/ }).click();

  const ack = await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "phx_reply" &&
      f.body?.response?.received === true,
    "No user_message ack after sending instruction",
    30_000,
    fromIndex,
  );
  return { fromIndex, turnId: ack.body?.response?.turn_id ?? null };
}

function frameBelongsToTurn(frame, turnId) {
  if (!turnId) return true;
  const frameTurn = String(frame.body?.turn_id ?? "");
  return frameTurn === turnId || frameTurn.startsWith(`${turnId}:`);
}

// 一次尝试写某一章能落到的结局——分类一次、穷尽分支一次（判别联合形状），
// 不再是"定义一堆判定函数 → 等到帧 → 再挨个 if 重判一遍是哪种"。新增结局种类
// 只需要在这一个函数里加一条 case，不必在 waitForFrame 的 OR 列表和下面的
// if 链两处同步改。
//
// 各分支的帧形状真源（不是本文件发明的，凭实测抓帧反推正是上一版判错
// awaiting_author 的教训）：
// - prose_ready / wrong_route_reply / run_failed / needs_confirmation：走
//   turn_result 帧，字段路径见 frontend/src/lib/socket.ts 的 TurnResult 相关类型。
// - awaiting_author：走独立的 "agent_run_state" 广播（同文件 AgentRunStateData，
//   status/phase 顶层字段，不嵌套、不带 turn_id）；"真的停了"（不是仍在处理中途）
//   的判据抄自后端权威定义 apps/novel_application/.../agent_run_server.ex 的
//   no_progress_stopped?/1 —— status == :awaiting_author 且 phase == :stopped
//   两者同时成立。frontend/src/lib/agentRunInputRouting.ts 的
//   STEERABLE_AGENT_RUN_STATUSES 只到 status 粒度（前端"能不能插话"的更宽语义），
//   不是这里要的"已停止"判据。
function classifyChapterAttemptFrame(f, turnId) {
  if (f.direction !== "received") return null;

  if (f.event === "agent_run_state") {
    if (f.body?.status === "awaiting_author" && f.body?.phase === "stopped") {
      return { kind: "awaiting_author" };
    }
    return null;
  }

  if (f.event !== "turn_result" || !frameBelongsToTurn(f, turnId)) return null;

  if (
    f.body?.tool_result?.tool_name === "prose_writing" &&
    f.body?.adoption_state?.pending?.[0]?.artifact_type === "prose_fragment"
  ) {
    return { kind: "prose_ready" };
  }

  // 误路由快速失败（M0 缺陷四）：本轮 turn 以"回复"收束（run completed 且无
  // 待采纳正文）说明判断把创作请求判成了闲聊。
  if (
    f.body?.agent_run?.status === "completed" &&
    !f.body?.tool_result &&
    (f.body?.adoption_state?.pending ?? []).length === 0 &&
    typeof f.body?.assistant_message?.text === "string"
  ) {
    return { kind: "wrong_route_reply" };
  }

  // run 失败终局（S7 诚实失败，如起草空计划）。
  if (f.body?.agent_run?.status === "failed") {
    return { kind: "run_failed" };
  }

  // 系统可能把指令判为高风险（如重写语义）并出确认卡（AU-04）。
  if (
    f.body?.status === "needs_confirmation" &&
    (f.body?.available_actions ?? []).some(
      (action) => action.action_type === "confirm_before_execute",
    )
  ) {
    return { kind: "needs_confirmation" };
  }

  return null;
}

async function adoptPendingDraft(page, chapterTitle, fromIndex, turnId = null, options = {}) {
  // 所有帧匹配从本轮发送之后开始（fromIndex），不与历史轮串。
  let draftFrame = await waitForFrame(
    (f) => classifyChapterAttemptFrame(f, turnId) !== null,
    `No prose_fragment or confirmation turn_result for ${chapterTitle}`,
    600_000,
    fromIndex,
  );

  const outcome = classifyChapterAttemptFrame(draftFrame, turnId);

  switch (outcome.kind) {
    case "wrong_route_reply":
      throw new Error(
        `judgment routed the prose request to a chat reply for ${chapterTitle} (wrong-route, fail fast)`,
      );
    case "run_failed":
      throw new Error(`agent run failed for ${chapterTitle} (fail fast)`);
    case "awaiting_author":
      // M2 实锤（2026-07-20）：prose_writing 工具失败时 AgentRun 会诚实判定
      // "工具层错误、自己修不了"并主动收束到 awaiting_author，不是 failed。
      // 此前没有识别这个终态，waitForFrame 只能傻等满 600s，再叠加 readToc
      // 60s + sendAuthorMessage 10 分钟输入阻塞等待，每次工具失败实测约耗
      // 20 分钟——与其它三类同款秒级快速失败，直接进已有重试/跳章路径。
      throw new Error(
        `agent run reached awaiting_author for ${chapterTitle} (tool failure, fail fast)`,
      );
    case "prose_ready":
    case "needs_confirmation":
      break;
  }

  if (outcome.kind === "needs_confirmation") {
    log(`${chapterTitle}: confirmation required — confirming execution`);
    await page.waitForFunction(() => document.body.innerText.includes("确认执行"), null, {
      timeout: 15_000,
    });
    // 失败重试可能在页面留下多张卡：永远点最新一张（消息流尾部）。
    await page.getByRole("button", { name: "确认执行" }).last().click();
    draftFrame = await waitForFrame(
      (f) => classifyChapterAttemptFrame(f, turnId)?.kind === "prose_ready",
      `No prose_fragment turn_result after confirmation for ${chapterTitle}`,
      600_000,
      fromIndex,
    );
  }

  const pending = draftFrame.body.adoption_state.pending[0];

  // VS-00E 质量主链上线后（P1 正文质量证据化批）：带质量发现的草稿在前端归类为
  // 「原稿」，采纳按钮文案变为「保存原稿」（无发现时仍是「保存为章节正文」）。
  // runner 是外部作者视角，两种真实文案都要认——只认旧文案会把产品正常行为
  // 误判成超时（M4 实锤：18 次超时全是带发现的章）。
  await page.waitForFunction(
    (labels) => labels.some((label) => document.body.innerText.includes(label)),
    PROSE_ACCEPT_LABELS,
    { timeout: 30_000 },
  );
  // 同上：多卡堆积时 .first() 会点到旧 turn 的卡（其 accept 永远 needs_confirmation），
  // 本轮 artifact 永远等不到 resolved —— 必须点最新卡。
  const acceptButton = page
    .getByRole("button", { name: new RegExp(`^(${PROSE_ACCEPT_LABELS.join("|")})$`) })
    .last();
  await acceptButton.click();

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
    const settleReasonCodes = settle.body?.decision?.reason_codes ?? [];
    const metaLeakConfirmation = settleReasonCodes.includes("meta_leak_detected");

    if (metaLeakConfirmation) {
      // B9 元泄漏升采纳级：泄漏正文不再静默采纳。runner 模拟作者显式确认并计数
      // （拦截数即 M4 审计靶：对照 M3 的 25 处静默存活）。续写/首稿同语义。
      metaLeakInterceptions.push({ chapter: chapterTitle, at: new Date().toISOString() });
      log(
        `${chapterTitle}: meta-leak adoption intercepted (#${metaLeakInterceptions.length}) — confirming explicitly`,
      );
    } else if (options.continuation) {
      // M0 缺陷守卫（2026-07-19）：续写请求绝不该触发整章覆盖确认——出现即产品
      // 坐标回归（authoring_intent 未判 continuation）。真实作者会取消而不是确认；
      // runner 按失败上抛（进重试路径），不再盲确认吞掉字数倒退。
      throw new Error(
        `continuation for ${chapterTitle} produced an overwrite confirmation (coordinate regression)`,
      );
    }

    if (!metaLeakConfirmation) log(`${chapterTitle}: overwrite confirmation — confirming replace`);
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
      (labels) =>
        ![...document.querySelectorAll("button")].some((btn) =>
          labels.includes((btn.textContent ?? "").trim()),
        ),
      PROSE_ACCEPT_LABELS,
      { timeout: 15_000 },
    )
    .catch(() => {
      // 历史失败轮残留的旧卡可能让按钮无法清零；以帧证据（上方 resolved）为准，不阻塞。
    });
  return draftFrame.body.turn_id;
}

// 增量扩章：作者自然语言要求接续生成新一批章节计划并采纳（p1-plan-incremental 链）。
async function planMoreChapters(page) {
  const { fromIndex, turnId } = await sendAuthorMessage(
    page,
    "已有章节剧情推进得不错，请接着已有章节继续生成后续剧情的章节大纲，从下一章接续编号，再生成一批新章节计划。",
  );

  const outlineFrame = await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      frameBelongsToTurn(f, turnId) &&
      f.body?.tool_result?.tool_name === "plot_outline" &&
      f.body?.tool_result?.output?.artifact_type === "outline_draft" &&
      Number(f.body?.adoption_state?.pending?.[0]?.payload?.chapter_count ?? 0) >= 5,
    "No incremental outline_draft turn_result while expanding the plan",
    600_000,
    fromIndex,
  );
  const pending = outlineFrame.body.adoption_state.pending[0];

  await page.waitForFunction(() => document.body.innerText.includes("保存到大纲"), null, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "保存到大纲" }).last().click();

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
  const continuation = words > 0;
  const instruction = continuation
    ? `接着${chapter.title}往下写一段正文，自然衔接前文，推进本章情节。`
    : `请根据已采纳章节计划生成${chapter.title}：${summary}正文草稿，保持为待采纳草稿。`;

  const { fromIndex, turnId } = await sendAuthorMessage(page, instruction);
  return adoptPendingDraft(page, chapter.title, fromIndex, turnId, { continuation });
}

async function exportBook(page) {
  await page.getByRole("button", { name: "阅读", exact: true }).click();
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

// VS-00G 盘点节拍（M4）：R5 阈值章数后，runner 模拟真实作者响应产品补全引导——
// 从档案发起一次设定盘点，逐项采纳主角候选与全书规划建议（真实模型提炼，走真实
// 采纳边界；规划回写后收官守则即激活，是 M4 收官循环靶的前提件）。仅尝试一次，
// 失败如实登记（盘点回路的长跑表现本身就是审计靶）。
async function closeArchiveIfOpen(page) {
  const closeArchive = page.getByRole("button", { name: "关闭档案" });
  if ((await closeArchive.count()) > 0) {
    await closeArchive.first().click();
    await page.locator(chatInputSelector).waitFor({ timeout: 15_000 });
  }
}

function itemField(item, key) {
  return item?.[key] ?? item?.[String(key)];
}

// 逐项采纳按钮有两种真实渲染：①候选单选组（先选「方案 X」再点「保存方案 X 到作品档案」）；
// ②逐项独立按钮带候选名后缀（「保存到作品档案：沈砚」）。外部作者视角两种都要认——
// M4 实锤：只认①时盘点节拍在采纳步 30s 超时。
async function clickInventoryAccept(page, { itemName, optionLabel, acceptFallback }) {
  // 候选组渲染（M4 实锤真形状）：单选项 aria-label = 「选择方案 X：候选名」，
  // 选中前采纳按钮是 disabled 的「保存所选方案到作品档案」，选中后变为
  // 「保存方案 X 到作品档案」。必须先选中候选，按钮才可点。
  if (itemName) {
    const radio = page.getByRole("radio", { name: new RegExp(`选择.*：${itemName}`) });
    if ((await radio.count()) > 0) {
      await radio.last().check();
      const selected = page.getByRole("button", { name: /保存方案 .* 到作品档案/ });
      if ((await selected.count()) > 0) {
        await selected.last().click();
        return `candidate:${itemName}`;
      }
      const anyAccept = page.getByRole("button", { name: /保存.*作品档案/ });
      await anyAccept.last().click();
      return `candidate-loose:${itemName}`;
    }

    const named = page.getByRole("button", { name: new RegExp(`保存.*${itemName}`) });
    if ((await named.count()) > 0) {
      await named.last().click();
      return `named:${itemName}`;
    }
  }

  if (optionLabel) {
    const radio = page.getByRole("radio", { name: new RegExp(`选择${optionLabel}`) });
    if ((await radio.count()) > 0) {
      await radio.last().check();
      const optionButton = page.getByRole("button", { name: /保存方案 .* 到作品档案/ });
      if ((await optionButton.count()) > 0) {
        await optionButton.last().click();
        return `option:${optionLabel}`;
      }
    }
  }

  const exact = page.getByRole("button", { name: acceptFallback, exact: true });
  if ((await exact.count()) > 0) {
    await exact.last().click();
    return `exact:${acceptFallback}`;
  }

  // 文案再变也不至于整拍报废：按语义宽匹配兜底，但必须跳过 disabled 按钮
  // （未选中候选时「保存所选方案到作品档案」恒 disabled，点它只会空等 30s）。
  const loose = page
    .getByRole("button", { name: /(保存.*档案|采纳.*全书规划)/ })
    .and(page.locator("button:not([disabled])"));
  if ((await loose.count()) > 0) {
    const label = await loose.last().innerText();
    await loose.last().click();
    return `loose:${label.trim()}`;
  }

  const labels = await page.$$eval("button", (btns) =>
    btns.map((b) => (b.textContent ?? "").trim()).filter((t) => t.length > 0 && t.length < 40),
  );
  throw new Error(
    `no inventory accept button matched (itemName=${itemName ?? "-"} option=${
      optionLabel ?? "-"
    } fallback=${acceptFallback}); visible buttons: ${labels.slice(-25).join(" | ")}`,
  );
}

async function adoptInventoryUnit(page, unit, opts, fromIndex) {
  await clickInventoryAccept(page, opts);
  await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.truthfulness?.artifact_adopted === true &&
      (f.body?.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === unit.artifact_id,
      ),
    `inventory unit ${unit.artifact_id} was not adopted`,
    120_000,
    fromIndex,
  );
}

async function runInventoryBeat(page) {
  const fromIndex = frames.length;

  await page.getByRole("button", { name: "打开档案" }).first().click();
  await page.getByRole("tab", { name: "概览" }).click();
  await page.getByRole("button", { name: "发起设定盘点", exact: true }).click();

  const inventoryTurnFrame = await waitForFrame(
    (f) =>
      f.direction === "received" &&
      f.event === "turn_result" &&
      f.body?.agent_run?.profile_ref === "fact_inventory_v1" &&
      f.body?.tool_result?.tool_name === "fact_inventory" &&
      (f.body?.adoption_state?.pending ?? []).length > 0,
    "fact inventory produced no proposals",
    600_000,
    fromIndex,
  );

  const pending = inventoryTurnFrame.body.adoption_state.pending ?? [];
  const characterUnits = pending.filter((e) => e.artifact_type === "character_seed");
  const skeletonUnits = pending.filter((e) => e.artifact_type === "work_skeleton_suggestion");

  const protagonistUnit =
    characterUnits.find((e) =>
      (e.payload?.items ?? []).some((item) => itemField(item, "narrative_role") === "PROTAGONIST"),
    ) ?? characterUnits[0];

  // 档案面板遮提案卡：回对话流逐项采纳。
  await closeArchiveIfOpen(page);
  await page.waitForFunction(() => document.body.innerText.includes("设定盘点完成"), null, {
    timeout: 30_000,
  });

  const adopted = { protagonist: null, skeleton_fields: [] };

  if (protagonistUnit) {
    const setPrefix = String(protagonistUnit.artifact_id).split("::")[0];
    const setUnits = characterUnits.filter(
      (e) => String(e.artifact_id).split("::")[0] === setPrefix,
    );
    const itemName = itemField(protagonistUnit.payload?.items?.[0], "title");
    const optionLabel =
      setUnits.length > 1
        ? `方案 ${String.fromCharCode(65 + setUnits.indexOf(protagonistUnit))}`
        : null;

    await adoptInventoryUnit(
      page,
      protagonistUnit,
      { itemName, optionLabel, acceptFallback: "保存到作品档案" },
      fromIndex,
    );
    adopted.protagonist = itemName ?? protagonistUnit.artifact_id;
    log(`inventory beat: adopted protagonist ${adopted.protagonist}`);
  }

  for (const unit of skeletonUnits) {
    const field = itemField(unit.payload?.items?.[0], "skeleton_field");
    await adoptInventoryUnit(
      page,
      unit,
      { itemName: null, optionLabel: null, acceptFallback: "采纳为全书规划" },
      fromIndex,
    );
    adopted.skeleton_fields.push(field);
    log(`inventory beat: adopted planning field ${field}`);
  }

  return {
    proposals_total: pending.length,
    characters_proposed: characterUnits.length,
    skeleton_proposed: skeletonUnits.length,
    adopted_protagonist: adopted.protagonist,
    adopted_skeleton_fields: adopted.skeleton_fields,
  };
}

// T1 体温计（call2 病灶收口 slice）：重试率按症状分类聚合——harness 重试把问题
// 变"能跑"不等于病愈，本表就是病灶体温计，进 summary.json 供跨跑对比。
function retryThermometer(failures) {
  const category = (error) => {
    if (/wrong-route/.test(error)) return "wrong_route_reply";
    if (/coordinate regression/.test(error)) return "coordinate_regression";
    if (/agent run failed/.test(error)) return "run_failed";
    if (/awaiting_author/.test(error)) return "tool_failed_awaiting_author";
    if (/Timeout|No prose_fragment/.test(error)) return "timeout_600s";
    return "other";
  };

  const by_category = {};
  for (const f of failures) {
    const c = category(String(f.error ?? ""));
    by_category[c] = (by_category[c] ?? 0) + 1;
  }
  return { total_retries: failures.length, by_category };
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

  // 体温计追加式留痕（M4 实锤：跨 resume 的多轮跑里，最后一次「无待办章」的
  // 2.4 秒收尾跑把 summary.json 整个覆盖，15 次 B9 拦截与盘点节拍结果全被抹掉，
  // 只能回头从 launcher 日志重建）。逐轮 append，summary 仍保留当轮快照。
  fs.appendFileSync(
    path.join(artifactDir, "run-metrics.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), total_word_count: total, chapter_count: chapters.length, ...runMeta })}\n`,
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
// B9 体温计（M4）：元泄漏采纳拦截计数——M3 为 25 处静默入正文，本跑每次拦截
// 都是「不再静默」的证据；runner 模拟作者显式确认后继续（主权语义）。
const metaLeakInterceptions = [];
// VS-00G 盘点节拍（M4）：R5 阈值后由 runner 模拟作者响应产品引导发起一次盘点。
const inventoryBeat = { attempted: false, attempts: 0, done: false, result: null };

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.body.innerText.includes("同步已连接"), null, {
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

    const chapterFailureWeight = failures
      .filter((f) => f.title === chapter.title)
      .reduce((sum, f) => sum + (/fail fast|coordinate regression/.test(f.error) ? 0.5 : 1.5), 0);
    if (chapterFailureWeight >= 3) {
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
      const wordsAfter = Number(after?.word_count ?? 0);
      appendProgress({
        chapter: chapter.title,
        turn_id: turnId,
        words_before: wordsBefore,
        words_after: wordsAfter,
        duration_ms: Date.now() - turnStarted,
      });
      log(`${chapter.title}: ${wordsBefore} -> ${wordsAfter} words`);
      if (wordsBefore > 0 && wordsAfter < wordsBefore) {
        // 字数单调兜底：续写后字数倒退=已采纳正文被覆盖/丢失，按失败登记。
        throw new Error(
          `word count regression on ${chapter.title}: ${wordsBefore} -> ${wordsAfter}`,
        );
      }

      // VS-00G 盘点节拍：达标章数过 R5 阈值（10+2 缓冲）后模拟作者响应补全引导，
      // 一次性发起盘点并采纳主角/全书规划——之后收官守则、弧光账、R7/R8 全部上线。
      const settledChapters = flatChapters(toc).filter(
        (c) => Number(c.word_count ?? 0) >= minWords,
      ).length;
      // 盘点节拍是本跑的关键验证靶（补全回路真实表现），失败允许重试至多 3 次
      // （每次隔一章），全败才登记放弃——不阻断长跑主链。
      if (!inventoryBeat.done && inventoryBeat.attempts < 3 && settledChapters >= 12) {
        inventoryBeat.attempts += 1;
        inventoryBeat.attempted = true;
        try {
          inventoryBeat.result = await runInventoryBeat(page);
          inventoryBeat.done = true;
          appendProgress({ inventory_beat: inventoryBeat.result });
          log(`inventory beat done: ${JSON.stringify(inventoryBeat.result)}`);
        } catch (error) {
          inventoryBeat.result = {
            error: String(error?.message ?? error),
            attempt: inventoryBeat.attempts,
          };
          appendProgress({ inventory_beat_error: inventoryBeat.result.error });
          log(
            `inventory beat attempt ${inventoryBeat.attempts} failed (run continues): ${inventoryBeat.result.error}`,
          );
          await closeArchiveIfOpen(page).catch(() => {});
        }
      }
    } catch (error) {
      failures.push({ title: chapter.title, error: String(error?.message ?? error) });
      appendProgress({ chapter: chapter.title, error: String(error?.message ?? error) });
      log(`retry ${chapter.title} after error: ${error?.message ?? error}`);
      try {
        toc = await readToc(page);
      } catch (tocError) {
        // 恢复路径读目录失败不终止整跑（M0 实锤：uncaught 曾直接杀死进程）；
        // 保留旧 toc 进入下一轮重试。
        log(`readToc failed during recovery: ${tocError?.message ?? tocError}`);
      }
    }
  }

  // 导出后页面停在阅读模式；最终 toc 用循环尾的最新投影（导出不改变字数事实）。
  const exportPath = await exportBook(page);
  log(`exported to ${exportPath}`);

  writeArtifacts(toc, exportPath, {
    chapters_advanced_this_run: chaptersAdvanced,
    retry_thermometer: retryThermometer(failures),
    failures,
    // B9 体温计（M4 审计靶）：对照 M3 的 25 处静默泄漏存活。
    meta_leak_interceptions: metaLeakInterceptions.length,
    meta_leak_intercepted_chapters: metaLeakInterceptions,
    // VS-00G 盘点节拍结果（补全回路长跑表现）。
    inventory_beat: inventoryBeat,
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
