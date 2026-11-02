import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import {
  CHANNEL_FAULT_EVENTS,
  MAX_CHANNEL_DELAY_MS,
  channelErrorReply,
  consumeChannelFault,
  createQuestionTransportProxy,
} from "./native_question_transport_proxy.mjs";
import { MAX_HTTP_CAPTURE_BYTES } from "./lib/native_ui/native_http_evidence.mjs";

const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const playwrightRequire = createRequire(frontendRequire.resolve("playwright/package.json"));
const { ws: WebSocket, wsServer: WebSocketServer } = playwrightRequire("playwright-core/lib/utilsBundle");

const frame = (ref, event = "get_toc") => [null, ref, "workspace:test", event, { work_id: "work-1" }];

test("channel error 按事件消费一次，后续调用自动恢复", () => {
  const control = { channel_faults: { get_toc: { mode: "error", count: 1 } } };
  assert.deepEqual(consumeChannelFault(control, "get_toc"), { mode: "error", count: 1 });
  assert.equal(consumeChannelFault(control, "get_toc"), null);
  assert.equal(consumeChannelFault(control, "get_chapter_content"), null);
  assert.deepEqual(control, {});
});

test("channel count 递减且不影响其他规则和控制字段", () => {
  const control = {
    keep: true,
    channel_faults: {
      get_toc: { mode: "error", count: 2 },
      get_chapter_content: { mode: "delay", count: 1, delay_ms: 0 },
    },
  };
  assert.deepEqual(consumeChannelFault(control, "get_toc"), { mode: "error", count: 2 });
  assert.deepEqual(control.channel_faults.get_toc, { mode: "error", count: 1 });
  assert.deepEqual(control.channel_faults.get_chapter_content, { mode: "delay", count: 1, delay_ms: 0 });
  assert.equal(control.keep, true);
  consumeChannelFault(control, "get_chapter_content");
  assert.deepEqual(Object.keys(control.channel_faults), ["get_toc"]);
});

test("channel count 上限 10 是合法一次性规则", () => {
  const control = { channel_faults: { get_toc: { mode: "error", count: 10 } } };
  assert.equal(consumeChannelFault(control, "get_toc").count, 10);
  assert.equal(control.channel_faults.get_toc.count, 9);
});

test("channel delay 必须有界，非法事件、模式和数值不能进入代理", () => {
  for (const delay_ms of [0, MAX_CHANNEL_DELAY_MS]) {
    const control = { channel_faults: { get_chapter_content: { mode: "delay", count: 1, delay_ms } } };
    assert.equal(consumeChannelFault(control, "get_chapter_content").delay_ms, delay_ms);
  }
  for (const faults of [
    { user_message: { mode: "error", count: 1 } },
    { get_toc: { mode: "drop", count: 1 } },
    { get_toc: { mode: "delay", count: 1, delay_ms: -1 } },
    { get_toc: { mode: "delay", count: 1, delay_ms: 1.5 } },
    { get_toc: { mode: "delay", count: 1, delay_ms: MAX_CHANNEL_DELAY_MS + 1 } },
    { get_toc: { mode: "error", count: 0 } },
    { get_toc: { mode: "error", count: -1 } },
    { get_toc: { mode: "error", count: 1.5 } },
    { get_toc: { mode: "error", count: 11 } },
  ]) {
    assert.throws(() => consumeChannelFault({ channel_faults: faults }, Object.keys(faults)[0]));
  }
  const errorWithUnusedDelay = { channel_faults: { get_toc: { mode: "error", count: 1, delay_ms: -1 } } };
  assert.equal(consumeChannelFault(errorWithUnusedDelay, "get_toc").mode, "error");
  assert.deepEqual([...CHANNEL_FAULT_EVENTS].sort(), ["get_chapter_content", "get_toc"]);
});

test("channel error reply 复用完整 frame 身份并返回可判读的 error", () => {
  assert.deepEqual(channelErrorReply(frame("ref-7", "get_chapter_content")), [
    null,
    "ref-7",
    "workspace:test",
    "phx_reply",
    { status: "error", response: { reason: "external_channel_fault", event: "get_chapter_content" } },
  ]);
});

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function proxyFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "au08-channel-proxy-"));
  const seen = [];
  const upstream = http.createServer();
  const socketServer = new WebSocketServer({ noServer: true });
  upstream.on("upgrade", (request, socket, head) => {
    socketServer.handleUpgrade(request, socket, head, (client) => {
      client.on("message", (data) => {
        const received = JSON.parse(data.toString());
        seen.push(received);
        client.send(JSON.stringify([
          received[0],
          received[1],
          received[2],
          "phx_reply",
          { status: "ok", response: { event: received[3] } },
        ]));
      });
    });
  });
  const upstreamPort = await listen(upstream);
  const controlPath = path.join(dir, "transport-control.json");
  const logPath = path.join(dir, "native-transport.jsonl");
  const proxy = createQuestionTransportProxy({
    target: `http://127.0.0.1:${upstreamPort}`,
    controlPath,
    logPath,
  });
  const proxyPort = await listen(proxy.server);
  t.after(async () => {
    proxy.close();
    socketServer.close();
    upstream.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    controlPath,
    logPath,
    proxyPort,
    seen,
    writeControl(value) {
      fs.writeFileSync(controlPath, JSON.stringify(value));
    },
  };
}

function request(port, outbound) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/socket/websocket`);
    const timer = setTimeout(() => {
      client.terminate();
      reject(new Error("proxy response timeout"));
    }, 3_000);
    client.on("open", () => client.send(JSON.stringify(outbound)));
    client.on("message", (data) => {
      clearTimeout(timer);
      client.close();
      resolve(JSON.parse(data.toString()));
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test("真实 WS 代理：error 不到上游，下一同事件请求恢复真实响应", async (t) => {
  const fixture = await proxyFixture(t);
  fixture.writeControl({ channel_faults: { get_toc: { mode: "error", count: 1 } } });

  const rejected = await request(fixture.proxyPort, frame("ref-error"));
  assert.equal(rejected[4].status, "error");
  assert.equal(rejected[4].response.reason, "external_channel_fault");
  assert.equal(fixture.seen.length, 0);

  const recovered = await request(fixture.proxyPort, frame("ref-recovered"));
  assert.equal(recovered[4].status, "ok");
  assert.equal(fixture.seen.length, 1);
  assert.equal(fixture.seen[0][1], "ref-recovered");

  const logs = fs.readFileSync(fixture.logPath, "utf8").trim().split("\n").map(JSON.parse);
  assert(logs.some((entry) =>
    entry.fault === "channel_error_injected" &&
    entry.ref === "ref-error" && entry.event === "get_toc" && entry.mode === "error" && entry.count === 1));
  assert(logs.some((entry) => entry.direction === "sent" && entry.frame?.[1] === "ref-error" && entry.dropped === true));
  assert(logs.some((entry) => entry.direction === "received" && entry.frame?.[1] === "ref-error" && entry.synthetic === true));
  assert(logs.some((entry) => entry.direction === "received" && entry.frame?.[1] === "ref-recovered" && !entry.synthetic));
  assert.deepEqual(JSON.parse(fs.readFileSync(fixture.controlPath, "utf8")), {});
});

test("真实 WS 代理：delay 有界延迟真实上游调用，耗次后恢复", async (t) => {
  const fixture = await proxyFixture(t);
  fixture.writeControl({
    channel_faults: { get_chapter_content: { mode: "delay", count: 1, delay_ms: 80 } },
  });

  const started = Date.now();
  const delayed = await request(fixture.proxyPort, frame("ref-delay", "get_chapter_content"));
  assert.equal(delayed[4].status, "ok");
  assert(Date.now() - started >= 55);
  assert.equal(fixture.seen.length, 1);

  const recovered = await request(fixture.proxyPort, frame("ref-delay-recovered", "get_chapter_content"));
  assert.equal(recovered[4].status, "ok");
  assert.equal(fixture.seen.length, 2);

  const logs = fs.readFileSync(fixture.logPath, "utf8").trim().split("\n").map(JSON.parse);
  for (const fault of ["channel_delay_started", "channel_delay_released"]) {
    assert(logs.some((entry) =>
      entry.fault === fault && entry.ref === "ref-delay" && entry.event === "get_chapter_content" &&
      entry.mode === "delay" && entry.count === 1 && entry.delay_ms === 80));
  }
  assert(logs.some((entry) => entry.direction === "sent" && entry.frame?.[1] === "ref-delay" && entry.delayed === true));
  assert(logs.some((entry) => entry.direction === "sent" && entry.frame?.[1] === "ref-delay-recovered" && !entry.delayed));
  assert.deepEqual(JSON.parse(fs.readFileSync(fixture.controlPath, "utf8")), {});
});

function httpGet(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: requestPath }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
  });
}

async function httpProxyFixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "au08-http-proxy-"));
  const upstream = http.createServer(handler);
  const upstreamPort = await listen(upstream);
  const controlPath = path.join(dir, "transport-control.json");
  const logPath = path.join(dir, "native-transport.jsonl");
  fs.writeFileSync(controlPath, "{}");
  const proxy = createQuestionTransportProxy({
    target: `http://127.0.0.1:${upstreamPort}`,
    controlPath,
    logPath,
  });
  const proxyPort = await listen(proxy.server);
  t.after(async () => {
    proxy.close();
    upstream.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, logPath, proxyPort };
}

function readHttpLog(logPath, pathname) {
  const rows = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  return rows.find((row) => row.direction === "http" && row.path === pathname);
}

test("真实 HTTP 代理：chunked resume/replay 保留字节并记录完整 JSON、scope 与 request id", async (t) => {
  const workId = "11111111-1111-4111-8111-111111111111";
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const turnId = "turn-replay";
  const fixture = await httpProxyFixture(t, (request, response) => {
    const body = request.url.endsWith("/sessions/resume")
      ? {
          work: { id: workId },
          active_session: { id: sessionId, work_id: workId },
          pending_adoptions: [],
          resolved_adoptions: [],
        }
      : { work_id: workId, session_id: sessionId, turn_id: turnId };
    const payload = Buffer.from(JSON.stringify(body));
    response.writeHead(200, { "content-type": "application/json" });
    response.write(payload.subarray(0, 7));
    response.end(payload.subarray(7));
  });

  const resumePath = `/api/works/${workId}/sessions/resume`;
  const replayPath = `/api/works/${workId}/sessions/${sessionId}/turns/${turnId}/replay`;
  const resume = await httpGet(fixture.proxyPort, resumePath);
  const replay = await httpGet(fixture.proxyPort, replayPath);
  assert.equal(resume.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(JSON.parse(resume.body.toString("utf8")).active_session.id, sessionId);
  assert.equal(JSON.parse(replay.body.toString("utf8")).turn_id, turnId);

  const resumeLog = readHttpLog(fixture.logPath, resumePath);
  const replayLog = readHttpLog(fixture.logPath, replayPath);
  for (const [entry, scope] of [
    [resumeLog, { kind: "resume", work_id: workId, session_id: null, turn_id: null }],
    [replayLog, { kind: "replay", work_id: workId, session_id: sessionId, turn_id: turnId }],
  ]) {
    assert.equal(entry.method, "GET");
    assert.equal(entry.status, 200);
    assert.equal(entry.body_state.complete, true);
    assert.equal(entry.body_state.json, "valid");
    assert.equal(entry.body_state.truncated, false);
    assert.deepEqual(entry.scope, scope);
    assert.match(entry.request_id, /^http-\d+$/);
  }
  assert.equal(resumeLog.body.active_session.id, sessionId);
  assert.equal(replayLog.body.turn_id, turnId);
});

test("真实 HTTP 代理：gzip/br 压缩响应解压后判定完整，非法 JSON/坏压缩/未知编码/超限失败关闭", async (t) => {
  // 真实 Phoenix 依客户端 accept-encoding 返回 gzip（cp4b-pending-04 的 resume/replay 均如此）；
  // 代理对外原样透传压缩字节，只对证据副本解压判定，不能被标成“不支持编码”而丢掉真实证据。
  const fixture = await httpProxyFixture(t, (request, response) => {
    if (request.url.includes("/turns/bad-json/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not-json");
      return;
    }
    if (request.url.includes("/turns/gzip/")) {
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      response.end(zlib.gzipSync(Buffer.from(JSON.stringify({ gzip: true }))));
      return;
    }
    if (request.url.includes("/turns/br/")) {
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "br" });
      response.end(zlib.brotliCompressSync(Buffer.from(JSON.stringify({ br: true }))));
      return;
    }
    if (request.url.includes("/turns/bad-gzip/")) {
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      response.end("not-gzip-bytes");
      return;
    }
    if (request.url.includes("/turns/zstd/")) {
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "zstd" });
      response.end("{}");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(Buffer.alloc(MAX_HTTP_CAPTURE_BYTES + 1, 0x20));
  });
  const paths = [
    "/api/works/w/sessions/s/turns/bad-json/replay",
    "/api/works/w/sessions/s/turns/gzip/replay",
    "/api/works/w/sessions/s/turns/br/replay",
    "/api/works/w/sessions/s/turns/bad-gzip/replay",
    "/api/works/w/sessions/s/turns/zstd/replay",
    "/api/works/w/sessions/s/turns/large/replay",
  ];
  for (const requestPath of paths) await httpGet(fixture.proxyPort, requestPath);
  const logs = paths.map((requestPath) => readHttpLog(fixture.logPath, requestPath));
  assert.equal(logs[0].body_state.json, "invalid");
  assert.equal(logs[0].body, null);
  assert.equal(logs[1].body_state.complete, true);
  assert.equal(logs[1].body_state.json, "valid");
  assert.deepEqual(logs[1].body, { gzip: true });
  assert.equal(logs[1].body_state.content_encoding, "gzip");
  assert.equal(logs[2].body_state.json, "valid");
  assert.deepEqual(logs[2].body, { br: true });
  assert.equal(logs[3].body_state.json, "invalid");
  assert.equal(logs[3].body, null);
  assert.equal(logs[4].body_state.json, "unsupported_encoding");
  assert.equal(logs[4].body, null);
  assert.equal(logs[5].body_state.complete, false);
  assert.equal(logs[5].body_state.json, "too_large");
  assert.equal(logs[5].body_state.truncated, true);
  assert.equal(logs[5].body, null);
});
