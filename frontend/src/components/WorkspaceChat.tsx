// Design: docs/design/ui/41-workbench-layout.md §2 (3-zone workbench)
// Design: docs/design/ui/42-card-system.md §2 (card type to VS-05 mapping)
// Design: docs/design/ui/46-state-and-feedback.md §9 (Agentic loop reasoning flow)
// Prototype: novel-studio.pen → 41§3-main-workbench (ZOwOi), 46§9-agentic-loop-reasoning-flow (DM8gx)
import { Fragment, useCallback, useEffect, useState, useRef } from "react";
import type { SyntheticEvent } from "react";
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
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  CircleX,
} from "lucide-react";

import {
  createSocket,
  joinWorkspace,
  sendMessage,
  sendAuthorAction,
  sendAgentCommand,
  onAgentEvent,
  onAgentRunState,
  onTaskState,
  type AgentEventData,
  type AgentCommand,
  type AgentRunStateData,
  type SendMessageResult,
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
  getSessionTranscriptPage,
  getTurnReplay,
  getTurnAgentRunActivity,
  createWorkSession,
  archiveWorkSession,
  transcriptToMessages,
  type SessionTranscriptPageInfo,
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
  agentRunEventDetailItems,
  agentRunProviderFlowSummary,
  agentRunProviderRunDetailItems,
  agentRunProviderRunReplayDetails,
  agentRunReasoningFlow,
  selectAgentRunVisibleEvents,
  type AgenticLoopReasoningFlow,
  type AgentRunProviderUsageData,
} from "../lib/agentRunTimeline";
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
import { shouldRouteInputToAgentSteer } from "../lib/agentRunInputRouting";
import {
  bindAgentRunAckToUserMessage,
  mergeAgentRunRuntimeState,
  messageAnchorsAgentRun,
  shouldRenderAnchoredAgentRunStatus,
  shouldRenderStandaloneAgentRunStatus,
  shouldRenderUserAgentRunPlaceholder,
  upsertAssistantTurnResultMessage,
} from "../lib/agentRunAnchoring";
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
  agent_run?: {
    run_id?: string;
    run_mode?: string;
    status?: string;
    phase?: string;
    parent_turn_ref?: string | null;
    profile_ref?: string;
    long_run_task_ref?: string | null;
    events?: AgentEventData[];
    provider_runs?: AgentRunProviderUsageData[];
    activity_loaded?: boolean;
  };
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

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  turnId?: string | null;
  clientMessageId?: string;
  agentRunId?: string | null;
  turnResult?: TurnResult;
}

interface PendingAgentRunAnchor {
  clientMessageId: string;
  text: string;
}

function removePendingAgentRunAnchor(
  anchors: Record<string, PendingAgentRunAnchor>,
  clientMessageId: string,
): Record<string, PendingAgentRunAnchor> {
  const next = { ...anchors };
  delete next[clientMessageId];
  return next;
}

type AgentRunEventStage =
  | "understanding"
  | "context"
  | "planning"
  | "authorAdjustment"
  | "execution"
  | "result";

interface AgentRunStageView {
  stage: AgentRunEventStage;
  events: AgentEventData[];
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
const AGENT_RUN_EVENT_VISIBLE_LIMIT = 96;
const TERMINAL_AGENT_RUN_STATUSES = new Set(["completed", "cancelled", "failed"]);
const AGENT_RUN_STAGE_ORDER: AgentRunEventStage[] = [
  "understanding",
  "context",
  "planning",
  "authorAdjustment",
  "execution",
  "result",
];

function turnResultAgentRunId(turnResult: TurnResult | undefined): string | null {
  const runId = turnResult?.agent_run?.run_id;
  return typeof runId === "string" && runId.trim() !== "" ? runId : null;
}

function stateFromTurnResult(turnResult: TurnResult): AgentRunStateData | null {
  const runId = turnResultAgentRunId(turnResult);
  if (!runId) return null;

  return {
    run_id: runId,
    run_mode: turnResult.agent_run?.run_mode ?? "bounded",
    status: turnResult.agent_run?.status ?? "completed",
    phase: turnResult.agent_run?.phase ?? "completed",
    long_run_task_ref: turnResult.agent_run?.long_run_task_ref ?? null,
    parent_turn_ref: turnResult.agent_run?.parent_turn_ref ?? turnResult.parent_turn_id ?? null,
    profile_ref: turnResult.agent_run?.profile_ref ?? null,
  };
}

function agentRunEventsFromTurnResult(turnResult: TurnResult | undefined): AgentEventData[] {
  const events = turnResult?.agent_run?.events;
  if (!Array.isArray(events)) return [];

  return events.filter(isAgentEventData);
}

function isAgentEventData(event: unknown): event is AgentEventData {
  return (
    Boolean(event) &&
    typeof event === "object" &&
    typeof (event as AgentEventData).event_id === "string" &&
    typeof (event as AgentEventData).run_ref === "string" &&
    typeof (event as AgentEventData).event_type === "string" &&
    typeof (event as AgentEventData).visibility === "string" &&
    typeof (event as AgentEventData).summary === "string" &&
    typeof (event as AgentEventData).sequence === "number"
  );
}

function mergeAgentRunEvents(restored: AgentEventData[], live: AgentEventData[]): AgentEventData[] {
  const byKey = new Map<string, AgentEventData>();

  for (const event of [...restored, ...live]) {
    byKey.set(event.event_id || `${event.run_ref}:${event.sequence}:${event.event_type}`, event);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return (a.emitted_at ?? "").localeCompare(b.emitted_at ?? "");
  });
}

function agentRunEventStage(eventType: string): AgentRunEventStage {
  switch (eventType) {
    case "run_started":
    case "goal_understood":
      return "understanding";
    case "exploration_observed":
      return "context";
    case "plan_drafted":
    case "plan_revised":
    case "evaluation_made":
    case "gate_decided":
      return "planning";
    case "plan_adjusted":
    case "interrupt_requested":
    case "run_pausing":
    case "run_paused":
    case "run_resumed":
    case "awaiting_author":
    case "checkpoint_created":
      return "authorAdjustment";
    case "tool_started":
    case "tool_completed":
    case "provider_progress":
    case "quality_review_started":
    case "quality_finding_created":
    case "turn_result_ready":
      return "execution";
    case "artifact_created":
    case "run_completed":
    case "run_cancelled":
    case "run_failed":
    default:
      return "result";
  }
}

function groupAgentRunEvents(events: AgentEventData[]): AgentRunStageView[] {
  const groups = new Map<AgentRunEventStage, AgentEventData[]>(
    AGENT_RUN_STAGE_ORDER.map((stage) => [stage, []]),
  );

  for (const event of events) {
    const summary = event.summary?.trim();
    if (event.visibility !== "author" || !summary || !isAgenticLoopEventType(event.event_type)) {
      continue;
    }
    groups.get(agentRunEventStage(event.event_type))?.push(event);
  }

  return AGENT_RUN_STAGE_ORDER.map((stage) => ({ stage, events: groups.get(stage) ?? [] })).filter(
    (group) => group.events.length > 0,
  );
}

function isAgenticLoopEventType(eventType: string): boolean {
  return ["plan_drafted", "plan_revised", "exploration_observed", "evaluation_made"].includes(
    eventType,
  );
}

function presentAgentEventSummary(summary: string): string {
  const trimmed = summary.trim();

  switch (trimmed) {
    case "AgentRun 已启动。":
      return WORKBENCH.agentRunStartedSummary;
    case "AgentRun 已完成。":
      return WORKBENCH.agentRunCompletedSummary;
    case "AgentRun 已恢复。":
      return WORKBENCH.agentRunResumedSummary;
    case "正在取消 AgentRun。":
      return WORKBENCH.agentRunCancellingSummary;
    case "AgentRun 未取得新进展，已停止等待作者确认。":
      return WORKBENCH.agentRunNoProgressSummary;
    default:
      return trimmed.replaceAll("AgentRun", WORKBENCH.agentRunUserFacingName);
  }
}

function latestAgentRunSummary(
  run: AgentRunStateData | null,
  events: AgentEventData[],
  preparing: boolean,
): string {
  if (preparing) return WORKBENCH.agentRunPreparingEvent;

  const lastSummary = events.at(-1)?.summary?.trim();
  if (lastSummary) return presentAgentEventSummary(lastSummary);

  if (!run) return WORKBENCH.agentRunEmptyEvent;
  return WORKBENCH.agentRunFallbackStatus(WORKBENCH.agentRunStatusLabels[run.status] ?? run.status);
}

type AgenticLoopPhaseKey =
  | "plan"
  | "explore"
  | "evaluate"
  | "replan"
  | "execute"
  | "review"
  | "complete";
type AgenticLoopPhaseStatus = "pending" | "active" | "done";

interface AgenticLoopPhaseChip {
  key: AgenticLoopPhaseKey;
  status: AgenticLoopPhaseStatus;
}

function agenticLoopPhaseStrip(
  run: AgentRunStateData | null,
  events: AgentEventData[],
  reasoningFlow: AgenticLoopReasoningFlow,
  preparing: boolean,
): AgenticLoopPhaseChip[] {
  const hasPlan =
    reasoningFlow.planSteps.length > 0 ||
    events.some((event) => event.event_type === "plan_drafted");
  const explored = events.some((event) => event.event_type === "exploration_observed");
  const evaluated = events.some((event) => event.event_type === "evaluation_made");
  const hasNarrative = reasoningFlow.narrativeEvents.length > 0;
  const replanned = events.some((event) => event.event_type === "plan_revised");
  const completed =
    (run !== null && TERMINAL_AGENT_RUN_STATUSES.has(run.status)) ||
    events.some((event) =>
      ["run_completed", "run_cancelled", "run_failed", "turn_result_ready"].includes(
        event.event_type,
      ),
    );
  const executionObserved =
    completed ||
    events.some((event) => ["gate_decided", "turn_result_ready"].includes(event.event_type)) ||
    reasoningFlow.planSteps.some((step) => step.kind === "act" && step.status === "done");
  const activeKey: AgenticLoopPhaseKey | null = completed
    ? null
    : replanned
      ? "replan"
      : executionObserved
        ? "execute"
        : evaluated
          ? "evaluate"
          : explored
            ? "explore"
            : hasPlan || hasNarrative || preparing || run !== null
              ? "plan"
              : null;

  const phaseStatus = (key: AgenticLoopPhaseKey, done: boolean): AgenticLoopPhaseStatus => {
    if (done) return "done";
    if (activeKey === key) return "active";
    return "pending";
  };

  return [
    { key: "plan", status: phaseStatus("plan", hasPlan || completed) },
    { key: "explore", status: phaseStatus("explore", explored || completed) },
    { key: "evaluate", status: phaseStatus("evaluate", evaluated || completed) },
    { key: "replan", status: phaseStatus("replan", replanned) },
    { key: "execute", status: phaseStatus("execute", executionObserved) },
    { key: "review", status: phaseStatus("review", completed) },
    { key: "complete", status: phaseStatus("complete", completed) },
  ];
}

function agenticLoopStatusTone(run: AgentRunStateData | null): AgenticLoopPhaseStatus {
  if (run !== null && TERMINAL_AGENT_RUN_STATUSES.has(run.status)) return "done";
  if (run?.status === "awaiting_author") return "pending";
  return "active";
}

function planStepSymbol(status: string): string {
  if (status === "done") return "✓";
  if (status === "active") return "●";
  return "○";
}

function narrativeTone(eventType: string): string {
  if (eventType === "exploration_observed") return "explore";
  if (eventType === "evaluation_made") return "evaluate";
  if (eventType === "plan_revised") return "replan";
  return "neutral";
}

function planRevisionLabel(events: AgentEventData[], version: number): string {
  const revised = events.some((event) => event.event_type === "plan_revised");
  if (revised && version > 1) return `v${version} · 由 v${version - 1} 调整`;
  return WORKBENCH.agenticLoopPlanVersion(version);
}

interface AgentRunDialogueFlowProps {
  run: AgentRunStateData | null;
  events: AgentEventData[];
  preparing?: boolean;
  canPause?: boolean;
  canResume?: boolean;
  canCancel?: boolean;
  providerRuns?: AgentRunProviderUsageData[];
  detailsDefaultOpen?: boolean;
  detailsLoading?: boolean;
  onDetailsOpen?: () => void;
  onCommand?: (command: AgentCommand) => void;
}

function AgentRunDialogueFlow({
  run,
  events,
  preparing = false,
  canPause = false,
  canResume = false,
  canCancel = false,
  providerRuns = [],
  detailsDefaultOpen = false,
  detailsLoading = false,
  onDetailsOpen,
  onCommand,
}: AgentRunDialogueFlowProps) {
  const [detailsOpen, setDetailsOpen] = useState(detailsDefaultOpen);
  const visibleEvents = selectAgentRunVisibleEvents(events, AGENT_RUN_EVENT_VISIBLE_LIMIT);
  const stages = groupAgentRunEvents(visibleEvents);
  const reasoningFlow = agentRunReasoningFlow(events);
  const phaseStrip = agenticLoopPhaseStrip(run, events, reasoningFlow, preparing);
  const statusTone = agenticLoopStatusTone(run);
  const statusLabel =
    run &&
    (WORKBENCH.agentRunStatusLabels[run.status] ??
      (run.status || WORKBENCH.agentRunPreparingStatus));
  const statusSummary =
    (preparing ? WORKBENCH.agentRunPreparingEvent : reasoningFlow.statusLine) ??
    latestAgentRunSummary(run, [], false);
  const providerFlowSummary = agentRunProviderFlowSummary(events, providerRuns);
  const showControls =
    run !== null && onCommand !== undefined && !TERMINAL_AGENT_RUN_STATUSES.has(run.status);

  function handleDetailsToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const open = event.currentTarget.open;
    setDetailsOpen(open);
    if (open) onDetailsOpen?.();
  }

  return (
    <div className={styles.agentRunFlow} aria-label={WORKBENCH.agentRunFlowAriaLabel}>
      <div className={styles.agentRunFlowRail} aria-hidden="true">
        <span className={styles.agentRunFlowRailDot} />
        <span className={styles.agentRunFlowRailLine} />
      </div>
      <div className={styles.agentRunFlowContent}>
        <div className={styles.agenticLoopStatusPanel}>
          <div className={styles.agenticLoopStatusMeta}>
            <span className={styles.agentRunStatusPulse} aria-hidden="true" />
            {statusLabel && (
              <span className={styles.agenticLoopStatusChip} data-status={statusTone}>
                {statusLabel}
              </span>
            )}
            <span>{WORKBENCH.agentRunInlineTitle}</span>
            {run?.run_mode === "durable" && (
              <span className={styles.agenticLoopStatusChip}>
                {run.recovered ? WORKBENCH.agentRunRecoveredLabel : WORKBENCH.agentRunDurableLabel}
                {run.long_run_task_ref
                  ? ` · ${WORKBENCH.agentRunLongTaskRef(run.long_run_task_ref)}`
                  : ""}
              </span>
            )}
          </div>
          <div className={styles.agenticLoopStatusText}>{statusSummary}</div>
        </div>

        <ol
          className={styles.agenticLoopPhaseStrip}
          aria-label={WORKBENCH.agenticLoopStateTrackLabel}
        >
          {phaseStrip.map((phase, index) => (
            <Fragment key={phase.key}>
              <li className={styles.agenticLoopPhase} data-status={phase.status}>
                <span>{WORKBENCH.agenticLoopPhaseLabels[phase.key]}</span>
              </li>
              {index < phaseStrip.length - 1 && (
                <li className={styles.agenticLoopPhaseArrow} aria-hidden="true">
                  →
                </li>
              )}
            </Fragment>
          ))}
        </ol>

        {reasoningFlow.planSteps.length > 0 && (
          <>
            <div className={styles.agenticLoopDivider} aria-hidden="true" />
            <section className={styles.agenticLoopPlan} aria-label={WORKBENCH.agenticLoopPlanLabel}>
              <div className={styles.agenticLoopSectionHeader}>
                <span>{WORKBENCH.agenticLoopPlanLabel}</span>
                {reasoningFlow.planVersion !== null && (
                  <span className={styles.agenticLoopVersionPill}>
                    {planRevisionLabel(events, reasoningFlow.planVersion)}
                  </span>
                )}
              </div>
              <ol className={styles.agenticLoopPlanSteps}>
                {reasoningFlow.planSteps.map((step) => (
                  <li
                    key={step.stepRef}
                    className={styles.agenticLoopPlanStep}
                    data-status={step.status}
                  >
                    <span className={styles.agenticLoopPlanStepBadge}>
                      {planStepSymbol(step.status)}
                    </span>
                    <span className={styles.agenticLoopPlanStepBody}>
                      <span className={styles.agenticLoopPlanStepMeta}>
                        <span className={styles.agenticLoopPlanStepKind}>
                          {WORKBENCH.agenticLoopPlanStepKindLabels[step.kind]}
                        </span>
                        <span>{WORKBENCH.agenticLoopPlanStepStatusLabels[step.status]}</span>
                      </span>
                      <span className={styles.agenticLoopPlanStepText}>{step.description}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}

        {reasoningFlow.narrativeEvents.length > 0 && (
          <>
            <div className={styles.agenticLoopDivider} aria-hidden="true" />
            <section
              className={styles.agenticLoopReasoning}
              aria-label={WORKBENCH.agenticLoopReasoningLabel}
            >
              <div className={styles.agenticLoopSectionHeader}>
                <span>{WORKBENCH.agenticLoopReasoningLabel}</span>
              </div>
              <ol className={styles.agenticLoopNarratives}>
                {reasoningFlow.narrativeEvents.map((event) => (
                  <li key={event.key} className={styles.agenticLoopNarrative}>
                    <span
                      className={styles.agenticLoopNarrativeLabel}
                      data-tone={narrativeTone(event.eventType)}
                    >
                      {event.label}
                    </span>
                    <span className={styles.agenticLoopNarrativeText}>{event.narrative}</span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}

        {reasoningFlow.resultLine && (
          <section
            className={styles.agenticLoopResult}
            aria-label={WORKBENCH.agenticLoopResultLabel}
          >
            <span className={styles.agenticLoopResultPill}>{WORKBENCH.agenticLoopResultLabel}</span>
            <span>{reasoningFlow.resultLine}</span>
          </section>
        )}

        {showControls && (
          <div
            className={styles.agentRunInlineActions}
            aria-label={WORKBENCH.agentRunControlsLabel}
          >
            <button
              type="button"
              className={styles.iconBtn}
              title={WORKBENCH.agentRunPause}
              disabled={!canPause}
              onClick={() => onCommand?.("pause")}
            >
              <Pause size={14} aria-hidden="true" />
              <span>{WORKBENCH.agentRunPause}</span>
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              title={WORKBENCH.agentRunResume}
              disabled={!canResume}
              onClick={() => onCommand?.("resume")}
            >
              <Play size={14} aria-hidden="true" />
              <span>{WORKBENCH.agentRunResume}</span>
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              title={WORKBENCH.agentRunCancel}
              disabled={!canCancel}
              onClick={() => onCommand?.("cancel")}
            >
              <CircleX size={14} aria-hidden="true" />
              <span>{WORKBENCH.agentRunCancel}</span>
            </button>
          </div>
        )}

        <details
          className={styles.agentRunDetails}
          open={detailsOpen}
          onToggle={handleDetailsToggle}
        >
          <summary className={styles.agentRunDetailsSummary}>
            <ChevronDown size={14} aria-hidden="true" />
            <span>{WORKBENCH.agentRunDetailsSummary}</span>
            <span className={styles.agentRunDetailsHint}>
              {detailsLoading ? WORKBENCH.agentRunDetailsLoading : WORKBENCH.agentRunDetailsHint}
            </span>
          </summary>

          {detailsOpen && (
            <>
              {providerFlowSummary && (
                <section
                  className={styles.agentRunProviderFlow}
                  aria-label={WORKBENCH.agentRunProviderFlowLabel}
                >
                  <div className={styles.agentRunProviderFlowHeader}>
                    <span className={styles.agentRunProviderFlowLabel}>
                      {WORKBENCH.agentRunProviderFlowLabel}
                    </span>
                    <span>{providerFlowSummary.headline}</span>
                  </div>
                  {providerFlowSummary.details.length > 0 && (
                    <div className={styles.agentRunProviderFlowDetails}>
                      {providerFlowSummary.details.map((detail) => (
                        <span key={detail}>{detail}</span>
                      ))}
                    </div>
                  )}
                  <ol className={styles.agentRunProviderFlowPhases}>
                    {providerFlowSummary.phases.map((phase) => (
                      <li
                        key={phase.key}
                        className={`${styles.agentRunProviderFlowPhase} ${
                          styles[
                            `agentRunProviderFlowPhase${phase.status[0].toUpperCase()}${phase.status.slice(
                              1,
                            )}` as keyof typeof styles
                          ]
                        }`}
                      >
                        <span>{phase.label}</span>
                        <span>{WORKBENCH.agentRunProviderFlowPhaseStatusLabels[phase.status]}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {providerRuns.length > 0 && (
                <section
                  className={styles.agentRunProviderRuns}
                  aria-label={WORKBENCH.agentRunProviderRunsLabel}
                >
                  <div className={styles.agentRunTimelineLabel}>
                    {WORKBENCH.agentRunProviderRunsLabel}
                  </div>
                  <div className={styles.agentRunTimelineEvents}>
                    {providerRuns.map((providerRun, index) => {
                      const detailItems = agentRunProviderRunDetailItems(providerRun);
                      const replayDetails = agentRunProviderRunReplayDetails(providerRun);
                      const key =
                        providerRun.provider_run_ref ?? providerRun.provider_call_ref ?? `${index}`;

                      return (
                        <details
                          key={key}
                          className={styles.agentRunProviderRunDetail}
                          open={index === 0}
                        >
                          <summary className={styles.agentRunProviderRunSummary}>
                            <ChevronDown size={13} aria-hidden="true" />
                            <span>
                              {providerRun.provider_call_ref
                                ? WORKBENCH.agentRunDetailProviderCallRef(
                                    providerRun.provider_call_ref,
                                  )
                                : WORKBENCH.agentRunProviderRunsLabel}
                            </span>
                          </summary>
                          {detailItems.length > 0 && (
                            <div className={styles.agentRunTimelineEventDetails}>
                              {detailItems.map((item) => (
                                <span key={item}>{item}</span>
                              ))}
                            </div>
                          )}
                          <div className={styles.agentRunProviderReplay}>
                            <section className={styles.agentRunProviderReplaySection}>
                              <div className={styles.agentRunProviderReplayLabel}>
                                {WORKBENCH.agentRunProviderReplayEventsLabel}
                              </div>
                              <ul className={styles.agentRunProviderReplayList}>
                                {replayDetails.events.map((event, eventIndex) => (
                                  <li
                                    key={`${eventIndex}-${event.title}-${event.details.join("-")}`}
                                  >
                                    <div className={styles.agentRunProviderReplayItemTitle}>
                                      {event.title}
                                    </div>
                                    {event.details.length > 0 && (
                                      <div className={styles.agentRunTimelineEventDetails}>
                                        {event.details.map((item) => (
                                          <span key={item}>{item}</span>
                                        ))}
                                      </div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </section>
                            <section className={styles.agentRunProviderReplaySection}>
                              <div className={styles.agentRunProviderReplayLabel}>
                                {WORKBENCH.agentRunProviderReplayOutputLabel}
                              </div>
                              <div className={styles.agentRunTimelineEventDetails}>
                                {replayDetails.output.map((item) => (
                                  <span key={item}>{item}</span>
                                ))}
                              </div>
                            </section>
                            <div className={styles.agentRunProviderReplayBoundary}>
                              {replayDetails.boundary}
                            </div>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </section>
              )}

              {stages.length > 0 ? (
                <div className={styles.agentRunTimeline}>
                  {stages.map((group) => (
                    <section key={group.stage} className={styles.agentRunTimelineSection}>
                      <div className={styles.agentRunTimelineLabel}>
                        {WORKBENCH.agentRunStageLabels[group.stage]}
                      </div>
                      <div className={styles.agentRunTimelineEvents}>
                        {group.events.map((event) => {
                          const detailItems = agentRunEventDetailItems(event);

                          return (
                            <div key={event.event_id} className={styles.agentRunTimelineEvent}>
                              <div>{presentAgentEventSummary(event.summary)}</div>
                              {detailItems.length > 0 && (
                                <div className={styles.agentRunTimelineEventDetails}>
                                  {detailItems.map((item) => (
                                    <span key={item}>{item}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className={styles.agentRunEmptyEvent}>{WORKBENCH.agentRunEmptyEvent}</div>
              )}
            </>
          )}
        </details>
      </div>
    </div>
  );
}

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
  const [transcriptPage, setTranscriptPage] = useState<SessionTranscriptPageInfo | null>(null);
  const [olderTranscriptLoading, setOlderTranscriptLoading] = useState(false);
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
  const [agentRunStates, setAgentRunStates] = useState<Record<string, AgentRunStateData>>({});
  const [agentEvents, setAgentEvents] = useState<AgentEventData[]>([]);
  const [agentRunActivityLoading, setAgentRunActivityLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [agentRunActivityLoaded, setAgentRunActivityLoaded] = useState<Record<string, boolean>>({});
  const [pendingAgentRunAnchors, setPendingAgentRunAnchors] = useState<
    Record<string, PendingAgentRunAnchor>
  >({});

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
  const visibleTranscriptSessionIdRef = useRef<string | null>(null);
  const modelProviderModelsRequestRef = useRef(0);
  const localMessageSeqRef = useRef(0);

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

  function agentRunActivityKey(result: TurnResult): string | null {
    const turnId = result.turn_id;
    const runId = turnResultAgentRunId(result);
    if (!turnId || !runId) return null;
    return `${turnId}:${runId}`;
  }

  function agentRunActivityAgentRun(
    activity: { agent_runs?: Record<string, unknown>[] },
    runId: string | null,
  ): Record<string, unknown> | null {
    const agentRuns = Array.isArray(activity.agent_runs) ? activity.agent_runs : [];
    if (agentRuns.length === 0) return null;
    return agentRuns.find((entry) => entry.run_id === runId) ?? agentRuns[0] ?? null;
  }

  function agentRunActivityEvents(
    activity: { agent_runs?: Record<string, unknown>[] },
    runId: string | null,
  ): AgentEventData[] {
    const agentRun = agentRunActivityAgentRun(activity, runId);
    const events = agentRun?.events;
    return Array.isArray(events) ? events.filter(isAgentEventData) : [];
  }

  function agentRunActivityProviderRuns(
    activity: { provider_runs?: Record<string, unknown>[] },
    runId: string | null,
  ): AgentRunProviderUsageData[] {
    const providerRuns = Array.isArray(activity.provider_runs) ? activity.provider_runs : [];
    const scopedRuns = runId
      ? providerRuns.filter((entry) => entry.run_id === undefined || entry.run_id === runId)
      : providerRuns;

    return scopedRuns;
  }

  // Lift the turn_result handler so the effect below stays focused on connection setup.
  async function hydrateAgentRunActivityForTurn(result: TurnResult) {
    const workId = context.workId;
    const sessionId = activeSessionIdRef.current;
    const connection = activeConnectionRef.current;
    const key = agentRunActivityKey(result);
    if (!workId || workId === "lobby" || !sessionId || !result.turn_id || !key) return;
    if (agentRunActivityLoaded[key] || agentRunActivityLoading[key]) return;

    setAgentRunActivityLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const activity = await getTurnAgentRunActivity(workId, sessionId, result.turn_id);
      if (!isCurrentWorkConnection(activeConnectionRef.current, connection)) return;

      const runId = turnResultAgentRunId(result);
      const providerRuns = agentRunActivityProviderRuns(activity, runId);
      const events = agentRunActivityEvents(activity, runId);
      const agentRun = agentRunActivityAgentRun(activity, runId);

      setMessages((prev) =>
        prev.map((message) => {
          if (message.turnResult?.turn_id !== result.turn_id) return message;

          return {
            ...message,
            turnResult: putAgentRunActivityIntoTurnResult(
              message.turnResult,
              agentRun,
              events,
              providerRuns,
            ),
          };
        }),
      );
      setAgentRunActivityLoaded((prev) => ({ ...prev, [key]: true }));
    } catch {
      // AgentRun activity is supplementary author-safe detail; the turn result remains usable.
    } finally {
      setAgentRunActivityLoading((prev) => ({ ...prev, [key]: false }));
    }
  }

  function handleTurnResult(result: TurnResult) {
    setMessages((prev) => upsertAssistantTurnResultMessage(prev, result));
    const resultAgentRunState = stateFromTurnResult(result);
    if (resultAgentRunState) {
      setAgentRunStates((prev) => ({
        ...prev,
        [resultAgentRunState.run_id]: mergeAgentRunRuntimeState(
          prev[resultAgentRunState.run_id],
          resultAgentRunState,
        ),
      }));
    }
    setLoading(false);
    void hydrateAgentRunActivityForTurn(result);

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

  function putAgentRunActivityIntoTurnResult(
    turnResult: TurnResult,
    agentRunSummary: Record<string, unknown> | null,
    events: AgentEventData[],
    providerRuns: AgentRunProviderUsageData[],
  ): TurnResult {
    return {
      ...turnResult,
      agent_run: {
        ...(turnResult.agent_run ?? {}),
        ...(agentRunSummary ?? {}),
        events,
        provider_runs: providerRuns,
        activity_loaded: true,
      },
    };
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
    setTranscriptPage(null);
    setOlderTranscriptLoading(false);
    setCreatingSession(false);
    setBranchingSession(false);
    setSessions([]);
    setSessionSearch("");
    setResumePendingAdoptions([]);
    setResumeResolvedAdoptions([]);
    setTranscriptRestored(false);
    resumeRestoredTranscriptRef.current = false;
    setMessages([]);
    setAgentRunStates({});
    setAgentEvents([]);
    setAgentRunActivityLoading({});
    setAgentRunActivityLoaded({});
    setPendingAgentRunAnchors({});
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
      const [displayName, snapshot] = await Promise.all([
        getAssistantDisplayName(work.id),
        resumeWorkspace(work.id),
      ]);
      if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;

      activeAssistantDisplayName = displayName;
      setAssistantDisplayNameState(displayName);
      setAssistantNameDraft(displayName === DEFAULT_ASSISTANT_DISPLAY_NAME ? "" : displayName);
      setContext({ assistantDisplayName: displayName });

      const restoredMessages = transcriptToMessages(snapshot.transcript) as ChatMessage[];
      sessionId = snapshot.active_session.id;
      workTitle = snapshot.work.title || workTitle;
      setActiveSessionId(sessionId);
      setSessions(snapshot.sessions);
      setTranscriptPage(snapshot.transcript_page);
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
    onAgentEvent(channel, (event) => {
      if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;
      setAgentEvents((prev) => [...prev.filter((item) => item.event_id !== event.event_id), event]);
      if (event.event_type === "run_completed" || event.event_type === "run_failed") {
        setLoading(false);
      }
    });
    onAgentRunState(channel, (state) => {
      if (!isCurrentWorkConnection(activeConnectionRef.current, { token, workId: work.id })) return;
      setAgentRunStates((prev) => ({
        ...prev,
        [state.run_id]: mergeAgentRunRuntimeState(prev[state.run_id], state),
      }));
      if (
        ["completed", "failed", "cancelled", "paused", "awaiting_author"].includes(state.status)
      ) {
        setLoading(false);
      }
    });
  }

  useEffect(() => {
    openWorkRef.current = openWork;
  });

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    visibleTranscriptSessionIdRef.current = readOnlySession?.id ?? activeSessionId;
  }, [activeSessionId, readOnlySession]);

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
  }, [messages, loading, agentEvents, agentRunStates]);

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
  const visibleAgentRuns = Object.values(agentRunStates);
  const latestAgentRun = visibleAgentRuns.at(-1) ?? null;
  const latestMessage = messages.at(-1);
  const agentRunIdsRenderedInTurns = new Set(
    messages.map((msg) => turnResultAgentRunId(msg.turnResult)).filter((runId) => runId !== null),
  );
  const latestAgentRunEvents = latestAgentRun
    ? selectAgentRunVisibleEvents(
        agentEvents.filter((event) => event.run_ref === latestAgentRun.run_id),
        AGENT_RUN_EVENT_VISIBLE_LIMIT,
      )
    : [];
  const canPauseAgentRun =
    latestAgentRun?.status === "running" || latestAgentRun?.status === "pausing";
  const canResumeAgentRun =
    latestAgentRun?.status === "paused" || latestAgentRun?.status === "awaiting_author";
  const canCancelAgentRun =
    latestAgentRun !== null && !TERMINAL_AGENT_RUN_STATUSES.has(latestAgentRun.status);
  const hasActiveAgentRun =
    latestAgentRun !== null && !TERMINAL_AGENT_RUN_STATUSES.has(latestAgentRun.status);
  const latestAgentRunHasMessageAnchor =
    latestAgentRun !== null &&
    messages.some((message) => messageAnchorsAgentRun(message, latestAgentRun));
  const shouldRenderStandaloneAgentRun = shouldRenderStandaloneAgentRunStatus(
    latestAgentRun,
    latestMessage,
    {
      agentRunIdsRenderedInTurns,
      hasMessageAnchor: latestAgentRunHasMessageAnchor,
    },
  );
  const hasPendingAgentRunAnchor = Object.keys(pendingAgentRunAnchors).length > 0;
  const canRouteMainInputToAgentSteer = shouldRouteInputToAgentSteer({
    latestAgentRun,
    pendingAnswerBehaviorId: pendingAnswerBid,
  });
  const canSubmitMainInput =
    socketConnected &&
    !isPanelOpen &&
    !isReadOnlySessionView &&
    (!loading || canRouteMainInputToAgentSteer);

  const rememberAgentRunAck = useCallback(
    (response: SendMessageResult, text: string, clientMessageId: string | null = null) => {
      if (!response.run_id) return;

      if (clientMessageId) {
        setPendingAgentRunAnchors((prev) => removePendingAgentRunAnchor(prev, clientMessageId));
      }

      setMessages((prev) => bindAgentRunAckToUserMessage(prev, response, clientMessageId));

      const acknowledgedState: AgentRunStateData = {
        run_id: response.run_id,
        run_mode: response.run_mode ?? "bounded",
        status: "running",
        phase: "executing",
        long_run_task_ref: response.long_run_task_ref ?? null,
        work_id: context.workId,
        session_id: activeSessionId,
        parent_turn_ref: response.turn_id ?? null,
        profile_ref: response.profile_ref ?? null,
        goal: response.goal ?? { text, version: 1 },
        completed_step_refs: [],
        pending_artifact_refs: [],
        interrupt_state: { status: "none", requested_at: null },
        current_task: true,
      };

      setAgentRunStates((prev) => ({
        ...prev,
        [response.run_id!]: mergeAgentRunRuntimeState(prev[response.run_id!], acknowledgedState),
      }));
    },
    [activeSessionId, context.workId],
  );

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
    setLoading(true);
    void sendMessage(channelRef.current, text, context.workId, null, activeSessionId)
      .then((response) => rememberAgentRunAck(response, text))
      .catch(() => {
        setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sendFailure }]);
        setLoading(false);
      });
  }, [activeSessionId, context.workId, rememberAgentRunAck]);

  async function handleAgentCommand(command: AgentCommand, text?: string) {
    if (!channelRef.current || !latestAgentRun) return;

    try {
      await sendAgentCommand(channelRef.current, latestAgentRun.run_id, command, text);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.actionFailure }]);
    }
  }

  function nextLocalMessageId(): string {
    localMessageSeqRef.current += 1;
    return `local-message-${localMessageSeqRef.current}`;
  }

  async function handleSend(
    messageText: string = inputText,
    options: { generateMicroPlan?: boolean } = {},
  ) {
    const text = messageText.trim();
    if (!text || !channelRef.current || isReadOnlySessionView) return;

    const behaviorId = pendingAnswerBid;
    if (
      shouldRouteInputToAgentSteer({
        latestAgentRun,
        pendingAnswerBehaviorId: behaviorId,
        generateMicroPlan: options.generateMicroPlan ?? false,
      })
    ) {
      const clientMessageId = nextLocalMessageId();
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          text,
          clientMessageId,
          agentRunId: latestAgentRun!.run_id,
        },
      ]);
      if (messageText === inputText) setInputText("");
      setLoading(true);
      try {
        await sendAgentCommand(channelRef.current, latestAgentRun!.run_id, "steer", text);
      } catch {
        setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.actionFailure }]);
        setLoading(false);
      }
      return;
    }

    const clientMessageId = nextLocalMessageId();
    setMessages((prev) => [...prev, { role: "user", text, clientMessageId }]);
    setPendingAgentRunAnchors((prev) => ({
      ...prev,
      [clientMessageId]: { clientMessageId, text },
    }));
    if (messageText === inputText) setInputText("");
    setLoading(true);

    setPendingAnswerBid(null);

    try {
      const response = await sendMessage(
        channelRef.current,
        text,
        context.workId,
        behaviorId,
        activeSessionId,
        options.generateMicroPlan ?? false,
      );
      rememberAgentRunAck(response, text, clientMessageId);
    } catch {
      setPendingAgentRunAnchors((prev) => removePendingAgentRunAnchor(prev, clientMessageId));
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sendFailure }]);
      setLoading(false);
    }
  }

  const handleCandidateContinue = async (turnResult: TurnResult, candidate: CandidateDirection) => {
    if (!channelRef.current || loading) return;

    const text = candidateContinuationText(candidate.title, candidate.pitch);
    const clientMessageId = nextLocalMessageId();
    setMessages((prev) => [...prev, { role: "user", text, clientMessageId }]);
    setPendingAgentRunAnchors((prev) => ({
      ...prev,
      [clientMessageId]: { clientMessageId, text },
    }));
    setLoading(true);

    try {
      const response = await sendMessage(
        channelRef.current,
        text,
        context.workId,
        null,
        activeSessionId,
        false,
        {
          source_turn_ref: turnResult.turn_id,
          candidate_set_ref: `candidate_set:${turnResult.turn_id}`,
          candidate_ref: candidate.direction_id,
        },
      );
      rememberAgentRunAck(response, text, clientMessageId);
    } catch {
      setPendingAgentRunAnchors((prev) => removePendingAgentRunAnchor(prev, clientMessageId));
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sendFailure }]);
      setLoading(false);
    }
  };

  const handleAvailableAction = async (
    turnResult: TurnResult,
    action: AvailableActionLike,
    authorPayload?: Record<string, unknown>,
  ) => {
    if (!channelRef.current || action.enabled === false || loading) return;

    setLoading(true);

    try {
      const result = await sendAuthorAction(
        channelRef.current,
        toAuthorActionPayload(turnResult.turn_id, action, authorPayload),
      );
      // 幂等：重复提交（同 idempotency_key）后端不重复执行并回 duplicate=true，
      // 让作者看见"已处理"，而不是静默无反应。
      if (result?.duplicate === true) {
        setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.actionDuplicate }]);
        setLoading(false);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.actionFailure }]);
      setLoading(false);
    }
  };

  // VS-00E CP3：按质量发现重写——从本轮 available_actions 取出 revise_from_findings 动作，
  // 携带要处理的发现引用提交。后端会另生成一份 tentative 修订草稿（原草稿保留、不自动采纳）。
  const handleReviseFromFindings = async (
    turnResult: TurnResult,
    selectedFindingIds?: string[],
  ) => {
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

    if (actionType === "edit_then_accept") {
      setEditDialog({
        turnResult: match.turnResult,
        action: match.action,
        text: draftProseForAction(match.turnResult, match.action),
      });
      return;
    }

    void handleAvailableAction(match.turnResult, match.action);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!canSubmitMainInput) return;
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
      setTranscriptPage(snapshot.transcript_page);
      setResumePendingAdoptions(snapshot.pending_adoptions as unknown as ArtifactEntry[]);
      setResumeResolvedAdoptions(snapshot.resolved_adoptions as unknown as ArtifactEntry[]);
      setMessages(restoredMessages);
      setTranscriptRestored(restoredMessages.length > 0);
      resumeRestoredTranscriptRef.current = restoredMessages.length > 0;
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: WORKBENCH.sessionOpenFailure }]);
    }
  };

  function mergeOlderTranscriptMessages(
    olderMessages: ChatMessage[],
    currentMessages: ChatMessage[],
  ): ChatMessage[] {
    const currentKeys = new Set(currentMessages.map(transcriptMessageKey));
    return [
      ...olderMessages.filter((message) => !currentKeys.has(transcriptMessageKey(message))),
      ...currentMessages,
    ];
  }

  function transcriptMessageKey(message: ChatMessage): string {
    const identity = message.turnResult?.turn_id ?? message.turnId ?? message.clientMessageId ?? "";
    return `${message.role}:${identity}:${message.text}`;
  }

  const handleLoadOlderTranscript = async () => {
    const workId = context.workId;
    const sessionId = visibleTranscriptSessionIdRef.current;
    const beforeId = transcriptPage?.before_id;
    const connection = activeConnectionRef.current;

    if (
      !workId ||
      workId === "lobby" ||
      !sessionId ||
      !beforeId ||
      !transcriptPage?.has_more_before ||
      olderTranscriptLoading
    ) {
      return;
    }

    setOlderTranscriptLoading(true);
    try {
      const page = await getSessionTranscriptPage(workId, sessionId, { beforeId });
      if (!isCurrentWorkConnection(activeConnectionRef.current, connection)) return;
      if (visibleTranscriptSessionIdRef.current !== sessionId) return;

      const olderMessages = transcriptToMessages(page.transcript) as ChatMessage[];
      setMessages((prev) => mergeOlderTranscriptMessages(olderMessages, prev));
      setTranscriptPage(page.transcript_page);
    } catch {
      setMessages((prev) => [
        { role: "assistant", text: WORKBENCH.sessionOlderLoadFailure },
        ...prev,
      ]);
    } finally {
      if (isCurrentWorkConnection(activeConnectionRef.current, connection)) {
        setOlderTranscriptLoading(false);
      }
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
      setTranscriptPage(snapshot.transcript_page);
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
                      <p className={styles.dialogHint}>{WORKBENCH.modelProviderSubscriptionHint}</p>
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
            {transcriptPage?.has_more_before && (
              <div className={styles.transcriptHistoryLoader}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={olderTranscriptLoading}
                  onClick={() => {
                    void handleLoadOlderTranscript();
                  }}
                >
                  {olderTranscriptLoading
                    ? WORKBENCH.sessionLoadOlderLoading
                    : WORKBENCH.sessionLoadOlder}
                </button>
              </div>
            )}
            {messages.map((msg, i) => {
              const messageAgentRunId = turnResultAgentRunId(msg.turnResult);
              const anchoredAgentRun =
                msg.role === "user"
                  ? (visibleAgentRuns.find((run) => messageAnchorsAgentRun(msg, run)) ?? null)
                  : null;
              const pendingAgentRunAnchor =
                msg.role === "user" && msg.clientMessageId
                  ? (pendingAgentRunAnchors[msg.clientMessageId] ?? null)
                  : null;
              const shouldRenderAnchoredAgentRun = shouldRenderAnchoredAgentRunStatus(
                anchoredAgentRun,
                {
                  agentRunIdsRenderedInTurns,
                  messageIsLatest: i === messages.length - 1,
                },
              );
              const shouldRenderPendingAgentRun = shouldRenderUserAgentRunPlaceholder(msg, {
                anchoredRun: anchoredAgentRun,
                agentRunIdsRenderedInTurns,
                hasPendingAnchor: pendingAgentRunAnchor !== null,
              });
              const anchoredAgentRunEvents = anchoredAgentRun
                ? selectAgentRunVisibleEvents(
                    agentEvents.filter((event) => event.run_ref === anchoredAgentRun.run_id),
                    AGENT_RUN_EVENT_VISIBLE_LIMIT,
                  )
                : [];
              const anchoredRunIsLatest = latestAgentRun?.run_id === anchoredAgentRun?.run_id;
              const messageAgentRunFromState = messageAgentRunId
                ? agentRunStates[messageAgentRunId]
                : null;
              const messageAgentRunFromTurn = msg.turnResult
                ? stateFromTurnResult(msg.turnResult)
                : null;
              const messageAgentRun =
                messageAgentRunFromTurn &&
                messageAgentRunFromState &&
                TERMINAL_AGENT_RUN_STATUSES.has(messageAgentRunFromTurn.status) &&
                !TERMINAL_AGENT_RUN_STATUSES.has(messageAgentRunFromState.status)
                  ? { ...messageAgentRunFromState, ...messageAgentRunFromTurn }
                  : (messageAgentRunFromState ?? messageAgentRunFromTurn);
              const messageAgentRunEvents = messageAgentRunId
                ? selectAgentRunVisibleEvents(
                    mergeAgentRunEvents(
                      agentRunEventsFromTurnResult(msg.turnResult),
                      agentEvents.filter((event) => event.run_ref === messageAgentRunId),
                    ),
                    AGENT_RUN_EVENT_VISIBLE_LIMIT,
                  )
                : [];
              const messageRunIsLatest = latestAgentRun?.run_id === messageAgentRunId;
              const messageAgentRunActivityKey = msg.turnResult
                ? agentRunActivityKey(msg.turnResult)
                : null;
              const messageAgentRunDetailsLoading = messageAgentRunActivityKey
                ? agentRunActivityLoading[messageAgentRunActivityKey] === true
                : false;
              const messageIdentity =
                msg.turnResult?.turn_id ?? msg.turnId ?? msg.clientMessageId ?? String(i);
              const messageKey = `${msg.role}:${messageIdentity}:${messageAgentRunId ?? msg.agentRunId ?? "none"}`;

              return (
                <Fragment key={messageKey}>
                  <div className={msg.role === "user" ? styles.userMsg : styles.assistantMsg}>
                    <div className={styles.role}>
                      {assistantRoleLabel(msg.role, assistantDisplayName)}
                    </div>
                    {msg.role === "assistant" &&
                      msg.turnResult?.frame_summary &&
                      (() => {
                        const framePresentation = framePresentationForSummary({
                          ...msg.turnResult.frame_summary,
                          decision_type: msg.turnResult.trace_summary?.decision_type,
                        });

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

                    {msg.role === "assistant" && messageAgentRun && (
                      <AgentRunDialogueFlow
                        run={messageAgentRun}
                        events={messageAgentRunEvents}
                        providerRuns={msg.turnResult?.agent_run?.provider_runs ?? []}
                        detailsLoading={messageAgentRunDetailsLoading}
                        onDetailsOpen={
                          msg.turnResult
                            ? () => {
                                void hydrateAgentRunActivityForTurn(msg.turnResult!);
                              }
                            : undefined
                        }
                        canPause={messageRunIsLatest && canPauseAgentRun}
                        canResume={messageRunIsLatest && canResumeAgentRun}
                        canCancel={messageRunIsLatest && canCancelAgentRun}
                        onCommand={
                          messageRunIsLatest
                            ? (command) => {
                                void handleAgentCommand(command);
                              }
                            : undefined
                        }
                      />
                    )}

                    {msg.role === "assistant" && msg.turnResult && (
                      <button
                        className={styles.traceWhyButton}
                        type="button"
                        title={TRACE.actionTitle}
                        onClick={() =>
                          void openTraceDialog(
                            msg.turnResult!.turn_id,
                            msg.turnResult!.trace_summary,
                          )
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
                  {shouldRenderAnchoredAgentRun && (
                    <div className={styles.assistantMsg}>
                      <div className={styles.role}>
                        {assistantRoleLabel("assistant", assistantDisplayName)}
                      </div>
                      <AgentRunDialogueFlow
                        run={anchoredAgentRun}
                        events={anchoredAgentRunEvents}
                        canPause={anchoredRunIsLatest && canPauseAgentRun}
                        canResume={anchoredRunIsLatest && canResumeAgentRun}
                        canCancel={anchoredRunIsLatest && canCancelAgentRun}
                        onCommand={
                          anchoredRunIsLatest
                            ? (command) => {
                                void handleAgentCommand(command);
                              }
                            : undefined
                        }
                      />
                    </div>
                  )}
                  {shouldRenderPendingAgentRun && (
                    <div className={styles.assistantMsg}>
                      <div className={styles.role}>
                        {assistantRoleLabel("assistant", assistantDisplayName)}
                      </div>
                      <AgentRunDialogueFlow run={null} events={[]} preparing />
                    </div>
                  )}
                </Fragment>
              );
            })}

            {shouldRenderStandaloneAgentRun && (
              <div className={styles.assistantMsg}>
                <div className={styles.role}>
                  {assistantRoleLabel("assistant", assistantDisplayName)}
                </div>
                <AgentRunDialogueFlow
                  run={latestAgentRun}
                  events={latestAgentRunEvents}
                  canPause={canPauseAgentRun}
                  canResume={canResumeAgentRun}
                  canCancel={canCancelAgentRun}
                  onCommand={(command) => {
                    void handleAgentCommand(command);
                  }}
                />
              </div>
            )}

            {loading &&
              !hasActiveAgentRun &&
              !shouldRenderStandaloneAgentRun &&
              !hasPendingAgentRunAnchor && (
                <div className={styles.assistantMsg}>
                  <div className={styles.role}>
                    {assistantRoleLabel("assistant", assistantDisplayName)}
                  </div>
                  <AgentRunDialogueFlow run={null} events={[]} preparing />
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
              placeholder={
                canRouteMainInputToAgentSteer
                  ? WORKBENCH.agentRunMainInputSteerPlaceholder
                  : WORKBENCH.inputPlaceholder
              }
              disabled={!socketConnected || isPanelOpen || isReadOnlySessionView}
            />
            <button
              className={styles.sendBtn}
              onClick={() => {
                void handleSend();
              }}
              disabled={!canSubmitMainInput}
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
              <details className={styles.sessionRailDetails}>
                <summary className={styles.sessionRailSummary}>
                  {WORKBENCH.sessionRailSummary}
                </summary>
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
              </details>
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
            void handleSend(`请根据已采纳章节计划生成${chapterBrief}正文草稿，保持为待采纳草稿。`, {
              generateMicroPlan: true,
            });
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
