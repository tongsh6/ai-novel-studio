import { describe, expect, it } from "vitest";

import type {
  AdoptionDecisionData,
  UICardData as UICard,
  UIActionData as UIAction,
} from "../../components/UICards";
import { adoptionDecisionCopy } from "../adoptionDecision";

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

  it("resolved adoption states are renderable decision records, not new card types", () => {
    const card: UICard = {
      card_type: "adoption_card",
      title: "大纲产物待采纳",
      actions: [
        {
          action_id: "accept-artifact-1",
          action_type: "accept",
          label: "采纳",
          target_ref: "artifact-1",
          enabled: true,
        },
      ],
    };
    const decision: AdoptionDecisionData = {
      artifact_id: "artifact-1",
      artifact_type: "draft",
      adoption_status: "EDITED_ACCEPTED",
      payload: { title: "第一章开场修订稿" },
    };

    expect(card.card_type).toBe("adoption_card");
    expect(decision.artifact_id).toBe(card.actions![0].target_ref);
    expect(adoptionDecisionCopy(decision.adoption_status).title).toBe("已修改后采纳");
  });

  it("discarded adoption state uses author-facing copy", () => {
    expect(adoptionDecisionCopy("DISCARDED")).toEqual({
      title: "已废弃",
      description: "这条候选稿已从待处理列表移除，未写入作品事实。",
    });
  });

  it("pending adoption count should be unique by artifact id after resume", () => {
    const pendingFromTranscript = [{ artifact_id: "artifact-1" }, { artifact_id: "artifact-2" }];
    const pendingFromResume = [{ artifact_id: "artifact-1" }];
    const resolved = new Set(["artifact-2"]);

    const visiblePendingIds = [...pendingFromTranscript, ...pendingFromResume]
      .filter((artifact, index, artifacts) =>
        !resolved.has(artifact.artifact_id) &&
        artifacts.findIndex((item) => item.artifact_id === artifact.artifact_id) === index,
      )
      .map((artifact) => artifact.artifact_id);

    expect(visiblePendingIds).toEqual(["artifact-1"]);
  });
});
