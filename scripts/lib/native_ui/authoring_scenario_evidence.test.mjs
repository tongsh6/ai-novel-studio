// B71 纯场景判据的行为测试：成功、缺失和篡改都必须闭合。
// 测试只构造真实采集形状的结构化证据，不冒充任何真实页面批次通过。
import assert from "node:assert/strict";
import test from "node:test";
import {
  requestBodies,
  requestBodiesOf,
  observation,
  nativeRequestChecks,
  continuationRequestChecks,
  characterRequestChecks,
  nativeStageHistoryPreserved,
  continuationOutcomeChecks,
  characterOutcomeChecks,
  planningPendingResults,
  planningUiChecks,
  completedDurableRun,
  singleRevisionEvent,
  planningWhyChecks,
  planningOutcomeChecks,
  fullReadOutcomeChecks,
  bodyToolNames,
  nativeCalls,
  resultBlocks,
  canonicalCalls,
  canonicalValidations,
  nativeCallFailureSummary,
  observationQuery,
} from "./authoring_scenario_evidence.mjs";
import { CANON_TABLES, buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";

const ANCHOR = "井底浮现第七枚手印";

// ── 全章核对请求 ──────────────────────────────────────────────────────────────

const observationPayload = ({
  callId,
  offset,
  nextOffset,
  chapterRef = "chapter-1",
  summary,
  sourceRefs = [chapterRef],
}) => {
  const query = JSON.stringify({ offset, chapter_ref: chapterRef });
  return {
    type: "observation",
    call_id: callId,
    next_offset: nextOffset,
    content: { query, summary: summary ?? `读取 ${query}` },
    source_refs: sourceRefs,
  };
};

const toolCall = (id, name = "search") => ({ id, function: { name } });
const observationMessage = (payload) => ({
  role: "tool",
  tool_call_id: payload.call_id,
  content: JSON.stringify(payload),
});
const assistantCall = (call) => ({ role: "assistant", tool_calls: [call] });

function nativeBodies() {
  const first = observationPayload({ callId: "call-1", offset: 0, nextOffset: 6000 });
  const second = observationPayload({ callId: "call-2", offset: 6000, nextOffset: 12000 });
  first.content = {
    ...first.content,
    summary: `已读至续读查询 ${second.content.query}`,
  };
  const third = observationPayload({ callId: "call-3", offset: 12000, nextOffset: 18000 });
  const base = { role: "user", content: "【应用数据 · application_base】作品资料" };
  const tools = [{ type: "function", function: { name: "search" } }];
  const one = [
    { role: "user", content: "全章核对" },
    base,
    assistantCall(toolCall("call-1")),
    observationMessage(first),
  ];
  const two = [...one, assistantCall(toolCall("call-2")), observationMessage(second)];
  const three = [
    ...two,
    assistantCall(toolCall("call-3")),
    observationMessage(third),
    { role: "user", content: "【应用数据 · scope_update】只读探索当前允许：false；只读探索预算已用尽" },
  ];
  return [one, two, three].map((messages) => ({ messages, tools }));
}

test("全章核对的请求、观察续读与 scope 事实全部成立时才通过", () => {
  const { checks, measured } = nativeRequestChecks(nativeBodies());
  assert.deepEqual(checks, {
    at_least_three_native_model_calls: true,
    every_observation_links_original_tool_call: true,
    continuation_observation_has_next_offset: true,
    continuation_query_is_verbatim: true,
    observation_has_real_chapter_ref: true,
    request_messages_keep_strict_prefix: true,
    latest_scope_closes_exploration: true,
    application_base_does_not_duplicate_observation: true,
  });
  assert.deepEqual(measured, {
    request_count: 3,
    observation_count: 6,
    continuation_call_id: "call-2",
    continuation_chapter_ref: "chapter-1",
    continuation_next_offset: 6000,
  });
});

test("空请求、缺请求、缺续读与缺失观察链接都失败而不是空集合真值通过", () => {
  for (const bodies of [[], [nativeBodies()[0]], nativeBodies().slice(0, 2)]) {
    const { checks } = nativeRequestChecks(bodies);
    assert.equal(Object.values(checks).every(Boolean), false);
    assert.equal(checks.at_least_three_native_model_calls, false);
  }
  const missingContinuation = nativeBodies();
  const firstPayload = JSON.parse(missingContinuation[0].messages[3].content);
  firstPayload.next_offset = 7000;
  missingContinuation[0].messages[3].content = JSON.stringify(firstPayload);
  assert.equal(nativeRequestChecks(missingContinuation).checks.continuation_observation_has_next_offset, false);

  const unlinked = nativeBodies();
  for (const body of unlinked) {
    body.messages = body.messages.filter(
      (message) => !(message.role === "assistant" && message.tool_calls?.some((call) => call.id === "call-2")),
    );
  }
  assert.equal(nativeRequestChecks(unlinked).checks.every_observation_links_original_tool_call, false);
});

test("续读查询、章节来源、严格前缀、scope 与 application_base 被篡改时失败", () => {
  const notStringChapter = nativeBodies();
  const continuation = JSON.parse(notStringChapter[1].messages.at(-1).content);
  continuation.content = {
    ...continuation.content,
    query: JSON.stringify({ offset: 6000, chapter_ref: 7 }),
  };
  notStringChapter[1].messages[notStringChapter[1].messages.length - 1] = observationMessage(continuation);
  const previousForNumber = JSON.parse(notStringChapter[0].messages.at(-1).content);
  previousForNumber.content = {
    ...previousForNumber.content,
    summary: `已读至续读查询 ${continuation.content.query}`,
  };
  notStringChapter[0].messages[notStringChapter[0].messages.length - 1] = observationMessage(previousForNumber);
  assert.equal(nativeRequestChecks(notStringChapter).checks.continuation_query_is_verbatim, false);

  const summaryMismatch = nativeBodies();
  const previous = JSON.parse(summaryMismatch[0].messages.at(-1).content);
  previous.content = { ...previous.content, summary: "没有回显续读查询" };
  summaryMismatch[0].messages[summaryMismatch[0].messages.length - 1] = observationMessage(previous);
  assert.equal(nativeRequestChecks(summaryMismatch).checks.continuation_query_is_verbatim, false);

  const foreignSource = nativeBodies();
  const source = JSON.parse(foreignSource[1].messages.at(-1).content);
  source.source_refs = ["another-chapter"];
  foreignSource[1].messages[foreignSource[1].messages.length - 1] = observationMessage(source);
  assert.equal(nativeRequestChecks(foreignSource).checks.observation_has_real_chapter_ref, false);

  const brokenPrefix = nativeBodies();
  brokenPrefix[2].messages.splice(1, 1);
  assert.equal(nativeRequestChecks(brokenPrefix).checks.request_messages_keep_strict_prefix, false);
  const changedTools = nativeBodies();
  changedTools[2].tools = [{ type: "function", function: { name: "other" } }];
  assert.equal(nativeRequestChecks(changedTools).checks.request_messages_keep_strict_prefix, false);

  const openScope = nativeBodies();
  openScope[2].messages.at(-1).content = "【应用数据 · scope_update】只读探索当前允许：true";
  assert.equal(nativeRequestChecks(openScope).checks.latest_scope_closes_exploration, false);
  const noScope = nativeBodies();
  noScope[2].messages.pop();
  assert.equal(nativeRequestChecks(noScope).checks.latest_scope_closes_exploration, false);

  const noBase = nativeBodies().map((body) => ({
    ...body,
    messages: body.messages.filter((message) => !String(message.content ?? "").startsWith("【应用数据 · application_base")),
  }));
  assert.equal(nativeRequestChecks(noBase).checks.application_base_does_not_duplicate_observation, false);
  const leakedBase = nativeBodies();
  const base = leakedBase[0].messages.find((message) => message.content.startsWith("【应用数据 · application_base"));
  base.content = `${base.content} ${ANCHOR}`;
  assert.equal(nativeRequestChecks(leakedBase).checks.application_base_does_not_duplicate_observation, false);
});

test("坏观察信封不被当成 observation，非法续读 query 失败而不抛错", () => {
  assert.equal(observation({ role: "assistant", content: "{}" }), null);
  assert.equal(observation({ role: "tool", content: "not json" }), null);
  assert.equal(observation({ role: "tool", content: JSON.stringify({ type: "other" }) }), null);
  const sources = [
    { turn_id: "turn-1", request: { body: { messages: [] } } },
    { turn_id: "turn-2", request_body: { messages: [{ role: "user" }] } },
    { turn_id: "turn-1", request: { body: { messages: "bad" } } },
    { turn_id: "turn-1", request_body: "bad" },
    { turn_id: "turn-1" },
  ];
  assert.deepEqual(requestBodies(sources, "turn-1"), [{ messages: [] }]);
  assert.deepEqual(requestBodiesOf(sources), [{ messages: [] }, { messages: [{ role: "user" }] }]);

  const invalidQuery = nativeBodies();
  for (const body of invalidQuery) {
    body.messages = body.messages.map((message) => {
      if (message.role !== "tool") return message;
      const payload = JSON.parse(message.content);
      return payload.call_id === "call-2"
        ? observationMessage({ ...payload, content: { query: "not json", summary: "读取" } })
        : message;
    });
  }
  const { checks } = nativeRequestChecks(invalidQuery);
  assert.equal(checks.continuation_query_is_verbatim, false);
  assert.equal(checks.observation_has_real_chapter_ref, false);
});

// ── 续航/角色请求 ────────────────────────────────────────────────────────────

const wireCall = (id, name) => ({ id, function: { name, arguments: "{}" } });
const wireAssistant = (calls) => ({ role: "assistant", tool_calls: calls });
const wireResult = (callId, reason) => ({
  role: "tool",
  tool_call_id: callId,
  content: JSON.stringify({
    type: "validation_result",
    call_id: callId,
    status: "passed",
    reason_code: reason,
    detail: { execution_authorized: false, canon_written: false },
  }),
});
const wireBody = (messages, names) => ({
  messages,
  tools: names.map((name) => ({ type: "function", function: { name } })),
});
const requestRecord = (body) => ({ request: { body } });
const canonicalCall = (id, name) => ({ role: "assistant", blocks: [{ type: "tool_call", call_id: id, name }] });
const canonicalResult = (callId, reason) => ({
  role: "tool",
  blocks: [{ type: "validation_result", call_id: callId, status: "passed", reason_code: reason }],
});
const passed = (callId, reason) => ({
  type: "validation_result",
  call_id: callId,
  status: "passed",
  reason_code: reason,
  detail: { execution_authorized: false, canon_written: false },
});

function continuationFixture() {
  const upstream = [
    { role: "user", content: "续写第01章" },
    wireAssistant([wireCall("call-judgment", "judgment_decision")]),
    wireResult("call-judgment", "judgment_validated"),
    wireAssistant([wireCall("call-plan", "agent_plan_draft")]),
    wireResult("call-plan", "agent_plan_validated"),
    wireAssistant([wireCall("call-mission", "chapter_mission")]),
    wireResult("call-mission", "chapter_mission_validated"),
  ];
  const writerMessages = [
    ...upstream,
    wireAssistant([wireCall("call-continuation", "continuation_decision")]),
    wireResult("call-continuation", "continuation_validated"),
  ];
  const qualityMessages = [
    ...writerMessages,
    wireAssistant([wireCall("call-submit", "submit_tentative_artifact")]),
    wireResult("call-submit", "tentative_artifact_validated"),
  ];
  const records = [
    requestRecord(wireBody(upstream, ["continuation_decision"])),
    requestRecord(wireBody(writerMessages, ["submit_tentative_artifact"])),
    requestRecord(wireBody(qualityMessages, ["report_quality_findings"])),
  ];
  const durable = {
    messages: [
      canonicalCall("call-judgment", "judgment_decision"),
      canonicalCall("call-plan", "agent_plan_draft"),
      canonicalCall("call-mission", "chapter_mission"),
      canonicalCall("call-continuation", "continuation_decision"),
      canonicalCall("call-submit", "submit_tentative_artifact"),
      canonicalCall("call-report", "report_quality_findings"),
      canonicalResult("call-submit", "tentative_artifact_validated"),
      canonicalResult("call-report", "quality_findings_validated"),
    ],
  };
  return { records, durable, qualityMessages, writerMessages };
}

test("续航请求阶段严格前缀、工具边界与持久调用顺序全部成立时才通过", () => {
  const { records, durable } = continuationFixture();
  const { checks, measured } = continuationRequestChecks(records, durable);
  assert.deepEqual(checks, {
    continuation_writer_quality_keep_strict_prefix: true,
    planning_and_mission_calls_reach_writer: true,
    planning_and_mission_validation_reach_writer: true,
    writer_stage_only_offers_tentative_tool: true,
    quality_stage_only_offers_quality_tool: true,
    writer_native_call_reaches_quality_request: true,
    writer_application_result_precedes_quality: true,
    durable_checkpoint_keeps_native_stage_order: true,
    durable_checkpoint_closes_writer_and_quality: true,
  });
  assert.deepEqual(measured.writer_tool_history, [
    "continuation_decision",
    "submit_tentative_artifact",
    "report_quality_findings",
  ]);
  assert.equal(measured.request_count, 3);
  assert.deepEqual(measured.durable_validation_reasons, [
    "tentative_artifact_validated",
    "quality_findings_validated",
  ]);
});

test("续航缺阶段、破前缀、错工具、缺校验或乱序时失败而不是抛错", () => {
  const missingStage = continuationFixture();
  missingStage.records.pop();
  assert.equal(Object.values(continuationRequestChecks(missingStage.records, missingStage.durable).checks).every(Boolean), false);

  const brokenPrefix = continuationFixture();
  brokenPrefix.records[2].request.body.messages.splice(2, 1);
  assert.equal(continuationRequestChecks(brokenPrefix.records, brokenPrefix.durable).checks.continuation_writer_quality_keep_strict_prefix, false);

  const wrongWriterTool = continuationFixture();
  wrongWriterTool.records[1].request.body.tools = [{ type: "function", function: { name: "other" } }];
  assert.equal(continuationRequestChecks(wrongWriterTool.records, wrongWriterTool.durable).checks.writer_stage_only_offers_tentative_tool, false);

  const missingWriterResult = continuationFixture();
  missingWriterResult.records[2].request.body.messages = missingWriterResult.records[2].request.body.messages.filter(
    (message) => message.role !== "tool" || !String(message.content).includes("tentative_artifact_validated"),
  );
  assert.equal(continuationRequestChecks(missingWriterResult.records, missingWriterResult.durable).checks.writer_application_result_precedes_quality, false);
  assert.equal(continuationRequestChecks(missingWriterResult.records, missingWriterResult.durable).checks.writer_native_call_reaches_quality_request, true);

  const missingDurableClosure = continuationFixture();
  missingDurableClosure.durable.messages = missingDurableClosure.durable.messages.filter(
    (message) => !(message.blocks ?? []).some((block) => block.reason_code === "quality_findings_validated"),
  );
  assert.equal(continuationRequestChecks(missingDurableClosure.records, missingDurableClosure.durable).checks.durable_checkpoint_closes_writer_and_quality, false);

  const reordered = continuationFixture();
  reordered.durable.messages.splice(4, 2, canonicalCall("call-report", "report_quality_findings"), canonicalCall("call-submit", "submit_tentative_artifact"));
  assert.equal(continuationRequestChecks(reordered.records, reordered.durable).checks.durable_checkpoint_keeps_native_stage_order, false);
});

test("角色请求只接受判断→writer 的严格阶段与单一 writer 校验", () => {
  const judgmentMessages = [{ role: "user", content: "角色设计" }];
  const writerMessages = [
    ...judgmentMessages,
    wireAssistant([wireCall("call-judgment", "judgment_decision")]),
    wireResult("call-judgment", "judgment_validated"),
  ];
  const records = [
    requestRecord(wireBody(judgmentMessages, ["judgment_decision"])),
    requestRecord(wireBody(writerMessages, ["submit_tentative_artifact"])),
  ];
  const durable = {
    messages: [
      canonicalCall("call-judgment", "judgment_decision"),
      canonicalCall("call-writer", "submit_tentative_artifact"),
      { role: "tool", blocks: [passed("call-writer", "tentative_artifact_validated")] },
    ],
  };
  const { checks } = characterRequestChecks(records, durable);
  assert.deepEqual(checks, {
    judgment_and_writer_keep_strict_prefix: true,
    writer_stage_only_offers_tentative_tool: true,
    durable_checkpoint_keeps_judgment_and_writer: true,
    durable_checkpoint_closes_writer: true,
  });
  const missing = characterRequestChecks([], durable);
  assert.equal(Object.values(missing.checks).every(Boolean), false);
  const tampered = characterRequestChecks(records, { messages: [] });
  assert.equal(tampered.checks.durable_checkpoint_keeps_judgment_and_writer, false);
  assert.equal(tampered.checks.durable_checkpoint_closes_writer, false);
});

test("持久阶段顺序不接受缺少续行判定、末次质量调用或前序交换", () => {
  const history = [
    ["judge", "judgment_decision"],
    ["continue-1", "continuation_decision"],
    ["writer", "submit_tentative_artifact"],
  ];
  const canonical = (calls) => calls.map(([call_id, name]) => ({ role: "assistant", blocks: [{ type: "tool_call", call_id, name }] }));
  const wire = (calls) => calls.map(([id, name]) => ({ role: "assistant", tool_calls: [{ id, function: { name } }] }));
  const quality = [["quality", "report_quality_findings"]];
  assert.equal(nativeStageHistoryPreserved(canonical([...history, ...quality]), wire(history)), true);
  assert.equal(nativeStageHistoryPreserved(canonical(history), wire(history)), false);
  assert.equal(nativeStageHistoryPreserved(canonical([...history, ...quality]), wire(history.slice(1))), false);
  assert.equal(nativeStageHistoryPreserved(canonical([...history, ...quality]), wire([history[1], history[0], history[2]])), false);
});

// ── 结果判据 ──────────────────────────────────────────────────────────────────

test("续航结果要求真实候选、同 run、待定正文与无生产写入", () => {
  const base = {
    visible: "正文草稿 保存为章节正文",
    turnResult: {
      agent_run: { run_id: "run-1" },
      adoption_state: { pending: [{ artifact_type: "prose_fragment", adoption_status: "TENTATIVE" }] },
      quality_review: { review_status: "completed" },
    },
    runId: "run-1",
    start: { works: 1 },
    final: { works: 1 },
    fingerprintUnchanged: true,
  };
  assert.deepEqual(Object.values(continuationOutcomeChecks(base)), Array(7).fill(true));
  assert.equal(continuationOutcomeChecks({ ...base, visible: "没有候选" }).real_native_window_shows_tentative_candidate, false);
  assert.equal(continuationOutcomeChecks({ ...base, visible: "正文草稿 保存为章节正文 request_ir" }).author_visible_copy_has_no_internal_protocol_codes, false);
  assert.equal(continuationOutcomeChecks({ ...base, runId: "run-2" }).recovered_same_run, false);
  assert.equal(continuationOutcomeChecks({ ...base, runId: null }).recovered_same_run, false);
  assert.equal(continuationOutcomeChecks({ ...base, turnResult: { ...base.turnResult, adoption_state: { pending: [] } } }).pending_prose_remains_tentative, false);
  assert.equal(continuationOutcomeChecks({ ...base, turnResult: { ...base.turnResult, adoption_state: { pending: [{ artifact_type: "prose_fragment", adoption_status: "ADOPTED" }] } } }).pending_prose_remains_tentative, false);
  assert.equal(continuationOutcomeChecks({ ...base, turnResult: { ...base.turnResult, quality_review: { review_status: "failed" } } }).quality_review_completed, false);
  assert.equal(continuationOutcomeChecks({ ...base, final: { works: 2 } }).no_production_write, false);
  assert.equal(continuationOutcomeChecks({ ...base, fingerprintUnchanged: false }).production_sources_unchanged, false);
});

test("角色结果要求候选、durable run、待定角色、安全 Why 面板与请求判据", () => {
  const base = {
    visible: "角色设定草稿 保存所选方案到作品档案",
    why: "回放只读取已保存记录，不会重新调用模型",
    turnResult: {
      agent_run: { run_id: "run-1" },
      adoption_state: { pending: [{ artifact_type: "character_seed", adoption_status: "TENTATIVE" }] },
    },
    ackBody: { response: { run_mode: "durable" } },
    runId: "run-1",
    start: { works: 1 },
    final: { works: 1 },
    fingerprintUnchanged: true,
    request: { checks: { request_ok: true } },
  };
  assert.deepEqual(Object.values(characterOutcomeChecks(base)), Array(8).fill(true));
  assert.equal(characterOutcomeChecks({ ...base, visible: "无候选" }).real_native_window_shows_tentative_character, false);
  assert.equal(characterOutcomeChecks({ ...base, visible: "角色设定草稿 保存所选方案到作品档案 call_id" }).author_visible_copy_has_no_internal_protocol_codes, false);
  assert.equal(characterOutcomeChecks({ ...base, ackBody: { response: { run_mode: "single" } } }).recovered_same_durable_run, false);
  assert.equal(characterOutcomeChecks({ ...base, runId: "run-2" }).recovered_same_durable_run, false);
  assert.equal(characterOutcomeChecks({ ...base, turnResult: { ...base.turnResult, adoption_state: { pending: [] } } }).pending_character_remains_tentative, false);
  assert.equal(characterOutcomeChecks({ ...base, turnResult: { ...base.turnResult, adoption_state: { pending: [{ artifact_type: "world_setting", adoption_status: "TENTATIVE" }] } } }).pending_character_remains_tentative, false);
  assert.equal(characterOutcomeChecks({ ...base, why: "直接回放" }).why_panel_is_provider_free_and_author_safe, false);
  assert.equal(characterOutcomeChecks({ ...base, why: "回放只读取已保存记录，不会重新调用模型 narrative_role" }).why_panel_is_provider_free_and_author_safe, false);
  assert.equal(characterOutcomeChecks({ ...base, final: { works: 2 } }).no_production_write, false);
  assert.equal(characterOutcomeChecks({ ...base, fingerprintUnchanged: false }).production_sources_unchanged, false);
});

test("计划待定结果要求两种类型、两个来源且与持久 refs 精确相等", () => {
  const pending = (items) => [{ adoption_state: { pending: items } }];
  const item = (artifact_id, artifact_type, source_tool_result_ref) => ({
    artifact_id,
    artifact_type,
    source_tool_result_ref,
    adoption_status: "TENTATIVE",
  });
  const complete = [item("id-1", "character_seed", "ref-1"), item("id-2", "world_setting", "ref-2")];
  assert.equal(planningPendingResults(pending(complete), ["id-1", "id-2"]), true);
  assert.equal(planningPendingResults([], ["id-1"]), false);
  assert.equal(planningPendingResults(pending([]), []), false);
  assert.equal(planningPendingResults(pending([{ ...complete[0], artifact_id: 7 }, complete[1]]), ["id-1", "id-2"]), false);
  assert.equal(planningPendingResults(pending([{ ...complete[0], adoption_status: "ADOPTED" }, complete[1]]), ["id-1", "id-2"]), false);
  assert.equal(planningPendingResults(pending([complete[0], { ...complete[1], artifact_type: "character_seed" }]), ["id-1", "id-2"]), false);
  assert.equal(planningPendingResults(pending([complete[0], { ...complete[1], source_tool_result_ref: "ref-1" }]), ["id-1", "id-2"]), false);
  assert.equal(planningPendingResults(pending([complete[0], { ...complete[1], source_tool_result_ref: null }]), ["id-1", "id-2"]), false);
  assert.equal(planningPendingResults(pending(complete), ["id-1"]), false);
  assert.equal(planningPendingResults(pending(complete), ["id-2", "id-1"]), true);
});

test("计划 UI 判据要求两类候选、无内部协议码且 Why 回放安全", () => {
  const good = {
    visible: "角色设定草稿 世界设定草稿 保存所选方案到作品档案",
    why: "回放只读取已保存记录，不会重新调用模型",
  };
  assert.deepEqual(Object.values(planningUiChecks(good)), [true, true, true]);
  assert.equal(planningUiChecks({ ...good, visible: "角色设定草稿" }).real_native_window_shows_both_candidates, false);
  assert.equal(planningUiChecks({ ...good, visible: `${good.visible} agent_plan_draft` }).author_visible_copy_has_no_internal_protocol_codes, false);
  assert.equal(planningUiChecks({ ...good, why: `${good.why} provider_session` }).author_visible_copy_has_no_internal_protocol_codes, false);
  assert.equal(planningUiChecks({ ...good, why: "只读回放" }).why_panel_is_author_safe, false);
});

test("durable run 与唯一 plan_revised 事件必须以真实帧事实为准", () => {
  const record = { run_mode: "durable", status: "completed" };
  assert.equal(completedDurableRun({ response: { run_mode: "durable" } }, record), true);
  assert.equal(completedDurableRun({ response: { run_mode: "single" } }, record), false);
  assert.equal(completedDurableRun({ response: { run_mode: "durable" } }, { ...record, status: "failed" }), false);
  assert.equal(completedDurableRun(null, record), false);

  const revised = { event: "agent_event", body: { run_ref: "run-1", event_type: "plan_revised", payload: { plan_version: 2 } } };
  assert.equal(singleRevisionEvent([{ event: "other", body: {} }, revised], "run-1"), true);
  assert.equal(singleRevisionEvent([revised, revised], "run-1"), false);
  assert.equal(singleRevisionEvent([], "run-1"), false);
  assert.equal(singleRevisionEvent([{ ...revised, body: { ...revised.body, run_ref: "run-2" } }], "run-1"), false);
  assert.equal(singleRevisionEvent([{ ...revised, body: { ...revised.body, event_type: "other" } }], "run-1"), false);
  assert.equal(singleRevisionEvent([{ ...revised, body: { ...revised.body, payload: { plan_version: 1 } } }], "run-1"), false);
});

test("Why 观察窗只接受窗口内 scoped replay 且不得出现 Provider 调用", () => {
  const base = {
    facts: { turnId: "turn-1" },
    results: [{ turn_id: "turn-2" }],
    durable: { record: { work_id: "work-1", session_id: "session-1", id: "run-1" } },
    wire: [
      {
        direction: "http",
        status: 200,
        path: "/api/works/work-1/sessions/session-1/turns/turn-1/replay",
        at: "2026-11-01T08:00:02.000Z",
      },
    ],
    beforeWhy: { at: "2026-11-01T08:00:01.000Z" },
    afterWhy: { at: "2026-11-01T08:00:03.000Z" },
    appRecords: [{ event: "provider_gateway.complete.start", timestamp: "2026-11-01T08:00:00.000Z" }],
    llmRecords: [{ ts: "2026-11-01T08:00:00.000Z" }],
  };
  assert.deepEqual(Object.values(planningWhyChecks(base)), [true, true]);
  assert.equal(planningWhyChecks({ ...base, wire: [] }).why_uses_scoped_persisted_replay, false);
  assert.equal(planningWhyChecks({ ...base, wire: [{ ...base.wire[0], path: "/api/other" }] }).why_uses_scoped_persisted_replay, false);
  assert.equal(planningWhyChecks({ ...base, wire: [{ ...base.wire[0], at: "2026-11-01T08:00:04.000Z" }] }).why_uses_scoped_persisted_replay, false);
  assert.equal(planningWhyChecks({ ...base, wire: [{ ...base.wire[0], status: 500 }] }).why_uses_scoped_persisted_replay, false);
  assert.equal(planningWhyChecks({ ...base, llmRecords: [{ ts: "2026-11-01T08:00:02.000Z" }] }).why_does_not_call_provider, false);
  assert.equal(planningWhyChecks({ ...base, beforeWhy: undefined }).why_uses_scoped_persisted_replay, false);
  assert.equal(planningWhyChecks({ ...base, afterWhy: {} }).why_does_not_call_provider, false);
});

const emptySnapshot = (at) => buildAuthoringCanonSnapshot({
  tables: Object.fromEntries(CANON_TABLES.map((table) => [table, []])),
  referenceLogs: [],
  at,
});

function planningOutcomeFixture() {
  const wire = [
    { event: "agent_event", body: { run_ref: "run-1", event_type: "plan_revised", payload: { plan_version: 2 } } },
    {
      direction: "http",
      status: 200,
      path: "/api/works/work-1/sessions/session-1/turns/turn-1/replay",
      at: "2026-11-01T08:00:02.000Z",
    },
  ];
  const results = [{
    turn_id: "turn-1",
    agent_run: { run_id: "run-1", status: "completed" },
    adoption_state: {
      pending: [
        { artifact_id: "id-1", artifact_type: "character_seed", adoption_status: "TENTATIVE", source_tool_result_ref: "ref-1" },
        { artifact_id: "id-2", artifact_type: "world_setting", adoption_status: "TENTATIVE", source_tool_result_ref: "ref-2" },
      ],
    },
  }];
  return {
    visible: "角色设定草稿 世界设定草稿 保存所选方案到作品档案",
    why: "回放只读取已保存记录，不会重新调用模型",
    ackBody: { response: { run_mode: "durable" } },
    facts: { turnId: "turn-1" },
    results,
    durable: { record: { id: "run-1", work_id: "work-1", session_id: "session-1", run_mode: "durable", status: "completed" }, pending: ["id-1", "id-2"] },
    wire,
    start: { db_production_counts: { works: 1 }, authoring_canon: emptySnapshot("2026-11-01T08:00:00.000Z") },
    final: { db_production_counts: { works: 1 }, authoring_canon: emptySnapshot("2026-11-01T08:00:10.000Z") },
    beforeWhy: { at: "2026-11-01T08:00:01.000Z" },
    afterWhy: { at: "2026-11-01T08:00:03.000Z" },
    appRecords: [{ event: "provider_gateway.complete.start", timestamp: "2026-11-01T08:00:00.000Z" }],
    llmRecords: [{ ts: "2026-11-01T08:00:00.000Z" }],
    fingerprintUnchanged: true,
  };
}

test("计划结果把 UI、run、Why、canon 与来源指纹合成为同一套检查", () => {
  const fixture = planningOutcomeFixture();
  const { checks, measured } = planningOutcomeChecks(fixture);
  assert.equal(Object.values(checks).every(Boolean), true);
  assert.equal(checks.no_canon_write, true);
  assert.equal(checks.memory_reference_updates_accounted, true);
  assert.equal(checks.production_sources_unchanged, true);
  assert.equal(measured.authoring_canon.memory_items, 0);
  const write = planningOutcomeFixture();
  write.final.db_production_counts = { works: 2 };
  assert.equal(planningOutcomeChecks(write).checks.no_canon_write, false);
  assert.equal(planningOutcomeChecks({ ...fixture, fingerprintUnchanged: false }).checks.production_sources_unchanged, false);
  assert.equal(planningOutcomeChecks({ ...fixture, ackBody: null }).checks.planning_run_is_durable_and_completed, false);
});

test("全章核对结果要求末页事实、阅读活动、两次探索与零待定，空集合不代签", () => {
  const base = {
    visible: `${ANCHOR} 已阅读章节正文`,
    lastPageAnchor: ANCHOR,
    explorations: [{ payload: { query: "q-1" } }, { payload: { query: "q-2" } }],
    turnResult: { adoption_state: { pending: [] } },
    start: { works: 1 },
    final: { works: 1 },
    fingerprintUnchanged: true,
    request: { checks: { request_ok: true } },
  };
  assert.deepEqual(Object.values(fullReadOutcomeChecks(base)), [true, true, true, true, true, true, true]);
  assert.equal(fullReadOutcomeChecks({ ...base, visible: "无" }).real_native_window_shows_last_page_fact, false);
  assert.equal(fullReadOutcomeChecks({ ...base, visible: "已阅读章节正文" }).real_native_window_shows_last_page_fact, false);
  assert.equal(fullReadOutcomeChecks({ ...base, explorations: [] }).two_real_exploration_events, false);
  assert.equal(fullReadOutcomeChecks({ ...base, explorations: [base.explorations[0]] }).two_real_exploration_events, false);
  assert.equal(fullReadOutcomeChecks({ ...base, turnResult: { adoption_state: { pending: [{ artifact_id: "x" }] } } }).turn_result_has_no_pending_artifacts, false);
  assert.equal(fullReadOutcomeChecks({ ...base, final: { works: 2 } }).no_production_write, false);
  assert.equal(fullReadOutcomeChecks({ ...base, fingerprintUnchanged: false }).production_sources_unchanged, false);
});


// ── 缺失/空值/一侧篡改边界 ────────────────────────────────────────────────────

test("请求体选择保留显式 request.body 优先，turn_id 与 nullish 语义不被改写", () => {
  const valid = { messages: [] };
  const records = [
    { turn_id: 0, request: { body: valid } },
    { turn_id: "turn-1", request: { body: false }, request_body: { messages: [{ role: "user" }] } },
    { turn_id: "turn-1", request: { body: { messages: "bad" } }, request_body: { messages: [{ role: "user" }] } },
    { turn_id: "turn-1", request: { body: 0 }, request_body: { messages: [{ role: "user" }] } },
  ];
  assert.deepEqual(requestBodies(records, "0"), [valid]);
  assert.deepEqual(requestBodies(records, "turn-1"), []);
  assert.deepEqual(requestBodiesOf(records), [valid]);
});

test("观察信封拒绝 null、非 tool 的 observation 与 JSON null", () => {
  const valid = { type: "observation", call_id: "call-1", content: {} };
  assert.deepEqual(observation({ role: "tool", content: JSON.stringify(valid) }), valid);
  assert.equal(observation(null), null);
  assert.equal(observation({ role: "assistant", content: JSON.stringify({ type: "observation" }) }), null);
  assert.equal(observation({ role: "tool", content: "null" }), null);
  assert.equal(observation({ role: "tool", content: "[]" }), null);
  assert.equal(observation({ role: "tool", content: new String(JSON.stringify(valid)) }), null);
  assert.equal(observationQuery(null), null);
  assert.equal(observationQuery({}), null);
  assert.equal(observationQuery({ content: { query: "[]" } }), null);
  assert.deepEqual(observationQuery({ content: { query: JSON.stringify({ offset: 1 }) } }), { offset: 1 });
  assert.equal(observationQuery({ content: { query: "5" } }), null);
  assert.equal(observationQuery({ content: { query: '"text"' } }), null);
});

test("续读 query 为数组或缺少 content 时失败而不是被条件或吞掉", () => {
  const arrayQuery = nativeBodies();
  for (const body of arrayQuery) {
    body.messages = body.messages.map((message) => {
      if (message.role !== "tool") return message;
      const payload = JSON.parse(message.content);
      if (payload.call_id === "call-1") {
        return observationMessage({ ...payload, content: { ...payload.content, summary: "已读至续读查询 []" } });
      }
      return payload.call_id === "call-2"
        ? observationMessage({ ...payload, content: { ...payload.content, query: "[]" } })
        : message;
    });
  }
  const arrayChecks = nativeRequestChecks(arrayQuery).checks;
  assert.equal(arrayChecks.continuation_observation_has_next_offset, false);
  assert.equal(arrayChecks.continuation_query_is_verbatim, false);

  const missingContent = nativeBodies();
  const previous = JSON.parse(missingContent[0].messages.at(-1).content);
  delete previous.content;
  missingContent[0].messages[missingContent[0].messages.length - 1] = observationMessage(previous);
  assert.equal(nativeRequestChecks(missingContent).checks.continuation_query_is_verbatim, false);
});

test("空 body、空 assistant 与一侧 call_id 不匹配都不能被链接判据放过", () => {
  assert.doesNotThrow(() => nativeRequestChecks([null]));
  assert.equal(nativeRequestChecks([null]).checks.every_observation_links_original_tool_call, false);
  assert.equal(nativeRequestChecks([null, { messages: [] }]).checks.request_messages_keep_strict_prefix, false);
  const nullAssistant = nativeBodies();
  nullAssistant[0].messages.push(null);
  assert.equal(nativeRequestChecks(nullAssistant).checks.every_observation_links_original_tool_call, true);

  const payload = observationPayload({ callId: "call-1", offset: 0, nextOffset: 6000 });
  const secondPayload = observationPayload({ callId: "call-2", offset: 6000, nextOffset: 12000 });
  const oneSided = (callId, toolCallId) => [{
    messages: [
      { role: "assistant", tool_calls: [{ id: callId, function: { name: "search" } }] },
      { role: "tool", tool_call_id: toolCallId, content: JSON.stringify(payload) },
      { role: "assistant", tool_calls: [{ id: "call-2", function: { name: "search" } }] },
      { role: "tool", tool_call_id: "call-2", content: JSON.stringify(secondPayload) },
    ],
    tools: [{ type: "function", function: { name: "search" } }],
  }];
  // payload.call_id 固定为 call-1：只匹配一半的 call id 仍然必须失败。
  assert.equal(nativeRequestChecks(oneSided("call-1", "other")).checks.every_observation_links_original_tool_call, false);
  assert.equal(nativeRequestChecks(oneSided("other", "other")).checks.every_observation_links_original_tool_call, false);

  const nullCall = [{
    messages: [
      { role: "assistant", tool_calls: [null] },
      { role: "tool", tool_call_id: "call-1", content: JSON.stringify(payload) },
      { role: "assistant", tool_calls: [{ id: "call-2", function: { name: "search" } }] },
      { role: "tool", tool_call_id: "call-2", content: JSON.stringify(secondPayload) },
    ],
    tools: [{ type: "function", function: { name: "search" } }],
  }];
  assert.equal(nativeRequestChecks(nullCall).checks.every_observation_links_original_tool_call, false);
  const nullOnly = [{
    messages: [
      null,
      { role: "tool", tool_call_id: "call-1", content: JSON.stringify(payload) },
      { role: "assistant", tool_calls: [{ id: "call-2", function: { name: "search" } }] },
      { role: "tool", tool_call_id: "call-2", content: JSON.stringify(secondPayload) },
    ],
    tools: [{ type: "function", function: { name: "search" } }],
  }];
  assert.equal(nativeRequestChecks(nullOnly).checks.every_observation_links_original_tool_call, false);
});

test("续读从 previous 之后查找，两个观察也满足链接数量，空 scope 不代签", () => {
  const build = (previousOffset, previousNext, nextOffset, nextNext) => {
    const previous = observationPayload({ callId: "call-prev", offset: previousOffset, nextOffset: previousNext });
    const next = observationPayload({ callId: "call-next", offset: nextOffset, nextOffset: nextNext });
    const base = { role: "user", content: "【应用数据 · application_base】资料" };
    const tools = [{ type: "function", function: { name: "search" } }];
    const one = [{ role: "user", content: "输入" }, base, assistantCall(toolCall("call-prev")), observationMessage(previous)];
    const two = [{ role: "user", content: "输入" }, base, assistantCall(toolCall("call-next")), observationMessage(next)];
    return [one, two].map((messages) => ({ messages, tools }));
  };
  const duplicateOffset = build(6000, 6000, 6000, 12000);
  assert.equal(nativeRequestChecks(duplicateOffset).measured.continuation_call_id, "call-next");

  const twoObservations = nativeBodies().slice(0, 2);
  twoObservations[1].messages = twoObservations[1].messages.slice(0, 4);
  assert.equal(nativeRequestChecks(twoObservations).checks.every_observation_links_original_tool_call, true);

  const noContinuation = nativeBodies();
  for (const body of noContinuation) {
    body.messages = body.messages.map((message) => {
      if (message.role !== "tool") return message;
      const payload = JSON.parse(message.content);
      return payload.call_id === "call-2"
        ? observationMessage({ ...payload, content: { ...payload.content, query: JSON.stringify({ offset: 7000, chapter_ref: "chapter-1" }) } })
        : message;
    });
  }
  assert.equal(nativeRequestChecks(noContinuation).checks.continuation_observation_has_next_offset, false);
});

test("观察只绑定同一请求中在先、角色正确且唯一的 assistant 原调用", () => {
  // 多次请求回放同一历史合法：nativeBodies 的后续请求重复包含 call-1。
  assert.equal(nativeRequestChecks(nativeBodies()).checks.every_observation_links_original_tool_call, true);

  const beforeCall = nativeBodies();
  const [user, base, call, result] = beforeCall[0].messages;
  beforeCall[0].messages = [user, base, result, call];
  assert.equal(nativeRequestChecks(beforeCall).checks.every_observation_links_original_tool_call, false);

  const disguised = nativeBodies();
  disguised[0].messages = disguised[0].messages.map((message) =>
    message.tool_calls ? { ...message, role: "user" } : message,
  );
  assert.equal(nativeRequestChecks(disguised).checks.every_observation_links_original_tool_call, false);

  const duplicateCall = nativeBodies();
  const callIndex = duplicateCall[0].messages.findIndex((message) => message.role === "assistant");
  duplicateCall[0].messages.splice(callIndex, 0, structuredClone(duplicateCall[0].messages[callIndex]));
  assert.equal(nativeRequestChecks(duplicateCall).checks.every_observation_links_original_tool_call, false);

  const malformedResponse = nativeBodies();
  const responseIndex = malformedResponse[0].messages.findIndex((message) => message.role === "tool");
  malformedResponse[0].messages[responseIndex] = {
    ...malformedResponse[0].messages[responseIndex],
    content: "not json",
  };
  assert.equal(nativeRequestChecks(malformedResponse).checks.every_observation_links_original_tool_call, false);

  const unknownResponse = nativeBodies();
  unknownResponse[0].messages[responseIndex].content = JSON.stringify({ type: "other" });
  assert.equal(nativeRequestChecks(unknownResponse).checks.every_observation_links_original_tool_call, false);

  const duplicateResponse = nativeBodies();
  const observationIndex = duplicateResponse[0].messages.findIndex((message) => message.role === "tool");
  duplicateResponse[0].messages.splice(
    observationIndex + 1,
    0,
    structuredClone(duplicateResponse[0].messages[observationIndex]),
  );
  assert.equal(nativeRequestChecks(duplicateResponse).checks.every_observation_links_original_tool_call, false);
});

function validationMessage(
  callId,
  { status = "failed", reason = "judgment_protocol_invalid", detail = {} } = {},
) {
  return {
    role: "tool",
    tool_call_id: callId,
    content: JSON.stringify({
      type: "validation_result",
      call_id: callId,
      status,
      reason_code: reason,
      detail,
    }),
  };
}

// 真实原生结果图：observation 与 validation_result 都是 tool 结果，观察只是其中一类。
function mixedExchangeBodies() {
  const firstRead = observationPayload({ callId: "read-1", offset: 0, nextOffset: 6000 });
  const secondRead = observationPayload({ callId: "read-2", offset: 6000, nextOffset: 12000 });
  firstRead.content = {
    ...firstRead.content,
    summary: `已读至续读查询 ${secondRead.content.query}`,
  };
  const base = { role: "user", content: "【应用数据 · application_base】作品资料" };
  const tools = [{ type: "function", function: { name: "search" } }];
  const one = [
    { role: "user", content: "全章核对" },
    base,
    assistantCall(toolCall("read-1")),
    observationMessage(firstRead),
  ];
  const two = [
    ...one,
    { role: "assistant", content: "先核对判断协议" },
    assistantCall(toolCall("validate-1", "judgment_decision")),
    validationMessage("validate-1"),
    assistantCall(toolCall("read-2")),
    observationMessage(secondRead),
  ];
  const three = [
    ...two,
    { role: "user", content: "【应用数据 · scope_update】只读探索当前允许：false；只读探索预算已用尽" },
  ];
  return [one, two, three].map((messages) => ({ messages, tools }));
}

test("合法 validation_result 与 observation 共存、失败校验后续读仍通过完整交换关联", () => {
  const bodies = mixedExchangeBodies();
  const { checks, measured } = nativeRequestChecks(bodies);
  assert.equal(checks.every_observation_links_original_tool_call, true);
  assert.equal(checks.continuation_observation_has_next_offset, true);
  assert.equal(checks.continuation_query_is_verbatim, true);
  assert.equal(measured.observation_count, 5);
  assert.equal(measured.continuation_call_id, "read-2");
});

test("未知结果类型、空白 call id、畸形 tool_calls 与缺先调用都不能静默通过", () => {
  const unknownType = mixedExchangeBodies();
  for (const body of unknownType) {
    body.messages = body.messages.map((message) =>
      message.role === "tool" && message.tool_call_id === "validate-1"
        ? { ...message, content: JSON.stringify({ type: "note", call_id: "validate-1" }) }
        : message,
    );
  }
  assert.equal(
    nativeRequestChecks(unknownType).checks.every_observation_links_original_tool_call,
    false,
  );

  const blankIds = mixedExchangeBodies();
  for (const body of blankIds) {
    body.messages = body.messages.map((message) => {
      if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
        return {
          ...message,
          tool_calls: message.tool_calls.map((call) => ({ ...call, id: "" })),
        };
      }
      if (message.role === "tool") {
        const payload = JSON.parse(message.content);
        return { ...message, tool_call_id: "", content: JSON.stringify({ ...payload, call_id: "" }) };
      }
      return message;
    });
  }
  assert.equal(
    nativeRequestChecks(blankIds).checks.every_observation_links_original_tool_call,
    false,
  );

  const whitespaceIds = mixedExchangeBodies();
  for (const body of whitespaceIds) {
    body.messages = body.messages.map((message) => {
      if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
        return {
          ...message,
          tool_calls: message.tool_calls.map((call) => ({ ...call, id: "   " })),
        };
      }
      if (message.role === "tool") {
        const payload = JSON.parse(message.content);
        return {
          ...message,
          tool_call_id: "   ",
          content: JSON.stringify({ ...payload, call_id: "   " }),
        };
      }
      return message;
    });
  }
  assert.equal(
    nativeRequestChecks(whitespaceIds).checks.every_observation_links_original_tool_call,
    false,
  );

  for (const malformedCalls of [
    "not-an-array",
    { id: "read-2" },
    [null],
    [{ function: { name: "search" } }],
    [Object.assign([], { id: "read-2" })],
  ]) {
    const bodies = mixedExchangeBodies();
    const assistant = bodies[1].messages.find(
      (message) => message.role === "assistant" && message.tool_calls?.some((call) => call?.id === "read-2"),
    );
    assistant.tool_calls = malformedCalls;
    assert.equal(
      nativeRequestChecks(bodies).checks.every_observation_links_original_tool_call,
      false,
    );
  }

  // 畸形 tool_calls 即使没有对应 tool 响应，也不能被当作“没有调用”放过。
  const strayMalformedCalls = mixedExchangeBodies();
  strayMalformedCalls[1].messages.push({ role: "assistant", tool_calls: "not-an-array" });
  assert.equal(
    nativeRequestChecks(strayMalformedCalls).checks.every_observation_links_original_tool_call,
    false,
  );

  const nonObjectPayloads = mixedExchangeBodies();
  for (const body of nonObjectPayloads) {
    body.messages = body.messages.map((message) =>
      message.role === "tool" && message.tool_call_id === "validate-1"
        ? { ...message, content: "[]" }
        : message,
    );
  }
  assert.equal(
    nativeRequestChecks(nonObjectPayloads).checks.every_observation_links_original_tool_call,
    false,
  );

  const missingCall = mixedExchangeBodies();
  for (const body of missingCall) {
    body.messages = body.messages.filter(
      (message) =>
        !(message.role === "assistant" && message.tool_calls?.some((call) => call.id === "validate-1")),
    );
  }
  assert.equal(
    nativeRequestChecks(missingCall).checks.every_observation_links_original_tool_call,
    false,
  );

  const mismatchedValidation = mixedExchangeBodies();
  for (const body of mismatchedValidation) {
    body.messages = body.messages.map((message) =>
      message.role === "tool" && message.tool_call_id === "validate-1"
        ? { ...message, tool_call_id: "other-call" }
        : message,
    );
  }
  assert.equal(
    nativeRequestChecks(mismatchedValidation).checks.every_observation_links_original_tool_call,
    false,
  );

  const duplicateValidation = mixedExchangeBodies();
  const validationIndex = duplicateValidation[1].messages.findIndex(
    (message) => message.role === "tool" && message.tool_call_id === "validate-1",
  );
  duplicateValidation[1].messages.splice(
    validationIndex + 1,
    0,
    structuredClone(duplicateValidation[1].messages[validationIndex]),
  );
  assert.equal(
    nativeRequestChecks(duplicateValidation).checks.every_observation_links_original_tool_call,
    false,
  );
});

test("scope 只含一半收口文本、单个 base、多个 scope 时仍按最后一条判断", () => {
  const halfScope = nativeBodies();
  halfScope[2].messages.at(-1).content = "【应用数据 · scope_update】只读探索当前允许：false";
  assert.equal(nativeRequestChecks(halfScope).checks.latest_scope_closes_exploration, false);

  const twoScopes = nativeBodies();
  twoScopes[2].messages.splice(-1, 0, { role: "user", content: "【应用数据 · scope_update】只读探索当前允许：true" });
  assert.equal(nativeRequestChecks(twoScopes).checks.latest_scope_closes_exploration, true);

  const oneBase = [{
    messages: [
      { role: "user", content: "【应用数据 · application_base】资料" },
      null,
      assistantCall(toolCall("call-1")),
      observationMessage(observationPayload({ callId: "call-1", offset: 0, nextOffset: 6000 })),
    ],
    tools: [{ type: "function", function: { name: "search" } }],
  }];
  assert.equal(nativeRequestChecks(oneBase).checks.application_base_does_not_duplicate_observation, true);
});

test("工具名、调用与结果块拒绝空元素，并保留显式空名称不被备用字段掩盖", () => {
  assert.deepEqual(bodyToolNames(null), []);
  assert.deepEqual(bodyToolNames({ tools: [null, { name: "", function: { name: "fallback" } }, { name: "real" }] }), ["real"]);
  assert.deepEqual(bodyToolNames({ tools: [{ name: "", function: { name: "fallback" } }, { name: "x" }] }), ["x"]);
  assert.deepEqual(nativeCalls([null, { tool_calls: [null, { id: "x", name: "fallback", function: { name: "" } }] }]), []);
  assert.deepEqual(nativeCalls([{ tool_calls: [{ id: "x", function: { name: "fn" } }] }]), ["fn"]);
  assert.deepEqual(nativeCalls([{ tool_calls: [{ id: "x", name: "plain" }] }]), ["plain"]);
  assert.deepEqual(resultBlocks([null, { role: "assistant", content: JSON.stringify({ type: "validation_result" }) }], "validation_result"), []);
  assert.deepEqual(resultBlocks([{ role: "tool", content: "null" }], "validation_result"), []);
  assert.deepEqual(canonicalCalls([null, { blocks: [null, { type: "tool_call", name: "x" }] }]), ["x"]);
  assert.deepEqual(canonicalValidations([null, { blocks: [null, { type: "validation_result" }] }]), [{ type: "validation_result" }]);
});

test("持久阶段顺序在空列表、无续行判定与空调用名时失败", () => {
  const continuation = { role: "assistant", tool_calls: [{ id: "c", function: { name: "continuation_decision" } }] };
  const submit = { role: "assistant", tool_calls: [{ id: "s", function: { name: "submit_tentative_artifact" } }] };
  const persisted = [
    { role: "assistant", blocks: [{ type: "tool_call", call_id: "c", name: "continuation_decision" }] },
    { role: "assistant", blocks: [{ type: "tool_call", call_id: "s", name: "submit_tentative_artifact" }] },
    { role: "assistant", blocks: [{ type: "tool_call", call_id: "r", name: "report_quality_findings" }] },
  ];
  assert.equal(nativeStageHistoryPreserved([], [continuation, submit]), false);
  assert.equal(nativeStageHistoryPreserved([null], [null]), false);
  assert.equal(nativeStageHistoryPreserved([{ blocks: [null] }], [continuation, submit]), false);
  assert.equal(nativeStageHistoryPreserved(persisted, [{
    role: "assistant",
    tool_calls: [null, continuation.tool_calls[0], submit.tool_calls[0]],
  }]), false);
  const noContinuationPersisted = persisted.slice(1);
  assert.equal(nativeStageHistoryPreserved(noContinuationPersisted, [submit]), false);
  assert.equal(nativeStageHistoryPreserved(persisted, [continuation, {
    role: "assistant",
    tool_calls: [{ id: "s", name: "submit_tentative_artifact", function: { name: "" } }],
  }]), false);
  assert.equal(nativeStageHistoryPreserved(persisted, [continuation, submit]), true);
  assert.equal(nativeStageHistoryPreserved(persisted, [submit]), false);
});

test("续航阶段缺 writer、错 detail、错状态与缺 durable 时对应检查为 false", () => {
  const missingWriter = continuationFixture();
  missingWriter.records = [missingWriter.records[0], missingWriter.records[2]];
  const missing = continuationRequestChecks(missingWriter.records, missingWriter.durable).checks;
  assert.equal(missing.planning_and_mission_calls_reach_writer, false);
  assert.equal(missing.planning_and_mission_validation_reach_writer, false);
  assert.equal(missing.writer_stage_only_offers_tentative_tool, false);
  assert.equal(missing.quality_stage_only_offers_quality_tool, true);
  const missingQuality = continuationFixture();
  missingQuality.records.pop();
  const noQuality = continuationRequestChecks(missingQuality.records, missingQuality.durable).checks;
  assert.equal(noQuality.quality_stage_only_offers_quality_tool, false);
  assert.equal(noQuality.durable_checkpoint_keeps_native_stage_order, false);

  for (const mutate of [
    (payload) => { payload.detail.execution_authorized = true; },
    (payload) => { payload.detail.canon_written = true; },
    (payload) => { payload.status = "failed"; },
    (payload) => { delete payload.reason_code; },
    (payload) => { delete payload.detail; },
  ]) {
    const fixture = continuationFixture();
    for (const record of fixture.records) {
      for (const message of record.request.body.messages) {
        if (message.role !== "tool" || message.tool_call_id !== "call-plan") continue;
        const payload = JSON.parse(message.content);
        mutate(payload);
        message.content = JSON.stringify(payload);
      }
    }
    assert.equal(continuationRequestChecks(fixture.records, fixture.durable).checks.planning_and_mission_validation_reach_writer, false);
  }

  const failedClosure = continuationFixture();
  for (const message of failedClosure.durable.messages) {
    for (const block of message.blocks ?? []) {
      if (block.reason_code === "quality_findings_validated") block.status = "failed";
    }
  }
  assert.equal(continuationRequestChecks(failedClosure.records, failedClosure.durable).checks.durable_checkpoint_closes_writer_and_quality, false);
  const mismatchedReason = continuationFixture();
  for (const message of mismatchedReason.durable.messages) {
    for (const block of message.blocks ?? []) {
      if (block.reason_code === "quality_findings_validated") block.reason_code = "other";
    }
  }
  assert.equal(continuationRequestChecks(mismatchedReason.records, mismatchedReason.durable).checks.durable_checkpoint_closes_writer_and_quality, false);
  assert.equal(continuationRequestChecks(continuationFixture().records, {}).checks.durable_checkpoint_keeps_native_stage_order, false);
  assert.equal(continuationRequestChecks(continuationFixture().records, null).checks.durable_checkpoint_keeps_native_stage_order, false);
});

function characterFixture() {
  const judgmentMessages = [{ role: "user", content: "角色设计" }];
  const writerMessages = [
    ...judgmentMessages,
    wireAssistant([wireCall("call-judgment", "judgment_decision")]),
    wireResult("call-judgment", "judgment_validated"),
  ];
  return {
    records: [
      requestRecord(wireBody(judgmentMessages, ["judgment_decision"])),
      requestRecord(wireBody(writerMessages, ["submit_tentative_artifact"])),
    ],
    durable: {
      messages: [
        canonicalCall("call-judgment", "judgment_decision"),
        canonicalCall("call-writer", "submit_tentative_artifact"),
        { role: "tool", blocks: [passed("call-writer", "tentative_artifact_validated")] },
      ],
    },
  };
}

test("角色阶段缺 writer、重复 writer 取最后一次且缺失 durable 关闭", () => {
  const fixture = characterFixture();
  const missingWriter = characterRequestChecks([fixture.records[0]], fixture.durable).checks;
  assert.equal(missingWriter.judgment_and_writer_keep_strict_prefix, false);
  assert.equal(missingWriter.writer_stage_only_offers_tentative_tool, false);

  const duplicate = characterFixture();
  const writerBody = wireBody([{ role: "user", content: "另一个 writer" }], ["submit_tentative_artifact"]);
  duplicate.records.push(requestRecord(writerBody));
  const duplicateChecks = characterRequestChecks(duplicate.records, duplicate.durable).checks;
  assert.equal(duplicateChecks.judgment_and_writer_keep_strict_prefix, false);

  const noDurable = characterRequestChecks(fixture.records, {}).checks;
  assert.equal(noDurable.durable_checkpoint_keeps_judgment_and_writer, false);
  assert.equal(noDurable.durable_checkpoint_closes_writer, false);

  const missingWriterStage = characterRequestChecks([fixture.records[0]], fixture.durable).checks;
  assert.equal(missingWriterStage.writer_stage_only_offers_tentative_tool, false);
  const extraWriterTool = characterFixture();
  extraWriterTool.records[1].request.body.tools.push({ type: "function", function: { name: "other" } });
  assert.equal(characterRequestChecks(extraWriterTool.records, extraWriterTool.durable).checks.writer_stage_only_offers_tentative_tool, false);
  assert.equal(characterRequestChecks(fixture.records, null).checks.durable_checkpoint_keeps_judgment_and_writer, false);
  const failedCharacterClosure = characterFixture();
  failedCharacterClosure.durable.messages.at(-1).blocks[0].status = "failed";
  assert.equal(characterRequestChecks(failedCharacterClosure.records, failedCharacterClosure.durable).checks.durable_checkpoint_closes_writer, false);
  const mismatchedCharacterReason = characterFixture();
  mismatchedCharacterReason.durable.messages.at(-1).blocks[0].reason_code = "other";
  assert.equal(characterRequestChecks(mismatchedCharacterReason.records, mismatchedCharacterReason.durable).checks.durable_checkpoint_closes_writer, false);
});

test("结果判据在 turnResult 为空、pending 为空与 ack 非 durable 时关闭", () => {
  const base = {
    visible: "正文草稿 保存为章节正文",
    turnResult: { agent_run: { run_id: "run-1" }, adoption_state: { pending: [] }, quality_review: { review_status: "completed" } },
    runId: "run-1",
    start: {},
    final: {},
    fingerprintUnchanged: true,
  };
  assert.equal(continuationOutcomeChecks({ ...base, turnResult: null }).recovered_same_run, false);
  assert.equal(continuationOutcomeChecks({ ...base, turnResult: null }).pending_prose_remains_tentative, false);
  assert.equal(continuationOutcomeChecks({ ...base, turnResult: { agent_run: null } }).recovered_same_run, false);
  assert.equal(continuationOutcomeChecks({ ...base, visible: "正文草稿" }).real_native_window_shows_tentative_candidate, false);
  assert.equal(continuationOutcomeChecks({ ...base, visible: "保存为章节正文" }).real_native_window_shows_tentative_candidate, false);
  assert.equal(continuationOutcomeChecks({ ...base, turnResult: { adoption_state: null } }).pending_prose_remains_tentative, false);
  assert.equal(continuationOutcomeChecks(base).no_production_write, true);

  const character = {
    visible: "角色设定草稿 保存所选方案到作品档案",
    why: "回放只读取已保存记录，不会重新调用模型",
    turnResult: { agent_run: { run_id: "run-1" }, adoption_state: { pending: [] } },
    ackBody: { response: { run_mode: "durable" } },
    runId: "run-1",
    start: {},
    final: {},
    fingerprintUnchanged: true,
    request: { checks: {} },
  };
  assert.equal(characterOutcomeChecks({ ...character, turnResult: null }).recovered_same_durable_run, false);
  assert.equal(characterOutcomeChecks({ ...character, turnResult: null }).pending_character_remains_tentative, false);
  assert.equal(characterOutcomeChecks({ ...character, turnResult: { agent_run: null } }).recovered_same_durable_run, false);
  assert.equal(characterOutcomeChecks({ ...character, ackBody: null }).recovered_same_durable_run, false);
  assert.equal(characterOutcomeChecks({ ...character, ackBody: { response: null } }).recovered_same_durable_run, false);
  assert.equal(characterOutcomeChecks({ ...character, visible: "角色设定草稿" }).real_native_window_shows_tentative_character, false);
  assert.equal(characterOutcomeChecks({ ...character, visible: "保存所选方案到作品档案" }).real_native_window_shows_tentative_character, false);
});

test("计划待定结果对 0/1 个条目与空统计保持关闭", () => {
  const one = [{ adoption_state: { pending: [{ artifact_id: "id-1", artifact_type: "character_seed", adoption_status: "TENTATIVE", source_tool_result_ref: "ref-1" }] } }];
  assert.equal(planningPendingResults(one, ["id-1"]), false);
  assert.equal(planningPendingResults([null, { adoption_state: null }], []), false);
  assert.equal(planningPendingResults([], []), false);
});

test("durable run、revision 事件与 Why 窗口对 null 元素和边界时刻保持精确", () => {
  assert.equal(completedDurableRun({ response: { run_mode: "durable" } }, null), false);
  assert.equal(completedDurableRun({}, { run_mode: "durable", status: "completed" }), false);
  assert.equal(completedDurableRun({ response: null }, { run_mode: "durable", status: "completed" }), false);
  assert.equal(completedDurableRun({ response: { run_mode: "durable" } }, { run_mode: "durable", status: "completed" }), true);
  assert.equal(singleRevisionEvent([null], "run-1"), false);
  assert.equal(singleRevisionEvent([{ event: "agent_event", body: null }], "run-1"), false);
  assert.equal(singleRevisionEvent([{ event: "agent_event", body: { run_ref: "run-1", event_type: "plan_revised", payload: null } }], "run-1"), false);

  const base = {
    facts: null,
    results: [null],
    durable: { record: null },
    wire: [null],
    beforeWhy: { at: "2026-11-01T08:00:01.000Z" },
    afterWhy: { at: "2026-11-01T08:00:03.000Z" },
    appRecords: [{ event: "provider_gateway.complete.start", timestamp: "2026-11-01T08:00:00.000Z" }],
    llmRecords: [{ ts: "2026-11-01T08:00:00.000Z" }],
  };
  assert.equal(planningWhyChecks(base).why_uses_scoped_persisted_replay, false);
  assert.equal(planningWhyChecks({ ...base, facts: { turnId: "turn-1" }, results: [], wire: [] }).why_uses_scoped_persisted_replay, false);

  const boundary = {
    ...base,
    facts: { turnId: "turn-1" },
    results: [],
    durable: { record: { work_id: "work-1", session_id: "session-1" } },
    wire: [{
      direction: "http",
      status: 200,
      path: "/api/works/work-1/sessions/session-1/turns/turn-1/replay",
      at: "2026-11-01T08:00:01.000Z",
    }],
  };
  assert.equal(planningWhyChecks(boundary).why_uses_scoped_persisted_replay, true);
  assert.equal(planningWhyChecks({ ...boundary, wire: [{ ...boundary.wire[0], at: boundary.afterWhy.at }] }).why_uses_scoped_persisted_replay, true);
  assert.equal(planningWhyChecks({ ...boundary, wire: [{ ...boundary.wire[0], at: "2026-11-01T08:00:00.999Z" }] }).why_uses_scoped_persisted_replay, false);
  assert.equal(planningWhyChecks({ ...boundary, beforeWhy: null }).why_uses_scoped_persisted_replay, false);
  assert.equal(planningWhyChecks({ ...boundary, afterWhy: null }).why_does_not_call_provider, false);

  const noDurable = planningOutcomeChecks({ ...planningOutcomeFixture(), durable: null });
  assert.equal(noDurable.checks.planning_run_is_durable_and_completed, false);
  assert.equal(noDurable.checks.two_types_remain_tentative, false);
  assert.equal(noDurable.checks.exactly_one_plan_revision_event, false);
});

test("空章节 ref 的 measured 保留显式空字符串，空调用号不再是合法身份", () => {
  const bodies = nativeBodies();
  const emptyQuery = JSON.stringify({ offset: 6000, chapter_ref: "" });
  for (const body of bodies) {
    body.messages = body.messages.map((message) => {
      if (message.role !== "tool") return message;
      const payload = JSON.parse(message.content);
      if (payload.call_id === "call-1") {
        return observationMessage({
          ...payload,
          content: { ...payload.content, summary: `已读至续读查询 ${emptyQuery}` },
        });
      }
      if (payload.call_id !== "call-2") return message;
      return observationMessage({
        ...payload,
        source_refs: [""],
        content: { ...payload.content, query: emptyQuery },
      });
    });
  }
  const { checks, measured } = nativeRequestChecks(bodies);
  assert.equal(checks.continuation_query_is_verbatim, true);
  assert.equal(checks.observation_has_real_chapter_ref, true);
  assert.equal(measured.continuation_call_id, "call-2");
  assert.equal(measured.continuation_chapter_ref, "");

  const blankCall = nativeBodies();
  for (const body of blankCall) {
    body.messages = body.messages.map((message) => {
      if (message.role === "assistant") {
        return {
          ...message,
          tool_calls: message.tool_calls.map((call) =>
            call.id === "call-2" ? { ...call, id: "" } : call,
          ),
        };
      }
      if (message.role !== "tool") return message;
      const payload = JSON.parse(message.content);
      if (payload.call_id !== "call-2") return message;
      return observationMessage({ ...payload, call_id: "" });
    });
  }
  assert.equal(
    nativeRequestChecks(blankCall).checks.every_observation_links_original_tool_call,
    false,
  );
});

test("失败摘要对 null joined 返回空串而不是抛错", () => {
  assert.equal(nativeCallFailureSummary(null), "");
  assert.equal(nativeCallFailureSummary({ failures: [{ reason: "missing", phase: "binding" }, { reason: "missing", phase: "binding" }] }), "missing:binding");
});
