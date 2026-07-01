// Design: docs/design/ui/46-state-and-feedback.md §3.1 (AgentRun dialogue flow)
// Prototype: novel-studio.pen → 46§8-agent-run-dialogue-flow-v4 (kg4wN)
import { describe, expect, it } from "vitest";

import {
  mergeAgentRunRuntimeState,
  messageAnchorsAgentRun,
  upsertAssistantTurnResultMessage,
  type AgentRunAnchorMessage,
} from "../lib/agentRunAnchoring";
import { shouldRouteInputToAgentSteer } from "../lib/agentRunInputRouting";
import {
  type TurnResult,
} from "./WorkspaceChat";
import type { AgentRunStateData } from "../lib/socket";

function turnResult(attrs: Partial<TurnResult>): TurnResult {
  return {
    schema_version: "3.0-draft",
    turn_id: "turn_result",
    phase: "completed",
    status: "completed",
    next_action: "continue",
    assistant_message: { text: "完成回应" },
    produced_at: "2026-07-01T00:00:00Z",
    ...attrs,
  };
}

describe("WorkspaceChat AgentRun message anchoring", () => {
  it("inserts a late AgentRun assistant result after its parent user turn", () => {
    const messages: AgentRunAnchorMessage<TurnResult>[] = [
      { role: "user", text: "第一条请求", turnId: "turn_parent_1", agentRunId: "run_1" },
      { role: "user", text: "第二条请求", turnId: "turn_parent_2", agentRunId: "run_2" },
    ];

    const result = turnResult({
      turn_id: "turn_parent_1:agent:2",
      assistant_message: { text: "第一条完成" },
      agent_run: {
        run_id: "run_1",
        run_mode: "bounded",
        parent_turn_ref: "turn_parent_1",
        profile_ref: "plot_outline_with_context_v1",
        status: "completed",
      },
    });

    expect(upsertAssistantTurnResultMessage(messages, result)).toEqual([
      messages[0],
      {
        role: "assistant",
        text: "第一条完成",
        turnId: "turn_parent_1:agent:2",
        agentRunId: "run_1",
        turnResult: result,
      },
      messages[1],
    ]);
  });

  it("anchors a running AgentRun to the user message that received its fast ack", () => {
    const message: AgentRunAnchorMessage<TurnResult> = {
      role: "user",
      text: "更新角色状态",
      turnId: "turn_parent_3",
      agentRunId: "run_3",
    };
    const run: AgentRunStateData = {
      run_id: "run_3",
      run_mode: "bounded",
      status: "running",
      phase: "executing",
      parent_turn_ref: "turn_parent_3",
    };

    expect(messageAnchorsAgentRun(message, run)).toBe(true);
  });

  it("treats a turn_result terminal state as authoritative for later input routing", () => {
    const acknowledgedRun: AgentRunStateData = {
      run_id: "run_4",
      run_mode: "bounded",
      status: "running",
      phase: "executing",
      parent_turn_ref: "turn_parent_4",
    };
    const completedFromTurnResult: AgentRunStateData = {
      ...acknowledgedRun,
      status: "completed",
      phase: "completed",
    };

    const merged = mergeAgentRunRuntimeState(acknowledgedRun, completedFromTurnResult);

    expect(merged.status).toBe("completed");
    expect(
      shouldRouteInputToAgentSteer({
        latestAgentRun: merged,
        pendingAnswerBehaviorId: null,
      }),
    ).toBe(false);
  });

  it("does not let delayed running state reopen a completed AgentRun", () => {
    const completedRun: AgentRunStateData = {
      run_id: "run_5",
      run_mode: "bounded",
      status: "completed",
      phase: "completed",
      parent_turn_ref: "turn_parent_5",
    };
    const delayedRunningState: AgentRunStateData = {
      ...completedRun,
      status: "running",
      phase: "executing",
    };

    expect(mergeAgentRunRuntimeState(completedRun, delayedRunningState)).toEqual(completedRun);
  });
});
