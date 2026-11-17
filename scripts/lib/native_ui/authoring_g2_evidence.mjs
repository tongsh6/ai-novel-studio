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
import { checkAuthorVisibleTexts } from "./author_visible_check.mjs";

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

// ── B82 G2 作者可见终局与页面判据（纯文本，不消费内部 ref/版本/DB/wire）──────────
// 历史页/候选/页级使用 helper 保留供独立诊断；页面通过只看作者能感知的文本。
const LOCAL_REVISION_TITLE = "指定段落修订稿";
const LOCAL_REVISION_SUFFIX = `（${LOCAL_REVISION_TITLE}）`;
const PENDING_REVISION_ACTIONS = Object.freeze(["保存修订稿", "保存为章节正文", "保存到作品"]);
const PENDING_REVISION_STATES = Object.freeze(["修订稿候选", "待采纳", "待保存章节草稿"]);
const LOADING_RE = /加载中[….\.]*/u;
// 阅读页可能先显示旧投影再刷新；这些作者可见状态出现时页面还不是本次已加载正文。
const PROJECTION_NOT_FRESH = Object.freeze([
  "投影状态：已过期",
  "投影状态：重建中",
  "正在读取最新章节",
  "投影状态：重建失败",
  "未能完整读取最新章节",
]);
const AUTHOR_VISIBLE_FIELDS = Object.freeze(["work_title", "chapter_title", "reading_excerpt"]);
const CHAPTER_ORDER_RE = /第\s*([0-9０-９一二三四五六七八九十百千两零〇]+)\s*章/u;
// prereg 的 chapter_title 必须是作者可见的完整标签：章序 + 章名（如「第02章：灰烬中的手印」）。
const CHAPTER_LABEL_RE = /^第\s*([0-9０-９一二三四五六七八九十百千两零〇]+)\s*章\s*[：:、.．\-—– ]?\s*(.+)$/u;
const READ_ACTIVITY_MARKER = "已阅读章节正文";
const READ_RANGE_RE = /第\s*(\d+)\s*[–—~-]\s*(\d+)\s*字符\s*\/\s*共\s*(\d+)\s*字符/u;
const ACTIVITY_CHAPTER_RE = /[「《]([^」》]+)[」》]/u;

const FULLWIDTH_DIGITS_RE = /[０-９]/gu;

function normalizeOrder(value) {
  const ascii = String(value).replace(FULLWIDTH_DIGITS_RE, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  if (/^\d+$/u.test(ascii)) return String(Number(ascii));
  const numerals = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (ascii === "十") return "10";
  if (ascii.length === 2 && ascii[0] === "十") return String(10 + (numerals[ascii[1]] ?? NaN));
  if (ascii.length === 2 && ascii[1] === "十") return String((numerals[ascii[0]] ?? NaN) * 10);
  if (ascii.length === 3 && ascii[1] === "十") {
    return String((numerals[ascii[0]] ?? NaN) * 10 + (numerals[ascii[2]] ?? NaN));
  }
  return ascii;
}

export function parseChapterLabel(value) {
  const match = CHAPTER_LABEL_RE.exec(text(value).trim());
  if (!match) return null;
  const name = match[2].trim();
  if (!nonBlank(name)) return null;
  return { order: normalizeOrder(match[1]), name };
}

// 运行详情抽屉标题由 copy.agentRunDockTitle 拼成「状态 · 创作」；只在该精确 AX
// value 状态行剥离这个已知徽标，正文/旧回合/作者原话里的同样文字仍不算状态。
// 「创作执行」是作者可见内部术语（display_names 已禁），不是页面徽标，不在此列。
const AX_STATUS_BADGE = " · 创作";

// 只认真实状态行/状态 value，不在正文里搜「失败/错误」等词。
const STATUS_EXACT_KINDS = Object.freeze({
  "失败": "failed",
  "已停止": "failed",
  "已取消": "failed",
  "已完成": "completed",
  "等待你回复": "waiting",
  "需要确认": "waiting",
  "已暂停": "waiting",
});
const COMPLETED_PROGRESS_RE = /^已完成\s+.*第\s*\d+\s*\/\s*\d+\s*步/u;
const RUNNING_STATUS_RE = /^进行中(?:\s|$)/u;

function stripStatusBadge(raw, stripBadge) {
  if (!stripBadge) return raw;
  return raw.endsWith(AX_STATUS_BADGE) ? raw.slice(0, -AX_STATUS_BADGE.length) : raw;
}

function statusTokenKind(tokenValue, stripBadge) {
  const token = stripStatusBadge(String(tokenValue).trim(), stripBadge);
  // 历史进度行「已完成 创作执行 第 3/3 步」也是状态行；正文「已完成核对」不算。
  if (Object.hasOwn(STATUS_EXACT_KINDS, token)) return STATUS_EXACT_KINDS[token];
  if (COMPLETED_PROGRESS_RE.test(token)) return "completed";
  if (RUNNING_STATUS_RE.test(token)) return "running";
  return null;
}

function statusLineKind(line) {
  const valueMatch = /\(value=([^)\n]*)\)/u.exec(line);
  // 只有真实 AX value 行才允许剥离「 · 创作」徽标；纯文本保持原语义。
  return valueMatch ? statusTokenKind(valueMatch[1], true) : statusTokenKind(line, false);
}

// 只按本次作者消息之后的页面文本判断终局：旧回合、标题栏「无任务」和作者原话里的
// 失败/等待词都不会被当成这次 run 的终局。作者消息本身不参与状态词匹配。
// 找不到本次作者消息时返回 unknown，绝不用整页兜底。
export function authorVisibleOutcome(value, { message = "" } = {}) {
  const source = text(value);
  const messageIndex = nonBlank(message) ? source.lastIndexOf(message) : -1;
  if (messageIndex < 0) return { kind: "unknown" };
  const tail = source.slice(messageIndex + message.length);
  if (
    tail.includes(LOCAL_REVISION_SUFFIX) &&
    tail.includes(LOCAL_REVISION_TITLE) &&
    PENDING_REVISION_ACTIONS.some((label) => tail.includes(label))
  ) {
    return { kind: "pending_candidate" };
  }
  let kind = "unknown";
  for (const line of tail.split(/\r?\n/u)) {
    const status = statusLineKind(line);
    if (status) kind = status;
  }
  return { kind };
}

// ── 按 AX 树归属的本轮终态（R01 外部驱动）────────────────────────────────────
// 页底 flat tail 会把旧任务 dock 的「等待你回复」当成新回合终态。这里只接受
// 本条作者消息之后、同一消息流容器内的「本轮创作过程」/「创作问题记录」组：
// 过程组内的精确状态行、问题组内的「等待你的回答」才算本轮证据；页底
// 「当前创作任务操作」/「回答当前问题」及旧的全局状态组不参与。
const TURN_PROCESS_GROUP = "本轮创作过程";
const AUTHOR_QUESTION_GROUP = "创作问题记录";
const AUTHOR_QUESTION_WAITING = "等待你的回答";
const AUTHOR_LABEL = "你";
const CAPABILITY_GAP_PREFIX = "能力缺口：";
const CAPABILITY_GAP_LABEL = "能力缺口";
const WHY_BUTTON_LABEL = "为什么";
const WHY_BUTTON_DESC = "查看这轮回应的依据";

// 真实 AX dump 的节点总有字符串 path；不要为不存在的 null 节点再造第二套读取。
const axText = (value) => (typeof value === "string" ? value : "");
const axPath = (node) => node.path;
const axValue = (node) => axText(node.value);
const axTitle = (node) => axText(node.title);
const axPathParts = (node) =>
  axPath(node)
    .split("/")
    .filter((part) => part !== "")
    .map(Number);

// AX path 是十进制下标序列（真实工作台节点数远小于 1e9）。把每段补零成定宽字符串
// 再比较，等价于逐段数值比较，且不会把 "10" 排到 "9" 前面。
const AX_PATH_SEGMENT_WIDTH = 9;
const axPathKey = (node) =>
  axPathParts(node)
    .map((part) => String(part).padStart(AX_PATH_SEGMENT_WIDTH, "0"))
    .join("/");

function compareAxPath(left, right) {
  return Buffer.compare(Buffer.from(axPathKey(left)), Buffer.from(axPathKey(right)));
}

function axParentPath(node) {
  const parts = axPath(node).split("/");
  parts.pop();
  return parts.join("/");
}

function previousAxSibling(nodes, groupPath) {
  const parent = axParentPath({ path: groupPath });
  const candidates = nodes
    .filter((node) => axParentPath(node) === parent)
    .filter((node) => compareAxPath(node, { path: groupPath }) < 0)
    .sort(compareAxPath);
  return candidates.length > 0 ? candidates.at(-1) : null;
}

function hasAuthorLabel(nodes, groupPath) {
  return nodes.some(
    (node) => axParentPath(node) === groupPath && axValue(node) === AUTHOR_LABEL,
  );
}

// 作者消息节点：父消息组的前一个兄弟组带「你」标签。模型正文即使原样引用同一句，
// 前一个兄弟组是「AI 助手」，不会被当成作者消息；非文本控件也不参与。
function axAuthorNodes(nodes) {
  const matches = [];
  for (const node of nodes) {
    if (node.role !== "AXStaticText") continue;
    if (!nonBlank(axValue(node))) continue;
    const groupPath = axParentPath(node);
    const previous = previousAxSibling(nodes, groupPath);
    if (previous === null || !hasAuthorLabel(nodes, axPath(previous))) continue;
    matches.push(node);
  }
  return matches.sort(compareAxPath);
}

export function axAuthorMessages(nodes, message) {
  return axAuthorNodes(nodes).filter((node) => axValue(node) === message);
}

function directTextValues(nodes, groupPath) {
  return nodes
    .filter((node) => axParentPath(node) === groupPath && node.role === "AXStaticText")
    .map((node) => axValue(node).trim())
    .filter(Boolean);
}

function processGroupKind(nodes, group) {
  for (const value of directTextValues(nodes, axPath(group))) {
    const kind = statusTokenKind(value, true);
    if (kind) return kind;
  }
  return null;
}

// 现役 capability_gap 结果：真实 AXGroup 的可访问说明 + 直接子文本「能力缺口」，
// 且同一作者边界内必须有对应回复组和「为什么」入口。正文关键词不参与。
function withinAuthorBoundary(node, { container, afterPath, beforePath }) {
  if (axParentPath(node) !== container) return false;
  if (compareAxPath(node, { path: afterPath }) <= 0) return false;
  if (beforePath === null) return true;
  return compareAxPath(node, { path: beforePath }) < 0;
}

function isCapabilityGapMarker(nodes, node, boundary) {
  if (node.role !== "AXGroup") return false;
  if (!withinAuthorBoundary(node, boundary)) return false;
  if (typeof node.desc !== "string") return false;
  if (!node.desc.startsWith(CAPABILITY_GAP_PREFIX)) return false;
  return directTextValues(nodes, axPath(node)).includes(CAPABILITY_GAP_LABEL);
}

function capabilityGapMarkers(nodes, boundary) {
  return nodes
    .filter((node) => isCapabilityGapMarker(nodes, node, boundary))
    .sort(compareAxPath);
}

function followingInBoundary(nodes, boundary, marker) {
  return nodes
    .filter((node) => withinAuthorBoundary(node, boundary))
    .filter((node) => compareAxPath(node, marker) > 0)
    .sort(compareAxPath);
}

function gapWhyButton(following) {
  const found = following.find(
    (node) =>
      node.role === "AXButton" &&
      axTitle(node) === WHY_BUTTON_LABEL &&
      node.desc === WHY_BUTTON_DESC,
  );
  return found === undefined ? null : found;
}

function gapReplyGroup(nodes, following, why) {
  const found = following.find(
    (node) =>
      compareAxPath(node, why) < 0 &&
      node.role === "AXGroup" &&
      directTextValues(nodes, axPath(node)).some(
        (value) => value !== CAPABILITY_GAP_LABEL,
      ),
  );
  return found === undefined ? null : found;
}

function capabilityGapFacts(nodes, boundary) {
  const markers = capabilityGapMarkers(nodes, boundary);
  for (const marker of markers.reverse()) {
    const following = followingInBoundary(nodes, boundary, marker);
    const why = gapWhyButton(following);
    if (why === null) continue;
    const reply = gapReplyGroup(nodes, following, why);
    if (reply === null) continue;
    return {
      marker_path: axPath(marker),
      goal: String(marker.desc).slice(CAPABILITY_GAP_PREFIX.length).trim(),
      reply_path: axPath(reply),
      why_path: axPath(why),
    };
  }
  return null;
}

// baselineAuthorCount = 发送前页面里同一原话的作者消息数；只有新增的最后一条才是
// 本轮消息，重复输入不会回看旧回合终局。
function authorBoundary(nodes, message, baselineAuthorCount) {
  const authors = axAuthorMessages(nodes, message);
  if (authors.length <= baselineAuthorCount) return { authors, author: null };
  const author = authors.at(-1);
  const authorGroup = axParentPath(author);
  const container = axParentPath({ path: authorGroup });
  const all = axAuthorNodes(nodes);
  const next = all[all.indexOf(author) + 1];
  return {
    authors,
    author,
    authorGroup,
    container,
    nextAuthor: next === undefined ? null : next,
  };
}

// 46§9.9 的成功整理记录不是运行态。只识别完整的已知可见结构；
// 未知内容或真实状态行仍留在过程判定内，不能靠出现一个按钮就放行。
function maintenanceRecordGroup(nodes, group) {
  if (group.role !== "AXGroup" || axTitle(group) !== TURN_PROCESS_GROUP) return false;
  const children = nodes.filter((node) => axParentPath(node) === axPath(group));
  const notices = children.filter((node) => node.role === "AXButton" &&
    axTitle(node) === "查看已整理的较早创作过程");
  const panels = children.filter((node) => node.role === "AXGroup" &&
    axTitle(node) === "已整理的较早记录");
  return notices.length === 1 && panels.length <= 1 && children.length === notices.length + panels.length;
}

function turnGroups(nodes, { authorGroup, container, nextAuthor }) {
  return nodes
    .filter((node) => {
      if (axParentPath(node) !== container) return false;
      if (compareAxPath(node, { path: authorGroup }) <= 0) return false;
      if (nextAuthor && compareAxPath(node, nextAuthor) >= 0) return false;
      const title = axTitle(node);
      return (title === TURN_PROCESS_GROUP || title === AUTHOR_QUESTION_GROUP) &&
        !maintenanceRecordGroup(nodes, node);
    })
    .sort(compareAxPath);
}

function turnGroupKind(nodes, group) {
  if (axTitle(group) !== AUTHOR_QUESTION_GROUP) return processGroupKind(nodes, group);
  return directTextValues(nodes, axPath(group)).includes(AUTHOR_QUESTION_WAITING)
    ? "waiting"
    : null;
}

function outcomeBase(kind, author, authorCount, extra = {}) {
  return { kind, author_count: authorCount, author_path: axPath(author), ...extra };
}

function capabilityGapOutcome(author, authorCount, gap, extra = {}) {
  return outcomeBase("capability_gap", author, authorCount, { ...extra, gap });
}

export function axTurnOutcome(
  nodes,
  { message = "", baselineAuthorCount = 0 } = {},
) {
  const list = Array.isArray(nodes) ? nodes : [];
  const boundary = authorBoundary(list, message, baselineAuthorCount);
  if (!boundary.author) {
    return {
      kind: "unknown",
      author_count: boundary.authors.length,
      author_path: null,
    };
  }
  const { author, authorGroup, container, nextAuthor } = boundary;
  const authorCount = boundary.authors.length;
  // 下一条作者消息是本轮的硬边界：不能把后一轮的「本轮创作过程」借给上一轮。
  // 同一轮若出现多个过程组，DOM/路径更晚的是更新状态；取最后一个。
  const groups = turnGroups(list, { authorGroup, container, nextAuthor });
  const gap = capabilityGapFacts(list, {
    container,
    afterPath: authorGroup,
    beforePath: nextAuthor === null ? null : axPath(nextAuthor),
  });
  if (groups.length === 0) {
    if (gap) {
      return capabilityGapOutcome(author, authorCount, gap, { group_title: null });
    }
    // 普通回复按 46§9.5 隐藏空过程组：真实交付入口 + 顶栏空闲共同证明可见终局。
    // 只认最后作者边界；后台维护/其它活动任务存在时不从回复猜测终态。
    const idle = list.some((node) => node.role === "AXStaticText" &&
      axValue(node) === "无任务" && axParentPath(node) === container &&
      compareAxPath(node, { path: authorGroup }) < 0);
    const busy = list.some((node) => ["当前创作任务操作", "回答当前问题"]
      .includes(axTitle(node)));
    const following = followingInBoundary(list,
      { container, afterPath: authorGroup, beforePath: null }, { path: authorGroup });
    const why = gapWhyButton(following);
    const assistantName = list.find((node) => node.role === "AXPopUpButton" &&
      node.desc === "助手名称")?.title;
    const label = nonBlank(assistantName) ? following.find((node) => node.role === "AXGroup" &&
      directTextValues(list, axPath(node)).includes(assistantName)) : null;
    // Markdown 段落/标题/列表可能成为平级 AX 节点，不能要求 Why 的前一个节点就是整条回复。
    const reply = label && why ? following.find((block) => !maintenanceRecordGroup(list, block) &&
      compareAxPath(block, label) > 0 &&
      compareAxPath(block, why) < 0 && list.some((node) => node.role === "AXStaticText" &&
        (axPath(node) === axPath(block) || axPath(node).startsWith(axPath(block) + "/")) &&
        nonBlank(axValue(node)))) : null;
    if (nextAuthor === null && list.some((node) => node.role === "AXWindow") &&
      idle && !busy && reply) {
      return outcomeBase("completed", author, authorCount,
        { group_title: null, reply_path: axPath(reply), why_path: axPath(why), idle: true });
    }
    // 没有真实活动组也没有 gap 结构时不能自行声称 running；缺可见状态就是 unknown。
    return outcomeBase("unknown", author, authorCount, { group_title: null });
  }
  const group = groups.at(-1);
  const groupFacts = { group_title: axTitle(group), group_path: axPath(group) };
  const groupKind = turnGroupKind(list, group);
  if (groupKind) return outcomeBase(groupKind, author, authorCount, groupFacts);
  if (gap) return capabilityGapOutcome(author, authorCount, gap, groupFacts);
  return outcomeBase("unknown", author, authorCount, groupFacts);
}

export function countAxAuthorMessages(nodes, message) {
  return axAuthorMessages(nodes, message).length;
}

export const readingPageFailure = (page, target) => {
  if (!nonBlank(page)) return "missing";
  if (LOADING_RE.test(page)) return "loading";
  if (PROJECTION_NOT_FRESH.some((marker) => page.includes(marker))) return "projection_not_fresh";
  if (!page.includes(target.work_title)) return "work_title_missing";
  if (!page.includes(target.chapter_title)) return "chapter_title_missing";
  if (!page.includes(target.reading_excerpt)) return "reading_excerpt_missing";
  return null;
};

// 阅读页 AX 是完整章节区；前后必须整页稳定相等，不能只比含末页摘录的一行。
const normalizeReadingPage = (value) =>
  text(value)
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

const activityForChapter = (line, chapter) => {
  if (!line.includes(READ_ACTIVITY_MARKER)) return null;
  const nameMatch = ACTIVITY_CHAPTER_RE.exec(line);
  if (!nameMatch || nameMatch[1].trim() !== chapter.name) return null;
  const orderMatch = CHAPTER_ORDER_RE.exec(line);
  if (!orderMatch || normalizeOrder(orderMatch[1]) !== chapter.order) return null;
  const rangeMatch = READ_RANGE_RE.exec(line);
  return {
    line,
    range: rangeMatch
      ? { start: Number(rangeMatch[1]), end: Number(rangeMatch[2]), total: Number(rangeMatch[3]) }
      : null,
  };
};

// 本次回合的可见读证：只用同次实际可见的范围从 1 连续覆盖到一致 total。
// 未标范围的读活动（生产首页目前只显示有效字数）不填缺口，单次 1..total 才算完整。
// G2 要求整章覆盖；G3 只要求至少一个真实范围，因此范围合法性单独复用。
function rangesValid(ranges) {
  if (ranges.length === 0) return false;
  const totals = new Set(ranges.map((range) => range.total));
  if (totals.size !== 1) return false;
  const [total] = totals;
  return (
    total > 0 &&
    ranges.every((range) => range.start >= 1 && range.end >= range.start && range.end <= total)
  );
}

function readingActivityReason(activities) {
  if (activities.length === 0) return "reading_activity_missing";
  const ranges = activities.map((activity) => activity.range).filter(Boolean);
  if (!rangesValid(ranges)) return "reading_not_complete";
  const [total] = new Set(ranges.map((range) => range.total));
  let covered = 0;
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    if (range.start > covered + 1) return "reading_not_complete";
    covered = Math.max(covered, range.end);
  }
  return covered === total ? null : "reading_not_complete";
}

// 共享的作者可见页面表面：冻结目标、本次作者消息之后的本回合、前后完整阅读页与
// 内部词扫描。G2/G3 只在这层之上追加各自终局判据，不复制阅读页/作者消息/泄漏判定。
function visiblePageSurface({
  target,
  message,
  afterInputText,
  finalText,
  readingBeforeText,
  readingAfterText,
  tokens,
}) {
  const observed = {
    author_message: false,
    after_input_has_message: false,
    chapter_title_visible: false,
    reading_excerpt_before: false,
    reading_excerpt_after: false,
    reading_unchanged: false,
  };
  const failures = [];
  const targetOk =
    isObject(target) && AUTHOR_VISIBLE_FIELDS.every((field) => nonBlank(target[field]));
  if (!targetOk) failures.push("author_visible_target_missing");
  const expected = targetOk ? target : null;
  const chapter = expected ? parseChapterLabel(expected.chapter_title) : null;
  if (expected && !chapter) failures.push("chapter_label_incomplete");
  const final = text(finalText);
  const before = text(readingBeforeText);
  const after = text(readingAfterText);
  if (!nonBlank(final)) failures.push("final_visible_missing");
  // 本次回合只取作者消息之后的可见文本：历史同章候选即使仍在页面上也不能代签。
  // 缺当前作者消息时 currentTurn 为空，不用整页兜底。
  const messageIndex = nonBlank(message) ? final.lastIndexOf(message) : -1;
  const currentTurn = messageIndex >= 0 ? final.slice(messageIndex + message.length) : "";

  // 页面判定只认当前 final AX 里的作者消息；after-input 只留作提交诊断。
  observed.after_input_has_message = nonBlank(message) && text(afterInputText).includes(message);
  observed.author_message = nonBlank(message) && final.includes(message);
  if (!observed.author_message) failures.push("author_message_visible_missing");

  if (expected) {
    const beforeReason = readingPageFailure(before, expected);
    const afterReason = readingPageFailure(after, expected);
    observed.chapter_title_visible =
      before.includes(expected.chapter_title) || after.includes(expected.chapter_title);
    observed.reading_excerpt_before = before.includes(expected.reading_excerpt);
    observed.reading_excerpt_after = after.includes(expected.reading_excerpt);
    if (beforeReason) failures.push(`reading_before_${beforeReason}`);
    if (afterReason) failures.push(`reading_after_${afterReason}`);
    observed.reading_unchanged =
      beforeReason === null &&
      afterReason === null &&
      normalizeReadingPage(before) === normalizeReadingPage(after);
    if (beforeReason === null && afterReason === null && !observed.reading_unchanged) {
      failures.push("reading_changed");
    }
  }

  const scan = checkAuthorVisibleTexts({ visibleText: currentTurn, tokens });
  return { observed, failures, expected, chapter, final, currentTurn, scan };
}

const NON_REPLY_LINES = Object.freeze(["你", "AI 助手", "本轮创作过程"]);

// 真实回复只看作者消息、状态行、AX 角色/分区标签与读活动之外的本回合可见内容；
// 只有状态徽标（哪怕显示「已完成」）或只有工具读活动都不算模型给作者的回复。
function replyVisible(currentTurn) {
  return currentTurn.split(/\r?\n/u).some((line) => {
    const trimmed = line.trim();
    return (
      trimmed !== "" &&
      !NON_REPLY_LINES.includes(trimmed) &&
      !line.includes(READ_ACTIVITY_MARKER) &&
      statusLineKind(line) === null
    );
  });
}

const hasPendingCandidate = (currentTurn) =>
  currentTurn.includes(LOCAL_REVISION_SUFFIX) ||
  (currentTurn.includes(LOCAL_REVISION_TITLE) &&
    PENDING_REVISION_STATES.some((label) => currentTurn.includes(label)));

// 保存操作只认独立可见控件行，不把模型回复里「不会保存修订稿」这类说明当成操作。
const hasSaveAction = (currentTurn) =>
  currentTurn
    .split(/\r?\n/u)
    .some((line) => PENDING_REVISION_ACTIONS.includes(line.trim()));

// G2：真实作者消息可见、本次可见读证覆盖完整章、阅读前后完整同页文本未变、
// 同章局部「指定段落修订稿」待采纳候选可见、应用输出未泄漏技术术语/编号。
export function g2VisibleEvidence({
  target,
  message,
  afterInputText,
  finalText,
  readingBeforeText,
  readingAfterText,
  tokens,
} = {}) {
  const surface = visiblePageSurface({
    target,
    message,
    afterInputText,
    finalText,
    readingBeforeText,
    readingAfterText,
    tokens,
  });
  const failures = surface.failures;
  const scan = surface.scan;
  const observed = {
    ...surface.observed,
    reading_complete: false,
    pending_candidate: false,
    candidate_same_chapter: false,
    author_visible_clean: scan.ok,
  };

  if (surface.expected) {
    const expected = surface.expected;
    const chapter = surface.chapter;
    const currentTurn = surface.currentTurn;
    // 候选标题行必须同时带完整目标章标签和「（指定段落修订稿）」；只用本次回合。
    const candidateLines = currentTurn
      .split(/\r?\n/u)
      .filter((line) => line.includes(LOCAL_REVISION_SUFFIX));
    observed.candidate_same_chapter = candidateLines.some((line) =>
      line.includes(expected.chapter_title));
    observed.pending_candidate =
      observed.candidate_same_chapter &&
      currentTurn.includes(LOCAL_REVISION_TITLE) &&
      PENDING_REVISION_ACTIONS.some((label) => currentTurn.includes(label)) &&
      PENDING_REVISION_STATES.some((label) => currentTurn.includes(label));
    if (!observed.pending_candidate) failures.push("pending_candidate_missing");

    // 读完整章的可见读证只取本次回合，不用手工阅读页的摘录一行替代。
    const activities = chapter
      ? currentTurn
        .split(/\r?\n/u)
        .map((line) => activityForChapter(line, chapter))
        .filter(Boolean)
      : [];
    const activityReason = chapter ? readingActivityReason(activities) : "chapter_label_incomplete";
    observed.reading_complete = activityReason === null;
    if (activityReason && activityReason !== "chapter_label_incomplete") {
      failures.push(activityReason);
    }
  } else {
    failures.push("pending_candidate_missing");
  }

  if (!scan.ok) failures.push("author_visible_internal_token_leak");

  return {
    ok: failures.length === 0,
    reason: failures[0] ?? null,
    failures,
    observed,
    leak: { ok: scan.ok, hits: scan.hits.map(({ token, kind }) => ({ token, kind })) },
  };
}

// G3：本次只读原话之后出现真实回复且 completed；实际可见目标章至少一个带范围的
// 真实页（不要求全章）；前后阅读内容一致；本回合没有新候选或保存操作。
export function g3VisibleEvidence({
  target,
  message,
  afterInputText,
  finalText,
  readingBeforeText,
  readingAfterText,
  tokens,
} = {}) {
  const surface = visiblePageSurface({
    target,
    message,
    afterInputText,
    finalText,
    readingBeforeText,
    readingAfterText,
    tokens,
  });
  const failures = surface.failures;
  const scan = surface.scan;
  const currentTurn = surface.currentTurn;
  const outcome = authorVisibleOutcome(surface.final, { message });
  const observed = {
    ...surface.observed,
    outcome: outcome.kind,
    completed: outcome.kind === "completed",
    reply_visible: replyVisible(currentTurn),
    reading_activity: false,
    reading_range: null,
    pending_candidate: hasPendingCandidate(currentTurn),
    save_action: hasSaveAction(currentTurn),
    author_visible_clean: scan.ok,
  };

  if (observed.author_message) {
    if (!observed.completed) failures.push("author_visible_outcome_not_completed");
    if (!observed.reply_visible) failures.push("author_reply_missing");
  }

  if (surface.chapter) {
    const activities = currentTurn
      .split(/\r?\n/u)
      .map((line) => activityForChapter(line, surface.chapter))
      .filter(Boolean);
    const ranges = activities.map((activity) => activity.range).filter(Boolean);
    observed.reading_activity = activities.length > 0;
    observed.reading_range = ranges[0] ?? null;
    if (activities.length === 0) failures.push("reading_activity_missing");
    else if (!rangesValid(ranges)) failures.push("reading_range_missing");
  }

  if (observed.pending_candidate) failures.push("unexpected_pending_candidate");
  if (observed.save_action) failures.push("unexpected_save_action");
  if (!scan.ok) failures.push("author_visible_internal_token_leak");

  return {
    ok: failures.length === 0,
    reason: failures[0] ?? null,
    failures,
    observed,
    leak: { ok: scan.ok, hits: scan.hits.map(({ token, kind }) => ({ token, kind })) },
  };
}
