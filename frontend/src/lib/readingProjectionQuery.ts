// Design: docs/design/ui/44-reading-mode.md §3–4; docs/design/adr/ADR-0016-projection-hint-ui-v3.md
// Prototype: novel-studio.pen → 44§3-reading-mode-stale (hEGz0)
import { queryOptions } from "@tanstack/react-query";
import type { Channel } from "phoenix";
import { getToc, getChapterContent } from "./socket";
import { READING } from "./copy";

export const readingProjectionQueryKey = (workId: string | null) =>
  ["reading-projection", workId] as const;

export function readingProjectionQuery(channel: Channel | null, workId: string | null) {
  return queryOptions({
    queryKey: readingProjectionQueryKey(workId),
    enabled: Boolean(channel && workId),
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!channel || !workId) throw new Error(READING.connectionRequired);
      const toc = await getToc(channel, workId);
      signal.throwIfAborted();
      const chapters = toc.volumes.flatMap((volume) => volume.chapters);
      const entries = await Promise.all(
        chapters.map(async (chapter) => {
          const content = await getChapterContent(channel, chapter.id);
          // 成品只读当前正文；仅剩历史稿的scene不是一个空的阅读段落。
          return [
            chapter.id,
            { ...content, scenes: content.scenes.filter((scene) => scene.content.trim()) },
          ] as const;
        }),
      );
      signal.throwIfAborted();
      return { toc, chaptersContent: Object.fromEntries(entries) };
    },
  });
}
