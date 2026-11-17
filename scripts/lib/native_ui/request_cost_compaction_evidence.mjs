// R03 预注册批次跨回合证据汇总；只组合现役原始事实 reader / coverage 判据，无 IO。
import { isDeepStrictEqual } from "node:util";
import { wireTerminal } from "./live_run_wait.mjs";
import { canonicalMessagesFromRows } from "./authoring_history_evidence.mjs";
import { auditCanonicalCoverage } from "./authoring_checkpoint_coverage.mjs";
import { evaluateAutoMaintenance } from "./authoring_auto_maintenance_evidence.mjs";
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";
import { canonicalCoverageForProviderCall, scopeForProviderCall } from "./authoring_call_evidence.mjs";

export function evaluatePreregisteredCompaction({ config, source, bindings, records, dbFacts, uiEvidence, wire }) {
  const sessionRuns = dbFacts.agent_runs.filter((run) => run.session_id === config.session_id);
  if (!config.work?.id || sessionRuns.some((run) => run.work_id !== config.work.id))
    throw new Error("preregistered session/work identity mismatch");
  const runIds = new Set(dbFacts.agent_runs.filter((run) => run.session_id === config.session_id).map((run) => run.id));
  const providerRuns = dbFacts.provider_runs.filter((run) => runIds.has(run.agent_run_id));
  const providerIds = new Set(providerRuns.map((run) => run.id));
  const db = {
    ...dbFacts,
    agent_runs: dbFacts.agent_runs.filter((run) => runIds.has(run.id)),
    authoring_session_messages: dbFacts.authoring_session_messages.filter((row) => row.session_id === config.session_id),
    agent_events: dbFacts.agent_events.filter((row) => runIds.has(row.run_id)),
    provider_runs: providerRuns,
    provider_outputs: dbFacts.provider_outputs.filter((row) => providerIds.has(row.provider_run_id)),
    provider_events: dbFacts.provider_events.filter((row) => providerIds.has(row.provider_run_id)),
  };
  const messages = canonicalMessagesFromRows(db.authoring_session_messages, db.agent_runs);
  const textOf = (message) => message.blocks.map((block) => block.text ?? "").join("");
  const pureDiscussion = (message) => message.role === "assistant" && message.provenance === "model" &&
    message.blocks.length > 0 && message.blocks.every((block) => block.type === "text");
  const authors = messages.filter((message) => message.role === "user" && message.provenance === "author");
  const audit = auditCanonicalCoverage(messages, { verifyExecutions: true, verifyRequests: true,
    providerRuns, providerOutputs: db.provider_outputs, providerRecords: records });
  const maintenance = evaluateAutoMaintenance({ config, dbFacts: db, llmRecords: records, checkpoints: {} }).checks;
  const requestChecks = bindings.flatMap((binding) => binding === null ? [{ ok: null, reason: "run_binding_missing" }] :
    binding.records.filter((record) => binding.operations.get(record.provider_call_ref) !== "transcript_compaction")
      .map((record) => {
        const history = { messages: binding.history.sessionMessages };
        const prefix = canonicalCoverageForProviderCall(record, history);
        const facts = requestFactsFromRecord(record);
        const identity = { provider_run_ref: record.provider_run_ref, provider_call_ref: record.provider_call_ref };
        if (!prefix?.ok || !facts.ok) return { ...identity, ok: null, reason: "request_canonical_prefix_missing" };
        const retained = prefix.retainedMessages;
        const authorBytes = isDeepStrictEqual(facts.authorMessages.map((message) => message.text),
          retained.filter((message) => message.role === "user" && message.provenance === "author").map(textOf));
        const scope = !retained.some((message) => message.role === "scope_update") || scopeForProviderCall(record, history) !== null;
        const expectedDiscussions = retained.filter(pureDiscussion).map(textOf);
        const actualDiscussions = facts.messages.filter((message) => message.role === "assistant" && !message.tool_calls?.length)
          .map((message) => message.content);
        const discussionBytes = isDeepStrictEqual(actualDiscussions, expectedDiscussions);
        return { ...identity, ok: authorBytes && scope && discussionBytes,
          author_original_bytes: authorBytes, legal_scope: scope, retained_discussion_bytes: discussionBytes };
      }));
  const byCoordinate = new Map(messages.map((message) =>
    [JSON.stringify([message.canonical_ref.run_id, message.canonical_ref.run_sequence]), message]));
  const sourceAuthor = (message) => messages.slice(0, messages.indexOf(message)).findLast((candidate) =>
    candidate.role === "user" && candidate.provenance === "author" &&
    candidate.canonical_ref.run_id === message.canonical_ref.run_id);
  const sourceAuthorIndex = (message) => {
    const author = sourceAuthor(message), index = authors.indexOf(author);
    return index >= 0 && source.authors[index]?.text === textOf(author) ? index : -1;
  };
  const selected = audit.checkpoints.flatMap((checkpoint) => checkpoint.selected.filter((ref) => ref.role === "assistant"))
    .map((ref) => byCoordinate.get(JSON.stringify([ref.run_id, ref.run_sequence])));
  const sourceFacts = selected.map((message) => ({
    source: message.canonical_ref, bytes: Buffer.byteLength(textOf(message)), codepoints: [...textOf(message)].length,
    author_index: sourceAuthorIndex(message),
  }));
  const requireMaintenance = config.length >= 10;
  const runCompletions = bindings.map((binding) => {
    if (!binding?.root) return { ok: null, reason: "run_binding_missing" };
    const row = binding.root;
    const terminal = wireTerminal(wire, { turnId: row.parent_turn_ref, runId: row.id, runRow: row,
      topic: "workspace:" + row.workspace_id, workId: config.work.id, sessionId: config.session_id });
    return { ok: terminal?.kind === "completed", run_id: row.id, run_status: row.status };
  });
  const checks = {
    author_runs_completed: { ok: runCompletions.some((item) => item.ok === false) ? false :
      runCompletions.length === config.length && runCompletions.every((item) => item.ok === true) ? true : null,
      runs: runCompletions },
    canonical_coverage: { ok: audit.ok, reason: audit.reason },
    all_author_originals: { ok: authors.length === config.length && isDeepStrictEqual(authors.map(textOf), source.authors.slice(0, config.length).map((author) => author.text)) },
    every_request_preserved: { ok: requestChecks.some((item) => item.ok === false) ? false :
      requestChecks.length > 0 && requestChecks.every((item) => item.ok === true) ? true : null, calls: requestChecks },
    pressure: requireMaintenance ? maintenance.C1_real_pressure :
      { ok: maintenance.C1_real_pressure.detail.max_input_tokens > 0 &&
        maintenance.C1_real_pressure.detail.max_input_tokens < maintenance.C1_real_pressure.detail.threshold,
        expectation: "three_turn_low_pressure_control", detail: maintenance.C1_real_pressure.detail },
    next_request: requireMaintenance ? maintenance.C5_next_request_compact :
      { ok: audit.checkpoints.length === 0, expectation: "no_checkpoint_for_three_turn_control" },
    early_discussion_covered: { ok: requireMaintenance ? sourceFacts.some((fact) => fact.author_index >= 0 && fact.author_index < 3) :
      selected.length === 0, sources: sourceFacts },
    original_history_ui: requireMaintenance ? { ok: uiEvidence?.ok ?? null, evidence: uiEvidence } : { ok: true, required: false },
  };
  const obligations = source.authors.slice(0, config.length).flatMap((author, authorIndex) => author.obligations.map((obligation) => {
    const origin = authors[authorIndex] && textOf(authors[authorIndex]) === author.text ? [authors[authorIndex]] : [];
    const excerpts = audit.checkpoints.flatMap((checkpoint) => checkpoint.selected.filter((ref) => ref.role === "assistant")
      .map((ref, index) => ({ source: ref, entry: checkpoint.entries[index] })).filter((item) =>
        origin.includes(sourceAuthor(byCoordinate.get(JSON.stringify([item.source.run_id, item.source.run_sequence]))))));
    return { author_id: author.id, author_sha256: author.sha256, ...obligation, status: "review_required",
      original_sources: origin.map((message) => message.canonical_ref), actual_summary_excerpts: excerpts,
      review_turns: obligation.review_at_turns.filter((turn) => turn <= config.length).map((turn) => ({
        turn, run_id: bindings[turn - 1]?.root.id ?? null, visible_evidence: "request-cost-turn-observation-" + turn + ".json",
      })) };
  }));
  const values = Object.values(checks).map((check) => check.ok);
  return { status: values.includes(false) ? "fail" : values.every((value) => value === true) ? "pass" : "partial",
    signed: false, checks, canonical_checkpoints: audit.checkpoints, obligations,
    semantic_status: "review_required", not_signed: ["obligation_semantics", "visual_highlight", "interleaved_awaiting_author", "cancellation_failure_recovery", "duplicate_delivery"] };
}
