import { describe, expect, it } from "vitest";

import {
  archiveDetailRows,
  archiveDetailSummary,
  archiveDetailTitle,
  memoryTypeLabel,
} from "../archiveDetail";

describe("archiveDetail", () => {
  it("maps memory enum values to author-facing labels", () => {
    expect(memoryTypeLabel("FORESHADOWING")).toBe("伏笔");
    expect(memoryTypeLabel("WORLD_RULE")).toBe("世界规则");
    expect(memoryTypeLabel("CUSTOM_TYPE")).toBe("CUSTOM_TYPE");
  });

  it("builds character detail rows without exposing raw accepted status", () => {
    const rows = archiveDetailRows({
      kind: "character",
      item: {
        id: "char-1",
        name: "林澈",
        aliases: ["阿澈"],
        role: "主角",
        summary: "前企业安全员",
        status: "ACCEPTED",
        updated_at: "2026-05-18T12:00:00Z",
      },
    });

    expect(
      archiveDetailTitle({
        kind: "character",
        item: {
          id: "char-1",
          name: "林澈",
          aliases: [],
          role: null,
          summary: null,
        },
      }),
    ).toBe("林澈");
    expect(rows).toEqual(
      expect.arrayContaining([
        { label: "身份", value: "主角" },
        { label: "别名", value: "阿澈" },
        { label: "状态", value: "已采纳" },
      ]),
    );
  });

  it("builds memory detail rows from confirmed recallable archive data", () => {
    const detail = {
      kind: "memory" as const,
      item: {
        id: "mem-1",
        content: "灵能不能治愈记忆损伤",
        summary: "灵能的硬规则",
        type: "WORLD_RULE",
        scope: "WORK",
        status: "CONFIRMED",
        source_type: "AUTHOR_CONFIRMED",
        tags: ["硬规则"],
        weight: 0.75,
        confidence: 0.8,
        locked: true,
        recallable: true,
        reference_count: 2,
        version: 3,
        updated_at: "2026-05-18T12:00:00Z",
      },
    };

    expect(archiveDetailTitle(detail)).toBe("灵能不能治愈记忆损伤");
    expect(archiveDetailSummary(detail)).toBe("灵能的硬规则");
    expect(archiveDetailRows(detail)).toEqual(
      expect.arrayContaining([
        { label: "类型", value: "世界规则" },
        { label: "范围", value: "整部作品" },
        { label: "来源", value: "作者确认" },
        { label: "状态", value: "可召回" },
        { label: "保护", value: "已锁定" },
      ]),
    );
  });

  it("does not duplicate memory content as a summary", () => {
    const detail = {
      kind: "memory" as const,
      item: {
        id: "mem-2",
        content: "林澈背后的旧伤",
        summary: null,
        type: "FORESHADOWING",
        tags: [],
      },
    };

    expect(archiveDetailTitle(detail)).toBe("林澈背后的旧伤");
    expect(archiveDetailSummary(detail)).toBeNull();
  });
});
