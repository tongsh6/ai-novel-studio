// B29 角色候选与 R03 按需取证的纯判据；不读文件/DB、不操作产品。
// 输入来自 native_b29_evidence 的现役 history/call/request 读取 owner。
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assistantCalls, validations, strictPrefix, appendedAssistantMatches } from "./authoring_revision_evidence.mjs";
import { authorBoundary } from "./authoring_g2_evidence.mjs";
import { locatePendingItem, locateScopedButton } from "./authoring_pending_evidence.mjs";
import { judgmentNarrativeSourceBound, r05ReplyMatch, withinViewport } from "./authoring_r05_evidence.mjs";
import { scanAuthorVisibleTexts } from "../author_visible/leak_scan.mjs";
import { observationNextRequestEvidence, scopeForProviderCall } from "./authoring_call_evidence.mjs";
import { AUTHORING_REQUEST_IR, requestFactsFromRecord } from "./authoring_request_facts.mjs";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const list = (value) => Array.isArray(value) ? value : [];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const SEGMENTER = new Intl.Segmenter("zh", { granularity: "grapheme" });
const graphemes = (value) => Array.from(SEGMENTER.segment(value), (part) => part.segment);
const DETAIL_FIELDS = ["character_ref", "name", "aliases", "role", "narrative_role", "status", "updated_at", "base_fingerprint"];

// ── B29：状态链读取 ──────────────────────────────────────────────────────────
const rolePairs = (facts) => (facts?.characters ?? []).map((row) => [row.id, row.narrative_role]);
export const rolesEqual = (a, b) => same(rolePairs(a), rolePairs(b));
export const zeroWriteBetween = (before, after) =>
  rolesEqual(before, after) &&
  before.character_count === after.character_count &&
  before.memory_count === after.memory_count;

export function stateChecks(before, after, plan) {
  const afterById = new Map((after?.characters ?? []).map((row) => [row.id, row]));
  const targetId = String(plan?.character_ref ?? "").replace(/^character:/, "");
  return {
    target_character_id_present: afterById.has(targetId),
    narrative_role_updated_to_new: afterById.get(targetId)?.narrative_role === plan?.new_value,
    character_count_unchanged: before.characters.length === after.characters.length,
    character_id_set_unchanged:
      same(before.characters.map((row) => row.id).sort(), after.characters.map((row) => row.id).sort()),
    other_characters_unchanged: before.characters
      .filter((row) => row.id !== targetId)
      .every((row) => {
        const next = afterById.get(row.id);
        return (
          next &&
          next.narrative_role === row.narrative_role &&
          next.name === row.name &&
          same(next.aliases, row.aliases)
        );
      }),
    no_new_character: after.characters.length === before.characters.length,
    no_new_memory: after.memories.length === before.memories.length,
  };
}

function currentAuthorBoundary({ nodes, message, baselineAuthorCount, workTitle } = {}) {
  if (!Array.isArray(nodes) || !nonBlank(message) || !nonBlank(workTitle) ||
      !Number.isInteger(baselineAuthorCount) || baselineAuthorCount < 0 ||
      nodes.some((node) => !/^\d+(?:\/\d+)*$/u.test(node?.path ?? "")) ||
      new Set(nodes.map((node) => node.path)).size !== nodes.length) return null;
  const works = nodes.filter((node) => node.role === "AXPopUpButton" && node.desc === "作品");
  if (works.length !== 1 || works[0].title !== workTitle) return null;
  const boundary = authorBoundary(nodes, message, baselineAuthorCount);
  if (!boundary.author || boundary.authors.length !== baselineAuthorCount + 1 ||
      boundary.nextAuthor !== null) return null;
  return boundary;
}

export function b29RoleNoChangeVisible({ turnResult, nativeView, visibleText, replyText, tokens } = {}) {
  const cards = turnResult?.ui_cards, pending = turnResult?.adoption_state?.pending;
  const reply = turnResult?.assistant_message?.text;
  if (!Array.isArray(cards) || cards.length !== 1 || !Array.isArray(pending) || pending.length !== 0 ||
      !Array.isArray(turnResult?.actions) || turnResult.actions.length !== 0 || !nonBlank(reply)) return false;
  const card = cards[0];
  if (card.card_type !== "result_card" || card.title !== "系统核对结果" ||
      !Array.isArray(card.actions) || card.actions.length !== 0 || !nonBlank(card.body) ||
      !["沈砚", "老沈", "灯楼查账人", "主角", "本次无需修改", "角色档案未发生变更"].every((part) => card.body.includes(part)) ||
      !isObject(tokens) || !scanAuthorVisibleTexts([card.title, card.body], { tokens }).ok) return false;
  if (nativeView) {
    const match = r05ReplyMatch({ reply, ...nativeView });
    return b29NativeItemVisible({ nativeView, title: card.title, body: card.body }) && match.ok &&
      match.surface.leaves.every((node) => withinViewport(nativeView.nodes, node));
  }
  const normalize = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
  return nonBlank(visibleText) && normalize(visibleText).includes(normalize(card.title + " " + card.body)) &&
    nonBlank(replyText) && normalize(replyText) === normalize(reply);
}

export function b29NativeItemVisible({ nativeView, title, body, artifact, knownArtifacts, actionLabel = null } = {}) {
  const boundary = currentAuthorBoundary(nativeView);
  if (!boundary) return false;
  const nodes = nativeView.nodes;
  const target = { itemTitle: title, itemBody: body, artifact, knownArtifacts, authorBoundary: boundary };
  const item = locatePendingItem(nodes, target);
  if (!item.ok) return false;
  for (const value of [title, body]) {
    const leaves = nodes.filter((node) => node.role === "AXStaticText" && node.value === value &&
      node.path.startsWith(item.scope.path + "/"));
    if (leaves.length !== 1 || !withinViewport(nativeView.nodes, leaves[0])) return false;
  }
  if (actionLabel === null) return true;
  const action = locateScopedButton(nodes, { ...target, label: actionLabel });
  return action.ok && withinViewport(nativeView.nodes, action.button);
}

// B29 的作者可见目标独立于内部枚举；同次实际 item 仅用于交付文字绑定。
export function b29RoleCandidateVisible({ candidate, knownArtifacts, visibleText, tokens, nativeView } = {}) {
  const items = list(candidate?.payload?.items);
  if (items.length !== 1 || !isObject(tokens)) return false;
  const { title, body, rationale = "" } = items[0];
  if (![title, body].every(nonBlank) || (nativeView === undefined && !nonBlank(visibleText))) return false;
  const normalize = (value) => value.replace(/\s+/gu, " ").trim();
  return ["沈砚", "老沈", "灯楼查账人", "叙事身份修订"].every((value) => title.includes(value)) &&
    body.includes("群像视角 → 主角") && body.includes("候选尚未采纳") &&
    body.includes("角色档案尚未修改") &&
    scanAuthorVisibleTexts([title, body, rationale], { tokens }).ok &&
    (nativeView === undefined ? normalize(visibleText).includes(normalize(title + " " + body)) :
      b29NativeItemVisible({ nativeView, title, body, artifact: candidate, knownArtifacts, actionLabel: "保存到作品" }));
}

export function candidateFacts(adoption) {
  const payload = adoption?.pending_payload ?? {};
  const changes = payload.changes ?? [];
  const receipt = adoption?.action_result ?? {};
  return {
    object_kind: payload.object_kind ?? null,
    character_ref: payload.character_ref ?? null,
    character_name: payload.character_name ?? null,
    base_fingerprint: payload.base_fingerprint ?? null,
    changes,
    change_count: changes.length,
    field: changes[0]?.field ?? null,
    old_value: changes[0]?.old ?? null,
    new_value: changes[0]?.new ?? null,
    effects: payload.effects ?? [],
    other_character_changes: payload.other_character_changes ?? [],
    suggested_other_character_changes: payload.suggested_other_character_changes ?? [],
    adoption_effect: payload.adoption_effect ?? null,
    receipt_committed_changes: receipt.committed_changes ?? null,
    receipt_character_ref: receipt.character_ref ?? null,
    receipt_base_fingerprint: receipt.base_fingerprint ?? null,
    receipt_current_fingerprint: receipt.current_fingerprint ?? null,
    receipt_adoption_effect: receipt.adoption_effect ?? null,
    receipt_duplicate: receipt.duplicate ?? null,
  };
}

export function candidateChecks(plan, expected) {
  return {
    ref_matches: plan.character_ref === expected.character_ref,
    object_and_old_to_new: plan.object_kind === "character_profile_revision" && plan.character_name === expected.name &&
      plan.field === "narrative_role" && plan.old_value === expected.old &&
      plan.new_value === expected.new,
    effects_exact: same(plan.effects, ["character_field_update"]) &&
      Array.isArray(plan.other_character_changes) && plan.other_character_changes.length === 0 &&
      plan.adoption_effect?.mode === "character_field_update" &&
      plan.adoption_effect?.character_ref === expected.character_ref,
  };
}

// SQLite utc_datetime_usec 保留六位微秒；不经 JS Date 丢掉后三位。
// Ecto DateTime.to_iso8601 对同一持久值输出 T 分隔及 Z。
function sourceTimestamp(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\.\d{6}Z?$/.test(value)) return null;
  const iso = value.replace(" ", "T").replace(/Z?$/, "Z");
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function characterSourceFingerprint(source) {
  if (!isObject(source) || !nonBlank(source.id) || !nonBlank(source.name) ||
      !Array.isArray(source.aliases) || !source.aliases.every((item) => typeof item === "string")) return null;
  const timestamp = sourceTimestamp(source.updated_at);
  if (timestamp === null) return null;
  const values = [source.id, source.name, source.aliases.join(","), source.narrative_role,
    source.role, source.summary, source.status, timestamp];
  if (!values.every((value) => value === null || typeof value === "string")) return null;
  return createHash("sha256").update(values.map((value) => value ?? "").join("|"), "utf8").digest("hex");
}

function sourceFor(before, workId, id) {
  if (before?.work_id !== workId) return null;
  const rows = list(before.characters).filter((row) => row?.id === id);
  return rows.length === 1 && rows[0].status === "ACCEPTED" ? rows[0] : null;
}

function archiveQuery(query) {
  if (query === "characters") return { facet: "characters", offset: 0 };
  try {
    const parsed = JSON.parse(query);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function archiveObservations(messages, kind, workId, ref) {
  return list(messages).flatMap((message, messageIndex) => {
    if (message?.role !== "tool" || message.provenance !== "tool_result") return [];
    return list(message.blocks).filter((parent) => parent.type === "observation" && parent.status === "ok" &&
      parent.content?.tool === "archive_read" && parent.coverage?.kind === kind &&
      parent.coverage?.facet === "characters" && parent.coverage?.work_id === workId &&
      list(parent.source_refs).includes(ref)).map((parent) => ({ parent, messageIndex }));
  });
}

function uniqueObservation(messages, kind, workId, ref) {
  const matches = archiveObservations(messages, kind, workId, ref);
  return matches.length === 1 ? matches[0] : null;
}

function observationCall(messages, observed, { ref, detail }) {
  if (!observed) return null;
  const calls = assistantCalls({ messages }).filter((call) => call.call_id === observed.parent.call_id &&
    call.messageIndex < observed.messageIndex && call.name === "judgment_decision");
  if (calls.length !== 1) return null;
  const call = calls[0];
  const args = call.arguments;
  const query = archiveQuery(args?.explore_request?.query);
  if (args?.action !== "explore" || args.explore_request?.tool !== "archive_read" ||
      query?.facet !== "characters" || observed.parent.content.query !== args.explore_request.query) return null;
  if (detail ? query.ref !== ref || (query.offset ?? 0) !== 0 : query.ref != null) return null;
  return call;
}

function detailMatchesSource(observed, source, fingerprint, ref) {
  if (!observed || !source || fingerprint === null) return false;
  const { parent } = observed;
  const fact = parent.content?.facts?.character;
  const expected = { character_ref: ref, name: source.name, aliases: source.aliases, role: source.role,
    narrative_role: source.narrative_role, status: source.status,
    updated_at: sourceTimestamp(source.updated_at), base_fingerprint: fingerprint };
  if (!isDeepStrictEqual(fact, expected) || parent.coverage.ref !== ref ||
      !isDeepStrictEqual([...list(parent.coverage.complete_fields)].sort(), [...DETAIL_FIELDS].sort()) ||
      !isDeepStrictEqual(parent.versions, { [ref]: fingerprint })) return false;
  const chars = graphemes(source.summary ?? "");
  const range = parent.coverage.summary;
  if (!isObject(range) || range.offset_unit !== "unicode_grapheme" || range.offset !== 0 ||
      range.total_graphemes !== chars.length || !Number.isInteger(range.returned_graphemes) ||
      range.returned_graphemes < 0 || range.returned_graphemes > chars.length) return false;
  const end = range.returned_graphemes;
  return parent.content.summary === chars.slice(0, end).join("") &&
    (end < chars.length
      ? parent.next_offset === end && end > 0 && list(parent.omissions).length > 0
      : parent.next_offset === null);
}

function matchingRecord(records, call) {
  const matches = list(records).filter((record) => record.provider_call_ref === call?.pcall &&
    record.provider_run_ref === call?.prun);
  return matches.length === 1 ? matches[0] : null;
}

function observationInRequest(record, parent) {
  const facts = requestFactsFromRecord(record);
  if (!facts.ok || !parent) return false;
  const matches = facts.toolResults.filter((result) => result.callId === parent.call_id);
  return matches.length === 1 && matches[0].toolCallId === parent.call_id &&
    isDeepStrictEqual(matches[0].payload, parent);
}

function initialMaterialsMinimal(records, starts, before) {
  const first = list(starts)[0];
  const record = matchingRecord(records, { pcall: first?.provider_call_ref, prun: first?.provider_run_id });
  const facts = requestFactsFromRecord(record);
  if (!facts.ok || facts.scopeMessages.length === 0 || !Array.isArray(facts.refs?.base_refs)) return false;
  if (facts.refs.base_refs.some((item) => String(item.ref).startsWith("character:"))) return false;
  const application = facts.applicationMessages.map((message) => message.text).join("\n");
  const hidden = list(before?.characters).flatMap((source) =>
    ["character:" + source.id, source.summary].filter(nonBlank));
  if (hidden.some((value) => application.includes(value))) return false;
  return facts.scopeMessages.every(({ scopeContent }) => {
    const supplied = scopeContent?.facts;
    const operation = scopeContent?.operation;
    return isObject(supplied) && !Object.hasOwn(supplied, "characters") &&
      !Object.hasOwn(supplied, "chapters") && !Object.hasOwn(scopeContent?.goal ?? {}, "text") &&
      !Object.hasOwn(operation ?? {}, "chapter_revision_targets") &&
      Array.isArray(operation?.available_operations) && operation.available_operations.every(nonBlank);
  });
}

function failedCallCarriedForward({ call, next, failure, messages, records, starts }) {
  const source = matchingRecord(records, call), successor = matchingRecord(records, next);
  const first = requestFactsFromRecord(source), second = requestFactsFromRecord(successor);
  if (!first.ok || !second.ok || !strictPrefix(first.messages, second.messages)) return false;
  const start = list(starts).findIndex((entry) =>
    entry.provider_call_ref === call.pcall && entry.provider_run_id === call.prun);
  if (start < 0 || starts[start + 1]?.provider_call_ref !== next?.pcall ||
      starts[start + 1]?.provider_run_id !== next?.prun) return false;
  const appended = second.messageFacts.slice(first.messages.length);
  const responseCalls = list(source?.response?.body?.tool_calls);
  const sourceText = source?.response?.body?.content ?? "";
  if (typeof sourceText !== "string" || appended[0]?.text !== sourceText) return false;
  if (responseCalls.length !== 1 ||
      !appendedAssistantMatches(appended[0], call, responseCalls[0], second.format)) return false;
  const result = appended[1]?.toolResults;
  const payload = messages[failure.messageIndex]?.blocks?.[failure.blockIndex];
  return appended[1]?.role === "tool" && result?.length === 1 &&
    result[0].callId === call.call_id &&
    (second.format === AUTHORING_REQUEST_IR || result[0].toolCallId === (responseCalls[0].id || call.call_id)) &&
    isDeepStrictEqual(result[0].payload, payload);
}

export function characterReadCandidateEvidence({
  before, after, sourceCharacterId, workId, messages, records, starts, candidate, runId, reply, judgmentSource,
} = {}) {
  const source = sourceFor(before, workId, sourceCharacterId);
  const ref = "character:" + sourceCharacterId;
  const fingerprint = characterSourceFingerprint(source);
  const directory = uniqueObservation(messages, "directory", workId, ref);
  const detail = uniqueObservation(messages, "detail", workId, ref);
  const directoryCall = observationCall(messages, directory, { ref, detail: false });
  const detailCall = observationCall(messages, detail, { ref, detail: true });
  const directorySupply = directory
    ? observationNextRequestEvidence({ messages, records, starts, ...directory }) : null;
  const detailSupply = detail
    ? observationNextRequestEvidence({ messages, records, starts, ...detail }) : null;
  const calls = assistantCalls({ messages }), results = validations({ messages });
  const attempts = calls.filter((call) => call.name === "judgment_decision" && call.arguments?.action === "execute");
  const resultsOf = (call) => results.filter((result) => result.call_id === call.call_id);
  const passed = attempts.filter((call) => {
    const owned = resultsOf(call);
    return owned.length === 1 && owned[0].status === "passed" && owned[0].reason_code === "judgment_validated";
  });
  const accepted = passed.length === 1 && passed[0].arguments?.capability === "revise_character_profile"
    ? passed[0] : null;
  const closedInOrder = results.every((result) =>
    messages[result.messageIndex]?.provenance === "tool_result" &&
    calls.some((call) => call.call_id === result.call_id)) && calls.every((call) => {
    const owned = resultsOf(call), next = calls[calls.indexOf(call) + 1];
    if (call === accepted) return call === calls.at(-1) && owned[0].messageIndex > call.messageIndex;
    if (owned.length === 0) return !attempts.includes(call);
    return owned.length === 1 && owned[0].status === "failed" && nonBlank(owned[0].reason_code) && next !== undefined &&
      owned[0].messageIndex > call.messageIndex && owned[0].messageIndex < next.messageIndex &&
      failedCallCarriedForward({ call, next, failure: owned[0], messages, records, starts });
  });
  const execution = closedInOrder && new Set(calls.map((call) => call.call_id)).size === calls.length
    ? accepted : null;
  const executionRecord = matchingRecord(records, execution);
  const sourceCalls = assistantCalls({ messages: [judgmentSource?.output] });
  const sourceCall = sourceCalls[0];
  // passed 只闭合判断协议；候选资格还须由同一次实际接受及完整原文来源证明。
  const sourceBound = execution !== null && sourceCalls.length === 1 &&
    sourceCall.call_id === execution.call_id && sourceCall.name === execution.name &&
    isDeepStrictEqual(sourceCall.arguments, execution.arguments) &&
    judgmentSource?.event?.payload?.capability === execution.arguments.capability &&
    judgmentNarrativeSourceBound(judgmentSource, executionRecord, runId, reply, "execute");
  const plan = candidateFacts({ pending_payload: candidate?.payload });
  const target = candidateChecks(plan, { character_ref: ref, name: source?.name,
    old: source?.narrative_role, new: "PROTAGONIST" });
  const checks = {
    source_exact: source !== null && fingerprint !== null,
    initial_materials_minimal: initialMaterialsMinimal(records, starts, before),
    directory_discovered: directoryCall !== null && directory?.parent.versions?.[ref] === fingerprint,
    detail_observed: detailCall !== null,
    directory_precedes_detail: directory !== null && detail !== null &&
      directory.messageIndex < detailCall?.messageIndex,
    directory_in_next_request: directorySupply?.reason === null,
    detail_matches_source: detailMatchesSource(detail, source, fingerprint, ref),
    detail_in_next_request: detailSupply?.reason === null,
    model_execute_matches_source: sourceBound && execution.arguments.character_ref === ref &&
      execution.messageIndex > detail?.messageIndex &&
      observationInRequest(executionRecord, detail?.parent),
    actual_scope_provenance: list(records).length > 0 &&
      records.every((record) => scopeForProviderCall(record, { messages }) !== null),
    candidate_pending: candidate?.artifact_type === "character_profile_revision" &&
      candidate?.adoption_status === "TENTATIVE" && nonBlank(candidate?.artifact_id),
    candidate_matches_observed_source: target.ref_matches && plan.base_fingerprint === fingerprint,
    candidate_old_to_new_exact: target.object_and_old_to_new && plan.change_count === 1,
    candidate_effects_exact: target.effects_exact,
    authoritative_facts_unchanged: isObject(before) && isDeepStrictEqual(before, after),
  };
  return {
    ok: Object.values(checks).every((value) => value === true), checks,
    measured: { character_ref: ref, source_fingerprint: fingerprint, candidate_ref: candidate?.artifact_id ?? null,
      directory: directorySupply, detail: detailSupply, execute_provider_call_ref: execution?.pcall ?? null },
  };
}
