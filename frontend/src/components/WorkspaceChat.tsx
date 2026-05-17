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
  reportSliceVerifyUiState,
  adopt,
  discardArtifact,
  modifyDraft,
  getToc,
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
  resumeWorkspace,
  searchSessions,
  transcriptToMessages,
  type WorkSessionDto,
} from "../lib/sessions";
import {
  findAuthorizedAction,
  toAuthorActionPayload,
  type AvailableActionLike,
} from "../lib/workbenchActions";
import { OPEN_READING_MODE_ACTION_ID } from "../lib/adoptionDecision";
import {
  adoptionDecisionForCard,
  deriveWorkspaceRuntimeState,
  disableResolvedArtifactActions,
  getPendingAdoptionCount,
  getVisibleWorkTitle,
  isArtifactResolved,
  shouldShowWelcomeMessage,
} from "../lib/workspaceRuntimeState";
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
  type AdoptionDecisionData,
  type UICardData,
} from "./UICards";
import { StructurePanel } from "./StructurePanel";
import { useAppStore } from "../lib/store";
import { isTauri } from "../lib/env";
import { WORKBENCH } from "../lib/copy";

import styles from "./WorkspaceChat.module.css";

interface TurnResult {
  schema_version: string;
  turn_id: string;
  parent_turn_id?: string | null;
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
  source_turn_ref?: string | null;
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

const sliceVerifyAutorunStarted = new Set<string>();
const sliceVerifyAdoptionStarted = new Set<string>();
const sliceVerifyUiReported = new Set<string>();

function isArtifactResolutionAction(actionType?: string): boolean {
  return actionType === "accept" || actionType === "discard" || actionType === "edit_then_accept";
}

function startupFailureMessage(detail: string): ChatMessage {
  return {
    role: "assistant",
    text: `${WORKBENCH.startupFailurePrefix}\n\n${detail}`,
  };
}

export function WorkspaceChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [llmConnected, setLlmConnected] = useState<boolean | null>(null);
  const [llmModel, setLlmModel] = useState<string>("");
  const [modifyModal, setModifyModal] = useState<{ artifact: ArtifactEntry; sourceTurnRef?: string } | null>(null);
  const [modifyInstruction, setModifyInstruction] = useState("");
  const [pendingAnswerBid, setPendingAnswerBid] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WorkSessionDto[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [resumePendingAdoptions, setResumePendingAdoptions] = useState<ArtifactEntry[]>([]);
  const [resumeResolvedAdoptions, setResumeResolvedAdoptions] = useState<ArtifactEntry[]>([]);
  const [transcriptRestored, setTranscriptRestored] = useState(false);

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
  const sliceVerifyContinuationRef = useRef(false);
  const sliceVerifyAdoptionRef = useRef(false);
  const sliceVerifyFollowUpRoutingRef = useRef(false);
  const resumeRestoredTranscriptRef = useRef(false);

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
    const autorunSlice = import.meta.env.VITE_SLICE_VERIFY_AUTORUN as string | undefined;

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

    if (
      isTauri &&
      import.meta.env.VITE_SLICE_VERIFY_AUTORUN === "au01-ordinary-chat-two-turn-roundtrip" &&
      !sliceVerifyContinuationRef.current
    ) {
      sliceVerifyContinuationRef.current = true;
      window.setTimeout(() => {
        setInputText("继续说说还有什么方向");
        window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="send-button"]')
            ?.click();
        }, 150);
      }, 250);
    }

    if (
      isTauri &&
      (autorunSlice === "au05-adoption-boundary" ||
        autorunSlice === "au05-discard-boundary" ||
        autorunSlice === "au05-modify-draft-boundary" ||
        autorunSlice === "au05-adoption-followup-routing" ||
        autorunSlice === "au08-adoption-reading-projection") &&
      !sliceVerifyAdoptionRef.current &&
      !sliceVerifyAdoptionStarted.has(autorunSlice) &&
      (result.adoption_state?.pending?.length ?? 0) > 0
    ) {
      sliceVerifyAdoptionRef.current = true;
      sliceVerifyAdoptionStarted.add(autorunSlice);
      const actionType =
        import.meta.env.VITE_SLICE_VERIFY_AUTORUN === "au05-discard-boundary"
          ? "discard"
          : import.meta.env.VITE_SLICE_VERIFY_AUTORUN === "au05-modify-draft-boundary"
            ? "edit_then_accept"
            : "accept";
      window.setTimeout(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-slice-verify="card-action"][data-action-type="${actionType}"]`,
          )
          ?.click();

        if (actionType === "edit_then_accept") {
          window.setTimeout(() => {
            setModifyInstruction("把角色动机改得更果断，并强调保护同伴。");
            window.setTimeout(() => {
              document
                .querySelector<HTMLButtonElement>('[data-slice-verify="modify-submit"]')
                ?.click();
            }, 150);
          }, 150);
        }
      }, 250);
    }

    if (
      isTauri &&
      import.meta.env.VITE_SLICE_VERIFY_AUTORUN === "au08-adoption-reading-projection" &&
      result.adoption_state?.resolved?.some((artifact) =>
        artifact.adoption_status === "ACCEPTED" || artifact.adoption_status === "EDITED_ACCEPTED",
      )
    ) {
      window.setTimeout(() => setMode("reading"), 250);
    }

    if (
      isTauri &&
      import.meta.env.VITE_SLICE_VERIFY_AUTORUN === "au05-adoption-followup-routing" &&
      !sliceVerifyFollowUpRoutingRef.current &&
      !sliceVerifyUiReported.has("au05-adoption-followup-routing")
    ) {
      const resolved = result.adoption_state?.resolved?.find((artifact) =>
        artifact.adoption_status === "ACCEPTED" || artifact.adoption_status === "EDITED_ACCEPTED",
      );

      if (resolved && channelRef.current) {
        sliceVerifyFollowUpRoutingRef.current = true;
        sliceVerifyUiReported.add("au05-adoption-followup-routing");
        window.setTimeout(() => {
          const report = async () => {
            const currentContext = useAppStore.getState().context;
            const currentSocketConnected = useAppStore.getState().socketConnected;
            const toc = currentContext.workId && channelRef.current
              ? await getToc(channelRef.current, currentContext.workId)
              : { volumes: [] };
            const readingChapterCount = toc.volumes.flatMap((volume) => volume.chapters).length;

            await reportSliceVerifyUiState(channelRef.current!, {
              slice_id: "au05-adoption-followup-routing",
              context_work_id: currentContext.workId,
              context_work_title: deriveWorkspaceRuntimeState({
                connection: { connected: currentSocketConnected },
                work: { id: currentContext.workId, title: currentContext.workTitle },
              }).work.title,
              active_session_id: activeSessionId,
              restored_turn_id: result.parent_turn_id ?? result.turn_id,
              socket_connected: currentSocketConnected,
              message_count: messages.length + 1,
              welcome_message_count: messages.filter((message) =>
                message.text.includes("欢迎使用 AI Novel Studio"),
              ).length,
              pending_adoption_count: document.querySelectorAll('[data-slice-verify="card-action"][data-action-type="accept"]').length,
              first_message_text: messages[0]?.text ?? "",
              service_status_text:
                document.querySelector<HTMLElement>('[data-slice-verify="service-status"]')
                  ?.innerText ?? "",
              title_text:
                document.querySelector<HTMLElement>('[data-slice-verify="work-title"]')
                  ?.innerText ?? "",
              adoption_status: resolved.adoption_status,
              artifact_type: resolved.artifact_type,
              decision_card_count:
                document.querySelectorAll('[data-slice-verify="adoption-decision-card"]').length,
              open_reading_action_count:
                document.querySelectorAll('[data-slice-verify="open-reading-from-adoption-decision"]').length,
              reading_chapter_count: readingChapterCount,
            });
          };

          void report().catch(() => undefined);
        }, 500);
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
      let work: WorkDto;
      try {
        const works = await listWorks();
        const initialId = pickInitialWorkId(works, await getLastOpenedWorkId());
        if (initialId) {
          const selected = works.find((w) => w.id === initialId);
          if (!selected) throw new Error(`selected work not found: ${initialId}`);
          work = selected;
        } else {
          // No works yet — bootstrap a placeholder so the user lands in a
          // valid context. They can rename it later via the work-management
          // UI (next slice).
          work = await createWork({ title: "未命名作品" });
        }
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        setSocketConnected(false);
        setContext({ workId: null, workTitle: "作品加载失败", volumeTitle: null });
        setMessages([startupFailureMessage(`${WORKBENCH.startupFailureLoadWork}${detail}`)]);
        return;
      }
      if (cancelled) return;

      const workId = work.id;
      let workTitle = work.title;
      let sessionId: string | null = null;
      void setLastOpenedWorkId(workId);

      try {
        const snapshot = await resumeWorkspace(work.id);
        const restoredMessages = transcriptToMessages(snapshot.transcript) as ChatMessage[];
        sessionId = snapshot.active_session.id;
        workTitle = snapshot.work.title || workTitle;
        setActiveSessionId(sessionId);
        setSessions(snapshot.sessions);
        setResumePendingAdoptions(snapshot.pending_adoptions as unknown as ArtifactEntry[]);
        setResumeResolvedAdoptions(snapshot.resolved_adoptions as unknown as ArtifactEntry[]);
        setMessages(restoredMessages);
        resumeRestoredTranscriptRef.current = restoredMessages.length > 0;
        setTranscriptRestored(restoredMessages.length > 0);
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        setActiveSessionId(null);
        setSessions([]);
        setResumePendingAdoptions([]);
        setResumeResolvedAdoptions([]);
        setTranscriptRestored(false);
        setSocketConnected(false);
        setContext({ workId, workTitle, volumeTitle: null });
        setMessages([startupFailureMessage(`${WORKBENCH.startupFailureResumeSession}${detail}`)]);
        return;
      }

      const socket = createSocket();
      socket.connect();
      socketRef.current = socket;

      const channel = joinWorkspace(socket, "workspace:lobby", {
        work_id: workId,
        session_id: sessionId,
      });
      channelRef.current = channel;
      setChannel(channel);

      channel
        .join()
        .receive("ok", (response: { work_id?: string; session_id?: string }) => {
          const joinedWorkId = response.work_id ?? workId;
          const joinedSessionId = response.session_id ?? sessionId;
          if (joinedWorkId !== workId || joinedSessionId !== sessionId) {
            setSocketConnected(false);
            setMessages([
              startupFailureMessage(
                `${WORKBENCH.startupFailureJoinMismatch}work=${joinedWorkId}, session=${joinedSessionId}`,
              ),
            ]);
            channel.leave();
            socket.disconnect();
            return;
          }
          if (joinedSessionId) setActiveSessionId(joinedSessionId);
          void setLastOpenedWorkId(joinedWorkId);
          setSocketConnected(true);
          setMessages((prev) => {
            const startupRuntime = deriveWorkspaceRuntimeState({
              connection: { connected: true },
              work: { id: joinedWorkId, title: workTitle },
              session: {
                id: joinedSessionId,
                transcriptRestored: resumeRestoredTranscriptRef.current,
              },
              transcript: prev,
            });
            if (!shouldShowWelcomeMessage(startupRuntime)) return prev;
            return [
              {
                role: "assistant",
                text: "欢迎使用 AI Novel Studio！\n\n本产品需要连接大语言模型（LLM）才能工作。\n请确保 LM Studio 已启动并加载模型（默认端口 1234）。\n\n你可以这样开始：\n• 「我想创建一部玄幻小说」\n• 「写一本都市小说，核心卖点是商战复仇」\n• 「帮我创作一部科幻小说，目标读者是大学生」\n\n输入你的想法，我们开始创作吧！",
              },
            ];
          });

          // VS-09: real work context, no longer mock_work_123
          setContext({
            workId: joinedWorkId,
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

  const runtimeState = deriveWorkspaceRuntimeState({
    connection: { connected: socketConnected },
    work: {
      id: context.workId,
      title: context.workTitle,
      status: context.workTitle === "作品加载失败" ? "failed" : undefined,
    },
    session: {
      id: activeSessionId,
      transcriptRestored,
    },
    transcript: messages,
    adoptionState: {
      pending: messages
        .flatMap((msg) => msg.turnResult?.adoption_state?.pending ?? [])
        .concat(resumePendingAdoptions),
      resolved: messages
        .flatMap((msg) => msg.turnResult?.adoption_state?.resolved ?? [])
        .concat(resumeResolvedAdoptions),
    },
    task: { status: longRun.status },
  });
  const allPendingAdoptions = runtimeState.adoption.pendingArtifacts as ArtifactEntry[];
  const pendingAdoptionsCount = getPendingAdoptionCount(runtimeState);
  const visibleWorkTitle = getVisibleWorkTitle(runtimeState);
  const hasValidRuntimeWork = runtimeState.work.hasValidWork;
  const connectionLabel = runtimeState.ui.connectionLabel;

  useEffect(() => {
    if (!isTauri) return;
    const autorunSlice = import.meta.env.VITE_SLICE_VERIFY_AUTORUN as string | undefined;
    if (
      autorunSlice !== "vs10-observability-spine" &&
      autorunSlice !== "au10-micro-plan-entry" &&
      autorunSlice !== "au10-ordinary-chat-no-micro-plan" &&
      autorunSlice !== "au01-ordinary-chat-two-turn-roundtrip" &&
      autorunSlice !== "au05-adoption-boundary" &&
      autorunSlice !== "au05-discard-boundary" &&
      autorunSlice !== "au05-modify-draft-boundary" &&
      autorunSlice !== "au05-adoption-followup-routing" &&
      autorunSlice !== "au08-adoption-reading-projection" &&
      autorunSlice !== "stage-startup-context-contract" &&
      autorunSlice !== "workspace-runtime-state" &&
      autorunSlice !== "au03c-work-session-resume"
    ) return;
    if (!socketConnected || sliceVerifyAutorunRef.current) return;
    if (sliceVerifyAutorunStarted.has(autorunSlice)) return;
    if (autorunSlice === "au03c-work-session-resume" && transcriptRestored) return;
    if (autorunSlice === "stage-startup-context-contract" || autorunSlice === "workspace-runtime-state") {
      if (!transcriptRestored) return;
      if (!hasValidRuntimeWork || !activeSessionId || !channelRef.current) return;

      sliceVerifyAutorunRef.current = true;
      const timer = window.setTimeout(() => {
        if (autorunSlice === "workspace-runtime-state") {
          setMode("reading");
        }
      }, 100);
      const reportTimer = window.setTimeout(() => {
        const restoredTurnId =
          messages.find((message) => typeof message.turnResult?.turn_id === "string")?.turnResult
            ?.turn_id ?? null;
        const titleText =
          (autorunSlice === "workspace-runtime-state"
            ? document.querySelector<HTMLElement>('[data-slice-verify="reading-work-title"]')?.innerText
            : document.querySelector<HTMLElement>('[data-slice-verify="work-title"]')?.innerText) ?? "";
        const serviceStatusText =
          document.querySelector<HTMLElement>('[data-slice-verify="service-status"]')?.innerText ?? "";
        const welcomeMessageCount = messages.filter((message) =>
          message.text.includes("欢迎使用 AI Novel Studio"),
        ).length;

        const report = async () => {
          const toc = context.workId && channelRef.current
            ? await getToc(channelRef.current, context.workId)
            : { volumes: [] };
          const readingChapterCount = toc.volumes.flatMap((volume) => volume.chapters).length;

          await reportSliceVerifyUiState(channelRef.current!, {
            slice_id: autorunSlice,
            context_work_id: context.workId,
            context_work_title: visibleWorkTitle,
            active_session_id: activeSessionId,
            restored_turn_id: restoredTurnId,
            socket_connected: socketConnected,
            message_count: messages.length,
            welcome_message_count: welcomeMessageCount,
            pending_adoption_count: pendingAdoptionsCount,
            first_message_text: messages[0]?.text ?? "",
            service_status_text: serviceStatusText,
            title_text: titleText,
            decision_card_count:
              document.querySelectorAll('[data-slice-verify="adoption-decision-card"]').length,
            reading_chapter_count: readingChapterCount,
          });
        };

        void report().catch(() => undefined);
      }, autorunSlice === "workspace-runtime-state" ? 700 : 250);

      return () => {
        window.clearTimeout(timer);
        window.clearTimeout(reportTimer);
      };
    }

    sliceVerifyAutorunRef.current = true;
    sliceVerifyAutorunStarted.add(autorunSlice);
    const timers: number[] = [];

    if (autorunSlice === "au08-adoption-reading-projection") {
      timers.push(window.setTimeout(() => {
        const text = "请写一段开场正文片段";
        setMessages((prev) => [...prev, { role: "user", text }]);
        setLoading(true);
        if (channelRef.current) {
          void sendMessage(channelRef.current, text, context.workId, null, activeSessionId, true);
        }
      }, 150));
    } else if (autorunSlice === "au05-adoption-followup-routing") {
      timers.push(window.setTimeout(() => {
        const text = "请生成一个角色设定草案";
        setMessages((prev) => [...prev, { role: "user", text }]);
        setLoading(true);
        if (channelRef.current) {
          void sendMessage(channelRef.current, text, context.workId, null, activeSessionId, true);
        }
      }, 150));
    } else if (
      autorunSlice === "au10-ordinary-chat-no-micro-plan" ||
      autorunSlice === "au01-ordinary-chat-two-turn-roundtrip"
    ) {
      timers.push(window.setTimeout(() => {
        setInputText("你好，我想聊聊小说创作");
        timers.push(window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="send-button"]')
            ?.click();
        }, 150));
      }, 150));
    } else {
      timers.push(window.setTimeout(() => {
        setIsPanelOpen(true);
        timers.push(window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="panel-new-action"]')
            ?.click();
        }, 150));
      }, 150));
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [activeSessionId, context.workId, hasValidRuntimeWork, messages, pendingAdoptionsCount, setMode, socketConnected, transcriptRestored, visibleWorkTitle]);

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
    void sendMessage(channelRef.current, text, context.workId, null, activeSessionId).then(() => setLoading(true));
  }, [activeSessionId, context.workId]);

  async function handleSend(
    messageText: string = inputText,
    options: { generateMicroPlan?: boolean } = {},
  ) {
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
        activeSessionId,
        options.generateMicroPlan ?? false,
      );
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "发送失败，请重试。" },
      ]);
      setLoading(false);
    }
  }

  const handleAdopt = async (artifact: ArtifactEntry, sourceTurnRef?: string | null) => {
    if (!channelRef.current) return;
    try {
      const result = await adopt(
        channelRef.current,
        artifact.artifact_id,
        parseRevisionBase(artifact.revision_base),
        artifact.payload,
        artifact.artifact_type,
        sourceTurnRef ?? artifact.source_turn_ref ?? null,
      );

      // Update context when Work is adopted (persist work_id for subsequent messages)
      if (artifact.artifact_type === "work" && typeof artifact.payload.title === "string") {
        setContext({
          workId: artifact.artifact_id,
          workTitle: artifact.payload.title,
        });
      }

      if (result.action_status !== "accepted") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "采纳未完成，请查看系统提示后重试。" },
        ]);
      }
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

  const handleModifySubmit = async () => {
    if (!channelRef.current || !modifyModal) return;
    const instruction = modifyInstruction.trim();
    if (!instruction) return;

    const { artifact, sourceTurnRef } = modifyModal;
    await modifyDraft(
      channelRef.current,
      artifact.artifact_id,
      artifact.revision_base as number | undefined,
      (artifact.payload?.content as string) ?? "",
      instruction,
      artifact.artifact_type,
      sourceTurnRef,
    );
    setModifyModal(null);
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

  const handleSessionSearch = async (query: string) => {
    setSessionSearch(query);
    if (!context.workId || context.workId === "lobby") return;

    try {
      const result = await searchSessions(context.workId, query);
      setSessions(result);
    } catch {
      setSessions([]);
    }
  };

  return (
    <div className={styles.workbench} data-slice-verify="workspace-chat">
      {/* 顶部上下文栏 (Top Context Bar) */}
      <div className={styles.topBar}>
        <div className={styles.contextGroup}>
          <span className={styles.titleText} data-slice-verify="work-title">
            {visibleWorkTitle}
          </span>
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
            服务: {connectionLabel}
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
                    if (isArtifactResolutionAction(actionType) && isArtifactResolved(runtimeState, targetRef)) {
                      return;
                    }

                    if (_actionId === OPEN_READING_MODE_ACTION_ID) {
                      setMode("reading");
                      return;
                    }

                    if (actionType === "answer") {
                      setPendingAnswerBid(targetRef);
                      const input = document.querySelector<HTMLInputElement>(`.${styles.inputBox}`);
                      input?.focus();
                      return;
                    }
                    if (actionType === "discard" && channelRef.current) {
                      const pending = msg.turnResult?.adoption_state?.pending ?? [];
                      const artifact = pending.find((a) => a.artifact_id === targetRef);
                      void discardArtifact(
                        channelRef.current,
                        targetRef,
                        artifact?.artifact_type,
                        msg.turnResult?.turn_id,
                      );
                      return;
                    }
                    if (actionType === "edit_then_accept") {
                      const pending = msg.turnResult?.adoption_state?.pending ?? [];
                      const artifact = pending.find((a) => a.artifact_id === targetRef);
                      if (artifact && channelRef.current) {
                        setModifyInstruction("");
                        setModifyModal({
                          artifact,
                          sourceTurnRef: msg.turnResult?.turn_id,
                        });
                      }
                      return;
                    }
                    const pending = msg.turnResult?.adoption_state?.pending ?? [];
                    const artifact = pending.find((a) => a.artifact_id === targetRef);
                    if (artifact && actionType === "accept") {
                      void handleAdopt(artifact, msg.turnResult?.turn_id);
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
                  const cardForRender = disableResolvedArtifactActions(runtimeState, card);
                  const adoptionDecision =
                    cardForRender.card_type === "adoption_card"
                      ? adoptionDecisionForCard(runtimeState, cardForRender) as AdoptionDecisionData | null
                      : null;

                  switch (cardForRender.card_type) {
                    case "clarification_card":
                      return <ClarificationCard key={ci} card={cardForRender} onAction={handleAction} />;
                    case "confirmation_card":
                      return <ConfirmationCard key={ci} card={cardForRender} onAction={handleAction} />;
                    case "warning_card":
                      return <WarningCard key={ci} card={cardForRender} onAction={handleAction} />;
                    case "adoption_card":
                      return (
                        <AdoptionCard
                          key={ci}
                          card={cardForRender}
                          adoptionDecision={adoptionDecision}
                          onAction={handleAction}
                        />
                      );
                    case "progress_card":
                      return <ProgressCard key={ci} card={cardForRender} onAction={handleAction} />;
                    case "checkpoint_card":
                      return <CheckpointCard key={ci} card={cardForRender} onAction={handleAction} />;
                    case "result_card":
                      return <ResultCard key={ci} card={cardForRender} onAction={handleAction} />;
                    case "failure_card":
                      return <FailureCard key={ci} card={cardForRender} onAction={handleAction} />;
                    case "escalation_card":
                      return <EscalationCard key={ci} card={cardForRender} onAction={handleAction} />;
                    default:
                      return <DefaultCard key={ci} card={cardForRender} onAction={handleAction} />;
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
                <div className={styles.spItemTitle}>
                  待采纳 {pendingAdoptionsCount}
                </div>
              )}
              <div className={styles.sessionList} data-slice-verify="session-list">
                <input
                  className={styles.sessionSearch}
                  data-slice-verify="session-search"
                  value={sessionSearch}
                  onChange={(event) => {
                    void handleSessionSearch(event.target.value);
                  }}
                  placeholder="搜索会话"
                />
                {sessions.slice(0, 5).map((session) => (
                  <div
                    key={session.id}
                    className={session.id === activeSessionId ? styles.sessionItemActive : styles.sessionItem}
                    data-slice-verify="session-item"
                    data-session-status={session.status}
                  >
                    <span className={styles.sessionTitle}>{session.title}</span>
                    <span className={styles.sessionStatus}>{session.status}</span>
                  </div>
                ))}
              </div>
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
              data-slice-verify="modify-instruction"
              value={modifyInstruction}
              onChange={(e) => setModifyInstruction(e.target.value)}
              placeholder="请输入修改意见，例如：把主角的性格改得更果断一些..."
              rows={4}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setModifyModal(null)}>取消</button>
              <button
                className={styles.btnPrimary}
                data-slice-verify="modify-submit"
                onClick={() => {
                  void handleModifySubmit();
                }}
              >
                提交修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
