/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/unbound-method */

import { describe, expect, it, vi } from "vitest";
import type { Channel, Push } from "phoenix";

import { createSocket, joinWorkspace, sendMessage, sendAuthorAction, adopt, discardArtifact, modifyDraft, getToc, getChapterContent, getCharacters, getWorkStats } from "../socket";

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
    expect(ch.push).toHaveBeenCalledWith("user_message", { text: "你好", work_id: undefined, behavior_id: undefined, generate_micro_plan: false }, 60000);
  });

  it("passes work_id when provided", () => {
    const ch = mockChannel();
    sendMessage(ch, "你好", "work-123");
    expect(ch.push).toHaveBeenCalledWith("user_message", { text: "你好", work_id: "work-123", behavior_id: undefined, generate_micro_plan: false }, 60000);
  });

  it("can explicitly request a micro plan", () => {
    const ch = mockChannel();
    sendMessage(ch, "生成角色设定", "work-123", undefined, true);
    expect(ch.push).toHaveBeenCalledWith("user_message", { text: "生成角色设定", work_id: "work-123", behavior_id: undefined, generate_micro_plan: true }, 60000);
  });
});

describe("sendAuthorAction", () => {
  it("pushes author_action with source turn and action identity", () => {
    const ch = mockChannel();
    sendAuthorAction(ch, {
      source_turn_ref: "turn-1",
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      behavior_ref: "bh-1",
      idempotency_key: "ik-1",
    });
    expect(ch.push).toHaveBeenCalledWith("author_action", {
      action: {
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        behavior_ref: "bh-1",
        idempotency_key: "ik-1",
      },
    }, 60000);
  });
});

describe("adopt", () => {
  it("pushes adopt with artifact data", () => {
    const ch = mockChannel();
    adopt(ch, "artifact-1", 3, { title: "test" }, "draft_text");
    expect(ch.push).toHaveBeenCalledWith("adopt", {
      artifact_id: "artifact-1", base_revision: 3, payload: { title: "test" }, artifact_type: "draft_text",
    }, 60000);
  });
});

describe("discardArtifact", () => {
  it("pushes discard with artifact_type", () => {
    const ch = mockChannel();
    discardArtifact(ch, "artifact-2", "draft_text");
    expect(ch.push).toHaveBeenCalledWith("discard", {
      artifact_id: "artifact-2", artifact_type: "draft_text",
    }, 60000);
  });

  it("omits artifact_type when not provided", () => {
    const ch = mockChannel();
    discardArtifact(ch, "artifact-3");
    expect(ch.push).toHaveBeenCalledWith("discard", {
      artifact_id: "artifact-3", artifact_type: undefined,
    }, 60000);
  });
});

describe("modifyDraft", () => {
  it("pushes modify_draft with all fields", () => {
    const ch = mockChannel();
    modifyDraft(ch, "draft-1", 5, "原文内容", "改得更激烈一些");
    expect(ch.push).toHaveBeenCalledWith("modify_draft", {
      draft_id: "draft-1", base_revision: 5, content: "原文内容", instruction: "改得更激烈一些",
    }, 60000);
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

describe("getWorkStats", () => {
  it("pushes get_work_stats with work_id", () => {
    const ch = mockChannel();
    getWorkStats(ch, "work-3");
    expect(ch.push).toHaveBeenCalledWith("get_work_stats", { work_id: "work-3" });
  });
});
