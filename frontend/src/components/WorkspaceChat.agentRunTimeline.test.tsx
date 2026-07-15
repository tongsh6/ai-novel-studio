// Design: docs/design/ui/46-state-and-feedback.md §9 (Agentic loop reasoning flow)
// Prototype: novel-studio.pen → 46§9-agentic-loop-reasoning-flow (DM8gx)
import { describe, expect, it } from "vitest";

import type { AgentEventData } from "../lib/socket";
import { activeToolActivity, agentRunReasoningFlow } from "../lib/agentRunTimeline";

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

// 46§9.5：AI 接口执行中标识——活动行必须覆盖模型调用窗口，不能只覆盖工具窗口。
describe("activeToolActivity", () => {
  const base = {
    run_ref: "run_activity",
    visibility: "developer" as const,
    summary: "provider_event",
    payload: {},
  };

  it("provider 调用开始后未收到终态 → reasoning（AI 接口执行中）", () => {
    const events: AgentEventData[] = [
      {
        ...base,
        event_id: "e1",
        sequence: 1,
        event_type: "provider_progress",
        reason_codes: ["provider_execution_stream", "provider_started"],
        payload: { provider_call_ref: "call_1" },
      },
    ];
    expect(activeToolActivity(events)).toBe("reasoning");
  });

  it("provider 调用收到 final_output → 无活动", () => {
    const events: AgentEventData[] = [
      {
        ...base,
        event_id: "e1",
        sequence: 1,
        event_type: "provider_progress",
        reason_codes: ["provider_started"],
        payload: { provider_call_ref: "call_1" },
      },
      {
        ...base,
        event_id: "e2",
        sequence: 2,
        event_type: "provider_progress",
        reason_codes: ["provider_final_output"],
        payload: { provider_call_ref: "call_1" },
      },
    ];
    expect(activeToolActivity(events)).toBeNull();
  });

  it("工具窗口优先于模型调用窗口", () => {
    const events: AgentEventData[] = [
      {
        ...base,
        event_id: "e1",
        sequence: 1,
        event_type: "provider_progress",
        reason_codes: ["provider_started"],
        payload: { provider_call_ref: "call_1" },
      },
      {
        ...base,
        event_id: "e2",
        sequence: 2,
        event_type: "tool_started",
        visibility: "author",
        reason_codes: ["prose_writing_started"],
        payload: { tool_name: "prose_writing" },
      },
    ];
    expect(activeToolActivity(events)).toBe("drafting");
  });

  it("run 终态后无任何活动标识", () => {
    const events: AgentEventData[] = [
      {
        ...base,
        event_id: "e1",
        sequence: 1,
        event_type: "provider_progress",
        reason_codes: ["provider_started"],
        payload: { provider_call_ref: "call_1" },
      },
      {
        ...base,
        event_id: "e2",
        sequence: 2,
        event_type: "run_completed",
        visibility: "author",
        reason_codes: ["goal_satisfied"],
        payload: {},
      },
    ];
    expect(activeToolActivity(events)).toBeNull();
  });
});
