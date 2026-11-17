// native-ui-wait 族：纯 WaitLedger 判定不碰文件系统；需要驱动文件协议的 case
// 使用外层 run scope 的 work 区目录，不再落系统 TMPDIR 裸目录。case 目录由 finally
// 立即回收，owned 作用域退出时再统一收口；本族不使用 materializeFixture —— 监督器
// 在运行中持续追加/改写日志，共享只读模板不适用。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  budgets,
  budgetsFor,
  BACKEND_RESTART_LABEL,
  requestBackendRestart,
  claimBackendRestart,
  completeBackendRestart,
  readBackendRestartReceipt,
  observeBackendLifecycle,
  main,
  maybeHeartbeat,
  nativeLifecycleSeen,
  observeNativeLifecycle,
  supervise,
  WaitLedger,
} from "./native_ui_wait.mjs";
import { openTestRunScope } from "./lib/test_env.mjs";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

test("真实模型沿既有实测360秒turn预算，仍在截止时失败", () => {
  const ledger = new WaitLedger(0, budgetsFor("strata"));
  ledger.accept({ op: "begin", id: "real-turn", kind: "turn", label: "真实模型判断与生成", at: 1 });
  ledger.check(120_001);
  assert.throws(() => ledger.check(360_001), /turn_timeout/);
  assert.equal(budgetsFor("slice_verify").turn, 120_000);
});

test("Splash 与既有实模同预算；Splash turn 真实消费 360 秒", () => {
  const splash = budgetsFor("splash");
  assert.equal(splash.turn, 360_000);
  assert.equal(splash.input, 120_000);
  assert.equal(splash.candidate, 300_000);
  assert.equal(splash.adoption, 180_000);
  assert.equal(splash.maintenance, 300_000);
  assert.deepEqual(budgetsFor("slice_verify"), budgets);
  const ledger = new WaitLedger(0, splash);
  ledger.accept({ op: "begin", id: "splash-turn", kind: "turn", label: "Splash 判断与生成", at: 1 });
  ledger.check(120_001);
  ledger.check(359_999);
  assert.throws(() => ledger.check(360_001), /turn_timeout/);
});

test("分型计时保留实际耗时和未完成等待", () => {
  const ledger = new WaitLedger(0);
  ledger.accept({ op: "begin", id: "input-1", kind: "input", label: "T1 输入", at: 1 });
  ledger.accept({ op: "finish", id: "input-1", at: 600 });
  ledger.accept({ op: "begin", id: "turn-1", kind: "turn", label: "T1 等待结果", at: 700 });
  ledger.check(100_000);
  assert.equal(ledger.stats().total_ms, 599);
  assert.equal(ledger.stats().active.id, "turn-1");
  assert.equal(ledger.stats().by_kind.input, 1);
});
test("迟到完成和重复身份不能重置预算", () => {
  const ledger = new WaitLedger(0);
  ledger.accept({ op: "begin", id: "ack", kind: "ack", label: "等待回执", at: 1 });
  assert.throws(() => ledger.accept({ op: "finish", id: "ack", at: 30_001 }), /ack_timeout/);
  assert.throws(() => ledger.accept({ op: "begin", id: "ack", kind: "turn", label: "换预算", at: 100 }), /invalid_wait_begin/);
  ledger.accept({ op: "finish", id: "ack", at: 200 });
  assert.throws(() => ledger.accept({ op: "begin", id: "ack", kind: "turn", label: "复用", at: 300 }), /invalid_wait_begin/);
});
test("无驱动进展及错误完成身份均有界失败", () => {
  const ledger = new WaitLedger(0);
  assert.throws(() => ledger.check(120_000), /driver_idle_timeout/);
  assert.throws(() => ledger.accept({ op: "finish", id: "missing", at: 1 }), /invalid_wait_finish/);
  assert.throws(() => ledger.accept({ op: "begin", id: "invalid", kind: "__proto__", label: "不能跳过预算", at: 1 }), /invalid_wait_begin/);
});
test("进程丢失立即落 failure，而非等待整个窗口", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-"));
  try {
    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({ ready_at: new Date().toISOString() }));
    await assert.rejects(supervise(dir, "http://127.0.0.1:1", [2147483647]), /owned_process_exited/);
    const failure = JSON.parse(fs.readFileSync(path.join(dir, "failure.json")));
    assert.match(failure.reason, /owned_process_exited/);
    assert.equal(Number.isFinite(failure.elapsed_ms), true, "失败耗时必须是有限数字");
    assert.ok(failure.elapsed_ms < 60_000, "失败耗时应是本次 supervise 的真实时长");
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test("外部驱动失败立即结束，原始失败原因不被后续超时覆盖", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-"));
  try {
    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({ ready_at: new Date().toISOString() }));
    const original = JSON.stringify({ reason: "wrong_seed_shape", trial: "T5" });
    fs.writeFileSync(path.join(dir, "failure.json"), original);
    await assert.rejects(supervise(dir, "http://127.0.0.1:1", [process.pid]), /external_driver_failed/);
    assert.equal(fs.readFileSync(path.join(dir, "failure.json"), "utf8"), original);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test("supervise 从起点消费命令、落 wait-events，并在完成时返回", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-loop-"));
  try {
    const readyAt = new Date().toISOString();
    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({
      ready_at: readyAt,
      provider: "splash",
      app_mode: "embedded-web",
    }));
    fs.writeFileSync(
      path.join(dir, "native-driver-commands.jsonl"),
      [
        JSON.stringify({ op: "begin", id: "turn-1", kind: "turn", label: "T1", at: Date.parse(readyAt) + 1 }),
        JSON.stringify({ op: "finish", id: "turn-1", at: Date.parse(readyAt) + 2 }),
      ].join("\n") + "\n",
    );
    fs.writeFileSync(path.join(dir, "native-ui-complete.json"), "{}");
    await supervise(dir, "http://127.0.0.1:1", []);
    const events = fs.readFileSync(path.join(dir, "wait-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.map((event) => event.event), ["wait_start", "wait_end"]);
    assert.deepEqual(events.map((event) => event.id), ["turn-1", "turn-1"]);
    const stats = JSON.parse(fs.readFileSync(path.join(dir, "wait-stats.json"), "utf8"));
    assert.equal(stats.completed, 1);
    assert.equal(stats.total_ms, 1);
    assert.equal(fs.existsSync(path.join(dir, "failure.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("supervise 完成时仍有活动等待：明确失败，不伪装完成", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-active-"));
  try {
    const readyAt = new Date().toISOString();
    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({
      ready_at: readyAt,
      provider: "splash",
      app_mode: "embedded-web",
    }));
    fs.writeFileSync(
      path.join(dir, "native-driver-commands.jsonl"),
      JSON.stringify({ op: "begin", id: "turn-1", kind: "turn", label: "T1", at: Date.parse(readyAt) + 1 }) + "\n",
    );
    fs.writeFileSync(path.join(dir, "native-ui-complete.json"), "{}");
    await assert.rejects(supervise(dir, "http://127.0.0.1:1", []), /completion_has_active_wait/);
    const failure = JSON.parse(fs.readFileSync(path.join(dir, "failure.json"), "utf8"));
    assert.equal(failure.reason, "completion_has_active_wait");
    assert.equal(failure.active_wait.id, "turn-1");
    assert.equal(failure.commands_processed, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("supervise 跨轮询等待并写心跳；原生窗口首次尚未出现也可容忍", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-heart-loop-"));
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/health");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({
      ready_at: new Date().toISOString(),
      provider: "splash",
      app_mode: "embedded-native",
      native_executable: "native-app",
    }));
    setTimeout(() => {
      fs.writeFileSync(path.join(dir, "native-ui-complete.json"), "{}");
    }, 400);
    await supervise(dir, `http://127.0.0.1:${port}`, []);
    const heartbeat = JSON.parse(fs.readFileSync(path.join(dir, "heartbeat.jsonl"), "utf8").trim());
    assert.equal(Array.isArray(heartbeat.active_wait), false);
    assert.equal(typeof heartbeat.elapsed_ms, "number");
    const stats = JSON.parse(fs.readFileSync(path.join(dir, "wait-stats.json"), "utf8"));
    assert.equal(stats.completed, 0);
    assert.equal(typeof stats.process_observation.method, "string");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("存活归属探测只探活，不向被监督进程发信号", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-pid-"));
  const signalFile = path.join(dir, "child-signalled.txt");
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const fs = require("fs");
process.on("SIGHUP", () => fs.writeFileSync(process.argv[1], "sighup"));
setTimeout(() => {}, 30000);`,
      signalFile,
    ],
    { stdio: "ignore" },
  );
  try {
    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({
      ready_at: new Date().toISOString(),
      provider: "splash",
      app_mode: "embedded-web",
    }));
    fs.writeFileSync(path.join(dir, "native-ui-complete.json"), "{}");
    await supervise(dir, "http://127.0.0.1:1", [child.pid]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(child.exitCode, null, "监督器不能向活着的原生进程发终止信号");
    assert.equal(fs.existsSync(signalFile), false, "探活只能用 signal 0，不能投递 SIGHUP");
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("独立原生窗口仅在首次启动和显式恢复期间可暂时缺席", () => {
  assert.equal(nativeLifecycleSeen(false, 0, "maintenance"), false);
  assert.equal(nativeLifecycleSeen(false, 1, "maintenance"), true);
  assert.equal(nativeLifecycleSeen(true, 0, "restore"), true);
  assert.throws(() => nativeLifecycleSeen(true, 0, "turn"), /owned_native_window_process_exited/);
});


test("CLI main 的 status/begin/finish 走同一等待账本", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "r01-wait-main-"));
  fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({ ready_at: new Date().toISOString(), provider: "splash" }));
  await main(["status", dir]);
  await main(["begin", dir, "turn", "T1"]);
  await main(["status", dir]);
  const commands = fs.readFileSync(path.join(dir, "native-driver-commands.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(commands[0].kind, "turn");
  assert.equal(commands[0].label, "T1");
  const id = commands[0].id;
  await main(["finish", dir, id]);
  await main(["status", dir]);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    // 至少经过一次 pid 探活/轮询后完成，不能提前命中 native-ui-complete。
    setTimeout(() => {
      fs.writeFileSync(path.join(dir, "native-ui-complete.json"), "{}");
    }, 350);
    await main(["wait", dir, `http://127.0.0.1:${port}`, String(process.pid)]);
    const stats = JSON.parse(fs.readFileSync(path.join(dir, "wait-stats.json"), "utf8"));
    assert.equal(stats.completed, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function lifecycleState(overrides = {}) {
  return {
    commandCount: 0,
    eventCount: 0,
    heartbeatAt: 0,
    nativeSeen: false,
    processObservation: { method: null, fallback_reason: null },
    started: 0,
    ...overrides,
  };
}

function processSnapshot(processes, method = "pgrep") {
  return { method, fallback_reason: null, processes: processes.map((pid) => ({ pid })) };
}

test("observeNativeLifecycle：非 embedded-native 不观察，embedded 记录真实进程来源", () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-life-"));
  try {
    const ledger = new WaitLedger(0);
    const state = lifecycleState();
    observeNativeLifecycle(dir, { app_mode: "embedded-web" }, ledger, state, {
      executablePath: () => "/missing",
      processes: () => {
        throw new Error("不应观察非原生模式");
      },
    });
    assert.equal(state.nativeSeen, false);
    assert.deepEqual(state.processObservation, { method: null, fallback_reason: null });

    observeNativeLifecycle(dir, { app_mode: "embedded-native" }, ledger, state, {
      executablePath: () => "/app",
      processes: () => processSnapshot([42]),
    });
    assert.equal(state.nativeSeen, true);
    assert.deepEqual(state.processObservation, { method: "pgrep", fallback_reason: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("observeNativeLifecycle：已见过窗口后消失时先消费新命令再重建观察", () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-life-"));
  try {
    fs.writeFileSync(
      path.join(dir, "native-driver-commands.jsonl"),
      JSON.stringify({ op: "begin", id: "begin-1", kind: "turn", label: "T1", at: 5 }) + "\n",
    );
    const ledger = new WaitLedger(0);
    const state = lifecycleState({ nativeSeen: true });
    let calls = 0;
    observeNativeLifecycle(dir, { app_mode: "embedded-native" }, ledger, state, {
      executablePath: () => "/app",
      processes: () => {
        calls += 1;
        return calls === 1 ? processSnapshot([]) : processSnapshot([7]);
      },
    });
    assert.equal(state.commandCount, 1);
    assert.equal(ledger.active.id, "begin-1");
    assert.equal(state.nativeSeen, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("observeNativeLifecycle：重建后仍无进程立即失败，不空等整个窗口", () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-life-"));
  try {
    const ledger = new WaitLedger(0);
    const state = lifecycleState({ nativeSeen: true });
    assert.throws(
      () =>
        observeNativeLifecycle(dir, { app_mode: "embedded-native" }, ledger, state, {
          executablePath: () => "/app",
          processes: () => processSnapshot([]),
        }),
      /owned_native_window_process_exited/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maybeHeartbeat：10秒内不请求；成功写心跳；后端不健康明确失败", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-heart-"));
  try {
    const ledger = new WaitLedger(0, budgetsFor("splash"));
    ledger.accept({ op: "begin", id: "turn-1", kind: "turn", label: "T1", at: 1 });
    ledger.accept({ op: "finish", id: "turn-1", at: 2 });
    const state = lifecycleState();
    let requests = 0;
    await maybeHeartbeat("http://127.0.0.1:1", dir, ledger, state, 5_000, {
      fetch: async () => {
        requests += 1;
        return { ok: true };
      },
    });
    assert.equal(requests, 0, "未满10秒不请求");
    assert.equal(fs.existsSync(path.join(dir, "heartbeat.jsonl")), false);

    await maybeHeartbeat("http://127.0.0.1:1", dir, ledger, state, 10_000, {
      fetch: async () => {
        requests += 1;
        return { ok: true };
      },
    });
    assert.equal(requests, 1, "恰好 10 秒即应心跳");
    state.heartbeatAt = 0;
    await maybeHeartbeat("http://127.0.0.1:1", dir, ledger, state, 20_000, {
      fetch: async (url) => {
        requests += 1;
        assert.equal(url, "http://127.0.0.1:1/health");
        return { ok: true };
      },
    });
    assert.equal(requests, 2);
    assert.equal(state.heartbeatAt, 20_000);
    const lines = fs.readFileSync(path.join(dir, "heartbeat.jsonl"), "utf8").trim().split("\n");
    const line = JSON.parse(lines.at(-1));
    assert.equal(line.elapsed_ms, 20_000);
    assert.equal(line.completed, 1);
    assert.equal(line.active_wait, null);

    await assert.rejects(
      maybeHeartbeat("http://127.0.0.1:1", dir, ledger, lifecycleState(), 30_000, {
        fetch: async () => ({ ok: false, status: 503 }),
      }),
      /backend_unhealthy:503/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("等待账本边界：at 等于 idleSince 合法，NaN/早于 idleSince/空 label 明确失败", () => {
  const ledger = new WaitLedger(0);
  ledger.accept({ op: "begin", id: "at-zero", kind: "turn", label: "L", at: 0 });
  assert.equal(ledger.active.id, "at-zero");
  ledger.accept({ op: "finish", id: "at-zero", at: 0 });
  assert.throws(
    () => new WaitLedger(0).accept({ op: "begin", id: "nan", kind: "turn", label: "L", at: NaN }),
    /invalid_command_time/,
  );
  assert.throws(
    () => new WaitLedger(10).accept({ op: "begin", id: "early", kind: "turn", label: "L", at: 9 }),
    /invalid_command_time/,
  );
  assert.throws(
    () => new WaitLedger(0).accept({ op: "begin", id: "no-label", kind: "turn", label: "", at: 1 }),
    /invalid_wait_begin/,
  );
  assert.throws(
    () => new WaitLedger(0).accept({ op: "begin", id: 7, kind: "turn", label: "L", at: 1 }),
    /invalid_wait_begin/,
  );
});

test("observeNativeLifecycle：尚未见过窗口时不提前消费命令", () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-life-"));
  try {
    fs.writeFileSync(
      path.join(dir, "native-driver-commands.jsonl"),
      JSON.stringify({ op: "begin", id: "early", kind: "turn", label: "T1", at: 1 }) + "\n",
    );
    const ledger = new WaitLedger(0);
    const state = lifecycleState({ nativeSeen: false });
    observeNativeLifecycle(dir, { app_mode: "embedded-native" }, ledger, state, {
      executablePath: () => "/app",
      processes: () => processSnapshot([]),
    });
    assert.equal(state.commandCount, 0, "未见过窗口不能提前消费命令");
    assert.equal(ledger.active, null);
    assert.equal(state.nativeSeen, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maybeHeartbeat：已心跳后 5 秒不重复；elapsed 用减去启动时刻", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "native-wait-heart-"));
  try {
    const ledger = new WaitLedger(0);
    const state = lifecycleState({ heartbeatAt: 20_000, started: 1_000 });
    let requests = 0;
    await maybeHeartbeat("http://127.0.0.1:1", dir, ledger, state, 25_000, {
      fetch: async () => { requests += 1; return { ok: true }; },
    });
    assert.equal(requests, 0, "距上次心跳仅 5 秒");
    await maybeHeartbeat("http://127.0.0.1:1", dir, ledger, state, 31_000, {
      fetch: async () => { requests += 1; return { ok: true }; },
    });
    assert.equal(requests, 1);
    const line = JSON.parse(fs.readFileSync(path.join(dir, "heartbeat.jsonl"), "utf8").trim());
    assert.equal(line.elapsed_ms, 30_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 生命周期协议使用真实临时子进程和 HTTP；普通文件只见证 inode，不冒充 SQLite/BEAM 恢复验收。
async function backendProcess(file, settings, port = 0) {
  const child = spawn(process.execPath, ["-e", [
    "const fs=require('node:fs'),http=require('node:http');",
    "const [file,raw,port]=process.argv.slice(1);",
    "const facts={...JSON.parse(raw),pid:String(process.pid),captured_at:new Date().toISOString()};",
    "fs.writeFileSync(file,JSON.stringify(facts));",
    "const server=http.createServer((req,res)=>{res.writeHead(req.url==='/health'?200:404);res.end('ok');});",
    "server.listen(Number(port),'127.0.0.1',()=>process.send({pid:process.pid,port:server.address().port}));",
  ].join(""), file, JSON.stringify(settings), String(port)], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const ready = await new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("backend protocol test process exited before ready")));
  });
  return { child, ...ready };
}
async function stopBackendProcess(processRecord) {
  const child = processRecord?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGTERM"); });
}

test("owned backend 一次准入、监督握手、真实PID/HTTP换代与不可覆盖完成事实", async () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "backend-lifecycle-"));
  let old, replacement, requested, claimed;
  const file = (kind) => path.join(dir, "native-backend-restart-" + kind + ".json");
  const json = (name, value) => fs.writeFileSync(name, JSON.stringify(value));
  try {
    fs.mkdirSync(path.join(dir, "database"));
    const database = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
    fs.writeFileSync(database, "protocol file identity only");
    const settings = { schema: "b87-r01-runtime-facts/v1", mix_env: "test",
      provider: { selected: "splash", model: "local/Q4-PLE4", endpoint: "http://127.0.0.1:8000" },
      context_pressure: { provider: "splash", window: 32000, maintenance_ratio: 0.70 },
      auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false };
    old = await backendProcess(path.join(dir, "runtime-facts.json"), settings);
    const initialBytes = fs.readFileSync(path.join(dir, "runtime-facts.json"));
    const ready = { slice_id: "b71-first-consumer", provider: "splash", run_ref: "owned-run",
      ready_at: new Date().toISOString(), api_url: "http://127.0.0.1:" + old.port,
      backend_owner: { runner_pid: process.pid, backend_pid: old.pid, database_path: database } };
    json(path.join(dir, "native-driver-ready.json"), ready);
    const start = { op: "begin", id: "backend-restore", kind: "restore",
      label: BACKEND_RESTART_LABEL, at: Date.now() };
    fs.writeFileSync(path.join(dir, "native-driver-commands.jsonl"), JSON.stringify(start) + "\n");
    const ledger = new WaitLedger(Date.parse(ready.ready_at), budgetsFor(ready.provider));
    ledger.accept(start);
    requested = requestBackendRestart(dir);
    requested.catch(() => {});
    const request = JSON.parse(fs.readFileSync(file("request")));
    assert.deepEqual(observeBackendLifecycle(dir, ready, ledger, [old.pid, process.pid]),
      { pids: [old.pid, process.pid], restarting: false }, "仅请求不能允许旧backend退场");

    await assert.rejects(claimBackendRestart(dir, process.pid, old.pid + 1, process.pid), /old_pid_mismatch/);
    json(file("request"), { ...request, run_ref: "foreign" });
    await assert.rejects(claimBackendRestart(dir, process.pid, old.pid, process.pid), /identity_mismatch/);
    json(file("request"), request);
    fs.renameSync(database, database + ".original");
    fs.writeFileSync(database, "replaced");
    await assert.rejects(claimBackendRestart(dir, process.pid, old.pid, process.pid), /deep-equal/);
    fs.unlinkSync(database);
    fs.renameSync(database + ".original", database);
    assert.equal(fs.existsSync(file("accepted")), false);

    claimed = claimBackendRestart(dir, process.pid, old.pid, process.pid);
    claimed.catch(() => {});
    const claim = JSON.parse(fs.readFileSync(file("accepted")));
    for (const patch of [{ wait_id: "other-wait" }, { previous_backend_pid: old.pid + 1 },
      { supervisor_pid: process.pid + 1 }]) {
      json(file("accepted"), { ...claim, ...patch });
      assert.throws(() => observeBackendLifecycle(dir, ready, ledger, [old.pid, process.pid]));
    }
    json(file("accepted"), claim);
    const ordinary = new WaitLedger(Date.parse(ready.ready_at), budgetsFor("splash"));
    ordinary.accept({ ...start, label: "close_app_and_relaunch" });
    assert.throws(() => observeBackendLifecycle(dir, ready, ordinary, [old.pid]), /outside_owned_restore/);
    const pending = observeBackendLifecycle(dir, ready, ledger, [old.pid, process.pid]);
    assert.deepEqual(pending, { pids: [process.pid], restarting: true });
    await claimed;
    assert.equal(JSON.parse(fs.readFileSync(file("supervised"))).request_id, request.request_id);
    await assert.rejects(claimBackendRestart(dir, process.pid, old.pid, process.pid), /EEXIST/);

    await stopBackendProcess(old);
    replacement = await backendProcess(path.join(dir, "runtime-facts-backend-restart.json"), settings, old.port);
    const facts = JSON.parse(fs.readFileSync(path.join(dir, "runtime-facts-backend-restart.json")));
    json(path.join(dir, "runtime-facts-backend-restart.json"), { ...facts,
      context_pressure: { ...facts.context_pressure, window: 4096 } });
    await assert.rejects(completeBackendRestart(dir, process.pid, replacement.pid), /runtime_changed/);
    assert.equal(fs.existsSync(file("completed")), false);
    json(path.join(dir, "runtime-facts-backend-restart.json"), facts);
    const completed = await completeBackendRestart(dir, process.pid, replacement.pid);
    assert.equal(completed.health.status, 200);
    assert.notEqual(completed.previous_backend_pid, completed.backend_pid);
    assert.deepEqual(await requested, completed);
    assert.deepEqual(fs.readFileSync(path.join(dir, "runtime-facts.json")), initialBytes);
    const finish = { op: "finish", id: start.id, at: Date.now() };
    fs.appendFileSync(path.join(dir, "native-driver-commands.jsonl"), JSON.stringify(finish) + "\n");
    ledger.accept(finish);
    const active = observeBackendLifecycle(dir, ready, ledger, [old.pid, process.pid]);
    assert.deepEqual(active.pids, [replacement.pid, process.pid]);
    assert.equal(active.restarting, false);
    assert.deepEqual(readBackendRestartReceipt(dir), completed);
    for (const patch of [
      { health: { ...completed.health, status: 503 } },
      { health: { ...completed.health, url: "http://foreign/health" } },
      { initial_runtime_sha256: "0".repeat(64) },
      { runtime_facts: { ...completed.runtime_facts, sha256: "0".repeat(64) } },
      { backend_pid: old.pid },
      { completed_at: new Date(start.at + budgets.restore).toISOString() },
      { supervisor_pid: process.pid + 1 },
    ]) {
      json(file("completed"), { ...completed, ...patch });
      assert.throws(() => readBackendRestartReceipt(dir));
      assert.throws(() => observeBackendLifecycle(dir, ready, ledger, [old.pid]));
    }
    json(file("completed"), completed);
    const supervised = JSON.parse(fs.readFileSync(file("supervised")));
    json(file("supervised"), { ...supervised, wait_id: "another-restore" });
    assert.throws(() => readBackendRestartReceipt(dir), /changed:wait_id/);
    json(file("supervised"), supervised);
    assert.deepEqual(readBackendRestartReceipt(dir), completed);
    await assert.rejects(requestBackendRestart(dir), /outside_owned_restore/);
    await stopBackendProcess(replacement);
    assert.deepEqual(readBackendRestartReceipt(dir), completed, "事后读完成事实不要求cleanup后的进程仍活");
  } finally {
    fs.writeFileSync(path.join(dir, "failure.json"), "{}");
    await Promise.allSettled([requested, claimed].filter(Boolean));
    await stopBackendProcess(old);
    await stopBackendProcess(replacement);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
