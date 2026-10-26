// 原生 macOS 应用外部驱动（AX + CGEvent）：供“外部系统 UI 驱动真实 Tauri 窗口”的验收使用。
// 产品代码不读取本模块；驱动只使用用户可见语义（role/label/placeholder/可见文本）操作真实窗口。
// 需要系统「辅助功能」权限；编译见 scripts/lib/native_ui/build.sh。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const CUA = path.join(ROOT, "artifacts/tools/ax_cua");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cua(args) {
  if (!fs.existsSync(CUA)) {
    execFileSync("bash", [path.join(ROOT, "scripts/lib/native_ui/build.sh")], { cwd: ROOT, stdio: "ignore" });
  }
  return execFileSync(CUA, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: ROOT }).trim();
}
export function appPid(name) { try { return JSON.parse(cua(["pid", name])).pid; } catch { return null; } }
export function waitForApp(name, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (appPid(name)) return true; execFileSync("sleep", ["0.5"]); }
  return false;
}
export function dump(name, maxNodes = 6000) { return JSON.parse(cua(["dump", name, String(maxNodes)])); }
export function dumpAll(name, maxNodes = 8000) { return JSON.parse(cua(["dumpall", name, String(maxNodes)])); }
export function textOf(node) { return [node.title, node.desc, node.value].filter((x) => x && String(x).trim()).join(" "); }
export function find(nodes, predicate) { return nodes.find(predicate) ?? null; }
export function findAll(nodes, predicate) { return nodes.filter(predicate); }
export function findByText(nodes, text, { role = null, exact = false } = {}) {
  return find(nodes, (n) => (!role || n.role === role) && (exact ? n.value === text || n.title === text : textOf(n).includes(text)));
}
export function click(node, appName, action = "AXPress") { return JSON.parse(cua(["click", appName, node.path, action])); }
export function clickAt(appName, x, y, count = 1) { return JSON.parse(cua(["clickxy", appName, String(Math.round(x)), String(Math.round(y)), String(count)])); }
export function clickText(nodes, text, appName, opts) {
  const node = findByText(nodes, text, opts);
  if (!node) throw new Error(`clickText not found: ${text}`);
  click(node, appName);
  return node;
}
export function screenshot(appName, filePath) {
  const res = JSON.parse(cua(["screenshot", appName, filePath]));
  if (!res.ok) throw new Error(`screenshot failed: ${filePath}`);
  return filePath;
}
export function typeText(appName, text) { cua(["type", appName, text]); }
export function pressKey(appName, key) { cua(["key", appName, key]); }
export function activate(appName) { try { cua(["activate", appName]); } catch { /* ignore */ } }
export async function waitUntil(appName, predicate, timeoutMs, label = "condition", intervalMs = 700) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = dump(appName);
    if (predicate(nodes)) return nodes;
    await sleep(intervalMs);
  }
  throw new Error(`waitUntil timeout: ${label}`);
}
// 证据落盘：与既有 native_*.ax.txt 同风格的可读 AX 树（行首缩进 + path + role + 可见文本）。
export function writeAX(nodes, filePath, appName = "AI Novel Studio") {
  const lines = [`Window: "${appName}", App: ${appName}.`];
  for (const n of nodes) {
    const bits = [];
    if (n.role) bits.push(n.role);
    if (n.title) bits.push(n.title);
    if (n.subrole) bits.push(`subrole=${n.subrole}`);
    if (n.desc && n.desc !== n.title) bits.push(`Description: ${n.desc}`);
    if (n.value) bits.push(`Value: ${n.value}`);
    if ((n.actions ?? []).length) bits.push(`Actions: ${n.actions.join(", ")}`);
    lines.push(`${"\t".repeat(Math.min(n.depth, 12))}${n.path} ${bits.join(", ")}`);
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
  return filePath;
}
export function dumpWrite(appName, filePath, maxNodes = 6000) {
  const nodes = dump(appName, maxNodes);
  writeAX(nodes, filePath, appName);
  return nodes;
}
export function jsonWrite(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
export function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
// B37 分型等待账：外部驱动必须登记 begin/finish，监督据此 fail-fast 且记录 wait-events。
export function waitLedger(dir, action, ...args) {
  return execFileSync("node", [path.join(ROOT, "scripts/native_ui_wait.mjs"), action, dir, ...args], { encoding: "utf8", cwd: ROOT }).trim();
}
export class Step {
  constructor(dir) { this.dir = dir; this.id = null; }
  begin(kind, label) { this.id = waitLedger(this.dir, "begin", kind, label); return this.id; }
  finish() { if (this.id) waitLedger(this.dir, "finish", this.id); this.id = null; }
  async run(kind, label, fn) { this.begin(kind, label); try { return await fn(); } finally { this.finish(); } }
}
