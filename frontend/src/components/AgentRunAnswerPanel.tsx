// Design: docs/design/ui/46-state-and-feedback.md §9.7（2026-11-04 修订：等待即回答）
// 底部输入区接管形态：当前问题 + 结构化选项 + 自由回复 + 显式「开始新讨论」。
// 回答消费原 run 的 steer 机制（author_choice）；「开始新讨论」才恢复新请求语义。
import { AuthorQuestionReply } from "./AuthorQuestionReply";
import { WORKBENCH } from "../lib/copy";
import type { WireTurnResult } from "../lib/turnResultWire";
import styles from "./WorkspaceChat.module.css";

export function AgentRunAnswerPanel({
  result,
  disabled,
  onReply,
  onStartNewDiscussion,
}: {
  result: WireTurnResult;
  disabled: boolean;
  onReply: (
    result: WireTurnResult,
    action: NonNullable<WireTurnResult["available_actions"]>[number],
    text: string,
  ) => Promise<boolean>;
  onStartNewDiscussion: () => void;
}) {
  return (
    <div
      className={styles.authorQuestionAnswerPanel}
      role="group"
      aria-label={WORKBENCH.authorQuestionAnswerModeLabel}
    >
      <div className={styles.agentRunComposerContext}>
        <span className={styles.agentRunComposerLabel}>
          {WORKBENCH.authorQuestionAnswerModeLabel}
        </span>
        <span className={styles.agentRunComposerHint}>
          {WORKBENCH.authorQuestionAnswerModeHint}
        </span>
      </div>
      <p className={styles.authorQuestionAnswerPrompt}>{result.author_question?.question}</p>
      <AuthorQuestionReply result={result} disabled={disabled} onReply={onReply} />
      <div className={styles.authorQuestionAnswerActions}>
        <button type="button" className={styles.btnSecondary} onClick={onStartNewDiscussion}>
          {WORKBENCH.authorQuestionAnswerModeNewDiscussion}
        </button>
      </div>
    </div>
  );
}
