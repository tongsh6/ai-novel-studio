import { afterEach, describe, expect, it, vi } from "vitest";

import { parseIncomingTurnResult, validateTurnResultPayload } from "../turnResultWire";

const validPayload = {
  schema_version: "3.0-draft",
  turn_id: "turn_wire_ok",
  phase: "completed",
  status: "conversational",
  assistant_message: { text: "hello" },
  ui_cards: [{ card_type: "result_card", title: "done" }],
};

describe("validateTurnResultPayload", () => {
  it.each(["tentative", "PENDING"])("线上状态 %s 触发带字段路径的漂移告警", (adoption_status) => {
    const payload = {
      ...validPayload,
      adoption_state: {
        pending: [
          {
            artifact_id: "artifact",
            artifact_type: "character_seed",
            adoption_status,
            requires_adoption: true,
            payload: {},
          },
        ],
        resolved: [],
      },
    };
    expect(validateTurnResultPayload(payload).map((issue) => issue.path)).toContain(
      "adoption_state.pending.0.adoption_status",
    );
  });
  it("合法 payload 无 issue", () => {
    expect(validateTurnResultPayload(validPayload)).toEqual([]);
  });

  it("B45/B43：合法 orchestrator_decision（reply_only）无 issue", () => {
    const payload = {
      ...validPayload,
      orchestrator_decision: {
        decision_id: "decision_1",
        decision_type: "reply_only",
        decision_status: "decided",
        first_blocking_gate: null,
        required_author_action: null,
        decision_trace_ref: "trace_1",
      },
    };
    expect(validateTurnResultPayload(payload)).toEqual([]);
  });

  it("B45 CP2：trace_summary/truthfulness 已知键 typed 校验通过", () => {
    const payload = {
      ...validPayload,
      trace_summary: { decision_type: "reply_only", trace_ref: "trace_1" },
      truthfulness: { tool_called: false, production_write_performed: false },
    };
    expect(validateTurnResultPayload(payload)).toEqual([]);
  });

  it("B45 CP2：truthfulness 已知键类型错误被拒绝", () => {
    const payload = {
      ...validPayload,
      truthfulness: { tool_called: "yes" },
    };
    const issues = validateTurnResultPayload(payload);
    expect(issues.some((issue) => issue.path.startsWith("truthfulness"))).toBe(true);
  });

  it("B45/B43：未知 decision_type 产生 path 漂移 issue，不冒充通过", () => {
    const payload = {
      ...validPayload,
      orchestrator_decision: {
        decision_id: "decision_bad",
        decision_type: "mystery_decision",
        decision_status: "decided",
        decision_trace_ref: null,
      },
    };
    const issues = validateTurnResultPayload(payload);
    expect(
      issues.some((issue) => issue.path.startsWith("orchestrator_decision")),
    ).toBe(true);
  });

  it("漂移 payload 返回带 path 的 issue", () => {
    const issues = validateTurnResultPayload({
      ...validPayload,
      ui_cards: [{ card_type: "escalation_card" }],
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].path).toContain("ui_cards");
  });
});

describe("parseIncomingTurnResult", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("漂移 payload 原样透传（容错渲染），并 console.warn 告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const drifted = {
      ...validPayload,
      turn_id: "turn_wire_drift",
      ui_cards: [{ card_type: "unknown_card", title: "?", actions: [] }],
    };

    const result = parseIncomingTurnResult(drifted);

    expect(result).toBe(drifted);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ turn_id: "turn_wire_drift" });
  });

  it("同一 turn_id 只告警一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const drifted = {
      ...validPayload,
      turn_id: "turn_wire_once",
      ui_cards: [{ card_type: "unknown_card" }],
    };

    parseIncomingTurnResult(drifted);
    parseIncomingTurnResult(drifted);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("合法 payload 透传且不告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = parseIncomingTurnResult(validPayload);
    expect(result).toBe(validPayload);
    expect(warn).not.toHaveBeenCalled();
  });
});
