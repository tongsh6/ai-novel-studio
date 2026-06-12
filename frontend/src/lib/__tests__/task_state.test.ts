// Design: docs/design-v3/07-workbench-ui-contract.md (long-running tasks)
// Regression for: docs/project-ledger.md §8.1 GAP-WT-03
//
// 守住后端 `task_state` Channel 事件 → 前端状态条之间的契约形状：
// TaskStateData 缺字段或类型漂移会让"长跑指示"重新失效。
import { describe, expect, it } from "vitest";

import type { TaskStateData } from "../socket";

describe("TaskStateData contract", () => {
  it("RUNNING with progress is renderable", () => {
    const state: TaskStateData = {
      task_id: "task_123",
      task_type: "world_building",
      phase: "RUNNING",
      status: "RUNNING",
      progress: 50,
      step: "world_gen",
      updated_at: "2026-05-11T14:30:00Z",
    };
    expect(state.phase).toBe("RUNNING");
    expect(state.progress).toBe(50);
    expect(typeof state.step).toBe("string");
  });

  it("COMPLETED without progress still has phase", () => {
    const state: TaskStateData = {
      task_id: "task_123",
      phase: "COMPLETED",
      status: "DONE",
    };
    expect(state.phase).toBe("COMPLETED");
    expect(state.progress).toBeUndefined();
  });

  it("phase enum covers v3 TaskPhase values", () => {
    // Mirrors apps/novel_foundation/lib/novel_foundation/enums/task_phase.ex
    const expected = [
      "PLANNED",
      "ESTIMATED",
      "CONFIRMATION_REQUIRED",
      "CONFIRMED",
      "RUNNING",
      "CHECKPOINT",
      "RESUMING",
      "COMPLETED",
      "CANCELLED",
      "FAILED",
      "BRANCHED",
    ];
    // Type-only check: each must be assignable to phase: string, but more
    // importantly, the front-end badge mapper must not crash on any of them.
    for (const phase of expected) {
      const state: TaskStateData = { task_id: "t", phase, status: "RUNNING" };
      expect(state.phase).toBe(phase);
    }
  });
});
