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
import { fileURLToPath } from "node:url";

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

export function portListening(port, exec = defaultExec) {
  try {
    const out = exec("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return out.split("\n").some((line) => line.includes("LISTEN"));
  } catch (error) {
    // lsof 对无匹配 listener 退出码为 1；其它执行错误必须暴露，不能当作“未监听”。
    if (error?.status === 1) return false;
    throw error;
  }
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

// SU04/B85 release owner 的有界进程身份观察；这里只观测/按已证明身份发信号，
// 启停阶段及期限仍由 release_app_lifecycle_check.sh 唯一编排。
// 不输出 argv/env；lstart + executable + PID 防止把同名/复用 PID 当成本批。
export function parseReleaseProcesses(output) {
  return output.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+?)\s*$/.exec(line);
    return m ? [{pid:Number(m[1]),ppid:Number(m[2]),pgid:Number(m[3]),started:m[4],executable:m[5]}] : [];
  });
}
export function releaseIdentityEqual(a, b) {
  return Boolean(a && b && a.pid === b.pid && a.started === b.started &&
    a.executable === b.executable && a.pgid === b.pgid);
}
export function extendReleaseOwnership(state, rows) {
  const current = new Map(rows.map((p) => [p.pid, p]));
  const retained = state.processes.filter((p) => releaseIdentityEqual(p, current.get(p.pid)));
  // exec 不改变 PID/启动时间；只在原 parent 仍归属且当前子进程 lineage 成立时登记新 exec。
  const owned = new Map(retained.map((p) => [p.pid,p]));
  const root = current.get(state.app.pid);
  if (releaseIdentityEqual(state.app, root)) owned.set(root.pid, root);
  let added = true;
  while (added) {
    added = false;
    for (const proc of rows) {
      if (!owned.has(proc.pid) && owned.has(proc.ppid)) {
        owned.set(proc.pid, proc); added = true;
      }
    }
  }
  for (const previous of state.processes) {
    const now = current.get(previous.pid);
    if (now && now.started === previous.started && !owned.has(now.pid))
      throw new Error("release_identity_changed_without_lineage");
  }
  return {...state, processes:[...owned.values()], observed_at:new Date().toISOString()};
}
export function readReleaseProcesses(exec = defaultExec, known = []) {
  // comm 是 argv0，不是可信 executable。只对本批候选 lineage 使用公开
  // proc_pidpath；不读取参数/env/映射库，不将全机进程内容写入证据。
  const rows = parseReleaseProcesses(exec("ps", ["-axo","pid=,ppid=,pgid=,lstart=,comm=","-ww"]));
  const wanted = new Set(known.map((p)=>p.pid));
  let changed=true;
  while(changed) { changed=false; for(const p of rows) {
    if(wanted.has(p.ppid) && !wanted.has(p.pid)) { wanted.add(p.pid); changed=true; }
  }}
  return rows.filter((p)=>wanted.has(p.pid)).flatMap((p)=>{
    let identity;
    try {
      const helper=fileURLToPath(new URL("../../../artifacts/tools/ax_cua",import.meta.url));
      identity=JSON.parse(exec(helper,["process-path",String(p.pid)]));
    } catch(error) {
      // 进程确实消失才允许空；仍存在但无实际路径必须显式报错。
      let alive;
      try { alive=exec("ps",["-p",String(p.pid),"-o","pid="]).trim(); }
      catch(probeError) { if(probeError.status===1)return []; throw probeError; }
      if(alive)throw new Error("release_executable_unobservable");
      return [];
    }
    if(identity.pid!==p.pid || typeof identity.executable!=="string" || !identity.executable.startsWith("/"))
      throw new Error("release_executable_identity_invalid");
    return [{...p,executable:realpathOrSelf(identity.executable)}];
  });
}
export function releaseSignalCandidates(state, rows, scope = "all") {
  if (!["all","sidecar"].includes(scope)) throw new Error("invalid_release_signal_scope");
  return state.processes.filter((p) => (scope === "all" || p.pid !== state.app.pid) &&
    releaseIdentityEqual(p, rows.find((r) => r.pid === p.pid)));
}
export function signalReleaseOwned(state, name, scope = "all", io = {}) {
  if (!["SIGTERM","SIGKILL"].includes(name)) throw new Error("invalid_release_signal");
  const read = io.read ?? (()=>readReleaseProcesses(defaultExec,state.processes));
  const kill = io.kill ?? ((pid, signal) => process.kill(pid, signal));
  const actions = [];
  // 子进程先，app 后；每一个信号前重新观察身份，不 kill -PGID。
  for (const proc of releaseSignalCandidates(state, read(), scope).sort((a,b) =>
      Number(a.pid === state.app.pid) - Number(b.pid === state.app.pid))) {
    if (!releaseSignalCandidates({...state,processes:[proc]}, read(), scope).length) continue;
    try { kill(proc.pid,name); actions.push({pid:proc.pid,signal:name,at:new Date().toISOString()}); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  return actions;
}
export function runReleaseObservation(argv, io = {}) {
  const [action, file, ...args] = argv;
  const read = io.read ?? (()=>readReleaseProcesses(defaultExec,state?.processes ?? [{pid:Number(args[0])}]));
  const save = (state) => {
    fs.appendFileSync(file+".jsonl",JSON.stringify(state)+"\n");
    fs.writeFileSync(file+".tmp",JSON.stringify(state,null,2));
    fs.renameSync(file+".tmp",file);
    return state;
  };
  let state;
  if (action === "init") {
    const [pid, ownerPid, executable, home, profile] = args;
    const rows = read(), app = rows.find((p) => p.pid === Number(pid));
    if (!app || app.ppid !== Number(ownerPid) || app.executable !== fs.realpathSync(executable))
      throw new Error("release_child_identity_not_proven");
    state = {schema:"release-owned-processes/v1",app,home,profile:profile || null,processes:[app]};
    return save(extendReleaseOwnership(state,rows));
  }
  state = JSON.parse(fs.readFileSync(file,"utf8"));
  if (state.schema !== "release-owned-processes/v1") throw new Error("invalid_release_ownership");
  if (action === "refresh") return save(extendReleaseOwnership(state,read()));
  if (action === "remaining") return releaseSignalCandidates(state,read(),args[0] || "all");
  if (action === "signal") return signalReleaseOwned(state,args[0],args[1] || "all",io);
  if (action === "listener") {
    const pids = (io.exec ?? defaultExec)("lsof",["-nP","-iTCP:"+args[0],"-sTCP:LISTEN","-t"]).trim().split(/\s+/).map(Number);
    const owned = releaseSignalCandidates(state,read(),"sidecar");
    if (!pids.length || pids.some((pid) => !owned.some((p) => p.pid === pid)))
      throw new Error("release_listener_not_owned");
    return owned.filter((p) => pids.includes(p.pid));
  }
  throw new Error("invalid_release_observation_action");
}

// 只服务现 release shell 的观察命令；没有启动/重启/等待/场景编排。
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  try { console.log(JSON.stringify(runReleaseObservation(process.argv.slice(2)))); }
  catch (error) { console.error(error.message); process.exitCode=1; }
}
