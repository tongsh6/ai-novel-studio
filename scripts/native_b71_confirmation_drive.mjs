// B71 §16.14 工具确认/拒绝原生外部驱动（journey=confirmation）。
//
// 真实页面流程：作者高风险请求 → needs_confirmation（awaiting_author behavior +
// confirm_before_execute/reject_or_cancel_confirmation）→ 按用户可见语义与所属消息块
// 定位「确认执行」/「拒绝」→ 点击 → 采集 ACK/action_result/决定 TurnResult/子执行 →
// **真正打开 Why 面板**（多策略：可见→滚动→AXPress）并实测前后 Provider/llm-calls →
// 重复点击（若可点则等 duplicate ack；不可点则记录原因+delta）→ 重启恢复（决定/创作
// 结果可见 + 零重放 delta）→ 终止观测（app/端口/llm-calls）。
//
// 不手造 needs_confirmation 帧、不改产品代码；按钮定位复用 pending 的消息块模型
// （locateConfirmationButton），不借用兄弟候选按钮。
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { readJson } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import { all, withDb, write } from "./lib/native_ui/scenario_evidence.mjs";
import {
  CONFIRMATION_MODES,
  CONFIRMATION_REQUEST,
  confirmationCardLines,
  executedConfirmationTurnResult,
  locateConfirmationButton,
  needsConfirmationTurnResult,
  rejectConfirmationTurnResult,
  selectConfirmationAction,
} from "./lib/native_ui/authoring_confirmation_evidence.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b71_confirmation_drive.mjs <batch-run-dir>");
  process.exit(64);
}

const evidence = path.join(ROOT, "scripts/native_b71_evidence.mjs");
const harness = new NativeScenarioHarness(dir);
const CONF = { ready: 180_000, card: 200_000, action: 120_000, executed: 240_000, restore: 180_000 };

function countLlmCalls() {
  const logDir = path.join(dir, "llm-calls");
  if (!fs.existsSync(logDir)) return 0;
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .reduce(
      (total, file) =>
        total + fs.readFileSync(path.join(logDir, file), "utf8").split("\n").filter((line) => line.includes("{")).length,
      0,
    );
}

function readDbCounts() {
  const counts = withDb(dir, (db) => {
    const count = (table) => all(db, `SELECT COUNT(*) AS c FROM ${table}`)[0].c;
    return {
      provider_runs: count("provider_runs"),
      receipts: count("author_action_receipts"),
      agent_runs: count("agent_runs"),
      mutations: count("mutations"),
    };
  });
  return { ...counts, llm_calls: countLlmCalls() };
}

function countAppProcesses() {
  try {
    const out = execFileSync("pgrep", ["-f", "AI Novel Studio.app/Contents/MacOS/app"], { encoding: "utf8" });
    return out.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function portListening(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split("\n").filter((line) => line.includes("LISTEN")).length > 0;
  } catch {
    return false;
  }
}

function replyBody(record) {
  const body = frameBody(record) ?? {};
  return body.response ?? body;
}

function replyRecordsFor(wire, sent) {
  const ref = sent?.frame?.[1] ?? null;
  const joinRef = sent?.frame?.[0] ?? null;
  return wire.filter(
    (record) =>
      record?.direction === "received" &&
      Array.isArray(record.frame) &&
      record.frame[3] === "phx_reply" &&
      record.frame[1] === ref &&
      record.frame[0] === joinRef,
  );
}

function visibleConfirmationButton(nodes, label, cardLines) {
  return locateConfirmationButton(nodes, {
    label,
    cardTitle: cardLines.title,
    cardBody: cardLines.body,
    knownItems: [cardLines.title, cardLines.body],
  });
}

async function waitCardVisible() {
  return harness.runStep("maintenance", "confirmation_card_visible", () =>
    harness.pollAx(
      (text) => text.includes("确认执行") && text.includes("拒绝") && text.includes("需要确认"),
      60_000,
      "b71-confirmation:card",
    ),
  );
}

async function sendHighRiskRequest() {
  await harness.runStep("maintenance", "input_ready", () =>
    harness.rawWaitInputReady("b71-confirmation", CONF.ready),
  );
  const sent = await harness.runStep("input", "high_risk_rewrite_request", () =>
    harness.rawTypeAndSend(CONFIRMATION_REQUEST, "b71-confirmation"),
  );
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  if (!turnId) throw new Error("confirmation: user_message_without_turn_id");
  const ack = await harness.runStep("ack", "user_message_ack", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 30_000, "b71-confirmation:ack"),
  );
  const runId = String(frameBody(ack)?.response?.run_id ?? "");
  return { sent, turnId, runId };
}

async function waitNeedsConfirmation() {
  return harness.runStep("turn", "needs_confirmation", () =>
    harness.pollWire(
      (wire) => {
        const turn = needsConfirmationTurnResult(wire);
        if (turn) return turn;
        const failed = wire.find(
          (record) =>
            record?.direction === "received" &&
            Array.isArray(record.frame) &&
            record.frame[3] === "run_failed",
        );
        if (failed) {
          throw new Error(`b71-confirmation:run_failed:${JSON.stringify(frameBody(failed)?.reason_codes ?? "unknown")}`);
        }
        return null;
      },
      CONF.card,
      "b71-confirmation:needs_confirmation",
    ),
  );
}

async function clickConfirmation(mode, cardLines) {
  const spec = CONFIRMATION_MODES[mode];
  const nodes = harness.dumpNodesForInteraction("b71-confirmation:locate");
  const located = visibleConfirmationButton(nodes, spec.label, cardLines);
  if (!located.ok) {
    throw new Error(`b71-confirmation:locate_${spec.label}:${located.reason}:${JSON.stringify(located).slice(0, 300)}`);
  }
  await harness.runStep("input", `click_${spec.label}`, async () => {
    await harness.safeClick(located.button, `confirmation:${spec.label}`);
  });
  return located;
}

async function waitActionSent(action) {
  return harness.runStep("ack", "author_action_sent", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (record) =>
            record?.direction === "sent" &&
            Array.isArray(record.frame) &&
            record.frame[3] === "author_action" &&
            frameBody(record)?.action?.action_id === action.action_id &&
            frameBody(record)?.action?.action_type === action.action_type,
        ) ?? null,
      30_000,
      "b71-confirmation:author_action_sent",
    ),
  );
}

async function waitActionAck(sent) {
  return harness.runStep("ack", "author_action_ack", () =>
    harness.pollWire(
      (wire) => {
        const replies = replyRecordsFor(wire, sent);
        if (replies.length > 1) throw new Error(`b71-confirmation:action_ack_ambiguous:${replies.length}`);
        return replies[0] ?? null;
      },
      30_000,
      "b71-confirmation:action_ack",
    ),
  );
}

async function waitExecutedTurn(sinceIso) {
  // 确认路径：点击后出现带真实 tool_result 的 turn_result；时间窗起点取点击前。
  return harness.runStep("turn", "confirmed_child_turn", () =>
    harness.pollWire(
      (wire) => executedConfirmationTurnResult(wire, sinceIso),
      CONF.executed,
      "b71-confirmation:executed",
    ),
  );
}

async function waitRejectTurn(sinceIso, { sourceTurnId, userTurnId }) {
  return harness.runStep("turn", "reject_turn", () =>
    harness.pollWire(
      (wire) => rejectConfirmationTurnResult(wire, sinceIso, { sourceTurnId, userTurnId }),
      CONF.executed,
      "b71-confirmation:reject_turn",
    ),
  );
}

// Why 只读面板：必须真正打开（C9 硬门禁）。策略：可见按钮 → 完整 AX 扫描 + scrollTo →
// 仍不可见时直接 AXPress 该按钮路径 → 面板文本（参考来源 + 不会重新调用模型）可见。
async function openWhyAndCount() {
  const attempts = [];
  const before = readDbCounts();
  const candidatesOf = () => {
    try {
      return harness
        .dumpNodesForInteraction("b71-confirmation:why_scan")
        .filter(
          (node) =>
            node?.role === "AXButton" &&
            (node.title === "为什么" || String(node.desc ?? "").includes("查看这轮回应的依据")),
        );
    } catch (error) {
      attempts.push({ strategy: "scan", ok: false, reason: error.message });
      return [];
    }
  };
  let nodes = null;
  try {
    const probe = await harness.tryPollAx((_text, candidate) => Boolean(harness.findWhyButton(candidate)), 15_000);
    nodes = probe?.nodes ?? null;
    attempts.push({ strategy: "visible_probe", ok: Boolean(nodes && harness.findWhyButton(nodes)) });
  } catch (error) {
    attempts.push({ strategy: "visible_probe", ok: false, reason: error.message });
  }
  if (!nodes || !harness.findWhyButton(nodes)) {
    // AX 树在 capture/动画后可能短暂重组：scan 有界重试并记录每次 dump 规模（防单次空树）。
    let candidates = [];
    let scanNodes = null;
    for (let attempt = 0; attempt < 4 && candidates.length === 0; attempt += 1) {
      const scan = candidatesOf();
      candidates = scan;
      try {
        scanNodes = harness.dumpNodesForInteraction("b71-confirmation:why_scan:size");
      } catch (error) {
        attempts.push({ strategy: "scan", attempt, ok: false, reason: error.message });
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      attempts.push({ strategy: "scan", attempt, ok: candidates.length > 0, count: candidates.length, nodes: list(scanNodes).length });
      if (candidates.length === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const target = candidates.at(-1) ?? null;
    if (target?.path) {
      try {
        harness.ensureInput().scrollTo(target.path);
        attempts.push({ strategy: "scroll_to", ok: true, path: target.path });
      } catch (error) {
        attempts.push({ strategy: "scroll_to", ok: false, path: target.path, reason: error.message });
      }
      try {
        const retry = await harness.tryPollAx((_text, candidate) => Boolean(harness.findWhyButton(candidate)), 10_000);
        nodes = retry?.nodes ?? null;
        attempts.push({ strategy: "scroll_retry", ok: Boolean(nodes && harness.findWhyButton(nodes)) });
      } catch (error) {
        attempts.push({ strategy: "scroll_retry", ok: false, reason: error.message });
      }
      if (!nodes || !harness.findWhyButton(nodes)) {
        // 不可见元素也可尝试 AXPress：不依赖视口坐标。
        try {
          harness.ensureInput().click(target.path);
          attempts.push({ strategy: "axpress", ok: true, path: target.path });
        } catch (error) {
          attempts.push({ strategy: "axpress", ok: false, path: target.path, reason: error.message });
        }
      }
    }
  }
  let panel = null;
  const waitPanel = async () => {
    try {
      panel = await harness.pollAx(
        (text) => text.includes("参考来源") && text.includes("不会重新调用模型"),
        20_000,
        "b71-confirmation:why_dialog",
      );
      attempts.push({ strategy: "panel_wait", ok: true });
    } catch (error) {
      attempts.push({ strategy: "panel_wait", ok: false, reason: error.message });
    }
  };
  await waitPanel();
  if (!panel) {
    // 面板未出现：可能是按钮 scan/AXPress 时机问题——重新 scan + AXPress 后重试 panel_wait 一次（仍失败则如实记录）。
    const retry = candidatesOf();
    const target = retry.at(-1) ?? null;
    attempts.push({ strategy: "panel_retry_scan", ok: Boolean(target), count: retry.length });
    if (target?.path) {
      try {
        harness.ensureInput().click(target.path);
        attempts.push({ strategy: "panel_retry_axpress", ok: true, path: target.path });
      } catch (error) {
        attempts.push({ strategy: "panel_retry_axpress", ok: false, reason: error.message });
      }
      await waitPanel();
    }
  }
  const after = readDbCounts();
  const llmDelta = Number(after.llm_calls) - Number(before.llm_calls);
  if (!panel) {
    return {
      opened: false,
      reason: attempts.at(-1)?.reason ?? "why_panel_not_visible",
      attempts,
      before,
      after,
      llm_calls_delta: llmDelta,
      provider_delta: Number(after.provider_runs) - Number(before.provider_runs),
    };
  }
  harness.capture("03-why");
  try {
    harness.ensureInput().key("escape", { focusRequired: false });
  } catch {
    // 面板关闭失败不影响已采集的只读证据，由后续步骤继续观测。
  }
  return {
    opened: true,
    attempts,
    before,
    after,
    llm_calls_delta: llmDelta,
    provider_delta: Number(after.provider_runs) - Number(before.provider_runs),
    panel_text_sample: panel.text.slice(0, 300),
  };
}

async function duplicateCheck(mode, cardLines) {
  const before = readDbCounts();
  const spec = CONFIRMATION_MODES[mode];
  const result = { attempted: false, actionable: false, clicked: false, reason: null, before, after: before, duplicate_ack: null, delta: null };
  const finish = () => {
    const after = readDbCounts();
    result.after = after;
    result.delta = {
      provider_runs: Number(after.provider_runs) - Number(before.provider_runs),
      agent_runs: Number(after.agent_runs) - Number(before.agent_runs),
      receipts: Number(after.receipts) - Number(before.receipts),
      llm_calls: Number(after.llm_calls) - Number(before.llm_calls),
    };
    return result;
  };
  const nodes = harness.dumpNodesForInteraction("b71-confirmation:duplicate");
  const located = visibleConfirmationButton(nodes, spec.label, cardLines);
  if (!located.ok) {
    result.reason = `not_actionable:${located.reason}`;
    return finish();
  }
  if (located.button?.enabled === false) {
    result.reason = "not_actionable:action_disabled";
    return finish();
  }
  result.actionable = true;
  result.attempted = true;
  await harness.runStep("input", "duplicate_click", async () => {
    await harness.safeClick(located.button, "confirmation:duplicate");
  });
  result.clicked = true;
  result.duplicate_ack = await harness
    .runStep("ack", "duplicate_ack", () =>
      harness.pollWire(
        (wire) =>
          wire.find((record) => {
            if (record?.direction !== "received" || !Array.isArray(record.frame) || record.frame[3] !== "phx_reply") {
              return false;
            }
            const response = replyBody(record);
            return response?.action_status === "duplicate" || response?.duplicate === true;
          }) ?? null,
        30_000,
        "b71-confirmation:duplicate_ack",
      ),
    )
    .catch(() => null);
  return finish();
}

async function restoreCheck(config) {
  const before = readDbCounts();
  await harness.runStep("restore", "close_app_and_relaunch", () => harness.rawCloseAppAndRelaunch());
  await harness.runStep("maintenance", "workbench_ready_restored", () =>
    harness.rawWaitWorkbenchSettled("b71-confirmation:restored", CONF.restore),
  );
  const selected = await harness.runStep("maintenance", "work_selected_restored", () =>
    harness.rawTrySelectWork(config.target.work_title, "b71-confirmation:restored"),
  );
  const restoredNodes = harness.dumpNodesForInteraction("b71-confirmation:restored");
  const restoredText = harness.axText(restoredNodes);
  const after = readDbCounts();
  const actionableButtons = restoredNodes.filter(
    (node) => node?.role === "AXButton" && (node.title === "确认执行" || node.title === "拒绝") && node.enabled !== false,
  );
  harness.capture("04-restored");
  return {
    resumed: Boolean(selected),
    confirmation_actionable: actionableButtons.length > 0,
    actionable_buttons: actionableButtons.length,
    decision_text_visible:
      /已确认「[^」]{1,24}」|已取消采纳|已取消等待|不会执行|没有写入作品事实|已确认操作|已拒绝/.test(restoredText),
    creative_result_visible: /待确认|正文草稿|保存为章节正文|草稿仍保留|已取消/.test(restoredText),
    source_card_closed: actionableButtons.length === 0,
    before,
    after,
    restart_delta: {
      provider_runs: Number(after.provider_runs) - Number(before.provider_runs),
      agent_runs: Number(after.agent_runs) - Number(before.agent_runs),
      receipts: Number(after.receipts) - Number(before.receipts),
      llm_calls: Number(after.llm_calls) - Number(before.llm_calls),
    },
    visible_text_sample: restoredText.slice(0, 400),
  };
}

function terminationObservation() {
  return {
    at: harness.nowIso(),
    app_processes: countAppProcesses(),
    ports: { backend_4657: portListening(4657), transport_4661: portListening(4661) },
    llm_calls: countLlmCalls(),
    db: readDbCounts(),
  };
}

async function run() {
  runEvidenceMode(evidence, "prepare", dir);
  const config = readJson(path.join(dir, "native-b71-config.json"));
  if (config.journey !== "confirmation") {
    throw new Error(`confirmation driver 只接受 journey=confirmation，实测: ${config.journey}`);
  }
  const mode = String(config.confirmation?.mode ?? "");
  if (!CONFIRMATION_MODES[mode]) throw new Error(`未知 confirmation mode: ${mode}`);
  const spec = CONFIRMATION_MODES[mode];

  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready", () => harness.rawWaitWorkbenchSettled("b71-confirmation", CONF.ready));
  await ensureWorkSelected(harness, config.target.work_title, "b71-confirmation");
  harness.capture("01-source");
  runEvidenceMode(evidence, "capture", dir, ["start"]);

  const batchStart = readDbCounts();
  const request = await sendHighRiskRequest();
  const needsFrame = await waitNeedsConfirmation();
  const needsBody = frameBody(needsFrame) ?? {};
  const sourceTurnId = String(needsBody.turn_id ?? request.turnId);
  const action = selectConfirmationAction(needsBody, spec.action_type);
  const cardProbe = await waitCardVisible();
  const cardLines = confirmationCardLines(cardProbe.text);
  if (!cardLines) throw new Error("b71-confirmation:card_text_lines_missing");
  const cardFacts = {
    card_title: cardLines.title,
    card_body: cardLines.body,
    needs_confirmation: String(needsBody.status ?? "") === "needs_confirmation",
    confirm_action_present: list(needsBody.available_actions).some((entry) => entry?.action_type === "confirm_before_execute"),
    reject_action_present: list(needsBody.available_actions).some((entry) => entry?.action_type === "reject_or_cancel_confirmation"),
    card_visible: true,
    truthfulness: needsBody.truthfulness ?? null,
  };
  harness.capture("02-card");

  // 时间窗与动作采样起点取点击前：确定性 provider 的子执行帧可能在 ACK 返回前到达。
  const clickAt = harness.nowIso();
  const clickBefore = readDbCounts();
  runEvidenceMode(evidence, "capture", dir, ["click-before"]);
  const located = await clickConfirmation(mode, cardLines);
  const sent = await waitActionSent(action);
  const ack = await waitActionAck(sent);
  const decisionAfter = readDbCounts();
  runEvidenceMode(evidence, "capture", dir, ["decision-after"]);
  const decisionTurn = await harness
    .runStep("turn", "confirmation_decision", () =>
      harness.pollWire(
        (wire) =>
          wire.find(
            (record) =>
              record?.direction === "received" &&
              Array.isArray(record.frame) &&
              record.frame[3] === "turn_result" &&
              String(frameBody(record)?.parent_turn_id ?? "") === sourceTurnId,
          ) ?? null,
        60_000,
        "b71-confirmation:decision",
      ),
    )
    .catch(() => null);
  const executedTurn =
    mode === "confirm"
      ? await waitExecutedTurn(clickAt)
      : await waitRejectTurn(clickAt, { sourceTurnId, userTurnId: request.turnId });
  harness.capture("02-after-confirm");
  runEvidenceMode(evidence, "capture", dir, ["after-confirm"]);

  const why = await openWhyAndCount();
  const providerAfter = readDbCounts();

  const duplicate = await duplicateCheck(mode, cardLines);
  harness.capture("03-after-duplicate");
  runEvidenceMode(evidence, "capture", dir, ["after-duplicate"]);

  const restore = await restoreCheck(config);
  const termination = terminationObservation();
  runEvidenceMode(evidence, "capture", dir, ["after-restore", "final"]);

  harness.writeDriverLog("native-b71-driver-log.json", {
    slice_id: config.slice_id,
    provider: config.provider,
    mode,
    request: CONFIRMATION_REQUEST,
    source: {
      turn_id: sourceTurnId,
      user_turn_id: request.turnId,
      ack_run_id: request.runId,
      click_at: clickAt,
      action: {
        action_id: action.action_id,
        action_type: action.action_type,
        idempotency_key: action.idempotency_key,
        target_ref: action.target_ref,
        behavior_ref: action.behavior_ref,
      },
    },
    card: cardFacts,
    locate: {
      label: spec.label,
      ok: located.ok,
      scope_path: located.scope_path ?? null,
      item_path: located.item_path ?? null,
    },
    sampling: {
      batch_start: batchStart,
      click_before: clickBefore,
      decision_after: decisionAfter,
      why_before: why.before,
      why_after: why.after,
      duplicate_before: duplicate.before,
      duplicate_after: duplicate.after,
      restore_before: restore.before,
      restore_after: restore.after,
      termination,
    },
    decision_turn: decisionTurn
      ? { turn_id: frameBody(decisionTurn)?.turn_id ?? null, status: frameBody(decisionTurn)?.status ?? null }
      : null,
    executed_turn: executedTurn
      ? {
          turn_id: frameBody(executedTurn)?.turn_id ?? null,
          tool_name: frameBody(executedTurn)?.tool_result?.tool_name ?? null,
          tool_status: frameBody(executedTurn)?.tool_result?.status ?? null,
          pending: (frameBody(executedTurn)?.adoption_state?.pending ?? []).map((artifact) => artifact?.artifact_type ?? null),
          truthfulness: frameBody(executedTurn)?.truthfulness ?? null,
        }
      : null,
    provider: { before: batchStart.provider_runs, after: providerAfter.provider_runs },
    receipts: { before: batchStart.receipts, after: providerAfter.receipts },
    ack: ack
      ? {
          status: replyBody(ack)?.status ?? null,
          received: replyBody(ack)?.received ?? null,
          action_status: replyBody(ack)?.action_status ?? null,
          trigger: replyBody(ack)?.trigger ?? null,
          receipt_id: replyBody(ack)?.receipt_id ?? null,
          turn_ids: (replyBody(ack)?.turn_results ?? []).map((entry) => entry?.turn_id ?? null),
        }
      : null,
    why,
    duplicate,
    restore,
    termination,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(
    `B71 confirmation 驱动完成: mode=${mode} source_turn=${sourceTurnId} executed_turn=${
      executedTurn ? String(frameBody(executedTurn)?.turn_id ?? "yes") : "none"
    } why_opened=${why.opened} receipts=${providerAfter.receipts}`,
  );
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

await harness.runJourney(run);
