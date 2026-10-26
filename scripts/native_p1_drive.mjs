// P1 原生实模 scoped 创作旅程外部驱动：用 macOS AX/CGEvent 操作真实 Tauri 窗口
// （原生 macOS 窗口 + 真实 Phoenix 后端 + 真嵌入式前端 + 真实 Strata iq3_s），
// 完成 NEXT 要求的「原生创作/维护/恢复/导出」四项能力 scoped 旅程。
// 产品代码不读取本文件；驱动只用用户可见语义（按钮/标签/输入框/页面文本/目录对话框）操作真实窗口。
// 用法：node scripts/native_p1_drive.mjs <batch-run-dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  CUA,
  Step,
  activate,
  appPid,
  click,
  clickAt,
  dump,
  dumpAll,
  pressKey,
  readJson,
  screenshot,
  sleep,
  textOf,
  typeText,
  writeAX,
} from "./lib/native_ui/driver.mjs";
import { flatText, writeUiComplete } from "./lib/native_ui/workbench.mjs";
import { cleanupNativeApp } from "./lib/native_app_ownership.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_p1_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const ready = readJson(path.join(dir, "native-driver-ready.json"));
const APP = ready.bundle_identifier;
if (ready.provider !== "strata") throw new Error(`P1 真实模型批次 provider 必须是 strata，实测: ${ready.provider}`);
const EVIDENCE = path.join(ROOT, "scripts/native_p1_evidence.mjs");
const DB_FILE = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
const step = new Step(dir);
const screenshots = [];
const captures = [];
const log = [];
const authorQuestionEvents = [];
let currentPhase = "init";
let failing = false;

// 分型预算（B37 strata）：input120/turn360/candidate300/adoption180/maintenance300/restore30；
// 驱动内部 polling 上限略低于监督预算，超预算即 fail-fast（监督也会兜底）。
const TURN_TIMEOUT = 330_000;
const CANDIDATE_TIMEOUT = 280_000;

const nowIso = () => new Date().toISOString();
const writeJson = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));

function supervisorFailure() {
  const file = path.join(dir, "failure.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { reason: "failure_json_unreadable" };
  }
}

function checkSupervisor() {
  const failure = supervisorFailure();
  if (failure && !failing) {
    failing = true;
    throw new Error(`supervisor_failed:${failure.reason ?? failure.phase ?? "unknown"}`);
  }
}

// 每个分型等待只允许单层 begin/finish（B37 等待账拒绝嵌套）。
async function runStep(kind, label, fn) {
  checkSupervisor();
  currentPhase = `${kind}:${label}`;
  log.push({ op: "step_begin", kind, label, at: nowIso() });
  step.begin(kind, label);
  try {
    return await fn();
  } catch (error) {
    log.push({ op: "step_failed", kind, label, at: nowIso(), error: error.message });
    throw error;
  } finally {
    step.finish();
    log.push({ op: "step_end", kind, label, at: nowIso() });
  }
}

// ── AX 读取/等待 ─────────────────────────────────────────────────────────────
const AX_MAX_NODES = 16000;

function dumpNodes() {
  return dump(APP, AX_MAX_NODES);
}

function dumpAllNodes(maxNodes = 16000) {
  return dumpAll(APP, maxNodes);
}

const axText = (nodes) => flatText(nodes);
const matchText = (text, pattern) => (typeof pattern === "string" ? text.includes(pattern) : pattern.test(text));

async function pollAx(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    checkSupervisor();
    let nodes = null;
    try {
      nodes = dumpNodes();
    } catch {
      await sleep(600);
      continue;
    }
    lastText = axText(nodes);
    if (predicate(lastText, nodes)) return { nodes, text: lastText };
    await sleep(600);
  }
  throw new Error(`wait_ax_timeout:${label}:${lastText.slice(-500)}`);
}

async function tryPollAx(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkSupervisor();
    try {
      const nodes = dumpNodes();
      const text = axText(nodes);
      if (predicate(text, nodes)) return { nodes, text };
    } catch {
      /* window temporarily unavailable */
    }
    await sleep(600);
  }
  return null;
}

async function pollAllNodes(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    checkSupervisor();
    try {
      const nodes = dumpAllNodes();
      last = nodes;
      if (predicate(axText(nodes), nodes)) return { nodes, text: axText(nodes) };
    } catch {
      /* panel race */
    }
    await sleep(500);
  }
  throw new Error(`wait_all_nodes_timeout:${label}:${axText(last).slice(-400)}`);
}

// ── 证据采集 ────────────────────────────────────────────────────────────────
// 窗口截图偶发失败（macOS screencapture 在窗口动画/切换期间报 could not create image from
// window，b30 原生批次同现象）：窗口级重试后仍失败则整屏兜底；AX 树/可见文本仍是主证据，
// 截图 flake 不中断整条真实工作台链路（flakes 全部记录在 driver log）。
function screenshotSafe(filePath) {
  const errors = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      screenshot(APP, filePath);
      return { ok: true, method: "window", attempt, errors };
    } catch (error) {
      errors.push(String(error.message ?? error));
      log.push({ op: "screenshot_retry", file: path.basename(filePath), attempt, error: String(error.message ?? error) });
      activate(APP);
      try {
        execFileSync("sleep", ["0.9"]);
      } catch {
        /* sleep best effort */
      }
    }
  }
  try {
    execFileSync("screencapture", ["-x", "-t", "jpg", filePath], { stdio: "ignore" });
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      log.push({ op: "screenshot_fullscreen_fallback", file: path.basename(filePath), errors });
      return { ok: true, method: "fullscreen_fallback", attempt: 4, errors };
    }
  } catch (error) {
    errors.push(String(error.message ?? error));
  }
  log.push({ op: "screenshot_missing", file: path.basename(filePath), errors });
  return { ok: false, method: null, attempt: 4, errors };
}

function writeAllNodesAX(nodes, filePath) {
  const lines = [`Window-All: "${APP}"`];
  for (const node of nodes) {
    const bits = [];
    if (node.role) bits.push(node.role);
    if (node.title) bits.push(node.title);
    if (node.desc && node.desc !== node.title) bits.push(`Description: ${node.desc}`);
    if (node.value) bits.push(`Value: ${node.value}`);
    lines.push(`${"\t".repeat(Math.min(node.depth ?? 0, 12))}${bits.join(", ")}`);
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

async function capture(name, { allNodes = false } = {}) {
  checkSupervisor();
  let nodes;
  if (allNodes) {
    nodes = dumpAllNodes();
    writeAllNodesAX(nodes, path.join(dir, `${name}.ax.txt`));
  } else {
    nodes = dumpNodes();
    writeAX(nodes, path.join(dir, `${name}.ax.txt`), APP);
  }
  fs.writeFileSync(path.join(dir, `${name}.text.txt`), axText(nodes));
  const shot = screenshotSafe(path.join(dir, `${name}.jpg`));
  if (shot.ok) screenshots.push(`${name}.jpg`);
  captures.push({ name, at: nowIso(), nodes: nodes.length, screenshot: shot.method ?? null });
  log.push({ op: "capture", name, at: nowIso(), nodes: nodes.length, screenshot: shot.method ?? null });
  return nodes;
}

function evidence(mode, extra) {
  checkSupervisor();
  execFileSync("node", [EVIDENCE, mode, dir, ...(extra ? [extra] : [])], { cwd: ROOT, stdio: "inherit" });
}

// ── 传输帧等待（外部 WS/HTTP 代理采证，非产品验收钩子）──────────────────────────
function transport() {
  const file = path.join(dir, "native-transport.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.includes("{"))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
}

async function pollWire(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkSupervisor();
    const hit = predicate(transport());
    if (hit) return hit;
    await sleep(300);
  }
  throw new Error(`wait_wire_timeout:${label}`);
}

async function tryPollWire(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkSupervisor();
    const hit = predicate(transport());
    if (hit) return hit;
    await sleep(300);
  }
  return null;
}

const frameOf = (record) => (Array.isArray(record?.frame) && record.frame.length >= 5 ? record.frame : null);
const frameEvent = (record) => frameOf(record)?.[3] ?? null;
const frameBody = (record) => frameOf(record)?.[4] ?? null;

function sentUserMessageSince(wire, sinceIso, text) {
  return (
    wire.find(
      (entry) =>
        entry.direction === "sent" &&
        frameOf(entry) &&
        entry.at >= sinceIso &&
        entry.frame[3] === "user_message" &&
        String(entry.frame[4]?.text ?? "") === text,
    ) ?? null
  );
}

function ackFor(wire, messageRecord) {
  const turnId = String(frameBody(messageRecord)?.turn_id ?? "");
  return (
    wire.find(
      (entry) =>
        entry.direction === "received" &&
        frameOf(entry) &&
        entry.at >= messageRecord.at &&
        entry.frame[1] === messageRecord.frame[1] &&
        entry.frame[3] === "phx_reply" &&
        entry.frame[4]?.status === "ok" &&
        entry.frame[4]?.response?.turn_id === turnId,
    ) ?? null
  );
}

function turnResultsFor(wire, turnId, sinceIso) {
  return wire.filter(
    (entry) =>
      entry.direction === "received" &&
      frameOf(entry) &&
      entry.at > sinceIso &&
      entry.frame[3] === "turn_result" &&
      String(entry.frame[4]?.turn_id ?? "").startsWith(turnId),
  );
}

// ── 高层工作台动作（函数本身不 begin/finish；调用方用 runStep 包一层）──────────────
function safeClick(node, label) {
  if (!node) throw new Error(`click_target_missing:${label}`);
  const mouseFallback = (reason) => {
    if (!Array.isArray(node.frame) || node.frame.length < 4) {
      throw new Error(`click_failed:${label}:${reason}:no_frame`);
    }
    clickAt(APP, node.frame[0] + node.frame[2] / 2, node.frame[1] + node.frame[3] / 2);
    return { ok: true, method: "mouse", label, fallback_from: reason };
  };
  try {
    const result = click(node, APP);
    if (result && result.ok === false) return mouseFallback("axpress_rejected");
    return { ...result, label };
  } catch (error) {
    return mouseFallback(error.message);
  }
}

const isVisibleNode = (node) =>
  Array.isArray(node.frame) && node.frame[1] > 0 && node.frame[2] > 0 && node.frame[3] > 0;

function findButton(nodes, matcher, { afterIndex = -1 } = {}) {
  const labelOf = (node) => String(node.title || node.value || "");
  const matches = [];
  for (let index = afterIndex + 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.role !== "AXButton") continue;
    const label = labelOf(node);
    const hit =
      typeof matcher === "string"
        ? label === matcher
        : typeof matcher === "function"
          ? matcher(label)
          : matcher.test(label);
    if (hit) matches.push(node);
  }
  if (matches.length === 0) return null;
  const visible = matches.filter(isVisibleNode);
  return (visible.length ? visible : matches).at(-1);
}

function findAnyButton(nodes, titles) {
  for (const title of titles) {
    const node = findButton(nodes, (value) => value === title);
    if (node) return node;
  }
  return null;
}

const lastIndexWhere = (nodes, predicate) => {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (predicate(nodes[index])) return index;
  }
  return -1;
};

function visibleWorkTitle(nodes) {
  const trigger = nodes.find((node) => node.role === "AXPopUpButton" && String(node.desc ?? "") === "作品");
  return trigger?.title ?? null;
}

function findComposer(nodes) {
  return nodes.find((node) => node.role === "AXTextField" && String(node.desc ?? "").includes("输入")) ?? null;
}

async function rawLaunchApp() {
  execFileSync("open", [ready.app_path]);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    checkSupervisor();
    if (appPid(APP)) break;
    await sleep(400);
  }
  if (!appPid(APP)) throw new Error("native_app_did_not_launch");
  activate(APP);
}

async function rawWaitWorkbench(label, timeoutMs = 175_000) {
  return pollAx(
    (_text, nodes) =>
      nodes.some((node) => node.role === "AXWebArea") &&
      nodes.some((node) => node.role === "AXTextField" && String(node.desc ?? "").includes("输入")) &&
      nodes.some((node) => node.role === "AXButton" && node.title === "发送"),
    timeoutMs,
    `workbench_ready:${label}`,
  );
}

async function rawSwitchWork(title, label) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let nodes = dumpNodes();
    if (visibleWorkTitle(nodes) === title) return nodes;
    const trigger = nodes.find((node) => node.role === "AXPopUpButton" && String(node.desc ?? "") === "作品");
    if (!trigger) throw new Error("work_menu_trigger_not_found");
    if (Array.isArray(trigger.frame) && trigger.frame.length >= 4) {
      clickAt(APP, trigger.frame[0] + trigger.frame[2] / 2, trigger.frame[1] + trigger.frame[3] / 2);
    } else {
      safeClick(trigger, `${label}:menu-open:${attempt}`);
    }
    await sleep(900);
    nodes = dumpNodes();
    if (attempt === 1) {
      writeAX(nodes, path.join(dir, `${label}-work-menu.ax.txt`), APP);
      fs.writeFileSync(path.join(dir, `${label}-work-menu.text.txt`), axText(nodes));
    }
    const item =
      nodes.find((node) => node.role === "AXMenuItem" && node.title === title) ??
      nodes.find((node) => node.role === "AXMenuItem" && textOf(node).includes(title));
    if (!item) {
      pressKey(APP, "escape");
      await sleep(400);
      continue;
    }
    if (Array.isArray(item.frame) && item.frame.length >= 4) {
      clickAt(APP, item.frame[0] + item.frame[2] / 2, item.frame[1] + item.frame[3] / 2);
    } else {
      safeClick(item, `${label}:menuitem`);
    }
    const switched = await pollAx((_text, current) => visibleWorkTitle(current) === title, 40_000, `${label}:switched`);
    await tryPollAx((text) => /同步已连接|已连接/u.test(text), 60_000);
    return switched.nodes;
  }
  throw new Error(`work_switch_failed:${title}`);
}

function markWorkNewest(workId) {
  execFileSync(
    "python3",
    [
      "-c",
      [
        "import sqlite3,sys,datetime",
        "db=sqlite3.connect(sys.argv[1], timeout=10)",
        "ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'",
        "db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2]))",
        "db.commit(); db.close()",
      ].join("\n"),
      DB_FILE,
      workId,
    ],
    { stdio: "ignore" },
  );
}

async function rawCloseAppAndRelaunch() {
  const oldPid = appPid(APP);
  const cleanup = await cleanupNativeApp(dir);
  await sleep(500);
  execFileSync("open", [ready.app_path]);
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    checkSupervisor();
    if (appPid(APP)) break;
    await sleep(300);
  }
  const newPid = appPid(APP);
  if (!newPid) throw new Error("native_app_did_not_relaunch");
  activate(APP);
  const entry = { op: "restore", label: "real_restart", at: nowIso(), old_pid: oldPid, new_pid: newPid, cleanup };
  log.push(entry);
  writeJson("p1-native-restore.json", entry);
  return entry;
}

async function rawWaitInputReady(label) {
  const result = await pollAx(
    (_text, nodes) => {
      const composer = findComposer(nodes);
      const send = nodes.find((node) => node.role === "AXButton" && node.title === "发送");
      return Boolean(composer) && Boolean(send);
    },
    60_000,
    `input_ready:${label}`,
  );
  await sleep(700);
  return result;
}

function rawClickSend(nodes) {
  const button = findButton(nodes, (value) => value === "发送");
  if (button) safeClick(button, "send-button");
  else pressKey(APP, "return");
}

async function rawTypeAndSend(text, label) {
  checkSupervisor();
  const startedAt = nowIso();
  let nodes = dumpNodes();
  let composer = findComposer(nodes);
  if (!composer) throw new Error(`composer_not_found:${label}`);
  safeClick(composer, `${label}:composer`);
  await sleep(350);
  if (String(composer.value ?? "").trim() !== "") {
    pressKey(APP, "cmd+a");
    pressKey(APP, "delete");
    await sleep(200);
  }
  typeText(APP, text);
  await sleep(700);
  nodes = dumpNodes();
  composer = findComposer(nodes);
  const typedValue = String(composer?.value ?? "");
  if (typedValue.trim() !== "" && !typedValue.includes(text.slice(0, 3))) {
    // CGEvent 偶发丢字：仅在 AX 读到非空且确实不含预期文本时重试一次；最终以 user_message 帧文本严格核对。
    safeClick(composer, `${label}:composer-retry`);
    await sleep(250);
    pressKey(APP, "cmd+a");
    pressKey(APP, "delete");
    await sleep(200);
    typeText(APP, text);
    await sleep(600);
    nodes = dumpNodes();
  }
  rawClickSend(nodes);
  let sent = await tryPollWire((wire) => sentUserMessageSince(wire, startedAt, text), 10_000);
  if (!sent) {
    await sleep(400);
    rawClickSend(dumpNodes());
    sent = await pollWire((wire) => sentUserMessageSince(wire, startedAt, text), 15_000, `${label}:user_message_sent`);
  }
  return sent;
}

// ── 真实模型作者问答（B37 CP5 语义）：options 推荐项优先；free-text 给作者默认决策；≤2 次不同回复 ──
const AUTHOR_QUESTION_LIMIT = 2;

function authorQuestionDefault(kind) {
  switch (kind) {
    case "chapter_write":
    case "continuation":
      return "先按当前章节计划继续写，保持人物与情节一致，细节由你定，不要问我。";
    case "maintenance":
    case "format_revision":
      return "只调整第01章：底层灵气账单的正文分段和排版，不要改字句。";
    default:
      return "先按当前章节计划继续写，保持人物与情节一致。";
  }
}

function contextKindOf(label) {
  if (label.startsWith("T1")) return "chapter_write";
  if (label.startsWith("T2")) return "maintenance";
  if (label.startsWith("T3")) return "continuation";
  return "generic";
}

async function rawRespondToAuthorQuestion(label, body, question) {
  const actions = (body.available_actions ?? []).filter(
    (action) => action.action_type === "author_choice" && action.question_ref === question.question_ref,
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
    const nodes = dumpNodes();
    const button =
      findButton(nodes, (value) => value === recommended.label) ??
      (choiceAction ? findButton(nodes, (value) => value === choiceAction.label) : null);
    if (!button) throw new Error(`author_question_option_button_not_found:${label}:${recommended.label}`);
    safeClick(button, `${label}:author-choice`);
    chosenLabel = recommended.label;
  } else {
    const nodes = dumpNodes();
    const entry =
      (choiceAction ? findButton(nodes, (value) => value === choiceAction.label) : null) ??
      findButton(nodes, /回复此问题/);
    if (!entry) throw new Error(`author_question_reply_entry_not_found:${label}`);
    safeClick(entry, `${label}:reply-entry`);
    await sleep(900);
    const questionNodes = dumpNodes();
    const textarea = questionNodes.find((node) => node.role === "AXTextArea");
    if (!textarea) throw new Error(`author_question_textarea_not_found:${label}`);
    safeClick(textarea, `${label}:reply-textarea`);
    await sleep(250);
    replyText = authorQuestionDefault(contextKindOf(label));
    typeText(APP, replyText);
    await sleep(500);
    const sendNodes = dumpNodes();
    const sendReply = findButton(sendNodes, (value) => value === "发送回复");
    if (!sendReply) throw new Error(`author_question_send_button_not_found:${label}`);
    safeClick(sendReply, `${label}:send-reply`);
  }
  const action = await pollWire(
    (wire) =>
      wire.find(
        (entry) =>
          entry.direction === "sent" &&
          frameOf(entry) &&
          entry.at >= startedAt &&
          entry.frame[3] === "author_action" &&
          (entry.frame[4]?.action?.action_type === "author_choice" ||
            String(entry.frame[4]?.action?.payload?.question_ref ?? "") === question.question_ref),
      ) ?? null,
    60_000,
    `${label}:author_question_action`,
  );
  const event = {
    label,
    at: nowIso(),
    question: question.question,
    question_ref: question.question_ref,
    options: options.map((option) => ({ label: option.label, kind: option.kind ?? null, recommended: Boolean(option.recommended) })),
    chosen_option: chosenLabel,
    free_text_reply: replyText,
    response_kind: chosenLabel ? "choice" : "free_text",
    action_type: action.frame[4]?.action?.action_type ?? null,
    question_action_ref: action.frame[4]?.action?.payload?.question_ref ?? null,
    source_turn_ref: action.frame[4]?.action?.source_turn_ref ?? null,
  };
  authorQuestionEvents.push(event);
  writeJson("author_question_events.json", authorQuestionEvents);
  log.push({ op: "author_question", label, at: nowIso(), response_kind: event.response_kind, chosen: chosenLabel, question: question.question });
}

// ── 主输入 → 回执 → turn_result（含作者问答循环）────────────────────────────────────
async function sendTurn(id, text) {
  const message = await runStep("input", `input:${id}`, () => rawTypeAndSend(text, id));
  const turnId = String(frameBody(message)?.turn_id ?? "");
  if (!turnId) throw new Error(`user_message_without_turn:${id}`);
  await runStep("ack", `ack:${id}`, () => pollWire((wire) => ackFor(wire, message), 30_000, `${id}:ack`));
  let since = message.at;
  let questions = 0;
  while (true) {
    const record = await runStep("turn", `turn:${id}:w${questions}`, () =>
      pollWire(
        (wire) => {
          const candidates = turnResultsFor(wire, turnId, since);
          return candidates.find((entry) => {
            const body = frameOf(entry)[4];
            if (body.author_question?.question) return true;
            if ((body.adoption_state?.pending ?? []).length > 0) return true;
            if (body.truthfulness?.artifact_adopted === true) return true;
            if (String(body.status ?? "") === "failed" || String(body.agent_run?.status ?? "") === "failed") return true;
            return false;
          }) ?? null;
        },
        TURN_TIMEOUT,
        `${id}:turn_result`,
      ),
    );
    since = record.at;
    const body = frameBody(record);
    const question = body.author_question;
    if (question?.question && question.status !== "answered" && question.status !== "closed") {
      if (questions >= AUTHOR_QUESTION_LIMIT) throw new Error(`author_question_reply_limit:${id}`);
      const duplicate = authorQuestionEvents.some(
        (event) => event.question_ref === question.question_ref && event.label === id,
      );
      if (duplicate) throw new Error(`author_question_repeated_without_progress:${id}:${question.question_ref}`);
      await runStep("maintenance", `author_question:${id}:${questions + 1}`, () =>
        rawRespondToAuthorQuestion(id, body, question),
      );
      questions += 1;
      await sleep(800);
      continue;
    }
    if ((body.adoption_state?.pending ?? []).length > 0) {
      if (questions > 0) log.push({ op: "turn_after_questions", id, questions, turn_id: turnId });
      return { message, turnId, result: body, questions };
    }
    const agentStatus = String(body.agent_run?.status ?? "");
    const phase = String(body.phase ?? "");
    if (String(body.status ?? "") === "failed" || agentStatus === "failed") {
      throw new Error(
        `turn_failed:${id}:status=${body.status}:phase=${phase}:assistant=${String(body.assistant_message?.text ?? "").slice(0, 400)}`,
      );
    }
    // 已回答问题的回声 / run 仍在执行：非终局，继续等后续 turn_result（同一 turn）。
    if (question || agentStatus === "running" || phase === "running") {
      log.push({ op: "turn_non_terminal_continue", id, turn_id: turnId, status: body.status ?? null, phase, agent_status: agentStatus || null });
      await sleep(800);
      continue;
    }
    const textOut = String(body.assistant_message?.text ?? "");
    throw new Error(
      `no_candidate:${id}:status=${body.status}:phase=${phase}:assistant=${textOut.slice(0, 400)}`,
    );
  }
}

function pendingOf(turn) {
  return turn?.result?.adoption_state?.pending ?? [];
}

function requirePending(turn, artifactTypes, label) {
  const pending = pendingOf(turn).find((entry) => artifactTypes.includes(entry.artifact_type));
  if (!pending) {
    throw new Error(`candidate_missing:${label}:${artifactTypes.join(",")}(pending=${pendingOf(turn).map((entry) => entry.artifact_type).join(",") || "none"})`);
  }
  return pending;
}

// ── 候选卡可见 → 原生采纳（含 needs_confirmation 二次确认）──────────────────────────
async function waitCandidateButton(labels, label) {
  // 候选可见是独立分型等待（B37 wait ledger 必须记 candidate）：等待期计入监督预算与心跳。
  return runStep("candidate", `candidate:${label}`, () =>
    pollAx(
      (_text, nodes) => labels.some((title) => Boolean(findButton(nodes, (value) => value === title))),
      CANDIDATE_TIMEOUT,
      `candidate:${label}:${labels.join("/")}`,
    ),
  );
}

function receiptMatchesArtifact(body, artifactId) {
  if (!body || typeof body !== "object") return false;
  const decision = body.decision ?? {};
  return (
    body.artifact_id === artifactId ||
    body.target_ref === artifactId ||
    decision.candidate_ref === artifactId ||
    decision.target_ref === `artifact:${artifactId}` ||
    decision.target_ref === artifactId
  );
}

async function rawAdoptCandidate(artifactId, labels, label) {
  const startedAt = nowIso();
  // 采纳分型监督预算 180s：本函数内部各步共享同一个 deadline，避免串行等待叠加越过监督预算。
  const adoptDeadline = Date.now() + 168_000;
  const remaining = (max) => Math.max(3_000, Math.min(max, adoptDeadline - Date.now()));
  const nodes = dumpNodes();
  const button = findAnyButton(nodes, labels);
  if (!button) throw new Error(`adopt_button_not_found:${label}:${labels.join("/")}`);
  const findAdoptSend = (wire) =>
    wire.find(
      (entry) =>
        entry.direction === "sent" &&
        frameOf(entry) &&
        entry.at >= startedAt &&
        entry.frame[3] === "author_action" &&
        entry.frame[4]?.action?.target_ref === artifactId &&
        ["accept", "adopt", "confirm_adoption"].includes(String(entry.frame[4]?.action?.action_type)),
    ) ?? null;
  safeClick(button, `${label}:adopt`);
  let send = await tryPollWire(findAdoptSend, remaining(15_000));
  if (!send) {
    await sleep(500);
    const retry = findAnyButton(dumpNodes(), labels);
    if (retry) safeClick(retry, `${label}:adopt-retry`);
    send = await pollWire(findAdoptSend, remaining(30_000), `${label}:author_action_sent`);
  }
  const action = send.frame[4].action;
  // 采纳结果：accepted 或 needs_confirmation（元泄漏/覆盖确认），确认后再次 accepted。
  const outcome = await pollWire(
    (wire) => {
      const results = wire.filter(
        (entry) =>
          entry.direction === "received" &&
          frameOf(entry) &&
          entry.at >= send.at &&
          entry.frame[3] === "action_result" &&
          (receiptMatchesArtifact(entry.frame[4], artifactId) ||
            entry.frame[4]?.action_id === action.action_id),
      );
      const accepted = results.find((entry) => entry.frame[4]?.status === "accepted");
      if (accepted) return { kind: "accepted", record: accepted };
      const confirmation = results.find((entry) => entry.frame[4]?.status === "needs_confirmation");
      if (confirmation) return { kind: "confirmation", record: confirmation };
      const failed = results.find((entry) =>
        ["failed", "rejected", "error"].includes(String(entry.frame[4]?.status ?? "")),
      );
      if (failed) return { kind: "failed", record: failed };
      return null;
    },
    remaining(90_000),
    `${label}:action_result`,
  );
  if (outcome.kind === "failed") {
    throw new Error(`adoption_failed:${label}:${JSON.stringify(outcome.record.frame[4]).slice(0, 500)}`);
  }
  let receiptRecord = outcome.record;
  if (outcome.kind === "confirmation") {
    log.push({ op: "adoption_confirmation_required", label, at: nowIso(), reason_codes: outcome.record.frame[4]?.decision?.reason_codes ?? null });
    const confirmButton = await pollAx(
      (_text, current) => Boolean(findButton(current, (value) => value === "确认执行")),
      remaining(30_000),
      `${label}:confirm_button`,
    );
    safeClick(findButton(confirmButton.nodes, (value) => value === "确认执行"), `${label}:confirm`);
    const confirmedSend = await pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "sent" &&
            frameOf(entry) &&
            entry.at >= outcome.record.at &&
            entry.frame[3] === "author_action",
        ) ?? null,
      remaining(30_000),
      `${label}:confirm_action_sent`,
    );
    receiptRecord = await pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            frameOf(entry) &&
            entry.at >= confirmedSend.at &&
            entry.frame[3] === "action_result" &&
            entry.frame[4]?.status === "accepted",
        ) ?? null,
      remaining(60_000),
      `${label}:confirmed_action_result`,
    );
  }
  const receipt = receiptRecord.frame[4];
  // 采纳后产品广播 resolved turn_result（truthfulness.artifact_adopted / resolved 含候选）。
  const resolved = await tryPollWire(
    (wire) =>
      wire.find(
        (entry) =>
          entry.direction === "received" &&
          frameOf(entry) &&
          entry.at >= send.at &&
          entry.frame[3] === "turn_result" &&
          ((entry.frame[4]?.adoption_state?.resolved ?? []).some((item) => item.artifact_id === artifactId) ||
            (entry.frame[4]?.truthfulness?.artifact_adopted === true &&
              (entry.frame[4]?.adoption_state?.resolved ?? []).some((item) => item.artifact_id === artifactId))),
      ) ?? null,
    remaining(30_000),
  );
  await sleep(500);
  return { send: send.frame[4], action, receipt, resolved };
}

// ── 只读 DB 等待（外部证据核对，不写产品库）───────────────────────────────────
function dbChapterAcceptedContent(chapterId) {
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT d.content, d.id FROM drafts d JOIN scenes s ON s.id = d.scene_id WHERE s.chapter_id = ? AND d.status = 'ACCEPTED' ORDER BY s.seq, d.revision",
      )
      .all(chapterId);
    return rows.map((row) => String(row.content ?? "")).filter(Boolean).join("\n\n");
  } finally {
    db.close();
  }
}

async function waitDbAccepted(chapterId, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    checkSupervisor();
    try {
      last = dbChapterAcceptedContent(chapterId);
      if (predicate(last)) return last;
    } catch {
      /* DB busy during write: retry */
    }
    await sleep(500);
  }
  throw new Error(`db_wait_timeout:${label}:current=${last.slice(0, 200)}`);
}

// ── 阅读模式 ────────────────────────────────────────────────────────────────
function chapterProbe(content) {
  const lines = String(content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 8);
  return lines[0]?.slice(0, 30) ?? "";
}

async function rawOpenReading(chapterTitle, probe, label) {
  const nodes = dumpNodes();
  const button = findButton(nodes, (value) => value === "阅读");
  if (!button) throw new Error(`reading_button_not_found:${label}`);
  safeClick(button, `${label}:reading`);
  const opened = await pollAx((text) => text.includes("阅读模式"), 60_000, `${label}:reading_open`);
  if (probe && !opened.text.includes(probe)) {
    const current = dumpNodes();
    const tocEntry = current.find(
      (node) => (node.title === chapterTitle || node.value === chapterTitle) && isVisibleNode(node),
    );
    if (tocEntry) {
      safeClick(tocEntry, `${label}:toc-chapter`);
      await pollAx((text) => text.includes(probe), 45_000, `${label}:chapter_content`);
    }
  }
  return pollAx((text) => text.includes("阅读模式") && (!probe || text.includes(probe)), 45_000, `${label}:reading_ready`);
}

async function rawCloseReading(label) {
  const nodes = dumpNodes();
  const button = findButton(nodes, (value) => value === "返回工作台");
  if (!button) throw new Error(`reading_back_button_not_found:${label}`);
  safeClick(button, `${label}:back`);
  return pollAx(
    (_text, current) => current.some((node) => node.role === "AXTextField" && String(node.desc ?? "").includes("输入")),
    45_000,
    `${label}:workbench`,
  );
}

// ── 导出：真实 macOS 目录选择对话框 + 磁盘文件证据 ─────────────────────────────
// 真实产品入口是 Tauri plugin-dialog 的目录选择器（NSOpenPanel 以 AXSheet 形式挂在主窗口）。
// 原生驱动必须在真实面板里切换到目标目录再点 Open/选择；不能用旁路 export_dir 直接提交。
const CHOOSE_BUTTON = /^(Open|选择|选取|打开|Select)$/i;
const CANCEL_BUTTON = /^(Cancel|取消)$/i;
const PANEL_MARKER = /选择导出目录|请选择保存导出文件的文件夹|New Folder|Cancel|Open/;

function cuaCommand(args) {
  try {
    return JSON.parse(execFileSync(CUA, args, { encoding: "utf8" }).trim());
  } catch (error) {
    return { error: String(error.message ?? error) };
  }
}

function writeDialogEvidence(name, nodes) {
  writeAllNodesAX(nodes, path.join(dir, `${name}.ax.txt`));
  fs.writeFileSync(path.join(dir, `${name}.text.txt`), axText(nodes));
}

// Cmd+Shift+G 打开「前往文件夹」；AX 设置+聚焦路径输入框 → Return 导航；随后用面板可见文本验证已到达目标目录。
async function navigatePanelToDirectory(exportDir) {
  const baseName = path.basename(exportDir);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    pressKey(APP, "cmd+shift+g");
    await sleep(1_000);
    let nodes = dumpNodes();
    if (nodes.filter((node) => node.role === "AXSheet").length < 2) {
      log.push({ op: "export_goto_sheet_missing", attempt, sheets: nodes.filter((node) => node.role === "AXSheet").length });
      pressKey(APP, "escape");
      await sleep(500);
      continue;
    }
    // 「前往文件夹」输入框：sheet 内最后一个 AXTextField（预填当前目录，selected）。
    const field = nodes.filter((node) => node.role === "AXTextField").at(-1);
    if (!field?.path) {
      log.push({ op: "export_goto_field_missing", attempt });
      pressKey(APP, "escape");
      await sleep(500);
      continue;
    }
    const setResult = cuaCommand(["set", APP, field.path, exportDir]);
    const focusResult = cuaCommand(["focus", APP, field.path]);
    log.push({ op: "export_goto_set", attempt, field_path: field.path, set: setResult, focus: focusResult });
    await sleep(300);
    pressKey(APP, "return");
    await sleep(1_500);
    nodes = dumpNodes();
    const sheetCount = nodes.filter((node) => node.role === "AXSheet").length;
    const whereNow =
      (nodes.find((node) => node.role === "AXPopUpButton" && String(node.desc ?? "").includes("Where")) ?? {}).value ?? null;
    const hasDir = axText(nodes).includes(baseName);
    log.push({ op: "export_navigation_check", attempt, sheets: sheetCount, has_dir: hasDir, where: whereNow });
    if (hasDir) return nodes;
    if (sheetCount > 1) {
      pressKey(APP, "escape");
      await sleep(500);
    }
  }
  return null;
}

async function rawExportToDirectory(exportDir) {
  const baseName = path.basename(exportDir);
  const nodes = dumpNodes();
  const button = findButton(nodes, (value) => value === "导出全书");
  if (!button) throw new Error("export_button_not_found");
  safeClick(button, "export:click");
  const panel = await pollAx(
    (_text, current) => current.some((node) => node.role === "AXSheet") && PANEL_MARKER.test(flatText(current)),
    15_000,
    "export:directory_panel",
  );
  log.push({ op: "export_panel_visible", at: nowIso(), nodes: panel.nodes.length });
  // 证据：真实 macOS 目录选择面板 AX 树/截图（导航前）。
  const panelDump = dumpAllNodes(20000);
  writeAllNodesAX(panelDump, path.join(dir, "T4-export-dialog.ax.txt"));
  fs.writeFileSync(path.join(dir, "T4-export-dialog.text.txt"), axText(panelDump));
  const dialogShot = screenshotSafe(path.join(dir, "T4-export-dialog.jpg"));
  if (dialogShot.ok) screenshots.push("T4-export-dialog.jpg");
  captures.push({ name: "T4-export-dialog", at: nowIso(), nodes: panelDump.length, screenshot: dialogShot.method ?? null });

  const navigated = await navigatePanelToDirectory(exportDir);
  if (!navigated) {
    // 无法在真实面板中确认目标目录：取消面板并 fail-fast，绝不在其它目录落下未声明导出。
    const cancelNodes = dumpNodes();
    const cancel = cancelNodes.find(
      (node) => node.role === "AXButton" && CANCEL_BUTTON.test(String(node.title || node.value || "").trim()),
    );
    if (cancel) safeClick(cancel, "export:cancel");
    throw new Error(`export_dialog_location_unverified:${baseName}`);
  }
  writeDialogEvidence("T4-export-dialog-navigated", dumpAllNodes(20000));

  const openNodes = dumpNodes();
  const open = openNodes
    .filter((node) => node.role === "AXButton" && CHOOSE_BUTTON.test(String(node.title || node.value || "").trim()))
    .filter(isVisibleNode)
    .at(-1) ?? openNodes.filter((node) => node.role === "AXButton" && CHOOSE_BUTTON.test(String(node.title || node.value || "").trim())).at(-1);
  if (!open) throw new Error("export_panel_open_button_missing");
  safeClick(open, "export:open");
  return pollAx((text) => /已导出到|导出失败：/.test(text), 20_000, "export:result");
}

// ── 日志/收尾 ───────────────────────────────────────────────────────────────
function driverLogPayload(extra = {}) {
  return {
    slice_id: "p1-chapter-draft-generation",
    provider: "strata",
    model: "iq3_s",
    driver: "ax-native-system-ui",
    scope: "scoped_native_creation_maintenance_restore_export",
    finished_at: nowIso(),
    captures: log,
    author_question_events: authorQuestionEvents,
    screenshots,
    restore: log.filter((entry) => entry.op === "restore"),
    export: extra.export ?? null,
    error: extra.error ?? null,
  };
}

async function unloadModelOrFail() {
  evidence("unload");
  const lifecycle = readJson(path.join(dir, "model-lifecycle-after.json"));
  if (!lifecycle.unload_verified_loaded_null) {
    throw new Error(`model_unload_verified_loaded_null_failed:${JSON.stringify(lifecycle.strata_control ?? {}).slice(0, 300)}`);
  }
  return lifecycle;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function run() {
  evidence("prepare");
  const config = readJson(path.join(dir, "p1-native-config.json"));
  writeJson("author_question_events.json", authorQuestionEvents);
  const workTitle = config.work_title;
  const chapterTitle = config.chapter_title;
  const chapterId = config.chapter_id;

  // 启动真实原生应用并进入 seed 作品。
  await runStep("maintenance", "launch_app", rawLaunchApp);
  await runStep("maintenance", "workbench_ready:initial", () => rawWaitWorkbench("initial"));
  let nodes = dumpNodes();
  if (visibleWorkTitle(nodes) !== workTitle) {
    try {
      nodes = await runStep("maintenance", "switch_work:initial", () => rawSwitchWork(workTitle, "initial"));
    } catch (error) {
      log.push({ op: "work_menu_failed", label: "initial", error: error.message });
      markWorkNewest(config.seed.work_id);
      await runStep("restore", "restore:initial_fallback", () => rawCloseAppAndRelaunch());
      await runStep("maintenance", "workbench_ready:fallback", () => rawWaitWorkbench("initial:fallback"));
      nodes = dumpNodes();
      if (visibleWorkTitle(nodes) !== workTitle) {
        nodes = await runStep("maintenance", "switch_work:initial", () => rawSwitchWork(workTitle, "initial"));
      }
    }
  }
  await sleep(1_200);
  activate(APP);
  await capture("T0-workbench");
  evidence("capture", "t1-before");

  // ── T1 创作：真实主输入 → 真实模型 judgment/候选 → 可见候选卡采纳 → DB accepted + 阅读可见 ──
  const t1 = await sendTurn("T1", config.inputs.t1);
  const t1Pending = requirePending(t1, ["prose_fragment", "scene_draft"], "T1");
  log.push({ op: "t1_pending", artifact_id: t1Pending.artifact_id, artifact_type: t1Pending.artifact_type, title: t1Pending.title ?? null });
  await waitCandidateButton(["保存为章节正文", "保存原稿", "保存修订稿"], "T1");
  await capture("T1-candidate");
  const t1Adoption = await runStep("adoption", "adopt:T1", () =>
    rawAdoptCandidate(t1Pending.artifact_id, ["保存为章节正文", "保存原稿", "保存修订稿"], "T1"),
  );
  const t1CandidateBody = String(t1Pending.payload?.items?.[0]?.body ?? "");
  const t1DbContent = await waitDbAccepted(chapterId, (content) => content.length > 200, "t1:db_accepted");
  log.push({ op: "t1_adoption", artifact_id: t1Pending.artifact_id, action_type: t1Adoption.action.action_type, receipt_status: t1Adoption.receipt?.status, resolved: Boolean(t1Adoption.resolved), db_chars: t1DbContent.length, candidate_chars: t1CandidateBody.length });
  await capture("T1-receipt");
  await runStep("maintenance", "reading_open:T1", () => rawOpenReading(chapterTitle, chapterProbe(t1DbContent), "T1"));
  await capture("T1-reading");
  await runStep("maintenance", "reading_close:T1", () => rawCloseReading("T1"));
  await runStep("maintenance", "input_ready:T2", () => rawWaitInputReady("T2"));
  evidence("capture", "t1-after");
  evidence("capture", "t2-before");

  // ── T2 维护：真实主输入仅排版修订 → 分段方案候选 → 「应用分段方案」→ 非换行字节不变 ──
  const t2 = await sendTurn("T2", config.inputs.t2);
  const t2Pending = requirePending(t2, ["prose_formatting_plan", "prose_fragment", "scene_draft"], "T2");
  log.push({ op: "t2_pending", artifact_id: t2Pending.artifact_id, artifact_type: t2Pending.artifact_type, title: t2Pending.title ?? null, modification_scope: t2Pending.payload?.modification_scope ?? t2Pending.payload?.scope?.modification_scope ?? null });
  await waitCandidateButton(["应用分段方案", "保存修订稿", "保存原稿", "保存为章节正文"], "T2");
  await capture("T2-candidate");
  const t2Adoption = await runStep("adoption", "adopt:T2", () =>
    rawAdoptCandidate(t2Pending.artifact_id, ["应用分段方案", "保存修订稿", "保存原稿", "保存为章节正文"], "T2"),
  );
  const t2Preview = String(t2Pending.payload?.formatting_preview ?? "");
  const t2AfterContent = await waitDbAccepted(chapterId, (content) => content !== t1DbContent, "t2:db_formatted");
  log.push({ op: "t2_adoption", artifact_id: t2Pending.artifact_id, action_type: t2Adoption.action.action_type, receipt_status: t2Adoption.receipt?.status, resolved: Boolean(t2Adoption.resolved), before_chars: t1DbContent.length, after_chars: t2AfterContent.length, preview_chars: t2Preview.length });
  await capture("T2-receipt");
  await runStep("maintenance", "reading_open:T2", () => rawOpenReading(chapterTitle, chapterProbe(t2AfterContent), "T2"));
  await capture("T2-reading");
  await runStep("maintenance", "reading_close:T2", () => rawCloseReading("T2"));
  await runStep("maintenance", "input_ready:T3", () => rawWaitInputReady("T3"));
  evidence("capture", "t2-after");
  evidence("capture", "t3-before-restore");

  // ── T3 恢复：真实关闭原生应用并重开 → 作品/会话/已采纳正文/阅读恢复 ─────────────
  await runStep("restore", "restore:T3", () => rawCloseAppAndRelaunch());
  await runStep("maintenance", "workbench_ready:T3", () => rawWaitWorkbench("T3:restored"));
  await tryPollAx((text) => /同步已连接|已连接/u.test(text), 90_000);
  nodes = dumpNodes();
  if (visibleWorkTitle(nodes) !== workTitle) {
    nodes = await runStep("maintenance", "switch_work:T3", () => rawSwitchWork(workTitle, "T3:restored"));
  }
  // 会话/历史恢复以 DB 快照 + 阅读投影为准；工作台可见性核对作品标题与主输入框（AX 文本仅记录，不强断言历史全文）。
  const restoredTranscript = await tryPollAx(
    (text) => text.includes(config.inputs.t1) || text.includes(config.inputs.t2),
    20_000,
  );
  log.push({ op: "restored_transcript_visible", at: nowIso(), visible: Boolean(restoredTranscript) });
  await capture("T3-restored-workbench");
  await runStep("maintenance", "reading_open:T3r", () =>
    rawOpenReading(chapterTitle, chapterProbe(t2AfterContent), "T3-restored"),
  );
  await capture("T3-restored-reading");
  await runStep("maintenance", "reading_close:T3r", () => rawCloseReading("T3-restored"));
  await runStep("maintenance", "input_ready:T3c", () => rawWaitInputReady("T3:continuation"));
  evidence("capture", "t3-after-restore");

  // ── T3 续写：真实主输入接续 → 候选 → 采纳 → 同章追加 ─────────────────────────
  const t3 = await sendTurn("T3", config.inputs.t3);
  const t3Pending = requirePending(t3, ["prose_fragment", "scene_draft"], "T3");
  log.push({ op: "t3_pending", artifact_id: t3Pending.artifact_id, artifact_type: t3Pending.artifact_type, title: t3Pending.title ?? null });
  await waitCandidateButton(["保存为章节正文", "保存原稿", "保存修订稿"], "T3");
  await capture("T3-candidate");
  const t3Adoption = await runStep("adoption", "adopt:T3", () =>
    rawAdoptCandidate(t3Pending.artifact_id, ["保存为章节正文", "保存原稿", "保存修订稿"], "T3"),
  );
  const t3AfterContent = await waitDbAccepted(chapterId, (content) => content.length > t2AfterContent.length, "t3:db_continued");
  log.push({ op: "t3_adoption", artifact_id: t3Pending.artifact_id, action_type: t3Adoption.action.action_type, receipt_status: t3Adoption.receipt?.status, resolved: Boolean(t3Adoption.resolved), before_chars: t2AfterContent.length, after_chars: t3AfterContent.length });
  await capture("T3-receipt");
  await runStep("maintenance", "reading_open:T3", () => rawOpenReading(chapterTitle, chapterProbe(t3AfterContent), "T3"));
  await capture("T3-reading");
  await runStep("maintenance", "reading_close:T3", () => rawCloseReading("T3"));
  await runStep("maintenance", "input_ready:T4", () => rawWaitInputReady("T4"));
  evidence("capture", "t3-after");

  // ── T4 导出：阅读模式「导出全书」→ 真实 macOS 目录对话框 → 磁盘文件 → 回工作台 ─────
  await runStep("maintenance", "reading_open:T4", () => rawOpenReading(chapterTitle, chapterProbe(t3AfterContent), "T4"));
  await capture("T4-reading");
  const exportResult = await runStep("export", "export:T4", () =>
    rawExportToDirectory(config.export_dir),
  );
  await capture("T4-export-success");
  const successText = fs.readFileSync(path.join(dir, "T4-export-success.text.txt"), "utf8");
  const exportMatch = /已导出到\s+([^\n]+\.md)/.exec(successText);
  const exportPath = exportMatch ? exportMatch[1].trim() : null;
  if (!exportPath) throw new Error(`export_path_not_visible:${successText.slice(-400)}`);
  if (!fs.existsSync(exportPath)) throw new Error(`export_file_missing:${exportPath}`);
  const exportRoot = path.resolve(config.export_dir);
  if (!path.resolve(exportPath).startsWith(exportRoot + path.sep)) {
    throw new Error(`export_path_outside_selected_dir:${exportPath}:expected_under:${exportRoot}`);
  }
  const exportSize = fs.statSync(exportPath).size;
  log.push({ op: "export_file", at: nowIso(), path: exportPath, size_bytes: exportSize, export_step: exportResult ? "ok" : "unknown" });
  // 关闭导出结果弹窗 → 返回工作台（会话可继续）。
  await runStep("maintenance", "export_close:T4", async () => {
    const current = dumpNodes();
    const close = findButton(current, (value) => value === "关闭");
    if (close) safeClick(close, "export:close");
    await sleep(700);
    return dumpNodes();
  });
  await runStep("maintenance", "back_to_workbench:T4", () => rawCloseReading("T4"));
  await capture("T4-back-workbench");
  await capture("T4-final");
  evidence("capture", "final");

  // 真实模型收尾：卸载并验证 loaded=null，再写 native-ui-complete（监督只认完成文件）。
  const lifecycleAfter = await unloadModelOrFail();
  const payload = driverLogPayload({
    export: { path: exportPath, size_bytes: exportSize, export_dir: config.export_dir },
  });
  writeJson("p1-native-driver-log.json", payload);
  writeUiComplete(dir, {
    runRef: ready.run_ref,
    screenshots,
    driver: "ax-native-system-ui",
    scope: "p1-chapter-draft-generation",
  });
  console.log(
    `P1 原生实模 scoped 旅程完成: screenshots=${screenshots.length} questions=${authorQuestionEvents.length} export=${exportPath} (${exportSize}B) unloaded=${lifecycleAfter.strata_control?.loaded === null}`,
  );
}

run().catch(async (error) => {
  failing = true;
  try {
    const nodes = dumpNodes();
    writeAX(nodes, path.join(dir, "failure.ax.txt"), APP);
    fs.writeFileSync(path.join(dir, "failure.text.txt"), axText(nodes));
    screenshotSafe(path.join(dir, "failure.jpg"));
  } catch {
    /* app may be gone */
  }
  // 首要失败原因只写一次（监督可能已写入外部失败原因，不覆盖）。
  if (!fs.existsSync(path.join(dir, "failure.json"))) {
    fs.writeFileSync(
      path.join(dir, "failure.json"),
      JSON.stringify(
        {
          at: nowIso(),
          phase: currentPhase,
          slice_id: "p1-chapter-draft-generation",
          provider: "strata",
          model: "iq3_s",
          driver: "ax-native-system-ui",
          reason: error.message,
          stack: String(error.stack ?? "").split("\n").slice(0, 8),
          captures,
          log_tail: log.slice(-16),
        },
        null,
        2,
      ),
    );
  }
  // 失败/中断也必须卸载真实模型并保留生命周期证据（不覆盖首因）。
  // 例外：跑前 Strata 已载有非本批模型（作者保留实例）时中止，且不得卸载它。
  if (String(error.message ?? "").includes("preflight_strata_model_loaded")) {
    try {
      writeJson("model-lifecycle-after.json", {
        at: nowIso(),
        skipped: "preflight_model_not_owned_by_this_batch",
        reason: error.message,
        unload_verified_loaded_null: false,
        lms_ps: null,
      });
      log.push({ op: "model_unload_skipped_preexisting_instance", at: nowIso(), reason: error.message });
    } catch {
      /* logging best effort */
    }
  } else try {
    const lifecycle = await unloadModelOrFail();
    log.push({ op: "model_unloaded_after_failure", at: nowIso(), loaded: lifecycle.strata_control?.loaded ?? null });
  } catch (unloadError) {
    log.push({ op: "model_unload_failed_after_failure", at: nowIso(), error: unloadError.message });
  }
  try {
    writeJson("p1-native-driver-log.json", driverLogPayload({ error: error.message }));
    if (!fs.existsSync(path.join(dir, "author_question_events.json"))) {
      writeJson("author_question_events.json", authorQuestionEvents);
    }
  } catch {
    /* logging best effort */
  }
  console.error(error);
  process.exitCode = 1;
});
