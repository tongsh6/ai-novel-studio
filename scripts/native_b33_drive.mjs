// B33 / R08：模型意图判断与客观协议边界的原生真实模型外部驱动。
//
// 用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生窗口 + 真实 Phoenix 后端 + 嵌入真实前端），
// 在同一个作品上串行执行 6 个预注册场景（S1→S2→S3→S6→S5→S4），采集 AX/截图/网络帧/
// app-log/llm-calls/只读 DB 快照，并记录模型生命周期（strata 单槽加载前 + 结束 unload 核验）。
// 产品代码不读取本文件；驱动只用用户可见语义（输入框/发送/候选卡按钮/采纳按钮）。
//
// 用法：node scripts/native_b33_drive.mjs <batch-run-dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readJson, sleep } from "./lib/native_ui/driver.mjs";
import { CARD } from "../frontend/src/lib/copy.ts";
import { broadcastFrames, requestIdentity, requestReplies } from "./lib/native_ui/scenario_evidence.mjs";
import { wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import { authorBoundary, countAxAuthorMessages } from "./lib/native_ui/authoring_g2_evidence.mjs";
import {
  actionAck, actionFrame, actionResult, isPendingWaitMiss, locateScopedButton, selectPendingAction,
} from "./lib/native_ui/authoring_pending_evidence.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b33_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_b33_evidence.mjs");
const CONFIG = "native-b33-config.json";
const harness = new NativeScenarioHarness(dir);
const TURN_TIMEOUT = 330_000;
const ACK_TIMEOUT = 60_000;
const questionEvents = [];

function nowIso() {
  return new Date().toISOString();
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
}

function execText(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 15_000 });
  } catch (error) {
    return `error:${error.message}`;
  }
}

const strataBase = (endpoint) => String(endpoint ?? "").replace(/\/v1\/?$/, "");

async function strataState(endpoint) {
  try {
    const response = await fetch(`${strataBase(endpoint)}/api/models`);
    if (!response.ok) return { error: `http_${response.status}` };
    const body = await response.json();
    return { mode: body.mode ?? null, current: body.current ?? null, loaded: body.loaded ?? null };
  } catch (error) {
    return { error: error.message };
  }
}

function lifecycleRecord(endpoint, state) {
  return {
    at: nowIso(),
    provider: "strata",
    endpoint,
    lms_ps: execText("lms", ["ps"]),
    memory: execText("vm_stat", []).split("\n").slice(0, 6).join("\n"),
    strata_processes: execText("pgrep", ["-fl", "strata"]).split("\n").slice(0, 10).join("\n"),
    ...state,
  };
}

async function writeModelBefore(config) {
  const state = await strataState(config.strata_endpoint);
  const record = lifecycleRecord(config.strata_endpoint, {
    loaded_before: state.loaded ?? null,
    current_before: state.current ?? null,
    state_before: state,
  });
  writeJson("model-lifecycle-before.json", record);
  return record;
}

async function cleanupStrata(config, stage) {
  const endpoint = config.strata_endpoint;
  let unloadError = null;
  try {
    await fetch(`${strataBase(endpoint)}/api/models/unload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch (error) {
    unloadError = error.message;
  }
  await sleep(1_200);
  const state = await strataState(endpoint);
  const after = lifecycleRecord(endpoint, {
    stage,
    loaded: state.loaded ?? null,
    current: state.current ?? null,
    loaded_after: state.loaded ?? null,
    unloaded: state.loaded === null && !state.error,
    unload_error: unloadError,
    state_after: state,
    lms_ps_after: execText("lms", ["ps"]),
  });
  writeJson("model-lifecycle-after.json", after);
  return after;
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
    }, ACK_TIMEOUT, `ack:${label}`),
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

async function waitScenarioTurn(identity, label) {
  const terminal = await harness.runStep("turn", `turn_result:${label}`, () =>
    harness.pollWire(
      (wire) => wireTerminal(wire, {
        ...identity, resultPosition: "last", requireWireTerminal: true,
      }),
      TURN_TIMEOUT,
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

async function adoptPending(turnResult, identity, scenario, baselineAuthorCount) {
  const label = scenario.id;
  const pending = pendingOf(turnResult);
  if (pending.length !== 1) throw new Error(`pending_target_not_unique:${label}:${pending.length}`);
  const artifact = pending[0];
  const artifactId = artifact.artifact_id;
  const action = selectPendingAction(turnResult, { artifactId, actionType: "accept" });
  const item = artifact.payload?.items?.[0];
  if (!item) throw new Error(`pending_item_missing:${label}`);
  const nodes = harness.dumpNodes();
  const boundary = authorBoundary(nodes, scenario.input, baselineAuthorCount);
  const located = [
    CARD.tentativeArtifact.acceptLabel,
    CARD.tentativeArtifact.acceptProseLabel,
  ].map((buttonLabel) => ({
    label: buttonLabel,
    result: locateScopedButton(nodes, {
      itemTitle: item.title, itemBody: item.body, artifact, knownArtifacts: pending,
      authorBoundary: boundary, label: buttonLabel,
    }),
  }));
  const matches = located.filter((entry) => entry.result.ok);
  if (matches.length !== 1 || located.some((entry) => entry.result.reason === "action_ambiguous")) {
    throw new Error(`adopt_button_not_unique:${label}:${JSON.stringify(located)}`);
  }
  const chosen = matches[0];
  const startedAt = nowIso();
  harness.safeClick(chosen.result.button, `${label}:adopt:${chosen.label}`);
  const waitFor = (reader, suffix) => harness.pollWire((wire) => {
    try { return reader(wire); }
    catch (error) {
      if (isPendingWaitMiss(error)) return null;
      throw error;
    }
  }, ACK_TIMEOUT, `${label}:${suffix}`);
  const send = await waitFor((wire) =>
    actionFrame(wire, { topic: identity.topic, since: startedAt, action }), "author_action_sent");
  const ack = await waitFor((wire) =>
    actionAck(wire, send, { actionStatus: "accepted" }), "author_action_ack");
  const receipt = await waitFor((wire) =>
    actionResult(wire, {
      topic: identity.topic, since: send.at, action, actionStatus: "accepted",
    }), "action_result");
  return {
    artifact_id: artifactId, button: chosen.label, clicked_at: startedAt,
    send: frameBody(send), ack: frameBody(ack.reply), receipt: frameBody(receipt), at: nowIso(),
  };
}

async function runScenario(config, scenario) {
  const label = scenario.id;
  const { message, turnId, runId, identity, baselineAuthorCount } =
    await sendAuthorInput(scenario.input, label, config);
  const { turnResult, finalKind, questions, terminal } = await waitScenarioTurn(identity, label);
  const pending = pendingOf(turnResult);
  let adoption = null;
  if (scenario.adopt && finalKind === "turn_result") {
    adoption = await harness.runStep("adoption", `adopt:${label}`, () =>
      adoptPending(turnResult, identity, scenario, baselineAuthorCount),
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
      object_kind: entry.payload?.object_kind ?? entry.payload?.artifact_type ?? null,
      item_count: entry.payload?.item_count ?? entry.payload?.items?.length ?? null,
    })),
    adoption,
    terminal,
    captured_at: nowIso(),
  };
}

async function main() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, CONFIG));
  const before = await writeModelBefore(config);
  harness.log.push({
    op: "model_lifecycle_before",
    at: before.at,
    loaded_before: before.loaded_before,
  });

  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () =>
    harness.rawWaitWorkbenchSettled("initial"),
  );
  await ensureWorkSelected(harness, config.target.work_title, "initial");
  harness.capture("01-workbench");
  runEvidenceMode(EVIDENCE, "capture", dir, ["start"]);

  const results = [];
  try {
    for (const scenario of config.scenarios) {
      harness.log.push({ op: "scenario_start", id: scenario.id, at: nowIso() });
      const result = await runScenario(config, scenario);
      results.push(result);
      if (result.final_kind !== "turn_result") {
        throw new Error(`scenario_not_completed:${scenario.id}:${result.final_kind}`);
      }
      harness.log.push({
        op: "scenario_done",
        id: scenario.id,
        at: nowIso(),
        turn_id: result.turn_id,
        pending_count: result.pending_count,
        adopted: Boolean(result.adoption),
      });
    }
    runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);
    harness.capture("02-final");
    harness.writeDriverLog("b33-native-driver-log.json", {
      slice_id: config.slice_id,
      provider: "strata",
      model: config.model,
      strata_endpoint: config.strata_endpoint,
      work_id: config.target.work_id,
      work_title: config.target.work_title,
      scenario_order: config.scenarios.map((scenario) => scenario.id),
      full_matrix: config.full_matrix,
      scenarios: results,
      author_question_events: questionEvents,
      model_lifecycle_before: before,
      transport_frames: harness.transport().length,
    });
    const after = await cleanupStrata(config, "completed");
    harness.log.push({ op: "strata_cleanup", at: after.at, unloaded: after.unloaded });
    harness.writeUiComplete(config.slice_id);
    console.log(
      `B33 CP3 原生驱动完成: scenarios=${results.map((result) => result.id).join(",")} ` +
        `screenshots=${harness.screenshots.length} strata_unloaded=${after.unloaded}`,
    );
  } catch (error) {
    try {
      harness.writeDriverLog("b33-native-driver-log.json", {
        slice_id: config.slice_id,
        provider: "strata",
        model: config.model,
        strata_endpoint: config.strata_endpoint,
        work_id: config.target.work_id,
        work_title: config.target.work_title,
        scenario_order: config.scenarios.map((scenario) => scenario.id),
        full_matrix: config.full_matrix,
        scenarios: results,
        incomplete: true,
        failure_reason: error.message,
        author_question_events: questionEvents,
        model_lifecycle_before: before,
        transport_frames: harness.transport().length,
      });
    } catch (logError) {
      harness.log.push({ op: "driver_log_write_failed", reason: logError.message });
    }
    try {
      const after = await cleanupStrata(config, "failed");
      harness.log.push({ op: "strata_cleanup_failed_path", at: after.at, unloaded: after.unloaded });
    } catch (cleanupError) {
      harness.log.push({ op: "strata_cleanup_error", reason: cleanupError.message });
    }
    throw error;
  }
}

main().catch((error) => harness.fail(error));
