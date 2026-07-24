import type { ReviewFinding } from "./socket";
import { STRUCTURE_PANEL } from "./copy";

const PROTAGONIST_UNDERMATERIALIZED_RULE = "protagonist_undermaterialized";

export function isFindingFactInventoryAction(finding: ReviewFinding, disposition: string): boolean {
  return (
    finding.rule === PROTAGONIST_UNDERMATERIALIZED_RULE &&
    finding.proposed_disposition === "revise_design" &&
    disposition === "revise_design"
  );
}

export function reviewFindingDispositionLabel(finding: ReviewFinding, disposition: string): string {
  if (isFindingFactInventoryAction(finding, disposition)) {
    return STRUCTURE_PANEL.ledger.protagonistInventoryLabel;
  }

  return (
    (STRUCTURE_PANEL.ledger.dispositions as Record<string, string>)[disposition] ?? disposition
  );
}
