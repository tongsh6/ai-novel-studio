// Design: docs/design/ui/46-state-and-feedback.md §9.9（长任务上下文整理记录）
// Design: docs/design/ui/47-ui-copy-guidelines.md §7.9（整理记录文案）
// Prototype: novel-studio.pen → 46§9.9-transcript-compaction-inline (fjkkm), 46§9.9-transcript-compaction-expanded (AYpEe)
import { Archive, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";

import type { TranscriptCompactionView } from "../lib/transcriptCompactionView";
import styles from "./TranscriptCompactionNotice.module.css";

/**
 * 整理记录文案契约（47 §7.9）。由接线方从 `copy.ts` 注入（文案集中管理），
 * 组件不硬编码作者可见文案；测试用同形字面量覆盖两态。
 */
export interface TranscriptCompactionCopy {
  summary: (count: number) => string;
  expandLabel: string;
  title: string;
  reason: (count: number) => string;
  kept: string;
  sources: (list: string) => string;
  openHistory: string;
}

export interface TranscriptCompactionNoticeProps {
  view: TranscriptCompactionView;
  expanded: boolean;
  copy: TranscriptCompactionCopy;
  onToggle: () => void;
  /** 打开既有 Why/trace 面板；无对应 turn 的 run 可不提供（隐藏入口，不伪造）。 */
  onOpenHistory?: () => void;
}

/**
 * 消息流内单行整理记录细条 + 内联展开面板（VS-00L §16.2/§16.4）。
 *
 * 纯受控展示：无内部状态、无请求；数量与来源全部来自后端 author-safe 事件视图。
 * 无有效记录时返回 null（作者无感）。
 */
export function TranscriptCompactionNotice({
  view,
  expanded,
  copy,
  onToggle,
  onOpenHistory,
}: TranscriptCompactionNoticeProps) {
  if (view.records <= 0 || view.count <= 0) return null;

  const sourcesLine = view.sources.join("、");

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.notice}
        aria-expanded={expanded}
        aria-label={copy.expandLabel}
        onClick={onToggle}
      >
        <Archive size={14} className={styles.icon} aria-hidden="true" />
        <span className={styles.summary}>{copy.summary(view.count)}</span>
        {expanded ? (
          <ChevronUp size={14} className={styles.icon} aria-hidden="true" />
        ) : (
          <ChevronDown size={14} className={styles.icon} aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className={styles.panel} role="region" aria-label={copy.title}>
          <span className={styles.panelTitle}>{copy.title}</span>
          <span className={styles.panelText}>{copy.reason(view.count)}</span>
          <span className={styles.panelText}>{copy.kept}</span>
          {sourcesLine !== "" && (
            <span className={styles.panelSources}>{copy.sources(sourcesLine)}</span>
          )}
          {onOpenHistory !== undefined && (
            <button type="button" className={styles.historyLink} onClick={onOpenHistory}>
              <span>{copy.openHistory}</span>
              <ChevronRight size={12} className={styles.icon} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
