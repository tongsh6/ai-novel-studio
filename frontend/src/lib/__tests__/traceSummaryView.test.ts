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

    expect(view?.decisionLabel).toBe("自然回复");
    expect(view?.primaryReason).toContain("自然语言回应");
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

  it("returns null when there is no trace summary", () => {
    expect(toAuthorTraceSummary(null)).toBeNull();
    expect(toAuthorTraceSummary(undefined)).toBeNull();
  });
});
