import { useEffect, useState, useRef } from "react";
import type { Channel } from "phoenix";

import { createSocket, joinWorkspace, sendMessage, adopt } from "../lib/socket";
import styles from "./WorkspaceChat.module.css";

interface TurnResult {
  schema_version: string;
  turn_id: string;
  phase: string;
  status: string;
  next_action: string;
  assistant_message: { text: string };
  ui_cards?: UICard[];
  adoption_state?: {
    pending: ArtifactEntry[];
    resolved: ArtifactEntry[];
  };
  behavior_state?: { active: Record<string, unknown> | null };
  produced_at: string;
}

interface UICard {
  card_type: string;
  priority?: string;
  visibility?: string;
  title?: string;
  body?: string;
  artifact_refs?: string[];
  actions?: UIAction[];
}

interface UIAction {
  action_id: string;
  label: string;
  target_ref: string;
  enabled: boolean;
  style_hint?: string;
}

interface ArtifactEntry {
  artifact_id: string;
  artifact_type: string;
  adoption_status: string;
  requires_adoption: boolean;
  payload: Record<string, unknown>;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  turnResult?: TurnResult;
}

export function WorkspaceChat() {
  const [status, setStatus] = useState<string>("connecting");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<Channel | null>(null);
  const socketRef = useRef<ReturnType<typeof createSocket> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = createSocket();
    socket.connect();
    socketRef.current = socket;

    const channel = joinWorkspace(socket);
    channelRef.current = channel;

    channel
      .join()
      .receive("ok", () => setStatus("connected"))
      .receive("error", () => setStatus("error"))
      .receive("timeout", () => setStatus("error"));

    channel.on("turn_result", (result: TurnResult) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: result.assistant_message?.text ?? "",
          turnResult: result,
        },
      ]);
      setLoading(false);
    });

    return () => {
      channel.leave();
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !channelRef.current) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInputText("");
    setLoading(true);

    try {
      await sendMessage(channelRef.current, text);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "发送失败，请重试。" },
      ]);
      setLoading(false);
    }
  };

  const handleAdopt = async (artifact: ArtifactEntry) => {
    if (!channelRef.current) return;
    try {
      await adopt(channelRef.current, artifact.artifact_id, artifact.payload);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `已确认创建作品：「${String(artifact.payload.title ?? artifact.artifact_id)}」`,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "操作失败，请重试。" },
      ]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>AI Novel Studio</h2>
        <span className={styles.status}>{status}</span>
      </div>

      <div className={styles.messages}>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={
              msg.role === "user" ? styles.userMsg : styles.assistantMsg
            }
          >
            <div className={styles.role}>
              {msg.role === "user" ? "你" : "AI"}
            </div>
            <div className={styles.text}>{msg.text}</div>

            {msg.turnResult?.ui_cards?.map((card, ci) => (
              <div key={ci} className={styles.card}>
                {card.title && (
                  <div className={styles.cardTitle}>{card.title}</div>
                )}
                {card.body && (
                  <div className={styles.cardBody}>{card.body}</div>
                )}
                {card.actions && card.actions.length > 0 && (
                  <div className={styles.cardActions}>
                    {card.actions.map((action) => (
                      <button
                        key={action.action_id}
                        className={
                          action.style_hint === "primary"
                            ? styles.btnPrimary
                            : styles.btnSecondary
                        }
                        disabled={!action.enabled}
                        onClick={() => {
                          const pending =
                            msg.turnResult?.adoption_state?.pending ?? [];
                          const artifact = pending.find(
                            (a) => a.artifact_id === action.target_ref,
                          );
                          if (artifact && action.action_id === "accept") {
                            handleAdopt(artifact);
                          }
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        {loading && <div className={styles.loading}>AI 思考中...</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputArea}>
        <input
          type="text"
          className={styles.input}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，Enter 发送..."
          disabled={status !== "connected"}
        />
        <button
          className={styles.btnPrimary}
          onClick={handleSend}
          disabled={loading || status !== "connected"}
        >
          发送
        </button>
      </div>
    </div>
  );
}
