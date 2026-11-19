// B29 角色候选与 R03 按需取证的纯判据；不读文件/DB、不操作产品。
// 输入来自 native_b29_evidence 的现役 history/call/request 读取 owner。
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assistantCalls } from "./authoring_revision_evidence.mjs";
import { observationNextRequestEvidence, scopeForProviderCall } from "./authoring_call_evidence.mjs";
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";

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

export function characterReadCandidateEvidence({
  before, after, sourceCharacterId, workId, messages, records, starts, candidate,
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
  const executions = assistantCalls({ messages }).filter((call) =>
    call.name === "judgment_decision" && call.arguments?.action === "execute" &&
    call.arguments?.capability === "revise_character_profile");
  const execution = executions.length === 1 ? executions[0] : null;
  const executionRecord = matchingRecord(records, execution);
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
    model_execute_matches_source: execution !== null && execution.arguments.character_ref === ref &&
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
