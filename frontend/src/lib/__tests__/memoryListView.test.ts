import { describe, it, expect } from "vitest";
import {
  memoryTypeLabel,
  memoryStatusLabel,
  memoryScopeLabel,
  memoryStatusTone,
  isTerminalMemory,
  memoryRecallLabel,
  isMemoryRecalled,
} from "../memoryListView";

describe("memoryListView（记忆列表语义映射）", () => {
  it("把类型/状态/范围枚举映射到中文标签，未知值回退原值", () => {
    expect(memoryTypeLabel("CURRENT_STATE")).toBe("当前状态");
    expect(memoryTypeLabel("UNKNOWN_TYPE")).toBe("UNKNOWN_TYPE");
    expect(memoryStatusLabel("DEPRECATED")).toBe("已弃用");
    expect(memoryStatusLabel("WAT")).toBe("WAT");
    expect(memoryScopeLabel("WORK")).toBe("整部作品");
    expect(memoryScopeLabel("XYZ")).toBe("XYZ");
  });

  it("状态语义色调按真实状态分配，不是装饰", () => {
    expect(memoryStatusTone("CONFIRMED")).toBe("confirmed");
    expect(memoryStatusTone("STABILIZED")).toBe("stabilized");
    expect(memoryStatusTone("CONFLICTED")).toBe("conflicted");
    expect(memoryStatusTone("DEPRECATED")).toBe("terminal");
    expect(memoryStatusTone("ARCHIVED")).toBe("terminal");
    expect(memoryStatusTone("DRAFT")).toBe("draft");
    expect(memoryStatusTone("anything-else")).toBe("draft");
  });

  it("识别终态记忆（弃用/归档）", () => {
    expect(isTerminalMemory("DEPRECATED")).toBe(true);
    expect(isTerminalMemory("ARCHIVED")).toBe(true);
    expect(isTerminalMemory("CONFIRMED")).toBe(false);
  });

  it("召回标签：终态即使 recallable 也显示不召回（与 §4.5 召回过滤一致）", () => {
    expect(memoryRecallLabel({ status: "CONFIRMED", recallable: true })).toBe("可召回");
    expect(memoryRecallLabel({ status: "CONFIRMED", recallable: false })).toBe("不召回");
    // 终态记忆即使字段 recallable=true，也不进入普通召回。
    expect(memoryRecallLabel({ status: "DEPRECATED", recallable: true })).toBe("不召回");
    expect(memoryRecallLabel({ status: "ARCHIVED", recallable: true })).toBe("不召回");
    expect(isMemoryRecalled({ status: "ARCHIVED", recallable: true })).toBe(false);
    expect(isMemoryRecalled({ status: "STABILIZED", recallable: true })).toBe(true);
  });
});
