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

export function joinWorkspace(socket: Socket, topic = "workspace:lobby"): Channel {
  const channel = socket.channel(topic, {});
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
): Promise<{ received: boolean }> {
  return new Promise((resolve, reject) => {
    channel
      .push("user_message", { text, work_id: workId })
      .receive("ok", (response) => resolve(response as { received: boolean }))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("send timeout")));
  });
}

export function confirm(
  channel: Channel,
  behaviorId: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("confirm", { behavior_id: behaviorId })
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
      .push("reject", { behavior_id: behaviorId })
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("reject timeout")));
  });
}

export function discardArtifact(
  channel: Channel,
  artifactId: string,
  artifactType?: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("discard", { artifact_id: artifactId, artifact_type: artifactType })
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
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("adopt", { artifact_id: artifactId, base_revision: baseRevision, payload, artifact_type: artifactType })
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
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
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("modify_draft", {
        draft_id: draftId,
        base_revision: baseRevision,
        content,
        instruction,
      })
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
      .push("revise", { behavior_id: behaviorId, feedback })
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
