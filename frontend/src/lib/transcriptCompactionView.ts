import type { SessionSearchHit } from "./sessions";
import type { AgentEventData } from "./socket";

/**
 * 整理记录的只读视图：只消费已提交的作者可见事件。
 * 数量按真实覆盖类别计数；来源只取显示名；原文入口复用 Interaction 历史定位。
 * 不读取后端自由文本，不猜测缺失计数，也不兼容已经退役的单一工具计数字段。
 */
export interface TranscriptCompactionView {
  /** 各覆盖类别的真实数量之和。 */
  count: number;
  counts: {
    tool_exchanges: number;
    scope_updates: number;
    discussion_messages: number;
  };
  /** 有效整理记录条数；同一持久事件重复送达只计算一次。 */
  records: number;
  sources: string[];
  latestSequence: number;
  /** 只作历史导航，不渲染内部身份。 */
  historyTarget: Pick<SessionSearchHit, "session_id" | "turn_id"> | null;
}

const CHECKPOINT_CREATED = "checkpoint_created";

// 后端已按词表过滤内部标识；前端再做一次保守防御，避免内部 ref 形状意外进入作者可见面。
const INTERNAL_REF_PATTERN = /(?:^|\s)[a-z][a-z0-9_]*(?::[a-z0-9_:-]+)+/i;
const INTERNAL_UNDERSCORE_PATTERN = /^[a-z][a-z0-9]*_[a-z0-9_]+$/i;

/** 工具交换数可以为零；只要真实旧范围或讨论覆盖非零，就存在整理记录。 */
export function transcriptCompactionView(
  events: ReadonlyArray<AgentEventData> | null | undefined,
): TranscriptCompactionView | null {
  if (events === null || events === undefined) return null;

  const valid: Array<{
    sequence: number;
    counts: TranscriptCompactionView["counts"];
    sources: string[];
    historyTarget: TranscriptCompactionView["historyTarget"];
  }> = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (!event || event.event_type !== CHECKPOINT_CREATED || event.visibility !== "author")
      continue;
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0) continue;
    if (
      typeof event.event_id !== "string" ||
      event.event_id.trim() === "" ||
      seen.has(event.event_id)
    ) {
      continue;
    }

    const counts = coveredCounts(event.payload);
    if (counts === null) continue;

    seen.add(event.event_id);
    valid.push({
      sequence: event.sequence,
      counts,
      sources: sourceNames(event.payload),
      historyTarget: historyTarget(event.payload),
    });
  }

  if (valid.length === 0) return null;
  valid.sort((left, right) => left.sequence - right.sequence);

  const counts = valid.reduce(
    (total, entry) => ({
      tool_exchanges: total.tool_exchanges + entry.counts.tool_exchanges,
      scope_updates: total.scope_updates + entry.counts.scope_updates,
      discussion_messages: total.discussion_messages + entry.counts.discussion_messages,
    }),
    { tool_exchanges: 0, scope_updates: 0, discussion_messages: 0 },
  );
  const count = counts.tool_exchanges + counts.scope_updates + counts.discussion_messages;
  if (!Number.isSafeInteger(count)) return null;

  return {
    count,
    counts,
    records: valid.length,
    sources: Array.from(new Set(valid.flatMap((entry) => entry.sources))),
    latestSequence: valid[valid.length - 1].sequence,
    historyTarget: valid.find((entry) => entry.historyTarget !== null)?.historyTarget ?? null,
  };
}

function coveredCounts(
  payload: Record<string, unknown> | undefined,
): TranscriptCompactionView["counts"] | null {
  const value = payload?.covered_counts;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const counts = value as Record<string, unknown>;
  const keys = ["tool_exchanges", "scope_updates", "discussion_messages"];
  if (Object.keys(counts).length !== keys.length) return null;
  if (
    !keys.every(
      (key) =>
        typeof counts[key] === "number" && Number.isSafeInteger(counts[key]) && counts[key] >= 0,
    )
  ) {
    return null;
  }

  const result = counts as TranscriptCompactionView["counts"];
  const total = result.tool_exchanges + result.scope_updates + result.discussion_messages;
  return Number.isSafeInteger(total) && total > 0 ? result : null;
}

function historyTarget(
  payload: Record<string, unknown> | undefined,
): TranscriptCompactionView["historyTarget"] {
  const value = payload?.history_target;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  if (
    typeof target.session_id !== "string" ||
    target.session_id.trim() === "" ||
    typeof target.turn_id !== "string" ||
    target.turn_id.trim() === ""
  )
    return null;
  return { session_id: target.session_id, turn_id: target.turn_id };
}

function sourceNames(payload: Record<string, unknown> | undefined): string[] {
  const value = payload?.sources;
  if (!Array.isArray(value)) return [];

  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed === "") continue;
    if (INTERNAL_REF_PATTERN.test(trimmed)) continue;
    if (INTERNAL_UNDERSCORE_PATTERN.test(trimmed)) continue;
    names.push(trimmed);
  }
  return names;
}
