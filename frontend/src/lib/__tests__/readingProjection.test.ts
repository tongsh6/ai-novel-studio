import { describe, expect, it } from "vitest";

import { formatWordCount, normalizeReadingToc } from "../readingProjection";
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

describe("normalizeReadingToc audit (P1)", () => {
  it("surfaces per-chapter audit status and work audit summary", () => {
    const toc: TocData = {
      total_word_count: 1500,
      audit: {
        stage: "p1",
        min_chapter_words: 1000,
        total_target: 100000,
        total_word_count: 1500,
        chapter_count: 2,
        ok_chapter_count: 1,
        short_chapter_count: 1,
        empty_chapter_count: 0,
        meets_threshold: false,
      },
      volumes: [
        {
          id: "v1",
          title: "第一卷",
          seq: 1,
          chapters: [
            { id: "c1", title: "第一章", seq: 1, word_count: 1200, audit_status: "ok" },
            { id: "c2", title: "第二章", seq: 2, word_count: 300, audit_status: "short" },
          ],
        },
      ],
    };

    const view = normalizeReadingToc(toc);

    expect(view?.volumes[0].chapters[0].status).toBe("ok");
    expect(view?.volumes[0].chapters[1].status).toBe("short");
    expect(view?.audit?.totalTarget).toBe(100000);
    expect(view?.audit?.minChapterWords).toBe(1000);
    expect(view?.audit?.shortChapterCount).toBe(1);
    expect(view?.audit?.meetsThreshold).toBe(false);
  });

  it("surfaces empty-chapter marker", () => {
    const toc: TocData = {
      total_word_count: 0,
      audit: {
        stage: "p1",
        total_target: 100000,
        chapter_count: 1,
        empty_chapter_count: 1,
        meets_threshold: false,
      },
      volumes: [
        {
          id: "v1",
          title: "第一卷",
          seq: 1,
          chapters: [{ id: "c1", title: "第一章", seq: 1, word_count: 0, audit_status: "empty" }],
        },
      ],
    };

    expect(normalizeReadingToc(toc)?.volumes[0].chapters[0].status).toBe("empty");
    expect(normalizeReadingToc(toc)?.audit?.emptyChapterCount).toBe(1);
  });

  it("reflects meets_threshold true", () => {
    const toc: TocData = {
      total_word_count: 100000,
      audit: {
        stage: "p1",
        total_target: 100000,
        total_word_count: 100000,
        chapter_count: 100,
        short_chapter_count: 0,
        empty_chapter_count: 0,
        meets_threshold: true,
      },
      volumes: [],
    };

    expect(normalizeReadingToc(toc)?.audit?.meetsThreshold).toBe(true);
  });

  it("falls back to null audit / null status for a legacy payload", () => {
    const legacy: TocData = {
      volumes: [
        {
          id: "v1",
          title: "第一卷",
          seq: 1,
          chapters: [{ id: "c1", title: "第一章", seq: 1, word_count: 10 }],
        },
      ],
    };

    const view = normalizeReadingToc(legacy);

    expect(view?.audit).toBeNull();
    expect(view?.volumes[0].chapters[0].status).toBeNull();
  });
});
