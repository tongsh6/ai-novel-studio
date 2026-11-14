// B71 auto-maintenance 证据族唯一的真实文件/SQLite fixture owner。
//
// 只服务 `../authoring_auto_maintenance_evidence_io.test.mjs`：真实 AX/capture 文本、
// 驱动 JSONL、7 表 SQLite 与端到端 verify 输入。7 表是当前 SUT 读取的实际投影，
// 不声称可启动完整生产应用；种子对应既有合成批次，不读取作者源数据。
//
// 模板以 DELETE journal 封存（无 -wal/-shm），正常只读共享；需要写 AX/报告或
// 注入 DB 反例的 case 经 `withWorkingCopy` 取隔离副本。时间字段固定为历史批次
// 值，使同一规格在 run 内只物化一次。
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  AFTER_STARTED_AT,
  EVENT_AT,
  FAILURE_REASON,
  FAIL_RUN,
  READY_AT,
  RECOVERY_RUN,
  RUN,
  SESSION,
  WORK,
  checkpointMessage,
  driverLogFor,
  llmRecords,
  png,
  providerEventsFor,
  providerRunsFor,
  transcriptRecord,
} from "./authoring_auto_maintenance_facts.mjs";

export const AUTO_MAINTENANCE_DB_REL = "database/ai_novel_studio_test.sqlite3";

const SCREENS = ["01-workbench.jpg", "after-input.jpg", "final.jpg"];

const SCHEMA_SQL = `
    CREATE TABLE agent_events (id TEXT, run_id TEXT, event_type TEXT, visibility TEXT, sequence INTEGER, payload TEXT, inserted_at TEXT);
    CREATE TABLE agent_runs (id TEXT, status TEXT, session_id TEXT);
    CREATE TABLE authoring_session_messages (id TEXT, run_id TEXT, session_id TEXT, sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT, format_version TEXT);
    CREATE TABLE provider_runs (id TEXT, provider_call_ref TEXT, provider_id TEXT, agent_run_id TEXT, session_id TEXT, purpose TEXT, started_at TEXT, inserted_at TEXT);
    CREATE TABLE provider_events (id TEXT, provider_run_id TEXT, provider_call_ref TEXT, event_type TEXT, emitted_at TEXT);
    CREATE TABLE interactions (id TEXT, turn_id TEXT, content TEXT);
    CREATE TABLE mutations (id TEXT);
`;

const WAIT_KINDS = ["input", "ack", "turn", "maintenance", "maintenance", "maintenance"];

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function seedDatabase(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)").run(
      "evt-1",
      RUN,
      "checkpoint_created",
      "author",
      2,
      JSON.stringify({ covered_exchanges: 1, scope: "earlier_work_turns", sources: ["资料查阅"] }),
      EVENT_AT,
    );
    db.prepare("INSERT INTO agent_events VALUES (?,?,?,?,?,?,?)").run(
      "evt-recovery",
      RECOVERY_RUN,
      "checkpoint_created",
      "author",
      1,
      JSON.stringify({ covered_exchanges: 1, scope: "earlier_work_turns", sources: ["资料查阅"] }),
      "2026-11-04T10:05:00.000Z",
    );
    for (const id of [RUN, FAIL_RUN, RECOVERY_RUN]) {
      db.prepare("INSERT INTO agent_runs VALUES (?,?,?)").run(id, "completed", SESSION);
    }
    transcriptRecord().transcript.messages.forEach((message, index) => {
      db.prepare("INSERT INTO authoring_session_messages VALUES (?,?,?,?,?,?,?,?)").run(
        `msg-${index + 1}`,
        RUN,
        SESSION,
        index + 1,
        index + 1,
        message.role,
        JSON.stringify(message),
        "authoring-session-message/v1",
      );
    });
    db.prepare("INSERT INTO authoring_session_messages VALUES (?,?,?,?,?,?,?,?)").run(
      "msg-recovery",
      RECOVERY_RUN,
      SESSION,
      7,
      1,
      "checkpoint",
      JSON.stringify(checkpointMessage({ summary: "恢复后的整理记录" })),
      "authoring-session-message/v1",
    );
    for (const run of providerRunsFor()) {
      db.prepare("INSERT INTO provider_runs VALUES (?,?,?,?,?,?,?,?)").run(
        run.id,
        run.provider_call_ref,
        run.provider_id,
        run.agent_run_id,
        run.session_id,
        run.purpose,
        run.started_at,
        run.inserted_at,
      );
    }
    for (const event of providerEventsFor()) {
      db.prepare(
        "INSERT INTO provider_events (id, provider_run_id, provider_call_ref, event_type, emitted_at) VALUES (?,?,?,?,?)",
      ).run(event.id, event.provider_run_id, event.provider_call_ref, event.event_type, event.emitted_at);
    }
  } finally {
    db.close();
  }
}

function seedFacts() {
  return {
    agent_events: [
      { id: "evt-1", run_id: RUN, sequence: 2, inserted_at: EVENT_AT },
      { id: "evt-recovery", run_id: RECOVERY_RUN, sequence: 1, inserted_at: "2026-11-04T10:05:00.000Z" },
    ],
    agent_runs: [
      { id: RUN, status: "completed", session_id: SESSION },
      { id: FAIL_RUN, status: "completed", session_id: SESSION },
      { id: RECOVERY_RUN, status: "completed", session_id: SESSION },
    ],
    provider_runs: providerRunsFor(),
    provider_events: providerEventsFor(),
  };
}

/**
 * 同一规格（strip/expanded）在 run 内只物化一次：AX 文本、驱动日志、7 表 DB 与
 * 端到端 verify 输入。返回的列表即发布 payload 的完整文件集合。
 */
export function autoMaintenanceFixtureSpec({ strip = true, expanded = true } = {}) {
  return {
    name: "b71-auto-maintenance",
    inputs: {
      strip: String(strip),
      expanded: String(expanded),
      schema: SCHEMA_SQL,
      seed: JSON.stringify(seedFacts()),
      journal: "DELETE",
      builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
      runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
    },
    build(staging) {
      fs.mkdirSync(`${staging}/database`, { recursive: true });
      fs.mkdirSync(`${staging}/llm-calls`, { recursive: true });
      fs.mkdirSync(`${staging}/app-log`, { recursive: true });

      writeJson(`${staging}/native-driver-ready.json`, {
        driver: "external-system-ui",
        browser_driver_started: false,
        run_ref: "run-ref-auto",
        provider: "strata",
        slice_id: "b71-first-consumer",
        ready_at: READY_AT,
        app_path: "/tmp/B71 Auto Maintenance.app",
      });
      writeJson(`${staging}/native-b71-config.json`, {
        slice_id: "b71-first-consumer",
        journey: "auto-maintenance",
        provider: "strata",
        target: { work_id: WORK, work_title: "自动维护验证作品", session_id: SESSION },
        message: "先读一下第01章的正文和章计划，我想知道现在的进度。",
        auto_maintenance: { requests: [] },
      });
      for (const name of SCREENS) fs.writeFileSync(`${staging}/${name}`, png());
      writeJson(`${staging}/native-ui-complete.json`, {
        harness_run_ref: "run-ref-auto",
        driver: "ax-native-system-ui",
        app_bundle: "com.ai-novel-studio.app",
        scope: "b71-first-consumer",
        screenshots: SCREENS,
      });
      writeJsonl(
        `${staging}/native-driver-commands.jsonl`,
        WAIT_KINDS.flatMap((kind, index) => [
          { op: "begin", id: `wait-${index}`, kind },
          { op: "finish", id: `wait-${index}`, kind },
        ]),
      );
      const waitBase = Date.parse("2026-11-04T09:58:00.000Z");
      writeJsonl(
        `${staging}/wait-events.jsonl`,
        WAIT_KINDS.flatMap((kind, index) => [
          { event: "wait_start", kind, at: waitBase + index * 1000, id: `wait-${index}` },
          { event: "wait_end", kind, ended_at: waitBase + index * 1000 + 500, id: `wait-${index}` },
        ]),
      );
      writeJson(`${staging}/wait-stats.json`, { active: null, completed: WAIT_KINDS.length });
      writeJsonl(`${staging}/heartbeat.jsonl`, [{ at: READY_AT }]);
      writeJsonl(`${staging}/native-transport.jsonl`, [
        { at: "2026-11-04T09:59:15.000Z", direction: "http", method: "GET", path: "/api/works/w/sessions/resume", status: 200 },
        { at: "2026-11-04T09:59:20.000Z", direction: "sent", frame: [null, null, "workspace:test", "user_message", { turn_id: "turn-a", text: "先读一下第01章" }] },
        { at: "2026-11-04T09:59:40.000Z", direction: "received", frame: [null, null, "workspace:test", "turn_result", { turn_id: "turn-a", status: "conversational" }] },
        { at: "2026-11-04T09:59:50.000Z", direction: "sent", frame: [null, null, "workspace:test", "user_message", { turn_id: "turn-b", text: "再读一下第02章" }] },
        { at: "2026-11-04T10:00:10.000Z", direction: "received", frame: [null, null, "workspace:test", "turn_result", { turn_id: "turn-b", status: "conversational" }] },
      ]);
      writeJsonl(`${staging}/app-log/2026-11-04.jsonl`, [
        { at: "2026-11-04T09:59:10.000Z", event: "provider_gateway.complete.start", provider: "strata" },
        { at: "2026-11-04T10:00:02.000Z", event: "agent_run.auto_maintenance.error", run_id: FAIL_RUN, reason: FAILURE_REASON },
      ]);
      writeJsonl(`${staging}/llm-calls/2026-11-04.jsonl`, llmRecords());
      writeJson(`${staging}/native-b71-driver-log.json`, driverLogFor());
      writeJson(`${staging}/native-app-cleanup.json`, {
        remaining: [],
        process_observation: { method: "pgrep+lsof", actions: [] },
      });
      writeJson(`${staging}/strata-slot.json`, {
        schema: "b71-strata-slot/v1",
        model: "iq3_s",
        loaded_before: false,
        loaded_after: false,
        unloaded: true,
      });
      for (const name of ["start", "final"]) {
        writeJson(`${staging}/b71-${name}.json`, {
          checkpoint: name,
          db_production_counts: {},
          authoring_canon: { tables: { works: { row_count: 1, rows_sha256: "w", canon_sha256: "w" } } },
        });
      }
      const stripText = strip ? "较早的 1 项创作过程已整理" : "普通消息";
      fs.writeFileSync(
        `${staging}/after-maintenance.ax.txt`,
        `\t\t0/0/0/0/0/10 AXButton, ${stripText}\n`,
      );
      const expandedText = expanded
        ? "已整理的较早记录\n为了保持这次创作始终清晰连贯，系统整理了较早的 1 项已完成操作。\n原始记录仍然保留，不会被删除或改写。\n涉及：资料查阅\n查看完整记录\n"
        : "普通内容\n";
      fs.writeFileSync(`${staging}/after-expanded.ax.txt`, expandedText);
      fs.writeFileSync(`${staging}/after-refresh.ax.txt`, `\t\t0/0/0/0/0/10 AXButton, ${stripText}\n`);
      fs.writeFileSync(`${staging}/after-failure.ax.txt`, "\t\t0/0/0/0/0/11 AXStaticText, Value: 已停止\n");

      seedDatabase(`${staging}/${AUTO_MAINTENANCE_DB_REL}`);

      return [
        "native-driver-ready.json",
        "native-b71-config.json",
        ...SCREENS,
        "native-ui-complete.json",
        "native-driver-commands.jsonl",
        "wait-events.jsonl",
        "wait-stats.json",
        "heartbeat.jsonl",
        "native-transport.jsonl",
        "app-log/2026-11-04.jsonl",
        "llm-calls/2026-11-04.jsonl",
        "native-b71-driver-log.json",
        "native-app-cleanup.json",
        "strata-slot.json",
        "b71-start.json",
        "b71-final.json",
        "after-maintenance.ax.txt",
        "after-expanded.ax.txt",
        "after-refresh.ax.txt",
        "after-failure.ax.txt",
        AUTO_MAINTENANCE_DB_REL,
      ];
    },
  };
}
