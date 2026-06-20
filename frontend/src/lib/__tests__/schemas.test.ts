import { describe, expect, it } from "vitest";

import { CandidateDirectionSchema, TurnResultSchema } from "../schemas";

const minimalValid = {
  schema_version: "2.0.0",
  turn_id: "turn_001",
  phase: "EXECUTING",
  status: "RUNNING",
  next_action: "ASK_USER",
  assistant_message: { text: "hello" },
  ui_cards: [],
  behavior_state: { active: null, history: [] },
  adoption_state: { pending: [], resolved: [] },
  projection_refs: [],
  validation: {},
  usage: {},
  trace_ref: {},
  produced_at: "2026-04-27T00:00:00Z",
};

describe("TurnResultSchema", () => {
  it("接受最小合法 payload", () => {
    const parsed = TurnResultSchema.parse(minimalValid);
    expect(parsed.turn_id).toBe("turn_001");
    expect(parsed.schema_version).toBe("2.0.0");
  });

  it("拒绝缺失 schema_version", () => {
    const { schema_version: _omit, ...invalid } = minimalValid;
    void _omit;
    const result = TurnResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("拒绝非 semver 的 schema_version", () => {
    const result = TurnResultSchema.safeParse({
      ...minimalValid,
      schema_version: "v2",
    });
    expect(result.success).toBe(false);
  });

  it("接受非空 ui_cards", () => {
    const payload = {
      ...minimalValid,
      ui_cards: [
        {
          card_type: "clarification",
          card_id: "card_001",
          title: "需要补充信息",
          body_markdown: "请提供更多细节",
          actions: [],
        },
      ],
    };
    const result = TurnResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
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

  it("接受非空 adoption_state.pending", () => {
    const payload = {
      ...minimalValid,
      adoption_state: {
        pending: [
          {
            artifact_id: "art_001",
            artifact_type: "work_seed",
            adoption_status: "TENTATIVE",
            requires_adoption: true,
          },
        ],
        resolved: [],
      },
    };
    const result = TurnResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
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
