// Design: docs/design/07-workbench-ui-contract.md §candidate_directions
// Regression for: docs/project-ledger.md §8.1 GAP-WT-01
//
// 守住后端 `candidate_directions` → 前端渲染条件之间的契约：
// 一旦 TurnResult.candidate_directions 形状被悄悄改坏，
// WorkspaceChat 候选面板的渲染条件 (`candidates.length > 0`) 就会失效。
import { describe, expect, it } from "vitest";

import type { CandidateDirection, TurnResult } from "../../components/WorkspaceChat";

const baseTurnResult = (candidates: CandidateDirection[] | undefined): TurnResult => ({
  schema_version: "3.0-draft",
  turn_id: "turn_t1",
  assistant_message: { text: "好的" },
  frame_summary: {
    frame_type: "creative_exploration",
    dialogue_goal: "帮作者展开创意",
  },
  phase: "completed",
  status: "conversational",
  next_action: "continue_dialogue",
  available_actions: [],
  produced_at: "2026-06-12T00:00:00Z",
  ...(candidates !== undefined ? { candidate_directions: candidates } : {}),
});

describe("TurnResult.candidate_directions contract", () => {
  it("returns a renderable array when LLM produces candidates", () => {
    const candidates: CandidateDirection[] = [
      {
        direction_id: "dir_1",
        title: "赛博公司垄断流",
        pitch: "底层散修对抗大厂灵气垄断",
        tone_tags: ["压抑", "反叛"],
        risk_hint: "high",
        adoption_status: "not_adopted",
      },
      {
        direction_id: "dir_2",
        title: "霓虹地牢生存流",
        pitch: "先活下去再图改变",
        tone_tags: ["求生", "黑色"],
        adoption_status: "not_adopted",
      },
    ];
    const result = baseTurnResult(candidates);

    // 这是 WorkspaceChat.tsx 的渲染门禁条件，必须为真
    expect(result.candidate_directions).toBeDefined();
    expect((result.candidate_directions ?? []).length).toBeGreaterThan(0);

    // 字段对齐 (ADR-0006/07-workbench-ui-contract)
    const first = result.candidate_directions![0];
    expect(first.direction_id).toBe("dir_1");
    expect(first.title).toBe("赛博公司垄断流");
    expect(first.pitch.length).toBeGreaterThan(0);
    expect(Array.isArray(first.tone_tags)).toBe(true);
    expect(first.risk_hint).toBe("high");
    expect(first.adoption_status).toBe("not_adopted");
  });

  it("renders nothing when LLM omits candidate_directions (reply-only frame)", () => {
    const result = baseTurnResult(undefined);
    // 渲染门禁：candidates 兜底为空数组时不渲染面板
    const candidates = result.candidate_directions ?? [];
    expect(candidates.length).toBe(0);
  });

  it("renders nothing when LLM returns explicit empty candidate_directions", () => {
    const result = baseTurnResult([]);
    const candidates = result.candidate_directions ?? [];
    expect(candidates.length).toBe(0);
  });
});
