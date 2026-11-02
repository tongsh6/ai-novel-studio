// B71 源阶段章使命的纯证据：把“DB 里出现了一条 model/TENTATIVE mission”绑定到
// 同一次 source run 的真实 pcall/prun、canonical chapter_mission 调用、同次响应、
// 该调用前 operation 的 source_refs 与实际供给的 basis_label、以及真实
// mission_derived 事件。本模块不做 I/O，也不按时间/最新值猜调用。
import { isDeepStrictEqual } from "node:util";
import { parseUtcTimestamp } from "./authoring_canon_evidence.mjs";
import { assistantCalls } from "./authoring_revision_evidence.mjs";

const TOOL_NAME = "chapter_mission";
const TENTATIVE = "TENTATIVE";
const MISSION_ITEM_KEYS = Object.freeze(["text", "basis_ref"]);
// 真实 Provider 请求把 operation scope 投影成一条 user 消息：固定标记 + 版本行 + 原文。
const SCOPE_PROJECTION_MARKER = "【应用数据 · scope_update · 以最新版本为准】";
const MATERIAL_HEADER = "材料（每条以 [ref] 开头";
const MATERIAL_LINE = /^- \[([^\]\r\n]+)\] (.+)$/u;
const AGENT_STEP_TURN = /:agent:[1-9][0-9]*$/u;

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const clean = (value) => (typeof value === "string" ? value.trim() : "");

function parsedObject(text) {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseArguments(value) {
  if (isRecord(value)) return value;
  return typeof value === "string" ? parsedObject(value) : null;
}

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
  return [targetIdentityMatches(input), targetChapterMatches(input), sourceRunMatches(input)]
    .every(Boolean);
}

function scopeMessageFor(transcript, call) {
  // call 本身来自该 transcript 的 canonical assistant，因此 transcript 必为对象。
  const previous = list(transcript.messages)[call.messageIndex - 1];
  if (!isRecord(previous) || previous.role !== "scope_update") return null;
  if (previous.provenance !== "application") return null;
  return previous.versions?.change_reason === TOOL_NAME ? previous : null;
}

function sourceRefsOf(scope) {
  const refs = list(scope.source_refs).map((item) => item?.ref).filter(nonBlank);
  return new Set(refs).size === refs.length ? refs : null;
}

function materialLine(line) {
  const match = MATERIAL_LINE.exec(line.trim());
  if (!match) return null;
  // 空 ref/空 label 无法匹配任何 canon 合法 basis，交给 metadata/标签一致性边界关闭。
  return { ref: clean(match[1]), label: clean(match[2]) };
}

// 只解析本次 operation 真正的材料声明区：从材料表头后开始，到下一个二级标题为止。
// 规则示例、作者引用或其它历史文本不在该区，不能成为正式来源映射。
function materialDeclaration(text) {
  if (typeof text !== "string") return null;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith(MATERIAL_HEADER));
  if (start < 0) return null;
  const refs = [];
  const labels = new Map();
  const body = lines.slice(start);
  body.shift(); // 表头本身不是材料行
  for (const line of body) {
    if (line.trim().startsWith("## ")) break;
    const item = materialLine(line);
    if (!item) continue;
    // 同一 ref 出现两次即歧义来源，不能靠后写覆盖前写。
    if (labels.has(item.ref)) return null;
    refs.push(item.ref);
    labels.set(item.ref, item.label);
  }
  if (!refs.length) return null;
  return { refs, labels };
}

function materialOfScope(scope) {
  return materialDeclaration(
    list(scope.blocks).map((block) => block?.text).filter(nonBlank).join("\n"),
  );
}

function sameRefSet(left, right) {
  const rightSet = new Set(right);
  return left.length === right.length && left.every((ref) => rightSet.has(ref));
}

function sameMaterial(left, right) {
  // operationRequest 只在两侧都解析出材料后调用。
  if (!sameRefSet(left.refs, right.refs)) return false;
  return left.refs.every((ref) => left.labels.get(ref) === right.labels.get(ref));
}

function versionLineMatches(content, versions) {
  const prefix = `${SCOPE_PROJECTION_MARKER}\n版本：`;
  if (!content.startsWith(prefix)) return false;
  const rest = content.slice(prefix.length);
  const line = rest.split("\n", 1)[0].trim();
  const parsed = parsedObject(line);
  return Boolean(parsed && isDeepStrictEqual(parsed, versions));
}

function isProjectedScope(message, versions, texts) {
  return isRecord(message) &&
    message.role === "user" &&
    typeof message.content === "string" &&
    versionLineMatches(message.content, versions) &&
    texts.every((text) => message.content.includes(text));
}

// 在本次 pcall 自己的 request_body.messages 中定位调用前当前 scope 的唯一投影：
// 固定标记 + 版本对象 + canonical 原文逐块出现。不能按时间/latest/全 run 搜旧 scope。
function projectedScope(record, scope) {
  // operationRequest 只在 canonical 材料非空后调用，scope 必为对象且有材料文本。
  const texts = list(scope.blocks).map((block) => block?.text).filter(nonBlank);
  if (!isRecord(scope.versions)) return null;
  const matches = list(record?.request_body?.messages)
    .filter((message) => isProjectedScope(message, scope.versions, texts));
  return matches.length === 1 ? matches[0].content : null;
}

function operationRequest(scope, record) {
  if (!isRecord(scope)) return null;
  const metadata = sourceRefsOf(scope);
  const canonical = materialOfScope(scope);
  if (!metadata || !canonical || !sameRefSet(metadata, canonical.refs)) return null;
  const projected = projectedScope(record, scope);
  if (!projected) return null;
  const supplied = materialDeclaration(projected);
  return sameMaterial(canonical, supplied) ? supplied : null;
}

function missionCalls(transcript) {
  return assistantCalls(transcript).filter((call) => call.name === TOOL_NAME);
}

function missionCall(transcript, mission) {
  if (!mission?.provider_call_ref) return null;
  const matches = missionCalls(transcript)
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

function singleMissionResponseCall(record) {
  if (!isRecord(record) || !isRecord(record.response) || record.response.status !== "ok") {
    return null;
  }
  const body = record.response.body;
  const calls = list(isRecord(body) ? body.tool_calls : null);
  return calls.length === 1 && isRecord(calls[0]) && calls[0].name === TOOL_NAME
    ? calls[0]
    : null;
}

function responseCall(record, call) {
  const response = singleMissionResponseCall(record);
  if (!response) return null;
  const canonical = parseArguments(call.arguments);
  const responded = parseArguments(response.arguments);
  return isDeepStrictEqual(canonical, responded) ? responded : null;
}

function responseItem(item) {
  if (!isRecord(item)) return null;
  if (Object.keys(item).some((key) => !MISSION_ITEM_KEYS.includes(key))) return null;
  const text = clean(item.text);
  const basisRef = clean(item.basis_ref);
  if ([text, basisRef].includes("")) return null;
  return { text, basis_ref: basisRef };
}

function responseItems(value) {
  const parsed = list(value).map(responseItem);
  return parsed.every((item) => item !== null) ? parsed : null;
}

function responseMission(args) {
  if (!isRecord(args)) return null;
  const statement = clean(args.statement);
  const confidence = args.confidence;
  if (statement === "") return null;
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
    payload.input_ref_count === input.request.refs.length &&
    payload.must_advance_count === expected.advance.length &&
    payload.must_avoid_count === expected.avoid.length,
  );
}

function eventNarrativeMatches(payload, call) {
  const narrative = payload.author_narrative_source;
  if (!isRecord(narrative)) return false;
  return narrative.provider_call_ref === call.pcall &&
    narrative.provider_run_ref === call.prun;
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
    eventNarrativeMatches(payload, call),
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
  return Boolean(joinedCallCheck(call, input) && record && responseCall(record, call));
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
    mission_target_chapter_matches_source: targetCheck(input),
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
  const scope = call ? scopeMessageFor(input.transcript, call) : null;
  const record = recordForCall(input, call);
  const request = operationRequest(scope, record);
  const response = responseMission(responseCall(record, call));
  return { request, response };
}

// 输入中的 chapter 事实来自同一 v2 快照；source artifact/run/transcript/records/
// mission_derived 事件均由 revision_run_evidence 从真实批次读取后原样传入。
export function chapterMissionSourceChecks(input = {}) {
  const changed = missionChanged(input.startChapter, input.beforeChapter);
  const calls = missionCalls(input.transcript);
  const mission = field(input.beforeChapter, "mission");
  const call = missionCall(input.transcript, mission);
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
