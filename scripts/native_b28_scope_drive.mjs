// B28-SCOPE：冻结作者原话，经真实 Tauri / AX / CGEvent 执行既有章范围验收。
// 等待、失败与澄清原样留证；不补话、不重发、不代选作者答案，不操作外部模型生命周期。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readJson } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness, ROOT, ensureWorkSelected, runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import {
  broadcastFrames, frameBody, logs, requestIdentity, requestReplies,
} from "./lib/native_ui/scenario_evidence.mjs";
import { wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import { authorBoundary, countAxAuthorMessages } from "./lib/native_ui/authoring_g2_evidence.mjs";
import {
  actionAck, actionFrame, actionLabelsFor, actionResult, isPendingWaitMiss,
  locateScopedButton, selectPendingAction,
} from "./lib/native_ui/authoring_pending_evidence.mjs";
import { capturePendingItemViews, waitAdoptionMaintenance } from "./lib/native_ui/authoring_pending_driver.mjs";
import { scopePendingArtifacts } from "./native_b28_scope_evidence.mjs";

const EVIDENCE = path.join(ROOT, "scripts/native_b28_scope_evidence.mjs");
const CONFIG = "native-b28-scope-config.json";
const nowIso = () => new Date().toISOString();
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";

// 声明边界，不以空 loaded/不可用服务伪造卸载成功。
export function observeExternalModelService(config) {
  return {
    at: nowIso(), provider: config.provider, model: config.model, endpoint: config.endpoint,
    ownership: "external", read_only: true, lifecycle_action: "none",
    status: "not_observed", reason: "external_service_lifecycle_not_queried",
  };
}

async function sendAuthorInput(harness, config, scenario) {
  const label = scenario.id;
  await harness.runStep("maintenance", `input_ready:${label}`, () => harness.rawWaitInputReady(label));
  const baselineAuthorCount = countAxAuthorMessages(harness.dumpNodes(), scenario.input);
  const message = await harness.runStep("input", `type_send:${label}`, () =>
    harness.rawTypeAndSend(scenario.input, label));
  const body = frameBody(message);
  assert(nonBlank(body?.turn_id) && body.text === scenario.input, `author_input_mismatch:${label}`);
  assert(body.work_id === config.target.work_id && nonBlank(body.session_id) &&
    (!config.target.session_id || body.session_id === config.target.session_id), `author_scope_mismatch:${label}`);
  const request = requestIdentity(message);
  const ack = await harness.runStep("ack", `ack:${label}`, () => harness.pollWire((wire) => {
    const replies = requestReplies(wire, request, message.at);
    assert(replies.length <= 1, `author_ack_ambiguous:${label}`);
    return replies[0] ?? null;
  }, config.budget.ack_timeout_ms, `ack:${label}`));
  const response = frameBody(ack);
  assert(response?.status === "ok" && response.response?.turn_id === body.turn_id &&
    nonBlank(response.response.run_id), `author_ack_invalid:${label}`);
  return {
    message, baselineAuthorCount,
    identity: { topic: request.topic, turnId: body.turn_id, runId: response.response.run_id,
      workId: body.work_id, sessionId: body.session_id, since: message.at },
  };
}

function judgments(wire, identity) {
  return broadcastFrames(wire, {
    topic: identity.topic, at: identity.since, runRef: identity.runId, event: "agent_event",
  }).filter((record) => frameBody(record)?.event_type === "judgment_decided")
    .map((record) => frameBody(record).payload);
}

async function waitScopeTurn(harness, identity, scenario, budget) {
  const terminal = await harness.runStep("turn", `turn_result:${scenario.id}`, () =>
    harness.pollWire((wire) => wireTerminal(wire, {
      ...identity, resultPosition: "last", requireWireTerminal: true,
    }), budget.turn_timeout_ms, `${scenario.id}:turn_outcome`));
  const result = terminal.kind === "completed" ? terminal.body : null;
  const question = result?.author_question;
  const openQuestion = Boolean(question && !["answered", "closed"].includes(question.status));
  const kind = terminal.kind !== "completed" ? terminal.kind
    : openQuestion ? "author_question"
    : result?.status === "failed" ? "failed" : "turn_result";
  return { terminal, result, kind, openQuestion };
}

async function adoptPending(harness, config, scenario, turnResult, identity, baselineAuthorCount, captureEvidence) {
  const pending = scopePendingArtifacts(harness.transport(), identity, turnResult);
  assert(Array.isArray(pending) && pending.length === 1, `pending_target_not_unique:${scenario.id}`);
  const artifact = pending[0];
  const action = selectPendingAction(turnResult, { artifactId: artifact.artifact_id, actionType: "accept" });
  const item = artifact.payload?.items?.[0];
  assert(item && nonBlank(item.title) && nonBlank(item.body), `pending_item_missing:${scenario.id}`);
  const label = actionLabelsFor(artifact, turnResult).accept;
  const views = await capturePendingItemViews(harness, {
    itemTitle: item.title, itemBody: item.body, artifact, knownArtifacts: turnResult.adoption_state.pending,
    message: scenario.input, baselineAuthorCount, prefix: `${scenario.id}-pending`, buttonLabel: label,
  });
  const nodes = harness.dumpNodes();
  const located = locateScopedButton(nodes, {
    itemTitle: item.title, itemBody: item.body, artifact, knownArtifacts: turnResult.adoption_state.pending,
    authorBoundary: authorBoundary(nodes, scenario.input, baselineAuthorCount), label,
  });
  assert(located.ok, `adopt_button_not_unique:${scenario.id}:${located.reason}`);
  await captureEvidence(scenario.id + "-before-adoption");
  const clickedAt = nowIso();
  harness.safeClick(located.button, `${scenario.id}:adopt:${label}`);
  const waitFor = (reader, suffix) => harness.pollWire((wire) => {
    try { return reader(wire); }
    catch (error) { if (isPendingWaitMiss(error)) return null; throw error; }
  }, config.budget.ack_timeout_ms, `${scenario.id}:${suffix}`);
  const send = await waitFor((wire) =>
    actionFrame(wire, { topic: identity.topic, since: clickedAt, action }), "author_action");
  const ack = await waitFor((wire) => actionAck(wire, send, { actionStatus: "accepted" }), "author_action_ack");
  const result = await waitFor((wire) =>
    actionResult(wire, { topic: identity.topic, since: send.at, action, actionStatus: "accepted" }), "action_result");
  return {
    artifact_id: artifact.artifact_id, button: label, clicked_at: clickedAt, views,
    send: frameBody(send), ack: frameBody(ack.reply), receipt: frameBody(result),
  };
}

// 真实 main 直接使用这一消费者；测试注入内存 harness 和只记录的 checkpoint 回调。
export async function runScopeScenario(harness, config, scenario, { captureEvidence, readMaintenanceRecords, now = Date.now } = {}) {
  assert.equal(typeof captureEvidence, "function", "scope scenario 必须有真实 checkpoint 消费者");
  const sent = await sendAuthorInput(harness, config, scenario);
  const outcome = await waitScopeTurn(harness, sent.identity, scenario, config.budget);
  const pending = outcome.kind === "turn_result"
    ? scopePendingArtifacts(harness.transport(), sent.identity, outcome.result) : [];
  assert(Array.isArray(pending), "scope_pending_identity_missing:" + scenario.id);
  let adoption = null;
  if (outcome.kind === "turn_result" && scenario.expect.adopt === true && pending.length > 0) {
    adoption = await harness.runStep("adoption", `adopt:${scenario.id}`, () =>
      adoptPending(harness, config, scenario, outcome.result, sent.identity, sent.baselineAuthorCount, captureEvidence));
    // 保存回执不是后台维护终态；沿原作者回合期限结算后再采样、重开。
    adoption.maintenance = await waitAdoptionMaintenance({
      driver: harness, turnResult: outcome.result, identity: sent.identity, artifact: pending[0],
      since: adoption.clicked_at, deadline: Date.parse(sent.message.at) + config.budget.turn_timeout_ms,
      label: scenario.id, readRecords: readMaintenanceRecords, now,
    });
  }
  harness.capture(`${scenario.id}-after`);
  await captureEvidence(scenario.id);
  const result = {
    id: scenario.id, kind: scenario.kind, input: scenario.input,
    turn_id: sent.identity.turnId, run_id: sent.identity.runId,
    topic: sent.identity.topic, session_id: sent.identity.sessionId, message_at: sent.message.at,
    final_kind: outcome.kind, turn_status: outcome.result?.status ?? outcome.terminal.status,
    questions: outcome.openQuestion || outcome.kind === "awaiting_author" ? 1 : 0,
    author_supplements: 0,
    assistant_text: outcome.result?.assistant_message?.text ?? "",
    outcome_kind: outcome.kind !== "turn_result" ? outcome.kind : pending.length > 0 ? "candidate" : "reply",
    pending_count: pending.length,
    judgment_events: judgments(harness.transport(), sent.identity),
    adoption, captured_at: nowIso(),
  };
  if (outcome.kind !== "turn_result") harness.log.push({
    op: "scenario_stopped", id: scenario.id, kind: outcome.kind, at: result.captured_at,
  });
  return result;
}

export async function main(artifact) {
  assert(nonBlank(artifact), "usage: node scripts/native_b28_scope_drive.mjs <batch-run-dir>");
  const dir = path.resolve(artifact);
  const harness = new NativeScenarioHarness(dir);
  const results = [];
  let config;
  let failure = null;
  const writeDriverLog = () => config && harness.writeDriverLog("b28-scope-native-driver-log.json", {
    slice_id: config.slice_id, provider: config.provider, model: config.model, endpoint: config.endpoint,
    budget: config.budget, runtime: config.runtime, work_id: config.target.work_id,
    work_title: config.target.work_title, scenario_order: config.scenarios.map(({ id }) => id),
    full_matrix: config.full_matrix, scenarios: results,
    incomplete: Boolean(failure), failure_reason: failure?.message ?? null,
    transport_frames: harness.transport().length,
  });
  try {
    runEvidenceMode(EVIDENCE, "prepare", dir);
    config = readJson(path.join(dir, CONFIG));
    assert.equal(config.budget.max_harness_retries, 0, "本批禁止 harness 重试");
    assert.equal(config.budget.max_author_inputs, config.scenarios.length, "本批作者输入预算不一致");
    fs.writeFileSync(path.join(dir, "model-service-ownership.json"),
      JSON.stringify(observeExternalModelService(config), null, 2));
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready:initial", () => harness.rawWaitWorkbenchSettled("initial"));
    await ensureWorkSelected(harness, config.target.work_title, "initial");
    harness.capture("01-workbench");
    runEvidenceMode(EVIDENCE, "capture", dir, ["start"]);
    for (const scenario of config.scenarios) {
      const result = await runScopeScenario(harness, config, scenario, {
        captureEvidence: (checkpoint) => runEvidenceMode(EVIDENCE, "capture", dir, [checkpoint]),
        readMaintenanceRecords: () => logs(path.join(dir, "app-log")),
      });
      results.push(result);
      writeDriverLog();
      assert.equal(result.final_kind, "turn_result", `scenario_incomplete:${scenario.id}:${result.final_kind}`);
    }
    await harness.runStep("restore", "close_relaunch_after_adoptions", () => harness.rawCloseAppAndRelaunch());
    await harness.runStep("maintenance", "workbench_ready:final", () => harness.rawWaitWorkbenchSettled("final"));
    await ensureWorkSelected(harness, config.target.work_title, "final");
    harness.capture("02-final");
    runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);
    writeDriverLog();
    harness.writeUiComplete(config.slice_id);
    console.log(`B28-SCOPE 原生驱动完成: scenarios=${results.map(({ id }) => id).join(",")} provider=${config.provider}`);
  } catch (error) {
    failure = error;
    writeDriverLog();
    harness.fail(error);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => { console.error(error); process.exitCode = 1; });
}
