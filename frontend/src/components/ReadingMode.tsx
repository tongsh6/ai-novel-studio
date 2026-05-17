// Design: docs/design-v2/ui-design/44-reading-mode.md §3
// Prototype: novel-studio-v2.pen → 44§3-reading-mode-stale (hEGz0)
import { useEffect, useState } from "react";
import { useAppStore } from "../lib/store";
import { getToc, getChapterContent } from "../lib/socket";
import type { TocData, ChapterContent } from "../lib/socket";
import {
  normalizeChapterContentTitle,
  normalizeReadingToc,
} from "../lib/readingProjection";
import {
  deriveWorkspaceRuntimeState,
  getReadingProjectionStatus,
  getVisibleWorkTitle,
} from "../lib/workspaceRuntimeState";
import styles from "./ReadingMode.module.css";

export function ReadingMode() {
  const { setMode, context, projectionStatus, setPendingBuildAction, channel } = useAppStore();

  const [toc, setToc] = useState<TocData | null>(null);
  const [tocError, setTocError] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [chapterContent, setChapterContent] = useState<ChapterContent | null>(null);

  const tocView = normalizeReadingToc(toc);
  const chapters = tocView?.volumes.flatMap((volume) => volume.chapters) ?? [];
  const activeChapter = chapters.find((chapter) => chapter.id === activeChapterId);
  const readableChapterContent = chapterContent
    ? normalizeChapterContentTitle(chapterContent, activeChapter)
    : null;
  const runtimeState = deriveWorkspaceRuntimeState({
    connection: { connected: Boolean(channel) },
    work: { id: context.workId, title: context.workTitle },
    readingProjection: {
      chapters: tocView ? chapters : null,
      activeChapterId,
      refreshStatus: projectionStatus,
      error: tocError,
    },
  });
  const readingStatus = getReadingProjectionStatus(runtimeState);
  const hasContent = readingStatus === "ready" || readingStatus === "stale";
  const contentLoading = activeChapterId != null && chapterContent == null;

  // Fetch TOC on mount when workId is set
  useEffect(() => {
    if (!channel || !context.workId) return;
    getToc(channel, context.workId).then((data) => {
      setTocError(null);
      setToc(data);
      // Auto-select first chapter of first volume
      const firstChapter = data.volumes[0]?.chapters[0];
      if (firstChapter) {
        setActiveChapterId(firstChapter.id);
      }
    }).catch((error) => {
      setToc(null);
      setTocError(error instanceof Error ? error.message : String(error));
    });
  }, [channel, context.workId]);

  // Fetch chapter content when active chapter changes
  useEffect(() => {
    if (!channel || !activeChapterId) return;
    getChapterContent(channel, activeChapterId)
      .then((data) => setChapterContent(data))
      .catch(() => setChapterContent(null));
  }, [channel, activeChapterId]);

  const handleRefreshProjection = () => {
    setPendingBuildAction("refresh_projection");
    setMode("workbench");
  };

  const handleRetryProjection = () => {
    setPendingBuildAction("retry_projection");
    setMode("workbench");
  };

  return (
    <div className={styles.container}>
      {/* Projection status banners (VS-005) */}
      {projectionStatus === "STALE" && (
        <div className={styles.staleBanner}>
          <div className={styles.bannerLeft}>
            <span className={styles.bannerStatus}>投影状态：已过期</span>
            <span className={styles.bannerDesc}>底层设定已有变更，当前阅读的可能不是最新版本。</span>
          </div>
          <button className={styles.refreshBtn} onClick={handleRefreshProjection}>刷新投影</button>
        </div>
      )}
      {projectionStatus === "REBUILDING" && (
        <div className={styles.staleBanner}>
          <div className={styles.bannerLeft}>
            <span className={styles.bannerStatus}>投影状态：重建中</span>
            <span className={styles.bannerDesc}>系统正在重新生成阅读视图，请稍候。</span>
          </div>
        </div>
      )}
      {projectionStatus === "FAILED" && (
        <div className={styles.staleBanner}>
          <div className={styles.bannerLeft}>
            <span className={styles.bannerStatus}>投影状态：重建失败</span>
            <span className={styles.bannerDesc}>阅读视图重建失败，请返回工作台重试。</span>
          </div>
          <button className={styles.refreshBtn} onClick={handleRetryProjection}>重试</button>
        </div>
      )}

      {/* Top bar */}
      <div className={styles.topBar}>
        <div className={styles.contextGroup}>
          <span className={styles.modeText}>阅读模式</span>
          <span className={styles.divider}>/</span>
          <span className={styles.titleText} data-slice-verify="reading-work-title">
            {getVisibleWorkTitle(runtimeState)}
          </span>
        </div>
        <button
          className={styles.backBtn}
          onClick={() => setMode("workbench")}
        >
          返回工作台
        </button>
      </div>

      {/* Main reading area */}
      <div className={styles.mainArea}>

        {/* TOC sidebar */}
        <div className={styles.tocSidebar}>
          <div className={styles.tocTitle}>目录</div>
          {runtimeState.ui.shouldShowReadingEmptyState || readingStatus === "unknown" || readingStatus === "failed" ? (
            <div className={styles.tocEmpty}>
              暂无已采纳的章节内容
            </div>
          ) : (
            <div className={styles.tocList}>
              {tocView?.volumes.map((vol) => (
                <div key={vol.id}>
                  <div className={styles.tocVolume}>{vol.title}</div>
                  {vol.chapters.map((ch) => (
                    <div
                      key={ch.id}
                      className={ch.id === activeChapterId ? styles.tocChapterActive : styles.tocChapter}
                      onClick={() => setActiveChapterId(ch.id)}
                    >
                      {ch.title}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reading content area */}
        <div className={styles.readingContentArea}>
          {contentLoading ? (
            <div className={styles.contentBlock}>
              <p>加载中…</p>
            </div>
          ) : !readableChapterContent ? (
            <div className={styles.contentBlock}>
              {hasContent
                ? "请从左侧目录选择一个章节。"
                : "返回工作台，在对话中生成并采纳草稿后，即可在此阅读。"}
            </div>
          ) : (
            <div className={styles.contentBlock}>
              <h1 className={styles.chapterTitle}>{readableChapterContent.title}</h1>
              {readableChapterContent.scenes.map((scene, si) => (
                <div key={si}>
                  {scene.title && scene.title !== readableChapterContent.title && (
                    <h3 className={styles.sceneTitle}>{scene.title}</h3>
                  )}
                  {scene.content ? (
                    scene.content.split("\n").map((para, pi) => (
                      para.trim() ? <div key={pi} className={styles.paragraph}>{para}</div> : <br key={pi} />
                    ))
                  ) : (
                    <div className={styles.paragraph}>（该场景暂无已采纳正文）</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
