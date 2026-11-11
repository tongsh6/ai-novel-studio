// B71 CP3b 实模外部驱动：像作者一样在真实窗口输入自然语言创作请求，等待 run 终局，
// 采集 AX/WS/llm-calls/DB 证据与 Strata 单槽生命周期；不轮询固定回复文本、不假设
// 工具调用次数、不修改产品 prompt。判据与本文件分离（authoring_live_evidence）。
import path from "node:path";
import { readConfig } from "./lib/native_ui/authoring_capture_evidence.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import { all, logs, withDb, write } from "./lib/native_ui/scenario_evidence.mjs";
import {
  classifyTurnBody,
  dbTerminal,
  summarizeModelBehavior,
  wireTerminal,
} from "./lib/native_ui/live_run_wait.mjs";
import {
  DEFAULT_STRATA_ENDPOINT,
  readStrataState,
  strataLifecycleRecord,
  strataSlotCheck,
  unloadStrata,
} from "./lib/native_ui/strata_lifecycle.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b71_live_drive.mjs <batch-run-dir>");
  process.exit(64);
}

const evidence = path.join(ROOT, "scripts/native_b71_evidence.mjs");
const harness = new NativeScenarioHarness(dir);
const strataEndpoint = (() => {
  const configured = process.env.NOVEL_STRATA_ENDPOINT ?? DEFAULT_STRATA_ENDPOINT;
  return String(configured).replace(/\/v1\/?$/u, "").replace(/\/+$/u, "");
})();
const TURN_TIMEOUT_MS = Number(process.env.B71_LIVE_TURN_TIMEOUT_MS ?? 360_000);
const INPUT_TIMEOUT_MS = Number(process.env.B71_LIVE_INPUT_TIMEOUT_MS ?? 120_000);
const READY_TIMEOUT_MS = Number(process.env.B71_LIVE_READY_TIMEOUT_MS ?? 180_000);

const readProviderCounts = () => ({
  llm_records: logs(path.join(dir, "llm-calls")).length,
  provider_runs: withDb(dir, (db) => Number(all(db, "SELECT COUNT(*) AS c FROM provider_runs")[0].c)),
});

function readRunRow({ turnId, runId }) {
  return withDb(dir, (db) => {
    const rows = runId
      ? all(db, "SELECT id, status, parent_turn_ref, run_mode FROM agent_runs WHERE id = ?", [runId])
      : all(
          db,
          "SELECT id, status, parent_turn_ref, run_mode FROM agent_runs WHERE parent_turn_ref = ? ORDER BY inserted_at DESC",
          [turnId],
        );
    return rows.at(-1) ?? null;
  });
}

// 终局等待：WS 帧优先（owning turn/run 绑定），DB agent_runs 终态兜底；
// 两者都没有就继续等，直到 turn 预算耗尽。不轮询固定回复文本。
async function waitRunTerminal({ turnId, runId }) {
  let observed = null;
  const terminal = await harness.runStep("turn", "live_run_terminal", () =>
    harness.pollWire(
      (wire) => {
        const fromWire = wireTerminal(wire, { turnId, runId: runId || null });
        if (fromWire) {
          observed = { ...fromWire, source: "wire" };
          return observed;
        }
        const row = readRunRow({ turnId, runId: runId || null });
        const fromDb = dbTerminal(row);
        if (fromDb) {
          observed = { ...fromDb, source: "db", row };
          return observed;
        }
        return null;
      },
      TURN_TIMEOUT_MS,
      "b71-live:terminal",
    ),
  );
  return terminal ?? observed;
}

async function collectModelBehavior({ terminal, turnBody, runStatus }) {
  const llmRecords = logs(path.join(dir, "llm-calls")).filter((record) => record?.provider === "strata");
  return summarizeModelBehavior({ turnBody, llmRecords, runStatus: runStatus ?? terminal?.status ?? null });
}

// Why/replay 只读面板：有按钮则打开并在前后记录 Provider 计数；找不到按钮/打开失败
// 如实记录 why_not_observed，不判产品失败（判据侧 L11 记为未触发）。
async function observeWhy() {
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

async function run() {
  runEvidenceMode(evidence, "prepare", dir);
  const config = readConfig(dir);
  if (config.journey !== "live") throw new Error(`live driver 只接受 journey=live，实测: ${config.journey}`);
  if (config.provider !== "strata") throw new Error(`live driver 只接受 provider=strata，实测: ${config.provider}`);

  const before = await readStrataState({ endpoint: strataEndpoint }).catch((error) => ({
    ok: false,
    error: error.message,
  }));
  // 证据文件不得覆盖：开始只落 before 观测（不同名），卸载核验后的完整记录只在
  // finally 写一次 strata-slot.json。
  write(dir, "strata-slot-before.json", strataLifecycleRecord({ before, after: before, unload: null }));

  let driverLog = null;
  try {
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready", () =>
      harness.rawWaitWorkbenchSettled("b71-live", READY_TIMEOUT_MS),
    );
    await ensureWorkSelected(harness, config.target.work_title, "b71-live");
    harness.capture("01-workbench");
    runEvidenceMode(evidence, "capture", dir, ["start"]);

    const afterLaunch = await readStrataState({ endpoint: strataEndpoint }).catch((error) => ({
      ok: false,
      error: error.message,
    }));
    const launchSlot = strataSlotCheck(afterLaunch);
    harness.log.push({ op: "strata_after_launch", slot: launchSlot, at: harness.nowIso() });

    await harness.runStep("maintenance", "input_ready", () =>
      harness.rawWaitInputReady("b71-live", INPUT_TIMEOUT_MS),
    );
    const sent = await harness.runStep("input", "author_creation_request", () =>
      harness.rawTypeAndSend(config.message, "b71-live"),
    );
    const turnId = String(frameBody(sent)?.turn_id ?? "");
    if (!turnId) throw new Error("user_message_without_turn_id");
    harness.capture("after-input");
    const ack = await harness.runStep("ack", "user_message_ack", () =>
      harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, "b71-live:ack"),
    );
    const runId = String(frameBody(ack)?.response?.run_id ?? "");

    const terminal = await waitRunTerminal({ turnId, runId });
    if (!terminal) throw new Error("live_run_terminal_missing");
    harness.capture("final");
    const turnBody = terminal.body ?? null;
    const turnClassified = turnBody ? classifyTurnBody(turnBody) : null;

    const why = await observeWhy();
    const behavior = await collectModelBehavior({
      terminal,
      turnBody,
      runStatus: turnClassified?.run_status ?? terminal.status ?? null,
    });

    runEvidenceMode(evidence, "capture", dir, ["final"]);
    driverLog = {
      slice_id: config.slice_id,
      provider: "strata",
      model: config.target?.model ?? process.env.B71_STRATA_MODEL ?? "iq3_s",
      turn: {
        turn_id: turnId,
        run_id: runId || terminal.body?.agent_run?.run_id || null,
        terminal_kind: terminal.kind,
        terminal_status: terminal.status ?? null,
        terminal_source: terminal.source,
      },
      run: { status: turnClassified?.run_status ?? terminal.status ?? null },
      model_behavior: behavior,
      why,
      strata: { endpoint: strataEndpoint, after_launch: launchSlot },
    };
    harness.writeDriverLog("native-b71-driver-log.json", driverLog);
    // ui-complete 是 runner 的「驱动完成」信号：必须在 finally 证据（strata-slot /
    // driver-log 卸载核验）全部落盘之后写，避免 runner 在 strata-slot.json 落盘前
    // 开始 verify（2026-11-07 q2-0-02 实测的时序竞争）。
    console.log(
      `B71 CP3b 实模驱动完成: turn=${turnId} run=${driverLog.turn.run_id ?? "none"} terminal=${terminal.kind}/${terminal.source} provider_calls=${behavior.provider_calls} tool_calls=${behavior.tool_call_count} why=${why.opened ? "opened" : "not_observed"}`,
    );
  } finally {
    // 批次结束/失败/中断都必须卸载并核验 loaded=null；卸载结果覆盖 strata-slot.json。
    const unload = await unloadStrata({ endpoint: strataEndpoint }).catch((error) => ({
      unload: { ok: false, error: error.message },
      state: { error: error.message },
      slot: { ok: false, loaded: null, reason: `unload_failed:${error.message}` },
    }));
    write(dir, "strata-slot.json", strataLifecycleRecord({ before, after: unload.state, unload: unload.unload }));
    if (driverLog) {
      harness.writeDriverLog("native-b71-driver-log.json", {
        ...driverLog,
        strata: {
          ...driverLog.strata,
          unload: unload.unload,
          after: unload.state,
          slot_after: unload.slot,
        },
      });
    }
    harness.writeUiComplete(config.slice_id);
  }
}

await harness.runJourney(run);
