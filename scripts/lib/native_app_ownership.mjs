// B37：原生重开可归launchd；按本批独立可执行路径回收，不使用应用名或全局进程组。
//
// 进程观测统一走 scripts/lib/native_ui/process_observation.mjs：优先 ps，仅在
// 执行环境明确拒绝 setuid ps 时退化为 pgrep+lsof 等价精确归属；实际使用方式
// 记录进 native-app-cleanup.json 的 process_observation，供批次证据审计。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  observeOwnedExecutable,
  ownProcesses,
} from "./native_ui/process_observation.mjs";

// 兼容既有导入面：解析器本身与 ps 调用解耦，测试仍可直接喂 ps 文本。
export { ownedNativeProcesses } from "./native_ui/process_observation.mjs";

export function nativeExecutablePath(dir, ready) {
  const name = ready.native_executable ?? "native-app";
  if (!["app", "native-app"].includes(name)) throw new Error("unexpected native executable name");
  return path.join(dir, "AI Novel Studio.app", "Contents", "MacOS", name);
}

export async function cleanupNativeApp(artifactDir) {
  const dir = fs.realpathSync(artifactDir);
  const readyFile = path.join(dir, "native-driver-ready.json");
  if (!fs.existsSync(readyFile)) return { skipped: "native_wrapper_not_created" };
  const ready = JSON.parse(fs.readFileSync(readyFile, "utf8"));
  const executable = nativeExecutablePath(dir, ready);
  if (ready.driver !== "external-system-ui" || path.resolve(ready.app_path) !== path.dirname(path.dirname(path.dirname(executable))) || fs.realpathSync(executable) !== executable) {
    throw new Error("native ownership metadata does not match this run");
  }
  const started = Date.now(), actions = [];
  let processObservation = { method: null, fallback_reason: null };
  const list = () => {
    const snapshot = ownProcesses(executable);
    processObservation = { method: snapshot.method, fallback_reason: snapshot.fallback_reason };
    return snapshot.processes;
  };
  const signal = (proc, name) => {
    // 重新核验PID当前身份；进程已退出或PID复用时不发送信号。
    if (observeOwnedExecutable(proc.pid, executable).matches !== true) return;
    try { process.kill(proc.pid, name); actions.push({ ...proc, signal: name, at: new Date().toISOString() }); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  for (const proc of list()) signal(proc, "SIGTERM");
  while (Date.now() - started < 3000 && list().length) await new Promise((resolve) => setTimeout(resolve, 100));
  for (const proc of list()) signal(proc, "SIGKILL");
  while (Date.now() - started < 5000 && list().length) await new Promise((resolve) => setTimeout(resolve, 100));
  const result = {
    at: new Date().toISOString(),
    executable,
    actions,
    remaining: list(),
    elapsed_ms: Date.now() - started,
    process_observation: processObservation,
  };
  fs.writeFileSync(path.join(dir, "native-app-cleanup.json"), JSON.stringify(result, null, 2));
  if (result.remaining.length) throw new Error("owned native process did not exit");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cleanupNativeApp(process.argv[2]).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      const failure = path.join(path.resolve(process.argv[2]), "failure.json");
      if (!fs.existsSync(failure)) fs.writeFileSync(failure, JSON.stringify({ at: new Date().toISOString(), reason: "native_app_cleanup_failed", detail: error.message }, null, 2));
      console.error(error.message); process.exitCode = 1;
    });
}
