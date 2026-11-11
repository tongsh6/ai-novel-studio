// B82 VS-00L §7/§16.9 G2 证据：证明实际采纳稿版本与紧邻请求，而不是只证明确定性全章续读。
//
// 页级：每页从 canonical transcript 的 chapter_read observation 出发（直接 observation，
// 或 planned_exploration 聚合父块内按执行顺序的一层叶；父块只给 status 与真正 call_id），
// 按 call_id 找回在先 judgment_decision assistant，用它顶层的 pcall/prun 定位实际 started，
// 再核对下一条 started 的请求确实携带同一调用和完整观察 payload。源请求已带结果、缺/多义
// 匹配、错版本、迟到回放都失败；聚合时不拿另一页的版本代签。
//
// 候选：只认 ACK 后同 owning topic 的唯一 completed 终局（run 行也 completed，终局
// work_id/session_id 必须精确等于 run 且不得缺字段），目标章 TENTATIVE prose_fragment
// 先按本 run 持久 pending ids 收窄再核唯一（历史同章候选可同帧并存，但不得抢占或令
// 当前候选误歧义），scope=target_segments、effect=replace_segments；writer item 经同 run
// 已对账记录逐字节核对，最终可见文本必须新增出现对应 item 标题/正文，缺/空 baseline 记
// baseline_visible_missing。结果只含 refs/原因，不含正文。
import { isDeepStrictEqual } from "node:util";
import {
  observationRefOf,
  plannedExplorationLeaves,
  requestFactsFromRecord,
} from "./authoring_request_facts.mjs";
import { writerArtifactMatch } from "./authoring_pending_evidence.mjs";

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

// 页可能是直接 chapter_read observation，也可能是 planned_exploration 聚合父块的一层叶。
// 两种形状都以叶自身的 coverage/source_refs 认页，父块只提供 status 与真正 call_id。
function pageObservations(messages, chapterRef) {
  const found = [];
  messages.forEach((message, messageIndex) => {
    if (message?.role !== "tool") return;
    list(message.blocks).forEach((parent) => {
      if (parent?.type !== "observation") return;
      for (const block of plannedExplorationLeaves(parent) ?? [parent]) {
        const coverage = block?.coverage;
        if (!isObject(coverage) || coverage.chapter_ref !== chapterRef) continue;
        if (block.content?.tool !== "chapter_read" || !list(block.source_refs).includes(chapterRef)) continue;
        found.push({ block, parent, messageIndex });
      }
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

// 页报告只搬运 canonical observation 已带的身份；缺 ref 不改变页证据结论（旧档案
// 页仍可成立），但后续页级使用证据会因缺证拒绝。身份读取与 L7 共用 request facts。
function pageCheck({ messages, records, starts, chapterRef, draftRef, revision, chars, range }) {
  const [start, end] = range;
  const page = { range, observation_ref: null, call_id: null, source: null, next: null, reason: null };
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
  const { block, parent, messageIndex } = candidates[0];
  // 聚合父 status=unavailable 时，叶自身 ok 也不能提供成功页材料。
  if (plannedExplorationLeaves(parent) !== null &&
      !["ok", "partial"].includes(String(parent.status ?? ""))) {
    fail("observation_status");
  }
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

  // 真正 call_id 只在父块；同一父调用内的两页共享它去找 canonical assistant 与请求。
  const callId = parent.call_id;
  page.call_id = nonBlank(callId) ? callId : null;
  page.observation_ref = observationRefOf(block);
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
  } else if (!isDeepStrictEqual(nextResults[0].payload, parent)) {
    fail("next_payload_mismatch");
  }
  return page;
}

// ── B82 §7/§16.9 候选证据 ────────────────────────────────────────────────────
// facts 是 readBatchAuthoringHistory 内部 turnFacts（同 owning topic、输入后 scoped）；
// run 是该入口精确定位的 agent_runs 行；records 是同一 run 已对账的 native calls。
function resultBody(record) {
  return isObject(record?.frame?.[4]) ? record.frame[4] : null;
}

function candidateTurn(facts, run) {
  if (!isObject(facts)) return { reason: "turn_facts_missing" };
  if (!isObject(run)) return { reason: "run_row_missing" };
  if (run.status !== "completed") return { reason: "run_not_completed" };
  if (run.parent_turn_ref !== facts.turnId) return { reason: "run_turn_mismatch" };
  if (!isObject(facts.ack) || !nonBlank(facts.ack.at)) return { reason: "ack_missing" };
  const completed = list(facts.results).filter((record) => {
    if (!nonBlank(record?.at) || record.at < facts.ack.at) return false;
    const agentRun = resultBody(record)?.agent_run;
    return isObject(agentRun) && agentRun.run_id === run.id && agentRun.status === "completed";
  });
  if (completed.length === 0) return { reason: "completed_result_missing" };
  if (completed.length > 1) return { reason: "completed_result_ambiguous" };
  const body = resultBody(completed[0]);
  // 终局身份必须精确等于 run；缺字段不接受（nonBlank 同时排除 null/undefined/空串）。
  if (!nonBlank(body.work_id) || body.work_id !== run.work_id) return { reason: "work_mismatch" };
  if (!nonBlank(body.session_id) || body.session_id !== run.session_id) return { reason: "session_mismatch" };
  return { body };
}

function candidateEntry(body, { pending, chapterRef }) {
  if (!Array.isArray(pending) || pending.length === 0) return { reason: "pending_missing" };
  const sameChapter = list(body?.adoption_state?.pending).filter((entry) =>
    entry?.adoption_status === "TENTATIVE" &&
    entry?.artifact_type === "prose_fragment" &&
    entry?.target_chapter_ref === chapterRef);
  // 终局帧可带历史同章候选：先按本 run 持久 pending ids 缩到本 run，再核唯一。
  // 历史候选不能抢占当前候选，也不能让当前候选误歧义；旧 pending_not_in_run 反例保留。
  const matches = sameChapter.filter((entry) =>
    nonBlank(entry?.artifact_id) && pending.includes(entry.artifact_id));
  if (matches.length === 0) {
    return { reason: sameChapter.length > 0 ? "pending_not_in_run" : "candidate_missing" };
  }
  if (matches.length > 1) return { reason: "candidate_ambiguous" };
  const entry = matches[0];
  const payload = isObject(entry.payload) ? entry.payload : {};
  if (payload.modification_scope !== "target_segments") return { reason: "scope_mismatch" };
  if (!isObject(payload.adoption_effect) || payload.adoption_effect.mode !== "replace_segments") {
    return { reason: "effect_mismatch" };
  }
  return { entry, payload, items: list(payload.items) };
}

// 最终真实文本必须看到对应 item 标题+正文；缺/空 baseline 无法证明「新增」，
// 输入前已同时出现同 item 文本则不算新证据（stale 检查保留）。
function visibleReason(items, beforeText, finalText) {
  if (!items.every((item) => nonBlank(item?.title) && nonBlank(item?.body))) return "item_text_missing";
  if (!nonBlank(beforeText)) return "baseline_visible_missing";
  const final = text(finalText);
  const before = text(beforeText);
  if (!items.every((item) => final.includes(item.title) && final.includes(item.body))) {
    return "final_visible_missing";
  }
  if (items.some((item) => before.includes(item.title) && before.includes(item.body))) {
    return "visible_preexisting";
  }
  return null;
}

export function g2CandidateEvidence({ facts, run, pending, chapterRef, records, beforeText, finalText } = {}) {
  const base = {
    ok: false,
    reason: null,
    turn_ref: facts?.turnId ?? null,
    run_ref: run?.id ?? null,
    pending_ref: null,
    artifact_type: null,
    adoption_status: null,
    target_chapter_ref: chapterRef ?? null,
    modification_scope: null,
    adoption_effect: null,
    item_refs: [],
    provider_call_ref: null,
    writer_item_count: null,
    visible: { before_has_item: false, final_has_item: false },
  };
  if (!nonBlank(chapterRef)) return { ...base, reason: "chapter_ref_missing" };
  const turn = candidateTurn(facts, run);
  if (turn.body === undefined) return { ...base, reason: turn.reason };
  const found = candidateEntry(turn.body, { pending, chapterRef });
  if (found.entry === undefined) return { ...base, reason: found.reason };
  const { entry, payload, items } = found;
  const candidate = {
    ...base,
    pending_ref: entry.artifact_id ?? null,
    artifact_type: entry.artifact_type ?? null,
    adoption_status: entry.adoption_status ?? null,
    target_chapter_ref: entry.target_chapter_ref ?? null,
    modification_scope: payload.modification_scope ?? null,
    adoption_effect: payload.adoption_effect?.mode ?? null,
    item_refs: items.map((item) => item?.item_id ?? null),
  };
  if (items.length === 0) return { ...candidate, reason: "items_missing" };
  const writer = writerArtifactMatch({ artifact: { payload: { items } }, records });
  if (!writer.ok) return { ...candidate, reason: writer.reason };
  const bad = visibleReason(items, beforeText, finalText);
  const final = text(finalText);
  const before = text(beforeText);
  return {
    ...candidate,
    ok: bad === null,
    reason: bad,
    provider_call_ref: writer.provider_call_ref,
    writer_item_count: writer.writer_item_count,
    visible: {
      before_has_item: items.some((item) => before.includes(item.title) && before.includes(item.body)),
      final_has_item: items.every((item) => final.includes(item.title) && final.includes(item.body)),
    },
  };
}

// ── B82 §7 G2 页级使用证据 ──────────────────────────────────────────────────
// 只复用已算的 liveRefsCheck.reports：页与候选都成立后，按 candidate.provider_call_ref
// 唯一配对 writer 自报报告（该报告已由 pcall/prun 与实际请求绑定）；每页的
// observation_ref 必须在同报告 matched_refs 且来源 channel=content_observation_ref、
// call_id 精确等于该页。Base/scope/其它调用/其它观察 ID 都不能补证。两页各自通过后
// 还要求 observation_ref 彼此不同，避免同一 observation_ref 的两个 call_id 重复签两页。
function pageUsage(page, report) {
  const entry = {
    range: Array.isArray(page?.range) ? page.range : null,
    observation_ref: page?.observation_ref ?? null,
    call_id: page?.call_id ?? null,
    reason: null,
  };
  if (!nonBlank(entry.observation_ref)) return { ...entry, reason: "observation_ref_missing" };
  if (!nonBlank(entry.call_id)) return { ...entry, reason: "call_id_missing" };
  const matched = list(report.matched_refs).some((match) =>
    match?.ref === entry.observation_ref &&
    list(match.sources).some((source) =>
      source?.channel === "content_observation_ref" && source?.call_id === entry.call_id));
  return matched ? entry : { ...entry, reason: "page_observation_ref_unmatched" };
}

export function g2PageUsageEvidence({ pages, candidate, reports } = {}) {
  const base = { ok: false, reason: null, writer_report_ref: null, pages: [] };
  if (!isObject(pages) || pages.ok !== true) return { ...base, reason: "pages_not_ok" };
  if (!isObject(candidate) || candidate.ok !== true) return { ...base, reason: "candidate_not_ok" };
  if (!nonBlank(candidate.provider_call_ref)) return { ...base, reason: "candidate_provider_call_missing" };
  const matched = list(reports).filter((report) => report?.provider_call_ref === candidate.provider_call_ref);
  if (matched.length === 0) return { ...base, reason: "writer_report_missing" };
  if (matched.length > 1) return { ...base, reason: "writer_report_ambiguous" };
  const report = matched[0];
  const pageReports = list(pages.pages).map((page) => pageUsage(page, report));
  const pagesOk =
    report.status === "verified" &&
    pageReports.length === PAGES.length &&
    pageReports.every((page) => page.reason === null);
  const uniqueRefs = new Set(pageReports.map((page) => page.observation_ref));
  let reason = null;
  if (report.status !== "verified") reason = "writer_report_not_verified";
  else if (!pagesOk) reason = "page_usage_missing";
  else if (uniqueRefs.size !== pageReports.length) reason = "page_observation_ref_ambiguous";
  return {
    ok: reason === null,
    reason,
    writer_report_ref: candidate.provider_call_ref,
    pages: pageReports,
  };
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
