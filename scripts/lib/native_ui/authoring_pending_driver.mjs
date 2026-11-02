// B71 CP4b pending 对话候选作者边界的外部原生用户步骤。
//
// 只通过真实 Tauri 窗口的可见语义（作品菜单/AX 文本/按钮/输入框）与真实
// WS/HTTP 传输帧推进；不做 Channel/HTTP 业务写入，不读取产品验收开关。
// 保存/放弃/Why 都先按候选可见标题+正文定位其所属 AX 结构，再在该结构内
// 唯一命中按钮；缺失/多义直接失败，不使用全局 first/last。
import assert from "node:assert/strict";
import { frameBody, frameEvent, frameOf } from "./scenario_driver.mjs";
import { broadcastFrames } from "./scenario_evidence.mjs";
import {
  actionAck,
  actionFrame,
  actionLabelsFor,
  actionResult,
  actionTurnResult,
  isPendingWaitMiss,
  locatePendingItem,
  locateScopedButton,
  locateWhyButton,
  pendingSourceMessage,
  selectPendingAction,
} from "./authoring_pending_evidence.mjs";

const list = (value) => (Array.isArray(value) ? value : []);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isCompletedTurn(record, runId) {
  if (record?.direction !== "received") return false;
  if (frameEvent(record) !== "turn_result") return false;
  const run = frameBody(record)?.agent_run;
  return run?.run_id === runId && run?.status === "completed";
}

const TERMINAL_FAILURES = new Set(["failed", "cancelled", "run_failed", "run_cancelled"]);

function eventStatus(body) {
  return body?.event_type ?? body?.payload?.event_type;
}

function terminalStatus(body) {
  const status = body?.status ?? body?.agent_run?.status ?? eventStatus(body);
  return TERMINAL_FAILURES.has(status) ? status : null;
}

function sameMessageScope(body, identity) {
  return body?.work_id === identity.workId && body?.session_id === identity.sessionId;
}

function sameTurnIdentity(body, identity) {
  return (
    sameMessageScope(body, identity) &&
    body?.turn_id === identity.turnId &&
    body?.agent_run?.run_id === identity.runId &&
    body?.agent_run?.parent_turn_ref === identity.turnId
  );
}

function runScoped(record, identity) {
  return (
    record?.direction === "received" &&
    frameOf(record)?.[2] === identity.topic &&
    record?.at >= identity.since &&
    ["agent_run_state", "agent_event", "turn_result"].includes(frameEvent(record))
  );
}

function bodyRunId(body) {
  return body?.run_id ?? body?.run_ref ?? body?.agent_run?.run_id ?? null;
}

// 完成检测复用 broadcastFrames 的 owning topic/after-sent 语义，并额外绑定
// 作者消息的 work/session/turn 与 agent_run.parent_turn_ref。失败/取消和错身份
// 立即返回明确结果，等待缺失只返回 null，不用错误文案当状态协议。
export function turnOutcome(wire, identity) {
  const scoped = list(wire).filter((record) => runScoped(record, identity));
  const runRecords = scoped.filter((record) => bodyRunId(frameBody(record)) === identity.runId);
  const failed = runRecords.find((record) => terminalStatus(frameBody(record)) !== null);
  if (failed) {
    return { kind: "failed", status: terminalStatus(frameBody(failed)), record: failed };
  }
  const results = broadcastFrames(wire, {
    topic: identity.topic,
    at: identity.since,
    agentRunId: identity.runId,
    event: "turn_result",
  });
  const mismatched = results.filter((record) => !sameTurnIdentity(frameBody(record), identity));
  if (mismatched.length > 0) {
    return { kind: "conflict", reason: "turn_identity_mismatch", records: mismatched };
  }
  const completed = results.filter((record) => frameBody(record)?.agent_run?.status === "completed");
  if (completed.length > 1) {
    return { kind: "conflict", reason: "turn_completed_duplicate", records: completed };
  }
  if (completed.length === 1) return { kind: "completed", record: completed[0] };
  return null;
}

function assertSentIdentity(sent, config, label) {
  assert.equal(frameEvent(sent), "user_message", `${label}: 发送帧不是 user_message`);
  const body = frameBody(sent);
  assert.equal(body?.work_id, config.target?.work_id, `${label}: user_message 错 work`);
  assert.equal(body?.session_id, config.target?.session_id, `${label}: user_message 错 session`);
  assert(nonBlank(body?.turn_id), `${label}: user_message 缺 turn_id`);
  assert(nonBlank(frameOf(sent)?.[2]), `${label}: user_message 缺 owning topic`);
}

async function sendMessage(harness, text, label, config) {
  const sent = await harness.runStep("input", label, () => harness.rawTypeAndSend(text, "b71"));
  assertSentIdentity(sent, config, label);
  const turnId = String(frameBody(sent).turn_id);
  const ack = await harness.runStep("ack", `${label}_ack`, () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 30_000, `b71:${label}:ack`),
  );
  const runId = String(frameBody(ack)?.response?.run_id ?? "");
  if (!runId) throw new Error(`${label}: ACK 缺 run_id`);
  return { sent, topic: frameOf(sent)[2], turnId, ack, runId };
}

async function awaitCompleted(harness, identity, label, timeoutMs = 240_000) {
  return harness.runStep("turn", `${label}_completed`, () =>
    harness.pollWire(
      (wire) => {
        const outcome = turnOutcome(wire, identity);
        if (!outcome) return null;
        if (outcome.kind === "completed") return outcome.record;
        throw new Error(`pending_turn_${outcome.kind}:${outcome.status ?? outcome.reason}:${label}`);
      },
      timeoutMs,
      `b71:${label}:completed`,
    ),
  );
}

async function awaitVisible(harness, values, label, timeoutMs = 45_000) {
  return harness.runStep("maintenance", `${label}_visible`, () =>
    harness.pollAx(
      (text) => values.filter(nonBlank).every((value) => text.includes(value)),
      timeoutMs,
      `b71:${label}`,
    ),
  );
}

function itemOf(artifact, label) {
  const items = list(artifact?.payload?.items);
  assert.equal(items.length, 1, `${label}: item 必须恰好一条，实测 ${items.length}`);
  return items[0];
}

function pendingArtifact(turnResult, label) {
  const pending = list(turnResult?.adoption_state?.pending);
  assert.equal(pending.length, 1, `${label}: 待采纳候选必须恰好一条，实测 ${pending.length}`);
  return pending[0];
}

function labelsFor(artifact) {
  const revision = nonBlank(artifact?.payload?.revision_of);
  return actionLabelsFor(artifact?.artifact_type, { revision });
}

const SCROLL_UNSUPPORTED = new Set(["axscrolltovisible_failed", "ax_action_unsupported"]);

export function isScrollUnsupported(error) {
  return SCROLL_UNSUPPORTED.has(error?.reason);
}

export async function revealItem(harness, itemTitle, itemBody) {
  const nodes = harness.dumpNodes();
  const item = locatePendingItem(nodes, { itemTitle, itemBody });
  if (item.ok) {
    try {
      harness.ensureInput().scrollTo(item.scope.path);
      await sleep(300);
    } catch (error) {
      // 只容忍产品明确返回的“不支持滚动”；目标缺失/权限/归属错误必须上抛。
      if (!isScrollUnsupported(error)) throw error;
    }
  }
}

async function clickScopedAction(harness, { itemTitle, itemBody, label, step, knownItems }) {
  let located = locateScopedButton(harness.dumpNodes(), { itemTitle, itemBody, label, knownItems });
  if (!located.ok) {
    await revealItem(harness, itemTitle, itemBody);
    located = locateScopedButton(harness.dumpNodes(), { itemTitle, itemBody, label, knownItems });
  }
  if (!located.ok) {
    throw new Error(`pending_action_target:${located.reason}:${step}:${label}`);
  }
  harness.log.push({
    op: "pending_action_target",
    at: harness.nowIso(),
    step,
    item_title: itemTitle,
    item_body_length: itemBody.length,
    label,
    button: { path: located.button.path, title: located.button.title, frame: located.button.frame ?? null },
    scope_path: located.scope_path,
  });
  return harness.runStep("input", step, () => harness.safeClick(located.button, step));
}

async function awaitActionFrame(harness, identity) {
  return harness.runStep("ack", `${identity.step}_frame`, () =>
    harness.pollWire(
      (wire) => {
        try {
          return actionFrame(wire, identity);
        } catch (error) {
          if (isPendingWaitMiss(error)) return null;
          throw error;
        }
      },
      20_000,
      `b71:${identity.step}:frame`,
    ),
  );
}

async function awaitActionAck(harness, frame, actionStatus, label) {
  return harness.runStep("ack", label, () =>
    harness.pollWire((wire) => {
      try {
        actionAck(wire, frame, { actionStatus });
        return true;
      } catch (error) {
        if (isPendingWaitMiss(error)) return null;
        throw error;
      }
    }, 20_000, `b71:${label}`),
  );
}

async function awaitActionResult(harness, identity, label) {
  return harness.runStep("ack", label, () =>
    harness.pollWire((wire) => {
      try {
        actionResult(wire, identity);
        return true;
      } catch (error) {
        if (isPendingWaitMiss(error)) return null;
        throw error;
      }
    }, 20_000, `b71:${label}`),
  );
}

async function awaitActionTurn(harness, identity, label) {
  return harness.runStep("turn", label, () =>
    harness.pollWire((wire) => {
      try {
        return actionTurnResult(wire, identity);
      } catch (error) {
        if (isPendingWaitMiss(error)) return null;
        throw error;
      }
    }, 30_000, `b71:${label}`),
  );
}

async function openRevisionWhy(harness, itemTitle, itemBody, knownItems) {
  const located = locateWhyButton(harness.dumpNodes(), { itemTitle, itemBody, knownItems });
  if (!located.ok) throw new Error(`pending_why_target:${located.reason}`);
  await harness.runStep("maintenance", "open_why", () => harness.safeClick(located.button, "b71:why"));
  return harness.runStep("maintenance", "why_visible", () =>
    harness.pollAx(
      (text) => text.includes("参考来源") && text.includes("不会重新调用模型"),
      30_000,
      "b71:why",
    ),
  );
}

async function closeWhy(harness) {
  await harness.runStep("maintenance", "close_why", async () => {
    harness.ensureInput().key("escape", { focusRequired: false });
    return harness.pollAx((text) => !text.includes("不会重新调用模型"), 15_000, "b71:why-closed");
  });
}

function assertResolvedNotActionable(harness, knownItems, resolved) {
  const nodes = harness.dumpNodes();
  for (const item of resolved) {
    for (const label of [item.accept, item.discard]) {
      const located = locateScopedButton(nodes, {
        itemTitle: item.itemTitle,
        itemBody: item.itemBody,
        label,
        knownItems,
      });
      if (located.ok) throw new Error(`pending_restore_actionable:${item.itemTitle}:${label}`);
    }
  }
}

async function restorePhase(harness, config, { knownItems, sourceItem, revisionItem, sourceArtifact, revisionArtifact }) {
  await harness.runStep("restore", "close_app_and_relaunch", () => harness.rawCloseAppAndRelaunch());
  await harness.runStep("maintenance", "workbench_ready_restored", () =>
    harness.rawWaitWorkbenchSettled("b71:pending:restored"),
  );
  const selected = await harness.runStep("maintenance", "work_selected_restored", () =>
    harness.rawTrySelectWork(config.target.work_title, "b71:pending:restored"),
  );
  if (!selected) throw new Error(`pending_restore_work_not_selected:${config.target.work_title}`);
  await awaitVisible(harness, [revisionItem.body], "accepted_visible_after_restore");
  assertResolvedNotActionable(harness, knownItems, [
    {
      itemTitle: sourceItem.title,
      itemBody: sourceItem.body,
      accept: labelsFor(sourceArtifact).accept,
      discard: labelsFor(sourceArtifact).discard,
    },
    {
      itemTitle: revisionItem.title,
      itemBody: revisionItem.body,
      accept: labelsFor(revisionArtifact).accept,
      discard: labelsFor(revisionArtifact).discard,
    },
  ]);
  harness.capture("07-restored");
  return { resolved_non_actionable: true, revision_body_visible: true };
}

async function followupPhase(harness, config, followupText) {
  await harness.runStep("maintenance", "input_ready_restored", () =>
    harness.rawWaitInputReady("b71:pending:restored"),
  );
  const followup = await sendMessage(harness, followupText, "followup", config);
  const followupResult = await awaitCompleted(harness, {
    topic: followup.topic,
    since: followup.sent.at,
    runId: followup.runId,
    turnId: followup.turnId,
    workId: config.target.work_id,
    sessionId: config.target.session_id,
  }, "followup");
  const replyText = String(frameBody(followupResult)?.assistant_message?.text ?? "");
  if (!replyText) throw new Error("followup assistant reply missing");
  await awaitVisible(harness, [replyText], "followup_reply");
  harness.capture("08-final");
  return { followup, followupResult, replyText };
}

export async function drivePending(harness, config, { capture }) {
  const sourceText = config.message;
  const revisionText = config.revision_message;
  const followupText = config.followup_message;
  assert.equal(sourceText, pendingSourceMessage(config.nonce), "pending 源输入必须携带本批 nonce 原文");

  await harness.runStep("maintenance", "input_ready", () => harness.rawWaitInputReady("b71:pending"));

  const source = await sendMessage(harness, sourceText, "source", config);
  const sourceResult = await awaitCompleted(harness, {
    topic: source.topic,
    since: source.sent.at,
    runId: source.runId,
    turnId: source.turnId,
    workId: config.target.work_id,
    sessionId: config.target.session_id,
  }, "source");
  const sourceBody = frameBody(sourceResult);
  const sourceArtifact = pendingArtifact(sourceBody, "source");
  const sourceItem = itemOf(sourceArtifact, "source");
  const sourceKnown = [{ itemTitle: sourceItem.title, itemBody: sourceItem.body }];
  await awaitVisible(harness, [sourceItem.title, sourceItem.body], "source_candidate");
  harness.capture("02-source");
  capture("after-source");

  const revision = await sendMessage(harness, revisionText, "revision", config);
  const revisionResult = await awaitCompleted(harness, {
    topic: revision.topic,
    since: revision.sent.at,
    runId: revision.runId,
    turnId: revision.turnId,
    workId: config.target.work_id,
    sessionId: config.target.session_id,
  }, "revision");
  const revisionBody = frameBody(revisionResult);
  const revisionArtifact = pendingArtifact(revisionBody, "revision");
  const revisionItem = itemOf(revisionArtifact, "revision");
  const knownItems = [
    ...sourceKnown,
    { itemTitle: revisionItem.title, itemBody: revisionItem.body },
  ];
  await awaitVisible(
    harness,
    [sourceItem.title, sourceItem.body, revisionItem.title, revisionItem.body],
    "both_candidates",
  );
  harness.capture("03-revision");
  capture("after-revision");
  capture("before-why");
  const why = await openRevisionWhy(harness, revisionItem.title, revisionItem.body, knownItems);
  harness.capture("04-why");
  capture("after-why");
  await closeWhy(harness);

  const acceptAction = selectPendingAction(revisionBody, {
    artifactId: revisionArtifact.artifact_id,
    actionType: "accept",
  });
  const acceptLabels = labelsFor(revisionArtifact);
  await clickScopedAction(harness, {
    itemTitle: revisionItem.title,
    itemBody: revisionItem.body,
    label: acceptLabels.accept,
    step: "accept_revision",
    knownItems,
  });
  const acceptIdentity = {
    topic: source.topic,
    since: revisionResult.at,
    action: acceptAction,
    step: "accept",
  };
  const acceptFrame = await awaitActionFrame(harness, acceptIdentity);
  await awaitActionAck(harness, acceptFrame, "accepted", "accept_ack");
  await awaitActionResult(harness, { ...acceptIdentity, actionStatus: "accepted" }, "accept_action_result");
  await awaitActionTurn(
    harness,
    { topic: source.topic, since: acceptFrame.at, parentTurnRef: revisionBody.turn_id },
    "accept_turn_result",
  );
  await awaitVisible(
    harness,
    [sourceItem.title, sourceItem.body, revisionItem.body, labelsFor(sourceArtifact).discard],
    "original_still_pending",
  );
  harness.capture("05-accept");
  capture("after-accept");

  const discardAction = selectPendingAction(sourceBody, {
    artifactId: sourceArtifact.artifact_id,
    actionType: "discard",
  });
  const discardLabels = labelsFor(sourceArtifact);
  await clickScopedAction(harness, {
    itemTitle: sourceItem.title,
    itemBody: sourceItem.body,
    label: discardLabels.discard,
    step: "discard_original",
    knownItems,
  });
  const confirmation = await harness.tryPollAx(
    (text) => text.includes("放弃这份候选？") && text.includes("确认放弃"),
    4_000,
  );
  if (confirmation) {
    const confirm = harness.findButton(confirmation.nodes, "确认放弃");
    if (!confirm) throw new Error("discard_confirmation_button_missing");
    await harness.runStep("input", "discard_confirm", () => harness.safeClick(confirm, "discard-confirm"));
  }
  const discardIdentity = {
    topic: source.topic,
    since: acceptFrame.at,
    action: discardAction,
    step: "discard",
  };
  const discardFrame = await awaitActionFrame(harness, discardIdentity);
  await awaitActionAck(harness, discardFrame, "discarded", "discard_ack");
  await awaitActionResult(harness, { ...discardIdentity, actionStatus: "discarded" }, "discard_action_result");
  await awaitActionTurn(
    harness,
    { topic: source.topic, since: discardFrame.at, parentTurnRef: sourceBody.turn_id },
    "discard_turn_result",
  );
  await awaitVisible(harness, [revisionItem.body], "accepted_content_after_discard");
  harness.capture("06-discard");
  capture("after-discard");

  const restoreFacts = await restorePhase(harness, config, {
    knownItems,
    sourceItem,
    revisionItem,
    sourceArtifact,
    revisionArtifact,
  });
  capture("after-restore");

  const { followup, followupResult, replyText } = await followupPhase(harness, config, followupText);
  capture("final");

  harness.writeDriverLog("native-b71-driver-log.json", {
    slice_id: config.slice_id,
    provider: harness.provider,
    source_turn_id: source.turnId,
    source_run_id: source.runId,
    source_artifact_id: sourceArtifact.artifact_id,
    revision_turn_id: revisionBody.turn_id,
    revision_run_id: revision.runId,
    revision_artifact_id: revisionArtifact.artifact_id,
    accept_action_id: acceptAction.action_id,
    discard_action_id: discardAction.action_id,
    followup_turn_id: followup.turnId,
    followup_run_id: followup.runId,
    why_text: why.text,
    assistant_text: replyText,
    restore: restoreFacts,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(
    `B71 pending 原生驱动完成: source=${source.runId} revision=${revision.runId} followup=${followup.runId}`,
  );
}
