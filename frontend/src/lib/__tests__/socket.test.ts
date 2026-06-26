/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/unbound-method */

import { describe, expect, it, vi } from "vitest";
import type { Channel, Push } from "phoenix";

import {
  createSocket,
  joinWorkspace,
  sendMessage,
  sendAuthorAction,
  getToc,
  getChapterContent,
  getCharacters,
  getForeshadowing,
  getRules,
  getWorkProfile,
  getWorkStats,
  exportWork,
  LLM_TURN_TIMEOUT_MS,
} from "../socket";

// 注：完整的 connect / ping-pong 端到端验证依赖 Phoenix server 在跑（mix phx.server）+
// 浏览器 WebSocket。本文件只覆盖 helper 的纯逻辑（socket / channel 对象构造），
// 端到端步骤记录在 tasks 决策日志的 manual verification 段。

// Mock Push object that Phoenix Channel.push returns
function mockPush(): Push {
  return {
    receive: vi.fn(() => mockPush()),
  } as unknown as Push;
}

function mockChannel(): Channel {
  return {
    push: vi.fn((_event: string, _payload: Record<string, unknown>) => mockPush()),
    on: vi.fn(() => 42),
    off: vi.fn(),
    topic: "workspace:lobby",
  } as unknown as Channel;
}

describe("createSocket", () => {
  it("默认 endpoint 为同源 /socket", () => {
    const socket = createSocket();
    expect(socket.endPointURL()).toContain("/socket");
  });

  it("覆盖 endpoint", () => {
    const socket = createSocket({ endpoint: "wss://example.com/socket" });
    expect(socket.endPointURL()).toContain("wss://example.com/socket");
  });
});

describe("joinWorkspace", () => {
  it("创建 channel 但不立即连接", () => {
    const socket = createSocket();
    const channel = joinWorkspace(socket, "workspace:lobby");
    expect(channel.topic).toBe("workspace:lobby");
  });

  it("默认 topic = workspace:lobby", () => {
    const socket = createSocket();
    const channel = joinWorkspace(socket);
    expect(channel.topic).toBe("workspace:lobby");
  });
});

describe("sendMessage", () => {
  it("pushes user_message with text and does not request micro plan by default", () => {
    const ch = mockChannel();
    sendMessage(ch, "你好");
    expect(ch.push).toHaveBeenCalledWith(
      "user_message",
      {
        text: "你好",
        work_id: undefined,
        session_id: undefined,
        behavior_id: undefined,
        generate_micro_plan: false,
      },
      LLM_TURN_TIMEOUT_MS,
    );
  });

  it("passes work_id when provided", () => {
    const ch = mockChannel();
    sendMessage(ch, "你好", "work-123");
    expect(ch.push).toHaveBeenCalledWith(
      "user_message",
      {
        text: "你好",
        work_id: "work-123",
        session_id: undefined,
        behavior_id: undefined,
        generate_micro_plan: false,
      },
      LLM_TURN_TIMEOUT_MS,
    );
  });

  it("can explicitly request a micro plan", () => {
    const ch = mockChannel();
    sendMessage(ch, "生成角色设定", "work-123", undefined, "session-123", true);
    expect(ch.push).toHaveBeenCalledWith(
      "user_message",
      {
        text: "生成角色设定",
        work_id: "work-123",
        session_id: "session-123",
        behavior_id: undefined,
        generate_micro_plan: true,
      },
      LLM_TURN_TIMEOUT_MS,
    );
  });

  it("passes candidate_selection without requesting a micro plan", () => {
    const ch = mockChannel();
    sendMessage(ch, "继续聊这个方向", "work-123", undefined, "session-123", false, {
      source_turn_ref: "turn-1",
      candidate_set_ref: "candidate_set:turn-1",
      candidate_ref: "dir-1",
    });
    expect(ch.push).toHaveBeenCalledWith(
      "user_message",
      {
        text: "继续聊这个方向",
        work_id: "work-123",
        session_id: "session-123",
        behavior_id: undefined,
        generate_micro_plan: false,
        candidate_selection: {
          source_turn_ref: "turn-1",
          candidate_set_ref: "candidate_set:turn-1",
          candidate_ref: "dir-1",
        },
      },
      LLM_TURN_TIMEOUT_MS,
    );
  });
});

describe("sendAuthorAction", () => {
  it("pushes author_action with source turn and action identity", () => {
    const ch = mockChannel();
    sendAuthorAction(ch, {
      source_turn_ref: "turn-1",
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      target_ref: "target-1",
      behavior_ref: "bh-1",
      idempotency_key: "ik-1",
    });
    expect(ch.push).toHaveBeenCalledWith(
      "author_action",
      {
        action: {
          source_turn_ref: "turn-1",
          action_id: "act-confirm",
          action_type: "confirm_before_execute",
          target_ref: "target-1",
          behavior_ref: "bh-1",
          idempotency_key: "ik-1",
        },
      },
      LLM_TURN_TIMEOUT_MS,
    );
  });

  it("resolves with duplicate flag passthrough on idempotent ok reply", async () => {
    const okPush = {
      receive: vi.fn(function (this: Push, event: string, cb: (r: unknown) => void) {
        if (event === "ok") cb({ received: true, action_status: "accepted", duplicate: true });
        return okPush;
      }),
    } as unknown as Push;
    const ch = {
      push: vi.fn(() => okPush),
      topic: "workspace:lobby",
    } as unknown as Channel;

    const result = await sendAuthorAction(ch, {
      source_turn_ref: "turn-1",
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      target_ref: "target-1",
      idempotency_key: "ik-dup",
    });

    expect(result.duplicate).toBe(true);
  });
});

describe("getToc", () => {
  it("pushes get_toc with work_id", () => {
    const ch = mockChannel();
    getToc(ch, "work-1");
    expect(ch.push).toHaveBeenCalledWith("get_toc", { work_id: "work-1" });
  });
});

describe("getChapterContent", () => {
  it("pushes get_chapter_content with chapter_id", () => {
    const ch = mockChannel();
    getChapterContent(ch, "chapter-1");
    expect(ch.push).toHaveBeenCalledWith("get_chapter_content", { chapter_id: "chapter-1" });
  });
});

describe("getCharacters", () => {
  it("pushes get_characters with work_id", () => {
    const ch = mockChannel();
    getCharacters(ch, "work-2");
    expect(ch.push).toHaveBeenCalledWith("get_characters", { work_id: "work-2" });
  });
});

describe("getForeshadowing", () => {
  it("pushes get_foreshadowing with work_id", () => {
    const ch = mockChannel();
    getForeshadowing(ch, "work-2");
    expect(ch.push).toHaveBeenCalledWith("get_foreshadowing", { work_id: "work-2" });
  });
});

describe("getRules", () => {
  it("pushes get_rules with work_id", () => {
    const ch = mockChannel();
    getRules(ch, "work-2");
    expect(ch.push).toHaveBeenCalledWith("get_rules", { work_id: "work-2" });
  });
});

describe("getWorkProfile", () => {
  it("pushes get_work_profile with work_id", () => {
    const ch = mockChannel();
    getWorkProfile(ch, "work-profile-1");
    expect(ch.push).toHaveBeenCalledWith("get_work_profile", { work_id: "work-profile-1" });
  });
});

describe("getWorkStats", () => {
  it("pushes get_work_stats with work_id", () => {
    const ch = mockChannel();
    getWorkStats(ch, "work-3");
    expect(ch.push).toHaveBeenCalledWith("get_work_stats", { work_id: "work-3" });
  });
});

describe("exportWork", () => {
  it("pushes export_work with work_id only when no directory is provided", () => {
    const ch = mockChannel();
    exportWork(ch, "work-1");
    expect(ch.push).toHaveBeenCalledWith("export_work", { work_id: "work-1" });
  });

  it("pushes export_work with work_id and export_dir when directory is provided", () => {
    const ch = mockChannel();
    exportWork(ch, "work-1", { exportDir: "/tmp/exports" });
    expect(ch.push).toHaveBeenCalledWith("export_work", {
      work_id: "work-1",
      export_dir: "/tmp/exports",
    });
  });

  it("delivers progress updates from task_state events", async () => {
    const onProgress = vi.fn();
    const listeners = new Map<string, Array<(payload: unknown) => void>>();

    const ch = {
      push: vi.fn(() => ({
        receive: vi.fn(function (this: unknown, event: string, cb: (r: unknown) => void) {
          if (event === "ok") {
            // 模拟 task_state 先到达，ok 回复后到。
            const taskStates = [
              { task_id: "t1", task_type: "export_work", phase: "RUNNING", progress: 10, step: "准备" },
              { task_id: "t1", task_type: "export_work", phase: "CHECKPOINT", progress: 50, step: "导出中" },
            ];
            setTimeout(() => {
              for (const state of taskStates) {
                listeners.get("task_state")?.forEach((handler) => handler(state));
              }
              cb({ path: "/tmp/export.md", format: "markdown" });
            }, 0);
          }
          return this;
        }),
      })),
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        const existing = listeners.get(event) ?? [];
        listeners.set(event, [...existing, handler]);
        return 42;
      }),
      off: vi.fn(),
    } as unknown as import("phoenix").Channel;

    const result = await exportWork(ch, "work-1", { onProgress });

    expect(onProgress).toHaveBeenCalledWith({ phase: "RUNNING", progress: 10, step: "准备" });
    expect(onProgress).toHaveBeenCalledWith({ phase: "CHECKPOINT", progress: 50, step: "导出中" });
    expect(result.path).toBe("/tmp/export.md");
    expect(ch.off).toHaveBeenCalledWith("task_state", 42);
  });

  it("ignores task_state events from other task types", async () => {
    const onProgress = vi.fn();
    const listeners = new Map<string, Array<(payload: unknown) => void>>();

    const ch = {
      push: vi.fn(() => ({
        receive: vi.fn(function (this: unknown, event: string, cb: (r: unknown) => void) {
          if (event === "ok") {
            setTimeout(() => {
              listeners
                .get("task_state")
                ?.forEach((handler) =>
                  handler({ task_id: "t1", task_type: "world_building", phase: "RUNNING", progress: 10 }),
                );
              cb({ path: "/tmp/export.md", format: "markdown" });
            }, 0);
          }
          return this;
        }),
      })),
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        const existing = listeners.get(event) ?? [];
        listeners.set(event, [...existing, handler]);
        return 7;
      }),
      off: vi.fn(),
    } as unknown as import("phoenix").Channel;

    await exportWork(ch, "work-1", { onProgress });
    expect(onProgress).not.toHaveBeenCalled();
  });
});
