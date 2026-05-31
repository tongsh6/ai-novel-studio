import { Socket, Channel } from "phoenix";
import { wsBaseUrl } from "./env";

const DEFAULT_ENDPOINT: string = wsBaseUrl;
export const LLM_TURN_TIMEOUT_MS = 300000;

// TODO(Phase 1): params 收窄为具体业务类型
export interface ConnectOptions {
  endpoint?: string;
  params?: Record<string, unknown>;
}

export function createSocket(opts: ConnectOptions = {}): Socket {
  const socket = new Socket(opts.endpoint ?? DEFAULT_ENDPOINT, {
    params: opts.params ?? {},
  });
  return socket;
}

export function joinWorkspace(
  socket: Socket,
  topic = "workspace:lobby",
  params: Record<string, unknown> = {},
): Channel {
  const channel = socket.channel(topic, params);
  return channel;
}

// TODO(Phase 1): echo 和 payload 收窄为具体协议类型
export interface PingResult {
  event: "pong";
  echo: Record<string, unknown>;
}

export function ping(
  channel: Channel,
  payload: Record<string, unknown>,
): Promise<PingResult> {
  return new Promise((resolve, reject) => {
    channel
      .push("ping", payload)
      .receive("ok", (response) => resolve(response as PingResult))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("ping timeout")));
  });
}

export function sendMessage(
  channel: Channel,
  text: string,
  workId?: string | null,
  behaviorId?: string | null,
  sessionId?: string | null,
  generateMicroPlan = false,
): Promise<{ received: boolean }> {
  return new Promise((resolve, reject) => {
    channel
      .push("user_message", { 
        text, 
        work_id: workId, 
        session_id: sessionId,
        behavior_id: behaviorId,
        generate_micro_plan: generateMicroPlan,
      }, LLM_TURN_TIMEOUT_MS)
      .receive("ok", (response) => resolve(response as { received: boolean }))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("send timeout")));
  });
}

export interface AuthorActionPayload {
  source_turn_ref: string;
  action_id: string;
  action_type: string;
  target_ref?: string;
  behavior_ref?: string;
  candidate_set_ref?: string;
  candidate_ref?: string;
  idempotency_key?: string;
  // 作者补充输入（如 edit_then_accept 的 edited_content）。VS-04 §3 AuthorActionInput.payload。
  payload?: Record<string, unknown>;
}

export function sendAuthorAction(
  channel: Channel,
  action: AuthorActionPayload,
): Promise<{ received: boolean; action_status: string }> {
  return new Promise((resolve, reject) => {
    channel
      .push("author_action", { action }, LLM_TURN_TIMEOUT_MS)
      .receive("ok", (response) =>
        resolve(response as { received: boolean; action_status: string }),
      )
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("author_action timeout")));
  });
}

export interface TaskStateData {
  task_id: string;
  task_type?: string;
  phase: string;
  status: string;
  progress?: number;
  step?: string;
  updated_at?: string;
}

export function onTaskState(
  channel: Channel,
  callback: (state: TaskStateData) => void,
): void {
  channel.on("task_state", (payload: TaskStateData) => callback(payload));
}

export function confirm(
  channel: Channel,
  behaviorId: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("confirm", { behavior_id: behaviorId }, LLM_TURN_TIMEOUT_MS)
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("confirm timeout")));
  });
}

export function rejectAction(
  channel: Channel,
  behaviorId: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("reject", { behavior_id: behaviorId }, LLM_TURN_TIMEOUT_MS)
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("reject timeout")));
  });
}

export function revise(
  channel: Channel,
  behaviorId: string,
  feedback?: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("revise", { behavior_id: behaviorId, feedback }, LLM_TURN_TIMEOUT_MS)
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("revise timeout")));
  });
}

export function dismissCard(
  channel: Channel,
  behaviorId: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("dismiss", { behavior_id: behaviorId })
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("dismiss timeout")));
  });
}

export function resumeCheckpoint(
  channel: Channel,
  behaviorId: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("resume", { behavior_id: behaviorId })
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("resume timeout")));
  });
}

export function cancelCheckpoint(
  channel: Channel,
  behaviorId: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("cancel", { behavior_id: behaviorId })
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("cancel timeout")));
  });
}

export function branchCheckpoint(
  channel: Channel,
  behaviorId: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("branch", { behavior_id: behaviorId })
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("branch timeout")));
  });
}

export function retryAction(
  channel: Channel,
  behaviorId: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("retry", { behavior_id: behaviorId })
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("retry timeout")));
  });
}

export type ChapterAuditStatus = "empty" | "short" | "ok";

export interface WorkAudit {
  stage?: string;
  min_chapter_words?: number;
  total_target?: number;
  total_word_count?: number;
  chapter_count?: number;
  ok_chapter_count?: number;
  short_chapter_count?: number;
  empty_chapter_count?: number;
  meets_threshold?: boolean;
}

export interface TocVolume {
  id: string;
  title: string;
  seq: number;
  chapters: {
    id: string;
    title: string;
    seq: number;
    word_count?: number;
    audit_status?: ChapterAuditStatus;
  }[];
}

export interface TocData {
  total_word_count?: number;
  audit?: WorkAudit;
  volumes: TocVolume[];
}

export interface ChapterPlanData {
  id: string;
  title: string;
  summary?: string | null;
  chapter_count: number;
  chapters: { id: string; title: string; seq: number; summary?: string | null }[];
  updated_at?: string | null;
}

export function getToc(
  channel: Channel,
  workId: string,
): Promise<TocData> {
  return new Promise((resolve, reject) => {
    channel
      .push("get_toc", { work_id: workId })
      .receive("ok", (response) => resolve(response as TocData))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("get_toc timeout")));
  });
}

export interface ChapterContent {
  title: string;
  word_count?: number;
  scenes: { title: string; content: string }[];
}

export function getChapterContent(
  channel: Channel,
  chapterId: string,
): Promise<ChapterContent> {
  return new Promise((resolve, reject) => {
    channel
      .push("get_chapter_content", { chapter_id: chapterId })
      .receive("ok", (response) => resolve(response as ChapterContent))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("get_chapter_content timeout")));
  });
}

export function getChapterPlans(
  channel: Channel,
  workId: string,
): Promise<ChapterPlanData[]> {
  return new Promise((resolve, reject) => {
    channel
      .push("get_chapter_plans", { work_id: workId })
      .receive("ok", (response) => resolve(response as ChapterPlanData[]))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("get_chapter_plans timeout")));
  });
}

export interface CharacterData {
  id: string;
  name: string;
  aliases: string[];
  role: string | null;
  summary: string | null;
  status?: string;
  updated_at?: string | null;
}

export function getCharacters(
  channel: Channel,
  workId: string,
): Promise<CharacterData[]> {
  return new Promise((resolve, reject) => {
    channel
      .push("get_characters", { work_id: workId })
      .receive("ok", (response) => resolve(response as CharacterData[]))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("get_characters timeout")));
  });
}

export interface MemoryItemData {
  id: string;
  content: string;
  type: string;
  scope?: string;
  status?: string;
  source_type?: string;
  summary?: string | null;
  tags: string[];
  weight?: number;
  confidence?: number;
  locked?: boolean;
  recallable?: boolean;
  reference_count?: number;
  version?: number;
  updated_at?: string | null;
}

export function getForeshadowing(
  channel: Channel,
  workId: string,
): Promise<MemoryItemData[]> {
  return new Promise((resolve, reject) => {
    channel
      .push("get_foreshadowing", { work_id: workId })
      .receive("ok", (response) => resolve(response as MemoryItemData[]))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("get_foreshadowing timeout")));
  });
}

export function getRules(
  channel: Channel,
  workId: string,
): Promise<MemoryItemData[]> {
  return new Promise((resolve, reject) => {
    channel
      .push("get_rules", { work_id: workId })
      .receive("ok", (response) => resolve(response as MemoryItemData[]))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("get_rules timeout")));
  });
}

export interface WorkStats {
  words_total: number;
  words_today: number;
  volumes: number;
  chapters: number;
  drafts_total: number;
  drafts_accepted: number;
  characters: number;
  memory_items: number;
}

export function getWorkStats(
  channel: Channel,
  workId: string,
): Promise<WorkStats> {
  return new Promise((resolve, reject) => {
    channel
      .push("get_work_stats", { work_id: workId })
      .receive("ok", (response) => resolve(response as WorkStats))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("get_work_stats timeout")));
  });
}
