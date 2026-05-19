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
        { context_ref: "ctx_1", source_type: "current_work" },
        { context_ref: "mem_1", source_type: "memory" },
      ],
    });

    expect(view?.decisionLabel).toBe("自然回复");
    expect(view?.primaryReason).toContain("自然语言回应");
    expect(view?.goal).toBe("讨论角色动机");
    expect(view?.contextSources.map((source) => source.label)).toEqual([
      "当前作品背景",
      "已确认设定",
    ]);
    expect(JSON.stringify(view)).not.toContain("trace_1");
    expect(JSON.stringify(view)).not.toContain("ctx_1");
    expect(JSON.stringify(view)).not.toContain("mem_1");
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
