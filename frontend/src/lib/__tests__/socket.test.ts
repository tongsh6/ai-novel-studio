/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/unbound-method */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Channel, Push } from "phoenix";

import {
  createSocket,
  joinWorkspace,
  sendMessage,
  sendSteerMessage,
  pendingUserMessages,
  saveUserMessage,
  transmitUserMessage,
  submissionIsSettled,
  sendAuthorAction,
  sendAgentCommand,
  onAgentEvent,
  onAgentRunState,
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
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      get length() {
        return store.size;
      },
      key: (n: number) => [...store.keys()][n] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("先持久原文，再把稳定身份与参数发上 wire", async () => {
    const ch = mockChannel();
    void sendMessage(
      ch,
      "  原文\n第二行  ",
      "work-123",
      null,
      "session-123",
      true,
      null,
      "message-1",
    );
    await vi.waitFor(() => expect(ch.push).toHaveBeenCalled());
    const [saved] = await pendingUserMessages("work-123", "session-123");
    expect(saved.text).toBe("  原文\n第二行  ");
    expect(ch.push).toHaveBeenCalledWith("user_message", saved, LLM_TURN_TIMEOUT_MS);
    expect(saved.turn_id).toBe("message-1");
    expect(saved.generate_micro_plan).toBe(true);
  });

  it("候选继续的引用原样保存，刷新/重传复用身份，作者新发送另建身份", async () => {
    const ch = mockChannel();
    const candidate = {
      source_turn_ref: "turn-1",
      candidate_set_ref: "candidate_set:turn-1",
      candidate_ref: "dir-1",
    };
    void sendMessage(ch, "继续", "work-123", null, "session-123", false, candidate);
    await vi.waitFor(() => expect(ch.push).toHaveBeenCalledTimes(1));
    const [saved] = await pendingUserMessages("work-123", "session-123");
    expect(saved.candidate_selection).toEqual(candidate);
    void transmitUserMessage(ch, saved);
    expect(ch.push).toHaveBeenLastCalledWith("user_message", saved, LLM_TURN_TIMEOUT_MS);
    void sendMessage(ch, "继续", "work-123", null, "session-123", false, candidate);
    await vi.waitFor(() => expect(ch.push).toHaveBeenCalledTimes(3));
    expect(
      new Set((await pendingUserMessages("work-123", "session-123")).map((entry) => entry.turn_id))
        .size,
    ).toBe(2);
  });

  it("引导命令与原运行绑定，重传不换消息身份", async () => {
    const ch = mockChannel();
    void sendSteerMessage(
      ch,
      "run-existing",
      "增加心理描写",
      "work-a",
      "session-a",
      "steer-message-1",
    );
    await vi.waitFor(() => expect(ch.push).toHaveBeenCalledTimes(1));
    const [saved] = await pendingUserMessages("work-a", "session-a");
    expect(saved.command).toBe("steer");
    expect(saved.run_id).toBe("run-existing");
    void transmitUserMessage(ch, saved);
    expect(ch.push).toHaveBeenLastCalledWith("agent_command", saved, undefined);
  });

  it("本机保存失败或身份冲突不发送；待投递按作品和会话隔离", async () => {
    const ch = mockChannel();
    void sendMessage(ch, "原文", "work-a", null, "session-a", false, null, "message-a");
    await vi.waitFor(() => expect(ch.push).toHaveBeenCalledTimes(1));
    const [saved] = await pendingUserMessages("work-a", "session-a");
    await expect(saveUserMessage({ ...saved, text: "覆盖" })).rejects.toMatchObject({
      kind: "storage",
    });
    expect(await pendingUserMessages("work-b", "session-a")).toEqual([]);
    expect(await pendingUserMessages("work-a", "session-b")).toEqual([]);
    vi.stubGlobal("localStorage", {
      setItem() {
        throw new Error("disk full");
      },
      getItem() {
        return null;
      },
    });
    await expect(sendMessage(ch, "保留", "work-a", null, "session-a")).rejects.toMatchObject({
      kind: "storage",
    });
    expect(ch.push).toHaveBeenCalledTimes(1);
  });

  it("明确拒绝仍保留原文，但不再自动投递", async () => {
    const callbacks = new Map<string, (arg?: unknown) => void>();
    const push = {
      receive(event: string, fn: (arg?: unknown) => void) {
        callbacks.set(event, fn);
        return this;
      },
    };
    const ch = { push: vi.fn(() => push) } as unknown as Channel;
    const result = sendMessage(
      ch,
      "未被接受的原文",
      "work-a",
      null,
      "session-a",
      false,
      null,
      "message-rejected",
    );
    const rejected = expect(result).rejects.toMatchObject({ kind: "rejected" });
    await vi.waitFor(() => expect(callbacks.has("error")).toBe(true));
    callbacks.get("error")!({ reason: "not_found" });
    await rejected;
    const [saved] = await pendingUserMessages("work-a", "session-a");
    expect(saved.text).toBe("未被接受的原文");
    expect(saved.delivery_status).toBe("rejected");
    await expect(transmitUserMessage(ch, saved)).rejects.toMatchObject({ kind: "rejected" });
    expect(ch.push).toHaveBeenCalledTimes(1);
  });

  it("回执丢失保留原身份；完成/失败/失活回执可收束，运行中不收束", async () => {
    const callbacks = new Map<string, (arg?: unknown) => void>();
    const push = {
      receive(event: string, fn: (arg?: unknown) => void) {
        callbacks.set(event, fn);
        return this;
      },
    };
    const ch = { push: vi.fn(() => push) } as unknown as Channel;
    const result = sendMessage(ch, "原文", "work-a", null, "session-a", false, null, "message-a");
    const rejected = expect(result).rejects.toMatchObject({ kind: "transport" });
    await vi.waitFor(() => expect(callbacks.has("timeout")).toBe(true));
    callbacks.get("timeout")!();
    await rejected;
    const [saved] = await pendingUserMessages("work-a", "session-a");
    const retry = transmitUserMessage(ch, saved);
    callbacks.get("ok")!({
      received: true,
      turn_id: "message-a",
      runtime_live: false,
      agent_run_state: { status: "failed" },
    });
    expect((await retry).agent_run_state?.status).toBe("failed");
    await vi.waitFor(() => expect(store.size).toBe(0));
    expect(submissionIsSettled({ received: true, runtime_live: true })).toBe(false);
    expect(submissionIsSettled({ received: true, runtime_live: false })).toBe(true);
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

describe("agent run socket helpers", () => {
  it("registers agent event and state listeners", () => {
    const ch = mockChannel();
    const eventCallback = vi.fn();
    const stateCallback = vi.fn();

    onAgentEvent(ch, eventCallback);
    onAgentRunState(ch, stateCallback);

    expect(ch.on).toHaveBeenCalledWith("agent_event", expect.any(Function));
    expect(ch.on).toHaveBeenCalledWith("agent_run_state", expect.any(Function));
  });

  it("pushes agent_command with run id and command", () => {
    const ch = mockChannel();

    sendAgentCommand(ch, "run-1", "pause");

    expect(ch.push).toHaveBeenCalledWith("agent_command", {
      run_id: "run-1",
      command: "pause",
    });
  });

  it("pushes steer text when provided", () => {
    const ch = mockChannel();

    sendAgentCommand(ch, "run-1", "steer", "改成更冷静的反派");

    expect(ch.push).toHaveBeenCalledWith("agent_command", {
      run_id: "run-1",
      command: "steer",
      text: "改成更冷静的反派",
    });
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
              {
                task_id: "t1",
                task_type: "export_work",
                phase: "RUNNING",
                progress: 10,
                step: "准备",
              },
              {
                task_id: "t1",
                task_type: "export_work",
                phase: "CHECKPOINT",
                progress: 50,
                step: "导出中",
              },
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
              listeners.get("task_state")?.forEach((handler) =>
                handler({
                  task_id: "t1",
                  task_type: "world_building",
                  phase: "RUNNING",
                  progress: 10,
                }),
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
