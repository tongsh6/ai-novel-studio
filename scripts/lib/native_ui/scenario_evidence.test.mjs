// 共享请求/广播证据边界的纯行为测试：真实 Phoenix 帧形状的选择与失败关闭。
// 真实 git/文件目录/SQLite 证据在邻接 `scenario_evidence_io.test.mjs`；本文件不建
// 目录/DB、不启动子进程。
import assert from "node:assert/strict";
import test from "node:test";
import {
  broadcastFrames,
  requestIdentity,
  requestReplies,
  sentUserMessages,
  turnFacts,
} from "./scenario_evidence.mjs";

const TOPIC = "workspace:scope";
const T0 = "2026-11-02T02:00:00.000Z";
const T1 = "2026-11-02T02:00:00.100Z";
const T2 = "2026-11-02T02:00:00.200Z";
const T3 = "2026-11-02T02:00:00.300Z";

const frame = (joinRef, requestRef, topic, event, body, direction = "received", at = T0) => ({
  direction,
  at,
  frame: [joinRef, requestRef, topic, event, body],
});

const sent = (at = T0) =>
  frame("join-1", "request-1", TOPIC, "user_message", { turn_id: "turn-1", text: "输入" }, "sent", at);

const reply = (body, { joinRef = "join-1", requestRef = "request-1", topic = TOPIC, at = T1 } = {}) =>
  frame(joinRef, requestRef, topic, "phx_reply", body, "received", at);

const okReply = (runId = "run-1") => reply({
  status: "ok",
  response: { turn_id: "turn-1", run_id: runId },
});

const result = (body, { topic = TOPIC, at = T2 } = {}) =>
  frame(null, null, topic, "turn_result", body, "received", at);

const event = (body, { topic = TOPIC, at = T2, direction = "received" } = {}) =>
  frame(null, null, topic, "agent_event", body, direction, at);

test("turnFacts 用作者消息自己的 join_ref/request_ref/topic 绑定唯一 ACK", () => {
  const message = sent();
  const ack = okReply();
  const facts = turnFacts([message, ack, result({ agent_run: { run_id: "run-1" } })], message);
  assert.equal(facts.turnId, "turn-1");
  assert.equal(facts.ack, ack);
  assert.equal(facts.results.length, 1);
  assert.equal(facts.results[0].frame[2], TOPIC);
});

test("turnFacts 拒绝缺失、错方向或错请求身份的 ACK", () => {
  const message = sent();
  const turnResult = result({ agent_run: { run_id: "run-1" } });
  const cases = [
    reply({ status: "ok", response: { turn_id: "turn-1" } }, { joinRef: "join-foreign" }),
    reply({ status: "ok", response: { turn_id: "turn-1" } }, { requestRef: "request-foreign" }),
    reply({ status: "ok", response: { turn_id: "turn-1" } }, { topic: "workspace:foreign" }),
    reply({ status: "ok", response: { turn_id: "turn-1" } }, { at: "2026-11-01T23:59:59.000Z" }),
  ];
  for (const candidate of cases) {
    assert.equal(turnFacts([message, candidate, turnResult], message).ack, undefined);
  }
});

test("turnFacts 对同一请求多个 ACK 失败，不任选第一个", () => {
  const message = sent();
  const turnResult = result({ agent_run: { run_id: "run-1" } });
  assert.throws(
    () => turnFacts([message, okReply("run-1"), okReply("run-2"), turnResult], message),
    /ACK 多义/,
  );
});

test("turnFacts 只把成功且 turn 匹配的 ACK 交给消费者，run_id 仍由消费者核验", () => {
  const message = sent();
  const turnResult = result({ agent_run: { run_id: "run-1" } });
  const errorAck = reply({ status: "error", response: { turn_id: "turn-1" } });
  assert.equal(turnFacts([message, errorAck, turnResult], message).ack, undefined);
  const otherTurn = reply({ status: "ok", response: { turn_id: "turn-other" } });
  assert.equal(turnFacts([message, otherTurn, turnResult], message).ack, undefined);
  const noRun = reply({ status: "ok", response: { turn_id: "turn-1" } });
  assert.equal(turnFacts([message, noRun, turnResult], message).ack, noRun);
});

test("turnFacts 只接受同 topic/接收方向/不早于发送时间的 turn_result", () => {
  const message = sent();
  const ack = okReply();
  const wire = [
    message,
    ack,
    result({ agent_run: { run_id: "run-1" } }, { topic: "workspace:foreign" }),
    result({ agent_run: { run_id: "run-1" } }, { at: "2026-11-01T23:59:59.000Z" }),
    event({ agent_run: { run_id: "run-1" } }),
    result({ agent_run: { run_id: "run-1" } }),
  ];
  const facts = turnFacts(wire, message);
  assert.equal(facts.results.length, 1);
  assert.equal(facts.results[0].frame[2], TOPIC);
});

test("turnFacts 缺 turn_id、方向、join/request/topic 或结果时关闭", () => {
  const message = sent();
  const turnResult = result({ agent_run: { run_id: "run-1" } });
  assert.throws(
    () => turnFacts([turnResult], frame("join-1", "request-1", TOPIC, "user_message", {}, "sent", T0)),
    /缺 turn_id/,
  );
  assert.throws(() => turnFacts([turnResult], { direction: "sent", at: T0 }), /缺 turn_id/);
  assert.throws(
    () => turnFacts([turnResult], frame("join-1", "request-1", TOPIC, "user_message", { turn_id: "turn-1" })),
    /必须是发送方向/,
  );
  const noAt = frame("join-1", "request-1", TOPIC, "user_message", { turn_id: "turn-1" }, "sent", T0);
  delete noAt.at;
  assert.throws(() => turnFacts([turnResult], noAt), /user_message 缺 at/);
  for (const [joinRef, requestRef, topic] of [
    [null, "request-1", TOPIC],
    ["join-1", null, TOPIC],
    ["join-1", "request-1", null],
  ]) {
    assert.throws(
      () => turnFacts(
        [turnResult],
        frame(joinRef, requestRef, topic, "user_message", { turn_id: "turn-1" }, "sent", T0),
      ),
      /缺 (join_ref|request_ref|topic)/,
    );
  }
  assert.throws(() => turnFacts([message, okReply()], message), /缺少 turn_result/);
});

test("requestIdentity/requestReplies 是请求与回复的共享边界", () => {
  const message = sent();
  const identity = requestIdentity(message);
  assert.deepEqual(identity, { joinRef: "join-1", requestRef: "request-1", topic: TOPIC });
  assert.deepEqual(
    requestReplies([message, okReply(), reply({}, { topic: "workspace:foreign" })], identity, message.at),
    [okReply()],
  );
  assert.deepEqual(requestReplies([message], identity, T1), []);

  assert.throws(
    () => requestIdentity({ direction: "received", at: T0, frame: message.frame }),
    /user_message 必须是发送方向/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", frame: message.frame }),
    /user_message 缺 at/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", at: T0, frame: [null, "request-1", TOPIC, "user_message", {}] }),
    /user_message 缺 join_ref/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", at: T0, frame: ["join-1", null, TOPIC, "user_message", {}] }),
    /user_message 缺 request_ref/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", at: T0, frame: ["join-1", "request-1", null, "user_message", {}] }),
    /user_message 缺 topic/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", at: T0 }),
    /user_message 缺真实 WS 帧/,
  );
});

test("broadcastFrames 按 owning topic/方向/event 绑定，真实 null join/ref 广播可识别", () => {
  const wire = [
    event({ event_type: "exploration_observed" }),
    event({ event_type: "exploration_observed" }, { direction: "sent" }),
    event({ event_type: "exploration_observed" }, { topic: "workspace:foreign" }),
    frame("join-1", "request-1", TOPIC, "agent_event", { event_type: "exploration_observed" }),
    { direction: "received", at: T2 },
  ];
  assert.equal(broadcastFrames(wire, { topic: TOPIC }).length, 2);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, event: "agent_event" }).length, 2);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, event: "turn_result" }).length, 0);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, direction: "sent" }).length, 1);
  assert.equal(broadcastFrames(wire, { topic: "workspace:foreign" }).length, 1);
});

test("broadcastFrames 的 at/runRef/agentRunId 过滤各自精确且可组合", () => {
  const wire = [
    event({ run_ref: "run-1", run_id: "run-1", agent_run: { run_id: "run-1" } }, { at: T1 }),
    event({ run_ref: "run-1", run_id: "run-2", agent_run: { run_id: "run-1" } }, { at: T2 }),
    event({ run_ref: "run-2", run_id: undefined, agent_run: { run_id: "run-2" } }, { at: T3 }),
    event({ run_ref: "run-1", run_id: "run-1", agent_run: { run_id: "run-2" } }, { at: T3 }),
    event({ run_ref: "run-1", run_id: "run-1" }, { at: T3 }),
    event(null, { at: T3 }),
  ];
  assert.equal(broadcastFrames(wire, { topic: TOPIC, at: T2 }).length, 5);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, runRef: "run-1" }).length, 3);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, agentRunId: "run-1" }).length, 2);
  assert.equal(
    broadcastFrames(wire, { topic: TOPIC, runRef: "run-1", agentRunId: "run-1" }).length,
    1,
  );
  assert.equal(broadcastFrames(wire, { topic: TOPIC, runRef: "run-1", at: T3 }).length, 2);
});

test("broadcastFrames 缺 owning topic 时关闭", () => {
  assert.throws(() => broadcastFrames([], {}), /缺 owning topic/);
  assert.throws(() => broadcastFrames([], { topic: "" }), /缺 owning topic/);
});

test("sentUserMessages 只选同文本的发送 user_message 并按 turn_id 去重", () => {
  const first = frame("join-1", "request-1", TOPIC, "user_message", { text: "目标", turn_id: "t1" }, "sent", T0);
  const duplicate = structuredClone(first);
  const second = frame("join-1", "request-2", TOPIC, "user_message", { text: "目标", turn_id: "t2" }, "sent", T1);
  const wire = [
    first,
    duplicate,
    second,
    frame("join-1", "request-3", TOPIC, "user_message", { text: "其它", turn_id: "t3" }, "sent", T1),
    frame("join-1", "request-4", TOPIC, "user_message", { text: "目标", turn_id: "t4" }, "received", T1),
    { direction: "sent", at: T1 },
  ];
  assert.deepEqual(sentUserMessages(wire, "目标"), [first, second]);
  assert.deepEqual(sentUserMessages([], "目标"), []);
});

test("重连后 join_ref/request_ref 复用：新连接 ACK 不得算给旧请求（真实 cp4b-pending-04 形状）", () => {
  // 真实批次 restore 后，新 socket 的 join/ref 从同一起点重新计数：followup 与 source
  // 都是 join_ref=5/request_ref=9。回复必须绑定请求所在 socket 连接段。
  const firstJoin = frame("join-1", "request-1", TOPIC, "phx_join", { session: "s" }, "sent", T0);
  const firstMessage = sent(T0);
  const firstAck = okReply("run-old");
  const secondJoin = frame("join-1", "request-1", TOPIC, "phx_join", { session: "s" }, "sent", T2);
  const secondMessage = frame(
    "join-1",
    "request-1",
    TOPIC,
    "user_message",
    { turn_id: "turn-2", text: "资料处理进度怎么样？" },
    "sent",
    T3,
  );
  const secondAck = frame(
    "join-1",
    "request-1",
    TOPIC,
    "phx_reply",
    { status: "ok", response: { turn_id: "turn-2", run_id: "run-new" } },
    "received",
    "2026-11-02T02:00:00.400Z",
  );
  const wire = [firstJoin, firstMessage, firstAck, secondJoin, secondMessage, secondAck];

  const identity = requestIdentity(firstMessage);
  assert.deepEqual(requestReplies(wire, identity, firstMessage.at), [firstAck]);

  // 旧连接内本请求的 ACK 缺失时失败关闭（不能借用新连接同 ref 的 ACK）。
  assert.deepEqual(requestReplies([firstJoin, firstMessage, secondJoin, secondMessage, secondAck], identity, firstMessage.at), []);

  // turnFacts 走同一共享边界：旧请求只认旧连接的 ACK。
  const results = result({ agent_run: { run_id: "run-old" } }, { at: "2026-11-02T02:00:00.150Z" });
  const facts = turnFacts([firstJoin, firstMessage, firstAck, results, secondJoin, secondMessage, secondAck], firstMessage);
  assert.equal(facts.ack, firstAck);
});
