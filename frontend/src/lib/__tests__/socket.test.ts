import { describe, expect, it } from "vitest";

import { createSocket, joinWorkspace } from "../socket";

// 注：完整的 connect / ping-pong 端到端验证依赖 Phoenix server 在跑（mix phx.server）+
// 浏览器 WebSocket。本文件只覆盖 helper 的纯逻辑（socket / channel 对象构造），
// 端到端步骤记录在 tasks 决策日志的 manual verification 段。

describe("createSocket", () => {
  it("默认 endpoint 为同源 /socket", () => {
    const socket = createSocket();
    expect(socket.endPointURL()).toContain("/socket");
  });

  it("覆盖 endpoint", () => {
    const socket = createSocket({ endpoint: "ws://example.com/socket" });
    expect(socket.endPointURL()).toContain("ws://example.com/socket");
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
