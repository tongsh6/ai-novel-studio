// B71 canonical 历史读取族的唯一 4 表 Schema/批次 builder owner。
//
// 该族的负例多为「不同 DB 规格」（run_mode/身份/段版本/形状/checkpoint），按 A2
// 规则不能从「都使用 SQLite」推导可以共享同一模板；因此这里只集中 DDL 与
// 批次构造，规格仍按 case 变化。目录由调用方传 `workDir`（run scope 的 work 区），
// 由 `withHistoryBatch` 在 case 结束后回收，不落系统 TMPDIR 裸目录。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SEGMENT_VERSION = "authoring-run-segment/v1";
export const MESSAGE_VERSION = "authoring-session-message/v1";
export const HISTORY_RUN = "run-target";
export const HISTORY_WORK = "work-1";
export const HISTORY_WORKSPACE = "workspace-1";
export const HISTORY_SESSION = "session-1";
export const HISTORY_PARENT = "message-1";
export const HISTORY_TASK = "task-target";
export const HISTORY_TEXT = "目标 run 的作者原话";

const SCHEMA_SQL = `
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT,
      parent_turn_ref TEXT, long_run_task_ref TEXT, run_mode TEXT, status TEXT, plan_version INTEGER,
      consumed_budget TEXT, pending_artifact_refs TEXT);
    CREATE TABLE long_run_tasks (id TEXT PRIMARY KEY, workspace_id TEXT, parent_turn_ref TEXT,
      checkpoint_data TEXT, scope_ref TEXT, updated_at TEXT);
    CREATE TABLE authoring_run_segments (run_id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT,
      session_id TEXT, parent_turn_ref TEXT, header TEXT, message_count INTEGER, first_sequence INTEGER,
      last_sequence INTEGER, format_version TEXT);
    CREATE TABLE authoring_session_messages (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT,
      session_id TEXT, run_id TEXT, sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT,
      format_version TEXT);
`;

export function transcriptFor(overrides = {}) {
  return {
    run: {
      run_id: HISTORY_RUN,
      workspace_id: HISTORY_WORKSPACE,
      work_id: HISTORY_WORK,
      session_id: HISTORY_SESSION,
      parent_turn_ref: HISTORY_PARENT,
      profile_ref: "judgment_loop_v1",
    },
    system: { identity_ref: "identity:authoring/v1" },
    messages: [
      { role: "user", provenance: "author", blocks: [{ type: "text", text: HISTORY_TEXT }] },
      { role: "assistant", provenance: "model", blocks: [{ type: "tool_call", call_id: "call-1", name: "judgment_decision" }] },
    ],
    tools: [{ name: "judgment_decision" }],
    base_refs: [{ ref: "base-1" }],
    observation_refs: ["obs-1"],
    used_refs: [],
    projection: { target: "chat_completions" },
    call_ids: ["call-1"],
    ...overrides,
  };
}

function segmentHeaderFor(transcript, headerOverrides = {}) {
  return {
    version: SEGMENT_VERSION,
    run: transcript.run,
    system: transcript.system,
    tools: transcript.tools,
    projection: transcript.projection,
    base_refs: transcript.base_refs,
    observation_refs: transcript.observation_refs,
    used_refs: transcript.used_refs,
    call_ids: transcript.call_ids,
    ...headerOverrides,
  };
}

export function checkpointFor(runId = HISTORY_RUN) {
  return {
    agent_run: {
      run_id: runId,
      checkpoint_version: 3,
      authoring_segment_ref: { run_id: runId, version: SEGMENT_VERSION },
      status: "completed",
      run_mode: "durable",
    },
    progress: 100,
  };
}

function jsonColumn(value) {
  if (value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function insertSegment(db, {
  run_id = HISTORY_RUN,
  transcript = transcriptFor(),
  segment_version = SEGMENT_VERSION,
  header_overrides = {},
  message_json = null,
  message_rows = null,
  omit = null,
} = {}) {
  if (omit === "segment" || transcript === null) return;
  const header = { ...segmentHeaderFor(transcript, header_overrides), version: segment_version };
  const rawMessages = message_rows ?? transcript.messages;
  const messages = Array.isArray(rawMessages) ? rawMessages : [];
  db.prepare(
    "INSERT INTO authoring_run_segments (run_id, workspace_id, work_id, session_id, parent_turn_ref, header, message_count, first_sequence, last_sequence, format_version) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    run_id,
    transcript.run.workspace_id,
    transcript.run.work_id,
    transcript.run.session_id,
    transcript.run.parent_turn_ref,
    JSON.stringify(header),
    messages.length,
    1,
    messages.length,
    SEGMENT_VERSION,
  );
  if (omit === "messages") return;
  messages.forEach((message, index) => {
    db.prepare(
      "INSERT INTO authoring_session_messages (id, workspace_id, work_id, session_id, run_id, sequence, run_sequence, role, message, format_version) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      `msg-${run_id}-${index + 1}`,
      transcript.run.workspace_id,
      transcript.run.work_id,
      transcript.run.session_id,
      run_id,
      index + 1,
      index + 1,
      typeof message?.role === "string" ? message.role : "",
      message_json ?? JSON.stringify(message),
      MESSAGE_VERSION,
    );
  });
}

function insertRun(db, {
  id = HISTORY_RUN,
  workspace_id = HISTORY_WORKSPACE,
  work_id = HISTORY_WORK,
  session_id = HISTORY_SESSION,
  parent_turn_ref = HISTORY_PARENT,
  long_run_task_ref = HISTORY_TASK,
  run_mode = "durable",
  transcript = transcriptFor(),
  segment = {},
} = {}) {
  db.prepare(
    "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, run_mode, status, plan_version, consumed_budget, pending_artifact_refs) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    workspace_id,
    work_id,
    session_id,
    parent_turn_ref,
    long_run_task_ref,
    run_mode,
    "completed",
    2,
    JSON.stringify({ provider_calls: 2, replans: 1 }),
    JSON.stringify(["artifact-1"]),
  );
  insertSegment(db, { run_id: id, transcript, ...segment });
}

function insertTask(db, {
  id = HISTORY_TASK,
  workspace_id = HISTORY_WORK,
  parent_turn_ref = HISTORY_PARENT,
  checkpoint_data = checkpointFor(),
  scope_ref = null,
  updated_at = "2026-11-01 08:00:00.000000",
} = {}) {
  db.prepare(
    "INSERT INTO long_run_tasks (id, workspace_id, parent_turn_ref, checkpoint_data, scope_ref, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, workspace_id, parent_turn_ref, jsonColumn(checkpoint_data), scope_ref, updated_at);
}

/**
 * 按该 case 的 DB 规格构建一个真实 4 表批次；目录落在调用方 workDir（run scope）。
 * 规格不同即不同批次，不把负例合并成共享模板。
 */
export function createHistoryBatch({ workDir, run, task, extraRuns = [], extraTasks = [], runSegment } = {}) {
  const dir = fs.mkdtempSync(path.join(workDir, "b71-history-"));
  const file = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(SCHEMA_SQL);
    if (run !== null) insertRun(db, run);
    if (task !== null) insertTask(db, task);
    for (const row of extraRuns) insertRun(db, row);
    for (const row of extraTasks) insertTask(db, row);
    if (runSegment !== undefined) insertSegment(db, runSegment);
  } finally {
    db.close();
  }
  return dir;
}

/** case 级清理：正常返回与断言失败都删除本 case 目录。 */
export function withHistoryBatch(options, run) {
  const dir = createHistoryBatch(options);
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
