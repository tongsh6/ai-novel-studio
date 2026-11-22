#!/usr/bin/env node
// B33 / R08：模型意图判断与客观协议边界的原生真实模型验收证据核验。
//
// 测量动作由外部 macOS AX/CGEvent 驱动真实 Tauri 窗口完成（scripts/native_b33_drive.mjs）；
// 本文件只消费隔离批次的既有证据：native-driver-ready/ui-complete/等待账/AX/截图/
// native-transport/app-log/llm-calls/模型生命周期/只读 SQLite。
//
// 场景（B33 §元原则整改 CP3 预注册 S1–S6）：
//   S1 条件性 no-op / S2 只解释编号 / S3 讨论主角 → 合法终局 reply，零候选零写入
//   S6 只讨论结尾 → 合法终局 reply，零候选零写入，不由词法守卫代替模型理解
//   S5 明确重编号正例 → execute maintain_chapter_structure → 采纳 → seq 连续、内容不变
//   S4 写章正例 → execute prose_writing → 采纳 → 第07章正文非空、其它章不变
//
// 模式：
//   prepare <dir>      读 seed/标最近打开、落生产指纹、写场景配置与模型元数据
//   capture <dir> <cp> 记录只读 DB 计数与章节/角色快照（start/S1..S6/final）
//   verify <dir> [id]  核验并写 summary.json / b33-native-checks.json
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
  broadcastFrames,
  checkProductionFingerprint,
  frameBody,
  logs,
  productionFingerprint,
  productionTableCounts,
  read,
  rewrite,
  sentUserMessages,
  transport,
  requestIdentity,
  requestReplies,
  withDb,
  write,
  writeNativeSummary,
} from "./lib/native_ui/scenario_evidence.mjs";
import { planningCanonSnapshot } from "./lib/native_ui/authoring_capture_evidence.mjs";
import { compareAuthoringCanonSnapshots } from "./lib/native_ui/authoring_canon_evidence.mjs";
import { wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import {
  actionAck, actionFrame, actionResult, selectPendingAction,
} from "./lib/native_ui/authoring_pending_evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SLICE_ID = "b33-authoring-intent-judgment-reliability";
export const CONFIG_FILE = "native-b33-config.json";

export const SCENARIOS = Object.freeze([
  {
    id: "S1",
    kind: "conditional_noop",
    input: "帮我修改第03章正文中的错别字；如果没有错别字，就告诉我无需修改。",
    expect_action: "reply",
    zero_write: true,
  },
  {
    id: "S2",
    kind: "explain_only",
    input: "解释一下第03章为什么采用全书连续编号，只解释，不要修改。",
    expect_action: "reply",
    zero_write: true,
  },
  {
    id: "S3",
    kind: "discussion_character",
    input: "讨论一下把陆晨指定为主角是否合理，先不要生成候选。",
    expect_action: "reply",
    zero_write: true,
  },
  {
    id: "S6",
    kind: "discussion_ending",
    input: "只聊第03章结尾怎么处理，先别动笔。",
    expect_action: "reply",
    zero_write: true,
  },
  {
    id: "S5",
    kind: "execute_maintenance",
    input: "把全书章节编号理顺，只改列表编号，内容不要动。",
    expect_action: "execute",
    expect_capability: "maintain_chapter_structure",
    adopt: true,
  },
  {
    id: "S4",
    kind: "execute_prose",
    input: "第07章的正文还没写，帮我写出来吧。",
    expect_action: "execute",
    expect_capability: "prose_writing",
    adopt: true,
  },
]);

const byId = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));
const modelName = () => process.env.NOVEL_STRATA_MODEL ?? "iq3_s";
const strataEndpoint = () => process.env.NOVEL_STRATA_ENDPOINT ?? "http://127.0.0.1:47831/v1";

const requestedIds = () => {
  const ids = (process.env.B33_SCENARIOS ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  assert(ids.every((id) => byId.has(id)), "B33_SCENARIOS 包含未登记场景");
  assert.equal(new Set(ids).size, ids.length, "B33_SCENARIOS 不得重复登记同一场景");
  return ids;
};

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

function onlyWork(dir) {
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT id, title FROM works ORDER BY updated_at DESC");
    assert(rows.length >= 1, "隔离 DB 没有任何作品（seed 缺失）");
    return { work_id: String(rows[0].id), work_title: String(rows[0].title), session_id: null };
  });
}

// ── DB 快照：生产表计数 + 章节/角色/采纳事实（只读）─────────────────────────────
function dbSnapshot(dir) {
  return withDb(dir, (db) => {
    const chapterRows = all(db, "SELECT id, seq, title, status FROM chapters ORDER BY seq");
    const draftRows = all(
      db,
      "SELECT d.content, d.status, s.chapter_id FROM drafts d JOIN scenes s ON s.id = d.scene_id",
    );
    const chapterContent = {};
    for (const row of draftRows) {
      if (String(row.status) !== "ACCEPTED") continue;
      const key = String(row.chapter_id ?? "none");
      chapterContent[key] = `${chapterContent[key] ?? ""}${String(row.content ?? "")}`;
    }
    const characterRows = all(db, "SELECT id, name, narrative_role FROM characters ORDER BY name");
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
      chapter_content_sha: Object.fromEntries(
        Object.entries(chapterContent).map(([chapterId, content]) => [
          chapterId,
          sha256Hex(content),
        ]),
      ),
      characters: characterRows.map((row) => ({
        character_id: String(row.id),
        name: String(row.name),
        narrative_role: String(row.narrative_role),
      })),
    };
  });
}

function sha256Hex(text) {
  return execFileSync("shasum", ["-a", "256"], { input: String(text ?? "") })
    .toString()
    .split(/\s+/)[0];
}

// ── prepare / capture ──────────────────────────────────────────────────────
export async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE_ID, `ready.slice_id 必须为 ${SLICE_ID}`);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert.equal(ready.provider, "strata", `B33 CP3 必须使用真实 strata provider，实测: ${ready.provider}`);

  const requested = requestedIds();
  const scenarios = requested.length > 0 ? SCENARIOS.filter((scenario) => requested.includes(scenario.id)) : SCENARIOS;
  assert(scenarios.length > 0, `B33_SCENARIOS 过滤后没有场景: ${process.env.B33_SCENARIOS}`);

  const seedWorkId = seedField(dir, "work_id");
  const target = seedWorkId
    ? {
        work_id: seedWorkId,
        work_title: workTitleInDb(dir, seedWorkId),
        session_id: seedField(dir, "session_id"),
      }
    : onlyWork(dir);

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
    `B33 CP3 证据准备完成: work=${target.work_id} title=${target.work_title} ` +
      `provider=${ready.provider} model=${modelName()} scenarios=${scenarios.map((s) => s.id).join(",")}`,
  );
}

export function capture(dir, checkpoint) {
  const config = read(dir, CONFIG_FILE);
  assert(config.checkpoints.includes(checkpoint), `未知 checkpoint: ${checkpoint}`);
  write(dir, `b33-${checkpoint}.json`, {
    at: new Date().toISOString(),
    checkpoint,
    ...dbSnapshot(dir),
    authoring_canon: planningCanonSnapshot(dir, { includeChapterFacts: false }),
  });
}

// ── verify ────────────────────────────────────────────────────────────────


function pendingOf(turnResult) {
  return turnResult?.adoption_state?.pending ?? [];
}

function sameCounts(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function discussionEvidenceChecks({ before, after, turnResult, judgment, driverEntry }) {
  const canon = compareAuthoringCanonSnapshots(before.authoring_canon, after.authoring_canon);
  return {
    judgment_action_reply: judgment?.action === "reply" && driverEntry.final_kind === "turn_result",
    no_failed_result: turnResult?.status !== "failed" && driverEntry.turn_status !== "failed",
    no_author_supplement: driverEntry.questions === 0,
    no_author_question: turnResult?.author_question == null,
    no_pending_candidate: pendingOf(turnResult).length === 0,
    zero_production_write: canon.checks.no_canon_write,
    memory_reference_updates_accounted: canon.checks.memory_reference_updates_accounted,
    zero_candidate_write: Boolean(before.extra_counts && after.extra_counts) &&
      sameCounts(before.extra_counts, after.extra_counts),
  };
}

export function verify(dir, sliceIdArg) {
  const config = read(dir, CONFIG_FILE);
  const sliceId = sliceIdArg ?? config.slice_id;
  assert.equal(sliceId, SLICE_ID, `verify slice 参数不一致: ${sliceId}`);
  assert.equal(config.slice_id, SLICE_ID, "prepare 配置 slice 不一致");

  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.provider, "strata", "B33 CP3 verify 必须基于 strata 真实模型批次");
  const driverLog = read(dir, "b33-native-driver-log.json");
  assert.equal(driverLog.provider, "strata", "驱动日志 provider 必须为 strata");
  assert.equal(driverLog.model, config.model, "驱动日志 model 与准备配置不一致");

  const common = assertCommonEvidence(dir, {
    sliceId: SLICE_ID,
    minScreenshots: config.scenarios.length + 2,
    minimumWaits: Math.max(8, config.scenarios.length * 3),
    // runner 在「证据核验失败」时会写 failure.json 标记；重跑 verify 时该标记本身不是
    // driver 失败证据，只有其它 reason 的 failure.json 才阻止 PASS。
    allowVerificationFailureMarker: true,
  });
  const wireCommon = assertProviderAndWire(dir, {
    minUserMessages: Math.max(1, config.scenarios.length),
    minTurnResults: Math.max(1, config.scenarios.length),
    minProviderStarts: Math.max(1, config.scenarios.length),
    expectProviders: ["strata"],
  });

  const wire = transport(dir);
  const sentInputs = wire.filter((entry) =>
    entry.direction === "sent" && Array.isArray(entry.frame) && entry.frame[3] === "user_message");
  const checks = {
    provider_is_real_strata: wireCommon.providerStarts.every((record) => record.provider === "strata"),
    no_browser_frames: !fs.existsSync(path.join(dir, "ui-frames.json")),
    scenario_registry_matches_frozen_matrix: sameCounts(config.scenarios, SCENARIOS),
    production_sources_unchanged: checkProductionFingerprint(dir).unchanged,
    author_inputs_match_frozen_matrix: sameCounts(
      sentInputs.map((entry) => entry.frame[4]?.text),
      config.scenarios.map((scenario) => scenario.input),
    ),
    no_unregistered_author_answer: !wire.some((entry) =>
      entry.direction === "sent" && Array.isArray(entry.frame) &&
      (entry.frame[3] === "agent_command" ||
        (entry.frame[3] === "author_action" && entry.frame[4]?.action?.action_type === "author_choice"))),
  };

  // 模型生命周期：运行前记录 + 结束卸载并核验为空。
  const before = read(dir, "model-lifecycle-before.json");
  const after = read(dir, "model-lifecycle-after.json");
  checks.model_lifecycle_before_recorded = Boolean(before?.at && before?.provider === "strata");
  checks.model_unloaded_after = Boolean(
    after?.unloaded === true || (after && after.loaded === null) || (after && after.loaded_after === null),
  );
  checks.model_loaded_before_consistent =
    before?.loaded_before === null || before?.loaded_before === undefined || before?.loaded_before === modelName();

  const snapshots = Object.fromEntries(
    ["start", ...config.scenarios.map((scenario) => scenario.id), "final"].map((checkpoint) => [
      checkpoint,
      read(dir, `b33-${checkpoint}.json`),
    ]),
  );

  const measured = { scenarios: {}, model: config.model, strata_endpoint: config.strata_endpoint };
  const assertions = [];
  let previousCheckpoint = "start";

  for (const scenario of config.scenarios) {
    const scenarioChecks = {};
    const driverEntry = (driverLog.scenarios ?? []).find((entry) => entry.id === scenario.id);
    assert(driverEntry, `驱动日志缺少场景: ${scenario.id}`);
    const messages = sentUserMessages(wire, scenario.input);
    scenarioChecks.user_message_exact_once = messages.length === 1;

    const finalKind = String(driverEntry.final_kind ?? "");
    let turnResult = null;
    let turnId = null;
    let identity = null;
    let terminal = null;
    let judgment = null;
    scenarioChecks.author_ack_accepted = false;
    scenarioChecks.user_message_scope_matches = false;
    if (messages.length === 1) {
      const message = messages[0];
      const body = frameBody(message);
      const request = requestIdentity(message);
      const replies = requestReplies(wire, request, message.at);
      const ack = frameBody(replies[0]);
      turnId = body?.turn_id;
      scenarioChecks.author_ack_accepted = replies.length === 1 &&
        ack?.status === "ok" && ack.response?.turn_id === turnId &&
        typeof ack.response?.run_id === "string" && ack.response.run_id !== "";
      scenarioChecks.user_message_scope_matches = body?.work_id === config.target.work_id &&
        typeof body?.session_id === "string" && body.session_id !== "" &&
        (!config.target.session_id || body.session_id === config.target.session_id);
      if (scenarioChecks.author_ack_accepted && scenarioChecks.user_message_scope_matches) {
        identity = {
          topic: request.topic, turnId, runId: ack.response.run_id,
          workId: body.work_id, sessionId: body.session_id, since: message.at,
        };
        terminal = wireTerminal(wire, {
          ...identity, resultPosition: "last", requireWireTerminal: true,
        });
        if (terminal?.kind === "completed") turnResult = terminal.body;
        const judgmentEvents = broadcastFrames(wire, {
          topic: identity.topic, at: identity.since, runRef: identity.runId, event: "agent_event",
        }).filter((entry) => frameBody(entry)?.event_type === "judgment_decided");
        judgment = frameBody(judgmentEvents.at(-1))?.payload ?? null;
      }
    }
    scenarioChecks.run_completed = terminal?.kind === "completed";
    scenarioChecks.turn_result_present = finalKind === "turn_result" && Boolean(turnResult);
    scenarioChecks.turn_id_matches_driver = Boolean(turnId && driverEntry.turn_id === turnId);
    scenarioChecks.run_id_matches_driver = Boolean(identity && driverEntry.run_id === identity.runId);
    scenarioChecks.assistant_text_nonempty = nonEmpty(turnResult?.assistant_message?.text);
    scenarioChecks.no_failed_or_question_result = Boolean(turnResult) &&
      turnResult.status !== "failed" && turnResult.author_question == null;
    scenarioChecks.judgment_event_present = Boolean(judgment);
    measured.scenarios[scenario.id] = {
      ...(measured.scenarios[scenario.id] ?? {}),
      final_kind: finalKind,
      pauses: (driverEntry.questions ?? 0),
      run_id: driverEntry.run_id ?? null,
      judgment_events: driverEntry.judgment_events ?? [],
    };

    if (scenario.expect_action === "reply") {
      Object.assign(scenarioChecks, discussionEvidenceChecks({
        before: snapshots[previousCheckpoint],
        after: snapshots[scenario.id],
        turnResult,
        judgment,
        driverEntry,
      }));
    } else if (scenario.expect_action === "execute") {
      const action = String(judgment?.action ?? "");
      const capability = String(judgment?.capability ?? "");
      const pending = pendingOf(turnResult);
      scenarioChecks.judgment_execute = action === "execute";
      scenarioChecks.judgment_capability_expected = capability === scenario.expect_capability;
      scenarioChecks.pending_target_unique = pending.length === 1;
      scenarioChecks.adoption_receipt_accepted = false;
      scenarioChecks.adoption_log_matches_wire = false;
      if (pending.length === 1 && identity && terminal?.kind === "completed") {
        const artifactId = pending[0].artifact_id;
        const authorAction = selectPendingAction(turnResult, { artifactId, actionType: "accept" });
        const sent = actionFrame(wire, {
          topic: identity.topic, since: terminal.record.at, action: authorAction,
        });
        const ack = actionAck(wire, sent, { actionStatus: "accepted" });
        const receipt = actionResult(wire, {
          topic: identity.topic, since: sent.at, action: authorAction, actionStatus: "accepted",
        });
        scenarioChecks.adoption_receipt_accepted = frameBody(receipt)?.status === "accepted";
        scenarioChecks.adoption_log_matches_wire =
          driverEntry.adoption?.artifact_id === artifactId &&
          sameCounts(driverEntry.adoption?.send, frameBody(sent)) &&
          sameCounts(driverEntry.adoption?.ack, frameBody(ack.reply)) &&
          sameCounts(driverEntry.adoption?.receipt, frameBody(receipt));
      }
      const afterSnap = snapshots[scenario.id];
      if (scenario.id === "S5") {
        scenarioChecks.chapters_seq_dense = isDense(afterSnap?.chapters ?? []);
        const startChapters = snapshots.start?.chapters ?? [];
        scenarioChecks.chapter_titles_unchanged = sameCounts(
          startChapters.map((row) => [row.chapter_id, row.title]).sort(),
          (afterSnap?.chapters ?? []).map((row) => [row.chapter_id, row.title]).sort(),
        );
        scenarioChecks.chapter_content_unchanged = sameCounts(
          snapshots.start?.chapter_content_sha,
          afterSnap?.chapter_content_sha,
        );
        scenarioChecks.characters_unchanged = sameCounts(snapshots.start?.characters, afterSnap?.characters);
      }
      if (scenario.id === "S4") {
        const chapter7 = (snapshots.start?.chapters ?? []).find((row) => row.seq === 7);
        const chapter7Id = chapter7?.chapter_id ?? null;
        const startSha = chapter7Id ? snapshots.start?.chapter_content_sha?.[chapter7Id] : null;
        const afterSha = chapter7Id ? afterSnap?.chapter_content_sha?.[chapter7Id] : null;
        scenarioChecks.chapter7_content_nonempty = Boolean(chapter7Id && afterSha && afterSha !== startSha);
        const startContent = { ...(snapshots.start?.chapter_content_sha ?? {}) };
        const afterContent = { ...(afterSnap?.chapter_content_sha ?? {}) };
        if (chapter7Id) {
          delete startContent[chapter7Id];
          delete afterContent[chapter7Id];
        }
        scenarioChecks.other_chapters_unchanged = sameCounts(startContent, afterContent);
      }
      measured.scenarios[scenario.id] = {
        kind: scenario.kind,
        judgment_action: action,
        judgment_capability: capability,
        pending_count: pending.length,
        pending_kinds: pending.map((entry) => entry?.payload?.object_kind ?? entry?.payload?.artifact_type ?? null),
        adoption: driverEntry.adoption ?? null,
      };
    }

    const failures = Object.keys(scenarioChecks).filter((key) => !scenarioChecks[key]);
    Object.assign(checks, Object.fromEntries(Object.entries(scenarioChecks).map(([key, value]) => [`${scenario.id}.${key}`, value])));
    measured.scenarios[scenario.id] = {
      ...(measured.scenarios[scenario.id] ?? {}),
      checks_failed: failures,
      turn_id: turnId,
      questions: driverEntry.questions ?? 0,
      assistant_text_head: String(turnResult?.assistant_message?.text ?? driverEntry.assistant_text ?? "").slice(0, 200),
    };
    previousCheckpoint = scenario.id;
  }

  // 模型行为证据边界：必须至少有一次真实 provider 调用记录（llm-calls 已由 common 断言）。
  checks.full_matrix = config.full_matrix === true;
  const llmRecords = logs(path.join(dir, "llm-calls"));
  checks.real_provider_calls_present = llmRecords.length >= config.scenarios.length;
  const failurePath = path.join(dir, "failure.json");
  checks.evidence_boundary_no_failure_json =
    !fs.existsSync(failurePath) ||
    JSON.parse(fs.readFileSync(failurePath, "utf8"))?.reason ===
      "native_evidence_verification_failed";

  const failed = Object.keys(checks).filter((key) => !checks[key]);
  rewrite(dir, "b33-native-checks.json", {
    slice_id: SLICE_ID,
    at: new Date().toISOString(),
    checks,
    failed,
    assertions: Object.keys(checks).filter((key) => checks[key]),
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
      "隔离 test DB 完整内容快照；S1/S2/S3/S6 为讨论或条件性 no-op，固定输入不由驱动追加答案。",
    extra: {
      scenario_order: config.scenarios.map((scenario) => scenario.id),
      full_matrix: config.full_matrix,
      model: config.model,
      strata_endpoint: config.strata_endpoint,
      work_id: config.target.work_id,
      work_title: config.target.work_title,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
      model_lifecycle: { before, after },
      wait_ledger: common.ledger,
      screenshots: common.ui.screenshots,
    },
  });

  assertAllChecks(checks, `B33 CP3 ${SLICE_ID}`);
  console.log(
    `B33 CP3 原生场景通过: ${SLICE_ID} checks ${Object.keys(checks).length - failed.length}/${Object.keys(checks).length} ` +
      `scenarios=${config.scenarios.map((scenario) => scenario.id).join(",")} waits=${common.ledger.waits}`,
  );
  return { checks, measured };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isDense(chapters) {
  const seqs = chapters.map((row) => row.seq).sort((left, right) => left - right);
  return seqs.every((seq, index) => seq === index + 1);
}

export async function main([mode, artifact]) {
  const dir = path.resolve(artifact ?? "");
  if (!dir) {
    throw new Error(
      "usage: node scripts/native_b33_evidence.mjs <prepare|capture|verify> <dir> [checkpoint|slice-id]",
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
