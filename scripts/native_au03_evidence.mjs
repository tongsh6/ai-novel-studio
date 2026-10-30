#!/usr/bin/env node
// AU03-CONTEXT CP3：读取失败/未知的原生真实模型验收证据核验。
//
// 测量动作由外部 macOS AX/CGEvent 驱动真实 Tauri 窗口完成（scripts/native_au03_drive.mjs）；
// 故障由外部 harness 在运行中重命名 SQLite 投影表（chapter_summaries）注入，解除后恢复；
// 产品代码不读取验收/故障开关。
//
// 场景（预注册）：
//   H3 baseline：正常请求 → prompt 含真实作品事实，无可用性段
//   H1 fault   ：投影表故障 → 同 turn 真实 provider 请求含「上下文可用性/读取失败」，
//                作者反馈/trace 不称空事实，零 canon 写入
//   H2 recovery：解除故障 → 后续请求重新含真实事实，无可用性段
//
// 模式：prepare / capture / verify
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  all,
  assertAllChecks,
  assertCommonEvidence,
  assertProviderAndWire,
  checkProductionFingerprint,
  logs,
  productionFingerprint,
  productionTableCounts,
  read,
  rewrite,
  sentUserMessages,
  transport,
  turnFacts,
  withDb,
  write,
  writeNativeSummary,
} from "./lib/native_ui/scenario_evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SLICE_ID = "au03-context-read-failure";
export const CONFIG_FILE = "native-au03-config.json";

export const SCENARIOS = Object.freeze([
  {
    id: "H3",
    kind: "baseline",
    input: "第03章正文里有没有提到旧账？只按当前作品事实回答。",
    expect_prompt: "real",
  },
  {
    id: "H1",
    kind: "fault_unavailable",
    input: "再确认一次：第03章正文里有没有提到旧账？只按当前作品事实回答。",
    expect_prompt: "unavailable",
  },
  {
    id: "H2",
    kind: "recovery",
    input: "故障解除后再回答一次：第03章正文里有没有提到旧账？只按当前作品事实回答。",
    expect_prompt: "real",
  },
]);

const byId = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));
const modelName = () => process.env.NOVEL_STRATA_MODEL ?? "iq3_s";
const strataEndpoint = () => process.env.NOVEL_STRATA_ENDPOINT ?? "http://127.0.0.1:47831/v1";

const requestedIds = () =>
  (process.env.AU03_SCENARIOS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((id) => byId.has(id));

function markWorkNewest(dir, workId) {
  execFileSync(
    "python3",
    [
      "-c",
      [
        "import sqlite3,sys,datetime",
        "db=sqlite3.connect(sys.argv[1], timeout=10)",
        "ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'",
        "db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2]))",
        "db.commit(); db.close()",
      ].join("\n"),
      path.join(dir, "database", "ai_novel_studio_test.sqlite3"),
      workId,
    ],
    { stdio: "ignore" },
  );
}

function seedField(dir, name) {
  const file = path.join(dir, "seed.log");
  if (!fs.existsSync(file)) return null;
  const tokens = fs.readFileSync(file, "utf8").split(/\s+/);
  const token = tokens.find((part) => part.startsWith(`${name}=`));
  return token ? token.slice(name.length + 1) : null;
}

function workTitleInDb(dir, workId) {
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT title FROM works WHERE id = ?", [workId]);
    assert.equal(rows.length, 1, `作品不存在于隔离 DB: ${workId}`);
    return String(rows[0].title);
  });
}

function sha256Hex(text) {
  return execFileSync("shasum", ["-a", "256"], { input: String(text ?? "") }).toString().split(/\s+/)[0];
}

function countFirstExisting(db, names) {
  for (const name of names) {
    try {
      return Number(all(db, `SELECT COUNT(*) AS n FROM ${name}`)[0].n);
    } catch {
      // 表不存在（故障期被重命名）：尝试下一个候选名
    }
  }
  return null;
}

function sqliteTablesInDb(db, pattern) {
  const rows = all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?", [pattern]);
  return rows.map((row) => String(row.name)).sort();
}

function sqliteTables(dir, pattern) {
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?", [pattern]);
    return rows.map((row) => String(row.name)).sort();
  });
}

function dbSnapshot(dir) {
  return withDb(dir, (db) => {
    const chapterRows = all(db, "SELECT id, seq, title, status FROM chapters ORDER BY seq");
    const draftRows = all(
      db,
      `SELECT d.content, d.status, s.chapter_id, s.seq AS scene_seq
         FROM drafts d JOIN scenes s ON s.id = d.scene_id
        ORDER BY s.chapter_id, s.seq`,
    );

    const acceptedByChapter = new Map();
    for (const row of draftRows) {
      if (String(row.status) !== "ACCEPTED") continue;
      const key = String(row.chapter_id);
      const list = acceptedByChapter.get(key) ?? [];
      list.push(String(row.content ?? ""));
      acceptedByChapter.set(key, list);
    }

    const chapterSha = {};
    const chapterTexts = {};
    for (const chapter of chapterRows) {
      const text = (acceptedByChapter.get(String(chapter.id)) ?? []).join("\n\n");
      chapterTexts[String(chapter.id)] = text;
      chapterSha[String(chapter.id)] = sha256Hex(text);
    }

    return {
      db_production_counts: productionTableCounts(dir),
      extra_counts: {
        drafts: Number(all(db, "SELECT COUNT(*) AS n FROM drafts")[0].n),
        versions: Number(all(db, "SELECT COUNT(*) AS n FROM versions")[0].n),
        author_action_receipts: Number(all(db, "SELECT COUNT(*) AS n FROM author_action_receipts")[0].n),
        // H1 故障期表被外部重命名为 *_fault；计数取任一存在的表，保证捕获本身不因
        // 被测故障而失败（证据消费者另行断言表名/零写入）。
        chapter_summaries: countFirstExisting(db, ["chapter_summaries", "chapter_summaries_fault"]),
        memory_items: Number(all(db, "SELECT COUNT(*) AS n FROM memory_items")[0].n),
      },
      chapters: chapterRows.map((row) => ({
        chapter_id: String(row.id),
        seq: Number(row.seq),
        title: String(row.title),
        status: String(row.status),
      })),
      chapter_text: chapterTexts,
      chapter_content_sha: chapterSha,
      sqlite_tables: {
        chapter_summaries: sqliteTablesInDb(db, "chapter_summaries%"),
      },
      agent_event_unavailable_sources: traceUnavailableSources(db),
    };
  });
}

// H1 同 turn trace：agent_events.payload 里的 context_source_status.unavailable_sources。
function traceUnavailableSources(db) {
  const rows = all(db, "SELECT payload FROM agent_events WHERE payload LIKE '%context_source_status%'");
  const sources = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(String(row.payload));
      const status = payload?.context_source_status;
      if (status && Array.isArray(status.unavailable_sources)) {
        sources.push(status.unavailable_sources);
      }
    } catch {
      // 忽略非 JSON payload
    }
  }
  return sources;
}

export async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE_ID, `ready.slice_id 必须为 ${SLICE_ID}`);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert.equal(ready.provider, "strata", `AU03 CP3 必须使用真实 strata provider，实测: ${ready.provider}`);

  const requested = requestedIds();
  const scenarios =
    requested.length > 0 ? SCENARIOS.filter((scenario) => requested.includes(scenario.id)) : SCENARIOS;
  assert(scenarios.length > 0, `AU03_SCENARIOS 过滤后没有场景: ${process.env.AU03_SCENARIOS}`);

  const workId = seedField(dir, "work_id");
  assert(workId, "seed.log 缺少 work_id");
  const target = {
    work_id: workId,
    work_title: workTitleInDb(dir, workId),
    session_id: seedField(dir, "session_id"),
    target_chapter_id: seedField(dir, "target_chapter_id"),
    target_chapter_title: seedField(dir, "target_title"),
  };

  markWorkNewest(dir, target.work_id);
  write(dir, "production-sources-before.json", productionFingerprint());

  let endpointModels = null;
  try {
    const response = await fetch(`${strataEndpoint()}/models`);
    if (response.ok) endpointModels = (await response.json())?.data?.map((entry) => entry.id) ?? null;
  } catch {
    endpointModels = null;
  }

  write(dir, CONFIG_FILE, {
    slice_id: SLICE_ID,
    provider: ready.provider,
    model: modelName(),
    strata_endpoint: strataEndpoint(),
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    target,
    requested_by_env: requested,
    scenarios,
    full_matrix: scenarios.length === SCENARIOS.length,
    checkpoints: ["start", ...scenarios.map((scenario) => scenario.id), "final"],
    fault: { table: "chapter_summaries", alias: "chapter_summaries_fault" },
    strata_models_visible_at_prepare: endpointModels,
  });
  console.log(
    `AU03 CP3 证据准备完成: work=${target.work_id} title=${target.work_title} ` +
      `provider=${ready.provider} model=${modelName()} scenarios=${scenarios.map((s) => s.id).join(",")}`,
  );
}

export function capture(dir, checkpoint) {
  const config = read(dir, CONFIG_FILE);
  assert(config.checkpoints.includes(checkpoint), `未知 checkpoint: ${checkpoint}`);
  rewrite(dir, `au03-${checkpoint}.json`, {
    at: new Date().toISOString(),
    checkpoint,
    ...dbSnapshot(dir),
  });
}

// ── llm-calls / app-log 解析 ───────────────────────────────────────────────
function llmCallRecords(dir) {
  const llmDir = path.join(dir, "llm-calls");
  if (!fs.existsSync(llmDir)) return [];
  const records = [];
  for (const file of fs.readdirSync(llmDir).filter((name) => name.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(llmDir, file), "utf8").split("\n")) {
      if (!line.includes("{")) continue;
      try {
        records.push(JSON.parse(line.slice(line.indexOf("{"))));
      } catch {
        // 忽略坏行
      }
    }
  }
  return records;
}

function promptTextForTurn(records, turnId) {
  const matched = records.filter(
    (record) =>
      String(record.turn_id ?? "") === String(turnId) ||
      String(record.turn_id ?? "").startsWith(`${turnId}:`),
  );
  const texts = [];
  for (const record of matched) {
    for (const message of record?.request?.body?.messages ?? []) {
      if (typeof message?.content === "string") texts.push(message.content);
    }
  }
  return { records: matched, text: texts.join("\n") };
}

function judgmentEventFor(appRecords, turnId) {
  return (
    appRecords
      .filter(
        (record) =>
          record.event === "judgment.decided.done" &&
          (String(record.turn_id ?? "") === String(turnId) ||
            String(record.turn_id ?? "").startsWith(`${turnId}:`)),
      )
      .at(-1) ?? null
  );
}

function contextAssembleFor(appRecords, turnId) {
  return (
    appRecords
      .filter(
        (record) =>
          record.event === "context.assemble.done" &&
          (String(record.turn_id ?? "") === String(turnId) ||
            String(record.turn_id ?? "").startsWith(`${turnId}:`)),
      )
      .at(-1) ?? null
  );
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function verify(dir, sliceIdArg) {
  const config = read(dir, CONFIG_FILE);
  const sliceId = sliceIdArg ?? config.slice_id;
  assert.equal(sliceId, SLICE_ID, `verify slice 参数不一致: ${sliceId}`);
  assert.equal(config.slice_id, SLICE_ID, "prepare 配置 slice 不一致");

  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.provider, "strata", "verify 必须基于 strata 真实模型批次");
  const driverLog = read(dir, "au03-context-native-driver-log.json");
  assert.equal(driverLog.provider, "strata", "驱动日志 provider 必须为 strata");
  assert.equal(driverLog.model, config.model, "驱动日志 model 与准备配置不一致");

  const common = assertCommonEvidence(dir, {
    sliceId: SLICE_ID,
    minScreenshots: config.scenarios.length + 2,
    minimumWaits: Math.max(8, config.scenarios.length * 3),
    allowVerificationFailureMarker: true,
  });
  const wireCommon = assertProviderAndWire(dir, {
    minUserMessages: Math.max(1, config.scenarios.length),
    minTurnResults: Math.max(1, config.scenarios.length),
    minProviderStarts: Math.max(1, config.scenarios.length),
    expectProviders: ["strata"],
  });

  const wire = transport(dir);
  const appRecords = logs(path.join(dir, "app-log"));
  const llmRecords = llmCallRecords(dir);
  const checks = {
    provider_is_real_strata: wireCommon.providerStarts.every((record) => record.provider === "strata"),
    no_browser_frames: !fs.existsSync(path.join(dir, "ui-frames.json")),
    production_sources_unchanged: checkProductionFingerprint(dir).unchanged,
    fault_injection_events_recorded: Array.isArray(driverLog.fault_events) && driverLog.fault_events.length >= 2,
    fault_injected_before_h1: (driverLog.fault_events ?? []).some(
      (event) => event.action === "inject" && event.ok === true && event.scenario === "H1",
    ),
    fault_restored_before_h2: (driverLog.fault_events ?? []).some(
      (event) => event.action === "restore" && event.ok === true && event.scenario === "H2",
    ),
  };

  const before = read(dir, "model-lifecycle-before.json");
  const after = read(dir, "model-lifecycle-after.json");
  checks.model_lifecycle_before_recorded = Boolean(before?.at && before?.provider === "strata");
  checks.model_unloaded_after = Boolean(
    after?.unloaded === true || after?.loaded === null || after?.loaded_after === null,
  );
  checks.model_loaded_before_consistent =
    before?.loaded_before === null || before?.loaded_before === undefined || before?.loaded_before === modelName();

  const snapshots = Object.fromEntries(
    ["start", ...config.scenarios.map((scenario) => scenario.id), "final"].map((checkpoint) => [
      checkpoint,
      read(dir, `au03-${checkpoint}.json`),
    ]),
  );

  const measured = { scenarios: {}, model: config.model, strata_endpoint: config.strata_endpoint };
  const expectedTitle = config.target.work_title;
  const targetChapterId = String(config.target.target_chapter_id);

  for (const scenario of config.scenarios) {
    const scenarioChecks = {};
    const driverEntry = (driverLog.scenarios ?? []).find((entry) => entry.id === scenario.id);
    assert(driverEntry, `驱动日志缺少场景: ${scenario.id}`);

    const messages = sentUserMessages(wire, scenario.input);
    scenarioChecks.user_message_exact_once = messages.length === 1;

    const facts = messages.length === 1 ? turnFacts(wire, messages[0]) : null;
    const turnId = facts?.turnId ?? driverEntry.turn_id;
    const turnResult =
      (facts?.results ?? [])
        .filter(
          (record) =>
            String(record.frame?.[4]?.turn_id ?? "") === String(turnId) ||
            String(record.frame?.[4]?.turn_id ?? "").startsWith(`${turnId}:`),
        )
        .at(-1)?.frame?.[4] ?? null;

    scenarioChecks.turn_id_matches_driver = Boolean(turnId && String(driverEntry.turn_id) === String(turnId));
    scenarioChecks.turn_result_present = Boolean(turnResult);
    scenarioChecks.assistant_text_nonempty = nonEmpty(turnResult?.assistant_message?.text ?? driverEntry.assistant_text);
    scenarioChecks.no_write_claims =
      turnResult?.truthfulness?.production_write_performed === false &&
      turnResult?.truthfulness?.artifact_adopted === false;

    const judgment = turnId ? judgmentEventFor(appRecords, turnId) : null;
    scenarioChecks.judgment_event_present = Boolean(judgment);

    const prompt = promptTextForTurn(llmRecords, turnId);
    scenarioChecks.provider_request_for_turn = prompt.records.length > 0;

    if (scenario.expect_prompt === "unavailable") {
      scenarioChecks.prompt_has_availability = prompt.text.includes("## 上下文可用性");
      scenarioChecks.prompt_says_read_failure = prompt.text.includes("读取失败");
      scenarioChecks.prompt_has_chapter_source = prompt.text.includes("章节事实");
      scenarioChecks.prompt_not_false_new_conversation = !prompt.text.includes("无——这是新对话或尚未创建作品");
      scenarioChecks.prompt_not_false_zero_chapters = !prompt.text.includes("全书 0 章");
    } else {
      scenarioChecks.prompt_has_real_facts = prompt.text.includes(expectedTitle);
      scenarioChecks.prompt_no_availability = !prompt.text.includes("## 上下文可用性");
    }

    const assemble = turnId ? contextAssembleFor(appRecords, turnId) : null;
    scenarioChecks.context_assemble_recorded = Boolean(assemble);

    if (assemble) {
      const status = assemble.source_status ?? {};
      if (scenario.expect_prompt === "unavailable") {
        scenarioChecks.assemble_chapters_unavailable = String(status.chapters ?? "") === "unavailable";
        scenarioChecks.assemble_work_still_ok = String(status.work ?? "") === "ok";
      } else {
        scenarioChecks.assemble_chapters_ok = String(status.chapters ?? "") === "ok";
      }
    }

    const beforeSnap = snapshots[scenario.id === "H3" ? "start" : scenario.id === "H1" ? "H3" : "H1"];
    const afterSnap = snapshots[scenario.id];
    scenarioChecks.zero_production_write = sameJson(beforeSnap?.db_production_counts, afterSnap?.db_production_counts);
    scenarioChecks.zero_extra_counts = sameJson(beforeSnap?.extra_counts, afterSnap?.extra_counts);
    scenarioChecks.chapter_text_unchanged = sameJson(beforeSnap?.chapter_text, afterSnap?.chapter_text);
    scenarioChecks.chapter_hashes_unchanged = sameJson(beforeSnap?.chapter_content_sha, afterSnap?.chapter_content_sha);

    if (scenario.id === "H1") {
      scenarioChecks.trace_has_unavailable_sources = (snapshots.H1?.agent_event_unavailable_sources ?? []).some(
        (sources) => Array.isArray(sources) && sources.includes("chapters"),
      );
      scenarioChecks.fault_table_renamed = (snapshots.H1?.sqlite_tables?.chapter_summaries ?? []).includes(
        "chapter_summaries_fault",
      );
    }

    if (scenario.id === "H2") {
      scenarioChecks.recovered_prompt_has_chapter_facts =
        prompt.text.includes(expectedTitle) &&
        prompt.text.includes(String(config.target.target_chapter_title ?? ""));
      scenarioChecks.fault_table_restored = sameJson(
        snapshots.final?.sqlite_tables?.chapter_summaries,
        ["chapter_summaries"],
      );
      const targetShaBefore = snapshots.H3?.chapter_content_sha?.[targetChapterId] ?? null;
      const targetShaAfter = snapshots.H2?.chapter_content_sha?.[targetChapterId] ?? null;
      scenarioChecks.recovery_same_canon = targetShaBefore === targetShaAfter;
    }

    const failures = Object.keys(scenarioChecks).filter((key) => !scenarioChecks[key]);
    Object.assign(
      checks,
      Object.fromEntries(Object.entries(scenarioChecks).map(([key, value]) => [`${scenario.id}.${key}`, value])),
    );
    measured.scenarios[scenario.id] = {
      kind: scenario.kind,
      input: scenario.input,
      turn_id: turnId,
      judgment_action: judgment?.action ?? null,
      estimated_provider_requests: prompt.records.length,
      prompt_chars: prompt.text.length,
      assistant_text_head: String(turnResult?.assistant_message?.text ?? driverEntry.assistant_text ?? "").slice(0, 240),
      truthfulness: turnResult?.truthfulness ?? null,
      checks_failed: failures,
    };
  }

  checks.full_matrix = config.full_matrix === true;
  checks.real_provider_calls_present = llmRecords.length >= config.scenarios.length;
  const failurePath = path.join(dir, "failure.json");
  checks.evidence_boundary_no_failure_json =
    !fs.existsSync(failurePath) ||
    JSON.parse(fs.readFileSync(failurePath, "utf8"))?.reason === "native_evidence_verification_failed";

  const failed = Object.keys(checks).filter((key) => !checks[key]);
  rewrite(dir, "au03-native-checks.json", {
    slice_id: SLICE_ID,
    at: new Date().toISOString(),
    checks,
    failed,
    measured,
    wait_ledger: common.ledger,
  });

  writeNativeSummary(dir, {
    sliceId: SLICE_ID,
    checks,
    measured,
    provider: "strata",
    boundary:
      "真实 macOS Tauri 窗口（真实 Phoenix 后端 + 真实前端）+ AX/CGEvent 外部驱动 + " +
      `真实 provider strata（model=${config.model}，单槽，结束 unload 核验）；故障由外部 harness 在运行中` +
      "重命名 chapter_summaries 投影表注入（产品无感知），H1 同 turn 请求/反馈/trace 对齐；H2 解除后恢复。",
    extra: {
      scenario_order: config.scenarios.map((scenario) => scenario.id),
      full_matrix: config.full_matrix,
      model: config.model,
      strata_endpoint: config.strata_endpoint,
      work_id: config.target.work_id,
      work_title: config.target.work_title,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
      fault: config.fault,
      fault_events: driverLog.fault_events ?? [],
      model_lifecycle: { before, after },
      wait_ledger: common.ledger,
      screenshots: common.ui.screenshots,
    },
  });

  assertAllChecks(checks, `AU03 CP3 ${SLICE_ID}`);
  console.log(
    `AU03 CP3 原生场景通过: ${SLICE_ID} checks ${Object.keys(checks).length - failed.length}/${Object.keys(checks).length} ` +
      `scenarios=${config.scenarios.map((scenario) => scenario.id).join(",")} waits=${common.ledger.waits}`,
  );
  return { checks, measured };
}

export async function main([mode, artifact]) {
  const dir = path.resolve(artifact ?? "");
  if (!dir) {
    throw new Error("usage: node scripts/native_au03_evidence.mjs <prepare|capture|verify> <dir> [checkpoint|slice-id]");
  }
  if (mode === "prepare") return prepare(dir);
  if (mode === "capture") return capture(dir, process.argv[4]);
  if (mode === "verify") return verify(dir, process.argv[4]);
  throw new Error(`未知模式: ${mode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
