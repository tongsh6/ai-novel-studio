// B71 run 证据纯事实：真实帧形状选择、completed 精确匹配、探索事件 owning scope。
// 不建目录/DB；文件落盘与 4 表历史读取在邻接
// `authoring_run_evidence_io.test.mjs`，共享 `authoring_run_scenarios.mjs` 事实。
import assert from "node:assert/strict";
import test from "node:test";
import {
  ackRunId,
  authoringInput,
  completedForRun,
  explorationFacts,
  firstCompletedTurn,
  lastCompletedTurn,
} from "./authoring_run_evidence.mjs";
import {
  F_DECOY,
  F_RUN,
  F_T4,
  F_TOPIC,
  frame,
} from "./fixtures/authoring_run_scenarios.mjs";

test("作者输入与 ack run_id 只接受真实匹配帧，缺失时失败", () => {
  const sent = frame("user_message", { text: "目标输入", turn_id: "turn-1" }, "sent");
  assert.equal(
    authoringInput([frame("user_message", { text: "其它" }), sent], {
      message: "目标输入",
      missingInput: "缺少作者输入",
    }),
    sent,
  );
  assert.equal(authoringInput([sent], { message: "目标输入", missingInput: "缺少作者输入" }), sent);
  // 非帧记录没有 body，不能因可选读取缺失而抛错。
  assert.equal(
    authoringInput([{ direction: "sent", at: "2026-11-01T08:00:00.000Z" }, sent], {
      message: "目标输入",
      missingInput: "缺少作者输入",
    }),
    sent,
  );
  assert.throws(
    () => authoringInput([], { message: "目标输入", missingInput: "缺少作者输入" }),
    /缺少作者输入/,
  );
  assert.equal(
    ackRunId(frame("phx_reply", { status: "ok", response: { run_id: "run-1" } }), {
      missingAck: "缺 run_id",
    }),
    "run-1",
  );
  for (const bad of [null, frame("phx_reply", { status: "ok", response: {} }), frame("phx_reply", null)]) {
    assert.throws(() => ackRunId(bad, { missingAck: "缺 run_id" }), /缺 run_id/);
  }
});

test("completed 结果必须同时匹配 run 与 completed 状态，首/末选择各自精确", () => {
  const completed = (runId) => ({ agent_run: { run_id: runId, status: "completed" } });
  assert.equal(completedForRun(completed("run-1"), "run-1"), true);
  assert.equal(completedForRun(completed("run-2"), "run-1"), false);
  assert.equal(completedForRun({ agent_run: { run_id: "run-1", status: "failed" } }, "run-1"), false);
  assert.equal(completedForRun(null, "run-1"), false);
  assert.equal(completedForRun({}, "run-1"), false);

  const results = [
    { agent_run: { run_id: "run-1", status: "failed" } },
    completed("run-1"),
    completed("run-2"),
    completed("run-1"),
    completed("run-1"),
  ];
  assert.equal(firstCompletedTurn(results, "run-1", "缺完成结果"), results[1]);
  assert.equal(lastCompletedTurn(results, "run-1", "缺完成结果"), results[4]);
  assert.throws(() => firstCompletedTurn(results, "run-9", "缺完成结果"), /缺完成结果/);
  assert.throws(() => lastCompletedTurn(results, "run-9", "缺完成结果"), /缺完成结果/);
});

test("探索事件只认 owning scope 的 agent_event/exploration_observed 并保留真实查询顺序", () => {
  const observed = (body) => ({
    ...frame("agent_event", {
      event_type: "exploration_observed",
      run_ref: "run-1",
      run_id: "run-1",
      ...body,
    }),
  });
  const wire = [
    frame("agent_event", { event_type: "other", payload: { query: "q-0" }, run_ref: "run-1" }),
    observed({ payload: { query: "q-1" } }),
    frame("turn_result", { turn_id: "turn-1" }),
    observed({ payload: { query: "q-2" } }),
    observed({ payload: undefined }),
    frame("agent_event", null),
  ];
  const facts = explorationFacts(wire, { topic: "room:test", runId: "run-1" });
  assert.equal(facts.count, 3);
  assert.deepEqual(facts.queries, ["q-1", "q-2", undefined]);
  assert.equal(explorationFacts([], { topic: "room:test", runId: "run-1" }).count, 0);
  assert.deepEqual(explorationFacts([], { topic: "room:test", runId: "run-1" }).queries, []);
});

test("同 parent 其它 run、跨 topic/方向/错 run_ref 的探索事件不计入 owning scope", () => {
  const event = (body, { direction = "received", topic = F_TOPIC } = {}) => ({
    direction,
    at: F_T4,
    frame: [null, null, topic, "agent_event", body],
  });
  const own = (query) =>
    event({
      event_type: "exploration_observed",
      run_ref: F_RUN,
      run_id: F_RUN,
      payload: { query },
    });
  const wire = [
    own("q-1"),
    event({
      event_type: "exploration_observed",
      run_ref: F_DECOY,
      run_id: F_DECOY,
      payload: { query: "q-decoy" },
    }),
    own("q-2"),
    event(
      {
        event_type: "exploration_observed",
        run_ref: F_RUN,
        run_id: F_RUN,
        payload: { query: "q-foreign-topic" },
      },
      { topic: "workspace:foreign" },
    ),
    event(
      {
        event_type: "exploration_observed",
        run_ref: F_RUN,
        run_id: F_RUN,
        payload: { query: "q-sent" },
      },
      { direction: "sent" },
    ),
    event({
      event_type: "exploration_observed",
      run_ref: F_RUN,
      run_id: F_DECOY,
      payload: { query: "q-mismatch" },
    }),
    event({
      event_type: "exploration_observed",
      run_id: F_RUN,
      payload: { query: "q-no-run-ref" },
    }),
    event({
      event_type: "other",
      run_ref: F_RUN,
      run_id: F_RUN,
      payload: { query: "q-other" },
    }),
    event(null),
  ];
  const facts = explorationFacts(wire, { topic: F_TOPIC, runId: F_RUN });
  assert.equal(facts.count, 2);
  assert.deepEqual(facts.queries, ["q-1", "q-2"]);
  assert.throws(() => explorationFacts(wire, { topic: "", runId: F_RUN }), /探索证据缺 owning topic/);
  assert.throws(() => explorationFacts(wire, { topic: F_TOPIC, runId: "" }), /探索证据缺 owning run/);
});

test("探索事实必须显式提供合法 owning scope，空批与无 run 旧 shape 也关闭", () => {
  const tagged = [
    frame("agent_event", {
      event_type: "exploration_observed",
      run_ref: "run-1",
      run_id: "run-1",
      payload: { query: "q-1" },
    }),
  ];
  const legacy = frame("agent_event", {
    event_type: "exploration_observed",
    payload: { query: "q-legacy" },
  });
  assert.throws(() => explorationFacts(tagged), /探索证据缺 owning scope/);
  // 无 run 身份的历史合成形状不能借空 scope 返回假可用事实。
  assert.throws(() => explorationFacts([legacy]), /探索证据缺 owning scope/);
  assert.throws(() => explorationFacts([]), /探索证据缺 owning scope/);
  assert.throws(() => explorationFacts([legacy], null), /探索证据缺 owning scope/);
  assert.throws(() => explorationFacts([legacy], undefined), /探索证据缺 owning scope/);
  assert.throws(() => explorationFacts([legacy], "room:test"), /探索证据缺 owning scope/);
  // 显式 scope 下空批合法；缺 run 身份的事件不能贡献事实。
  assert.equal(explorationFacts([], { topic: "room:test", runId: "run-1" }).count, 0);
  assert.equal(explorationFacts([legacy], { topic: "room:test", runId: "run-1" }).count, 0);
});
