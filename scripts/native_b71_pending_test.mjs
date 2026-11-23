// B71 CP4b pending 场景的 Node 组合验证：真实临时 SQLite + 真实 WS/HTTP 帧形状 +
// 真实 capture/verify consumer。不启动 GUI/Mix，不写产品路径。
//
// 正例覆盖 source→revision→accept→discard→restore→followup 的完整证据链；负例只
// 篡改一个真实事实，证明 verifier 不会把错绑/缺 ACK/字节改变/自动写 canon/
// 旧历史重放/错 session 判成通过。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createQuestionTransportProxy } from "./native_question_transport_proxy.mjs";
import {
  APP_BUNDLE,
  NATIVE_DRIVER,
  productionFingerprint,
} from "./lib/native_ui/scenario_evidence.mjs";
import { capturePending, verifyPendingBatch } from "./lib/native_ui/authoring_pending_run_evidence.mjs";
import { createWorkingCopy, openTestRunScope } from "./lib/test_env.mjs";

import { irBodyFromWire, scopeWireMessage } from "./lib/native_ui/fixtures/authoring_request_ir.mjs";
const SLICE_ID = "b71-authoring-pending";
const WORK = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = WORK;
const SESSION = "33333333-3333-4333-8333-333333333333";
const MEMORY = "44444444-4444-4444-8444-444444444444";
const MUTATION = "55555555-5555-4555-8555-555555555555";
const NONCE = "a1b2c3d4e5f60718";
const SOURCE_TURN = "turn-source";
const REVISION_TURN = "turn-revision";
const FOLLOWUP_TURN = "turn-followup";
const SOURCE_RUN = "run-source";
const REVISION_RUN = "run-revision";
const FOLLOWUP_RUN = "run-followup";
const SOURCE_ID = "as-source";
const REVISION_ID = "as-revision";
const ACCEPT_RECEIPT = "receipt-accept";
const DISCARD_RECEIPT = "receipt-discard";
const SOURCE_BODY = "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺。校验标识a1b2c3d4e5f60718。";
const REVISION_BODY = "把这份大纲直接存档为作品设定：主角林渡经营旧书铺。校验标识a1b2c3d4e5f60718。";
const SOURCE_TITLE = "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺";
const REVISION_TITLE = "旧书铺修订稿";
const REVISION_RATIONALE = "按作者要求修改名字，原稿保留。";
const FOLLOWUP_TEXT = "资料处理进度怎么样？";
const ACCEPT_LABEL = "保存到作品档案";
const DISCARD_LABEL = "不保存";
const REPLAY_NOTE = "参考来源\n回放只读取已保存记录，不会重新调用模型";

const sourceItem = {
  item_id: `ai_${SOURCE_TURN}`,
  title: SOURCE_TITLE,
  body: SOURCE_BODY,
  rationale: null,
  provider_call_ref: `author_input:${SOURCE_TURN}`,
};
const writerItem = {
  item_id: "revision-item-1",
  title: REVISION_TITLE,
  body: REVISION_BODY,
  rationale: REVISION_RATIONALE,
};
const revisionItem = { ...writerItem, provider_call_ref: "pcall-writer" };
const sourceArtifact = {
  artifact_id: SOURCE_ID,
  artifact_type: "world_setting",
  adoption_status: "TENTATIVE",
  requires_adoption: true,
  source_tool_result_ref: `author_input:${SOURCE_TURN}`,
  payload: { item_count: 1, items: [sourceItem], title: "世界设定草稿" },
};
const revisionArtifact = {
  artifact_id: REVISION_ID,
  artifact_type: "world_setting",
  adoption_status: "TENTATIVE",
  requires_adoption: true,
  source_tool_result_ref: "tr-writer",
  payload: {
    item_count: 1,
    items: [revisionItem],
    title: "世界设定草稿",
    revision_of: SOURCE_ID,
    registration_source_ref: `author_input:${SOURCE_TURN}`,
  },
};
const acceptAction = {
  action_id: `accept:${REVISION_ID}`,
  action_type: "accept",
  idempotency_key: `idem:${REVISION_TURN}:accept:${REVISION_ID}`,
  source_turn_ref: REVISION_TURN,
  target_ref: REVISION_ID,
  enabled: true,
  label_key: "artifact.accept",
};
const discardAction = {
  action_id: `discard:${SOURCE_ID}`,
  action_type: "discard",
  idempotency_key: `idem:${SOURCE_TURN}:discard:${SOURCE_ID}`,
  source_turn_ref: SOURCE_TURN,
  target_ref: SOURCE_ID,
  enabled: true,
  label_key: "artifact.discard",
};

function nowIso() {
  return new Date().toISOString();
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function appendJsonl(file, records) {
  for (const record of records) fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

function writeJsonl(file, records) {
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function jpeg(file) {
  fs.writeFileSync(file, Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex"));
}

function transcript(run, messages) {
  return {
    run,
    system: {},
    projection: {},
    messages,
    tools: [],
    base_refs: [],
    observation_refs: [],
    used_refs: [],
    call_ids: [],
  };
}

function author(text, turnId) {
  return { role: "user", provenance: "author", source_refs: [`author_input:${turnId}`],
    versions: {}, blocks: [{ type: "text", text }] };
}

function assistant(pcall, prun, callId, name, args, text = "") {
  return {
    role: "assistant",
    provenance: "model",
    provider_call_ref: pcall,
    provider_run_ref: prun,
    blocks: [
      ...(text ? [{ type: "text", text }] : []),
      ...(callId ? [{ type: "tool_call", call_id: callId, name, arguments: args }] : []),
    ],
  };
}

function toolPassed(callId) {
  return {
    role: "tool",
    provenance: "tool_result",
    source_refs: [],
    versions: {},
    blocks: [{ type: "validation_result", call_id: callId, status: "passed" }],
  };
}

function runIdentity(runId, parentTurn) {
  return {
    run_id: runId,
    workspace_id: WORKSPACE,
    work_id: WORK,
    session_id: SESSION,
    parent_turn_ref: parentTurn,
  };
}

const SEGMENT_VERSION = "authoring-run-segment/v1";
const MESSAGE_FORMAT_VERSION = "authoring-session-message/v1";

// B81 CP1：canonical 历史 = run 执行段头 + 会话消息行（run 私有列已退役）。
function insertCanonicalSegment(db, runId, transcript) {
  const header = {
    version: SEGMENT_VERSION,
    run: transcript.run,
    system: transcript.system,
    tools: transcript.tools,
    projection: transcript.projection,
    base_refs: transcript.base_refs,
    observation_refs: transcript.observation_refs,
    used_refs: transcript.used_refs,
    call_ids: transcript.call_ids,
  };
  const identity = transcript.run, count = transcript.messages.length;
  const offset = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS value FROM authoring_session_messages WHERE session_id = ?")
    .get(identity.session_id).value;
  db.prepare("INSERT INTO authoring_run_segments (run_id, workspace_id, work_id, session_id, parent_turn_ref, header, message_count, first_sequence, last_sequence, format_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    runId, identity.workspace_id, identity.work_id, identity.session_id, identity.parent_turn_ref,
    JSON.stringify(header), count, count ? offset + 1 : null, count ? offset + count : null, SEGMENT_VERSION,
  );
  transcript.messages.forEach((message, index) => {
    db.prepare(
      "INSERT INTO authoring_session_messages (id, workspace_id, work_id, session_id, run_id, sequence, run_sequence, role, message, format_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(`msg-${runId}-${index + 1}`, identity.workspace_id, identity.work_id, identity.session_id,
      runId, offset + index + 1, index + 1, message.role, JSON.stringify(message), MESSAGE_FORMAT_VERSION);
  });
}

function agentRunRow(runId, parentTurn, runTranscript, providerCalls, authority) {
  return {
    id: runId,
    workspace_id: WORKSPACE,
    work_id: WORK,
    session_id: SESSION,
    parent_turn_ref: parentTurn,
    run_mode: "bounded",
    profile_ref: "judgment_loop_v1",
    status: "completed",
    consumed_budget: JSON.stringify({ provider_calls: providerCalls, tool_calls: 1, steps: 2 }),
    budget: JSON.stringify({ max_provider_calls: 33 }),
    authority_scope: JSON.stringify(authority),
    pending_artifact_refs: "[]",
  };
}

function providerRunRow(id, callRef, runId, parentTurn, purpose) {
  return {
    id,
    agent_run_id: runId,
    workspace_id: WORKSPACE,
    work_id: WORK,
    session_id: SESSION,
    parent_turn_ref: parentTurn,
    provider_call_ref: callRef,
    provider_id: "slice_verify",
    purpose,
    status: "completed",
  };
}

function llmRecord({ pcall, prun, runId, parentTurn, promptText, messages, response }) {
  return {
    provider: "slice_verify",
    provider_call_ref: pcall,
    provider_run_ref: prun,
    work_id: WORK,
    session_id: SESSION,
    turn_id: parentTurn,
    request_format: "authoring-request-ir/v1",
    response_format: "fixture_provider_result/v1",
    request_body: {
      ...irBodyFromWire({
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: promptText ?? "" },
        ],
        tools: [{ name: "judgment_decision" }],
      }),
      ...(messages ? { messages: structuredClone(messages) } : {}),
    },
    response,
    ts: nowIso(),
    agent_run_id: runId,
  };
}

function scopeText(facts) {
  return scopeWireMessage({ context: { interaction_state: facts } }).content;
}

function followupFacts() {
  return {
    pending_adoptions: [],
    resolved_adoptions: [
      {
        status: "DISCARDED",
        title: SOURCE_TITLE,
        artifact_ref: SOURCE_ID,
        revision_of: null,
      },
      {
        status: "ACCEPTED",
        title: REVISION_TITLE,
        artifact_ref: REVISION_ID,
        revision_of: SOURCE_ID,
      },
    ],
    pending_adoption_count: 0,
    resolved_adoption_count: 2,
    omitted_adoptions: 0,
  };
}

// 独立夹具：当前普通修订的实际供给，不从 evidence consumer 或产品生成器反推。
function revisionSourceScope(mode = "complete") {
  const body = mode === "partial-body" ? "主角沈砚经营旧书铺。" : SOURCE_BODY;
  const ref = mode === "wrong-artifact" ? "as-another" : SOURCE_ID;
  const scope = {
    role: "scope_update", provenance: "application",
    versions: { scope_revision: 1, change_reason: "creative_execution" },
    source_refs: [{ ref }, { ref: REVISION_TURN }, { ref: `turn:${REVISION_TURN}` }],
    base_refs: [{ ref }],
    blocks: [{ type: "scope", content: {
      work_id: WORK,
      authoring_task: {
        kind: "revision", source: { kind: "author_action", ref: REVISION_TURN },
        scope: { refs: [ref], coverage: "single", base_ref: ref,
          base_hash: createHash("sha256").update(body).digest("hex") },
        materials: [{ kind: "baseline_body", ref, "complete?": true }],
        operation_effect: "revise_candidate",
      },
      operation: { role: "creative_execution", capability: "world_building",
        artifact_type: "world_setting",
        context_text: "原候选全文（仅供修订，不是已确认作品事实）：\n" + body },
    } }],
  };
  const content = scope.blocks[0].content;
  if (mode === "wrong-hash") content.authoring_task.scope.base_hash = "0".repeat(64);
  if (mode === "wrong-source-turn") content.authoring_task.source.ref = SOURCE_TURN;
  if (mode === "incomplete") content.authoring_task.materials[0]["complete?"] = false;
  if (mode === "duplicate-material") content.authoring_task.materials.push({ ...content.authoring_task.materials[0] });
  if (mode === "wrong-work") content.work_id = "work-another";
  if (mode === "nested-work-only") {
    content.scope = { work_id: WORK };
    delete content.work_id;
  }
  return scope;
}

function followupReply() {
  return `当前待采纳 0 份，已处置 2 份：ACCEPTED ${REVISION_TITLE}；DISCARDED ${SOURCE_TITLE}。`;
}

function dbExec(db, sql, params = []) {
  db.prepare(sql).run(...params);
}

function createSchema(db) {
  for (const table of [
    "works",
    "workspaces",
    "work_sessions",
    "drafts",
    "chapters",
    "volumes",
    "scenes",
    "characters",
    "ledger_entries",
  ]) {
    dbExec(db, `CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
  }
  dbExec(db, "ALTER TABLE works ADD COLUMN title TEXT");
  dbExec(db, "ALTER TABLE work_sessions ADD COLUMN work_id TEXT");
  dbExec(db, `CREATE TABLE memory_reference_logs (
    id TEXT PRIMARY KEY, memory_id TEXT, work_id TEXT, task_id TEXT, conversation_id TEXT,
    reference_scene TEXT, reference_reason TEXT, inserted_at TEXT
  )`);
  dbExec(db, `CREATE TABLE memory_items (
    id TEXT PRIMARY KEY, work_id TEXT, status TEXT, type TEXT, content TEXT, summary TEXT,
    source_id TEXT, source_type TEXT, tags TEXT, scope TEXT, confidence TEXT, weight TEXT,
    version INTEGER, locked INTEGER, recallable INTEGER, reference_count INTEGER,
    last_referenced_at TEXT, inserted_at TEXT, updated_at TEXT
  )`);
  dbExec(db, `CREATE TABLE author_action_receipts (
    id TEXT PRIMARY KEY, action_id TEXT, action_type TEXT, idempotency_key TEXT,
    work_id TEXT, session_id TEXT, source_turn_ref TEXT, status TEXT, result TEXT,
    inserted_at TEXT, updated_at TEXT
  )`);
  dbExec(db, `CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT,
    run_mode TEXT, profile_ref TEXT, status TEXT,
    consumed_budget TEXT, budget TEXT, authority_scope TEXT, pending_artifact_refs TEXT
  )`);
  dbExec(db, `CREATE TABLE authoring_run_segments (
    run_id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT,
    header TEXT, message_count INTEGER, first_sequence INTEGER, last_sequence INTEGER, format_version TEXT
  )`);
  dbExec(db, `CREATE TABLE authoring_session_messages (
    id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, run_id TEXT,
    sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT, format_version TEXT
  )`);
  dbExec(db, `CREATE TABLE provider_runs (
    id TEXT PRIMARY KEY, agent_run_id TEXT, workspace_id TEXT, work_id TEXT, session_id TEXT,
    parent_turn_ref TEXT, provider_call_ref TEXT, provider_id TEXT, purpose TEXT, status TEXT
  )`);
  dbExec(db, `CREATE TABLE provider_outputs (
    provider_run_id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT, status TEXT,
    content_summary TEXT
  )`);
  dbExec(db, `CREATE TABLE interactions (
    id TEXT PRIMARY KEY, workspace_id TEXT, session_id TEXT, turn_id TEXT, role TEXT, content TEXT
  )`);
  dbExec(db, `CREATE TABLE decision_traces (
    trace_id TEXT PRIMARY KEY, turn_id TEXT, session_id TEXT
  )`);
}

function seedStart(db) {
  dbExec(db, "INSERT INTO works (id, title) VALUES (?, ?)", [WORK, "B71 pending author boundary"]);
  dbExec(db, "INSERT INTO workspaces (id) VALUES (?)", [WORK]);
  dbExec(db, "INSERT INTO work_sessions (id, work_id) VALUES (?, ?)", [SESSION, WORK]);
}

function openDb(dir) {
  return new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
}

function insertRunFacts(dir, { run, transcript, providerRuns, records, authority }) {
  const db = openDb(dir);
  dbExec(db, "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, run_mode, profile_ref, status, consumed_budget, budget, authority_scope, pending_artifact_refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", Object.values(run));
  insertCanonicalSegment(db, run.id, transcript);
  for (const row of providerRuns) {
    dbExec(db, "INSERT INTO provider_runs (id, agent_run_id, workspace_id, work_id, session_id, parent_turn_ref, provider_call_ref, provider_id, purpose, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", Object.values(row));
  }
  db.close();
  appendJsonl(path.join(dir, "llm-calls", "calls.jsonl"), records);
  appendJsonl(
    path.join(dir, "app-log", "app.jsonl"),
    records.map(() => ({ event: "provider_gateway.complete.start", provider: "slice_verify" })),
  );
}

function insertInteraction(dir, { runId, turnId, turnResult }) {
  const db = openDb(dir);
  dbExec(
    db,
    "INSERT INTO interactions (id, workspace_id, session_id, turn_id, role, content) VALUES (?, ?, ?, ?, ?, ?)",
    [
      `interaction-${turnId}`,
      WORK,
      SESSION,
      turnId,
      "assistant",
      JSON.stringify({ agent_run_id: runId, turn_result: turnResult }),
    ],
  );
  db.close();
}

function insertAcceptFacts(dir) {
  const db = openDb(dir);
  dbExec(
    db,
    `INSERT INTO memory_items (id, work_id, status, type, content, summary, source_id, source_type, tags, scope, confidence, weight, version, locked, recallable, reference_count, last_referenced_at, inserted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      MEMORY,
      WORK,
      "CONFIRMED",
      "WORLD_RULE",
      `${REVISION_TITLE}: ${REVISION_BODY}`,
      REVISION_TITLE,
      MUTATION,
      "AUTHOR_CONFIRMED",
      JSON.stringify(["adopted_artifact", "world_setting"]),
      "WORK",
      "0.9",
      "0.8",
      1,
      1,
      1,
      0,
      null,
      nowIso(),
      nowIso(),
    ],
  );
  dbExec(
    db,
    "INSERT INTO author_action_receipts (id, action_id, action_type, idempotency_key, work_id, session_id, source_turn_ref, status, result, inserted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      ACCEPT_RECEIPT,
      acceptAction.action_id,
      "accept",
      acceptAction.idempotency_key,
      WORK,
      SESSION,
      REVISION_TURN,
      "accepted",
      JSON.stringify({
        action_id: `adopt:${REVISION_ID}`,
        action_type: "adopt",
        artifact_id: REVISION_ID,
        decision: "ACCEPTED",
        persistence: {
          memory_item_id: MEMORY,
          memory_status: "CONFIRMED",
          mutation_id: MUTATION,
          persisted: true,
        },
        status: "accepted",
      }),
      nowIso(),
      nowIso(),
    ],
  );
  db.close();
}

function insertDiscardFact(dir) {
  const db = openDb(dir);
  dbExec(
    db,
    "INSERT INTO author_action_receipts (id, action_id, action_type, idempotency_key, work_id, session_id, source_turn_ref, status, result, inserted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      DISCARD_RECEIPT,
      discardAction.action_id,
      "discard",
      discardAction.idempotency_key,
      WORK,
      SESSION,
      SOURCE_TURN,
      "discarded",
      JSON.stringify({
        action_id: discardAction.action_id,
        action_type: "discard",
        artifact_id: SOURCE_ID,
        decision: "DISCARDED",
        status: "discarded",
      }),
      nowIso(),
      nowIso(),
    ],
  );
  db.close();
}

function turnResultBody({ turnId, parentTurnId, runId, pending, resolved }) {
  return {
    turn_id: turnId,
    parent_turn_id: parentTurnId,
    status: "conversational",
    work_id: WORK, session_id: SESSION,
    agent_run: { run_id: runId, parent_turn_ref: parentTurnId ?? turnId, status: "running", run_mode: "bounded", profile_ref: "judgment_loop_v1" },
    assistant_message: { text: "" },
    adoption_state: { pending: pending ?? [], resolved: resolved ?? [] },
    available_actions: [],
    trace_summary: { trace_ref: `trace-${turnId}` },
    truthfulness: { production_write_performed: false, artifact_adopted: false },
  };
}

function addWire(dir, records) {
  appendJsonl(path.join(dir, "native-transport.jsonl"), records);
}

function wireFrame(at, direction, frame) {
  return { at, direction, frame };
}

function joinRecords(topic, joinRef, sessionId) {
  const at = nowIso();
  return [
    wireFrame(at, "sent", [joinRef, joinRef, topic, "phx_join", { work_id: WORK, session_id: sessionId }]),
    wireFrame(at, "received", [joinRef, joinRef, topic, "phx_reply", {
      status: "ok",
      response: { joined: true, work_id: WORK, session_id: sessionId },
    }]),
  ];
}

function userMessageRecords(topic, joinRef, requestRef, turnId, text) {
  const at = nowIso();
  return [
    wireFrame(at, "sent", [joinRef, requestRef, topic, "user_message", {
      text,
      turn_id: turnId,
      work_id: WORK,
      session_id: SESSION,
    }]),
    wireFrame(at, "received", [joinRef, requestRef, topic, "phx_reply", {
      status: "ok",
      response: { run_id: null, turn_id: turnId },
    }]),
  ];
}

function bindAckRun(records, runId) {
  for (const record of records) {
    if (record.frame?.[3] === "phx_reply") record.frame[4].response.run_id = runId;
  }
  return records;
}

function actionRecords(topic, joinRef, requestRef, action, { actionType, artifactId, status, parentTurn, turnId }) {
  const at = nowIso();
  return [
    wireFrame(at, "sent", [joinRef, requestRef, topic, "author_action", { action }]),
    wireFrame(at, "received", [joinRef, requestRef, topic, "phx_reply", {
      status: "ok",
      response: { received: true, action_status: status },
    }]),
    wireFrame(at, "received", [null, null, topic, "action_result", {
      action_id: actionType === "adopt" ? `adopt:${artifactId}` : action.action_id,
      action_type: actionType,
      artifact_id: artifactId,
      status,
    }]),
    wireFrame(at, "received", [null, null, topic, "turn_result", turnResultBody({
      turnId,
      parentTurnId: parentTurn,
      runId: null,
      pending: [],
      resolved: [{ artifact_id: artifactId, adoption_status: action.action_type === "accept" ? "ACCEPTED" : "DISCARDED" }],
    })]),
  ];
}

function writeEvidenceFiles(dir) {
  const readyAt = nowIso();
  writeJson(path.join(dir, "native-driver-ready.json"), {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-ref-pending",
    provider: "slice_verify",
    slice_id: SLICE_ID,
    ready_at: readyAt,
    app_path: "/tmp/B71 Pending.app",
  });
  for (const name of ["01-workbench", "after-source", "after-revision", "why", "after-accept", "after-discard", "after-restore", "final"]) {
    jpeg(path.join(dir, `${name}.jpg`));
  }
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: "run-ref-pending",
    driver: NATIVE_DRIVER,
    app_bundle: APP_BUNDLE,
    scope: SLICE_ID,
    screenshots: ["01-workbench.jpg", "after-source.jpg", "after-revision.jpg", "why.jpg", "after-accept.jpg", "after-discard.jpg", "after-restore.jpg", "final.jpg"],
  });
  const commands = [];
  const events = [];
  const kinds = ["input", "ack", "turn", "maintenance", "input", "ack", "turn", "maintenance", "input", "ack", "turn", "restore", "turn"];
  for (const [index, kind] of kinds.entries()) {
    const id = `wait-${index}`;
    commands.push({ op: "begin", id, kind, label: `${kind}-${index}` });
    commands.push({ op: "finish", id, kind, label: `${kind}-${index}` });
    const at = Date.now() - (kinds.length - index) * 1000;
    events.push({ event: "wait_start", kind, at, id });
    events.push({ event: "wait_end", kind, ended_at: at + 500, id });
  }
  writeJsonl(path.join(dir, "native-driver-commands.jsonl"), commands);
  writeJsonl(path.join(dir, "wait-events.jsonl"), events);
  writeJson(path.join(dir, "wait-stats.json"), { active: null, completed: kinds.length });
  writeJsonl(path.join(dir, "heartbeat.jsonl"), [{ at: readyAt }]);
  fs.writeFileSync(path.join(dir, "seed.log"), `[b71-authoring-pending-seed] work_id=${WORK} session_id=${SESSION}\n`);
  writeJson(path.join(dir, "native-b71-config.json"), {
    slice_id: SLICE_ID,
    provider: "slice_verify",
    journey: "pending",
    target: { work_id: WORK, work_title: "B71 pending author boundary", session_id: SESSION },
    message: SOURCE_BODY,
    nonce: NONCE,
    revision_message: "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。",
    followup_message: FOLLOWUP_TEXT,
  });
  writeJson(path.join(dir, "production-sources-before.json"), productionFingerprint());
  writeJson(path.join(dir, "native-b71-driver-log.json"), {
    slice_id: SLICE_ID,
    provider: "slice_verify",
    restore: { resolved_non_actionable: true, revision_body_visible: true },
  });
}

function writeAx(dir) {
  const base = [
    SOURCE_TITLE,
    SOURCE_BODY,
    REVISION_TITLE,
    REVISION_BODY,
    ACCEPT_LABEL,
    DISCARD_LABEL,
    "为什么",
    "同步已连接",
    FOLLOWUP_TEXT,
    followupReply(),
  ].join("\n");
  for (const name of ["after-source", "after-revision", "after-accept", "after-discard", "after-restore", "final"]) {
    fs.writeFileSync(path.join(dir, `${name}.text.txt`), base);
  }
  fs.writeFileSync(path.join(dir, "why.text.txt"), `${base}\n${REPLAY_NOTE}`);
}

function resumeHttpBody() {
  const sourceEntry = {
    artifact_id: SOURCE_ID,
    artifact_type: "world_setting",
    adoption_status: "DISCARDED",
    requires_adoption: false,
    payload: {
      item_count: 1,
      items: [sourceItem],
      title: "世界设定草稿",
    },
  };
  const revisionEntry = {
    artifact_id: REVISION_ID,
    artifact_type: "world_setting",
    adoption_status: "ACCEPTED",
    requires_adoption: false,
    payload: {
      item_count: 1,
      items: [revisionItem],
      title: "世界设定草稿",
      revision_of: SOURCE_ID,
    },
  };
  return {
    work: { id: WORK },
    active_session: { id: SESSION, work_id: WORK },
    pending_adoptions: [],
    pending_adoption_turn_results: [],
    inbox_pending_adoptions: [],
    inbox_pending_adoption_turn_results: [],
    resolved_adoptions: [sourceEntry, revisionEntry],
    inbox_resolved_adoptions: [sourceEntry, revisionEntry],
  };
}

function httpFixtureServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const body = pathname.endsWith("/sessions/resume")
      ? resumeHttpBody()
      : { work_id: WORK, session_id: SESSION, turn_id: REVISION_TURN };
    const payload = JSON.stringify(body);
    response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
    response.end(payload);
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function getThroughProxy(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: requestPath }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
  });
}

async function waitForHttpCapture(file, requestPath) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const rows = fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse)
      : [];
    const hit = rows.find((row) => row.direction === "http" && row.path === requestPath && row.body_state);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`proxy 未记录 capture: ${requestPath}`);
}

async function captureHttpFixture(workRoot) {
  const server = httpFixtureServer();
  const dir = fs.mkdtempSync(path.join(workRoot, "b71-pending-http-"));
  const controlPath = path.join(dir, "transport-control.json");
  const logPath = path.join(dir, "native-transport.jsonl");
  fs.writeFileSync(controlPath, "{}");
  fs.writeFileSync(logPath, "");
  const proxy = createQuestionTransportProxy({
    target: `http://127.0.0.1:${await listen(server)}`,
    controlPath,
    logPath,
  });
  const port = await listen(proxy.server);
  return {
    logPath,
    async get(requestPath) {
      const response = await getThroughProxy(port, requestPath);
      await waitForHttpCapture(logPath, requestPath);
      return response;
    },
    close() {
      proxy.close();
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function buildBatch(workRoot, { followupAction = null, revisionSource = "complete" } = {}) {
  const dir = fs.mkdtempSync(path.join(workRoot, "b71-pending-"));
  const httpCapture = await captureHttpFixture(workRoot);
  fs.mkdirSync(path.join(dir, "database"), { recursive: true });
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });
  fs.mkdirSync(path.join(dir, "app-log"), { recursive: true });
  fs.writeFileSync(path.join(dir, "native-transport.jsonl"), "");
  writeEvidenceFiles(dir);
  const db = openDb(dir);
  createSchema(db);
  seedStart(db);
  db.close();
  capturePending(dir, "start");

  const topic = `workspace:${WORKSPACE}`;
  addWire(dir, joinRecords(topic, "join-a", SESSION));

  // source：作者原文登记，真实 judgment run 只有一个 planner 调用。
  const sourceResponse = {
    status: "ok",
    body: {
      content: "",
      tool_calls: [{
        id: "call-source",
        name: "judgment_decision",
        arguments: { action: "execute", capability: "world_building", dialogue_goal: SOURCE_BODY, reason: "register" },
      }],
    },
  };
  const sourceCanonical = [
    author(SOURCE_BODY, SOURCE_TURN),
    assistant("pcall-source", "prun-source", "call-source", "judgment_decision", sourceResponse.body.tool_calls[0].arguments),
    toolPassed("call-source"),
    ...(revisionSource === "historical" ? [revisionSourceScope()] : []),
  ];
  const sourceRun = agentRunRow(
    SOURCE_RUN,
    SOURCE_TURN,
    transcript(runIdentity(SOURCE_RUN, SOURCE_TURN), sourceCanonical),
    1,
    { allowed_tools: ["judgment", "world_building"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  );
  insertRunFacts(dir, {
    run: sourceRun,
    transcript: transcript(runIdentity(SOURCE_RUN, SOURCE_TURN), sourceCanonical),
    providerRuns: [providerRunRow("prun-source", "pcall-source", SOURCE_RUN, SOURCE_TURN, "planner")],
    records: [llmRecord({
      pcall: "pcall-source",
      prun: "prun-source",
      runId: SOURCE_RUN,
      parentTurn: SOURCE_TURN,
      messages: sourceCanonical.slice(0, 1),
      response: sourceResponse,
    })],
    authority: { allowed_tools: ["judgment", "world_building"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  });
  insertInteraction(dir, {
    runId: SOURCE_RUN,
    turnId: SOURCE_TURN,
    turnResult: turnResultBody({ turnId: SOURCE_TURN, parentTurnId: null, runId: SOURCE_RUN, pending: [sourceArtifact] }),
  });
  const sourceMessages = bindAckRun(
    userMessageRecords(topic, "join-a", "req-source", SOURCE_TURN, SOURCE_BODY),
    SOURCE_RUN,
  );
  addWire(dir, [
    ...sourceMessages,
    wireFrame(nowIso(), "received", [null, null, topic, "turn_result", {
      ...turnResultBody({
        turnId: SOURCE_TURN,
        parentTurnId: null,
        runId: SOURCE_RUN,
        pending: [sourceArtifact],
      }),
      available_actions: [discardAction],
    }]),
  ]);
  capturePending(dir, "after-source");

  // revision：同一 revision run 内判断 → writer；两稿分属不同 TurnResult。
  const writerArgs = { artifact_type: "world_setting", items: [writerItem] };
  const revisionDecision = { action: "execute", capability: "revise_pending_artifact",
    pending_artifact_ref: SOURCE_ID, dialogue_goal: "只改名字", reason: "revise" };
  const revisionCanonical = [
    author("请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。", REVISION_TURN),
    assistant("pcall-judgment", "prun-judgment", "call-judgment", "judgment_decision", revisionDecision),
    toolPassed("call-judgment"),
    ...(["missing", "historical", "future"].includes(revisionSource) ? [] : [revisionSourceScope(revisionSource)]),
    ...(revisionSource === "superseded" ? [{ role: "scope_update", provenance: "application",
      versions: { scope_revision: 2, change_reason: "judgment" }, source_refs: [],
      blocks: [{ type: "scope", content: { work_id: WORK } }] }] : []),
    assistant("pcall-writer", "prun-writer", "call-writer", "submit_tentative_artifact", writerArgs),
    toolPassed("call-writer"),
    ...(revisionSource === "future" ? [revisionSourceScope()] : []),
  ];
  const writerMessageIndex = revisionCanonical.findIndex(message => message.provider_call_ref === "pcall-writer");
  const revisionRun = agentRunRow(
    REVISION_RUN,
    REVISION_TURN,
    transcript(runIdentity(REVISION_RUN, REVISION_TURN), revisionCanonical),
    2,
    { allowed_tools: ["judgment", "world_building"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  );
  insertRunFacts(dir, {
    run: revisionRun,
    transcript: transcript(runIdentity(REVISION_RUN, REVISION_TURN), revisionCanonical),
    providerRuns: [
      providerRunRow("prun-judgment", "pcall-judgment", REVISION_RUN, REVISION_TURN, "planner"),
      providerRunRow("prun-writer", "pcall-writer", REVISION_RUN, REVISION_TURN, "world_building"),
    ],
    records: [
      llmRecord({
        pcall: "pcall-judgment",
        prun: "prun-judgment",
        runId: REVISION_RUN,
        parentTurn: REVISION_TURN,
        messages: [...sourceCanonical, ...revisionCanonical.slice(0, 1)],
        response: { status: "ok", body: { content: "", tool_calls: [{ id: "call-judgment", name: "judgment_decision", arguments: revisionDecision }] } },
      }),
      llmRecord({
        pcall: "pcall-writer",
        prun: "prun-writer",
        runId: REVISION_RUN,
        parentTurn: REVISION_TURN,
        messages: [...sourceCanonical, ...revisionCanonical.slice(0, writerMessageIndex)],
        response: { status: "ok", body: { content: "", tool_calls: [{ id: "call-writer", name: "submit_tentative_artifact", arguments: writerArgs }] } },
      }),
    ],
    authority: { allowed_tools: ["judgment", "world_building"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  });
  insertInteraction(dir, {
    runId: REVISION_RUN,
    turnId: REVISION_TURN,
    turnResult: turnResultBody({ turnId: REVISION_TURN, parentTurnId: null, runId: REVISION_RUN, pending: [revisionArtifact] }),
  });
  addWire(dir, [
    ...bindAckRun(userMessageRecords(topic, "join-a", "req-revision", REVISION_TURN, "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。"), REVISION_RUN),
    wireFrame(nowIso(), "received", [null, null, topic, "turn_result", {
      ...turnResultBody({ turnId: REVISION_TURN, parentTurnId: null, runId: REVISION_RUN, pending: [revisionArtifact] }),
      available_actions: [acceptAction, discardAction],
    }]),
  ]);
  capturePending(dir, "after-revision");
  capturePending(dir, "before-why");
  const replayPath = `/api/works/${WORK}/sessions/${SESSION}/turns/${REVISION_TURN}/replay`;
  await httpCapture.get(replayPath);
  addWire(dir, fs.readFileSync(httpCapture.logPath, "utf8").split("\n").filter(Boolean).map(JSON.parse));
  fs.writeFileSync(httpCapture.logPath, "");
  capturePending(dir, "after-why");

  // accept：作者动作 0 Provider；只新增修订全文 CONFIRMED 行与 receipt。
  insertAcceptFacts(dir);
  addWire(dir, actionRecords(topic, "join-a", "req-accept", acceptAction, {
    actionType: "adopt",
    artifactId: REVISION_ID,
    status: "accepted",
    parentTurn: REVISION_TURN,
    turnId: "turn-accept",
  }));
  capturePending(dir, "after-accept");

  // discard：只新增原稿 receipt，已采纳全文不变。
  insertDiscardFact(dir);
  addWire(dir, actionRecords(topic, "join-a", "req-discard", discardAction, {
    actionType: "discard",
    artifactId: SOURCE_ID,
    status: "discarded",
    parentTurn: SOURCE_TURN,
    turnId: "turn-discard",
  }));
  capturePending(dir, "after-discard");

  // restore：真实 resume HTTP 后同 session 重新 join；无新 run/Provider/canon。
  const resumePath = `/api/works/${WORK}/sessions/resume`;
  await httpCapture.get(resumePath);
  addWire(dir, fs.readFileSync(httpCapture.logPath, "utf8").split("\n").filter(Boolean).map(JSON.parse));
  fs.writeFileSync(httpCapture.logPath, "");
  capturePending(dir, "after-restore");

  // followup：新 run 的真实请求消费 ACCEPTED/DISCARDED，回复等于同次 Provider 原文。
  const reply = followupReply();
  const followupDecision = { action: followupAction, capability: "planning_read",
    query: "核对本轮资料处理状态", reason: "按作者原问核对" };
  const followupTranscript = transcript(runIdentity(FOLLOWUP_RUN, FOLLOWUP_TURN), [
    author(FOLLOWUP_TEXT, FOLLOWUP_TURN),
    {
      role: "scope_update",
      provenance: "application",
      versions: {},
      source_refs: [],
      blocks: [{ type: "scope", content: { context: { interaction_state: followupFacts() } } }],
    },
    ...(followupAction ? [
      assistant("pcall-followup-explore", "prun-followup-explore", "call-followup-explore",
        "judgment_decision", followupDecision),
      toolPassed("call-followup-explore"),
    ] : []),
    assistant("pcall-followup", "prun-followup", null, null, null, reply),
  ]);
  const followupRun = agentRunRow(
    FOLLOWUP_RUN,
    FOLLOWUP_TURN,
    followupTranscript,
    followupAction ? 2 : 1,
    { allowed_tools: ["judgment"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  );
  const followupResponse = { status: "ok", body: { content: reply, tool_calls: [] } };
  insertRunFacts(dir, {
    run: followupRun,
    transcript: followupTranscript,
    providerRuns: [
      ...(followupAction ? [providerRunRow("prun-followup-explore", "pcall-followup-explore", FOLLOWUP_RUN, FOLLOWUP_TURN, "planner")] : []),
      providerRunRow("prun-followup", "pcall-followup", FOLLOWUP_RUN, FOLLOWUP_TURN, "planner"),
    ],
    records: [
      ...(followupAction ? [llmRecord({
        pcall: "pcall-followup-explore", prun: "prun-followup-explore",
        runId: FOLLOWUP_RUN, parentTurn: FOLLOWUP_TURN,
        messages: [...sourceCanonical, ...revisionCanonical, ...followupTranscript.messages.slice(0, 2)],
        response: { status: "ok", body: { content: "", tool_calls: [{
          id: "call-followup-explore", name: "judgment_decision", arguments: followupDecision,
        }] } },
      })] : []),
      llmRecord({
      pcall: "pcall-followup",
      prun: "prun-followup",
      runId: FOLLOWUP_RUN,
      parentTurn: FOLLOWUP_TURN,
      promptText: FOLLOWUP_TEXT,
      response: followupResponse,
    })],
    authority: { allowed_tools: ["judgment"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  });
  // ADR-0035：完整会话历史保留，当前 Scope/作者消息绑定本次 followup run。
  const callFile = path.join(dir, "llm-calls", "calls.jsonl");
  const records = fs.readFileSync(callFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  records.at(-1).request_body.messages = structuredClone([
    ...sourceCanonical, ...revisionCanonical, ...followupTranscript.messages.slice(0, -1),
  ]);
  writeJsonl(callFile, records);
  const db2 = openDb(dir);
  dbExec(db2, "INSERT INTO decision_traces (trace_id, turn_id, session_id) VALUES (?, ?, ?)", [`trace-${FOLLOWUP_TURN}`, FOLLOWUP_TURN, SESSION]);
  db2.close();
  insertInteraction(dir, {
    runId: FOLLOWUP_RUN,
    turnId: FOLLOWUP_TURN,
    turnResult: turnResultBody({ turnId: FOLLOWUP_TURN, parentTurnId: null, runId: FOLLOWUP_RUN, pending: [] }),
  });
  addWire(dir, joinRecords(topic, "join-b", SESSION));
  addWire(dir, [
    ...bindAckRun(userMessageRecords(topic, "join-b", "req-followup", FOLLOWUP_TURN, FOLLOWUP_TEXT), FOLLOWUP_RUN),
    wireFrame(nowIso(), "received", [null, null, topic, "turn_result", {
      ...turnResultBody({ turnId: FOLLOWUP_TURN, parentTurnId: null, runId: FOLLOWUP_RUN, pending: [] }),
      assistant_message: { text: reply },
    }]),
  ]);
  writeAx(dir);
  capturePending(dir, "final");
  httpCapture.close();
  return dir;
}

// 模板文件集合：批次在 run 内只构建一次（真实代理/HTTP capture + SUT checkpoint
// 采集都是异步/有副作用路径），每个需要篡改或写 summary 的 case 取隔离工作副本。
function pendingTemplateFor(dir) {
  const files = new Map();
  const walk = (absolute, prefix) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) walk(child, rel);
      else files.set(rel, child);
    }
  };
  walk(dir, "");
  return { name: "b71-pending-batch", dir, files, scope: runScope };
}

function batchCopy(t) {
  return createWorkingCopy(pendingTemplateFor(batchDir), { context: t }).dir;
}

let runScope;
let batchDir;

test.before(async () => {
  runScope = openTestRunScope();
  batchDir = await buildBatch(runScope.workDir);
});

test.after(() => {
  runScope?.close();
});

function authorityOf(overrides = {}) {
  return {
    allowed_tools: ["judgment", "world_building"],
    production_write: false,
    profile_selection: { profile_ref: "judgment_loop_v1" },
    ...overrides,
  };
}

function assertAuthorityRejected(t, scope, pattern = undefined, runId = SOURCE_RUN) {
  const dir = batchCopy(t);
  const db = openDb(dir);
  let row;
  try {
    dbExec(db, "UPDATE agent_runs SET authority_scope = ? WHERE id = ?", [scope, runId]);
    row = db.prepare("SELECT authority_scope AS scope FROM agent_runs WHERE id = ?").get(runId);
  } finally {
    db.close();
  }
  assert.equal(row.scope, scope);
  if (pattern === undefined) assert.throws(() => verifyPendingBatch(dir));
  else assert.throws(() => verifyPendingBatch(dir), pattern);
}

function mutateJsonl(file, fn) {
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  writeJsonl(file, fn(rows));
}

function mutateCheckpoint(dir, name, fn) {
  const file = path.join(dir, `b71-${name}.json`);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  writeJson(file, fn(value) ?? value);
}

test("pending 全链正例：三 run、两稿、采纳/放弃、恢复与新请求", (t) => {
  const dir = batchCopy(t);
  const { checks } = verifyPendingBatch(dir);
  assert.equal(checks.canon_accept_only_adds_bound_memory_and_receipt, true);
  assert.equal(checks.revision_writer_bytes_exact, true);
  assert.equal(checks.followup_reply_exact_provider, true);
  assert.equal(checks.restore_same_session, true);
  assert.equal(checks.resume_projection_pending_empty, true);
  assert.equal(checks.resume_projection_resolved_count_exact, true);
  assert.equal(checks.resume_projection_source_discarded, true);
  assert.equal(checks.resume_projection_revision_accepted, true);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.slice_id, SLICE_ID);
  assert.equal(summary.all_checks_passed, true);
});


test("普通修订只从当前 Writer 调用前最近有效 Scope 取完整源候选", (t) => {
  const { checks } = verifyPendingBatch(batchCopy(t));
  assert.equal(checks.revision_source_candidate_bound, true);
  assert.equal(checks.revision_body_preserved, true);
});

for (const mode of ["missing", "wrong-artifact", "partial-body", "wrong-hash",
  "wrong-source-turn", "incomplete", "duplicate-material", "wrong-work", "nested-work-only",
  "historical", "future", "superseded"]) {
  test(`修订源供给 ${mode} 不能借历史原文或正确输出通过`, async () => {
    const dir = await buildBatch(runScope.workDir, { revisionSource: mode });
    assert.throws(() => verifyPendingBatch(dir), /revision_source_candidate_bound/);
  });
}

test("pending 业务结果预测 completed 不能覆盖真实 running", (t) => {
  const dir = batchCopy(t), db = openDb(dir);
  try { dbExec(db, "UPDATE agent_runs SET status = ? WHERE id = ?", ["running", SOURCE_RUN]); }
  finally { db.close(); }
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) => rows.map((row) => {
    if (row.frame?.[3] === "turn_result" && row.frame[4]?.agent_run?.run_id === SOURCE_RUN)
      row.frame[4].agent_run.status = "completed";
    return row;
  }));
  assert.throws(() => verifyPendingBatch(dir), /真实完成状态/);
});

test("缺失/多义 revision ACK 不能通过", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.filter((row) => !(row.frame?.[1] === "req-revision" && row.frame?.[3] === "phx_reply")));
  assert.throws(() => verifyPendingBatch(dir), /ACK 必须唯一/);
});

test("revision artifact 字节改变不能冒充同次 writer 响应", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] !== "turn_result") return row;
      const body = row.frame[4];
      if (body?.turn_id !== REVISION_TURN) return row;
      body.adoption_state.pending[0].payload.items[0].body = "被篡改的正文";
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /revision_writer_bytes_exact/);
});

test("writer 应用校验 failed 不能签候选字节合法", (t) => {
  const dir = batchCopy(t);
  const db = openDb(dir);
  try {
    const rows = db
      .prepare("SELECT run_sequence, message FROM authoring_session_messages WHERE run_id = ? ORDER BY run_sequence")
      .all(REVISION_RUN);
    for (const row of rows) {
      const message = JSON.parse(row.message);
      let changed = false;
      for (const block of message.blocks ?? []) {
        if (block.type === "validation_result" && block.call_id === "call-writer") {
          block.status = "failed";
          changed = true;
        }
      }
      if (changed) {
        db.prepare("UPDATE authoring_session_messages SET message = ? WHERE run_id = ? AND run_sequence = ?").run(
          JSON.stringify(message),
          REVISION_RUN,
          row.run_sequence,
        );
      }
    }
  } finally {
    db.close();
  }
  mutateJsonl(path.join(dir, "llm-calls", "calls.jsonl"), rows => rows.map(row => {
    for (const message of row.request_body.messages) for (const block of message.blocks ?? []) {
      if (block.type === "validation_result" && block.call_id === "call-writer") block.status = "failed";
    }
    return row;
  }));
  assert.throws(() => verifyPendingBatch(dir), /revision_writer_validation_passed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("action target/source 错绑不能通过", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] === "author_action" && row.frame[4]?.action?.action_type === "accept") {
        row.frame[4].action.target_ref = SOURCE_ID;
      }
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /accept_action_ack_bound|accept_action_result_exact|author_action|冲突/);
});

test("restore 错 session 不能通过", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] === "user_message" && row.frame[4]?.turn_id === FOLLOWUP_TURN) {
        row.frame[4].session_id = "99999999-9999-4999-8999-999999999999";
      }
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /session/);
});

test("followup 请求缺少真实处置状态不能通过", (t) => {
  const dir = batchCopy(t);
  const file = path.join(dir, "llm-calls", "calls.jsonl");
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const last = rows.at(-1);
  const scope = last.request_body.messages.findLast((message) => message.role === "scope_update");
  delete scope.blocks[0].content.context.interaction_state;
  writeJsonl(file, rows);
  assert.throws(() => verifyPendingBatch(dir), /scope facts/);
});

test("followup 请求额外注入没有 canonical 来源的 assistant 历史不能通过", (t) => {
  const dir = batchCopy(t);
  const file = path.join(dir, "llm-calls", "calls.jsonl");
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  rows.at(-1).request_body.messages.push({
    role: "assistant",
    provenance: "model",
    blocks: [{ type: "text", text: "旧工具调用历史" }],
    source_refs: [],
    versions: {},
  });
  writeJsonl(file, rows);
  assert.throws(() => verifyPendingBatch(dir), /canonical 应用来源|followup_request_is_new_boundary/);
});

test("缺失 Why 持久 replay 不能通过", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.filter((row) => !(row.direction === "http" && String(row.path).includes(`/turns/${REVISION_TURN}/replay`))));
  assert.throws(() => verifyPendingBatch(dir), /why_replay_scoped_http/);
});

test("accept 额外新增 memory/receipt 不能通过", (t) => {
  const dir = batchCopy(t);
  mutateCheckpoint(dir, "after-accept", (checkpoint) => {
    const extra = { ...checkpoint.memory_items[0], id: "66666666-6666-4666-8666-666666666666", content: "未知写入" };
    checkpoint.memory_items.push(extra);
    return checkpoint;
  });
  assert.throws(() => verifyPendingBatch(dir), /canon_accept_only_adds_bound_memory_and_receipt/);
});

test("discard 改变已采纳 memory 字节不能通过", (t) => {
  const dir = batchCopy(t);
  mutateCheckpoint(dir, "after-discard", (checkpoint) => {
    checkpoint.memory_items[0].content = "被改写的已采纳内容";
    return checkpoint;
  });
  assert.throws(() => verifyPendingBatch(dir), /canon_discard_only_adds_bound_source_receipt/);
});

test("revision 额外 item 不能靠部分匹配通过", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] !== "turn_result") return row;
      const body = row.frame[4];
      if (body?.turn_id !== REVISION_TURN) return row;
      const artifact = body.adoption_state.pending[0];
      artifact.payload.items.push({
        ...artifact.payload.items[0],
        item_id: "revision-item-extra",
      });
      artifact.payload.item_count = 2;
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /revision_writer_bytes_exact|item 必须恰好一条/);
});

test("未知 canon 列变化不能被 restore/final 的 0 写入签名掩盖", (t) => {
  const dir = batchCopy(t);
  mutateCheckpoint(dir, "after-restore", (checkpoint) => {
    const hash = "0000000000000000000000000000000000000000000000000000000000000000";
    checkpoint.canon.tables.ledger_entries.rows_sha256 = hash;
    checkpoint.canon.tables.ledger_entries.canon_sha256 = hash;
    return checkpoint;
  });
  assert.throws(() => verifyPendingBatch(dir), /canon_restore_writes_nothing/);
});

test("source 作者原文字节被模型改写不能通过", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] !== "turn_result") return row;
      const body = row.frame[4];
      if (body?.turn_id !== SOURCE_TURN) return row;
      body.adoption_state.pending[0].payload.items[0].body = "模型改写的原文";
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /source_source_bytes_exact/);
});

function mutateHttp(dir, fn) {
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => (row.direction === "http" ? (fn(row) ?? row) : row)));
}

test("restore resume 错 work 不能通过", (t) => {
  const dir = batchCopy(t);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    row.body.work.id = "99999999-9999-4999-8999-999999999999";
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /resume_body_scope_same_work_session/);
});

test("restore resume 错 session 不能通过", (t) => {
  const dir = batchCopy(t);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    row.body.active_session.id = "99999999-9999-4999-8999-999999999999";
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /resume_body_scope_same_work_session/);
});

test("restore resume 仍含 pending 不能通过", (t) => {
  const dir = batchCopy(t);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    row.body.pending_adoptions = [{ artifact_id: REVISION_ID, adoption_status: "TENTATIVE" }];
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /resume_projection_pending_empty/);
});

test("restore resume 缺失 pending 字段不能当成已证空", (t) => {
  for (const field of [
    "pending_adoptions",
    "inbox_pending_adoptions",
    "pending_adoption_turn_results",
    "inbox_pending_adoption_turn_results",
  ]) {
    const dir = batchCopy(t);
    mutateHttp(dir, (row) => {
      if (!String(row.path).includes("/sessions/resume")) return row;
      delete row.body[field];
      return row;
    });
    assert.throws(() => verifyPendingBatch(dir), /resume_projection_pending_empty/);
  }
});

test("restore resume pending 字段非数组不能通过", (t) => {
  for (const field of [
    "pending_adoptions",
    "inbox_pending_adoptions",
    "pending_adoption_turn_results",
    "inbox_pending_adoption_turn_results",
  ]) {
    const dir = batchCopy(t);
    mutateHttp(dir, (row) => {
      if (!String(row.path).includes("/sessions/resume")) return row;
      row.body[field] = {};
      return row;
    });
    assert.throws(() => verifyPendingBatch(dir), /resume_projection_pending_empty/);
  }
});

test("restore resume 缺 inbox_resolved_adoptions 不能借用 session resolved", (t) => {
  const dir = batchCopy(t);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    delete row.body.inbox_resolved_adoptions;
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /resume_projection_resolved_count_exact/);
});

test("restore resume revision_of 双别名冲突不能通过", (t) => {
  const dir = batchCopy(t);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    for (const entries of [row.body.resolved_adoptions, row.body.inbox_resolved_adoptions]) {
      const revision = entries.find((entry) => entry.artifact_id === REVISION_ID);
      revision.payload.items[0].revision_of = "as-conflict";
    }
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /resume_projection_revision_accepted/);
});

test("restore resume 响应缺失不能通过", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.filter((row) => !(row.direction === "http" && String(row.path).includes("/sessions/resume"))));
  assert.throws(() => verifyPendingBatch(dir), /restore_resume_http/);
});

test("restore resume 截断不能通过", (t) => {
  const dir = batchCopy(t);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    row.body = null;
    row.body_state = { ...row.body_state, complete: false, json: "aborted", truncated: true };
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /restore_resume_http/);
});

test("restore resume 仅 status 200 不能通过", (t) => {
  const dir = batchCopy(t);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    return {
      at: row.at,
      direction: "http",
      method: "GET",
      path: row.path,
      status: 200,
    };
  });
  assert.throws(() => verifyPendingBatch(dir), /restore_resume_http/);
});

test("followup 缺持久 decision trace 不能通过", (t) => {
  const dir = batchCopy(t);
  const db = openDb(dir);
  try {
    dbExec(db, "DELETE FROM decision_traces WHERE turn_id = ?", [FOLLOWUP_TURN]);
  } finally {
    db.close();
  }
  assert.throws(() => verifyPendingBatch(dir), /followup_decision_trace_present/);
});

test("源运行 authority_scope 缺失事实自然失败", (t) => {
  // 这些形状在真实 producer 不会出现；不为其扩展产品拦截，只证明 reader 不会假绿。
  assertAuthorityRejected(t, null);
  assertAuthorityRejected(t, "null");
  assertAuthorityRejected(t, "[]");
  assertAuthorityRejected(t, "{");
});

test("源运行 authority profile 错绑不能通过", (t) => {
  assertAuthorityRejected(
    t,
    JSON.stringify(authorityOf({ profile_selection: { profile_ref: "other_profile" } })),
    /source_profile_bound/,
  );
});

test("源运行 production_write=true 不能通过", (t) => {
  assertAuthorityRejected(
    t,
    JSON.stringify(authorityOf({ production_write: true })),
    /source_production_write_disabled/,
  );
});

test("源运行写工具不能通过", (t) => {
  assertAuthorityRejected(
    t,
    JSON.stringify(authorityOf({ allowed_tools: ["judgment", "production_write"] })),
    /source_no_adopt_tool/,
  );
});

test("followup 权限必须只允许 judgment", (t) => {
  assertAuthorityRejected(
    t,
    JSON.stringify(authorityOf({ allowed_tools: ["world_building"] })),
    /followup_judgment_only/,
    FOLLOWUP_RUN,
  );
});

test("followup 缺 trace_summary 不能借用旧 trace", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] === "turn_result" && row.frame[4]?.turn_id === FOLLOWUP_TURN) {
        delete row.frame[4].trace_summary;
      }
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /followup_decision_trace_present/);
});

test("followup 缺 assistant_message 不能通过", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] === "turn_result" && row.frame[4]?.turn_id === FOLLOWUP_TURN) {
        delete row.frame[4].assistant_message;
      }
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /followup_reply_visible/);
});

test("三轮当前作者来源逐条绑定，原文或 author_input 引用改写不能借历史通过", (t) => {
  for (const [label, runId, turnId] of [
    ["source", SOURCE_RUN, SOURCE_TURN], ["revision", REVISION_RUN, REVISION_TURN],
    ["followup", FOLLOWUP_RUN, FOLLOWUP_TURN],
  ]) {
    for (const field of ["source_refs", "text"]) {
      const dir = batchCopy(t), db = openDb(dir);
      const change = message => {
        if (message.role !== "user" || message.provenance !== "author" ||
            !message.source_refs?.includes(`author_input:${turnId}`)) return;
        if (field === "source_refs") message.source_refs = ["author_input:another-turn"];
        else message.blocks[0].text += "（追加）";
      };
      try {
        const rows = db.prepare("SELECT id, message FROM authoring_session_messages WHERE run_id = ?").all(runId);
        for (const row of rows) {
          const message = JSON.parse(row.message);
          change(message);
          db.prepare("UPDATE authoring_session_messages SET message = ? WHERE id = ?")
            .run(JSON.stringify(message), row.id);
        }
      } finally { db.close(); }
      // 同步篡改 request 与 canonical，保留序列可配对，专门检验独立 WS 作者原文/父轮来源。
      mutateJsonl(path.join(dir, "llm-calls", "calls.jsonl"), rows => rows.map(row => {
        row.request_body.messages.forEach(change);
        return row;
      }));
      assert.throws(() => verifyPendingBatch(dir), new RegExp(`${label}_author_input_bound`));
    }
  }
});

test("第四条自动补答即使三个指定 run 都成功也不能通过", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), rows => {
    const extra = structuredClone(rows.find(row => row.direction === "sent" && row.frame?.[3] === "user_message"));
    extra.frame[1] = "req-auto-answer";
    extra.frame[4].text = "继续";
    extra.frame[4].turn_id = "turn-auto-answer";
    rows.push(extra);
    return rows;
  });
  assert.throws(() => verifyPendingBatch(dir), /只允许冻结的三条作者输入/);
});

test("followup 可保留历史并在当前 run 先只读探索再回复，两次真实请求逐次核 Scope", async () => {
  const dir = await buildBatch(runScope.workDir, { followupAction: "explore" });
  const result = verifyPendingBatch(dir);
  assert.equal(result.checks.followup_request_is_new_boundary, true);
  assert.equal(result.checks.followup_reply_exact_provider, true);
  assert.equal(result.measured.followup_scope.request_count, 2);
  assert.equal(result.measured.provider_calls.followup.provider_runs, 2);
});

test("相同历史在当前 followup 重新 execute 必须拒绝，不能借旧轮工具合法性", async () => {
  const dir = await buildBatch(runScope.workDir, { followupAction: "execute" });
  assert.throws(() => verifyPendingBatch(dir), /followup_request_is_new_boundary/);
});

test("两次 followup 请求中任一次 Scope 缺失均不能借另一调用的合法 Scope", async () => {
  const dir = await buildBatch(runScope.workDir, { followupAction: "explore" });
  mutateJsonl(path.join(dir, "llm-calls", "calls.jsonl"), records => {
    const record = records.find(row => row.provider_call_ref === "pcall-followup-explore");
    record.request_body.messages.findLast(message => message.role === "scope_update")
      .blocks[0].content.context.interaction_state = null;
    return records;
  });
  assert.throws(() => verifyPendingBatch(dir), /scope facts/);
});

test("三轮之外的额外模型调用不能从 pending 本批调用账中消失", (t) => {
  const dir = batchCopy(t);
  mutateJsonl(path.join(dir, "llm-calls", "calls.jsonl"), records => {
    records.push({ ...structuredClone(records[0]), provider_call_ref: "pcall-extra",
      provider_run_ref: "prun-extra", agent_run_id: "run-extra", turn_id: "turn-extra" });
    return records;
  });
  assert.throws(() => verifyPendingBatch(dir), /pending_all_calls_accounted/);
});
