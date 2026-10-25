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
//   DOGFOOD_PROVIDER        slice_verify | lmstudio | strata（仅记录进 summary）
//   DOGFOOD_PLAN_CHAPTERS   只推进章节计划前 N 章（P1 canonical=10；0=不限）
//   DOGFOOD_STOP_AFTER_ADVANCED 写满 N 个已推进章后优雅退出（resume 演练）
//   DOGFOOD_MAINTENANCE     1=启用维护组合插入点（默认）；0=dry-run 关闭
//   DOGFOOD_MAINTENANCE_ONLY 1=维护补验模式：不写章节，只回放 DOGFOOD_MAINTENANCE_RETRY
//                           指定的维护拍（需同一 canonical DB/证据目录）
//   DOGFOOD_MAINTENANCE_RETRY 逗号分隔的维护拍 id（design_character/content_revision/
//                           character_role_revision/...）；补验时重置这些拍并强制触发
//   DOGFOOD_ONLY_SEQ        scoped 写章只推进该 seq（B33 CP4 S1 单章 replay，如 8）；0=不限
//
// P1 CP0（2026-10-25）：B6 帧判定单源（classifyJourneyFrame+穷尽 switch）；
// B9 needs_confirmation 显式确认/跳过计数 + 空章/重复段观察；B7 章节请求自然作者措辞；
// 维护组合插入点（B28 排版/内容修订、B30 重编号、B29 角色身份）与 resume 状态。
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
// P1 CP0 canonical 10 章：plan-chapters 限制本次推进的计划前 N 章；stop-after 用于断点续跑演练。
const planChapters = Number(process.env.DOGFOOD_PLAN_CHAPTERS ?? "0");
const stopAfterAdvanced = Number(process.env.DOGFOOD_STOP_AFTER_ADVANCED ?? "0");
const maintenanceEnabled = (process.env.DOGFOOD_MAINTENANCE ?? "1") !== "0";
// P1 CP0 维护补验（task-87）：B33 修复后只回放指定维护拍，不整批重跑 10 章。
// 需与 canonical 同一 DB/证据目录（已有章节事实），只重置指定拍并强制触发。
const maintenanceOnly = (process.env.DOGFOOD_MAINTENANCE_ONLY ?? "0") === "1";
const maintenanceRetryIds = (process.env.DOGFOOD_MAINTENANCE_RETRY ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
// B33 CP4 S1：scoped 写章只允许指定 seq（如第08章空章），避免从第05章短章开始；
// 0 = 不限制（canonical 行为）。
const onlySeq = Number(process.env.DOGFOOD_ONLY_SEQ ?? "0");
const provider = process.env.DOGFOOD_PROVIDER ?? "lmstudio";
// B37 CP1：统一等待预算（env 可覆盖；禁止 600s 通用盲等）。kind 即产品旅程阶段。
const WAIT_BUDGET_DEFAULTS = Object.freeze({
  input: 30_000,
  ack: 30_000,
  turn: 120_000,
  candidate: 120_000,
  adoption: 90_000,
  maintenance: 180_000,
  export: 60_000,
  toc: 30_000,
});

function waitBudget(kind) {
  const envKey = `DOGFOOD_WAIT_${String(kind).toUpperCase()}_MS`;
  const raw = process.env[envKey];
  const value = raw == null || raw === "" ? WAIT_BUDGET_DEFAULTS[kind] : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid wait budget ${envKey}=${JSON.stringify(raw)} for kind=${kind}`);
  }
  return value;
}

const FAULT_SIM_KINDS = ["page_closed", "action_failed", "stall", "backend_down"];
const faultSim = process.env.DOGFOOD_FAULT_SIM ?? "";
if (faultSim && !FAULT_SIM_KINDS.includes(faultSim)) {
  console.error(`DOGFOOD_FAULT_SIM must be one of ${FAULT_SIM_KINDS.join("|")}, got ${faultSim}`);
  process.exit(2);
}
if (faultSim && provider !== "slice_verify") {
  console.error("DOGFOOD_FAULT_SIM is only allowed with --provider slice_verify (dry-run harness)");
  process.exit(2);
}
const dogfoodApiBaseUrl = process.env.DOGFOOD_API_BASE_URL ?? "http://127.0.0.1:4657";
const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';
// 正文采纳按钮的真实文案集合：无质量发现=「保存为章节正文」；带发现时草稿归类
// 为「原稿」=「保存原稿」（VS-00E 质量主链语义）。两者都是产品正常行为。
const BEAT_SETTLED_MIN_WORDS = 1000;
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
async function waitForFrame(predicate, message, timeoutMs = waitBudget("turn"), fromIndex = 0) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = frames.slice(fromIndex).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // 超时取证（M0：server 完成而 runner 盲等的间歇缺陷）——倾倒近帧摘要供归因。
  // M5 加强（2026-08-25）：扩章三次「后端成功、runner 盲等」而 recent-15 只剩心跳——
  // 追加窗口内全部 turn_result 帧的判定要素尸检，谓词哪一环假一击可见。
  throw new Error(
    `${message}\n  recent frames: ${frameDigest(fromIndex)}\n  turn_results: ${turnResultAutopsy(fromIndex)}`,
  );
}

function turnResultAutopsy(fromIndex) {
  const rows = frames
    .slice(fromIndex)
    .filter((f) => f.direction === "received" && f.event === "turn_result")
    .slice(-6)
    .map((f) => {
      const body = f.body ?? {};
      const pending = (body.adoption_state?.pending ?? []).map((p) => ({
        type: p.artifact_type,
        payload_keys: Object.keys(p.payload ?? {}),
        chapter_count: p.payload?.chapter_count,
      }));
      return JSON.stringify({
        turn_id: body.turn_id,
        tool_name: body.tool_result?.tool_name,
        artifact_type: body.tool_result?.output?.artifact_type,
        pending,
      });
    });
  return rows.length > 0 ? rows.join(" | ") : "(none)";
}

function log(message) {
  console.log(`[dogfood] ${new Date().toISOString()} ${message}`);
}

// P1 CP0：外部页面动作必须有界。Playwright 个别等待在异常 UI 状态下可能不返回
// （2026-10-25 dry-run 实锤：维持节拍后输入框等待挂起）；用 race 超时把“无限等”
// 变成可记录失败，现场截图/文案由调用方落证据。
async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function appendProgress(entry) {
  fs.appendFileSync(
    progressPath,
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  );
}

// B37 CP1：等待/waitdog 证据。runner 内所有 journey 等待都必须经过 waitForJourneyKind；
// 每次等待写 wait-events.jsonl（start/heartbeat/end），summary/failure 带 wait_stats。
const WAIT_EVENTS_PATH = path.join(artifactDir, "wait-events.jsonl");
const waitRecords = [];
let activePage = null;
let watchdogTimer = null;
let watchdogStopped = false;
let currentWait = null;

class DogfoodWaitError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DogfoodWaitError";
    this.code = code;
    this.details = details;
  }
}

function isFatalWaitError(error) {
  return (
    error instanceof DogfoodWaitError &&
    ["page_closed", "backend_down", "action_failed", "adoption_persistence_failed", "signal"].includes(
      error.code,
    )
  );
}

function appendWaitEvent(entry) {
  try {
    fs.appendFileSync(
      WAIT_EVENTS_PATH,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
  } catch {
    // 证据写失败不改变旅程语义；stderr 留痕。
    console.error("wait-events write failed");
  }
}

function waitStats() {
  const completed = waitRecords.filter((record) => record.outcome !== "pending");
  const totalElapsed = completed.reduce((sum, record) => sum + Number(record.elapsed_ms ?? 0), 0);
  const timeouts = completed.filter((record) => record.outcome === "timeout").length;
  const failures = completed.filter(
    (record) => record.outcome === "error" || record.outcome === "fatal",
  ).length;
  const slowest = completed.reduce(
    (best, record) =>
      !best || Number(record.elapsed_ms ?? 0) > Number(best.elapsed_ms ?? 0) ? record : best,
    null,
  );
  return {
    total_waits: completed.length,
    total_elapsed_ms: totalElapsed,
    timeout_count: timeouts,
    failure_count: failures,
    slowest: slowest
      ? {
          kind: slowest.kind,
          label: slowest.label,
          elapsed_ms: slowest.elapsed_ms,
          outcome: slowest.outcome,
        }
      : null,
    records: completed.slice(-50),
  };
}

function recordFailureFile(error, extra = {}) {
  try {
    fs.writeFileSync(
      path.join(artifactDir, "failure.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          status: "failed",
          code: error?.code ?? "error",
          error: String(error?.message ?? error),
          stack: String(error?.stack ?? "").slice(0, 4000),
          current_wait: currentWait,
          wait_stats: waitStats(),
          ...extra,
        },
        null,
        2,
      ),
    );
  } catch (writeError) {
    console.error(`failure.json write failed: ${writeError?.message ?? writeError}`);
  }
}

async function backendHealthAlive(timeoutMs = 2_000) {
  try {
    const response = await fetch(`${dogfoodApiBaseUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function assertPageAlive(page, context) {
  if (!page || page.isClosed()) {
    throw new DogfoodWaitError("page_closed", `page/context closed while waiting: ${context}`, {
      context,
    });
  }
}

function assertBackendAlive(context) {
  // 等待心跳/看门狗共用的后端健康检查；/health 不返回即视为 SIGTERM/后端退出。
  if (faultSim === "backend_down") {
    throw new DogfoodWaitError("backend_down", `fault-sim backend_down: ${context}`, { context });
  }
}

// B37 CP1 全局 watchdog（10s）：page closed / backend health down -> 写 failure.json 并非零退出。
function startWatchdog(page) {
  activePage = page;
  watchdogStopped = false;
  watchdogTimer = setInterval(async () => {
    if (watchdogStopped) return;
    try {
      assertPageAlive(activePage, "global-watchdog");
      assertBackendAlive("global-watchdog");
      if (!(await backendHealthAlive())) {
        throw new DogfoodWaitError(
          "backend_down",
          "backend /health unavailable during global watchdog",
          { source: "watchdog" },
        );
      }
    } catch (error) {
      watchdogStopped = true;
      if (watchdogTimer) clearInterval(watchdogTimer);
      watchdogTimer = null;
      recordFailureFile(error, { source: "watchdog" });
      console.error(`[dogfood] watchdog fatal: ${error?.message ?? error}`);
      process.exitCode = 1;
      process.exit(1);
    }
  }, 10_000);
  watchdogTimer.unref?.();
}

function stopWatchdog() {
  watchdogStopped = true;
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

function exitOnSignal(signal, exitCode) {
  recordFailureFile(new DogfoodWaitError("signal", `${signal} received`), {
    source: "process-signal",
    signal,
  });
  appendWaitEvent({ phase: "fatal", kind: "signal", label: signal, code: "signal" });
  stopWatchdog();
  process.exit(exitCode);
}
process.once("SIGTERM", () => exitOnSignal("SIGTERM", 143));
process.once("SIGINT", () => exitOnSignal("SIGINT", 130));

// B9：确认/跳过必须显式计数（不盲确认换绿灯）；summary 消费 confirmation_counts。
function recordConfirmationDecision({ kind, decision, target, reason_codes = [], reason = null }) {
  confirmationDecisions.push({
    at: new Date().toISOString(),
    kind,
    decision,
    target,
    reason_codes,
    reason,
  });
}

function recordClarification({ beat, follow_up, question_turn_id = null }) {
  clarificationEvents.push({
    at: new Date().toISOString(),
    beat,
    follow_up,
    question_turn_id,
  });
}

function confirmationCounts() {
  const by_kind = {};
  for (const item of confirmationDecisions) {
    const key = `${item.kind}:${item.decision}`;
    by_kind[key] = (by_kind[key] ?? 0) + 1;
  }
  return {
    total: confirmationDecisions.length,
    confirmed: confirmationDecisions.filter((item) => item.decision === "confirm").length,
    skipped: confirmationDecisions.filter((item) => item.decision === "skip").length,
    by_kind,
  };
}

// 进入阅读模式触发 get_toc，取最新投影后返回工作台。
async function readToc(page) {
  const before = frames.length;
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("阅读模式"), null, {
    timeout: 15_000,
  });

  // M5 实锤（2026-08-25）：channel 串行——accept 同步摘要维护（3 分钟级）期间
  // get_toc 排队；失败路径也必须返回工作台，否则 UI 困在阅读模式。
  // B6：投影判定走 classifyJourneyFrame 的 toc_projection 分支（契约单源）。
  let resp;
  try {
    const projection = await waitFor(
      "toc",
      (classification) => classification.kind === "toc_projection",
      "No get_toc projection frame after entering reading mode",
      before,
    );
    resp = projection.classification.toc;
    recoveryDecisions.push({ kind: "toc_projection", decision: "accepted" });
  } catch (error) {
    recoveryDecisions.push({ kind: "reading_mode", decision: "leave_mode_after_toc_timeout" });
    await page
      .getByRole("button", { name: "返回工作台" })
      .click({ timeout: 10_000 })
      .catch(() => {});
    throw error;
  }

  // 异常恢复路径下页面状态可能不在预期（残卡/弹层），点击失败不立即抛——
  // 以下一行「对话输入框可见」为准（仍不可见则诚实失败）。
  await page
    .getByRole("button", { name: "返回工作台" })
    .click({ timeout: 10_000 })
    .catch(() => {});
  // 活跃 run 期间输入框可能被运行态占位（M0 实锤：改进步仍在跑时读目录），
  // 等待放宽到 60s——run 收束后输入框恢复。
  await page.locator(chatInputSelector).waitFor({ timeout: waitBudget("input") });
  return resp;
}

function flatChapters(toc) {
  return (toc?.volumes ?? []).flatMap((volume) => volume.chapters ?? []);
}

function nextPendingChapter(toc, skippedTitles, maxPlanSeq = 0, targetSeq = 0) {
  return (
    flatChapters(toc).find(
      (chapter) =>
        (maxPlanSeq <= 0 || Number(chapter.seq ?? 0) <= maxPlanSeq) &&
        (targetSeq <= 0 || Number(chapter.seq ?? 0) === targetSeq) &&
        Number(chapter.word_count ?? 0) < minWords &&
        !skippedTitles.has(chapter.title),
    ) ?? null
  );
}

// 发送作者消息并取回本轮 turn_id（user_message ack 的 response.turn_id）。
// 后续帧匹配用它绑定本轮：AgentRun 可能在作者采纳后仍执行后续 step 并迟到广播
// turn_result（僵尸草稿帧），不绑定 turn 会把上一轮的迟到帧误认成本轮产出。
async function sendAuthorMessage(page, instruction) {
  const fromIndex = frames.length;
  // P1 CP0：等待输入可用改为有界（120s）+ 失败现场取证，不再盲等 10 分钟。
  // 根因可能是阅读模式残留/活跃 run 占位/弹层遮罩；现场截图+可见文案落到 artifact dir，
  // recovery 后仍失败则诚实抛错（上层节拍按失败记录，不静默）。
  log(`waiting for chat input before: ${instruction.slice(0, 40)}`);
  try {
    await withTimeout(
      page.locator(chatInputSelector).waitFor({ state: "visible", timeout: waitBudget("input") }),
      waitBudget("input") + 20_000,
      "chat input visible",
    );
  } catch (waitError) {
    await withTimeout(
      page.screenshot({
        path: path.join(artifactDir, "chat-input-unavailable.png"),
        fullPage: true,
      }),
      20_000,
      "chat-input-unavailable screenshot",
    ).catch(() => {});
    const visibleText = await withTimeout(page.locator("body").innerText(), 15_000, "body text").catch(
      () => "",
    );
    fs.appendFileSync(
      path.join(artifactDir, "recovery-diagnostics.jsonl"),
      `${JSON.stringify({
        at: new Date().toISOString(),
        kind: "chat_input_unavailable",
        instruction,
        visible_text_tail: visibleText.slice(-2000),
      })}\n`,
    );
    log("chat input hidden — captured diagnostics; attempting recovery");
    // M5 实锤：恢复路径可能把 UI 留在阅读模式（输入框 display 级隐藏）——
    // 先像真实作者一样点「返回工作台」逃逸，再考虑取消清场。
    const backButton = page.getByRole("button", { name: "返回工作台" });
    if ((await backButton.count()) > 0) {
      log("input hidden — leaving reading mode before retrying");
      recoveryDecisions.push({ kind: "reading_mode_recovery", decision: "leave_mode_then_retry" });
      await withTimeout(backButton.click({ timeout: 10_000 }), 20_000, "return to workspace click").catch(
        () => {},
      );
      await withTimeout(
        page.locator(chatInputSelector).waitFor({ state: "visible", timeout: waitBudget("input") }),
        waitBudget("input") + 10_000,
        "chat input visible after recovery",
      );
      log("chat input visible after leaving reading mode; retrying send");
      return await sendAuthorMessage(page, instruction);
    }

    const cancelButton = page.getByRole("button", { name: /终止任务|取消/ }).last();
    if ((await cancelButton.count()) > 0) {
      log("input blocked by an active run — cancelling it before sending");
      recoveryDecisions.push({ kind: "active_run_recovery", decision: "cancel_then_send" });
      await withTimeout(cancelButton.click({ timeout: 10_000 }), 20_000, "cancel run click").catch(
        () => {},
      );
      const confirmButton = page.getByRole("button", { name: /^确认终止$/ });
      if ((await confirmButton.count()) > 0) {
        await withTimeout(confirmButton.click({ timeout: 10_000 }), 20_000, "confirm cancel click").catch(
          () => {},
        );
      }
      await withTimeout(
        page.locator(chatInputSelector).waitFor({ state: "visible", timeout: waitBudget("input") }),
        waitBudget("input") + 10_000,
        "chat input visible after cancel",
      );
    } else {
      throw waitError;
    }
  }
  log("chat input visible; filling instruction");
  await withTimeout(
    page.locator(chatInputSelector).fill(instruction),
    waitBudget("input"),
    "fill author input",
  );
  log("instruction filled; clicking send");
  const inputValueBeforeSend = await withTimeout(
    page.locator(chatInputSelector).inputValue(),
    10_000,
    "read input value",
  ).catch(() => "");
  fs.appendFileSync(
    pageDiagnosticsPath,
    `${JSON.stringify({
      at: new Date().toISOString(),
      kind: "before_send",
      instruction,
      input_value: inputValueBeforeSend,
      send_buttons: await withTimeout(
        page.getByRole("button", { name: /^发送$/ }).count(),
        10_000,
        "count send buttons",
      ).catch(() => -1),
    })}\n`,
  );
  await withTimeout(
    page.getByRole("button", { name: /^发送$/ }).click(),
    waitBudget("ack"),
    "send click",
  );
  log("sent; waiting for user_message ack");

  let ack;
  try {
    ack = await withTimeout(
      waitForFrame(
        (f) =>
          f.direction === "received" &&
          f.event === "phx_reply" &&
          f.body?.response?.received === true,
        "No user_message ack after sending instruction",
        waitBudget("ack"),
        fromIndex,
      ),
      waitBudget("ack") + 15_000,
      "user_message ack",
    );
  } catch (ackError) {
    await withTimeout(
      page.screenshot({ path: path.join(artifactDir, "ack-timeout.png"), fullPage: true }),
      20_000,
      "ack timeout screenshot",
    ).catch(() => {});
    fs.appendFileSync(
      pageDiagnosticsPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        kind: "ack_timeout",
        instruction,
        input_value_after_click: await withTimeout(
          page.locator(chatInputSelector).inputValue(),
          10_000,
          "read input after ack timeout",
        ).catch(() => ""),
        body_tail: String(
          await withTimeout(page.locator("body").innerText(), 15_000, "body").catch(() => ""),
        ).slice(-1500),
      })}\n`,
    );
    throw ackError;
  }
  return { fromIndex, turnId: ack.body?.response?.turn_id ?? null };
}

function frameBelongsToTurn(frame, turnId) {
  if (!turnId) return true;
  const frameTurn = String(frame.body?.turn_id ?? "");
  return frameTurn === turnId || frameTurn.startsWith(`${turnId}:`);
}

// ── B6：本真实旅程的帧判定契约单源（分类一次 + 穷尽分支）─────────────────────
//
// 契约真源（字段名/语义从这里引用，不在各调用点散写）：
// - `frontend/src/lib/socket.ts`：AgentRunStateData（status/phase 顶层，不嵌 turn_id）、
//   TurnResult（tool_result/adoption_state/truthfulness/available_actions）、
//   AuthorActionResult（action_status/receipt_id/turn_id）。
// - `apps/novel_application/lib/novel_application/agent_run_server.ex`
//   `no_progress_stopped?/1`：真正停下 = status == :awaiting_author 且 phase == :stopped。
// - 产品 action_result（overwrite/meta-leak 等确认）：status=needs_confirmation/accepted
//   顶层，artifact_id/decision.reason_codes 平铺。
//
// 本函数只做一次分类，返回判别联合；调用方必须对 kind 做穷尽 switch，新增结局只在
// 这里加一条分支，不在 waitForFrame 的 OR 列表与后续 if 链两处同步改。
function classifyJourneyFrame(frame, ctx = {}) {
  if (frame.direction !== "received") return { kind: "ignore" };
  const body = frame.body ?? {};

  if (frame.event === "phx_reply" && body.response?.received === true) {
    return { kind: "task_ack", turnId: body.response?.turn_id ?? null };
  }

  if (frame.event === "agent_run_state") {
    if (body.status === "awaiting_author" && body.phase === "stopped") {
      return { kind: "agent_awaiting_author", runId: body.run_id ?? null };
    }
    return { kind: "ignore" };
  }

  const toc = body.response ?? body;
  if (Array.isArray(toc?.volumes)) return { kind: "toc_projection", toc };

  if (frame.event === "action_result") {
    if (body.status === "needs_confirmation") {
      return {
        kind: "confirmation_required",
        confirmationKind: classifyConfirmationKind(body),
        artifactId: body.artifact_id ?? null,
        reasonCodes: body.decision?.reason_codes ?? [],
      };
    }
    if (body.status === "accepted") return { kind: "action_accepted", body };
    if (
      ["failed", "rejected", "error"].includes(String(body.status ?? "")) ||
      body.error ||
      body.outcome_detail ||
      (body.decision?.reason_codes ?? []).some((code) =>
        ["adoption_persistence_failed", "incomplete_scope"].includes(code),
      )
    ) {
      return {
        kind: "action_failed",
        body,
        status: body.status ?? null,
        message:
          body.error?.message ??
          body.error ??
          body.outcome_detail ??
          body.message ??
          (body.decision?.reason_codes ?? []).join(",") ??
          "action failed",
      };
    }
    return { kind: "ignore" };
  }

  if (frame.event !== "turn_result") return { kind: "ignore" };
  if (!frameBelongsToTurn(frame, ctx.turnId)) return { kind: "ignore" };

  const pending = body.adoption_state?.pending ?? [];
  const toolName = body.tool_result?.tool_name ?? null;

  if (body.truthfulness?.artifact_adopted === true) {
    return {
      kind: "adoption_settled",
      turnId: body.turn_id ?? null,
      resolved: body.adoption_state?.resolved ?? [],
      adoptedStateRef: body.truthfulness?.adopted_state_ref ?? null,
    };
  }

  if (
    body.status === "needs_confirmation" &&
    (body.available_actions ?? []).some(
      (action) => action.action_type === "confirm_before_execute",
    )
  ) {
    return {
      kind: "confirmation_required",
      confirmationKind: "confirm_before_execute",
      artifactId: body.adoption_state?.pending?.[0]?.artifact_id ?? null,
      reasonCodes: [],
    };
  }

  const prosePending = pending.find((entry) => entry.artifact_type === "prose_fragment");
  if (
    prosePending &&
    (toolName === "prose_writing" ||
      String(body.agent_run?.profile_ref ?? "").includes("prose"))
  ) {
    return { kind: "prose_ready", pending: prosePending, turnId: body.turn_id ?? null, toolName };
  }

  if (pending.length > 0) {
    return {
      kind: "candidate_ready",
      pending: pending[0],
      pendings: pending,
      artifactTypes: pending.map((entry) => entry.artifact_type),
      turnId: body.turn_id ?? null,
      toolName,
    };
  }

  if (body.agent_run?.status === "failed") {
    return { kind: "run_failed", turnId: body.turn_id ?? null };
  }

  if (
    body.agent_run?.status === "completed" &&
    !body.tool_result &&
    pending.length === 0 &&
    typeof body.assistant_message?.text === "string"
  ) {
    return { kind: "wrong_route_reply", assistantText: body.assistant_message.text };
  }

  return { kind: "turn_result_other", turnId: body.turn_id ?? null };
}

function classifyConfirmationKind(body) {
  const reasonCodes = body.decision?.reason_codes ?? [];
  if (reasonCodes.includes("meta_leak_detected")) return "meta_leak";
  const actionType = body.decision?.action_type ?? body.action_type;
  if (actionType === "confirm_before_execute") return "confirm_before_execute";
  return "overwrite_confirmation";
}

function assertNever(value, label) {
  throw new Error(`${label}: unhandled journey frame kind ${JSON.stringify(value)}`);
}

// B37 CP1 单源等待器：每 tick 分类一次 + 预算/心跳/看门狗/fail-fast。
// waitKind 必须来自 WAIT_BUDGET_DEFAULTS；调用方不传则默认 turn 预算。
async function waitForJourneyKind(predicate, message, timeoutMs = waitBudget("turn"), fromIndex = 0, waitKind = "turn") {
  const started = Date.now();
  const startedIso = new Date(started).toISOString();
  const record = {
    kind: waitKind,
    label: String(message).slice(0, 240),
    budget_ms: timeoutMs,
    started_at: startedIso,
    elapsed_ms: 0,
    outcome: "pending",
    last_frame: null,
  };
  currentWait = { kind: waitKind, label: record.label, started_at: startedIso, budget_ms: timeoutMs };
  appendWaitEvent({
    phase: "start",
    kind: waitKind,
    label: record.label,
    budget_ms: timeoutMs,
    from_index: fromIndex,
  });

  // 故障注入（仅 slice_verify dry-run；默认 off）：在等待起点立即触发，验证 fail-fast 路径。
  if (faultSim === "page_closed") {
    record.outcome = "fatal";
    record.elapsed_ms = Date.now() - started;
    waitRecords.push(record);
    appendWaitEvent({ phase: "fatal", kind: waitKind, label: record.label, code: "page_closed" });
    throw new DogfoodWaitError("page_closed", `fault-sim page_closed during ${record.label}`);
  }
  if (faultSim === "backend_down") {
    record.outcome = "fatal";
    record.elapsed_ms = Date.now() - started;
    waitRecords.push(record);
    appendWaitEvent({ phase: "fatal", kind: waitKind, label: record.label, code: "backend_down" });
    throw new DogfoodWaitError("backend_down", `fault-sim backend_down during ${record.label}`);
  }
  if (
    faultSim === "action_failed" &&
    /adopt|adoption|maintenance candidate|采纳/i.test(String(message))
  ) {
    record.outcome = "fatal";
    record.elapsed_ms = Date.now() - started;
    waitRecords.push(record);
    appendWaitEvent({ phase: "fatal", kind: waitKind, label: record.label, code: "action_failed" });
    throw new DogfoodWaitError(
      "action_failed",
      `fault-sim action_failed during ${record.label}: adoption persistence failed: :incomplete_scope`,
    );
  }

  let last = null;
  let lastHeartbeat = started;
  try {
    for (;;) {
      const elapsed = Date.now() - started;
      record.elapsed_ms = elapsed;
      if (activePage?.isClosed()) {
        throw new DogfoodWaitError("page_closed", `page/context closed during ${record.label}`, {
          kind: waitKind,
          elapsed_ms: elapsed,
        });
      }
      if (elapsed >= timeoutMs) {
        record.outcome = "timeout";
        throw new DogfoodWaitError(
          "wait_timeout",
          `${message} exceeded ${waitKind} budget ${timeoutMs}ms (elapsed ${elapsed}ms)\n  last classification: ${JSON.stringify(last)}\n  recent frames: ${frameDigest(fromIndex)}\n  turn_results: ${turnResultAutopsy(fromIndex)}`,
          { kind: waitKind, budget_ms: timeoutMs, elapsed_ms: elapsed },
        );
      }

      if (faultSim !== "stall") {
        for (let index = fromIndex; index < frames.length; index += 1) {
          const classification = classifyJourneyFrame(frames[index], { turnId: null });
          last = classification;
          if (classification.kind !== "ignore" && predicate(classification, frames[index])) {
            record.outcome = "matched";
            return { frame: frames[index], classification };
          }
        }
      }

      const now = Date.now();
      if (now - lastHeartbeat >= 10_000) {
        assertPageAlive(activePage, record.label);
        assertBackendAlive(record.label);
        if (!(await backendHealthAlive())) {
          throw new DogfoodWaitError(
            "backend_down",
            `backend /health unavailable while waiting: ${record.label}`,
            { kind: waitKind, elapsed_ms: now - started },
          );
        }
        if (activePage) {
          const visible = await activePage
            .locator("body")
            .innerText({ timeout: 1_500 })
            .catch(() => "");
          const failureMarker = ["作品档案写入失败", "采纳失败，原候选仍待采纳"].find((marker) =>
            visible.includes(marker),
          );
          if (failureMarker) {
            throw new DogfoodWaitError(
              "adoption_persistence_failed",
              `${message}: UI shows ${failureMarker}`,
              { kind: waitKind, elapsed_ms: now - started },
            );
          }
        }
        record.last_frame = frameDigest(fromIndex, 5);
        appendWaitEvent({
          phase: "heartbeat",
          kind: waitKind,
          label: record.label,
          elapsed_ms: now - started,
          page_alive: Boolean(activePage && !activePage.isClosed()),
          backend_health: "ok",
          last_frame: record.last_frame,
        });
        lastHeartbeat = now;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (error) {
    if (record.outcome === "pending") {
      record.outcome =
        error instanceof DogfoodWaitError && error.code === "wait_timeout"
          ? "timeout"
          : error instanceof DogfoodWaitError
            ? "fatal"
            : "error";
    }
    record.elapsed_ms = Date.now() - started;
    throw error;
  } finally {
    record.elapsed_ms = Date.now() - started;
    waitRecords.push(record);
    appendWaitEvent({
      phase: "end",
      kind: waitKind,
      label: record.label,
      budget_ms: timeoutMs,
      elapsed_ms: record.elapsed_ms,
      outcome: record.outcome,
      last_frame: record.last_frame,
    });
    currentWait = null;
  }
}

function waitFor(kind, predicate, label, fromIndex = 0) {
  return waitForJourneyKind(predicate, label, waitBudget(kind), fromIndex, kind);
}

// 作者采纳一条待采纳正文（首稿/续写）。B6：帧判定全部来自 classifyJourneyFrame，
// 这里只对判别联合做穷尽 switch；B9：每个 needs_confirmation 显式记录 confirm/skip。
async function adoptPendingDraft(page, chapterTitle, fromIndex, turnId = null, options = {}) {
  const first = await waitForJourneyKind(
    (classification) =>
      [
        "prose_ready",
        "candidate_ready",
        "wrong_route_reply",
        "run_failed",
        "agent_awaiting_author",
        "confirmation_required",
      ].includes(classification.kind),
    `No prose_fragment or confirmation turn_result for ${chapterTitle}`,
    waitBudget("turn"),
    fromIndex,
    "turn",
  );

  let classification = first.classification;
  switch (classification.kind) {
    case "wrong_route_reply":
      throw new Error(
        `judgment routed the prose request to a chat reply for ${chapterTitle} (wrong-route, fail fast): ${classification.assistantText?.slice(0, 200)}`,
      );
    case "run_failed":
      throw new Error(`agent run failed for ${chapterTitle} (fail fast)`);
    case "agent_awaiting_author":
      throw new Error(`agent run reached awaiting_author for ${chapterTitle} (tool failure, fail fast)`);
    case "candidate_ready":
      throw new Error(
        `prose request produced non-prose candidate(s) for ${chapterTitle}: ${classification.artifactTypes.join(",")} (misroute, fail fast)`,
      );
    case "confirmation_required":
      recordConfirmationDecision({
        kind: classification.confirmationKind,
        decision: "confirm",
        target: chapterTitle,
        reason_codes: classification.reasonCodes,
      });
      await confirmExecution(page, chapterTitle);
      return adoptPendingDraft(page, chapterTitle, fromIndex, turnId, options);
    case "prose_ready":
      break;
    default:
      assertNever(classification.kind, "adoptPendingDraft first");
  }

  const pending = classification.pending;
  const pendingArtifactId = pending.artifact_id;

  await page.waitForFunction(
    (labels) => labels.some((label) => document.body.innerText.includes(label)),
    PROSE_ACCEPT_LABELS,
    { timeout: 30_000 },
  );
  const acceptButton = page
    .getByRole("button", { name: new RegExp(`^(${PROSE_ACCEPT_LABELS.join("|")})$`) })
    .last();
  await acceptButton.click();

  let settle = await waitForJourneyKind(
    (candidate) =>
      (candidate.kind === "adoption_settled" &&
        candidate.resolved?.some((entry) => entry.artifact_id === pendingArtifactId)) ||
      (candidate.kind === "confirmation_required" &&
        candidate.artifactId === pendingArtifactId) ||
      candidate.kind === "action_accepted",
    `No adoption or overwrite-confirmation result for ${chapterTitle}`,
    waitBudget("adoption"),
    fromIndex,
    "adoption",
  );

  if (settle.classification.kind === "confirmation_required") {
    const confirmationKind = settle.classification.confirmationKind;
    const reasonCodes = settle.classification.reasonCodes;
    if (confirmationKind === "meta_leak") {
      metaLeakInterceptions.push({ chapter: chapterTitle, at: new Date().toISOString() });
      recordConfirmationDecision({
        kind: "meta_leak",
        decision: "confirm",
        target: chapterTitle,
        reason_codes: reasonCodes,
      });
      log(
        `${chapterTitle}: meta-leak adoption intercepted (#${metaLeakInterceptions.length}) — confirming explicitly`,
      );
    } else if (options.continuation && confirmationKind === "overwrite_confirmation") {
      recordConfirmationDecision({
        kind: "overwrite_confirmation",
        decision: "skip",
        target: chapterTitle,
        reason_codes: reasonCodes,
        reason: "unexpected overwrite confirmation for continuation (coordinate regression)",
      });
      throw new Error(
        `continuation for ${chapterTitle} produced an overwrite confirmation (coordinate regression)`,
      );
    } else {
      recordConfirmationDecision({
        kind: confirmationKind,
        decision: "confirm",
        target: chapterTitle,
        reason_codes: reasonCodes,
      });
      log(`${chapterTitle}: ${confirmationKind} — confirming explicitly`);
    }

    await confirmExecution(page, chapterTitle);
    settle = await waitForJourneyKind(
      (candidate) =>
        (candidate.kind === "adoption_settled" &&
          candidate.resolved?.some((entry) => entry.artifact_id === pendingArtifactId)) ||
        candidate.kind === "action_accepted",
      `No adoption turn_result after overwrite confirmation for ${chapterTitle}`,
      waitBudget("adoption"),
      fromIndex,
      "adoption",
    );
  }

  switch (settle.classification.kind) {
    case "adoption_settled":
    case "action_accepted":
      break;
    default:
      assertNever(settle.classification.kind, "adoptPendingDraft settle");
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
    .catch(() => {});
  return first.frame.body.turn_id;
}

async function confirmExecution(page, chapterTitle) {
  await page.waitForFunction(() => document.body.innerText.includes("确认执行"), null, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "确认执行" }).last().click();
  log(`${chapterTitle}: confirmed execution via real UI`);
}

// 增量扩章：作者自然语言要求接续生成新一批章节计划并采纳（p1-plan-incremental 链）。
// B7：自然作者语气，不再用旧的「剧情推进得不错…再生成一批」多子句。
async function planMoreChapters(page) {
  const { fromIndex } = await sendAuthorMessage(
    page,
    "后面的章节也写出来吧，接着现有章节往下规划一批新的章节计划。",
  );

  const outline = await waitForJourneyKind(
    (classification) =>
      classification.kind === "candidate_ready" &&
      classification.artifactTypes.includes("outline_draft") &&
      Number(classification.pending?.payload?.chapter_count ?? 0) >= 1,
    "No incremental outline_draft candidate while expanding the plan",
    waitBudget("candidate"),
    fromIndex,
    "candidate",
  );
  const pending = outline.classification.pending;

  await page.waitForFunction(() => document.body.innerText.includes("保存到大纲"), null, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "保存到大纲" }).last().click();

  await waitForJourneyKind(
    (classification) =>
      classification.kind === "adoption_settled" &&
      classification.resolved?.some((entry) => entry.artifact_id === pending.artifact_id),
    "No adoption turn_result while expanding the plan",
    waitBudget("adoption"),
    fromIndex,
    "adoption",
  );

  return Number(pending.payload?.chapter_count ?? 0);
}

// ── P1 CP0：维护组合插入点（真实自然语言入口；不改产品）──────────────────────
//
// canonical 10 章会话要求至少各一次：整章仅排版修订（B28）、整章内容修订（B28）、
// 章节重编号/结构维护（B30）、已有角色叙事身份修订（B29）。每类都像作者一样从
// 主输入发自然语言、在真实候选卡上采纳/确认；不接受脚本直写库旁路。
// 维护状态跨 resume 持久化，避免断点续跑重复改号/角色反转。
const maintenanceStatePath = path.join(artifactDir, "maintenance-state.json");

function loadMaintenanceState() {
  try {
    return JSON.parse(fs.readFileSync(maintenanceStatePath, "utf8"));
  } catch {
    return {
      completed: [],
      attempts: {},
      designed_character: null,
      designed_character_ref: null,
      details: [],
    };
  }
}

function saveMaintenanceState(state) {
  fs.writeFileSync(
    maintenanceStatePath,
    JSON.stringify({ ...state, updated_at: new Date().toISOString() }, null, 2),
  );
}

function settledChapterCount(toc) {
  return flatChapters(toc).filter((chapter) => Number(chapter.word_count ?? 0) >= minWords).length;
}

function chapterBySeq(toc, seq) {
  return flatChapters(toc).find((chapter) => Number(chapter.seq) === Number(seq)) ?? null;
}

async function adoptJourneyCandidate(page, classification, fromIndex, options = {}) {
  const pending = classification.pending;
  const timeoutMs = options.adoptionTimeoutMs ?? waitBudget("adoption");
  const actionResults = [];

  if (options.characterCandidate) {
    await clickInventoryAccept(page, {
      itemName: options.itemName,
      optionLabel: options.optionLabel,
      acceptFallback: "保存到作品档案",
    });
  } else {
    const acceptNames =
      options.acceptNames ?? /保存到作品|保存修订稿|保存为章节正文|保存原稿|保存到大纲/;
    const button = page.getByRole("button", { name: acceptNames }).last();
    await button.waitFor({ state: "visible", timeout: 30_000 });
    await button.click();
  }

  // 采纳失败快速路径（task：维护拍不能盲等 30min）：
  // 1) 产品 action_result 明确 failed/rejected（如 adoption persistence :incomplete_scope）；
  // 2) UI 明确显示「作品档案写入失败」等持久化失败文案。
  // 两者任一立即抛错，由 maybeRunMaintenanceBeats 记录该拍失败并继续后续拍/章节。
  const failureWait = page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        return ["作品档案写入失败", "adoption persistence failed", "采纳失败，原候选仍待采纳"].some(
          (marker) => text.includes(marker),
        );
      },
      null,
      { timeout: timeoutMs },
    )
    .then(() => {
      throw new Error(
        `maintenance candidate ${pending?.artifact_type ?? "?"} was not adopted: adoption persistence failed (UI: 作品档案写入失败)`,
      );
    });
  let settled;
  try {
    settled = await Promise.race([
      waitForJourneyKind(
        (candidate) => {
          if (candidate.kind === "action_failed") {
            return true;
          }
          if (candidate.kind === "adoption_settled") {
            return (
              !pending?.artifact_id ||
              (candidate.resolved ?? []).some((entry) => entry.artifact_id === pending.artifact_id)
            );
          }
          if (candidate.kind === "action_accepted") return true;
          return false;
        },
        `maintenance candidate ${pending?.artifact_type ?? "?"} was not adopted`,
        timeoutMs,
        fromIndex,
        "adoption",
      ),
      failureWait,
    ]);
  } finally {
    failureWait.catch(() => {});
  }

  if (settled.classification.kind === "action_failed") {
    throw new Error(
      `maintenance candidate ${pending?.artifact_type ?? "?"} adoption failed: ${String(
        settled.classification.message,
      ).slice(0, 300)}`,
    );
  }

  for (const frame of frames.slice(fromIndex)) {
    if (frame?.direction === "received" && frame?.event === "action_result") {
      actionResults.push(frame.body);
    }
  }
  const receipt =
    settled.classification.kind === "action_accepted"
      ? settled.classification.body
      : (actionResults.find((body) => body.status === "accepted") ?? null);

  return {
    artifact_type: pending?.artifact_type ?? null,
    artifact_id: pending?.artifact_id ?? null,
    resolved_turn_id: settled.frame?.body?.turn_id ?? null,
    receipt,
  };
}

async function sendMaintenanceMessage(page, instruction) {
  return sendAuthorMessage(page, instruction);
}

// 正文候选在分类器里可能是 prose_ready（prose_writing 工具 + prose_fragment）或
// candidate_ready（修订/其它流程的 prose_fragment）；维护节拍两者都认。
function isProseCandidate(classification) {
  return (
    classification.kind === "prose_ready" ||
    (classification.kind === "candidate_ready" &&
      classification.artifactTypes.includes("prose_fragment"))
  );
}

// 维护节拍等待候选时对“判成别的结局”快速失败（reply/run_failed），不再 30 分钟盲等
// （2026-10-25 dry-run 实锤：重编号被确定性 fixture 判成 clarify/casual_reply）。
// `agent_awaiting_author` 单独返回给调用方：产品可能是在向作者澄清段/对象，author
// 补一句消歧后继续（task-87）；其它拍若未配置消歧则显式失败，不静默等待。
async function waitForMaintenanceOutcome(predicate, label, fromIndex, timeoutMs = waitBudget("maintenance")) {
  const result = await waitForJourneyKind(
    (classification) =>
      predicate(classification) ||
      // 任何“另一个结局”都是终局：错误路由/run 失败/产品澄清/非预期候选，都快速交给调用方，
      // 不在 30 分钟窗口里盲等（task-87：避免 creative_directions 等非 character_seed 候选挂起）。
      [
        "wrong_route_reply",
        "run_failed",
        "agent_awaiting_author",
        "candidate_ready",
        "prose_ready",
      ].includes(classification.kind),
    label,
    timeoutMs,
    fromIndex,
    "maintenance",
  );
  if (result.classification.kind === "wrong_route_reply" || result.classification.kind === "run_failed") {
    const detail = result.classification.assistantText ?? result.classification.kind;
    throw new Error(
      `${label}: maintenance misroute/failure (${result.classification.kind}): ${String(detail).slice(0, 300)}`,
    );
  }
  if (
    (result.classification.kind === "candidate_ready" || result.classification.kind === "prose_ready") &&
    !predicate(result.classification)
  ) {
    const types =
      result.classification.kind === "candidate_ready"
        ? result.classification.artifactTypes
        : ["prose_ready"];
    throw new Error(
      `${label}: unexpected maintenance candidate type(s) ${JSON.stringify(types)} (misroute, no fake candidate)`,
    );
  }
  return result;
}

function assertNotAwaitingWithoutClarification(result, label) {
  if (result.classification.kind === "agent_awaiting_author") {
    throw new Error(`${label}: product asked author for clarification, but this beat has no scoped disambiguation`);
  }
}

// B28：整章仅排版修订（format_only）。
async function runFormatRevisionBeat(page, state, toc) {
  const seq = 3;
  const chapter = chapterBySeq(toc, seq);
  if (!chapter) throw new Error(`format revision target chapter seq=${seq} missing`);
  const wordsBefore = Number(chapter.word_count ?? 0);
  const title = chapter.title;
  const { fromIndex, turnId } = await sendMaintenanceMessage(
    page,
    `把${title}的正文整理一下，只调整分段和排版，不要改字句。`,
  );
  const candidate = await waitForMaintenanceOutcome(
    (classification) => isProseCandidate(classification),
    `format revision produced no prose candidate for ${title}`,
    fromIndex,
  );
  assertNotAwaitingWithoutClarification(candidate, "format revision");
  const adoption = await adoptJourneyCandidate(page, candidate.classification, fromIndex, {
    acceptNames: /保存修订稿|保存为章节正文|保存原稿/,
  });
  const afterToc = await readToc(page);
  const after = flatChapters(afterToc).find((item) => item.title === title);
  const detail = {
    beat: "format_revision",
    chapter: title,
    chapter_seq: seq,
    turn_id: turnId,
    words_before: wordsBefore,
    words_after: Number(after?.word_count ?? 0),
    candidate_payload_keys: Object.keys(candidate.classification.pending?.payload ?? {}),
    adoption,
  };
  state.details.push(detail);
  return { toc: afterToc, detail };
}

// B28：整章内容修订（目标片段仅一处）。
async function runContentRevisionBeat(page, state, toc) {
  const seq = 4;
  const chapter = chapterBySeq(toc, seq);
  if (!chapter) throw new Error(`content revision target chapter seq=${seq} missing`);
  const wordsBefore = Number(chapter.word_count ?? 0);
  const title = chapter.title;
  // task-87：明确到可执行段（"第一段"），避免"某一段"歧义；产品若仍澄清，作者补一句
  // 消歧继续，不把澄清算失败。
  const { fromIndex, turnId } = await sendMaintenanceMessage(
    page,
    `把${title}的正文第一段改得更紧张，只改这一段，其他段落别动。`,
  );
  let candidate = await waitForMaintenanceOutcome(
    (classification) => isProseCandidate(classification),
    `content revision produced no prose candidate for ${title}`,
    fromIndex,
  );
  if (candidate.classification.kind === "agent_awaiting_author") {
    const followUp = `就改${title}正文的第一段，其他段落别动。`;
    recordClarification({ beat: "content_revision", follow_up: followUp });
    log(`content_revision: product asked for clarification — author disambiguates: ${followUp}`);
    await sendMaintenanceMessage(page, followUp);
    candidate = await waitForMaintenanceOutcome(
      (classification) => isProseCandidate(classification),
      `content revision produced no prose candidate for ${title} after clarification`,
      fromIndex,
    );
    assertNotAwaitingWithoutClarification(candidate, "content revision after clarification");
  }
  const adoption = await adoptJourneyCandidate(page, candidate.classification, fromIndex, {
    acceptNames: /保存修订稿|保存为章节正文|保存原稿/,
  });
  const afterToc = await readToc(page);
  const after = flatChapters(afterToc).find((item) => item.title === title);
  const detail = {
    beat: "content_revision",
    chapter: title,
    chapter_seq: seq,
    turn_id: turnId,
    words_before: wordsBefore,
    words_after: Number(after?.word_count ?? 0),
    candidate_payload_keys: Object.keys(candidate.classification.pending?.payload ?? {}),
    adoption,
  };
  state.details.push(detail);
  return { toc: afterToc, detail };
}

// B30：章节重编号（点名对调；候选=chapter_structure_change_plan；保存到作品）。
async function runRenumberBeat(page, state, toc) {
  const seqA = 3;
  const seqB = 4;
  const titleA = chapterBySeq(toc, seqA)?.title;
  const titleB = chapterBySeq(toc, seqB)?.title;
  if (!titleA || !titleB) throw new Error(`renumber targets seq=${seqA}/${seqB} missing`);
  const { fromIndex, turnId } = await sendMaintenanceMessage(
    page,
    `把第一卷的第${String(seqA).padStart(2, "0")}章和第${String(seqB).padStart(2, "0")}章的编号对调，内容不要动。`,
  );
  const candidate = await waitForMaintenanceOutcome(
    (classification) =>
      classification.kind === "candidate_ready" &&
      classification.artifactTypes.includes("chapter_structure_change_plan"),
    "renumber produced no chapter_structure_change_plan candidate",
    fromIndex,
  );
  assertNotAwaitingWithoutClarification(candidate, "chapter renumber");
  const payload = candidate.classification.pending?.payload ?? {};
  const adoption = await adoptJourneyCandidate(page, candidate.classification, fromIndex, {
    acceptNames: /保存到作品/,
  });
  const afterToc = await readToc(page);
  const detail = {
    beat: "chapter_renumber",
    seq_pair: [seqA, seqB],
    title_pair: [titleA, titleB],
    turn_id: turnId,
    mapping: payload.change_plan?.mapping ?? null,
    object_count: payload.change_plan?.object_count ?? null,
    adoption,
  };
  state.details.push(detail);
  return { toc: afterToc, detail };
}

// 设计一个配角（供后续角色身份修订使用）。
async function runDesignCharacterBeat(page, state) {
  // task-87：真实作者口吻明确"设计并保存到作品档案"，期待 character_seed；若仍 reply
  // 则记录 wrong-route 失败，不造假。产品若先澄清，作者消歧继续，不算失败。
  const { fromIndex, turnId } = await sendMaintenanceMessage(
    page,
    "帮我设计并保存一个后面会用到、还没出场的配角到作品档案。",
  );
  let candidate = await waitForMaintenanceOutcome(
    (classification) =>
      classification.kind === "candidate_ready" &&
      classification.artifactTypes.includes("character_seed"),
    "character design produced no character_seed candidate",
    fromIndex,
  );
  if (candidate.classification.kind === "agent_awaiting_author") {
    const followUp = "方向由你定，设计一个后面会用到、还没出场的配角，并保存到作品档案。";
    recordClarification({ beat: "design_character", follow_up: followUp });
    log(`design_character: product asked for clarification — author disambiguates: ${followUp}`);
    await sendMaintenanceMessage(page, followUp);
    candidate = await waitForMaintenanceOutcome(
      (classification) =>
        classification.kind === "candidate_ready" &&
        classification.artifactTypes.includes("character_seed"),
      "character design produced no character_seed candidate after clarification",
      fromIndex,
    );
    assertNotAwaitingWithoutClarification(candidate, "design character after clarification");
  }
  const pendings = candidate.classification.pendings ?? [candidate.classification.pending];
  const target =
    pendings.find((entry) => entry.artifact_type === "character_seed") ?? pendings[0];
  const itemName = target.payload?.items?.[0]?.title ?? null;
  const sameSet = pendings.filter(
    (entry) =>
      String(entry.artifact_id).split("::")[0] === String(target.artifact_id).split("::")[0],
  );
  const optionLabel =
    sameSet.length > 1 ? `方案 ${String.fromCharCode(65 + sameSet.indexOf(target))}` : null;
  const adoption = await adoptJourneyCandidate(
    page,
    { ...candidate.classification, pending: target, pendings },
    fromIndex,
    { characterCandidate: true, itemName, optionLabel },
  );
  const afterToc = await readToc(page);
  state.designed_character = itemName;
  state.designed_character_ref = target.payload?.items?.[0]?.character_ref ?? null;
  const detail = {
    beat: "design_supporting_character",
    turn_id: turnId,
    character_name: itemName,
    character_ref: state.designed_character_ref,
    candidate_count: sameSet.length,
    adoption,
  };
  state.details.push(detail);
  return { toc: afterToc, detail };
}

// B29：已有角色叙事身份修订（把设计出的配角改为主角；主档案字段，非演化记忆）。
async function runRoleRevisionBeat(page, state) {
  const characterName = state.designed_character;
  if (!characterName) throw new Error("role revision beat requires a designed character first");
  const { fromIndex, turnId } = await sendMaintenanceMessage(
    page,
    `把${characterName}改为主角，其他角色不要动。`,
  );
  const candidate = await waitForMaintenanceOutcome(
    (classification) =>
      classification.kind === "candidate_ready" &&
      classification.artifactTypes.includes("character_profile_revision"),
    `role revision produced no character_profile_revision candidate for ${characterName}`,
    fromIndex,
  );
  assertNotAwaitingWithoutClarification(candidate, "character role revision");
  const payload = candidate.classification.pending?.payload ?? {};
  const adoption = await adoptJourneyCandidate(page, candidate.classification, fromIndex, {
    acceptNames: /保存到作品/,
  });
  const afterToc = await readToc(page);
  const detail = {
    beat: "character_role_revision",
    character_name: characterName,
    turn_id: turnId,
    changes: payload.changes ?? null,
    character_ref: payload.character_ref ?? null,
    adoption,
  };
  state.details.push(detail);
  return { toc: afterToc, detail };
}

const MAINTENANCE_BEATS = [
  { id: "design_character", after_settled: 2, run: runDesignCharacterBeat },
  { id: "format_revision", after_settled: 3, run: runFormatRevisionBeat },
  { id: "content_revision", after_settled: 4, run: runContentRevisionBeat },
  { id: "chapter_renumber", after_settled: 6, run: runRenumberBeat },
  { id: "character_role_revision", after_settled: 8, run: runRoleRevisionBeat },
];

async function maybeRunMaintenanceBeats(page, toc, state) {
  if (!maintenanceEnabled) return toc;
  let currentToc = toc;
  const settled = settledChapterCount(currentToc);

  for (const beat of MAINTENANCE_BEATS) {
    const forcedRetry = maintenanceRetryIds.includes(beat.id);
    if (state.completed.includes(beat.id) && !forcedRetry) continue;
    if (!forcedRetry && settled < beat.after_settled) continue;
    state.attempts[beat.id] = (state.attempts[beat.id] ?? 0) + 1;
    if (state.attempts[beat.id] > 2) {
      log(`maintenance beat ${beat.id} skipped after repeated failures`);
      continue;
    }

    log(`maintenance beat ${beat.id} start (settled=${settled})`);
    try {
      const result = await withTimeout(
        beat.run(page, state, currentToc),
        waitBudget("maintenance"),
        `maintenance beat ${beat.id}`,
      );
      currentToc = result.toc ?? currentToc;
      state.completed.push(beat.id);
      saveMaintenanceState(state);
      appendProgress({ maintenance_beat: beat.id, result: result.detail });
      log(`maintenance beat ${beat.id} done`);
    } catch (error) {
      if (isFatalWaitError(error)) throw error;
      state.attempts = state.attempts ?? {};
      state.details.push({
        beat: beat.id,
        error: String(error?.message ?? error),
        attempt: state.attempts[beat.id],
      });
      saveMaintenanceState(state);
      appendProgress({
        maintenance_beat_error: { beat: beat.id, error: String(error?.message ?? error) },
      });
      log(`maintenance beat ${beat.id} failed (run continues): ${error?.message ?? error}`);
      await withTimeout(
        page.screenshot({
          path: path.join(artifactDir, `maintenance-${beat.id}-failure.png`),
          fullPage: true,
        }),
        20_000,
        "maintenance failure screenshot",
      ).catch(() => {});
      await closeArchiveIfOpen(page).catch(() => {});
      try {
        currentToc = await readToc(page);
      } catch (tocError) {
        log(`readToc after maintenance failure also failed: ${tocError?.message ?? tocError}`);
      }
    }
  }

  return currentToc;
}

async function driveChapterTurn(page, chapter) {
  const words = Number(chapter.word_count ?? 0);
  const continuation = words > 0;
  // B7：自然作者短句——不再塞「根据已采纳章节计划…保持为待采纳草稿」四子句，
  // 计划/上下文由产品主链注入，避免措辞助推判断 plan 判界方差。
  const instruction = continuation
    ? `接着${chapter.title}往下写一段吧。`
    : `${chapter.title}的正文还没写，帮我写出来吧。`;

  const { fromIndex, turnId } = await sendAuthorMessage(page, instruction);
  return adoptPendingDraft(page, chapter.title, fromIndex, turnId, { continuation });
}

async function exportBook(page) {
  // M5 实锤（2026-08-25）：异常恢复后页面可能已停在阅读模式——「阅读」按钮不存在，
  // 硬点 30s 超时且未捕获直接杀死整跑。两种起点都认：不在阅读模式才点「阅读」。
  const readButton = page.getByRole("button", { name: "阅读", exact: true });
  if ((await readButton.count()) > 0) {
    await readButton.click();
  }
  await page.waitForFunction(() => document.body.innerText.includes("阅读模式"), null, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "导出全书" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("已导出到"), null, {
    timeout: waitBudget("export"),
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
  // 候选名是运行期数据，不拼进正则（动态 RegExp 会被静态扫描判 ReDoS）：
  // Playwright 的 name 传字符串即按可访问名子串匹配，静态正则只用来限定按钮语义。
  const acceptNamePattern = /(保存.*作品档案|采纳.*全书规划)/;

  if (itemName) {
    const radio = page.getByRole("radio", { name: itemName });
    if ((await radio.count()) > 0) {
      await radio.last().check();
      const selected = page.getByRole("button", {
        name: /(保存方案 .* 到作品档案|采纳方案 .* 为全书规划)/,
      });
      if ((await selected.count()) > 0) {
        await selected.last().click();
        return `candidate:${itemName}`;
      }
      const anyAccept = page
        .getByRole("button", { name: acceptNamePattern })
        .and(page.locator("button:not([disabled])"));
      await anyAccept.last().click();
      return `candidate-loose:${itemName}`;
    }

    const named = page
      .getByRole("button", { name: itemName })
      .and(page.getByRole("button", { name: acceptNamePattern }));
    if ((await named.count()) > 0) {
      await named.last().click();
      return `named:${itemName}`;
    }
  }

  if (optionLabel) {
    const radio = page.getByRole("radio", { name: optionLabel });
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
    waitBudget("candidate"),
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
    // 规划建议同样可能渲染成候选组（一次盘点常产多条规划字段建议）——必须带
    // itemName 走「先选候选再点启用按钮」路径，否则按钮恒 disabled 点不动。
    const skeletonName = itemField(unit.payload?.items?.[0], "title");
    await adoptInventoryUnit(
      page,
      unit,
      { itemName: skeletonName, optionLabel: null, acceptFallback: "采纳为全书规划" },
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

// B9：空章/重复段观察器（确定性统计，接进章节质量/连续性报告与 summary）。
// 以最终导出 Markdown 的 `## 章标题` 分节做观察；导出不可解析时退回 TOC 字数判断，
// 并在报告里显式标注覆盖来源，不把“没检测到”说成“没有”。
function observeChapterQuality(exportPath, toc) {
  const chapters = flatChapters(toc);
  let exportText = "";
  try {
    exportText =
      exportPath && fs.existsSync(exportPath) ? fs.readFileSync(exportPath, "utf8") : "";
  } catch {
    exportText = "";
  }

  const sections = [];
  if (exportText) {
    const headingPattern = /^##\s+(.+?)\s*$/gm;
    const matches = [...exportText.matchAll(headingPattern)];
    matches.forEach((match, index) => {
      const startIndex = match.index + match[0].length;
      const endIndex =
        index + 1 < matches.length ? matches[index + 1].index : exportText.length;
      const body = exportText.slice(startIndex, endIndex);
      const paragraphs = body
        .split(/\n\s*\n/u)
        .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
        .filter((paragraph) => paragraph.length > 0);
      sections.push({
        title: match[1].trim(),
        effective_chars: body.replace(/[\s\p{P}]/gu, "").length,
        paragraphs,
      });
    });
  }

  const emptyFromExport = sections
    .filter((section) => section.effective_chars === 0)
    .map((section) => section.title);
  const emptyFromToc = chapters
    .filter((chapter) => Number(chapter.word_count ?? 0) === 0)
    .map((chapter) => chapter.title);
  const emptyChapters = [...new Set([...emptyFromToc, ...emptyFromExport])];

  const paragraphOccurrences = new Map();
  for (const section of sections) {
    for (const paragraph of section.paragraphs) {
      if (paragraph.length < 80) continue;
      const current = paragraphOccurrences.get(paragraph) ?? { count: 0, chapters: [] };
      current.count += 1;
      if (!current.chapters.includes(section.title)) current.chapters.push(section.title);
      paragraphOccurrences.set(paragraph, current);
    }
  }
  const duplicateParagraphs = [...paragraphOccurrences.entries()]
    .filter(([, occurrence]) => occurrence.count > 1)
    .map(([paragraph, occurrence]) => ({
      excerpt: paragraph.slice(0, 120),
      length: paragraph.length,
      count: occurrence.count,
      chapters: occurrence.chapters,
    }));

  return {
    source: sections.length > 0 ? "export_markdown_sections" : "toc_word_count_only",
    exported_section_count: sections.length,
    chapter_count: chapters.length,
    empty_chapters: emptyChapters,
    empty_chapter_count: emptyChapters.length,
    duplicate_paragraphs: duplicateParagraphs,
    duplicate_paragraph_count: duplicateParagraphs.length,
    duplicate_chapter_pairs: duplicateParagraphs
      .filter((item) => item.chapters.length > 1)
      .map((item) => item.chapters),
  };
}

function maintenanceDetailLines() {
  try {
    const state = JSON.parse(fs.readFileSync(maintenanceStatePath, "utf8"));
    const details = Array.isArray(state.details) ? state.details : [];
    if (details.length === 0) return ["- （本轮无维护节拍记录）"];
    return details.map((detail) => {
      if (detail.error) return `- ${detail.beat}：失败（${detail.error}）`;
      const summary = {
        beat: detail.beat,
        chapter: detail.chapter ?? detail.character_name ?? null,
        words:
          detail.words_before != null
            ? `${detail.words_before} → ${detail.words_after}`
            : null,
        mapping: detail.mapping ?? detail.changes ?? null,
        artifact: detail.adoption?.artifact_type ?? null,
      };
      return `- ${JSON.stringify(summary)}`;
    });
  } catch {
    return ["- （本轮无维护节拍记录）"];
  }
}

function writeArtifacts(toc, exportPath, runMeta) {
  const chapters = flatChapters(toc);
  const total = Number(toc?.total_word_count ?? 0);
  const belowMin = chapters.filter((c) => Number(c.word_count ?? 0) < minWords);
  const qualityObservation = observeChapterQuality(exportPath, toc);

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
        quality_observation: qualityObservation,
        confirmation_counts: confirmationCounts(),
        confirmation_decisions: confirmationDecisions,
        recovery_decisions: recoveryDecisions,
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
    "",
    "## 空章与重复段观察（B9，确定性统计）",
    "",
    `- 观察来源：${qualityObservation.source}（导出分节 ${qualityObservation.exported_section_count} 个，TOC 章数 ${qualityObservation.chapter_count}）`,
    `- 空章数：${qualityObservation.empty_chapter_count}${
      qualityObservation.empty_chapters.length > 0 ? `（${qualityObservation.empty_chapters.join("、")}）` : ""
    }`,
    `- 重复段（≥80 字完全相同段落）：${qualityObservation.duplicate_paragraph_count}`,
    ...qualityObservation.duplicate_paragraphs.map(
      (item) => `  - ${item.count} 次｜${item.chapters.join("、")}｜「${item.excerpt}…」（${item.length} 字）`,
    ),
    "",
    "## 维护动作（真实 UI/自然语言，非旁路）",
    "",
    ...maintenanceDetailLines(),
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
    `- 空章观察（B9）：${qualityObservation.empty_chapter_count} 个${
      qualityObservation.empty_chapters.length > 0 ? `（${qualityObservation.empty_chapters.join("、")}）` : ""
    }`,
    `- 重复段观察（B9）：${qualityObservation.duplicate_paragraph_count} 段（≥80 字相同段落）`,
    `- 确认路径（B9）：confirm ${confirmationCounts().confirmed} 次 / skip ${confirmationCounts().skipped} 次`,
    `- 恢复路径：${recoveryDecisions.length} 次（${JSON.stringify(recoveryDecisions)}）`,
    "",
    "## 维护组合插入点",
    "",
    ...maintenanceDetailLines(),
  ];
  fs.writeFileSync(path.join(artifactDir, "continuity-report.md"), continuityLines.join("\n"));

  if (exportPath && fs.existsSync(exportPath)) {
    fs.copyFileSync(exportPath, path.join(artifactDir, "export", path.basename(exportPath)));
  }
}

// M7 公平对照桥路（D6 CP2）：开跑前把思考档位显式写进运行时 provider 配置。
// 走产品公开 config API（su01-lmstudio-disconnected 判例：config API 属外部公开面），
// 不依赖 server 进程 env 求值链（M7 首启实锤该链存在未解之谜，显式优于隐式）。
const reasoningEffort = (process.env.DOGFOOD_REASONING_EFFORT ?? "").trim();
const apiBaseUrl = process.env.DOGFOOD_API_BASE_URL ?? "http://127.0.0.1:4657";
if (reasoningEffort && provider === "lmstudio") {
  const effortRes = await fetch(`${apiBaseUrl}/api/provider/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "lmstudio", reasoning_effort: reasoningEffort }),
  });
  if (!effortRes.ok) {
    throw new Error(`configure reasoning_effort failed: HTTP ${effortRes.status}`);
  }
  log(`reasoning_effort=${reasoningEffort} applied via provider config API`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60_000);
activePage = page;
startWatchdog(page);
const pageDiagnosticsPath = path.join(artifactDir, "page-diagnostics.jsonl");
page.on("pageerror", (error) => {
  fs.appendFileSync(
    pageDiagnosticsPath,
    `${JSON.stringify({ at: new Date().toISOString(), kind: "pageerror", message: error?.message })}\n`,
  );
});
page.on("console", (message) => {
  if (message.type() !== "error" && message.type() !== "warning") return;
  fs.appendFileSync(
    pageDiagnosticsPath,
    `${JSON.stringify({ at: new Date().toISOString(), kind: `console_${message.type()}`, text: message.text().slice(0, 500) })}\n`,
  );
});

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
// B9：needs_confirmation 显式确认/跳过计数 + 恢复路径判定计数，全部进 summary。
const confirmationDecisions = [];
const recoveryDecisions = [];
// P1 CP0 维护补验：产品澄清（awaiting_author）→ runner 消歧继续的次数/内容（不算失败）。
const clarificationEvents = [];
// VS-00G 盘点节拍（M4）：R5 阈值后由 runner 模拟作者响应产品引导发起一次盘点。
const inventoryBeat = { attempted: false, attempts: 0, done: false, result: null };

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: waitBudget("input") });
  await page.waitForFunction(() => document.body.innerText.includes("同步已连接"), null, {
    timeout: 30_000,
  });

  let toc = await readToc(page);
  const maintenanceState = loadMaintenanceState();
  log(
    `start: ${flatChapters(toc).length} chapters, total ${toc.total_word_count} words; ` +
      `provider=${provider} plan_chapters=${planChapters || "all"} min_words=${minWords} ` +
      `maintenance=${maintenanceEnabled ? "on" : "off"} resume_completed_beats=${JSON.stringify(maintenanceState.completed)}`,
  );

  let stoppedForBreakpoint = false;

  if (maintenanceOnly) {
    // task-87 维护补验：同一 canonical DB/证据目录，不写章节，只重置并强制回放指定维护拍。
    // 这是验收支架模式，不替代 canonical，也不重跑章节/不换分。
    log(`maintenance-only replay: retry_ids=${JSON.stringify(maintenanceRetryIds)}`);
    for (const id of maintenanceRetryIds) {
      maintenanceState.completed = (maintenanceState.completed ?? []).filter((beatId) => beatId !== id);
      if (maintenanceState.attempts) delete maintenanceState.attempts[id];
    }
    saveMaintenanceState(maintenanceState);
    appendProgress({ maintenance_only_replay: maintenanceRetryIds });
    toc = await maybeRunMaintenanceBeats(page, toc, maintenanceState);
  } else {
  // 逐章推进：每轮处理一个未达标章的一次产出（首稿或续写），失败重试一次后跳过。
  // maxChapters 限制的是“本次推进了多少个不同的章”，0 = 跑到全部达标。
  const advancedTitles = new Set();
  const skippedTitles = new Set();
  let planFailures = 0;

  for (;;) {
    const chapter = nextPendingChapter(toc, skippedTitles, planChapters, onlySeq);

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
        if (isFatalWaitError(error)) throw error;
        planFailures += 1;
        appendProgress({ plan_expansion_error: String(error?.message ?? error) });
        log(`plan expansion error: ${error?.message ?? error}`);
        // M5 实锤（2026-08-25）：此处恢复 readToc 裸奔——它再抛（输入框被困 60s）就是
        // 未捕获异常、整个 runner 崩死。失败时保留旧 toc 继续循环，下一轮再自愈。
        try {
          toc = await readToc(page);
        } catch (tocError) {
          log(`readToc after expansion error also failed (keeping stale toc): ${tocError?.message ?? tocError}`);
        }
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

      // P1 CP0：本章达标后按 settled 阈值触发维护组合（排版/内容修订、重编号、角色身份），
      // 每个动作都走真实主输入/候选卡；失败记录重试但不阻断主链。
      toc = await maybeRunMaintenanceBeats(page, toc, maintenanceState);

      if (stopAfterAdvanced > 0 && advancedTitles.size >= stopAfterAdvanced) {
        stoppedForBreakpoint = true;
        appendProgress({
          stopped_for_resume_breakpoint: true,
          advanced: [...advancedTitles],
          maintenance_completed: maintenanceState.completed,
        });
        log(
          `stopped after ${advancedTitles.size} advanced chapters for resume rehearsal (maintenance=${JSON.stringify(
            maintenanceState.completed,
          )})`,
        );
        break;
      }

      // VS-00G 盘点节拍：达标章数过 R5 阈值（10+2 缓冲）后模拟作者响应补全引导，
      // 一次性发起盘点并采纳主角/全书规划——之后收官守则、弧光账、R7/R8 全部上线。
      // 节拍阈值用固定下限，不绑当轮 --min-words：节拍语义是「书已经写够章数、
      // 该盘点补全设定了」，与本轮把字数目标抬到多少无关（否则调高 min-words
      // 会连带把节拍推迟到重写完所有章之后）。
      const settledChapters = flatChapters(toc).filter(
        (c) => Number(c.word_count ?? 0) >= BEAT_SETTLED_MIN_WORDS,
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
          if (isFatalWaitError(error)) throw error;
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
      if (isFatalWaitError(error)) throw error;
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

  }

  // 导出后页面停在阅读模式；最终 toc 用循环尾的最新投影。
  // 断点续跑演练 phase1 不导出，phase2 resume 后照常导出。
  let exportPath = "";
  if (stoppedForBreakpoint) {
    log("resume rehearsal breakpoint: skip export in this partial run");
  } else {
    try {
      exportPath = await exportBook(page);
      log(`exported to ${exportPath}`);
    } catch (exportError) {
      log(`export failed (continuing to write artifacts): ${exportError?.message ?? exportError}`);
      appendProgress({ export_error: String(exportError?.message ?? exportError) });
    }
  }

  writeArtifacts(toc, exportPath, {
    chapters_advanced_this_run: chaptersAdvanced,
    target_plan_chapters: planChapters,
    maintenance_enabled: maintenanceEnabled,
    maintenance_only_replay: maintenanceOnly,
    maintenance_retry_ids: maintenanceRetryIds,
    maintenance_state: maintenanceState,
    clarification_events: clarificationEvents,
    stopped_for_resume_breakpoint: stoppedForBreakpoint,
    plan_version: "p1-cp0-10",
    retry_thermometer: retryThermometer(failures),
    failures,
    // B9 体温计（M4 审计靶）：对照 M3 的 25 处静默泄漏存活。
    meta_leak_interceptions: metaLeakInterceptions.length,
    meta_leak_intercepted_chapters: metaLeakInterceptions,
    // VS-00G 盘点节拍结果（补全回路长跑表现）。
    inventory_beat: inventoryBeat,
    wait_stats: waitStats(),
    wait_events_path: WAIT_EVENTS_PATH,
    run_duration_ms: Date.now() - startedAt,
  });

  await page
    .screenshot({
      path: path.join(artifactDir, "dogfood-final.png"),
      fullPage: true,
    })
    .catch((screenshotError) => {
      log(`final screenshot skipped: ${screenshotError?.message ?? screenshotError}`);
    });
  log("artifacts written");
} catch (error) {
  // 外部 SIGTERM/浏览器关闭等事故下，page/context 可能已关闭；最终截图不能覆盖原始错误。
  // 记录结构化 failure 后抛错，让 runner 以非零退出码结束（由上层 trap 清理）。
  try {
    if (!page.isClosed()) {
      await page.screenshot({
        path: path.join(artifactDir, "dogfood-failure.png"),
        fullPage: true,
      });
    } else {
      log("failure screenshot skipped: page already closed");
    }
  } catch (screenshotError) {
    log(`failure screenshot skipped: ${screenshotError?.message ?? screenshotError}`);
  }
  recordFailureFile(error, { source: "runner", run_duration_ms: Date.now() - startedAt });
  log("failure.json written");
  throw error;
} finally {
  stopWatchdog();
  await browser.close().catch((closeError) => {
    log(`browser close skipped: ${closeError?.message ?? closeError}`);
  });
}
