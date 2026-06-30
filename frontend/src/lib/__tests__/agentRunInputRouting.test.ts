import { describe, expect, it } from "vitest";

import { shouldRouteInputToAgentSteer } from "../agentRunInputRouting";
import type { AgentRunStateData } from "../socket";

function run(status: string): AgentRunStateData {
  return {
    run_id: `run-${status}`,
    run_mode: "bounded",
    status,
    phase: "executing",
  };
}

describe("shouldRouteInputToAgentSteer", () => {
  it("routes ordinary input to steer while an AgentRun is active", () => {
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: run("running") })).toBe(true);
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: run("paused") })).toBe(true);
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: run("awaiting_author") })).toBe(true);
  });

  it("does not steal normal chat input when no active run exists", () => {
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: null })).toBe(false);
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: run("completed") })).toBe(false);
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: run("cancelled") })).toBe(false);
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: run("failed") })).toBe(false);
  });

  it("keeps pending author answers and explicit micro-plan requests on the user_message path", () => {
    expect(
      shouldRouteInputToAgentSteer({
        latestAgentRun: run("running"),
        pendingAnswerBehaviorId: "behavior_pending",
      }),
    ).toBe(false);

    expect(
      shouldRouteInputToAgentSteer({
        latestAgentRun: run("running"),
        generateMicroPlan: true,
      }),
    ).toBe(false);
  });
});
