// 原生外部输入的目标归属与授权纯策略。
//
// 这里不启动 App、不读取真实 AX、不发事件；只消费 ready、进程/权限/焦点事实，
// 把「是否允许投递、投给哪个 PID」固定成可测试的纯函数。真实投递在 driver.mjs
// 注入的 Swift 适配器里执行；Swift 会在每次投递/分块前重新核验同一 target。
import fs from "node:fs";
import path from "node:path";

export const TARGET_SCHEMA = "native-input-target/v1";
export const INPUT_EVENT_SCHEMA = "native-input-event/v1";

const POST_GESTURES = new Set(["insert", "key", "click_at", "scroll"]);
const AX_GESTURES = new Set(["click", "focus", "set", "scroll_to"]);
// macOS pid_t 是 Int32；0/负数/小数/超范围都不是可持有的进程身份。
const PID_MAX = 2147483647;

export function isValidPid(value) {
  return Number.isInteger(value) && value > 0 && value <= PID_MAX;
}

function requirePid(value) {
  if (!isValidPid(value)) throw new OwnershipError("target_pid_invalid", { pid: value });
  return value;
}

function requireGeneration(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new OwnershipError("target_generation_invalid", { generation: value });
  }
  return value;
}

export class OwnershipError extends Error {
  constructor(reason, details = {}) {
    super(reason);
    this.name = "OwnershipError";
    this.reason = reason;
    this.details = details;
  }
}

export function normalizePath(value) {
  const resolved = path.resolve(String(value));
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function requireAbsolute(value, reason) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new OwnershipError(reason);
  return value;
}

function requireRealFile(value, reason) {
  try {
    return fs.realpathSync(value);
  } catch {
    throw new OwnershipError(reason);
  }
}

function freezeTarget(target) {
  const pid = target.pid == null ? null : requirePid(target.pid);
  const generation = requireGeneration(target.generation);
  return Object.freeze({
    schema: TARGET_SCHEMA,
    artifact_dir: target.artifact_dir,
    run_ref: target.run_ref,
    bundle_identifier: target.bundle_identifier,
    app_path: target.app_path,
    executable_path: target.executable_path,
    native_executable: target.native_executable,
    pid,
    generation,
  });
}

// 只接受本批 ready 的绝对 app_path；由它推导唯一 executable，绝不用 bundle/name 猜。
function readySource(ready) {
  if (!ready || typeof ready !== "object") throw new OwnershipError("ready_invalid");
  if (ready.driver !== "external-system-ui") throw new OwnershipError("ready_driver_invalid");
  return ready;
}

function readyIdentity(ready) {
  if (typeof ready.run_ref !== "string" || ready.run_ref.trim() === "") {
    throw new OwnershipError("run_ref_missing");
  }
  if (typeof ready.bundle_identifier !== "string" || ready.bundle_identifier.trim() === "") {
    throw new OwnershipError("bundle_identifier_missing");
  }
  const nativeExecutable = ready.native_executable ?? "app";
  if (!["app", "native-app"].includes(nativeExecutable)) {
    throw new OwnershipError("native_executable_invalid");
  }
  return {
    run_ref: ready.run_ref,
    bundle_identifier: ready.bundle_identifier,
    native_executable: nativeExecutable,
  };
}

function readyMetadata(ready) {
  return readyIdentity(readySource(ready));
}

function readyPaths(ready, artifactDir) {
  const rawAppPath = requireAbsolute(ready.app_path, "app_path_not_absolute");
  const artifact = requireRealFile(path.resolve(artifactDir), "artifact_dir_missing");
  const appPath = requireRealFile(rawAppPath, "app_path_missing");
  if (!appPath.startsWith(`${artifact}${path.sep}`)) throw new OwnershipError("app_path_outside_batch");
  const executablePath = requireRealFile(
    path.join(appPath, "Contents", "MacOS", ready.native_executable),
    "target_executable_missing",
  );
  if (path.dirname(path.dirname(path.dirname(executablePath))) !== appPath) {
    throw new OwnershipError("executable_not_in_app");
  }
  return { artifact, appPath, executablePath };
}

export function buildTarget(ready, artifactDir) {
  const meta = readyMetadata(ready);
  const paths = readyPaths({ ...ready, ...meta }, artifactDir);
  return freezeTarget({
    artifact_dir: paths.artifact,
    run_ref: meta.run_ref,
    bundle_identifier: meta.bundle_identifier,
    app_path: paths.appPath,
    executable_path: paths.executablePath,
    native_executable: meta.native_executable,
    pid: null,
    generation: 0,
  });
}

export function resolveOwnedProcess(target, processes = []) {
  const expected = normalizePath(target.executable_path);
  const matches = processes.filter((proc) => normalizePath(proc.executable_path ?? proc.command ?? "") === expected);
  if (matches.length === 0) throw new OwnershipError("target_not_running", { expected });
  if (matches.length > 1) throw new OwnershipError("target_ambiguous", { pids: matches.map((proc) => proc.pid) });
  return matches[0];
}

function uniqueResolutionMatch(resolution = {}) {
  const matches = Array.isArray(resolution.matches) ? resolution.matches : [];
  if (matches.length === 0) throw new OwnershipError("target_not_running");
  if (matches.length > 1) {
    throw new OwnershipError("target_ambiguous", { pids: matches.map((match) => match.pid) });
  }
  return matches[0];
}

function validateResolutionMatch(target, match) {
  const actualPath = match.executable_path;
  if (typeof actualPath !== "string") {
    throw new OwnershipError("target_path_mismatch", { expected: target.executable_path });
  }
  if (normalizePath(actualPath) !== target.executable_path) {
    throw new OwnershipError("target_path_mismatch", { expected: target.executable_path });
  }
  if (match.bundle_identifier && match.bundle_identifier !== target.bundle_identifier) {
    throw new OwnershipError("target_bundle_mismatch");
  }
}

function checkResolution(target, resolution = {}) {
  const match = uniqueResolutionMatch(resolution);
  requirePid(match.pid);
  if (resolution.pid !== undefined && Number(resolution.pid) !== Number(match.pid)) {
    throw new OwnershipError("target_process_changed", { expected: resolution.pid, actual: match.pid });
  }
  validateResolutionMatch(target, match);
  return match;
}

// 首次绑定只接受未绑定 target 或同 PID 幂等；不同 PID 必须走显式 relaunch。
export function bindTarget(target, resolution) {
  const match = checkResolution(target, resolution);
  const pid = requirePid(match.pid);
  if (target.pid != null) {
    requirePid(target.pid);
    requireGeneration(target.generation);
    if (pid !== target.pid) {
      throw new OwnershipError("target_already_bound", { expected: target.pid, actual: pid });
    }
    return target;
  }
  return freezeTarget({ ...target, pid, generation: target.generation });
}

// 只有显式 relaunch 才进入下一代；旧代请求仍会因 generation 不符被拒。
export function relaunchTarget(target, resolution) {
  const match = checkResolution(target, resolution);
  const pid = requirePid(match.pid);
  if (target.pid != null) requirePid(target.pid);
  const generation = requireGeneration(target.generation);
  return freezeTarget({ ...target, pid, generation: generation + 1 });
}

function triStateEnabled(focus) {
  if (focus.enabled === true || focus.enabled === false) return focus.enabled;
  return null;
}

function reject(reason) {
  return { allowed: false, reason };
}

function requestIdentityFailure(target, request) {
  if (!target || target.schema !== TARGET_SCHEMA) return "target_schema_invalid";
  if (target.pid == null) return "target_unbound";
  if (!isValidPid(target.pid)) return "target_pid_invalid";
  if (!request || typeof request !== "object") return "request_invalid";
  if (request.generation !== target.generation) return "generation_mismatch";
  if (Number(request.pid) !== Number(target.pid)) return "pid_mismatch";
  return null;
}

function matchIdentityFailure(target, match) {
  if (!isValidPid(match.pid) || Number(match.pid) !== Number(target.pid)) return "target_process_changed";
  if (typeof match.executable_path !== "string") return "target_path_mismatch";
  if (normalizePath(match.executable_path) !== target.executable_path) return "target_path_mismatch";
  if (match.bundle_identifier && match.bundle_identifier !== target.bundle_identifier) {
    return "target_bundle_mismatch";
  }
  return null;
}

function resolutionFailure(target, resolution) {
  const matches = Array.isArray(resolution?.matches) ? resolution.matches : [];
  if (matches.length === 0) return "target_not_running";
  if (matches.length > 1) return "target_ambiguous";
  return matchIdentityFailure(target, matches[0]);
}

function permissionFailure(request, permissions) {
  // 授权事实只接受显式 boolean true；'false'/1 等 truthy 未知值不能 grant。
  if (permissions?.ax_trusted !== true) return "ax_trust_required";
  if (POST_GESTURES.has(request.gesture) && permissions.post_access !== true) return "post_access_required";
  if (!POST_GESTURES.has(request.gesture) && !AX_GESTURES.has(request.gesture) && request.gesture !== "activate") {
    return "gesture_unknown";
  }
  return null;
}

function foregroundFailure(request, frontmost, target) {
  if (request.gesture === "activate") return null;
  // probe 的唯一前台观测字段是 top-level frontmost；它不是 activate 的操作结果。
  if (!frontmost || typeof frontmost !== "object") return "frontmost_missing";
  if (!isValidPid(frontmost.pid)) return "frontmost_invalid";
  if (Number(frontmost.pid) !== Number(target.pid)) return "not_frontmost";
  if (frontmost.bundle_identifier !== target.bundle_identifier) return "frontmost_bundle_mismatch";
  return null;
}

function expectedFocusFailure(expected = {}, focus) {
  if (expected.role && focus.role !== expected.role) return "focus_role_mismatch";
  if (expected.path && focus.path !== expected.path) return "focus_path_mismatch";
  if (expected.desc_contains && !String(focus.desc).includes(expected.desc_contains)) {
    return "focus_desc_mismatch";
  }
  return null;
}

function focusFailure(request, focus, target) {
  if (!focus) return "focus_missing";
  if (Number(focus.pid) !== Number(target.pid)) return "focus_owner_mismatch";
  if (focus.matches !== true) return "focus_mismatch";
  const expectedFailure = expectedFocusFailure(request.expected_focus, focus);
  if (expectedFailure) return expectedFailure;
  if (triStateEnabled(focus) === false) return "composer_disabled";
  // enabled 未知时用 AXValue 可写性补证；两者都缺就停在未确认，绝不当成功。
  if (triStateEnabled(focus) !== true && focus.value_settable !== true) return "composer_state_unconfirmed";
  return null;
}

export function authorizeInput({ target, request, resolution, frontmost, permissions, focus } = {}) {
  const reason = requestIdentityFailure(target, request)
    ?? resolutionFailure(target, resolution)
    ?? permissionFailure(request, permissions)
    ?? foregroundFailure(request, frontmost, target)
    ?? (request.focus_required ? focusFailure(request, focus, target) : null);
  return reason ? reject(reason) : { allowed: true };
}

// 按 UTF-16 code unit 分块（与既有 Swift 投递一致），但不拆代理对。
export function splitUtf16Chunks(text, maxUnits = 16) {
  if (typeof text !== "string") throw new TypeError("text_must_be_string");
  if (!Number.isInteger(maxUnits) || maxUnits < 2) throw new TypeError("chunk_size_invalid");
  const chunks = [];
  let current = "";
  let units = 0;
  for (const char of text) {
    const width = char.length;
    // maxUnits >= 2 且单个 code point 至多 2 单元，所以 units+width 超限时必已有内容；
    // 不再保留一个恒真的 units>0 分支，避免无意义等价回退。
    if (units + width > maxUnits) {
      chunks.push(current);
      current = "";
      units = 0;
    }
    current += char;
    units += width;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function composerExpectation(node) {
  if (!node || typeof node !== "object") throw new OwnershipError("composer_missing");
  return {
    role: "AXTextField",
    path: node.path,
    desc_contains: "输入",
  };
}

// 明确区分「字段缺失=undefined」与真实 false/0/空串，避免用 || 把合法 falsy 吞掉。
function valueOr(value, fallback) {
  return value === undefined ? fallback : value;
}

function targetEvent(target) {
  return {
    bundle_identifier: target.bundle_identifier,
    app_path: target.app_path,
    executable_path: target.executable_path,
    pid: target.pid,
  };
}

function activationEvent(activation) {
  return {
    requested: valueOr(activation.requested, false),
    returned: valueOr(activation.returned, null),
    confirmed: valueOr(activation.confirmed, false),
    frontmost_before: valueOr(activation.frontmost_before, null),
    frontmost_after: valueOr(activation.frontmost_after, null),
    waited_ms: valueOr(activation.waited_ms, null),
  };
}

function focusEvent(focus, expected) {
  return {
    pid: focus.pid,
    role: focus.role,
    path: focus.path,
    desc: focus.desc,
    enabled: triStateEnabled(focus),
    value_settable: valueOr(focus.value_settable, null),
    matches: valueOr(focus.matches, false),
    expected: valueOr(expected, null),
  };
}

function resultEvent(result) {
  return {
    ok: valueOr(result.ok, null),
    reason: valueOr(result.reason, null),
    method: valueOr(result.method, null),
    delivered_chunks: valueOr(result.delivered_chunks, null),
    input_length: valueOr(result.input_length, null),
  };
}

// Swift probe 的唯一观测事实：解析后只保留 target/resolution/permissions/frontmost/focus。
// activation 属于 input 操作结果，probe 里即使出现旧字段也不得进入授权或证据。
export function probeObservation(raw) {
  if (!raw || typeof raw !== "object") return raw;
  if (raw.ok === false) return raw;
  const observation = {
    ok: raw.ok,
    target: raw.target,
    resolution: raw.resolution,
    permissions: raw.permissions,
    frontmost: raw.frontmost,
  };
  if (raw.focus !== undefined) observation.focus = raw.focus;
  return observation;
}

// Swift input 操作结果的事实：activation 只来自本次操作；before/after 不互相顶替。
export function operationResultFacts(raw) {
  if (!raw || typeof raw !== "object") return {};
  return {
    activation: raw.activation,
    focus: raw.focus,
    permissions: raw.permissions,
    frontmost: raw.frontmost_after,
  };
}

export function inputEvent({ target, event, gesture, request = {}, facts = {}, result = {}, at }) {
  // attempt/rejected 是操作前观测；result 必须使用本次操作返回的 after 事实。
  const evidence = event === "result" ? operationResultFacts(result) : facts;
  const out = {
    schema: INPUT_EVENT_SCHEMA,
    at,
    event,
    run_ref: target.run_ref,
    gesture,
    generation: target.generation,
    target: targetEvent(target),
    result: resultEvent(result),
  };
  if (typeof request.text === "string") out.input_length = request.text.length;
  // activation 只是本次 input 操作的结果；attempt/rejected 的 probe 观测不得冒充它。
  if (event === "result" && evidence.activation) out.activation = activationEvent(evidence.activation);
  out.frontmost = valueOr(evidence.frontmost, null);
  if (evidence.focus) out.focus = focusEvent(evidence.focus, request.expected_focus);
  else out.focus = null;
  out.permissions = valueOr(evidence.permissions, null);
  return out;
}
