// B71 first-consumer run 证据族唯一的真实文件/SQLite fixture owner。
//
// 4 表是 `authoringRunFacts → readAuthoringHistory/bindNativeCalls` 实际消费的投影，
// 不声称可启动完整生产应用。正常模板只读共享；需要改 DB 的反例经
// `withWorkingCopy` 取隔离副本。wire/llmRecords 是纯事实，在
// `authoring_run_scenarios.mjs`，本模块只负责真实 4 表与 config。
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  F_DECOY,
  F_MESSAGE,
  F_PARENT,
  F_RUN,
  F_SESSION,
  F_WORK,
  F_WORKSPACE,
  MESSAGE_FORMAT_VERSION,
  SEGMENT_VERSION,
  boundedTranscript,
} from "./authoring_run_scenarios.mjs";

export const FIRST_CONSUMER_DB_REL = "database/ai_novel_studio_test.sqlite3";

const SCHEMA_SQL = `
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT,
      parent_turn_ref TEXT, long_run_task_ref TEXT, run_mode TEXT, status TEXT, plan_version INTEGER,
      consumed_budget TEXT, pending_artifact_refs TEXT);
    CREATE TABLE authoring_run_segments (run_id TEXT PRIMARY KEY, header TEXT, message_count INTEGER);
    CREATE TABLE authoring_session_messages (run_id TEXT, sequence INTEGER, run_sequence INTEGER, message TEXT, format_version TEXT);
    CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT,
      workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, status TEXT);
`;

function insertCanonicalSegment(db, runId, transcriptRecord) {
  const transcript = transcriptRecord?.transcript ?? transcriptRecord;
  const messages = Array.isArray(transcript.messages) ? transcript.messages : [];
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
    messages.length,
  );
  messages.forEach((message, index) => {
    db.prepare(
      "INSERT INTO authoring_session_messages (run_id, sequence, run_sequence, message, format_version) VALUES (?, ?, ?, ?, ?)",
    ).run(runId, index + 1, index + 1, JSON.stringify(message), MESSAGE_FORMAT_VERSION);
  });
}

function seedDatabase(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(SCHEMA_SQL);
    const insertRun = db.prepare(
      "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, " +
        "run_mode, status, plan_version, consumed_budget, pending_artifact_refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertProvider = db.prepare(
      "INSERT INTO provider_runs (id, provider_call_ref, agent_run_id, workspace_id, work_id, session_id, parent_turn_ref, status) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertRun.run(
      F_RUN,
      F_WORKSPACE,
      F_WORK,
      F_SESSION,
      F_PARENT,
      null,
      "bounded",
      "completed",
      1,
      JSON.stringify({ provider_calls: 2 }),
      JSON.stringify([]),
    );
    insertCanonicalSegment(db, F_RUN, boundedTranscript());
    insertRun.run(
      F_DECOY,
      F_WORKSPACE,
      F_WORK,
      F_SESSION,
      F_PARENT,
      null,
      "bounded",
      "completed",
      1,
      JSON.stringify({ provider_calls: 1 }),
      JSON.stringify([]),
    );
    insertCanonicalSegment(
      db,
      F_DECOY,
      boundedTranscript(F_DECOY, ["pcall-9", "prun-9", "call-9", "pcall-9", "prun-9", "call-9"]),
    );
    for (const [n, run] of [[1, F_RUN], [2, F_RUN], [9, F_DECOY]]) {
      insertProvider.run(`prun-${n}`, `pcall-${n}`, run, F_WORKSPACE, F_WORK, F_SESSION, F_PARENT, "completed");
    }
  } finally {
    db.close();
  }
}

export function firstConsumerSeedFacts() {
  return {
    agent_runs: [
      { id: F_RUN, run_mode: "bounded", status: "completed", consumed_budget: JSON.stringify({ provider_calls: 2 }) },
      { id: F_DECOY, run_mode: "bounded", status: "completed", consumed_budget: JSON.stringify({ provider_calls: 1 }) },
    ],
    provider_runs: [
      { id: "prun-1", provider_call_ref: "pcall-1", agent_run_id: F_RUN },
      { id: "prun-2", provider_call_ref: "pcall-2", agent_run_id: F_RUN },
      { id: "prun-9", provider_call_ref: "pcall-9", agent_run_id: F_DECOY },
    ],
    message: F_MESSAGE,
  };
}

export function firstConsumerFixtureSpec() {
  return {
    name: "b71-first-consumer-run",
    inputs: {
      schema: SCHEMA_SQL,
      seed: JSON.stringify(firstConsumerSeedFacts()),
      journal: "DELETE",
      builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
      runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
    },
    build(staging) {
      fs.mkdirSync(`${staging}/database`, { recursive: true });
      fs.writeFileSync(
        `${staging}/native-b71-config.json`,
        JSON.stringify({ target: { work_id: F_WORK, work_title: "灰烬中的手印" } }),
      );
      seedDatabase(`${staging}/${FIRST_CONSUMER_DB_REL}`);
      return ["native-b71-config.json", FIRST_CONSUMER_DB_REL];
    },
  };
}
