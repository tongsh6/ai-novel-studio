// B82 VS-00L §7 G3 纯判据：同一 run 的每次真实校验失败是否作为原生 tool 结果在紧邻请求回流。
//
// 调用者只传同一 run 的 canonical transcript、bindNativeCalls 已对账的 records、
// 实际时间序 starts（provider_run_id/provider_call_ref 双键）、冻结 authorText 与
// 已解码 run authority/budget/consumed/status/pending。失败只认 canonical tool 的
// validation_result(status=failed, 非空 reason_code)；该 tool 结果必须有唯一在先
// assistant tool_call，并用 assistant 的 Provider 双键定位真实 source。next 必须是
// starts 中 source 的紧邻下一项，而不是任意后来的回放。失败 observation、迟到回放、
// 手抄失败文案、错属/重复/缺证都不签。本入口只签 recovered correction；预算耗尽
// 终止分支另列未验证，不造产品 gate，也不依赖固定自然语言。
//
// 结果只含检查、失败原因与技术关联 ref；不含作者原文、失败 detail 或 payload 正文。
import { isDeepStrictEqual } from "node:util";
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";

export const G3_SIGNED_SCOPE = "recovered_correction";
export const G3_NOT_SIGNED = Object.freeze(["budget_exhaustion_termination"]);

const CHECKS = Object.freeze([
  "inputs",
  "authorization",
  "run",
  "pending",
  "budget",
  "author_requests",
  "canonical_failure",
  "recovery",
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const startedKey = (start) => `${start?.provider_run_id}\u0000${start?.provider_call_ref}`;
const recordKey = (record) => `${record?.provider_run_ref}\u0000${record?.provider_call_ref}`;

function emptyChecks() {
  return Object.fromEntries(CHECKS.map((name) => [name, {
    attempted: false,
    ok: false,
    reasons: [],
  }]));
}

function failureSink(checks) {
  const failures = [];
  const add = (check, reason, refs = {}) => {
    checks[check].attempted = true;
    checks[check].reasons.push({ reason, ...refs });
    failures.push({ check, reason, ...refs });
  };
  return { failures, add };
}

// 请求事实只经唯一读取边界；解析失败或坏调用/坏结果都不能被忽略成空集合。
function factsOf(record) {
  const facts = requestFactsFromRecord(record);
  if (!facts.ok) return { facts, reason: "request_unreadable" };
  if (facts.malformedCalls > 0) return { facts, reason: "request_malformed_call" };
  if (facts.malformedToolMessages > 0) return { facts, reason: "request_malformed_result" };
  return { facts, reason: null };
}

function recordReason(prefix, reason) {
  if (reason === "request_unreadable") return `${prefix}_unreadable`;
  if (reason === "request_malformed_call") return `${prefix}_malformed_call`;
  return `${prefix}_malformed_result`;
}

function recordForStart(start, records) {
  const matches = [];
  records.forEach((record, index) => {
    if (
      record?.provider_run_ref === start?.provider_run_id &&
      record?.provider_call_ref === start?.provider_call_ref
    ) {
      matches.push({ record, index });
    }
  });
  if (matches.length === 1) return { ...matches[0], reason: null };
  return { record: null, index: null, reason: matches.length > 0 ? "ambiguous" : "missing" };
}

// started 与已对账 records 必须是双键一一对应：重复、缺项、错配都不能靠数量相等混过。
function startsMatchRecords(starts, records) {
  if (starts.length !== records.length) return false;
  const startKeys = new Set();
  for (const start of starts) {
    if (!nonBlank(start?.provider_run_id) || !nonBlank(start?.provider_call_ref)) return false;
    const key = startedKey(start);
    if (startKeys.has(key)) return false;
    startKeys.add(key);
  }
  const recordKeys = new Set();
  for (const record of records) {
    if (!nonBlank(record?.provider_run_ref) || !nonBlank(record?.provider_call_ref)) return false;
    const key = recordKey(record);
    if (recordKeys.has(key)) return false;
    recordKeys.add(key);
  }
  return starts.every((start) => recordForStart(start, records).index !== null) &&
    records.every((record) => starts.some((start) =>
      start.provider_run_id === record.provider_run_ref &&
      start.provider_call_ref === record.provider_call_ref));
}

function hasResult(facts, callId) {
  return list(facts.toolResults).some((result) =>
    result.callId === callId || result.toolCallId === callId);
}

function laterHasResult(starts, records, fromIndex, callId) {
  for (let index = fromIndex; index < starts.length; index += 1) {
    const match = recordForStart(starts[index], records);
    if (!match.record) continue;
    const read = factsOf(match.record);
    if (read.reason === null && hasResult(read.facts, callId)) return true;
  }
  return false;
}

function canonicalFailures(messages) {
  const found = [];
  messages.forEach((message, messageIndex) => {
    if (message?.role !== "tool") return;
    list(message.blocks).forEach((block, blockIndex) => {
      if (block?.type !== "validation_result") return;
      if (block.status !== "failed") return;
      if (!nonBlank(block.reason_code)) return;
      found.push({ block, messageIndex, blockIndex });
    });
  });
  return found;
}

function precedingCalls(messages, callId, beforeIndex) {
  const found = [];
  for (let messageIndex = 0; messageIndex < beforeIndex; messageIndex += 1) {
    const message = messages[messageIndex];
    if (message?.role !== "assistant") continue;
    for (const block of list(message.blocks)) {
      if (block?.type !== "tool_call" || block.call_id !== callId) continue;
      found.push({ block, message, messageIndex });
    }
  }
  return found;
}

function checkRecovery({ block, call, starts, records, add, refs }) {
  const callId = block.call_id;
  const providerCallRef = call.message.provider_call_ref;
  const providerRunRef = call.message.provider_run_ref;
  const base = {
    call_id: refs.call_id,
    reason_code: refs.reason_code,
    message_index: refs.message_index,
    block_index: refs.block_index,
    assistant_message_index: refs.assistant_message_index,
  };
  const fail = (reason, extra = {}) => add("recovery", reason, { ...base, ...extra });

  const sourceIndexes = starts.flatMap((start, index) =>
    start?.provider_run_id === providerRunRef && start?.provider_call_ref === providerCallRef
      ? [index]
      : []);
  if (sourceIndexes.length === 0) {
    fail("source_started_missing", {
      provider_call_ref: providerCallRef,
      provider_run_ref: providerRunRef,
    });
    return;
  }
  if (sourceIndexes.length > 1) {
    fail("source_started_ambiguous", {
      provider_call_ref: providerCallRef,
      provider_run_ref: providerRunRef,
    });
    return;
  }
  const sourceIndex = sourceIndexes[0];
  const sourceStart = starts[sourceIndex];
  const source = recordForStart(sourceStart, records);
  const sourceRef = {
    provider_run_id: sourceStart?.provider_run_id ?? null,
    provider_call_ref: sourceStart?.provider_call_ref ?? null,
    started_index: sourceIndex,
    record_index: source.index ?? null,
  };
  refs.source = sourceRef;
  if (!source.record) {
    fail(source.reason === "ambiguous" ? "source_record_ambiguous" : "source_record_missing", sourceRef);
    return;
  }
  const sourceRead = factsOf(source.record);
  if (sourceRead.reason !== null) {
    fail(recordReason("source_record", sourceRead.reason), sourceRef);
    return;
  }
  if (hasResult(sourceRead.facts, callId)) {
    fail("source_already_has_result", sourceRef);
    return;
  }

  // 紧邻：source 在 actual started 时间序中的下一项，绝不向后搜索“后来回放”。
  const nextIndex = sourceIndex + 1;
  if (nextIndex >= starts.length) {
    fail("next_started_missing", { source_started_index: sourceIndex });
    return;
  }
  const nextStart = starts[nextIndex];
  const next = recordForStart(nextStart, records);
  const nextRef = {
    provider_run_id: nextStart?.provider_run_id ?? null,
    provider_call_ref: nextStart?.provider_call_ref ?? null,
    started_index: nextIndex,
    record_index: next.index ?? null,
  };
  refs.next = nextRef;
  if (!next.record) {
    fail(next.reason === "ambiguous" ? "next_record_ambiguous" : "next_record_missing", nextRef);
    return;
  }
  const nextRead = factsOf(next.record);
  if (nextRead.reason !== null) {
    fail(recordReason("next_record", nextRead.reason), nextRef);
    return;
  }

  const nextResults = list(nextRead.facts.toolResults).filter((result) =>
    result.callId === callId);
  if (nextResults.length === 0) {
    if (laterHasResult(starts, records, nextIndex + 1, callId)) {
      fail("late_replay", { next_started_index: nextIndex });
    } else {
      fail("next_result_missing", { next_started_index: nextIndex });
    }
    return;
  }
  if (nextResults.length > 1) {
    fail("next_result_ambiguous", { next_started_index: nextIndex });
    return;
  }
  const result = nextResults[0];
  nextRef.result_message_index = result.messageIndex ?? null;
  if (result.toolCallId !== callId) {
    fail("next_result_id_mismatch", {
      tool_call_id: result.toolCallId ?? null,
      next_started_index: nextIndex,
    });
  }
  if (result.type !== "validation_result") {
    fail("next_result_not_validation", {
      result_type: result.type ?? null,
      next_started_index: nextIndex,
    });
    return;
  }
  if (result.status !== "failed") {
    fail("next_result_not_failed", {
      result_status: result.status ?? null,
      next_started_index: nextIndex,
    });
  }
  if (result.reasonCode !== block.reason_code) {
    fail("next_result_reason_mismatch", {
      result_reason_code: result.reasonCode ?? null,
      next_started_index: nextIndex,
    });
  }
  if (!isDeepStrictEqual(result.payload, block)) {
    fail("next_result_payload_mismatch", { next_started_index: nextIndex });
  }

  // next 同请求内必须以同一 call ID 的原生 assistant tool call 先于该结果。
  const nextCalls = list(nextRead.facts.toolCalls).filter((item) => item.callId === callId);
  if (nextCalls.length === 0) {
    fail("next_call_missing", { next_started_index: nextIndex });
    return;
  }
  if (nextCalls.length > 1) {
    fail("next_call_ambiguous", { next_started_index: nextIndex });
    return;
  }
  nextRef.assistant_call_message_index = nextCalls[0].messageIndex ?? null;
  if (!(nextCalls[0].messageIndex < result.messageIndex)) {
    fail("next_call_order", { next_started_index: nextIndex });
  }
  if (
    nonBlank(call.block?.name) &&
    nonBlank(nextCalls[0].name) &&
    call.block.name !== nextCalls[0].name
  ) {
    fail("next_call_name_mismatch", {
      tool_name: nextCalls[0].name,
      next_started_index: nextIndex,
    });
  }
}

export function g3RecoveryEvidence({
  transcript,
  records,
  starts,
  authorText,
  authority,
  budget,
  consumed,
  status,
  pending,
} = {}) {
  const checks = emptyChecks();
  const { failures, add } = failureSink(checks);
  const refs = {
    recoveries: [],
    started_count: null,
    record_count: null,
    consumed_provider_calls: null,
    max_provider_calls: null,
  };

  const messages = Array.isArray(transcript?.messages) ? transcript.messages : null;
  const recordList = Array.isArray(records) ? records : null;
  const startList = Array.isArray(starts) ? starts : null;

  checks.inputs.attempted = true;
  if (messages === null) add("inputs", "transcript_messages_missing");
  if (recordList === null) add("inputs", "records_missing");
  if (startList === null) add("inputs", "starts_missing");
  if (!isObject(authority)) add("inputs", "authority_missing");
  if (!isObject(budget)) add("inputs", "budget_missing");
  if (!isObject(consumed)) add("inputs", "consumed_missing");
  if (!nonBlank(status)) add("inputs", "status_missing");
  if (!Array.isArray(pending)) add("inputs", "pending_missing");
  if (!nonBlank(authorText)) add("inputs", "author_text_missing");

  // 只读授权必须来自实际 run，而不是调用方口头声明。
  if (isObject(authority)) {
    checks.authorization.attempted = true;
    if (authority.production_write !== false) {
      add("authorization", "authority_not_read_only");
    }
    const tools = authority.allowed_tools;
    if (!(Array.isArray(tools) && tools.length === 1 && tools[0] === "judgment")) {
      add("authorization", "authority_allowed_tools");
    }
  }

  if (nonBlank(status)) {
    checks.run.attempted = true;
    if (status !== "completed") add("run", "run_not_completed");
  }

  if (Array.isArray(pending)) {
    checks.pending.attempted = true;
    if (pending.length !== 0) {
      add("pending", "pending_present", { pending_count: pending.length });
    }
  }

  // 实际 started 与已对账 records 都必须等于持久化 consumed.provider_calls，且不超预算。
  if (startList !== null && recordList !== null && isObject(budget) && isObject(consumed)) {
    checks.budget.attempted = true;
    const startedCount = startList.length;
    const recordCount = recordList.length;
    const consumedCount = Number.isInteger(consumed.provider_calls)
      ? consumed.provider_calls
      : null;
    const maxCalls = Number.isInteger(budget.max_provider_calls)
      ? budget.max_provider_calls
      : null;
    refs.started_count = startedCount;
    refs.record_count = recordCount;
    refs.consumed_provider_calls = consumedCount;
    refs.max_provider_calls = maxCalls;
    if (startedCount === 0) add("budget", "started_missing");
    if (!startsMatchRecords(startList, recordList)) {
      add("budget", "started_records_mismatch", {
        started_count: startedCount,
        record_count: recordCount,
      });
    }
    if (consumedCount === null) {
      add("budget", "consumed_provider_calls_missing");
    } else if (startedCount !== consumedCount || recordCount !== consumedCount) {
      add("budget", "provider_call_count_mismatch", {
        started_count: startedCount,
        record_count: recordCount,
        consumed_provider_calls: consumedCount,
      });
    }
    if (maxCalls === null) {
      add("budget", "max_provider_calls_missing");
    } else if (consumedCount !== null && consumedCount > maxCalls) {
      add("budget", "provider_call_budget_exceeded", {
        consumed_provider_calls: consumedCount,
        max_provider_calls: maxCalls,
      });
    }
  }

  // 同批每个真实 request 都只能有一条作者消息，且必须与冻结作者字节逐字相同；
  // 应用数据由 request facts 的 author/application 分类决定，不在文本里猜。
  if (recordList !== null && nonBlank(authorText)) {
    checks.author_requests.attempted = true;
    checks.author_requests.checked = recordList.length;
    recordList.forEach((record, index) => {
      const recordRefs = {
        record_index: index,
        provider_run_ref: record?.provider_run_ref ?? null,
        provider_call_ref: record?.provider_call_ref ?? null,
      };
      const read = factsOf(record);
      if (read.reason !== null) {
        add("author_requests", read.reason, recordRefs);
        return;
      }
      const authorMessages = list(read.facts.authorMessages);
      if (authorMessages.length !== 1) {
        add("author_requests", "author_message_count", {
          ...recordRefs,
          author_message_count: authorMessages.length,
        });
        return;
      }
      if (authorMessages[0].text !== authorText) {
        add("author_requests", "author_message_mismatch", recordRefs);
      }
    });
  }

  if (messages !== null) {
    checks.canonical_failure.attempted = true;
    const found = canonicalFailures(messages);
    checks.canonical_failure.failure_count = found.length;
    if (found.length === 0) {
      add("canonical_failure", "failed_validation_missing");
    } else {
      for (const { block, messageIndex, blockIndex } of found) {
        const failureRef = {
          call_id: nonBlank(block.call_id) ? block.call_id : null,
          reason_code: nonBlank(block.reason_code) ? block.reason_code : null,
          message_index: messageIndex,
          block_index: blockIndex,
        };
        const recoveryRef = {
          ...failureRef,
          assistant_message_index: null,
          provider_call_ref: null,
          provider_run_ref: null,
          source: null,
          next: null,
        };
        refs.recoveries.push(recoveryRef);

        if (!nonBlank(block.call_id)) {
          add("canonical_failure", "failure_call_id_missing", failureRef);
          continue;
        }
        const calls = precedingCalls(messages, block.call_id, messageIndex);
        if (calls.length === 0) {
          add("canonical_failure", "assistant_call_missing", failureRef);
          continue;
        }
        if (calls.length > 1) {
          add("canonical_failure", "assistant_call_ambiguous", {
            ...failureRef,
            assistant_call_count: calls.length,
          });
          continue;
        }
        recoveryRef.assistant_message_index = calls[0].messageIndex;
        if (
          !nonBlank(calls[0].message?.provider_call_ref) ||
          !nonBlank(calls[0].message?.provider_run_ref)
        ) {
          add("canonical_failure", "assistant_ref_missing", {
            ...failureRef,
            assistant_message_index: calls[0].messageIndex,
          });
          continue;
        }
        recoveryRef.provider_call_ref = calls[0].message.provider_call_ref;
        recoveryRef.provider_run_ref = calls[0].message.provider_run_ref;
        if (startList !== null && recordList !== null) {
          checks.recovery.attempted = true;
          checkRecovery({
            block,
            call: calls[0],
            starts: startList,
            records: recordList,
            add,
            refs: recoveryRef,
          });
        }
      }
    }
  }

  for (const check of Object.values(checks)) {
    check.ok = check.attempted && check.reasons.length === 0;
  }

  return {
    ok: failures.length === 0,
    reason: failures[0]?.reason ?? null,
    failures,
    checks,
    refs,
    signed_scope: G3_SIGNED_SCOPE,
    not_signed: [...G3_NOT_SIGNED],
  };
}
