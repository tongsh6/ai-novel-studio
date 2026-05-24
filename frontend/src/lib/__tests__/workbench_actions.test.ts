import { describe, expect, it } from "vitest";

import {
  findAuthorizedAction,
  toAuthorActionPayload,
} from "../workbenchActions";
import type { AvailableActionLike, UICardActionLike } from "../workbenchActions";

const actions: AvailableActionLike[] = [
  {
    action_id: "act-confirm",
    action_type: "confirm_before_execute",
    behavior_ref: "bh-1",
    enabled: true,
    idempotency_key: "ik-confirm",
  },
  {
    action_id: "act-cancel",
    action_type: "cancel_pending_behavior",
    behavior_ref: "bh-1",
    enabled: false,
    disabled_reason: "already resolved",
  },
  {
    action_id: "choose_candidate:dir-1",
    action_type: "choose_candidate",
    candidate_set_ref: "candidate_set:turn-1",
    candidate_ref: "dir-1",
    enabled: true,
    idempotency_key: "ik-candidate",
  },
];

describe("workbench action authorization", () => {
  it("finds an available action by action_id and action_type", () => {
    const cardAction: UICardActionLike = {
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      target_ref: "bh-1",
    };

    expect(findAuthorizedAction(actions, cardAction)).toEqual(actions[0]);
  });

  it("does not authorize a card action that is not in available_actions", () => {
    const cardAction: UICardActionLike = {
      action_id: "act-forged",
      action_type: "confirm_before_execute",
      target_ref: "bh-1",
    };

    expect(findAuthorizedAction(actions, cardAction)).toBeNull();
  });

  it("does not authorize an action when target_ref points elsewhere", () => {
    const cardAction: UICardActionLike = {
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      target_ref: "bh-other",
    };

    expect(findAuthorizedAction(actions, cardAction)).toBeNull();
  });

  it("builds author_action payload with source turn ref", () => {
    expect(toAuthorActionPayload("turn-1", actions[0])).toEqual({
      source_turn_ref: "turn-1",
      action_id: "act-confirm",
      action_type: "confirm_before_execute",
      behavior_ref: "bh-1",
      idempotency_key: "ik-confirm",
    });
  });

  it("builds candidate adoption payload only from a matching available action", () => {
    const cardAction: UICardActionLike = {
      action_id: "choose_candidate:dir-1",
      action_type: "choose_candidate",
      target_ref: "dir-1",
    };

    const action = findAuthorizedAction(actions, cardAction);

    expect(action).toEqual(actions[2]);
    expect(toAuthorActionPayload("turn-1", action!)).toEqual({
      source_turn_ref: "turn-1",
      action_id: "choose_candidate:dir-1",
      action_type: "choose_candidate",
      candidate_set_ref: "candidate_set:turn-1",
      candidate_ref: "dir-1",
      idempotency_key: "ik-candidate",
    });
  });
});
