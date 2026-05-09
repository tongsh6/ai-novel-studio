// Design: tasks/slices/v3/VS-07-frontend-workbench-ui-consumer.md §6
// Prototype: docs/design-v2/ui-design/novel-studio-v2.pen → workbench-v3
// Contract: docs/design-v3/contracts/VS-05-ui-roundtrip-contract-pack.md
//
// v3 Workbench — 最小可用 UI：
//   MessageList + MessageInput + ActionPanel + CandidateCards + StatusBar
// 通过 v3 Phoenix Channel 与后端交互。

import { useEffect, useRef, useState, useCallback } from "react";
import type { Channel } from "phoenix";

import {
  connectV3,
  sendUserMessage,
  sendAuthorAction,
  onTurnResult,
  onActionResult,
  type V3TurnResult,
  type V3AvailableAction,
  type V3AuthorActionPayload,
  type V3CandidateDirection,
} from "../lib/socket_v3";
import { WORKBENCH_V3 } from "../lib/copy";
import styles from "./WorkbenchV3.module.css";

// ── Types ─────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  turnResult?: V3TurnResult;
}

// ── Component ─────────────────────────────────────

export function WorkbenchV3() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [llmStatus, setLlmStatus] = useState<boolean | null>(null);
  const [llmModel, setLlmModel] = useState("");
  const [availableActions, setAvailableActions] = useState<V3AvailableAction[]>([]);
  const [candidates, setCandidates] = useState<V3CandidateDirection[]>([]);
  const [currentTurnId, setCurrentTurnId] = useState<string>("");
  const [currentPhase, setCurrentPhase] = useState<string>("");
  const [currentStatus, setCurrentStatus] = useState<string>("");

  const channelRef = useRef<Channel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── LLM health check ────────────────────────────

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/provider/health");
        const data = (await res.json()) as {
          connected: boolean;
          model?: string;
        };
        setLlmStatus(data.connected);
        if (data.model) setLlmModel(data.model);
      } catch {
        setLlmStatus(false);
      }
    };
    void check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── Channel connect ─────────────────────────────

  useEffect(() => {
    const { socket, channel } = connectV3();
    channelRef.current = channel;

    channel
      .join()
      .receive("ok", () => {
        setConnected(true);
        setMessages([
          { role: "assistant", text: WORKBENCH_V3.welcomeMessage },
        ]);
      })
      .receive("error", () => setConnected(false))
      .receive("timeout", () => setConnected(false));

    onTurnResult(channel, (result: V3TurnResult) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: result.assistant_message?.text ?? "",
          turnResult: result,
        },
      ]);
      setCurrentTurnId(result.turn_id ?? "");
      setCurrentPhase(result.phase ?? "");
      setCurrentStatus(result.status ?? "");
      setAvailableActions(result.available_actions ?? []);
      setCandidates(result.candidate_directions ?? []);
      setLoading(false);
    });

    onActionResult(channel, (result) => {
      if (result.action_status === "accepted") {
        setAvailableActions([]);
      }
    });

    return () => {
      channel.leave();
      socket.disconnect();
    };
  }, []);

  // ── Scroll ──────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send message ────────────────────────────────

  const handleSend = useCallback(
    async (text?: string, generatePlan = false) => {
      const msg = (text ?? inputText).trim();
      if (!msg || !channelRef.current) return;

      setMessages((prev) => [...prev, { role: "user", text: msg }]);
      if (msg === inputText) setInputText("");
      setLoading(true);
      setAvailableActions([]);
      setCandidates([]);

      try {
        await sendUserMessage(channelRef.current, msg, generatePlan);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: WORKBENCH_V3.errorSendFailed },
        ]);
        setLoading(false);
      }
    },
    [inputText],
  );

  // ── Handle action ───────────────────────────────

  const handleAction = useCallback(
    async (action: V3AvailableAction) => {
      if (!channelRef.current || !action.enabled) return;

      const payload: V3AuthorActionPayload = {
        source_turn_ref: currentTurnId,
        action_id: action.action_id,
        action_type: action.action_type,
        behavior_ref: action.behavior_ref,
        candidate_set_ref: action.candidate_set_ref,
        candidate_ref: action.candidate_ref,
        idempotency_key: action.idempotency_key,
      };

      try {
        await sendAuthorAction(channelRef.current, payload);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: WORKBENCH_V3.errorActionFailed },
        ]);
      }
    },
    [currentTurnId],
  );

  // ── Key handler ─────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ── Render ──────────────────────────────────────

  return (
    <div className={styles.workbench}>
      {/* StatusBar */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span className={styles.title}>AI Novel Studio v3</span>
          {currentPhase && (
            <span className={styles.badge}>
              {currentPhase}{currentStatus && ` · ${currentStatus}`}
            </span>
          )}
        </div>
        <div className={styles.statusRight}>
          <span
            className={styles.badge}
            data-status={llmStatus === true ? "ok" : "warn"}
          >
            {llmStatus === null
              ? WORKBENCH_V3.llmChecking
              : llmStatus
                ? `${WORKBENCH_V3.llmConnected} (${llmModel || "LM Studio"})`
                : WORKBENCH_V3.llmDisconnected}
          </span>
          <span
            className={styles.badge}
            data-status={connected ? "ok" : "error"}
          >
            {connected
              ? WORKBENCH_V3.connectionOnline
              : WORKBENCH_V3.connectionOffline}
          </span>
        </div>
      </div>

      {/* MessageList */}
      <div className={styles.chatArea}>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={
              msg.role === "user" ? styles.userMsg : styles.assistantMsg
            }
          >
            <span className={styles.role}>
              {msg.role === "user" ? "你" : "AI"}
            </span>
            <div className={styles.text}>{msg.text}</div>

            {/* Phase / Status indicator */}
            {msg.turnResult && (
              <div className={styles.turnMeta}>
                <span className={styles.phaseTag}>
                  {msg.turnResult.phase === "awaiting_author"
                    ? WORKBENCH_V3.phaseAwaiting
                    : WORKBENCH_V3.phaseCompleted}
                </span>
                <span className={styles.statusTag}>
                  {msg.turnResult.status === "needs_clarification"
                    ? WORKBENCH_V3.statusNeedsClarification
                    : msg.turnResult.status === "needs_confirmation"
                      ? WORKBENCH_V3.statusNeedsConfirmation
                      : WORKBENCH_V3.statusConversational}
                </span>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className={styles.loading}>{WORKBENCH_V3.thinking}</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* CandidateCards */}
      {candidates.length > 0 && (
        <div className={styles.candidatePanel}>
          <div className={styles.candidateHeader}>
            {WORKBENCH_V3.candidateTitle}
          </div>
          <div className={styles.candidateList}>
            {candidates.map((c) => (
              <div key={c.direction_id} className={styles.candidateCard}>
                <div className={styles.candidateTitle}>{c.title}</div>
                <div className={styles.candidatePitch}>{c.pitch}</div>
                {c.tone_tags.length > 0 && (
                  <div className={styles.candidateTags}>
                    {c.tone_tags.map((t) => (
                      <span key={t} className={styles.tag}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ActionPanel */}
      {availableActions.length > 0 && (
        <div className={styles.actionPanel}>
          {availableActions.map((action) => (
            <button
              key={action.action_id}
              className={styles.actionBtn}
              disabled={!action.enabled}
              title={action.disabled_reason}
              onClick={() => void handleAction(action)}
            >
              {action.action_type === "confirm_before_execute"
                ? WORKBENCH_V3.actionConfirm
                : action.action_type === "reject_or_cancel_confirmation"
                  ? WORKBENCH_V3.actionReject
                  : action.action_type === "cancel_pending_behavior"
                    ? WORKBENCH_V3.actionCancel
                    : action.action_type === "continue_dialogue"
                      ? WORKBENCH_V3.actionContinue
                      : action.action_type}
            </button>
          ))}
        </div>
      )}

      {/* MessageInput */}
      <div className={styles.inputArea}>
        <input
          type="text"
          className={styles.inputBox}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={WORKBENCH_V3.inputPlaceholder}
          disabled={!connected}
        />
        <button
          className={styles.sendBtn}
          onClick={() => void handleSend()}
          disabled={loading || !connected}
        >
          {WORKBENCH_V3.sendButton}
        </button>
      </div>
    </div>
  );
}
