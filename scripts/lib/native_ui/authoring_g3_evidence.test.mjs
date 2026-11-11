// B82 §7 G3 recovery 判据回归：只构造判据输入，不启动产品、不读真实档案、不冒充实模。
import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORING_REQUEST_IR } from "./authoring_request_facts.mjs";
import {
  G3_NOT_SIGNED,
  G3_SIGNED_SCOPE,
  g3RecoveryEvidence,
} from "./authoring_g3_evidence.mjs";

const AUTHOR_TEXT = "请只读第2章已保存正文的开头两段，用两点告诉我主角看见了什么。先不写新稿。";
const CALL_ID = "call-g3-1";
const SOURCE_PCALL = "pcall-g3-source";
const SOURCE_PRUN = "prun-g3-source";
const NEXT_PCALL = "pcall-g3-next";
const NEXT_PRUN = "prun-g3-next";
const THIRD_PCALL = "pcall-g3-third";
const THIRD_PRUN = "prun-g3-third";
const REASON = "judgment_semantic_conflict";
const DETAIL = { message: "模型参数不合法：action 与字段不匹配" };

const message = (role, provenance, blocks, extra = {}) => ({
  role,
  provenance,
  blocks,
  source_refs: [],
  versions: {},
  ...extra,
});
const text = (value) => ({ type: "text", text: value });
const app = () => message("application_base", "application", [text("【应用数据 · application_base】冻结基线与 scope")]);
const author = () => message("user", "author", [text(AUTHOR_TEXT)]);
const pseudoCorrection = () => message("user", "author", [text("上一步校验失败，请按提示重试。")]);
const tool = (payload) => message("tool", "tool_result", [payload]);

const failedResult = () => ({
  type: "validation_result",
  call_id: CALL_ID,
  status: "failed",
  reason_code: REASON,
  detail: DETAIL,
});

function assistantCall({
  callId = CALL_ID,
  pcall = SOURCE_PCALL,
  prun = SOURCE_PRUN,
  name = "judgment_decision",
} = {}) {
  return message("assistant", "model", [{
    type: "tool_call",
    call_id: callId,
    name,
    arguments: { action: "execute" },
  }], { provider_call_ref: pcall, provider_run_ref: prun });
}

function record({ pcall, prun, messages }) {
  return {
    request_format: AUTHORING_REQUEST_IR,
    provider_call_ref: pcall,
    provider_run_ref: prun,
    request_body: {
      ir_version: AUTHORING_REQUEST_IR,
      messages,
      tools: [],
      run: {},
      projection: {},
      refs: {},
    },
  };
}

const start = (pcall, prun) => ({ provider_run_id: prun, provider_call_ref: pcall });

function fixture(overrides = {}) {
  const sourceMessages = overrides.sourceMessages ?? [app(), author()];
  const nextMessages = overrides.nextMessages ?? [
    ...sourceMessages,
    assistantCall(),
    tool(failedResult()),
  ];
  const transcriptMessages = overrides.transcriptMessages ?? [...nextMessages];
  const starts = overrides.starts ?? [
    start(SOURCE_PCALL, SOURCE_PRUN),
    start(NEXT_PCALL, NEXT_PRUN),
  ];
  const records = overrides.records ?? [
    record({ pcall: SOURCE_PCALL, prun: SOURCE_PRUN, messages: sourceMessages }),
    record({ pcall: NEXT_PCALL, prun: NEXT_PRUN, messages: nextMessages }),
  ];
  return {
    transcript: overrides.transcript ?? { messages: transcriptMessages },
    records,
    starts,
    authorText: AUTHOR_TEXT,
    authority: { production_write: false, allowed_tools: ["judgment"] },
    budget: { max_provider_calls: 5 },
    consumed: { provider_calls: starts.length },
    status: "completed",
    pending: [],
    ...overrides,
  };
}

function reportOf(overrides = {}) {
  return g3RecoveryEvidence(fixture(overrides));
}

const hasReason = (report, reason) =>
  report.failures.some((failure) => failure.reason === reason);

test("真正失败的 validation_result 在紧邻同 call ID/同 payload 的下一请求回流时通过", () => {
  const report = reportOf();

  assert.equal(report.ok, true);
  assert.equal(report.reason, null);
  assert.deepEqual(report.failures, []);
  assert.equal(report.signed_scope, G3_SIGNED_SCOPE);
  assert.deepEqual(report.not_signed, [...G3_NOT_SIGNED]);
  assert.equal(report.refs.recoveries.length, 1);
  const recovery = report.refs.recoveries[0];
  assert.equal(recovery.call_id, CALL_ID);
  assert.equal(recovery.reason_code, REASON);
  assert.equal(recovery.source.started_index, 0);
  assert.equal(recovery.source.record_index, 0);
  assert.equal(recovery.next.started_index, 1);
  assert.equal(recovery.next.record_index, 1);
  assert.equal(recovery.next.result_message_index, 3);
  assert.equal(recovery.next.assistant_call_message_index, 2);
  assert.equal(report.checks.author_requests.checked, 2);
  assert.equal(report.checks.author_requests.ok, true);
  assert.equal(report.checks.canonical_failure.ok, true);
  assert.equal(report.checks.recovery.ok, true);
});

test("同一 run 的多个真实失败各自紧邻回流时逐个成立", () => {
  const callA = "call-g3-a";
  const callB = "call-g3-b";
  const reasonA = "judgment_semantic_conflict";
  const reasonB = "exploration_not_available";
  const failedA = {
    type: "validation_result",
    call_id: callA,
    status: "failed",
    reason_code: reasonA,
    detail: { message: "失败 A" },
  };
  const failedB = {
    type: "validation_result",
    call_id: callB,
    status: "failed",
    reason_code: reasonB,
    detail: { message: "失败 B" },
  };
  const assistantA = assistantCall({ callId: callA });
  const assistantB = assistantCall({ callId: callB, pcall: NEXT_PCALL, prun: NEXT_PRUN });
  const sourceMessages = [app(), author()];
  const nextMessages = [...sourceMessages, assistantA, tool(failedA)];
  const thirdMessages = [...nextMessages, assistantB, tool(failedB)];
  const starts = [
    start(SOURCE_PCALL, SOURCE_PRUN),
    start(NEXT_PCALL, NEXT_PRUN),
    start(THIRD_PCALL, THIRD_PRUN),
  ];
  const records = [
    record({ pcall: SOURCE_PCALL, prun: SOURCE_PRUN, messages: sourceMessages }),
    record({ pcall: NEXT_PCALL, prun: NEXT_PRUN, messages: nextMessages }),
    record({ pcall: THIRD_PCALL, prun: THIRD_PRUN, messages: thirdMessages }),
  ];
  const report = reportOf({
    starts,
    records,
    consumed: { provider_calls: 3 },
    transcriptMessages: [app(), author(), assistantA, tool(failedA), assistantB, tool(failedB)],
    nextMessages,
  });

  assert.equal(report.ok, true);
  assert.equal(report.refs.recoveries.length, 2);
  assert.equal(report.refs.recoveries[0].call_id, callA);
  assert.equal(report.refs.recoveries[0].reason_code, reasonA);
  assert.equal(report.refs.recoveries[0].source.started_index, 0);
  assert.equal(report.refs.recoveries[0].next.started_index, 1);
  assert.equal(report.refs.recoveries[1].call_id, callB);
  assert.equal(report.refs.recoveries[1].reason_code, reasonB);
  assert.equal(report.refs.recoveries[1].source.started_index, 1);
  assert.equal(report.refs.recoveries[1].next.started_index, 2);
  assert.equal(report.checks.canonical_failure.failure_count, 2);
});

test("结果只含检查/原因/技术 ref，不携带作者原文或失败 detail", () => {
  const serialized = JSON.stringify(reportOf());

  assert.equal(serialized.includes(AUTHOR_TEXT), false);
  assert.equal(serialized.includes(DETAIL.message), false);
  assert.equal(serialized.includes("【应用数据"), false);
});

test("失败 observation 不能冒充 G3 校验失败", () => {
  const observation = { ...failedResult(), type: "observation" };
  const transcriptMessages = [app(), author(), assistantCall(), tool(observation)];
  const report = reportOf({
    transcriptMessages,
    nextMessages: transcriptMessages,
  });

  assert.equal(report.ok, false);
  assert.equal(report.reason, "failed_validation_missing");
  assert.equal(hasReason(report, "failed_validation_missing"), true);
});

test("next 中的失败 observation 即使 call ID 相同也不是真实校验回流", () => {
  const observation = { ...failedResult(), type: "observation" };
  const nextMessages = [app(), author(), assistantCall(), tool(observation)];
  const report = reportOf({
    nextMessages,
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
  });

  assert.equal(report.ok, false);
  assert.equal(hasReason(report, "next_result_not_validation"), true);
});

test("失败结果只在后来请求出现时按迟到回放拒绝，不向后搜索代签", () => {
  const sourceMessages = [app(), author()];
  const nextMessages = [app(), author(), assistantCall()];
  const laterMessages = [...nextMessages, tool(failedResult())];
  const starts = [
    start(SOURCE_PCALL, SOURCE_PRUN),
    start(NEXT_PCALL, NEXT_PRUN),
    start(THIRD_PCALL, THIRD_PRUN),
  ];
  const records = [
    record({ pcall: SOURCE_PCALL, prun: SOURCE_PRUN, messages: sourceMessages }),
    record({ pcall: NEXT_PCALL, prun: NEXT_PRUN, messages: nextMessages }),
    record({ pcall: THIRD_PCALL, prun: THIRD_PRUN, messages: laterMessages }),
  ];
  const report = reportOf({
    starts,
    records,
    consumed: { provider_calls: 3 },
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
    nextMessages,
  });

  assert.equal(report.ok, false);
  assert.equal(report.reason, "late_replay");
  assert.equal(report.refs.recoveries[0].next.started_index, 1);
});

test("assistant 的 Provider 双键找不到真实 started 时拒绝错绑定", () => {
  const unknownCall = assistantCall({ pcall: "pcall-missing", prun: "prun-missing" });
  const report = reportOf({
    nextMessages: [app(), author(), unknownCall, tool(failedResult())],
    transcriptMessages: [app(), author(), unknownCall, tool(failedResult())],
  });

  assert.equal(report.ok, false);
  assert.equal(report.reason, "source_started_missing");
  assert.equal(report.refs.recoveries[0].source, null);
});

test("source 已带同一失败结果时拒绝重复/回放", () => {
  const sourceMessages = [app(), author(), assistantCall(), tool(failedResult())];
  const report = reportOf({
    sourceMessages,
    nextMessages: [...sourceMessages],
    transcriptMessages: [...sourceMessages],
  });

  assert.equal(report.ok, false);
  assert.equal(report.reason, "source_already_has_result");
});

test("伪作者纠错（同批多出一条 author 消息）不能通过", () => {
  const nextMessages = [
    app(),
    author(),
    assistantCall(),
    tool(failedResult()),
    pseudoCorrection(),
  ];
  const report = reportOf({
    nextMessages,
    transcriptMessages: [...nextMessages],
  });

  assert.equal(report.ok, false);
  assert.equal(hasReason(report, "author_message_count"), true);
  assert.equal(report.checks.author_requests.ok, false);
});

test("只读授权必须实际 production_write=false 且 allowed_tools 恰为 ['judgment']", () => {
  const cases = [
    {
      authority: { production_write: true, allowed_tools: ["judgment"] },
      reason: "authority_not_read_only",
    },
    {
      authority: { production_write: false, allowed_tools: ["judgment", "prose_writing"] },
      reason: "authority_allowed_tools",
    },
    {
      authority: { production_write: false, allowed_tools: [] },
      reason: "authority_allowed_tools",
    },
  ];

  for (const { authority, reason } of cases) {
    const report = reportOf({ authority });
    assert.equal(report.ok, false);
    assert.equal(hasReason(report, reason), true);
  }
});

test("run 未 completed 或本 run 仍有 pending 时拒绝", () => {
  const running = reportOf({ status: "running" });
  assert.equal(running.ok, false);
  assert.equal(hasReason(running, "run_not_completed"), true);

  const pending = reportOf({ pending: ["as_pending_1"] });
  assert.equal(pending.ok, false);
  assert.equal(hasReason(pending, "pending_present"), true);
});

test("实际 started/已对账 count 必须等于 consumed.provider_calls 且不超预算", () => {
  const countMismatch = reportOf({ consumed: { provider_calls: 3 } });
  assert.equal(countMismatch.ok, false);
  assert.equal(hasReason(countMismatch, "provider_call_count_mismatch"), true);

  const overBudget = reportOf({ budget: { max_provider_calls: 1 } });
  assert.equal(overBudget.ok, false);
  assert.equal(hasReason(overBudget, "provider_call_budget_exceeded"), true);

  const atBudget = reportOf({ budget: { max_provider_calls: 2 } });
  assert.equal(atBudget.ok, true);
});

test("缺下一个 started、未全部回流的多个失败、重复结果与 payload/reason 不一致都失败关闭", () => {
  const sourceRecord = record({
    pcall: SOURCE_PCALL,
    prun: SOURCE_PRUN,
    messages: [app(), author()],
  });
  const onlySource = reportOf({
    starts: [start(SOURCE_PCALL, SOURCE_PRUN)],
    records: [sourceRecord],
    consumed: { provider_calls: 1 },
    nextMessages: [app(), author(), assistantCall(), tool(failedResult())],
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
  });
  assert.equal(hasReason(onlySource, "next_started_missing"), true);

  const oneUnrecoveredFailure = reportOf({
    transcriptMessages: [
      app(),
      author(),
      assistantCall(),
      tool(failedResult()),
      assistantCall({ callId: "call-g3-2" }),
      tool({ ...failedResult(), call_id: "call-g3-2" }),
    ],
  });
  // 同 run 两个真实失败都要各自紧邻回流；第二个只在 canonical 出现，不能签。
  assert.equal(hasReason(oneUnrecoveredFailure, "next_result_missing"), true);
  assert.equal(oneUnrecoveredFailure.refs.recoveries.length, 2);

  const duplicateNext = reportOf({
    nextMessages: [
      app(),
      author(),
      assistantCall(),
      tool(failedResult()),
      tool(failedResult()),
    ],
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
  });
  assert.equal(hasReason(duplicateNext, "next_result_ambiguous"), true);

  const payloadMismatch = reportOf({
    nextMessages: [
      app(),
      author(),
      assistantCall(),
      tool({ ...failedResult(), detail: { message: "另一段失败说明" } }),
    ],
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
  });
  assert.equal(hasReason(payloadMismatch, "next_result_payload_mismatch"), true);

  const reasonMismatch = reportOf({
    nextMessages: [
      app(),
      author(),
      assistantCall(),
      tool({ ...failedResult(), reason_code: "other_reason" }),
    ],
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
  });
  assert.equal(hasReason(reasonMismatch, "next_result_reason_mismatch"), true);
});

test("原生 wire 外层 tool_call_id 与 payload call_id 不一致时拒绝", () => {
  const wireRecord = (pcall, prun, messages) => ({
    provider_call_ref: pcall,
    provider_run_ref: prun,
    request: { body: { messages } },
  });
  const wireApp = () => ({ role: "user", content: "【应用数据 · application_base】冻结基线" });
  const wireAuthor = () => ({ role: "user", content: AUTHOR_TEXT });
  const wireAssistant = () => ({
    role: "assistant",
    content: null,
    tool_calls: [{
      id: CALL_ID,
      type: "function",
      function: { name: "judgment_decision", arguments: "{}" },
    }],
  });
  const wireTool = (outerId) => ({
    role: "tool",
    tool_call_id: outerId,
    content: JSON.stringify(failedResult()),
  });
  const sourceMessages = [wireApp(), wireAuthor()];
  const nextMessages = [wireApp(), wireAuthor(), wireAssistant(), wireTool("call-other")];
  const report = reportOf({
    starts: [start(SOURCE_PCALL, SOURCE_PRUN), start(NEXT_PCALL, NEXT_PRUN)],
    records: [
      wireRecord(SOURCE_PCALL, SOURCE_PRUN, sourceMessages),
      wireRecord(NEXT_PCALL, NEXT_PRUN, nextMessages),
    ],
    consumed: { provider_calls: 2 },
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
    nextMessages: [app(), author(), assistantCall(), tool(failedResult())],
  });

  assert.equal(report.ok, false);
  assert.equal(hasReason(report, "next_result_id_mismatch"), true);
  assert.equal(report.refs.recoveries[0].next.result_message_index, 3);
});

test("next 同请求缺同 call ID 的 assistant tool call 或顺序颠倒时拒绝", () => {
  const missingCall = reportOf({
    nextMessages: [app(), author(), tool(failedResult())],
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
  });
  assert.equal(hasReason(missingCall, "next_call_missing"), true);

  const reversed = reportOf({
    nextMessages: [
      app(),
      author(),
      message("tool", "tool_result", [failedResult()]),
      assistantCall(),
    ],
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
  });
  assert.equal(hasReason(reversed, "next_call_order"), true);
});

test("started/records 双键不是一一对应时拒绝", () => {
  const sourceRecord = record({
    pcall: SOURCE_PCALL,
    prun: SOURCE_PRUN,
    messages: [app(), author()],
  });
  const nextRecord = record({
    pcall: NEXT_PCALL,
    prun: NEXT_PRUN,
    messages: [app(), author(), assistantCall(), tool(failedResult())],
  });
  const report = reportOf({
    starts: [start(SOURCE_PCALL, SOURCE_PRUN), start(SOURCE_PCALL, SOURCE_PRUN)],
    records: [sourceRecord, nextRecord],
    consumed: { provider_calls: 2 },
    transcriptMessages: [app(), author(), assistantCall(), tool(failedResult())],
    nextMessages: [app(), author(), assistantCall(), tool(failedResult())],
  });

  assert.equal(report.ok, false);
  assert.equal(hasReason(report, "started_records_mismatch"), true);
});
