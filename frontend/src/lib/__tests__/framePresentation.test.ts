import { describe, expect, it } from "vitest";

import { framePresentationForSummary, normalizeFrameType } from "../framePresentation";

describe("frame presentation", () => {
  it("maps creative exploration to an author-facing label", () => {
    const presentation = framePresentationForSummary({
      frame_type: "creative_exploration",
      dialogue_goal: "帮作者展开赛博修仙方向",
    });

    expect(presentation.visible).toBe(true);
    expect(presentation.label).toBe("探索方向");
    expect(presentation.tone).toBe("exploration");
    expect(presentation.title).toContain("帮作者展开赛博修仙方向");
  });

  it("maps execution candidate to generation label", () => {
    const presentation = framePresentationForSummary({
      frame_type: "execution_candidate",
      dialogue_goal: "撰写开篇场景正文",
    });

    expect(presentation.visible).toBe(true);
    expect(presentation.label).toBe("生成草稿");
    expect(presentation.tone).toBe("execution");
  });

  it("does not repeat the AI role with a casual reply badge", () => {
    const presentation = framePresentationForSummary({
      frame_type: "casual_reply",
      dialogue_goal: "继续普通创作讨论",
    });

    expect(presentation.visible).toBe(false);
    expect(presentation.label).toBe("AI 回应");
    expect(presentation.tone).toBe("reply");
  });

  it("lets a downgrade decision override an execution frame badge", () => {
    const presentation = framePresentationForSummary({
      frame_type: "execution_candidate",
      decision_type: "downgrade",
      dialogue_goal: "拆分过大的多步请求",
    });

    expect(presentation.visible).toBe(true);
    expect(presentation.label).toBe("降级为对话");
    expect(presentation.tone).toBe("reply");
  });

  it("normalizes frame type spelling without exposing raw enums", () => {
    expect(normalizeFrameType("Creative-Exploration")).toBe("creative_exploration");
  });

  it("falls back safely for unknown frame types", () => {
    const presentation = framePresentationForSummary({
      frame_type: "unknown_internal_value",
    });

    expect(presentation.visible).toBe(true);
    expect(presentation.label).toBe("本轮回应");
    expect(presentation.tone).toBe("default");
  });

  it("stays hidden when no frame summary is available", () => {
    expect(framePresentationForSummary(undefined).visible).toBe(false);
  });
});
