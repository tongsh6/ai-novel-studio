// B71 冻结作者输入的原生驱动：同一 work/session 按 steps 顺序采集。
// 只操作与采证，不判断模型语义、不替作者回答、不补发或自动重试。
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeScenarioHarness, ROOT, ensureWorkSelected, frameBody, runEvidenceMode } from "./lib/native_ui/scenario_driver.mjs";
import { all, frameOf, frameEvent, logs, withDb } from "./lib/native_ui/scenario_evidence.mjs";
import { readConfig } from "./lib/native_ui/authoring_capture_evidence.mjs";
import { summarizeModelBehavior, wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import { publishedAuthorQuestion } from "./lib/native_ui/authoring_live_evidence.mjs";

// Why/replay 只读面板：有按钮则打开并在前后记录 Provider 计数；找不到按钮/打开失败
// 如实记录 why_not_observed，不判产品失败（判据侧 L11 记为未触发）。
async function observeWhy(harness, readProviderCounts) {
  // 真实创作 run 后 Why 按钮可能在长消息流下方（视口外）：先找可见按钮，
  // 找不到时从完整 AX 树定位 enabled 的「为什么」按钮并滚到可见位置再找。
  // 记录 scroll 尝试，便于区分「按钮不存在」与「存在但不可见」。
  const scroll = { needed: false, ok: null, path: null, reason: null };
  let nodes = null;
  try {
    const probe = await harness.tryPollAx(
      (_text, candidate) => Boolean(harness.findWhyButton(candidate)),
      20_000,
    );
    nodes = probe?.nodes ?? null;
  } catch (error) {
    scroll.reason = `why_button_probe_failed:${error.message}`;
  }
  if (!nodes || !harness.findWhyButton(nodes)) {
    scroll.needed = true;
    try {
      const all = harness.dumpNodes();
      const candidates = all.filter(
        (node) =>
          node.role === "AXButton" &&
          (node.title === "为什么" || String(node.desc ?? "").includes("查看这轮回应的依据")),
      );
      const target = candidates.at(-1) ?? null;
      if (!target || !target.path) {
        scroll.ok = false;
        scroll.reason = "why_button_not_in_ax_tree";
      } else {
        scroll.path = target.path;
        harness.ensureInput().scrollTo(target.path);
        const retry = await harness.tryPollAx(
          (_text, candidate) => Boolean(harness.findWhyButton(candidate)),
          20_000,
        );
        nodes = retry?.nodes ?? null;
        scroll.ok = Boolean(nodes && harness.findWhyButton(nodes));
        if (!scroll.ok) scroll.reason = "why_button_scrolled_but_not_visible";
      }
    } catch (error) {
      scroll.ok = false;
      scroll.reason = `why_button_scroll_failed:${error.message}`;
    }
  }
  if (!nodes || !harness.findWhyButton(nodes)) {
    return {
      opened: false,
      reason: scroll.reason ?? "why_button_not_found",
      ...(scroll.needed ? { scroll } : {}),
    };
  }
  const before = readProviderCounts();
  let opened = false;
  let panelText = null;
  try {
    await harness.runStep("maintenance", "why_open", () => harness.rawOpenWhy("b71-live"));
    opened = true;
    panelText = await harness.pollAx(
      (text) => text.includes("参考来源") && text.includes("不会重新调用模型"),
      30_000,
      "b71-live:why_panel",
    );
    harness.capture("why");
  } catch (error) {
    if (!opened) return { opened: false, reason: `why_open_failed:${error.message}`, before };
  }
  // Why 面板已打开：Provider 计数必须只读不变；关闭失败单独记录，不影响已完成的前后计数。
  const after = readProviderCounts();
  let closeError = null;
  try {
    harness.ensureInput().key("escape", { focusRequired: false });
    await harness.runStep("maintenance", "why_close", () =>
      harness.pollAx((text) => !text.includes("不会重新调用模型"), 20_000, "b71-live:why_closed"),
    );
  } catch (error) {
    closeError = error.message;
  }
  return {
    opened: true,
    before,
    after,
    ...(scroll.needed ? { scroll } : {}),
    ...(panelText ? { panel_excerpt: panelText.text.slice(0, 800) } : {}),
    ...(closeError ? { close_error: closeError } : {}),
  };
}


function hasPublishedQuestion(terminal) {
  return terminal.results.some((record) => publishedAuthorQuestion(frameBody(record)));
}

// hooks 只封装 checkpoint、DB 与日志/UI 读取；业务身份与停止条件由本函数统一决定。
export async function driveBehavior(harness, config, hooks) {
  assert.equal(config.journey, "behavior", "behavior driver 只接受 journey=behavior");
  assert(["splash", "strata"].includes(config.provider), "behavior provider 未知");
  assert(Array.isArray(config.steps) && config.steps.length > 0, "behavior 缺冻结 steps");
  assert.equal(config.steps.length, config.budget?.author_sends, "steps 与冻结发送预算不符");
  assert.equal(config.budget.manual_retries, 0, "behavior 禁止自动重试");
  const target = config.target;
  assert(target?.work_id && target?.session_id, "behavior 缺冻结 work/session");
  const inputTimeout = config.budget.input_timeout_ms, turnTimeout = config.budget.turn_timeout_ms;
  const runIds = new Set(), turnIds = new Set();
  const result = { slice_id: config.slice_id, provider: config.provider,
    model: config.preregistration?.model ?? config.target.model ?? null, steps: [] };
  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready", () =>
    harness.rawWaitWorkbenchSettled("b71-behavior", 180000));
  await ensureWorkSelected(harness, target.work_title, "b71-behavior");
  harness.capture("01-workbench");
  await hooks.capture("start", { workId: target.work_id, sessionId: target.session_id });
  for (const [index, step] of config.steps.entries()) {
    await harness.runStep("maintenance", `input_ready_${index}`, () =>
      harness.rawWaitInputReady("b71-behavior", inputTimeout));
    await hooks.capture(`step-${index}-before`, { workId: target.work_id, sessionId: target.session_id });
    const sent = await harness.runStep("input", `author_input_${index}`, () =>
      harness.rawTypeAndSend(step.expression, "b71-behavior"));
    const body = frameBody(sent), topic = frameOf(sent)?.[2];
    assert.equal(body?.text, step.expression, "发送作者字节与冻结输入不符");
    assert.equal(body?.work_id, target.work_id, "发送 work 与冻结目标不符");
    assert.equal(body?.session_id, target.session_id, "发送 session 与同组会话不符");
    const turnId = body?.turn_id;
    assert(typeof turnId === "string" && turnId && !turnIds.has(turnId), "发送 turn 身份缺失或重复");
    turnIds.add(turnId);
    harness.capture(`step-${index}-input`);
    const ack = await harness.runStep("ack", `input_ack_${index}`, () =>
      harness.pollWire((wire) => {
        const matches = wire.filter((record) => record.direction === "received" &&
          frameEvent(record) === "phx_reply" && frameOf(record)?.[0] === frameOf(sent)[0] &&
          frameOf(record)?.[1] === frameOf(sent)[1] && frameOf(record)?.[2] === topic && record.at >= sent.at);
        assert(matches.length <= 1, "发送 ACK 多义");
        return matches[0] ?? null;
      }, 25000, "b71-behavior:ack"));
    assert.equal(frameBody(ack)?.status, "ok", "作者输入 ACK 未成功");
    assert.equal(frameBody(ack)?.response?.turn_id, turnId, "ACK turn 错绑");
    const runId = frameBody(ack)?.response?.run_id;
    assert(typeof runId === "string" && runId && !runIds.has(runId), "ACK run 身份缺失或重复");
    runIds.add(runId);
    const identity = { turnId, runId, topic, workId: body.work_id, sessionId: body.session_id,
      since: sent.at, resultPosition: "last" };
    const terminal = await harness.runStep("turn", `run_terminal_${index}`, () =>
      harness.pollWire((wire) => {
        const terminal = wireTerminal(wire, { ...identity, runRow: hooks.readRunRow(identity),
          requireWireTerminal: true });
        if (terminal && ["awaiting_author", "needs_confirmation"].includes(terminal.status) &&
          !hasPublishedQuestion(terminal)) return null;
        return terminal;
      }, turnTimeout, "b71-behavior:terminal"));
    harness.capture(`step-${index}-after`);
    await hooks.capture(`step-${index}-after`, identity);
    const turnBody = frameBody(terminal.results.at(-1)) ?? null;
    const modelBehavior = await hooks.collectModelBehavior({ ...identity, terminal, turnBody,
      runStatus: terminal.status, provider: config.provider });
    const entry = { case_id: step.case_id, sequence: step.sequence ?? index,
      turn: { turn_id: turnId, run_id: runId, topic, work_id: body.work_id, session_id: body.session_id,
        terminal_kind: terminal.kind, terminal_status: terminal.status, terminal_source: terminal.source },
      run: { status: terminal.status }, model_behavior: modelBehavior };
    result.steps.push(entry);
    Object.assign(result, { turn: entry.turn, run: entry.run });
    harness.writeDriverLog("native-b71-driver-log.json", result);
    if (["failed", "cancelled"].includes(terminal.status)) {
      await hooks.capture("final", identity);
      throw new Error(`behavior 停止: run ${runId} 实际终局 ${terminal.status}`);
    }
    if (terminal.status !== "completed" && index < config.steps.length - 1) {
      result.stopped = { reason: "awaiting_unregistered_author_action", case_id: step.case_id,
        unexecuted_case_ids: config.steps.slice(index + 1).map((next) => next.case_id) };
      await hooks.capture("final", identity);
      harness.writeDriverLog("native-b71-driver-log.json", result);
      return result;
    }
  }
  result.why = await hooks.observeWhy();
  await hooks.capture("final", { workId: target.work_id, sessionId: target.session_id });
  harness.capture("final");
  harness.writeDriverLog("native-b71-driver-log.json", result);
  harness.writeUiComplete(config.slice_id);
  return result;
}

async function run(dir) {
  const evidence = path.join(ROOT, "scripts/native_b71_evidence.mjs");
  const harness = new NativeScenarioHarness(dir);
  await harness.runJourney(async () => {
    runEvidenceMode(evidence, "prepare", dir);
    const config = readConfig(dir);
    const readProviderCounts = () => ({
      llm_records: logs(path.join(dir, "llm-calls")).length,
      provider_runs: withDb(dir, (db) => Number(all(db, "SELECT COUNT(*) AS c FROM provider_runs")[0].c)),
    });
    await driveBehavior(harness, config, {
      capture: (name) => runEvidenceMode(evidence, "capture", dir, [name]),
      readRunRow: ({ turnId, runId }) => withDb(dir, (db) => all(db,
        "SELECT id, status, parent_turn_ref, run_mode, workspace_id, work_id, session_id, goal_version " +
        "FROM agent_runs WHERE id = ? AND parent_turn_ref = ?", [runId, turnId])[0] ?? null),
      collectModelBehavior: ({ turnId, turnBody, runStatus }) => summarizeModelBehavior({
        turnBody, runStatus, llmRecords: logs(path.join(dir, "llm-calls")).filter((record) =>
          record.provider === config.provider && (record.turn_id === turnId ||
            String(record.turn_id).startsWith(`${turnId}:agent:`))),
      }),
      observeWhy: () => observeWhy(harness, readProviderCounts),
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv[2], "usage: node scripts/native_b71_behavior_drive.mjs <batch-run-dir>");
  await run(path.resolve(process.argv[2]));
}