// Design: docs/design/ui/40-ui-overview.md §design tokens（记忆列表状态语义映射）
// 纯函数：把 MemoryItem 的类型/状态/范围/召回映射成可扫读的标签与语义色调（tone）。
// 颜色由 CSS 按 tone class 决定，这里只决定语义，不含样式。
import { displayName } from "./authorVisible";
import { MEMORY } from "./copy";
import type { MemoryItem } from "./memoryApi";

export type MemoryStatusTone = "confirmed" | "stabilized" | "draft" | "conflicted" | "terminal";

const TERMINAL_STATUSES = new Set(["SUPERSEDED", "DEPRECATED", "ARCHIVED"]);

export function memoryTypeLabel(type: string): string {
  return displayName("memory_type", type);
}

export function memoryStatusLabel(status: string): string {
  return displayName("memory_status", status);
}

export function memoryScopeLabel(scope: string): string {
  return displayName("memory_scope", scope);
}

/** 内部引用标签前缀（候选/候选集/决策/调用等）——作者可见面不展示原值。 */
const INTERNAL_REF_TAG_PREFIX =
  /^(candidate:|candidate_set:|decision:|pcall:|prun:|trace:|artifact:|behavior:|frame:|plan:)/;

/** 记忆标签的作者可见化：内部引用标签隐藏，已知语义标签走 SSOT，未知标签保留原文。 */
export function memoryTagLabel(tag: string): string | null {
  const normalized = tag.replace(/^candidate_set:candidate_set:/, "candidate_set:");
  if (INTERNAL_REF_TAG_PREFIX.test(normalized)) {
    return null;
  }
  return displayName("memory_tag", normalized);
}

/** ISO 时间 → 本地可读时间（作者可见面不展示原始 ISO 串）。 */
export function formatMemoryTime(value: string | null | undefined): string {
  if (typeof value !== "string" || value.trim() === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isTerminalMemory(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** 状态语义色调：颜色服务真实状态，不是装饰。 */
export function memoryStatusTone(status: string): MemoryStatusTone {
  switch (status) {
    case "CONFIRMED":
      return "confirmed";
    case "STABILIZED":
      return "stabilized";
    case "CONFLICTED":
      return "conflicted";
    case "DEPRECATED":
    case "ARCHIVED":
    case "SUPERSEDED":
      return "terminal";
    case "DRAFT":
    default:
      return "draft";
  }
}

/**
 * 召回可读标签：终态记忆即使 recallable 字段为真也不进入普通召回（§4.5 召回过滤），
 * 因此终态一律显示「不召回」，避免误导作者它仍在影响上下文。
 */
export function memoryRecallLabel(memory: Pick<MemoryItem, "status" | "recallable">): string {
  const recalled = memory.recallable && !isTerminalMemory(memory.status);
  return recalled ? MEMORY.list.recallable : MEMORY.list.notRecallable;
}

export function isMemoryRecalled(memory: Pick<MemoryItem, "status" | "recallable">): boolean {
  return memory.recallable && !isTerminalMemory(memory.status);
}
