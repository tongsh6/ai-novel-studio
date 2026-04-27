import { useEffect, useState } from "react";

import { createSocket, joinWorkspace, ping } from "../lib/socket";

type Status = "idle" | "connecting" | "joined" | "error";

export function ChannelDemo() {
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pongPayload, setPongPayload] = useState<string | null>(null);

  useEffect(() => {
    const socket = createSocket();
    socket.connect();

    const channel = joinWorkspace(socket);
    channel
      .join()
      .receive("ok", () => setStatus("joined"))
      .receive("error", (resp) => {
        setStatus("error");
        setErrorMsg(JSON.stringify(resp));
      })
      .receive("timeout", () => {
        setStatus("error");
        setErrorMsg("join timeout");
      });

    const handler = async () => {
      try {
        const result = await ping(channel, { hello: "world" });
        setPongPayload(JSON.stringify(result));
      } catch (err) {
        setPongPayload(`ping failed: ${String(err)}`);
      }
    };

    const id = setTimeout(handler, 500);

    return () => {
      clearTimeout(id);
      channel.leave();
      socket.disconnect();
    };
  }, []);

  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #ccc",
        borderRadius: "0.5rem",
        margin: "1rem 0",
        fontFamily: "monospace",
      }}
    >
      <h3>WorkspaceChannel demo (Phase 0 Week 2 T9)</h3>
      <div>status: {status}</div>
      {errorMsg && <div style={{ color: "red" }}>error: {errorMsg}</div>}
      {pongPayload && <div>pong: {pongPayload}</div>}
    </div>
  );
}
