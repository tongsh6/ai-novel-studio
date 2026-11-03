// B71 纯场景判据：只消费外部采集的结构化事实，不做文件/DB I/O。
//
// 这里集中四类判定：全章核对请求、续航/角色的原生调用阶段、计划/canon 结果、
// 作者可见结果与 Why 面板。缺失字段或不合法形状必须让对应检查为 false，
// 不能以空集合、默认值或备用字段代签。
import {
  AUTHOR_VISIBLE_MIGRATION_CATEGORIES,
  scanAuthorVisibleTexts,
} from "../author_visible/leak_scan.mjs";
import { compareAuthoringCanonSnapshots } from "./authoring_canon_evidence.mjs";
import { providerFreeInterval } from "./authoring_planning_evidence.mjs";

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === "string" ? value : "");

// P0-6：作者可见文案内部 token 检查的唯一实现来自 `author_visible/leak_scan.mjs`
// （同一数据源 SSOT），不再逐场景维护手写 token 列表。
// 迁移期显式声明已迁移类别：协议 code / 内部标识 / ref 模式（P0-1/P0-2 已迁移）；
// `internal_terms_zh` 待 P1 中文术语产品文案迁移后启用——P1 完成后删除 categories
// 参数，恢复扫描器默认全开（不留长期开关）。
const authorVisibleCopySafe = (values) =>
  scanAuthorVisibleTexts(
    values.map((value) => text(value)),
    { categories: AUTHOR_VISIBLE_MIGRATION_CATEGORIES },
  ).ok;

export const LAST_PAGE_ANCHOR = "井底浮现第七枚手印";

// ── 全章核对请求 ──────────────────────────────────────────────────────────────

export function requestBodies(records, turnId) {
  return records
    .filter((record) => String(record.turn_id ?? "") === turnId)
    .map((record) => record.request?.body ?? record.request_body)
    .filter((body) => body && Array.isArray(body.messages));
}

export function requestBodiesOf(records) {
  return records
    .map((record) => record.request?.body ?? record.request_body)
    .filter((body) => body && Array.isArray(body.messages));
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const TOOL_RESULT_TYPES = new Set(["observation", "validation_result"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonBlankId(value) {
  return typeof value === "string" && value.trim() !== "";
}

// 完整 tool 结果图的唯一解析边界：支持类型与非空 call_id 在这里一次判定。
// observation() 只是该解析结果的一个 consumer，不另起一套观察 parser。
function toolResult(message) {
  if (!isObject(message)) return null;
  if (message.role !== "tool") return null;
  if (typeof message.content !== "string") return null;
  const payload = parseJson(message.content);
  if (!isObject(payload)) return null;
  if (!TOOL_RESULT_TYPES.has(payload.type) || !nonBlankId(payload.call_id)) return null;
  return payload;
}

export function observation(message) {
  const payload = toolResult(message);
  return payload?.type === "observation" ? payload : null;
}

export function observationQuery(payload) {
  if (!payload || !payload.content) return null;
  const query = parseJson(payload.content.query);
  if (query === null || typeof query !== "object" || Array.isArray(query)) return null;
  return query;
}

function exchangeCall(call, index) {
  if (!isObject(call) || !nonBlankId(call.id)) return null;
  return { id: call.id, index };
}

function exchangeResponse(message, index) {
  const payload = toolResult(message);
  if (!payload) return null;
  return {
    index,
    message,
    type: payload.type,
    payload,
    toolCallId: message.tool_call_id,
    callId: payload.call_id,
  };
}

// 一条消息只归类一次：assistant 贡献有序调用，tool 贡献响应，其它角色不参与绑定。
// tool_calls 存在但不是数组时显式标记畸形，不能经 list() 降级为空集合。
function exchangeMessage(message, index) {
  if (message?.role === "assistant") {
    if (message.tool_calls === undefined) {
      return { calls: [], responses: [], malformed: false };
    }
    if (!Array.isArray(message.tool_calls)) {
      return { calls: [], responses: [], malformed: true };
    }
    const calls = message.tool_calls.map((call) => exchangeCall(call, index));
    return { calls: calls.filter(Boolean), responses: [], malformed: calls.some((call) => call === null) };
  }
  if (message?.role !== "tool") return { calls: [], responses: [], malformed: false };
  const response = exchangeResponse(message, index);
  return { calls: [], responses: response ? [response] : [], malformed: response === null };
}

// 顺序消费：响应只对照此前消息中已出现的调用，未来调用不能回填因果。
function responsesBoundInOrder(parsed) {
  const seenCalls = [];
  return parsed.every((entry) => {
    seenCalls.push(...entry.calls);
    return entry.responses.every((response) => {
      const matches = seenCalls.filter(
        (call) => call.id === response.toolCallId && call.id === response.callId,
      );
      return matches.length === 1;
    });
  });
}

// 单一纯 exchange 索引：每个请求体独立解析，按消息顺序记录 assistant 调用与 tool 响应。
// 响应保持原样进入索引；未知、畸形或重复响应使该请求不可判定，而不是被 filter 丢弃。
function requestExchange(body) {
  const parsed = list(body?.messages).map((message, index) => exchangeMessage(message, index));
  const calls = parsed.flatMap((entry) => entry.calls);
  const responses = parsed.flatMap((entry) => entry.responses);
  const unique = (values) => new Set(values).size === values.length;
  return {
    calls,
    responses,
    valid:
      !parsed.some((entry) => entry.malformed) &&
      unique(calls.map((call) => call.id)) &&
      unique(responses.map((response) => response.callId)) &&
      responsesBoundInOrder(parsed),
  };
}

function requestExchanges(bodies) {
  return list(bodies).map((body) => {
    const exchange = requestExchange(body);
    return { body, ...exchange };
  });
}

function observationsOf(exchanges) {
  return exchanges.flatMap(({ body, responses }) =>
    responses
      .filter(({ type }) => type === "observation")
      .map(({ message, payload }) => ({ body, message, payload })),
  );
}

function continuationFacts(observations) {
  const previousIndex = observations.findIndex(({ payload }) => payload.next_offset === 6000);
  if (previousIndex < 0) return { previous: null, continuation: null, query: null };
  const previous = observations[previousIndex].payload;
  const found = observations
    .slice(previousIndex + 1)
    .find(({ payload }) => {
      const query = observationQuery(payload);
      return query !== null && query.offset === previous.next_offset;
    });
  const continuation = found ? found.payload : null;
  return { previous, continuation, query: observationQuery(continuation) };
}

function observationsLinkedAndEnough(exchanges, observations) {
  return observations.length >= 2 && exchanges.every((exchange) => exchange.valid);
}

function hasContinuationQuery(query, previous) {
  if (!query) return false;
  return query.offset === previous.next_offset && typeof query.chapter_ref === "string";
}

// 调用方已由 continuationFacts 保证 previous/continuation 存在，且 continuation
// 的 query 能被解析（因此 content 存在）；这里只防御 previous 缺 content 的证据。
function continuationQueryEchoed(previous, continuation) {
  if (!previous.content) return false;
  const summary = previous.content.summary;
  const echoed = continuation.content.query;
  return typeof summary === "string" && typeof echoed === "string" && summary.includes(echoed);
}

function continuationQueryIsVerbatim(previous, continuation, query) {
  return hasContinuationQuery(query, previous) && continuationQueryEchoed(previous, continuation);
}

function chapterRefObserved(continuation, query) {
  if (!query) return false;
  return Array.isArray(continuation.source_refs) && continuation.source_refs.includes(query.chapter_ref);
}

function scopeClosesExploration(finalScope) {
  const content = text(finalScope?.content);
  return content.includes("只读探索当前允许：false") && content.includes("只读探索预算已用尽");
}

function applicationBaseIsClean(bases) {
  return bases.length > 0 && bases.every((message) => !text(message.content).includes(LAST_PAGE_ANCHOR));
}

function nativeRequestMeasurement(bodies, observations, previous, continuation, query) {
  return {
    request_count: bodies.length,
    observation_count: observations.length,
    continuation_call_id: continuation ? continuation.call_id : null,
    continuation_chapter_ref: query ? query.chapter_ref ?? null : null,
    continuation_next_offset: previous ? previous.next_offset : null,
  };
}

function strictRequestPrefix(bodies) {
  return bodies.slice(1).every((body, index) => {
    const previous = bodies[index];
    if (!body || !previous) return false;
    const previousMessages = list(previous.messages);
    return (
      same(list(body.messages).slice(0, previousMessages.length), previousMessages) &&
      same(body.tools, previous.tools)
    );
  });
}

export function nativeRequestChecks(bodies) {
  const exchanges = requestExchanges(bodies);
  const observations = observationsOf(exchanges);
  const { previous, continuation, query } = continuationFacts(observations);
  const lastBody = bodies.at(-1);
  const finalScope = list(lastBody?.messages).filter((message) =>
    text(message?.content).startsWith("【应用数据 · scope_update"),
  ).at(-1);
  const bases = bodies.flatMap((body) => list(body?.messages)).filter((message) =>
    text(message?.content).startsWith("【应用数据 · application_base"),
  );

  return {
    checks: {
      at_least_three_native_model_calls: bodies.length >= 3,
      every_observation_links_original_tool_call: observationsLinkedAndEnough(exchanges, observations),
      continuation_observation_has_next_offset: Boolean(previous && continuation),
      continuation_query_is_verbatim: continuationQueryIsVerbatim(previous, continuation, query),
      observation_has_real_chapter_ref: chapterRefObserved(continuation, query),
      request_messages_keep_strict_prefix: strictRequestPrefix(bodies),
      latest_scope_closes_exploration: scopeClosesExploration(finalScope),
      application_base_does_not_duplicate_observation: applicationBaseIsClean(bases),
    },
    measured: nativeRequestMeasurement(bodies, observations, previous, continuation, query),
  };
}

// ── 续航/角色的真实请求阶段 ────────────────────────────────────────────────────

export function bodyToolNames(body) {
  if (!body) return [];
  return list(body.tools)
    .filter((tool) => tool !== null && tool !== undefined)
    .map((tool) => (tool.name ?? (tool.function ? tool.function.name : undefined)))
    .filter(Boolean);
}

function stageBody(bodies, name) {
  return bodies.filter((body) => bodyToolNames(body).includes(name)).at(-1);
}

export function nativeCalls(messages) {
  return list(messages).flatMap((message) => {
    if (!message) return [];
    return list(message.tool_calls)
      .filter((call) => call !== null && call !== undefined)
      .map((call) => (call.function ? call.function.name ?? call.name : call.name))
      .filter(Boolean);
  });
}

export function resultBlocks(messages, type) {
  return list(messages).flatMap((message) => {
    if (message?.role !== "tool" || typeof message.content !== "string") return [];
    const payload = parseJson(message.content);
    return payload?.type === type ? [payload] : [];
  });
}

export function canonicalCalls(messages) {
  return list(messages).flatMap((message) =>
    list(message?.blocks)
      .filter((block) => block?.type === "tool_call")
      .map((block) => block.name),
  );
}

export function canonicalValidations(messages) {
  return list(messages).flatMap((message) =>
    list(message?.blocks).filter((block) => block?.type === "validation_result"),
  );
}

function persistedStageCalls(messages) {
  return list(messages).flatMap((message) => {
    if (!message) return [];
    return list(message.blocks)
      .filter((block) => block && block.type === "tool_call")
      .map((block) => ({ id: block.call_id, name: block.name }));
  });
}

function observedStageCalls(qualityMessages) {
  return list(qualityMessages).flatMap((message) => {
    if (!message) return [];
    return list(message.tool_calls).map((call) => {
      // 空调用是坏证据：保留为不可匹配的占位，让阶段顺序失败而不是静默丢弃。
      if (!call) return { id: null, name: null };
      return {
        id: call.id,
        name: call.function ? call.function.name ?? call.name : call.name,
      };
    });
  });
}

function lastCallName(calls) {
  const last = calls.at(-1);
  return last ? last.name : undefined;
}

function stageOrderPreserved(persisted, observed) {
  return (
    lastCallName(observed) === "submit_tentative_artifact" &&
    lastCallName(persisted) === "report_quality_findings" &&
    same(persisted.slice(0, -1), observed)
  );
}

export function nativeStageHistoryPreserved(messages, qualityMessages) {
  const persisted = persistedStageCalls(messages);
  const observed = observedStageCalls(qualityMessages);
  return (
    observed.some((call) => call.name === "continuation_decision") &&
    stageOrderPreserved(persisted, observed)
  );
}

const strictPrefix = (previous, next) => {
  if (!previous || !next) return false;
  return same(
    list(next.messages).slice(0, list(previous.messages).length),
    list(previous.messages),
  );
};

function continuationPrefixes(continuation, writer, quality) {
  return strictPrefix(continuation, writer) && strictPrefix(writer, quality);
}

function plannerCallsReachWriter(writer) {
  if (!writer) return false;
  const calls = nativeCalls(writer.messages);
  return ["agent_plan_draft", "chapter_mission"].every((name) => calls.includes(name));
}

function passedValidationBoundary(result) {
  if (!result || !result.detail) return false;
  return result.reason_code !== undefined && result.status === "passed" &&
    result.detail.execution_authorized === false && result.detail.canon_written === false;
}

function plannerValidationsReachWriter(writer) {
  if (!writer) return false;
  const results = resultBlocks(writer.messages, "validation_result");
  return ["agent_plan_validated", "chapter_mission_validated"].every((reason) =>
    results.some((result) => result.reason_code === reason && passedValidationBoundary(result)),
  );
}

function writerOffersOnlyTentative(writer) {
  if (!writer) return false;
  return same(bodyToolNames(writer), ["submit_tentative_artifact"]);
}

function qualityOffersOnlyQuality(quality) {
  if (!quality) return false;
  return same(bodyToolNames(quality), ["report_quality_findings"]);
}

function writerCallReachesQuality(quality) {
  return Boolean(quality) && nativeCalls(quality.messages).includes("submit_tentative_artifact");
}

function durableStageOrderMatches(durable, quality) {
  if (!quality) return false;
  return nativeStageHistoryPreserved(durable && durable.messages, quality.messages);
}

function durableClosurePassed(validations) {
  return ["tentative_artifact_validated", "quality_findings_validated"].every((reason) =>
    validations.some((result) => result.reason_code === reason && result.status === "passed"),
  );
}

export function continuationRequestChecks(records, durable) {
  const bodies = requestBodiesOf(records);
  const continuation = stageBody(bodies, "continuation_decision");
  const writer = stageBody(bodies, "submit_tentative_artifact");
  const quality = stageBody(bodies, "report_quality_findings");
  const writerValidations = resultBlocks(quality?.messages, "validation_result").filter(
    (result) =>
      result.reason_code === "tentative_artifact_validated" && result.status === "passed",
  );
  const calls = canonicalCalls(durable?.messages).filter((name) =>
    ["continuation_decision", "submit_tentative_artifact", "report_quality_findings"].includes(name),
  );
  const validations = canonicalValidations(durable?.messages);

  return {
    checks: {
      continuation_writer_quality_keep_strict_prefix:
        continuationPrefixes(continuation, writer, quality),
      planning_and_mission_calls_reach_writer: plannerCallsReachWriter(writer),
      planning_and_mission_validation_reach_writer: plannerValidationsReachWriter(writer),
      writer_stage_only_offers_tentative_tool: writerOffersOnlyTentative(writer),
      quality_stage_only_offers_quality_tool: qualityOffersOnlyQuality(quality),
      writer_native_call_reaches_quality_request: writerCallReachesQuality(quality),
      writer_application_result_precedes_quality: writerValidations.length === 1,
      durable_checkpoint_keeps_native_stage_order: durableStageOrderMatches(durable, quality),
      durable_checkpoint_closes_writer_and_quality: durableClosurePassed(validations),
    },
    measured: {
      request_count: bodies.length,
      writer_tool_history: calls,
      durable_validation_reasons: validations.map((result) => result.reason_code),
    },
  };
}

export function characterRequestChecks(records, durable) {
  const bodies = requestBodiesOf(records);
  const judgment = stageBody(bodies, "judgment_decision");
  const writer = stageBody(bodies, "submit_tentative_artifact");
  const calls = canonicalCalls(durable?.messages).filter((name) =>
    ["judgment_decision", "submit_tentative_artifact"].includes(name),
  );
  const validations = canonicalValidations(durable?.messages);

  return {
    checks: {
      judgment_and_writer_keep_strict_prefix: strictPrefix(judgment, writer),
      writer_stage_only_offers_tentative_tool:
        Boolean(writer) && same(bodyToolNames(writer), ["submit_tentative_artifact"]),
      durable_checkpoint_keeps_judgment_and_writer:
        same(calls, ["judgment_decision", "submit_tentative_artifact"]),
      durable_checkpoint_closes_writer:
        validations.some(
          (result) =>
            result.reason_code === "tentative_artifact_validated" && result.status === "passed",
        ),
    },
    measured: {
      request_count: bodies.length,
      native_tool_history: calls,
      durable_validation_reasons: validations.map((result) => result.reason_code),
    },
  };
}

// ── 结果判据（真实 UI 文本、run 结果、DB 计数、源码指纹、canon）────────────────

function pendingArtifacts(turnResult) {
  if (!turnResult || !turnResult.adoption_state) return [];
  return list(turnResult.adoption_state.pending);
}

export function continuationOutcomeChecks({
  visible,
  turnResult,
  runId,
  start,
  final,
  fingerprintUnchanged,
}) {
  const visibleText = text(visible);
  return {
    real_native_window_shows_tentative_candidate:
      visibleText.includes("正文草稿") && visibleText.includes("保存为章节正文"),
    author_visible_copy_has_no_internal_protocol_codes:
      authorVisibleCopySafe([visibleText]),
    recovered_same_run: turnResult?.agent_run?.run_id === runId,
    pending_prose_remains_tentative: pendingArtifacts(turnResult).length > 0 &&
      pendingArtifacts(turnResult).every(
        (artifact) =>
          artifact.artifact_type === "prose_fragment" &&
          artifact.adoption_status === "TENTATIVE",
      ),
    quality_review_completed: turnResult?.quality_review?.review_status === "completed",
    no_production_write: same(start, final),
    production_sources_unchanged: fingerprintUnchanged === true,
  };
}

function pendingCharacterRemainsTentative(pending) {
  return (
    pending.length > 0 &&
    pending.every(
      (artifact) =>
        artifact.artifact_type === "character_seed" &&
        artifact.adoption_status === "TENTATIVE",
    )
  );
}

function whyPanelAuthorSafe(value) {
  const why = text(value);
  return (
    why.includes("回放只读取已保存记录，不会重新调用模型") &&
    authorVisibleCopySafe([why])
  );
}

export function characterOutcomeChecks({
  visible,
  why,
  turnResult,
  ackBody,
  runId,
  start,
  final,
  fingerprintUnchanged,
  request,
}) {
  const visibleText = text(visible);
  return {
    real_native_window_shows_tentative_character:
      visibleText.includes("角色设定草稿") &&
      visibleText.includes("保存所选方案到作品档案"),
    author_visible_copy_has_no_internal_protocol_codes:
      authorVisibleCopySafe([visibleText]),
    recovered_same_durable_run:
      turnResult?.agent_run?.run_id === runId &&
      ackBody?.response?.run_mode === "durable",
    pending_character_remains_tentative: pendingCharacterRemainsTentative(
      pendingArtifacts(turnResult),
    ),
    no_production_write: same(start, final),
    production_sources_unchanged: fingerprintUnchanged === true,
    why_panel_is_provider_free_and_author_safe: whyPanelAuthorSafe(why),
    ...request.checks,
  };
}

export function planningPendingResults(results, durableRefs) {
  const pending = list(results).flatMap((result) =>
    result && result.adoption_state ? list(result.adoption_state.pending) : []);
  const unique = [...new Map(pending.map((item) => [item.artifact_id, item])).values()];
  return (
    pending.every(
      (item) => typeof item.artifact_id === "string" && item.adoption_status === "TENTATIVE",
    ) &&
    same([...new Set(unique.map((item) => item.artifact_type))].sort(), [
      "character_seed",
      "world_setting",
    ]) &&
    new Set(unique.map((item) => item.source_tool_result_ref).filter(Boolean)).size === 2 &&
    same(unique.map((item) => item.artifact_id).sort(), list(durableRefs).slice().sort())
  );
}

export function planningUiChecks({ visible, why }) {
  const visibleText = text(visible);
  const whyText = text(why);
  return {
    real_native_window_shows_both_candidates:
      ["角色设定草稿", "世界设定草稿", "保存所选方案到作品档案"].every((value) =>
        visibleText.includes(value),
      ),
    author_visible_copy_has_no_internal_protocol_codes: authorVisibleCopySafe([
      visibleText,
      whyText,
    ]),
    why_panel_is_author_safe: whyPanelAuthorSafe(whyText),
  };
}

export function completedDurableRun(ackBody, record) {
  if (!ackBody || !record || !ackBody.response) return false;
  return ackBody.response.run_mode === "durable" &&
    record.run_mode === "durable" &&
    record.status === "completed";
}

function planRevisionEvents(wire, runId) {
  return list(wire).filter((entry) => {
    if (!entry || !entry.body) return false;
    return entry.event === "agent_event" &&
      entry.body.run_ref === runId &&
      entry.body.event_type === "plan_revised";
  });
}

export function singleRevisionEvent(wire, runId) {
  const revised = planRevisionEvents(wire, runId);
  if (revised.length !== 1) return false;
  const payload = revised[0].body.payload;
  return Boolean(payload) && Number(payload.plan_version) === 2;
}

function replayPathsFor(facts, results, durable) {
  const record = durable && durable.record ? durable.record : {};
  const replayPrefix = `/api/works/${record.work_id}/sessions/${record.session_id}/turns/`;
  return new Set(
    [facts ? facts.turnId : undefined, ...list(results).map((result) => result && result.turn_id)]
      .filter(Boolean)
      .map((turnId) => `${replayPrefix}${encodeURIComponent(turnId)}/replay`),
  );
}

function replayObservedInWindow(wire, replayPaths, before, after) {
  return list(wire).some((entry) => {
    if (!entry) return false;
    return entry.direction === "http" &&
      entry.status === 200 &&
      replayPaths.has(entry.path) &&
      entry.at >= before &&
      entry.at <= after;
  });
}

export function planningWhyChecks({
  facts,
  results,
  durable,
  wire,
  beforeWhy,
  afterWhy,
  appRecords,
  llmRecords,
}) {
  const before = beforeWhy ? beforeWhy.at : undefined;
  const after = afterWhy ? afterWhy.at : undefined;
  return {
    why_uses_scoped_persisted_replay: replayObservedInWindow(
      wire,
      replayPathsFor(facts, results, durable),
      before,
      after,
    ),
    why_does_not_call_provider: providerFreeInterval({
      appRecords: list(appRecords),
      llmRecords: list(llmRecords),
      start: before,
      end: after,
    }),
  };
}

function planningRunChecks({ ackBody, results, durable, wire }) {
  const record = durable && durable.record ? durable.record : null;
  return {
    planning_run_is_durable_and_completed: completedDurableRun(ackBody, record),
    two_types_remain_tentative: planningPendingResults(results, durable ? durable.pending : null),
    exactly_one_plan_revision_event: singleRevisionEvent(wire, record ? record.id : undefined),
  };
}

const checkpointCanon = (checkpoint) => (checkpoint ? checkpoint.authoring_canon : undefined);
const checkpointCounts = (checkpoint) => (checkpoint ? checkpoint.db_production_counts : undefined);

function planningCanonFacts(start, final) {
  const canon = compareAuthoringCanonSnapshots(checkpointCanon(start), checkpointCanon(final));
  return {
    canon,
    no_canon_write: same(checkpointCounts(start), checkpointCounts(final)) && canon.checks.no_canon_write,
    memory_reference_updates_accounted: canon.checks.memory_reference_updates_accounted,
  };
}

export function planningOutcomeChecks({
  visible,
  why,
  ackBody,
  facts,
  results,
  durable,
  wire,
  start,
  final,
  beforeWhy,
  afterWhy,
  appRecords,
  llmRecords,
  fingerprintUnchanged,
}) {
  const canonFacts = planningCanonFacts(start, final);
  return {
    checks: {
      ...planningUiChecks({ visible, why }),
      ...planningRunChecks({ ackBody, results, durable, wire }),
      ...planningWhyChecks({
        facts,
        results,
        durable,
        wire,
        beforeWhy,
        afterWhy,
        appRecords,
        llmRecords,
      }),
      no_canon_write: canonFacts.no_canon_write,
      memory_reference_updates_accounted: canonFacts.memory_reference_updates_accounted,
      production_sources_unchanged: fingerprintUnchanged === true,
    },
    measured: { authoring_canon: canonFacts.canon.measured },
  };
}

export function fullReadOutcomeChecks({
  visible,
  lastPageAnchor,
  explorations,
  turnResult,
  start,
  final,
  fingerprintUnchanged,
  request,
}) {
  const visibleText = text(visible);
  return {
    real_native_window_shows_last_page_fact: visibleText.includes(String(lastPageAnchor)),
    real_native_window_shows_reading_activity: visibleText.includes("已阅读章节正文"),
    two_real_exploration_events: list(explorations).length === 2,
    turn_result_has_no_pending_artifacts: pendingArtifacts(turnResult).length === 0,
    no_production_write: same(start, final),
    production_sources_unchanged: fingerprintUnchanged === true,
    ...request.checks,
  };
}

export function nativeCallFailureSummary(joined) {
  return [
    ...new Set(
      list(joined?.failures).map((failure) => `${failure.reason}:${failure.phase}`),
    ),
  ].join(",");
}
