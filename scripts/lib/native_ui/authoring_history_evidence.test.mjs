// B71 私有历史读取的真实验收消费者测试：只读临时 SQLite + 真实 WS 帧形状。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { authoringScope, readAuthoringHistory } from "./authoring_history_evidence.mjs";

const VERSION = "authoring-transcript/v1";
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

const privateFor = (overrides = {}) => ({ version: VERSION, transcript: transcriptFor(), ...overrides });

function checkpointFor(runId = RUN) {
  return {
    agent_run: {
      run_id: runId,
      checkpoint_version: 3,
      authoring_transcript_ref: { run_id: runId, version: VERSION },
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

function insertRun(db, { id = RUN, workspace_id = WORKSPACE, work_id = WORK, session_id = SESSION, parent_turn_ref = PARENT, long_run_task_ref = TASK, run_mode = "durable", private_history = privateFor() } = {}) {
  db.prepare(
    "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, run_mode, status, plan_version, consumed_budget, pending_artifact_refs, authoring_transcript) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    jsonColumn(private_history),
  );
}

function insertTask(db, { id = TASK, workspace_id = WORK, parent_turn_ref = PARENT, checkpoint_data = checkpointFor(), scope_ref = null, updated_at = "2026-11-01 08:00:00.000000" } = {}) {
  db.prepare(
    "INSERT INTO long_run_tasks (id, workspace_id, parent_turn_ref, checkpoint_data, scope_ref, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, workspace_id, parent_turn_ref, jsonColumn(checkpoint_data), scope_ref, updated_at);
}

function createBatch({ run, task, extraRuns = [], extraTasks = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-history-"));
  const file = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(
      "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, " +
        "parent_turn_ref TEXT, long_run_task_ref TEXT, run_mode TEXT, status TEXT, plan_version INTEGER, " +
        "consumed_budget TEXT, pending_artifact_refs TEXT, authoring_transcript TEXT)",
    );
    db.exec(
      "CREATE TABLE long_run_tasks (id TEXT PRIMARY KEY, workspace_id TEXT, parent_turn_ref TEXT, " +
        "checkpoint_data TEXT, scope_ref TEXT, updated_at TEXT)",
    );
    if (run !== null) insertRun(db, run);
    if (task !== null) insertTask(db, task);
    for (const row of extraRuns) insertRun(db, row);
    for (const row of extraTasks) insertTask(db, row);
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
      private_history: privateFor({
        transcript: transcriptFor({
          run: { run_id: "run-newer", workspace_id: WORKSPACE, work_id: WORK, session_id: "session-2", parent_turn_ref: PARENT },
          messages: [{ role: "user", provenance: "author", blocks: [{ type: "text", text: "更晚 run 的原话" }] }],
        }),
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

test("正确 v3 只读取目标 run 的私有 canonical", () => {
  withCleanup(
    () => createBatch({ run: {}, task: {}, ...decoys() }),
    (dir) => {
      const value = readAuthoringHistory(dir, scope());
      assert.equal(value.record.id, RUN);
      assert.equal(value.transcript.run.run_id, RUN);
      assert.deepEqual(value.transcript.messages, transcriptFor().messages);
      assert.deepEqual(value.budget, { provider_calls: 2, replans: 1 });
      assert.deepEqual(value.pending, ["artifact-1"]);
    },
  );
});

test("bounded 成功以私有 canonical 为唯一源，不要求也不读取 long_run_task", () => {
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

test("bounded 私有 canonical 缺失、版本错误或身份错绑都失败", () => {
  const bounded = { run_mode: "bounded", long_run_task_ref: null };
  for (const [run, pattern] of [
    [{ ...bounded, private_history: null }, /私有 transcript 缺失/],
    [{ ...bounded, private_history: privateFor({ version: "authoring-transcript/v0" }) }, /私有 transcript 版本错误/],
    [{
      ...bounded,
      private_history: privateFor({
        transcript: transcriptFor({
          run: { run_id: RUN, workspace_id: WORKSPACE, work_id: WORK, session_id: "session-other", parent_turn_ref: PARENT },
        }),
      }),
    }, /canonical 身份/],
  ]) {
    withCleanup(
      () => createBatch({ run, task: null }),
      (dir) => expectHistoryFailure(dir, {}, pattern),
    );
  }
});

test("durable 成功继续核验同一 task 的 work/parent、v3 checkpoint 与 ref", () => {
  withCleanup(
    () => createBatch({ run: {}, task: {}, ...decoys() }),
    (dir) => {
      const value = readAuthoringHistory(dir, scope());
      assert.equal(value.mode, "durable");
      assert.equal(value.record.id, RUN);
      assert.equal(value.task.id, TASK);
      assert.equal(value.checkpoint.agent_run.checkpoint_version, 3);
      assert.deepEqual(
        value.checkpoint.agent_run.authoring_transcript_ref,
        { run_id: RUN, version: VERSION },
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

test("durable 缺 task 或 ref 时不回退 bounded 私有读取", () => {
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
  delete checkpoint.agent_run.authoring_transcript_ref;
  withCleanup(
    () => createBatch({ task: { checkpoint_data: checkpoint } }),
    (dir) => expectHistoryFailure(dir, {}, /authoring_transcript_ref/),
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

test("checkpoint ref 的 run_id 错绑时失败", () => {
  const checkpoint = checkpointFor();
  checkpoint.agent_run.authoring_transcript_ref.run_id = "run-other";
  withCleanup(
    () => createBatch({ task: { checkpoint_data: checkpoint } }),
    (dir) => expectHistoryFailure(dir, {}, /authoring_transcript_ref/),
  );
});

test("checkpoint ref 的版本错误时失败", () => {
  const checkpoint = checkpointFor();
  checkpoint.agent_run.authoring_transcript_ref.version = "authoring-transcript/v0";
  withCleanup(
    () => createBatch({ task: { checkpoint_data: checkpoint } }),
    (dir) => expectHistoryFailure(dir, {}, /authoring_transcript_ref/),
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

test("私有 transcript 损坏时即使存在合法旧内嵌副本也失败", () => {
  const checkpoint = checkpointFor();
  checkpoint.authoring_transcript = privateFor();
  for (const transcript of [
    transcriptFor({ messages: { not: "an array" } }),
    transcriptFor({ messages: [{ role: "user" }] }),
    transcriptFor({ tools: ["不是对象"] }),
    transcriptFor({ used_refs: "不是数组" }),
    transcriptFor({ base_refs: [""] }),
    transcriptFor({ observation_refs: [{}] }),
  ]) {
    withCleanup(
      () => createBatch({ task: { checkpoint_data: checkpoint }, run: { private_history: privateFor({ transcript }) } }),
      (dir) => expectHistoryFailure(dir, {}, /canonical transcript 形状非法/),
    );
  }
});

test("私有列缺失或 JSON 损坏时失败", () => {
  withCleanup(
    () => createBatch({ run: { private_history: null } }),
    (dir) => expectHistoryFailure(dir, {}, /私有 transcript 缺失/),
  );
  withCleanup(
    () => createBatch({ run: { private_history: "{" } }),
    (dir) => expectHistoryFailure(dir, {}, /私有 transcript JSON/),
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
  const private_history = privateFor({
    transcript: transcriptFor({
      run: { run_id: RUN, workspace_id: WORKSPACE, work_id: WORK, session_id: "session-other", parent_turn_ref: PARENT },
    }),
  });
  withCleanup(
    () => createBatch({ run: { private_history } }),
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
