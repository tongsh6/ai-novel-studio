// 编译真实 ax_cua_core.swift + 注入 clock/observer/advance 的 Swift 行为测试；
// 只跑纯函数，不启动 App、不读取真实 AX、不发送任何 CGEvent。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  authorizeInput,
  inputEvent,
  operationResultFacts,
  probeObservation,
} from "./input_target.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.join(DIR, "ax_cua_core.swift");
const TEST = path.join(DIR, "ax_cua_behavior_test.swift");
const OUT_DIR = path.resolve(DIR, "../../../artifacts/tools");
const CACHE = path.join(OUT_DIR, "clang-module-cache");

function swiftcAvailable() {
  try {
    execFileSync("swiftc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function contractFromSwift(bin) {
  return JSON.parse(execFileSync(bin, ["--emit-contract"], { encoding: "utf8", stdio: "pipe" }));
}

function targetForContract(probe) {
  return {
    schema: "native-input-target/v1",
    artifact_dir: "/tmp",
    run_ref: probe.target.run_ref,
    bundle_identifier: probe.target.bundle_identifier,
    app_path: probe.target.app_path,
    executable_path: probe.target.executable_path,
    native_executable: "app",
    pid: probe.target.pid,
    generation: probe.target.generation,
  };
}

test("ax_cua 激活等待与投递 seam 纯行为", { skip: process.platform !== "darwin" || !swiftcAvailable() }, () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });
  const bin = path.join(OUT_DIR, "ax_cua_behavior_test");
  try {
    execFileSync(
      "swiftc",
      ["-parse-as-library", CORE, TEST, "-o", bin],
      { encoding: "utf8", stdio: "pipe", env: { ...process.env, CLANG_MODULE_CACHE_PATH: CACHE } },
    );
    const output = execFileSync(bin, [], { encoding: "utf8", stdio: "pipe" });
    assert.match(output, /ok ax_cua activation\/delivery seams/);

    // 直接消费真实 Swift producer 的 JSON：probe 只给观测，activation 结果来自 input 操作。
    const contract = contractFromSwift(bin);
    const probe = probeObservation(contract.probe);
    const target = targetForContract(contract.probe);
    assert.equal(probe.activation, undefined);
    assert.equal(probe.frontmost.pid, target.pid);
    assert.equal(probe.permissions.ax_trusted, true);

    const focusRequest = {
      gesture: "focus",
      pid: target.pid,
      generation: target.generation,
      focus_required: false,
      path: "0/0/0/0/0/12",
      expected_focus: { role: "AXTextField", path: "0/0/0/0/0/12", desc_contains: "输入" },
    };
    assert.deepEqual(
      authorizeInput({
        target,
        request: focusRequest,
        resolution: probe.resolution,
        permissions: probe.permissions,
        frontmost: probe.frontmost,
        focus: probe.focus,
      }),
      { allowed: true },
    );

    // 合法前台 + unfocused composer 的 focus 可授权；insert 仍要求实际预期焦点。
    const insertRequest = { ...focusRequest, gesture: "insert", focus_required: true, text: "abc" };
    assert.deepEqual(
      authorizeInput({
        target,
        request: insertRequest,
        resolution: probe.resolution,
        permissions: probe.permissions,
        frontmost: probe.frontmost,
        focus: probe.focus,
      }),
      { allowed: false, reason: "focus_mismatch" },
    );
    assert.deepEqual(
      authorizeInput({
        target,
        request: focusRequest,
        resolution: probe.resolution,
        permissions: probe.permissions,
        frontmost: { ...probe.frontmost, pid: 1 },
        focus: probe.focus,
      }),
      { allowed: false, reason: "not_frontmost" },
    );
    assert.deepEqual(
      authorizeInput({
        target,
        request: focusRequest,
        resolution: probe.resolution,
        permissions: probe.permissions,
        frontmost: undefined,
        focus: probe.focus,
      }),
      { allowed: false, reason: "frontmost_missing" },
    );

    const operation = operationResultFacts(contract.activation_result);
    assert.equal(operation.activation.requested, true);
    const event = inputEvent({
      target,
      event: "result",
      gesture: "activate",
      request: { gesture: "activate" },
      facts: probe,
      result: contract.activation_result,
      at: "t",
    });
    assert.equal(event.activation.requested, true);
    assert.equal(event.activation.returned, true);
    assert.equal(event.activation.confirmed, true);
    assert.equal(event.activation.waited_ms, 50);
    assert.equal(event.frontmost.pid, target.pid);
    assert.equal(event.permissions.post_access, true);

    assert.equal(contract.startup.is_finished_launching, false);
    assert.equal(contract.startup.launch_date, "2023-11-14T22:13:20Z");
    assert.equal(contract.startup.activation_policy, "regular");
    assert.equal(contract.startup.is_hidden, false);
    assert.equal(contract.startup.is_active, false);
  } finally {
    fs.rmSync(bin, { force: true });
  }
});
