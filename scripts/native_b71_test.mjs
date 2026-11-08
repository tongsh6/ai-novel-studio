// B71 修订场景的 Node 正反例：真实临时 SQLite + 真实 WS 帧形状，走
// scripts/native_b71_evidence.mjs 的完整 revision verifier 入口。
// 本测试不启动 GUI/Mix、不写产品路径，只证明验收器不会把错绑/缺 pair/
// 未闭合 validation/字节篡改/自动采纳等情况判成通过。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  APP_BUNDLE,
  NATIVE_DRIVER,
  productionFingerprint,
} from "./lib/native_ui/scenario_evidence.mjs";
import { buildAuthoringCanonSnapshot } from "./lib/native_ui/authoring_canon_evidence.mjs";
import {
  REVISION_PROFILE,
  SOURCE_PROFILE,
  authorActionAck,
  chapterDraftTarget,
  outsideEvidencePreserved,
} from "./lib/native_ui/authoring_revision_evidence.mjs";
import { main } from "./native_b71_evidence.mjs";
// Why 面板文案直接消费前端 SSOT，避免正例 fixture 与产品 copy 漂移（Node 24 原生剥离类型）。
import { TRACE as COPY_TRACE } from "../frontend/src/lib/copy.ts";

import { irBodyFromWire } from "./lib/native_ui/fixtures/authoring_request_ir.mjs";
const WORK = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const MEMORY = "44444444-4444-4444-8444-444444444444";
const USER_TURN = "turn-user-revision";
const SOURCE_TURN = "turn-source-revision";
const CHILD_TURN = "turn-child-revision";
const SOURCE_RUN = "run-source-revision";
const CHILD_RUN = "run-child-revision";
const RECEIPT = "receipt-revision";
const TRACE = "trace-revision";
const CHAPTER_TITLE = "第02章：矿区追击战";
const CHAPTER_BRIEF = `${CHAPTER_TITLE}。本章方向：短促的动作追击。`;
// WorkspaceChat.onDraftChapter 的真实可见命令模板；source 合成不得再写旁路假文本。
const SOURCE_MESSAGE = `请根据已采纳章节计划生成${CHAPTER_BRIEF}正文草稿，保持为待采纳草稿。`;
const ORIGINAL_BODY = "他猛地侧身。\n他一刀劈下。\n他反手格挡。\n他迈步逼近。\n他咬住暗号继续逼近。";
const REVISED_BODY = "他侧身避开巡檢傀儡的第一击，退路在矿道尽头收窄。\n他反手格挡，借力滚进黑暗。\n他迈步逼近。\n他咬住暗号继续逼近。";
const ITEM_ID = "revision-item-1";
const FINDING_ID = "qf_slice_action_rhythm";

function iso(offsetMs) {
  return new Date(BASE_AT + offsetMs).toISOString();
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
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

function assistant(pcall, prun, callId, name, args) {
  return {
    role: "assistant",
    provenance: "model",
    provider_call_ref: pcall,
    provider_run_ref: prun,
    blocks: [{ type: "tool_call", call_id: callId, name, arguments: args }],
  };
}

function validation(callId, status, reasonCode) {
  return {
    role: "tool",
    provenance: "tool_result",
    source_refs: [],
    versions: {},
    blocks: [{ type: "validation_result", call_id: callId, status, reason_code: reasonCode }],
  };
}

function pendingArtifact(artifactId, item, extra = {}) {
  return {
    artifact_id: artifactId,
    artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE",
    requires_adoption: true,
    source_tool_result_ref: "tool-result-1",
    authoring_intent: null,
    target_chapter: CHAPTER_TITLE,
    target_chapter_ref: "chapter:chapter-2",
    payload: { items: [item], item_count: 1, title: `${CHAPTER_TITLE}正文草稿` },
    ...extra,
  };
}

function wireFrame(direction, at, frame) {
  return { direction, at, frame };
}

const BASE_AT = Date.now() - 30 * 60 * 1000;

const SEGMENT_VERSION = "authoring-run-segment/v1";

// B81 CP1：canonical 历史 = run 执行段头 + 会话消息行（不再有 run 私有列）。
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
  db.prepare("INSERT INTO authoring_run_segments (run_id, header, message_count) VALUES (?, ?, ?)").run(
    runId,
    JSON.stringify(header),
    transcript.messages.length,
  );
  transcript.messages.forEach((message, index) => {
    db.prepare(
      "INSERT INTO authoring_session_messages (run_id, sequence, run_sequence, message, format_version) VALUES (?, ?, ?, ?, ?)",
    ).run(runId, index + 1, index + 1, JSON.stringify(message), "authoring-session-message/v1");
  });
}

function createDatabase(dir, childTranscript, sourceTranscript, revisionItem, overrides = {}) {
  const dbFile = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT,
      parent_turn_ref TEXT, origin_frame_ref TEXT, run_mode TEXT, profile_ref TEXT,
      status TEXT, phase TEXT, goal TEXT, goal_version INTEGER, plan TEXT, plan_ref TEXT,
      plan_version INTEGER, run_policy TEXT, authority_scope TEXT, budget TEXT,
      consumed_budget TEXT, current_step_ref TEXT, completed_step_refs TEXT,
      pending_artifact_refs TEXT, active_behavior_ref TEXT, interrupt_state TEXT,
      long_run_task_ref TEXT, failure_ref TEXT, completed_at TEXT, inserted_at TEXT,
      updated_at TEXT, trigger TEXT
    );
    CREATE TABLE authoring_run_segments (
      run_id TEXT PRIMARY KEY, header TEXT, message_count INTEGER
    );
    CREATE TABLE authoring_session_messages (
      run_id TEXT, sequence INTEGER, run_sequence INTEGER, message TEXT, format_version TEXT
    );
    CREATE TABLE provider_runs (
      id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT,
      workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT,
      step_id TEXT, purpose TEXT, execution_mode TEXT, status TEXT, provider_id TEXT,
      model TEXT, owner_refs TEXT, metadata TEXT, started_at TEXT, completed_at TEXT,
      inserted_at TEXT, updated_at TEXT
    );
    CREATE TABLE author_action_receipts (
      id TEXT PRIMARY KEY, work_id TEXT, session_id TEXT, source_turn_ref TEXT,
      action_id TEXT, action_type TEXT, idempotency_key TEXT, status TEXT,
      result TEXT, inserted_at TEXT, updated_at TEXT
    );
    CREATE TABLE interactions (
      id TEXT PRIMARY KEY, workspace_id TEXT, turn_id TEXT, role TEXT, content TEXT,
      memory_class TEXT, retention_tier TEXT, source_type TEXT, inserted_at TEXT,
      updated_at TEXT, source_ref TEXT, scope_ref TEXT, freshness_score REAL,
      importance_score REAL, replayable INTEGER, retrievable INTEGER, session_id TEXT
    );
    CREATE TABLE decision_traces (
      id TEXT PRIMARY KEY, workspace_id TEXT, trace_id TEXT, turn_id TEXT, frame_ref TEXT,
      decision_type TEXT, no_tool_reason TEXT, no_behavior_reason TEXT, no_write_reason TEXT,
      turn_result_ref TEXT, replay_policy TEXT, redaction_level TEXT, event_order TEXT,
      context_refs TEXT, inserted_at TEXT, updated_at TEXT, session_id TEXT,
      tool_trace_refs TEXT, behavior_trace_refs TEXT, state_trace_refs TEXT, plan_ref TEXT,
      gate_order_version TEXT, gate_result_refs TEXT
    );
    CREATE TABLE works (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE work_sessions (id TEXT PRIMARY KEY);
    CREATE TABLE drafts (id TEXT PRIMARY KEY);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE volumes (id TEXT PRIMARY KEY);
    CREATE TABLE scenes (id TEXT PRIMARY KEY);
    CREATE TABLE characters (id TEXT PRIMARY KEY);
    CREATE TABLE memory_items (
      id TEXT PRIMARY KEY, work_id TEXT, reference_count INTEGER, last_referenced_at TEXT
    );
    CREATE TABLE ledger_entries (id TEXT PRIMARY KEY);
    CREATE TABLE memory_reference_logs (
      id TEXT PRIMARY KEY, memory_id TEXT, work_id TEXT, task_id TEXT,
      conversation_id TEXT, reference_scene TEXT, reference_reason TEXT, inserted_at TEXT
    );
    CREATE TABLE long_run_tasks (id TEXT PRIMARY KEY);
  `);

  const run = (extra) => ({
    workspace_id: WORKSPACE,
    work_id: WORK,
    session_id: SESSION,
    origin_frame_ref: null,
    phase: "completed",
    goal: "{}",
    goal_version: 1,
    plan: "{}",
    plan_ref: null,
    plan_version: 1,
    run_policy: "{}",
    authority_scope: "{}",
    budget: "{}",
    current_step_ref: null,
    completed_step_refs: "[]",
    pending_artifact_refs: "[]",
    active_behavior_ref: null,
    interrupt_state: "{}",
    long_run_task_ref: null,
    failure_ref: null,
    completed_at: iso(0),
    inserted_at: iso(0),
    updated_at: iso(0),
    ...extra,
  });
  const insert = (table, row) => {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
      .run(...keys.map((key) => row[key]));
  };
  insert("works", { id: WORK, title: "质量修订真实原生验收" });
  insert("workspaces", { id: WORKSPACE });
  insert("work_sessions", { id: SESSION });
  insert("chapters", { id: "chapter-2", title: CHAPTER_TITLE });
  insert("memory_items", { id: MEMORY, work_id: WORK, reference_count: 0, last_referenced_at: null });
  insert("agent_runs", run({
    id: SOURCE_RUN,
    parent_turn_ref: USER_TURN,
    run_mode: "bounded",
    profile_ref: SOURCE_PROFILE,
    status: "completed",
    authority_scope: JSON.stringify({ allowed_tools: ["prose_writing", "chapter_read"] }),
    consumed_budget: JSON.stringify({ provider_calls: 1 }),
  }));
  insertCanonicalSegment(db, SOURCE_RUN, sourceTranscript);
  insert("agent_runs", run({
    id: CHILD_RUN,
    parent_turn_ref: SOURCE_TURN,
    run_mode: "bounded",
    profile_ref: REVISION_PROFILE,
    status: "completed",
    authority_scope: JSON.stringify({ allowed_tools: ["prose_writing"] }),
    consumed_budget: JSON.stringify({ provider_calls: 2, tool_calls: 1, steps: 4 }),
  }));
  insertCanonicalSegment(db, CHILD_RUN, childTranscript);
  insert("provider_runs", {
    id: "prun-source", provider_call_ref: "pcall-source", agent_run_id: SOURCE_RUN,
    workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION, parent_turn_ref: USER_TURN,
    status: "completed",
  });
  insert("provider_runs", {
    id: "prun-1", provider_call_ref: "pcall-1", agent_run_id: CHILD_RUN,
    workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION, parent_turn_ref: SOURCE_TURN,
    status: "completed",
  });
  insert("provider_runs", {
    id: "prun-2", provider_call_ref: "pcall-2", agent_run_id: CHILD_RUN,
    workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION, parent_turn_ref: SOURCE_TURN,
    status: "completed",
  });
  insert("author_action_receipts", {
    id: RECEIPT, work_id: WORK, session_id: SESSION, source_turn_ref: SOURCE_TURN,
    action_id: "revise_from_findings:as-original", action_type: "revise_from_findings",
    idempotency_key: "idem-1", status: "running",
    result: JSON.stringify({ admission_version: 2, run_id: CHILD_RUN, receipt_id: RECEIPT, status: "running", source_turn_ref: SOURCE_TURN, target_artifact_ref: "as-original" }),
    inserted_at: iso(0), updated_at: iso(0),
  });
  insert("interactions", {
    id: "interaction-source", workspace_id: WORK, turn_id: SOURCE_TURN, role: "assistant",
    content: JSON.stringify({ agent_run_id: SOURCE_RUN, text: "源正文已生成。", turn_result: { turn_id: SOURCE_TURN, adoption_state: { pending: [overrides.sourceArtifact], resolved: [] } } }),
    session_id: SESSION, inserted_at: iso(0), updated_at: iso(0),
  });
  insert("interactions", {
    id: "interaction-child", workspace_id: WORK, turn_id: CHILD_TURN, role: "assistant",
    content: JSON.stringify({ agent_run_id: CHILD_RUN, text: "修订候选已生成。", turn_result: { turn_id: CHILD_TURN, adoption_state: { pending: [overrides.revisionArtifact], resolved: [] }, trace_summary: { trace_ref: TRACE, decision_ref: "decision-child", tool_result_id: "tool-result-child" } } }),
    session_id: SESSION, inserted_at: iso(0), updated_at: iso(0),
  });
  insert("decision_traces", {
    id: "trace-row", workspace_id: WORK, trace_id: TRACE, turn_id: CHILD_TURN,
    decision_type: "revise_from_findings", inserted_at: iso(0), updated_at: iso(0), session_id: SESSION,
  });
  db.close();
}

function canonSnapshot(at, withReceipt) {
  const tables = {
    works: [{ id: WORK }],
    drafts: [],
    chapters: [{
      id: "chapter-2",
      work_id: WORK,
      volume_id: null,
      title: CHAPTER_TITLE,
      seq: 2,
      status: "PLANNED",
      inserted_at: iso(0),
      updated_at: iso(0),
      summary: "本章方向：短促的动作追击。",
      plan_direction: JSON.stringify({ chapter_role: "动作章" }),
    }],
    volumes: [],
    scenes: [],
    characters: [],
    memory_items: [{ id: MEMORY, work_id: WORK, reference_count: 0, last_referenced_at: null }],
    ledger_entries: [],
    author_action_receipts: withReceipt ? [{ id: RECEIPT }] : [],
  };
  return buildAuthoringCanonSnapshot({ tables, referenceLogs: [], at });
}

function buildBatch(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-revision-"));
  const sourceItem = {
    item_id: "source-item-1",
    title: "第02章：矿区追击战正文草稿",
    body: ORIGINAL_BODY,
    rationale: "根据已采纳章节计划生成待确认创作素材，未写入作品事实。",
  };
  const revisionItem = {
    item_id: ITEM_ID,
    title: "第02章：矿区追击战修订稿",
    body: REVISED_BODY,
    rationale: "按质量发现只调整动作句段，原稿保留。",
  };
  const sourceArtifact = pendingArtifact("as-original", sourceItem);
  const revisionArtifact = pendingArtifact("as-revision", revisionItem, {
    revision_of: "as-original",
  });
  const sourceMessages = [
    { role: "system", blocks: [{ type: "text", text: "source" }] },
    assistant("pcall-source", "prun-source", "call-source", "submit_tentative_artifact", { items: [sourceItem] }),
  ];
  const childMessages = [
    { role: "system", blocks: [{ type: "text", text: "system" }] },
    { role: "application_base", blocks: [{ type: "text", text: "revision" }] },
    assistant("pcall-1", "prun-1", "call-1", "submit_tentative_artifact", {}),
    validation("call-1", "failed", "invalid_items"),
    assistant("pcall-2", "prun-2", "call-2", "submit_tentative_artifact", { items: [revisionItem] }),
    validation("call-2", "passed", "tentative_artifact_validated"),
  ];
  createDatabase(dir, transcript({
    run_id: CHILD_RUN, workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION, parent_turn_ref: SOURCE_TURN,
  }, childMessages), transcript({
    run_id: SOURCE_RUN, workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION, parent_turn_ref: USER_TURN,
  }, sourceMessages), revisionItem, { sourceArtifact, revisionArtifact });

  const readyAt = iso(0);
  writeJson(path.join(dir, "native-driver-ready.json"), {
    run_ref: "run-ref-revision",
    driver: "external-system-ui",
    browser_driver_started: false,
    app_path: "/tmp/AI Novel Studio.app",
    bundle_identifier: APP_BUNDLE,
    provider: "slice_verify",
    slice_id: "b71-authoring-revision",
    ready_at: readyAt,
  });
  for (const name of ["01-workbench", "02-quality", "03-revision", "04-why"]) jpeg(path.join(dir, `${name}.jpg`));
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: "run-ref-revision",
    driver: NATIVE_DRIVER,
    app_bundle: APP_BUNDLE,
    screenshots: ["01-workbench.jpg", "02-quality.jpg", "03-revision.jpg", "04-why.jpg"],
    scope: "b71-authoring-revision",
  });
  fs.writeFileSync(path.join(dir, "02-quality.text.txt"), [
    "质量复核：发现 1 项可改进问题", "原句", "位置 · 第 1–3 句", "判断理由", "影响范围 · 局部", "置信度 88%", "局部修订所选问题",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "03-revision.text.txt"), "原稿\n保存原稿\n修订稿\n保存修订稿\n放弃修订稿");
  fs.writeFileSync(path.join(dir, "04-why.text.txt"), [
    COPY_TRACE.replayComplete,
    COPY_TRACE.replayNoProvider,
    "参考来源",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "seed.log"), `[seed] work_id=${WORK} session_id=${SESSION}\n`);
  writeJson(path.join(dir, "native-b71-config.json"), {
    slice_id: "b71-authoring-revision",
    journey: "revision",
    target: { work_id: WORK, work_title: "质量修订真实原生验收" },
    message: "",
    chapter_title: CHAPTER_TITLE,
  });

  const commands = [];
  const waits = [];
  const kinds = ["maintenance", "input", "ack", "turn", "maintenance", "input", "ack", "turn", "input", "turn"];
  kinds.forEach((kind, index) => {
    const id = `wait-${index}`;
    commands.push({ op: "begin", id, kind, at: BASE_AT + index });
    commands.push({ op: "finish", id, kind, at: BASE_AT + index + 1 });
    waits.push({ event: "wait_start", kind, at: BASE_AT + index });
    waits.push({ event: "wait_end", kind, ended_at: BASE_AT + index + 1 });
  });
  writeJsonl(path.join(dir, "native-driver-commands.jsonl"), commands);
  writeJsonl(path.join(dir, "wait-events.jsonl"), waits);
  writeJson(path.join(dir, "wait-stats.json"), { active: null, completed: waits.length / 2 });
  writeJsonl(path.join(dir, "heartbeat.jsonl"), [{ at: iso(0) }]);

  const appRecords = [1, 2, 3].map((n) => ({
    event: "provider_gateway.complete.start", provider: "slice_verify", timestamp: iso(n * 1000),
  }));
  fs.mkdirSync(path.join(dir, "app-log"), { recursive: true });
  writeJsonl(path.join(dir, "app-log", "2026-11-02.jsonl"), appRecords);
  const firstRequest = [
    { role: "system", content: "system" },
    { role: "application_base", content: `原正文：\n${ORIGINAL_BODY}\n[质量修订要求]\n只改命中句段，让动作在风险、后果或视角上形成递进。` },
  ];
  const failedTool = {
    role: "tool", tool_call_id: "call-1", content: JSON.stringify({ type: "validation_result", call_id: "call-1", status: "failed", reason_code: "invalid_items" }),
  };
  const llm = [
    {
      provider: "slice_verify", ts: iso(1), provider_call_ref: "pcall-source", provider_run_ref: "prun-source",
      work_id: WORK, session_id: SESSION, turn_id: USER_TURN,
      request_format: "authoring-request-ir/v1", response_format: "fixture_provider_result/v1",
      request_body: irBodyFromWire({ messages: [{ role: "user", content: "source" }] }),
      response: { status: "ok", body: { content: "", tool_calls: [{ id: "call-source", name: "submit_tentative_artifact", arguments: { items: [sourceItem] } }] } },
    },
    {
      provider: "slice_verify", ts: iso(2), provider_call_ref: "pcall-1", provider_run_ref: "prun-1",
      work_id: WORK, session_id: SESSION, turn_id: SOURCE_TURN,
      request_format: "authoring-request-ir/v1", response_format: "fixture_provider_result/v1",
      request_body: irBodyFromWire({ messages: firstRequest }),
      response: { status: "ok", body: { content: "", tool_calls: [{ id: "call-1", name: "submit_tentative_artifact", arguments: {} }] } },
    },
    {
      provider: "slice_verify", ts: iso(3), provider_call_ref: "pcall-2", provider_run_ref: "prun-2",
      work_id: WORK, session_id: SESSION, turn_id: SOURCE_TURN,
      request_format: "authoring-request-ir/v1", response_format: "fixture_provider_result/v1",
      request_body: irBodyFromWire({
        messages: [
          ...firstRequest,
          { role: "assistant", content: "", tool_calls: [{ id: "call-1", type: "function", function: { name: "submit_tentative_artifact", arguments: "{}" } }] },
          failedTool,
        ],
        tool_choice: { type: "function", function: { name: "submit_tentative_artifact" } },
      }),
      response: { status: "ok", body: { content: "", tool_calls: [{ id: "call-2", name: "submit_tentative_artifact", arguments: { items: [revisionItem] } }] } },
    },
  ];
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });
  writeJsonl(path.join(dir, "llm-calls", "2026-11-02.jsonl"), llm);

  const finding = {
    quality_finding_id: FINDING_ID,
    revision_scope: "local",
    impact_scope: "local",
    evidence_spans: [{ text: "他猛地侧身。\n他一刀劈下。\n他反手格挡。", sentence_start: 1, sentence_end: 3 }],
    suggested_revision: { instruction: "只改命中句段，让动作在风险、后果或视角上形成递进。" },
    confidence: 0.88,
  };
  const actionPayload = { quality_finding_refs: [FINDING_ID] };
  const sourceResult = {
    turn_id: SOURCE_TURN,
    status: "conversational",
    phase: "completed",
    agent_run: { run_id: SOURCE_RUN, status: "completed", run_mode: "bounded", profile_ref: SOURCE_PROFILE, parent_turn_ref: USER_TURN },
    adoption_state: { pending: [sourceArtifact], resolved: [] },
    quality_review: { review_status: "completed", findings: [finding] },
    available_actions: [{ action_type: "revise_from_findings", target_ref: "as-original", source_turn_ref: SOURCE_TURN, quality_finding_refs: [FINDING_ID] }],
    truthfulness: { artifact_adopted: false, production_write_performed: false },
  };
  const childResult = {
    turn_id: CHILD_TURN,
    status: "conversational",
    phase: "completed",
    agent_run: { run_id: CHILD_RUN, status: "completed", run_mode: "bounded", profile_ref: REVISION_PROFILE, parent_turn_ref: SOURCE_TURN, trigger: { kind: "author_action", receipt_id: RECEIPT, source_turn_ref: SOURCE_TURN, target_artifact_ref: "as-original", quality_finding_refs: [FINDING_ID] } },
    adoption_state: { pending: [revisionArtifact], resolved: [] },
    available_actions: [
      { action_type: "accept", target_ref: "as-revision" },
      { action_type: "discard", target_ref: "as-revision" },
    ],
    trace_summary: { trace_ref: TRACE, decision_ref: "decision-child", tool_result_id: "tool-result-child", revision_base: "as-original", revision_artifact_ref: "as-revision", revision_provider_call_ref: "pcall-2", quality_finding_refs: [FINDING_ID] },
    truthfulness: { artifact_adopted: false, production_write_performed: false },
    assistant_message: { text: "已生成修订草稿。" },
  };
  const childState = {
    run_id: CHILD_RUN, status: "completed", phase: "completed",
    workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION, parent_turn_ref: SOURCE_TURN,
    run_mode: "bounded", profile_ref: REVISION_PROFILE,
    trigger: { kind: "author_action", receipt_id: RECEIPT, source_turn_ref: SOURCE_TURN, target_artifact_ref: "as-original", quality_finding_refs: [FINDING_ID] },
  };
  const actionResult = {
    status: "running", run_id: CHILD_RUN, receipt_id: RECEIPT, source_turn_ref: SOURCE_TURN,
    target_artifact_ref: "as-original", run_mode: "bounded", profile_ref: REVISION_PROFILE,
  };
  const topic = `workspace:${WORKSPACE}`;
  const action = {
    action_id: "revise_from_findings:as-original",
    action_type: "revise_from_findings",
    source_turn_ref: SOURCE_TURN,
    target_ref: "as-original",
    payload: actionPayload,
  };
  const wire = [
    wireFrame("sent", iso(-1000), ["join-1", "join-1", topic, "phx_join", { work_id: WORK, session_id: SESSION }]),
    wireFrame("received", iso(-900), ["join-1", "join-1", topic, "phx_reply", { status: "ok", response: { joined: true, work_id: WORK, session_id: SESSION } }]),
    wireFrame("sent", iso(1000), ["join-1", "req-user", topic, "user_message", { text: SOURCE_MESSAGE, turn_id: USER_TURN, work_id: WORK, session_id: SESSION, generate_micro_plan: true }]),
    wireFrame("received", iso(2000), ["join-1", "req-user", topic, "phx_reply", { status: "ok", response: { turn_id: USER_TURN, run_id: SOURCE_RUN } }]),
    wireFrame("received", iso(3000), [null, null, topic, "turn_result", sourceResult]),
    wireFrame("sent", iso(4000), ["join-1", "req-action", topic, "author_action", { action }]),
    wireFrame("received", iso(5000), [null, null, topic, "action_result", actionResult]),
    wireFrame("received", iso(6000), ["join-1", "req-action", topic, "phx_reply", { status: "ok", response: { received: true, action_status: "running", run_id: CHILD_RUN, receipt_id: RECEIPT, source_turn_ref: SOURCE_TURN, target_artifact_ref: "as-original", run_mode: "bounded", profile_ref: REVISION_PROFILE } }]),
    wireFrame("received", iso(7000), [null, null, topic, "agent_run_state", childState]),
    wireFrame("received", iso(8000), [null, null, topic, "turn_result", childResult]),
    { direction: "http", status: 200, path: `/api/works/${WORK}/sessions/${SESSION}/turns/${encodeURIComponent(CHILD_TURN)}/replay`, at: iso(10_000) },
  ];
  writeJsonl(path.join(dir, "native-transport.jsonl"), wire);

  writeJson(path.join(dir, "b71-start.json"), {
    checkpoint: "start",
    db_production_counts: { works: 1, workspaces: 1, work_sessions: 1, chapters: 1, volumes: 0, scenes: 0, characters: 0, memory_items: 1, ledger_entries: 0, author_action_receipts: 0 },
    authoring_canon: canonSnapshot(iso(500), false),
  });
  writeJson(path.join(dir, "b71-before-revision.json"), {
    checkpoint: "before-revision",
    db_production_counts: { works: 1, workspaces: 1, work_sessions: 1, chapters: 1, volumes: 0, scenes: 0, characters: 0, memory_items: 1, ledger_entries: 0, author_action_receipts: 0 },
    authoring_canon: canonSnapshot(iso(3500), false),
  });
  writeJson(path.join(dir, "b71-final.json"), {
    checkpoint: "final",
    db_production_counts: { works: 1, workspaces: 1, work_sessions: 1, chapters: 1, volumes: 0, scenes: 0, characters: 0, memory_items: 1, ledger_entries: 0, author_action_receipts: 1 },
    authoring_canon: canonSnapshot(iso(20_000), true),
  });
  writeJson(path.join(dir, "b71-before-why.json"), { checkpoint: "before-why", at: iso(9000) });
  writeJson(path.join(dir, "b71-after-why.json"), { checkpoint: "after-why", at: iso(11_000) });
  writeJson(path.join(dir, "production-sources-before.json"), productionFingerprint());
  return { dir, sourceArtifact, revisionArtifact, childResult, wire, llm, revisionItem };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function mutateTransport(dir, mutate) {
  const file = path.join(dir, "native-transport.jsonl");
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
  mutate(rows);
  writeJsonl(file, rows);
}

function mutateJson(dir, name, mutate) {
  const file = path.join(dir, name);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(value);
  writeJson(file, value);
}

function mutateDb(dir, sql, params = []) {
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  db.prepare(sql).run(...params);
  db.close();
}

test("章节草稿按钮必须绑定目标章标题，不能落到后一章", () => {
  const nodes = [
    { role: "AXStaticText", value: "第01章：底层灵气账单" },
    { role: "AXButton", title: "生成正文草稿" },
    { role: "AXStaticText", value: CHAPTER_TITLE },
    { role: "AXStaticText", value: "主角在废弃矿区遭遇巡检傀儡。" },
    { role: "AXButton", title: "生成正文草稿", path: "target" },
    { role: "AXStaticText", value: "第03章：誓词回环" },
    { role: "AXButton", title: "生成正文草稿", path: "next" },
  ];
  assert.equal(chapterDraftTarget(nodes, CHAPTER_TITLE)?.path, "target");
  assert.equal(chapterDraftTarget(nodes.slice(0, 3), CHAPTER_TITLE), null);
  assert.equal(chapterDraftTarget(nodes, "第02章：另一章"), null);
});

test("author_action ACK 只接受同 join/request/topic 的唯一回复", () => {
  const actionFrame = wireFrame("sent", iso(0), ["join-1", "req-action", "workspace:w", "author_action", { action: {} }]);
  const reply = (requestRef, at) => wireFrame("received", at, ["join-1", requestRef, "workspace:w", "phx_reply", { status: "ok", response: { received: true, action_status: "running" } }]);
  assert.equal(authorActionAck([actionFrame, reply("req-action", iso(1))], actionFrame).response.action_status, "running");
  assert.throws(() => authorActionAck([actionFrame, reply("other", iso(1))], actionFrame), /唯一/);
  assert.throws(() => authorActionAck([actionFrame, reply("req-action", iso(1)), reply("req-action", iso(2))], actionFrame), /唯一/);
});

test("local 修订必须保留 evidence span 外原文前缀与后缀", () => {
  const span = {
    text: "他猛地侧身。他一刀劈下。他反手格挡。",
    sentence_start: 1,
    sentence_end: 3,
  };
  assert.equal(outsideEvidencePreserved(ORIGINAL_BODY, REVISED_BODY, [span]), true);
  assert.equal(outsideEvidencePreserved(ORIGINAL_BODY, REVISED_BODY.replace("他迈步逼近。", "他退后。"), [span]), false);
});

test("完整修订批次通过 runner 入口", async () => {
  const batch = buildBatch();
  try {
    await main(["verify", batch.dir]);
    const summary = JSON.parse(fs.readFileSync(path.join(batch.dir, "summary.json"), "utf8"));
    assert.equal(summary.all_checks_passed, true);
    assert.equal(summary.slice_id, "b71-authoring-revision");
    assert.ok(summary.checks.revision_exchange_has_exactly_two_calls);
    assert.equal(summary.measured.why.before, iso(9000));
    assert.equal(summary.measured.why.after, iso(11_000));
  } finally {
    cleanup(batch.dir);
  }
});

test("child scope 错绑必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateDb(batch.dir, "UPDATE agent_runs SET workspace_id = ? WHERE id = ?", ["workspace-other", CHILD_RUN]);
    await assert.rejects(() => main(["verify", batch.dir]), /agent_runs 精确绑定/);
  } finally {
    cleanup(batch.dir);
  }
});

test("缺 provider pair 必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateDb(batch.dir, "DELETE FROM provider_runs WHERE id = ?", ["prun-2"]);
    await assert.rejects(() => main(["verify", batch.dir]), /原生断言失败/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source 逐 call join 缺 ProviderRun pair 必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateDb(batch.dir, "DELETE FROM provider_runs WHERE id = ?", ["prun-source"]);
    await assert.rejects(() => main(["verify", batch.dir]), /source_native_call_pairs/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source consumed budget 与真实逐 call 数不一致必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateDb(batch.dir, "UPDATE agent_runs SET consumed_budget = ? WHERE id = ?", [
      JSON.stringify({ provider_calls: 2 }),
      SOURCE_RUN,
    ]);
    await assert.rejects(() => main(["verify", batch.dir]), /source_native_call_counts_match_consumed/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source/child 混淆必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "agent_run_state" && row.frame[4].run_id === CHILD_RUN) {
          row.frame[4].run_id = SOURCE_RUN;
        }
        if (row.frame?.[3] === "turn_result" && row.frame[4].agent_run?.run_id === CHILD_RUN) {
          row.frame[4].agent_run.run_id = SOURCE_RUN;
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /agent_run_state|turn_result|revision_source_result/);
  } finally {
    cleanup(batch.dir);
  }
});

test("错误或重复 ACK 必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      rows.push(wireFrame("received", iso(6500), ["join-1", "req-action", `workspace:${WORKSPACE}`, "phx_reply", { status: "ok", response: { received: true } }]));
    });
    await assert.rejects(() => main(["verify", batch.dir]), /ACK 必须唯一/);
  } finally {
    cleanup(batch.dir);
  }
});

test("没有重试/未闭合 validation 必须失败", async () => {
  const batch = buildBatch();
  try {
    const db = new DatabaseSync(path.join(batch.dir, "database", "ai_novel_studio_test.sqlite3"));
    const row = db.prepare("SELECT message FROM authoring_session_messages WHERE run_id = ? AND run_sequence = ?").get(CHILD_RUN, 4);
    const message = JSON.parse(row.message);
    message.blocks[0].status = "passed";
    db.prepare("UPDATE authoring_session_messages SET message = ? WHERE run_id = ? AND run_sequence = ?").run(
      JSON.stringify(message),
      CHILD_RUN,
      4,
    );
    db.close();
    await assert.rejects(() => main(["verify", batch.dir]), /原生断言失败/);
  } finally {
    cleanup(batch.dir);
  }
});

test("artifact 字节篡改必须失败", async () => {
  const batch = buildBatch();
  try {
    const db = new DatabaseSync(path.join(batch.dir, "database", "ai_novel_studio_test.sqlite3"));
    const row = db.prepare("SELECT content FROM interactions WHERE turn_id = ?").get(CHILD_TURN);
    const value = JSON.parse(row.content);
    value.turn_result.adoption_state.pending[0].payload.items[0].body += "篡改";
    db.prepare("UPDATE interactions SET content = ? WHERE turn_id = ?").run(JSON.stringify(value), CHILD_TURN);
    db.close();
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === CHILD_TURN) {
          row.frame[4].adoption_state.pending[0].payload.items[0].body += "篡改";
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /原生断言失败/);
  } finally {
    cleanup(batch.dir);
  }
});

test("自动采纳/自动处置必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === CHILD_TURN) {
          row.frame[4].truthfulness.artifact_adopted = true;
          row.frame[4].adoption_state.resolved = [{ artifact_id: "as-original" }];
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /原生断言失败/);
  } finally {
    cleanup(batch.dir);
  }
});


test("ACK 未确认或失败状态必须拒绝", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "phx_reply" && row.frame[1] === "req-action") {
          row.frame[4].response.received = false;
          row.frame[4].response.action_status = "failed";
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /ACK 未确认受理/);
  } finally {
    cleanup(batch.dir);
  }
});

test("自动处置 agent_event 必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      rows.push(wireFrame("received", iso(8500), [null, null, `workspace:${WORKSPACE}`, "agent_event", { run_ref: CHILD_RUN, event_type: "artifact_adopted" }]));
    });
    await assert.rejects(() => main(["verify", batch.dir]), /no_auto_decision_events/);
  } finally {
    cleanup(batch.dir);
  }
});

test("receipt 结果错绑必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateDb(batch.dir, "UPDATE author_action_receipts SET result = ? WHERE id = ?", [
      JSON.stringify({ run_id: "run-other", receipt_id: RECEIPT, status: "running" }),
      RECEIPT,
    ]);
    await assert.rejects(() => main(["verify", batch.dir]), /receipt_stable_and_persisted/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source 旁路假文本必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.direction === "sent" && row.frame?.[3] === "user_message") {
          row.frame[4].text = `${CHAPTER_TITLE}：主角在废弃矿区遭遇巡检傀儡。`;
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /revision_source_message/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source 缺 generate_micro_plan 时必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.direction === "sent" && row.frame?.[3] === "user_message") {
          delete row.frame[4].generate_micro_plan;
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /revision_source_message/);
  } finally {
    cleanup(batch.dir);
  }
});

test("跨 topic 的 action_result 必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "action_result") row.frame[2] = "workspace:foreign";
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /revision_action_result/);
  } finally {
    cleanup(batch.dir);
  }
});

test("动作前的 child turn_result 必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4]?.turn_id === CHILD_TURN) {
          row.at = iso(3500);
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /child completed turn_result 必须恰好一条，实测 0/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source finding 非 local 时不能冒充局部修订", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
          row.frame[4].quality_review.findings[0].revision_scope = "paragraph";
          row.frame[4].quality_review.findings[0].impact_scope = "paragraph";
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /不是全部 local/);
  } finally {
    cleanup(batch.dir);
  }
});

test("child 混入源 run 权限必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateDb(batch.dir, "UPDATE agent_runs SET authority_scope = ? WHERE id = ?", [
      JSON.stringify({ allowed_tools: ["prose_writing", "chapter_read"] }),
      CHILD_RUN,
    ]);
    await assert.rejects(() => main(["verify", batch.dir]), /child_authority_scope_is_revision_only/);
  } finally {
    cleanup(batch.dir);
  }
});

test("child trace/decision 缺失必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateDb(batch.dir, "DELETE FROM decision_traces WHERE trace_id = ?", [TRACE]);
    await assert.rejects(() => main(["verify", batch.dir]), /decision trace 读取/);
  } finally {
    cleanup(batch.dir);
  }
});

test("canon 额外写入必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateJson(batch.dir, "b71-final.json", (value) => {
      value.authoring_canon.tables.drafts.row_count = 1;
      value.authoring_canon.tables.drafts.rows_sha256 = "0".repeat(64);
      value.authoring_canon.tables.drafts.canon_sha256 = "0".repeat(64);
    });
    await assert.rejects(() => main(["verify", batch.dir]), /revision_canon_unchanged_except_action_receipt/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source finding 只有 impact_scope local 时仍按 local 验证", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
          delete row.frame[4].quality_review.findings[0].revision_scope;
        }
      }
    });
    await main(["verify", batch.dir]);
  } finally {
    cleanup(batch.dir);
  }
});

test("source finding 缺 quality_finding_id 时必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
          delete row.frame[4].quality_review.findings[0].quality_finding_id;
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /quality_finding_id/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source finding id 非字符串时不能冒充有效 ref", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
          row.frame[4].quality_review.findings[0].quality_finding_id = 123;
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /quality_finding_id/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source 结果错绑 parent/review/pending/action 时必须失败", async () => {
  const mutations = [
    (row) => { row.frame[4].agent_run.parent_turn_ref = "turn-other"; },
    (row) => { row.frame[4].quality_review.review_status = "pending"; },
    (row) => { row.frame[4].adoption_state.pending = []; },
    (row) => { row.frame[4].available_actions = []; },
  ];
  for (const mutate of mutations) {
    const batch = buildBatch();
    try {
      mutateTransport(batch.dir, (rows) => {
        for (const row of rows) {
          if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) mutate(row);
        }
      });
      await assert.rejects(() => main(["verify", batch.dir]), /revision_source_result/);
    } finally {
      cleanup(batch.dir);
    }
  }
});

test("source 缺 agent_run 身份时以来源错误关闭而非崩溃", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
          delete row.frame[4].agent_run;
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /revision_source_result/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source 缺 quality_review 时以来源错误关闭而非崩溃", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
          delete row.frame[4].quality_review;
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /revision_source_result/);
  } finally {
    cleanup(batch.dir);
  }
});

test("生产计数快照缺失时必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateJson(batch.dir, "b71-final.json", (value) => {
      delete value.db_production_counts;
    });
    await assert.rejects(
      () => main(["verify", batch.dir]),
      /production_counts_change_only_action_receipt/,
    );
  } finally {
    cleanup(batch.dir);
  }
});

test("action ACK 缺 receipt_id 时必须失败", async () => {
  const batch = buildBatch();
  try {
    mutateTransport(batch.dir, (rows) => {
      for (const row of rows) {
        if (row.frame?.[3] === "phx_reply" && row.frame[1] === "req-action") {
          delete row.frame[4].response.receipt_id;
        }
      }
    });
    await assert.rejects(() => main(["verify", batch.dir]), /缺 run\/receipt/);
  } finally {
    cleanup(batch.dir);
  }
});

test("source 计数快照缺任一侧时按 production_counts_unchanged 检查失败而不是崩溃", async () => {
  for (const name of ["b71-start.json", "b71-before-revision.json"]) {
    const batch = buildBatch();
    try {
      mutateJson(batch.dir, name, (value) => {
        delete value.db_production_counts;
      });
      await assert.rejects(
        () => main(["verify", batch.dir]),
        /production_counts_unchanged_through_source/,
        name,
      );
    } finally {
      cleanup(batch.dir);
    }
  }
});

test("source target_chapter_ref 缺失/非字符串/无前缀/空 id 都按来源错误关闭", async () => {
  for (const ref of [undefined, 42, "chapter", "chapter:"]) {
    const batch = buildBatch();
    try {
      mutateTransport(batch.dir, (rows) => {
        for (const row of rows) {
          if (row.frame?.[3] === "turn_result" && row.frame[4].turn_id === SOURCE_TURN) {
            const artifact = row.frame[4].adoption_state.pending[0];
            if (ref === undefined) delete artifact.target_chapter_ref;
            else artifact.target_chapter_ref = ref;
          }
        }
      });
      await assert.rejects(
        () => main(["verify", batch.dir]),
        /target_chapter_ref/,
        String(ref),
      );
    } finally {
      cleanup(batch.dir);
    }
  }
});

test("config 缺省章标题时回退真实默认章", async () => {
  const batch = buildBatch();
  try {
    mutateJson(batch.dir, "native-b71-config.json", (value) => {
      value.chapter_title = "";
    });
    await main(["verify", batch.dir]);
  } finally {
    cleanup(batch.dir);
  }
});
