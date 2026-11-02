// 目标归属/输入授权纯策略测试：不发真实事件、不启动 GUI，只用临时 app 目录与假进程事实。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TARGET_SCHEMA,
  authorizeInput,
  bindTarget,
  buildTarget,
  composerExpectation,
  inputEvent,
  normalizePath,
  operationResultFacts,
  probeObservation,
  relaunchTarget,
  resolveOwnedProcess,
  splitUtf16Chunks,
} from "./input_target.mjs";

function fixtureReady({ driver = "external-system-ui", nativeExecutable = "app", appName = "AI Novel Studio.app" } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-target-")));
  const bundle = path.join(dir, appName);
  const executable = path.join(bundle, "Contents", "MacOS", nativeExecutable);
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "#!/bin/sh\n", { mode: 0o755 });
  const ready = {
    run_ref: "run-target-1",
    bundle_identifier: "com.ai-novel-studio.app",
    app_path: bundle,
    native_executable: nativeExecutable,
    driver,
  };
  return { dir, bundle, executable, ready };
}

const targetFor = (fixture, extra = {}) => {
  const target = buildTarget(fixture.ready, fixture.dir);
  return { ...target, pid: 4242, ...extra };
};

const resolutionFor = (target, extra = {}) => ({
  matches: [{ pid: target.pid, executable_path: target.executable_path, bundle_identifier: target.bundle_identifier }],
  pid: target.pid,
  ...extra,
});

const allowedFacts = (target) => ({
  resolution: resolutionFor(target),
  frontmost: { pid: target.pid, bundle_identifier: target.bundle_identifier },
  permissions: { ax_trusted: true, post_access: true },
  focus: {
    pid: target.pid,
    role: "AXTextField",
    path: "0/1/2",
    desc: "输入你的想法、问题或指令...",
    enabled: true,
    value_settable: true,
    matches: true,
  },
});

const requestFor = (target, extra = {}) => ({
  gesture: "insert",
  pid: target.pid,
  generation: target.generation,
  focus_required: true,
  expected_focus: { role: "AXTextField", path: "0/1/2", desc_contains: "输入" },
  ...extra,
});

test("buildTarget 只从 ready 的绝对 app_path 推导本批 executable", () => {
  const fixture = fixtureReady();
  const target = buildTarget(fixture.ready, fixture.dir);
  assert.equal(target.schema, TARGET_SCHEMA);
  assert.equal(target.app_path, fixture.bundle);
  assert.equal(target.executable_path, fixture.executable);
  assert.equal(target.artifact_dir, fixture.dir);
  assert.equal(target.run_ref, "run-target-1");
  assert.equal(target.pid, null);
  assert.equal(target.generation, 0);
  assert.equal(Object.isFrozen(target), true);
});

test("buildTarget 拒绝错 driver、相对路径、越界路径与不匹配 executable", () => {
  const badDriver = fixtureReady({ driver: "cua-native-system-ui" });
  assert.throws(() => buildTarget(badDriver.ready, badDriver.dir), /ready_driver_invalid/);

  const relative = fixtureReady();
  assert.throws(
    () => buildTarget({ ...relative.ready, app_path: "AI Novel Studio.app" }, relative.dir),
    /app_path_not_absolute/,
  );

  const outside = fixtureReady();
  const otherDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-target-outside-")));
  assert.throws(() => buildTarget(outside.ready, otherDir), /app_path_outside_batch/);

  const missing = fixtureReady();
  fs.rmSync(missing.executable);
  assert.throws(() => buildTarget(missing.ready, missing.dir), /target_executable_missing/);

  const wrongName = fixtureReady();
  assert.throws(
    () => buildTarget({ ...wrongName.ready, native_executable: "native-app" }, wrongName.dir),
    /target_executable_missing/,
  );
});

test("resolveOwnedProcess 只接受唯一精确 executable，零/多匹配都失败", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  assert.equal(resolveOwnedProcess(target, [{ pid: 7, executable_path: fixture.executable }]).pid, 7);
  assert.throws(() => resolveOwnedProcess(target, []), /target_not_running/);
  assert.throws(
    () => resolveOwnedProcess(target, [
      { pid: 7, executable_path: fixture.executable },
      { pid: 8, executable_path: fixture.executable },
    ]),
    /target_ambiguous/,
  );
  assert.throws(
    () => resolveOwnedProcess(target, [{ pid: 7, executable_path: path.join(fixture.dir, "other app") }]),
    /target_not_running/,
  );
  assert.equal(normalizePath(fixture.executable), fixture.executable);
});

test("bindTarget 首次绑定保留 generation，显式 relaunch 才换代", () => {
  const fixture = fixtureReady();
  const target = buildTarget(fixture.ready, fixture.dir);
  const bound = bindTarget(target, resolutionFor({ ...target, pid: 101 }));
  assert.equal(bound.pid, 101);
  assert.equal(bound.generation, 0);

  const relaunched = relaunchTarget(bound, resolutionFor({ ...bound, pid: 202 }));
  assert.equal(relaunched.pid, 202);
  assert.equal(relaunched.generation, 1);

  assert.throws(
    () => bindTarget(target, { matches: [], pid: 0 }),
    /target_not_running/,
  );
  assert.throws(
    () => bindTarget(target, { matches: [resolutionFor({ ...target, pid: 101 }).matches[0], resolutionFor({ ...target, pid: 102 }).matches[0]], pid: 101 }),
    /target_ambiguous/,
  );
  assert.throws(
    () => bindTarget(target, resolutionFor({ ...target, pid: 101 }, { pid: 999 })),
    /target_process_changed/,
  );
});

test("authorizeInput 拒绝错 PID、错路径、多义、前台缺失/冲突、焦点不符与未确认控件状态", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const request = requestFor(target);
  assert.deepEqual(authorizeInput({ target, request, ...allowedFacts(target) }), { allowed: true });

  const cases = [
    [{ request: requestFor(target, { pid: 999 }) }, "pid_mismatch"],
    [{ request: null }, "request_invalid"],
    [{ target: { ...target, schema: "other" } }, "target_schema_invalid"],
    [{ request: requestFor(target, { generation: 4 }) }, "generation_mismatch"],
    [{ resolution: { matches: [], pid: 0 } }, "target_not_running"],
    [{ resolution: { matches: [...resolutionFor(target).matches, ...resolutionFor(target).matches], pid: target.pid } }, "target_ambiguous"],
    [{ resolution: { ...resolutionFor(target), matches: [{ ...resolutionFor(target).matches[0], pid: 9999 }] } }, "target_process_changed"],
    [{ resolution: { ...resolutionFor(target), matches: [{ ...resolutionFor(target).matches[0], executable_path: path.join(fixture.dir, "wrong") }] } }, "target_path_mismatch"],
    [{ resolution: { ...resolutionFor(target), matches: [{ ...resolutionFor(target).matches[0], bundle_identifier: "com.other" }] } }, "target_bundle_mismatch"],
    [{ frontmost: undefined }, "frontmost_missing"],
    [{ frontmost: null }, "frontmost_missing"],
    [{ frontmost: {} }, "frontmost_invalid"],
    [{ frontmost: { pid: String(target.pid), bundle_identifier: target.bundle_identifier } }, "frontmost_invalid"],
    [{ frontmost: { pid: 1, bundle_identifier: target.bundle_identifier } }, "not_frontmost"],
    [{ frontmost: { pid: target.pid, bundle_identifier: "com.other" } }, "frontmost_bundle_mismatch"],
    [{ permissions: { ax_trusted: false, post_access: true } }, "ax_trust_required"],
    [{ permissions: { ax_trusted: true, post_access: false } }, "post_access_required"],
    [{ focus: { ...allowedFacts(target).focus, matches: false } }, "focus_mismatch"],
    [{ focus: { ...allowedFacts(target).focus, pid: 1 } }, "focus_owner_mismatch"],
    [{ focus: { ...allowedFacts(target).focus, role: "AXButton" } }, "focus_role_mismatch"],
    [{ focus: { ...allowedFacts(target).focus, path: "0/9" } }, "focus_path_mismatch"],
    [{ focus: { ...allowedFacts(target).focus, desc: "其它" } }, "focus_desc_mismatch"],
    [{ focus: { ...allowedFacts(target).focus, enabled: false } }, "composer_disabled"],
    [{ focus: { ...allowedFacts(target).focus, enabled: null, value_settable: null } }, "composer_state_unconfirmed"],
  ];
  for (const [patch, reason] of cases) {
    const facts = { ...allowedFacts(target), ...patch };
    assert.deepEqual(authorizeInput({ target, request, ...facts }), { allowed: false, reason }, reason);
  }
});

test("focus 操作不要求事前已聚焦；insert 仍要求实际预期焦点", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const facts = allowedFacts(target);
  const focusRequest = {
    gesture: "focus",
    pid: target.pid,
    generation: target.generation,
    focus_required: false,
    path: "0/1/2",
    expected_focus: { role: "AXTextField", path: "0/1/2", desc_contains: "输入" },
  };
  // 合法未聚焦 composer：focus 是“先聚焦”的操作，不能要求操作前 focus.matches=true。
  assert.deepEqual(authorizeInput({ target, request: focusRequest, ...facts, focus: null }), { allowed: true });
  assert.deepEqual(
    authorizeInput({ target, request: focusRequest, ...facts, focus: { ...facts.focus, matches: false } }),
    { allowed: true },
  );
  // insert 是真实输入，必须已有实际预期焦点。
  const insertRequest = { ...focusRequest, gesture: "insert", focus_required: true, text: "abc" };
  assert.deepEqual(authorizeInput({ target, request: insertRequest, ...facts, focus: null }), {
    allowed: false,
    reason: "focus_missing",
  });
  assert.deepEqual(
    authorizeInput({ target, request: insertRequest, ...facts, focus: { ...facts.focus, matches: false } }),
    { allowed: false, reason: "focus_mismatch" },
  );
});

test("authorizeInput 的目标路径比对按绝对路径而不是 basename", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const request = requestFor(target, { gesture: "click", focus_required: false });
  const facts = allowedFacts(target);
  facts.resolution = {
    ...facts.resolution,
    matches: [{ ...facts.resolution.matches[0], executable_path: path.join(fixture.dir, "AI Novel Studio.app/Contents/MacOS/app") }],
  };
  assert.deepEqual(authorizeInput({ target, request, ...facts }), { allowed: true });
  facts.resolution.matches[0].executable_path = path.join(fixture.dir, "copy", "AI Novel Studio.app/Contents/MacOS/app");
  assert.deepEqual(authorizeInput({ target, request, ...facts }), { allowed: false, reason: "target_path_mismatch" });
});

test("Escape 不要求 composer 焦点，但 delete/cmd+a 仍要求", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const facts = allowedFacts(target);
  const escape = { gesture: "key", pid: target.pid, generation: target.generation, key: "escape", focus_required: false };
  assert.deepEqual(authorizeInput({ target, request: escape, ...facts, focus: null }), { allowed: true });

  const deleteKey = { ...escape, key: "delete", focus_required: true, expected_focus: requestFor(target).expected_focus };
  assert.deepEqual(authorizeInput({ target, request: deleteKey, ...facts, focus: null }), { allowed: false, reason: "focus_missing" });
});

test("splitUtf16Chunks 按 UTF-16 单元分块且不拆代理对", () => {
  assert.deepEqual(splitUtf16Chunks("abcdefghijklmnopqrstuvwxyz", 16), ["abcdefghijklmnop", "qrstuvwxyz"]);
  assert.deepEqual(splitUtf16Chunks("😀😀😀😀😀😀😀😀😀", 16), ["😀😀😀😀😀😀😀😀", "😀"]);
  assert.deepEqual(splitUtf16Chunks("", 16), []);
});


test("buildTarget 拒绝缺 run_ref/bundle 与非法 native executable", () => {
  const fixture = fixtureReady();
  assert.throws(() => buildTarget({ ...fixture.ready, run_ref: "" }, fixture.dir), /run_ref_missing/);
  assert.throws(() => buildTarget({ ...fixture.ready, bundle_identifier: "" }, fixture.dir), /bundle_identifier_missing/);
  assert.throws(() => buildTarget({ ...fixture.ready, native_executable: "other" }, fixture.dir), /native_executable_invalid/);
  assert.throws(() => buildTarget({ ...fixture.ready, native_executable: "" }, fixture.dir), /native_executable_invalid/);
  assert.throws(() => buildTarget(null, fixture.dir), /ready_invalid/);
});

test("bindTarget 比对 bundle 身份，不只看 executable 路径", () => {
  const fixture = fixtureReady();
  const target = buildTarget(fixture.ready, fixture.dir);
  assert.throws(
    () => bindTarget(target, { matches: [{ pid: 1, executable_path: target.executable_path, bundle_identifier: "com.other" }], pid: 1 }),
    /target_bundle_mismatch/,
  );
});

test("composerExpectation 固定可编辑角色/路径/描述约束", () => {
  assert.deepEqual(composerExpectation({ path: "0/3", role: "AXTextField", desc: "输入" }), {
    role: "AXTextField",
    path: "0/3",
    desc_contains: "输入",
  });
  assert.throws(() => composerExpectation(null), /composer_missing/);
});

test("inputEvent 的 attempt 只投影 probe 观测与焦点事实，不写输入文本、不伪造 activation", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const event = inputEvent({
    target,
    event: "attempt",
    gesture: "insert",
    request: { text: "秘密输入", expected_focus: { role: "AXTextField", path: "0/1" } },
    facts: {
      frontmost: { pid: target.pid, bundle_identifier: target.bundle_identifier },
      permissions: { ax_trusted: true, post_access: true },
      focus: { pid: target.pid, role: "AXTextField", path: "0/1", desc: "输入", enabled: null, value_settable: true, matches: true },
    },
    result: { ok: null, delivered_chunks: null },
    at: "2026-11-02T00:00:00.000Z",
  });
  assert.equal(event.input_length, 4);
  assert.equal(event.activation, undefined);
  assert.equal(event.frontmost.pid, target.pid);
  assert.equal(event.focus.enabled, null);
  assert.equal(event.permissions.post_access, true);
  assert.equal(JSON.stringify(event).includes("秘密输入"), false);
});

test("inputEvent 的 result 使用 activate 操作返回的 activation/frontmost_after，不用 probe 事前快照冒充", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const probe = {
    frontmost: { pid: target.pid, bundle_identifier: target.bundle_identifier },
    permissions: { ax_trusted: true, post_access: true },
    // 旧 producer 的 probe 曾带一个 requested=false 的 activation；即使事实里出现也不能算操作结果。
    activation: { requested: false, returned: null, confirmed: true, waited_ms: 0 },
  };
  const actual = {
    requested: true,
    returned: true,
    confirmed: true,
    waited_ms: 50,
    frontmost_before: { pid: 1, bundle_identifier: "com.other" },
    frontmost_after: { pid: target.pid, bundle_identifier: target.bundle_identifier },
  };
  const event = inputEvent({
    target,
    event: "result",
    gesture: "activate",
    request: {},
    facts: probe,
    result: {
      ok: true,
      activation: actual,
      permissions: { ax_trusted: true, post_access: true },
      frontmost_after: { pid: target.pid, bundle_identifier: target.bundle_identifier },
    },
    at: "t",
  });
  assert.equal(event.activation.requested, true);
  assert.equal(event.activation.returned, true);
  assert.equal(event.activation.confirmed, true);
  assert.equal(event.activation.waited_ms, 50);
  assert.equal(event.frontmost.pid, target.pid);
  assert.equal(event.permissions.post_access, true);
});

test("inputEvent 对缺省 probe 观测输出可判定的 null 而不是假成功", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const event = inputEvent({ target, event: "rejected", gesture: "click", request: {}, facts: {}, result: { reason: "focus_mismatch" }, at: "t" });
  assert.equal(event.focus, null);
  assert.equal(event.activation, undefined);
  assert.equal(event.frontmost, null);
  assert.equal(event.result.ok, null);
  assert.equal(event.result.reason, "focus_mismatch");
});

test("splitUtf16Chunks 拒绝非字符串与过小分块", () => {
  assert.throws(() => splitUtf16Chunks(null), /text_must_be_string/);
  assert.throws(() => splitUtf16Chunks("abc", 1), /chunk_size_invalid/);
});


test("默认 native_executable 为 app，首次绑定/显式 relaunch 的 generation 正确", () => {
  const fixture = fixtureReady();
  const ready = { ...fixture.ready };
  delete ready.native_executable;
  const target = buildTarget(ready, fixture.dir);
  assert.equal(target.native_executable, "app");
  assert.equal(target.generation, 0);
  const bound = bindTarget(target, {
    matches: [{ pid: 5, executable_path: target.executable_path, bundle_identifier: target.bundle_identifier }],
    pid: 5,
  });
  assert.equal(bound.generation, 0);
  const relaunched = relaunchTarget(target, {
    matches: [{ pid: 6, executable_path: target.executable_path, bundle_identifier: target.bundle_identifier }],
    pid: 6,
  });
  assert.equal(relaunched.generation, 1);
});

test("授权对缺省 permissions/resolution/focus 事实失败关闭", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const request = requestFor(target);
  assert.deepEqual(authorizeInput({ target, request, ...allowedFacts(target), permissions: undefined }), { allowed: false, reason: "ax_trust_required" });
  assert.deepEqual(authorizeInput({ target, request, ...allowedFacts(target), resolution: undefined }), { allowed: false, reason: "target_not_running" });
  const facts = allowedFacts(target);
  assert.deepEqual(
    authorizeInput({ target, request, ...facts, focus: { ...facts.focus, desc: undefined } }),
    { allowed: false, reason: "focus_desc_mismatch" },
  );
  assert.deepEqual(
    authorizeInput({ target, request, ...facts, resolution: { matches: [{ ...facts.resolution.matches[0], executable_path: "" }], pid: target.pid } }),
    { allowed: false, reason: "target_path_mismatch" },
  );
});

test("enabled=true 足以确认控件可用，即使 value_settable 未知", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const request = requestFor(target);
  const facts = allowedFacts(target);
  assert.deepEqual(
    authorizeInput({ target, request, ...facts, focus: { ...facts.focus, enabled: true, value_settable: null } }),
    { allowed: true },
  );
  assert.deepEqual(
    authorizeInput({ target, request, ...facts, focus: { ...facts.focus, enabled: false, value_settable: true } }),
    { allowed: false, reason: "composer_disabled" },
  );
});

test("inputEvent 对空 result/probe 事实输出明确默认值", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const event = inputEvent({ target, event: "result", gesture: "click", request: {}, facts: { focus: {}, permissions: null }, result: {}, at: "t" });
  assert.equal(event.activation, undefined);
  assert.equal(event.frontmost, null);
  assert.equal(event.focus, null);
  assert.equal(event.permissions, null);
  assert.equal(event.result.ok, null);
  assert.equal(event.result.delivered_chunks, null);
});

test("inputEvent 保留 false/0 等真实值，不被默认值吞掉", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const event = inputEvent({
    target,
    event: "result",
    gesture: "insert",
    request: { text: "", expected_focus: null },
    facts: {
      frontmost: { pid: target.pid, bundle_identifier: target.bundle_identifier },
      permissions: { ax_trusted: true, post_access: true },
      focus: null,
    },
    result: {
      ok: false,
      activation: { requested: false, returned: false, confirmed: false, waited_ms: 0, frontmost_before: null, frontmost_after: null },
      permissions: { ax_trusted: true, post_access: true },
      frontmost_after: null,
      focus: { pid: target.pid, role: "AXTextField", path: "0/1", desc: "输入", enabled: false, value_settable: false, matches: false },
      delivered_chunks: 0,
      input_length: 0,
      method: null,
      reason: null,
    },
    at: "t",
  });
  assert.equal(event.input_length, 0);
  assert.equal(event.activation.returned, false);
  assert.equal(event.activation.confirmed, false);
  assert.equal(event.activation.waited_ms, 0);
  assert.equal(event.frontmost, null);
  assert.equal(event.focus.enabled, false);
  assert.equal(event.focus.value_settable, false);
  assert.equal(event.focus.matches, false);
  assert.equal(event.result.ok, false);
  assert.equal(event.result.delivered_chunks, 0);
  assert.equal(event.result.input_length, 0);
});

test("splitUtf16Chunks 在 16 单元边界与代理对边界不拆字", () => {
  assert.deepEqual(splitUtf16Chunks("a".repeat(16), 16), ["a".repeat(16)]);
  assert.deepEqual(splitUtf16Chunks(`${"a".repeat(15)}😀`, 16), ["a".repeat(15), "😀"]);
  assert.deepEqual(splitUtf16Chunks("😀".repeat(8), 16), ["😀".repeat(8)]);
  assert.deepEqual(splitUtf16Chunks(`${"😀".repeat(8)}a`, 16), ["😀".repeat(8), "a"]);
  assert.deepEqual(splitUtf16Chunks("ab", 2), ["ab"]);
  assert.deepEqual(splitUtf16Chunks("abc", 2), ["ab", "c"]);
});

test("bindTarget 首次绑定/同 PID 幂等/不同 PID 必须显式 relaunch", () => {
  const fixture = fixtureReady();
  const target = buildTarget(fixture.ready, fixture.dir);
  const bound = bindTarget(target, resolutionFor({ ...target, pid: 101 }));
  assert.equal(bound.pid, 101);
  assert.equal(bound.generation, 0);

  const idempotent = bindTarget(bound, resolutionFor(bound));
  assert.equal(idempotent, bound);
  assert.equal(idempotent.generation, 0);

  assert.throws(() => bindTarget(bound, resolutionFor({ ...target, pid: 202 })), /target_already_bound/);
  const relaunched = relaunchTarget(bound, resolutionFor({ ...target, pid: 202 }));
  assert.equal(relaunched.pid, 202);
  assert.equal(relaunched.generation, 1);

  const oldRequest = { ...requestFor(bound), generation: bound.generation };
  assert.deepEqual(
    authorizeInput({ target: relaunched, request: oldRequest, ...allowedFacts(relaunched) }),
    { allowed: false, reason: "generation_mismatch" },
  );
});

test("PID 必须是 pid_t 范围内的正整数", () => {
  const fixture = fixtureReady();
  const target = buildTarget(fixture.ready, fixture.dir);
  for (const pid of [0, -1, 1.5, 2147483648, "4242", null, undefined]) {
    assert.throws(
      () => bindTarget(target, { matches: [{ pid, executable_path: target.executable_path }] }),
      /target_pid_invalid/,
      String(pid),
    );
  }
  const max = bindTarget(target, resolutionFor({ ...target, pid: 2147483647 }));
  assert.equal(max.pid, 2147483647);
  assert.throws(
    () => bindTarget({ ...target, pid: -1 }, resolutionFor({ ...target, pid: 7 })),
    /target_pid_invalid/,
  );
  assert.deepEqual(
    authorizeInput({
      target: { ...target, pid: 1.5 },
      request: requestFor({ ...target, pid: 1.5 }),
      ...allowedFacts({ ...target, pid: 1.5 }),
    }),
    { allowed: false, reason: "target_pid_invalid" },
  );
  const bound = bindTarget(target, resolutionFor({ ...target, pid: 7 }));
  for (const generation of [-1, 1.5]) {
    assert.throws(
      () => bindTarget({ ...target, generation }, resolutionFor({ ...target, pid: 7 })),
      /target_generation_invalid/,
    );
    assert.throws(
      () => bindTarget({ ...bound, generation }, resolutionFor(bound)),
      /target_generation_invalid/,
    );
    assert.throws(
      () => relaunchTarget({ ...bound, generation }, resolutionFor(bound)),
      /target_generation_invalid/,
    );
  }
  for (const executablePath of [null, undefined, 7, { toString: () => target.executable_path }]) {
    assert.throws(
      () => bindTarget(target, { matches: [{ pid: 7, executable_path: executablePath }] }),
      /target_path_mismatch/,
    );
  }
});

test("authorizeInput 只认显式 true；enabled=null + value_settable=false 不是等价分支", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const request = requestFor(target);
  const base = allowedFacts(target);
  assert.deepEqual(
    authorizeInput({ target, request, ...base, focus: { ...base.focus, enabled: null, value_settable: true } }),
    { allowed: true },
  );
  assert.deepEqual(
    authorizeInput({ target, request, ...base, focus: { ...base.focus, enabled: null, value_settable: false } }),
    { allowed: false, reason: "composer_state_unconfirmed" },
  );
  for (const permissions of [
    { ax_trusted: "false", post_access: true },
    { ax_trusted: 1, post_access: true },
    { ax_trusted: true, post_access: "false" },
    { ax_trusted: true, post_access: 1 },
  ]) {
    assert.equal(authorizeInput({ target, request, ...base, permissions }).allowed, false);
  }
  for (const frontmost of ["frontmost", 1, "target", {}]) {
    assert.equal(authorizeInput({ target, request, ...base, frontmost }).allowed, false);
  }
  assert.deepEqual(
    authorizeInput({ target, request, ...base, frontmost: { pid: target.pid, bundle_identifier: "com.other" } }),
    { allowed: false, reason: "frontmost_bundle_mismatch" },
  );
});

test("inputEvent 的 operation 缺省 activation/focus 字段回退为 false/null，不伪造 true", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const event = inputEvent({
    target,
    event: "result",
    gesture: "activate",
    request: {},
    facts: {},
    result: { ok: true, activation: {} },
    at: "t",
  });
  assert.equal(event.activation.requested, false);
  assert.equal(event.activation.returned, null);
  assert.equal(event.activation.confirmed, false);
  assert.equal(event.activation.waited_ms, null);

  const attempt = inputEvent({
    target,
    event: "attempt",
    gesture: "insert",
    request: {},
    facts: { frontmost: { pid: target.pid, bundle_identifier: target.bundle_identifier }, focus: {} },
    result: {},
    at: "t",
  });
  assert.equal(attempt.focus.matches, false);
  assert.equal(attempt.focus.enabled, null);
  assert.equal(attempt.focus.value_settable, null);
  assert.equal(attempt.focus.expected, null);
});

test("probeObservation 对 null/非对象输入原样返回，不抛错也不伪造观测", () => {
  assert.equal(probeObservation(null), null);
  assert.equal(probeObservation(undefined), undefined);
  assert.equal(probeObservation("raw"), "raw");
});

test("旧 activation.frontmost_pid 不构成前台回退；缺失 frontmost 必须拒绝", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const request = requestFor(target);
  const facts = allowedFacts(target);
  assert.deepEqual(
    authorizeInput({
      target,
      request,
      ...facts,
      frontmost: undefined,
      activation: { requested: false, returned: null, confirmed: true, frontmost_pid: target.pid },
    }),
    { allowed: false, reason: "frontmost_missing" },
  );
});

test("probeObservation 只接受观测字段，丢弃旧 producer 的 activation；operationResultFacts 只取操作 after", () => {
  const fixture = fixtureReady();
  const target = targetFor(fixture);
  const rawProbe = {
    ok: true,
    target,
    resolution: resolutionFor(target),
    permissions: { ax_trusted: true, post_access: true },
    frontmost: { pid: target.pid, bundle_identifier: target.bundle_identifier },
    activation: { requested: false, returned: null, confirmed: true },
    focus: { pid: target.pid, role: "AXWebArea", matches: false },
  };
  const observed = probeObservation(rawProbe);
  assert.equal(observed.activation, undefined);
  assert.deepEqual(observed.frontmost, rawProbe.frontmost);
  assert.deepEqual(observed.focus, rawProbe.focus);
  assert.equal(probeObservation({ ok: false, reason: "target_not_running" }).reason, "target_not_running");

  const actual = { requested: true, returned: true, confirmed: true, waited_ms: 50 };
  const result = operationResultFacts({
    activation: actual,
    permissions: { ax_trusted: true, post_access: true },
    frontmost_after: { pid: target.pid, bundle_identifier: target.bundle_identifier },
    focus: { pid: target.pid, role: "AXTextField", matches: true },
  });
  assert.deepEqual(result.activation, actual);
  assert.deepEqual(result.frontmost, { pid: target.pid, bundle_identifier: target.bundle_identifier });
  assert.equal(result.focus.role, "AXTextField");
  assert.equal(result.permissions.post_access, true);
  assert.deepEqual(operationResultFacts(null), {});
});
