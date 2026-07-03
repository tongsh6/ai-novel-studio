// Design: docs/design/ui/46-state-and-feedback.md §9 (Agentic loop reasoning flow)
// Prototype: novel-studio.pen → 46§9-agentic-loop-reasoning-flow (DM8gx)
import { describe, expect, it } from "vitest";

import type { AgentEventData } from "../lib/socket";
import {
  agentRunEventDetailItems,
  agentRunProviderFlowSummary,
  agentRunProviderRunDetailItems,
  agentRunProviderRunReplayDetails,
  agentRunReasoningFlow,
  selectAgentRunVisibleEvents,
} from "../lib/agentRunTimeline";

describe("AgentRun reasoning flow", () => {
  it("builds the author-visible flow only from 46§9 narrative events", () => {
    const events: AgentEventData[] = [
      {
        event_id: "evt_plan",
        run_ref: "run_reasoning",
        sequence: 1,
        event_type: "plan_drafted",
        visibility: "author",
        summary: "先读取当前作品上下文。",
        reason_codes: ["agent_plan_drafted", "agentic_next_step"],
        payload: {
          author_narrative: "先读取当前作品上下文。",
          author_narrative_source: {
            source_type: "provider_output",
            provider_run_ref: "prun_plan",
            provider_call_ref: "pcall_plan",
            provider_output_ref: "prun_plan",
            source_hash: "source-hash",
            source_byte_range: { start: 42, length: 13 },
            narrative_hash: "plan-hash",
          },
          plan_ref: "ap_run_reasoning",
          plan_version: 2,
          plan_steps: [
            {
              step_ref: "assemble_context",
              kind: "explore",
              status: "active",
              description: "读取当前作品上下文",
            },
            {
              step_ref: "draft_result",
              kind: "act",
              status: "pending",
              description: "生成本轮候选草稿",
            },
          ],
        },
      },
      {
        event_id: "evt_observation",
        run_ref: "run_reasoning",
        sequence: 2,
        event_type: "exploration_observed",
        visibility: "author",
        summary: "已组装章节和角色上下文。",
        reason_codes: ["exploration_observed"],
        payload: {
          author_narrative: "已组装章节和角色上下文。",
          author_narrative_source: {
            source_type: "provider_output",
            provider_run_ref: "prun_obs",
            provider_call_ref: "pcall_obs",
            provider_output_ref: "prun_obs",
            source_hash: "obs-source-hash",
            source_byte_range: { start: 18, length: 12 },
            narrative_hash: "obs-hash",
          },
        },
      },
      {
        event_id: "evt_eval",
        run_ref: "run_reasoning",
        sequence: 3,
        event_type: "evaluation_made",
        visibility: "author",
        summary: "上下文已经足够，下一步可以生成候选。",
        reason_codes: ["agent_step_evaluated", "agentic_next_step"],
        payload: {
          author_narrative: "上下文已经足够，下一步可以生成候选。",
          author_narrative_source: {
            source_type: "provider_output",
            provider_run_ref: "prun_eval",
            provider_call_ref: "pcall_eval",
            provider_output_ref: "prun_eval",
            source_hash: "eval-source-hash",
            source_byte_range: { start: 31, length: 20 },
            narrative_hash: "eval-hash",
          },
          plan_ref: "ap_run_reasoning",
          plan_version: 2,
          plan_steps: [
            {
              step_ref: "assemble_context",
              kind: "explore",
              status: "done",
              description: "读取当前作品上下文",
            },
            {
              step_ref: "draft_result",
              kind: "act",
              status: "pending",
              description: "生成本轮候选草稿",
            },
          ],
        },
      },
      {
        event_id: "evt_provider",
        run_ref: "run_reasoning",
        sequence: 4,
        event_type: "provider_progress",
        visibility: "developer",
        summary: "provider_event:final_output",
        reason_codes: ["provider_execution_stream", "provider_final_output"],
        payload: {
          purpose: "author_reasoning",
          provider_event_type: "final_output",
          raw_prompt: "不应进入作者主链",
        },
      },
      {
        event_id: "evt_done",
        run_ref: "run_reasoning",
        sequence: 5,
        event_type: "run_completed",
        visibility: "author",
        summary: "AgentRun 已完成。",
      },
    ];

    const flow = agentRunReasoningFlow(events);

    expect(flow.statusLine).toBeNull();
    expect(flow.planRef).toBe("ap_run_reasoning");
    expect(flow.planVersion).toBe(2);
    expect(flow.planSteps).toEqual([
      {
        stepRef: "assemble_context",
        kind: "explore",
        status: "done",
        description: "读取当前作品上下文",
      },
      {
        stepRef: "draft_result",
        kind: "act",
        status: "pending",
        description: "生成本轮候选草稿",
      },
    ]);
    expect(flow.narrativeEvents.map((event) => event.label)).toEqual(["计划", "观察", "评估"]);
    expect(flow.narrativeEvents.map((event) => event.narrative).join(" ")).not.toContain(
      "不应进入作者主链",
    );
    expect(flow.resultLine).toBe("已完成");
  });

  it("keeps reasoning events visible while compacting noisy provider chunks", () => {
    const events: AgentEventData[] = [
      {
        event_id: "evt_plan",
        run_ref: "run_chunks",
        sequence: 1,
        event_type: "plan_drafted",
        visibility: "author",
        summary: "先读取上下文。",
        payload: { author_narrative: "先读取上下文。" },
      },
      ...Array.from({ length: 140 }, (_, index) => ({
        event_id: `evt_chunk_${index + 1}`,
        run_ref: "run_chunks",
        sequence: index + 2,
        event_type: "provider_progress",
        visibility: "developer",
        summary: "provider_event:chunk",
        reason_codes: ["provider_execution_stream", "provider_chunk"],
        payload: {
          provider_event_type: "chunk",
          provider_run_ref: "prun_chunks",
          provider_call_ref: "pcall_chunks",
          purpose: "author_reasoning",
          chunk_index: index + 1,
        },
      })),
      {
        event_id: "evt_eval",
        run_ref: "run_chunks",
        sequence: 142,
        event_type: "evaluation_made",
        visibility: "author",
        summary: "上下文足够继续。",
        payload: { author_narrative: "上下文足够继续。" },
      },
    ];

    const visible = selectAgentRunVisibleEvents(events, 96);
    const chunkEvents = visible.filter((event) => event.payload?.provider_event_type === "chunk");

    expect(visible.map((event) => event.event_type)).toContain("plan_drafted");
    expect(visible.map((event) => event.event_type)).toContain("evaluation_made");
    expect(chunkEvents).toHaveLength(1);
    expect(chunkEvents[0]?.payload?.chunk_index).toBe(140);
  });

  it("streams author reasoning deltas before the final source-bound event replaces them", () => {
    const streamed: AgentEventData[] = [
      {
        event_id: "evt_reasoning_1",
        run_ref: "run_streaming_reasoning",
        sequence: 1,
        event_type: "provider_progress",
        visibility: "author",
        summary: "先读取",
        reason_codes: ["provider_execution_stream", "provider_chunk"],
        payload: {
          purpose: "author_reasoning",
          provider_event_type: "chunk",
          provider_run_ref: "prun_streaming_reasoning",
          provider_call_ref: "pcall_streaming_reasoning",
          author_narrative_delta: "先读取",
        },
      },
      {
        event_id: "evt_reasoning_2",
        run_ref: "run_streaming_reasoning",
        sequence: 2,
        event_type: "provider_progress",
        visibility: "author",
        summary: "当前作品上下文。",
        reason_codes: ["provider_execution_stream", "provider_chunk"],
        payload: {
          purpose: "author_reasoning",
          provider_event_type: "chunk",
          provider_run_ref: "prun_streaming_reasoning",
          provider_call_ref: "pcall_streaming_reasoning",
          author_narrative_delta: "当前作品上下文。",
        },
      },
    ];

    const activeFlow = agentRunReasoningFlow(streamed);

    expect(activeFlow.statusLine).toBeNull();
    expect(activeFlow.narrativeEvents).toEqual([
      {
        key: "stream:prun_streaming_reasoning",
        eventType: "provider_progress",
        label: "推理",
        narrative: "先读取当前作品上下文。",
        sequence: 2,
      },
    ]);

    const finalized = [
      ...streamed,
      {
        event_id: "evt_plan_final",
        run_ref: "run_streaming_reasoning",
        sequence: 3,
        event_type: "plan_drafted",
        visibility: "author",
        summary: "先读取当前作品上下文。",
        reason_codes: ["agent_plan_drafted", "agentic_next_step"],
        payload: {
          author_narrative: "先读取当前作品上下文。",
          author_narrative_source: {
            source_type: "provider_output",
            provider_run_ref: "prun_streaming_reasoning",
            provider_call_ref: "pcall_streaming_reasoning",
            provider_output_ref: "prun_streaming_reasoning",
            source_hash: "source-hash",
            source_byte_range: { start: 0, length: 11 },
            narrative_hash: "narrative-hash",
          },
        },
      },
    ];

    const finalizedFlow = agentRunReasoningFlow(finalized);

    expect(finalizedFlow.narrativeEvents.map((event) => event.label)).toEqual(["计划"]);
    expect(finalizedFlow.narrativeEvents.map((event) => event.narrative)).toEqual([
      "先读取当前作品上下文。",
    ]);
  });

  it("reconstructs streaming reasoning from the full un-compacted chunk stream", () => {
    const narrative = "作者的输入只有继续，我们需要先判断当前上下文是否足够，再决定下一步行动。";
    const chunks = Array.from(narrative);
    const streamed: AgentEventData[] = chunks.map((chunk, index) => ({
      event_id: `evt_reasoning_chunk_${index + 1}`,
      run_ref: "run_full_stream",
      sequence: index + 1,
      event_type: "provider_progress",
      visibility: "author",
      summary: chunk,
      reason_codes: ["provider_execution_stream", "provider_chunk"],
      payload: {
        purpose: "author_reasoning",
        provider_event_type: "chunk",
        provider_run_ref: "prun_full_stream",
        provider_call_ref: "pcall_full_stream",
        author_narrative_delta: chunk,
      },
    }));

    const flow = agentRunReasoningFlow(streamed);

    expect(flow.narrativeEvents).toHaveLength(1);
    expect(flow.narrativeEvents[0]?.narrative).toBe(narrative);
  });
});

describe("AgentRun provider developer details", () => {
  it("presents provider execution refs without exposing raw provider content", () => {
    const event: AgentEventData = {
      event_id: "evt_provider",
      run_ref: "run_provider",
      sequence: 1,
      event_type: "provider_progress",
      visibility: "developer",
      summary: "provider_event:final_output",
      reason_codes: ["provider_execution_stream", "provider_final_output"],
      refs: ["provider_run:prun_1", "provider_call:pcall_1"],
      payload: {
        provider_event_type: "final_output",
        provider_run_ref: "prun_1",
        provider_call_ref: "pcall_1",
        purpose: "author_reasoning",
        status: "ok",
        output_type: "text",
        content_length: 42,
        raw_prompt: "作者原始输入不应展示",
        assistant_message: "模型原文不应展示",
      },
      emitted_at: "2026-06-30T03:00:00Z",
    };

    const rendered = agentRunEventDetailItems(event).join(" ");

    expect(rendered).toContain("模型事件：收到结果");
    expect(rendered).toContain("运行编号：prun_1");
    expect(rendered).toContain("调用编号：pcall_1");
    expect(rendered).toContain("结果长度：42 字");
    expect(rendered).not.toContain("作者原始输入不应展示");
    expect(rendered).not.toContain("模型原文不应展示");
  });

  it("summarizes live provider execution flow as developer telemetry", () => {
    const events: AgentEventData[] = [
      {
        event_id: "evt_provider_start",
        run_ref: "run_provider_flow",
        sequence: 1,
        event_type: "provider_progress",
        visibility: "developer",
        summary: "provider_event:progress phase=request_prepared",
        reason_codes: ["provider_execution_stream", "provider_request_prepared"],
        payload: {
          provider_event_type: "progress",
          provider_run_ref: "prun_flow",
          provider_call_ref: "pcall_flow",
          purpose: "author_reasoning",
          status: "running",
          provider_progress_phase: "request_prepared",
        },
      },
      {
        event_id: "evt_provider_final",
        run_ref: "run_provider_flow",
        sequence: 2,
        event_type: "provider_progress",
        visibility: "developer",
        summary: "provider_event:final_output",
        reason_codes: ["provider_execution_stream", "provider_final_output"],
        payload: {
          provider_event_type: "final_output",
          provider_run_ref: "prun_flow",
          provider_call_ref: "pcall_flow",
          purpose: "author_reasoning",
          status: "ok",
          output_type: "text",
          content_length: 64,
          usage: { total_tokens: 18 },
        },
      },
    ];

    const summary = agentRunProviderFlowSummary(events);

    expect(summary?.headline).toBe("模型输出已进入本轮执行轨迹。");
    expect(summary?.details.join(" ")).toContain("结果：64 字");
    expect(summary?.details.join(" ")).toContain("用量：18 tokens");
  });

  it("presents persisted provider run replay boundaries", () => {
    const run = {
      run_id: "run_provider_detail",
      provider_run_ref: "prun_detail",
      provider_call_ref: "pcall_detail",
      purpose: "author_reasoning",
      status: "ok",
      output_type: "text",
      content_length: 32,
      usage: { total_tokens: 9 },
      model: "stub-model",
      events: [
        {
          event_type: "final_output",
          summary: "provider final",
          sequence: 3,
          payload: {
            provider_event_type: "final_output",
            provider_run_ref: "prun_detail",
            provider_call_ref: "pcall_detail",
            content_length: 32,
          },
        },
      ],
      output: {
        status: "ok",
        output_type: "text",
        content_length: 32,
        usage: { total_tokens: 9 },
        refs: ["pcall_detail"],
      },
    };

    const details = agentRunProviderRunDetailItems(run);
    const replay = agentRunProviderRunReplayDetails(run);

    expect(details.join(" ")).toContain("调用编号：pcall_detail");
    expect(details.join(" ")).toContain("模型：stub-model");
    expect(replay.events[0]?.details.join(" ")).toContain("运行编号：prun_detail");
    expect(replay.output.join(" ")).toContain("引用：pcall_detail");
    expect(replay.boundary).toContain("不会重新调用模型");
  });
});
