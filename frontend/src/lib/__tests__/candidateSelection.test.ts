// Design: docs/design-v3/07-workbench-ui-contract.md §8
// Regression for: docs/design-v3/acceptance/author/AU-02-explore.md AU02-GAP-01
import { describe, expect, it } from "vitest";

import { buildCandidateContinuation, candidateSetRef } from "../candidateSelection";

describe("candidate selection continuation", () => {
  it("builds a follow-up message with candidate refs and no adoption claim", () => {
    const continuation = buildCandidateContinuation("turn-1", {
      direction_id: "dir-1",
      title: "赛博公司垄断流",
      pitch: "底层散修对抗大厂灵气垄断。",
    });

    expect(continuation.text).toContain("继续聊");
    expect(continuation.text).toContain("赛博公司垄断流");
    expect(continuation.text).not.toContain("采纳");
    expect(continuation.selection).toEqual({
      source_turn_ref: "turn-1",
      candidate_set_ref: "candidate_set:turn-1",
      candidate_ref: "dir-1",
    });
  });

  it("derives a stable candidate_set_ref from the source turn", () => {
    expect(candidateSetRef("turn-abc")).toBe("candidate_set:turn-abc");
  });
});
