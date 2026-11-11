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

function parseChapterLabel(value) {
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
function statusLineKind(line) {
  const valueMatch = /\(value=([^)\n]*)\)/u.exec(line);
  const raw = (valueMatch ? valueMatch[1] : line).trim();
  const token = valueMatch && raw.endsWith(AX_STATUS_BADGE)
    ? raw.slice(0, -AX_STATUS_BADGE.length)
    : raw;
  if (token === "失败" || token === "已停止" || token === "已取消") return "failed";
  if (token === "已完成") return "completed";
  // 历史进度行「已完成 创作执行 第 3/3 步」也是状态行；正文「已完成核对」不算。
  if (/^已完成\s+.*第\s*\d+\s*\/\s*\d+\s*步/u.test(token)) return "completed";
  if (token === "等待你回复" || token === "需要确认" || token === "已暂停") return "waiting";
  if (/^进行中(?:\s|$)/u.test(token)) return "running";
  return null;
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

// 阅读页先显示旧投影是真实产品行为：只有标题/正文出现且投影已 fresh 才算读到本次正文。
// driver 与 verifier 共用这一处判定，不各造文字判据。
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
function readingActivityReason(activities) {
  if (activities.length === 0) return "reading_activity_missing";
  const ranges = activities.map((activity) => activity.range).filter(Boolean);
  if (ranges.length === 0) return "reading_not_complete";
  const totals = new Set(ranges.map((range) => range.total));
  if (totals.size !== 1) return "reading_not_complete";
  const [total] = totals;
  if (
    total <= 0 ||
    ranges.some((range) => range.start < 1 || range.end < range.start || range.end > total)
  ) {
    return "reading_not_complete";
  }
  let covered = 0;
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    if (range.start > covered + 1) return "reading_not_complete";
    covered = Math.max(covered, range.end);
  }
  return covered === total ? null : "reading_not_complete";
}

// 页面通过只看：真实作者消息可见、本次可见读证覆盖完整章、阅读前后完整同页文本
// 未变、同章局部「指定段落修订稿」待采纳候选可见、应用输出未泄漏技术术语/编号。
export function g2VisibleEvidence({
  target,
  message,
  afterInputText,
  finalText,
  readingBeforeText,
  readingAfterText,
  tokens,
} = {}) {
  const observed = {
    author_message: false,
    after_input_has_message: false,
    chapter_title_visible: false,
    reading_excerpt_before: false,
    reading_excerpt_after: false,
    reading_unchanged: false,
    reading_complete: false,
    pending_candidate: false,
    candidate_same_chapter: false,
    author_visible_clean: false,
  };
  const failures = [];
  const targetOk =
    isObject(target) && AUTHOR_VISIBLE_FIELDS.every((field) => nonBlank(target[field]));
  if (!targetOk) failures.push("author_visible_target_missing");
  const expected = targetOk ? target : null;
  const chapter = expected ? parseChapterLabel(expected.chapter_title) : null;
  if (expected && !chapter) failures.push("chapter_label_incomplete");
  const afterInput = text(afterInputText);
  const final = text(finalText);
  const before = text(readingBeforeText);
  const after = text(readingAfterText);
  if (!nonBlank(final)) failures.push("final_visible_missing");
  // 本次回合只取作者消息之后的可见文本：历史同章候选即使仍在页面上也不能代签。
  // 缺当前作者消息时 currentTurn 为空，不用整页兜底。
  const messageIndex = nonBlank(message) ? final.lastIndexOf(message) : -1;
  const currentTurn = messageIndex >= 0 ? final.slice(messageIndex + message.length) : "";

  // 页面判定只认当前 final AX 里的作者消息；after-input 只留作提交诊断。
  observed.after_input_has_message = nonBlank(message) && afterInput.includes(message);
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

  const scan = checkAuthorVisibleTexts({ visibleText: currentTurn, tokens });
  observed.author_visible_clean = scan.ok;
  if (!scan.ok) failures.push("author_visible_internal_token_leak");

  return {
    ok: failures.length === 0,
    reason: failures[0] ?? null,
    failures,
    observed,
    leak: { ok: scan.ok, hits: scan.hits.map(({ token, kind }) => ({ token, kind })) },
  };
}
