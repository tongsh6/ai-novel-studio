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
  it("合法 payload 无 issue", () => {
    expect(validateTurnResultPayload(validPayload)).toEqual([]);
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
