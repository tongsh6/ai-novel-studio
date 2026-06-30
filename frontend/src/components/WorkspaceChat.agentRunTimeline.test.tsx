// Design: docs/design/ui/46-state-and-feedback.md §3.1 (AgentRun dialogue flow)
// Prototype: novel-studio.pen → 46§8-agent-run-dialogue-flow-v4 (kg4wN)
import { describe, expect, it } from "vitest";

import type { AgentEventData } from "../lib/socket";
import {
  agentRunEventDetailItems,
  agentRunExecutionBrief,
  agentRunProviderRunDetailItems,
  agentRunProviderRunReplayDetails,
} from "../lib/agentRunTimeline";

describe("AgentRun activity timeline details", () => {
  it("presents provider execution refs without exposing raw provider content", () => {
    const event: AgentEventData = {
      event_id: "evt_run_1_4",
      run_ref: "run_1",
      step_ref: "step_run_1_2",
      sequence: 4,
      event_type: "provider_progress",
      visibility: "author",
      summary: "对话判断已收到创作模型结果。",
      reason_codes: ["provider_execution_stream", "provider_final_output"],
      refs: ["provider_run:prun_1", "provider_call:pcall_1"],
      payload: {
        provider_event_type: "final_output",
        provider_run_ref: "prun_1",
        provider_call_ref: "pcall_1",
        purpose: "conversation",
        status: "ok",
        output_type: "text",
        provider_progress_phase: "response_received",
        content_length: 42,
        raw_prompt: "作者原始输入不应展示",
        assistant_message: "模型原文不应展示",
      },
      emitted_at: "2026-06-30T03:00:00Z",
    };

    const details = agentRunEventDetailItems(event);
    const rendered = details.join(" ");

    expect(rendered).toContain("模型事件：收到结果");
    expect(rendered).toContain("用途：对话判断");
    expect(rendered).toContain("运行编号：prun_1");
    expect(rendered).toContain("调用编号：pcall_1");
    expect(rendered).toContain("进展阶段：response_received");
    expect(rendered).toContain("结果长度：42 字");
    expect(rendered).not.toContain("作者原始输入不应展示");
    expect(rendered).not.toContain("模型原文不应展示");
  });

  it("presents provider chunk progress as facts without exposing text deltas", () => {
    const event: AgentEventData = {
      event_id: "evt_run_chunk_1",
      run_ref: "run_chunk",
      step_ref: "step_run_chunk_1",
      sequence: 5,
      event_type: "provider_progress",
      visibility: "author",
      summary: "对话判断正在接收模型片段。",
      reason_codes: ["provider_execution_stream", "provider_chunk"],
      refs: ["provider_run:prun_chunk", "provider_call:pcall_chunk"],
      payload: {
        provider_event_type: "chunk",
        provider_run_ref: "prun_chunk",
        provider_call_ref: "pcall_chunk",
        purpose: "conversation",
        status: "running",
        output_type: "text",
        chunk_index: 2,
        chunk_content_length: 18,
        accumulated_content_length: 37,
        text_delta: "不应展示的模型片段",
      },
      emitted_at: "2026-06-30T03:00:00Z",
    };

    const rendered = agentRunEventDetailItems(event).join(" ");

    expect(rendered).toContain("模型事件：接收片段");
    expect(rendered).toContain("用途：对话判断");
    expect(rendered).toContain("状态：running");
    expect(rendered).toContain("输出类型：text");
    expect(rendered).toContain("片段序号：2");
    expect(rendered).toContain("片段长度：18 字");
    expect(rendered).toContain("已接收：37 字");
    expect(rendered).not.toContain("不应展示的模型片段");
  });

  it("presents planning and gate details from author-safe payload", () => {
    const event: AgentEventData = {
      event_id: "evt_run_2_3",
      run_ref: "run_2",
      sequence: 3,
      event_type: "gate_decided",
      visibility: "author",
      summary: "本轮裁决为直接回复，不调用工具。",
      payload: {
        frame_type: "exploration",
        needs_tool: false,
        candidate_count: 2,
        decision_ref: "decision_1",
        decision_type: "reply_only",
      },
      emitted_at: "2026-06-30T03:00:00Z",
    };

    expect(agentRunEventDetailItems(event)).toEqual([
      "认知帧：exploration",
      "判断无需工具执行",
      "候选方向：2 个",
      "裁决编号：decision_1",
      "裁决结果：reply_only",
    ]);
  });

  it("summarizes the run path and provider facts from author-safe events", () => {
    const events: AgentEventData[] = [
      {
        event_id: "evt_run_3_1",
        run_ref: "run_3",
        sequence: 1,
        event_type: "goal_understood",
        visibility: "author",
        summary: "已组装当前作品上下文。",
        payload: { stage: "context_assembled", context_ref_count: 3 },
      },
      {
        event_id: "evt_run_3_2",
        run_ref: "run_3",
        sequence: 2,
        event_type: "provider_progress",
        visibility: "author",
        summary: "对话判断已开始调用创作模型。",
        payload: {
          provider_event_type: "started",
          provider_call_ref: "pcall_3",
        },
      },
      {
        event_id: "evt_run_3_3",
        run_ref: "run_3",
        sequence: 3,
        event_type: "provider_progress",
        visibility: "author",
        summary: "对话判断已收到创作模型结果。",
        payload: {
          provider_event_type: "final_output",
          provider_call_ref: "pcall_3",
          content_length: 88,
          usage: { total_tokens: 144 },
          raw_prompt: "不应进入摘要",
        },
      },
      {
        event_id: "evt_run_3_4",
        run_ref: "run_3",
        sequence: 4,
        event_type: "plan_created",
        visibility: "author",
        summary: "已形成对话认知帧：exploration。",
        payload: { stage: "dialogue_frame_formed", frame_type: "exploration" },
      },
      {
        event_id: "evt_run_3_5",
        run_ref: "run_3",
        sequence: 5,
        event_type: "gate_decided",
        visibility: "author",
        summary: "本轮裁决为直接回复，不调用工具。",
        payload: { decision_type: "reply_only" },
      },
      {
        event_id: "evt_run_3_6",
        run_ref: "run_3",
        sequence: 6,
        event_type: "turn_result_ready",
        visibility: "author",
        summary: "本轮回应已完成。",
      },
    ];

    const brief = agentRunExecutionBrief(events);

    expect(brief?.path).toBe("本轮路径：读取上下文 → 调用模型 → 模型判断 → 系统裁决 → 完成回应");
    expect(brief?.facts).toEqual([
      "模型调用 1 次",
      "调用 pcall_3",
      "结果 88 字",
      "用量 144 tokens",
    ]);
    expect(`${brief?.path} ${brief?.facts.join(" ")}`).not.toContain("不应进入摘要");
  });

  it("summarizes provider usage from persisted ProviderRun facts when available", () => {
    const events: AgentEventData[] = [
      {
        event_id: "evt_run_5_1",
        run_ref: "run_5",
        sequence: 1,
        event_type: "goal_understood",
        visibility: "author",
        summary: "已组装当前作品上下文。",
        payload: { stage: "context_assembled" },
      },
      {
        event_id: "evt_run_5_2",
        run_ref: "run_5",
        sequence: 2,
        event_type: "turn_result_ready",
        visibility: "author",
        summary: "本轮回应已完成。",
      },
    ];

    const brief = agentRunExecutionBrief(events, [
      {
        provider_run_ref: "prun_persisted",
        provider_call_ref: "pcall_persisted",
        purpose: "planner",
        status: "ok",
        output_type: "text",
        content_length: 64,
        usage: { total_tokens: 21 },
      },
    ]);

    expect(brief?.facts).toEqual([
      "模型调用 1 次",
      "调用 pcall_persisted",
      "结果 64 字",
      "用量 21 tokens",
    ]);
  });

  it("presents provider run details from persisted facts without raw output", () => {
    const details = agentRunProviderRunDetailItems({
      provider_run_ref: "prun_query",
      provider_call_ref: "pcall_query",
      purpose: "planner",
      status: "ok",
      output_type: "text",
      content_length: 31,
      usage: { total_tokens: 21 },
      model: "stub-model",
      output: {
        usage: { total_tokens: 21 },
        content_summary: { content_length: 31 },
        raw_output: "不应展示",
      },
    });

    const rendered = details.join(" ");

    expect(rendered).toContain("用途：步骤规划");
    expect(rendered).toContain("状态：ok");
    expect(rendered).toContain("输出类型：text");
    expect(rendered).toContain("运行编号：prun_query");
    expect(rendered).toContain("调用编号：pcall_query");
    expect(rendered).toContain("结果长度：31 字");
    expect(rendered).toContain("用量记录：21 tokens");
    expect(rendered).toContain("模型：stub-model");
    expect(rendered).not.toContain("不应展示");
  });

  it("presents provider replay facts without dumping provider payloads", () => {
    const replay = agentRunProviderRunReplayDetails({
      provider_run_ref: "prun_replay",
      provider_call_ref: "pcall_replay",
      purpose: "conversation",
      status: "ok",
      output_type: "text",
      content_length: 31,
      usage: { total_tokens: 21 },
      events: [
        {
          event_id: "pevt_1",
          provider_run_ref: "prun_replay",
          provider_call_ref: "pcall_replay",
          sequence: 1,
          event_type: "started",
          summary: "对话判断已开始调用创作模型。",
          payload: {
            provider_event_type: "started",
            phase: "request_dispatched",
            provider_run_ref: "prun_replay",
            provider_call_ref: "pcall_replay",
            raw_prompt: "不应展示的 prompt",
          },
          emitted_at: "2026-06-30T03:00:00Z",
        },
        {
          event_id: "pevt_2",
          provider_run_ref: "prun_replay",
          provider_call_ref: "pcall_replay",
          sequence: 2,
          event_type: "chunk",
          summary: "对话判断正在接收模型片段。",
          payload: {
            output_type: "text",
            chunk_index: 1,
            content_length: 13,
            accumulated_content_length: 13,
            text_delta: "不应展示的历史片段",
          },
          emitted_at: "2026-06-30T03:00:00Z",
        },
        {
          event_id: "pevt_3",
          provider_run_ref: "prun_replay",
          provider_call_ref: "pcall_replay",
          sequence: 3,
          event_type: "final_output",
          summary: "对话判断已收到创作模型结果。",
          payload: {
            provider_event_type: "final_output",
            status: "ok",
            output_type: "text",
            content_length: 31,
            usage: { total_tokens: 21 },
            assistant_message: "不应展示的模型原文",
          },
          emitted_at: "2026-06-30T03:00:01Z",
        },
      ],
      output: {
        status: "ok",
        output_type: "text",
        content_length: 31,
        content_summary: {
          content_length: 31,
          raw_output: "不应展示的输出原文",
        },
        usage: { total_tokens: 21 },
        refs: ["provider_run:prun_replay", "provider_call:pcall_replay"],
        raw_provider_error: "不应展示的 provider error",
        finalized_at: "2026-06-30T03:00:01Z",
      },
    });

    const rendered = `${replay.events
      .flatMap((event) => [event.title, ...event.details])
      .join(" ")} ${replay.output.join(" ")} ${replay.boundary}`;

    expect(rendered).toContain("对话判断已开始调用创作模型。");
    expect(rendered).toContain("对话判断已收到创作模型结果。");
    expect(rendered).toContain("序号：1");
    expect(rendered).toContain("模型事件：开始调用");
    expect(rendered).toContain("模型事件：接收片段");
    expect(rendered).toContain("模型事件：收到结果");
    expect(rendered).toContain("进展阶段：request_dispatched");
    expect(rendered).toContain("运行编号：prun_replay");
    expect(rendered).toContain("调用编号：pcall_replay");
    expect(rendered).toContain("片段序号：1");
    expect(rendered).toContain("片段长度：13 字");
    expect(rendered).toContain("已接收：13 字");
    expect(rendered).toContain("结果长度：31 字");
    expect(rendered).toContain("用量记录：21 tokens");
    expect(rendered).toContain("引用：provider_run:prun_replay, provider_call:pcall_replay");
    expect(rendered).toContain("不会重新调用模型");
    expect(rendered).not.toContain("不应展示的 prompt");
    expect(rendered).not.toContain("不应展示的历史片段");
    expect(rendered).not.toContain("不应展示的模型原文");
    expect(rendered).not.toContain("不应展示的输出原文");
    expect(rendered).not.toContain("不应展示的 provider error");
  });

  it("distinguishes model judgment, model planning, gate, tool execution, and tentative output", () => {
    const events: AgentEventData[] = [
      {
        event_id: "evt_run_4_1",
        run_ref: "run_4",
        sequence: 1,
        event_type: "goal_understood",
        visibility: "author",
        summary: "已组装当前作品上下文。",
        payload: { stage: "context_assembled" },
      },
      {
        event_id: "evt_run_4_2",
        run_ref: "run_4",
        sequence: 2,
        event_type: "provider_progress",
        visibility: "author",
        summary: "对话判断已开始调用创作模型。",
        payload: {
          provider_event_type: "started",
          provider_call_ref: "pcall_frame",
          purpose: "conversation",
        },
      },
      {
        event_id: "evt_run_4_3",
        run_ref: "run_4",
        sequence: 3,
        event_type: "provider_progress",
        visibility: "author",
        summary: "对话判断已收到创作模型结果。",
        payload: {
          provider_event_type: "final_output",
          provider_call_ref: "pcall_frame",
          purpose: "conversation",
          content_length: 32,
        },
      },
      {
        event_id: "evt_run_4_4",
        run_ref: "run_4",
        sequence: 4,
        event_type: "plan_created",
        visibility: "author",
        summary: "已形成对话认知帧：creative_execution。",
        payload: { stage: "dialogue_frame_formed", frame_type: "creative_execution" },
      },
      {
        event_id: "evt_run_4_5",
        run_ref: "run_4",
        sequence: 5,
        event_type: "provider_progress",
        visibility: "author",
        summary: "对话判断已开始调用创作模型。",
        payload: {
          provider_event_type: "started",
          provider_call_ref: "pcall_plan",
          purpose: "conversation",
        },
      },
      {
        event_id: "evt_run_4_6",
        run_ref: "run_4",
        sequence: 6,
        event_type: "provider_progress",
        visibility: "author",
        summary: "对话判断已收到创作模型结果。",
        payload: {
          provider_event_type: "final_output",
          provider_call_ref: "pcall_plan",
          purpose: "conversation",
          content_length: 40,
        },
      },
      {
        event_id: "evt_run_4_7",
        run_ref: "run_4",
        sequence: 7,
        event_type: "plan_created",
        visibility: "author",
        summary: "已生成单步执行计划。",
        reason_codes: ["micro_plan_created"],
        payload: { stage: "micro_plan_created", plan_ref: "mp_run_4_2", action_count: 1 },
      },
      {
        event_id: "evt_run_4_8",
        run_ref: "run_4",
        sequence: 8,
        event_type: "gate_decided",
        visibility: "author",
        summary: "已通过工具执行授权：allow_tool。",
        payload: { decision_type: "allow_tool", decision_ref: "decision_1" },
      },
      {
        event_id: "evt_run_4_9",
        run_ref: "run_4",
        sequence: 9,
        event_type: "tool_started",
        visibility: "author",
        summary: "正在调用正文写作能力。",
        payload: { tool_name: "prose_writing" },
      },
      {
        event_id: "evt_run_4_10",
        run_ref: "run_4",
        sequence: 10,
        event_type: "provider_progress",
        visibility: "author",
        summary: "内容生成已开始调用创作模型。",
        payload: {
          provider_event_type: "started",
          provider_call_ref: "pcall_writer",
          purpose: "writer",
        },
      },
      {
        event_id: "evt_run_4_11",
        run_ref: "run_4",
        sequence: 11,
        event_type: "provider_progress",
        visibility: "author",
        summary: "质量复核已开始调用创作模型。",
        payload: {
          provider_event_type: "started",
          provider_call_ref: "pcall_evaluator",
          purpose: "evaluator",
        },
      },
      {
        event_id: "evt_run_4_12",
        run_ref: "run_4",
        sequence: 12,
        event_type: "tool_completed",
        visibility: "author",
        summary: "正文草稿已生成，质量复核已完成。",
        reason_codes: ["prose_writing_completed", "quality_review_completed"],
        payload: { tool_name: "prose_writing", review_status: "completed", finding_count: 0 },
      },
      {
        event_id: "evt_run_4_13",
        run_ref: "run_4",
        sequence: 13,
        event_type: "artifact_created",
        visibility: "author",
        summary: "已生成待采纳候选。",
      },
      {
        event_id: "evt_run_4_14",
        run_ref: "run_4",
        sequence: 14,
        event_type: "run_completed",
        visibility: "author",
        summary: "AgentRun 已完成。",
      },
    ];

    expect(agentRunExecutionBrief(events)?.path).toBe(
      "本轮路径：读取上下文 → 调用模型 → 模型判断 → 调用模型规划 → 制定计划 → 系统裁决 → 执行创作能力 → 调用写作模型 → 调用复核模型 → 质量复核 → 生成待采纳候选 → 完成回应",
    );
  });

  it("does not invent model calls when provider events are absent", () => {
    const events: AgentEventData[] = [
      {
        event_id: "evt_run_5_1",
        run_ref: "run_5",
        sequence: 1,
        event_type: "run_started",
        visibility: "author",
        summary: "AgentRun 已启动。",
      },
      {
        event_id: "evt_run_5_2",
        run_ref: "run_5",
        sequence: 2,
        event_type: "step_proposed",
        visibility: "author",
        summary: "正在读取当前角色阵容。",
      },
      {
        event_id: "evt_run_5_3",
        run_ref: "run_5",
        sequence: 3,
        event_type: "observation_recorded",
        visibility: "author",
        summary: "当前作品暂未读取到已确认角色。",
      },
      {
        event_id: "evt_run_5_4",
        run_ref: "run_5",
        sequence: 4,
        event_type: "turn_result_ready",
        visibility: "author",
        summary: "本轮回应已完成。",
      },
      {
        event_id: "evt_run_5_5",
        run_ref: "run_5",
        sequence: 5,
        event_type: "step_proposed",
        visibility: "author",
        summary: "正在基于角色阵容设计新的主要反派。",
      },
      {
        event_id: "evt_run_5_6",
        run_ref: "run_5",
        sequence: 6,
        event_type: "observation_recorded",
        visibility: "author",
        summary: "已生成 1 个待采纳角色草稿。",
      },
      {
        event_id: "evt_run_5_7",
        run_ref: "run_5",
        sequence: 7,
        event_type: "artifact_created",
        visibility: "author",
        summary: "已生成待采纳候选。",
      },
      {
        event_id: "evt_run_5_8",
        run_ref: "run_5",
        sequence: 8,
        event_type: "run_completed",
        visibility: "author",
        summary: "AgentRun 已完成。",
      },
    ];

    const brief = agentRunExecutionBrief(events);

    expect(brief?.path).toBe(
      "本轮路径：读取上下文 → 执行创作能力 → 生成待采纳候选 → 完成回应",
    );
    expect(brief?.path).not.toContain("调用模型");
  });
});
