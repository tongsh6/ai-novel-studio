import type { AuthorActionPayload } from "./socket";

export interface AvailableActionLike {
  action_id: string;
  action_type: string;
  behavior_ref?: string;
  candidate_set_ref?: string;
  candidate_ref?: string;
  enabled?: boolean;
  disabled_reason?: string;
  idempotency_key?: string;
}

export interface UICardActionLike {
  action_id: string;
  action_type?: string;
  target_ref?: string;
}

export function findAuthorizedAction(
  availableActions: AvailableActionLike[],
  cardAction: UICardActionLike,
): AvailableActionLike | null {
  const match = availableActions.find((action) => {
    if (action.action_id !== cardAction.action_id) return false;
    if (cardAction.action_type && action.action_type !== cardAction.action_type) {
      return false;
    }
    if (cardAction.target_ref) {
      return [
        action.behavior_ref,
        action.candidate_ref,
        action.candidate_set_ref,
      ].includes(cardAction.target_ref);
    }
    return true;
  });

  return match ?? null;
}

export function toAuthorActionPayload(
  sourceTurnRef: string,
  action: AvailableActionLike,
): AuthorActionPayload {
  const payload: AuthorActionPayload = {
    source_turn_ref: sourceTurnRef,
    action_id: action.action_id,
    action_type: action.action_type,
  };

  if (action.behavior_ref) payload.behavior_ref = action.behavior_ref;
  if (action.candidate_set_ref) payload.candidate_set_ref = action.candidate_set_ref;
  if (action.candidate_ref) payload.candidate_ref = action.candidate_ref;
  if (action.idempotency_key) payload.idempotency_key = action.idempotency_key;

  return payload;
}
