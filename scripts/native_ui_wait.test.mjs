import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativeLifecycleSeen, WaitLedger, supervise, budgetsFor } from "./native_ui_wait.mjs";

test("真实模型沿既有实测360秒turn预算，仍在截止时失败", () => {
  const ledger = new WaitLedger(0, budgetsFor("strata"));
  ledger.accept({ op: "begin", id: "real-turn", kind: "turn", label: "真实模型判断与生成", at: 1 });
  ledger.check(120_001);
  assert.throws(() => ledger.check(360_001), /turn_timeout/);
  assert.equal(budgetsFor("slice_verify").turn, 120_000);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-wait-"));
  try {
    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({ ready_at: new Date().toISOString() }));
    await assert.rejects(supervise(dir, "http://127.0.0.1:1", [2147483647]), /owned_process_exited/);
    assert.match(JSON.parse(fs.readFileSync(path.join(dir, "failure.json"))).reason, /owned_process_exited/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test("外部驱动失败立即结束，原始失败原因不被后续超时覆盖", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-wait-"));
  try {
    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), JSON.stringify({ ready_at: new Date().toISOString() }));
    const original = JSON.stringify({ reason: "wrong_seed_shape", trial: "T5" });
    fs.writeFileSync(path.join(dir, "failure.json"), original);
    await assert.rejects(supervise(dir, "http://127.0.0.1:1", [process.pid]), /external_driver_failed/);
    assert.equal(fs.readFileSync(path.join(dir, "failure.json"), "utf8"), original);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test("独立原生窗口仅在首次启动和显式恢复期间可暂时缺席", () => {
  assert.equal(nativeLifecycleSeen(false, 0, "maintenance"), false);
  assert.equal(nativeLifecycleSeen(false, 1, "maintenance"), true);
  assert.equal(nativeLifecycleSeen(true, 0, "restore"), true);
  assert.throws(() => nativeLifecycleSeen(true, 0, "turn"), /owned_native_window_process_exited/);
});
