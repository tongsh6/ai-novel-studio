// Design: docs/design/07-workbench-ui-contract.md §8
// Regression for: docs/design/acceptance/author/AU-02-explore.md AU02-GAP-01
import { describe, expect, it } from "vitest";

import { findCandidateAvailableAction } from "../candidateSelection";
import type { AvailableActionLike } from "../workbenchActions";

describe("candidate selection continuation", () => {
  it("finds the server-provided choose_candidate action by candidate ref", () => {
    const action: AvailableActionLike = {
      action_id: "server-action-1",
      action_type: "choose_candidate",
      source_turn_ref: "turn-1",
      target_ref: "server-target-1",
      candidate_set_ref: "server-candidate-set-1",
      candidate_ref: "dir-1",
      enabled: true,
      idempotency_key: "server-idem-1",
    };

    const match = findCandidateAvailableAction({
      availableActions: [action],
      sourceTurnRef: "turn-1",
      candidateIndex: 0,
      candidateCount: 1,
      candidate: {
        direction_id: "dir-1",
        title: "赛博公司垄断流",
        pitch: "底层散修对抗大厂灵气垄断。",
      },
    });

    expect(match).toBe(action);
  });

  it("does not invent a candidate action when available_actions has no match", () => {
    const match = findCandidateAvailableAction({
      availableActions: [],
      candidate: {
        direction_id: "dir-1",
        title: "赛博公司垄断流",
        pitch: "底层散修对抗大厂灵气垄断。",
      },
    });

    expect(match).toBeNull();
  });

  it("can pair a singleton candidate with an opaque server-provided action", () => {
    const action: AvailableActionLike = {
      action_id: "server-action-opaque",
      action_type: "choose_candidate",
      source_turn_ref: "turn-1",
      target_ref: "server-target-y",
      candidate_set_ref: "server-candidate-set-y",
      candidate_ref: "server-candidate-y",
      enabled: true,
      idempotency_key: "server-idem-y",
    };

    const match = findCandidateAvailableAction({
      availableActions: [action],
      sourceTurnRef: "turn-1",
      candidateIndex: 0,
      candidateCount: 1,
      candidate: {
        direction_id: "local_candidate_x",
        title: "赛博公司垄断流",
        pitch: "底层散修对抗大厂灵气垄断。",
      },
    });

    expect(match).toBe(action);
  });
});
