// B87 R05 四个新增作者目标的纯审计；无文件/DB/启动/成本读取。
// 输入是既有 reader 对同一 provider call 的事实，scope 已经 canonical 绑定。
// 页面表面、request 观察/正文解析与 used-ref 授信仍归原 owner；本模块核同次真实材料的范围供应与完整回复。
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { authorBoundary, axTurnOutcome, conversationRegion, visiblePageSurface, withinAuthorBoundary } from "./authoring_g2_evidence.mjs";
import { observationRefOf, proseObservationBodyReason, singleDraftVersionReason } from "./authoring_request_facts.mjs";
import { sha256Hex } from "./request_cost_evidence.mjs";
import { actionLabelsFor, locatePendingItem, locateScopedButton, selectPendingAction } from "./authoring_pending_evidence.mjs";

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
export function judgmentNarrativeSourceBound(witness, request, runId, reply, action = "reply") {
  const event = witness?.event, output = witness?.output;
  const payload = event?.payload, source = payload?.author_narrative_source;
  const range = source?.source_byte_range;
  if (!request || !nonBlank(runId) || !nonBlank(reply) ||
    event?.run_id !== runId || event.event_type !== "judgment_decided" ||
    !["reply", "execute"].includes(action) || payload?.action !== action || payload.author_narrative !== reply ||
    !["provider_output", "provider_output_tool_narrative"].includes(source?.source_type) || output?.run_id !== runId ||
    output.role !== "assistant" || output.provenance !== "model" ||
    source.provider_call_ref !== request.provider_call_ref ||
    source.provider_run_ref !== request.provider_run_ref ||
    source.provider_output_ref !== request.provider_run_ref ||
    output.provider_call_ref !== request.provider_call_ref ||
    output.provider_run_ref !== request.provider_run_ref ||
    !Array.isArray(output.blocks) || (action === "reply" &&
      (source.source_type !== "provider_output" || output.blocks.some((block) => block.type === "tool_call"))) ||
    !Number.isInteger(range?.start) || range.start < 0 ||
    !Number.isInteger(range.length) || range.length <= 0) return false;
  let raw;
  if (source.source_type === "provider_output") {
    const text = output.blocks.filter((block) => block.type === "text").map((block) => block.text);
    if (text.length === 0 || !text.every((value) => typeof value === "string")) return false;
    raw = text.join("");
  } else {
    if (!nonBlank(source.tool_call_name) || !nonBlank(source.tool_call_narrative_field)) return false;
    const tools = output.blocks.filter((block) => block.type === "tool_call" && block.name === source.tool_call_name);
    if (tools.length !== 1) return false;
    raw = tools[0].arguments?.[source.tool_call_narrative_field];
    if (typeof raw !== "string" || range.start !== 0 || range.length !== Buffer.byteLength(raw)) return false;
  }
  const bytes = Buffer.from(raw, "utf8");
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
    checks.reply_source_bound = judgmentNarrativeSourceBound(reply_source, consumer, run_id, reply);
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


// 完整回复按 ADR-0036 的静态 Markdown 政策投影；AST 只解析语法，不改来源原文。
const frontendModules = createRequire(new URL("../../../frontend/package.json", import.meta.url));
const resolveReplyPackage = frontendModules("enhanced-resolve").create.sync({
  conditionNames: ["import", "node", "default"], exportsFields: ["exports"],
});
const frontendDirectory = fileURLToPath(new URL("../../../frontend/", import.meta.url));
const [{ unified }, { default: remarkParse }, { default: remarkGfm }, { cjk }] =
  await Promise.all(["unified", "remark-parse", "remark-gfm", "@streamdown/cjk"]
    .map((name) => import(pathToFileURL(resolveReplyPackage(frontendDirectory, name)).href)));
const replyMarkdown = unified().use(remarkParse).use(cjk.remarkPluginsBefore)
  .use(remarkGfm).use(cjk.remarkPluginsAfter);
const REPLY_NON_CONTENT = new Set(["本轮创作过程", "创作问题记录"]);
const replyParent = (path) => path.slice(0, path.lastIndexOf("/"));
const replyDescendant = (path, parent) => path.startsWith(parent + "/");
function replyPathOrder(left, right) {
  const a = left.path.split("/").map(Number), b = right.path.split("/").map(Number);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}
function replySurfaceFailure(reason) {
  return { ok: false, reason, leaves: [], first: null, last: null,
    assistant_path: null, why_path: null };
}
// 当前帧标签是助手角色后紧邻的独立文本叶；正文仍由 Markdown 语义容器承载。
// 只识别该可见结构，不按正文词语删文本，也不复制产品的帧类型/文案表。
function replyFrameBadge(entries, node) {
  return node?.role === "AXStaticText" && nonBlank(node.value) &&
    !nonBlank(node.title) && !nonBlank(node.desc) &&
    !entries.some((child) => replyDescendant(child.path, node.path));
}
export function r05ReplySurface(nodes, { message = "", baselineAuthorCount = 0 } = {}) {
  const entries = list(nodes);
  if (!nonBlank(message) || !Number.isInteger(baselineAuthorCount) || baselineAuthorCount < 0 ||
    entries.some((node) => !node || typeof node.path !== "string" ||
      !/^\d+(?:\/\d+)*$/u.test(node.path)) ||
    new Set(entries.map((node) => node.path)).size !== entries.length) {
    return replySurfaceFailure("reply_nodes_invalid");
  }
  const boundary = authorBoundary(entries, message, baselineAuthorCount);
  if (!boundary.author || boundary.nextAuthor !== null ||
    boundary.authors.length !== baselineAuthorCount + 1) return replySurfaceFailure("reply_author_missing");
  const region = conversationRegion(entries, boundary.author);
  if (region?.path !== boundary.container) return replySurfaceFailure("reply_region_missing");
  const peers = entries.filter((node) => withinAuthorBoundary(node, {
    container: boundary.container, afterPath: boundary.authorGroup, beforePath: null,
  })).sort(replyPathOrder);
  const names = entries.filter((node) => node.role === "AXPopUpButton" && node.desc === "助手名称");
  if (names.length !== 1 || !nonBlank(names[0].title)) return replySurfaceFailure("reply_assistant_ambiguous");
  const assistants = peers.filter((node) => node.role === "AXGroup" &&
    !REPLY_NON_CONTENT.has(node.title) && entries.some((leaf) => replyParent(leaf.path) === node.path &&
      leaf.role === "AXStaticText" && leaf.value === names[0].title));
  if (assistants.length !== 1) return replySurfaceFailure("reply_assistant_ambiguous");
  const assistant = assistants[0];
  const whys = peers.filter((node) => node.role === "AXButton" &&
    node.title === "为什么" && node.desc === "查看这轮回应的依据");
  if (whys.length !== 1 || replyPathOrder(whys[0], assistant) <= 0) {
    return replySurfaceFailure("reply_why_ambiguous");
  }
  const why = whys[0];
  const between = peers.filter((node) => replyPathOrder(node, assistant) > 0 && replyPathOrder(node, why) < 0);
  const badge = replyFrameBadge(entries, between[0]) ? between[0] : null;
  const blocks = between.filter((node) => node !== badge &&
    !(node.role === "AXGroup" && REPLY_NON_CONTENT.has(node.title)));
  const inReply = entries.filter((node) => blocks.some((block) =>
    node.path === block.path || replyDescendant(node.path, block.path)));
  const texts = inReply.filter((node) => node.role === "AXStaticText");
  if (texts.some((node) => typeof node.value !== "string")) return replySurfaceFailure("reply_text_missing");
  // 只按父子关系去掉汇总节点；不同路径的同文段落逐份保留。
  const leaves = texts.filter((node) => node.value !== "" &&
    !texts.some((child) => replyDescendant(child.path, node.path))).sort(replyPathOrder);
  const content = leaves.filter((node) => nonBlank(node.value));
  if (content.length === 0) return replySurfaceFailure("reply_text_missing");
  return { ok: true, reason: null, leaves, first: content[0], last: content.at(-1),
    assistant_path: assistant.path, why_path: why.path,
    author_path: boundary.author.path, author_count: boundary.authors.length,
    container: boundary.container };
}
function replyDefinitions(tree) {
  const definitions = new Map(), pending = [tree];
  while (pending.length > 0) {
    const node = pending.shift();
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    pending.unshift(...list(node.children));
  }
  return definitions;
}
function safeReplyUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol) ? value : ""; }
  catch { return ""; }
}
function replyInline(node, definitions) {
  const children = () => list(node.children).flatMap((child) => replyInline(child, definitions));
  const flow = (text) => [{ literal: false, text }];
  switch (node.type) {
    case "text": case "html": return flow(node.value);
    case "inlineCode": return [{ literal: true, text: node.value }];
    case "break": return [{ hardBreak: true }];
    case "strong": case "emphasis": case "delete": return children();
    case "image": return flow(node.alt ?? "");
    case "imageReference":
      if (!definitions.has(node.identifier)) throw new Error("image_reference_unresolved");
      return flow(node.alt ?? "");
    case "link": case "linkReference": {
      const target = node.type === "link" ? node : definitions.get(node.identifier);
      if (!target) throw new Error("link_reference_unresolved");
      const url = safeReplyUrl(target.url);
      return [...children(), ...flow(url ? " (" + url + ")" : "")];
    }
    default: throw new Error("unsupported_inline:" + node.type);
  }
}
const replyFlowText = (value) => value.replace(/[ \t\r\n\f]+/gu, " ");
function replyParts(parts) {
  const merged = [];
  for (const part of parts) {
    const previous = merged.at(-1);
    if (!part.hardBreak && previous?.literal === part.literal) previous.text += part.text;
    else merged.push({ ...part });
  }
  for (const part of merged) if (part.literal === false) part.text = replyFlowText(part.text);
  if (merged[0]?.literal === false) merged[0].text = merged[0].text.replace(/^ +/u, "");
  if (merged.at(-1)?.literal === false) merged.at(-1).text = merged.at(-1).text.replace(/ +$/u, "");
  return merged.filter((part) => part.hardBreak || part.text !== "");
}
function replyExpectedUnits(reply) {
  const tree = replyMarkdown.runSync(replyMarkdown.parse(reply));
  const definitions = replyDefinitions(tree), units = [];
  const visit = (node) => {
    switch (node.type) {
      case "root": case "blockquote": case "list": case "table": case "tableRow":
        node.children.forEach(visit); return;
      case "listItem":
        if (typeof node.checked === "boolean") throw new Error("unsupported_task_list");
        node.children.forEach(visit); return;
      case "paragraph": case "heading": case "tableCell": {
        const parts = replyParts(node.children.flatMap((child) => replyInline(child, definitions)));
        if (parts.length > 0) units.push(parts);
        return;
      }
      case "code": units.push([{ literal: true, text: node.value + "\n" }]); return;
      case "html": {
        const parts = replyParts([{ literal: false, text: node.value }]);
        if (parts.length > 0) units.push(parts);
        return;
      }
      case "definition": case "thematicBreak": return;
      default: throw new Error("unsupported_block:" + node.type);
    }
  };
  visit(tree);
  return units;
}
function replyActualUnits(nodes, surface) {
  const groups = list(nodes).filter((node) => ["AXGroup", "AXHeading", "AXCell"].includes(node.role));
  const units = [];
  for (const leaf of surface.leaves) {
    const parent = groups.filter((node) => replyDescendant(leaf.path, node.path) &&
      replyDescendant(node.path, surface.container)).sort((a, b) => b.path.split("/").length - a.path.split("/").length)[0];
    const path = parent?.path ?? leaf.path;
    const unit = units.at(-1);
    if (unit?.path === path) {
      unit.boundaries.push({ offset: unit.text.length, before: unit.lastLeaf, after: leaf });
      unit.text += leaf.value;
      unit.lastLeaf = leaf;
      unit.leaves.push(leaf);
    } else units.push({ path, text: leaf.value, lastLeaf: leaf, leaves: [leaf], boundaries: [] });
  }
  return units;
}
const replyWhitespace = (character) => character !== undefined && /[ \t\r\n\f]/u.test(character);
function replyUnitMatches(parts, unit) {
  const actual = unit.text;
  // 仅移动普通 flow 的首尾界限；文本与叶边界始终使用原 offset。
  let start = 0, end = actual.length;
  if (parts[0].literal === false) while (start < end && replyWhitespace(actual[start])) start += 1;
  if (parts.at(-1).literal === false) while (end > start && replyWhitespace(actual[end - 1])) end -= 1;
  const hardBreaks = new Set(unit.boundaries.filter(({ offset, before, after }) => {
    if (!validRect(before.frame) || !validRect(after.frame) ||
        after.frame[1] < before.frame[1] + before.frame[3]) return false;
    let left = offset, right = offset;
    while (replyWhitespace(actual[left - 1])) left -= 1;
    while (replyWhitespace(actual[right])) right += 1;
    // 已有文字换行是同一份换行证据，不能再把相邻几何边界计一次。
    return !/[\r\n]/u.test(actual.slice(left, right));
  }).map((boundary) => boundary.offset));
  let positions = [{ at: start, breakUsed: false }];
  for (const part of parts) {
    if (part.hardBreak) {
      const next = [];
      for (const position of positions) {
        const at = position.at;
        const width = actual.startsWith("\r\n", at) ? 2 : actual[at] === "\n" ? 1 : 0;
        if (width > 0 && at + width <= end) next.push({ at: at + width, breakUsed: false });
        else if (!position.breakUsed && hardBreaks.has(at)) next.push({ at, breakUsed: true });
      }
      positions = next;
      if (positions.length === 0) return false;
      continue;
    }
    if (part.literal) {
      positions = positions.filter(({ at }) => at + part.text.length <= end && actual.startsWith(part.text, at))
        .map((position) => part.text.length === 0 ? position : { at: position.at + part.text.length, breakUsed: false });
      continue;
    }
    for (const character of part.text) {
      const next = new Map();
      for (const { at } of positions) {
        if (character === " ") {
          // 普通 CSS 空白仍须消费至少一个实际字符，不使用 hard break 的叶边界。
          for (let cursor = at; cursor < end && replyWhitespace(actual[cursor]); cursor += 1) {
            next.set(cursor + 1, { at: cursor + 1, breakUsed: false });
          }
        } else if (at + character.length <= end && actual.startsWith(character, at)) {
          next.set(at + character.length, { at: at + character.length, breakUsed: false });
        }
      }
      positions = [...next.values()];
      if (positions.length === 0) return false;
    }
  }
  return positions.some(({ at }) => at === end);
}
// 映射当前作者回合的完整过程叙述。复用上方 Markdown 单元解析/匹配，
// 每个实际段落必须由一个完整的已发布叙述解释；已在主回复交付的其它叙述可缺席。
// 目标叙述必须连续、完整且位置唯一，不允许局部子串、漏段或无来源的额外段落。
export function renderedNarrativeNodes(nodes, {
  narratives = [], targetIndex = -1, message = "", baselineAuthorCount = 0,
} = {}) {
  const failure = reason => ({ ok: false, reason, matches: [] });
  const entries = list(nodes);
  if (!Array.isArray(narratives) || !Number.isInteger(targetIndex) ||
      targetIndex < 0 || targetIndex >= narratives.length || !narratives.every(nonBlank) ||
      entries.some(node => typeof node?.path !== "string" || !/^\d+(?:\/\d+)*$/u.test(node.path)) ||
      new Set(entries.map(node => node.path)).size !== entries.length) return failure("narrative_input_invalid");
  const boundary = authorBoundary(entries, message, baselineAuthorCount);
  if (!boundary.author || boundary.nextAuthor !== null ||
      boundary.authors.length !== baselineAuthorCount + 1) return failure("narrative_author_missing");
  const groups = entries.filter(node => node.role === "AXGroup" &&
    [node.title, node.desc].includes("本轮创作过程") && withinAuthorBoundary(node, {
      container: boundary.container, afterPath: boundary.authorGroup, beforePath: null,
    }));
  if (groups.length !== 1) return failure("narrative_process_ambiguous");
  const container = groups[0].path;
  const children = entries.filter(node => replyParent(node.path) === container).sort(replyPathOrder);
  const isBlock = node => ["AXGroup", "AXHeading", "AXList", "AXTable"].includes(node.role) &&
    !(node.role === "AXGroup" && (nonBlank(node.title) || nonBlank(node.desc)));
  const blocks = [];
  for (const node of children) {
    if (!isBlock(node)) break;
    blocks.push(node);
  }
  // 真实 AX 展平事件 wrapper；叙述块在前，状态叶/命名的公开区域在后。
  // 不能遇到状态叶后再跳过一段未解释的普通 Markdown 块。
  if (blocks.length === 0 || children.slice(blocks.length).some(isBlock)) return failure("narrative_blocks_invalid");
  const texts = entries.filter(node => node.role === "AXStaticText" &&
    blocks.some(block => replyDescendant(node.path, block.path)));
  if (texts.some(node => typeof node.value !== "string")) return failure("narrative_text_missing");
  const leaves = texts.filter(node => node.value !== "" &&
    !texts.some(child => replyDescendant(child.path, node.path))).sort(replyPathOrder);
  const surface = { container, leaves }, actual = replyActualUnits(entries, surface);
  let expected;
  try { expected = narratives.map(replyExpectedUnits); }
  catch (error) { return { ...failure("narrative_markdown_unsupported"), detail: error.message }; }
  if (expected[targetIndex].length === 0) return failure("narrative_text_missing");
  let states = [{ at: 0, start: null, end: null }];
  for (const [index, units] of expected.entries()) {
    const next = new Map();
    const retain = state => next.set([state.at, state.start, state.end].join(":"), state);
    for (const state of states) {
      if (index !== targetIndex) retain(state);
      if (units.length > 0 && state.at + units.length <= actual.length &&
          units.every((parts, offset) => replyUnitMatches(parts, actual[state.at + offset]))) {
        retain({ at: state.at + units.length,
          start: index === targetIndex ? state.at : state.start,
          end: index === targetIndex ? state.at + units.length : state.end });
      }
    }
    states = [...next.values()];
  }
  const complete = states.filter(state => state.at === actual.length && state.start !== null);
  const locations = new Map(complete.map(state => [state.start + ":" + state.end, state]));
  if (locations.size !== 1) return failure("narrative_text_mismatch");
  const { start, end } = [...locations.values()][0];
  const matches = actual.slice(start, end).map(unit => ({
    ok: true, container, leaves: unit.leaves, first: unit.leaves[0], last: unit.leaves.at(-1),
  }));
  return { ok: true, reason: null, matches, expected_units: expected[targetIndex].length,
    actual_units: actual.length, process_path: container, author_path: boundary.author.path,
    author_count: boundary.authors.length };
}

export function r05ReplyMatch({ reply, nodes, message, baselineAuthorCount = 0 } = {}) {
  const surface = r05ReplySurface(nodes, { message, baselineAuthorCount });
  if (!surface.ok) return { ok: false, reason: surface.reason, surface };
  if (!nonBlank(reply)) return { ok: false, reason: "reply_text_missing", surface };
  let expected;
  try { expected = replyExpectedUnits(reply); }
  catch (error) { return { ok: false, reason: "reply_markdown_unsupported", detail: error.message, surface }; }
  const actual = replyActualUnits(nodes, surface);
  const ok = expected.length > 0 && expected.length === actual.length &&
    expected.every((parts, index) => replyUnitMatches(parts, actual[index]));
  return { ok, reason: ok ? null : "reply_text_mismatch", surface,
    expected_units: expected.length, actual_units: actual.length };
}
export function r05ReplyEdgeVisible(nodes, surface, edge) {
  if (!surface?.ok || !["start", "end"].includes(edge)) return false;
  const node = edge === "start" ? surface.first : surface.last;
  if (!list(nodes).includes(node) || !validRect(node?.frame)) return false;
  const clip = clippedViewport(nodes, node);
  if (!clip || clip[0] >= clip[2] || clip[1] >= clip[3]) return false;
  const [x, y, width, height] = node.frame;
  if (x < clip[0] || x + width > clip[2]) return false;
  return edge === "start" ? y >= clip[1] && y < clip[3] : y + height > clip[1] && y + height <= clip[3];
}
function replyViewFacts(reply, views, input, finalMatch) {
  const result = { start: null, end: null };
  for (const edge of ["start", "end"]) {
    const candidates = list(views).filter((view) => view.edge === edge);
    if (candidates.length !== 1) continue;
    const view = candidates[0];
    if (!nonBlank(view.capture) || view.screenshot_present !== true || view.window_capture !== true) continue;
    const works = list(view.nodes).filter((node) => node.role === "AXPopUpButton" && node.desc === "作品");
    if (works.length !== 1 || works[0].title !== input.target?.work_title) continue;
    const options = { message: input.message, baselineAuthorCount: input.baselineAuthorCount ?? 0 };
    const match = r05ReplyMatch({ reply, nodes: view.nodes, ...options });
    if (match.ok && finalMatch.ok && match.surface.author_count === finalMatch.surface.author_count &&
      axTurnOutcome(view.nodes, options).kind === "completed" &&
      r05ReplyEdgeVisible(view.nodes, match.surface, edge)) result[edge] = view.capture;
  }
  return result;
}

function validRect(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    value[2] > 0 && value[3] > 0;
}
export function clippedViewport(nodes, node) {
  const region = conversationRegion(nodes, node);
  if (!region) return null;
  const ancestors = list(nodes).filter((entry) =>
    (entry === region || ["AXWindow", "AXScrollArea", "AXWebArea"].includes(entry.role)) &&
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
export function withinViewport(nodes, node, { bodyStart = false } = {}) {
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
function candidateViews(artifact, turnResult, views, context) {
  const items = list(artifact?.payload?.items);
  if (items.length === 0) return [];
  selectPendingAction(turnResult, { artifactId: artifact.artifact_id, actionType: "accept" });
  const label = actionLabelsFor(artifact, turnResult).accept;
  const captures = list(views).filter((view) => {
    if (view.screenshot_present !== true || view.window_capture !== true || !Array.isArray(view.nodes)) return false;
    const works = view.nodes.filter((node) => node.role === "AXPopUpButton" && node.desc === "作品");
    return works.length === 1 && works[0].title === context.target?.work_title;
  });
  return list(items).map((item) => {
    const target = { itemTitle: item.title, itemBody: item.body, artifact,
      knownArtifacts: list(turnResult?.adoption_state?.pending) };
    const boundaryFor = (nodes) => authorBoundary(nodes, context.message, context.baselineAuthorCount ?? 0);
    const entry = captures.find((view) => {
      if (!/^r05-candidate-\d+-entry$/u.test(view.capture)) return false;
      const located = locatePendingItem(view.nodes, { ...target, authorBoundary: boundaryFor(view.nodes) });
      if (!located.ok || !currentAuthorItem(view.nodes, located.scope.path, context.message, context.baselineAuthorCount ?? 0)) return false;
      const inItem = (node) => node.path?.startsWith(located.scope.path + "/");
      return view.nodes.some((node) => inItem(node) && node.role === "AXStaticText" &&
        node.value === item.title && withinViewport(view.nodes, node)) &&
        view.nodes.some((node) => inItem(node) && node.role === "AXStaticText" &&
          node.value === item.body && withinViewport(view.nodes, node, { bodyStart: true }));
    });
    const action = captures.find((view) => {
      if (!/^r05-candidate-\d+-action$/u.test(view.capture)) return false;
      const located = locateScopedButton(view.nodes, { ...target, label, authorBoundary: boundaryFor(view.nodes) });
      return located.ok && currentAuthorItem(view.nodes, located.item_path, context.message, context.baselineAuthorCount ?? 0) &&
        withinViewport(view.nodes, located.button);
    });
    return { title: item.title, entry: entry?.capture ?? null, action: action?.capture ?? null };
  });
}

// 只复用旧 G2/G3 共享页面表面；R05 的完整回复与首末可见视口分别取证。
export function r05VisibleEvidence({
  goal, reply, candidate = null, turn_result = null, candidate_views = [], reply_views = [], ...input
} = {}) {
  const surface = visiblePageSurface(input);
  const failures = [...surface.failures];
  const needsCandidate = goal === "whole" || goal === "style";
  const options = { message: input.message, baselineAuthorCount: input.baselineAuthorCount ?? 0 };
  const outcome = axTurnOutcome(input.finalNodes, options);
  const matched = r05ReplyMatch({ reply, nodes: input.finalNodes, ...options });
  const replyViews = replyViewFacts(reply, reply_views, input, matched);
  const views = candidateViews(candidate, turn_result, candidate_views, input);
  const entryVisible = needsCandidate && views.length > 0 && views.every((view) => view.entry !== null);
  const actionVisible = needsCandidate && views.length > 0 && views.every((view) => view.action !== null);
  const observed = { ...surface.observed, outcome: outcome.kind,
    reply_visible: matched.ok, reply_reason: matched.reason,
    reply_start_visible: replyViews.start !== null, reply_end_visible: replyViews.end !== null,
    reply_views: replyViews,
    candidate_entry_visible: entryVisible, candidate_action_visible: actionVisible,
    candidate_visible: entryVisible && actionVisible, candidate_views: views,
    author_visible_clean: surface.scan.ok };
  if (!GOALS.has(goal)) failures.push("unknown_r05_goal");
  if (!observed.reply_visible) failures.push("author_reply_missing");
  if (!observed.reply_start_visible) failures.push("author_reply_start_not_visible");
  if (!observed.reply_end_visible) failures.push("author_reply_end_not_visible");
  if (outcome.kind !== "completed") failures.push("author_visible_outcome_not_completed");
  if (needsCandidate && !observed.candidate_visible) failures.push("candidate_visible_missing");
  if (!surface.scan.ok) failures.push("author_visible_internal_token_leak");
  return { ok: failures.length === 0, reason: failures[0] ?? null, failures, observed,
    leak: { ok: surface.scan.ok, hits: surface.scan.hits.map(({ token, kind }) => ({ token, kind })) } };
}
