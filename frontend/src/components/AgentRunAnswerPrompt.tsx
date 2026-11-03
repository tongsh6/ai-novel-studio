// Design: docs/design/ui/46-state-and-feedback.md §9.7（2026-11-04 修订：等待即回答）
// Prototype: novel-studio.pen → 46§9.7-answer-mode (fQqI7)
// 回答上下文提示条：问题 + 结构化选项 + 显式「开始新讨论」；输入与提交由主 composer 承担，
// 避免在底部再造第二个输入面板（单一回答入口，46 §9.7）。
import { WORKBENCH } from "../lib/copy";
import type { WireTurnResult } from "../lib/turnResultWire";
import styles from "./WorkspaceChat.module.css";

type Action = NonNullable<WireTurnResult["available_actions"]>[number];

export function AgentRunAnswerPrompt({
  result,
  disabled,
  onAnswer,
  onStartNewDiscussion,
}: {
  result: WireTurnResult;
  disabled: boolean;
  onAnswer: (action: Action, text: string) => void;
  onStartNewDiscussion: () => void;
}) {
  const question = result.author_question;
  if (!question) return null;

  const actions = (result.available_actions ?? []).filter(
    (action) =>
      action.action_type === "author_choice" && action.question_ref === question.question_ref,
  );
  const choices = actions.filter((action) => action.response_kind !== "free_text");
  const hasFreeText = actions.some((action) => action.response_kind === "free_text");

  return (
    <div
      className={styles.answerPrompt}
      role="group"
      aria-label={WORKBENCH.authorQuestionAnswerModeLabel}
    >
      <div className={styles.answerPromptHead}>
        <span className={styles.answerPromptLabel}>{WORKBENCH.authorQuestionDecisionNeeded}</span>
        <button
          type="button"
          className={styles.answerPromptNewDiscussion}
          onClick={onStartNewDiscussion}
        >
          {WORKBENCH.authorQuestionAnswerModeNewDiscussion}
        </button>
      </div>
      <blockquote className={styles.answerPromptQuote}>
        <p>{question.question}</p>
      </blockquote>
      {choices.length > 0 && (
        <div className={styles.answerPromptChoices}>
          {choices.map((action) => (
            <button
              key={action.action_id}
              type="button"
              className={styles.answerPromptChoice}
              disabled={disabled || action.enabled === false}
              onClick={() => onAnswer(action, action.label ?? "")}
            >
              {action.label ?? WORKBENCH.authorQuestionReply}
            </button>
          ))}
        </div>
      )}
      <span className={styles.answerPromptHint}>
        {hasFreeText
          ? WORKBENCH.authorQuestionAnswerModeHint
          : WORKBENCH.authorQuestionAnswerModeOnlyChoices}
      </span>
    </div>
  );
}
