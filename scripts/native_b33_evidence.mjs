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
import { closedSseData } from "./native_provider_stream_proxy.mjs";
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
  actionAck, actionFrame, actionResult, actionTurnResult, canonTableSignature, selectPendingAction,
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
  const jsonFields = { memory_items: ["tags"], interactions: ["content"], author_action_receipts: ["result"],
    ledger_entries: ["payload", "source_refs"] }[table] ?? [];
  return rows.map((row) => {
    const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key, (key === "id" || key.endsWith("_id")) && value instanceof Uint8Array && value.byteLength === 16
        ? uuidFromHex(Buffer.from(value).toString("hex")) : value,
    ]));
    for (const key of jsonFields) if (typeof normalized[key] === "string") normalized[key] = JSON.parse(normalized[key]);
    return normalized;
  });
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

function regularEvidencePath(value, kind) {
  assert(nonEmpty(value) && path.isAbsolute(value), "B33 evidence path must be explicit and absolute");
  const stat = fs.lstatSync(value);
  assert(!stat.isSymbolicLink() && (kind === "directory" ? stat.isDirectory() : stat.isFile()),
    "B33 evidence must remain at its original regular path");
  assert.equal(fs.realpathSync(value), path.resolve(value), "B33 evidence path changed identity");
  return value;
}

function checkedPreregistration(file, dir, { provider, model, scenarios }) {
  regularEvidencePath(file, "file");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(record.provider, provider, "B33 preregistration provider mismatch");
  assert.equal(record.runtime?.provider, provider, "B33 preregistration runtime provider mismatch");
  assert.equal(record.runtime?.model, model, "B33 preregistration model mismatch");
  assert.equal(path.resolve(ROOT, record.artifact_dir ?? ""), path.resolve(dir), "B33 preregistration output mismatch");
  assert(Array.isArray(record.scenarios) && record.scenarios.length === scenarios.length, "B33 preregistration scenarios missing");
  for (const [index, scenario] of scenarios.entries()) {
    const frozen = record.scenarios[index];
    for (const [key, value] of Object.entries(scenario)) assert.deepEqual(frozen[key], value, "B33 frozen scenario mismatch");
    assert.equal(frozen.input_sha256, sha256Hex(scenario.input), "B33 frozen input hash mismatch");
  }
  for (const [key, value] of Object.entries(B33_BUDGET)) assert.equal(record.budget?.[key], value, "B33 frozen budget mismatch");
  assert.equal(record.budget?.max_manual_retries, 0, "B33 manual retries are not authorized");
  const limit = record.budget?.max_upstream_requests;
  assert(Number.isSafeInteger(limit) && limit > 0, "B33 requires a frozen positive HTTP budget");
  assert(nonEmpty(record.proxy_dir), "B33 preregistration proxy_dir missing");
  const proxyDir = regularEvidencePath(path.resolve(ROOT, record.proxy_dir), "directory");
  const readyFile = regularEvidencePath(path.join(proxyDir, "provider-stream-ready.json"), "file");
  const observed = JSON.parse(fs.readFileSync(readyFile, "utf8"));
  assert.equal(observed.mode, "observe", "B33 requires the registered observation proxy");
  assert.equal(observed.max_upstream_requests, limit, "B33 proxy HTTP budget mismatch");
  assert.equal(observed.upstream_endpoint, record.upstream_endpoint, "B33 proxy upstream mismatch");
  assert(Number.isSafeInteger(observed.pid) && observed.pid > 0, "B33 proxy PID missing");
  return { path: file, sha256: shaFile(file), proxy_dir: proxyDir, max_upstream_requests: limit,
    ready_sha256: shaFile(readyFile) };
}

export function readB33ProviderObservation(dir, config) {
  const marker = config.preregistration;
  assert(marker, "B33 frozen preregistration marker missing");
  assert.deepEqual(checkedPreregistration(marker.path, dir, config), marker, "B33 preregistration or observation changed");
  const directory = marker.proxy_dir;
  const eventsFile = regularEvidencePath(path.join(directory, "provider-stream.jsonl"), "file");
  const text = fs.readFileSync(eventsFile, "utf8");
  assert(text.endsWith("\n"), "B33 observation event file is not sealed");
  const rawDir = regularEvidencePath(path.join(directory, "provider-stream-requests"), "directory");
  return {
    directory, ready: read(directory, "provider-stream-ready.json"),
    events: text.trim().split("\n").map((line) => JSON.parse(line)),
    readBytes(name) {
      assert(/^request-[1-9][0-9]*(?:\.(?:received|delivered))?\.bin$/u.test(name), "B33 unsafe original byte filename");
      return fs.readFileSync(regularEvidencePath(path.join(rawDir, name), "file"));
    },
  };
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
    provider: ready.provider, model, scenarios,
  });
  const proxyReady = read(preregistration.proxy_dir, "provider-stream-ready.json");
  assert.equal(proxyReady.endpoint, endpoint, "B33 runtime endpoint differs from frozen observation");

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

function requiredRows(snapshot, table) {
  const rows = table === "action_receipts" ? snapshot?.action_receipts : snapshot?.scope_rows?.[table];
  assert(Array.isArray(rows), "B33 采纳缺真实 " + table + " 行快照");
  assert(rows.every((row) => nonEmpty(row?.id)) && new Set(rows.map((row) => row.id)).size === rows.length,
    "B33 采纳行身份必须唯一: " + table);
  return rows;
}

function rowDelta(before, after, table) {
  const oldRows = requiredRows(before, table);
  const newRows = requiredRows(after, table);
  return { oldRows, newRows, added: newRows.filter((row) => !oldRows.some((old) => old.id === row.id)) };
}

function rowsPreserved(oldRows, newRows) {
  return oldRows.every((old) => newRows.some((row) => row.id === old.id && isDeepStrictEqual(old, row)));
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

function ledgerSnapshotRows(snapshot) {
  const rows = requiredRows(snapshot, "ledger_entries");
  const canon = snapshot.authoring_canon?.tables?.ledger_entries;
  assert(canon?.row_count === rows.length && /^[a-f0-9]{64}$/u.test(canon.rows_sha256) &&
    canon.rows_sha256 === canon.canon_sha256, "B33 ledger rows and canonical capture disagree");
  assert(rows.every((row) => [row.work_id, row.ledger, row.subject_ref].every(nonEmpty)) &&
    new Set(rows.map((row) => JSON.stringify([row.work_id, row.ledger, row.subject_ref]))).size === rows.length,
    "B33 ledger natural identity is missing or duplicated");
  return rows;
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
    const from = Date.parse(terminal.summary.timestamp), to = Date.parse(terminal.ledger.timestamp);
    const mutable = new Set(["subject_kind", "subject_label", "design_ref", "status", "payload",
      "source_refs", "last_event_chapter", "adoption_status", "revision", "updated_at"]);
    const fixed = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !mutable.has(key)));
    assert(oldRows.every((row) => newRows.some((next) => next.id === row.id)), "B33 ledger deleted an existing row");
    for (const row of newRows) {
      const previous = oldRows.find((old) => old.id === row.id);
      if (previous && isDeepStrictEqual(previous, row)) continue;
      assert(row.work_id === identity.workId, "B33 ledger changed another work");
      if (previous) assert(isDeepStrictEqual(fixed(previous), fixed(row)), "B33 ledger replaced a fixed identity");
      const genre = row.ledger === "promise" && row.subject_kind === "promise" && row.subject_ref === "genre";
      assert(genre || ["arc", "conflict", "emotion_curve"].includes(row.ledger), "B33 ledger kind is outside this maintenance");
      if (row.ledger === "emotion_curve") assert(row.subject_kind === "chapter" &&
        row.subject_ref === chapterId && row.last_event_chapter === chapterId, "B33 emotion target differs from the adoption");
      if (genre) assert(row.last_event_chapter === null, "B33 work-level genre is not a chapter event");
      const allowedRef = genre ? "work_profile:" + identity.workId : summaryRef;
      assert(Array.isArray(row.source_refs) && row.source_refs.length > 0 &&
        row.source_refs.every((ref) => nonEmpty(ref) && (ref === allowedRef || previous?.source_refs?.includes(ref))),
        "B33 ledger introduced an unbound source");
      assert(row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) &&
        nonEmpty(row.subject_kind) && nonEmpty(row.subject_label) && nonEmpty(row.status) &&
        row.adoption_status === "ACCEPTED" && Number.isSafeInteger(row.revision) && row.revision >= 1 &&
        (!previous || row.revision > previous.revision), "B33 ledger state is not a completed schema update");
      assert(Date.parse(row.updated_at) >= from && Date.parse(row.updated_at) <= to &&
        (previous || (Date.parse(row.inserted_at) >= from && Date.parse(row.inserted_at) <= Date.parse(row.updated_at))),
        "B33 ledger row is outside the actual maintenance window");
    }
    return true;
  } catch { return false; }
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

const providerBytesSha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function observedProviderResponses(config, stream, records) {
  const marker = config.preregistration;
  assert(marker && stream?.directory === marker.proxy_dir, "B33 observation directory is not frozen");
  const limit = marker.max_upstream_requests;
  assert(Number.isSafeInteger(limit) && limit > 0, "B33 observation budget missing");
  assert(stream.ready?.mode === "observe" && stream.ready.endpoint === config.endpoint &&
    stream.ready.max_upstream_requests === limit, "B33 observation runtime mismatch");
  const events = stream.events;
  assert(Array.isArray(events) && events.every((event, index) => event.sequence === index + 1 &&
    event.max_upstream_requests === limit && event.budget_requests_rejected === 0 &&
    Number.isSafeInteger(event.upstream_requests_admitted) && event.upstream_requests_admitted >= 0 &&
    event.upstream_requests_admitted <= limit),
  "B33 observation sequence or budget mismatch");
  const registrations = events.filter((event) => event.event === "request_registered");
  assert(registrations.length > 0 && registrations.length <= limit, "B33 HTTP budget exceeded");
  assert(new Set(registrations.map((event) => event.request_id)).size === registrations.length,
    "B33 duplicate HTTP request identity");
  const responses = new Map();
  const observed = [];
  const once = (rows, name) => {
    const found = rows.filter((event) => event.event === name);
    assert.equal(found.length, 1, "B33 missing or duplicate " + name);
    return found[0];
  };
  for (const registration of registrations) {
    const id = registration.request_id;
    assert(/^request-[1-9][0-9]*$/u.test(id) && ["POST", "GET"].includes(registration.method), "B33 unknown HTTP request");
    const rows = events.filter((event) => event.request_id === id);
    const forwarded = once(rows, "upstream_request_forwarded");
    const headers = once(rows, "response_headers");
    const ended = once(rows, "upstream_end");
    const closed = once(rows, "transparent_complete");
    assert(rows.filter((event) => ["transparent_complete", "request_closed"].includes(event.event)).length === 1 &&
      forwarded.upstream_admitted === true && forwarded.forwarded === true && closed.response_complete === true &&
      registration.sequence < forwarded.sequence && forwarded.sequence < headers.sequence &&
      headers.sequence < ended.sequence && ended.sequence < closed.sequence, "B33 HTTP request did not close completely");
    const request = stream.readBytes(id + ".bin");
    const received = stream.readBytes(id + ".received.bin");
    const delivered = stream.readBytes(id + ".delivered.bin");
    assert([request, received, delivered].every(Buffer.isBuffer), "B33 original bytes missing");
    assert.equal(providerBytesSha(request), registration.request_sha256, "B33 original request seal mismatch");
    assert(received.equals(delivered) && received.length === closed.received_bytes &&
      delivered.length === closed.delivered_bytes && providerBytesSha(received) === closed.received_sha256 &&
      providerBytesSha(delivered) === closed.delivered_sha256, "B33 original response seal mismatch");
    const status = headers.response_status;
    assert(Number.isInteger(status) && status >= 100 && status <= 599, "B33 response status missing");
    const fact = { request_id: id, method: registration.method, response_status: status,
      requested_at: registration.at, completed_at: closed.at,
      request_sha256: registration.request_sha256, response_sha256: closed.received_sha256 };
    if (registration.method === "POST") {
      assert.equal(registration.path, new URL(config.endpoint).pathname.replace(/\/+$/u, "") + "/chat/completions",
        "B33 unregistered POST operation");
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(request));
      const matching = records.filter((record) => isDeepStrictEqual(record.request?.body, body) &&
        record.request?.method === "POST" && record.request?.url === config.endpoint.replace(/\/+$/u, "") + "/chat/completions");
      assert.equal(matching.length, 1, "B33 raw request does not bind one log record");
      const record = matching[0];
      assert(!responses.has(record) && record.response?.status === status, "B33 response identity/status mismatch");
      Object.assign(fact, { provider_call_ref: record.provider_call_ref, provider_run_ref: record.provider_run_ref });
      let text = "", finish = null, hasTools = false, failed = status < 200 || status >= 300;
      if (!failed) {
        assert(String(headers.content_type).toLowerCase().includes("text/event-stream") &&
          headers.response_encoding === "identity", "B33 successful model response is not raw SSE");
        const data = closedSseData(received);
        assert(data.at(-1) === "[DONE]" && data.filter((value) => value === "[DONE]").length === 1, "B33 SSE terminal missing");
        for (const value of data.slice(0, -1)) {
          const part = JSON.parse(value);
          assert(part && typeof part === "object" && !Array.isArray(part), "B33 SSE object missing");
          if (part.error) {
            assert(finish === null, "B33 SSE error followed a terminal choice");
            failed = true;
            continue;
          }
          assert(Array.isArray(part.choices) && part.choices.length <= 1, "B33 SSE choices missing or ambiguous");
          for (const choice of part.choices) {
            assert(finish === null, "B33 SSE choice followed a terminal choice");
            assert(choice.index === 0 && choice.delta && typeof choice.delta === "object" &&
              !Array.isArray(choice.delta), "B33 ambiguous SSE choice");
            if (choice.delta.content != null) {
              assert.equal(typeof choice.delta.content, "string", "B33 SSE content is not text");
              text += choice.delta.content;
            }
            if (choice.delta.tool_calls != null) {
              assert(Array.isArray(choice.delta.tool_calls), "B33 SSE tool fragments invalid");
              hasTools ||= choice.delta.tool_calls.length > 0;
            }
            if (choice.finish_reason != null) {
              assert(finish === null && nonEmpty(choice.finish_reason), "B33 SSE finish is ambiguous");
              finish = choice.finish_reason;
            }
          }
        }
        assert(failed || finish !== null, "B33 SSE finish missing");
      }
      responses.set(record, { ...fact, text, finish, hasTools, failed });
    }
    observed.push(fact);
  }
  assert.equal(responses.size, records.length, "B33 model call omitted from HTTP evidence");
  const ids = new Set(registrations.map((event) => event.request_id));
  assert(events.every((event) => !event.request_id || ids.has(event.request_id)), "B33 unregistered HTTP event");
  const admitted = events.filter((event) => event.event === "upstream_request_forwarded").length;
  assert.equal(admitted, registrations.length, "B33 HTTP admission denominator mismatch");
  assert.equal(Math.max(...events.map((event) => event.upstream_requests_admitted)), admitted, "B33 HTTP counter mismatch");
  return { responses, measured: { original_directory: stream.directory, http_requests: registrations.length,
    model_POST: responses.size, GET: registrations.length - responses.size, admitted, max_upstream_requests: limit,
    requests: observed } };
}

function acceptedSummarySource(snapshot, workId, chapterId) {
  const chapters = snapshot?.chapters?.filter((row) => row.chapter_id === chapterId) ?? [];
  assert(chapters.length === 1 && chapters[0].work_id === workId, "B33 summary chapter owner missing");
  const drafts = snapshot.scope_rows?.drafts ?? [];
  const scenes = (snapshot.scope_rows?.scenes ?? []).filter((row) => row.chapter_id === chapterId &&
    drafts.some((draft) => draft.scene_id === row.id && draft.status === "ACCEPTED"))
    .sort((left, right) => left.seq - right.seq);
  assert(scenes.length > 0 && scenes.every((row) => Number.isSafeInteger(row.seq)) &&
    new Set(scenes.map((row) => row.seq)).size === scenes.length, "B33 summary source scene order ambiguous");
  const source = scenes.map((scene) => {
    const accepted = drafts.filter((row) => row.scene_id === scene.id && row.status === "ACCEPTED");
    assert(accepted.length === 1 && accepted[0].work_id === workId && typeof accepted[0].content === "string",
      "B33 summary source is not one accepted draft");
    const row = accepted[0];
    return { id: row.id, scene_id: row.scene_id, seq: scene.seq, work_id: row.work_id,
      revision: row.revision, status: row.status, content: row.content };
  });
  return { source, text: source.map((row) => row.content).join("\n").trim() };
}

function renderedSummary(text) {
  const labels = ["情节推进", "人物状态与弧光", "伏笔动作", "情绪基调"];
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  assert.equal(lines.length, labels.length, "B33 summary does not have four complete lines");
  return labels.map((label, index) => {
    const prefix = "【" + label + "】";
    const line = lines[index].trim();
    assert(line.startsWith(prefix) && nonEmpty(line.slice(prefix.length)), "B33 summary line is invalid");
    return prefix + line.slice(prefix.length).trim();
  }).join("\n");
}

export function adoptionMaintenanceOutcome(appRecords, { workId, chapterId, since, until }) {
  const start = Date.parse(since), end = Date.parse(until);
  assert(nonEmpty(workId) && nonEmpty(chapterId) && Number.isFinite(start) && Number.isFinite(end) && end >= start,
    "B33 maintenance window is not bound");
  const owned = appRecords.filter((row) => row.work_id === workId && row.chapter_id === chapterId &&
    Date.parse(row.timestamp) >= start && Date.parse(row.timestamp) <= end);
  const summary = owned.filter((row) =>
    ["chapter_summary_maintenance.run.done", "chapter_summary_maintenance.run.error"].includes(row.event));
  const ledger = owned.filter((row) => ["ledger.update.done", "ledger.update.error"].includes(row.event));
  assert(summary.length <= 1 && ledger.length <= 1, "B33 maintenance terminal is ambiguous");
  if (summary.length === 0 || ledger.length === 0) return null;
  assert(Date.parse(ledger[0].timestamp) >= Date.parse(summary[0].timestamp),
    "B33 ledger terminal precedes the summary terminal");
  const validOutcome = (row) => row.event.endsWith(".done") ? row.outcome === "ok" :
    row.outcome === "error" && nonEmpty(row.reason_code) && nonEmpty(row.outcome_detail);
  assert(validOutcome(summary[0]) && validOutcome(ledger[0]), "B33 maintenance outcome is unknown");
  assert(!summary[0].event.endsWith(".error") || ledger[0].event.endsWith(".error"),
    "B33 degraded summary contradicts the downstream ledger outcome");
  return { summary: summary[0], ledger: ledger[0] };
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

function summaryPriorRowsPreserved(before, after, since, until) {
  const fixed = (row) => Object.fromEntries(Object.entries(row).filter(([key]) =>
    key !== "status" && key !== "updated_at"));
  return before.every((row) => {
    const next = after.find((candidate) => candidate.id === row.id);
    if (!next) return false;
    if (isDeepStrictEqual(next, row)) return true;
    return row.status === "ACCEPTED" && next.status === "SUPERSEDED" &&
      isDeepStrictEqual(fixed(next), fixed(row)) && Date.parse(next.updated_at) >= Date.parse(row.updated_at) &&
      Date.parse(next.updated_at) >= since && Date.parse(next.updated_at) <= until;
  });
}

function summaryStoredResult(row, status, sourceRef, revisionBase, raw, since, until) {
  assert(row.status === status && row.source_ref === sourceRef && row.revision_base === revisionBase &&
    !raw.failed && raw.finish === "stop" && !raw.hasTools, "B33 summary row contradicts its source or provider result");
  assert.equal(row.summary_text, renderedSummary(raw.text), "B33 summary result does not match original response");
  const inserted = Date.parse(row.inserted_at), updated = Date.parse(row.updated_at);
  assert(inserted >= since && updated >= inserted && updated <= until, "B33 summary row is outside the actual call window");
}

function summaryAuxiliaryFact(record, context) {
  const { config, appRecords, snapshots, observation } = context;
  const fact = { provider_call_ref: record.provider_call_ref, provider_run_ref: record.provider_run_ref,
    kind: "unknown", result: "unknown", bound: false };
  try {
    assert(record.step === "chapter_summary" && observation?.responses.has(record), "B33 unknown independent provider operation");
    fact.kind = "chapter_summary";
    const refs = record.request?.refs?.base_refs;
    assert.deepEqual(record.request?.refs?.observation_refs, [], "B33 auxiliary observation refs changed");
    assert.deepEqual(record.request?.refs?.used_refs, [], "B33 auxiliary used refs changed");
    assert(Array.isArray(refs) && refs.length === 2 && new Set(refs).size === 2, "B33 summary source refs missing");
    const chapterRefs = refs.filter((ref) => typeof ref === "string" && ref.startsWith("chapter:"));
    assert.equal(chapterRefs.length, 1, "B33 summary chapter ref ambiguous");
    const chapterId = chapterRefs[0].slice("chapter:".length);
    const sourceRef = refs.find((ref) => ref !== chapterRefs[0]);
    assert(nonEmpty(chapterId) && nonEmpty(sourceRef), "B33 summary operation source missing");
    const workId = config.target?.work_id;
    assert(nonEmpty(workId) && (!Object.hasOwn(record, "work_id") || record.work_id === workId) &&
      (!Object.hasOwn(record, "session_id") || record.session_id === config.target.session_id),
      "B33 independent summary owner mismatch");
    let source;
    if (sourceRef === "summary_repair:" + chapterId) {
      const beforeSource = acceptedSummarySource(snapshots?.start, workId, chapterId);
      const afterSource = acceptedSummarySource(snapshots?.final, workId, chapterId);
      assert.deepEqual(afterSource.source, beforeSource.source, "B33 summary accepted source changed during batch");
      source = { before: snapshots.start, after: snapshots.final, since: snapshots.start.at,
        text: afterSource.text, revisionBase: null };
    } else {
      source = adoptedSummarySource(context, sourceRef, chapterId);
    }
    assert(nonEmpty(source.text), "B33 summary source is empty");
    const material = "【应用数据 · application_base · 非作者原话】\n## 本次材料正文\n已采纳正文：\n" + source.text;
    const messages = record.request.body.messages;
    assert(record.request.body.tools == null || (Array.isArray(record.request.body.tools) &&
      record.request.body.tools.length === 0), "B33 auxiliary request unexpectedly has tools");
    assert(messages.length === 2 && messages[0].role === "system" && messages[1].role === "user" &&
      messages[1].content === material, "B33 summary request is not the actual accepted material");
    const outcomes = source.maintenance ? [source.maintenance.summary] : appRecords.filter((row) =>
      ["chapter_summary_maintenance.run.done", "chapter_summary_maintenance.run.error"].includes(row.event) &&
      row.work_id === workId && row.chapter_id === chapterId);
    assert.equal(outcomes.length, 1, "B33 summary business outcome is missing or ambiguous");
    const result = outcomes[0], raw = observation.responses.get(record);
    const times = [source.since, record.ts, result.timestamp, source.after.at].map(Date.parse);
    assert(times.every(Number.isFinite) && times.every((time, index) => index === 0 || time >= times[index - 1]),
      "B33 summary outcome is outside this actual call and checkpoint window");
    assert(Date.parse(raw.requested_at) >= times[0] && Date.parse(raw.completed_at) >= Date.parse(raw.requested_at) &&
      Date.parse(raw.completed_at) <= times[3], "B33 original auxiliary request is outside the source window");
    const rowsFor = (snapshot) => requiredRows(snapshot, "chapter_summaries")
      .filter((row) => row.chapter_id === chapterId && row.work_id === workId);
    const before = rowsFor(source.before), after = rowsFor(source.after);
    const added = after.filter((row) => !before.some((old) => old.id === row.id));
    assert(added.length <= 1 && summaryPriorRowsPreserved(before, after, times[1], times[2]),
      "B33 summary changed or removed an existing row beyond lawful supersede");
    Object.assign(fact, { source_ref: sourceRef, chapter_id: chapterId, work_id: workId,
      revision_base: source.revisionBase, request_id: raw.request_id, response_status: raw.response_status });
    if (source.maintenance) fact.maintenance = source.maintenance;
    if (result.event.endsWith(".done")) {
      assert(result.outcome === "ok" && result.status === "ACCEPTED" && result.four_column === true &&
        added.length === 1 && after.filter((row) => row.status === "ACCEPTED").length === 1,
        "B33 summary completion is not one new accepted result");
      summaryStoredResult(added[0], "ACCEPTED", sourceRef, source.revisionBase, raw, times[1], times[2]);
      Object.assign(fact, { result: "accepted", summary_id: added[0].id });
    } else {
      assert(result.outcome === "error" && ["generation_failed", "persistence_failed"].includes(result.reason_code) &&
        nonEmpty(result.outcome_detail), "B33 auxiliary failure is unknown");
      if (result.reason_code === "generation_failed") {
        assert.deepEqual(after, before, "B33 generation failure changed summaries");
      } else {
        if (!isDeepStrictEqual(after, before)) {
          assert(!raw.failed && raw.finish === "stop" && !raw.hasTools, "B33 failed generation cannot change summaries");
          renderedSummary(raw.text);
        }
        for (const row of added) summaryStoredResult(row, "TENTATIVE", sourceRef, source.revisionBase, raw, times[1], times[2]);
      }
      Object.assign(fact, { result: raw.failed ? "provider_failed" : "degraded", reason_code: result.reason_code,
        tentative_summary_ids: added.map((row) => row.id) });
    }
    fact.bound = true;
  } catch (error) { fact.reason = error.message; }
  return fact;
}


// Provider 身份取实际调用日志；服务可用模型目录和生命周期未知不冒充调用事实。
function providerEvidence({
  config, ready, driverLog, providerStarts, llmRecords, providerRuns = [], scenarioScopes = [], runtimeFacts = null,
  appRecords = [], snapshots = {}, providerStream = null, wire = [],
}) {
  const pairs = llmRecords.map((record) => {
    const byRun = providerRuns.filter((row) => row.id === record.provider_run_ref);
    const byCall = providerRuns.filter((row) => row.provider_call_ref === record.provider_call_ref);
    const row = byRun.length === 1 && byCall.length === 1 && byRun[0] === byCall[0] ? byRun[0] : null;
    const scopes = row ? scenarioScopes.filter((scope) =>
      scope.runId === row.agent_run_id && scope.turnId === row.parent_turn_ref) : [];
    const scope = scopes.length === 1 ? scopes[0] : null;
    const owned = Boolean(scope && [scope.workspaceId, scope.workId, scope.sessionId].every(nonEmpty) &&
      row.workspace_id === scope.workspaceId && row.work_id === scope.workId && row.session_id === scope.sessionId &&
      record.work_id === row.work_id && record.session_id === row.session_id &&
      (!Object.hasOwn(record, "workspace_id") || record.workspace_id === row.workspace_id) &&
      providerTurnMatchesParent(record.turn_id, scope.turnId));
    return { record, row, owned, matched: byRun.length > 0 || byCall.length > 0 };
  });
  const authors = pairs.filter(({ matched }) => matched);
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
    config, appRecords, snapshots, observation, wire, scenarioScopes, driverLog,
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
