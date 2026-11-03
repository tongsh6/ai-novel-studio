// Design: docs/design/ui/46-state-and-feedback.md §9.7（2026-11-04 修订：等待即回答）
// 消息流记录形态：问题文本 + 作答状态只读展示；回答操作由底部回答面板统一接管。
import { WORKBENCH } from "../lib/copy";
import type { WireTurnResult } from "../lib/turnResultWire";
import styles from "./WorkspaceChat.module.css";

type AuthorQuestion = NonNullable<WireTurnResult["author_question"]>;

export function AuthorQuestionRecord({ question }: { question: AuthorQuestion }) {
  const statusText =
    question.status === "answered"
      ? WORKBENCH.authorQuestionAnswered
      : question.status === "closed"
        ? WORKBENCH.authorQuestionClosed
        : WORKBENCH.authorQuestionReadOnlyPending;
  return (
    <div className={styles.cardActions} aria-label={WORKBENCH.authorQuestionRecordLabel}>
      <p className={styles.authorQuestionReadOnlyQuestion}>{question.question}</p>
      <span className={styles.authorQuestionReadOnlyStatus}>{statusText}</span>
    </div>
  );
}
