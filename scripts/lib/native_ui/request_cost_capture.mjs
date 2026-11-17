// B87 R01 外部证据 IO 边界：快照采集/恢复、source/日志/DB 读取、原生 prepare/capture/verify
// 与报告落盘。只调用 manifest/batch_evidence/request_cost_evidence 与现役 evidence reader；
// 不调用模型、不启动 UI、不修改产品。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { analyzeRequestCost } from "./request_cost_evidence.mjs";
import { compareAuthoringCanonSnapshots } from "./authoring_canon_evidence.mjs";
import {
  FROZEN_FULL,
  FROZEN_FULL_SHA256,
  assertFrozenFullPath,
  assertRunInventoryMatches,
  assertSnapshotRunInventory,
  contentCanonSha,
  createCompleteSnapshot,
  readRunInventory,
  readSnapshotManifest,
  readSnapshotRecord,
  reconcileSetupDelta,
  restoreSnapshot as restoreCompleteSnapshot,
  sha256File,
} from "./request_cost_snapshot.mjs";
import {
  NATIVE_REPORT_SCHEMA,
  buildNativeReport,
  joinRootRun,
  verifyCheckpoints,
  verifyConfigMatches,
  verifyDriverShape,
  verifyTurns,
} from "./request_cost_batch_evidence.mjs";
import {
  LENGTHS,
  tokenAggregate,
  validateManifest,
} from "./request_cost_manifest.mjs";
import {
  businessContentCanonSha,
  businessContentSha,
  contentCanonSnapshot,
  referenceLogsSignature,
} from "./request_cost_snapshot.mjs";
import { assertRuntimeFacts } from "./request_cost_runtime_recipe.mjs";
import {
  ROOT,
  all,
  jsonl,
  logs,
  productionTableCounts,
  seedFields,
  withDb,
} from "./scenario_evidence.mjs";
import { readAuthoringHistory } from "./authoring_history_evidence.mjs";
import {
  joinNativeCallEvidence,
  providerOperation,
  readProviderRuns,
} from "./authoring_call_evidence.mjs";

export const CONFIG_SCHEMA = "b87-r01-request-cost-native-config/v3";
const RUNTIME_FACTS_FILE = "runtime-facts.json";
export const BEFORE_SCHEMA = "b87-request-cost-before/v1";
const CHECKPOINTS = new Set(["start", "final"]);

const list = (value) => (Array.isArray(value) ? value : []);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const sha256 = (value) => createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
const shaFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const resolvePath = (value) => path.resolve(ROOT, value);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function derivedFile(file) {
  if (!fs.existsSync(file)) return file;
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const extension = path.extname(file);
  return `${file.slice(0, -extension.length)}.${stamp}${extension}`;
}

function writeDerivedJson(file, value) {
  writeJson(derivedFile(file), value);
}

function writeDerivedText(file, value) {
  writeText(derivedFile(file), value);
}

export function readManifest(manifestPath) {
  const file = resolvePath(manifestPath);
  const raw = fs.readFileSync(file, "utf8");
  const manifest = JSON.parse(raw);
  validateManifest(manifest);
  return { manifest, manifestPath: file, manifestSha256: sha256(raw) };
}

function orNull(value) {
  return value === undefined ? null : value;
}

function sourceRecords(manifest) {
  validateManifest(manifest);
  const llmFile = resolvePath(manifest.source.llm_log);
  assert(fs.existsSync(llmFile), `source llm_log 不存在: ${manifest.source.llm_log}`);
  assert.equal(shaFile(llmFile), manifest.source.sha256, "source llm_log sha256 不符合，拒绝比较");
  const records = jsonl(llmFile);
  assert.equal(
    records.length,
    manifest.source.expected_lines,
    "source llm_log 行数与 expected_lines 不符",
  );
  return { records, llmFile };
}

function authorMessage(records, author) {
  const record = records[author.line - 1];
  const message = list(record.request.body.messages)[author.message_index];
  assert(message !== undefined, `author(${author.id}) 消息索引不存在`);
  assert.equal(message.role, "user", `author(${author.id}) 必须是 user 消息`);
  assert.equal(typeof message.content, "string", `author(${author.id}) content 必须是字符串`);
  assert(
    !message.content.startsWith("【应用数据 · "),
    `author(${author.id}) 是 application 消息，不能作为作者原话`,
  );
  assert.equal(sha256(message.content), author.sha256, `author(${author.id}) sha256 不符合，拒绝比较`);
  return { record, message };
}

function authorFromRecord(records, author) {
  const { record, message } = authorMessage(records, author);
  return {
    id: author.id,
    line: author.line,
    messageIndex: author.message_index,
    text: message.content,
    sha256: author.sha256,
    turnId: orNull(record.turn_id),
    sessionId: orNull(record.session_id),
    providerCallRef: orNull(record.provider_call_ref),
    providerRunRef: orNull(record.provider_run_ref),
    target: author.target ?? null,
    record,
  };
}

export function loadSourceAuthors(manifest) {
  const { records, llmFile } = sourceRecords(manifest);
  const authors = manifest.authors.map((author) => authorFromRecord(records, author));
  const appFile = resolvePath(manifest.source.app_log);
  assert(fs.existsSync(appFile), `source app_log 不存在: ${manifest.source.app_log}`);
  assert.equal(shaFile(appFile), manifest.source.app_sha256, "source app_log sha256 不符合，拒绝比较");
  return { authors, llmFile, appFile };
}

function eventTurnKey(event) {
  const turn = event.turn_id;
  const session = event.session_id;
  return turn && session ? `${session}|${turn}` : null;
}

function appEventsByTurn(appFile) {
  const byTurn = new Map();
  for (const event of jsonl(appFile)) {
    const key = eventTurnKey(event);
    if (key === null) continue;
    if (!byTurn.has(key)) byTurn.set(key, []);
    byTurn.get(key).push(event);
  }
  return byTurn;
}

function appJoinFor(byTurn, author) {
  const events = byTurn.get(`${author.sessionId}|${author.turnId}`) ?? [];
  return {
    status: events.length > 0 ? "joined" : "missing",
    event_count: events.length,
    event_names: [...new Set(events.map((event) => event.event).filter(nonBlank))].sort(),
  };
}

function callReport(author, analysis, appJoin) {
  return {
    author_id: author.id,
    source_line: author.line,
    author_message_index: author.messageIndex,
    author_sha256: author.sha256,
    turn_id: author.turnId,
    session_id: author.sessionId,
    provider_call_ref: author.providerCallRef,
    provider_run_ref: author.providerRunRef,
    ok: analysis.ok,
    status: analysis.status,
    reason: analysis.reason,
    format: analysis.format,
    category_bytes: analysis.category_bytes,
    totals: analysis.totals,
    cross: analysis.cross,
    usage: analysis.usage,
    response: analysis.response,
    provenance: analysis.provenance,
    request: analysis.request,
    app_join: appJoin,
  };
}

function checksForCalls(calls) {
  return {
    source_hash_ok: true,
    author_hash_ok: calls.every((call) => call.provenance.trusted),
    conservation_ok: calls.every((call) => call.request.conservation),
    no_unclassified: calls.every((call) => call.cross.unclassified_messages === 0),
    all_calls_valid: calls.every((call) => call.ok === true),
    usage_present: calls.every((call) => call.usage.present === true),
    cached_within_input: calls.every((call) => call.usage.cached_within_input === true),
    no_cached_double_add: calls.every(
      (call) => call.usage.cost_input_tokens === call.usage.input_tokens,
    ),
  };
}

function statusFromChecks(checks) {
  return Object.values(checks).every(Boolean) ? "pass" : "fail";
}

function markdownTable(rows, header) {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

export function analyzeHistory({ manifestPath, outDir }) {
  const loaded = readManifest(manifestPath);
  const source = loadSourceAuthors(loaded.manifest);
  const byTurn = appEventsByTurn(source.appFile);
  const calls = source.authors.map((author) => {
    const analysis = analyzeRequestCost(author.record, {
      authorBinding: {
        messageIndex: author.messageIndex,
        text: author.text,
        sha256: author.sha256,
      },
    });
    return callReport(author, analysis, appJoinFor(byTurn, author));
  });
  const checks = checksForCalls(calls);
  const report = {
    schema: BEFORE_SCHEMA,
    generated_at: new Date().toISOString(),
    manifest: { path: loaded.manifestPath, sha256: loaded.manifestSha256, id: loaded.manifest.id },
    source: {
      llm_log: loaded.manifest.source.llm_log,
      sha256: loaded.manifest.source.sha256,
      app_log: loaded.manifest.source.app_log,
      app_sha256: loaded.manifest.source.app_sha256,
    },
    checks,
    status: statusFromChecks(checks),
    summary: {
      calls: calls.length,
      app_joined: calls.filter((call) => call.app_join.status === "joined").length,
      input_tokens: tokenAggregate(calls, "input_tokens"),
      cached_tokens: tokenAggregate(calls, "cached_tokens"),
      output_tokens: tokenAggregate(calls, "output_tokens"),
      raw_http_bytes: "not_collected",
      raw_sse: "not_collected",
      per_category_tokens: "not_collected",
    },
    calls,
  };
  writeDerivedJson(path.join(outDir, "request-cost-before.json"), report);
  writeDerivedText(
    path.join(outDir, "request-cost-before.md"),
    [
      "# B87 R01 历史请求成本（可重算）",
      "",
      `- status: **${report.status}**`,
      `- source sha256: \`${report.source.sha256}\``,
      `- app sha256: \`${report.source.app_sha256}\``,
      "- 原始 HTTP body / SSE: not_collected（日志只保存对象/解码体）",
      "",
      markdownTable(
        calls.map((call) => [
          call.author_id,
          call.source_line,
          call.turn_id,
          call.category_bytes.system,
          call.category_bytes.tools,
          call.category_bytes.scope,
          call.category_bytes.history,
          call.category_bytes.observation,
          call.category_bytes.validation,
          call.category_bytes.tool_unknown,
          call.category_bytes.current_author,
          call.totals.stable_json_bytes,
          call.totals.envelope_bytes,
          call.usage.input_tokens ?? "not_collected",
          call.usage.cached_tokens ?? "not_collected",
          call.usage.output_tokens ?? "not_collected",
          call.usage.ttft_ms ?? "not_collected",
          call.ok,
        ]),
        [
          "author",
          "line",
          "turn",
          "system",
          "tools",
          "scope",
          "history",
          "observation",
          "validation",
          "tool_unknown",
          "current_author",
          "stable_json",
          "envelope",
          "input",
          "cached",
          "output",
          "ttft",
          "ok",
        ],
      ),
      "",
      `checks: \`${JSON.stringify(checks)}\``,
      "",
    ].join("\n"),
  );
  return report;
}

function readSeed(batchDir) {
  const seed = seedFields(batchDir);
  const workId = seed("work_id");
  const sessionId = seed("session_id");
  const titleAfter = seed("title_after");
  const sessionTitle = seed("session_title");
  assert(workId, "seed.log 缺少 work_id");
  assert(sessionId, "seed.log 缺少 session_id");
  assert(titleAfter, "seed.log 缺少 title_after");
  assert(sessionTitle, "seed.log 缺少 session_title");
  assert.equal(seed("new_session"), "true", "seed 必须明确建立新 session");
  return {
    workId,
    sessionId,
    titleBefore: seed("title_before"),
    titleAfter,
    revisionBefore: seed("revision_before"),
    revisionAfter: seed("revision_after"),
    sessionTitle,
  };
}

function readSchemaJson(file, schema, label) {
  assert(fs.existsSync(file), `缺少 ${label}`);
  const value = readJson(file);
  assert.equal(value.schema, schema, `${label} schema 不符`);
  return value;
}

// 同一后端进程启动后由外部 bootstrap 写入的白名单事实；prepare/verify 都必须能读到。
function readRuntimeFacts(batchDir) {
  const file = path.join(batchDir, RUNTIME_FACTS_FILE);
  assert(fs.existsSync(file), "缺少同一后端进程的 runtime-facts.json（启动脚本未采集）");
  return { facts: readJson(file), sha256: shaFile(file) };
}

export function rebuildSnapshot({ fullPath = FROZEN_FULL, outDir }) {
  // 路径准入必须先于 provenance/private fs 读取：错误源不能依赖工作树恰有冻结 metadata
  // （干净副本没有），合法源随后仍由 createCompleteSnapshot 做存在性/SHA/WAL 与完整复制。
  assertFrozenFullPath(fullPath);
  const v2Manifest = readJson(path.join(path.dirname(resolvePath(FROZEN_FULL)), "manifest.json"));
  return createCompleteSnapshot({
    fullPath,
    outDir,
    provenance: {
      frozen_full: {
        path: path.relative(ROOT, resolvePath(FROZEN_FULL)),
        sha256: FROZEN_FULL_SHA256,
        v2_manifest: path.relative(ROOT, path.join(path.dirname(resolvePath(FROZEN_FULL)), "manifest.json")),
        v2_manifest_sha256: sha256File(path.join(path.dirname(resolvePath(FROZEN_FULL)), "manifest.json")),
      },
      original_stage: v2Manifest.source,
    },
  });
}

export function restoreSnapshot({ batchDir, snapshotDir }) {
  return restoreCompleteSnapshot({ batchDir, snapshotDir });
}

export function preflightNative({ manifestPath, snapshotDir, outDir, length }) {
  const loaded = readManifest(manifestPath);
  assert.equal(loaded.manifest.mode, "native", "只有 native manifest 能启动原生批次");
  assert(LENGTHS.includes(length), "length 必须是 3/10/20");
  assert(!fs.existsSync(path.resolve(outDir)), "输出目录已存在，拒绝覆盖");
  const dir = path.resolve(snapshotDir);
  // 快照 manifest 的 schema/清单结构由 snapshot owner 的唯一入口解析一次；
  // 这里不再重复 readJson/schema 校验。
  const snapshot = readSnapshotManifest(dir);
  assert.equal(snapshot.snapshot.work_sha256, sha256File(path.join(dir, "work.sqlite3")));
  assert.equal(snapshot.snapshot.full_sha256, sha256File(path.join(dir, "full.sqlite3")));
  assert.equal(
    snapshot.snapshot.work_sha256,
    loaded.manifest.snapshot.work_sha256,
    "manifest 与快照 work hash 不符",
  );
  assert.equal(
    snapshot.snapshot.content_sha256,
    loaded.manifest.snapshot.content_sha256,
    "manifest 与快照内容 hash 不符",
  );
  assert.equal(
    snapshot.snapshot.full_sha256,
    loaded.manifest.snapshot.source_sha256,
    "manifest 与快照 full hash 不符",
  );
  // snapshot JSON 只提供声明；结构已在 readSnapshotManifest 边界校验，这里以实际
  // work.sqlite3 的事实判断安全并与声明对账。JSON 伪空清单不能掩盖 DB 里的
  // durable run/非终止 task。
  const declaredInventory = snapshot.snapshot.run_inventory;
  const db = new DatabaseSync(path.join(dir, "work.sqlite3"), { readOnly: true });
  let inventory;
  let work;
  try {
    inventory = readRunInventory(db);
    assertSnapshotRunInventory(inventory);
    assertRunInventoryMatches(inventory, declaredInventory);
    const rows = all(db, "SELECT id, title FROM works WHERE id = ?", [loaded.manifest.seed.work_id]);
    assert.equal(rows.length, 1, "快照中不存在 manifest.seed.work_id 指定的目标作品");
    work = rows[0];
    assert.equal(contentCanonSha(db), loaded.manifest.snapshot.content_sha256, "快照 DB 实际内容 hash 与 manifest 不符");
    assert.equal(
      businessContentCanonSha(db, snapshot.captured_at),
      loaded.manifest.snapshot.business_content_sha256,
      "快照 DB 实际业务内容 hash 与冻结 manifest 不符",
    );
    if (loaded.manifest.snapshot.reference_logs) {
      assert.deepEqual(
        referenceLogsSignature(db),
        loaded.manifest.snapshot.reference_logs,
        "快照 DB 实际引用日志原始行签名与冻结 manifest 不符",
      );
    }
  } finally {
    db.close();
  }
  return { ok: true, manifest: loaded.manifest, snapshot, inventory, work };
}

export function prepareBatch({ manifestPath, batchDir, length }) {
  const loaded = readManifest(manifestPath);
  assert.equal(loaded.manifest.mode, "native", "历史 frozen manifest 不能启动 native 批次");
  assert(LENGTHS.includes(length), `length 必须是 ${LENGTHS.join("/")}`);
  const source = loadSourceAuthors(loaded.manifest);
  const seed = readSeed(batchDir);
  const snapshot = readSnapshotRecord(batchDir);
  assert.equal(loaded.manifest.snapshot.source_sha256, snapshot.source?.sha256, "快照恢复记录 source hash 与冻结 manifest 不一致");
  const full = resolvePath(snapshot.source.path);
  const frozenSha = sha256File(full);
  assert.equal(frozenSha, loaded.manifest.snapshot.source_sha256, "冻结 full 在 prepare 前被改写");
  assert.equal(snapshot.snapshot.content_sha256, loaded.manifest.snapshot.content_sha256, "快照内容 hash 与冻结 manifest 不一致");
  assert.equal(
    snapshot.snapshot.business_content_sha256,
    loaded.manifest.snapshot.business_content_sha256,
    "快照业务内容 hash 与冻结 manifest 不一致",
  );
  assert.equal(snapshot.snapshot.work_sha256, loaded.manifest.snapshot.work_sha256, "快照 work hash 与冻结 manifest 不一致");
  assert.equal(snapshot.snapshot.full_sha256, loaded.manifest.snapshot.source_sha256, "快照 full hash 与冻结 manifest 不一致");
  assert.equal(seed.workId, loaded.manifest.seed.work_id, "seed 作品与冻结目标作品不一致");
  assert.equal(seed.titleAfter, loaded.manifest.seed.title, "seed 可见名与冻结值不一致");
  assert.equal(seed.sessionTitle, loaded.manifest.seed.session_title, "seed session 标题与冻结值不一致");
  // 恢复记录的 schema/清单结构已在 readSnapshotRecord 边界解析一次。
  const declaredInventory = snapshot.snapshot.run_inventory;
  assert(!declaredInventory.provider_call_refs.includes(""), "冻结清单存在空 provider_call_ref");
  const sourceDb = new DatabaseSync(full, { readOnly: true });
  let delta;
  try {
    const afterDb = new DatabaseSync(path.join(batchDir, "database", "ai_novel_studio_test.sqlite3"), {
      readOnly: true,
    });
    try {
      // 恢复记录只是声明：实际 source 与实际 batch 的清单必须分别判断安全，且与
      // 声明/彼此一致。setup 的 canon 对账不覆盖这些运行表，不能靠它漏过。
      const sourceInventory = readRunInventory(sourceDb);
      assertSnapshotRunInventory(sourceInventory);
      assertRunInventoryMatches(sourceInventory, declaredInventory);
      const batchInventory = readRunInventory(afterDb);
      assertSnapshotRunInventory(batchInventory);
      assertRunInventoryMatches(batchInventory, sourceInventory);
      delta = reconcileSetupDelta({
        sourceDb,
        afterDb,
        workId: seed.workId,
        seed: {
          work_id: seed.workId,
          title: seed.titleAfter,
          session_id: seed.sessionId,
          session_title: seed.sessionTitle,
        },
        sourceAt: snapshot.source.captured_at,
        afterAt: new Date().toISOString(),
      });
    } finally {
      afterDb.close();
    }
  } finally {
    sourceDb.close();
  }
  assert.equal(sha256File(full), loaded.manifest.snapshot.source_sha256, "冻结 full 在 prepare 中被改写");
  assert.equal(
    delta.projected_content_sha256,
    delta.source_content_sha256,
    "setup 后投影业务内容与源业务内容不一致",
  );
  assert.equal(
    delta.source_content_sha256,
    loaded.manifest.snapshot.business_content_sha256,
    "冻结 full 业务内容 hash 与 manifest 不一致",
  );
  const runtime = readRuntimeFacts(batchDir);
  assertRuntimeFacts(runtime.facts, loaded.manifest.runtime.profile);
  const configPath = path.join(batchDir, "native-request-cost-config.json");
  assert(!fs.existsSync(configPath), "native-request-cost-config.json 已存在，拒绝覆盖");
  const plan = Array.from({ length }, (_, index) => {
    const author = source.authors[index % source.authors.length];
    return {
      turn: index + 1,
      author_id: author.id,
      author_sha256: author.sha256,
      source_line: author.line,
      message_index: author.messageIndex,
      target: author.target,
    };
  });
  const config = {
    schema: CONFIG_SCHEMA,
    frozen: true,
    manifest: {
      path: loaded.manifestPath,
      sha256: loaded.manifestSha256,
      id: loaded.manifest.id,
    },
    length,
    source: {
      llm_log: loaded.manifest.source.llm_log,
      sha256: loaded.manifest.source.sha256,
      app_log: loaded.manifest.source.app_log,
      app_sha256: loaded.manifest.source.app_sha256,
      authors: source.authors.map((author) => ({
        id: author.id,
        line: author.line,
        message_index: author.messageIndex,
        sha256: author.sha256,
        target: author.target,
      })),
    },
    plan,
    semantic_targets: source.authors
      .filter((author) => author.target)
      .map((author) => ({ author_id: author.id, ...author.target })),
    model: loaded.manifest.model,
    runtime: {
      profile: loaded.manifest.runtime.profile,
      facts_file: RUNTIME_FACTS_FILE,
      facts_sha256: runtime.sha256,
      observed: runtime.facts,
    },
    seed: {
      script: loaded.manifest.seed.script,
      work_id: seed.workId,
      session_id: seed.sessionId,
      content_sha256: delta.content_sha256,
      source_content_sha256: delta.source_content_sha256,
      new_session: true,
    },
    setup: {
      work: delta.work,
      session: delta.session,
      projection: delta.projection,
      compared_tables: delta.compared_tables,
      reference_logs_count: delta.reference_logs_count,
      reference_logs_sha256: delta.reference_logs_sha256,
    },
    snapshot: {
      dir: loaded.manifest.snapshot.dir,
      source_sha256: loaded.manifest.snapshot.source_sha256,
      work_sha256: loaded.manifest.snapshot.work_sha256,
      content_sha256: loaded.manifest.snapshot.content_sha256,
      business_content_sha256: loaded.manifest.snapshot.business_content_sha256,
      work_id: loaded.manifest.seed.work_id,
    },
    work: { id: seed.workId, title: seed.titleAfter },
    session_id: seed.sessionId,
    budget: loaded.manifest.budget,
    batch_dir: path.resolve(batchDir),
  };
  writeJson(configPath, config);
  return config;
}

function readConfig(batchDir) {
  const config = readSchemaJson(
    path.join(batchDir, "native-request-cost-config.json"),
    CONFIG_SCHEMA,
    "native-request-cost-config.json",
  );
  assert.equal(config.frozen, true, "config 未冻结");
  return config;
}

function countLlmLines(batchDir) {
  const dir = path.join(batchDir, "llm-calls");
  if (!fs.existsSync(dir)) return { files: 0, lines: 0 };
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".jsonl"));
  return {
    files: files.length,
    lines: files.reduce(
      (sum, file) =>
        sum +
        fs
          .readFileSync(path.join(dir, file), "utf8")
          .split("\n")
          .filter((line) => line.includes("{")).length,
      0,
    ),
  };
}

export function captureBatch({ batchDir, checkpoint }) {
  assert(CHECKPOINTS.has(checkpoint), `checkpoint 必须是 ${[...CHECKPOINTS].join("/")}`);
  const config = readConfig(batchDir);
  const file = path.join(batchDir, `request-cost-${checkpoint}.json`);
  assert(!fs.existsSync(file), `checkpoint 已存在，拒绝覆盖: ${checkpoint}`);
  const driverFile = path.join(batchDir, "native-request-cost-driver-log.json");
  const driver = fs.existsSync(driverFile) ? readJson(driverFile) : null;
  const at = new Date().toISOString();
  const captured = withDb(batchDir, (db) => ({
    canon: contentCanonSnapshot(db, at),
    reference_logs: referenceLogsSignature(db),
  }));
  const record = {
    schema: "b87-request-cost-checkpoint/v1",
    checkpoint,
    at,
    production_counts: productionTableCounts(batchDir),
    llm_calls: countLlmLines(batchDir),
    driver_turns: driver?.turns?.length ?? 0,
    manifest_sha256: config.manifest.sha256,
    authoring_canon: captured.canon,
    business_content_sha256: businessContentSha(captured.canon),
    reference_logs: captured.reference_logs,
  };
  writeJson(file, record);
  return record;
}

function checkpointCounts(batchDir, checkpoint) {
  const file = path.join(batchDir, `request-cost-${checkpoint}.json`);
  if (!fs.existsSync(file)) return null;
  return readJson(file).production_counts ?? null;
}

function readRootAgentRun(dir, { turn, config }) {
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT * FROM agent_runs WHERE id = ?", [turn.run_id]);
    assert.equal(rows.length, 1, "root agent_run 必须恰好一行");
    const row = rows[0];
    assert.equal(row.work_id, config.work.id, "root agent_run work 不一致");
    assert.equal(row.session_id, config.session_id, "root agent_run session 不一致");
    assert.equal(row.parent_turn_ref, turn.turn_id, "root agent_run parent turn 不一致");
    assert(nonBlank(row.workspace_id), "root agent_run workspace 缺失");
    return row;
  });
}

function bindRootRunCalls({ dir, config, turn, records, plan, fail }) {
  if (!turn.run_id) {
    fail(`turn_${plan.turn}_root_run`, "missing_ack_run_id");
    return null;
  }
  let root;
  try {
    root = readRootAgentRun(dir, { turn, config });
  } catch (error) {
    fail(`turn_${plan.turn}_root_run`, error.message);
    return null;
  }
  const scope = {
    run_id: root.id,
    workspace_id: root.workspace_id,
    work_id: root.work_id,
    session_id: root.session_id,
    parent_turn_ref: root.parent_turn_ref,
  };
  let history;
  try {
    history = readAuthoringHistory(dir, scope);
  } catch (error) {
    fail(`turn_${plan.turn}_canonical_history`, error.message);
    return null;
  }
  const providerRuns = readProviderRuns(dir, scope);
  if (providerRuns.length === 0) {
    fail(`turn_${plan.turn}_provider_runs`, "empty");
    return null;
  }
  const bound = joinRootRun({
    scope,
    history,
    providerRuns,
    records,
    plan,
    fail,
  });
  if (!bound) return null;
  return {
    root,
    providerRuns,
    records: bound.records,
    history,
    purposes: new Map(providerRuns.map((row) => [row.provider_call_ref, row.purpose ?? null])),
    operations: new Map(providerRuns.map((row) => [row.provider_call_ref, providerOperation(row)])),
    counts: bound.counts,
  };
}

function turnCategorySum(turn, key) {
  return turn.calls.reduce((sum, call) => sum + call.analysis.category_bytes[key], 0);
}

function turnStableJsonSum(turn) {
  return turn.calls.reduce((sum, call) => sum + call.analysis.totals.stable_json_bytes, 0);
}

function nativeReportMarkdown(report) {
  const rows = report.turns.map((turn) => [
    turn.turn,
    turn.author_id,
    turn.calls.length,
    turnCategorySum(turn, "scope"),
    turnCategorySum(turn, "history"),
    turnCategorySum(turn, "observation"),
    turnCategorySum(turn, "validation"),
    turnCategorySum(turn, "tool_unknown"),
    turnCategorySum(turn, "current_author"),
    turnStableJsonSum(turn),
    turn.status,
  ]);
  return [
    "# B87 R01 原生批次成本报告",
    "",
    `- status: **${report.status}**`,
    `- length: ${report.batch.length}`,
    `- work: ${report.batch.work.title}`,
    `- session: ${report.batch.session_id}`,
    "- 原始 HTTP body / SSE: not_collected（日志只保存对象/解码体）",
    "",
    markdownTable(rows, [
      "turn", "author", "calls", "scope", "history", "observation", "validation",
      "tool_unknown", "current_author", "stable_json", "status",
    ]),
    "",
    `checks: \`${JSON.stringify(report.checks)}\``,
    "",
    `failures: \`${JSON.stringify(report.failures)}\``,
    "",
  ].join("\n");
}

function setCheck(checks, fail, key, ok, reason) {
  checks[key] = ok;
  if (!ok) fail(key, reason);
}

function sessionActive(sessions, sessionId) {
  return sessions.some((session) => session.id === sessionId && session.status === "ACTIVE");
}

function postRunState(batchDir, config) {
  return withDb(batchDir, (db) => ({
    work: all(db, "SELECT title, revision FROM works WHERE id = ?", [config.work.id])[0] ?? null,
    sessions: all(db, "SELECT id, status FROM work_sessions WHERE work_id = ?", [config.work.id]),
  }));
}

// 准备期内容边界以运行起点 checkpoint 为界：start 之前的业务内容必须仍等于
// seed；start 之后的 title/revision/session 变化是运行期产品事实，只记录、不
// 反向当成准备破坏或测量失败。业务 hash 只认 checkpoint 明确采集值，不从
// authoring_canon 回算旧形状：缺字段就是缺证。
function verifyPostSetupContent({ batchDir, config, checks, fail, notCollected }) {
  const start = checkpointRecord(batchDir, "start");
  const preparedContent = nonBlank(start?.business_content_sha256)
    ? start.business_content_sha256
    : null;
  if (preparedContent === null) {
    checks.setup_content = null;
    notCollected.push("start_checkpoint");
  } else {
    setCheck(
      checks,
      fail,
      "setup_content",
      preparedContent === config.seed.content_sha256,
      "changed_before_start",
    );
  }

  const state = postRunState(batchDir, config);
  checks.post_run_works_title_matches =
    state.work?.title === config.setup.work.title_after;
  checks.post_run_works_revision_matches =
    Number(state.work?.revision) === config.setup.work.revision_after;
  checks.post_run_session_active = sessionActive(state.sessions, config.session_id);
}

function startCheckpoint(batchDir) {
  return checkpointRecord(batchDir, "start");
}

function oldCallRefs(record) {
  // readSnapshotRecord 边界已解析/校验清单，这里直接使用已观察事实。
  return new Set(record.snapshot.run_inventory.provider_call_refs);
}

function reusedOldCalls(records, oldRefs) {
  return records.filter(
    (record) => record.provider_call_ref && oldRefs.has(record.provider_call_ref),
  );
}

function boundCallCompleteness(records, allCalls) {
  const boundRefs = new Set(allCalls.map((call) => call.provider_call_ref).filter(Boolean));
  return {
    ok:
      records.length > 0 &&
      records.every((record) => boundRefs.has(record.provider_call_ref)) &&
      boundRefs.size === records.length,
    measured: `${boundRefs.size}/${records.length}`,
  };
}

// 事后安全只看实际 batch DB 已观察清单；读取失败（缺表/DB 故障）是缺证，不是
// “已观察 unsafe”。只有成功取得清单后对已知安全规则的失败才归到 unsafe。
function observedBatchRunInventory(batchDir, checks, notCollected) {
  try {
    return withDb(batchDir, (db) => readRunInventory(db));
  } catch {
    checks.run_inventory_safe = null;
    notCollected.push("run_inventory");
    return null;
  }
}

function runInventoryIsSafe(inventory) {
  try {
    assertSnapshotRunInventory(inventory);
    return true;
  } catch {
    return false;
  }
}

const TERMINAL_PROVIDER_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

// 事后完整性：ProviderRun 已开始但没有完成日志/仍 running 时，只能登记缺证，
// 不能把绑定后的 calls=0 伪装成“没有调用”。
function verifyProviderRunCompleteness({ batchDir, config, records, checks, notCollected }) {
  let rows;
  try {
    rows = withDb(batchDir, (db) =>
      all(db, "SELECT provider_call_ref, status FROM provider_runs WHERE session_id = ?", [
        config.session_id,
      ]),
    );
  } catch {
    checks.provider_runs_present = null;
    notCollected.push("provider_runs");
    return;
  }
  checks.provider_runs_present = rows.length > 0 ? true : null;
  if (rows.length === 0) return;
  const nonTerminal = rows.filter(
    (row) => !TERMINAL_PROVIDER_RUN_STATUSES.has(String(row.status)),
  );
  checks.provider_runs_terminal = nonTerminal.length === 0;
  if (nonTerminal.length > 0) notCollected.push("provider_run_incomplete");
  const refs = new Set(records.map((record) => record.provider_call_ref).filter(Boolean));
  const missingLogs = rows.filter(
    (row) => row.status === "completed" && !refs.has(row.provider_call_ref),
  );
  checks.provider_call_logs_complete = missingLogs.length === 0;
  if (missingLogs.length > 0) notCollected.push("provider_call_log_missing");
}

function verifyStartupAndCompleteness({ batchDir, records, allCalls, checks, fail, notCollected }) {
  const start = startCheckpoint(batchDir);
  if (start === null) {
    checks.no_calls_before_start = null;
    notCollected.push("start_checkpoint");
  } else {
    setCheck(
      checks,
      fail,
      "no_calls_before_start",
      start.llm_calls?.lines === 0,
      "undeclared_model_calls_before_start",
    );
  }
  const snapshot = readSnapshotRecord(batchDir);
  if (records.length === 0) {
    checks.no_old_provider_call_reuse = null;
    checks.all_llm_calls_bound = null;
    notCollected.push("llm_calls");
  } else {
    setCheck(
      checks,
      fail,
      "no_old_provider_call_reuse",
      reusedOldCalls(records, oldCallRefs(snapshot)).length === 0,
      "snapshot_provider_call_ref_reused",
    );
    const bound = boundCallCompleteness(records, allCalls);
    setCheck(checks, fail, "all_llm_calls_bound", bound.ok, bound.measured);
  }
  const batchInventory = observedBatchRunInventory(batchDir, checks, notCollected);
  if (batchInventory !== null) {
    setCheck(
      checks,
      fail,
      "run_inventory_safe",
      runInventoryIsSafe(batchInventory),
      "unsafe_run_inventory_in_batch",
    );
  }
}

// runtime facts 是启动时同进程的观察；wire 才是请求实际发出的模型/effort。
// 两者分别核对，不用 manifest 自报替代任一来源。
function checkpointRecord(batchDir, checkpoint) {
  const file = path.join(batchDir, `request-cost-${checkpoint}.json`);
  return fs.existsSync(file) ? readJson(file) : null;
}

// 可见性终态只从每轮落盘的原始 turn observation 复算；旧 driver freshness
// 字段不参与。IO 留在 capture，纯判据在 batch evidence。
function turnObservations(batchDir, config) {
  return config.plan.map((plan) => {
    const file = path.join(batchDir, `request-cost-turn-observation-${plan.turn}.json`);
    return fs.existsSync(file) ? readJson(file) : null;
  });
}

function addedReferenceLogs(start, final) {
  const ids = new Set(start.memory_reference_logs.map((log) => log.id));
  return final.memory_reference_logs.filter((log) => !ids.has(log.id));
}

function otherWorkReferenceBookkeepingSame(start, final, targetWorkId) {
  for (const [id, before] of Object.entries(start.memory_items)) {
    if (before.work_id === targetWorkId) continue;
    const after = final.memory_items[id];
    if (!after) return false;
    if (
      after.work_id !== before.work_id ||
      after.reference_count !== before.reference_count ||
      after.last_referenced_at !== before.last_referenced_at
    ) {
      return false;
    }
  }
  return true;
}

// 运行期引用记账：canon 业务内容、原始引用日志、计数/最后引用时间三类事实分开。
// 正常目标 memory 的只读取证允许新增日志 + 运营列变化，但必须有对应的新日志；
// 无凭据的计数变化、内容变化、他作记账变化或旧日志改写都失败。
// 运行期产品事实：记录偏离，但不把偏离本身当成采集失败；语义是否合规留给
// model_behavior/semantic_review 的独立评审。
function setProductFact(checks, fail, key, ok, reason) {
  checks[key] = ok;
  if (!ok) fail(key, reason, { hard: false });
}

function verifyReferenceAccounting({ batchDir, config, checks, fail, notCollected }) {
  const start = checkpointRecord(batchDir, "start");
  const final = checkpointRecord(batchDir, "final");
  if (!start?.authoring_canon || !final?.authoring_canon) {
    checks.reference_accounting_present = null;
    notCollected.push("reference_accounting");
    return null;
  }

  let comparison;
  try {
    comparison = compareAuthoringCanonSnapshots(start.authoring_canon, final.authoring_canon);
  } catch (error) {
    checks.reference_accounting_present = null;
    notCollected.push("reference_accounting");
    return null;
  }

  setCheck(checks, fail, "reference_accounting_present", true);
  setProductFact(
    checks,
    fail,
    "runtime_content_intact",
    comparison.checks.no_canon_write,
    "runtime_canon_content_changed",
  );
  setProductFact(
    checks,
    fail,
    "runtime_business_content_intact",
    start.business_content_sha256 === final.business_content_sha256,
    "runtime_business_content_changed",
  );
  setProductFact(
    checks,
    fail,
    "memory_reference_updates_accounted",
    comparison.checks.memory_reference_updates_accounted,
    "memory_reference_updates_unaccounted",
  );

  const added = addedReferenceLogs(start.authoring_canon, final.authoring_canon);
  setProductFact(
    checks,
    fail,
    "reference_logs_target_work_only",
    added.every((log) => log.work_id === config.work.id),
    "reference_logs_other_work",
  );
  setProductFact(
    checks,
    fail,
    "other_work_reference_bookkeeping_intact",
    otherWorkReferenceBookkeepingSame(start.authoring_canon, final.authoring_canon, config.work.id),
    "other_work_reference_changed",
  );
  return comparison.measured;
}

function wireMatches(wire, config, providerRuns) {
  return wire.every(
    (record) =>
      (record.request.body.model ?? null) === config.model.model &&
      (record.request.body.reasoning_effort ?? null) === config.model.reasoning_effort &&
      (record.request.body.max_tokens ?? null) === (providerRuns.some((run) =>
        run.id === record.provider_run_ref && run.provider_call_ref === record.provider_call_ref &&
        providerOperation(run) === "transcript_compaction") ? 8192 : config.model.max_tokens),
  );
}

function uniqueValues(values) {
  return [...new Set(values)].sort();
}

function requestStep(record) {
  return typeof record.step === "string" && record.step !== "" ? record.step : "unknown";
}

function settingValues(wire, key) {
  return uniqueValues(wire.map((record) => record.request.body[key] ?? null));
}

function temperatureByStep(wire) {
  const byStep = {};
  for (const record of wire) {
    const value = record.request.body.temperature;
    if (typeof value !== "number") continue;
    const step = requestStep(record);
    byStep[step] = uniqueValues([...(byStep[step] ?? []), value]);
  }
  return Object.fromEntries(
    Object.entries(byStep).sort(([left], [right]) => left.localeCompare(right)),
  );
}

// 请求观察只来自 llm-calls 的 request.body（应用日志 JSON），不是 raw HTTP/SSE
// 字节，也不代表模型内部思考。temperature 按 step 区分，不能统一断言同一温度。
export function requestSettingsFacts(records) {
  const wire = list(records).filter((record) => record?.request?.body);
  return {
    source: "llm_calls_request_body",
    raw_http_or_sse: "not_collected",
    model: settingValues(wire, "model"),
    reasoning_effort: settingValues(wire, "reasoning_effort"),
    max_tokens: settingValues(wire, "max_tokens"),
    temperature_by_step: temperatureByStep(wire),
    temperature_note: "temperature 按请求 step 不同（如 judgment 与 tool.* 不同），不得统一断言同一温度",
  };
}

function verifyObservedRuntime({ batchDir, config, records, checks, fail, notCollected }) {
  const file = path.join(batchDir, RUNTIME_FACTS_FILE);

  if (!fs.existsSync(file)) {
    setCheck(checks, fail, "runtime_facts_present", false, "runtime_facts_missing");
    return;
  }

  setCheck(checks, fail, "runtime_facts_present", true);

  try {
    assertRuntimeFacts(readJson(file), config.runtime?.profile);
    setCheck(checks, fail, "runtime_facts_match", true);
  } catch (error) {
    setCheck(checks, fail, "runtime_facts_match", false, error.message);
  }

  setCheck(
    checks,
    fail,
    "runtime_facts_unchanged",
    shaFile(file) === config.runtime?.facts_sha256,
    "runtime_facts_changed_during_run",
  );

  const wire = records.filter((record) => record?.request?.body);
  if (wire.length === 0) {
    // 没有请求就不能声称 wire 参数对或错；只登记未观察。
    checks.runtime_wire_match = null;
    notCollected.push("runtime_wire");
    return;
  }
  setCheck(
    checks,
    fail,
    "runtime_wire_match",
    wireMatches(wire, config, withDb(batchDir, (db) =>
      all(db, "SELECT * FROM provider_runs WHERE session_id = ?", [config.session_id]))),
    "wire_model_effort_or_max_tokens_mismatch",
  );
}

function writeNativeReport({ batchDir, report, outDir = batchDir }) {
  writeDerivedJson(path.join(outDir, "request-cost-report.json"), report);
  writeDerivedText(path.join(outDir, "request-cost-report.md"), nativeReportMarkdown(report));
  writeDerivedJson(path.join(outDir, "summary.json"), {
    schema: NATIVE_REPORT_SCHEMA,
    status: report.status,
    checks: report.checks,
    measured: report.summary,
    failures: report.failures,
    not_collected: report.not_collected,
  });
}

export function verifyBatch({ batchDir, outDir = null }) {
  const config = readConfig(batchDir);
  const loaded = readManifest(config.manifest.path);
  assert.equal(loaded.manifestSha256, config.manifest.sha256, "manifest 在批次期间被改写");
  const source = loadSourceAuthors(loaded.manifest);
  const driverFile = path.join(batchDir, "native-request-cost-driver-log.json");
  const driver = fs.existsSync(driverFile) ? readJson(driverFile) : null;
  const records = logs(path.join(batchDir, "llm-calls"));
  const checks = {};
  const failures = [];
  const hardFailures = [];
  const notCollected = ["raw_http_bytes", "raw_sse", "per_category_tokens"];
  const fail = (key, reason, { hard = true } = {}) => {
    checks[key] = false;
    const entry = `${key}:${reason}`;
    failures.push(entry);
    if (hard) hardFailures.push(entry);
  };

  checks.config_frozen = true;
  checks.manifest_hash_ok = loaded.manifestSha256 === config.manifest.sha256;
  verifyConfigMatches({ config, loaded, checks, fail });
  verifyPostSetupContent({ batchDir, config, checks, fail, notCollected });
  verifyDriverShape({
    driver,
    config,
    checks,
    fail,
    turnObservations: turnObservations(batchDir, config),
  });

  const bindings = config.plan.map((plan, index) => {
    const turn = driver?.turns?.[index];
    return turn ? bindRootRunCalls({ dir: batchDir, config, turn, records, plan, fail }) : null;
  });
  const { turnReports, allCalls } = verifyTurns({
    config,
    source,
    records,
    driver,
    bindings,
    fail,
    notCollected,
  });
  verifyStartupAndCompleteness({ batchDir, records, allCalls, checks, fail, notCollected });
  verifyProviderRunCompleteness({ batchDir, config, records, checks, notCollected });
  verifyObservedRuntime({ batchDir, config, records, checks, fail, notCollected });
  const referenceAccounting = verifyReferenceAccounting({
    batchDir,
    config,
    checks,
    fail,
    notCollected,
  });
  const checkpointChanges = verifyCheckpoints({
    start: checkpointCounts(batchDir, "start"),
    final: checkpointCounts(batchDir, "final"),
    checks,
    fail,
    notCollected,
  });
  const report = buildNativeReport({
    batchDir,
    config,
    requestObservation: requestSettingsFacts(records),
    checks,
    failures,
    hardFailures,
    notCollected,
    turnReports,
    allCalls,
    referenceAccounting,
    checkpointChanges,
  });
  const reportDir = outDir ?? batchDir;
  assert(typeof reportDir === "string" && reportDir.trim() !== "", "verify --out 不能为空");
  writeNativeReport({ batchDir, report, outDir: reportDir });
  return report;
}