// R03 预注册批次跨回合证据汇总；只组合现役原始事实 reader / coverage 判据，无 IO。
import { isDeepStrictEqual } from "node:util";
import { wireTerminal } from "./live_run_wait.mjs";
import { canonicalMessagesFromRows } from "./authoring_history_evidence.mjs";
import { auditCanonicalCoverage } from "./authoring_checkpoint_coverage.mjs";
import { evaluateAutoMaintenance } from "./authoring_auto_maintenance_evidence.mjs";
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";
import { canonicalCoverageForProviderCall, scopeForProviderCall } from "./authoring_call_evidence.mjs";

const decode = value => typeof value === "string" ? JSON.parse(value) : value;
const text = message => message.blocks.map(block => block.text ?? "").join("");
const requireFact = (condition, reason) => { if (!condition) throw new Error(reason); };
const cpKey = row => JSON.stringify([row.run_id, row.run_sequence]);

export function auditSubjectWindowBoundary({ config, source, dbFacts }) {
  try {
    const runs = dbFacts.agent_runs.filter(run => run.session_id === config.session_id);
    requireFact(runs.every(run => run.work_id === config.work.id), "subject_scope_mismatch");
    const rows = dbFacts.authoring_session_messages.filter(row => row.session_id === config.session_id);
    const messages = canonicalMessagesFromRows(rows, runs);
    const authors = messages.filter(message => message.role === "user" && message.provenance === "author");
    requireFact(authors.length === config.length && isDeepStrictEqual(authors.map(text),
      source.authors.slice(0, config.length).map(author => author.text)), "subject_author_boundary_mismatch");
    const rootIds = authors.map(author => author.canonical_ref.run_id);
    requireFact(new Set(rootIds).size === config.length, "subject_root_ambiguous");
    const roots = rootIds.map(id => runs.filter(run => run.id === id));
    requireFact(roots.every(found => found.length === 1 && found[0].status === "completed"), "subject_root_not_completed");
    const turns = new Set(roots.map(found => found[0].parent_turn_ref));
    const subject = runs.filter(run => turns.has(run.parent_turn_ref));
    requireFact(subject.every(run => ["completed","failed","cancelled"].includes(run.status)), "subject_run_not_terminal");
    const ids = new Set(subject.map(run => run.id));
    const maintenance = dbFacts.provider_runs.filter(run => ids.has(run.agent_run_id) &&
      decode(run.owner_refs)?.operation === "transcript_compaction");
    const checkpoints = rows.filter(row => ids.has(row.run_id) && row.role === "checkpoint");
    const events = dbFacts.agent_events.filter(event => ids.has(event.run_id) && event.event_type === "checkpoint_created");
    for (const id of ids) {
      const cp = checkpoints.filter(row => row.run_id === id), ev = events.filter(row => row.run_id === id);
      requireFact(cp.length === ev.length && new Set(ev.map(row => row.sequence)).size === ev.length,
        "subject_checkpoint_event_boundary_mismatch");
    }
    const discussions = checkpoints.flatMap(row => decode(row.message).blocks.map(block => block.discussion).filter(Boolean));
    for (const run of maintenance) {
      requireFact(["completed","failed","cancelled"].includes(run.status), "subject_maintenance_not_terminal");
      const outputs = dbFacts.provider_outputs.filter(output => output.provider_run_id === run.id);
      requireFact(outputs.length === 1 && outputs[0].provider_call_ref === run.provider_call_ref &&
        outputs[0].agent_run_id === run.agent_run_id, "subject_maintenance_output_missing");
      requireFact(decode(run.operation_checkpoint ?? null) === null, "subject_accepted_response_unresolved");
      const commits = discussions.filter(d => d.provider_run_ref === run.id && d.provider_call_ref === run.provider_call_ref);
      if (outputs[0].status === "ok") requireFact(run.status === "completed" && commits.length === 1 &&
        commits[0].response_sha256 === decode(outputs[0].content_summary)?.content_sha256, "subject_accepted_response_not_committed");
      else requireFact(outputs[0].status === "error" && commits.length === 0, "subject_output_state_conflict");
    }
    return { ok: true, reason: null, subject_run_ids: [...ids], subject_root_ids: rootIds,
      checkpoint_keys: checkpoints.map(cpKey), maintenance_run_ids: maintenance.map(run => run.id) };
  } catch (error) { return { ok: null, reason: error.message }; }
}

function auditSuccessorWindow({ config, source, db, messages, bindings, successorBinding, windowBoundary, wire }) {
  if (!windowBoundary?.dbFacts) return { ok: null, reason: "subject_boundary_snapshot_missing" };
  const boundary = auditSubjectWindowBoundary({ config, source, dbFacts: windowBoundary.dbFacts });
  if (boundary.ok !== true) return boundary;
  try {
    const ids = new Set(boundary.subject_run_ids);
    requireFact(isDeepStrictEqual(bindings.map(b => b?.root?.id), boundary.subject_root_ids), "subject_binding_boundary_mismatch");
    const sameRows = (table, select) => isDeepStrictEqual(windowBoundary.dbFacts[table].filter(select), db[table].filter(select));
    requireFact(sameRows("agent_runs", run => ids.has(run.id)), "subject_run_changed_after_boundary");
    requireFact(sameRows("authoring_session_messages", row => ids.has(row.run_id)), "subject_late_canonical_after_boundary");
    requireFact(sameRows("agent_events", row => ids.has(row.run_id) && row.event_type === "checkpoint_created"),
      "subject_late_checkpoint_after_boundary");
    requireFact(sameRows("provider_runs", run => ids.has(run.agent_run_id) &&
      decode(run.owner_refs)?.operation === "transcript_compaction"), "subject_late_maintenance_after_boundary");
    requireFact(sameRows("provider_outputs", row => boundary.maintenance_run_ids.includes(row.provider_run_id)),
      "subject_maintenance_output_changed_after_boundary");
    const turns = new Set(windowBoundary.dbFacts.agent_runs.filter(run => ids.has(run.id)).map(run => run.parent_turn_ref));
    requireFact(isDeepStrictEqual(db.agent_runs.filter(run => turns.has(run.parent_turn_ref)).map(run => run.id),
      boundary.subject_run_ids), "subject_late_run_after_boundary");
    const authors = messages.filter(message => message.role === "user" && message.provenance === "author");
    requireFact(authors.length === config.length + 1, "successor_author_count_mismatch");
    const author = authors.at(-1), root = successorBinding?.root;
    requireFact(source.successorAuthor && text(author) === source.successorAuthor.text &&
      root && root.id === author.canonical_ref.run_id && !ids.has(root.id) &&
      root.parent_turn_ref === author.canonical_ref.parent_turn_ref && root.work_id === config.work.id &&
      root.session_id === config.session_id, "successor_identity_mismatch");
    const sent = wire.filter(record => record.direction === "sent" && record.frame?.[3] === "user_message" &&
      record.frame?.[4]?.turn_id === root.parent_turn_ref);
    const at = Date.parse(windowBoundary.captured_at);
    requireFact(Number.isFinite(at) && sent.length === 1 && Date.parse(sent[0].at) > at &&
      sent[0].frame[2] === "workspace:" + root.workspace_id &&
      sent[0].frame[4].text === source.successorAuthor.text, "successor_not_after_boundary");
    requireFact(windowBoundary.dbFacts.agent_events.filter(event => ids.has(event.run_id) &&
      event.event_type === "checkpoint_created").every(event => Number.isFinite(Date.parse(event.inserted_at)) &&
      Date.parse(event.inserted_at) <= at), "subject_commit_after_boundary");
    requireFact(!messages.filter(message => message.role === "checkpoint" &&
      !ids.has(message.canonical_ref.run_id)).some(message => message.blocks.some(block =>
      boundary.maintenance_run_ids.includes(block.discussion?.provider_run_ref))),
    "subject_response_committed_by_late_receiver");
    const terminal = wireTerminal(wire, { turnId: root.parent_turn_ref, runId: root.id, runRow: root,
      topic: "workspace:" + root.workspace_id, workId: config.work.id, sessionId: config.session_id });
    requireFact(terminal?.kind === "completed", "successor_not_completed");
    return { ...boundary, successor_run_id: root.id };
  } catch (error) { return { ...boundary, ok: null, reason: error.message }; }
}

export function evaluatePreregisteredCompaction({ config, source, bindings, records, dbFacts, uiEvidence, wire,
  windowBoundary = null, successorBinding = null }) {
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
  const windowEnabled = config.successor_observation?.lengths?.includes(config.length) === true;
  const window = windowEnabled ? auditSuccessorWindow({ config, source, db, messages, bindings,
    successorBinding, windowBoundary, wire }) : null;
  const subjectIds = new Set(window?.subject_run_ids ?? []);
  // Bound only target events; C5 still receives complete canonical/provider/request facts.
  const maintenanceDb = windowEnabled ? { ...db, agent_events: db.agent_events.filter(event =>
    event.event_type !== "checkpoint_created" || subjectIds.has(event.run_id)) } : db;
  const maintenance = evaluateAutoMaintenance({ config, dbFacts: maintenanceDb, llmRecords: records, checkpoints: {} }).checks;
  // Successor pressure cannot establish the subject window's maintenance threshold.
  if (windowEnabled) {
    const subjectProviderIds = new Set(providerRuns.filter(run => subjectIds.has(run.agent_run_id)).map(run => run.id));
    maintenance.C1_real_pressure = subjectIds.size === 0
      ? { ok: null, reason: "subject_window_unclosed" }
      : evaluateAutoMaintenance({ config, dbFacts: maintenanceDb,
        llmRecords: records.filter(record => subjectProviderIds.has(record.provider_run_ref)), checkpoints: {} }).checks.C1_real_pressure;
  }
  const requestBindings = windowEnabled ? [...bindings, successorBinding] : bindings;
  const requestChecks = requestBindings.flatMap((binding) => !binding ? [{ ok: null, reason: "run_binding_missing" }] :
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
    all_author_originals: { ok: windowEnabled && authors.length === config.length &&
      isDeepStrictEqual(authors.map(textOf), source.authors.slice(0, config.length).map(author => author.text))
      ? null : authors.length === config.length + (windowEnabled ? 1 : 0) &&
        isDeepStrictEqual(authors.map(textOf), [...source.authors.slice(0, config.length).map(author => author.text),
          ...(windowEnabled ? [source.successorAuthor?.text] : [])]) },
    ...(windowEnabled ? { subject_window: window } : {}),
    every_request_preserved: { ok: requestChecks.some((item) => item.ok === false) ? false :
      requestChecks.length > 0 && requestChecks.every((item) => item.ok === true) ? true : null, calls: requestChecks },
    pressure: requireMaintenance ? maintenance.C1_real_pressure :
      { ok: maintenance.C1_real_pressure.detail.max_input_tokens > 0 &&
        maintenance.C1_real_pressure.detail.max_input_tokens < maintenance.C1_real_pressure.detail.threshold,
        expectation: "three_turn_low_pressure_control", detail: maintenance.C1_real_pressure.detail },
    next_request: requireMaintenance ? (windowEnabled && window?.ok !== true
      ? { ok: null, reason: window.reason } : maintenance.C5_next_request_compact) :
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
    ...(windowEnabled ? { successor_window: { ...window, successor_checkpoints_unobserved: audit.checkpoints
      .filter(checkpoint => !subjectIds.has(checkpoint.canonical_ref.run_id)).map(checkpoint => checkpoint.canonical_ref) } } : {}),
    semantic_status: "review_required", not_signed: ["obligation_semantics", "visual_highlight", "interleaved_awaiting_author", "cancellation_failure_recovery", "duplicate_delivery"] };
}
