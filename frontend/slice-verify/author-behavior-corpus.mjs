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
      author_action: false,
      auto_adopt: delta.adoption_receipts > 0,
      claims_completion: /(?:已保存|已采纳|已完成|已经保存|已经采纳)/u.test(assistantText),
      object_mismatch: mismatch,
      duplicate_side_effect: false,
      supplied_status: supplied.known ? "known" : "unknown",
      unknown_reason: supplied.known ? null : "supplied_request_bytes_missing",
      ...claimFlags,
      oracle_evidence: oracleEvidence(testCase, {
        pending,
        prompt: supplied,
        repeatEvidence: null,
        assistantText,
        availabilityObserved: false,
      }),
    },
    candidates,
    turn_result: turnResult,
    db_counts_before: before,
    db_counts_after: after,
    assistant_text: assistantText.slice(0, 800),
  };
}

function writeObservations({ selectedIds, observations, plan, isExploration }) {
  fs.writeFileSync(artifact("observations.json"), JSON.stringify({
    run: {
      tier: isExploration ? "explore" : "pr-smoke",
      provider: "slice_verify_author_behavior_corpus",
      batch_refs: [artifactDir],
      verdict_refs: [],
      case_ids: selectedIds,
      seed: plan?.seed ?? null,
      plan_hash: plan?.plan_hash ?? null,
      negative_trap_observations: [],
    },
    cases: observations,
  }, null, 2));
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
  const isExploration = exploreSeed !== "" || explorePool.length > 0;
  const selectedIds = isExploration
    ? (explorePool.length > 0 ? explorePool : corpus.cases.map((testCase) => testCase.id))
    : (process.env.AUTHOR_BEHAVIOR_CASE_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (!isExploration && selectedIds.length === 0) selectedIds.push(...corpus.cases.map((testCase) => testCase.id));
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
  let exploration = null;
  let plan = null;

  try {
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

    if (isExploration) {
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
    fs.writeFileSync(artifact("frames.json"), JSON.stringify(frames, null, 2));
    fs.writeFileSync(artifact("db-snapshots.json"), JSON.stringify(observations.map((entry) => ({
      case_id: entry.case_id,
      turn_id: entry.turn_id,
      before: entry.db_counts_before,
      after: entry.db_counts_after,
    })), null, 2));
    writeObservations({ selectedIds, observations, plan, isExploration });
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
    slice_id: isExploration ? "author-behavior-explore" : "author-behavior-corpus",
    provider: "slice_verify_author_behavior_corpus",
    corpus_sha: corpus.corpus_sha ?? null,
    case_order: caseOrder,
    evaluation: evaluation.evaluation,
    coverage: evaluation.coverage_summary,
    exploration,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(artifact("summary.json"), JSON.stringify(summary, null, 2));
  console.log(`[author-behavior] mode=${isExploration ? "explore" : "replay"} cases=${caseOrder.length} pass=${evaluation.evaluation.pass} fail=${evaluation.evaluation.fail} unknown=${evaluation.evaluation.unknown}`);
  if (!evaluation.ok || evaluation.evaluation.fail > 0 || evaluation.evaluation.unknown > 0 || (exploration && exploration.status !== "pass")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  fs.writeFileSync(artifact("failure.json"), JSON.stringify({ reason: String(error?.message ?? error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
});
