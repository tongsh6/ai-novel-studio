import type { AvailableActionLike } from "./workbenchActions";

export interface CandidateDirectionLike {
  direction_id: string;
  title: string;
  pitch: string;
}

interface FindCandidateAvailableActionOptions {
  availableActions: AvailableActionLike[];
  candidate: CandidateDirectionLike;
  candidateIndex?: number;
  candidateCount?: number;
  sourceTurnRef?: string;
}

export function findCandidateAvailableAction({
  availableActions,
  candidate,
  candidateIndex,
  candidateCount,
  sourceTurnRef,
}: FindCandidateAvailableActionOptions): AvailableActionLike | null {
  const candidateActions = availableActions.filter((action) => {
    if (action.action_type !== "choose_candidate") return false;
    if (sourceTurnRef && action.source_turn_ref && action.source_turn_ref !== sourceTurnRef)
      return false;
    return true;
  });

  const exactRefMatch = candidateActions.find(
    (action) =>
      action.candidate_ref === candidate.direction_id ||
      action.target_ref === candidate.direction_id,
  );

  if (exactRefMatch) return exactRefMatch;

  if (candidateActions.length === 1 && candidateCount === 1 && candidateIndex === 0) {
    return candidateActions[0];
  }

  return null;
}
