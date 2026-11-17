// 外部驱动的回答/取消业务绑定；帧工厂复用现役维护 fixture，ACK 身份由共同 owner 核验。
import assert from "node:assert/strict";
import test from "node:test";
import { authorChoiceAckFor, cancelAckFor, requireSameSummaryTarget } from "./native_b71_auto_maintenance_drive.mjs";
import { interleavedResumeFacts } from "./lib/native_ui/fixtures/authoring_auto_maintenance_facts.mjs";

function answerAttempt() {
  const facts = interleavedResumeFacts();
  const wire = facts.wire.filter((record) => record.frame[3] !== "turn_result");
  const action = wire[0].frame[4].action, response = wire[1].frame[4].response;
  action.source_turn_ref = "turn-a";
  action.payload.text = "冻结的作者选择";
  Object.assign(response, { action_type: "author_choice", source_turn_ref: action.source_turn_ref });
  return { wire, options: { runId: facts.trace.waiting_run_id, wireStart: 0,
    expected: { question_ref: facts.trace.waiting_question_ref, goal_version: 1 },
    text: action.payload.text } };
}

test("A恢复只接受同问题/目标版本/逐字回答与唯一对应ACK", () => {
  const { wire, options } = answerAttempt();
  assert.equal(authorChoiceAckFor(wire, options).response.goal_version, 2);
  for (const mutate of [
    (rows) => { rows[0].frame[4].action.payload.text += "改"; },
    (rows) => { rows[0].frame[4].action.payload.expected_goal_version = 2; },
    (rows) => { rows[1].frame[4].response.source_turn_ref = "other-turn"; },
    (rows) => { rows[1].frame[4].response.question_ref = "other-question"; },
    (rows) => { rows[1].frame[0] = "other-join"; },
    (rows) => { rows[1].frame[4].response.duplicate = true; },
    (rows) => { rows.push(structuredClone(rows[0])); },
    (rows) => { rows.push(structuredClone(rows[1])); },
  ]) {
    const changed = structuredClone(wire);
    mutate(changed);
    assert.equal(authorChoiceAckFor(changed, options), null);
  }
  assert.equal(authorChoiceAckFor(wire, { ...options, wireStart: 1 }), null);
});

test("取消接受受理ACK仅证明同run命令，不把不同ref/拒绝/重复回包当受理", () => {
  const { wire, options } = answerAttempt();
  wire[0].frame[3] = "agent_command";
  wire[0].frame[4] = { run_id: options.runId, command: "cancel" };
  wire[1].frame[4] = { status: "ok", response: { received: true, run_id: options.runId, command: "cancel" } };
  assert.equal(cancelAckFor(wire, options).response.command, "cancel");
  for (const mutate of [
    (rows) => { rows[0].frame[4].run_id = "foreign"; },
    (rows) => { rows[1].frame[4].response.command = "pause"; },
    (rows) => { rows[1].frame[4].status = "error"; },
    (rows) => { rows[1].frame[1] = "other-ref"; },
    (rows) => { rows[1].at = "2026-11-04T09:59:59.000Z"; },
    (rows) => { rows.push(structuredClone(rows[1])); },
  ]) {
    const changed = structuredClone(wire);
    mutate(changed);
    assert.equal(cancelAckFor(changed, options), null);
  }
  assert.equal(cancelAckFor(wire, { ...options, wireStart: 1 }), null);
});

test("确认取消前摘要已结束或被另一执行替换时阻断命令，不切换目标", () => {
  const expected = { provider_run_ref: "summary-run", provider_call_ref: "summary-call" };
  let commandCount = 0;
  const confirm = (current) => { requireSameSummaryTarget(expected, current); commandCount += 1; };
  for (const current of [null, { ...expected, provider_run_ref: "later-summary" },
    { ...expected, provider_call_ref: "other-call" }]) {
    assert.throws(() => confirm(current), /summary_cancellation_target_no_longer_in_flight/);
    assert.equal(commandCount, 0);
  }
  confirm({ ...expected });
  assert.equal(commandCount, 1);
});
