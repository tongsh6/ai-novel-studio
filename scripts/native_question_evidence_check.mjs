// B26：原生系统 UI 操作记录与真实持久化/业务日志对账，不能把 Chromium 标为 Tauri。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  assertScreenshots, broadcastFrames, frameBody, frameEvent, requestIdentity, transport,
} from "./lib/native_ui/scenario_evidence.mjs";

const [dirArg, logsArg] = process.argv.slice(2);
const dir = path.resolve(dirArg);
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const ready = read("native-driver-ready.json");
const evidence = read("native-ui-complete.json");
assert.equal(evidence.harness_run_ref, ready.run_ref, "原生证据必须属于本次启动");
assert.equal(ready.browser_driver_started, false);
assert.equal(fs.existsSync(path.join(dir, "ui-frames.json")), false, "原生证据不能混入 Chromium driver");
assert.equal(evidence.driver, "ax-native-system-ui");
assert.equal(evidence.app_bundle, "com.ai-novel-studio.app");
assert(evidence.roundtrips?.length >= 2, "至少覆盖选项与自由回复");
assert(evidence.roundtrips.some((round) => round.reply_kind === "choice"));
assert(evidence.roundtrips.some((round) => round.reply_kind === "free_text"));
for (const key of ["question_ref", "submission_id", "action_id", "run_id"]) {
  const values = evidence.roundtrips.map((round) => round[key]);
  assert(values.every((value) => typeof value === "string" && value.trim() !== ""), `回复缺少 ${key}`);
  if (key === "question_ref" || key === "submission_id") {
    assert.equal(new Set(values).size, values.length, `回复 ${key} 重复`);
  }
}
assertScreenshots(dir, evidence.screenshots, ready.ready_at);
const wire = transport(dir);
const records = fs.readdirSync(logsArg).filter((name) => name.endsWith(".jsonl"))
  .flatMap((name) => fs.readFileSync(path.join(logsArg, name), "utf8").split("\n").filter(Boolean).map(JSON.parse));
const response = await fetch(`${ready.api_url}/api/works/${evidence.work_id}/sessions/${evidence.session_id}`);
assert(response.ok);
const snapshot = await response.json();
const transcript = [...snapshot.transcript];
let page = snapshot.transcript_page;
for (let index = 0; page.has_more_before; index += 1) {
  assert(index < 20, "分页恢复未收敛");
  const history = await fetch(`${ready.api_url}/api/works/${evidence.work_id}/sessions/${evidence.session_id}/transcript?before_id=${encodeURIComponent(page.before_id)}`);
  assert(history.ok);
  const older = await history.json();
  transcript.unshift(...older.transcript);
  page = older.transcript_page;
}
assert.equal(new Set(transcript.map((entry) => entry.id)).size, transcript.length, "对账分页出现重复记录");

for (const round of evidence.roundtrips) {
  const questionRows = transcript.filter((entry) => entry.turn_result?.author_question?.question_ref === round.question_ref);
  assert.equal(questionRows.length, 1, "原生源问题必须唯一持久化");
  const [questionRow] = questionRows;
  assert.equal(questionRow.turn_result.author_question.status, "answered");
  const source = questionRow.turn_result.author_question;
  assert.equal(source.run_id, round.run_id);
  assert.equal(source.submission_id, round.submission_id, "源问题必须由本次提交回答");
  const sourceActions = questionRow.turn_result.available_actions.filter((action) => action.action_id === round.action_id);
  assert.equal(sourceActions.length, 1, "回复必须绑定唯一真实源动作");
  const [sourceAction] = sourceActions;
  assert.equal(sourceAction.action_type, "author_choice");
  assert.equal(sourceAction.target_ref, round.run_id);
  assert.equal(sourceAction.response_kind, round.reply_kind, "回复类型必须来自真实源动作");
  const inputRows = transcript.filter((entry) => entry.submission_id === round.submission_id);
  assert.equal(inputRows.length, 1, "原生回复重复或丢失");
  assert.equal(inputRows[0].role, "user", "回复必须来自作者输入");
  assert.equal(inputRows[0].text, round.answer_text, "原生输入字节变化");
  assert.equal(inputRows[0].agent_run_id, round.run_id);
  assert(records.some((r) => r.event === "channel.author_action.done" && r.action_id === round.action_id && r.target_ref === round.run_id && r.action_status === "accepted"), "缺少真实作者动作日志");
  assert(!snapshot.open_author_question_turn_results.some((tr) => tr.author_question?.question_ref === round.question_ref));
  const sent = wire.find((row) => row.direction === "sent" && !row.dropped && frameEvent(row) === "author_action" &&
    frameBody(row)?.action?.payload?.submission_id === round.submission_id);
  assert(sent, "缺少本次回复的真实作者动作帧");
  const { topic } = requestIdentity(sent, "author_action");
  const action = frameBody(sent).action;
  assert.equal(action.action_type, "author_choice");
  assert.equal(action.action_id, round.action_id);
  assert.equal(action.target_ref, round.run_id);
  assert.equal(action.source_turn_ref, source.source_turn_ref);
  assert.equal(action.payload.question_ref, round.question_ref);
  if (round.reply_kind === "free_text") {
    assert.equal(action.payload.text, round.answer_text, "发送的自由回复原文字节变化");
  } else {
    assert.equal(round.reply_kind, "choice", "未知回复类型");
    assert.equal(action.candidate_ref, sourceAction.candidate_ref, "选项回复必须绑定源候选");
    assert.equal(sourceAction.label, round.answer_text, "选项回复必须保留源动作文字");
  }
  const expectedVersion = action.payload.expected_goal_version;
  assert(Number.isInteger(expectedVersion) && expectedVersion >= 1, "作者回复缺少有效目标版本");
  assert.equal(expectedVersion, source.goal_version, "回复版本必须绑定源问题");
  assert(Date.parse(sent.at) >= Date.parse(ready.ready_at), "作者回复早于本次窗口就绪");
  assert(Date.parse(inputRows[0].inserted_at) >= Date.parse(sent.at), "历史作者输入不能冒充本次回复");
  const states = broadcastFrames(wire.slice(wire.indexOf(sent) + 1), {
    topic, at: sent.at, event: "agent_run_state",
  }).filter((row) => !row.dropped && frameBody(row)?.run_id === round.run_id);
  const terminal = frameBody(states.at(-1));
  assert(terminal, "缺少本次回复之后同 run 的真实状态帧");
  assert.equal(terminal.status, "completed", "原生回复之后同 run 必须完成");
  assert.equal(terminal.goal?.version, expectedVersion + 1, "回复终局必须消费本次目标版本");
  if (evidence.transport_replay) {
    assert.equal(terminal.consumed_budget.provider_calls, 2, "提问与回复应各一次 provider 调用，重传不能重做");
    assert.equal(terminal.consumed_budget.tool_calls, 0);
  }
}
const extraAssertions = [];
if (evidence.blank_reply) {
  const window = read("blank-reply-window.json");
  assert(Date.parse(window.start_at) >= Date.parse(ready.ready_at));
  assert(Date.parse(window.end_at) > Date.parse(window.start_at));
  assert(window.whitespace.length > 0 && window.whitespace.trim().length === 0);
  const emptyState = fs.readFileSync(path.join(dir, window.empty_ax), "utf8");
  const whitespaceState = fs.readFileSync(path.join(dir, window.whitespace_ax), "utf8");
  assert(emptyState.includes("button (disabled) 发送回复"));
  assert(whitespaceState.includes("button (disabled) 发送回复") || whitespaceState.includes("There has been no change in the accessibility tree"));
  const requests = wire.filter((row) => row.at >= window.start_at && row.at <= window.end_at && row.direction === "sent" && ["author_action", "agent_command", "user_message"].includes(row.frame?.[3]));
  assert.equal(requests.length, 0, "空回复期间不应发出作者请求");
  extraAssertions.push("native_empty_and_whitespace_reply_disabled_without_request");
}
if (evidence.transport_replay) {
  const submission = evidence.transport_replay.submission_id;
  const sends = wire.filter((row) => row.direction === "sent" && row.frame?.[3] === "author_action" && row.frame?.[4]?.action?.payload?.submission_id === submission);
  assert(sends.length >= 2, "真实断线后未重传原回复");
  for (const send of sends) assert.deepEqual(send.frame[4], sends[0].frame[4], "重传改写了源动作或输入字节");
  const lost = wire.find((row) => row.fault === "ack_lost_and_disconnected" && row.submission_id === submission);
  assert.equal(lost?.response?.response?.duplicate, false);
  const replay = wire.find((row) => row.direction === "received" && !row.dropped && row.frame?.[3] === "phx_reply" && row.frame?.[4]?.response?.submission_id === submission && row.frame?.[4]?.response?.duplicate === true);
  assert(replay, "重复投递没有原语义回执");
  assert.equal(replay.frame[4].response.goal_version, lost.response.response.goal_version);
  assert.equal(replay.frame[4].response.run_id, lost.response.response.run_id);
  assert.equal(transcript.filter((entry) => entry.submission_id === submission).length, 1);
  extraAssertions.push("native_ack_loss_same_submission_replayed_once");
}
if (evidence.paged_question_refs) {
  const paged = read("native-paged-session.json");
  assert.equal(evidence.paged_question_refs.length, 2);
  for (const ref of evidence.paged_question_refs) {
    assert(!paged.transcript.some((row) => row.turn_result?.author_question?.question_ref === ref));
    assert(paged.open_author_question_turn_results.some((row) => row.author_question?.question_ref === ref));
    assert(evidence.roundtrips.some((round) => round.question_ref === ref));
  }
  const ordinary = transcript.filter((row) => row.role === "user" && row.text.startsWith("分页讨论 "));
  assert.equal(ordinary.length, 16);
  for (const input of ordinary) {
    const reply = transcript.find((row) => row.role === "assistant" && row.agent_run_id === input.agent_run_id);
    assert(reply?.turn_result && !["failed", "failed_recoverable"].includes(reply.turn_result.status), "普通分页讨论失败");
    assert.equal(reply.turn_result.available_actions?.some((action) => action.action_type === "choose_candidate") ?? false, false);
  }
  extraAssertions.push("native_two_questions_recovered_beyond_transcript_page");
}
if (evidence.cross_run_rejection) {
  const rejected = read("native-rejected-session.json");
  const negative = evidence.cross_run_rejection;
  const sent = wire.find((row) => row.direction === "sent" && row.frame?.[3] === "author_action" && row.frame?.[4]?.action?.payload?.submission_id === negative.submission_id);
  assert(sent);
  assert.notEqual(sent.frame[4].action.target_ref, negative.source_run_id);
  const response = wire.find((row) => row.direction === "received" && row.frame?.[3] === "phx_reply" && row.frame?.[4]?.response?.submission_id === negative.submission_id);
  assert.equal(response?.frame[4].status, "error");
  assert(!rejected.transcript.some((row) => row.submission_id === negative.submission_id));
  assert(rejected.open_author_question_turn_results.some((row) => row.author_question.question_ref === negative.question_ref && row.author_question.goal_version === 1));
  assert(!transcript.some((row) => row.submission_id === negative.submission_id));
  extraAssertions.push("native_cross_run_rejection_preserves_source_question");
}
if (evidence.transport_replay) {
  extraAssertions.push("native_reply_no_duplicate_provider_or_business_calls");
}
if (evidence.scope_switch) {
  const scope = evidence.scope_switch;
  const history = read("scope-readonly-session.json");
  assert.equal(history.read_only, true);
  const historicalQuestion = history.transcript.find((row) => row.turn_result?.author_question?.question_ref === scope.question_ref)?.turn_result;
  assert(historicalQuestion);
  assert(historicalQuestion.available_actions.length > 0);
  assert(historicalQuestion.available_actions.every((action) => action.enabled === false), "历史会话问题仍可提交");
  assert.notEqual(scope.other_work_id, evidence.work_id);
  const otherResponse = await fetch(`${ready.api_url}/api/works/${scope.other_work_id}/sessions/${scope.other_session_id}`);
  assert(otherResponse.ok);
  const other = await otherResponse.json();
  assert(!other.transcript.some((row) => row.submission_id === scope.rejected_submission_id));
  assert(!transcript.some((row) => row.submission_id === scope.rejected_submission_id));
  const unchanged = transcript.find((row) => row.turn_result?.author_question?.question_ref === scope.question_ref)?.turn_result;
  assert.equal(unchanged.author_question.goal_version, historicalQuestion.author_question.goal_version);
  assert.equal(unchanged.author_question.status, historicalQuestion.author_question.status);
  const sent = wire.find((row) => row.direction === "sent" && row.frame?.[3] === "author_action" && row.frame?.[4]?.action?.payload?.submission_id === scope.rejected_submission_id);
  assert(sent);
  assert(sent.frame[2].includes(scope.other_work_id));
  assert.equal(sent.frame[4].action.target_ref, historicalQuestion.author_question.run_id);
  const rejection = wire.find((row) => row.direction === "received" && row.frame?.[3] === "phx_reply" && row.frame?.[4]?.response?.submission_id === scope.rejected_submission_id);
  assert.equal(rejection?.frame[4].status, "error");
  fs.writeFileSync(path.join(dir, "verified-other-session.json"), JSON.stringify(other, null, 2));
  extraAssertions.push("native_historical_question_readonly", "native_cross_work_rejection_preserves_both_scopes");
}
fs.writeFileSync(path.join(dir, "verified-session.json"), JSON.stringify(snapshot, null, 2));
const summary = { slice_id: "b26-author-question-roundtrip", surface: "tauri", driver: "ax-native-system-ui",
  verified_at: new Date().toISOString(), harness_run_ref: ready.run_ref, work_id: evidence.work_id,
  session_id: evidence.session_id, roundtrips: evidence.roundtrips, screenshots: evidence.screenshots,
  assertions: ["native_window_operated", "no_chromium_driver", "real_author_action", "answer_bytes_persisted_once", "answered_questions_closed", "reply_run_completed_after_submission", ...extraAssertions] };
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
console.log("native-question: 原生窗口、源动作和持久字节对账通过");
