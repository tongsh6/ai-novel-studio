import { describe, expect, it } from "vitest";

import type { AgentEventData } from "../socket";
import { transcriptCompactionView } from "../transcriptCompactionView";

function payload(tool_exchanges = 0, scope_updates = 0, discussion_messages = 0) {
  return {
    covered_counts: { tool_exchanges, scope_updates, discussion_messages },
    sources: [],
    history_target: { session_id: "session-original", turn_id: "turn-original" },
  };
}

function compactionEvent(
  sequence: number,
  overrides: Partial<AgentEventData> = {},
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
    payload: payload(1),
    emitted_at: "2026-11-15T00:00:00Z",
    ...overrides,
  };
}

describe("transcriptCompactionView", () => {
  it.each([
    [0, 3, 0],
    [0, 0, 5],
    [2, 3, 5],
  ])("真实覆盖 (%s, %s, %s) 不依赖工具调用非零", (tools, scopes, discussions) => {
    const event = compactionEvent(9, { payload: payload(tools, scopes, discussions) });

    expect(transcriptCompactionView([event])).toEqual({
      count: tools + scopes + discussions,
      counts: { tool_exchanges: tools, scope_updates: scopes, discussion_messages: discussions },
      records: 1,
      sources: [],
      latestSequence: 9,
      historyTarget: { session_id: "session-original", turn_id: "turn-original" },
    });
  });

  it("乱序与重连重复事件按真实身份合并，保留类别和最早记录的原文入口", () => {
    const first = compactionEvent(3, {
      payload: { ...payload(2, 3), sources: ["角色档案", "作品设定"] },
    });
    const second = compactionEvent(7, {
      payload: {
        ...payload(0, 1, 4),
        sources: ["作品设定", "第一章正文"],
        history_target: { session_id: "session-original", turn_id: "turn-later" },
      },
    });

    expect(transcriptCompactionView([second, first, { ...first }])).toEqual({
      count: 10,
      counts: { tool_exchanges: 2, scope_updates: 4, discussion_messages: 4 },
      records: 2,
      sources: ["角色档案", "作品设定", "第一章正文"],
      latestSequence: 7,
      historyTarget: { session_id: "session-original", turn_id: "turn-original" },
    });
    expect(transcriptCompactionView([first, second])).toEqual(
      transcriptCompactionView(JSON.parse(JSON.stringify([first, second])) as AgentEventData[]),
    );
  });

  it("仅消费 checkpoint_created 的作者可见事件", () => {
    const other = compactionEvent(2, { event_type: "run_started" });
    const developer = compactionEvent(4, { visibility: "developer" });
    const valid = compactionEvent(5, { payload: payload(0, 0, 4) });
    expect(transcriptCompactionView([other, developer, valid])?.count).toBe(4);
  });

  it("缺失、旧格式、全零、部分缺失或非法数量不会被估算为成功记录", () => {
    const invalidPayloads = [
      undefined,
      {},
      { covered_exchanges: 12 },
      payload(),
      { covered_counts: { tool_exchanges: 1, scope_updates: 0 } },
      { covered_counts: { ...payload(1).covered_counts, invented: 3 } },
      { covered_counts: { ...payload(1).covered_counts, discussion_messages: -1 } },
      { covered_counts: { ...payload(1).covered_counts, scope_updates: "2" } },
      { covered_counts: { ...payload(1).covered_counts, scope_updates: 1.5 } },
      payload(Number.MAX_SAFE_INTEGER, 1),
    ];
    const invalid = invalidPayloads.map((value, index) =>
      compactionEvent(index + 1, { payload: value }),
    );
    expect(transcriptCompactionView(invalid)).toBeNull();
    expect(transcriptCompactionView(undefined)).toBeNull();
    expect(transcriptCompactionView(null)).toBeNull();
    expect(transcriptCompactionView([])).toBeNull();
  });

  it("来源仅接受显示名，内部来源身份只在导航字段保留", () => {
    const event = compactionEvent(6, {
      payload: {
        ...payload(0, 2),
        sources: ["角色档案", "", "  ", "chapter:1", "call_abc123", 42, null, "第一章正文"],
      },
    });
    expect(transcriptCompactionView([event])?.sources).toEqual(["角色档案", "第一章正文"]);
  });

  it("后端摘要或维护说明不改变数量、来源和原文目标", () => {
    const event = compactionEvent(9, {
      payload: { ...payload(1, 2, 3), retained_items: 4, scope: "earlier_work_turns" },
    });
    const changed = { ...event, summary: "任意后端文案" };
    expect(transcriptCompactionView([changed])).toEqual(transcriptCompactionView([event]));
  });

  it("缺少有效原文目标时不伪造目标或把当前工作回合当成原文", () => {
    for (const target of [
      undefined,
      {},
      { session_id: "s", turn_id: "" },
      { session_id: 1, turn_id: "t" },
    ]) {
      const event = compactionEvent(3, {
        payload: { ...payload(0, 0, 2), history_target: target },
      });
      expect(transcriptCompactionView([event])?.historyTarget).toBeNull();
      expect(transcriptCompactionView([event])?.count).toBe(2);
    }
  });
});
