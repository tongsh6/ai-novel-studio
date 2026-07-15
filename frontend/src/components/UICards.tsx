// Design: docs/design/ui/42-card-system.md §3 (card component rendering)
// Prototype: novel-studio.pen → 41§3-main-workbench (ZOwOi)
import { CARD } from "../lib/copy";
import type { UiCard } from "../lib/schemas";
import styles from "./UICards.module.css";
import { AlertTriangle, Loader2 } from "lucide-react";

// 卡片形状来自 codegen（docs/design/schemas/foundation/ui_card.json，ADR-0024 决策 2/3）。
// 未知 card_type 的漂移告警在校验层（lib/turnResultWire.ts）完成，这里只负责容错渲染。
export type UICardData = UiCard;

interface Props {
  card: UICardData;
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

// ADR-0024 决策 3：clarification_prompt / warning / progress / checkpoint /
// failure / escalation 卡片分支为契约外死代码，已随 DS01 CP1 删除；
// 现行卡片集合仅 candidate_set / confirmation_card / result_card + DefaultCard 兜底。

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
          <AlertTriangle className={styles.warningIconLucide} size={16} />
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
        <AlertTriangle className={styles.warningIconLucide} size={16} />
        <div className={styles.title}>{CARD.qualityReview.title(review.findings.length)}</div>
      </div>

      <div className={`${styles.findingsContainer} ${revising ? styles.revisingContainer : ""}`}>
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
              ? CARD.qualityReview.gateLabels[finding.quality_gate] ||
                finding.quality_gate.replace("quality_gate.", "").toUpperCase()
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
                  <div className={styles.findingCardContent}>
                    <div className={styles.findingSummaryContainer}>
                      {gateLabel && (
                        <span className={styles.findingCategoryBadge}>
                          {gateLabel}
                        </span>
                      )}
                      <span className={styles.findingSummary}>{finding.summary}</span>
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
                </div>
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
              {revising ? (
                <span className={styles.buttonIconText}>
                  <Loader2 className={styles.spinner} size={14} />
                  <span>
                    {selectedFindingIds.length === review.findings.length
                      ? CARD.qualityReview.revisingButton
                      : CARD.qualityReview.revisingButtonPartial(selectedFindingIds.length)}
                  </span>
                </span>
              ) : selectedFindingIds.length === 0 ? (
                "请选择要重写的问题"
              ) : selectedFindingIds.length === review.findings.length ? (
                CARD.qualityReview.reviseButton
              ) : (
                `按所选 ${selectedFindingIds.length} 项问题重写`
              )}
            </button>
          </div>
        </>
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
          {items.map((item: Record<string, unknown>, index) => {
            const title = displayText(item.title) || `候选 ${index + 1}`;
            const body = displayText(item.body);
            const rationale = displayText(item.rationale);
            const key = typeof item.item_id === "string" ? item.item_id : `${title}-${index}`;

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

// 未知 card_type 的容错兜底：只渲染 title/body，不做任何决策语义。
// props 放宽为展示字段子集，使校验失败（漂移）的卡片也能安全渲染。
export function DefaultCard({ card }: { card: { title?: string; body?: string } }) {
  return (
    <div className={`${styles.card} ${styles.defaultCard}`}>
      {card.title && <div className={styles.title}>{card.title}</div>}
      {card.body && <div className={styles.body}>{card.body}</div>}
    </div>
  );
}
