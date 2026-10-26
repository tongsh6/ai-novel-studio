// 原生工作台高复用动作：启动应用/等待工作台/切换初始作品/发送消息/打开档案/阅读/采集证据。
// 只依赖可见语义与只读测试数据准备；禁止产品验收钩子。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appPid, waitForApp, dump, writeAX, screenshot, textOf, findByText, click, typeText, pressKey, activate, waitUntil, sleep, jsonWrite, readJson } from "./driver.mjs";

export const APP = "AI Novel Studio";

export function launchApp(batchDir, { appName = APP, timeoutMs = 120_000 } = {}) {
  const ready = readJson(path.join(batchDir, "native-driver-ready.json"));
  execFileSync("open", [ready.app_path]);
  if (!waitForApp(appName, timeoutMs)) throw new Error("native_app_did_not_launch");
  activate(appName);
  return ready;
}

export async function waitWorkbench(appName = APP, timeoutMs = 180_000) {
  return waitUntil(appName, (ns) =>
    ns.some((n) => n.role === "AXWebArea") &&
    ns.some((n) => n.role === "AXTextField" && String(n.desc ?? "").includes("输入")),
  timeoutMs, "workbench_ready");
}

// 测试数据准备：把目标作品标为最近打开，使原生启动直接进入该作品（等价于上一批次经作品菜单切换）。
// 只改隔离副本 SQLite，不触碰产品代码/源库。
export function markWorkNewest(dbPath, workId) {
  execFileSync("python3", ["-c",
    "import sqlite3,sys,datetime; db=sqlite3.connect(sys.argv[1]); ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'; db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2])); db.commit(); db.close()",
    dbPath, workId]);
}

export function readDb(dbPath, sql, params = []) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}

export function composer(appName = APP) {
  const nodes = dump(appName);
  return nodes.find((n) => n.role === "AXTextField" && String(n.desc ?? "").includes("输入"));
}

// 从可见主输入发送一条消息（唯一一次由调用方保证）。
export async function sendMessage(appName, text) {
  const field = composer(appName);
  if (!field) throw new Error("composer_not_found");
  click(field, appName);
  await sleep(400);
  typeText(appName, text);
  await sleep(800);
  const nodes = dump(appName);
  const send = nodes.find((n) => n.role === "AXButton" && textOf(n).includes("发送"));
  if (send) click(send, appName); else pressKey(appName, "return");
  await sleep(800);
}

export function flatText(nodes) {
  return nodes.map(textOf).filter(Boolean).join("\n");
}

// 等待某个用户可见文案出现（用于判断回执/候选/澄清/完成）。
export async function waitText(appName, pattern, timeoutMs, label) {
  return waitUntil(appName, (ns) => pattern.test(flatText(ns)), timeoutMs, label, 1200);
}

export function capture(batchDir, name, appName = APP, maxNodes = 8000) {
  const nodes = dump(appName, maxNodes);
  writeAX(nodes, path.join(batchDir, `${name}.ax.txt`), appName);
  screenshot(appName, path.join(batchDir, `${name}.png`));
  return nodes;
}

export function archiveOpen(nodes) {
  return nodes.some((n) => textOf(n).includes("关闭档案"));
}

export async function openArchive(appName = APP, timeoutMs = 30_000) {
  let nodes = dump(appName);
  if (!archiveOpen(nodes)) {
    const button = findByText(nodes, "打开档案", { role: "AXButton" });
    if (!button) throw new Error("archive_button_not_found");
    click(button, appName);
    nodes = await waitUntil(appName, (ns) => archiveOpen(ns), timeoutMs, "archive_open");
  }
  return nodes;
}

export async function closeArchive(appName = APP) {
  const nodes = dump(appName);
  const button = findByText(nodes, "关闭档案", { role: "AXButton" }) ?? findByText(nodes, "关闭档案");
  if (button) click(button, appName);
  await sleep(600);
}

export async function openArchiveTab(appName, tabName) {
  const nodes = await openArchive(appName);
  const tab = findByText(nodes, tabName);
  if (!tab) throw new Error(`archive_tab_not_found: ${tabName}`);
  click(tab, appName);
  await sleep(800);
  return dump(appName);
}

export async function openReading(appName = APP) {
  let nodes = dump(appName);
  const button = findByText(nodes, "阅读", { role: "AXButton" });
  if (!button) throw new Error("reading_button_not_found");
  click(button, appName);
  return waitUntil(appName, (ns) => flatText(ns).includes("阅读模式"), 30_000, "reading_open");
}

export async function closeReading(appName = APP) {
  const nodes = dump(appName);
  const back = findByText(nodes, "返回工作台");
  if (back) click(back, appName);
  await sleep(600);
}

// 采证辅助：写出 native-ui-complete.json 让监督正常收尾。
export function writeUiComplete(batchDir, { runRef, screenshots, driver = "ax-native-system-ui", scope }) {
  jsonWrite(path.join(batchDir, "native-ui-complete.json"), {
    harness_run_ref: runRef, driver, app_bundle: "com.ai-novel-studio.app", screenshots, scope,
  });
}
