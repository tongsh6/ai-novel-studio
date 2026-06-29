import { describe, expect, it } from "vitest";

import { toAuthorTraceSummary } from "../traceSummaryView";

describe("traceSummaryView", () => {
  it("maps reply-only trace summaries to author-safe Chinese explanations", () => {
    const view = toAuthorTraceSummary({
      trace_ref: "trace_1",
      decision_type: "reply_only",
      dialogue_goal: "讨论角色动机",
      no_tool_reason: "no_tool_needed",
      context_refs: [
        { context_ref: "ctx_1", source_type: "current_work", summary: "灵源纪元 / 林烬" },
        {
          context_ref: "mem_1",
          source_type: "memory",
          summary: "林瑶失踪指向灵源矿区，林烬去矿区追查线索。",
        },
        {
          context_ref: "conv_1",
          source_type: "conversation",
          summary: "作者：前一轮讨论动机。 AI：可以加强亲情线。",
        },
      ],
    });

    expect(view?.decisionLabel).toBe("AI 回应");
    expect(view?.primaryReason).toContain("AgentRun 对话模式");
    expect(view?.goal).toBe("讨论角色动机");
    expect(view?.contextSources.map((source) => source.label)).toEqual([
      "当前作品背景",
      "已确认设定",
      "近期对话",
    ]);
    expect(view?.contextSources.map((source) => source.summary)).toEqual([
      "灵源纪元 / 林烬",
      "林瑶失踪指向灵源矿区，林烬去矿区追查线索。",
      "上一轮围绕「前一轮讨论动机。」展开，AI 已给出回应。",
    ]);
    expect(JSON.stringify(view)).not.toContain("trace_1");
    expect(JSON.stringify(view)).not.toContain("ctx_1");
    expect(JSON.stringify(view)).not.toContain("mem_1");
  });

  it("drops unsafe context summaries from author trace text", () => {
    const view = toAuthorTraceSummary({
      decision_type: "reply_only",
      context_refs: [
        { context_ref: "ctx_1", source_type: "memory", summary: "raw prompt: ctx_1 debug" },
      ],
    });

    expect(view?.contextSources[0]?.label).toBe("已确认设定");
    expect(view?.contextSources[0]?.summary).toBeNull();
    expect(JSON.stringify(view)).not.toContain("raw prompt");
    expect(JSON.stringify(view)).not.toContain("ctx_1");
  });

  it("renders active session transcript as a distinct author-safe source", () => {
    const view = toAuthorTraceSummary({
      decision_type: "reply_only",
      context_refs: [
        {
          context_ref: "ctx_session",
          source_type: "session_transcript",
          summary: "user: 当前会话确认当前蓝桥计划 assistant: 已记录当前蓝桥计划",
        },
      ],
    });

    expect(view?.contextSources).toEqual([
      {
        key: "session_transcript",
        label: "当前会话记录",
        summary: "上一轮围绕「当前会话确认当前蓝桥计划」展开，AI 已给出回应。",
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("user:");
    expect(JSON.stringify(view)).not.toContain("assistant:");
  });

  it("does not expose unknown machine reason codes as primary author text", () => {
    const view = toAuthorTraceSummary({
      decision_type: "downgrade",
      no_tool_reason: "internal_provider_policy",
      first_blocking_gate: "action_scope",
      reason_codes: ["unknown_raw_code"],
    });

    const visibleText = JSON.stringify(view);
    expect(view?.primaryReason).toBe("系统保留了本轮的安全解释摘要。");
    expect(visibleText).toContain("当前请求超出本轮可执行范围。");
    expect(visibleText).not.toContain("internal_provider_policy");
    expect(visibleText).not.toContain("unknown_raw_code");
  });

  it("normalizes or hides low-value model-generated dialogue goals", () => {
    expect(
      toAuthorTraceSummary({
        decision_type: "reply_only",
        dialogue_goal: "用户想讨论并确定气质氛围",
      })?.goal,
    ).toBe("讨论气质氛围");

    expect(
      toAuthorTraceSummary({
        decision_type: "reply_only",
        dialogue_goal: "气质氛围",
      })?.goal,
    ).toBeNull();
  });

  it("hides low-value current work sources", () => {
    const view = toAuthorTraceSummary({
      decision_type: "reply_only",
      context_refs: [
        { context_ref: "ctx_1", source_type: "current_work", summary: "未命名作品" },
        { context_ref: "ctx_2", source_type: "memory", summary: "林烬要去灵源矿区。" },
      ],
    });

    expect(view?.contextSources.map((source) => source.label)).toEqual(["已确认设定"]);
  });

  it("uses author-safe labels for internal tool names", () => {
    const view = toAuthorTraceSummary({
      decision_type: "tool_dispatched",
      no_tool_reason: "tool_was_dispatched",
      tool_name: "internal_story_generation_v9",
      tool_status: "ok",
    });

    const visibleText = JSON.stringify(view);
    expect(visibleText).toContain("创作工具");
    expect(visibleText).toContain("已完成");
    expect(visibleText).not.toContain("internal_story_generation_v9");
  });

  it("adds persisted replay integrity without exposing trace ids", () => {
    const view = toAuthorTraceSummary({
      trace_ref: "trace_secret",
      decision_type: "reply_only",
      no_tool_reason: "no_tool_needed",
      replay_result_status: "complete",
      replay_provider_called: false,
    });

    expect(view?.detailLines).toContain("已从持久 trace 生成结构化回放。");
    expect(view?.detailLines).toContain("回放只读取已保存记录，不会重新调用模型。");
    expect(JSON.stringify(view)).not.toContain("trace_secret");
  });

  it("renders VS-00D quality diagnosis envelope as author-safe detail lines", () => {
    const view = toAuthorTraceSummary({
      decision_type: "reply_only",
      dialogue_goal: "诊断本章爽感不足",
      no_tool_reason: "no_tool_needed",
      ai_message_envelope: {
        novel_layer: {
          quality_gates: [
            "conflict_pressure",
            "cost_visibility",
            "reader_payoff",
            "protagonist_agency",
          ],
        },
        work_state_layer: {
          context_refs: [
            { source_type: "current_work", summary: "灵源纪元 / 林烬" },
            { source_type: "memory", summary: "林瑶失踪指向灵源矿区" },
          ],
        },
        turn_guidance_layer: {
          guidance_mode: "quality",
          element_focus: [
            "conflict_pressure",
            "cost_visibility",
            "reader_payoff",
            "protagonist_agency",
          ],
          missing_questions: ["缺本章已采纳正文片段，不能逐句诊断。"],
        },
      },
    });

    const visibleText = JSON.stringify(view);
    expect(view?.detailLines).toContain(
      "本轮按质量诊断处理，只给诊断和结构修订建议，不会改写或写入作品。",
    );
    expect(visibleText).toContain("质量关注点：冲突压力、代价可见、读者回报、主角能动性。");
    expect(visibleText).toContain("小说层质量门：冲突压力、代价可见、读者回报、主角能动性。");
    expect(visibleText).toContain("作品层依据来自：当前作品背景、已确认设定。");
    expect(visibleText).toContain("缺少正文片段时，只能基于摘要或上下文给结构建议。");
    expect(visibleText).not.toContain("trace_");
    expect(visibleText).not.toContain("ctx_");
    expect(visibleText).not.toContain("raw prompt");
  });

  it("marks missing work state from quality diagnosis envelope", () => {
    const view = toAuthorTraceSummary({
      decision_type: "reply_only",
      ai_message_envelope: {
        work_state_layer: {
          context_refs: [],
          snapshot_summary: { status: "missing", reason: "no_current_work_snapshot" },
          chapter_summary: { status: "missing", reason: "no_chapter_summary" },
        },
        turn_guidance_layer: {
          guidance_mode: "quality",
          element_focus: ["conflict_pressure"],
        },
      },
    });

    expect(view?.detailLines).toContain(
      "作品层依据缺失或不足，系统已显式标记缺失，不会编造作品事实。",
    );
  });

  it("keeps visible sources while marking partial WorkState missing", () => {
    const view = toAuthorTraceSummary({
      decision_type: "reply_only",
      ai_message_envelope: {
        work_state_layer: {
          context_refs: [{ source_type: "current_work", summary: "空白诊断作品" }],
          snapshot_summary: "空白诊断作品",
          chapter_state: { status: "missing", reason: "no_chapter_state" },
          chapter_summary: { status: "missing", reason: "no_chapter_summary" },
        },
        turn_guidance_layer: {
          guidance_mode: "quality",
          missing_questions: ["缺本章已采纳正文片段，不能逐句诊断。"],
        },
      },
    });

    expect(view?.detailLines).toContain("作品层依据来自：当前作品背景。");
    expect(view?.detailLines).toContain(
      "作品层依据缺失或不足，系统已显式标记缺失，不会编造作品事实。",
    );
    expect(view?.detailLines).toContain("缺少正文片段时，只能基于摘要或上下文给结构建议。");
  });

  it("returns null when there is no trace summary", () => {
    expect(toAuthorTraceSummary(null)).toBeNull();
    expect(toAuthorTraceSummary(undefined)).toBeNull();
  });
});
