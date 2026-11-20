// G6/R03 交错恢复的唯一纯证据判据。输入均由现役 IO owner 读取；无 DB/文件访问。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { frameBody, frameEvent } from "./scenario_evidence.mjs";
import { actionAck } from "./authoring_pending_evidence.mjs";
import { wireTerminal } from "./live_run_wait.mjs";
import { canonicalMessagesFromRows, composeSessionMessages } from "./authoring_history_evidence.mjs";
import { auditCanonicalCoverage } from "./authoring_checkpoint_coverage.mjs";
import { canonicalRequestBindingsForProviderCall, providerOperation } from "./authoring_call_evidence.mjs";
import { NATIVE_CHAT_WIRE, checkpointSelectionsFromFacts, plannedExplorationLeaves,
  requestFactsFromRecord, scopeContentOf } from "./authoring_request_facts.mjs";

const list = (value) => Array.isArray(value) ? value : [];
const textOf = (row) => list(row.blocks).filter((block) => block.type === "text").map((block) => block.text).join("");
const timeValue = (value) => {
  const parsed = Date.parse(String(value ?? "").replace(" ", "T").replace(/(\.\d{3})\d+/u, "$1"));
  return Number.isFinite(parsed) ? parsed : null;
};
// SQLite 持久时间是观察时钟；可选 emitted_at 不参与此判据，也不作 fallback。
const persistedEventTime = (value) => {
  const match = typeof value === "string" && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})Z$/u.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return null;
  const normalized = match[1] + "." + match[2].padEnd(6, "0") + "Z";
  if (new Date(value).toISOString() !== normalized.slice(0, 23) + "Z") return null;
  return normalized;
};
const messageKey = (row) => JSON.stringify([row.run_id, row.run_sequence]);
const messagesOf = (db, sessionId) => canonicalMessagesFromRows(
  db.authoring_session_messages.filter((row) => row.session_id === sessionId), db.agent_runs);
const summaryOptions = (db, records) => ({ verifyExecutions: true, verifyRequests: true,
  providerRuns: db.provider_runs, providerOutputs: db.provider_outputs, providerRecords: records });

export function assertHistoryPreserved(before, after) {
  const finalRows = new Map(after.authoring_session_messages.map((row) => [messageKey(row), row]));
  assert.equal(finalRows.size, after.authoring_session_messages.length, "canonical 坐标重复");
  for (const row of before.authoring_session_messages)
    assert.deepEqual(finalRows.get(messageKey(row)), row, "原始历史被修改或缺失");
}


// 现役 driver 与事后取消 oracle 共用同一真实在途目标选择，绝不按 started 猜已实调。
export function inFlightSummaryForRun(db, { runId, workId, sessionId }) {
  const runs = db.agent_runs.filter((row) => row.id === runId);
  assert(runs.length <= 1, "取消运行身份多义");
  const run = runs[0];
  if (!run || run.status !== "running" || run.work_id !== workId || run.session_id !== sessionId) return null;
  const payloadOf = (event) => typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
  const targets = [];
  for (const provider of db.provider_runs.filter((row) => row.agent_run_id === runId &&
    row.status === "running" && providerOperation(row) === "transcript_compaction")) {
    for (const key of ["workspace_id", "work_id", "session_id", "parent_turn_ref"])
      assert(typeof run[key] === "string" && run[key] !== "" && provider[key] === run[key], "摘要 Provider 归属不一致");
    assert(provider.purpose === "other" && typeof provider.id === "string" && provider.id !== "" &&
      typeof provider.provider_call_ref === "string" && provider.provider_call_ref !== "", "摘要 Provider 身份缺失");
    const events = db.provider_events.filter((event) => event.provider_run_id === provider.id);
    assert(events.every((event) => event.provider_call_ref === provider.provider_call_ref &&
      event.agent_run_id === runId), "摘要事件执行引用不一致");
    assert(events.every((event) => Number.isInteger(event.sequence) && event.sequence > 0) &&
      new Set(events.map((event) => event.sequence)).size === events.length, "摘要事件 sequence 缺失或多义");
    if (db.provider_outputs.some((output) => output.provider_run_id === provider.id ||
      output.provider_call_ref === provider.provider_call_ref) ||
      events.some((event) => ["final_output", "error", "cancel_requested", "cancelled"].includes(event.event_type))) continue;
    const dispatched = events.filter((event) => event.event_type === "progress" &&
      payloadOf(event)?.phase === "request_dispatched");
    assert(dispatched.length <= 1, "摘要 dispatch 事实多义");
    const dispatch = dispatched[0];
    const dispatchedAt = persistedEventTime(dispatch?.inserted_at);
    if (!dispatch || dispatchedAt === null) continue;
    const chunks = events.filter((event) => event.event_type === "chunk" &&
      Number.isInteger(payloadOf(event)?.content_length) && payloadOf(event).content_length > 0 &&
      Number.isInteger(event.sequence) && event.sequence > dispatch.sequence &&
      persistedEventTime(event.inserted_at) !== null && persistedEventTime(event.inserted_at) >= dispatchedAt)
      .sort((left, right) => left.sequence - right.sequence);
    if (!chunks.length) continue;
    assert(chunks[0].sequence !== chunks[1]?.sequence, "摘要首 chunk 事实多义");
    targets.push({ provider_run_ref: provider.id, provider_call_ref: provider.provider_call_ref,
      dispatched_at: dispatch.inserted_at, chunk_at: chunks[0].inserted_at });
  }
  assert(targets.length <= 1, "同一 run 的真实在途摘要目标多义");
  return targets[0] ?? null;
}

// External transport evidence cannot stand in for the product cancel/ACK/canonical oracle.
export function verifyStreamCancellationFacts(probe, events, bytes, actualRequest) {
  const binding = probe.stream_binding;
  assert(binding && /^request-[1-9][0-9]*$/u.test(binding.request_id), "stream_binding_missing");
  const digest = value => createHash("sha256").update(value).digest("hex");
  assert.equal(digest(bytes.request),binding.request_sha256,"stream_request_bytes_changed");
  assert.deepEqual(JSON.parse(bytes.request.toString("utf8")),actualRequest.request.body,"stream_actual_request_mismatch");
  assert.equal(actualRequest.provider_run_ref,binding.provider_run_ref);
  assert.equal(actualRequest.provider_call_ref,binding.provider_call_ref);
  const unique = name => {
    const matches = events.map((event,index)=>({event,index})).filter(({event})=>event.event===name &&
      (event.request_id === binding.request_id || name === "gate_disarmed"));
    assert.equal(matches.length,1,"stream_event_missing_or_repeated:"+name); return matches[0];
  };
  const windows = events.map((event,index)=>({event,index})).filter(({event})=>event.event==="window_opened");
  assert.equal(windows.length,1,"stream_window_missing_or_repeated");
  const registered = unique("request_registered"), armed = unique("gate_armed");
  assert(windows[0].index < registered.index && registered.event.window_id === windows[0].event.id, "stream_wrong_window");
  const paused = unique("prefix_delivered_and_paused"), downstream = unique("downstream_close");
  const closed = unique("upstream_close"), disarmed = unique("gate_disarmed");
  const requestEvents = events.map((event,index)=>({event,index}))
    .filter(({event})=>event.request_id===binding.request_id);
  assert(!requestEvents.some(({event})=>event.event==="upstream_error"),"stream_upstream_error");
  const destroys = requestEvents.filter(({event})=>event.event==="upstream_destroy_requested");
  const priorComplete = closed.index < downstream.index;
  if (priorComplete) {
    assert(closed.index > paused.index && closed.event.response_complete === true &&
      closed.event.cause === null && destroys.length === 0,"stream_prior_close_not_complete");
  } else {
    assert.equal(destroys.length,1,"stream_abort_missing_or_repeated");
    assert(downstream.index < destroys[0].index && destroys[0].index < closed.index,"stream_abort_order_invalid");
    assert.equal(destroys[0].event.cause,"downstream_disconnect");
    assert.equal(closed.event.cause,"downstream_disconnect");
  }
  assert([registered,armed,paused,downstream,disarmed].every((row,index,array)=>
    index===0 || row.index>array[index-1].index) && closed.index < disarmed.index,"stream_abort_order_invalid");
  assert.equal(events.filter(event=>event.event==="request_registered" &&
    event.request_sha256===binding.request_sha256).length,1,"stream_request_retried");
  for (const key of ["request_id","request_sha256","provider_run_ref","provider_call_ref"])
    assert.equal(armed.event[key],binding[key],"stream_arm_identity_changed");
  assert.equal(disarmed.event.gate.cause,"downstream_disconnect");
  assert.notEqual(disarmed.event.gate.upstream_error,true,"stream_disarm_upstream_error");
  assert.equal(disarmed.event.disarmed,true);
  assert.deepEqual(disarmed.event.active_requests,[]);
  assert.equal(events.filter(event=>event.event==="gate_armed").length,1,"stream_gate_rearmed");
  assert.equal(events.filter(event=>event.event==="prefix_delivered_and_paused").length,1);
  const downstreamAt=timeValue(downstream.event.at), commandAt=timeValue(probe.command_sent_at);
  const pausedAt=timeValue(paused.event.at);
  assert([downstreamAt,commandAt,pausedAt].every(value=>value!==null) &&
    downstreamAt>=commandAt && downstreamAt>=pausedAt && downstreamAt-pausedAt<30000,
  "stream_closed_outside_user_cancel_window");
  assert.equal(bytes.delivered.length,paused.event.prefix_bytes);
  assert.equal(digest(bytes.delivered),paused.event.prefix_sha256);
  assert(bytes.received.subarray(0,bytes.delivered.length).equals(bytes.delivered),"stream_prefix_rewritten");
  const prefix = new TextDecoder("utf-8",{fatal:true}).decode(bytes.delivered);
  assert(/(?:\r\n\r\n|\n\n)$/u.test(prefix),"stream_prefix_incomplete_record");
  const records = prefix.split(/\r?\n\r?\n/u);
  records.pop();
  const data = records
    .map(record=>record.split(/\r?\n/u).filter(line=>line.startsWith("data:"))
      .map(line=>line.slice(5).replace(/^ /u,"")).join("\n"));
  assert(!data.includes("[DONE]"),"stream_done_delivered_before_cancel");
  const bodyRecords = data.map(value=>value ? JSON.parse(value) : {});
  const nonempty = bodyRecords.map(body=>(body.choices ?? []).some(choice=>
    typeof choice.delta?.content==="string" && choice.delta.content.length>0));
  assert(nonempty.at(-1) === true && nonempty.slice(0,-1).every(value=>value===false), "stream_not_first_content_boundary");
  const content = bodyRecords.flatMap(value=>value.choices ?? []);
  assert(content.some(choice=>typeof choice.delta?.content==="string" && choice.delta.content.length>0),
    "stream_real_content_missing");
  assert(content.every(choice=>choice.finish_reason==null),"stream_terminal_content_delivered");
  return {ok:true,request_id:binding.request_id,transport_abort_observed:!priorComplete,
    upstream_complete_before_disconnect:priorComplete,vendor_compute_stopped:null};
}

export function verifyCancelledRunFacts(probe, db, wire, { before, confirmation, afterCancel, afterClientRelaunch, author, scope }) {
  assert(probe?.recovery_scope === "owned_tauri_client", "取消恢复边界必须明确为 owned client");
  const id = probe.request?.run_id;
  const run = before.agent_runs.find((row) => row.id === id);
  assert(run?.status === "running" && run.work_id === scope.work_id && run.session_id === scope.session_id,
    "取消未命中本会话真实忙碌运行");
  const sources = messagesOf(before, run.session_id).filter((row) => row.run_id === id &&
    row.role === "user" && row.provenance === "author");
  assert.deepEqual(sources.map(textOf), [author.text], "取消作者输入偏离冻结原文");
  assert.equal(probe.request.text, author.text);
  if (author.id !== undefined) assert.equal(probe.request.author_id, author.id);
  if (author.sha256 !== undefined) assert.equal(probe.request.author_sha256, author.sha256);
  const sent = wire.filter((record) => record.direction === "sent" && frameEvent(record) === "agent_command" &&
    record.frame?.[2] === "workspace:" + run.workspace_id && record.frame[1] === probe.command_ref &&
    frameBody(record)?.run_id === id && frameBody(record)?.command === "cancel");
  assert.equal(sent.length, 1, "缺唯一同运行取消命令");
  const { reply, response } = actionAck(wire, sent[0]);
  assert.equal(response.run_id, id);
  assert.equal(response.command, "cancel");
  assert.equal(probe.command_run_id, id);
  assert.equal(probe.command_sent_at, sent[0].at);
  assert.equal(probe.reply_at, reply.at);
  assert.equal(probe.reply_status, "ok");
  assert(timeValue(before.captured_at) !== null && timeValue(before.captured_at) <= timeValue(sent[0].at));
  assert(timeValue(probe.terminal_at) >= timeValue(reply.at) &&
    timeValue(probe.client_relaunch_at) >= timeValue(probe.terminal_at));
  assert.equal(probe.terminal_status, "cancelled");
  for (const snapshot of [afterCancel, afterClientRelaunch, db])
    assert.equal(snapshot.agent_runs.find((row) => row.id === id)?.status, "cancelled", "受理不能代签 cancelled");
  const selection = { runId: id, workId: scope.work_id, sessionId: scope.session_id };
  const target = inFlightSummaryForRun(before, selection);
  assert(target, "未命中真实 dispatch 且已回流的在途摘要，业务取消不能代签");
  assert.deepEqual(inFlightSummaryForRun(confirmation, selection), target, "确认前摘要目标已终止或被替换");
  assert.deepEqual(probe.summary_target, { ...target, observed_at: probe.summary_target?.observed_at });
  const times = [target.chunk_at, probe.summary_target.observed_at, before.captured_at,
    confirmation.captured_at, probe.confirmation_target_checked_at, sent[0].at].map(timeValue);
  assert(times.every((value) => value !== null) && times.every((value, index) => index === 0 || value >= times[index - 1]),
    "摘要观察、二次快照与真实取消命令时间顺序不成立");
  assertHistoryPreserved(before, confirmation);
  for (const [earlier, later] of [[before, afterCancel], [afterCancel, afterClientRelaunch], [afterClientRelaunch, db]])
    assertHistoryPreserved(earlier, later);
  const checkpoints = (snapshot) => snapshot.agent_events.filter((event) => event.run_id === id &&
    event.event_type === "checkpoint_created");
  assert.deepEqual(checkpoints(afterCancel), checkpoints(before), "取消期间 checkpoint 逃逸");
  assert.deepEqual(afterClientRelaunch.authoring_session_messages, afterCancel.authoring_session_messages,
    "取消后客户端恢复新增或更改原文");
  assert.deepEqual(afterClientRelaunch.agent_events, afterCancel.agent_events, "客户端恢复重复或丢失事件");
  for (const snapshot of [afterCancel, afterClientRelaunch, db])
    assert.equal(snapshot.provider_runs.find((row) => row.id === target.provider_run_ref &&
      row.provider_call_ref === target.provider_call_ref)?.status, "cancelled", "原在途摘要未真实取消");
  return { ok: true, run_id: id, canonical_originals_preserved: true,
    recovery_scope: "owned_tauri_client", active_provider_run_ids: [target.provider_run_ref],
    summary_cancellation: { ok: true, provider_run_ids: [target.provider_run_ref], target },
    backend_recovery_signed: false };
}

function interleavedRuns(trace, db, waiting, before) {
  const a = db.agent_runs.find((run) => run.id === trace?.waiting_run_id);
  const b = db.agent_runs.find((run) => run.id === trace?.later_run_id);
  assert(a?.session_id && b && a.id !== b.id, "A/B 缺唯一运行身份");
  for (const key of ["workspace_id", "work_id", "session_id"]) assert.equal(a[key], b[key], "A/B scope mismatch");
  assert.equal(a.status, "completed");
  assert.equal(b.status, "completed");
  assert.equal(a.goal_version, trace.waiting_goal_version + 1);
  for (const snapshot of [waiting, before]) {
    const active = snapshot.agent_runs.find((run) => run.id === a.id);
    assert.equal(active?.status, "awaiting_author", "A 必须真实保持等待原问题");
    assert.equal(active.goal_version, trace.waiting_goal_version);
  }
  assert.equal(before.agent_runs.find((run) => run.id === b.id)?.status, "completed");
  const warmups = trace.warmup_run_ids;
  assert(Array.isArray(warmups) && warmups.length > 0 && new Set(warmups).size === warmups.length, "缺已完成的早期来源运行");
  for (const id of warmups) {
    const run = waiting.agent_runs.find((row) => row.id === id);
    assert(run && run.status === "completed" && run.session_id === a.session_id && ![a.id, b.id].includes(id));
  }
  for (const snapshot of [waiting, before]) assertHistoryPreserved(snapshot, db);
  return { a, b, warmups };
}

function interleavedAnswer(trace, a, b, wire, expectedAnswer) {
  const topic = "workspace:" + a.workspace_id;
  const actions = wire.filter((record) => {
    const action = frameBody(record)?.action, payload = action?.payload;
    return record.direction === "sent" && record.frame?.[2] === topic && frameEvent(record) === "author_action" &&
      action?.action_type === "author_choice" && action.target_ref === a.id &&
      payload?.question_ref === trace.waiting_question_ref && payload.expected_goal_version === trace.waiting_goal_version;
  });
  assert.equal(actions.length, 1, "必须有唯一的 A 原问题回答帧");
  assert.equal(frameBody(actions[0]).action.payload.text, expectedAnswer, "回答必须是冻结作者原文");
  const { response } = actionAck(wire, actions[0], { actionStatus: "accepted" });
  assert.equal(response.action_id, frameBody(actions[0]).action.action_id);
  assert.equal(response.run_id, a.id);
  assert.equal(response.question_ref, trace.waiting_question_ref);
  assert.equal(response.goal_version, a.goal_version);
  const sentAt = timeValue(actions[0].at);
  assert(sentAt !== null);
  const terminal = wireTerminal(wire.filter((record) => timeValue(record.at) < sentAt), {
    turnId: b.parent_turn_ref, runId: b.id, runRow: b, topic, workId: b.work_id, sessionId: b.session_id,
  });
  assert(terminal?.kind === "completed", "必须先收到 B 业务结果且真实运行已完成，再回答 A");
  return { response, sentAt };
}

function interleavedCheckpoint(a, b, warmups, before, records, sentAt) {
  const rows = messagesOf(before, a.session_id);
  const checkpoints = rows.filter((row) => row.run_id === b.id && row.role === "checkpoint");
  const events = before.agent_events.filter((event) => event.run_id === b.id && event.event_type === "checkpoint_created");
  assert(checkpoints.length > 0 && checkpoints.length === events.length, "B 的 checkpoint/event 必须逐项绑定");
  assert(new Set(events.map((event) => event.sequence)).size === events.length, "B 的 checkpoint 事件重复");
  assert(events.every((event) => timeValue(event.inserted_at) !== null && timeValue(event.inserted_at) < sentAt));
  const audit = auditCanonicalCoverage(rows, summaryOptions(before, records));
  assert(audit.ok, audit.reason);
  const selected = audit.checkpoints.filter((item) => item.canonical_ref.run_id === b.id);
  assert(selected.some((item) => item.selected.some((ref) => ref.role === "assistant" && warmups.includes(ref.run_id))),
    "B 必须实际整理早期已完成讨论，Scope-only 不能代签");
  const protectedRows = rows.filter((row) => row.run_id === a.id);
  const retained = new Set(audit.retainedMessages.map((row) => messageKey(row.canonical_ref)));
  assert(protectedRows.every((row) => retained.has(messageKey(row.canonical_ref))), "A 等待中的全部原文必须保留");
  return { checkpoints, covered: selected.flatMap((item) => item.covers.call_ids),
    coveredMessages: selected.flatMap((item) => item.covers.message_refs) };
}

function resumedProviderRun(a, db, sentAt, provider) {
  assert(typeof provider === "string" && provider !== "", "缺明确 provider");
  const providers = new Map(db.provider_runs.filter((run) => run.agent_run_id === a.id &&
    run.session_id === a.session_id && run.provider_id === provider && providerOperation(run) !== "transcript_compaction")
    .map((run) => [run.id, run]));
  const starts = db.provider_events.filter((event) => event.event_type === "started" &&
    providers.has(event.provider_run_id) && timeValue(event.emitted_at) >= sentAt)
    .sort((left, right) => timeValue(left.emitted_at) - timeValue(right.emitted_at));
  assert(starts.length > 0, "缺少 A 恢复后的 Provider 请求");
  assert.notEqual(timeValue(starts[0].emitted_at), timeValue(starts[1]?.emitted_at), "首个请求不能多义");
  return providers.get(starts[0].provider_run_id);
}

function resumedRequest(run, records, checkpoints) {
  const paired = records.filter((record) => record.provider_run_ref === run.id && record.provider_call_ref === run.provider_call_ref);
  assert.equal(paired.length, 1, "A 恢复请求须按 Provider run/call 唯一绑定");
  const facts = requestFactsFromRecord(paired[0]);
  assert(facts.ok && facts.format === NATIVE_CHAT_WIRE && facts.malformedCalls === 0 && facts.malformedToolMessages === 0);
  const wire = checkpointSelectionsFromFacts(facts);
  for (const checkpoint of checkpoints) {
    for (const block of checkpoint.blocks) assert(wire.some((covers) => isDeepStrictEqual(covers, block.covers)), "A 缺 B 的精确覆盖");
  }
  return { record: paired[0], facts };
}

function resumedHistory(rows, answer, facts, bindings, db, records) {
  const audit = auditCanonicalCoverage(rows.filter((row) => row.sequence <= answer.sequence), summaryOptions(db, records));
  assert(audit.ok, audit.reason);
  const history = audit.retainedMessages;
  const retainedCalls = history.filter((row) => row.role === "assistant").flatMap((row) =>
    row.blocks.filter((block) => block.type === "tool_call"));
  const retainedResults = history.filter((row) => row.role === "tool").flatMap((row) =>
    row.blocks.filter((block) => ["observation", "validation_result"].includes(block.type)));
  assert.deepEqual(facts.toolCalls.map((call) => call.callId), retainedCalls.map((call) => call.call_id));
  retainedCalls.forEach((call, index) => {
    assert.equal(facts.toolCalls[index].name, call.name);
    if (typeof call.raw_arguments === "string") assert.equal(facts.toolCalls[index].rawArguments, call.raw_arguments);
    else assert.deepEqual(JSON.parse(facts.toolCalls[index].rawArguments), call.arguments);
  });
  assert.deepEqual(facts.toolResults.map((result) => result.payload), retainedResults);
  const authorTexts = history.filter((row) => row.role === "user" && row.provenance === "author").map(textOf);
  assert(bindings, "恢复请求消息必须与完整 canonical 前缀逐项一致");
  const actualAuthors = bindings.filter(({ canonical }) => canonical.role === "user" && canonical.provenance === "author")
    .map(({ actual }) => actual.text);
  assert.deepEqual(actualAuthors, authorTexts);
  const discussionTexts = history.filter((row) => row.role === "assistant" && row.provenance === "model" &&
    row.blocks.length > 0 && row.blocks.every((block) => block.type === "text")).map(textOf);
  assert.deepEqual(facts.messages.filter((message) => message.role === "assistant" && !message.tool_calls?.length)
    .map((message) => message.content), discussionTexts, "等待问题与未完成承诺原文必须同序保留");
  return { retainedCalls, retainedResults, authorTexts };
}

export function verifyInterleavedResumeFacts(trace, db, wire, records, { provider, waitingSnapshot, beforeAnswerSnapshot, warmupAuthors, controls }) {
  const { a, b, warmups } = interleavedRuns(trace, db, waitingSnapshot, beforeAnswerSnapshot);
  assert(Array.isArray(warmupAuthors) && warmupAuthors.length === warmups.length && Array.isArray(controls) && controls.length >= 3,
    "缺预注册作者输入");
  const initialRows = messagesOf(beforeAnswerSnapshot, a.session_id);
  const originalAuthors = (runId) => initialRows.filter((row) => row.run_id === runId &&
    row.role === "user" && row.provenance === "author").map(textOf);
  warmups.forEach((id, index) => assert.deepEqual(originalAuthors(id), [warmupAuthors[index].text], "早期作者输入偏离冻结顺序"));
  assert.deepEqual(originalAuthors(a.id), [controls[0].text], "A 输入偏离冻结原文");
  assert.deepEqual(originalAuthors(b.id), [controls[1].text], "B 输入偏离冻结原文");
  const beforeB = beforeAnswerSnapshot.agent_runs.find((run) => run.id === b.id);
  const { response, sentAt } = interleavedAnswer(trace, a, beforeB, wire, controls[2].text);
  const { checkpoints, covered, coveredMessages } = interleavedCheckpoint(a, b, warmups, beforeAnswerSnapshot, records, sentAt);
  const rows = messagesOf(db, a.session_id), checkpoint = checkpoints.at(-1);
  const run = resumedProviderRun(a, db, sentAt, provider);
  const { record, facts } = resumedRequest(run, records, checkpoints);
  const answers = rows.filter((row) => row.run_id === a.id && row.role === "user" &&
    row.sequence > checkpoint.sequence && row.author_turn?.question_ref === trace.waiting_question_ref);
  assert.equal(answers.length, 1, "缺唯一 canonical 原问题回答");
  const answer = answers[0];
  assert.equal(textOf(answer), controls[2].text, "canonical 回答与冻结作者原文不符");
  const bindings = canonicalRequestBindingsForProviderCall(record, {
    messages: composeSessionMessages(rows, run.agent_run_id),
  });
  const retained = resumedHistory(rows, answer, facts, bindings, db, records);
  const scope = rows.find((row) => row.sequence > answer.sequence && row.run_id === a.id &&
    row.role === "scope_update" && row.versions?.goal === response.goal_version);
  const projected = bindings.findLast(({ canonical }) => canonical.role === "scope_update")?.actual;
  assert(scopeContentOf(scope) && projected?.scopeContent, "恢复 A 必须使用当前 Scope");
  assert.deepEqual(projected.scopeContent, scopeContentOf(scope));
  assert.deepEqual(projected.versions, scope.versions);
  assert.deepEqual(projected.sourceRefs, scope.source_refs);
  return { ok: true, session_id: a.session_id, waiting_run_id: a.id, later_run_id: b.id,
    checkpoint_sequence: checkpoint.sequence, covered_call_ids: covered, covered_message_refs: coveredMessages,
    provider_run_id: run.id, provider_call_ref: run.provider_call_ref,
    retained_exchanges: retained.retainedCalls.length, exact_author_messages: retained.authorTexts.length,
    observations_with_refs: retained.retainedResults.filter((block) => list(block.source_refs).length > 0).length,
    observations_with_versions: retained.retainedResults.filter((block) =>
      (plannedExplorationLeaves(block) ?? [block]).some((entry) => Object.keys(entry.versions ?? {}).length > 0)).length,
    goal_version: response.goal_version, waiting_history_protected: true, semantic_status: "review_required" };
}
