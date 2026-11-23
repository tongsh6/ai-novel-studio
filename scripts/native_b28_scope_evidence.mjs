#!/usr/bin/env node
// B28-SCOPE：只消费冻结原话、真实运行/请求/候选/作者动作及只读快照。
// 机械边界与语义审读分别报告；任何自然回复词面都不是语义 PASS。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { fileURLToPath } from "node:url";
import {
  all, assertAllChecks, assertCommonEvidence, assertProviderAndWire, broadcastFrames,
  checkProductionFingerprint, frameBody, frameOf, productionFingerprint, productionTableCounts,
  read, requestIdentity, requestReplies, rewrite, sentUserMessages, shaFile, withDb, write, writeNativeSummary,
} from "./lib/native_ui/scenario_evidence.mjs";
import { RUNTIME_PROFILE_ID, assertRuntimeFacts, getRuntimeProfile } from "./lib/native_ui/request_cost_runtime_recipe.mjs";
import { readBatchAuthoringHistory } from "./lib/native_ui/authoring_history_evidence.mjs";
import { bindNativeCalls } from "./lib/native_ui/authoring_run_evidence.mjs";
import {
  canonicalRequestBindingsForProviderCall, providerOperation, readProviderRuns,
} from "./lib/native_ui/authoring_call_evidence.mjs";
import {
  NATIVE_CHAT_WIRE, plannedExplorationLeaves, proseObservationBodyReason, requestFactsFromRecord,
} from "./lib/native_ui/authoring_request_facts.mjs";
import { planningCanonSnapshot } from "./lib/native_ui/authoring_capture_evidence.mjs";
import { CANON_TABLES, compareAuthoringCanonSnapshots } from "./lib/native_ui/authoring_canon_evidence.mjs";
import { recordResponseToolCalls, wireTerminal } from "./lib/native_ui/live_run_wait.mjs";
import {
  actionAck, actionFrame, actionLabelsFor, actionResult, canonTableSignature, selectPendingAction, writerArtifactMatch,
} from "./lib/native_ui/authoring_pending_evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SLICE_ID = "b28-scope-authorization";
export const CONFIG_FILE = "native-b28-scope-config.json";
export const SCENARIOS = Object.freeze([
  { id: "P3", kind: "literal_replace", input: "把第03章里的「二十五岁」改成「三十岁」，其余逐字不变。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "target_segments", effect: "replace_segments", adopt: true }, db: "literal_replace" },
  { id: "N1", kind: "negated_whole_local", input: "不要整章重写，只改第03章第一段。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "target_segments", effect: "replace_segments", adopt: true }, db: "first_segment_only" },
  { id: "N2", kind: "read_then_local", input: "通读全文后只修第03章第二段。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "target_segments", effect: "replace_segments", adopt: true }, db: "second_segment_only" },
  { id: "N3", kind: "readonly_deny", input: "整章检查一遍第03章，有问题告诉我，别改。",
    expect: { action: "none", zero_write: true, adopt: false }, db: "zero_write" },
  // 原句未证明“明显问题”成立或不成立，也未登记候选采纳动作。
  { id: "N4", kind: "conditional_whole", input: "如果第03章有明显问题就整章改一遍，没有问题就告诉我。",
    expect: { conditional: true, capability: "revise_adopted_content", scope: "whole_chapter", effect: "replace_scope", adopt: false }, db: "conditional_review" },
  { id: "P1", kind: "whole_rewrite", input: "把第03章整章重写一遍，情节不变。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "whole_chapter", effect: "replace_scope", adopt: true }, db: "whole_chapter" },
  { id: "P2", kind: "format_only", input: "只调整第03章分段和排版，不要改字句。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "format_only", effect: "format_paragraphs", adopt: true }, db: "format_only" },
]);
export const B28_BUDGET = Object.freeze({
  max_author_inputs: 7, max_harness_retries: 0, turn_timeout_ms: 330000, ack_timeout_ms: 60000,
});
const budgetFor = (count) => ({ ...B28_BUDGET, max_author_inputs: count });
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const list = (value) => Array.isArray(value) ? value : [];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const tryValue = (reader) => { try { return reader(); } catch { return null; } };
const completeChecks = (checks) => checks && Object.keys(checks).length > 0 && Object.values(checks).every((v) => v === true);

function seedField(dir, name) {
  const token = fs.readFileSync(path.join(dir, "seed.log"), "utf8").split(/\s+/).find((part) => part.startsWith(name + "="));
  return token ? token.slice(name.length + 1) : null;
}

export async function prepare(dir, { env = process.env } = {}) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE_ID);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  const profileId = env.REQUEST_COST_RUNTIME_PROFILE ?? RUNTIME_PROFILE_ID;
  const profile = getRuntimeProfile(profileId);
  const observed = read(dir, "runtime-facts.json");
  assertRuntimeFacts(observed, profileId);
  assert.equal(ready.provider, profile.provider, "ready 与本批冻结 runtime provider 不一致");
  const endpoint = observed.provider.endpoint;
  const url = new URL(endpoint);
  assert(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
    "B28 endpoint 必须是无凭证的服务地址");
  const ids = (env.B28S_SCOPE_SCENARIOS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "B28S_SCOPE_SCENARIOS 不得重复");
  assert(ids.every((id) => SCENARIOS.some((scenario) => scenario.id === id)), "B28S_SCOPE_SCENARIOS 含未登记场景");
  const scenarios = ids.length ? SCENARIOS.filter(({ id }) => ids.includes(id)) : SCENARIOS;
  const workId = seedField(dir, "work_id");
  assert(nonBlank(workId), "seed 缺 work_id");
  const work = withDb(dir, (db) => all(db, "SELECT title FROM works WHERE id = ?", [workId]));
  assert.equal(work.length, 1, "隔离作品必须唯一");
  const target = {
    work_id: workId, work_title: work[0].title, session_id: seedField(dir, "session_id"),
    control_chapter_id: seedField(dir, "control_chapter_id"), target_chapter_id: seedField(dir, "target_chapter_id"),
    target_chapter_title: seedField(dir, "target_title"),
  };
  assert(nonBlank(target.control_chapter_id) && nonBlank(target.target_chapter_id), "seed 缺目标/对照章");
  write(dir, "production-sources-before.json", productionFingerprint());
  write(dir, CONFIG_FILE, {
    slice_id: SLICE_ID, provider: observed.provider.selected, model: observed.provider.model, endpoint,
    runtime: { profile: profileId, observed, facts_sha256: shaFile(path.join(dir, "runtime-facts.json")) },
    run_ref: ready.run_ref, ready_at: ready.ready_at, target, budget: budgetFor(scenarios.length),
    requested_by_env: ids, scenarios, full_matrix: scenarios.length === SCENARIOS.length,
    seed_sha256: shaFile(path.join(ROOT, "scripts/seed_b28_scope_authorization.exs")),
    checkpoints: ["start", ...scenarios.flatMap(({ id, expect }) =>
      expect.adopt === true ? [id + "-before-adoption", id] : [id]), "final"],
    semantic_review: "required; N4 condition truth is not mechanically inferred",
  });
}

function dbSnapshot(dir) {
  return withDb(dir, (db) => {
    const chapters = all(db, "SELECT id, seq, title, status FROM chapters ORDER BY seq").map((row) => ({
      chapter_id: String(row.id), seq: Number(row.seq), title: row.title, status: row.status,
    }));
    const accepted = all(db,
      "SELECT d.id AS draft_id, d.content, d.revision, s.id AS scene_id, s.seq AS scene_seq, s.chapter_id " +
      "FROM drafts d JOIN scenes s ON s.id = d.scene_id WHERE d.status = 'ACCEPTED' ORDER BY s.chapter_id, s.seq, d.revision");
    const acceptedDrafts = Object.fromEntries(chapters.map(({ chapter_id }) => [chapter_id,
      accepted.filter((row) => String(row.chapter_id) === chapter_id).map((row) => ({
        draft_id: String(row.draft_id), scene_id: String(row.scene_id), scene_seq: Number(row.scene_seq),
        revision: Number(row.revision), sha256: sha(String(row.content ?? "")),
      }))]));
    const text = Object.fromEntries(chapters.map(({ chapter_id }) => [chapter_id,
      accepted.filter((row) => String(row.chapter_id) === chapter_id).map((row) => row.content ?? "").join("\n\n")]));
    return {
      chapters, accepted_drafts: acceptedDrafts, chapter_text: text,
      chapter_content_sha: Object.fromEntries(Object.entries(text).map(([id, body]) => [id, sha(body)])),
      db_production_counts: productionTableCounts(dir),
      extra_counts: Object.fromEntries(["drafts", "versions", "author_action_receipts", "chapter_summaries"].map((table) =>
        [table, Number(all(db, "SELECT COUNT(*) AS n FROM " + table)[0].n)])),
      scope_rows: Object.fromEntries(["drafts", "mutations", "memory_items", "versions", "chapter_summaries"].map((table) =>
        [table, all(db, "SELECT * FROM " + table + " ORDER BY id")])),
      action_receipts: all(db, "SELECT * FROM author_action_receipts ORDER BY id").map((row) => ({
        ...row, result: typeof row.result === "string" ? JSON.parse(row.result) : row.result,
      })),
    };
  });
}

export function capture(dir, checkpoint) {
  const config = read(dir, CONFIG_FILE);
  assert(config.checkpoints.includes(checkpoint), "未知 checkpoint: " + checkpoint);
  const save = checkpoint.endsWith("-before-adoption") ? write : rewrite;
  save(dir, "b28-" + checkpoint + ".json", {
    at: new Date().toISOString(), checkpoint, ...dbSnapshot(dir),
    authoring_canon: planningCanonSnapshot(dir, { includeChapterFacts: false }),
  });
}

// 身份关联归现 bindNativeCalls；这里只核本批 runtime、原生请求、完整 canonical 请求和覆盖分母。
export function providerEvidenceChecks({
  config, ready, driverLog, providerStarts = [], llmRecords = [], runs = [], runtimeFacts,
}) {
  const joined = runs.map((run) => run.calls);
  const rows = runs.flatMap((run) => list(run.providerRuns));
  const records = runs.flatMap((run) => list(run.calls?.records));
  const profile = tryValue(() => getRuntimeProfile(config.runtime?.profile));
  const checks = {
    provider_identity_matches: Boolean(profile && config.provider === profile.provider && ready.provider === config.provider &&
      driverLog.provider === config.provider && driverLog.model === config.model && driverLog.endpoint === config.endpoint),
    provider_starts_match: providerStarts.length > 0 && providerStarts.every((record) => record.provider === config.provider),
    execution_budget_matches: same(config.budget, budgetFor(list(config.scenarios).length)) && same(driverLog.budget, config.budget),
    native_calls_bound: joined.length === list(config.scenarios).length && joined.length > 0 &&
      joined.every((calls) => completeChecks(calls?.checks)),
    native_calls_real_sse: joined.length > 0 && joined.every((calls) =>
      calls?.measured?.bound_request_count > 0 &&
      calls.measured.sse_decoder_tool_only_count === calls.measured.bound_request_count),
    provider_calls_complete: llmRecords.length > 0 && records.length === llmRecords.length && rows.length === records.length &&
      llmRecords.every((record) => records.filter((bound) => bound === record).length === 1),
    provider_call_identities_unique: llmRecords.length > 0 && ["provider_call_ref", "provider_run_ref"].every((field) =>
      llmRecords.every((record) => nonBlank(record[field])) && new Set(llmRecords.map((record) => record[field])).size === llmRecords.length),
    provider_rows_match: rows.length > 0 && rows.every((row) =>
      row.provider_id === config.provider && row.model === config.model && ["completed", "failed", "cancelled"].includes(row.status)),
    provider_requests_match: llmRecords.length > 0 && llmRecords.every((record) => {
      const facts = requestFactsFromRecord(record);
      return facts.ok && facts.format === NATIVE_CHAT_WIRE && record.provider === config.provider &&
        record.request?.url === config.endpoint.replace(/\/+$/u, "") + "/chat/completions" &&
        record.request.body?.model === config.model;
    }),
    provider_request_settings_match: Boolean(profile && llmRecords.length > 0 && llmRecords.every((record) => {
      const owned = rows.filter((row) => row.id === record.provider_run_ref && row.provider_call_ref === record.provider_call_ref);
      const compaction = owned.length === 1 && owned[0].purpose === "other" && providerOperation(owned[0]) === "transcript_compaction";
      return owned.length === 1 && record.request?.body?.reasoning_effort === profile.reasoning_effort &&
        record.request.body.max_tokens === (compaction ? 8192 : profile.max_tokens);
    })),
    canonical_requests_bound: runs.length > 0 && runs.every(({ history, calls }) =>
      list(calls?.records).length > 0 && calls.records.every((record) => {
        const bindings = canonicalRequestBindingsForProviderCall(record, { messages: history?.sessionMessages });
        return Array.isArray(bindings) && bindings.length > 0;
      })),
    runtime_facts_match: tryValue(() => {
      assertRuntimeFacts(runtimeFacts, config.runtime?.profile);
      return same(runtimeFacts, config.runtime.observed) && runtimeFacts.provider.selected === config.provider &&
        runtimeFacts.provider.model === config.model && runtimeFacts.provider.endpoint === config.endpoint;
    }) === true,
  };
  return checks;
}

function scopeTurn(wire, identity, scenario) {
  const messages = sentUserMessages(wire, scenario.input).filter((message) => frameBody(message)?.turn_id === identity.turnId);
  const sent = messages.length === 1 ? messages[0] : null;
  const request = sent ? tryValue(() => requestIdentity(sent)) : null;
  const replies = request ? requestReplies(wire, request, sent.at) : [];
  const ack = replies.length === 1 ? frameBody(replies[0]) : null;
  const body = sent ? frameBody(sent) : null;
  const requestOk = Boolean(body && request?.topic === identity.topic && body.work_id === identity.workId &&
    body.session_id === identity.sessionId && ack?.status === "ok" &&
    ack.response?.turn_id === identity.turnId && ack.response?.run_id === identity.runId);
  const terminal = wireTerminal(wire, { ...identity, resultPosition: "last", requireWireTerminal: true });
  return { requestOk, terminal, result: terminal?.kind === "completed" ? terminal.body : null };
}

// 当前 run 的 pending refs 才决定新候选；历史候选必须在输入前已有同一原件。
// N4 留待审读的旧候选可同帧保留，不能抢占 P1/P2，也不能掩护未知新候选。
export function scopePendingArtifacts(wire, identity, result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const pending = Object.hasOwn(result, "adoption_state") ? result.adoption_state?.pending : [];
  if (!Array.isArray(pending)) return null;
  const states = wire.filter((record) => record.direction === "received" &&
    frameOf(record)?.[2] === identity.topic && frameOf(record)?.[3] === "agent_run_state" &&
    record.at >= identity.since && frameBody(record)?.run_id === identity.runId &&
    frameBody(record)?.workspace_id === identity.topic.slice("workspace:".length) &&
    frameBody(record)?.work_id === identity.workId && frameBody(record)?.session_id === identity.sessionId &&
    frameBody(record)?.parent_turn_ref === identity.turnId);
  const state = frameBody(states.at(-1));
  if (state?.status !== "completed") return null;
  const refs = state.pending_artifact_refs;
  if (!Array.isArray(refs) || !refs.every(nonBlank) || new Set(refs).size !== refs.length) return null;
  const owned = pending.filter((artifact) => refs.includes(artifact.artifact_id));
  if (owned.length !== refs.length || new Set(owned.map(({ artifact_id }) => artifact_id)).size !== refs.length) return null;
  const historical = wire.filter((record) => record.direction === "received" &&
    frameOf(record)?.[2] === identity.topic && frameOf(record)?.[3] === "turn_result" &&
    record.at < identity.since && frameBody(record)?.work_id === identity.workId &&
    frameBody(record)?.session_id === identity.sessionId).flatMap((record) => list(frameBody(record)?.adoption_state?.pending));
  if (pending.some((artifact) => !refs.includes(artifact.artifact_id) &&
    !historical.some((old) => same(old, artifact)))) return null;
  return owned;
}

function scopeRowsWithoutReferenceStats(rows) {
  if (!rows || typeof rows !== "object" || Array.isArray(rows)) return null;
  if (!Object.hasOwn(rows, "memory_items")) return rows;
  if (!Array.isArray(rows.memory_items)) return null;
  return {
    ...rows,
    memory_items: rows.memory_items.map((row) => Object.fromEntries(Object.entries(row)
      .filter(([key]) => !["reference_count", "last_referenced_at"].includes(key)))),
  };
}

function unchangedCanon(before, after) {
  const compared = tryValue(() => compareAuthoringCanonSnapshots(before?.authoring_canon, after?.authoring_canon));
  // 仅两列引用统计交给既有 canon owner 对日志核算；记忆身份、正文及其余列仍逐字段保留。
  const beforeRows = tryValue(() => scopeRowsWithoutReferenceStats(before?.scope_rows));
  const afterRows = tryValue(() => scopeRowsWithoutReferenceStats(after?.scope_rows));
  return {
    complete_canon_snapshots: Boolean(compared),
    zero_canon_write: compared?.checks.no_canon_write === true,
    memory_reference_updates_accounted: compared?.checks.memory_reference_updates_accounted === true,
    chapter_bytes_unchanged: Boolean(before?.chapter_text && after?.chapter_text && same(before.chapter_text, after.chapter_text)),
    chapter_identity_unchanged: Boolean(before?.chapters && after?.chapters && same(before.chapters, after.chapters)),
    accepted_versions_unchanged: Boolean(before?.accepted_drafts && after?.accepted_drafts && same(before.accepted_drafts, after.accepted_drafts)),
    zero_extra_write: Boolean(before?.extra_counts && after?.extra_counts && same(before.extra_counts, after.extra_counts)),
    auxiliary_rows_unchanged: Boolean(beforeRows && afterRows && same(beforeRows, afterRows)),
  };
}

// 坐标取自真正送到 Writer 的 chapter_read 观察；不另建产品分段算法。
function observedSegments(before, chapterId, bindings) {
  const text = before?.chapter_text?.[chapterId];
  const drafts = before?.accepted_drafts?.[chapterId];
  if (typeof text !== "string" || !Array.isArray(drafts) || !drafts.length || !Array.isArray(bindings)) return null;
  const bytes = Buffer.from(text);
  const chars = Array.from(new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text), (part) => part.segment);
  const versions = Object.fromEntries(drafts.map((row) => ["draft:" + row.draft_id, row.revision]));
  const segments = new Map();
  const pages = [];
  for (const { canonical: message } of bindings) {
    if (message?.role !== "tool") continue;
    for (const parent of list(message.blocks)) {
      if (parent?.type !== "observation") continue;
      const leaves = plannedExplorationLeaves(parent);
      if (leaves && !["ok", "partial"].includes(parent.status)) continue;
      for (const block of leaves ?? [parent]) {
        const content = block?.content;
        const range = block?.coverage?.prose_range;
        if (block.status !== "ok" || content?.tool !== "chapter_read" ||
            block.coverage?.chapter_ref !== "chapter:" + chapterId ||
            !list(block.source_refs).includes("chapter:" + chapterId) || content.source_hash !== sha(text) ||
            !same(block.versions, versions) || block.coverage.prose_total_chars !== chars.length ||
            !Number.isInteger(range?.start) || !Number.isInteger(range?.end) ||
            range.start < 1 || range.end > chars.length || range.start > range.end) continue;
        if (proseObservationBodyReason(block, chars.slice(range.start - 1, range.end).join("")) !== null) continue;
        const pageStart = Buffer.byteLength(chars.slice(0, range.start - 1).join(""));
        const pageEnd = Buffer.byteLength(chars.slice(0, range.end).join(""));
        pages.push([pageStart, pageEnd]);
        for (const segment of list(content.target_segments)) {
          const { segment_id: id, byte_start: start, byte_end: end } = segment;
          if (!nonBlank(id) || !Number.isInteger(start) || !Number.isInteger(end) ||
              start < 0 || end <= start || end > bytes.length || start >= pageEnd || end <= pageStart) return null;
          const tail = bytes.subarray(end).toString("utf8");
          const separator = tail.match(/^(?:(?:\r\n|\n|\r)[ \t]*){2,}/u)?.[0] ?? "";
          const rawEnd = end + Buffer.byteLength(separator);
          const raw = bytes.subarray(start, rawEnd).toString("utf8");
          const value = { id, start, end, rawEnd, raw, separator, sha256: sha(raw) };
          if (segments.has(id) && !same(segments.get(id), value)) return null;
          segments.set(id, value);
        }
      }
    }
  }
  const covers = (start, end) => {
    let cursor = start;
    for (const [from, to] of [...pages].sort((a, b) => a[0] - b[0])) {
      if (from > cursor) break;
      if (to > cursor) cursor = to;
      if (cursor >= end) return true;
    }
    return false;
  };
  return { text, bytes, drafts, versions, segments: [...segments.values()].sort((a, b) => a.start - b.start), covers };
}

// writerArtifactMatch 负责原候选内容和调用身份；这里只补本章范围字段，不另做调用配对。
function writerScopeFieldsMatch(items, record) {
  const originals = recordResponseToolCalls(record).flatMap((entry) => {
    const call = entry.function ?? entry;
    const raw = call.arguments ?? call.raw_arguments;
    const args = typeof raw === "string" ? tryValue(() => JSON.parse(raw)) : raw;
    return list(args?.items);
  });
  return originals.length === items.length && items.every((item) => {
    const matches = originals.filter((original) => original.item_id === item.item_id);
    return matches.length === 1 && ["target_segment_ids", "line_break_changes"].every((field) =>
      same(item[field] ?? null, matches[0][field] ?? null));
  });
}

export function candidateScopeChecks({ artifact, scenario, target, before, history, records }) {
  const payload = artifact?.payload;
  const effect = payload?.adoption_effect;
  const scope = payload?.scope;
  const chapterId = target.target_chapter_id;
  const chapterRef = "chapter:" + chapterId;
  const beforeText = before?.chapter_text?.[chapterId];
  const items = list(payload?.items);
  const writer = writerArtifactMatch({ artifact, records });
  const matches = list(records).filter((record) => record.provider_call_ref === writer.provider_call_ref);
  const bindings = matches.length === 1
    ? canonicalRequestBindingsForProviderCall(matches[0], { messages: history?.sessionMessages }) : null;
  const checks = {
    pending_scope_expected: payload?.modification_scope === scenario.expect.scope,
    candidate_target_matches: artifact?.target_chapter_ref === chapterRef && payload?.target_chapter_ref === chapterRef,
    candidate_effect_expected: effect?.mode === scenario.expect.effect,
    candidate_writer_original_bytes: writer.ok === true,
    candidate_writer_scope_fields: writer.ok === true && matches.length === 1 && writerScopeFieldsMatch(items, matches[0]),
    candidate_writer_request_bound: Array.isArray(bindings) && bindings.length > 0,
  };
  if (scenario.expect.scope === "format_only") {
    const versions = list(before?.accepted_drafts?.[chapterId]).map((row) => ({ ref: "draft:" + row.draft_id, version: row.revision }));
    const covered = versions.map(({ ref, version }) => ref + ":" + version);
    checks.formatting_artifact = artifact?.artifact_type === "prose_formatting_plan";
    checks.formatting_source_hash = typeof beforeText === "string" && payload.base_text === beforeText && effect?.source_hash === sha(beforeText);
    checks.formatting_versions_current = versions.length > 0 && same(effect?.expected_base_versions, versions);
    checks.formatting_scope_complete = scope?.kind === "format_only" && scope?.target_chapter_ref === chapterRef &&
      same(scope?.covered, covered) && same(scope?.covered_refs, covered) &&
      same(effect?.covered, covered) && effect?.coverage === "complete";
    checks.formatting_plan_preserved = items.length === 1 && list(items[0].line_break_changes).length > 0 &&
      same(items[0].line_break_changes, effect?.line_break_changes);
    checks.formatting_preview_hash = typeof payload?.formatting_preview === "string" &&
      effect?.preview_hash === sha(payload.formatting_preview);
    checks.formatting_only_newlines = typeof beforeText === "string" && typeof payload?.formatting_preview === "string" &&
      beforeText.replace(/[\r\n]/gu, "") === payload.formatting_preview.replace(/[\r\n]/gu, "");
    return { checks, expectedText: payload?.formatting_preview ?? null };  }
  const source = observedSegments(before, chapterId, bindings);
  const ids = list(scope?.target_segment_ids);
  const selected = source ? ids.map((id) => source.segments.find((segment) => segment.id === id)) : [];
  const selectionOk = Boolean(source && ids.length > 0 && new Set(ids).size === ids.length &&
    selected.every(Boolean) && selected.every((segment) => source.covers(segment.start, segment.end)));
  const baseVersions = source?.drafts.map((row) => ({ ref: "draft:" + row.draft_id, version: row.revision })) ?? [];
  const covered = baseVersions.map(({ ref, version }) => ref + ":" + version);
  const hashes = selectionOk ? selected.map((segment) => ({ segment_id: segment.id, sha256: segment.sha256 })) : [];
  checks.source_segments_observed = selectionOk;
  checks.scope_chapter_matches = scope?.kind === scenario.expect.scope && scope?.target_chapter_ref === chapterRef;
  checks.base_versions_match = baseVersions.length > 0 &&
    scope?.base_draft_ref === baseVersions[0].ref && scope?.base_version === baseVersions[0].version &&
    same(scope?.covered, covered) && same(scope?.covered_refs, covered) && same(effect?.covered, covered) &&
    same(scope?.expected_segment_hashes, hashes);
  let expectedText = null;
  if (scenario.expect.scope === "whole_chapter") {
    checks.whole_source_complete = Boolean(selectionOk && source.covers(0, source.bytes.length) &&
      same(ids, source.segments.map(({ id }) => id)));
    checks.whole_versions_match = same(effect?.expected_base_versions, baseVersions) && effect?.coverage === "complete";
    checks.whole_items_unmapped = items.length > 0 && items.every((item) =>
      nonBlank(item.body) && !Object.hasOwn(item, "target_segment_ids"));
    if (checks.whole_items_unmapped) expectedText = items.map((item) => item.body).join("\n\n");
  } else {
    checks.target_versions_and_hashes_match = same(scope?.base_versions, baseVersions) &&
      same(effect?.base_versions, baseVersions) && effect?.base_draft_ref === scope?.base_draft_ref &&
      effect?.base_version === scope?.base_version && same(effect?.target_segment_ids, ids) &&
      same(effect?.expected_segment_hashes, hashes);
    const mapped = items.flatMap((item) => list(item.target_segment_ids));
    checks.item_targets_exact = selectionOk && items.length > 0 && items.every((item) =>
      nonBlank(item.body) && list(item.target_segment_ids).length > 0) &&
      mapped.length === ids.length && new Set(mapped).size === ids.length && ids.every((id) => mapped.includes(id));
    const regions = checks.item_targets_exact ? items.map((item) => {
      const region = item.target_segment_ids.map((id) => source.segments.find((segment) => segment.id === id));
      if (region.some((segment) => !segment) || region.some((segment, i) => i && region[i - 1].rawEnd !== segment.start)) return null;
      return { start: region[0].start, end: region.at(-1).rawEnd, text: item.body + region.at(-1).separator };
    }).sort((a, b) => (a?.start ?? 0) - (b?.start ?? 0)) : [];
    checks.target_regions_nonoverlap = regions.length > 0 && regions.every((region, i) =>
      region && (!i || regions[i - 1]?.end <= region.start));
    if (checks.target_regions_nonoverlap) {
      const parts = []; let cursor = 0;
      for (const region of regions) { parts.push(source.bytes.subarray(cursor, region.start), Buffer.from(region.text)); cursor = region.end; }
      parts.push(source.bytes.subarray(cursor));
      expectedText = Buffer.concat(parts).toString("utf8");
    }
    if (scenario.db === "first_segment_only" || scenario.db === "second_segment_only") {
      // 作者说的是自然段：区间内可拆并，授权外的源字节仍须逐字保留。
      const paragraphs = typeof beforeText === "string" ? [...beforeText.matchAll(/[\s\S]+?(?:(?:(?:\r\n|\n|\r)[ \t]*){2,}|$)/gu)] : [];
      const paragraph = paragraphs[scenario.db === "first_segment_only" ? 0 : 1];
      const start = paragraph ? Buffer.byteLength(beforeText.slice(0, paragraph.index)) : -1;
      const end = paragraph ? start + Buffer.byteLength(paragraph[0]) : -1;
      checks.author_named_paragraph_only = Boolean(selectionOk && start >= 0 &&
        selected[0].start === start && selected.at(-1).rawEnd === end &&
        selected.every((segment) => segment.start >= start && segment.rawEnd <= end));
    }
    if (scenario.db === "literal_replace") {
      checks.literal_exact_replace = typeof beforeText === "string" && beforeText.split("二十五岁").length === 2 &&
        expectedText === beforeText.replace("二十五岁", "三十岁");
    }
  }
  return { checks, expectedText };
}

export function adoptionEvidenceChecks(wire, identity, result, artifact, before, after, driverEntry, beforeAdoption) {
  return tryValue(() => {
    assert(beforeAdoption, "采纳缺真实点击前快照，旧批次不得回填");
    for (const snapshot of [before, beforeAdoption, after]) {
      assert(snapshot?.scope_rows && Array.isArray(snapshot.action_receipts), "采纳缺原始行快照");
      for (const table of ["drafts", "mutations", "memory_items", "versions", "chapter_summaries"]) {
        const rows = snapshot.scope_rows[table];
        assert(Array.isArray(rows) && rows.every((row) => nonBlank(row?.id)) &&
          new Set(rows.map((row) => row.id)).size === rows.length, "采纳缺唯一原始行: " + table);
      }
    }
    const readStage = unchangedCanon(before, beforeAdoption);
    const canon = compareAuthoringCanonSnapshots(beforeAdoption.authoring_canon, after.authoring_canon);
    const action = selectPendingAction(result, { artifactId: artifact.artifact_id, actionType: "accept" });
    const send = actionFrame(wire, { topic: identity.topic, since: identity.since, action });
    const ack = actionAck(wire, send, { actionStatus: "accepted" });
    const receiptRecord = actionResult(wire, { topic: identity.topic, since: send.at, action, actionStatus: "accepted" });
    const receipt = frameBody(receiptRecord);
    const oldReceipts = beforeAdoption.action_receipts;
    const newReceipts = after.action_receipts.filter((row) => !oldReceipts.some((old) => old.id === row.id));
    const row = newReceipts.length === 1 ? newReceipts[0] : null;
    const click = driverEntry.adoption;
    const persisted = row?.result;
    const persistence = receipt.persistence;
    const projection = persistence?.reading_projection;
    const beforeRows = beforeAdoption.scope_rows;
    const afterRows = after.scope_rows;
    const added = (name) => afterRows[name].filter((item) => !beforeRows[name].some((old) => old.id === item.id));
    const mutations = added("mutations");
    const mutation = mutations.length === 1 ? mutations[0] : null;
    const drafts = added("drafts");
    const draft = drafts.length === 1 ? drafts[0] : null;
    const memories = added("memory_items");
    const memory = memories.length === 1 ? memories[0] : null;
    const formatOnly = artifact.artifact_type === "prose_formatting_plan";
    const memoryDelta = formatOnly ? 0 : 1;
    const items = list(artifact.payload?.items);
    const memoryBody = items.length > 0 && items.every((item) => typeof item.body === "string")
      ? items.map((item) => item.body).join("\n\n") : null;
    // dbSnapshot 保留 SQLite 原始 JSON 列；只在消费 tags 时解码其既有数组语义。
    const tags = memory ? tryValue(() => JSON.parse(memory.tags)) : null;
    const chapterId = artifact.target_chapter_ref.slice("chapter:".length);
    const bases = list(beforeAdoption.accepted_drafts?.[chapterId]);
    const covered = bases.map((base) => "draft:" + base.draft_id + ":" + base.revision);
    const baseIds = new Set(bases.map((base) => base.draft_id));
    const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
    const previousRowsKept = (name) => beforeRows[name].every((old) =>
      afterRows[name].some((item) => item.id === old.id && same(item, old)));
    // 本批冻结前态均为普通小版本；不把 ORM 插入时的额外递增复制为 magic +3。
    const ordinaryRevision = (revision) => Number.isSafeInteger(revision) && revision > 0 && revision < 2147483647;
    const beforeDraftsPreserved = beforeRows.drafts.every((old) => {
      const matches = afterRows.drafts.filter((item) => item.id === old.id);
      return matches.length === 1 && (baseIds.has(old.id)
        ? old.status === "ACCEPTED" && matches[0].status === "SUPERSEDED" &&
          ordinaryRevision(old.revision) && matches[0].revision === old.revision + 1 &&
          same(without(old, ["status", "revision", "updated_at"]), without(matches[0], ["status", "revision", "updated_at"]))
        : same(old, matches[0]));
    });
    const previousMemoriesKept = previousRowsKept("memory_items") &&
      afterRows.memory_items.length === beforeRows.memory_items.length + memoryDelta;
    const memoryBound = formatOnly
      ? memories.length === 0 && !Object.hasOwn(persistence, "memory_item_id") && !Object.hasOwn(persistence, "memory_status")
      : ["prose_fragment", "scene_draft"].includes(artifact.artifact_type) && Boolean(memory && mutation &&
        memory.id === persistence?.memory_item_id && persistence.memory_status === "CONFIRMED" &&
        memory.work_id === identity.workId && memory.source_id === mutation.id &&
        memory.source_type === "AUTHOR_CONFIRMED" && memory.type === "DRAFT_CONTEXT" && memory.status === "CONFIRMED" &&
        memoryBody !== null && memory.content === memoryBody && Array.isArray(tags) &&
        tags.includes("adopted_artifact") && tags.includes(artifact.artifact_type));
    const memoryStatsMatch = [beforeAdoption, after].every((snapshot) => {
      const rows = snapshot.scope_rows.memory_items;
      const stats = snapshot.authoring_canon.memory_items;
      return snapshot.authoring_canon.tables.memory_items.row_count === rows.length &&
        Object.keys(stats).length === rows.length && rows.every((item) => {
          const stat = stats[item.id];
          return stat?.work_id === item.work_id && stat.reference_count === item.reference_count &&
            stat.last_referenced_at === item.last_referenced_at;
        });
    });
    const signaturesMatch = CANON_TABLES.filter((table) => !["drafts", "memory_items", "author_action_receipts"].includes(table))
      .every((table) => canonTableSignature(beforeAdoption.authoring_canon, table) !== null &&
        canonTableSignature(beforeAdoption.authoring_canon, table) === canonTableSignature(after.authoring_canon, table));
    const resultRecords = wire.filter((record) => record.direction === "received" &&
      frameOf(record)?.[2] === identity.topic && frameOf(record)?.[3] === "turn_result" && same(frameBody(record), result));
    const time = (value) => typeof value === "string" ? Date.parse(value) : NaN;
    return {
      ...Object.fromEntries(Object.entries(readStage).map(([key, value]) => ["before_adoption_" + key, value])),
      complete_adoption_canon_snapshots: Boolean(canon),
      adoption_checkpoint_order: resultRecords.length === 1 &&
        beforeAdoption.checkpoint === driverEntry.id + "-before-adoption" &&
        time(before.at) <= time(beforeAdoption.at) && time(resultRecords[0].at) <= time(beforeAdoption.at) &&
        time(beforeAdoption.at) <= time(beforeAdoption.authoring_canon.at) &&
        time(beforeAdoption.authoring_canon.at) <= time(click?.clicked_at) &&
        time(after.at) >= time(receiptRecord.at) && time(after.authoring_canon.at) >= time(after.at),
      author_action_bound: Boolean(click?.artifact_id === artifact.artifact_id &&
        click.button === actionLabelsFor(artifact, result).accept && nonBlank(click.clicked_at) &&
        click.clicked_at <= send.at && click.clicked_at >= identity.since),
      driver_action_matches_wire: same(click?.send, frameBody(send)) && same(click?.ack, frameBody(ack.reply)) &&
        same(click?.receipt, receipt),
      action_receipt_persisted: Boolean(row && row.work_id === identity.workId && row.session_id === identity.sessionId &&
        row.source_turn_ref === action.source_turn_ref && row.action_id === action.action_id &&
        row.action_type === action.action_type && row.idempotency_key === action.idempotency_key && row.status === "accepted"),
      // ApprovalAudit 的唯一既有覆盖：decision 变为 ACCEPTED；其余广播原结果逐字段保持。
      persisted_result_matches_wire: Boolean(persisted?.decision === "ACCEPTED" && persisted.decided_by === "author" &&
        Object.entries(receipt).filter(([key]) => key !== "decision").every(([key, value]) =>
          Object.hasOwn(persisted, key) && same(persisted[key], value))),
      existing_receipts_preserved: after.action_receipts.length === oldReceipts.length + 1 &&
        oldReceipts.every((old) => after.action_receipts.some((item) => same(item, old))),
      mutation_bound_to_action: Boolean(persistence?.persisted === true && mutation && mutation.id === persistence.mutation_id &&
        mutation.id === projection?.mutation_id && persistence.mutation_status === "APPLIED" &&
        persistence.source_revision_ref === "mutation:" + mutation.id && mutation.status === "APPLIED" &&
        mutation.actor_ref === "author" && mutation.source_turn_ref === action.source_turn_ref &&
        mutation.target_scope === "work:" + identity.workId && mutation.target_object_ref === artifact.artifact_id &&
        mutation.proposed_change_ref === artifact.artifact_id && mutation.mutation_type === "adopt_artifact" &&
        mutation.authority_scope === "author_confirmed_adoption" &&
        (mutation.requires_adoption === false || mutation.requires_adoption === 0) && previousRowsKept("mutations")),
      projection_bound_to_new_draft: Boolean(draft && draft.id === projection?.draft_id &&
        projection.chapter_id === chapterId && projection.scene_id === draft.scene_id && draft.scene_id === bases[0]?.scene_id &&
        draft.work_id === identity.workId && draft.status === "ACCEPTED" &&
        draft.content === after.chapter_text?.[chapterId] &&
        projection.source_revision_ref === "draft:" + draft.id + ":" + draft.revision &&
        ordinaryRevision(draft.revision) && afterRows.drafts.filter((old) => old.id !== draft.id && old.scene_id === draft.scene_id)
          .every((old) => ordinaryRevision(old.revision) && draft.revision > old.revision) &&
        list(after.accepted_drafts?.[chapterId]).length === 1 &&
        after.accepted_drafts[chapterId][0].draft_id === draft.id && after.accepted_drafts[chapterId][0].scene_id === draft.scene_id &&
        after.accepted_drafts[chapterId][0].revision === draft.revision &&
        after.accepted_drafts[chapterId][0].sha256 === sha(draft.content)),
      superseded_drafts_exact: bases.length > 0 && same(projection?.covered_refs, covered) &&
        same(projection?.superseded_draft_refs, covered) && beforeDraftsPreserved,
      receipt_effect_matches: receipt.adoption_effect?.mode === artifact.payload?.adoption_effect?.mode &&
        projection?.adoption_effect === artifact.payload?.adoption_effect?.mode,
      memory_bound_to_action: memoryBound && previousMemoriesKept,
      canon_only_bound_draft_and_receipt: signaturesMatch && memoryBound && previousMemoriesKept && memoryStatsMatch &&
        after.authoring_canon.tables.drafts.row_count === beforeAdoption.authoring_canon.tables.drafts.row_count + 1 &&
        afterRows.drafts.length === beforeRows.drafts.length + 1 &&
        after.authoring_canon.tables.author_action_receipts.row_count === beforeAdoption.authoring_canon.tables.author_action_receipts.row_count + 1,
      auxiliary_rows_unchanged: same(beforeRows.versions, afterRows.versions) &&
        same(beforeRows.chapter_summaries, afterRows.chapter_summaries),
      // 点击采纳不调用模型；新增正文记忆不借用要求前后同 ID 集的 no-write 判据。
      memory_reference_updates_accounted: memoryStatsMatch && previousMemoriesKept &&
        memories.every((item) => item.reference_count === 0 && item.last_referenced_at === null) &&
        same(beforeAdoption.authoring_canon.memory_reference_logs, after.authoring_canon.memory_reference_logs),
    };
  }) ?? { adoption_evidence_complete: false };
}

// verify 与内存反例共用；结果/采纳只从真实 wire 取，不信 driver 的成功/失败标记兜底。
export function scopeEvidenceChecks({
  scenario, target, before, after, beforeAdoption = null, wire, identity, judgment, driverEntry, history = null, records = [],
}) {
  const actual = scopeTurn(wire, identity, scenario);
  const result = actual.result;
  const pending = scopePendingArtifacts(wire, identity, result);
  const question = result?.author_question;
  const otherChapters = (snapshot) => Object.fromEntries(Object.entries(snapshot?.chapter_text ?? {})
    .filter(([id]) => id !== target.target_chapter_id));
  const checks = {
    user_request_and_ack_owned: actual.requestOk,
    completed_business_result_present: actual.terminal?.kind === "completed" && Boolean(result),
    result_not_failed: Boolean(result && result.status !== "failed" && result.status !== "cancelled"),
    no_open_author_question: !question || ["answered", "closed"].includes(question.status),
    no_author_supplement: driverEntry?.questions === 0 && (driverEntry.author_supplements ?? 0) === 0,
    driver_identity_matches: driverEntry?.turn_id === identity.turnId && driverEntry?.run_id === identity.runId &&
      driverEntry.final_kind === "turn_result",
    pending_state_present: Array.isArray(pending),
    control_chapters_unchanged: Boolean(before?.chapter_text && after?.chapter_text &&
      nonBlank(before.chapter_text[target.control_chapter_id]) && same(otherChapters(before), otherChapters(after))),
    chapter_identity_unchanged: Boolean(before?.chapters && after?.chapters && same(before.chapters, after.chapters)),
  };
  const noCandidate = Array.isArray(pending) && pending.length === 0;
  const readonly = scenario.expect.zero_write === true || (scenario.expect.conditional === true && noCandidate);
  if (readonly) {
    Object.assign(checks, unchangedCanon(before, after), {
      no_pending_candidate: noCandidate,
      no_adoption: !driverEntry.adoption && !wire.some((record) => record.direction === "sent" &&
        frameOf(record)?.[2] === identity.topic && frameOf(record)?.[3] === "author_action" &&
        record.at >= identity.since),
      judgment_reply: judgment?.action === "reply",
    });
    return checks;
  }
  checks.judgment_execute = judgment?.action === "execute" && judgment.capability === scenario.expect.capability;
  checks.current_candidate_unique = Array.isArray(pending) && pending.length === 1;
  if (!checks.current_candidate_unique) return checks;
  const artifact = pending[0];
  const candidate = candidateScopeChecks({ artifact, scenario, target, before, history, records });
  Object.assign(checks, candidate.checks);
  if (scenario.expect.adopt !== true) {
    Object.assign(checks, unchangedCanon(before, after), {
      no_unregistered_adoption: !driverEntry.adoption && !wire.some((record) =>
        record.direction === "sent" && frameOf(record)?.[3] === "author_action" &&
        frameBody(record)?.action?.target_ref === artifact.artifact_id),
    });
  } else {
    Object.assign(checks, adoptionEvidenceChecks(wire, identity, result, artifact, before, after, driverEntry, beforeAdoption), {
      exact_candidate_effect_persisted: typeof candidate.expectedText === "string" &&
        after?.chapter_text?.[target.target_chapter_id] === candidate.expectedText,
      target_bytes_changed: before?.chapter_text?.[target.target_chapter_id] !== after?.chapter_text?.[target.target_chapter_id],
      accepted_target_revision_advanced: list(after?.accepted_drafts?.[target.target_chapter_id]).some((row) =>
        list(before?.accepted_drafts?.[target.target_chapter_id]).some((old) =>
          old.scene_id === row.scene_id && row.draft_id !== old.draft_id && row.revision > old.revision)),
    });
  }
  return checks;
}

export function verify(dir, sliceIdArg) {
  const config = read(dir, CONFIG_FILE);
  assert.equal(sliceIdArg ?? config.slice_id, SLICE_ID);
  assert.equal(config.slice_id, SLICE_ID);
  const ready = read(dir, "native-driver-ready.json");
  const driverLog = read(dir, "b28-scope-native-driver-log.json");
  const common = assertCommonEvidence(dir, {
    sliceId: SLICE_ID, minScreenshots: config.scenarios.length + 2,
    minimumWaits: Math.max(8, config.scenarios.length * 3), allowVerificationFailureMarker: true,
  });
  const evidence = assertProviderAndWire(dir, {
    minUserMessages: config.scenarios.length, minTurnResults: config.scenarios.length,
    minProviderStarts: config.scenarios.length, expectProviders: [config.provider],
  });
  const snapshots = Object.fromEntries(config.checkpoints.map((checkpoint) => {
    const file = "b28-" + checkpoint + ".json";
    // 未实际点击时没有此件；采纳检查必须收到 null 并拒绝，不能借输入前或最终状态补齐。
    const missingBefore = checkpoint.endsWith("-before-adoption") && !fs.existsSync(path.join(dir, file));
    return [checkpoint, missingBefore ? null : read(dir, file)];
  }));
  const ownership = read(dir, "model-service-ownership.json");
  const checks = {
    no_browser_frames: !fs.existsSync(path.join(dir, "ui-frames.json")),
    production_sources_unchanged: checkProductionFingerprint(dir).unchanged,
    frozen_seed_matches: config.seed_sha256 === shaFile(path.join(ROOT, "scripts/seed_b28_scope_authorization.exs")),
    runtime_file_unchanged: config.runtime.facts_sha256 === shaFile(path.join(dir, "runtime-facts.json")),
    external_model_not_mutated: ownership.provider === config.provider && ownership.model === config.model &&
      ownership.endpoint === config.endpoint && ownership.ownership === "external" &&
      ownership.lifecycle_action === "none" && ownership.read_only === true,
    author_input_budget_exact: evidence.userMessages.length === config.budget.max_author_inputs,
    driver_scenarios_exact: list(driverLog.scenarios).length === config.scenarios.length &&
      same(driverLog.scenario_order, config.scenarios.map(({ id }) => id)) && driverLog.incomplete === false,
  };
  const measured = { provider: config.provider, model: config.model, endpoint: config.endpoint, scenarios: {} };
  const runs = [];
  for (const [index, scenario] of config.scenarios.entries()) {
    const history = readBatchAuthoringHistory(dir, { wire: evidence.wire, messageText: scenario.input, workId: config.target.work_id });
    const scope = history.transcript.run;
    const calls = bindNativeCalls(dir, scope, history, evidence.llmRecords);
    const providerRuns = readProviderRuns(dir, scope);
    runs.push({ history, calls, providerRuns });
    const sent = sentUserMessages(evidence.wire, scenario.input)[0];
    const next = config.scenarios[index + 1];
    const nextSent = next ? sentUserMessages(evidence.wire, next.input)[0] : null;
    const wire = evidence.wire.filter((record) => !nextSent || record.at < nextSent.at);
    const identity = {
      topic: requestIdentity(sent).topic, turnId: scope.parent_turn_ref, runId: scope.run_id,
      workId: scope.work_id, sessionId: scope.session_id, since: sent.at, runRow: history.record,
    };
    const decisions = broadcastFrames(wire, {
      topic: identity.topic, at: sent.at, runRef: scope.run_id, event: "agent_event",
    }).filter((record) => frameBody(record)?.event_type === "judgment_decided").map((record) => frameBody(record).payload);
    const matches = list(driverLog.scenarios).filter(({ id }) => id === scenario.id);
    assert.equal(matches.length, 1, "driver scenario 必须唯一");
    const before = snapshots[index ? config.scenarios[index - 1].id : "start"];
    const scenarioChecks = scopeEvidenceChecks({
      scenario, target: config.target, before, after: snapshots[scenario.id],
      beforeAdoption: snapshots[scenario.id + "-before-adoption"] ?? null, wire, identity,
      judgment: decisions.at(-1), driverEntry: matches[0], history, records: calls.records,
    });
    Object.assign(checks, Object.fromEntries(Object.entries(scenarioChecks).map(([key, value]) => [scenario.id + "." + key, value])));
    const result = scopeTurn(wire, identity, scenario).result;
    measured.scenarios[scenario.id] = {
      input: scenario.input, turn_id: scope.parent_turn_ref, run_id: scope.run_id,
      judgment: decisions.at(-1) ?? null, final_result: result, provider_calls: calls.measured,
      native_call_failures: calls.failures, checks_failed: Object.keys(scenarioChecks).filter((key) => !scenarioChecks[key]),
      semantic_review: { status: "pending", basis: "frozen input, before snapshot, original result and bound requests",
        conditional_branch: scenario.expect.conditional ? list(scopePendingArtifacts(wire, identity, result)).length ? "candidate" : "reply" : null },
    };
  }
  Object.assign(checks, providerEvidenceChecks({
    config, ready, driverLog, providerStarts: evidence.providerStarts, llmRecords: evidence.llmRecords, runs,
    runtimeFacts: read(dir, "runtime-facts.json"),
  }));
  const last = snapshots[config.scenarios.at(-1).id];
  Object.assign(checks, Object.fromEntries(Object.entries(unchangedCanon(last, snapshots.final)).map(([key, value]) =>
    ["restore." + key, value])));
  checks.full_matrix = config.full_matrix === true;
  const failed = Object.keys(checks).filter((key) => !checks[key]);
  rewrite(dir, "b28-scope-native-checks.json", { slice_id: SLICE_ID, at: new Date().toISOString(), checks, failed, measured, wait_ledger: common.ledger });
  writeNativeSummary(dir, {
    sliceId: SLICE_ID, checks, measured, provider: config.provider,
    boundary: `真实 Tauri + AX/CGEvent + 原 WS/HTTP/Provider/canonical/DB 逐次绑定；${config.scenarios.length}条登记原输入、零自动补答/重试，外部模型生命周期不操作。` +
      "本报告只签机械边界，所有场景语义仍须独立审读；N4 无注册采纳动作，条件真假不由机器推断。",
    extra: { scenario_order: config.scenarios.map(({ id }) => id), full_matrix: config.full_matrix,
      budget: config.budget, runtime: config.runtime, work_id: config.target.work_id,
      run_ref: ready.run_ref, ready_at: ready.ready_at, screenshots: common.ui.screenshots,
      semantic_status: "pending_review" },
  });
  assertAllChecks(checks, "B28-SCOPE 原生机械边界");
  return { checks, measured };
}

export async function main([mode, artifact, checkpoint]) {
  assert(nonBlank(artifact), "usage: native_b28_scope_evidence.mjs <prepare|capture|verify> <dir> [checkpoint|slice-id]");
  const dir = path.resolve(artifact);
  if (mode === "prepare") return prepare(dir);
  if (mode === "capture") return capture(dir, checkpoint);
  if (mode === "verify") return verify(dir, checkpoint);
  throw new Error("未知模式: " + mode);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error); process.exitCode = 1; });
}
