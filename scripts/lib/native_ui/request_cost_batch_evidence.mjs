// B87 R01 批次纯判据/报告聚合：只消费已采集的 turn/call 事实，不做 IO/DB 查询。
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { wireTerminal } from "./live_run_wait.mjs";
import { axTurnOutcome, countAxAuthorMessages } from "./authoring_g2_evidence.mjs";
import { analyzeRequestCost } from "./request_cost_evidence.mjs";
import { auditDiscussionRequest } from "./authoring_checkpoint_coverage.mjs";
import { LENGTHS, PREREGISTERED_SOURCE_KIND, SUCCESSOR_MANIFEST_SCHEMA, knownNumberAggregate, prefixComparison, tokenAggregate } from "./request_cost_manifest.mjs";
import { canonicalCoverageForProviderCall, joinNativeCallEvidence, scopeForProviderCall } from "./authoring_call_evidence.mjs";
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";

const list = (value) => (Array.isArray(value) ? value : []);
const purposeOf = (purposes, ref) => purposes.get(ref) ?? null;

export const NATIVE_REPORT_SCHEMA = "b87-request-cost-native-report/v2";

export function nativeSummary({ config, turnReports, allCalls, rawTransport = null }) {
  return {
    turns_expected: config.length,
    turns_completed: turnReports.filter((turn) => turn.status === "completed").length,
    calls: allCalls.length,
    input_tokens: tokenAggregate(allCalls, "input_tokens"),
    cached_tokens: tokenAggregate(allCalls, "cached_tokens"),
    output_tokens: tokenAggregate(allCalls, "output_tokens"),
    raw_http_bytes: rawTransport?.raw_http_bytes ?? "not_collected",
    raw_sse: rawTransport?.raw_sse ?? "not_collected",
    raw_source_scope: rawTransport?.source_scope ?? "llm_call_logs_only",
    per_category_tokens: "not_collected",
    cached_is_input_subset: allCalls.every(
      (call) => call.analysis.usage.cached_within_input !== false,
    ),
    no_cached_double_add: allCalls.every(
      (call) => call.analysis.usage.cost_input_tokens === call.analysis.usage.input_tokens,
    ),
    prefix_change_count: allCalls.filter(
      (call) => call.prefix_change && call.prefix_change.kind !== "append",
    ).length,
  };
}

// Projection of separately bound calls, not an authorization to execute another turn.
export function observationCostSummary(subjectTurnReports, successorTurnReport, config) {
  const successorReports = successorTurnReport ? [successorTurnReport] : [];
  const summarize = (turnReports, length) => nativeSummary({
    config: { length }, turnReports, allCalls: turnReports.flatMap(turn => turn.calls),
  });
  const successorCount = config.successor_observation ? 1 : 0;
  return {
    subject: summarize(subjectTurnReports, config.length),
    successor: summarize(successorReports, successorCount),
    total: summarize([...subjectTurnReports, ...successorReports], config.length + successorCount),
  };
}

function outcomeOf(turn) {
  return {
    turn: turn.turn,
    author_id: turn.author_id,
    visible_outcome: turn.driver?.visible_outcome?.kind ?? "not_collected",
    run_id: turn.driver?.run_id ?? null,
    freshness: turn.driver?.freshness ?? null,
    provider_calls: turn.calls.length,
    actual_tool_calls: toolCallAggregate(turn.calls),
  };
}

function outcomeCounts(outcomes) {
  const counts = {};
  for (const outcome of outcomes) {
    counts[outcome.visible_outcome] = (counts[outcome.visible_outcome] ?? 0) + 1;
  }
  return counts;
}

function changedFact(ok) {
  return ok === false ? true : ok === true ? false : null;
}

// 变化事实只陈述“观测到变化”，不自动判定产品偏离或语义错误：
// 有合同的变化（如 model/TENTATIVE 使命）是否符合作者意图须独立评审。
export function observedEffectsOf(checks = {}) {
  return {
    canon_content_changed: changedFact(checks.runtime_content_intact),
    business_content_changed: changedFact(checks.runtime_business_content_intact),
    production_counts_changed: changedFact(checks.production_counts_unchanged),
    works_title_changed: changedFact(checks.post_run_works_title_matches),
    works_revision_changed: changedFact(checks.post_run_works_revision_matches),
    session_changed: changedFact(checks.post_run_session_active),
  };
}

// 引用/跨作品不变量与“发生了什么变化”分开：false 表示违反了明确约束，
// 不能被改名成中性的变化事实而掩盖。
export function referenceInvariantsOf(checks = {}) {
  return {
    unaccounted_reference_updates: changedFact(checks.memory_reference_updates_accounted),
    reference_logs_other_work: changedFact(checks.reference_logs_target_work_only),
    other_work_reference_changed: changedFact(checks.other_work_reference_bookkeeping_intact),
  };
}

export function modelBehaviorOf(
  turns,
  { checks = {}, referenceAccounting = null, checkpointChanges = null } = {},
) {
  const outcomes = turns.map(outcomeOf);
  return {
    signed: false,
    scope: "before_only",
    raw_gap_source_scope: "llm_call_logs_only; external batch inventory is separate",
    outcomes,
    outcome_counts: outcomeCounts(outcomes),
    observed_effects: observedEffectsOf(checks),
    reference_invariants: referenceInvariantsOf(checks),
    reference_accounting: referenceAccounting,
    checkpoint_changes: checkpointChanges,
    gaps: [
      "raw_http_bytes_not_collected",
      "raw_sse_not_collected",
      "per_category_tokens_not_collected",
      "model_quality_not_signed",
    ],
  };
}

// R01 三问的语义评审只能由 leader 在真实批次后签；测量表只做目标映射与证据索引。
// “证据可读”不等于“回答正确”：默认 pending_independent_review，只有缺调用/坏分析/
// 未归类材料才降为 insufficient_evidence，绝不自动写“符合”。
export const SEMANTIC_VERDICTS = Object.freeze([
  "pending_independent_review",
  "conforms",
  "deviates",
  "insufficient_evidence",
]);

function targetFor(targets, turn) {
  const match = list(targets).find(
    (target) => target.author_id === turn.author_id,
  );
  return match ?? null;
}

function callFact(call, key) {
  return call.analysis.category_bytes[key];
}

function categorySum(calls, key) {
  return calls.reduce((sum, call) => sum + callFact(call, key), 0);
}

// 响应工具调用与 usage 同语义：已知调用求和，缺证单独计数且不产出 total。
function toolCallAggregate(calls) {
  return knownNumberAggregate(
    calls.map((call) => call.analysis.response.actual_tool_calls),
  );
}

function replayToolCallSum(calls) {
  return calls.reduce((sum, call) => sum + call.analysis.cross.replay_tool_calls, 0);
}

function unclassifiedSum(calls) {
  return calls.reduce(
    (sum, call) => sum + call.analysis.cross.unclassified_messages,
    0,
  );
}

function callsWithCategory(calls, key) {
  return calls.filter((call) => callFact(call, key) > 0).length;
}

function semanticFacts(calls) {
  return {
    provider_calls: calls.length,
    analysis_ok: calls.length > 0 && calls.every((call) => call.analysis.ok === true),
    input_tokens: tokenAggregate(calls, "input_tokens").known_sum,
    actual_tool_calls: toolCallAggregate(calls),
    replay_tool_calls: replayToolCallSum(calls),
    observation_calls: callsWithCategory(calls, "observation"),
    validation_calls: callsWithCategory(calls, "validation"),
    observation_bytes: categorySum(calls, "observation"),
    validation_bytes: categorySum(calls, "validation"),
    scope_bytes: categorySum(calls, "scope"),
    history_bytes: categorySum(calls, "history"),
    current_author_bytes: categorySum(calls, "current_author"),
    application_base_bytes: categorySum(calls, "application_base"),
    tools_bytes: categorySum(calls, "tools"),
    unclassified_messages: unclassifiedSum(calls),
    tools_field_present: calls.some(
      (call) => call.analysis.cross.tools_field_present === true,
    ),
    request_sha256: calls.map((call) => call.analysis.request.sha256 ?? null),
  };
}

function semanticVerdict(facts) {
  const enough = facts.analysis_ok && facts.unclassified_messages === 0;
  return {
    verdict: enough ? "pending_independent_review" : "insufficient_evidence",
    basis: enough
      ? "evidence_present_semantics_pending_leader_review"
      : "missing_or_unusable_evidence",
  };
}

function evidenceRefs(turn, facts) {
  return facts.request_sha256.map((_, index) => `turns[${turn.turn - 1}].calls[${index}]`);
}

function semanticRow(turn, target) {
  const facts = semanticFacts(list(turn.calls));
  const verdict = semanticVerdict(facts);
  return {
    turn: turn.turn,
    author_id: turn.author_id,
    target_id: target?.id ?? null,
    target_question: target?.question ?? null,
    review_focus: list(target?.review_focus),
    facts_classification: facts,
    intent: "not_measured",
    target_effect_and_authorization: "not_measured",
    continuity_and_evidence_seeking: {
      history_bytes: facts.history_bytes,
      replay_tool_calls: facts.replay_tool_calls,
      observation_calls: facts.observation_calls,
      scope_bytes: facts.scope_bytes,
    },
    verdict: verdict.verdict,
    verdict_basis: verdict.basis,
    evidence_refs: evidenceRefs(turn, facts),
  };
}

export function semanticReviewOf(turns, targets, canonEvidence = null) {
  const rows = list(turns).map((turn) => semanticRow(turn, targetFor(targets, turn)));
  return {
    // semanticRow 只产出自动 verdict（pending_independent_review / insufficient_evidence）；
    // 本报告没有人工审查输入，因此永不自签，所有自动行都仍未解决。
    signed: false,
    scope: "target_mapping_and_evidence_index",
    canon_evidence: canonEvidence,
    targets: list(targets).map((target) => ({
      author_id: target.author_id,
      id: target.id,
      question: target.question,
      review_focus: list(target.review_focus),
    })),
    verdicts: SEMANTIC_VERDICTS,
    rows,
    unresolved: rows.length,
  };
}

function evidenceBoundaries(config, failures) {
  return {
    data_validity: {
      reference_logs: config.setup?.reference_logs_count ?? null,
      source_reference_logs_sha256: config.setup?.reference_logs_sha256 ?? null,
    },
    reader_errors: failures.filter((entry) =>
      /invalid_authoring_canon_snapshot|checkpoint_authoring_canon_missing|runtime_facts/i.test(entry)),
    model_semantics: "semantic_review 默认待独立评审；本报告不签模型理解/创作质量",
  };
}

// 缺这些事实时测量不完整；它们只能降低 measurement_status，不能改写成反例。
const MEASUREMENT_GAPS = new Set([
  "start_checkpoint",
  "llm_calls",
  "runtime_wire",
  "production_counts",
  "reference_accounting",
  "provider_run_incomplete",
  "provider_call_log_missing",
  // 实际 batch 运行清单读取失败是缺证，不是 unsafe；必须把整份报告降为 partial。
  "run_inventory",
]);


export function buildNativeReport({
  batchDir,
  config,
  checks,
  failures,
  hardFailures,
  notCollected,
  turnReports,
  allCalls,
  referenceAccounting = null,
  checkpointChanges = null,
  requestObservation = null,
  compactionEvidence = null,
  rawTransport = null,
}) {
  const observedEffects = observedEffectsOf(checks);
  const canonEvidence = {
    observed_effects: observedEffects,
    reference_invariants: referenceInvariantsOf(checks),
    reference_accounting: referenceAccounting,
    checkpoint_changes: checkpointChanges,
  };
  const softIncomplete =
    compactionEvidence?.status === "partial" ||
    !checks.turn_count_ok ||
    !checks.driver_completed ||
    checks.visible_outcomes_recorded === false ||
    checks.freshness_recorded === false ||
    checks.successor_visible === false ||
    notCollected.some((key) => key.startsWith("turn_") || MEASUREMENT_GAPS.has(key));
  const status = hardFailures.length > 0 ? "fail" : softIncomplete ? "partial" : "pass";
  return {
    schema: NATIVE_REPORT_SCHEMA,
    generated_at: new Date().toISOString(),
    status,
    measurement_status: status,
    signed: false,
    scope: compactionEvidence ? "r03_mechanism_and_preregistered_review" : "r01_measurement_only",
    compaction: compactionEvidence,
    model_behavior: modelBehaviorOf(turnReports, {
      checks,
      referenceAccounting,
      checkpointChanges,
    }),
    semantic_review: semanticReviewOf(turnReports, config.semantic_targets, canonEvidence),
    manifest: config.manifest,
    batch: {
      dir: path.resolve(batchDir),
      length: config.length,
      work: config.work,
      session_id: config.session_id,
      seed_sha256: config.seed.content_sha256,
    },
    model: config.model,
    runtime: config.runtime,
    request_observation: requestObservation,
    raw_transport: rawTransport,
    reference_accounting: referenceAccounting,
    evidence_boundaries: evidenceBoundaries(config, failures),
    checks,
    failures,
    not_collected: [...new Set(notCollected)],
    prefix_changes: allCalls
      .filter((call) => call.prefix_change && call.prefix_change.kind !== "append")
      .map((call) => ({
        turn: call.turn,
        call_index: call.call_index,
        kind: call.prefix_change.kind,
        shared: call.prefix_change.shared,
      })),
    summary: nativeSummary({ config, turnReports, allCalls, rawTransport }),
    turns: turnReports,
  };
}



function isApplicationMessage(message) {
  return (
    message?.role === "user" &&
    typeof message.content === "string" &&
    message.content.startsWith("【应用数据 · ")
  );
}

function authorMatches(messages, author) {
  return messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        message?.role === "user" &&
        typeof message.content === "string" &&
        message.content === author.text,
    );
}

function expectedAuthorMessage(messages, author, expectedIndex) {
  const message = messages[expectedIndex];
  return message?.role === "user" && message.content === author.text
    ? { message, index: expectedIndex }
    : null;
}

function lastAuthorMessage(messages, author) {
  const matches = authorMatches(messages, author);
  if (matches.length === 0) return null;
  const last = matches.at(-1);
  // 冻结序列会重复同一作者原话；本轮输入是请求中最后一条独立 user，且其后只允许
  // 应用数据（scope/base）。若其后还有 assistant/tool/独立 user，则不能靠“最后一条”猜。
  const tail = messages.slice(last.index + 1);
  return tail.every(isApplicationMessage) ? last : null;
}

function canonicalAuthorMessage(record, author, transcript) {
  const coverage = canonicalCoverageForProviderCall(record, transcript);
  const facts = requestFactsFromRecord(record);
  if (!coverage?.ok || !facts.ok) return null;
  const authors = coverage.retainedMessages.filter(
    (message) => message.role === "user" && message.provenance === "author",
  );
  const textOf = (message) => list(message.blocks).map((block) => block.text ?? "").join("");
  if (authors.length !== facts.authorMessages.length || authors.some((message, index) =>
    !list(message.blocks).every((block) => block.type === "text" && typeof block.text === "string") ||
    textOf(message) !== facts.authorMessages[index].text)) return null;
  const run = transcript.run;
  if (!run?.run_id || run.parent_turn_ref !== record.turn_id ||
    run.work_id !== record.work_id || run.session_id !== record.session_id) return null;
  const matches = authors.map((message, ordinal) => ({ message, ordinal })).filter(({ message }) => {
    const ref = message.canonical_ref;
    return ref?.run_id === run.run_id && ref.parent_turn_ref === record.turn_id &&
      ["workspace_id", "work_id", "session_id"].every((key) => ref[key] === run[key]) &&
      list(message.source_refs).length === 1 && message.source_refs[0]?.ref === record.turn_id;
  });
  if (matches.length !== 1 || textOf(matches[0].message) !== author.text) return null;
  const index = facts.authorMessages[matches[0].ordinal].index;
  return { message: record.request.body.messages[index], index };
}

function findAuthorMessage(record, author, expectedIndex = null, history = null) {
  const transcript = history?.transcript;
  // Canonical identity outranks a prior wire offset: valid coverage can move that offset.
  // Never recover by matching text alone; equal text can belong to an older author turn.
  if (history?.record || history?.segment || Object.hasOwn(history ?? {}, "sessionMessages") ||
    list(transcript?.messages).some((message) => message.canonical_ref ||
      (transcript?.run?.run_id && message.role === "user" && message.provenance === "author"))) {
    // A run segment is not a session projection. Missing session evidence must fail closed.
    if (!Array.isArray(history?.sessionMessages)) return null;
    return canonicalAuthorMessage(record, author, {
      ...transcript, messages: history.sessionMessages,
    });
  }
  const messages = list(record?.request?.body?.messages);
  return expectedIndex !== null
    ? expectedAuthorMessage(messages, author, expectedIndex)
    : lastAuthorMessage(messages, author);
}

function recordModel(record) {
  return record.request.body.model ?? null;
}

function recordReasoning(record) {
  return record.request.body.reasoning_effort ?? null;
}


export function verifyPcall({ plan, record, callIndex, seenPcalls, fail }) {
  const prefix = `turn_${plan.turn}_call_${callIndex + 1}`;
  const pcall = record.provider_call_ref ?? null;
  if (!pcall) fail(`${prefix}_pcall`, "provider_call_ref_missing");
  else if (seenPcalls.has(pcall)) fail(`${prefix}_pcall`, "duplicate_provider_call_ref");
  else seenPcalls.add(pcall);
  return prefix;
}

function verifyCallModel({ record, prefix, config, fail }) {
  if (recordModel(record) !== config.model.model) {
    fail(`${prefix}_model`, "request_model_mismatch");
  }
  if (recordReasoning(record) !== config.model.reasoning_effort) {
    fail(`${prefix}_reasoning`, "reasoning_effort_mismatch");
  }
}

function verifyCallUsage({ analysis, prefix, config, fail, notCollected }) {
  if (analysis.usage.present !== true) {
    notCollected.push(`${prefix}_usage`);
    return;
  }
  if (analysis.usage.cached_within_input === false) {
    fail(`${prefix}_cached`, "cached_tokens_exceeds_input");
  }
  if (analysis.usage.input_tokens === null || analysis.usage.output_tokens === null) {
    notCollected.push(`${prefix}_tokens`);
  }
  if (analysis.usage.ttft_ms === null) notCollected.push(`${prefix}_ttft`);
  if (analysis.usage.latency_ms === null) notCollected.push(`${prefix}_latency`);
  if (usageModelMismatch(analysis, config)) {
    fail(`${prefix}_usage_model`, "usage_model_mismatch");
  }
}

function usageModelMismatch(analysis, config) {
  const model = analysis.usage.identity.usage_model;
  return model !== null && model !== config.model.model;
}

function verifyCallPrefix({ previousMessages, record, prefix, fail }) {
  if (previousMessages === null) return null;
  return prefixComparison(previousMessages, record.request.body.messages);
}

export function analyzeAuthorCall({
  record,
  author,
  found,
  callIndex,
  purposes,
  prefix,
  config,
  fail,
  notCollected,
}) {
  const analysis = analyzeRequestCost(record, {
    authorBinding: {
      messageIndex: found.index,
      text: author.text,
      sha256: author.sha256,
    },
    purpose: purposeOf(purposes, record.provider_call_ref),
  });
  if (!analysis.ok) fail(`${prefix}_analysis`, analysis.reason ?? analysis.status);
  verifyCallUsage({ analysis, prefix, config, fail, notCollected });
  return analysis;
}

export function verifyCallIdentity({ record, prefix, config, fail }) {
  if (record.session_id !== config.session_id) {
    fail(`${prefix}_session`, "session_mismatch");
  }
  if (record.work_id != null && record.work_id !== config.work.id) {
    fail(`${prefix}_work`, "work_mismatch");
  }
}

function missingAuthor(prefix, fail) {
  fail(`${prefix}_author`, "author_message_missing_or_ambiguous");
  return { call: null, messages: null, authorIndex: null };
}

function verifyPrefixChange({ prefixChange, prefix, allowCompression, fail }) {
  if (prefixChange === null) return;
  if (prefixChange.kind === "append") return;
  if (allowCompression) return;
  fail(`${prefix}_prefix`, `request_prefix_${prefixChange.kind}`);
}

function verifyRunCall({
  plan,
  author,
  record,
  callIndex,
  config,
  seenPcalls,
  fail,
  notCollected,
  previousMessages,
  authorIndex,
  purposes,
  operations,
  providerRuns,
  history,
  allowCompression,
}) {
  const prefix = verifyPcall({ plan, record, callIndex, seenPcalls, fail });
  verifyCallIdentity({ record, prefix, config, fail });
  if (operations?.get(record.provider_call_ref) === "transcript_compaction") {
    verifyCallModel({ record, prefix, config, fail });
    const rows = list(providerRuns).filter((row) => row.id === record.provider_run_ref &&
      row.provider_call_ref === record.provider_call_ref);
    const source = auditDiscussionRequest(record, rows.length === 1 ? rows[0] : null, history?.sessionMessages);
    if (!source.ok) fail(`${prefix}_application_source`, source.reason);
    const analysis = analyzeRequestCost(record, { purpose: "other", applicationBinding: source.binding });
    if (!analysis.ok) fail(`${prefix}_analysis`, analysis.reason ?? analysis.status);
    verifyCallUsage({ analysis, prefix, config, fail, notCollected });
    return { call: { turn: plan.turn, call_index: callIndex + 1,
      provider_call_ref: record.provider_call_ref, provider_run_ref: record.provider_run_ref,
      turn_id: record.turn_id ?? null, operation: "transcript_compaction", analysis, prefix_change: null },
    messages: null, authorIndex: null };
  }
  const found = findAuthorMessage(record, author, authorIndex, history);
  if (!found) return missingAuthor(prefix, fail);
  verifyCallModel({ record, prefix, config, fail });
  const analysis = analyzeAuthorCall({
    record,
    author,
    found,
    callIndex,
    purposes,
    prefix,
    config,
    fail,
    notCollected,
  });
  const prefixChange = verifyCallPrefix({ previousMessages, record, prefix, fail });
  verifyPrefixChange({ prefixChange, prefix, allowCompression, fail });
  return {
    call: {
      turn: plan.turn,
      call_index: callIndex + 1,
      provider_call_ref: record.provider_call_ref ?? null,
      provider_run_ref: record.provider_run_ref ?? null,
      turn_id: record.turn_id ?? null,
      analysis,
      prefix_change: prefixChange,
    },
    messages: record.request.body.messages,
    authorIndex: found.index,
  };
}

function verifyRunCalls({
  plan,
  author,
  runRecords,
  config,
  seenPcalls,
  fail,
  notCollected,
  purposes,
  operations,
  providerRuns,
  history,
  allowCompression,
}) {
  const calls = [];
  let previousMessages = null;
  let authorIndex = null;
  for (const [callIndex, record] of runRecords.entries()) {
    const verified = verifyRunCall({
      plan,
      author,
      record,
      callIndex,
      config,
      seenPcalls,
      fail,
      notCollected,
      previousMessages,
      authorIndex,
      purposes,
      operations,
      providerRuns,
      history,
      allowCompression,
    });
    if (verified.call) calls.push(verified.call);
    if (verified.messages) previousMessages = verified.messages;
    if (verified.authorIndex !== null) authorIndex = verified.authorIndex;
  }
  return calls;
}


export function joinRootRun({ scope, history, providerRuns, records, plan, fail }) {
  let bound;
  try {
    bound = joinNativeCallEvidence({
      scope,
      transcript: history.transcript,
      providerRuns,
      records,
      consumedProviderCalls: history.budget?.provider_calls ?? null,
    });
  } catch (error) {
    fail(`turn_${plan.turn}_native_call_join`, error.message);
    return null;
  }
  if (bound.failures.length > 0) {
    fail(
      `turn_${plan.turn}_native_call_join`,
      bound.failures.map((failure) => `${failure.phase}:${failure.reason}`).join(","),
    );
    return null;
  }
  return bound;
}


function plannedAuthor(plan, source, fail) {
  const author = source.authors.find((item) => item.id === plan.author_id);
  if (!author || author.sha256 !== plan.author_sha256) {
    fail(`turn_${plan.turn}_author_binding`, "author_plan_mismatch");
    return null;
  }
  return author;
}

function turnStatus(calls) {
  return calls.length > 0 && calls.every((call) => call.analysis.ok) ? "completed" : "fail";
}

function validTurnIdentity(turn, plan, fail) {
  // verifyTurn 已对缺失 turn 提前返回，这里拿到的一定是真实 driver turn。
  if (turn.author_sha256 !== plan.author_sha256 || turn.index !== plan.turn) {
    fail(`turn_${plan.turn}_driver_identity`, "driver_turn_identity_mismatch");
    return false;
  }
  return true;
}

function hasCheckpointEvidence(history) {
  return (
    history.checkpoint !== null ||
    history.transcript.messages.some((message) => message.role === "checkpoint")
  );
}

export function verifyTurn({ plan, turn, source, wire, config, seenPcalls, binding, fail, notCollected }) {
  const report = {
    turn: plan.turn,
    author_id: plan.author_id,
    author_sha256: plan.author_sha256,
    driver: turn ?? null,
    calls: [],
  };
  if (!turn) {
    report.status = "missing";
    return report;
  }
  if (!validTurnIdentity(turn, plan, fail)) {
    report.status = "fail";
    return report;
  }
  const author = plannedAuthor(plan, source, fail);
  if (!author) {
    report.status = "fail";
    return report;
  }
  if (!binding) {
    report.status = "fail";
    return report;
  }
  const terminal = wireTerminal(wire, { turnId: turn.turn_id, runId: turn.run_id,
    topic: "workspace:" + binding.root.workspace_id, workId: config.work.id, sessionId: config.session_id,
    runRow: binding.root });
  const settled = terminal !== null && terminal.results?.length > 0;
  if (!settled) fail(`turn_${plan.turn}_runtime`, "business_result_or_actual_terminal_missing");
  report.root_run = {
    run_id: binding.root.id,
    workspace_id: binding.root.workspace_id,
    parent_turn_ref: binding.root.parent_turn_ref,
    status: binding.root.status,
    provider_run_count: binding.providerRuns.length,
    provider_call_count: binding.counts.provider_runs,
  };
  report.calls = verifyRunCalls({
    plan,
    author,
    runRecords: binding.records,
    config,
    seenPcalls,
    fail,
    notCollected,
    purposes: binding.purposes,
    operations: binding.operations,
    providerRuns: binding.providerRuns,
    history: binding.history,
    allowCompression: hasCheckpointEvidence(binding.history),
  });
  report.status = settled ? turnStatus(report.calls) : "fail";
  return report;
}

export function verifyTurns({ config, source, wire, driver, bindings, fail, notCollected }) {
  const turns = list(driver?.turns);
  const turnReports = [];
  const allCalls = [];
  const seenPcalls = new Set();
  for (const [index, plan] of config.plan.entries()) {
    const turnReport = verifyTurn({
      plan,
      turn: turns[index],
      source,
      wire,
      config,
      seenPcalls,
      binding: bindings[index] ?? null,
      fail,
      notCollected,
    });
    turnReports.push(turnReport);
    allCalls.push(...turnReport.calls);
  }
  return { turnReports, allCalls };
}


function configShapeMatches(config) {
  return LENGTHS.includes(config.length) && list(config.plan).length === config.length;
}

function configModelMatches(config, manifest) {
  return JSON.stringify(config.model) === JSON.stringify(manifest.model);
}

function configSeedMatches(config, manifest) {
  return config.seed.source_content_sha256 === manifest.snapshot.business_content_sha256;
}

function configSnapshotMatches(config, manifest) {
  return config.snapshot.content_sha256 === manifest.snapshot.content_sha256;
}

function preregisteredConfigMatches(config, loaded, source) {
  if (loaded.manifest.source.kind !== PREREGISTERED_SOURCE_KIND) return true;
  const authors = source.authors;
  return isDeepStrictEqual(config.plan, authors.slice(0, config.length).map((author, index) => ({
    turn: index + 1, author_id: author.id, author_sha256: author.sha256, target: author.target,
  }))) && isDeepStrictEqual(config.compaction_history_check, {
    required: config.length >= 10, require_outside_initial_page: config.length === 20,
  }) && isDeepStrictEqual(config.preregistered_obligations, authors.slice(0, config.length).flatMap((author) =>
    author.obligations.map((obligation) => ({ author_id: author.id, author_sha256: author.sha256, ...obligation }))));
}

function successorConfigMatches(config, manifest, source) {
  const expected = manifest.schema === SUCCESSOR_MANIFEST_SCHEMA &&
    manifest.successor_observation?.lengths?.includes(config.length)
    ? manifest.successor_observation : null;
  if (expected === null) return !Object.hasOwn(config, "successor_observation");
  return isDeepStrictEqual(config.successor_observation, expected) &&
    source?.successorAuthor?.id === expected.author.id &&
    source?.successorAuthor?.sha256 === expected.author.sha256;
}

export function verifyConfigMatches({ config, loaded, source, checks, fail }) {
  checks.config_matches_manifest =
    configShapeMatches(config) &&
    configModelMatches(config, loaded.manifest) &&
    configSeedMatches(config, loaded.manifest) &&
    configSnapshotMatches(config, loaded.manifest) &&
    preregisteredConfigMatches(config, loaded, source) &&
    successorConfigMatches(config, loaded.manifest, source);
  if (!checks.config_matches_manifest) fail("config", "manifest_config_mismatch");
}


function verifyDriverPresence({ driver, checks, fail }) {
  checks.driver_present = driver !== null;
  if (!driver) fail("driver_log", "missing");
}

function driverTurns(driver) {
  return list(driver?.turns);
}

function driverCompleted(driver) {
  return driver?.completed === true;
}

function verifyDriverTurns({ driver, config, checks, fail }) {
  const turns = driverTurns(driver);
  checks.turn_count_ok = turns.length === config.length;
  if (!checks.turn_count_ok) fail("turns", `${turns.length}/${config.length}`, { hard: false });
  checks.driver_completed = driverCompleted(driver);
  if (!checks.driver_completed) fail("driver_completion", "not_completed", { hard: false });
  return turns;
}

function verifyVisibleOutcomes({ turns, checks, fail }) {
  checks.visible_outcomes_recorded = turns.length > 0 && turns.every((turn) =>
    ["completed", "failed", "waiting", "capability_gap"].includes(
      turn?.visible_outcome?.kind,
    ),
  );
  if (!checks.visible_outcomes_recorded) {
    fail("visible_outcomes", "missing", { hard: false });
  }
}

// 可见性权威事实只从原始 turn observation 复算：author_message、发送前
// baseline_author_count 与最后原始 nodes/outcome。旧 driver freshness 字段
// 只是旧报告事实，不再参与终态门。模型引用作者原话或历史过程折叠都不会
// 改变“当前 AX 作者节点数 > 发送前基线”这一归属判断。
const TERMINAL_AX_OUTCOMES = new Set(["completed", "failed", "waiting", "capability_gap"]);

function observationNodes(observation) {
  if (!observation || typeof observation !== "object") return null;
  return Array.isArray(observation.last?.nodes) ? observation.last.nodes : null;
}

function terminalAfterNewEcho(terminalKind, newAuthorEcho) {
  return terminalKind !== null && newAuthorEcho && TERMINAL_AX_OUTCOMES.has(terminalKind);
}

export function freshnessFromObservation(observation) {
  const nodes = observationNodes(observation);
  if (nodes === null) return null;
  const baselineAuthorCount = Number(observation.baseline_author_count ?? 0);
  const authorCount = countAxAuthorMessages(nodes, observation.author_message);
  const newAuthorEcho = authorCount > baselineAuthorCount;
  const terminalKind = observation.last?.outcome?.kind ?? null;
  return {
    baseline_author_count: baselineAuthorCount,
    author_count: authorCount,
    new_author_echo: newAuthorEcho,
    terminal_kind: terminalKind,
    terminal_after_new_echo: terminalAfterNewEcho(terminalKind, newAuthorEcho),
  };
}

export function verifySuccessorVisible({ turn, author, observation }) {
  if (typeof author?.text !== "string" || author.text === "" || observation?.author_message !== author.text)
    return { ok: false, reason: "successor_visible_author_mismatch", freshness: null };
  if (!Number.isInteger(observation.baseline_author_count) || observation.baseline_author_count < 0)
    return { ok: false, reason: "successor_visible_baseline_missing", freshness: null };
  const nodes = observationNodes(observation);
  const outcome = axTurnOutcome(nodes, { message: author.text,
    baselineAuthorCount: observation.baseline_author_count });
  const freshness = freshnessFromObservation({ ...observation,
    last: { ...observation.last, outcome } });
  const ok = turn?.visible_outcome?.kind === "completed" &&
    freshness?.new_author_echo === true && freshness?.terminal_after_new_echo === true &&
    freshness?.terminal_kind === "completed";
  return { ok, reason: ok ? null : "successor_visible_completed_not_proven", freshness };
}

function freshTurn(facts) {
  return facts?.new_author_echo === true && facts?.terminal_after_new_echo === true;
}

function verifyFreshness({ turns, turnObservations, checks, fail }) {
  checks.freshness_recorded = turns.length > 0 && turns.every((turn, index) => {
    if (!turn) return false;
    // 派生事实直接覆盖旧的 driver 投影，报告只保留可独立复算的 AX 事实。
    turn.freshness = freshnessFromObservation(turnObservations[index]);
    return freshTurn(turn.freshness);
  });
  if (!checks.freshness_recorded) fail("freshness", "missing", { hard: false });
}

export function verifyDriverShape({
  driver,
  config,
  checks,
  fail,
  turnObservations = [],
}) {
  verifyDriverPresence({ driver, checks, fail });
  const turns = verifyDriverTurns({ driver, config, checks, fail });
  verifyVisibleOutcomes({ turns, checks, fail });
  verifyFreshness({ turns, turnObservations, checks, fail });
  return turns;
}



export function verifyCheckpoints({ start, final, checks, fail, notCollected = [] }) {
  const present = start !== null && final !== null;
  checks.production_counts_present = present ? true : null;
  if (!present) {
    checks.production_counts_unchanged = null;
    notCollected.push("production_counts");
    return { present: false, unchanged: null, start, final };
  }
  const unchanged = JSON.stringify(start) === JSON.stringify(final);
  checks.production_counts_unchanged = unchanged;
  if (!unchanged) {
    // 前后计数差异是产品事实，不是采集失败；保留给独立目标/授权评审。
    fail("checkpoints", "production_changed", { hard: false });
  }
  return { present: true, unchanged, start, final };
}
