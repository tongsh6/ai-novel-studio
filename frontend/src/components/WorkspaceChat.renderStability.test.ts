// AU10 CP1 render stability: message key must not change when AgentRun binding arrives.
import { describe, expect, it } from "vitest";

import { messageRenderKey } from "../lib/messageRenderKey";

describe("messageRenderKey", () => {
  it("stays stable when a late AgentRun binding/ack arrives", () => {
    const before = {
      role: "assistant" as const,
      text: "正在起草计划",
      turnId: "turn_123",
      clientMessageId: "client_1",
    };
    const stableKey = messageRenderKey(before, 0);

    expect(
      messageRenderKey(
        {
          ...before,
          agentRunId: "run_42",
        } as typeof before & { agentRunId: string },
        0,
      ),
    ).toBe(stableKey);

    expect(
      messageRenderKey(
        {
          ...before,
          turnResult: { turn_id: "turn_123" },
        },
        0,
      ),
    ).toBe(stableKey);
  });

  it("prefers immutable local client ids, then turn ids, then index; role stays distinct", () => {
    // The author message is first appended with a local clientMessageId and only
    // later receives a server turnId via ack binding; the key must not move.
    expect(
      messageRenderKey({ role: "user", clientMessageId: "client_a" }, 0),
    ).toBe("user:client_a");
    expect(
      messageRenderKey(
        { role: "user", clientMessageId: "client_a", turnId: "turn_a" },
        0,
      ),
    ).toBe("user:client_a");

    expect(
      messageRenderKey({ role: "assistant", turnId: "turn_b" }, 1),
    ).toBe("assistant:turn_b");
    expect(
      messageRenderKey(
        { role: "assistant", turnResult: { turn_id: "turn_c" } },
        2,
      ),
    ).toBe("assistant:turn_c");

    expect(messageRenderKey({ role: "assistant" }, 2)).toBe("assistant:2");
    expect(messageRenderKey({ role: "user" }, 2)).toBe("user:2");
  });
});
