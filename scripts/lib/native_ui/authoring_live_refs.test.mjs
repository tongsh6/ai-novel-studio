// L7 真实 refs 证据纯判据测试：used 来自产品持久结构（canonical 段消息自报/段头
// used_refs / decision_traces.context_refs），base/observation 来自真实请求与 agent_events。
// wire 启发式只作观测辅助；used 不可提取时 unknown（null），不假过。
import assert from "node:assert/strict";
import test from "node:test";
import {
  collectWireRefs,
  parseAgentEventRefs,
  parseDecisionTraceRefs,
  parseSegmentUsedRefs,
  refVariants,
  liveRefsCheck,
  extractRefTokens,
} from "./authoring_live_refs.mjs";

const AUTHOR = "请为第01章写一段约300字的开篇正文。";

function request(messages) {
  return {
    provider: "strata",
    turn_id: "turn_1",
    provider_call_ref: "pcall_1",
    request: { body: { messages } },
  };
}

const applicationBase = (text) => ({ role: "user", content: `【应用数据 · application_base · 非作者原话】\n${text}` });
const scopeUpdate = (text) => ({ role: "user", content: `【应用数据 · scope_update · 以最新版本为准】\n${text}` });
const author = () => ({ role: "user", content: AUTHOR });

test("wire refs 只从应用数据消息取 base、从 tool 消息取 observation", () => {
  const llmRecords = [
    request([
      { role: "system", content: "system 里出现 chapter:fake-should-not-count" },
      applicationBase("材料：chapter:12c0114d-94f7-4bed-bf96-e74080d71569；plan:1:plot_progress"),
      author(),
      scopeUpdate("观察 observation:obs_1；artifact as_live_1"),
      { role: "tool", tool_call_id: "call_1", content: "工具结果 chapter:16aa22b8-8822-47a2-88be-5834b0115196" },
    ]),
  ];
  const { base_refs, observation_refs } = collectWireRefs(llmRecords);
  assert(base_refs.includes("chapter:12c0114d-94f7-4bed-bf96-e74080d71569"));
  assert(base_refs.includes("plan:1:plot_progress"));
  assert(base_refs.includes("observation:obs_1"));
  assert(base_refs.includes("as_live_1"));
  assert(!base_refs.some((ref) => ref.includes("fake-should-not-count")), "system 消息不进入 base");
  assert(observation_refs.includes("chapter:16aa22b8-8822-47a2-88be-5834b0115196"));
  assert.deepEqual([...extractRefTokens("x chapter:a1b2 y as_c3")].sort(), ["as_c3", "chapter:a1b2"]);
});

test("agent_events 只认 exploration_observed refs；坏 JSON/其它事件忽略", () => {
  const refs = parseAgentEventRefs([
    { event_type: "exploration_observed", refs: '["obs_1","obs_2"]' },
    { event_type: "evaluation_made", refs: '["and_1"]' },
    { event_type: "exploration_observed", refs: "not-json" },
    { event_type: "exploration_observed", refs: null },
  ]);
  assert.deepEqual(refs, ["obs_1", "obs_2"]);
});

test("canonical 段消息自报与段头 used_refs 合并，再并入 decision_traces.context_refs", () => {
  const parsed = parseSegmentUsedRefs({
    messages: [
      { role: "assistant", provenance: "model", blocks: [{ type: "tool_call", arguments: { self_report: { used_context_refs: ["observation:obs_1", "execution_brief:chapter:ch-1"] } } }] },
      { role: "assistant", provenance: "model", blocks: [{ type: "tool_call", arguments: { self_report: { used_context_refs: ["observation:obs_2"] } } }] },
      { role: "tool", blocks: [{ type: "observation", content: { self_report: { used_context_refs: ["chapter:foreign"] } } }] },
    ],
    used_refs: [{ ref: "chapter:ch-header" }],
  });
  assert.deepEqual(parsed.used_refs, ["chapter:ch-header", "execution_brief:chapter:ch-1", "observation:obs_1", "observation:obs_2"]);
  assert.equal(parsed.self_report_count, 2);
  assert.equal(parseSegmentUsedRefs(null).self_report_count, 0);
  const traces = parseDecisionTraceRefs([
    { trace_id: "trace_1", context_refs: '["chapter:ch-9"]' },
    { trace_id: "trace_2", context_refs: null },
    { trace_id: "trace_3", context_refs: "bad-json" },
  ]);
  assert.deepEqual(traces.context_refs, ["chapter:ch-9"]);
  assert.deepEqual(traces.trace_ids, ["trace_1"]);
});

test("ref 归一：execution_brief:chapter 内嵌身份与 observation 前缀可比较", () => {
  assert.deepEqual(refVariants("execution_brief:chapter:ch-1").sort(), [
    "chapter:ch-1",
    "execution_brief:chapter:ch-1",
  ]);
  assert.deepEqual(refVariants("observation:obs_1").sort(), ["obs_1", "observation:obs_1"]);
  assert.deepEqual(refVariants("chapter:ch-1"), ["chapter:ch-1"]);
});

test("L7 合法：used 全部来自 base ∪ observation → ok=true 并记录来源字段", () => {
  const llmRecords = [
    request([
      applicationBase("材料：chapter:ch-1"),
      author(),
      scopeUpdate("观察 observation:obs_1"),
      { role: "tool", tool_call_id: "call_1", content: "observation:obs_2" },
    ]),
  ];
  const result = liveRefsCheck({
    llmRecords,
    agentEvents: [{ event_type: "exploration_observed", refs: '["obs_3"]' }],
    decisionTraces: [{ trace_id: "trace_1", context_refs: '["chapter:ch-1"]' }],
    transcript: {
      messages: [{ role: "assistant", provenance: "model", blocks: [{ type: "tool_call", arguments: { self_report: { used_context_refs: ["observation:obs_1", "observation:obs_3", "execution_brief:chapter:ch-1"] } } }] }],
      used_refs: [],
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert(result.sources.used.includes("authoring_session_messages.message.blocks.arguments.self_report.used_context_refs"));
  assert.equal(result.sources.wire_heuristic, "observation_only_not_used_for_verdict");
});

test("L7 越界：used 引用未提供的观察/材料 → ok=false 并列出 violations", () => {
  const llmRecords = [request([applicationBase("材料：chapter:ch-1"), author()])];
  const result = liveRefsCheck({
    llmRecords,
    agentEvents: [{ event_type: "exploration_observed", refs: '["obs_1"]' }],
    transcript: {
      messages: [{ role: "assistant", provenance: "model", blocks: [{ type: "tool_call", arguments: { self_report: { used_context_refs: ["observation:obs_out_of_boundary", "execution_brief:chapter:ch-9"] } } }] }],
      used_refs: [],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 2);
  assert.equal(result.reason, "used_ref_out_of_boundary");
});

test("L7 unknown：used 不可提取时 ok=null（不假过），不因 wire 有 refs 而通过", () => {
  const result = liveRefsCheck({
    llmRecords: [request([applicationBase("材料：chapter:ch-1"), author()])],
    agentEvents: [],
    transcript: null,
  });
  assert.equal(result.ok, null);
  assert.equal(result.reason, "used_context_refs_unavailable");
  assert.equal(result.violations.length, 0);
});

test("canonical IR refs 按 application provenance/blocks 与 tool 结果读取，不依赖 wire marker", () => {
  const llmRecords = [
    {
      provider: "slice_verify",
      turn_id: "turn_1",
      provider_call_ref: "pcall_1",
      request_format: "authoring-request-ir/v1",
      request_body: {
        ir_version: "authoring-request-ir/v1",
        messages: [
          {
            role: "system",
            provenance: "application",
            blocks: [{ type: "text", text: "chapter:system-should-not-count" }],
            source_refs: [],
            versions: {},
          },
          {
            role: "user",
            provenance: "author",
            blocks: [{ type: "text", text: AUTHOR }],
            source_refs: [],
            versions: {},
          },
          {
            role: "application_base",
            provenance: "application",
            blocks: [{ type: "text", text: "材料 chapter:12c0114d-94f7-4bed-bf96-e74080d71569" }],
            source_refs: [],
            versions: {},
          },
          {
            role: "tool",
            provenance: "tool_result",
            blocks: [
              {
                type: "observation",
                call_id: "call-1",
                status: "ok",
                source_refs: ["chapter:16aa22b8-8822-47a2-88be-5834b0115196"],
                content: { ref: "observation:obs_ir" },
              },
            ],
            source_refs: [],
            versions: {},
          },
        ],
        tools: [],
        projection: { tool_choice: null },
        refs: {},
      },
    },
  ];
  const { base_refs, observation_refs } = collectWireRefs(llmRecords);
  assert(base_refs.includes("chapter:12c0114d-94f7-4bed-bf96-e74080d71569"));
  assert(!base_refs.some((ref) => ref.includes("system-should-not-count")));
  assert(observation_refs.includes("chapter:16aa22b8-8822-47a2-88be-5834b0115196"));
  assert(observation_refs.includes("observation:obs_ir"));
});
