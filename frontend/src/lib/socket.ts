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
): Promise<{ received: boolean }> {
  return new Promise((resolve, reject) => {
    channel
      .push("user_message", { text })
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

export function adopt(
  channel: Channel,
  artifactId: string,
  baseRevision: number | undefined,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    channel
      .push("adopt", { artifact_id: artifactId, base_revision: baseRevision, payload })
      .receive("ok", (response) => resolve(response as Record<string, unknown>))
      .receive("error", (error) => reject(new Error(String(error))))
      .receive("timeout", () => reject(new Error("adopt timeout")));
  });
}
