// B71 live / B82 作者可见证据族唯一的真实文件/SQLite fixture owner。
//
// 只服务 `../authoring_live_verifier.test.mjs`：11 表 SQLite 是 verifyLiveBatch →
// readBatchAuthoringHistory/readRunRefFacts/bindNativeCalls 实际消费的投影，不声称
// 可启动完整生产应用。默认 live、无 used refs 的负例规格、真实 SSE 对账规格与
// B82 作者可见页面（G2/G3）是不同批次规格，各自物化一次，不合并成同一模板。
//
// 模板以 DELETE journal 封存（无 -wal/-shm），正常只读共享；需要改 config/wire/DB/
// strata-slot 或写 summary 的 case 经 `withWorkingCopy` 取隔离副本。预注册不在模板
// 内：它把 evidence.dir 绑定到批次绝对路径，由 case 在工作副本上按本批目录重写。
import fs from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { writeAX } from "../driver.mjs";
import {
  AUTHOR,
  FINISHED_AT,
  G2_MESSAGE,
  G2_VISIBLE_TARGET,
  G3_MESSAGE,
  MESSAGE_VERSION,
  READY_AT,
  RUN,
  SESSION,
  SEGMENT_VERSION,
  TURN,
  WORK,
  WORKSPACE,
  authorVisibleDriverLog,
  canonicalRunFacts,
  chapterMission,
  checkpoint,
  liveDriverLog,
  llmRecord,
  nativeRunFacts,
  png,
  sseRecords,
  turnBody,
  visibleAfterInput,
  visibleFinal,
  visibleReadOnlyFinal,
  visibleReadingPage,
} from "./authoring_live_facts.mjs";

export const LIVE_DB_REL = "database/ai_novel_studio_test.sqlite3";

const SCHEMA_SQL = `
    CREATE TABLE chapters (id TEXT PRIMARY KEY, work_id TEXT, volume_id TEXT, title TEXT, seq INTEGER, status TEXT, inserted_at TEXT, updated_at TEXT, summary TEXT, plan_direction TEXT);
    CREATE TABLE scenes (id TEXT PRIMARY KEY, chapter_id TEXT, work_id TEXT, seq INTEGER);
    CREATE TABLE drafts (id TEXT PRIMARY KEY, work_id TEXT, scene_id TEXT, content TEXT, status TEXT, revision INTEGER);
    CREATE TABLE agent_events (id TEXT, run_id TEXT, event_type TEXT, refs TEXT);
    CREATE TABLE decision_traces (trace_id TEXT, workspace_id TEXT, session_id TEXT, turn_id TEXT, context_refs TEXT);
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, long_run_task_ref TEXT, run_mode TEXT, status TEXT, plan_version INTEGER, consumed_budget TEXT, pending_artifact_refs TEXT);
    CREATE TABLE authoring_run_segments (run_id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, header TEXT, message_count INTEGER, first_sequence INTEGER, last_sequence INTEGER, format_version TEXT);
    CREATE TABLE authoring_session_messages (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, run_id TEXT, sequence INTEGER, run_sequence INTEGER, role TEXT, message TEXT, format_version TEXT);
    CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT, workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, status TEXT);
    CREATE TABLE provider_events (id TEXT PRIMARY KEY, provider_run_id TEXT, provider_call_ref TEXT, agent_run_id TEXT, event_type TEXT, emitted_at TEXT);
    CREATE TABLE mutations (id TEXT);
`;

const SHOT_NAMES = ["01-workbench.png", "after-input.png", "final.png"];
const VISIBLE_SHOT_NAMES = ["01-workbench.jpg", "02-reading-before.jpg", "before-input.jpg", "after-input.jpg", "final.jpg", "03-reading-after.jpg"];
const LIVE_WAIT_KINDS = ["input", "ack", "turn", "maintenance", "maintenance", "maintenance", "maintenance", "maintenance", "maintenance"];
const VISIBLE_WAIT_KINDS = ["maintenance", "maintenance", "maintenance", "input", "turn", "turn", "maintenance", "maintenance"];
const WAIT_BASE_MS = Date.parse(READY_AT);

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function writeWaitEvidence(staging, kinds) {
  writeJsonl(
    `${staging}/native-driver-commands.jsonl`,
    kinds.flatMap((kind, index) => [
      { op: "begin", id: `wait-${index}`, kind },
      { op: "finish", id: `wait-${index}`, kind },
    ]),
  );
  writeJsonl(
    `${staging}/wait-events.jsonl`,
    kinds.flatMap((kind, index) => [
      { event: "wait_start", kind, at: WAIT_BASE_MS + index * 1000, id: `wait-${index}` },
      { event: "wait_end", kind, ended_at: WAIT_BASE_MS + index * 1000 + 500, id: `wait-${index}` },
    ]),
  );
  writeJson(`${staging}/wait-stats.json`, { active: null, completed: kinds.length });
  writeJsonl(`${staging}/heartbeat.jsonl`, [{ at: READY_AT }]);
}

function writeReady(staging) {
  writeJson(`${staging}/native-driver-ready.json`, {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-ref-live",
    provider: "strata",
    slice_id: "b71-first-consumer",
    ready_at: READY_AT,
    app_path: "/tmp/B71 Live.app",
  });
}

// canonical 执行段的真实持久结构：agent_runs + 段头 + 消息行。
export function insertCanonicalRun(
  db,
  {
    runId = RUN,
    sessionId = SESSION,
    workId = WORK,
    usedRefs = ["observation:obs_1"],
    providerCallRef = "pcall_live_1",
    providerRunRef = "prun_live_1",
  } = {},
) {
  const facts = canonicalRunFacts({ runId, sessionId, workId, usedRefs, providerCallRef, providerRunRef });
  db.prepare(
    "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, run_mode, status, plan_version, consumed_budget, pending_artifact_refs) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(runId, WORKSPACE, workId, sessionId, TURN, null, "bounded", "completed", 1, null, "[]");
  const { firstSequence, lastSequence } = insertCanonicalMessages(db, facts.run, facts.messages);
  db.prepare(
    "INSERT INTO authoring_run_segments (run_id, workspace_id, work_id, session_id, parent_turn_ref, header, message_count, first_sequence, last_sequence, format_version) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(runId, WORKSPACE, workId, sessionId, TURN, JSON.stringify(facts.header), facts.messages.length, firstSequence, lastSequence, SEGMENT_VERSION);
  return facts;
}

function insertCanonicalMessages(db, run, messages) {
  const firstSequence = db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS first_sequence FROM authoring_session_messages WHERE session_id = ?",
  ).get(run.session_id).first_sequence;
  const insert = db.prepare(
    "INSERT INTO authoring_session_messages (id, workspace_id, work_id, session_id, run_id, sequence, run_sequence, role, message, format_version) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  messages.forEach((message, index) => {
    const runSequence = index + 1;
    insert.run(`msg-${run.run_id}-${runSequence}`, run.workspace_id, run.work_id, run.session_id,
      run.run_id, firstSequence + index, runSequence, message.role, JSON.stringify(message), MESSAGE_VERSION);
  });
  return { firstSequence, lastSequence: firstSequence + messages.length - 1 };
}

function insertNativeCallRun(db) {
  const facts = nativeRunFacts();
  db.prepare(
    "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, run_mode, status, plan_version, consumed_budget, pending_artifact_refs) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(RUN, WORKSPACE, WORK, SESSION, TURN, null, "bounded", "completed", 1, JSON.stringify({ provider_calls: 2 }), "[]");
  const { firstSequence, lastSequence } = insertCanonicalMessages(db, facts.run, facts.messages);
  db.prepare(
    "INSERT INTO authoring_run_segments (run_id, workspace_id, work_id, session_id, parent_turn_ref, header, message_count, first_sequence, last_sequence, format_version) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(RUN, WORKSPACE, WORK, SESSION, TURN, JSON.stringify(facts.header), facts.messages.length, firstSequence, lastSequence, SEGMENT_VERSION);
  const insertRun = db.prepare(
    "INSERT INTO provider_runs (id, provider_call_ref, agent_run_id, workspace_id, work_id, session_id, parent_turn_ref, status) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (const run of facts.providerRuns) {
    insertRun.run(run.id, run.provider_call_ref, run.agent_run_id, run.workspace_id, run.work_id, run.session_id, run.parent_turn_ref, run.status);
  }
}

function seedLiveDatabase(file, { usedRefs = ["observation:obs_1"], nativeCall = false } = {}) {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO chapters (id, work_id, volume_id, title, seq, status, inserted_at, updated_at, summary, plan_direction) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("chapter-row", WORK, null, "第一章", 1, "PLANNED", "2026-11-03T10:00:00.000Z", "2026-11-03T10:00:00.000Z", null, JSON.stringify(chapterMission()));
    db.prepare("INSERT INTO agent_events (id, run_id, event_type, refs) VALUES (?,?,?,?)").run("ev-1", RUN, "exploration_observed", '["obs_1"]');
    db.prepare("INSERT INTO decision_traces (trace_id, workspace_id, session_id, turn_id, context_refs) VALUES (?,?,?,?,?)").run("trace_1", WORKSPACE, SESSION, TURN, null);
    if (nativeCall) insertNativeCallRun(db);
    else insertCanonicalRun(db, { usedRefs });
  } finally {
    db.close();
  }
}

function seedFacts({ usedRefs, nativeCall }) {
  const transcript = nativeCall ? nativeRunFacts() : canonicalRunFacts({ usedRefs });
  return {
    run: transcript.run,
    messages: transcript.messages,
    chapters: [{ id: "chapter-row", work_id: WORK, title: "第一章", seq: 1, status: "PLANNED" }],
    agent_events: [{ id: "ev-1", run_id: RUN, event_type: "exploration_observed", refs: '["obs_1"]' }],
    decision_traces: [{ trace_id: "trace_1", workspace_id: WORKSPACE, session_id: SESSION, turn_id: TURN, context_refs: null }],
    provider_runs: nativeCall ? nativeRunFacts().providerRuns : [],
  };
}

function writeLiveFiles(staging, { usedRefs, nativeCall }) {
  fs.mkdirSync(`${staging}/database`, { recursive: true });
  fs.mkdirSync(`${staging}/app-log`, { recursive: true });
  fs.mkdirSync(`${staging}/llm-calls`, { recursive: true });
  fs.writeFileSync(
    `${staging}/seed.log`,
    `[g2-test-seed] work_id=${WORK} session_id=${SESSION} chapter_id=chapter-target-2 chapter_seq=2\n`,
  );
  writeReady(staging);
  for (const name of SHOT_NAMES) fs.writeFileSync(`${staging}/${name}`, png());
  writeJson(`${staging}/native-ui-complete.json`, {
    harness_run_ref: "run-ref-live",
    driver: "ax-native-system-ui",
    app_bundle: "com.ai-novel-studio.app",
    scope: "b71-first-consumer",
    screenshots: SHOT_NAMES,
  });
  writeWaitEvidence(staging, LIVE_WAIT_KINDS);

  writeJsonl(`${staging}/app-log/2026-11-03.jsonl`, [
    { at: "2026-11-03T10:00:00.000Z", event: "provider_gateway.complete.start", provider: "strata" },
  ]);
  writeJsonl(
    `${staging}/llm-calls/2026-11-03.jsonl`,
    nativeCall ? sseRecords({ writerItem: null }) : [llmRecord()],
  );
  writeJsonl(`${staging}/native-transport.jsonl`, [
    {
      at: "2026-11-03T10:00:00.300Z",
      direction: "sent",
      frame: ["3", "3", "workspace:test", "phx_join", { work_id: WORK, session_id: SESSION }],
    },
    {
      at: "2026-11-03T10:00:00.400Z",
      direction: "received",
      frame: ["3", "3", "workspace:test", "phx_reply", { status: "ok", response: { joined: true, work_id: WORK, session_id: SESSION } }],
    },
    {
      at: "2026-11-03T10:00:00.500Z",
      direction: "sent",
      frame: ["3", "4", "workspace:test", "user_message", { text: AUTHOR, turn_id: TURN, work_id: WORK, session_id: SESSION }],
    },
    {
      at: "2026-11-03T10:00:00.600Z",
      direction: "received",
      frame: ["3", "4", "workspace:test", "phx_reply", { status: "ok", response: { turn_id: TURN, run_id: RUN } }],
    },
    {
      at: "2026-11-03T10:00:02.000Z",
      direction: "received",
      frame: [null, null, "workspace:test", "turn_result", { ...turnBody, turn_id: `${TURN}:agent:2` }],
    },
    {
      at: "2026-11-03T10:00:00.400Z",
      direction: "http",
      method: "GET",
      path: "/api/works/w/sessions/resume",
      status: 200,
    },
  ]);

  writeJson(`${staging}/native-b71-config.json`, {
    slice_id: "b71-first-consumer",
    journey: "live",
    provider: "strata",
    target: { work_id: WORK, work_title: "B71 live", session_id: SESSION },
    message: AUTHOR,
  });
  writeJson(`${staging}/b71-start.json`, checkpoint("start"));
  seedLiveDatabase(`${staging}/${LIVE_DB_REL}`, { usedRefs, nativeCall });
  writeJson(`${staging}/b71-final.json`, checkpoint("final", { design: "design-final" }));
  writeJson(`${staging}/native-b71-driver-log.json`, liveDriverLog());
  writeJson(`${staging}/strata-slot.json`, {
    schema: "b71-strata-slot/v1",
    model: "iq3_s",
    loaded_before: true,
    loaded_after: false,
    unloaded: true,
    finished_at: FINISHED_AT,
  });

  return [
    "seed.log",
    "native-driver-ready.json",
    ...SHOT_NAMES,
    "native-ui-complete.json",
    "native-driver-commands.jsonl",
    "wait-events.jsonl",
    "wait-stats.json",
    "heartbeat.jsonl",
    "app-log/2026-11-03.jsonl",
    "llm-calls/2026-11-03.jsonl",
    "native-transport.jsonl",
    "native-b71-config.json",
    "b71-start.json",
    "b71-final.json",
    LIVE_DB_REL,
    "native-b71-driver-log.json",
    "strata-slot.json",
  ];
}

// 独立 AX 事实：发送前无本句作者节点；完成后当前作者、回复与过程处于同一消息流。
function visibleTurnNodes(message, readOnly) {
  const web = "0/0/0/0/0";
  const container = web + "/10";
  const node = (suffix, role, fields = {}) => ({ path: `${container}/${suffix}`, role, ...fields });
  const baselineNodes = [
    { path: "0", role: "AXWindow", frame: [0, 0, 1200, 800] },
    { path: web, role: "AXWebArea", frame: [0, 0, 1200, 800] },
    { path: web + "/0", role: "AXPopUpButton", desc: "作品", title: G2_VISIBLE_TARGET.work_title },
    { path: web + "/1", role: "AXPopUpButton", desc: "助手名称", title: "AI 助手" },
    { path: web + "/3", role: "AXStaticText", value: "无任务" },
    { path: container, role: "AXGroup", subrole: "AXLandmarkRegion",
      title: "会话消息", desc: "会话消息", frame: [0, 80, 1200, 600] },
  ];
  const reply = readOnly
    ? "我按你的要求只读了现有正文，没有改动，也没有生成候选或保存。"
    : "指定段落修订稿 他把第七枚手印按进灰里。";
  const nodes = [
    ...baselineNodes,
    node("10", "AXGroup"), node("10/0", "AXStaticText", { value: "你" }),
    node("11", "AXGroup"), node("11/0", "AXStaticText", { value: message }),
    node("12", "AXGroup"), node("12/0", "AXStaticText", { value: "AI 助手" }),
    node("13", "AXGroup"), node("13/0", "AXStaticText", { value: reply }),
    node("14", "AXGroup", { title: "本轮创作过程" }),
    node("14/0", "AXStaticText", { value: "已完成" }),
    node("15", "AXButton", { title: "为什么", desc: "查看这轮回应的依据" }),
    ...(readOnly ? [] : [
      node("16", "AXGroup"),
      node("16/0", "AXStaticText", { value: "第02章：灰烬中的手印（指定段落修订稿）" }),
      node("16/1", "AXStaticText", { value: reply }),
      node("16/2", "AXButton", { title: "保存修订稿" }),
    ]),
  ];
  return { baselineNodes, nodes };
}

const contentHash = (value) => createHash("sha256").update(value).digest("hex");

// 语义用例重新物化一致的合成 capture；篡改用例不调用它，保留原 capture 收据。
export function sealAuthorVisibleCaptures(dir) {
  const observationFile = `${dir}/native-b71-turn-observation.json`;
  const logFile = `${dir}/native-b71-driver-log.json`;
  const observation = JSON.parse(fs.readFileSync(observationFile, "utf8"));
  const log = JSON.parse(fs.readFileSync(logFile, "utf8"));
  for (const [name, nodes] of [["before-input", observation.baseline_nodes], ["final", observation.last.nodes]]) {
    const capture = log.captures.find((entry) => entry.name === name);
    capture.nodes = nodes.length;
    capture.ax_sha256 = contentHash(JSON.stringify(nodes));
    writeAX(nodes.map((node) => ({ ...node, depth: node.path.split("/").length - 1 })), `${dir}/${name}.ax.txt`);
    const textFile = `${dir}/${name}.text.txt`;
    if (fs.existsSync(textFile)) capture.text_sha256 = contentHash(fs.readFileSync(textFile));
    capture.screenshot.sha256 = contentHash(fs.readFileSync(`${dir}/${name}.jpg`));
    if (name === "final") {
      observation.last.signature = capture.ax_sha256;
      observation.last.node_count = nodes.length;
    }
  }
  writeJson(observationFile, observation);
  writeJson(logFile, log);
}

function writeVisibleFiles(staging, { mode }) {
  const readOnly = mode === "read_only";
  const message = readOnly ? G3_MESSAGE : G2_MESSAGE;
  writeReady(staging);
  for (const name of VISIBLE_SHOT_NAMES) fs.writeFileSync(`${staging}/${name}`, png());
  const pages = {
    "01-workbench": `${G2_VISIBLE_TARGET.work_title}\n等待创作请求\n`,
    "02-reading-before": visibleReadingPage(),
    "before-input": `${G2_VISIBLE_TARGET.work_title}\n无任务\n`,
    "after-input": visibleAfterInput(message),
    final: readOnly ? visibleReadOnlyFinal(message) : visibleFinal(message),
    "03-reading-after": visibleReadingPage(),
  };
  for (const [name, text] of Object.entries(pages)) {
    fs.writeFileSync(`${staging}/${name}.text.txt`, text);
    if (name !== "before-input" && name !== "final") {
      writeAX(text.split("\n").map((value, index) => ({
        path: `0/${index}`, role: "AXStaticText", value, depth: 1,
      })), `${staging}/${name}.ax.txt`);
    }
  }
  writeJson(`${staging}/native-ui-complete.json`, {
    harness_run_ref: "run-ref-live",
    driver: "ax-native-system-ui",
    app_bundle: "com.ai-novel-studio.app",
    scope: "b71-first-consumer",
    screenshots: VISIBLE_SHOT_NAMES,
  });
  writeWaitEvidence(staging, VISIBLE_WAIT_KINDS);
  writeJson(`${staging}/native-b71-config.json`, {
    slice_id: "b71-first-consumer",
    journey: "live",
    provider: "strata",
    target: { work_title: G2_VISIBLE_TARGET.work_title },
    message,
  });
  const { baselineNodes, nodes } = visibleTurnNodes(message, readOnly);
  writeJson(`${staging}/native-b71-turn-observation.json`, {
    schema: "native-turn-observation/v1", harness_run_ref: "run-ref-live",
    author_message: message, baseline_capture: "before-input", baseline_nodes: baselineNodes,
    baseline_author_count: 0, capture: "final", terminal: true,
    last: { at: FINISHED_AT, nodes, terminal: true, outcome: { kind: "completed" } },
    changes: [],
  });
  writeJson(`${staging}/native-b71-driver-log.json`, {
    ...authorVisibleDriverLog({ readOnly }),
    captures: ["before-input", "final"].map((name) => ({
      name, at: name === "before-input" ? "2026-11-03T09:00:01.000Z" : FINISHED_AT,
      screenshot: { ok: true },
    })),
  });
  sealAuthorVisibleCaptures(staging);
  writeJson(`${staging}/strata-slot.json`, {
    schema: "b71-strata-slot/v1",
    model: "iq3_s",
    loaded_before: true,
    loaded_after: false,
    unloaded: true,
    finished_at: FINISHED_AT,
  });

  return [
    "native-driver-ready.json",
    ...VISIBLE_SHOT_NAMES,
    ...VISIBLE_SHOT_NAMES.map((name) => name.replace(/\.jpg$/u, ".ax.txt")),
    "native-b71-turn-observation.json",
    "before-input.text.txt",
    "01-workbench.text.txt",
    "02-reading-before.text.txt",
    "after-input.text.txt",
    "final.text.txt",
    "03-reading-after.text.txt",
    "native-ui-complete.json",
    "native-driver-commands.jsonl",
    "wait-events.jsonl",
    "wait-stats.json",
    "heartbeat.jsonl",
    "native-b71-config.json",
    "native-b71-driver-log.json",
    "strata-slot.json",
  ];
}

/**
 * 默认 live / 无 used refs 负例 / 真实 SSE 对账规格，同一 (run, 规格指纹) 只物化
 * 一次。预注册不进入模板，由 case 在副本上把 evidence.dir 绑定到本批目录。
 */
export function liveBatchFixtureSpec({ usedRefs = ["observation:obs_1"], nativeCall = false } = {}) {
  return {
    name: "b71-live-verify-batch",
    inputs: {
      used_refs: JSON.stringify(usedRefs),
      native_call: String(nativeCall),
      schema: SCHEMA_SQL,
      seed: JSON.stringify(seedFacts({ usedRefs, nativeCall })),
      journal: "DELETE",
      builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
      facts_source: fs.readFileSync(new URL("./authoring_live_facts.mjs", import.meta.url), "utf8"),
      runtime: `node=${process.version}; sqlite=${process.versions.sqlite ?? "unknown"}`,
    },
    build(staging) {
      return writeLiveFiles(staging, { usedRefs, nativeCall });
    },
  };
}

/**
 * B82 作者可见页面批次（G2 candidate / G3 read_only）：从构造开始就不生成 DB、
 * seed、wire、llm/app 日志或旧内部 checkpoint，而不是先写再删。
 */
export function authorVisibleFixtureSpec({ mode = "candidate" } = {}) {
  if (mode !== "candidate" && mode !== "read_only") {
    throw new Error(`未知作者可见模式: ${mode}`);
  }
  return {
    name: "b82-live-visible-batch",
    inputs: {
      mode,
      message: mode === "read_only" ? G3_MESSAGE : G2_MESSAGE,
      builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
      facts_source: fs.readFileSync(new URL("./authoring_live_facts.mjs", import.meta.url), "utf8"),
      ax_writer_source: fs.readFileSync(new URL("../driver.mjs", import.meta.url), "utf8"),
      runtime: `node=${process.version}`,
    },
    build(staging) {
      return writeVisibleFiles(staging, { mode });
    },
  };
}
