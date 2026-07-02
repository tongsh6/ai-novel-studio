// Design: docs/design/ui/46-state-and-feedback.md §3.1 (AgentRun dialogue flow)
// Prototype: novel-studio.pen → 46§8-agent-run-dialogue-flow-v4 (kg4wN)
import { describe, expect, it } from "vitest";

import {
  mergeAgentRunRuntimeState,
  messageAnchorsAgentRun,
  shouldRenderAnchoredAgentRunStatus,
  shouldRenderStandaloneAgentRunStatus,
  shouldRenderUserAgentRunPlaceholder,
  upsertAssistantTurnResultMessage,
  type AgentRunAnchorMessage,
} from "../lib/agentRunAnchoring";
import { shouldRouteInputToAgentSteer } from "../lib/agentRunInputRouting";
import { type TurnResult } from "./WorkspaceChat";
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

  it("keeps an immediate visible placeholder after fast ack before run state arrives", () => {
    const message: AgentRunAnchorMessage<TurnResult> = {
      role: "user",
      text: "下一步可以做什么",
      turnId: "turn_parent_6",
      agentRunId: "run_6",
    };

    expect(
      shouldRenderUserAgentRunPlaceholder(message, {
        anchoredRun: null,
        agentRunIdsRenderedInTurns: new Set(),
        hasPendingAnchor: false,
      }),
    ).toBe(true);
  });

  it("does not keep the placeholder after the assistant turn renders the same run", () => {
    const message: AgentRunAnchorMessage<TurnResult> = {
      role: "user",
      text: "下一步可以做什么",
      turnId: "turn_parent_7",
      agentRunId: "run_7",
    };

    expect(
      shouldRenderUserAgentRunPlaceholder(message, {
        anchoredRun: null,
        agentRunIdsRenderedInTurns: new Set(["run_7"]),
        hasPendingAnchor: false,
      }),
    ).toBe(false);
  });

  it("renders an anchored active run under the latest user message even if an older turn already rendered it", () => {
    const run: AgentRunStateData = {
      run_id: "run_11",
      run_mode: "bounded",
      status: "running",
      phase: "executing",
      parent_turn_ref: "turn_parent_11",
    };

    expect(
      shouldRenderAnchoredAgentRunStatus(run, {
        agentRunIdsRenderedInTurns: new Set(["run_11"]),
        messageIsLatest: true,
      }),
    ).toBe(true);
  });

  it("does not duplicate an anchored completed run under the latest user message", () => {
    const run: AgentRunStateData = {
      run_id: "run_12",
      run_mode: "bounded",
      status: "completed",
      phase: "completed",
      parent_turn_ref: "turn_parent_12",
    };

    expect(
      shouldRenderAnchoredAgentRunStatus(run, {
        agentRunIdsRenderedInTurns: new Set(["run_12"]),
        messageIsLatest: true,
      }),
    ).toBe(false);
  });

  it("renders the current active run at the bottom when the latest user message is not its anchor", () => {
    const run: AgentRunStateData = {
      run_id: "run_8",
      run_mode: "bounded",
      status: "running",
      phase: "executing",
      parent_turn_ref: "turn_parent_8",
    };
    const latestMessage: AgentRunAnchorMessage<TurnResult> = {
      role: "user",
      text: "继续聊这个方向",
      turnId: "turn_followup_8",
    };

    expect(
      shouldRenderStandaloneAgentRunStatus(run, latestMessage, {
        agentRunIdsRenderedInTurns: new Set(),
        hasMessageAnchor: true,
      }),
    ).toBe(true);
  });

  it("still renders the active run at the bottom when the same run was rendered in an older turn", () => {
    const run: AgentRunStateData = {
      run_id: "run_10",
      run_mode: "bounded",
      status: "awaiting_author",
      phase: "interrupted",
      parent_turn_ref: "turn_parent_10",
    };
    const latestMessage: AgentRunAnchorMessage<TurnResult> = {
      role: "user",
      text: "继续聊这个方向",
      turnId: "turn_followup_10",
    };

    expect(
      shouldRenderStandaloneAgentRunStatus(run, latestMessage, {
        agentRunIdsRenderedInTurns: new Set(["run_10"]),
        hasMessageAnchor: true,
      }),
    ).toBe(true);
  });

  it("does not duplicate a completed run at the bottom when it already has an older anchor", () => {
    const run: AgentRunStateData = {
      run_id: "run_9",
      run_mode: "bounded",
      status: "completed",
      phase: "completed",
      parent_turn_ref: "turn_parent_9",
    };
    const latestMessage: AgentRunAnchorMessage<TurnResult> = {
      role: "user",
      text: "继续聊这个方向",
      turnId: "turn_followup_9",
    };

    expect(
      shouldRenderStandaloneAgentRunStatus(run, latestMessage, {
        agentRunIdsRenderedInTurns: new Set(),
        hasMessageAnchor: true,
      }),
    ).toBe(false);
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
