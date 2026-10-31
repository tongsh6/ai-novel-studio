import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  CHANNEL_FAULT_EVENTS,
  MAX_CHANNEL_DELAY_MS,
  channelErrorReply,
  consumeChannelFault,
  createQuestionTransportProxy,
} from "./native_question_transport_proxy.mjs";

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
