// Design: docs/design-v2/ui-design/41-workbench-layout.md §2 (3-zone workbench)
// Design: docs/design-v2/ui-design/42-card-system.md §2 (card type to ADR-0006 mapping)
// Prototype: novel-studio-v2.pen → 41§3-main-workbench (ZOwOi)
import { useEffect, useState, useRef } from "react";
import type { Channel } from "phoenix";

import { createSocket, joinWorkspace, sendMessage, adopt } from "../lib/socket";
import { ClarificationCard, ConfirmationCard, WarningCard, AdoptionCard, ProgressCard, DefaultCard } from "./UICards";
import { StructurePanel } from "./StructurePanel";
import { useAppStore } from "../lib/store";

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

export interface UICard {
  card_type: string;
  priority?: string;
  visibility?: string;
  title?: string;
  body?: string;
  artifact_refs?: string[];
  actions?: UIAction[];
}

export interface UIAction {
  action_id: string;
  label: string;
  target_ref: string;
  enabled: boolean;
  style_hint?: string;
}

export interface ArtifactEntry {
  artifact_id: string;
  artifact_type: string;
  adoption_status: string;
  requires_adoption: boolean;
  revision_base?: string | null;
  payload: {
    title?: unknown;
    [key: string]: unknown;
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  turnResult?: TurnResult;
}

export function WorkspaceChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  
  // Connect to Zustand Global Store
  const { 
    socketConnected, 
    setSocketConnected,
    context,
    longRun,
    setContext,
    setMode
  } = useAppStore();

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
      .receive("ok", () => {
        setSocketConnected(true);
        setMessages([
          {
            role: "assistant",
            text: "欢迎使用 AI Novel Studio！\n\n你可以这样开始：\n• 「我想创建一部玄幻小说」\n• 「写一本都市小说，核心卖点是商战复仇」\n• 「帮我创作一部科幻小说，目标读者是大学生」\n\n输入你的想法，我们开始创作吧！",
          },
        ]);
        
        // Mock injecting initial context upon connection
        setContext({
          workTitle: "未定作品",
          volumeTitle: "未定卷"
        });
      })
      .receive("error", () => setSocketConnected(false))
      .receive("timeout", () => setSocketConnected(false));

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

      // (Later: we should parse result.phase, status and update longRun/context store here)
    });

    return () => {
      channel.leave();
      socket.disconnect();
    };
  }, [setSocketConnected, setContext]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (messageText: string = inputText) => {
    const text = messageText.trim();
    if (!text || !channelRef.current) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    if (messageText === inputText) setInputText("");
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
      await adopt(
        channelRef.current,
        artifact.artifact_id,
        parseRevisionBase(artifact.revision_base),
        artifact.payload,
      );
      const title =
        typeof artifact.payload.title === "string"
          ? artifact.payload.title
          : artifact.artifact_id;

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `已确认采纳：「${title}」`,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "操作失败，请重试。" },
      ]);
    }
  };

  const handlePanelAction = (actionType: string, artifactId?: string) => {
    if (actionType === "init_intent") {
      void handleSend("我想调整或新增伏笔");
    } else if (actionType === "revise" && artifactId) {
      void handleSend(`我想修改设定 ${artifactId}，我的想法是：`);
    } else {
      console.log("Panel action triggered:", actionType, artifactId);
    }
  };

  const parseRevisionBase = (revisionBase: string | null | undefined) => {
    if (!revisionBase) return undefined;
    const parsed = Number.parseInt(revisionBase, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const allPendingAdoptions = messages.flatMap(
    (msg) => msg.turnResult?.adoption_state?.pending ?? []
  );
  const pendingAdoptionsCount = allPendingAdoptions.length;

  return (
    <div className={styles.workbench}>
      {/* 顶部上下文栏 (Top Context Bar) */}
      <div className={styles.topBar}>
        <div className={styles.contextGroup}>
          <span className={styles.titleText}>{context.workTitle || "无活跃作品"}</span>
          <button 
            className={styles.btnSecondary} 
            style={{ padding: "4px 8px", fontSize: "12px", border: "none" }}
            onClick={() => setMode("reading")}
          >
            [阅读模式]
          </button>
          <span className={styles.divider1}>/</span>
          <span className={styles.volText}>{context.volumeTitle || "全书"}</span>
        </div>
        <div className={styles.statusGroup}>
          <span className={styles.budgetText}>
            {longRun.status === "running" ? `长跑中: ${longRun.budgetUsed}%` : "长跑状态: 待机"}
          </span>
          <div className={styles.riskBadge} style={{ backgroundColor: socketConnected ? 'var(--accent)' : 'var(--foreground-secondary)' }}>
            连接状态: {socketConnected ? "已连接" : "离线"}
          </div>
        </div>
      </div>

      {/* 主工作区域 (Main Area) */}
      <div className={styles.mainArea}>
        
        {/* 左侧对话与输入列 (Left Column) */}
        <div className={styles.leftColumn} style={{ opacity: isPanelOpen ? 0.4 : 1, transition: 'opacity 0.2s' }}>
          
          {/* 对话流区域 (Chat Area) */}
          <div className={styles.chatArea}>
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

                {msg.turnResult?.ui_cards?.map((card, ci) => {
                  const handleAction = (actionId: string, targetRef: string) => {
                    const pending = msg.turnResult?.adoption_state?.pending ?? [];
                    const artifact = pending.find((a) => a.artifact_id === targetRef);
                    if (artifact && actionId === "accept") {
                      void handleAdopt(artifact);
                    }
                  };

                  switch (card.card_type) {
                    case "clarification_card":
                      return <ClarificationCard key={ci} card={card} onAction={handleAction} />;
                    case "confirmation_card":
                      return <ConfirmationCard key={ci} card={card} onAction={handleAction} />;
                    case "warning_card":
                      return <WarningCard key={ci} card={card} onAction={handleAction} />;
                    case "adoption_card":
                      return <AdoptionCard key={ci} card={card} onAction={handleAction} />;
                    case "progress_card":
                      return <ProgressCard key={ci} card={card} onAction={handleAction} />;
                    default:
                      return <DefaultCard key={ci} card={card} onAction={handleAction} />;
                  }
                })}
              </div>
            ))}

            {loading && <div className={styles.loading}>AI 思考中...</div>}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区域 (Input Area) */}
          <div className={styles.inputArea}>
            <input
              type="text"
              className={styles.inputBox}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入指令或继续创作...（例如：我想创建一部玄幻小说）"
              disabled={!socketConnected || isPanelOpen}
            />
            <button
              className={styles.sendBtn}
              onClick={() => {
                void handleSend();
              }}
              disabled={loading || !socketConnected || isPanelOpen}
            >
              发送
            </button>
          </div>
        </div>

        {/* 结构与长跑收纳面板 (Structure Rail) */}
        {!isPanelOpen ? (
          <div className={styles.structureRailCollapsed}>
            <div className={styles.spTitle}>作品档案</div>
            <div className={styles.railSummary}>
              <div 
                className={styles.openArchiveEntry}
                onClick={() => setIsPanelOpen(true)}
              >
                <span className={styles.spItemCardText}>打开档案<br/>查看详情</span>
              </div>
              {pendingAdoptionsCount > 0 && (
                <div className={styles.spItemTitle} style={{marginTop: '10px'}}>
                  待采纳 {pendingAdoptionsCount}
                </div>
              )}
            </div>
          </div>
        ) : (
          <StructurePanel 
            isOpen={isPanelOpen} 
            onClose={() => setIsPanelOpen(false)}
            pendingAdoptions={allPendingAdoptions}
            onAdopt={(artifact) => {
              void handleAdopt(artifact);
              setIsPanelOpen(false);
            }}
            onAction={(type, id) => {
              handlePanelAction(type, id);
              setIsPanelOpen(false);
            }}
          />
        )}

      </div>
    </div>
  );
}
