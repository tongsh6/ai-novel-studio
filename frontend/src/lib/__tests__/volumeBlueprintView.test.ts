import { describe, expect, it } from "vitest";

import { STRUCTURE_PANEL } from "../copy";
import type { VolumeBlueprintDto } from "../socket";
import { toVolumeBlueprintView } from "../volumeBlueprintView";

const fullBlueprint: VolumeBlueprintDto = {
  status: "CONFIRMED",
  source_ref: "artifact:artifact-1",
  goal_conflict: "解决黑市灵脉断供",
  arc_stage: "从隐忍到反击",
  map_boundary: "从主城到黑市地底",
  subplots_start: "苏禾的身份疑云",
  subplots_advance: "暗扣账本线",
  subplots_close: "老周的救命恩情",
  climaxes: "黑市拍卖会、灵脉爆破",
  payoff_density: "每 3 章一次小爽点",
  buffers: "第 12 章旧巷养伤",
  new_characters: "拍卖师殷九",
  new_settings: "灵脉配额制",
  new_maps: "地底黑市",
};

describe("volumeBlueprintView", () => {
  it("returns null when a volume has no blueprint (honest absence)", () => {
    expect(toVolumeBlueprintView(undefined)).toBeNull();
    expect(toVolumeBlueprintView(null)).toBeNull();
  });

  it("renders the six grouped rows from a complete blueprint", () => {
    const view = toVolumeBlueprintView(fullBlueprint);

    expect(view).not.toBeNull();
    expect(view?.heading).toBe("卷蓝图");
    expect(view?.statusLabel).toBe("【已确认】");
    expect(view?.rows).toEqual([
      { key: "goal_conflict", label: "目标冲突：", value: "解决黑市灵脉断供" },
      { key: "arc_stage", label: "弧光阶段：", value: "从隐忍到反击" },
      { key: "map_boundary", label: "地图边界：", value: "从主城到黑市地底" },
      {
        key: "subplots",
        label: "支线：",
        value: "启动：苏禾的身份疑云；推进：暗扣账本线；收束：老周的救命恩情",
      },
      {
        key: "pacing",
        label: "高潮与节奏：",
        value:
          "高潮章：黑市拍卖会、灵脉爆破；爽点密度：每 3 章一次小爽点；缓冲章：第 12 章旧巷养伤",
      },
      {
        key: "new_elements",
        label: "新要素：",
        value: "新人物：拍卖师殷九；新设定：灵脉配额制；新地图：地底黑市",
      },
    ]);
  });

  it("renders only the fields that exist and never fabricates missing sub-slots", () => {
    const view = toVolumeBlueprintView({
      goal_conflict: "查清灵气账单异常",
      subplots_start: "灵气账单线",
      buffers: "旧城歇脚",
      new_maps: "旧城地下",
    });

    expect(view?.statusLabel).toBeUndefined();
    expect(view?.rows).toEqual([
      { key: "goal_conflict", label: "目标冲突：", value: "查清灵气账单异常" },
      { key: "subplots", label: "支线：", value: "启动：灵气账单线" },
      { key: "pacing", label: "高潮与节奏：", value: "缓冲章：旧城歇脚" },
      { key: "new_elements", label: "新要素：", value: "新地图：旧城地下" },
    ]);
  });

  it("returns null for a blueprint whose content slots are all empty", () => {
    expect(toVolumeBlueprintView({})).toBeNull();
    // 只有元数据（状态/来源）没有内容槽：不假装有卷蓝图可核对。
    expect(toVolumeBlueprintView({ status: "CONFIRMED" })).toBeNull();
    expect(toVolumeBlueprintView({ status: "TENTATIVE", source_ref: "artifact:a-1" })).toBeNull();
    expect(
      toVolumeBlueprintView({
        goal_conflict: "   ",
        subplots_start: "",
        arc_stage: 42,
      } as unknown as VolumeBlueprintDto),
    ).toBeNull();
  });

  it("returns null for malformed blueprint payloads instead of throwing", () => {
    const malformed = ["not-a-map", 42, []] as unknown as VolumeBlueprintDto[];
    for (const blueprint of malformed) {
      expect(toVolumeBlueprintView(blueprint)).toBeNull();
    }
  });

  it("maps the three blueprint statuses and omits unknown ones", () => {
    const withStatus = (status: string) =>
      toVolumeBlueprintView({ status, goal_conflict: "解决断供" });

    expect(withStatus("TENTATIVE")?.statusLabel).toBe("【暂定】");
    expect(withStatus("CONFIRMED")?.statusLabel).toBe("【已确认】");
    expect(withStatus("AUTHOR_EDITED")?.statusLabel).toBe("【作者改写】");
    // 未知状态不把内部枚举值直接暴露给作者；内容行不受影响。
    expect(withStatus("DRAFT")?.statusLabel).toBeUndefined();
    expect(withStatus("DRAFT")?.rows).toHaveLength(1);
  });

  it("trims raw text and keeps group sub-slot order independent of input order", () => {
    const view = toVolumeBlueprintView({
      status: " CONFIRMED ",
      goal_conflict: "  解决断供  ",
      subplots_close: "  收束支线  ",
      subplots_start: "启动支线",
    });

    expect(view?.statusLabel).toBe("【已确认】");
    expect(view?.rows).toEqual([
      { key: "goal_conflict", label: "目标冲突：", value: "解决断供" },
      { key: "subplots", label: "支线：", value: "启动：启动支线；收束：收束支线" },
    ]);
  });

  it("keeps the visible copy centralized under STRUCTURE_PANEL.volumeBlueprint", () => {
    expect(STRUCTURE_PANEL.volumeBlueprint.heading).toBe("卷蓝图");
    expect(STRUCTURE_PANEL.volumeBlueprint.statusLabels.CONFIRMED).toBe("【已确认】");
    expect(STRUCTURE_PANEL.volumeBlueprint.fieldLabels.pacing).toBe("高潮与节奏：");
    expect(STRUCTURE_PANEL.volumeBlueprint.partLabels.payoff_density).toBe("爽点密度：");
    expect(STRUCTURE_PANEL.volumeBlueprint.partsLine(["启动：甲", "收束：乙"])).toBe(
      "启动：甲；收束：乙",
    );
  });
});
