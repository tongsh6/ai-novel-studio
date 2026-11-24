// ChapterSummary 的原始调用、已采纳材料、摘要结果及派生账本证据。
// 从 B33 现 owner 迁出；B33 采纳与 WR02 repair 共同消费。只核输入事实，
// 不读 DB/文件、不运行模型、不决定产品维护策略或复制 ledger 业务算法。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { closedSseData } from "../../native_provider_stream_proxy.mjs";
import { parseUtcTimestamp, uuidFromHex } from "./authoring_canon_evidence.mjs";
import { canonTableSignature } from "./authoring_pending_evidence.mjs";
import { providerTurnMatchesParent } from "./authoring_call_evidence.mjs";

const nonEmpty = value => typeof value === "string" && value.trim() !== "";

// 先以真实持久双引用识别作者归属；step 名称不代替 ProviderRun 身份。
export function providerCallPairs(records, providerRuns, scenarioScopes) {
  assert([records, providerRuns, scenarioScopes].every(Array.isArray), "provider ownership inputs missing");
  return records.map(record => {
    const byRun = providerRuns.filter(row => row.id === record.provider_run_ref);
    const byCall = providerRuns.filter(row => row.provider_call_ref === record.provider_call_ref);
    const row = byRun.length === 1 && byCall.length === 1 && byRun[0] === byCall[0] ? byRun[0] : null;
    const scopes = row ? scenarioScopes.filter(scope =>
      scope.runId === row.agent_run_id && scope.turnId === row.parent_turn_ref) : [];
    const scope = scopes.length === 1 ? scopes[0] : null;
    const owned = Boolean(scope && [scope.workspaceId, scope.workId, scope.sessionId].every(nonEmpty) &&
      row.workspace_id === scope.workspaceId && row.work_id === scope.workId && row.session_id === scope.sessionId &&
      record.work_id === row.work_id && record.session_id === row.session_id &&
      (!Object.hasOwn(record, "workspace_id") || record.workspace_id === row.workspace_id) &&
      providerTurnMatchesParent(record.turn_id, scope.turnId));
    return { record, row, owned, matched: byRun.length > 0 || byCall.length > 0 };
  });
}

// 每个调用已完成原始响应/结果行核定后，整张摘要表仍不能夹带其它作品或未知增量。
export function summaryRowsAccounted(before, after, facts) {
  assert(facts.every(fact => fact.bound), "unbound auxiliary result");
  const oldRows = requiredRows(before, "chapter_summaries");
  const newRows = requiredRows(after, "chapter_summaries");
  const resultIds = facts.flatMap(fact => [fact.summary_id, ...(fact.tentative_summary_ids ?? [])].filter(Boolean));
  assert(new Set(resultIds).size === resultIds.length, "summary result identity is reused");
  for (const row of oldRows) {
    const next = newRows.find(candidate => candidate.id === row.id);
    assert(next, "existing summary row was removed");
    if (isDeepStrictEqual(row, next)) continue;
    const owners = facts.filter(fact => fact.work_id === row.work_id && fact.chapter_id === row.chapter_id);
    assert(owners.length === 1 && summaryPriorRowsPreserved([row], [next],
      Date.parse(owners[0].requested_at), Date.parse(owners[0].result_at)),
      "old summary changed outside a bound result");
  }
  const added = newRows.filter(row => !oldRows.some(old => old.id === row.id));
  assert(added.length === resultIds.length && added.every(row => resultIds.includes(row.id)),
    "summary table contains an unbound result");
  return true;
}

// 原 B33 capturedRows 的值归一；SQL 读取仍归各现 capture owner。
export function scopeRowValues(table, rows) {
  const jsonFields = { memory_items: ["tags"], interactions: ["content"],
    author_action_receipts: ["result"], ledger_entries: ["payload", "source_refs"] }[table] ?? [];
  return rows.map(row => {
    const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key, (key === "id" || key.endsWith("_id")) && value instanceof Uint8Array && value.byteLength === 16
        ? uuidFromHex(Buffer.from(value).toString("hex")) : value,
    ]));
    for (const key of jsonFields) if (typeof normalized[key] === "string") normalized[key] = JSON.parse(normalized[key]);
    return normalized;
  });
}

export function requiredRows(snapshot, table) {
  const rows = table === "action_receipts" ? snapshot?.action_receipts : snapshot?.scope_rows?.[table];
  assert(Array.isArray(rows), "maintenance evidence lacks original " + table + " rows");
  assert(rows.every(row => nonEmpty(row?.id)) && new Set(rows.map(row => row.id)).size === rows.length,
    "maintenance row identities are missing or duplicated: " + table);
  return rows;
}

export function rowsPreserved(oldRows, newRows) {
  return oldRows.every(old => newRows.some(row => row.id === old.id && isDeepStrictEqual(old, row)));
}

export function ledgerSnapshotRows(snapshot) {
  const rows = requiredRows(snapshot, "ledger_entries");
  const canon = snapshot.authoring_canon?.tables?.ledger_entries;
  assert(canon?.row_count === rows.length && /^[a-f0-9]{64}$/u.test(canon.rows_sha256) &&
    canon.rows_sha256 === canon.canon_sha256, "ledger rows and canonical capture disagree");
  assert(rows.every(row => [row.work_id, row.ledger, row.subject_ref].every(nonEmpty)) &&
    new Set(rows.map(row => JSON.stringify([row.work_id, row.ledger, row.subject_ref]))).size === rows.length,
    "ledger natural identity is missing or duplicated");
  return rows;
}

const providerBytesSha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function observedProviderResponses(config, stream, records) {
  const marker = config.preregistration;
  assert(marker && stream?.directory === marker.proxy_dir, "B33 observation directory is not frozen");
  const limit = marker.max_upstream_requests;
  assert(Object.hasOwn(marker, "max_upstream_requests") &&
    (limit === null || (Number.isSafeInteger(limit) && limit > 0)), "B33 observation budget missing");
  assert(stream.ready?.mode === "observe" && stream.ready.endpoint === config.endpoint &&
    stream.ready.max_upstream_requests === limit, "B33 observation runtime mismatch");
  const events = stream.events;
  assert(Array.isArray(events) && events.every((event, index) => event.sequence === index + 1 &&
    event.max_upstream_requests === limit && event.budget_requests_rejected === 0 &&
    Number.isSafeInteger(event.upstream_requests_admitted) && event.upstream_requests_admitted >= 0 &&
    (limit === null || event.upstream_requests_admitted <= limit)),
  "B33 observation sequence or budget mismatch");
  const registrations = events.filter((event) => event.event === "request_registered");
  assert(registrations.length > 0 && (limit === null || registrations.length <= limit), "B33 HTTP budget exceeded");
  assert(new Set(registrations.map((event) => event.request_id)).size === registrations.length,
    "B33 duplicate HTTP request identity");
  const responses = new Map();
  const observed = [];
  const once = (rows, name) => {
    const found = rows.filter((event) => event.event === name);
    assert.equal(found.length, 1, "B33 missing or duplicate " + name);
    return found[0];
  };
  for (const registration of registrations) {
    const id = registration.request_id;
    assert(/^request-[1-9][0-9]*$/u.test(id) && ["POST", "GET"].includes(registration.method), "B33 unknown HTTP request");
    const rows = events.filter((event) => event.request_id === id);
    const forwarded = once(rows, "upstream_request_forwarded");
    const headers = once(rows, "response_headers");
    const ended = once(rows, "upstream_end");
    const closed = once(rows, "transparent_complete");
    assert(rows.filter((event) => ["transparent_complete", "request_closed"].includes(event.event)).length === 1 &&
      forwarded.upstream_admitted === true && forwarded.forwarded === true && closed.response_complete === true &&
      registration.sequence < forwarded.sequence && forwarded.sequence < headers.sequence &&
      headers.sequence < ended.sequence && ended.sequence < closed.sequence, "B33 HTTP request did not close completely");
    const request = stream.readBytes(id + ".bin");
    const received = stream.readBytes(id + ".received.bin");
    const delivered = stream.readBytes(id + ".delivered.bin");
    assert([request, received, delivered].every(Buffer.isBuffer), "B33 original bytes missing");
    assert.equal(providerBytesSha(request), registration.request_sha256, "B33 original request seal mismatch");
    assert(received.equals(delivered) && received.length === closed.received_bytes &&
      delivered.length === closed.delivered_bytes && providerBytesSha(received) === closed.received_sha256 &&
      providerBytesSha(delivered) === closed.delivered_sha256, "B33 original response seal mismatch");
    const status = headers.response_status;
    assert(Number.isInteger(status) && status >= 100 && status <= 599, "B33 response status missing");
    const fact = { request_id: id, method: registration.method, response_status: status,
      requested_at: registration.at, completed_at: closed.at,
      request_sha256: registration.request_sha256, response_sha256: closed.received_sha256 };
    if (registration.method === "POST") {
      assert.equal(registration.path, new URL(config.endpoint).pathname.replace(/\/+$/u, "") + "/chat/completions",
        "B33 unregistered POST operation");
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(request));
      const matching = records.filter((record) => isDeepStrictEqual(record.request?.body, body) &&
        record.request?.method === "POST" && record.request?.url === config.endpoint.replace(/\/+$/u, "") + "/chat/completions");
      assert.equal(matching.length, 1, "B33 raw request does not bind one log record");
      const record = matching[0];
      assert(!responses.has(record) && record.response?.status === status, "B33 response identity/status mismatch");
      Object.assign(fact, { provider_call_ref: record.provider_call_ref, provider_run_ref: record.provider_run_ref });
      let text = "", finish = null, hasTools = false, failed = status < 200 || status >= 300;
      if (!failed) {
        assert(String(headers.content_type).toLowerCase().includes("text/event-stream") &&
          headers.response_encoding === "identity", "B33 successful model response is not raw SSE");
        const data = closedSseData(received);
        assert(data.at(-1) === "[DONE]" && data.filter((value) => value === "[DONE]").length === 1, "B33 SSE terminal missing");
        for (const value of data.slice(0, -1)) {
          const part = JSON.parse(value);
          assert(part && typeof part === "object" && !Array.isArray(part), "B33 SSE object missing");
          if (part.error) {
            assert(finish === null, "B33 SSE error followed a terminal choice");
            failed = true;
            continue;
          }
          assert(Array.isArray(part.choices) && part.choices.length <= 1, "B33 SSE choices missing or ambiguous");
          for (const choice of part.choices) {
            assert(finish === null, "B33 SSE choice followed a terminal choice");
            assert(choice.index === 0 && choice.delta && typeof choice.delta === "object" &&
              !Array.isArray(choice.delta), "B33 ambiguous SSE choice");
            if (choice.delta.content != null) {
              assert.equal(typeof choice.delta.content, "string", "B33 SSE content is not text");
              text += choice.delta.content;
            }
            if (choice.delta.tool_calls != null) {
              assert(Array.isArray(choice.delta.tool_calls), "B33 SSE tool fragments invalid");
              hasTools ||= choice.delta.tool_calls.length > 0;
            }
            if (choice.finish_reason != null) {
              assert(finish === null && nonEmpty(choice.finish_reason), "B33 SSE finish is ambiguous");
              finish = choice.finish_reason;
            }
          }
        }
        assert(failed || finish !== null, "B33 SSE finish missing");
      }
      responses.set(record, { ...fact, text, finish, hasTools, failed });
    }
    if (registration.method === "GET") assert.equal(registration.path,
      new URL(config.endpoint).pathname.replace(/\/+$/u, "") + "/models", "unknown observed GET operation");
    observed.push(fact);
  }
  assert.equal(responses.size, records.length, "B33 model call omitted from HTTP evidence");
  const ids = new Set(registrations.map((event) => event.request_id));
  assert(events.every((event) => !event.request_id || ids.has(event.request_id)), "B33 unregistered HTTP event");
  const admitted = events.filter((event) => event.event === "upstream_request_forwarded").length;
  assert.equal(admitted, registrations.length, "B33 HTTP admission denominator mismatch");
  assert.equal(Math.max(...events.map((event) => event.upstream_requests_admitted)), admitted, "B33 HTTP counter mismatch");
  return { responses, measured: { original_directory: stream.directory, http_requests: registrations.length,
    model_POST: responses.size, GET: registrations.length - responses.size, admitted, max_upstream_requests: limit,
    requests: observed } };
}

function acceptedSummarySource(snapshot, workId, chapterId) {
  const chapters = snapshot?.chapters?.filter((row) => row.chapter_id === chapterId) ?? [];
  assert(chapters.length === 1 && chapters[0].work_id === workId, "B33 summary chapter owner missing");
  const drafts = snapshot.scope_rows?.drafts ?? [];
  const scenes = (snapshot.scope_rows?.scenes ?? []).filter((row) => row.chapter_id === chapterId &&
    drafts.some((draft) => draft.scene_id === row.id && draft.status === "ACCEPTED"))
    .sort((left, right) => left.seq - right.seq);
  assert(scenes.length > 0 && scenes.every((row) => Number.isSafeInteger(row.seq)) &&
    new Set(scenes.map((row) => row.seq)).size === scenes.length, "B33 summary source scene order ambiguous");
  const source = scenes.map((scene) => {
    const accepted = drafts.filter((row) => row.scene_id === scene.id && row.status === "ACCEPTED");
    assert(accepted.length === 1 && accepted[0].work_id === workId && typeof accepted[0].content === "string",
      "B33 summary source is not one accepted draft");
    const row = accepted[0];
    assert(Number.isSafeInteger(row.revision) && row.revision > 0, "summary source revision missing");
    return { id: row.id, scene_id: row.scene_id, seq: scene.seq, work_id: row.work_id,
      revision: row.revision, status: row.status, content: row.content };
  });
  return { source, text: source.map((row) => row.content).join("\n").trim() };
}

function renderedSummary(text) {
  const labels = ["情节推进", "人物状态与弧光", "伏笔动作", "情绪基调"];
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  assert.equal(lines.length, labels.length, "B33 summary does not have four complete lines");
  return labels.map((label, index) => {
    const prefix = "【" + label + "】";
    const line = lines[index].trim();
    assert(line.startsWith(prefix) && nonEmpty(line.slice(prefix.length)), "B33 summary line is invalid");
    return prefix + line.slice(prefix.length).trim();
  }).join("\n");
}

function summaryPriorRowsPreserved(before, after, since, until) {
  const fixed = (row) => Object.fromEntries(Object.entries(row).filter(([key]) =>
    key !== "status" && key !== "updated_at"));
  return before.every((row) => {
    const next = after.find((candidate) => candidate.id === row.id);
    if (!next) return false;
    if (isDeepStrictEqual(next, row)) return true;
    return row.status === "ACCEPTED" && next.status === "SUPERSEDED" &&
      isDeepStrictEqual(fixed(next), fixed(row)) && Date.parse(next.updated_at) >= Date.parse(row.updated_at) &&
      Date.parse(next.updated_at) >= since && Date.parse(next.updated_at) <= until;
  });
}

function summaryStoredResult(row, status, sourceRef, revisionBase, raw, since, until) {
  assert(row.status === status && row.source_ref === sourceRef && row.revision_base === revisionBase &&
    !raw.failed && raw.finish === "stop" && !raw.hasTools, "B33 summary row contradicts its source or provider result");
  assert.equal(row.summary_text, renderedSummary(raw.text), "B33 summary result does not match original response");
  const inserted = Date.parse(row.inserted_at), updated = Date.parse(row.updated_at);
  assert(inserted >= since && updated >= inserted && updated <= until, "B33 summary row is outside the actual call window");
}

export function summaryAuxiliaryFact(record, context) {
  const { config, appRecords, snapshots, observation } = context;
  const fact = { provider_call_ref: record.provider_call_ref, provider_run_ref: record.provider_run_ref,
    kind: "unknown", result: "unknown", bound: false };
  try {
    assert(record.step === "chapter_summary" && observation?.responses.has(record), "B33 unknown independent provider operation");
    fact.kind = "chapter_summary";
    const refs = record.request?.refs?.base_refs;
    assert.deepEqual(record.request?.refs?.observation_refs, [], "B33 auxiliary observation refs changed");
    assert.deepEqual(record.request?.refs?.used_refs, [], "B33 auxiliary used refs changed");
    assert(Array.isArray(refs) && refs.length === 2 && new Set(refs).size === 2, "B33 summary source refs missing");
    const chapterRefs = refs.filter((ref) => typeof ref === "string" && ref.startsWith("chapter:"));
    assert.equal(chapterRefs.length, 1, "B33 summary chapter ref ambiguous");
    const chapterId = chapterRefs[0].slice("chapter:".length);
    const sourceRef = refs.find((ref) => ref !== chapterRefs[0]);
    assert(nonEmpty(chapterId) && nonEmpty(sourceRef), "B33 summary operation source missing");
    const workId = config.target?.work_id;
    assert(nonEmpty(workId) && (!Object.hasOwn(record, "work_id") || record.work_id === workId) &&
      (!Object.hasOwn(record, "session_id") || record.session_id === config.target.session_id),
      "B33 independent summary owner mismatch");
    let source;
    if (sourceRef === "summary_repair:" + chapterId) {
      const beforeSource = acceptedSummarySource(snapshots?.start, workId, chapterId);
      const afterSource = acceptedSummarySource(snapshots?.final, workId, chapterId);
      assert.deepEqual(afterSource.source, beforeSource.source, "B33 summary accepted source changed during batch");
      source = { before: snapshots.start, after: snapshots.final, since: snapshots.start.at,
        text: afterSource.text, revisionBase: null, source_rows: beforeSource.source };
    } else {
      assert(typeof context.adoptedSummarySource === "function", "unknown summary adoption owner");
      source = context.adoptedSummarySource(context, sourceRef, chapterId);
    }
    assert(nonEmpty(source.text), "B33 summary source is empty");
    const material = "【应用数据 · application_base · 非作者原话】\n## 本次材料正文\n已采纳正文：\n" + source.text;
    const messages = record.request.body.messages;
    assert(record.request.body.tools == null || (Array.isArray(record.request.body.tools) &&
      record.request.body.tools.length === 0), "B33 auxiliary request unexpectedly has tools");
    assert(messages.length === 2 && messages[0].role === "system" && messages[1].role === "user" &&
      messages[1].content === material, "B33 summary request is not the actual accepted material");
    const outcomes = source.maintenance ? [source.maintenance.summary] : appRecords.filter((row) =>
      ["chapter_summary_maintenance.run.done", "chapter_summary_maintenance.run.error"].includes(row.event) &&
      row.work_id === workId && row.chapter_id === chapterId);
    assert.equal(outcomes.length, 1, "B33 summary business outcome is missing or ambiguous");
    const result = outcomes[0], raw = observation.responses.get(record);
    const times = [source.since, record.ts, result.timestamp, source.after.at].map(Date.parse);
    assert(times.every(Number.isFinite) && times.every((time, index) => index === 0 || time >= times[index - 1]),
      "B33 summary outcome is outside this actual call and checkpoint window");
    assert(Date.parse(raw.requested_at) >= times[0] && Date.parse(raw.completed_at) >= Date.parse(raw.requested_at) &&
      Date.parse(raw.completed_at) <= times[3], "B33 original auxiliary request is outside the source window");
    const rowsFor = (snapshot) => requiredRows(snapshot, "chapter_summaries")
      .filter((row) => row.chapter_id === chapterId && row.work_id === workId);
    const before = rowsFor(source.before), after = rowsFor(source.after);
    const added = after.filter((row) => !before.some((old) => old.id === row.id));
    assert(added.length <= 1 && summaryPriorRowsPreserved(before, after, times[1], times[2]),
      "B33 summary changed or removed an existing row beyond lawful supersede");
    Object.assign(fact, { source_ref: sourceRef, chapter_id: chapterId, work_id: workId,
      revision_base: source.revisionBase, request_id: raw.request_id, response_status: raw.response_status,
      requested_at: raw.requested_at, completed_at: raw.completed_at, result_at: result.timestamp,
      ...(source.source_rows ? { source_rows: source.source_rows } : {}) });
    if (source.maintenance) fact.maintenance = source.maintenance;
    if (result.event.endsWith(".done")) {
      assert(result.outcome === "ok" && result.status === "ACCEPTED" && result.four_column === true &&
        added.length === 1 && after.filter((row) => row.status === "ACCEPTED").length === 1,
        "B33 summary completion is not one new accepted result");
      summaryStoredResult(added[0], "ACCEPTED", sourceRef, source.revisionBase, raw, times[1], times[2]);
      Object.assign(fact, { result: "accepted", summary_id: added[0].id });
    } else {
      assert(result.outcome === "error" && ["generation_failed", "persistence_failed"].includes(result.reason_code) &&
        nonEmpty(result.outcome_detail), "B33 auxiliary failure is unknown");
      if (result.reason_code === "generation_failed") {
        assert.deepEqual(after, before, "B33 generation failure changed summaries");
      } else {
        if (!isDeepStrictEqual(after, before)) {
          assert(!raw.failed && raw.finish === "stop" && !raw.hasTools, "B33 failed generation cannot change summaries");
          renderedSummary(raw.text);
        }
        for (const row of added) summaryStoredResult(row, "TENTATIVE", sourceRef, source.revisionBase, raw, times[1], times[2]);
      }
      Object.assign(fact, { result: raw.failed ? "provider_failed" : "degraded", reason_code: result.reason_code,
        tentative_summary_ids: added.map((row) => row.id) });
    }
    fact.bound = true;
  } catch (error) { fact.reason = error.message; }
  return fact;
}

// 已绑定的各次真实维护窗口与来源；只判作用域/身份/版本，不复算弧光或情绪业务。
export function ledgerChangesBound({ before, after, workId, sources }) {
  const oldRows = ledgerSnapshotRows(before), newRows = ledgerSnapshotRows(after);
  const unchanged = oldRows.length === newRows.length && rowsPreserved(oldRows, newRows);
  assert(unchanged === (canonTableSignature(before.authoring_canon, "ledger_entries") ===
    canonTableSignature(after.authoring_canon, "ledger_entries")), "ledger canonical/raw change disagreement");
  if (unchanged) return true;
  assert(nonEmpty(workId) && Array.isArray(sources) && sources.length > 0,
    "changed ledger has no completed source-bound maintenance");
  const windows = sources.map(source => {
    assert(nonEmpty(source.chapterId) && nonEmpty(source.summaryRef), "ledger source identity missing");
    const from = parseUtcTimestamp(source.from), to = parseUtcTimestamp(source.to);
    assert(to >= from, "ledger maintenance window is reversed");
    return { ...source, from, to };
  });
  const within = (time, allowed) => allowed.some(window => time >= window.from && time <= window.to);
  const mutable = new Set(["subject_kind", "subject_label", "design_ref", "status", "payload",
    "source_refs", "last_event_chapter", "adoption_status", "revision", "updated_at"]);
  const fixed = row => Object.fromEntries(Object.entries(row).filter(([key]) => !mutable.has(key)));
  assert(oldRows.every(row => newRows.some(next => next.id === row.id)), "ledger deleted an existing row");
  for (const row of newRows) {
    const previous = oldRows.find(old => old.id === row.id);
    if (previous && isDeepStrictEqual(previous, row)) continue;
    assert(row.work_id === workId, "ledger changed another work");
    if (previous) assert(isDeepStrictEqual(fixed(previous), fixed(row)), "ledger replaced a fixed identity");
    const genre = row.ledger === "promise" && row.subject_kind === "promise" && row.subject_ref === "genre";
    assert(genre || ["arc", "conflict", "emotion_curve"].includes(row.ledger), "ledger kind is outside this maintenance");
    let relevant = windows;
    if (row.ledger === "emotion_curve") {
      relevant = windows.filter(source => source.chapterId === row.subject_ref);
      assert(row.subject_kind === "chapter" && relevant.length > 0 && row.last_event_chapter === row.subject_ref,
        "emotion target differs from the bound maintenance");
    }
    if (genre) assert(row.last_event_chapter === null, "work-level genre is not a chapter event");
    const allowed = genre ? ["work_profile:" + workId] : relevant.map(source => source.summaryRef);
    assert(Array.isArray(row.source_refs) && row.source_refs.length > 0 &&
      row.source_refs.every(ref => nonEmpty(ref) && (allowed.includes(ref) || previous?.source_refs?.includes(ref))),
      "ledger introduced an unbound source");
    assert(row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) &&
      nonEmpty(row.subject_kind) && nonEmpty(row.subject_label) && nonEmpty(row.status) &&
      row.adoption_status === "ACCEPTED" && Number.isSafeInteger(row.revision) && row.revision >= 1 &&
      (!previous || row.revision > previous.revision), "ledger state is not a completed schema update");
    const inserted = parseUtcTimestamp(row.inserted_at), updated = parseUtcTimestamp(row.updated_at);
    assert(within(updated, relevant) && updated >= inserted &&
      (previous ? updated >= parseUtcTimestamp(previous.updated_at) : within(inserted, relevant)),
      "ledger row is outside the actual maintenance windows");
  }
  return true;
}
