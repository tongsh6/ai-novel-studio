// B26 外部传输故障代理：只在隔离验收中截断回执，不进入生产 runtime。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// 复用已安装 Playwright 的公开 utilsBundle 导出，不下载 WebSocket 依赖。
const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const playwrightRequire = createRequire(frontendRequire.resolve("playwright/package.json"));
const { ws: WebSocket, wsServer: WebSocketServer } = playwrightRequire("playwright-core/lib/utilsBundle");

export function createQuestionTransportProxy({ target, controlPath, logPath }) {
  const sockets = new Set();
  const log = (entry) => fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  const readControl = () => fs.existsSync(controlPath) ? JSON.parse(fs.readFileSync(controlPath, "utf8")) : {};
  const consume = (control, key) => {
    const value = control[key];
    delete control[key];
    fs.writeFileSync(controlPath, JSON.stringify(control));
    return value;
  };
  const server = http.createServer((request, response) => {
    const upstream = http.request(new URL(request.url, target), { method: request.method, headers: request.headers }, (incoming) => {
      log({ direction: "http", method: request.method, path: new URL(request.url, target).pathname, status: incoming.statusCode });
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  const socketServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    socketServer.handleUpgrade(request, socket, head, (client) => {
      const url = new URL(request.url, target);
      url.protocol = "ws:";
      const upstream = new WebSocket(url, { origin: request.headers.origin, perMessageDeflate: false });
      sockets.add(client); sockets.add(upstream);
      const pending = [];
      let lostReply = null;
      let lostResult = null;
      const forward = (data, binary) => upstream.readyState === WebSocket.OPEN ? upstream.send(data, { binary }) : pending.push([data, binary]);
      upstream.on("open", () => { for (const [data, binary] of pending.splice(0)) upstream.send(data, { binary }); });
      client.on("message", (data, binary) => {
        if (binary) { forward(data, binary); return; }
        const frame = JSON.parse(data.toString());
        const control = readControl();
        if (frame[3] === "user_message" && control.drop_next_committed_result) {
          consume(control, "drop_next_committed_result");
          lostResult = { turn_id: frame[4].turn_id };
          log({ fault: "armed_result_loss", ...lostResult });
        }
        if (frame[3] === "author_action" && frame[4]?.action?.action_type === "author_choice") {
          if (control.drop_next_author_ack) {
            consume(control, "drop_next_author_ack");
            lostReply = { ref: frame[1], submission_id: frame[4].action.payload?.submission_id };
            log({ fault: "armed_ack_loss", ...lostReply });
          }
          if (control.tamper_next_author_action) {
            const overrides = consume(control, "tamper_next_author_action");
            if (typeof overrides.target_ref !== "string" || !overrides.target_ref.trim()) throw new Error("外部负例仅允许明确的 target_ref");
            frame[4].action.target_ref = overrides.target_ref;
            log({ fault: "tampered_source_binding", overrides });
          }
        }
        log({ direction: "sent", frame });
        forward(JSON.stringify(frame), false);
      });
      upstream.on("message", (data, binary) => {
        const frame = binary ? null : JSON.parse(data.toString());
        const matchingResult = lostResult && frame?.[3] === "turn_result" && frame[4]?.turn_id === lostResult.turn_id;
        if (matchingResult) {
          log({ direction: "received", frame, dropped: true });
          log({ fault: "committed_result_lost_and_disconnected", ...lostResult });
          lostResult = null;
          client.close(1012, "external committed result interruption");
          upstream.close();
          return;
        }
        const matchingAck = lostReply && frame?.[3] === "phx_reply" && frame[1] === lostReply.ref;
        const withheld = lostReply && ["agent_event", "agent_run_state", "turn_result"].includes(frame?.[3]);
        log({ direction: "received", frame, dropped: Boolean(matchingAck || withheld) });
        if (matchingAck) {
          log({ fault: "ack_lost_and_disconnected", ...lostReply, response: frame[4] });
          client.close(1012, "external acceptance transport interruption");
          upstream.close();
          lostReply = null;
        } else if (!withheld && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary });
        }
      });
      for (const [current, peer] of [[client, upstream], [upstream, client]]) {
        current.on("error", (error) => log({ transport_error: error.message }));
        current.on("close", () => {
          sockets.delete(current);
          if (peer.readyState === WebSocket.OPEN) peer.close();
        });
      }
    });
  });
  return { server, close: () => { for (const socket of sockets) socket.terminate(); socketServer.close(); server.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, port, artifactDir] = process.argv.slice(2);
  const proxy = createQuestionTransportProxy({ target, controlPath: path.join(artifactDir, "transport-control.json"), logPath: path.join(artifactDir, "native-transport.jsonl") });
  proxy.server.listen(Number(port), "127.0.0.1", () => console.log(`native question transport proxy ready: ${port}`));
  process.on("SIGTERM", () => proxy.close());
  process.on("SIGINT", () => proxy.close());
}
