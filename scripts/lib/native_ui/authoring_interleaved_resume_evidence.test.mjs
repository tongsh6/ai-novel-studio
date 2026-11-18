import assert from "node:assert/strict";
import test from "node:test";
import { inFlightSummaryForRun, verifyCancelledRunFacts, verifyInterleavedResumeFacts } from "./authoring_interleaved_resume_evidence.mjs";
import { CALL_ID, RUN, RECOVERY_RUN, OTHER_SESSION, interleavedResumeFacts } from "./fixtures/authoring_auto_maintenance_facts.mjs";


function cancellationScenario() {
  const original = interleavedResumeFacts();
  const before = structuredClone(original.options.waitingSnapshot);
  const run = before.agent_runs.find((row) => row.id === RUN);
  run.status = "running";
  before.captured_at = "2026-11-04T10:00:00.100Z";
  before.provider_runs = [{ id: "cancel-provider", provider_call_ref: "cancel-call",
    agent_run_id: RUN, session_id: run.session_id, workspace_id: run.workspace_id,
    work_id: run.work_id, status: "running", purpose: "other", owner_refs: { operation: "transcript_compaction" } }];
  before.provider_outputs = [];
  before.provider_runs[0].parent_turn_ref = run.parent_turn_ref;
  before.provider_events = [
    { sequence: 1, event_type: "started", emitted_at: "2026-11-04T10:00:00.000Z", payload: {} },
    { sequence: 2, event_type: "progress", emitted_at: null, inserted_at: "2026-11-04T10:00:00.020Z", payload: { phase: "request_dispatched" } },
    { sequence: 3, event_type: "chunk", emitted_at: null, inserted_at: "2026-11-04T10:00:00.050Z", payload: { content_length: 12 } },
  ].map((event) => ({ ...event, provider_run_id: "cancel-provider", provider_call_ref: "cancel-call", agent_run_id: RUN }));
  const confirmation = structuredClone(before);
  confirmation.captured_at = "2026-11-04T10:00:00.150Z";
  const afterCancel = structuredClone(before);
  afterCancel.agent_runs.find((row) => row.id === RUN).status = "cancelled";
  afterCancel.provider_runs[0].status = "cancelled";
  afterCancel.captured_at = "2026-11-04T10:00:00.500Z";
  const restored = structuredClone(afterCancel);
  restored.captured_at = "2026-11-04T10:00:00.700Z";
  const author = { text: "先核对第一章。" };
  const probe = { request: { run_id: RUN, text: author.text }, recovery_scope: "owned_tauri_client",
    command_run_id: RUN, command_ref: "cancel-ref", command_sent_at: "2026-11-04T10:00:00.200Z",
    reply_at: "2026-11-04T10:00:00.300Z", reply_status: "ok", terminal_at: "2026-11-04T10:00:00.400Z",
    terminal_status: "cancelled", client_relaunch_at: "2026-11-04T10:00:00.600Z" };
  const topic = "workspace:" + run.workspace_id;
  const wire = [
    { direction: "sent", at: probe.command_sent_at, frame: ["join", probe.command_ref, topic, "agent_command", { run_id: RUN, command: "cancel" }] },
    { direction: "received", at: probe.reply_at, frame: ["join", probe.command_ref, topic, "phx_reply",
      { status: "ok", response: { received: true, run_id: RUN, command: "cancel" } }] },
  ];
  probe.summary_target = { provider_run_ref: "cancel-provider", provider_call_ref: "cancel-call",
    dispatched_at: "2026-11-04T10:00:00.020Z", chunk_at: "2026-11-04T10:00:00.050Z",
    observed_at: "2026-11-04T10:00:00.080Z" };
  probe.confirmation_target_checked_at = "2026-11-04T10:00:00.170Z";
  return { probe, db: structuredClone(restored), wire, options: { before, confirmation, afterCancel, afterClientRelaunch: restored,
    author, scope: { work_id: run.work_id, session_id: run.session_id } } };
}

test("唯一在途摘要：dispatch 和真实非空 chunk 必须同执行、同 scope 且未终止", () => {
  const s = cancellationScenario(), { before, scope } = s.options;
  const selection = { runId: RUN, workId: scope.work_id, sessionId: scope.session_id };
  const expected = { provider_run_ref: "cancel-provider", provider_call_ref: "cancel-call",
    dispatched_at: "2026-11-04T10:00:00.020Z", chunk_at: "2026-11-04T10:00:00.050Z" };
  assert.deepEqual(inFlightSummaryForRun(before, selection), expected);
  const serialized = structuredClone(before);
  serialized.provider_events.forEach((event) => { event.payload = JSON.stringify(event.payload); });
  assert.deepEqual(inFlightSummaryForRun(serialized, selection), expected);
  const missing = [
    (db) => { db.agent_runs.find((row) => row.id === RUN).status = "completed"; },
    (db) => { db.provider_runs[0].status = "completed"; },
    (db) => { db.provider_events = db.provider_events.slice(0, 1); },
    (db) => { db.provider_events[1].payload.phase = "request_prepared"; },
    (db) => { db.provider_events[2].payload.content_length = 0; },
    (db) => { db.provider_events[2].payload.content_length = "12"; },
    (db) => { db.provider_events[2].inserted_at = "2026-11-04T09:59:00Z"; },
    (db) => { db.provider_outputs.push({ provider_run_id: "cancel-provider" }); },
    ...["final_output", "error", "cancel_requested", "cancelled"].map((event_type) => (db) =>
      db.provider_events.push({ ...db.provider_events[2], event_type, sequence: 4 })),
  ];
  for (const mutate of missing) {
    const db = structuredClone(before); mutate(db);
    assert.equal(inFlightSummaryForRun(db, selection), null);
  }
  for (const mutate of [
    (db) => { db.provider_runs[0].work_id = "foreign"; },
    (db) => { db.provider_events[2].provider_call_ref = "foreign"; },
    (db) => { db.provider_events.push({ ...db.provider_events[1] }); },
    (db) => {
      db.provider_runs.push({ ...db.provider_runs[0], id: "second", provider_call_ref: "second-call" });
      db.provider_events.push(...db.provider_events.map((event) => ({ ...event, provider_run_id: "second", provider_call_ref: "second-call" })));
    },
  ]) {
    const db = structuredClone(before); mutate(db);
    assert.throws(() => inFlightSummaryForRun(db, selection));
  }
});

test("持久事件时间而非可选 emitted_at 决定资格，微秒倒序与缺证拒绝", () => {
  const { before, scope } = cancellationScenario().options;
  const selection = { runId: RUN, workId: scope.work_id, sessionId: scope.session_id };
  before.provider_events[1].inserted_at = "2026-11-04T10:00:00.050001Z";
  before.provider_events[2].inserted_at = "2026-11-04T10:00:00.050002Z";
  const target = inFlightSummaryForRun(before, selection);
  assert.equal(target.chunk_at, "2026-11-04T10:00:00.050002Z");
  for (const emitted_at of [null, "2026-11-04T11:00:00.000Z", "bad"]) {
    const db = structuredClone(before);
    db.provider_events.forEach((event) => { event.emitted_at = emitted_at; });
    assert.deepEqual(inFlightSummaryForRun(db, selection), target);
  }
  for (const mutate of [
    (db) => { delete db.provider_events[1].inserted_at; },
    (db) => { db.provider_events[2].inserted_at = null; },
    (db) => { db.provider_events[2].inserted_at = "bad"; },
    (db) => { db.provider_events[2].inserted_at = "2026-11-04T10:00:00.050000Z"; },
    (db) => { db.provider_events[1].sequence = 4; },
  ]) {
    const db = structuredClone(before); mutate(db);
    assert.equal(inFlightSummaryForRun(db, selection), null);
  }
  const duplicate = structuredClone(before);
  duplicate.provider_events.push({ ...duplicate.provider_events[2], payload: { content_length: 0 } });
  assert.throws(() => inFlightSummaryForRun(duplicate, selection), /sequence/);
});

test("真实摘要取消：命令/ACK/在途摘要Provider/终态/客户端恢复均需独立事实", () => {
  const s = cancellationScenario();
  const result = verifyCancelledRunFacts(s.probe, s.db, s.wire, s.options);
  assert.equal(result.ok, true);
  assert.equal(result.summary_cancellation.ok, true);
  assert.equal(result.backend_recovery_signed, false);
});

test("取消反例：受理未终止/他run或topic/无忙碌事实/原文或事件改变拒绝", () => {
  const cases = [
    ["accepted only", (s) => { s.options.afterCancel.agent_runs.find((row) => row.id === RUN).status = "running"; }],
    ["foreign topic", (s) => { s.wire[0].frame[2] = "workspace:foreign"; }],
    ["foreign ACK", (s) => { s.wire[1].frame[4].response.run_id = RECOVERY_RUN; }],
    ["duplicate ACK", (s) => { s.wire.push(structuredClone(s.wire[1])); }],
    ["not busy", (s) => { s.options.before.provider_runs[0].status = "completed"; }],
    ["business call only", (s) => { s.options.before.provider_runs[0].owner_refs = {}; }],
    ["summary not cancelled", (s) => { s.options.afterCancel.provider_runs[0].status = "completed"; }],
    ["no dispatch", (s) => { s.options.before.provider_events = []; }],
    ["no real chunk", (s) => { s.options.before.provider_events.pop(); }],
    ["completed before confirmation", (s) => { s.options.confirmation.provider_runs[0].status = "completed"; }],
    ["target replaced", (s) => { s.probe.summary_target.provider_run_ref = "other-summary"; }],
    ["confirmation after command", (s) => { s.probe.confirmation_target_checked_at = "2026-11-04T10:00:00.250Z"; }],
    ["wrong original", (s) => { s.options.author.text += "改"; }],
    ["lost original", (s) => { s.options.afterCancel.authoring_session_messages.pop(); }],
    ["escaped checkpoint", (s) => { s.options.afterCancel.agent_events.push({run_id:RUN,event_type:"checkpoint_created"}); }],
    ["restart duplicate", (s) => { s.options.afterClientRelaunch.agent_events.push({id:"duplicate"}); }],
  ];
  for (const [name, mutate] of cases) {
    const s = cancellationScenario();
    mutate(s);
    assert.throws(() => verifyCancelledRunFacts(s.probe, s.db, s.wire, s.options), name);
  }
});

test("交错恢复：同次 Scope、原答复、折叠范围及保留观察由各自来源闭合", () => {
  const scenario = interleavedResumeFacts();
  const result = verifyInterleavedResumeFacts(
    scenario.trace, scenario.db, scenario.wire, scenario.llmRecords, scenario.options,
  );
  assert.equal(result.ok, true);
  assert.equal(result.waiting_run_id, RUN);
  assert.equal(result.later_run_id, RECOVERY_RUN);
  assert.equal(result.goal_version, 2);
  assert.equal(result.provider_call_ref, "pcall-after");
  assert.deepEqual(result.covered_call_ids, []);
  assert(result.covered_message_refs.some((ref) => ref.role === "assistant" && ref.run_id === "early"));
  assert.equal(result.waiting_history_protected, true);
  assert.equal(scenario.wire[0].frame[4].agent_run.status, "running");
  assert.equal(result.retained_exchanges, 2);
  assert.equal(result.exact_author_messages, 4);
  assert.equal(result.observations_with_refs, 2);
  assert.equal(result.observations_with_versions, 1);
});

test("交错恢复：来源、原字节或请求证据被替换时失败关闭", () => {
  const cases = [
    ["冻结原文与实际作者不同", (s) => { s.options.controls[0].text += "改"; }],
    ["冻结 warmup 顺序/原文不同", (s) => { s.options.warmupAuthors[0].text += "改"; }],
    ["回答 wire 原话改字节", (s) => { s.wire[1].frame[4].action.payload.text = s.wire[1].frame[4].action.payload.text.trim(); }],
    ["B 试图覆盖活跃 A 的闭合交换", (s) => {
      for (const db of [s.db, s.options.beforeAnswerSnapshot]) {
        const row = db.authoring_session_messages.find((item) => item.run_id === RECOVERY_RUN && item.role === "checkpoint");
        const message = JSON.parse(row.message);
        message.blocks[0].covers.call_ids = [CALL_ID];
        message.blocks[0].source_refs.push("source-1");
        row.message = JSON.stringify(message);
      }
    }],
    ["A 原问题已关闭", (s) => { s.options.beforeAnswerSnapshot.agent_runs.find((run) => run.id === RUN).status = "completed"; }],
    ["B 结果先交付但仍运行", (s) => { s.options.beforeAnswerSnapshot.agent_runs.find((run) => run.id === RECOVERY_RUN).status = "running"; }],
    ["B 只有预测完成结果", (s) => { s.wire[0].frame[4].agent_run.status = "completed"; s.options.beforeAnswerSnapshot.agent_runs.find((run) => run.id === RECOVERY_RUN).status = "running"; }],
    ["B 未交付业务结果", (s) => { s.wire[0].frame[3] = "other"; }],
    ["B 结果属于错 run", (s) => { s.wire[0].frame[4].agent_run.run_id = "foreign"; }],
    ["等待snapshot篡改原话", (s) => { s.options.waitingSnapshot.authoring_session_messages[1].message += " "; }],
    ["缺早期已完成来源", (s) => { s.trace.warmup_run_ids = []; }],
    ["等待问题被请求遗漏", (s) => { s.llmRecords[0].request.body.messages = s.llmRecords[0].request.body.messages.filter((m) => m.role !== "assistant" || m.tool_calls?.length); }],
    ["保留工具参数被改", (s) => { s.llmRecords[0].request.body.messages.find((m) => m.tool_calls?.[0]?.id === CALL_ID).tool_calls[0].function.arguments = '{"scope":"wrong"}'; }],
    ["无 canonical Scope", (s) => {
      s.db.authoring_session_messages = s.db.authoring_session_messages
        .filter((row) => row.role !== "scope_update");
    }],
    ["Scope 伪作者", (s) => {
      const row = s.db.authoring_session_messages.find((entry) => entry.role === "scope_update");
      const message = JSON.parse(row.message);
      message.provenance = "author";
      row.message = JSON.stringify(message);
    }],
    ["历史 text 不升级为当前 Scope", (s) => {
      const row = s.db.authoring_session_messages.find((entry) => entry.role === "scope_update");
      const message = JSON.parse(row.message);
      message.blocks = [{ type: "text", text: "探索预算关闭" }];
      row.message = JSON.stringify(message);
    }],
    ["请求篡改版本", (s) => {
      const scope = s.llmRecords[0].request.body.messages.at(-1);
      const lines = scope.content.split("\n");
      lines[1] = '版本：{"goal":3,"scope_revision":1}';
      scope.content = lines.join("\n");
    }],
    ["请求丢失 Scope", (s) => s.llmRecords[0].request.body.messages.pop()],
    ["错误 provider pair", (s) => { s.llmRecords[0].provider_run_ref = "foreign"; }],
    ["作者原文被 trim", (s) => {
      const messages = s.llmRecords[0].request.body.messages;
      messages.at(-2).content = messages.at(-2).content.trim();
    }],
    ["保留观察缺失", (s) => {
      const request = s.llmRecords[0].request.body;
      request.messages = request.messages.filter((message) => message.role !== "tool");
    }],
    ["后续 run 不是同一会话", (s) => { s.db.agent_runs[1].session_id = OTHER_SESSION; }],
    ["回答前未观察到 B 完成", (s) => { s.wire[0].at = "2026-11-04T10:00:03.000Z"; }],
    ["回复归属错误目标版本", (s) => { s.wire[1].frame[4].action.payload.expected_goal_version = 2; }],
    ["首次恢复请求多义", (s) => {
      s.db.provider_events.push({ ...s.db.provider_events.at(-1), id: "duplicate-start" });
    }],
  ];
  for (const [name, mutate] of cases) {
    const scenario = interleavedResumeFacts();
    mutate(scenario);
    assert.throws(() => verifyInterleavedResumeFacts(
      scenario.trace, scenario.db, scenario.wire, scenario.llmRecords, scenario.options,
    ), name);
  }
});
