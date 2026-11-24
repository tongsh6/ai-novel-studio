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
import { providerFreeInterval } from "./authoring_planning_evidence.mjs";

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

// WR02 Why/恢复只读核账：身份快照决定实际增量，原 HTTP 决定请求启动因果。
// app start 原件没有双引用；它只独立执行全量窗口内零启动判据。
function completedCallMembers(rows, label) {
  assert(Array.isArray(rows), label + " completed calls missing");
  assert(rows.every(row => nonEmpty(row?.provider_call_ref) && nonEmpty(row?.provider_run_ref)),
    label + " provider pair incomplete");
  for (const field of ["provider_call_ref", "provider_run_ref"]) {
    assert(new Set(rows.map(row => row[field])).size === rows.length, label + " duplicate " + field);
  }
  return new Map(rows.map(row => [JSON.stringify([row.provider_call_ref, row.provider_run_ref]), row]));
}

function providerRunMembers(ids, label) {
  assert(Array.isArray(ids) && ids.every(nonEmpty), label + " ProviderRun ids missing");
  assert(new Set(ids).size === ids.length, label + " duplicate ProviderRun id");
  return [...ids].sort();
}

function readOnlyInputBoundary(interval, inputEvents, ready) {
  const start = parseUtcTimestamp(interval?.start), end = parseUtcTimestamp(interval?.end);
  assert(end >= start && Array.isArray(inputEvents), "read-only interval/input originals missing");
  const bookmark = interval.input_events_before, copied = interval.first_input_attempt;
  assert(Number.isSafeInteger(bookmark) && bookmark >= 0 && bookmark < inputEvents.length,
    "read-only input bookmark invalid");
  const index = inputEvents.findIndex((row, position) => position >= bookmark && row.event === "attempt");
  assert(index >= 0 && copied?.line === index + 1 &&
    isDeepStrictEqual(copied.record, inputEvents[index]), "first input is not the original first attempt");
  const first = inputEvents[index], target = first.target;
  assert(first.schema === "native-input-event/v1" && nonEmpty(ready?.run_ref) &&
    first.run_ref === ready.run_ref && Number.isSafeInteger(first.generation) && first.generation >= 0 &&
    Number.isSafeInteger(target?.pid) && target.pid > 0 &&
    nonEmpty(ready.bundle_identifier) && target.bundle_identifier === ready.bundle_identifier &&
    nonEmpty(ready.app_path) && target.app_path === ready.app_path &&
    target.executable_path === ready.app_path + "/Contents/MacOS/" + (ready.native_executable ?? "app"),
  "first input belongs to another run/app or lacks its historical target");
  const from = parseUtcTimestamp(first.at);
  assert(from >= start && from <= end, "first input is outside the captured interval");
  assert(inputEvents.slice(0, bookmark).filter(row => row.event === "attempt")
    .every(row => parseUtcTimestamp(row.at) <= start), "bookmark skipped an input after interval start");
  return { start, from, end };
}

function readOnlyProviderMembers(interval, llmRecords, providerRunIds, boundary) {
  const actual = completedCallMembers(llmRecords, "actual logs");
  const sets = {};
  for (const name of ["before", "after"]) {
    const counts = interval[name], identities = interval.provider_identities?.[name];
    assert(counts && isDeepStrictEqual(Object.keys(counts).sort(), ["llm_records", "provider_runs"]) &&
      Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0),
    name + " counts are not the two observed integer fields");
    const calls = completedCallMembers(identities?.completed_calls, name);
    const runs = providerRunMembers(identities?.provider_run_ids, name);
    assert(counts.llm_records === calls.size && counts.provider_runs === runs.length,
      name + " counts differ from their actual identity observations");
    assert([...calls.keys()].every(key => actual.has(key)), name + " completion absent from actual logs");
    sets[name] = { calls, runs };
  }
  assert(sets.after.calls.size === actual.size, "final actual logs differ from after snapshot");
  assert([...sets.before.calls.keys()].every(key => sets.after.calls.has(key)), "completed call was removed");
  assert(isDeepStrictEqual(sets.before.runs, sets.after.runs) &&
    isDeepStrictEqual(sets.after.runs, providerRunMembers(providerRunIds, "final actual DB")),
  "ProviderRun identities changed or differ from actual DB");
  assert([...actual.values()].every(record => parseUtcTimestamp(record.ts) <= boundary.end) &&
    [...sets.before.calls.keys()].every(key => parseUtcTimestamp(actual.get(key).ts) <= boundary.from),
  "completion snapshot includes a future log");
  return { actual, added: [...sets.after.calls.keys()].filter(key => !sets.before.calls.has(key))
    .map(key => actual.get(key)) };
}

function prestartedSummaryCompletions(maintenance, members, boundary) {
  const required = ["provider_observation_bound", "provider_runs_bound", "provider_auxiliary_bound",
    "source_versions_bound", "summary_results_bound", "ledger_changes_bound", "protected_rows_unchanged"];
  assert(required.every(key => maintenance?.checks?.[key] === true) &&
    Object.values(maintenance.checks).every(value => value === true), "complete maintenance proof required");
  const transport = maintenance.transport;
  assert(transport?.bound === true && Array.isArray(transport.requests), "raw HTTP observation is unbound");
  const posts = transport.requests.filter(row => row.method === "POST");
  assert(posts.length === members.actual.size, "HTTP POST denominator differs from actual completions");
  for (const request of posts) {
    const key = JSON.stringify([request.provider_call_ref, request.provider_run_ref]);
    const record = members.actual.get(key);
    const requested = parseUtcTimestamp(request.requested_at), completed = parseUtcTimestamp(request.completed_at);
    assert(record && requested <= parseUtcTimestamp(record.ts) && completed >= requested &&
      completed <= boundary.end, "HTTP request/completion is outside the observed completion snapshot");
    assert(requested < boundary.start || requested > boundary.end, "new POST inside Why/restore interval");
  }
  return members.added.map(record => {
    const match = row => row.provider_call_ref === record.provider_call_ref &&
      row.provider_run_ref === record.provider_run_ref;
    const requests = posts.filter(match), facts = maintenance.auxiliary.filter(match);
    assert(requests.length === 1 && facts.length === 1, "completion is not one uniquely bound maintenance request");
    const request = requests[0], fact = facts[0];
    assert(fact.bound === true && fact.kind === "chapter_summary" &&
      ["accepted", "degraded", "provider_failed"].includes(fact.result) &&
      fact.request_id === request.request_id && fact.requested_at === request.requested_at &&
      fact.completed_at === request.completed_at && parseUtcTimestamp(request.requested_at) < boundary.start,
    "completion is not the same prestarted original HTTP request");
    assert(fact.maintenance?.summary?.timestamp === fact.result_at && fact.maintenance?.ledger,
      "maintenance terminal is missing");
    return { provider_call_ref: record.provider_call_ref, provider_run_ref: record.provider_run_ref,
      request_id: request.request_id, requested_at: request.requested_at, completed_at: request.completed_at,
      logged_at: record.ts, result: fact.result, summary_id: fact.summary_id ?? null };
  });
}

export function summaryCompletionReadOnlyEvidence({
  interval, inputEvents, ready, providerRunIds, llmRecords, appRecords, maintenance = null,
}) {
  const checks = { input_boundary_bound: false, provider_snapshots_bound: false,
    no_new_application_start: false, completed_calls_explained: false };
  const reasons = {}, added = [];
  let boundary, members;
  const check = (name, predicate) => {
    try { checks[name] = predicate() === true; }
    catch (error) { reasons[name] = error.message; }
  };
  check("input_boundary_bound", () => {
    boundary = readOnlyInputBoundary(interval, inputEvents, ready);
    return true;
  });
  check("provider_snapshots_bound", () => {
    assert(boundary, "input boundary is unbound");
    members = readOnlyProviderMembers(interval, llmRecords, providerRunIds, boundary);
    return true;
  });
  check("no_new_application_start", () => {
    assert(boundary && Array.isArray(appRecords), "application starts/boundary missing");
    const starts = appRecords.filter(row => row.event === "provider_gateway.complete.start");
    assert(starts.length > 0, "application start originals missing");
    return starts.every(row => {
      const at = parseUtcTimestamp(row.timestamp);
      return at < boundary.start || at > boundary.end;
    });
  });
  check("completed_calls_explained", () => {
    assert(members && boundary, "provider identity snapshots are unbound");
    if (members.added.length === 0) {
      // slice_verify 也必须先通过采样/输入证明；零增量沿用现严格默认，不虚构外部 HTTP。
      return providerFreeInterval({ appRecords, llmRecords, start: interval.start, end: interval.end });
    }
    added.push(...prestartedSummaryCompletions(maintenance, members, boundary));
    return true;
  });
  const counts = interval?.before && interval?.after &&
    ["before", "after"].every(name => ["llm_records", "provider_runs"]
      .every(field => Number.isSafeInteger(interval[name][field])));
  return { ok: Object.values(checks).every(value => value === true), checks, reasons,
    before: interval?.before ?? null, after: interval?.after ?? null,
    first_input_attempt: interval?.first_input_attempt ?? null,
    count_delta: counts ? { llm_records: interval.after.llm_records - interval.before.llm_records,
      provider_runs: interval.after.provider_runs - interval.before.provider_runs } : null,
    completed_calls_added: added, transport: maintenance?.transport ?? null };
}
