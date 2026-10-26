// B31 脚本共用纯 helper：源动作、回执和持久原话必须一致；不驱动页面、不进入产品代码。
import assert from "node:assert/strict";

export const B31_STRUCTURE_REPLIES = Object.freeze([
  "确认第一卷；当前还没有章节，请先为第一卷生成12章的待采纳章节计划，供后续结构维护使用，暂不采纳。",
  "第一卷按12章编排，每章围绕灵气账单异常推进一次调查或冲突；先给待采纳计划，保持已有正文不变。",
]);

export function assertProtectedVersions(before, after, runIds) {
  for (const runId of runIds) {
    assert(Number.isInteger(before[runId]), `缺少原版本：${runId}`);
    assert.equal(after[runId], before[runId], `回复推进了其他任务：${runId}`);
  }
}

export class B31QuestionProof {
  constructor() { this.byRun = new Map(); this.bySubmission = new Map(); this.events = []; }
  assertCanAnswer(source) {
    const q = source?.author_question;
    assert(q?.question_ref && q.run_id && q.source_turn_ref && Number.isInteger(q.goal_version));
    assert(typeof q.question === "string" && q.question.trim(), "author_question_without_text");
    const answers = this.byRun.get(q.run_id) ?? [];
    assert(answers.length < 2, "author_question_reply_budget_exhausted");
    const text = q.question.trim().replace(/\s+/g, " ");
    assert(!answers.some((event) => event.question_text.trim().replace(/\s+/g, " ") === text), "author_question_repeated");
    return answers.length;
  }
  record({ source, action, receipt, inputs, at }) {
    const q = source.author_question, payload = action.payload;
    const available = source.available_actions?.find((item) => item.action_id === action.action_id);
    assert(available, "回复动作不属于该源问题");
    assert(["choice", "free_text"].includes(available.response_kind));
    assert.equal(action.action_type, "author_choice");
    assert.equal(available.action_type, "author_choice");
    for (const candidate of [action, available]) {
      assert.equal(candidate.target_ref, q.run_id);
      assert.equal(candidate.source_turn_ref, q.source_turn_ref);
    }
    assert.equal(available.question_ref, q.question_ref);
    assert.equal(payload.question_ref, q.question_ref);
    assert.equal(payload.expected_goal_version, q.goal_version);
    assert.equal(available.expected_goal_version, q.goal_version);
    assert.equal(action.idempotency_key, available.idempotency_key);
    assert.equal(action.candidate_ref, available.candidate_ref);
    if (q.options.length) {
      const preferred = q.options.find((option) => option.recommended) ?? q.options[0];
      assert.equal(action.candidate_ref, preferred.value, "验收应答必须选择推荐项或首个选项");
    }
    assert(typeof payload.submission_id === "string" && payload.submission_id);
    assert.equal(receipt.status, "accepted");
    assert.equal(receipt.action_type, "author_choice");
    assert.equal(receipt.action_id, action.action_id);
    assert.equal(receipt.submission_id, payload.submission_id);
    assert.equal(receipt.source_turn_ref, q.source_turn_ref);
    assert.equal(receipt.question_ref, q.question_ref);
    assert.equal(receipt.run_id, q.run_id);
    assert.equal(receipt.goal_version, q.goal_version + 1);
    const text = available.response_kind === "choice"
      ? q.options.find((option) => option.value === available.candidate_ref)?.label : payload.text;
    assert(typeof text === "string" && text.trim(), "author_question_empty_answer");
    const rows = inputs.filter((row) => row.submission_id === payload.submission_id);
    assert.equal(rows.length, 1, "回复持久化必须唯一");
    assert.equal(rows[0].role, "user");
    assert.equal(rows[0].agent_run_id, q.run_id);
    assert.equal(rows[0].text, text, "回复原话改变");
    const existing = this.bySubmission.get(payload.submission_id);
    if (existing) { assert.deepEqual(action, existing); return { duplicate: true }; }
    this.assertCanAnswer(source);
    const answers = this.byRun.get(q.run_id) ?? [];
    assert(!answers.some((event) => event.answer_text === text), "author_question_repeated_answer");
    const event = { at, question_ref: q.question_ref, question_text: q.question, source_turn_ref: q.source_turn_ref,
      run_id: q.run_id, expected_goal_version: q.goal_version, action_id: action.action_id,
      submission_id: payload.submission_id, response_kind: available.response_kind, answer_text: text,
      receipt_goal_version: receipt.goal_version };
    this.bySubmission.set(payload.submission_id, structuredClone(action));
    this.byRun.set(q.run_id, [...answers, event]); this.events.push(event);
    return event;
  }
}
