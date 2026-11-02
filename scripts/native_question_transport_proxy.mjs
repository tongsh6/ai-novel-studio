// B26/AU08 外部传输故障代理：只在隔离验收中截断回执或注入只读 channel 故障，不进入生产 runtime。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import {
  MAX_HTTP_CAPTURE_BYTES,
  httpCaptureTarget,
} from "./lib/native_ui/native_http_evidence.mjs";

// 复用已安装 Playwright 的公开 utilsBundle 导出，不下载 WebSocket 依赖。
const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const playwrightRequire = createRequire(frontendRequire.resolve("playwright/package.json"));
const { ws: WebSocket, wsServer: WebSocketServer } = playwrightRequire("playwright-core/lib/utilsBundle");

export const CHANNEL_FAULT_EVENTS = Object.freeze(["get_toc", "get_chapter_content"]);
export const MAX_CHANNEL_DELAY_MS = 30_000;

export function consumeChannelFault(control, event) {
  const fault = control.channel_faults?.[event];
  if (!fault) return null;
  if (!CHANNEL_FAULT_EVENTS.includes(event)) throw new Error(`unsupported channel fault event: ${event}`);
  if (!["error", "delay"].includes(fault.mode)) throw new Error(`unsupported channel fault mode: ${fault.mode}`);
  if (!Number.isInteger(fault.count) || fault.count < 1 || fault.count > 10) {
    throw new Error(`invalid channel fault count: ${fault.count}`);
  }
  if (fault.mode === "delay" && (!Number.isInteger(fault.delay_ms) || fault.delay_ms < 0 || fault.delay_ms > MAX_CHANNEL_DELAY_MS)) {
    throw new Error(`invalid channel fault delay: ${fault.delay_ms}`);
  }
  if (fault.count === 1) delete control.channel_faults[event];
  else control.channel_faults[event] = { ...fault, count: fault.count - 1 };
  if (Object.keys(control.channel_faults).length === 0) delete control.channel_faults;
  return fault;
}

export function channelErrorReply(frame) {
  return [
    frame[0],
    frame[1],
    frame[2],
    "phx_reply",
    { status: "error", response: { reason: "external_channel_fault", event: frame[3] } },
  ];
}

function parseCapturedJson(buffer) {
  if (buffer.length === 0) return { json: "empty", body: null };
  try {
    const body = JSON.parse(buffer.toString("utf8"));
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? { json: "valid", body }
      : { json: "invalid", body: null };
  } catch {
    return { json: "invalid", body: null };
  }
}

function responseScope(target, body) {
  if (target.kind === "resume") {
    return {
      kind: target.kind,
      work_id: body?.work?.id ?? null,
      session_id: body?.active_session?.id ?? null,
      turn_id: null,
    };
  }
  return {
    kind: target.kind,
    work_id: body?.work_id ?? null,
    session_id: body?.session_id ?? null,
    turn_id: body?.turn_id ?? null,
  };
}

// 真实 Phoenix 响应默认按客户端 accept-encoding 返回 gzip（真实批次 cp4b-pending-04 的
// resume/replay 均是 gzip）；代理对外仍原样透传压缩字节，只对**证据副本**做解压后完整
// JSON 判定。仅未知编码保留 unsupported_encoding，解压失败如实标 invalid，不当作完整。
const SUPPORTED_ENCODINGS = Object.freeze(["identity", "gzip", "x-gzip", "deflate", "br"]);

function decodeCapturedBody(buffer, encoding) {
  const normalized = String(encoding ?? "identity").toLowerCase().trim();
  if (normalized === "" || normalized === "identity") return buffer;
  if (!SUPPORTED_ENCODINGS.includes(normalized)) return null;
  if (normalized === "gzip" || normalized === "x-gzip") return zlib.gunzipSync(buffer);
  if (normalized === "deflate") return zlib.inflateSync(buffer);
  return zlib.brotliDecompressSync(buffer);
}

export function capturedHttpBody(chunks, tooLarge, encoding) {
  if (tooLarge) return { complete: false, json: "too_large", body: null };
  const buffer = Buffer.concat(chunks);
  let decoded;
  try {
    decoded = decodeCapturedBody(buffer, encoding);
  } catch {
    return { complete: true, json: "invalid", body: null, bytes: buffer.length };
  }
  if (decoded === null) return { complete: true, json: "unsupported_encoding", body: null };
  const parsed = parseCapturedJson(decoded);
  return {
    complete: true,
    json: parsed.json,
    body: parsed.body,
    bytes: buffer.length,
    sha256: createHash("sha256").update(decoded).digest("hex"),
  };
}

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
  let httpSequence = 0;
  const server = http.createServer((request, response) => {
    const startedAt = new Date().toISOString();
    const targetUrl = new URL(request.url, target);
    const captureTarget = httpCaptureTarget(request.method, request.url);
    const requestId = `http-${++httpSequence}`;

    if (!captureTarget) {
      const upstream = http.request(targetUrl, { method: request.method, headers: request.headers }, (incoming) => {
        log({ direction: "http", method: request.method, path: targetUrl.pathname, status: incoming.statusCode });
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(response);
      });
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      request.pipe(upstream);
      return;
    }

    const chunks = [];
    const state = { bytes: 0, tooLarge: false, ended: false, logged: false };
    let upstreamStatus = 502;
    const finish = (incoming) => {
      if (state.logged) return;
      state.logged = true;
      const headers = incoming?.headers ?? {};
      const declared = Number(headers["content-length"]);
      const hasLength = headers["content-length"] !== undefined && Number.isFinite(declared);
      const lengthMatches = !hasLength || state.bytes === declared;
      const classification = capturedHttpBody(
        chunks,
        state.tooLarge,
        headers["content-encoding"],
      );
      const complete = state.ended && lengthMatches && !state.tooLarge && classification.complete;
      const json = state.ended
        ? (lengthMatches ? classification.json : "length_mismatch")
        : (state.tooLarge ? "too_large" : "aborted");
      const bodyState = {
        complete,
        json,
        bytes: state.bytes,
        sha256: classification.sha256 ?? null,
        truncated: state.tooLarge || !lengthMatches || !state.ended,
        content_type: headers["content-type"] ?? null,
        content_encoding: headers["content-encoding"] ?? null,
      };
      log({
        direction: "http",
        at: startedAt,
        method: request.method,
        path: request.url,
        status: upstreamStatus,
        request_id: requestId,
        scope: captureTarget,
        response_scope: complete ? responseScope(captureTarget, classification.body) : null,
        body_state: bodyState,
        body: complete ? classification.body : null,
      });
    };

    const upstream = http.request(targetUrl, { method: request.method, headers: request.headers }, (incoming) => {
      upstreamStatus = incoming.statusCode;
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.on("data", (chunk) => {
        state.bytes += chunk.length;
        if (state.bytes <= MAX_HTTP_CAPTURE_BYTES) chunks.push(chunk);
        else state.tooLarge = true;
      });
      incoming.on("end", () => { state.ended = true; finish(incoming); });
      incoming.on("aborted", () => finish(incoming));
      incoming.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
      finish(null);
    });
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
        const channelFault = consumeChannelFault(control, frame[3]);
        if (channelFault) {
          fs.writeFileSync(controlPath, JSON.stringify(control));
          const detail = { event: frame[3], ref: frame[1], mode: channelFault.mode, count: channelFault.count };
          if (channelFault.mode === "error") {
            const reply = channelErrorReply(frame);
            log({ direction: "sent", frame, dropped: true });
            log({ fault: "channel_error_injected", ...detail });
            log({ direction: "received", frame: reply, synthetic: true });
            client.send(JSON.stringify(reply));
          } else {
            log({ direction: "sent", frame, delayed: true });
            log({ fault: "channel_delay_started", ...detail, delay_ms: channelFault.delay_ms });
            setTimeout(() => {
              log({ fault: "channel_delay_released", ...detail, delay_ms: channelFault.delay_ms });
              forward(JSON.stringify(frame), false);
            }, channelFault.delay_ms);
          }
          return;
        }
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
