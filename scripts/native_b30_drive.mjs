// B30 原生验收外部驱动：用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生 macOS 窗口 + 真实
// Phoenix 后端 + 嵌入式真实前端），完成浏览器 canonical 场景的同一批 trials/checks。
// 产品代码不读取本文件；驱动只用用户可见语义（按钮/标签/输入框/页面文本）操作真实窗口。
// 用法：node scripts/native_b30_drive.mjs <batch-run-dir> <slice-id>
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CUA,
  appPid,
  activate,
  click,
  clickAt,
  dump,
  pressKey,
  readJson,
  screenshot,
  sleep,
  textOf,
  typeText,
  writeAX,
} from "./lib/native_ui/driver.mjs";
import { flatText, writeUiComplete } from "./lib/native_ui/workbench.mjs";
import { Step } from "./lib/native_ui/driver.mjs";
import { cleanupNativeApp } from "./lib/native_app_ownership.mjs";
import { unloadStrataModel } from "./native_b30_evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(process.argv[2] ?? "");
const sliceId = process.argv[3] ?? "";
if (!dir || !sliceId) {
  console.error("usage: node scripts/native_b30_drive.mjs <batch-run-dir> <slice-id>");
  process.exit(64);
}
const ready = readJson(path.join(dir, "native-driver-ready.json"));
const APP = ready.bundle_identifier;
const EVIDENCE = path.join(ROOT, "scripts/native_b30_evidence.mjs");
const STRATA = ready.provider === "strata";
// B37 分型预算：确定性 provider 用默认；真实模型走 strata 预算
// （input120 / turn360 / candidate300 / adoption180 / maintenance300 / restore30），
// 轮询超时取略低于预算以让驱动先给出可读失败，而不是被监督误杀。
const T = STRATA
  ? { ack: 28_000, turn: 340_000, candidate: 280_000, visible: 200_000,
      adoptSent: 15_000, adoptRetry: 20_000, adoptStrict: 60_000, adoptFallback: 80_000 }
  : { ack: 25_000, turn: 110_000, candidate: 110_000, visible: 60_000,
      adoptSent: 10_000, adoptRetry: 15_000, adoptStrict: 20_000, adoptFallback: 25_000 };
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
  void failure;
}

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
const AX_MAX_NODES = 12000;

// 应用退到后台/被遮挡时 AppKit 可能只暴露菜单栏；激活后重试，避免把“窗口暂时不可见”
// 误判成产品状态。只读 AX + 激活自身窗口，不改变产品数据。
function dumpNodes() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const nodes = dump(APP, AX_MAX_NODES);
    if (nodes.some((node) => node.role === "AXWindow")) return nodes;
    activate(APP);
    execFileSync("sleep", ["0.5"]);
  }
  return dump(APP, AX_MAX_NODES);
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

async function waitVisible(pattern, timeoutMs, label, kind = "maintenance") {
  return runStep(kind, label, () => pollAx((text) => matchText(text, pattern), timeoutMs, label));
}

// ── 证据采集 ────────────────────────────────────────────────────────────────
// 窗口截图偶发失败（窗口动画/被其它窗口遮挡切换期间 screencapture 会报
// could not create image from window）。AX 树是主证据；截图按次重试，仍失败只记日志，
// 不中断整条真实工作台链路。
function screenshotSafe(filePath) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      screenshot(APP, filePath);
      return true;
    } catch (error) {
      log.push({ op: "screenshot_retry", filePath: path.basename(filePath), attempt, error: error.message });
      activate(APP);
      execFileSync("sleep", ["0.8"]);
    }
  }
  return false;
}

async function capture(name) {
  checkSupervisor();
  await sleep(150);
  const nodes = dumpNodes();
  writeAX(nodes, path.join(dir, `${name}.ax.txt`), APP);
  fs.writeFileSync(path.join(dir, `${name}.text.txt`), axText(nodes));
  if (screenshotSafe(path.join(dir, `${name}.jpg`))) screenshots.push(`${name}.jpg`);
  captures.push({ name, at: nowIso(), nodes: nodes.length });
  log.push({ op: "capture", name, at: nowIso() });
  return nodes;
}

function evidence(mode, extra) {
  checkSupervisor();
  execFileSync("node", [EVIDENCE, mode, dir, ...(extra ? [extra] : [])], { cwd: ROOT, stdio: "inherit" });
}

// ── 传输帧等待 ──────────────────────────────────────────────────────────────
function transport() {
  const file = path.join(dir, "native-transport.jsonl");
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  return text.split("\n").filter((line) => line.includes("{")).map((line) => JSON.parse(line.slice(line.indexOf("{"))));
}

async function pollWire(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkSupervisor();
    const wire = transport();
    const hit = predicate(wire);
    if (hit) return hit;
    await sleep(300);
  }
  throw new Error(`wait_wire_timeout:${label}`);
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

function sentUserMessageSince(wire, sinceIso, text) {
  const record = wire.find(
    (entry) =>
      entry.direction === "sent" &&
      frameOf(entry) &&
      entry.at >= sinceIso &&
      entry.frame[3] === "user_message" &&
      String(entry.frame[4]?.text ?? "") === text,
  );
  return record ?? null;
}

function turnResultFor(wire, turnId, sinceIso) {
  const results = wire.filter(
    (entry) =>
      entry.direction === "received" &&
      frameOf(entry) &&
      entry.at >= sinceIso &&
      entry.frame[3] === "turn_result" &&
      String(entry.frame[4]?.turn_id ?? "").startsWith(turnId),
  );
  return results.at(-1) ?? null;
}

function ackFor(wire, messageRecord) {
  const turnId = String(messageRecord.frame[4]?.turn_id ?? "");
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

// ── 高层工作台动作 ──────────────────────────────────────────────────────────
async function launchEmbeddedApp() {
  execFileSync("open", [ready.app_path]);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    checkSupervisor();
    if (appPid(APP)) break;
    await sleep(500);
  }
  if (!appPid(APP)) throw new Error("native_app_did_not_launch");
  activate(APP);
}

async function pollWorkbench(timeoutMs, label) {
  return pollAx(
    (_text, nodes) =>
      nodes.some((node) => node.role === "AXWebArea") &&
      nodes.some((node) => node.role === "AXTextField" && String(node.desc ?? "").includes("输入")) &&
      nodes.some((node) => node.role === "AXButton" && node.title === "发送"),
    timeoutMs,
    label,
  );
}

async function waitWorkbenchReady(label) {
  const readyNodes = await runStep("maintenance", `workbench_ready:${label}`, () =>
    pollWorkbench(170_000, `workbench_ready:${label}`),
  );
  return readyNodes.nodes;
}

function visibleWorkTitle(nodes) {
  const trigger = nodes.find((node) => node.role === "AXPopUpButton" && String(node.desc ?? "") === "作品");
  return trigger?.title ?? null;
}

function findActionable(nodes, text, { roles = null, exact = true } = {}) {
  return (
    nodes.find(
      (node) =>
        (!roles || roles.includes(node.role)) &&
        (exact ? node.title === text || node.value === text : textOf(node).includes(text)),
    ) ?? null
  );
}

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

async function clickByText(nodes, text, label, options = {}) {
  const node = findActionable(nodes, text, options);
  if (!node) throw new Error(`visible_target_not_found:${text}(${label})`);
  return safeClick(node, label);
}

// 工作台作品切换：Radix DropdownMenu 在 pointerdown 打开，AXPress 合成 click 不足以触发，
// 用真实鼠标事件点 trigger/menuitem（仍是作者可见入口，不改产品）。
async function openWorkMenu(trigger, label) {
  const menuOpen = (_text, nodes) => nodes.some((node) => node.role === "AXMenuItem");
  if (Array.isArray(trigger.frame) && trigger.frame.length >= 4) {
    clickAt(APP, trigger.frame[0] + trigger.frame[2] / 2, trigger.frame[1] + trigger.frame[3] / 2);
  } else {
    safeClick(trigger, `${label}:menu-trigger`);
  }
  let opened = await tryPollAx(menuOpen, 6_000);
  if (!opened) {
    safeClick(trigger, `${label}:menu-trigger-axpress`);
    opened = await tryPollAx(menuOpen, 6_000);
  }
  return opened;
}

function clickMenuItemByMouse(item, label) {
  if (Array.isArray(item.frame) && item.frame.length >= 4) {
    clickAt(APP, item.frame[0] + item.frame[2] / 2, item.frame[1] + item.frame[3] / 2);
    return true;
  }
  return false;
}

function focusedNode() {
  try {
    return JSON.parse(execFileSync(CUA, ["focused", APP], { encoding: "utf8" }));
  } catch {
    return null;
  }
}

// WKWebView 自定义下拉：trigger 用真实鼠标点开；菜单项优先 AXPress，失败再试键盘方向键选择。
async function selectWorkMenuItem(title, label, attempt) {
  const opened = await openWorkMenu(
    dumpNodes().find((node) => node.role === "AXPopUpButton" && String(node.desc ?? "") === "作品"),
    `${label}:attempt${attempt}`,
  );
  if (!opened) return { switched: null, opened: false };
  const items = opened.nodes.filter((node) => node.role === "AXMenuItem");
  const item = items.find((node) => node.title === title) ?? items.find((node) => textOf(node).includes(title));
  if (!item) return { switched: null, opened: true, items };
  if (attempt === 1) {
    writeAX(opened.nodes, path.join(dir, `${label}-work-menu.ax.txt`), APP);
    fs.writeFileSync(path.join(dir, `${label}-work-menu.text.txt`), axText(opened.nodes));
    log.push({ op: "work_menu_items", label, items: items.map((node) => node.title || textOf(node)).slice(0, 20) });
  }
  if (attempt === 1) {
    // AXPress 触发菜单项选中
    try {
      safeClick(item, `${label}:menuitem-axpress`);
    } catch (error) {
      log.push({ op: "work_menu_axpress_failed", label, error: error.message });
    }
  } else if (attempt === 2) {
    clickMenuItemByMouse(item, `${label}:menuitem-mouse`);
  } else {
    // 键盘：方向键在菜单内移动焦点，命中目标标题后回车选中。
    for (let step = 0; step < 10; step += 1) {
      pressKey(APP, "down");
      await sleep(250);
      const focused = focusedNode();
      const focusedText = textOf(focused ?? {});
      if (focusedText.includes(title)) {
        pressKey(APP, "return");
        break;
      }
    }
  }
  const switched = await tryPollAx((_text, current) => visibleWorkTitle(current) === title, 12_000);
  if (!switched) log.push({ op: "work_menu_item_clicked_without_switch", label, attempt, item_title: item.title });
  return { switched: switched?.nodes ?? null, opened: true, item };
}

async function switchWorkViaMenu(title, label) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const nodes = dumpNodes();
    if (visibleWorkTitle(nodes) === title) return nodes;
    const result = await selectWorkMenuItem(title, label, attempt);
    if (result.switched) {
      await tryPollAx((text) => /同步已连接/u.test(text) || /已连接/u.test(text), 60_000).catch(() => null);
      return result.switched;
    }
    const stillOpen = dumpNodes().some((node) => node.role === "AXMenuItem");
    if (stillOpen) {
      pressKey(APP, "escape");
      await sleep(400);
    }
  }
  throw new Error(`work_switch_failed:${title}`);
}

async function ensureWork(title, label) {
  const nodes = await waitWorkbenchReady(label);
  if (visibleWorkTitle(nodes) === title) return nodes;
  let switched = null;
  try {
    switched = await runStep("maintenance", `switch_work:${label}`, () => switchWorkViaMenu(title, label));
  } catch (error) {
    log.push({ op: "work_menu_failed", label, error: error.message });
  }
  if (switched) return switched;
  // 兜底：经隔离副本测试数据准备（works.updated_at）后重开应用，等价于作者上一次打开目标作品后重开。
  await markWorkNewest(workIdForTitle(title));
  const restarted = await restartApp(`${label}:work-fallback`);
  if (visibleWorkTitle(restarted) === title) return restarted;
  return runStep("maintenance", `switch_work_menu:${label}`, () => switchWorkViaMenu(title, label));
}

function workIdForTitle(title) {
  const config = readJson(path.join(dir, "b30-native-config.json"));
  if (title === WORK_A_TITLE) return config.seed.work_a_id;
  if (title === WORK_B_TITLE) return config.seed.work_b_id;
  throw new Error(`unknown_work_title:${title}`);
}

function markWorkNewest(workId) {
  execFileSync("python3", ["-c", [
    "import sqlite3,sys,datetime",
    "db=sqlite3.connect(sys.argv[1], timeout=10)",
    "ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'",
    "db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2]))",
    "db.commit(); db.close()",
  ].join("\n"), path.join(dir, "database", "ai_novel_studio_test.sqlite3"), workId], { stdio: "ignore" });
}

// 刷新（关闭重开）语义：只关本批独立可执行路径的原生窗口，再打开同一 app bundle。
async function restartApp(label) {
  await runStep("restore", `restore:${label}`, async () => {
    await cleanupNativeApp(dir);
    await sleep(400);
    execFileSync("open", [ready.app_path]);
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      checkSupervisor();
      if (appPid(APP)) break;
      await sleep(400);
    }
    if (!appPid(APP)) throw new Error("native_app_did_not_relaunch");
    activate(APP);
  });
  return waitWorkbenchReady(`${label}:restored`);
}

// ── 输入/发送/回合 ──────────────────────────────────────────────────────────
function findComposer(nodes) {
  return nodes.find((node) => node.role === "AXTextField" && String(node.desc ?? "").includes("输入")) ?? null;
}

function readClipboard() {
  try {
    return execFileSync("pbpaste", { encoding: "utf8" });
  } catch {
    return "";
  }
}

function writeClipboard(text) {
  try {
    execFileSync("pbcopy", { input: text });
  } catch {
    /* clipboard unavailable in some CI sessions */
  }
}

// 把作者输入放进真实主输入框：优先 AX set（原子写入、不产生逐字键盘事件），
// 再聚焦后 select-all/copy 读回校验；不一致则清空重打。共享桌面上其它进程的
// 键盘输入可能混入 composer，因此发送前必须逐字校验。
function composerDomValue() {
  try {
    const nodes = dumpNodes();
    const composer = findComposer(nodes);
    return String(composer?.value ?? "");
  } catch {
    return "";
  }
}

// 把作者输入放进真实主输入框并校验。校验来源：AX 焦点元素值 / 主输入节点值 /
// 剪贴板回读（awaiting_author 问题态下 copy 可能不可用，故多源交叉）；全部不可读时
// 先发送由真实 wire 文本再校验（worker 只接受逐字相等的 user_message）。
async function fillComposer(text, label) {
  const initial = dumpNodes();
  const composer = findComposer(initial);
  if (!composer) throw new Error("composer_not_found");
  const originalClipboard = readClipboard();
  const focusComposer = async () => {
    if (Array.isArray(composer.frame)) {
      clickAt(APP, composer.frame[0] + composer.frame[2] / 2, composer.frame[1] + composer.frame[3] / 2);
    } else {
      safeClick(composer, `${label}:composer`);
    }
    await sleep(250);
  };
  const clearComposer = async () => {
    pressKey(APP, "cmd+a");
    await sleep(100);
    pressKey(APP, "delete");
    await sleep(120);
  };
  const readBack = async () => {
    const focused = focusedNode();
    const focusedValue = String(focused?.value ?? "");
    if (focusedValue === text) return "focused";
    if (composerDomValue() === text) return "node";
    pressKey(APP, "cmd+a");
    await sleep(100);
    pressKey(APP, "cmd+c");
    await sleep(200);
    if (readClipboard() === text) return "clipboard";
    return null;
  };
  try {
    await focusComposer();
    await clearComposer();
    typeText(APP, text);
    await sleep(450);
    let verifiedBy = await readBack();
    if (!verifiedBy) {
      await focusComposer();
      await clearComposer();
      typeText(APP, text);
      await sleep(450);
      verifiedBy = await readBack();
    }
    if (!verifiedBy) {
      try {
        const response = JSON.parse(execFileSync(CUA, ["set", APP, composer.path, text], { encoding: "utf8" }));
        log.push({ op: "composer_ax_set", label, ok: response.ok === true });
      } catch (error) {
        log.push({ op: "composer_ax_set_failed", label, error: error.message });
      }
      await focusComposer();
      await sleep(150);
      verifiedBy = await readBack();
    }
    log.push({ op: "composer_fill", label, verified_by: verifiedBy });
    // 读不回来自我校验时仍发送：sendAuthorInput 只接受与作者原话逐字相等的 wire 文本。
    return { verifiedBy };
  } finally {
    writeClipboard(originalClipboard);
  }
}

async function sendAuthorInput(text, label) {
  const startedAt = nowIso();
  const message = await runStep("input", `type_send:${label}`, async () => {
    await fillComposer(text, label);
    let afterType = dumpNodes();
    const clickSend = (current) => {
      const button = current.find((node) => node.role === "AXButton" && node.title === "发送");
      if (button) safeClick(button, `${label}:send`);
      else pressKey(APP, "return");
    };
    clickSend(afterType);
    const predicate = (wire) => sentUserMessageSince(wire, startedAt, text);
    let sent = await tryPollWire(predicate, 10_000);
    if (!sent) {
      afterType = dumpNodes();
      clickSend(afterType);
      sent = await pollWire(predicate, 12_000, `${label}:user_message_sent`);
    }
    return sent;
  });
  const turnId = String(message.frame[4]?.turn_id ?? "");
  if (!turnId) throw new Error(`user_message_without_turn:${label}`);
  await runStep("ack", `ack:${label}`, () => pollWire((wire) => ackFor(wire, message), T.ack, `${label}:ack`));
  const resultRecord = await runStep("turn", `turn:${label}`, () =>
    pollWire((wire) => turnResultFor(wire, turnId, startedAt), T.turn, `${label}:turn_result`),
  );
  return { turnId, turnResult: resultRecord.frame[4], messageAt: message.at, startedAt };
}

async function waitCandidateVisible({ textPattern, label, buttonLabel }) {
  return runStep("candidate", `candidate:${label}`, () =>
    pollAx(
      (text) =>
        matchText(text, textPattern) &&
        (buttonLabel ? text.includes(buttonLabel) : true),
      T.candidate,
      `candidate:${label}`,
    ),
  );
}

function pendingOf(turnResult) {
  return turnResult?.adoption_state?.pending ?? [];
}

// action_result 的 artifact 归属：顶层 artifact_id / target_ref，或 decision 内 target_ref/candidate_ref。
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

async function adoptCandidate(artifactId, buttonLabel, label) {
  const startedAt = nowIso();
  return runStep("adoption", `adopt:${label}`, async () => {
    const nodes = dumpNodes();
    const buttons = nodes.filter((node) => node.role === "AXButton" && node.title === buttonLabel);
    if (buttons.length === 0) throw new Error(`adopt_button_not_found:${buttonLabel}`);
    const visible = buttons.filter((node) => Array.isArray(node.frame) && node.frame[1] > 0);
    const target = (visible.length ? visible : buttons).at(-1);
    const findAdoptSend = (wire) =>
      wire.find(
        (entry) =>
          entry.direction === "sent" &&
          frameOf(entry) &&
          entry.at >= startedAt &&
          entry.frame[3] === "author_action" &&
          entry.frame[4]?.action?.target_ref === artifactId,
      ) ?? null;
    safeClick(target, `${label}:adopt`);
    let send = await tryPollWire(findAdoptSend, T.adoptSent);
    if (!send) {
      const retryNodes = dumpNodes();
      const retryButtons = retryNodes.filter((node) => node.role === "AXButton" && node.title === buttonLabel);
      if (retryButtons.length) safeClick(retryButtons.at(-1), `${label}:adopt-retry`);
      send = await pollWire(findAdoptSend, T.adoptRetry, `${label}:author_action_sent`);
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
            receiptMatchesArtifact(entry.frame[4], artifactId),
        ) ?? null,
      T.adoptStrict,
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
        T.adoptFallback,
        `${label}:action_result`,
      ));
    await sleep(600);
    return { send: send.frame[4], receipt: receipt.frame[4] };
  });
}

// ── 档案/阅读导航 ──────────────────────────────────────────────────────────
// 底层动作不单独登记等待账：由 composite（openArchiveTab 等）统一 begin/finish，
// 避免嵌套 begin 触发 wait ledger 的 invalid_wait_begin。
async function openArchivePanel(label) {
  let nodes = dumpNodes();
  if (nodes.some((node) => node.title === "关闭档案" || textOf(node).includes("关闭档案"))) return nodes;
  const button = nodes.find((node) => node.role === "AXButton" && node.title === "打开档案");
  if (!button) throw new Error("archive_button_not_found");
  const opened = (text) => text.includes("关闭档案");
  safeClick(button, `${label}:open-archive`);
  let panel = await tryPollAx(opened, 15_000);
  if (!panel) {
    const retryNodes = dumpNodes();
    const retryButton = retryNodes.find((node) => node.role === "AXButton" && node.title === "打开档案");
    if (retryButton) safeClick(retryButton, `${label}:open-archive-retry`);
    panel = await pollAx(opened, 45_000, `${label}:archive_open`);
  }
  return panel.nodes;
}

async function closeArchive(label) {
  return runStep("maintenance", `archive_close:${label}`, async () => {
    const nodes = dumpNodes();
    const button = nodes.find((node) => node.role === "AXButton" && node.title === "关闭档案");
    if (!button) return nodes;
    safeClick(button, `${label}:close-archive`);
    const closed = await pollAx((text) => !text.includes("关闭档案"), 30_000, `${label}:archive_closed`);
    return closed.nodes;
  });
}

async function openArchiveTab(tabName, readyPattern, label) {
  return runStep("maintenance", `archive_tab:${label}`, async () => {
    const nodes = await openArchivePanel(label);
    const tabMatches = (node) =>
      String(node.title ?? "").startsWith(tabName) || String(node.value ?? "").startsWith(tabName);
    const tab = nodes.find(
      (node) => tabMatches(node) && Array.isArray(node.actions) && node.actions.includes("AXPress"),
    ) ?? nodes.find(tabMatches);
    if (!tab) throw new Error(`archive_tab_not_found:${tabName}`);
    const predicate = (text) => matchText(text, readyPattern);
    safeClick(tab, `${label}:tab`);
    let settled = await tryPollAx(predicate, 12_000);
    if (!settled) {
      const retryNodes = dumpNodes();
      const retryTab =
        retryNodes.find((node) => tabMatches(node) && Array.isArray(node.actions) && node.actions.includes("AXPress")) ??
        retryNodes.find(tabMatches);
      if (retryTab) safeClick(retryTab, `${label}:tab-retry`);
      settled = await pollAx(predicate, 70_000, `${label}:tab_ready`);
    }
    await sleep(700);
    return settled;
  });
}

async function openReadingMode(label) {
  return runStep("maintenance", `reading_open:${label}`, async () => {
    const nodes = dumpNodes();
    const button = nodes.find((node) => node.role === "AXButton" && node.title === "阅读");
    if (!button) throw new Error("reading_button_not_found");
    safeClick(button, `${label}:reading`);
    return pollAx((text) => text.includes("阅读模式") && text.includes("本章有效字数"), 60_000, `${label}:reading_ready`);
  });
}

async function clickReadingChapter(title, marker, label) {
  return runStep("maintenance", `reading_chapter:${label}`, async () => {
    const nodes = dumpNodes();
    const candidates = nodes.filter(
      (node) => (node.value === title || node.title === title) && Array.isArray(node.frame) && node.frame[1] > 0,
    );
    if (candidates.length === 0) throw new Error(`reading_toc_title_not_found:${title}`);
    const target = candidates.sort((a, b) => a.frame[0] - b.frame[0])[0];
    safeClick(target, `${label}:chapter`);
    return pollAx((text) => matchText(text, marker), 45_000, `${label}:chapter_content`);
  });
}

async function closeReadingMode(label) {
  return runStep("maintenance", `reading_close:${label}`, async () => {
    const nodes = dumpNodes();
    const button = nodes.find((node) => node.role === "AXButton" && node.title === "返回工作台");
    if (!button) throw new Error("reading_back_button_not_found");
    safeClick(button, `${label}:back`);
    return pollAx((_text, current) => current.some((node) => node.role === "AXTextField" && String(node.desc ?? "").includes("输入")), 30_000, `${label}:workbench`);
  });
}

// ── 规划入口（真实按钮，无输入框路径）────────────────────────────────────────
async function clickPlanVolumes(label) {
  const startedAt = nowIso();
  const message = await runStep("input", `plan_click:${label}`, async () => {
    const nodes = dumpNodes();
    const button = nodes.find((node) => node.role === "AXButton" && node.title === "规划卷章结构");
    if (!button) throw new Error("plan_volumes_button_not_found");
    const predicate = (wire) =>
      sentUserMessageSince(wire, startedAt, "请基于当前作品规划卷章结构，并生成章节大纲。");
    safeClick(button, `${label}:plan-volumes`);
    let sent = await tryPollWire(predicate, 12_000);
    if (!sent) {
      const retryNodes = dumpNodes();
      const retryButton = retryNodes.find((node) => node.role === "AXButton" && node.title === "规划卷章结构");
      if (retryButton) safeClick(retryButton, `${label}:plan-volumes-retry`);
      sent = await pollWire(predicate, 12_000, `${label}:planning_message`);
    }
    return sent;
  });
  const turnId = String(message.frame[4]?.turn_id ?? "");
  await runStep("ack", `ack:${label}`, () => pollWire((wire) => ackFor(wire, message), T.ack, `${label}:ack`));
  const resultRecord = await runStep("turn", `turn:${label}`, () =>
    pollWire((wire) => turnResultFor(wire, turnId, startedAt), T.turn, `${label}:turn_result`),
  );
  return { turnId, turnResult: resultRecord.frame[4] };
}

async function clickPlanNextVolume(label) {
  const startedAt = nowIso();
  await runStep("input", `plan_next_click:${label}`, async () => {
    const nodes = dumpNodes();
    const button = nodes.find((node) => node.role === "AXButton" && node.title === "规划下一卷");
    if (!button) throw new Error("plan_next_volume_button_not_found");
    const predicate = (wire) =>
      wire.find(
        (entry) =>
          entry.direction === "sent" &&
          frameOf(entry) &&
          entry.at >= startedAt &&
          entry.frame[3] === "plan_next_volume",
      ) ?? null;
    safeClick(button, `${label}:plan-next-volume`);
    let sent = await tryPollWire(predicate, 12_000);
    if (!sent) {
      const retryNodes = dumpNodes();
      const retryButton = retryNodes.find((node) => node.role === "AXButton" && node.title === "规划下一卷");
      if (retryButton) safeClick(retryButton, `${label}:plan-next-volume-retry`);
      sent = await pollWire(predicate, 12_000, `${label}:plan_next_sent`);
    }
    return sent;
  });
  return runStep("turn", `turn:${label}`, () =>
    pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            frameOf(entry) &&
            entry.at >= startedAt &&
            entry.frame[3] === "turn_result" &&
            entry.frame[4]?.tool_result?.tool_name === "plot_outline" &&
            entry.frame[4]?.tool_result?.output?.artifact_type === "outline_draft",
        ) ?? null,
      T.turn,
      `${label}:turn_result`,
    ),
  );
}

// ── 场景 1：T1–T6 + T8 ──────────────────────────────────────────────────────
const S1 = "b30-chapter-renumber-roundtrip";
const S2 = "b30-volume-blueprint-kind-boundary";
const WORK_A_TITLE = "B30 章节重编号复现作品";
const WORK_B_TITLE = "B30 卷蓝图复现作品";
const TEXTS = {
  t1: "把第2卷章节编号理顺，内容不要动",
  t2: "把第2卷第11章和第12章的编号对调",
  t3: "把第2卷章节编号理顺，内容不要动",
  t5: [
    { id: "no_volume_named_multi_volume", text: "把章节编号理顺，内容不要动" },
    { id: "out_of_range_ninth_volume", text: "把第九卷章节编号理顺，内容不要动" },
    { id: "duplicate_chapter_numbers", text: "把第2卷第11章和第11章的编号对调" },
  ],
  t8: "把第12章正文整章通读修订一遍，让行文更通顺，情节不要改。",
};

function requirePending(turnResult, type, label) {
  const pending = pendingOf(turnResult).find((entry) => entry.artifact_type === type);
  if (!pending) throw new Error(`candidate_missing:${label}:${type}`);
  return pending;
}

async function runRenumberScenario() {
  evidence("prepare", sliceId);
  await runStep("maintenance", "launch_app", launchEmbeddedApp);
  await ensureWork(WORK_A_TITLE, "initial");
  await capture("T0-workbench");

  // T1：正例 dense 重编号
  evidence("capture", "t1-before");
  const t1 = await sendAuthorInput(TEXTS.t1, "T1");
  const t1Pending = requirePending(t1.turnResult, "chapter_structure_change_plan", "T1");
  await waitCandidateVisible({ textPattern: /章节重编号变更计划/u, label: "T1", buttonLabel: "保存到作品" });
  await capture("T1-candidate");
  await adoptCandidate(t1Pending.artifact_id, "保存到作品", "T1");
  await capture("T1-receipt");
  evidence("capture", "t1-after");

  // T2：点名两章对调（两阶段事务）
  evidence("capture", "t2-before");
  const t2 = await sendAuthorInput(TEXTS.t2, "T2");
  const t2Pending = requirePending(t2.turnResult, "chapter_structure_change_plan", "T2");
  await waitCandidateVisible({ textPattern: /章节重编号变更计划/u, label: "T2", buttonLabel: "保存到作品" });
  await capture("T2-candidate");
  await adoptCandidate(t2Pending.artifact_id, "保存到作品", "T2");
  evidence("capture", "t2-after");

  // T3：再次 dense（幂等/不重复移动）
  evidence("capture", "t3-before");
  const t3 = await sendAuthorInput(TEXTS.t3, "T3");
  const t3Pending = pendingOf(t3.turnResult).find((entry) => entry.artifact_type === "chapter_structure_change_plan");
  if (t3Pending) {
    await waitCandidateVisible({ textPattern: /章节重编号变更计划/u, label: "T3", buttonLabel: "保存到作品" });
    await capture("T3-candidate");
    await adoptCandidate(t3Pending.artifact_id, "保存到作品", "T3");
  } else {
    await waitVisible(/章节|编号/u, 60_000, "T3:no-change-visible");
    await capture("T3-no-candidate");
  }
  evidence("capture", "t3-after");

  // T4：刷新（关闭重开）+ 目录/阅读消费者
  evidence("capture", "t4-before-refresh");
  await restartApp("T4");
  await ensureWork(WORK_A_TITLE, "T4:restored");
  await waitVisible(/把第2卷章节编号理顺/u, 60_000, "T4:transcript-restored");
  await capture("T4-refreshed");
  evidence("capture", "t4-after-refresh");
  await openArchiveTab("大纲与结构", /已采纳章节计划/u, "T4");
  await capture("T4-archive-toc");
  await closeArchive("T4");
  await openReadingMode("T4");
  await clickReadingChapter("第12章：旧钱与旧名", /旧钱锚点/u, "T4-ch12");
  await capture("T4-reading-12");
  await clickReadingChapter("第11章：外门名册上的空白", /门册空白锚点/u, "T4-ch11");
  await capture("T4-reading-11");
  await closeReadingMode("T4");
  await capture("T4-back-to-workbench");

  // T5：负例矩阵
  for (const negative of TEXTS.t5) {
    evidence("capture", `t5-before-${negative.id}`);
    const turn = await sendAuthorInput(negative.text, `T5:${negative.id}`);
    const assistantText = String(turn.turnResult?.assistant_message?.text ?? "");
    await waitVisible(/无法确定|没有找到|超出当前作品结构|多个候选|请指出/u, 60_000, `T5:${negative.id}:refusal`);
    await capture(`T5-${negative.id}`);
    if (assistantText) log.push({ op: "negative_assistant_text", id: negative.id, text: assistantText });
    evidence("capture", `t5-after-${negative.id}`);
  }

  // T8：档案类型边界（正文/修订类候选不得出现在「待保存大纲」）
  evidence("capture", "t8-before");
  const t8 = await sendAuthorInput(TEXTS.t8, "T8");
  const t8Pending = pendingOf(t8.turnResult).find((entry) =>
    ["prose_fragment", "scene_draft", "prose_formatting_plan"].includes(entry.artifact_type),
  );
  if (!t8Pending) throw new Error(`t8_content_candidate_missing:${pendingOf(t8.turnResult).map((entry) => entry.artifact_type).join(",")}`);
  await waitVisible(t8Pending.title ?? /章节正文草稿|修订稿|分段方案/u, 60_000, "T8:candidate");
  await capture("T8-workspace-card");
  evidence("capture", "t8-after");
  await openArchiveTab("大纲与结构", /已采纳章节计划|规划下一卷/u, "T8");
  await capture("T8-archive-outline");
  await closeArchive("T8");

  // T6：卷蓝图/类型边界（真实规划卷章 + 规划下一卷 + harness）
  evidence("capture", "t6-before");
  await ensureWork(WORK_B_TITLE, "T6");
  await openArchiveTab("大纲与结构", /规划卷章结构/u, "T6");
  await capture("T6-b-archive");
  const t6Plan = await clickPlanVolumes("T6:first");
  const t6PlanPending = requirePending(t6Plan.turnResult, "outline_draft", "T6:first");
  await waitCandidateVisible({ textPattern: /大纲|章节/u, label: "T6:first", buttonLabel: "保存到大纲" });
  await capture("T6-plan-candidate");
  const positiveArchive = await openArchiveTab("大纲与结构", /待保存大纲/u, "T6:positive");
  await capture("T8-archive-outline-positive");
  void positiveArchive;
  await adoptCandidate(t6PlanPending.artifact_id, "保存到大纲", "T6:first");
  evidence("capture", "t6-after-plan");
  await capture("T6-after-plan");
  await openArchiveTab("大纲与结构", /已采纳章节计划/u, "T6:after-plan");
  await capture("T6-after-plan-archive");
  await closeArchive("T6:after-plan");
  await openArchiveTab("大纲与结构", /规划下一卷/u, "T6:next-button");
  await capture("T6-next-volume-button");
  await clickPlanNextVolume("T6:next");
  await waitCandidateVisible({ textPattern: /大纲/u, label: "T6:next", buttonLabel: "保存到大纲" });
  await capture("T6-next-candidate");
  const nextPending = await runStep("maintenance", "T6:next_pending", () => {
    const wire = transport();
    const results = wire.filter(
      (entry) =>
        entry.direction === "received" &&
        Array.isArray(entry.frame) &&
        entry.frame[3] === "turn_result" &&
        entry.frame[4]?.tool_result?.tool_name === "plot_outline" &&
        entry.frame[4]?.tool_result?.output?.artifact_type === "outline_draft",
    );
    const result = results.at(-1)?.frame?.[4];
    const pending = (result?.adoption_state?.pending ?? []).find((entry) => entry.artifact_type === "outline_draft");
    if (!pending) throw new Error("next_volume_candidate_missing");
    return pending;
  });
  await adoptCandidate(nextPending.artifact_id, "保存到大纲", "T6:next");
  evidence("capture", "t6-after-next");
  await capture("T6-after-next");
  await openArchiveTab("大纲与结构", /已采纳章节计划/u, "T6:after-next");
  await capture("T6-after-next-archive");
  await closeArchive("T6:after-next");
  evidence("capture", "final");
  await capture("B30-final");
  writeJson("b30-native-driver-log.json", { slice_id: sliceId, finished_at: nowIso(), captures: log });
}

// ── 场景 2：卷蓝图/类型边界（B1 真实页面 + B2 harness）───────────────────────
async function runBlueprintScenario() {
  evidence("prepare", sliceId);
  await runStep("maintenance", "launch_app", launchEmbeddedApp);
  await ensureWork(WORK_B_TITLE, "initial");
  await capture("B0-workbench");
  evidence("capture", "b-before");
  await openArchiveTab("大纲与结构", /规划卷章结构/u, "B1");
  await capture("B-archive-before");
  const plan = await clickPlanVolumes("B1:first");
  const planPending = requirePending(plan.turnResult, "outline_draft", "B1:first");
  await waitCandidateVisible({ textPattern: /大纲|章节/u, label: "B1:first", buttonLabel: "保存到大纲" });
  await capture("B-plan-candidate");
  await openArchiveTab("大纲与结构", /待保存大纲/u, "B1:pending");
  await capture("B-archive-pending-plan");
  await adoptCandidate(planPending.artifact_id, "保存到大纲", "B1:first");
  evidence("capture", "b-after-plan");
  await capture("B-after-plan");
  await openArchiveTab("大纲与结构", /已采纳章节计划/u, "B1:after-plan");
  await capture("B-archive-after-plan");
  await closeArchive("B1:after-plan");
  await openArchiveTab("大纲与结构", /规划下一卷/u, "B1:next-button");
  await capture("B-next-volume-button");
  await clickPlanNextVolume("B1:next");
  await waitCandidateVisible({ textPattern: /大纲/u, label: "B1:next", buttonLabel: "保存到大纲" });
  await capture("B-next-candidate");
  const nextPending = await runStep("maintenance", "B1:next_pending", () => {
    const wire = transport();
    const results = wire.filter(
      (entry) =>
        entry.direction === "received" &&
        Array.isArray(entry.frame) &&
        entry.frame[3] === "turn_result" &&
        entry.frame[4]?.tool_result?.tool_name === "plot_outline" &&
        entry.frame[4]?.tool_result?.output?.artifact_type === "outline_draft",
    );
    const result = results.at(-1)?.frame?.[4];
    const pending = (result?.adoption_state?.pending ?? []).find((entry) => entry.artifact_type === "outline_draft");
    if (!pending) throw new Error("next_volume_candidate_missing");
    return pending;
  });
  await adoptCandidate(nextPending.artifact_id, "保存到大纲", "B1:next");
  evidence("capture", "b-after-next");
  await capture("B-after-next");
  await openArchiveTab("大纲与结构", /已采纳章节计划/u, "B1:after-next");
  await capture("B-archive-after-next");
  await closeArchive("B1:after-next");
  evidence("capture", "final");
  await capture("B-final");
  writeJson("b30-native-driver-log.json", { slice_id: sliceId, finished_at: nowIso(), captures: log });
}

// ── Strata 真实模型 scoped：T1 正例 + 第九卷澄清负例（不重跑确定性矩阵）──────────
const AUTHOR_QUESTION_REPLY_DEFAULT = "按当前卷的章节顺序按真实 seq 理顺编号，内容与标题文本不动";
const authorQuestionEvents = [];

const AUTHOR_QUESTION_CONTROL = /^(回复此问题|自行补充|发送回复|取消|关闭|为什么)$/u;

function findQuestionGroup(nodes) {
  const group = nodes.find(
    (node) => node.role === "AXGroup" && (node.title === "回复此问题" || String(node.value ?? "") === "回复此问题"),
  );
  if (group) return group;
  return nodes.find((node) => node.role === "AXButton" && (node.title === "回复此问题" || String(node.value ?? "") === "回复此问题")) ?? null;
}

function groupDescendantButtons(nodes, group) {
  if (!group) return [];
  const index = nodes.indexOf(group);
  if (index < 0) return [];
  const buttons = [];
  for (let i = index + 1; i < nodes.length && nodes[i].depth > group.depth; i += 1) {
    if (nodes[i].role === "AXButton") buttons.push(nodes[i]);
  }
  return buttons;
}

function questionTextBefore(nodes, group) {
  if (!group) return "";
  const index = nodes.indexOf(group);
  const texts = [];
  for (let i = Math.max(0, index - 8); i < index; i += 1) {
    const node = nodes[i];
    if (node.role === "AXStaticText") {
      const value = String(node.value ?? node.title ?? "").trim();
      if (value && !/^(AI|你|回复此问题)$/u.test(value)) texts.push(value);
    }
  }
  return texts.slice(-2).join(" / ");
}

// 作者问题仍在等待回复的可见信号（作者视角）。
function questionAwaiting(nodes) {
  return /仍待回复的问题|个?任务等待回复|请在问题中选择或回复/u.test(axText(nodes));
}

function findFreeTextReplyComposer(nodes) {
  return (
    nodes.find(
      (node) =>
        node.role === "AXTextField" &&
        !/输入你的想法、问题或指令/u.test(String(node.desc ?? "")) &&
        /补充|回复|问题/u.test(String(node.desc ?? "")),
    ) ??
    nodes.find((node) => node.role === "AXTextField" && !/输入你的想法、问题或指令/u.test(String(node.desc ?? ""))) ??
    null
  );
}

// 真实模型向作者提问时像作者一样应答：选项按钮取第一个（推荐项）；无选项时用作者默认
// 决策在“回复此问题”输入框作答。每次作答后等待问题态清除；≤2 次；不 cancel、不重发原指令。
async function settleAuthorQuestions(label) {
  let answered = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let nodes = dumpNodes();
    if (!questionAwaiting(nodes)) return answered;
    let group = findQuestionGroup(nodes);
    if (!group) return answered;
    const questionText = questionTextBefore(nodes, group);
    const collapsed = group.role !== "AXGroup";
    const event = await runStep("maintenance", `author_question:${label}:${attempt}`, async () => {
      if (collapsed) {
        safeClick(group, `${label}:expand-question:${attempt}`);
        await sleep(900);
        nodes = dumpNodes();
        group = findQuestionGroup(nodes);
        if (!group) throw new Error(`author_question_group_not_found:${label}`);
      }
      const startedAt = nowIso();
      const buttons = groupDescendantButtons(nodes, group);
      const option = buttons.find((node) => !AUTHOR_QUESTION_CONTROL.test(String(node.title ?? "")));
      let optionLabel = null;
      let replyText = AUTHOR_QUESTION_REPLY_DEFAULT;
      if (option) {
        optionLabel = String(option.title ?? "");
        replyText = optionLabel;
        safeClick(option, `${label}:option:${attempt}`);
      } else {
        const replyButton = buttons.find((node) => String(node.title ?? "") === "回复此问题") ?? group;
        safeClick(replyButton, `${label}:reply-entry:${attempt}`);
        await sleep(900);
        let replyNodes = dumpNodes();
        let composer = findFreeTextReplyComposer(replyNodes);
        if (!composer) {
          const supplement = replyNodes.find(
            (node) => node.role === "AXButton" && String(node.title ?? "") === "自行补充",
          );
          if (supplement) {
            safeClick(supplement, `${label}:supplement:${attempt}`);
            await sleep(900);
            replyNodes = dumpNodes();
            composer = findFreeTextReplyComposer(replyNodes);
          }
        }
        if (!composer) throw new Error(`author_question_free_text_ui_not_found:${label}`);
        safeClick(composer, `${label}:question-composer:${attempt}`);
        await sleep(250);
        typeText(APP, AUTHOR_QUESTION_REPLY_DEFAULT);
        await sleep(500);
        const sendNodes = dumpNodes();
        const sendReply = sendNodes.find(
          (node) =>
            node.role === "AXButton" &&
            (String(node.title ?? "") === "发送回复" ||
              String(node.value ?? "") === "发送回复" ||
              /^发送/u.test(String(node.title ?? ""))),
        );
        if (sendReply) safeClick(sendReply, `${label}:send-reply:${attempt}`);
        else pressKey(APP, "return");
      }
      const action = await pollWire(
        (wire) =>
          wire.find(
            (record) =>
              record.direction === "sent" &&
              frameOf(record) &&
              record.at >= startedAt &&
              (record.frame[3] === "author_action" || record.frame[3] === "agent_command"),
          ) ?? null,
        60_000,
        `${label}:author_question_action`,
      );
      const record = {
        label,
        attempt,
        at: nowIso(),
        question_text: questionText,
        action_event: action.frame[3],
        question_ref: action.frame[4]?.action?.payload?.question_ref ?? null,
        source_turn_ref: action.frame[4]?.action?.source_turn_ref ?? action.frame[4]?.source_turn_ref ?? null,
        option_label: optionLabel,
        reply_text: replyText,
        submission_id: action.frame[4]?.action?.payload?.submission_id ?? null,
      };
      authorQuestionEvents.push(record);
      writeJson("author_question_events.json", authorQuestionEvents);
      return record;
    });
    void event;
    answered += 1;
    // 作答后等待“问题等待回复”可见信号消失（run 继续并产出后续 turn_result）；
    // 若模型又提出下一个问题，信号仍在 → 交给下一轮 attempt 继续作答（≤2）。
    const cleared = await runStep("maintenance", `author_question_settle:${label}:${attempt}`, async () => {
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        checkSupervisor();
        let current = null;
        try {
          current = dumpNodes();
        } catch {
          await sleep(800);
          continue;
        }
        if (!questionAwaiting(current)) return true;
        await sleep(900);
      }
      return false;
    });
    if (cleared) return answered;
  }
  if (questionAwaiting(dumpNodes())) throw new Error(`author_question_not_resolved:${label}`);
  return answered;
}

function pendingPlanSince(wire, sinceIso) {
  const sinceMs = Date.parse(sinceIso) - 2_000;
  const turns = wire
    .filter(
      (record) =>
        record.direction === "received" &&
        frameOf(record) &&
        record.frame[3] === "turn_result" &&
        Date.parse(record.at) >= sinceMs,
    )
    .map((record) => record.frame[4]);
  const pending = turns.flatMap((turn) => turn?.adoption_state?.pending ?? []);
  return pending.find((entry) => entry?.artifact_type === "chapter_structure_change_plan") ?? null;
}

function lastAssistantTextSince(wire, sinceIso) {
  const sinceMs = Date.parse(sinceIso) - 2_000;
  const turns = wire
    .filter(
      (record) =>
        record.direction === "received" &&
        frameOf(record) &&
        record.frame[3] === "turn_result" &&
        Date.parse(record.at) >= sinceMs,
    )
    .map((record) => record.frame[4]);
  return String(turns.at(-1)?.assistant_message?.text ?? "");
}

async function waitStrataPlanCandidate(sinceIso, label) {
  const pending = await runStep("candidate", `candidate:${label}`, () =>
    pollWire((wire) => pendingPlanSince(wire, sinceIso), T.candidate, `${label}:pending`),
  );
  await runStep("candidate", `candidate_visible:${label}`, () =>
    pollAx(
      (text) => /章节重编号变更计划/u.test(text) && text.includes("保存到作品"),
      T.candidate,
      `${label}:visible`,
    ),
  );
  return pending;
}

async function cleanupStrata(stage) {
  if (!STRATA) return null;
  try {
    const record = unloadStrataModel(dir);
    log.push({ op: "strata_unload", stage, loaded_after: record.loaded_after, unloaded: record.unloaded });
    console.log(`[strata] unload stage=${stage} loaded_after=${String(record.loaded_after)}`);
    return record;
  } catch (error) {
    log.push({ op: "strata_unload_failed", stage, error: error.message });
    console.error(`[strata] unload failed stage=${stage}: ${error.message}`);
    return null;
  }
}

async function runStrataScopedScenario() {
  assert.equal(sliceId, S1, "strata scoped 批次仅注册 B30 重编号场景");
  evidence("prepare", sliceId);
  await runStep("maintenance", "launch_app", launchEmbeddedApp);
  await ensureWork(WORK_A_TITLE, "initial");
  await capture("T0-workbench");

  // T1：真实模型 original「把第2卷章节编号理顺，内容不要动」→ judgment maintain →
  // 可审阅 old→new 候选 → 原生「保存到作品」→ seq 按映射更新、身份/正文/摘要不变。
  evidence("capture", "t1-before");
  const t1StartedAt = nowIso();
  const t1 = await sendAuthorInput(TEXTS.t1, "T1-real");
  log.push({ op: "t1_real_turn", at: nowIso(), turn_id: t1.turnId });
  const t1Questions = await settleAuthorQuestions("T1");
  const t1Pending = await waitStrataPlanCandidate(t1StartedAt, "T1-real");
  log.push({ op: "t1_real_pending", artifact_id: t1Pending.artifact_id, mapping: t1Pending.payload?.change_plan?.mapping ?? null });
  await capture("T1-candidate");
  const adoption = await adoptCandidate(t1Pending.artifact_id, "保存到作品", "T1-real");
  log.push({ op: "t1_real_adoption", artifact_id: t1Pending.artifact_id, receipt_status: adoption.receipt?.status ?? null });
  await capture("T1-receipt");
  await sleep(600);
  evidence("capture", "t1-after");

  // T2：真实模型负例「把第九卷章节编号理顺，内容不要动」→ 澄清/可解释拒绝、零写入。
  evidence("capture", "t2-before");
  const t2StartedAt = nowIso();
  const t2 = await sendAuthorInput(TEXTS.t5.find((entry) => entry.id === "out_of_range_ninth_volume").text, "T2-real");
  log.push({ op: "t2_real_turn", at: nowIso(), turn_id: t2.turnId });
  const t2Questions = await settleAuthorQuestions("T2");
  const t2AssistantText = String(t2.turnResult?.assistant_message?.text ?? "");
  const t2Anchor = t2AssistantText.slice(0, Math.min(14, t2AssistantText.length));
  await runStep("maintenance", "visible:T2-real:clarify", () =>
    pollAx(
      (text) =>
        /没有找到|请指出|当前作品登记|无法确定|超出|请确认|没有可维护|无法/u.test(text) ||
        (t2Anchor.length >= 4 && text.includes(t2Anchor)),
      T.visible,
      "T2-real:clarify",
    ),
  );
  log.push({ op: "t2_real_assistant", assistant_text: lastAssistantTextSince(transport(), t2StartedAt) });
  await capture("T2-clarify");
  evidence("capture", "t2-after");

  await capture("B30-strata-final");
  evidence("capture", "final");
  writeJson("author_question_events.json", authorQuestionEvents);
  writeJson("b30-native-driver-log.json", {
    slice_id: sliceId,
    driver: "ax-native-system-ui",
    provider: "strata",
    model: process.env.NOVEL_STRATA_MODEL ?? "iq3_s",
    scope: "scoped_real_model",
    finished_at: nowIso(),
    t1_questions: t1Questions,
    t2_questions: t2Questions,
    author_question_events: authorQuestionEvents,
    captures: log,
  });
}

async function main() {
  if (STRATA) await runStrataScopedScenario();
  else if (sliceId === S1) await runRenumberScenario();
  else if (sliceId === S2) await runBlueprintScenario();
  else throw new Error(`unknown slice: ${sliceId}`);
  writeUiComplete(dir, {
    runRef: ready.run_ref,
    screenshots,
    driver: "ax-native-system-ui",
    scope: sliceId,
  });
  await cleanupStrata("completed");
  console.log(`B30 native driver completed: ${sliceId} provider=${STRATA ? "strata" : "slice_verify"}, screenshots=${screenshots.length}`);
}

main().catch(async (error) => {
  failing = true;
  try {
    activate(APP);
    await sleep(400);
    const nodes = dumpNodes();
    if (nodes.some((node) => node.role === "AXWindow")) {
      writeAX(nodes, path.join(dir, "failure.ax.txt"), APP);
      fs.writeFileSync(path.join(dir, "failure.text.txt"), axText(nodes));
      screenshot(APP, path.join(dir, "failure.jpg"));
    }
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
          slice_id: sliceId,
          reason: error.message,
          stack: String(error.stack ?? "").split("\n").slice(0, 6),
          captures,
          log_tail: log.slice(-12),
        },
        null,
        2,
      ),
    );
  }
  try {
    await cleanupStrata("failed");
  } catch {
    /* unload best-effort on failure */
  }
  console.error(error);
  process.exitCode = 1;
});
