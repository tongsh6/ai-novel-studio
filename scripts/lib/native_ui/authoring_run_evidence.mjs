// B71 原生批次的核验采集/落盘适配：只从已采集证据读取结构化事实，再交给纯判据。
//
// 本模块不判断场景是否通过；它负责把真实帧/日志/AX/DB 读数归一为纯函数输入，
// 并把最终 checks/measured/summary 按既有命名写入批次目录。
import assert from "node:assert/strict";
import { wireTerminal } from "./live_run_wait.mjs";
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
  sha256,
  turnFacts,
  withDb,
  write,
  writeNativeFrames,
  writeNativeSummary,
} from "./scenario_evidence.mjs";
import { authoringScope, readAuthoringHistory } from "./authoring_history_evidence.mjs";
import { joinNativeCallEvidence, readProviderRuns, scopeForProviderCall } from "./authoring_call_evidence.mjs";
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";
import { writerArtifactMatch } from "./authoring_pending_evidence.mjs";
import { analyzeRequestCost } from "./request_cost_evidence.mjs";
import { nativeSummary } from "./request_cost_batch_evidence.mjs";
import { prefixComparison } from "./request_cost_manifest.mjs";
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

export function firstCompletedTurn(wire, identity, message) {
  const terminal = wireTerminal(wire, identity);
  assert(terminal?.kind === "completed", message);
  return terminal.body;
}

export function lastCompletedTurn(wire, identity, message) {
  return firstCompletedTurn(wire, { ...identity, resultPosition: "last" }, message);
}

const COMPLETED_TURN = Object.freeze({ first: firstCompletedTurn, last: lastCompletedTurn });

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
  const workId = readConfig(dir).target.work_id;
  const scope = {
    ...authoringScope(evidence.wire, sent, { workId, parentTurnId: facts.turnId }),
    run_id: runId,
    topic,
  };
  const history = readAuthoringHistory(dir, scope, { requireMode: spec.requireRunMode });
  const completed = COMPLETED_TURN[spec.completedTurn](evidence.wire, {
    turnId: facts.turnId, runId, runRow: history.record, topic, since: sent.at,
    workId, sessionId: scope.session_id,
  }, spec.missingCompleted);
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
// 同一 run 的实际开始顺序，G2 页证据与 B29 角色取证共用；DB 生命周期由调用者持有。
export function readNativeCallStarts(db, runId) {
  assert(typeof runId === "string" && runId !== "", "provider started 读取缺少 run_id");
  return all(db,
    "SELECT provider_run_id, provider_call_ref, emitted_at FROM provider_events " +
      "WHERE agent_run_id = ? AND event_type = 'started' ORDER BY emitted_at",
    [runId]);
}

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
    const starts = readNativeCallStarts(db, runId);
    return {
      chapter_ref: `chapter:${draft.chapter_id}`,
      draft_ref: `draft:${draft.draft_id}`,
      revision: Number(draft.revision),
      prose,
      starts,
    };
  });
}

export function readJudgmentNarrativeSource(dir, history, reply, action = "reply") {
  const events = withDb(dir, (db) => all(db,
    "SELECT run_id, event_type, payload FROM agent_events WHERE run_id = ? AND event_type = 'judgment_decided'",
    [history.record.id])).map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  const matching = events.filter((event) =>
    event.payload.action === action && event.payload.author_narrative === reply);
  if (matching.length !== 1) return null;
  const source = matching[0].payload.author_narrative_source;
  const outputs = history.transcript.messages.filter((message) =>
    message.role === "assistant" && message.provenance === "model" &&
    message.provider_call_ref === source?.provider_call_ref &&
    message.provider_run_ref === source?.provider_run_ref);
  if (outputs.length !== 1) return null;
  const output = outputs[0];
  return { event: matching[0], output: {
    run_id: history.transcript.run.run_id, role: output.role, provenance: output.provenance,
    provider_call_ref: output.provider_call_ref, provider_run_ref: output.provider_run_ref,
    blocks: output.blocks,
  } };
}

// R05 输入仍由本 reader 组合：冻结可见目标、真实终局、同次 writer/回复与实际请求。
// 不在这里裁决全文/范围或文学语义；旧 G2/B29 reader 与判据保持各自契约。
export function readR05Inputs(dir, { config, history, records, wire }) {
  const run = history.record;
  const source = { work_id: run.work_id, ...readG2PageInputs(dir, {
    workId: run.work_id, runId: run.id, target: config.author_visible_target,
  }) };
  if (config.r05_goal === "style") {
    source.style = withDb(dir, (db) => {
      const rows = all(db, "SELECT id, version, content FROM memory_items " +
        "WHERE work_id = ? AND type = 'STYLE_RULE' AND status = 'CONFIRMED'", [run.work_id]);
      assert.equal(rows.length, 1, "R05 冻结作品必须唯一命中已确认风格原文");
      assert.equal(rows[0].content, "多用对白推进情节，少用心理独白。", "R05 风格 seed 原文不符");
      return { ref: `memory:${rows[0].id}`, version: Number(rows[0].version), body: rows[0].content };
    });
  }
  const body = lastCompletedTurn(wire, {
    turnId: history.facts.turnId, runId: run.id, runRow: run,
    topic: history.facts.ack.frame[2], workId: run.work_id, sessionId: run.session_id,
    since: history.facts.ack.at,
  }, "R05 缺少当前作者输入对应的真实 completed 终局");
  const allPending = Array.isArray(body.adoption_state?.pending) ? body.adoption_state.pending : [];
  const pending = allPending.filter((entry) => history.pending.includes(entry.artifact_id));
  const candidate = pending.length === 1 ? pending[0] : null;
  const writer = candidate ? writerArtifactMatch({ artifact: candidate, records }) : null;
  const reply = String(body.assistant_message?.text ?? "");
  const writing = config.r05_goal === "whole" || config.r05_goal === "style";
  const replySource = writing ? null : readJudgmentNarrativeSource(dir, history, reply);
  const requests = records.map((record) => ({
    provider_call_ref: record.provider_call_ref, provider_run_ref: record.provider_run_ref,
    facts: requestFactsFromRecord(record),
    scope: scopeForProviderCall(record, { messages: history.sessionMessages }),
  }));
  const order = new Map(source.starts.map((start, index) =>
    [`${start.provider_call_ref}\u0000${start.provider_run_id}`, index]));
  const startedIndex = (request) => order.get(
    `${request.provider_call_ref}\u0000${request.provider_run_ref}`);
  assert(requests.every((request) => Number.isInteger(startedIndex(request))), "R05 实际调用缺少 started 身份");
  requests.sort((left, right) => startedIndex(left) - startedIndex(right));
  const consumer = writing ? writer?.provider_call_ref : replySource !== null &&
    requests.some((request) => request.provider_call_ref === replySource.output.provider_call_ref &&
      request.provider_run_ref === replySource.output.provider_run_ref)
      ? replySource.output.provider_call_ref : null;
  const costCalls = requests.map((request, index) => {
    const authors = request.facts.authorMessages.filter((message) => message.text === config.message);
    const analysis = analyzeRequestCost(request.facts.record, {
      authorBinding: authors.length === 1
        ? { messageIndex: authors[0].index, text: config.message, sha256: sha256(config.message) } : null,
      purpose: request.provider_call_ref === writer?.provider_call_ref ? "writer" : null,
    });
    return { provider_call_ref: request.provider_call_ref, provider_run_ref: request.provider_run_ref,
      analysis, prefix_change: index === 0 ? null
        : prefixComparison(requests[index - 1].facts.messages, request.facts.messages) };
  });
  const cost = { calls: costCalls, summary: nativeSummary({
    config: { length: 1 }, turnReports: [{ status: "completed" }], allCalls: costCalls,
  }) };
  return { source, requests, reply, candidate, writer, consumer_call_ref: consumer,
    run_id: run.id, reply_source: replySource, pending_count: history.pending.length, cost,
    known_items: allPending.flatMap((entry) => entry.payload?.items ?? [])
      .map((item) => ({ itemTitle: item.title, itemBody: item.body })) };
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
