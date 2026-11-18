// B71 §16.16 第 2 类入口（安全点自动维护）原生验收证据与判据 C1–C10。
//
// 场景：真实 Splash + 显式产品维护预算（32000 / 0.70）+ ≥2 次
// 真实续行 → 安全点自动整理（checkpoint_created 事件 + role=checkpoint 消息同事务）→
// 行内细条 → 展开（原因/原文保留/来源/完整记录入口）→ 下一请求精简且 canonical 完整 →
// 刷新幂等 → 失败静默（隔离 DB 持久 trigger）→ 全类别无技术词 → 清理。
//
// 边界：不伪造窗口、不注入 usage、不手工压缩；无法形成真实压力时整批如实登记未闭环。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  read,
  transport,
  withDb,
  writeNativeFrames,
  writeNativeSummary,
} from "./scenario_evidence.mjs";
import { readAutoMaintenanceInputs, readConfig } from "./authoring_capture_evidence.mjs";
import { checkAuthorVisibleTexts } from "./author_visible_check.mjs";
import { assertHistoryPreserved, verifyStreamCancellationFacts, verifyCancelledRunFacts, verifyInterleavedResumeFacts } from "./authoring_interleaved_resume_evidence.mjs";
import { readBackendRestartReceipt } from "../../native_ui_wait.mjs";
import { canonicalCoverageForProviderCall, scopeForProviderCall } from "./authoring_call_evidence.mjs";
import { canonicalMessagesFromRows } from "./authoring_history_evidence.mjs";
import { auditCanonicalCoverage, auditDiscussionRequest } from "./authoring_checkpoint_coverage.mjs";
import { getRuntimeProfile, assertRuntimeFacts } from "./request_cost_runtime_recipe.mjs";
import { nativeExecutablePath } from "../native_app_ownership.mjs";
import { ownProcesses, portListening } from "./process_observation.mjs";

export const AUTO_MAINTENANCE_SCHEMA = "b71-auto-maintenance-checks/v1";
export const AUTO_MAINTENANCE_CHECKPOINTS = Object.freeze([
  "start",
  "after-maintenance",
  "after-expanded",
  "after-next-request",
  "after-refresh",
  "after-failure",
  "after-recovery",
  "final",
]);
export const AUTO_MAINTENANCE_TRIGGER_RATIO = 0.7;
export const AUTO_MAINTENANCE_STOP_EVENT = "checkpoint_created";

import {
  NATIVE_CHAT_WIRE,
  checkpointSelectionsFromFacts as wireCheckpoints,
  requestFactsFromRecord,
} from "./authoring_request_facts.mjs";
const list = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
// 正式 auto-maintenance 中 C5 缺证（ok=null）不是「不适用」，而是验收未通过；
// C7/C8 在 direct A3 与正式 live multi-turn 两个场景都必须判；仅 C11 按场景保持 null=不判。
const EVIDENCE_REQUIRED_CHECKS = new Set(["C5_next_request_compact"]);

function parseJson(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ── 全类别 AX 扫描（A3 的 capture 名称不固定，扫目录内全部 ax/text 证据）────────────
export function scanAuthorVisibleFiles(dir) {
  const hits = [];
  const files = [];
  if (!fs.existsSync(dir)) return { ok: false, hits: [], files, reason: "dir_missing" };
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.(ax|text)\.txt$/u.test(name)) continue;
    const file = path.join(dir, name);
    const raw = fs.readFileSync(file, "utf8");
    const axText = name.endsWith(".ax.txt") ? raw : "";
    const visibleText = name.endsWith(".text.txt") ? raw : "";
    files.push(name);
    const scan = checkAuthorVisibleTexts({ axText, visibleText });
    for (const hit of list(scan.hits)) {
      hits.push({
        file: name,
        token: hit.token,
        kind: hit.kind,
        source: hit.source ?? null,
        context: String(hit.text ?? "").slice(0, 240),
      });
    }
  }
  return { ok: hits.length === 0, hits, files };
}

// ── DB facts（只读）───────────────────────────────────────────────────────────
export function readAutoMaintenanceDbFacts(dir) {
  return withDb(dir, (db) => {
    const rows = (table) => all(db, `SELECT * FROM ${table}`).map((row) => ({ ...row }));
    return {
      agent_events: rows("agent_events"),
      agent_runs: rows("agent_runs"),
      authoring_session_messages: rows("authoring_session_messages"),
      provider_runs: rows("provider_runs"),
      provider_outputs: rows("provider_outputs"),
      provider_events: rows("provider_events"),
      interactions: rows("interactions"),
      mutations: rows("mutations"),
    };
  });
}

function transcriptMessages(sessionMessageRows, agentRuns) {
  return canonicalMessagesFromRows(list(sessionMessageRows), list(agentRuns));
}

const admissionSourceKey = (ref) => "authoring-session-source/v1:" +
  JSON.stringify([ref.workspace_id, ref.work_id, ref.session_id, ref.run_id, ref.run_sequence]);
const pureDiscussion = (message) => message.role === "assistant" && message.provenance === "model" &&
  Array.isArray(message.blocks) && message.blocks.length > 0 &&
  message.blocks.every((block) => block.type === "text" && typeof block.text === "string");

// 只按持久准入顺序选首份；状态/正文/资格不参与选择，微秒精度不得降为毫秒。
export function firstSummaryAdmission(before, current, runId) {
  const previous = new Set(before.provider_runs.map((run) => run.id));
  const attempts = current.provider_runs.filter((run) => {
    if (previous.has(run.id) || run.agent_run_id !== runId) return false;
    const refs = parseJson(run.owner_refs);
    assert(isObject(refs), "admission_owner_refs_unknown");
    return refs.operation === "transcript_compaction";
  });
  assert(attempts.every((run) => typeof run.inserted_at === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(run.inserted_at)), "admission_order_unknown");
  attempts.sort((a,b) => a.inserted_at.localeCompare(b.inserted_at));
  assert(attempts.length < 2 || attempts[0].inserted_at !== attempts[1].inserted_at, "admission_order_ambiguous");
  return attempts[0] ?? null;
}

// 独立按契约计数：完整工具组每个闭合调用一项、纯讨论一项，整组不可拆。
// 输入是共同 coverage 审计后的真实未覆盖序列，不调用产品 planner。
export function requireMixedProtection(retained, keys, ownerId) {
  const currentAuthor = retained.findLastIndex((row) => row.role === "user" &&
    row.provenance === "author" && row.canonical_ref?.run_id === ownerId);
  assert(currentAuthor >= 0, "admission_current_author_missing");
  const results = retained.flatMap((row,index) => (row.blocks ?? [])
    .filter((block) => ["observation","validation_result"].includes(block.type))
    .map((block) => ({row,index,block})));
  const groups = retained.flatMap((row,index) => {
    const calls = (row.blocks ?? []).filter((block) => block.type === "tool_call").map((block) => block.call_id);
    const closed = calls.every((id) => {
      const matches = results.filter((result) => result.block.call_id === id);
      return nonBlank(id) && matches.length === 1 && matches[0].row.role === "tool" &&
        matches[0].index > index && matches[0].row.canonical_ref?.run_id === row.canonical_ref?.run_id;
    });
    if (calls.length && new Set(calls).size === calls.length && row.role === "assistant" && closed)
      return [{row,index,weight:calls.length}];
    return pureDiscussion(row) ? [{row,index,weight:1}] : [];
  });
  const protectedRows = new Set();
  let count = 0;
  for (const group of [...groups].reverse()) {
    if (count < 4 || group.index >= currentAuthor) protectedRows.add(group.row);
    count += group.weight;
  }
  for (const key of keys) {
    const sources = retained.filter((row) => row.canonical_ref && admissionSourceKey(row.canonical_ref) === key);
    assert(sources.length === 1 && pureDiscussion(sources[0]) && !protectedRows.has(sources[0]) &&
      retained.indexOf(sources[0]) < currentAuthor, "admission_source_protected_or_missing");
  }
}

function admissionTimeline(before, current, first, scope) {
  const exact = (value) => {
    assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)), "admission_message_time_unknown");
    const [prefix, fraction] = value.slice(0,-1).split(".");
    return prefix + "." + fraction.padEnd(6,"0") + "Z";
  };
  const cutoff = exact(first.inserted_at), beforeAt = exact(before.captured_at);
  assert(beforeAt < cutoff, "admission_snapshot_not_before_admission");
  const inScope = (row) => row.work_id === scope.work_id && row.session_id === scope.session_id;
  for (const row of before.authoring_session_messages.filter(inScope))
    assert(exact(row.inserted_at) <= beforeAt, "admission_pre_snapshot_time_conflict");
  const rows = current.authoring_session_messages.filter(inScope).sort((a,b) => a.sequence-b.sequence);
  let previous = null;
  for (const row of rows) {
    const time = exact(row.inserted_at);
    assert(time !== cutoff && (previous === null || previous <= time), "admission_message_time_ambiguous");
    previous = time;
  }
  return rows.filter((row) => exact(row.inserted_at) < cutoff);
}

export function freezeSummaryAdmission(before, current, records, runId, scope, frozen = null) {
  assert(!before.agent_runs.some((run) => run.id === runId), "admission_snapshot_not_before_window");
  const first = firstSummaryAdmission(before, current, runId);
  if (!first) { assert(!frozen, "admission_disappeared"); return null; }
  const owner = current.agent_runs.filter((run) => run.id === runId);
  assert(owner.length === 1 && owner[0].work_id === scope.work_id && owner[0].session_id === scope.session_id,
    "admission_owner_scope_mismatch");
  for (const field of ["workspace_id","work_id","session_id","parent_turn_ref"])
    assert(nonBlank(first[field]) && first[field] === owner[0][field], "admission_scope_mismatch");
  const refs = parseJson(first.owner_refs), capsule = parseJson(first.operation_checkpoint);
  assert(first.purpose === "other" && nonBlank(first.provider_call_ref) &&
    refs.agent_run_id === runId && refs.parent_turn_ref === first.parent_turn_ref &&
    ["workspace_id","work_id","session_id"].every((field) => refs[field] === first[field]),
  "admission_identity_mismatch");
  const keys = refs.discussion_source_keys;
  assert(Array.isArray(keys) && keys.length > 0 && keys.length <= 4 && new Set(keys).size === keys.length,
    "admission_sources_invalid");
  assert(capsule?.version === "provider-operation-checkpoint/v2" &&
    capsule.discussion_protocol_version === "authoring-discussion-summary/v2" &&
    capsule.goal_version === owner[0].goal_version && isObject(capsule.plan), "admission_capsule_invalid");
  const state = {provider_run_ref:first.id, provider_call_ref:first.provider_call_ref,
    source_keys:keys, owner_refs:refs, plan:capsule.plan, goal_version:capsule.goal_version};
  if (frozen) assert.deepEqual(state, frozen, "admission_frozen_identity_or_plan_changed");
  const priorMessages = transcriptMessages(before.authoring_session_messages, before.agent_runs);
  const rowsAtAdmission = admissionTimeline(before, current, first, scope);
  const messages = transcriptMessages(rowsAtAdmission, current.agent_runs);
  assertHistoryPreserved(before, current);
  const audit = auditCanonicalCoverage(messages, {verifyExecutions:true, verifyRequests:true,
    providerRuns:current.provider_runs, providerOutputs:current.provider_outputs, providerRecords:records});
  assert(audit.ok, audit.reason);
  let previous = -1;
  for (const key of keys) {
    assert(nonBlank(key), "admission_source_key_invalid");
    const source = priorMessages.filter((row) => row.canonical_ref && admissionSourceKey(row.canonical_ref) === key);
    assert(source.length === 1 && pureDiscussion(source[0]) &&
      source[0].canonical_ref.run_status === "completed" &&
      ["workspace_id","work_id","session_id"].every((field) => source[0].canonical_ref[field] === first[field]),
    "admission_source_not_preexisting_completed");
    const position = messages.findIndex((row) => admissionSourceKey(row.canonical_ref) === key);
    assert(position > previous, "admission_sources_out_of_order"); previous = position;
    assert.deepEqual(messages[position], source[0], "admission_source_changed");
    for (const run of [...before.provider_runs, ...current.provider_runs.filter((run) => run.id !== first.id)]) {
      const old = parseJson(run.owner_refs);
      assert(isObject(old), "admission_prior_ownership_unknown");
      if (old.operation === "transcript_compaction") {
        assert(Array.isArray(old.discussion_source_keys), "admission_prior_sources_unknown");
        assert(!old.discussion_source_keys.includes(key), "admission_source_already_owned");
      }
    }
  }
  requireMixedProtection(audit.retainedMessages, keys, runId);
  const planRefs = capsule.plan.covers?.message_refs;
  assert(Array.isArray(planRefs) && Array.isArray(capsule.plan.covers?.call_ids), "admission_plan_covers_invalid");
  const seen = new Set();
  for (const ref of planRefs) {
    const key = admissionSourceKey({...first,run_id:ref.run_id,run_sequence:ref.run_sequence});
    assert(!seen.has(key), "admission_plan_source_duplicate"); seen.add(key);
    const rows = audit.retainedMessages.filter((row) => admissionSourceKey(row.canonical_ref) === key);
    assert(rows.length === 1 && ["assistant","scope_update"].includes(ref.role), "admission_plan_source_missing");
    const row = rows[0];
    assert.deepEqual(ref, {run_id:row.canonical_ref.run_id,run_sequence:row.canonical_ref.run_sequence,
      role:row.role,source_refs:row.source_refs ?? [],versions:row.versions ?? {}}, "admission_plan_source_changed");
    assert(row.canonical_ref.run_id !== runId && row.canonical_ref.run_status === "completed",
      "admission_plan_source_current_or_active");
  }
  const planned = capsule.plan.covers?.message_refs?.filter((ref) => ref.role === "assistant");
  assert(Array.isArray(planned), "admission_plan_sources_missing");
  assert.deepEqual(planned.map((ref) => admissionSourceKey({...first,run_id:ref.run_id,run_sequence:ref.run_sequence})),
    keys, "admission_plan_sources_mismatch");
  return structuredClone(state);
}

// checkpoint canonical 形状只有 {blocks: [{type: "checkpoint", covers: {call_ids}}]}。
// 旧形状不再兜底：否则把任意字段里的 ID 当成 cover 证据（C6 假阳性）。
function checkpointCallIds(message) {
  const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
  const callIds = [];
  for (const block of blocks) {
    if (String(block?.type ?? "") !== "checkpoint") continue;
    for (const callId of list(block?.covers?.call_ids)) {
      if (nonBlank(callId)) callIds.push(String(callId));
    }
  }
  return [...new Set(callIds)];
}

function checkpointEvents(events) {
  return list(events).filter((event) => String(event?.event_type ?? "") === AUTO_MAINTENANCE_STOP_EVENT);
}

function eventAts(events) {
  return list(events)
    .map((event) => String(event?.inserted_at ?? event?.at ?? ""))
    .filter(Boolean)
    .sort();
}

const timeValue = (value) => {
  const parsed = Date.parse(String(value ?? "").replace(" ", "T").replace(/(\.\d{3})\d+/u, "$1"));
  return Number.isFinite(parsed) ? parsed : null;
};

function inputTokensOf(record) {
  const usage = record?.response?.usage ?? record?.usage ?? null;
  return Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0);
}

function countLlmCalls(dir) {
  const logDir = path.join(dir, "llm-calls");
  if (!fs.existsSync(logDir)) return 0;
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .reduce(
      (total, file) =>
        total + fs.readFileSync(path.join(logDir, file), "utf8").split("\n").filter((line) => line.includes("{")).length,
      0,
    );
}

export function runtimeAfterBatch(dir, { exec } = {}) {
  const ready = JSON.parse(fs.readFileSync(path.join(dir, "native-driver-ready.json"), "utf8"));
  const executable = nativeExecutablePath(path.resolve(dir), ready);
  assert.equal(path.resolve(ready.app_path), path.dirname(path.dirname(path.dirname(executable))), "owned app path mismatch");
  assert(isObject(ready.owned_ports) && Object.hasOwn(ready.owned_ports, "backend") &&
    Object.hasOwn(ready.owned_ports, "transport"), "owned_ports missing");
  const ports = Object.fromEntries(Object.keys(ready.owned_ports).map((key) => {
    const port = ready.owned_ports[key];
    assert(port === null || Number.isInteger(port) && port > 0 && port <= 65535, "owned port invalid");
    return [key, port === null ? false : portListening(port, exec)];
  }));
  const observation = ownProcesses(executable, { exec });
  return { executable, app_processes: observation.processes.length, process_observation: observation,
    owned_ports: ready.owned_ports, ports, llm_calls: countLlmCalls(dir) };
}

function readLogs(logDir) {
  if (!fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) =>
      fs.readFileSync(path.join(logDir, file), "utf8")
        .split("\n")
        .filter((line) => line.includes("{"))
        .map((line) => {
          try {
            return JSON.parse(line.slice(line.indexOf("{")));
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
}

// 独立验证交错续行。原 C1–C11 仍用于普通批次，末尾 A 的整理也不冒充有后续请求。
export function verifyInterleavedResume(dir) {
  const trace = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"))?.interleaved_resume;
  const config = readConfig(dir);
  const inputs = readAutoMaintenanceInputs(dir, config);
  return verifyInterleavedResumeFacts(trace, readAutoMaintenanceDbFacts(dir), transport(dir), readLogs(path.join(dir, "llm-calls")), {
    provider: config.provider,
    waitingSnapshot: readMaintenanceSnapshot(dir, trace?.waiting_snapshot),
    beforeAnswerSnapshot: readMaintenanceSnapshot(dir, trace?.before_answer_snapshot),
    warmupAuthors: inputs.discussions.slice(0, 10), controls: inputs.controls,
  });
}

function readMaintenanceSnapshot(dir, name) {
  assert(typeof name === "string" && path.basename(name) === name && name.endsWith(".json"), "缺本批精确 snapshot 文件名");
  const snapshot = readJsonIfExists(path.join(dir, name));
  assert(snapshot, "snapshot 不存在");
  return snapshot;
}

export function readAutoMaintenanceRecoveryFacts(dir, config, injection) {
  if (!injection) return null;
  try {
    const inputs = readAutoMaintenanceInputs(dir, config);
    return { before: readMaintenanceSnapshot(dir, injection.before_snapshot),
      afterFailure: readMaintenanceSnapshot(dir, injection.after_failure_snapshot),
      beforeRestart: readMaintenanceSnapshot(dir, injection.before_restart_snapshot),
      afterRestart: readMaintenanceSnapshot(dir, injection.after_restart_snapshot),
      afterRecovery: readMaintenanceSnapshot(dir, injection.after_recovery_snapshot),
      admissionRequired: true,
      failureInput: inputs.discussions[11], recoveryInputs: inputs.discussions.slice(12, 20),
      scope: { work_id: config.target.work_id, session_id: config.target.session_id } };
  } catch (error) { return { error: error.message }; }
}

// 故障与恢复只消费真实快照/调用材料；摘要和 driver 报告均不能重新定义作者目标。
function exactMaintenanceRequest(db, canonical, request, expected) {
  const textOf = (row) => row.blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
  assert(request?.settled === true && nonBlank(request.run_id) && expected, "recovery_request_unsettled");
  const runs = db.agent_runs.filter((run) => run.id === request.run_id);
  assert(runs.length === 1 && runs[0].status === "completed", "recovery_run_not_completed");
  const rows = canonical.filter((row) => row.run_id === request.run_id && row.role === "user" && row.provenance === "author");
  assert.deepEqual(rows.map(textOf), [expected.text], "recovery_author_original_mismatch");
  if (expected.id !== undefined) assert.equal(request.author_id, expected.id);
  if (expected.sha256 !== undefined) assert.equal(request.author_sha256, expected.sha256);
  assert.equal(request.text, expected.text);
  return runs[0];
}

// 重启前和完整恢复 oracle 共用同一故障接收/回滚责任；不依赖未来恢复成功。
export function verifyMaintenanceFailureFacts(injection, records, appLog, facts) {
  const detail = { failure_request_run_id: injection?.failure_request?.run_id ?? null };
  try {
    assert(facts?.before && facts?.afterFailure, "failure_snapshots_missing");
    const {before, afterFailure, failureInput} = facts;
    const db = afterFailure;
    const canonical = transcriptMessages(db.authoring_session_messages, db.agent_runs);
    assert(timeValue(before.captured_at) !== null &&
      timeValue(afterFailure.captured_at) >= timeValue(before.captured_at), "failure_snapshot_order_invalid");
    assert(injection.trigger_created === true && injection.author_error_visible === false, "failure_not_silent");
    const failedRun = exactMaintenanceRequest(db, canonical, injection.failure_request, failureInput);
    assert(facts.scope && failedRun.work_id === facts.scope.work_id && failedRun.session_id === facts.scope.session_id,
      "recovery_scope_mismatch");
    assert(!before.agent_runs.some((run) => run.id === failedRun.id), "failure_request_reused_old_run");
    if (facts.admissionRequired) {
      const first = freezeSummaryAdmission(before, afterFailure, records, failedRun.id, facts.scope);
      assert(first, "failure_first_admission_missing");
      assert.deepEqual(injection.admission, first, "failure_first_admission_not_frozen");
    }

    const log = appLog.find((entry) => entry.event === "agent_run.auto_maintenance.error" && entry.run_id === failedRun.id);
    detail.failure_log_run_id = log?.run_id ?? null;
    detail.failure_log_reason = log?.reason ?? null;
    assert.equal(log?.reason, ":checkpoint_persistence_failed", "failure_reason_mismatch");
    assert(timeValue(injection.injected_at) !== null && timeValue(injection.removed_at) > timeValue(injection.injected_at),
      "failure_injection_window_missing");
    const checkpointRows = (snapshot) => snapshot.authoring_session_messages.filter((row) => row.role === "checkpoint");
    const beforeEvents = checkpointEvents(before.agent_events), failedEvents = checkpointEvents(afterFailure.agent_events);
    assert.deepEqual(failedEvents, beforeEvents, "failed_checkpoint_event_committed");
    assert.deepEqual(checkpointRows(afterFailure), checkpointRows(before), "failed_checkpoint_message_committed");
    assert.equal(injection.checkpoint_events_before_failure, beforeEvents.length);
    assert.equal(injection.checkpoint_events_after_failure, failedEvents.length);
    assert.equal(injection.checkpoint_messages_before_failure, checkpointRows(before).length);
    assert.equal(injection.checkpoint_messages_after_failure, checkpointRows(afterFailure).length);
    assertHistoryPreserved(before, afterFailure);
    const originalIds = new Set(before.provider_runs.map((run) => run.id));
    const attempts = afterFailure.provider_runs.filter((run) => !originalIds.has(run.id) &&
      run.agent_run_id === failedRun.id && parseJson(run.owner_refs)?.operation === "transcript_compaction");
    assert(attempts.length > 0, "failed_summary_attempt_not_observed");
    const attempted = new Set();
    const failedCanonical = transcriptMessages(afterFailure.authoring_session_messages, afterFailure.agent_runs);
    const pending = new Map();
    for (const run of attempts) {
      const refs = parseJson(run.owner_refs);
      assert(["workspace_id", "work_id", "session_id"].every((key) => run[key] === failedRun[key]) &&
        run.parent_turn_ref === failedRun.parent_turn_ref, "failed_summary_owner_mismatch");
      const outputs = afterFailure.provider_outputs.filter((output) => output.provider_run_id === run.id &&
        output.provider_call_ref === run.provider_call_ref && output.agent_run_id === failedRun.id);
      assert(outputs.length === 1 && outputs[0].status === "ok" &&
        nonBlank(parseJson(outputs[0].content_summary)?.content_sha256), "failed_summary_output_missing");
      const origin = afterFailure.agent_runs.find((item) => item.id === run.agent_run_id);
      pending.set(run.id, verifyPendingSummary(run, outputs[0], origin));
      assert(afterFailure.provider_events.some((event) => event.provider_run_id === run.id &&
        event.provider_call_ref === run.provider_call_ref && event.event_type === "started" &&
        timeValue(event.emitted_at) >= timeValue(injection.injected_at) &&
        timeValue(event.emitted_at) <= timeValue(injection.removed_at)), "failed_summary_dispatch_not_in_window");
      assert(run.status === "completed" && run.purpose === "other" && nonBlank(refs.coverage_key) &&
        Array.isArray(refs.discussion_source_keys) && refs.discussion_source_keys.length > 0 &&
        refs.discussion_source_keys.every(nonBlank), "failed_summary_source_identity_missing");
      refs.discussion_source_keys.forEach((key) => { assert(!attempted.has(key), "source_attempt_repeated"); attempted.add(key); });
      const paired = records.filter((record) => record.provider_run_ref === run.id && record.provider_call_ref === run.provider_call_ref);
      assert.equal(paired.length, 1, "failed_summary_record_missing");
      const request = auditDiscussionRequest(paired[0], run, failedCanonical);
      assert(request.ok, request.reason);
      assert.equal(request.sourceCount, refs.discussion_source_keys.length, "failed_summary_source_count_mismatch");

      const capsule = pending.get(run.id);
      // 仅验证未提交候选，不写 canonical，不把此内存视图当作提交证据。
      const { history_target: _target, ...plan } = capsule.plan;
      const candidate = {role:"checkpoint", provenance:"application", blocks:[{type:"checkpoint", ...plan,
        discussion:{provider_run_ref:run.id, provider_call_ref:run.provider_call_ref,
          response_text:capsule.response_text,
          response_sha256:parseJson(outputs[0].content_summary).content_sha256}}],
        canonical_ref:{run_id:failedRun.id, run_sequence:1 + Math.max(0,...failedCanonical
          .filter(row=>row.run_id===failedRun.id).map(row=>row.canonical_ref.run_sequence)),
          workspace_id:failedRun.workspace_id, work_id:failedRun.work_id, session_id:failedRun.session_id,
          parent_turn_ref:failedRun.parent_turn_ref, run_status:failedRun.status}};
      const planAudit = auditCanonicalCoverage([...failedCanonical,candidate], {
        verifyExecutions:true, verifyRequests:true, providerRuns:afterFailure.provider_runs,
        providerOutputs:afterFailure.provider_outputs, providerRecords:records});
      assert(planAudit.ok, planAudit.reason);

    }

    return {ok:true, reason:null, detail, failedRun, attempts, attempted, pending};
  } catch(error) {return {ok:false, reason:error.message, detail};}
}

export function verifyMaintenanceRecoveryFacts(injection, db, records, appLog, facts) {
  const detail = { failure_request_run_id: injection?.failure_request?.run_id ?? null };
  try {
    assert(facts?.before && facts?.afterFailure && facts?.beforeRestart && facts?.afterRestart && facts?.afterRecovery,
      facts?.error ?? "recovery_snapshots_missing");
    const { before, afterFailure, beforeRestart, afterRestart, afterRecovery, failureInput, recoveryInputs } = facts;
    const times = [before, afterFailure, beforeRestart, afterRestart, afterRecovery].map((snapshot) => timeValue(snapshot.captured_at));
    assert(times.every((time, index) => time !== null && (index === 0 || time >= times[index - 1])), "recovery_snapshot_order_invalid");
    assert(times[3] > times[2], "recovery_restart_window_missing");
    for (const table of ["authoring_session_messages", "agent_events", "provider_runs", "provider_outputs", "provider_events"]) {
      assert.deepEqual(beforeRestart[table], afterFailure[table], "before_restart_changed_" + table);
      assert.deepEqual(afterRestart[table], beforeRestart[table], "restart_changed_" + table);
    }
    const canonical = transcriptMessages(db.authoring_session_messages, db.agent_runs);
    const failure = verifyMaintenanceFailureFacts(injection, records, appLog, facts);
    assert(failure.ok, failure.reason);
    Object.assign(detail, failure.detail);
    const {failedRun, attempts, attempted, pending} = failure;
    exactMaintenanceRequest(db, canonical, injection.failure_request, failureInput);
    const recoveries = injection.recovery_requests;
    assert(Array.isArray(recoveries) && Array.isArray(recoveryInputs) &&
      recoveryInputs.length > 0 && recoveries.length === recoveryInputs.length, "recovery_fixed_input_count_mismatch");
    const recoveryRuns = recoveries.map((request, index) => exactMaintenanceRequest(db, canonical, request, recoveryInputs[index]));
    const ids = new Set(recoveryRuns.map((run) => run.id));
    assert(recoveryRuns.every((run) => !afterFailure.agent_runs.some((prior) => prior.id === run.id)), "recovery_request_not_new");
    assert(ids.size === recoveryRuns.length && !ids.has(failedRun.id), "recovery_run_reused");
    for (const run of recoveryRuns)
      for (const key of ["workspace_id", "work_id", "session_id"]) assert.equal(run[key], failedRun[key]);
    for (const [earlier, later] of [[afterFailure, afterRecovery], [afterRecovery, db]])
      assertHistoryPreserved(earlier, later);
    for (const run of attempts) {
      const refs = parseJson(run.owner_refs);
      const final = db.provider_runs.find((candidate) => candidate.id === run.id);
      assert(final && final.provider_call_ref === run.provider_call_ref && final.status === run.status &&
        JSON.stringify(parseJson(final.owner_refs)) === JSON.stringify(refs), "failed_attempt_not_durable");
    }
    for (const run of db.provider_runs.filter((row) => !attempts.some((attempt) => attempt.id === row.id) &&
      parseJson(row.owner_refs)?.operation === "transcript_compaction"))
      assert(!list(parseJson(run.owner_refs).discussion_source_keys).some((key) => attempted.has(key)), "failed_source_redispatched");
    const audit = auditCanonicalCoverage(canonical, { verifyExecutions: true, verifyRequests: true,
      providerRuns: db.provider_runs, providerOutputs: db.provider_outputs, providerRecords: records });
    assert(audit.ok, audit.reason);
    const recovered = [];
    for (const run of attempts) {
      const capsule = pending.get(run.id);
      for (const snapshot of [beforeRestart, afterRestart, afterRecovery, db]) {
        const origin = snapshot.agent_runs.find((candidate) => candidate.id === run.agent_run_id);
        assert(origin && ["completed", "failed"].includes(origin.status) && origin.goal_version === capsule.goal_version,
          "recovery_origin_direction_changed");
      }
      const matches = audit.checkpoints.filter((item) => canonical[item.checkpoint_index].blocks.some((block) =>
        block.discussion?.provider_run_ref === run.id));
      assert.equal(matches.length, 1, "original_response_not_committed_once");
      const item = matches[0], message = canonical[item.checkpoint_index];
      assert(ids.has(item.canonical_ref.run_id), "recovery_committer_not_followup_run");
      const block = message.blocks.find((block) => block.discussion?.provider_run_ref === run.id);
      assert.equal(block.discussion.provider_call_ref, run.provider_call_ref, "recovered_call_identity_changed");
      assert.equal(block.discussion.response_text, capsule.response_text, "recovered_response_bytes_changed");
      for (const key of ["covers", "source_refs", "versions", "omissions", "summary"])
        assert.deepEqual(block[key], capsule.plan[key], "recovered_plan_changed:" + key);
      for (const snapshot of [afterRecovery, db]) {
        const final = snapshot.provider_runs.filter((candidate) => candidate.id === run.id);
        assert(final.length === 1 && (typeof final[0].operation_checkpoint === "string"
          ? JSON.parse(final[0].operation_checkpoint) : final[0].operation_checkpoint) === null, "recovered_private_payload_not_cleared");
        const row = snapshot.authoring_session_messages.filter((row) => row.run_id === item.canonical_ref.run_id &&
          row.run_sequence === item.canonical_ref.run_sequence && row.role === "checkpoint");
        assert(row.length === 1 && JSON.stringify(parseJson(row[0].message)) === JSON.stringify(parseJson(
          db.authoring_session_messages.find((entry) => entry.run_id === row[0].run_id && entry.run_sequence === row[0].run_sequence).message)),
        "recovery_snapshot_checkpoint_mismatch");
        const commits = audit.checkpoints.filter((entry) => entry.canonical_ref.run_id === item.canonical_ref.run_id);
        const events = checkpointEvents(snapshot.agent_events).filter((event) => event.run_id === item.canonical_ref.run_id)
          .sort((a, b) => a.sequence - b.sequence);
        const position = commits.indexOf(item);
        assert.equal(events.length, commits.length, "recovery_checkpoint_event_cardinality");
        const event = events[position], payload = parseJson(event?.payload);
        assert(event?.visibility === "author", "recovery_checkpoint_event_not_author");
        assert.deepEqual(payload?.covered_counts, item.counts, "recovery_checkpoint_counts_mismatch");
        assert.deepEqual(payload?.history_target, capsule.plan.history_target, "recovery_checkpoint_target_mismatch");
        for (const key of ["retained_items", "scope"])
          assert.deepEqual(payload?.[key] ?? null, capsule.plan[key] ?? null, "recovered_event_plan_changed:" + key);
      }
      recovered.push({ provider_run_ref: run.id, provider_call_ref: run.provider_call_ref,
        response_sha256: block.discussion.response_sha256, committed_run_id: item.canonical_ref.run_id });
    }
    return { ok: true, reason: null, detail: { ...detail, failed_attempt_ids: attempts.map((run) => run.id),
      attempted_source_keys: [...attempted], recovery_run_ids: [...ids], recovered,
      recovery_checkpoint_count: recovered.length, original_response_recovered: true, pending_payload_cleared: true,
      canonical_originals_preserved: true, failed_source_redispatched: false } };
  } catch (error) { return { ok: false, reason: error.message, detail }; }
}

function verifyPendingSummary(run, output, origin) {
  const capsule = parseJson(run.operation_checkpoint);
  assert(["provider-operation-checkpoint/v1", "provider-operation-checkpoint/v2"].includes(capsule?.version) &&
    Number.isInteger(capsule.goal_version) && capsule.goal_version > 0 &&
    nonBlank(capsule.response_text) && isObject(capsule.plan), "pending_original_response_missing");
  assert(origin && ["completed", "failed"].includes(origin.status) && origin.goal_version === capsule.goal_version,
    "pending_original_direction_changed");
  const v2 = capsule.version === "provider-operation-checkpoint/v2";
  assert.deepEqual(Object.keys(capsule).sort(), v2
    ? ["discussion_protocol_version", "goal_version", "plan", "response_text", "version"]
    : ["goal_version", "plan", "response_text", "version"]);
  const protocol = v2 ? "authoring-discussion-summary/v2" : "authoring-discussion-summary/v1";
  if (v2) assert.equal(capsule.discussion_protocol_version, protocol, "pending_protocol_mismatch");
  assert.equal(JSON.parse(capsule.response_text).version, protocol, "pending_response_protocol_mismatch");
  const planKeys = ["covers", "source_refs", "versions", "omissions", "summary", "retained_items", "scope", "history_target"];
  assert(Object.keys(capsule.plan).every((key) => planKeys.includes(key)), "pending_original_plan_unknown_field");
  for (const key of ["covers", "source_refs", "versions", "omissions", "summary"])
    assert(Object.hasOwn(capsule.plan, key), "pending_original_plan_missing:" + key);
  const digest = createHash("sha256").update(capsule.response_text, "utf8").digest("hex");
  assert.equal(digest, parseJson(output.content_summary)?.content_sha256, "pending_original_response_hash_mismatch");
  return capsule;
}

export function verifyBackendRestartFacts(trace, before, after, records, attemptIds) {
  assert(trace?.recovery_scope === "owned_beam_backend_quiescent", "backend_restart_scope_missing");
  assert(Array.isArray(attemptIds) && attemptIds.length > 0, "restart_missing_failed_source_attempts");
  const start = timeValue(before.captured_at), end = timeValue(after.captured_at);
  assert(start !== null && end !== null && end >= start, "restart_snapshot_window_invalid");
  for (const table of ["authoring_session_messages", "agent_events", "provider_runs", "provider_outputs", "provider_events"])
    assert.deepEqual(after[table], before[table], "backend_restart_changed_" + table);
  for (const id of attemptIds) assert(before.provider_runs.some((run) => run.id === id), "restart_source_qualification_missing");
  const countAt = (at) => records.filter((record) => {
    const time = timeValue(record.ts);
    assert(time !== null, "restart_call_timestamp_missing");
    return time <= at;
  }).length;
  const beforeCalls = countAt(start), afterCalls = countAt(end);
  assert.equal(beforeCalls, afterCalls, "backend_restart_dispatched_provider");
  assert.equal(trace.provider_calls_before, beforeCalls);
  assert.equal(trace.provider_calls_after, afterCalls);
  return { ok: true, recovery_scope: trace.recovery_scope, failed_source_qualification_preserved: true,
    canonical_originals_preserved: true, provider_calls_before: beforeCalls, provider_calls_after: afterCalls,
    previous_backend_pid: trace.receipt.previous_backend_pid, backend_pid: trace.receipt.backend_pid,
    database: trace.receipt.database, active_task_recovery_signed: false };
}

// ── 判据 C1–C10 ─────────────────────────────────────────────────────────────
export function evaluateAutoMaintenance({
  config,
  dbFacts,
  checkpoints,
  driverLog = null,
  cleanup = null,
  runtime = null,
  llmRecords = [],
  appLog = [],
  dir = null,
  multiTurn = null,
  failureFacts = null,
}) {
  const db = dbFacts ?? {};
  let transcript = [], canonicalReadError = null;
  try { transcript = transcriptMessages(db.authoring_session_messages, db.agent_runs); }
  catch (error) { canonicalReadError = error.message; }
  const checkpointsMsgs = transcript.filter((message) => String(message?.role ?? "") === "checkpoint");
  const events = checkpointEvents(db.agent_events);
  const eventTimes = eventAts(events);
  const triggerRatio = AUTO_MAINTENANCE_TRIGGER_RATIO;
  const profile = config.runtime?.profile ? getRuntimeProfile(config.runtime.profile) : null;
  const maintenanceWindow = profile?.maintenance_window ?? null;
  const expectedProvider = profile?.provider ?? null;
  const threshold = profile ? Math.ceil(maintenanceWindow * triggerRatio) : null;
  const summaryCallRefs = new Set(list(db.provider_runs).filter((run) => parseJson(run.owner_refs)?.operation === "transcript_compaction")
    .map((run) => run.provider_call_ref));
  const usages = list(llmRecords).filter((record) => !summaryCallRefs.has(record.provider_call_ref))
    .map(inputTokensOf).filter((value) => Number.isFinite(value) && value > 0);
  const maxInputTokens = usages.length > 0 ? Math.max(...usages) : 0;
  const providerIds = [...new Set(list(db.provider_runs).map((run) => String(run?.provider_id ?? "")).filter(Boolean))];
  const autoMaintenanceEnabled = config.runtime?.observed?.auto_maintenance?.enabled === true;
  // 无目录时（纯评估/无文件证据）文件类检查为 unknown，不冒充 pass 或 fail；
  // 真实批次 verify 始终传入目录，不进入本分支。
  const autoVisible = dir
    ? scanAuthorVisibleFiles(dir)
    : { ok: null, hits: [], files: [], reason: null };

  // C1：真实主调用 usage 越线，启动观察与显式维护预算/provider一致。
  const c1 = {
    ok:
      profile !== null && autoMaintenanceEnabled &&
      config.runtime.observed?.context_pressure?.window === maintenanceWindow &&
      config.runtime.observed?.context_pressure?.maintenance_ratio === triggerRatio &&
      providerIds.includes(expectedProvider) &&
      maxInputTokens >= threshold,
    reason: null,
    detail: {
      auto_maintenance_enabled: autoMaintenanceEnabled,
      provider_ids: providerIds,
      max_input_tokens: maxInputTokens,
      threshold,
      window: maintenanceWindow,
      maintenance_ratio: triggerRatio,
      provider: expectedProvider,
    },
  };
  if (!c1.ok) c1.reason = "real_pressure_not_established";

  // C2：自动整理发生（checkpoint_created 事件 + role=checkpoint 消息，同边界）。
  const eventPayloadOk = events.length === checkpointsMsgs.length &&
    new Set(events.map((event) => JSON.stringify([event.run_id, event.sequence]))).size === events.length &&
    events.every((event) => {
      const siblings = events.filter((row) => row.run_id === event.run_id).sort((a, b) => a.sequence - b.sequence);
      const messages = checkpointsMsgs.filter((row) => row.run_id === event.run_id).sort((a, b) => a.sequence - b.sequence);
      const checkpoint = messages[siblings.indexOf(event)];
      const counts = parseJson(event.payload)?.covered_counts;
      if (!checkpoint || !isObject(counts) || !Array.isArray(checkpoint.blocks) || !checkpoint.blocks.length ||
        checkpoint.blocks.some((block) => block.type !== "checkpoint" ||
          !Array.isArray(block.covers?.call_ids) || !Array.isArray(block.covers?.message_refs))) return false;
      const expected = checkpoint.blocks.reduce((sum, block) => ({
        tool_exchanges: sum.tool_exchanges + block.covers.call_ids.length,
        scope_updates: sum.scope_updates + block.covers.message_refs.filter((ref) => ref.role === "scope_update").length,
        discussion_messages: sum.discussion_messages + block.covers.message_refs.filter((ref) => ref.role === "assistant").length,
      }), { tool_exchanges: 0, scope_updates: 0, discussion_messages: 0 });
      try { assert.deepEqual(counts, expected); return true; } catch { return false; }
    });
  const c2 = {
    ok: events.length >= 1 && checkpointsMsgs.length >= 1 && eventPayloadOk,
    reason: null,
    detail: {
      checkpoint_events: events.length,
      checkpoint_messages: checkpointsMsgs.length,
      event_times: eventTimes.slice(-3),
      visibility: list(events).map((event) => String(event?.visibility ?? "")).slice(-3),
    },
  };
  if (!c2.ok) c2.reason = "auto_maintenance_not_observed";

  // C3：行内细条可见（旧作者文案「较早的 N 项创作过程已整理」，或现行 AX 细条按钮）。
  const maintenanceAx = dir ? readCaptureText(dir, "after-maintenance") : null;
  // 现行 UI 的细条 accessible name 是「查看已整理的较早创作过程」；只认 AXButton 角色、
  // 精确名称且 enabled=true——同名静态文本/纯文本/disabled 控件都不是可见条。
  const stripText =
    /较早的\s*\d+\s*项创作过程已整理|创作过程已整理|^[\t ]*(?:[^\s,]+[\t ]+)?AXButton,[ \t]+查看已整理的较早创作过程,[ \t]+enabled=true(?:,|$)/mu;
  const c3 = {
    ok: dir ? stripText.test(maintenanceAx) : null,
    reason: null,
    detail: {
      matched: maintenanceAx ? ((maintenanceAx.match(stripText) ?? [])[0] ?? null) : null,
      capture: "after-maintenance",
    },
  };
  if (c3.ok === false) c3.reason = "maintenance_strip_not_visible";

  // C4：展开面板四要素（原因/原文保留/来源/完整记录入口）。
  const expandedAx = dir ? readCaptureText(dir, "after-expanded") : null;
  const factors = {
    heading: /已整理的较早记录/u.test(expandedAx),
    reason: /为了保持这次创作始终清晰连贯/u.test(expandedAx),
    original_kept: /原始记录仍然保留/u.test(expandedAx),
    full_record_entry: /查看完整记录/u.test(expandedAx),
    sources: /涉及：/u.test(expandedAx),
  };
  const c4 = {
    ok: dir ? factors.heading && factors.reason && factors.original_kept && factors.full_record_entry : null,
    reason: null,
    detail: factors,
  };
  if (c4.ok === false) c4.reason = "expanded_panel_factors_missing";

  // C5：同 session checkpoint 后第一条 started 事件定位 ProviderRun；prun+pcall
  // 同时唯一配对日志。缺证 unknown，后续第 2 请求不能补位。
  const coveredCallIds = [...new Set(checkpointsMsgs.flatMap((checkpoint) => checkpointCallIds(checkpoint)))];
  const providerRunsById = new Map(list(db.provider_runs).map((run) => [String(run.id), run]));
  const c5Checks = list(events)
    .map((event) => {
    const eventRows = list(events).filter((row) => row.run_id === event.run_id).sort((a, b) => a.sequence - b.sequence);
    const checkpointRows = checkpointsMsgs.filter((row) => row.run_id === event.run_id).sort((a, b) => a.sequence - b.sequence);
    if (eventRows.length !== checkpointRows.length || new Set(eventRows.map((row) => row.sequence)).size !== eventRows.length)
      return { ok: null, reason: "checkpoint_binding_unknown" };
    const checkpoint = checkpointRows[eventRows.indexOf(event)];
    if (!checkpoint) return { ok: null, reason: "checkpoint_binding_unknown" };
    const canonicalAudit = auditCanonicalCoverage(transcript.filter((row) => row.session_id === checkpoint.session_id && row.sequence <= checkpoint.sequence), {
      verifyExecutions: true, verifyRequests: true, providerRuns: list(db.provider_runs),
      providerOutputs: list(db.provider_outputs), providerRecords: llmRecords,
    });
    if (!canonicalAudit.ok) return { ok: false, reason: canonicalAudit.reason };
    const eventAt = timeValue(event.inserted_at);
    if (eventAt === null) return { ok: null, reason: "next_request_evidence_missing" };
    const started = list(db.provider_events)
      .filter((row) => row.event_type === "started" && timeValue(row.emitted_at) > eventAt &&
        providerRunsById.get(String(row.provider_run_id))?.session_id === checkpoint.session_id &&
        parseJson(providerRunsById.get(String(row.provider_run_id))?.owner_refs)?.operation !== "transcript_compaction")
      .sort((left, right) => timeValue(left.emitted_at) - timeValue(right.emitted_at));
    const firstAt = started.length ? timeValue(started[0].emitted_at) : null;
    const first = started.filter((row) => timeValue(row.emitted_at) === firstAt);
    const run = first.length === 1 ? providerRunsById.get(String(first[0].provider_run_id)) : null;
    const records = run
      ? list(llmRecords).filter((record) => record.provider_run_ref === run.id && record.provider_call_ref === run.provider_call_ref)
      : [];
    const facts = records.length === 1 ? requestFactsFromRecord(records[0]) : null;
    const covered = checkpointCallIds(checkpoint);
    const canonicalCovers = checkpoint.blocks.filter((block) => block.type === "checkpoint").map((block) => block.covers);
    const messageRefs = canonicalCovers.flatMap((covers) => covers.message_refs);
    const wireSelections = facts?.ok && facts.format === NATIVE_CHAT_WIRE ? wireCheckpoints(facts) : [];
    const wireCovers = wireSelections.map((entry) => entry.call_ids);
    const replayed = covered.filter((id) =>
      list(facts?.toolCalls).some((call) => String(call.callId) === id) ||
      list(facts?.toolResults).some((result) => [result.callId, result.toolCallId].some((ref) => String(ref) === id)));
    const malformedCalls = Number(facts?.malformedCalls ?? 0);
    const malformedToolMessages = Number(facts?.malformedToolMessages ?? 0);
    const detail = {
      session_id: checkpoint.session_id,
      provider_run_id: run?.id ?? null,
      provider_call_ref: run?.provider_call_ref ?? null,
      started_event_at: first[0]?.emitted_at ?? null,
      covered_call_ids: covered,
      covered_message_refs: messageRefs,
      wire_checkpoint_covers: wireCovers,
      replayed_call_ids: replayed,
      malformed_calls: malformedCalls,
      malformed_tool_messages: malformedToolMessages,
    };
    const evidence = first.length === 1 && records.length === 1 && facts?.ok && facts.format === NATIVE_CHAT_WIRE && covered.length + messageRefs.length > 0;
    if (!evidence) return { ok: null, reason: "next_request_evidence_missing", detail };
    if (malformedCalls > 0 || malformedToolMessages > 0) return { ok: false, reason: "next_request_wire_malformed", detail };
    const sameSelection = (left, right) => { try { assert.deepEqual(left, right); return true; } catch { return false; } };
    if (!canonicalCovers.every((covers) => wireSelections.some((selection) => sameSelection(selection, covers))))
      return { ok: false, reason: "checkpoint_cover_mismatch", detail };
    if (messageRefs.length > 0) {
      const history = { messages: transcript.filter((row) => row.session_id === checkpoint.session_id) };
      const next = canonicalCoverageForProviderCall(records[0], history);
      if (!next?.ok) return { ok: null, reason: "next_request_canonical_prefix_missing", detail };
      const expectedAuthors = next.retainedMessages.filter((row) => row.role === "user" && row.provenance === "author")
        .map((row) => row.blocks.map((block) => block.text ?? "").join(""));
      if (!sameSelection(facts.authorMessages.map((message) => message.text), expectedAuthors))
        return { ok: false, reason: "author_original_bytes_not_retained", detail };
      if (next.retainedMessages.some((row) => row.role === "scope_update") && !scopeForProviderCall(records[0], history))
        return { ok: false, reason: "scope_projection_does_not_match_valid_coverage", detail };
      const retainedDiscussions = next.retainedMessages.filter((row) => row.role === "assistant" && row.provenance === "model" &&
        row.blocks.length > 0 && row.blocks.every((block) => block.type === "text")).map((row) => row.blocks.map((block) => block.text).join(""));
      const nativeDiscussions = facts.messages.filter((message) => message.role === "assistant" && !message.tool_calls?.length)
        .map((message) => message.content);
      for (const ref of messageRefs.filter((ref) => ref.role === "assistant")) {
        const source = history.messages.find((row) => row.canonical_ref.run_id === ref.run_id && row.canonical_ref.run_sequence === ref.run_sequence);
        const text = source.blocks.map((block) => block.text).join("");
        const expected = next.retainedMessages.filter((row) => row.role === "assistant" && row.blocks.every((block) => block.type === "text") &&
          row.blocks.map((block) => block.text).join("") === text).length;
        const actual = facts.messages.filter((message) => message.role === "assistant" && !message.tool_calls?.length && message.content === text).length;
        if (actual !== expected) return { ok: false, reason: "covered_discussion_still_in_next_request", detail };
      }
      if (!sameSelection(nativeDiscussions, retainedDiscussions))
        return { ok: false, reason: "retained_discussion_bytes_not_preserved", detail };
    }
    if (replayed.length > 0) return { ok: false, reason: "covered_call_ids_still_in_next_request", detail };
    return { ok: true, reason: null, detail };
  });
  const c5Detail = c5Checks.map((check) => ({ ok: check.ok, reason: check.reason, ...check.detail }));
  const c5Failed = c5Checks.find((check) => check.ok === false);
  const c5 =
    c5Failed
      ? { ok: false, reason: c5Failed.reason, detail: { covered_call_ids: coveredCallIds, checks: c5Detail } }
      : c5Checks.length > 0 && c5Checks.every((check) => check.ok === true)
        ? { ok: true, reason: null, detail: { covered_call_ids: coveredCallIds, checks: c5Detail } }
        : { ok: null, reason: c5Checks.find((check) => check.ok === null)?.reason ?? "next_request_evidence_missing", detail: { covered_call_ids: coveredCallIds, checks: c5Detail } };


  // C6：三个覆盖类别使用同一独立 canonical oracle；任一非法选择器不得用其它合法项掩盖。
  const coverageAudits = [...new Set(transcript.map((message) => message.session_id))].map((sessionId) => ({
    session_id: sessionId,
    ...auditCanonicalCoverage(transcript.filter((message) => message.session_id === sessionId), {
      verifyExecutions: true, verifyRequests: true, providerRuns: list(db.provider_runs),
      providerOutputs: list(db.provider_outputs), providerRecords: llmRecords,
    }),
  }));
  const coverageFailures = coverageAudits.filter((audit) => !audit.ok);
  const c6 = {
    ok: canonicalReadError === null && coverageFailures.length === 0 && checkpointsMsgs.length > 0,
    reason: canonicalReadError ?? coverageFailures[0]?.reason ?? (checkpointsMsgs.length ? null : "checkpoint_selection_missing"),
    detail: { covered_call_ids: coveredCallIds, audits: coverageAudits.map(({ retainedMessages, ...audit }) => audit) },
  };

  // C7：刷新幂等（刷新后细条仍在、checkpoint 事件与 canonical 消息计数均不变）。
  // direct A3 与正式 live multi-turn 都必须产出该证据；缺证即失败，不按场景豁免。
  // C7/C8 共用：计数必须是非负整数，null/字符串/NaN 都不能当 0 或强转通过。
  const sameNonNegativeCount = (left, right) =>
    Number.isInteger(left) && left >= 0 &&
    Number.isInteger(right) && right >= 0 && left === right;
  const refreshAx = dir ? readCaptureText(dir, "after-refresh") : null;
  const refresh = driverLog?.refresh ?? null;
  const c7 = {
    ok: dir
      ? stripText.test(refreshAx) &&
        isObject(refresh) &&
        sameNonNegativeCount(refresh.before_checkpoint_events, refresh.after_checkpoint_events) &&
        sameNonNegativeCount(refresh.before_checkpoint_messages, refresh.after_checkpoint_messages)
      : null,
    reason: null,
    detail: {
      strip_visible_after_refresh: stripText.test(refreshAx),
      before_checkpoint_events: refresh?.before_checkpoint_events ?? null,
      after_checkpoint_events: refresh?.after_checkpoint_events ?? null,
      before_checkpoint_messages: refresh?.before_checkpoint_messages ?? null,
      after_checkpoint_messages: refresh?.after_checkpoint_messages ?? null,
    },
  };
  if (c7.ok === false) c7.reason = "refresh_not_idempotent";

  const c8 = verifyMaintenanceRecoveryFacts(driverLog?.failure_injection, db, llmRecords, appLog, failureFacts);

  // C9：全类别无技术词（扫描目录全部 ax/text 证据）。
  const c9 = {
    ok: autoVisible.ok,
    reason: autoVisible.ok === false ? "author_visible_internal_token_leak" : null,
    detail: autoVisible,
  };

  // C10 只核本批 owned app/端口/日志；外部 Splash 服务不进入本批清理所有权。
  const remaining = cleanup?.remaining;
  const terminationLlm = driverLog?.termination?.llm_calls;
  const llmStopped = Number.isInteger(terminationLlm) && terminationLlm >= 0 &&
    runtime?.llm_calls === terminationLlm;
  const c10 = {
    ok: runtime === null ? null : Array.isArray(remaining) && remaining.length === 0 &&
      cleanup.executable === runtime.executable && runtime.app_processes === 0 &&
      runtime.ports?.backend === false && runtime.ports?.transport === false &&
      isObject(runtime.owned_ports) && isObject(runtime.ports) &&
      Object.keys(runtime.owned_ports).length === Object.keys(runtime.ports).length &&
      Object.keys(runtime.owned_ports).every(key => runtime.ports[key] === false) && llmStopped,
    reason: null,
    detail: { remaining: Array.isArray(remaining) ? remaining.length : null,
      runtime_after_batch: runtime, llm_calls_stopped: llmStopped, external_model_service_in_scope: false },
  };
  if (c10.ok === false) c10.reason = "cleanup_unverified_or_runtime_not_stopped";


  const multiTurnSteers = list(multiTurn?.steers);
  const multiTurnResumes = list(multiTurn?.resumes);
  const multiTurnPause = multiTurn?.pause ?? null;
  const extraRounds = list(multiTurn?.extra_rounds);
  // 观察驱动多轮（2026-11-08 审核）：每轮回答必须来自真实问题文本的观察，
  // 且至少一轮回答来源是选项/对象词提取（fallback 单独凑轮不算观察驱动）。
  // 观察驱动证据：问题文本 或 真实选项标题（选项文字本身来自页面观察——真实 strata
  // 批次里问题文本节点有时读不到，但选项标题可读，且 answer_source=option 已记录来源）。
  const hasObservation = (steer) => {
    const observation = steer?.observation ?? null;
    return (
      String(observation?.question_text ?? "").trim() !== "" ||
      list(observation?.option_titles).length > 0
    );
  };
  const observationRounds = multiTurnSteers.filter((steer) => {
    const source = String(steer?.observation?.answer_source ?? "");
    return hasObservation(steer) && ["option", "extracted_text"].includes(source);
  });
  const questionBoundRounds = multiTurnSteers.filter(hasObservation);
  // G6 实模场景是「跨 turn」：首 run 询问回答后 driver 补发新 turn（extra_rounds），
  // 压缩发生在后续 turn 的安全点。A3 原始 C11「同 run 多轮」判据在该场景不成立——
  // 按场景区分判据（不放宽任何不变量）：跨 turn 仍要求观察驱动回答 + 补发 turn 真实推进；
  // 若存在 checkpoint 则 C2 另行判定（不在此处放宽）。
  const crossTurnScenario = extraRounds.length > 0;
  const crossTurnOk =
    crossTurnScenario &&
    multiTurnSteers.length >= 1 &&
    multiTurnSteers.every((steer) => steer?.ok === true) &&
    questionBoundRounds.length === multiTurnSteers.length &&
    observationRounds.length >= 1 &&
    extraRounds.filter((round) => ["completed", "failed"].includes(String(round?.run_status ?? ""))).length >= 1;

  const c11 = multiTurn
    ? {
        ok: crossTurnScenario
          ? crossTurnOk
          : multiTurnPause?.kind === "paused" &&
          multiTurnSteers.length >= 1 &&
          multiTurnSteers.every((steer) => steer?.ok === true) &&
          multiTurnResumes.length >= multiTurnSteers.length &&
          multiTurnResumes.every((resume) => resume?.resumed === true) &&
          questionBoundRounds.length === multiTurnSteers.length &&
          observationRounds.length >= 1,
        reason: null,
        detail: {
          pause: multiTurnPause,
          steers: multiTurnSteers.length,
          resumes: multiTurnResumes.length,
          rounds: list(multiTurn?.rounds).length,
          stop_reason: multiTurn?.stop_reason ?? null,
          max_steers: multiTurn?.max_steers ?? null,
          checkpoint_events: multiTurn?.checkpoint_events ?? null,
          observation_driven_rounds: observationRounds.length,
          question_bound_rounds: questionBoundRounds.length,
          answer_sources: multiTurnSteers.map((steer) => steer?.observation?.answer_source ?? null),
          scenario: crossTurnScenario ? "cross_turn" : "same_run",
          extra_rounds: extraRounds.length,
          questions: multiTurnSteers.map((steer) => steer?.observation?.question_text ?? null),
        },
      }
    : { ok: null, reason: "not_multi_turn_scenario", detail: {} };
  if (c11.ok === false) {
    c11.reason =
      questionBoundRounds.length !== multiTurnSteers.length || observationRounds.length < 1
        ? "multi_turn_not_observation_driven"
        : "multi_turn_same_run_not_established";
  }

  const checks = {
    C1_real_pressure: c1,
    C2_auto_maintenance_committed: c2,
    C3_strip_visible: c3,
    C4_expanded_factors: c4,
    C5_next_request_compact: c5,
    C6_canonical_complete: c6,
    C7_refresh_idempotent: c7,
    C8_failure_silent: c8,
    C9_author_visible_no_internal_tokens: c9,
    C10_cleanup: c10,
    C11_multi_turn_same_run: c11,
  };
  const required = Object.entries(checks)
    .filter(([key, value]) => value.ok !== null || EVIDENCE_REQUIRED_CHECKS.has(key))
    .map(([key]) => key);
  const failed = Object.entries(checks)
    .filter(([key, value]) => value.ok === false || (value.ok === null && EVIDENCE_REQUIRED_CHECKS.has(key)))
    .map(([key]) => key);
  return {
    schema: AUTO_MAINTENANCE_SCHEMA,
    case: "auto-maintenance-a3",
    checks,
    required,
    failed,
    measured: {
      checkpoint_events: events.length,
      checkpoint_messages: checkpointsMsgs.length,
      covered_call_ids: coveredCallIds.length,
      max_input_tokens: maxInputTokens,
      threshold,
      provider_ids: providerIds,
      requests_attempted: list(driverLog?.requests).length,
      triggered: events.length > 0,
    },
    model_behavior: {
      run_statuses: [...new Set(transcript.filter((message) => message?.role === "assistant").map((message) => message?.run_id ?? null))].length,
      provider_calls: usages.length,
      note: "安全点自动维护的真实触发/失败由 DB 事件与 app-log 事实判定；不代签 I10/完整 G1–G6。",
    },
    not_signed: [
      "I10_literary_quality_not_signed",
      "G1_G6_full_signed=false",
      "threshold_tuning_not_signed",
    ],
  };
}

function readCaptureText(dir, name) {
  if (!dir) return "";
  const ax = path.join(dir, `${name}.ax.txt`);
  const text = path.join(dir, `${name}.text.txt`);
  return [fs.existsSync(ax) ? fs.readFileSync(ax, "utf8") : "", fs.existsSync(text) ? fs.readFileSync(text, "utf8") : ""].join("\n");
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

// runner 在后台运行、以 ui-complete 作为驱动完成信号；driver finally 的证据写入与
// verify 之间存在毫秒级时序竞争。verify 侧对有界等待，缺失仍如实断言（不伪造）。
export function waitForEvidenceFile(dir, name, timeoutMs = 20_000) {
  const file = path.join(dir, name);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  return fs.existsSync(file);
}

export function verifyAutoMaintenanceBatch(dir, { observeRuntime = runtimeAfterBatch } = {}) {
  const config = readConfig(dir);
  assert.equal(config.journey, "auto-maintenance", "auto-maintenance verifier 只接受 journey=auto-maintenance");
  assert(config.runtime?.profile, "auto-maintenance缺显式runtime profile");
  const profile = getRuntimeProfile(config.runtime.profile);
  assert.equal(config.provider, profile.provider, "auto-maintenance provider与显式runtime profile不符");
  assertRuntimeFacts(config.runtime.observed, profile.id);
  const driverLogForMode = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  const multiTurn = driverLogForMode?.multi_turn ?? null;
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: 3,
    minimumWaits: 6,
    requiredKinds: ["input", "ack", "turn", "maintenance"],
  });
  const evidence = assertProviderAndWire(dir, {
    // G6-multi-turn 同 run steer 不产生额外的 user_message 帧；同 run 多回合由
    // C11 基于 driver 的 pause/steer/resume 事实判定，wire 只要求首轮输入与最终
    // turn_result（至少各 1 次真实帧），不把判据放宽到无事件。
    minUserMessages: multiTurn ? 1 : 2,
    minTurnResults: multiTurn ? 1 : 2,
    minProviderStarts: 1,
    expectProviders: [profile.provider],
  });
  assert(
    waitForEvidenceFile(dir, "native-app-cleanup.json"),
    "缺少本批 native-app-cleanup.json（已等待 finally 落盘）",
  );
  const checkpoints = Object.fromEntries(
    AUTO_MAINTENANCE_CHECKPOINTS.map((name) => [name, readJsonIfExists(path.join(dir, `b71-${name}.json`))]),
  );
  for (const name of ["start", "final"]) {
    assert(checkpoints[name], `缺少 checkpoint b71-${name}.json（canon 快照）`);
  }
  const dbFacts = readAutoMaintenanceDbFacts(dir);
  const driverLog = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  const cleanup = readJsonIfExists(path.join(dir, "native-app-cleanup.json"));
  const llmRecords = readLogs(path.join(dir, "llm-calls"));
  const appLog = readLogs(path.join(dir, "app-log"));
  const result = evaluateAutoMaintenance({
    config,
    dbFacts,
    checkpoints,
    driverLog,
    cleanup,
    runtime: observeRuntime(dir),
    failureFacts: readAutoMaintenanceRecoveryFacts(dir, config, driverLog?.failure_injection),
    llmRecords,
    appLog,
    dir,
    multiTurn,
  });
  const inputs = readAutoMaintenanceInputs(dir, config);
  const scope = { work_id: config.target.work_id, session_id: config.target.session_id };
  const controlChecks = [
    ["G6_interleaved_resume", "interleaved_resume", () => {
      const trace = driverLog?.interleaved_resume;
      return verifyInterleavedResumeFacts(trace, dbFacts, evidence.wire, llmRecords, {
        provider: config.provider, waitingSnapshot: readMaintenanceSnapshot(dir, trace?.waiting_snapshot),
        beforeAnswerSnapshot: readMaintenanceSnapshot(dir, trace?.before_answer_snapshot),
        warmupAuthors: inputs.discussions.slice(0, 10), controls: inputs.controls });
    }],
    ["R03_cancelled_run", "cancel_probe", () => {
      const trace = driverLog?.cancel_probe;
      const pre = readMaintenanceSnapshot(dir, trace?.pre_window_snapshot);
      const admitted = readMaintenanceSnapshot(dir, trace?.admission_snapshot);
      const frozen = freezeSummaryAdmission(pre, admitted, llmRecords, trace.request.run_id, scope);
      assert(frozen, "cancel_first_admission_missing");
      assert.deepEqual(trace.admission, frozen, "cancel_first_admission_not_frozen");
      freezeSummaryAdmission(pre, readMaintenanceSnapshot(dir, trace.confirmation_snapshot),
        llmRecords, trace.request.run_id, scope, frozen);
      assert(trace.summary_target.provider_run_ref === frozen.provider_run_ref &&
        trace.summary_target.provider_call_ref === frozen.provider_call_ref, "cancel_first_admission_target_changed");
      const run = admitted.provider_runs.find((row) => row.id === frozen.provider_run_ref);
      const paired = llmRecords.filter((row) => row.provider_run_ref === run.id && row.provider_call_ref === run.provider_call_ref);
      assert.equal(paired.length, 1, "cancel_actual_request_missing");
      const request = auditDiscussionRequest(paired[0], run,
        transcriptMessages(admitted.authoring_session_messages, admitted.agent_runs));
      assert(request.ok, request.reason);
      assert.equal(request.sourceCount, frozen.source_keys.length, "cancel_source_count_mismatch");
      const ready = read(dir,"native-driver-ready.json");
      if (ready?.owned_ports?.provider_stream != null || trace.stream_binding) {
        const id = trace.stream_binding?.request_id;
        assert(typeof id === "string" && /^request-[1-9][0-9]*$/u.test(id),"stream_binding_missing");
        const events = fs.readFileSync(path.join(dir,"provider-stream.jsonl"),"utf8").trim().split("\n").map(JSON.parse);
        verifyStreamCancellationFacts(trace,events,Object.fromEntries(["request","received","delivered"].map(kind=>
          [kind,fs.readFileSync(path.join(dir,"provider-stream-requests",id+(kind==="request"?"":"."+kind)+".bin"))])),paired[0]);
      }
      return verifyCancelledRunFacts(trace, dbFacts, evidence.wire, {
        before: readMaintenanceSnapshot(dir, trace?.before_snapshot),
        confirmation: readMaintenanceSnapshot(dir, trace?.confirmation_snapshot),
        afterCancel: readMaintenanceSnapshot(dir, trace?.after_cancel_snapshot),
        afterClientRelaunch: readMaintenanceSnapshot(dir, trace?.after_client_relaunch_snapshot),
        author: inputs.controls[4], scope });
    }],
    ["R03_backend_restart", "backend_restart", () => {
      const trace = driverLog?.backend_restart;
      assert.equal(driverLog?.failure_injection?.before_restart_snapshot, trace?.before_snapshot, "recovery_before_restart_not_bound");
      assert.equal(driverLog?.failure_injection?.after_restart_snapshot, trace?.after_snapshot, "recovery_after_restart_not_bound");
      const receipt = readBackendRestartReceipt(dir);
      assert.deepEqual(trace?.receipt, receipt, "backend restart report/receipt mismatch");
      return verifyBackendRestartFacts(trace, readMaintenanceSnapshot(dir, trace.before_snapshot),
        readMaintenanceSnapshot(dir, trace.after_snapshot), llmRecords,
        result.checks.C8_failure_silent.detail.failed_attempt_ids);
    }],
  ];
  for (const [key, name, evaluate] of controlChecks) {
    try { result[name] = evaluate(); }
    catch (error) { result[name] = { ok: false, reason: error.message }; }
    result.checks[key] = result[name];
    result.required.push(key);
    if (result[name].ok !== true) result.failed.push(key);
  }
  writeNativeFrames(dir);
  const summary = writeNativeSummary(dir, {
    sliceId: common.ui.scope,
    driver: common.ui.driver,
    provider: config.provider,
    status: result.failed.length === 0 ? "pass" : "fail",
    checks: Object.fromEntries(Object.entries(result.checks).map(([key, value]) => [key, value.ok])),
    measured: result.measured,
    extra: {
      schema: "b71-auto-maintenance-summary/v1",
      surface: "tauri-native",
      journey: "auto-maintenance",
      scenario: multiTurn ? "g6-multi-turn" : "auto-maintenance-a3",
      multi_turn: multiTurn,
      ...(result.interleaved_resume ? { interleaved_resume: result.interleaved_resume } : {}),
      cancel_probe: result.cancel_probe,
      backend_restart: result.backend_restart,
      env: driverLog?.env ?? null,
      requests: driverLog?.requests ?? [],
      checks_detail: result.checks,
      required: result.required,
      failed: result.failed,
      model_behavior: result.model_behavior,
      not_signed: result.not_signed,
      wait_ledger: common.ledger,
      screenshots: common.ui.screenshots,
      external_model_service_in_scope: false,
      verdict: {
        mechanism: result.failed.length === 0 ? "pass" : "fail",
        auto_maintenance_loop_closed: result.checks.C2_auto_maintenance_committed.ok === true,
        r03_control_flow_closed: controlChecks.every(([key]) => result.checks[key].ok === true),
        full_g1_g6_signed: false,
        i10_signed: false,
      },
    },
  });
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(result, null, 2));
  assert.equal(result.failed.length, 0, `B71 auto-maintenance 判据失败: ${result.failed.join(", ")}`);
  console.log(
    `B71 auto-maintenance 判据通过: checkpoint_events=${result.measured.checkpoint_events} covered=${result.measured.covered_call_ids}`,
  );
  return { result, summary };
}
