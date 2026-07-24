// Design: docs/design/ui/42-card-system.md §3
// Design: docs/design/ui/46-state-and-feedback.md §9.8
// Prototype: novel-studio.pen → 42§4-adoption-card-exclusive-choice (IIPsi), 46§9.8-quality-revision-ready (AH4WW)
import type { ReactNode } from "react";

import { CARD } from "../lib/copy";
import type { UiCard } from "../lib/schemas";
import styles from "./UICards.module.css";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

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
  revisionStarted = false,
}: {
  review: QualityReviewView;
  selectedFindingIds?: string[];
  onToggleFinding?: (findingId: string) => void;
  onToggleAllFindings?: () => void;
  onRevise?: () => void;
  revising?: boolean;
  revisionStarted?: boolean;
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
  const revisionDecisionLocked = revising || revisionStarted;

  if (revisionStarted) {
    return (
      <details className={styles.qualityReviewSubmitted}>
        <summary className={styles.qualityReviewSubmittedSummary}>
          <span className={styles.buttonIconText}>
            <Check size={14} aria-hidden="true" />
            <span>{CARD.qualityReview.revisionSubmittedSummary(review.findings.length)}</span>
          </span>
          <span className={styles.qualityReviewSubmittedExpand}>
            {CARD.qualityReview.revisionSubmittedExpand}
          </span>
          <span className={styles.qualityReviewSubmittedCollapse}>
            {CARD.qualityReview.revisionSubmittedCollapse}
          </span>
        </summary>
        <div className={styles.qualityReviewSubmittedBody}>
          <div className={styles.findingsList}>
            {review.findings.map((finding, index) => {
              const evidence = displayText(finding.evidence_spans?.[0]?.text);
              const gateLabel = finding.quality_gate
                ? CARD.qualityReview.gateLabels[finding.quality_gate] ||
                  finding.quality_gate.replace("quality_gate.", "").toUpperCase()
                : "";

              return (
                <div key={index} className={styles.findingCard}>
                  <div className={styles.findingCardHeader}>
                    <div className={styles.findingCardContent}>
                      <div className={styles.findingSummaryContainer}>
                        {gateLabel && (
                          <span className={styles.findingCategoryBadge}>{gateLabel}</span>
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
      </details>
    );
  }

  return (
    <div className={`${styles.card} ${styles.warningCard} ${styles.qualityReviewCard}`}>
      <div className={styles.header}>
        <AlertTriangle className={styles.warningIconLucide} size={16} />
        <div className={styles.title}>{CARD.qualityReview.title(review.findings.length)}</div>
      </div>

      <div
        className={`${styles.findingsContainer} ${
          revisionDecisionLocked ? styles.revisingContainer : ""
        }`}
      >
        {onRevise && review.findings.length > 1 && onToggleAllFindings && (
          <div className={styles.selectAllRow}>
            <label className={styles.selectAllLabel}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAllFindings}
                disabled={revisionDecisionLocked}
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
                      disabled={revisionDecisionLocked}
                      onChange={() => onToggleFinding(findingId)}
                      className={styles.findingCheckbox}
                    />
                  ) : null}
                  <div className={styles.findingCardContent}>
                    <div className={styles.findingSummaryContainer}>
                      {gateLabel && (
                        <span className={styles.findingCategoryBadge}>{gateLabel}</span>
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
              disabled={revisionDecisionLocked || selectedFindingIds.length === 0}
            >
              {revisionStarted ? (
                <span className={styles.buttonIconText}>
                  <Check size={14} aria-hidden="true" />
                  <span>{CARD.qualityReview.revisionStartedButton}</span>
                </span>
              ) : revising ? (
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

export function CandidateSetCard({
  card,
  renderItemActions,
  selectionMode = false,
  selectedItemId = null,
  onSelectItem,
  renderEmptySelectionActions,
}: Props & {
  // 动作数据仍全部来自 available_actions（卡片数据不携带动作，N-SURF）。
  // selectionMode 只改变动作的可见归属：先选中一项，再在统一底栏渲染该项动作。
  renderItemActions?: (item: Record<string, unknown>, index: number) => ReactNode;
  selectionMode?: boolean;
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string) => void;
  renderEmptySelectionActions?: ReactNode;
}) {
  const items = Array.isArray(card.items) ? card.items : [];
  const fallbackCopy = artifactDraftCopy(card);
  const title = card.title || fallbackCopy.title;
  const description = card.body || fallbackCopy.body;
  const itemViews = items.map((item: Record<string, unknown>, index) => {
    const itemTitle = displayText(item.title) || `候选 ${index + 1}`;
    const itemId = displayText(item.item_id);
    const actions = renderItemActions?.(item, index);
    return {
      item,
      index,
      itemId,
      itemTitle,
      body: displayText(item.body),
      rationale: displayText(item.rationale),
      actions,
      selectable: itemId !== null && actions !== null && actions !== undefined,
      optionLabel: CARD.tentativeArtifact.candidateOptionLabel(index),
    };
  });
  const selectedItem = selectionMode
    ? itemViews.find((item) => item.itemId === selectedItemId && item.selectable)
    : undefined;
  const selectionGroupName = `candidate-selection-${card.candidate_set_ref || title}`;

  return (
    <div
      className={`${styles.card} ${styles.candidateSetCard} ${
        selectionMode ? styles.candidateChoiceSetCard : ""
      }`}
    >
      <div className={styles.header}>
        <div className={styles.title}>{title}</div>
      </div>
      {description && <div className={styles.body}>{description}</div>}
      {selectionMode && (
        <div className={styles.candidateChoiceInstruction}>
          {CARD.tentativeArtifact.candidateSelectionInstruction}
        </div>
      )}
      {items.length > 0 && (
        <div
          className={styles.candidateItems}
          role={selectionMode ? "radiogroup" : undefined}
          aria-label={selectionMode ? title : undefined}
        >
          {itemViews.map(
            ({ index, itemId, itemTitle, body, rationale, actions, selectable, optionLabel }) => {
              const key = itemId || `${itemTitle}-${index}`;
              const selected = selectionMode && itemId === selectedItem?.itemId;
              return (
                <article
                  key={key}
                  className={`${styles.candidateItem} ${
                    selectionMode ? styles.candidateChoiceItem : ""
                  } ${selected ? styles.candidateItemSelected : ""} ${
                    selectionMode && !selectable ? styles.candidateItemHandled : ""
                  }`}
                >
                  {selectionMode && itemId ? (
                    <label className={styles.candidateChoiceHeader}>
                      <input
                        type="radio"
                        name={selectionGroupName}
                        value={itemId}
                        checked={selected}
                        disabled={!selectable}
                        aria-label={CARD.tentativeArtifact.candidateSelectionAriaLabel(
                          optionLabel,
                          itemTitle,
                        )}
                        onChange={() => onSelectItem?.(itemId)}
                      />
                      <span className={styles.candidateChoiceOption}>
                        {optionLabel} · {itemTitle}
                      </span>
                      {!selectable && (
                        <span className={styles.candidateChoiceHandled}>
                          {CARD.tentativeArtifact.candidateHandledLabel}
                        </span>
                      )}
                    </label>
                  ) : (
                    <div className={styles.candidateItemTitle}>{itemTitle}</div>
                  )}
                  {body && <div className={styles.candidateItemBody}>{body}</div>}
                  {rationale && (
                    <div className={styles.candidateItemRationale}>
                      {CARD.artifactDraft.rationalePrefix}
                      {rationale}
                    </div>
                  )}
                  {!selectionMode && actions ? (
                    <div className={styles.candidateItemActions}>{actions}</div>
                  ) : null}
                </article>
              );
            },
          )}
        </div>
      )}
      {selectionMode && (
        <div className={styles.candidateSelectionFooter}>
          <div className={styles.candidateSelectionStatus} aria-live="polite">
            {selectedItem
              ? CARD.tentativeArtifact.candidateSelectedSummary(
                  selectedItem.optionLabel,
                  selectedItem.itemTitle,
                )
              : CARD.tentativeArtifact.candidateSelectionRequired}
          </div>
          <div className={styles.candidateSelectionActions}>
            {selectedItem?.actions ?? renderEmptySelectionActions}
          </div>
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
