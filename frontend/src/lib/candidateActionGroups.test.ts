import { describe, expect, it } from "vitest";
import { candidateArtifactTitle, describeCandidateActionGroups } from "./candidateActionGroups";

const pending = [
  {
    artifact_id: "prose-1",
    artifact_type: "prose_fragment",
    payload: { items: [{ title: "灯楼夜戏：归人与立约" }] },
  },
  { artifact_id: "char-1", artifact_type: "character_seed", payload: { items: [{ title: "顾青" }] } },
  { artifact_id: "set-1", artifact_type: "world_rule_seed", payload: { items: [{ title: "灯楼约定" }] } },
];

function actionsFor(artifactId: string) {
  return [
    { action_id: `${artifactId}-discard`, action_type: "discard", target_ref: artifactId },
    { action_id: `${artifactId}-accept`, action_type: "accept", target_ref: artifactId },
    { action_id: `${artifactId}-edit`, action_type: "edit_then_accept", target_ref: artifactId },
  ];
}

describe("候选动作按对象分组", () => {
  it("每个 pending artifact 一组，卡内按 保存→编辑→放弃 排序", () => {
    const result = describeCandidateActionGroups(
      [...actionsFor("prose-1"), ...actionsFor("char-1"), ...actionsFor("set-1")],
      pending,
    );
    expect(result.groups.map((group) => group.artifact.artifact_id)).toEqual([
      "prose-1",
      "char-1",
      "set-1",
    ]);
    expect(result.groups[0].actions.map((action) => action.action_type)).toEqual([
      "accept",
      "edit_then_accept",
      "discard",
    ]);
    expect(result.groups[0].title).toBe("原文候选：灯楼夜戏：归人与立约");
    expect(result.groups[1].title).toBe("角色候选：顾青");
    expect(result.groups[2].title).toBe("世界规则候选：灯楼约定");
  });

  it("没有 pending 归属的 action 不塞进候选卡（预算/确认等保持独立）", () => {
    const result = describeCandidateActionGroups(
      [{ action_id: "budget", action_type: "agent_run_budget_next_step" }],
      pending,
    );
    expect(result.groups).toEqual([]);
    expect(result.ungrouped.map((action) => action.action_id)).toEqual(["budget"]);
  });

  it("原稿/修订稿质量候选使用分组标题，并保留各自 hint", () => {
    expect(candidateArtifactTitle({ artifact_id: "p", artifact_type: "prose_fragment" }, "original")).toBe(
      "原稿候选",
    );
    expect(candidateArtifactTitle({ artifact_id: "p", artifact_type: "prose_fragment" }, "revision")).toBe(
      "修订稿候选",
    );
    const result = describeCandidateActionGroups(actionsFor("prose-1"), pending, "original");
    expect(result.groups[0].hint).not.toBe("");
  });
});

describe("候选内容卡片与 pending artifact 对应", () => {
  const cards = [
    { artifact_type: "prose_fragment", items: [{ item_id: "prose-1" }] },
    { artifact_type: "character_seed", items: [{ item_id: "char-1" }] },
  ];

  it("按类型+item_id 对应到具体候选（含同类型多候选）", async () => {
    const { pendingArtifactForCard } = await import("./candidateActionGroups");
    expect(pendingArtifactForCard(pending, cards[0])?.artifact_id).toBe("prose-1");
    expect(pendingArtifactForCard(pending, cards[1])?.artifact_id).toBe("char-1");
    const twoCharacters = [
      { artifact_id: "char-a", artifact_type: "character_seed", payload: { items: [{ item_id: "a" }] } },
      { artifact_id: "char-b", artifact_type: "character_seed", payload: { items: [{ item_id: "b" }] } },
    ];
    expect(
      pendingArtifactForCard(twoCharacters, { artifact_type: "character_seed", items: [{ item_id: "b" }] })
        ?.artifact_id,
    ).toBe("char-b");
  });

  it("已由内容卡片承载的 artifact 动作不再进底栏；未匹配的保持底栏", async () => {
    const { artifactIdsRenderedInCards } = await import("./candidateActionGroups");
    const ids = artifactIdsRenderedInCards(pending, [...cards]);
    expect(ids.has("prose-1")).toBe(true);
    expect(ids.has("char-1")).toBe(true);
    expect(ids.has("set-1")).toBe(false);
  });
});
