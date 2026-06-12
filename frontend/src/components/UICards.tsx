// Design: docs/design-v2/ui-design/42-card-system.md §3 (card component rendering)
// Prototype: novel-studio-v2.pen → 41§3-main-workbench (ZOwOi)
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
    case "world_setting":
      return {
        title: CARD.artifactDraft.worldTitle,
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
            <span key={ref} className={styles.artifactTag}>{ref}</span>
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
