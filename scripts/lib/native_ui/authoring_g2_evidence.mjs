// B82 VS-00L §7 G2 页级证据：证明实际采纳稿版本与紧邻请求，而不是只证明确定性全章续读。
//
// 每页从 canonical transcript 的 chapter_read observation 出发，按 call_id 找回在先
// judgment_decision assistant，用它顶层的 pcall/prun 定位实际 started，再核对下一条
// started 的请求确实携带同一调用和同一观察。源请求已带结果、缺/多义匹配、错版本、
// 迟到回放都失败；聚合时不拿另一页的版本代签。结果只含 refs/range/reason，不含正文。
import { isDeepStrictEqual } from "node:util";
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";

const TOTAL = 7000;
const PAGES = [[1, 6000], [6001, 7000]];
const BODY_MARKER = "【正文】";
const SEGMENTER = new Intl.Segmenter("zh", { granularity: "grapheme" });

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === "string" ? value : "");
const graphemes = (value) => Array.from(SEGMENTER.segment(text(value)), (part) => part.segment);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";

const transcriptMessages = (transcript) =>
  Array.isArray(transcript) ? transcript : list(transcript?.messages);

function pageObservations(messages, chapterRef) {
  const found = [];
  messages.forEach((message, messageIndex) => {
    if (message?.role !== "tool") return;
    list(message.blocks).forEach((block) => {
      const coverage = block?.coverage;
      if (block?.type !== "observation" || !isObject(coverage) || coverage.chapter_ref !== chapterRef) return;
      if (block.content?.tool !== "chapter_read" || !list(block.source_refs).includes(chapterRef)) return;
      found.push({ block, messageIndex });
    });
  });
  return found;
}

function versionReason(block, draftRef, revision) {
  const versions = block.versions;
  const keys = isObject(versions) ? Object.keys(versions) : [];
  if (keys.length === 0) return "version_missing";
  if (keys.length !== 1) return "version_ambiguous";
  if (keys[0] !== draftRef) return "version_mismatch";
  return versions[draftRef] === revision ? null : "version_mismatch";
}

function bodyReason(block, expected) {
  const summary = text(block.content?.summary);
  if (summary.split(BODY_MARKER).length !== 2) return "prose_body_missing";
  const after = summary.slice(summary.indexOf(BODY_MARKER) + BODY_MARKER.length);
  const newline = after.indexOf("\n");
  if (newline < 0) return "prose_body_missing";
  const body = after.slice(newline + 1);
  if (body === expected) return null;
  return body.startsWith(expected) && body.slice(expected.length).startsWith("\n【")
    ? null
    : "prose_mismatch";
}

function callsBefore(messages, callId, beforeIndex) {
  const found = [];
  messages.forEach((message, messageIndex) => {
    if (messageIndex >= beforeIndex || message?.role !== "assistant") return;
    list(message.blocks).forEach((block) => {
      if (block?.type === "tool_call" && block.call_id === callId) found.push({ block, message });
    });
  });
  return found;
}

function startRef(start, index) {
  return start
    ? {
      started_index: index,
      provider_run_id: start.provider_run_id ?? null,
      provider_call_ref: start.provider_call_ref ?? null,
    }
    : null;
}

function recordFor(start, records) {
  if (!start) return { record: null, reason: "missing" };
  const matches = list(records).filter((record) =>
    record?.provider_run_ref === start.provider_run_id &&
    record?.provider_call_ref === start.provider_call_ref);
  if (matches.length === 1) return { record: matches[0], reason: null };
  return { record: null, reason: matches.length ? "ambiguous" : "missing" };
}

function startsMatchRecords(starts, records) {
  const startList = list(starts);
  const recordList = list(records);
  if (startList.length !== recordList.length) return false;
  const seen = new Set();
  return startList.every((start) => {
    const key = `${start?.provider_run_id}\u0000${start?.provider_call_ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return recordList.filter((record) =>
      record?.provider_run_ref === start?.provider_run_id &&
      record?.provider_call_ref === start?.provider_call_ref).length === 1;
  });
}

function hasResult(record, callId) {
  const facts = requestFactsFromRecord(record);
  return facts.ok && list(facts.toolResults).some((result) =>
    result.callId === callId || result.toolCallId === callId);
}

function laterHasResult(starts, records, fromIndex, callId) {
  for (let index = fromIndex; index < starts.length; index += 1) {
    const matched = recordFor(starts[index], records);
    if (matched.record && hasResult(matched.record, callId)) return true;
  }
  return false;
}

function pageCheck({ messages, records, starts, chapterRef, draftRef, revision, chars, range }) {
  const [start, end] = range;
  const page = { range, source: null, next: null, reason: null };
  const fail = (reason) => {
    if (page.reason === null) page.reason = reason;
  };
  const candidates = pageObservations(messages, chapterRef).filter(({ block }) => {
    const proseRange = block.coverage.prose_range;
    return isObject(proseRange) && proseRange.start === start && proseRange.end === end;
  });
  if (candidates.length !== 1) {
    fail(candidates.length > 1 ? "observation_ambiguous" : "observation_missing");
    return page;
  }
  const { block, messageIndex } = candidates[0];
  const coverage = block.coverage;
  if (block.status !== "ok") fail("observation_status");
  if (coverage.prose_total_chars !== chars.length) fail("coverage_total_mismatch");
  const versionBad = versionReason(block, draftRef, revision);
  if (versionBad !== null) fail(versionBad);
  const bodyBad = bodyReason(block, chars.slice(start - 1, end).join(""));
  if (bodyBad !== null) fail(bodyBad);
  if (end < chars.length ? block.next_offset !== end : block.next_offset != null) {
    fail("next_offset_mismatch");
  }

  const callId = block.call_id;
  if (!nonBlank(callId)) {
    fail("call_id_missing");
    return page;
  }
  const calls = callsBefore(messages, callId, messageIndex);
  if (calls.length !== 1) {
    fail(calls.length > 1 ? "assistant_call_ambiguous" : "assistant_call_missing");
    return page;
  }
  const { message: callMessage } = calls[0];
  const pcall = callMessage?.provider_call_ref;
  const prun = callMessage?.provider_run_ref;
  if (!nonBlank(pcall) || !nonBlank(prun)) {
    fail("assistant_ref_missing");
    return page;
  }
  const sourceIndexes = list(starts).flatMap((item, index) =>
    item?.provider_run_id === prun && item?.provider_call_ref === pcall ? [index] : []);
  if (sourceIndexes.length !== 1) {
    fail(sourceIndexes.length > 1 ? "source_started_ambiguous" : "source_started_missing");
    return page;
  }
  const sourceIndex = sourceIndexes[0];
  page.source = startRef(starts[sourceIndex], sourceIndex);
  const source = recordFor(starts[sourceIndex], records);
  if (!source.record) {
    fail(source.reason === "ambiguous" ? "source_record_ambiguous" : "source_record_missing");
  } else if (hasResult(source.record, callId)) {
    fail("source_already_has_result");
  }

  const nextIndex = sourceIndex + 1;
  page.next = startRef(starts[nextIndex], nextIndex);
  if (!page.next) {
    fail("next_started_missing");
    return page;
  }
  const next = recordFor(starts[nextIndex], records);
  if (!next.record) {
    fail(next.reason === "ambiguous" ? "next_record_ambiguous" : "next_record_missing");
    return page;
  }
  const facts = requestFactsFromRecord(next.record);
  if (!facts.ok) {
    fail("next_record_unreadable");
    return page;
  }
  const nextCalls = list(facts.toolCalls).filter((call) => call.callId === callId);
  const nextResults = list(facts.toolResults).filter((result) =>
    result.callId === callId || result.toolCallId === callId);
  if (nextCalls.length !== 1) {
    fail(nextCalls.length > 1 ? "next_call_ambiguous" : "next_call_missing");
  } else if (nextResults.length === 1 && nextCalls[0].messageIndex >= nextResults[0].messageIndex) {
    fail("next_call_order");
  }
  if (nextResults.length !== 1) {
    if (laterHasResult(starts, records, nextIndex + 1, callId)) fail("late_replay");
    else fail(nextResults.length > 1 ? "next_result_ambiguous" : "next_result_missing");
  } else if (nextResults[0].toolCallId !== callId) {
    fail("result_id_mismatch");
  } else if (!isDeepStrictEqual(nextResults[0].payload, block)) {
    fail("next_payload_mismatch");
  }
  return page;
}

export function g2PageEvidence({ transcript, records, starts, chapterRef, draftRef, revision, prose }) {
  const chars = graphemes(prose);
  if (chars.length !== TOTAL) {
    return {
      ok: false,
      pages: PAGES.map((range) => ({ range, source: null, next: null, reason: "prose_invalid" })),
    };
  }
  if (!startsMatchRecords(starts, records)) {
    return {
      ok: false,
      pages: PAGES.map((range) => ({ range, source: null, next: null, reason: "started_records_mismatch" })),
    };
  }
  const messages = transcriptMessages(transcript);
  const pages = PAGES.map((range) => pageCheck({
    messages, records, starts, chapterRef, draftRef, revision, chars, range,
  }));
  return { ok: pages.every((page) => page.reason === null), pages };
}
