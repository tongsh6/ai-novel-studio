// Design: docs/design/ui/42-card-system.md §3 (card component rendering)
// Prototype: novel-studio.pen → 41§3-main-workbench (ZOwOi)
import { CARD } from "../lib/copy";
import styles from "./UICards.module.css";

// Basic interface for UI cards, shared across v2 and v3 implementations
export interface UICardData {
  card_type: string;
  priority?: string;
  visibility?: string;
  title?: string;
  body?: string;
  artifact_refs?: string[];
  candidate_set_ref?: string;
  artifact_type?: string;
  items?: UICardItem[];
  tentative?: boolean;
}

interface Props {
  card: UICardData;
}

export interface UICardItem {
  item_id?: string;
  title?: unknown;
  body?: unknown;
  rationale?: unknown;
}

function displayText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function artifactDraftCopy(card: UICardData): { title: string; body: string } {
  switch (card.artifact_type) {
    case "prose_fragment":
    case "scene_draft":
      return {
        title: CARD.artifactDraft.proseTitle,
        body: CARD.artifactDraft.proseDescription,
      };
    case "outline_draft":
      return {
        title: CARD.artifactDraft.outlineTitle,
        body: CARD.artifactDraft.outlineDescription,
      };
    case "character_seed":
      return {
        title: CARD.artifactDraft.characterTitle,
        body: CARD.artifactDraft.archiveDescription,
      };
    case "character_evolution_seed":
      return {
        title: CARD.artifactDraft.characterEvolutionTitle,
        body: CARD.artifactDraft.characterEvolutionDescription,
      };
    case "world_setting":
      return {
        title: CARD.artifactDraft.worldTitle,
        body: CARD.artifactDraft.archiveDescription,
      };
    case "foreshadowing_seed":
      return {
        title: CARD.artifactDraft.foreshadowingTitle,
        body: CARD.artifactDraft.archiveDescription,
      };
    case "world_rule_seed":
    case "style_rule_seed":
      return {
        title: CARD.artifactDraft.ruleTitle,
        body: CARD.artifactDraft.archiveDescription,
      };
    case "constraint_seed":
      return {
        title: CARD.artifactDraft.constraintTitle,
        body: CARD.artifactDraft.archiveDescription,
      };
    default:
      return {
        title: CARD.artifactDraft.fallbackTitle,
        body: CARD.artifactDraft.fallbackDescription,
      };
  }
}

export function ClarificationCard({ card }: Props) {
  return (
    <div className={`${styles.card} ${styles.clarificationCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>❓</div>
        <div className={styles.title}>{card.title || CARD.clarification.title}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
    </div>
  );
}

export function ConfirmationCard({ card }: Props) {
  return (
    <div className={`${styles.card} ${styles.confirmationCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>⚠️</div>
        <div className={styles.title}>{card.title || CARD.confirmation.title}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
    </div>
  );
}

export function WarningCard({ card }: Props) {
  return (
    <div className={`${styles.card} ${styles.warningCard}`}>
      <div className={styles.header}>
        <div className={styles.warningIcon}>!</div>
        <div className={styles.title}>{card.title || "警告"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
    </div>
  );
}

// VS-00E CP2：正文质量复核摘要。复用 warning 视觉，不新增 Card taxonomy 状态机。
// finding 仅供作者审阅，不代表作品事实，不改变可采纳性。
export interface QualityFindingView {
  quality_gate: string;
  validator: string;
  severity: string;
  action: string;
  summary: string;
  evidence_spans?: { text?: string }[];
  brief_field_refs?: string[];
  can_override?: boolean;
}

export interface QualityReviewView {
  status: string;
  policy_action: string;
  review_status: string;
  findings: QualityFindingView[];
}

export function QualityReviewCard({
  review,
  selectedFindingIds = [],
  onToggleFinding,
  onToggleAllFindings,
  onRevise,
  revising = false,
}: {
  review: QualityReviewView;
  selectedFindingIds?: string[];
  onToggleFinding?: (findingId: string) => void;
  onToggleAllFindings?: () => void;
  onRevise?: () => void;
  revising?: boolean;
}) {
  if (review.review_status === "unavailable") {
    return (
      <div className={`${styles.card} ${styles.warningCard}`}>
        <div className={styles.header}>
          <div className={styles.warningIcon}>!</div>
          <div className={styles.title}>{CARD.qualityReview.unavailableTitle}</div>
        </div>
        <div className={styles.body}>{CARD.qualityReview.unavailableBody}</div>
      </div>
    );
  }

  if (!review.findings || review.findings.length === 0) {
    return null;
  }

  const allSelected = selectedFindingIds.length === review.findings.length;

  return (
    <div className={`${styles.card} ${styles.warningCard}`}>
      <div className={styles.header}>
        <div className={styles.warningIcon}>!</div>
        <div className={styles.title}>{CARD.qualityReview.title(review.findings.length)}</div>
      </div>

      <div className={styles.findingsContainer}>
        {onRevise && review.findings.length > 1 && onToggleAllFindings && (
          <div className={styles.selectAllRow}>
            <label className={styles.selectAllLabel}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAllFindings}
                disabled={revising}
              />
              <span>全选所有可改进问题</span>
            </label>
          </div>
        )}

        <div className={styles.findingsList}>
          {review.findings.map((finding, index) => {
            const evidence = displayText(finding.evidence_spans?.[0]?.text);
            const findingId = finding.validator || `${index}`;
            const isSelected = selectedFindingIds.includes(findingId);
            const gateLabel = finding.quality_gate
              ? finding.quality_gate.replace("quality_gate.", "").toUpperCase()
              : "";

            return (
              <div key={index} className={styles.findingCard}>
                <div className={styles.findingCardHeader}>
                  {onRevise && onToggleFinding ? (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={revising}
                      onChange={() => onToggleFinding(findingId)}
                      className={styles.findingCheckbox}
                    />
                  ) : null}
                  <div className={styles.findingCardMeta}>
                    {gateLabel && (
                      <span className={styles.findingCategoryBadge}>
                        {gateLabel}
                      </span>
                    )}
                    <span className={styles.findingSummary}>{finding.summary}</span>
                  </div>
                </div>

                {evidence && (
                  <blockquote className={styles.evidenceQuote}>
                    <span className={styles.evidencePrefix}>
                      {CARD.qualityReview.evidencePrefix}
                    </span>
                    {evidence}
                  </blockquote>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {onRevise && (
        <>
          <div className={styles.qualityHintText}>{CARD.qualityReview.reviseHint}</div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={onRevise}
              disabled={revising || selectedFindingIds.length === 0}
            >
              {selectedFindingIds.length === 0
                ? "请选择要重写的问题"
                : selectedFindingIds.length === review.findings.length
                ? CARD.qualityReview.reviseButton
                : `按所选 ${selectedFindingIds.length} 项问题重写`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ProgressCard({ card }: Props) {
  return (
    <div className={`${styles.card} ${styles.progressCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>⏳</div>
        <div className={styles.title}>{card.title || "系统运行中"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
    </div>
  );
}

export function CheckpointCard({ card }: Props) {
  return (
    <div className={`${styles.card} ${styles.checkpointCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>⏸️</div>
        <div className={styles.title}>{card.title || "检查点"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.artifact_refs && card.artifact_refs.length > 0 && (
        <div className={styles.artifactList}>
          {card.artifact_refs.map((ref) => (
            <span key={ref} className={styles.artifactTag}>
              {ref}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResultCard({ card }: Props) {
  return (
    <div className={`${styles.card} ${styles.resultCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>✅</div>
        <div className={styles.title}>{card.title || "执行完成"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
    </div>
  );
}

export function CandidateSetCard({ card }: Props) {
  const items = Array.isArray(card.items) ? card.items : [];
  const fallbackCopy = artifactDraftCopy(card);
  const title = card.title || fallbackCopy.title;
  const description = card.body || fallbackCopy.body;

  return (
    <div className={`${styles.card} ${styles.candidateSetCard}`}>
      <div className={styles.header}>
        <div className={styles.title}>{title}</div>
      </div>
      {description && <div className={styles.body}>{description}</div>}
      {items.length > 0 && (
        <div className={styles.candidateItems}>
          {items.map((item, index) => {
            const title = displayText(item.title) || `候选 ${index + 1}`;
            const body = displayText(item.body);
            const rationale = displayText(item.rationale);
            const key = item.item_id || `${title}-${index}`;

            return (
              <article key={key} className={styles.candidateItem}>
                <div className={styles.candidateItemTitle}>{title}</div>
                {body && <div className={styles.candidateItemBody}>{body}</div>}
                {rationale && (
                  <div className={styles.candidateItemRationale}>
                    {CARD.artifactDraft.rationalePrefix}
                    {rationale}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FailureCard({ card }: Props) {
  return (
    <div className={`${styles.card} ${styles.failureCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>❌</div>
        <div className={styles.title}>{card.title || "执行失败"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
    </div>
  );
}

export function EscalationCard({ card }: Props) {
  return (
    <div className={`${styles.card} ${styles.escalationCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>🛑</div>
        <div className={styles.title}>{card.title || "需要关注"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
    </div>
  );
}

export function DefaultCard({ card }: Props) {
  return (
    <div className={`${styles.card} ${styles.defaultCard}`}>
      {card.title && <div className={styles.title}>{card.title}</div>}
      {card.body && <div className={styles.body}>{card.body}</div>}
    </div>
  );
}
