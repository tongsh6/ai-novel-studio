// B71 §16.14 C6–C8：拒绝零副作用、确认子执行分支、作者字节因果。
// 只消费 authoring_confirmation_facts 已归一的事实。
import { field, isObject, numberValue } from "./authoring_confirmation_facts.mjs";
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";

function scopedDelta(sampling, key) {
  const before = field(sampling, "click_before");
  const after = field(sampling, "decision_after");
  if (!isObject(before) || !isObject(after)) return null;
  const beforeValue = numberValue(field(before, key));
  const afterValue = numberValue(field(after, key));
  return Number.isFinite(beforeValue) && Number.isFinite(afterValue) ? afterValue - beforeValue : null;
}

// C6 拒绝零副作用（reject mode）：采样窗 = 点击前 → 收到决定后（action-scoped）。
// canon 比较排除 author_action_receipts（行为受理记录，C4/C5 要求 receipt 唯一），
// 其余作品 canon 表必须一致；mutations 用 scoped delta；受理产生的 cancelled child run
// 属审计记录（agent_runs）不计副作用；Provider/llm-calls delta 必须为 0。
export function rejectZeroSideEffectCheck(facts) {
  if (facts.mode !== "reject") return { ok: null, reason: "confirm_mode", detail: {} };
  const scopedDeltas = {
    provider_runs: scopedDelta(facts.sampling, "provider_runs"),
    llm_calls: scopedDelta(facts.sampling, "llm_calls"),
    mutations: scopedDelta(facts.sampling, "mutations"),
    receipts: scopedDelta(facts.sampling, "receipts"),
  };
  const ok = [
    facts.canonAll.reason !== "canon_evidence_missing",
    facts.canonWorks.equal,
    scopedDeltas.provider_runs === 0,
    scopedDeltas.llm_calls === 0,
    scopedDeltas.mutations === 0,
    Number.isFinite(scopedDeltas.receipts) && scopedDeltas.receipts <= 1,
    facts.rejectReceipts.length === 1,
    field(facts.rejectResult, "decision") === "CANCELLED",
    field(facts.rejectResult, "decided_by") === "author",
    facts.rejectTraceDecisionType === "cancel_waiting",
    facts.closureStatus === "cancelled",
    facts.rejectChildRunStatus === "cancelled",
  ].every(Boolean);
  return {
    ok,
    reason: ok ? null : "reject_side_effect_or_receipt_invalid",
    detail: {
      canon: {
        all: facts.canonAll.equal,
        works: facts.canonWorks.equal,
        changed_works: facts.canonWorks.changed,
        changed_all: facts.canonAll.changed,
      },
      scoped_delta: scopedDeltas,
      reject_receipts: facts.rejectReceipts.length,
      reject_decision: field(facts.rejectResult, "decision"),
      reject_decided_by: field(facts.rejectResult, "decided_by"),
      decision_trace_type: facts.rejectTraceDecisionType,
      closure_status: facts.closureStatus,
      child_run_status: field(facts.childRun, "status"),
    },
  };
}

// C7 确认子执行（executed / gate-blocked / tool-failed 三分支由 facts 判一次）。
export function confirmedChildExecutionCheck(facts) {
  if (facts.mode !== "confirm") return { ok: null, reason: "reject_mode", detail: {} };
  const ok = facts.childExecutionBranch !== "none";
  return {
    ok,
    reason: ok ? null : "confirmed_child_execution_missing",
    detail: {
      executed_turn_id: field(facts.executedBody, "turn_id"),
      tool_name: field(facts.toolResult, "tool_name"),
      tool_status: field(facts.toolResult, "status"),
      pending_artifact_type: facts.pendingArtifactType,
      child_run_id: facts.childRunId,
      child_provider_runs: facts.childProviderRuns.length,
      llm_records: facts.childLlmRecords.length,
      branch: facts.childExecutionBranch,
      truthfulness: facts.truthfulness,
    },
  };
}

const BUTTON_TEXT_PATTERN = /确认执行|拒绝|保存为章节正文|已确认「prose_writing」/u;

function authorMessagesFor(record, sourceAuthorText) {
  const facts = requestFactsFromRecord(record);
  if (!facts.ok) {
    return { author_messages: 0, exact: 0, button_leak: false, app_data: 0, unreadable: true };
  }
  const author = facts.authorMessages.map((message) => message.text);
  return {
    author_messages: author.length,
    exact: author.filter((content) => content === sourceAuthorText).length,
    button_leak: author.some((content) => BUTTON_TEXT_PATTERN.test(content)),
    app_data: facts.applicationMessages.length,
    unreadable: false,
  };
}

// C8 作者字节：每条真实请求恰好一条非 application-data 的 user 消息逐字节等于作者原话；
// application-data 消息不得被当作作者原话；按钮/确认文案不得以 author 身份出现。
export function authorBytesCheck(facts) {
  const perRecord = facts.childLlmRecords.map((record) => authorMessagesFor(record, facts.sourceAuthorText));
  const recordsOk =
    facts.childLlmRecords.length >= 1 &&
    perRecord.every(
      (entry) =>
        !entry.unreadable &&
        entry.exact === 1 &&
        !entry.button_leak &&
        entry.author_messages === 1,
    );
  const ok = facts.sourceAuthorText !== "" && recordsOk;
  return {
    ok,
    reason: ok ? null : "author_bytes_not_preserved_or_misattributed",
    detail: {
      source_author_chars: facts.sourceAuthorText.length,
      records_checked: perRecord.length,
      exact_matches_per_record: perRecord.map((entry) => entry.exact),
      author_messages_per_record: perRecord.map((entry) => entry.author_messages),
      application_data_per_record: perRecord.map((entry) => entry.app_data),
      button_text_leaked_as_author: perRecord.some((entry) => entry.button_leak),
      unreadable_requests: perRecord.filter((entry) => entry.unreadable).length,
    },
  };
}
