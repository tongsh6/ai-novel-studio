import { describe, expect, it } from "vitest";

import { CandidateDirectionSchema, TurnResultSchema } from "../schemas";

// v3 线格式（docs/design/schemas/foundation/turn_result_v3.json，ADR-0024）。
const minimalValid = {
  schema_version: "3.0-draft",
  turn_id: "turn_001",
  phase: "completed",
  status: "conversational",
  assistant_message: { text: "hello" },
  ui_cards: [],
  behavior_state: { active: null, history: [] },
  adoption_state: { pending: [], resolved: [] },
  projection_refs: [],
  produced_at: "2026-07-15T00:00:00Z",
};

describe("TurnResultSchema", () => {
  it("接受最小合法 payload（v3 draft）", () => {
    const parsed = TurnResultSchema.parse(minimalValid);
    expect(parsed.turn_id).toBe("turn_001");
    expect(parsed.schema_version).toBe("3.0-draft");
  });

  it("拒绝缺失 turn_id", () => {
    const { turn_id: _omit, ...invalid } = minimalValid;
    void _omit;
    const result = TurnResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("容忍后端新增顶层字段（v3 draft 期 additionalProperties=true）", () => {
    const result = TurnResultSchema.safeParse({
      ...minimalValid,
      truthfulness: { tool_called: false },
      frame_ref: "frame_turn_001",
    });
    expect(result.success).toBe(true);
  });

  it("接受入册的三种 ui_cards（ADR-0024 决策 3）", () => {
    const payload = {
      ...minimalValid,
      ui_cards: [
        {
          card_type: "candidate_set",
          priority: "high",
          visibility: "always",
          title: "待保存草稿",
          body: "确认保存后进入作品档案。",
          artifact_refs: ["as_001"],
          candidate_set_ref: "as_001",
          artifact_type: "character_seed",
          items: [{ item_id: "item_1", title: "林九", body: "散修" }],
          tentative: true,
        },
        {
          card_type: "confirmation_card",
          title: "需要确认",
          body: "此操作需要作者确认。",
          behavior_ref: "bhv_001",
          target_ref: "art_001",
        },
        {
          card_type: "result_card",
          title: "已设为后续方向",
          body: "不会写入作品事实。",
        },
      ],
    };
    const result = TurnResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("漂移注入：拒绝未入册 card_type", () => {
    const result = TurnResultSchema.safeParse({
      ...minimalValid,
      ui_cards: [{ card_type: "clarification_card", title: "?" }],
    });
    expect(result.success).toBe(false);
  });

  it("漂移注入：拒绝携带 actions 字段的卡片（N-SURF：卡片不承载决策）", () => {
    const result = TurnResultSchema.safeParse({
      ...minimalValid,
      ui_cards: [{ card_type: "result_card", title: "done", actions: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("接受非空 projection_refs", () => {
    const payload = {
      ...minimalValid,
      projection_refs: [
        {
          projection_type: "reading_projection_root",
          projection_id: "proj_001",
          source_revision_refs: ["rev_1"],
        },
      ],
    };
    const result = TurnResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("接受非空 adoption_state.pending（线上小写 adoption_status + payload）", () => {
    const payload = {
      ...minimalValid,
      adoption_state: {
        pending: [
          {
            artifact_id: "art_001",
            artifact_type: "character_seed",
            adoption_status: "tentative",
            requires_adoption: true,
            payload: { items: [{ title: "林九" }] },
          },
        ],
        resolved: [],
      },
    };
    const result = TurnResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("漂移注入：拒绝缺 payload 的 adoption_state 条目", () => {
    const result = TurnResultSchema.safeParse({
      ...minimalValid,
      adoption_state: {
        pending: [
          {
            artifact_id: "art_001",
            artifact_type: "character_seed",
            adoption_status: "tentative",
            requires_adoption: true,
          },
        ],
        resolved: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("CandidateDirectionSchema", () => {
  const validCandidate = {
    direction_id: "dir_001",
    title: "赛博公司垄断流",
    pitch: "底层散修对抗大厂灵气垄断",
    tone_tags: ["压抑", "反叛"],
    risk_hint: "high",
    adoption_status: "not_adopted",
  };

  it("接受候选方向 canonical 字段", () => {
    const parsed = CandidateDirectionSchema.parse(validCandidate);
    expect(parsed.adoption_status).toBe("not_adopted");
    expect(parsed.tone_tags).toEqual(["压抑", "反叛"]);
  });

  it("拒绝把 artifact adoption 状态用于候选方向", () => {
    const result = CandidateDirectionSchema.safeParse({
      ...validCandidate,
      adoption_status: "TENTATIVE",
    });
    expect(result.success).toBe(false);
  });

  it("拒绝缺失 adoption_status 的候选方向", () => {
    const { adoption_status: _omit, ...payload } = validCandidate;
    void _omit;
    const result = CandidateDirectionSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
