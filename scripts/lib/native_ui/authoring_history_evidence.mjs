// B71 canonical 创作历史的原生证据读取：只读、精确绑定、失败不回退。
//
// ADR-0035 / B81 CP1 后 canonical 作用域=会话：本 run 的执行段由
// `authoring_run_segments`（段头：run/system/tools/refs/call_ids 九键）+
// `authoring_session_messages`（该 run 的消息，按 run_sequence）组成；
// durable checkpoint 只保存 `authoring_segment_ref={run_id,version}`
// （`authoring-run-segment/v1`）。本模块不读取旧 run 级私有列/旧内嵌副本，
// 也不按 parent/scope 的“最新”行猜取运行身份。
import assert from "node:assert/strict";
import {
  all,
  frameBody,
  frameEvent,
  frameOf,
  isFrame,
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

// bounded 与 durable 共用的唯一会话段 decoder：段头版本/消息版本/形状/完整身份
// 只在这里校验一次，模式分支不复制第二套 reader。
function readRunSegment(db, record) {
  const segmentRows = all(db, "SELECT * FROM authoring_run_segments WHERE run_id = ?", [record.id]);
  assert.equal(segmentRows.length, 1, "authoring_history: run 执行段缺失或多行");
  const segment = segmentRows[0];
  const header = assertRecord(decodeJson(segment.header, "run 执行段 header"), "run 执行段 header");
  assert.equal(header.version, AUTHORING_SEGMENT_VERSION, "authoring_history: run 执行段版本错误");

  const messageRows = all(
    db,
    "SELECT message, format_version, run_sequence FROM authoring_session_messages " +
      "WHERE run_id = ? ORDER BY run_sequence",
    [record.id],
  );
  assert.equal(
    messageRows.length,
    segment.message_count,
    "authoring_history: 消息行数量与 run 执行段 message_count 不一致",
  );
  for (const row of messageRows) {
    assert.equal(
      row.format_version,
      AUTHORING_MESSAGE_VERSION,
      "authoring_history: 消息行格式版本错误",
    );
  }
  const messages = messageRows.map((row) => assertRecord(decodeJson(row.message, "canonical 消息"), "canonical 消息"));
  return { segment, header, messages };
}

function readPrivateTranscript(db, record) {
  const { segment, header, messages } = readRunSegment(db, record);
  const transcript = {
    run: header.run,
    system: header.system,
    messages,
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

    assert.equal(record.workspace_id, identity.workspace_id, "authoring_history: agent_runs workspace 与本批 workspace 不一致");
    assert.equal(record.work_id, identity.work_id, "authoring_history: agent_runs work 与本批不一致");
    assert.equal(record.session_id, identity.session_id, "authoring_history: agent_runs session 与本批不一致");
    assert.equal(record.parent_turn_ref, identity.parent_turn_ref, "authoring_history: agent_runs parent_turn_ref 与本批不一致");
    if (requireMode !== null) {
      assert.equal(
        record.run_mode,
        requireMode,
        `authoring_history: run_mode ${String(record.run_mode)} 与场景 ${requireMode} 不一致`,
      );
    }

    const { transcript, segment } = readPrivateTranscript(db, record);
    const base = {
      record,
      transcript,
      segment,
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
  });
}
