import { describe, expect, it, vi } from "vitest";
import type { Channel } from "phoenix";

import { STRUCTURE_PANEL } from "../copy";
import { planNextVolume } from "../socket";

type MockReply =
  | { status: "ok"; payload: unknown }
  | { status: "error"; payload: unknown }
  | { status: "timeout" };

// push 契约：`channel.push(event, payload).receive(status, cb)`。这里按单次 reply 驱动：
// 只有匹配 status 的 receive 回调在微任务里被调用，保证 promise executor 已完成全部接线。
function mockChannel(reply: MockReply) {
  const pushes: { event: string; payload: Record<string, unknown> }[] = [];
  const push = vi.fn((event: string, payload: Record<string, unknown>) => {
    pushes.push({ event, payload });
    const pushObject = {
      receive(status: string, callback: (value?: unknown) => void) {
        if (status === reply.status) {
          queueMicrotask(() => callback("payload" in reply ? reply.payload : undefined));
        }
        return pushObject;
      },
    };
    return pushObject;
  });

  return { channel: { push } as unknown as Channel, pushes };
}

describe("planNextVolume", () => {
  it("pushes plan_next_volume with work_id and resolves the ok reply", async () => {
    const reply = {
      turn_id: "turn-next-volume",
      volume_scope: {
        next_seq: 2,
        current_volume_seq: 1,
        current_volume_title: "第一卷",
        next_chapter_seq: 13,
        existing_volume_count: 1,
        existing_chapter_count: 12,
      },
    };
    const { channel, pushes } = mockChannel({ status: "ok", payload: reply });

    const result = await planNextVolume(channel, "work-1");

    expect(pushes).toEqual([{ event: "plan_next_volume", payload: { work_id: "work-1" } }]);
    expect(result).toEqual(reply);
    expect(result.volume_scope?.next_seq).toBe(2);
    expect(result.volume_scope?.current_volume_title).toBe("第一卷");
  });

  it("rejects with the server reason for structured error replies", async () => {
    const { channel } = mockChannel({
      status: "error",
      payload: { reason: "no_volume_to_extend" },
    });

    await expect(planNextVolume(channel, "work-1")).rejects.toThrow("no_volume_to_extend");
  });

  it("passes atom-style reasons through for the panel copy mapping", async () => {
    const { channel } = mockChannel({
      status: "error",
      payload: { reason: ":invalid_work" },
    });

    const error = await planNextVolume(channel, "work-1").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(":invalid_work");
  });

  it("falls back to the raw error payload when the reply carries no reason", async () => {
    const { channel } = mockChannel({ status: "error", payload: "invalid_work" });

    await expect(planNextVolume(channel, "work-1")).rejects.toThrow("invalid_work");
  });

  it("rejects with a dedicated timeout message", async () => {
    const { channel } = mockChannel({ status: "timeout" });

    await expect(planNextVolume(channel, "work-1")).rejects.toThrow("plan_next_volume timeout");
  });

  it("tolerates partial ok replies without inventing scope fields", async () => {
    const { channel } = mockChannel({ status: "ok", payload: { turn_id: "turn-2" } });

    const result = await planNextVolume(channel, "work-1");

    expect(result.turn_id).toBe("turn-2");
    expect(result.volume_scope).toBeUndefined();
  });

  it("keeps the visible copy centralized under STRUCTURE_PANEL.planNextVolume", () => {
    expect(STRUCTURE_PANEL.planNextVolume.label).toBe("规划下一卷");
    expect(STRUCTURE_PANEL.planNextVolume.loadingLabel).toBe("正在规划下一卷…");
    expect(STRUCTURE_PANEL.planNextVolume.actionFailed).toBe("规划下一卷失败，请重试。");
    expect(STRUCTURE_PANEL.planNextVolume.failureReasons.no_volume_to_extend).toContain("卷结构");
    expect(STRUCTURE_PANEL.planNextVolume.failureReasons.invalid_work).toContain("刷新");
  });
});
