// B71 §16.16 第 2 类入口（安全点自动维护）原生外部驱动（journey=auto-maintenance）。
//
// 真实 strata + 小窗口压力（NOVEL_CONTEXT_WINDOW_OVERRIDES="strata:4096"）+
// NOVEL_AUTO_MAINTENANCE_ENABLED=1：≥2 次真实续行形成更早工作回合 → 安全点自动整理 →
// 行内细条 → 展开（原因/原文保留/来源/完整记录入口）→ 下一请求精简 → 刷新幂等 →
// 失败静默（隔离 test DB 持久 trigger）→ 全类别 AX 扫描 → 清理。
//
// 不伪造窗口、不注入 usage、不手工压缩；无法形成真实压力时如实记录未闭环。
import path from "node:path";
import fs from "node:fs";
import { readJson } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import { all, logs, withDb, write } from "./lib/native_ui/scenario_evidence.mjs";
import { classifyTurnBody, dbTerminal, wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import {
  DEFAULT_STRATA_ENDPOINT,
  readStrataState,
  strataLifecycleRecord,
  strataSlotCheck,
  unloadStrata,
} from "./lib/native_ui/strata_lifecycle.mjs";
import { AUTO_MAINTENANCE_REQUESTS } from "./lib/native_ui/authoring_auto_maintenance_evidence.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b71_auto_maintenance_drive.mjs <batch-run-dir>");
  process.exit(64);
}

const evidence = path.join(ROOT, "scripts/native_b71_evidence.mjs");
const harness = new NativeScenarioHarness(dir);
const strataEndpoint = (() => {
  const configured = process.env.NOVEL_STRATA_ENDPOINT ?? DEFAULT_STRATA_ENDPOINT;
  return String(configured).replace(/\/v1\/?$/u, "").replace(/\/+$/u, "");
})();
const TURN_TIMEOUT_MS = Number(process.env.B71_AUTO_MAINT_TURN_TIMEOUT_MS ?? 360_000);
const INPUT_TIMEOUT_MS = Number(process.env.B71_AUTO_MAINT_INPUT_TIMEOUT_MS ?? 120_000);
const READY_TIMEOUT_MS = Number(process.env.B71_AUTO_MAINT_READY_TIMEOUT_MS ?? 180_000);
const FLOW_LABEL = "b71-auto-maint";

const envFacts = {
  auto_maintenance_enabled: process.env.NOVEL_AUTO_MAINTENANCE_ENABLED ?? null,
  window_overrides: process.env.NOVEL_CONTEXT_WINDOW_OVERRIDES ?? null,
};

const checkpointEventCount = () =>
  withDb(dir, (db) =>
    Number(
      all(db, "SELECT COUNT(*) AS c FROM agent_events WHERE event_type = 'checkpoint_created'")[0]?.c ?? 0,
    ),
  );

const llmRecordCount = () => logs(path.join(dir, "llm-calls")).length;

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

async function waitRunTerminal({ turnId, runId }) {
  let observed = null;
  const terminal = await harness.runStep("turn", "run_terminal", () =>
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
      `${FLOW_LABEL}:terminal`,
    ),
  );
  return terminal ?? observed;
}

function findStripButton(nodes) {
  const matches = nodes.filter(
    (node) =>
      node?.role === "AXButton" &&
      (String(node.title ?? "").includes("较早的") ||
        String(node.desc ?? "").includes("较早的") ||
        String(node.desc ?? "").includes("查看已整理的较早创作过程") ||
        String(node.title ?? "").includes("创作过程已整理")),
  );
  return matches.at(-1) ?? null;
}

async function sendRequest(index, text) {
  await harness.runStep("maintenance", "input_ready", () =>
    harness.rawWaitInputReady(FLOW_LABEL, INPUT_TIMEOUT_MS),
  );
  const sent = await harness.runStep("input", `request_${index}`, () =>
    harness.rawTypeAndSend(text, FLOW_LABEL),
  );
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  if (!turnId) throw new Error(`auto_maint: request_${index} user_message_without_turn_id`);
  harness.capture(`req-0${index}`);
  const ack = await harness.runStep("ack", `request_${index}_ack`, () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, `${FLOW_LABEL}:ack:${index}`),
  );
  const runId = String(frameBody(ack)?.response?.run_id ?? "");
  const terminal = await waitRunTerminal({ turnId, runId });
  if (!terminal) throw new Error(`auto_maint: request_${index} terminal_missing`);
  const turnBody = terminal.body ?? null;
  const classified = turnBody ? classifyTurnBody(turnBody) : null;
  const events = checkpointEventCount();
  return {
    index,
    text,
    turn_id: turnId,
    run_id: runId || terminal.body?.agent_run?.run_id || null,
    terminal_kind: terminal.kind,
    terminal_status: terminal.status ?? null,
    run_status: classified?.run_status ?? terminal.status ?? null,
    checkpoint_events_after: events,
    provider_calls: llmRecordCount(),
  };
}

async function clickStripAndExpand() {
  const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:strip`);
  const button = findStripButton(nodes);
  const streak = { found: Boolean(button), clicked: false, path: button?.path ?? null };
  if (button) {
    await harness.runStep("input", "expand_maintenance_strip", async () => {
      harness.safeClick(button, "auto_maint:strip");
    });
    streak.clicked = true;
  }
  return streak;
}

function authorErrorVisible() {
  try {
    const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:failure_scan`);
    const alerts = nodes.filter((node) => ["AXSheet", "AXDialog"].includes(node?.role));
    const texts = nodes.map((node) => `${node?.title ?? ""} ${node?.desc ?? ""} ${node?.value ?? ""}`).join("\n");
    return alerts.length > 0 && /失败|错误|异常/u.test(texts);
  } catch {
    return false;
  }
}

function injectFailureTrigger() {
  withDb(dir, (db) => {
    db.exec("DROP TRIGGER IF EXISTS reject_b71_auto_maintenance");
    db.exec(
      "CREATE TRIGGER reject_b71_auto_maintenance BEFORE INSERT ON agent_events " +
        "WHEN NEW.event_type = 'checkpoint_created' " +
        "BEGIN SELECT RAISE(ABORT, 'maintenance unavailable'); END;",
    );
  });
}

function dropFailureTrigger() {
  withDb(dir, (db) => {
    db.exec("DROP TRIGGER IF EXISTS reject_b71_auto_maintenance");
  });
}

function waitCheckpointIncrease(baseline, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    harness.checkSupervisor();
    if (checkpointEventCount() > baseline) return true;
    const sleep = new Promise((resolve) => setTimeout(resolve, 1_000));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
    void sleep;
  }
  return false;
}

async function run() {
  runEvidenceMode(evidence, "prepare", dir);
  const config = readJson(path.join(dir, "native-b71-config.json"));
  if (config.journey !== "auto-maintenance") {
    throw new Error(`auto-maintenance driver 只接受 journey=auto-maintenance，实测: ${config.journey}`);
  }
  if (config.provider !== "strata") {
    throw new Error(`auto-maintenance driver 只接受 provider=strata，实测: ${config.provider}`);
  }
  const requests = Array.isArray(config.auto_maintenance?.requests) && config.auto_maintenance.requests.length > 0
    ? config.auto_maintenance.requests
    : [...AUTO_MAINTENANCE_REQUESTS];

  const before = await readStrataState({ endpoint: strataEndpoint }).catch((error) => ({ ok: false, error: error.message }));
  write(dir, "strata-slot-before.json", strataLifecycleRecord({ before, after: before, unload: null }));

  let driverLog = null;
  try {
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready", () =>
      harness.rawWaitWorkbenchSettled(FLOW_LABEL, READY_TIMEOUT_MS),
    );
    await ensureWorkSelected(harness, config.target.work_id, config.target.work_title, FLOW_LABEL);
    harness.capture("01-workbench");
    runEvidenceMode(evidence, "capture", dir, ["start"]);

    const report = {
      slice_id: config.slice_id,
      provider: "strata",
      model: config.target?.model ?? "iq3_s",
      env: envFacts,
      requests: [],
      triggered: false,
      first_trigger_index: null,
      maintenance_strip: null,
      next_request: null,
      refresh: null,
      failure_injection: null,
      recovery: null,
      model_behavior: null,
      termination: null,
    };

    // ≥2 次真实续行（最多 requests 条）；安全点自动整理触发后停止发送。
    for (let index = 1; index <= requests.length; index += 1) {
      const request = await sendRequest(index, requests[index - 1]);
      report.requests.push(request);
      if (request.checkpoint_events_after > 0) {
        report.triggered = true;
        report.first_trigger_index = index;
        break;
      }
      if (index >= 2) {
        // 已至少 2 次真实续行仍无整理：继续尝试（窗口压力可能需更多轮），不伪造。
      }
    }

    if (report.triggered) {
      harness.capture("after-maintenance");
      runEvidenceMode(evidence, "capture", dir, ["after-maintenance"]);

      report.maintenance_strip = await clickStripAndExpand();
      harness.capture("after-expanded");
      runEvidenceMode(evidence, "capture", dir, ["after-expanded"]);

      // 下一请求：整理之后的第一个真实请求 → 精简判据在 evidence 侧按 llm-calls 时间窗判定。
      const nextIndex = Math.min((report.first_trigger_index ?? 1) + 1, requests.length);
      const nextRequest = await sendRequest(nextIndex, requests[nextIndex - 1]);
      report.next_request = nextRequest;
      harness.capture("after-next-request");
      runEvidenceMode(evidence, "capture", dir, ["after-next-request"]);

      // 刷新（重启恢复）幂等。
      const refreshBefore = checkpointEventCount();
      await harness.runStep("restore", "close_app_and_relaunch", () => harness.rawCloseAppAndRelaunch());
      await harness.runStep("maintenance", "workbench_ready_restored", () =>
        harness.rawWaitWorkbenchSettled(`${FLOW_LABEL}:restored`, READY_TIMEOUT_MS),
      );
      await harness.runStep("maintenance", "work_selected_restored", () =>
        harness.rawTrySelectWork(config.target.work_title, `${FLOW_LABEL}:restored`),
      );
      const refreshAfter = checkpointEventCount();
      report.refresh = { before_checkpoint_events: refreshBefore, after_checkpoint_events: refreshAfter };
      harness.capture("after-refresh");
      runEvidenceMode(evidence, "capture", dir, ["after-refresh"]);

      // 失败静默：持久 trigger → 下一请求的安全点维护失败（静默）→ 页面无错误、DB 无新 checkpoint。
      const failureBefore = checkpointEventCount();
      injectFailureTrigger();
      const failureIndex = Math.min((report.first_trigger_index ?? 1) + 2, requests.length);
      const failureRequest = await sendRequest(failureIndex, requests[failureIndex - 1]);
      const failureVisible = authorErrorVisible();
      const failureAfter = checkpointEventCount();
      harness.capture("after-failure");
      runEvidenceMode(evidence, "capture", dir, ["after-failure"]);
      dropFailureTrigger();

      // 恢复：移除 trigger 后下一安全点应出现 checkpoint_created（重试成功）。
      const recoveryBaseline = failureAfter;
      const recoveryIndex = Math.min((report.first_trigger_index ?? 1) + 3, requests.length);
      const recoveryRequest = await sendRequest(recoveryIndex, requests[recoveryIndex - 1]);
      const recovered = waitCheckpointIncrease(recoveryBaseline);
      report.failure_injection = {
        trigger_created: true,
        author_error_visible: failureVisible,
        checkpoint_events_before_failure: failureBefore,
        checkpoint_events_after_failure: failureAfter,
        recovered_after_drop: recovered,
        failure_request: failureRequest,
        recovery_request: recoveryRequest,
      };
      report.recovery = { recovered, checkpoint_events: checkpointEventCount() };
      harness.capture("after-recovery");
      runEvidenceMode(evidence, "capture", dir, ["after-recovery"]);
    } else {
      // 未触发真实压力/自动维护：如实记录未闭环，不伪造细条/窗口。
      harness.capture("after-maintenance");
      runEvidenceMode(evidence, "capture", dir, ["after-maintenance"]);
      report.maintenance_strip = { found: false, clicked: false, reason: "not_triggered" };
    }

    report.termination = {
      at: harness.nowIso(),
      llm_calls: llmRecordCount(),
      checkpoint_events: checkpointEventCount(),
    };
    report.model_behavior = {
      provider_calls: llmRecordCount(),
      requests_total: report.requests.length,
      triggered: report.triggered,
      run_statuses: report.requests.map((request) => request.run_status),
    };

    harness.capture("final");
    const turnBodies = harness
      .transport()
      .filter((record) => record?.direction === "received" && Array.isArray(record.frame) && record.frame[3] === "turn_result")
      .map((record) => record.frame[4] ?? {});
    runEvidenceMode(evidence, "capture", dir, ["final"]);
    driverLog = {
      ...report,
      turn_results: turnBodies.length,
      strata: { endpoint: strataEndpoint },
    };
    harness.writeDriverLog("native-b71-driver-log.json", driverLog);
    console.log(
      `B71 auto-maintenance 驱动完成: requests=${report.requests.length} triggered=${report.triggered} checkpoint_events=${report.termination.checkpoint_events} failure_silent=${
        report.failure_injection?.author_error_visible === false
      }`,
    );
  } finally {
    const unload = await unloadStrata({ endpoint: strataEndpoint }).catch((error) => ({
      unload: { ok: false, error: error.message },
      state: { error: error.message },
      slot: { ok: false, loaded: null, reason: `unload_failed:${error.message}` },
    }));
    write(dir, "strata-slot.json", strataLifecycleRecord({ before, after: unload.state, unload: unload.unload }));
    if (driverLog) {
      harness.writeDriverLog("native-b71-driver-log.json", {
        ...driverLog,
        strata: { ...driverLog.strata, unload: unload.unload, after: unload.state, slot_after: unload.slot },
      });
      // ui-complete 是 runner 的「驱动完成」信号：必须在 finally 证据（strata-slot/driver-log）
      // 全部落盘之后写，避免 runner 在 strata-slot.json 落盘前开始 verify（证据时序竞争）。
      harness.writeUiComplete(config.slice_id);
    }
  }
}

run().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
