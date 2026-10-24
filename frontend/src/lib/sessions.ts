import { apiBaseUrl } from "./env";
import type { CandidateSelectionPayload } from "./socket";
import { parseIncomingTurnResult, type WireTurnResult } from "./turnResultWire";

export interface WorkSessionDto {
  id: string;
  work_id: string;
  title: string;
  summary: string | null;
  status: "ACTIVE" | "EXITED" | "ARCHIVED";
  source_session_ref: string | null;
  source_turn_ref: string | null;
  last_opened_at: string | null;
  updated_at: string | null;
  inserted_at: string | null;
}

export interface SessionTranscriptEntry {
  id?: string;
  session_id?: string;
  turn_id: string;
  role: "user" | "assistant" | "system";
  text: string;
  submission_id?: string | null;
  candidate_selection?: CandidateSelectionPayload | null;
  // DS03：steer 作者补充恢复时携带来源 run，前端据此把消息锚回同一 AgentRun。
  agent_run_id?: string | null;
  turn_result: Record<string, unknown> | null;
  inserted_at?: string | null;
}

export interface SessionTranscriptPageInfo {
  limit: number;
  returned_count: number;
  has_more_before: boolean;
  before_id: string | null;
  after_id: string | null;
}

export interface WorkspaceResumeSnapshot {
  work: {
    id: string;
    title: string;
    genre: string | null;
    status: string;
    updated_at: string | null;
    inserted_at: string | null;
  };
  active_session: WorkSessionDto;
  sessions: WorkSessionDto[];
  transcript: SessionTranscriptEntry[];
  transcript_page: SessionTranscriptPageInfo;
  pending_adoptions: Record<string, unknown>[];
  pending_adoption_turn_results?: WireTurnResult[];
  open_author_question_turn_results?: WireTurnResult[];
  resolved_adoptions: Record<string, unknown>[];
  resume_trace_refs: string[];
}

export interface WorkspaceSessionSnapshot {
  work: WorkspaceResumeSnapshot["work"];
  session: WorkSessionDto;
  read_only: boolean;
  transcript: SessionTranscriptEntry[];
  transcript_page: SessionTranscriptPageInfo;
  pending_adoptions: Record<string, unknown>[];
  pending_adoption_turn_results?: WireTurnResult[];
  open_author_question_turn_results?: WireTurnResult[];
  resolved_adoptions: Record<string, unknown>[];
  resume_trace_refs: string[];
}

export interface WorkspaceSessionTranscriptPage {
  work_id: string;
  session: WorkSessionDto;
  read_only: boolean;
  transcript: SessionTranscriptEntry[];
  transcript_page: SessionTranscriptPageInfo;
}

export interface ChatMessageFromTranscript {
  clientMessageId?: string;
  role: "user" | "assistant";
  text: string;
  turnId?: string | null;
  candidateSelection?: CandidateSelectionPayload | null;
  agentRunId?: string | null;
  turnResult?: WireTurnResult;
}

export interface TurnReplaySnapshot {
  work_id: string;
  session_id: string;
  turn_id: string;
  trace_summary: Record<string, unknown>;
  replay_report: Record<string, unknown>;
}

export interface ProviderRunActivitySnapshot {
  work_id: string;
  session_id: string;
  turn_id: string;
  provider_runs: Record<string, unknown>[];
  agent_runs: Record<string, unknown>[];
  totals: {
    provider_run_count?: number;
    provider_call_refs?: string[];
    total_tokens?: number;
    content_length?: number;
  };
}

export interface CreateWorkSessionInput {
  title?: string;
  summary?: string;
  source_session_ref?: string;
  source_turn_ref?: string;
}

function url(path: string): string {
  return `${apiBaseUrl}${path}`;
}

export function resumeSessionPath(workId: string): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions/resume`;
}

export function searchSessionsPath(workId: string, query: string): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("query", query.trim());
  const suffix = params.toString();
  return `/api/works/${encodeURIComponent(workId)}/sessions${suffix ? `?${suffix}` : ""}`;
}

export function sessionSnapshotPath(workId: string, sessionId: string): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}`;
}

export function sessionTranscriptPagePath(
  workId: string,
  sessionId: string,
  options: { beforeId?: string | null; limit?: number } = {},
): string {
  const params = new URLSearchParams();
  if (options.beforeId) params.set("before_id", options.beforeId);
  if (options.limit) params.set("limit", String(options.limit));
  const suffix = params.toString();
  return `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/transcript${suffix ? `?${suffix}` : ""}`;
}

export function createSessionPath(workId: string): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions`;
}

export function archiveSessionPath(workId: string, sessionId: string): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/archive`;
}

export function turnReplayPath(workId: string, sessionId: string, turnId: string): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/replay`;
}

export function turnProviderRunsPath(workId: string, sessionId: string, turnId: string): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/provider-runs`;
}

export function turnAgentRunActivityPath(
  workId: string,
  sessionId: string,
  turnId: string,
): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/agent-run-activity`;
}

// Design: docs/design/adr/ADR-0027-author-obligation-state-v3.md D3
// 待办操作凭据独立于聊天分页，仍经统一 TurnResult 契约入口校验。
export function pendingAdoptionTurnResults(
  snapshot: Pick<WorkspaceResumeSnapshot, "pending_adoption_turn_results">,
): WireTurnResult[] {
  return (snapshot.pending_adoption_turn_results ?? []).map(parseIncomingTurnResult);
}

export function openAuthorQuestionTurnResults(
  snapshot: Pick<WorkspaceResumeSnapshot, "open_author_question_turn_results">,
): WireTurnResult[] {
  return (snapshot.open_author_question_turn_results ?? []).map(parseIncomingTurnResult);
}

export function authorQuestionQueryKey(workId: string | null, sessionId: string | null) {
  return ["session-author-questions", workId, sessionId] as const;
}

export function pendingAdoptionQueryKey(workId: string | null, sessionId: string | null) {
  return ["session-pending-adoption-turns", workId, sessionId] as const;
}

export async function resumeWorkspace(workId: string): Promise<WorkspaceResumeSnapshot> {
  const res = await fetch(url(resumeSessionPath(workId)));
  if (!res.ok) throw new Error(`resumeWorkspace failed: HTTP ${res.status}`);
  return (await res.json()) as WorkspaceResumeSnapshot;
}

export async function getSessionSnapshot(
  workId: string,
  sessionId: string,
): Promise<WorkspaceSessionSnapshot> {
  const res = await fetch(url(sessionSnapshotPath(workId, sessionId)));
  if (!res.ok) throw new Error(`getSessionSnapshot failed: HTTP ${res.status}`);
  return (await res.json()) as WorkspaceSessionSnapshot;
}

export async function getSessionTranscriptPage(
  workId: string,
  sessionId: string,
  options: { beforeId?: string | null; limit?: number } = {},
): Promise<WorkspaceSessionTranscriptPage> {
  const res = await fetch(url(sessionTranscriptPagePath(workId, sessionId, options)));
  if (!res.ok) throw new Error(`getSessionTranscriptPage failed: HTTP ${res.status}`);
  return (await res.json()) as WorkspaceSessionTranscriptPage;
}

export async function searchSessions(workId: string, query: string): Promise<WorkSessionDto[]> {
  const res = await fetch(url(searchSessionsPath(workId, query)));
  if (!res.ok) throw new Error(`searchSessions failed: HTTP ${res.status}`);
  const body = (await res.json()) as { sessions: WorkSessionDto[] };
  return body.sessions;
}

export async function createWorkSession(
  workId: string,
  input: CreateWorkSessionInput = {},
): Promise<WorkSessionDto> {
  const res = await fetch(url(createSessionPath(workId)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`createWorkSession failed: HTTP ${res.status}`);
  const body = (await res.json()) as { session: WorkSessionDto };
  return body.session;
}

export async function archiveWorkSession(
  workId: string,
  sessionId: string,
): Promise<WorkSessionDto> {
  const res = await fetch(url(archiveSessionPath(workId, sessionId)), {
    method: "POST",
  });
  if (!res.ok) throw new Error(`archiveWorkSession failed: HTTP ${res.status}`);
  const body = (await res.json()) as { session: WorkSessionDto };
  return body.session;
}

export async function getTurnReplay(
  workId: string,
  sessionId: string,
  turnId: string,
): Promise<TurnReplaySnapshot> {
  const res = await fetch(url(turnReplayPath(workId, sessionId, turnId)));
  if (!res.ok) throw new Error(`getTurnReplay failed: HTTP ${res.status}`);
  return (await res.json()) as TurnReplaySnapshot;
}

export async function getTurnProviderRuns(
  workId: string,
  sessionId: string,
  turnId: string,
): Promise<ProviderRunActivitySnapshot> {
  const res = await fetch(url(turnProviderRunsPath(workId, sessionId, turnId)));
  if (!res.ok) throw new Error(`getTurnProviderRuns failed: HTTP ${res.status}`);
  return (await res.json()) as ProviderRunActivitySnapshot;
}

export async function getTurnAgentRunActivity(
  workId: string,
  sessionId: string,
  turnId: string,
): Promise<ProviderRunActivitySnapshot> {
  const res = await fetch(url(turnAgentRunActivityPath(workId, sessionId, turnId)));
  if (!res.ok) throw new Error(`getTurnAgentRunActivity failed: HTTP ${res.status}`);
  return (await res.json()) as ProviderRunActivitySnapshot;
}

export function transcriptToMessages(
  transcript: SessionTranscriptEntry[],
): ChatMessageFromTranscript[] {
  return transcript
    .filter(
      (entry): entry is SessionTranscriptEntry & { role: "user" | "assistant" } =>
        entry.role === "user" || entry.role === "assistant",
    )
    .map((entry) => ({
      role: entry.role,
      text: entry.text,
      turnId: entry.turn_id,
      ...(entry.submission_id ? { clientMessageId: entry.submission_id } : {}),
      ...(entry.candidate_selection ? { candidateSelection: entry.candidate_selection } : {}),
      ...(entry.agent_run_id ? { agentRunId: entry.agent_run_id } : {}),
      // 恢复的历史 turn_result 与 Channel 广播走同一契约校验入口（漂移告警、容错透传）。
      ...(entry.turn_result ? { turnResult: parseIncomingTurnResult(entry.turn_result) } : {}),
    }));
}

// 历史页是有序快照：缺失的旧消息插回相邻记录之间，不追加到当前对话末尾。
export function mergeResumedTranscript<Message extends ChatMessageFromTranscript>(
  current: Message[],
  restored: Message[],
): Message[] {
  const same = (a: Message, b: Message) =>
    a.role === b.role &&
    ((a.role === "user" && a.clientMessageId && a.clientMessageId === b.clientMessageId) ||
      ((a.turnResult?.turn_id ?? a.turnId) === (b.turnResult?.turn_id ?? b.turnId) &&
        a.text === b.text));
  const merged = [...current];
  for (let i = 0; i < restored.length; i++) {
    const message = restored[i];
    const existing = merged.findIndex((entry) => same(entry, message));
    if (existing >= 0) {
      merged[existing] = { ...merged[existing], ...message };
      continue;
    }
    const next = restored.slice(i + 1).find((entry) => merged.some((item) => same(entry, item)));
    if (next) {
      merged.splice(
        merged.findIndex((entry) => same(entry, next)),
        0,
        message,
      );
    } else {
      const previous = restored
        .slice(0, i)
        .findLast((entry) => merged.some((item) => same(entry, item)));
      const position = previous
        ? merged.findLastIndex((entry) => same(entry, previous)) + 1
        : merged.length;
      merged.splice(position, 0, message);
    }
  }
  return merged;
}

export function shouldInsertWorkspaceWelcome(
  restoredTranscriptHasMessages: boolean,
  currentMessageCount: number,
): boolean {
  return !restoredTranscriptHasMessages && currentMessageCount === 0;
}
