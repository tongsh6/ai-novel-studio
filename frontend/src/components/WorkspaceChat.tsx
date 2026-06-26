// Design: docs/design/ui/41-workbench-layout.md §2 (3-zone workbench)
// Design: docs/design/ui/42-card-system.md §2 (card type to VS-05 mapping)
// Prototype: novel-studio.pen → 41§3-main-workbench (ZOwOi)
import { useCallback, useEffect, useState, useRef } from "react";
import type { Channel } from "phoenix";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  BookOpen,
  Bot,
  ChevronDown,
  CircleHelp,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";

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
  duplicateWorkTitleIndex,
  ensureInitialWork,
  renameWork,
  discardWork,
  normalizeWorkTitle,
  isValidWorkTitle,
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
  getTurnReplay,
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
  QualityReviewCard,
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
import type { StructurePanelActionState, StructurePanelArtifactAction } from "./StructurePanel";
import { useAppStore } from "../lib/store";
import { getProviderHealth, providerHealthName } from "../lib/providerHealth";
import {
  getStoredProviderApiKey,
  isValidProviderEndpoint,
  listProviderModels,
  loadAndSyncModelProviderState,
  providerDisplayName,
  providerOption,
  saveAndApplyModelProviderConfig,
  testProviderConnection,
  type ModelProviderRuntimeState,
  type ProviderModelOption,
  type ProviderId,
} from "../lib/modelProvider";
import {
  BUTTON,
  CARD,
  STRUCTURE_PANEL,
  TRACE,
  WORKBENCH,
  candidateContinuationText,
} from "../lib/copy";
import { findCandidateAvailableAction } from "../lib/candidateSelection";
import type { CandidateDirection as CandidateDirectionContract } from "../lib/schemas";
import { toAuthorTraceSummary, type TraceSummaryView } from "../lib/traceSummaryView";
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
  projection_refs?: {
    projection_type: string;
    projection_id: string;
    source_revision_refs: string[];
    refresh_status?: string | null;
  }[];
  quality_review?: QualityReview;
  produced_at: string;
}

export interface QualityFindingView {
  quality_gate: string;
  validator: string;
  severity: string;
  action: string;
  summary: string;
  evidence_spans?: { text?: string }[];
  brief_field_refs?: string[];
  can_override?: boolean;
}

export interface QualityReview {
  status: string;
  policy_action: string;
  review_status: string;
  findings: QualityFindingView[];
}

export interface AvailableAction extends AvailableActionLike {
  target_ref?: string;
  quality_finding_refs?: string[];
}

export type CandidateDirection = CandidateDirectionContract;

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

// 推理强度只接受供应商认可的枚举值（DeepSeek: high/low/medium），空串表示不指定。
// 自由文本会被原样发往 provider，导致 HTTP 400（例如误填 0.7），故在表单层即收敛为枚举。
type ReasoningEffort = "" | "low" | "medium" | "high";

const REASONING_EFFORT_OPTIONS: ReadonlyArray<{ value: ReasoningEffort; label: string }> = [
  { value: "", label: WORKBENCH.modelProviderReasoningDefault },
  { value: "low", label: WORKBENCH.modelProviderReasoningLow },
  { value: "medium", label: WORKBENCH.modelProviderReasoningMedium },
  { value: "high", label: WORKBENCH.modelProviderReasoningHigh },
];

function normalizeReasoningEffort(value: string | null | undefined): ReasoningEffort {
  return REASONING_EFFORT_OPTIONS.some((option) => option.value === value)
    ? (value as ReasoningEffort)
    : "";
}

interface ModelProviderDraft {
  provider: ProviderId;
  model: string;
  endpoint: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  clearApiKey: boolean;
  thinking: "enabled" | "disabled";
  reasoningEffort: ReasoningEffort;
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
          const adoptionUnavailable =
            !candidateAction || candidateAction.enabled === false || !socketConnected;

          return (
            <div key={candidate.direction_id} className={styles.candidateCard}>
              <div className={styles.candidateTitle}>{candidate.title}</div>
              <div className={styles.candidatePitch}>{candidate.pitch}</div>
              {candidate.tone_tags && candidate.tone_tags.length > 0 && (
                <div className={styles.candidateTags}>
                  {candidate.tone_tags.map((tag) => (
                    <span key={tag} className={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.candidateActions}>
                <button
                  className={styles.candidateButton}
                  disabled={loading || !socketConnected}
                  title={
                    !socketConnected
                      ? WORKBENCH.actionUnavailable
                      : WORKBENCH.candidateContinueTitle
                  }
                  onClick={() => {
                    if (!socketConnected) return;
                    onCandidateContinue(turnResult, candidate);
                  }}
                >
                  <MessageCircle size={14} aria-hidden="true" />
                  <span>{WORKBENCH.candidateContinueLabel}</span>
                </button>
                {candidateAction && (
                  <button
                    className={styles.candidateButton}
                    disabled={loading || adoptionUnavailable}
                    title={adoptionUnavailable ? unavailableReason : WORKBENCH.candidateAdoptTitle}
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

export interface WorkspaceSessionListProps {
  sessions: WorkSessionDto[];
  activeSessionId: string | null;
  sessionSearch: string;
  canCreateSession: boolean;
  creatingSession: boolean;
  onSessionSearch: (query: string) => void;
  onOpenSession: (session: WorkSessionDto) => void;
  onCreateSession: () => void;
  onArchiveSession: (session: WorkSessionDto) => void;
}

export function WorkspaceSessionList({
  sessions,
  activeSessionId,
  sessionSearch,
  canCreateSession,
  creatingSession,
  onSessionSearch,
  onOpenSession,
  onCreateSession,
  onArchiveSession,
}: WorkspaceSessionListProps) {
  return (
    <div className={styles.sessionList}>
      <div className={styles.sessionTools}>
        <input
          className={styles.sessionSearch}
          value={sessionSearch}
          onChange={(event) => onSessionSearch(event.target.value)}
          placeholder={WORKBENCH.sessionSearchPlaceholder}
        />
        <button
          type="button"
          className={styles.sessionIconAction}
          aria-label={WORKBENCH.sessionCreate}
          title={WORKBENCH.sessionCreate}
          disabled={!canCreateSession || creatingSession}
          onClick={onCreateSession}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
      {sessions.slice(0, 5).map((session) => (
        <div key={session.id} className={styles.sessionItemShell}>
          <button
            type="button"
            className={
              session.id === activeSessionId ? styles.sessionItemActive : styles.sessionItem
            }
            onClick={() => onOpenSession(session)}
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
              onClick={() => onArchiveSession(session)}
            >
              <Archive size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function isProseArtifact(artifactType?: string): boolean {
  return artifactType === "prose_fragment" || artifactType === "scene_draft";
}

function isOutlineArtifact(artifactType?: string): boolean {
  return artifactType === "outline_draft";
}

function isArchiveArtifact(artifactType?: string): boolean {
  return (
    artifactType === "character_seed" ||
    artifactType === "character_evolution_seed" ||
    artifactType === "world_setting" ||
    artifactType === "foreshadowing_seed" ||
    artifactType === "world_rule_seed" ||
    artifactType === "style_rule_seed" ||
    artifactType === "constraint_seed"
  );
}

function acceptActionLabel(artifactType?: string): string {
  if (isProseArtifact(artifactType)) return CARD.tentativeArtifact.acceptProseLabel;
  if (isOutlineArtifact(artifactType)) return CARD.tentativeArtifact.acceptOutlineLabel;
  if (isArchiveArtifact(artifactType)) return CARD.tentativeArtifact.acceptArchiveLabel;
  return CARD.tentativeArtifact.acceptLabel;
}

function editThenAcceptActionLabel(artifactType?: string): string {
  if (isProseArtifact(artifactType)) return CARD.tentativeArtifact.editProseThenAcceptLabel;
  return CARD.tentativeArtifact.editThenAcceptLabel;
}

function acceptActionTitle(artifactType?: string): string {
  if (isProseArtifact(artifactType)) return WORKBENCH.acceptProseActionTitle;
  if (isOutlineArtifact(artifactType)) return WORKBENCH.acceptOutlineActionTitle;
  if (isArchiveArtifact(artifactType)) return WORKBENCH.acceptArchiveActionTitle;
  return WORKBENCH.acceptGenericActionTitle;
}

function editThenAcceptActionTitle(artifactType?: string): string {
  if (isProseArtifact(artifactType)) return WORKBENCH.editProseActionTitle;
  return WORKBENCH.editGenericActionTitle;
}

function startupFailureMessage(detail: string): ChatMessage {
  return {
    role: "assistant",
    text: `${WORKBENCH.startupFailurePrefix}\n\n${detail}`,
  };
}

function startupConnectingMessage(): ChatMessage {
  return { role: "assistant", text: WORKBENCH.startupConnecting };
}

// 桌面端后端是随应用启动的 sidecar，需数秒完成解包/启动；webview 秒开后首批请求会
// 先于后端就绪而失败。这类「连接尚未就绪」的失败在启动期应静默重试，而不是直接报错。
const STARTUP_MAX_ATTEMPTS = 30;
const STARTUP_RETRY_MS = 1000;

function isConnectivityFailure(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("load failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("fetch")
  );
}

function modelProviderDraftFromState(state: ModelProviderRuntimeState): ModelProviderDraft {
  const option = providerOption(state.options, state.selectedProvider);
  const stored = state.stored.providers[state.selectedProvider] ?? {};

  return {
    provider: state.selectedProvider,
    model: stored.model ?? option?.model ?? "",
    endpoint: stored.endpoint ?? option?.endpoint ?? "",
    apiKey: "",
    apiKeyConfigured: Boolean(stored.api_key_configured ?? option?.api_key_configured),
    clearApiKey: false,
    thinking: stored.thinking ?? "disabled",
    reasoningEffort: normalizeReasoningEffort(stored.reasoning_effort),
  };
}

function modelProviderDraftForProvider(
  state: ModelProviderRuntimeState | null,
  provider: ProviderId,
): ModelProviderDraft {
  const option = state ? providerOption(state.options, provider) : undefined;
  const stored = state?.stored.providers[provider] ?? {};

  return {
    provider,
    model: stored.model ?? option?.model ?? "",
    endpoint: stored.endpoint ?? option?.endpoint ?? "",
    apiKey: "",
    apiKeyConfigured: Boolean(stored.api_key_configured ?? option?.api_key_configured),
    clearApiKey: false,
    thinking: stored.thinking ?? "disabled",
    reasoningEffort: normalizeReasoningEffort(stored.reasoning_effort),
  };
}

function modelProviderDraftHasInvalidEndpoint(
  draft: ModelProviderDraft,
  state: ModelProviderRuntimeState | null,
): boolean {
  const option = state ? providerOption(state.options, draft.provider) : undefined;
  return Boolean(option?.supports_endpoint) && !isValidProviderEndpoint(draft.endpoint);
}

function errorDetail(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return null;
}

type WorkLifecycleDialog =
  | { mode: "create"; title: string; error: string | null; submitting: boolean }
  | { mode: "rename"; work: WorkDto; title: string; error: string | null; submitting: boolean }
  | { mode: "discard"; work: WorkDto; error: string | null; submitting: boolean };

type InitialWorkBootstrap = {
  availableWorks: WorkDto[];
  initialId: string;
};

type WorkbenchGlobal = typeof globalThis & {
  __aiNovelInitialWorkBootstrapPromise?: Promise<InitialWorkBootstrap> | null;
};

async function resolveInitialWorkBootstrap(): Promise<InitialWorkBootstrap> {
  const bootstrapGlobal = globalThis as WorkbenchGlobal;
  if (!bootstrapGlobal.__aiNovelInitialWorkBootstrapPromise) {
    bootstrapGlobal.__aiNovelInitialWorkBootstrapPromise = (async () => {
      let availableWorks = await listWorks();
      let initialId = pickInitialWorkId(availableWorks, await getLastOpenedWorkId());
      if (!initialId) {
        const created = await ensureInitialWork({ title: WORKBENCH.unnamedWorkTitle });
        availableWorks = [created, ...availableWorks];
        initialId = created.id;
      }

      return { availableWorks, initialId };
    })().finally(() => {
      bootstrapGlobal.__aiNovelInitialWorkBootstrapPromise = null;
    });
  }

  return bootstrapGlobal.__aiNovelInitialWorkBootstrapPromise;
}

export function WorkspaceChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [llmConnected, setLlmConnected] = useState<boolean | null>(null);
  const [llmModel, setLlmModel] = useState<string>("");
  const [llmMessage, setLlmMessage] = useState<string>("");
  const [modelProviderState, setModelProviderState] = useState<ModelProviderRuntimeState | null>(
    null,
  );
  const [modelProviderDialogOpen, setModelProviderDialogOpen] = useState(false);
  const [modelProviderDraft, setModelProviderDraft] = useState<ModelProviderDraft>({
    provider: "stub",
    model: "",
    endpoint: "",
    apiKey: "",
    apiKeyConfigured: false,
    clearApiKey: false,
    thinking: "disabled",
    reasoningEffort: "",
  });
  const [modelProviderSaving, setModelProviderSaving] = useState(false);
  const [modelProviderTesting, setModelProviderTesting] = useState(false);
  const [modelProviderMessage, setModelProviderMessage] = useState<string | null>(null);
  const [modelProviderModels, setModelProviderModels] = useState<ProviderModelOption[]>([]);
  const [modelProviderModelsLoading, setModelProviderModelsLoading] = useState(false);
  const [modelProviderModelsMessage, setModelProviderModelsMessage] = useState<string | null>(null);
  const [pendingAnswerBid, setPendingAnswerBid] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WorkSessionDto[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [readOnlySession, setReadOnlySession] = useState<WorkSessionDto | null>(null);
  const [readOnlySourceTurnRef, setReadOnlySourceTurnRef] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [branchingSession, setBranchingSession] = useState(false);
  const [resumePendingAdoptions, setResumePendingAdoptions] = useState<ArtifactEntry[]>([]);
  const [resumeResolvedAdoptions, setResumeResolvedAdoptions] = useState<ArtifactEntry[]>([]);
  const [transcriptRestored, setTranscriptRestored] = useState(false);
  const [works, setWorks] = useState<WorkDto[]>([]);
  const [workMenuOpen, setWorkMenuOpen] = useState(false);
  const [workSwitchingId, setWorkSwitchingId] = useState<string | null>(null);
  const [workDialog, setWorkDialog] = useState<WorkLifecycleDialog | null>(null);
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
  const [selectedFindingIdsMap, setSelectedFindingIdsMap] = useState<Record<string, string[]>>({});

  // Connect to Zustand Global Store with selectors for stability
  const socketConnected = useAppStore((state) => state.socketConnected);
  const setSocketConnected = useAppStore((state) => state.setSocketConnected);
  const context = useAppStore((state) => state.context);
  const longRun = useAppStore((state) => state.longRun);
  const setContext = useAppStore((state) => state.setContext);
  const setChannel = useAppStore((state) => state.setChannel);
  const setMode = useAppStore((state) => state.setMode);
  const setLongRun = useAppStore((state) => state.setLongRun);

  const channelRef = useRef<Channel | null>(null);
  const socketRef = useRef<ReturnType<typeof createSocket> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resumeRestoredTranscriptRef = useRef(false);
  const connectionTokenRef = useRef(0);
  const openWorkRef = useRef<(work: WorkDto) => Promise<void>>(() => Promise.resolve());
  const currentWorkRef = useRef<WorkDto | null>(null);
  const previousWorkRef = useRef<WorkDto | null>(null);
  const activeConnectionRef = useRef<{ token: number; workId: string | null }>({
    token: 0,
    workId: null,
  });
  const startupRetryRef = useRef<number | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const modelProviderModelsRequestRef = useRef(0);

  const refreshLlmHealth = useCallback(async () => {
    try {
      const data = await getProviderHealth();
      setLlmConnected(data.connected);
      setLlmModel(providerHealthName(data));
      setLlmMessage(data.message ?? "");
      return data;
    } catch {
      setLlmConnected(false);
      setLlmMessage(WORKBENCH.modelDisconnectedTitle);
      return null;
    }
  }, []);

  // Check LLM connection status and apply persisted provider settings.
  useEffect(() => {
    const checkLlm = async () => {
      await refreshLlmHealth();
    };

    const initializeProvider = async () => {
      try {
        const state = await loadAndSyncModelProviderState();
        setModelProviderState(state);
        setModelProviderDraft(modelProviderDraftFromState(state));
      } catch {
        setModelProviderMessage(WORKBENCH.modelProviderLoadFailure);
      } finally {
        await checkLlm();
      }
    };

    void initializeProvider();
    const interval = setInterval(checkLlm, 30_000);
    return () => clearInterval(interval);
  }, [refreshLlmHealth]);

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
      if (
        status === "FRESH" ||
        status === "STALE" ||
        status === "REBUILDING" ||
        status === "FAILED"
      ) {
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
        status: "completed",
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
    setCreatingSession(false);
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
    const previousWork = currentWorkRef.current?.id === work.id ? null : currentWorkRef.current;
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

    const markDisconnected = () => {
      if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;
      setSocketConnected(false);
      setLoading(false);
    };

    socket.onClose(markDisconnected);
    socket.onError(markDisconnected);
    channel.onError(markDisconnected);
    channel.onClose(markDisconnected);

    channel
      .join()
      .receive("ok", (response: { work_id?: string; session_id?: string }) => {
        if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id }))
          return;

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
        if (previousWork) {
          previousWorkRef.current = previousWork;
        }
        currentWorkRef.current = { ...work, id: joinedWorkId, title: workTitle };
      })
      .receive("error", () => {
        if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id }))
          return;
        setSocketConnected(false);
        setWorkSwitchingId(null);
      })
      .receive("timeout", () => {
        if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id }))
          return;
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

  async function loadWorksAndOpenInitial(attempt = 0) {
    try {
      const { availableWorks, initialId } = await resolveInitialWorkBootstrap();
      setWorks(availableWorks);
      const work = availableWorks.find((item) => item.id === initialId);
      if (!work) throw new Error(`selected work not found: ${initialId}`);
      await openWork(work);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      // 启动期后端 sidecar 尚未就绪时静默重试，避免把「还没启动完」误报成「未连接」。
      if (isConnectivityFailure(detail) && attempt < STARTUP_MAX_ATTEMPTS) {
        setSocketConnected(false);
        setMessages([startupConnectingMessage()]);
        startupRetryRef.current = window.setTimeout(() => {
          void loadWorksAndOpenInitial(attempt + 1);
        }, STARTUP_RETRY_MS);
        return;
      }

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
      if (startupRetryRef.current !== null) {
        window.clearTimeout(startupRetryRef.current);
        startupRetryRef.current = null;
      }
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
    void sendMessage(channelRef.current, text, context.workId, null, activeSessionId).then(() =>
      setLoading(true),
    );
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
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sendFailure }]);
      setLoading(false);
    }
  }

  const handleCandidateContinue = async (turnResult: TurnResult, candidate: CandidateDirection) => {
    if (!channelRef.current) return;

    const text = candidateContinuationText(candidate.title, candidate.pitch);
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    try {
      await sendMessage(channelRef.current, text, context.workId, null, activeSessionId, false, {
        source_turn_ref: turnResult.turn_id,
        candidate_set_ref: `candidate_set:${turnResult.turn_id}`,
        candidate_ref: candidate.direction_id,
      });
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sendFailure }]);
      setLoading(false);
    }
  };

  const handleAvailableAction = async (
    turnResult: TurnResult,
    action: AvailableActionLike,
    authorPayload?: Record<string, unknown>,
  ) => {
    if (!channelRef.current || action.enabled === false) return;

    try {
      const result = await sendAuthorAction(
        channelRef.current,
        toAuthorActionPayload(turnResult.turn_id, action, authorPayload),
      );
      // 幂等：重复提交（同 idempotency_key）后端不重复执行并回 duplicate=true，
      // 让作者看见"已处理"，而不是静默无反应。
      if (result?.duplicate === true) {
        setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.actionDuplicate }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.actionFailure }]);
    }
  };

  // VS-00E CP3：按质量发现重写——从本轮 available_actions 取出 revise_from_findings 动作，
  // 携带要处理的发现引用提交。后端会另生成一份 tentative 修订草稿（原草稿保留、不自动采纳）。
  const handleReviseFromFindings = async (turnResult: TurnResult, selectedFindingIds?: string[]) => {
    const action = (turnResult.available_actions ?? []).find(
      (candidate) => candidate.action_type === "revise_from_findings",
    );
    if (!action) return;
    await handleAvailableAction(turnResult, action, {
      quality_finding_refs: selectedFindingIds ?? action.quality_finding_refs ?? [],
    });
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

  const artifactForAction = (
    turnResult: TurnResult,
    action: AvailableActionLike,
  ): ArtifactEntry | null =>
    (turnResult.adoption_state?.pending ?? []).find(
      (entry) => entry.artifact_id === action.target_ref,
    ) ?? null;

  // 同一轮有多个角色候选（≥2 个 character_seed pending）时，返回该候选的角色名，
  // 用于区分逐项采纳按钮；单候选返回 null（按钮文案不变）。
  const perCandidateAdoptionName = (
    turnResult: TurnResult,
    artifact: ArtifactEntry | null,
  ): string | null => {
    if (!artifact || artifact.artifact_type !== "character_seed") return null;
    const characterPending = (turnResult.adoption_state?.pending ?? []).filter(
      (entry) => entry.artifact_type === "character_seed",
    );
    if (characterPending.length < 2) return null;
    const items = (artifact.payload as { items?: Array<{ title?: string }> } | undefined)?.items;
    const title = items?.[0]?.title;
    return typeof title === "string" && title.trim() !== "" ? title.trim() : null;
  };

  const actionLabel = (turnResult: TurnResult, action: AvailableActionLike) => {
    if (action.action_type === "confirm_before_execute") return WORKBENCH.actionConfirm;
    if (action.action_type === "reject_or_cancel_confirmation") return WORKBENCH.actionReject;
    if (action.action_type === "cancel_pending_behavior") return WORKBENCH.actionCancel;
    if (action.action_type === "answer_clarification") return WORKBENCH.actionAnswer;
    if (action.action_type === "choose_candidate") return WORKBENCH.candidateAdoptLabel;
    const artifact = artifactForAction(turnResult, action);
    let base: string;
    if (action.action_type === "accept") base = acceptActionLabel(artifact?.artifact_type);
    else if (action.action_type === "discard") base = CARD.tentativeArtifact.discardLabel;
    else if (action.action_type === "edit_then_accept")
      base = editThenAcceptActionLabel(artifact?.artifact_type);
    else return action.action_type;
    // 同一轮存在多个角色候选时，把候选名拼到逐项按钮，避免“两个候选共用一个采纳按钮”。
    const name = perCandidateAdoptionName(turnResult, artifact);
    return name ? CARD.tentativeArtifact.candidateNameSuffix(base, name) : base;
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

  const actionTitle = (turnResult: TurnResult, action: AvailableActionLike) => {
    if (action.disabled_reason) return action.disabled_reason;
    const artifact = artifactForAction(turnResult, action);

    if (action.action_type === "accept") return acceptActionTitle(artifact?.artifact_type);
    if (action.action_type === "discard") return WORKBENCH.discardActionTitle;
    if (action.action_type === "edit_then_accept") {
      return editThenAcceptActionTitle(artifact?.artifact_type);
    }

    return undefined;
  };

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
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.actionUnavailable }]);
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

  const currentWorkForOpen = (): WorkDto | null => {
    if (!context.workId || context.workId === "lobby") return null;

    const currentWork = works.find((work) => work.id === context.workId);

    return (
      currentWork ?? {
        id: context.workId,
        title: visibleWorkTitle,
        genre: null,
        status: "TENTATIVE",
        revision: 1,
        updated_at: null,
        inserted_at: null,
      }
    );
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

  const handleCreateSession = async () => {
    if (!context.workId || context.workId === "lobby" || creatingSession) return;

    setCreatingSession(true);
    try {
      await createWorkSession(context.workId, { title: WORKBENCH.sessionNewTitle });
      const currentWork = currentWorkForOpen();
      if (currentWork) await openWorkRef.current(currentWork);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sessionCreateFailure }]);
    } finally {
      setCreatingSession(false);
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
      const sourceTurnRef =
        [...snapshot.transcript]
          .reverse()
          .find((entry) => typeof entry.turn_id === "string" && entry.turn_id.trim().length > 0)
          ?.turn_id ?? null;
      setReadOnlySession(shouldOpenReadOnly ? snapshot.session : null);
      setReadOnlySourceTurnRef(shouldOpenReadOnly ? sourceTurnRef : null);
      setMessages(restoredMessages);
      setResumePendingAdoptions(
        shouldOpenReadOnly ? [] : (snapshot.pending_adoptions as unknown as ArtifactEntry[]),
      );
      setResumeResolvedAdoptions(
        shouldOpenReadOnly ? [] : (snapshot.resolved_adoptions as unknown as ArtifactEntry[]),
      );
      setTranscriptRestored(restoredMessages.length > 0);
      resumeRestoredTranscriptRef.current = restoredMessages.length > 0;
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sessionOpenFailure }]);
    }
  };

  const handleBranchFromReadOnlySession = async () => {
    if (!context.workId || context.workId === "lobby" || !readOnlySession || branchingSession)
      return;

    setBranchingSession(true);
    try {
      const created = await createWorkSession(context.workId, {
        title: WORKBENCH.sessionBranchTitle(readOnlySession.title),
        source_session_ref: readOnlySession.id,
        ...(readOnlySourceTurnRef ? { source_turn_ref: readOnlySourceTurnRef } : {}),
      });
      setSessions((prev) => [created, ...prev.filter((session) => session.id !== created.id)]);
      const currentWork = currentWorkForOpen();
      if (currentWork) await openWorkRef.current(currentWork);
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
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: WORKBENCH.sessionArchiveFailure },
      ]);
    }
  };

  const handleRefreshWorks = async () => {
    try {
      setWorks(await listWorks());
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `${WORKBENCH.switchFailurePrefix}${WORKBENCH.startupFailureLoadWork}`,
        },
      ]);
    }
  };

  const handleSelectWork = async (work: WorkDto) => {
    if (work.id === context.workId || workSwitchingId) return;
    setWorkMenuOpen(false);
    await openWork(work);
  };

  const handleCreateUnnamedWork = async () => {
    if (workSwitchingId) return;
    try {
      const created = await createWork({ title: WORKBENCH.unnamedWorkTitle });
      setWorks((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setWorkMenuOpen(false);
      await openWork(created);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.createWorkFailure }]);
    }
  };

  const openCreateWorkDialog = () => {
    if (workSwitchingId) return;
    setWorkMenuOpen(false);
    setWorkDialog({ mode: "create", title: "", error: null, submitting: false });
  };

  const openRenameWorkDialog = (work: WorkDto) => {
    if (workSwitchingId) return;
    setWorkMenuOpen(false);
    setWorkDialog({ mode: "rename", work, title: work.title, error: null, submitting: false });
  };

  const openDiscardWorkDialog = (work: WorkDto) => {
    if (workSwitchingId) return;
    setWorkMenuOpen(false);
    setWorkDialog({ mode: "discard", work, error: null, submitting: false });
  };

  const updateWorkDialogTitle = (title: string) => {
    setWorkDialog((prev) => {
      if (!prev || prev.mode === "discard") return prev;
      return { ...prev, title, error: null };
    });
  };

  const setWorkDialogError = (message: string) => {
    setWorkDialog((prev) => (prev ? { ...prev, error: message, submitting: false } : prev));
  };

  const setWorkDialogSubmitting = (submitting: boolean) => {
    setWorkDialog((prev) => (prev ? { ...prev, submitting } : prev));
  };

  const handleSubmitWorkDialog = async () => {
    if (!workDialog || workDialog.submitting || workSwitchingId) return;

    if (workDialog.mode === "create") {
      const title = normalizeWorkTitle(workDialog.title);
      if (!isValidWorkTitle(title)) {
        setWorkDialogError(WORKBENCH.workTitleRequired);
        return;
      }

      setWorkDialogSubmitting(true);
      try {
        const created = await createWork({ title });
        setWorks((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        setWorkDialog(null);
        await openWork(created);
      } catch {
        setWorkDialogError(WORKBENCH.createWorkFailure);
      }
      return;
    }

    if (workDialog.mode === "rename") {
      const title = normalizeWorkTitle(workDialog.title);
      if (!isValidWorkTitle(title)) {
        setWorkDialogError(WORKBENCH.workTitleRequired);
        return;
      }

      setWorkDialogSubmitting(true);
      try {
        const renamed = await renameWork(workDialog.work.id, {
          title,
          revision: workDialog.work.revision,
        });
        setWorks((prev) => prev.map((item) => (item.id === renamed.id ? renamed : item)));
        if (currentWorkRef.current?.id === renamed.id) {
          currentWorkRef.current = renamed;
        }
        if (previousWorkRef.current?.id === renamed.id) {
          previousWorkRef.current = renamed;
        }
        if (context.workId === renamed.id) {
          setContext({ workTitle: renamed.title });
        }
        setWorkDialog(null);
      } catch {
        setWorkDialogError(WORKBENCH.workUpdateFailure);
      }
      return;
    }

    setWorkDialogSubmitting(true);
    try {
      const discarded = await discardWork(workDialog.work.id, {
        revision: workDialog.work.revision,
      });
      let remainingWorks = works.filter((item) => item.id !== discarded.id);
      try {
        remainingWorks = (await listWorks()).filter((item) => item.id !== discarded.id);
      } catch {
        // The discard already succeeded; keep the UI moving with the locally known list.
      }
      setWorks(remainingWorks);
      setWorkDialog(null);
      if (previousWorkRef.current?.id === discarded.id) {
        previousWorkRef.current = null;
      }
      if (currentWorkRef.current?.id === discarded.id) {
        currentWorkRef.current = null;
      }

      if (context.workId === discarded.id) {
        const previousWork = previousWorkRef.current;
        const preferredFallback = previousWork
          ? remainingWorks.find((item) => item.id === previousWork.id)
          : null;
        const nextWork =
          preferredFallback ??
          remainingWorks[0] ??
          (await createWork({ title: WORKBENCH.unnamedWorkTitle }));
        setWorks((prev) => [nextWork, ...prev.filter((item) => item.id !== nextWork.id)]);
        await openWork(nextWork);
      }
    } catch {
      setWorkDialogError(WORKBENCH.workDeleteFailure);
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

  const openModelProviderDialog = async () => {
    setModelProviderMessage(null);

    if (modelProviderState) {
      const draft = modelProviderDraftFromState(modelProviderState);
      setModelProviderDraft(draft);
      setModelProviderDialogOpen(true);
      void loadModelProviderModels(draft, modelProviderState);
      return;
    }

    try {
      const state = await loadAndSyncModelProviderState();
      const draft = modelProviderDraftFromState(state);
      setModelProviderState(state);
      setModelProviderDraft(draft);
      void loadModelProviderModels(draft, state);
    } catch (error) {
      const detail = errorDetail(error);
      setModelProviderMessage(
        detail
          ? WORKBENCH.modelProviderLoadFailureDetail(detail)
          : WORKBENCH.modelProviderLoadFailure,
      );
    } finally {
      setModelProviderDialogOpen(true);
    }
  };

  const handleModelProviderDialogOpenChange = (open: boolean) => {
    if (open) {
      void openModelProviderDialog();
      return;
    }

    setModelProviderDialogOpen(false);
  };

  const updateModelProviderDraftProvider = (provider: ProviderId) => {
    const draft = modelProviderDraftForProvider(modelProviderState, provider);
    setModelProviderDraft(draft);
    setModelProviderMessage(null);
    void loadModelProviderModels(draft, modelProviderState);
  };

  const modelProviderApiKeyForSubmit = async (
    draft: ModelProviderDraft = modelProviderDraft,
  ): Promise<string | null> => {
    const trimmed = draft.apiKey.trim();
    if (draft.clearApiKey) return null;
    if (trimmed) return trimmed;
    if (draft.apiKeyConfigured) {
      return await getStoredProviderApiKey(draft.provider);
    }
    return null;
  };

  const loadModelProviderModels = async (
    draft: ModelProviderDraft,
    state: ModelProviderRuntimeState | null,
  ) => {
    const requestId = modelProviderModelsRequestRef.current + 1;
    modelProviderModelsRequestRef.current = requestId;
    setModelProviderModels([]);
    setModelProviderModelsMessage(null);

    if (!state || draft.provider === "stub") {
      setModelProviderModelsLoading(false);
      if (draft.provider === "stub") {
        setModelProviderModelsMessage(WORKBENCH.modelProviderModelsUnsupported);
      }
      return;
    }

    if (modelProviderDraftHasInvalidEndpoint(draft, state)) {
      setModelProviderModelsLoading(false);
      setModelProviderModelsMessage(WORKBENCH.modelProviderEndpointInvalid);
      return;
    }

    setModelProviderModelsLoading(true);

    try {
      const result = await listProviderModels({
        provider: draft.provider,
        endpoint: draft.endpoint,
        apiKey: await modelProviderApiKeyForSubmit(draft),
        clearApiKey: draft.clearApiKey,
      });

      if (modelProviderModelsRequestRef.current !== requestId) return;

      setModelProviderModels(result.models);
      setModelProviderModelsMessage(
        result.ok ? null : result.message || WORKBENCH.modelProviderModelsLoadFailure,
      );

      if (result.models.length > 0) {
        setModelProviderDraft((prev) => {
          if (prev.provider !== draft.provider) return prev;
          if (result.models.some((model) => model.id === prev.model)) return prev;
          return { ...prev, model: result.models[0]?.id ?? prev.model };
        });
      }
    } catch (error) {
      if (modelProviderModelsRequestRef.current !== requestId) return;

      const detail = errorDetail(error);
      setModelProviderModels([]);
      setModelProviderModelsMessage(
        detail
          ? WORKBENCH.modelProviderModelsLoadFailureDetail(detail)
          : WORKBENCH.modelProviderModelsLoadFailure,
      );
    } finally {
      if (modelProviderModelsRequestRef.current === requestId) {
        setModelProviderModelsLoading(false);
      }
    }
  };

  const handleModelProviderTest = async () => {
    if (modelProviderTesting) return;
    if (modelProviderDraftHasInvalidEndpoint(modelProviderDraft, modelProviderState)) {
      setModelProviderMessage(WORKBENCH.modelProviderEndpointInvalid);
      return;
    }

    setModelProviderTesting(true);
    setModelProviderMessage(null);

    try {
      const result = await testProviderConnection({
        provider: modelProviderDraft.provider,
        model: modelProviderDraft.model,
        endpoint: modelProviderDraft.endpoint,
        apiKey: await modelProviderApiKeyForSubmit(),
        clearApiKey: modelProviderDraft.clearApiKey,
        thinking: modelProviderDraft.thinking,
        reasoningEffort: modelProviderDraft.reasoningEffort,
      });

      setModelProviderMessage(
        result.ok && result.connected !== false
          ? WORKBENCH.modelProviderTestSuccess
          : result.message || WORKBENCH.modelProviderTestFailure,
      );
    } catch (error) {
      const detail = errorDetail(error);
      setModelProviderMessage(
        detail
          ? WORKBENCH.modelProviderTestFailureDetail(detail)
          : WORKBENCH.modelProviderTestFailure,
      );
    } finally {
      setModelProviderTesting(false);
    }
  };

  const handleModelProviderSave = async () => {
    if (modelProviderSaving) return;
    if (modelProviderDraftHasInvalidEndpoint(modelProviderDraft, modelProviderState)) {
      setModelProviderMessage(WORKBENCH.modelProviderEndpointInvalid);
      return;
    }

    setModelProviderSaving(true);
    setModelProviderMessage(null);

    try {
      const state = await saveAndApplyModelProviderConfig({
        provider: modelProviderDraft.provider,
        model: modelProviderDraft.model,
        endpoint: modelProviderDraft.endpoint,
        apiKey: await modelProviderApiKeyForSubmit(),
        clearApiKey: modelProviderDraft.clearApiKey,
        thinking: modelProviderDraft.thinking,
        reasoningEffort: modelProviderDraft.reasoningEffort,
      });

      setModelProviderState(state);
      setModelProviderDraft(modelProviderDraftFromState(state));
      setModelProviderDialogOpen(false);
      await refreshLlmHealth();
    } catch (error) {
      const detail = errorDetail(error);
      setModelProviderMessage(
        detail
          ? WORKBENCH.modelProviderSaveFailureDetail(detail)
          : WORKBENCH.modelProviderSaveFailure,
      );
    } finally {
      setModelProviderSaving(false);
    }
  };

  const traceUnavailableSummary = (): TraceSummaryView => ({
    primaryReason: TRACE.replayUnavailable,
    decisionLabel: TRACE.decisions.unknown,
    goal: null,
    contextSources: [],
    detailLines: [],
    integrityNote: TRACE.integrityNote,
  });

  const openTraceDialog = async (turnId: string, traceSummary?: Record<string, unknown>) => {
    const fallbackSummary = toAuthorTraceSummary(traceSummary);
    if (fallbackSummary) setTraceDialog({ turnId, summary: fallbackSummary });

    const workId = context.workId;
    const sessionId = readOnlySession?.id ?? activeSessionIdRef.current;
    if (!workId || workId === "lobby" || !sessionId) {
      if (!fallbackSummary) setTraceDialog({ turnId, summary: traceUnavailableSummary() });
      return;
    }

    try {
      const replay = await getTurnReplay(workId, sessionId, turnId);
      const replaySummary = toAuthorTraceSummary(replay.trace_summary);
      if (replaySummary) setTraceDialog({ turnId, summary: replaySummary });
    } catch {
      if (!fallbackSummary) setTraceDialog({ turnId, summary: traceUnavailableSummary() });
    }
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
  const leftColumnClassName = [styles.leftColumn, isPanelOpen ? styles.leftColumnDimmed : ""].join(
    " ",
  );
  const taskStatusLabel = workSwitchingId
    ? WORKBENCH.taskSwitchingLabel
    : longRun.status === "running"
      ? WORKBENCH.taskRunningLabel(longRun.budgetUsed)
      : longRun.status === "checkpoint"
        ? WORKBENCH.taskCheckpointLabel
        : longRun.status === "completed"
          ? WORKBENCH.taskCompletedLabel
          : longRun.status === "failed"
            ? WORKBENCH.taskFailedLabel
            : WORKBENCH.taskIdleLabel;
  const modelStatusLabel =
    llmConnected === null
      ? WORKBENCH.modelCheckingLabel
      : llmConnected
        ? WORKBENCH.modelConnectedLabel
        : WORKBENCH.modelDisconnectedLabel;
  const modelStatusValue =
    llmConnected === null
      ? WORKBENCH.modelCheckingLabel
      : llmConnected
        ? llmModel || WORKBENCH.modelConnectedLabel
        : WORKBENCH.modelDisconnectedLabel;
  const modelStatusTitle =
    llmConnected && llmModel
      ? WORKBENCH.modelStatusTitle(llmModel)
      : llmMessage || WORKBENCH.modelDisconnectedTitle;
  const selectedProviderOption = modelProviderState
    ? providerOption(modelProviderState.options, modelProviderState.selectedProvider)
    : null;
  const draftProviderOption = modelProviderState
    ? providerOption(modelProviderState.options, modelProviderDraft.provider)
    : null;
  const modelProviderStatusLabel = selectedProviderOption
    ? `${providerDisplayName(selectedProviderOption)} · ${modelStatusValue}`
    : modelStatusLabel;
  const modelProviderStatusTitle = selectedProviderOption
    ? `${providerDisplayName(selectedProviderOption)} · ${modelStatusTitle}`
    : modelStatusTitle;
  const modelProviderRequiresModel = modelProviderDraft.provider !== "stub";
  const modelProviderEndpointInvalid = modelProviderDraftHasInvalidEndpoint(
    modelProviderDraft,
    modelProviderState,
  );
  const modelProviderSaveDisabled =
    !modelProviderState ||
    modelProviderSaving ||
    modelProviderTesting ||
    modelProviderModelsLoading ||
    modelProviderEndpointInvalid ||
    (modelProviderRequiresModel &&
      (modelProviderDraft.model.trim() === "" || modelProviderModels.length === 0));

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
                <span className={styles.titleText}>{visibleWorkTitle}</span>
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
                    const duplicateIndex = duplicateWorkTitleIndex(work, works);
                    return (
                      <div key={work.id} className={styles.workMenuRow}>
                        <DropdownMenu.Item
                          className={isCurrent ? styles.workMenuItemActive : styles.workMenuItem}
                          disabled={workSwitchingId !== null}
                          onSelect={(event) => {
                            event.preventDefault();
                            void handleSelectWork(work);
                          }}
                        >
                          <span className={styles.workMenuItemTitle}>
                            <span>{work.title}</span>
                            {duplicateIndex !== null && (
                              <span className={styles.workMenuItemMeta}>
                                {WORKBENCH.workMenuDuplicateIndex(duplicateIndex)}
                              </span>
                            )}
                          </span>
                          {isCurrent && (
                            <span className={styles.workMenuCurrent}>
                              {WORKBENCH.workMenuCurrent}
                            </span>
                          )}
                        </DropdownMenu.Item>
                        <button
                          className={styles.workMenuIconButton}
                          type="button"
                          title={WORKBENCH.workMenuRename}
                          disabled={workSwitchingId !== null}
                          onClick={() => openRenameWorkDialog(work)}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                        <button
                          className={styles.workMenuIconButton}
                          type="button"
                          title={WORKBENCH.workMenuDelete}
                          disabled={workSwitchingId !== null}
                          onClick={() => openDiscardWorkDialog(work)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })
                )}
                <DropdownMenu.Separator className={styles.workMenuSeparator} />
                <DropdownMenu.Item
                  className={styles.workMenuCreate}
                  disabled={workSwitchingId !== null}
                  onSelect={(event) => {
                    event.preventDefault();
                    openCreateWorkDialog();
                  }}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>{WORKBENCH.workMenuCreate}</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={styles.workMenuCreate}
                  disabled={workSwitchingId !== null}
                  onSelect={(event) => {
                    event.preventDefault();
                    void handleCreateUnnamedWork();
                  }}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>{WORKBENCH.workMenuQuickCreate}</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Dialog.Root
            open={workDialog !== null}
            onOpenChange={(open) => {
              if (!open && !workDialog?.submitting) setWorkDialog(null);
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className={styles.dialogOverlay} />
              <Dialog.Content className={styles.dialogContent}>
                {workDialog && (
                  <>
                    <Dialog.Title className={styles.dialogTitle}>
                      {workDialog.mode === "create"
                        ? WORKBENCH.workCreateDialogTitle
                        : workDialog.mode === "rename"
                          ? WORKBENCH.workRenameDialogTitle
                          : WORKBENCH.workDeleteDialogTitle}
                    </Dialog.Title>
                    <Dialog.Description className={styles.dialogDescription}>
                      {workDialog.mode === "discard"
                        ? WORKBENCH.workDeleteDescription(workDialog.work.title)
                        : WORKBENCH.workTitleField}
                    </Dialog.Description>
                    {workDialog.mode === "discard" ? (
                      <>
                        <div className={styles.dialogStatus}>
                          {WORKBENCH.workDeleteDescription(workDialog.work.title)}
                        </div>
                        <div className={styles.dialogHint}>{WORKBENCH.workDeleteDetail}</div>
                      </>
                    ) : (
                      <>
                        <label className={styles.dialogLabel} htmlFor="work-title-input">
                          {WORKBENCH.workTitleField}
                        </label>
                        <input
                          id="work-title-input"
                          className={styles.dialogInput}
                          value={workDialog.title}
                          maxLength={120}
                          placeholder={WORKBENCH.workTitlePlaceholder}
                          disabled={workDialog.submitting}
                          onChange={(event) => updateWorkDialogTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleSubmitWorkDialog();
                            }
                          }}
                        />
                      </>
                    )}
                    {workDialog.error && (
                      <div className={styles.dialogError}>{workDialog.error}</div>
                    )}
                    <div className={styles.dialogActions}>
                      <button
                        className={styles.btnSecondary}
                        type="button"
                        onClick={() => setWorkDialog(null)}
                        disabled={workDialog.submitting}
                      >
                        {BUTTON.cancel}
                      </button>
                      <button
                        className={
                          workDialog.mode === "discard" ? styles.btnDanger : styles.btnPrimary
                        }
                        type="button"
                        onClick={() => void handleSubmitWorkDialog()}
                        disabled={
                          workDialog.submitting ||
                          (workDialog.mode !== "discard" && !isValidWorkTitle(workDialog.title))
                        }
                      >
                        {workDialog.mode === "create"
                          ? BUTTON.create
                          : workDialog.mode === "rename"
                            ? BUTTON.save
                            : BUTTON.delete}
                      </button>
                    </div>
                  </>
                )}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
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
                <span className={styles.assistantNameValue}>{assistantDisplayName}</span>
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
            {WORKBENCH.readingModeLabel}
          </button>
          <button
            className={`${styles.btnSecondary} ${styles.readingModeButton}`}
            disabled={!hasValidRuntimeWork}
            onClick={() => setMode("memory")}
          >
            {WORKBENCH.memoryLabel}
          </button>
          <span className={styles.divider1}>/</span>
          <span className={styles.volText}>{context.volumeTitle || WORKBENCH.wholeBookLabel}</span>
        </div>
        <div className={styles.statusGroup}>
          <span className={styles.budgetText}>{taskStatusLabel}</span>
          <Dialog.Root
            open={modelProviderDialogOpen}
            onOpenChange={handleModelProviderDialogOpenChange}
          >
            <Dialog.Trigger asChild>
              <button
                className={`${llmBadgeClassName} ${styles.modelStatusButton}`}
                type="button"
                title={modelProviderStatusTitle}
              >
                <Settings2 size={13} aria-hidden="true" />
                <span className={styles.modelStatusValue}>{modelProviderStatusLabel}</span>
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className={styles.dialogOverlay} />
              <Dialog.Content className={`${styles.dialogContent} ${styles.providerDialogContent}`}>
                <Dialog.Title className={styles.dialogTitle}>
                  {WORKBENCH.modelProviderTitle}
                </Dialog.Title>
                <Dialog.Description className={styles.dialogDescription}>
                  {WORKBENCH.modelProviderDescription}
                </Dialog.Description>
                {modelProviderState && (
                  <>
                    <label className={styles.dialogLabel} htmlFor="model-provider-select">
                      {WORKBENCH.modelProviderField}
                    </label>
                    <select
                      id="model-provider-select"
                      className={styles.dialogInput}
                      value={modelProviderDraft.provider}
                      disabled={modelProviderSaving || modelProviderTesting}
                      onChange={(event) =>
                        updateModelProviderDraftProvider(event.target.value as ProviderId)
                      }
                    >
                      {modelProviderState.options.providers.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    {modelProviderDraft.provider === "openai_subscription" && (
                      <p className={styles.dialogHint}>
                        {WORKBENCH.modelProviderSubscriptionHint}
                      </p>
                    )}

                    {draftProviderOption?.supports_endpoint && (
                      <>
                        <label
                          className={styles.dialogLabel}
                          htmlFor="model-provider-endpoint-input"
                        >
                          {WORKBENCH.modelProviderEndpointField}
                        </label>
                        <input
                          id="model-provider-endpoint-input"
                          className={styles.dialogInput}
                          value={modelProviderDraft.endpoint}
                          maxLength={200}
                          disabled={modelProviderSaving || modelProviderTesting}
                          onChange={(event) => {
                            setModelProviderModels([]);
                            setModelProviderModelsMessage(null);
                            setModelProviderMessage(null);
                            setModelProviderDraft((prev) => ({
                              ...prev,
                              endpoint: event.target.value,
                              model: "",
                            }));
                          }}
                        />
                        {modelProviderEndpointInvalid && (
                          <div className={styles.dialogHint}>
                            {WORKBENCH.modelProviderEndpointInvalid}
                          </div>
                        )}
                      </>
                    )}

                    {draftProviderOption?.supports_api_key && (
                      <>
                        <label
                          className={styles.dialogLabel}
                          htmlFor="model-provider-api-key-input"
                        >
                          {WORKBENCH.modelProviderApiKeyField}
                        </label>
                        <input
                          id="model-provider-api-key-input"
                          className={styles.dialogInput}
                          type="password"
                          value={modelProviderDraft.apiKey}
                          maxLength={200}
                          autoComplete="off"
                          placeholder={
                            modelProviderDraft.apiKeyConfigured
                              ? WORKBENCH.modelProviderApiKeyPlaceholder
                              : undefined
                          }
                          disabled={
                            modelProviderSaving ||
                            modelProviderTesting ||
                            modelProviderDraft.clearApiKey
                          }
                          onChange={(event) => {
                            setModelProviderModels([]);
                            setModelProviderModelsMessage(null);
                            setModelProviderDraft((prev) => ({
                              ...prev,
                              apiKey: event.target.value,
                              clearApiKey: false,
                              model: "",
                            }));
                          }}
                        />
                        {modelProviderDraft.apiKeyConfigured && (
                          <div className={styles.dialogHint}>
                            {WORKBENCH.modelProviderApiKeyConfigured}
                          </div>
                        )}
                        {modelProviderDraft.apiKeyConfigured && (
                          <label className={styles.dialogCheckboxRow}>
                            <input
                              type="checkbox"
                              checked={modelProviderDraft.clearApiKey}
                              disabled={modelProviderSaving || modelProviderTesting}
                              onChange={(event) => {
                                setModelProviderModels([]);
                                setModelProviderModelsMessage(null);
                                setModelProviderDraft((prev) => ({
                                  ...prev,
                                  apiKey: "",
                                  clearApiKey: event.target.checked,
                                  model: "",
                                }));
                              }}
                            />
                            <span>{WORKBENCH.modelProviderClearApiKey}</span>
                          </label>
                        )}
                      </>
                    )}

                    <label className={styles.dialogLabel} htmlFor="model-provider-model-input">
                      {WORKBENCH.modelProviderModelField}
                    </label>
                    <div className={styles.modelSelectRow}>
                      <select
                        id="model-provider-model-input"
                        className={styles.dialogInput}
                        value={modelProviderDraft.model}
                        disabled={
                          modelProviderSaving ||
                          modelProviderTesting ||
                          modelProviderModelsLoading ||
                          modelProviderModels.length === 0
                        }
                        onChange={(event) =>
                          setModelProviderDraft((prev) => ({ ...prev, model: event.target.value }))
                        }
                      >
                        {modelProviderModels.length > 0 ? (
                          modelProviderModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label}
                            </option>
                          ))
                        ) : (
                          <option value={modelProviderDraft.model}>
                            {modelProviderModelsLoading
                              ? WORKBENCH.modelProviderModelsLoading
                              : modelProviderDraft.model || WORKBENCH.modelProviderNoModels}
                          </option>
                        )}
                      </select>
                      <button
                        className={styles.modelRefreshButton}
                        type="button"
                        aria-label={WORKBENCH.modelProviderRefreshModels}
                        title={WORKBENCH.modelProviderRefreshModels}
                        disabled={
                          modelProviderSaving ||
                          modelProviderTesting ||
                          modelProviderModelsLoading ||
                          modelProviderEndpointInvalid
                        }
                        onClick={() => {
                          void loadModelProviderModels(modelProviderDraft, modelProviderState);
                        }}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                      </button>
                    </div>
                    {modelProviderModelsMessage && (
                      <div className={styles.dialogHint}>{modelProviderModelsMessage}</div>
                    )}

                    {draftProviderOption?.supports_thinking && (
                      <>
                        <label className={styles.dialogCheckboxRow}>
                          <input
                            type="checkbox"
                            checked={modelProviderDraft.thinking === "enabled"}
                            disabled={modelProviderSaving || modelProviderTesting}
                            onChange={(event) =>
                              setModelProviderDraft((prev) => ({
                                ...prev,
                                thinking: event.target.checked ? "enabled" : "disabled",
                              }))
                            }
                          />
                          <span>{WORKBENCH.modelProviderThinkingField}</span>
                          <span className={styles.dialogHint}>
                            {modelProviderDraft.thinking === "enabled"
                              ? WORKBENCH.modelProviderThinkingEnabled
                              : WORKBENCH.modelProviderThinkingDisabled}
                          </span>
                        </label>
                        {modelProviderDraft.thinking === "enabled" && (
                          <>
                            <label
                              className={styles.dialogLabel}
                              htmlFor="model-provider-reasoning-input"
                            >
                              {WORKBENCH.modelProviderReasoningField}
                            </label>
                            <select
                              id="model-provider-reasoning-input"
                              className={styles.dialogInput}
                              value={modelProviderDraft.reasoningEffort}
                              disabled={modelProviderSaving || modelProviderTesting}
                              onChange={(event) =>
                                setModelProviderDraft((prev) => ({
                                  ...prev,
                                  reasoningEffort: normalizeReasoningEffort(event.target.value),
                                }))
                              }
                            >
                              {REASONING_EFFORT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
                {modelProviderMessage && (
                  <div className={styles.dialogStatus}>{modelProviderMessage}</div>
                )}
                <div className={styles.dialogActions}>
                  <button
                    className={styles.btnSecondary}
                    type="button"
                    disabled={modelProviderSaving || modelProviderTesting}
                    onClick={() => setModelProviderDialogOpen(false)}
                  >
                    {BUTTON.cancel}
                  </button>
                  <button
                    className={styles.btnSecondary}
                    type="button"
                    disabled={
                      !modelProviderState ||
                      modelProviderSaving ||
                      modelProviderTesting ||
                      modelProviderEndpointInvalid
                    }
                    onClick={() => {
                      void handleModelProviderTest();
                    }}
                  >
                    {modelProviderTesting
                      ? WORKBENCH.modelProviderTesting
                      : WORKBENCH.modelProviderTest}
                  </button>
                  <button
                    className={styles.sendBtn}
                    type="button"
                    disabled={modelProviderSaveDisabled}
                    onClick={() => {
                      void handleModelProviderSave();
                    }}
                  >
                    {modelProviderSaving
                      ? WORKBENCH.modelProviderSaving
                      : WORKBENCH.modelProviderSave}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <div className={serviceBadgeClassName}>{WORKBENCH.syncStatusLabel(connectionLabel)}</div>
        </div>
      </div>

      {/* 主工作区域 (Main Area) */}
      <div className={styles.mainArea}>
        {/* 左侧对话与输入列 (Left Column) */}
        <div className={leftColumnClassName}>
          {/* 对话流区域 (Chat Area) */}
          <div className={styles.chatArea}>
            {isReadOnlySessionView && (
              <div className={styles.readOnlySessionBanner}>
                <div>
                  <div className={styles.readOnlySessionTitle}>
                    {WORKBENCH.sessionReadOnlyTitle}
                  </div>
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
              <div key={i} className={msg.role === "user" ? styles.userMsg : styles.assistantMsg}>
                <div className={styles.role}>
                  {assistantRoleLabel(msg.role, assistantDisplayName)}
                </div>
                {msg.role === "assistant" &&
                  msg.turnResult?.frame_summary &&
                  (() => {
                    const framePresentation = framePresentationForSummary(
                      {
                        ...msg.turnResult.frame_summary,
                        decision_type: msg.turnResult.trace_summary?.decision_type,
                      },
                    );

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

                {msg.role === "assistant" && msg.turnResult && (
                  <button
                    className={styles.traceWhyButton}
                    type="button"
                    title={TRACE.actionTitle}
                    onClick={() =>
                      void openTraceDialog(msg.turnResult!.turn_id, msg.turnResult!.trace_summary)
                    }
                  >
                    <CircleHelp size={14} aria-hidden="true" />
                    <span>{TRACE.actionLabel}</span>
                  </button>
                )}

                {!isReadOnlySessionView &&
                  msg.turnResult?.ui_cards?.map((card, ci) => {
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

                {(() => {
                  const turnResult = msg.turnResult;
                  if (!isReadOnlySessionView && turnResult && turnResult.quality_review) {
                    const qr = turnResult.quality_review;
                    const turnId = turnResult.turn_id;
                    const defaultIds = qr.findings.map((f) => f.validator || "");

                    return (
                      <QualityReviewCard
                        review={qr}
                        selectedFindingIds={selectedFindingIdsMap[turnId] ?? defaultIds}
                        onToggleFinding={(findingId) => {
                          setSelectedFindingIdsMap((prev) => {
                            const current = prev[turnId] ?? defaultIds;
                            const next = current.includes(findingId)
                              ? current.filter((id) => id !== findingId)
                              : [...current, findingId];
                            return { ...prev, [turnId]: next };
                          });
                        }}
                        onToggleAllFindings={() => {
                          setSelectedFindingIdsMap((prev) => {
                            const current = prev[turnId] ?? defaultIds;
                            const next = current.length === defaultIds.length ? [] : defaultIds;
                            return { ...prev, [turnId]: next };
                          });
                        }}
                        onRevise={
                          (turnResult.available_actions ?? []).some(
                            (action) => action.action_type === "revise_from_findings",
                          )
                            ? () => {
                                const selected = selectedFindingIdsMap[turnId] ?? defaultIds;
                                void handleReviseFromFindings(turnResult, selected);
                              }
                            : undefined
                        }
                        revising={loading}
                      />
                    );
                  }
                  return null;
                })()}

                {!isReadOnlySessionView &&
                  msg.turnResult?.candidate_directions &&
                  msg.turnResult.candidate_directions.length > 0 && (
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

                {!isReadOnlySessionView &&
                  msg.turnResult &&
                  visibleAvailableActions(msg.turnResult).length > 0 && (
                    <div className={styles.cardActions}>
                      {visibleAvailableActions(msg.turnResult).map((action) => (
                        <button
                          key={action.action_id}
                          className={styles.btnSecondary}
                          disabled={action.enabled === false}
                          title={actionTitle(msg.turnResult!, action)}
                          onClick={() => {
                            if (msg.turnResult) {
                              handleVisibleAvailableAction(msg.turnResult, action);
                            }
                          }}
                        >
                          {actionLabel(msg.turnResult!, action)}
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

          {/* 修改后保存：编辑弹窗 (edit_then_accept) */}
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
                    setEditDialog((prev) => (prev ? { ...prev, text: event.target.value } : prev))
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
        {!isPanelOpen && (
          <div className={styles.structureRailCollapsed}>
            <div className={styles.spTitle}>{WORKBENCH.archiveRailTitle}</div>
            <div className={styles.railSummary}>
              <div className={styles.openArchiveEntry} onClick={() => setIsPanelOpen(true)}>
                <span className={styles.spItemCardText}>
                  {WORKBENCH.archiveRailOpen}
                  <br />
                  {WORKBENCH.archiveRailDetail}
                </span>
              </div>
              {pendingAdoptionsCount > 0 && (
                <div className={styles.spItemTitle}>
                  {WORKBENCH.pendingAdoptionsPrefix} {pendingAdoptionsCount}
                </div>
              )}
              <WorkspaceSessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                sessionSearch={sessionSearch}
                canCreateSession={
                  socketConnected && Boolean(context.workId) && context.workId !== "lobby"
                }
                creatingSession={creatingSession}
                onSessionSearch={(query) => {
                  void handleSessionSearch(query);
                }}
                onOpenSession={(session) => {
                  void handleOpenSession(session);
                }}
                onCreateSession={() => {
                  void handleCreateSession();
                }}
                onArchiveSession={(session) => {
                  void handleArchiveSession(session);
                }}
              />
            </div>
          </div>
        )}
        {/* StructurePanel 常驻挂载（关闭时自身渲染 null），使作品档案快照在关闭/重开间保留，
            模型执行期间打开档案能立刻显示上次已知快照而不是空白。 */}
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
              void handleSend(STRUCTURE_PANEL.startPlanningPrompt, {
                generateMicroPlan: true,
              });
            }}
            onCreateCharacter={() => {
              void handleSend(STRUCTURE_PANEL.createCharacterPrompt, { generateMicroPlan: true });
            }}
            onDraftChapter={(chapterBrief) => {
              void handleSend(
                `请根据已采纳章节计划生成${chapterBrief}正文草稿，保持为待采纳草稿。`,
                {
                  generateMicroPlan: true,
                },
              );
            }}
            onNewForeshadowing={() => {
              void handleSend(STRUCTURE_PANEL.newForeshadowingPrompt, {
                generateMicroPlan: true,
              });
            }}
            onNewRule={() => {
              void handleSend(STRUCTURE_PANEL.newRulePrompt, { generateMicroPlan: true });
            }}
            onNewAction={(prompt) => {
              void handleSend(prompt, { generateMicroPlan: true });
              setIsPanelOpen(false);
            }}
          />
      </div>
    </div>
  );
}
