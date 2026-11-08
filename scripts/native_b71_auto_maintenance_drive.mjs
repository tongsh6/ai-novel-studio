// B71 §16.16 第 2 类入口（安全点自动维护）原生外部驱动（journey=auto-maintenance）。
//
// 真实 strata + 小窗口压力（NOVEL_CONTEXT_WINDOW_OVERRIDES="strata:4096"）+
// NOVEL_AUTO_MAINTENANCE_ENABLED=1：≥2 次真实续行形成更早工作回合 → 安全点自动整理 →
// 行内细条 → 展开（原因/原文保留/来源/完整记录入口）→ 下一请求精简 → 刷新幂等 →
// 失败静默（隔离 test DB 持久 trigger）→ 全类别 AX 扫描 → 清理。
//
// 不伪造窗口、不注入 usage、不手工压缩；无法形成真实压力时如实记录未闭环。
import path from "node:path";
import fs from "node:fs";
import { readJson } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import { all, logs, withDb, write } from "./lib/native_ui/scenario_evidence.mjs";
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

const checkpointEventCount = () =>
  withDb(dir, (db) =>
    Number(
      all(db, "SELECT COUNT(*) AS c FROM agent_events WHERE event_type = 'checkpoint_created'")[0]?.c ?? 0,
    ),
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

async function sendRequest(index, text) {
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
  const terminal = await waitRunTerminal({ turnId, runId });
  if (!terminal) throw new Error(`auto_maint: request_${index} terminal_missing`);
  const turnBody = terminal.body ?? null;
  const classified = turnBody ? classifyTurnBody(turnBody) : null;
  const events = checkpointEventCount();
  return {
    index,
    text,
    turn_id: turnId,
    run_id: runId || terminal.body?.agent_run?.run_id || null,
    terminal_kind: terminal.kind,
    terminal_status: terminal.status ?? null,
    run_status: classified?.run_status ?? terminal.status ?? null,
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

function authorErrorVisible() {
  try {
    const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:failure_scan`);
    const alerts = nodes.filter((node) => ["AXSheet", "AXDialog"].includes(node?.role));
    const texts = nodes.map((node) => `${node?.title ?? ""} ${node?.desc ?? ""} ${node?.value ?? ""}`).join("\n");
    return alerts.length > 0 && /失败|错误|异常/u.test(texts);
  } catch {
    return false;
  }
}

function injectFailureTrigger() {
  withDb(dir, (db) => {
    db.exec("DROP TRIGGER IF EXISTS reject_b71_auto_maintenance");
    db.exec(
      "CREATE TRIGGER reject_b71_auto_maintenance BEFORE INSERT ON agent_events " +
        "WHEN NEW.event_type = 'checkpoint_created' " +
        "BEGIN SELECT RAISE(ABORT, 'maintenance unavailable'); END;",
    );
  });
}

function dropFailureTrigger() {
  withDb(dir, (db) => {
    db.exec("DROP TRIGGER IF EXISTS reject_b71_auto_maintenance");
  });
}

function waitCheckpointIncrease(baseline, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    harness.checkSupervisor();
    if (checkpointEventCount() > baseline) return true;
    const sleep = new Promise((resolve) => setTimeout(resolve, 1_000));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
    void sleep;
  }
  return false;
}


// ── A3b：同一 run 内 ≥2 作者回合（真实控制坞 steer）────────────────────────
function findButtonByText(nodes, predicate) {
  return nodes.find((node) => node?.role === "AXButton" && predicate(String(node.title ?? ""))) ?? null;
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
  return withDb(dir, (db) => {
    const row = all(db, "SELECT authoring_transcript FROM agent_runs WHERE id = ?", [runId])[0] ?? null;
    let messages = [];
    try {
      const parsed = JSON.parse(row?.authoring_transcript ?? "{}");
      messages = parsed?.transcript?.messages ?? [];
    } catch {
      messages = [];
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
  while (Date.now() < deadline) {
    harness.checkSupervisor();
    const status = readRunStatus(runId);
    lastStatus = status;
    if (status === "awaiting_author") return { kind: "paused", status };
    if (["completed", "failed", "cancelled"].includes(String(status))) return { kind: "terminal", status };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { kind: "timeout", status: lastStatus };
}

async function waitRunResume({ runId, timeoutMs = TURN_TIMEOUT_MS }) {
  // 回答后同一 run 应从 awaiting_author 恢复（running/completed/failed 均视为继续）。
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    harness.checkSupervisor();
    const status = readRunStatus(runId);
    lastStatus = status;
    if (["running", "completed", "failed", "cancelled"].includes(String(status))) {
      return { resumed: true, status };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { resumed: false, status: lastStatus };
}

// 从真实回答面板读问题文本与选项（观察驱动多轮的唯一输入来源）。
function readAnswerObservation(nodes, panel) {
  const prefix = panel?.path ? `${panel.path}/` : null;
  const scoped = prefix ? nodes.filter((node) => String(node?.path ?? "").startsWith(prefix)) : [];
  const fixedUi = /^(回答当前问题|回答并继续|回答并继续…|选项[A-Za-z0-9]?)$/u;
  const staticTexts = scoped
    .filter((node) => node?.role === "AXStaticText")
    .map((node) => String(node?.title ?? node?.value ?? node?.desc ?? "").trim())
    .filter((text) => text && !fixedUi.test(text));
  const questionText =
    staticTexts.join(" ").trim() ||
    String(panel?.title ?? panel?.desc ?? "").replace(/^回答当前问题[:：]?/u, "").trim();
  const optionTitles = nodes
    .filter((node) => node?.role === "AXButton" && /^选项[A-Za-z0-9]?/u.test(String(node.title ?? "").trim()))
    .map((node) => String(node.title ?? "").trim());
  return { question_text: questionText, option_titles: optionTitles, scoped_nodes: scoped.length };
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
  const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:pause_panel`);

  // 新交互（46 §9.7 等待即回答）：底部主输入区接管为回答面板
  // （role=group aria-label「回答当前问题」：问题文本 + 选项按钮 +「回复此问题」→ textarea →「发送回复」）。
  // 消息流问题卡只是只读记录（aria-label「创作问题记录」），不可点击。
  const answerPanel = nodes.find(
    (node) =>
      /回答当前问题/u.test(`${node?.title ?? ""} ${node?.desc ?? ""} ${node?.value ?? ""}`) &&
      ["AXGroup", "AXGenericGroup", "AXSheet", "AXList", "AXStaticText"].includes(String(node?.role ?? "")),
  );
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
    // 路径 1（优先）：结构化选项按钮 → author_choice 回答（同 run 继续）。
    const rawChoice = String(process.env.B71_AUTO_MAINT_ANSWER_CHOICE ?? "").trim();
    const answerChoice = rawChoice.toUpperCase();
    const choiceButtons = nodes.filter(
      (node) => node?.role === "AXButton" && /^选项[A-Za-z0-9]?/u.test(String(node.title ?? "").trim()),
    );
    const choiceButton = (() => {
      if (observed && planned?.choice) {
        return nodes.find((node) => node?.role === "AXButton" && String(node.title ?? "").trim() === planned.choice) ?? null;
      }
      if (rawChoice === "" && ANSWER_MODE) {
        // answer-mode：确定性 fixture 的选项 button label 是选项文字本身（如「保留悬念」）。
        return (
          nodes.find(
            (node) => node?.role === "AXButton" && String(node.title ?? "").includes(ANSWER_MODE_CHOICE),
          ) ?? null
        );
      }
      if (answerChoice === "FREE_TEXT") return null;
      return (
        choiceButtons.find((node) => String(node.title ?? "").trim().startsWith(`选项${answerChoice}`)) ??
        (answerChoice === "" ? choiceButtons[0] : null) ??
        null
      );
    })();
    if (choiceButton) {
      harness.safeClick(choiceButton, `${FLOW_LABEL}:answer_choice`);
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
    );
    if (composerField && answerSend) {
      harness.safeClick(composerField, `${FLOW_LABEL}:answer_composer`);
      await sleep(300);
      typeText(harness.APP, answerText);
      await sleep(800);
      const send = findButtonByText(
        harness.dumpNodesForInteraction(`${FLOW_LABEL}:answer_composer_send`),
        (value) => value === "回答并继续",
      );
      attempts.push({ step: "find_answer_composer", ok: Boolean(composerField), send: Boolean(send) });
      if (!send) return { ok: false, reason: "answer_send_not_found", composer: true };
      harness.safeClick(send, `${FLOW_LABEL}:answer_composer_send`);
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

// A3b 同 run 多回合流程：长任务请求 → 自然 awaiting_author → 真实控制坞 steer →
// 同一 run 继续 → 安全点检查自动维护（smoke 只观测，不产验收证据）。
async function runMultiTurnFlow({ report, requests }) {
  // G6-multi-turn 正式场景（2026-11-08 作者授权）：同 run 连续 steer，直到
  // 安全点自动维护触发（checkpoint_created）或 steer 预算耗尽/run 终局。
  // 触发后补作者可见细条/展开面板与「压缩后真实请求」证据；不触发则如实记录，
  // 不伪造、不调 K/窗口。smoke 模式（B71_AUTO_MAINT_SMOKE=1）复用同一驱动但
  // runner 不产验收判据。
  // 正式 multi-turn 场景允许预注册指定长请求与 steer 文本（真实用户输入，不注入产品）。
  const longRequest =
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
      session.stop_reason = "resume_failed";
      break;
    }
    pause = await waitRunPauseOrTerminal({ runId: first.run_id });
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

  if (!triggered && !session.stop_reason) {
    session.stop_reason =
      pause.kind === "paused" ? "steer_budget_exhausted" : `run_${pause.kind}`;
  }
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
  report.first_trigger_index = triggered ? 1 : null;

  if (triggered) {
    harness.capture("after-maintenance");
    runEvidenceMode(evidence, "capture", dir, ["after-maintenance"]);
    report.maintenance_strip = await clickStripAndExpand();
    harness.capture("after-expanded");
    runEvidenceMode(evidence, "capture", dir, ["after-expanded"]);

    // 压缩后真实请求：同 run 再 steer 一轮（若 run 已终局则如实记录缺口）。
    const nextSteer = await sendSteerAfterPause({
      index: session.steers.length + 1,
      queue: requests,
      runId: first.run_id,
    });
    session.next_request = nextSteer;
    report.next_request = nextSteer;
    harness.capture("after-next-request");
    runEvidenceMode(evidence, "capture", dir, ["after-next-request"]);
  } else {
    harness.capture("after-maintenance");
    runEvidenceMode(evidence, "capture", dir, ["after-maintenance"]);
    report.maintenance_strip = {
      found: session.strip?.visible === true,
      clicked: false,
      reason: "not_triggered",
    };
  }
  harness.capture("a3-final");
}

// 压缩触发后再补一轮同 run steer，产生「压缩后 provider 请求」证据（C5 按事件时间窗判定）。
async function sendSteerAfterPause({ index, queue, runId }) {
  const pause = await waitRunPauseOrTerminal({ runId });
  if (pause.kind !== "paused") return { skipped: true, reason: `run_${pause.kind}`, index };
  const text = queue?.[0] ?? "按你的判断继续：给出下一步写作建议。";
  const steer = await respondToRunPause(text, [], {
    observed: true,
    strategy: process.env.B71_AUTO_MAINT_ANSWER_STRATEGY ?? "continue_verification",
  });
  if (!steer.ok) return { skipped: true, reason: "steer_failed", index, steer };
  const resume = await waitRunResume({ runId });
  const after = await waitRunPauseOrTerminal({ runId });
  return { skipped: false, index, text, steer, resume, pause_after: after.kind, checkpoint_events: checkpointEventCount() };
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

    if (process.env.B71_AUTO_MAINT_MULTI_TURN === "1") {
      await runMultiTurnFlow({ report, requests });
    } else {
    // ≥2 次真实续行（最多 requests 条）；安全点自动整理触发后停止发送。
    for (let index = 1; index <= requests.length; index += 1) {
      const request = await sendRequest(index, requests[index - 1]);
      report.requests.push(request);
      if (request.checkpoint_events_after > 0) {
        report.triggered = true;
        report.first_trigger_index = index;
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
      const nextIndex = Math.min((report.first_trigger_index ?? 1) + 1, requests.length);
      const nextRequest = await sendRequest(nextIndex, requests[nextIndex - 1]);
      report.next_request = nextRequest;
      harness.capture("after-next-request");
      runEvidenceMode(evidence, "capture", dir, ["after-next-request"]);

      // 刷新（重启恢复）幂等。
      const refreshBefore = checkpointEventCount();
      await harness.runStep("restore", "close_app_and_relaunch", () => harness.rawCloseAppAndRelaunch());
      await harness.runStep("maintenance", "workbench_ready_restored", () =>
        harness.rawWaitWorkbenchSettled(`${FLOW_LABEL}:restored`, READY_TIMEOUT_MS),
      );
      await harness.runStep("maintenance", "work_selected_restored", () =>
        harness.rawTrySelectWork(config.target.work_title, `${FLOW_LABEL}:restored`),
      );
      const refreshAfter = checkpointEventCount();
      report.refresh = { before_checkpoint_events: refreshBefore, after_checkpoint_events: refreshAfter };
      harness.capture("after-refresh");
      runEvidenceMode(evidence, "capture", dir, ["after-refresh"]);

      // 失败静默：持久 trigger → 下一请求的安全点维护失败（静默）→ 页面无错误、DB 无新 checkpoint。
      const failureBefore = checkpointEventCount();
      injectFailureTrigger();
      const failureIndex = Math.min((report.first_trigger_index ?? 1) + 2, requests.length);
      const failureRequest = await sendRequest(failureIndex, requests[failureIndex - 1]);
      const failureVisible = authorErrorVisible();
      const failureAfter = checkpointEventCount();
      harness.capture("after-failure");
      runEvidenceMode(evidence, "capture", dir, ["after-failure"]);
      dropFailureTrigger();

      // 恢复：移除 trigger 后下一安全点应出现 checkpoint_created（重试成功）。
      const recoveryBaseline = failureAfter;
      const recoveryIndex = Math.min((report.first_trigger_index ?? 1) + 3, requests.length);
      const recoveryRequest = await sendRequest(recoveryIndex, requests[recoveryIndex - 1]);
      const recovered = waitCheckpointIncrease(recoveryBaseline);
      report.failure_injection = {
        trigger_created: true,
        author_error_visible: failureVisible,
        checkpoint_events_before_failure: failureBefore,
        checkpoint_events_after_failure: failureAfter,
        recovered_after_drop: recovered,
        failure_request: failureRequest,
        recovery_request: recoveryRequest,
      };
      report.recovery = { recovered, checkpoint_events: checkpointEventCount() };
      harness.capture("after-recovery");
      runEvidenceMode(evidence, "capture", dir, ["after-recovery"]);
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
