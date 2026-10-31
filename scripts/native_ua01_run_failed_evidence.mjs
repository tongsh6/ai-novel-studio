// UA01-LOG 最终 run_failed 三源只读证据核验，不操作产品。
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { turnMatchesMessage } from "./lib/native_ui/adoption_contract.mjs";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  axText,
  evidenceBoundary,
  productionTableCounts,
  read,
  seedFields,
  write,
  writeNativeSummary,
  withDb,
} from "./lib/native_ui/scenario_evidence.mjs";

const SLICE = "ua01-agent-run-failed-log-join";
const bodyOf = (record) => record?.frame?.[4] ?? {};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert.equal(ready.provider, "slice_verify");
  const seed = seedFields(dir);
  const work = withDb(dir, (db) => all(db, "SELECT id, title FROM works WHERE id = ?", [seed("work_id")])[0]);
  assert(work?.title, "seed 作品不存在");
  const config = {
    slice_id: SLICE,
    provider: ready.provider,
    target: { work_id: seed("work_id"), work_title: work.title, session_id: seed("session_id") },
    baseline: productionTableCounts(dir),
  };
  write(dir, "native-ua01-config.json", config);
  return config;
}

export function capture(dir, checkpoint) {
  assert.equal(checkpoint, "final");
  const config = read(dir, "native-ua01-config.json");
  write(dir, "native-ua01-final-counts.json", {
    baseline: config.baseline,
    final: productionTableCounts(dir),
  });
}

export function verify(dir) {
  const config = read(dir, "native-ua01-config.json");
  const report = read(dir, "native-ua01-report.json");
  const { ready, ui, ledger } = assertCommonEvidence(dir, {
    sliceId: SLICE,
    minScreenshots: 1,
    minimumWaits: 4,
    requiredKinds: ["input", "ack", "turn", "maintenance"],
  });
  const wire = assertProviderAndWire(dir, {
    minUserMessages: 1,
    minTurnResults: 1,
    minProviderStarts: 1,
  });

  const source = wire.userMessages.find((record) =>
    String(bodyOf(record).text ?? "").includes("UA01PROVIDERFAIL") &&
    bodyOf(record).work_id === config.target.work_id,
  );
  assert(source, "缺少含失败标记的真实 user_message");
  const turnId = bodyOf(source).turn_id;
  const failed = wire.turnResults.find((record) =>
    turnMatchesMessage(bodyOf(record), turnId) &&
    bodyOf(record).trace_summary?.decision_type === "run_failed" &&
    bodyOf(record).agent_run?.status === "failed" &&
    bodyOf(record).status === "failed_recoverable",
  );
  assert(failed, "缺少最终 run_failed TurnResult");
  const runId = bodyOf(failed).agent_run.run_id;
  assert.equal(runId, report.run_id, "wire 与 driver run_id 不一致");
  assert.equal(bodyOf(failed).agent_run.parent_turn_ref, turnId);
  assert.equal(bodyOf(failed).turn_id, turnId);

  const providerLog = wire.appRecords.find(
    (record) => record.event === "provider_gateway.complete.error" && record.turn_id === turnId,
  );
  const failedLog = wire.appRecords.find(
    (record) => record.event === "agent_run.run_failed.error" && record.turn_id === turnId,
  );
  assert(providerLog, "provider error 缺 base turn 关联");
  assert(failedLog, "run_failed 缺 base turn 关联");
  for (const record of [providerLog, failedLog]) {
    assert.equal(record.workspace_id, bodyOf(source).workspace_id ?? config.target.work_id);
    assert.equal(record.work_id, config.target.work_id);
    assert.equal(record.session_id, config.target.session_id);
    assert.equal(record.turn_id, turnId);
  }
  assert.equal(failedLog.run_id, runId);

  const { run, event } = withDb(dir, (db) => ({
    run: all(
      db,
      "SELECT id, workspace_id, work_id, session_id, parent_turn_ref, status FROM agent_runs WHERE id = ?",
      [runId],
    )[0],
    event: all(
      db,
      "SELECT id, run_id, event_type FROM agent_events WHERE run_id = ? AND event_type = 'run_failed' ORDER BY sequence DESC LIMIT 1",
      [runId],
    )[0],
  }));
  assert(run, "AgentRunLog 缺失败 run");
  assert.equal(run.status, "failed");
  assert.equal(run.parent_turn_ref, turnId);
  assert.equal(run.work_id, config.target.work_id);
  assert.equal(run.session_id, config.target.session_id);
  assert(event, "AgentEvent 缺 run_failed 持久事件");
  assert.equal(event.run_id, runId);

  const counts = read(dir, "native-ua01-final-counts.json");
  const factsUnchanged = same(counts.baseline, counts.final);
  const visible = axText(dir, "01-run-failed");
  const assistant = String(bodyOf(failed).assistant_message?.text ?? "");
  const authorSafe =
    visible.includes("无法连接到创作引擎") &&
    visible.includes("没有创建待采纳内容") &&
    !visible.includes("raw provider failure payload") &&
    !assistant.includes("raw provider failure payload");
  const noAdoption =
    (bodyOf(failed).adoption_state?.pending ?? []).length === 0 &&
    bodyOf(failed).truthfulness?.artifact_adopted === false &&
    bodyOf(failed).truthfulness?.production_write_performed === false &&
    !wire.wire.some((record) => record.direction === "sent" && record.frame?.[3] === "author_action");

  const checks = {
    real_tauri_window_launched: ui.driver === "ax-native-system-ui" && ready.browser_driver_started === false,
    controlled_final_run_failed: Boolean(source && failed && providerLog),
    wire_turn_run_join:
      bodyOf(failed).turn_id === turnId && bodyOf(failed).agent_run.parent_turn_ref === turnId && Boolean(runId),
    app_log_turn_run_join: Boolean(providerLog && failedLog && failedLog.run_id === runId),
    database_turn_run_join: Boolean(run && event && run.parent_turn_ref === turnId && event.run_id === runId),
    author_safe_failure: authorSafe,
    no_adoption_or_production_write: noAdoption && factsUnchanged,
    wait_ledger_complete: ledger.waits >= 4 && ui.screenshots.length >= 1,
  };
  const summary = writeNativeSummary(dir, {
    sliceId: SLICE,
    checks,
    measured: {
      work_id: config.target.work_id,
      session_id: config.target.session_id,
      turn_id: turnId,
      run_id: runId,
      provider_log_turn_id: providerLog.turn_id,
      run_failed_log_turn_id: failedLog.turn_id,
      database_status: run.status,
      surface: "tauri",
    },
    extra: {
      behavior: {
        name: "controlled_final_run_failed_has_three_source_turn_run_join",
        assertions: Object.keys(checks).filter((key) => checks[key]),
      },
      evidence_boundary: evidenceBoundary(),
      known_limits: [
        "仅覆盖 slice_verify 最终 run_failed 单场景，不代表真实供应商错误、取消/恢复或跨作品矩阵",
        "独立 DecisionTrace for run_failed 与 AU04 场景漂移不在本批关闭",
      ],
    },
  });
  assert.equal(summary.all_checks_passed, true, `UA01 run_failed 原生断言失败: ${JSON.stringify(checks)}`);
  return summary;
}

export function main([mode, artifact, checkpoint]) {
  const dir = path.resolve(artifact ?? "");
  if (!artifact) throw new Error("usage: native_ua01_run_failed_evidence.mjs <prepare|capture|verify> <dir> [checkpoint]");
  if (mode === "prepare") return prepare(dir);
  if (mode === "capture") return capture(dir, checkpoint);
  if (mode === "verify") return verify(dir);
  throw new Error(`unknown mode: ${mode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
