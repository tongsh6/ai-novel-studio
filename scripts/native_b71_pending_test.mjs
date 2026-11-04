// B71 CP4b pending 场景的 Node 组合验证：真实临时 SQLite + 真实 WS/HTTP 帧形状 +
// 真实 capture/verify consumer。不启动 GUI/Mix，不写产品路径。
//
// 正例覆盖 source→revision→accept→discard→restore→followup 的完整证据链；负例只
// 篡改一个真实事实，证明 verifier 不会把错绑/缺 ACK/字节改变/自动写 canon/
// 旧历史重放/错 session 判成通过。
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createQuestionTransportProxy } from "./native_question_transport_proxy.mjs";
import {
  APP_BUNDLE,
  NATIVE_DRIVER,
  productionFingerprint,
} from "./lib/native_ui/scenario_evidence.mjs";
import {
  pendingSourceMessage,
} from "./lib/native_ui/authoring_pending_evidence.mjs";
import { capturePending, verifyPendingBatch } from "./lib/native_ui/authoring_pending_run_evidence.mjs";

import { irBodyFromWire } from "./lib/native_ui/fixtures/authoring_request_ir.mjs";
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
const SOURCE_BODY = pendingSourceMessage(NONCE);
const REVISION_BODY = SOURCE_BODY.replace("沈砚", "林渡");
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
    authoring_transcript: JSON.stringify({
      version: "authoring-transcript/v1",
      transcript: runTranscript,
    }),
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

function llmRecord({ pcall, prun, runId, parentTurn, promptText, response }) {
  return {
    provider: "slice_verify",
    provider_call_ref: pcall,
    provider_run_ref: prun,
    work_id: WORK,
    session_id: SESSION,
    turn_id: parentTurn,
    request_format: "authoring-request-ir/v1",
    response_format: "fixture_provider_result/v1",
    request_body: irBodyFromWire({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: promptText },
      ],
      tools: [{ name: "judgment_decision" }],
    }),
    response,
    ts: nowIso(),
    agent_run_id: runId,
  };
}

function scopeText(facts) {
  return [
    "【应用数据 · scope_update · 以最新版本为准】",
    "## 消息处置与已有产物",
    JSON.stringify(facts),
    "## 已采纳可修订对象",
    "{}",
  ].join("\n");
}

function followupFacts() {
  return {
    pending_adoptions: [],
    resolved_adoptions: [
      {
        status: "DISCARDED",
        title: SOURCE_TITLE,
        body_preview: SOURCE_BODY,
        artifact_ref: SOURCE_ID,
        revision_of: null,
      },
      {
        status: "ACCEPTED",
        title: REVISION_TITLE,
        body_preview: REVISION_BODY,
        artifact_ref: REVISION_ID,
        revision_of: SOURCE_ID,
      },
    ],
    pending_adoption_count: 0,
    resolved_adoption_count: 2,
    omitted_adoptions: 0,
  };
}

function followupReply() {
  return `当前待采纳 0 份，已处置 2 份：ACCEPTED ${REVISION_TITLE}；DISCARDED ${SOURCE_TITLE}。${REVISION_BODY}`;
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
    run_mode TEXT, profile_ref TEXT, status TEXT, authoring_transcript TEXT,
    consumed_budget TEXT, budget TEXT, authority_scope TEXT, pending_artifact_refs TEXT
  )`);
  dbExec(db, `CREATE TABLE provider_runs (
    id TEXT PRIMARY KEY, agent_run_id TEXT, workspace_id TEXT, work_id TEXT, session_id TEXT,
    parent_turn_ref TEXT, provider_call_ref TEXT, provider_id TEXT, purpose TEXT, status TEXT
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
  dbExec(db, "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, run_mode, profile_ref, status, authoring_transcript, consumed_budget, budget, authority_scope, pending_artifact_refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", Object.values(run));
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
    agent_run: { run_id: runId, status: "completed", run_mode: "bounded", profile_ref: "judgment_loop_v1" },
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

async function captureHttpFixture() {
  const server = httpFixtureServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-pending-http-"));
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

export async function buildBatch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-pending-"));
  const httpCapture = await captureHttpFixture();
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
  const sourceRequest = `gateway:source`;
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
  const sourceRun = agentRunRow(
    SOURCE_RUN,
    SOURCE_TURN,
    transcript(runIdentity(SOURCE_RUN, SOURCE_TURN), [
      assistant("pcall-source", "prun-source", "call-source", "judgment_decision", sourceResponse.body.tool_calls[0].arguments),
    ]),
    1,
    { allowed_tools: ["judgment", "world_building"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  );
  insertRunFacts(dir, {
    run: sourceRun,
    transcript: transcript(runIdentity(SOURCE_RUN, SOURCE_TURN), [
      assistant("pcall-source", "prun-source", "call-source", "judgment_decision", sourceResponse.body.tool_calls[0].arguments),
    ]),
    providerRuns: [providerRunRow("prun-source", "pcall-source", SOURCE_RUN, SOURCE_TURN, "planner")],
    records: [llmRecord({
      pcall: "pcall-source",
      prun: "prun-source",
      runId: SOURCE_RUN,
      parentTurn: SOURCE_TURN,
      promptText: SOURCE_BODY,
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
  const revisionRun = agentRunRow(
    REVISION_RUN,
    REVISION_TURN,
    transcript(runIdentity(REVISION_RUN, REVISION_TURN), [
      assistant("pcall-judgment", "prun-judgment", "call-judgment", "judgment_decision", { action: "execute", capability: "revise_pending_artifact", dialogue_goal: "只改名字", reason: "revise" }),
      toolPassed("call-judgment"),
      assistant("pcall-writer", "prun-writer", "call-writer", "submit_tentative_artifact", writerArgs),
      toolPassed("call-writer"),
    ]),
    2,
    { allowed_tools: ["judgment", "world_building"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  );
  insertRunFacts(dir, {
    run: revisionRun,
    transcript: transcript(runIdentity(REVISION_RUN, REVISION_TURN), [
      assistant("pcall-judgment", "prun-judgment", "call-judgment", "judgment_decision", { action: "execute", capability: "revise_pending_artifact", dialogue_goal: "只改名字", reason: "revise" }),
      toolPassed("call-judgment"),
      assistant("pcall-writer", "prun-writer", "call-writer", "submit_tentative_artifact", writerArgs),
      toolPassed("call-writer"),
    ]),
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
        promptText: "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。",
        response: { status: "ok", body: { content: "", tool_calls: [{ id: "call-judgment", name: "judgment_decision", arguments: { action: "execute", capability: "revise_pending_artifact", dialogue_goal: "只改名字", reason: "revise" } }] } },
      }),
      llmRecord({
        pcall: "pcall-writer",
        prun: "prun-writer",
        runId: REVISION_RUN,
        parentTurn: REVISION_TURN,
        promptText: "writer",
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
  const followupRun = agentRunRow(
    FOLLOWUP_RUN,
    FOLLOWUP_TURN,
    transcript(runIdentity(FOLLOWUP_RUN, FOLLOWUP_TURN), [
      assistant("pcall-followup", "prun-followup", null, null, null, reply),
    ]),
    1,
    { allowed_tools: ["judgment"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  );
  const followupResponse = { status: "ok", body: { content: reply, tool_calls: [] } };
  insertRunFacts(dir, {
    run: followupRun,
    transcript: transcript(runIdentity(FOLLOWUP_RUN, FOLLOWUP_TURN), [
      assistant("pcall-followup", "prun-followup", null, null, null, reply),
    ]),
    providerRuns: [providerRunRow("prun-followup", "pcall-followup", FOLLOWUP_RUN, FOLLOWUP_TURN, "planner")],
    records: [llmRecord({
      pcall: "pcall-followup",
      prun: "prun-followup",
      runId: FOLLOWUP_RUN,
      parentTurn: FOLLOWUP_TURN,
      promptText: FOLLOWUP_TEXT,
      response: followupResponse,
    })],
    authority: { allowed_tools: ["judgment"], production_write: false, profile_selection: { profile_ref: "judgment_loop_v1" } },
  });
  // 当前请求必须带真实处置 facts，且不得出现旧 assistant/tool 执行历史。
  const callFile = path.join(dir, "llm-calls", "calls.jsonl");
  const records = fs.readFileSync(callFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const last = records.at(-1);
  last.request_body = irBodyFromWire({
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: FOLLOWUP_TEXT },
      { role: "user", content: scopeText(followupFacts()) },
    ],
  });
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

function cloneBatch(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-pending-neg-"));
  fs.cpSync(source, dir, { recursive: true });
  for (const name of ["native-ws-frames.json", "native-b71-checks.json", "summary.json"]) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
  return dir;
}

function authorityOf(overrides = {}) {
  return {
    allowed_tools: ["judgment", "world_building"],
    production_write: false,
    profile_selection: { profile_ref: "judgment_loop_v1" },
    ...overrides,
  };
}

function assertAuthorityRejected(scope, pattern = undefined, runId = SOURCE_RUN) {
  const dir = cloneBatch(shared);
  const db = openDb(dir);
  dbExec(db, "UPDATE agent_runs SET authority_scope = ? WHERE id = ?", [scope, runId]);
  const row = db.prepare("SELECT authority_scope AS scope FROM agent_runs WHERE id = ?").get(runId);
  db.close();
  assert.equal(row.scope, scope);
  try {
    if (pattern === undefined) assert.throws(() => verifyPendingBatch(dir));
    else assert.throws(() => verifyPendingBatch(dir), pattern);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

let shared;

test("pending 全链正例：三 run、两稿、采纳/放弃、恢复与新请求", async () => {
  shared = await buildBatch();
  const { checks } = verifyPendingBatch(shared);
  assert.equal(checks.canon_accept_only_adds_bound_memory_and_receipt, true);
  assert.equal(checks.revision_writer_bytes_exact, true);
  assert.equal(checks.followup_reply_exact_provider, true);
  assert.equal(checks.restore_same_session, true);
  assert.equal(checks.resume_projection_pending_empty, true);
  assert.equal(checks.resume_projection_resolved_count_exact, true);
  assert.equal(checks.resume_projection_source_discarded, true);
  assert.equal(checks.resume_projection_revision_accepted, true);
  const summary = JSON.parse(fs.readFileSync(path.join(shared, "summary.json"), "utf8"));
  assert.equal(summary.slice_id, SLICE_ID);
  assert.equal(summary.all_checks_passed, true);
});

test("缺失/多义 revision ACK 不能通过", () => {
  const dir = cloneBatch(shared);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.filter((row) => !(row.frame?.[1] === "req-revision" && row.frame?.[3] === "phx_reply")));
  assert.throws(() => verifyPendingBatch(dir), /ACK 必须唯一/);
});

test("revision artifact 字节改变不能冒充同次 writer 响应", () => {
  const dir = cloneBatch(shared);
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

test("writer 应用校验 failed 不能签候选字节合法", () => {
  const dir = cloneBatch(shared);
  const db = openDb(dir);
  const row = db.prepare("SELECT authoring_transcript FROM agent_runs WHERE id = ?").get(REVISION_RUN);
  const envelope = JSON.parse(row.authoring_transcript);
  for (const message of envelope.transcript.messages) {
    for (const block of message.blocks ?? []) {
      if (block.type === "validation_result" && block.call_id === "call-writer") {
        block.status = "failed";
      }
    }
  }
  dbExec(db, "UPDATE agent_runs SET authoring_transcript = ? WHERE id = ?", [
    JSON.stringify(envelope),
    REVISION_RUN,
  ]);
  db.close();
  assert.throws(() => verifyPendingBatch(dir), /revision_writer_validation_passed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("action target/source 错绑不能通过", () => {
  const dir = cloneBatch(shared);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] === "author_action" && row.frame[4]?.action?.action_type === "accept") {
        row.frame[4].action.target_ref = SOURCE_ID;
      }
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /accept_action_ack_bound|accept_action_result_exact|author_action|冲突/);
});

test("restore 错 session 不能通过", () => {
  const dir = cloneBatch(shared);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] === "user_message" && row.frame[4]?.turn_id === FOLLOWUP_TURN) {
        row.frame[4].session_id = "99999999-9999-4999-8999-999999999999";
      }
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /session/);
});

test("followup 请求缺少真实处置状态不能通过", () => {
  const dir = cloneBatch(shared);
  const file = path.join(dir, "llm-calls", "calls.jsonl");
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const last = rows.at(-1);
  last.request_body.messages = last.request_body.messages.filter(
    (message) => !(message.blocks ?? []).some((block) => String(block.text).includes("## 消息处置与已有产物")),
  );
  writeJsonl(file, rows);
  assert.throws(() => verifyPendingBatch(dir), /scope facts/);
});

test("followup 回放旧 assistant 历史不能通过", () => {
  const dir = cloneBatch(shared);
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
  assert.throws(() => verifyPendingBatch(dir), /followup_request_is_new_boundary/);
});

test("缺失 Why 持久 replay 不能通过", () => {
  const dir = cloneBatch(shared);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.filter((row) => !(row.direction === "http" && String(row.path).includes(`/turns/${REVISION_TURN}/replay`))));
  assert.throws(() => verifyPendingBatch(dir), /why_replay_scoped_http/);
});

test("accept 额外新增 memory/receipt 不能通过", () => {
  const dir = cloneBatch(shared);
  mutateCheckpoint(dir, "after-accept", (checkpoint) => {
    const extra = { ...checkpoint.memory_items[0], id: "66666666-6666-4666-8666-666666666666", content: "未知写入" };
    checkpoint.memory_items.push(extra);
    return checkpoint;
  });
  assert.throws(() => verifyPendingBatch(dir), /canon_accept_only_adds_bound_memory_and_receipt/);
});

test("discard 改变已采纳 memory 字节不能通过", () => {
  const dir = cloneBatch(shared);
  mutateCheckpoint(dir, "after-discard", (checkpoint) => {
    checkpoint.memory_items[0].content = "被改写的已采纳内容";
    return checkpoint;
  });
  assert.throws(() => verifyPendingBatch(dir), /canon_discard_only_adds_bound_source_receipt/);
});

test("revision 额外 item 不能靠部分匹配通过", () => {
  const dir = cloneBatch(shared);
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

test("未知 canon 列变化不能被 restore/final 的 0 写入签名掩盖", () => {
  const dir = cloneBatch(shared);
  mutateCheckpoint(dir, "after-restore", (checkpoint) => {
    const hash = "0000000000000000000000000000000000000000000000000000000000000000";
    checkpoint.canon.tables.ledger_entries.rows_sha256 = hash;
    checkpoint.canon.tables.ledger_entries.canon_sha256 = hash;
    return checkpoint;
  });
  assert.throws(() => verifyPendingBatch(dir), /canon_restore_writes_nothing/);
});

test("source 作者原文字节被模型改写不能通过", () => {
  const dir = cloneBatch(shared);
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

test("restore resume 错 work 不能通过", () => {
  const dir = cloneBatch(shared);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    row.body.work.id = "99999999-9999-4999-8999-999999999999";
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /resume_body_scope_same_work_session/);
});

test("restore resume 错 session 不能通过", () => {
  const dir = cloneBatch(shared);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    row.body.active_session.id = "99999999-9999-4999-8999-999999999999";
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /resume_body_scope_same_work_session/);
});

test("restore resume 仍含 pending 不能通过", () => {
  const dir = cloneBatch(shared);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    row.body.pending_adoptions = [{ artifact_id: REVISION_ID, adoption_status: "TENTATIVE" }];
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /resume_projection_pending_empty/);
});

test("restore resume 缺失 pending 字段不能当成已证空", () => {
  for (const field of [
    "pending_adoptions",
    "inbox_pending_adoptions",
    "pending_adoption_turn_results",
    "inbox_pending_adoption_turn_results",
  ]) {
    const dir = cloneBatch(shared);
    mutateHttp(dir, (row) => {
      if (!String(row.path).includes("/sessions/resume")) return row;
      delete row.body[field];
      return row;
    });
    assert.throws(() => verifyPendingBatch(dir), /resume_projection_pending_empty/);
  }
});

test("restore resume pending 字段非数组不能通过", () => {
  for (const field of [
    "pending_adoptions",
    "inbox_pending_adoptions",
    "pending_adoption_turn_results",
    "inbox_pending_adoption_turn_results",
  ]) {
    const dir = cloneBatch(shared);
    mutateHttp(dir, (row) => {
      if (!String(row.path).includes("/sessions/resume")) return row;
      row.body[field] = {};
      return row;
    });
    assert.throws(() => verifyPendingBatch(dir), /resume_projection_pending_empty/);
  }
});

test("restore resume 缺 inbox_resolved_adoptions 不能借用 session resolved", () => {
  const dir = cloneBatch(shared);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    delete row.body.inbox_resolved_adoptions;
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /resume_projection_resolved_count_exact/);
});

test("restore resume revision_of 双别名冲突不能通过", () => {
  const dir = cloneBatch(shared);
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

test("restore resume 响应缺失不能通过", () => {
  const dir = cloneBatch(shared);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.filter((row) => !(row.direction === "http" && String(row.path).includes("/sessions/resume"))));
  assert.throws(() => verifyPendingBatch(dir), /restore_resume_http/);
});

test("restore resume 截断不能通过", () => {
  const dir = cloneBatch(shared);
  mutateHttp(dir, (row) => {
    if (!String(row.path).includes("/sessions/resume")) return row;
    row.body = null;
    row.body_state = { ...row.body_state, complete: false, json: "aborted", truncated: true };
    return row;
  });
  assert.throws(() => verifyPendingBatch(dir), /restore_resume_http/);
});

test("restore resume 仅 status 200 不能通过", () => {
  const dir = cloneBatch(shared);
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

test("followup 缺持久 decision trace 不能通过", () => {
  const dir = cloneBatch(shared);
  const db = openDb(dir);
  dbExec(db, "DELETE FROM decision_traces WHERE turn_id = ?", [FOLLOWUP_TURN]);
  db.close();
  assert.throws(() => verifyPendingBatch(dir), /followup_decision_trace_present/);
});

test("源运行 authority_scope 缺失事实自然失败", () => {
  // 这些形状在真实 producer 不会出现；不为其扩展产品拦截，只证明 reader 不会假绿。
  assertAuthorityRejected(null);
  assertAuthorityRejected("null");
  assertAuthorityRejected("[]");
  assertAuthorityRejected("{");
});

test("源运行 authority profile 错绑不能通过", () => {
  assertAuthorityRejected(
    JSON.stringify(authorityOf({ profile_selection: { profile_ref: "other_profile" } })),
    /source_profile_bound/,
  );
});

test("源运行 production_write=true 不能通过", () => {
  assertAuthorityRejected(
    JSON.stringify(authorityOf({ production_write: true })),
    /source_production_write_disabled/,
  );
});

test("源运行写工具不能通过", () => {
  assertAuthorityRejected(
    JSON.stringify(authorityOf({ allowed_tools: ["judgment", "production_write"] })),
    /source_no_adopt_tool/,
  );
});

test("followup 权限必须只允许 judgment", () => {
  assertAuthorityRejected(
    JSON.stringify(authorityOf({ allowed_tools: ["world_building"] })),
    /followup_judgment_only/,
    FOLLOWUP_RUN,
  );
});

test("followup 缺 trace_summary 不能借用旧 trace", () => {
  const dir = cloneBatch(shared);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] === "turn_result" && row.frame[4]?.turn_id === FOLLOWUP_TURN) {
        delete row.frame[4].trace_summary;
      }
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /followup_decision_trace_present/);
});

test("followup 缺 assistant_message 不能通过", () => {
  const dir = cloneBatch(shared);
  mutateJsonl(path.join(dir, "native-transport.jsonl"), (rows) =>
    rows.map((row) => {
      if (row.frame?.[3] === "turn_result" && row.frame[4]?.turn_id === FOLLOWUP_TURN) {
        delete row.frame[4].assistant_message;
      }
      return row;
    }));
  assert.throws(() => verifyPendingBatch(dir), /followup_reply_visible/);
});
