// B37：外部原生驱动的分型等待账；产品不读取本文件或命令日志。
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
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


export const BACKEND_RESTART_LABEL = "owned_backend_restart";
const RESTART_SCHEMA = "native-backend-restart/v1";
const restartFile = (kind) => "native-backend-restart-" + kind + ".json";
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const optionalRecord = (dir, kind) => fs.existsSync(path.join(dir, restartFile(kind))) ?
  readJson(path.join(dir, restartFile(kind))) : null;
const positivePid = (value) => Number.isSafeInteger(value) && value > 0 && value < 2147483647;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) {
  if (error.code === "ESRCH") return false;
  throw error;
} };
const digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function publishRestart(dir, kind, value) {
  const file = path.join(dir, restartFile(kind)), staging = file + "." + randomUUID();
  try {
    fs.writeFileSync(staging, JSON.stringify(value, null, 2), { flag: "wx" });
    fs.linkSync(staging, file);
  } finally { if (fs.existsSync(staging)) fs.unlinkSync(staging); }
}

function backendReady(dir) {
  const ready = readJson(path.join(dir, "native-driver-ready.json")), owner = ready.backend_owner;
  assert(ready.slice_id === "b71-first-consumer" && ready.provider === "splash", "backend_restart_not_enabled");
  assert(typeof ready.run_ref === "string" && ready.run_ref !== "" && owner &&
    positivePid(owner.runner_pid) && positivePid(owner.backend_pid) &&
    owner.runner_pid !== owner.backend_pid, "backend_owner_missing");
  return ready;
}

function backendDatabase(dir, configuredPath) {
  const expected = fs.realpathSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  assert.equal(fs.realpathSync(configuredPath), expected, "backend_restart_database_outside_batch");
  const stat = fs.statSync(expected);
  assert(stat.isFile(), "backend_restart_database_missing");
  return { path: expected, dev: String(stat.dev), ino: String(stat.ino) };
}

function currentLedger(dir, ready) {
  const ledger = new WaitLedger(Date.parse(ready.ready_at), budgetsFor(ready.provider));
  for (const command of commands(dir)) ledger.accept(command);
  ledger.check(Date.now());
  return ledger;
}

function assertRestore(ledger, waitId) {
  assert(ledger.active && ledger.active.id === waitId && ledger.active.kind === "restore" &&
    ledger.active.label === BACKEND_RESTART_LABEL, "backend_restart_outside_owned_restore");
  ledger.check(Date.now());
}

function assertRestartIdentity(record, ready, request = record) {
  assert(record?.schema === RESTART_SCHEMA && record.run_ref === ready.run_ref &&
    record.runner_pid === ready.backend_owner.runner_pid &&
    record.previous_backend_pid === ready.backend_owner.backend_pid &&
    typeof record.request_id === "string" && record.request_id !== "" &&
    typeof record.wait_id === "string" && record.wait_id !== "", "backend_restart_identity_mismatch");
  for (const field of ["run_ref", "request_id", "wait_id", "runner_pid", "previous_backend_pid", "database"]) {
    assert.deepEqual(record[field], request[field], "backend_restart_changed:" + field);
  }
}

async function waitRestartRecord(dir, kind, deadline) {
  while (Date.now() < deadline) {
    if (fs.existsSync(path.join(dir, "failure.json"))) throw new Error("backend_restart_supervision_failed");
    const record = optionalRecord(dir, kind);
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("backend_restart_receipt_timeout:" + kind);
}

// driver 只写请求并等 runner receipt；没有 spawn/kill/环境配置或重跑 seed 的能力。
export async function requestBackendRestart(dir) {
  const ready = backendReady(dir), ledger = currentLedger(dir, ready);
  assertRestore(ledger, ledger.active?.id);
  const request = { schema: RESTART_SCHEMA, kind: "request", run_ref: ready.run_ref,
    request_id: randomUUID(), wait_id: ledger.active.id, runner_pid: ready.backend_owner.runner_pid,
    previous_backend_pid: ready.backend_owner.backend_pid, requested_at: new Date().toISOString(),
    database: backendDatabase(dir, ready.backend_owner.database_path) };
  publishRestart(dir, "request", request);
  const receipt = await waitRestartRecord(dir, "completed", ledger.active.at + ledger.budgets.restore);
  assert.deepEqual(receipt, readBackendRestartReceipt(dir));
  return receipt;
}

// 原 runner 用其内存中的真实 PID 调用；先持久准入，再等原监督器确认安全窗口。
export async function claimBackendRestart(dir, runnerPid, backendPid, supervisorPid) {
  const ready = backendReady(dir), request = optionalRecord(dir, "request");
  assertRestartIdentity(request, ready);
  assert.equal(request.kind, "request");
  assert.equal(runnerPid, ready.backend_owner.runner_pid, "backend_restart_runner_mismatch");
  assert.equal(backendPid, ready.backend_owner.backend_pid, "backend_restart_old_pid_mismatch");
  assert(positivePid(supervisorPid), "backend_restart_supervisor_missing");
  const ledger = currentLedger(dir, ready);
  assertRestore(ledger, request.wait_id);
  assert.deepEqual(backendDatabase(dir, ready.backend_owner.database_path), request.database);
  const claim = { ...request, kind: "accepted", supervisor_pid: supervisorPid,
    accepted_at: new Date().toISOString() };
  publishRestart(dir, "accepted", claim);
  const supervised = await waitRestartRecord(dir, "supervised", ledger.active.at + ledger.budgets.restore);
  assertRestartIdentity(supervised, ready, claim);
  assert(supervised.kind === "supervised" && supervised.supervisor_pid === supervisorPid,
    "backend_restart_supervision_mismatch");
  return claim;
}

function backendRuntimeEvidence(dir, previousPid, nextPid) {
  const file = "runtime-facts-backend-restart.json";
  const before = readJson(path.join(dir, "runtime-facts.json")), after = readJson(path.join(dir, file));
  assert.equal(Number(before.pid), previousPid, "old_backend_runtime_pid_mismatch");
  assert.equal(Number(after.pid), nextPid, "new_backend_runtime_pid_mismatch");
  const settings = ({ captured_at: _at, pid: _pid, ...value }) => value;
  assert.deepEqual(settings(after), settings(before), "backend_restart_runtime_changed");
  return { initial_runtime_sha256: digest(path.join(dir, "runtime-facts.json")),
    runtime_facts: { file, sha256: digest(path.join(dir, file)) } };
}

// 事后只读复核同批事实；cleanup 后不把已结束的 PID 当作当前健康证明。
export function readBackendRestartReceipt(dir) {
  const ready = backendReady(dir), request = optionalRecord(dir, "request");
  assertRestartIdentity(request, ready);
  assert.equal(request.kind, "request");
  const claim = optionalRecord(dir, "accepted"), supervised = optionalRecord(dir, "supervised");
  const receipt = optionalRecord(dir, "completed");
  for (const [kind, record] of [["accepted", claim], ["supervised", supervised], ["completed", receipt]]) {
    assertRestartIdentity(record, ready, request);
    assert.equal(record.kind, kind);
    assert(positivePid(record.supervisor_pid) && record.supervisor_pid === claim.supervisor_pid,
      "backend_restart_supervision_mismatch");
  }
  assert(positivePid(receipt.backend_pid) && receipt.backend_pid !== request.previous_backend_pid &&
    receipt.health?.status === 200 && receipt.health.url === ready.api_url + "/health",
    "backend_restart_completion_invalid");
  assert.deepEqual(backendDatabase(dir, ready.backend_owner.database_path), request.database);
  const evidence = backendRuntimeEvidence(dir, request.previous_backend_pid, receipt.backend_pid);
  assert.equal(receipt.initial_runtime_sha256, evidence.initial_runtime_sha256);
  assert.deepEqual(receipt.runtime_facts, evidence.runtime_facts);
  const ledger = new WaitLedger(Date.parse(ready.ready_at), budgetsFor(ready.provider));
  for (const command of commands(dir)) ledger.accept(command);
  const start = ledger.events.find((event) => event.event === "wait_start" && event.id === request.wait_id);
  const end = ledger.events.find((event) => event.event === "wait_end" && event.id === request.wait_id);
  assert(start?.kind === "restore" && start.label === BACKEND_RESTART_LABEL,
    "backend_restart_outside_owned_restore");
  const times = [request.requested_at, claim.accepted_at, supervised.observed_at, receipt.completed_at].map(Date.parse);
  assert(times.every((time, index) => Number.isFinite(time) && time >= (index ? times[index - 1] : start.at)) &&
    times.at(-1) < start.at + ledger.budgets.restore && (!end || times.at(-1) <= end.ended_at),
    "backend_restart_receipt_outside_wait");
  return receipt;
}

export async function completeBackendRestart(dir, runnerPid, backendPid) {
  const ready = backendReady(dir), claim = optionalRecord(dir, "accepted");
  assertRestartIdentity(claim, ready, optionalRecord(dir, "request"));
  assert.equal(runnerPid, claim.runner_pid, "backend_restart_runner_mismatch");
  const supervised = optionalRecord(dir, "supervised");
  assertRestartIdentity(supervised, ready, claim);
  assert(supervised.kind === "supervised" && supervised.supervisor_pid === claim.supervisor_pid,
    "backend_restart_supervision_mismatch");
  assertRestore(currentLedger(dir, ready), claim.wait_id);
  assert(positivePid(backendPid) && backendPid !== claim.previous_backend_pid &&
    !alive(claim.previous_backend_pid) && alive(backendPid), "backend_restart_process_transition_missing");
  const file = "runtime-facts-backend-restart.json";
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(path.join(dir, file)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const evidence = backendRuntimeEvidence(dir, claim.previous_backend_pid, backendPid);
  assert.deepEqual(backendDatabase(dir, ready.backend_owner.database_path), claim.database);
  const url = ready.api_url + "/health";
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  assert.equal(response.status, 200, "backend_restart_not_healthy");
  assertRestore(currentLedger(dir, ready), claim.wait_id);
  const receipt = { ...claim, kind: "completed", backend_pid: backendPid,
    completed_at: new Date().toISOString(), health: { url, status: response.status },
    ...evidence };
  publishRestart(dir, "completed", receipt);
  return receipt;
}

// 只对已准入、同等待账的旧 backend 换代；其它 owned PID 与普通 restore 的 health 始终严格。
export function observeBackendLifecycle(dir, ready, ledger, pids, claim = optionalRecord(dir, "accepted")) {
  if (!claim) return { pids, restarting: false };
  assertRestartIdentity(claim, ready, optionalRecord(dir, "request"));
  assert.equal(claim.kind, "accepted");
  assert.equal(claim.supervisor_pid, process.pid, "backend_restart_wrong_supervisor");
  assert(pids.includes(claim.previous_backend_pid), "backend_restart_pid_not_watched");
  const completed = optionalRecord(dir, "completed");
  if (completed) {
    assert.deepEqual(completed, readBackendRestartReceipt(dir));
    return { pids: pids.map((pid) => pid === claim.previous_backend_pid ? completed.backend_pid : pid),
      restarting: false, receipt: completed };
  }
  assertRestore(ledger, claim.wait_id);
  assert(alive(claim.runner_pid), "backend_restart_runner_exited");
  const supervised = optionalRecord(dir, "supervised");
  if (supervised) {
    assertRestartIdentity(supervised, ready, claim);
    assert(supervised.kind === "supervised" && supervised.supervisor_pid === process.pid,
      "backend_restart_supervision_mismatch");
  } else {
    assertOwnedPids(pids);
    publishRestart(dir, "supervised", { ...claim, kind: "supervised", observed_at: new Date().toISOString() });
  }
  return { pids: pids.filter((pid) => pid !== claim.previous_backend_pid), restarting: true };
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
      const claim = optionalRecord(dir, "accepted");
      if (claim) acceptNewCommands(dir, ledger, state);
      const backend = observeBackendLifecycle(dir, ready, ledger, pids, claim);
      assertOwnedPids(backend.pids);
      observeNativeLifecycle(dir, ready, ledger, state);
      if (!backend.restarting) await maybeHeartbeat(api, dir, ledger, state, now);
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
  if (action === "backend-restart-claim") return claimBackendRestart(dir, ...args.map(Number));
  if (action === "backend-restart-complete") return completeBackendRestart(dir, ...args.map(Number));
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
