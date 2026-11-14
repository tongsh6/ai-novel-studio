// B71 canonical 历史读取族：真实 4 表 SQLite 与 WS 帧形状的只读断言/负例矩阵。
// DDL/seed/批次构造在 `fixtures/authoring_history_fixture.mjs`（唯一 owner）；本文件
// 只保留各规格的 case 变体，不重复 DDL。该族负例是不同 DB 规格（run_mode/身份/
// 段版本/形状/checkpoint），按 A2 规则不合并成共享模板；目录落在 run scope 的 work
// 区并由 case 结束时回收。
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { authoringScope, readAuthoringHistory } from "./authoring_history_evidence.mjs";
import { openTestRunScope } from "../test_env.mjs";
import {
  HISTORY_PARENT as PARENT,
  HISTORY_RUN as RUN,
  HISTORY_SESSION as SESSION,
  HISTORY_TASK as TASK,
  HISTORY_TEXT as TARGET_TEXT,
  HISTORY_WORK as WORK,
  HISTORY_WORKSPACE as WORKSPACE,
  SEGMENT_VERSION,
  checkpointFor,
  createHistoryBatch,
  transcriptFor,
} from "./fixtures/authoring_history_fixture.mjs";

const scope = (overrides = {}) => ({
  run_id: RUN,
  workspace_id: WORKSPACE,
  work_id: WORK,
  session_id: SESSION,
  parent_turn_ref: PARENT,
  ...overrides,
});

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function createBatch(options = {}) {
  return createHistoryBatch({ ...options, workDir: runScope.workDir });
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

