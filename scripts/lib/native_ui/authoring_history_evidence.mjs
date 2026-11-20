// B71 canonical 创作历史的原生证据读取：只读、精确绑定、失败不回退。
//
// ADR-0035 / B81 CP1 后 canonical 作用域=会话：本 run 的执行段由
// `authoring_run_segments`（段头：run/system/tools/refs/call_ids 九键）+
// `authoring_session_messages`（该 run 的消息，按 run_sequence）组成；
// durable checkpoint 只保存 `authoring_segment_ref={run_id,version}`
// （`authoring-run-segment/v1`）。本模块不读取旧 run 级私有列/旧内嵌副本，
// 也不按 parent/scope 的“最新”行猜取运行身份。
// R02：另读同一事务内的 sessionMessages，保持 run transcript/refs 原语义，
// 供逐调用 Scope/作者前缀校验使用；不会从当前段头补造同调用 Request IR。
import assert from "node:assert/strict";
import {
  all,
  frameBody,
  frameEvent,
  frameOf,
  isFrame,
  sentUserMessages,
  turnFacts,
  withDb,
} from "./scenario_evidence.mjs";

export const AUTHORING_SEGMENT_VERSION = "authoring-run-segment/v1";
export const AUTHORING_MESSAGE_VERSION = "authoring-session-message/v1";

const WORKSPACE_PREFIX = "workspace:";
const IDENTITY_FIELDS = Object.freeze([
  "run_id",
  "workspace_id",
  "work_id",
  "session_id",
  "parent_turn_ref",
]);

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function fail(message) {
  throw new Error(`authoring_history: ${message}`);
}

function assertRecord(value, label) {
  assert(isRecord(value), `authoring_history: ${label} 必须是对象`);
  return value;
}

function assertNonBlankString(value, label) {
  assert(
    typeof value === "string" && value.trim() !== "",
    `authoring_history: ${label} 必须是非空字符串`,
  );
  return value;
}

function exactScope(scope) {
  assertRecord(scope, "authoring scope");
  return Object.fromEntries(
    IDENTITY_FIELDS.map((field) => [field, assertNonBlankString(scope[field], `scope.${field}`)]),
  );
}

// 本批真实 WS 事实：作者输入帧给出 work/session 与自己的 join_ref，join 回复
// 按同一 join_ref/request ref 确认同一身份，topic 后缀给出 workspace。
//
// Phoenix 的 join_ref 只在单条 socket 连接内唯一：应用重启/重连后新 socket 会复用
// 相同 join_ref（真实批次 cp4b-pending-04 restore 后 join=5 出现两次）。因此“当前
// join 生命周期”必须按时间落到作者输入所在的连接段：取发送时刻不晚于作者输入的
// 最新 join；同一时刻多个 join 仍判多义拒绝猜取。join 回复再被限制在该 join 之后、
// 作者输入之前，旧连接回复不会确认新连接。
function authoringMessage(messageRecord, { workId, parentTurnId }) {
  assert(isFrame(messageRecord), "authoring_scope: 作者输入缺真实 WS 帧");
  const frame = frameOf(messageRecord);
  const topic = frame[2];
  assert(
    typeof topic === "string" && topic.startsWith(WORKSPACE_PREFIX) && topic.length > WORKSPACE_PREFIX.length,
    "authoring_scope: 作者输入 topic 缺 workspace",
  );
  const body = assertRecord(frameBody(messageRecord), "authoring_scope.message");
  assert.equal(body.work_id, workId, "authoring_scope: 作者输入 work 与本批作品不一致");
  assert.equal(body.turn_id, parentTurnId, "authoring_scope: 作者输入 turn 与 turnFacts 不一致");
  return {
    topic,
    workspaceId: topic.slice(WORKSPACE_PREFIX.length),
    sessionId: assertNonBlankString(body.session_id, "authoring_scope.message.session_id"),
    joinRef: assertNonBlankString(frame[0], "authoring_scope.message.join_ref"),
  };
}

const isJoinLifecycleFrame = (record, topic, joinRef) =>
  record.direction === "sent" &&
  isFrame(record) &&
  frameOf(record)[0] === joinRef &&
  frameOf(record)[1] === joinRef &&
  frameOf(record)[2] === topic &&
  frameEvent(record) === "phx_join";

function selectJoin(wire, { topic, joinRef, at }) {
  const joins = wire.filter(
    (record) => isJoinLifecycleFrame(record, topic, joinRef) && record.at <= at,
  );
  assert(joins.length > 0, "authoring_scope: 缺本批 join 帧，不能从 DB 行反填 session");
  const newestAt = joins.reduce((max, record) => (record.at > max ? record.at : max), "");
  const newest = joins.filter((record) => record.at === newestAt);
  assert.equal(newest.length, 1, "authoring_scope: 当前 join_ref 生命周期多义，拒绝猜取");
  return newest[0];
}

// join 回复必须同时绑定 join_ref（frame[0]）与 join 自己的 request ref
// （frame[1]），并落在 join 发送之后、作者输入之前。同 channel 其它 request
// 回复与旧生命周期回复因此不能确认本次 join。
const isJoinReplyFrame = (record, topic, [joinRef, requestRef]) =>
  record.direction === "received" &&
  isFrame(record) &&
  frameOf(record)[0] === joinRef &&
  frameOf(record)[1] === requestRef &&
  frameOf(record)[2] === topic &&
  frameEvent(record) === "phx_reply";

function selectJoinReply(wire, { topic, join, at }) {
  const joinFrame = frameOf(join);
  const replies = wire.filter(
    (record) =>
      isJoinReplyFrame(record, topic, joinFrame) &&
      record.at >= join.at &&
      record.at <= at,
  );
  assert.equal(replies.length, 1, "authoring_scope: join 回复缺失或多义");
  return replies[0];
}

function verifyJoinIdentity(join, reply, { workId, sessionId }) {
  const joinBody = assertRecord(frameBody(join), "authoring_scope.join");
  assert.equal(joinBody.work_id, workId, "authoring_scope: join work 与本批作品不一致");
  assert.equal(joinBody.session_id, sessionId, "authoring_scope: join session 与作者输入不一致");

  const replyBody = assertRecord(frameBody(reply), "authoring_scope.join_reply");
  assert.equal(replyBody.status, "ok", "authoring_scope: join 未成功");
  const response = assertRecord(replyBody.response, "authoring_scope.join_response");
  assert.equal(response.joined, true, "authoring_scope: join 未确认");
  assert.equal(response.work_id, workId, "authoring_scope: join 回复 work 不一致");
  assert.equal(response.session_id, sessionId, "authoring_scope: join 回复 session 不一致");
}

export function authoringScope(wire, messageRecord, { workId, parentTurnId } = {}) {
  assert(Array.isArray(wire), "authoring_scope: wire 必须是帧数组");
  assertNonBlankString(workId, "authoring_scope.workId");
  assertNonBlankString(parentTurnId, "authoring_scope.parentTurnId");

  const message = authoringMessage(messageRecord, { workId, parentTurnId });
  const join = selectJoin(wire, { ...message, at: messageRecord.at });
  const reply = selectJoinReply(wire, { topic: message.topic, join, at: messageRecord.at });
  verifyJoinIdentity(join, reply, { workId, sessionId: message.sessionId });
  return {
    workspace_id: message.workspaceId,
    work_id: workId,
    session_id: message.sessionId,
    parent_turn_ref: parentTurnId,
  };
}

function decodeJson(value, label) {
  if (value === null || value === undefined) fail(`${label} 缺失`);
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fail(`${label} JSON 无法解析`);
  }
}

// 两列都是 SQLite nullable TEXT：读取边界只可能给出 JSON 字符串或 NULL。
function decodeOptional(value) {
  return typeof value === "string" ? JSON.parse(value) : null;
}

function validateRef(ref, record) {
  const label = "authoring_segment_ref 缺失或错绑";
  if (!isRecord(ref)) fail(label);
  assert.deepEqual(Object.keys(ref).map(String).sort(), ["run_id", "version"], `authoring_history: ${label}`);
  assert.equal(ref.run_id, record.id, `authoring_history: ${label}`);
  assert.equal(ref.version, AUTHORING_SEGMENT_VERSION, `authoring_history: ${label}`);
}

function validRefValue(ref) {
  if (typeof ref === "string") return ref.trim() !== "";
  return isRecord(ref) && typeof ref.ref === "string" && ref.ref.trim() !== "";
}

function validateTranscriptShape(transcript) {
  const maps = ["run", "system", "projection"];
  const lists = ["messages", "tools", "base_refs", "observation_refs", "used_refs", "call_ids"];
  const valid =
    maps.every((key) => isRecord(transcript[key])) &&
    lists.every((key) => Array.isArray(transcript[key])) &&
    transcript.messages.every((message) => isRecord(message) && Array.isArray(message.blocks) && message.blocks.every(isRecord)) &&
    transcript.tools.every(isRecord) &&
    transcript.base_refs.every(validRefValue) &&
    transcript.observation_refs.every(validRefValue);
  assert(valid, "authoring_history: canonical transcript 形状非法");
}

function validateTranscriptIdentity(record, run) {
  assertRecord(run, "canonical transcript.run");
  const expected = {
    run_id: record.id,
    workspace_id: record.workspace_id,
    work_id: record.work_id,
    session_id: record.session_id,
    parent_turn_ref: record.parent_turn_ref,
  };
  for (const [field, value] of Object.entries(expected)) {
    assertNonBlankString(run[field], `canonical 身份 ${field}`);
    assert.equal(run[field], value, `authoring_history: canonical 身份 ${field} 与 agent_runs 不一致`);
  }
}

// 段与消息均核对真实 run 身份；同一会话的 work/workspace 必须一致。
function validateStoredIdentity(row, record, fields) {
  assert.equal(row.run_id, record.id, "authoring_history: canonical 行 run 身份错绑");
  for (const field of fields) {
    assertNonBlankString(row[field], `canonical 行 ${field}`);
    assert.equal(row[field], record[field], `authoring_history: canonical 行 ${field} 错绑`);
  }
}

function decodeSessionMessage(row, record) {
  validateStoredIdentity(row, record, ["workspace_id", "work_id", "session_id"]);
  assert.equal(row.format_version, AUTHORING_MESSAGE_VERSION, "authoring_history: 消息行格式版本错误");
  const message = assertRecord(decodeJson(row.message, "canonical 消息"), "canonical 消息");
  assertNonBlankString(row.role, "canonical 行 role");
  assert.equal(row.role, message.role, "authoring_history: 消息行 role 与 canonical 消息不一致");
  assert(RUN_STATUSES.has(record.status), "authoring_history: agent_run status 缺失或未知");
  return { ...row, message, run_status: record.status, parent_turn_ref: record.parent_turn_ref };
}

function validateSegmentBounds(segment, rows) {
  assert(Number.isInteger(segment.message_count) && segment.message_count >= 0,
    "authoring_history: run 执行段 message_count 非法");
  assert.equal(rows.length, segment.message_count,
    "authoring_history: 消息行数量与 run 执行段 message_count 不一致");
  rows.forEach((row, index) => {
    assert.equal(row.run_sequence, index + 1, "authoring_history: run_sequence 必须从 1 连续递增");
  });
  assert.equal(segment.first_sequence, rows[0]?.sequence ?? null,
    "authoring_history: run 执行段 first_sequence 不一致");
  assert.equal(segment.last_sequence, rows.at(-1)?.sequence ?? null,
    "authoring_history: run 执行段 last_sequence 不一致");
}

// bounded/durable 与会话证据共用同一 decoder；段头 refs 仍只属于该 run，绝不并入请求证据。
function decodeRunSegment(segment, record, rows) {
  validateStoredIdentity(segment, record, [
    "workspace_id", "work_id", "session_id", "parent_turn_ref",
  ]);
  assert.equal(segment.format_version, AUTHORING_SEGMENT_VERSION, "authoring_history: run 执行段格式版本错误");
  const header = assertRecord(decodeJson(segment.header, "run 执行段 header"), "run 执行段 header");
  assert.equal(header.version, AUTHORING_SEGMENT_VERSION, "authoring_history: run 执行段版本错误");
  validateSegmentBounds(segment, rows);
  const transcript = {
    run: header.run,
    system: header.system,
    messages: rows.map((row) => row.message),
    tools: header.tools,
    base_refs: header.base_refs,
    observation_refs: header.observation_refs,
    used_refs: header.used_refs,
    projection: header.projection,
    call_ids: header.call_ids,
  };
  validateTranscriptShape(transcript);
  validateTranscriptIdentity(record, transcript.run);
  return { transcript, segment };
}

function sessionOwner(runs, runId, record) {
  const owner = runs.get(runId);
  assert(owner, "authoring_history: 会话 canonical 行缺少所属 agent_run");
  assert.equal(owner.work_id, record.work_id, "authoring_history: 会话 canonical work 身份错绑");
  assert.equal(owner.workspace_id, record.workspace_id, "authoring_history: 会话 canonical workspace 身份错绑");
  assert.equal(owner.session_id, record.session_id, "authoring_history: 会话 canonical session 身份错绑");
  return owner;
}

function decodeSessionRows(rows, runs, segments, record) {
  return rows.map((row, index) => {
    assert.equal(row.sequence, index + 1, "authoring_history: 会话 sequence 必须从 1 连续递增");
    assert(segments.has(row.run_id), "authoring_history: canonical 消息缺少 run 执行段");
    return decodeSessionMessage(row, sessionOwner(runs, row.run_id, record));
  });
}

// 只读取目标 session 的完整快照；先验证全部已提交段/行，再按目标段范围派生可比对消息。
function readSessionSnapshot(db, record) {
  const runRows = all(db, "SELECT * FROM agent_runs WHERE session_id = ?", [record.session_id]);
  const runs = new Map(runRows.map((row) => [row.id, row]));
  assert.equal(runs.size, runRows.length, "authoring_history: 会话 agent_run 身份重复");
  const segmentRows = all(db, "SELECT * FROM authoring_run_segments WHERE session_id = ?", [record.session_id]);
  const segments = new Map(segmentRows.map((row) => [row.run_id, row]));
  assert.equal(segments.size, segmentRows.length, "authoring_history: run 执行段缺失或多行");
  assert(segments.has(record.id), "authoring_history: run 执行段缺失或多行");
  const rows = decodeSessionRows(
    all(db, "SELECT * FROM authoring_session_messages WHERE session_id = ? ORDER BY sequence", [record.session_id]),
    runs, segments, record,
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.run_id)) grouped.set(row.run_id, []);
    grouped.get(row.run_id).push(row);
  }
  const decoded = new Map(segmentRows.map((segment) => [
    segment.run_id,
    decodeRunSegment(segment, sessionOwner(runs, segment.run_id, record), grouped.get(segment.run_id) ?? []),
  ]));
  return { rows, current: decoded.get(record.id) };
}

// AuthoringSessionHistory.compose/2 的持久消息边界：当前 base 一次、非 base 会话原序。
// 输入由现有 canonical decoder 验证；不按相同文本/refs 去重，不改变原始历史或来源坐标。
export function composeSessionMessages(messages, currentRunId) {
  assertNonBlankString(currentRunId, "currentRunId");
  const current = messages.filter((message) => message.canonical_ref.run_id === currentRunId);
  const bases = current.filter((message) => message.role === "application_base");
  assert(bases.length <= 1, "authoring_history: 当前 run application_base 重复");
  if (bases.length > 0) {
    assert.equal(current[0], bases[0], "authoring_history: 当前 run application_base 必须位于首位");
  }
  return [...bases, ...messages.filter((message) => message.role !== "application_base")];
}

// 不读取请求反推 expected，也不把段头累计 refs 当成历史请求 refs。目标段之后的行不进入数组；
// 同段各 call 仍由唯一 pcall/prun 截取自己的前缀并严格对账，不能用整个会话代签请求快照。
function sessionMessagesFor({ rows, current: { segment } }) {
  return composeSessionMessages(
    rows.filter((row) => row.sequence <= segment.last_sequence).map(messageWithCoordinate),
    segment.run_id,
  );
}


const RUN_STATUSES = new Set(["created", "running", "pausing", "cancelling", "paused", "awaiting_author", "completed", "cancelled", "failed"]);
const coordinateKey = (ref) => JSON.stringify([ref?.run_id, ref?.run_sequence]);

function messageWithCoordinate(row) {
  return { ...row.message, canonical_ref: Object.fromEntries([
    "run_id", "run_sequence", "workspace_id", "work_id", "session_id", "parent_turn_ref", "run_status",
  ].map((key) => [key, row[key]])) };
}

// C5/C6 与会话 reader 共用原始行 decoder。身份来自真实 agent_runs，不能由摘要或请求补造。
export function canonicalMessagesFromRows(rows, runRows) {
  const runs = new Map(runRows.map((run) => [run.id, run]));
  assert.equal(runs.size, runRows.length, "authoring_history: agent_run 身份重复");
  const owners = new Map();
  const coordinates = new Set();
  return rows.map((row) => {
    const run = runs.get(row.run_id);
    assert(run, "authoring_history: canonical 行缺真实 agent_run");
    const owner = owners.get(row.session_id) ?? run;
    sessionOwner(runs, row.run_id, owner);
    owners.set(row.session_id, owner);
    assert(Number.isInteger(row.sequence) && row.sequence > 0, "authoring_history: sequence 非法");
    assert(Number.isInteger(row.run_sequence) && row.run_sequence > 0, "authoring_history: run_sequence 非法");
    const key = coordinateKey(row);
    assert(!coordinates.has(key), "authoring_history: canonical 消息坐标重复");
    coordinates.add(key);
    return { ...messageWithCoordinate(decodeSessionMessage(row, run)),
      sequence: row.sequence, run_id: row.run_id, session_id: row.session_id };
  }).sort((left, right) => left.session_id.localeCompare(right.session_id) || left.sequence - right.sequence);
}



function validateDurableCheckpoint(record, checkpoint) {
  assertRecord(checkpoint, "checkpoint_data");
  const agentRun = assertRecord(checkpoint.agent_run, "checkpoint_data.agent_run");
  assert.equal(agentRun.checkpoint_version, 3, "authoring_history: checkpoint 不是 v3");
  assert.equal(agentRun.run_id, record.id, "authoring_history: checkpoint run_id 与 agent_runs 不一致");
  validateRef(agentRun.authoring_segment_ref, record);
}

// durable 必须精确引用同一 task，并核对 task 的 work/parent 与 run 一致。
function readDurableTask(db, record) {
  const taskRef = record.long_run_task_ref;
  if (typeof taskRef !== "string" || taskRef.trim() === "") {
    fail("long_run_task_ref 缺失");
  }
  const rows = all(db, "SELECT * FROM long_run_tasks WHERE id = ?", [taskRef]);
  assert.equal(rows.length, 1, "authoring_history: long_run_task_ref 指向的 task 不存在");
  const task = rows[0];
  assert.equal(task.workspace_id, record.work_id, "authoring_history: task 不属于同一作品");
  assert.equal(task.parent_turn_ref, record.parent_turn_ref, "authoring_history: task parent_turn_ref 与 run 不一致");
  return task;
}

// 共用读取路径：run/workspace/work/session/parent 五字段先精确锁定唯一
// agent_runs；随后只按该行真实 run_mode 分支。bounded 的私有 canonical 是唯一
// 来源，不要求 long_run_task；durable 才额外核验同一 task 与 v3 ref。
export function readAuthoringHistory(dir, scope, { requireMode = null } = {}) {
  const identity = exactScope(scope);
  return withDb(dir, (db) => {
    db.exec("BEGIN");
    try {
      return readHistorySnapshot(db, identity, requireMode);
    } finally {
      db.exec("ROLLBACK");
    }
  });
}

function readHistorySnapshot(db, identity, requireMode) {
  const rows = all(
    db,
    "SELECT * FROM agent_runs " +
      "WHERE id = ? AND workspace_id = ? AND work_id = ? AND session_id = ? AND parent_turn_ref = ?",
    [
      identity.run_id,
      identity.workspace_id,
      identity.work_id,
      identity.session_id,
      identity.parent_turn_ref,
    ],
  );
  assert.equal(rows.length, 1, "authoring_history: agent_runs 精确绑定必须恰好一行");
  const record = rows[0];

  if (requireMode !== null) {
    assert.equal(
      record.run_mode,
      requireMode,
      `authoring_history: run_mode ${String(record.run_mode)} 与场景 ${requireMode} 不一致`,
    );
  }

  const snapshot = readSessionSnapshot(db, record);
  const { transcript, segment } = snapshot.current;
  const base = {
    record,
    transcript,
    segment,
    sessionMessages: sessionMessagesFor(snapshot),
    budget: decodeOptional(record.consumed_budget),
    pending: decodeOptional(record.pending_artifact_refs),
  };
  switch (record.run_mode) {
    case "bounded":
      return { mode: "bounded", ...base, task: null, checkpoint: null };
    case "durable": {
      const task = readDurableTask(db, record);
      const checkpoint = decodeJson(task.checkpoint_data, "checkpoint_data");
      validateDurableCheckpoint(record, checkpoint);
      return { mode: "durable", ...base, task, checkpoint };
    }
    default:
      return fail(`未知 run_mode: ${String(record.run_mode)}`);
  }
}

// 作者输入的 ACK 提供 run_id，终局 turn_result 可以属于该 run 的后续子回合。
// 返回的 facts 是同一输入记录经 turnFacts 得到的内部事实（ACK/同 owning topic 结果）；
// 下游不再重复选输入，只在该 scope 上判定，避免另造第二套输入/ACK 绑定。
export function readBatchAuthoringHistory(dir, { wire, messageText, workId } = {}) {
  assert(Array.isArray(wire), "authoring_batch: wire 必须是帧数组");
  assertNonBlankString(messageText, "authoring_batch.messageText");
  assertNonBlankString(workId, "authoring_batch.workId");
  const messages = sentUserMessages(wire, messageText);
  assert.equal(messages.length, 1, "authoring_batch: 本批作者输入必须唯一");

  const facts = turnFacts(wire, messages[0]);
  const { turnId: parentTurnId, ack } = facts;
  const scope = authoringScope(wire, messages[0], { workId, parentTurnId });
  const runId = assertNonBlankString(frameBody(ack)?.response?.run_id, "authoring_batch ACK.run_id");
  return { ...readAuthoringHistory(dir, { ...scope, run_id: runId }), facts };
}

export function readRunRefFacts(db, run) {
  return {
    agent_events: all(db, "SELECT event_type, refs FROM agent_events WHERE run_id = ?", [run.id]),
    decision_traces: all(
      db,
      "SELECT trace_id, turn_id, context_refs FROM decision_traces WHERE workspace_id = ? AND session_id = ? " +
        "AND (turn_id = ? OR instr(turn_id, ? || ':') = 1)",
      [run.workspace_id, run.session_id, run.parent_turn_ref, run.parent_turn_ref],
    ),
  };
}
