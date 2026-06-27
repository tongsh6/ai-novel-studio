// Design: docs/design/ui/44-reading-mode.md §3
// Prototype: novel-studio.pen → 44§3-reading-mode-stale (hEGz0)
import { useEffect, useState, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAppStore } from "../lib/store";
import { isTauri } from "../lib/env";
import { getToc, getChapterContent } from "../lib/socket";
import type { TocData, ChapterContent, ExportResult, ExportProgress } from "../lib/socket";
import { exportBook, pickExportDirectory } from "../lib/export";
import {
  formatWordCount,
  normalizeChapterContentTitle,
  normalizeReadingToc,
} from "../lib/readingProjection";
import { READING } from "../lib/copy";
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
  const [chaptersContent, setChaptersContent] = useState<Record<string, ChapterContent>>({});
  const [loadingContent, setLoadingContent] = useState(false);
  const [isManualScrolling, setIsManualScrolling] = useState(false);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStep, setExportStep] = useState<string>("");
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const tocView = normalizeReadingToc(toc);
  const totalWordCount = tocView?.totalWordCount ?? 0;
  const audit = tocView?.audit ?? null;
  const belowMinCount = audit ? audit.shortChapterCount + audit.emptyChapterCount : 0;
  const chapters = tocView?.volumes.flatMap((volume) => volume.chapters) ?? [];
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
  const contentLoading = loadingContent;

  // Fetch TOC and chapter contents on mount when workId is set
  useEffect(() => {
    if (!channel || !context.workId) return;

    // Set loading asynchronously to avoid react-hooks/set-state-in-effect lint error
    void Promise.resolve().then(() => {
      setLoadingContent(true);
    });

    getToc(channel, context.workId)
      .then((data) => {
        setTocError(null);
        setToc(data);
        // Auto-select first chapter of first volume
        const firstChapter = data.volumes[0]?.chapters[0];
        if (firstChapter) {
          setActiveChapterId(firstChapter.id);
        }

        const chList = data.volumes.flatMap((v) => v.chapters);
        const contentMap: Record<string, ChapterContent> = {};

        // Fetch all chapter contents in parallel
        return Promise.all(
          chList.map(async (ch) => {
            try {
              const content = await getChapterContent(channel, ch.id);
              contentMap[ch.id] = content;
            } catch (err) {
              console.error("Failed to load content for chapter", ch.id, err);
            }
          })
        ).then(() => {
          setChaptersContent(contentMap);
        });
      })
      .catch((error) => {
        setToc(null);
        setTocError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setLoadingContent(false);
      });
  }, [channel, context.workId]);

  const handleChapterClick = (chapterId: string) => {
    setActiveChapterId(chapterId);
    const element = document.getElementById(`chapter-${chapterId}`);
    if (element && contentAreaRef.current) {
      setIsManualScrolling(true);
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => {
        setIsManualScrolling(false);
      }, 800);
    }
  };

  const handleScroll = () => {
    if (isManualScrolling) return;
    const container = contentAreaRef.current;
    if (!container) return;

    const containerTop = container.getBoundingClientRect().top;
    const chList = tocView?.volumes.flatMap((v) => v.chapters) ?? [];
    let foundActiveId = activeChapterId;

    for (const ch of chList) {
      const element = document.getElementById(`chapter-${ch.id}`);
      if (element) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom > containerTop + 100) {
          foundActiveId = ch.id;
          break;
        }
      }
    }

    if (foundActiveId && foundActiveId !== activeChapterId) {
      setActiveChapterId(foundActiveId);
    }
  };

  const handleRefreshProjection = () => {
    setPendingBuildAction("refresh_projection");
    setMode("workbench");
  };

  const resetExportDialog = () => {
    setExportProgress(0);
    setExportStep("");
    setExportResult(null);
    setExportError(null);
  };

  const handleExportProgress = (progress: ExportProgress) => {
    setExportProgress(progress.progress);
    setExportStep(progress.step);
  };

  // 导出全书：先让用户选择保存目录（Tauri 桌面端），再显示进度弹窗，最后展示结果。
  const handleExport = async () => {
    if (!channel || !context.workId || exportDialogOpen) return;

    resetExportDialog();
    const exportDir = await pickExportDirectory();
    if (exportDir === null && isTauri) {
      // 用户在 Tauri 目录选择器中取消，静默放弃。
      return;
    }

    setExportDialogOpen(true);

    try {
      const result = await exportBook(channel, context.workId, {
        exportDir,
        onProgress: handleExportProgress,
      });
      setExportResult(result);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleCloseExportDialog = () => {
    setExportDialogOpen(false);
    resetExportDialog();
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
            <span className={styles.bannerDesc}>
              底层设定已有变更，当前阅读的可能不是最新版本。
            </span>
          </div>
          <button className={styles.refreshBtn} onClick={handleRefreshProjection}>
            刷新投影
          </button>
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
          <button className={styles.refreshBtn} onClick={handleRetryProjection}>
            重试
          </button>
        </div>
      )}

      {/* Top bar */}
      <div className={styles.topBar}>
        <div className={styles.contextGroup}>
          <span className={styles.modeText}>阅读模式</span>
          <span className={styles.divider}>/</span>
          <span className={styles.titleText}>{getVisibleWorkTitle(runtimeState)}</span>
          {hasContent && totalWordCount > 0 && (
            <>
              <span className={styles.divider}>/</span>
              <span className={styles.totalWords}>
                {READING.totalWordsLabel} {formatWordCount(totalWordCount)}
              </span>
            </>
          )}
          {hasContent && audit && audit.chapterCount > 0 && (
            <>
              <span className={styles.divider}>/</span>
              {audit.meetsThreshold ? (
                <span className={styles.milestoneMet}>{READING.milestoneMetLabel}</span>
              ) : (
                <span className={styles.milestoneProgress}>
                  {READING.milestoneProgressLabel} {audit.totalWordCount.toLocaleString()} /{" "}
                  {audit.totalTarget.toLocaleString()} {READING.wordsUnit}
                  {belowMinCount > 0 ? ` · ${belowMinCount} ${READING.chaptersBelowMinSuffix}` : ""}
                </span>
              )}
            </>
          )}
        </div>
        {hasContent && (
          <button
            className={styles.exportBtn}
            onClick={() => void handleExport()}
            disabled={exportDialogOpen}
          >
            {exportDialogOpen ? READING.exportInProgress : READING.exportLabel}
          </button>
        )}
        <button className={styles.backBtn} onClick={() => setMode("workbench")}>
          返回工作台
        </button>
      </div>

      <Dialog.Root
        open={exportDialogOpen}
        onOpenChange={(open) => {
          // 导出进行中禁止通过 Esc / 点击遮罩 / 关闭按钮关闭弹窗。
          if (!open && !exportResult && !exportError) return;
          setExportDialogOpen(open);
          if (!open) resetExportDialog();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent} aria-describedby="export-dialog-description">
            <Dialog.Title className={styles.dialogTitle}>
              {exportError ? READING.exportErrorTitle : exportResult ? READING.exportSuccessTitle : READING.exportDialogTitle}
            </Dialog.Title>
            <p id="export-dialog-description" className={styles.dialogDescription}>
              {exportError
                ? `${READING.exportFailurePrefix}${exportError}`
                : exportResult
                  ? `${READING.exportSuccessPrefix} ${exportResult.path}`
                  : exportStep || READING.exportInProgress}
            </p>
            {!exportResult && !exportError && (
              <>
                <div className={styles.progressBarTrack} aria-label={READING.exportProgressLabel}>
                  <div
                    className={styles.progressBarFill}
                    style={{ width: `${Math.max(0, Math.min(100, exportProgress))}%` }}
                  />
                </div>
                <div className={styles.dialogProgressMeta}>
                  {READING.exportProgressLabel} {exportProgress}%
                </div>
              </>
            )}
            <div className={styles.dialogActions}>
              <button
                className={styles.dialogPrimaryBtn}
                onClick={handleCloseExportDialog}
                disabled={!exportResult && !exportError}
              >
                {READING.exportCloseLabel}
              </button>
            </div>
            {(exportResult || exportError) && (
              <Dialog.Close asChild>
                <button
                  className={styles.dialogCloseBtn}
                  onClick={handleCloseExportDialog}
                  aria-label={READING.exportCloseLabel}
                >
                  ×
                </button>
              </Dialog.Close>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Main reading area */}
      <div className={styles.mainArea}>
        {/* TOC sidebar */}
        <div className={styles.tocSidebar}>
          <div className={styles.tocTitle}>目录</div>
          {runtimeState.ui.shouldShowReadingEmptyState ||
          readingStatus === "unknown" ||
          readingStatus === "failed" ? (
            <div className={styles.tocEmpty}>暂无已采纳的章节内容</div>
          ) : (
            <div className={styles.tocList}>
              {tocView?.volumes.map((vol) => (
                <div key={vol.id}>
                  <div className={styles.tocVolume}>{vol.title}</div>
                  {vol.chapters.map((ch) => (
                    <div
                      key={ch.id}
                      className={
                        ch.id === activeChapterId ? styles.tocChapterActive : styles.tocChapter
                      }
                      onClick={() => handleChapterClick(ch.id)}
                    >
                      <span className={styles.tocChapterTitle}>{ch.title}</span>
                      {ch.status === "empty" && (
                        <span className={styles.auditBadge}>{READING.emptyChapterBadge}</span>
                      )}
                      {ch.status === "short" && (
                        <span className={styles.auditBadge}>{READING.shortChapterBadge}</span>
                      )}
                      {ch.wordCount > 0 && (
                        <span className={styles.tocChapterWords}>
                          {formatWordCount(ch.wordCount)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reading content area */}
        <div
          className={styles.readingContentArea}
          ref={contentAreaRef}
          onScroll={handleScroll}
        >
          {contentLoading ? (
            <div className={styles.contentBlock}>
              <p>加载中…</p>
            </div>
          ) : !hasContent || chapters.length === 0 ? (
            <div className={styles.contentBlock}>
              返回工作台，在对话中生成并采纳草稿后，即可在此阅读。
            </div>
          ) : (
            <div className={styles.contentBlock}>
              {chapters.map((ch) => {
                const content = chaptersContent[ch.id];
                const readable = content
                  ? normalizeChapterContentTitle(content, ch)
                  : null;

                return (
                  <div
                    key={ch.id}
                    id={`chapter-${ch.id}`}
                    data-chapter-id={ch.id}
                    className={styles.chapterSection}
                  >
                    <h1 className={styles.chapterTitle}>{readable?.title || ch.title}</h1>
                    {ch.wordCount && ch.wordCount > 0 ? (
                      <div className={styles.chapterMeta}>
                        {READING.chapterWordsLabel} {formatWordCount(ch.wordCount)}
                      </div>
                    ) : null}

                    {!readable ? (
                      <div className={styles.paragraph}>加载中…</div>
                    ) : readable.scenes.length === 0 ? (
                      <div className={styles.paragraph}>{READING.emptyChapterBody}</div>
                    ) : (
                      readable.scenes.map((scene, si) => (
                        <div key={si}>
                          {scene.title && scene.title !== readable.title && (
                            <h3 className={styles.sceneTitle}>{scene.title}</h3>
                          )}
                          {scene.content ? (
                            scene.content.split("\n").map((para, pi) =>
                              para.trim() ? (
                                <div key={pi} className={styles.paragraph}>
                                  {para}
                                </div>
                              ) : (
                                <br key={pi} />
                              ),
                            )
                          ) : (
                            <div className={styles.paragraph}>{READING.sceneEmptyBody}</div>
                          )}
                        </div>
                      ))
                    )}
                    {/* Visual spacer between chapters */}
                    <div className={styles.chapterDivider} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
