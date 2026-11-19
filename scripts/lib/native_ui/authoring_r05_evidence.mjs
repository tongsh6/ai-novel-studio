// B87 R05 四个新增作者目标的纯审计；无文件/DB/启动/成本读取。
// 输入是既有 reader 对同一 provider call 的事实，scope 已经 canonical 绑定。
// 页面表面、request 观察/正文解析与 used-ref 授信仍归原 owner；本模块核同次真实材料的范围供应。
import { isDeepStrictEqual } from "node:util";
import { authorBoundary, axTurnOutcome, visiblePageSurface, withinAuthorBoundary } from "./authoring_g2_evidence.mjs";
import { observationRefOf, proseObservationBodyReason, singleDraftVersionReason } from "./authoring_request_facts.mjs";
import { sha256Hex } from "./request_cost_evidence.mjs";
import { locatePendingItem, locateScopedButton } from "./authoring_pending_evidence.mjs";

const GOALS = new Set(["count", "quality", "whole", "style"]);
const list = (value) => Array.isArray(value) ? value : [];
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const same = (left, right) => isDeepStrictEqual(left, right);
const graphemes = (value) => Array.from(new Intl.Segmenter("und", { granularity: "grapheme" }).segment(value), (part) => part.segment);
const chars = (value) => graphemes(value).length;

function boundRequest(request) {
  return request?.facts?.ok === true && request.scope !== null && request.scope !== undefined &&
    same(request.facts.scopeMessages.at(-1), request.scope);
}
function selectedRequest(requests, providerCallRef) {
  const matches = requests.filter((request) => request.provider_call_ref === providerCallRef);
  return matches.length === 1 && boundRequest(matches[0]) ? matches[0] : null;
}
// 只核现役 N-NARR 来源契约；可见文字由生产层决定，这里不复制 sanitizer。
function replySourceBound(witness, request, runId, reply) {
  const event = witness?.event, output = witness?.output;
  const payload = event?.payload, source = payload?.author_narrative_source;
  const range = source?.source_byte_range;
  if (!request || !nonBlank(runId) || !nonBlank(reply) ||
    event?.run_id !== runId || event.event_type !== "judgment_decided" ||
    payload?.action !== "reply" || payload.author_narrative !== reply ||
    source?.source_type !== "provider_output" || output?.run_id !== runId ||
    output.role !== "assistant" || output.provenance !== "model" ||
    source.provider_call_ref !== request.provider_call_ref ||
    source.provider_run_ref !== request.provider_run_ref ||
    source.provider_output_ref !== request.provider_run_ref ||
    output.provider_call_ref !== request.provider_call_ref ||
    output.provider_run_ref !== request.provider_run_ref ||
    !Array.isArray(output.blocks) || output.blocks.some((block) => block.type === "tool_call") ||
    !Number.isInteger(range?.start) || range.start < 0 ||
    !Number.isInteger(range.length) || range.length <= 0) return false;
  const text = output.blocks.filter((block) => block.type === "text").map((block) => block.text);
  if (text.length === 0 || !text.every((value) => typeof value === "string")) return false;
  const raw = text.join(""), bytes = Buffer.from(raw, "utf8");
  const end = range.start + range.length;
  return end <= bytes.length && source.source_hash === sha256Hex(raw) &&
    source.narrative_hash === sha256Hex(reply) &&
    bytes.subarray(range.start, end).equals(Buffer.from(reply, "utf8"));
}
function usableLeaves(request) {
  if (!boundRequest(request)) return [];
  return list(request.facts.observations).filter((unit) =>
    ["tool", "application"].includes(unit.provenance) &&
    unit.payload?.status === "ok" &&
    (unit.provenance === "application" || ["ok", "partial"].includes(unit.parentStatus)));
}
function materialFact(unit, ref) {
  return unit ? { ref, version: unit.payload.versions?.[ref] ?? null,
    provenance: unit.provenance, observation_ref: observationRefOf(unit.payload),
    coverage: unit.payload.coverage, next_offset: unit.payload.next_offset ?? null } : null;
}
function fullProse(request, source) {
  if (!nonBlank(source.prose) || !nonBlank(source.draft_ref) || !Number.isInteger(source.revision)) return null;
  const size = chars(source.prose);
  const unit = usableLeaves(request).find(({ payload }) =>
    list(payload.source_refs).includes(source.chapter_ref) &&
    payload.versions?.[source.draft_ref] === source.revision &&
    payload.coverage?.chapter_ref === source.chapter_ref &&
    same(payload.coverage?.prose_range, { start: 1, end: size }) &&
    payload.coverage?.prose_total_chars === size && payload.next_offset == null &&
    typeof payload.content?.summary === "string" && payload.content.summary.includes(source.prose));
  return materialFact(unit, source.draft_ref);
}
function wholeRange(range, size = null) {
  return range?.offset === 0 && range.offset_unit === "unicode_grapheme" &&
    Number.isInteger(range.total_graphemes) && range.total_graphemes > 0 &&
    range.returned_graphemes === range.total_graphemes &&
    (size === null || range.total_graphemes === size);
}
function styleCoverage(coverage, source) {
  const style = source.style;
  if (coverage?.work_id !== source.work_id) return false;
  if (coverage.kind === "detail" && coverage.memory_ref === style.ref) {
    return wholeRange(coverage.summary, chars(style.body));
  }
  if (!["facet", "detail"].includes(coverage.kind)) return false;
  const sources = list(coverage.sources).filter((entry) => entry.ref === style.ref);
  return sources.length === 1 && sources[0].version === style.version &&
    sources[0].status === "CONFIRMED" && sources[0].version_status === "known" &&
    wholeRange(sources[0]) && sources[0].total_graphemes >= chars(style.body);
}
function styleMaterial(request, source) {
  const style = source.style;
  if (!nonBlank(style?.body) || !nonBlank(style?.ref) || !Number.isInteger(style?.version)) return null;
  const unit = usableLeaves(request).find(({ payload }) =>
    list(payload.source_refs).includes(style.ref) && payload.versions?.[style.ref] === style.version &&
    styleCoverage(payload.coverage, source) && payload.next_offset == null &&
    list(payload.omissions).length === 0 &&
    typeof payload.content?.summary === "string" && payload.content.summary.includes(style.body));
  return materialFact(unit, style.ref);
}
function occurrences(value, body) {
  return typeof value === "string" && nonBlank(body) ? value.split(body).length - 1 : 0;
}
function decodedOccurrences(value, body) {
  if (typeof value === "string") return occurrences(value, body);
  if (Array.isArray(value)) return value.reduce((total, entry) => total + decodedOccurrences(entry, body), 0);
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce((total, entry) => total + decodedOccurrences(entry, body), 0);
  }
  return 0;
}
function pageMaterials(request, source) {
  const units = graphemes(source.prose), hash = sha256Hex(source.prose);
  return usableLeaves(request).flatMap((unit) => {
    const { payload } = unit, range = payload.coverage?.prose_range;
    if (payload.content?.tool !== "chapter_read" ||
      !list(payload.source_refs).includes(source.chapter_ref) ||
      payload.coverage?.chapter_ref !== source.chapter_ref ||
      payload.coverage?.prose_total_chars !== units.length ||
      !Number.isInteger(range?.start) || !Number.isInteger(range.end) ||
      range.start < 1 || range.end < range.start || range.end > units.length ||
      singleDraftVersionReason(payload, source.draft_ref, source.revision) !== null ||
      payload.content.source_hash !== hash) return [];
    const body = units.slice(range.start - 1, range.end).join("");
    const start = Buffer.byteLength(units.slice(0, range.start - 1).join(""), "utf8");
    const end = start + Buffer.byteLength(body, "utf8");
    if (!same(payload.coverage.prose_byte_range, { start, end }) ||
      proseObservationBodyReason(payload, body) !== null ||
      (range.end < units.length ? payload.next_offset !== range.end : payload.next_offset != null)) return [];
    return [{ start, end, body, unit }];
  });
}
function byteCoverage(ranges, total) {
  const counts = new Uint8Array(total);
  for (const { start, end } of ranges) {
    for (let index = start; index < end; index += 1) counts[index] = Math.min(2, counts[index] + 1);
  }
  return { covered: counts.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0),
    duplicated: counts.reduce((sum, value) => sum + (value > 1 ? 1 : 0), 0) };
}
function materialStrings(value, excluded, output = []) {
  if (excluded.has(value)) return output;
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => materialStrings(entry, excluded, output));
  else if (value !== null && typeof value === "object") {
    Object.values(value).forEach((entry) => materialStrings(entry, excluded, output));
  }
  return output;
}
function actualBodyCopies(request, source, pages) {
  const full = { start: 0, end: Buffer.byteLength(source.prose, "utf8"), body: source.prose };
  const patterns = [full, ...pages].sort((left, right) => right.body.length - left.body.length);
  const excluded = new Set(pages.map((page) => page.unit.payload));
  const roots = list(request?.facts?.messageFacts).flatMap((message) => {
    if (message.scopeContent !== null) return [message.scopeContent];
    if (message.toolResults.length > 0) return message.toolResults.map((result) => result.payload);
    return [message.text, ...message.toolCalls.map((call) => call.arguments)];
  });
  const ranges = [...pages];
  for (const text of materialStrings(roots, excluded)) {
    let fragments = [text];
    for (const pattern of patterns) {
      const remaining = [];
      for (const fragment of fragments) {
        const pieces = fragment.split(pattern.body);
        for (let count = 1; count < pieces.length; count += 1) ranges.push(pattern);
        remaining.push(...pieces);
      }
      fragments = remaining;
    }
  }
  return ranges;
}
function baselineFacts(request, source) {
  const content = request?.scope?.scopeContent, scope = content?.authoring_task?.scope;
  if (!nonBlank(source.prose) || !nonBlank(source.draft_ref) || !Number.isInteger(source.revision)) {
    return { supplied: false, once: false, scope, pages: [], total_bytes: 0, covered_bytes: 0, duplicate_bytes: 0 };
  }
  const total = Buffer.byteLength(source.prose, "utf8"), pages = pageMaterials(request, source);
  const direct = occurrences(content?.operation?.context_text, source.prose);
  const eligible = [...pages, ...Array.from({ length: direct }, () => ({ start: 0, end: total }))];
  const suppliedBytes = byteCoverage(eligible, total), actual = byteCoverage(actualBodyCopies(request, source, pages), total);
  const supplied = boundRequest(request) && scope?.object_kind === "chapter_prose" &&
    scope.target_chapter_ref === source.chapter_ref &&
    same(scope.expected_base_versions, [{ ref: source.draft_ref, version: source.revision }]) &&
    suppliedBytes.covered === total;
  return { supplied, once: supplied && actual.covered === total && actual.duplicated === 0, scope, pages,
    total_bytes: total, covered_bytes: suppliedBytes.covered, duplicate_bytes: actual.duplicated };
}
function usageFor(request, refs, source, baseline, style) {
  if (!request || refs?.ok !== true) return false;
  const reports = list(refs.reports).filter((report) =>
    report.provider_call_ref === request.provider_call_ref &&
    report.provider_run_ref === request.provider_run_ref);
  if (reports.length !== 1 || reports[0].status !== "verified") return false;
  const used = list(reports[0].matched_refs).map((match) => match.ref);
  const citedPages = baseline.pages.filter((page) => used.includes(observationRefOf(page.unit.payload)));
  const pagesComplete = baseline.total_bytes > 0 &&
    byteCoverage(citedPages, baseline.total_bytes).covered === baseline.total_bytes;
  const proseUsed = used.includes(source.chapter_ref) || used.includes(source.draft_ref) || pagesComplete;
  return proseUsed && (!style || used.includes(style.ref) ||
    (nonBlank(style.observation_ref) && used.includes(style.observation_ref)));
}
function targetSegments(request) {
  const context = request?.scope?.scopeContent?.operation?.context_text;
  if (typeof context !== "string") return null;
  const parts = context.split("\n\n## 本轮局部修订目标段\n");
  if (parts.length !== 2) return null;
  let targets;
  try { targets = JSON.parse(parts[1]); } catch { return null; }
  if (!Array.isArray(targets) || targets.length === 0 ||
    !targets.every((target) => nonBlank(target.segment_id) && nonBlank(target.text) &&
      /^[0-9a-f]{64}$/u.test(target.sha256)) ||
    new Set(targets.map((target) => target.segment_id)).size !== targets.length) return null;
  return targets;
}
function segmentCandidate(candidate, request, source) {
  const targets = targetSegments(request);
  if (!targets || candidate.payload.modification_scope !== "target_segments" ||
    candidate.payload.scope?.kind !== "target_segments" ||
    candidate.payload.scope.target_chapter_ref !== source.chapter_ref ||
    candidate.payload.scope.preserve_unmentioned_verbatim !== true ||
    candidate.payload.adoption_effect?.mode !== "replace_segments") return false;
  const expected = {
    covered: [`${source.draft_ref}:${source.revision}`],
    base_versions: [{ ref: source.draft_ref, version: source.revision }],
    base_draft_ref: source.draft_ref, base_version: source.revision,
    target_segment_ids: targets.map((target) => target.segment_id),
    expected_segment_hashes: targets.map(({ segment_id, sha256 }) => ({ segment_id, sha256 })),
  };
  return same(candidate.payload.scope.covered_refs, [source.draft_ref]) &&
    Object.entries(expected).every(([key, value]) =>
      same(candidate.payload.scope[key], value) && same(candidate.payload.adoption_effect[key], value));
}
function candidateFacts(candidate, writer, request, source) {
  const base = candidate?.artifact_type === "prose_fragment" &&
    candidate.adoption_status === "TENTATIVE" &&
    candidate.target_chapter_ref === source.chapter_ref &&
    list(candidate.payload?.items).length > 0 && writer?.ok === true &&
    writer.provider_call_ref === request?.provider_call_ref;
  const effect = candidate?.payload?.adoption_effect;
  const whole = base && candidate.payload.modification_scope === "whole_chapter" &&
    candidate.payload.scope?.target_chapter_ref === source.chapter_ref &&
    effect?.mode === "replace_scope" && effect.coverage === "complete" &&
    same(effect.covered, [`${source.draft_ref}:${source.revision}`]) &&
    same(effect.expected_base_versions, [{ ref: source.draft_ref, version: source.revision }]);
  const scope = request?.scope?.scopeContent?.authoring_task?.scope;
  const scopeBound = scope?.object_kind === "chapter_prose" &&
    scope.target_chapter_ref === source.chapter_ref &&
    same(scope.expected_base_versions, [{ ref: source.draft_ref, version: source.revision }]);
  const revision = base && scopeBound && (
    (scope.modification_scope === "whole_chapter" && whole) ||
    (scope.modification_scope === "target_segments" && segmentCandidate(candidate, request, source)));
  return { base, whole, revision };
}
function countChecks(initial, source, pendingCount) {
  const content = initial?.scope?.scopeContent;
  const stats = content?.facts?.work?.chapter_statistics;
  return {
    initial_statistics: boundRequest(initial) && nonBlank(source.work_id) &&
      content?.work_id === source.work_id && content?.facts?.work?.work_id === source.work_id &&
      content?.coverage?.chapter_statistics?.status === "complete" &&
      stats?.structure_chapter_count === 2 && stats.written_chapter_count === 1 &&
      stats.empty_chapter_count === 1,
    initial_no_full_prose: boundRequest(initial) && nonBlank(source.prose) &&
      !list(initial.facts.scopeMessages).some((message) =>
        nonBlank(message.scopeContent?.operation?.context_text)) &&
      decodedOccurrences(initial.facts.messageFacts, source.prose) === 0 &&
      decodedOccurrences(initial.facts.observations, source.prose) === 0,
    no_candidate: pendingCount === 0,
  };
}

export function r05GoalEvidence({
  goal, source = {}, requests = [], consumer_call_ref, reply, candidate = null,
  pending_count, writer = null, refs = null, zero_write = null, run_id, reply_source = null,
} = {}) {
  const all = list(requests);
  const consumer = selectedRequest(all, consumer_call_ref);
  const prose = fullProse(consumer, source);
  const baseline = baselineFacts(consumer, source);
  const style = goal === "style" ? styleMaterial(consumer, source) : null;
  const pending = candidateFacts(candidate, writer, consumer, source);
  const checks = {
    known_goal: GOALS.has(goal), consumer_request_bound: consumer !== null,
    canon_unchanged: zero_write?.ok === true, actual_reply: nonBlank(reply),
  };
  if (goal === "count" || goal === "quality") {
    checks.reply_source_bound = replySourceBound(reply_source, consumer, run_id, reply);
  }
  if (goal === "count") Object.assign(checks, countChecks(all[0], source, pending_count));
  if (goal === "quality") Object.assign(checks, {
    full_prose_supplied: prose !== null, no_candidate: pending_count === 0,
  });
  if (goal === "whole") Object.assign(checks, {
    full_prose_supplied: baseline.supplied, baseline_once: baseline.once,
    whole_scope: baseline.scope?.modification_scope === "whole_chapter" && pending.whole,
    used_refs_bound: usageFor(consumer, refs, source, baseline, null),
  });
  if (goal === "style") Object.assign(checks, {
    full_prose_supplied: baseline.supplied || prose !== null,
    style_body_supplied: style !== null, tentative_candidate: pending.revision,
    used_refs_bound: style !== null && usageFor(consumer, refs, source, baseline, style),
  });
  const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
  return { ok: failed.length === 0, goal, signed_scope: "request_materials_and_scope", checks, failed,
    provider_call_ref: consumer?.provider_call_ref ?? null,
    provider_run_ref: consumer?.provider_run_ref ?? null,
    materials: { prose, style, baseline: { supplied: baseline.supplied, once: baseline.once } },
    semantic_review: { status: "pending_independent_review", reply,
      ...(goal === "count" ? { expected: { structure: 2, written: 1, empty: 1 } } : {}) },
    not_signed: ["literary_quality", "model_semantic_correctness"] };
}

function validRect(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    value[2] > 0 && value[3] > 0;
}
function clippedViewport(nodes, node) {
  const ancestors = list(nodes).filter((entry) =>
    ["AXWindow", "AXScrollArea", "AXWebArea"].includes(entry.role) &&
    (node.path === entry.path || node.path?.startsWith(entry.path + "/")));
  if (!ancestors.some((entry) => entry.role === "AXWindow") ||
    !ancestors.every((entry) => validRect(entry.frame))) return null;
  return ancestors.reduce((clip, entry) => {
    const [x, y, width, height] = entry.frame;
    const box = [x, y, x + width, y + height];
    return clip ? [Math.max(clip[0], box[0]), Math.max(clip[1], box[1]),
      Math.min(clip[2], box[2]), Math.min(clip[3], box[3])] : box;
  }, null);
}
function withinViewport(nodes, node, { bodyStart = false } = {}) {
  if (!validRect(node?.frame)) return false;
  const clip = clippedViewport(nodes, node);
  if (!clip || clip[0] >= clip[2] || clip[1] >= clip[3]) return false;
  const [x, y, width, height] = node.frame;
  return x >= clip[0] && x + width <= clip[2] && y >= clip[1] &&
    (bodyStart ? y < clip[3] : y + height <= clip[3]);
}
function currentAuthorItem(nodes, itemPath, message, baselineAuthorCount) {
  const boundary = authorBoundary(nodes, message, baselineAuthorCount);
  if (!boundary.author || !itemPath?.startsWith(boundary.container + "/")) return false;
  const depth = boundary.container.split("/").length + 1;
  const peerPath = itemPath.split("/").slice(0, depth).join("/");
  const peer = nodes.find((node) => node.path === peerPath);
  return peer !== undefined && withinAuthorBoundary(peer, {
    container: boundary.container, afterPath: boundary.authorGroup,
    beforePath: boundary.nextAuthor?.path ?? null,
  });
}
function candidateViews(items, views, knownItems, context) {
  const captures = list(views).filter((view) => {
    if (view.screenshot_present !== true || view.window_capture !== true || !Array.isArray(view.nodes)) return false;
    const works = view.nodes.filter((node) => node.role === "AXPopUpButton" && node.desc === "作品");
    return works.length === 1 && works[0].title === context.target?.work_title;
  });
  return list(items).map((item) => {
    const target = { itemTitle: item.title, itemBody: item.body, knownItems };
    if (!list(knownItems).some((known) =>
      known.itemTitle === item.title && known.itemBody === item.body)) return { entry: null, action: null };
    const entry = captures.find((view) => {
      if (!/^r05-candidate-\d+-entry$/u.test(view.capture)) return false;
      const located = locatePendingItem(view.nodes, target);
      if (!located.ok || !currentAuthorItem(view.nodes, located.scope.path, context.message, context.baselineAuthorCount ?? 0)) return false;
      const inItem = (node) => node.path?.startsWith(located.scope.path + "/");
      return view.nodes.some((node) => inItem(node) && node.role === "AXStaticText" &&
        node.value === item.title && withinViewport(view.nodes, node)) &&
        view.nodes.some((node) => inItem(node) && node.role === "AXStaticText" &&
          node.value === item.body && withinViewport(view.nodes, node, { bodyStart: true }));
    });
    const action = captures.find((view) => {
      if (!/^r05-candidate-\d+-action$/u.test(view.capture)) return false;
      const located = locateScopedButton(view.nodes, { ...target, label: "保存修订稿" });
      return located.ok && currentAuthorItem(view.nodes, located.item_path, context.message, context.baselineAuthorCount ?? 0) &&
        withinViewport(view.nodes, located.button);
    });
    return { title: item.title, entry: entry?.capture ?? null, action: action?.capture ?? null };
  });
}

// 只复用旧 G2/G3 共享页面表面；R05 count 不要求读活动，whole 不要求局部修订卡。
export function r05VisibleEvidence({ goal, reply, items = [], candidate_views = [], known_items = [], ...input } = {}) {
  const surface = visiblePageSurface(input);
  const failures = [...surface.failures];
  const candidate = goal === "whole" || goal === "style";
  const outcome = axTurnOutcome(input.finalNodes, {
    message: input.message, baselineAuthorCount: input.baselineAuthorCount ?? 0,
  });
  const views = candidateViews(items, candidate_views, known_items, input);
  const entryVisible = candidate && views.length > 0 && views.every((view) => view.entry !== null);
  const actionVisible = candidate && views.length > 0 && views.every((view) => view.action !== null);
  const observed = { ...surface.observed, outcome: outcome.kind,
    reply_visible: nonBlank(reply) && surface.currentTurn.includes(reply),
    candidate_entry_visible: entryVisible, candidate_action_visible: actionVisible,
    candidate_visible: entryVisible && actionVisible, candidate_views: views,
    author_visible_clean: surface.scan.ok };
  if (!GOALS.has(goal)) failures.push("unknown_r05_goal");
  if (!observed.reply_visible) failures.push("author_reply_missing");
  if (outcome.kind !== "completed") failures.push("author_visible_outcome_not_completed");
  if (candidate && !observed.candidate_visible) failures.push("candidate_visible_missing");
  if (!surface.scan.ok) failures.push("author_visible_internal_token_leak");
  return { ok: failures.length === 0, reason: failures[0] ?? null, failures, observed,
    leak: { ok: surface.scan.ok, hits: surface.scan.hits.map(({ token, kind }) => ({ token, kind })) } };
}
