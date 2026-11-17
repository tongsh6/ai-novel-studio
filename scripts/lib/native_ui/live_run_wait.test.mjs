// 实模 run 终局等待与模型行为分类的纯函数测试：只认 owning turn/run 的终态，
// 不轮询固定文本；模型行为如实分类，未触发切片进 not_signed。
import assert from "node:assert/strict";
import test from "node:test";
import {
  wireTerminal,
  dbTerminal,
  classifyTurnBody,
  summarizeModelBehavior,
  notSignedSlices,
} from "./live_run_wait.mjs";

const TOPIC = "workspace:test";
const TURN = "message_turn_1";
const RUN = "run_live_1";

const received = (event, body, at = "2026-11-03T10:00:02.000Z") => ({
  at,
  direction: "received",
  frame: [null, null, TOPIC, event, body],
});

const completedTurn = (overrides = {}) => ({
  turn_id: TURN,
  status: "conversational",
  work_id: "work-test",
  session_id: "session-test",
  agent_run: { run_id: RUN, status: "running", parent_turn_ref: TURN },
  assistant_message: { text: "已生成候选，请审阅。" },
  adoption_state: { pending: [] },
  available_actions: [],
  ...overrides,
});

const identity = { turnId: TURN, runId: RUN, topic: TOPIC, workId: "work-test", sessionId: "session-test" };
const runRow = (status = "completed", extra = {}) => ({ id: RUN, workspace_id: "test", work_id: "work-test",
  session_id: "session-test", parent_turn_ref: TURN, goal_version: 2, status, ...extra });
const state = (status = "completed", extra = {}) => received("agent_run_state", {
  run_id: RUN, workspace_id: "test", work_id: "work-test", session_id: "session-test", parent_turn_ref: TURN,
  goal: { version: 2 }, status, ...extra });
const result = (extra = {}) => received("turn_result", completedTurn(extra));

test("成功必须独立具有同run业务结果与实际终态，running业务回复不能预测或阻挡完成", () => {
  const predicted = result({ agent_run: { run_id: RUN, parent_turn_ref: TURN, status: "completed" } });
  assert.equal(wireTerminal([predicted], identity), null);
  assert.equal(wireTerminal([state()], identity), null);
  assert.equal(wireTerminal([predicted, state("running")], identity), null);
  const delivered = result({ agent_run: { run_id: RUN, parent_turn_ref: TURN, status: "running" } });
  const terminal = wireTerminal([delivered, state()], identity);
  assert.equal(terminal.kind, "completed");
  assert.equal(terminal.status, "completed");
  assert.equal(terminal.body.agent_run.status, "running");
  assert.equal(terminal.record, delivered);
  assert.equal(terminal.run_body.status, "completed");
  assert.equal(terminal.results.length, 1);
  assert.equal(wireTerminal([state(), delivered], identity).kind, "completed");
  assert.equal(wireTerminal([delivered, received("agent_event", { run_ref: RUN, event_type: "run_completed" })], identity).kind, "completed");

  const latest = result({ turn_id: TURN + ":step:2" });
  assert.equal(wireTerminal([delivered, latest, state()], { ...identity, resultPosition: "last" }).record, latest);
});

test("缺作用域、错run/parent/topic/作品/会话和旧时间的结果不能借他处终态完成", () => {
  const wire = [result(), state()];
  for (const key of ["turnId", "runId", "topic", "workId", "sessionId"])
    assert.equal(wireTerminal(wire, { ...identity, [key]: "" }), null, key);
  for (const body of [
    { agent_run: { run_id: "foreign", parent_turn_ref: TURN, status: "completed" } },
    { agent_run: { run_id: RUN, parent_turn_ref: "foreign", status: "completed" } },
    { work_id: "foreign" }, { session_id: "foreign" },
  ]) assert.equal(wireTerminal([result(body), state()], identity), null);
  const foreignTopic = result();
  foreignTopic.frame[2] = "workspace:foreign";
  assert.equal(wireTerminal([foreignTopic, state()], identity), null);
  assert.equal(wireTerminal([result(), state("completed", { run_id: "foreign" })], identity), null);
  assert.equal(wireTerminal(wire, { ...identity, since: "2026-11-03T10:00:03.000Z" }), null);
});

test("离线DB终态仍要业务交付，在线必须等实际运行回包且新鲜running压住旧完成", () => {
  const delivered = result({ agent_run: { run_id: RUN, parent_turn_ref: TURN, status: "running" } });
  const offline = { ...identity, runRow: runRow() };
  assert.equal(wireTerminal([delivered], offline).kind, "completed");
  assert.equal(wireTerminal([], offline), null);
  assert.equal(wireTerminal([delivered], { ...offline, requireWireTerminal: true }), null);
  assert.equal(wireTerminal([delivered, state()], { ...offline, requireWireTerminal: true }).kind, "completed");
  assert.equal(wireTerminal([delivered, state()], { ...offline, runRow: runRow("running") }), null);
  for (const extra of [{ id: "foreign" }, { parent_turn_ref: "foreign" },
    { workspace_id: "foreign" }, { work_id: "foreign" }, { session_id: "foreign" }])
    assert.equal(wireTerminal([delivered], { ...offline, runRow: runRow("completed", extra) }), null);
});

test("回答后的版本门核实际DB与state.goal.version，不借旧版本或无版本event完成", () => {
  const resumed = { ...identity, runRow: runRow(), minimumGoalVersion: 2, requireWireTerminal: true };
  assert.equal(wireTerminal([result(), state("completed", { goal: { version: 1 } })], resumed), null);
  assert.equal(wireTerminal([result(), state("completed", { goal: null })], resumed), null);
  assert.equal(wireTerminal([result(), received("agent_event", { run_ref: RUN, event_type: "run_completed" })], resumed), null);
  assert.equal(wireTerminal([result(), state()], { ...resumed, runRow: runRow("completed", { goal_version: 1 }) }), null);
  assert.equal(wireTerminal([result(), state()], resumed).kind, "completed");
});

test("失败/停等只由实际运行事实分类，后续running不借旧停等推进", () => {
  const failed = wireTerminal([received("agent_event", { run_ref: RUN, event_type: "run_failed" })], identity);
  assert.equal(failed.kind, "failed");
  assert.deepEqual(failed.results, []);
  assert.equal(wireTerminal([state("awaiting_author")], identity).kind, "awaiting_author");
  assert.equal(wireTerminal([state("awaiting_author"), state("running")], identity), null);
  assert.equal(wireTerminal([], identity), null);
  assert.equal(dbTerminal({ status: "completed" }).kind, "completed");
  assert.equal(dbTerminal({ status: "failed" }).kind, "failed");
  assert.equal(dbTerminal({ status: "awaiting_author" }).kind, "awaiting_author");
  assert.equal(dbTerminal({ status: "running" }), null);
  assert.equal(dbTerminal(null), null);
});

test("classifyTurnBody 记录候选/停等/回复事实，不要求固定文本", () => {
  const body = classifyTurnBody(
    completedTurn({
      adoption_state: { pending: [{ artifact_id: "a1", artifact_type: "world_setting", adoption_status: "TENTATIVE" }] },
      available_actions: [{ action_type: "author_choice" }],
    }),
  );
  assert.equal(body.status, "conversational");
  assert.equal(body.run_id, RUN);
  assert.equal(body.pending_artifact_count, 1);
  assert.equal(body.needs_author_choice, true);
  assert.equal(body.assistant_text_present, true);
  assert.equal(body.assistant_text_length > 0, true);
  const awaiting = classifyTurnBody({ turn_id: TURN, status: "needs_confirmation" });
  assert.equal(awaiting.needs_confirmation, true);
});

test("summarizeModelBehavior 汇总真实调用/工具/候选/停等，未触发不伪造", () => {
  const behavior = summarizeModelBehavior({
    turnBody: completedTurn(),
    runStatus: "completed",
    llmRecords: [
      {
        provider_call_ref: "pcall_1",
        response: { body: { tool_calls: [], content: "了解。" } },
      },
      {
        provider_call_ref: "pcall_2",
        response: { body: { tool_calls: [{ id: "call_1", function: { name: "read_work_context", arguments: "{}" } }] } },
      },
    ],
  });
  assert.equal(behavior.schema, "b71-live-run/v1");
  assert.equal(behavior.provider_calls, 2);
  assert.equal(behavior.tool_call_count, 1);
  assert.deepEqual(behavior.tool_names, ["read_work_context"]);
  assert.equal(behavior.replay_only_tool_calls, 0);
  assert.equal(behavior.ask_author, false);
  assert.equal(behavior.pending_artifact_count, 0);
  const silent = summarizeModelBehavior({ turnBody: null, runStatus: "awaiting_author", llmRecords: [] });
  assert.equal(silent.ask_author, true);
  assert.equal(silent.provider_calls, 0);
});

test("notSignedSlices 按未触发事实列出 G2/G3/G4/G5/G6 与 I10", () => {
  const behavior = summarizeModelBehavior({ turnBody: completedTurn(), runStatus: "completed", llmRecords: [] });
  const slices = notSignedSlices(behavior);
  assert(slices.includes("G2_observation_roundtrip_not_triggered"));
  assert(slices.includes("G4_tentative_candidate_not_triggered"));
  assert(slices.includes("G5_author_boundary_not_triggered"));
  assert(slices.includes("I10_literary_quality_not_signed"));
  const candidate = summarizeModelBehavior({
    turnBody: completedTurn({
      adoption_state: { pending: [{ artifact_id: "a1", adoption_status: "TENTATIVE" }] },
    }),
    runStatus: "completed",
    llmRecords: [],
  });
  assert(!notSignedSlices(candidate).includes("G4_tentative_candidate_not_triggered"));
});

test("tool_call 事实源=实时响应：messages 回放不放大调用次数，缺响应时显式标 replay_only", () => {
  const call = { id: "call_1", function: { name: "read_chapter", arguments: "{}" } };
  const replayMessages = [
    { role: "user", content: "u" },
    { role: "assistant", content: "", tool_calls: [call] },
    { role: "tool", tool_call_id: "call_1", content: "观察" },
  ];
  const verified = summarizeModelBehavior({
    turnBody: null,
    runStatus: "completed",
    llmRecords: [
      { provider_call_ref: "pcall_1", response: { body: { tool_calls: [call] } }, request_body: { messages: [] } },
      { provider_call_ref: "pcall_2", response: { body: { tool_calls: [] } }, request_body: { messages: replayMessages } },
      { provider_call_ref: "pcall_3", response: { body: { tool_calls: [] } }, request_body: { messages: replayMessages } },
    ],
  });
  // 回放两次不产生新调用：真实调用数仍为 1，回放观测单独记录。
  assert.equal(verified.tool_call_count, 1);
  assert.equal(verified.replay_only_tool_calls, 0);
  assert.equal(verified.tool_call_replay_observations.call_1, 2);
  const replayOnly = summarizeModelBehavior({
    turnBody: null,
    runStatus: "completed",
    llmRecords: [
      { provider_call_ref: "pcall_2", response: { body: { tool_calls: [] } }, request_body: { messages: replayMessages } },
    ],
  });
  // 缺实时响应证据时不把回放当模型真实发起：tool_call_count=0 且显式标记。
  assert.equal(replayOnly.tool_call_count, 0);
  assert.equal(replayOnly.replay_only_tool_calls, 1);
});
