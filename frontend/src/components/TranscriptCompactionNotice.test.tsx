import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TranscriptCompactionView } from "../lib/transcriptCompactionView";
import {
  TranscriptCompactionNotice,
  type TranscriptCompactionCopy,
} from "./TranscriptCompactionNotice";

// 与 47 §7.9 逐字一致的字面量文案；正式接线时由 copy.ts 注入同形对象。
const copy: TranscriptCompactionCopy = {
  summary: (count) => `较早的 ${count.toLocaleString("zh-CN")} 项创作过程已整理`,
  expandLabel: "查看已整理的较早创作过程",
  title: "已整理的较早记录",
  reason: (count) =>
    `为了保持这次创作始终清晰连贯，系统整理了较早的 ${count.toLocaleString("zh-CN")} 项已完成操作。`,
  kept: "原始记录仍然保留，不会被删除或改写。",
  sources: (list) => `涉及：${list}`,
  openHistory: "查看完整记录",
};

function view(overrides: Partial<TranscriptCompactionView> = {}): TranscriptCompactionView {
  return {
    count: 12,
    records: 1,
    sources: [],
    latestSequence: 9,
    ...overrides,
  };
}

function render(
  options: {
    expanded?: boolean;
    value?: TranscriptCompactionView;
  } = {},
): string {
  return renderToStaticMarkup(
    React.createElement(TranscriptCompactionNotice, {
      view: options.value ?? view(),
      expanded: options.expanded ?? false,
      copy,
      onToggle: () => undefined,
      onOpenHistory: vi.fn(),
    }),
  );
}

describe("TranscriptCompactionNotice", () => {
  it("C1：收起态渲染单行整理记录，且不渲染面板", () => {
    const html = render();

    expect(html).toContain("较早的 12 项创作过程已整理");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="查看已整理的较早创作过程"');
    expect(html).not.toContain("已整理的较早记录");
    expect(html).not.toContain("查看完整记录");
  });

  it("C2：展开态渲染面板五要素与 region 语义", () => {
    const html = render({ expanded: true });

    expect(html).toContain("已整理的较早记录");
    expect(html).toContain("为了保持这次创作始终清晰连贯，系统整理了较早的 12 项已完成操作。");
    expect(html).toContain("原始记录仍然保留，不会被删除或改写。");
    expect(html).toContain("查看完整记录");
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-expanded="true"');
  });

  it("C3：来源为空时不渲染涉及行；非空时渲染显示名", () => {
    expect(render({ expanded: true })).not.toContain("涉及：");
    expect(
      render({ expanded: true, value: view({ sources: ["角色档案", "第一章正文"] }) }),
    ).toContain("涉及：角色档案、第一章正文");
  });

  it("C4：作者可见文本不含技术词或百分比", () => {
    const html = render({ expanded: true, value: view({ sources: ["角色档案"] }) });

    for (const forbidden of [
      "上下文",
      "压缩",
      "token",
      "窗口",
      "checkpoint",
      "canonical",
      "compact",
      "%",
    ]) {
      expect(html).not.toContain(forbidden);
    }
    expect(html).not.toContain("已保存");
    expect(html).not.toContain("已采纳");
  });

  it("C5：数量使用本地化千分位，且不显示 0 项", () => {
    expect(render({ value: view({ count: 1234 }) })).toContain("较早的 1,234 项创作过程已整理");

    const empty = renderToStaticMarkup(
      React.createElement(TranscriptCompactionNotice, {
        view: view({ count: 0, records: 0 }),
        expanded: false,
        copy,
        onToggle: () => undefined,
        onOpenHistory: vi.fn(),
      }),
    );
    expect(empty).toBe("");
  });

  it("C6：细条可访问语义完整（展开标签 + 装饰图标隐藏）", () => {
    const html = render();

    expect(html).toContain('aria-label="查看已整理的较早创作过程"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<button type="button"');
  });

  it("C7：长来源列表完整渲染，不截断", () => {
    const sources = ["角色档案", "作品设定", "第一章正文", "第二章正文", "伏笔清单"];
    const html = render({ expanded: true, value: view({ sources }) });

    expect(html).toContain("涉及：角色档案、作品设定、第一章正文、第二章正文、伏笔清单");
  });
});
