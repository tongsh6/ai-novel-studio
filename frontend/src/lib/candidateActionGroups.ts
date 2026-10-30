// B74：候选动作按对象分组 + 主次操作（UI 层纯函数，便于确定性测试）。
// 输入仍来自同一 turn_result.available_actions / adoption_state.pending，不改变契约；
// 输出只决定展示归属与顺序：每个 pending artifact 一组，卡内主操作优先，其余次之。
import { CARD } from "./copy";

export type CandidateActionLike = {
  action_id: string;
  action_type: string;
  target_ref?: string | null;
  enabled?: boolean;
  disabled_reason?: string | null;
};

export type PendingArtifactLike = {
  artifact_id: string;
  artifact_type: string;
  payload?: Record<string, unknown>;
};

export type CandidateActionGroup = {
  artifact: PendingArtifactLike;
  title: string;
  hint: string;
  actions: CandidateActionLike[];
};

const ACTION_ORDER = ["accept", "edit_then_accept", "discard"];

const ARTIFACT_LABELS: Record<string, string> = {
  prose_fragment: "原文候选",
  scene_draft: "场景原文候选",
  outline_draft: "大纲候选",
  character_seed: "角色候选",
  character_evolution_seed: "角色演化候选",
  world_setting: "世界设定候选",
  world_rule_seed: "世界规则候选",
  foreshadowing_seed: "伏笔候选",
  style_rule_seed: "风格规则候选",
  constraint_seed: "创作约束候选",
  work_skeleton_suggestion: "全书规划候选",
  foreshadowing_resolution: "伏笔回收候选",
  prose_formatting_plan: "排版候选",
};

function itemTitle(artifact: PendingArtifactLike): string | null {
  const items = artifact.payload?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const title = (items[0] as { title?: unknown })?.title;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : null;
}

export function candidateArtifactTitle(
  artifact: PendingArtifactLike,
  groupRole: "original" | "revision" | null,
): string {
  if (groupRole === "original") return CARD.tentativeArtifact.originalActionGroupTitle;
  if (groupRole === "revision") return CARD.tentativeArtifact.revisionActionGroupTitle;
  const base = ARTIFACT_LABELS[artifact.artifact_type] ?? "作品候选";
  const title = itemTitle(artifact);
  return title ? `${base}：${title}` : base;
}

export function candidateArtifactHint(groupRole: "original" | "revision" | null): string {
  return groupRole ? CARD.tentativeArtifact.actionGroupHint : "";
}

function actionRank(action: CandidateActionLike): number {
  const index = ACTION_ORDER.indexOf(action.action_type);
  return index === -1 ? ACTION_ORDER.length : index;
}

export function describeCandidateActionGroups(
  actions: CandidateActionLike[],
  pending: PendingArtifactLike[],
  groupRole: "original" | "revision" | null = null,
): { groups: CandidateActionGroup[]; ungrouped: CandidateActionLike[] } {
  const pendingById = new Map(pending.map((artifact) => [artifact.artifact_id, artifact]));
  const byArtifact = new Map<string, CandidateActionLike[]>();
  const ungrouped: CandidateActionLike[] = [];

  for (const action of actions) {
    const artifactId = typeof action.target_ref === "string" ? action.target_ref : null;
    if (!artifactId || !pendingById.has(artifactId)) {
      ungrouped.push(action);
      continue;
    }
    const bucket = byArtifact.get(artifactId) ?? [];
    bucket.push(action);
    byArtifact.set(artifactId, bucket);
  }

  const groups = pending
    .filter((artifact) => byArtifact.has(artifact.artifact_id))
    .map((artifact) => ({
      artifact,
      title: candidateArtifactTitle(artifact, groupRole),
      hint: candidateArtifactHint(groupRole),
      actions: [...(byArtifact.get(artifact.artifact_id) ?? [])].sort(
        (left, right) => actionRank(left) - actionRank(right),
      ),
    }));

  return { groups, ungrouped };
}

export type CandidateCardLike = {
  artifact_type?: string;
  title?: string;
  items?: Array<Record<string, unknown>>;
};

function cardItemIds(card: CandidateCardLike): Set<string> {
  return new Set(
    (card.items ?? [])
      .map((item) => (typeof item.item_id === "string" ? item.item_id : ""))
      .filter((id) => id !== ""),
  );
}

/** 把 ui_cards 里的 candidate_set 卡片对应回 pending artifact：类型一致 + item_id 交集。 */
export function pendingArtifactForCard(
  pending: PendingArtifactLike[],
  card: CandidateCardLike,
): PendingArtifactLike | null {
  const cardIds = cardItemIds(card);
  const sameType = pending.filter(
    (artifact) => !card.artifact_type || artifact.artifact_type === card.artifact_type,
  );
  if (cardIds.size > 0) {
    const matched = sameType.find((artifact) => {
      const ids = ((artifact.payload?.items as Array<Record<string, unknown>> | undefined) ?? [])
        .map((item) => (typeof item.item_id === "string" ? item.item_id : ""))
        .filter((id) => id !== "");
      return ids.some((id) => cardIds.has(id));
    });
    if (matched) return matched;
  }
  return sameType.length === 1 ? sameType[0] : null;
}

/** 已经被候选内容卡片承载（动作应贴在内容下方）的 artifact_id 集合。 */
export function artifactIdsRenderedInCards(
  pending: PendingArtifactLike[],
  cards: CandidateCardLike[],
): Set<string> {
  const ids = new Set<string>();
  for (const card of cards) {
    const artifact = pendingArtifactForCard(pending, card);
    if (artifact) ids.add(artifact.artifact_id);
  }
  return ids;
}
