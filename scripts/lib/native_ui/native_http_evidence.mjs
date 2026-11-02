// 外部 HTTP 代理的纯取证判据：只认实际 capture 的完整 JSON body。
//
// 代理只对真实会话 resume 与 turn replay 记录 body；这里不把仅 status=200、
// 截断/超限、非法 JSON、不支持的压缩编码或错 work/session/turn 的回包当证据。
//
// 真实 WorkSessionsController.serialize_snapshot 对 resume 无条件输出
// pending_adoptions / pending_adoption_turn_results / resolved_adoptions，
// 并用服务端默认值输出 inbox_pending_adoptions / inbox_pending_adoption_turn_results /
// inbox_resolved_adoptions。缺键只可能发生在坏 capture，不是“已证空”。
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const arrayField = (value) => (Array.isArray(value) ? value : null);

export const MAX_HTTP_CAPTURE_BYTES = 1024 * 1024;

function decode(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

export function httpPathname(value) {
  try {
    return new URL(String(value), "http://127.0.0.1").pathname;
  } catch {
    return String(value ?? "").split("?")[0];
  }
}

export function httpCaptureTarget(method, url) {
  if (method !== "GET") return null;
  const pathname = httpPathname(url);
  const resume = /^\/api\/works\/([^/]+)\/sessions\/resume\/?$/u.exec(pathname);
  if (resume) {
    return { kind: "resume", work_id: decode(resume[1]), session_id: null, turn_id: null };
  }
  const replay =
    /^\/api\/works\/([^/]+)\/sessions\/([^/]+)\/turns\/([^/]+)\/replay\/?$/u.exec(pathname);
  if (replay) {
    return {
      kind: "replay",
      work_id: decode(replay[1]),
      session_id: decode(replay[2]),
      turn_id: decode(replay[3]),
    };
  }
  return null;
}

export function resumePathFor(workId) {
  return `/api/works/${encodeURIComponent(workId)}/sessions/resume`;
}

export function sameCaptureScope(record, expected) {
  return Boolean(
    isObject(record?.scope) &&
      record.scope.kind === expected.kind &&
      record.scope.work_id === expected.work_id &&
      (expected.session_id == null || record.scope.session_id === expected.session_id) &&
      (expected.turn_id == null || record.scope.turn_id === expected.turn_id),
  );
}

// recordsFor 已按 direction/method/path/window 选定唯一候选；这里只判断该候选
// 的 body 是否被代理完整解析。重复的 direction/method 判断不再保留。
function completeJsonCapture(record) {
  return Boolean(
    record.status === 200 &&
      record.body_state?.complete === true &&
      record.body_state?.json === "valid" &&
      isObject(record.body),
  );
}

function capturePathFor(expected) {
  return expected.kind === "resume"
    ? resumePathFor(expected.work_id)
    : `/api/works/${encodeURIComponent(expected.work_id)}/sessions/${encodeURIComponent(expected.session_id)}/turns/${encodeURIComponent(expected.turn_id)}/replay`;
}

function inWindow(record, from, to) {
  return Boolean(
    typeof record?.at === "string" &&
      (from === undefined || record.at >= from) &&
      (to === undefined || record.at <= to),
  );
}

function recordsFor(records, expected, from, to) {
  const path = capturePathFor(expected);
  return (Array.isArray(records) ? records : []).filter(
    (record) =>
      record?.direction === "http" &&
      record.method === "GET" &&
      httpPathname(record.path) === path &&
      inWindow(record, from, to),
  );
}

function captureFor(records, expected, from, to) {
  const candidates = recordsFor(records, expected, from, to);
  if (candidates.length !== 1) {
    return { ok: false, reason: candidates.length === 0 ? "capture_missing" : "capture_ambiguous", candidates };
  }
  const record = candidates[0];
  if (!completeJsonCapture(record)) {
    return {
      ok: false,
      reason: "capture_incomplete",
      candidates,
      body_state: record.body_state ?? null,
    };
  }
  if (!sameCaptureScope(record, expected)) {
    return { ok: false, reason: "capture_scope_mismatch", candidates };
  }
  return { ok: true, reason: null, record, body: record.body, candidates };
}

export function resumeCapture(records, { workId, from, to } = {}) {
  if (!nonBlank(workId)) return { ok: false, reason: "work_missing" };
  return captureFor(
    records,
    { kind: "resume", work_id: workId, session_id: null, turn_id: null },
    from,
    to,
  );
}

export function replayCapture(records, { workId, sessionId, turnId, from, to } = {}) {
  if (!nonBlank(workId) || !nonBlank(sessionId) || !nonBlank(turnId)) {
    return { ok: false, reason: "scope_missing" };
  }
  return captureFor(
    records,
    { kind: "replay", work_id: workId, session_id: sessionId, turn_id: turnId },
    from,
    to,
  );
}

function artifactItems(artifact) {
  return arrayField(artifact?.payload?.items);
}

function itemBodyExact(entry, expected) {
  const items = artifactItems(entry);
  return (
    items?.length === 1 &&
    items[0]?.title === expected.title &&
    items[0]?.body === expected.body
  );
}

// 生产上 revision_of 可能落在 payload 或唯一 item；两处同时出现时必须是同一值。
// 任何显式冲突都拒绝，不用 OR 让其中一个别名替另一个背书。
function revisionAliases(entry) {
  const aliases = [];
  if (entry?.payload?.revision_of !== undefined) aliases.push(entry.payload.revision_of);
  const item = artifactItems(entry)?.[0];
  if (item?.revision_of !== undefined) aliases.push(item.revision_of);
  return aliases;
}

function revisionAliasesAgree(aliases) {
  return aliases.every((value) => value === aliases[0]);
}

function revisionOfExact(entry, expected) {
  const aliases = revisionAliases(entry);
  if (!revisionAliasesAgree(aliases)) return false;
  const actual = aliases.length === 0 ? null : aliases[0];
  return actual === (expected.revision_of ?? null);
}

function resolvedEntryExact(entry, expected) {
  return Boolean(
    expected &&
      isObject(entry) &&
      entry.artifact_id === expected.artifact_id &&
      entry.adoption_status === expected.status &&
      itemBodyExact(entry, expected) &&
      revisionOfExact(entry, expected),
  );
}

function resolvedExact(entries, expected) {
  return (
    Array.isArray(entries) &&
    entries.filter((entry) => resolvedEntryExact(entry, expected)).length === 1
  );
}

const PENDING_FIELDS = Object.freeze([
  "pending_adoptions",
  "inbox_pending_adoptions",
  "pending_adoption_turn_results",
  "inbox_pending_adoption_turn_results",
]);
const RESOLVED_FIELDS = Object.freeze(["resolved_adoptions", "inbox_resolved_adoptions"]);

// 外部 JSON 只在进入判据时解析一次：每个字段要么是数组，要么是 null（缺键/非法）。
// 后续检查不再用 `?? []` 把 null 变成“空集合已证”。
function parseResumeProjection(body) {
  return {
    work_id: body?.work?.id,
    session_id: body?.active_session?.id,
    active_session_work_id: body?.active_session?.work_id,
    pending: PENDING_FIELDS.map((field) => arrayField(body?.[field])),
    resolved: RESOLVED_FIELDS.map((field) => arrayField(body?.[field])),
  };
}

export function resumeProjectionChecks(body, { workId, sessionId, source, revision } = {}) {
  const projection = parseResumeProjection(body);
  return {
    resume_body_scope_same_work_session:
      projection.work_id === workId &&
      projection.session_id === sessionId &&
      projection.active_session_work_id === workId,
    resume_projection_pending_empty: projection.pending.every(
      (entries) => entries?.length === 0,
    ),
    resume_projection_resolved_count_exact: projection.resolved.every(
      (entries) => entries?.length === 2,
    ),
    resume_projection_source_discarded: projection.resolved.every((entries) =>
      resolvedExact(entries, source),
    ),
    resume_projection_revision_accepted: projection.resolved.every((entries) =>
      resolvedExact(entries, revision),
    ),
  };
}
