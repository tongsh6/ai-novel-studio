import { describe, expect, it } from "vitest";

import {
  factInventoryAuthorPayload,
  isFactInventoryProposalAction,
  removeFactInventoryProposalActions,
} from "./factInventoryProposal";
import { toAuthorActionPayload, type AvailableActionLike } from "./workbenchActions";

const start: AvailableActionLike = {
  action_id: "inventory-start",
  action_type: "start_fact_inventory",
  target_ref: "finding:report-r5:0",
  source_turn_ref: "turn-review",
  label_key: "fact_inventory.start",
  idempotency_key: "idem-start",
};

const dismiss: AvailableActionLike = {
  action_id: "inventory-dismiss",
  action_type: "adjudicate_finding",
  target_ref: "finding:report-r5:0",
  source_turn_ref: "turn-review",
  label_key: "fact_inventory.dismiss",
  idempotency_key: "idem-dismiss",
};

describe("fact inventory proposal actions", () => {
  it("derives the existing finding action payloads from the server-issued target ref", () => {
    expect(factInventoryAuthorPayload(start)).toEqual({
      trigger_type: "finding",
      report_id: "report-r5",
      finding_index: 0,
      finding_rule: "protagonist_undermaterialized",
      proposal_ref: "finding:report-r5:0",
    });
    expect(toAuthorActionPayload("turn-fallback", start)).toEqual({
      source_turn_ref: "turn-review",
      action_id: "inventory-start",
      action_type: "start_fact_inventory",
      target_ref: "finding:report-r5:0",
      idempotency_key: "idem-start",
      payload: {
        trigger_type: "finding",
        report_id: "report-r5",
        finding_index: 0,
        finding_rule: "protagonist_undermaterialized",
        proposal_ref: "finding:report-r5:0",
      },
    });
    expect(toAuthorActionPayload("turn-fallback", dismiss).payload).toEqual({
      report_id: "report-r5",
      finding_index: 0,
      disposition: "dismiss",
      proposal_ref: "finding:report-r5:0",
    });
  });

  it("closes only the resolved proposal pair and preserves unrelated actions", () => {
    const result = {
      turn_id: "turn-review",
      available_actions: [start, dismiss, { action_id: "other", action_type: "accept" }],
    };

    expect(isFactInventoryProposalAction(start)).toBe(true);
    expect(removeFactInventoryProposalActions(result, "finding:report-r5:0").available_actions)
      .toEqual([{ action_id: "other", action_type: "accept" }]);
    expect(result.available_actions).toHaveLength(3);
  });

  it("does not synthesize an action from malformed refs or arbitrary dismiss actions", () => {
    expect(factInventoryAuthorPayload({ ...start, target_ref: "artifact:1" })).toBeUndefined();
    expect(factInventoryAuthorPayload({ ...dismiss, label_key: undefined })).toBeUndefined();
  });
});
