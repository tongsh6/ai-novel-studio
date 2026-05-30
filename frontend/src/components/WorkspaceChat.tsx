// Design: docs/design-v2/ui-design/41-workbench-layout.md §2 (3-zone workbench)
// Design: docs/design-v2/ui-design/42-card-system.md §2 (card type to ADR-0006 mapping)
// Prototype: novel-studio-v2.pen → 41§3-main-workbench (ZOwOi)
import { useEffect, useState, useRef } from "react";
import type { Channel } from "phoenix";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, BookOpen, Bot, ChevronDown, CircleHelp, MessageCircle, Plus, RefreshCw, RotateCcw } from "lucide-react";

import {
  createSocket,
  joinWorkspace,
  sendMessage,
  sendAuthorAction,
  onTaskState,
  type TaskStateData,
} from "../lib/socket";
import {
  listWorks,
  createWork,
  pickInitialWorkId,
  getLastOpenedWorkId,
  setLastOpenedWorkId,
  isCurrentWorkConnection,
  type WorkDto,
} from "../lib/works";
import {
  resumeWorkspace,
  searchSessions,
  getSessionSnapshot,
  createWorkSession,
  archiveWorkSession,
  transcriptToMessages,
  type WorkSessionDto,
} from "../lib/sessions";
import {
  filterVisibleAvailableActions,
  findAvailableActionForTarget,
  toAuthorActionPayload,
  type AvailableActionLike,
} from "../lib/workbenchActions";
import {
  deriveWorkspaceRuntimeState,
  getPendingAdoptionCount,
  getVisibleWorkTitle,
  shouldShowWelcomeMessage,
} from "../lib/workspaceRuntimeState";
import {
  ClarificationCard,
  ConfirmationCard,
  WarningCard,
  ProgressCard,
  CheckpointCard,
  ResultCard,
  FailureCard,
  EscalationCard,
  CandidateSetCard,
  DefaultCard,
  type UICardData,
} from "./UICards";
import { StructurePanel } from "./StructurePanel";
import type {
  StructurePanelActionState,
  StructurePanelArtifactAction,
} from "./StructurePanel";
import { useAppStore } from "../lib/store";
import { getProviderHealth, providerHealthName } from "../lib/providerHealth";
import { CARD, MEMORY, TRACE, WORKBENCH } from "../lib/copy";
import { findCandidateAvailableAction } from "../lib/candidateSelection";
import {
  toAuthorTraceSummary,
  type TraceSummaryView,
} from "../lib/traceSummaryView";
import { framePresentationForSummary } from "../lib/framePresentation";
import {
  DEFAULT_ASSISTANT_DISPLAY_NAME,
  assistantRoleLabel,
  getAssistantDisplayName,
  resetAssistantDisplayName,
  setAssistantDisplayName,
} from "../lib/assistantDisplayName";

import styles from "./WorkspaceChat.module.css";

export interface TurnResult {
  schema_version: string;
  turn_id: string;
  parent_turn_id?: string | null;
  phase: string;
  status: string;
  next_action: string;
  assistant_message: { text: string };
  frame_summary?: {
    frame_type?: string;
    dialogue_goal?: string;
    uncertainty?: string[];
  };
  available_actions?: AvailableAction[];
  ui_cards?: UICardData[];
  candidate_directions?: CandidateDirection[];
  trace_summary?: Record<string, unknown>;
  adoption_state?: {
    pending: ArtifactEntry[];
    resolved: ArtifactEntry[];
  };
  behavior_state?: { active: Record<string, unknown> | null };
  projection_refs?: { projection_type: string; projection_id: string; source_revision_refs: string[]; refresh_status?: string | null }[];
  produced_at: string;
}

export interface AvailableAction extends AvailableActionLike {
  target_ref?: string;
}

export interface CandidateDirection {
  direction_id: string;
  title: string;
  pitch: string;
  tone_tags: string[];
  risk_hint?: "low" | "medium" | "high";
  adoption_status?: string;
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

export interface WorkspaceCandidatePanelProps {
  turnResult: TurnResult;
  candidates: CandidateDirection[];
  loading: boolean;
  socketConnected: boolean;
  onCandidateContinue: (turnResult: TurnResult, candidate: CandidateDirection) => void;
  onCandidateAdopt: (turnResult: TurnResult, action: AvailableActionLike) => void;
}

export function WorkspaceCandidatePanel({
  turnResult,
  candidates,
  loading,
  socketConnected,
  onCandidateContinue,
  onCandidateAdopt,
}: WorkspaceCandidatePanelProps) {
  return (
    <div className={styles.candidatePanel}>
      <div className={styles.candidateHeader}>{WORKBENCH.candidatePanelTitle}</div>
      <div className={styles.candidateList}>
        {candidates.map((candidate, candidateIndex) => {
          const candidateAction = findCandidateAvailableAction({
            availableActions: turnResult.available_actions ?? [],
            candidate,
            candidateIndex,
            candidateCount: candidates.length,
            sourceTurnRef: turnResult.turn_id,
          });
          const unavailableReason = candidateAction?.disabled_reason ?? WORKBENCH.actionUnavailable;
          const actionUnavailable =
            !candidateAction || candidateAction.enabled === false || !socketConnected;

          return (
            <div key={candidate.direction_id} className={styles.candidateCard}>
              <div className={styles.candidateTitle}>{candidate.title}</div>
              <div className={styles.candidatePitch}>{candidate.pitch}</div>
              {candidate.tone_tags && candidate.tone_tags.length > 0 && (
                <div className={styles.candidateTags}>
                  {candidate.tone_tags.map((tag) => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                </div>
              )}
              <div className={styles.candidateActions}>
                <button
                  className={styles.candidateButton}
                  disabled={loading || actionUnavailable}
                  title={actionUnavailable ? unavailableReason : WORKBENCH.candidateContinueTitle}
                  onClick={() => {
                    if (!candidateAction || candidateAction.enabled === false) return;
                    onCandidateContinue(turnResult, candidate);
                  }}
                >
                  <MessageCircle size={14} aria-hidden="true" />
                  <span>{WORKBENCH.candidateContinueLabel}</span>
                </button>
                {candidateAction && (
                  <button
                    className={styles.candidateButton}
                    disabled={loading || !socketConnected || candidateAction.enabled === false}
                    title={candidateAction.disabled_reason ?? WORKBENCH.candidateAdoptTitle}
                    onClick={() => {
                      if (candidateAction.enabled === false) return;
                      onCandidateAdopt(turnResult, candidateAction);
                    }}
                  >
                    <BookOpen size={14} aria-hidden="true" />
                    <span>{WORKBENCH.candidateAdoptLabel}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
  const [pendingAnswerBid, setPendingAnswerBid] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WorkSessionDto[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [readOnlySession, setReadOnlySession] = useState<WorkSessionDto | null>(null);
  const [readOnlySourceTurnRef, setReadOnlySourceTurnRef] = useState<string | null>(null);
  const [branchingSession, setBranchingSession] = useState(false);
  const [resumePendingAdoptions, setResumePendingAdoptions] = useState<ArtifactEntry[]>([]);
  const [resumeResolvedAdoptions, setResumeResolvedAdoptions] = useState<ArtifactEntry[]>([]);
  const [transcriptRestored, setTranscriptRestored] = useState(false);
  const [works, setWorks] = useState<WorkDto[]>([]);
  const [workMenuOpen, setWorkMenuOpen] = useState(false);
  const [workSwitchingId, setWorkSwitchingId] = useState<string | null>(null);
  const [assistantDisplayName, setAssistantDisplayNameState] = useState<string>(
    DEFAULT_ASSISTANT_DISPLAY_NAME,
  );
  const [assistantNameDialogOpen, setAssistantNameDialogOpen] = useState(false);
  const [assistantNameDraft, setAssistantNameDraft] = useState("");
  const [assistantNameSaving, setAssistantNameSaving] = useState(false);
  const [assistantNameError, setAssistantNameError] = useState<string | null>(null);
  const [traceDialog, setTraceDialog] = useState<{
    turnId: string;
    summary: TraceSummaryView;
  } | null>(null);
  const [editDialog, setEditDialog] = useState<{
    turnResult: TurnResult;
    action: AvailableAction;
    text: string;
  } | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

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
  const resumeRestoredTranscriptRef = useRef(false);
  const connectionTokenRef = useRef(0);
  const openWorkRef = useRef<(work: WorkDto) => Promise<void>>(() => Promise.resolve());
  const activeConnectionRef = useRef<{ token: number; workId: string | null }>({
    token: 0,
    workId: null,
  });
  const activeSessionIdRef = useRef<string | null>(null);

  // Check LLM connection status
  useEffect(() => {
    const checkLlm = async () => {
      try {
        const data = await getProviderHealth();
        setLlmConnected(data.connected);
        setLlmModel(providerHealthName(data));
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

  function closeWorkspaceConnection() {
    if (channelRef.current) {
      channelRef.current.leave();
      channelRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setChannel(null);
    setSocketConnected(false);
  }

  function resetWorkScopedRuntime(work: WorkDto) {
    setLoading(false);
    setPendingAnswerBid(null);
    setActiveSessionId(null);
    setReadOnlySession(null);
    setReadOnlySourceTurnRef(null);
    setBranchingSession(false);
    setSessions([]);
    setSessionSearch("");
    setResumePendingAdoptions([]);
    setResumeResolvedAdoptions([]);
    setTranscriptRestored(false);
    resumeRestoredTranscriptRef.current = false;
    setMessages([]);
    setAssistantDisplayNameState(DEFAULT_ASSISTANT_DISPLAY_NAME);
    setAssistantNameDraft("");
    setAssistantNameError(null);
    setContext({
      workId: work.id,
      workTitle: work.title,
      assistantDisplayName: DEFAULT_ASSISTANT_DISPLAY_NAME,
      volumeId: null,
      volumeTitle: "未定卷",
      chapterId: null,
      chapterTitle: null,
    });
    useAppStore.getState().setProjectionStatus(null);
    useAppStore.getState().setPendingBuildAction(null);
  }

  async function openWork(work: WorkDto) {
    const token = connectionTokenRef.current + 1;
    connectionTokenRef.current = token;
    activeConnectionRef.current = { token, workId: work.id };
    setWorkSwitchingId(work.id);
    closeWorkspaceConnection();
    resetWorkScopedRuntime(work);

    let workTitle = work.title;
    let sessionId: string | null = null;
    let activeAssistantDisplayName: string = DEFAULT_ASSISTANT_DISPLAY_NAME;

    try {
      const displayName = await getAssistantDisplayName(work.id);
      if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;
      activeAssistantDisplayName = displayName;
      setAssistantDisplayNameState(displayName);
      setAssistantNameDraft(displayName === DEFAULT_ASSISTANT_DISPLAY_NAME ? "" : displayName);
      setContext({ assistantDisplayName: displayName });

      const snapshot = await resumeWorkspace(work.id);
      if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;

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
      if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;
      const detail = error instanceof Error ? error.message : String(error);
      setMessages([startupFailureMessage(`${WORKBENCH.startupFailureResumeSession}${detail}`)]);
      setSocketConnected(false);
      setWorkSwitchingId(null);
      return;
    }

    if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;

    const socket = createSocket();
    socket.connect();
    socketRef.current = socket;

    const channel = joinWorkspace(socket, `workspace:${work.id}`, {
      work_id: work.id,
      session_id: sessionId,
    });
    channelRef.current = channel;
    setChannel(channel);

    channel
      .join()
      .receive("ok", (response: { work_id?: string; session_id?: string }) => {
        if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;

        const joinedWorkId = response.work_id ?? work.id;
        const joinedSessionId = response.session_id ?? sessionId;
        if (joinedWorkId !== work.id || joinedSessionId !== sessionId) {
          setSocketConnected(false);
          setWorkSwitchingId(null);
          setMessages([
            startupFailureMessage(
              `${WORKBENCH.startupFailureJoinMismatch}work=${joinedWorkId}, session=${joinedSessionId}`,
            ),
          ]);
          closeWorkspaceConnection();
          return;
        }
        if (joinedSessionId) setActiveSessionId(joinedSessionId);
        void setLastOpenedWorkId(joinedWorkId);
        setSocketConnected(true);
        setWorkSwitchingId(null);
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
              text: WORKBENCH.welcomeMessage,
            },
          ];
        });

        setContext({
          workId: joinedWorkId,
          workTitle,
          assistantDisplayName: activeAssistantDisplayName,
          volumeTitle: "未定卷",
        });
      })
      .receive("error", () => {
        if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;
        setSocketConnected(false);
        setWorkSwitchingId(null);
      })
      .receive("timeout", () => {
        if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;
        setSocketConnected(false);
        setWorkSwitchingId(null);
      });

    channel.on("turn_result", (result: TurnResult) => {
      if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;
      handleTurnResult(result);
    });
    onTaskState(channel, (state) => {
      if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;
      handleTaskState(state);
    });
  }

  useEffect(() => {
    openWorkRef.current = openWork;
  });

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  async function loadWorksAndOpenInitial() {
    try {
      let availableWorks = await listWorks();
      let initialId = pickInitialWorkId(availableWorks, await getLastOpenedWorkId());
      if (!initialId) {
        const created = await createWork({ title: WORKBENCH.unnamedWorkTitle });
        availableWorks = [created, ...availableWorks];
        initialId = created.id;
      }

      setWorks(availableWorks);
      const work = availableWorks.find((item) => item.id === initialId);
      if (!work) throw new Error(`selected work not found: ${initialId}`);
      await openWork(work);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      activeConnectionRef.current = { token: connectionTokenRef.current + 1, workId: null };
      setSocketConnected(false);
      setContext({
        workId: null,
        workTitle: "作品加载失败",
        assistantDisplayName: DEFAULT_ASSISTANT_DISPLAY_NAME,
        volumeTitle: null,
      });
      setMessages([startupFailureMessage(`${WORKBENCH.startupFailureLoadWork}${detail}`)]);
    }
  }

  useEffect(() => {
    const startupTimer = window.setTimeout(() => {
      void loadWorksAndOpenInitial();
    }, 0);

    return () => {
      window.clearTimeout(startupTimer);
      activeConnectionRef.current = {
        token: connectionTokenRef.current + 1,
        workId: null,
      };
      connectionTokenRef.current += 1;
      closeWorkspaceConnection();
    };

    // Connection setup owns the channel lifecycle; handlers are guarded by
    // connection tokens so stale async callbacks cannot mutate a new work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const isReadOnlySessionView = readOnlySession !== null;
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
      pending: isReadOnlySessionView
        ? []
        : messages
          .flatMap((msg) => msg.turnResult?.adoption_state?.pending ?? [])
          .concat(resumePendingAdoptions),
      resolved: isReadOnlySessionView
        ? []
        : messages
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
    if (!text || !channelRef.current || isReadOnlySessionView) return;

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
        { role: "assistant", text: WORKBENCH.sendFailure },
      ]);
      setLoading(false);
    }
  }

  const handleCandidateContinue = async (turnResult: TurnResult, candidate: CandidateDirection) => {
    if (!channelRef.current) return;
    const turnCandidates = turnResult.candidate_directions ?? [];
    const candidateIndex = turnCandidates.findIndex((item) => item.direction_id === candidate.direction_id);
    const action = findCandidateAvailableAction({
      availableActions: turnResult.available_actions ?? [],
      candidate,
      candidateIndex: candidateIndex >= 0 ? candidateIndex : undefined,
      candidateCount: turnCandidates.length,
      sourceTurnRef: turnResult.turn_id,
    });

    if (!action || action.enabled === false) {
      console.warn("Available action unavailable for candidate continuation", {
        candidateLookupId: candidate.direction_id,
        turnId: turnResult.turn_id,
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: action?.disabled_reason ?? WORKBENCH.actionUnavailable },
      ]);
      return;
    }

    await handleAvailableAction(turnResult, action);
  };

  const handleAvailableAction = async (
    turnResult: TurnResult,
    action: AvailableActionLike,
    authorPayload?: Record<string, unknown>,
  ) => {
    if (!channelRef.current || action.enabled === false) return;

    try {
      await sendAuthorAction(
        channelRef.current,
        toAuthorActionPayload(turnResult.turn_id, action, authorPayload),
      );
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: WORKBENCH.actionFailure },
      ]);
    }
  };

  // 从待采纳 artifact 取出可编辑的正文（payload.content 优先，否则拼接 items 正文）。
  const draftProseForAction = (turnResult: TurnResult, action: AvailableAction): string => {
    const artifact = (turnResult.adoption_state?.pending ?? []).find(
      (entry) => entry.artifact_id === action.target_ref,
    );
    const payload = artifact?.payload as
      | { content?: unknown; items?: { body?: unknown }[] }
      | undefined;
    if (typeof payload?.content === "string") return payload.content;
    if (Array.isArray(payload?.items)) {
      return payload.items
        .map((item) => (typeof item?.body === "string" ? item.body : ""))
        .filter(Boolean)
        .join("\n\n");
    }
    return "";
  };

  const submitEditThenAccept = async () => {
    if (!editDialog) return;
    const trimmed = editDialog.text.trim();
    if (trimmed === "") return;
    setEditSubmitting(true);
    try {
      await handleAvailableAction(editDialog.turnResult, editDialog.action, {
        edited_content: trimmed,
      });
      setEditDialog(null);
    } finally {
      setEditSubmitting(false);
    }
  };

  const actionLabel = (action: AvailableActionLike) => {
    if (action.action_type === "confirm_before_execute") return WORKBENCH.actionConfirm;
    if (action.action_type === "reject_or_cancel_confirmation") return WORKBENCH.actionReject;
    if (action.action_type === "cancel_pending_behavior") return WORKBENCH.actionCancel;
    if (action.action_type === "answer_clarification") return WORKBENCH.actionAnswer;
    if (action.action_type === "choose_candidate") return WORKBENCH.candidateAdoptLabel;
    if (action.action_type === "accept") return CARD.tentativeArtifact.acceptLabel;
    if (action.action_type === "discard") return CARD.tentativeArtifact.discardLabel;
    if (action.action_type === "edit_then_accept") return CARD.tentativeArtifact.editThenAcceptLabel;
    return action.action_type;
  };

  const handleVisibleAvailableAction = (turnResult: TurnResult, action: AvailableAction) => {
    // edit_then_accept 需要作者先编辑正文，打开编辑弹窗而不是直接提交。
    if (action.action_type === "edit_then_accept") {
      setEditDialog({ turnResult, action, text: draftProseForAction(turnResult, action) });
      return;
    }
    void handleAvailableAction(turnResult, action);
  };

  // 当前活跃行为 id：取最近一个携带 behavior_state 的 turn_result 的 active 行为。
  // 确认后采纳/取消会把 active 置空，确认按钮随之隐藏。
  const activeBehaviorId: string | null = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const behaviorState = messages[i].turnResult?.behavior_state;
      if (behaviorState !== undefined) {
        const behaviorId = behaviorState.active?.behavior_id;
        return typeof behaviorId === "string" ? behaviorId : null;
      }
    }
    return null;
  })();

  // 采纳类动作一旦目标 artifact 已被采纳/放弃就不再显示；确认类动作只在行为活跃时显示。
  const visibleAvailableActions = (turnResult: TurnResult): AvailableAction[] =>
    filterVisibleAvailableActions(
      turnResult.available_actions ?? [],
      runtimeState.adoption.pendingArtifactIds,
      activeBehaviorId,
    );

  const findArtifactAvailableAction = (
    artifact: ArtifactEntry,
    actionType: StructurePanelArtifactAction,
  ): { turnResult: TurnResult; action: AvailableActionLike } | null => {
    const sourceTurnRef = artifact.source_turn_ref;

    const turnResults = messages
      .map((msg) => msg.turnResult)
      .filter((turnResult): turnResult is TurnResult => Boolean(turnResult));

    const candidateTurns = sourceTurnRef
      ? turnResults.filter((turnResult) => turnResult.turn_id === sourceTurnRef)
      : turnResults;

    for (const turnResult of candidateTurns) {
      const action = findAvailableActionForTarget(turnResult.available_actions ?? [], {
        action_type: actionType,
        target_ref: artifact.artifact_id,
      });

      if (action) return { turnResult, action };
    }

    return null;
  };

  const artifactActionState = (
    artifact: ArtifactEntry,
    actionType: StructurePanelArtifactAction,
  ): StructurePanelActionState => {
    const match = findArtifactAvailableAction(artifact, actionType);
    if (!match) return { enabled: false, disabledReason: WORKBENCH.actionUnavailable };
    if (match.action.enabled === false) {
      return {
        enabled: false,
        disabledReason: match.action.disabled_reason ?? WORKBENCH.actionUnavailable,
      };
    }
    return { enabled: true, disabledReason: match.action.disabled_reason };
  };

  const submitArtifactAvailableAction = (
    artifact: ArtifactEntry,
    actionType: StructurePanelArtifactAction,
  ) => {
    const match = findArtifactAvailableAction(artifact, actionType);

    if (!match || match.action.enabled === false) {
      console.warn("Available action unavailable for artifact", {
        actionType,
        artifactId: artifact.artifact_id,
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: WORKBENCH.actionUnavailable },
      ]);
      return;
    }

    void handleAvailableAction(match.turnResult, match.action);
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

  const restoreActiveSessionView = async () => {
    if (!context.workId || context.workId === "lobby") return;

    try {
      const snapshot = await resumeWorkspace(context.workId);
      const restoredMessages = transcriptToMessages(snapshot.transcript) as ChatMessage[];
      setReadOnlySession(null);
      setReadOnlySourceTurnRef(null);
      setActiveSessionId(snapshot.active_session.id);
      setSessions(snapshot.sessions);
      setResumePendingAdoptions(snapshot.pending_adoptions as unknown as ArtifactEntry[]);
      setResumeResolvedAdoptions(snapshot.resolved_adoptions as unknown as ArtifactEntry[]);
      setMessages(restoredMessages);
      setTranscriptRestored(restoredMessages.length > 0);
      resumeRestoredTranscriptRef.current = restoredMessages.length > 0;
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sessionOpenFailure }]);
    }
  };

  const handleOpenSession = async (session: WorkSessionDto) => {
    if (!context.workId || context.workId === "lobby") return;

    if (session.id === activeSessionId && session.status === "ACTIVE") {
      await restoreActiveSessionView();
      return;
    }

    try {
      const snapshot = await getSessionSnapshot(context.workId, session.id);
      const restoredMessages = transcriptToMessages(snapshot.transcript) as ChatMessage[];
      const shouldOpenReadOnly = snapshot.read_only || snapshot.session.id !== activeSessionId;
      const sourceTurnRef = [...snapshot.transcript]
        .reverse()
        .find((entry) => typeof entry.turn_id === "string" && entry.turn_id.trim().length > 0)
        ?.turn_id ?? null;
      setReadOnlySession(shouldOpenReadOnly ? snapshot.session : null);
      setReadOnlySourceTurnRef(shouldOpenReadOnly ? sourceTurnRef : null);
      setMessages(restoredMessages);
      setResumePendingAdoptions(
        shouldOpenReadOnly ? [] : snapshot.pending_adoptions as unknown as ArtifactEntry[],
      );
      setResumeResolvedAdoptions(
        shouldOpenReadOnly ? [] : snapshot.resolved_adoptions as unknown as ArtifactEntry[],
      );
      setTranscriptRestored(restoredMessages.length > 0);
      resumeRestoredTranscriptRef.current = restoredMessages.length > 0;
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sessionOpenFailure }]);
    }
  };

  const handleBranchFromReadOnlySession = async () => {
    if (!context.workId || context.workId === "lobby" || !readOnlySession || branchingSession) return;

    setBranchingSession(true);
    try {
      const created = await createWorkSession(context.workId, {
        title: WORKBENCH.sessionBranchTitle(readOnlySession.title),
        source_session_ref: readOnlySession.id,
        ...(readOnlySourceTurnRef ? { source_turn_ref: readOnlySourceTurnRef } : {}),
      });
      setSessions((prev) => [created, ...prev.filter((session) => session.id !== created.id)]);
      await openWorkRef.current({
        id: context.workId,
        title: visibleWorkTitle,
        genre: null,
        status: "ACTIVE",
        updated_at: null,
        inserted_at: null,
      });
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sessionBranchFailure }]);
    } finally {
      setBranchingSession(false);
    }
  };

  const handleArchiveSession = async (session: WorkSessionDto) => {
    if (!context.workId || context.workId === "lobby" || session.status === "ACTIVE") return;

    try {
      const archived = await archiveWorkSession(context.workId, session.id);
      setSessions((prev) => {
        if (sessionSearch.trim()) {
          return prev.map((item) => (item.id === archived.id ? archived : item));
        }

        return prev.filter((item) => item.id !== archived.id);
      });

      if (readOnlySession?.id === archived.id) {
        setReadOnlySession(archived);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sessionArchiveFailure }]);
    }
  };

  const handleRefreshWorks = async () => {
    try {
      setWorks(await listWorks());
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `${WORKBENCH.switchFailurePrefix}${WORKBENCH.startupFailureLoadWork}` },
      ]);
    }
  };

  const handleSelectWork = async (work: WorkDto) => {
    if (work.id === context.workId || workSwitchingId) return;
    setWorkMenuOpen(false);
    await openWork(work);
  };

  const handleCreateWork = async () => {
    if (workSwitchingId) return;
    try {
      const created = await createWork({ title: WORKBENCH.unnamedWorkTitle });
      setWorks((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setWorkMenuOpen(false);
      await openWork(created);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: WORKBENCH.createWorkFailure },
      ]);
    }
  };

  const openAssistantNameDialog = () => {
    setAssistantNameDraft(
      assistantDisplayName === DEFAULT_ASSISTANT_DISPLAY_NAME ? "" : assistantDisplayName,
    );
    setAssistantNameError(null);
    setAssistantNameDialogOpen(true);
  };

  const applyAssistantDisplayName = async (value: string) => {
    if (!context.workId || assistantNameSaving) return;
    setAssistantNameSaving(true);
    setAssistantNameError(null);

    try {
      const savedName = await setAssistantDisplayName(context.workId, value);
      setAssistantDisplayNameState(savedName);
      setAssistantNameDraft(savedName === DEFAULT_ASSISTANT_DISPLAY_NAME ? "" : savedName);
      setContext({ assistantDisplayName: savedName });
      setAssistantNameDialogOpen(false);
    } catch {
      setAssistantNameError(WORKBENCH.assistantDisplayNameFailure);
    } finally {
      setAssistantNameSaving(false);
    }
  };

  const handleAssistantNameReset = async () => {
    if (!context.workId || assistantNameSaving) return;
    setAssistantNameSaving(true);
    setAssistantNameError(null);

    try {
      const savedName = await resetAssistantDisplayName(context.workId);
      setAssistantDisplayNameState(savedName);
      setAssistantNameDraft("");
      setContext({ assistantDisplayName: savedName });
      setAssistantNameDialogOpen(false);
    } catch {
      setAssistantNameError(WORKBENCH.assistantDisplayNameFailure);
    } finally {
      setAssistantNameSaving(false);
    }
  };

  const openTraceDialog = (turnId: string, traceSummary?: Record<string, unknown>) => {
    const summary = toAuthorTraceSummary(traceSummary);
    if (!summary) return;
    setTraceDialog({ turnId, summary });
  };

  const llmBadgeClassName = [
    styles.riskBadge,
    llmConnected === null
      ? styles.riskBadgeNeutral
      : llmConnected
        ? styles.riskBadgeOk
        : styles.riskBadgeError,
  ].join(" ");
  const serviceBadgeClassName = [
    styles.riskBadge,
    socketConnected ? styles.riskBadgeOk : styles.riskBadgeNeutral,
  ].join(" ");
  const leftColumnClassName = [
    styles.leftColumn,
    isPanelOpen ? styles.leftColumnDimmed : "",
  ].join(" ");

  return (
    <div className={styles.workbench}>
      {/* 顶部上下文栏 (Top Context Bar) */}
      <div className={styles.topBar}>
        <div className={styles.contextGroup}>
          <DropdownMenu.Root open={workMenuOpen} onOpenChange={setWorkMenuOpen}>
            <DropdownMenu.Trigger asChild>
              <button
                className={styles.workSwitcherButton}
                disabled={workSwitchingId !== null}
                title={WORKBENCH.workMenuTitle}
              >
                <BookOpen size={16} aria-hidden="true" />
                <span className={styles.titleText}>
                  {visibleWorkTitle}
                </span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={styles.workMenu} align="start" sideOffset={8}>
                <div className={styles.workMenuHeader}>
                  <span>{WORKBENCH.workMenuTitle}</span>
                  <button
                    className={styles.workMenuIconButton}
                    type="button"
                    title={WORKBENCH.workMenuRefresh}
                    onClick={(event) => {
                      event.preventDefault();
                      void handleRefreshWorks();
                    }}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                  </button>
                </div>
                {works.length === 0 ? (
                  <div className={styles.workMenuEmpty}>{WORKBENCH.workMenuEmpty}</div>
                ) : (
                  works.map((work) => {
                    const isCurrent = work.id === context.workId;
                    return (
                      <DropdownMenu.Item
                        key={work.id}
                        className={isCurrent ? styles.workMenuItemActive : styles.workMenuItem}
                        disabled={workSwitchingId !== null}
                        onSelect={(event) => {
                          event.preventDefault();
                          void handleSelectWork(work);
                        }}
                      >
                        <span className={styles.workMenuItemTitle}>{work.title}</span>
                        {isCurrent && (
                          <span className={styles.workMenuCurrent}>{WORKBENCH.workMenuCurrent}</span>
                        )}
                      </DropdownMenu.Item>
                    );
                  })
                )}
                <DropdownMenu.Separator className={styles.workMenuSeparator} />
                <DropdownMenu.Item
                  className={styles.workMenuCreate}
                  disabled={workSwitchingId !== null}
                  onSelect={(event) => {
                    event.preventDefault();
                    void handleCreateWork();
                  }}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>{WORKBENCH.workMenuCreate}</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Dialog.Root open={assistantNameDialogOpen} onOpenChange={setAssistantNameDialogOpen}>
            <Dialog.Trigger asChild>
              <button
                className={styles.assistantNameButton}
                type="button"
                disabled={!hasValidRuntimeWork}
                title={WORKBENCH.assistantDisplayNameAction}
                onClick={openAssistantNameDialog}
              >
                <Bot size={15} aria-hidden="true" />
                <span
                  className={styles.assistantNameValue}
                >
                  {assistantDisplayName}
                </span>
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className={styles.dialogOverlay} />
              <Dialog.Content className={styles.dialogContent}>
                <Dialog.Title className={styles.dialogTitle}>
                  {WORKBENCH.assistantDisplayNameTitle}
                </Dialog.Title>
                <Dialog.Description className={styles.dialogDescription}>
                  {WORKBENCH.assistantDisplayNameDescription}
                </Dialog.Description>
                <label className={styles.dialogLabel} htmlFor="assistant-display-name-input">
                  {WORKBENCH.assistantDisplayNameField}
                </label>
                <input
                  id="assistant-display-name-input"
                  className={styles.dialogInput}
                  value={assistantNameDraft}
                  maxLength={20}
                  placeholder={WORKBENCH.assistantDisplayNamePlaceholder}
                  disabled={assistantNameSaving}
                  onChange={(event) => setAssistantNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void applyAssistantDisplayName(assistantNameDraft);
                    }
                  }}
                />
                {assistantNameError && (
                  <div className={styles.dialogError}>{assistantNameError}</div>
                )}
                <div className={styles.dialogActions}>
                  <button
                    className={styles.btnSecondary}
                    type="button"
                    disabled={assistantNameSaving}
                    onClick={() => {
                      void handleAssistantNameReset();
                    }}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    <span>{WORKBENCH.assistantDisplayNameReset}</span>
                  </button>
                  <button
                    className={styles.sendBtn}
                    type="button"
                    disabled={assistantNameSaving}
                    onClick={() => {
                      void applyAssistantDisplayName(assistantNameDraft);
                    }}
                  >
                    {assistantNameSaving
                      ? WORKBENCH.assistantDisplayNameSaving
                      : WORKBENCH.assistantDisplayNameSave}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <button
            className={`${styles.btnSecondary} ${styles.readingModeButton}`}
            onClick={() => setMode("reading")}
          >
            [阅读模式]
          </button>
          <button
            className={`${styles.btnSecondary} ${styles.readingModeButton}`}
            disabled={!hasValidRuntimeWork}
            onClick={() => setMode("memory")}
          >
            [{MEMORY.workbenchEntry}]
          </button>
          <span className={styles.divider1}>/</span>
          <span className={styles.volText}>{context.volumeTitle || "全书"}</span>
        </div>
        <div className={styles.statusGroup}>
          <span className={styles.budgetText}>
            {workSwitchingId
              ? WORKBENCH.workMenuSwitching
              : longRun.status === "running"
                ? `长跑中: ${longRun.budgetUsed}%`
                : "长跑状态: 待机"}
          </span>
          <div
            className={llmBadgeClassName}
            title={llmConnected ? `模型: ${llmModel}` : "请检查 LM Studio 是否已启动并加载模型"}
          >
            LLM: {llmConnected === null ? "检测中…" : llmConnected ? "已连接" : "未连接"}
            {llmConnected && llmModel ? (
              <span className={styles.llmProviderName}> · {llmModel}</span>
            ) : null}
          </div>
          <div 
            className={serviceBadgeClassName}
          >
            服务: {connectionLabel}
          </div>
        </div>
      </div>

      {/* 主工作区域 (Main Area) */}
      <div className={styles.mainArea}>
        
        {/* 左侧对话与输入列 (Left Column) */}
        <div className={leftColumnClassName}>
          
          {/* 对话流区域 (Chat Area) */}
          <div className={styles.chatArea}>
            {isReadOnlySessionView && (
              <div
                className={styles.readOnlySessionBanner}
              >
                <div>
                  <div className={styles.readOnlySessionTitle}>{WORKBENCH.sessionReadOnlyTitle}</div>
                  <div className={styles.readOnlySessionDescription}>
                    {readOnlySession.title} · {WORKBENCH.sessionReadOnlyDescription}
                  </div>
                </div>
                <div className={styles.readOnlySessionActions}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => {
                      void restoreActiveSessionView();
                    }}
                  >
                    {WORKBENCH.sessionBackToActive}
                  </button>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={branchingSession || !socketConnected}
                    onClick={() => {
                      void handleBranchFromReadOnlySession();
                    }}
                  >
                    {WORKBENCH.sessionBranchFromHistory}
                  </button>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={
                  msg.role === "user" ? styles.userMsg : styles.assistantMsg
                }
              >
                <div
                  className={styles.role}
                >
                  {assistantRoleLabel(msg.role, assistantDisplayName)}
                </div>
                {msg.role === "assistant" && msg.turnResult?.frame_summary && (() => {
                  const framePresentation = framePresentationForSummary(msg.turnResult.frame_summary);

                  return framePresentation.visible ? (
                    <div
                      className={styles.frameBadge}
                      data-frame-tone={framePresentation.tone}
                      title={framePresentation.title}
                    >
                      {framePresentation.label}
                    </div>
                  ) : null;
                })()}
                <div className={styles.text}>{msg.text}</div>

                {msg.role === "assistant" && msg.turnResult?.trace_summary && (
                  <button
                    className={styles.traceWhyButton}
                    type="button"
                    title={TRACE.actionTitle}
                    onClick={() => openTraceDialog(msg.turnResult!.turn_id, msg.turnResult!.trace_summary)}
                  >
                    <CircleHelp size={14} aria-hidden="true" />
                    <span>{TRACE.actionLabel}</span>
                  </button>
                )}

                {!isReadOnlySessionView && msg.turnResult?.ui_cards?.map((card, ci) => {
                  switch (card.card_type) {
                    case "clarification_card":
                      return <ClarificationCard key={ci} card={card} />;
                    case "confirmation_card":
                      return <ConfirmationCard key={ci} card={card} />;
                    case "warning_card":
                      return <WarningCard key={ci} card={card} />;
                    case "candidate_set":
                      return <CandidateSetCard key={ci} card={card} />;
                    case "progress_card":
                      return <ProgressCard key={ci} card={card} />;
                    case "checkpoint_card":
                      return <CheckpointCard key={ci} card={card} />;
                    case "result_card":
                      return <ResultCard key={ci} card={card} />;
                    case "failure_card":
                      return <FailureCard key={ci} card={card} />;
                    case "escalation_card":
                      return <EscalationCard key={ci} card={card} />;
                    default:
                      return <DefaultCard key={ci} card={card} />;
                  }
                })}

                {!isReadOnlySessionView && msg.turnResult?.candidate_directions && msg.turnResult.candidate_directions.length > 0 && (
                  <WorkspaceCandidatePanel
                    turnResult={msg.turnResult}
                    candidates={msg.turnResult.candidate_directions}
                    loading={loading}
                    socketConnected={socketConnected}
                    onCandidateContinue={(candidateTurnResult, candidate) => {
                      void handleCandidateContinue(candidateTurnResult, candidate);
                    }}
                    onCandidateAdopt={(candidateTurnResult, action) => {
                      void handleAvailableAction(candidateTurnResult, action);
                    }}
                  />
                )}

                {!isReadOnlySessionView && msg.turnResult && visibleAvailableActions(msg.turnResult).length > 0 && (
                  <div className={styles.cardActions}>
                    {visibleAvailableActions(msg.turnResult).map((action) => (
                      <button
                        key={action.action_id}
                        className={styles.btnSecondary}
                        disabled={action.enabled === false}
                        title={action.disabled_reason}
                        onClick={() => {
                          if (msg.turnResult) {
                            handleVisibleAvailableAction(msg.turnResult, action);
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
              <div className={styles.assistantMsg}>
                <div className={styles.role}>
                  {assistantRoleLabel("assistant", assistantDisplayName)}
                </div>
                <div className={styles.text}>{WORKBENCH.thinking}</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <Dialog.Root
            open={traceDialog !== null}
            onOpenChange={(open) => {
              if (!open) setTraceDialog(null);
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className={styles.dialogOverlay} />
              <Dialog.Content
                className={`${styles.dialogContent} ${styles.traceDialogContent}`}
                aria-describedby={undefined}
              >
                {traceDialog && (
                  <>
                    <Dialog.Title className={styles.dialogTitle}>
                      {traceDialog.summary.decisionLabel}
                    </Dialog.Title>
                    <div className={styles.traceSection}>
                      <div className={styles.traceValue}>{traceDialog.summary.primaryReason}</div>
                    </div>
                    <div className={styles.traceSection}>
                      <div className={styles.traceLabel}>{TRACE.contextLabel}</div>
                      {traceDialog.summary.contextSources.length > 0 ? (
                        <div className={styles.traceChipRow}>
                          {traceDialog.summary.contextSources.map((source) => (
                            <div key={source.key} className={styles.traceSourceItem}>
                              <span className={styles.traceChip}>{source.label}</span>
                              {source.summary && (
                                <span className={styles.traceSourceSummary}>{source.summary}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.traceValue}>{TRACE.noContext}</div>
                      )}
                    </div>
                    {traceDialog.summary.detailLines.length > 0 && (
                      <div className={styles.traceSection}>
                        <div className={styles.traceLabel}>{TRACE.detailLabel}</div>
                        <ul className={styles.traceDetailList}>
                          {traceDialog.summary.detailLines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className={styles.traceIntegrityNote}>
                      {traceDialog.summary.integrityNote}
                    </div>
                  </>
                )}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          {/* 修改后采纳：编辑弹窗 (edit_then_accept) */}
          <Dialog.Root
            open={editDialog !== null}
            onOpenChange={(open) => {
              if (!open) setEditDialog(null);
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className={styles.dialogOverlay} />
              <Dialog.Content
                className={`${styles.dialogContent} ${styles.editDialogContent}`}
                aria-describedby={undefined}
              >
                <Dialog.Title className={styles.dialogTitle}>
                  {CARD.tentativeArtifact.editDialogTitle}
                </Dialog.Title>
                <Dialog.Description className={styles.dialogDescription}>
                  {CARD.tentativeArtifact.editDialogDescription}
                </Dialog.Description>
                <textarea
                  className={styles.editTextarea}
                  value={editDialog?.text ?? ""}
                  placeholder={CARD.tentativeArtifact.editPlaceholder}
                  disabled={editSubmitting}
                  onChange={(event) =>
                    setEditDialog((prev) =>
                      prev ? { ...prev, text: event.target.value } : prev,
                    )
                  }
                />
                <div className={styles.dialogActions}>
                  <button
                    className={styles.btnSecondary}
                    type="button"
                    disabled={editSubmitting}
                    onClick={() => setEditDialog(null)}
                  >
                    {CARD.tentativeArtifact.editCancelLabel}
                  </button>
                  <button
                    className={styles.sendBtn}
                    type="button"
                    disabled={editSubmitting || (editDialog?.text ?? "").trim() === ""}
                    onClick={() => {
                      void submitEditThenAccept();
                    }}
                  >
                    {CARD.tentativeArtifact.editConfirmLabel}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          {/* 输入区域 (Input Area) */}
          <div className={styles.inputArea}>
            <input
              type="text"
              className={styles.inputBox}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={WORKBENCH.inputPlaceholder}
              disabled={!socketConnected || isPanelOpen || isReadOnlySessionView}
            />
            <button
              className={styles.sendBtn}
              onClick={() => {
                void handleSend();
              }}
              disabled={loading || !socketConnected || isPanelOpen || isReadOnlySessionView}
            >
              {WORKBENCH.send}
            </button>
          </div>
        </div>

        {/* 结构与长跑收纳面板 (Structure Rail) */}
        {!isPanelOpen ? (
          <div className={styles.structureRailCollapsed}>
            <div className={styles.spTitle}>{WORKBENCH.archiveRailTitle}</div>
            <div className={styles.railSummary}>
              <div 
                className={styles.openArchiveEntry}
                onClick={() => setIsPanelOpen(true)}
              >
                <span className={styles.spItemCardText}>
                  {WORKBENCH.archiveRailOpen}<br/>{WORKBENCH.archiveRailDetail}
                </span>
              </div>
              {pendingAdoptionsCount > 0 && (
                <div className={styles.spItemTitle}>
                  {WORKBENCH.pendingAdoptionsPrefix} {pendingAdoptionsCount}
                </div>
              )}
              <div className={styles.sessionList}>
                <input
                  className={styles.sessionSearch}
                  value={sessionSearch}
                  onChange={(event) => {
                    void handleSessionSearch(event.target.value);
                  }}
                  placeholder={WORKBENCH.sessionSearchPlaceholder}
                />
                {sessions.slice(0, 5).map((session) => (
                  <div key={session.id} className={styles.sessionItemShell}>
                    <button
                      type="button"
                      className={session.id === activeSessionId ? styles.sessionItemActive : styles.sessionItem}
                      data-session-status={session.status}
                      data-readonly-open={readOnlySession?.id === session.id ? "true" : "false"}
                      onClick={() => {
                        void handleOpenSession(session);
                      }}
                    >
                      <span className={styles.sessionTitle}>{session.title}</span>
                      <span className={styles.sessionStatus}>{session.status}</span>
                    </button>
                    {session.status !== "ACTIVE" && session.status !== "ARCHIVED" && (
                      <button
                        type="button"
                        className={styles.sessionIconAction}
                        aria-label={WORKBENCH.sessionArchive}
                        title={WORKBENCH.sessionArchive}
                        onClick={() => {
                          void handleArchiveSession(session);
                        }}
                      >
                        <Archive size={14} aria-hidden="true" />
                      </button>
                    )}
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
            getArtifactActionState={artifactActionState}
            onArtifactAction={(artifact, actionType) => {
              submitArtifactAvailableAction(artifact, actionType);
              setIsPanelOpen(false);
            }}
            onStartPlanning={() => {
              void handleSend("我想规划一部 10 万字长篇小说，请生成章节大纲", {
                generateMicroPlan: true,
              });
            }}
            onCreateCharacter={() => {
              void handleSend("我想调整或新增伏笔", { generateMicroPlan: true });
            }}
            onDraftChapter={(chapterBrief) => {
              void handleSend(`请根据已采纳章节计划生成${chapterBrief}正文草稿，保持为待采纳草稿。`, {
                generateMicroPlan: true,
              });
            }}
            onNewAction={() => {
              void handleSend("我想调整或新增伏笔", { generateMicroPlan: true });
              setIsPanelOpen(false);
            }}
          />
        )}

      </div>
    </div>
  );
}
