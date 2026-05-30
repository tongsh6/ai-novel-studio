import { describe, expect, it } from "vitest";

import {
  formatWordCount,
  normalizeReadingToc,
} from "../readingProjection";
import type { TocData } from "../socket";

describe("normalizeReadingToc word counts", () => {
  it("surfaces per-chapter and total effective word counts", () => {
    const toc: TocData = {
      total_word_count: 1234,
      volumes: [
        {
          id: "v1",
          title: "第一卷",
          seq: 1,
          chapters: [
            { id: "c1", title: "第一章", seq: 1, word_count: 1000 },
            { id: "c2", title: "第二章", seq: 2, word_count: 234 },
          ],
        },
      ],
    };

    const view = normalizeReadingToc(toc);

    expect(view?.totalWordCount).toBe(1234);
    expect(view?.volumes[0].chapters[0].wordCount).toBe(1000);
    expect(view?.volumes[0].chapters[1].wordCount).toBe(234);
  });

  it("defaults missing or invalid counts to 0", () => {
    const toc: TocData = {
      volumes: [
        {
          id: "v1",
          title: "第一卷",
          seq: 1,
          // word_count omitted by an older backend
          chapters: [{ id: "c1", title: "第一章", seq: 1 }],
        },
      ],
    };

    const view = normalizeReadingToc(toc);

    expect(view?.totalWordCount).toBe(0);
    expect(view?.volumes[0].chapters[0].wordCount).toBe(0);
  });

  it("returns null for a null toc", () => {
    expect(normalizeReadingToc(null)).toBeNull();
  });
});

describe("formatWordCount", () => {
  it("formats with a localized number and the 字 unit", () => {
    expect(formatWordCount(1234)).toBe("1,234 字");
    expect(formatWordCount(0)).toBe("0 字");
  });
});
