// B87 R01 capture 家族的唯一 IO 资产/factory owner。
//
// 三个资产域都经同一 `materializeFixture` owner 物化，同一 run 同规格只构造一次：
//   1. 作者源日志：固定 llm/app JSONL 字面规格，不建 DB；
//   2. native 只读源/完整快照：20 表 DDL/seed + source/full/work + snapshot metadata；
//      builder 通过第二个只读 `publicationDir` 把将来真实发布的 source.path/snapshot.dir
//      序列进 staging 内的 snapshot manifest，hash/canon/run_inventory 原样保留；
//   3. 初始 batch：沿既有 restore + 固定 setup SQL 从上述共享 snapshot 构成可写批次
//      初始资产（DB/恢复记录/seed.log/runtime-facts），case 只复制这一部分。
//
// 所有连接 finally 关闭，合成库以 DELETE journal 封存；写 case 只通过
// `createWorkingCopy`/`withWorkingCopy` 拿到隔离副本。反例仍真实修改文件/DB，不用
// 假返回替代 IO。本模块只给 `../../../model_contracts/request_cost_capture_io.test.mjs`
// 消费，不 import 被测 capture 业务逻辑，也不把 20 表合成投影称为可启动完整生产 Schema。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  businessContentSha,
  contentCanonSnapshot,
  createCompleteSnapshot,
  readSnapshotManifest,
  restoreSnapshot,
  sha256File,
} from "../request_cost_snapshot.mjs";
import { ROOT, productionTableCounts, withDb } from "../scenario_evidence.mjs";
import {
  RUNTIME_PROFILE_ID,
  expectedRuntimeFacts,
} from "../request_cost_runtime_recipe.mjs";
import {
  CHECKPOINT_FINAL_AT,
  CHECKPOINT_START_AT,
  MODEL,
  SESSION_TITLE,
  SOURCE_LOG_APP,
  SOURCE_LOG_LLM,
  SOURCE_TEXTS,
  TARGET_TITLE,
  WORK_ID,
  appLogText,
  canonicalTranscript,
  exchangeMessages,
  jsonlLine,
  llmLogText,
  makeRecord,
  nativeCaptureManifest,
  sha256Text,
  turnObservationNodes,
} from "./request_cost_capture_fixture.mjs";

const SOURCE_DB_REL = "source.sqlite3";
export const SNAPSHOT_REL = "snapshot";
export const BATCH_DB_REL = "database/ai_novel_studio_test.sqlite3";
const SNAPSHOT_RECORD_REL = "request-cost-snapshot.json";
const SEED_LOG_REL = "seed.log";
export const RUNTIME_FACTS_REL = "runtime-facts.json";
const DRIVER_LOG_REL = "native-request-cost-driver-log.json";

const SETUP_TIME = "2026-11-13T00:00:00.000Z";
const JOURNAL_PRAGMAS = Object.freeze({ journal_mode: "DELETE", synchronous: "FULL" });
const JOURNAL_CONFIG = Object.entries(JOURNAL_PRAGMAS)
  .map(([key, value]) => `${key}=${value}`)
  .join("; ");

const ID_ONLY_TABLES = Object.freeze([
  "workspaces",
  "chapters",
  "volumes",
  "scenes",
  "characters",
  "ledger_entries",
  "author_action_receipts",
  "interactions",
  "decision_traces",
  "mutations",
]);

// capture 现役 20 表 DDL 的单点：不是 14 表快照查询投影，也不与它合并。
const SOURCE_SCHEMA_SQL = [
  "CREATE TABLE works (id TEXT PRIMARY KEY, title TEXT, genre TEXT, premise TEXT, tone_preference TEXT, status TEXT, revision INTEGER, updated_at TEXT)",
  "CREATE TABLE work_sessions (id TEXT PRIMARY KEY, work_id TEXT, title TEXT, status TEXT, updated_at TEXT)",
  "CREATE TABLE drafts (id TEXT PRIMARY KEY, work_id TEXT, content TEXT)",
  ...ID_ONLY_TABLES.map((table) => `CREATE TABLE ${table} (id TEXT PRIMARY KEY)`),
  "CREATE TABLE memory_items (id TEXT PRIMARY KEY, work_id TEXT, content TEXT, reference_count INTEGER, last_referenced_at TEXT)",
  "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, run_mode TEXT, status TEXT, consumed_budget TEXT, pending_artifact_refs TEXT)",
  "CREATE TABLE authoring_run_segments (run_id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, header TEXT, message_count INTEGER, first_sequence INTEGER, last_sequence INTEGER, format_version TEXT)",
  "CREATE TABLE authoring_session_messages (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, run_id TEXT, sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT, format_version TEXT)",
  "CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, status TEXT, purpose TEXT)",
  "CREATE TABLE long_run_tasks (id TEXT PRIMARY KEY, status TEXT)",
  "CREATE TABLE memory_reference_logs (id TEXT PRIMARY KEY, memory_id TEXT, work_id TEXT, task_id TEXT, conversation_id TEXT, reference_scene TEXT, reference_reason TEXT, inserted_at TEXT)",
].join(";\n");

// 初始 20 表内容与现役 createSourceDb 完全同源；部分列插入仍用列名显式限定。
const SOURCE_INSERTS = Object.freeze([
  {
    table: "works",
    rows: [[WORK_ID, "R01 合成作品", "赛博修仙", "合成前提", "克制", "TENTATIVE", 1, "2026-11-12T00:00:00.000Z"]],
  },
  {
    table: "work_sessions",
    rows: [["session-old", WORK_ID, "旧会话", "ACTIVE", "2026-11-12T00:00:00.000Z"]],
  },
  { table: "drafts", rows: [["draft-1", WORK_ID, "受测正文"]] },
  {
    table: "memory_items",
    rows: [
      ["88888888-8888-4888-8888-888888888888", WORK_ID, "目标记忆正文", 1, "2026-11-12T00:00:00.000000Z"],
      ["99999999-9999-4999-8999-999999999999", "22222222-2222-4222-8222-222222222222", "他作记忆正文", 0, null],
    ],
  },
  {
    table: "memory_reference_logs",
    rows: [
      [
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "88888888-8888-4888-8888-888888888888",
        WORK_ID,
        null,
        null,
        "dialogue_context",
        "dialogue context recall",
        "2026-11-12T00:00:00.000000Z",
      ],
    ],
  },
  { table: "long_run_tasks", rows: [["task-1", "DONE"]] },
  { table: "agent_runs", columns: ["id", "run_mode"], rows: [["old-run", "bounded"]] },
  {
    table: "provider_runs",
    columns: ["id", "provider_call_ref"],
    rows: [["old-prun", "old-pcall"]],
  },
]);

const SETUP_STATEMENTS = Object.freeze([
  "UPDATE works SET title = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
  "UPDATE work_sessions SET status = 'EXITED', updated_at = ? WHERE id = ?",
  "INSERT INTO work_sessions VALUES (?,?,?,?,?)",
]);
const SETUP_SQL = SETUP_STATEMENTS.join("\n");

function readOwnSource() {
  return fs.readFileSync(new URL(import.meta.url), "utf8");
}

function readPureSource() {
  return fs.readFileSync(new URL("./request_cost_capture_fixture.mjs", import.meta.url), "utf8");
}

function readSource(rel) {
  return fs.readFileSync(new URL(rel, import.meta.url), "utf8");
}

// 当前调用链显式列出：snapshot/canon/reference/request_cost evidence 与
// scenario_evidence（ROOT/查询）真实参与 source/snapshot 输出；batch 另用 runtime recipe。
// 这是固定调用链，不是通用依赖扫描器。
function snapshotDependencySources() {
  return {
    snapshot_source: readSource("../request_cost_snapshot.mjs"),
    canon_source: readSource("../authoring_canon_evidence.mjs"),
    reference_log_source: readSource("../reference_log_evidence.mjs"),
    request_cost_evidence_source: readSource("../request_cost_evidence.mjs"),
    scenario_evidence_source: readSource("../scenario_evidence.mjs"),
  };
}

function batchDependencySources() {
  return {
    ...snapshotDependencySources(),
    runtime_recipe_source: readSource("../request_cost_runtime_recipe.mjs"),
  };
}

function runtimeTag() {
  return `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`;
}

function applyJournalPragmas(db) {
  for (const [name, value] of Object.entries(JOURNAL_PRAGMAS)) db.exec(`PRAGMA ${name} = ${value}`);
}

function insertRows(db, { table, columns = null, rows }) {
  if (rows.length === 0) return;
  const placeholders = rows[0].map(() => "?").join(",");
  const sql = columns
    ? `INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`
    : `INSERT INTO ${table} VALUES (${placeholders})`;
  const statement = db.prepare(sql);
  for (const row of rows) statement.run(...row);
}

function writeSourceDb(dir) {
  const db = new DatabaseSync(path.join(dir, SOURCE_DB_REL));
  try {
    applyJournalPragmas(db);
    db.exec(SOURCE_SCHEMA_SQL);
    for (const insert of SOURCE_INSERTS) insertRows(db, insert);
  } finally {
    db.close();
  }
}

// 只改写“将来从哪里读”的两个定位字段；hash/canon/table_counts/run_inventory 不改。
function bindPublishedSnapshot(manifest, { publicationDir, snapshotDir }) {
  const patched = {
    ...manifest,
    source: {
      ...manifest.source,
      path: path.relative(ROOT, path.join(publicationDir, SOURCE_DB_REL)),
    },
    snapshot: {
      ...manifest.snapshot,
      dir: path.relative(ROOT, path.join(publicationDir, SNAPSHOT_REL)),
    },
  };
  fs.writeFileSync(
    path.join(snapshotDir, "manifest.json"),
    `${JSON.stringify(patched, null, 2)}\n`,
    { mode: 0o600 },
  );
  return patched;
}

function applyInitialSetup(batchDir) {
  const db = new DatabaseSync(path.join(batchDir, BATCH_DB_REL));
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    db.prepare(SETUP_STATEMENTS[0]).run(TARGET_TITLE, SETUP_TIME, WORK_ID);
    db.prepare(SETUP_STATEMENTS[1]).run(SETUP_TIME, "session-old");
    db.prepare(SETUP_STATEMENTS[2]).run("session-1", WORK_ID, SESSION_TITLE, "ACTIVE", SETUP_TIME);
  } finally {
    db.close();
  }
}

function seedLogText() {
  return (
    `[seed] work_id=${WORK_ID} title_after=${TARGET_TITLE} revision_before=1 revision_after=2 ` +
    `session_id=session-1 session_title=${SESSION_TITLE} new_session=true\n`
  );
}

function runtimeFactsPayload(overrides = {}) {
  const expected = expectedRuntimeFacts(RUNTIME_PROFILE_ID);
  return {
    schema: "b87-r01-runtime-facts/v1",
    captured_at: "2026-11-13T00:00:00.000Z",
    pid: "1",
    ...expected,
    provider: {
      ...expected.provider,
      endpoint: "http://127.0.0.1:8000/v1",
      extra_providers: ["stub"],
    },
    context_pressure: { ...expected.context_pressure, maintenance_ratio: 0.7, hard_ratio: 0.9 },
    ...overrides,
  };
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/** 作者源日志：固定 llm/app JSONL，不建 DB；需要改日志的 case 另取工作副本。 */
export function sourceLogsFixtureSpec() {
  return {
    name: "b87-r01-capture-source-logs",
    files: {
      [SOURCE_LOG_LLM]: llmLogText(),
      [SOURCE_LOG_APP]: appLogText(),
    },
  };
}

/**
 * native 只读源/完整快照：一次形成 source/full/work 与 snapshot metadata。
 * `build(staging, publicationDir)` 只把将来真实发布位置序列进 staging 内的 manifest；
 * source/full/work 仍只在 staging 构造，经同一 owner 校验/rename 整体发布。
 */
export function nativeSourceFixtureSpec() {
  return {
    name: "b87-r01-capture-native-source",
    inputs: {
      schema: SOURCE_SCHEMA_SQL,
      seed: JSON.stringify(SOURCE_INSERTS),
      journal: JOURNAL_CONFIG,
      root: ROOT,
      builder_source: readOwnSource(),
      dependency_source: readPureSource(),
      ...snapshotDependencySources(),
      runtime: runtimeTag(),
    },
    build(staging, publicationDir) {
      writeSourceDb(staging);
      const sourceFile = path.join(staging, SOURCE_DB_REL);
      const snapshotDir = path.join(staging, SNAPSHOT_REL);
      const snapshot = createCompleteSnapshot({
        outDir: snapshotDir,
        fullPath: sourceFile,
        frozenPath: sourceFile,
        expectedSha256: sha256File(sourceFile),
        allowedPrefix: staging,
      });
      bindPublishedSnapshot(snapshot, { publicationDir, snapshotDir });
      return [
        SOURCE_DB_REL,
        `${SNAPSHOT_REL}/full.sqlite3`,
        `${SNAPSHOT_REL}/work.sqlite3`,
        `${SNAPSHOT_REL}/manifest.json`,
      ];
    },
  };
}

/**
 * 初始 batch 资产：从已共享的 native source/snapshot 沿既有 restore 复制 work DB，
 * 再执行固定 setup SQL 并写 seed.log/runtime-facts。case 只复制这 4 个文件；
 * source/full/work 不随 batch 重复复制。source.path 仍指向本 run 的实际共享 source。
 */
export function initialBatchFixtureSpec(sourceFixture) {
  const snapshotDir = path.join(sourceFixture.dir, SNAPSHOT_REL);
  const snapshotManifest = readSnapshotManifest(snapshotDir);
  return {
    name: "b87-r01-capture-batch",
    inputs: {
      source_dir: sourceFixture.dir,
      source_digest: sourceFixture.digest,
      source_sha256: sha256File(path.join(sourceFixture.dir, SOURCE_DB_REL)),
      snapshot_manifest: JSON.stringify(snapshotManifest),
      setup_sql: SETUP_SQL,
      seed_log: seedLogText(),
      runtime_facts: JSON.stringify(runtimeFactsPayload()),
      journal: JOURNAL_CONFIG,
      root: ROOT,
      builder_source: readOwnSource(),
      dependency_source: readPureSource(),
      ...batchDependencySources(),
      runtime: runtimeTag(),
    },
    build(staging) {
      restoreSnapshot({ batchDir: staging, snapshotDir });
      applyInitialSetup(staging);
      fs.writeFileSync(path.join(staging, SEED_LOG_REL), seedLogText());
      fs.writeFileSync(
        path.join(staging, RUNTIME_FACTS_REL),
        `${JSON.stringify(runtimeFactsPayload(), null, 2)}\n`,
      );
      return [BATCH_DB_REL, SNAPSHOT_RECORD_REL, SEED_LOG_REL, RUNTIME_FACTS_REL];
    },
  };
}

/** 从实际快照 metadata + 共享日志路径组合 native manifest；snapshot.dir 仍是合成规范引用。 */
function nativeManifestFromFixtures({ source, logs }) {
  const snapshot = readSnapshotManifest(path.join(source.dir, SNAPSHOT_REL));
  return nativeCaptureManifest({
    llmLog: path.join(logs.dir, SOURCE_LOG_LLM),
    appLog: path.join(logs.dir, SOURCE_LOG_APP),
    snapshot: snapshot.snapshot,
  });
}

/**
 * native 声明文件的字面规格：source/log 路径都指向本 run 共享模板，字节不再随 case
 * 变化，直接由现有 literal fixture 缓存；不是新协议/新 builder。
 */
export function nativeManifestFixtureSpec({ source, logs }) {
  return {
    name: "b87-r01-capture-native-manifest",
    files: {
      "manifest.json": JSON.stringify(nativeManifestFromFixtures({ source, logs }), null, 2),
    },
  };
}

function writeTurnObservation(batchDir, turn, message) {
  writeJson(path.join(batchDir, `request-cost-turn-observation-${turn}.json`), {
    schema: "b87-r01-turn-observation/v1",
    turn,
    author_message: message,
    baseline_author_count: 0,
    last: {
      outcome: { kind: "completed", author_count: 1 },
      nodes: turnObservationNodes(message),
    },
  });
}

export function writeDriverLog(batchDir, length = 3) {
  const turns = Array.from({ length }, (_, index) => ({
    index: index + 1,
    author_id: `round-${(index % SOURCE_TEXTS.length) + 1}`,
    author_sha256: sha256Text(SOURCE_TEXTS[index % SOURCE_TEXTS.length]),
    status: "completed",
    visible_outcome: { kind: "completed" },
    turn_id: `turn-${index + 1}`,
    run_id: `run-${index + 1}`,
    sent_at: `2026-11-13T00:00:0${index}.000Z`,
  }));
  // 可见性事实来自每轮原始 AX observation，而不是 driver 自报字段。
  turns.forEach((turn) =>
    writeTurnObservation(batchDir, turn.index, SOURCE_TEXTS[(turn.index - 1) % SOURCE_TEXTS.length]),
  );
  writeJson(path.join(batchDir, DRIVER_LOG_REL), {
    schema: "b87-request-cost-driver/v1",
    provider: "splash",
    model: MODEL.model,
    work: { id: WORK_ID, title: TARGET_TITLE },
    session_id: "session-1",
    turns,
    completed: true,
  });
  return turns;
}

function insertRun(db, turn, text) {
  const transcript = canonicalTranscript(turn, text);
  const runId = turn.run_id;
  db.prepare(
    "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, run_mode, status, consumed_budget, pending_artifact_refs) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    runId,
    "workspace-1",
    WORK_ID,
    "session-1",
    turn.turn_id,
    "bounded",
    "completed",
    JSON.stringify({ provider_calls: 2 }),
    JSON.stringify([]),
  );
  const header = {
    version: "authoring-run-segment/v1",
    run: {
      run_id: runId,
      workspace_id: "workspace-1",
      work_id: WORK_ID,
      session_id: "session-1",
      parent_turn_ref: turn.turn_id,
      profile_ref: "judgment_loop_v1",
    },
    system: { identity_ref: "identity:test/v1" },
    tools: [],
    projection: { target: "chat_completions" },
    base_refs: [],
    observation_refs: [],
    used_refs: [],
    call_ids: [transcript.call1, transcript.call2],
  };
  const identity = header.run;
  const offset = db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) AS value FROM authoring_session_messages WHERE session_id = ?",
  ).get(identity.session_id).value;
  const count = transcript.messages.length;
  db.prepare(
    "INSERT INTO authoring_run_segments (run_id, workspace_id, work_id, session_id, parent_turn_ref, header, message_count, first_sequence, last_sequence, format_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    runId, identity.workspace_id, identity.work_id, identity.session_id, identity.parent_turn_ref,
    JSON.stringify(header), count, count === 0 ? null : offset + 1,
    count === 0 ? null : offset + count, "authoring-run-segment/v1",
  );
  transcript.messages.forEach((message, index) => {
    db.prepare(
      "INSERT INTO authoring_session_messages (id, workspace_id, work_id, session_id, run_id, sequence, run_sequence, role, message, format_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      `msg-${runId}-${index + 1}`,
      identity.workspace_id, identity.work_id, identity.session_id, runId,
      offset + index + 1, index + 1, message.role, JSON.stringify(message),
      "authoring-session-message/v1",
    );
  });
  const insertProvider = db.prepare(
    "INSERT INTO provider_runs (id, provider_call_ref, agent_run_id, workspace_id, work_id, session_id, parent_turn_ref, status, purpose) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insertProvider.run(
    transcript.prun1,
    transcript.pcall1,
    runId,
    "workspace-1",
    WORK_ID,
    "session-1",
    turn.turn_id,
    "completed",
    "planner",
  );
  insertProvider.run(
    transcript.prun2,
    transcript.pcall2,
    runId,
    "workspace-1",
    WORK_ID,
    "session-1",
    turn.turn_id,
    "completed",
    "writer",
  );
  return transcript;
}

export function writeCalls(batchDir, turns) {
  const dir = path.join(batchDir, "llm-calls");
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(batchDir, BATCH_DB_REL));
  const lines = [];
  let previous = [
    { role: "system", content: "系统提示" },
    { role: "user", content: "【应用数据 · application_base】作品资料" },
  ];
  try {
    for (const [offset, turn] of turns.entries()) {
      const text = SOURCE_TEXTS[offset % SOURCE_TEXTS.length];
      const transcript = insertRun(db, turn, text);
      const call1Messages = [
        ...previous,
        { role: "user", content: `【应用数据 · scope_update】当前范围${turn.index}` },
        { role: "user", content: text },
      ];
      const call2Messages = exchangeMessages(call1Messages, {
        pcall: transcript.pcall1,
        prun: transcript.prun1,
        callId: transcript.call1,
      });
      lines.push(
        jsonlLine(
          makeRecord({
            turnId: turn.turn_id,
            messages: call1Messages,
            pcall: transcript.pcall1,
            prun: transcript.prun1,
            responseToolCalls: [{ id: transcript.call1, name: "read_chapter", arguments: "{}" }],
          }),
        ),
      );
      lines.push(
        jsonlLine(
          makeRecord({
            turnId: `${turn.turn_id}:agent:1`,
            messages: call2Messages,
            pcall: transcript.pcall2,
            prun: transcript.prun2,
            responseToolCalls: [{ id: transcript.call2, name: "read_chapter", arguments: "{}" }],
          }),
        ),
      );
      previous = exchangeMessages(call2Messages, {
        pcall: transcript.pcall2,
        prun: transcript.prun2,
        callId: transcript.call2,
      });
    }
  } finally {
    db.close();
  }
  fs.writeFileSync(path.join(dir, "2026-11-13.jsonl"), `${lines.join("\n")}\n`);
}

// llm-calls 的唯一计数决策：一次目录判定/遍历同时得到文件数与行数。
// 目录不存在仍是已知初始状态（0/0），不引入通用计数框架。
function countLlmCalls(batchDir) {
  const dir = path.join(batchDir, "llm-calls");
  if (!fs.existsSync(dir)) return { files: 0, lines: 0 };
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".jsonl"));
  const lines = files.reduce(
    (sum, file) =>
      sum +
      fs
        .readFileSync(path.join(dir, file), "utf8")
        .split("\n")
        .filter((line) => line.includes("{")).length,
    0,
  );
  return { files: files.length, lines };
}

// 现役 public 投影：只转发 countLlmCalls 的 lines，不重复目录判定/遍历。
export function llmLineCount(batchDir) {
  return countLlmCalls(batchDir).lines;
}

function countDriverTurns(batchDir) {
  const file = path.join(batchDir, DRIVER_LOG_REL);
  if (!fs.existsSync(file)) return 0;
  const driver = JSON.parse(fs.readFileSync(file, "utf8"));
  // 文件存在但 turns 不是数组是坏声明，不是“已观察 0 轮”；明确失败，不伪造零。
  if (!Array.isArray(driver.turns)) {
    throw new Error(`driver 日志 turns 必须是数组：${file}`);
  }
  return driver.turns.length;
}

/** 初始/末态观察：计数从实际 DB、日志与 driver 读取，不把末态倒填初态。 */
export function observeCheckpoint(batchDir, at) {
  return {
    production_counts: productionTableCounts(batchDir),
    llm_calls: countLlmCalls(batchDir),
    driver_turns: countDriverTurns(batchDir),
    authoring_canon: withDb(batchDir, (db) => contentCanonSnapshot(db, at)),
  };
}

function writeCheckpointRecord(batchDir, checkpoint, at, facts) {
  writeJson(path.join(batchDir, `request-cost-${checkpoint}.json`), {
    schema: "b87-request-cost-checkpoint/v1",
    checkpoint,
    at,
    production_counts: facts.production_counts,
    llm_calls: facts.llm_calls,
    driver_turns: facts.driver_turns,
    authoring_canon: facts.authoring_canon,
    business_content_sha256: businessContentSha(facts.authoring_canon),
  });
}

/** 正常批次：start 用初始 batch 的真实观察，final 在 case 变更后单独观察末态。 */
export function writeCheckpoints(
  batchDir,
  initial,
  { startAt = CHECKPOINT_START_AT, finalAt = CHECKPOINT_FINAL_AT } = {},
) {
  writeCheckpointRecord(batchDir, "start", startAt, initial);
  writeCheckpointRecord(batchDir, "final", finalAt, observeCheckpoint(batchDir, finalAt));
}

/**
 * 显式逻辑时序的 checkpoint：counts/canon 从当前实际 DB 读取，at 由调用方明确给出；
 * llm_calls.lines 仍可显式声明（参考记账用例的“运行前 0 次调用”是构造的时序事实）。
 */
export function writeCheckpointAt(batchDir, checkpoint, at, lines) {
  const facts = observeCheckpoint(batchDir, at);
  writeCheckpointRecord(batchDir, checkpoint, at, {
    ...facts,
    llm_calls: {
      files: facts.llm_calls.files,
      lines: lines ?? facts.llm_calls.lines,
    },
  });
}

export function mutateDb(batchDir, mutate) {
  const db = new DatabaseSync(path.join(batchDir, BATCH_DB_REL));
  try {
    mutate(db);
  } finally {
    db.close();
  }
}
