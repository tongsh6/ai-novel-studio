// Design: docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md §16.10
import type { Channel } from "phoenix";
import { describe, expect, it, vi } from "vitest";

import type { AuthorActionResult } from "../generated/foundation/author_action_result";
import { sendAuthorAction, type AuthorActionPayload } from "./socket";

function channelReplying(response: AuthorActionResult): {
  channel: Channel;
  push: ReturnType<typeof vi.fn>;
} {
  const receiver = {
    receive(event: string, callback: (payload: unknown) => void) {
      if (event === "ok") callback(response);
      return receiver;
    },
  };
  const push = vi.fn(() => receiver);

  return { channel: { push } as unknown as Channel, push };
}

describe("sendAuthorAction", () => {
  it("resolves the generated author action result wire, including committed run facts", async () => {
    const response: AuthorActionResult = {
      received: true,
      action_status: "accepted",
      receipt_id: "receipt-1",
      run_id: "run-revision-1",
      source_turn_ref: "turn-quality-1",
      agent_run_state: {
        run_id: "run-revision-1",
        run_mode: "bounded",
        status: "completed",
        phase: "completed",
        runtime_live: false,
      },
      turn_results: [
        {
          turn_id: "turn-quality-1:agent:2",
          phase: "completed",
          status: "completed",
          assistant_message: { text: "修订稿已生成" },
        },
      ],
    };
    const { channel, push } = channelReplying(response);
    const action: AuthorActionPayload = {
      source_turn_ref: "turn-quality-1",
      action_id: "action-revise",
      action_type: "revise_from_findings",
    };

    await expect(sendAuthorAction(channel, action)).resolves.toEqual(response);
    expect(push).toHaveBeenCalledWith("author_action", { action }, 300000);
  });

  it("keeps a no-run acknowledgment compatible", async () => {
    const response: AuthorActionResult = {
      received: true,
      action_status: "accepted",
      target_artifact_ref: "artifact-original",
    };
    const { channel } = channelReplying(response);

    await expect(
      sendAuthorAction(channel, {
        source_turn_ref: "turn-quality-1",
        action_id: "action-accept",
        action_type: "accept",
      }),
    ).resolves.toEqual(response);
  });
});
