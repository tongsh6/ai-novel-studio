import { afterEach, describe, expect, it, vi } from "vitest";

import { agentRunRuntimeAuthority } from "../agentRunAnchoring";
import { parseAgentRunState, validateAgentRunStatePayload } from "../agentRunStateWire";

const validPayload = {
  run_id: "run_1",
  run_mode: "bounded",
  status: "running",
  phase: "executing",
  runtime_live: true,
};

describe("agent_run_state wire (DS01 §9)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("合法 live payload 通过，runtime_live 保持 true", () => {
    expect(validateAgentRunStatePayload(validPayload)).toEqual([]);
    expect(parseAgentRunState(validPayload)?.runtime_live).toBe(true);
  });

  it("历史快照缺 runtime_live 合法，运行时权限为 unknown", () => {
    const historical = {
      run_id: "run_hist",
      run_mode: "bounded",
      status: "completed",
      phase: "finalizing",
    };
    const parsed = parseAgentRunState(historical);
    expect(parsed?.runtime_live).toBeUndefined();
  });

  it("漂移 payload 告警且 runtime_live 强制 unknown，不得授予命令权限", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const drifted = { ...validPayload, run_mode: "weird_mode" };
    const parsed = parseAgentRunState(drifted);
    expect(parsed?.runtime_live).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(validateAgentRunStatePayload(drifted).map((issue) => issue.path)).toContain("run_mode");
  });

  it("live/dead/unknown：只有 runtime_live=true 才授予 live；漂移/缺失为 unknown", () => {
    expect(agentRunRuntimeAuthority({ runtime_live: true })).toBe("live");
    expect(agentRunRuntimeAuthority({ runtime_live: false })).toBe("dead");
    expect(agentRunRuntimeAuthority({})).toBe("unknown");
    expect(agentRunRuntimeAuthority(null)).toBe("unknown");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const drifted = parseAgentRunState({ ...validPayload, run_mode: "weird_mode" });
    expect(agentRunRuntimeAuthority(drifted)).toBe("unknown");
    warn.mockRestore();
  });

  it("非对象 payload 拒绝，不回调", () => {
    expect(parseAgentRunState(null)).toBeNull();
    expect(parseAgentRunState("oops")).toBeNull();
  });
});
