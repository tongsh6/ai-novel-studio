// B71 §16.16 第 2 类入口（安全点自动维护）原生外部驱动（journey=auto-maintenance）。
//
// 真实 strata + 小窗口压力（NOVEL_CONTEXT_WINDOW_OVERRIDES="strata:4096"）+
// NOVEL_AUTO_MAINTENANCE_ENABLED=1：≥2 次真实续行形成更早工作回合 → 安全点自动整理 →
// 行内细条 → 展开（原因/原文保留/来源/完整记录入口）→ 下一请求精简 → 刷新幂等 →
// 失败静默（隔离 test DB 持久 trigger）→ 全类别 AX 扫描 → 清理。
//
// 不伪造窗口、不注入 usage、不手工压缩；无法形成真实压力时如实记录未闭环。
// direct A3 与正式 live multi-turn（已触发且下一页面请求确定完成）共用
// 重启/失败/恢复尾段；ANSWER_MODE / smoke 不跑，不新增模式开关。
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { readJson } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import { all, dbPath, frameEvent, logs, withDb, write } from "./lib/native_ui/scenario_evidence.mjs";
import { actionAck } from "./lib/native_ui/authoring_pending_evidence.mjs";
import { sleep, typeText } from "./lib/native_ui/driver.mjs";
import { classifyTurnBody, dbTerminal, wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import {
  DEFAULT_STRATA_ENDPOINT,
  readStrataState,
  strataLifecycleRecord,
  strataSlotCheck,
  unloadStrata,
} from "./lib/native_ui/strata_lifecycle.mjs";
import {
  AUTO_MAINTENANCE_REQUESTS,
  scanAuthorVisibleFiles,
} from "./lib/native_ui/authoring_auto_maintenance_evidence.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b71_auto_maintenance_drive.mjs <batch-run-dir>");
  process.exit(64);
}

const evidence = path.join(ROOT, "scripts/native_b71_evidence.mjs");
const harness = new NativeScenarioHarness(dir);
const strataEndpoint = (() => {
  const configured = process.env.NOVEL_STRATA_ENDPOINT ?? DEFAULT_STRATA_ENDPOINT;
  return String(configured).replace(/\/v1\/?$/u, "").replace(/\/+$/u, "");
})();
const TURN_TIMEOUT_MS = Number(process.env.B71_AUTO_MAINT_TURN_TIMEOUT_MS ?? 360_000);
const INPUT_TIMEOUT_MS = Number(process.env.B71_AUTO_MAINT_INPUT_TIMEOUT_MS ?? 120_000);
const READY_TIMEOUT_MS = Number(process.env.B71_AUTO_MAINT_READY_TIMEOUT_MS ?? 180_000);
const FLOW_LABEL = "b71-auto-maint";

const envFacts = {
  auto_maintenance_enabled: process.env.NOVEL_AUTO_MAINTENANCE_ENABLED ?? null,
  window_overrides: process.env.NOVEL_CONTEXT_WINDOW_OVERRIDES ?? null,
};
const ANSWER_MODE = process.env.B71_ANSWER_MODE === "1";
const ANSWER_MODE_REQUEST =
  process.env.B71_ANSWER_MODE_REQUEST ?? "第01章结尾有两个方向，先让我选择。";
const ANSWER_MODE_CHOICE = process.env.B71_ANSWER_MODE_CHOICE ?? "保留悬念";
const INTERLEAVED_RESUME = process.env.B71_AUTO_MAINT_INTERLEAVED_RESUME === "1";

const checkpointEventCount = () =>
  withDb(dir, (db) =>
    Number(
      all(db, "SELECT COUNT(*) AS c FROM agent_events WHERE event_type = 'checkpoint_created'")[0]?.c ?? 0,
    ),
  );

// canonical checkpoint 消息计数：直接按 role 列 COUNT，不读全表再解析 JSON。
const checkpointMessageCount = () =>
  withDb(dir, (db) =>
    Number(
      all(db, "SELECT COUNT(*) AS c FROM authoring_session_messages WHERE role = 'checkpoint'")[0]?.c ?? 0,
    ),
  );

// 触发回合以 checkpoint_created 事件所属 run 为唯一身份（事件携带真实 run_id）。
// 调用方只把它与本批已发送回合匹配；无匹配时记录缺证，不回退最近候选或父 turn。
const latestCheckpointRunId = () =>
  withDb(dir, (db) =>
    all(
      db,
      "SELECT run_id FROM agent_events WHERE event_type = 'checkpoint_created' ORDER BY inserted_at DESC, rowid DESC LIMIT 1",
    )[0]?.run_id ?? null,
  );

const llmRecordCount = () => logs(path.join(dir, "llm-calls")).length;

function readRunRow({ turnId, runId }) {
  return withDb(dir, (db) => {
    const rows = runId
      ? all(db, "SELECT id, status, parent_turn_ref, run_mode FROM agent_runs WHERE id = ?", [runId])
      : all(
          db,
          "SELECT id, status, parent_turn_ref, run_mode FROM agent_runs WHERE parent_turn_ref = ? ORDER BY inserted_at DESC",
          [turnId],
        );
    return rows.at(-1) ?? null;
  });
}

async function waitRunTerminal({ turnId, runId }) {
  let observed = null;
  const terminal = await harness.runStep("turn", "run_terminal", () =>
    harness.pollWire(
      (wire) => {
        const fromWire = wireTerminal(wire, { turnId, runId: runId || null });
        if (fromWire) {
          observed = { ...fromWire, source: "wire" };
          return observed;
        }
        const row = readRunRow({ turnId, runId: runId || null });
        const fromDb = dbTerminal(row);
        if (fromDb) {
          observed = { ...fromDb, source: "db", row };
          return observed;
        }
        return null;
      },
      TURN_TIMEOUT_MS,
      `${FLOW_LABEL}:terminal`,
    ),
  );
  return terminal ?? observed;
}

function findStripButton(nodes) {
  const matches = nodes.filter(
    (node) =>
      node?.role === "AXButton" &&
      (String(node.title ?? "").includes("较早的") ||
        String(node.desc ?? "").includes("较早的") ||
        String(node.desc ?? "").includes("查看已整理的较早创作过程") ||
        String(node.title ?? "").includes("创作过程已整理")),
  );
  return matches.at(-1) ?? null;
}

const SETTLE_ANSWER_BUDGET = 6;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

// waitRunPauseOrTerminal 把 completed/failed/cancelled 统一返回 kind="terminal" + status；
// wireTerminal/dbTerminal 则直接返回 completed/failed。这里适配一次，settle 只把
// completed 视为真实续行成功，failed/cancelled 都是终止而非成功。
function settlementOf(value) {
  if (!value) return { kind: null, status: null, completed: false, terminal: false };
  if (value.kind === "terminal") {
    const status = String(value.status ?? "");
    return { kind: status || "terminal", status, completed: status === "completed", terminal: true };
  }
  const kind = String(value.kind ?? "");
  return {
    kind,
    status: value.status ?? null,
    completed: kind === "completed",
    terminal: TERMINAL_STATUSES.has(kind),
  };
}

// 当前 run 在 wire 上最新一条 status=open 的 turn_result.author_question。
function openAuthorQuestionFor(wire, runId) {
  let latest = null;
  for (const record of wire) {
    if (record?.direction !== "received" || frameEvent(record) !== "turn_result") continue;
    const question = record?.frame?.[4]?.author_question;
    if (!question || String(question.run_id ?? "") !== String(runId ?? "")) continue;
    if (String(question.status ?? "") !== "open") continue;
    latest = question;
  }
  return latest;
}

// answer 专有比对：复用 actionAck 的 join/topic/request ref + 唯一回包，
// 再要求 question_ref/run_id/action_id/source_turn_ref/goal_version 精确匹配。
function authorChoiceAckFor(wire, { runId, wireStart, expected }) {
  if (!runId || !expected?.question_ref) return null;
  const matches = [];
  for (const record of wire.slice(wireStart)) {
    if (record?.direction !== "sent" || frameEvent(record) !== "author_action") continue;
    const action = record?.frame?.[4]?.action;
    if (action?.action_type !== "author_choice") continue;
    if (String(action?.target_ref ?? "") !== String(runId)) continue;
    if (String(action?.payload?.question_ref ?? "") !== String(expected.question_ref)) continue;
    if (Number(action?.payload?.expected_goal_version) !== Number(expected.goal_version)) continue;
    let ack;
    try {
      ack = actionAck(wire, record, { actionStatus: "accepted" });
    } catch {
      continue;
    }
    const response = ack.response ?? {};
    if (String(response.action_type ?? "") !== "author_choice") continue;
    if (String(response.run_id ?? "") !== String(runId)) continue;
    if (String(response.action_id ?? "") !== String(action.action_id ?? "")) continue;
    if (String(response.source_turn_ref ?? "") !== String(action.source_turn_ref ?? "")) continue;
    if (String(response.question_ref ?? "") !== String(expected.question_ref)) continue;
    if (Number(response.goal_version) !== Number(expected.goal_version) + 1) continue;
    matches.push({ action, reply: ack.reply, response });
  }
  return matches.length === 1 ? matches[0] : null;
}

// 同 run 有界问答：每轮只回答 wire 上真实 open 的当前问题；点击前不按 AX 文本猜，
// 点击后以本次 wire 的 author_choice ACK 绑定。下一次 awaiting 必须看到该 run 的
// 新 question_ref/goal_version 才允许再点；checkpoint 早停仅供 warm-up 及时截图。
async function settleAuthorRun({
  runId,
  text,
  checkpointBaseline,
  checkpointEarlyStop,
  answerBudget = SETTLE_ANSWER_BUDGET,
}) {
  const attempts = [];
  let last = null;
  let reason = null;
  let answers = 0;
  let previousQuestionRef = null;
  let previousGoalVersion = null;
  while (true) {
    last = await waitRunPauseOrTerminal({ runId });
    const outcome = settlementOf(last);
    if (outcome.terminal) {
      reason = outcome.completed ? null : outcome.kind;
      break;
    }
    if (outcome.kind !== "paused") {
      reason = `run_${outcome.kind}`;
      break;
    }
    if (checkpointEarlyStop && checkpointEventCount() > checkpointBaseline) {
      reason = "checkpoint_during_settle";
      break;
    }
    if (answers >= answerBudget) {
      reason = "answer_budget_exhausted";
      break;
    }
    let expected;
    try {
      expected = await harness.runStep("maintenance", "settle_open_question", () =>
        harness.pollWire(
          (wire) => {
            const question = openAuthorQuestionFor(wire, runId);
            if (!question) return null;
            if (previousQuestionRef && String(question.question_ref ?? "") === previousQuestionRef) return null;
            if (previousGoalVersion !== null && Number(question.goal_version) < previousGoalVersion) return null;
            return question;
          },
          previousQuestionRef ? 60_000 : 30_000,
          `${FLOW_LABEL}:settle:open_question`,
        ),
      );
    } catch {
      expected = null;
    }
    if (!expected) {
      reason = previousQuestionRef ? "new_question_not_observed" : "open_question_not_observed";
      break;
    }
    const wireStart = harness.transport().length;
    const steer = await respondToRunPause(text, attempts, {
      observed: true,
      expectedQuestion: expected,
      strategy: process.env.B71_AUTO_MAINT_ANSWER_STRATEGY ?? "continue_verification",
    });
    attempts.push({
      step: "settle_answer",
      ok: steer.ok === true,
      kind: steer.kind ?? null,
      reason: steer.reason ?? null,
    });
    if (!steer.ok) {
      reason = steer.reason ?? "answer_failed";
      break;
    }
    // 不按 steer.kind 提前拒绝；以动作后的实际 wire 判 author_choice。
    let bound = null;
    try {
      bound = await harness.runStep("ack", "settle_author_choice_ack", () =>
        harness.pollWire(
          (wire) => authorChoiceAckFor(wire, { runId, wireStart, expected }),
          20_000,
          `${FLOW_LABEL}:settle:author_choice_ack`,
        ),
      );
    } catch {
      bound = null;
    }
    if (!bound) {
      reason = "author_choice_ack_missing";
      break;
    }
    answers += 1;
    attempts.push({
      step: "settle_author_choice_ack",
      accepted: true,
      run_id: bound.response.run_id ?? null,
      action_id: bound.response.action_id ?? null,
      question_ref: bound.response.question_ref ?? null,
      goal_version: Number(bound.response.goal_version),
      run_state: bound.response.agent_run_state?.status ?? null,
    });
    previousQuestionRef = String(expected.question_ref);
    previousGoalVersion = Number(bound.response.goal_version);
  }
  return { last, reason, attempts };
}

async function sendRequest(index, text, { settlePaused = false, checkpointEarlyStop = false } = {}) {
  await harness.runStep("maintenance", "input_ready", () =>
    harness.rawWaitInputReady(FLOW_LABEL, INPUT_TIMEOUT_MS),
  );
  const sent = await harness.runStep("input", `request_${index}`, () =>
    harness.rawTypeAndSend(text, FLOW_LABEL),
  );
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  if (!turnId) throw new Error(`auto_maint: request_${index} user_message_without_turn_id`);
  harness.capture(`req-0${index}`);
  const ack = await harness.runStep("ack", `request_${index}_ack`, () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, `${FLOW_LABEL}:ack:${index}`),
  );
  const runId = String(frameBody(ack)?.response?.run_id ?? "");
  const checkpointBaseline = checkpointEventCount();
  let terminal = null;
  let settle = null;
  if (settlePaused && !runId) {
    settle = { last: { kind: "run_unknown", status: null }, reason: "run_unknown", attempts: [] };
  } else if (settlePaused) {
    settle = await settleAuthorRun({ runId, text, checkpointBaseline, checkpointEarlyStop });
  } else {
    terminal = await waitRunTerminal({ turnId, runId });
    if (!terminal) throw new Error(`auto_maint: request_${index} terminal_missing`);
  }
  const outcome = settlementOf(settle?.last ?? terminal);
  const turnBody = terminal?.body ?? null;
  const classified = turnBody ? classifyTurnBody(turnBody) : null;
  const events = checkpointEventCount();
  return {
    index,
    text,
    turn_id: turnId,
    run_id: runId || terminal?.body?.agent_run?.run_id || null,
    terminal_kind: outcome.kind,
    terminal_status: outcome.status,
    run_status: classified?.run_status ?? outcome.status,
    settled: outcome.completed,
    pause_kind: settlePaused ? outcome.kind : null,
    settle_reason: outcome.completed ? null : settle?.reason ?? outcome.kind ?? "unsettled",
    settle_attempts: settle?.attempts ?? [],
    checkpoint_events_after: events,
    provider_calls: llmRecordCount(),
  };
}

async function clickStripAndExpand() {
  const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:strip`);
  const button = findStripButton(nodes);
  const streak = { found: Boolean(button), clicked: false, path: button?.path ?? null };
  if (button) {
    await harness.runStep("input", "expand_maintenance_strip", async () => {
      harness.safeClick(button, "auto_maint:strip");
    });
    streak.clicked = true;
  }
  return streak;
}

// 触发自动维护后的页面证据采集（细条 + 展开四要素）。extra round 循环内触发时立即
// 调用一次；主分支只在未采集时补调，避免覆盖触发时刻的真实页面状态。
async function captureTriggeredMaintenanceEvidence() {
  harness.capture("after-maintenance");
  runEvidenceMode(evidence, "capture", dir, ["after-maintenance"]);
  const expanded = await clickStripAndExpand();
  harness.capture("after-expanded");
  runEvidenceMode(evidence, "capture", dir, ["after-expanded"]);
  return expanded;
}

function authorErrorVisible() {
  try {
    const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:failure_scan`);
    const alerts = nodes.filter((node) => ["AXSheet", "AXDialog"].includes(node?.role));
    const texts = nodes.map((node) => `${node?.title ?? ""} ${node?.desc ?? ""} ${node?.value ?? ""}`).join("\n");
    return alerts.length > 0 && /失败|错误|异常/u.test(texts);
  } catch {
    // AX 读不到不等于「无错误提示」：记 null，由 verifier 按缺证失败，而不是伪造 false。
    return null;
  }
}

// 隔离 test DB 的写连接只用于持久 trigger 注入/移除；所有读取仍走 withDb（只读）。
// 写前用 realpath 确认 db 文件仍在本批 database 子目录内，防止误写共享数据库。
function withWritableTestDb(fn) {
  const expectedDir = fs.realpathSync(path.join(dir, "database"));
  const realFile = fs.realpathSync(dbPath(dir));
  if (path.dirname(realFile) !== expectedDir) {
    throw new Error(`auto_maint: refusing to write db outside batch database dir: ${realFile}`);
  }
  const db = new DatabaseSync(realFile);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return fn(db);
  } finally {
    db.close();
  }
}

function injectFailureTrigger() {
  withWritableTestDb((db) => {
    db.exec("DROP TRIGGER IF EXISTS reject_b71_auto_maintenance");
    db.exec(
      "CREATE TRIGGER reject_b71_auto_maintenance BEFORE INSERT ON agent_events " +
        "WHEN NEW.event_type = 'checkpoint_created' " +
        "BEGIN SELECT RAISE(ABORT, 'maintenance unavailable'); END;",
    );
  });
}

function dropFailureTrigger() {
  withWritableTestDb((db) => {
    db.exec("DROP TRIGGER IF EXISTS reject_b71_auto_maintenance");
  });
}

// 请求索引按本批已发送回合的最大 index 递增，保证 failure/recovery 探针的
// req-0N capture 唯一（direct A3 六回合耗尽 requests 时也不复用同一 capture）。
function nextRequestIndex(rounds) {
  return rounds.reduce((max, round) => Math.max(max, Number(round?.index ?? 0)), 0) + 1;
}

function nextRequestSettled(next) {
  if (!next || next.skipped !== false) return false;
  if (next.fresh_turn) return Boolean(next.request?.run_id);
  return next.resume?.resumed === true && ["paused", "terminal"].includes(String(next.pause_after ?? ""));
}


// ── A3b：同一 run 内 ≥2 作者回合（真实控制坞 steer）────────────────────────
function findButtonByText(nodes, predicate, { requireEnabled = true } = {}) {
  return (
    nodes.find(
      (node) =>
        node?.role === "AXButton" &&
        (!requireEnabled || node?.enabled !== false) &&
        predicate(String(node.title ?? "")),
    ) ?? null
  );
}

function readRunStatus(runId) {
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT status FROM agent_runs WHERE id = ?", [runId]);
    return rows[0]?.status ?? null;
  });
}

function readRunExchangeFacts(runId) {
  // 按 canonical transcript 的 blocks 口径统计（tool_call/observation 在 blocks 内，
  // 顶层 message.tool_calls 是旧口径、恒为空——2026-11-08 修正读侧 bug）。
  // ADR-0035 / B81 CP1：canonical 消息在会话存储的 run 执行段内，不再读 run 私有列。
  return withDb(dir, (db) => {
    const segment = all(db, "SELECT message_count FROM authoring_run_segments WHERE run_id = ?", [runId])[0] ?? null;
    const rows = all(
      db,
      "SELECT message FROM authoring_session_messages WHERE run_id = ? ORDER BY run_sequence",
      [runId],
    );
    const messages = rows
      .map((row) => {
        try {
          return JSON.parse(row?.message ?? "null");
        } catch {
          return null;
        }
      })
      .filter((message) => message && typeof message === "object");
    if (segment && Number(segment.message_count) !== messages.length) {
      throw new Error(
        `[native-b71] run 执行段消息数量不一致: segment=${segment.message_count} rows=${messages.length}`,
      );
    }
    const userTurns = messages.filter((message) => message?.role === "user").length;
    const callIds = [];
    const resultIds = [];
    let checkpointMessages = 0;
    for (const message of messages) {
      const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
      for (const block of blocks) {
        if (block?.type === "tool_call") callIds.push(block.call_id);
        else if (block?.type === "observation" || block?.type === "validation_result") {
          resultIds.push(block.call_id);
        } else if (block?.type === "checkpoint") checkpointMessages += 1;
      }
    }
    const matched = new Set(callIds.filter((callId) => resultIds.includes(callId)));
    return {
      messages: messages.length,
      user_turns: userTurns,
      assistant_tool_calls: callIds.length,
      tool_results: resultIds.length,
      complete_exchanges: matched.size,
      checkpoint_messages: checkpointMessages,
    };
  });
}

function readRunUsageFacts(runId) {
  return withDb(dir, (db) => {
    const runs = all(db, "SELECT id FROM provider_runs WHERE agent_run_id = ?", [runId]);
    const usages = [];
    for (const run of runs) {
      const outputs = all(db, "SELECT usage FROM provider_outputs WHERE provider_run_id = ?", [run.id]);
      for (const output of outputs) {
        try {
          const usage = JSON.parse(output.usage);
          const tokens = Number(usage?.input_tokens ?? 0);
          if (tokens > 0) usages.push(tokens);
        } catch {
          // usage 缺失不猜测
        }
      }
    }
    return {
      provider_calls: runs.length,
      max_input_tokens: usages.length > 0 ? Math.max(...usages) : 0,
      usages,
    };
  });
}

async function waitRunPauseOrTerminal({ runId, timeoutMs = TURN_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  let lastTickAt = Date.now();
  while (Date.now() < deadline) {
    harness.checkSupervisor();
    const status = readRunStatus(runId);
    lastStatus = status;
    if (status === "awaiting_author") return { kind: "paused", status };
    if (["completed", "failed", "cancelled"].includes(String(status))) return { kind: "terminal", status };
    if (Date.now() - lastTickAt >= 30_000) {
      await harness.runStep("maintenance", "wait_heartbeat", async () => {});
      lastTickAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { kind: "timeout", status: lastStatus };
}

async function waitRunResume({ runId, timeoutMs = TURN_TIMEOUT_MS }) {
  // 回答后同一 run 应从 awaiting_author 恢复（running/completed/failed 均视为继续）。
  // 真实模型恢复可能 >120s：等待期间每 ~30s 写一条短活动记录，刷新 supervisor 的
  // idle 预算（仅读 DB 不发命令会被判 driver_idle 并终止，cp5-real-03/05）。
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  let lastTickAt = Date.now();
  while (Date.now() < deadline) {
    harness.checkSupervisor();
    const status = readRunStatus(runId);
    lastStatus = status;
    if (["running", "completed", "failed", "cancelled"].includes(String(status))) {
      return { resumed: true, status };
    }
    if (Date.now() - lastTickAt >= 30_000) {
      await harness.runStep("maintenance", "wait_heartbeat", async () => {});
      lastTickAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { resumed: false, status: lastStatus };
}

// 从真实回答面板读问题文本与选项（观察驱动多轮的唯一输入来源）。
function readAnswerObservation(nodes, panel) {
  // 面板节点可能没有可用 path 前缀（AX dump 的 path 表示不稳定），此时退回全局启发式：
  // 只接受「问题特征文本」与「非固定 UI 的按钮」，避免把全局导航按钮当选项。
  const prefix = panel?.path ? `${panel.path}/` : null;
  const scoped = prefix ? nodes.filter((node) => String(node?.path ?? "").startsWith(prefix)) : [];
  const scope = scoped.length > 0 ? scoped : nodes;
  const fixedUi =
    /^(回答当前问题|回答并继续|回答并继续…|选项[A-Za-z0-9]?|终止任务|打开档案|阅读|记忆|作品|助手|开始新讨论|放弃此问题|重新发起此问题|返回|确认终止|为什么|发送|发送回复|回复此问题|会话|模型已连接|同步已连接)$/u;
  const staticTexts = scope
    .filter((node) => node?.role === "AXStaticText")
    .map((node) => String(node?.title ?? node?.value ?? node?.desc ?? "").trim())
    .filter((text) => text && !fixedUi.test(text));
  // 问题文本特征：含问号/说明括号/章/计划/正文等对象词，且不是提示条短句。
  const questionText =
    staticTexts.find((text) => /[？?]|（|\(|章|计划|正文/.test(text) && text.length >= 8) ??
    staticTexts.join(" ").trim() ??
    "";
  const optionTitles = scope
    .filter((node) => node?.role === "AXButton" && node?.enabled !== false)
    .map((node) => String(node.title ?? "").trim())
    .filter((title) => title && !fixedUi.test(title))
    .filter((title) => !/^(阅读|记忆|作品|助手|模型|同步)/u.test(title));
  // 不可回复是回答面板自身的只读状态：所有选项会 disabled，只留「重新发起此问题」。
  const unavailable = scope.some((node) =>
    /此问题暂不可回复/u.test(`${node?.title ?? ""} ${node?.desc ?? ""} ${node?.value ?? ""}`),
  );
  return { question_text: questionText, option_titles: optionTitles, unavailable, scoped_nodes: scoped.length };
}

// 按预注册策略从观察内容生成真实作答（问题有选项→选项；自由问题→对象词提取模板）。
const ANSWER_OBJECT_PATTERNS = [/第\s*\d+\s*章/u, /章计划/u, /正文/u, /大纲/u, /设定/u, /档案/u, /记忆/u];

function planObservedAnswer(observation, strategy) {
  const optionTitles = Array.isArray(observation?.option_titles) ? observation.option_titles : [];
  if (optionTitles.length > 0) {
    const preferred =
      optionTitles.find((title) => /继续|核对|查看|推进|是/u.test(title)) ?? optionTitles[0];
    return { source: "option", choice: preferred, text: null };
  }
  const question = String(observation?.question_text ?? "");
  const object = ANSWER_OBJECT_PATTERNS.map((pattern) => (question.match(pattern) ?? [])[0]).find(Boolean) ?? null;
  if (object) {
    return {
      source: "extracted_text",
      choice: null,
      text: `继续核对${object}与章计划的一致性：先给出依据再继续；不要提前结束。`,
    };
  }
  return {
    source: "fallback",
    choice: null,
    text:
      strategy === "continue_verification"
        ? "继续按你的判断推进：先给出依据，再继续；不要提前结束。"
        : "按你的判断继续。",
  };
}

// 页面可能出现「终止当前创作任务？」确认弹窗（例如交互误触「终止任务/放弃此问题」）。
// driver 只允许点「返回」取消，绝不允许点「确认终止」（会终止真实 run/丢失当前工作）。
async function dismissTerminationDialogIfPresent(label) {
  try {
    const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:dialog_check:${label}`);
    const text = nodes
      .map((node) => `${node?.title ?? ""} ${node?.desc ?? ""} ${node?.value ?? ""}`)
      .join(" ");
    if (!/终止当前创作任务/u.test(text)) return { present: false };
    const back = nodes.find(
      (node) => node?.role === "AXButton" && String(node?.title ?? "").trim() === "返回",
    );
    if (!back) return { present: true, dismissed: false, reason: "back_button_not_found" };
    await harness.runStep("maintenance", `${FLOW_LABEL}:dismiss_termination_dialog`, () =>
      harness.safeClick(back, `${FLOW_LABEL}:dismiss_termination_dialog`),
    );
    return { present: true, dismissed: true };
  } catch (error) {
    return { present: false, error: error.message };
  }
}

async function respondToRunPause(steerText, attempts, options = {}) {
  const observed = options.observed === true;
  const strategy = options.strategy ?? process.env.B71_AUTO_MAINT_ANSWER_STRATEGY ?? "continue_verification";
  // 回答面板出现后 app 可能因用户切窗失焦：点击前显式恢复交互面（前台/关闭 tooltip）。
  try {
    const recovered = await harness.runStep("maintenance", "recover_answer_surface", () =>
      harness.recoverInteractionSurface(`${FLOW_LABEL}:answer_panel`),
    );
    attempts.push({ step: "recover_answer_surface", ok: Boolean(recovered), recovered });
  } catch (error) {
    attempts.push({ step: "recover_answer_surface", ok: false, reason: error.message });
  }
  // 长等待/交互必须包进 runStep（typed wait ledger）：否则 runner 在 driver 无
  // begin/finish 记录期间判定 idle 并终止（cp5-answer-05 的 driver_idle_timeout）。
  const dialog = await dismissTerminationDialogIfPresent("before_answer");
  attempts.push({ step: "dismiss_termination_dialog", ...dialog });
  const nodes = await harness.runStep("maintenance", `${FLOW_LABEL}:dump_answer_panel`, () =>
    harness.dumpNodesForInteraction(`${FLOW_LABEL}:pause_panel`),
  );

  // 新交互（46 §9.7 等待即回答）：底部主输入区接管为回答面板
  // （role=group aria-label「回答当前问题」：问题文本 + 选项按钮 +「回复此问题」→ textarea →「发送回复」）。
  // 消息流问题卡只是只读记录（aria-label「创作问题记录」），不可点击。
  const answerPanel = nodes.find(
    (node) =>
      /回答当前问题/u.test(`${node?.title ?? ""} ${node?.desc ?? ""} ${node?.value ?? ""}`) &&
      ["AXGroup", "AXGenericGroup", "AXSheet", "AXList", "AXStaticText"].includes(String(node?.role ?? "")),
  );
  if (options.expectedQuestion && !answerPanel) {
    return { ok: false, reason: "expected_answer_panel_missing" };
  }
  attempts.push({
    step: "find_answer_panel",
    ok: Boolean(answerPanel),
    role: answerPanel?.role ?? null,
    title: answerPanel?.title ?? answerPanel?.desc ?? null,
  });
  if (answerPanel) {
    // 观察驱动（2026-11-08 审核）：先从回答面板读真实问题文本与选项，再据此作答；
    // 不做「固定文本刷轮次」——问题文本/选项进入证据，回答来源 option/extracted_text
    // 由 verifier 的 C11 判据核验（至少一轮必须来自观察）。
    const observation = observed ? readAnswerObservation(nodes, answerPanel) : null;
    if (options.expectedQuestion) {
      const labels = (options.expectedQuestion.options ?? [])
        .filter((option) => option.kind === "choice").map((option) => option.label);
      const matches = labels.length > 0
        ? labels.every((label) => observation?.option_titles.includes(label))
        : nodes.some((node) => node.role === "AXStaticText" &&
          String(node.value ?? node.title ?? "").startsWith(options.expectedQuestion.question.slice(0, 48)));
      if (!matches) return { ok: false, reason: "visible_question_does_not_match_run" };
    }
    const planned = observed ? planObservedAnswer(observation, strategy) : null;
    const answerText = planned?.text ?? steerText;
    attempts.push({
      step: "answer_observation",
      observed,
      question_text: observation?.question_text ?? null,
      option_titles: observation?.option_titles ?? [],
      answer_source: planned?.source ?? null,
      answer_text: answerText,
    });
    // 面板自述不可回复：所有选项 disabled、只剩「重新发起此问题」。只记录观察和
    // 缺证原因后立即返回，不点重发/放弃/终止，也不进入发送等待。
    if (observation?.unavailable) {
      attempts.push({
        step: "answer_unavailable",
        ok: false,
        reason: "question_not_answerable",
        question_text: observation.question_text,
        option_titles: observation.option_titles,
      });
      return { ok: false, reason: "question_not_answerable", observation, panel: true };
    }
    // 路径 1（优先）：结构化选项按钮 → author_choice 回答（同 run 继续）。
    const rawChoice = String(process.env.B71_AUTO_MAINT_ANSWER_CHOICE ?? "").trim();
    const answerChoice = rawChoice.toUpperCase();
    const choiceButtons = nodes.filter(
      (node) =>
        node?.role === "AXButton" &&
        node?.enabled !== false &&
        /^选项[A-Za-z0-9]?/u.test(String(node.title ?? "").trim()),
    );
    const choiceButton = (() => {
      // answer-mode：必须精确命中预注册 choice（如「保留悬念」），不得被观察到的
      // 其他按钮（开始新讨论/放弃此问题/终止任务…）带偏。
      if (ANSWER_MODE && rawChoice === "") {
        const exact = nodes.find(
          (node) =>
            node?.role === "AXButton" &&
            node?.enabled !== false &&
            String(node.title ?? "").includes(ANSWER_MODE_CHOICE),
        );
        if (exact) return exact;
      }
      if (observed && planned?.choice) {
        return nodes.find(
          (node) =>
            node?.role === "AXButton" &&
            node?.enabled !== false &&
            String(node.title ?? "").trim() === planned.choice,
        ) ?? null;
      }
      if (answerChoice === "FREE_TEXT") return null;
      return (
        choiceButtons.find((node) => String(node.title ?? "").trim().startsWith(`选项${answerChoice}`)) ??
        (answerChoice === "" ? choiceButtons[0] : null) ??
        null
      );
    })();
    if (choiceButton) {
      await harness.runStep("maintenance", `${FLOW_LABEL}:answer_choice`, () =>
        harness.safeClick(choiceButton, `${FLOW_LABEL}:answer_choice`),
      );
      attempts.push({ step: "click_answer_choice", ok: true, title: choiceButton?.title ?? null });
      return {
        ok: true,
        kind: "choice",
        label: choiceButton?.title ?? null,
        text: null,
        sent: true,
        observation: observation
          ? { ...observation, answer_source: "option", answer_text: String(choiceButton?.title ?? "") }
          : null,
      };
    }
    // 路径 2（新 composer 提示条）：主输入框 placeholder「回答当前问题…」+ 发送按钮「回答并继续」。
    const composerField =
      nodes.find(
        (node) =>
          node?.role === "AXTextField" &&
          /回答当前问题/u.test(`${node?.title ?? ""} ${node?.desc ?? ""} ${node?.value ?? ""}`),
      ) ??
      nodes.find((node) => node?.role === "AXTextField") ??
      null;
    const answerSend = findButtonByText(
      nodes,
      (value) => value === "回答并继续" || value === "回答并继续…",
      // 空 composer 时「回答并继续」本就 disabled；此处只确认控件存在，输入后的
      // 实际点击仍要求 enabled。
      { requireEnabled: false },
    );
    if (composerField && answerSend) {
      const composerSend = await harness.runStep(
        "maintenance",
        `${FLOW_LABEL}:answer_composer`,
        async () => {
          harness.safeClick(composerField, `${FLOW_LABEL}:answer_composer`);
          await sleep(300);
          typeText(harness.APP, answerText);
          await sleep(800);
          return findButtonByText(
            harness.dumpNodesForInteraction(`${FLOW_LABEL}:answer_composer_send`),
            (value) => value === "回答并继续",
          );
        },
      );
      attempts.push({ step: "find_answer_composer", ok: Boolean(composerField), send: Boolean(composerSend) });
      if (!composerSend) return { ok: false, reason: "answer_send_not_found", composer: true };
      await harness.runStep("maintenance", `${FLOW_LABEL}:answer_composer_send`, () =>
        harness.safeClick(composerSend, `${FLOW_LABEL}:answer_composer_send`),
      );
      return {
        ok: true,
        kind: "composer_free_text",
        text: answerText,
        sent: true,
        observation: observation
          ? { ...observation, answer_source: planned?.source ?? "fallback", answer_text: answerText }
          : null,
      };
    }

    // 路径 3（兼容旧版）：自由文本「回复此问题」→ textarea（aria-label「对此问题的补充」）→「发送回复」。
    const replyButton = nodes.find(
      (node) => node?.role === "AXButton" && String(node.title ?? "").includes("回复此问题"),
    );
    if (replyButton) {
      harness.safeClick(replyButton, `${FLOW_LABEL}:answer_reply_open`);
      await sleep(600);
      const formNodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:answer_textarea`);
      const textarea =
        formNodes.find(
          (node) => node?.role === "AXTextArea" || /对此问题的补充/u.test(`${node?.title ?? ""} ${node?.desc ?? ""}`),
        ) ?? null;
      attempts.push({ step: "find_answer_textarea", ok: Boolean(textarea), role: textarea?.role ?? null });
      if (!textarea) return { ok: false, reason: "answer_textarea_not_found", panel: true };
      harness.safeClick(textarea, `${FLOW_LABEL}:answer_textarea`);
      await sleep(300);
      typeText(harness.APP, answerText);
      await sleep(800);
      const send = findButtonByText(
        harness.dumpNodesForInteraction(`${FLOW_LABEL}:answer_send`),
        (value) => value === "发送回复",
      );
      attempts.push({ step: "find_answer_send", ok: Boolean(send), title: send?.title ?? null });
      if (!send) return { ok: false, reason: "answer_send_not_found", panel: true };
      harness.safeClick(send, `${FLOW_LABEL}:answer_send`);
      return { ok: true, kind: "free_text", text: steerText, sent: true };
    }
    return { ok: false, reason: "answer_panel_without_controls", panel: true };
  }

  // 兼容：旧问题卡「回复此问题」+ 底部 AXTextField +「发送」路径。
  const replyButton =
    nodes.find((node) => node?.role === "AXButton" && String(node.title ?? "").includes("回复此问题")) ?? null;
  attempts.push({ step: "find_reply_question", ok: Boolean(replyButton), title: replyButton?.title ?? null });
  if (replyButton) {
    harness.safeClick(replyButton, `${FLOW_LABEL}:reply_question`);
    await sleep(600);
    const replyNodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:reply_field`);
    const field =
      replyNodes.find(
        (node) =>
          node?.role === "AXTextField" &&
          /调整当前任务|回复或补充|输入你的想法|补充方向/.test(String(node.title ?? node.desc ?? node.value ?? "")),
      ) ??
      replyNodes.find((node) => node?.role === "AXTextField") ??
      null;
    attempts.push({ step: "find_reply_field", ok: Boolean(field), desc: field?.desc ?? null, title: field?.title ?? null });
    if (!field) return { ok: false, reason: "reply_field_not_found" };
    harness.safeClick(field, `${FLOW_LABEL}:reply_field`);
    await sleep(300);
    typeText(harness.APP, steerText);
    await sleep(800);
    const send = findButtonByText(
      harness.dumpNodesForInteraction(`${FLOW_LABEL}:reply_send`),
      (value) => value === "发送" || value === "发送调整",
    );
    attempts.push({ step: "find_reply_send", ok: Boolean(send), title: send?.title ?? null });
    if (!send) return { ok: false, reason: "reply_send_not_found", field_found: true };
    harness.safeClick(send, `${FLOW_LABEL}:reply_send`);
    await harness.pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry?.direction === "sent" &&
            Array.isArray(entry.frame) &&
            ["user_message", "agent_command", "author_action"].includes(String(entry.frame[3] ?? "")),
        ) ?? null,
      60_000,
      `${FLOW_LABEL}:steer_sent`,
    );
    return { ok: true, kind: "reply_question", text: steerText, sent: true };
  }

  // 回退路径（旧控制坞）：AXTextField「调整当前任务/回复或补充」+ AXButton「发送调整」。
  const field =
    nodes.find(
      (node) =>
        node?.role === "AXTextField" &&
        /调整当前任务|回复或补充|补充方向/.test(String(node.title ?? node.desc ?? node.value ?? "")),
    ) ?? null;
  attempts.push({ step: "find_pause_field", ok: Boolean(field), role: field?.role ?? null, title: field?.title ?? null });
  if (!field) return { ok: false, reason: "pause_field_not_found" };
  harness.safeClick(field, `${FLOW_LABEL}:pause_field`);
  await sleep(300);
  typeText(harness.APP, steerText);
  await sleep(800);
  const send = findButtonByText(
    harness.dumpNodesForInteraction(`${FLOW_LABEL}:pause_send`),
    (value) => value === "发送调整",
  );
  attempts.push({ step: "find_send_adjust", ok: Boolean(send), title: send?.title ?? null });
  if (!send) return { ok: false, reason: "send_button_not_found", field_clicked: true };
  harness.safeClick(send, `${FLOW_LABEL}:send_adjust`);
  await harness.pollWire(
    (wire) =>
      wire.find(
        (entry) =>
          entry?.direction === "sent" &&
          Array.isArray(entry.frame) &&
          ["user_message", "agent_command", "author_action"].includes(String(entry.frame[3] ?? "")),
      ) ?? null,
    60_000,
    `${FLOW_LABEL}:steer_sent`,
  );
  return { ok: true, field: field?.title ?? null, sent: true, text: steerText };
}

// 消息流「创作问题记录」区域只读证据：该区域只应包含问题文本/状态文本，不含操作按钮。
function readProblemRecord() {
  try {
    const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:problem_record`);
    const region = nodes.find((node) => String(node?.title ?? "").includes("创作问题记录"));
    if (!region) return { group_found: false, child_button_count: null };
    const prefix = `${region.path}/`;
    const children = nodes.filter((node) => String(node?.path ?? "").startsWith(prefix));
    return {
      group_found: true,
      region_role: region.role ?? null,
      child_button_count: children.filter((node) => node?.role === "AXButton").length,
      child_nodes: children.length,
    };
  } catch (error) {
    return { group_found: false, error: error.message };
  }
}

async function observeStripText(timeoutMs) {
  try {
    const panel = await harness.pollAx(
      (text) => /较早的\s*\d+\s*项创作过程已整理|创作过程已整理/u.test(text),
      timeoutMs,
      `${FLOW_LABEL}:strip_observe`,
    );
    return { visible: true, text: String(panel ?? "").slice(0, 400) };
  } catch {
    return { visible: false };
  }
}

// direct A3 与正式 live multi-turn 共用的重启/失败/恢复尾段。只在调用方确认
// 「已触发且下一页面请求达到确定完成」后运行；ANSWER_MODE / smoke 不跑。
// 前一 request 未明确结算时只记缺证，不重启、不发新回合。
async function runRecoveryProbes({ report, requests, workTitle, currentRunId, startIndex }) {
  if (ANSWER_MODE || process.env.B71_AUTO_MAINT_SMOKE === "1") return;
  const textFor = (index) => requests[index - 1] ?? "继续：按你的判断继续推进。";

  // 前一 request 结算：真实 awaiting_author 用既有面板回答一次后复核实际状态；
  // 只有 terminal 才重启，timeout/再次 paused 记缺证。
  const preRestart = await sendNextRequestAfterTrigger({
    index: startIndex,
    queue: [textFor(startIndex)],
    trigger: { run_id: currentRunId },
    allowFreshTurn: false,
  });
  // 只有同身份真实 completed 才允许重启；failed/cancelled/paused/timeout 都记缺证。
  const preRestartOutcome = settlementOf(
    preRestart.skipped === true && preRestart.reason === "run_terminal"
      ? { kind: "terminal", status: preRestart.pause_status ?? null }
      : preRestart.skipped === true
        ? { kind: preRestart.reason ?? "skipped" }
        : {
            kind: preRestart.pause_after === "terminal" ? "terminal" : preRestart.pause_after,
            status: preRestart.pause_after_status ?? null,
          },
  );
  const settledBeforeRestart = preRestartOutcome.completed;
  if (!settledBeforeRestart) {
    report.failure_injection = {
      skipped: true,
      reason: "previous_request_unsettled",
      pre_restart: preRestart,
    };
    report.recovery = { skipped: true, reason: "previous_request_unsettled" };
    return;
  }

  // 1) 真实重启恢复幂等。
  const refreshBeforeEvents = checkpointEventCount();
  const refreshBeforeMessages = checkpointMessageCount();
  await harness.runStep("restore", "close_app_and_relaunch", () => harness.rawCloseAppAndRelaunch());
  await harness.runStep("maintenance", "workbench_ready_restored", () =>
    harness.rawWaitWorkbenchSettled(`${FLOW_LABEL}:restored`, READY_TIMEOUT_MS),
  );
  await harness.runStep("maintenance", "work_selected_restored", () =>
    harness.rawTrySelectWork(workTitle, `${FLOW_LABEL}:restored`),
  );
  report.refresh = {
    before_checkpoint_events: refreshBeforeEvents,
    after_checkpoint_events: checkpointEventCount(),
    before_checkpoint_messages: refreshBeforeMessages,
    after_checkpoint_messages: checkpointMessageCount(),
  };
  harness.capture("after-refresh");
  runEvidenceMode(evidence, "capture", dir, ["after-refresh"]);

  // 2) 故障：一个新作者 turn；注入与移除都在 try/finally 内。
  const failureBeforeEvents = checkpointEventCount();
  const failureBeforeMessages = checkpointMessageCount();
  let failure;
  try {
    injectFailureTrigger();
    failure = await sendRequest(startIndex, textFor(startIndex), { settlePaused: true });
  } finally {
    dropFailureTrigger();
  }
  const failureAfterEvents = checkpointEventCount();
  const failureAfterMessages = checkpointMessageCount();
  const failureVisible = authorErrorVisible();
  harness.capture("after-failure");
  runEvidenceMode(evidence, "capture", dir, ["after-failure"]);

  // 3) 恢复：故障 run 已结算才发第二个新作者 turn；否则记缺证，不盲发。
  const recovery = failure.settled
    ? await sendRequest(startIndex + 1, textFor(startIndex + 1), { settlePaused: true })
    : {
        index: startIndex + 1,
        text: textFor(startIndex + 1),
        run_id: null,
        settled: false,
        pause_kind: failure.pause_kind ?? "failure_unsettled",
      };
  harness.capture("after-recovery");
  runEvidenceMode(evidence, "capture", dir, ["after-recovery"]);

  report.failure_injection = {
    trigger_created: true,
    author_error_visible: failureVisible,
    checkpoint_events_before_failure: failureBeforeEvents,
    checkpoint_events_after_failure: failureAfterEvents,
    checkpoint_messages_before_failure: failureBeforeMessages,
    checkpoint_messages_after_failure: failureAfterMessages,
    failure_request: {
      index: failure.index,
      run_id: failure.run_id ?? null,
      settled: failure.settled === true,
      run_status: failure.run_status ?? null,
    },
    recovery_request: {
      index: recovery.index,
      run_id: recovery.run_id ?? null,
      settled: recovery.settled === true,
      run_status: recovery.run_status ?? null,
    },
  };
  report.recovery = { settled: recovery.settled === true };
}

// A3b 同 run 多回合流程：长任务请求 → 自然 awaiting_author → 真实控制坞 steer →
// 同一 run 继续 → 安全点检查自动维护（smoke 只观测，不产验收证据）。
async function runMultiTurnFlow({ report, requests, workTitle }) {
  // G6-multi-turn 正式场景（2026-11-08 作者授权）：同 run 连续 steer，直到
  // 安全点自动维护触发（checkpoint_created）或 steer 预算耗尽/run 终局。
  // 触发后补作者可见细条/展开面板与「压缩后真实请求」证据；不触发则如实记录，
  // 不伪造、不调 K/窗口。smoke 模式（B71_AUTO_MAINT_SMOKE=1）复用同一驱动但
  // runner 不产验收判据。
  // 正式 multi-turn 场景允许预注册指定长请求与 steer 文本（真实用户输入，不注入产品）。
  // answer-mode 用确定性 ask_author fixture 的预注册请求（引导模型先询问作者），
  // 否则会退回 A3 默认长请求、首轮直接完成而没有多回合。
  const longRequest =
    (ANSWER_MODE ? ANSWER_MODE_REQUEST : null) ??
    process.env.B71_AUTO_MAINT_REQUEST ??
    process.env.B71_AUTO_MAINT_SMOKE_REQUEST ??
    requests[0] ??
    "先读一下第01章的正文和章计划，再读一下第02章的正文和章计划，然后把两章做对比，最后告诉我下一步该写什么。";
  const steerBase =
    process.env.B71_AUTO_MAINT_STEER ??
    process.env.B71_AUTO_MAINT_SMOKE_STEER ??
    "按你的判断继续：先给出两章的对比结论，再给出下一步写作建议。";
  const maxSteers = Math.max(1, Number(process.env.B71_AUTO_MAINT_MAX_STEERS ?? "6"));
  const session = {
    long_request: longRequest,
    steers: [],
    rounds: [],
    attempts: [],
    max_steers: maxSteers,
    stop_reason: null,
  };
  harness.log.push({ op: "a3_multi_turn_start", at: harness.nowIso() });

  const first = await sendRequest(1, longRequest);
  report.requests.push(first);
  session.first_run = {
    turn_id: first.turn_id,
    run_id: first.run_id,
    status_after_send: first.run_status,
    checkpoint_events: first.checkpoint_events_after,
  };
  session.run_id = first.run_id;

  let pause = await waitRunPauseOrTerminal({ runId: first.run_id });
  session.pause = pause;
  let triggered = checkpointEventCount() > 0;

  while (!triggered && session.steers.length < maxSteers && pause.kind === "paused") {
    const index = session.steers.length + 1;
    const steerText = index === 1 ? steerBase : `${steerBase}（第${index}轮继续）`;
    harness.capture(`a3-paused-${index}`);
    session.problem_record = readProblemRecord();
    // D2 基线：在真实作答前读取同 run 已发生的 provider 调用数。回答后先由
    // waitRunResume 观测 resumed，再等 waitRunPauseOrTerminal 到下一次暂停/终态
    // 后读数；立即在 resume 后读会停在基线，不能证明回答推动了同一 run 继续执行。
    const callsBeforeAnswer = readRunUsageFacts(first.run_id)?.provider_calls ?? null;
    // 观察驱动：先读面板真实问题/选项再作答（问题与回答绑定进入证据，C11 核验）。
    const steer = await respondToRunPause(steerText, session.attempts, {
      observed: true,
      strategy: process.env.B71_AUTO_MAINT_ANSWER_STRATEGY ?? "continue_verification",
    });
    session.steers.push({ index, text: steerText, ...steer });
    if (!steer.ok) {
      session.stop_reason = "steer_failed";
      break;
    }
    const resume = await waitRunResume({ runId: first.run_id });
    session.resumes = [...(session.resumes ?? []), { index, ...resume }];
    if (!resume.resumed) {
      session.after_steer = {
        index,
        resumed: false,
        provider_calls_before: callsBeforeAnswer,
        provider_calls_after: null,
      };
      session.stop_reason = "resume_failed";
      break;
    }
    pause = await waitRunPauseOrTerminal({ runId: first.run_id });
    // D2 证据：resumed 后同 run 的调用数必须相对回答前基线严格增加。
    session.after_steer = {
      index,
      resumed: true,
      provider_calls_before: callsBeforeAnswer,
      provider_calls_after: readRunUsageFacts(first.run_id)?.provider_calls ?? null,
    };
    triggered = checkpointEventCount() > 0;
    session.rounds.push({
      index,
      pause_kind: pause.kind,
      pause_status: pause.status ?? null,
      exchange_facts: readRunExchangeFacts(first.run_id),
      usage_facts: readRunUsageFacts(first.run_id),
      checkpoint_events: checkpointEventCount(),
      triggered,
    });
  }

  // G6 实模路径（strata A3）：首轮回答后若仍未触发，补发若干轮新请求（新 turn），
  // 让会话历史累积 ≥K 个已完成交换——安全点才有可压缩的「更早工作回合」。
  // 首轮（询问+回答）通常只有 3 个完成交换 < keep_recent_items=4，需要至少第 2 轮
  // 补发后（累计 6 个）才有可压项。仅在显式开关下执行（B71_AUTO_MAINT_EXTRA_ROUNDS=N，
  // 兼容旧 B71_AUTO_MAINT_EXTRA_ROUND=1），不改变既有 A3 批次行为。
  const extraRoundBudget = Math.max(
    0,
    Number(
      process.env.B71_AUTO_MAINT_EXTRA_ROUNDS ??
        (process.env.B71_AUTO_MAINT_EXTRA_ROUND === "1" ? 1 : 0),
    ),
  );
  // 回答发送/恢复结果不确定（stop_reason 已记录）时不再补发新 turn；明确终局仍走。
  if (!triggered && !session.stop_reason && !ANSWER_MODE && extraRoundBudget > 0) {
    session.extra_rounds = [];
    for (let round = 0; round < extraRoundBudget && !triggered; round += 1) {
      const requestText =
        (process.env.B71_AUTO_MAINT_EXTRA_REQUEST && round === 0 ? process.env.B71_AUTO_MAINT_EXTRA_REQUEST : null) ??
        ["继续：按你刚才的判断，把下一个场景的开头写出来。", "继续：把上一段的结尾收束到一个具体的动作上。", "继续：写出下一章开头的一段，并说明它承接了什么。"][round] ??
        "继续：按你刚才的判断继续推进。";
      try {
        const extra = await sendRequest(2 + round, requestText, {
          settlePaused: process.env.B71_AUTO_MAINT_SMOKE !== "1",
          checkpointEarlyStop: process.env.B71_AUTO_MAINT_SMOKE !== "1",
        });
        session.extra_rounds.push({ round: round + 1, ...extra });
        triggered = checkpointEventCount() > 0;
        session.checkpoint_events_after_extra = checkpointEventCount();
        if (triggered) {
          // 触发后立即采集页面证据：此后的补发/等待会让细条消失或页面进入失败态。
          report.strip_expanded = await captureTriggeredMaintenanceEvidence();
          session.triggered_evidence_collected = true;
        }
        // 未真实终局（预算/ACK/resume/等待不确定）时记准确缺证并停止补发；
        // smoke 不产判据，保持既有观测行为。
        if (!extra.settled && !triggered && process.env.B71_AUTO_MAINT_SMOKE !== "1") {
          session.stop_reason = `extra_${extra.settle_reason ?? "unsettled"}`;
          break;
        }
      } catch (error) {
        session.extra_rounds.push({ round: round + 1, ok: false, error: error.message });
        session.stop_reason = "extra_send_failed";
        break;
      }
    }
  }
  if (!triggered && !session.stop_reason) {
    session.stop_reason =
      pause.kind === "paused" ? "steer_budget_exhausted" : `run_${pause.kind}`;
  }
  // 触发身份只看 checkpoint_created 所属 run：仅与本批 first 或发送成功的 extra
  // round 匹配。无匹配（含事件缺 run_id）只记录缺证，不向任何 run/会话发消息。
  const checkpointRunId = triggered ? latestCheckpointRunId() : null;
  const triggerMatch = triggered
    ? [first, ...(session.extra_rounds ?? [])]
        .filter((round) => round.ok !== false)
        .find((round) => checkpointRunId && round.run_id === checkpointRunId) ?? null
    : null;
  const triggerSource = triggered
    ? {
        checkpoint_run_id: checkpointRunId,
        matched: Boolean(triggerMatch),
        source: triggerMatch === first ? "first" : triggerMatch ? "extra_round" : null,
        index: triggerMatch?.index ?? null,
        run_id: triggerMatch?.run_id ?? null,
      }
    : null;
  session.trigger_source = triggerSource;
  session.triggered = triggered;
  session.checkpoint_events = checkpointEventCount();
  session.exchange_facts = readRunExchangeFacts(first.run_id);
  session.usage_facts = readRunUsageFacts(first.run_id);
  session.run_events = withDb(dir, (db) =>
    all(db, "SELECT event_type, COUNT(*) AS c FROM agent_events WHERE run_id = ? GROUP BY event_type", [
      first.run_id,
    ]),
  );
  session.strip = await observeStripText(triggered ? 15_000 : 10_000);
  session.scan = scanAuthorVisibleFiles(dir);
  report.multi_turn = session;
  report.triggered = triggered;
  report.first_trigger_index = triggered ? (triggerSource.index ?? null) : null;

  if (triggered) {
    if (report.strip_expanded === undefined) {
      report.strip_expanded = await captureTriggeredMaintenanceEvidence();
    }
    report.maintenance_strip = report.strip_expanded;

    // 压缩后真实请求：触发 run 明确 awaiting_author → 用该 run 的真实界面回答；
    // 明确 terminal 且是实模 G6 → 在同一页面会话提交一个作者新 turn（复用 sendRequest）。
    // 无匹配/等待超时只记录缺证，不盲发。ANSWER_MODE 单 run 路线保持既有行为。
    const liveG6 = !ANSWER_MODE && process.env.B71_AUTO_MAINT_SMOKE !== "1";
    const nextIndex = nextRequestIndex([first, ...(session.extra_rounds ?? [])]);
    const nextSteer = await sendNextRequestAfterTrigger({
      index: nextIndex,
      queue: requests,
      trigger: triggerSource,
      allowFreshTurn: liveG6,
    });
    session.next_request = nextSteer;
    report.next_request = nextSteer;
    harness.capture("after-next-request");
    runEvidenceMode(evidence, "capture", dir, ["after-next-request"]);
    // 正式 live multi-turn 且下一页面请求达到确定完成：与 direct A3 共用
    // 重启/失败/恢复尾段；状态不确定或仍在等待时 nextRequestSettled=false，
    // 只记缺证，不盲发。
    if (liveG6 && nextRequestSettled(nextSteer)) {
      await runRecoveryProbes({
        report,
        requests,
        workTitle,
        currentRunId:
          (nextSteer.fresh_turn ? nextSteer.request?.run_id : nextSteer.trigger_run_id) ??
          triggerSource.run_id,
        startIndex: nextIndex + 1,
      });
    }
  } else {
    harness.capture("after-maintenance");
    runEvidenceMode(evidence, "capture", dir, ["after-maintenance"]);
    report.maintenance_strip = {
      found: session.strip?.visible === true,
      clicked: false,
      reason: "not_triggered",
    };
  }
  // G6 尝试（answer-mode）：首 run 完成后补发一轮新请求（新 turn）。首 run 的交换
  // 已完整进入会话 canonical 历史，第二轮 run 的安全点才具备「可压缩的更早工作
  // 回合」（压缩对象=会话历史，ADR-0035）。
  // 仅当自动维护显式开启（G6 场景）时执行：普通 answer-mode 验收批次必须保持单 run，
  // 否则 D1（同 run 第二作者回合、run_count=1）会被第二轮新 turn 破坏。
  const g6SecondRound =
    ANSWER_MODE &&
    (process.env.NOVEL_AUTO_MAINTENANCE_ENABLED === "1" || process.env.B71_ANSWER_MODE_G6 === "1");
  if (!triggered && g6SecondRound) {
    try {
      const second = await sendRequest(2, process.env.B71_ANSWER_MODE_SECOND_REQUEST ?? "继续：请把两个结尾方向各写一小段，供我选择。");
      session.second_round = second;
      session.checkpoint_events_after_second = checkpointEventCount();
      session.strip_after_second = await observeStripText(8_000);
      report.second_round = second;
      report.checkpoint_events_after_second = session.checkpoint_events_after_second;
      report.triggered_after_second = session.checkpoint_events_after_second > 0;
      harness.capture("after-second-round");
      if (report.triggered_after_second) {
        // G6：页面细条展开证据（原因/原文保留/来源/完整记录入口四要素）+ 压缩后真实请求。
        report.strip_expanded = await clickStripAndExpand();
        harness.capture("after-expanded");
        const third = await sendRequest(3, process.env.B71_ANSWER_MODE_THIRD_REQUEST ?? "继续：请把两个方向的共同前提写清楚，并说明各自适合什么时候用。");
        session.third_round = third;
        report.third_round = third;
        report.checkpoint_events_after_third = checkpointEventCount();
        harness.capture("after-next-request");
      }
    } catch (error) {
      report.second_round = { ok: false, error: error.message };
    }
  }

  harness.capture("a3-final");
}

// 压缩触发后补一轮作者请求，产生「压缩后 provider 请求」证据（C5 按事件时间窗判定）。
// 触发 run 明确 awaiting_author → 沿用该 run 的真实界面回答（同 run steer）；明确
// terminal 且是实模 G6 → 复用 sendRequest 在同一页面会话提交一个作者新 turn。
// 触发 run 未绑定、等待超时或发送结果不确定 → skipped 缺证，不补发。
async function sendNextRequestAfterTrigger({ index, queue, trigger, allowFreshTurn }) {
  const text = queue?.[0] ?? "按你的判断继续：给出下一步写作建议。";
  const base = {
    index,
    checkpoint_run_id: trigger?.checkpoint_run_id ?? null,
    trigger_run_id: trigger?.run_id ?? null,
    text,
  };
  if (!trigger?.run_id) return { ...base, skipped: true, reason: "trigger_run_unknown" };
  const pause = await waitRunPauseOrTerminal({ runId: trigger.run_id });
  const state = { ...base, pause_kind: pause.kind, pause_status: pause.status ?? null };
  if (pause.kind === "paused") {
    const steer = await respondToRunPause(text, [], {
      observed: true,
      strategy: process.env.B71_AUTO_MAINT_ANSWER_STRATEGY ?? "continue_verification",
    });
    if (!steer.ok) return { ...state, skipped: true, reason: "steer_failed", steer };
    const resume = await waitRunResume({ runId: trigger.run_id });
    const after = await waitRunPauseOrTerminal({ runId: trigger.run_id });
    return {
      ...state,
      skipped: false,
      steer,
      resume,
      pause_after: after.kind,
      pause_after_status: after.status ?? null,
      checkpoint_events: checkpointEventCount(),
    };
  }
  // 只有 DB 明确 terminal 才是真实已终局；timeout/其它状态如实缺证。
  if (pause.kind !== "terminal") return { ...state, skipped: true, reason: `run_${pause.kind}` };
  if (!allowFreshTurn) return { ...state, skipped: true, reason: "run_terminal" };
  try {
    const request = await sendRequest(index, text);
    return { ...state, skipped: false, reason: null, fresh_turn: true, request, checkpoint_events: checkpointEventCount() };
  } catch (error) {
    // 已尝试发送但结果不确定：只保留诊断，不重试、不盲发第二个 turn。
    return { ...state, skipped: true, reason: "fresh_turn_failed", error: error.message };
  }
}

// B81 专项。A 的未答问题保持打开，作者从主输入区发起 B，再回到 A 的原问题。
// 常规 C1–C11 的验收口径保持，专项结果另记在 interleaved_resume。
async function runInterleavedResume(report) {
  const aText = process.env.B71_AUTO_MAINT_REQUEST ??
    "先独立核对第一章章计划、第二章章计划、第二章正文首尾、两章间的故事推进和作品约束。缺资料就如实记录。读完先别写正文，请让我在“保留悬念”和“明示线索”之间做一个选择。";
  const bText = process.env.B71_AUTO_MAINT_EXTRA_REQUEST ??
    "另外帮我核对第一章章计划与第二章已采纳正文的衔接，只给出查到的两点依据。这个独立讨论不需要我确认，也不要修改作品。";
  const a = await sendRequest(1, aText);
  report.requests.push(a);
  const result = { waiting_run_id: a.run_id, later_run_id: null, stop_reason: null };
  report.interleaved_resume = result;
  if (!a.run_id || readRunStatus(a.run_id) !== "awaiting_author") {
    result.stop_reason = "first_run_not_waiting";
    return;
  }
  const warmAnswers = Number(process.env.B71_AUTO_MAINT_INTERLEAVED_A_ANSWERS ?? 0);
  if (warmAnswers > 0) {
    result.warm_answers = await settleAuthorRun({
      runId: a.run_id,
      text: "确认这个选项，按顺序只问下一题。",
      answerBudget: warmAnswers,
    });
    if (result.warm_answers.reason !== "answer_budget_exhausted") {
      result.stop_reason = result.warm_answers.reason ?? "first_run_finished_during_warm_answers";
      return;
    }
  }
  const question = await harness.runStep("turn", "interleaved_open_question", () =>
    harness.pollWire((wire) => {
      const open = openAuthorQuestionFor(wire, a.run_id);
      return open?.goal_version === 1 + warmAnswers ? open : null;
    }, 20_000, `${FLOW_LABEL}:interleaved_open_question`),
  );
  result.waiting_question_ref = question.question_ref;
  result.waiting_goal_version = question.goal_version;
  result.waiting_exchange_facts = readRunExchangeFacts(a.run_id);
  harness.capture("interleaved-a-waiting");

  const newDiscussion = (nodes) => findButtonByText(nodes, (title) => title.trim() === "开始新讨论");
  await harness.runStep("input", "interleaved_start_new_discussion", async () => {
    const { nodes } = await harness.pollAx((_text, nodes) => Boolean(newDiscussion(nodes)), 15_000, `${FLOW_LABEL}:new_discussion`);
    return harness.safeClick(newDiscussion(nodes), `${FLOW_LABEL}:new_discussion`);
  });
  const b = await sendRequest(2, bText, { settlePaused: true });
  report.requests.push(b);
  result.later_run_id = b.run_id;
  result.later_exchange_facts = b.run_id ? readRunExchangeFacts(b.run_id) : null;
  result.waiting_status_after_later_run = readRunStatus(a.run_id);
  report.triggered = checkpointEventCount() > 0;
  if (report.triggered) report.maintenance_strip = await captureTriggeredMaintenanceEvidence();
  harness.capture("interleaved-b-settled");
  if (!b.run_id || b.run_id === a.run_id || !b.settled ||
      result.waiting_status_after_later_run !== "awaiting_author") {
    result.stop_reason = "distinct_later_run_or_preserved_wait_missing";
    return;
  }

  // B 结束后必须重新看到真实回答区。缺入口时留截图和待答事实，不走普通发送兜底。
  const panel = await harness.runStep("maintenance", "interleaved_return_to_question", () =>
    harness.tryPollAx((_text, nodes) => Boolean(newDiscussion(nodes)), 12_000, `${FLOW_LABEL}:return_to_question`),
  );
  harness.capture("interleaved-a-return");
  if (!panel) {
    result.stop_reason = "waiting_question_not_visible_after_later_run";
    return;
  }
  result.resume = await settleAuthorRun({ runId: a.run_id, text: "保留悬念" });
  result.stop_reason = result.resume.reason;
  harness.capture("interleaved-a-resumed");

  // A 可能在恢复的最后一个安全点追加 checkpoint，完成后已无同 run 请求。
  if (settlementOf(result.resume.last).completed && latestCheckpointRunId() === a.run_id) {
    const index = nextRequestIndex(report.requests);
    const nextRequest = await sendRequest(
      index,
      "请根据刚才已经核对的内容，用一句话重述我最后选择的处理方式。不再查新资料，也不修改作品。",
      { settlePaused: true },
    );
    report.requests.push(nextRequest);
    report.next_request = nextRequest;
    harness.capture("after-next-request");
    runEvidenceMode(evidence, "capture", dir, ["after-next-request"]);
  }
}

async function run() {
  runEvidenceMode(evidence, "prepare", dir);
  const config = readJson(path.join(dir, "native-b71-config.json"));
  const expectedJourney = ANSWER_MODE ? "answer-mode" : "auto-maintenance";
  if (config.journey !== expectedJourney) {
    throw new Error(`${expectedJourney} driver 只接受 journey=${expectedJourney}，实测: ${config.journey}`);
  }
  const allowedProviders = ANSWER_MODE ? ["slice_verify"] : ["strata"];
  if (!allowedProviders.includes(config.provider)) {
    throw new Error(`${expectedJourney} driver 只接受 provider=${allowedProviders.join("|")}，实测: ${config.provider}`);
  }
  const requests = Array.isArray(config.auto_maintenance?.requests) && config.auto_maintenance.requests.length > 0
    ? config.auto_maintenance.requests
    : [...AUTO_MAINTENANCE_REQUESTS];

  const before = await readStrataState({ endpoint: strataEndpoint }).catch((error) => ({ ok: false, error: error.message }));
  write(dir, "strata-slot-before.json", strataLifecycleRecord({ before, after: before, unload: null }));

  let driverLog = null;
  try {
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready", () =>
      harness.rawWaitWorkbenchSettled(FLOW_LABEL, READY_TIMEOUT_MS),
    );
    await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, FLOW_LABEL);
    harness.capture("01-workbench");
    runEvidenceMode(evidence, "capture", dir, ["start"]);

    const report = {
      slice_id: config.slice_id,
      provider: "strata",
      model: config.target?.model ?? "iq3_s",
      env: envFacts,
      requests: [],
      triggered: false,
      first_trigger_index: null,
      maintenance_strip: null,
      next_request: null,
      refresh: null,
      failure_injection: null,
      recovery: null,
      model_behavior: null,
      termination: null,
    };

    if (INTERLEAVED_RESUME && !ANSWER_MODE) {
      await runInterleavedResume(report);
    } else if (process.env.B71_AUTO_MAINT_MULTI_TURN === "1") {
      await runMultiTurnFlow({ report, requests, workTitle: config.target.work_title });
    } else {
    // ≥2 次真实续行（最多 requests 条）；安全点自动整理触发后停止发送。
    // live A3 的 warm-up 在暂停时用同 run 真实问题 bounded 结算；未终局不再盲发。
    const liveWarmup = !ANSWER_MODE && process.env.B71_AUTO_MAINT_SMOKE !== "1";
    for (let index = 1; index <= requests.length; index += 1) {
      const request = await sendRequest(index, requests[index - 1], {
        settlePaused: liveWarmup,
        checkpointEarlyStop: liveWarmup,
      });
      report.requests.push(request);
      if (request.checkpoint_events_after > 0) {
        report.triggered = true;
        report.first_trigger_index = index;
        break;
      }
      if (liveWarmup && !request.settled) {
        report.unsettled = {
          index,
          reason: request.settle_reason,
          attempts: request.settle_attempts,
        };
        break;
      }
      if (index >= 2) {
        // 已至少 2 次真实续行仍无整理：继续尝试（窗口压力可能需更多轮），不伪造。
      }
    }

    if (report.triggered) {
      harness.capture("after-maintenance");
      runEvidenceMode(evidence, "capture", dir, ["after-maintenance"]);

      report.maintenance_strip = await clickStripAndExpand();
      harness.capture("after-expanded");
      runEvidenceMode(evidence, "capture", dir, ["after-expanded"]);

      // 下一请求：整理之后的第一个真实请求 → 精简判据在 evidence 侧按 llm-calls 时间窗判定。
      // index 按已发送回合递增，requests 用尽时用通用文本，保证 capture 唯一。
      const nextIndex = nextRequestIndex(report.requests);
      const nextRequest = await sendRequest(
        nextIndex,
        requests[nextIndex - 1] ?? "继续：按你的判断继续推进。",
      );
      report.next_request = nextRequest;
      harness.capture("after-next-request");
      runEvidenceMode(evidence, "capture", dir, ["after-next-request"]);

      // 重启幂等 + 失败静默 + 恢复，与正式 live multi-turn 共用同一 helper。
      await runRecoveryProbes({
        report,
        requests,
        workTitle: config.target.work_title,
        currentRunId: nextRequest.run_id,
        startIndex: nextIndex + 1,
      });
    } else {
      // 未触发真实压力/自动维护：如实记录未闭环，不伪造细条/窗口。
      harness.capture("after-maintenance");
      runEvidenceMode(evidence, "capture", dir, ["after-maintenance"]);
      report.maintenance_strip = { found: false, clicked: false, reason: "not_triggered" };
    }

    }

    report.termination = {
      at: harness.nowIso(),
      llm_calls: llmRecordCount(),
      checkpoint_events: checkpointEventCount(),
    };
    report.model_behavior = {
      provider_calls: llmRecordCount(),
      requests_total: report.requests.length,
      triggered: report.triggered,
      run_statuses: report.requests.map((request) => request.run_status),
    };
    if (ANSWER_MODE) {
      report.answer_mode = {
        request: ANSWER_MODE_REQUEST,
        choice: ANSWER_MODE_CHOICE,
        multi_turn: report.multi_turn ?? null,
      };
    }
    if (process.env.B71_AUTO_MAINT_SMOKE === "1") {
      write(dir, "a3b-smoke-observations.json", {
        smoke: true,
        generated_at: harness.nowIso(),
        env: envFacts,
        multi_turn: report.multi_turn ?? null,
        requests: report.requests,
        termination: report.termination,
      });
      console.log(
        `A3B smoke 观测: ${JSON.stringify({
          pause: report.multi_turn?.pause ?? null,
          steer: report.multi_turn?.steer ?? null,
          exchange_facts: report.multi_turn?.exchange_facts ?? null,
          usage_facts: report.multi_turn?.usage_facts ?? null,
          checkpoint_events: report.termination?.checkpoint_events ?? null,
          strip: report.multi_turn?.strip ?? null,
        })}`,
      );
    }

    harness.capture("final");
    const turnBodies = harness
      .transport()
      .filter((record) => record?.direction === "received" && Array.isArray(record.frame) && record.frame[3] === "turn_result")
      .map((record) => record.frame[4] ?? {});
    runEvidenceMode(evidence, "capture", dir, ["final"]);
    driverLog = {
      ...report,
      turn_results: turnBodies.length,
      strata: { endpoint: strataEndpoint },
    };
    harness.writeDriverLog("native-b71-driver-log.json", driverLog);
    console.log(
      `B71 auto-maintenance 驱动完成: requests=${report.requests.length} triggered=${report.triggered} checkpoint_events=${report.termination.checkpoint_events} failure_silent=${
        report.failure_injection?.author_error_visible === false
      }`,
    );
  } finally {
    if (ANSWER_MODE) {
      // answer-mode 是确定性 slice_verify 批次：无 strata 单槽生命周期，不写 strata-slot。
      if (driverLog) harness.writeUiComplete(config.slice_id);
      return;
    }
    const unload = await unloadStrata({ endpoint: strataEndpoint }).catch((error) => ({
      unload: { ok: false, error: error.message },
      state: { error: error.message },
      slot: { ok: false, loaded: null, reason: `unload_failed:${error.message}` },
    }));
    write(dir, "strata-slot.json", strataLifecycleRecord({ before, after: unload.state, unload: unload.unload }));
    if (driverLog) {
      harness.writeDriverLog("native-b71-driver-log.json", {
        ...driverLog,
        strata: { ...driverLog.strata, unload: unload.unload, after: unload.state, slot_after: unload.slot },
      });
      // ui-complete 是 runner 的「驱动完成」信号：必须在 finally 证据（strata-slot/driver-log）
      // 全部落盘之后写，避免 runner 在 strata-slot.json 落盘前开始 verify（证据时序竞争）。
      harness.writeUiComplete(config.slice_id);
    }
  }
}

await harness.runJourney(run);
