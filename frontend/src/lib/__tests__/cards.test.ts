import { describe, expect, it } from "vitest";

import type { UICard, UIAction } from "../../components/WorkspaceChat";

describe("card type contracts", () => {
  it("clarification_card with answer action satisfies UICard", () => {
    const card: UICard = {
      card_type: "clarification_card",
      priority: "normal",
      visibility: "primary",
      title: "需要补充信息",
      body: "请重新描述你的意图",
      actions: [
        {
          action_id: "answer",
          action_type: "answer",
          label: "输入回答",
          target_ref: "behavior_turn_1",
          enabled: true,
          style_hint: "primary",
        },
      ],
    };

    expect(card.card_type).toBe("clarification_card");
    expect(card.actions).toHaveLength(1);
    expect(card.actions![0].action_type).toBe("answer");
  });

  it("answer action matches ADR-0006 §7 ASK_USER allowed action_types", () => {
    // ADR-0006 §7: ASK_USER → [answer, revise, dismiss]
    const validAnswerActions: UIAction[] = [
      {
        action_id: "answer",
        action_type: "answer",
        label: "回答",
        target_ref: "behavior_1",
        enabled: true,
      },
      {
        action_id: "dismiss",
        action_type: "dismiss",
        label: "跳过",
        target_ref: "behavior_1",
        enabled: true,
      },
    ];

    const actionTypes = validAnswerActions.map((a) => a.action_type);
    expect(actionTypes).toContain("answer");
    expect(actionTypes).toContain("dismiss");
  });
});
