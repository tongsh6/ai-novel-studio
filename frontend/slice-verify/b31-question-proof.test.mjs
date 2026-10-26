import { describe, expect, it } from "vitest";
import { B31QuestionProof, assertProtectedVersions } from "../../scripts/lib/b31-question-proof.mjs";
import { findNativeSliceEvidence } from "./native-tauri-verifier.mjs";

function sample({ run = "run-a", version = 1, question = "确认哪个范围？", text = "  第一卷\n保留正文  " } = {}) {
  const q = { run_id: run, goal_version: version, question_ref: `${run}:q${version}`, source_turn_ref: `${run}:turn${version}`, question, options: [] };
  const available = { action_id: `${q.question_ref}:answer`, action_type: "author_choice", source_turn_ref: q.source_turn_ref,
    target_ref: run, expected_goal_version: version, question_ref: q.question_ref, response_kind: "free_text", idempotency_key: `idem:${q.question_ref}` };
  const action = { ...available, payload: { submission_id: `${q.question_ref}:input`, question_ref: q.question_ref, expected_goal_version: version, text } };
  const receipt = { status: "accepted", action_type: "author_choice", action_id: action.action_id, submission_id: action.payload.submission_id,
    source_turn_ref: q.source_turn_ref, question_ref: q.question_ref, run_id: run, goal_version: version + 1 };
  return { source: { author_question: q, available_actions: [available] }, action, receipt,
    inputs: [{ role: "user", submission_id: action.payload.submission_id, agent_run_id: run, text }], at: "2026-10-25T11:00:00Z" };
}

describe("B31 源问题回复证据", () => {
  it("不同 run 的同文问题独立计数；回复原话保留空格与换行", () => {
    const proof = new B31QuestionProof(); proof.record(sample()); proof.record(sample({ run: "run-b" }));
    expect(proof.events).toHaveLength(2); expect(proof.events[0].answer_text).toBe("  第一卷\n保留正文  ");
  });
  it.each(["target_ref", "source_turn_ref", "idempotency_key"])("拒绝改变源绑定 %s", (field) => {
    const input = sample(); input.action[field] = "foreign";
    expect(() => new B31QuestionProof().record(input)).toThrow();
  });
  it("拒绝错误版本、跨 run 持久化和原话裁剪", () => {
    for (const change of [s => { s.receipt.goal_version = 3; }, s => { s.inputs[0].agent_run_id = "other"; }, s => { s.inputs[0].text = s.inputs[0].text.trim(); }]) {
      const input = sample(); change(input); expect(() => new B31QuestionProof().record(input)).toThrow();
    }
  });
  it("同身份完整重传不重复计数；同身份异内容拒绝", () => {
    const proof = new B31QuestionProof(), input = sample(); proof.record(input);
    expect(proof.record({ ...input, receipt: { ...input.receipt, duplicate: true } })).toEqual({ duplicate: true });
    expect(proof.events).toHaveLength(1);
    const changed = structuredClone(input); changed.action.payload.text = "另一回答"; changed.inputs[0].text = "另一回答";
    expect(() => proof.record(changed)).toThrow();
  });
  it("同 run 的重复问题及第三次回复有界失败", () => {
    const proof = new B31QuestionProof(); proof.record(sample());
    expect(() => proof.assertCanAnswer(sample({ version: 2 }).source)).toThrow(/repeated/);
    proof.record(sample({ version: 2, question: "章节数？", text: "12章" }));
    expect(() => proof.assertCanAnswer(sample({ version: 3, question: "风格？" }).source)).toThrow(/budget/);
  });
  it("选项回答由同一 source 的机器值与原 label 决定", () => {
    const input = sample({ text: "第一卷" });
    input.source.author_question.options = [{ value: "volume-one", label: "第一卷" }];
    Object.assign(input.source.available_actions[0], { response_kind: "choice", candidate_ref: "volume-one" });
    input.action.candidate_ref = "volume-one"; delete input.action.payload.text;
    expect(new B31QuestionProof().record(input).answer_text).toBe("第一卷");
    input.source.author_question.options.unshift({ value: "other", label: "另一方向", recommended: true });
    expect(() => new B31QuestionProof().record(input)).toThrow(/推荐/);
  });
  it("回复不能推进受保护的结构任务或另一个问题", () => {
    expect(() => assertProtectedVersions({ s: 1, q: 1 }, { s: 1, q: 1 }, ["s", "q"])).not.toThrow();
    expect(() => assertProtectedVersions({ s: 1 }, { s: 2 }, ["s"])).toThrow();
    expect(() => assertProtectedVersions({}, { s: 1 }, ["s"])).toThrow();
  });
});

describe("B31 增补报告门禁", () => {
  function records() {
    const checks = ["open_question_plain_input_new_request", "open_question_notice_visible", "question_run_left_open", "structure_run_not_advanced", "explicit_reply_bound_question_run", "explicit_reply_goal_version_advanced", "post_reply_steer_target_visible", "ambiguous_notice_and_selector_visible", "ambiguous_plain_input_new_request", "selector_focus_steer_ok", "steer_expected_goal_version_sent", "steer_ack_binding_fields", "selector_steer_other_run_untouched", "restore_order_stable", "reload_plain_input_new_request", "additional_question_bindings_preserved", "all_questions_closed_before_steer", "no_product_code_changed"];
    const proof = new B31QuestionProof();
    for (let i = 0; i < 4; i++) proof.record(sample({ run: `q-${i}` }));
    const ui = { event: "slice_verify.ui_state.done", slice_id: "b31-author-reply-run-binding", trial_ids: ["T1", "T2", "T3", "T4", "T5"],
      cp2_checks: Object.fromEntries(checks.map((key) => [key, true])),
      cp2_measured: { plain_input_new_run_count: 6, plain_input_steer_count: 1, selector_steer_expected_goal_version: 1,
        selector_steer_ack: { resolved_run_id: "structure", binding_source: "explicit_steer", goal_version: 2 }, author_question_reply_count: 4 },
      author_question_events: proof.events, measured_inputs_all_from_real_workbench: true,
      protocol_seed_used_for_trial_setup: true, no_product_code_changed: true };
    return [ui, ...proof.events.map((reply) => ({ event: "channel.author_action.done", action_status: "accepted", action_id: reply.action_id, target_ref: reply.run_id, turn_id: reply.source_turn_ref }))];
  }
  it("旧报告缺少新问题关闭条件或真实作者动作时不能通过", () => {
    expect(findNativeSliceEvidence("b31-author-reply-run-binding", records())).not.toBeNull();
    const old = records(); delete old[0].cp2_checks.all_questions_closed_before_steer;
    expect(findNativeSliceEvidence("b31-author-reply-run-binding", old)).toBeNull();
    expect(findNativeSliceEvidence("b31-author-reply-run-binding", records().slice(0, 1))).toBeNull();
  });
  it("重复回复身份、错误回执版本和改投来源均拒绝", () => {
    for (const change of [rows => { rows[0].author_question_events[1].submission_id = rows[0].author_question_events[0].submission_id; }, rows => { rows[0].author_question_events[0].receipt_goal_version = 3; }, rows => { rows[0].author_question_events[0].source_turn_ref = "foreign"; }]) {
      const rows = records(); change(rows); expect(findNativeSliceEvidence("b31-author-reply-run-binding", rows)).toBeNull();
    }
  });
});
