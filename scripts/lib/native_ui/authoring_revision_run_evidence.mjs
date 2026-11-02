// B71 质量发现→局部修订原生批次的采集/编排边界。
//
// 本模块把真实 WS、同次请求/响应、只读 DB 与 canon 快照归一为纯判据输入；
// 不判断页面是否通过（纯判据在 authoring_revision_evidence），也不改写产品。
import assert from "node:assert/strict";
import {
  assertCommonEvidence,
  assertProviderAndWire,
  broadcastFrames,
  frameBody,
  frameOf,
  turnFacts,
} from "./scenario_evidence.mjs";
import {
  compareRevisionDesignSnapshots,
  compareSourceDesignSnapshots,
} from "./authoring_canon_evidence.mjs";
import { chapterMissionSourceChecks } from "./authoring_chapter_mission_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import { providerFreeInterval } from "./authoring_planning_evidence.mjs";
import {
  authoringScope,
  readAuthoringHistory,
} from "./authoring_history_evidence.mjs";
import {
  joinNativeCallEvidence,
  readProviderRuns,
} from "./authoring_call_evidence.mjs";
import {
  authoringVisibleText,
  finishVerification,
  fingerprintUnchanged,
  readActionReceipt,
  readAssistantInteraction,
  readCheckpoint,
  readDecisionTrace,
  verificationExtra,
} from "./authoring_run_evidence.mjs";
import {
  REVISION_CHAPTER_TITLE,
  actionResultFor,
  authorActionAck,
  childRunStates,
  childTurnResults,
  revisionActionFrame,
  revisionArtifactChecks,
  revisionDecisionEvents,
  revisionRunChecks,
  revisionUiChecks,
  revisionWhyChecks,
  retryExchangeChecks,
  sourceGenerationMessage,
  sourceMissionEvents,
} from "./authoring_revision_evidence.mjs";

const REVISION_SPEC = Object.freeze({
  common: {
    sliceId: "b71-authoring-revision",
    minScreenshots: 4,
    minimumWaits: 10,
    allowVerificationFailureMarker: true,
  },
  wire: { minUserMessages: 1, minTurnResults: 2, minProviderStarts: 3 },
});

const get = (value, key) =>
  value !== null && typeof value === "object" ? value[key] : undefined;
const getIn = (value, keys) => keys.reduce((current, key) => get(current, key), value);
const list = (value) => (Array.isArray(value) ? value : []);
const stringValue = (value) => (typeof value === "string" ? value : "");
const nullIfUndefined = (value) => (value === undefined ? null : value);

function parseJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function revisionOnlyAuthority(record) {
  const tools = list(get(parseJson(get(record, "authority_scope")), "allowed_tools"));
  return tools.length === 1 && tools[0] === "prose_writing";
}

function disjointRefs(sourceRefs, childRefs) {
  return childRefs.every((ref) => !sourceRefs.has(ref));
}

function revisionProductionCountsChangedOnlyReceipt(start, final) {
  if (!start || !final) return false;
  return Object.keys(start).every((table) => {
    if (table === "author_action_receipts") return final[table] === start[table] + 1;
    return final[table] === start[table];
  });
}

function isLocalFinding(finding) {
  return (get(finding, "revision_scope") || get(finding, "impact_scope")) === "local";
}

function localRevisionFinding(result) {
  const findings = getIn(result, ["quality_review", "findings"]);
  if (!Array.isArray(findings)) return null;
  return findings.every(isLocalFinding) ? findings[0] : null;
}

function validFindingRef(ref) {
  return typeof ref === "string" && ref.trim() !== "";
}

function findingRefsOf(result) {
  return list(getIn(result, ["quality_review", "findings"]))
    .map((finding) => get(finding, "quality_finding_id"))
    .filter(validFindingRef);
}

function hasRevisionSource(body, sourceRunId, sourceUserTurnId) {
  return (
    getIn(body, ["agent_run", "run_id"]) === sourceRunId &&
    getIn(body, ["agent_run", "parent_turn_ref"]) === sourceUserTurnId &&
    getIn(body, ["quality_review", "review_status"]) === "completed" &&
    list(getIn(body, ["adoption_state", "pending"])).some(
      (artifact) => get(artifact, "artifact_type") === "prose_fragment",
    ) &&
    list(get(body, "available_actions")).some(
      (action) => get(action, "action_type") === "revise_from_findings",
    )
  );
}

function sourceQualityTurnResult(results, sourceRunId, sourceUserTurnId) {
  const matches = results.filter((body) =>
    hasRevisionSource(body, sourceRunId, sourceUserTurnId),
  );
  if (matches.length !== 1) {
    throw new Error(`revision_source_result: 同一 source run 的质量修订结果必须恰好一条，实测 ${matches.length}`);
  }
  return matches[0];
}

function pendingProse(result) {
  return list(getIn(result, ["adoption_state", "pending"])).find(
    (artifact) => get(artifact, "artifact_type") === "prose_fragment",
  );
}

function originalArtifact(turnResult, artifactId) {
  return list(getIn(turnResult, ["adoption_state", "pending"])).find(
    (artifact) => get(artifact, "artifact_id") === artifactId,
  );
}

function joinNativeCalls(dir, scope, history, records) {
  return joinNativeCallEvidence({
    scope,
    transcript: history.transcript,
    providerRuns: readProviderRuns(dir, scope),
    records,
    consumedProviderCalls: get(history.budget, "provider_calls"),
  });
}

function collectSource(dir, wire, { workId, chapterTitle, readyAt, records }) {
  const sent = sourceGenerationMessage(wire, { chapterTitle, since: readyAt });
  const sourceFacts = turnFacts(wire, sent);
  const sourceUserTurnId = sourceFacts.turnId;
  const sourceRunId = stringValue(get(get(frameBody(sourceFacts.ack), "response"), "run_id"));
  assert(sourceRunId, "revision: source ACK 缺 run_id");
  const topic = frameOf(sent)[2];
  const scope = {
    ...authoringScope(wire, sent, { workId, parentTurnId: sourceUserTurnId }),
    run_id: sourceRunId,
  };
  const history = readAuthoringHistory(dir, scope, { requireMode: "bounded" });
  const calls = joinNativeCalls(dir, scope, history, records);
  const results = broadcastFrames(wire, {
    topic,
    at: sent.at,
    event: "turn_result",
    agentRunId: sourceRunId,
  }).map(frameBody);
  const result = sourceQualityTurnResult(results, sourceRunId, sourceUserTurnId);
  const sourceTurnId = stringValue(get(result, "turn_id"));
  const original = pendingProse(result);
  assert(original, "revision: source 结果缺待采纳正文候选");
  const finding = localRevisionFinding(result);
  assert(finding, "revision: 源质量复核不是全部 local，不能验证局部修订");
  const refs = findingRefsOf(result);
  assert(refs.length > 0, "revision: source findings 缺 quality_finding_id");
  return {
    sent,
    sourceUserTurnId,
    sourceRunId,
    topic,
    scope,
    history,
    sourceTurnId,
    result,
    original,
    artifactId: stringValue(get(original, "artifact_id")),
    finding,
    refs,
    calls,
  };
}

function collectAction(wire, source) {
  const actionFrame = revisionActionFrame(wire, {
    topic: source.topic,
    since: source.sent.at,
    sourceTurnRef: source.sourceTurnId,
    targetRef: source.artifactId,
  });
  const action = get(frameBody(actionFrame), "action");
  const ack = authorActionAck(wire, actionFrame);
  const ackResponse = ack.response;
  const childRunId = stringValue(get(ackResponse, "run_id"));
  const receiptId = stringValue(get(ackResponse, "receipt_id"));
  assert(childRunId && receiptId, "revision: author_action ACK 缺 run/receipt");
  const actionResult = actionResultFor(wire, {
    receiptId,
    runId: childRunId,
    sourceTurnRef: source.sourceTurnId,
    targetRef: source.artifactId,
    topic: source.topic,
    at: actionFrame.at,
  });
  return { actionFrame, action, ack, ackResponse, childRunId, receiptId, actionResult };
}

const childWindow = (source, action) => ({ topic: source.topic, at: action.actionFrame.at });

function completedChildResult(wire, childRunId, window) {
  const results = childTurnResults(wire, childRunId, window).filter(
    ({ body }) => getIn(body, ["agent_run", "status"]) === "completed",
  );
  assert.equal(
    results.length,
    1,
    `revision: child completed turn_result 必须恰好一条，实测 ${results.length}`,
  );
  return results[0].body;
}

function completedChildState(wire, childRunId, window) {
  const state = childRunStates(wire, childRunId, window).find(
    ({ body }) => get(body, "status") === "completed",
  );
  assert(state, "revision: 缺 child run completed agent_run_state");
  return state.body;
}

function childScopeFor(source, childRunId) {
  return {
    run_id: childRunId,
    workspace_id: source.scope.workspace_id,
    work_id: source.scope.work_id,
    session_id: source.scope.session_id,
    parent_turn_ref: source.sourceTurnId,
  };
}

function collectChild(dir, wire, evidence, source, action) {
  const window = childWindow(source, action);
  const state = completedChildState(wire, action.childRunId, window);
  const result = completedChildResult(wire, action.childRunId, window);
  const childTurnId = stringValue(get(result, "turn_id"));
  const scope = childScopeFor(source, action.childRunId);
  const history = readAuthoringHistory(dir, scope, { requireMode: "bounded" });
  const calls = joinNativeCalls(dir, scope, history, evidence.llmRecords);
  const sourceRefs = new Set([
    ...source.calls.refs.provider_run_refs,
    ...source.calls.refs.provider_call_refs,
  ]);
  const childRefs = [
    ...calls.refs.provider_call_refs,
    ...calls.refs.provider_run_refs,
  ];
  const originalBody = getIn(source.original, ["payload", "items", 0, "body"]);
  assert(typeof originalBody === "string", "revision: source 候选缺正文字节");
  const retry = retryExchangeChecks({
    transcript: history.transcript,
    records: calls.records,
    originalBody,
    findingInstruction: getIn(source.finding, ["suggested_revision", "instruction"]),
  });
  return {
    state,
    result,
    childTurnId,
    scope,
    history,
    calls,
    retry,
    sourceRefsDisjoint: disjointRefs(sourceRefs, childRefs),
  };
}

function collectArtifact(dir, source, action, child) {
  const sourceInteraction = readAssistantInteraction(dir, {
    workId: source.scope.work_id,
    sessionId: source.scope.session_id,
    turnId: source.sourceTurnId,
  });
  const sourceDbOriginal = originalArtifact(
    get(sourceInteraction.content, "turn_result"),
    source.artifactId,
  );
  assert(sourceDbOriginal, "revision: 持久 source 候选缺失");
  const childInteraction = readAssistantInteraction(dir, {
    workId: source.scope.work_id,
    sessionId: source.scope.session_id,
    turnId: child.childTurnId,
  });
  const artifact = revisionArtifactChecks({
    sourceOriginal: sourceDbOriginal,
    sourceWireOriginal: source.original,
    childTurnResult: child.result,
    lastLegalResponse: child.retry.lastLegalResponse,
    lastLegalArguments: child.retry.secondArguments,
    sourceFinding: source.finding,
    actionPayload: get(action.action, "payload"),
    sourceTurnId: source.sourceTurnId,
    sourceArtifactId: source.artifactId,
    selectedRefs: source.refs,
  });
  return { sourceInteraction, sourceDbOriginal, childInteraction, artifact };
}

function collectRun(dir, wire, source, action, child) {
  const traceRef = stringValue(getIn(child.result, ["trace_summary", "trace_ref"]));
  assert(traceRef, "revision: child turn_result 缺 trace_ref");
  const decisionTrace = readDecisionTrace(dir, {
    traceId: traceRef,
    turnId: child.childTurnId,
  });
  const receiptRow = readActionReceipt(dir, {
    receiptId: action.receiptId,
    workId: source.scope.work_id,
    sessionId: source.scope.session_id,
  });
  const childInteraction = readAssistantInteraction(dir, {
    workId: source.scope.work_id,
    sessionId: source.scope.session_id,
    turnId: child.childTurnId,
  });
  const runChecks = revisionRunChecks({
    sourceRunId: source.sourceRunId,
    childRunId: action.childRunId,
    sourceTurnId: source.sourceTurnId,
    childTurnId: child.childTurnId,
    sourceUserTurnId: source.sourceUserTurnId,
    sourceRecord: source.history.record,
    childRecord: child.history.record,
    childState: child.state,
    childTurnResult: child.result,
    receiptId: action.receiptId,
    receiptRow,
    ackResponse: action.ackResponse,
    actionResult: action.actionResult,
    actionAck: action.ack,
    childInteraction: childInteraction.content,
    decisionTrace,
    childTurnResultsCount: childTurnResults(
      wire,
      action.childRunId,
      childWindow(source, action),
    ).filter(
      ({ body }) => getIn(body, ["agent_run", "status"]) === "completed",
    ).length,
    actionEvents: revisionDecisionEvents(wire, source.topic, action.actionFrame.at),
  });
  return { traceRef, decisionTrace, receiptRow, childInteraction, runChecks };
}

const isCounts = (value) => value !== null && typeof value === "object";

function countsUnchanged(start, final) {
  // 缺任一侧计数快照都不得放行，避免 Object.keys(undefined) 变成崩溃而不是检查失败。
  if (!isCounts(start) || !isCounts(final)) return false;
  return Object.keys(start).every((table) => final[table] === start[table]);
}

function targetChapterId(source) {
  const ref = get(source.original, "target_chapter_ref");
  assert(
    typeof ref === "string" && ref.startsWith("chapter:") && ref.length > "chapter:".length,
    "revision: source 候选缺真实 target_chapter_ref",
  );
  return ref.slice("chapter:".length);
}

function collectCanon(dir, source) {
  const start = readCheckpoint(dir, "start");
  const before = readCheckpoint(dir, "before-revision");
  const final = readCheckpoint(dir, "final");
  return {
    start,
    before,
    final,
    sourceDesign: compareSourceDesignSnapshots(
      start.authoring_canon,
      before.authoring_canon,
      { targetChapterId: targetChapterId(source) },
    ),
    revisionDesign: compareRevisionDesignSnapshots(
      before.authoring_canon,
      final.authoring_canon,
    ),
    sourceCountsUnchanged: countsUnchanged(
      start.db_production_counts,
      before.db_production_counts,
    ),
    countsOnlyReceipt: revisionProductionCountsChangedOnlyReceipt(
      before.db_production_counts,
      final.db_production_counts,
    ),
    fingerprint: fingerprintUnchanged(dir),
  };
}

function collectMission(wire, source, canon) {
  const targetId = targetChapterId(source);
  return chapterMissionSourceChecks({
    startChapter: canon.start.authoring_canon.chapters[targetId],
    beforeChapter: canon.before.authoring_canon.chapters[targetId],
    targetChapterId: targetId,
    targetChapterRef: get(source.original, "target_chapter_ref"),
    artifactTargetChapter: get(source.original, "target_chapter"),
    sourceWorkId: source.scope.work_id,
    sourceRunId: source.sourceRunId,
    sourceRunRecord: source.history.record,
    transcript: source.history.transcript,
    records: source.calls.records,
    joinedRefs: source.calls.refs,
    missionEvents: sourceMissionEvents(wire, {
      topic: source.topic,
      since: source.sent.at,
      runId: source.sourceRunId,
    }).map(frameBody),
    window: {
      startAt: canon.start.authoring_canon.at,
      beforeAt: canon.before.authoring_canon.at,
    },
  });
}

function collectWhy(dir, wire, evidence, source, child) {
  const beforeWhy = readCheckpoint(dir, "before-why");
  const afterWhy = readCheckpoint(dir, "after-why");
  const why = authoringVisibleText(dir, "04-why");
  return {
    beforeWhy,
    afterWhy,
    why,
    checks: {
      ...revisionWhyChecks({
        wire,
        workId: source.scope.work_id,
        sessionId: source.scope.session_id,
        childTurnId: child.childTurnId,
        beforeWhy,
        afterWhy,
      }),
      why_does_not_call_provider: providerFreeInterval({
        appRecords: evidence.appRecords,
        llmRecords: evidence.llmRecords,
        start: get(beforeWhy, "at"),
        end: get(afterWhy, "at"),
      }),
    },
  };
}

function prefixedChecks(prefix, checks) {
  return Object.fromEntries(
    Object.entries(checks).map(([key, value]) => [`${prefix}_${key}`, value]),
  );
}

function batchChecks({ source, child, artifact, run, why, canon, mission, uiChecks }) {
  return {
    child_canonical_excludes_source_run_refs: child.sourceRefsDisjoint,
    child_authority_scope_is_revision_only:
      revisionOnlyAuthority(child.history.record),
    ...child.retry.checks,
    ...artifact.artifact.checks,
    ...run.runChecks,
    ...why.checks,
    production_counts_unchanged_through_source: canon.sourceCountsUnchanged,
    production_counts_change_only_action_receipt: canon.countsOnlyReceipt,
    production_sources_unchanged: canon.fingerprint,
    ...uiChecks,
    ...prefixedChecks("source", {
      ...canon.sourceDesign.checks,
      ...mission.checks,
      ...source.calls.checks,
    }),
    ...prefixedChecks("revision", canon.revisionDesign.checks),
    ...prefixedChecks("child", child.calls.checks),
  };
}

function batchMeasured({ source, action, child, artifact, canon, mission, why }) {
  return {
    source_user_turn_id: source.sourceUserTurnId,
    source_run_id: source.sourceRunId,
    source_turn_id: source.sourceTurnId,
    source_artifact_id: source.artifactId,
    child_run_id: action.childRunId,
    child_turn_id: child.childTurnId,
    receipt_id: action.receiptId,
    ...child.retry.measured,
    ...artifact.artifact.measured,
    source_native_call: source.calls.measured,
    child_native_call: child.calls.measured,
    source_chapter_mission: mission.measured,
    authoring_canon: {
      source: canon.sourceDesign.measured,
      revision: canon.revisionDesign.measured,
    },
    why: {
      before: nullIfUndefined(get(why.beforeWhy, "at")),
      after: nullIfUndefined(get(why.afterWhy, "at")),
    },
  };
}

export function verifyRevisionBatch(dir) {
  const common = assertCommonEvidence(dir, REVISION_SPEC.common);
  const evidence = assertProviderAndWire(dir, REVISION_SPEC.wire);
  const config = readConfig(dir);
  const source = collectSource(dir, evidence.wire, {
    workId: config.target.work_id,
    chapterTitle: config.chapter_title || REVISION_CHAPTER_TITLE,
    readyAt: common.ready.ready_at,
    records: evidence.llmRecords,
  });
  const action = collectAction(evidence.wire, source);
  const child = collectChild(dir, evidence.wire, evidence, source, action);
  const artifact = collectArtifact(dir, source, action, child);
  const run = collectRun(dir, evidence.wire, source, action, child);
  const canon = collectCanon(dir, source);
  const mission = collectMission(evidence.wire, source, canon);
  const why = collectWhy(dir, evidence.wire, evidence, source, child);
  const uiChecks = revisionUiChecks({
    qualityVisible: authoringVisibleText(dir, "02-quality"),
    revisionVisible: authoringVisibleText(dir, "03-revision"),
    why: why.why,
    userMessages: evidence.userMessages,
  });
  const checks = batchChecks({
    source,
    child,
    artifact,
    run,
    why,
    canon,
    mission,
    uiChecks,
  });
  const measured = batchMeasured({ source, action, child, artifact, canon, mission, why });
  return finishVerification(dir, {
    checks,
    measured,
    sliceId: "b71-authoring-revision",
    label: "B71 质量发现局部修订原生链",
    successPrefix: "B71 质量发现局部修订原生验收通过",
    extra: verificationExtra({
      checks,
      common,
      turnId: child.childTurnId,
      turnIds: [...new Set([source.sourceUserTurnId, source.sourceTurnId, child.childTurnId])],
      behavior: {
        native_request: child.retry.measured,
        source_native_call: source.calls.measured,
        child_native_call: child.calls.measured,
      },
    }),
  });
}
