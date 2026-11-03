// B71 质量发现→局部修订原生场景的纯判据与语义定位。
//
// 本模块只消费外部驱动采集到的 AX 节点、真实 WS 帧、fixture 同次请求/响应与
// 只读 DB 行；不做文件/DB I/O，也不把“时间顺序”“最新一行”当作身份。
// - 章节草稿入口必须按可见章标题定位其行内按钮，不能盲点第 n 个“生成正文草稿”。
// - author_action 的 ACK 只按同 join_ref/request_ref/topic 的唯一 phx_reply 绑定。
// - 修订 child 的两次原生调用按 canonical assistant 顺序定位；第二请求必须严格
//   继承第一请求并只追加 assistant+tool(native result)，不允许伪 user 纠错。
// - artifact 字节只与 child 最后合法响应的同 item_id 字段逐字比较。
import {
  AUTHOR_VISIBLE_MIGRATION_CATEGORIES,
  scanAuthorVisibleTexts,
} from "../author_visible/leak_scan.mjs";
import {
  broadcastFrames,
  frameBody,
  frameEvent,
  frameOf,
  requestIdentity,
  requestReplies,
} from "./scenario_evidence.mjs";

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === "string" ? value : "");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const allTrue = (...values) => values.every(Boolean);

function get(value, key) {
  return value !== null && typeof value === "object" ? value[key] : undefined;
}

function getIn(value, keys) {
  return keys.reduce((current, key) => get(current, key), value);
}

function nullIfUndefined(value) {
  return value === undefined ? null : value;
}

function stringLength(value) {
  return typeof value === "string" ? value.length : null;
}

export const REVISION_PROFILE = "prose_revision_from_findings_v1";
export const SOURCE_PROFILE = "prose_drafting_with_quality_v1";
export const REVISION_CHAPTER_TITLE = "第02章：矿区追击战";
export const REVISION_BUTTON = "局部修订所选问题";

// AX 节点可见文本：title/desc/value 三者都是作者可见语义；按钮文案通常只在 title。
export function nodeText(node) {
  return [node?.title, node?.desc, node?.value]
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "")
    .join(" ");
}

const CHAPTER_TITLE = /^第\s*[0-9一二三四五六七八九十百千两]+\s*章/u;

function generateButton(node) {
  if (node?.role !== "AXButton") return null;
  return node.title === "生成正文草稿" || node.value === "生成正文草稿" ? node : null;
}

function chapterButtonAfter(nodes, start, title) {
  const following = nodes.slice(start);
  following.shift();
  for (const node of following) {
    const label = nodeText(node);
    if (CHAPTER_TITLE.test(label) && label !== title) return null;
    const button = generateButton(node);
    if (button) return button;
  }
  return null;
}

// 在同一章节卡内定位“生成正文草稿”：从目标章标题之后的第一个生成按钮；
// 若先遇到下一章标题则拒绝，不能把后续章节的按钮当成目标章。
export function chapterDraftTarget(nodes, title) {
  if (!Array.isArray(nodes) || !nonBlank(title)) return null;
  const start = nodes.findIndex((node) => nodeText(node) === title);
  return start < 0 ? null : chapterButtonAfter(nodes, start, title);
}

// WorkspaceChat.onDraftChapter 的真实可见命令模板；chapterBrief 由 StructurePanel
// 以章标题开头（`${title}：${summary}`），因此只把完整模板 + 章标题边界视为本 scope。
const SOURCE_REQUEST_PREFIX = "请根据已采纳章节计划生成";
const SOURCE_REQUEST_SUFFIX = "正文草稿，保持为待采纳草稿。";
const CHAPTER_BRIEF_BOUNDARY = /^[：:。，,、\s]/u;

function sourceEnvelopeMatches(record, since) {
  return allTrue(
    get(record, "direction") === "sent",
    frameEvent(record) === "user_message",
    typeof get(record, "at") === "string",
    get(record, "at") >= since,
  );
}

function sourceBriefMatches(brief, chapterTitle) {
  return (
    brief === chapterTitle ||
    (brief.startsWith(chapterTitle) &&
      CHAPTER_BRIEF_BOUNDARY.test(brief.slice(chapterTitle.length)))
  );
}

function sourceMessageMatches(record, chapterTitle, since) {
  if (!sourceEnvelopeMatches(record, since)) return false;
  const body = frameBody(record);
  if (body?.generate_micro_plan !== true) return false;
  const message = text(body.text);
  if (!message.startsWith(SOURCE_REQUEST_PREFIX) || !message.endsWith(SOURCE_REQUEST_SUFFIX)) {
    return false;
  }
  const brief = message.slice(
    SOURCE_REQUEST_PREFIX.length,
    -SOURCE_REQUEST_SUFFIX.length,
  );
  return sourceBriefMatches(brief, chapterTitle);
}

export function isSourceGenerationMessage(record, { chapterTitle, since }) {
  return sourceMessageMatches(record, chapterTitle, since);
}

export function sourceGenerationMessage(wire, { chapterTitle, since }) {
  const messages = list(wire).filter((record) =>
    isSourceGenerationMessage(record, { chapterTitle, since }),
  );
  if (messages.length !== 1) {
    throw new Error(`revision_source_message: 目标章真实输入必须恰好一条，实测 ${messages.length}`);
  }
  return messages[0];
}

function sentActionMatches(record, { topic, since, sourceTurnRef, targetRef }) {
  if (record?.direction !== "sent" || frameEvent(record) !== "author_action") return false;
  if (typeof record.at !== "string" || record.at < since) return false;
  if (frameOf(record)[2] !== topic) return false;
  const action = get(frameBody(record), "action");
  if (!isObject(action)) return false;
  return allTrue(
    action.action_type === "revise_from_findings",
    action.source_turn_ref === sourceTurnRef,
    action.target_ref === targetRef,
  );
}

export function revisionActionFrame(wire, identity) {
  assertIdentityWindow(identity, "revision_action_frame", "since");
  const matches = list(wire).filter((record) => sentActionMatches(record, identity));
  if (matches.length !== 1) {
    throw new Error(`revision_action_frame: author_action 必须恰好一条，实测 ${matches.length}`);
  }
  return matches[0];
}

function successfulActionResponse(reply) {
  const body = frameBody(reply);
  if (!isObject(body)) return null;
  const response = get(body, "response");
  if (!isObject(response)) return null;
  return allTrue(body.status === "ok", response.received === true) ? response : null;
}

// 作者动作 ACK 与 author 消息共用同一 Phoenix 请求回复边界；此处只解析动作成功形状。
export function authorActionAck(wire, actionFrame) {
  const identity = requestIdentity(actionFrame, "author_action");
  const replies = requestReplies(wire, identity, actionFrame.at);
  if (replies.length !== 1) {
    throw new Error(`revision_action_ack: 同请求 ACK 必须唯一，实测 ${replies.length}`);
  }
  const response = successfulActionResponse(replies[0]);
  if (!response) throw new Error("revision_action_ack: ACK 未确认受理");
  return { reply: replies[0], response, identity };
}

function actionResultMatches(body, { receiptId, runId, sourceTurnRef, targetRef }) {
  return allTrue(
    isObject(body),
    body?.receipt_id === receiptId,
    body?.run_id === runId,
    body?.source_turn_ref === sourceTurnRef,
    body?.target_artifact_ref === targetRef,
  );
}

// 同一次 author_action 的广播回执：topic/at 定广播归属，body 定动作身份。
export function actionResultFor(wire, identity) {
  assertIdentityWindow(identity, "revision_action_result", "at");
  const matches = broadcastFrames(wire, {
    topic: identity.topic,
    at: identity.at,
    event: "action_result",
  }).filter((record) => actionResultMatches(frameBody(record), identity));
  if (matches.length !== 1) {
    throw new Error(`revision_action_result: 回执广播必须恰好一条，实测 ${matches.length}`);
  }
  return frameBody(matches[0]);
}

function assertIdentityWindow(identity, label, key) {
  if (!nonBlank(identity?.topic)) throw new Error(`${label}: 缺 owning topic`);
  if (typeof identity[key] !== "string" || identity[key] === "") {
    throw new Error(`${label}: 缺 ${key}`);
  }
}

function childBoundRecords(wire, runId, scope, event) {
  assertIdentityWindow(scope, `child_${event}`, "at");
  if (!nonBlank(runId)) throw new Error(`child_${event}: 缺 run_id`);
  return broadcastFrames(wire, { topic: scope.topic, at: scope.at, event });
}

export function childRunStates(wire, runId, scope) {
  return childBoundRecords(wire, runId, scope, "agent_run_state")
    .filter((record) => frameBody(record)?.run_id === runId)
    .map((record) => ({ at: record.at, body: frameBody(record) }));
}

export function childTurnResults(wire, runId, scope) {
  return childBoundRecords(wire, runId, scope, "turn_result")
    .filter((record) => frameBody(record)?.agent_run?.run_id === runId)
    .map((record) => ({ at: record.at, body: frameBody(record) }));
}

// canonical assistant tool_call 与 tool validation_result 的唯一读取边界。
export function assistantCalls(transcript) {
  const calls = [];
  for (const [messageIndex, message] of list(transcript?.messages).entries()) {
    if (!isObject(message) || message.role !== "assistant") continue;
    for (const [blockIndex, block] of list(message.blocks).entries()) {
      if (!isObject(block) || block.type !== "tool_call") continue;
      calls.push({
        call_id: block.call_id,
        name: block.name,
        arguments: block.arguments,
        pcall: message.provider_call_ref,
        prun: message.provider_run_ref,
        messageIndex,
        blockIndex,
      });
    }
  }
  return calls;
}

function validations(transcript) {
  const results = [];
  for (const [messageIndex, message] of list(transcript?.messages).entries()) {
    if (!isObject(message) || message.role !== "tool") continue;
    for (const [blockIndex, block] of list(message.blocks).entries()) {
      if (!isObject(block) || block.type !== "validation_result") continue;
      results.push({
        call_id: block.call_id,
        status: block.status,
        reason_code: block.reason_code,
        messageIndex,
        blockIndex,
      });
    }
  }
  return results;
}

function recordByPcall(records) {
  const map = new Map();
  for (const record of list(records)) {
    const pcall = record?.provider_call_ref;
    if (!nonBlank(pcall)) continue;
    if (map.has(pcall)) return { error: "duplicate" };
    map.set(pcall, record);
  }
  return { map };
}

function responseCalls(record) {
  const calls = record?.response?.body?.tool_calls;
  return Array.isArray(calls) ? calls : [];
}

function argumentObject(call) {
  const supplied = call?.arguments;
  if (isObject(supplied)) return supplied;
  if (typeof supplied !== "string") return null;
  try {
    const parsed = JSON.parse(supplied);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function requestMessages(record) {
  const messages = record?.request_body?.messages;
  return Array.isArray(messages) ? messages : null;
}

function failedValidationContent(message) {
  if (!isObject(message) || message.role !== "tool") return null;
  try {
    const payload = JSON.parse(String(message.content));
    return isObject(payload) ? payload : null;
  } catch {
    return null;
  }
}

function exchangeShape(calls, validationBlocks, bound) {
  return allTrue(
    calls.length === 2,
    validationBlocks.length === 2,
    calls.every((call) => call.name === "submit_tentative_artifact"),
    new Set(calls.map((call) => call.pcall)).size === 2,
    new Set(calls.map((call) => call.prun)).size === 2,
    bound.map?.size === 2,
  );
}

function firstRejected(first, firstArguments, firstValidation) {
  if (!isObject(first) || !isObject(firstArguments)) return false;
  return allTrue(
    Object.keys(firstArguments).length === 0,
    firstValidation?.status === "failed",
    firstValidation?.reason_code === "invalid_items",
    firstValidation?.call_id === first.call_id,
  );
}

function strictPrefix(firstRequest, secondRequest) {
  return allTrue(
    firstRequest !== null,
    secondRequest !== null,
    secondRequest?.length === firstRequest?.length + 2,
    same(secondRequest?.slice(0, firstRequest?.length), firstRequest),
  );
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function sameJson(left, right) {
  return same(stableValue(left), stableValue(right));
}

function argumentsMatch(left, right) {
  if (typeof left === "string" && typeof right === "string") return left === right;
  const leftArguments = argumentObject({ arguments: left });
  const rightArguments = argumentObject({ arguments: right });
  return allTrue(
    isObject(leftArguments),
    isObject(rightArguments),
    sameJson(leftArguments, rightArguments),
  );
}

function nativeCallId(firstResponseCall, first) {
  return nonBlank(firstResponseCall?.id) ? firstResponseCall.id : first.call_id;
}

function nativeCallMatches(call, first, firstResponseCall) {
  const functionCall = get(call, "function");
  return allTrue(
    get(call, "id") === nativeCallId(firstResponseCall, first),
    get(call, "type") === "function",
    isObject(functionCall),
    get(functionCall, "name") === first.name,
    get(functionCall, "name") === firstResponseCall?.name,
    argumentsMatch(get(functionCall, "arguments"), first.arguments),
    argumentsMatch(get(functionCall, "arguments"), firstResponseCall?.arguments),
  );
}

function appendedAssistantMatches(assistant, first, firstResponseCall) {
  const toolCalls = list(get(assistant, "tool_calls"));
  return allTrue(
    get(assistant, "role") === "assistant",
    typeof get(assistant, "content") === "string",
    toolCalls.length === 1,
    nativeCallMatches(toolCalls[0], first, firstResponseCall),
  );
}

function appendedValidationMatches(toolMessage, failedPayload, first, expectedId) {
  return allTrue(
    get(toolMessage, "role") === "tool",
    get(toolMessage, "tool_call_id") === expectedId,
    get(failedPayload, "type") === "validation_result",
    get(failedPayload, "call_id") === first.call_id,
    get(failedPayload, "status") === "failed",
    get(failedPayload, "reason_code") === "invalid_items",
  );
}

// 第二请求的 assistant tool_calls 必须逐项复述第一轮原生响应：
// id/name/参数结构/数量一致，且关联 tool validation 仍指向同一原生 call。
function appendedNativeResult(appended, first, failedPayload, firstResponseCall) {
  if (!isObject(first)) return false;
  const expectedId = nativeCallId(firstResponseCall, first);
  return allTrue(
    appended.length === 2,
    appendedAssistantMatches(appended[0], first, firstResponseCall),
    appendedValidationMatches(appended[1], failedPayload, first, expectedId),
    !appended.some((message) => get(message, "role") === "user"),
  );
}

function requestCarries(firstRequest, originalBody, findingInstruction) {
  const contents = list(firstRequest).map((message) => text(message?.content)).join("\n");
  return allTrue(
    nonBlank(originalBody),
    contents.includes(originalBody),
    !nonBlank(findingInstruction) || contents.includes(findingInstruction),
    contents.includes("质量修订要求"),
  );
}

function itemHasRevisionBytes(item) {
  if (!isObject(item)) return false;
  return allTrue(
    nonBlank(item.item_id),
    typeof item.title === "string",
    typeof item.body === "string",
    typeof item.rationale === "string",
  );
}

function secondItemsLegal(secondArguments) {
  const items = list(get(secondArguments, "items"));
  return allTrue(items.length > 0, items.every(itemHasRevisionBytes));
}

function callRecordFor(bound, call) {
  if (!call || !bound.map) return null;
  return bound.map.get(call.pcall);
}

function appendedMessages(firstRequest, secondRequest) {
  if (!firstRequest || !secondRequest) return [];
  return secondRequest.slice(firstRequest.length);
}

function validationAt(blocks, index) {
  return Array.isArray(blocks) ? blocks[index] : null;
}

function firstCallOf(record) {
  const calls = responseCalls(record);
  return Array.isArray(calls) ? calls[0] : null;
}

function requestLength(request) {
  return Array.isArray(request) ? request.length : null;
}

// 两次原生调用只按 canonical assistant 顺序定位；返回结果供 artifact 字节核验消费。
export function retryExchangeChecks({ transcript, records, originalBody, findingInstruction }) {
  const calls = assistantCalls(transcript);
  const validationBlocks = validations(transcript);
  const bound = recordByPcall(records);
  const first = calls[0];
  const second = calls[1];
  const firstRecord = callRecordFor(bound, first);
  const secondRecord = callRecordFor(bound, second);
  const firstResponseCall = firstCallOf(firstRecord);
  const secondResponseCall = firstCallOf(secondRecord);
  const firstArguments = argumentObject(firstResponseCall);
  const secondArguments = argumentObject(secondResponseCall);
  const firstRequest = requestMessages(firstRecord);
  const secondRequest = requestMessages(secondRecord);
  const appended = appendedMessages(firstRequest, secondRequest);
  const failedPayload = failedValidationContent(appended[1]);
  const firstValidation = validationAt(validationBlocks, 0);
  const secondValidation = validationAt(validationBlocks, 1);

  return {
    lastLegalResponse: secondRecord,
    secondArguments,
    checks: {
      revision_exchange_has_exactly_two_calls: exchangeShape(calls, validationBlocks, bound),
      first_response_rejected_as_invalid_items:
        firstRejected(first, firstArguments, firstValidation),
      second_request_is_strict_first_prefix: strictPrefix(firstRequest, secondRequest),
      second_request_appends_only_native_result:
        appendedNativeResult(appended, first, failedPayload, firstResponseCall),
      second_response_is_legal_local_revision: allTrue(
        isObject(second),
        isObject(secondArguments),
        secondItemsLegal(secondArguments),
        get(secondResponseCall, "name") === "submit_tentative_artifact",
        get(secondValidation, "status") === "passed",
        get(secondValidation, "call_id") === get(second, "call_id"),
      ),
      second_validation_is_closed: allTrue(
        get(secondValidation, "status") === "passed",
        get(secondValidation, "call_id") === get(second, "call_id"),
      ),
      revision_request_carries_source_bytes_and_findings:
        requestCarries(firstRequest, originalBody, findingInstruction),
    },
    measured: {
      revision_call_count: calls.length,
      revision_pcalls: calls.map((call) => call.pcall),
      revision_pruns: calls.map((call) => call.prun),
      first_reason_code: nullIfUndefined(get(firstValidation, "reason_code")),
      second_status: nullIfUndefined(get(secondValidation, "status")),
      revision_item_ids: list(get(secondArguments, "items")).map((item) => get(item, "item_id")),
      first_request_messages: requestLength(firstRequest),
      second_request_messages: requestLength(secondRequest),
    },
  };
}

function pendingOf(turnResult) {
  return list(turnResult?.adoption_state?.pending);
}

function artifactById(turnResult, artifactId) {
  const found = pendingOf(turnResult).find((artifact) => artifact?.artifact_id === artifactId);
  if (!found) return null;
  return found;
}

// 调用方已用 isObject 关闭缺失项；这里只比较真实 item 的字段字节。
function sameItemBytes(left, right) {
  return allTrue(
    left.item_id === right.item_id,
    left.title === right.title,
    left.body === right.body,
    left.rationale === right.rationale,
  );
}

function selectedFindingRefs(actionPayload) {
  return list(actionPayload?.quality_finding_refs).filter(nonBlank);
}

function sameRefSet(left, right) {
  const leftSet = [...new Set(left)].sort();
  const rightSet = [...new Set(right)].sort();
  return same(leftSet, rightSet);
}

function pendingIdSet(turnResult) {
  return new Set(pendingOf(turnResult).map((artifact) => artifact?.artifact_id).filter(nonBlank));
}

function evidenceSpans(finding) {
  return list(finding?.evidence_spans);
}

const SENTENCE_END = /[。！？!?]/gu;

// 原字节句位：每句从首个非空白字符开始，终止符本身属于该句；
// 句前/句间/句后空白都留在未选片段里，不纳入 selected 区间。
function firstNonSpace(body, start, end) {
  const slice = body.slice(start, end);
  return start + slice.length - slice.trimStart().length;
}

function sentenceBounds(body) {
  const bounds = [];
  let start = 0;
  for (const match of body.matchAll(SENTENCE_END)) {
    const end = match.index + 1;
    bounds.push({ start: firstNonSpace(body, start, end), end });
    start = end;
  }
  const tailStart = firstNonSpace(body, start, body.length);
  const tail = body.slice(tailStart).trimEnd();
  if (tail !== "") {
    bounds.push({ start: tailStart, end: tailStart + tail.length });
  }
  return bounds;
}

function flattenQuote(value) {
  return value.replace(/\s+/gu, "");
}

function spanCoordinates(span) {
  if (!isObject(span) || !nonBlank(span.text)) return null;
  const start = get(span, "sentence_start");
  const end = get(span, "sentence_end");
  // 1-based 越界由 spanBounds 对 bounds 的实际索引统一拒绝。
  const valid = allTrue(Number.isInteger(start), Number.isInteger(end), end >= start);
  return valid ? { start, end, quote: span.text } : null;
}

function spanBounds(coordinates, bounds) {
  const first = bounds[coordinates.start - 1];
  const last = bounds[coordinates.end - 1];
  return allTrue(
    coordinates.end <= bounds.length,
    isObject(first),
    isObject(last),
  )
    ? { first, last }
    : null;
}

function spanInterval(span, body, bounds) {
  const coordinates = spanCoordinates(span);
  if (!coordinates) return null;
  const locatedBounds = spanBounds(coordinates, bounds);
  if (!locatedBounds) return null;
  const located = body.slice(locatedBounds.first.start, locatedBounds.last.end);
  // quote 只校验句位定位到的内容；空白差异来自 producer 的扁平句，不用于定位。
  if (flattenQuote(located) !== flattenQuote(coordinates.quote)) return null;
  return { start: locatedBounds.first.start, end: locatedBounds.last.end };
}

function orderedIntervals(spans, body, bounds) {
  const intervals = [];
  for (const span of list(spans)) {
    const interval = spanInterval(span, body, bounds);
    if (!interval) return null;
    intervals.push(interval);
  }
  if (intervals.length === 0) return null;
  // 合法区间非空；相同 start 必被下方 overlap 拒绝，无需 end tie-breaker。
  intervals.sort((left, right) => left.start - right.start);
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index].start < intervals[index - 1].end) return null;
  }
  return intervals;
}

function unselectedGaps(original, intervals) {
  const gaps = [];
  for (let index = 1; index < intervals.length; index += 1) {
    const start = intervals[index - 1].end;
    const end = intervals[index].start;
    // 相邻区间产生空串；indexOf("") 不移动游标，保留空串无需分支。
    gaps.push(original.slice(start, end));
  }
  return gaps;
}

// 未选片段必须按原字节、原顺序留在修订正文里；句间空白/换行也属于未选字节。
function outsideBytesKept(original, revised, intervals) {
  const first = intervals[0];
  const last = intervals[intervals.length - 1];
  const prefix = original.slice(0, first.start);
  const suffix = original.slice(last.end);
  const selectedLength = intervals.reduce(
    (total, interval) => total + (interval.end - interval.start),
    0,
  );
  if (revised.length <= original.length - selectedLength) return false;
  if (!revised.startsWith(prefix) || !revised.endsWith(suffix)) return false;
  let cursor = prefix.length;
  const limit = revised.length - suffix.length;
  for (const gap of unselectedGaps(original, intervals)) {
    const index = revised.indexOf(gap, cursor);
    if (index < 0 || index + gap.length > limit) return false;
    cursor = index + gap.length;
  }
  // 选中文可保留原句或出现重复句；只要求本次修订确有改动。
  return revised !== original;
}

// 局部修订：按 finding 的完整句位定位原字节区间，只替换命中句段；
// 未选片段（含所有空白与换行）必须逐字节保留。无法证明范围时失败。
export function outsideEvidencePreserved(originalBody, revisedBody, spans) {
  const original = text(originalBody);
  const revised = text(revisedBody);
  const intervals = orderedIntervals(spans, original, sentenceBounds(original));
  if (intervals === null) return false;
  return outsideBytesKept(original, revised, intervals);
}

function referencedRevisionArtifact(childTurnResult) {
  const referenced = getIn(childTurnResult, ["trace_summary", "revision_artifact_ref"]);
  if (!referenced) return null;
  return artifactById(childTurnResult, referenced);
}

function revisionArtifactOf(childTurnResult) {
  return referencedRevisionArtifact(childTurnResult);
}

function siblingTentative(revisionArtifact, sourceArtifactId, childTurnResult) {
  return allTrue(
    isObject(revisionArtifact),
    revisionArtifact?.artifact_type === "prose_fragment",
    revisionArtifact?.adoption_status === "TENTATIVE",
    revisionArtifact?.artifact_id !== sourceArtifactId,
    !pendingIdSet(childTurnResult).has(sourceArtifactId),
  );
}

function provenanceBound({
  childTurnResult,
  actionPayload,
  selectedRefs,
  sourceTurnId,
  sourceArtifactId,
}) {
  if (!isObject(childTurnResult)) return false;
  return allTrue(
    getIn(childTurnResult, ["trace_summary", "revision_base"]) === sourceArtifactId,
    sameRefSet(selectedFindingRefs(actionPayload), selectedRefs),
    sameRefSet(list(getIn(childTurnResult, ["agent_run", "trigger", "quality_finding_refs"])), selectedRefs),
    getIn(childTurnResult, ["agent_run", "trigger", "target_artifact_ref"]) === sourceArtifactId,
    getIn(childTurnResult, ["agent_run", "trigger", "source_turn_ref"]) === sourceTurnId,
  );
}

function uniqueItemsById(items) {
  const ids = list(items).map(itemIdOf);
  return allTrue(
    items.length > 0,
    ids.every(nonBlank),
    new Set(ids).size === ids.length,
  );
}

// 修订 artifact 的完整 item 集合必须与最后合法响应一一绑定；
// 数量/缺项/额外项/重复 ID 任一不成立都失败，不按首项放行。
function artifactItemsMatch(responseItems, revisionArtifact) {
  const revisionItems = artifactItems(revisionArtifact);
  const responses = list(responseItems);
  if (!uniqueItemsById(responses) || !uniqueItemsById(revisionItems)) return false;
  if (revisionItems.length !== responses.length) return false;
  return revisionItems.every((revisionItem) => {
    const matches = responses.filter(
      (responseItem) => itemIdOf(responseItem) === itemIdOf(revisionItem),
    );
    return matches.length === 1 && sameItemBytes(revisionItem, matches[0]);
  });
}

// 原稿保留同样核验完整 item 集合，不能只核首项。
function originalPreserved(sourceOriginal, sourceWireOriginal) {
  const sourceItems = artifactItems(sourceOriginal);
  const originalItems = artifactItems(sourceWireOriginal);
  if (!uniqueItemsById(sourceItems) || !uniqueItemsById(originalItems)) return false;
  if (sourceItems.length !== originalItems.length) return false;
  return allTrue(
    sourceOriginal.adoption_status === "TENTATIVE",
    sourceItems.every((sourceItem) => {
      const matches = originalItems.filter(
        (originalItem) => itemIdOf(originalItem) === itemIdOf(sourceItem),
      );
      return matches.length === 1 && sameItemBytes(sourceItem, matches[0]);
    }),
  );
}

function noAutoDecision(childTurnResult) {
  if (!isObject(childTurnResult)) return false;
  return allTrue(
    getIn(childTurnResult, ["truthfulness", "artifact_adopted"]) !== true,
    getIn(childTurnResult, ["truthfulness", "production_write_performed"]) !== true,
    list(getIn(childTurnResult, ["adoption_state", "resolved"])).length === 0,
  );
}

function actionsTargetRevision(childTurnResult, revisionArtifact) {
  const actions = list(get(childTurnResult, "available_actions"));
  const target = get(revisionArtifact, "artifact_id");
  return allTrue(
    actions.length > 0,
    actions.every((action) => get(action, "target_ref") === target),
  );
}

function artifactItems(artifact) {
  return list(getIn(artifact, ["payload", "items"]));
}

function firstItem(artifact) {
  return artifactItems(artifact)[0];
}

function itemIdOf(item) {
  return get(item, "item_id");
}

function revisionScopeOf(finding) {
  const scope = get(finding, "revision_scope") || get(finding, "impact_scope");
  return text(scope).toLowerCase();
}

function localBytesPreserved(scope, sourceOriginal, revisionArtifact, spans) {
  if (scope !== "local") return true;
  const sourceItems = artifactItems(sourceOriginal);
  const revisionItems = artifactItems(revisionArtifact);
  if (sourceItems.length !== 1 || revisionItems.length !== 1) return false;
  return outsideEvidencePreserved(
    get(sourceItems[0], "body"),
    get(revisionItems[0], "body"),
    spans,
  );
}

function artifactFacts(input) {
  const revisionArtifact = revisionArtifactOf(input.childTurnResult);
  return {
    revisionArtifact,
    revisionItem: firstItem(revisionArtifact),
    responseItems: list(get(input.lastLegalArguments, "items")),
    spans: evidenceSpans(input.sourceFinding),
    scope: revisionScopeOf(input.sourceFinding),
  };
}

function artifactChecksFor(input, facts) {
  return {
    revision_artifact_is_sibling_tentative:
      siblingTentative(facts.revisionArtifact, input.sourceArtifactId, input.childTurnResult),
    revision_provenance_binds_source_and_findings:
      provenanceBound({
        childTurnResult: input.childTurnResult,
        actionPayload: input.actionPayload,
        selectedRefs: input.selectedRefs,
        sourceTurnId: input.sourceTurnId,
        sourceArtifactId: input.sourceArtifactId,
      }),
    artifact_items_match_last_legal_response_bytes:
      artifactItemsMatch(facts.responseItems, facts.revisionArtifact),
    original_artifact_unchanged_and_tentative:
      originalPreserved(input.sourceOriginal, input.sourceWireOriginal),
    out_of_scope_bytes_preserved:
      localBytesPreserved(
        facts.scope,
        input.sourceOriginal,
        facts.revisionArtifact,
        facts.spans,
      ),
    no_auto_adopt_discard_supersede: noAutoDecision(input.childTurnResult),
    revision_actions_target_revision_only:
      actionsTargetRevision(input.childTurnResult, facts.revisionArtifact),
  };
}

function artifactMeasuredFor(input, facts) {
  const sourceItem = firstItem(input.sourceOriginal);
  return {
    source_artifact_id: input.sourceArtifactId,
    revision_artifact_id: nullIfUndefined(get(facts.revisionArtifact, "artifact_id")),
    revision_item_ids: artifactItems(facts.revisionArtifact).map(itemIdOf).filter(nonBlank),
    response_item_ids: facts.responseItems.map(itemIdOf).filter(nonBlank),
    original_body_length: stringLength(get(sourceItem, "body")),
    revision_body_length: stringLength(get(facts.revisionItem, "body")),
    revision_scope: facts.scope || null,
  };
}

export function revisionArtifactChecks(input) {
  const facts = artifactFacts(input);
  return {
    revisionArtifact: facts.revisionArtifact,
    checks: artifactChecksFor(input, facts),
    measured: artifactMeasuredFor(input, facts),
  };
}

function eventTypesAfter(wire, topic, since, eventTypes) {
  return list(wire).filter((record) => {
    if (record?.direction !== "received" || frameEvent(record) !== "agent_event") return false;
    const frame = frameOf(record);
    if (!frame || frame[2] !== topic || record.at < since) return false;
    return eventTypes.has(text(frameBody(record)?.event_type));
  });
}

export function revisionDecisionEvents(wire, topic, since) {
  return eventTypesAfter(
    wire,
    topic,
    since,
    new Set(["artifact_adopted", "artifact_discarded", "artifact_superseded"]),
  );
}

// source 阶段真实 mission_derived 事件：只取 owning topic、接收方向、不早于 source
// 发送且 run_ref 精确等于 source run 的帧；不在本模块猜 mission 内容。
export function sourceMissionEvents(wire, options = {}) {
  const settings = options === null || options === undefined ? {} : options;
  const { topic, since, runId } = settings;
  if (!nonBlank(topic) || typeof since !== "string" || since === "" || !nonBlank(runId)) {
    return [];
  }
  // eventTypesAfter 已要求 frameBody 提供 event_type，因此这里 body 必为对象。
  return eventTypesAfter(wire, topic, since, new Set(["mission_derived"]))
    .filter((record) => frameBody(record).run_ref === runId);
}

function qualityCardVisible(quality) {
  return [
    "质量复核：发现",
    "原句",
    "位置",
    "判断理由",
    "影响范围",
    "置信度",
    REVISION_BUTTON,
  ].every((value) => quality.includes(value));
}

function revisionCandidateVisible(revision) {
  return allTrue(revision.includes("修订稿"), revision.includes("保存修订稿"));
}

// P0-6：作者可见 token 检查唯一实现来自 `author_visible/leak_scan.mjs`（同一 SSOT）。
// 迁移期显式启用已迁移类别（协议 code/内部标识/ref 模式）；internal_terms_zh 待 P1，
// P1 完成后删除 categories 参数恢复默认全开。
function authorSafeTexts(texts) {
  return scanAuthorVisibleTexts(
    list(texts).map((value) => text(value)),
    { categories: AUTHOR_VISIBLE_MIGRATION_CATEGORIES },
  ).ok;
}

export function revisionUiChecks({ qualityVisible, revisionVisible, why, userMessages }) {
  const quality = text(qualityVisible);
  const revision = text(revisionVisible);
  const whyText = text(why);
  return {
    quality_card_shows_evidence_and_scope: qualityCardVisible(quality),
    revision_candidate_visible_independently: revisionCandidateVisible(revision),
    revision_kept_original_action_visible: revision.includes("原稿"),
    author_visible_copy_has_no_internal_protocol_codes:
      authorSafeTexts([quality, revision, whyText]),
    why_panel_is_author_safe:
      whyText.includes("回放只读取已保存记录，不会重新调用模型") &&
      whyText.includes("基于本轮已保存的推理记录生成回放") &&
      authorSafeTexts([whyText]),
    no_second_user_message_after_action: list(userMessages).length === 1,
  };
}

function sourceRunBound(sourceRecord, sourceRunId, sourceUserTurnId) {
  if (!isObject(sourceRecord)) return false;
  return allTrue(
    sourceRecord.id === sourceRunId,
    sourceRecord.profile_ref === SOURCE_PROFILE,
    sourceRecord.status === "completed",
    sourceRecord.parent_turn_ref === sourceUserTurnId,
  );
}

function childRunBound(childRecord, { childRunId, sourceRunId, sourceTurnId, sourceRecord }) {
  if (!isObject(childRecord)) return false;
  return allTrue(
    nonBlank(childRunId),
    childRunId !== sourceRunId,
    childRecord.id === childRunId,
    childRecord.run_mode === "bounded",
    childRecord.profile_ref === REVISION_PROFILE,
    childRecord.status === "completed",
    childRecord.parent_turn_ref === sourceTurnId,
    childRecord.workspace_id === get(sourceRecord, "workspace_id"),
    childRecord.work_id === get(sourceRecord, "work_id"),
    childRecord.session_id === get(sourceRecord, "session_id"),
  );
}

function ackBound(ackResponse, { childRunId, sourceTurnId, receiptId }) {
  if (!isObject(ackResponse)) return false;
  return allTrue(
    ackResponse.received === true,
    ackResponse.run_id === childRunId,
    ackResponse.source_turn_ref === sourceTurnId,
    ackResponse.receipt_id === receiptId,
    ackResponse.action_status !== "failed",
    ackResponse.action_status !== "cancelled",
  );
}

function actionResultBound(actionResult, { childRunId, receiptId, sourceTurnId }) {
  if (!isObject(actionResult)) return false;
  return allTrue(
    actionResult.run_id === childRunId,
    actionResult.receipt_id === receiptId,
    actionResult.source_turn_ref === sourceTurnId,
    actionResult.run_mode === "bounded",
    actionResult.profile_ref === REVISION_PROFILE,
  );
}

function childStateBound(childState, { childRunId, sourceRecord, sourceTurnId, receiptId }) {
  if (!isObject(childState)) return false;
  return allTrue(
    childState.status === "completed",
    childState.run_id === childRunId,
    childState.workspace_id === get(sourceRecord, "workspace_id"),
    childState.work_id === get(sourceRecord, "work_id"),
    childState.session_id === get(sourceRecord, "session_id"),
    childState.parent_turn_ref === sourceTurnId,
    childState.run_mode === "bounded",
    childState.profile_ref === REVISION_PROFILE,
    getIn(childState, ["trigger", "kind"]) === "author_action",
    getIn(childState, ["trigger", "receipt_id"]) === receiptId,
    getIn(childState, ["trigger", "source_turn_ref"]) === sourceTurnId,
  );
}

// 新批次只接受真实 v2 受理回执：run/receipt 身份必须存在且与 row/source/child 一致。
function receiptBound(receiptRow, { receiptId, childRunId, sourceRecord, sourceTurnId }) {
  if (!isObject(receiptRow)) return false;
  const stored = get(receiptRow, "result");
  const receiptResult = isObject(stored) ? stored : {};
  return allTrue(
    nonBlank(receiptId),
    receiptRow.id === receiptId,
    receiptRow.source_turn_ref === sourceTurnId,
    receiptRow.action_type === "revise_from_findings",
    receiptRow.session_id === get(sourceRecord, "session_id"),
    receiptRow.work_id === get(sourceRecord, "work_id"),
    receiptResult.admission_version === 2,
    receiptResult.run_id === childRunId,
    receiptResult.receipt_id === receiptId,
  );
}

function oneWorkTurn({
  childTurnResultsCount,
  childTurnId,
  sourceTurnId,
  sourceUserTurnId,
  childTurnResult,
  childRunId,
  sourceTurnRef,
}) {
  if (!isObject(childTurnResult)) return false;
  return allTrue(
    childTurnResultsCount === 1,
    nonBlank(childTurnId),
    childTurnId !== sourceTurnId,
    childTurnId !== sourceUserTurnId,
    getIn(childTurnResult, ["agent_run", "run_id"]) === childRunId,
    getIn(childTurnResult, ["agent_run", "status"]) === "completed",
    getIn(childTurnResult, ["agent_run", "parent_turn_ref"]) === sourceTurnRef,
  );
}

function childTraceBound(childInteraction, decisionTrace, childTurnResult, childRunId, childTurnId) {
  if (!isObject(childInteraction) || !isObject(decisionTrace)) return false;
  const traceRef = getIn(childTurnResult, ["trace_summary", "trace_ref"]);
  return allTrue(
    childInteraction.agent_run_id === childRunId,
    getIn(childInteraction, ["turn_result", "turn_id"]) === childTurnId,
    getIn(childInteraction, ["turn_result", "trace_summary", "trace_ref"]) === traceRef,
    decisionTrace.trace_id === traceRef,
    decisionTrace.turn_id === childTurnId,
  );
}

export function revisionRunChecks({
  sourceRunId,
  childRunId,
  sourceTurnId,
  childTurnId,
  sourceUserTurnId,
  sourceRecord,
  childRecord,
  childState,
  childTurnResult,
  receiptId,
  receiptRow,
  ackResponse,
  actionResult,
  actionAck,
  childInteraction,
  decisionTrace,
  childTurnResultsCount,
  actionEvents,
}) {
  return {
    source_run_binds_real_generation_ack:
      sourceRunBound(sourceRecord, sourceRunId, sourceUserTurnId),
    child_run_is_new_bounded_revision:
      childRunBound(childRecord, { childRunId, sourceRunId, sourceTurnId, sourceRecord }),
    action_ack_binds_same_join_and_child_run:
      ackBound(ackResponse, { childRunId, sourceTurnId, receiptId }),
    action_result_is_scoped_and_stable:
      actionResultBound(actionResult, { childRunId, receiptId, sourceTurnId }),
    child_state_matches_parent_scope:
      childStateBound(childState, { childRunId, sourceRecord, sourceTurnId, receiptId }),
    receipt_stable_and_persisted:
      receiptBound(receiptRow, { receiptId, childRunId, sourceRecord, sourceTurnId }),
    one_work_turn_per_child_run:
      oneWorkTurn({
        childTurnResultsCount,
        childTurnId,
        sourceTurnId,
        sourceUserTurnId,
        childTurnResult,
        childRunId,
        sourceTurnRef: sourceTurnId,
      }),
    child_result_and_trace_are_committed:
      childTraceBound(childInteraction, decisionTrace, childTurnResult, childRunId, childTurnId),
    no_auto_decision_events: list(actionEvents).length === 0,
    source_and_child_runs_are_distinct: sourceRunId !== childRunId,
    action_ack_is_unique: actionAck?.identity !== undefined,
  };
}

export function replayPathFor({ workId, sessionId, turnId }) {
  return `/api/works/${workId}/sessions/${sessionId}/turns/${encodeURIComponent(turnId)}/replay`;
}

export function revisionWhyChecks({ wire, workId, sessionId, childTurnId, beforeWhy, afterWhy }) {
  const path = replayPathFor({ workId, sessionId, turnId: childTurnId });
  const from = beforeWhy?.at;
  const to = afterWhy?.at;
  const replay = list(wire).some(
    (record) =>
      record?.direction === "http" &&
      record.status === 200 &&
      record.path === path &&
      typeof record.at === "string" &&
      record.at >= from &&
      record.at <= to,
  );
  return { why_uses_scoped_persisted_replay: replay };
}
