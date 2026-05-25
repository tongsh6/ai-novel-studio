import { describe, expect, it } from "vitest";

import {
  findAvailableActionForTarget,
  toAuthorActionPayload,
} from "../workbenchActions";
import type { AvailableActionLike } from "../workbenchActions";

const actions: AvailableActionLike[] = [
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

describe("workbench action authorization", () => {
  it("finds an available action by action_id and action_type", () => {
    const target = {
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      target_ref: "bh-1",
    };

    expect(findAvailableActionForTarget(actions, target)).toEqual(actions[0]);
  });

  it("does not authorize an action that is not in available_actions", () => {
    const target = {
      action_id: "act-forged",
      action_type: "confirm_before_execute",
      target_ref: "bh-1",
    };

    expect(findAvailableActionForTarget(actions, target)).toBeNull();
  });

  it("does not authorize an action when target_ref points elsewhere", () => {
    const target = {
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      target_ref: "bh-other",
    };

    expect(findAvailableActionForTarget(actions, target)).toBeNull();
  });

  it("builds author_action payload with source turn ref", () => {
    expect(toAuthorActionPayload("turn-1", actions[0])).toEqual({
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

    const action = findAvailableActionForTarget(actions, target);

    expect(action).toEqual(actions[2]);
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
