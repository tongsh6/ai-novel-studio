#!/usr/bin/env node
// B28-SCOPE CP3：作者授权范围（否定/条件/读取/局部/正向）原生真实模型验收证据核验。
//
// 测量动作由外部 macOS AX/CGEvent 驱动真实 Tauri 窗口完成（scripts/native_b28_scope_drive.mjs）；
// 本文件只消费隔离批次的既有证据：ready/ui-complete/等待账/AX/截图/native-transport/
// app-log/llm-calls/模型生命周期/只读 SQLite。
//
// 场景（B28 §元原则整改 CP3 预注册 N1–N4/P1–P3；X1 由确定性测试覆盖，不伪造真实模型越界：
//   P3 字面替换 → N1 否定整章+局部 → N2 通读后局部 → N3 只读拒绝 → N4 条件整章 →
//   P1 整章重写 → P2 仅排版。执行顺序把 P3 放在 N1 前以保持「二十五岁」字面可定位，
//   语义与预注册一致。）
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
export const SLICE_ID = "b28-scope-authorization";
export const CONFIG_FILE = "native-b28-scope-config.json";

export const SCENARIOS = Object.freeze([
  {
    id: "P3",
    kind: "literal_replace",
    input: "把第03章里的「二十五岁」改成「三十岁」，其余逐字不变。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "target_segments", effect: "replace_segments", adopt: true },
    db: "literal_replace",
  },
  {
    id: "N1",
    kind: "negated_whole_local",
    input: "不要整章重写，只改第03章第一段。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "target_segments", effect: "replace_segments", adopt: true },
    db: "first_segment_only",
  },
  {
    id: "N2",
    kind: "read_then_local",
    input: "通读全文后只修第03章第二段。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "target_segments", effect: "replace_segments", adopt: true },
    db: "second_segment_only",
  },
  {
    id: "N3",
    kind: "readonly_deny",
    input: "整章检查一遍第03章，有问题告诉我，别改。",
    expect: { action: "none", zero_write: true, adopt: false },
    db: "zero_write",
  },
  {
    id: "N4",
    kind: "conditional_whole",
    input: "如果第03章有明显问题就整章改一遍，没有问题就告诉我。",
    expect: { action: "none", zero_write: true, adopt: false },
    db: "zero_write",
  },
  {
    id: "P1",
    kind: "whole_rewrite",
    input: "把第03章整章重写一遍，情节不变。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "whole_chapter", effect: "replace_scope", adopt: true },
    db: "whole_chapter",
  },
  {
    id: "P2",
    kind: "format_only",
    input: "只调整第03章分段和排版，不要改字句。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "format_only", effect: "format_paragraphs", adopt: true },
    db: "format_only",
  },
]);

const byId = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));
const modelName = () => process.env.NOVEL_STRATA_MODEL ?? "iq3_s";
const strataEndpoint = () => process.env.NOVEL_STRATA_ENDPOINT ?? "http://127.0.0.1:47831/v1";

const requestedIds = () =>
  (process.env.B28S_SCOPE_SCENARIOS ?? "")
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

// ── 只读 DB 快照：章节/接受稿正文（按 scene seq 以空行拼接）/计数 ─────────────
function dbSnapshot(dir) {
  return withDb(dir, (db) => {
    const chapterRows = all(db, "SELECT id, seq, title, status FROM chapters ORDER BY seq");
    const draftRows = all(
      db,
      `SELECT d.id AS draft_id, d.content, d.status, d.revision,
              s.id AS scene_id, s.seq AS scene_seq, s.chapter_id
         FROM drafts d JOIN scenes s ON s.id = d.scene_id
        ORDER BY s.chapter_id, s.seq, d.revision`,
    );

    const acceptedByChapter = new Map();
    for (const row of draftRows) {
      if (String(row.status) !== "ACCEPTED") continue;
      const key = String(row.chapter_id);
      const list = acceptedByChapter.get(key) ?? [];
      list.push({
        draft_id: String(row.draft_id),
        scene_id: String(row.scene_id),
        scene_seq: Number(row.scene_seq),
        revision: Number(row.revision),
        content: String(row.content ?? ""),
      });
      acceptedByChapter.set(key, list);
    }

    const chapterText = {};
    const chapterSha = {};
    for (const chapter of chapterRows) {
      const rows = [...(acceptedByChapter.get(String(chapter.id)) ?? [])].sort(
        (left, right) => left.scene_seq - right.scene_seq,
      );
      const text = rows.map((row) => row.content).join("\n\n");
      chapterText[String(chapter.id)] = text;
      chapterSha[String(chapter.id)] = sha256Hex(text);
    }

    return {
      db_production_counts: productionTableCounts(dir),
      extra_counts: {
        drafts: Number(all(db, "SELECT COUNT(*) AS n FROM drafts")[0].n),
        versions: Number(all(db, "SELECT COUNT(*) AS n FROM versions")[0].n),
        author_action_receipts: Number(all(db, "SELECT COUNT(*) AS n FROM author_action_receipts")[0].n),
        chapter_summaries: Number(all(db, "SELECT COUNT(*) AS n FROM chapter_summaries")[0].n),
      },
      chapters: chapterRows.map((row) => ({
        chapter_id: String(row.id),
        seq: Number(row.seq),
        title: String(row.title),
        status: String(row.status),
      })),
      chapter_text: chapterText,
      chapter_content_sha: chapterSha,
      accepted_drafts: Object.fromEntries(
        [...acceptedByChapter.entries()].map(([chapterId, rows]) => [
          chapterId,
          rows.map((row) => ({
            draft_id: row.draft_id,
            scene_id: row.scene_id,
            scene_seq: row.scene_seq,
            revision: row.revision,
            sha256: sha256Hex(row.content),
          })),
        ]),
      ),
    };
  });
}

// ── prepare / capture ──────────────────────────────────────────────────────
export async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE_ID, `ready.slice_id 必须为 ${SLICE_ID}`);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert.equal(ready.provider, "strata", `B28-SCOPE CP3 必须使用真实 strata provider，实测: ${ready.provider}`);

  const requested = requestedIds();
  const scenarios =
    requested.length > 0 ? SCENARIOS.filter((scenario) => requested.includes(scenario.id)) : SCENARIOS;
  assert(scenarios.length > 0, `B28S_SCOPE_SCENARIOS 过滤后没有场景: ${process.env.B28S_SCOPE_SCENARIOS}`);

  const workId = seedField(dir, "work_id");
  assert(workId, "seed.log 缺少 work_id");
  const target = {
    work_id: workId,
    work_title: workTitleInDb(dir, workId),
    control_chapter_id: seedField(dir, "control_chapter_id"),
    target_chapter_id: seedField(dir, "target_chapter_id"),
    target_chapter_title: seedField(dir, "target_title"),
  };
  assert(target.control_chapter_id, "seed.log 缺少 control_chapter_id");
  assert(target.target_chapter_id, "seed.log 缺少 target_chapter_id");

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
    strata_models_visible_at_prepare: endpointModels,
  });
  console.log(
    `B28-SCOPE CP3 证据准备完成: work=${target.work_id} title=${target.work_title} ` +
      `provider=${ready.provider} model=${modelName()} scenarios=${scenarios.map((s) => s.id).join(",")}`,
  );
}

export function capture(dir, checkpoint) {
  const config = read(dir, CONFIG_FILE);
  assert(config.checkpoints.includes(checkpoint), `未知 checkpoint: ${checkpoint}`);
  rewrite(dir, `b28-${checkpoint}.json`, {
    at: new Date().toISOString(),
    checkpoint,
    ...dbSnapshot(dir),
  });
}

// ── verify helpers ────────────────────────────────────────────────────────
function appEvents(dir) {
  return logs(path.join(dir, "app-log"));
}

function judgmentEventFor(appRecords, turnId) {
  const matches = appRecords.filter(
    (record) =>
      record.event === "judgment.decided.done" &&
      (String(record.turn_id ?? "") === turnId || String(record.turn_id ?? "").startsWith(`${turnId}:`)),
  );
  return matches.at(-1) ?? null;
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function chaptersIdentity(snapshot) {
  return (snapshot?.chapters ?? []).map((row) => [row.chapter_id, row.seq, row.title]).sort();
}

function countWriteDelta(before, after) {
  const keys = ["drafts", "versions", "author_action_receipts", "chapter_summaries"];
  return keys.filter((key) => before?.extra_counts?.[key] !== after?.extra_counts?.[key]);
}

export function verify(dir, sliceIdArg) {
  const config = read(dir, CONFIG_FILE);
  const sliceId = sliceIdArg ?? config.slice_id;
  assert.equal(sliceId, SLICE_ID, `verify slice 参数不一致: ${sliceId}`);
  assert.equal(config.slice_id, SLICE_ID, "prepare 配置 slice 不一致");

  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.provider, "strata", "verify 必须基于 strata 真实模型批次");
  const driverLog = read(dir, "b28-scope-native-driver-log.json");
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
  const appRecords = appEvents(dir);
  const checks = {
    provider_is_real_strata: wireCommon.providerStarts.every((record) => record.provider === "strata"),
    no_browser_frames: !fs.existsSync(path.join(dir, "ui-frames.json")),
    production_sources_unchanged: checkProductionFingerprint(dir).unchanged,
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
      read(dir, `b28-${checkpoint}.json`),
    ]),
  );

  const targetChapterId = String(config.target.target_chapter_id);
  const controlChapterId = String(config.target.control_chapter_id);
  const targetText = (snapshot) => String(snapshot?.chapter_text?.[targetChapterId] ?? "");
  const controlText = (snapshot) => String(snapshot?.chapter_text?.[controlChapterId] ?? "");

  const measured = { scenarios: {}, model: config.model, strata_endpoint: config.strata_endpoint };
  let previousCheckpoint = "start";

  for (const scenario of config.scenarios) {
    const scenarioChecks = {};
    const driverEntry = (driverLog.scenarios ?? []).find((entry) => entry.id === scenario.id);
    assert(driverEntry, `驱动日志缺少场景: ${scenario.id}`);

    const messages = sentUserMessages(wire, scenario.input);
    scenarioChecks.user_message_exact_once = messages.length === 1;

    const finalKind = String(driverEntry.final_kind ?? "turn_result");
    const facts = messages.length === 1 ? turnFacts(wire, messages[0]) : null;
    const turnId = facts?.turnId ?? driverEntry.turn_id;
    const turnResult = facts?.results?.at(-1)?.frame?.[4] ?? null;
    scenarioChecks.turn_id_matches_driver = Boolean(turnId && String(driverEntry.turn_id) === String(turnId));
    scenarioChecks.turn_result_present = Boolean(turnResult) || finalKind === "failed" || finalKind === "completed";

    const judgment =
      (turnId ? judgmentEventFor(appRecords, turnId) : null) ??
      (Array.isArray(driverEntry.judgment_events) && driverEntry.judgment_events.length > 0
        ? driverEntry.judgment_events.at(-1)
        : null);
    scenarioChecks.judgment_event_present = Boolean(judgment);

    const pending = driverEntry.pending_payload ? [driverEntry.pending_payload] : [];
    const adoption = driverEntry.adoption ?? null;
    const receipt = adoption?.receipt ?? null;
    const receiptEffect =
      receipt?.adoption_effect ?? receipt?.persistence?.adoption_effect ?? receipt?.persistence?.adoption_effect ?? null;
    const receiptStatus = String(receipt?.status ?? "");
    const beforeSnap = snapshots[previousCheckpoint];
    const afterSnap = snapshots[scenario.id];
    const targetBefore = targetText(beforeSnap);
    const targetAfter = targetText(afterSnap);
    const controlBefore = controlText(beforeSnap);
    const controlAfter = controlText(afterSnap);

    scenarioChecks.control_chapter_unchanged = controlBefore === controlAfter;

    if (scenario.expect.adopt === true) {
      scenarioChecks.judgment_action_execute = String(judgment?.action ?? "") === "execute";
      scenarioChecks.judgment_capability_expected =
        String(judgment?.capability ?? "") === scenario.expect.capability;
      scenarioChecks.pending_present = Boolean(driverEntry.pending_payload);
      scenarioChecks.pending_scope_expected =
        String(driverEntry.pending_payload?.modification_scope ?? "") === scenario.expect.scope;
      scenarioChecks.adoption_receipt_accepted = ["accepted", "committed", "applied"].includes(receiptStatus);
      scenarioChecks.adoption_effect_expected =
        String(receiptEffect?.mode ?? driverEntry.pending_payload?.adoption_effect?.mode ?? "") ===
        scenario.expect.effect;
      scenarioChecks.target_chapter_bytes_changed = targetAfter !== targetBefore;
      scenarioChecks.write_recorded = countWriteDelta(beforeSnap, afterSnap).length === 0;

      if (scenario.db === "literal_replace") {
        const expected = targetBefore.replace("二十五岁", "三十岁");
        scenarioChecks.literal_exact_replace = targetBefore.split("二十五岁").length === 2 && targetAfter === expected;
        scenarioChecks.only_literal_changed = targetAfter === expected;
      }

      if (scenario.db === "first_segment_only" || scenario.db === "second_segment_only") {
        const beforeParts = targetBefore.split("\n\n");
        const afterParts = targetAfter.split("\n\n");
        scenarioChecks.two_segment_shape = beforeParts.length === 2 && afterParts.length === 2;
        if (scenario.db === "first_segment_only") {
          scenarioChecks.first_segment_changed = beforeParts.length === 2 && afterParts[0] !== beforeParts[0];
          scenarioChecks.second_segment_byte_identical = beforeParts.length === 2 && afterParts[1] === beforeParts[1];
        } else {
          scenarioChecks.second_segment_changed = beforeParts.length === 2 && afterParts[1] !== beforeParts[1];
          scenarioChecks.first_segment_byte_identical = beforeParts.length === 2 && afterParts[0] === beforeParts[0];
        }
      }

      if (scenario.db === "whole_chapter") {
        scenarioChecks.chapter_identity_unchanged = sameJson(chaptersIdentity(beforeSnap), chaptersIdentity(afterSnap));
        scenarioChecks.chapter_count_unchanged = (beforeSnap?.chapters ?? []).length === (afterSnap?.chapters ?? []).length;
      }

      if (scenario.db === "format_only") {
        const nonNewline = (text) => text.replace(/[\r\n]/g, "");
        scenarioChecks.formatting_artifact =
          String(driverEntry.pending_payload?.artifact_type ?? "") === "prose_formatting_plan" ||
          String(receipt?.artifact_type ?? "") === "prose_formatting_plan";
        scenarioChecks.non_newline_bytes_preserved = nonNewline(targetBefore) === nonNewline(targetAfter);
        scenarioChecks.newline_structure_changed = targetBefore !== targetAfter;
      }
    } else {
      scenarioChecks.no_pending_candidate = !driverEntry.pending_payload;
      scenarioChecks.no_adoption = !adoption;
      scenarioChecks.zero_production_write = sameJson(beforeSnap?.db_production_counts, afterSnap?.db_production_counts);
      scenarioChecks.zero_extra_counts = countWriteDelta(beforeSnap, afterSnap).length === 0;
      scenarioChecks.target_chapter_unchanged = targetAfter === targetBefore;
      scenarioChecks.guarded_or_reply = ["reply", "guarded_rejection", "failed_recoverable", "turn_result"].includes(
        String(driverEntry.outcome_kind ?? finalKind),
      ) || nonEmpty(driverEntry.assistant_text);
      if ((driverEntry.questions ?? 0) > 0) {
        measured.scenarios[scenario.id] = {
          ...(measured.scenarios[scenario.id] ?? {}),
          author_supplements: driverEntry.questions,
          qualification: "author_supplement_required",
        };
      }
    }

    const failures = Object.keys(scenarioChecks).filter((key) => !scenarioChecks[key]);
    Object.assign(
      checks,
      Object.fromEntries(Object.entries(scenarioChecks).map(([key, value]) => [`${scenario.id}.${key}`, value])),
    );
    measured.scenarios[scenario.id] = {
      ...(measured.scenarios[scenario.id] ?? {}),
      kind: scenario.kind,
      input: scenario.input,
      final_kind: finalKind,
      turn_status: driverEntry.turn_status ?? turnResult?.status ?? null,
      outcome_kind: driverEntry.outcome_kind ?? null,
      questions: driverEntry.questions ?? 0,
      judgment_action: judgment?.action ?? null,
      judgment_capability: judgment?.capability ?? null,
      pending_scope: driverEntry.pending_payload?.modification_scope ?? null,
      adoption_effect: receiptEffect?.mode ?? null,
      receipt_status: receiptStatus || null,
      checks_failed: failures,
      turn_id: turnId,
      assistant_text_head: String(turnResult?.assistant_message?.text ?? driverEntry.assistant_text ?? "").slice(0, 200),
    };
    previousCheckpoint = scenario.id;
  }

  checks.full_matrix = config.full_matrix === true;
  checks.real_provider_calls_present = logs(path.join(dir, "llm-calls")).length >= config.scenarios.length;
  const failurePath = path.join(dir, "failure.json");
  checks.evidence_boundary_no_failure_json =
    !fs.existsSync(failurePath) ||
    JSON.parse(fs.readFileSync(failurePath, "utf8"))?.reason === "native_evidence_verification_failed";

  const failed = Object.keys(checks).filter((key) => !checks[key]);
  rewrite(dir, "b28-scope-native-checks.json", {
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
      "真实 macOS Tauri 窗口（嵌入真实前端 + 真实 Phoenix 后端）+ AX/CGEvent 外部驱动 + " +
      `真实 provider strata（model=${config.model}，单槽，运行后 unload 核验）+ 外部 WS/HTTP 传输代理 + ` +
      "隔离 test DB 只读快照；N3/N4 为只读拒改/条件整章零写入，X1 越界采纳拒绝由确定性测试覆盖，不伪造真实模型越界。",
    extra: {
      scenario_order: config.scenarios.map((scenario) => scenario.id),
      full_matrix: config.full_matrix,
      model: config.model,
      strata_endpoint: config.strata_endpoint,
      work_id: config.target.work_id,
      work_title: config.target.work_title,
      target_chapter_id: targetChapterId,
      control_chapter_id: controlChapterId,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
      model_lifecycle: { before, after },
      wait_ledger: common.ledger,
      screenshots: common.ui.screenshots,
    },
  });

  assertAllChecks(checks, `B28-SCOPE CP3 ${SLICE_ID}`);
  console.log(
    `B28-SCOPE CP3 原生场景通过: ${SLICE_ID} checks ${Object.keys(checks).length - failed.length}/${Object.keys(checks).length} ` +
      `scenarios=${config.scenarios.map((scenario) => scenario.id).join(",")} waits=${common.ledger.waits}`,
  );
  return { checks, measured };
}

export async function main([mode, artifact]) {
  const dir = path.resolve(artifact ?? "");
  if (!dir) {
    throw new Error(
      "usage: node scripts/native_b28_scope_evidence.mjs <prepare|capture|verify> <dir> [checkpoint|slice-id]",
    );
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
