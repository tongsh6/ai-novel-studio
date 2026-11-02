// B71 CP4b pending 对话候选作者边界的真实 wire/DB/log 归集与核验编排。
//
// 本模块只读取隔离批次目录：真实 WS/HTTP 帧、AX/截图、llm-calls、app-log
// 与只读 SQLite；判据全部委托 authoring_pending_evidence。身份读取只按
// 作者消息自己的 join/request 生命周期 + ACK run + 精确 run/session/turn 绑定，
// 不按“最新 run/最新候选/时间就近”猜取。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  axText,
  broadcastFrames,
  checkProductionFingerprint,
  evidenceBoundary,
  frameBody,
  frameOf,
  logs,
  productionTableCounts,
  read,
  seedFields,
  withDb,
  write,
} from "./scenario_evidence.mjs";
import { requestBodiesOf } from "./authoring_scenario_evidence.mjs";
import { authoringScope, readAuthoringHistory } from "./authoring_history_evidence.mjs";
import { joinNativeCallEvidence, readProviderRuns } from "./authoring_call_evidence.mjs";
import { planningCanonSnapshot, readConfig } from "./authoring_capture_evidence.mjs";
import {
  assistantCalls,
  replayPathFor,
  revisionWhyChecks,
} from "./authoring_revision_evidence.mjs";
import { actionResultIdentityFor } from "./adoption_contract.mjs";
import {
  httpPathname,
  replayCapture,
  resumeCapture,
  resumeProjectionChecks,
} from "./native_http_evidence.mjs";
import {
  finishVerification,
  readAssistantInteraction,
  readDecisionTrace,
} from "./authoring_run_evidence.mjs";
import {
  PENDING_CHECKPOINTS,
  PENDING_PROFILE,
  actionAck,
  actionFrame,
  actionLabelsFor,
  actionResult,
  actionTurnResult,
  followupReplyChecks,
  pendingCanonChecks,
  resolvedEntry,
  scopeFactsChecks,
  scopeFactsFromRequest,
  selectPendingAction,
  writerArtifactMatch,
} from "./authoring_pending_evidence.mjs";

const SLICE_ID = "b71-authoring-pending";
const list = (value) => (Array.isArray(value) ? value : []);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const allOf = (...values) => values.every(Boolean);
const get = (value, key) => (value !== null && typeof value === "object" ? value[key] : undefined);

function checkpointPath(dir, name) {
  return path.join(dir, `b71-${name}.json`);
}

export function readPendingCheckpoint(dir, name) {
  return read(dir, `b71-${name}.json`);
}

function countRows(db, sql, params) {
  return Number(all(db, sql, params)[0].n);
}

function uuidText(value) {
  if (value instanceof Uint8Array && value.byteLength === 16) {
    const hex = Buffer.from(value).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return value;
}

function normalizeMemoryRow(row) {
  return {
    ...row,
    id: uuidText(row.id),
    work_id: uuidText(row.work_id),
    source_id: uuidText(row.source_id),
    tags: typeof row.tags === "string" ? parseJsonField(row.tags) : row.tags,
  };
}

function uuidPredicate(column) {
  return `(${column} = ? OR (length(CAST(${column} AS BLOB)) = 16 AND lower(hex(${column})) = ?))`;
}

function uuidParams(value) {
  return [value, String(value).replaceAll("-", "").toLowerCase()];
}

function parseJsonField(value) {
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

function readDbFacts(dir, workId, sessionId) {
  return withDb(dir, (db) => ({
    memory_items: all(
      db,
      `SELECT * FROM memory_items WHERE ${uuidPredicate("work_id")} ORDER BY id`,
      uuidParams(workId),
    ).map(normalizeMemoryRow),
    receipts: all(
      db,
      `SELECT * FROM author_action_receipts WHERE ${uuidPredicate("work_id")} AND ${uuidPredicate("session_id")} ORDER BY inserted_at, id`,
      [...uuidParams(workId), ...uuidParams(sessionId)],
    ).map((row) => ({ ...row, result: parseJsonField(row.result) })),
    db_counts: {
      agent_runs: countRows(db, `SELECT COUNT(*) AS n FROM agent_runs WHERE ${uuidPredicate("work_id")} AND ${uuidPredicate("session_id")}`, [...uuidParams(workId), ...uuidParams(sessionId)]),
      provider_runs: countRows(db, `SELECT COUNT(*) AS n FROM provider_runs WHERE ${uuidPredicate("work_id")} AND ${uuidPredicate("session_id")}`, [...uuidParams(workId), ...uuidParams(sessionId)]),
      interactions: countRows(db, `SELECT COUNT(*) AS n FROM interactions WHERE ${uuidPredicate("workspace_id")} AND ${uuidPredicate("session_id")}`, [...uuidParams(workId), ...uuidParams(sessionId)]),
      decision_traces: countRows(db, `SELECT COUNT(*) AS n FROM decision_traces WHERE ${uuidPredicate("session_id")}`, uuidParams(sessionId)),
    },
  }));
}

function logFacts(dir) {
  const llm = logs(path.join(dir, "llm-calls"));
  const app = logs(path.join(dir, "app-log"));
  return {
    llm_count: llm.length,
    provider_start_count: app.filter((record) => record.event === "provider_gateway.complete.start").length,
  };
}

// pending checkpoint 的唯一写入边界：严格顺序、不得覆盖；每段都保存真实能力事实。
export function capturePending(dir, name) {
  const config = readConfig(dir);
  assert.equal(config.journey, "pending", "pending capture 只属于 b71-authoring-pending");
  const index = PENDING_CHECKPOINTS.indexOf(name);
  assert(index >= 0, `未知 pending checkpoint: ${name}`);
  assert(!fs.existsSync(checkpointPath(dir, name)), `pending checkpoint 不得覆盖: ${name}`);
  if (index > 0) {
    const previous = PENDING_CHECKPOINTS[index - 1];
    assert(fs.existsSync(checkpointPath(dir, previous)), `${name} 必须在 ${previous} 之后登记`);
  }
  const workId = config.target?.work_id;
  const sessionId = config.target?.session_id;
  assert(nonBlank(workId) && nonBlank(sessionId), "pending config 缺 work_id/session_id");
  const facts = readDbFacts(dir, workId, sessionId);
  return write(dir, `b71-${name}.json`, {
    checkpoint: name,
    at: new Date().toISOString(),
    db_production_counts: productionTableCounts(dir),
    canon: planningCanonSnapshot(dir),
    memory_items: facts.memory_items,
    receipts: facts.receipts,
    db_counts: facts.db_counts,
    ...logFacts(dir),
  });
}

function oneUserMessage(wire, text, label) {
  const matches = list(wire).filter(
    (record) =>
      record?.direction === "sent" &&
      Array.isArray(record.frame) &&
      record.frame.length >= 5 &&
      record.frame[3] === "user_message" &&
      frameBody(record)?.text === text,
  );
  assert.equal(matches.length, 1, `${label}: 真实作者输入必须恰好一条，实测 ${matches.length}`);
  return matches[0];
}

function completedForRun(results, runId, label) {
  const matches = list(results).filter(
    (body) => body?.agent_run?.run_id === runId && body?.agent_run?.status === "completed",
  );
  assert.equal(matches.length, 1, `${label}: 同一 run 完成 TurnResult 必须恰好一条，实测 ${matches.length}`);
  return matches[0];
}

function isReplyToMessage(record, identity, since) {
  if (get(record, "direction") !== "received") return false;
  const frame = get(record, "frame");
  if (!Array.isArray(frame) || frame.length < 5) return false;
  if (frame[3] !== "phx_reply") return false;
  if (!allOf(frame[0] === identity[0], frame[1] === identity[1], frame[2] === identity[2])) return false;
  const at = get(record, "at");
  return allOf(typeof at === "string", at >= since);
}

function ackForMessage(wire, sent, label) {
  const identity = frameOf(sent);
  assert(nonBlank(identity[0]) && nonBlank(identity[1]) && nonBlank(identity[2]), `${label}: 作者输入缺请求身份`);
  const matches = list(wire).filter((record) => isReplyToMessage(record, identity, sent.at));
  assert.equal(matches.length, 1, `${label}: 同请求 ACK 必须唯一，实测 ${matches.length}`);
  return matches[0];
}

function readPhaseFacts(dir, evidence, { sent, ackBody, runId, topic, label, workId }) {
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  const results = broadcastFrames(evidence.wire, {
    topic,
    at: sent.at,
    event: "turn_result",
    agentRunId: runId,
  }).map(frameBody);
  const completed = completedForRun(results, runId, label);
  const scope = {
    ...authoringScope(evidence.wire, sent, { workId, parentTurnId: turnId }),
    run_id: runId,
    topic,
  };
  const history = readAuthoringHistory(dir, scope, { requireMode: "bounded" });
  const calls = joinNativeCallEvidence({
    scope,
    transcript: history.transcript,
    providerRuns: readProviderRuns(dir, scope),
    records: evidence.llmRecords,
    consumedProviderCalls: history.budget?.provider_calls,
  });
  const interaction = readAssistantInteraction(dir, {
    workId,
    sessionId: scope.session_id,
    turnId: completed.turn_id,
  });
  assert.equal(
    interaction.content?.agent_run_id,
    runId,
    `${label}: assistant Interaction 的 agent_run_id 与 ACK run 不一致`,
  );
  assert.equal(
    interaction.content?.turn_result?.turn_id,
    completed.turn_id,
    `${label}: Interaction 内 TurnResult 与本轮不一致`,
  );
  return { sent, topic, turnId, runId, completed, scope, history, calls, interaction, ackBody };
}

function acceptedAckRun(evidence, sent, label) {
  const ack = ackForMessage(evidence.wire, sent, label);
  const ackBody = frameBody(ack);
  assert.equal(ackBody?.status, "ok", `${label}: ACK 未成功`);
  const runId = String(ackBody?.response?.run_id ?? "");
  assert(nonBlank(runId), `${label}: ACK 缺 run_id`);
  return { ack, ackBody, runId };
}

function collectPhase(dir, evidence, { text, workId, label }) {
  const sent = oneUserMessage(evidence.wire, text, label);
  const topic = frameOf(sent)[2];
  const turnId = String(frameBody(sent)?.turn_id ?? "");
  assert(nonBlank(turnId), `${label}: 作者输入缺 turn_id`);
  const { ackBody, runId } = acceptedAckRun(evidence, sent, label);
  return readPhaseFacts(dir, evidence, { sent, ackBody, runId, topic, label, workId });
}

function onlyPending(completed, label) {
  const pending = list(completed?.adoption_state?.pending);
  assert.equal(pending.length, 1, `${label}: 必须恰好一个待采纳候选，实测 ${pending.length}`);
  return pending[0];
}

function onlyItem(artifact, label) {
  const items = list(artifact?.payload?.items);
  assert.equal(items.length, 1, `${label}: item 必须恰好一条，实测 ${items.length}`);
  return items[0];
}

function receiptFor(checkpoint, action, label) {
  const matches = list(checkpoint?.receipts).filter((row) => row.action_id === action.action_id);
  assert.equal(matches.length, 1, `${label}: receipt 必须恰好一条，实测 ${matches.length}`);
  return matches[0];
}

function allTrue(checks) {
  return Object.values(checks).every(Boolean);
}

// authority_scope 由 DialoguePlanningService 生成并作为 Ecto map 持久化到
// agent_runs；读取边界只做一次 JSON 解码，后续直接消费 producer 结构。
function parseAuthority(history) {
  return parseJsonField(history.record.authority_scope);
}

function forbiddenTool(name) {
  return /adopt|accept|discard|production|write|register_author_content/iu.test(String(name ?? ""));
}

function runAuthorityChecks(phase, { followup = false } = {}) {
  const authority = parseAuthority(phase.history);
  const record = phase.history.record;
  const allowed = authority.allowed_tools;
  return {
    [`${phase.label}_production_write_disabled`]: authority.production_write === false,
    [`${phase.label}_no_adopt_tool`]: allowed.every((name) => !forbiddenTool(name)),
    [`${phase.label}_profile_bound`]:
      record.profile_ref === PENDING_PROFILE &&
      authority.profile_selection.profile_ref === PENDING_PROFILE,
    ...(followup
      ? { followup_judgment_only: allowed.length === 1 && allowed[0] === "judgment" }
      : {}),
  };
}

function checkpointCountsEqual(before, after) {
  return before.llm_count === after.llm_count &&
    before.provider_start_count === after.provider_start_count &&
    before.db_counts.provider_runs === after.db_counts.provider_runs &&
    before.db_counts.agent_runs === after.db_counts.agent_runs;
}

function canonicalNames(history) {
  return assistantCalls(history.transcript).map((call) => call.name);
}

// writer 候选必须经过应用校验且结果为 passed；failed 的 writer 不能签字节合法。
function writerValidationPassed(history) {
  const writerCalls = assistantCalls(history.transcript)
    .filter((call) => call.name === "submit_tentative_artifact");
  const validations = list(history.transcript.messages)
    .filter((message) => message?.role === "tool")
    .flatMap((message) => list(message.blocks))
    .filter((block) => block?.type === "validation_result");
  return writerCalls.length > 0 && writerCalls.every((call) => {
    const matches = validations.filter((block) => block.call_id === call.call_id);
    return matches.length === 1 && matches[0].status === "passed";
  });
}

function assistantProviderMessage(history) {
  return list(history.transcript.messages).find(
    (message) => message?.role === "assistant" && nonBlank(message.provider_call_ref),
  ) ?? null;
}

function providerRecordFor(records, assistant) {
  const matches = list(records).filter(
    (record) => record.provider_call_ref === assistant.provider_call_ref &&
      record.provider_run_ref === assistant.provider_run_ref,
  );
  return matches.length === 1 ? matches[0] : null;
}

function providerContentFor(history, records) {
  const assistant = assistantProviderMessage(history);
  return assistant === null ? null : providerContentForAssistant(records, assistant);
}

function contentOfProviderRecord(record) {
  return record?.response?.body?.content ?? null;
}

function providerContentForAssistant(records, assistant) {
  const record = providerRecordFor(records, assistant);
  return record === null ? null : contentOfProviderRecord(record);
}

function decisionTracePresent(dir, completed) {
  const traceRef = completed?.trace_summary?.trace_ref;
  if (nonBlank(traceRef)) {
    try {
      readDecisionTrace(dir, { traceId: traceRef, turnId: completed.turn_id });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function textIncludes(dir, name, values) {
  const text = axText(dir, name);
  return values.filter(nonBlank).every((value) => text.includes(value));
}

function readActionEvidence(evidence, checkpoints, source, revision, sourceArtifact, revisionArtifact) {
  const acceptAction = selectPendingAction(revision.completed, {
    artifactId: revisionArtifact.artifact_id,
    actionType: "accept",
  });
  const discardAction = selectPendingAction(source.completed, {
    artifactId: sourceArtifact.artifact_id,
    actionType: "discard",
  });
  const acceptFrame = actionFrame(evidence.wire, {
    topic: revision.topic,
    since: checkpoints["after-revision"].at,
    action: acceptAction,
  });
  const acceptAck = actionAck(evidence.wire, acceptFrame, { actionStatus: "accepted" });
  const acceptResult = actionResult(evidence.wire, {
    topic: revision.topic,
    since: acceptFrame.at,
    action: acceptAction,
    actionStatus: "accepted",
  });
  const acceptTurn = actionTurnResult(evidence.wire, {
    topic: revision.topic,
    since: acceptFrame.at,
    parentTurnRef: revision.completed.turn_id,
  });
  const acceptedEntry = resolvedEntry(frameBody(acceptTurn), revisionArtifact.artifact_id, "ACCEPTED");
  const discardFrame = actionFrame(evidence.wire, {
    topic: source.topic,
    since: checkpoints["after-accept"].at,
    action: discardAction,
  });
  const discardAck = actionAck(evidence.wire, discardFrame, { actionStatus: "discarded" });
  const discardResult = actionResult(evidence.wire, {
    topic: source.topic,
    since: discardFrame.at,
    action: discardAction,
    actionStatus: "discarded",
  });
  const discardTurn = actionTurnResult(evidence.wire, {
    topic: source.topic,
    since: discardFrame.at,
    parentTurnRef: source.completed.turn_id,
  });
  const discardedEntry = resolvedEntry(frameBody(discardTurn), sourceArtifact.artifact_id, "DISCARDED");
  return {
    acceptAction,
    discardAction,
    acceptFrame,
    acceptAck,
    acceptResult,
    acceptTurn,
    acceptedEntry,
    discardFrame,
    discardAck,
    discardResult,
    discardTurn,
    discardedEntry,
  };
}

function readFollowupEvidence(followup, sourceArtifact, revisionArtifact, sourceItem, revisionItem) {
  const bodies = requestBodiesOf(followup.calls.records);
  assert(bodies.length > 0, "followup 缺少同次真实请求");
  const factsList = bodies.map(scopeFactsFromRequest).filter(Boolean);
  assert.equal(factsList.length, 1, `followup scope facts 必须唯一，实测 ${factsList.length}`);
  const facts = factsList[0];
  const scopeChecks = scopeFactsChecks(facts, {
    source: {
      artifact_id: sourceArtifact.artifact_id,
      status: "DISCARDED",
      title: sourceItem.title,
      body: sourceItem.body,
      revision_of: null,
    },
    revision: {
      artifact_id: revisionArtifact.artifact_id,
      status: "ACCEPTED",
      title: revisionItem.title,
      body: revisionItem.body,
      revision_of: sourceArtifact.artifact_id,
    },
  });
  const providerContent = providerContentFor(followup.history, followup.calls.records);
  const replyChecks = followupReplyChecks({
    turnResult: followup.completed,
    providerContent,
    facts,
  });
  return { bodies, facts, scopeChecks, replyChecks };
}

function runIdentityChecks({ source, revision, followup, sourceItem, writer, sourceArtifact, revisionArtifact, discardAction, config }) {
  return {
    source_run_calls_owned: allTrue(source.calls.checks),
    revision_run_calls_owned: allTrue(revision.calls.checks),
    followup_run_calls_owned: allTrue(followup.calls.checks),
    source_run_has_provider_call: source.calls.counts.provider_runs > 0,
    revision_run_has_provider_calls: revision.calls.counts.provider_runs > 0,
    followup_run_has_provider_call: followup.calls.counts.provider_runs > 0,
    source_source_bytes_exact:
      sourceItem.body === config.message &&
      sourceItem.provider_call_ref === `author_input:${source.turnId}`,
    source_has_no_creative_writer: !canonicalNames(source.history).includes("submit_tentative_artifact"),
    revision_writer_bytes_exact: writer.ok,
    revision_writer_validation_passed: writerValidationPassed(revision.history),
    revision_of_source: revisionArtifact.payload.revision_of === sourceArtifact.artifact_id,
    revision_pending_only_revision:
      revision.completed.adoption_state.pending.length === 1 &&
      revision.completed.adoption_state.pending[0].artifact_id === revisionArtifact.artifact_id,
    source_action_available_after_revision: discardAction.source_turn_ref === source.completed.turn_id,
    runs_are_distinct: new Set([source.runId, revision.runId, followup.runId]).size === 3,
    ...runAuthorityChecks(source),
    ...runAuthorityChecks(revision),
    ...runAuthorityChecks(followup, { followup: true }),
  };
}

function acceptActionChecks(actions, checkpoints, revisionArtifact, acceptReceipt) {
  const expected = actionResultIdentityFor(actions.acceptAction);
  const result = get(acceptReceipt, "result");
  return {
    accept_action_ack_bound: allOf(
      actions.acceptAck.response.action_status === "accepted",
      actions.acceptResult.frame[4].action_id === expected?.action_id,
      actions.acceptResult.frame[4].action_type === expected?.action_type,
    ),
    accept_action_result_exact: allOf(
      actions.acceptResult.frame[4].artifact_id === revisionArtifact.artifact_id,
      actions.acceptedEntry.artifact_id === revisionArtifact.artifact_id,
    ),
    accept_receipt_bound: allOf(
      acceptReceipt.status === "accepted",
      get(result, "action_id") === expected?.action_id,
      get(result, "action_type") === expected?.action_type,
      get(result, "decision") === "ACCEPTED",
      get(result, "artifact_id") === revisionArtifact.artifact_id,
      get(get(result, "persistence"), "memory_status") === "CONFIRMED",
      get(get(result, "persistence"), "persisted") === true,
    ),
    accept_zero_provider_calls: checkpointCountsEqual(checkpoints["after-revision"], checkpoints["after-accept"]),
  };
}

function discardActionChecks(actions, checkpoints, sourceArtifact, discardReceipt) {
  const expected = actionResultIdentityFor(actions.discardAction);
  const result = get(discardReceipt, "result");
  return {
    discard_action_ack_bound: allOf(
      actions.discardAck.response.action_status === "discarded",
      actions.discardResult.frame[4].action_id === expected?.action_id,
      actions.discardResult.frame[4].action_type === expected?.action_type,
    ),
    discard_action_result_exact: allOf(
      actions.discardResult.frame[4].artifact_id === sourceArtifact.artifact_id,
      actions.discardedEntry.artifact_id === sourceArtifact.artifact_id,
    ),
    discard_receipt_bound: allOf(
      discardReceipt.status === "discarded",
      get(result, "action_id") === expected?.action_id,
      get(result, "action_type") === expected?.action_type,
      get(result, "decision") === "DISCARDED",
      get(result, "artifact_id") === sourceArtifact.artifact_id,
    ),
    discard_zero_provider_calls: checkpointCountsEqual(checkpoints["after-accept"], checkpoints["after-discard"]),
  };
}

function actionChecks(actions, checkpoints, sourceArtifact, revisionArtifact) {
  const acceptReceipt = receiptFor(checkpoints["after-accept"], actions.acceptAction, "accept");
  const discardReceipt = receiptFor(checkpoints["after-discard"], actions.discardAction, "discard");
  return {
    checks: {
      ...acceptActionChecks(actions, checkpoints, revisionArtifact, acceptReceipt),
      ...discardActionChecks(actions, checkpoints, sourceArtifact, discardReceipt),
    },
    acceptReceipt,
    discardReceipt,
  };
}

function whyReplayBound(evidence, checkpoints, revision, workId, sessionId) {
  const from = checkpoints["after-revision"].at;
  const to = checkpoints["after-why"].at;
  const expectedPath = replayPathFor({
    workId,
    sessionId,
    turnId: revision.completed.turn_id,
  });
  const existing = revisionWhyChecks({
    wire: evidence.wire,
    workId,
    sessionId,
    childTurnId: revision.completed.turn_id,
    beforeWhy: { at: from },
    afterWhy: { at: to },
  });
  const capture = replayCapture(evidence.wire, {
    workId,
    sessionId,
    turnId: revision.completed.turn_id,
    from,
    to,
  });
  return (
    existing.why_uses_scoped_persisted_replay &&
    capture.ok &&
    capture.body?.work_id === workId &&
    capture.body?.session_id === sessionId &&
    capture.body?.turn_id === revision.completed.turn_id &&
    httpPathname(capture.record.path) === expectedPath
  );
}

function uiAndWhyChecks(dir, evidence, checkpoints, revision, sourceItem, revisionItem, sourceArtifact, workId, sessionId) {
  const whyText = axText(dir, "04-why");
  const whyRefs = [
    ...revision.calls.refs.provider_call_refs,
    ...revision.calls.refs.provider_run_refs,
  ];
  return {
    why_replay_persisted:
      whyText.includes("参考来源") &&
      whyText.includes("不会重新调用模型") &&
      whyRefs.every((ref) => !whyText.includes(ref)),
    why_replay_scoped_http: whyReplayBound(evidence, checkpoints, revision, workId, sessionId),
    why_zero_provider_calls: checkpointCountsEqual(checkpoints["before-why"], checkpoints["after-why"]),
    accept_after_why_zero_provider_calls:
      checkpointCountsEqual(checkpoints["after-why"], checkpoints["after-accept"]),
    source_visible_before_revision: textIncludes(dir, "after-source", [sourceItem.title, sourceItem.body]),
    both_candidates_visible_after_revision: textIncludes(dir, "after-revision", [
      sourceItem.title,
      sourceItem.body,
      revisionItem.title,
      revisionItem.body,
    ]),
    original_visible_after_accept: textIncludes(dir, "after-accept", [
      sourceItem.title,
      sourceItem.body,
      revisionItem.body,
      actionLabelsFor(sourceArtifact.artifact_type).discard,
    ]),
    accepted_visible_after_discard: textIncludes(dir, "after-discard", [revisionItem.body]),
    accepted_visible_after_restore: textIncludes(dir, "after-restore", [revisionItem.body]),
  };
}

function restoreDriverFacts(dir) {
  try {
    return read(dir, "native-b71-driver-log.json");
  } catch {
    return null;
  }
}

function restoreProjection(resume, { workId, sessionId, sourceArtifact, revisionArtifact, sourceItem, revisionItem }) {
  if (!resume.ok) return {};
  return resumeProjectionChecks(resume.body, {
    workId,
    sessionId,
    source: {
      artifact_id: sourceArtifact.artifact_id,
      status: "DISCARDED",
      title: sourceItem.title,
      body: sourceItem.body,
      revision_of: null,
    },
    revision: {
      artifact_id: revisionArtifact.artifact_id,
      status: "ACCEPTED",
      title: revisionItem.title,
      body: revisionItem.body,
      revision_of: sourceArtifact.artifact_id,
    },
  });
}

function restoreUiChecks(dir, driver, revisionItem) {
  return {
    restore_ui_resolved_not_actionable: driver?.restore?.resolved_non_actionable === true,
    restore_ui_visible_resolved:
      driver?.restore?.revision_body_visible === true &&
      textIncludes(dir, "after-restore", [revisionItem.body]),
  };
}

function restoreRuntimeChecks(dir, checkpoints, followup) {
  const afterDiscard = checkpoints["after-discard"];
  const afterRestore = checkpoints["after-restore"];
  const final = checkpoints.final;
  const followupReply = followup.completed.assistant_message?.text ?? "";
  return {
    restore_zero_provider_calls: checkpointCountsEqual(afterDiscard, afterRestore),
    followup_new_run_and_provider:
      final.db_counts.agent_runs === afterRestore.db_counts.agent_runs + 1 &&
      final.db_counts.provider_runs > afterRestore.db_counts.provider_runs,
    followup_reply_visible:
      nonBlank(followupReply) && textIncludes(dir, "08-final", [followupReply]),
    production_fingerprint_unchanged: checkProductionFingerprint(dir).unchanged,
  };
}

function restoreChecks(dir, evidence, checkpoints, followup, sessionId, workId, sourceArtifact, revisionArtifact, sourceItem, revisionItem) {
  const resume = resumeCapture(evidence.wire, {
    workId,
    from: checkpoints["after-discard"].at,
    to: followup.sent.at,
  });
  return {
    restore_resume_http: resume.ok,
    restore_resume_body_complete: resume.ok && resume.record.body_state?.json === "valid",
    restore_same_session:
      frameBody(followup.sent)?.session_id === sessionId &&
      followup.scope.session_id === sessionId,
    ...restoreProjection(resume, {
      workId,
      sessionId,
      sourceArtifact,
      revisionArtifact,
      sourceItem,
      revisionItem,
    }),
    ...restoreUiChecks(dir, restoreDriverFacts(dir), revisionItem),
    ...restoreRuntimeChecks(dir, checkpoints, followup),
  };
}

function followupChecks(followup, followupEvidence, source, revision) {
  const requestBody = followupEvidence.bodies[0];
  const requestRoles = requestBody.messages.map((message) => message.role);
  const followupCallNames = canonicalNames(followup.history);
  return {
    followup_request_is_new_boundary:
      requestRoles.every((role) => role !== "assistant" && role !== "tool") &&
      !followupCallNames.includes("submit_tentative_artifact") &&
      !followupCallNames.some((name) => forbiddenTool(name)),
    followup_pending_empty: followup.completed.adoption_state.pending.length === 0,
    followup_decision_trace_present: decisionTracePresent(followup.dir, followup.completed),
    followup_run_distinct: followup.runId !== source.runId && followup.runId !== revision.runId,
  };
}

export function verifyPendingBatch(dir) {
  const config = readConfig(dir);
  assert.equal(config.slice_id, SLICE_ID, "pending verifier 只接受 b71-authoring-pending");
  assert.equal(config.journey, "pending", "pending verifier 只接受 pending journey");
  const common = assertCommonEvidence(dir, {
    sliceId: SLICE_ID,
    minScreenshots: 8,
    minimumWaits: 12,
    requiredKinds: ["input", "ack", "turn", "maintenance", "restore"],
  });
  const evidence = assertProviderAndWire(dir, {
    minUserMessages: 3,
    minTurnResults: 5,
    minProviderStarts: 3,
  });
  const workId = config.target?.work_id;
  const sessionId = config.target?.session_id;
  assert(nonBlank(workId) && nonBlank(sessionId), "pending config 缺 work_id/session_id");
  const checkpoints = Object.fromEntries(
    PENDING_CHECKPOINTS.map((name) => [name, readPendingCheckpoint(dir, name)]),
  );
  const source = { ...collectPhase(dir, evidence, { text: config.message, workId, label: "source" }), label: "source" };
  const revision = { ...collectPhase(dir, evidence, { text: config.revision_message, workId, label: "revision" }), label: "revision" };
  const followup = { ...collectPhase(dir, evidence, { text: config.followup_message, workId, label: "followup" }), label: "followup", dir };
  const sourceArtifact = onlyPending(source.completed, "source");
  const revisionArtifact = onlyPending(revision.completed, "revision");
  const sourceItem = onlyItem(sourceArtifact, "source artifact");
  const revisionItem = onlyItem(revisionArtifact, "revision artifact");
  const writer = writerArtifactMatch({ artifact: revisionArtifact, records: revision.calls.records });
  const actions = readActionEvidence(evidence, checkpoints, source, revision, sourceArtifact, revisionArtifact);
  const canon = pendingCanonChecks(checkpoints, {
    workId,
    sourceArtifact,
    revisionArtifact,
    acceptAction: actions.acceptAction,
    discardAction: actions.discardAction,
  });
  const followupEvidence = readFollowupEvidence(followup, sourceArtifact, revisionArtifact, sourceItem, revisionItem);
  const action = actionChecks(actions, checkpoints, sourceArtifact, revisionArtifact);

  const checks = {
    ...runIdentityChecks({ source, revision, followup, sourceItem, writer, sourceArtifact, revisionArtifact, discardAction: actions.discardAction, config }),
    ...action.checks,
    ...canon.checks,
    ...uiAndWhyChecks(dir, evidence, checkpoints, revision, sourceItem, revisionItem, sourceArtifact, workId, sessionId),
    ...restoreChecks(dir, evidence, checkpoints, followup, sessionId, workId, sourceArtifact, revisionArtifact, sourceItem, revisionItem),
    ...followupChecks(followup, followupEvidence, source, revision),
    ...followupEvidence.scopeChecks.checks,
    ...Object.fromEntries(Object.entries(followupEvidence.replyChecks).map(([key, value]) => [`followup_${key}`, value])),
  };

  const failed = Object.keys(checks).filter((key) => !checks[key]);
  assert.equal(failed.length, 0, `B71 pending 原生断言失败: ${failed.join(", ")}`);
  const measured = {
    work_id: workId,
    session_id: sessionId,
    runs: { source: source.runId, revision: revision.runId, followup: followup.runId },
    turn_results: {
      source: source.completed.turn_id,
      revision: revision.completed.turn_id,
      followup: followup.completed.turn_id,
      accept: frameBody(actions.acceptTurn).turn_id,
      discard: frameBody(actions.discardTurn).turn_id,
    },
    source_artifact_id: sourceArtifact.artifact_id,
    revision_artifact_id: revisionArtifact.artifact_id,
    accept_action_id: actions.acceptAction.action_id,
    discard_action_id: actions.discardAction.action_id,
    receipt_ids: { accept: action.acceptReceipt.id, discard: action.discardReceipt.id },
    provider_calls: {
      source: source.calls.counts,
      revision: revision.calls.counts,
      followup: followup.calls.counts,
    },
    writer_match: writer,
    canon: canon.measured,
    followup_scope: followupEvidence.scopeChecks.measured,
    followup_reply: followupEvidence.replyChecks,
    checkpoints: Object.fromEntries(
      PENDING_CHECKPOINTS.map((name) => [name, checkpoints[name].at]),
    ),
  };
  return finishVerification(dir, {
    checks,
    measured,
    sliceId: SLICE_ID,
    label: "B71 CP4b 对话候选作者边界",
    successPrefix: "B71 CP4b 对话候选作者边界验收通过",
    extra: {
      turn_id: source.completed.turn_id,
      turn_ids: [
        source.completed.turn_id,
        revision.completed.turn_id,
        frameBody(actions.acceptTurn).turn_id,
        frameBody(actions.discardTurn).turn_id,
        followup.completed.turn_id,
      ],
      behavior: {
        assertions: Object.keys(checks).filter((key) => checks[key]),
        native_request: { followup_scope: followupEvidence.scopeChecks.measured },
        native_call: measured.provider_calls,
      },
      evidence_boundary: evidenceBoundary(),
      wait_ledger: common.ledger,
      screenshots: common.ui.screenshots,
    },
  });
}
