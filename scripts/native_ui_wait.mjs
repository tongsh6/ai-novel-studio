// B37：外部原生驱动的分型等待账；产品不读取本文件或命令日志。
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ownedNativeProcesses, nativeExecutablePath } from "./lib/native_app_ownership.mjs";

export const budgets = Object.freeze({ input: 30_000, ack: 30_000, turn: 120_000,
  candidate: 120_000, adoption: 90_000, maintenance: 180_000, export: 60_000, restore: 30_000 });
export const budgetsFor = (provider) => ["strata", "lmstudio", "deepseek"].includes(provider)
  ? { ...budgets, input: 120_000, turn: 360_000, candidate: 300_000, adoption: 180_000, maintenance: 300_000 }
  : budgets;
export class WaitLedger {
  constructor(startedAt, waitBudgets = budgets) { this.budgets = waitBudgets; this.active = null; this.idleSince = startedAt; this.ids = new Set(); this.events = []; }
  check(now) {
    const start = this.active?.at ?? this.idleSince;
    const budget = this.active ? this.budgets[this.active.kind] : 120_000;
    if (now - start >= budget) throw new Error(`${this.active?.kind ?? "driver_idle"}_timeout`);
  }
  accept(command) {
    if (!Number.isFinite(command.at) || command.at < this.idleSince) throw new Error("invalid_command_time");
    this.check(command.at);
    if (command.op === "begin") {
      if (this.active || typeof command.id !== "string" || !command.id || this.ids.has(command.id) || !Object.hasOwn(budgets, command.kind) || !command.label) throw new Error("invalid_wait_begin");
      this.ids.add(command.id); this.active = command;
      this.events.push({ ...command, event: "wait_start" });
    } else if (command.op === "finish") {
      if (!this.active || this.active.id !== command.id) throw new Error("invalid_wait_finish");
      this.events.push({ ...this.active, event: "wait_end", ended_at: command.at, duration_ms: command.at - this.active.at });
      this.active = null; this.idleSince = command.at;
    } else throw new Error("invalid_wait_command");
  }
  stats() {
    const completed = this.events.filter((event) => event.event === "wait_end");
    return { completed: completed.length, total_ms: completed.reduce((n, event) => n + event.duration_ms, 0),
      active: this.active, by_kind: Object.fromEntries(Object.keys(budgets).map((kind) => [kind, completed.filter((e) => e.kind === kind).length])) };
  }
}

export function nativeLifecycleSeen(seen, liveCount, kind) {
  if (seen && liveCount === 0 && kind !== "restore") throw new Error("owned_native_window_process_exited");
  return seen || liveCount > 0;
}

const commands = (dir) => {
  const file = path.join(dir, "native-driver-commands.jsonl");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse) : [];
};
const write = (dir, name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
export async function supervise(dir, api, pids) {
  const ready = JSON.parse(fs.readFileSync(path.join(dir, "native-driver-ready.json"), "utf8"));
  const ledger = new WaitLedger(Date.parse(ready.ready_at), budgetsFor(ready.provider));
  let commandCount = 0, eventCount = 0, heartbeatAt = 0, nativeSeen = false;
  const started = Date.now();
  try {
    while (true) {
      if (fs.existsSync(path.join(dir, "failure.json"))) throw new Error("external_driver_failed");
      for (const command of commands(dir).slice(commandCount)) { ledger.accept(command); commandCount += 1; }
      const now = Date.now(); ledger.check(now);
      for (const event of ledger.events.slice(eventCount)) fs.appendFileSync(path.join(dir, "wait-events.jsonl"), JSON.stringify(event) + "\n");
      eventCount = ledger.events.length;
      write(dir, "wait-stats.json", ledger.stats());
      if (fs.existsSync(path.join(dir, "native-ui-complete.json"))) {
        if (ledger.active) throw new Error("completion_has_active_wait");
        return;
      }
      for (const pid of pids) { try { process.kill(pid, 0); } catch { throw new Error(`owned_process_exited:${pid}`); } }
      if (ready.app_mode === "embedded-native") {
        const executable = nativeExecutablePath(dir, ready);
        const liveCount = () => ownedNativeProcesses(execFileSync("ps", ["-axo", "pid=,ppid=,command=", "-ww"], { encoding: "utf8" }), executable).length;
        let count = liveCount();
        if (nativeSeen && count === 0) {
          // journal先于关窗写入；跨一次轮询发生的restore不能被旧的active视图误判。
          for (const command of commands(dir).slice(commandCount)) { ledger.accept(command); commandCount += 1; }
          count = liveCount();
        }
        nativeSeen = nativeLifecycleSeen(nativeSeen, count, ledger.active?.kind);
      }
      if (now - heartbeatAt >= 10_000) {
        const response = await fetch(`${api}/health`, { signal: AbortSignal.timeout(3_000) });
        if (!response.ok) throw new Error(`backend_unhealthy:${response.status}`);
        fs.appendFileSync(path.join(dir, "heartbeat.jsonl"), JSON.stringify({ at: new Date().toISOString(),
          supervisor_pid: process.pid, elapsed_ms: now - started, active_wait: ledger.active, completed: ledger.stats().completed }) + "\n");
        heartbeatAt = now;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (error) {
    if (!fs.existsSync(path.join(dir, "failure.json"))) {
      write(dir, "failure.json", { at: new Date().toISOString(), reason: error.message, active_wait: ledger.active,
        commands_processed: commandCount, elapsed_ms: Date.now() - started, budgets: ledger.budgets });
    }
    write(dir, "wait-stats.json", { ...ledger.stats(), failure: error.message });
    throw error;
  }
}

async function main([action, artifact, ...args]) {
  const dir = path.resolve(artifact);
  if (action === "wait") return supervise(dir, args[0], args.slice(1).map(Number));
  const ready = JSON.parse(fs.readFileSync(path.join(dir, "native-driver-ready.json"), "utf8"));
  const ledger = new WaitLedger(Date.parse(ready.ready_at), budgetsFor(ready.provider));
  for (const command of commands(dir)) ledger.accept(command);
  if (action === "status") { console.log(JSON.stringify(ledger.stats())); return; }
  const command = action === "begin" ? { op: "begin", id: randomUUID(), kind: args[0], label: args[1], at: Date.now() }
    : { op: "finish", id: args[0], at: Date.now() };
  if (!["begin", "finish"].includes(action)) throw new Error("unknown_action");
  ledger.accept(command);
  fs.appendFileSync(path.join(dir, "native-driver-commands.jsonl"), JSON.stringify(command) + "\n");
  console.log(command.id);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
