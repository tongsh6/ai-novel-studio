// Design: docs/design/ui/46-state-and-feedback.md §9.5 / ADR-0036
// Prototype: novel-studio.pen → 46§9-agentic-loop-reasoning-flow (DM8gx)
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownText } from "./MarkdownText";

describe("MarkdownText read-only presentation", () => {
  it("renders Chinese emphasis, headings, lists, quotations, tables and fenced code", () => {
    const text =
      "## 风险比较\n\n**中文。**继续\n\n- 码头\n- 灯塔\n\n> 保留假设\n\n| 视角 | 风险 |\n| --- | --- |\n| 单视角 | 遗漏 |\n\n```text\n  缩进\n    第二行\n```";
    const html = renderToStaticMarkup(<MarkdownText text={text} />);
    expect(html).toMatch(/<h2[^>]*>风险比较<\/h2>/);
    expect(html).toContain("<strong>中文。</strong>继续");
    expect(html).toMatch(/<ul[\s>]/);
    expect(html).toMatch(/<li[^>]*>码头<\/li>/);
    expect(html).toMatch(/<blockquote[\s>]/);
    expect(html).toMatch(/<table[\s>]/);
    expect(html).toMatch(/<th[^>]*>视角<\/th>/);
    expect(html).toMatch(/<td[^>]*>遗漏<\/td>/);
    expect(html).toContain("  缩进\n    第二行");
    expect(html).not.toContain("## 风险比较");
    expect(html).not.toContain("| --- | --- |");
  });

  it("does not complete unfinished Markdown after cancellation or in history", () => {
    const html = renderToStaticMarkup(<MarkdownText text="未完成 **强调" streaming={false} />);
    expect(html).toContain("未完成 **强调");
    expect(html).not.toContain("<strong>");
  });

  it("completes only a live preview without mutating the source", () => {
    const text = "## 讨论\n\n**中文";
    const live = renderToStaticMarkup(<MarkdownText text={text} streaming />);
    const history = renderToStaticMarkup(<MarkdownText text={text} />);
    expect(live).toContain("<strong>中文</strong>");
    expect(history).toContain("**中文");
    expect(text).toBe("## 讨论\n\n**中文");
  });

  it("never creates active links, remote images or executable HTML", () => {
    const text =
      "[资料](https://example.test/doc)\n\n![图片说明](https://tracker.invalid/pixel)\n\n[危险](javascript:alert%281%29)\n\n[本机](file:///private/test)\n\n[应用](custom://command)\n\n<script>alert(1)</script>\n\n<iframe src='https://tracker.invalid'></iframe>\n\n<img src=x onerror=alert(1)>";
    const html = renderToStaticMarkup(<MarkdownText text={text} />);
    expect(html).toContain("资料");
    expect(html).toContain("https://example.test/doc");
    expect(html).toContain("图片说明");
    expect(html).not.toMatch(/<(?:a|img|script|iframe|button)\b/);
    // Escaped source text is not an active attribute; assert actual element boundaries.
    expect(html).not.toMatch(/<[^>]+\s(?:href|src|onerror|onclick)=/);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("file:///");
    expect(html).not.toContain("custom://");
    expect(html).not.toContain("https://tracker.invalid/pixel");
    expect(html).toContain("&lt;script&gt;");
  });
});
