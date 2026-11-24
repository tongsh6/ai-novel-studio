// B71 源阶段章使命的纯证据：把“DB 里出现了一条 model/TENTATIVE mission”绑定到
// 同一次 source run 的真实 pcall/prun、canonical chapter_mission 调用、同次响应、
// 该调用前 operation 的 source_refs 与实际供给的 basis_label、以及真实
// mission_derived 事件。本模块不做 I/O，也不按时间/最新值猜调用。
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { parseUtcTimestamp } from "./authoring_canon_evidence.mjs";
import { assistantCalls } from "./authoring_revision_evidence.mjs";
import { canonicalRequestBindingsForProviderCall, providerResponseForCanonicalCall } from "./authoring_call_evidence.mjs";
import { observationFacts, usableObservationFact } from "./authoring_request_facts.mjs";

const toolName = (input) => input.missionKind === "planning" ? "planning_mission" : "chapter_mission";
const TENTATIVE = "TENTATIVE";
const MISSION_ITEM_KEYS = Object.freeze(["text", "basis_ref"]);
const AGENT_STEP_TURN = /:agent:[1-9][0-9]*$/u;

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";


function missionRef(mission) {
  // 只被已确认有 mission 的事件绑定路径调用。
  return nonBlank(mission.mission_id) ? `mission:${mission.mission_id}` : null;
}

function isAuthorMission(mission) {
  // v2 mission 边界已保证 author 源只与作者状态配对。
  return isRecord(mission) && mission.source === "author";
}

function isTentativeModel(mission) {
  return mission?.status === TENTATIVE;
}

function missionOf(chapter) {
  if (!isRecord(chapter)) return null;
  return chapter.mission === undefined ? null : chapter.mission;
}

function missionChanged(startChapter, beforeChapter) {
  return !isDeepStrictEqual(missionOf(startChapter), missionOf(beforeChapter));
}

function targetIdFromRef(targetChapterRef) {
  if (typeof targetChapterRef !== "string") return null;
  const match = /^chapter:(.+)$/u.exec(targetChapterRef);
  return match ? match[1] : null;
}

function targetIdentityMatches(input) {
  const targetId = targetIdFromRef(input.targetChapterRef);
  return Boolean(targetId && targetId === input.targetChapterId);
}

function targetChapterMatches(input) {
  return Boolean(
    isRecord(input.startChapter) &&
    isRecord(input.beforeChapter) &&
    input.beforeChapter.work_id === input.sourceWorkId &&
    input.startChapter.work_id === input.sourceWorkId &&
    input.artifactTargetChapter === input.beforeChapter.title,
  );
}

function sourceRunMatches(input) {
  const run = input.sourceRunRecord;
  return Boolean(
    isRecord(run) &&
    run.id === input.sourceRunId &&
    run.work_id === input.sourceWorkId &&
    nonBlank(run.session_id) &&
    nonBlank(run.parent_turn_ref),
  );
}

function targetCheck(input) {
  if (input.missionKind === "planning") {
    return Boolean(input.targetWorkId === input.sourceWorkId &&
      isRecord(input.startWork) && isRecord(input.beforeWork) &&
      input.artifactTargetWork === input.beforeWork.title && sourceRunMatches(input));
  }
  return [targetIdentityMatches(input), targetChapterMatches(input), sourceRunMatches(input)].every(Boolean);
}

function scopeMessageFor(transcript, call, input) {
  // 同一 NativeToolExchange 的纠正沿用原 Scope，失败 validation 不重造 Scope。
  const previous = list(transcript.messages).slice(0, call.messageIndex)
    .findLast(message => message?.role === "scope_update");
  if (previous?.provenance !== "application") return null;
  return previous.versions?.change_reason === toolName(input) ? previous : null;
}

function sourceRefsOf(scope) {
  // shape 已由共享 Scope/call 边界验证；本 owner 只要求材料来源唯一。
  const refs = scope.source_refs.map((item) => item.ref);
  return new Set(refs).size === refs.length ? refs : null;
}

function validMissionMaterial(item) {
  return isRecord(item) && ["ref", "group", "text"].every((key) => nonBlank(item[key]));
}

function missionMaterials(content) {
  const items = content?.operation?.mission_inputs?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const labels = new Map();
  for (const item of items) {
    if (!validMissionMaterial(item) || labels.has(item.ref)) return null;
    // Domain ChapterMissionInputs.label/2 直接取原 item.text；不 trim、不重建标签。
    labels.set(item.ref, item.text);
  }
  return { refs: [...labels.keys()], labels };
}

function sameRefSet(left, right) {
  const rightSet = new Set(right);
  return left.length === right.length && left.every((ref) => rightSet.has(ref));
}

// 具体依据只取同次已绑定请求里的结构事实；目录、正文页、档案条目和摘要
// 各有自己的精确 ref。标签核验不查询 DB、不按整段摘要猜名称，也不改材料完整度。
function observedName(payload, ref) {
  const facts = payload.content?.facts;
  const character = isRecord(facts?.character) ? [facts.character] : list(facts?.character);
  const entries = [...list(facts?.chapters), ...list(facts?.characters), ...character]
    .filter(entry => isRecord(entry) && (entry.ref ?? entry.character_ref) === ref);
  if (entries.length !== 1) return null;
  const name = entries[0].title ?? entries[0].name;
  return nonBlank(name) ? name : null;
}

function previewRange(preview, ref, name) {
  return preview?.source_ref === ref && preview.representation === "preview" &&
    preview.status === "partial" && Number.isSafeInteger(preview.returned_graphemes) &&
    Number.isSafeInteger(preview.total_graphemes)
    ? `${name}预览：已供给 ${preview.returned_graphemes} / ${preview.total_graphemes} 字符` : null;
}

function observedBodyRange(coverage, ref) {
  const range = coverage?.prose_range;
  const body = coverage?.chapter_ref === ref &&
    [range?.start, range?.end, coverage.prose_total_chars].every(Number.isSafeInteger)
    ? `正文第 ${range.start}–${range.end} 字符 / 共 ${coverage.prose_total_chars} 字符` : null;
  const parts = [body, previewRange(coverage?.chapter_plan, ref, "章计划"),
    previewRange(coverage?.chapter_summary, ref, "章摘要")].filter(nonBlank);
  return parts.length ? parts.join("；") : null;
}

function observedArchiveRange(range) {
  if (!isRecord(range)) return null;
  const { offset, returned_graphemes: returned, total_graphemes: total, offset_unit: unit } = range;
  if (unit !== "unicode_grapheme" || ![offset, returned, total].every(Number.isSafeInteger) ||
      offset < 0 || returned <= 0 || offset + returned > total) return null;
  return `档案条目原文第 ${offset + 1}–${offset + returned} 字符 / 共 ${total} 字符`;
}

function observedArchiveBasis(payload, ref) {
  const coverage = payload.coverage;
  if (coverage?.sources != null) {
    if (!Array.isArray(coverage.sources)) return null;
    const matches = coverage.sources.filter(source => source?.ref === ref);
    return matches.length === 1 ? observedArchiveRange(matches[0]) : null;
  }
  const name = observedName(payload, ref);
  if (name !== null) return name;
  const sources = list(payload.source_refs);
  const onlyRef = typeof sources[0] === "string" ? sources[0] : sources[0]?.ref;
  // stats 等单来源档案的 summary 范围属于该唯一来源；不把汇总正文复制进使命。
  return sources.length === 1 && onlyRef === ref ? observedArchiveRange(coverage?.summary) : null;
}

function observedBasis(payload, ref) {
  const content = payload.content, coverage = payload.coverage;
  if (coverage?.kind === "directory") return observedName(payload, ref);
  if (content?.tool === "chapter_read") return observedBodyRange(coverage, ref);
  if (content?.tool === "archive_read") return observedArchiveBasis(payload, ref);
  if (coverage?.kind === "recall" && content?.tool === "memory_recall") {
    let preview;
    try { preview = JSON.parse(content.summary); } catch { return null; }
    const matches = list(preview?.items).filter(item => item?.memory_ref === ref);
    return matches.length === 1 && nonBlank(matches[0].text) ? matches[0].text : null;
  }
  return observedName(payload, ref) ??
    (list(payload.source_refs).length === 1 && nonBlank(content?.summary) ? content.summary : null);
}

function observedLabel(payload, source) {
  const ref = typeof source === "string" ? source : source?.ref;
  const basis = observedBasis(payload, ref);
  if (!nonBlank(basis)) return null;
  const coverage = payload.coverage, omissions = list(payload.omissions);
  const version = (isRecord(source) ? source.version : null) ?? payload.versions?.[ref];
  const complete = coverage?.["complete?"] === true && payload.status === "ok" &&
    omissions.length === 0 && payload.next_offset == null;
  const coverageNote = payload.content?.tool !== "chapter_read" || coverage?.chapter_ref === ref
    ? coverage?.coverage_note : null;
  const notes = [coverageNote, ...omissions].filter(nonBlank);
  const qualifier = complete ? "本次读取完整" :
    (notes.length ? notes.join("；") : "仅表示本次可见读取；未声明完整覆盖");
  return `【${version == null ? "" : `版本 ${version}；`}${qualifier}】${basis}`;
}

function suppliedMissionMaterials(bindings, initial) {
  const labels = new Map();
  const add = (ref, label) => {
    if (nonBlank(ref)) labels.set(ref, [...(labels.get(ref) ?? []), label]);
  };
  // 同 ref 的多个版本/页段各自保留；任何已用来源缺名都不能由另一来源代签。
  for (const unit of observationFacts(bindings.map(binding => binding.actual))) {
    if (!usableObservationFact(unit)) continue;
    for (const source of list(unit.payload.source_refs)) {
      add(typeof source === "string" ? source : source?.ref, observedLabel(unit.payload, source));
    }
  }
  const current = bindings.findLast(binding => binding.canonical.role === "scope_update" &&
    binding.canonical.provenance === "application");
  const supplied = new Set(list(current?.canonical.baseRefs).map(source =>
    typeof source === "string" ? source : source?.ref));
  for (const [ref, label] of initial.labels) if (supplied.has(ref)) add(ref, label);
  return { refs: [...labels.keys()], inputRefCount: initial.refs.length,
    labels: new Map([...labels].map(([ref, parts]) =>
      [ref, parts.every(nonBlank) ? parts.join("\n") : null])) };
}

function operationRequest(scope, record, sessionMessages, input) {
  const bindings = canonicalRequestBindingsForProviderCall(record, { messages: sessionMessages });
  const projected = bindings?.findLast(binding => binding.canonical.role === "scope_update" &&
    binding.canonical.provenance === "application")?.actual;
  if (!scope || !projected) return null;
  const content = projected.scopeContent, inputs = content?.operation?.mission_inputs;
  const planning = input.missionKind === "planning";
  if (content?.work_id !== input.sourceWorkId || inputs?.mode !== (planning ? "planning" : "prose") ||
      (planning ? inputs.chapter !== null : inputs.chapter?.chapter_ref !== input.targetChapterRef)) return null;
  const metadata = sourceRefsOf(scope);
  const materials = missionMaterials(content);
  if (!metadata || !materials || !sameRefSet(metadata, materials.refs)) return null;
  return suppliedMissionMaterials(bindings, materials);
}

function missionCalls(transcript, input) {
  return assistantCalls(transcript).filter((call) => call.name === toolName(input));
}

function missionCall(transcript, mission, input) {
  if (!mission?.provider_call_ref) return null;
  const matches = missionCalls(transcript, input)
    .filter((call) => call.pcall === mission.provider_call_ref);
  return matches.length === 1 ? matches[0] : null;
}

function joinedRefsContain(call, input) {
  const joined = isRecord(input.joinedRefs) ? input.joinedRefs : null;
  if (joined === null) return false;
  return Boolean(
    nonBlank(call.pcall) &&
    nonBlank(call.prun) &&
    list(joined.provider_call_refs).includes(call.pcall) &&
    list(joined.provider_run_refs).includes(call.prun),
  );
}

function joinedCallCheck(call, input) {
  return [joinedRefsContain(call, input), sourceRunMatches(input)].every(Boolean);
}

function turnScopeMatches(turnId, parentTurnRef) {
  // parentTurnRef 的非空约束由 sourceRunMatches 统一负责；这里只要求 record turn 非空。
  if (!nonBlank(turnId)) return false;
  if (turnId === parentTurnRef) return true;
  const suffix = AGENT_STEP_TURN.exec(turnId);
  return Boolean(suffix && turnId.slice(0, suffix.index) === parentTurnRef);
}

// joined record 的真实作用域仍要逐项核对：work/session/parent 不能被 pcall 单键替代。
function recordScopeMatches(record, input) {
  const run = input.sourceRunRecord;
  return Boolean(
    isRecord(run) &&
    record.work_id === run.work_id &&
    record.session_id === run.session_id &&
    turnScopeMatches(record.turn_id, run.parent_turn_ref),
  );
}

// 真实 fixture_provider_result/v1 日志没有 agent_run_id；唯一配对键是 pcall+prun。
// 同次响应必须同时对上 canonical assistant 的 pcall 与 prun，不能各自在 refs 集合内即放行。
function recordForCall(input, call) {
  if (!call) return null;
  const matches = list(input.records).filter((record) =>
    isRecord(record) &&
    record.provider_call_ref === call.pcall &&
    record.provider_run_ref === call.prun &&
    recordScopeMatches(record, input));
  return matches.length === 1 ? matches[0] : null;
}

function responseCall(record, call, input) {
  if (!call) return null;
  const message = list(input.transcript?.messages)[call.messageIndex];
  const response = providerResponseForCanonicalCall(record, message, call.blockIndex);
  if (!response || response.toolCallCount !== 1 || response.call.name !== toolName(input)) return null;
  if (response.contentObserved && response.content !== "") return null;
  // canonical 是 ProviderOutput 的同次转录；SSE 原始日志未观测的正文不在此补造。
  if (list(message.blocks).some(block => block?.type === "text" && block.text !== "")) return null;
  return response.arguments;
}
function responseItem(item) {
  if (!isRecord(item)) return null;
  if (Object.keys(item).some((key) => !MISSION_ITEM_KEYS.includes(key))) return null;
  const text = item.text;
  const basisRef = typeof item.basis_ref === "string" ? item.basis_ref.trim() : null;
  if (![text, basisRef].every(nonBlank)) return null;
  return { text, basis_ref: basisRef };
}

function responseItems(value) {
  const parsed = list(value).map(responseItem);
  return parsed.every((item) => item !== null) ? parsed : null;
}

function responseMission(args) {
  if (!isRecord(args)) return null;
  const statement = args.statement;
  const confidence = args.confidence;
  if (!nonBlank(statement) || !nonBlank(args.author_reasoning)) return null;
  if (!Number.isFinite(confidence)) return null;
  const advance = responseItems(args.must_advance);
  if (!advance) return null;
  const avoid = responseItems(args.must_avoid);
  if (!avoid) return null;
  return { statement, confidence, advance, avoid };
}

function labelExpected(items, refs, labels) {
  const kept = [];
  for (const item of items) {
    if (!refs.has(item.basis_ref)) continue;
    const label = labels.get(item.basis_ref);
    if (!nonBlank(label)) return null;
    kept.push({ text: item.text, basis_ref: item.basis_ref, basis_label: label });
  }
  return kept;
}

function expectedMission(response, request) {
  if (!response || !request) return null;
  const refs = new Set(request.refs);
  const advance = labelExpected(response.advance, refs, request.labels);
  const avoid = labelExpected(response.avoid, refs, request.labels);
  if (advance === null || avoid === null) return null;
  const dropped = response.advance.length + response.avoid.length - advance.length - avoid.length;
  const basisRefs = [...new Set([...advance, ...avoid].map((item) => item.basis_ref))];
  return { advance, avoid, dropped, basisRefs };
}

function contentMatches(mission, response, expected) {
  return Boolean(
    mission &&
    mission.statement === response.statement &&
    mission.confidence === response.confidence &&
    isDeepStrictEqual(mission.must_advance, expected.advance) &&
    isDeepStrictEqual(mission.must_avoid, expected.avoid),
  );
}

function eventPayload(event) {
  return isRecord(event?.payload) ? event.payload : null;
}

function eventEnvelopeMatches(event, payload, input) {
  return Boolean(
    event.event_type === "mission_derived" &&
    event.run_ref === input.sourceRunId &&
    payload.stage === "mission_derived",
  );
}

function eventMissionRefMatches(event, payload, mission) {
  const ref = missionRef(mission);
  return Boolean(ref && payload.mission_ref === ref && list(event.refs).includes(ref));
}

function eventBasisMatches(payload, expected, input) {
  return Boolean(
    isDeepStrictEqual(payload.basis_refs, expected.basisRefs) &&
    payload.dropped_unbound_count === expected.dropped &&
    payload.input_ref_count === input.request.inputRefCount &&
    payload.must_advance_count === expected.advance.length &&
    payload.must_avoid_count === expected.avoid.length,
  );
}

function eventNarrativeMatches(payload, call, input) {
  const args = responseCall(recordForCall(input, call), call, input);
  const text = args?.author_reasoning;
  if (!nonBlank(text) || payload.author_narrative !== text) return false;
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  return isDeepStrictEqual(payload.author_narrative_source, {
    source_type: "provider_output_tool_narrative",
    provider_call_ref: call.pcall, provider_run_ref: call.prun, provider_output_ref: call.prun,
    tool_call_name: toolName(input), tool_call_narrative_field: "author_reasoning",
    source_hash: hash, narrative_hash: hash,
    source_byte_range: { start: 0, length: Buffer.byteLength(text, "utf8") },
  });
}

function eventTimeMatches(event, input) {
  return Boolean(nonBlank(event.emitted_at) && timestampWithin(event.emitted_at, input.window));
}

function eventMatches(event, mission, expected, input, call) {
  const payload = eventPayload(event);
  if (!payload) return false;
  return [
    eventEnvelopeMatches(event, payload, input),
    eventMissionRefMatches(event, payload, mission),
    eventBasisMatches(payload, expected, input),
    eventNarrativeMatches(payload, call, input),
    eventTimeMatches(event, input),
  ].every(Boolean);
}

function missionEventCheck(input, mission, expected, call) {
  const events = list(input.missionEvents);
  return events.length === 1 && eventMatches(events[0], mission, expected, input, call);
}

function timestampWithin(value, window) {
  const at = parseUtcTimestamp(value);
  return at >= parseUtcTimestamp(window.startAt) && at <= parseUtcTimestamp(window.beforeAt);
}

function chapterWriteWithin(startChapter, beforeChapter, window) {
  const startAt = parseUtcTimestamp(startChapter.updated_at);
  const beforeAt = parseUtcTimestamp(beforeChapter.updated_at);
  return beforeAt >= startAt && beforeAt <= parseUtcTimestamp(window.beforeAt);
}

function missionDerivedWithin(mission, window) {
  const derivedAt = parseUtcTimestamp(mission.derived_at);
  const beforeAt = parseUtcTimestamp(window.beforeAt);
  return derivedAt >= parseUtcTimestamp(window.startAt) &&
    derivedAt <= beforeAt &&
    beforeAt >= derivedAt;
}

function missionWriteTimeCheck(startChapter, beforeChapter, mission, window) {
  if (!mission) return false;
  return [chapterWriteWithin(startChapter, beforeChapter, window),
    missionDerivedWithin(mission, window)].every(Boolean);
}

function timeCheck(startChapter, beforeChapter, mission, changed, window) {
  if (!changed) return beforeChapter.updated_at === startChapter.updated_at;
  return missionWriteTimeCheck(startChapter, beforeChapter, mission, window);
}

function transitionCheck(startChapter, beforeChapter, changed) {
  if (!changed) return true;
  if (!isRecord(startChapter) || !isRecord(beforeChapter)) return false;
  return (startChapter.mission === null || isTentativeModel(startChapter.mission)) &&
    isTentativeModel(beforeChapter.mission);
}

function authorVersionCheck(startChapter, calls, events) {
  if (!isRecord(startChapter) || !isAuthorMission(startChapter.mission)) return true;
  return list(calls).length === 0 && list(events).length === 0;
}

function callResponseCheck(input, call) {
  const record = recordForCall(input, call);
  return Boolean(joinedCallCheck(call, input) && record && responseCall(record, call, input));
}

function retainedItemsMatch(mission, expected) {
  return isDeepStrictEqual(mission.must_advance, expected.advance) &&
    isDeepStrictEqual(mission.must_avoid, expected.avoid);
}

function changedChecks(input, call, mission, response, expected) {
  const ready = mission && call && response && expected;
  if (!ready) return missingChangedChecks();
  return {
    call: callResponseCheck(input, call),
    content: contentMatches(mission, response, expected),
    retained: retainedItemsMatch(mission, expected),
    event: missionEventCheck(input, mission, expected, call),
  };
}

function missingChangedChecks() {
  return { call: false, content: false, retained: false, event: false };
}

const field = (value, key) => (value && value[key] != null ? value[key] : null);

function missionMeasured(input) {
  const mission = field(field(input, "beforeChapter"), "mission");
  return {
    mission_id: field(mission, "mission_id"),
    mission_status: field(mission, "status"),
    mission_source: field(mission, "source"),
    derived_at: field(mission, "derived_at"),
    updated_at: field(input.beforeChapter, "updated_at"),
  };
}

function callMeasured(call) {
  return {
    provider_call_ref: field(call, "pcall"),
    provider_run_ref: field(call, "prun"),
  };
}

function requestMeasured(request) {
  const expected = field(request, "expected");
  const basisRefs = field(expected, "basisRefs");
  return {
    retained_basis_refs: Array.isArray(basisRefs) ? basisRefs : [],
    dropped_basis_count: field(expected, "dropped"),
    input_ref_count: Array.isArray(field(request, "refs")) ? request.refs.length : null,
  };
}

function measured(input, call, changed) {
  return {
    mission_changed: changed,
    target_chapter_ref: field(input, "targetChapterRef"),
    ...missionMeasured(input),
    ...callMeasured(call),
    ...requestMeasured(input.request),
  };
}

function proofFact(active, facts, key) {
  return active ? facts[key] : true;
}

function timeInputCheck(input, active) {
  const startChapter = isRecord(input.startChapter) ? input.startChapter : null;
  const beforeChapter = isRecord(input.beforeChapter) ? input.beforeChapter : null;
  return [
    startChapter !== null,
    beforeChapter !== null,
    beforeChapter !== null && timeCheck(
      startChapter,
      beforeChapter,
      beforeChapter.mission,
      active,
      input.window,
    ),
  ].every(Boolean);
}

function checksFor(input, active, changedFacts, calls) {
  return {
    [input.missionKind === "planning" ? "mission_target_work_matches_source" : "mission_target_chapter_matches_source"]: targetCheck(input),
    ...(input.requireDerivation ? { mission_was_derived: active && changedFacts.event && calls.length > 0 } : {}),
    mission_transition_is_legal: transitionCheck(input.startChapter, input.beforeChapter, active),
    mission_call_is_fully_joined: proofFact(active, changedFacts, "call"),
    mission_response_content_matches: proofFact(active, changedFacts, "content"),
    mission_retained_basis_and_labels_match: proofFact(active, changedFacts, "retained"),
    mission_id_and_event_are_bound: proofFact(active, changedFacts, "event"),
    mission_time_within_source_window: timeInputCheck(input, active),
    author_version_not_rederived:
      authorVersionCheck(input.startChapter, calls, input.missionEvents),
  };
}

function callFacts(input, call) {
  const scope = call ? scopeMessageFor(input.transcript, call, input) : null;
  const record = recordForCall(input, call);
  const request = operationRequest(scope, record, input.sessionMessages, input);
  const response = responseMission(responseCall(record, call, input));
  return { request, response };
}

// 输入中的 chapter 事实来自同一 v2 快照；source artifact/run/transcript/records/
// mission_derived 事件均由 revision_run_evidence 从真实批次读取后原样传入。
export function missionSourceChecks(input = {}) {
  if (input.missionKind === "planning") {
    input = { ...input, startChapter: input.startWork, beforeChapter: input.beforeWork };
  }
  const changed = missionChanged(input.startChapter, input.beforeChapter);
  const calls = missionCalls(input.transcript, input);
  const mission = field(input.beforeChapter, "mission");
  const call = missionCall(input.transcript, mission, input);
  const { request, response } = callFacts(input, call);
  const expected = expectedMission(response, request);
  // 不能只看 before==after：源 run 已有 mission 调用/事件时，仍必须证明这次成功派生
  // 落到了目标章设计态；真正的“未派生/作者版不重推”仍是 0 calls/events。
  const active = changed || calls.length > 0 || list(input.missionEvents).length > 0;
  const changedFacts = active
    ? changedChecks({ ...input, request }, call, mission, response, expected)
    : missingChangedChecks();
  const refs = field(request, "refs");
  return {
    checks: checksFor(input, active, changedFacts, calls),
    measured: measured({
      ...input,
      request: { refs: Array.isArray(refs) ? refs : [], expected },
    }, call, changed),
  };
}
