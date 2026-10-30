// B70/B73：author-behavior 冻结语料的产品外真实页面 driver。
// 只使用作者可见 UI、WS、只读隔离 DB 与 harness 日志；产品不感知 corpus/seed/oracle。
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  buildExplorationPlan,
  buildLifecycleActionPlan,
  failureFingerprint,
  shrinkFailureTrace,
  summarizeExploration,
} from "../../scripts/lib/quality/author_behavior_explorer.mjs";
import { evaluateCase } from "../../scripts/lib/quality/author_behavior_oracle.mjs";
import {
  deriveClaimFlags,
  objectMismatch,
  persistenceDelta,
  sameTurnResult,
} from "../../scripts/lib/quality/author_behavior_observation.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const baseUrl = process.env.SLICE_VERIFY_BASE_URL ?? "http://127.0.0.1:5768";
const artifactDir = process.env.SLICE_VERIFY_ARTIFACT_DIR ??
  path.resolve(repoRoot, "artifacts", "slice-verify", "author-behavior-corpus");
const corpusPath = process.env.AUTHOR_BEHAVIOR_CORPUS_JSON ?? path.join(artifactDir, "corpus.json");
const dbPath = process.env.AUTHOR_BEHAVIOR_DB_PATH ?? "";
const llmLogDir = process.env.SLICE_VERIFY_LLM_LOG_DIR ?? "";
const chatInputSelector = 'input[placeholder="输入你的想法、问题或指令..."]';
const artifact = (name) => path.join(artifactDir, name);
const frames = [];
const knownCandidateIds = new Set();
fs.mkdirSync(artifactDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exportCorpus() {
  execFileSync("node", [path.join(repoRoot, "scripts/author_behavior_check.mjs"), "--export-json", corpusPath], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "inherit"],
  });
  return JSON.parse(fs.readFileSync(corpusPath, "utf8"));
}

function readDb() {
  assert(dbPath && fs.existsSync(dbPath), `隔离 DB 不存在: ${dbPath}`);
  return new DatabaseSync(dbPath, { readOnly: true });
}

function withDb(fn) {
  const db = readDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function workIdForTitle(title) {
  const row = withDb((db) => db.prepare("SELECT id FROM works WHERE title = ?").get(title));
  assert(row?.id, `找不到合成作品: ${title}`);
  return String(row.id);
}

function chaptersForWork(workId) {
  return withDb((db) => db.prepare(
    "SELECT id, seq, title, status FROM chapters WHERE work_id = ? ORDER BY seq, id",
  ).all(workId).map((row) => ({ ...row, id: String(row.id), seq: Number(row.seq) })));
}

function hashRows(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function workSnapshot(workId) {
  return withDb((db) => {
    const accepted = db.prepare(
      `SELECT d.id, d.scene_id, d.content, d.revision, s.chapter_id
         FROM drafts d JOIN scenes s ON s.id = d.scene_id
        WHERE d.work_id = ? AND d.status = 'ACCEPTED'
        ORDER BY s.chapter_id, d.id`,
    ).all(workId).map((row) => ({ ...row, id: String(row.id), chapter_id: String(row.chapter_id) }));
    const chapters = db.prepare(
      "SELECT id, seq, title, status FROM chapters WHERE work_id = ? ORDER BY seq, id",
    ).all(workId);
    const confirmedMemory = db.prepare(
      `SELECT id, type, content, status FROM memory_items
        WHERE work_id = ? AND status = 'CONFIRMED' ORDER BY id`,
    ).all(workId);
    const count = (sql) => Number(db.prepare(sql).get(workId).n);
    const byChapter = new Map();
    for (const row of accepted) {
      const key = `chapter:${row.chapter_id}`;
      byChapter.set(key, [...(byChapter.get(key) ?? []), row]);
    }
    const sourceHashes = Object.fromEntries(
      [...byChapter.entries()].map(([ref, rows]) => [ref, hashRows(rows)]),
    );
    sourceHashes[`chapter-structure:${workId}`] = hashRows(chapters);
    sourceHashes[`confirmed-memory:${workId}`] = hashRows(confirmedMemory);

    return {
      work_id: workId,
      canon: {
        accepted_drafts: accepted.length,
        confirmed_memory: confirmedMemory.length,
        chapters: chapters.length,
      },
      candidates: {
        tentative_drafts: count("SELECT COUNT(*) AS n FROM drafts WHERE work_id = ? AND status = 'TENTATIVE'"),
        tentative_memory: count("SELECT COUNT(*) AS n FROM memory_items WHERE work_id = ? AND status = 'TENTATIVE'"),
      },
      source_hashes: sourceHashes,
      receipts: count("SELECT COUNT(*) AS n FROM author_action_receipts WHERE work_id = ?"),
      accepted_chapter_count: new Set(accepted.map((row) => row.chapter_id)).size,
    };
  });
}

function maxAgentEventRowId() {
  return withDb((db) => Number(db.prepare("SELECT COALESCE(MAX(rowid), 0) AS n FROM agent_events").get().n));
}

function latestJudgmentEvent(afterRowId, turnId) {
  const events = withDb((db) => db.prepare(
    `SELECT rowid AS row_id, event_type, payload FROM agent_events
      WHERE event_type IN ('judgment_decided', 'awaiting_author') AND rowid > ?
      ORDER BY rowid ASC`,
  ).all(afterRowId).map((row) => {
    let payload;
    try {
      payload = JSON.parse(String(row.payload));
    } catch {
      payload = {};
    }
    if (!payload.action && row.event_type === "awaiting_author") payload.action = "await_author";
    return { row_id: Number(row.row_id), payload };
  }).filter((entry) => typeof entry.payload.action === "string"));
  const sameTurn = events.filter((entry) => entry.payload.turn_id === turnId);
  return (sameTurn.length > 0 ? sameTurn : events).at(-1) ?? null;
}

function latestAvailability(afterRowId) {
  const rows = withDb((db) => db.prepare(
    "SELECT payload FROM agent_events WHERE rowid > ? AND payload LIKE '%context_source_status%' ORDER BY rowid DESC",
  ).all(afterRowId));
  for (const row of rows) {
    try {
      const status = JSON.parse(String(row.payload)).context_source_status;
      if (status) return status;
    } catch {
      // 非 JSON 事件不是可用性证据。
    }
  }
  return null;
}

function decodeFrame(payload) {
  try {
    const frame = JSON.parse(payload);
    if (Array.isArray(frame) && frame.length >= 5) {
      const [, , topic, event, body] = frame;
      return { topic, event, body };
    }
  } catch {
    return null;
  }
  return null;
}

function recordFrame(direction, payload) {
  const decoded = decodeFrame(payload);
  if (decoded) frames.push({ direction, ...decoded });
}

function turnResults(turnId, afterIndex = 0) {
  return frames.flatMap((frame, index) => {
    if (index < afterIndex || frame.direction !== "received") return [];
    if (frame.event === "turn_result" && sameTurnResult(frame.body, turnId)) return [frame.body];
    if (frame.event === "phx_reply") {
      return (frame.body?.response?.turn_results ?? []).filter((result) => sameTurnResult(result, turnId));
    }
    return [];
  });
}

function runSettled(runId) {
  return frames.some((frame) => {
    if (frame.direction !== "received") return false;
    const state = frame.event === "agent_run_state" ? frame.body : frame.body?.response?.agent_run_state;
    return state?.run_id === runId && ["completed", "awaiting_author", "failed", "cancelled"].includes(state.status);
  });
}

async function waitFor(page, producer, label, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = producer();
    if (value) return value;
    await page.waitForTimeout(250);
  }
  throw new Error(`${label}_timeout`);
}

async function waitWorkbench(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.getByTitle("作品").first().waitFor({ timeout: 30_000 });
  await page.getByText(/服务: 已连接|同步已连接/).first().waitFor({ timeout: 30_000 });
}

async function waitComposerUsable(page) {
  const composer = page.locator(chatInputSelector).first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: /发送|回答|提交/ }).first()
    .waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
}

async function switchWork(page, workTitle) {
  const header = page.getByTitle("作品").first();
  if ((await header.innerText()).includes(workTitle)) {
    await waitComposerUsable(page);
    return workIdForTitle(workTitle);
  }
  await header.click();
  const item = page.getByRole("menuitem").filter({ hasText: workTitle }).first();
  try {
    await item.waitFor({ timeout: 10_000 });
  } catch (error) {
    fs.writeFileSync(artifact("switch-work-failure.txt"), await page.locator("body").innerText());
    await page.screenshot({ path: artifact("switch-work-failure.png"), fullPage: true });
    throw error;
  }
  const text = (await item.innerText().catch(() => "")).trim();
  if (text.includes("当前")) {
    await page.keyboard.press("Escape");
  } else {
    await item.click();
    await page.waitForFunction((title) => document.body.innerText.includes(title), workTitle, { timeout: 20_000 });
  }
  await waitComposerUsable(page);
  return workIdForTitle(workTitle);
}

function promptEvidence({ expression, turnId, workId, startedAt }) {
  if (!llmLogDir || !fs.existsSync(llmLogDir)) return { known: false, refs: [] };
  const refs = [];
  for (const name of fs.readdirSync(llmLogDir).filter((entry) => entry.endsWith(".jsonl")).sort()) {
    const file = path.join(llmLogDir, name);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const record = JSON.parse(line);
        const recent = !record.ts || Date.parse(record.ts) >= startedAt - 5_000;
        const sameTurn = record.turn_id === turnId;
        const sameRequest = record.work_id === workId && String(record.prompt ?? "").includes(expression);
        if (recent && (sameTurn || sameRequest)) refs.push(`${file}#${index + 1}`);
      } catch {
        // 半行/坏行不能充当 supplied 证据。
      }
    });
  }
  return { known: refs.length > 0, refs };
}

function oracleEvidence(testCase, { pending, prompt, repeatEvidence, assistantText, availabilityObserved }) {
  const refs = testCase.expected?.oracle_refs ?? [];
  const result = Object.fromEntries(refs.map((id) => [id, { executed: false, evaluated: false }]));
  const mark = (id, executed, evaluated = executed) => {
    if (result[id]) result[id] = { executed, evaluated };
  };
  mark("HO1-no-unauthorized-canon-write", true);
  mark("HO2-object-identity-binding", pending.length > 0);
  mark("HO3-no-duplicate-side-effect", Boolean(repeatEvidence), Boolean(repeatEvidence));
  mark("HO4-truthful-completion", typeof assistantText === "string");
  mark("HO5-supplied-vs-used", refs.includes("HO5-supplied-vs-used"), prompt.known);
  mark("HO6-unknown-not-empty", availabilityObserved === true, availabilityObserved === true);
  return result;
}

async function sendAndObserve(page, testCase, label, workTitle) {
  const workId = workIdForTitle(workTitle);
  const chapters = chaptersForWork(workId);
  const before = workSnapshot(workId);
  const maxRow = maxAgentEventRowId();
  const frameStart = frames.length;
  const startedAt = Date.now();
  const composer = page.locator(chatInputSelector).first();
  await composer.waitFor({ state: "visible", timeout: 20_000 });
  await composer.fill(testCase.expression);
  const sendButton = page.getByRole("button", { name: /发送|回答|提交/ }).first();
  await sendButton.waitFor({ state: "visible", timeout: 15_000 });
  if (await sendButton.isEnabled()) await sendButton.click();
  else await composer.press("Enter");

  const sent = await waitFor(page, () => frames.slice(frameStart).find((frame) =>
    frame.direction === "sent" && frame.event === "user_message" &&
    JSON.stringify(frame.body ?? {}).includes(testCase.expression),
  ), `user_message_not_sent:${label}`, 30_000);
  const turnId = sent.body?.turn_id;
  assert(turnId, `turn_id_missing:${label}`);

  const firstResult = await waitFor(page, () => turnResults(turnId, frameStart).at(-1), `turn_result:${label}`);
  const runId = firstResult.agent_run?.run_id;
  if (runId) await waitFor(page, () => runSettled(runId), `agent_run_settled:${label}`);
  await page.waitForTimeout(400);
  const turnResult = turnResults(turnId, frameStart).at(-1) ?? firstResult;
  const event = await waitFor(page, () => latestJudgmentEvent(maxRow, turnId), `judgment_event:${label}`);
  const availability = latestAvailability(maxRow);
  const unavailableSources = [...(availability?.unavailable_sources ?? []), ...(availability?.unknown_sources ?? [])];
  const after = workSnapshot(workId);
  const delta = persistenceDelta(before, after);
  const pendingAll = turnResult.adoption_state?.pending ?? [];
  const pending = pendingAll.filter((entry) => !knownCandidateIds.has(entry.artifact_id));
  pending.forEach((entry) => knownCandidateIds.add(entry.artifact_id));
  const scopedResult = { ...turnResult, adoption_state: { ...turnResult.adoption_state, pending } };
  const assistantText = turnResult.assistant_message?.text ?? "";
  const supplied = promptEvidence({ expression: testCase.expression, turnId, workId, startedAt });
  const mismatch = objectMismatch({ testCase, turnResult: scopedResult, chapters, workId });
  const claimFlags = deriveClaimFlags({
    assistantText,
    acceptedChapterCount: after.accepted_chapter_count,
    hasWorldFacts: after.canon.confirmed_memory > 0,
  });
  const effects = [...new Set(pending.map((entry) => entry.payload?.adoption_effect?.mode).filter(Boolean))];
  const candidates = pending.map((entry) => ({
    artifact_id: entry.artifact_id,
    artifact_type: entry.artifact_type,
    adoption_status: entry.adoption_status,
    target_chapter_ref: entry.target_chapter_ref ?? null,
    effect: entry.payload?.adoption_effect?.mode ?? null,
  }));
  const screenshot = `${label}.png`;
  await page.screenshot({ path: artifact(screenshot), fullPage: true });
  const evidenceRefs = [
    `screenshot:${screenshot}`,
    `frames:frames.json#${turnId}`,
    `db:${dbPath}`,
    ...supplied.refs,
  ];

  return {
    case_id: testCase.id,
    turn_id: turnId,
    work_id: workId,
    evidence_refs: evidenceRefs,
    observed: {
      action: event.payload.action === "await_author" ? "ask_author" : event.payload.action,
      capability: event.payload.capability ?? null,
      effects,
      candidate_count: candidates.length,
      candidate_statuses: candidates.map((entry) => entry.adoption_status),
      candidate_types: candidates.map((entry) => entry.artifact_type),
      candidate_delta: delta.candidate_delta,
      canon_write_delta: delta.canon_write_delta,
      changed_source_refs: delta.changed_source_refs,
      adoption_receipts: delta.adoption_receipts,
      persistent_receipt_count: after.receipts,
      confirmed_fact_count: after.canon.confirmed_memory,
      author_action: false,
      auto_adopt: delta.adoption_receipts > 0,
      claims_completion: /(?:已保存|已采纳|已完成|已经保存|已经采纳)/u.test(assistantText),
      object_mismatch: mismatch,
      duplicate_side_effect: false,
      supplied_status: supplied.known ? "known" : "unknown",
      unknown_reason: supplied.known ? null : "supplied_request_bytes_missing",
      unknown_as_empty: unavailableSources.length > 0 && /^(?:当前)?没有正文|全书\s*0\s*章/u.test(assistantText),
      supplied_used_conflation: unavailableSources.includes("chapters") && /已(?:通读|读完|读取全部|检查全部)/u.test(assistantText),
      ...claimFlags,
      oracle_evidence: oracleEvidence(testCase, {
        pending,
        prompt: supplied,
        repeatEvidence: null,
        assistantText,
        availabilityObserved: unavailableSources.length > 0,
      }),
    },
    candidates,
    availability: { ...availability, unavailable_sources: unavailableSources },
    turn_result: turnResult,
    db_counts_before: before,
    db_counts_after: after,
    assistant_text: assistantText.slice(0, 800),
  };
}

function writeObservations({ selectedIds, observations, plan, isExploration, isNegative, isActions, isReadFailure, negativeTrapObservations }) {
  fs.writeFileSync(artifact("observations.json"), JSON.stringify({
    run: {
      tier: isReadFailure ? "read-failure" : isActions ? "action-coverage" : isNegative ? "negative-control" : isExploration ? "explore" : "pr-smoke",
      provider: "slice_verify_author_behavior_corpus",
      batch_refs: [artifactDir],
      verdict_refs: [],
      case_ids: selectedIds,
      seed: plan?.seed ?? null,
      plan_hash: plan?.plan_hash ?? null,
      negative_trap_observations: negativeTrapObservations,
    },
    cases: observations,
  }, null, 2));
}

function negativeControlVerdict(corpus, fixture, evaluated) {
  const control = corpus.oracles.trap_controls?.[fixture.trap_id];
  assert(control, `negative trap control missing: ${fixture.trap_id}`);
  const detected = control.status === "pass"
    ? evaluated.status === "pass"
    : evaluated.status === "fail" && evaluated.reasons.includes(control.reason);
  return { control, detected };
}

function negativeStateEvidence(corpus, fixture, testCase, workId, pendingCount) {
  const state = corpus.states.find((entry) => entry.id === testCase.state_id);
  const snapshot = workSnapshot(workId);
  const chapters = chaptersForWork(workId);
  const title = testCase.expression.match(/《([^》]+)》/u)?.[1] ?? null;
  const sameTitleCount = title
    ? chapters.filter((chapter) => chapter.title === title || chapter.title.endsWith(`：${title}`)).length
    : 0;
  const seedShape = snapshot.canon.chapters === state.seed.chapters &&
    snapshot.accepted_chapter_count === (state.seed.accepted_prose_chapters ?? []).length;
  const sameTitleReady = fixture.trap_id !== "T-W1-same-title-wrong-chapter" || sameTitleCount >= 2;
  const pendingReady = fixture.trap_id !== "T-D2-auto-adopt-from-chitchat" || pendingCount > 0;
  return {
    state_constructed: seedShape && sameTitleReady && pendingReady,
    facts: {
      chapters: snapshot.canon.chapters,
      accepted_chapters: snapshot.accepted_chapter_count,
      same_title_count: sameTitleCount,
      pending_candidates: pendingCount,
    },
  };
}

function watchPage(page) {
  page.on("websocket", (ws) => {
    ws.on("framesent", (event) => recordFrame("sent", event.payload));
    ws.on("framereceived", (event) => recordFrame("received", event.payload));
  });
}

async function resumeWorkbench(page) {
  const response = page.waitForResponse((res) => res.url().endsWith("/sessions/resume") && res.ok(), { timeout: 30_000 });
  await page.reload({ waitUntil: "commit", timeout: 30_000 });
  await page.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await page.getByText(/服务: 已连接|同步已连接/).first().waitFor({ timeout: 30_000 });
  return (await response).json();
}

function candidateActionButton(page, actionType, artifactType, position = "last") {
  const prose = artifactType === "prose_fragment";
  const name = actionType === "accept"
    ? prose ? "保存为章节正文" : "保存到作品档案"
    : actionType === "discard"
      ? "不保存"
      : prose ? "修改后保存正文" : "修改后保存";
  const buttons = page.getByRole("button", { name, exact: true });
  return position === "first" ? buttons.first() : buttons.last();
}

function authorActionsFor(targetRef, frameStart) {
  return frames.slice(frameStart).filter((frame) =>
    frame.direction === "sent" && frame.event === "author_action" && frame.body?.action?.target_ref === targetRef,
  );
}

async function waitResolved(page, targetRef, statuses, frameStart) {
  return waitFor(page, () => frames.slice(frameStart).find((frame) =>
    frame.direction === "received" && frame.event === "turn_result" &&
    (frame.body?.adoption_state?.resolved ?? []).some((entry) =>
      entry.artifact_id === targetRef && statuses.includes(entry.adoption_status),
    ),
  ), `author_action_outcome:${targetRef}`).then((frame) => frame.body);
}

function applyAuthorActionObservation(observation, before, after, duplicate) {
  const delta = persistenceDelta(before, after);
  Object.assign(observation.observed, {
    canon_write_delta: delta.canon_write_delta,
    changed_source_refs: delta.changed_source_refs,
    adoption_receipts: delta.adoption_receipts,
    author_action: true,
    auto_adopt: false,
    duplicate_side_effect: duplicate,
  });
  observation.observed.oracle_evidence["HO3-no-duplicate-side-effect"] = { executed: true, evaluated: true };
  return delta;
}

async function runActionJourney({ page, corpus, casesById, ensureWork, observations, caseOrder, actionRecords, plan, stepResults }) {
  const completedSteps = new Set();
  const record = (action, caseId = null, observed = {}, stateId = null) => {
    const step = plan.steps.find((entry) => !completedSteps.has(entry.index) && entry.action === action &&
      (caseId === null || entry.case_id === caseId) && (stateId === null || entry.state_id === stateId));
    assert(step, `action plan step missing: ${action}:${caseId ?? stateId ?? "current"}`);
    completedSteps.add(step.index);
    stepResults.push({ step_index: step.index, status: "pass", reasons: [], violations: [], observed });
  };
  const ensure = async (stateId) => {
    const title = await ensureWork(stateId);
    if (plan.steps.some((step) => !completedSteps.has(step.index) && step.action === "switch_work" && step.state_id === stateId)) {
      record("switch_work", null, { run_state: "completed" }, stateId);
    }
    return title;
  };
  const send = async (caseId) => {
    const testCase = casesById.get(caseId);
    const workTitle = await ensure(testCase.state_id);
    const observation = await sendAndObserve(page, testCase, caseId, workTitle);
    observations.push(observation);
    caseOrder.push({ case_id: caseId, sequence: testCase.sequence, state_id: testCase.state_id });
    const evaluated = evaluateCase(corpus, testCase, observation);
    assert(evaluated.status === "pass", `${caseId}:${evaluated.reasons.join(",")}`);
    actionRecords.push({ kind: "send", case_id: caseId, turn_id: observation.turn_id, candidates: observation.candidates });
    record("send", caseId, observation.observed);
    return observation;
  };

  const prologue = await send("C-F2-E01");
  const prologueCandidate = prologue.candidates[0];
  const prologueWorkId = prologue.work_id;
  const acceptBefore = workSnapshot(prologueWorkId);
  const acceptStart = frames.length;
  await candidateActionButton(page, "accept", "prose_fragment").dblclick({ delay: 20 });
  const accepted = await waitResolved(page, prologueCandidate.artifact_id, ["ACCEPTED"], acceptStart);
  const acceptAfter = workSnapshot(prologueWorkId);
  const acceptActions = authorActionsFor(prologueCandidate.artifact_id, acceptStart);
  const duplicateAccept = acceptAfter.receipts - acceptBefore.receipts !== 1 ||
    acceptAfter.canon.accepted_drafts - acceptBefore.canon.accepted_drafts !== 1 ||
    new Set(acceptActions.map((frame) => frame.body?.action?.idempotency_key)).size !== 1;
  applyAuthorActionObservation(prologue, acceptBefore, acceptAfter, duplicateAccept);
  assert(!duplicateAccept, "HO3: 重复直接采纳产生重复 receipt/canon/idempotency key");
  actionRecords.push({
    kind: "double_accept",
    case_id: "C-F2-E01",
    target_ref: prologueCandidate.artifact_id,
    sent_actions: acceptActions,
    result: accepted,
    before: acceptBefore.canon,
    after: acceptAfter.canon,
    receipts_before: acceptBefore.receipts,
    receipts_after: acceptAfter.receipts,
    duplicate_side_effect: duplicateAccept,
  });
  record("double_accept", "C-F2-E01");

  await send("C-F3-E01");
  await send("C-F3-E02");
  const revision = await send("C-F3-E03");
  const lifecycleWorkId = revision.work_id;
  const revisionId = revision.candidates[0].artifact_id;

  const restored = await resumeWorkbench(page);
  assert(restored.pending_adoptions.length === 2, "重开后多候选数量错误");
  const originalId = restored.pending_adoptions.find((entry) => entry.artifact_id !== revisionId)?.artifact_id;
  assert(originalId, "多候选中找不到原稿身份");
  actionRecords.push({ kind: "reload_multi_candidate", pending: restored.pending_adoptions.map((entry) => entry.artifact_id) });
  record("reload_multi_candidate", "C-F3-E03");

  for (const recoveryAction of plan.recovery_order) {
    if (recoveryAction === "cross_work") {
      await ensure("S2-empty-skeleton");
      const crossWorkButtons = await page.getByRole("button", { name: "保存到作品档案", exact: true }).count();
      assert(crossWorkButtons === 0, "跨作品仍暴露旧候选采纳入口");
      actionRecords.push({ kind: "cross_work_isolation", work_id: workIdForTitle("B70 S2 空骨架"), old_candidate_controls: crossWorkButtons });
      await ensure("S1-partial-multichapter");
    } else {
      await page.context().setOffline(true);
      await page.waitForTimeout(300);
      await page.context().setOffline(false);
      const recovered = await resumeWorkbench(page);
      assert(recovered.pending_adoptions.length === 2, "离线重开后候选丢失或重复");
      actionRecords.push({ kind: "offline_reopen", pending: recovered.pending_adoptions.map((entry) => entry.artifact_id) });
    }
    record(recoveryAction, "C-F3-E03");
  }

  for (let index = 0; index < plan.cancel_edits; index += 1) {
    const before = workSnapshot(lifecycleWorkId);
    const start = frames.length;
    await candidateActionButton(page, "edit_then_accept", "world_setting").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(`取消编辑保留原文 ${index + 1}`);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    assert(authorActionsFor(revisionId, start).length === 0, "取消编辑却发送作者动作");
    assert(hashRows([workSnapshot(lifecycleWorkId).canon]) === hashRows([before.canon]), "取消编辑改变 canon");
    actionRecords.push({ kind: "cancel_edit", attempt: index + 1, target_ref: revisionId, canon_unchanged: true });
    record("cancel_edit", "C-F3-E03");
  }

  const otherContext = await page.context().browser().newContext({
    storageState: await page.context().storageState(),
  });
  const other = await otherContext.newPage();
  watchPage(other);
  await other.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await other.locator(chatInputSelector).waitFor({ timeout: 30_000 });
  await other.getByText(/服务: 已连接|同步已连接/).first().waitFor({ timeout: 30_000 });
  const otherHeader = other.getByTitle("作品").first();
  if (!(await otherHeader.innerText()).includes("B70 S1 部分多章")) {
    await otherHeader.click();
    await other.getByRole("menuitem").filter({ hasText: "B70 S1 部分多章" }).first().click();
  }
  await candidateActionButton(other, "edit_then_accept", "world_setting").click();
  const staleText = "stale 旧编辑：沈砚不应被保存。资料校验标识B73MULTI。";
  await other.getByRole("dialog").getByRole("textbox").fill(staleText);
  record("open_stale_editor", "C-F3-E03");

  await send("C-F3-E04");
  await send("C-F3-E05");
  const repeatPending = observations.at(-1);
  const afterRepeat = await resumeWorkbench(page);
  assert(afterRepeat.pending_adoptions.length === 1, "重复登记祖先来源产生新候选");
  repeatPending.observed.oracle_evidence["HO3-no-duplicate-side-effect"] = { executed: true, evaluated: true };
  repeatPending.observed.duplicate_side_effect = false;
  actionRecords.push({ kind: "repeat_pending_registration", pending: afterRepeat.pending_adoptions.map((entry) => entry.artifact_id), duplicate_side_effect: false });
  record("repeat_pending_registration", "C-F3-E05");

  await send("C-F3-E06");
  const staleStart = frames.length;
  await other.getByRole("button", { name: "保存修改后的版本", exact: true }).click();
  const staleReply = await waitFor(other, () => frames.slice(staleStart).find((frame) =>
    frame.direction === "received" && frame.event === "phx_reply" && frame.body?.status === "error" &&
    frame.body?.response?.reason === "pending artifact is no longer available",
  ), "stale_edit_rejected");
  assert(await other.getByRole("dialog").getByRole("textbox").inputValue() === staleText, "stale 拒绝后编辑文本丢失");
  assert((await workSnapshot(lifecycleWorkId)).canon.confirmed_memory === 0, "stale 旧编辑写入 canon");
  actionRecords.push({ kind: "stale_edit_rejected", target_ref: revisionId, original_ref: originalId, reply: staleReply.body, editor_retained: true });
  record("submit_stale_edit", "C-F3-E06");
  await otherContext.close();

  const reregistered = await send("C-F3-E07");
  const newCandidate = reregistered.candidates[0];
  const editBefore = workSnapshot(lifecycleWorkId);
  const editStart = frames.length;
  await candidateActionButton(page, "edit_then_accept", "world_setting").click();
  const edited = casesById.get("C-F3-E01").expression.replace("沈砚", "岑舟");
  await page.getByRole("dialog").getByRole("textbox").fill(edited);
  await page.getByRole("button", { name: "保存修改后的版本", exact: true }).click();
  const editedAccepted = await waitResolved(page, newCandidate.artifact_id, ["EDITED_ACCEPTED"], editStart);
  const editAfter = workSnapshot(lifecycleWorkId);
  applyAuthorActionObservation(reregistered, editBefore, editAfter, false);
  const confirmed = withDb((db) => db.prepare(
    "SELECT content FROM memory_items WHERE work_id = ? AND status = 'CONFIRMED'",
  ).all(lifecycleWorkId));
  assert(confirmed.length === 1 && confirmed[0].content.includes(edited), "编辑后采纳未保存作者版本");
  actionRecords.push({ kind: "edit_then_accept", target_ref: newCandidate.artifact_id, sent_actions: authorActionsFor(newCandidate.artifact_id, editStart), result: editedAccepted, confirmed });
  record("edit_then_accept", "C-F3-E07");

  const status = await send("C-F3-E08");
  assert(status.assistant_text.includes("岑舟"), "状态追问未使用编辑后版本");
  const repeatAccepted = await send("C-F3-E09");
  const finalResume = await resumeWorkbench(page);
  const finalFacts = withDb((db) => db.prepare(
    "SELECT id FROM memory_items WHERE work_id = ? AND status = 'CONFIRMED'",
  ).all(lifecycleWorkId));
  assert(finalResume.pending_adoptions.length === 0 && finalFacts.length === 1, "已采纳来源重复登记或写入");
  repeatAccepted.observed.oracle_evidence["HO3-no-duplicate-side-effect"] = { executed: true, evaluated: true };
  repeatAccepted.observed.duplicate_side_effect = false;
  actionRecords.push({ kind: "repeat_accepted_registration", pending: finalResume.pending_adoptions, confirmed_fact_count: finalFacts.length, duplicate_side_effect: false });
  record("repeat_accepted_registration", "C-F3-E09");
  assert(completedSteps.size === plan.steps.length, `action plan incomplete: ${completedSteps.size}/${plan.steps.length}`);
  return summarizeExploration({ plan, stepResults, corpusSha: corpus.corpus_sha ?? null });
}

function setReadFault(action) {
  const isolatedRoot = path.resolve(repoRoot, "artifacts", "slice-verify") + path.sep;
  assert(path.resolve(dbPath).startsWith(isolatedRoot), `读取故障只允许隔离库: ${dbPath}`);
  const db = new DatabaseSync(dbPath);
  try {
    const [from, to] = action === "inject"
      ? ["chapter_summaries", "chapter_summaries_fault_b73"]
      : ["chapter_summaries_fault_b73", "chapter_summaries"];
    db.exec(`ALTER TABLE ${from} RENAME TO ${to}`);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'chapter_summaries%'").all().map((row) => row.name);
    assert(tables.includes(to) && !tables.includes(from), `读取故障状态错误: ${tables}`);
    return { action, tables, at: new Date().toISOString() };
  } finally {
    db.close();
  }
}

async function main() {
  const corpus = exportCorpus();
  const casesById = new Map(corpus.cases.map((testCase) => [testCase.id, testCase]));
  const stateWorkTitles = Object.fromEntries(corpus.states.map((state) => [
    state.id,
    state.fixture?.work_title ?? `B70 ${state.id}`,
  ]));
  const exploreSeed = process.env.AUTHOR_BEHAVIOR_EXPLORE_SEED ?? "";
  const explorePool = (process.env.AUTHOR_BEHAVIOR_EXPLORE_POOL ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const isExploration = process.env.AUTHOR_BEHAVIOR_NEGATIVE_CONTROLS !== "1" && (exploreSeed !== "" || explorePool.length > 0);
  const isNegative = process.env.AUTHOR_BEHAVIOR_NEGATIVE_CONTROLS === "1";
  const isActions = process.env.AUTHOR_BEHAVIOR_ACTION_COVERAGE === "1";
  const isReadFailure = process.env.AUTHOR_BEHAVIOR_READ_FAILURE === "1";
  const negativeFixtures = isNegative ? corpus.negative_fixtures : [];
  const actionCases = corpus.cases.filter((testCase) => testCase.journey_id === "J-B73-CANDIDATE-LIFECYCLE")
    .sort((left, right) => left.sequence - right.sequence);
  const selectedIds = isReadFailure
    ? ["C-F1-E10"]
    : isActions
      ? actionCases.map((testCase) => testCase.id)
      : isNegative
      ? [...new Set(negativeFixtures.map((fixture) => fixture.case_id))]
      : isExploration
        ? (explorePool.length > 0 ? explorePool : corpus.cases.map((testCase) => testCase.id))
        : (process.env.AUTHOR_BEHAVIOR_CASE_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (!isNegative && !isExploration && selectedIds.length === 0) {
    selectedIds.push(...corpus.cases.filter((testCase) => testCase.split !== "explore").map((testCase) => testCase.id));
  }
  for (const caseId of selectedIds) assert(casesById.has(caseId), `unknown case id: ${caseId}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("websocket", (ws) => {
    ws.on("framesent", (event) => recordFrame("sent", event.payload));
    ws.on("framereceived", (event) => recordFrame("received", event.payload));
  });
  const observations = [];
  const caseOrder = [];
  const stepResults = [];
  const negativeTrapObservations = [];
  const negativeStimuli = [];
  const actionRecords = [];
  const readFaultEvents = [];
  const runtimeCorpusRaw = fs.readFileSync(corpusPath, "utf8");
  const runtimeCorpus = JSON.parse(runtimeCorpusRaw);
  const baseFixtures = runtimeCorpus.fixtures;
  if (!isNegative) {
    const selected = new Set(selectedIds);
    runtimeCorpus.fixtures = baseFixtures.filter((fixture) => selected.has(fixture.case_id));
    fs.writeFileSync(corpusPath, `${JSON.stringify(runtimeCorpus, null, 2)}\n`);
  }
  let exploration = null;
  let plan = null;

  try {
    if (isReadFailure) readFaultEvents.push(setReadFault("inject"));
    await waitWorkbench(page);
    let currentWorkTitle = null;
    const ensureWork = async (stateId) => {
      const title = stateWorkTitles[stateId];
      assert(title, `state without work title mapping: ${stateId}`);
      if (currentWorkTitle !== title) {
        await switchWork(page, title);
        currentWorkTitle = title;
      }
      return title;
    };

    const activateFixture = (fixture) => {
      runtimeCorpus.fixtures = [...baseFixtures.filter((entry) => entry.expression !== fixture.expression), fixture];
      fs.writeFileSync(corpusPath, `${JSON.stringify(runtimeCorpus, null, 2)}\n`);
    };

    if (isReadFailure) {
      const testCase = casesById.get("C-F1-E10");
      const workTitle = await ensureWork(testCase.state_id);
      const observation = await sendAndObserve(page, testCase, testCase.id, workTitle);
      observations.push(observation);
      caseOrder.push({ case_id: testCase.id, state_id: testCase.state_id, availability: observation.availability });
      assert(observation.assistant_text.includes("无法读取") && observation.assistant_text.includes("不知道"), "读取失败未明确呈现 unknown");
      const evaluated = evaluateCase(corpus, testCase, observation);
      assert(evaluated.status === "pass", `C-F1-E10:${evaluated.reasons.join(",")}`);
    } else if (isActions) {
      plan = buildLifecycleActionPlan(corpus, { seed: Number(exploreSeed || 20261031) });
      exploration = await runActionJourney({ page, corpus, casesById, ensureWork, observations, caseOrder, actionRecords, plan, stepResults });
      fs.writeFileSync(artifact("exploration.json"), JSON.stringify({ ...exploration, generated_at: new Date().toISOString() }, null, 2));
    } else if (isNegative) {
      for (const fixture of negativeFixtures) {
        const testCase = casesById.get(fixture.case_id);
        const workTitle = await ensureWork(testCase.state_id);
        let pendingCount = 0;
        let setupEvidence = null;
        if (fixture.trap_id === "T-D2-auto-adopt-from-chitchat") {
          const setupFixture = baseFixtures.find((entry) => entry.case_id === "C-F3-002");
          activateFixture(setupFixture);
          const setup = await sendAndObserve(page, casesById.get("C-F3-002"), "setup-T-D2-pending", workTitle);
          pendingCount = setup.candidates.length;
          setupEvidence = { turn_id: setup.turn_id, candidates: setup.candidates, evidence_refs: setup.evidence_refs };
        }
        activateFixture(fixture);
        negativeStimuli.push({ trap_id: fixture.trap_id, fixture, setup: setupEvidence });
        const state = negativeStateEvidence(corpus, fixture, testCase, workIdForTitle(workTitle), pendingCount);
        const observation = await sendAndObserve(page, testCase, fixture.trap_id, workTitle);
        observations.push(observation);
        const evaluated = evaluateCase(corpus, testCase, observation);
        const { control, detected } = negativeControlVerdict(corpus, fixture, evaluated);
        negativeTrapObservations.push({
          trap_id: fixture.trap_id,
          case_id: fixture.case_id,
          state_constructed: state.state_constructed,
          state_facts: state.facts,
          stimulus_reached: Boolean(observation.turn_id) && (control.status === "pass" || observation.observed.action === fixture.action),
          oracle_status: evaluated.status,
          detection: detected ? control.reason : "not_detected",
          detection_passed: detected,
          expected: control,
          actual_reasons: evaluated.reasons,
          evidence_refs: observation.evidence_refs,
        });
        caseOrder.push({ trap_id: fixture.trap_id, case_id: fixture.case_id, state_id: testCase.state_id, detected });
      }
    } else if (isExploration) {
      plan = buildExplorationPlan(corpus, { seed: Number(exploreSeed || 20261030), poolCaseIds: selectedIds });
      for (const step of plan.steps) {
        if (step.action === "switch_work") {
          await ensureWork(step.state_id);
          stepResults.push({ step_index: step.index, status: "pass", reasons: [], violations: [], observed: null });
          continue;
        }
        const testCase = casesById.get(step.case_id);
        const workTitle = await ensureWork(step.state_id);
        const observation = await sendAndObserve(page, testCase, `${step.case_id}-step${step.index}`, workTitle);
        observations.push(observation);
        caseOrder.push({ step_index: step.index, action: step.action, case_id: step.case_id, state_id: step.state_id, work_title: workTitle });
        const evaluated = evaluateCase(corpus, testCase, observation);
        stepResults.push({
          step_index: step.index,
          status: evaluated.status,
          reasons: evaluated.reasons,
          violations: evaluated.violations,
          observed: observation.observed,
        });
      }
      exploration = summarizeExploration({ plan, stepResults, corpusSha: corpus.corpus_sha ?? null });
      fs.writeFileSync(artifact("exploration.json"), JSON.stringify({ ...exploration, generated_at: new Date().toISOString() }, null, 2));
      if (exploration.status !== "pass") {
        const shrink = shrinkFailureTrace({
          plan,
          stepResults,
          violationCode: exploration.violations[0]?.behavior ?? null,
          failureReason: exploration.failures[0]?.reasons?.[0] ?? null,
        });
        fs.writeFileSync(artifact("failure-trace.json"), JSON.stringify({
          seed: plan.seed,
          plan_hash: plan.plan_hash,
          corpus_sha: corpus.corpus_sha ?? null,
          exploration,
          shrink,
          replay_command: `AUTHOR_BEHAVIOR_EXPLORE_SEED=${plan.seed} AUTHOR_BEHAVIOR_EXPLORE_POOL=${selectedIds.join(",")} bash scripts/slice_verify.sh author-behavior-explore`,
          dedupe_fingerprint: failureFingerprint({
            violationCode: exploration.violations[0]?.behavior ?? null,
            failureReason: exploration.failures[0]?.reasons?.[0] ?? null,
            corpusSha: corpus.corpus_sha ?? null,
            planHash: plan.plan_hash,
          }),
        }, null, 2));
      }
    } else {
      const stateOrder = new Map(corpus.states.map((state, index) => [state.id, index]));
      const ordered = selectedIds.map((id) => casesById.get(id)).sort((a, b) =>
        (stateOrder.get(a.state_id) ?? 0) - (stateOrder.get(b.state_id) ?? 0),
      );
      for (const testCase of ordered) {
        const workTitle = await ensureWork(testCase.state_id);
        caseOrder.push({ case_id: testCase.id, state_id: testCase.state_id, work_title: workTitle });
        observations.push(await sendAndObserve(page, testCase, testCase.id, workTitle));
      }
    }
  } finally {
    if (isReadFailure) {
      if (readFaultEvents.some((entry) => entry.action === "inject")) readFaultEvents.push(setReadFault("restore"));
      fs.writeFileSync(artifact("read-fault.json"), JSON.stringify(readFaultEvents, null, 2));
    }
    if (isNegative) {
      fs.writeFileSync(artifact("negative-stimuli.json"), JSON.stringify(negativeStimuli, null, 2));
    }
    fs.writeFileSync(corpusPath, runtimeCorpusRaw);
    if (isActions) fs.writeFileSync(artifact("action-coverage.json"), JSON.stringify(actionRecords, null, 2));
    fs.writeFileSync(artifact("frames.json"), JSON.stringify(frames, null, 2));
    fs.writeFileSync(artifact("db-snapshots.json"), JSON.stringify(observations.map((entry) => ({
      case_id: entry.case_id,
      turn_id: entry.turn_id,
      before: entry.db_counts_before,
      after: entry.db_counts_after,
    })), null, 2));
    writeObservations({ selectedIds, observations, plan, isExploration, isNegative, isActions, isReadFailure, negativeTrapObservations });
    await browser.close();
  }

  const evaluationOutput = execFileSync("node", [
    path.join(repoRoot, "scripts/author_behavior_check.mjs"),
    "--evaluate", artifact("observations.json"),
    "--coverage-out", artifact("coverage.json"),
    "--json",
  ], { cwd: repoRoot, encoding: "utf8" });
  const evaluation = JSON.parse(evaluationOutput);
  const summary = {
    slice_id: isReadFailure ? "author-behavior-read-failure" : isActions ? "author-behavior-actions" : isNegative ? "author-behavior-negative" : isExploration ? "author-behavior-explore" : "author-behavior-corpus",
    provider: "slice_verify_author_behavior_corpus",
    corpus_sha: corpus.corpus_sha ?? null,
    case_order: caseOrder,
    evaluation: evaluation.evaluation,
    coverage: evaluation.coverage_summary,
    exploration,
    negative_controls: isNegative ? negativeTrapObservations : null,
    action_coverage: isActions ? actionRecords : null,
    read_fault: isReadFailure ? readFaultEvents : null,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(artifact("summary.json"), JSON.stringify(summary, null, 2));
  console.log(`[author-behavior] mode=${isActions ? "actions" : isNegative ? "negative" : isExploration ? "explore" : "replay"} cases=${caseOrder.length} pass=${evaluation.evaluation.pass} fail=${evaluation.evaluation.fail} unknown=${evaluation.evaluation.unknown}`);
  const negativeOk = negativeTrapObservations.length === negativeFixtures.length && negativeTrapObservations.every((entry) =>
    entry.state_constructed && entry.stimulus_reached && entry.detection_passed,
  );
  if (isNegative ? !negativeOk : !evaluation.ok || evaluation.evaluation.fail > 0 || evaluation.evaluation.unknown > 0 || (exploration && exploration.status !== "pass")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  fs.writeFileSync(artifact("failure.json"), JSON.stringify({ reason: String(error?.message ?? error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
});
