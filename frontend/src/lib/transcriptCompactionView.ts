import type { AgentEventData } from "./socket";

/**
 * B71 长任务上下文整理记录（VS-00L §16.2/§16.4；§18 提案方向）的只读视图投影。
 *
 * 只消费 author-safe `checkpoint_created` 事件：数量取真实 `covered_exchanges`，
 * 来源取 `sources` 显示名；不读后端自由文本（文案统一由 copy.ts 渲染），
 * 不猜测、不估算，缺失/非法 payload 一律忽略。
 */
export interface TranscriptCompactionView {
  /** 聚合整理项数（各事件 covered_exchanges 之和）。 */
  count: number;
  /** 有效整理记录条数（== 整理次数）。 */
  records: number;
  /** 来源显示名并集（去重保序；空数组时不渲染来源行）。 */
  sources: string[];
  /** 最新一条记录的 sequence（仅用于稳定排序/测试，不直接渲染）。 */
  latestSequence: number;
}

const CHECKPOINT_CREATED = "checkpoint_created";

// 后端已按词表过滤内部标识；前端再做一次保守防御，避免内部 ref 形状意外进入作者可见面。
const INTERNAL_REF_PATTERN = /(?:^|\s)[a-z][a-z0-9_]*(?::[a-z0-9_:-]+)+/i;
const INTERNAL_UNDERSCORE_PATTERN = /^[a-z][a-z0-9]*_[a-z0-9_]+$/i;

/**
 * 把 AgentRun 事件投影为整理记录视图。
 *
 * 规则：只看 `event_type === "checkpoint_created"` 且 `visibility === "author"`；
 * `payload.covered_exchanges` 必须是正整数，否则该条忽略；全部无效返回 null（不渲染）。
 */
export function transcriptCompactionView(
  events: ReadonlyArray<AgentEventData> | null | undefined,
): TranscriptCompactionView | null {
  if (events === null || events === undefined) return null;

  const valid: Array<{ sequence: number; covered: number; sources: string[] }> = [];

  for (const event of events) {
    if (!event || event.event_type !== CHECKPOINT_CREATED) continue;
    if (event.visibility !== "author") continue;

    const covered = coveredExchanges(event.payload);
    if (covered === null) continue;

    valid.push({
      sequence: event.sequence,
      covered,
      sources: sourceNames(event.payload),
    });
  }

  if (valid.length === 0) return null;

  valid.sort((left, right) => left.sequence - right.sequence);

  const sources = Array.from(new Set(valid.flatMap((entry) => entry.sources)));

  return {
    count: valid.reduce((sum, entry) => sum + entry.covered, 0),
    records: valid.length,
    sources,
    latestSequence: valid[valid.length - 1].sequence,
  };
}

function coveredExchanges(payload: Record<string, unknown> | undefined): number | null {
  const value = payload?.covered_exchanges;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
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
