import { describe, expect, it } from "vitest";

import { TurnResultSchema } from "../schemas";

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
