import { Socket, Channel } from "phoenix";
import { wsBaseUrl } from "./env";

const DEFAULT_ENDPOINT: string = wsBaseUrl;

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

export interface SliceVerifyUiStatePayload {
  slice_id: string;
  context_work_id: string | null;
  context_work_title: string | null;
  active_session_id: string | null;
  restored_turn_id: string | null;
  socket_connected: boolean;
  message_count: number;
  welcome_message_count: number;
  pending_adoption_count: number;
  first_message_text: string;
  service_status_text: string;
  title_text: string;
  adoption_status?: string | null;
  artifact_type?: string | null;
  decision_card_count?: number;
  open_reading_action_count?: number;
  reading_chapter_count?: number;
  archive_character_count?: number;
  archive_foreshadowing_count?: number;
  archive_rule_count?: number;
  archive_volumes?: number;
  archive_chapters?: number;
  archive_memory_items?: number;
  archive_drafts_total?: number;
  archive_drafts_accepted?: number;
  archive_detail_kind?: string;
  archive_detail_id?: string;
  archive_detail_title?: string;
  initial_work_id?: string | null;
  created_work_id?: string | null;
  assistant_name_after_save?: string;
  assistant_role_after_save?: string;
  assistant_name_in_created_work?: string;
  assistant_name_after_return?: string;
  assistant_role_after_return?: string;
  trace_why_dialog_open?: boolean;
  trace_why_text?: string;
  trace_why_contains_raw_prompt?: boolean;
  frame_badge_label?: string;
  frame_badge_kind?: string;
  frame_badge_goal?: string | null;
  candidate_panel_count?: number;
  llm_status_text?: string;
  llm_connected?: boolean | null;
  llm_model_label?: string;
  ui_turn_ids?: string[];
  user_message_count?: number;
  assistant_turn_message_count?: number;
  message_role_order?: string[];
  thinking_observed?: boolean;
  thinking_visible_after_reply?: boolean;
  available_action_count?: number;
  card_action_count?: number;
  adoption_decision_card_count?: number;
  searched_query?: string;
  readonly_session_id?: string;
  readonly_banner_visible?: boolean;
  readonly_input_disabled?: boolean;
  readonly_send_disabled?: boolean;
  readonly_visible_text?: string;
  active_session_restored?: boolean;
  branch_source_session_ref?: string;
  branch_source_turn_ref?: string;
  branch_active_session_id?: string;
  branch_readonly_banner_visible?: boolean;
  branch_message_count?: number;
  branch_visible_text?: string;
  branch_session_item_active?: boolean;
  archive_button_visible?: boolean;
  archived_hidden_default?: boolean;
  archived_search_found?: boolean;
  archived_banner_visible?: boolean;
  archived_visible_text?: string;
}

export function reportSliceVerifyUiState(
  channel: Channel,
  payload: SliceVerifyUiStatePayload,
): Promise<{ received: boolean }> {
  return new Promise((resolve, reject) => {
    channel
      .push("slice_verify_ui_state", payload, 60000)
      .receive("ok", (response) => resolve(response as { received: boolean }))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("slice verify UI state timeout")));
  });
}

export function sendMessage(
  channel: Channel,
  text: string,
  workId?: string | null,
  behaviorId?: string | null,
  sessionId?: string | null,
  generateMicroPlan = false,
  candidateSelection?: CandidateSelectionPayload,
): Promise<{ received: boolean }> {
  return new Promise((resolve, reject) => {
    channel
      .push("user_message", { 
        text, 
        work_id: workId, 
        session_id: sessionId,
        behavior_id: behaviorId,
        generate_micro_plan: generateMicroPlan,
        candidate_selection: candidateSelection,
      }, 60000)
      .receive("ok", (response) => resolve(response as { received: boolean }))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("send timeout")));
  });
}

export interface CandidateSelectionPayload {
  source_turn_ref: string;
  candidate_set_ref: string;
  candidate_ref: string;
}

export interface AuthorActionPayload {
  source_turn_ref: string;
  action_id: string;
  action_type: string;
  behavior_ref?: string;
  candidate_set_ref?: string;
  candidate_ref?: string;
  idempotency_key?: string;
}

export function sendAuthorAction(
  channel: Channel,
  action: AuthorActionPayload,
): Promise<{ received: boolean; action_status: string }> {
  return new Promise((resolve, reject) => {
    channel
      .push("author_action", { action }, 60000)
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
      .push("confirm", { behavior_id: behaviorId }, 60000)
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
      .push("reject", { behavior_id: behaviorId }, 60000)
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("reject timeout")));
  });
}

export function discardArtifact(
  channel: Channel,
  artifactId: string,
  artifactType?: string,
  sourceTurnRef?: string | null,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("discard", {
        artifact_id: artifactId,
        artifact_type: artifactType,
        source_turn_ref: sourceTurnRef,
      }, 60000)
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("discard timeout")));
  });
}

export function adopt(
  channel: Channel,
  artifactId: string,
  baseRevision: number | undefined,
  payload: Record<string, unknown>,
  artifactType?: string,
  sourceTurnRef?: string | null,
): Promise<{ received: boolean; action_status: string }> {
  return new Promise((resolve, reject) => {
    channel
      .push("adopt", {
        artifact_id: artifactId,
        base_revision: baseRevision,
        payload,
        artifact_type: artifactType,
        source_turn_ref: sourceTurnRef,
      }, 60000)
      .receive("ok", (response) =>
        resolve(response as { received: boolean; action_status: string }),
      )
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("adopt timeout")));
  });
}

export function modifyDraft(
  channel: Channel,
  draftId: string,
  baseRevision: number | undefined,
  content: string,
  instruction: string,
  artifactType?: string,
  sourceTurnRef?: string | null,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("modify_draft", {
        draft_id: draftId,
        base_revision: baseRevision,
        content,
        instruction,
        artifact_type: artifactType,
        source_turn_ref: sourceTurnRef,
      }, 60000)
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("modify_draft timeout")));
  });
}

export function revise(
  channel: Channel,
  behaviorId: string,
  feedback?: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("revise", { behavior_id: behaviorId, feedback }, 60000)
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

export interface TocVolume {
  id: string;
  title: string;
  seq: number;
  chapters: { id: string; title: string; seq: number }[];
}

export interface TocData {
  volumes: TocVolume[];
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
