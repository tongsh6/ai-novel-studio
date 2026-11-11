// B71 原生批次的核验采集/落盘适配：只从已采集证据读取结构化事实，再交给纯判据。
//
// 本模块不判断场景是否通过；它负责把真实帧/日志/AX/DB 读数归一为纯函数输入，
// 并把最终 checks/measured/summary 按既有命名写入批次目录。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertAllChecks,
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  axText,
  behaviorAssertions,
  broadcastFrames,
  checkProductionFingerprint,
  evidenceBoundary,
  frameBody,
  frameEvent,
  frameOf,
  read,
  turnFacts,
  withDb,
  write,
  writeNativeFrames,
  writeNativeSummary,
} from "./scenario_evidence.mjs";
import { authoringScope, readAuthoringHistory } from "./authoring_history_evidence.mjs";
import { joinNativeCallEvidence, readProviderRuns } from "./authoring_call_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import {
  g2CandidateEvidence,
  g2PageEvidence,
  g2PageUsageEvidence,
  parseChapterLabel,
} from "./authoring_g2_evidence.mjs";

export function readCheckpoint(dir, checkpoint) {
  return read(dir, `b71-${checkpoint}.json`);
}

export function fingerprintUnchanged(dir) {
  return checkProductionFingerprint(dir).unchanged;
}

export function bindNativeCalls(dir, scope, history, records) {
  return joinNativeCallEvidence({
    scope,
    transcript: history.transcript,
    providerRuns: readProviderRuns(dir, scope),
    records,
    consumedProviderCalls: history.budget?.provider_calls,
  });
}

export function authoringInput(userMessages, spec) {
  const sent = userMessages.find(
    (record) => String(frameBody(record)?.text || "") === spec.message,
  );
  assert(sent, spec.missingInput);
  return sent;
}

function ackResponse(ack) {
  const body = frameBody(ack);
  return body !== null && typeof body === "object" ? body.response : null;
}

export function ackRunId(ack, spec) {
  const response = ackResponse(ack);
  const runId = response !== null && typeof response === "object"
    ? String(response.run_id || "")
    : "";
  assert(runId, spec.missingAck);
  return runId;
}

function agentRunOf(body) {
  return body !== null && typeof body === "object" ? body.agent_run : null;
}

export function completedForRun(body, runId) {
  const run = agentRunOf(body);
  return run !== null && typeof run === "object" &&
    run.run_id === runId && run.status === "completed";
}

export function firstCompletedTurn(results, runId, message) {
  const completed = results.find((body) => completedForRun(body, runId));
  assert(completed, message);
  return completed;
}

export function lastCompletedTurn(results, runId, message) {
  const completed = results.filter((body) => completedForRun(body, runId)).at(-1);
  assert(completed, message);
  return completed;
}

const COMPLETED_TURN = Object.freeze({
  first: (results, runId, message) => firstCompletedTurn(results, runId, message),
  last: (results, runId, message) => lastCompletedTurn(results, runId, message),
});

function wireFacts(wire) {
  return wire.map((entry) => ({
    event: frameEvent(entry),
    body: frameBody(entry),
    direction: entry.direction,
    status: entry.status,
    path: entry.path,
    at: entry.at,
  }));
}

function collectBatchEvidence(dir, spec) {
  return {
    common: assertCommonEvidence(dir, spec.common),
    evidence: assertProviderAndWire(dir, spec.wire),
  };
}

export function authoringRunFacts(dir, evidence, spec) {
  const sent = authoringInput(evidence.userMessages, spec);
  const facts = turnFacts(evidence.wire, sent);
  const runId = ackRunId(facts.ack, spec);
  const topic = frameOf(sent)[2];
  // turn_result 是 broadcast：join_ref/request_ref 为 null，按同 topic/方向/实际
  // agent_run.run_id 绑定；allResults 仍保留同 topic 的原始广播视图。
  const results = broadcastFrames(evidence.wire, {
    topic,
    at: sent.at,
    event: "turn_result",
    agentRunId: runId,
  }).map(frameBody);
  const allResults = facts.results.map(frameBody);
  const completed = COMPLETED_TURN[spec.completedTurn](
    results,
    runId,
    spec.missingCompleted,
  );
  const workId = readConfig(dir).target.work_id;
  const scope = {
    ...authoringScope(evidence.wire, sent, { workId, parentTurnId: facts.turnId }),
    run_id: runId,
    topic,
  };
  const history = readAuthoringHistory(dir, scope, { requireMode: spec.requireRunMode });
  const calls = bindNativeCalls(dir, scope, history, evidence.llmRecords);
  return {
    sent,
    facts,
    allResults,
    results,
    completed,
    history,
    calls,
    runId,
    workId,
    scope,
    ackBody: frameBody(facts.ack),
    wire: wireFacts(evidence.wire),
  };
}

export function collectAuthoringRun(dir, spec) {
  const { common, evidence } = collectBatchEvidence(dir, spec);
  return { common, evidence, ...authoringRunFacts(dir, evidence, spec) };
}

export function authoringVisibleText(dir, name) {
  return axText(dir, name);
}

function explorationResult(events) {
  return {
    events,
    count: events.length,
    // 事件已由同一 body 的 event_type 过滤，body 必然存在；只保留 payload 可选。
    queries: events.map((record) => frameBody(record).payload?.query),
  };
}

export function explorationFacts(wire, scope) {
  assert(typeof scope === "object" && scope !== null, "探索证据缺 owning scope");
  const { topic, runId } = scope;
  assert(typeof topic === "string" && topic !== "", "探索证据缺 owning topic");
  assert(typeof runId === "string" && runId !== "", "探索证据缺 owning run");
  // 探索是 agent_event 广播：join_ref/request_ref 为 null，只按 owning topic +
  // 接收方向 + 实际 run_ref 归属；同 parent 的其它 run 不得贡献计数或 queries。
  // broadcastFrames 的 runRef 过滤已保证 body 是带 run_ref 的对象。
  const events = broadcastFrames(wire, { topic, runRef: runId, event: "agent_event" }).filter(
    (record) => frameBody(record).event_type === "exploration_observed",
  );
  return explorationResult(events);
}

export function verificationExtra({ checks, common, turnId, turnIds, behavior }) {
  return {
    turn_id: turnId,
    turn_ids: turnIds,
    behavior: {
      assertions: behaviorAssertions(checks),
      ...behavior,
    },
    evidence_boundary: evidenceBoundary(),
    wait_ledger: common.ledger,
    screenshots: common.ui.screenshots,
  };
}

export function finishVerification(
  dir,
  { checks, measured, sliceId, label, successPrefix = null, extra },
) {
  assertAllChecks(checks, label);
  writeNativeFrames(dir);
  write(dir, "native-b71-checks.json", { checks, failed: [], measured });
  writeNativeSummary(dir, { sliceId, checks, measured, extra });
  if (successPrefix) {
    console.log(`${successPrefix}: ${Object.keys(checks).length}/${Object.keys(checks).length}`);
  }
  return { checks, measured };
}


// B82 §7 G2 页证据的只读输入边界：目标章只由冻结作者可见章序+章名定位（复用
// parseChapterLabel），不再依赖 seed.log；DB title 允许去编号名或完整可见名。
// 唯一 ACCEPTED 稿与冻结阅读摘录必须同属该章，歧义/缺摘录直接拒绝；started 只取
// 同一 AgentRun 的实际发生顺序。
export function readG2PageInputs(dir, { workId, runId, target } = {}) {
  assert(typeof workId === "string" && workId !== "", "G2 页证据缺少 work_id");
  assert(typeof runId === "string" && runId !== "", "G2 页证据缺少 run_id");
  assert(
    target !== null && typeof target === "object" && !Array.isArray(target),
    "G2 页证据缺少冻结作者可见目标",
  );
  const chapter = parseChapterLabel(target.chapter_title);
  assert(chapter, "G2 页证据: 冻结可见章名必须包含完整章序与章名");
  const order = Number(chapter.order);
  assert(Number.isInteger(order) && order > 0, "G2 页证据: 冻结可见章序必须是正整数");
  assert(
    typeof target.reading_excerpt === "string" && target.reading_excerpt !== "",
    "G2 页证据: 冻结阅读摘录不能为空",
  );
  return withDb(dir, (db) => {
    const drafts = all(
      db,
      "SELECT c.id AS chapter_id, d.id AS draft_id, d.revision, d.content " +
        "FROM drafts d " +
        "JOIN scenes s ON s.id = d.scene_id AND s.work_id = d.work_id " +
        "JOIN chapters c ON c.id = s.chapter_id AND c.work_id = d.work_id " +
        "WHERE d.work_id = ? AND c.seq = ? AND c.title IN (?, ?) " +
        "AND d.status = 'ACCEPTED'",
      [workId, order, chapter.name, target.chapter_title.trim()],
    );
    assert.equal(drafts.length, 1, "G2 页证据: 目标章 ACCEPTED draft 必须唯一");
    const draft = drafts[0];
    const prose = String(draft.content ?? "");
    assert(
      prose.includes(target.reading_excerpt),
      "G2 页证据: 冻结阅读摘录不属于目标章已保存正文",
    );
    const starts = all(
      db,
      "SELECT provider_run_id, provider_call_ref, emitted_at FROM provider_events " +
        "WHERE agent_run_id = ? AND event_type = 'started' ORDER BY emitted_at",
      [runId],
    );
    return {
      chapter_ref: `chapter:${draft.chapter_id}`,
      draft_ref: `draft:${draft.draft_id}`,
      revision: Number(draft.revision),
      prose,
      starts,
    };
  });
}

// ── B82 §7 G2 报告：复用同一条已绑定 run 的 canonical transcript 与已对账 records ──
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";

// B82 §7 G2：只有冻结的 b82-g2 把页证据并入 live 报告；页证据只保留 refs/range/reason，
// 正文不写入 checks/summary；两页成立也只签页级版本/紧邻请求，不代签 G2 整体。
export function g2PageReport({ dir, config, history, records }) {
  assert.equal(config.scenario_id, "b82-g2", "G2 页证据只属于冻结的 b82-g2");
  assert(Array.isArray(records), "b82-g2 页证据需要已对账的 nativeCalls.records");
  const input = readG2PageInputs(dir, {
    workId: history.record.work_id,
    runId: history.record.id,
    target: config.author_visible_target,
  });
  const evidence = g2PageEvidence({
    transcript: history.transcript,
    records,
    starts: input.starts,
    chapterRef: input.chapter_ref,
    draftRef: input.draft_ref,
    revision: input.revision,
    prose: input.prose,
  });
  return {
    scenario_id: config.scenario_id,
    chapter_ref: input.chapter_ref,
    draft_ref: input.draft_ref,
    revision: input.revision,
    started_count: input.starts.length,
    ok: evidence.ok,
    pages: evidence.pages,
    signed_scope: "pages_only",
    g2_signed: false,
    not_signed: ["page_level_usage", "final"],
  };
}

// 实际 B28 scope3 候选：复用同一条已绑定 run 的 turnFacts/pending 与已对账 records。
// 可见文本缺失按缺证返回（不在这里抛），让报告先落盘、再由入口统一失败。
function visibleTextIfExists(dir, name) {
  const file = path.join(dir, `${name}.text.txt`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export function g2CandidateReport({ dir, config, history, records, chapterRef }) {
  assert.equal(config.scenario_id, "b82-g2", "G2 候选证据只属于冻结的 b82-g2");
  assert(Array.isArray(records), "b82-g2 候选证据需要已对账的 nativeCalls.records");
  // 同一快照只读一次：章 ref 直接消费页证据的结果，不再第二次 readG2PageInputs。
  assert(nonBlank(chapterRef), "b82-g2 候选证据必须消费页证据的 chapter_ref");
  const evidence = g2CandidateEvidence({
    facts: history.facts,
    run: history.record,
    pending: history.pending,
    chapterRef,
    records,
    beforeText: visibleTextIfExists(dir, "01-workbench"),
    finalText: visibleTextIfExists(dir, "final"),
  });
  return {
    scenario_id: config.scenario_id,
    chapter_ref: chapterRef,
    ...evidence,
    signed_scope: "candidate_only",
    g2_signed: false,
    not_signed: ["page_level_usage"],
  };
}

// 页级使用证据：只消费已算的 liveRefsCheck.reports；页/候选未成立时按缺证返回，
// 由入口在页与候选之后统一拒绝。报告只保留 refs/理由，不写正文。
export function g2UsageReport({ config, pages, candidate, refs }) {
  assert.equal(config.scenario_id, "b82-g2", "G2 页级使用证据只属于冻结的 b82-g2");
  const evidence = g2PageUsageEvidence({ pages, candidate, reports: refs?.reports });
  return {
    scenario_id: config.scenario_id,
    ...evidence,
    signed_scope: "page_usage_only",
    g2_signed: false,
    not_signed: ["final"],
  };
}

// 修订批次只读 DB 读取：按明确 run/receipt/turn/trace 身份读取，不按“最新”猜。
export function readRunRecord(dir, runId) {
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT * FROM agent_runs WHERE id = ?", [runId]);
    assert.equal(rows.length, 1, `run 读取: ${runId} 必须恰好一行`);
    return rows[0];
  });
}

export function readActionReceipt(dir, { receiptId, workId, sessionId }) {
  return withDb(dir, (db) => {
    const rows = all(
      db,
      "SELECT * FROM author_action_receipts WHERE id = ? AND work_id = ? AND session_id = ?",
      [receiptId, workId, sessionId],
    );
    assert.equal(rows.length, 1, `receipt 读取: ${receiptId} 必须恰好一行`);
    const row = rows[0];
    return {
      ...row,
      result: typeof row.result === "string" ? JSON.parse(row.result) : row.result,
    };
  });
}

function decodeInteractionContent(content) {
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("interaction content 不是合法 JSON");
  }
}

export function readAssistantInteraction(dir, { workId, sessionId, turnId }) {
  return withDb(dir, (db) => {
    const rows = all(
      db,
      "SELECT * FROM interactions WHERE workspace_id = ? AND session_id = ? AND turn_id = ? AND role = 'assistant'",
      [workId, sessionId, turnId],
    );
    assert.equal(rows.length, 1, `assistant interaction 读取: ${turnId} 必须恰好一行`);
    return { row: rows[0], content: decodeInteractionContent(rows[0].content) };
  });
}

export function readDecisionTrace(dir, { traceId, turnId }) {
  return withDb(dir, (db) => {
    const rows = all(
      db,
      "SELECT * FROM decision_traces WHERE trace_id = ? AND turn_id = ?",
      [traceId, turnId],
    );
    assert.equal(rows.length, 1, `decision trace 读取: ${traceId} 必须恰好一行`);
    return rows[0];
  });
}
