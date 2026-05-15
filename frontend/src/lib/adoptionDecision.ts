// Design: docs/design-v2/ui-design/42-card-system.md §3 (adoption_card state projection)
// Prototype: novel-studio-v2.pen → 42§4-adoption-card-states (PZAVY)
import { CARD } from "./copy";

export function adoptionDecisionCopy(adoptionStatus: string) {
  const normalized = adoptionStatus.toUpperCase();

  if (normalized === "ACCEPTED") {
    return {
      title: CARD.adoptionDecision.acceptedTitle,
      description: CARD.adoptionDecision.acceptedDescription,
    };
  }

  if (normalized === "DISCARDED") {
    return {
      title: CARD.adoptionDecision.discardedTitle,
      description: CARD.adoptionDecision.discardedDescription,
    };
  }

  if (normalized === "EDITED_ACCEPTED") {
    return {
      title: CARD.adoptionDecision.editedAcceptedTitle,
      description: CARD.adoptionDecision.editedAcceptedDescription,
    };
  }

  return {
    title: CARD.adoptionDecision.unknownTitle,
    description: CARD.adoptionDecision.unknownDescription,
  };
}
