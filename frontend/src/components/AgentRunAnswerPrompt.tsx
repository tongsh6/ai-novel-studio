// Design: docs/design/ui/46-state-and-feedback.md §9.7（2026-11-04 修订：等待即回答）
// Prototype: novel-studio.pen → 46§9.7-answer-mode (fQqI7)
// 回答上下文提示条：问题 + 结构化选项 + 显式「开始新讨论」；输入与提交由主 composer 承担，
// 避免在底部再造第二个输入面板（单一回答入口，46 §9.7）。
import { useEffect, useState } from "react";
import { WORKBENCH } from "../lib/copy";
import type { WireTurnResult } from "../lib/turnResultWire";
import styles from "./WorkspaceChat.module.css";

type Action = NonNullable<WireTurnResult["available_actions"]>[number];

export function AgentRunAnswerPrompt({
  result,
  disabled,
  disabledReason = null,
  waitingSince = null,
  onAnswer,
  onStartNewDiscussion,
  onAbandon,
}: {
  result: WireTurnResult;
  disabled: boolean;
  /** 不可回答原因（任务已结束/版本已变）；非空时替代默认 hint，避免静默禁用。 */
  disabledReason?: string | null;
  /** 等待起点（ISO 时间）：显示作者已等待多久（LangGraph HITL 最佳实践）。 */
  waitingSince?: string | null;
  onAnswer: (action: Action, text: string) => void;
  onStartNewDiscussion: () => void;
  /** 显式放弃当前问题（MCP decline / AG-UI abandoned 语义）：确认后终止当前任务。 */
  onAbandon: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (waitingSince === null) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [waitingSince]);
  const waitingLabel = (() => {
    if (waitingSince === null) return null;
    const started = new Date(waitingSince).getTime();
    if (Number.isNaN(started)) return null;
    const minutes = Math.max(0, Math.floor((now - started) / 60_000));
    return minutes < 60
      ? WORKBENCH.authorQuestionWaitingFor(minutes)
      : WORKBENCH.authorQuestionWaitingForHours(Math.floor(minutes / 60));
  })();
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
        {waitingLabel !== null && (
          <span className={styles.answerPromptWaiting}>{waitingLabel}</span>
        )}
        <button
          type="button"
          className={styles.answerPromptNewDiscussion}
          onClick={onStartNewDiscussion}
        >
          {WORKBENCH.authorQuestionAnswerModeNewDiscussion}
        </button>
        <button type="button" className={styles.answerPromptNewDiscussion} onClick={onAbandon}>
          {WORKBENCH.authorQuestionAbandon}
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
        {disabledReason !== null
          ? disabledReason
          : hasFreeText
            ? WORKBENCH.authorQuestionAnswerModeHint
            : WORKBENCH.authorQuestionAnswerModeOnlyChoices}
      </span>
    </div>
  );
}
