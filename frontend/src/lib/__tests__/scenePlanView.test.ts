import { describe, expect, it } from "vitest";

import { STRUCTURE_PANEL } from "../copy";
import { toScenePlansView } from "../scenePlanView";
import type { ScenePlanDto } from "../socket";

const fullPlan: ScenePlanDto = {
  title: "对账",
  goal: "核对暗扣并确认被抽走的频段",
  agendas: "沈洛要证据、摊主要脱身",
  emotion: "压抑",
  opposition: "摊主拖延并暗中报信",
  turn: "账单残页暴露抽签记录",
  consequence: "暗扣被坐实、打草惊蛇",
  reader_learns: "公司抽走频段",
  protagonist_learns: "账单上有内部编号",
  remains_hidden: "幕后主使",
  surface_topic: "对账寒暄",
  hidden_conflict: "互相试探底线",
  sensory: "潮湿霉味、风扇噪音",
};

describe("scenePlanView", () => {
  it("returns null when a chapter has no scene plans (honest absence)", () => {
    expect(toScenePlansView(undefined)).toBeNull();
    expect(toScenePlansView(null)).toBeNull();
    expect(toScenePlansView([])).toBeNull();
  });

  it("turns the existing three slots plus scene craft into grouped visible rows", () => {
    const view = toScenePlansView([fullPlan]);
    expect(view).not.toBeNull();
    expect(view?.heading).toBe("场次计划（1 场）");
    expect(view?.items).toHaveLength(1);

    const scene = view!.items[0];
    expect(scene.title).toBe("1. 对账");
    expect(scene.rows).toEqual([
      { key: "goal", label: "目标：", value: "核对暗扣并确认被抽走的频段" },
      { key: "agendas", label: "议程：", value: "沈洛要证据、摊主要脱身" },
      { key: "emotion", label: "情绪：", value: "压抑" },
      {
        key: "causal",
        label: "因果：",
        value: "阻力：摊主拖延并暗中报信；转折：账单残页暴露抽签记录；后果：暗扣被坐实、打草惊蛇",
      },
      {
        key: "information",
        label: "信息差：",
        value: "读者得知：公司抽走频段；主角得知：账单上有内部编号；仍隐藏：幕后主使",
      },
      { key: "dialogue", label: "对白：", value: "表面谈：对账寒暄；暗里争：互相试探底线" },
      { key: "sensory", label: "感官：", value: "潮湿霉味、风扇噪音" },
    ]);
  });

  it("renders only the fields that exist and never fabricates missing sub-slots", () => {
    const view = toScenePlansView([
      {
        title: "夜巡",
        goal: "确认巷道尽头谁在跟踪",
        opposition: "跟踪者消失在拐角",
        reader_learns: "巷口有新的脚印",
        surface_topic: "巡夜寒暄",
        sensory: "雨后青苔味",
      },
    ]);

    expect(view?.items[0].rows).toEqual([
      { key: "goal", label: "目标：", value: "确认巷道尽头谁在跟踪" },
      { key: "causal", label: "因果：", value: "阻力：跟踪者消失在拐角" },
      { key: "information", label: "信息差：", value: "读者得知：巷口有新的脚印" },
      { key: "dialogue", label: "对白：", value: "表面谈：巡夜寒暄" },
      { key: "sensory", label: "感官：", value: "雨后青苔味" },
    ]);
  });

  it("keeps a scene with only a title visible without inventing rows", () => {
    const view = toScenePlansView([{ title: "过场" }]);

    expect(view?.items[0].title).toBe("1. 过场");
    expect(view?.items[0].rows).toEqual([]);
  });

  it("numbers visible scenes in plan order and trims raw text", () => {
    const view = toScenePlansView([
      { title: "  对账  ", goal: "  核对暗扣  " },
      { title: "夜巡", emotion: "  警觉  " },
    ]);

    expect(view?.heading).toBe("场次计划（2 场）");
    expect(view?.items.map((item) => item.title)).toEqual(["1. 对账", "2. 夜巡"]);
    expect(view?.items[1].rows).toEqual([{ key: "emotion", label: "情绪：", value: "警觉" }]);
  });

  it("skips scenes without a title and drops per-field non-string or blank values", () => {
    const malformed = [
      { title: "", goal: "无场名" },
      { title: "   " },
      null,
      "not-a-plan",
      {
        title: "对账",
        goal: "   ",
        opposition: 42,
        sensory: "潮湿霉味",
      },
    ] as unknown as ScenePlanDto[];

    const view = toScenePlansView(malformed);

    expect(view?.heading).toBe("场次计划（1 场）");
    expect(view?.items[0].title).toBe("1. 对账");
    expect(view?.items[0].rows).toEqual([{ key: "sensory", label: "感官：", value: "潮湿霉味" }]);
  });

  it("returns null when every scene entry is unusable", () => {
    const malformed = [{ title: "" }, null] as unknown as ScenePlanDto[];
    expect(toScenePlansView(malformed)).toBeNull();
  });

  it("keeps the visible copy centralized under structurePanel.scenePlans", () => {
    expect(STRUCTURE_PANEL.scenePlans.heading(2)).toBe("场次计划（2 场）");
    expect(STRUCTURE_PANEL.scenePlans.sceneTitle(3, "夜巡")).toBe("3. 夜巡");
    expect(STRUCTURE_PANEL.scenePlans.partsLine(["阻力：甲", "转折：乙"])).toBe(
      "阻力：甲；转折：乙",
    );
  });
});
