import { describe, expect, it } from "vitest";

import type { AgentEventData } from "../socket";
import { transcriptCompactionView } from "../transcriptCompactionView";

function compactionEvent(
  sequence: number,
  overrides: Partial<AgentEventData> & { payload?: Record<string, unknown> } = {},
): AgentEventData {
  return {
    event_id: `evt_run_1_${sequence}`,
    run_ref: "run_1",
    run_id: "run_1",
    step_ref: "step_3",
    sequence,
    event_type: "checkpoint_created",
    visibility: "author",
    summary: "较早的创作过程已整理",
    reason_codes: ["transcript_compaction"],
    refs: [],
    payload: { covered_exchanges: 1, sources: [] },
    emitted_at: "2026-11-04T00:00:00Z",
    ...overrides,
  };
}

describe("transcriptCompactionView", () => {
  it("V1：单条事件映射数量/次数/来源与最新 sequence", () => {
    const event = compactionEvent(9, {
      payload: { covered_exchanges: 12, sources: [] },
    });

    expect(transcriptCompactionView([event])).toEqual({
      count: 12,
      records: 1,
      sources: [],
      latestSequence: 9,
    });
  });

  it("V2：多条事件聚合数量、保留顺序并去重来源并集", () => {
    const first = compactionEvent(3, {
      payload: { covered_exchanges: 12, sources: ["角色档案", "作品设定"] },
    });
    const second = compactionEvent(7, {
      payload: { covered_exchanges: 3, sources: ["作品设定", "第一章正文"] },
    });

    expect(transcriptCompactionView([second, first])).toEqual({
      count: 15,
      records: 2,
      sources: ["角色档案", "作品设定", "第一章正文"],
      latestSequence: 7,
    });
  });

  it("V3：忽略非 checkpoint_created 与未标记 author 的事件", () => {
    const other = compactionEvent(2, { event_type: "run_started" });
    const developer = compactionEvent(4, { visibility: "developer" });
    const valid = compactionEvent(5, { payload: { covered_exchanges: 4, sources: [] } });

    expect(transcriptCompactionView([other, developer, valid])?.count).toBe(4);
  });

  it("V4：非法 payload 该条忽略；全部无效返回 null", () => {
    const invalid = [
      compactionEvent(1, { payload: {} }),
      compactionEvent(2, { payload: { covered_exchanges: 0 } }),
      compactionEvent(3, { payload: { covered_exchanges: -2 } }),
      compactionEvent(4, { payload: { covered_exchanges: "12" } }),
      compactionEvent(5, { payload: { covered_exchanges: 1.5 } }),
    ];

    expect(transcriptCompactionView(invalid)).toBeNull();
    expect(transcriptCompactionView(undefined)).toBeNull();
    expect(transcriptCompactionView(null)).toBeNull();
    expect(transcriptCompactionView([])).toBeNull();
  });

  it("V5：来源只接受非空字符串并防御内部 ref 形状", () => {
    const event = compactionEvent(6, {
      payload: {
        covered_exchanges: 2,
        sources: ["角色档案", "", "  ", "chapter:1", "call_abc123", 42, null, "第一章正文"],
      },
    });

    expect(transcriptCompactionView([event])?.sources).toEqual(["角色档案", "第一章正文"]);
  });

  it("V6：乱序输入按 sequence 稳定聚合，latestSequence 取最大", () => {
    const events = [
      compactionEvent(10, { payload: { covered_exchanges: 2, sources: [] } }),
      compactionEvent(1, { payload: { covered_exchanges: 1, sources: [] } }),
      compactionEvent(5, { payload: { covered_exchanges: 3, sources: [] } }),
    ];

    expect(transcriptCompactionView(events)).toEqual({
      count: 6,
      records: 3,
      sources: [],
      latestSequence: 10,
    });
  });

  it("V7：后端同形 fixture（含扩展键）稳定映射，不依赖 summary 自由文本", () => {
    // fixture 与后端 AgentRunCompactionEventTest / ProviderActivityService.agent_event_summary
    // 输出同形（payload 键名与类型一致）；保留 retained_items/scope 等扩展键不影响视图（向前兼容）。
    const backendShaped = compactionEvent(9, {
      payload: {
        covered_exchanges: 12,
        sources: ["角色档案"],
        retained_items: 4,
        scope: "earlier_work_turns",
      },
    });

    expect(transcriptCompactionView([backendShaped])).toEqual({
      count: 12,
      records: 1,
      sources: ["角色档案"],
      latestSequence: 9,
    });

    // 改后端自由文本 summary 不影响视图：数量只来自 payload.covered_exchanges。
    const changedSummary = { ...backendShaped, summary: "任意后端文案" };
    expect(transcriptCompactionView([changedSummary])).toEqual(
      transcriptCompactionView([backendShaped]),
    );
  });

  it("V8：checkpoint_created 缺 payload 时该条忽略，不抛异常", () => {
    const missingPayload = { ...compactionEvent(3), payload: undefined };
    const valid = compactionEvent(4, { payload: { covered_exchanges: 2, sources: [] } });

    expect(transcriptCompactionView([missingPayload])).toBeNull();
    expect(transcriptCompactionView([missingPayload, valid])?.count).toBe(2);
  });
});
