// B71 原生证据核验：只消费隔离批次的真实请求、AX/截图、WS 和只读 DB。
//
// 本文件保持既有 CLI/导出入口，只做薄组合：
// - authoring_capture_evidence：启动前后 prepare/capture 与只读 DB 快照
// - authoring_run_evidence：批次证据读取、纯判据输入归一与结果落盘
// - authoring_scenario_evidence：无 I/O 的场景判据
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LAST_PAGE_ANCHOR,
  nativeCallFailureSummary,
} from "./lib/native_ui/authoring_scenario_evidence.mjs";
import { verifyRevisionBatch } from "./lib/native_ui/authoring_revision_run_evidence.mjs";
import {
  capturePending,
  verifyPendingBatch,
} from "./lib/native_ui/authoring_pending_run_evidence.mjs";
import { verifyLiveBatch } from "./lib/native_ui/authoring_live_evidence.mjs";
import { verifyBehaviorBatch } from "./lib/native_ui/authoring_behavior_evidence.mjs";
import { verifyConfirmationBatch } from "./lib/native_ui/authoring_confirmation_evidence.mjs";
import { verifyAutoMaintenanceBatch } from "./lib/native_ui/authoring_auto_maintenance_evidence.mjs";
import { verifyMemoryDetailBatch } from "./lib/native_ui/authoring_memory_detail_evidence.mjs";
import { verifyAnswerModeBatch } from "./lib/native_ui/authoring_answer_mode_evidence.mjs";
import {
  characterRequestChecks,
  characterOutcomeChecks,
  continuationOutcomeChecks,
  continuationRequestChecks,
  fullReadOutcomeChecks,
  nativeRequestChecks,
  nativeStageHistoryPreserved,
  planningOutcomeChecks,
  requestBodiesOf,
} from "./lib/native_ui/authoring_scenario_evidence.mjs";
import { planningProtocolEvidence } from "./lib/native_ui/authoring_planning_evidence.mjs";
import {
  capture,
  planningCanonSnapshot,
  prepare,
  readConfig,
} from "./lib/native_ui/authoring_capture_evidence.mjs";
import {
  authoringVisibleText,
  collectAuthoringRun,
  explorationFacts,
  fingerprintUnchanged,
  finishVerification,
  readCheckpoint,
  verificationExtra,
} from "./lib/native_ui/authoring_run_evidence.mjs";

export {
  capture,
  characterRequestChecks,
  continuationRequestChecks,
  nativeStageHistoryPreserved,
  planningCanonSnapshot,
  prepare,
};

const MESSAGE = "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。";
const CONTINUATION_MESSAGE = "先写第01章正文草稿，再做质量复核；这是一项可恢复的长任务。";
const PLANNING_MESSAGE = "请按先核对再补齐计划设计一个角色，再设计相关世界设定；这是一项可恢复的长任务。";
const CHARACTER_MESSAGE = "先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派；这是一项可恢复的长任务。";

const CONTINUATION_SPEC = Object.freeze({
  common: {
    sliceId: "b71-authoring-transcript",
    minScreenshots: 3,
    minimumWaits: 9,
    allowVerificationFailureMarker: true,
  },
  wire: { minUserMessages: 1, minTurnResults: 1, minProviderStarts: 3 },
  message: CONTINUATION_MESSAGE,
  missingInput: "缺少正文创作作者输入",
  missingAck: "真实输入 ack 缺 run_id",
  missingCompleted: "缺少同一 run 的完成结果",
  completedTurn: "first",
  requireRunMode: "durable",
});

const CHARACTER_SPEC = Object.freeze({
  common: {
    sliceId: "b71-authoring-profiles",
    minScreenshots: 2,
    minimumWaits: 9,
    allowVerificationFailureMarker: true,
  },
  wire: { minUserMessages: 1, minTurnResults: 1, minProviderStarts: 2 },
  message: CHARACTER_MESSAGE,
  missingInput: "缺少角色设计作者输入",
  missingAck: "真实输入 ack 缺 run_id",
  missingCompleted: "缺少角色设计同一 run 的完成结果",
  completedTurn: "first",
  requireRunMode: "durable",
});

const PLANNING_SPEC = Object.freeze({
  common: {
    sliceId: "b71-authoring-planning",
    minScreenshots: 3,
    minimumWaits: 9,
    allowVerificationFailureMarker: true,
  },
  wire: { minUserMessages: 1, minTurnResults: 2, minProviderStarts: 5 },
  message: PLANNING_MESSAGE,
  missingInput: "缺少计划/重规划真实作者输入",
  missingAck: "真实输入 ack 缺 run_id",
  missingCompleted: "缺少同一计划 run 的完成结果",
  completedTurn: "last",
  requireRunMode: "durable",
});

const FULL_READ_SPEC = Object.freeze({
  common: {
    sliceId: "b71-first-consumer",
    minScreenshots: 2,
    minimumWaits: 6,
    allowVerificationFailureMarker: true,
  },
  wire: { minUserMessages: 1, minTurnResults: 1, minProviderStarts: 3 },
  message: MESSAGE,
  missingInput: "缺少全章核对作者输入",
  missingAck: "真实输入 ack 缺 run_id",
  missingCompleted: "缺少同一 bounded run 的完成结果",
  completedTurn: "first",
  requireRunMode: "bounded",
});

const failureLabel = (label, gap) => (gap ? `${label} (${gap})` : label);

export function verifyContinuation(dir) {
  const run = collectAuthoringRun(dir, CONTINUATION_SPEC);
  const request = continuationRequestChecks(run.calls.records, run.history.transcript);
  const gap = nativeCallFailureSummary(run.calls);
  const checks = {
    ...continuationOutcomeChecks({
      visible: authoringVisibleText(dir, "03-final"),
      turnResult: run.completed,
      runId: run.runId,
      start: readCheckpoint(dir, "start").db_production_counts,
      final: readCheckpoint(dir, "final").db_production_counts,
      fingerprintUnchanged: fingerprintUnchanged(dir),
    }),
    ...request.checks,
    ...run.calls.checks,
  };
  const measured = {
    parent_turn_id: run.facts.turnId,
    run_id: run.runId,
    recovered_turn_id: run.completed.turn_id,
    ...request.measured,
    native_call: run.calls.measured,
  };
  return finishVerification(dir, {
    checks,
    measured,
    sliceId: "b71-authoring-transcript",
    label: failureLabel("B71 CP4a 原生续行创作", gap),
    successPrefix: "B71 CP4a 原生验收通过",
    extra: verificationExtra({
      checks,
      common: run.common,
      turnId: run.completed.turn_id,
      turnIds: [run.facts.turnId, run.completed.turn_id],
      behavior: {
        native_request: request.measured,
        native_call: run.calls.measured,
      },
    }),
  });
}

export function verifyCharacterDesign(dir) {
  const run = collectAuthoringRun(dir, CHARACTER_SPEC);
  const request = characterRequestChecks(run.calls.records, run.history.transcript);
  const gap = nativeCallFailureSummary(run.calls);
  const checks = {
    ...characterOutcomeChecks({
      visible: authoringVisibleText(dir, "03-candidate"),
      why: authoringVisibleText(dir, "03-final"),
      turnResult: run.completed,
      ackBody: run.ackBody,
      runId: run.runId,
      start: readCheckpoint(dir, "start").db_production_counts,
      final: readCheckpoint(dir, "final").db_production_counts,
      fingerprintUnchanged: fingerprintUnchanged(dir),
      request,
    }),
    ...run.calls.checks,
  };
  const measured = {
    parent_turn_id: run.facts.turnId,
    run_id: run.runId,
    recovered_turn_id: run.completed.turn_id,
    ...request.measured,
    native_call: run.calls.measured,
  };
  return finishVerification(dir, {
    checks,
    measured,
    sliceId: "b71-authoring-profiles",
    label: failureLabel("B71 CP4b 原生角色创作", gap),
    successPrefix: "B71 CP4b 原生角色创作验收通过",
    extra: verificationExtra({
      checks,
      common: run.common,
      turnId: run.completed.turn_id,
      turnIds: [run.facts.turnId, run.completed.turn_id],
      behavior: {
        native_request: request.measured,
        native_call: run.calls.measured,
      },
    }),
  });
}

export function verifyPlanning(dir) {
  const run = collectAuthoringRun(dir, PLANNING_SPEC);
  const protocol = planningProtocolEvidence({
    bodies: requestBodiesOf(run.calls.records),
    messages: run.history.transcript.messages,
    planVersion: run.history.record.plan_version,
    replans: run.history.budget.replans,
    providerCalls: run.history.budget.provider_calls,
  });
  const outcome = planningOutcomeChecks({
    visible: authoringVisibleText(dir, "03-candidate"),
    why: authoringVisibleText(dir, "03-final"),
    ackBody: run.ackBody,
    facts: run.facts,
    results: run.results,
    durable: run.history,
    wire: run.wire,
    start: readCheckpoint(dir, "start"),
    final: readCheckpoint(dir, "final"),
    beforeWhy: readCheckpoint(dir, "before-why"),
    afterWhy: readCheckpoint(dir, "after-why"),
    appRecords: run.evidence.appRecords,
    llmRecords: run.evidence.llmRecords,
    fingerprintUnchanged: fingerprintUnchanged(dir),
  });
  const checks = { ...outcome.checks, ...protocol.checks, ...run.calls.checks };
  const gap = nativeCallFailureSummary(run.calls);
  const measured = {
    parent_turn_id: run.facts.turnId,
    run_id: run.runId,
    completed_turn_id: run.completed.turn_id,
    ...outcome.measured,
    ...protocol.measured,
    native_call: run.calls.measured,
  };
  return finishVerification(dir, {
    checks,
    measured,
    sliceId: "b71-authoring-planning",
    label: failureLabel("B71 计划与重规划原生消费链", gap),
    extra: verificationExtra({
      checks,
      common: run.common,
      turnId: run.completed.turn_id,
      turnIds: [...new Set([run.facts.turnId, ...run.results.map((result) => result.turn_id)])],
      behavior: {
        native_request: protocol.measured,
        native_call: run.calls.measured,
      },
    }),
  });
}

function verifyFullRead(dir) {
  const run = collectAuthoringRun(dir, FULL_READ_SPEC);
  // 探索证据只认本 run 的 owning scope：同 topic、接收方向、实际 run_ref；
  // 同 parent 的其它 bounded run 不贡献探索计数或 queries。
  const exploration = explorationFacts(run.evidence.wire, {
    topic: run.scope.topic,
    runId: run.scope.run_id,
  });
  // 请求规则只消费真实 ACK 的 bounded run 经 pcall 绑定的记录，
  // 不再按 parent turn 文本从整批 LLM 日志中筛选。
  const request = nativeRequestChecks(requestBodiesOf(run.calls.records));
  const gap = nativeCallFailureSummary(run.calls);
  const checks = {
    ...fullReadOutcomeChecks({
      visible: authoringVisibleText(dir, "02-final"),
      lastPageAnchor: LAST_PAGE_ANCHOR,
      explorations: exploration.events,
      turnResult: run.completed,
      start: readCheckpoint(dir, "start").db_production_counts,
      final: readCheckpoint(dir, "final").db_production_counts,
      fingerprintUnchanged: fingerprintUnchanged(dir),
      request,
    }),
    ...run.calls.checks,
  };
  const measured = {
    turn_id: run.facts.turnId,
    completed_turn_id: run.completed.turn_id,
    run_id: run.runId,
    exploration_observed_count: exploration.count,
    page_queries: exploration.queries,
    ...request.measured,
    native_call: run.calls.measured,
  };
  return finishVerification(dir, {
    checks,
    measured,
    sliceId: "b71-first-consumer",
    label: failureLabel("B71 原生全章核对", gap),
    successPrefix: "B71 原生验收通过",
    extra: verificationExtra({
      checks,
      common: run.common,
      turnId: run.completed.turn_id,
      turnIds: [...new Set([run.facts.turnId, run.completed.turn_id])],
      behavior: {
        native_request: request.measured,
        native_call: run.calls.measured,
      },
    }),
  });
}

const JOURNEY_VERIFIERS = Object.freeze({
  continuation: verifyContinuation,
  "character-design": verifyCharacterDesign,
  planning: verifyPlanning,
  "full-read": verifyFullRead,
  revision: verifyRevisionBatch,
  pending: verifyPendingBatch,
  live: verifyLiveBatch,
  behavior: verifyBehaviorBatch,
  confirmation: verifyConfirmationBatch,
  "auto-maintenance": verifyAutoMaintenanceBatch,
  "memory-detail": verifyMemoryDetailBatch,
  "answer-mode": verifyAnswerModeBatch,
});

export function verify(dir) {
  const config = readConfig(dir);
  return JOURNEY_VERIFIERS[config.journey](dir);
}

const MODES = Object.freeze({
  prepare: (dir) => prepare(dir),
  // 支持一次传多个 checkpoint（cp4b-confirmation-01f 缺陷：final 是第二个参数时被丢弃）。
  capture: (dir, ...checkpoints) => {
    const config = readConfig(dir);
    assert(checkpoints.length > 0, "capture 需要至少一个 checkpoint");
    for (const checkpoint of checkpoints) {
      if (config.journey === "pending") capturePending(dir, checkpoint);
      else capture(dir, checkpoint);
    }
  },
  verify: (dir) => verify(dir),
});

export function modeHandler(mode, artifact) {
  assert(Object.hasOwn(MODES, mode), `unknown mode: ${mode}`);
  assert(artifact, "usage: node scripts/native_b71_evidence.mjs <prepare|capture|verify> <dir> [checkpoint...]");
  return MODES[mode];
}

export async function main([mode, artifact, ...rest]) {
  return modeHandler(mode, artifact)(path.resolve(artifact), ...rest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
