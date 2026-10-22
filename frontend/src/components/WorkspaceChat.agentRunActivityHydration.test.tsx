// Design: docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md (AgentRun 关联摘要 / activity 补水)
// Prototype: novel-studio.pen → 46§9-agentic-loop-reasoning-flow (DM8gx)
import { describe, expect, it } from "vitest";

import { agentRunActivityQueryTurn } from "../lib/agentRunAnchoring";
import type { TurnResult } from "./WorkspaceChat";

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

describe("WorkspaceChat AgentRun activity hydration query turn", () => {
  // B23 CP1（F2）：judgment_plan / judgment_loop 的子 turn 没有自己的 run，
  // activity 必须按 run 的 parent_turn_ref（父消息 id）查询才能命中停等理由。
  it("queries with the parent message turn for a child agent turn result", () => {
    const result = turnResult({
      turn_id: "message_parent_b23:agent:6",
      agent_run: {
        run_id: "run_judgment_plan_b23",
        parent_turn_ref: "message_parent_b23",
        status: "awaiting_author",
      },
    });

    expect(agentRunActivityQueryTurn(result)).toBe("message_parent_b23");
  });

  // 历史 transcript 摘要没有 parent_turn_ref 时仍用 turn_id，交给后端按父 id 回退查询。
  it("falls back to the turn id when the persisted agent_run summary has no parent ref", () => {
    const result = turnResult({
      turn_id: "message_parent_b23:agent:6",
      agent_run: { run_id: "run_judgment_plan_b23", status: "awaiting_author" },
    });

    expect(agentRunActivityQueryTurn(result)).toBe("message_parent_b23:agent:6");
  });

  it("ignores a blank or null parent ref", () => {
    expect(
      agentRunActivityQueryTurn(
        turnResult({
          turn_id: "turn_plain",
          agent_run: { run_id: "run_plain", parent_turn_ref: " " },
        }),
      ),
    ).toBe("turn_plain");
    expect(
      agentRunActivityQueryTurn(
        turnResult({
          turn_id: "turn_plain",
          agent_run: { run_id: "run_plain", parent_turn_ref: null },
        }),
      ),
    ).toBe("turn_plain");
  });
});
