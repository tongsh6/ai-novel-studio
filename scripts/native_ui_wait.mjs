// B37：外部原生驱动的分型等待账；产品不读取本文件或命令日志。
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { nativeExecutablePath } from "./lib/native_app_ownership.mjs";
import { ownProcesses } from "./lib/native_ui/process_observation.mjs";

export const budgets = Object.freeze({ input: 30_000, ack: 30_000, turn: 120_000,
  candidate: 120_000, adoption: 90_000, maintenance: 180_000, export: 60_000, restore: 30_000 });
export const budgetsFor = (provider) => ["strata", "lmstudio", "deepseek", "splash"].includes(provider)
  ? { ...budgets, input: 120_000, turn: 360_000, candidate: 300_000, adoption: 180_000, maintenance: 300_000 }
  : budgets;
export class WaitLedger {
  constructor(startedAt, waitBudgets = budgets) { this.budgets = waitBudgets; this.active = null; this.idleSince = startedAt; this.ids = new Set(); this.events = []; }
  check(now) {
    const start = this.active ? this.active.at : this.idleSince;
    const budget = this.active ? this.budgets[this.active.kind] : 120_000;
    const kind = this.active ? this.active.kind : "driver_idle";
    if (now - start >= budget) throw new Error(`${kind}_timeout`);
  }
  accept(command) {
    if (!Number.isFinite(command.at) || command.at < this.idleSince) throw new Error("invalid_command_time");
    this.check(command.at);
    if (command.op === "begin") return this.begin(command);
    if (command.op === "finish") return this.finish(command);
    throw new Error("invalid_wait_command");
  }
  begin(command) {
    if (this.active || typeof command.id !== "string" || !command.id || this.ids.has(command.id) || !Object.hasOwn(budgets, command.kind) || !command.label) throw new Error("invalid_wait_begin");
    this.ids.add(command.id); this.active = command;
    this.events.push({ ...command, event: "wait_start" });
  }
  finish(command) {
    if (!this.active || this.active.id !== command.id) throw new Error("invalid_wait_finish");
    this.events.push({ ...this.active, event: "wait_end", ended_at: command.at, duration_ms: command.at - this.active.at });
    this.active = null; this.idleSince = command.at;
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
function acceptNewCommands(dir, ledger, state) {
  for (const command of commands(dir).slice(state.commandCount)) {
    ledger.accept(command);
    state.commandCount += 1;
  }
}

function flushWaitEvents(dir, ledger, state) {
  for (const event of ledger.events.slice(state.eventCount)) {
    fs.appendFileSync(path.join(dir, "wait-events.jsonl"), JSON.stringify(event) + "\n");
  }
  state.eventCount = ledger.events.length;
}

function assertOwnedPids(pids) {
  for (const pid of pids) {
    try { process.kill(pid, 0); } catch { throw new Error(`owned_process_exited:${pid}`); }
  }
}

export function observeNativeLifecycle(
  dir,
  ready,
  ledger,
  state,
  { executablePath = nativeExecutablePath, processes = ownProcesses } = {},
) {
  if (ready.app_mode !== "embedded-native") return;
  const executable = executablePath(dir, ready);
  const liveCount = () => {
    const snapshot = processes(executable);
    state.processObservation = { method: snapshot.method, fallback_reason: snapshot.fallback_reason };
    return snapshot.processes.length;
  };
  let count = liveCount();
  if (state.nativeSeen && count === 0) {
    acceptNewCommands(dir, ledger, state);
    count = liveCount();
  }
  state.nativeSeen = nativeLifecycleSeen(state.nativeSeen, count, ledger.active?.kind);
}

export async function maybeHeartbeat(
  api,
  dir,
  ledger,
  state,
  now,
  { fetch: fetchImpl = fetch } = {},
) {
  if (now - state.heartbeatAt < 10_000) return;
  const response = await fetchImpl(`${api}/health`, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`backend_unhealthy:${response.status}`);
  fs.appendFileSync(path.join(dir, "heartbeat.jsonl"), JSON.stringify({ at: new Date().toISOString(),
    supervisor_pid: process.pid, elapsed_ms: now - state.started, active_wait: ledger.active, completed: ledger.stats().completed }) + "\n");
  state.heartbeatAt = now;
}

export async function supervise(dir, api, pids) {
  const ready = JSON.parse(fs.readFileSync(path.join(dir, "native-driver-ready.json"), "utf8"));
  const ledger = new WaitLedger(Date.parse(ready.ready_at), budgetsFor(ready.provider));
  const state = {
    commandCount: 0, eventCount: 0, heartbeatAt: 0, nativeSeen: false,
    processObservation: { method: null, fallback_reason: null }, started: Date.now(),
  };
  try {
    while (true) {
      if (fs.existsSync(path.join(dir, "failure.json"))) throw new Error("external_driver_failed");
      acceptNewCommands(dir, ledger, state);
      const now = Date.now();
      ledger.check(now);
      flushWaitEvents(dir, ledger, state);
      write(dir, "wait-stats.json", { ...ledger.stats(), process_observation: state.processObservation });
      if (fs.existsSync(path.join(dir, "native-ui-complete.json"))) {
        if (ledger.active) throw new Error("completion_has_active_wait");
        return;
      }
      assertOwnedPids(pids);
      observeNativeLifecycle(dir, ready, ledger, state);
      await maybeHeartbeat(api, dir, ledger, state, now);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (error) {
    if (!fs.existsSync(path.join(dir, "failure.json"))) {
      write(dir, "failure.json", { at: new Date().toISOString(), reason: error.message, active_wait: ledger.active,
        commands_processed: state.commandCount, elapsed_ms: Date.now() - state.started, budgets: ledger.budgets });
    }
    write(dir, "wait-stats.json", { ...ledger.stats(), failure: error.message, process_observation: state.processObservation });
    throw error;
  }
}

export async function main([action, artifact, ...args]) {
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
