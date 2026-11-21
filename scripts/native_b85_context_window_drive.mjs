// B85 external UI phases. The release lifecycle owner alone starts/stops processes.
// Design: tasks/slices/B85-model-context-window-settings.md §6.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { NativeScenarioHarness, evidenceText } from "./lib/native_ui/scenario_driver.mjs";

const PHASES = new Set(["snapshot", "save", "cancel", "clear", "invalid", "repeat",
  "save-failure", "runtime-unavailable", "close"]);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const check = (ok, reason) => { if (!ok) throw new Error(reason); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const now = () => new Date().toISOString();
const label = (node) => [node?.title, node?.desc, node?.value].filter(Boolean).join(" ");
const INPUT_LABEL = "应用覆盖（留空使用启动配置）";
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const knownSaved = (n) => n === null || (positive(n) && n <= 4294967295);
const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, ordered(value[k])])) : value;
const objectHash = (value) => hash(JSON.stringify(ordered(value)));

export function validatePhaseInput(input, phase) {
  check(PHASES.has(phase), "phase_invalid");
  check(input?.phase === phase, "phase_mismatch");
  check(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.case_id ?? ""), "case_id_invalid");
  if (phase === "close") return input;
  check(typeof input.provider === "string" && /^[a-z0-9_]+$/.test(input.provider), "provider_invalid");
  check(typeof input.provider_label === "string" && input.provider_label.trim() !== "", "provider_label_missing");
  check(path.isAbsolute(input.preferences_path ?? ""), "preferences_path_invalid");
  if (!["snapshot", "close"].includes(phase)) {
    check(["expected_current", "expected_source", "expected_saved"].every((k) => own(input, k)), "expectation_missing");
  }
  if (own(input, "expected_current")) check(input.expected_current === null || positive(input.expected_current), "current_invalid");
  if (own(input, "expected_source")) check([null, "runtime_override", "conservative_default"].includes(input.expected_source), "source_invalid");
  if (own(input, "expected_saved")) check(input.expected_saved === "unknown" || knownSaved(input.expected_saved), "saved_invalid");
  if (["save", "cancel", "repeat", "save-failure", "runtime-unavailable"].includes(phase)) check(positive(input.window) && input.window <= 4294967295, "window_invalid");
  if (phase === "invalid") check(typeof input.window === "string", "invalid_fixture_required");
  return input;
}

const ARTIFACT_ROOT = fileURLToPath(new URL("../artifacts", import.meta.url));
function resolvedIncludingMissing(file) {
  let parent = path.resolve(file);
  const tail = [];
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    check(next !== parent, "path_unresolvable");
    tail.unshift(path.basename(parent)); parent = next;
  }
  return path.join(fs.realpathSync(parent), ...tail);
}
export function validateObservationScope(dir, input, ready, artifactRoot = ARTIFACT_ROOT) {
  const actualDir = fs.realpathSync(dir);
  const root = fs.realpathSync(artifactRoot);
  check(actualDir.startsWith(root + path.sep) && actualDir === path.resolve(dir) &&
    /^generation-[0-9]+$/.test(path.basename(actualDir)), "artifact_scope_invalid");
  if (input.phase === "close") return;
  check(ready.web_url === "http://127.0.0.1:4658", "endpoint_invalid");
  const home = path.join(path.dirname(actualDir), "home");
  check(fs.realpathSync(home) === home, "home_scope_invalid");
  const candidate = resolvedIncludingMissing(input.preferences_path);
  check(candidate.startsWith(home + path.sep) && path.basename(candidate) === "preferences.json",
    "preferences_scope_invalid");
}

export function assertBoundTarget(target, ready) {
  check(Number.isInteger(target?.pid) && target.pid > 0, "target_unbound");
  check(Number.isInteger(ready?.app_pid) && target.pid === ready.app_pid, "owner_pid_mismatch");
}

export function readPreferencesEvidence(file, provider) {
  const evidence = { at: now(), state: "unknown", saved: null, sha256: null };
  try {
    const stat = fs.lstatSync(file);
    check(stat.isFile() && !stat.isSymbolicLink(), "preferences_not_regular");
    const bytes = fs.readFileSync(file);
    evidence.sha256 = hash(bytes);
    const document = JSON.parse(bytes.toString("utf8"));
    check(document && typeof document === "object" && !Array.isArray(document), "preferences_invalid");
    const windows = document.context_windows;
    const { context_windows: _windows, ...unrelated } = document;
    if (windows === undefined) {
      evidence.unrelated_sha256 = objectHash({ ...unrelated, context_windows: {} });
      return { ...evidence, state: "observed", saved: null };
    }
    check(windows && typeof windows === "object" && !Array.isArray(windows), "preferences_invalid");
    const { [provider]: _selected, ...otherWindows } = windows;
    evidence.unrelated_sha256 = objectHash({ ...unrelated, context_windows: otherWindows });
    if (!own(windows, provider)) return { ...evidence, state: "observed", saved: null };
    check(positive(windows[provider]) && windows[provider] <= 4294967295, "preferences_invalid");
    return { ...evidence, state: "observed", saved: windows[provider] };
  } catch (error) {
    if (error?.code === "ENOENT") return { ...evidence, state: "absent", saved: null, unrelated_sha256: objectHash({ context_windows: {} }) };
    return { ...evidence, error: "preferences_unreadable" };
  }
}

export async function readRuntimeEvidence(ready, provider, request = fetch) {
  const url = new URL(ready.web_url);
  check(ready.web_url === "http://127.0.0.1:4658" && url.pathname === "/", "endpoint_invalid");
  const result = { at: now(), state: "unknown", context_window: null };
  try {
    const response = await request(new URL("/api/provider/options", url).href,
      { method: "GET", signal: AbortSignal.timeout(3000), redirect: "error" });
    check(response.ok, "options_http_failed");
    const body = await response.json();
    const matches = body.providers?.filter((p) => p.id === provider);
    check(matches?.length === 1, "options_provider_missing");
    check(typeof matches[0].label === "string" && matches[0].label.trim() !== "" && body.providers.filter((p) => p.label === matches[0].label).length === 1, "options_provider_label_ambiguous");
    result.provider_label = matches[0].label;
    const value = matches[0].context_window;
    result.configuration_sha256 = objectHash({ current_provider: body.current_provider, providers: body.providers.map(({ context_window: _window, ...other }) => other) });
    if (value === null) return { ...result, current_provider: body.current_provider };
    check(value && positive(value.effective_tokens) && positive(value.default_tokens) &&
      ["runtime_override", "conservative_default"].includes(value.source), "options_window_unknown");
    return { ...result, state: "observed", current_provider: body.current_provider,
      context_window: { effective_tokens: value.effective_tokens, default_tokens: value.default_tokens, source: value.source } };
  } catch { return { ...result, error: "runtime_unreadable" }; }
}

export function visibleFactsMatch(text, runtime, preferences) {
  const current = runtime.state === "observed"
    ? "当前生效：" + runtime.context_window.effective_tokens.toLocaleString("en-US") + " tokens"
    : "当前生效：暂时无法读取";
  const saved = preferences.state === "unknown" ? "暂时无法读取" :
    preferences.saved === null ? "未设置" : preferences.saved.toLocaleString("en-US");
  const source = runtime.state !== "observed" ? true : text.includes(
    runtime.context_window.source === "runtime_override" ? "来源：运行配置覆盖" : "来源：保守默认");
  return text.includes(current) && text.includes("已保存覆盖：" + saved) && source;
}
export function assertSelectedProvider(nodes, provider, providerLabel) {
  const selection = uniqueNode(nodes, (n) =>
    ["AXPopUpButton", "AXComboBox"].includes(n.role) &&
    [n.title, n.desc].includes("供应商"), "provider_selection_missing");
  check(typeof providerLabel === "string" && providerLabel.trim() !== "", "provider_label_missing");
  check(selection.value === providerLabel || selection.value === provider, "provider_selection_mismatch");
}

export function assertWriteBaseline(input, evidence) {
  if (["save", "cancel", "clear", "invalid", "repeat", "save-failure"].includes(input.phase)) {
    check(evidence.runtime?.configuration_sha256, "protection_evidence_missing");
    check(input.phase === "save-failure" ? evidence.preferences.sha256 :
      evidence.preferences.unrelated_sha256, "protection_evidence_missing");
  }
  if (input.phase === "runtime-unavailable")
    check(evidence.preferences.unrelated_sha256, "protection_evidence_missing");
}

export function assertPhaseEvidence(input, before, after) {
  const text = after.text;
  assertWriteBaseline(input, before);
  assertWriteBaseline(input, after);
  if (input.phase === "runtime-unavailable") {
    check(before.preferences.unrelated_sha256 && after.preferences.unrelated_sha256, "protection_evidence_missing");
    check(after.editable === true && after.draft === String(input.window), "runtime_edit_not_observed");
  }
  if (before.preferences.unrelated_sha256 && after.preferences.unrelated_sha256)
    check(before.preferences.unrelated_sha256 === after.preferences.unrelated_sha256, "unrelated_preferences_changed");
  if (before.runtime?.configuration_sha256 && after.runtime?.configuration_sha256)
    check(before.runtime.configuration_sha256 === after.runtime.configuration_sha256, "provider_configuration_changed");
  if (["save", "cancel", "clear", "invalid", "repeat", "save-failure"].includes(input.phase) && before.runtime?.state === "observed")
    check(JSON.stringify(before.runtime.context_window) === JSON.stringify(after.runtime.context_window), "runtime_changed_during_edit");
  if (own(input, "expected_current")) {
    if (input.expected_current === null) {
      check(after.runtime.state === "unknown", "runtime_expectation");
      check(text.includes("当前生效：暂时无法读取"), "visible_runtime_unknown");
    } else {
      check(after.runtime.state === "observed" &&
        after.runtime.context_window.effective_tokens === input.expected_current &&
        after.runtime.context_window.source === input.expected_source, "runtime_expectation");
      check(text.includes("当前生效：" + input.expected_current.toLocaleString("en-US") + " tokens"), "visible_runtime_value");
      check(text.includes(input.expected_source === "runtime_override" ? "来源：运行配置覆盖" : "来源：保守默认"), "visible_runtime_source");
    }
  }
  if (own(input, "expected_saved")) {
    if (input.expected_saved === "unknown") {
      check(after.preferences.state === "unknown", "saved_expectation");
      check(text.includes("已保存覆盖：暂时无法读取"), "visible_saved_unknown");
    } else {
      check(after.preferences.state !== "unknown" && after.preferences.saved === input.expected_saved, "saved_expectation");
      const expected = input.expected_saved === null ? "未设置" : input.expected_saved.toLocaleString("en-US");
      check(text.includes("已保存覆盖：" + expected), "visible_saved_value");
    }
  }
  if (["cancel", "invalid", "save-failure", "runtime-unavailable"].includes(input.phase)) {
    check(before.preferences.sha256 === after.preferences.sha256, "preferences_changed");
  }
  if (["save", "clear", "repeat"].includes(input.phase))
    check(text.includes("已保存，桌面应用下次启动时读取。"), "visible_save_unconfirmed");
  if (input.phase === "invalid") check(text.includes("请输入 1 到 4294967295 之间的整数"), "visible_invalid_missing");
  if (input.phase === "save-failure") check(text.includes("保存未确认，编辑内容已保留"), "visible_failure_missing");
}

function uniqueNode(nodes, predicate, reason) {
  const matches = nodes.filter(predicate);
  check(matches.length === 1, reason);
  return matches[0];
}
const field = (nodes) => uniqueNode(nodes, (n) =>
  ["AXTextField", "AXTextArea"].includes(n.role) && label(n).includes(INPUT_LABEL), "window_field_missing");
const button = (nodes, title) => uniqueNode(nodes, (n) =>
  n.role === "AXButton" && [n.title, n.desc, n.value].includes(title), "button_missing");
export async function openDialog(harness, forceReload = false) {
  let nodes = harness.dumpNodes();
  if (forceReload && nodes.some((n) => label(n).includes(INPUT_LABEL))) {
    harness.safeClick(button(nodes, "取消"), "reload_close_dialog");
    await harness.pollAx((_text, current) => !current.some((n) => label(n).includes(INPUT_LABEL)), 5000, "reload_dialog_closed");
    nodes = harness.dumpNodes();
  }
  if (!nodes.some((n) => label(n).includes(INPUT_LABEL))) {
    const trigger = uniqueNode(nodes, (n) => n.role === "AXButton" &&
      (label(n).includes("当前模型") || label(n) === "模型设置"), "settings_trigger_missing");
    harness.safeClick(trigger, "model_settings");
  }
  return (await harness.pollAx((_text, current) =>
    current.some((n) => ["AXTextField", "AXTextArea"].includes(n.role) &&
      label(n).includes(INPUT_LABEL) && n.enabled !== false), 15000, "context_settings")).nodes;
}
function enterValue(harness, nodes, value) {
  const node = field(nodes);
  const expected = { role: node.role, path: node.path };
  harness.ensureInput().focus(node.path, expected);
  harness.ensureInput().clear(expected);
  harness.ensureInput().type(String(value), expected);
}
function axWhitelist(nodes) {
  return nodes.filter((n) => {
    const text = label(n);
    return /当前生效：|来源：|已保存覆盖：|保存未确认|请输入 1 到|已保存，桌面应用/.test(text) ||
      text.includes(INPUT_LABEL) || ["AXPopUpButton", "AXComboBox"].includes(n.role) && [n.title, n.desc].includes("供应商") || n.subrole === "AXCloseButton" ||
      ["保存窗口", "保存中…", "清除应用覆盖", "取消"].includes(text);
  }).map((n) => ({ role: n.role, title: n.title, desc: n.desc, value: n.value, path: n.path, subrole: n.subrole, enabled: n.enabled }));
}
function saveJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}

export async function runB85Phase(harness, input, phase, io = {}) {
  validatePhaseInput(input, phase);
  validateObservationScope(harness.dir, input, harness.ready, io.artifactRoot);
  const stem = "b85-" + input.case_id;
  saveJson(harness.dir, stem + "-started.json", { phase, case_id: input.case_id, at: now() });
  const runtimeRead = io.runtimeRead ?? readRuntimeEvidence;
  const preferencesRead = io.preferencesRead ?? readPreferencesEvidence;
  const record = { phase, case_id: input.case_id, started_at: now(), status: "failed", observations: [] };
  async function capture(suffix) {
    validateObservationScope(harness.dir, input, harness.ready, io.artifactRoot);
    let nodes = harness.dumpNodes();
    const evidence = { started_at: now(), capture_mode: "ordered_non_atomic" };
    if (phase !== "close") {
      evidence.preferences = preferencesRead(input.preferences_path, input.provider);
      evidence.runtime = await runtimeRead(harness.ready, input.provider);
      if (suffix !== "failure") {
        try {
          nodes = (await harness.pollAx((text) =>
            visibleFactsMatch(text, evidence.runtime, evidence.preferences), 15000, "visible_read_consistency")).nodes;
          assertSelectedProvider(nodes, input.provider, input.provider_label);
          if (evidence.runtime.provider_label !== undefined)
            check(evidence.runtime.provider_label === input.provider_label, "provider_label_changed");
          const editor = field(nodes);
          evidence.editable = editor.enabled !== false;
          evidence.draft = String(editor.value ?? "");
        } catch {
          evidence.consistency_error = "visible_read_consistency_unverified";
          nodes = harness.dumpNodes();
        }
      }
    }
    evidence.nodes = axWhitelist(nodes);
    evidence.text = evidence.nodes.map(evidenceText).join("\n");
    // Window-only screenshot, no fallback to another app/full desktop.
    const screenshot = stem + "-" + suffix + ".jpg";
    try {
      harness.io.screenshot(harness.APP, path.join(harness.dir, screenshot));
      evidence.screenshot = screenshot;
    } catch { evidence.screenshot_error = "window_screenshot_unavailable"; }
    evidence.finished_at = now();
    record.observations.push(evidence);
    saveJson(harness.dir, stem + "-" + suffix + ".json", evidence);
    check(!evidence.screenshot_error, "window_screenshot_unavailable");
    check(!evidence.consistency_error, "visible_read_consistency_unverified");
    return evidence;
  }
  try {
    const resolution = await harness.waitTargetResolution(15000);
    const resolved = resolution.matches?.[0]?.pid;
    assertBoundTarget({ pid: resolved }, harness.ready);
    harness.bindBatchTarget(resolution);
    assertBoundTarget(harness.target, harness.ready);
    harness.ensureInput().activate();
    if (phase === "close") {
      await capture("before-close");
      const close = uniqueNode(harness.dumpNodes(), (n) =>
        n.role === "AXButton" && n.subrole === "AXCloseButton", "close_button_missing");
      record.close_request = harness.ensureInput().click(close.path);
      record.status = "close_requested";
      record.normal_exit_verified = false;
    } else {
      let nodes = await openDialog(harness, ["runtime-unavailable", "save-failure"].includes(phase));
      assertSelectedProvider(nodes, input.provider, input.provider_label);
      const before = await capture("before");
      assertWriteBaseline(input, before);
      check(before.runtime.current_provider === undefined || before.runtime.current_provider === input.provider, "current_provider_mismatch");
      if (["save", "cancel", "invalid", "repeat", "save-failure", "runtime-unavailable"].includes(phase)) {
        nodes = harness.dumpNodes();
        assertSelectedProvider(nodes, input.provider, input.provider_label);
        enterValue(harness, nodes, input.window);
      }
      if (phase === "cancel") {
        harness.safeClick(button(harness.dumpNodes(), "取消"), "cancel_edit");
        await harness.pollAx((_text, current) => !current.some((n) => label(n).includes(INPUT_LABEL)), 5000, "dialog_closed");
        nodes = await openDialog(harness);
      } else if (phase === "clear") {
        harness.safeClick(button(harness.dumpNodes(), "清除应用覆盖"), "clear_window");
      } else if (["save", "invalid", "repeat", "save-failure"].includes(phase)) {
        harness.safeClick(button(harness.dumpNodes(), "保存窗口"), "save_window");
        if (phase === "repeat") {
          const fresh = harness.dumpNodes();
          record.repeat_observation = axWhitelist(fresh);
          record.repeat = { observed_at: now(), second_click_sent: false, in_flight_deduplication_verified: false };
          const candidates = fresh.filter((n) => n.role === "AXButton" && label(n) === "保存窗口" && n.enabled !== false);
          if (candidates.length === 1) {
            record.repeat.second_click_at = now();
            record.repeat.second_click_result = harness.safeClick(candidates[0], "repeat_save_window");
            record.repeat.second_click_sent = true;
          }
        }
      }
      if (["save", "clear", "repeat", "invalid", "save-failure"].includes(phase)) {
        const expected = phase === "invalid" ? "请输入 1 到" :
          phase === "save-failure" ? "保存未确认" : "已保存，桌面应用下次启动时读取。";
        await harness.pollAx((text) => text.includes(expected), 15000, "save_result");
      }
      const after = await capture("after");
      assertPhaseEvidence(input, before, after);
      record.status = "passed";
      record.scope = "ui_phase_only_not_release_lifecycle_or_model_acceptance";
    }
  } catch (error) {
    record.error = /^[a-zA-Z0-9_]+$/.test(String(error.message)) ? error.message : "ui_phase_failed";
    // Keep partial evidence without activating, retrying input, or cleaning processes.
    if (harness.target?.pid) {
      try { await capture("failure"); } catch { record.failure_capture = "unavailable"; }
    }
  }
  record.finished_at = now();
  saveJson(harness.dir, stem + ".json", record);
  return record;
}
async function main() {
  const [dir, phase] = process.argv.slice(2);
  check(dir && phase, "usage_artifactDir_phase");
  const input = JSON.parse(fs.readFileSync(path.join(dir, "b85-phase-input.json"), "utf8"));
  validatePhaseInput(input, phase);
  const result = await runB85Phase(new NativeScenarioHarness(dir), input, phase);
  if (!["passed", "close_requested"].includes(result.status)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("b85_driver_setup_failed\n"); process.exitCode = 1; });
}
