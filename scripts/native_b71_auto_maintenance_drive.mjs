// R03 原生交错、取消与恢复驱动；冻结顺序见 model-interaction-coverage §5。
// 继续使用 NativeScenarioHarness、现役 capture/DB reader 与真实页面；不管理外部模型服务。
// answer-mode 是仍在使用的确定性同 run 问答入口，与 R03 共用当前回答面板操作。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  NativeScenarioHarness, ROOT, ensureWorkSelected, frameBody, isVisibleNode, runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import { all, dbPath, frameEvent, logs, withDb, write } from "./lib/native_ui/scenario_evidence.mjs";
import { actionAck } from "./lib/native_ui/authoring_pending_evidence.mjs";
import { typeText } from "./lib/native_ui/driver.mjs";
import { BACKEND_RESTART_LABEL, requestBackendRestart } from "./native_ui_wait.mjs";
import { readConfig, readAutoMaintenanceInputs } from "./lib/native_ui/authoring_capture_evidence.mjs";
import { readAutoMaintenanceDbFacts, scanAuthorVisibleFiles, verifyMaintenanceFailureFacts } from "./lib/native_ui/authoring_auto_maintenance_evidence.mjs";
import { inFlightSummaryForRun } from "./lib/native_ui/authoring_interleaved_resume_evidence.mjs";
import { wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import { canonicalMessagesFromRows } from "./lib/native_ui/authoring_history_evidence.mjs";
import { auditCanonicalCoverage, auditDiscussionRequest } from "./lib/native_ui/authoring_checkpoint_coverage.mjs";


const TURN_TIMEOUT_MS = Number(process.env.B71_AUTO_MAINT_TURN_TIMEOUT_MS ?? 360_000);
const INPUT_TIMEOUT_MS = Number(process.env.B71_AUTO_MAINT_INPUT_TIMEOUT_MS ?? 120_000);
const READY_TIMEOUT_MS = Number(process.env.B71_AUTO_MAINT_READY_TIMEOUT_MS ?? 180_000);
const FLOW_LABEL = "b71-auto-maint";
const evidence = path.join(ROOT, "scripts/native_b71_evidence.mjs");
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const values = (node) => [node?.title, node?.desc, node?.value].filter((value) => typeof value === "string");
let dir, harness, config;

function findButtonByText(nodes, predicate, { requireEnabled = true } = {}) {
  const matches = nodes.filter((node) => node?.role === "AXButton" && isVisibleNode(node) &&
    (!requireEnabled || node.enabled !== false) && values(node).some(predicate));
  return matches.length === 1 ? matches[0] : null;
}

function readRunRow(runId) {
  return withDb(dir, (db) => all(db,
    "SELECT id, status, parent_turn_ref, goal_version, workspace_id, work_id, session_id FROM agent_runs WHERE id = ?",
    [runId])[0] ?? null);
}

const checkpointEventCount = () => withDb(dir, (db) =>
  Number(all(db, "SELECT COUNT(*) AS c FROM agent_events WHERE event_type = 'checkpoint_created'")[0]?.c ?? 0));
const checkpointMessageCount = () => withDb(dir, (db) =>
  Number(all(db, "SELECT COUNT(*) AS c FROM authoring_session_messages WHERE role = 'checkpoint'")[0]?.c ?? 0));
const providerCallsForRun = (runId) => withDb(dir, (db) =>
  Number(all(db, "SELECT COUNT(*) AS c FROM provider_runs WHERE agent_run_id = ?", [runId])[0]?.c ?? 0));
const llmRecordCount = () => logs(path.join(dir, "llm-calls")).length;

function snapshot(name, facts) {
  const file = name + "-db.json";
  write(dir, file, { captured_at: harness.nowIso(), ...(facts ?? readAutoMaintenanceDbFacts(dir)) });
  return file;
}

function captureCheckpoint(name) {
  harness.capture(name, { allowFullScreenFallback: false });
  runEvidenceMode(evidence, "capture", dir, [name]);
}

function openAuthorQuestionFor(wire, runId) {
  let latest = null;
  for (const record of wire) {
    if (record?.direction !== "received" || frameEvent(record) !== "turn_result") continue;
    const question = frameBody(record)?.author_question;
    if (question?.run_id === runId) latest = question;
  }
  return latest?.status === "open" ? latest : null;
}

// 共同 ACK owner 核对 join/topic/request ref 与唯一回包；此处只收窄本流程的业务身份。
export function authorChoiceAckFor(wire, { runId, wireStart, expected, text }) {
  if (!runId || !expected?.question_ref || !Number.isInteger(expected.goal_version)) return null;
  const sent = wire.slice(wireStart).filter((record) => {
    const action = frameBody(record)?.action;
    return record?.direction === "sent" && frameEvent(record) === "author_action" &&
      action?.action_type === "author_choice" && action.target_ref === runId &&
      typeof action.action_id === "string" && action.action_id.trim() !== "" &&
      typeof action.source_turn_ref === "string" && action.source_turn_ref.trim() !== "" &&
      action.payload?.question_ref === expected.question_ref &&
      action.payload.expected_goal_version === expected.goal_version &&
      (text === undefined || action.payload.text === text);
  });
  if (sent.length !== 1) return null;
  try {
    const { reply, response } = actionAck(wire, sent[0], { actionStatus: "accepted" });
    const action = frameBody(sent[0]).action;
    if (response.action_type !== "author_choice" || response.run_id !== runId ||
        response.action_id !== action.action_id || response.source_turn_ref !== action.source_turn_ref ||
        response.question_ref !== expected.question_ref || response.goal_version !== expected.goal_version + 1) return null;
    return { sent: sent[0], action, reply, response };
  } catch { return null; }
}

export function cancelAckFor(wire, { runId, wireStart }) {
  const sent = wire.slice(wireStart).filter((record) => record?.direction === "sent" &&
    frameEvent(record) === "agent_command" && frameBody(record)?.run_id === runId &&
    frameBody(record)?.command === "cancel");
  if (!runId || sent.length !== 1) return null;
  try {
    const { reply, response } = actionAck(wire, sent[0]);
    return response.run_id === runId && response.command === "cancel" ?
      { sent: sent[0], reply, response } : null;
  } catch { return null; }
}

export function requireSameSummaryTarget(expected, current) {
  assert(current && current.provider_run_ref === expected.provider_run_ref &&
    current.provider_call_ref === expected.provider_call_ref, "summary_cancellation_target_no_longer_in_flight");
}

async function waitBoundary(runId, { wireStart = 0, minimumGoalVersion = 0 } = {}) {
  return harness.runStep("turn", "run_boundary", () => harness.pollWire((wire) => {
    const row = readRunRow(runId);
    if (!row) return null;
    const terminal = wireTerminal(wire.slice(wireStart), {
      turnId: row.parent_turn_ref, runId, topic: "workspace:" + row.workspace_id,
      workId: config.target.work_id, sessionId: config.target.session_id,
      workspaceId: row.workspace_id, runRow: row, minimumGoalVersion, requireWireTerminal: true,
      resultPosition: "last",
    });
    return terminal ? { kind: terminal.status === "awaiting_author" ? "paused" : "terminal",
      status: terminal.status } : null;
  }, TURN_TIMEOUT_MS, FLOW_LABEL + ":run_boundary"));
}

async function startRequest(report, author) {
  await harness.runStep("maintenance", "input_ready", () =>
    harness.rawWaitInputReady(FLOW_LABEL, INPUT_TIMEOUT_MS));
  const index = report.requests.length + 1;
  const wireStart = harness.transport().length;
  const sent = await harness.runStep("input", "request_" + index, () =>
    harness.rawTypeAndSend(author.text, FLOW_LABEL));
  const turnId = frameBody(sent)?.turn_id;
  assert(typeof turnId === "string" && turnId !== "", "request user_message_without_turn_id");
  const bound = await harness.runStep("ack", "request_" + index + "_ack", () =>
    harness.pollWire((wire) => {
      try { return actionAck(wire, sent); } catch { return null; }
    }, 25_000, FLOW_LABEL + ":request_ack"));
  const runId = bound.response.run_id;
  assert(typeof runId === "string" && runId !== "", "request_ack_without_run_id");
  const row = readRunRow(runId);
  assert(row?.parent_turn_ref === turnId && row.work_id === config.target.work_id &&
    row.session_id === config.target.session_id, "request_ack_run_scope_mismatch");
  const request = { index, author_id: author.id, author_sha256: author.sha256, text: author.text,
    turn_id: turnId, run_id: runId, sent_at: sent.at, ack_at: bound.reply.at, wire_start: wireStart };
  report.requests.push(request);
  harness.capture("req-" + String(index).padStart(2, "0"), { allowFullScreenFallback: false });
  return request;
}

async function sendRequest(report, author) {
  const request = await startRequest(report, author);
  const boundary = await waitBoundary(request.run_id, { wireStart: request.wire_start });
  Object.assign(request, { terminal_kind: boundary.kind, terminal_status: boundary.status,
    run_status: boundary.status, settled: boundary.status === "completed",
    checkpoint_events_after: checkpointEventCount(), provider_calls: llmRecordCount() });
  return request;
}

function requireCompleted(request) {
  assert.equal(request.settled, true, "frozen_request_not_completed:" + request.author_id);
}

async function visibleClick(label, predicate = (text) => text === label, beforeClick = () => {}) {
  return harness.runStep("input", label, async () => {
    const { nodes } = await harness.pollAx((_text, nodes) =>
      Boolean(findButtonByText(nodes, predicate)), 20_000, FLOW_LABEL + ":" + label);
    beforeClick();
    return harness.safeClick(findButtonByText(nodes, predicate), FLOW_LABEL + ":" + label);
  });
}

async function answerQuestion(runId, expected, answer, { choice = null } = {}) {
  await harness.runStep("maintenance", "recover_answer_surface", () =>
    harness.activateForInteraction(FLOW_LABEL + ":answer"));
  const { nodes } = await harness.runStep("maintenance", "answer_panel", () =>
    harness.pollAx((_text, nodes) => nodes.some((node) => isVisibleNode(node) &&
      values(node).some((text) => text.includes("回答当前问题"))), 20_000, FLOW_LABEL + ":answer_panel"));
  const labels = (expected.options ?? []).filter((option) => option.kind === "choice").map((option) => option.label);
  const questionVisible = labels.length > 0 ? labels.every((label) => nodes.some((node) =>
    isVisibleNode(node) && values(node).some((text) => text.includes(label)))) :
    nodes.some((node) => isVisibleNode(node) &&
      values(node).some((text) => text.includes(String(expected.question).slice(0, 48))));
  assert(questionVisible, "visible_question_does_not_match_run");
  const wireStart = harness.transport().length;
  if (choice !== null) {
    await visibleClick("answer_choice", (text) => text === choice || text.endsWith("：" + choice));
  } else {
    const fields = nodes.filter((node) => node.role === "AXTextField" && isVisibleNode(node) &&
      values(node).some((text) => text.includes("回答当前问题")));
    assert.equal(fields.length, 1, "answer_composer_missing_or_ambiguous");
    assert(!fields[0].value || fields[0].value.trim() === "", "answer_composer_not_empty");
    await harness.runStep("input", "frozen_answer_text", async () => {
      harness.safeClick(fields[0], FLOW_LABEL + ":answer_composer");
      typeText(harness.APP, answer.text);
      await harness.pollAx((_text, current) => current.some((node) =>
        node.role === "AXTextField" && node.value === answer.text), 10_000, FLOW_LABEL + ":answer_exact_text");
    });
    await visibleClick("回答并继续");
  }
  const bound = await harness.runStep("ack", "author_choice_ack", () =>
    harness.pollWire((wire) => authorChoiceAckFor(wire, {
      runId, wireStart, expected, ...(choice === null ? { text: answer.text } : {}),
    }), 20_000, FLOW_LABEL + ":author_choice_ack"));
  const last = await waitBoundary(runId, { wireStart, minimumGoalVersion: bound.response.goal_version });
  return { last, reason: last.status === "completed" ? null : last.status,
    answer_sent_at: bound.sent.at, answer_action_id: bound.action.action_id,
    answer_author_id: answer?.id ?? null, answer_sha256: answer?.sha256 ?? null,
    attempts: [{ step: "author_choice_ack", accepted: true, ...bound.response }] };
}

async function captureMaintenance(report) {
  captureCheckpoint("after-maintenance");
  const matchesStrip = (node) => node?.role === "AXButton" &&
    values(node).includes("查看已整理的较早创作过程");
  let nodes = harness.dumpNodes();
  const first = nodes.find(matchesStrip);
  report.maintenance_strip = { found: Boolean(first), clicked: false, path: first?.path ?? null };
  if (first) {
    if (!isVisibleNode(first)) {
      await harness.runStep("input", "reveal_maintenance_strip", () =>
        harness.ensureInput().scrollTo(first.path));
    }
    nodes = harness.dumpNodes();
    const button = nodes.find((node) => node.path === first.path && matchesStrip(node) && isVisibleNode(node));
    assert(button, "maintenance_strip_not_visible");
    await harness.runStep("input", "expand_maintenance_strip", () =>
      harness.safeClick(button, FLOW_LABEL + ":strip"));
    report.maintenance_strip.clicked = true;
  }
  captureCheckpoint("after-expanded");
}

function readProblemRecord() {
  const nodes = harness.dumpNodes();
  const region = nodes.find((node) => values(node).includes("创作问题记录"));
  if (!region) return { group_found: false, child_button_count: null };
  const children = nodes.filter((node) => String(node.path).startsWith(region.path + "/"));
  return { group_found: true, region_role: region.role,
    child_button_count: children.filter((node) => node.role === "AXButton").length, child_nodes: children.length };
}

// 沿用隔离 test DB 的事务故障注入；绝不写共享 DB 或伪造 Provider/usage/canonical。
function withWritableTestDb(fn) {
  const expectedDir = fs.realpathSync(path.join(dir, "database"));
  const realFile = fs.realpathSync(dbPath(dir));
  assert.equal(path.dirname(realFile), expectedDir, "refusing_to_write_outside_batch_database");
  const db = new DatabaseSync(realFile);
  try { db.exec("PRAGMA busy_timeout = 5000"); return fn(db); }
  finally { db.close(); }
}
function injectFailureTrigger() {
  withWritableTestDb((db) => db.exec(
    "CREATE TRIGGER reject_b71_auto_maintenance BEFORE INSERT ON agent_events " +
    "WHEN NEW.event_type = 'checkpoint_created' BEGIN SELECT RAISE(ABORT, 'maintenance unavailable'); END;"));
}
function dropFailureTrigger() {
  withWritableTestDb((db) => db.exec("DROP TRIGGER reject_b71_auto_maintenance"));
}
function authorErrorVisible() {
  try {
    const nodes = harness.dumpNodes();
    return nodes.some((node) => ["AXSheet", "AXDialog"].includes(node.role)) &&
      nodes.some((node) => values(node).some((text) => /失败|错误|异常/u.test(text)));
  } catch { return null; }
}

async function runInterleavedResume(report, inputs) {
  const [waiting, later, answer, verify] = inputs.controls;
  report.warmup_requests = [];
  for (const author of inputs.discussions.slice(0, 10)) {
    const request = await sendRequest(report, author);
    report.warmup_requests.push(request);
    requireCompleted(request);
  }
  const a = await sendRequest(report, waiting);
  const trace = report.interleaved_resume = { waiting_run_id: a.run_id, later_run_id: null,
    warmup_run_ids: report.warmup_requests.map((request) => request.run_id), stop_reason: null };
  assert.equal(a.run_status, "awaiting_author", "first_run_not_waiting");
  const question = await harness.runStep("turn", "interleaved_open_question", () =>
    harness.pollWire((wire) => openAuthorQuestionFor(wire, a.run_id), 20_000, FLOW_LABEL + ":open_question"));
  trace.waiting_question_ref = question.question_ref;
  trace.waiting_goal_version = question.goal_version;
  trace.waiting_snapshot = snapshot("r03-a-waiting");
  harness.capture("interleaved-a-waiting", { allowFullScreenFallback: false });
  await visibleClick("开始新讨论");
  const b = await sendRequest(report, later);
  trace.later_run_id = b.run_id;
  trace.waiting_status_after_later_run = readRunRow(a.run_id)?.status;
  trace.before_answer_snapshot = snapshot("r03-before-answer");
  assert.notEqual(b.run_id, a.run_id, "later_run_must_be_distinct");
  requireCompleted(b);
  assert.equal(trace.waiting_status_after_later_run, "awaiting_author", "waiting_run_changed_during_B");
  harness.capture("interleaved-b-settled", { allowFullScreenFallback: false });
  report.triggered = checkpointEventCount() > 0;
  await captureMaintenance(report);
  trace.resume = await answerQuestion(a.run_id, question, answer);
  trace.answer_sent_at = trace.resume.answer_sent_at;
  trace.answer_action_id = trace.resume.answer_action_id;
  trace.stop_reason = trace.resume.reason;
  assert.equal(trace.resume.last.status, "completed", "A_not_completed_after_exact_answer");
  harness.capture("interleaved-a-resumed", { allowFullScreenFallback: false });
  report.next_request = await sendRequest(report, verify);
  requireCompleted(report.next_request);
  captureCheckpoint("after-next-request");
}


const decoded = (value) => typeof value === "string" ? JSON.parse(value) : value;
const sourceKey = (ref) => "authoring-session-source/v1:" +
  JSON.stringify([ref.workspace_id, ref.work_id, ref.session_id, ref.run_id, ref.run_sequence]);

// 场景前置仅核观察到的来源，不生成产品 plan；下一真实讨论会占 keep4 的一席。
export function requireProbeCandidate(retained, providerRuns, {candidateRunId, workId, sessionId, expectedCount}) {
  const discussions = retained.filter((message) => message.role === "assistant" && message.provenance === "model" &&
    message.blocks?.length > 0 && message.blocks.every((block) => block.type === "text" && typeof block.text === "string") &&
    message.blocks.some((block) => block.text.trim() !== ""));
  assert.equal(discussions.length, expectedCount, "probe_candidate_count_mismatch");
  assert(discussions.every((message) => message.canonical_ref.work_id === workId &&
    message.canonical_ref.session_id === sessionId), "probe_candidate_scope_mismatch");
  const candidates = discussions.filter((message) => message.canonical_ref.run_id === candidateRunId);
  assert.equal(candidates.length, 1, "probe_candidate_missing_or_ambiguous");
  const candidate = candidates[0];
  assert.equal(candidate.canonical_ref.run_status, "completed", "probe_candidate_not_completed");
  assert(discussions.indexOf(candidate) < discussions.length - 3, "probe_candidate_protected");
  const key = sourceKey(candidate.canonical_ref);
  const claimed = providerRuns.flatMap((run) => {
    const refs = decoded(run.owner_refs);
    return refs?.operation === "transcript_compaction" ? refs.discussion_source_keys ?? [] : [];
  });
  assert(!claimed.includes(key), "probe_candidate_already_owned");
  return key;
}

export function requireProbePressure(providerRuns, records, pressureRunId) {
  const executions = providerRuns.filter((run) => run.agent_run_id === pressureRunId &&
    decoded(run.owner_refs)?.operation !== "transcript_compaction");
  const pressure = records.filter((record) => executions.some((run) =>
    run.id === record.provider_run_ref && run.provider_call_ref === record.provider_call_ref))
    .sort((a,b) => String(a.ts).localeCompare(String(b.ts))).at(-1);
  assert(pressure?.response?.status === 200 && Number.isInteger(pressure.response.usage?.input_tokens) &&
    pressure.response.usage.input_tokens >= 32000 * 0.70, "probe_real_pressure_missing");
  return pressure;
}

function probeCandidate(candidateRunId, pressureRunId, expectedCount) {
  const facts = readAutoMaintenanceDbFacts(dir);
  const records = logs(path.join(dir, "llm-calls"));
  const canonical = canonicalMessagesFromRows(facts.authoring_session_messages, facts.agent_runs)
    .filter((message) => message.canonical_ref.work_id === config.target.work_id &&
      message.canonical_ref.session_id === config.target.session_id);
  const audit = auditCanonicalCoverage(canonical, {verifyExecutions:true, verifyRequests:true,
    providerRuns:facts.provider_runs, providerOutputs:facts.provider_outputs, providerRecords:records});
  assert(audit.ok, audit.reason);
  const key = requireProbeCandidate(audit.retainedMessages, facts.provider_runs, {
    candidateRunId, expectedCount, workId:config.target.work_id, sessionId:config.target.session_id});
  const pressure = requireProbePressure(facts.provider_runs, records, pressureRunId);
  return {source_key:key, snapshot:snapshot("r03-candidate-" + expectedCount, facts),
    pressure_provider_run_ref:pressure.provider_run_ref, input_tokens:pressure.response.usage.input_tokens};
}

export function requireProbeSourceClaim(facts, runId, expectedKey) {
  const attempts = facts.provider_runs.filter((run) => run.agent_run_id === runId &&
    decoded(run.owner_refs)?.operation === "transcript_compaction");
  assert.equal(attempts.length, 1, "probe_summary_attempt_not_unique");
  const run = attempts[0], refs = decoded(run.owner_refs);
  assert.deepEqual(refs.discussion_source_keys, [expectedKey], "probe_summary_candidate_mismatch");
  return run;
}

// HTTP 完整材料只在 adapter 返回后落盘；不得等待它而错过在途取消。
export function requireActualProbeSource(facts, records, runId, expectedKey) {
  const run = requireProbeSourceClaim(facts, runId, expectedKey);
  const paired = records.filter((record) => record.provider_run_ref === run.id && record.provider_call_ref === run.provider_call_ref);
  assert.equal(paired.length, 1, "probe_summary_request_missing");
  const audited = auditDiscussionRequest(paired[0], run,
    canonicalMessagesFromRows(facts.authoring_session_messages, facts.agent_runs));
  assert(audited.ok, audited.reason);
  assert.equal(audited.sourceCount, 1, "probe_summary_source_count_mismatch");
}

async function runCancelProbe(report, author) {
  const candidate = probeCandidate(report.interleaved_resume.later_run_id, report.cancel_priming.run_id, 4);
  const request = await startRequest(report, author);
  const probe = report.cancel_probe = { request, candidate, recovery_scope: "owned_tauri_client" };
  const scope = { runId: request.run_id, workId: config.target.work_id, sessionId: config.target.session_id };
  const observed = await harness.runStep("turn", "summary_cancellation_in_flight", () =>
    harness.pollWire(() => {
      const facts = readAutoMaintenanceDbFacts(dir);
      const status = facts.agent_runs.find((run) => run.id === request.run_id)?.status;
      assert(!TERMINAL_STATUSES.has(status) && status !== "awaiting_author",
        "run_settled_without_in_flight_summary");
      const target = inFlightSummaryForRun(facts, scope);
      return target ? { target, facts, observed_at: harness.nowIso() } : null;
    }, TURN_TIMEOUT_MS, FLOW_LABEL + ":summary_cancellation_in_flight"));
  requireProbeSourceClaim(observed.facts, request.run_id, candidate.source_key);
  probe.summary_target = { ...observed.target, observed_at: observed.observed_at };
  probe.before_snapshot = snapshot("r03-before-cancel", observed.facts);
  const wireStart = harness.transport().length;
  await visibleClick("终止任务");
  const dialog = await harness.runStep("maintenance", "termination_dialog", () =>
    harness.pollAx((text) => text.includes("终止当前创作任务？"), 10_000, FLOW_LABEL + ":termination_dialog"));
  assert(dialog, "termination_dialog_missing");
  harness.capture("cancel-confirmation", { allowFullScreenFallback: false });
  await visibleClick("确认终止", undefined, () => {
    const facts = readAutoMaintenanceDbFacts(dir);
    requireSameSummaryTarget(probe.summary_target, inFlightSummaryForRun(facts, scope));
    requireProbeSourceClaim(facts, request.run_id, candidate.source_key);
    probe.confirmation_snapshot = snapshot("r03-before-cancel-confirmation", facts);
    probe.confirmation_target_checked_at = harness.nowIso();
  });
  const bound = await harness.runStep("ack", "cancel_ack", () =>
    harness.pollWire((wire) => cancelAckFor(wire, { runId: request.run_id, wireStart }),
      20_000, FLOW_LABEL + ":cancel_ack"));
  Object.assign(probe, { command_sent_at: bound.sent.at, command_ref: bound.sent.frame[1],
    command_run_id: frameBody(bound.sent).run_id, reply_at: bound.reply.at,
    reply_status: frameBody(bound.reply).status });
  const terminal = await waitBoundary(request.run_id, { wireStart });
  Object.assign(request, { terminal_kind: terminal.kind, terminal_status: terminal.status,
    run_status: terminal.status, settled: false });
  Object.assign(probe, { terminal_at: harness.nowIso(), terminal_status: terminal.status,
    after_cancel_snapshot: snapshot("r03-after-cancel") });
  harness.capture("cancelled-run", { allowFullScreenFallback: false });
  assert.equal(terminal.status, "cancelled", "cancel_requested_is_not_cancelled");
  requireActualProbeSource(readAutoMaintenanceDbFacts(dir), logs(path.join(dir, "llm-calls")),
    request.run_id, candidate.source_key);
}


async function restartBackendAfterFailure(report) {
  const before = { before_snapshot: snapshot("r03-before-backend-restart"),
    provider_calls_before: llmRecordCount() };
  const receipt = await harness.runStep("restore", BACKEND_RESTART_LABEL, () => requestBackendRestart(dir));
  report.backend_restart = { ...before, receipt, recovery_scope: "owned_beam_backend_quiescent" };
  await harness.runStep("maintenance", "workbench_ready_backend_restored", () =>
    harness.rawWaitWorkbenchSettled(FLOW_LABEL + ":backend_restored", READY_TIMEOUT_MS));
  await ensureWorkSelected(harness, config.target.work_title, FLOW_LABEL + ":backend_restored");
  report.backend_restart.after_snapshot = snapshot("r03-after-backend-restart");
  report.backend_restart.provider_calls_after = llmRecordCount();
  harness.capture("after-backend-restart", { allowFullScreenFallback: false });
}

async function runRecoveryProbes(report, inputs) {
  const beforeEvents = checkpointEventCount(), beforeMessages = checkpointMessageCount();
  report.cancel_probe.client_relaunch_at = harness.nowIso();
  await harness.runStep("restore", "close_owned_client_and_relaunch", () => harness.rawCloseAppAndRelaunch());
  await harness.runStep("maintenance", "workbench_ready_restored", () =>
    harness.rawWaitWorkbenchSettled(FLOW_LABEL + ":restored", READY_TIMEOUT_MS));
  await ensureWorkSelected(harness, config.target.work_title, FLOW_LABEL + ":restored");
  report.cancel_probe.after_client_relaunch_snapshot = snapshot("r03-after-client-relaunch");
  report.refresh = { recovery_scope: "owned_tauri_client",
    before_checkpoint_events: beforeEvents, after_checkpoint_events: checkpointEventCount(),
    before_checkpoint_messages: beforeMessages, after_checkpoint_messages: checkpointMessageCount() };
  captureCheckpoint("after-refresh");

  const candidate = probeCandidate(report.interleaved_resume.waiting_run_id, report.cancel_probe.request.run_id, 5);
  const failure = report.failure_injection = { trigger_created: false, candidate,
    before_snapshot: snapshot("r03-before-failure"),
    checkpoint_events_before_failure: checkpointEventCount(),
    checkpoint_messages_before_failure: checkpointMessageCount(), recovery_requests: [] };
  try {
    injectFailureTrigger();
    failure.trigger_created = true;
    failure.injected_at = harness.nowIso();
    failure.failure_request = await sendRequest(report, inputs.discussions[11]);
  } finally {
    if (failure.trigger_created) {
      dropFailureTrigger();
      failure.removed_at = harness.nowIso();
    }
  }
  failure.after_failure_snapshot = snapshot("r03-after-failure");
  failure.checkpoint_events_after_failure = checkpointEventCount();
  failure.checkpoint_messages_after_failure = checkpointMessageCount();
  failure.author_error_visible = authorErrorVisible();
  captureCheckpoint("after-failure");
  requireCompleted(failure.failure_request);
  requireActualProbeSource(readAutoMaintenanceDbFacts(dir), logs(path.join(dir, "llm-calls")),
    failure.failure_request.run_id, candidate.source_key);
  const failureFacts = verifyMaintenanceFailureFacts(failure, logs(path.join(dir, "llm-calls")),
    logs(path.join(dir, "app-log")), {
      before:JSON.parse(fs.readFileSync(path.join(dir, failure.before_snapshot), "utf8")),
      afterFailure:JSON.parse(fs.readFileSync(path.join(dir, failure.after_failure_snapshot), "utf8")),
      failureInput:inputs.discussions[11],
      scope:{work_id:config.target.work_id, session_id:config.target.session_id},
    });
  failure.pre_restart_check = {ok:failureFacts.ok, reason:failureFacts.reason, detail:failureFacts.detail};
  assert(failureFacts.ok, failureFacts.reason);
  await restartBackendAfterFailure(report);
  failure.before_restart_snapshot = report.backend_restart.before_snapshot;
  failure.after_restart_snapshot = report.backend_restart.after_snapshot;
  for (const author of inputs.discussions.slice(12, 20)) {
    const request = await sendRequest(report, author);
    failure.recovery_requests.push(request);
    requireCompleted(request);
  }
  report.recovery = { requests: failure.recovery_requests, settled: true };
  report.recovery_followup = await sendRequest(report, inputs.controls[3]);
  requireCompleted(report.recovery_followup);
  failure.after_recovery_snapshot = snapshot("r03-after-recovery");
  captureCheckpoint("after-recovery");
}

async function runAnswerMode(report) {
  const request = await sendRequest(report, { id: "answer-mode-request", text: config.message });
  assert.equal(request.run_status, "awaiting_author", "answer_mode_question_missing");
  const question = await harness.runStep("turn", "answer_mode_open_question", () =>
    harness.pollWire((wire) => openAuthorQuestionFor(wire, request.run_id), 20_000, "answer_mode:question"));
  harness.capture("answer-mode-paused", { allowFullScreenFallback: false });
  const session = report.multi_turn = { first_run: request, run_id: request.run_id,
    problem_record: readProblemRecord() };
  const before = providerCallsForRun(request.run_id);
  const resume = await answerQuestion(request.run_id, question, null, { choice: "保留悬念" });
  session.after_steer = { resumed: resume.last.status === "completed",
    provider_calls_before: before, provider_calls_after: providerCallsForRun(request.run_id) };
  session.resume = resume;
  assert.equal(resume.last.status, "completed", "answer_mode_resume_not_completed");
  report.answer_mode = { request: config.message, choice: "保留悬念", multi_turn: session };
}

async function run() {
  runEvidenceMode(evidence, "prepare", dir);
  config = readConfig(dir);
  assert(["answer-mode", "auto-maintenance"].includes(config.journey), "unexpected_driver_journey");
  assert.equal(config.provider, config.journey === "answer-mode" ? "slice_verify" : "splash");
  const inputs = config.journey === "auto-maintenance" ? readAutoMaintenanceInputs(dir, config) : null;
  const report = { slice_id: config.slice_id, provider: config.provider,
    model: config.runtime?.observed?.provider?.model ?? null, runtime: config.runtime ?? null,
    requests: [], triggered: false, maintenance_strip: null };
  let failure = null;
  try {
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready", () =>
      harness.rawWaitWorkbenchSettled(FLOW_LABEL, READY_TIMEOUT_MS));
    await ensureWorkSelected(harness, config.target.work_title, FLOW_LABEL);
    harness.capture("01-workbench", { allowFullScreenFallback: false });
    captureCheckpoint("start");
    if (inputs) {
      await runInterleavedResume(report, inputs);
      report.cancel_priming = await sendRequest(report, inputs.discussions[10]);
      requireCompleted(report.cancel_priming);
      await runCancelProbe(report, inputs.controls[4]);
      await runRecoveryProbes(report, inputs);
    } else await runAnswerMode(report);
    captureCheckpoint("final");
  } catch (error) {
    failure = error;
    report.stop_reason = error.message;
  } finally {
    report.termination = { at: harness.nowIso(), llm_calls: llmRecordCount(),
      checkpoint_events: checkpointEventCount() };
    report.model_behavior = { provider_calls: llmRecordCount(), requests_total: report.requests.length,
      triggered: report.triggered, run_statuses: report.requests.map((request) => request.run_status) };
    report.scan = scanAuthorVisibleFiles(dir);
    harness.writeDriverLog("native-b71-driver-log.json", report);
  }
  if (failure) throw failure;
  harness.writeUiComplete(config.slice_id);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv[2], "usage: node scripts/native_b71_auto_maintenance_drive.mjs <batch-run-dir>");
  dir = path.resolve(process.argv[2]);
  harness = new NativeScenarioHarness(dir);
  await harness.runJourney(run);
}
