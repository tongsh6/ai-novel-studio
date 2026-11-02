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
  agent_run: { run_id: RUN, status: "completed" },
  assistant_message: { text: "已生成候选，请审阅。" },
  adoption_state: { pending: [] },
  available_actions: [],
  ...overrides,
});

test("wireTerminal 只接受 owning turn/run 的 completed/failed/awaiting_author", () => {
  const wire = [
    received("agent_run_state", { run_id: "other_run", status: "completed" }),
    received("turn_result", { turn_id: "other_turn", agent_run: { run_id: RUN, status: "completed" } }),
    received("turn_result", completedTurn()),
  ];
  const terminal = wireTerminal(wire, { turnId: TURN });
  assert.equal(terminal.kind, "completed");
  assert.equal(terminal.body.agent_run.run_id, RUN);
  assert.equal(wireTerminal(wire, { turnId: TURN, since: "2026-11-03T10:00:03.000Z" }), null);
  const failed = wireTerminal(
    [received("agent_event", { run_ref: RUN, event_type: "run_failed" })],
    { turnId: TURN, runId: RUN },
  );
  assert.equal(failed.kind, "failed");
  const awaiting = wireTerminal(
    [received("agent_run_state", { run_id: RUN, parent_turn_ref: TURN, status: "awaiting_author" })],
    { turnId: TURN },
  );
  assert.equal(awaiting.kind, "awaiting_author");
  assert.equal(wireTerminal([], { turnId: TURN }), null);
});

test("dbTerminal 把 DB agent_runs 终态映射成同一分类", () => {
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
