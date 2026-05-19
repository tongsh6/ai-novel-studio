// Design: docs/design-v2/ui-design/41-workbench-layout.md §2 (3-zone workbench)
// Design: docs/design-v2/ui-design/42-card-system.md §2 (card type to ADR-0006 mapping)
// Prototype: novel-studio-v2.pen → 41§3-main-workbench (ZOwOi)
import { useEffect, useState, useRef } from "react";
import type { Channel } from "phoenix";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { BookOpen, Bot, ChevronDown, CircleHelp, MessageCircle, Plus, RefreshCw, RotateCcw } from "lucide-react";

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
  isCurrentWorkConnection,
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
import { getProviderHealth, providerHealthName } from "../lib/providerHealth";
import { TRACE, WORKBENCH } from "../lib/copy";
import { buildCandidateContinuation } from "../lib/candidateSelection";
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

interface TurnResult {
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

interface AvailableAction extends AvailableActionLike {
  target_ref?: string;
}

export interface CandidateDirection {
  direction_id: string;
  title: string;
  pitch: string;
  tone_tags: string[];
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
  const sliceVerifyCandidateRef = useRef(false);
  const resumeRestoredTranscriptRef = useRef(false);
  const connectionTokenRef = useRef(0);
  const openWorkRef = useRef<(work: WorkDto) => Promise<void>>(() => Promise.resolve());
  const activeConnectionRef = useRef<{ token: number; workId: string | null }>({
    token: 0,
    workId: null,
  });

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
      import.meta.env.VITE_SLICE_VERIFY_AUTORUN === "au02-candidate-continuation" &&
      !sliceVerifyCandidateRef.current &&
      (result.candidate_directions?.length ?? 0) > 0
    ) {
      sliceVerifyCandidateRef.current = true;
      window.setTimeout(() => {
        const frameBadge = document.querySelector<HTMLElement>(
          `[data-slice-verify="frame-badge"][data-turn-id="${result.turn_id}"]`,
        );
        const framePresentation = framePresentationForSummary(result.frame_summary);
        const continueButton = document.querySelector<HTMLButtonElement>(
          '[data-slice-verify="candidate-continue"]',
        );

        const continueCandidate = () => continueButton?.click();

        if (channelRef.current) {
          reportSliceVerifyUiState(channelRef.current, {
            slice_id: "au02-candidate-continuation",
            context_work_id: useAppStore.getState().context.workId,
            context_work_title: useAppStore.getState().context.workTitle,
            active_session_id: activeSessionId,
            restored_turn_id: result.turn_id,
            socket_connected: socketConnected,
            message_count: document.querySelectorAll('[data-role="user"], [data-role="assistant"]').length,
            welcome_message_count: Array.from(document.querySelectorAll('[data-role="assistant"]'))
              .filter((node) => node.textContent?.includes("欢迎使用 AI Novel Studio")).length,
            pending_adoption_count:
              document.querySelectorAll('[data-slice-verify="card-action"][data-action-type="accept"]').length,
            first_message_text:
              document.querySelector<HTMLElement>('[data-role="assistant"], [data-role="user"]')
                ?.innerText ?? "",
            service_status_text:
              document.querySelector<HTMLElement>('[data-slice-verify="service-status"]')
                ?.innerText ?? "",
            title_text:
              document.querySelector<HTMLElement>('[data-slice-verify="work-title"]')
                ?.innerText ?? "",
            frame_badge_label: frameBadge?.innerText.trim() ?? "",
            frame_badge_kind: frameBadge?.dataset.frameTone ?? framePresentation.tone,
            frame_badge_goal: framePresentation.goal,
            candidate_panel_count:
              document.querySelectorAll('[data-slice-verify="candidate-panel"]').length,
          })
            .catch(() => undefined)
            .finally(continueCandidate);
        } else {
          continueCandidate();
        }
      }, 300);
    }

    if (
      isTauri &&
      autorunSlice === "au07-trace-why-entry" &&
      result.trace_summary &&
      channelRef.current &&
      !sliceVerifyUiReported.has("au07-trace-why-entry")
    ) {
      window.setTimeout(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-slice-verify="trace-why-trigger"][data-turn-id="${result.turn_id}"]`,
          )
          ?.click();

        window.setTimeout(() => {
          if (!channelRef.current || sliceVerifyUiReported.has("au07-trace-why-entry")) return;
          sliceVerifyUiReported.add("au07-trace-why-entry");
          const dialogText =
            document.querySelector<HTMLElement>('[data-slice-verify="trace-why-dialog"]')
              ?.innerText ?? "";
          const currentContext = useAppStore.getState().context;

          void reportSliceVerifyUiState(channelRef.current, {
            slice_id: "au07-trace-why-entry",
            context_work_id: currentContext.workId,
            context_work_title: currentContext.workTitle,
            active_session_id: activeSessionId,
            restored_turn_id: result.turn_id,
            socket_connected: socketConnected,
            message_count: document.querySelectorAll('[data-role="user"], [data-role="assistant"]').length,
            welcome_message_count: Array.from(document.querySelectorAll('[data-role="assistant"]'))
              .filter((node) => node.textContent?.includes("欢迎使用 AI Novel Studio")).length,
            pending_adoption_count:
              document.querySelectorAll('[data-slice-verify="card-action"][data-action-type="accept"]').length,
            first_message_text:
              document.querySelector<HTMLElement>('[data-role="assistant"], [data-role="user"]')
                ?.innerText ?? "",
            service_status_text:
              document.querySelector<HTMLElement>('[data-slice-verify="service-status"]')
                ?.innerText ?? "",
            title_text:
              document.querySelector<HTMLElement>('[data-slice-verify="work-title"]')
                ?.innerText ?? "",
            trace_why_dialog_open: Boolean(dialogText),
            trace_why_text: dialogText,
            trace_why_contains_raw_prompt: /raw prompt|provider raw|hidden policy|debug/i.test(dialogText),
          }).catch(() => undefined);
        }, 120);
      }, 350);
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
      autorunSlice !== "su02-work-switching" &&
      autorunSlice !== "au10-micro-plan-entry" &&
      autorunSlice !== "su01-provider-health-model" &&
      autorunSlice !== "au02-candidate-continuation" &&
      autorunSlice !== "au07-trace-why-entry" &&
      autorunSlice !== "au10-ordinary-chat-no-micro-plan" &&
      autorunSlice !== "au01-ordinary-chat-two-turn-roundtrip" &&
      autorunSlice !== "au05-adoption-boundary" &&
      autorunSlice !== "au05-discard-boundary" &&
      autorunSlice !== "au05-modify-draft-boundary" &&
      autorunSlice !== "au05-adoption-followup-routing" &&
      autorunSlice !== "au08-adoption-reading-projection" &&
      autorunSlice !== "au09-archive-real-data" &&
      autorunSlice !== "au09-memory-recall-context" &&
      autorunSlice !== "stage-startup-context-contract" &&
      autorunSlice !== "workspace-runtime-state" &&
      autorunSlice !== "su03-assistant-display-name" &&
      autorunSlice !== "au03c-work-session-resume"
    ) return;
    if (!socketConnected || sliceVerifyAutorunRef.current) return;
    if (sliceVerifyAutorunStarted.has(autorunSlice)) return;
    if (autorunSlice === "au03c-work-session-resume" && transcriptRestored) return;
    if (autorunSlice === "su01-provider-health-model") {
      if (llmConnected === null) return;

      sliceVerifyAutorunRef.current = true;
      sliceVerifyAutorunStarted.add(autorunSlice);

      const timer = window.setTimeout(() => {
        if (!channelRef.current || sliceVerifyUiReported.has("su01-provider-health-model")) return;
        sliceVerifyUiReported.add("su01-provider-health-model");

        void reportSliceVerifyUiState(channelRef.current, {
          slice_id: "su01-provider-health-model",
          context_work_id: context.workId,
          context_work_title: visibleWorkTitle,
          active_session_id: activeSessionId,
          restored_turn_id: null,
          socket_connected: socketConnected,
          message_count: messages.length,
          welcome_message_count: messages.filter((message) =>
            message.text.includes("欢迎使用 AI Novel Studio"),
          ).length,
          pending_adoption_count: pendingAdoptionsCount,
          first_message_text: messages[0]?.text ?? "",
          service_status_text:
            document.querySelector<HTMLElement>('[data-slice-verify="service-status"]')
              ?.innerText ?? "",
          title_text:
            document.querySelector<HTMLElement>('[data-slice-verify="work-title"]')
              ?.innerText ?? "",
          llm_status_text:
            document.querySelector<HTMLElement>('[data-slice-verify="llm-status"]')
              ?.innerText ?? "",
          llm_connected: llmConnected,
          llm_model_label: llmModel,
        });
      }, 250);

      return () => window.clearTimeout(timer);
    }

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
    } else if (autorunSlice === "su02-work-switching") {
      timers.push(window.setTimeout(() => {
        const driveSwitchingProof = async () => {
          const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

          setInputText("你好，我想先在当前作品里聊一句");
          await delay(80);
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="send-button"]')
            ?.click();
          await delay(40);
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="work-switcher"]')
            ?.click();
          await delay(100);
          const createItem = document.querySelector<HTMLElement>('[data-slice-verify="work-create"]');
          if (createItem) {
            createItem.click();
          } else {
            const created = await createWork({ title: WORKBENCH.unnamedWorkTitle });
            setWorks((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
            setWorkMenuOpen(false);
            await openWorkRef.current(created);
          }
          await delay(1800);

          if (!channelRef.current || sliceVerifyUiReported.has("su02-work-switching")) return;
          sliceVerifyUiReported.add("su02-work-switching");
          const currentContext = useAppStore.getState().context;
          const messageCount = document.querySelectorAll('[data-role="user"], [data-role="assistant"]').length;
          const welcomeMessageCount = Array.from(document.querySelectorAll('[data-role="assistant"]'))
            .filter((node) => node.textContent?.includes("欢迎使用 AI Novel Studio")).length;

          void reportSliceVerifyUiState(channelRef.current, {
            slice_id: "su02-work-switching",
            context_work_id: currentContext.workId,
            context_work_title: currentContext.workTitle,
            active_session_id: activeSessionId,
            restored_turn_id: null,
            socket_connected: useAppStore.getState().socketConnected,
            message_count: messageCount,
            welcome_message_count: welcomeMessageCount,
            pending_adoption_count: pendingAdoptionsCount,
            first_message_text:
              document.querySelector<HTMLElement>('[data-role="assistant"], [data-role="user"]')
                ?.innerText ?? "",
            service_status_text:
              document.querySelector<HTMLElement>('[data-slice-verify="service-status"]')
                ?.innerText ?? "",
            title_text:
              document.querySelector<HTMLElement>('[data-slice-verify="work-title"]')
              ?.innerText ?? "",
          }).catch(() => undefined);
        };

        void driveSwitchingProof();
      }, 150));
    } else if (autorunSlice === "su03-assistant-display-name") {
      timers.push(window.setTimeout(() => {
        const driveAssistantNameProof = async () => {
          const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
          const initialWorkId = context.workId;
          if (!initialWorkId) return;

          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="assistant-name-trigger"]')
            ?.click();
          await delay(80);
          setAssistantNameDraft("创作助手");
          await delay(80);
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="assistant-name-save"]')
            ?.click();
          await delay(250);
          const nameAfterSave =
            document.querySelector<HTMLElement>('[data-slice-verify="assistant-display-name"]')
              ?.innerText ?? "";
          const assistantRoleAfterSave =
            document.querySelector<HTMLElement>('[data-slice-verify="assistant-role-label"]')
              ?.innerText ?? "";

          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="work-switcher"]')
            ?.click();
          await delay(100);
          const createItem = document.querySelector<HTMLElement>('[data-slice-verify="work-create"]');
          if (createItem) {
            createItem.click();
          } else {
            const created = await createWork({ title: WORKBENCH.unnamedWorkTitle });
            setWorks((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
            setWorkMenuOpen(false);
            await openWorkRef.current(created);
          }
          await delay(1400);

          const createdWorkId = useAppStore.getState().context.workId;
          const nameInCreatedWork =
            document.querySelector<HTMLElement>('[data-slice-verify="assistant-display-name"]')
              ?.innerText ?? "";

          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="work-switcher"]')
            ?.click();
          await delay(100);
          const initialWorkItem = document
            .querySelector<HTMLElement>(
              `[data-slice-verify="work-switch-item"][data-work-id="${initialWorkId}"]`,
            );
          if (initialWorkItem) {
            initialWorkItem.click();
          } else {
            const refreshedWorks = await listWorks();
            setWorks(refreshedWorks);
            const initialWork = refreshedWorks.find((work) => work.id === initialWorkId);
            if (initialWork) await openWorkRef.current(initialWork);
          }
          await delay(1400);

          if (!channelRef.current || sliceVerifyUiReported.has("su03-assistant-display-name")) return;
          sliceVerifyUiReported.add("su03-assistant-display-name");

          const nameAfterReturn =
            document.querySelector<HTMLElement>('[data-slice-verify="assistant-display-name"]')
              ?.innerText ?? "";
          const assistantRoleAfterReturn =
            document.querySelector<HTMLElement>('[data-slice-verify="assistant-role-label"]')
              ?.innerText ?? "";
          const currentContext = useAppStore.getState().context;

          void reportSliceVerifyUiState(channelRef.current, {
            slice_id: "su03-assistant-display-name",
            context_work_id: currentContext.workId,
            context_work_title: currentContext.workTitle,
            active_session_id: activeSessionId,
            restored_turn_id: null,
            socket_connected: useAppStore.getState().socketConnected,
            message_count: document.querySelectorAll('[data-role="user"], [data-role="assistant"]').length,
            welcome_message_count: Array.from(document.querySelectorAll('[data-role="assistant"]'))
              .filter((node) => node.textContent?.includes("欢迎使用 AI Novel Studio")).length,
            pending_adoption_count: pendingAdoptionsCount,
            first_message_text:
              document.querySelector<HTMLElement>('[data-role="assistant"], [data-role="user"]')
                ?.innerText ?? "",
            service_status_text:
              document.querySelector<HTMLElement>('[data-slice-verify="service-status"]')
                ?.innerText ?? "",
            title_text:
              document.querySelector<HTMLElement>('[data-slice-verify="work-title"]')
                ?.innerText ?? "",
            initial_work_id: initialWorkId,
            created_work_id: createdWorkId,
            assistant_name_after_save: nameAfterSave,
            assistant_role_after_save: assistantRoleAfterSave,
            assistant_name_in_created_work: nameInCreatedWork,
            assistant_name_after_return: nameAfterReturn,
            assistant_role_after_return: assistantRoleAfterReturn,
          }).catch(() => undefined);
        };

        void driveAssistantNameProof();
      }, 150));
    } else if (autorunSlice === "au02-candidate-continuation") {
      timers.push(window.setTimeout(() => {
        setInputText("我想写一个赛博修仙方向");
        timers.push(window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="send-button"]')
            ?.click();
        }, 150));
      }, 150));
    } else if (autorunSlice === "au07-trace-why-entry") {
      timers.push(window.setTimeout(() => {
        setInputText("我想聊聊林烬为什么会离开故乡");
        timers.push(window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="send-button"]')
            ?.click();
        }, 150));
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
    } else if (autorunSlice === "au09-archive-real-data") {
      timers.push(window.setTimeout(() => {
        setIsPanelOpen(true);
        timers.push(window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="archive-foreshadowing-detail-button"]')
            ?.click();
        }, 900));
        timers.push(window.setTimeout(() => {
          if (!channelRef.current || sliceVerifyUiReported.has("au09-archive-real-data")) return;
          sliceVerifyUiReported.add("au09-archive-real-data");

          const textContent = (selector: string) =>
            document.querySelector<HTMLElement>(selector)?.innerText.trim() ?? "";
          const panelDataset =
            document.querySelector<HTMLElement>('[data-slice-verify="structure-panel"]')
              ?.dataset;
          const detailTitle = textContent('[data-slice-verify="archive-detail-title"]');
          const datasetNumber = (key: string) => Number.parseInt(panelDataset?.[key] ?? "0", 10);

          void reportSliceVerifyUiState(channelRef.current, {
            slice_id: "au09-archive-real-data",
            context_work_id: context.workId,
            context_work_title: visibleWorkTitle,
            active_session_id: activeSessionId,
            restored_turn_id: null,
            socket_connected: socketConnected,
            message_count: messages.length,
            welcome_message_count: messages.filter((message) =>
              message.text.includes("欢迎使用 AI Novel Studio"),
            ).length,
            pending_adoption_count: pendingAdoptionsCount,
            first_message_text: messages[0]?.text ?? "",
            service_status_text: textContent('[data-slice-verify="service-status"]'),
            title_text: textContent('[data-slice-verify="work-title"]'),
            archive_character_count: datasetNumber("archiveCharacterCount"),
            archive_foreshadowing_count: datasetNumber("archiveForeshadowingCount"),
            archive_rule_count: datasetNumber("archiveRuleCount"),
            archive_volumes: datasetNumber("archiveVolumes"),
            archive_chapters: datasetNumber("archiveChapters"),
            archive_memory_items: datasetNumber("archiveMemoryItems"),
            archive_drafts_total: datasetNumber("archiveDraftsTotal"),
            archive_drafts_accepted: datasetNumber("archiveDraftsAccepted"),
            archive_detail_kind: panelDataset?.archiveDetailKind ?? "",
            archive_detail_id: panelDataset?.archiveDetailId ?? "",
            archive_detail_title: detailTitle,
          }).catch(() => undefined);
        }, 1150));
      }, 150));
    } else if (autorunSlice === "au09-memory-recall-context") {
      timers.push(window.setTimeout(() => {
        setInputText("林烬为什么要去灵源矿区？");
        timers.push(window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>('[data-slice-verify="send-button"]')
            ?.click();
        }, 150));
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
  }, [activeSessionId, context.workId, hasValidRuntimeWork, llmConnected, llmModel, messages, pendingAdoptionsCount, setMode, socketConnected, transcriptRestored, visibleWorkTitle]);

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
        { role: "assistant", text: WORKBENCH.sendFailure },
      ]);
      setLoading(false);
    }
  }

  const handleCandidateContinue = async (turnResult: TurnResult, candidate: CandidateDirection) => {
    if (!channelRef.current) return;
    const continuation = buildCandidateContinuation(turnResult.turn_id, candidate);

    setMessages((prev) => [...prev, { role: "user", text: continuation.text }]);
    setLoading(true);

    try {
      await sendMessage(
        channelRef.current,
        continuation.text,
        context.workId,
        null,
        activeSessionId,
        false,
        continuation.selection,
      );
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: WORKBENCH.sendFailure },
      ]);
      setLoading(false);
    }
  };

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
          { role: "assistant", text: WORKBENCH.adoptionIncomplete },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: WORKBENCH.actionFailure },
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
        { role: "assistant", text: WORKBENCH.actionFailure },
      ]);
    }
  };

  const actionLabel = (action: AvailableActionLike) => {
    if (action.action_type === "confirm_before_execute") return WORKBENCH.actionConfirm;
    if (action.action_type === "reject_or_cancel_confirmation") return WORKBENCH.actionReject;
    if (action.action_type === "cancel_pending_behavior") return WORKBENCH.actionCancel;
    if (action.action_type === "answer_clarification") return WORKBENCH.actionAnswer;
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
    <div className={styles.workbench} data-slice-verify="workspace-chat">
      {/* 顶部上下文栏 (Top Context Bar) */}
      <div className={styles.topBar}>
        <div className={styles.contextGroup}>
          <DropdownMenu.Root open={workMenuOpen} onOpenChange={setWorkMenuOpen}>
            <DropdownMenu.Trigger asChild>
              <button
                className={styles.workSwitcherButton}
                data-slice-verify="work-switcher"
                disabled={workSwitchingId !== null}
                title={WORKBENCH.workMenuTitle}
              >
                <BookOpen size={16} aria-hidden="true" />
                <span className={styles.titleText} data-slice-verify="work-title">
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
                        data-slice-verify="work-switch-item"
                        data-work-id={work.id}
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
                  data-slice-verify="work-create"
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
                data-slice-verify="assistant-name-trigger"
                type="button"
                disabled={!hasValidRuntimeWork}
                title={WORKBENCH.assistantDisplayNameAction}
                onClick={openAssistantNameDialog}
              >
                <Bot size={15} aria-hidden="true" />
                <span
                  className={styles.assistantNameValue}
                  data-slice-verify="assistant-display-name"
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
                  data-slice-verify="assistant-name-input"
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
                    data-slice-verify="assistant-name-reset"
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
                    data-slice-verify="assistant-name-save"
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
            data-status={llmConnected === true ? "ok" : "warn"}
            data-slice-verify="llm-status"
            title={llmConnected ? `模型: ${llmModel}` : "请检查 LM Studio 是否已启动并加载模型"}
          >
            LLM: {llmConnected === null ? "检测中…" : llmConnected ? "已连接" : "未连接"}
            {llmConnected && llmModel ? (
              <span className={styles.llmProviderName}> · {llmModel}</span>
            ) : null}
          </div>
          <div 
            className={serviceBadgeClassName}
            data-status={socketConnected ? "ok" : "error"}
            data-slice-verify="service-status"
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
            {messages.map((msg, i) => (
              <div
                key={i}
                data-role={msg.role}
                className={
                  msg.role === "user" ? styles.userMsg : styles.assistantMsg
                }
              >
                <div
                  className={styles.role}
                  data-slice-verify={msg.role === "assistant" ? "assistant-role-label" : undefined}
                >
                  {assistantRoleLabel(msg.role, assistantDisplayName)}
                </div>
                {msg.role === "assistant" && msg.turnResult?.frame_summary && (() => {
                  const framePresentation = framePresentationForSummary(msg.turnResult.frame_summary);

                  return framePresentation.visible ? (
                    <div
                      className={styles.frameBadge}
                      data-frame-tone={framePresentation.tone}
                      data-slice-verify="frame-badge"
                      data-turn-id={msg.turnResult.turn_id}
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
                    data-slice-verify="trace-why-trigger"
                    data-turn-id={msg.turnResult.turn_id}
                    type="button"
                    title={TRACE.actionTitle}
                    onClick={() => openTraceDialog(msg.turnResult!.turn_id, msg.turnResult!.trace_summary)}
                  >
                    <CircleHelp size={14} aria-hidden="true" />
                    <span>{TRACE.actionLabel}</span>
                  </button>
                )}

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
                  <div className={styles.candidatePanel} data-slice-verify="candidate-panel">
                    <div className={styles.candidateHeader}>{WORKBENCH.candidatePanelTitle}</div>
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
                          <div className={styles.candidateActions}>
                            <button
                              className={styles.candidateButton}
                              data-slice-verify="candidate-continue"
                              data-candidate-ref={c.direction_id}
                              disabled={loading || !socketConnected}
                              title={WORKBENCH.candidateContinueTitle}
                              onClick={() => {
                                if (msg.turnResult) {
                                  void handleCandidateContinue(msg.turnResult, c);
                                }
                              }}
                            >
                              <MessageCircle size={14} aria-hidden="true" />
                              <span>{WORKBENCH.candidateContinueLabel}</span>
                            </button>
                          </div>
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
                <div className={styles.role} data-slice-verify="assistant-role-label">
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
                data-slice-verify="trace-why-dialog"
                data-turn-id={traceDialog?.turnId}
              >
                {traceDialog && (
                  <>
                    <Dialog.Title className={styles.dialogTitle}>
                      {traceDialog.summary.title}
                    </Dialog.Title>
                    <Dialog.Description className={styles.traceDescription}>
                      {TRACE.description}
                    </Dialog.Description>
                    <div className={styles.traceSection}>
                      <div className={styles.traceLabel}>{TRACE.decisionLabel}</div>
                      <div className={styles.traceValue}>{traceDialog.summary.decisionLabel}</div>
                    </div>
                    <div className={styles.traceSection}>
                      <div className={styles.traceLabel}>{TRACE.reasonLabel}</div>
                      <div className={styles.traceValue}>{traceDialog.summary.primaryReason}</div>
                    </div>
                    {traceDialog.summary.goal && (
                      <div className={styles.traceSection}>
                        <div className={styles.traceLabel}>{TRACE.goalLabel}</div>
                        <div className={styles.traceValue}>{traceDialog.summary.goal}</div>
                      </div>
                    )}
                    <div className={styles.traceSection}>
                      <div className={styles.traceLabel}>{TRACE.contextLabel}</div>
                      {traceDialog.summary.contextSources.length > 0 ? (
                        <div className={styles.traceChipRow}>
                          {traceDialog.summary.contextSources.map((source) => (
                            <span key={source.key} className={styles.traceChip}>
                              {source.label}
                            </span>
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

          {/* 输入区域 (Input Area) */}
          <div className={styles.inputArea}>
            <input
              type="text"
              className={styles.inputBox}
              data-slice-verify="chat-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={WORKBENCH.inputPlaceholder}
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
              {WORKBENCH.send}
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
