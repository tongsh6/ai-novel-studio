// B71 canonical 历史读取的真实验收消费者测试：只读临时 SQLite + 真实 WS 帧形状。
// ADR-0035 / B81 CP1：canonical 作用域=会话，run 执行段 = authoring_run_segments
// （段头九键）+ authoring_session_messages（该 run 的消息）。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { authoringScope, readAuthoringHistory } from "./authoring_history_evidence.mjs";

const SEGMENT_VERSION = "authoring-run-segment/v1";
const MESSAGE_VERSION = "authoring-session-message/v1";
const RUN = "run-target";
const WORK = "work-1";
const WORKSPACE = "workspace-1";
const SESSION = "session-1";
const PARENT = "message-1";
const TASK = "task-target";
const TARGET_TEXT = "目标 run 的作者原话";

const scope = (overrides = {}) => ({
  run_id: RUN,
  workspace_id: WORKSPACE,
  work_id: WORK,
  session_id: SESSION,
  parent_turn_ref: PARENT,
  ...overrides,
});

function transcriptFor(overrides = {}) {
  return {
    run: {
      run_id: RUN,
      workspace_id: WORKSPACE,
      work_id: WORK,
      session_id: SESSION,
      parent_turn_ref: PARENT,
      profile_ref: "judgment_loop_v1",
    },
    system: { identity_ref: "identity:authoring/v1" },
    messages: [
      { role: "user", provenance: "author", blocks: [{ type: "text", text: TARGET_TEXT }] },
      { role: "assistant", provenance: "model", blocks: [{ type: "tool_call", call_id: "call-1", name: "judgment_decision" }] },
    ],
    tools: [{ name: "judgment_decision" }],
    base_refs: [{ ref: "base-1" }],
    observation_refs: ["obs-1"],
    used_refs: [],
    projection: { target: "chat_completions" },
    call_ids: ["call-1"],
    ...overrides,
  };
}

function segmentHeaderFor(transcript, headerOverrides = {}) {
  return {
    version: SEGMENT_VERSION,
    run: transcript.run,
    system: transcript.system,
    tools: transcript.tools,
    projection: transcript.projection,
    base_refs: transcript.base_refs,
    observation_refs: transcript.observation_refs,
    used_refs: transcript.used_refs,
    call_ids: transcript.call_ids,
    ...headerOverrides,
  };
}

function checkpointFor(runId = RUN) {
  return {
    agent_run: {
      run_id: runId,
      checkpoint_version: 3,
      authoring_segment_ref: { run_id: runId, version: SEGMENT_VERSION },
      status: "completed",
      run_mode: "durable",
    },
    progress: 100,
  };
}

function jsonColumn(value) {
  if (value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

// 段头/消息行写入：默认从内存 transcript 派生；变体用于负例（版本/身份/形状/消息 JSON）。
function insertSegment(db, {
  run_id = RUN,
  transcript = transcriptFor(),
  segment_version = SEGMENT_VERSION,
  header_overrides = {},
  message_json = null,
  message_rows = null,
  omit = null,
} = {}) {
  if (omit === "segment" || transcript === null) return;
  const header = { ...segmentHeaderFor(transcript, header_overrides), version: segment_version };
  const rawMessages = message_rows ?? transcript.messages;
  const messages = Array.isArray(rawMessages) ? rawMessages : [];
  db.prepare(
    "INSERT INTO authoring_run_segments (run_id, workspace_id, work_id, session_id, parent_turn_ref, header, message_count, first_sequence, last_sequence, format_version) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    run_id,
    transcript.run.workspace_id,
    transcript.run.work_id,
    transcript.run.session_id,
    transcript.run.parent_turn_ref,
    JSON.stringify(header),
    messages.length,
    1,
    messages.length,
    SEGMENT_VERSION,
  );
  if (omit === "messages") return;
  messages.forEach((message, index) => {
    db.prepare(
      "INSERT INTO authoring_session_messages (id, workspace_id, work_id, session_id, run_id, sequence, run_sequence, role, message, format_version) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      `msg-${run_id}-${index + 1}`,
      transcript.run.workspace_id,
      transcript.run.work_id,
      transcript.run.session_id,
      run_id,
      index + 1,
      index + 1,
      typeof message?.role === "string" ? message.role : "",
      message_json ?? JSON.stringify(message),
      MESSAGE_VERSION,
    );
  });
}

function insertRun(db, {
  id = RUN,
  workspace_id = WORKSPACE,
  work_id = WORK,
  session_id = SESSION,
  parent_turn_ref = PARENT,
  long_run_task_ref = TASK,
  run_mode = "durable",
  transcript = transcriptFor(),
  segment = {},
} = {}) {
  db.prepare(
    "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, run_mode, status, plan_version, consumed_budget, pending_artifact_refs) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    workspace_id,
    work_id,
    session_id,
    parent_turn_ref,
    long_run_task_ref,
    run_mode,
    "completed",
    2,
    JSON.stringify({ provider_calls: 2, replans: 1 }),
    JSON.stringify(["artifact-1"]),
  );
  insertSegment(db, { run_id: id, transcript, ...segment });
}

function insertTask(db, { id = TASK, workspace_id = WORK, parent_turn_ref = PARENT, checkpoint_data = checkpointFor(), scope_ref = null, updated_at = "2026-11-01 08:00:00.000000" } = {}) {
  db.prepare(
    "INSERT INTO long_run_tasks (id, workspace_id, parent_turn_ref, checkpoint_data, scope_ref, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, workspace_id, parent_turn_ref, jsonColumn(checkpoint_data), scope_ref, updated_at);
}

function createBatch({ run, task, extraRuns = [], extraTasks = [], runSegment } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-history-"));
  const file = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(
      "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, " +
        "parent_turn_ref TEXT, long_run_task_ref TEXT, run_mode TEXT, status TEXT, plan_version INTEGER, " +
        "consumed_budget TEXT, pending_artifact_refs TEXT)",
    );
    db.exec(
      "CREATE TABLE long_run_tasks (id TEXT PRIMARY KEY, workspace_id TEXT, parent_turn_ref TEXT, " +
        "checkpoint_data TEXT, scope_ref TEXT, updated_at TEXT)",
    );
    db.exec(
      "CREATE TABLE authoring_run_segments (run_id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, " +
        "session_id TEXT, parent_turn_ref TEXT, header TEXT, message_count INTEGER, first_sequence INTEGER, " +
        "last_sequence INTEGER, format_version TEXT)",
    );
    db.exec(
      "CREATE TABLE authoring_session_messages (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, " +
        "session_id TEXT, run_id TEXT, sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT, " +
        "format_version TEXT)",
    );
    if (run !== null) insertRun(db, run);
    if (task !== null) insertTask(db, task);
    for (const row of extraRuns) insertRun(db, row);
    for (const row of extraTasks) insertTask(db, row);
    if (runSegment !== undefined) insertSegment(db, runSegment);
  } finally {
    db.close();
  }
  return dir;
}

function withCleanup(build, run) {
  const dir = build();
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function decoys() {
  // 更晚的 task 同时命中旧实现的 parent_turn_ref OR scope_ref 与 ORDER BY updated_at DESC。
  return {
    extraRuns: [{
      id: "run-newer",
      session_id: "session-2",
      long_run_task_ref: "task-newer",
      transcript: transcriptFor({
        run: { run_id: "run-newer", workspace_id: WORKSPACE, work_id: WORK, session_id: "session-2", parent_turn_ref: PARENT },
        messages: [{ role: "user", provenance: "author", blocks: [{ type: "text", text: "更晚 run 的原话" }] }],
      }),
    }],
    extraTasks: [{
      id: "task-newer",
      checkpoint_data: checkpointFor("run-newer"),
      scope_ref: RUN,
      updated_at: "2026-11-02 08:00:00.000000",
    }],
  };
}

function expectHistoryFailure(dir, overrides, pattern) {
  assert.throws(() => readAuthoringHistory(dir, scope(overrides)), pattern);
}

test("正确会话执行段只读取目标 run 的 canonical 历史", () => {
  withCleanup(
    () => createBatch({ run: {}, task: {}, ...decoys() }),
    (dir) => {
      const value = readAuthoringHistory(dir, scope());
      assert.equal(value.record.id, RUN);
      assert.equal(value.transcript.run.run_id, RUN);
      assert.deepEqual(value.transcript.messages, transcriptFor().messages);
      assert.equal(value.segment.message_count, transcriptFor().messages.length);
      assert.deepEqual(value.budget, { provider_calls: 2, replans: 1 });
      assert.deepEqual(value.pending, ["artifact-1"]);
    },
  );
});

test("bounded 成功以会话执行段为唯一源，不要求也不读取 long_run_task", () => {
  withCleanup(
    () => createBatch({
      run: { run_mode: "bounded", long_run_task_ref: null },
      task: null,
      extraTasks: [{ id: "task-decoy", checkpoint_data: checkpointFor("run-decoy") }],
    }),
    (dir) => {
      const value = readAuthoringHistory(dir, scope());
      assert.equal(value.mode, "bounded");
      assert.equal(value.record.run_mode, "bounded");
      assert.equal(value.record.id, RUN);
      assert.equal(value.task, null);
      assert.equal(value.checkpoint, null);
      assert.equal(value.transcript.run.run_id, RUN);
      assert.deepEqual(value.transcript.messages, transcriptFor().messages);
      assert.deepEqual(value.budget, { provider_calls: 2, replans: 1 });
    },
  );
});

test("bounded 会话执行段缺失、版本错误或身份错绑都失败", () => {
  const bounded = { run_mode: "bounded", long_run_task_ref: null };
  for (const [run, pattern] of [
    [{ ...bounded, transcript: null }, /run 执行段缺失/],
    [{ ...bounded, segment: { segment_version: "authoring-run-segment/v0" } }, /run 执行段版本错误/],
    [{
      ...bounded,
      segment: {
        header_overrides: {
          run: { run_id: RUN, workspace_id: WORKSPACE, work_id: WORK, session_id: "session-other", parent_turn_ref: PARENT },
        },
      },
    }, /canonical 身份/],
  ]) {
    withCleanup(
      () => createBatch({ run, task: null }),
      (dir) => expectHistoryFailure(dir, {}, pattern),
    );
  }
});

test("durable 成功继续核验同一 task 的 work/parent、v3 checkpoint 与段引用", () => {
  withCleanup(
    () => createBatch({ run: {}, task: {}, ...decoys() }),
    (dir) => {
      const value = readAuthoringHistory(dir, scope());
      assert.equal(value.mode, "durable");
      assert.equal(value.record.id, RUN);
      assert.equal(value.task.id, TASK);
      assert.equal(value.checkpoint.agent_run.checkpoint_version, 3);
      assert.deepEqual(
        value.checkpoint.agent_run.authoring_segment_ref,
        { run_id: RUN, version: SEGMENT_VERSION },
      );
    },
  );
});

test("未知或缺失 run_mode 直接失败，不回退到任一种读取模式", () => {
  for (const run_mode of [null, "", "sideways", "DURABLE"]) {
    withCleanup(
      () => createBatch({ run: { run_mode, long_run_task_ref: null }, task: null }),
      (dir) => expectHistoryFailure(dir, {}, /未知 run_mode/),
    );
  }
});

test("durable 缺 task 或段引用时不回退 bounded 读取", () => {
  withCleanup(
    () => createBatch({ run: {}, task: null }),
    (dir) => expectHistoryFailure(dir, {}, /long_run_task_ref 指向的 task 不存在/),
  );
  for (const long_run_task_ref of [null, ""]) {
    withCleanup(
      () => createBatch({ run: { long_run_task_ref }, task: null }),
      (dir) => expectHistoryFailure(dir, {}, /long_run_task_ref 缺失/),
    );
  }
  const checkpoint = checkpointFor();
  delete checkpoint.agent_run.authoring_segment_ref;
  withCleanup(
    () => createBatch({ task: { checkpoint_data: checkpoint } }),
    (dir) => expectHistoryFailure(dir, {}, /authoring_segment_ref/),
  );
});

test("durable 的 task 不是 run 引用时失败", () => {
  withCleanup(
    () => createBatch({
      run: { long_run_task_ref: "task-other" },
      task: {},
    }),
    (dir) => expectHistoryFailure(dir, {}, /task 不存在/),
  );
});

test("同 parent 的其他 run 和更晚 task 不会被 latest/OR 猜取", () => {
  withCleanup(
    () => createBatch({ run: {}, task: {}, ...decoys() }),
    (dir) => {
      const value = readAuthoringHistory(dir, scope());
      assert.equal(value.record.long_run_task_ref, TASK);
      assert.ok(!JSON.stringify(value.transcript).includes("更晚 run 的原话"));
    },
  );
});

test("session 不是本批事实时精确查询失败", () => {
  withCleanup(
    () => createBatch({ run: {}, task: {}, ...decoys() }),
    (dir) => expectHistoryFailure(dir, { session_id: "session-2" }, /恰好一行/),
  );
});

test("run 不存在时失败而不回退旧数据", () => {
  withCleanup(
    () => createBatch(),
    (dir) => expectHistoryFailure(dir, { run_id: "run-missing" }, /恰好一行/),
  );
});

test("task parent 与 run 不一致时失败", () => {
  withCleanup(
    () => createBatch({ task: { parent_turn_ref: "message-other" } }),
    (dir) => expectHistoryFailure(dir, {}, /task parent_turn_ref/),
  );
});

test("task workspace 与 run work 不一致时失败", () => {
  withCleanup(
    () => createBatch({ task: { workspace_id: "work-other" } }),
    (dir) => expectHistoryFailure(dir, {}, /task 不属于同一作品/),
  );
});

test("agent_runs workspace 与本批 workspace 不一致时失败", () => {
  withCleanup(
    () => createBatch({ run: { workspace_id: "workspace-other" } }),
    (dir) => expectHistoryFailure(dir, {}, /恰好一行/),
  );
});

test("段引用的 run_id 错绑时失败", () => {
  const checkpoint = checkpointFor();
  checkpoint.agent_run.authoring_segment_ref.run_id = "run-other";
  withCleanup(
    () => createBatch({ task: { checkpoint_data: checkpoint } }),
    (dir) => expectHistoryFailure(dir, {}, /authoring_segment_ref/),
  );
});

test("段引用的版本错误时失败", () => {
  const checkpoint = checkpointFor();
  checkpoint.agent_run.authoring_segment_ref.version = "authoring-transcript/v0";
  withCleanup(
    () => createBatch({ task: { checkpoint_data: checkpoint } }),
    (dir) => expectHistoryFailure(dir, {}, /authoring_segment_ref/),
  );
});

test("checkpoint 不是 v3 时失败", () => {
  const checkpoint = checkpointFor();
  checkpoint.agent_run.checkpoint_version = 2;
  withCleanup(
    () => createBatch({ task: { checkpoint_data: checkpoint } }),
    (dir) => expectHistoryFailure(dir, {}, /不是 v3/),
  );
});

test("会话执行段形状损坏时即使存在合法旧内嵌副本也失败", () => {
  const checkpoint = checkpointFor();
  checkpoint.authoring_transcript = { version: "authoring-transcript/v1", transcript: transcriptFor() };
  for (const segment of [
    { header_overrides: { tools: ["不是对象"] } },
    { header_overrides: { used_refs: "不是数组" } },
    { header_overrides: { base_refs: [""] } },
    { header_overrides: { observation_refs: [{}] } },
    { message_rows: [{ role: "user" }] },
  ]) {
    withCleanup(
      () => createBatch({ task: { checkpoint_data: checkpoint }, run: { segment } }),
      (dir) => expectHistoryFailure(dir, {}, /canonical transcript 形状非法/),
    );
  }
});

test("会话执行段缺失或消息 JSON 损坏时失败", () => {
  withCleanup(
    () => createBatch({ run: { transcript: null } }),
    (dir) => expectHistoryFailure(dir, {}, /run 执行段缺失/),
  );
  withCleanup(
    () => createBatch({ run: { segment: { message_json: "{" } } }),
    (dir) => expectHistoryFailure(dir, {}, /canonical 消息 JSON/),
  );
  withCleanup(
    () => createBatch({ task: { checkpoint_data: null } }),
    (dir) => expectHistoryFailure(dir, {}, /checkpoint_data 缺失/),
  );
  withCleanup(
    () => createBatch({ task: { checkpoint_data: "{" } }),
    (dir) => expectHistoryFailure(dir, {}, /checkpoint_data JSON/),
  );
  for (const checkpoint_data of ['"不是对象"', "[]"]) {
    withCleanup(
      () => createBatch({ task: { checkpoint_data } }),
      (dir) => expectHistoryFailure(dir, {}, /checkpoint_data 必须是对象/),
    );
  }
});

test("canonical 身份与 DB 行不一致时失败", () => {
  const transcript = transcriptFor({
    run: { run_id: RUN, workspace_id: WORKSPACE, work_id: WORK, session_id: "session-other", parent_turn_ref: PARENT },
  });
  withCleanup(
    () => createBatch({ run: { transcript } }),
    (dir) => expectHistoryFailure(dir, {}, /canonical 身份/),
  );
});

const topic = `workspace:${WORKSPACE}`;
const otherTopic = `workspace:${WORKSPACE}-other`;
const T0 = "2026-11-01T08:00:00.000Z";
const T1 = "2026-11-01T08:00:00.100Z";
const T2 = "2026-11-01T08:00:00.200Z";
const T3 = "2026-11-01T08:00:00.300Z";
const T4 = "2026-11-01T08:00:01.000Z";
const T5 = "2026-11-01T08:00:02.000Z";

function joinRecord(joinRef, session, at, { topic: frameTopic = topic, direction = "sent", event = "phx_join", requestRef = joinRef } = {}) {
  return { direction, at, frame: [joinRef, requestRef, frameTopic, event, { work_id: WORK, session_id: session }] };
}

function replyRecord(joinRef, session, at, { topic: frameTopic = topic, direction = "received", event = "phx_reply", requestRef = joinRef, status = "ok", joined = true, workId = WORK } = {}) {
  return {
    direction,
    at,
    frame: [joinRef, requestRef, frameTopic, event, { status, response: { joined, work_id: workId, session_id: session } }],
  };
}

function messageRecord(joinRef, requestRef, at, { topic: frameTopic = topic, session = SESSION, workId = WORK, turnId = PARENT } = {}) {
  return {
    direction: "sent",
    at,
    frame: [joinRef, requestRef, frameTopic, "user_message", { turn_id: turnId, work_id: workId, session_id: session }],
  };
}

const oldJoin = joinRecord("1", "session-old", T0);
const oldReply = replyRecord("1", "session-old", T1);
const currentJoin = joinRecord("3", SESSION, T2);
const currentReply = replyRecord("3", SESSION, T3);
const input = messageRecord("3", "4", T4);
const scopeFor = (wire, message = input) => authoringScope(wire, message, { workId: WORK, parentTurnId: PARENT });

test("authoringScope 按作者输入自己的 join_ref 绑定当前 join 生命周期", () => {
  assert.deepEqual(scopeFor([oldJoin, oldReply, currentJoin, currentReply, input]), {
    workspace_id: WORKSPACE,
    work_id: WORK,
    session_id: SESSION,
    parent_turn_ref: PARENT,
  });
  // join、join 回复与作者输入同一时刻到达时仍属于本批事实。
  assert.deepEqual(scopeFor([{ ...currentJoin, at: input.at }, { ...currentReply, at: input.at }, input]), {
    workspace_id: WORKSPACE,
    work_id: WORK,
    session_id: SESSION,
    parent_turn_ref: PARENT,
  });
});

test("旧会话退出后新 join 是正常生命周期，不按历史 join 判歧义", () => {
  assert.equal(scopeFor([oldJoin, oldReply, currentJoin, currentReply, input]).session_id, SESSION);
});

test("其它 topic/方向/event/ref/时间窗干扰帧不能确认当前 join", () => {
  const wire = [
    oldJoin,
    oldReply,
    joinRecord("3", "session-other", T1, { topic: otherTopic }),
    joinRecord("3", "session-other", T1, { direction: "received" }),
    joinRecord("3", "session-other", T1, { event: "phx_join_other" }),
    joinRecord("9", "session-9", T1),
    joinRecord("9", "session-9", T1, { requestRef: "3" }),
    joinRecord("3", "session-9", T1, { requestRef: "7" }),
    joinRecord("3", SESSION, T5),
    currentJoin,
    replyRecord("3", "session-other", T1, { topic: otherTopic }),
    replyRecord("3", "session-other", T1, { direction: "sent" }),
    replyRecord("3", "session-other", T1, { event: "phx_reply_other" }),
    replyRecord("9", "session-9", T1),
    replyRecord("9", "session-other", T3, { requestRef: "3" }),
    replyRecord("3", "session-other", T1, { requestRef: "9" }),
    replyRecord("3", "session-other", T1),
    replyRecord("3", "session-other", T5),
    replyRecord("3", "session-other", T3, { requestRef: "4" }),
    currentReply,
    input,
  ];
  assert.deepEqual(scopeFor(wire), { workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION, parent_turn_ref: PARENT });
});

test("同 channel 其它 request 回复、旧生命周期回复或窗口外回复不能确认 join", () => {
  for (const wire of [
    [currentJoin, replyRecord("3", SESSION, T1), input],
    [currentJoin, replyRecord("3", SESSION, T3, { requestRef: "9" }), input],
    [currentJoin, oldReply, input],
    [currentJoin, replyRecord("3", SESSION, T3, { topic: otherTopic }), input],
    [currentJoin, replyRecord("3", SESSION, T3, { direction: "sent" }), input],
    [currentJoin, replyRecord("3", SESSION, T3, { event: "phx_reply_other" }), input],
    [currentJoin, replyRecord("3", SESSION, T5), input],
    [currentJoin, currentReply, replyRecord("3", SESSION, T3), input],
  ]) {
    assert.throws(() => scopeFor(wire), /join 回复/);
  }
});

test("authoringScope 拒绝缺失、错绑或多义的当前生命周期", () => {
  assert.throws(() => scopeFor([input]), /缺本批 join 帧/);
  assert.throws(() => scopeFor([currentJoin, input]), /join 回复/);
  assert.throws(() => scopeFor([currentJoin, joinRecord("3", SESSION, T2), currentReply, input]), /多义/);
  assert.throws(() => scopeFor([joinRecord("3", SESSION, T2, { requestRef: "7" }), replyRecord("3", SESSION, T3, { requestRef: "7" }), input]), /缺本批 join 帧/);
  assert.throws(() => scopeFor([joinRecord("3", "session-other", T2), replyRecord("3", "session-other", T3), input]), /join session/);
  assert.throws(() => scopeFor([currentJoin, replyRecord("3", "session-other", T3), input]), /join 回复 session/);
  assert.throws(() => scopeFor([currentJoin, replyRecord("3", SESSION, T3, { status: "error" }), input]), /join 未成功/);
  assert.throws(() => scopeFor([currentJoin, replyRecord("3", SESSION, T3, { joined: false }), input]), /join 未确认/);
  assert.throws(() => scopeFor([currentJoin, replyRecord("3", SESSION, T3, { workId: "work-other" }), input]), /join 回复 work/);
});

test("authoringScope 拒绝非 workspace topic、缺失作者输入和错绑 turn/work", () => {
  assert.throws(() => scopeFor([currentJoin, currentReply, input], { ...input, frame: ["3", "4", "workspace:", "user_message", { turn_id: PARENT, work_id: WORK, session_id: SESSION }] }), /topic 缺 workspace/);
  assert.throws(() => scopeFor([currentJoin, currentReply, input], { ...input, frame: ["", "4", topic, "user_message", { turn_id: PARENT, work_id: WORK, session_id: SESSION }] }), /message.join_ref/);
  assert.throws(() => scopeFor([currentJoin, currentReply, input], messageRecord("3", "4", T4, { workId: "work-other" })), /作者输入 work/);
  assert.throws(() => scopeFor([currentJoin, currentReply, input], messageRecord("3", "4", T4, { turnId: "message-other" })), /作者输入 turn/);
  assert.throws(() => scopeFor([currentJoin, currentReply, input], { ...input, frame: ["3", "4", topic, "user_message", { turn_id: PARENT, work_id: WORK }] }), /message.session_id/);
  assert.throws(() => authoringScope([currentJoin, currentReply, input], {}, { workId: WORK, parentTurnId: PARENT }), /缺真实 WS 帧/);
  assert.throws(() => authoringScope([currentJoin, currentReply, input], input, { workId: "", parentTurnId: PARENT }), /必须是非空字符串/);
  assert.throws(() => authoringScope([currentJoin, currentReply, input], input, { workId: WORK, parentTurnId: 7 }), /必须是非空字符串/);
});

test("重连后 join_ref 复用：按作者输入所在连接段选择最新 join（cp4b-pending-04 真实形状）", () => {
  const reconnectJoin = joinRecord("3", SESSION, T5);
  const reconnectReply = replyRecord("3", SESSION, "2026-11-01T08:00:02.100Z");
  const followup = messageRecord("3", "4", "2026-11-01T08:00:03.000Z");
  const wire = [oldJoin, oldReply, currentJoin, currentReply, input, reconnectJoin, reconnectReply, followup];

  // 旧消息仍绑定旧连接段（后续新 join 不改写既有作者输入的 join 归属）。
  assert.deepEqual(scopeFor(wire, input), {
    workspace_id: WORKSPACE,
    work_id: WORK,
    session_id: SESSION,
    parent_turn_ref: PARENT,
  });
  // 重连后的作者消息绑定最新连接段的 join + 其自己的 join 回复。
  assert.equal(scopeFor(wire, followup).session_id, SESSION);
  // 重连 join 缺对应回复时失败关闭（不能借用旧连接的 join 回复）。
  assert.throws(() => scopeFor([oldJoin, oldReply, currentJoin, currentReply, input, reconnectJoin, followup], followup), /join 回复/);
});
