// failure 编排必须是纯观测：同一 target/PID 的 AX/截图/启动事实只读，
// 不调用 activate/key/click/type，也不因观测失败覆盖原 error。
// 正常交互需要恢复前台/焦点时，由命名明确的 interaction 方法承担。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OwnershipError } from "./input_target.mjs";
import { assertRecordFresh } from "./scenario_evidence.mjs";
import {
  NativeScenarioHarness,
  activationConfirmed,
  ensureWorkSelected,
  evidenceText,
} from "./scenario_driver.mjs";

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

test("tryPollAx 只读当前控件事实，不借观察激活或输入", async (t) => {
  const nodes = [{ role: "AXButton", title: "开始新讨论" }];
  let reads = 0;
  const { dir, harness } = makeHarness({ dump: () => { reads += 1; return nodes; } });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  harness.input = countingInput();
  const found = await harness.tryPollAx((text) => text === "开始新讨论", 50, "return_to_question");
  assert.deepEqual(found, { nodes, text: "开始新讨论" });
  assert.equal(reads, 1);
  assert.deepEqual(harness.input.calls, []);
});

test("capture 绑定 raw、文本和截图内容，同数量页面不混用且原样透传选项", (t) => {
  const samples = [
    { name: "ordinary", value: "第一次页面回复", text: "创作窗口\n(value=第一次页面回复)" },
    { name: "window-only", value: "第二次页面回复", text: "创作窗口\n(value=第二次页面回复)" },
  ].map((sample) => ({
    ...sample,
    nodes: [
      { path: "0", depth: 0, role: "AXWindow", title: "创作窗口" },
      { path: "0/0", depth: 1, role: "AXStaticText", value: sample.value },
    ],
  }));
  const screenshotBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  let current = samples[0];
  const { dir, harness } = makeHarness({ dump: () => current.nodes });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const seen = [];
  harness.screenshotSafe = (file, options) => {
    seen.push(options);
    fs.writeFileSync(file, screenshotBytes);
    return { ok: true, fallback: false };
  };
  const windowOnly = { allowFullScreenFallback: false };

  assert.deepEqual(harness.capture("ordinary"), samples[0].nodes);
  current = samples[1];
  assert.deepEqual(harness.capture("window-only", windowOnly), samples[1].nodes);

  assert.deepEqual(seen, [{}, windowOnly]);
  assert.equal(seen[1], windowOnly, "已有 screenshotSafe options 应原样透传");
  assert.deepEqual(harness.screenshots, ["ordinary.jpg", "window-only.jpg"]);
  for (const [index, sample] of samples.entries()) {
    const capture = harness.captures[index];
    assert.equal(capture.name, sample.name);
    assert.equal(capture.nodes, 2);
    // 期望来自独立给定的输入节点、文字和图片字节，不从 capture 输出反推。
    assert.equal(capture.ax_sha256,
      createHash("sha256").update(JSON.stringify(sample.nodes)).digest("hex"));
    assert.equal(capture.text_sha256,
      createHash("sha256").update(sample.text).digest("hex"));
    assert.equal(capture.screenshot.sha256,
      createHash("sha256").update(screenshotBytes).digest("hex"));
    assert.equal(capture.screenshot.ok, true);
    assert.equal(capture.screenshot.fallback, false);
    assert.equal(fs.readFileSync(path.join(dir, sample.name + ".text.txt"), "utf8"), sample.text);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, sample.name + ".ax.json"), "utf8")), sample.nodes);
    assert.deepEqual(fs.readFileSync(path.join(dir, sample.name + ".jpg")), screenshotBytes);
    assertRecordFresh(dir, sample.name, "1970-01-01T00:00:00.000Z");
  }
  assert.notEqual(harness.captures[0].ax_sha256, harness.captures[1].ax_sha256);
  assert.notEqual(harness.captures[0].text_sha256, harness.captures[1].text_sha256);
});

test("必需窗口截图失败由既有 freshness 断言拒绝，后续输入为零", (t) => {
  let screenshotAttempts = 0;
  const { dir, harness } = makeHarness({
    dump: () => [],
    screenshot: () => {
      screenshotAttempts += 1;
      throw new Error("window_capture_denied");
    },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  harness.input = countingInput();

  assert.throws(() => {
    harness.capture("required", { allowFullScreenFallback: false });
    assertRecordFresh(dir, "required", "1970-01-01T00:00:00.000Z");
    harness.ensureInput().key("enter");
  }, /缺少证据文件: required\.jpg/u);

  assert.equal(screenshotAttempts, 2, "沿用两次窗口读取，不执行整屏回退");
  assert.deepEqual(harness.input.calls, [], "缺少必需截图后不能继续作者输入");
  assert.deepEqual(harness.screenshots, []);
  assert.equal(harness.captures[0].screenshot.ok, false);
  assert.equal(harness.captures[0].screenshot.reason, "window_capture_denied");
  assert.equal(Object.hasOwn(harness.captures[0].screenshot, "sha256"), false);
  assert.equal(harness.log.some((entry) => entry.op === "screenshot_fallback"), false);
  assert.equal(fs.existsSync(path.join(dir, "required.ax.txt")), true);
  assert.equal(fs.existsSync(path.join(dir, "required.text.txt")), true);
  assert.equal(fs.existsSync(path.join(dir, "required.jpg")), false);
});

test("capture 截图失败即使留下部分字节也不签图片身份", (t) => {
  const { dir, harness } = makeHarness({ dump: () => [] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  harness.screenshotSafe = (file) => {
    fs.writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));
    return { ok: false, reason: "partial_window_capture" };
  };

  assert.deepEqual(harness.capture("partial", { allowFullScreenFallback: false }), []);

  assert.equal(fs.existsSync(path.join(dir, "partial.jpg")), true);
  assert.deepEqual(harness.screenshots, []);
  assert.deepEqual(harness.captures[0].screenshot,
    { ok: false, reason: "partial_window_capture" });
  assert.equal(Object.hasOwn(harness.captures[0].screenshot, "sha256"), false);
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

for (const method of ["pollAx", "tryPollAx"]) {
  test(`${method}: 已见窗口离开屏幕即报告表面中断，不借等待抢前台`, async (t) => {
    for (const keepAx of [false, true]) {
      const { dir, harness } = makeHarness({});
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      harness.target = { ...harness.target, pid: 321, generation: 1 };
      harness.APP = harness.target;
      harness.input = countingInput();
      const nodes = [{ role: "AXWindow" }, { role: "AXWebArea" }];
      const facts = { ok: true, pid: 321, target: { ...harness.target },
        is_finished_launching: true, ax_window_error: 0, ax_window_count: 1,
        window_server: { available: true, windows: [{ id: 17, layer: 0,
          bounds: { X: 0, Y: 0, Width: 1280, Height: 801 }, on_screen: true }] } };
      harness.io.dump = () => nodes;
      harness.io.startup = () => facts;
      await harness[method](() => true, 1000, "visible_before");
      facts.window_server.windows[0].on_screen = false;
      facts.ax_window_count = keepAx ? 1 : 0;
      harness.io.dump = () => keepAx ? nodes : [];
      await assert.rejects(harness[method](() => true, 1000, "visible_history"),
        /owned_native_surface_not_onscreen/);
      assert.deepEqual(harness.input.calls, []);
      const recorded = JSON.parse(fs.readFileSync(path.join(dir, "startup-observations.json"), "utf8")).at(-1);
      assert.equal(recorded.target.pid, 321);
      assert.equal(recorded.window_server.windows[0].on_screen, false);
    }
  });
}

test("窗口中断只认本代确定事实：启动、AX异常、未知或错身份不被冒充不可见", async (t) => {
  const cases = [
    ["首次启动", () => {}, false],
    ["换代", (_facts, harness) => { harness.target = { ...harness.target, generation: 2 }; }],
    ["AX失败", (facts) => { facts.ax_window_error = -25204; }],
    ["仍在启动", (facts) => { facts.is_finished_launching = false; }],
    ["无有效尺寸", (facts) => { facts.window_server.windows[0].bounds.Width = null; }],
    ["错PID", (facts) => { facts.target.pid = 999; }],
    ["错路径", (facts) => { facts.target.executable_path = "/other/app"; }],
    ["错运行", (facts) => { facts.target.run_ref = "other"; }],
    ["缺WS事实", (facts) => { facts.window_server = { available: false, windows: null }; }],
    ["空WS集合", (facts) => { facts.window_server.windows = []; }],
    ["可见性未知", (facts) => { delete facts.window_server.windows[0].on_screen; }],
    ["仍在屏幕", (facts) => { facts.window_server.windows[0].on_screen = true; }],
    ["非普通层", (facts) => { facts.window_server.windows[0].layer = 3; }],
  ];
  for (const [name, mutate, seen = true] of cases) {
    const { dir, harness } = makeHarness({});
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    harness.target = { ...harness.target, pid: 321, generation: 1 };
    harness.APP = harness.target;
    harness.input = countingInput();
    harness.io.dump = () => [{ role: "AXWindow" }, { role: "AXWebArea" }];
    const facts = { ok: true, pid: 321, target: { ...harness.target },
      is_finished_launching: true, ax_window_error: 0, ax_window_count: 1,
      window_server: { available: true, windows: [{ id: 17, layer: 0,
        bounds: { X: 0, Y: 0, Width: 1280, Height: 801 }, on_screen: true }] } };
    harness.io.startup = () => facts;
    if (seen) await harness.tryPollAx(() => true, 1000, "visible_before");
    facts.window_server.windows[0].on_screen = false;
    facts.ax_window_count = 0;
    mutate(facts, harness);
    harness.io.dump = () => [];
    const result = await harness.tryPollAx(() => true, 1000, name);
    assert.deepEqual(result.nodes, [], name);
    assert.deepEqual(harness.input.calls, [], name);
  }
});

for (const method of ["pollAx", "tryPollAx"]) {
  test(`${method}: 启动中先缺窗口再就绪，不投递猜测的 Escape 或激活动作`, async (t) => {
    const ready = [{ role: "AXWindow" }, { role: "AXWebArea" },
      { role: "AXStaticText", title: "真实历史已恢复" },
      ...Array.from({ length: 6 }, () => ({ role: "AXStaticText" }))];
    let reads = 0;
    const { dir, harness } = makeHarness({ dump: () => ++reads <= 2 ? [] : ready });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    harness.input = countingInput();
    // 只替换动作边界，旧实现仍真正执行它的缺窗口恢复分支；不触碰系统桌面。
    harness.recoverInteractionSurface = () => {
      harness.input.activate(); harness.input.key("escape");
    };
    harness.activateForInteraction = () => harness.input.activate();
    const result = await harness[method]((text) => text.includes("真实历史已恢复"), 3000, "history");
    assert.deepEqual(result.nodes, ready);
    assert.equal(reads, 3);
    assert.deepEqual(harness.input.calls, [], "等待不能通过输入改变被测窗口");
  });
}

test("pollAx 的 AX 读取异常不借输入恢复，后续真实读仍可完成", async (t) => {
  const nodes = [{ role: "AXStaticText", title: "已恢复" }];
  let reads = 0;
  const { dir, harness } = makeHarness({ dump: () => {
    if (++reads === 1) throw new Error("AX暂不可得");
    return nodes;
  } });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  harness.input = countingInput();
  harness.recoverInteractionSurface = () => harness.input.key("escape");
  harness.activateForInteraction = () => harness.input.activate();
  const result = await harness.pollAx((text) => text === "已恢复", 3000, "history-read");
  assert.deepEqual(result.nodes, nodes);
  assert.deepEqual(harness.input.calls, []);
});function stubLaunchSeams(harness, { calls, startups, activate }) {
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

const VISIBLE_WORK_TITLE = "潮汐来信";

// 共享入口只允许作者可见菜单操作；mock 不暴露数据库、内部 ID 或重启入口。
function visibleWorkHarness({ selected, calls }) {
  return {
    runStep: async (kind, label, fn) => {
      calls.push(["step", kind, label]);
      return fn();
    },
    rawTrySelectWork: async (title, label) => {
      calls.push(["select", title, label]);
      return selected;
    },
  };
}

test("ensureWorkSelected 只按可见作品名走真实菜单选中", async () => {
  const calls = [];
  const harness = visibleWorkHarness({ selected: true, calls });

  const selected = await ensureWorkSelected(harness, VISIBLE_WORK_TITLE, "initial");

  assert.equal(selected, true);
  assert.deepEqual(
    calls,
    [
      ["step", "maintenance", "select_work:initial"],
      ["select", VISIBLE_WORK_TITLE, "initial"],
    ],
    "实际输入只有作者可见作品名",
  );
});

test("ensureWorkSelected 菜单失败当场抛 work_not_selected，不重试", async () => {
  const calls = [];
  const harness = visibleWorkHarness({ selected: false, calls });

  await assert.rejects(
    () => ensureWorkSelected(harness, VISIBLE_WORK_TITLE, "initial"),
    { message: `work_not_selected:${VISIBLE_WORK_TITLE}` },
    "菜单失败必须当场失败，不能内部回退",
  );

  assert.deepEqual(
    calls,
    [
      ["step", "maintenance", "select_work:initial"],
      ["select", VISIBLE_WORK_TITLE, "initial"],
    ],
    "失败后不得盲重试",
  );
});

test("rawSubmitAuthorText 只做可见输入/回读/点击，旧 rawTypeAndSend 仍组合 wire 轮询", async (t) => {
  const { dir, harness } = makeHarness({});
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  let value = "";
  const composer = { path: "0/1", role: "AXTextField", desc: "输入", enabled: true, frame: [0, 0, 10, 10] };
  harness.checkSupervisor = () => {};
  harness.dumpNodes = () => [{ ...composer, value }];
  harness.findComposer = () => ({ ...composer, value });
  harness.clickSend = () => calls.push("send");
  harness.ensureInput = () => ({
    activate: () => {
      calls.push("activate");
      return { confirmed: true };
    },
    focus: () => calls.push("focus"),
    clear: () => calls.push("clear"),
    type: (text) => {
      calls.push("type");
      value = text;
    },
  });
  harness.pollWire = async () => {
    calls.push("wire");
    return { frame: [] };
  };

  const startedAt = await harness.rawSubmitAuthorText("作者自然原话", "visible");
  assert.match(startedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.deepEqual(calls, ["activate", "focus", "type", "send"], "可见提交不得轮询 wire");

  calls.length = 0;
  value = "";
  const sent = await harness.rawTypeAndSend("作者自然原话", "wire");
  assert.deepEqual(calls, ["activate", "focus", "type", "send", "wire"], "旧入口必须保留原 wire 轮询");
  assert.deepEqual(sent, { frame: [] });
});
