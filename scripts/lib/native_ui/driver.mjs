// 原生 macOS 应用外部驱动（AX + CGEvent）：供“外部系统 UI 驱动真实 Tauri 窗口”的验收使用。
// 产品代码不读取本模块；驱动只使用用户可见语义（role/label/placeholder/可见文本）操作真实窗口。
//
// 批次输入必须携带 NativeScenarioHarness 构造并绑定的 target（ready.app_path/run_ref/PID）。
// 没有 target 的字符串应用名只允许只读查询；输入函数遇到字符串会显式失败，不按名字猜目标。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OwnershipError,
  TARGET_SCHEMA,
  bindTarget,
  buildTarget,
  composerExpectation,
  probeObservation,
  relaunchTarget,
} from "./input_target.mjs";
import {
  NativeInputBoundary,
  adapterFailure,
  makeJsonlSink,
  parseAdapterJson,
} from "./input_boundary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const CUA = path.join(ROOT, "artifacts/tools/ax_cua");
const CUA_CORE = path.join(ROOT, "scripts/lib/native_ui/ax_cua_core.swift");
const CUA_ENTRY = path.join(ROOT, "scripts/lib/native_ui/ax_cua.swift");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cuaStale() {
  if (!fs.existsSync(CUA)) return true;
  const builtAt = fs.statSync(CUA).mtimeMs;
  return [CUA_CORE, CUA_ENTRY].some((source) => {
    try {
      return fs.statSync(source).mtimeMs > builtAt;
    } catch {
      return true;
    }
  });
}

function cua(args) {
  if (cuaStale()) {
    try {
      execFileSync("bash", [path.join(ROOT, "scripts/lib/native_ui/build.sh")], { cwd: ROOT, stdio: "ignore" });
    } catch (error) {
      throw adapterFailure(error, "build");
    }
  }
  try {
    return execFileSync(CUA, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: ROOT }).trim();
  } catch (error) {
    // execFileSync 的 message 会回显 argv；输入请求含 text/value，绝不能透传。
    throw adapterFailure(error, args[0]);
  }
}

function cuaJson(args) {
  return parseAdapterJson(cua(args), args[0]);
}

function isTarget(value) {
  return Boolean(value && typeof value === "object" && value.schema === TARGET_SCHEMA);
}

function ownedTarget(value) {
  if (!isTarget(value)) throw new OwnershipError("unowned_input_target");
  return value;
}

function swiftResolve(target) {
  return cuaJson(["resolve", JSON.stringify(target)]);
}

export { bindTarget, buildTarget, composerExpectation, relaunchTarget };

// 只读的目标解析：未运行返回 null；路径/多义/进程变化抛错，不退回名字匹配。
export function targetResolution(target) {
  return swiftResolve(ownedTarget(target));
}

// 启动事实只读观测：同一 target 的 NSRunningApplication 状态与 AXWindow/AXWebArea
// 出现事实；不 activate、不等待、不改变现场，也不作为 ready gate。
export function startupObservation(target) {
  return cuaJson(["startup", JSON.stringify(ownedTarget(target))]);
}

export function resolveTargetPid(target) {
  const result = swiftResolve(ownedTarget(target));
  if (result.ok) return Number(result.pid);
  if (result.reason === "target_not_running") return null;
  throw new OwnershipError(result.reason, { reason: result.reason });
}

// 启动后一次性显式绑定：只读解析当前 PID，再由调用方持有 bound target。
export function bindRunningTarget(target, { relaunch = false } = {}) {
  const owned = ownedTarget(target);
  const resolution = swiftResolve({ ...owned, pid: null });
  if (!resolution.ok) throw new OwnershipError(resolution.reason, { reason: resolution.reason });
  return relaunch ? relaunchTarget(owned, resolution) : bindTarget(owned, resolution);
}

export function appPid(nameOrTarget) {
  if (isTarget(nameOrTarget)) return resolveTargetPid(nameOrTarget);
  try { return cuaJson(["pid", nameOrTarget]).pid; } catch { return null; }
}
export function frontmost() {
  try { return cuaJson(["frontmost"]); } catch (error) {
    const reason = error instanceof OwnershipError ? error.reason : "adapter_failure";
    return { error: reason };
  }
}
export function waitForApp(nameOrTarget, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (appPid(nameOrTarget)) return true;
    execFileSync("sleep", ["0.5"]);
  }
  return false;
}
function arrayResult(value, fallbackReason) {
  if (Array.isArray(value)) return value;
  throw new OwnershipError(value?.reason ?? fallbackReason, value);
}

export function dump(nameOrTarget, maxNodes = 6000) {
  const args = isTarget(nameOrTarget)
    ? ["dump-target", JSON.stringify(nameOrTarget), String(maxNodes)]
    : ["dump", nameOrTarget, String(maxNodes)];
  return arrayResult(cuaJson(args), "dump_failed");
}
export function dumpAll(nameOrTarget, maxNodes = 8000) {
  const args = isTarget(nameOrTarget)
    ? ["dumpall-target", JSON.stringify(nameOrTarget), String(maxNodes)]
    : ["dumpall", nameOrTarget, String(maxNodes)];
  return arrayResult(cuaJson(args), "dump_all_failed");
}
export function focused(nameOrTarget) {
  return cuaJson(isTarget(nameOrTarget)
    ? ["focused-target", JSON.stringify(nameOrTarget)]
    : ["focused", nameOrTarget]);
}
export function textOf(node) { return [node.title, node.desc, node.value].filter((x) => x && String(x).trim()).join(" "); }
export function find(nodes, predicate) { return nodes.find(predicate) ?? null; }
export function findAll(nodes, predicate) { return nodes.filter(predicate); }
export function findByText(nodes, text, { role = null, exact = false } = {}) {
  return find(nodes, (n) => (!role || n.role === role) && (exact ? n.value === text || n.title === text : textOf(n).includes(text)));
}

// ── 真实输入边界 ─────────────────────────────────────────────────────────────
// Swift probe/input 的 JSON 只在这一处解析：probe 归一为观测事实，input 原始结果
// 交给 input_boundary 的 result 证据契约（activation/frontmost_after/focus）。
function swiftProbe(target, request) {
  return probeObservation(cuaJson(["probe", JSON.stringify(target), JSON.stringify(request)]));
}
function swiftDeliver(target, request) {
  return cuaJson(["input", JSON.stringify(target), JSON.stringify(request)]);
}
export function inputBoundary(target) {
  const owned = ownedTarget(target);
  // 未绑定输入在 resolver/投递前直接失败；启动探测只走只读 targetResolution。
  if (owned.pid == null) throw new OwnershipError("target_unbound");
  return new NativeInputBoundary({
    target: owned,
    probe: (request) => swiftProbe(owned, request),
    deliver: (request) => swiftDeliver(owned, request),
    sink: makeJsonlSink(path.join(owned.artifact_dir, "native-input-events.jsonl")),
  });
}

export function click(node, target, action = "AXPress") {
  if (!node) throw new Error("click_target_missing");
  return inputBoundary(target).click(node.path, action);
}
export function clickAt(target, x, y, count = 1) {
  return inputBoundary(target).clickAt(x, y, count);
}
export function scrollAt(target, x, y, dy) {
  return inputBoundary(target).scrollAt(x, y, dy);
}
export function scrollToPath(target, nodePath) {
  return inputBoundary(target).scrollTo(nodePath);
}
export function setValue(target, nodePath, value) {
  return inputBoundary(target).setValue(nodePath, value);
}
export function clickText(nodes, text, target, opts) {
  const node = findByText(nodes, text, opts);
  if (!node) throw new Error(`clickText not found: ${text}`);
  click(node, target);
  return node;
}
export function screenshot(nameOrTarget, filePath) {
  const result = cuaJson(isTarget(nameOrTarget)
    ? ["screenshot-target", JSON.stringify(nameOrTarget), filePath]
    : ["screenshot", nameOrTarget, filePath]);
  if (!result.ok) throw new Error(`screenshot failed: ${filePath}`);
  return filePath;
}

// 默认只要求当前焦点仍是可编辑文本框；rawTypeAndSend 传具体 composer path 做精确绑定。
const GENERIC_TEXT_FOCUS = { role: "AXTextField" };

export function typeText(target, text, expectedFocus = GENERIC_TEXT_FOCUS) {
  return inputBoundary(target).type(text, expectedFocus);
}

export function focus(node, target) {
  if (!node) throw new Error("focus_target_missing");
  return inputBoundary(target).focus(node.path, { role: node.role, path: node.path });
}

const FOCUSED_KEYS = new Set(["delete", "backspace", "cmd+a"]);

export function pressKey(target, key, { focusRequired = null, expectedFocus = GENERIC_TEXT_FOCUS } = {}) {
  const required = focusRequired ?? FOCUSED_KEYS.has(String(key).toLowerCase());
  return inputBoundary(target).key(key, { focusRequired: required, expected: required ? expectedFocus : null });
}

export function activate(target) {
  return inputBoundary(target).activate();
}

export async function waitUntil(nameOrTarget, predicate, timeoutMs, label = "condition", intervalMs = 700) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = dump(nameOrTarget);
    if (predicate(nodes)) return nodes;
    await sleep(intervalMs);
  }
  throw new Error(`waitUntil timeout: ${label}`);
}
// 证据落盘：与既有 native_*.ax.txt 同风格的可读 AX 树（行首缩进 + path + role + 可见文本）。
export function writeAX(nodes, filePath, appName = "AI Novel Studio") {
  const label = isTarget(appName) ? appName.bundle_identifier : appName;
  const lines = [`Window: "${label}", App: ${label}.`];
  for (const n of nodes) {
    const bits = [];
    if (n.role) bits.push(n.role);
    if (n.title) bits.push(n.title);
    if (n.subrole) bits.push(`subrole=${n.subrole}`);
    if (n.desc && n.desc !== n.title) bits.push(`Description: ${n.desc}`);
    if (n.value) bits.push(`Value: ${n.value}`);
    if (n.enabled === true) bits.push("enabled=true");
    else if (n.enabled === false) bits.push("disabled=true");
    else bits.push("enabled=unknown");
    if (n.focused === true) bits.push("focused=true");
    else if (n.focused === false) bits.push("focused=false");
    if ((n.actions ?? []).length) bits.push(`Actions: ${n.actions.join(", ")}`);
    lines.push(`${"\t".repeat(Math.min(n.depth, 12))}${n.path} ${bits.join(", ")}`);
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
  return filePath;
}
export function dumpWrite(nameOrTarget, filePath, maxNodes = 6000) {
  const nodes = dump(nameOrTarget, maxNodes);
  const label = isTarget(nameOrTarget) ? nameOrTarget.bundle_identifier : nameOrTarget;
  writeAX(nodes, filePath, label);
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
