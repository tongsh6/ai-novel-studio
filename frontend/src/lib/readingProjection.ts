// Design: docs/design-v2/ui-design/44-reading-mode.md §3 (accepted projection display)
// Prototype: novel-studio-v2.pen → 44§3-reading-mode-stale (hEGz0)
import type { TocData, ChapterContent } from "./socket";
import { normalizeVisibleWorkTitle } from "./workspaceRuntimeState";
import { READING } from "./copy";

export interface ReadingChapterView {
  id: string;
  title: string;
  seq: number;
  wordCount: number;
}

export interface ReadingVolumeView {
  id: string;
  title: string;
  seq: number;
  chapters: ReadingChapterView[];
}

export interface ReadingTocView {
  totalWordCount: number;
  volumes: ReadingVolumeView[];
}

export function readingWorkTitle(title: string | null): string {
  return normalizeVisibleWorkTitle(title);
}

export function normalizeReadingToc(toc: TocData | null): ReadingTocView | null {
  if (!toc) return null;

  return {
    totalWordCount: safeWordCount(toc.total_word_count),
    volumes: toc.volumes.map((volume) => ({
      ...volume,
      title: readableTitle(volume.title, "已采纳内容"),
      chapters: volume.chapters.map((chapter) => ({
        ...chapter,
        title: readableTitle(chapter.title, `已采纳片段 ${chapter.seq || 1}`),
        wordCount: safeWordCount(chapter.word_count),
      })),
    })),
  };
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
