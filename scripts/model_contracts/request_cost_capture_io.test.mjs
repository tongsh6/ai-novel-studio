// B87 R01 capture 真实 IO/CLI 编排：历史 analyze、native preflight/prepare/capture/verify
// 与薄 CLI。纯规则/入参拒绝在邻接 `request_cost_capture.test.mjs`；本文件只做真实
// 文件/日志/SQLite/公开入口。
//
// file 级 `before` 只申请/借用一次 run scope，`after` 关闭。三个资产域都由
// `fixtures/request_cost_capture_io_fixture.mjs` 经同一 `materializeFixture` owner
// 在首个真正需要它的 case 物化：固定作者日志、20 表 native 源/完整快照、初始 batch。
// 正常 case 只读借用日志/源/快照，并只对初始 batch 取可写工作副本；需要改日志/
// snapshot 的反例才取该域自己的副本。所有输出目录落在 run.workDir 叶子并由
// TestContext 立即登记退出，不清空父 run 的共享 work/tmp。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import preregisteredInputs from "../lib/native_ui/fixtures/r03-discussion-author-inputs.json" with { type: "json" };
import {
  createWorkingCopy,
  materializeFixture,
  openTestRunScope,
} from "../lib/test_env.mjs";
import { main } from "./request_cost_baseline.mjs";
import {
  analyzeHistory,
  captureBatch,
  loadSourceAuthors,
  preflightNative,
  prepareBatch,
  restoreSnapshot,
  verifyBatch,
} from "../lib/native_ui/request_cost_capture.mjs";
import {
  CHECKPOINT_FINAL_AT,
  CHECKPOINT_START_AT,
  MODEL,
  SOURCE_LOG_APP,
  SOURCE_LOG_LLM,
  SOURCE_TEXTS,
  WORK_ID,
  historyCaptureManifest,
  jsonlLine,
  sha256Text,
} from "../lib/native_ui/fixtures/request_cost_capture_fixture.mjs";
import {
  BATCH_DB_REL,
  RUNTIME_FACTS_REL,
  SNAPSHOT_REL,
  initialBatchFixtureSpec,
  llmLineCount,
  mutateDb,
  nativeManifestFixtureSpec,
  nativeSourceFixtureSpec,
  observeCheckpoint,
  sourceLogsFixtureSpec,
  writeCalls,
  writeCheckpointAt,
  writeCheckpoints,
  writeDriverLog,
  writeJson,
} from "../lib/native_ui/fixtures/request_cost_capture_io_fixture.mjs";
import { commonBatchFixtureSpec } from "../lib/native_ui/fixtures/scenario_evidence_io_fixture.mjs";
import { readSnapshotManifest } from "../lib/native_ui/request_cost_snapshot.mjs";

const PRODUCTION_TABLES = [
  "works",
  "workspaces",
  "work_sessions",
  "chapters",
  "volumes",
  "scenes",
  "characters",
  "memory_items",
  "ledger_entries",
  "author_action_receipts",
];

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function caseLeaf(t, label) {
  const leaf = fs.mkdtempSync(path.join(runScope.workDir, `${label}-`));
  t.after(() => fs.rmSync(leaf, { recursive: true, force: true }));
  return leaf;
}

function logsFixture() {
  return materializeFixture(sourceLogsFixtureSpec(), { scope: runScope });
}

function nativeSourceFixture() {
  return materializeFixture(nativeSourceFixtureSpec(), { scope: runScope });
}

function batchFixture() {
  return materializeFixture(initialBatchFixtureSpec(nativeSourceFixture()), { scope: runScope });
}

function sharedNativeManifest() {
  return materializeFixture(
    nativeManifestFixtureSpec({ source: nativeSourceFixture(), logs: logsFixture() }),
    { scope: runScope },
  );
}

// 正常 native case 的资源：共享日志/源/快照/manifest 只读借用，初始 batch 取可写副本；
// start checkpoint 的 DB/日志观察在 prepare/driver/calls 之前真实采集。
function nativeFixture(t, authorTurns = [1, 2, 3]) {
  const source = nativeSourceFixture();
  const manifestFixture = sharedNativeManifest();
  const manifestPath = manifestFixture.files.get("manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const batch = createWorkingCopy(batchFixture(), { scope: runScope, context: t });
  // 独立固定动作：启动/就绪/start，再逐作者输入就绪、输入、回合；不从 report/config 推导。
  const kinds = ["maintenance", "maintenance", "maintenance",
    ...authorTurns.flatMap(() => ["maintenance", "input", "turn"])];
  const waits = kinds.map((kind, index) => ({ id: "native-wait-" + index, kind, at: 1000 + index * 100 }));
  const common = materializeFixture(commonBatchFixtureSpec({
    scope: "b87-r01-request-cost",
    screenshots: ["workbench.jpg", ...authorTurns.map((turn) => `turn-${turn}.jpg`)],
    ledger: {
      commands: waits.flatMap((wait) => [{ ...wait, op: "begin" }, { id: wait.id, op: "finish" }]),
      events: waits.flatMap((wait) => [{ ...wait, event: "wait_start" },
        { ...wait, event: "wait_end", ended_at: wait.at + 50 }]),
      stats: { active: null, completed: waits.length },
    },
  }), { scope: runScope });
  const commonCopy = createWorkingCopy(common, { scope: runScope, context: t });
  for (const [name, file] of commonCopy.files) fs.copyFileSync(file, path.join(batch.dir, name));
  return {
    batchDir: batch.dir,
    manifestPath,
    manifest,
    snapshotDir: path.join(source.dir, SNAPSHOT_REL),
    texts: SOURCE_TEXTS,
    initial: observeCheckpoint(batch.dir, CHECKPOINT_START_AT),
  };
}

function historySource(t) {
  const copy = createWorkingCopy(logsFixture(), { scope: runScope, context: t });
  const llmLog = path.join(copy.dir, SOURCE_LOG_LLM);
  const appLog = path.join(copy.dir, SOURCE_LOG_APP);
  const manifest = historyCaptureManifest({ llmLog, appLog });
  // 日志副本本来就是 case 可写资源；manifest 与它同域，模板本身不含同名文件。
  const manifestPath = path.join(copy.dir, "manifest.json");
  writeJson(manifestPath, manifest);
  return { dir: copy.dir, llmLog, appLog, manifest, manifestPath, texts: SOURCE_TEXTS };
}

function prepare(fixture, length = 3) {
  return prepareBatch({
    manifestPath: fixture.manifestPath,
    batchDir: fixture.batchDir,
    length,
  });
}

function llmFile(batchDir) {
  return path.join(batchDir, "llm-calls", "2026-11-13.jsonl");
}

function readLlmRecords(batchDir) {
  const lines = fs.readFileSync(llmFile(batchDir), "utf8").trim().split("\n");
  return lines.map((line) => JSON.parse(line.slice(line.indexOf("{"))));
}

function writeLlmRecords(batchDir, records) {
  fs.writeFileSync(llmFile(batchDir), `${records.map(jsonlLine).join("\n")}\n`);
}

// 独立 oracle：只读实际 batch DB，不使用被测 capture 的计数投影。
function readProductionCounts(batchDir) {
  const db = new DatabaseSync(path.join(batchDir, BATCH_DB_REL), { readOnly: true });
  try {
    return Object.fromEntries(
      PRODUCTION_TABLES.map((table) => [
        table,
        Number(db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n),
      ]),
    );
  } finally {
    db.close();
  }
}

function treeHash(root) {
  const rows = fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      return `${path.relative(root, file)}:${digest}`;
    })
    .sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}


test("R03 预注册原文文件hash与3/10/20前缀计划由唯一loader核对，不循环、不造日志", (t) => {
  for (const length of [3, 10, 20]) {
    const fixture = nativeFixture(t);
    const manifest = structuredClone(fixture.manifest);
    manifest.source = { kind: "preregistered_author_inputs",
      path: "scripts/lib/native_ui/fixtures/r03-discussion-author-inputs.json",
      sha256: "9b0184254be47020e389eb2323a06f55ec49d1afaaeb0e0e5e7d0b6446694ae9", expected_turns: 20 };
    manifest.authors = preregisteredInputs.turns.map((turn, index) =>
      ({ id: turn.id, input_index: index, sha256: turn.sha256 }));
    manifest.runtime = { ...manifest.runtime, profile: "b87-r03-splash-product-maintenance-budget",
      context_pressure: { window: 32000, maintenance_ratio: 0.7 } };
    const manifestPath = path.join(fixture.batchDir, "r03-manifest.json");
    writeJson(manifestPath, manifest);
    const runtimeFile = path.join(fixture.batchDir, RUNTIME_FACTS_REL);
    const runtime = JSON.parse(fs.readFileSync(runtimeFile, "utf8"));
    runtime.context_pressure.window = 32000;
    writeJson(runtimeFile, runtime);
    const source = loadSourceAuthors(manifest);
    assert.equal(source.authors.length, 20);
    assert.equal(source.llmFile, undefined);
    const config = prepareBatch({ manifestPath, batchDir: fixture.batchDir, length });
    assert.deepEqual(config.plan.map((entry) => entry.author_id), preregisteredInputs.turns.slice(0, length).map((entry) => entry.id));
    assert.equal(new Set(config.plan.map((entry) => entry.author_sha256)).size, length);
    assert.deepEqual(config.compaction_history_check, { required: length >= 10, require_outside_initial_page: length === 20 });
    assert.deepEqual(config.preregistered_obligations.map((entry) => entry.id),
      preregisteredInputs.turns.slice(0, length).flatMap((entry) => entry.obligations.map((obligation) => obligation.id)));
    const wrongFileHash = structuredClone(manifest);
    wrongFileHash.source.sha256 = "0".repeat(64);
    assert.throws(() => loadSourceAuthors(wrongFileHash), /输入文件hash/u);
    const wrongTextHash = structuredClone(manifest);
    wrongTextHash.authors[0].sha256 = "0".repeat(64);
    assert.throws(() => loadSourceAuthors(wrongTextHash), /输入引用hash/u);
  }
});

test("冻结边界：history/frozen=false 不能 preflight；快照 hash/内容/运行清单/目标作品不符拒绝", (t) => {
  const source = nativeSourceFixture();
  const copy = createWorkingCopy(source, { scope: runScope, context: t });
  const snapshotDir = path.join(copy.dir, SNAPSHOT_REL);
  // 唯一的篡改 native manifest 反例：从共享只读声明取必需副本，不写共享模板。
  const sharedManifest = sharedNativeManifest();
  const manifestCopy = createWorkingCopy(sharedManifest, { scope: runScope, context: t });
  const manifestPath = manifestCopy.files.get("manifest.json");
  const base = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const outDir = path.join(manifestCopy.dir, "out");
  const write = (value) => writeJson(manifestPath, value);

  write({ ...base, frozen: false });
  assert.throws(() => preflightNative({ manifestPath, snapshotDir, outDir, length: 3 }), /frozen/);
  write(base);
  const preflight = preflightNative({ manifestPath, snapshotDir, outDir, length: 3 });
  assert.equal(preflight.ok, true);
  assert.equal(preflight.work.id, WORK_ID);
  assert.throws(() => preflightNative({ manifestPath, snapshotDir, outDir, length: 4 }), /length/);
  fs.mkdirSync(outDir, { recursive: true });
  assert.throws(() => preflightNative({ manifestPath, snapshotDir, outDir, length: 3 }), /存在|覆盖/);
  fs.rmdirSync(outDir);

  write({ ...base, snapshot: { ...base.snapshot, content_sha256: sha256Text("bad") } });
  assert.throws(() => preflightNative({ manifestPath, snapshotDir, outDir, length: 3 }), /内容 hash/);
  write({ ...base, snapshot: { ...base.snapshot, work_sha256: sha256Text("bad") } });
  assert.throws(() => preflightNative({ manifestPath, snapshotDir, outDir, length: 3 }), /manifest.json|work.sqlite3|hash/);
  write({ ...base, seed: { ...base.seed, work_id: "missing-work" } });
  assert.throws(() => preflightNative({ manifestPath, snapshotDir, outDir, length: 3 }), /不存在/);
  write(base);

  const snapshotManifest = path.join(snapshotDir, "manifest.json");
  const snapshotRaw = JSON.parse(fs.readFileSync(snapshotManifest, "utf8"));
  writeJson(snapshotManifest, {
    ...snapshotRaw,
    snapshot: {
      ...snapshotRaw.snapshot,
      run_inventory: {
        ...snapshotRaw.snapshot.run_inventory,
        runs_by_mode: { bounded: 1, durable: 1 },
      },
    },
  });
  // 安全判断来自实际 work DB；声明与事实不一致由对账拒绝（不是只信 JSON 标签）。
  assert.throws(() => preflightNative({ manifestPath, snapshotDir, outDir, length: 3 }), /不一致|bounded/);
  writeJson(snapshotManifest, snapshotRaw);

  const history = { ...base, mode: "history" };
  write(history);
  assert.throws(
    () => preflightNative({ manifestPath, snapshotDir, outDir: path.join(manifestCopy.dir, "x"), length: 3 }),
    /native/,
  );

  const batch = path.join(manifestCopy.dir, "restore");
  restoreSnapshot({ batchDir: batch, snapshotDir });
  assert.equal(fs.statSync(path.join(batch, "database", "ai_novel_studio_test.sqlite3")).mode & 0o777, 0o600);
  assert.throws(() => restoreSnapshot({ batchDir: batch, snapshotDir }), /存在|覆盖/);
});

test("loadSourceAuthors 逐字节验证作者，拒绝 application 头/改 hash", (t) => {
  const source = historySource(t);
  const loaded = loadSourceAuthors(source.manifest);
  assert.deepEqual(
    loaded.authors.map((author) => author.text),
    source.texts,
  );
  const forged = {
    ...source.manifest,
    authors: source.manifest.authors.map((author, index) =>
      index === 0 ? { ...author, message_index: 1 } : author,
    ),
  };
  assert.throws(() => loadSourceAuthors(forged), /author|应用|user/i);
  const changed = {
    ...source.manifest,
    authors: [
      { ...source.manifest.authors[0], sha256: sha256Text("别的内容") },
      source.manifest.authors[1],
      source.manifest.authors[2],
    ],
  };
  assert.throws(() => loadSourceAuthors(changed), /sha256|author/i);

  const drifted = historySource(t);
  fs.appendFileSync(drifted.llmLog, "\n");
  assert.throws(() => loadSourceAuthors(drifted.manifest), /sha256|行数/);
});

test("verify 对缺 pcall/错 session/错 work/错模型/错 reasoning/seed 变化硬失败", (t) => {
  const cases = [
    ["model", (record) => { record.request.body.model = "wrong-model"; }, /request_model_mismatch/],
    ["reasoning", (record) => { record.request.body.reasoning_effort = "low"; }, /reasoning_effort_mismatch/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const fixture = nativeFixture(t);
    prepare(fixture);
    const turns = writeDriverLog(fixture.batchDir);
    writeCalls(fixture.batchDir, turns);
    writeCheckpoints(fixture.batchDir, fixture.initial);
    const records = readLlmRecords(fixture.batchDir);
    mutate(records[0]);
    writeLlmRecords(fixture.batchDir, records);
    const report = verifyBatch({ batchDir: fixture.batchDir });
    assert.equal(report.status, "fail", name);
    assert.ok(report.failures.some((entry) => pattern.test(entry)), `${name}: ${report.failures}`);
  }

  // 准备边界反例：draft 在 start 观察前被改，start 必须反映实际 DB，故 setup_content
  // 与 prepare 声明的 seed 内容不一致；不把初始模板事实倒填这次负例。
  const fixture = nativeFixture(t);
  prepare(fixture);
  mutateDb(fixture.batchDir, (db) => {
    db.prepare("UPDATE drafts SET content = ? WHERE id = ?").run("运行中被改写正文", "draft-1");
  });
  const mutatedStart = observeCheckpoint(fixture.batchDir, CHECKPOINT_START_AT);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  writeCheckpoints(fixture.batchDir, mutatedStart);
  const report = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(report.status, "fail");
  assert.ok(report.failures.some((entry) => entry.startsWith("setup_content:")), report.failures);
});

test("verify 缺 turn/缺 ttft 只 partial，不伪造完成", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  turns.pop();
  const records = readLlmRecords(fixture.batchDir);
  writeLlmRecords(fixture.batchDir, records.slice(0, 4));
  writeJson(path.join(fixture.batchDir, "native-request-cost-driver-log.json"), {
    schema: "b87-request-cost-driver/v1",
    turns,
    completed: true,
  });
  writeCheckpoints(fixture.batchDir, fixture.initial);
  const report = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(report.status, "partial");
  assert.ok(report.failures.some((entry) => entry.includes("turns:2/3")), report.failures);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.batchDir, "summary.json"), "utf8")).all_checks_passed, false);

  const ttft = nativeFixture(t);
  prepare(ttft);
  const ttftTurns = writeDriverLog(ttft.batchDir);
  writeCalls(ttft.batchDir, ttftTurns);
  writeCheckpoints(ttft.batchDir, ttft.initial);
  const ttftRecords = readLlmRecords(ttft.batchDir);
  delete ttftRecords[0].response.usage.ttft_ms;
  writeLlmRecords(ttft.batchDir, ttftRecords);
  const ttftReport = verifyBatch({ batchDir: ttft.batchDir });
  assert.equal(ttftReport.status, "partial");
  assert.equal(JSON.parse(fs.readFileSync(path.join(ttft.batchDir, "summary.json"), "utf8")).all_checks_passed, false);
  assert.ok(ttftReport.not_collected.includes("turn_1_call_1_ttft"), ttftReport.not_collected);
});


test("native UI 身份、四图和十二条分型等待缺证不能生成可接受摘要，成本报告仍保留", (t) => {
  const edit = (dir, name, mutate) => {
    const file = path.join(dir, name), value = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(value); writeJson(file, value);
  };
  const cases = [
    (dir) => fs.unlinkSync(path.join(dir, "native-driver-ready.json")),
    (dir) => edit(dir, "native-driver-ready.json", (value) => { value.browser_driver_started = true; }),
    (dir) => edit(dir, "native-ui-complete.json", (value) => { value.harness_run_ref = "foreign-run"; }),
    (dir) => edit(dir, "native-ui-complete.json", (value) => { value.scope = "foreign-slice"; }),
    (dir) => edit(dir, "native-ui-complete.json", (value) => { value.driver = "headless-chromium"; }),
    (dir) => edit(dir, "native-ui-complete.json", (value) => { value.screenshots.pop(); }),
    (dir) => fs.unlinkSync(path.join(dir, "turn-3.jpg")),
    (dir) => edit(dir, "wait-stats.json", (value) => { value.completed = 11; }),
    (dir) => {
      const file = path.join(dir, "wait-events.jsonl");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll('"kind":"turn"', '"kind":"maintenance"'));
    },
  ];
  for (const mutate of cases) {
    const fixture = nativeFixture(t);
    prepare(fixture);
    const turns = writeDriverLog(fixture.batchDir);
    writeCalls(fixture.batchDir, turns);
    writeCheckpoints(fixture.batchDir, fixture.initial);
    mutate(fixture.batchDir);
    const report = verifyBatch({ batchDir: fixture.batchDir });
    assert.equal(report.status, "fail");
    assert.equal(report.checks.native_ui_evidence, false);
    assert.equal(report.turns.length, 3);
    assert.equal(fs.existsSync(path.join(fixture.batchDir, "request-cost-report.json")), true);
    assert.equal(fs.existsSync(path.join(fixture.batchDir, "summary.json")), false);
  }
});

test("loadSourceAuthors 对缺索引/非 user/非字符串/application 头/错 hash 全部硬失败", (t) => {
  const cases = [
    ["missing", (source) => { source.manifest.authors[0].message_index = 99; }, /索引不存在/],
    ["role", (_source, message) => { message.role = "assistant"; }, /必须是 user/],
    ["content", (_source, message) => { message.content = 123; }, /content 必须是字符串/],
    ["header", (_source, message) => { message.content = "【应用数据 · scope】x"; }, /application 消息/],
    ["hash", (_source, message) => { message.content = `${message.content}改`; }, /sha256 不符合/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const source = historySource(t);
    const records = fs.readFileSync(source.llmLog, "utf8").trim().split("\n");
    const record = JSON.parse(records[0].slice(records[0].indexOf("{")));
    const message = record.request.body.messages[source.manifest.authors[0].message_index];
    mutate(source, message, record);
    records[0] = jsonlLine(record);
    fs.writeFileSync(source.llmLog, `${records.join("\n")}\n`);
    source.manifest.source.sha256 = sha256Text(fs.readFileSync(source.llmLog, "utf8"));
    writeJson(source.manifestPath, source.manifest);
    assert.throws(() => loadSourceAuthors(source.manifest), pattern, name);
  }
});

test("历史 analyze：按 source line 复算，报告不含作者全文", async (t) => {
  const source = historySource(t);
  const records = fs.readFileSync(source.llmLog, "utf8").trim().split("\n");
  const firstRecord = JSON.parse(records[0].slice(records[0].indexOf("{")));
  firstRecord.response.usage = {
    ...firstRecord.response.usage,
    input_tokens: 0,
    cached_tokens: 0,
    output_tokens: 0,
    ttft_ms: 0,
  };
  records[0] = jsonlLine(firstRecord);
  const llmText = `${records.join("\n")}\n`;
  fs.writeFileSync(source.llmLog, llmText);

  // 覆盖真实应用日志值域：缺某轮事件、只有会话没有 turn_id 的事件。
  const appEvents = [
    { timestamp: "2026-11-11T00:00:00.000Z", event: "provider_gateway.complete.start", session_id: "session-1", turn_id: "turn-1" },
    { timestamp: "2026-11-11T00:00:01.000Z", event: "session.keepalive", session_id: "session-1" },
    { timestamp: "2026-11-11T00:00:02.000Z", event: "provider_gateway.complete.start", session_id: "session-1", turn_id: "turn-3" },
  ];
  const appText = `${appEvents.map((event) => JSON.stringify(event)).join("\n")}\n`;
  fs.writeFileSync(source.appLog, appText);
  source.manifest.source.sha256 = sha256Text(llmText);
  source.manifest.source.app_sha256 = sha256Text(appText);
  writeJson(source.manifestPath, source.manifest);

  const outDir = path.join(caseLeaf(t, "analyze-out"), "out");
  const report = await analyzeHistory({ manifestPath: source.manifestPath, outDir });
  assert.equal(report.status, "pass");
  assert.equal(report.calls.length, 3);
  assert.equal(report.calls[0].category_bytes.current_author, Buffer.byteLength("作者一"));
  assert.equal(report.calls[2].category_bytes.current_author, Buffer.byteLength("作者三"));
  assert.equal(report.calls[0].turn_id, "turn-1");
  assert.equal(report.calls[0].session_id, "session-1");
  assert.deepEqual(
    report.calls.map((call) => call.app_join.status),
    ["joined", "missing", "joined"],
  );
  assert.equal(report.calls[1].app_join.event_count, 0);
  assert.equal(report.summary.app_joined, 2);
  assert.equal(report.calls[0].usage.input_tokens, 0);
  assert.equal(report.calls[0].usage.cached_tokens, 0);
  assert.equal(report.calls[0].usage.output_tokens, 0);
  assert.equal(report.calls[0].usage.ttft_ms, 0);
  assert.equal(report.calls[0].usage.cost_input_tokens, 0);
  assert.equal(report.calls[1].usage.cost_input_tokens, 100);
  assert.equal(report.calls[2].usage.cost_input_tokens, 100);
  assert.equal(report.summary.raw_http_bytes, "not_collected");
  assert.equal(report.summary.raw_sse, "not_collected");
  const markdown = fs.readFileSync(path.join(outDir, "request-cost-before.md"), "utf8");
  const firstRow = markdown.split("\n").find((line) => line.startsWith("| round-1 |"));
  assert.ok(firstRow, markdown);
  assert.deepEqual(firstRow.split("|").map((cell) => cell.trim()).slice(14, 18), ["0", "0", "0", "0"]);
  const bytes = fs.readFileSync(path.join(outDir, "request-cost-before.json"), "utf8");
  assert.equal(bytes.includes("作者一"), false);
  assert.equal(bytes.includes("作者二😀"), false);
});

test("prepare：冻结 manifest + 真实 seed/DB 生成不含作者文本的 config", (t) => {
  const fixture = nativeFixture(t);
  const config = prepare(fixture);
  const snapshot = readSnapshotManifest(fixture.snapshotDir);
  assert.equal(config.length, 3);
  assert.equal(config.plan.length, 3);
  assert.deepEqual(
    config.plan.map((turn) => turn.author_id),
    ["round-1", "round-2", "round-3"],
  );
  assert.equal(config.work.title, "R01合成作品·副本");
  assert.equal(config.plan[0].target.id, "chapter-count");
  assert.deepEqual(
    config.semantic_targets.map((target) => target.id),
    ["chapter-count", "outline-anomaly", "outline-archive-only"],
  );
  assert.equal(config.setup.work.changed_fields.join(","), "revision,title,updated_at");
  assert.equal(config.setup.work.revision_before, 1);
  assert.equal(config.setup.work.revision_after, 2);
  assert.equal(config.setup.session.new_session_id, "session-1");
  assert.deepEqual(config.setup.session.exited_session_ids, ["session-old"]);
  // seed.new_session 是 prepare 已对账“本次真实建立新 session”的审计事实，不是可选装饰。
  assert.equal(config.seed.new_session, true);
  assert.equal(config.seed.source_content_sha256, snapshot.snapshot.business_content_sha256);
  assert.equal(config.model.model, MODEL.model);
  assert.equal(JSON.stringify(config).includes("作者一"), false);
  assert.throws(() => prepare(fixture, 10), /config|存在|覆盖/);
});

test("verify：完整 3 轮通过；错 turn join / 缺 usage / cached>input / 作者篡改分别失败", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  writeCheckpoints(fixture.batchDir, fixture.initial);
  // 正常数据必须自洽：start 来自 prepare 前的真实初始观察，final 来自 case 写入后的实际 DB。
  const start = JSON.parse(fs.readFileSync(path.join(fixture.batchDir, "request-cost-start.json"), "utf8"));
  const final = JSON.parse(fs.readFileSync(path.join(fixture.batchDir, "request-cost-final.json"), "utf8"));
  assert.deepEqual(start.production_counts, readProductionCounts(fixture.batchDir));
  assert.deepEqual(start.production_counts, {
    works: 1,
    workspaces: 0,
    work_sessions: 2,
    chapters: 0,
    volumes: 0,
    scenes: 0,
    characters: 0,
    memory_items: 2,
    ledger_entries: 0,
    author_action_receipts: 0,
  });
  assert.deepEqual(start.llm_calls, { files: 0, lines: 0 });
  assert.deepEqual(final.llm_calls, { files: 1, lines: 6 });
  // driver_turns 只从 driver 的实际 turns 数组取：start 前没有 driver=0，末态 3 轮=3。
  assert.equal(start.driver_turns, 0);
  assert.equal(final.driver_turns, 3);
  assert.deepEqual(final.production_counts, start.production_counts);
  assert.equal(start.at, CHECKPOINT_START_AT);
  assert.equal(final.at, CHECKPOINT_FINAL_AT);

  const pass = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(pass.status, "pass", JSON.stringify(pass.failures));
  const nativeSummary = JSON.parse(fs.readFileSync(path.join(fixture.batchDir, "summary.json"), "utf8"));
  assert.equal(nativeSummary.slice_id, "b87-r01-request-cost");
  assert.equal(nativeSummary.surface, "tauri-native");
  assert.equal(nativeSummary.driver, "ax-native-system-ui");
  assert.equal(nativeSummary.all_checks_passed, true);
  assert.equal(nativeSummary.status, "pass");
  assert.equal(pass.turns.length, 3);
  assert.equal(pass.turns[2].calls.length, 2);
  assert.equal(pass.checks.post_run_works_title_matches, true);
  assert.equal(pass.checks.post_run_works_revision_matches, true);
  assert.equal(pass.checks.post_run_session_active, true);
  assert.equal(pass.turns[0].calls[1].analysis.cross.purpose, "writer");
  assert.equal(pass.turns[0].calls[1].analysis.cross.writer_purpose, true);
  assert.equal(
    pass.turns[0].calls[1].analysis.cross.writer_input_bytes,
    pass.turns[0].calls[1].analysis.totals.content_utf8_bytes,
  );
  assert.equal(pass.summary.raw_sse, "not_collected");
  const reportMarkdown = fs.readFileSync(path.join(fixture.batchDir, "request-cost-report.md"), "utf8");
  const firstTurnRow = reportMarkdown.split("\n").find((line) => line.startsWith("| 1 |"));
  assert.ok(firstTurnRow, reportMarkdown);
  const firstTurnCells = firstTurnRow.split("|").map((cell) => cell.trim());
  assert.equal(
    Number(firstTurnCells[9]),
    pass.turns[0].calls.reduce((sum, call) => sum + call.analysis.category_bytes.current_author, 0),
  );
  assert.equal(
    Number(firstTurnCells[10]),
    pass.turns[0].calls.reduce((sum, call) => sum + call.analysis.totals.stable_json_bytes, 0),
  );

  const wrong = nativeFixture(t);
  prepare(wrong);
  const wrongTurns = writeDriverLog(wrong.batchDir);
  writeCalls(wrong.batchDir, wrongTurns);
  wrongTurns[1].turn_id = "turn-missing";
  writeJson(path.join(wrong.batchDir, "native-request-cost-driver-log.json"), {
    schema: "b87-request-cost-driver/v1",
    turns: wrongTurns,
    completed: true,
  });
  writeCheckpoints(wrong.batchDir, wrong.initial);
  assert.equal(verifyBatch({ batchDir: wrong.batchDir }).status, "fail");

  const missing = nativeFixture(t);
  prepare(missing);
  const missingTurns = writeDriverLog(missing.batchDir);
  writeCalls(missing.batchDir, missingTurns);
  writeCheckpoints(missing.batchDir, missing.initial);
  const missingRecords = readLlmRecords(missing.batchDir);
  delete missingRecords[0].response.usage;
  writeLlmRecords(missing.batchDir, missingRecords);
  const missingReport = verifyBatch({ batchDir: missing.batchDir });
  assert.equal(missingReport.status, "partial");
  assert.equal(missingReport.summary.input_tokens.total, null);
  assert.equal(missingReport.summary.input_tokens.missing_calls, 1);
  assert.equal(missingReport.summary.input_tokens.known_sum, 500);

  const cached = nativeFixture(t);
  prepare(cached);
  const cachedTurns = writeDriverLog(cached.batchDir);
  writeCalls(cached.batchDir, cachedTurns);
  writeCheckpoints(cached.batchDir, cached.initial);
  const cachedRecords = readLlmRecords(cached.batchDir);
  cachedRecords[0].response.usage.cached_tokens = 200;
  writeLlmRecords(cached.batchDir, cachedRecords);
  assert.equal(verifyBatch({ batchDir: cached.batchDir }).status, "fail");

  const tampered = nativeFixture(t);
  prepare(tampered);
  const tamperedTurns = writeDriverLog(tampered.batchDir);
  writeCalls(tampered.batchDir, tamperedTurns);
  writeCheckpoints(tampered.batchDir, tampered.initial);
  const tamperedRecords = readLlmRecords(tampered.batchDir);
  tamperedRecords[0].request.body.messages[3].content = "篡改后的作者输入";
  writeLlmRecords(tampered.batchDir, tamperedRecords);
  assert.equal(verifyBatch({ batchDir: tampered.batchDir }).status, "fail");

  const behavior = nativeFixture(t);
  prepare(behavior);
  const behaviorTurns = writeDriverLog(behavior.batchDir);
  behaviorTurns[1].visible_outcome = { kind: "failed" };
  writeJson(path.join(behavior.batchDir, "native-request-cost-driver-log.json"), {
    schema: "b87-request-cost-driver/v1",
    turns: behaviorTurns,
    completed: true,
  });
  writeCalls(behavior.batchDir, behaviorTurns);
  writeCheckpoints(behavior.batchDir, behavior.initial);
  const behaviorReport = verifyBatch({ batchDir: behavior.batchDir });
  assert.equal(behaviorReport.status, "pass", JSON.stringify(behaviorReport.failures));
  assert.equal(behaviorReport.model_behavior.signed, false);
  assert.equal(behaviorReport.model_behavior.outcome_counts.failed, 1);

  const production = nativeFixture(t);
  prepare(production);
  const productionTurns = writeDriverLog(production.batchDir);
  writeCalls(production.batchDir, productionTurns);
  writeCheckpoints(production.batchDir, production.initial);
  const finalFile = path.join(production.batchDir, "request-cost-final.json");
  const finalCheckpoint = JSON.parse(fs.readFileSync(finalFile, "utf8"));
  finalCheckpoint.production_counts.works = 2;
  writeJson(finalFile, finalCheckpoint);
  const productionReport = verifyBatch({ batchDir: production.batchDir });
  assert.equal(productionReport.status, "pass", JSON.stringify(productionReport.failures));
  assert.ok(productionReport.failures.some((failure) => failure.includes("production_changed")));
  assert.equal(productionReport.checks.production_counts_unchanged, false);
  assert.equal(productionReport.model_behavior.observed_effects.production_counts_changed, true);
  assert.equal(productionReport.model_behavior.signed, false);
  assert.equal(productionReport.semantic_review.signed, false);

  const repeated = nativeFixture(t, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  prepare(repeated, 10);
  const repeatedTurns = writeDriverLog(repeated.batchDir, 10);
  writeCalls(repeated.batchDir, repeatedTurns);
  writeCheckpoints(repeated.batchDir, repeated.initial);
  const repeatedReport = verifyBatch({ batchDir: repeated.batchDir });
  assert.equal(repeatedReport.status, "pass", JSON.stringify(repeatedReport.failures));
  assert.equal(repeatedReport.turns.length, 10);
  assert.equal(repeatedReport.turns[3].calls.length, 2);
  assert.equal(repeatedReport.turns[3].calls[0].analysis.cross.author_text_occurrences, 2);
  assert.equal(
    repeatedReport.turns[3].calls[0].analysis.category_bytes.current_author,
    Buffer.byteLength(repeated.texts[0]),
  );

  const ambiguous = nativeFixture(t);
  prepare(ambiguous);
  const ambiguousTurns = writeDriverLog(ambiguous.batchDir);
  writeCalls(ambiguous.batchDir, ambiguousTurns);
  const ambiguousRecords = readLlmRecords(ambiguous.batchDir);
  ambiguousRecords[0].request.body.messages.push({ role: "user", content: "第二条独立输入" });
  writeLlmRecords(ambiguous.batchDir, ambiguousRecords);
  writeCheckpoints(ambiguous.batchDir, ambiguous.initial);
  assert.equal(verifyBatch({ batchDir: ambiguous.batchDir }).status, "fail");

  const reportPath = path.join(behavior.batchDir, "request-cost-report.json");
  const firstReport = fs.readFileSync(reportPath, "utf8");
  verifyBatch({ batchDir: behavior.batchDir });
  assert.equal(fs.readFileSync(reportPath, "utf8"), firstReport);

  const duplicate = nativeFixture(t);
  prepare(duplicate);
  const duplicateTurns = writeDriverLog(duplicate.batchDir);
  writeCalls(duplicate.batchDir, duplicateTurns);
  writeCheckpoints(duplicate.batchDir, duplicate.initial);
  const duplicateRecords = readLlmRecords(duplicate.batchDir);
  const duplicateSecond = { ...duplicateRecords[1], turn_id: "turn-2-duplicate" };
  writeLlmRecords(duplicate.batchDir, [...duplicateRecords, duplicateSecond]);
  const duplicateReport = verifyBatch({ batchDir: duplicate.batchDir });
  assert.equal(duplicateReport.status, "fail");
  assert.ok(
    duplicateReport.failures.some((failure) => /duplicate|native_call_join/.test(failure)),
    JSON.stringify(duplicateReport.failures),
  );
});

test("captureBatch 只写 start/final，不覆盖", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const initialCounts = readProductionCounts(fixture.batchDir);
  const start = captureBatch({ batchDir: fixture.batchDir, checkpoint: "start" });
  assert.equal(start.checkpoint, "start");
  assert.deepEqual(start.llm_calls, { files: 0, lines: 0 });
  assert.equal(start.driver_turns, 0);
  assert.deepEqual(start.production_counts, initialCounts);
  assert.match(start.business_content_sha256, /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(path.join(fixture.batchDir, "request-cost-start.json")));
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  const final = captureBatch({ batchDir: fixture.batchDir, checkpoint: "final" });
  assert.equal(final.checkpoint, "final");
  const finalCounts = readProductionCounts(fixture.batchDir);
  assert.deepEqual(final.production_counts, finalCounts);
  assert.deepEqual(final.production_counts, start.production_counts);
  // 实际 producer 的末态由 3 轮 × 每轮 2 次调用的独立声明给出，不用同一 fixture helper 自证。
  assert.deepEqual(final.llm_calls, { files: 1, lines: 6 });
  // 保留 llmLineCount 的现役消费者：它只是日志行数投影，不作为 SUT 期望来源。
  assert.equal(llmLineCount(fixture.batchDir), 6);
  assert.equal(final.driver_turns, 3);
  assert.equal(final.business_content_sha256, start.business_content_sha256);
  assert.throws(
    () => captureBatch({ batchDir: fixture.batchDir, checkpoint: "start" }),
    /存在|覆盖/,
  );
});

test("薄 CLI main 的成功/partial 退出码", (t) => {
  const original = process.exitCode;
  try {
    const fixture = nativeFixture(t);
    const outDir = path.join(caseLeaf(t, "cli-out"), "out");
    process.exitCode = 0;
    main(["analyze", fixture.manifestPath, outDir]);
    assert.equal(process.exitCode, 0);
    main(["prepare", fixture.manifestPath, fixture.batchDir, "--length", "3"]);
    assert.equal(process.exitCode, 0);
    const turns = writeDriverLog(fixture.batchDir);
    writeCalls(fixture.batchDir, turns);
    writeCheckpoints(fixture.batchDir, fixture.initial);
    main(["verify", fixture.batchDir]);
    assert.equal(process.exitCode, 0);

    const partial = nativeFixture(t);
    prepare(partial);
    const partialTurns = writeDriverLog(partial.batchDir);
    writeCalls(partial.batchDir, partialTurns);
    writeCheckpoints(partial.batchDir, partial.initial);
    const records = readLlmRecords(partial.batchDir);
    delete records[0].response.usage;
    writeLlmRecords(partial.batchDir, records);
    main(["verify", partial.batchDir]);
    assert.equal(process.exitCode, 65);
  } finally {
    process.exitCode = original;
  }
});

test("启动前已有模型调用或复用旧 pcall 必须真实失败，不删记录变绿", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  writeCheckpoints(fixture.batchDir, fixture.initial);
  const startFile = path.join(fixture.batchDir, "request-cost-start.json");
  const start = JSON.parse(fs.readFileSync(startFile, "utf8"));
  start.llm_calls.lines = 1;
  writeJson(startFile, start);
  const report = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(report.status, "fail");
  assert.ok(report.failures.some((entry) => entry.startsWith("no_calls_before_start:")), report.failures);

  const reuse = nativeFixture(t);
  prepare(reuse);
  const reuseTurns = writeDriverLog(reuse.batchDir);
  writeCalls(reuse.batchDir, reuseTurns);
  const records = readLlmRecords(reuse.batchDir);
  records[0].provider_call_ref = "old-pcall";
  writeLlmRecords(reuse.batchDir, records);
  writeCheckpoints(reuse.batchDir, reuse.initial);
  const reuseReport = verifyBatch({ batchDir: reuse.batchDir });
  assert.equal(reuseReport.status, "fail");
  assert.ok(
    reuseReport.failures.some((entry) => entry.startsWith("no_old_provider_call_reuse:")),
    reuseReport.failures,
  );
});

test("runtime facts 缺失/不一致/批次中被改写：prepare 明确失败，verify 报 fail 不跳过", (t) => {
  const missing = nativeFixture(t);
  fs.rmSync(path.join(missing.batchDir, RUNTIME_FACTS_REL));
  assert.throws(() => prepare(missing), /runtime-facts/);

  const mismatch = nativeFixture(t);
  const mismatchFacts = path.join(mismatch.batchDir, RUNTIME_FACTS_REL);
  const mismatchJson = JSON.parse(fs.readFileSync(mismatchFacts, "utf8"));
  mismatchJson.provider.model = "wrong-model";
  writeJson(mismatchFacts, mismatchJson);
  assert.throws(() => prepare(mismatch), /model/);

  for (const [name, mutate, pattern] of [
    ["missing", (file) => fs.rmSync(file), /runtime_facts_missing/],
    [
      "wrong-model",
      (file) => {
        const facts = JSON.parse(fs.readFileSync(file, "utf8"));
        facts.provider.model = "wrong-model";
        writeJson(file, facts);
      },
      /runtime_facts.*model/,
    ],
    ["changed", (file) => fs.appendFileSync(file, "\n"), /runtime_facts_changed_during_run/],
  ]) {
    const fixture = nativeFixture(t);
    prepare(fixture);
    const turns = writeDriverLog(fixture.batchDir);
    writeCalls(fixture.batchDir, turns);
    writeCheckpoints(fixture.batchDir, fixture.initial);
    mutate(path.join(fixture.batchDir, RUNTIME_FACTS_REL));
    const report = verifyBatch({ batchDir: fixture.batchDir });
    assert.equal(report.status, "fail", name);
    assert.ok(report.failures.some((entry) => pattern.test(entry)), `${name}: ${report.failures}`);
  }
});

test("运行期引用记账：正常目标只读+新日志/计数 accounted；无日志计数/内容/他作/旧日志改写分别失败", (t) => {
  const START = "2026-11-13T00:00:00.000000Z";
  const FINAL = "2026-11-13T00:00:10.000000Z";
  const NEW_LOG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const NEW_AT = "2026-11-13T00:00:05.000000Z";
  const cases = [
    [
      "ok",
      (db) => {
        db.prepare("INSERT INTO memory_reference_logs VALUES (?,?,?,?,?,?,?,?)").run(
          NEW_LOG,
          "88888888-8888-4888-8888-888888888888",
          WORK_ID,
          null,
          null,
          "dialogue_context",
          "dialogue recall matched author input: 目标记忆正文",
          NEW_AT,
        );
        db.prepare(
          "UPDATE memory_items SET reference_count = reference_count + 1, last_referenced_at = ? WHERE id = ?",
        ).run(NEW_AT, "88888888-8888-4888-8888-888888888888");
      },
      null,
    ],
    [
      "count-only",
      (db) => {
        db.prepare(
          "UPDATE memory_items SET reference_count = reference_count + 1, last_referenced_at = ? WHERE id = ?",
        ).run(NEW_AT, "88888888-8888-4888-8888-888888888888");
      },
      /memory_reference_updates_unaccounted/,
    ],
    [
      "memory-content",
      (db) => {
        db.prepare("UPDATE memory_items SET content = ? WHERE id = ?").run(
          "被改写的记忆正文",
          "88888888-8888-4888-8888-888888888888",
        );
      },
      /runtime_canon_content_changed|setup_content/,
    ],
    [
      "draft-content",
      (db) => {
        db.prepare("UPDATE drafts SET content = ? WHERE id = ?").run("被改写的受测正文", "draft-1");
      },
      /runtime_canon_content_changed|setup_content/,
    ],
    [
      "other-work",
      (db) => {
        db.prepare("INSERT INTO memory_reference_logs VALUES (?,?,?,?,?,?,?,?)").run(
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          "99999999-9999-4999-8999-999999999999",
          "22222222-2222-4222-8222-222222222222",
          null,
          null,
          "dialogue_context",
          "dialogue context recall",
          NEW_AT,
        );
        db.prepare(
          "UPDATE memory_items SET reference_count = reference_count + 1, last_referenced_at = ? WHERE id = ?",
        ).run(NEW_AT, "99999999-9999-4999-8999-999999999999");
      },
      /reference_logs_other_work|other_work_reference_changed/,
    ],
    [
      "old-log-rewrite",
      (db) => {
        db.prepare("UPDATE memory_reference_logs SET reference_reason = ? WHERE id = ?").run(
          "被改写的旧理由",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        );
      },
      /memory_reference_updates_unaccounted/,
    ],
  ];

  for (const [name, mutate, failure] of cases) {
    const fixture = nativeFixture(t);
    prepare(fixture);
    const turns = writeDriverLog(fixture.batchDir);
    writeCalls(fixture.batchDir, turns);
    writeCheckpointAt(fixture.batchDir, "start", START, 0);
    mutateDb(fixture.batchDir, mutate);
    writeCheckpointAt(fixture.batchDir, "final", FINAL, llmLineCount(fixture.batchDir));
    const report = verifyBatch({ batchDir: fixture.batchDir });
    if (failure === null) {
      assert.equal(report.status, "pass", `${name}: ${report.failures}`);
      assert.equal(report.checks.memory_reference_updates_accounted, true, name);
      assert.equal(report.checks.reference_accounting_present, true, name);
      assert.equal(report.reference_accounting.reference_logs.added, 1, name);
      assert.equal(report.reference_accounting.reference_count_delta, 1, name);
      assert.equal(report.evidence_boundaries.data_validity.reference_logs, 1, name);
      assert.deepEqual(report.evidence_boundaries.reader_errors, [], name);
      assert.match(report.evidence_boundaries.model_semantics, /待独立评审/, name);
    } else {
      // 观测到的变化是完整采集下的事实，不是测量失败；必须暴露且绝不签语义正确。
      assert.equal(report.status, "pass", `${name}: ${JSON.stringify(report.failures)}`);
      assert.ok(report.failures.some((entry) => failure.test(entry)), `${name}: ${report.failures}`);
      assert.equal(report.model_behavior.signed, false, name);
      assert.equal(report.semantic_review.signed, false, name);
      assert.ok(
        Object.values(report.model_behavior.observed_effects).some((value) => value === true) ||
          Object.values(report.model_behavior.reference_invariants).some((value) => value === true),
        `${name}: 观测事实/引用不变量未暴露`,
      );
    }
  }
});

test("他作引用记账独立观测：不变、仅计数变化、仅时间变化均不依赖新增日志", (t) => {
  const otherMemoryId = "99999999-9999-4999-8999-999999999999";
  const cases = [
    ["unchanged", null, true],
    [
      "count-only",
      (db) => {
        db.prepare("UPDATE memory_items SET reference_count = reference_count + 1 WHERE id = ?").run(
          otherMemoryId,
        );
      },
      false,
    ],
    [
      "timestamp-only",
      (db) => {
        db.prepare("UPDATE memory_items SET last_referenced_at = ? WHERE id = ?").run(
          "2026-11-13T00:00:05.000000Z",
          otherMemoryId,
        );
      },
      false,
    ],
  ];

  for (const [name, mutate, intact] of cases) {
    const fixture = nativeFixture(t);
    prepare(fixture);
    const turns = writeDriverLog(fixture.batchDir);
    writeCalls(fixture.batchDir, turns);
    writeCheckpointAt(fixture.batchDir, "start", CHECKPOINT_START_AT, 0);
    if (mutate) mutateDb(fixture.batchDir, mutate);
    writeCheckpointAt(fixture.batchDir, "final", CHECKPOINT_FINAL_AT, llmLineCount(fixture.batchDir));

    const report = verifyBatch({ batchDir: fixture.batchDir });
    assert.equal(report.status, "pass", `${name}: ${JSON.stringify(report.failures)}`);
    assert.equal(report.reference_accounting.reference_logs.added, 0, name);
    assert.equal(report.checks.reference_logs_target_work_only, true, name);
    assert.equal(report.checks.other_work_reference_bookkeeping_intact, intact, name);
    assert.equal(
      report.failures.includes(
        "other_work_reference_bookkeeping_intact:other_work_reference_changed",
      ),
      !intact,
      `${name}: ${report.failures}`,
    );
    assert.equal(report.model_behavior.signed, false, name);
    assert.equal(report.semantic_review.signed, false, name);
  }
});

test("缺 start/final checkpoint 只记缺证，不伪造调用前/变化/未变事实", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);

  const report = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(report.status, "partial", JSON.stringify(report.failures));
  assert.equal(report.checks.no_calls_before_start, null);
  assert.equal(report.checks.production_counts_present, null);
  assert.equal(report.checks.production_counts_unchanged, null);
  assert.equal(report.checks.reference_accounting_present, null);
  assert.equal(report.reference_accounting, null);
  assert.equal(
    report.failures.some((entry) => entry.includes("undeclared_model_calls_before_start")),
    false,
    JSON.stringify(report.failures),
  );
  assert.equal(
    report.failures.some((entry) => entry.includes("production_changed")),
    false,
    JSON.stringify(report.failures),
  );
  assert.ok(report.not_collected.includes("start_checkpoint"));
  assert.ok(report.not_collected.includes("production_counts"));
  assert.ok(report.not_collected.includes("reference_accounting"));
  assert.equal(report.model_behavior.observed_effects.production_counts_changed, null);
  assert.equal(report.model_behavior.observed_effects.business_content_changed, null);
});

test("start checkpoint 缺明确 business_content_sha256 只记缺证，不从 authoring_canon 自算", (t) => {
  for (const missing of [undefined, ""]) {
    const fixture = nativeFixture(t);
    prepare(fixture);
    const turns = writeDriverLog(fixture.batchDir);
    writeCalls(fixture.batchDir, turns);
    writeCheckpoints(fixture.batchDir, fixture.initial);
    const startFile = path.join(fixture.batchDir, "request-cost-start.json");
    const start = JSON.parse(fs.readFileSync(startFile, "utf8"));
    if (missing === undefined) delete start.business_content_sha256;
    else start.business_content_sha256 = missing;
    writeJson(startFile, start);

    const report = verifyBatch({ batchDir: fixture.batchDir });
    assert.equal(report.status, "partial", `${missing}: ${JSON.stringify(report.failures)}`);
    assert.equal(report.checks.setup_content, null);
    assert.ok(report.not_collected.includes("start_checkpoint"));
    assert.equal(
      report.failures.some((entry) => entry.startsWith("setup_content:")),
      false,
      `${missing}: ${JSON.stringify(report.failures)}`,
    );
  }
});

test("0 条 llm 记录时 wire 未观察，不写 wire 不匹配", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  writeDriverLog(fixture.batchDir);

  const report = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(report.checks.runtime_wire_match, null);
  assert.equal(
    report.failures.some((entry) => entry.includes("wire_model_or_effort_mismatch")),
    false,
    JSON.stringify(report.failures),
  );
  assert.ok(report.not_collected.includes("runtime_wire"));
  // 没有任何 llm 记录时，复用/绑定都无从观察；不能把它们当成“已证明全部绑定、无复用”。
  assert.equal(report.checks.no_old_provider_call_reuse, null);
  assert.equal(report.checks.all_llm_calls_bound, null);
  assert.ok(report.not_collected.includes("llm_calls"));
});

test("运行期真实内容变化完整记录：measurement pass 但不签语义正确", (t) => {
  const START = "2026-11-13T00:00:00.000000Z";
  const FINAL = "2026-11-13T00:00:10.000000Z";
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  writeCheckpointAt(fixture.batchDir, "start", START, 0);
  mutateDb(fixture.batchDir, (db) => {
    db.prepare("UPDATE drafts SET content = ? WHERE id = ?").run("运行期被真实改写的正文", "draft-1");
    db.prepare("UPDATE works SET revision = revision + 2 WHERE id = ?").run(WORK_ID);
  });
  writeCheckpointAt(fixture.batchDir, "final", FINAL, llmLineCount(fixture.batchDir));

  const report = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(report.status, "pass", JSON.stringify(report.failures));
  assert.equal(report.checks.runtime_content_intact, false);
  assert.equal(report.checks.runtime_business_content_intact, false);
  assert.ok(
    report.failures.some((entry) => entry.includes("runtime_canon_content_changed")),
    JSON.stringify(report.failures),
  );
  assert.equal(report.model_behavior.observed_effects.business_content_changed, true);
  assert.equal(report.model_behavior.observed_effects.canon_content_changed, true);
  assert.equal(report.checks.post_run_works_revision_matches, false);
  assert.equal(report.model_behavior.observed_effects.works_revision_changed, true);
  assert.equal(report.model_behavior.signed, false);
  assert.equal(report.semantic_review.signed, false);
  assert.ok(report.reference_accounting);
  assert.equal(report.checks.memory_reference_updates_accounted, true);
});

test("事后完整性：ProviderRun 仍 running 或缺完成日志只标缺证/partial，不伪装0调用", (t) => {
  const insertRun = (db, { id, pcall, status, sessionId }) => {
    db.prepare(
      "INSERT INTO provider_runs (id, provider_call_ref, session_id, purpose, status) VALUES (?,?,?,?,?)",
    ).run(id, pcall, sessionId, "planner", status);
  };

  for (const [name, status, expectedGap, expectedCheck] of [
    ["running", "running", "provider_run_incomplete", "provider_runs_terminal"],
    ["missing-log", "completed", "provider_call_log_missing", "provider_call_logs_complete"],
  ]) {
    const fixture = nativeFixture(t);
    prepare(fixture);
    const turns = writeDriverLog(fixture.batchDir);
    writeCalls(fixture.batchDir, turns);
    writeCheckpoints(fixture.batchDir, fixture.initial);
    const config = JSON.parse(
      fs.readFileSync(path.join(fixture.batchDir, "native-request-cost-config.json"), "utf8"),
    );
    mutateDb(fixture.batchDir, (db) => {
      insertRun(db, {
        id: `prun-${name}`,
        pcall: `pcall-${name}`,
        status,
        sessionId: config.session_id,
      });
    });
    const report = verifyBatch({ batchDir: fixture.batchDir });
    assert.equal(report.status, "partial", `${name}: ${JSON.stringify(report.failures)}`);
    assert.equal(report.checks[expectedCheck], false, name);
    assert.ok(report.not_collected.includes(expectedGap), `${name}: ${report.not_collected}`);
  }
});

test("verifyBatch 支持独立 out，不覆盖批次原件", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  writeCheckpoints(fixture.batchDir, fixture.initial);
  const outDir = path.join(caseLeaf(t, "independent-out-report-dir"), "derived-out");
  fs.mkdirSync(outDir, { recursive: true });
  const sentinel = path.join(outDir, "request-cost-report.json");
  writeJson(sentinel, { schema: "sentinel" });
  const sentinelText = fs.readFileSync(sentinel, "utf8");
  const report = verifyBatch({ batchDir: fixture.batchDir, outDir });
  assert.equal(fs.readFileSync(sentinel, "utf8"), sentinelText);
  assert.ok(
    fs.readdirSync(outDir).some((name) => /^request-cost-report\..+\.json$/u.test(name)),
  );
  assert.equal(fs.existsSync(path.join(outDir, "request-cost-report.json")), true);
  assert.equal(fs.existsSync(path.join(fixture.batchDir, "request-cost-report.json")), false);
  const summaryFile = path.join(outDir, "summary.json");
  const firstSummary = fs.readFileSync(summaryFile, "utf8");
  assert.equal(JSON.parse(firstSummary).all_checks_passed, true);
  assert.equal(JSON.parse(firstSummary).slice_id, "b87-r01-request-cost");
  assert.equal(JSON.parse(firstSummary).surface, "tauri-native");
  assert.equal(fs.existsSync(path.join(outDir, "native-ui-complete.json")), false);
  assert.equal(fs.existsSync(path.join(fixture.batchDir, "summary.json")), false);
  const repeated = verifyBatch({ batchDir: fixture.batchDir, outDir });
  assert.equal(repeated.status, "pass");
  assert.equal(fs.readFileSync(summaryFile, "utf8"), firstSummary);
  const derivedSummaries = fs.readdirSync(outDir).filter((name) => /^summary\..+\.json$/u.test(name));
  assert.equal(derivedSummaries.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, derivedSummaries[0]), "utf8")).status, "pass");
  assert.equal(report.batch.dir, path.resolve(fixture.batchDir));
});

test("请求观察：记录 model/effort/max_tokens 与按 step 温度，不冒充 raw HTTP/SSE", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  writeCheckpoints(fixture.batchDir, fixture.initial);

  const report = verifyBatch({ batchDir: fixture.batchDir });
  const observation = report.request_observation;
  assert.equal(observation.source, "llm_calls_request_body");
  assert.equal(observation.raw_http_or_sse, "not_collected");
  assert.deepEqual(observation.model, [MODEL.model]);
  assert.deepEqual(observation.reasoning_effort, [MODEL.reasoning_effort]);
  assert.deepEqual(observation.max_tokens, [MODEL.max_tokens]);
  assert.deepEqual(observation.temperature_by_step, { judgment: [0.2] });
  assert.match(observation.temperature_note, /不得统一断言同一温度/);
  assert.equal(report.checks.runtime_wire_match, true);
});

test("请求观察：max_tokens 与冻结参数不符时 wire 硬失败", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  const file = llmFile(fixture.batchDir);
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replaceAll(`"max_tokens":${MODEL.max_tokens}`, '"max_tokens":1000'),
  );
  writeCheckpoints(fixture.batchDir, fixture.initial);

  const report = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(report.status, "fail");
  assert.ok(
    report.failures.some((entry) => entry.includes("wire_model_effort_or_max_tokens_mismatch")),
    JSON.stringify(report.failures),
  );
  assert.deepEqual(report.request_observation.max_tokens, [1000]);
});

test("verifyBatch 缺 driver/缺 turns fail closed，不崩溃也不伪零", (t) => {
  const missing = nativeFixture(t);
  prepare(missing);
  const missingTurns = writeDriverLog(missing.batchDir);
  writeCalls(missing.batchDir, missingTurns);
  writeCheckpoints(missing.batchDir, missing.initial);
  fs.rmSync(path.join(missing.batchDir, "native-request-cost-driver-log.json"));
  const missingReport = verifyBatch({ batchDir: missing.batchDir });
  assert.equal(missingReport.status, "fail");
  assert.equal(missingReport.checks.driver_present, false);
  assert.ok(
    missingReport.failures.some((entry) => entry.startsWith("driver_log:missing")),
    JSON.stringify(missingReport.failures),
  );

  const noTurns = nativeFixture(t);
  prepare(noTurns);
  const turns = writeDriverLog(noTurns.batchDir);
  writeCalls(noTurns.batchDir, turns);
  writeCheckpoints(noTurns.batchDir, noTurns.initial);
  writeJson(path.join(noTurns.batchDir, "native-request-cost-driver-log.json"), {
    schema: "b87-request-cost-driver/v1",
    completed: true,
  });
  const noTurnsReport = verifyBatch({ batchDir: noTurns.batchDir });
  assert.equal(noTurnsReport.status, "fail");
  assert.equal(noTurnsReport.checks.turn_count_ok, false);
  assert.equal(noTurnsReport.checks.visible_outcomes_recorded, false);
  assert.equal(noTurnsReport.checks.freshness_recorded, false);
});

test("observeCheckpoint 遇到坏 driver 声明明确失败，不把坏形状伪造成 0 轮", (t) => {
  const nonArray = nativeFixture(t);
  // 缺 driver 的已知初始状态仍是 0，不被坏形状规则误伤。
  assert.equal(nonArray.initial.driver_turns, 0);
  writeJson(path.join(nonArray.batchDir, "native-request-cost-driver-log.json"), {
    schema: "b87-request-cost-driver/v1",
    turns: "turn-1",
    completed: true,
  });
  assert.throws(
    () => observeCheckpoint(nonArray.batchDir, CHECKPOINT_FINAL_AT),
    /driver 日志 turns 必须是数组/,
  );

  const malformed = nativeFixture(t);
  fs.writeFileSync(
    path.join(malformed.batchDir, "native-request-cost-driver-log.json"),
    "{",
  );
  // 文件读/parse 错误仍暴露，不吞成 0 轮。
  assert.throws(() => observeCheckpoint(malformed.batchDir, CHECKPOINT_FINAL_AT), SyntaxError);
});

test("verifyBatch 空 outDir 明确拒绝；独立 outDir 不改批次原件", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  writeCheckpoints(fixture.batchDir, fixture.initial);
  const before = treeHash(fixture.batchDir);
  assert.throws(() => verifyBatch({ batchDir: fixture.batchDir, outDir: "" }), /outDir|不能为空/);
  const outDir = path.join(caseLeaf(t, "outdir-empty-out"), "independent-out");
  const report = verifyBatch({ batchDir: fixture.batchDir, outDir });
  assert.equal(report.status, "pass", JSON.stringify(report.failures));
  assert.equal(report.checks.config_frozen, true);
  assert.equal(report.checks.manifest_hash_ok, true);
  assert.equal(treeHash(fixture.batchDir), before);
  assert.ok(fs.existsSync(path.join(outDir, "request-cost-report.json")));
});

test("prepare 以实际 source 对账恢复记录：清单声明被改写必须拒绝", (t) => {
  const fixture = nativeFixture(t);
  const recordFile = path.join(fixture.batchDir, "request-cost-snapshot.json");
  const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  record.snapshot.run_inventory = {
    ...record.snapshot.run_inventory,
    provider_run_count: 99,
  };
  writeJson(recordFile, record);
  assert.throws(() => prepare(fixture), /不一致/);
});

test("prepare 以实际 batch DB 判断：恢复记录安全但 batch 被改成危险状态必须拒绝", (t) => {
  const fixture = nativeFixture(t);
  mutateDb(fixture.batchDir, (db) => {
    db.prepare("INSERT INTO agent_runs (id, run_mode) VALUES (?,?)").run("batch-durable", "durable");
  });
  assert.throws(() => prepare(fixture), /非 bounded/);
});

test("verify 运行清单读取失败按缺证 partial，不伪报 unsafe", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  writeCheckpoints(fixture.batchDir, fixture.initial);

  // 完整正常批次仍 pass，证明新增缺证分类没有改变正常路径。
  const normal = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(normal.status, "pass", JSON.stringify(normal.failures));

  // 在 case 自有 batch DB 的真实 SQL 边界制造读取故障（缺表）。
  mutateDb(fixture.batchDir, (db) => db.exec("DROP TABLE long_run_tasks"));
  const report = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(report.checks.run_inventory_safe, null);
  assert.equal(report.not_collected.includes("run_inventory"), true);
  assert.equal(report.measurement_status, "partial");
  assert.equal(report.status, "partial");
  assert.equal(
    report.failures.some((entry) => entry.includes("unsafe_run_inventory_in_batch")),
    false,
  );
});

test("verify 实际 batch 出现危险运行清单时 fail 为 unsafe", (t) => {
  const fixture = nativeFixture(t);
  prepare(fixture);
  const turns = writeDriverLog(fixture.batchDir);
  writeCalls(fixture.batchDir, turns);
  writeCheckpoints(fixture.batchDir, fixture.initial);
  mutateDb(fixture.batchDir, (db) => {
    db.prepare("INSERT INTO agent_runs (id, run_mode) VALUES (?,?)").run("batch-durable", "durable");
  });
  const report = verifyBatch({ batchDir: fixture.batchDir });
  assert.equal(report.checks.run_inventory_safe, false);
  assert.equal(
    report.failures.some((entry) => entry.includes("unsafe_run_inventory_in_batch")),
    true,
  );
  assert.equal(report.status, "fail");
  assert.equal(report.measurement_status, "fail");
});
