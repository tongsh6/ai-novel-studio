// B71 修订批次测试族唯一的真实文件/SQLite fixture owner。
//
// 只服务 `../../../native_b71_test.mjs`：12 表 SQLite（含 canonical 执行段/消息行、
// provider_runs、interaction 与 decision_traces）、真实 WS/HTTP 帧形状、llm-calls、
// app-log、AX/可见文本与 checkpoint 文件。DDL/seed/DELETE journal/真实 builder 与
// 纯事实源码/runtime 进入 `inputs`；连接 finally 关闭、无 -wal/-shm。
//
// canon 快照由消费者用既有纯函数合成后作为规格输入传入（本模块不 import 被测
// SUT），因此时间字段固定为历史批次值，同一规格在 run 内只物化一次。模板正常
// 只读共享；verify 会写 summary 的 case 经 `createWorkingCopy` 取隔离副本。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CHILD_RUN,
  CHILD_TURN,
  MEMORY,
  RECEIPT,
  SESSION,
  SOURCE_RUN,
  SOURCE_TURN,
  TRACE,
  USER_TURN,
  WORK,
  WORKSPACE,
  appLogRecords,
  artifacts,
  checkpointPayload,
  configPayload,
  driverCommands,
  iso,
  llmFixtureRecords,
  qualityText,
  SCREENSHOTS,
  readyPayload,
  revisionText,
  seedLog,
  transcripts,
  uiCompletePayload,
  waitEvents,
  waitStats,
  whyText,
  wireRecords,
} from "./native_b71_revision_facts.mjs";

export const REVISION_DB_REL = "database/ai_novel_studio_test.sqlite3";

const JOURNAL = "DELETE";

const SCHEMA_SQL = `
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
  `;

const SEGMENT_VERSION = "authoring-run-segment/v1";

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function jpeg(file) {
  fs.writeFileSync(file, Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex"));
}

function revisionData() {
  const { sourceArtifact, revisionArtifact } = artifacts();
  const { sourceTranscript, childTranscript } = transcripts();
  return {
    sourceArtifact,
    revisionArtifact,
    sourceTranscript,
    childTranscript,
    checkpoints: checkpointPayload(),
    wire: wireRecords(),
    llm: llmFixtureRecords(),
  };
}

function insertCanonicalSegment(db, runId, transcriptFacts) {
  const header = {
    version: SEGMENT_VERSION,
    run: transcriptFacts.run,
    system: transcriptFacts.system,
    tools: transcriptFacts.tools,
    projection: transcriptFacts.projection,
    base_refs: transcriptFacts.base_refs,
    observation_refs: transcriptFacts.observation_refs,
    used_refs: transcriptFacts.used_refs,
    call_ids: transcriptFacts.call_ids,
  };
  db.prepare("INSERT INTO authoring_run_segments (run_id, header, message_count) VALUES (?, ?, ?)").run(
    runId,
    JSON.stringify(header),
    transcriptFacts.messages.length,
  );
  transcriptFacts.messages.forEach((message, index) => {
    db.prepare(
      "INSERT INTO authoring_session_messages (run_id, sequence, run_sequence, message, format_version) VALUES (?, ?, ?, ?, ?)",
    ).run(runId, index + 1, index + 1, JSON.stringify(message), "authoring-session-message/v1");
  });
}

function seedDatabase(file, data) {
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA journal_mode = ${JOURNAL}`);
    db.exec(SCHEMA_SQL);

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
    insert("chapters", { id: "chapter-2", title: "第02章：矿区追击战" });
    insert("memory_items", { id: MEMORY, work_id: WORK, reference_count: 0, last_referenced_at: null });
    insert("agent_runs", run({
      id: SOURCE_RUN,
      parent_turn_ref: USER_TURN,
      run_mode: "bounded",
      profile_ref: "prose_drafting_with_quality_v1",
      status: "completed",
      authority_scope: JSON.stringify({ allowed_tools: ["prose_writing", "chapter_read"] }),
      consumed_budget: JSON.stringify({ provider_calls: 1 }),
    }));
    insertCanonicalSegment(db, SOURCE_RUN, data.sourceTranscript);
    insert("agent_runs", run({
      id: CHILD_RUN,
      parent_turn_ref: SOURCE_TURN,
      run_mode: "bounded",
      profile_ref: "prose_revision_from_findings_v1",
      status: "completed",
      authority_scope: JSON.stringify({ allowed_tools: ["prose_writing"] }),
      consumed_budget: JSON.stringify({ provider_calls: 2, tool_calls: 1, steps: 4 }),
    }));
    insertCanonicalSegment(db, CHILD_RUN, data.childTranscript);
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
      result: JSON.stringify({
        admission_version: 2,
        run_id: CHILD_RUN,
        receipt_id: RECEIPT,
        status: "running",
        source_turn_ref: SOURCE_TURN,
        target_artifact_ref: "as-original",
      }),
      inserted_at: iso(0), updated_at: iso(0),
    });
    insert("interactions", {
      id: "interaction-source", workspace_id: WORK, turn_id: SOURCE_TURN, role: "assistant",
      content: JSON.stringify({
        agent_run_id: SOURCE_RUN,
        text: "源正文已生成。",
        turn_result: {
          turn_id: SOURCE_TURN,
          adoption_state: { pending: [data.sourceArtifact], resolved: [] },
        },
      }),
      session_id: SESSION, inserted_at: iso(0), updated_at: iso(0),
    });
    insert("interactions", {
      id: "interaction-child", workspace_id: WORK, turn_id: CHILD_TURN, role: "assistant",
      content: JSON.stringify({
        agent_run_id: CHILD_RUN,
        text: "修订候选已生成。",
        turn_result: {
          turn_id: CHILD_TURN,
          adoption_state: { pending: [data.revisionArtifact], resolved: [] },
          trace_summary: {
            trace_ref: TRACE,
            decision_ref: "decision-child",
            tool_result_id: "tool-result-child",
          },
        },
      }),
      session_id: SESSION, inserted_at: iso(0), updated_at: iso(0),
    });
    insert("decision_traces", {
      id: "trace-row", workspace_id: WORK, trace_id: TRACE, turn_id: CHILD_TURN,
      decision_type: "revise_from_findings", inserted_at: iso(0), updated_at: iso(0), session_id: SESSION,
    });
  } finally {
    db.close();
  }
}

/**
 * 修订批次模板：canon 快照与 production 指纹由消费者在 run 内计算一次后传入，
 * 其余事实来自纯 fixture owner；同一输入在 run 内只物化一次。
 */
export function b71RevisionFixtureSpec({ canon, production }) {
  const inputs = {
    data: JSON.stringify(revisionData()),
    canon: JSON.stringify(canon),
    production: JSON.stringify(production),
    schema: SCHEMA_SQL,
    journal: JOURNAL,
    builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
    pure_fixture_source: fs.readFileSync(
      new URL("./native_b71_revision_facts.mjs", import.meta.url),
      "utf8",
    ),
    runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
  };
  return {
    name: "b71-revision-batch",
    inputs,
    build: (staging) => buildWithInputs(staging, inputs),
  };
}

function buildWithInputs(staging, inputs) {
  const data = JSON.parse(inputs.data);
  const canonical = JSON.parse(inputs.canon);
  const production = JSON.parse(inputs.production);
  fs.mkdirSync(`${staging}/app-log`, { recursive: true });
  fs.mkdirSync(`${staging}/llm-calls`, { recursive: true });
  writeJson(`${staging}/native-driver-ready.json`, readyPayload());
  for (const name of SCREENSHOTS) jpeg(`${staging}/${name}.jpg`);
  writeJson(`${staging}/native-ui-complete.json`, uiCompletePayload());
  fs.writeFileSync(`${staging}/02-quality.text.txt`, qualityText());
  fs.writeFileSync(`${staging}/03-revision.text.txt`, revisionText());
  fs.writeFileSync(`${staging}/04-why.text.txt`, whyText());
  fs.writeFileSync(`${staging}/seed.log`, seedLog());
  writeJson(`${staging}/native-b71-config.json`, configPayload());
  writeJsonl(`${staging}/native-driver-commands.jsonl`, driverCommands());
  writeJsonl(`${staging}/wait-events.jsonl`, waitEvents());
  writeJson(`${staging}/wait-stats.json`, waitStats());
  writeJsonl(`${staging}/heartbeat.jsonl`, [{ at: iso(0) }]);
  writeJsonl(`${staging}/app-log/2026-11-02.jsonl`, appLogRecords());
  writeJsonl(`${staging}/llm-calls/2026-11-02.jsonl`, data.llm);
  writeJsonl(`${staging}/native-transport.jsonl`, data.wire);
  writeJson(`${staging}/b71-start.json`, {
    ...data.checkpoints.start,
    authoring_canon: canonical.start,
  });
  writeJson(`${staging}/b71-before-revision.json`, {
    ...data.checkpoints.beforeRevision,
    authoring_canon: canonical.before,
  });
  writeJson(`${staging}/b71-final.json`, {
    ...data.checkpoints.final,
    authoring_canon: canonical.final,
  });
  writeJson(`${staging}/b71-before-why.json`, data.checkpoints.beforeWhy);
  writeJson(`${staging}/b71-after-why.json`, data.checkpoints.afterWhy);
  writeJson(`${staging}/production-sources-before.json`, production);

  fs.mkdirSync(path.dirname(`${staging}/${REVISION_DB_REL}`), { recursive: true });
  seedDatabase(`${staging}/${REVISION_DB_REL}`, data);

  return [
    "native-driver-ready.json",
    ...SCREENSHOTS.map((name) => `${name}.jpg`),
    "native-ui-complete.json",
    "02-quality.text.txt",
    "03-revision.text.txt",
    "04-why.text.txt",
    "seed.log",
    "native-b71-config.json",
    "native-driver-commands.jsonl",
    "wait-events.jsonl",
    "wait-stats.json",
    "heartbeat.jsonl",
    "app-log/2026-11-02.jsonl",
    "llm-calls/2026-11-02.jsonl",
    "native-transport.jsonl",
    "b71-start.json",
    "b71-before-revision.json",
    "b71-final.json",
    "b71-before-why.json",
    "b71-after-why.json",
    "production-sources-before.json",
    REVISION_DB_REL,
  ];
}
