// B71 §16.14 工具确认/拒绝原生外部驱动（journey=confirmation）。
//
// 真实页面流程：作者高风险请求 → needs_confirmation（awaiting_author behavior +
// confirm_before_execute/reject_or_cancel_confirmation）→ 按用户可见语义与所属消息块
// 定位「确认执行」/「拒绝」→ 点击 → 采集 ACK/action_result/决定 TurnResult/子执行 →
// Why（只读）前后 Provider 计数 → 重复点击幂等 → 重启恢复不可再触发。
//
// 不手造 needs_confirmation 帧、不改产品代码；按钮定位复用 pending 的消息块模型
// （locateConfirmationButton），不借用兄弟候选按钮。
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
import { all, withDb, write } from "./lib/native_ui/scenario_evidence.mjs";
import {
  CONFIRMATION_MODES,
  CONFIRMATION_REQUEST,
  confirmationCardLines,
  locateConfirmationButton,
  needsConfirmationTurnResult,
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

function readDbCounts() {
  return withDb(dir, (db) => {
    const count = (table) => {
      try {
        return Number(all(db, `SELECT COUNT(*) AS c FROM ${table}`)[0]?.c ?? 0);
      } catch {
        return 0;
      }
    };
    return {
      provider_runs: count("provider_runs"),
      receipts: count("author_action_receipts"),
      agent_runs: count("agent_runs"),
      mutations: count("mutations"),
    };
  });
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

async function waitCardVisible(action) {
  const spec = CONFIRMATION_MODES[action];
  return harness.runStep("maintenance", "confirmation_card_visible", () =>
    harness.pollAx((text) => text.includes("确认执行") && text.includes("拒绝") && text.includes("需要确认"), 60_000, "b71-confirmation:card"),
  );
}

async function sendHighRiskRequest() {
  await harness.runStep("maintenance", "input_ready", () => harness.rawWaitInputReady("b71-confirmation", CONF.ready));
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
            frameEventFailed(record) === "run_failed",
        );
        if (failed) throw new Error(`b71-confirmation:run_failed:${frameBody(failed)?.reason_codes?.join(",") ?? "unknown"}`);
        return null;
      },
      CONF.card,
      "b71-confirmation:needs_confirmation",
    ),
  );
}

function frameEventFailed(record) {
  if (!Array.isArray(record?.frame)) return null;
  return record.frame[3];
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

async function waitActionAck(sent, action) {
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

async function waitExecutedTurn(sourceTurnId) {
  return harness.runStep("turn", "confirmed_child_turn", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (record) =>
            record?.direction === "received" &&
            Array.isArray(record.frame) &&
            record.frame[3] === "turn_result" &&
            (frameBody(record)?.tool_result !== null && frameBody(record)?.tool_result !== undefined
              ? true
              : String(frameBody(record)?.parent_turn_id ?? "") === sourceTurnId),
        ) ?? null,
      CONF.executed,
      "b71-confirmation:executed",
    ),
  );
}

async function openWhyAndCount() {
  const before = readDbCounts();
  let why = { opened: false, reason: "why_button_not_observed", before, after: before };
  try {
    await harness.runStep("maintenance", "why_open", () => harness.rawOpenWhy("b71-confirmation"));
    const after = readDbCounts();
    why = { opened: true, before, after, provider_delta: after.provider_runs - before.provider_runs };
    harness.capture("03-why");
    harness.ensureInput().key("escape", { focusRequired: false });
    await harness.runStep("maintenance", "why_close", () =>
      harness.pollAx((text) => !text.includes("不会重新调用模型"), 20_000, "b71-confirmation:why_closed"),
    );
  } catch (error) {
    why = { ...why, reason: `why_open_failed:${error.message}` };
  }
  return why;
}

async function duplicateCheck(mode, cardLines) {
  const before = readDbCounts();
  const nodes = harness.dumpNodesForInteraction("b71-confirmation:duplicate");
  const spec = CONFIRMATION_MODES[mode];
  const located = visibleConfirmationButton(nodes, spec.label, cardLines);
  const result = { attempted: false, actionable: false, clicked: false, reason: null, before };
  if (!located.ok) {
    result.reason = `not_actionable:${located.reason}`;
    return result;
  }
  if (located.button?.enabled === false) {
    result.reason = "not_actionable:action_disabled";
    return result;
  }
  result.actionable = true;
  result.attempted = true;
  await harness.runStep("input", "duplicate_click", async () => {
    await harness.safeClick(located.button, "confirmation:duplicate");
  });
  result.clicked = true;
  await harness.runStep("ack", "duplicate_ack", () =>
    harness.pollWire(
      (wire) => wire.find((record) => Array.isArray(record.frame) && record.frame[3] === "phx_reply" && frameBody(record)?.duplicate === true) ?? null,
      20_000,
      "b71-confirmation:duplicate_ack",
    ),
  ).catch(() => null);
  result.after = readDbCounts();
  return result;
}

async function restoreCheck(config) {
  await harness.runStep("restore", "close_app_and_relaunch", () => harness.rawCloseAppAndRelaunch());
  await harness.runStep("maintenance", "workbench_ready_restored", () =>
    harness.rawWaitWorkbenchSettled("b71-confirmation:restored", CONF.restore),
  );
  const selected = await harness.runStep("maintenance", "work_selected_restored", () =>
    harness.rawTrySelectWork(config.target.work_title, "b71-confirmation:restored"),
  );
  const nodes = harness.dumpNodesForInteraction("b71-confirmation:restored");
  const actionableButtons = nodes.filter(
    (node) => node?.role === "AXButton" && (node.title === "确认执行" || node.title === "拒绝") && node.enabled !== false,
  );
  harness.capture("04-restored");
  return { resumed: Boolean(selected), confirmation_actionable: actionableButtons.length > 0, actionable_buttons: actionableButtons.length };
}

async function run() {
  runEvidenceMode(evidence, "prepare", dir);
  const config = readJson(path.join(dir, "native-b71-config.json"));
  if (config.journey !== "confirmation") throw new Error(`confirmation driver 只接受 journey=confirmation，实测: ${config.journey}`);
  const mode = String(config.confirmation?.mode ?? "");
  if (!CONFIRMATION_MODES[mode]) throw new Error(`未知 confirmation mode: ${mode}`);
  const spec = CONFIRMATION_MODES[mode];

  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready", () => harness.rawWaitWorkbenchSettled("b71-confirmation", CONF.ready));
  await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, "b71-confirmation");
  harness.capture("01-source");
  runEvidenceMode(evidence, "capture", dir, ["start"]);

  const providerBefore = readDbCounts();
  const request = await sendHighRiskRequest();
  const needsFrame = await waitNeedsConfirmation();
  const needsBody = frameBody(needsFrame) ?? {};
  const sourceTurnId = String(needsBody.turn_id ?? request.turnId);
  const action = selectConfirmationAction(needsBody, spec.action_type);
  const cardProbe = await waitCardVisible(mode);
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

  const located = await clickConfirmation(mode, cardLines);
  const sent = await waitActionSent(action);
  const ack = await waitActionAck(sent, action);
  const decisionTurn = await harness.runStep("turn", "confirmation_decision", () =>
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
  ).catch(() => null);
  const executedTurn = mode === "confirm" ? await waitExecutedTurn(sourceTurnId).catch(() => null) : null;
  harness.capture("02-after-confirm");
  runEvidenceMode(evidence, "capture", dir, ["after-confirm"]);

  const why = await openWhyAndCount();
  const providerAfter = readDbCounts();

  const duplicate = await duplicateCheck(mode, cardLines);
  harness.capture("03-after-duplicate");
  runEvidenceMode(evidence, "capture", dir, ["after-duplicate"]);

  const restore = await restoreCheck(config);
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
      action: {
        action_id: action.action_id,
        action_type: action.action_type,
        idempotency_key: action.idempotency_key,
        target_ref: action.target_ref,
        behavior_ref: action.behavior_ref,
      },
    },
    card: cardFacts,
    locate: { label: spec.label, ok: located.ok, scope_path: located.scope_path ?? null, item_path: located.item_path ?? null },
    decision_turn: decisionTurn ? { turn_id: frameBody(decisionTurn)?.turn_id ?? null, status: frameBody(decisionTurn)?.status ?? null } : null,
    executed_turn: executedTurn
      ? {
          turn_id: frameBody(executedTurn)?.turn_id ?? null,
          tool_name: frameBody(executedTurn)?.tool_result?.tool_name ?? null,
          pending: (frameBody(executedTurn)?.adoption_state?.pending ?? []).map((artifact) => artifact?.artifact_type ?? null),
        }
      : null,
    provider: { before: providerBefore.provider_runs, after: providerAfter.provider_runs },
    receipts: { before: providerBefore.receipts, after: providerAfter.receipts },
    why,
    duplicate,
    restore,
    ack: ack ? { action_id: frameBody(ack)?.action_id ?? null, action_status: frameBody(ack)?.action_status ?? null } : null,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(
    `B71 confirmation 驱动完成: mode=${mode} source_turn=${sourceTurnId} executed_turn=${executedTurn ? String(frameBody(executedTurn)?.turn_id ?? "yes") : "none"} receipts=${providerAfter.receipts}`,
  );
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

run().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
