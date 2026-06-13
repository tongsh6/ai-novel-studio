// Design: docs/design/ui/44-reading-mode.md §3 (accepted projection display)
// Prototype: novel-studio.pen → 44§3-reading-mode-stale (hEGz0)
import type { TocData, WorkAudit, ChapterContent } from "./socket";
import { normalizeVisibleWorkTitle } from "./workspaceRuntimeState";
import { READING } from "./copy";

export type ReadingChapterStatus = "empty" | "short" | "ok";

export interface ReadingChapterView {
  id: string;
  title: string;
  seq: number;
  wordCount: number;
  status: ReadingChapterStatus | null;
}

export interface ReadingVolumeView {
  id: string;
  title: string;
  seq: number;
  chapters: ReadingChapterView[];
}

export interface ReadingWorkAudit {
  totalWordCount: number;
  totalTarget: number;
  minChapterWords: number;
  chapterCount: number;
  shortChapterCount: number;
  emptyChapterCount: number;
  meetsThreshold: boolean;
}

export interface ReadingTocView {
  totalWordCount: number;
  audit: ReadingWorkAudit | null;
  volumes: ReadingVolumeView[];
}

export function readingWorkTitle(title: string | null): string {
  return normalizeVisibleWorkTitle(title);
}

export function normalizeReadingToc(toc: TocData | null): ReadingTocView | null {
  if (!toc) return null;

  return {
    totalWordCount: safeWordCount(toc.total_word_count),
    audit: normalizeWorkAudit(toc.audit),
    volumes: toc.volumes.map((volume) => ({
      ...volume,
      title: readableTitle(volume.title, "已采纳内容"),
      chapters: volume.chapters.map((chapter) => ({
        ...chapter,
        title: readableTitle(chapter.title, `已采纳片段 ${chapter.seq || 1}`),
        wordCount: safeWordCount(chapter.word_count),
        status: normalizeChapterStatus(chapter.audit_status),
      })),
    })),
  };
}

function normalizeWorkAudit(audit: WorkAudit | null | undefined): ReadingWorkAudit | null {
  if (!audit) return null;

  return {
    totalWordCount: safeWordCount(audit.total_word_count),
    totalTarget: safeWordCount(audit.total_target),
    minChapterWords: safeWordCount(audit.min_chapter_words),
    chapterCount: safeWordCount(audit.chapter_count),
    shortChapterCount: safeWordCount(audit.short_chapter_count),
    emptyChapterCount: safeWordCount(audit.empty_chapter_count),
    meetsThreshold: audit.meets_threshold === true,
  };
}

function normalizeChapterStatus(value: unknown): ReadingChapterStatus | null {
  return value === "empty" || value === "short" || value === "ok" ? value : null;
}

function safeWordCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function formatWordCount(value: number): string {
  return `${value.toLocaleString()} ${READING.wordsUnit}`;
}

export function normalizeChapterContentTitle(
  chapterContent: ChapterContent,
  selectedChapter?: ReadingChapterView,
): ChapterContent {
  return {
    ...chapterContent,
    title: selectedChapter?.title ?? readableTitle(chapterContent.title, "已采纳片段"),
    scenes: chapterContent.scenes.map((scene) => ({
      ...scene,
      title: scene.title === chapterContent.title
        ? selectedChapter?.title ?? readableTitle(scene.title, "已采纳片段")
        : readableTitle(scene.title, "正文片段"),
    })),
  };
}

function readableTitle(title: string | null | undefined, fallback: string): string {
  const normalized = title?.trim();
  if (!normalized || isInternalProjectionTitle(normalized)) return fallback;
  return normalized;
}

function isInternalProjectionTitle(title: string): boolean {
  return /^as_\d+$/i.test(title);
}
