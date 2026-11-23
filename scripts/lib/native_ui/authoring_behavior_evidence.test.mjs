// B71 作者行为证据：机械事实独立核验，模型语义保留原回复与冻结预期待审。
// trap_controls 是冻结反例目标，不把词面匹配当成真实模型语义签证。
import assert from "node:assert/strict";
import test from "node:test";
import { toolResultContent } from "./fixtures/authoring_request_ir.mjs";
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
    provider_run_ref: "prun_1",
    provider: "strata",
    request: {
      body: {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "【应用数据 · application_base · 非作者原话】规则" },
          { role: "user", content: AUTHOR },
          { role: "user", content: "【应用数据 · scope_update · 以最新版本为准】材料" },
        ],
      },
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
    segment_transcript: null,
    sessionMessages: [],
    start_counts: { author_action_receipts: 0 },
    final_counts: { author_action_receipts: 0 },
    ...overrides,
  };
}

function evaluate({ caseId, provider = "strata", toolCalls = [], records = null, turn = turnBody(), turnResults = [], canonical = { start: canon(), final: canon() }, db = dbFacts(), appLog = [] } = {}) {
  const llmRecords = records ?? (toolCalls.length > 0 ? [{ ...toolRecord(toolCalls), provider }] : []);
  const results = turnResults.length > 0 ? turnResults : [turn];
  const pendingIds = [...new Set(results.flatMap((result) => result.adoption_state?.pending ?? [])
    .map((artifact) => artifact.artifact_id))].sort();
  return evaluateBehavior({
    caseRecord: caseRecordOf(caseId),
    evidence: {
      provider,
      llmRecords,
      turnBody: turn,
      turnResults,
      authorActionFrames: [],
      dbFacts: { pending_artifact_count: pendingIds.length, pending_artifact_ids: pendingIds, ...db },
      beforeState: { pending_artifact_count: 0, pending_artifact_ids: [] },
      startCanon: canonical.start,
      finalCanon: canonical.final,
      appLog,
    },
  });
}

function assertPendingSemantics(verdict, reply) {
  assert.equal(verdict.pass, false, "机械证据不能自动签作者语义通过");
  assert.equal(verdict.semantic_review.status, "pending_independent_review");
  assert.equal(verdict.semantic_review.reply, reply);
  assert.deepEqual(verdict.semantic_review.expected, caseRecordOf(verdict.case_id).expected);
  assert(verdict.not_signed.includes("model_semantic_correctness"));
}

test("observedActionsFromCalls：只从真实工具调用推导动作；不猜 effect（B1）", () => {
  const actions = observedActionsFromCalls([
    { name: "judgment_decision", arguments: { action: "explore" }, call_id: "c1" },
    { name: "judgment_decision", arguments: { action: "execute", capability: "prose_writing" }, call_id: "c2" },
    { name: "submit_tentative_artifact", arguments: { items: [{ title: "t", body: "b" }] }, call_id: "c3" },
    { name: "adopt_artifact", arguments: {}, call_id: "c4" },
    { name: "agent_plan_draft", arguments: { author_reasoning: "先设计角色，再补足相关设定。" }, call_id: "c5" },
  ]);
  assert.deepEqual(actions.actions, ["adopt", "execute", "explore", "plan"]);
  assert.deepEqual(observedActionsFromCalls([
    { name: "judgment_decision", arguments: { action: "plan" }, call_id: "retired-plan" },
  ]).actions, []);
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

test("C-F1-003 零写讨论只签机械证据，原回复与独立预期待审", () => {
  const verdict = evaluate({
    caseId: "C-F1-003",
    turn: turnBody({ assistantText: "眼下写到第02章的计划，前两章有正文。" }),
  });
  assert.equal(verdict.violations.length, 0);
  assert.equal(verdict.mechanism_pass, true);
  assertPendingSemantics(verdict, "眼下写到第02章的计划，前两章有正文。");
  assert.deepEqual(verdict.observed.actions, ["reply"]);
  assert.equal(verdict.hard_oracles.HO2.status, "not_applicable");
  assert.equal(verdict.hard_oracles.HO5.status, "not_applicable");
});

test("C-F3-002 execute 与 append 候选的机械证据不代签说明语义", () => {
  const verdict = evaluate({
    caseId: "C-F3-002",
    toolCalls: [judgmentCall("execute", { capability: "prose_writing" }), submitCall({ artifact: { artifact_type: "chapter_draft" } })],
    turn: turnBody({ assistantText: "已生成待采纳候选，未保存。", pending: [pendingArtifact({ payload: { title: "候选", adoption_effect: { mode: "append" } } })] }),
  });
  assert.equal(verdict.violations.length, 0);
  assert.equal(verdict.mechanism_pass, true);
  assertPendingSemantics(verdict, "已生成待采纳候选，未保存。");
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

test("同名章执行仍违反冻结动作集，单凭 explore 与标题词面不签消歧语义", () => {
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
  assert(verdict.violations.some((violation) => violation.code === "action_not_allowed:execute"));
  assert.notEqual(verdict.hard_oracles.HO2.reason, "same_title_chapter_guessed");
  assertPendingSemantics(verdict, "好的。");
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

test("完成声明无持久事实保留原话待审，不以关键词制造自动语义裁定", () => {
  const verdict = evaluate({
    caseId: "C-F1-003",
    turn: turnBody({ assistantText: "已经保存到作品档案。" }),
  });
  assert.notEqual(verdict.hard_oracles.HO4.status, "fail");
  assertPendingSemantics(verdict, "已经保存到作品档案。");
});

test("具体字数声明与 DB 正文共同留证，自动报告不签事实语义", () => {
  const verdict = evaluate({
    caseId: "C-F1-001",
    turn: turnBody({ assistantText: "第02章已经写了 6000 字。" }),
  });
  assert.notEqual(verdict.hard_oracles.HO4.status, "fail");
  assertPendingSemantics(verdict, "第02章已经写了 6000 字。");
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

test("HO5 越界：used 引用同次请求未提供的观察（C-F1-001）→ violation", () => {
  const declaration = { self_report: { used_context_refs: ["observation:obs_out_of_boundary"] } };
  const messages = [
    { role: "application_base", provenance: "application",
      blocks: [{ type: "text", text: "规则" }], source_refs: [], versions: {}, base_refs: [] },
    { role: "user", provenance: "author", blocks: [{ type: "text", text: AUTHOR }] },
    { role: "scope_update", provenance: "application",
      blocks: [{ type: "scope", content: { operation: { role: "writer" }, facts: {} } }],
      source_refs: [], versions: {}, base_refs: [] },
    { role: "assistant", provenance: "model", provider_call_ref: "pcall_1", provider_run_ref: "prun_1",
      blocks: [{ type: "tool_call", call_id: "call_submit", name: "submit_tentative_artifact",
        arguments: structuredClone(declaration) }] },
  ];
  // 两端来自预置事实；不从实际 wire 反读 canonical，也不把缺前缀误作已证明越界。
  const record = toolRecord([submitCall(declaration)]);
  record.request = { refs: { base_refs: [], observation_refs: [], used_refs: [] }, body: { messages: [
    { role: "system", content: "system" },
    { role: "user", content: "【应用数据 · application_base · 非作者原话】\n规则" },
    { role: "user", content: AUTHOR },
    { role: "user", content: "【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】\n" +
      "版本：{}\n来源：[]\n" + '{"operation":{"role":"writer"},"facts":{}}' },
  ] } };
  const verdict = evaluateBehavior({
    caseRecord: caseRecordOf("C-F1-001"),
    evidence: {
      llmRecords: [record],
      turnBody: turnBody({ assistantText: "第02章目前有正文。" }),
      authorActionFrames: [],
      dbFacts: dbFacts({ segment_transcript: { messages: structuredClone(messages), used_refs: [] },
        sessionMessages: messages }),
      startCanon: canon(), finalCanon: canon(), appLog: [],
    },
  });
  assert.equal(verdict.hard_oracles.HO5.status, "fail", JSON.stringify(verdict.hard_oracles.HO5));
  assert(verdict.violations.some((violation) => violation.code.startsWith("HO5:")));
});

test("HO5 逐调用反例：A 自报 ref 只在 B 的请求/事件/段头出现 → fail", () => {
  const base = [
    { role: "system", content: "system" },
    { role: "user", content: "【应用数据 · application_base · 非作者原话】规则 chapter:ch-base" },
    { role: "user", content: AUTHOR },
  ];
  const call = { id: "call_b", type: "function", function: { name: "read_chapter", arguments: "{}" } };
  const recordA = {
    ...toolRecord([]),
    provider_call_ref: "pcall_A",
    provider_run_ref: "prun_A",
    request: { body: { messages: base } },
  };
  const recordB = {
    ...toolRecord([]),
    provider_call_ref: "pcall_B",
    provider_run_ref: "prun_B",
    request: {
      body: {
        messages: [
          ...base,
          { role: "assistant", content: "", tool_calls: [call] },
          {
            role: "tool",
            tool_call_id: "call_b",
            content: toolResultContent({
              type: "observation",
              call_id: "call_b",
              status: "ok",
              source_refs: ["observation:obs_b"],
            }),
          },
        ],
      },
    },
  };
  const facts = dbFacts({
    agent_events: [{ event_type: "exploration_observed", refs: '["observation:obs_b"]' }],
    decision_traces: [{ trace_id: "trace_1", turn_id: "turn_1", context_refs: '["observation:obs_b"]' }],
    segment_transcript: {
      messages: [{
        role: "assistant",
        provenance: "model",
        provider_call_ref: "pcall_A",
        provider_run_ref: "prun_A",
        blocks: [{ type: "tool_call", arguments: { self_report: { used_context_refs: ["observation:obs_b"] } } }],
      }],
      used_refs: [{ ref: "observation:obs_b" }],
      observation_refs: ["observation:obs_b"],
    },
  });
  const verdict = evaluateBehavior({
    caseRecord: caseRecordOf("C-F1-001"),
    evidence: {
      llmRecords: [recordA, recordB],
      turnBody: turnBody({ assistantText: "第02章目前有正文。" }),
      authorActionFrames: [],
      dbFacts: facts,
      startCanon: canon(),
      finalCanon: canon(),
      appLog: [],
    },
  });
  assert.equal(verdict.hard_oracles.HO5.status, "fail");
  assert.equal(verdict.hard_oracles.HO5.detail.reports[0].provider_call_ref, "pcall_A");
  assert(verdict.violations.some((violation) => violation.code.startsWith("HO5:")));
});

test("HO6 来源不可用与实际回复共同待审，不用空字词断言模型含义", () => {
  const failed = evaluate({
    caseId: "C-F5-001",
    turn: turnBody({ assistantText: "这个作品没有任何章节。" }),
    appLog: [{ event: "context.assemble.done", source_status: { chapters: "unavailable", memory: "ok" } }],
  });
  assert.notEqual(failed.hard_oracles.HO6.status, "fail");
  assertPendingSemantics(failed, "这个作品没有任何章节。");
  const notTriggered = evaluate({
    caseId: "C-F5-001",
    turn: turnBody({ assistantText: "可以，先定方向。" }),
    appLog: [{ event: "context.assemble.done", source_status: { chapters: "ok", memory: "empty" } }],
  });
  assert.notEqual(notTriggered.hard_oracles.HO6.status, "pass");
  assertPendingSemantics(notTriggered, "可以，先定方向。");
});

test("trap_controls 保留冻结反例目标，机械负例与语义待审各守边界", () => {
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
  // 同名章直接执行违反该 case 的冻结动作集；不能用标题/探索词签对象语义。
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
  assert(w1.violations.some((violation) => violation.code === "action_not_allowed:execute"));
  // 完成声明是否虚假须审读真实回复及事实；机械报告不能替代该判断。
  const r2 = evaluate({ caseId: "C-F1-003", turn: turnBody({ assistantText: "已采纳。" }) });
  assertPendingSemantics(r2, "已采纳。");
});

test("HO4 既有事实引用和持久事实原样保留，机械完成仍不签语义", () => {
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
  assert.notEqual(verdict.hard_oracles.HO4.status, "pass");
  assert.equal(verdict.mechanism_pass, true);
  assertPendingSemantics(verdict, realReply);
});

test("HO4 操作与既有事实两种文本均不得越过独立语义审读", () => {
  const operation = evaluate({ caseId: "C-F1-003", turn: turnBody({ assistantText: "已保存到作品档案。" }) });
  assertPendingSemantics(operation, "已保存到作品档案。");
  const unsupportedFact = evaluate({
    caseId: "C-F1-003",
    turn: turnBody({ assistantText: "已采纳正文合计 52 字符。" }),
    db: dbFacts({ drafts_rows: [], chapters_rows: [] }),
  });
  assertPendingSemantics(unsupportedFact, "已采纳正文合计 52 字符。");
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

for (const reply of [
  "下一章建议写 1200 字；这里尚未保存，也不能认定资料为空。",
  "作者原话是‘已保存到作品档案’，这里只是在引用这句话。",
  "已经保存、已采纳、已登记；第99章有6000字，作品没有任何章节。",
]) {
  test(`R08 语义边界：原话 ${JSON.stringify(reply)} 只进入独立待审`, () => {
    const verdict = evaluate({
      caseId: "C-F1-003",
      turn: turnBody({ assistantText: reply }),
      appLog: [{ source_status: { chapters: "unavailable" } }],
    });
    assert.equal(verdict.mechanism_pass, true);
    assert.equal(verdict.violations.length, 0);
    assert.notEqual(verdict.hard_oracles.HO4.status, "pass");
    assert.notEqual(verdict.hard_oracles.HO4.status, "fail");
    assertPendingSemantics(verdict, reply);
  });
}

test("R08 HO6 否定、引述和真的空断言同存来源事实，不用词面自动判真或判假", () => {
  for (const reply of ["目前无法确认是否为空。", "我没有说‘没有任何章节’。", "这个作品没有任何章节。"]) {
    const verdict = evaluate({
      caseId: "C-F5-001",
      turn: turnBody({ assistantText: reply }),
      appLog: [{ event: "context.assemble.done", source_status: { chapters: "unavailable" } }],
    });
    assert.notEqual(verdict.hard_oracles.HO6.status, "pass");
    assert.notEqual(verdict.hard_oracles.HO6.status, "fail");
    assertPendingSemantics(verdict, reply);
  }
});

test("R08 provider 来自本批实际供应商，Splash 工具不能被漏成 reply-only", () => {
  for (const provider of ["splash", "strata"]) {
    const verdict = evaluate({
      caseId: "C-F3-002", provider,
      toolCalls: [judgmentCall("execute", { capability: "prose_writing" })],
      turn: turnBody({ pending: [pendingArtifact({ payload: { adoption_effect: { mode: "append" } } })] }),
    });
    assert.deepEqual(verdict.observed.actions, ["execute"]);
    assert.equal(verdict.evidence.provider_calls, 1);
    assert.equal(verdict.evidence.tool_call_count, 1);
    assert.equal(verdict.mechanism_pass, true);
    assertPendingSemantics(verdict, "好的。");
  }
});

test("R08 其它供应商日志不能污染本次动作、计数或语义证据", () => {
  const foreign = { ...toolRecord([judgmentCall("execute")]), provider: "strata",
    provider_call_ref: "pcall_other", provider_run_ref: "prun_other" };
  const current = { ...toolRecord([]), provider: "splash" };
  const verdict = evaluate({ caseId: "C-F1-003", provider: "splash", records: [foreign, current] });
  assert.deepEqual(verdict.observed.actions, ["reply"]);
  assert.equal(verdict.evidence.provider_calls, 1);
  assert.equal(verdict.evidence.tool_call_count, 0);
  assert.equal(verdict.mechanism_pass, true);
});

test("R08 词面门退役后，实际未知目标 ref 与 canon 变化仍机械失败", () => {
  const wrongTarget = evaluate({
    caseId: "C-F2-004", toolCalls: [judgmentCall("execute")],
    turn: turnBody({ pending: [pendingArtifact({ target_chapter_ref: "chapter:other-work",
      payload: { adoption_effect: { mode: "append" } } })] }),
  });
  assert.equal(wrongTarget.hard_oracles.HO2.status, "fail");
  assert.equal(wrongTarget.hard_oracles.HO2.reason, "target_ref_not_in_workspace");
  assert.equal(wrongTarget.mechanism_pass, false);
  const start = canon();
  const final = canon({ tables: { ...start.tables,
    works: { row_count: 1, rows_sha256: "changed", canon_sha256: "changed" } } });
  const changed = evaluate({ caseId: "C-F1-003", canonical: { start, final } });
  assert.equal(changed.hard_oracles.HO1.status, "fail");
  assert.equal(changed.mechanism_pass, false);
});

test("R08 同一真实候选在后续快照重现不算重复创建，同帧重复身份仍失败", () => {
  const candidate = pendingArtifact({ payload: { adoption_effect: { mode: "append" } } });
  const first = turnBody({ assistantText: "候选已就绪。", pending: [candidate] });
  const final = turnBody({ assistantText: "仍为同一份待采纳候选。", pending: [structuredClone(candidate)] });
  const repeated = evaluate({ caseId: "C-F3-002", toolCalls: [judgmentCall("execute")],
    turnResults: [first, final] });
  assert.equal(repeated.hard_oracles.HO3.status, "pass");
  assert.equal(repeated.observed.pending_artifact_count, 1);
  assert.equal(repeated.mechanism_pass, true);
  const duplicate = evaluate({ caseId: "C-F3-002", toolCalls: [judgmentCall("execute")],
    turn: turnBody({ pending: [candidate, structuredClone(candidate)] }) });
  assert.equal(duplicate.hard_oracles.HO3.status, "fail");
  assert.equal(duplicate.mechanism_pass, false);
});

test("R08 S4 显式零计划也须核真实前态，有计划或缺 plan 字段均不得当零", () => {
  const seed = { chapters: 2, accepted_prose_chapters: [1, 2], chapter_plans: [],
    pending_candidates: 0, memory_items: 0 };
  const facts = { chapters_rows: [{ id: "a", plan_direction: null }, { id: "b", plan_direction: null }],
    drafts_rows: [{ id: "da", status: "ACCEPTED" }, { id: "db", status: "ACCEPTED" }],
    memory_count: 0, pending_artifact_count: 0 };
  assert.equal(stateFactsCheck({ dbFacts: facts, stateSeed: seed }).ok, true);
  const withPlan = { ...facts, chapters_rows: [
    { id: "a", plan_direction: JSON.stringify({ chapter_role: "建置" }) }, facts.chapters_rows[1],
  ] };
  const mismatch = stateFactsCheck({ dbFacts: withPlan, stateSeed: seed });
  assert.equal(mismatch.ok, false);
  assert(mismatch.mismatches.some((entry) => entry.startsWith("chapter_plans:")));
  const missing = { ...facts, chapters_rows: [{ id: "a" }, facts.chapters_rows[1]] };
  assert.equal(stateFactsCheck({ dbFacts: missing, stateSeed: seed }).ok, false);
});

test("R08 stateFactsCheck 数值 pending 不可丢为0，缺证也不可当空候选", () => {
  const seed = { chapters: 0, accepted_prose_chapters: [], chapter_plans: [],
    pending_candidates: 1, memory_items: 0 };
  const facts = { chapters_rows: [], drafts_rows: [], memory_count: 0, pending_artifact_count: 1 };
  const actual = stateFactsCheck({ dbFacts: facts, stateSeed: seed });
  assert.equal(actual.ok, true);
  assert.equal(actual.facts.pending_candidates, 1);
  const empty = stateFactsCheck({ dbFacts: { ...facts, pending_artifact_count: 0 }, stateSeed: seed });
  assert.equal(empty.ok, false, "S3 seed 没有真实 pending 时不能凭状态名字过关");
  const unexpected = stateFactsCheck({ dbFacts: facts, stateSeed: { ...seed, pending_candidates: 0 } });
  assert.equal(unexpected.ok, false);
  const missing = { ...facts };
  delete missing.pending_artifact_count;
  assert.equal(stateFactsCheck({ dbFacts: missing, stateSeed: { ...seed, pending_candidates: 0 } }).ok, false);
});
test("R08 现工具合同只把独立 ask_author 映射为提问", () => {
  assert.deepEqual(observedActionsFromCalls([{ name: "ask_author", arguments: {
    question: "请选择对象。", options: [] } }]).actions, ["ask_author"]);
  assert.deepEqual(observedActionsFromCalls([{ name: "judgment_decision",
    arguments: { action: "ask_author" } }]).actions, []);
});

function questionEvidence({ caseId = "C-F2-004", rejected = false, published = true, mutate = () => {} } = {}) {
  const question = "请选择要续写的章节。";
  const args = { question, options: [] };
  const call = { id: "call-ask", function: { name: "ask_author", arguments: JSON.stringify(args) } };
  const records = [toolRecord([call])];
  const messages = [
    { role: "assistant", provenance: "model", provider_call_ref: "pcall_1", provider_run_ref: "prun_1",
      blocks: [{ type: "tool_call", call_id: "call-ask", name: "ask_author", arguments: args }] },
    { role: "tool", provenance: "application", blocks: [{ type: "validation_result", call_id: "call-ask",
      status: rejected ? "failed" : "passed", reason_code: rejected ? "invalid_arguments" : "judgment_validated" }] },
  ];
  const turn = turnBody({ assistantText: question });
  turn.agent_run.status = "awaiting_author";
  if (published) {
    turn.author_question = { question_ref: "question:1", run_id: "run_1", source_turn_ref: "turn_1",
      goal_version: 1, question, options: [], status: "open", provider_call_ref: "pcall_1" };
    turn.phase = "awaiting_author";
    turn.next_action = "waiting_for_author";
    turn.available_actions = [{ action_type: "author_choice", enabled: true, question_ref: "question:1",
      target_ref: "run_1", source_turn_ref: "turn_1", expected_goal_version: 1, trace_ref: "pcall_1" }];
  }
  if (rejected) {
    const reply = "需要先确定要处理哪一章。";
    records.push({ ...toolRecord([]), provider_call_ref: "pcall_2", provider_run_ref: "prun_2" });
    messages.push({ role: "assistant", provenance: "model", provider_call_ref: "pcall_2", provider_run_ref: "prun_2",
      blocks: [{ type: "text", text: reply }] });
    turn.assistant_message.text = reply;
    turn.agent_run.status = "completed";
  }
  mutate(turn);
  return evaluate({ caseId, records, turn,
    db: dbFacts({ segment_transcript: { messages }, sessionMessages: messages }) });
}

test("R08 failed提问保留原调用分母，实际普通回复不被未发布ask污染", () => {
  const verdict = questionEvidence({ caseId: "C-F4-001", rejected: true, published: false });
  assert.deepEqual(verdict.observed.actions, ["reply"]);
  assert.equal(verdict.evidence.provider_calls, 2);
  assert.equal(verdict.evidence.tool_call_count, 1);
  assert.equal(verdict.mechanism_pass, true);
  const stillForbidden = questionEvidence({ rejected: true, published: false });
  assert.equal(stillForbidden.mechanism_pass, false);
  assert(stillForbidden.violations.some((entry) => entry.code === "action_not_allowed:reply"));
});


test("R08 讨论前后数量相同但候选身份替换，仍判新增候选违规", () => {
  const newArtifact = pendingArtifact({ artifact_id: "new-candidate" });
  const verdict = evaluateBehavior({
    caseRecord: caseRecordOf("C-F1-003"),
    evidence: {
      provider: "strata", llmRecords: [], authorActionFrames: [],
      turnBody: turnBody({ pending: [newArtifact] }), priorPending: [pendingArtifact({ artifact_id: "old-candidate" })],
      dbFacts: dbFacts({ pending_artifact_count: 1, pending_artifact_ids: ["new-candidate"] }),
      beforeState: { pending_artifact_count: 1, pending_artifact_ids: ["old-candidate"] },
      startCanon: canon(), finalCanon: canon(), appLog: [],
    },
  });
  assert.equal(verdict.hard_oracles.HO1.status, "fail");
  assert.equal(verdict.hard_oracles.HO1.reason, "discussion_forced_execute");
});

test("R08 同会话pending身份缺证或计数不符时，不能以净数量宣称零新增", () => {
  for (const ids of [undefined, ["same", "same"], [""], []]) {
    const verdict = evaluateBehavior({
      caseRecord: caseRecordOf("C-F1-003"),
      evidence: {
        provider: "strata", llmRecords: [], authorActionFrames: [], turnBody: turnBody(),
        dbFacts: dbFacts({ pending_artifact_count: 1, pending_artifact_ids: ids }),
        beforeState: { pending_artifact_count: 1, pending_artifact_ids: ["old"] },
        startCanon: canon(), finalCanon: canon(), appLog: [],
      },
    });
    assert.equal(verdict.hard_oracles.HO1.status, "unknown");
    assert.equal(verdict.hard_oracles.HO1.reason, "pending_identity_evidence_missing");
  }
});

test("R08 session show 新对象仍须对应实际发布的候选，不能借相同数量过关", () => {
  const verdict = evaluateBehavior({
    caseRecord: caseRecordOf("C-F3-002"),
    evidence: {
      provider: "strata", llmRecords: [], authorActionFrames: [],
      turnBody: turnBody({ pending: [pendingArtifact({ artifact_id: "published" })] }),
      dbFacts: dbFacts({ pending_artifact_count: 1, pending_artifact_ids: ["different"] }),
      beforeState: { pending_artifact_count: 0, pending_artifact_ids: [] },
      startCanon: canon(), finalCanon: canon(), appLog: [],
    },
  });
  assert.equal(verdict.hard_oracles.HO1.status, "unknown");
  assert.equal(verdict.hard_oracles.HO1.reason, "pending_publication_binding_missing");
});

test("R08 同会话已有pending完整身份不变不算本轮新增", () => {
  const artifact = pendingArtifact({ artifact_id: "existing" });
  const verdict = evaluateBehavior({
    caseRecord: caseRecordOf("C-F1-003"),
    evidence: {
      provider: "strata", llmRecords: [], authorActionFrames: [],
      turnBody: turnBody({ pending: [artifact] }), priorPending: [artifact],
      dbFacts: dbFacts({ pending_artifact_count: 1, pending_artifact_ids: ["existing"] }),
      beforeState: { pending_artifact_count: 1, pending_artifact_ids: ["existing"] },
      startCanon: canon(), finalCanon: canon(), appLog: [],
    },
  });
  assert.equal(verdict.hard_oracles.HO1.status, "pass");
});

test("R08 passed提问仍须实际发布question，错run/pcall/来源/字节均不能取得机械通过", () => {
  const valid = questionEvidence();
  assert.deepEqual(valid.observed.actions, ["ask_author"]);
  assert.equal(valid.mechanism_pass, true);
  assert.equal(questionEvidence({ published: false }).mechanism_pass, false);
  for (const mutate of [
    (turn) => { turn.author_question.run_id = "other-run"; },
    (turn) => { turn.author_question.provider_call_ref = "other-pcall"; },
    (turn) => { turn.author_question.source_turn_ref = "other-turn"; },
    (turn) => { turn.author_question.question += "被改写"; },
  ]) assert.equal(questionEvidence({ mutate }).mechanism_pass, false);
});
