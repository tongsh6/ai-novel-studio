import { describe, expect, it } from "vitest";

import type { AgentEventData } from "../socket";
import { transcriptCompactionView } from "../transcriptCompactionView";

/**
 * 契约测试：`checkpoint_created` 事件 → 前端整理记录视图。
 *
 * fixture 与阶段 4 后端 `AgentRunCompactionEventTest` /
 * `ProviderActivityService.agent_event_summary` 的输出同形（payload 键名与类型一致）。
 * 后端持久化事实由 ExUnit 覆盖；本测试锚定「前端只依赖数量与来源键，不依赖自由文本」。
 */
const backendShapedEvent: AgentEventData & { payload: Record<string, unknown> } = {
  event_id: "evt_run_1_9",
  run_ref: "run_1",
  run_id: "run_1",
  step_ref: "step_3",
  sequence: 9,
  event_type: "checkpoint_created",
  visibility: "author",
  summary: "较早的 12 项创作过程已整理",
  reason_codes: ["transcript_compaction"],
  refs: [],
  payload: {
    covered_exchanges: 12,
    sources: ["角色档案"],
    retained_items: 4,
    scope: "earlier_work_turns",
  },
  emitted_at: "2026-11-04T00:00:00Z",
};

describe("checkpoint_created 前端契约", () => {
  it("与后端 payload 同形的 fixture 映射为稳定视图", () => {
    expect(transcriptCompactionView([backendShapedEvent])).toEqual({
      count: 12,
      records: 1,
      sources: ["角色档案"],
      latestSequence: 9,
    });
  });

  it("fixture 满足前端事件必填字段形状（与 isAgentEventData 判据一致）", () => {
    expect(typeof backendShapedEvent.event_id).toBe("string");
    expect(typeof backendShapedEvent.run_ref).toBe("string");
    expect(typeof backendShapedEvent.event_type).toBe("string");
    expect(typeof backendShapedEvent.visibility).toBe("string");
    expect(typeof backendShapedEvent.summary).toBe("string");
    expect(typeof backendShapedEvent.sequence).toBe("number");
  });

  it("前端不依赖后端自由文本 summary：改 summary 不影响视图", () => {
    const changed = { ...backendShapedEvent, summary: "任意后端文案" };

    expect(transcriptCompactionView([changed])).toEqual(
      transcriptCompactionView([backendShapedEvent]),
    );
  });

  it("缺 payload 或旧事件形状被忽略，不抛异常", () => {
    const missingPayload = { ...backendShapedEvent, payload: undefined };
    const legacy = {
      ...backendShapedEvent,
      event_type: "run_started",
      payload: { covered_exchanges: 5 },
    };

    expect(transcriptCompactionView([missingPayload, legacy])).toBeNull();
  });

  it("保留 retained_items/scope 等扩展键不影响视图（向前兼容）", () => {
    const withExtra = {
      ...backendShapedEvent,
      payload: { ...backendShapedEvent.payload, future_key: true },
    };

    expect(transcriptCompactionView([withExtra])?.count).toBe(12);
  });
});
