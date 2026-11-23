// B33 / R08：模型意图判断与客观协议边界的原生真实模型外部驱动。
//
// 用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生窗口 + 真实 Phoenix 后端 + 嵌入真实前端），
// 在同一个作品上串行执行 6 个预注册场景（S1→S2→S3→S6→S5→S4），采集 AX/截图/网络帧/
// app-log/llm-calls/只读 DB 快照；模型服务由作者管理，驱动只记录服务观察，不加载或卸载。
// 产品代码不读取本文件；驱动只用用户可见语义（输入框/发送/候选卡按钮/采纳按钮）。
//
// 用法：node scripts/native_b33_drive.mjs <batch-run-dir>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adoptionMaintenanceOutcome, selectB33PendingArtifact } from "./native_b33_evidence.mjs";
import { readJson } from "./lib/native_ui/driver.mjs";
import { readStrataState } from "./lib/native_ui/strata_lifecycle.mjs";
import { CARD } from "../frontend/src/lib/copy.ts";
import { broadcastFrames, logs, requestIdentity, requestReplies } from "./lib/native_ui/scenario_evidence.mjs";
import { wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import { authorBoundary, countAxAuthorMessages } from "./lib/native_ui/authoring_g2_evidence.mjs";
import {
  actionAck, actionFrame, actionLabelsFor, actionResult, actionTurnResult, isPendingWaitMiss, locateScopedButton, selectPendingAction,
} from "./lib/native_ui/authoring_pending_evidence.mjs";
import { revealItem } from "./lib/native_ui/authoring_pending_driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

let dir;
let harness;
const EVIDENCE = path.join(ROOT, "scripts/native_b33_evidence.mjs");
const CONFIG = "native-b33-config.json";
const questionEvents = [];
function nowIso() {
  return new Date().toISOString();
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
}

export async function observeExternalModelService(config, { readState = readStrataState } = {}) {
  const record = {
    at: nowIso(), provider: config.provider, model: config.model, endpoint: config.endpoint,
    read_only: true, lifecycle_action: "none", ownership: "external",
  };
  if (config.provider !== "strata") return {
    ...record, status: "not_observed", reason: "external_service_lifecycle_not_queried",
  };
  try {
    const state = await readState({ endpoint: config.endpoint.replace(/\/v1\/?$/u, "") });
    return { ...record, status: state.models_ok && state.api_ok && !state.error ? "observed" : "unavailable", state };
  } catch (error) {
    return { ...record, status: "unavailable", error: error.message };
  }
}
async function sendAuthorInput(text, label, config) {
  await harness.runStep("maintenance", `input_ready:${label}`, () => harness.rawWaitInputReady(label));
  const baselineAuthorCount = countAxAuthorMessages(harness.dumpNodes(), text);
  const message = await harness.runStep("input", `type_send:${label}`, () =>
    harness.rawTypeAndSend(text, label),
  );
  const body = frameBody(message);
  const turnId = String(body?.turn_id ?? "");
  if (!turnId) throw new Error(`user_message_without_turn_id:${label}`);
  if (body?.text !== text) throw new Error(`user_message_text_mismatch:${label}`);
  if (body?.work_id !== config.target.work_id || !body?.session_id ||
      (config.target.session_id && body.session_id !== config.target.session_id)) {
    throw new Error(`user_message_scope_mismatch:${label}`);
  }
  const request = requestIdentity(message);
  const ack = await harness.runStep("ack", `ack:${label}`, () =>
    harness.pollWire((wire) => {
      const replies = requestReplies(wire, request, message.at);
      if (replies.length > 1) throw new Error(`user_message_ack_ambiguous:${label}`);
      return replies[0] ?? null;
    }, config.budget.ack_timeout_ms, `ack:${label}`),
  );
  const ackBody = frameBody(ack);
  const runId = ackBody?.response?.run_id;
  if (ackBody?.status !== "ok" || ackBody.response?.turn_id !== turnId ||
      typeof runId !== "string" || runId === "") {
    throw new Error(`user_message_ack_invalid:${label}`);
  }
  return {
    message, turnId, runId, baselineAuthorCount,
    identity: {
      topic: request.topic, turnId, runId, workId: body.work_id,
      workspaceId: request.topic.startsWith("workspace:") ? request.topic.slice("workspace:".length) : null,
      sessionId: body.session_id, since: message.at,
    },
  };
}

function runJudgmentEvents(wire, identity) {
  return broadcastFrames(wire, {
    topic: identity.topic, at: identity.since, runRef: identity.runId, event: "agent_event",
  }).filter((entry) => frameBody(entry)?.event_type === "judgment_decided").map((entry) => ({
    action: frameBody(entry)?.payload?.action ?? null,
    capability: frameBody(entry)?.payload?.capability ?? null,
    stage: frameBody(entry)?.payload?.stage ?? null,
    reason_codes: frameBody(entry)?.reason_codes ?? [],
  }));
}

async function waitScenarioTurn(identity, label, timeoutMs) {
  const terminal = await harness.runStep("turn", `turn_result:${label}`, () =>
    harness.pollWire(
      (wire) => wireTerminal(wire, {
        ...identity, resultPosition: "last", requireWireTerminal: true,
      }),
      timeoutMs,
      `${label}:turn_outcome`,
    ),
  );
  const turnResult = terminal.kind === "completed" ? terminal.body : null;
  const question = turnResult?.author_question;
  const unanswered = question?.question && !["answered", "closed"].includes(question.status);
  const finalKind = unanswered ? "author_question"
    : terminal.kind !== "completed" ? terminal.kind
    : turnResult?.status === "failed" ? "failed" : "turn_result";
  if (finalKind !== "turn_result") {
    questionEvents.push({ label, at: nowIso(), kind: finalKind, terminal });
    writeJson("author_question_events.json", questionEvents);
    harness.log.push({ op: "scenario_stopped", label, kind: finalKind });
  }
  return { turnResult, finalKind, questions: unanswered ? 1 : 0, terminal };
}

function pendingOf(turnResult) {
  return turnResult?.adoption_state?.pending ?? [];
}

export async function adoptPending(
  turnResult, identity, scenario, baselineAuthorCount, timeoutMs,
  { driver = harness, readStart = () => readJson(path.join(dir, "b33-start.json")) } = {},
) {
  const label = scenario.id;
  const pending = pendingOf(turnResult);
  const { unique, artifact } = selectB33PendingArtifact(turnResult, {
    wire: driver.transport(), identity, scenario, start: readStart(),
  });
  if (!unique) throw new Error(`pending_target_not_unique:${label}:${pending.length}`);
  const artifactId = artifact.artifact_id;
  const action = selectPendingAction(turnResult, { artifactId, actionType: "accept" });
  const item = artifact.payload?.items?.[0];
  if (!item) throw new Error(`pending_item_missing:${label}`);
  const buttonLabel = artifact.artifact_type === "chapter_structure_change_plan"
    ? CARD.tentativeArtifact.acceptLabel
    : actionLabelsFor(artifact, turnResult).accept;
  await revealItem(driver, item.title, item.body);
  const nodes = driver.dumpNodes();
  const boundary = authorBoundary(nodes, scenario.input, baselineAuthorCount);
  const chosen = { label: buttonLabel, result: locateScopedButton(nodes, {
    itemTitle: item.title, itemBody: item.body, artifact, knownArtifacts: pending,
    authorBoundary: boundary, label: buttonLabel,
  }) };
  if (!chosen.result.ok) {
    throw new Error(`adopt_button_not_unique:${label}:${JSON.stringify([chosen])}`);
  }
  const startedAt = nowIso();
  driver.safeClick(chosen.result.button, `${label}:adopt:${chosen.label}`);
  const waitFor = (reader, suffix) => driver.pollWire((wire) => {
    try { return reader(wire); }
    catch (error) {
      if (isPendingWaitMiss(error)) return null;
      throw error;
    }
  }, timeoutMs, `${label}:${suffix}`);
  const send = await waitFor((wire) =>
    actionFrame(wire, { topic: identity.topic, since: startedAt, action }), "author_action_sent");
  const ack = await waitFor((wire) =>
    actionAck(wire, send, { actionStatus: "accepted" }), "author_action_ack");
  const receipt = await waitFor((wire) =>
    actionResult(wire, {
      topic: identity.topic, since: send.at, action, actionStatus: "accepted",
    }), "action_result");
  await waitFor((wire) => actionTurnResult(wire, {
    topic: identity.topic, since: send.at, parentTurnRef: turnResult.turn_id,
  }), "adoption_turn_result");
  return {
    artifact_id: artifactId, button: chosen.label, clicked_at: startedAt,
    send: frameBody(send), ack: frameBody(ack.reply), receipt: frameBody(receipt), at: nowIso(),
  };
}

export async function waitAdoptionMaintenance(
  turnResult, identity, scenario, deadline,
  { driver = harness, readStart = () => readJson(path.join(dir, "b33-start.json")),
    readRecords = () => logs(path.join(dir, "app-log")), now = Date.now } = {},
) {
  const selection = selectB33PendingArtifact(turnResult, {
    wire: driver.transport(), identity, scenario, start: readStart(),
  });
  if (!selection.unique || selection.artifact?.artifact_type !== "prose_fragment") {
    throw new Error("maintenance_source_not_selected:" + scenario.id);
  }
  const action = selectPendingAction(turnResult, { artifactId: selection.artifact.artifact_id, actionType: "accept" });
  const wire = driver.transport();
  const sent = actionFrame(wire, { topic: identity.topic, since: selection.terminal.record.at, action });
  actionAck(wire, sent, { actionStatus: "accepted" });
  const receipt = frameBody(actionResult(wire, {
    topic: identity.topic, since: sent.at, action, actionStatus: "accepted",
  }));
  const projection = receipt.persistence?.reading_projection;
  if (!projection || selection.artifact.target_chapter_ref !== "chapter:" + projection.chapter_id ||
      receipt.persistence?.persisted !== true || !projection.source_revision_ref) {
    throw new Error("maintenance_projection_not_bound:" + scenario.id);
  }
  return driver.runStep("maintenance", "summary_ledger:" + scenario.id, () => {
    const remaining = deadline - now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("maintenance_turn_budget_exhausted:" + scenario.id);
    return driver.pollWire(() => adoptionMaintenanceOutcome(readRecords(), {
      workId: identity.workId, chapterId: projection.chapter_id,
      since: sent.at, until: new Date(Math.min(now(), deadline)).toISOString(),
    }), remaining, "summary_ledger:" + scenario.id);
  });
}

async function runScenario(config, scenario) {
  const label = scenario.id;
  const { message, turnId, runId, identity, baselineAuthorCount } =
    await sendAuthorInput(scenario.input, label, config);
  const { turnResult, finalKind, questions, terminal } = await waitScenarioTurn(identity, label, config.budget.turn_timeout_ms);
  const pending = pendingOf(turnResult);
  let adoption = null;
  if (scenario.adopt && finalKind === "turn_result") {
    runEvidenceMode(EVIDENCE, "capture", dir, [label + "-before-adoption"]);
    adoption = await harness.runStep("adoption", `adopt:${label}`, () =>
      adoptPending(turnResult, identity, scenario, baselineAuthorCount, config.budget.ack_timeout_ms),
    );
    if (scenario.id === "S4") await waitAdoptionMaintenance(
      turnResult, identity, scenario, Date.parse(message.at) + config.budget.turn_timeout_ms,
    );
  }
  harness.capture(`${label}-after`);
  runEvidenceMode(EVIDENCE, "capture", dir, [label]);
  return {
    id: label,
    kind: scenario.kind,
    input: scenario.input,
    turn_id: turnId,
    message_at: message.at,
    questions,
    assistant_text: String(turnResult?.assistant_message?.text ?? ""),
    turn_status: turnResult?.status ?? null,
    final_kind: finalKind,
    run_id: runId,
    judgment_events: runJudgmentEvents(harness.transport(), identity),
    frame_type: turnResult?.frame_summary?.frame_type ?? null,
    pending_count: pending.length,
    pending: pending.map((entry) => ({
      artifact_id: entry.artifact_id ?? null,
      object_kind: entry.artifact_type ?? entry.payload?.object_kind ?? null,
      item_count: entry.payload?.item_count ?? entry.payload?.items?.length ?? null,
    })),
    adoption,
    terminal,
    captured_at: nowIso(),
  };
}

export async function main(artifact) {
  if (typeof artifact !== "string" || artifact.trim() === "") throw new Error("usage: node scripts/native_b33_drive.mjs <batch-run-dir>");
  dir = path.resolve(artifact);
  harness = new NativeScenarioHarness(dir);
  const results = [];
  let config = null;
  let before = null;
  let completed = false;
  let failureReason = null;
  try {
    runEvidenceMode(EVIDENCE, "prepare", dir);
    config = readJson(path.join(dir, CONFIG));
    before = await observeExternalModelService(config);
    writeJson("model-lifecycle-before.json", before);
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready:initial", () => harness.rawWaitWorkbenchSettled("initial"));
    await ensureWorkSelected(harness, config.target.work_title, "initial");
    harness.capture("01-workbench");
    runEvidenceMode(EVIDENCE, "capture", dir, ["start"]);
    for (const scenario of config.scenarios) {
      if (results.length >= config.budget.max_author_inputs) throw new Error("author_input_budget_exhausted");
      harness.log.push({ op: "scenario_start", id: scenario.id, at: nowIso() });
      const result = await runScenario(config, scenario);
      results.push(result);
      if (result.final_kind !== "turn_result") throw new Error(`scenario_not_completed:${scenario.id}:${result.final_kind}`);
      harness.log.push({ op: "scenario_done", id: scenario.id, at: nowIso(), turn_id: result.turn_id,
        pending_count: result.pending_count, adopted: Boolean(result.adoption) });
    }
    runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);
    harness.capture("02-final");
    completed = true;
  } catch (error) {
    failureReason = error.message;
    throw error;
  } finally {
    if (config) {
      const after = await observeExternalModelService(config);
      writeJson("model-lifecycle-after.json", after);
      harness.writeDriverLog("b33-native-driver-log.json", {
        slice_id: config.slice_id, provider: config.provider, model: config.model, endpoint: config.endpoint,
        budget: config.budget, work_id: config.target.work_id, work_title: config.target.work_title,
        scenario_order: config.scenarios.map((scenario) => scenario.id), full_matrix: config.full_matrix,
        scenarios: results, incomplete: !completed, failure_reason: failureReason,
        author_question_events: questionEvents, model_lifecycle_before: before, model_lifecycle_after: after,
        transport_frames: harness.transport().length,
      });
    }
  }
  harness.writeUiComplete(config.slice_id);
  console.log(`B33 原生驱动完成: scenarios=${results.map((result) => result.id).join(",")} provider=${config.provider} screenshots=${harness.screenshots.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    if (harness) harness.fail(error);
    else { console.error(error); process.exitCode = 1; }
  });
}
