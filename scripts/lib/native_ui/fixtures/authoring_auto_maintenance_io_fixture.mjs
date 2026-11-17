// B71 auto-maintenance 证据族唯一的真实文件/SQLite fixture owner。
//
// 只服务 `../authoring_auto_maintenance_evidence_io.test.mjs`：真实 AX/capture 文本、
// 驱动 JSONL、8 表 SQLite 与端到端 verify 输入。8 表是当前 SUT 读取的实际投影，
// 不声称可启动完整生产应用；种子对应既有合成批次，不读取作者源数据。
//
// 模板以 DELETE journal 封存（无 -wal/-shm），正常只读共享；需要写 AX/报告或
// 注入 DB 反例的 case 经 `withWorkingCopy` 取隔离副本。时间字段固定为历史批次
// 值，使同一规格在 run 内只物化一次。
import fs from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { maintenanceRecoveryFacts } from "./authoring_discussion_facts.mjs";
import {
  AUTO_EXECUTABLE,
  autoMaintenanceConfig,
  READY_AT,
  SESSION,
  WORK,
  driverLogFor,
  dbFactsFor,
  llmRecords,
  png,
} from "./authoring_auto_maintenance_facts.mjs";

export const AUTO_MAINTENANCE_DB_REL = "database/ai_novel_studio_test.sqlite3";

const SCREENS = ["01-workbench.jpg", "after-input.jpg", "final.jpg"];

const SCHEMA_SQL = `
    CREATE TABLE agent_events (id TEXT, run_id TEXT, event_type TEXT, visibility TEXT, sequence INTEGER, payload TEXT, inserted_at TEXT);
    CREATE TABLE agent_runs (id TEXT, status TEXT, session_id TEXT, workspace_id TEXT, work_id TEXT, parent_turn_ref TEXT, goal_version INTEGER);
    CREATE TABLE authoring_session_messages (id TEXT, run_id TEXT, session_id TEXT, sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT, format_version TEXT, workspace_id TEXT, work_id TEXT);
    CREATE TABLE provider_runs (id TEXT, provider_call_ref TEXT, provider_id TEXT, agent_run_id TEXT, session_id TEXT, workspace_id TEXT, work_id TEXT, parent_turn_ref TEXT, status TEXT, purpose TEXT, owner_refs TEXT, operation_checkpoint TEXT, started_at TEXT, inserted_at TEXT);
    CREATE TABLE provider_events (id TEXT, provider_run_id TEXT, provider_call_ref TEXT, event_type TEXT, emitted_at TEXT);
    CREATE TABLE provider_outputs (provider_run_id TEXT, provider_call_ref TEXT, agent_run_id TEXT, status TEXT, content_summary TEXT);
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

function seedDatabase(file, facts) {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(SCHEMA_SQL);
    for (const table of ["agent_events", "agent_runs", "authoring_session_messages", "provider_runs", "provider_outputs", "provider_events"]) {
      for (const row of facts[table]) {
        const columns = Object.keys(row);
        db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
          .run(...columns.map((column) => typeof row[column] === "object" && row[column] !== null ? JSON.stringify(row[column]) : row[column]));
      }
    }
  } finally {
    db.close();
  }
}

function seedFacts() {
  return dbFactsFor();
}
/**
 * 同一规格（strip/expanded）在 run 内只物化一次：AX 文本、驱动日志、8 表 DB 与
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
      discussion_builder: fs.readFileSync(new URL("authoring_discussion_facts.mjs", import.meta.url), "utf8"),
      frozen_discussions: fs.readFileSync(new URL("r03-discussion-author-inputs.json", import.meta.url), "utf8"),
      frozen_controls: fs.readFileSync(new URL("r03-interleaved-author-inputs.json", import.meta.url), "utf8"),
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
        provider: "splash",
        slice_id: "b71-first-consumer",
        ready_at: READY_AT,
        app_path: "/tmp/B71 Auto Maintenance.app",
      });
      const config = autoMaintenanceConfig();
      const runtimeRaw = JSON.stringify(config.runtime.observed, null, 2);
      fs.writeFileSync(`${staging}/runtime-facts.json`, runtimeRaw);
      config.runtime.facts_sha256 = createHash("sha256").update(runtimeRaw).digest("hex");
      const inputSources = {}, frozenInputs = {};
      for (const [kind, file] of [["discussions", "r03-discussion-author-inputs.json"], ["controls", "r03-interleaved-author-inputs.json"]]) {
        const raw = fs.readFileSync(new URL(file, import.meta.url), "utf8");
        frozenInputs[kind] = JSON.parse(raw).turns;
        fs.writeFileSync(`${staging}/${file}`, raw);
        inputSources[kind] = { file, source_path: "scripts/lib/native_ui/fixtures/" + file,
          sha256: createHash("sha256").update(raw).digest("hex") };
      }
      const scenario = maintenanceRecoveryFacts({ workId: WORK, sessionId: SESSION,
        base: dbFactsFor(), baseRecords: llmRecords(), failureInput: frozenInputs.discussions[11],
        recoveryInputs: frozenInputs.discussions.slice(12, 20) });
      const driver = { ...driverLogFor(), failure_injection: { ...scenario.injection,
        before_snapshot: "before-failure.json", after_failure_snapshot: "after-failure.json",
        before_restart_snapshot: "before-restart.json", after_restart_snapshot: "after-restart.json",
        after_recovery_snapshot: "after-recovery.json" }, termination: { llm_calls: scenario.records.length } };
      writeJson(`${staging}/before-failure.json`, scenario.facts.before);
      writeJson(`${staging}/after-failure.json`, scenario.facts.afterFailure);
      writeJson(`${staging}/before-restart.json`, scenario.facts.beforeRestart);
      writeJson(`${staging}/after-restart.json`, scenario.facts.afterRestart);
      writeJson(`${staging}/after-recovery.json`, scenario.facts.afterRecovery);
      writeJson(`${staging}/native-b71-config.json`, {
        ...config,
        target: { work_id: WORK, work_title: "自动维护验证作品", session_id: SESSION },
        message: JSON.parse(fs.readFileSync(new URL("r03-discussion-author-inputs.json", import.meta.url), "utf8")).turns[0].text,
        auto_maintenance: { input_sources: inputSources },
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
        { at: "2026-11-04T09:59:10.000Z", event: "provider_gateway.complete.start", provider: "splash" },
        ...scenario.appLog,
      ]);
      writeJsonl(`${staging}/llm-calls/2026-11-04.jsonl`, scenario.records);
      writeJson(`${staging}/native-b71-driver-log.json`, driver);
      writeJson(`${staging}/native-app-cleanup.json`, {
        executable: AUTO_EXECUTABLE,
        remaining: [],
        process_observation: { method: "pgrep+lsof", actions: [] },
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

      seedDatabase(`${staging}/${AUTO_MAINTENANCE_DB_REL}`, scenario.db);

      return [
        "native-driver-ready.json",
        "native-b71-config.json",
        "runtime-facts.json",
        "r03-discussion-author-inputs.json",
        "r03-interleaved-author-inputs.json",
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
        "before-failure.json",
        "after-failure.json",
        "before-restart.json",
        "after-restart.json",
        "after-recovery.json",
        "native-app-cleanup.json",
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
