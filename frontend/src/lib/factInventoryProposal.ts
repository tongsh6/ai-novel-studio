import type { AvailableActionLike } from "./workbenchActions";

const RULE = "protagonist_undermaterialized";
const START_LABEL = "fact_inventory.start";
const DISMISS_LABEL = "fact_inventory.dismiss";

type ProposalAction = Pick<AvailableActionLike, "action_type" | "target_ref" | "label_key">;

export function isFactInventoryProposalAction(action: ProposalAction): boolean {
  return action.label_key === START_LABEL || action.label_key === DISMISS_LABEL;
}

function findingBinding(targetRef: string | undefined): { reportId: string; index: number } | null {
  const match = /^finding:([^:]+):(\d+)$/.exec(targetRef ?? "");
  if (!match) return null;
  return { reportId: match[1], index: Number(match[2]) };
}

export function factInventoryAuthorPayload(
  action: ProposalAction,
): Record<string, unknown> | undefined {
  if (!isFactInventoryProposalAction(action)) return undefined;
  const binding = findingBinding(action.target_ref);
  if (!binding) return undefined;

  if (action.action_type === "start_fact_inventory" && action.label_key === START_LABEL) {
    return {
      trigger_type: "finding",
      report_id: binding.reportId,
      finding_index: binding.index,
      finding_rule: RULE,
      proposal_ref: action.target_ref,
    };
  }

  if (action.action_type === "adjudicate_finding" && action.label_key === DISMISS_LABEL) {
    return {
      report_id: binding.reportId,
      finding_index: binding.index,
      disposition: "dismiss",
      proposal_ref: action.target_ref,
    };
  }

  return undefined;
}

export function removeFactInventoryProposalActions<
  T extends { available_actions?: AvailableActionLike[] },
>(turnResult: T, targetRef: string): T {
  return {
    ...turnResult,
    available_actions: (turnResult.available_actions ?? []).filter(
      (action) => !(isFactInventoryProposalAction(action) && action.target_ref === targetRef),
    ),
  };
}
