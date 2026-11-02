// 原生批次的「精确 executable 归属」进程观测适配。
//
// 历史实现直接调用 /bin/ps（setuid 二进制）。在受限执行环境（如 DSH 会话沙箱）
// 中执行 setuid 二进制会被明确拒绝（EPERM），导致 batch 监督与 cleanup 与驱动
// 无关地失败。本模块严格优先 ps；只有 ps 被执行环境**明确拒绝**（EPERM/ENOENT/
// EACCES，或 spawn 失败且 message 明确为 operation not permitted / no such file）
// 时才退化为非 setuid 的 pgrep + lsof 组合，并把实际使用的方法与原因如实落盘。
//
// 两种方式的归属判据完全等价：进程的可执行文件路径必须与本批 executable 的
// realpath 精确相等。pgrep 只用于候选发现（按精确路径 pattern），最终归属一律由
// lsof 的 txt 实际路径判定；绝不按进程名、前缀或相似参数匹配，也不放宽
// cleanup 的 remaining=[] 断言。任何其它错误都向上抛出，不做静默降级。
import { execFileSync } from "node:child_process";
import fs from "node:fs";

export const PROCESS_OBSERVATION_SCHEMA = "native-process-observation/v1";

// 只有这些执行失败才允许 fallback：EPERM/EACCES 表示执行被拒绝，ENOENT 表示
// 该环境没有 ps 可执行文件。其它错误（例如 ps 自身非零退出）必须暴露。
const FALLBACK_CODES = new Set(["EPERM", "EACCES", "ENOENT"]);

function defaultExec(command, args) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function fallbackReason(error) {
  if (FALLBACK_CODES.has(error?.code)) return error.code;
  // 某些封装只保留 message；仅在明确是执行被拒/缺失时才当作 fallback 理由。
  const message = String(error?.message ?? "");
  if (/operation not permitted/i.test(message)) return "operation_not_permitted";
  if (/no such file or directory/i.test(message)) return "command_not_found";
  return null;
}

function realpathOrSelf(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return value;
  }
}

function samePath(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return left === right || realpathOrSelf(left) === realpathOrSelf(right);
}

// ps -axo pid=,ppid=,command= 的纯解析：command 必须与 executable 精确相等。
export function ownedNativeProcesses(output, executable) {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return match && match[3] === executable
      ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }]
      : [];
  });
}

function psRows(exec) {
  return exec("ps", ["-axo", "pid=,ppid=,command=", "-ww"]);
}

function pgrepPattern(executable) {
  return executable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pgrepPids(exec, executable) {
  const pids = new Set();
  for (const candidate of new Set([executable, realpathOrSelf(executable)])) {
    let output;
    try {
      output = exec("pgrep", ["-f", pgrepPattern(candidate)]);
    } catch (error) {
      // pgrep 无匹配时退出码为 1；这是「没有候选」而不是失败。
      if (error?.status === 1) continue;
      throw error;
    }
    for (const line of output.split("\n")) {
      const pid = Number(line.trim());
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  }
  return [...pids];
}

function lsofTextPaths(exec, pid) {
  let output;
  try {
    output = exec("lsof", ["-p", String(pid), "-a", "-d", "txt", "-Fn"]);
  } catch (error) {
    // lsof 对已退出/无匹配进程退出码为 1；保持「无事实」语义，不当作归属。
    if (error?.status === 1) return [];
    throw error;
  }
  return output
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}

function ownedViaPgrepLsof(executable, exec) {
  const expected = realpathOrSelf(executable);
  const owned = [];
  for (const pid of pgrepPids(exec, executable)) {
    const paths = lsofTextPaths(exec, pid);
    const matched = paths.find((path) => realpathOrSelf(path) === expected);
    if (matched) owned.push({ pid, ppid: null, command: matched });
  }
  return owned;
}

// 本批 owned 进程集合。返回实际观测方式，调用方必须把 method/fallback_reason
// 写入批次证据，不允许把 fallback 当作与 ps 完全无差别。
export function ownProcesses(executable, { exec = defaultExec } = {}) {
  try {
    const processes = ownedNativeProcesses(psRows(exec), executable);
    return { schema: PROCESS_OBSERVATION_SCHEMA, method: "ps", fallback_reason: null, processes };
  } catch (error) {
    const reason = fallbackReason(error);
    if (!reason) throw error;
    return {
      schema: PROCESS_OBSERVATION_SCHEMA,
      method: "pgrep+lsof",
      fallback_reason: reason,
      processes: ownedViaPgrepLsof(executable, exec),
    };
  }
}

// 单个 PID 当前是否仍指向本批 executable（cleanup 发信号前的身份复核）。
// 进程已退出或身份不匹配时 matches=false；无法安全核验时宁可 matches=false，
// 也不允许在未核验的情况下发信号。
export function observeOwnedExecutable(pid, executable, { exec = defaultExec } = {}) {
  const expected = realpathOrSelf(executable);
  try {
    const observed = exec("ps", ["-p", String(pid), "-o", "command="]).trim();
    return {
      schema: PROCESS_OBSERVATION_SCHEMA,
      method: "ps",
      fallback_reason: null,
      matches: samePath(observed, expected),
      observed_path: observed,
      unavailable: null,
    };
  } catch (error) {
    const reason = fallbackReason(error);
    if (!reason) {
      // ps 可用但对本 PID 无输出（进程已退出）时，保持「不匹配」。
      return {
        schema: PROCESS_OBSERVATION_SCHEMA,
        method: "ps",
        fallback_reason: null,
        matches: false,
        observed_path: null,
        unavailable: "process_gone",
      };
    }
    const paths = lsofTextPaths(exec, pid);
    const matched = paths.find((path) => realpathOrSelf(path) === expected);
    return {
      schema: PROCESS_OBSERVATION_SCHEMA,
      method: "pgrep+lsof",
      fallback_reason: reason,
      matches: Boolean(matched),
      observed_path: matched ?? paths[0] ?? null,
      unavailable: matched || paths.length > 0 ? null : "process_gone",
    };
  }
}
