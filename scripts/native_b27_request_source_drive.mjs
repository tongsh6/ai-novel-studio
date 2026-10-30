// B27 §9 CP3：外部原生 Tauri + 真实模型 M1/M2 驱动（产品零感知）。
// 用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生窗口 + Phoenix + 嵌入式前端），
// 只读采集 provider 请求字节/app-log/WS 帧/DB，记录模型生命周期（strata 单槽、结束 unload 核验）。
// 用法：node scripts/native_b27_request_source_drive.mjs <batch-run-dir>
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
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b27_request_source_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const harness = new NativeScenarioHarness(dir);
const ACK_TIMEOUT = 60_000;
const TURN_TIMEOUT = 360_000;
const AUTHOR_REPLY_LIMIT = 2;
const questionEvents = [];
const WORK_TITLE = "B27 Request Source Work";
const STRATA_ENDPOINT = process.env.NOVEL_STRATA_ENDPOINT ?? "http://127.0.0.1:47831/v1";
const EVIDENCE = path.join(ROOT, "scripts/native_b27_request_source_evidence.mjs");

const scenario = {
  id: "M1",
  input:
    "我之前确认过的设定里，林瑶失踪和哪里有关？请先查一下你实际能看到的记忆材料再回答；如果确实没有依据，就如实说未知，不要编造。",
};
const scenarioM2 = { id: "M2", input: "现在写到第几章了？" };

const nowIso = () => new Date().toISOString();
const writeJson = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
const frameBodyOf = (record) => frameBody(record);
const strataBase = (endpoint) => String(endpoint ?? "").replace(/\/v1\/?$/, "");

async function strataState() {
  try {
    const response = await fetch(`${strataBase(STRATA_ENDPOINT)}/api/models`);
    if (!response.ok) return { error: `http_${response.status}` };
    const body = await response.json();
    return { mode: body.mode ?? null, current: body.current ?? null, loaded: body.loaded ?? null };
  } catch (error) {
    return { error: error.message };
  }
}

function lifecycleRecord(state) {
  return {
    at: nowIso(),
    provider: "strata",
    endpoint: STRATA_ENDPOINT,
    lms_ps: execFileSync("lms", ["ps"], { encoding: "utf8" }).slice(0, 2000),
    ...state,
  };
}

async function writeModelBefore() {
  const state = await strataState();
  const record = lifecycleRecord({ loaded_before: state.loaded ?? null, current_before: state.current ?? null, state_before: state });
  writeJson("model-lifecycle-before.json", record);
  return record;
}

async function cleanupStrata(stage) {
  let unloadError = null;
  try {
    await fetch(`${strataBase(STRATA_ENDPOINT)}/api/models/unload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch (error) {
    unloadError = error.message;
  }
  await sleep(1500);
  const state = await strataState();
  const after = lifecycleRecord({
    stage,
    loaded: state.loaded ?? null,
    current: state.current ?? null,
    loaded_after: state.loaded ?? null,
    unloaded: state.loaded === null && !state.error,
    unload_error: unloadError,
    state_after: state,
  });
  writeJson("model-lifecycle-after.json", after);
  return after;
}

function findTurnResult(wire, turnId) {
  return (
    wire.find(
      (entry) =>
        entry.direction === "received" &&
        Array.isArray(entry.frame) &&
        entry.frame.length >= 5 &&
        entry.frame[3] === "turn_result" &&
        (String(entry.frame[4]?.turn_id ?? "") === turnId ||
          String(entry.frame[4]?.turn_id ?? "").startsWith(`${turnId}:`)),
    ) ?? null
  );
}

function runJudgmentEvents(wire, turnId) {
  const runIds = wire
    .filter(
      (entry) =>
        entry.direction === "received" &&
        frameOf(entry) &&
        entry.frame[3] === "agent_run_state" &&
        String(entry.frame[4]?.parent_turn_ref ?? "") === turnId,
    )
    .map((entry) => String(entry.frame[4]?.run_id ?? ""));
  return wire
    .filter(
      (entry) =>
        entry.direction === "received" &&
        frameOf(entry) &&
        entry.frame[3] === "agent_event" &&
        String(entry.frame[4]?.event_type ?? "") === "judgment_decided" &&
        (runIds.includes(String(entry.frame[4]?.run_id ?? "")) ||
          String(entry.frame[4]?.parent_turn_ref ?? "") === turnId),
    )
    .map((entry) => ({
      action: entry.frame[4]?.payload?.action ?? null,
      capability: entry.frame[4]?.payload?.capability ?? null,
      reason_codes: entry.frame[4]?.reason_codes ?? [],
    }));
}

async function sendAuthorInput(text, label) {
  await harness.runStep("maintenance", `input_ready:${label}`, () => harness.rawWaitInputReady(label));
  const message = await harness.runStep("input", `type_send:${label}`, () => harness.rawTypeAndSend(text, label));
  const turnId = String(frameBodyOf(message)?.turn_id ?? "");
  if (!turnId) throw new Error(`user_message_without_turn_id:${label}`);
  if (String(frameBodyOf(message)?.text ?? "") !== text) throw new Error(`user_message_text_mismatch:${label}`);
  const ack = await harness.runStep("ack", `ack:${label}`, () =>
    harness.pollWire((wire) => harness.ackFor(wire, message), ACK_TIMEOUT, `ack:${label}`),
  );
  return { turnId, runId: String(ack?.frame?.[4]?.response?.run_id ?? "") };
}

function findButtonByText(nodes, predicate) {
  return (
    nodes
      .filter(
        (node) =>
          node.role === "AXButton" &&
          (predicate(String(node.title ?? "")) || predicate(String(node.value ?? "")) || predicate(textOf(node))) &&
          Array.isArray(node.frame) &&
          node.frame[1] > 0,
      )
      .at(-1) ?? null
  );
}

async function answerAuthorQuestion(label, body, question) {
  const options = question.options ?? [];
  const choice = options.find((option) => option.recommended) ?? options.find((option) => option.kind !== "free_text");
  if (choice) {
    const nodes = harness.dumpNodes();
    const button = findButtonByText(nodes, (value) => value === choice.label);
    if (button) {
      harness.safeClick(button, `${label}:question-choice`);
      questionEvents.push({ label, at: nowIso(), question: question.question, response_kind: "choice", choice: choice.label });
      writeJson("author_question_events.json", questionEvents);
      await sleep(800);
      return;
    }
  }
  const nodes = harness.dumpNodes();
  const entry = findButtonByText(nodes, (value) => value.includes("回复此问题") || value.includes("回复"));
  if (!entry) throw new Error(`author_question_reply_entry_not_found:${label}`);
  harness.safeClick(entry, `${label}:reply-entry`);
  await sleep(900);
  const textarea = harness.dumpNodes().find((node) => node.role === "AXTextArea");
  if (!textarea) throw new Error(`author_question_textarea_not_found:${label}`);
  harness.safeClick(textarea, `${label}:reply-textarea`);
  await sleep(250);
  const reply =
    "先按你当前实际可见的材料回答；记忆里的设定如果没有出现在本次请求里，就先按需查一下记忆；查不到就如实说未知，不要编造。";
  typeText(harness.APP, reply);
  await sleep(400);
  const send = findButtonByText(harness.dumpNodes(), (value) => value === "发送回复");
  if (!send) throw new Error(`author_question_send_button_not_found:${label}`);
  harness.safeClick(send, `${label}:send-reply`);
  questionEvents.push({ label, at: nowIso(), question: question.question, response_kind: "free_text", reply });
  writeJson("author_question_events.json", questionEvents);
  await sleep(800);
}

async function waitTurn(turnId, label) {
  let questions = 0;
  for (;;) {
    const found = await harness.runStep("turn", `turn_result:${label}:${questions}`, () =>
      harness.pollWire(
        (wire) => {
          const record = findTurnResult(wire, turnId);
          if (!record) return null;
          const body = record.frame[4] ?? {};
          const question = body.author_question;
          if (question?.question && question.status !== "answered" && question.status !== "closed") {
            return { kind: "author_question", record };
          }
          if (String(body.status ?? "") === "failed") return { kind: "turn_result", record };
          if (String(body.assistant_message?.text ?? "").trim() !== "") return { kind: "turn_result", record };
          return null;
        },
        TURN_TIMEOUT,
        `${label}:turn_outcome`,
      ),
    );
    if (found.kind === "turn_result") return { turnResult: found.record.frame[4] ?? {}, questions };
    if (questions >= AUTHOR_REPLY_LIMIT) throw new Error(`author_question_reply_limit:${label}`);
    await harness.runStep("maintenance", `author_question:${label}:${questions + 1}`, () =>
      answerAuthorQuestion(label, found.record.frame[4] ?? {}, found.record.frame[4]?.author_question),
    );
    questions += 1;
    await sleep(800);
  }
}

async function runScenario(current, label) {
  harness.log.push({ op: "scenario_start", id: current.id, at: nowIso() });
  const { turnId, runId } = await sendAuthorInput(current.input, label);
  const { turnResult, questions } = await waitTurn(turnId, label);
  harness.capture(`${label}-after`);
  const whyText = await harness.runStep("maintenance", `why:${label}`, async () => {
    await harness.rawOpenWhy(label);
    const text = harness.axText(harness.dumpNodes());
    harness.capture(`${label}-why`);
    pressKey(harness.APP, "escape");
    await sleep(400);
    return text;
  });
  const result = {
    id: current.id,
    input: current.input,
    turn_id: turnId,
    run_id: runId,
    questions,
    turn_status: turnResult?.status ?? null,
    assistant_text: String(turnResult?.assistant_message?.text ?? ""),
    judgment_events: runJudgmentEvents(harness.transport(), turnId),
    why_text: whyText,
    reply_record: turnResult?.reply_record ?? null,
    why: turnResult?.why ?? null,
    pending_count: (turnResult?.adoption_state?.pending ?? []).length,
    captured_at: nowIso(),
  };
  harness.log.push({ op: "scenario_done", id: current.id, turn_id: turnId, questions, pending_count: result.pending_count });
  return result;
}

async function main() {
  const config = {
    slice_id: "b27-request-source-native",
    provider: "strata",
    model: "iq3_s",
    strata_endpoint: STRATA_ENDPOINT,
    work_title: WORK_TITLE,
    scenario_order: [scenario.id, scenarioM2.id],
  };
  writeJson("native-b27-config.json", config);
  const before = await writeModelBefore();

  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () => harness.rawWaitWorkbenchSettled("initial"));
  await ensureWorkSelected(harness, null, WORK_TITLE, "initial");
  harness.capture("01-workbench");

  const results = [];
  try {
    results.push(await runScenario(scenario, "M1"));
    results.push(await runScenario(scenarioM2, "M2"));
  } finally {
    const after = await cleanupStrata("final");
    harness.writeDriverLog("b27-request-source-native-driver-log.json", {
      ...config,
      scenarios: results,
      author_question_events: questionEvents,
      model_lifecycle_before: before,
      model_lifecycle_after: after,
      transport_frames: harness.transport().length,
    });
    harness.writeUiComplete("b27-request-source-native");
  }
  console.log(`[b27-native] scenarios=${results.length} questions=${questionEvents.length}`);
}

main().catch((error) => {
  writeJson("failure.json", { at: nowIso(), reason: String(error?.message ?? error) });
  cleanupStrata("failure").finally(() => {
    try {
      harness.writeUiComplete("b27-request-source-native");
    } catch {
      /* supervisor already failed */
    }
    console.error(error);
    process.exit(1);
  });
});
