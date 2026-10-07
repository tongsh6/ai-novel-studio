// Design: docs/design/ui/42-card-system.md §3 (adoption decision projection)
// Prototype: novel-studio.pen → 42§4-adoption-card-states (PZAVY)
import { CARD } from "./copy";

export const OPEN_READING_MODE_ACTION_ID = "open-reading-mode";

export function adoptionDecisionCopy(adoptionStatus: string) {
  if (adoptionStatus === "ACCEPTED") {
    return {
      title: CARD.adoptionDecision.acceptedTitle,
      description: CARD.adoptionDecision.acceptedDescription,
    };
  }

  if (adoptionStatus === "DISCARDED") {
    return {
      title: CARD.adoptionDecision.discardedTitle,
      description: CARD.adoptionDecision.discardedDescription,
    };
  }

  if (adoptionStatus === "EDITED_ACCEPTED") {
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

export function adoptionDecisionHasReadingProjection(adoptionStatus: string): boolean {
  return adoptionStatus === "ACCEPTED" || adoptionStatus === "EDITED_ACCEPTED";
}

export function adoptionDecisionFollowUpAction(adoptionStatus: string, artifactType?: string) {
  if (!adoptionDecisionHasReadingProjection(adoptionStatus)) return null;
  if (!isReadingProjectionArtifact(artifactType)) return null;

  return {
    action_id: OPEN_READING_MODE_ACTION_ID,
    label: CARD.adoptionDecision.openReadingModeLabel,
  };
}

function isReadingProjectionArtifact(artifactType?: string): boolean {
  return artifactType === "scene_draft" || artifactType === "prose_fragment";
}
