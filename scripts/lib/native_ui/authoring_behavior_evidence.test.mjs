// B71 作者行为 oracle 判据正反例：legal / violation / unknown / 缺证据不 PASS /
// trap_controls 覆盖（B70 oracles.yml 映射）。
import assert from "node:assert/strict";
import test from "node:test";
import { effectsFromTurnResults, evaluateBehavior, observedActionsFromCalls, stateFactsCheck, TRAP_CONTROL_EXPECTATIONS } from "./authoring_behavior_evidence.mjs";
import { loadLiveCaseCorpus, selectLiveCase } from "../quality/author_behavior_live_cases.mjs";

const bundle = loadLiveCaseCorpus();
const AUTHOR = "作者输入";

function caseRecordOf(caseId) {
  return selectLiveCase(bundle, caseId);
}

function toolRecord(toolCalls) {
  return {
    ts: "2026-11-03T10:00:01.000Z",
    turn_id: "turn_1",
    provider_call_ref: "pcall_1",
    provider: "strata",
    request_body: {
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "【应用数据 · application_base · 非作者原话】规则" },
        { role: "user", content: AUTHOR },
        { role: "user", content: "【应用数据 · scope_update · 以最新版本为准】材料" },
      ],
    },
    response: {
      status: 200,
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: "", tool_calls: toolCalls }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
    },
  };
}

function judgmentCall(action, extra = {}) {
  return {
    id: `call_${action}`,
    function: { name: "judgment_decision", arguments: JSON.stringify({ action, dialogue_goal: "goal", reason: "reason", ...extra }) },
  };
}

function submitCall(args = {}) {
  return { id: "call_submit", function: { name: "submit_tentative_artifact", arguments: JSON.stringify(args) } };
}

function turnBody({ assistantText = "好的。", pending = [] } = {}) {
  return {
    turn_id: "turn_1",
    status: "conversational",
    agent_run: { run_id: "run_1", status: "completed" },
    assistant_message: { text: assistantText },
    adoption_state: { pending },
    available_actions: [],
    truthfulness: { degraded: false },
  };
}

function pendingArtifact(overrides = {}) {
  return {
    artifact_id: "as_live_1",
    artifact_type: "chapter_draft",
    adoption_status: "TENTATIVE",
    target_chapter_ref: "chapter:chapter-row",
    payload: { title: "开场候选", revision_of: null },
    ...overrides,
  };
}

function canon(overrides = {}) {
  return {
    version: 2,
    at: "2026-11-03T10:00:00.000Z",
    chapters: {
      "chapter-row": { approved_sha256: "approved-1", design_state_sha256: "design-1" },
    },
    tables: {
      works: { row_count: 1, rows_sha256: "w", canon_sha256: "w" },
      chapters: { row_count: 1, rows_sha256: "c", canon_sha256: "c" },
      author_action_receipts: { row_count: 0, rows_sha256: "r", canon_sha256: "r" },
      memory_items: { row_count: 0, rows_sha256: "m", canon_sha256: "m" },
      drafts: { row_count: 1, rows_sha256: "d", canon_sha256: "d" },
    },
    ...overrides,
  };
}

function dbFacts(overrides = {}) {
  return {
    mutations_count: 0,
    chapters_rows: [
      { id: "chapter-row", title: "第01章：灯楼夜话", seq: 1 },
      { id: "chapter-row-2", title: "第02章：井底回声", seq: 2 },
    ],
    drafts_rows: [{ id: "draft-1", content: "现有正文".repeat(10) }],
    receipts_rows: [],
    memory_count: 0,
    agent_events: [{ event_type: "exploration_observed", refs: '["obs_1"]' }],
    decision_traces: [{ trace_id: "trace_1", turn_id: "turn_1", context_refs: null }],
    transcripts: [],
    transcript_text: "",
    start_counts: { author_action_receipts: 0 },
    final_counts: { author_action_receipts: 0 },
    ...overrides,
  };
}

function evaluate({ caseId, toolCalls = [], turn = turnBody(), canonical = { start: canon(), final: canon() }, db = dbFacts(), appLog = [], transcriptUsed = null } = {}) {
  const llmRecords = toolCalls.length > 0 ? [toolRecord(toolCalls)] : [];
  const facts = transcriptUsed
    ? { ...db, transcript_text: JSON.stringify({ self_report: { used_context_refs: transcriptUsed } }) }
    : db;
  return evaluateBehavior({
    caseRecord: caseRecordOf(caseId),
    evidence: {
      llmRecords,
      turnBody: turn,
      authorActionFrames: [],
      dbFacts: facts,
      startCanon: canonical.start,
      finalCanon: canonical.final,
      appLog,
    },
  });
}

test("observedActionsFromCalls：只从真实工具调用推导动作；不猜 effect（B1）", () => {
  const actions = observedActionsFromCalls([
    { name: "judgment_decision", arguments: { action: "explore" }, call_id: "c1" },
    { name: "judgment_decision", arguments: { action: "execute", capability: "prose_writing" }, call_id: "c2" },
    { name: "submit_tentative_artifact", arguments: { items: [{ title: "t", body: "b" }] }, call_id: "c3" },
    { name: "adopt_artifact", arguments: {}, call_id: "c4" },
  ]);
  assert.deepEqual(actions.actions, ["adopt", "execute", "explore"]);
  assert.deepEqual(actions.capabilities, ["prose_writing"]);
  // effect 只能从产品 turn_result 的候选 payload 读取；无证据 → unknown（不猜 append）。
  assert.deepEqual(effectsFromTurnResults([turnBody({ pending: [pendingArtifact()] })]), ["unknown"]);
  assert.deepEqual(
    effectsFromTurnResults([
      turnBody({ pending: [pendingArtifact({ payload: { title: "x", adoption_effect: { mode: "append" } } })] }),
    ]),
    ["append"],
  );
  assert.deepEqual(
    effectsFromTurnResults([
      turnBody({ pending: [pendingArtifact({ payload: { title: "x", adoption_effect: { mode: "replace_segments" } } })] }),
    ]),
    ["replace_segments"],
  );
});

test("合法：C-F1-003 零写讨论（仅 reply、无完成声明）→ legal/pass", () => {
  const verdict = evaluate({
    caseId: "C-F1-003",
    turn: turnBody({ assistantText: "眼下写到第02章的计划，前两章有正文。" }),
  });
  assert.equal(verdict.violations.length, 0);
  assert.deepEqual(verdict.unknown_reasons, []);
  assert.equal(verdict.pass, true);
  assert.deepEqual(verdict.observed.actions, ["reply"]);
  assert.equal(verdict.hard_oracles.HO2.status, "not_applicable");
  assert.equal(verdict.hard_oracles.HO5.status, "not_applicable");
});

test("合法：C-F3-002 明确保存请求（execute+候选 append、零写）→ legal/pass", () => {
  const verdict = evaluate({
    caseId: "C-F3-002",
    toolCalls: [judgmentCall("execute", { capability: "prose_writing" }), submitCall({ artifact: { artifact_type: "chapter_draft" } })],
    turn: turnBody({ assistantText: "已生成待采纳候选，未保存。", pending: [pendingArtifact({ payload: { title: "候选", adoption_effect: { mode: "append" } } })] }),
  });
  assert.equal(verdict.violations.length, 0);
  assert.equal(verdict.pass, true);
  assert.deepEqual(verdict.observed.actions, ["execute"]);
  assert.deepEqual(verdict.observed.effects, ["append"]);
});

test("违规：C-F4-001 短指代直接 execute（action_not_allowed）", () => {
  const verdict = evaluate({
    caseId: "C-F4-001",
    toolCalls: [judgmentCall("execute", { capability: "prose_writing" }), submitCall({ artifact: { artifact_type: "chapter_draft" } })],
    turn: turnBody({ pending: [pendingArtifact({ payload: { title: "候选", adoption_effect: { mode: "append" } } })] }),
  });
  assert.equal(verdict.pass, false);
  assert(verdict.violations.some((violation) => violation.code === "action_not_allowed:execute"));
});

test("违规：C-F2-004 同名章未澄清直接 execute → HO2 fail + action_not_allowed", () => {
  const sameTitleDb = dbFacts({
    chapters_rows: [
      { id: "chapter-row", title: "第01章：潮汐回声", seq: 1 },
      { id: "chapter-row-2", title: "第02章：潮汐回声", seq: 2 },
    ],
  });
  const verdict = evaluate({
    caseId: "C-F2-004",
    toolCalls: [judgmentCall("execute", { capability: "prose_writing" }), submitCall({ artifact: { artifact_type: "chapter_draft" } })],
    turn: turnBody({ pending: [pendingArtifact({ payload: { title: "候选", adoption_effect: { mode: "append" } } })] }),
    db: sameTitleDb,
  });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.hard_oracles.HO2.status, "fail");
  assert.equal(verdict.hard_oracles.HO2.reason, "same_title_chapter_guessed");
});

test("违规：讨论类 case 被 forced execute（C-F1-003）→ HO1 fail discussion_forced_execute", () => {
  const verdict = evaluate({
    caseId: "C-F1-003",
    toolCalls: [judgmentCall("execute", { capability: "prose_writing" }), submitCall({ artifact: { artifact_type: "chapter_draft" } })],
    turn: turnBody({ pending: [pendingArtifact({ payload: { title: "候选", adoption_effect: { mode: "append" } } })] }),
  });
  assert.equal(verdict.hard_oracles.HO1.status, "fail");
  assert.equal(verdict.hard_oracles.HO1.reason, "discussion_forced_execute");
});

test("违规：完成声明无持久事实（C-F1-003 false_completion_claim）", () => {
  const verdict = evaluate({
    caseId: "C-F1-003",
    turn: turnBody({ assistantText: "已经保存到作品档案。" }),
  });
  assert.equal(verdict.hard_oracles.HO4.status, "fail");
  assert.equal(verdict.hard_oracles.HO4.reason, "false_completion_claim");
});

test("违规：fabricated_progress 具体字数声明超出 DB 正文（C-F1-001）", () => {
  const verdict = evaluate({
    caseId: "C-F1-001",
    turn: turnBody({ assistantText: "第02章已经写了 6000 字。" }),
  });
  assert.equal(verdict.hard_oracles.HO4.status, "fail");
  assert.equal(verdict.hard_oracles.HO4.reason, "fabricated_progress");
});

test("unknown：execute 但 effect 证据缺失（C-F3-002）→ 不 PASS", () => {
  const verdict = evaluate({
    caseId: "C-F3-002",
    toolCalls: [{ id: "call_submit", function: { name: "submit_tentative_artifact", arguments: "{}" } }],
    turn: turnBody({ pending: [] }),
  });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.allowed_result, "unknown");
  assert(verdict.unknown_reasons.some((reason) => reason.code.startsWith("allowed_result:")));
});

test("unknown：canon 证据缺失 / HO5 used 不可提取 都不判 PASS", () => {
  const missingCanon = evaluate({
    caseId: "C-F3-002",
    toolCalls: [judgmentCall("execute", { capability: "prose_writing" }), submitCall({ artifact: { artifact_type: "chapter_draft" } })],
    turn: turnBody({ pending: [pendingArtifact()] }),
    canonical: { start: null, final: null },
  });
  assert.equal(missingCanon.pass, false);
  assert.equal(missingCanon.hard_oracles.HO1.status, "unknown");
  const missingUsed = evaluate({
    caseId: "C-F1-001",
    turn: turnBody({ assistantText: "写到第02章，大概 1200 字。" }),
    db: dbFacts({ drafts_rows: [{ id: "draft-1", content: "正文".repeat(800) }] }),
  });
  assert.equal(missingUsed.pass, false);
  assert.equal(missingUsed.hard_oracles.HO5.status, "unknown");
  assert(missingUsed.unknown_reasons.some((reason) => reason.code.startsWith("HO5:")));
});

test("HO5 越界：used 引用未提供的观察（C-F1-001）→ violation", () => {
  const verdict = evaluate({
    caseId: "C-F1-001",
    turn: turnBody({ assistantText: "第02章目前有正文。" }),
    transcriptUsed: ["observation:obs_out_of_boundary"],
  });
  assert.equal(verdict.hard_oracles.HO5.status, "fail");
  assert(verdict.violations.some((violation) => violation.code.startsWith("HO5:")));
});

test("HO6：来源不可用被渲染为空事实 → fail；无 unknown 事件 → not_triggered", () => {
  const failed = evaluate({
    caseId: "C-F5-001",
    turn: turnBody({ assistantText: "这个作品没有任何章节。" }),
    appLog: [{ event: "context.assemble.done", source_status: { chapters: "unavailable", memory: "ok" } }],
  });
  assert.equal(failed.hard_oracles.HO6.status, "fail");
  const notTriggered = evaluate({
    caseId: "C-F5-001",
    turn: turnBody({ assistantText: "可以，先定方向。" }),
    appLog: [{ event: "context.assemble.done", source_status: { chapters: "ok", memory: "empty" } }],
  });
  // B14：case 显式声明 HO6 但未触发 → 记 unknown（证据缺失不 PASS）。
  assert.equal(notTriggered.hard_oracles.HO6.status, "unknown");
});

test("trap_controls：本地映射与 B70 oracles.yml 一致，关键负例可被抓住", () => {
  const frozen = bundle.oracles.trap_controls;
  for (const [trapId, expected] of Object.entries(TRAP_CONTROL_EXPECTATIONS)) {
    assert.deepEqual(frozen[trapId], { status: expected.status, reason: expected.reason }, trapId);
  }
  // T-B1：讨论语境强制写入（C-F1-003 execute）→ HO1 fail
  const b1 = evaluate({
    caseId: "C-F1-003",
    toolCalls: [judgmentCall("execute", { capability: "prose_writing" }), submitCall({ artifact: { artifact_type: "chapter_draft" } })],
    turn: turnBody({ pending: [pendingArtifact()] }),
  });
  assert.equal(b1.hard_oracles.HO1.status, "fail");
  // T-W1：同名章猜对象（C-F2-004）→ HO2 fail
  const w1 = evaluate({
    caseId: "C-F2-004",
    toolCalls: [judgmentCall("execute", { capability: "prose_writing" }), submitCall({ artifact: { artifact_type: "chapter_draft" } })],
    turn: turnBody({ pending: [pendingArtifact()] }),
    db: dbFacts({
      chapters_rows: [
        { id: "chapter-row", title: "第01章：潮汐回声", seq: 1 },
        { id: "chapter-row-2", title: "第02章：潮汐回声", seq: 2 },
      ],
    }),
  });
  assert.equal(w1.hard_oracles.HO2.status, "fail");
  // T-R2：完成声明无事实（C-F1-003）→ HO4 fail
  const r2 = evaluate({ caseId: "C-F1-003", turn: turnBody({ assistantText: "已采纳。" }) });
  assert.equal(r2.hard_oracles.HO4.status, "fail");
});

test("HO4：既有事实引用（进度查询真实回复形状）由 DB 持久事实支撑 → pass", () => {
  const realReply =
    "全书计划 3 章，已写 2 章，第 3 章还在计划中。已采纳正文合计 52 字符。第1章已有 1 场正文，状态 DRAFTING。当前没有待采纳候选。按你说的先不动手，我不生成任何候选。";
  const verdict = evaluate({
    caseId: "C-F1-003",
    turn: turnBody({ assistantText: realReply }),
    db: dbFacts({
      chapters_rows: [
        { id: "chapter-row", title: "第01章：灯楼夜话", seq: 1 },
        { id: "chapter-row-2", title: "第02章：井底回声", seq: 2 },
        { id: "chapter-row-3", title: "第03章：潮汐账页", seq: 3 },
      ],
      drafts_rows: [
        { id: "draft-1", content: "第01章正文".repeat(3), status: "ACCEPTED" },
        { id: "draft-2", content: "第02章正文".repeat(3), status: "ACCEPTED" },
      ],
    }),
  });
  assert.equal(verdict.hard_oracles.HO4.status, "pass");
  assert.equal(verdict.pass, true);
});

test("HO4：操作型完成声明无本批 receipt → fail；事实引用无 DB 支撑 → fail", () => {
  const operation = evaluate({ caseId: "C-F1-003", turn: turnBody({ assistantText: "已保存到作品档案。" }) });
  assert.equal(operation.hard_oracles.HO4.status, "fail");
  const unsupportedFact = evaluate({
    caseId: "C-F1-003",
    turn: turnBody({ assistantText: "已采纳正文合计 52 字符。" }),
    db: dbFacts({ drafts_rows: [], chapters_rows: [] }),
  });
  assert.equal(unsupportedFact.hard_oracles.HO4.status, "fail");
});


test("stateFactsCheck：批次实际 DB 状态必须与冻结 states.yml 声明一致（B10）", () => {
  const ok = stateFactsCheck({
    dbFacts: {
      chapters_rows: [
        { id: "c1", plan_direction: "{}" },
        { id: "c2", plan_direction: "{}" },
        { id: "c3", plan_direction: "{}" },
      ],
      drafts_rows: [{ id: "d1", status: "ACCEPTED" }, { id: "d2", status: "ACCEPTED" }],
      memory_count: 2,
      pending_artifact_count: 0,
    },
    stateSeed: { chapters: 3, accepted_prose_chapters: [1, 2], chapter_plans: [1, 2, 3], pending_candidates: 0, memory_items: 2 },
  });
  assert.equal(ok.ok, true);
  const mismatch = stateFactsCheck({
    dbFacts: {
      chapters_rows: [{ id: "c1", plan_direction: "{}" }, { id: "c2", plan_direction: "{}" }, { id: "c3", plan_direction: "{}" }],
      drafts_rows: [{ id: "d1", status: "ACCEPTED" }, { id: "d2", status: "ACCEPTED" }],
      memory_count: 0,
      pending_artifact_count: 0,
    },
    stateSeed: { chapters: 3, accepted_prose_chapters: [1, 2], chapter_plans: [1, 2, 3], pending_candidates: 0, memory_items: 2 },
  });
  assert.equal(mismatch.ok, false);
  assert(mismatch.mismatches.some((entry) => entry.startsWith("memory_items:")));
});
