// failure 编排必须是纯观测：同一 target/PID 的 AX/截图/启动事实只读，
// 不调用 activate/key/click/type，也不因观测失败覆盖原 error。
// 正常交互需要恢复前台/焦点时，由命名明确的 interaction 方法承担。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OwnershipError } from "./input_target.mjs";
import { NativeScenarioHarness, activationConfirmed, evidenceText } from "./scenario_driver.mjs";

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

test("tryPollAx 以命名观测读取真实控件匹配结果", async (t) => {
  const { dir, harness } = makeHarness({});
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nodes = [{ role: "AXButton", title: "开始新讨论" }];
  const labels = [];
  harness.dumpNodesForInteraction = (label) => {
    labels.push(label);
    return nodes;
  };

  const found = await harness.tryPollAx((text) => text === "开始新讨论", 50, "return_to_question");

  assert.deepEqual(found, { nodes, text: "开始新讨论" });
  assert.deepEqual(labels, ["try_poll_ax:return_to_question"]);
});

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

async function runJourneyQuietly(harness, journey) {
  const exitCode = process.exitCode;
  const consoleError = console.error;
  const errors = [];
  console.error = (error) => errors.push(error);
  try {
    const value = await harness.runJourney(journey);
    return { value, errors, exitCode: process.exitCode };
  } finally {
    console.error = consoleError;
    process.exitCode = exitCode;
  }
}

for (const [label, makeError] of [
  ["OwnershipError", () => new OwnershipError("target_not_running", { expected: "run" })],
  ["原始 Error", () => new Error("activation_unconfirmed")],
]) {
  test(`runJourney 在启动期 ${label} 时立即复用 fail：原始 reason、零输入`, async () => {
    const { dir, harness } = makeHarness({
      dump: () => [],
      screenshot: () => ({ ok: true }),
      startup: () => ({ ok: true, is_finished_launching: true, ax_window_count: 1 }),
    });
    harness.input = countingInput();
    const original = makeError();

    const { value, errors, exitCode } = await runJourneyQuietly(harness, () =>
      harness.runStep("maintenance", "launch_app", () => {
        throw original;
      }),
    );

    assert.equal(value, undefined, "失败时共享入口不伪造返回值");
    assert.deepEqual(errors, [original], "共享入口把同一个原始 error 交给 fail");
    assert.equal(exitCode, 1, "失败应保留 fail 的退出码语义");
    assert.deepEqual(harness.input.calls, [], "failure 收口不得 activate/key/click/type");
    const failure = readFailure(dir);
    assert.equal(failure.reason, original.message);
    assert.equal(failure.phase, "maintenance:launch_app");
    assert.equal(fs.existsSync(path.join(dir, "failure-observation.json")), true);
    assert.equal(fs.existsSync(path.join(dir, "failure-driver-log.json")), true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dir, "failure-ax-raw.json"), "utf8")).nodes,
      [],
    );
    assert.equal(fs.existsSync(path.join(dir, "native-input-events.jsonl")), false);
    assert.equal(failure.observation.ax.ok, true, "只读 AX 观测照常落盘");
    assert.deepEqual(failure.log_tail, harness.log.slice(-14));
  });
}

test("runJourney 正常返回 journey 结果且不写 failure", async () => {
  const { dir, harness } = makeHarness({
    dump: () => [],
    screenshot: () => ({ ok: true }),
    startup: () => ({ ok: true }),
  });
  harness.input = countingInput();
  const expected = { ok: true, journey: "normal" };

  const { value, errors } = await runJourneyQuietly(harness, async () => expected);

  assert.equal(value, expected);
  assert.deepEqual(errors, []);
  assert.deepEqual(harness.input.calls, []);
  assert.equal(fs.existsSync(path.join(dir, "failure.json")), false);
  assert.equal(fs.existsSync(path.join(dir, "failure-observation.json")), false);
});

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
  harness.launchSettleIntervalMs = 1;
  harness.launchSettleTimeoutMs = 5;
  harness.launchRetryDelayMs = 1;
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

test("rawLaunchApp 在 activate 前有界等待启动 settled，并保留每次只读观测", async () => {
  const notSettled = {
    ok: true,
    is_finished_launching: false,
    activation_policy: "regular",
    is_hidden: false,
    is_active: false,
    ax_window_count: 0,
    has_ax_window: false,
    has_ax_web_area: false,
  };
  const settled = {
    ok: true,
    is_finished_launching: true,
    activation_policy: "regular",
    is_hidden: false,
    is_active: true,
    ax_window_count: 1,
    has_ax_window: true,
    has_ax_web_area: true,
  };
  const activation = { ok: true, requested: true, returned: true, confirmed: true, waited_ms: 42 };
  const calls = [];
  const { dir, harness } = makeHarness({ dump: () => [], screenshot: () => ({ ok: true }) });
  stubLaunchSeams(harness, { calls, startups: [notSettled, settled], activate: () => activation });

  await harness.rawLaunchApp();

  // 等待观测在 activate 之前；activate 前最后一次观测已 settled。
  assert.deepEqual(
    calls.filter((entry) => entry === "activate"),
    ["activate"],
  );
  const reasons = JSON.parse(fs.readFileSync(path.join(dir, "startup-observations.json"), "utf8")).map(
    (entry) => entry.reason,
  );
  assert.equal(reasons[0], "launch:wait_settled:0");
  assert.equal(reasons.at(-2), "launch:before_activation");
  assert.equal(reasons.at(-1), "launch:after_activation");
  const attempt = harness.log.find((entry) => entry.op === "launch_activation_attempt");
  assert.equal(attempt.startup.is_finished_launching, true, "activate 前应已 settled");
  const recorded = harness.log.find((entry) => entry.op === "launch_activation");
  assert.equal(recorded.confirmed, true);
  assert.equal(recorded.startup_after.ax_window_count, 1);
});

test("首次 activate unconfirmed 时有界重试 1 次，两次 attempt 观测都落盘", async () => {
  const settled = { ok: true, is_finished_launching: true, is_active: true, ax_window_count: 1, has_ax_window: true };
  const calls = [];
  const activations = [
    { ok: false, requested: true, returned: true, confirmed: false, waited_ms: 2002 },
    { ok: true, requested: true, returned: true, confirmed: true, waited_ms: 120 },
  ];
  let activationIndex = 0;
  const { dir, harness } = makeHarness({ dump: () => [], screenshot: () => ({ ok: true }) });
  stubLaunchSeams(harness, {
    calls,
    startups: [settled],
    activate: () => activations[activationIndex++],
  });

  await harness.rawLaunchApp();

  const attempts = harness.log.filter((entry) => entry.op === "launch_activation_attempt");
  const recorded = harness.log.filter((entry) => entry.op === "launch_activation");
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts.map((entry) => entry.attempt), [0, 1]);
  assert.equal(recorded.length, 2);
  assert.deepEqual(recorded.map((entry) => entry.confirmed), [false, true]);
  const reasons = JSON.parse(fs.readFileSync(path.join(dir, "startup-observations.json"), "utf8")).map(
    (entry) => entry.reason,
  );
  for (const reason of [
    "launch:before_activation",
    "launch:after_activation",
    "launch:before_activation_retry1",
    "launch:after_activation_retry1",
  ]) {
    assert(reasons.includes(reason), reason);
  }
});

test("activationConfirmed：顶层 confirmed / 嵌套 activation.confirmed / 两者 false 三种形状", () => {
  assert.equal(activationConfirmed({ confirmed: true }), true, "顶层 confirmed");
  assert.equal(
    activationConfirmed({ ok: true, activation: { confirmed: true, target_active: true } }),
    true,
    "真实 payload 嵌套 activation.confirmed",
  );
  assert.equal(activationConfirmed({ ok: false, activation: { confirmed: false } }), false, "嵌套 false");
  assert.equal(activationConfirmed({ ok: true }), false, "缺 confirmed 不算确认");
  assert.equal(activationConfirmed(null), false, "空 payload 不算确认");
});

test("真实 input boundary 嵌套形状 {activation:{confirmed:true}} 视为已确认（不误重试）", async () => {
  const settled = { ok: true, is_finished_launching: true, ax_window_count: 1, is_active: true };
  const calls = [];
  const { harness } = makeHarness({ dump: () => [], screenshot: () => ({ ok: true }) });
  stubLaunchSeams(harness, {
    calls,
    startups: [settled],
    activate: () => ({
      ok: true,
      reason: null,
      activation: {
        requested: true,
        returned: true,
        confirmed: true,
        waited_ms: 0,
        frontmost_before: { bundle_identifier: "com.example.app", pid: 4321 },
        frontmost_after: { bundle_identifier: "com.example.app", pid: 4321 },
      },
      frontmost_after: { bundle_identifier: "com.example.app", pid: 4321 },
    }),
  });

  await harness.rawLaunchApp();

  assert.equal(harness.log.filter((entry) => entry.op === "launch_activation_attempt").length, 1);
  assert.equal(harness.log.filter((entry) => entry.op === "launch_activation").length, 1);
  assert.equal(harness.log.filter((entry) => entry.op === "launch_activation").at(0).activation.confirmed, true);
});

test("两次 activate 都 unconfirmed 时抛 activation_unconfirmed（attempt 保留）", async () => {
  const settled = { ok: true, is_finished_launching: true, ax_window_count: 1 };
  const calls = [];
  const { harness } = makeHarness({ dump: () => [], screenshot: () => ({ ok: true }) });
  stubLaunchSeams(harness, {
    calls,
    startups: [settled],
    activate: () => ({ ok: false, requested: true, returned: true, confirmed: false, waited_ms: 2002 }),
  });

  await assert.rejects(() => harness.rawLaunchApp(), /activation_unconfirmed/);
  assert.equal(harness.log.filter((entry) => entry.op === "launch_activation_attempt").length, 2);
  assert.equal(harness.log.filter((entry) => entry.op === "launch_activation").length, 2);
});

test("rawLaunchApp keeps pre-activation startup facts when the first activation fails", async () => {
  const launchFacts = { ok: true, is_finished_launching: false, is_active: false, ax_window_count: 0, has_ax_window: false };
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
    startups: [failed],
    activate: () => ({ ok: true, requested: true, returned: true, confirmed: true, waited_ms: 10 }),
  });

  await harness.rawLaunchApp();

  const attempt = harness.log.find((entry) => entry.op === "launch_activation_attempt");
  assert.equal(attempt.startup.ok, false);
  assert.match(attempt.startup.error, /startup_unavailable/);
  const recorded = harness.log.find((entry) => entry.op === "launch_activation");
  assert.equal(recorded.confirmed, true);
  assert.equal(recorded.startup_after.ok, false);
  assert.match(recorded.startup_after.error, /startup_unavailable/);
});

// 失败留痕完整性：启动观测与原始 AX 不能只活在被 log_tail 截断的数组里
// （cp4b-pending-02 真实批次因此丢了首次 activate 前的 startup 事实）。
test("启动观测独立落盘，不依赖失败时的 log_tail", async () => {
  const before = { ok: true, is_finished_launching: false, is_active: false, ax_window_count: 0, has_ax_window: false };
  const after = { ...before, is_finished_launching: true, ax_window_count: 1, has_ax_window: true, has_ax_web_area: true };
  const calls = [];
  const { dir, harness } = makeHarness({ dump: () => [], screenshot: () => ({ ok: true }) });
  stubLaunchSeams(harness, {
    calls,
    startups: [before, after],
    activate: () => ({ ok: true, requested: true, returned: true, confirmed: true, waited_ms: 431 }),
  });

  await harness.rawLaunchApp();

  const observations = JSON.parse(fs.readFileSync(path.join(dir, "startup-observations.json"), "utf8"));
  const reasons = observations.map((entry) => entry.reason);
  assert.equal(reasons[0], "launch:wait_settled:0");
  assert.equal(reasons.at(-2), "launch:before_activation");
  assert.equal(reasons.at(-1), "launch:after_activation");
  assert.equal(observations.at(-2).is_finished_launching, true);
  assert.equal(observations.at(-1).ax_window_count, 1);
});

test("失败新增完整 driver log 与原始 AX，且不改写原 failure reason", async () => {
  const rawNodes = [
    { path: "0", role: "AXWindow", title: "window", frame: [0, 0, 1280, 800] },
    { path: "0/0", role: "AXButton", title: "为什么", frame: [10, 10, 80, 30] },
  ];
  let dumps = 0;
  const { dir, harness } = makeHarness({
    dump: () => {
      dumps += 1;
      return rawNodes;
    },
    screenshot: () => ({ ok: true }),
    startup: () => ({ ok: true, is_finished_launching: true, ax_window_count: 1, has_ax_window: true, has_ax_web_area: true }),
  });
  harness.input = countingInput();
  const original = new Error("pending_why_target:action_missing");
  // 先制造一段真实启动观测/日志，再进入失败路径。
  const calls = [];
  stubLaunchSeams(harness, {
    calls,
    startups: [{ ok: true, is_finished_launching: false }],
    activate: () => ({ ok: true, requested: true, returned: true, confirmed: true, waited_ms: 10 }),
  });
  await harness.rawLaunchApp();

  await captureFailure(harness, original);

  const failure = readFailure(dir);
  assert.equal(failure.reason, "pending_why_target:action_missing");
  assert.deepEqual(failure.log_tail, harness.log.slice(-14));
  const driverLog = JSON.parse(fs.readFileSync(path.join(dir, "failure-driver-log.json"), "utf8"));
  assert.equal(driverLog.log.length, harness.log.length);
  assert.ok(driverLog.log.some((entry) => entry.op === "launch_activation_attempt"));
  assert.ok(driverLog.log.some((entry) => entry.op === "launch_activation"));
  const startupReasons = driverLog.startup_observations.map((entry) => entry.reason);
  assert.equal(startupReasons[0], "launch:wait_settled:0");
  assert(startupReasons.includes("launch:before_activation"));
  assert(startupReasons.includes("launch:after_activation"));
  assert.equal(startupReasons.at(-1), "failure");
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, "startup-observations.json"), "utf8"));
  assert.equal(persisted.length, startupReasons.length);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "failure-ax-raw.json"), "utf8"));
  assert.deepEqual(raw.nodes, rawNodes);
  assert.ok(dumps > 1, "失败时额外读取原始 AX dump");
});

test("evidenceText：value 单独标注，避免 AX 值裸拼成伪泄漏串", () => {
  // 折叠控件：title「会话」+ Value 0 → 不能成为「会话 0」（可读性伪泄漏）
  assert.equal(evidenceText({ title: "会话", value: "0" }), "会话 (value=0)");
  // 只有 value 时也带标注
  assert.equal(evidenceText({ value: 0 }), "(value=0)");
  // title + desc 自然拼接，无 value 时不追加
  assert.equal(evidenceText({ title: "为什么", desc: "查看这轮回应的依据" }), "为什么 查看这轮回应的依据");
  // 空节点/空白 value 返回空串（调用方 filter 掉）
  assert.equal(evidenceText({ title: "", desc: "", value: "  " }), "");
  assert.equal(evidenceText(null), "");
  // 真实数字 value 保留可读形式
  assert.equal(evidenceText({ title: "时长", value: 12 }), "时长 (value=12)");
});
