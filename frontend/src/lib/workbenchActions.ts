import type { AuthorActionPayload } from "./socket";

export interface AvailableActionLike {
  action_id: string;
  action_type: string;
  behavior_ref?: string;
  candidate_set_ref?: string;
  candidate_ref?: string;
  target_ref?: string;
  source_turn_ref?: string;
  label_key?: string;
  enabled?: boolean;
  disabled_reason?: string;
  idempotency_key?: string;
}

export interface AvailableActionTarget {
  action_type: string;
  action_id?: string;
  target_ref?: string;
}

export function findAvailableActionForTarget(
  availableActions: AvailableActionLike[],
  target: AvailableActionTarget,
): AvailableActionLike | null {
  const match = availableActions.find((action) => {
    if (action.action_type !== target.action_type) return false;
    if (target.action_id && action.action_id !== target.action_id) return false;
    if (target.target_ref && action.target_ref !== target.target_ref) return false;
    return true;
  });

  return match ?? null;
}

export function actionRequiresTargetRef(actionType: string): boolean {
  return [
    "answer_clarification",
    "cancel_pending_behavior",
    "confirm_before_execute",
    "reject_or_cancel_confirmation",
    "choose_candidate",
    "accept",
    "discard",
    "edit_then_accept",
  ].includes(actionType);
}

export function toAuthorActionPayload(
  sourceTurnRef: string,
  action: AvailableActionLike,
): AuthorActionPayload {
  if (actionRequiresTargetRef(action.action_type) && !action.target_ref) {
    throw new Error(`available_action ${action.action_id} missing target_ref`);
  }

  const payload: AuthorActionPayload = {
    source_turn_ref: action.source_turn_ref ?? sourceTurnRef,
    action_id: action.action_id,
    action_type: action.action_type,
  };

  if (action.target_ref) payload.target_ref = action.target_ref;
  if (action.behavior_ref) payload.behavior_ref = action.behavior_ref;
  if (action.candidate_set_ref) payload.candidate_set_ref = action.candidate_set_ref;
  if (action.candidate_ref) payload.candidate_ref = action.candidate_ref;
  if (action.idempotency_key) payload.idempotency_key = action.idempotency_key;

  return payload;
}
