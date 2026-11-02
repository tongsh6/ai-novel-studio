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
