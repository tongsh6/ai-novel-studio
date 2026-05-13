// Design: docs/design-v2/ui-design/41-workbench-layout.md §2 (3-zone workbench)
// Design: docs/design-v2/ui-design/42-card-system.md §2 (card type to ADR-0006 mapping)
// Prototype: novel-studio-v2.pen → 41§3-main-workbench (ZOwOi)
import { useEffect, useState, useRef } from "react";
import type { Channel } from "phoenix";

import {
  createSocket,
  joinWorkspace,
  sendMessage,
  sendAuthorAction,
  onTaskState,
  adopt,
  discardArtifact,
  modifyDraft,
  type TaskStateData,
} from "../lib/socket";
import {
  listWorks,
  createWork,
  pickInitialWorkId,
  getLastOpenedWorkId,
  setLastOpenedWorkId,
  type WorkDto,
} from "../lib/works";
import {
  findAuthorizedAction,
  toAuthorActionPayload,
  type AvailableActionLike,
} from "../lib/workbenchActions";
import {
  ClarificationCard,
  ConfirmationCard,
  WarningCard,
  AdoptionCard,
  ProgressCard,
  CheckpointCard,
  ResultCard,
  FailureCard,
  EscalationCard,
  DefaultCard,
  type UICardData,
} from "./UICards";
import { StructurePanel } from "./StructurePanel";
import { useAppStore } from "../lib/store";
import { isTauri } from "../lib/env";

import styles from "./WorkspaceChat.module.css";

interface TurnResult {
  schema_version: string;
  turn_id: string;
  phase: string;
  status: string;
  next_action: string;
  assistant_message: { text: string };
  available_actions?: AvailableAction[];
  ui_cards?: UICardData[];
  candidate_directions?: CandidateDirection[];
  adoption_state?: {
    pending: ArtifactEntry[];
    resolved: ArtifactEntry[];
  };
  behavior_state?: { active: Record<string, unknown> | null };
  projection_refs?: { projection_type: string; projection_id: string; source_revision_refs: string[]; refresh_status?: string | null }[];
  produced_at: string;
}

interface AvailableAction extends AvailableActionLike {
  target_ref?: string;
}

export interface CandidateDirection {
  direction_id: string;
  title: string;
  pitch: string;
  tone_tags: string[];
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
  const [llmConnected, setLlmConnected] = useState<boolean | null>(null);
  const [llmModel, setLlmModel] = useState<string>("");
  const [modifyModal, setModifyModal] = useState<{ artifact: ArtifactEntry; action: () => void } | null>(null);
  const [modifyInstruction, setModifyInstruction] = useState("");
  const [pendingAnswerBid, setPendingAnswerBid] = useState<string | null>(null);

  // Connect to Zustand Global Store with selectors for stability
  const socketConnected = useAppStore(state => state.socketConnected);
  const setSocketConnected = useAppStore(state => state.setSocketConnected);
  const context = useAppStore(state => state.context);
  const longRun = useAppStore(state => state.longRun);
  const setContext = useAppStore(state => state.setContext);
  const setChannel = useAppStore(state => state.setChannel);
  const setMode = useAppStore(state => state.setMode);
  const setLongRun = useAppStore(state => state.setLongRun);

  const channelRef = useRef<Channel | null>(null);
  const socketRef = useRef<ReturnType<typeof createSocket> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sliceVerifyAutorunRef = useRef(false);

  // Check LLM connection status
  useEffect(() => {
    const checkLlm = async () => {
      try {
        const res = await fetch("/api/provider/health");
        const data = await res.json() as { connected: boolean; model?: string; message?: string };
        setLlmConnected(data.connected);
        if (data.model) setLlmModel(data.model);
      } catch {
        setLlmConnected(false);
      }
    };
    void checkLlm();
    const interval = setInterval(checkLlm, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Lift the turn_result handler so the effect below stays focused on connection setup.
  function handleTurnResult(result: TurnResult) {
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        text: result.assistant_message?.text ?? "",
        turnResult: result,
      },
    ]);
    setLoading(false);

    // Auto-track pending clarification: next user message is treated as answer
    const activeBehavior = result.behavior_state?.active;
    if (activeBehavior?.behavior_type === "clarification") {
      setPendingAnswerBid(activeBehavior.behavior_id as string);
    } else {
      setPendingAnswerBid(null);
    }

    // VS-005: propagate projection_refs to global store for ReadingMode
    const projRefs = result.projection_refs;
    if (projRefs && projRefs.length > 0) {
      const status = projRefs[0].refresh_status;
      if (status === "FRESH" || status === "STALE" || status === "REBUILDING" || status === "FAILED") {
        useAppStore.getState().setProjectionStatus(status);
      }
    }
  }

  function handleTaskState(state: TaskStateData) {
    if (state.phase === "RUNNING" || state.phase === "RESUMING") {
      setLongRun({
        status: "running",
        budgetUsed: typeof state.progress === "number" ? state.progress : longRun.budgetUsed,
      });
      return;
    }

    if (state.phase === "CHECKPOINT") {
      setLongRun({
        status: "checkpoint",
        budgetUsed: typeof state.progress === "number" ? state.progress : longRun.budgetUsed,
        checkpointReason: state.step ?? null,
      });
      return;
    }

    if (state.phase === "FAILED") {
      setLongRun({
        status: "failed",
        checkpointReason: state.step ?? "任务失败",
      });
      return;
    }

    if (state.phase === "COMPLETED" || state.phase === "CANCELLED") {
      setLongRun({
        status: "idle",
        budgetUsed: typeof state.progress === "number" ? state.progress : longRun.budgetUsed,
        checkpointReason: null,
      });
    }
  }

  useEffect(() => {
    // Only connect once
    if (socketRef.current) return;

    let cancelled = false;

    void (async () => {
      // VS-09 work-management: resolve which work to open BEFORE joining
      // the channel, so backend can scope state to it via socket.assigns.
      let work: WorkDto | null;
      try {
        const works = await listWorks();
        const initialId = pickInitialWorkId(works, getLastOpenedWorkId());
        if (initialId) {
          work = works.find((w) => w.id === initialId) ?? null;
        } else {
          // No works yet — bootstrap a placeholder so the user lands in a
          // valid context. They can rename it later via the work-management
          // UI (next slice).
          work = await createWork({ title: "未命名作品" });
        }
      } catch {
        // Backend unreachable — fall back to ephemeral work_id so UI still
        // renders. The badge will surface llm-disconnected separately.
        work = null;
      }
      if (cancelled) return;

      const workId = work?.id ?? "lobby";
      const workTitle = work?.title ?? "未连接";
      setLastOpenedWorkId(workId);

      const socket = createSocket();
      socket.connect();
      socketRef.current = socket;

      const channel = joinWorkspace(socket, `workspace:${workId}`, {
        work_id: workId,
      });
      channelRef.current = channel;
      setChannel(channel);

      channel
        .join()
        .receive("ok", () => {
          setSocketConnected(true);
          setMessages((prev) => {
            // Avoid duplicate welcome messages if effect re-runs
            if (prev.length > 0) return prev;
            return [
              {
                role: "assistant",
                text: "欢迎使用 AI Novel Studio！\n\n本产品需要连接大语言模型（LLM）才能工作。\n请确保 LM Studio 已启动并加载模型（默认端口 1234）。\n\n你可以这样开始：\n• 「我想创建一部玄幻小说」\n• 「写一本都市小说，核心卖点是商战复仇」\n• 「帮我创作一部科幻小说，目标读者是大学生」\n\n输入你的想法，我们开始创作吧！",
              },
            ];
          });

          // VS-09: real work context, no longer mock_work_123
          setContext({
            workId,
            workTitle,
            volumeTitle: "未定卷",
          });
        })
        .receive("error", () => setSocketConnected(false))
        .receive("timeout", () => setSocketConnected(false));

      channel.on("turn_result", handleTurnResult);
      onTaskState(channel, handleTaskState);
    })();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        channelRef.current.leave();
        channelRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocketConnected(false);
      setChannel(null);
    };

    // handleTurnResult is intentionally excluded — defined inside the
    // component but stable for the lifetime of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!isTauri) return;
    if (import.meta.env.VITE_SLICE_VERIFY_AUTORUN !== "vs10-observability-spine") return;
    if (!socketConnected || sliceVerifyAutorunRef.current) return;

    sliceVerifyAutorunRef.current = true;
    const timers: number[] = [];

    timers.push(window.setTimeout(() => {
      setIsPanelOpen(true);
      timers.push(window.setTimeout(() => {
        document
          .querySelector<HTMLButtonElement>('[data-slice-verify="panel-new-action"]')
          ?.click();
      }, 150));
    }, 150));

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [socketConnected]);

  // ... (rest of the component)

  // Handle pending build actions from ReadingMode (refresh/retry projection)
  useEffect(() => {
    const action = useAppStore.getState().pendingBuildAction;
    if (!action || !channelRef.current) return;

    let text: string;
    if (action === "refresh_projection") {
      text = "请刷新阅读投影";
    } else {
      text = "请重试投影重建";
    }

    // Clear pending action and send
    useAppStore.getState().setPendingBuildAction(null);
    void sendMessage(channelRef.current, text).then(() => setLoading(true));
  }, []);

  const handleSend = async (
    messageText: string = inputText,
    options: { generateMicroPlan?: boolean } = {},
  ) => {
    const text = messageText.trim();
    if (!text || !channelRef.current) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    if (messageText === inputText) setInputText("");
    setLoading(true);

    const behaviorId = pendingAnswerBid;
    setPendingAnswerBid(null);

    try {
      await sendMessage(
        channelRef.current,
        text,
        context.workId,
        behaviorId,
        options.generateMicroPlan ?? false,
      );
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
        artifact.artifact_type,
      );
      const title =
        typeof artifact.payload.title === "string"
          ? artifact.payload.title
          : artifact.artifact_id;

      // Update context when Work is adopted (persist work_id for subsequent messages)
      if (artifact.artifact_type === "work" && typeof artifact.payload.title === "string") {
        setContext({
          workId: artifact.artifact_id,
          workTitle: artifact.payload.title,
        });
      }

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

  const handleAvailableAction = async (turnResult: TurnResult, action: AvailableActionLike) => {
    if (!channelRef.current || action.enabled === false) return;

    try {
      await sendAuthorAction(
        channelRef.current,
        toAuthorActionPayload(turnResult.turn_id, action),
      );
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "操作失败，请重试。" },
      ]);
    }
  };

  const actionLabel = (action: AvailableActionLike) => {
    if (action.action_type === "confirm_before_execute") return "确认执行";
    if (action.action_type === "reject_or_cancel_confirmation") return "拒绝";
    if (action.action_type === "cancel_pending_behavior") return "取消";
    if (action.action_type === "answer_clarification") return "回答";
    return action.action_type;
  };

  const handlePanelAction = (actionType: string, artifactId?: string) => {
    if (actionType === "init_intent") {
      void handleSend("我想调整或新增伏笔", { generateMicroPlan: true });
    } else if (actionType === "revise" && artifactId) {
      void handleSend(`我想修改设定 ${artifactId}，我的想法是：`);
    } else {
      console.warn("Panel action ignored:", actionType, artifactId);
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
    <div className={styles.workbench} data-slice-verify="workspace-chat">
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
          <div
            className={styles.riskBadge}
            data-status={llmConnected === true ? "ok" : "warn"}
            style={{
              backgroundColor:
                llmConnected === null ? 'var(--foreground-secondary)' :
                llmConnected ? 'var(--accent)' : '#d94a4a'
            }}
            title={llmConnected ? `模型: ${llmModel}` : "请检查 LM Studio 是否已启动并加载模型"}
          >
            LLM: {llmConnected === null ? "检测中…" : llmConnected ? "已连接" : "未连接"}
          </div>
          <div 
            className={styles.riskBadge}
            data-status={socketConnected ? "ok" : "error"}
            data-slice-verify="service-status"
            style={{ backgroundColor: socketConnected ? 'var(--accent)' : 'var(--foreground-secondary)' }}
          >
            服务: {socketConnected ? "已连接" : "离线"}
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
                data-role={msg.role}
                className={
                  msg.role === "user" ? styles.userMsg : styles.assistantMsg
                }
              >
                <div className={styles.role}>
                  {msg.role === "user" ? "你" : "AI"}
                </div>
                <div className={styles.text}>{msg.text}</div>

                {msg.turnResult?.ui_cards?.map((card, ci) => {
                  const handleAction = (_actionId: string, targetRef: string, actionType?: string) => {
                    if (actionType === "answer") {
                      setPendingAnswerBid(targetRef);
                      const input = document.querySelector<HTMLInputElement>(`.${styles.inputBox}`);
                      input?.focus();
                      return;
                    }
                    if (actionType === "discard" && channelRef.current) {
                      const pending = msg.turnResult?.adoption_state?.pending ?? [];
                      const artifact = pending.find((a) => a.artifact_id === targetRef);
                      void discardArtifact(channelRef.current, targetRef, artifact?.artifact_type);
                      return;
                    }
                    if (actionType === "edit_then_accept") {
                      const pending = msg.turnResult?.adoption_state?.pending ?? [];
                      const artifact = pending.find((a) => a.artifact_id === targetRef);
                      if (artifact && channelRef.current) {
                        setModifyInstruction("");
                        setModifyModal({
                          artifact,
                          action: () => {
                            if (modifyInstruction.trim() && channelRef.current) {
                              void modifyDraft(
                                channelRef.current,
                                artifact.artifact_id,
                                artifact.revision_base as number | undefined,
                                (artifact.payload?.content as string) ?? "",
                                modifyInstruction.trim(),
                              );
                            }
                            setModifyModal(null);
                          },
                        });
                      }
                      return;
                    }
                    const pending = msg.turnResult?.adoption_state?.pending ?? [];
                    const artifact = pending.find((a) => a.artifact_id === targetRef);
                    if (artifact && actionType === "accept") {
                      void handleAdopt(artifact);
                      return;
                    }

                    const authorizedAction = findAuthorizedAction(
                      msg.turnResult?.available_actions ?? [],
                      {
                        action_id: _actionId,
                        action_type: actionType,
                        target_ref: targetRef,
                      },
                    );

                    if (authorizedAction && msg.turnResult) {
                      void handleAvailableAction(msg.turnResult, authorizedAction);
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
                    case "checkpoint_card":
                      return <CheckpointCard key={ci} card={card} onAction={handleAction} />;
                    case "result_card":
                      return <ResultCard key={ci} card={card} onAction={handleAction} />;
                    case "failure_card":
                      return <FailureCard key={ci} card={card} onAction={handleAction} />;
                    case "escalation_card":
                      return <EscalationCard key={ci} card={card} onAction={handleAction} />;
                    default:
                      return <DefaultCard key={ci} card={card} onAction={handleAction} />;
                  }
                })}

                {msg.turnResult?.candidate_directions && msg.turnResult.candidate_directions.length > 0 && (
                  <div className={styles.candidatePanel}>
                    <div className={styles.candidateHeader}>候选创作方向</div>
                    <div className={styles.candidateList}>
                      {msg.turnResult.candidate_directions.map((c) => (
                        <div key={c.direction_id} className={styles.candidateCard}>
                          <div className={styles.candidateTitle}>{c.title}</div>
                          <div className={styles.candidatePitch}>{c.pitch}</div>
                          {c.tone_tags && c.tone_tags.length > 0 && (
                            <div className={styles.candidateTags}>
                              {c.tone_tags.map((t) => (
                                <span key={t} className={styles.tag}>{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {msg.turnResult?.available_actions && msg.turnResult.available_actions.length > 0 && (
                  <div className={styles.cardActions}>
                    {msg.turnResult.available_actions.map((action) => (
                      <button
                        key={action.action_id}
                        className={styles.btnSecondary}
                        data-slice-verify="available-action"
                        data-action-type={action.action_type}
                        disabled={action.enabled === false}
                        title={action.disabled_reason}
                        onClick={() => {
                          if (msg.turnResult) {
                            void handleAvailableAction(msg.turnResult, action);
                          }
                        }}
                      >
                        {actionLabel(action)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className={styles.assistantMsg} data-status="thinking" data-role="assistant">
                <div className={styles.role}>AI</div>
                <div className={styles.text}>思考中...</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区域 (Input Area) */}
          <div className={styles.inputArea}>
            <input
              type="text"
              className={styles.inputBox}
              data-slice-verify="chat-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入指令或继续创作...（例如：我想创建一部玄幻小说）"
              disabled={!socketConnected || isPanelOpen}
            />
            <button
              className={styles.sendBtn}
              data-slice-verify="send-button"
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
                data-slice-verify="open-archive"
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

      {/* Modify Draft Modal */}
      {modifyModal && (
        <div className={styles.modalOverlay} onClick={() => setModifyModal(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3>修改草稿</h3>
            <textarea
              className={styles.modalTextarea}
              value={modifyInstruction}
              onChange={(e) => setModifyInstruction(e.target.value)}
              placeholder="请输入修改意见，例如：把主角的性格改得更果断一些..."
              rows={4}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setModifyModal(null)}>取消</button>
              <button className={styles.btnPrimary} onClick={() => modifyModal.action()}>提交修改</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
