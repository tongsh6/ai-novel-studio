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

const ARTIFACT_ADOPTION_ACTION_TYPES = ["accept", "discard", "edit_then_accept"];
const CONFIRMATION_BEHAVIOR_ACTION_TYPES = [
  "confirm_before_execute",
  "reject_or_cancel_confirmation",
];

/**
 * 过滤一个 turn_result 的 available_actions，得到当前仍可在该消息卡上提交的动作：
 * - choose_candidate 由候选面板单独渲染，不出现在通用动作区；
 * - 采纳类动作（accept/discard/edit_then_accept）一旦目标 artifact 已被采纳/放弃
 *   （不在 pendingArtifactIds 中），就不再显示，避免旧草稿卡按钮被重复点击重复提交；
 * - 确认类动作（confirm/reject）只在其 behavior 仍是当前活跃行为时显示，确认或取消后
 *   行为关闭（active=null），按钮即隐藏，避免重复确认（ADR-0008 单一活跃行为）。
 */
export function filterVisibleAvailableActions<T extends AvailableActionLike>(
  availableActions: T[],
  pendingArtifactIds: Iterable<string>,
  activeBehaviorId?: string | null,
): T[] {
  const pending = new Set(pendingArtifactIds);
  return availableActions.filter((action) => {
    if (action.action_type === "choose_candidate") return false;
    if (action.action_type === "revise_from_findings") return false;
    if (ARTIFACT_ADOPTION_ACTION_TYPES.includes(action.action_type) && action.target_ref) {
      return pending.has(action.target_ref);
    }
    if (CONFIRMATION_BEHAVIOR_ACTION_TYPES.includes(action.action_type) && action.behavior_ref) {
      return activeBehaviorId != null && action.behavior_ref === activeBehaviorId;
    }
    return true;
  });
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
  authorPayload?: Record<string, unknown>,
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
  if (authorPayload && Object.keys(authorPayload).length > 0) payload.payload = authorPayload;

  return payload;
}
