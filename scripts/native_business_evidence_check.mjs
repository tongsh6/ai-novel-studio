// B26：外部系统 UI 业务回环的真实网络、持久历史和作品事实对账。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const [artifact, logDir] = process.argv.slice(2);
const dir = path.resolve(artifact);
const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
const ready = read("native-driver-ready.json"), evidence = read("native-ui-complete.json");
assert.equal(evidence.harness_run_ref, ready.run_ref);
assert.equal(evidence.driver, "cua-native-system-ui");
assert.equal(evidence.app_bundle, "com.ai-novel-studio.app");
assert.equal(ready.browser_driver_started, false);
assert(!fs.existsSync(path.join(dir, "ui-frames.json")));
assert(evidence.screenshots.length >= 4);
for (const name of evidence.screenshots) {
  const file = path.resolve(dir, name);
  assert(file.startsWith(dir + path.sep));
  assert(fs.statSync(file).mtimeMs >= Date.parse(ready.ready_at));
  const header = fs.readFileSync(file).subarray(0, 8).toString("hex");
  assert(header.startsWith("ffd8ff") || header === "89504e470d0a1a0a");
}
const wire = fs.readFileSync(path.join(dir, "native-transport.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const records = fs.readdirSync(logDir).filter((name) => name.endsWith(".jsonl")).flatMap((name) => fs.readFileSync(path.join(logDir, name), "utf8").split("\n").filter(Boolean).map(JSON.parse));
const frames = wire.filter((row) => row.direction === "received").map((row) => row.frame).filter(Boolean);
const results = frames.filter((frame) => frame[3] === "turn_result").map((frame) => frame[4]);
const result = (key) => {
  const id = evidence.turns[key];
  const value = results.find((row) => row.turn_id === id);
  assert(value, `缺少 ${key} 的真实结果`);
  assert(!["failed", "failed_recoverable"].includes(value.status), `${key} 不能以失败回执充数`);
  return value;
};
const fetchJSON = async (url) => { const response = await fetch(url); assert(response.ok); return response.json(); };
const base = `${ready.api_url}/api/works/${evidence.work_id}/sessions/${evidence.session_id}`;
const snapshot = await fetchJSON(base);
const transcript = [...snapshot.transcript];
let page = snapshot.transcript_page;
for (let i = 0; page.has_more_before; i++) {
  assert(i < 20);
  const older = await fetchJSON(`${base}/transcript?before_id=${encodeURIComponent(page.before_id)}`);
  transcript.unshift(...older.transcript); page = older.transcript_page;
}
const plain = result("plain"), directions = result("directions"), gap = result("gap");
const receivedOnly = result("source_history");
assert.equal(receivedOnly.adoption_state?.pending?.length ?? 0, 0);
assert.equal(receivedOnly.available_actions?.length ?? 0, 0);
assert.equal(plain.truthfulness.production_write_performed, false);
assert.equal(plain.available_actions?.length ?? 0, 0);
assert(directions.candidate_directions?.length >= 2);
assert(directions.available_actions.some((action) => action.action_type === "choose_candidate"));
assert(results.some((row) => row.truthfulness?.candidate_selected && row.truthfulness?.candidate_adopted && row.truthfulness.production_write_performed === false));
assert.equal(gap.outcome, "goal_unfulfilled");
assert.equal(gap.truthfulness.tool_called, false);
for (const value of [gap, result("continuation_gap")]) {
  const gapRun = value.agent_run.run_id;
  assert.equal(value.outcome, "goal_unfulfilled");
  assert.equal(value.frame_summary.frame_type, "capability_gap");
  assert(!value.author_question);
  assert(frames.some((frame) => frame[3] === "agent_run_state" && frame[4].run_id === gapRun && frame[4].status === "completed"));
  assert(!frames.some((frame) => frame[3] === "agent_event" && frame[4].run_ref === gapRun && (frame[4].reason_codes ?? []).includes("goal_satisfied")));
}
const replayReports = {};
for (const key of ["plain", "current", "historical", "reregistered", "gap", "continuation_gap"]) {
  const value = result(key);
  const report = await fetchJSON(`${base}/turns/${encodeURIComponent(value.turn_id)}/replay`);
  assert.equal(report.trace_summary.trace_ref, value.trace_summary.trace_ref, "回放 trace 与结果引用不一致");
  assert.equal(report.trace_summary.replay_provider_called, false);
  assert.deepEqual(report.trace_summary.reply_record, value.trace_summary.reply_record, "回放丢失来源或未知认知");
  replayReports[key] = report;
}
fs.writeFileSync(path.join(dir, "verified-replays.json"), JSON.stringify(replayReports, null, 2));
const ids = {};
for (const key of ["current", "historical", "reregistered"]) {
  const value = result(key), pending = value.adoption_state.pending;
  assert.equal(pending.length, 1);
  const input = transcript.find((row) => row.role === "user" && row.turn_id === evidence.sources[key]);
  assert(input);
  assert.equal(pending[0].payload.items[0].body, input.text);
  assert.equal(pending[0].payload.items[0].provider_call_ref, `author_input:${input.turn_id}`);
  assert.equal(value.truthfulness.production_write_performed, false);
  assert(!value.assistant_message.text.includes("已经采纳入档"), "替身不得把其他来源的采纳状态用于本资料");
  ids[key] = pending[0].artifact_id;
}
assert.notEqual(ids.historical, ids.reregistered);
for (const [key, expected] of [["repeat_pending", ids.historical], ["repeat_accepted", ids.reregistered]]) {
  const value = result(key);
  assert.equal(value.outcome, "already_materialized");
  assert.equal(value.adoption_state.pending.length, 0);
  assert(value.trace_summary.registration.artifacts.some((item) => item.artifact_id === expected));
  assert.equal(value.truthfulness.production_write_performed, false);
}
assert(snapshot.resolved_adoptions.some((item) => item.artifact_id === ids.historical && item.adoption_status === "DISCARDED"));
for (const id of [ids.current, ids.reregistered]) assert(snapshot.resolved_adoptions.some((item) => item.artifact_id === id && item.adoption_status === "ACCEPTED"));
assert(result("repeat_pending").assistant_message.text.includes("尚未采纳"));
assert(result("repeat_accepted").assistant_message.text.includes("已经采纳入档"));
const memoryRows = (value) => value.data;
const beforeCurrent = memoryRows(read("before-current-adoption-memories.json"));
const beforeHistory = memoryRows(read("before-historical-adoption-memories.json"));
const afterMemories = await fetchJSON(`${ready.api_url}/api/works/${evidence.work_id}/memories`);
for (const [key, before] of [["current", beforeCurrent], ["historical", beforeHistory]]) {
  const original = transcript.find((row) => row.role === "user" && row.turn_id === evidence.sources[key]).text;
  assert(!before.some((row) => row.content.includes(original)), "采纳前出现原文事实");
  const stored = memoryRows(afterMemories).filter((row) => row.content.includes(original));
  assert.equal(stored.length, 1, "采纳后事实丢失或重复");
  assert.equal(stored[0].status, "CONFIRMED");
}
fs.writeFileSync(path.join(dir, "verified-memories.json"), JSON.stringify(afterMemories, null, 2));
const lost = wire.find((row) => row.fault === "committed_result_lost_and_disconnected" && row.turn_id === evidence.turns.current);
assert(lost);
assert(wire.some((row) => row.dropped && row.frame?.[3] === "turn_result" && row.frame[4].turn_id === lost.turn_id));
const current = result("current");
const currentState = frames.flatMap((frame) => frame[3] === "agent_run_state" ? [frame[4]] : frame[3] === "phx_reply" ? [frame[4]?.response?.agent_run_state].filter(Boolean) : [])
  .findLast((state) => state.run_id === current.agent_run.run_id && state.status === "completed");
const replayReceipt = frames.find((frame) => frame[3] === "phx_reply" && frame[4]?.response?.turn_id === evidence.turns.current && frame[4].response.agent_run_state?.status === "completed")?.[4].response;
assert(replayReceipt?.turn_results?.some((row) => row.turn_id === evidence.turns.current && row.adoption_state?.pending?.some((entry) => entry.artifact_id === ids.current)), "丢结果后回执未恢复同一产物");
assert.equal(currentState?.consumed_budget.provider_calls, 1);
assert.equal(transcript.filter((row) => row.role === "user" && row.turn_id === evidence.turns.current).length, 1);
const question = transcript.find((row) => row.turn_result?.author_question?.question_ref === evidence.continuation.question_ref)?.turn_result;
assert(question);
assert.equal(question.author_question.status, "answered");
assert.equal(question.author_question.run_id, evidence.continuation.run_id);
const questionReplay = await fetchJSON(`${base}/turns/${encodeURIComponent(question.turn_id)}/replay`);
assert.equal(questionReplay.trace_summary.trace_ref, question.trace_summary.trace_ref);
assert.equal(questionReplay.trace_summary.replay_provider_called, false);
const whyPath = `/api/works/${evidence.work_id}/sessions/${evidence.session_id}/turns/${encodeURIComponent(evidence.turns.continuation_gap)}/replay`;
assert(wire.some((row) => row.direction === "http" && row.method === "GET" && row.path === whyPath && row.status === 200), "缺少从原生为什么入口加载的真实回放请求");
const answer = transcript.filter((row) => row.submission_id === evidence.continuation.submission_id);
assert.equal(answer.length, 1);
assert.equal(answer[0].text, evidence.continuation.answer_text);
assert.equal(answer[0].agent_run_id, evidence.continuation.run_id);
const continued = frames.filter((frame) => frame[3] === "agent_run_state" && frame[4].run_id === evidence.continuation.run_id).map((frame) => frame[4]);
assert(continued.some((state) => state.goal?.version === 2 && state.consumed_budget.tool_calls === 2), "回答后未在原 run 真实重试业务步骤");
assert(question.assistant_message.text.includes("还没有可采纳的正文草稿"), "失败提问不能虚报草稿");
assert(records.some((row) => row.event === "channel.author_action.done" && row.target_ref === evidence.continuation.run_id && row.action_status === "accepted"));
const summary = { slice_id: "b26-business-output-roundtrip", surface: "tauri", driver: evidence.driver,
  verified_at: new Date().toISOString(), turns: evidence.turns, artifacts: ids, screenshots: evidence.screenshots,
  assertions: ["native_business_actions", "direction_selection_not_canon", "author_source_bytes_preserved", "existing_source_reused", "discard_then_reregister", "explicit_adoption", "committed_result_recovered_without_provider_reexecution", "capability_gap_completed_without_goal_satisfied", "continuation_question_reply_same_run", "trace_committed_with_result_and_replayed_without_provider"] };
fs.writeFileSync(path.join(dir, "verified-session.json"), JSON.stringify(snapshot, null, 2));
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
console.log("native-business: 业务结果、来源、采纳和续行问题对账通过");
