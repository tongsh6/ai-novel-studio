// failure 编排必须是纯观测：同一 target/PID 的 AX/截图/启动事实只读，
// 不调用 activate/key/click/type，也不因观测失败覆盖原 error。
// 正常交互需要恢复前台/焦点时，由命名明确的 interaction 方法承担。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NativeScenarioHarness } from "./scenario_driver.mjs";

function makeHarness(io) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-scenario-"));
  const app = path.join(dir, "Test.app");
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  const executable = path.join(app, "Contents", "MacOS", "app");
  fs.writeFileSync(executable, "#!/bin/sh\n");
  fs.chmodSync(executable, 0o755);
  fs.writeFileSync(
    path.join(dir, "native-driver-ready.json"),
    JSON.stringify({
      driver: "external-system-ui",
      run_ref: "run",
      bundle_identifier: "com.example.app",
      app_path: app,
      native_executable: "app",
    }),
  );
  return { dir, harness: new NativeScenarioHarness(dir, io) };
}

function countingInput() {
  const calls = [];
  return {
    calls,
    activate: () => {
      calls.push("activate");
      return { ok: true };
    },
    key: (key) => {
      calls.push(`key:${key}`);
      return { ok: true };
    },
  };
}

function readFailure(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "failure.json"), "utf8"));
}

async function captureFailure(harness, error) {
  const exitCode = process.exitCode;
  const consoleError = console.error;
  console.error = () => {};
  try {
    await harness.fail(error);
  } finally {
    console.error = consoleError;
    process.exitCode = exitCode;
  }
}

test("failure capture with AX unavailable performs zero input and keeps original error", async () => {
  const { dir, harness } = makeHarness({
    dump: () => {
      throw new Error("ax_unavailable");
    },
    screenshot: () => {
      throw new Error("window_unavailable");
    },
    startup: () => {
      throw new Error("startup_unavailable");
    },
  });
  harness.input = countingInput();
  const original = new Error("activation_unconfirmed");

  await captureFailure(harness, original);

  assert.deepEqual(harness.input.calls, [], "failure capture must not activate or send keys");
  assert.equal(fs.existsSync(path.join(dir, "native-input-events.jsonl")), false);
  const failure = readFailure(dir);
  assert.equal(failure.reason, "activation_unconfirmed");
  assert.equal(failure.observation.ax.ok, false);
  assert.match(failure.observation.ax.reason, /ax_unavailable/);
  assert.equal(failure.observation.screenshot.ok, false);
  assert.equal(failure.observation.startup.ok, false);
  assert.match(failure.observation.startup.error, /startup_unavailable/);
});

test("failure capture records a missing main window instead of changing the scene", async () => {
  const { dir, harness } = makeHarness({
    dump: () => [],
    screenshot: () => {
      throw new Error("window_unavailable");
    },
    startup: () => ({
      ok: true,
      is_finished_launching: false,
      launch_date: null,
      activation_policy: "regular",
      is_hidden: false,
      ax_window_count: 0,
      has_ax_window: false,
      has_ax_web_area: false,
    }),
  });
  harness.input = countingInput();

  await captureFailure(harness, new Error("activation_unconfirmed"));

  assert.deepEqual(harness.input.calls, []);
  const failure = readFailure(dir);
  assert.equal(failure.reason, "activation_unconfirmed");
  assert.equal(failure.observation.ax.ok, true);
  assert.equal(failure.observation.ax.main_window, false);
  assert.equal(failure.observation.ax.has_ax_window, false);
  assert.equal(failure.observation.ax.has_ax_web_area, false);
  assert.equal(failure.observation.startup.is_finished_launching, false);
  assert.equal(failure.observation.screenshot.ok, false);
  assert.equal(fs.existsSync(path.join(dir, "failure.ax.txt")), true);
  assert.equal(fs.existsSync(path.join(dir, "failure.jpg")), false);
});

test("failure observation is persisted even when supervisor already wrote failure.json", async () => {
  const { dir, harness } = makeHarness({
    dump: () => [],
    screenshot: () => {
      throw new Error("window_unavailable");
    },
    startup: () => ({ ok: true, has_ax_window: false }),
  });
  harness.input = countingInput();
  fs.writeFileSync(
    path.join(dir, "failure.json"),
    JSON.stringify({ at: "supervisor", reason: "supervisor_timeout" }),
  );

  await captureFailure(harness, new Error("activation_unconfirmed"));

  assert.deepEqual(harness.input.calls, []);
  assert.equal(readFailure(dir).reason, "supervisor_timeout");
  const observation = JSON.parse(fs.readFileSync(path.join(dir, "failure-observation.json"), "utf8"));
  assert.equal(observation.ax.main_window, false);
  assert.equal(observation.screenshot.ok, false);
});

test("dumpNodes is read-only until an explicit interaction recovery is requested", async () => {
  const windowNodes = Array.from({ length: 9 }, (_, index) => ({
    role: index === 0 ? "AXWindow" : "AXStaticText",
    title: `node-${index}`,
  }));
  let dumps = 0;
  const { harness } = makeHarness({
    dump: () => {
      dumps += 1;
      return dumps <= 2 ? [] : windowNodes;
    },
    screenshot: () => ({ ok: true }),
    startup: () => ({ ok: true }),
  });
  harness.input = countingInput();

  assert.deepEqual(harness.dumpNodes(), []);

  const nodes = harness.dumpNodesForInteraction("unit_test");
  assert.equal(nodes.length, 9);
  assert.deepEqual(harness.input.calls, ["activate", "key:escape"]);
  assert.deepEqual(
    harness.log.filter((entry) => entry.op === "interaction_recovery").map((entry) => entry.reason),
    ["unit_test"],
  );
});

// 启动观测测试的 seam：只覆盖 open/target 解析/输入边界，不启动真实窗口、
// 不投递真实事件；被覆盖方法保持与真实实现相同的签名与职责。
function stubLaunchSeams(harness, { calls, startups, activate }) {
  let startupIndex = 0;
  harness.io.startup = () => {
    calls.push("startup");
    const facts = startups[startupIndex] ?? startups.at(-1);
    startupIndex += 1;
    if (facts instanceof Error) throw facts;
    return facts;
  };
  harness.openApplication = () => calls.push("open");
  harness.waitTargetResolution = async () => ({
    ok: true,
    target: { bundle_identifier: harness.target.bundle_identifier },
    matches: [{ pid: 4321, executable_path: harness.target.executable_path }],
    pid: 4321,
    startup: startups[0],
  });
  harness.bindBatchTarget = () => {
    harness.target = { ...harness.target, pid: 4321 };
    harness.APP = harness.target;
    harness.input = {
      activate: () => {
        calls.push("activate");
        return activate();
      },
    };
  };
}

test("rawLaunchApp records read-only startup facts before and after the first activation", async () => {
  const launchFacts = {
    ok: true,
    is_finished_launching: false,
    launch_date: null,
    activation_policy: "regular",
    is_hidden: false,
    is_active: false,
    ax_window_count: 0,
    has_ax_window: false,
    has_ax_web_area: false,
    ax_nodes_visited: 0,
  };
  const activatedFacts = {
    ok: true,
    is_finished_launching: true,
    launch_date: "2026-11-02T15:03:00Z",
    activation_policy: "regular",
    is_hidden: false,
    is_active: true,
    ax_window_count: 1,
    has_ax_window: true,
    has_ax_web_area: true,
    ax_nodes_visited: 42,
  };
  const activation = { ok: true, requested: true, returned: true, confirmed: true, waited_ms: 42 };
  const calls = [];
  const { harness } = makeHarness({ dump: () => [], screenshot: () => ({ ok: true }) });
  stubLaunchSeams(harness, { calls, startups: [launchFacts, activatedFacts], activate: () => activation });

  await harness.rawLaunchApp();

  assert.deepEqual(calls, ["open", "startup", "activate", "startup"], "启动→激活前观测→激活→激活后观测");
  const attemptIndex = harness.log.findIndex((entry) => entry.op === "launch_activation_attempt");
  const activationIndex = harness.log.findIndex((entry) => entry.op === "launch_activation");
  assert.notEqual(attemptIndex, -1);
  assert.ok(attemptIndex < activationIndex, "attempt 必须先于 activate 落盘");
  const attempt = harness.log[attemptIndex];
  assert.equal(attempt.startup.reason, "launch:before_activation");
  assert.equal(attempt.startup.is_finished_launching, false);
  assert.equal(attempt.startup.ax_window_count, 0);
  assert.equal(attempt.startup.has_ax_window, false);
  assert.equal(attempt.startup.has_ax_web_area, false);
  assert.match(attempt.startup.at, /^\d{4}-\d{2}-\d{2}T/);
  const recorded = harness.log[activationIndex];
  assert.equal(recorded.confirmed, true);
  assert.equal(recorded.requested, true);
  assert.equal(recorded.startup_before.is_finished_launching, false);
  assert.equal(recorded.startup_after.reason, "launch:after_activation");
  assert.equal(recorded.startup_after.is_finished_launching, true);
  assert.equal(recorded.startup_after.ax_window_count, 1);
  assert.equal(recorded.startup_after.has_ax_web_area, true);
});

test("rawLaunchApp keeps pre-activation startup facts when the first activation fails", async () => {
  const launchFacts = {
    ok: true,
    is_finished_launching: false,
    is_hidden: false,
    is_active: false,
    ax_window_count: 0,
    has_ax_window: false,
    has_ax_web_area: false,
  };
  const calls = [];
  const { harness } = makeHarness({ dump: () => [], screenshot: () => ({ ok: true }) });
  stubLaunchSeams(harness, {
    calls,
    startups: [launchFacts],
    activate: () => {
      throw new Error("activation_unconfirmed");
    },
  });

  await assert.rejects(() => harness.rawLaunchApp(), /activation_unconfirmed/);

  assert.deepEqual(calls, ["open", "startup", "activate"], "激活失败时不再产生激活后观测");
  const attempt = harness.log.find((entry) => entry.op === "launch_activation_attempt");
  assert.ok(attempt, "失败时激活前观测也必须已落盘");
  assert.equal(attempt.startup.is_finished_launching, false);
  assert.equal(attempt.startup.ax_window_count, 0);
  assert.equal(harness.log.some((entry) => entry.op === "launch_activation"), false);
});

test("rawLaunchApp folds startup observation errors into facts without blocking activation", async () => {
  const calls = [];
  const { harness } = makeHarness({ dump: () => [], screenshot: () => ({ ok: true }) });
  const failed = new Error("startup_unavailable");
  stubLaunchSeams(harness, {
    calls,
    startups: [failed, failed],
    activate: () => ({ ok: true, requested: true, returned: true, confirmed: true, waited_ms: 10 }),
  });

  await harness.rawLaunchApp();

  assert.deepEqual(calls, ["open", "startup", "activate", "startup"]);
  const attempt = harness.log.find((entry) => entry.op === "launch_activation_attempt");
  assert.equal(attempt.startup.ok, false);
  assert.match(attempt.startup.error, /startup_unavailable/);
  const recorded = harness.log.find((entry) => entry.op === "launch_activation");
  assert.equal(recorded.confirmed, true);
  assert.equal(recorded.startup_after.ok, false);
  assert.match(recorded.startup_after.error, /startup_unavailable/);
});

