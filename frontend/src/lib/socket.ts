import { Socket, Channel } from "phoenix";

const DEFAULT_ENDPOINT = "ws://localhost:4000/socket";

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

export interface PingResult {
  event: "pong";
  echo: Record<string, unknown>;
}

export function ping(channel: Channel, payload: Record<string, unknown>): Promise<PingResult> {
  return new Promise((resolve, reject) => {
    channel
      .push("ping", payload)
      .receive("ok", (response) => resolve(response as PingResult))
      .receive("error", (error) => reject(error))
      .receive("timeout", () => reject(new Error("ping timeout")));
  });
}
