import assert from "node:assert/strict";
import test from "node:test";
import {
  httpCaptureTarget,
  httpPathname,
  replayCapture,
  resumeCapture,
  resumePathFor,
  resumeProjectionChecks,
  sameCaptureScope,
} from "./native_http_evidence.mjs";

const WORK = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";
const TURN = "turn-1";
const AT = "2026-11-02T10:00:01.000Z";
const RESUME_PATH = resumePathFor(WORK);
const REPLAY_PATH = `/api/works/${WORK}/sessions/${SESSION}/turns/${TURN}/replay`;
const PENDING_FIELDS = [
  "pending_adoptions",
  "inbox_pending_adoptions",
  "pending_adoption_turn_results",
  "inbox_pending_adoption_turn_results",
];
const RESOLVED_FIELDS = ["resolved_adoptions", "inbox_resolved_adoptions"];

function capture(overrides = {}) {
  return {
    direction: "http",
    method: "GET",
    path: RESUME_PATH,
    request_id: "http-1",
    status: 200,
    at: AT,
    scope: { kind: "resume", work_id: WORK, session_id: null, turn_id: null },
    body_state: { complete: true, json: "valid" },
    body: {},
    ...overrides,
  };
}

test("httpCaptureTarget 只接受明确 GET resume/replay 路径并解析 scope", () => {
  assert.deepEqual(httpCaptureTarget("GET", RESUME_PATH), {
    kind: "resume",
    work_id: WORK,
    session_id: null,
    turn_id: null,
  });
  assert.deepEqual(httpCaptureTarget("GET", `${RESUME_PATH}/`), {
    kind: "resume",
    work_id: WORK,
    session_id: null,
    turn_id: null,
  });
  const encodedWork = encodeURIComponent("作品 1");
  assert.deepEqual(httpCaptureTarget("GET", `/api/works/${encodedWork}/sessions/resume?x=1`), {
    kind: "resume",
    work_id: "作品 1",
    session_id: null,
    turn_id: null,
  });
  assert.deepEqual(httpCaptureTarget("GET", `${REPLAY_PATH}?x=1`), {
    kind: "replay",
    work_id: WORK,
    session_id: SESSION,
    turn_id: TURN,
  });
  assert.deepEqual(httpCaptureTarget("GET", `${REPLAY_PATH}/`), {
    kind: "replay",
    work_id: WORK,
    session_id: SESSION,
    turn_id: TURN,
  });
  assert.equal(httpCaptureTarget("POST", RESUME_PATH), null);
  assert.equal(httpCaptureTarget("POST", REPLAY_PATH), null);
  assert.equal(httpCaptureTarget("GET", `${RESUME_PATH}/extra`), null);
  assert.equal(
    httpCaptureTarget("GET", `/api/works/${WORK}/sessions/${SESSION}/turns/replay`),
    null,
  );
  assert.equal(httpCaptureTarget("GET", "/health"), null);
  assert.equal(httpPathname(RESUME_PATH), RESUME_PATH);
  assert.equal(httpPathname(`http://127.0.0.1:1${REPLAY_PATH}?x=1`), REPLAY_PATH);
  assert.equal(httpPathname("http://["), "http://[");
});

test("sameCaptureScope 要求 kind/work 与给定 session/turn 精确一致", () => {
  const scope = { kind: "replay", work_id: WORK, session_id: SESSION, turn_id: TURN };
  assert.equal(sameCaptureScope({ scope }, scope), true);
  assert.equal(
    sameCaptureScope({ scope }, { ...scope, session_id: null, turn_id: null }),
    true,
  );
  assert.equal(sameCaptureScope({ scope }, { ...scope, work_id: "other" }), false);
  assert.equal(sameCaptureScope({ scope }, { ...scope, session_id: "other" }), false);
  assert.equal(sameCaptureScope({ scope }, { ...scope, turn_id: "other" }), false);
  assert.equal(sameCaptureScope({ scope: { ...scope, kind: "resume" } }, scope), false);
  for (const record of [null, {}, { scope: null }, { scope: [] }, { scope: "scope" }]) {
    assert.equal(sameCaptureScope(record, scope), false);
  }
});

test("resumeCapture 缺 work、缺失、多义、不完整、错状态与错 scope 都失败", () => {
  assert.equal(resumeCapture([], {}).reason, "work_missing");
  assert.equal(resumeCapture([], { workId: "   " }).reason, "work_missing");
  assert.equal(resumeCapture([], { workId: WORK }).reason, "capture_missing");
  assert.equal(resumeCapture(null, { workId: WORK }).reason, "capture_missing");
  assert.equal(resumeCapture([capture(), capture()], { workId: WORK }).reason, "capture_ambiguous");
  for (const bad of [
    { body_state: { complete: false, json: "aborted" } },
    { body_state: { complete: true, json: "invalid" } },
    { body_state: { complete: true, json: "empty" } },
    { body_state: { complete: true, json: "unsupported_encoding" } },
    { body_state: undefined },
    { body: null },
    { body: [] },
    { body: "not-object" },
    { body: 42 },
    { status: 201 },
    { status: 204 },
    { status: 500 },
  ]) {
    assert.equal(resumeCapture([capture(bad)], { workId: WORK }).reason, "capture_incomplete");
  }
  assert.equal(
    resumeCapture([capture({ scope: { kind: "resume", work_id: "other" } })], {
      workId: WORK,
    }).reason,
    "capture_scope_mismatch",
  );
  for (const bad of [
    { direction: "sent" },
    { method: "POST" },
    { path: REPLAY_PATH },
    { at: undefined },
    { at: 42 },
  ]) {
    assert.equal(resumeCapture([capture(bad)], { workId: WORK }).reason, "capture_missing");
  }
  assert.equal(resumeCapture([capture()], { workId: WORK, from: AT, to: AT }).ok, true);
  assert.equal(
    resumeCapture([capture()], { workId: WORK, from: "2026-11-02T10:00:02.000Z" }).ok,
    false,
  );
  assert.equal(
    resumeCapture([capture()], { workId: WORK, to: "2026-11-02T10:00:00.000Z" }).ok,
    false,
  );
  assert.equal(resumeCapture([capture()], { workId: WORK }).ok, true);
});

test("replayCapture 要求 work/session/turn 精确且窗口内唯一", () => {
  const record = capture({
    path: REPLAY_PATH,
    scope: { kind: "replay", work_id: WORK, session_id: SESSION, turn_id: TURN },
  });
  const expected = { workId: WORK, sessionId: SESSION, turnId: TURN };
  assert.equal(replayCapture([], {}).reason, "scope_missing");
  assert.equal(replayCapture([], { workId: WORK }).reason, "scope_missing");
  assert.equal(replayCapture([], { workId: WORK, sessionId: SESSION }).reason, "scope_missing");
  assert.equal(replayCapture([record], expected).ok, true);
  assert.equal(replayCapture(null, expected).reason, "capture_missing");
  assert.equal(replayCapture([record], { ...expected, workId: "other" }).ok, false);
  assert.equal(replayCapture([record], { ...expected, sessionId: "other" }).ok, false);
  assert.equal(replayCapture([record], { ...expected, turnId: "other" }).ok, false);
  assert.equal(
    replayCapture([record], { ...expected, from: "2026-11-02T10:00:02.000Z" }).ok,
    false,
  );
  assert.equal(
    replayCapture([record], { ...expected, to: "2026-11-02T10:00:00.000Z" }).ok,
    false,
  );
  assert.equal(replayCapture([record], { ...expected, from: AT, to: AT }).ok, true);
  assert.equal(
    replayCapture(
      [capture({ ...record, scope: { ...record.scope, turn_id: "other" } })],
      expected,
    ).reason,
    "capture_scope_mismatch",
  );
});

function sourceEntry(overrides = {}) {
  return {
    artifact_id: "as-source",
    adoption_status: "DISCARDED",
    payload: { items: [{ title: "标题", body: "正文" }] },
    ...overrides,
  };
}

function revisionEntry(overrides = {}) {
  return {
    artifact_id: "as-revision",
    adoption_status: "ACCEPTED",
    payload: { items: [{ title: "修订标题", body: "修订正文" }], revision_of: "as-source" },
    ...overrides,
  };
}

function resumeBody(overrides = {}) {
  return {
    work: { id: WORK },
    active_session: { id: SESSION, work_id: WORK },
    pending_adoptions: [],
    pending_adoption_turn_results: [],
    inbox_pending_adoptions: [],
    inbox_pending_adoption_turn_results: [],
    resolved_adoptions: [sourceEntry(), revisionEntry()],
    inbox_resolved_adoptions: [sourceEntry(), revisionEntry()],
    ...overrides,
  };
}

const EXPECTED = {
  workId: WORK,
  sessionId: SESSION,
  source: {
    artifact_id: "as-source",
    status: "DISCARDED",
    title: "标题",
    body: "正文",
    revision_of: null,
  },
  revision: {
    artifact_id: "as-revision",
    status: "ACCEPTED",
    title: "修订标题",
    body: "修订正文",
    revision_of: "as-source",
  },
};

const projectionChecks = (body) => resumeProjectionChecks(body, EXPECTED);

test("resumeProjectionChecks 正例：scope、四个 pending 空数组、两个 resolved 桶精确", () => {
  assert.deepEqual(projectionChecks(resumeBody()), {
    resume_body_scope_same_work_session: true,
    resume_projection_pending_empty: true,
    resume_projection_resolved_count_exact: true,
    resume_projection_source_discarded: true,
    resume_projection_revision_accepted: true,
  });
});

test("resumeProjectionChecks 缺失 pending 字段不是已证空", () => {
  for (const field of PENDING_FIELDS) {
    const body = resumeBody();
    delete body[field];
    const checks = projectionChecks(body);
    assert.equal(checks.resume_projection_pending_empty, false, field);
    assert.equal(Object.values(checks).every(Boolean), false, field);
  }
});

test("resumeProjectionChecks 非法或非空 pending 字段都失败", () => {
  for (const field of PENDING_FIELDS) {
    for (const value of [null, {}, "[]", 0, false]) {
      const checks = projectionChecks(resumeBody({ [field]: value }));
      assert.equal(checks.resume_projection_pending_empty, false, `${field}=${String(value)}`);
    }
    const nonEmpty = projectionChecks(resumeBody({ [field]: [{}] }));
    assert.equal(nonEmpty.resume_projection_pending_empty, false, field);
  }
});

test("resumeProjectionChecks 缺失/非法 resolved 桶不冒充空或同值", () => {
  for (const field of RESOLVED_FIELDS) {
    const missing = resumeBody();
    delete missing[field];
    const absent = projectionChecks(missing);
    assert.equal(absent.resume_projection_resolved_count_exact, false, field);
    assert.equal(absent.resume_projection_source_discarded, false, field);
    assert.equal(absent.resume_projection_revision_accepted, false, field);
    for (const value of [null, {}, "[]", 0]) {
      const invalid = projectionChecks(resumeBody({ [field]: value }));
      assert.equal(invalid.resume_projection_resolved_count_exact, false, `${field}=${String(value)}`);
      assert.equal(invalid.resume_projection_source_discarded, false, `${field}=${String(value)}`);
      assert.equal(invalid.resume_projection_revision_accepted, false, `${field}=${String(value)}`);
    }
  }
});

test("resumeProjectionChecks 不用 session resolved 冒充缺失的 inbox resolved", () => {
  const body = resumeBody();
  delete body.inbox_resolved_adoptions;
  const checks = projectionChecks(body);
  assert.equal(checks.resume_projection_resolved_count_exact, false);
  assert.equal(checks.resume_projection_source_discarded, false);
  assert.equal(checks.resume_projection_revision_accepted, false);
});

test("resumeProjectionChecks 源稿必须唯一、DISCARDED 且标题正文逐字相等", () => {
  const sourceMutations = [
    (entry) => { entry.artifact_id = "other"; },
    (entry) => { entry.adoption_status = "ACCEPTED"; },
    (entry) => { entry.payload.items[0].title = "错标题"; },
    (entry) => { entry.payload.items[0].body = "错正文"; },
    (entry) => { entry.payload.items.push({ title: "标题", body: "正文" }); },
    (entry) => { entry.payload.items = []; },
    (entry) => { delete entry.payload; },
    (entry) => { entry.payload.revision_of = "other"; },
    (entry) => { entry.payload.items[0].revision_of = "other"; },
  ];
  for (const mutate of sourceMutations) {
    const body = resumeBody();
    mutate(body.resolved_adoptions[0]);
    const checks = projectionChecks(body);
    assert.equal(checks.resume_projection_source_discarded, false);
    assert.equal(Object.values(checks).every(Boolean), false);
  }
  const explicitNull = resumeBody();
  explicitNull.resolved_adoptions[0].payload.revision_of = null;
  assert.equal(projectionChecks(explicitNull).resume_projection_source_discarded, true);
});

test("resumeProjectionChecks 修订稿必须唯一、ACCEPTED 且 revision_of 精确", () => {
  const revisionMutations = [
    (entry) => { entry.artifact_id = "other"; },
    (entry) => { entry.adoption_status = "DISCARDED"; },
    (entry) => { entry.payload.items[0].title = "错标题"; },
    (entry) => { entry.payload.items[0].body = "错正文"; },
    (entry) => { entry.payload.items.push({ title: "修订标题", body: "修订正文" }); },
    (entry) => { entry.payload.items = []; },
    (entry) => { delete entry.payload; },
    (entry) => { entry.payload.revision_of = "other"; },
    (entry) => { entry.payload.revision_of = null; },
    (entry) => { entry.payload.items[0].revision_of = "other"; },
  ];
  for (const mutate of revisionMutations) {
    const body = resumeBody();
    mutate(body.resolved_adoptions[1]);
    const checks = projectionChecks(body);
    assert.equal(checks.resume_projection_revision_accepted, false);
    assert.equal(Object.values(checks).every(Boolean), false);
  }
});

test("resumeProjectionChecks 接受单一 revision_of 别名并拒绝双别名显式冲突", () => {
  const itemAlias = resumeBody();
  delete itemAlias.resolved_adoptions[1].payload.revision_of;
  itemAlias.resolved_adoptions[1].payload.items[0].revision_of = "as-source";
  assert.equal(projectionChecks(itemAlias).resume_projection_revision_accepted, true);

  const bothSame = resumeBody();
  bothSame.resolved_adoptions[1].payload.items[0].revision_of = "as-source";
  assert.equal(projectionChecks(bothSame).resume_projection_revision_accepted, true);

  for (const itemValue of ["other", null]) {
    const conflict = resumeBody();
    conflict.resolved_adoptions[1].payload.items[0].revision_of = itemValue;
    assert.equal(
      projectionChecks(conflict).resume_projection_revision_accepted,
      false,
      String(itemValue),
    );
  }

  const payloadOnlyOther = resumeBody();
  payloadOnlyOther.resolved_adoptions[1].payload.revision_of = "other";
  assert.equal(projectionChecks(payloadOnlyOther).resume_projection_revision_accepted, false);
});

test("resumeProjectionChecks 要求每个 resolved 桶恰两条且源/修订各唯一", () => {
  for (const entries of [[], [sourceEntry()], [sourceEntry(), revisionEntry(), sourceEntry()]]) {
    const checks = projectionChecks(resumeBody({ resolved_adoptions: entries }));
    assert.equal(checks.resume_projection_resolved_count_exact, false);
  }
  const duplicate = projectionChecks(
    resumeBody({ resolved_adoptions: [sourceEntry(), sourceEntry()] }),
  );
  assert.equal(duplicate.resume_projection_resolved_count_exact, true);
  assert.equal(duplicate.resume_projection_source_discarded, false);
  assert.equal(duplicate.resume_projection_revision_accepted, false);
});

test("resumeProjectionChecks 对 resolved 中的非对象条目失败关闭而不崩溃", () => {
  const checks = projectionChecks(
    resumeBody({
      resolved_adoptions: [null, revisionEntry()],
      inbox_resolved_adoptions: [null, revisionEntry()],
    }),
  );
  assert.equal(checks.resume_projection_resolved_count_exact, true);
  assert.equal(checks.resume_projection_source_discarded, false);
  assert.equal(checks.resume_projection_revision_accepted, true);
});

test("resumeProjectionChecks 的 scope 检查逐字段失败关闭", () => {
  for (const body of [
    { ...resumeBody(), work: { id: "other" } },
    { ...resumeBody(), active_session: { id: "other", work_id: WORK } },
    { ...resumeBody(), active_session: { id: SESSION, work_id: "other" } },
    { ...resumeBody(), work: null },
    { ...resumeBody(), active_session: null },
    null,
    [],
    "body",
  ]) {
    assert.equal(projectionChecks(body).resume_body_scope_same_work_session, false);
  }
});

test("resumeProjectionChecks 对非对象 body 不把缺字段当成功", () => {
  for (const body of [null, undefined, [], "body", 42, false]) {
    assert.equal(Object.values(projectionChecks(body)).every(Boolean), false);
  }
});
