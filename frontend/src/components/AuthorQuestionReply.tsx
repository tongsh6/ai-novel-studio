// Design: docs/design/ui/46-state-and-feedback.md §7 / §9.7；UA-01 §2.2.2 A
// Prototype: novel-studio.pen → 46§9.7-agent-run-control-dock (dxUhh)
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { WireTurnResult } from "../lib/turnResultWire";
import { UserMessageSubmissionSchema } from "../generated/foundation/user_message_submission";
import { WORKBENCH } from "../lib/copy";
import styles from "./WorkspaceChat.module.css";

const ReplySchema = UserMessageSubmissionSchema.pick({ text: true }).refine(
  ({ text }) => text.trim().length > 0,
  { message: WORKBENCH.authorQuestionEmpty, path: ["text"] },
);
type ReplyFields = z.infer<typeof ReplySchema>;
type Action = NonNullable<WireTurnResult["available_actions"]>[number];

export function AuthorQuestionReply({
  result,
  disabled,
  onReply,
}: {
  result: WireTurnResult;
  disabled: boolean;
  onReply: (result: WireTurnResult, action: Action, text: string) => Promise<boolean>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<ReplyFields>({
    resolver: zodResolver(ReplySchema),
    defaultValues: { text: "" },
  });
  const replyText = useWatch({ control: form.control, name: "text" }) ?? "";
  const question = result.author_question;
  if (!question) return null;
  const actions = (result.available_actions ?? []).filter(
    (action) =>
      action.action_type === "author_choice" && action.question_ref === question.question_ref,
  );
  const active = actions.find((action) => action.action_id === activeId);
  const unavailable =
    disabled ||
    question.status !== "open" ||
    acknowledged ||
    submitting ||
    form.formState.isSubmitting;
  const answer = async (action: Action, text: string) => {
    setSubmitting(true);
    try {
      if (await onReply(result, action, text)) {
        setAcknowledged(true);
        setActiveId(null);
        form.reset();
      }
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className={styles.cardActions} aria-label={WORKBENCH.authorQuestionReply}>
      {acknowledged || question.status === "answered" ? (
        <span>{WORKBENCH.authorQuestionAnswered}</span>
      ) : question.status === "closed" ? (
        <span>{WORKBENCH.authorQuestionClosed}</span>
      ) : (
        actions.map((action) => (
          <button
            key={action.action_id}
            type="button"
            className={styles.btnSecondary}
            disabled={unavailable || action.enabled === false}
            onClick={() => {
              if (action.response_kind === "free_text") setActiveId(action.action_id);
              else void answer(action, action.label ?? "");
            }}
          >
            {action.label ?? WORKBENCH.authorQuestionReply}
          </button>
        ))
      )}
      {active && (
        <form
          className="flex w-full flex-col gap-2"
          onSubmit={(event) => {
            void form.handleSubmit(({ text }) => answer(active, text))(event);
          }}
        >
          <label className="flex flex-col gap-2">
            <span>{question.question}</span>
            <textarea
              {...form.register("text")}
              aria-label={WORKBENCH.authorQuestionReplyLabel}
              className={styles.editTextarea}
              disabled={unavailable || active.enabled === false}
            />
          </label>
          {form.formState.errors.text && <p role="alert">{form.formState.errors.text.message}</p>}
          <div className={styles.cardActions}>
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={unavailable || active.enabled === false || replyText.trim().length === 0}
            >
              {WORKBENCH.authorQuestionSend}
            </button>
            <button type="button" className={styles.btnSecondary} onClick={() => setActiveId(null)}>
              {WORKBENCH.authorQuestionCancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
