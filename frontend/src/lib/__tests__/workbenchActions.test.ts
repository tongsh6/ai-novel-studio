import { describe, expect, it } from "vitest";

import {
  filterVisibleAvailableActions,
  findAvailableActionForTarget,
  toAuthorActionPayload,
  type AvailableActionLike,
} from "../workbenchActions";

const accept = (id: string, target: string): AvailableActionLike => ({
  action_id: id,
  action_type: "accept",
  target_ref: target,
});

const authorizationActions: AvailableActionLike[] = [
  {
    action_id: "act-confirm",
    action_type: "confirm_before_execute",
    target_ref: "bh-1",
    behavior_ref: "bh-1",
    enabled: true,
    idempotency_key: "ik-confirm",
  },
  {
    action_id: "act-cancel",
    action_type: "cancel_pending_behavior",
    target_ref: "bh-1",
    behavior_ref: "bh-1",
    enabled: false,
    disabled_reason: "already resolved",
  },
  {
    action_id: "choose_candidate:dir-1",
    action_type: "choose_candidate",
    target_ref: "dir-1",
    candidate_set_ref: "candidate_set:turn-1",
    candidate_ref: "dir-1",
    enabled: true,
    idempotency_key: "ik-candidate",
  },
];

describe("filterVisibleAvailableActions", () => {
  it("hides accept/discard for an artifact that is no longer pending (already adopted)", () => {
    const actions: AvailableActionLike[] = [
      accept("a1", "as-1"),
      { action_id: "d1", action_type: "discard", target_ref: "as-1" },
    ];

    // as-1 已被采纳 → 不在 pending 集合 → 采纳类动作隐藏，防止重复提交
    expect(filterVisibleAvailableActions(actions, [])).toEqual([]);
  });

  it("keeps accept while the artifact is still pending", () => {
    const actions = [accept("a1", "as-1")];
    expect(filterVisibleAvailableActions(actions, ["as-1"]).map((a) => a.action_id)).toEqual([
      "a1",
    ]);
  });

  it("drops choose_candidate (rendered by the candidate panel instead)", () => {
    const actions: AvailableActionLike[] = [
      { action_id: "c1", action_type: "choose_candidate", candidate_ref: "dir-1" },
    ];
    expect(filterVisibleAvailableActions(actions, ["as-1"])).toEqual([]);
  });

  it("keeps non-confirmation actions regardless of pending set", () => {
    const actions: AvailableActionLike[] = [
      { action_id: "an1", action_type: "answer_clarification", behavior_ref: "bh-2" },
    ];
    expect(filterVisibleAvailableActions(actions, []).map((a) => a.action_id)).toEqual(["an1"]);
  });

  it("shows confirm/reject only while their behavior is active", () => {
    const actions: AvailableActionLike[] = [
      {
        action_id: "cf1",
        action_type: "confirm_before_execute",
        target_ref: "as-1",
        behavior_ref: "bh-1",
      },
      {
        action_id: "rj1",
        action_type: "reject_or_cancel_confirmation",
        target_ref: "as-1",
        behavior_ref: "bh-1",
      },
    ];
    // 行为活跃 → 显示
    expect(
      filterVisibleAvailableActions(actions, ["as-1"], "bh-1").map((a) => a.action_id),
    ).toEqual(["cf1", "rj1"]);
    // 行为已关闭（active=null）→ 隐藏，防止重复确认
    expect(filterVisibleAvailableActions(actions, ["as-1"], null)).toEqual([]);
    // 活跃的是别的行为 → 隐藏
    expect(filterVisibleAvailableActions(actions, ["as-1"], "bh-other")).toEqual([]);
  });

  it("only the still-pending artifact's accept survives a mixed batch", () => {
    const actions = [accept("a1", "as-1"), accept("a2", "as-2")];
    expect(filterVisibleAvailableActions(actions, ["as-2"]).map((a) => a.action_id)).toEqual([
      "a2",
    ]);
  });
});

describe("workbench action authorization", () => {
  it("finds an available action by action_id and action_type", () => {
    const target = {
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      target_ref: "bh-1",
    };

    expect(findAvailableActionForTarget(authorizationActions, target)).toEqual(
      authorizationActions[0],
    );
  });

  it("does not authorize an action that is not in available_actions", () => {
    const target = {
      action_id: "act-forged",
      action_type: "confirm_before_execute",
      target_ref: "bh-1",
    };

    expect(findAvailableActionForTarget(authorizationActions, target)).toBeNull();
  });

  it("does not authorize an action when target_ref points elsewhere", () => {
    const target = {
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      target_ref: "bh-other",
    };

    expect(findAvailableActionForTarget(authorizationActions, target)).toBeNull();
  });

  it("builds author_action payload with source turn ref", () => {
    expect(toAuthorActionPayload("turn-1", authorizationActions[0])).toEqual({
      source_turn_ref: "turn-1",
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      target_ref: "bh-1",
      behavior_ref: "bh-1",
      idempotency_key: "ik-confirm",
    });
  });

  it("builds candidate selection payload only from a matching available action", () => {
    const target = {
      action_id: "choose_candidate:dir-1",
      action_type: "choose_candidate",
      target_ref: "dir-1",
    };

    const action = findAvailableActionForTarget(authorizationActions, target);

    expect(action).toEqual(authorizationActions[2]);
    expect(toAuthorActionPayload("turn-1", action!)).toEqual({
      source_turn_ref: "turn-1",
      action_id: "choose_candidate:dir-1",
      action_type: "choose_candidate",
      target_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-1",
      candidate_ref: "dir-1",
      idempotency_key: "ik-candidate",
    });
  });

  it("rejects target-scoped action payloads when available_action lacks target_ref", () => {
    expect(() =>
      toAuthorActionPayload("turn-1", {
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        candidate_set_ref: "candidate_set:turn-1",
        candidate_ref: "dir-1",
        enabled: true,
      }),
    ).toThrow(/missing target_ref/);
  });

  it("does not authorize an absent action when no available action matches", () => {
    const action = findAvailableActionForTarget([], {
      action_type: "choose_candidate",
      target_ref: "dir-1",
    });

    expect(action).toBeNull();
  });
});

describe("toAuthorActionPayload author payload (edit_then_accept)", () => {
  it("carries edited_content payload for edit_then_accept", () => {
    const action: AvailableActionLike = {
      action_id: "edit-1",
      action_type: "edit_then_accept",
      target_ref: "as-1",
    };
    const payload = toAuthorActionPayload("turn-1", action, { edited_content: "改写后的正文" });
    expect(payload.target_ref).toBe("as-1");
    expect(payload.payload).toEqual({ edited_content: "改写后的正文" });
  });

  it("omits payload when none provided", () => {
    const action: AvailableActionLike = {
      action_id: "ac-1",
      action_type: "accept",
      target_ref: "as-1",
    };
    expect(toAuthorActionPayload("turn-1", action).payload).toBeUndefined();
  });
});
