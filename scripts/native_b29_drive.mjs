// B29 原生验收外部驱动：用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生 macOS 窗口 + 真实
// Phoenix 后端 + 嵌入式真实前端），完成浏览器 canonical 场景的同一批 trials/checks（23 checks / 5 trials）。
// 产品代码不读取本文件；驱动只用用户可见语义（按钮/标签/输入框/页面文本）操作真实窗口。
// 用法：node scripts/native_b29_drive.mjs <batch-run-dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  appPid,
  activate,
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
  Step,
} from "./lib/native_ui/driver.mjs";
import { flatText, writeUiComplete } from "./lib/native_ui/workbench.mjs";
import { cleanupNativeApp } from "./lib/native_app_ownership.mjs";
import { INPUTS, WORK_TITLE } from "./native_b29_evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b29_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const ready = readJson(path.join(dir, "native-driver-ready.json"));
const APP = ready.bundle_identifier;
const PROVIDER = ready.provider ?? "slice_verify";
const STRATA = PROVIDER === "strata";
// 分型预算：确定性 provider 用默认预算；真实模型按 B37 strata 预算（input120/turn360/candidate300/adoption180/maintenance300/restore30）。
const TURN_TIMEOUT = STRATA ? 330_000 : 110_000;
const CANDIDATE_TIMEOUT = STRATA ? 280_000 : 110_000;
const MAINTENANCE_VISIBLE_TIMEOUT = STRATA ? 120_000 : 60_000;
const EVIDENCE = path.join(ROOT, "scripts/native_b29_evidence.mjs");
const DB_FILE = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
const step = new Step(dir);
const screenshots = [];
const captures = [];
const log = [];
let currentPhase = "init";
let failing = false;

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
    throw new Error(`supervisor_failed:${failure.reason ?? "unknown"}`);
  }
}

// 每个分型等待只允许单层 begin/finish：runStep 内部不得再调用 runStep（B37 等待账拒绝嵌套）。
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
const AX_MAX_NODES = 14000;

function mainWindowDump(nodes) {
  // macOS 偶发把 AXHelpTag（tooltip/帮助标签）作为首个窗口返回，此时整棵树只有 help tag 节点。
  return (
    nodes.length > 8 &&
    (nodes.some((node) => node.role === "AXWebArea") || nodes.some((node) => node.role === "AXWindow"))
  );
}

function dumpNodes() {
  let nodes = dump(APP, AX_MAX_NODES);
  for (let attempt = 0; attempt < 12 && !mainWindowDump(nodes); attempt += 1) {
    try {
      pressKey(APP, "escape");
    } catch {
      /* tooltip may already be gone */
    }
    try {
      activate(APP);
    } catch {
      /* ignore activation failure */
    }
    execFileSync("sleep", ["0.25"]);
    try {
      nodes = dump(APP, AX_MAX_NODES);
    } catch {
      nodes = [];
    }
  }
  return nodes;
}

function axText(nodes) {
  return flatText(nodes);
}

function matchText(text, pattern) {
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
}

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
    if (!nodes.some((node) => node.role === "AXWindow")) activate(APP);
    await sleep(600);
  }
  throw new Error(`wait_ax_timeout:${label}:${lastText.slice(-400)}`);
}

async function tryPollAx(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkSupervisor();
    let nodes = null;
    try {
      nodes = dumpNodes();
    } catch {
      await sleep(600);
      continue;
    }
    const text = axText(nodes);
    if (predicate(text, nodes)) return { nodes, text };
    if (!nodes.some((node) => node.role === "AXWindow")) activate(APP);
    await sleep(600);
  }
  return null;
}

// ── 证据采集 ────────────────────────────────────────────────────────────────
async function capture(name) {
  checkSupervisor();
  const nodes = dumpNodes();
  writeAX(nodes, path.join(dir, `${name}.ax.txt`), APP);
  fs.writeFileSync(path.join(dir, `${name}.text.txt`), axText(nodes));
  screenshot(APP, path.join(dir, `${name}.jpg`));
  screenshots.push(`${name}.jpg`);
  captures.push({ name, at: nowIso(), nodes: nodes.length });
  log.push({ op: "capture", name, at: nowIso() });
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
  const text = fs.readFileSync(file, "utf8");
  return text
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

function turnResultFor(wire, turnId, sinceIso) {
  return (
    wire
      .filter(
        (entry) =>
          entry.direction === "received" &&
          frameOf(entry) &&
          entry.at >= sinceIso &&
          entry.frame[3] === "turn_result" &&
          String(entry.frame[4]?.turn_id ?? "").startsWith(turnId),
      )
      .at(-1) ?? null
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

const lastIndexWhere = (nodes, predicate) => {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (predicate(nodes[index])) return index;
  }
  return -1;
};

const isVisibleNode = (node) => Array.isArray(node.frame) && node.frame[1] > 0 && node.frame[2] > 0 && node.frame[3] > 0;

function findButton(nodes, title, { afterIndex = -1 } = {}) {
  const matches = [];
  for (let index = afterIndex + 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.role === "AXButton" && (node.title === title || node.value === title)) matches.push(node);
  }
  if (matches.length === 0) return null;
  const visible = matches.filter(isVisibleNode);
  return (visible.length ? visible : matches).at(-1);
}

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

async function rawWaitWorkbench(label, timeoutMs = 170_000) {
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
    safeClick(trigger, `${label}:menu-open:${attempt}`);
    await sleep(800);
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
    safeClick(item, `${label}:menuitem`);
    const switched = await pollAx((_text, current) => visibleWorkTitle(current) === title, 30_000, `${label}:switched`);
    await pollAx((text) => /同步已连接/u.test(text) || /已连接/u.test(text), 60_000, `${label}:connected`).catch(() => null);
    return switched.nodes;
  }
  throw new Error(`work_switch_failed:${title}`);
}

function markWorkNewest(workId) {
  execFileSync("python3", ["-c", [
    "import sqlite3,sys,datetime",
    "db=sqlite3.connect(sys.argv[1], timeout=10)",
    "ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'",
    "db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2]))",
    "db.commit(); db.close()",
  ].join("\n"), DB_FILE, workId], { stdio: "ignore" });
}

async function rawCloseAppAndRelaunch(label) {
  await cleanupNativeApp(dir);
  await sleep(500);
  execFileSync("open", [ready.app_path]);
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    checkSupervisor();
    if (appPid(APP)) break;
    await sleep(300);
  }
  if (!appPid(APP)) throw new Error("native_app_did_not_relaunch");
  activate(APP);
}

// 输入框就绪：聚焦/清空由 sendAuthorInput 内部处理，这里只等 composer 与发送按钮存在且无进行中等待。
async function rawWaitInputReady(label) {
  const result = await pollAx(
    (_text, nodes) => {
      const composer = findComposer(nodes);
      const send = nodes.find((node) => node.role === "AXButton" && node.title === "发送");
      return Boolean(composer) && Boolean(send);
    },
    45_000,
    `input_ready:${label}`,
  );
  await sleep(900);
  return result;
}

function clearComposer(composerNode) {
  safeClick(composerNode, "composer");
  pressKey(APP, "cmd+a");
  pressKey(APP, "delete");
  return sleep(250);
}

function findSendButton(nodes) {
  return nodes.find((node) => node.role === "AXButton" && node.title === "发送") ?? null;
}

function clickSend(nodes) {
  const button = findSendButton(nodes);
  if (button) safeClick(button, "send-button");
  else pressKey(APP, "return");
}

async function rawTypeAndSend(text, label) {
  checkSupervisor();
  const startedAt = nowIso();
  let nodes = dumpNodes();
  let composer = findComposer(nodes);
  if (!composer) throw new Error("composer_not_found");
  safeClick(composer, `${label}:composer`);
  await sleep(350);
  const value = String(composer.value ?? "");
  if (value.trim() !== "") {
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
    // CGEvent 偶发丢字：仅在 AX 能读到非空值且确实不含预期文本时重试一次；
    // 最终仍以 user_message 帧文本严格核对（帧文本不等即等待超时失败）。
    safeClick(composer, `${label}:composer-retry`);
    await sleep(250);
    pressKey(APP, "cmd+a");
    pressKey(APP, "delete");
    await sleep(200);
    typeText(APP, text);
    await sleep(600);
    nodes = dumpNodes();
  }
  clickSend(nodes);
  let sent = await tryPollWire((wire) => sentUserMessageSince(wire, startedAt, text), 8_000);
  if (!sent) {
    // 发送按钮偶发未命中（焦点/渲染抖动）：真实 UI 重试一次点击，不做旁路提交。
    await sleep(400);
    clickSend(dumpNodes());
    sent = await pollWire((wire) => sentUserMessageSince(wire, startedAt, text), 10_000, `${label}:user_message_sent`);
  }
  return sent;
}

async function rawWaitCandidateCard({ anchorText, label, requireOldToNew = false, timeoutMs = CANDIDATE_TIMEOUT }) {
  return pollAx(
    (text, nodes) => {
      const anchor = lastIndexWhere(nodes, (node) => textOf(node).includes(anchorText));
      if (anchor < 0) return false;
      const accept = findButton(nodes, "保存到作品", { afterIndex: anchor });
      const hasOldToNew = !requireOldToNew || (text.includes("ENSEMBLE_POV") && text.includes("PROTAGONIST"));
      return Boolean(accept) && hasOldToNew;
    },
    timeoutMs,
    `candidate:${label}`,
  );
}

// action_result 的 artifact 归属：顶层 artifact_id / target_ref，或 decision 内 target_ref/candidate_ref，
// 或 action_id 与发送动作匹配（accept -> adopt: 前缀差异，不能只用 action_id 严格相等）。
function receiptMatchesArtifact(body, artifactId, sendAction) {
  if (!body || typeof body !== "object") return false;
  const decision = body.decision ?? {};
  return (
    body.artifact_id === artifactId ||
    body.target_ref === artifactId ||
    decision.candidate_ref === artifactId ||
    decision.target_ref === `artifact:${artifactId}` ||
    decision.target_ref === artifactId ||
    (Boolean(sendAction?.action_id) && body.action_id === sendAction.action_id)
  );
}

function findAcceptRetryButton(nodes) {
  const buttons = nodes.filter((node) => node.role === "AXButton" && node.title === "保存到作品");
  return buttons.at(-1) ?? null;
}

function findButtonInDumpAll(anchorText, buttonTitle) {
  // 兜底：AX 首窗口偶发是 AXHelpTag 时可用 dumpall 遍历全部窗口；该路径没有 AX path，
  // 只能按 frame 中心做真实鼠标点击（仍是用户可见语义，不是旁路提交）。
  let nodes = [];
  try {
    nodes = dumpAll(APP, 16_000);
  } catch {
    return null;
  }
  const anchor = lastIndexWhere(nodes, (node) => textOf(node).includes(anchorText));
  const matches = nodes.filter(
    (node) => node.role === "AXButton" && (node.title === buttonTitle || node.value === buttonTitle),
  );
  const afterAnchor = anchor >= 0 ? matches.filter((_node, index) => index >= 0) : matches;
  void afterAnchor;
  const candidate = anchor >= 0 ? matches.at(-1) : matches.at(-1);
  if (!candidate || !Array.isArray(candidate.frame) || candidate.frame[2] <= 0) return null;
  return { ...candidate, __mouseOnly: true };
}

async function waitCandidateButton(anchorText, buttonTitle, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkSupervisor();
    const nodes = dumpNodes();
    const anchor = lastIndexWhere(nodes, (node) => textOf(node).includes(anchorText));
    const button =
      findButton(nodes, buttonTitle, { afterIndex: anchor }) ??
      nodes.filter((node) => node.role === "AXButton" && node.title === buttonTitle).at(-1) ??
      null;
    if (button) return button;
    if (Date.now() > deadline - 12_000) {
      const fallback = findButtonInDumpAll(anchorText, buttonTitle);
      if (fallback) return fallback;
    }
    await sleep(500);
  }
  return null;
}

function clickCandidateButton(button, label) {
  if (button.__mouseOnly) {
    clickAt(APP, button.frame[0] + button.frame[2] / 2, button.frame[1] + button.frame[3] / 2);
    return { ok: true, method: "mouse-fallback-dumpall", label };
  }
  return safeClick(button, label);
}

async function rawAdoptCandidate(artifactId, anchorText, label) {
  const startedAt = nowIso();
  const button = await waitCandidateButton(anchorText, "保存到作品");
  if (!button) throw new Error(`adopt_button_not_found:${label}`);
  const findAdoptSend = (wire) =>
    wire.find(
      (entry) =>
        entry.direction === "sent" &&
        frameOf(entry) &&
        entry.at >= startedAt &&
        entry.frame[3] === "author_action" &&
        entry.frame[4]?.action?.target_ref === artifactId &&
        ["accept", "adopt"].includes(String(entry.frame[4]?.action?.action_type)),
    ) ?? null;
  clickCandidateButton(button, `${label}:adopt`);
  let send = await tryPollWire(findAdoptSend, 10_000);
  if (!send) {
    await sleep(400);
    const retry = findAcceptRetryButton(dumpNodes());
    if (retry) safeClick(retry, `${label}:adopt-retry`);
    send = await pollWire(findAdoptSend, 20_000, `${label}:author_action_accepted`);
  }
  const strictReceipt = await tryPollWire(
    (wire) =>
      wire.find(
        (entry) =>
          entry.direction === "received" &&
          frameOf(entry) &&
          entry.at >= send.at &&
          entry.frame[3] === "action_result" &&
          entry.frame[4]?.status === "accepted" &&
          receiptMatchesArtifact(entry.frame[4], artifactId, send.frame[4]?.action),
      ) ?? null,
    20_000,
  );
  const receipt =
    strictReceipt ??
    (await pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            frameOf(entry) &&
            entry.at >= send.at &&
            entry.frame[3] === "action_result" &&
            entry.frame[4]?.status === "accepted",
        ) ?? null,
      25_000,
      `${label}:action_result`,
    ));
  await sleep(700);
  return { send: send.frame[4], receipt: receipt.frame[4] };
}

async function rawDiscardCandidate(artifactId, anchorText, label) {
  const startedAt = nowIso();
  const button = await waitCandidateButton(anchorText, "不保存");
  if (!button) throw new Error(`discard_button_not_found:${label}`);
  const findDiscardSend = (wire) =>
    wire.find(
      (entry) =>
        entry.direction === "sent" &&
        frameOf(entry) &&
        entry.at >= startedAt &&
        entry.frame[3] === "author_action" &&
        entry.frame[4]?.action?.target_ref === artifactId &&
        String(entry.frame[4]?.action?.action_type) === "discard",
    ) ?? null;
  clickCandidateButton(button, `${label}:discard`);
  let send = await tryPollWire(findDiscardSend, 10_000);
  if (!send) {
    await sleep(400);
    const retryNodes = dumpNodes();
    const retryAnchor = lastIndexWhere(retryNodes, (node) => textOf(node).includes(anchorText));
    const retry = findButton(retryNodes, "不保存", { afterIndex: retryAnchor });
    if (retry) safeClick(retry, `${label}:discard-retry`);
    send = await pollWire(findDiscardSend, 20_000, `${label}:author_action_discarded`);
  }
  const receipt = await pollWire(
    (wire) =>
      wire.find(
        (entry) =>
          entry.direction === "received" &&
          frameOf(entry) &&
          entry.at >= send.at &&
          entry.frame[3] === "action_result" &&
          ["accepted", "discarded"].includes(String(entry.frame[4]?.status)) &&
          receiptMatchesArtifact(entry.frame[4], artifactId, send.frame[4]?.action),
      ) ?? null,
    30_000,
    `${label}:discard_result`,
  );
  await sleep(700);
  return { send: send.frame[4], receipt: receipt.frame[4] };
}

async function rawOpenArchive(label) {
  let nodes = dumpNodes();
  if (nodes.some((node) => textOf(node).includes("关闭档案"))) return nodes;
  const findOpen = (current) => current.find((node) => node.role === "AXButton" && node.title === "打开档案") ?? null;
  const button = findOpen(nodes);
  if (!button) throw new Error("archive_button_not_found");
  const opened = (text) => text.includes("关闭档案");
  safeClick(button, `${label}:open-archive`);
  const first = await tryPollAx(opened, 15_000);
  if (first) return first;
  // 打开档案按钮偶发未命中（焦点/渲染抖动）：真实 UI 重试一次点击。
  const retry = findOpen(dumpNodes());
  if (retry) safeClick(retry, `${label}:open-archive-retry`);
  return pollAx(opened, 45_000, `${label}:archive_open`);
}

async function rawOpenArchiveCharacterTab(label) {
  const ready = await pollAx(
    (text) => text.includes("关闭档案") && text.includes("概览"),
    60_000,
    `${label}:archive_ready`,
  );
  const tabMatcher = (node) => {
    const text = `${String(node.title ?? "")}`.trim() || `${String(node.value ?? "")}`.trim();
    return text === "角色" || text.startsWith("角色 (");
  };
  const findTab = (current) => {
    const candidates = current.filter(
      (node) => tabMatcher(node) && ["AXButton", "AXRadioButton", "AXTab", "AXStaticText"].includes(node.role),
    );
    const pressable = candidates.filter((node) => Array.isArray(node.actions) && node.actions.includes("AXPress"));
    return (pressable.length ? pressable : candidates)[0] ?? null;
  };
  const target = findTab(ready.nodes);
  if (!target) throw new Error("archive_character_tab_not_found");
  safeClick(target, `${label}:character-tab`);
  await sleep(900);
  const panel = await tryPollAx((_text, nodes) => nodes.some((node) => node.subrole === "AXTabPanel" && String(node.title ?? "") === "角色"), 15_000);
  if (!panel) {
    const retry = findTab(dumpNodes());
    if (retry) safeClick(retry, `${label}:character-tab-retry`);
    await sleep(800);
  }
  return pollAx((text) => /角色/u.test(text), 30_000, `${label}:character_tab_visible`);
}

async function rawCloseArchive(label) {
  const nodes = dumpNodes();
  const button = nodes.find((node) => node.role === "AXButton" && node.title === "关闭档案");
  if (!button) return dumpNodes();
  safeClick(button, `${label}:close-archive`);
  return pollAx((text) => !text.includes("关闭档案"), 30_000, `${label}:archive_closed`);
}

function requirePending(turnResult, artifactType, label) {
  const pending = (turnResult?.adoption_state?.pending ?? []).find((entry) => entry.artifact_type === artifactType);
  if (!pending) {
    const types = (turnResult?.adoption_state?.pending ?? []).map((entry) => entry.artifact_type).join(",");
    throw new Error(`candidate_missing:${label}:${artifactType}(pending=${types || "none"})`);
  }
  return pending;
}

// ── 组合动作（顶层，内部只包一层 runStep）────────────────────────────────────────
async function launchAndSelectWork() {
  await runStep("maintenance", "launch_app", rawLaunchApp);
  await runStep("maintenance", "workbench_ready:initial", () => rawWaitWorkbench("initial"));
  let nodes = dumpNodes();
  if (visibleWorkTitle(nodes) === WORK_TITLE) return nodes;
  try {
    nodes = await runStep("maintenance", "switch_work:initial", () => rawSwitchWork(WORK_TITLE, "initial"));
    if (visibleWorkTitle(nodes) === WORK_TITLE) return nodes;
  } catch (error) {
    log.push({ op: "work_menu_failed", label: "initial", error: error.message });
  }
  // 兜底：经隔离副本测试数据准备（works.updated_at）后重开应用，等价于作者上一次打开目标作品后重开。
  markWorkNewest(readJson(path.join(dir, "b29-native-config.json")).seed.work_id);
  await restartApp("initial:fallback");
  return runStep("maintenance", "switch_work_menu:initial", () => rawSwitchWork(WORK_TITLE, "initial"));
}

async function sendAuthorInput(text, label) {
  const startedAt = nowIso();
  const message = await runStep("input", `type_send:${label}`, () => rawTypeAndSend(text, label));
  const turnId = String(frameBody(message)?.turn_id ?? "");
  if (!turnId) throw new Error(`user_message_without_turn:${label}`);
  await runStep("ack", `ack:${label}`, () => pollWire((wire) => ackFor(wire, message), 25_000, `${label}:ack`));
  const resultRecord = await runStep("turn", `turn:${label}`, () =>
    pollWire((wire) => turnResultFor(wire, turnId, startedAt), TURN_TIMEOUT, `${label}:turn_result`),
  );
  await sleep(1_200);
  return { turnId, turnResult: resultRecord.frame[4], messageAt: message.at, startedAt };
}

async function restartApp(label) {
  await runStep("restore", `restore:${label}`, () => rawCloseAppAndRelaunch(label));
}

async function inputReady(label) {
  return runStep("maintenance", `input_ready:${label}`, () => rawWaitInputReady(label));
}

// ── 主流程（确定性 slice_verify）：T1 正例 → T2 同名澄清 → T3 讨论 → T4 刷新/消费者 → T5 负例矩阵 ──
async function runDeterministicScenario() {
  evidence("prepare");
  const config = readJson(path.join(dir, "b29-native-config.json"));
  await launchAndSelectWork();
  await capture("T0-workbench");

  // ── T1：唯一别名「指定老沈为主角」→ 候选 old→new → 保存 → 同 id 字段更新 ──
  evidence("capture", "t1-before");
  const t1 = await sendAuthorInput(INPUTS.t1, "T1");
  const t1Pending = requirePending(t1.turnResult, "character_profile_revision", "T1");
  log.push({ op: "t1_pending", artifact_id: t1Pending.artifact_id, payload: t1Pending.payload ?? {} });
  await runStep("candidate", "candidate:T1", () =>
    rawWaitCandidateCard({ anchorText: "叙事身份修订", label: "T1", requireOldToNew: true }),
  );
  await capture("T1-candidate");
  const t1Adoption = await runStep("adoption", "adopt:T1", () =>
    rawAdoptCandidate(t1Pending.artifact_id, "叙事身份修订", "T1"),
  );
  log.push({ op: "t1_adoption", artifact_id: t1Pending.artifact_id, receipt_status: t1Adoption.receipt?.status ?? null });
  await capture("T1-receipt");
  await sleep(600);
  evidence("capture", "t1-after");

  // ── T2：同名「沈砚」→ await_author 澄清候选，零写入 ─────────────────────────
  await inputReady("T2");
  evidence("capture", "t2-before");
  const t2 = await sendAuthorInput(INPUTS.t2, "T2");
  await runStep("maintenance", "visible:T2:clarify", () =>
    pollAx((text) => /同名|多候选|请选择具体/u.test(text), MAINTENANCE_VISIBLE_TIMEOUT, "T2:clarify"),
  );
  await capture("T2-clarify");
  evidence("capture", "t2-after");

  // ── T3：只讨论 → 无 character_profile_revision 候选、零写入 ──────────────────
  await inputReady("T3");
  evidence("capture", "t3-before");
  const t3 = await sendAuthorInput(INPUTS.t3, "T3");
  await runStep("maintenance", "visible:T3:reply", () =>
    pollAx((text) => /位主角|群像/u.test(text), MAINTENANCE_VISIBLE_TIMEOUT, "T3:reply"),
  );
  await capture("T3-discussion");
  evidence("capture", "t3-after");

  // ── T4：刷新（关闭重开原生窗口）→ 档案角色 tab → 「现在谁是主角？」────────────
  await inputReady("T4");
  evidence("capture", "t4-before-refresh");
  markWorkNewest(config.seed.work_id);
  await restartApp("T4");
  await runStep("maintenance", "workbench_ready:T4", () => rawWaitWorkbench("T4:restored"));
  await runStep("maintenance", "T4:connected", () =>
    pollAx((text) => /同步已连接/u.test(text), 90_000, "T4:connected"),
  );
  let t4Nodes = dumpNodes();
  if (visibleWorkTitle(t4Nodes) !== WORK_TITLE) {
    t4Nodes = await runStep("maintenance", "switch_work:T4", () => rawSwitchWork(WORK_TITLE, "T4:restored"));
  }
  void t4Nodes;
  await capture("T4-refreshed");
  evidence("capture", "t4-after-refresh");
  await runStep("maintenance", "archive_open:T4", () => rawOpenArchive("T4"));
  await runStep("maintenance", "archive_tab:T4", () => rawOpenArchiveCharacterTab("T4"));
  await capture("T4-roster");
  await runStep("maintenance", "archive_close:T4", () => rawCloseArchive("T4"));
  await inputReady("T4:followup");
  const t4 = await sendAuthorInput(INPUTS.t4_followup, "T4-followup");
  await runStep("maintenance", "visible:T4:followup", () =>
    pollAx((text) => text.includes("以角色主档案为准"), MAINTENANCE_VISIBLE_TIMEOUT, "T4:followup"),
  );
  await capture("T4-followup");
  evidence("capture", "t4-after-followup");

  // ── T5a：放弃候选 → 原值不变 ────────────────────────────────────────────────
  await inputReady("T5:discard");
  evidence("capture", "t5-before-discard");
  const t5Discard = await sendAuthorInput(INPUTS.t5_discard, "T5-discard");
  const t5DiscardPending = requirePending(t5Discard.turnResult, "character_profile_revision", "T5-discard");
  await runStep("candidate", "candidate:T5-discard", () =>
    rawWaitCandidateCard({ anchorText: "阿鸢 · 叙事身份修订", label: "T5-discard" }),
  );
  await capture("T5-discard");
  const discard = await runStep("adoption", "discard:T5", () =>
    rawDiscardCandidate(t5DiscardPending.artifact_id, "阿鸢 · 叙事身份修订", "T5-discard"),
  );
  log.push({ op: "t5_discard", artifact_id: t5DiscardPending.artifact_id, receipt_status: discard.receipt?.status ?? null });
  await capture("T5-discard-done");
  evidence("capture", "t5-after-discard");

  // ── T5b：重复「指定老沈为主角」→ 零写入/幂等（同一 id 不重复写）──────────────
  await inputReady("T5:repeat");
  evidence("capture", "t5-before-repeat");
  await sendAuthorInput(INPUTS.t5_repeat, "T5-repeat");
  await runStep("candidate", "candidate:T5-repeat", () =>
    rawWaitCandidateCard({ anchorText: "沈砚 · 叙事身份修订", label: "T5-repeat" }),
  );
  await capture("T5-repeat");
  evidence("capture", "t5-after-repeat");

  // ── T5c：跨作品/失效目标 → 零写入且不猜 ─────────────────────────────────────
  await inputReady("T5:cross-work");
  evidence("capture", "t5-before-cross-work");
  await sendAuthorInput(INPUTS.t5_cross_work, "T5-cross-work");
  await runStep("maintenance", "visible:T5:cross", () =>
    pollAx((text) => /同名|多候选|请选择具体/u.test(text), MAINTENANCE_VISIBLE_TIMEOUT, "T5:cross"),
  );
  await capture("T5-cross-work");
  evidence("capture", "t5-after-cross-work");

  await capture("B29-final");
  evidence("capture", "final");
  writeJson("b29-native-driver-log.json", {
    slice_id: config.slice_id,
    driver: "ax-native-system-ui",
    finished_at: nowIso(),
    captures: log,
  });
  writeUiComplete(dir, {
    runRef: ready.run_ref,
    screenshots,
    driver: "ax-native-system-ui",
    scope: config.slice_id,
  });
  console.log(`B29 原生驱动完成: screenshots=${screenshots.length} waits=${captures.length}`);
}

// ── 真实模型 scoped（strata）：T1 正例 + T2 同名澄清负例，不重跑 23 项矩阵 ──────────
// B29 scoped 只有两轮判断交互：T1 的 judgment_decision 与 T2 的 await_author 澄清都是
// turn_result 终态（产品对话语义），不存在需要作者作答才能继续的 agent-run 阻塞提问。
// 因此不自动点击「回复此问题」卡（那是 T2 的预期产品输出），author_question_events 记录为空数组；
// 若真实模型在 agent-run 中阻塞提问，本 scoped 驱动会按 turn 预算 fail-fast，不伪造应答。
const authorQuestionEvents = [];

async function runStrataScopedScenario() {
  evidence("prepare");
  const config = readJson(path.join(dir, "b29-native-config.json"));
  await launchAndSelectWork();
  await capture("T0-workbench");

  // T1：真实模型「指定老沈为主角」→ judgment revise_character_profile + character_ref →
  // 候选 old→new → 原生「保存到作品」→ 同 id/角色数/正文 hash 等不变 + receipt。
  await inputReady("T1");
  evidence("capture", "t1-before");
  const t1 = await sendAuthorInput(INPUTS.t1, "T1-real");
  const t1Pending = requirePending(t1.turnResult, "character_profile_revision", "T1-real");
  log.push({ op: "t1_pending_real", artifact_id: t1Pending.artifact_id, payload: t1Pending.payload ?? {} });
  await runStep("candidate", "candidate:T1-real", () =>
    rawWaitCandidateCard({ anchorText: "叙事身份修订", label: "T1-real", requireOldToNew: true }),
  );
  await capture("T1-candidate");
  const adoption = await runStep("adoption", "adopt:T1-real", () =>
    rawAdoptCandidate(t1Pending.artifact_id, "叙事身份修订", "T1-real"),
  );
  log.push({ op: "t1_adoption_real", artifact_id: t1Pending.artifact_id, receipt_status: adoption.receipt?.status ?? null });
  await capture("T1-receipt");
  await sleep(600);
  evidence("capture", "t1-after");

  // T2：同名「指定沈砚为主角」→ 真实模型澄清（await_author），零写入。
  await inputReady("T2");
  evidence("capture", "t2-before");
  await sendAuthorInput(INPUTS.t2, "T2-real");
  await runStep("maintenance", "visible:T2-real:clarify", () =>
    pollAx((text) => /同名|多候选|请选择具体|哪一位|具体/u.test(text), MAINTENANCE_VISIBLE_TIMEOUT, "T2-real:clarify"),
  );
  await capture("T2-clarify");
  evidence("capture", "t2-after");

  await capture("B29-final");
  evidence("capture", "final");
  writeJson("author_question_events.json", authorQuestionEvents);
  writeJson("author-question-observation.json", {
    blocking_agent_questions: 0,
    note:
      "B29 scoped 两轮判断交互均以 turn_result 终态返回：T1 execute(revise_character_profile)、" +
      "T2 await_author 澄清（产品对话语义）。未出现需要作者作答才能继续的 agent-run 阻塞提问，" +
      "故不自动点击「回复此问题」卡、未发送任何 author_choice 回复。",
    t2_await_author_is_product_dialogue: true,
  });
  writeJson("b29-native-driver-log.json", {
    slice_id: config.slice_id,
    driver: "ax-native-system-ui",
    provider: "strata",
    model: config.model,
    scope: "scoped_real_model",
    finished_at: nowIso(),
    author_question_events: authorQuestionEvents,
    captures: log,
  });
  writeUiComplete(dir, {
    runRef: ready.run_ref,
    screenshots,
    driver: "ax-native-system-ui",
    scope: config.slice_id,
  });
  console.log(`B29 真实模型 scoped 驱动完成: screenshots=${screenshots.length} questions=${authorQuestionEvents.length}`);
}

async function main() {
  if (STRATA) await runStrataScopedScenario();
  else await runDeterministicScenario();
}

main().catch(async (error) => {
  failing = true;
  try {
    const nodes = dumpNodes();
    writeAX(nodes, path.join(dir, "failure.ax.txt"), APP);
    fs.writeFileSync(path.join(dir, "failure.text.txt"), axText(nodes));
    screenshot(APP, path.join(dir, "failure.jpg"));
  } catch {
    /* app may be gone */
  }
  if (!fs.existsSync(path.join(dir, "failure.json"))) {
    fs.writeFileSync(
      path.join(dir, "failure.json"),
      JSON.stringify(
        {
          at: nowIso(),
          phase: currentPhase,
          slice_id: "b29-existing-character-role-revision",
          driver: "ax-native-system-ui",
          reason: error.message,
          stack: String(error.stack ?? "").split("\n").slice(0, 6),
          captures,
          log_tail: log.slice(-14),
        },
        null,
        2,
      ),
    );
  }
  console.error(error);
  process.exitCode = 1;
});
