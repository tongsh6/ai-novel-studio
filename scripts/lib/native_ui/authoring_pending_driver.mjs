// B71 CP4b pending 对话候选作者边界的外部原生用户步骤。
//
// 只通过真实 Tauri 窗口的可见语义（作品菜单/AX 文本/按钮/输入框）与真实
// WS/HTTP 传输帧推进；不做 Channel/HTTP 业务写入，不读取产品验收开关。
// 保存/放弃/Why 都先按候选可见标题+正文定位其所属 AX 结构，再在该结构内
// 唯一命中按钮；缺失/多义直接失败，不使用全局 first/last。
import assert from "node:assert/strict";
import { frameBody, frameEvent, frameOf } from "./scenario_driver.mjs";
import { broadcastFrames } from "./scenario_evidence.mjs";
import { wireTerminal } from "./live_run_wait.mjs";
import { authorVisibleScenarioSpec } from "./authoring_capture_evidence.mjs";
import { authorBoundary, countAxAuthorMessages } from "./authoring_g2_evidence.mjs";
import { textOf } from "./driver.mjs";

import { turnIdMatches } from "./scenario_driver.mjs";
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
  PENDING_REVISION_MESSAGE,
  PENDING_FOLLOWUP_MESSAGE,
  selectPendingAction,
} from "./authoring_pending_evidence.mjs";

const list = (value) => (Array.isArray(value) ? value : []);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameMessageScope(body, identity) {
  return body?.work_id === identity.workId && body?.session_id === identity.sessionId;
}

function sameTurnIdentity(body, identity) {
  return (
    sameMessageScope(body, identity) &&
    turnIdMatches(body?.turn_id, identity.turnId) &&
    body?.agent_run?.run_id === identity.runId &&
    body?.agent_run?.parent_turn_ref === identity.turnId
  );
}

// 只保留本候选流程额外的身份/唯一性约束；完成事实由共同 owner 唯一组合。
export function turnOutcome(wire, identity) {
  const results = broadcastFrames(wire, {
    topic: identity.topic, at: identity.since, agentRunId: identity.runId, event: "turn_result",
  });
  const mismatched = results.filter((record) => !sameTurnIdentity(frameBody(record), identity));
  if (mismatched.length > 0)
    return { kind: "conflict", reason: "turn_identity_mismatch", records: mismatched };
  const terminal = wireTerminal(wire, { ...identity, requireWireTerminal: true });
  if (terminal?.kind === "completed" && terminal.results.length > 1)
    return { kind: "conflict", reason: "turn_completed_duplicate", records: terminal.results };
  return terminal;
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
    harness.pollWire((wire) => harness.ackFor(wire, sent), config.budget?.input_timeout_ms ?? 30_000, `b71:${label}:ack`),
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

// 只观察未采纳候选：入口与所属动作分屏采集，不点击保存。
export async function capturePendingItemViews(harness, {
  itemTitle, itemBody, artifact, knownArtifacts, message, baselineAuthorCount, prefix, buttonLabel,
}) {
  if (!nonBlank(message) || !Number.isInteger(baselineAuthorCount) || baselineAuthorCount < 0) {
    throw new Error("pending_view_author_context_missing");
  }
  const optionsFor = (nodes) => ({ itemTitle, itemBody, artifact, knownArtifacts,
    authorBoundary: authorBoundary(nodes, message, baselineAuthorCount) });
  await harness.pollAx((_text, nodes) => {
    const located = locatePendingItem(nodes, optionsFor(nodes));
    if (located.ok) return true;
    if (located.reason !== "item_missing") throw new Error(`pending_view_target:${located.reason}:entry`);
    return false;
  }, 10_000, `${prefix}:item_rendered`);
  await revealItem(harness, itemTitle, itemBody);
  const views = [];
  for (const kind of ["entry", "action"]) {
    const nodes = harness.dumpNodes();
    const located = kind === "entry"
      ? locatePendingItem(nodes, optionsFor(nodes))
      : locateScopedButton(nodes, { ...optionsFor(nodes), label: buttonLabel });
    if (!located.ok) throw new Error(`pending_view_target:${located.reason}:${kind}`);
    const target = kind === "entry"
      ? nodes.find((node) => node.path?.startsWith(located.scope.path + "/") && textOf(node) === itemTitle)
      : located.button;
    if (!target) throw new Error(`pending_view_target_missing:${kind}`);
    try { harness.ensureInput().scrollTo(target.path); }
    catch (error) { if (!isScrollUnsupported(error)) throw error; }
    await sleep(300);
    const capture = `${prefix}-${kind}`;
    views.push({ capture, nodes: harness.capture(capture, { allowFullScreenFallback: false }) });
  }
  return views;
}

async function clickScopedAction(harness, {
  itemTitle, itemBody, artifact, knownArtifacts, message, baselineAuthorCount, label, step,
}) {
  const locate = () => {
    const nodes = harness.dumpNodes();
    return locateScopedButton(nodes, { itemTitle, itemBody, artifact, knownArtifacts, label,
      authorBoundary: authorBoundary(nodes, message, baselineAuthorCount) });
  };
  let located = locate();
  if (!located.ok) {
    await revealItem(harness, itemTitle, itemBody);
    located = locate();
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

async function openRevisionWhy(harness, {
  itemTitle, itemBody, artifact, knownArtifacts, message, baselineAuthorCount,
}) {
  const nodes = harness.dumpNodes();
  const located = locateWhyButton(nodes, { itemTitle, itemBody, artifact, knownArtifacts,
    authorBoundary: authorBoundary(nodes, message, baselineAuthorCount) });
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

function assertResolvedNotActionable(harness, knownArtifacts, resolved) {
  const nodes = harness.dumpNodes();
  for (const item of resolved) {
    for (const label of [item.accept, item.discard]) {
      const located = locateScopedButton(nodes, {
        itemTitle: item.itemTitle,
        itemBody: item.itemBody,
        label,
        artifact: item.artifact,
        knownArtifacts,
        authorBoundary: authorBoundary(nodes, item.message, item.baselineAuthorCount),
      });
      if (located.ok) throw new Error(`pending_restore_actionable:${item.itemTitle}:${label}`);
    }
  }
}

async function restorePhase(harness, config, {
  knownArtifacts, sourceItem, revisionItem, sourceArtifact, revisionArtifact, sourceBody, revisionBody,
  sourceText, sourceBaselineAuthorCount, revisionText, revisionBaselineAuthorCount,
}) {
  await harness.runStep("restore", "close_app_and_relaunch", () => harness.rawCloseAppAndRelaunch());
  await harness.runStep("maintenance", "workbench_ready_restored", () =>
    harness.rawWaitWorkbenchSettled("b71:pending:restored"),
  );
  const selected = await harness.runStep("maintenance", "work_selected_restored", () =>
    harness.rawTrySelectWork(config.target.work_title, "b71:pending:restored"),
  );
  if (!selected) throw new Error(`pending_restore_work_not_selected:${config.target.work_title}`);
  await awaitVisible(harness, [revisionItem.body], "accepted_visible_after_restore");
  assertResolvedNotActionable(harness, knownArtifacts, [
    {
      itemTitle: sourceItem.title,
      itemBody: sourceItem.body,
      artifact: sourceArtifact, message: sourceText, baselineAuthorCount: sourceBaselineAuthorCount,
      accept: actionLabelsFor(sourceArtifact, sourceBody).accept,
      discard: actionLabelsFor(sourceArtifact, sourceBody).discard,
    },
    {
      itemTitle: revisionItem.title,
      itemBody: revisionItem.body,
      artifact: revisionArtifact, message: revisionText, baselineAuthorCount: revisionBaselineAuthorCount,
      accept: actionLabelsFor(revisionArtifact, revisionBody).accept,
      discard: actionLabelsFor(revisionArtifact, revisionBody).discard,
    },
  ]);
  harness.capture("after-restore");
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
  }, "followup", config.budget?.turn_timeout_ms);
  const replyText = String(frameBody(followupResult)?.assistant_message?.text ?? "");
  if (!replyText) throw new Error("followup assistant reply missing");
  await awaitVisible(harness, [replyText], "followup_reply");
  harness.capture("final");
  return { followup, followupResult, replyText };
}

export async function drivePending(harness, config, { capture }) {
  const sourceText = config.message;
  const revisionText = config.revision_message;
  const followupText = config.followup_message;
  assert.equal(sourceText, pendingSourceMessage(config.nonce), "pending 源输入必须携带本批 nonce 原文");
  assert.equal(revisionText, PENDING_REVISION_MESSAGE, "pending 修订输入与冻结原文不符");
  assert.equal(followupText, PENDING_FOLLOWUP_MESSAGE, "pending followup 与冻结原文不符");
  assert(["slice_verify", "streaming_slice_verify", "splash"].includes(harness.provider), "pending provider 未注册");
  if (config.provider !== undefined) assert.equal(config.provider, harness.provider, "pending provider 与配置不符");
  if (harness.provider === "splash") {
    assert.equal(config.provider, "splash", "pending provider 缺冻结来源");
    assert.deepEqual(config.budget, authorVisibleScenarioSpec("b87-r08-pending").budget, "pending 预算与冻结场景不符");
  }

  await harness.runStep("maintenance", "input_ready", () => harness.rawWaitInputReady("b71:pending"));

  const sourceBaselineAuthorCount = countAxAuthorMessages(harness.dumpNodes(), sourceText);
  const source = await sendMessage(harness, sourceText, "source", config);
  const sourceResult = await awaitCompleted(harness, {
    topic: source.topic,
    since: source.sent.at,
    runId: source.runId,
    turnId: source.turnId,
    workId: config.target.work_id,
    sessionId: config.target.session_id,
  }, "source", config.budget?.turn_timeout_ms);
  const sourceBody = frameBody(sourceResult);
  const sourceArtifact = pendingArtifact(sourceBody, "source");
  const sourceItem = itemOf(sourceArtifact, "source");
  await awaitVisible(harness, [sourceItem.title, sourceItem.body], "source_candidate");
  harness.capture("after-source");
  capture("after-source");

  const revisionBaselineAuthorCount = countAxAuthorMessages(harness.dumpNodes(), revisionText);
  const revision = await sendMessage(harness, revisionText, "revision", config);
  const revisionResult = await awaitCompleted(harness, {
    topic: revision.topic,
    since: revision.sent.at,
    runId: revision.runId,
    turnId: revision.turnId,
    workId: config.target.work_id,
    sessionId: config.target.session_id,
  }, "revision", config.budget?.turn_timeout_ms);
  const revisionBody = frameBody(revisionResult);
  const revisionArtifact = pendingArtifact(revisionBody, "revision");
  const revisionItem = itemOf(revisionArtifact, "revision");
  const knownArtifacts = [
    ...list(sourceBody.adoption_state?.pending),
    ...list(revisionBody.adoption_state?.pending),
  ];
  await awaitVisible(
    harness,
    [sourceItem.title, sourceItem.body, revisionItem.title, revisionItem.body],
    "both_candidates",
  );
  harness.capture("after-revision");
  capture("after-revision");
  capture("before-why");
  const why = await openRevisionWhy(harness, {
    itemTitle: revisionItem.title, itemBody: revisionItem.body, artifact: revisionArtifact, knownArtifacts,
    message: revisionText, baselineAuthorCount: revisionBaselineAuthorCount,
  });
  harness.capture("why");
  capture("after-why");
  await closeWhy(harness);

  const acceptAction = selectPendingAction(revisionBody, {
    artifactId: revisionArtifact.artifact_id,
    actionType: "accept",
  });
  const acceptLabels = actionLabelsFor(revisionArtifact, revisionBody);
  await clickScopedAction(harness, {
    itemTitle: revisionItem.title,
    itemBody: revisionItem.body,
    label: acceptLabels.accept,
    step: "accept_revision",
    artifact: revisionArtifact, knownArtifacts,
    message: revisionText, baselineAuthorCount: revisionBaselineAuthorCount,
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
    [sourceItem.title, sourceItem.body, revisionItem.body, actionLabelsFor(sourceArtifact, sourceBody).discard],
    "original_still_pending",
  );
  harness.capture("after-accept");
  capture("after-accept");

  const discardAction = selectPendingAction(sourceBody, {
    artifactId: sourceArtifact.artifact_id,
    actionType: "discard",
  });
  const discardLabels = actionLabelsFor(sourceArtifact, sourceBody);
  await clickScopedAction(harness, {
    itemTitle: sourceItem.title,
    itemBody: sourceItem.body,
    label: discardLabels.discard,
    step: "discard_original",
    artifact: sourceArtifact, knownArtifacts,
    message: sourceText, baselineAuthorCount: sourceBaselineAuthorCount,
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
  harness.capture("after-discard");
  capture("after-discard");

  const restoreFacts = await restorePhase(harness, config, {
    knownArtifacts,
    sourceText, sourceBaselineAuthorCount, revisionText, revisionBaselineAuthorCount,
    sourceItem,
    revisionItem,
    sourceArtifact,
    revisionArtifact,
    sourceBody,
    revisionBody,
  });
  capture("after-restore");

  const { followup, followupResult, replyText } = await followupPhase(harness, config, followupText);
  capture("final");

  harness.writeDriverLog("native-b71-driver-log.json", {
    slice_id: config.slice_id,
    provider: harness.provider,
    ...(harness.provider === "splash" ? { model: config.preregistration?.model,
      budget: config.budget, runtime_profile: config.runtime?.profile } : {}),
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
