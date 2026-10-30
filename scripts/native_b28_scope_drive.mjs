// B28-SCOPE CP3：作者授权范围（否定/条件/读取/局部/正向）的原生真实模型外部驱动。
//
// 用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生窗口 + 真实 Phoenix 后端 + 嵌入真实前端），
// 在同一个作品上串行执行 7 个预注册场景（P3→N1→N2→N3→N4→P1→P2；P3 提前以保持「二十五岁」字面可定位），
// 采集 AX/截图/网络帧/app-log/llm-calls/只读 DB 快照，并记录模型生命周期（strata 单槽加载前 + 结束 unload 核验）。
// 产品代码不读取本文件；驱动只用用户可见语义（输入框/发送/候选卡按钮/采纳按钮）。
//
// 用法：node scripts/native_b28_scope_drive.mjs <batch-run-dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pressKey, readJson, sleep, textOf, typeText } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  frameOf,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b28_scope_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_b28_scope_evidence.mjs");
const CONFIG = "native-b28-scope-config.json";
const harness = new NativeScenarioHarness(dir);
const TURN_TIMEOUT = 330_000;
const ACK_TIMEOUT = 60_000;
const AUTHOR_QUESTION_LIMIT = 2;
const questionEvents = [];
const PAUSE_STATUSES = new Set([
  "awaiting_author",
  "awaiting_input",
  "paused",
  "stopped",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);

// 作者补充/澄清的默认决策：按当前场景给出具体、可继续的默认，而不是空等。
function supplementFor(scenario) {
  switch (scenario.id) {
    case "N1":
      return "按当前请求继续：只改我点名的第一段，其余段落逐字保留，不要扩大范围。";
    case "N2":
      return "按当前请求继续：只改我点名的第二段，第一段与其余字节逐字保留。";
    case "N3":
      return "本轮只检查，不要修改任何正文；把结论告诉我即可，不要生成候选。";
    case "N4":
      return "先按已读到的正文判断有没有明显问题；现在不要生成候选，也不要改动正文。";
    case "P3":
      return "按当前请求继续：只把「二十五岁」改成「三十岁」，其余逐字不变。";
    case "P1":
      return "按当前请求继续：整章重写，但保持人物、情节与既有事实不变。";
    case "P2":
      return "按当前请求继续：只调整分段和排版，所有文字与标点逐字不变，至少实际增加一处段落换行。";
    default:
      return "按当前请求继续即可，不需要额外信息；保持人物与情节一致，不要重复读取同一材料。";
  }
}

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

function findTurnResult(wire, turnId, predicate = () => true) {
  return (
    wire.find(
      (entry) =>
        entry.direction === "received" &&
        Array.isArray(entry.frame) &&
        entry.frame.length >= 5 &&
        entry.frame[3] === "turn_result" &&
        (String(entry.frame[4]?.turn_id ?? "") === turnId ||
          String(entry.frame[4]?.turn_id ?? "").startsWith(`${turnId}:`)) &&
        predicate(entry.frame[4]),
    ) ?? null
  );
}

function findButtonByText(nodes, predicate) {
  const matches = nodes.filter(
    (node) =>
      node.role === "AXButton" &&
      (predicate(String(node.title ?? "")) || predicate(String(node.value ?? ""))) &&
      Array.isArray(node.frame) &&
      node.frame[1] > 0,
  );
  return matches.at(-1) ?? null;
}

function authorQuestionDefault() {
  return "先按当前作品事实继续，保持人物与情节一致；具体细节由你决定，不要停下来问我。";
}

async function rawRespondToAuthorQuestion(label, body, question) {
  const actions = (body.available_actions ?? []).filter(
    (action) =>
      action.action_type === "author_choice" && action.question_ref === question.question_ref,
  );
  const options = question.options ?? [];
  const choiceAction =
    actions.find((action) => action.response_kind === "choice") ??
    actions.find((action) => action.response_kind !== "free_text");
  const choiceOptions = options.filter((option) => option.kind !== "free_text");
  const recommended = choiceOptions.find((option) => option.recommended) ?? choiceOptions[0] ?? null;
  const startedAt = nowIso();
  let chosenLabel = null;
  let replyText = null;

  if (recommended) {
    const nodes = harness.dumpNodes();
    const button =
      findButtonByText(nodes, (value) => value === recommended.label) ??
      (choiceAction ? findButtonByText(nodes, (value) => value === choiceAction.label) : null);
    if (!button) throw new Error(`author_question_option_button_not_found:${label}`);
    harness.safeClick(button, `${label}:author-choice`);
    chosenLabel = recommended.label;
  } else {
    const nodes = harness.dumpNodes();
    const entry =
      (choiceAction ? findButtonByText(nodes, (value) => value === choiceAction.label) : null) ??
      findButtonByText(nodes, (value) => value.includes("回复此问题"));
    if (!entry) throw new Error(`author_question_reply_entry_not_found:${label}`);
    harness.safeClick(entry, `${label}:reply-entry`);
    await sleep(900);
    const textarea = harness.dumpNodes().find((node) => node.role === "AXTextArea");
    if (!textarea) throw new Error(`author_question_textarea_not_found:${label}`);
    harness.safeClick(textarea, `${label}:reply-textarea`);
    await sleep(250);
    replyText = authorQuestionDefault();
    typeText(harness.APP, replyText);
    await sleep(500);
    const sendButton = findButtonByText(harness.dumpNodes(), (value) => value === "发送回复");
    if (!sendButton) throw new Error(`author_question_send_button_not_found:${label}`);
    harness.safeClick(sendButton, `${label}:send-reply`);
  }

  const action = await harness.pollWire(
    (wire) =>
      wire.find(
        (entry) =>
          entry.direction === "sent" &&
          frameOf(entry) &&
          entry.at >= startedAt &&
          entry.frame[3] === "author_action",
      ) ?? null,
    60_000,
    `${label}:author_question_action`,
  );
  const event = {
    label,
    at: nowIso(),
    question: question.question,
    question_ref: question.question_ref,
    options: options.map((option) => ({
      label: option.label,
      kind: option.kind ?? null,
      recommended: Boolean(option.recommended),
    })),
    chosen_option: chosenLabel,
    free_text_reply: replyText,
    response_kind: chosenLabel ? "choice" : "free_text",
    action_type: action.frame[4]?.action?.action_type ?? null,
    question_action_ref: action.frame[4]?.action?.payload?.question_ref ?? null,
    source_turn_ref: action.frame[4]?.action?.source_turn_ref ?? null,
  };
  questionEvents.push(event);
  writeJson("author_question_events.json", questionEvents);
  harness.log.push({
    op: "author_question",
    label,
    response_kind: event.response_kind,
    question: question.question,
  });
}

async function sendAuthorInput(text, label) {
  await harness.runStep("maintenance", `input_ready:${label}`, () => harness.rawWaitInputReady(label));
  const message = await harness.runStep("input", `type_send:${label}`, () =>
    harness.rawTypeAndSend(text, label),
  );
  const turnId = String(frameBody(message)?.turn_id ?? "");
  if (!turnId) throw new Error(`user_message_without_turn_id:${label}`);
  if (String(frameBody(message)?.text ?? "") !== text) {
    throw new Error(`user_message_text_mismatch:${label}`);
  }
  const ack = await harness.runStep("ack", `ack:${label}`, () =>
    harness.pollWire((wire) => harness.ackFor(wire, message), ACK_TIMEOUT, `ack:${label}`),
  );
  return { message, turnId, runId: String(ack?.frame?.[4]?.response?.run_id ?? "") };
}

let completedGraceSince = null;

function latestRunState(wire, turnId) {
  const states = wire.filter(
    (entry) =>
      entry.direction === "received" &&
      frameOf(entry) &&
      entry.frame[3] === "agent_run_state" &&
      String(entry.frame[4]?.parent_turn_ref ?? "") === turnId,
  );
  return states.at(-1)?.frame?.[4] ?? null;
}

function latestRunEvent(wire, turnId, eventType) {
  const events = wire.filter(
    (entry) =>
      entry.direction === "received" &&
      frameOf(entry) &&
      entry.frame[3] === "agent_event" &&
      String(entry.frame[4]?.event_type ?? "") === eventType &&
      (String(entry.frame[4]?.run_id ?? "") === String(latestRunState(wire, turnId)?.run_id ?? "") ||
        String(entry.frame[4]?.parent_turn_ref ?? "") === turnId),
  );
  return events.at(-1)?.frame?.[4] ?? null;
}

function runJudgmentEvents(wire, turnId) {
  const runId = String(latestRunState(wire, turnId)?.run_id ?? "");
  if (!runId) return [];
  return wire
    .filter(
      (entry) =>
        entry.direction === "received" &&
        frameOf(entry) &&
        entry.frame[3] === "agent_event" &&
        String(entry.frame[4]?.run_id ?? "") === runId &&
        String(entry.frame[4]?.event_type ?? "") === "judgment_decided",
    )
    .map((entry) => ({
      action: entry.frame[4]?.payload?.action ?? null,
      capability: entry.frame[4]?.payload?.capability ?? null,
      stage: entry.frame[4]?.payload?.stage ?? null,
      reason_codes: entry.frame[4]?.reason_codes ?? [],
    }));
}

// 作者补充输入：AgentRun 进入 awaiting_author（无进展/需方向）时，真实 UI 面板出现
// 「调整当前任务 / 在下方输入框回复或补充 / 发送调整」。像作者一样给出具体默认决策。
async function respondToRunPause(label, scenario, state, pauseEvent, turnId) {
  const startedAt = nowIso();
  const stage = String(pauseEvent?.payload?.stage ?? "awaiting_author");
  const summary = String(pauseEvent?.summary ?? state?.current_activity?.summary ?? "");
  const duplicate = questionEvents.some(
    (event) => event.label === label && event.stage === stage && event.summary === summary,
  );
  const attempts = questionEvents.filter((event) => event.label === label).length;
  if (attempts >= AUTHOR_QUESTION_LIMIT || duplicate) {
    throw new Error(`author_pause_repeated_without_progress:${label}:${stage}`);
  }

  const supplement = supplementFor(scenario);
  const nodes = harness.dumpNodes();
  // 运行暂停面板（真实 UI）：AXTextField title「调整当前任务」+ AXButton「发送调整」
  // （输入文本后按钮启用）。整段已在调用方 runStep("maintenance") 内，内部只用 raw 操作。
  const panelField =
    nodes.find(
      (node) =>
        node.role === "AXTextField" &&
        /调整当前任务|回复或补充|补充方向/.test(String(node.title ?? node.desc ?? node.value ?? "")),
    ) ??
    nodes.find(
      (node) =>
        node.role === "AXTextField" &&
        !/输入/.test(String(node.desc ?? "")) &&
        !/输入/.test(String(node.title ?? "")),
    );
  if (!panelField) {
    throw new Error(`run_pause_panel_input_not_found:${label}:status=${state?.status ?? "unknown"}`);
  }
  const responseKind = "run_pause_panel";
  harness.safeClick(panelField, `${label}:pause-field`);
  await sleep(300);
  typeText(harness.APP, supplement);
  await sleep(600);
  const send = findButtonByText(harness.dumpNodes(), (value) => value === "发送调整");
  if (!send) throw new Error(`run_pause_send_button_not_found:${label}`);
  harness.safeClick(send, `${label}:send-pause-adjust`);
  harness.log.push({ op: "run_pause_panel_send", label, chars: supplement.length });

  await harness.pollWire(
    (wire) => {
      const states = wire.filter(
        (entry) =>
          entry.direction === "received" &&
          frameOf(entry) &&
          entry.frame[3] === "agent_run_state" &&
          String(entry.frame[4]?.parent_turn_ref ?? "") === turnId &&
          entry.at >= startedAt,
      );
      const running = states.find((entry) => String(entry.frame[4]?.status ?? "") === "running");
      if (running) return running;
      return (
        wire.find(
          (entry) =>
            entry.direction === "sent" &&
            frameOf(entry) &&
            entry.at >= startedAt &&
            ["user_message", "author_action", "agent_command"].includes(String(entry.frame[3] ?? "")),
        ) ?? null
      );
    },
    60_000,
    `${label}:supplement_sent`,
  );
  const event = {
    kind: "run_pause",
    label,
    at: nowIso(),
    stage,
    summary,
    question: summary,
    response_kind: responseKind,
    free_text_reply: supplement,
    state_status: state?.status ?? null,
  };
  questionEvents.push(event);
  writeJson("author_question_events.json", questionEvents);
  harness.log.push({ op: "run_pause_supplement", label, stage, response_kind: responseKind });
  await sleep(800);
  return event;
}

async function waitScenarioTurn(turnId, scenario, label) {
  let questions = 0;
  completedGraceSince = null;
  for (;;) {
    const record = await harness.runStep("turn", `turn_result:${label}:${questions}`, () =>
      harness.pollWire(
        (wire) => {
          const found = findTurnResult(wire, turnId);
          if (found) {
            const body = found.frame[4] ?? {};
            const question = body.author_question;
            if (question?.question && question.status !== "answered" && question.status !== "closed") {
              return { kind: "author_question", record: found };
            }
            if ((body.adoption_state?.pending ?? []).length > 0) {
              return { kind: "turn_result", record: found };
            }
            if (String(body.status ?? "") === "failed") return { kind: "turn_result", record: found };
            const agentStatus = String(body.agent_run?.status ?? "");
            if (String(body.phase ?? "") === "running" || agentStatus === "running") return null;
            if (String(body.assistant_message?.text ?? "").trim() !== "") {
              return { kind: "turn_result", record: found };
            }
          }
          const state = latestRunState(wire, turnId);
          if (state && PAUSE_STATUSES.has(String(state.status ?? ""))) {
            if (String(state.status ?? "") === "running") return null;
            const status = String(state.status ?? "");
            if (status === "awaiting_author" || status === "awaiting_input" || status === "paused") {
              return { kind: "run_state", state, record: null };
            }
            // completed/failed/cancelled：先给 turn_result 一个晚到宽限窗口，
            // 不把「run 已完成」直接当成「已有可见结果」。
            if (completedGraceSince === null) completedGraceSince = Date.now();
            if (Date.now() - completedGraceSince < 15_000) return null;
            return { kind: "run_state", state, record: null };
          }
          return null;
        },
        TURN_TIMEOUT,
        `${label}:turn_outcome`,
      ),
    );

    if (record.kind === "turn_result") {
      return { turnResult: record.record.frame[4] ?? {}, finalKind: "turn_result", questions };
    }
    if (record.kind === "author_question") {
      const body = record.record.frame[4] ?? {};
      const question = body.author_question;
      if (questions >= AUTHOR_QUESTION_LIMIT) throw new Error(`author_question_reply_limit:${label}`);
      const duplicate = questionEvents.some(
        (event) => event.question_ref === question.question_ref && event.label === label,
      );
      if (duplicate) {
        throw new Error(`author_question_repeated_without_progress:${label}:${question.question_ref}`);
      }
      await harness.runStep("maintenance", `author_question:${label}:${questions + 1}`, () =>
        rawRespondToAuthorQuestion(label, body, question),
      );
      questions += 1;
      await sleep(800);
      continue;
    }

    // AgentRun 暂停：真实 UI 面板 waits for author supplement/direction.
    const state = record.state;
    const pauseEvent = latestRunEvent(harness.transport(), turnId, "awaiting_author");
    const status = String(state.status ?? "");
    if (status === "awaiting_author" || status === "awaiting_input" || status === "paused") {
      await harness.runStep("maintenance", `run_pause:${label}:${questions + 1}`, () =>
        respondToRunPause(label, scenario, state, pauseEvent, turnId),
      );
      questions += 1;
      continue;
    }
    return { turnResult: { status, agent_run: state }, finalKind: status, questions };
  }
}

function pendingOf(turnResult) {
  return turnResult?.adoption_state?.pending ?? [];
}

function receiptMatchesArtifact(body, artifactId) {
  if (!body || typeof body !== "object") return false;
  const decision = body.decision ?? {};
  return (
    body.artifact_id === artifactId ||
    body.target_ref === artifactId ||
    decision.target_ref === `artifact:${artifactId}` ||
    decision.candidate_ref === artifactId ||
    decision.target_ref === artifactId
  );
}

async function adoptPending(pendingEntry, label) {
  const artifactId = String(pendingEntry.artifact_id ?? pendingEntry.id ?? "");
  if (!artifactId) throw new Error(`pending_artifact_id_missing:${label}`);
  const buttonLabels = ["保存到作品", "保存为章节正文", "应用分段方案", "采纳", "接受"];
  const startedAt = nowIso();
  let chosen = null;
  for (const buttonLabel of buttonLabels) {
    const button = findButtonByText(harness.dumpNodes(), (value) => value === buttonLabel);
    if (!button) continue;
    harness.safeClick(button, `${label}:adopt:${buttonLabel}`);
    chosen = buttonLabel;
    break;
  }
  if (!chosen) throw new Error(`adopt_button_not_found:${label}`);

  const findSend = (wire) =>
    wire.find(
      (entry) =>
        entry.direction === "sent" &&
        frameOf(entry) &&
        entry.at >= startedAt &&
        entry.frame[3] === "author_action" &&
        (entry.frame[4]?.action?.target_ref === artifactId ||
          String(entry.frame[4]?.action?.target_ref ?? "").includes(artifactId)),
    ) ?? null;
  let send = await harness.tryPollWire(findSend, 15_000);
  if (!send) {
    const retryButton = findButtonByText(harness.dumpNodes(), (value) => value === chosen);
    if (retryButton) harness.safeClick(retryButton, `${label}:adopt-retry`);
    send = await harness.pollWire(findSend, 30_000, `${label}:author_action_sent`);
  }
  const receipt = await harness.pollWire(
    (wire) =>
      wire.find(
        (entry) =>
          entry.direction === "received" &&
          frameOf(entry) &&
          entry.at >= send.at &&
          entry.frame[3] === "action_result" &&
          entry.frame[4]?.status === "accepted" &&
          receiptMatchesArtifact(entry.frame[4], artifactId),
      ) ??
      wire.find(
        (entry) =>
          entry.direction === "received" &&
          frameOf(entry) &&
          entry.at >= send.at &&
          entry.frame[3] === "action_result" &&
          entry.frame[4]?.status === "accepted",
      ) ??
      null,
    60_000,
    `${label}:action_result`,
  );
  await sleep(600);
  return {
    artifact_id: artifactId,
    button: chosen,
    send: frameBody(send),
    receipt: frameBody(receipt),
    at: nowIso(),
  };
}

async function runScenario(config, scenario) {
  const label = scenario.id;
  const { message, turnId, runId } = await sendAuthorInput(scenario.input, label);
  const { turnResult, finalKind, questions } = await waitScenarioTurn(turnId, scenario, label);
  const pending = pendingOf(turnResult);
  let adoption = null;
  if (scenario.adopt && pending.length > 0 && String(turnResult.status ?? "") !== "failed") {
    adoption = await harness.runStep("adoption", `adopt:${label}`, () =>
      adoptPending(pending[0], label),
    );
    await sleep(800);
  }
  harness.capture(`${label}-after`);
  runEvidenceMode(EVIDENCE, "capture", dir, [label]);

  const firstPending = pending[0] ?? null;
  const assistantText = String(turnResult?.assistant_message?.text ?? "");
  const turnStatus = String(turnResult?.status ?? "");
  const outcomeKind =
    turnStatus === "failed"
      ? "guarded_rejection"
      : firstPending
        ? "candidate"
        : nonEmptyText(assistantText)
          ? "reply"
          : "turn_result";

  return {
    id: label,
    kind: scenario.kind,
    input: scenario.input,
    turn_id: turnId,
    message_at: message.at,
    questions,
    assistant_text: assistantText,
    turn_status: turnResult?.status ?? null,
    final_kind: finalKind,
    outcome_kind: outcomeKind,
    run_id: runId,
    judgment_events: runJudgmentEvents(harness.transport(), turnId),
    frame_type: turnResult?.frame_summary?.frame_type ?? null,
    pending_count: pending.length,
    pending: pending.map((entry) => ({
      artifact_id: entry.artifact_id ?? null,
      object_kind: entry.payload?.object_kind ?? entry.payload?.artifact_type ?? null,
      item_count: entry.payload?.item_count ?? entry.payload?.items?.length ?? null,
    })),
    pending_payload: firstPending
      ? {
          artifact_id: firstPending.artifact_id ?? null,
          artifact_type: firstPending.artifact_type ?? firstPending.payload?.artifact_type ?? null,
          object_kind: firstPending.payload?.object_kind ?? null,
          modification_scope: firstPending.payload?.modification_scope ?? firstPending.payload?.scope?.modification_scope ?? null,
          adoption_effect: firstPending.payload?.adoption_effect ?? null,
          target_chapter_ref: firstPending.payload?.target_chapter_ref ?? firstPending.target_chapter_ref ?? null,
          item_count: firstPending.payload?.item_count ?? firstPending.payload?.items?.length ?? null,
        }
      : null,
    adoption,
    captured_at: nowIso(),
  };
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim() !== "";
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
  await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, "initial");
  harness.capture("01-workbench");
  runEvidenceMode(EVIDENCE, "capture", dir, ["start"]);

  const results = [];
  try {
    for (const scenario of config.scenarios) {
      harness.log.push({ op: "scenario_start", id: scenario.id, at: nowIso() });
      const result = await runScenario(config, scenario);
      results.push(result);
      harness.log.push({
        op: "scenario_done",
        id: scenario.id,
        at: nowIso(),
        turn_id: result.turn_id,
        pending_count: result.pending_count,
        adopted: Boolean(result.adoption),
      });
    }
    // 采纳后的刷新/重开消费者：关闭并重新启动原生应用，回到同一作品后再落 final 快照。
    await harness.runStep("restore", "close_relaunch_after_adoptions", () => harness.rawCloseAppAndRelaunch());
    await harness.runStep("maintenance", "workbench_ready:final", () =>
      harness.rawWaitWorkbenchSettled("final"),
    );
    await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, "final");
    harness.capture("02-final");
    runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);
    harness.writeDriverLog("b28-scope-native-driver-log.json", {
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
      `B28-SCOPE CP3 原生驱动完成: scenarios=${results.map((result) => result.id).join(",")} ` +
        `screenshots=${harness.screenshots.length} strata_unloaded=${after.unloaded}`,
    );
  } catch (error) {
    try {
      harness.writeDriverLog("b28-scope-native-driver-log.json", {
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
