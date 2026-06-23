import { apiBaseUrl } from "./env";

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
  turn_result: Record<string, unknown> | null;
  inserted_at?: string | null;
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
  pending_adoptions: Record<string, unknown>[];
  resolved_adoptions: Record<string, unknown>[];
  resume_trace_refs: string[];
}

export interface WorkspaceSessionSnapshot {
  work: WorkspaceResumeSnapshot["work"];
  session: WorkSessionDto;
  read_only: boolean;
  transcript: SessionTranscriptEntry[];
  pending_adoptions: Record<string, unknown>[];
  resolved_adoptions: Record<string, unknown>[];
  resume_trace_refs: string[];
}

export interface ChatMessageFromTranscript {
  role: "user" | "assistant";
  text: string;
  turnResult?: Record<string, unknown>;
}

export interface TurnReplaySnapshot {
  work_id: string;
  session_id: string;
  turn_id: string;
  trace_summary: Record<string, unknown>;
  replay_report: Record<string, unknown>;
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

export function createSessionPath(workId: string): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions`;
}

export function archiveSessionPath(workId: string, sessionId: string): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/archive`;
}

export function turnReplayPath(workId: string, sessionId: string, turnId: string): string {
  return `/api/works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/replay`;
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
      ...(entry.turn_result ? { turnResult: entry.turn_result } : {}),
    }));
}

export function shouldInsertWorkspaceWelcome(
  restoredTranscriptHasMessages: boolean,
  currentMessageCount: number,
): boolean {
  return !restoredTranscriptHasMessages && currentMessageCount === 0;
}
