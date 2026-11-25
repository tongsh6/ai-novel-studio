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
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import {
  ledgerChangesBound, ledgerSnapshotRows, observedProviderResponses, providerCallPairs, requiredRows,
  rowsPreserved, scopeRowValues, summaryAuxiliaryFact,
} from "./lib/native_ui/chapter_summary_maintenance_evidence.mjs";
import {
  all,
  assertAllChecks,
  assertCommonEvidence,
  assertProviderAndWire,
  broadcastFrames,
  checkProductionFingerprint,
  frameBody,
  productionFingerprint,
  PRODUCTION_TABLES,
  read,
  rewrite,
  sentUserMessages,
  transport,
  requestIdentity,
  requestReplies,
  withDb,
  write,
  writeNativeSummary,
  shaFile,
  readProviderObservation,
  checkedScenarioPreregistration,
} from "./lib/native_ui/scenario_evidence.mjs";
import { RUNTIME_PROFILE_ID, assertRuntimeFacts, getRuntimeProfile } from "./lib/native_ui/request_cost_runtime_recipe.mjs";
import { providerOperation, providerTurnMatchesParent, readProviderRuns } from "./lib/native_ui/authoring_call_evidence.mjs";
import { requestSettingsFacts } from "./lib/native_ui/request_cost_capture.mjs";
import { NATIVE_CHAT_WIRE, requestFactsFromRecord } from "./lib/native_ui/authoring_request_facts.mjs";
import { DEFAULT_STRATA_ENDPOINT } from "./lib/native_ui/strata_lifecycle.mjs";
import { referenceLogRows } from "./lib/native_ui/reference_log_evidence.mjs";
import { CANON_TABLES, buildAuthoringCanonSnapshot, compareAuthoringCanonSnapshots, uuidFromHex } from "./lib/native_ui/authoring_canon_evidence.mjs";
import { wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import {
  actionAck, actionFrame, actionResult, actionTurnResult, adoptionMaintenanceOutcome, canonTableSignature, selectPendingAction,
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
export const B33_BUDGET = Object.freeze({
  max_author_inputs: SCENARIOS.length, max_harness_retries: 0,
  turn_timeout_ms: 330_000, ack_timeout_ms: 60_000,
});

const requestedIds = (env) => {
  const ids = (env.B33_SCENARIOS ?? "").split(",").map((part) => part.trim()).filter(Boolean);
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
function capturedRows(db, table, rows = all(db, "SELECT * FROM " + table + " ORDER BY id")) {
  return scopeRowValues(table, rows);
}
function dbSnapshot(dir, at) {
  return withDb(dir, (db) => {
    db.exec("BEGIN");
    try {
      const tables = Object.fromEntries(CANON_TABLES.map((table) =>
        [table, all(db, "SELECT * FROM " + table + " ORDER BY id")]));
      const chapterRows = all(db, "SELECT id, work_id, seq, title, status FROM chapters ORDER BY seq");
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
        db_production_counts: Object.fromEntries(PRODUCTION_TABLES.map((table) => [
          table, Number(all(db, "SELECT COUNT(*) AS n FROM " + table)[0].n),
        ])),
        authoring_canon: buildAuthoringCanonSnapshot({
          tables, referenceLogs: referenceLogRows(db), at, includeChapterFacts: false,
        }),
        extra_counts: {
          drafts: Number(all(db, "SELECT COUNT(*) AS n FROM drafts")[0].n),
          versions: Number(all(db, "SELECT COUNT(*) AS n FROM versions")[0].n),
          author_action_receipts: Number(all(db, "SELECT COUNT(*) AS n FROM author_action_receipts")[0].n),
          chapter_summaries: Number(all(db, "SELECT COUNT(*) AS n FROM chapter_summaries")[0].n),
        },
        chapters: chapterRows.map((row) => ({
          chapter_id: String(row.id),
          work_id: row.work_id instanceof Uint8Array ? uuidFromHex(Buffer.from(row.work_id).toString("hex")) : String(row.work_id),
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
        action_receipts: capturedRows(db, "author_action_receipts", tables.author_action_receipts),
        scope_rows: {
          ...Object.fromEntries(["drafts", "scenes", "memory_items", "mutations", "versions", "chapter_summaries", "ledger_entries"]
            .map((table) => [table, capturedRows(db, table, tables[table])])),
          interactions: capturedRows(db, "interactions").filter((row) => row.role === "assistant" &&
            (row.content?.turn_result?.adoption_state?.pending?.length > 0 ||
              row.content?.turn_result?.adoption_state?.resolved?.length > 0)),
        },
        characters: characterRows.map((row) => ({
          character_id: String(row.id),
          name: String(row.name),
          narrative_role: String(row.narrative_role),
        })),
      };
    } finally {
      db.exec("ROLLBACK");
    }
  });
}

function sha256Hex(text) {
  return execFileSync("shasum", ["-a", "256"], { input: String(text ?? "") })
    .toString()
    .split(/\s+/)[0];
}


function checkedPreregistration(file, dir, config) {
  return checkedScenarioPreregistration(file, dir, { ...config, budget: B33_BUDGET });
}

export function readB33ProviderObservation(dir, config) {
  const marker = config.preregistration;
  assert(marker, "B33 frozen preregistration marker missing");
  assert.deepEqual(checkedPreregistration(marker.path, dir, config), marker, "B33 preregistration or observation changed");
  return readProviderObservation(marker.proxy_dir);
}
// ── prepare / capture ──────────────────────────────────────────────────────
export async function prepare(dir, { env = process.env } = {}) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE_ID, `ready.slice_id 必须为 ${SLICE_ID}`);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert(["strata", "splash"].includes(ready.provider), `B33 需要已登记真实 provider: ${ready.provider}`);
  let runtime = null;
  if (ready.provider === "splash") {
    const observed = read(dir, "runtime-facts.json");
    assertRuntimeFacts(observed, RUNTIME_PROFILE_ID);
    runtime = { profile: RUNTIME_PROFILE_ID, observed, facts_sha256: shaFile(path.join(dir, "runtime-facts.json")) };
  }
  const model = runtime?.observed.provider.model ?? env.NOVEL_STRATA_MODEL;
  assert(nonEmpty(model), "B33 必须明确本批模型，不能猜测历史默认模型");
  const endpoint = runtime?.observed.provider.endpoint ?? env.NOVEL_STRATA_ENDPOINT ?? `${DEFAULT_STRATA_ENDPOINT}/v1`;
  const url = new URL(endpoint);
  assert(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
    "B33 endpoint 必须是无凭证的服务地址");

  const requested = requestedIds(env);
  const scenarios = requested.length > 0 ? SCENARIOS.filter((scenario) => requested.includes(scenario.id)) : SCENARIOS;
  assert(scenarios.length > 0, `B33_SCENARIOS 过滤后没有场景: ${process.env.B33_SCENARIOS}`);

  const preregistration = checkedPreregistration(env.B33_NATIVE_PREREGISTRATION, dir, {
    provider: ready.provider, model, endpoint, scenarios,
  });

  const seedWorkId = seedField(dir, "work_id");
  const target = seedWorkId
    ? {
        work_id: seedWorkId,
        work_title: workTitleInDb(dir, seedWorkId),
        session_id: seedField(dir, "session_id"),
      }
    : onlyWork(dir);

  write(dir, "production-sources-before.json", productionFingerprint());

  write(dir, CONFIG_FILE, {
    slice_id: SLICE_ID,
    provider: ready.provider,
    model,
    endpoint,
    runtime,
    budget: B33_BUDGET,
    preregistration,
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    target,
    requested_by_env: requested,
    scenarios,
    full_matrix: scenarios.length === SCENARIOS.length,
    checkpoints: ["start", ...scenarios.flatMap((scenario) =>
      scenario.adopt ? [scenario.id + "-before-adoption", scenario.id] : [scenario.id]), "final"],
  });
  console.log(
    `B33 CP3 证据准备完成: work=${target.work_id} title=${target.work_title} ` +
      `provider=${ready.provider} model=${model} scenarios=${scenarios.map((s) => s.id).join(",")}`,
  );
}

export function capture(dir, checkpoint) {
  const config = read(dir, CONFIG_FILE);
  assert(config.checkpoints.includes(checkpoint), `未知 checkpoint: ${checkpoint}`);
  const at = new Date().toISOString();
  write(dir, `b33-${checkpoint}.json`, {
    at,
    checkpoint,
    ...dbSnapshot(dir, at),
  });
}

// ── verify ────────────────────────────────────────────────────────────────


function pendingOf(turnResult) {
  return turnResult?.adoption_state?.pending ?? [];
}

export function selectB33PendingArtifact(turnResult, { wire, identity, scenario, start } = {}) {
  const reject = (reason) => ({ unique: false, artifact: undefined, reason });
  if (!identity || !Array.isArray(wire) || ![identity.runId, identity.turnId,
    identity.workspaceId, identity.workId, identity.sessionId, identity.since].every(nonEmpty) ||
    identity.topic !== "workspace:" + identity.workspaceId) return reject("identity_missing");
  // 离线 verify 也使用点击前的真实 run 终态；动作增量不能替换原候选清单。
  const actionIndex = wire.findIndex((record) => record.direction === "sent" &&
    record.frame?.[2] === identity.topic && record.frame?.[3] === "author_action" &&
    frameBody(record)?.action?.source_turn_ref === turnResult?.turn_id);
  const beforeAction = actionIndex < 0 ? wire : wire.slice(0, actionIndex);
  const terminal = wireTerminal(beforeAction, { ...identity, resultPosition: "last", requireWireTerminal: true });
  const sameScope = (body) => body?.workspace_id === identity.workspaceId &&
    body?.work_id === identity.workId && body?.session_id === identity.sessionId;
  const states = beforeAction.filter((record) => record.direction === "received" &&
    record.frame?.[2] === identity.topic && record.frame?.[3] === "agent_run_state" &&
    record.at >= identity.since && sameScope(frameBody(record)) &&
    frameBody(record)?.run_id === identity.runId && frameBody(record)?.parent_turn_ref === identity.turnId);
  const state = frameBody(states.at(-1));
  if (terminal?.kind !== "completed" || state?.status !== "completed" ||
    !sameScope(turnResult) || !sameCounts(terminal.body, turnResult) ||
    turnResult.status === "failed" || turnResult.author_question != null) return reject("run_not_bound");
  const pending = turnResult.adoption_state?.pending;
  const refs = state.pending_artifact_refs;
  if (!Array.isArray(pending) || !Array.isArray(refs) ||
    refs.length !== pending.length || new Set(refs).size !== refs.length ||
    new Set(pending.map((entry) => entry?.artifact_id)).size !== pending.length ||
    !pending.every((entry) => nonEmpty(entry?.artifact_id) && refs.includes(entry.artifact_id) &&
      entry.adoption_status === "TENTATIVE" && entry.requires_adoption === true &&
      Array.isArray(entry.payload?.items) && entry.payload.items.length > 0)) return reject("pending_refs_mismatch");
  if (scenario?.id === "S5") {
    const artifact = pending[0];
    return pending.length === 1 && artifact?.artifact_type === "chapter_structure_change_plan"
      ? { unique: true, artifact, pending, terminal } : reject("structure_target_not_unique");
  }
  if (scenario?.id !== "S4") return reject("scenario_not_adoptable");
  const chapters = (start?.chapters ?? []).filter((row) => row.seq === 7 && nonEmpty(row.chapter_id));
  if (chapters.length !== 1) return reject("frozen_chapter_missing");
  const chapterRef = "chapter:" + chapters[0].chapter_id;
  const prose = pending.filter((entry) => entry.artifact_type === "prose_fragment");
  const companionTypes = new Set(["character_seed", "foreshadowing_seed", "world_rule_seed", "constraint_seed"]);
  if (prose.length !== 1 || prose[0].target_chapter_ref !== chapterRef ||
    !nonEmpty(prose[0].source_tool_result_ref) ||
    pending.some((entry) => entry !== prose[0] &&
      (!companionTypes.has(entry.artifact_type) ||
        entry.source_tool_result_ref !== prose[0].source_tool_result_ref))) return reject("prose_target_not_unique");
  return { unique: true, artifact: prose[0], pending, chapterRef, terminal };
}


function rowDelta(before, after, table) {
  const oldRows = requiredRows(before, table);
  const newRows = requiredRows(after, table);
  return { oldRows, newRows, added: newRows.filter((row) => !oldRows.some((old) => old.id === row.id)) };
}


function persistedAdoptionChecks({ before, after, identity, turnResult, actionResult, artifact, receipt, action }) {
  const receipts = rowDelta(before, after, "action_receipts");
  const stored = receipts.added.length === 1 ? receipts.added[0] : null;
  const inScope = (row) => row.role === "assistant" && row.workspace_id === identity.workspaceId &&
    row.session_id === identity.sessionId;
  const sourceRows = (snapshot) => requiredRows(snapshot, "interactions").filter((row) =>
    inScope(row) && row.turn_id === turnResult.turn_id);
  const beforeSource = sourceRows(before);
  const afterSource = sourceRows(after);
  // Scope 在 WS 外壳及 interaction 行上；MemoryLog 中的原 TurnResult 不带这三个传输字段。
  const persistedBody = (body) => Object.fromEntries(Object.entries(body ?? {})
    .filter(([key]) => !["workspace_id", "work_id", "session_id"].includes(key)));
  const storedMatches = (row, body) => {
    const storedBody = row.content?.turn_result;
    return [["workspace_id", identity.workspaceId], ["work_id", identity.workId], ["session_id", identity.sessionId]]
      .every(([key, value]) => storedBody?.[key] === undefined || storedBody[key] === value) &&
      isDeepStrictEqual(persistedBody(storedBody), persistedBody(body));
  };
  const sourceMatches = (rows) => rows.length === 1 && storedMatches(rows[0], turnResult);
  const interactions = requiredRows(after, "interactions").filter(inScope);
  const appliedRows = interactions.filter((row) => row.turn_id === actionResult.turn_id);
  const resolved = interactions.flatMap((row) => row.content?.turn_result?.adoption_state?.resolved ?? []);
  const companions = pendingOf(turnResult).filter((entry) => entry.artifact_id !== artifact.artifact_id);
  const mutations = requiredRows(after, "mutations");
  return {
    adoption_receipt_persisted: Boolean(stored && stored.work_id === identity.workId &&
      stored.session_id === identity.sessionId && stored.source_turn_ref === action.source_turn_ref &&
      stored.action_id === action.action_id && stored.action_type === action.action_type &&
      stored.idempotency_key === action.idempotency_key && stored.status === "accepted"),
    persisted_receipt_result_matches_wire: Boolean(stored?.result?.decision === "ACCEPTED" &&
      stored.result.decided_by === "author" && Object.entries(receipt).filter(([key]) => key !== "decision")
        .every(([key, value]) => Object.hasOwn(stored.result, key) && isDeepStrictEqual(stored.result[key], value))),
    existing_receipts_preserved: receipts.newRows.length === receipts.oldRows.length + 1 &&
      rowsPreserved(receipts.oldRows, receipts.newRows),
    source_candidates_persisted: sourceMatches(beforeSource) && sourceMatches(afterSource),
    action_result_persisted: appliedRows.length === 1 &&
      storedMatches(appliedRows[0], actionResult) &&
      !requiredRows(before, "interactions").some((row) => row.id === appliedRows[0].id),
    companions_remain_unadopted: companions.every((entry) =>
      afterSource.length === 1 && pendingOf(afterSource[0].content?.turn_result)
        .filter((candidate) => candidate.artifact_id === entry.artifact_id)
        .some((candidate) => isDeepStrictEqual(candidate, entry)) &&
      !resolved.some((candidate) => candidate?.artifact_id === entry.artifact_id) &&
      !receipts.newRows.some((row) => row.result?.artifact_id === entry.artifact_id) &&
      !mutations.some((row) => row.target_object_ref === entry.artifact_id ||
        row.proposed_change_ref === entry.artifact_id)),
  };
}


function proseLedgerScopeBound({ before, after, identity, receipt, sourceTurnId, since, appRecords }) {
  try {
    const oldSignature = canonTableSignature(before.authoring_canon, "ledger_entries");
    const newSignature = canonTableSignature(after.authoring_canon, "ledger_entries");
    // Old pure adoption fixtures can prove no change by their existing complete canonical hashes.
    // Actual verify separately requires the current capture's original rows at every checkpoint.
    if (!Object.hasOwn(before.scope_rows, "ledger_entries") && !Object.hasOwn(after.scope_rows, "ledger_entries")) {
      return oldSignature !== null && oldSignature === newSignature;
    }
    const oldRows = ledgerSnapshotRows(before), newRows = ledgerSnapshotRows(after);
    const unchanged = oldRows.length === newRows.length && rowsPreserved(oldRows, newRows);
    assert(unchanged === (oldSignature === newSignature), "B33 ledger canonical/raw change disagreement");
    if (unchanged) return true;
    const projection = receipt.persistence?.reading_projection;
    const chapterId = projection?.chapter_id;
    const summaryRef = "chapter_summary:" + chapterId + "@" + projection?.source_revision_ref;
    const oldSummaries = requiredRows(before, "chapter_summaries");
    const summaries = requiredRows(after, "chapter_summaries").filter((row) =>
      row.work_id === identity.workId && row.chapter_id === chapterId && row.status === "ACCEPTED");
    assert(summaries.length === 1 && !oldSummaries.some((row) => row.id === summaries[0].id) &&
      summaries[0].source_ref === sourceTurnId && summaries[0].revision_base === projection.source_revision_ref &&
      nonEmpty(summaries[0].summary_text), "B33 ledger has no same-adoption accepted summary");
    const terminal = adoptionMaintenanceOutcome(appRecords, {
      workId: identity.workId, chapterId, since, until: after.at,
    });
    assert(terminal?.summary.event.endsWith(".done") && terminal.summary.status === "ACCEPTED" &&
      terminal.summary.four_column === true && terminal.ledger.event.endsWith(".done"),
      "B33 ledger changes lack completed background maintenance");
    return ledgerChangesBound({ before, after, workId: identity.workId,
      sources: [{ chapterId, summaryRef, from: terminal.summary.timestamp, to: terminal.ledger.timestamp }] });  } catch { return false; }
}

function prosePersistenceChecks({ before, after, identity, artifact, receipt, sourceTurnId, since, appRecords }) {
  const changes = Object.fromEntries(["drafts", "scenes", "memory_items", "mutations"].map((table) =>
    [table, rowDelta(before, after, table)]));
  const single = (table) => changes[table].added.length === 1 ? changes[table].added[0] : null;
  const draft = single("drafts");
  const scene = single("scenes");
  const memory = single("memory_items");
  const mutation = single("mutations");
  const persistence = receipt.persistence;
  const projection = persistence?.reading_projection;
  const chapterId = artifact.target_chapter_ref?.replace(/^chapter:/u, "");
  const items = artifact.payload?.items;
  const body = Array.isArray(items) && items.length > 0 && items.every((item) => typeof item.body === "string")
    ? items.map((item) => item.body).join("\n\n") : null;
  const otherTables = ["works", "volumes", "characters"];
  const otherChapters = (snapshot) => Object.fromEntries(Object.entries(snapshot.chapters)
    .filter(([id]) => id !== chapterId));
  return {
    prose_effect_append: artifact.payload?.adoption_effect?.mode === "append" &&
      receipt.adoption_effect?.mode === "append",
    prose_projection_bound: Boolean(persistence?.persisted === true && projection &&
      projection.chapter_id === chapterId && draft && scene && draft.scene_id === scene.id &&
      scene.id === projection.scene_id && scene.chapter_id === chapterId && draft.id === projection.draft_id &&
      draft.work_id === identity.workId && draft.status === "ACCEPTED" && body !== null && draft.content === body &&
      projection.source_revision_ref === "draft:" + draft.id + ":" + draft.revision),
    prose_memory_bound: Boolean(memory && mutation && memory.id === persistence?.memory_item_id &&
      persistence.memory_status === "CONFIRMED" && memory.work_id === identity.workId &&
      memory.source_id === mutation.id && memory.source_type === "AUTHOR_CONFIRMED" &&
      memory.type === "DRAFT_CONTEXT" && memory.status === "CONFIRMED" && memory.content === body &&
      Array.isArray(memory.tags) && memory.tags.includes("adopted_artifact") && memory.tags.includes("prose_fragment")),
    prose_mutation_bound: Boolean(mutation && mutation.id === persistence?.mutation_id &&
      persistence.mutation_status === "APPLIED" && projection?.mutation_id === mutation.id &&
      persistence.source_revision_ref === "mutation:" + mutation.id &&
      mutation.actor_ref === "author" && mutation.source_turn_ref === sourceTurnId &&
      mutation.target_scope === "work:" + identity.workId && mutation.target_object_ref === artifact.artifact_id &&
      mutation.proposed_change_ref === artifact.artifact_id && mutation.mutation_type === "adopt_artifact" &&
      mutation.status === "APPLIED" && mutation.authority_scope === "author_confirmed_adoption" &&
      (mutation.requires_adoption === false || mutation.requires_adoption === 0)),
    previous_prose_rows_preserved: ["drafts", "scenes", "mutations"].every((table) =>
      rowsPreserved(changes[table].oldRows, changes[table].newRows)),
    previous_memory_rows_preserved: rowsPreserved(changes.memory_items.oldRows, changes.memory_items.newRows),
    prose_ledger_changes_accounted: proseLedgerScopeBound({ before, after, identity, receipt, sourceTurnId, since, appRecords }),
    non_prose_canon_unchanged: otherTables.every((table) =>
      canonTableSignature(before.authoring_canon, table) !== null &&
      canonTableSignature(before.authoring_canon, table) === canonTableSignature(after.authoring_canon, table)) &&
      isDeepStrictEqual(otherChapters(before.authoring_canon), otherChapters(after.authoring_canon)),
    prose_canon_counts_match: ["drafts", "scenes", "memory_items", "author_action_receipts"].every((table) =>
      after.authoring_canon.tables[table].row_count === before.authoring_canon.tables[table].row_count + 1),
    // 正文记忆来自本次作者确认；后台摘要/账面维护另由真实调用与来源证据核验。
    memory_reference_updates_accounted: Boolean(memory && memory.reference_count === 0 &&
      memory.last_referenced_at === null && rowsPreserved(changes.memory_items.oldRows, changes.memory_items.newRows) &&
      Array.isArray(before.authoring_canon.memory_reference_logs) &&
      Array.isArray(after.authoring_canon.memory_reference_logs) &&
      isDeepStrictEqual(before.authoring_canon.memory_reference_logs, after.authoring_canon.memory_reference_logs)),
  };
}

export function adoptionEvidenceChecks({
  unique, artifact, turnResult, identity, terminal, driverEntry, wire, before, after, appRecords = [],
}) {
  const checks = { adoption_receipt_accepted: false, adoption_log_matches_wire: false };
  if (!unique || !identity || terminal?.kind !== "completed") return checks;
  const artifactId = artifact.artifact_id;
  const action = selectPendingAction(turnResult, { artifactId, actionType: "accept" });
  const sent = actionFrame(wire, { topic: identity.topic, since: terminal.record.at, action });
  const ack = actionAck(wire, sent, { actionStatus: "accepted" });
  const receipt = frameBody(actionResult(wire, {
    topic: identity.topic, since: sent.at, action, actionStatus: "accepted",
  }));
  const adopted = frameBody(actionTurnResult(wire, {
    topic: identity.topic, since: sent.at, parentTurnRef: turnResult.turn_id,
  }));
  const actions = wire.filter((record) => record.direction === "sent" &&
    record.frame?.[2] === identity.topic && record.frame?.[3] === "author_action" &&
    record.at >= terminal.record.at && frameBody(record)?.action?.source_turn_ref === turnResult.turn_id);
  const resolved = adopted?.adoption_state?.resolved;
  checks.adoption_receipt_accepted = receipt?.status === "accepted";
  checks.adoption_log_matches_wire = driverEntry.adoption?.artifact_id === artifactId &&
    sameCounts(driverEntry.adoption?.send, frameBody(sent)) &&
    sameCounts(driverEntry.adoption?.ack, frameBody(ack.reply)) &&
    sameCounts(driverEntry.adoption?.receipt, receipt);
  checks.only_selected_author_action = actions.length === 1 && actions[0] === sent;
  checks.receipt_targets_selected = receipt.artifact_type === artifact.artifact_type &&
    receipt.decision?.candidate_ref === artifactId;
  checks.adoption_delta_only_selected = adopted?.phase === "completed" && adopted.status !== "failed" &&
    adopted.workspace_id === identity.workspaceId &&
    adopted?.work_id === identity.workId && adopted?.session_id === identity.sessionId &&
    Array.isArray(adopted?.adoption_state?.pending) && adopted.adoption_state.pending.length === 0 &&
    Array.isArray(resolved) && resolved.length === 1 && resolved[0].artifact_id === artifactId &&
    resolved[0].artifact_type === artifact.artifact_type && resolved[0].adoption_status === "ACCEPTED" &&
    resolved[0].requires_adoption === false && resolved[0].source_artifact_ref === artifactId &&
    isDeepStrictEqual(resolved[0].payload, artifact.payload) &&
    (artifact.artifact_type !== "prose_fragment" || resolved[0].mutation_ref === receipt.persistence?.mutation_id);
  checks.adoption_checkpoint_order = before?.authoring_canon?.at >= terminal.record.at &&
    before.authoring_canon.at <= driverEntry.adoption?.clicked_at && driverEntry.adoption.clicked_at <= sent.at &&
    after?.authoring_canon?.at >= sent.at;
  Object.assign(checks, persistedAdoptionChecks({
    before, after, identity, turnResult, actionResult: adopted, artifact, receipt, action,
  }));
  if (artifact.artifact_type === "prose_fragment") Object.assign(checks, prosePersistenceChecks({
    before, after, identity, artifact, receipt, sourceTurnId: action.source_turn_ref, since: sent.at, appRecords,
  }));
  return checks;
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


function adoptedSummarySource({ config, wire, scenarioScopes, driverLog, snapshots, appRecords }, sourceRef, chapterId) {
  assert(Array.isArray(wire), "B33 adopted summary has no original wire");
  const sources = wire.filter((row) => row.direction === "received" && row.frame?.[3] === "turn_result" &&
    frameBody(row)?.turn_id === sourceRef);
  assert.equal(sources.length, 1, "B33 adopted summary source TurnResult is not unique");
  const source = frameBody(sources[0]);
  const scopes = scenarioScopes.filter((scope) => source.workspace_id === scope.workspaceId &&
    source.work_id === scope.workId && source.session_id === scope.sessionId &&
    source.agent_run?.run_id === scope.runId && source.agent_run?.parent_turn_ref === scope.turnId &&
    providerTurnMatchesParent(sourceRef, scope.turnId));
  assert.equal(scopes.length, 1, "B33 adopted summary source owner is unknown");
  const identity = scopes[0];
  assert(identity.workId === config.target.work_id && identity.sessionId === config.target.session_id,
    "B33 adopted summary source differs from the frozen work/session");
  const scenarios = config.scenarios.filter((scenario) => scenario.id === "S4");
  const entries = (driverLog.scenarios ?? []).filter((entry) => entry.id === "S4");
  assert(scenarios.length === 1 && entries.length === 1, "B33 adopted summary scenario is not unique");
  const selection = selectB33PendingArtifact(source, {
    wire, identity, scenario: scenarios[0], start: snapshots.start,
  });
  assert(selection.unique && selection.artifact?.artifact_type === "prose_fragment",
    "B33 adopted summary is not the selected prose candidate");
  const before = snapshots["S4-before-adoption"], after = snapshots.S4;
  const checks = adoptionEvidenceChecks({
    ...selection, turnResult: source, identity, driverEntry: entries[0], wire, before, after, appRecords,
  });
  assert(Object.values(checks).every(Boolean),
    "B33 adopted summary adoption evidence failed: " + Object.keys(checks).filter((key) => !checks[key]).join(","));
  const action = selectPendingAction(source, { artifactId: selection.artifact.artifact_id, actionType: "accept" });
  const sent = actionFrame(wire, { topic: identity.topic, since: selection.terminal.record.at, action });
  const receipt = frameBody(actionResult(wire, {
    topic: identity.topic, since: sent.at, action, actionStatus: "accepted",
  }));
  const projection = receipt.persistence?.reading_projection;
  assert(action.source_turn_ref === sourceRef && projection?.chapter_id === chapterId &&
    nonEmpty(projection.source_revision_ref), "B33 adopted summary projection/source mismatch");
  const maintenance = adoptionMaintenanceOutcome(appRecords, {
    workId: identity.workId, chapterId, since: sent.at, until: after.at,
  });
  assert(maintenance, "B33 adopted summary background work has no complete terminal pair");
  return { before, after, since: sent.at, revisionBase: projection.source_revision_ref, maintenance,
    text: selection.artifact.payload.items.map((item) => item.body).join("\n\n").trim() };
}



// Provider 身份取实际调用日志；服务可用模型目录和生命周期未知不冒充调用事实。
function providerEvidence({
  config, ready, driverLog, providerStarts, llmRecords, providerRuns = [], scenarioScopes = [], runtimeFacts = null,
  appRecords = [], snapshots = {}, providerStream = null, wire = [],
}) {
  const pairs = providerCallPairs(llmRecords, providerRuns, scenarioScopes);  const authors = pairs.filter(({ matched }) => matched);
  const independent = pairs.filter(({ matched }) => !matched);
  const observationRequired = providerStream !== null || Boolean(config.preregistration) || independent.length > 0;
  let observation = null;
  let transport = null;
  if (observationRequired) {
    try {
      observation = observedProviderResponses(config, providerStream, llmRecords);
      transport = { bound: true, ...observation.measured };
    } catch (error) { transport = { bound: false, reason: error.message }; }
  }
  const auxiliary = independent.map(({ record }) => summaryAuxiliaryFact(record, {
    config, appRecords, snapshots, observation, wire, scenarioScopes, driverLog, adoptedSummarySource,
  }));
  const checks = {
    provider_identity_matches: ["splash", "strata"].includes(config.provider) && ready.provider === config.provider &&
      driverLog.provider === config.provider && driverLog.model === config.model && driverLog.endpoint === config.endpoint,
    provider_starts_match: providerStarts.length > 0 && providerStarts.every((record) => record.provider === config.provider),
    provider_requests_match: llmRecords.length > 0 && llmRecords.every((record) => {
      const facts = requestFactsFromRecord(record);
      return facts.ok && facts.format === NATIVE_CHAT_WIRE && record.provider === config.provider &&
        record.request?.body?.model === config.model && nonEmpty(record.provider_call_ref) && nonEmpty(record.provider_run_ref) &&
        record.request.url === `${config.endpoint.replace(/\/+$/u, "")}/chat/completions`;
    }),
    provider_call_identities_unique: ["provider_call_ref", "provider_run_ref"].every((field) =>
      new Set(llmRecords.map((record) => record[field])).size === llmRecords.length),
    provider_observation_bound: !observationRequired || Boolean(observation),
    provider_auxiliary_bound: auxiliary.every((fact) => fact.bound) &&
      new Set(auxiliary.map((fact) => JSON.stringify([fact.work_id, fact.chapter_id, fact.source_ref]))).size === auxiliary.length,
    provider_runs_bound: authors.length > 0 && providerRuns.length === authors.length &&
      authors.every(({ row }) => row && row.provider_id === config.provider && row.model === config.model),
    provider_runs_owned: authors.length > 0 && authors.every(({ owned }) => owned),
    provider_runs_terminal: authors.length > 0 &&
      authors.every(({ row }) => row && ["completed", "failed", "cancelled"].includes(row.status)),
    provider_scenarios_completed: scenarioScopes.length > 0 &&
      new Set(scenarioScopes.map((scope) => scope.runId)).size === scenarioScopes.length &&
      scenarioScopes.every((scope) => authors.some(({ row, owned }) =>
        owned && row.agent_run_id === scope.runId && row.status === "completed" &&
        providerOperation(row) !== "transcript_compaction")),
    execution_budget_matches: sameCounts(config.budget, B33_BUDGET) && sameCounts(driverLog.budget, config.budget),
  };
  if (config.provider === "splash") {
    checks.runtime_facts_match = false;
    try {
      assert.equal(config.runtime?.profile, RUNTIME_PROFILE_ID);
      assertRuntimeFacts(runtimeFacts, RUNTIME_PROFILE_ID);
      assert.equal(config.provider, runtimeFacts.provider.selected);
      assert.equal(config.model, runtimeFacts.provider.model);
      assert.equal(config.endpoint, runtimeFacts.provider.endpoint);
      assert.deepEqual(config.runtime.observed, runtimeFacts);
      checks.runtime_facts_match = true;
    } catch { /* 缺失或冲突保持失败，不以准备时声明替代实际 runtime。 */ }
    const profile = getRuntimeProfile(RUNTIME_PROFILE_ID);
    checks.provider_request_settings_match = checks.provider_runs_bound && checks.provider_runs_owned && checks.provider_auxiliary_bound &&
      pairs.every(({ record, row }) => {
        const compaction = row?.purpose === "other" && providerOperation(row) === "transcript_compaction";
        const tokens = compaction ? 8192 : profile.max_tokens;
        return record.request?.body?.reasoning_effort === profile.reasoning_effort && record.request?.body?.max_tokens === tokens;
      });
  }
  return { checks, auxiliary, transport };
}

export function providerEvidenceChecks(input) {
  return providerEvidence(input).checks;
}

export function verify(dir, sliceIdArg) {
  const config = read(dir, CONFIG_FILE);
  const sliceId = sliceIdArg ?? config.slice_id;
  assert.equal(sliceId, SLICE_ID, `verify slice 参数不一致: ${sliceId}`);
  assert.equal(config.slice_id, SLICE_ID, "prepare 配置 slice 不一致");

  const ready = read(dir, "native-driver-ready.json");
  const driverLog = read(dir, "b33-native-driver-log.json");
  const providerStream = readB33ProviderObservation(dir, config);

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
    expectProviders: [config.provider],
  });

  const wire = transport(dir);
  const sentInputs = wire.filter((entry) =>
    entry.direction === "sent" && Array.isArray(entry.frame) && entry.frame[3] === "user_message");
  const checks = {
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

  // 外部服务由作者持有；只读观察未知不代表已卸载，也不替代上面的调用身份核验。
  const before = read(dir, "model-lifecycle-before.json");
  const after = read(dir, "model-lifecycle-after.json");
  checks.external_service_observation_recorded = [before, after].every((record) =>
    record?.at && record.provider === config.provider && record.model === config.model &&
    record.read_only === true && record.lifecycle_action === "none");
  if (config.provider === "splash") checks.runtime_facts_hash_matches =
    shaFile(path.join(dir, "runtime-facts.json")) === config.runtime?.facts_sha256;

  const snapshots = Object.fromEntries(
    ["start", ...config.scenarios.flatMap((scenario) =>
      scenario.adopt ? [scenario.id + "-before-adoption", scenario.id] : [scenario.id]), "final"].map((checkpoint) => [
      checkpoint,
      read(dir, `b33-${checkpoint}.json`),
    ]),
  );

  checks.ledger_rows_captured = Object.values(snapshots).every((snapshot) => {
    try { ledgerSnapshotRows(snapshot); return true; }
    catch { return false; }
  });
  const measured = { scenarios: {}, model: config.model, endpoint: config.endpoint,
    request_settings: requestSettingsFacts(wireCommon.llmRecords) };
  const scenarioScopes = [];
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
          workspaceId: request.topic.startsWith("workspace:") ? request.topic.slice("workspace:".length) : null,
          workId: body.work_id, sessionId: body.session_id, since: message.at,
        };
        if (nonEmpty(identity.workspaceId)) scenarioScopes.push(identity);
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
      const selection = selectB33PendingArtifact(turnResult, { wire, identity, scenario, start: snapshots.start });
      const beforeAdoption = snapshots[scenario.id + "-before-adoption"];
      scenarioChecks.pending_target_unique = selection.unique;
      scenarioChecks.generation_memory_reference_updates_accounted = compareAuthoringCanonSnapshots(
        snapshots[previousCheckpoint].authoring_canon, beforeAdoption.authoring_canon,
      ).checks.memory_reference_updates_accounted;
      Object.assign(scenarioChecks, adoptionEvidenceChecks({
        ...selection, turnResult, identity, terminal, driverEntry, wire, appRecords: wireCommon.appRecords,
        before: beforeAdoption, after: snapshots[scenario.id],
      }));
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
        pending_kinds: pending.map((entry) => entry?.artifact_type ?? entry?.payload?.object_kind ?? null),
        selected_artifact_id: selection.artifact?.artifact_id ?? null,
        selection_reason: selection.reason ?? null,
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

  const providerRuns = scenarioScopes.flatMap((scope) => readProviderRuns(dir, {
    run_id: scope.runId, workspace_id: scope.workspaceId, work_id: scope.workId,
    session_id: scope.sessionId, parent_turn_ref: scope.turnId,
  }));
  const provider = providerEvidence({
    config, ready, driverLog, ...wireCommon, providerRuns, scenarioScopes, snapshots, providerStream,
    runtimeFacts: config.provider === "splash" ? read(dir, "runtime-facts.json") : null,
  });
  Object.assign(checks, provider.checks);
  measured.auxiliary_executions = provider.auxiliary;
  measured.provider_transport = provider.transport;
  measured.provider_executions = providerRuns.map((row) => ({
    provider_run_ref: row.id, provider_call_ref: row.provider_call_ref, run_id: row.agent_run_id,
    provider: row.provider_id, model: row.model, status: row.status, operation: providerOperation(row),
  }));

  // 模型行为证据边界：必须至少有一次真实 provider 调用记录（llm-calls 已由 common 断言）。
  checks.full_matrix = config.full_matrix === true;
  checks.real_provider_calls_present = wireCommon.llmRecords.length >= config.scenarios.length;
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
    provider: config.provider,
    boundary:
      "真实 macOS Tauri 窗口（嵌入真实前端 + 真实 Phoenix 后端）+ AX/CGEvent 外部驱动 + " +
      `真实 provider ${config.provider}（model=${config.model}，外部服务只读观察）+ 原生 WS/应用 HTTP 传输代理 + ` +
      "隔离 test DB 完整内容快照；S1/S2/S3/S6 为讨论或条件性 no-op，固定输入不由驱动追加答案。",
    extra: {
      scenario_order: config.scenarios.map((scenario) => scenario.id),
      full_matrix: config.full_matrix,
      model: config.model,
      endpoint: config.endpoint,
      work_id: config.target.work_id,
      work_title: config.target.work_title,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
      model_lifecycle: { before, after, ownership: "external", loaded_state: "not_inferred" },
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
