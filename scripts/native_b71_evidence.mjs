// B71 原生证据核验：只消费隔离批次的真实请求、AX/截图、WS 和只读 DB。
//
// 本文件保持既有 CLI/导出入口，只做薄组合：
// - authoring_capture_evidence：启动前后 prepare/capture 与只读 DB 快照
// - authoring_run_evidence：批次证据读取、纯判据输入归一与结果落盘
// - authoring_scenario_evidence：无 I/O 的场景判据
import assert from "node:assert/strict";
import fs from "node:fs";
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
import {
  broadcastFrames,
  frameBody,
  requestIdentity,
  sentUserMessages,
  transport,
  turnFacts,
} from "./lib/native_ui/scenario_evidence.mjs";

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
  // B71 R2 后续 checkpoint：流式预览页面证据（确定性 test-support provider 经
  // 真实 SSE 发送写作正文）。它不套用 continuation 的 writer-timeout/steer 判据，
  // 只验证「生成中正文预览来自真实正文增量」这一独立事实。
  if (config.provider === "streaming_slice_verify") return verifyStreamPreview(dir);
  return JOURNEY_VERIFIERS[config.journey](dir);
}

function readTextFile(dir, name) {
  const file = path.join(dir, name);
  assert(fs.existsSync(file), `缺少证据文件: ${name}`);
  return fs.readFileSync(file, "utf8");
}

// 产品 turn_result 的 turn_id 可能是发送 turn 的后续步（`<turn>:agent:N` /
// `<turn>:steer:N`）；与驱动侧同一匹配语义，不要求与发送 turn 逐字相等。
function turnIdMatches(actual, expected) {
  return (
    typeof actual === "string" &&
    typeof expected === "string" &&
    expected !== "" &&
    (actual === expected || actual.startsWith(`${expected}:`))
  );
}

const isNonBlank = (value) => typeof value === "string" && value !== "";
const PREVIEW_PROSE_MIN_CHARS = 12;

// 候选已限定在同一 owning topic、终局前、目标 run 的 writer/text chunk。
// 这里只保留同组事件身份与真实 sequence 顺序；正文的连续长度不由 JS 的
// UTF-16 长度推断（Elixir 侧累计长度按 grapheme 计数）。
function writerChunkFacts(record) {
  const body = frameBody(record);
  const payload = body?.payload ?? {};
  assert(isNonBlank(body?.event_id), "writer 增量缺 event_id");
  assert(Number.isInteger(body?.sequence) && body.sequence > 0, "writer 增量缺 sequence");
  assert(isNonBlank(payload.provider_call_ref), "writer 增量缺 provider_call_ref");
  assert(isNonBlank(payload.provider_run_ref), "writer 增量缺 provider_run_ref");
  assert(isNonBlank(payload.author_content_delta), "writer 增量缺 author_content_delta");
  return {
    eventId: body.event_id,
    sequence: body.sequence,
    runId: body.run_id,
    providerCallRef: payload.provider_call_ref,
    providerRunRef: payload.provider_run_ref,
    delta: payload.author_content_delta,
  };
}

// 同一 run 允许存在独立 writer 调用/重试：按 provider_call_ref/provider_run_ref
// 分组，各组的正文只按本组真实 sequence 排列。组间不拼接；是否跨组混用由
// AX 前缀的唯一匹配判定，不额外要求各组 sequence 区间不相交。
function writerChunkGroups(records) {
  const groups = new Map();
  for (const record of records) {
    const chunk = writerChunkFacts(record);
    const key = `${chunk.providerCallRef}\u0000${chunk.providerRunRef}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chunk);
  }
  const ordered = [...groups.values()].map((chunks) => {
    chunks.sort((left, right) => left.sequence - right.sequence);
    assert.equal(
      new Set(chunks.map((chunk) => chunk.eventId)).size,
      chunks.length,
      "同组 writer 增量 event_id 重复",
    );
    for (let index = 1; index < chunks.length; index += 1) {
      assert(chunks[index].sequence > chunks[index - 1].sequence, "同组 writer 增量 sequence 顺序冲突");
    }
    return {
      providerCallRef: chunks[0].providerCallRef,
      providerRunRef: chunks[0].providerRunRef,
      chunks,
      prose: chunks.map((chunk) => chunk.delta).join(""),
    };
  });
  return ordered;
}

const previewProseMatched = (group, preview) => {
  const snippet = group.prose.slice(0, PREVIEW_PROSE_MIN_CHARS);
  return snippet.length === PREVIEW_PROSE_MIN_CHARS && preview.includes(snippet);
};

function verifyStreamPreview(dir) {
  const config = readConfig(dir);
  const ready = JSON.parse(readTextFile(dir, "native-driver-ready.json"));
  assert.equal(ready.provider, "streaming_slice_verify", "预览批次 provider 必须显式注入 streaming_slice_verify");

  const driverLog = JSON.parse(readTextFile(dir, "native-b71-driver-log.json"));
  assert.equal(driverLog.preview_captured, true, "缺少生成中预览采样完成标记");
  assert.equal(driverLog.provider, "streaming_slice_verify", "driver log provider 不一致");

  // 生成中预览：来自真实窗口 AX 文本的「正文生成中」容器 + 未保存提示 + 真实正文片段。
  const previewText = readTextFile(dir, "02-prose-preview.text.txt");
  const previewAx = readTextFile(dir, "02-prose-preview.ax.txt");
  assert(previewText.includes("正文生成中"), "生成中预览容器缺失");
  assert(previewText.includes("生成中，尚未保存为候选。"), "生成中未保存提示缺失");
  assert(!previewText.includes("submit_tentative_artifact"), "预览泄漏工具/协议标识");
  assert(!previewText.includes("item_id"), "预览泄漏 JSON 协议字段");
  assert(previewAx.length > 0, "预览 AX 快照为空");
  assert(fs.existsSync(path.join(dir, "03-final.jpg")), "缺少最终页面截图");

  // 2026-11-08 复审 P1-1：最终完成态必须来自真实 turn_result 事实。旧实现只看
  // b71-final.json 存在，而该文件是 checkpoint 计数快照（无 turn_result），
  // 会用「文件存在」冒充「最终 turn 完成」。这里直接消费 driver 等待到的真实
  // WS turn_result 帧，并交叉核对 driver log 与 assistant 文本。
  const sendTurnId = String(driverLog.turn_id ?? "");
  assert(sendTurnId !== "", "driver log 缺发送 turn_id：无法证明最终 turn_result");

  const wire = transport(dir);
  const message = String(config.message ?? "");
  assert(message !== "", "批次 config 缺作者输入文本，无法绑定发送 turn");
  const sends = sentUserMessages(wire, message);
  assert.equal(sends.length, 1, `发送 turn 必须唯一绑定作者输入，实测: ${sends.length}`);

  // 发送 turn → ACK run → 终局 run 必须闭合在同一 owning topic 上。
  const facts = turnFacts(wire, sends[0]);
  const identity = requestIdentity(sends[0]);
  assert.equal(String(driverLog.turn_id ?? ""), facts.turnId, "driver log turn_id 与真实发送 turn 不一致");
  assert(facts.ack, "真实输入 ACK 缺失或未成功");
  const ackRunId = String(frameBody(facts.ack)?.response?.run_id ?? "");
  assert(ackRunId !== "", "真实输入 ACK 缺 run_id");

  const turnResults = facts.results.filter(
    (entry) => turnIdMatches(String(frameBody(entry)?.turn_id ?? ""), sendTurnId),
  );

  assert.equal(
    turnResults.length,
    1,
    `最终 turn_result 帧必须唯一且绑定发送 turn，实测: ${turnResults.length}`,
  );

  const turnResult = frameBody(turnResults[0]);
  assert.equal(typeof turnResult?.turn_id, "string", "turn_result 缺 turn_id");
  const finalRunId = String(turnResult?.agent_run?.run_id ?? "");
  assert(finalRunId !== "", "最终 turn_result 缺 agent_run.run_id");
  assert.equal(finalRunId, ackRunId, "终局 run 与 ACK run 不一致");
  const assistantText = String(turnResult?.assistant_message?.text ?? "");
  assert(assistantText.trim() !== "", "turn_result 缺 assistant_message.text（完成态无真实回复）");

  if (String(driverLog.assistant_text ?? "") !== "") {
    assert.equal(
      driverLog.assistant_text,
      assistantText,
      "driver log assistant_text 与真实 turn_result 不一致",
    );
  }

  // 预览正文只取同一 owning topic、终局前、目标 run 的 writer/text 正文 chunk。
  // 外来 run、非 writer 或不含作者正文的合法 chunk 全部忽略，不参与拼接。
  // 终局前按 transport 输入顺序切片，避免同毫秒时间戳把先到的 chunk 误判为终局后。
  const finalIndex = wire.indexOf(turnResults[0]);
  assert(finalIndex >= 0, "终局 turn_result 不在传输记录中");
  const progress = broadcastFrames(wire.slice(0, finalIndex), {
    topic: identity.topic,
    at: sends[0].at,
    event: "agent_event",
  }).filter((record) => {
    const body = frameBody(record);
    const payload = body?.payload ?? {};
    return (
      body?.event_type === "provider_progress" &&
      body?.run_id === finalRunId &&
      body?.run_ref === finalRunId &&
      payload.purpose === "writer" &&
      payload.provider_event_type === "chunk" &&
      payload.output_type === "text" &&
      isNonBlank(payload.author_content_delta)
    );
  });
  assert(progress.length > 0, "缺少目标 run 终局前含正文的 writer chunk");

  const groups = writerChunkGroups(progress);
  const chunks = groups.flatMap((group) => group.chunks);
  const matchingGroups = groups.filter((group) => previewProseMatched(group, previewText));
  assert.equal(
    matchingGroups.length,
    1,
    `同源 writer 正文前缀必须唯一命中 AX 采样，实测: ${matchingGroups.length}`,
  );
  const matched = matchingGroups[0];
  const streamedProse = matched.prose;
  const proseSnippet = streamedProse.slice(0, PREVIEW_PROSE_MIN_CHARS);

  // checks 由实际事实计算（不再硬编码 true）；任一缺失即 fail。
  const checks = {
    provider_injected: ready.provider === "streaming_slice_verify",
    preview_captured_during_generation: driverLog.preview_captured === true,
    preview_label_visible: previewText.includes("正文生成中"),
    preview_not_saved_hint_visible: previewText.includes("生成中，尚未保存为候选。"),
    preview_stream_bound_to_final_run:
      finalRunId === ackRunId && chunks.every((chunk) => chunk.runId === finalRunId),
    preview_stream_one_matching_source: matchingGroups.length === 1,
    preview_shows_real_prose:
      proseSnippet.length === PREVIEW_PROSE_MIN_CHARS && previewText.includes(proseSnippet),
    preview_hides_protocol_bytes:
      !previewText.includes("submit_tentative_artifact") && !previewText.includes("item_id"),
    final_turn_result_present:
      turnResults.length === 1 && String(turnResult?.turn_id ?? "") !== "" &&
        assistantText.trim() !== "",
  };

  assert.equal(
    Object.keys(checks).length,
    9,
    "预览 checks 集合不完整：必须覆盖 9 项真实判据",
  );
  assert(
    Object.values(checks).every((value) => value === true),
    `预览证据 checks 未全部成立: ${JSON.stringify(checks)}`,
  );

  const summary = {
    slice_id: config.slice_id,
    surface: "tauri-native",
    driver: "ax-native-system-ui",
    provider: "streaming_slice_verify",
    model: null,
    verified_at: new Date().toISOString(),
    // 判据来源（可审计）：发送 turn/ACK run/终局 run + 命中 AX 的同源 writer 组。
    turn_id: String(turnResult.turn_id),
    run_id: finalRunId,
    provider_call_ref: matched.providerCallRef,
    provider_run_ref: matched.providerRunRef,
    streamed_prose_bytes: Buffer.byteLength(streamedProse, "utf8"),
    preview_prefix_chars: PREVIEW_PROSE_MIN_CHARS,
    checks,
    not_signed: [
      "real_model_streaming_behavior_not_signed",
      "responses_anthropic_real_stream_not_signed",
      "I10_literary_quality_not_signed",
    ],
  };

  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary.checks));
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
