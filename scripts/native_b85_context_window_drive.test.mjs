import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validatePhaseInput, readPreferencesEvidence, readRuntimeEvidence,
  assertBoundTarget, assertPhaseEvidence, runB85Phase, validateObservationScope, visibleFactsMatch, assertSelectedProvider, openDialog, assertWriteBaseline,
} from "./native_b85_context_window_drive.mjs";

const input = { phase: "save", case_id: "a-save", provider: "splash", provider_label: "本地模型", window: 64000,
  expected_current: 32000, expected_source: "conservative_default", expected_saved: 64000,
  preferences_path: "/tmp/b85/preferences.json" };

test("close phase needs no settings fields and requests only bound AX close, never signs exit", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "b85-close-")));
  const dir = path.join(root, "generation-1"); fs.mkdirSync(dir);
  const actions = [];
  const h = { dir, ready: { app_pid: 41 }, target: { pid: null }, APP: null,
    waitTargetResolution: async () => ({ matches: [{ pid: 41 }] }),
    bindBatchTarget() { this.target = { pid: 41 }; this.APP = this.target; },
    ensureInput: () => ({ activate: () => actions.push("activate"), click: (p) => {
      actions.push(p); return { ok: true }; } }),
    dumpNodes: () => [{ role: "AXButton", subrole: "AXCloseButton", path: "window.close" }],
    io: { screenshot: () => {} } };
  try {
    const result = await runB85Phase(h, { phase: "close", case_id: "close" }, "close", { artifactRoot: root });
    assert.equal(result.status, "close_requested");
    assert.equal(result.normal_exit_verified, false);
    assert.deepEqual(actions, ["activate", "window.close"]);
    await assert.rejects(runB85Phase(h, { phase: "close", case_id: "close" }, "close", { artifactRoot: root }), /EEXIST/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("owner PID mismatch produces failed receipt with zero input", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "b85-pid-")));
  const dir = path.join(root, "generation-1"); fs.mkdirSync(dir);
  let inputs = 0;
  const h = { dir, ready: { app_pid: 41 }, target: { pid: null },
    waitTargetResolution: async () => ({ matches: [{ pid: 42 }] }),
    bindBatchTarget: () => { inputs++; }, ensureInput: () => { inputs++; } };
  try {
    const result = await runB85Phase(h, { phase: "close", case_id: "wrong" }, "close", { artifactRoot: root });
    assert.equal(result.status, "failed");
    assert.equal(result.error, "owner_pid_mismatch");
    assert.equal(inputs, 0);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("unrelated preferences or provider configuration mutation cannot pass save", () => {
  const after = { preferences: { state: "observed", saved: 64000, sha256: "new", unrelated_sha256: "changed" },
    runtime: { state: "observed", configuration_sha256: "config", context_window: { effective_tokens: 32000, source: "conservative_default" } }, text: "" };
  assert.throws(() => assertPhaseEvidence(input, { preferences: { unrelated_sha256: "old" }, runtime: { configuration_sha256: "config" } }, after),
    /unrelated_preferences_changed/);
  assert.throws(() => assertPhaseEvidence(input, { preferences: { unrelated_sha256: "changed" }, runtime: { configuration_sha256: "old" } },
    { ...after, runtime: { ...after.runtime, configuration_sha256: "changed" } }), /provider_configuration_changed/);
});
test("known runtime evidence waits out initial unknown and provider selection must match", () => {
  const runtime = { state: "observed", context_window: { effective_tokens: 32000, source: "conservative_default" } };
  const prefs = { state: "observed", saved: null };
  assert.equal(visibleFactsMatch("当前生效：暂时无法读取\n已保存覆盖：未设置", runtime, prefs), false);
  assert.equal(visibleFactsMatch("当前生效：32,000 tokens\n来源：保守默认\n已保存覆盖：未设置", runtime, prefs), true);
  assertSelectedProvider([{ role: "AXPopUpButton", desc: "供应商", value: "本地模型" }], "splash", "本地模型");
  assert.throws(() => assertSelectedProvider([{ role: "AXPopUpButton", desc: "供应商", value: "openai" }], "splash", "本地模型"),
    /provider_selection_mismatch/);
});
test("required baseline protection is checked before any edit, with explicit fault exception", () => {
  assert.throws(() => assertWriteBaseline(input, { preferences: {} }), /protection_evidence_missing/);
  assert.throws(() => assertWriteBaseline(input, { preferences: {}, runtime: { configuration_sha256: "config" } }),
    /protection_evidence_missing/);
  assertWriteBaseline({ ...input, phase: "save-failure" },
    { preferences: { sha256: "original-broken-bytes" }, runtime: { configuration_sha256: "config" } });
  assert.throws(() => assertWriteBaseline({ ...input, phase: "save-failure" },
    { preferences: { sha256: null }, runtime: { configuration_sha256: "config" } }), /protection_evidence_missing/);
});
test("fault phases reopen existing dialog through visible cancel and trigger", async () => {
  let opened = true; const actions = [];
  const field = { role: "AXTextField", desc: "应用覆盖（留空使用启动配置）", enabled: true };
  const nodes = () => opened ? [field, { role: "AXButton", title: "取消" }] :
    [{ role: "AXButton", title: "当前模型：local" }];
  const h = { dumpNodes: nodes, safeClick(node) { actions.push(node.title); opened = node.title !== "取消"; },
    async pollAx(predicate) { assert.equal(predicate("", nodes()), true); return { nodes: nodes() }; } };
  await openDialog(h, true);
  assert.deepEqual(actions, ["取消", "当前模型：local"]);
});
test("runtime unavailable requires actual editable draft and leaves preferences unchanged", () => {
  const fault = { ...input, phase: "runtime-unavailable", expected_current: null, expected_source: null, expected_saved: null };
  const preferences = { state: "observed", saved: null, sha256: "same", unrelated_sha256: "same" };
  const before = { preferences };
  const after = { preferences, runtime: { state: "unknown", context_window: null }, editable: true,
    draft: "64000", text: "当前生效：暂时无法读取\n已保存覆盖：未设置" };
  assertPhaseEvidence(fault, before, after);
  assert.throws(() => assertPhaseEvidence(fault, before, { ...after, editable: false }), /runtime_edit_not_observed/);
});
test("phase metadata cannot grant real-user or symlinked preference access", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "b85-scope-")));
  const dir = path.join(root, "generation-1"), home = path.join(root, "home");
  fs.mkdirSync(dir); fs.mkdirSync(home);
  try {
    const ready = { web_url: "http://127.0.0.1:4658" };
    validateObservationScope(dir, { ...input, preferences_path: path.join(home, "preferences.json") }, ready, root);
    assert.throws(() => validateObservationScope(dir, input, ready, root), /preferences_scope_invalid/);
    fs.symlinkSync(os.homedir(), path.join(home, "escape"));
    assert.throws(() => validateObservationScope(dir, { ...input,
      preferences_path: path.join(home, "escape", "preferences.json") }, ready, root), /preferences_scope_invalid/);
    assert.throws(() => validateObservationScope(dir, { ...input,
      preferences_path: path.join(home, "preferences.json") },
      { web_url: "http://127.0.0.1:4658/?secret=x" }, root), /endpoint_invalid/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("unknown phase and absent frozen expectations are rejected before input", () => {
  assert.throws(() => validatePhaseInput(input, "erase"), /phase_invalid/);
  assert.throws(() => validatePhaseInput(input, "cancel"), /phase_mismatch/);
  const missing = { ...input }; delete missing.expected_saved;
  assert.throws(() => validatePhaseInput(missing, "save"), /expectation_missing/);
  assert.throws(() => validatePhaseInput({ ...input, case_id: "../escape" }, "save"), /case_id_invalid/);
});
test("unbound and different owner PID cannot authorize UI actions", () => {
  assert.throws(() => assertBoundTarget({ pid: null }, { app_pid: 41 }), /target_unbound/);
  assert.throws(() => assertBoundTarget({ pid: 42 }, { app_pid: 41 }), /owner_pid_mismatch/);
  assertBoundTarget({ pid: 41 }, { app_pid: 41 });
});
test("preferences unknown is not confirmed absent and captures no secret fields", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b85-"));
  try {
    const file = path.join(dir, "preferences.json");
    assert.equal(readPreferencesEvidence(file, "splash").state, "absent");
    fs.writeFileSync(file, '{"context_windows":{"splash":64000},"model_provider":{"key":"private"}}');
    const valid = readPreferencesEvidence(file, "splash");
    assert.deepEqual(valid.saved, 64000);
    assert.equal(JSON.stringify(valid).includes("private"), false);
    fs.writeFileSync(file, "{broken");
    const invalid = readPreferencesEvidence(file, "splash");
    assert.equal(invalid.state, "unknown");
    assert.equal(typeof invalid.sha256, "string");
    fs.writeFileSync(file, '{"context_windows":{"splash":null}}');
    assert.equal(readPreferencesEvidence(file, "splash").state, "unknown");
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test("runtime read failure is unknown, never derived from expected or saved", async () => {
  const ready = { web_url: "http://127.0.0.1:4658" };
  const evidence = await readRuntimeEvidence(ready, "splash", async () => { throw Error("secret"); });
  assert.equal(evidence.state, "unknown");
  assert.equal(evidence.context_window, null);
  assert.equal(JSON.stringify(evidence).includes("secret"), false);
  await assert.rejects(readRuntimeEvidence({ web_url: "https://external.test" }, "splash"), /endpoint_invalid/);
});
test("runtime evidence whitelists existing API facts without inventing defaults", async () => {
  const e = await readRuntimeEvidence({ web_url: "http://127.0.0.1:4658" }, "splash",
    async (url, options) => {
      assert.equal(url, "http://127.0.0.1:4658/api/provider/options");
      assert.equal(options.method, "GET");
      return { ok: true, json: async () => ({ current_provider: "splash", providers: [
        { id: "splash", label: "本地模型", api_key: "private", context_window: {
          effective_tokens: 32000, default_tokens: 32000, source: "conservative_default" } }] }) };
    });
  assert.equal(e.state, "observed");
  assert.equal(e.provider_label, "本地模型");
  assert.equal(JSON.stringify(e).includes("private"), false);
});
test("save needs visible and independent runtime/saved facts; close cannot claim normal exit", () => {
  const before = { preferences: { sha256: "old", unrelated_sha256: "same" }, runtime: { configuration_sha256: "config" } };
  const after = { preferences: { state: "observed", saved: 64000, sha256: "new", unrelated_sha256: "same" },
    runtime: { state: "observed", configuration_sha256: "config", context_window: {
      effective_tokens: 32000, source: "conservative_default" } },
    text: "当前生效：32,000 tokens\n来源：保守默认（32,000 tokens）\n已保存覆盖：64,000\n已保存，桌面应用下次启动时读取。" };
  assertPhaseEvidence(input, before, after);
  assert.throws(() => assertPhaseEvidence(input, { ...before, runtime: {} }, after), /protection_evidence_missing/);
  assert.throws(() => assertPhaseEvidence(input, before, { ...after,
    runtime: { state: "unknown", configuration_sha256: "config", context_window: null } }), /runtime_expectation/);
  assert.throws(() => assertPhaseEvidence({ ...input, phase: "cancel" }, before, after), /preferences_changed/);
  assert.throws(() => assertPhaseEvidence(input, before, { ...after, text: "" }), /visible_/);
});
