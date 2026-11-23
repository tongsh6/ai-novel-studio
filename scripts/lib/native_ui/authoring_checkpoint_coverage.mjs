// 唯一外部覆盖纯 oracle：来源仅为 canonical 原文、真实执行与同次请求事实。
// 不读 DB/文件，不调用产品 selector/projector；失败保留原始历史，不代签语义完整。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { requestFactsFromRecord, responseRejectionsOf } from "./authoring_request_facts.mjs";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function decodeJson(value, label) {
  coverageAssert(value !== null && value !== undefined, label + "_missing");
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new Error("canonical_coverage: " + label + "_invalid_json"); }
}

const MESSAGE_SELECTOR_FIELDS = ["role", "run_id", "run_sequence", "source_refs", "versions"];
const coordinateKey = (ref) => JSON.stringify([ref?.run_id, ref?.run_sequence]);
const exactJson = (left, right) => {
  try { assert.deepEqual(left, right); return true; } catch { return false; }
};
const messageBlocks = (message) => Array.isArray(message?.blocks) ? message.blocks : [];
const textOf = (message) => messageBlocks(message).map((block) => block.text ?? "").join("");
const isDiscussion = (message) => message?.role === "assistant" && message.provenance === "model" &&
  messageBlocks(message).length > 0 && messageBlocks(message).every((block) =>
    block.type === "text" && typeof block.text === "string");

function coverageAssert(condition, reason) {
  assert(condition, "canonical_coverage: " + reason);
}

function sourceSelector(message) {
  return { run_id: message.canonical_ref.run_id, run_sequence: message.canonical_ref.run_sequence,
    role: message.role, source_refs: message.source_refs ?? [], versions: message.versions ?? {} };
}

function sameScopeOwner(source, owner) {
  return ["workspace_id", "work_id", "session_id"].every((key) =>
    typeof owner?.[key] === "string" && owner[key] !== "" && source?.[key] === owner[key]);
}

function observationLeaves(block) {
  return block.content?.tool === "planned_exploration" && Array.isArray(block.content.observations)
    ? block.content.observations : [block];
}

function refSet(refs) {
  return [...new Set(refs.map((ref) => JSON.stringify(
    typeof ref === "string" ? [ref, null] : [ref.ref, ref.version ?? null],
  )))].sort();
}

function checkSummaryExecution(discussion, owner, prior, options) {
  const runs = (options.providerRuns ?? []).filter((run) => run.id === discussion.provider_run_ref);
  const outputs = (options.providerOutputs ?? []).filter((output) => output.provider_run_id === discussion.provider_run_ref);
  coverageAssert(runs.length === 1 && outputs.length === 1, "discussion_execution_missing_or_ambiguous");
  const run = runs[0], output = outputs[0];
  coverageAssert(run.provider_call_ref === discussion.provider_call_ref && output.provider_call_ref === discussion.provider_call_ref,
    "discussion_provider_pair_mismatch");
  // Checkpoint ownership may transfer at recovery; execution identity never does.
  const origin = prior.filter((message) => message.canonical_ref?.run_id === run.agent_run_id);
  coverageAssert(origin.length > 0 && output.agent_run_id === run.agent_run_id &&
    sameScopeOwner(run, owner) && origin.every((message) =>
      sameScopeOwner(message.canonical_ref, owner) && message.canonical_ref.parent_turn_ref === run.parent_turn_ref),
  "discussion_execution_owner_mismatch");
  const refs = decodeJson(run.owner_refs, "provider owner_refs");
  coverageAssert(run.status === "completed" && run.purpose === "other" &&
    refs.operation === "transcript_compaction", "discussion_execution_not_completed");
  coverageAssert(output.status === "ok" &&
    decodeJson(output.content_summary, "provider content_summary").content_sha256 === discussion.response_sha256,
  "discussion_persisted_hash_mismatch");
}

const V1 = "authoring-discussion-summary/v1", V2 = "authoring-discussion-summary/v2";
function lineFragments(text) {
  return (text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [])
    .map((text, fragment_index) => ({ fragment_index, text }));
}
// This boundary verifies frozen protocol metadata, not full recovery-plan admissibility.
// Coverage/source checks below independently prove request material; product commit owns plan validation.
function requestVersion(run, messages) {
  // SQLite JSON columns can hold TEXT "null" after the private payload is cleared.
  // Decode once before the absence check; malformed/non-null shapes still fail closed.
  const capsule = run.operation_checkpoint === null || run.operation_checkpoint === undefined
    ? null : decodeJson(run.operation_checkpoint, "operation checkpoint");
  if (capsule !== null) {
    coverageAssert(isRecord(capsule) && Number.isInteger(capsule.goal_version) && capsule.goal_version > 0 &&
      isRecord(capsule.plan), "discussion_capsule_invalid");
    const keys = Object.keys(capsule).filter(key => key !== "response_text").sort();
    if (capsule.version === "provider-operation-checkpoint/v1") {
      coverageAssert(exactJson(keys, ["goal_version","plan","version"]), "discussion_capsule_invalid");
      return V1;
    }
    coverageAssert(capsule.version === "provider-operation-checkpoint/v2" &&
      capsule.discussion_protocol_version === V2 &&
      exactJson(keys, ["discussion_protocol_version","goal_version","plan","version"]), "discussion_capsule_invalid");
    return V2;
  }
  const matches = messages.flatMap(message => message.role === "checkpoint" ? messageBlocks(message) : [])
    .map(block => block.discussion).filter(discussion => discussion?.provider_run_ref === run.id &&
      discussion.provider_call_ref === run.provider_call_ref);
  coverageAssert(matches.length === 1, "discussion_frozen_protocol_missing");
  const discussion = matches[0];
  coverageAssert(createHash("sha256").update(discussion.response_text).digest("hex") === discussion.response_sha256,
    "discussion_raw_hash_mismatch");
  const version = decodeJson(discussion.response_text, "discussion raw response").version;
  coverageAssert([V1,V2].includes(version), "discussion_protocol_unsupported");
  return version;
}
function discussionMaterial(record, sources, prior, version) {
  coverageAssert([V1,V2].includes(version), "discussion_protocol_unsupported");
  const declarations = (record.request?.body?.messages ?? []).filter(m => m.role === "system")
    .flatMap(m => typeof m.content === "string" ? [...m.content.matchAll(/output_protocol_version: ([^\s]+)/g)].map(x => x[1]) : []);
  coverageAssert(declarations.length === 1 && declarations[0] === version, "discussion_request_protocol_mismatch");
  const facts = requestFactsFromRecord(record);
  coverageAssert(facts.ok && facts.applicationBases.length === 1 && facts.authorMessages.length === 0,
    "discussion_request_material_boundary_invalid");
  const base = facts.applicationBases[0];
  coverageAssert(facts.messageFacts.every((message) => message.role === "system" || message.index === base.index) &&
    facts.tools.length === 0 && facts.toolCalls.length === 0 && facts.toolResults.length === 0,
  "discussion_request_extra_material");
  coverageAssert(base.text.includes("\n"), "discussion_request_material_missing");
  const material = decodeJson(base.text.slice(base.text.indexOf("\n") + 1), "discussion request material");
  const expected = sources.map(({ message, index }, sourceIndex) => {
    const author = prior.slice(0, index).findLast((candidate) => candidate.role === "user" &&
      candidate.provenance === "author" && candidate.canonical_ref?.run_id === message.canonical_ref.run_id);
    coverageAssert(author && sameScopeOwner(author.canonical_ref, message.canonical_ref) &&
      Array.isArray(author.source_refs) && author.source_refs.length === 1 &&
      typeof author.source_refs[0]?.ref === "string" && author.source_refs[0].ref.trim() !== "",
    "discussion_request_author_unavailable");
    return { source_index: sourceIndex, source: { run_id: message.canonical_ref.run_id,
      run_sequence: message.canonical_ref.run_sequence },
      ...(version === V1 ? { text: textOf(message) } : { fragments: lineFragments(textOf(message)) }),
      author_text: textOf(author) };
  });
  coverageAssert(exactJson(material, { material_kind: "quoted_discussion_sources", sources: expected }),
    "discussion_request_sources_not_canonical_originals");
  return base;
}

function checkSummaryRequest(discussion, sources, prior, records, version) {
  const matches = records.filter((record) => record.provider_run_ref === discussion.provider_run_ref &&
    record.provider_call_ref === discussion.provider_call_ref);
  coverageAssert(matches.length === 1, "discussion_request_missing_or_ambiguous");
  discussionMaterial(matches[0], sources, prior, version);
}

const SOURCE_KEY_PREFIX = "authoring-session-source/v1:";

function discussionRequestOwner(record, run) {
  coverageAssert(isRecord(run) && typeof run.id === "string" && run.id.trim() !== "" &&
    typeof run.provider_call_ref === "string" && run.provider_call_ref.trim() !== "" &&
    record?.provider_run_ref === run.id && record.provider_call_ref === run.provider_call_ref,
  "discussion_request_execution_pair_mismatch");
  coverageAssert(sameScopeOwner(record, run) && typeof run.parent_turn_ref === "string" &&
    run.parent_turn_ref.trim() !== "" && record.turn_id === run.parent_turn_ref,
  "discussion_request_owner_mismatch");
  return discussionOwnerKeys(run);
}
function discussionOwnerKeys(run) {
  const refs = decodeJson(run.owner_refs, "provider owner_refs");
  coverageAssert(isRecord(refs) && refs.operation === "transcript_compaction" && run.purpose === "other" &&
    typeof run.agent_run_id === "string" && run.agent_run_id.trim() !== "" &&
    refs.agent_run_id === run.agent_run_id && refs.parent_turn_ref === run.parent_turn_ref && sameScopeOwner(refs, run),
  "discussion_request_operation_owner_mismatch");
  const keys = refs.discussion_source_keys;
  coverageAssert(Array.isArray(keys) && keys.length > 0 && new Set(keys).size === keys.length,
    "discussion_request_source_keys_missing_or_repeated");
  return keys;
}

function discussionRequestSources(keys, run, messages) {
  coverageAssert(Array.isArray(messages), "discussion_request_history_missing");
  const rejected = responseRejectionsOf(messages);
  coverageAssert(rejected !== null, "response_validation_binding_invalid");
  const currentAuthors = messages.map((message, index) => ({ message, index })).filter(({ message }) =>
    message.role === "user" && message.provenance === "author" && message.canonical_ref?.run_id === run.agent_run_id);
  // 本成本入口每个 root 对应一条冻结输入；多作者回合缺调用时点证据时拒绝猜最后一条。
  coverageAssert(currentAuthors.length === 1 && sameScopeOwner(currentAuthors[0].message.canonical_ref, run) &&
    currentAuthors[0].message.canonical_ref.parent_turn_ref === run.parent_turn_ref,
  "discussion_request_current_turn_missing_or_ambiguous");
  let previousIndex = -1;
  return keys.map((key) => {
    coverageAssert(typeof key === "string" && key.startsWith(SOURCE_KEY_PREFIX), "discussion_request_source_key_invalid");
    const value = decodeJson(key.slice(SOURCE_KEY_PREFIX.length), "discussion source coordinate");
    coverageAssert(Array.isArray(value) && value.length === 5 &&
      exactJson(value.slice(0, 3), [run.workspace_id, run.work_id, run.session_id]) &&
      typeof value[3] === "string" && value[3].trim() !== "" && value[3] !== run.agent_run_id &&
      Number.isSafeInteger(value[4]) && value[4] > 0 && key === SOURCE_KEY_PREFIX + JSON.stringify(value),
    "discussion_request_source_coordinate_invalid");
    const matches = messages.map((message, index) => ({ message, index })).filter(({ message }) =>
      message.canonical_ref?.run_id === value[3] && message.canonical_ref.run_sequence === value[4]);
    coverageAssert(matches.length === 1, "discussion_request_source_unknown_or_ambiguous");
    const source = matches[0];
    coverageAssert(source.index > previousIndex && source.index < currentAuthors[0].index &&
      isDiscussion(source.message) && !rejected.has(source.message) && sameScopeOwner(source.message.canonical_ref, run) &&
      source.message.canonical_ref.run_status === "completed", "discussion_request_source_protected_or_out_of_order");
    previousIndex = source.index;
    return source;
  });
}

// Transport body has no product execution headers. This audits material only;
// caller must independently establish a unique captured HTTP request for the frozen admission.
export function auditDiscussionTransportBody(body, run, messages) {
  try {
    const keys = discussionOwnerKeys(run);
    const sources = discussionRequestSources(keys, run, messages);
    discussionMaterial({request:{body}}, sources, messages, requestVersion(run, messages));
    return {ok:true, sourceCount:sources.length};
  } catch (error) { return {ok:false, reason:error.message, sourceCount:0}; }
}

// 维护来源与是否提交 checkpoint 分开；不以摘要输出、operation 标签或请求自报原文授信。
export function auditDiscussionRequest(record, run, messages) {
  try {
    const keys = discussionRequestOwner(record, run);
    const sources = discussionRequestSources(keys, run, messages);
    const base = discussionMaterial(record, sources, messages, requestVersion(run, messages));
    return { ok: true, reason: null, sourceCount: sources.length, binding: {
      operation: "transcript_compaction", provider_call_ref: run.provider_call_ref, provider_run_ref: run.id,
      messageIndex: base.index, text: base.text,
      sha256: createHash("sha256").update(base.text, "utf8").digest("hex"),
    } };
  } catch (error) {
    return { ok: false, reason: error.message, sourceCount: 0, binding: null };
  }
}
function auditDiscussion(block, selected, owner, prior, options) {
  const sources = selected.filter(({ message }) => isDiscussion(message));
  const discussion = block.discussion;
  if (sources.length === 0) {
    coverageAssert(discussion === undefined || discussion === null, "unexpected_discussion");
    return [];
  }
  coverageAssert(isRecord(discussion) && exactJson(Object.keys(discussion).sort(),
    ["provider_call_ref", "provider_run_ref", "response_sha256", "response_text"]), "discussion_source_invalid");
  coverageAssert(typeof discussion.response_text === "string" && Buffer.byteLength(discussion.response_text) <= 131072 &&
    createHash("sha256").update(discussion.response_text, "utf8").digest("hex") === discussion.response_sha256,
  "discussion_raw_hash_mismatch");
  const response = decodeJson(discussion.response_text, "discussion raw response");
  coverageAssert(exactJson(Object.keys(response).sort(), ["entries", "version"]) &&
    [V1,V2].includes(response.version) &&
    Array.isArray(response.entries) && response.entries.length === sources.length, "discussion_entries_mismatch");
  response.entries.forEach((entry, index) => {
    coverageAssert(isRecord(entry) && exactJson(Object.keys(entry).sort(), [response.version === V1 ? "retained_obligations" : "retained_fragment_indices", "source_index", "summary"]) &&
      entry.source_index === index && typeof entry.summary === "string" && entry.summary.trim() !== "",
    "discussion_entry_invalid");
    if (response.version === V2) {
      const fragments = lineFragments(textOf(sources[index].message));
      const indices = entry.retained_fragment_indices;
      coverageAssert(Array.isArray(indices) && indices.every((value,i) =>
        Number.isInteger(value) && value >= 0 && value < fragments.length &&
        (i === 0 || value > indices[i-1])), "discussion_fragment_indices_invalid");
      const quotes = [];
      indices.forEach((value,i) => {
        if (i > 0 && value === indices[i-1]+1) quotes[quotes.length-1] += fragments[value].text;
        else quotes.push(fragments[value].text);
      });
      entry.retained_obligations = quotes;
      return;
    }
    const quotes = entry.retained_obligations;
    coverageAssert(Array.isArray(quotes) && new Set(quotes).size === quotes.length &&
      quotes.every((quote) => typeof quote === "string" && quote.trim() !== "" &&
        textOf(sources[index].message).includes(quote)), "discussion_obligation_not_original_quote");
  });
  if (options.verifyExecutions) checkSummaryExecution(discussion, owner, prior, options);
  if (options.verifyRequests) checkSummaryRequest(discussion, sources, prior, options.providerRecords ?? [], response.version);
  return response.entries;
}

// 独立机械 oracle：只审 canonical 原文及显式坐标，不调用产品 projector，不把摘要当预期。
// 语义完整性由预注册义务另判；这里的合法引用/哈希绝不代签“没有漏义务”。
export function auditCanonicalCoverage(messages, options = {}) {
  const coveredCalls = new Set(), coveredMessages = new Set(), checkpoints = [];
  try {
    const rejected = responseRejectionsOf(messages, options.run);
    coverageAssert(rejected !== null, "response_validation_binding_invalid");
    messages.forEach((checkpoint, checkpointIndex) => {
      if (checkpoint.role !== "checkpoint") return;
      const prior = messages.slice(0, checkpointIndex);
      const owner = checkpoint.canonical_ref;
      const lastAuthor = prior.findLastIndex((message) => message.role === "user" && message.provenance === "author" &&
        message.canonical_ref?.run_id === owner?.run_id);
      const sourceTurn = (source) => {
        const runId = source.message.canonical_ref?.run_id;
        const before = prior.slice(0, source.index).findLastIndex((row) =>
          row.role === "user" && row.provenance === "author" && row.canonical_ref?.run_id === runId);
        if (before >= 0) return before;
        if (source.message.role !== "scope_update") return null;
        const first = prior.findIndex((row) => row.role === "user" && row.provenance === "author" &&
          row.canonical_ref?.run_id === runId);
        return first >= 0 ? first : null;
      };
      const pastOwnerTurn = (source) => lastAuthor >= 0 && sourceTurn(source) !== null && sourceTurn(source) < lastAuthor;
      const validateAuthor = (index) => {
        const author = index === null || index < 0 ? null : prior[index];
        const identity = author?.canonical_ref, refs = author?.source_refs;
        coverageAssert(identity && Number.isInteger(identity.run_sequence) && identity.run_sequence > 0 &&
          sameScopeOwner(identity, owner) && Array.isArray(refs) && refs.length === 1 &&
          typeof refs[0]?.ref === "string" && refs[0].ref.trim() !== "", "checkpoint_turn_range_unavailable");
      };
      validateAuthor(lastAuthor);
      coverageAssert(owner && Number.isInteger(owner.run_sequence), "checkpoint_coordinate_missing");
      coverageAssert(messageBlocks(checkpoint).length > 0, "checkpoint_selection_missing");
      for (const block of messageBlocks(checkpoint)) {
        coverageAssert(block.type === "checkpoint" && isRecord(block.covers), "checkpoint_selection_missing");
        const covers = block.covers, calls = covers.call_ids, refs = covers.message_refs;
        coverageAssert(Object.keys(covers).every((key) => ["call_ids", "message_refs", "turn_range"].includes(key)) &&
          Array.isArray(calls) && Array.isArray(refs) && calls.length + refs.length > 0, "checkpoint_selection_invalid");
        coverageAssert(calls.every((id) => typeof id === "string" && id.trim() !== "") &&
          new Set(calls).size === calls.length, "checkpoint_call_ids_invalid");
        const selected = refs.map((ref) => {
          coverageAssert(isRecord(ref) && exactJson(Object.keys(ref).sort(), MESSAGE_SELECTOR_FIELDS) &&
            Number.isInteger(ref.run_sequence) && ref.run_sequence > 0 &&
            typeof ref.run_id === "string" && ref.run_id.trim() !== "" &&
            ["scope_update", "assistant"].includes(ref.role) && Array.isArray(ref.source_refs) && isRecord(ref.versions),
          "checkpoint_message_selector_invalid");
          const key = coordinateKey(ref);
          coverageAssert(!coveredMessages.has(key), "checkpoint_message_repeated");
          const matches = prior.map((message, index) => ({ message, index }))
            .filter(({ message }) => coordinateKey(message.canonical_ref) === key);
          coverageAssert(matches.length === 1, "checkpoint_message_unknown_future_or_ambiguous");
          const source = matches[0], identity = source.message.canonical_ref;
          coverageAssert(exactJson(sourceSelector(source.message), ref), "checkpoint_message_evidence_mismatch");
          coverageAssert(sameScopeOwner(identity, owner), "checkpoint_message_scope_mismatch");
          validateAuthor(sourceTurn(source));
          const foreignCompleted = identity.run_id !== owner.run_id && identity.run_status === "completed";
          const replaceableScope = source.message.role === "scope_update" &&
            (identity.run_id === owner.run_id && pastOwnerTurn(source) || foreignCompleted) &&
            prior.slice(source.index + 1).some((message) =>
              message.role === "scope_update" && message.canonical_ref?.run_id === owner.run_id);
          coverageAssert(replaceableScope || (isDiscussion(source.message) && !rejected.has(source.message) && foreignCompleted),
            "checkpoint_protected_message");
          coveredMessages.add(key);
          return source;
        });
        for (const id of calls) {
          coverageAssert(!coveredCalls.has(id), "checkpoint_call_repeated");
          const callBlocks = [], results = [];
          prior.forEach((message, index) => messageBlocks(message).forEach((source) => {
            if (source.call_id !== id) return;
            if (message.role === "assistant" && source.type === "tool_call") callBlocks.push({ message, source, index });
            if (message.role === "tool" && ["observation", "validation_result"].includes(source.type)) results.push({ message, source, index });
          }));
          coverageAssert(callBlocks.length === 1 && results.length === 1 && callBlocks[0].index < results[0].index,
            "covered_exchange_not_closed_exactly_once_before_checkpoint");
          const call = callBlocks[0];
          validateAuthor(sourceTurn(call));
          validateAuthor(sourceTurn(results[0]));
          coverageAssert(sameScopeOwner(call.message.canonical_ref, owner) && sameScopeOwner(results[0].message.canonical_ref, owner) &&
            results[0].message.canonical_ref.run_id === call.message.canonical_ref.run_id &&
            (call.message.canonical_ref.run_id === owner.run_id
              ? pastOwnerTurn(call) && pastOwnerTurn(results[0])
              : call.message.canonical_ref.run_status === "completed") &&
            call.source.name !== "ask_author", "checkpoint_protected_exchange");
          for (const message of prior) {
            const ids = messageBlocks(message).filter((source) =>
              ["tool_call", "observation", "validation_result"].includes(source.type) &&
              typeof source.call_id === "string" && source.call_id.trim() !== "").map((source) => source.call_id);
            coverageAssert(!ids.includes(id) || ids.every((value) => calls.includes(value)), "checkpoint_partial_exchange_group");
          }
          coveredCalls.add(id);
        }
        coverageAssert(Array.isArray(block.omissions) && block.omissions.length > 0, "checkpoint_omissions_missing");
        const payloads = prior.flatMap(messageBlocks).filter((source) =>
          source.type === "observation" && calls.includes(source.call_id)).flatMap(observationLeaves);
        const evidenceRefs = payloads.flatMap((source) => source.source_refs ?? []).concat(
          refs.flatMap((ref) => [...ref.source_refs, { ref: "session_message:" + ref.run_id + ":" + ref.run_sequence, version: 1 }]));
        coverageAssert(exactJson(refSet(evidenceRefs), refSet(block.source_refs ?? [])) &&
          exactJson(Object.assign({}, ...payloads.map((source) => source.versions ?? {})), block.versions ?? {}),
        "checkpoint_evidence_mismatch");
        const entries = auditDiscussion(block, selected, owner, prior, options);
        checkpoints.push({ checkpoint_index: checkpointIndex, canonical_ref: owner, covers,
          selected: selected.map(({ message }) => sourceSelector(message)), entries,
          counts: { tool_exchanges: calls.length,
            scope_updates: selected.filter(({ message }) => message.role === "scope_update").length,
            discussion_messages: selected.filter(({ message }) => isDiscussion(message)).length } });
      }
    });
    const retainedMessages = messages.filter((message) => {
      if (coveredMessages.has(coordinateKey(message.canonical_ref))) return false;
      const ids = messageBlocks(message).filter((block) =>
        ["tool_call", "observation", "validation_result"].includes(block.type) &&
        typeof block.call_id === "string" && block.call_id.trim() !== "").map((block) => block.call_id);
      return ids.length === 0 || !ids.every((id) => coveredCalls.has(id));
    });
    return { ok: true, reason: null, coveredCallIds: [...coveredCalls],
      coveredMessageKeys: [...coveredMessages], checkpoints, retainedMessages };
  } catch (error) {
    return { ok: false, reason: error.message, coveredCallIds: [], coveredMessageKeys: [], checkpoints: [], retainedMessages: messages };
  }
}