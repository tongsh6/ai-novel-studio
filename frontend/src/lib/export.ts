// Contract: WorkspaceChannel.export_work (apps/novel_web/lib/novel_web/channels/workspace_channel.ex)
// Design: docs/design/ui/44-reading-mode.md §3
//
// 全书导出编排：
// - Tauri 桌面端调用系统目录选择对话框，让用户指定保存位置；
// - 浏览器/非 Tauri 环境回退到后端默认导出目录；
// - 导出过程中监听 task_state 事件，向调用方报告进度与阶段文案。

import { isTauri } from "./env";
import { exportWork as pushExportWork, type ExportResult } from "./socket";
import type { Channel } from "phoenix";

export interface ExportProgress {
  phase: string;
  progress: number;
  step: string;
}

export interface ExportOptions {
  /** 用户已选择的导出目录；Tauri 外可留空，由后端使用默认目录。 */
  exportDir?: string | null;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * 弹出系统目录选择对话框。
 *
 * - Tauri 桌面端：使用 @tauri-apps/plugin-dialog 打开目录选择器；
 * - 其他环境：返回 null，由后端回退到默认导出目录。
 */
export async function pickExportDirectory(): Promise<string | null> {
  if (!isTauri) {
    return null;
  }

  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择导出目录",
    });

    if (selected === null || Array.isArray(selected)) {
      return null;
    }

    return selected;
  } catch {
    return null;
  }
}

/**
 * 触发全书导出并返回结果。
 *
 * 导出过程中会透过后端 task_state 广播收到增量进度，通过 `onProgress` 回调更新 UI。
 */
export async function exportBook(
  channel: Channel,
  workId: string,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const { exportDir, onProgress } = options;

  return pushExportWork(channel, workId, {
    exportDir,
    onProgress,
  });
}
