import type { CandidateSelectionPayload } from "./socket";
import { candidateContinuationText } from "./copy";

export interface CandidateDirectionLike {
  direction_id: string;
  title: string;
  pitch: string;
}

export interface CandidateContinuation {
  text: string;
  selection: CandidateSelectionPayload;
}

export function candidateSetRef(turnId: string): string {
  return `candidate_set:${turnId}`;
}

export function buildCandidateContinuation(
  turnId: string,
  candidate: CandidateDirectionLike,
): CandidateContinuation {
  return {
    text: candidateContinuationText(candidate.title, candidate.pitch),
    selection: {
      source_turn_ref: turnId,
      candidate_set_ref: candidateSetRef(turnId),
      candidate_ref: candidate.direction_id,
    },
  };
}
