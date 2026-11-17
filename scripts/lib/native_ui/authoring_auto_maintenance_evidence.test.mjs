// A3 安全点自动维护判据 C1–C10 的纯事实正反例：只消费内存事实与纯判定，不创建
// 目录、SQLite 或子进程。需要真实 AX/capture/DB/端到端 verify 的用例在邻接
// `authoring_auto_maintenance_evidence_io.test.mjs`；两者共享同一组 facts。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { evaluateAutoMaintenance, verifyBackendRestartFacts, verifyMaintenanceRecoveryFacts } from "./authoring_auto_maintenance_evidence.mjs";
import { discussionMaintenanceFacts, maintenanceRecoveryFacts } from "./fixtures/authoring_discussion_facts.mjs";
import {
  AFTER_STARTED_AT,
  autoMaintenanceConfig,
  CALL_ID,
  EVENT_AT,
  FAILURE_REASON,
  FAIL_RUN,
  OTHER_SESSION,
  RECOVERY_RUN,
  RUN,
  SESSION,
  afterRecord,
  afterWireMessages,
  beforeRecord,
  checkpointMessage,
  dbFactsFor,
  driverLogFor,
  llmRecords,
} from "./fixtures/authoring_auto_maintenance_facts.mjs";

function evaluate(overrides = {}) {
  return evaluateAutoMaintenance({
    config: overrides.config ?? autoMaintenanceConfig(),
    dbFacts: overrides.dbFacts ?? dbFactsFor(),
    checkpoints: { start: { authoring_canon: { tables: {} } }, final: { authoring_canon: { tables: {} } } },
    driverLog: overrides.driverLog ?? driverLogFor(),
    cleanup: overrides.cleanup ?? { remaining: [], process_observation: { method: "pgrep+lsof" } },
    llmRecords: overrides.llmRecords ?? llmRecords(),
    appLog: overrides.appLog ?? [
      { event: "agent_run.auto_maintenance.error", run_id: FAIL_RUN, reason: FAILURE_REASON },
    ],
    dir: overrides.dir ?? null,
    multiTurn: overrides.multiTurn ?? null,
  });
}




test("R03 C5/C6：零工具纯讨论与旧 Scope 有真实摘要执行/材料及下一请求，保留作者原字节", () => {
  const scenario = discussionMaintenanceFacts();
  const result = evaluate({ dbFacts: scenario.db, llmRecords: scenario.llmRecords });
  assert.equal(result.checks.C5_next_request_compact.ok, true, JSON.stringify(result.checks.C5_next_request_compact));
  assert.equal(result.checks.C6_canonical_complete.ok, true, JSON.stringify(result.checks.C6_canonical_complete));
  assert.deepEqual(result.checks.C5_next_request_compact.detail.checks[0].covered_call_ids, []);
  assert.equal(result.checks.C5_next_request_compact.detail.checks[0].covered_message_refs.length, 2);
});

test("R03 C5：材料错源、原话改字节、旧 Scope/长答重放、末 checkpoint 缺下一请求均不能过", () => {
  for (const [name, mutate, expected] of [
    ["summary material changed", (s) => { s.summaryRecord.request.body.messages.find(message => message.role === "user" && message.content.startsWith("【应用数据 · application_base")).content = s.summaryRecord.request.body.messages.find(message => message.role === "user" && message.content.startsWith("【应用数据 · application_base")).content.replace("仍欠风险表", "风险表已完成"); }, false],
    ["author trimmed", (s) => { s.after.request.body.messages[0].content = s.after.request.body.messages[0].content.trim(); }, false],
    ["covered discussion replay", (s) => { s.after.request.body.messages.push({ role: "assistant", content: s.messages[2].blocks[0].text }); }, false],
    ["scope version changed", (s) => { s.after.request.body.messages[2].content = s.after.request.body.messages[2].content.replace("版本：{}", '版本：{"goal":99}'); }, false],
    ["missing next request", (s) => { s.db.provider_events = []; }, null],
  ]) {
    const scenario = discussionMaintenanceFacts();
    mutate(scenario);
    const check = evaluate({ dbFacts: scenario.db, llmRecords: scenario.llmRecords }).checks.C5_next_request_compact;
    assert.equal(check.ok, expected, name + ":" + JSON.stringify(check));
  }
});
test("A3 反例：压力不足/无事件 分别 fail", () => {
  const noPressure = evaluate({
    llmRecords: llmRecords().map((record) => ({ ...record, response: { usage: { input_tokens: 500 } } })),
  });
  assert.equal(noPressure.checks.C1_real_pressure.ok, false);
  const noEvents = evaluate({ dbFacts: { ...dbFactsFor(), agent_events: [] } });
  assert.equal(noEvents.checks.C2_auto_maintenance_committed.ok, false);
});

test("C2 分类计数须逐 checkpoint 对账，缺键/伪零/字符串/重复事件均拒绝", () => {
  for (const counts of [null, {}, { tool_exchanges: 0, scope_updates: 0, discussion_messages: 0 },
    { tool_exchanges: "1", scope_updates: 0, discussion_messages: 0 }]) {
    const db = dbFactsFor();
    db.agent_events[0].payload = { covered_counts: counts };
    assert.equal(evaluate({dbFacts: db}).checks.C2_auto_maintenance_committed.ok, false);
  }
  const db = dbFactsFor();
  db.agent_events.push(structuredClone(db.agent_events[0]));
  assert.equal(evaluate({dbFacts: db}).checks.C2_auto_maintenance_committed.ok, false);
});

test("A3 反例：精简泄漏与 canonical 缺失分别 fail", () => {
  const leak = evaluate({
    llmRecords: [beforeRecord(), afterRecord({ messages: afterWireMessages({ replayCall: true, replayResult: true }) })],
  });
  assert.equal(leak.checks.C5_next_request_compact.ok, false);
  assert.equal(leak.checks.C5_next_request_compact.reason, "covered_call_ids_still_in_next_request");
  const canonical = evaluate({
    dbFacts: {
      ...dbFactsFor(),
      authoring_session_messages: [],
    },
  });
  assert.equal(canonical.checks.C6_canonical_complete.ok, false);
});

test("C5 正例：有效 checkpoint 文本显式携带 call_id 不算泄漏，只排除结构化 tool_call/tool_result 重放", () => {
  const messages = afterWireMessages({ summary: `已整理的较早记录（原文含 ${CALL_ID}）` });
  assert(messages.some((message) => typeof message.content === "string" && message.content.includes(CALL_ID)));
  const result = evaluate({ llmRecords: llmRecords().map((record) =>
    record.provider_call_ref === "pcall-after" ? afterRecord({ messages }) : record) });
  const c5 = result.checks.C5_next_request_compact;
  assert.equal(c5.ok, true);
  assert(c5.detail.checks[0].wire_checkpoint_covers.some((ids) => ids.includes(CALL_ID)));
  assert.deepEqual(c5.detail.checks[0].replayed_call_ids, []);
});

test("C5 反例：其他会话 / IR 代替 wire / 首请求缺证时第 2 请求不能补位 → unknown", () => {
  const otherSession = evaluate({
    dbFacts: dbFactsFor({ afterSession: OTHER_SESSION }),
    llmRecords: [beforeRecord(), afterRecord({ sessionId: OTHER_SESSION })],
  });
  assert.equal(otherSession.checks.C5_next_request_compact.ok, null);
  assert.equal(otherSession.checks.C5_next_request_compact.reason, "next_request_evidence_missing");
  assert(otherSession.required.includes("C5_next_request_compact"));
  assert(otherSession.failed.includes("C5_next_request_compact"));

  const irRecord = {
    ...afterRecord(),
    request_format: "authoring-request-ir/v1",
    request_body: {
      ir_version: "authoring-request-ir/v1",
      messages: [
        { role: "application_base", provenance: "application", blocks: [{ type: "text", text: "base" }] },
        { role: "user", provenance: "author", blocks: [{ type: "text", text: "继续读第03章" }] },
        checkpointMessage(),
      ],
      tools: [],
    },
  };
  delete irRecord.request;
  const ir = evaluate({ llmRecords: [beforeRecord(), irRecord] });
  assert.equal(ir.checks.C5_next_request_compact.ok, null);
  assert.equal(ir.checks.C5_next_request_compact.reason, "next_request_evidence_missing");

  const notAfterEvent = evaluate({
    dbFacts: dbFactsFor({ afterEmittedAt: EVENT_AT }),
    llmRecords: [beforeRecord(), afterRecord()],
  });
  assert.equal(notAfterEvent.checks.C5_next_request_compact.ok, null);

  const maskedFacts = dbFactsFor();
  maskedFacts.provider_runs = [
    ...maskedFacts.provider_runs,
    { id: "prun-first", provider_call_ref: "pcall-first", provider_id: "strata", agent_run_id: RUN, session_id: SESSION, purpose: "planner", started_at: null, inserted_at: null },
  ];
  maskedFacts.provider_events = [
    ...maskedFacts.provider_events,
    { id: "pevt-first", provider_run_id: "prun-first", provider_call_ref: "pcall-first", event_type: "started", emitted_at: "2026-11-04T10:00:00.100Z" },
  ];
  const masked = evaluate({ dbFacts: maskedFacts, llmRecords: [beforeRecord(), afterRecord()] });
  assert.equal(masked.checks.C5_next_request_compact.ok, null);
  assert.equal(masked.checks.C5_next_request_compact.reason, "next_request_evidence_missing");
});

test("C6 反例：covers 保留但真实 tool 结果被移除 / 顺序错误 / 旧 checkpoint 形状 → fail", () => {
  const missingResultFacts = dbFactsFor();
  missingResultFacts.authoring_session_messages = missingResultFacts.authoring_session_messages.filter(
    (row) => JSON.parse(row.message).role !== "tool",
  );
  const missingResult = evaluate({ dbFacts: missingResultFacts });
  assert.equal(missingResult.checks.C6_canonical_complete.ok, false);
  assert.match(missingResult.checks.C6_canonical_complete.reason, /covered_exchange_not_closed_exactly_once_before_checkpoint/u);
  const swappedRows = dbFactsFor().authoring_session_messages.map((row) => ({ ...row }));
  const callIndex = swappedRows.findIndex((row) => JSON.parse(row.message).role === "assistant");
  const resultIndex = swappedRows.findIndex((row) => JSON.parse(row.message).role === "tool");
  [swappedRows[callIndex].sequence, swappedRows[resultIndex].sequence] = [
    swappedRows[resultIndex].sequence,
    swappedRows[callIndex].sequence,
  ];
  const outOfOrder = evaluate({ dbFacts: { ...dbFactsFor(), authoring_session_messages: swappedRows } });
  assert.equal(outOfOrder.checks.C6_canonical_complete.ok, false);
  assert.match(outOfOrder.checks.C6_canonical_complete.reason, /covered_exchange_not_closed_exactly_once_before_checkpoint/u);
  const legacyFacts = dbFactsFor();
  legacyFacts.authoring_session_messages = legacyFacts.authoring_session_messages.map((row) => {
    const message = JSON.parse(row.message);
    return message.role === "checkpoint"
      ? { ...row, message: JSON.stringify({ role: "checkpoint", call_ids: [CALL_ID] }) }
      : row;
  });
  const legacy = evaluate({ dbFacts: legacyFacts });
  assert.equal(legacy.checks.C6_canonical_complete.ok, false);
  assert.match(legacy.checks.C6_canonical_complete.reason, /checkpoint_selection_missing/u);
});

test("C6：多条 canonical checkpoint 每条都必须有 covers，任一无 covers 不因另一条合法而假通过", () => {
  const rows = dbFactsFor().authoring_session_messages;
  const appendCheckpoint = (message) => ({
    ...rows.find((row) => row.run_id === RUN && row.role === "checkpoint"),
    id: "extra-checkpoint", sequence: rows.length + 1, run_sequence: 7,
    message: JSON.stringify(message),
  });  const allCovered = evaluate({
    dbFacts: { ...dbFactsFor(), authoring_session_messages: [...rows, appendCheckpoint(checkpointMessage())] },
  });
  assert.equal(evaluate().checks.C6_canonical_complete.ok, true, "两次独立真实交换分别覆盖");
  assert.equal(allCovered.checks.C6_canonical_complete.ok, false, "同一来源重复覆盖必须拒绝");
  assert.match(allCovered.checks.C6_canonical_complete.reason, /checkpoint_call_repeated/u);

  const oneUncovered = evaluate({
    dbFacts: {
      ...dbFactsFor(),
      authoring_session_messages: [...rows, appendCheckpoint(checkpointMessage({ callIds: [] }))],
    },
  });
  assert.equal(oneUncovered.checks.C6_canonical_complete.ok, false);
  assert.match(oneUncovered.checks.C6_canonical_complete.reason, /checkpoint_selection_invalid/u);});

test("C5 反例：wire 存在 malformed call/tool message 时不得通过（缺证语义只留给真缺失）", () => {
  const malformedCallMessages = afterWireMessages();
  malformedCallMessages.push({ role: "assistant", content: "", tool_calls: "not-an-array" });
  const malformedCall = evaluate({ llmRecords: [beforeRecord(), afterRecord({ messages: malformedCallMessages })] });
  assert.equal(malformedCall.checks.C5_next_request_compact.ok, false);
  assert.equal(malformedCall.checks.C5_next_request_compact.reason, "next_request_wire_malformed");
  assert.equal(malformedCall.checks.C5_next_request_compact.detail.checks[0].malformed_calls, 1);
  assert(malformedCall.failed.includes("C5_next_request_compact"));

  const malformedResultMessages = afterWireMessages();
  malformedResultMessages.push({ role: "tool", content: JSON.stringify({ type: "observation", status: "ok" }) });
  const malformedResult = evaluate({ llmRecords: [beforeRecord(), afterRecord({ messages: malformedResultMessages })] });
  assert.equal(malformedResult.checks.C5_next_request_compact.ok, false);
  assert.equal(malformedResult.checks.C5_next_request_compact.reason, "next_request_wire_malformed");
  assert.equal(malformedResult.checks.C5_next_request_compact.detail.checks[0].malformed_tool_messages, 1);
});

test("G6 multi-turn 反例：缺 steer 或未 resume → C11 fail（不放宽）", () => {
  const noSteer = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [],
      resumes: [],
      rounds: [],
      stop_reason: "steer_budget_exhausted",
      max_steers: 6,
      checkpoint_events: 0,
    },
  });
  assert.equal(noSteer.checks.C11_multi_turn_same_run.ok, false);
  assert(noSteer.failed.includes("C11_multi_turn_same_run"));

  const noResume = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: {
            question_text: "请确认要看哪一章的正文与章计划？",
            answer_source: "option",
            answer_text: "选项A",
          },
        },
      ],
      resumes: [{ index: 1, resumed: false, status: "awaiting_author" }],
      rounds: [],
      stop_reason: "resume_failed",
      max_steers: 6,
      checkpoint_events: 0,
    },
  });
  assert.equal(noResume.checks.C11_multi_turn_same_run.ok, false);
  assert(noResume.failed.includes("C11_multi_turn_same_run"));
});

test("G6 跨 turn 正例：首 run 结束后补发 turn 推进 + 选项观察 → C11 pass（cross_turn）", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          kind: "choice",
          label: "保留悬念",
          observation: {
            question_text: "",
            option_titles: ["保留悬念", "当章收束"],
            answer_source: "option",
            answer_text: "保留悬念",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "completed" }],
      rounds: [{ index: 1, pause_kind: "terminal", exchange_facts: { complete_exchanges: 3 } }],
      extra_rounds: [
        { round: 1, index: 2, run_status: "completed", checkpoint_events_after: 0 },
        { round: 2, index: 3, run_status: "failed", checkpoint_events_after: 1 },
      ],
      stop_reason: "run_terminal",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, true);
  assert.equal(result.checks.C11_multi_turn_same_run.detail.scenario, "cross_turn");
  assert(!result.failed.includes("C11_multi_turn_same_run"));
});

test("G6 跨 turn 反例：无推进 turn 或回答未观察 → C11 fail（不放宽）", () => {
  const noAdvanced = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: {
            question_text: "",
            option_titles: ["保留悬念", "当章收束"],
            answer_source: "option",
            answer_text: "保留悬念",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "completed" }],
      extra_rounds: [{ round: 1, index: 2, run_status: "running" }],
      stop_reason: "run_terminal",
      checkpoint_events: 0,
    },
  });
  assert.equal(noAdvanced.checks.C11_multi_turn_same_run.ok, false);
  assert(noAdvanced.failed.includes("C11_multi_turn_same_run"));

  const noObservation = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: { question_text: "", option_titles: [], answer_source: "fallback", answer_text: "按你的判断继续。" },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "completed" }],
      extra_rounds: [{ round: 1, index: 2, run_status: "completed" }],
      stop_reason: "run_terminal",
      checkpoint_events: 1,
    },
  });
  assert.equal(noObservation.checks.C11_multi_turn_same_run.ok, false);
  assert(noObservation.failed.includes("C11_multi_turn_same_run"));
});


test("BEAM静止重启：同次来源资格/全部原文和事件不变、真实调用时间窗无新增", () => {
  const scenario = maintenanceRecoveryFacts();
  const before = scenario.facts.afterFailure, after = structuredClone(before);
  after.captured_at = "2026-11-04T10:08:00.000Z";
  const records = [{ ts: "2026-11-04T10:06:10.000Z" }, { ts: "2026-11-04T10:10:00.000Z" }];
  const trace = { recovery_scope: "owned_beam_backend_quiescent", provider_calls_before: 1, provider_calls_after: 1,
    receipt: { previous_backend_pid: 100, backend_pid: 200, database: {path:"/owned/db",dev:1,ino:7} } };
  const args = () => verifyBackendRestartFacts(trace, before, after, records, ["prun-failed-d"]);
  assert.equal(args().ok, true);
  assert.equal(args().active_task_recovery_signed, false);
  for (const [name, mutate] of [
    ["原话改变", (s) => { s.after.authoring_session_messages[1].message += " "; }],
    ["来源资格丢失", (s) => { s.after.provider_runs[0].owner_refs = {}; }],
    ["重启期间实调", (s) => { s.records.push({ts:"2026-11-04T10:07:30.000Z"}); }],
    ["调用时间缺失", (s) => { delete s.records[0].ts; }],
    ["报告伪零", (s) => { s.trace.provider_calls_after = 0; }],
    ["来源快照均遗漏", (s) => { s.before.provider_runs = []; s.after.provider_runs = []; }],
  ]) {
    const s = structuredClone({before,after,records,trace});
    mutate(s);
    assert.throws(() => verifyBackendRestartFacts(s.trace, s.before, s.after, s.records, ["prun-failed-d"]), name);
  }
});

test("R03 C8 目标反例：没有原响应持久载荷，新来源成功也不能代签恢复", () => {
  const s = maintenanceRecoveryFacts();
  for (const snapshot of [s.facts.afterFailure, s.facts.afterRecovery, s.db])
    for (const run of snapshot.provider_runs) delete run.operation_checkpoint;
  const check = verifyMaintenanceRecoveryFacts(s.injection, s.db, s.records, s.appLog, s.facts);
  assert.equal(check.ok, false, "仅新来源成功却被误判为原D摘要恢复");
});

// Independent literal v2 lines; no product fragmenter or response generator is used.
function v2RecoveryFacts() {
  const s = maintenanceRecoveryFacts();
  const text = "暂定方案\r\n仍欠风险表\r请作者确认\n末行";
  const raw = '{"version":"authoring-discussion-summary/v2","entries":[{"source_index":0,"summary":"原建议仍待确认","retained_fragment_indices":[1,2]}]}';
  const hash = createHash("sha256").update(raw).digest("hex");
  for (const snapshot of [s.facts.before, s.facts.afterFailure, s.facts.beforeRestart,
    s.facts.afterRestart, s.facts.afterRecovery, s.db]) {
    for (const row of snapshot.authoring_session_messages) {
      const message = JSON.parse(row.message);
      if (row.run_id === "source-d" && row.role === "assistant") message.blocks = [{type:"text", text}];
      for (const block of message.blocks) if (block.discussion?.provider_run_ref === "prun-failed-d")
        Object.assign(block.discussion, {response_text:raw, response_sha256:hash});
      row.message = JSON.stringify(message);
    }
    for (const run of snapshot.provider_runs) if (run.id === "prun-failed-d" && run.operation_checkpoint)
      Object.assign(run.operation_checkpoint, {version:"provider-operation-checkpoint/v2",
        discussion_protocol_version:"authoring-discussion-summary/v2", response_text:raw});
    for (const output of snapshot.provider_outputs) if (output.provider_run_id === "prun-failed-d")
      output.content_summary.content_sha256 = hash;
  }
  s.records[0].request.body.messages[0].content = "output_protocol_version: authoring-discussion-summary/v2";
  const base = s.records[0].request.body.messages[1];
  const material = JSON.parse(base.content.slice(base.content.indexOf("\n")+1));
  delete material.sources[0].text;
  material.sources[0].fragments = [
    {fragment_index:0,text:"暂定方案\r\n"}, {fragment_index:1,text:"仍欠风险表\r"},
    {fragment_index:2,text:"请作者确认\n"}, {fragment_index:3,text:"末行"}
  ];
  base.content = base.content.slice(0,base.content.indexOf("\n")+1)+JSON.stringify(material);
  return s;
}

test("R03 C8 v2：完整行材料与数据库JSON文本null清载荷均可核验", () => {
  const s = v2RecoveryFacts();
  for (const snapshot of [s.facts.afterRecovery, s.db])
    snapshot.provider_runs.find(run => run.id === "prun-failed-d").operation_checkpoint = "null";
  const result = verifyMaintenanceRecoveryFacts(s.injection,s.db,s.records,s.appLog,s.facts);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("R03 C8 v2：声明、精确片段与严格清载荷反例", () => {
  const material = (s, mutate) => {
    const base=s.records[0].request.body.messages[1], prefix=base.content.indexOf("\n")+1;
    const value=JSON.parse(base.content.slice(prefix)); mutate(value.sources[0]);
    base.content=base.content.slice(0,prefix)+JSON.stringify(value);
  };
  const capsule = (s, mutate) => {
    for (const snapshot of [s.facts.afterFailure,s.facts.beforeRestart,s.facts.afterRestart])
      mutate(snapshot.provider_runs.find(run=>run.id==="prun-failed-d").operation_checkpoint);
  };
  for (const [name, mutate] of [
    ["missing declaration", s=>{s.records[0].request.body.messages.shift();}],
    ["duplicate declaration", s=>{s.records[0].request.body.messages[0].content += "\noutput_protocol_version: authoring-discussion-summary/v2";}],
    ["conflicting declaration", s=>{s.records[0].request.body.messages[0].content += "\noutput_protocol_version: authoring-discussion-summary/v1";}],
    ["capsule missing version", s=>capsule(s,c=>delete c.discussion_protocol_version)],
    ["capsule mismatch", s=>capsule(s,c=>c.discussion_protocol_version="authoring-discussion-summary/v1")],
    ["response mismatch", s=>capsule(s,c=>c.response_text=c.response_text.replace("summary/v2","summary/v1"))],
    ["unknown plan key", s=>capsule(s,c=>c.plan.extra=true)],
    ...["covers","source_refs","versions","omissions","summary"].map(key=>
      ["missing plan "+key,s=>capsule(s,c=>delete c.plan[key])]),
    ["duplicate output", s=>{
      for(const snap of [s.facts.afterFailure,s.facts.beforeRestart,s.facts.afterRestart])
        snap.provider_outputs.push(structuredClone(snap.provider_outputs[0]));
    }],
    ["output hash mismatch", s=>{
      for(const snap of [s.facts.afterFailure,s.facts.beforeRestart,s.facts.afterRestart])
        snap.provider_outputs[0].content_summary.content_sha256="0".repeat(64);
    }],
    ["source coordinate changed", s=>material(s,m=>m.source.run_sequence=5)],
    ["author bytes changed", s=>material(s,m=>m.author_text+="改")],
    ["duplicate request", s=>s.records.push(structuredClone(s.records[0]))],
    ["missing fragments", s=>material(s,m=>delete m.fragments)],
    ["reordered fragments", s=>material(s,m=>m.fragments.reverse())],
    ["bad fragment index", s=>material(s,m=>m.fragments[1].fragment_index=0)],
    ["newline changed", s=>material(s,m=>m.fragments[0].text="暂定方案\n")],
    ["extra text", s=>material(s,m=>m.text="另一份原文")],
    ["wrong call", s=>{s.records[0].provider_call_ref="foreign";}],
    ["unfinished source", s=>{for(const snap of [s.facts.before,s.facts.afterFailure,s.facts.beforeRestart,s.facts.afterRestart,s.facts.afterRecovery,s.db]) snap.agent_runs.find(r=>r.id==="source-d").status="running";}],
    ["dispatch outside window", s=>{for(const snap of [s.facts.afterFailure,s.facts.beforeRestart,s.facts.afterRestart]) snap.provider_events[0].emitted_at="2026-11-04T10:08:00.000Z";}],
    ...[false,{},[],undefined,"false","{}","bad json"].map(value=>["not cleared "+String(value),s=>{
      for(const snap of [s.facts.afterRecovery,s.db]) snap.provider_runs[0].operation_checkpoint=value;
    }])
  ]) {
    const s=v2RecoveryFacts(); mutate(s);
    const result=verifyMaintenanceRecoveryFacts(s.injection,s.db,s.records,s.appLog,s.facts);
    assert.equal(result.ok,false,name+":"+JSON.stringify(result));
  }
});

test("R03 C8：D 原摘要跨进程保留，由新run原样提交且无第二次摘要调用", () => {
  const scenario = maintenanceRecoveryFacts();
  const result = verifyMaintenanceRecoveryFacts(scenario.injection, scenario.db, scenario.records, scenario.appLog, scenario.facts);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.detail.failed_attempt_ids, ["prun-failed-d"]);
  assert.equal(result.detail.recovery_checkpoint_count, 1);
  assert.equal(result.detail.canonical_originals_preserved, true);
  assert.equal(result.detail.failed_source_redispatched, false);
});

test("R03 C8：缺快照、错作者、原响应或计划改变、重复调用及假恢复均拒绝", () => {
  const cases = [
    ["缺快照", (s) => { s.facts.afterFailure = null; }],
    ["故障用户提示未知", (s) => { s.injection.author_error_visible = null; }],
    ["故障暴露给作者", (s) => { s.injection.author_error_visible = true; }],
    ["失败的主run", (s) => { s.db.agent_runs.find((run) => run.id === "failed-d").status = "failed"; }],
    ["故障日志错run", (s) => { s.appLog[0].run_id = "elsewhere"; }],
    ["故障日志错原因", (s) => { s.appLog[0].reason = ":other"; }],
    ["计数null", (s) => { s.injection.checkpoint_events_after_failure = null; }],
    ["故障有逃逸checkpoint", (s) => { s.facts.afterFailure.agent_events.push({event_type: "checkpoint_created"}); }],
    ["固定输入少一条", (s) => { s.injection.recovery_requests.pop(); }],
    ["原作者改字节", (s) => { s.facts.recoveryInputs[0].text += "改"; }],
    ["跨作品", (s) => { s.facts.scope.work_id = "foreign"; }],
    ["snapshot原文改变", (s) => { s.facts.afterFailure.authoring_session_messages[1].message += " "; }],
    ["摘要材料改字节", (s) => { s.records[0].request.body.messages.find(message => message.role === "user" && message.content.startsWith("【应用数据 · application_base")).content = s.records[0].request.body.messages.find(message => message.role === "user" && message.content.startsWith("【应用数据 · application_base")).content.replace("仍欠风险表", "风险表已完成"); }],
    ["失败执行元数据丢失", (s) => { s.db.provider_runs.find((run) => run.id === "prun-failed-d").owner_refs = {}; }],
    ["故障无实际dispatch", (s) => { s.facts.afterFailure.provider_events = []; }],
    ["故障输出缺失", (s) => { s.facts.afterFailure.provider_outputs = []; }],
    ["同源重发", (s) => { const run = structuredClone(s.db.provider_runs.find((run) => run.id === "prun-failed-d")); run.id = "retry"; run.provider_call_ref = "retry-call"; s.db.provider_runs.push(run); }],
    ["资格坐标与实际请求来源不一致", (s) => {
      for (const snapshot of [s.facts.afterFailure, s.facts.beforeRestart, s.facts.afterRestart, s.facts.afterRecovery, s.db])
        snapshot.provider_runs.find((run) => run.id === "prun-failed-d").owner_refs.discussion_source_keys = ["unrelated-source"];
    }],
    ["载荷没有原文", (s) => { delete s.facts.afterFailure.provider_runs[0].operation_checkpoint.response_text; }],
    ["仅hash无原文", (s) => { s.facts.afterFailure.provider_runs[0].operation_checkpoint = null; }],
    ["重启前丢原文", (s) => { s.facts.beforeRestart.provider_runs[0].operation_checkpoint = null; }],
    ["重启后丢原文", (s) => { s.facts.afterRestart.provider_runs[0].operation_checkpoint = null; }],
    ["缺重启快照", (s) => { delete s.facts.afterRestart; }],
    ["响应字节改变", (s) => { s.facts.afterFailure.provider_runs[0].operation_checkpoint.response_text += " "; }],
    ["冻结覆盖改变", (s) => { s.facts.afterFailure.provider_runs[0].operation_checkpoint.plan.covers.message_refs.pop(); }],
    ["载荷未清除", (s) => { s.db.provider_runs[0].operation_checkpoint = structuredClone(s.facts.afterFailure.provider_runs[0].operation_checkpoint); }],
    ["快照与最终库不一致", (s) => { s.facts.afterRecovery.provider_runs[0].operation_checkpoint = structuredClone(s.facts.afterFailure.provider_runs[0].operation_checkpoint); }],
    ["原目标改变", (s) => { s.facts.afterFailure.agent_runs.find((run) => run.id === "failed-d").goal_version = 2; }],
    ["事件错提交方", (s) => { s.facts.afterRecovery.agent_events[0].run_id = "failed-d"; }],
    ["事件数量伪造", (s) => { s.facts.afterRecovery.agent_events[0].payload.covered_counts.discussion_messages = 7; }],
    ["只新来源成功", (s) => {
      for (const snapshot of [s.db, s.facts.afterRecovery]) {
        const row = snapshot.authoring_session_messages.find((row) => row.role === "checkpoint");
        const message = JSON.parse(row.message); message.blocks[0].discussion.provider_run_ref = "new-provider";
        row.message = JSON.stringify(message);
      }
    }],
    ["恢复无checkpoint", (s) => { s.db.authoring_session_messages = s.db.authoring_session_messages.filter((row) => row.role !== "checkpoint"); }],
    ["恢复无事件", (s) => { s.facts.afterRecovery.agent_events = []; }],
  ];
  for (const [name, mutate] of cases) for (const fixture of [maintenanceRecoveryFacts, v2RecoveryFacts]) {
    const scenario = fixture();
    mutate(scenario);
    const check = verifyMaintenanceRecoveryFacts(scenario.injection, scenario.db, scenario.records, scenario.appLog, scenario.facts);
    assert.equal(check.ok, false, name + ": " + JSON.stringify(check));
  }
});

test("跨 run A3 场景：C11 不判（ok=null，不进 required）", () => {
  const result = evaluate();
  assert.equal(result.checks.C11_multi_turn_same_run.ok, null);
  assert(!result.required.includes("C11_multi_turn_same_run"));
});

test("G6 multi-turn 反例：回答全为 fallback（未基于真实问题观察）→ C11 fail", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: {
            question_text: "请确认要看哪一章的正文与章计划？",
            answer_source: "fallback",
            answer_text: "按你的判断继续。",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "running" }],
      rounds: [],
      stop_reason: "triggered",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, false);
  assert.equal(result.checks.C11_multi_turn_same_run.reason, "multi_turn_not_observation_driven");
  assert(result.failed.includes("C11_multi_turn_same_run"));
});

test("G6 multi-turn 反例：缺少问题文本绑定 → C11 fail", () => {
  const result = evaluate({
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [{ index: 1, ok: true, observation: { question_text: "", answer_source: "extracted_text" } }],
      resumes: [{ index: 1, resumed: true, status: "running" }],
      rounds: [],
      stop_reason: "triggered",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, false);
  assert.equal(result.checks.C11_multi_turn_same_run.reason, "multi_turn_not_observation_driven");
});
