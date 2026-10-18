import type { AvailableActionLike } from "./workbenchActions";
import type { CandidateDirection } from "./schemas";

export type CandidateDirectionLike = Pick<
  CandidateDirection,
  "kind" | "direction_id" | "title" | "pitch"
>;

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
  // 历史候选混有流程建议；缺少用途证据时不得把旧动作恢复成创作方向采用。
  if (candidate.kind !== "creative_direction") return null;

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
