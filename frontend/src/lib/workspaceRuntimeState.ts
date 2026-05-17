// Design: docs/design-v2/ui-design/41-workbench-layout.md §4.1
// Design: docs/design-v2/ui-design/42-card-system.md §5
// Prototype: novel-studio-v2.pen → 41§3-main-workbench (ZOwOi)
import { WORKSPACE_RUNTIME } from "./copy";

export type WorkspaceConnectionStatus =
  | "booting"
  | "connecting"
  | "connected"
  | "degraded"
  | "failed";

export type WorkspaceWorkStatus =
  | "loading"
  | "ready"
  | "missing"
  | "failed";

export type WorkspaceSessionStatus =
  | "idle"
  | "resuming"
  | "active"
  | "failed";

export type WorkspaceReadingProjectionStatus =
  | "unknown"
  | "empty"
  | "ready"
  | "stale"
  | "failed";

export type WorkspaceTaskStatus =
  | "idle"
  | "running"
  | "checkpoint"
  | "failed";

export interface WorkspaceAdoptionArtifact {
  artifact_id: string;
  artifact_type?: string;
  adoption_status?: string;
  requires_adoption?: boolean;
  revision_base?: string | null;
  source_turn_ref?: string | null;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkspaceRuntimeInput {
  connection?: {
    connected?: boolean;
    connecting?: boolean;
    degraded?: boolean;
    error?: string | null;
  };
  resumeSnapshot?: unknown;
  joinResponse?: unknown;
  work?: {
    id?: string | null;
    title?: string | null;
    status?: string | null;
    error?: string | null;
  };
  session?: {
    id?: string | null;
    restoring?: boolean;
    transcriptRestored?: boolean;
    error?: string | null;
  };
  transcript?: unknown[];
  adoptionState?: {
    pending?: unknown[];
    resolved?: unknown[];
  };
  readingProjection?: {
    chapters?: unknown[] | null;
    activeChapterId?: string | null;
    refreshStatus?: string | null;
    error?: string | null;
  };
  task?: {
    status?: string | null;
  };
}

export interface WorkspaceRuntimeState {
  connection: {
    status: WorkspaceConnectionStatus;
    reason?: string | null;
  };
  work: {
    id: string | null;
    title: string;
    rawTitle: string | null;
    status: WorkspaceWorkStatus;
    hasValidWork: boolean;
  };
  session: {
    id: string | null;
    status: WorkspaceSessionStatus;
    transcriptRestored: boolean;
    shouldShowWelcome: boolean;
  };
  adoption: {
    pendingCount: number;
    pendingArtifactIds: string[];
    pendingArtifacts: WorkspaceAdoptionArtifact[];
    resolvedArtifactIds: string[];
    resolvedArtifacts: WorkspaceAdoptionArtifact[];
    resolvedArtifactsById: Record<string, WorkspaceAdoptionArtifact>;
    hasPending: boolean;
  };
  readingProjection: {
    status: WorkspaceReadingProjectionStatus;
    chapterCount: number;
    activeChapterId: string | null;
  };
  task: {
    status: WorkspaceTaskStatus;
  };
  ui: {
    headerTitle: string;
    connectionLabel: string;
    shouldShowDisconnectedBadge: boolean;
    shouldShowReadingEmptyState: boolean;
  };
}

interface CardLike {
  card_type?: string;
  artifact_refs?: string[];
  actions?: { target_ref: string; action_type?: string; enabled?: boolean }[];
}

const INVALID_WORK_TITLES = new Set([
  "未命名作品",
  "无活跃作品",
  "作品加载失败",
  "作品上下文加载失败",
  "未连接",
  "undefined",
  "null",
  "artifact_id",
]);

const RESOLVED_ADOPTION_STATUSES = new Set([
  "ACCEPTED",
  "DISCARDED",
  "EDITED_ACCEPTED",
  "SUPERSEDED",
  "INVALIDATED",
  "ARCHIVED",
]);

export function deriveWorkspaceRuntimeState(
  input: WorkspaceRuntimeInput,
): WorkspaceRuntimeState {
  const connection = deriveConnectionState(input.connection);
  const work = deriveWorkState(input);
  const session = deriveSessionState(input);
  const adoption = deriveAdoptionState(input.adoptionState);
  const readingProjection = deriveReadingProjectionState(input.readingProjection);
  const task = deriveTaskState(input.task);

  return {
    connection,
    work,
    session,
    adoption,
    readingProjection,
    task,
    ui: {
      headerTitle: work.title,
      connectionLabel: connectionLabel(connection.status),
      shouldShowDisconnectedBadge: shouldShowDisconnectedBadgeFromConnection(connection.status),
      shouldShowReadingEmptyState: readingProjection.status === "empty",
    },
  };
}

export function getVisibleWorkTitle(state: WorkspaceRuntimeState): string {
  return state.work.title;
}

export function shouldShowWelcomeMessage(state: WorkspaceRuntimeState): boolean {
  return state.session.shouldShowWelcome;
}

export function getPendingAdoptionCount(state: WorkspaceRuntimeState): number {
  return state.adoption.pendingCount;
}

export function isArtifactResolved(
  state: WorkspaceRuntimeState,
  artifactId: string,
): boolean {
  const id = normalizeId(artifactId);
  return id ? state.adoption.resolvedArtifactIds.includes(id) : false;
}

export function shouldShowDisconnectedBadge(
  state: WorkspaceRuntimeState,
): boolean {
  return state.ui.shouldShowDisconnectedBadge;
}

export function getReadingProjectionStatus(
  state: WorkspaceRuntimeState,
): WorkspaceReadingProjectionStatus {
  return state.readingProjection.status;
}

export function adoptionDecisionForCard(
  state: WorkspaceRuntimeState,
  card: CardLike,
): WorkspaceAdoptionArtifact | null {
  if (card.card_type !== "adoption_card") return null;

  const actionTarget = card.actions
    ?.map((action) => normalizeId(action.target_ref))
    .find((targetRef): targetRef is string =>
      Boolean(targetRef && state.adoption.resolvedArtifactsById[targetRef]),
    );

  if (actionTarget) return state.adoption.resolvedArtifactsById[actionTarget] ?? null;

  const artifactRef = card.artifact_refs
    ?.map(normalizeId)
    .find((ref): ref is string =>
      Boolean(ref && state.adoption.resolvedArtifactsById[ref]),
    );

  return artifactRef ? state.adoption.resolvedArtifactsById[artifactRef] ?? null : null;
}

export function disableResolvedArtifactActions<TCard extends CardLike>(
  state: WorkspaceRuntimeState,
  card: TCard,
): TCard {
  if (card.card_type !== "adoption_card" || !card.actions?.length) return card;

  return {
    ...card,
    actions: card.actions.map((action) =>
      isArtifactResolutionAction(action.action_type) &&
      isArtifactResolved(state, action.target_ref)
        ? { ...action, enabled: false }
        : action,
    ),
  };
}

export function normalizeVisibleWorkTitle(title: string | null | undefined): string {
  const normalized = normalizeString(title);
  if (!normalized || isInternalOrPlaceholderTitle(normalized)) {
    return WORKSPACE_RUNTIME.currentWorkTitle;
  }

  return normalized;
}

function deriveConnectionState(
  connection: WorkspaceRuntimeInput["connection"],
): WorkspaceRuntimeState["connection"] {
  const reason = normalizeString(connection?.error);
  if (reason) return { status: "failed", reason };
  if (connection?.degraded) return { status: "degraded", reason: null };
  if (connection?.connected) return { status: "connected", reason: null };
  if (connection?.connecting) return { status: "connecting", reason: null };
  if (connection?.connected === false) return { status: "failed", reason: null };
  return { status: "booting", reason: null };
}

function deriveWorkState(input: WorkspaceRuntimeInput): WorkspaceRuntimeState["work"] {
  const snapshotWork = objectRecord(objectRecord(input.resumeSnapshot)?.work);
  const join = objectRecord(input.joinResponse);
  const id = normalizeId(input.work?.id) ??
    normalizeId(snapshotWork?.id) ??
    normalizeId(join?.work_id);
  const rawTitle = normalizeString(input.work?.title) ??
    normalizeString(snapshotWork?.title);
  const title = normalizeVisibleWorkTitle(rawTitle);
  const status = normalizeWorkStatus(input.work?.status, input.work?.error, id);

  return {
    id,
    title,
    rawTitle,
    status,
    hasValidWork: Boolean(id && status === "ready"),
  };
}

function deriveSessionState(
  input: WorkspaceRuntimeInput,
): WorkspaceRuntimeState["session"] {
  const snapshot = objectRecord(input.resumeSnapshot);
  const activeSession = objectRecord(snapshot?.active_session);
  const join = objectRecord(input.joinResponse);
  const id = normalizeId(input.session?.id) ??
    normalizeId(activeSession?.id) ??
    normalizeId(join?.session_id);
  const transcriptCount = input.transcript?.length ?? 0;
  const snapshotTranscript = Array.isArray(snapshot?.transcript)
    ? snapshot.transcript
    : [];
  const transcriptRestored =
    input.session?.transcriptRestored === true ||
    snapshotTranscript.length > 0;

  let status: WorkspaceSessionStatus = "idle";
  if (input.session?.error) status = "failed";
  else if (input.session?.restoring) status = "resuming";
  else if (id) status = "active";

  return {
    id,
    status,
    transcriptRestored,
    shouldShowWelcome:
      status !== "failed" &&
      status !== "resuming" &&
      !transcriptRestored &&
      transcriptCount === 0,
  };
}

function deriveAdoptionState(
  adoptionState: WorkspaceRuntimeInput["adoptionState"],
): WorkspaceRuntimeState["adoption"] {
  const pendingInput = adoptionState?.pending ?? [];
  const resolvedInput = adoptionState?.resolved ?? [];
  const resolvedById = new Map<string, WorkspaceAdoptionArtifact>();

  for (const artifact of [...pendingInput, ...resolvedInput]) {
    const normalized = normalizeArtifact(artifact);
    if (!normalized) continue;
    if (isResolvedAdoptionStatus(normalized.adoption_status) || resolvedInput.includes(artifact)) {
      resolvedById.set(normalized.artifact_id, normalized);
    }
  }

  const pendingById = new Map<string, WorkspaceAdoptionArtifact>();
  for (const artifact of pendingInput) {
    const normalized = normalizeArtifact(artifact);
    if (!normalized) continue;
    if (resolvedById.has(normalized.artifact_id)) continue;
    if (isResolvedAdoptionStatus(normalized.adoption_status)) continue;
    if (!pendingById.has(normalized.artifact_id)) {
      pendingById.set(normalized.artifact_id, normalized);
    }
  }

  const pendingArtifacts = [...pendingById.values()];
  const resolvedArtifacts = [...resolvedById.values()];
  const resolvedArtifactsById = Object.fromEntries(
    resolvedArtifacts.map((artifact) => [artifact.artifact_id, artifact]),
  );

  return {
    pendingCount: pendingArtifacts.length,
    pendingArtifactIds: pendingArtifacts.map((artifact) => artifact.artifact_id),
    pendingArtifacts,
    resolvedArtifactIds: resolvedArtifacts.map((artifact) => artifact.artifact_id),
    resolvedArtifacts,
    resolvedArtifactsById,
    hasPending: pendingArtifacts.length > 0,
  };
}

function deriveReadingProjectionState(
  readingProjection: WorkspaceRuntimeInput["readingProjection"],
): WorkspaceRuntimeState["readingProjection"] {
  const error = normalizeString(readingProjection?.error);
  const refreshStatus = normalizeString(readingProjection?.refreshStatus)?.toUpperCase();
  const chapters = readingProjection?.chapters;
  const chapterCount = Array.isArray(chapters) ? chapters.length : 0;
  const activeChapterId = normalizeId(readingProjection?.activeChapterId);

  if (error || refreshStatus === "FAILED") {
    return { status: "failed", chapterCount, activeChapterId };
  }
  if (!Array.isArray(chapters)) {
    return { status: "unknown", chapterCount: 0, activeChapterId };
  }
  if (chapterCount === 0) {
    return { status: "empty", chapterCount, activeChapterId: null };
  }
  if (refreshStatus === "STALE" || refreshStatus === "REBUILDING") {
    return { status: "stale", chapterCount, activeChapterId };
  }

  return { status: "ready", chapterCount, activeChapterId };
}

function deriveTaskState(
  task: WorkspaceRuntimeInput["task"],
): WorkspaceRuntimeState["task"] {
  const status = normalizeString(task?.status)?.toLowerCase();
  if (status === "running" || status === "checkpoint" || status === "failed") {
    return { status };
  }
  return { status: "idle" };
}

function normalizeWorkStatus(
  rawStatus: WorkspaceRuntimeInput["work"] extends infer T
    ? T extends { status?: infer S }
      ? S
      : unknown
    : unknown,
  error: string | null | undefined,
  id: string | null,
): WorkspaceWorkStatus {
  if (normalizeString(error)) return "failed";
  const status = normalizeString(rawStatus)?.toLowerCase();
  if (status === "failed") return "failed";
  if (status === "loading") return "loading";
  if (status === "missing") return "missing";
  if (id) return "ready";
  return status === "ready" ? "ready" : "missing";
}

function connectionLabel(status: WorkspaceConnectionStatus): string {
  switch (status) {
    case "connected":
      return WORKSPACE_RUNTIME.connectionConnected;
    case "connecting":
      return WORKSPACE_RUNTIME.connectionConnecting;
    case "degraded":
      return WORKSPACE_RUNTIME.connectionDegraded;
    case "failed":
      return WORKSPACE_RUNTIME.connectionFailed;
    case "booting":
      return WORKSPACE_RUNTIME.connectionBooting;
  }
}

function shouldShowDisconnectedBadgeFromConnection(
  status: WorkspaceConnectionStatus,
): boolean {
  return status === "failed" || status === "degraded";
}

function normalizeArtifact(value: unknown): WorkspaceAdoptionArtifact | null {
  const artifact = objectRecord(value);
  const artifactId = normalizeId(artifact?.artifact_id);
  if (!artifactId) return null;

  return {
    ...artifact,
    artifact_id: artifactId,
    ...(typeof artifact?.artifact_type === "string"
      ? { artifact_type: artifact.artifact_type }
      : {}),
    ...(typeof artifact?.adoption_status === "string"
      ? { adoption_status: artifact.adoption_status }
      : {}),
    ...(objectRecord(artifact?.payload)
      ? { payload: objectRecord(artifact?.payload) as Record<string, unknown> }
      : {}),
  };
}

function isResolvedAdoptionStatus(status: string | undefined): boolean {
  return RESOLVED_ADOPTION_STATUSES.has(String(status ?? "").toUpperCase());
}

function isArtifactResolutionAction(actionType?: string): boolean {
  return actionType === "accept" ||
    actionType === "discard" ||
    actionType === "edit_then_accept";
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeId(value: unknown): string | null {
  return normalizeString(value);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isInternalOrPlaceholderTitle(title: string): boolean {
  if (INVALID_WORK_TITLES.has(title)) return true;
  if (/^as_\d+$/i.test(title)) return true;
  if (/^artifact[_-]/i.test(title)) return true;
  if (/^mock[_-]?work/i.test(title)) return true;
  if (/^turn[_-]/i.test(title)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(title)) {
    return true;
  }
  return false;
}
