// External C8 transport only. Contract: model-interaction-coverage §5.2.
// Never rewrites provider bodies, creates model content, retries, or signs product cancellation.
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_BODY = 8 * 1024 * 1024;
const MAX_RECORD = 1024 * 1024;
const now = () => new Date().toISOString();
const listen = (server) => new Promise((resolve, reject) => {
  server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
});
const address = (server) => "http://127.0.0.1:" + server.address().port;
const json = (res, status, body) => { res.writeHead(status, {"content-type":"application/json"}); res.end(JSON.stringify(body)); };
async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; assert(size <= limit, "body_limit"); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
// Parse an evidence copy only; offsets and forwarded Buffers retain original bytes.
function recordBoundary(bytes) {
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 10 && bytes[i + 1] === 10) return i + 2;
    if (i + 3 < bytes.length && bytes[i] === 13 && bytes[i+1] === 10 && bytes[i+2] === 13 && bytes[i+3] === 10) return i + 4;
  }
  return null;
}
function hasContent(record) {
  const data = record.toString("utf8").split(/\r?\n/u)
    .filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /u, "")).join("\n");
  if (!data || data === "[DONE]") return false;
  const body = JSON.parse(data);
  assert(!body.choices?.some(choice => choice.finish_reason != null &&
    typeof choice?.delta?.content === "string" && choice.delta.content.length > 0), "content_record_terminal");
  return Array.isArray(body.choices) && body.choices.some(choice =>
    typeof choice?.delta?.content === "string" && choice.delta.content.length > 0);
}

export async function createProviderStreamProxy({ upstreamEndpoint, artifactDir, pauseMs = 30000 }) {
  const upstreamUrl = new URL(upstreamEndpoint);
  assert(["http:", "https:"].includes(upstreamUrl.protocol) && !upstreamUrl.username &&
    !upstreamUrl.password && !upstreamUrl.search && !upstreamUrl.hash, "unsafe_upstream_endpoint");
  assert(Number.isInteger(pauseMs) && pauseMs > 0 && pauseMs <= 30000, "invalid_pause_bound");
  fs.mkdirSync(path.join(artifactDir, "provider-stream-requests"), {recursive:true});
  const log = (entry) => fs.appendFileSync(path.join(artifactDir, "provider-stream.jsonl"), JSON.stringify({at:now(), ...entry})+"\n");
  const entries = [], live = new Map(), sockets = new Set(), upstreamClosures = [];
  let window = null, gate = null, disarmed = false, closing = false;
  const state = () => ({ window, gate, disarmed, active_requests:[...live.keys()] });
  function finish(entry, cause) {
    const io = live.get(entry.request_id);
    if (!io) return;
    if (!entry.cause) entry.cause = cause;
    clearTimeout(io.timer);
    if (gate?.request_id === entry.request_id && !gate.cause) gate.cause = cause;
    if (!io.upstream.destroyed) {
      if (gate?.request_id === entry.request_id) gate.upstream_destroy_requested = true;
      log({event:"upstream_destroy_requested",request_id:entry.request_id,cause});
      io.destroyRequested = true;
      io.upstream.destroy();
    }
    io.incoming?.destroy();
    if (!io.response.destroyed) io.response.destroy();
    live.delete(entry.request_id);
    entry.ended_at = now();
    log({event:"request_closed",request_id:entry.request_id,cause:entry.cause});
  }
  const server = http.createServer(async (req, res) => {
    let entry;
    try {
      const raw = await readBody(req, MAX_BODY);
      const requestId = "request-" + (entries.length + 1);
      entry = { request_id:requestId, method:req.method, path:req.url, received_at:now(),
        request_sha256:hash(raw), window_id:window?.id ?? null, first_content_at:null, ended_at:null,
        upstream_ended:false, cause:null };
      fs.writeFileSync(path.join(artifactDir, "provider-stream-requests", requestId+".bin"), raw);
      entries.push(entry); log({event:"request_registered",...entry});
      assert(req.url.startsWith("/") && !req.url.startsWith("//"), "request_must_be_origin_form");
      const target = new URL(req.url, upstreamUrl.origin);
      assert(target.origin === upstreamUrl.origin, "foreign_upstream_origin");
      // Only route the original configured API prefix, never arbitrary destinations.
      assert(target.pathname === upstreamUrl.pathname || target.pathname.startsWith(upstreamUrl.pathname.replace(/\/$/u,"")+"/"), "foreign_api_path");
      const outgoing = (upstreamUrl.protocol === "https:" ? https : http).request(target, {
        method:req.method, headers:{...req.headers,host:upstreamUrl.host},
      });
      const io = { upstream:outgoing, response:res, incoming:null, timer:null, pending:Buffer.alloc(0),
        received:createHash("sha256"), delivered:createHash("sha256"), receivedBytes:0, deliveredBytes:0 };
      live.set(requestId,io);
      const deliver = bytes => {
        if (!bytes.length) return;
        io.delivered.update(bytes); io.deliveredBytes += bytes.length;
        fs.appendFileSync(path.join(artifactDir,"provider-stream-requests",requestId+".delivered.bin"),bytes);
        res.write(bytes);
      };
      upstreamClosures.push(new Promise(resolve => outgoing.once("close", resolve)));
      outgoing.on("response", incoming => {
        io.incoming = incoming;
        incoming.socket.once("end", () => log({event:"upstream_socket_end_observed",request_id:requestId}));
        res.writeHead(incoming.statusCode, incoming.headers); res.flushHeaders();
        const sse = String(incoming.headers["content-type"] ?? "").toLowerCase().includes("text/event-stream");
        entry.response_encoding = String(incoming.headers["content-encoding"] ?? "identity");
        incoming.on("data", chunk => {
          try {
            io.received.update(chunk); io.receivedBytes += chunk.length;
            fs.appendFileSync(path.join(artifactDir,"provider-stream-requests",requestId+".received.bin"),chunk);
            const armed = gate?.request_id === requestId && !gate.cause;
            if (armed) assert(entry.response_encoding === "identity", "unsupported_sse_encoding");
            if (!sse) {
              if (armed) throw new Error("armed_response_not_sse");
              deliver(chunk); return;
            }
            if (!armed) deliver(chunk);
            io.pending = Buffer.concat([io.pending,chunk]);
            assert(io.pending.length <= MAX_RECORD, "sse_record_limit");
            let offset;
            while ((offset = recordBoundary(io.pending)) !== null) {
              const record = io.pending.subarray(0,offset);
              io.pending = io.pending.subarray(offset);
              const content = hasContent(record);
              if (content && !entry.first_content_at) entry.first_content_at = now();
              if (armed) deliver(record);
              if (content && armed) {
                incoming.pause();
                gate.paused_at = now(); gate.prefix_bytes = io.deliveredBytes;
                gate.prefix_sha256 = io.delivered.copy().digest("hex");
                gate.upstream_ended = entry.upstream_ended;
                log({event:"prefix_delivered_and_paused",...gate});
                io.timer = setTimeout(() => finish(entry,"pause_timeout"), pauseMs);
                return;
              }
            }
          } catch (error) {
            entry.observation_error = error.message;
            log({event:"stream_error",request_id:requestId,error:error.message});
            if (gate?.request_id === requestId) finish(entry,"stream_error");
            else io.pending = Buffer.alloc(0);
          }
        });
        incoming.on("end", () => {
          entry.upstream_ended = true;
          if (gate?.request_id === requestId) gate.upstream_ended = true;
          log({event:"upstream_end",request_id:requestId});
          if (gate?.request_id === requestId && gate.paused_at && !gate.cause) return;
          entry.ended_at = now(); entry.cause = "upstream_end";
          log({event:"transparent_complete",request_id:requestId,received_bytes:io.receivedBytes,
            delivered_bytes:io.deliveredBytes,received_sha256:io.received.digest("hex"),delivered_sha256:io.delivered.digest("hex")});
          live.delete(requestId); res.end();
        });
        incoming.on("error", error => {
          entry.upstream_error = true;
          if (gate?.request_id === requestId) gate.upstream_error = true;
          log({event:"upstream_error",request_id:requestId,error:error.code ?? error.message});
          if (live.has(requestId)) finish(entry,"upstream_error");
        });
      });
      outgoing.on("close", () => {
        const complete = io.incoming?.complete === true;
        if (gate?.request_id === requestId) {
          gate.upstream_closed = true;
          gate.upstream_response_complete = complete;
          gate.upstream_complete_before_disconnect = complete && entry.cause === null &&
            !io.destroyRequested && !entry.upstream_error;
        }
        log({event:"upstream_close",request_id:requestId,cause:entry.cause,
          upstream_ended:entry.upstream_ended,response_complete:complete});
      });
      outgoing.on("error", error => {
        entry.upstream_error = true;
        if (gate?.request_id === requestId) gate.upstream_error = true;
        log({event:"upstream_error",request_id:requestId,error:error.code ?? error.message});
        if (live.has(requestId)) finish(entry,"upstream_error");
      });
      res.on("close", () => {
        if (!live.has(requestId)) return;
        log({event:"downstream_close",request_id:requestId,writable_finished:res.writableFinished});
        finish(entry, closing ? "cleanup" : "downstream_disconnect");
      });
      outgoing.end(raw);
    } catch (error) {
      log({event:"request_error",request_id:entry?.request_id,error:error.message});
      if (entry && live.has(entry.request_id)) finish(entry,"request_error");
      else if (!res.headersSent) json(res,502,{error:error.message});
      else res.destroy();
    }
  });
  const control = http.createServer(async (req,res) => {
    try {
      if (req.method === "GET" && req.url === "/state") return json(res,200,state());
      if (req.method === "GET" && req.url === "/registry") return json(res,200,{requests:entries.filter(e => e.window_id === window?.id)});
      assert(req.method === "POST","control_method");
      const body = JSON.parse((await readBody(req,65536)).toString());
      if (req.url === "/window") {
        assert(!window && !gate,"window_already_open");
        window = {id:"c-window",opened_at:now()}; log({event:"window_opened",...window});
      } else if (req.url === "/arm") {
        assert(window && !gate && !disarmed,"gate_unavailable");
        const entry = entries.find(e => e.request_id === body.request_id && e.window_id === window.id);
        assert(entry && entry.request_sha256 === body.request_sha256 &&
          entries.filter(e => e.window_id === window.id && e.request_sha256 === entry.request_sha256).length === 1,"request_binding_ambiguous");
        assert(!entry.first_content_at && !entry.ended_at && !entry.observation_error && live.has(entry.request_id) && live.get(entry.request_id).pending.length === 0,"arm_after_content_or_terminal");
        assert(typeof body.provider_run_ref === "string" && typeof body.provider_call_ref === "string","missing_provider_binding");
        gate = {request_id:entry.request_id,request_sha256:entry.request_sha256,
          provider_run_ref:body.provider_run_ref,provider_call_ref:body.provider_call_ref,armed_at:now(),
          paused_at:null,cause:null,upstream_destroy_requested:false,upstream_closed:false,upstream_ended:false,
          upstream_response_complete:false,upstream_complete_before_disconnect:false,upstream_error:false};
        log({event:"gate_armed",...gate});
      } else if (req.url === "/disarm") {
        assert(!disarmed && gate?.cause === "downstream_disconnect" && gate.paused_at && !gate.upstream_error &&
          (gate.upstream_destroy_requested || gate.upstream_complete_before_disconnect) &&
          gate.upstream_closed && live.size === 0,"gate_not_cancelled_and_drained");
        disarmed = true; log({event:"gate_disarmed",...state()});
      } else throw new Error("unknown_control");
      json(res,200,state());
    } catch (error) { json(res,409,{error:error.message}); }
  });
  for (const instance of [server,control]) instance.on("connection",socket => {
    sockets.add(socket); socket.on("close",()=>sockets.delete(socket));
  });
  await listen(server); await listen(control);
  const ready = {pid:process.pid,endpoint:address(server)+upstreamUrl.pathname.replace(/\/$/u,""),
    control_endpoint:address(control),upstream_endpoint:upstreamEndpoint};
  fs.writeFileSync(path.join(artifactDir,"provider-stream-ready.json.tmp"),JSON.stringify(ready));
  fs.renameSync(path.join(artifactDir,"provider-stream-ready.json.tmp"),path.join(artifactDir,"provider-stream-ready.json"));
  return {ready,state,close:async () => {
    closing = true;
    for (const entry of entries) if (live.has(entry.request_id)) finish(entry,"cleanup");
    for (const socket of sockets) socket.destroy();
    await Promise.all(upstreamClosures);
    await Promise.all([server,control].map(instance => new Promise(resolve=>instance.close(resolve))));
  }};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [upstreamEndpoint,artifactDir] = process.argv.slice(2);
  const proxy = await createProviderStreamProxy({upstreamEndpoint,artifactDir});
  for (const signal of ["SIGTERM","SIGINT"]) process.once(signal,()=>void proxy.close());
}
