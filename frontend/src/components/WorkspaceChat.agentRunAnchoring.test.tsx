// Design: docs/design/ui/46-state-and-feedback.md §9.8 (action-triggered AgentRun anchoring)
// Prototype: novel-studio.pen → 46§9.8-quality-revision-running (EYiyl)
import { describe, expect, it } from "vitest";

import {
  assistantMessageTextForAgentRun,
  mergeAgentRunRuntimeState,
  messageAnchorsAgentRun,
  selectAgentRunActivitySummary,
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
  it("does not hydrate a persisted parent TurnResult with a different child AgentRun", () => {
    const childRun = {
      run_id: "run_revision_child",
      trigger: { kind: "author_action", action_type: "revise_from_findings" },
    };

    expect(selectAgentRunActivitySummary([childRun], "run_original_draft")).toBeNull();
    expect(selectAgentRunActivitySummary([childRun], null)).toBe(childRun);
  });

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

  it("inserts an author-action child turn after the parent turn's assistant message, not between user and assistant", () => {
    // stage 2026-07-05 事故回归：choose_candidate 成功子 turn 曾被插到
    // 「用户消息与候选卡之间」，落在长卡片上方视野外，作者以为没有反应。
    const cardsTurn = turnResult({
      turn_id: "turn_parent_1",
      assistant_message: { text: "这里是可讨论方向卡片" },
    });
    const messages: AgentRunAnchorMessage<TurnResult>[] = [
      { role: "user", text: "聊聊开篇", turnId: "turn_parent_1" },
      {
        role: "assistant",
        text: "这里是可讨论方向卡片",
        turnId: "turn_parent_1",
        turnResult: cardsTurn,
      },
    ];

    const child = turnResult({
      turn_id: "turn_child_1",
      parent_turn_id: "turn_parent_1",
      assistant_message: { text: "已将「从高冲突场景切入」设为后续创作方向" },
    });

    const next = upsertAssistantTurnResultMessage(messages, child);
    expect(next.map((message) => message.text)).toEqual([
      "聊聊开篇",
      "这里是可讨论方向卡片",
      "已将「从高冲突场景切入」设为后续创作方向",
    ]);
  });

  it("keeps sibling author-action children in arrival order after the parent turn", () => {
    const cardsTurn = turnResult({
      turn_id: "turn_parent_1",
      assistant_message: { text: "候选卡" },
    });
    const firstChild = turnResult({
      turn_id: "turn_child_1",
      parent_turn_id: "turn_parent_1",
      assistant_message: { text: "已设方向一" },
    });
    const messages: AgentRunAnchorMessage<TurnResult>[] = [
      { role: "user", text: "聊聊开篇", turnId: "turn_parent_1" },
      { role: "assistant", text: "候选卡", turnId: "turn_parent_1", turnResult: cardsTurn },
      {
        role: "assistant",
        text: "已设方向一",
        turnId: "turn_child_1",
        turnResult: firstChild,
      },
    ];

    const secondChild = turnResult({
      turn_id: "turn_child_2",
      parent_turn_id: "turn_parent_1",
      assistant_message: { text: "已设方向二" },
    });

    const next = upsertAssistantTurnResultMessage(messages, secondChild);
    expect(next.map((message) => message.text)).toEqual([
      "聊聊开篇",
      "候选卡",
      "已设方向一",
      "已设方向二",
    ]);
  });

  it("moves a resumed run result after the latest same-run steering message", () => {
    const awaitingResult = turnResult({
      turn_id: "turn_parent_resume:agent:2",
      phase: "awaiting_author",
      status: "needs_clarification",
      assistant_message: { text: "请补充具体扩写方向。" },
      agent_run: {
        run_id: "run_resume",
        run_mode: "bounded",
        parent_turn_ref: "turn_parent_resume",
        profile_ref: "judgment_loop_v1",
        status: "awaiting_author",
      },
    });
    const messages: AgentRunAnchorMessage<TurnResult>[] = [
      {
        role: "user",
        text: "第一章字数太少了",
        turnId: "turn_parent_resume",
        agentRunId: "run_resume",
      },
      {
        role: "assistant",
        text: "请补充具体扩写方向。",
        turnId: awaitingResult.turn_id,
        agentRunId: "run_resume",
        turnResult: awaitingResult,
      },
      {
        role: "user",
        text: "直接扩写，保持情节不变",
        clientMessageId: "local-resume-steer",
        agentRunId: "run_resume",
      },
    ];
    const completedResult = turnResult({
      turn_id: awaitingResult.turn_id,
      assistant_message: { text: "已按你的要求完成扩写。" },
      agent_run: {
        run_id: "run_resume",
        run_mode: "bounded",
        parent_turn_ref: "turn_parent_resume",
        profile_ref: "prose_drafting_with_quality_v1",
        status: "completed",
      },
    });

    expect(
      upsertAssistantTurnResultMessage(messages, completedResult).map((message) => message.text),
    ).toEqual([
      "第一章字数太少了",
      "直接扩写，保持情节不变",
      "已按你的要求完成扩写。",
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

  it("collects all assistant texts when the same run spans awaiting and completed turns", () => {
    const sourceResult = turnResult({
      turn_id: "turn_parent_steer:agent:2",
      assistant_message: { text: "请补充具体扩写方向。" },
      agent_run: {
        run_id: "run_steer",
        run_mode: "bounded",
        parent_turn_ref: "turn_parent_steer",
        profile_ref: "conversation_turn_v1",
        status: "awaiting_author",
      },
    });
    const messages: AgentRunAnchorMessage<TurnResult>[] = [
      {
        role: "user",
        text: "第一章字数太少了",
        turnId: "turn_parent_steer",
        agentRunId: "run_steer",
      },
      {
        role: "assistant",
        text: "请补充具体扩写方向。",
        turnId: sourceResult.turn_id,
        agentRunId: "run_steer",
        turnResult: sourceResult,
      },
      {
        role: "user",
        text: "直接扩写，保持情节不变",
        clientMessageId: "local-steer",
        agentRunId: "run_steer",
      },
      {
        role: "assistant",
        text: "已按你的要求完成扩写。",
        turnId: "turn_parent_steer:agent:7",
        agentRunId: "run_steer",
        turnResult: turnResult({
          turn_id: "turn_parent_steer:agent:7",
          assistant_message: { text: "已按你的要求完成扩写。" },
          agent_run: {
            run_id: "run_steer",
            run_mode: "bounded",
            parent_turn_ref: "turn_parent_steer",
            profile_ref: "prose_drafting_with_quality_v1",
            status: "completed",
          },
        }),
      },
    ];

    expect(assistantMessageTextForAgentRun(messages, "run_steer")).toBe(
      "请补充具体扩写方向。\n\n已按你的要求完成扩写。",
    );
  });

  it("anchors an author-action AgentRun to its source assistant turn", () => {
    const sourceTurn = turnResult({
      turn_id: "turn_quality_1",
      assistant_message: { text: "正文草稿与质量复核" },
    });
    const message: AgentRunAnchorMessage<TurnResult> = {
      role: "assistant",
      text: "正文草稿与质量复核",
      turnId: sourceTurn.turn_id,
      turnResult: sourceTurn,
    };
    const run: AgentRunStateData = {
      run_id: "run_revision_1",
      run_mode: "bounded",
      status: "running",
      phase: "executing",
      parent_turn_ref: "turn_quality_1",
      trigger: {
        kind: "author_action",
        action_type: "revise_from_findings",
        source_turn_ref: "turn_quality_1",
        source_surface_ref: "quality_review:turn_quality_1",
      },
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

  it("keeps an anchored completed run under the latest user message as the current position anchor", () => {
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
    ).toBe(true);
  });

  it("does not duplicate an anchored completed run under an older user message", () => {
    const run: AgentRunStateData = {
      run_id: "run_13",
      run_mode: "bounded",
      status: "completed",
      phase: "completed",
      parent_turn_ref: "turn_parent_13",
    };

    expect(
      shouldRenderAnchoredAgentRunStatus(run, {
        agentRunIdsRenderedInTurns: new Set(["run_13"]),
        messageIsLatest: false,
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
