// Design: docs/design-v2/ui-design/42-card-system.md §3 (card component rendering)
// Prototype: novel-studio-v2.pen → 41§3-main-workbench (ZOwOi)
import { BookOpen } from "lucide-react";

import { CARD } from "../lib/copy";
import { adoptionDecisionCopy, adoptionDecisionFollowUpAction } from "../lib/adoptionDecision";
import styles from "./UICards.module.css";

// Basic interface for UI cards, shared across v2 and v3 implementations
export interface UICardData {
  card_type: string;
  priority?: string;
  visibility?: string;
  title?: string;
  body?: string;
  artifact_refs?: string[];
  actions?: UIActionData[];
}

export interface UIActionData {
  action_id: string;
  action_type?: string;
  label: string;
  target_ref: string;
  enabled: boolean;
  style_hint?: string;
}

export interface AdoptionDecisionData {
  artifact_id: string;
  artifact_type?: string;
  adoption_status: string;
  payload?: {
    title?: unknown;
    [key: string]: unknown;
  };
}

interface Props {
  card: UICardData;
  onAction: (actionId: string, targetRef: string, actionType?: string) => void;
  adoptionDecision?: AdoptionDecisionData | null;
}

function adoptionDecisionArtifactTitle(
  card: UICardData,
  adoptionDecision: AdoptionDecisionData,
): string {
  const title = adoptionDecision.payload?.title;
  if (typeof title === "string" && title.trim().length > 0 && !isPendingArtifactTitle(title)) {
    return title;
  }

  if (card.title && !isPendingArtifactTitle(card.title)) return card.title;

  return CARD.adoptionDecision.artifactFallbackTitle;
}

function isPendingArtifactTitle(title: string): boolean {
  const normalized = title.trim();

  return [
    CARD.tentativeArtifact.title,
    "待确认的新设定",
    "待采纳产物",
    "大纲产物待采纳",
  ].includes(normalized);
}

export function ClarificationCard({ card, onAction }: Props) {
  return (
    <div className={`${styles.card} ${styles.clarificationCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>❓</div>
        <div className={styles.title}>{card.title || CARD.clarification.title}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConfirmationCard({ card, onAction }: Props) {
  return (
    <div className={`${styles.card} ${styles.confirmationCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>⚠️</div>
        <div className={styles.title}>{card.title || CARD.confirmation.title}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WarningCard({ card, onAction }: Props) {
  return (
    <div className={`${styles.card} ${styles.warningCard}`}>
      <div className={styles.header}>
        <div className={styles.warningIcon}>!</div>
        <div className={styles.title}>{card.title || "警告"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdoptionCard({ card, onAction, adoptionDecision }: Props) {
  if (adoptionDecision) {
    const decisionCopy = adoptionDecisionCopy(adoptionDecision.adoption_status);
    const followUpAction = adoptionDecisionFollowUpAction(
      adoptionDecision.adoption_status,
      adoptionDecision.artifact_type,
    );

    return (
      <div
        className={`${styles.card} ${styles.adoptionCard} ${styles.adoptionDecisionCard}`}
        data-slice-verify="adoption-decision-card"
        data-adoption-status={adoptionDecision.adoption_status}
      >
        <div className={styles.header}>
          <div className={styles.adoptionDecisionStatus}>{decisionCopy.title}</div>
          <div className={styles.adoptionDecisionTitle}>
            {adoptionDecisionArtifactTitle(card, adoptionDecision)}
          </div>
        </div>
        <div className={styles.adoptionDecisionNote}>{decisionCopy.description}</div>
        {followUpAction && (
          <div className={styles.actionsEnd}>
            <button
              className={styles.btnSecondary}
              data-slice-verify="open-reading-from-adoption-decision"
              onClick={() => onAction(followUpAction.action_id, adoptionDecision.artifact_id)}
            >
              <span className={styles.buttonIconText}>
                <BookOpen size={14} aria-hidden="true" />
                {followUpAction.label}
              </span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.card} ${styles.adoptionCard}`}>
      <div className={styles.header}>
        <div className={styles.adoptionTitle}>{card.title || CARD.tentativeArtifact.title}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actionsEnd}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProgressCard({ card, onAction }: Props) {
  return (
    <div className={`${styles.card} ${styles.progressCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>⏳</div>
        <div className={styles.title}>{card.title || "系统运行中"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CheckpointCard({ card, onAction }: Props) {
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
            <span key={ref} className={styles.artifactTag}>{ref}</span>
          ))}
        </div>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResultCard({ card, onAction }: Props) {
  return (
    <div className={`${styles.card} ${styles.resultCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>✅</div>
        <div className={styles.title}>{card.title || "执行完成"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actionsEnd}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FailureCard({ card, onAction }: Props) {
  return (
    <div className={`${styles.card} ${styles.failureCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>❌</div>
        <div className={styles.title}>{card.title || "执行失败"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EscalationCard({ card, onAction }: Props) {
  return (
    <div className={`${styles.card} ${styles.escalationCard}`}>
      <div className={styles.header}>
        <div className={styles.icon}>🛑</div>
        <div className={styles.title}>{card.title || "需要关注"}</div>
      </div>
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DefaultCard({ card, onAction }: Props) {
  return (
    <div className={`${styles.card} ${styles.defaultCard}`}>
      {card.title && <div className={styles.title}>{card.title}</div>}
      {card.body && <div className={styles.body}>{card.body}</div>}
      {card.actions && card.actions.length > 0 && (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <button
              key={action.action_id}
              className={getButtonStyle(action.style_hint)}
              data-slice-verify="card-action"
              data-action-type={action.action_type}
              disabled={!action.enabled}
              onClick={() => onAction(action.action_id, action.target_ref, action.action_type)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getButtonStyle(styleHint?: string) {
  if (styleHint === "primary") return styles.btnPrimary;
  if (styleHint === "danger") return styles.btnDanger;
  if (styleHint === "ghost") return styles.btnGhost;
  return styles.btnSecondary;
}
