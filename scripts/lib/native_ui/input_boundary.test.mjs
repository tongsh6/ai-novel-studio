// 输入投递边界行为测试：注入假 probe/deliver/sink，证明拒绝时零投递、合法时只投给绑定 PID。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTarget, bindTarget, relaunchTarget, authorizeInput, OwnershipError } from "./input_target.mjs";
import { NativeInputBoundary, adapterFailure, makeJsonlSink, parseAdapterJson, safeReason } from "./input_boundary.mjs";
import { inputBoundary } from "./driver.mjs";

function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-boundary-")));
  const bundle = path.join(dir, "AI Novel Studio.app");
  const executable = path.join(bundle, "Contents", "MacOS", "app");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "#!/bin/sh\n", { mode: 0o755 });
  const ready = {
    run_ref: "run-boundary-1",
    bundle_identifier: "com.ai-novel-studio.app",
    app_path: bundle,
    native_executable: "app",
    driver: "external-system-ui",
  };
  const base = buildTarget(ready, dir);
  const target = bindTarget(base, {
    matches: [{ pid: 4321, executable_path: base.executable_path, bundle_identifier: base.bundle_identifier }],
    pid: 4321,
  });
  return { dir, target };
}

function facts(target, patch = {}) {
  return {
    resolution: {
      matches: [{ pid: target.pid, executable_path: target.executable_path, bundle_identifier: target.bundle_identifier }],
      pid: target.pid,
    },
    frontmost: { pid: target.pid, bundle_identifier: target.bundle_identifier },
    permissions: { ax_trusted: true, post_access: true },
    focus: {
      pid: target.pid,
      role: "AXTextField",
      path: "0/2/1",
      desc: "输入你的想法、问题或指令...",
      enabled: true,
      value_settable: true,
      matches: true,
    },
    ...patch,
  };
}

function harness({ target, probeFacts = () => facts(target), deliverResult = () => ({ ok: true, input_length: 0 }) } = {}) {
  const sinkLines = [];
  const deliveries = [];
  const probes = [];
  const boundary = new NativeInputBoundary({
    target,
    probe: (request) => {
      probes.push(request);
      return typeof probeFacts === "function" ? probeFacts(request) : probeFacts;
    },
    deliver: (request) => {
      deliveries.push(request);
      return typeof deliverResult === "function" ? deliverResult(request) : deliverResult;
    },
    sink: { record: (event) => sinkLines.push(event) },
    now: () => "2026-11-02T00:00:00.000Z",
  });
  return { boundary, deliveries, probes, sinkLines };
}

const expected = { role: "AXTextField", path: "0/2/1", desc_contains: "输入" };

test("授权拒绝时零投递，并留下结构化拒绝原因", async () => {
  const { target } = fixture();
  const cases = [
    [facts(target, { frontmost: null }), "frontmost_missing"],
    [facts(target, { frontmost: { pid: 1, bundle_identifier: target.bundle_identifier } }), "not_frontmost"],
    [facts(target, { resolution: { matches: [], pid: 0 } }), "target_not_running"],
    [facts(target, { focus: { ...facts(target).focus, path: "0/9" } }), "focus_path_mismatch"],
    [facts(target, { permissions: { ax_trusted: true, post_access: false } }), "post_access_required"],
  ];
  for (const [probeFacts, reason] of cases) {
    const { boundary, deliveries, sinkLines } = harness({ target, probeFacts });
    assert.throws(() => boundary.type("测试", expected), new RegExp(reason));
    assert.equal(deliveries.length, 0, reason);
    assert.equal(sinkLines.length, 1);
    assert.equal(sinkLines[0].event, "rejected");
    assert.equal(sinkLines[0].reason, reason);
    assert.equal(sinkLines[0].target.pid, target.pid);
  }
});

test("合法输入始终只投递给绑定 PID，证据只记录长度不记录文本", async () => {
  const { target } = fixture();
  const { boundary, deliveries, sinkLines } = harness({ target, deliverResult: () => ({ ok: true, input_length: 3 }) });
  boundary.type("真实文本", expected);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].pid, target.pid);
  assert.equal(deliveries[0].generation, target.generation);
  assert.equal(deliveries[0].text, "真实文本");
  assert.deepEqual(sinkLines.map((line) => line.event), ["attempt", "result"]);
  assert.equal(sinkLines[1].reason, undefined);
  const serialized = JSON.stringify(sinkLines);
  assert.equal(serialized.includes("真实文本"), false);
  assert.equal(sinkLines[0].input_length, 4);
  assert.equal(sinkLines[1].target.pid, target.pid);
  assert.equal(sinkLines[1].target.executable_path, target.executable_path);
  assert.equal(sinkLines[1].run_ref, target.run_ref);
});

test("类型输入逐块投递；第 2 块焦点丢失时立即停止且不再投递后续块", async () => {
  const { target } = fixture();
  let probeCount = 0;
  const { boundary, deliveries } = harness({
    target,
    probeFacts: () => {
      probeCount += 1;
      if (probeCount === 1) return facts(target);
      return facts(target, { focus: { ...facts(target).focus, matches: false } });
    },
    deliverResult: (request) => ({ ok: true, input_length: request.text.length }),
  });
  assert.throws(() => boundary.type("abcdefghijklmnopqrstuvwxyz", expected), /focus_mismatch/);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].text, "abcdefghijklmnop");
});

test("投递结果失败不伪造成功，并记录结果原因", async () => {
  const { target } = fixture();
  const { boundary, sinkLines } = harness({
    target,
    deliverResult: () => ({ ok: false, reason: "target_process_changed", delivered_chunks: 0 }),
  });
  assert.throws(() => boundary.click("0/1"), (error) => {
    assert.equal(error.reason, "target_process_changed");
    assert.equal(error.details.ok, false);
    return true;
  });
  assert.equal(sinkLines.at(-1).event, "result");
  assert.equal(sinkLines.at(-1).ok, false);
  assert.equal(sinkLines.at(-1).reason, "target_process_changed");
});

test("result 事件保留 activate 操作返回的真实 activation，不拿 probe 事前快照冒充", () => {
  const { target } = fixture();
  const { boundary, sinkLines } = harness({
    target,
    // 旧 producer/手造 fixture 的 probe 可能带 requested=false；result 不能消费它。
    probeFacts: facts(target, {
      activation: { requested: false, returned: null, confirmed: true, waited_ms: 0 },
    }),
    deliverResult: () => ({
      ok: true,
      activation: {
        requested: true,
        returned: true,
        confirmed: true,
        waited_ms: 50,
        frontmost_before: { pid: 1, bundle_identifier: "com.other" },
        frontmost_after: { pid: target.pid, bundle_identifier: target.bundle_identifier },
      },
      permissions: { ax_trusted: true, post_access: true },
      frontmost_after: { pid: target.pid, bundle_identifier: target.bundle_identifier },
    }),
  });
  boundary.activate();
  const [attempt, result] = sinkLines;
  assert.equal(attempt.activation, undefined);
  assert.equal(result.activation.requested, true);
  assert.equal(result.activation.returned, true);
  assert.equal(result.activation.confirmed, true);
  assert.equal(result.activation.waited_ms, 50);
  assert.equal(result.frontmost.pid, target.pid);
  assert.equal(result.permissions.post_access, true);
});

test("result 事件保留 focus 操作返回的真实 focus/frontmost_after，不拿 probe 事前焦点冒充", () => {
  const { target } = fixture();
  const actualFocus = {
    pid: target.pid,
    role: "AXTextField",
    path: "0/2/1",
    desc: "输入你的想法、问题或指令...",
    enabled: true,
    value_settable: true,
    matches: true,
  };
  const { boundary, sinkLines } = harness({
    target,
    probeFacts: facts(target, {
      activation: { requested: false, returned: null, confirmed: true, waited_ms: 0 },
      focus: { ...facts(target).focus, role: "AXWebArea", matches: false },
    }),
    deliverResult: () => ({
      ok: true,
      method: "axfocus",
      permissions: { ax_trusted: true, post_access: true },
      frontmost_after: { pid: target.pid, bundle_identifier: target.bundle_identifier },
      focus: actualFocus,
    }),
  });
  boundary.focus("0/2/1", expected);
  const [attempt, result] = sinkLines;
  assert.equal(attempt.activation, undefined);
  assert.equal(result.activation, undefined);
  assert.equal(result.focus.role, "AXTextField");
  assert.equal(result.focus.matches, true);
  assert.equal(result.frontmost.pid, target.pid);
  assert.equal(result.permissions.post_access, true);
  assert.equal(result.result.method, "axfocus");
});

test("deliver 抛错时 result 不把 probe 观测冒充为操作 after", () => {
  const { target } = fixture();
  const { boundary, sinkLines } = harness({
    target,
    probeFacts: facts(target, {
      activation: { requested: false, returned: null, confirmed: true, waited_ms: 0 },
      focus: { ...facts(target).focus, role: "AXWebArea", matches: false },
    }),
    deliverResult: () => { throw new OwnershipError("swift_crash"); },
  });
  assert.throws(() => boundary.focus("0/2/1", expected), /swift_crash/);
  const result = sinkLines.at(-1);
  assert.equal(result.event, "result");
  assert.equal(result.activation, undefined);
  assert.equal(result.frontmost, null);
  assert.equal(result.focus, null);
  assert.equal(result.permissions, null);
  assert.equal(result.reason, "swift_crash");
});

test("证据写入失败时零投递", async () => {
  const { target } = fixture();
  const deliveries = [];
  const boundary = new NativeInputBoundary({
    target,
    probe: () => facts(target),
    deliver: (request) => {
      deliveries.push(request);
      return { ok: true };
    },
    sink: { record: () => { throw new Error("disk_full"); } },
  });
  assert.throws(() => boundary.type("abc", expected), /input_evidence_write_failed/);
  assert.equal(deliveries.length, 0);
});

test("显式 relaunch 才换代；旧代请求与旧 PID 授权失败", async () => {
  const { target } = fixture();
  const next = relaunchTarget(target, {
    matches: [{ pid: 9876, executable_path: target.executable_path, bundle_identifier: target.bundle_identifier }],
    pid: 9876,
  });
  assert.equal(next.pid, 9876);
  assert.equal(next.generation, 1);
  const { boundary, deliveries } = harness({ target: next, probeFacts: () => facts(target) });
  assert.throws(() => boundary.type("abc", expected), /target_process_changed/);
  assert.equal(deliveries.length, 0);
});

test("JSONL sink 落盘为逐行事件，不混入等待账", () => {
  const { dir } = fixture();
  const file = path.join(dir, "native-input-events.jsonl");
  const sink = makeJsonlSink(file);
  sink.record({ event: "attempt", gesture: "insert", input_length: 2 });
  sink.record({ event: "result", gesture: "insert", ok: true });
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map((line) => line.event), ["attempt", "result"]);
  assert.equal(lines[0].input_length, 2);
});


test("构造边界拒绝未绑定 target、缺 probe/deliver/sink", () => {
  const { target } = fixture();
  assert.throws(() => new NativeInputBoundary({ target: null, probe: () => ({}), deliver: () => ({}), sink: { record() {} } }), /target_unbound/);
  assert.throws(() => new NativeInputBoundary({ target: undefined, probe: () => ({}), deliver: () => ({}), sink: { record() {} } }), /target_unbound/);
  assert.throws(() => new NativeInputBoundary({ target: { ...target, pid: null }, probe: () => ({}), deliver: () => ({}), sink: { record() {} } }), /target_unbound/);
  assert.throws(() => new NativeInputBoundary({ target, probe: null, deliver: () => ({}), sink: { record() {} } }), /probe_required/);
  assert.throws(() => new NativeInputBoundary({ target, probe: () => ({}), deliver: null, sink: { record() {} } }), /deliver_required/);
  assert.throws(() => new NativeInputBoundary({ target, probe: () => ({}), deliver: () => ({}), sink: null }), /sink_required/);
});

test("probe 抛错或返回 ok:false 时都不投递并记录拒绝", () => {
  const { target } = fixture();
  const thrown = harness({ target, probeFacts: () => { throw new OwnershipError("target_not_running"); } });
  assert.throws(() => thrown.boundary.type("abc", expected), /target_not_running/);
  assert.equal(thrown.deliveries.length, 0);
  assert.equal(thrown.sinkLines.at(-1).event, "rejected");

  const failed = harness({ target, probeFacts: () => ({ ok: false, reason: "target_process_changed" }) });
  assert.throws(() => failed.boundary.type("abc", expected), /target_process_changed/);
  assert.equal(failed.deliveries.length, 0);
  assert.equal(failed.sinkLines.at(-1).reason, "target_process_changed");
});

test("所有输入包装器都用同一绑定 PID 且不夹带文本", () => {
  const { target } = fixture();
  const { boundary, deliveries } = harness({ target, deliverResult: () => ({ ok: true }) });
  boundary.activate();
  boundary.click("0/1");
  boundary.clickAt(10, 20, 2);
  boundary.scrollAt(10, 20, -300);
  boundary.scrollTo("0/1");
  boundary.setValue("0/1", "敏感值");
  boundary.focus("0/1", expected);
  boundary.key("escape");
  boundary.clear(expected);
  assert.ok(deliveries.length >= 10);
  for (const request of deliveries) {
    assert.equal(request.pid, target.pid);
    assert.equal(request.generation, target.generation);
  }
  const serialized = JSON.stringify(deliveries);
  assert.equal(serialized.includes("敏感值"), true); // 投递请求需要真实值；证据账不得包含它
});

test("deliver 抛错时记录 result 原因并原样失败", () => {
  const { target } = fixture();
  const { boundary, sinkLines } = harness({ target, deliverResult: () => { throw new OwnershipError("swift_crash"); } });
  assert.throws(() => boundary.click("0/1"), /swift_crash/);
  assert.equal(sinkLines.at(-1).event, "result");
  assert.equal(sinkLines.at(-1).ok, null);
  assert.equal(sinkLines.at(-1).reason, "swift_crash");
});

test("recordRelaunch 只记录新旧 PID 与 target 代数", () => {
  const { target } = fixture();
  const { boundary, sinkLines } = harness({ target });
  boundary.recordRelaunch(4321, 9876);
  assert.equal(sinkLines.at(-1).event, "relaunch");
  assert.equal(sinkLines.at(-1).from_pid, 4321);
  assert.equal(sinkLines.at(-1).target.pid, 9876);
  assert.equal(sinkLines.at(-1).target.executable_path, target.executable_path);
});


test("JSONL sink 写失败转换为 input_evidence_write_failed", () => {
  const { dir } = fixture();
  const sink = makeJsonlSink(path.join(dir, "missing-parent", "native-input-events.jsonl"));
  assert.throws(() => sink.record({ event: "attempt" }), /input_evidence_write_failed/);
});

test("deliver 返回 null 不伪造成功；activate 未确认抛 activation_unconfirmed", () => {
  const { target } = fixture();
  const nullDeliver = harness({ target, deliverResult: () => null });
  assert.throws(() => nullDeliver.boundary.click("0/1"), /input_rejected/);
  assert.equal(nullDeliver.sinkLines.at(-1).event, "result");
  assert.equal(nullDeliver.sinkLines.at(-1).ok, null);

  let count = 0;
  const activateBoundary = harness({
    target,
    deliverResult: () => {
      count += 1;
      return count === 1 ? { ok: false, reason: "activation_unconfirmed" } : { ok: true };
    },
  });
  assert.throws(() => activateBoundary.boundary.activate(), /activation_unconfirmed/);
});


test("focus/click/clickAt/scroll/scrollTo/setValue 默认不要求 composer 焦点", () => {
  const { target } = fixture();
  const { boundary, deliveries } = harness({ target, probeFacts: () => facts(target, { focus: null }) });
  boundary.focus("0/1", expected);
  boundary.click("0/1");
  boundary.clickAt(3, 4);
  boundary.scrollAt(3, 4, -10);
  boundary.scrollTo("0/1");
  boundary.setValue("0/1", "v");
  boundary.key("escape");
  assert.deepEqual(deliveries.map((request) => request.gesture), ["focus", "click", "click_at", "scroll", "scroll_to", "set", "key"]);
  assert.equal(deliveries[2].count, 1);
  for (const request of deliveries) assert.equal(request.focus_required, false);
});

test("clear 必须对两个清空快捷键都要求预期焦点与编辑状态", () => {
  const { target } = fixture();
  const rejected = harness({ target, probeFacts: () => facts(target, { focus: null }) });
  assert.throws(() => rejected.boundary.clear(expected), /focus_missing/);
  assert.equal(rejected.deliveries.length, 0);
  const ok = harness({ target });
  assert.deepEqual(ok.boundary.clear(expected), { ok: true, delivered_chunks: 2 });
});

test("type 结果携带真实块数；首块失败时报 zero delivered 且不虚报成功", () => {
  const { target } = fixture();
  const ok = harness({ target, deliverResult: () => ({ ok: true }) });
  assert.deepEqual(ok.boundary.type("abcdefghijklmnopqrstuvwxyz", expected), {
    ok: true,
    input_length: 26,
    delivered_chunks: 2,
  });
  assert.deepEqual(ok.boundary.type("a".repeat(32), expected), {
    ok: true,
    input_length: 32,
    delivered_chunks: 2,
  });
  const failing = harness({ target, deliverResult: () => ({ ok: false, reason: "x" }) });
  assert.throws(() => failing.boundary.type("abc", expected), (error) => {
    assert.equal(error.details.delivered_chunks, 0);
    assert.equal(error.details.total_chunks, 1);
    assert.equal(error.details.input_length, 3);
    return true;
  });
});


test("inputEvent 对 focus 空对象也输出可判定的 unknown 状态", () => {
  const { target } = fixture();
  const { boundary, sinkLines } = harness({ target, probeFacts: () => facts(target, { focus: {} }) });
  assert.throws(() => boundary.type("abc", expected), /focus_owner_mismatch/);
  assert.equal(sinkLines.at(-1).event, "rejected");
});


test("空/缺省 reason 与 activation/focus/result 事实有明确回退", () => {
  const { target } = fixture();
  const emptyReason = harness({ target, deliverResult: () => ({ ok: false, reason: "" }) });
  assert.throws(() => emptyReason.boundary.click("0/1"), /input_rejected/);

  const emptyProbeReason = harness({ target, probeFacts: () => ({ ok: false, reason: "" }) });
  assert.throws(() => emptyProbeReason.boundary.click("0/1"), /probe_failed/);

  const emptyActivation = harness({ target, deliverResult: () => ({ ok: false, reason: "" }) });
  assert.throws(() => emptyActivation.boundary.activate(), /activation_unconfirmed/);

  const thrownNull = harness({ target, deliverResult: () => { throw null; } });
  assert.throws(() => thrownNull.boundary.click("0/1"), /delivery_error/);
});


test("clear 第二下 delete 丢失焦点也停止，不把清空当无条件成功", () => {
  const { target } = fixture();
  let probes = 0;
  const { boundary, deliveries } = harness({
    target,
    probeFacts: () => {
      probes += 1;
      return probes === 1 ? facts(target) : facts(target, { focus: null });
    },
  });
  assert.throws(() => boundary.clear(expected), /focus_missing/);
  assert.equal(deliveries.length, 1);
});

test("probe 返回 null、probe 抛 null、sink 抛 null、前台观测缺省都失败关闭", () => {
  const { target } = fixture();
  const nullFacts = harness({ target, probeFacts: () => null });
  assert.throws(() => nullFacts.boundary.click("0/1"), /probe_failed/);

  const nullProbe = harness({ target, probeFacts: () => { throw null; } });
  assert.throws(() => nullProbe.boundary.click("0/1"), /probe_error/);

  const nullSink = new NativeInputBoundary({
    target,
    probe: () => facts(target),
    deliver: () => ({ ok: true }),
    sink: { record: () => { throw null; } },
  });
  assert.throws(() => nullSink.click("0/1"), /input_evidence_write_failed/);

  const noFrontmost = harness({ target, probeFacts: () => facts(target, { frontmost: undefined }) });
  assert.throws(() => noFrontmost.boundary.click("0/1"), /frontmost_missing/);
});

test("未绑定 target 在 resolver/投递前直接失败", () => {
  const { target } = fixture();
  assert.throws(() => inputBoundary({ ...target, pid: null }), /target_unbound/);
  assert.throws(() => inputBoundary({ ...target, pid: 0 }), /target_pid_invalid/);
});

test("probe 的 target/request 不能覆盖已绑定 authority；错进程零投递", () => {
  const { target } = fixture();
  const otherPid = 2002;
  const other = { ...target, pid: otherPid };
  let delivered = 0;
  const boundary = new NativeInputBoundary({
    target,
    probe: () => ({
      ...facts(other),
      target: other,
      request: { gesture: "insert", pid: otherPid, generation: 0, focus_required: true, expected_focus: expected },
    }),
    deliver: () => {
      delivered += 1;
      return { ok: true };
    },
    sink: { record() {} },
  });
  assert.throws(() => boundary.insert("x", expected), /target_process_changed/);
  assert.equal(delivered, 0);
});

test("权限只接受显式 boolean true；前台事实缺失/类型错/非目标都不 grant", () => {
  const { target } = fixture();
  const request = {
    gesture: "insert",
    pid: target.pid,
    generation: target.generation,
    focus_required: true,
    expected_focus: expected,
  };
  const authorize = (patch) => authorizeInput({ target, request, ...facts(target, patch) });
  for (const value of ["false", 1, "true", {}, []]) {
    assert.deepEqual(authorize({ permissions: { ax_trusted: value, post_access: true } }), {
      allowed: false,
      reason: "ax_trust_required",
    });
  }
  for (const value of ["false", 1, "true"]) {
    assert.deepEqual(authorize({ permissions: { ax_trusted: true, post_access: value } }), {
      allowed: false,
      reason: "post_access_required",
    });
  }
  for (const frontmost of [undefined, null, {}, "target", 1]) {
    assert.equal(authorize({ frontmost }).allowed, false);
  }
  assert.deepEqual(authorize({ frontmost: { pid: 1, bundle_identifier: target.bundle_identifier } }), {
    allowed: false,
    reason: "not_frontmost",
  });
  assert.deepEqual(authorize({ frontmost: { pid: target.pid, bundle_identifier: "com.other" } }), {
    allowed: false,
    reason: "frontmost_bundle_mismatch",
  });
  assert.deepEqual(authorize({ permissions: { ax_trusted: true, post_access: true } }), { allowed: true });
});

test("enabled 未知时 AXValue 显式可写是正例；不可写/truthy 未知必须停在未确认", () => {
  const { target } = fixture();
  const request = {
    gesture: "insert",
    pid: target.pid,
    generation: target.generation,
    focus_required: true,
    expected_focus: expected,
  };
  const run = (focusPatch) => {
    const data = facts(target);
    Object.assign(data.focus, focusPatch);
    return authorizeInput({ target, request, ...data });
  };
  assert.deepEqual(run({ enabled: null, value_settable: true }), { allowed: true });
  assert.deepEqual(run({ enabled: null, value_settable: false }), {
    allowed: false,
    reason: "composer_state_unconfirmed",
  });
  assert.deepEqual(run({ enabled: null, value_settable: 1 }), {
    allowed: false,
    reason: "composer_state_unconfirmed",
  });
  assert.deepEqual(run({ enabled: true, value_settable: false }), { allowed: true });
  assert.deepEqual(run({ enabled: false, value_settable: true }), {
    allowed: false,
    reason: "composer_disabled",
  });
});

test("adapter 失败原因/facts/request 不进入错误或日志正文", () => {
  const { target } = fixture();
  const marker = "private-input-marker";
  let delivered = 0;
  const { boundary, sinkLines } = harness({
    target,
    deliverResult: () => {
      delivered += 1;
      const error = new Error(`boom ${marker}`);
      error.code = "EIO";
      throw error;
    },
  });
  let failure;
  try {
    boundary.insert(marker, expected);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.equal(failure.reason, "delivery_error");
  assert.equal(failure.details.code, "EIO");
  assert.equal(JSON.stringify(failure).includes(marker), false);
  assert.equal(JSON.stringify(sinkLines).includes(marker), false);
  assert.equal(delivered, 1);

  const probeFailure = harness({ target, probeFacts: () => { throw new Error(`probe ${marker}`); } });
  let probeError;
  try {
    probeFailure.boundary.insert(marker, expected);
  } catch (error) {
    probeError = error;
  }
  assert.equal(probeError.reason, "probe_error");
  assert.equal(JSON.stringify(probeError).includes(marker), false);
  assert.equal(JSON.stringify(probeFailure.sinkLines).includes(marker), false);

  const nullFacts = harness({ target, probeFacts: () => null });
  let nullError;
  try {
    nullFacts.boundary.insert(marker, expected);
  } catch (error) {
    nullError = error;
  }
  assert.equal(JSON.stringify(nullError).includes(marker), false);
});

test("execFileSync 风格错误只保留 code/signal/status 与输出长度", () => {
  const marker = "private-input-marker";
  const error = Object.assign(new Error(`Command failed: ax_cua input '${marker}'`), {
    code: "ENOENT",
    signal: "SIGTERM",
    status: 1,
    stdout: marker,
    stderr: `stderr ${marker}`,
  });
  const failure = adapterFailure(error, "input");
  assert.equal(failure.reason, "adapter_exec_failed");
  assert.equal(failure.details.command, "input");
  assert.equal(failure.details.code, "ENOENT");
  assert.equal(failure.details.signal, "SIGTERM");
  assert.equal(failure.details.status, 1);
  assert.equal(failure.details.stdout_length, marker.length);
  assert.equal(failure.details.stderr_length, `stderr ${marker}`.length);
  assert.equal(JSON.stringify(failure).includes(marker), false);

  assert.throws(() => parseAdapterJson(`{"text":"${marker}"`, "input"), (failure) => {
    assert.equal(failure.reason, "adapter_output_invalid");
    assert.equal(failure.details.command, "input");
    assert.equal(JSON.stringify(failure).includes(marker), false);
    return true;
  });
  assert.equal(safeReason(new Error(marker)), "adapter_failure");
  assert.equal(safeReason({ reason: "target_not_running" }), "target_not_running");

  const unsafe = adapterFailure(Object.assign(new Error(marker), {
    code: `bad code ${marker}`,
    signal: "SIG TERM",
    status: Number.POSITIVE_INFINITY,
    stdout: marker,
  }), "input");
  assert.equal(unsafe.details.code, undefined);
  assert.equal(unsafe.details.signal, undefined);
  assert.equal(unsafe.details.status, undefined);
  assert.equal(unsafe.details.stdout_length, marker.length);
  assert.equal(JSON.stringify(unsafe).includes(marker), false);

  assert.deepEqual(parseAdapterJson('{"ok":true}', "input"), { ok: true });
});
