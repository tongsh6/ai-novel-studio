import { describe, expect, it } from "vitest";

import {
  formatWordCount,
  normalizeChapterContentTitle,
  normalizeReadingToc,
} from "../readingProjection";
import type { ChapterContent, TocData } from "../socket";

describe("normalizeChapterContentTitle scene titles (B21)", () => {
  // B21：首次 append 的整章正文落「场景 N」占位（后端不再回填计划第 1 场名），阅读端必须
  // 隐藏这类生成占位标题，否则整章正文会挂到假的「第 1 场」标题下。
  it("hides generated scene placeholders without dropping the prose", () => {
    const chapterContent: ChapterContent = {
      title: "第01章：底层灵气账单",
      scenes: [
        { title: "场景 1", content: "整章正文第一段。" },
        { title: "第 1 场", content: "第二条占位。" },
        { title: "场景一", content: "第三条占位。" },
        { title: "1", content: "第四条占位。" },
      ],
    };

    const readable = normalizeChapterContentTitle(chapterContent);

    expect(readable.scenes.map((scene) => scene.title)).toEqual(["", "", "", ""]);
    expect(readable.scenes.map((scene) => scene.content)).toEqual([
      "整章正文第一段。",
      "第二条占位。",
      "第三条占位。",
      "第四条占位。",
    ]);
    expect(readable.title).toBe("第01章：底层灵气账单");
  });

  // NEM04 不回归：第二次 append 吃到的真实计划场次名是产品语义，必须继续可见。
  it("keeps real planned scene titles", () => {
    const chapterContent: ChapterContent = {
      title: "第01章：底层灵气账单",
      scenes: [
        { title: "场景 1", content: "整章正文第一段。" },
        { title: "夜巡", content: "夜巡续写段正文。" },
      ],
    };

    const readable = normalizeChapterContentTitle(chapterContent);

    expect(readable.scenes.map((scene) => scene.title)).toEqual(["", "夜巡"]);
  });

  it("maps chapter-identity scene titles to the selected chapter title", () => {
    const chapterContent: ChapterContent = {
      title: "已采纳内容",
      scenes: [{ title: "第01章：底层灵气账单", content: "正文。" }],
    };

    const readable = normalizeChapterContentTitle(chapterContent, {
      id: "c1",
      title: "第01章：底层灵气账单",
      seq: 1,
      wordCount: 120,
      status: "ok",
    });

    expect(readable.title).toBe("第01章：底层灵气账单");
    expect(readable.scenes[0].title).toBe("第01章：底层灵气账单");
  });

  it("hides internal projection ids and empty scene titles", () => {
    const chapterContent: ChapterContent = {
      title: "as_42",
      scenes: [
        { title: "as_42", content: "正文一。" },
        { title: "   ", content: "正文二。" },
      ],
    };

    const readable = normalizeChapterContentTitle(chapterContent);

    expect(readable.title).toBe("已采纳片段");
    expect(readable.scenes.map((scene) => scene.title)).toEqual(["", ""]);
  });
});

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
