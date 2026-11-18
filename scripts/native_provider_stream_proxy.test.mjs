import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createProviderStreamProxy } from "./native_provider_stream_proxy.mjs";
import { verifyStreamCancellationFacts } from "./lib/native_ui/authoring_interleaved_resume_evidence.mjs";

const content = Buffer.from('data: {"choices":[{"delta":{"content":"原文"}}]}\r\n\r\n');
const done = Buffer.from("data: [DONE]\n\n");
const role = Buffer.from('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
async function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-gate-"));
  const requests = [];
  const upstream = http.createServer((req, res) => {
    const body = [];
    req.on("data", (chunk) => body.push(chunk));
    req.on("end", () => {
      const captured = { req, res, body: Buffer.concat(body), closed: false };
      requests.push(captured);
      res.on("close", () => { captured.closed = true; });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
    });
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const proxy = await createProviderStreamProxy({
    upstreamEndpoint: "http://127.0.0.1:" + upstream.address().port + "/v1", artifactDir: dir, ...options,
  });
  t.after(async () => { await proxy.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const control = async (route, data) => {
    const response = await fetch(proxy.ready.control_endpoint + route, data === undefined ? {} :
      { method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json" } });
    const result = await response.json();
    return { status: response.status, ...result };
  };
  const send = (body = '{ "model":"literal", "stream":true }') => {
    const received = [];
    const req = http.request(proxy.ready.endpoint + "/chat/completions", { method: "POST" });
    req.on("error", () => {});
    const response = new Promise(resolve => req.on("response", res => {
      res.on("data", chunk => received.push(chunk)); res.on("error", () => {}); resolve(res);
    }));
    req.end(body);
    return { req, response, received };
  };
  const wait = async (predicate) => {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); }
    assert.fail("bounded fixture observation timeout");
  };
  return { dir, proxy, control, send, requests, wait };
}
async function arm(f) {
  const registry = await f.control("/registry");
  const r = registry.requests.at(-1);
  const result = await f.control("/arm", { request_id: r.request_id, request_sha256: r.request_sha256,
    provider_run_ref: "prun-literal", provider_call_ref: "pcall-literal" });
  assert.equal(result.status, 200);
  return r;
}

test("registry透传业务；精确arm后同data的content前缀原字节交付、DONE暂停，abort传播", async t => {
  const f = await setup(t);
  await f.control("/window", {});
  const business = f.send("business raw bytes");
  await f.wait(() => f.requests.length === 1);
  f.requests[0].res.end(Buffer.concat([role, content, done]));
  await business.response; await f.wait(() => Buffer.concat(business.received).equals(Buffer.concat([role, content, done])));
  const client = f.send();
  await f.wait(() => f.requests.length === 2);
  const selected = await arm(f);
  f.requests[1].res.write(Buffer.concat([role, content, done]));
  await client.response;
  await f.wait(() => Buffer.concat(client.received).equals(Buffer.concat([role, content])));
  assert.equal(f.requests[1].body.toString(), '{ "model":"literal", "stream":true }');
  const commandSentAt = new Date().toISOString();
  client.req.destroy();
  await f.wait(() => f.requests[1].closed);
  const state = await f.control("/state");
  assert.equal(state.gate.cause, "downstream_disconnect");
  assert.equal(state.gate.upstream_destroy_requested, true);
  assert.equal(state.gate.upstream_closed, true);
  assert.equal((await f.control("/disarm", {})).status, 200);
  const events=fs.readFileSync(path.join(f.dir,"provider-stream.jsonl"),"utf8").trim().split("\n").map(JSON.parse);
  const bytes=Object.fromEntries(["request","received","delivered"].map(kind=>[kind,
    fs.readFileSync(path.join(f.dir,"provider-stream-requests",selected.request_id+(kind==="request"?"":"."+kind)+".bin"))]));
  const probe={stream_binding:{request_id:selected.request_id,request_sha256:selected.request_sha256,
    provider_run_ref:"prun-literal",provider_call_ref:"pcall-literal"},command_sent_at:commandSentAt};
  const actual={provider_run_ref:"prun-literal",provider_call_ref:"pcall-literal",
    request:{body:{model:"literal",stream:true}}};
  assert.equal(verifyStreamCancellationFacts(probe,events,bytes,actual).vendor_compute_stopped,null);
  for (const mutate of [
    rows=>{rows.find(e=>e.event==="request_registered" && e.request_id===selected.request_id).window_id="different";},
    rows=>{rows.find(e=>e.event==="upstream_destroy_requested").cause="pause_timeout";},
    rows=>{rows.splice(rows.findIndex(e=>e.event==="downstream_close"),1);},
    rows=>{rows.push({...rows.find(e=>e.event==="gate_armed")});},
    rows=>{rows.find(e=>e.event==="gate_disarmed").active_requests=["still-active"];},
    rows=>{rows.find(e=>e.event==="prefix_delivered_and_paused").prefix_sha256="wrong";},
  ]) {
    const changed=structuredClone(events);mutate(changed);
    assert.throws(()=>verifyStreamCancellationFacts(probe,changed,bytes,actual));
  }
  assert.throws(()=>verifyStreamCancellationFacts(probe,events,{...bytes,delivered:Buffer.from("fabricated")},actual));
  for (const invalid of [Buffer.concat([bytes.delivered,content]),bytes.delivered.subarray(0,bytes.delivered.length-4)]) {
    const changed=structuredClone(events),paused=changed.find(e=>e.event==="prefix_delivered_and_paused");
    paused.prefix_bytes=invalid.length;paused.prefix_sha256=createHash("sha256").update(invalid).digest("hex");
    assert.throws(()=>verifyStreamCancellationFacts(probe,changed,{...bytes,delivered:invalid,received:Buffer.concat([invalid,done])},actual));
  }

  assert.equal((await f.control("/arm", state.gate)).status, 409);
  const d = f.send('{"D":"original"}');
  await f.wait(() => f.requests.length === 3);
  f.requests[2].res.end(Buffer.concat([content, done]));
  await d.response; await f.wait(() => Buffer.concat(d.received).equals(Buffer.concat([content, done])));
});

test("上游HTTP先完整关闭不伪造abort，真实下游断开后可drain", async t => {
  const f = await setup(t); await f.control("/window", {});
  const client = f.send(); await f.wait(() => f.requests.length === 1); await arm(f);
  const upstreamSocket = f.requests[0].res.socket;
  f.requests[0].res.end(Buffer.concat([content, done]), () => upstreamSocket.end());
  await client.response;
  await f.wait(() => f.proxy.state().gate.upstream_closed);
  assert.equal(f.proxy.state().gate.upstream_response_complete, true);
  assert.equal((await f.control("/disarm", {})).status, 409, "上游关闭不能替代下游取消");
  client.req.destroy();
  await f.wait(() => f.proxy.state().gate.cause === "downstream_disconnect");
  assert.equal(f.proxy.state().gate.upstream_destroy_requested, false);
  assert.equal((await f.control("/disarm", {})).status, 200);
});

function literalTransport(priorComplete) {
  const request = Buffer.from('{"stream":true}');
  const binding = {request_id:"request-1",request_sha256:createHash("sha256").update(request).digest("hex"),
    provider_run_ref:"prun-fixed",provider_call_ref:"pcall-fixed"};
  const row = (event, second, extra={}) => ({event,request_id:"request-1",at:`2026-11-18T03:00:${String(second).padStart(2,"0")}.000Z`,...extra});
  const close = row("upstream_close",priorComplete ? 3 : 6,
    {cause:priorComplete ? null : "downstream_disconnect",response_complete:priorComplete});
  const events = [
    row("window_opened",0,{id:"c-window"}), row("request_registered",0,{...binding,window_id:"c-window"}),
    row("gate_armed",1,binding),row("prefix_delivered_and_paused",2,
      {prefix_bytes:content.length,prefix_sha256:createHash("sha256").update(content).digest("hex")}),
    ...(priorComplete ? [close] : []),row("downstream_close",5),
    ...(!priorComplete ? [row("upstream_destroy_requested",5,{cause:"downstream_disconnect"}),close] : []),
    row("gate_disarmed",7,{disarmed:true,active_requests:[],gate:{cause:"downstream_disconnect"}}),
  ];
  return {probe:{stream_binding:binding,command_sent_at:"2026-11-18T03:00:04.000Z"},events,
    bytes:{request,received:Buffer.concat([content,done]),delivered:content},
    actual:{provider_run_ref:"prun-fixed",provider_call_ref:"pcall-fixed",request:{body:{stream:true}}}};
}
const verifyLiteral = s => verifyStreamCancellationFacts(s.probe,s.events,s.bytes,s.actual);
test("独立原义：先完整HTTP关闭与仍在途abort分别证明，不倒签异常close", () => {
  assert.equal(verifyLiteral(literalTransport(true)).transport_abort_observed,false);
  assert.equal(verifyLiteral(literalTransport(false)).transport_abort_observed,true);
  for (const mutate of [
    s => { delete s.events.find(e=>e.event==="upstream_close").response_complete; },
    s => { s.events.find(e=>e.event==="upstream_close").response_complete=false; },
    s => { s.events=s.events.filter(e=>e.event!=="downstream_close"); },
    s => { s.events.find(e=>e.event==="gate_disarmed").gate.cause="pause_timeout"; },
    s => { s.events.find(e=>e.event==="gate_disarmed").gate.cause="cleanup"; },
    s => { s.events.splice(4,0,{event:"upstream_error",request_id:"request-1",at:"2026-11-18T03:00:02.500Z"}); },
    s => { s.events.splice(6,0,{event:"upstream_destroy_requested",request_id:"request-1",cause:"downstream_disconnect"}); },
  ]) { const s=literalTransport(true);mutate(s);assert.throws(()=>verifyLiteral(s)); }
});
test("独立原义：仍在途缺abort、上游错误、超时或清理不得通过", () => {
  for (const mutate of [
    s => { s.events.find(e=>e.event==="gate_disarmed").gate.upstream_error=true; },
    s => { s.events=s.events.filter(e=>e.event!=="upstream_destroy_requested"); },
    s => { s.events.splice(4,0,{event:"upstream_error",request_id:"request-1",at:"2026-11-18T03:00:02.500Z"}); },
    s => { s.events.find(e=>e.event==="upstream_destroy_requested").cause="pause_timeout"; },
    s => { s.events.find(e=>e.event==="gate_disarmed").gate.cause="cleanup"; },
  ]) { const s=literalTransport(false);mutate(s);assert.throws(()=>verifyLiteral(s)); }
});

test("首content已到达后迟arm拒绝，不能事后暂停", async t => {
  const f = await setup(t); await f.control("/window", {});
  const client = f.send(); await f.wait(() => f.requests.length === 1);
  f.requests[0].res.write(content); await client.response;
  await f.wait(() => Buffer.concat(client.received).equals(content));
  const r = (await f.control("/registry")).requests[0];
  assert.equal((await f.control("/arm", { request_id:r.request_id, request_sha256:r.request_sha256 })).status, 409);
  f.requests[0].res.end(done);
});

test("同hash多请求与错误hash不取得一次性gate", async t => {
  const f = await setup(t); await f.control("/window", {});
  f.send(); f.send(); await f.wait(() => f.requests.length === 2);
  const r = (await f.control("/registry")).requests[0];
  for (const hash of ["bad", r.request_sha256])
    assert.equal((await f.control("/arm", { request_id:r.request_id, request_sha256:hash })).status, 409);
});

test("跨包UTF8/CRLF、多行data及reasoning不触发；首完整content后暂停", async t => {
  const f = await setup(t); await f.control("/window", {});
  const client = f.send(); await f.wait(() => f.requests.length === 1); await arm(f);
  const reasoning = Buffer.from('data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n\n');
  f.requests[0].res.write(reasoning);
  await client.response; await f.wait(() => Buffer.concat(client.received).equals(reasoning));
  const multi = Buffer.from('data: {"choices":\r\ndata: [{"delta":{"content":"原文"}}]}\r\n\r\n');
  for (const byte of multi) f.requests[0].res.write(Buffer.from([byte]));
  f.requests[0].res.write(done);
  await f.wait(() => Buffer.concat(client.received).equals(Buffer.concat([reasoning, multi])));
  client.req.destroy();
});

test("单record正文附finish_reason不能造在途窗口；错误/cleanup不能代签", async t => {
  const f = await setup(t); await f.control("/window", {});
  const client = f.send(); await f.wait(()=>f.requests.length===1); await arm(f);
  f.requests[0].res.write('data: {"choices":[{"delta":{"content":"末字"},"finish_reason":"stop"}]}\n\n');
  await client.response; await f.wait(()=>f.requests[0].closed);
  assert.equal((await f.control("/state")).gate.cause,"stream_error");
  assert.equal((await f.control("/disarm",{})).status,409);
});

test("cleanup终结不是用户取消且结束所有上游连接", async t => {
  const f = await setup(t); await f.control("/window", {});
  const client=f.send(); await f.wait(()=>f.requests.length===1); await arm(f);
  f.requests[0].res.write(content); await client.response;
  await f.wait(()=>f.proxy.state().gate.paused_at);
  await f.proxy.close();
  assert.equal(f.proxy.state().gate.cause,"cleanup");
  assert.equal(f.proxy.state().gate.upstream_closed,true);
});

test("只准原upstream的origin-form路径，不变任意host代理", async t => {
  const f = await setup(t);
  for (const requestPath of ["http://127.0.0.1:1/v1/chat/completions","//127.0.0.1:1/v1/chat/completions","/other"]) {
    const status = await new Promise((resolve,reject)=>{
      const req=http.request(f.proxy.ready.endpoint,{method:"POST",path:requestPath},res=>{
        res.resume();res.on("end",()=>resolve(res.statusCode));
      }); req.on("error",reject);req.end("{}");
    });
    assert.equal(status,502);
  }
  assert.equal(f.requests.length,0);
});

test("首正文分包已提前交付部分时拒绝arm，避免重新交付重复字节", async t => {
  const f=await setup(t);await f.control("/window",{});
  const client=f.send();await f.wait(()=>f.requests.length===1);
  f.requests[0].res.write(content.subarray(0,10));await client.response;
  await f.wait(()=>Buffer.concat(client.received).length===10);
  const r=(await f.control("/registry")).requests[0];
  assert.equal((await f.control("/arm",{request_id:r.request_id,request_sha256:r.request_sha256,
    provider_run_ref:"p",provider_call_ref:"c"})).status,409);
  f.requests[0].res.end(Buffer.concat([content.subarray(10),done]));
  await f.wait(()=>Buffer.concat(client.received).equals(Buffer.concat([content,done])));
});

test("暂停到期不是用户取消、无自动重试，不能disarm签成功", async t => {
  const f = await setup(t, { pauseMs: 30 }); await f.control("/window", {});
  const client = f.send(); await f.wait(() => f.requests.length === 1); await arm(f);
  f.requests[0].res.write(content); await client.response;
  await f.wait(() => f.requests[0].closed);
  const state = await f.control("/state");
  assert.equal(state.gate.cause, "pause_timeout");
  assert.equal((await f.control("/disarm", {})).status, 409);
  assert.equal(f.requests.length, 1);
});
