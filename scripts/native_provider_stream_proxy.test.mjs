import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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
      res.writeHead(options.responseStatus ?? 200, { "content-type": "text/event-stream", ...options.responseHeaders });
      res.flushHeaders();
    });
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const upstreamEndpoint = "http://127.0.0.1:" + upstream.address().port + "/v1";
  const proxy = await createProviderStreamProxy({ upstreamEndpoint, artifactDir: dir, ...options });
  t.after(async () => { await proxy.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const control = async (route, data) => {
    const response = await fetch(proxy.ready.control_endpoint + route, data === undefined ? {} :
      { method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json" } });
    const result = await response.json();
    return { status: response.status, ...result };
  };
  const send = (body = '{ "model":"literal", "stream":true }', headers = {}, suffix = "/chat/completions", method = "POST") => {
    const received = [];
    const req = http.request(proxy.ready.endpoint + suffix, { method, headers });
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
  return { dir, proxy, control, send, requests, wait, upstreamEndpoint };
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
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const observationEvents = f => fs.readFileSync(path.join(f.dir, "provider-stream.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
test("observe拒绝所有gate操作，原始帧/半帧/空正文/压缩均无解释透传", async t => {
  const f = await setup(t, {mode:"observe"});
  assert.equal(f.proxy.ready.mode, "observe");
  for (const route of ["/window","/arm","/disarm"]) assert.equal((await f.control(route, {})).status,409);
  const bodies = [Buffer.concat([role,done]), content,
    Buffer.from('data: {"choices":[{"delta":{"content":"末字"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'),
    Buffer.from("data: {unfinished"), Buffer.from([31,139,8,0,255,0,128])];
  for (const bytes of bodies) {
    const client = f.send(); await f.wait(()=>f.requests.length===bodies.indexOf(bytes)+1);
    f.requests.at(-1).res.end(bytes); await client.response;
    await f.wait(()=>Buffer.concat(client.received).equals(bytes));
  }
  await f.wait(()=>observationEvents(f).filter(e=>e.event==="transparent_complete").length===bodies.length);
  const snap = await f.control("/snapshot");
  assert.equal(snap.requests.length,bodies.length);
  for (const [i,r] of snap.requests.entries()) {
    const bytes=bodies[i];
    assert.equal(r.received_sha256,digest(bytes)); assert.equal(r.delivered_sha256,digest(bytes));
    assert.equal(r.response_status,200); assert.equal(r.content_type,"text/event-stream");
    assert.equal(r.response_complete,true); assert.equal(r.cause,"upstream_end");
    assert.equal(r.received_bytes,bytes.length); assert.equal(r.delivered_bytes,bytes.length);
    assert.equal(fs.readFileSync(path.join(f.dir,"provider-stream-requests",r.request_id+".received.bin")).equals(bytes),true);
  }
  assert.equal(observationEvents(f).some(e=>e.event==="stream_error"),false);
});
test("observe只读snapshot不中断流、不消耗hash；断连保partial而非自然结束", async t => {
  const f=await setup(t,{mode:"observe"}); const client=f.send();
  await f.wait(()=>f.requests.length===1); f.requests[0].res.write(content); await client.response;
  await f.wait(()=>Buffer.concat(client.received).equals(content));
  const a=await f.control("/snapshot"), b=await f.control("/snapshot");
  assert.equal(a.requests[0].received_sha256,b.requests[0].received_sha256);
  assert.equal(a.requests[0].cause,null); assert.equal(a.active_requests.length,1);
  f.requests[0].res.write(done); await f.wait(()=>Buffer.concat(client.received).equals(Buffer.concat([content,done])));
  client.req.destroy(); await f.wait(()=>f.requests[0].closed);
  const closed=observationEvents(f).find(e=>e.event==="request_closed");
  assert.equal(closed.cause,"downstream_disconnect"); assert.equal(closed.response_complete,false);
  assert.equal(closed.received_sha256,digest(Buffer.concat([content,done])));
  const ev=observationEvents(f); assert.deepEqual(ev.map(e=>e.sequence),ev.map((_,i)=>i+1));
  const offsets=ev.filter(e=>e.event==="bytes_received").map(e=>e.bytes);
  assert.ok(offsets.length>=2); assert.equal(offsets.at(-1),content.length+done.length);
});
test("observe上游截断与清场保留独立partial hash，不伪造EOF或额外调用", async t => {
  for (const cause of ["upstream","cleanup"]) {
    const f=await setup(t,{mode:"observe"});const client=f.send();
    await f.wait(()=>f.requests.length===1); f.requests[0].res.write(content);await client.response;
    await f.wait(()=>Buffer.concat(client.received).equals(content));
    if(cause==="upstream") f.requests[0].res.destroy(); else await f.proxy.close();
    await f.wait(()=>observationEvents(f).some(e=>e.event==="request_closed"));
    const closed=observationEvents(f).find(e=>e.event==="request_closed");
    assert.equal(closed.received_sha256,digest(content));assert.equal(closed.delivered_sha256,digest(content));
    assert.equal(closed.response_complete,false);
    assert.equal(closed.cause,cause==="cleanup"?"cleanup":"upstream_aborted");
    assert.equal(f.requests.length,1);
    assert.equal(observationEvents(f).some(e=>e.event==="transparent_complete"),false);
  }
});
test("observe响应白名单与私密header/query不落证据，HTTP错误/编码不改写", async t => {
  const secret="CREDENTIAL_SENTINEL_DO_NOT_LOG";
  const f=await setup(t,{mode:"observe",responseStatus:429,responseHeaders:{
    "content-encoding":"gzip","set-cookie":secret,"x-access-token":secret}});
  const bytes=Buffer.from([31,139,8,0,128,255]);
  const client=f.send("literal-private-body",{"authorization":"Bearer "+secret,"cookie":secret},
    "/chat/completions?access_token="+secret);
  await f.wait(()=>f.requests.length===1);f.requests[0].res.end(bytes);
  const response=await client.response;await f.wait(()=>Buffer.concat(client.received).equals(bytes));
  assert.equal(response.statusCode,429);
  assert.equal(f.requests[0].req.headers.authorization,"Bearer "+secret);
  const snapshot=await f.control("/snapshot");const r=snapshot.requests[0];
  assert.equal(r.response_status,429);assert.equal(r.response_encoding,"gzip");
  assert.equal(r.content_type,"text/event-stream");assert.equal(r.received_sha256,digest(bytes));
  assert.equal(JSON.stringify(snapshot).includes(secret),false);
  assert.equal(fs.readFileSync(path.join(f.dir,"provider-stream.jsonl"),"utf8").includes(secret),false);
});
test("observe慢下游有背压，分包字节原样且取消结束暂停中的上游", async t => {
  const f=await setup(t,{mode:"observe"});const client=f.send();
  await f.wait(()=>f.requests.length===1);const response=await client.response;response.pause();
  const bytes=Buffer.alloc(2*1024*1024,0x78);
  f.requests[0].res.write(bytes);
  await f.wait(()=>observationEvents(f).some(e=>e.event==="downstream_backpressure"));
  client.req.destroy();await f.wait(()=>f.requests[0].closed);
  const closed=observationEvents(f).find(e=>e.event==="request_closed");
  assert.equal(closed.cause,"downstream_disconnect");
  const raw=fs.readFileSync(path.join(f.dir,"provider-stream-requests","request-1.received.bin"));
  const delivered=fs.readFileSync(path.join(f.dir,"provider-stream-requests","request-1.delivered.bin"));
  assert.equal(closed.received_sha256,digest(raw));assert.equal(closed.delivered_sha256,digest(delivered));
  assert.ok(raw.length>0);assert.ok(raw.equals(bytes.subarray(0,raw.length)));
});
test("observe非UTF8/分字节边界及大record不触SSE解析限制", async t => {
  const f=await setup(t,{mode:"observe"});const client=f.send();
  await f.wait(()=>f.requests.length===1);
  for(const byte of content) f.requests[0].res.write(Buffer.from([byte]));
  const large=Buffer.alloc(1024*1024+1,0xff);f.requests[0].res.end(large);
  await client.response;const expected=Buffer.concat([content,large]);
  await f.wait(()=>Buffer.concat(client.received).equals(expected));
  const snap=await f.control("/snapshot");
  assert.equal(snap.requests[0].received_sha256,digest(expected));
  assert.equal(snap.requests[0].delivered_sha256,digest(expected));
  assert.equal(observationEvents(f).some(e=>e.event==="stream_error"),false);
});

for (const mode of ["gate", "observe"]) {
  test(`${mode} 请求结束后保留的上游连接晚关，proxy.close 返回后证据不再变化`, { timeout: 5000 }, async t => {
    const f = await setup(t, { mode });
    const client = f.send();
    await f.wait(() => f.requests.length === 1);
    const upstreamSocket = f.requests[0].req.socket;
    const bytes = Buffer.concat([content, done]);
    f.requests[0].res.end(bytes);
    await client.response;
    await f.wait(() => Buffer.concat(client.received).equals(bytes));
    await f.wait(() => observationEvents(f).some(event => event.event === "upstream_close"));
    assert.equal(observationEvents(f).find(event => event.event === "transparent_complete").response_complete, true);
    assert.equal(upstreamSocket.destroyed, false, "响应已结束但 keep-alive 连接仍属于连接池");

    await f.proxy.close();
    assert.equal(upstreamSocket.destroyed, false, "proxy 关闭不能改为销毁共享上游连接");
    const files = ["provider-stream.jsonl", "provider-stream-requests/request-1.bin",
      "provider-stream-requests/request-1.received.bin", "provider-stream-requests/request-1.delivered.bin"];
    const sealed = files.map(file => fs.readFileSync(path.join(f.dir, file)));
    const socketClosed = once(upstreamSocket, "close");
    upstreamSocket.end();
    await socketClosed;

    assert.deepEqual(files.map(file => fs.readFileSync(path.join(f.dir, file))), sealed,
      "晚到连接事件不能给已关闭的代理或旧 request 追加证据");
    assert.equal(f.requests.length, 1, "关闭不得触发重试或额外上游请求");
  });
}

function assertBudget(value, maximum, admitted, rejected) {
  assert.equal(value.max_upstream_requests, maximum);
  assert.equal(value.upstream_requests_admitted, admitted);
  assert.equal(value.budget_requests_rejected, rejected);
}

test("cap在创建上游HTTP请求前同步准入，并发及耗尽重试不得越界", async t => {
  const f = await setup(t, { mode: "observe", maxUpstreamRequests: 2 });
  const raw = Buffer.from('{ "model":"literal", "stream":true, "same":"bytes" }\n');
  const clients = Array.from({ length: 5 }, () => f.send(raw));
  const responses = await Promise.all(clients.map(client => client.response));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 200, 429, 429, 429]);
  assert.equal(f.requests.length, 2);
  assertBudget(f.proxy.ready, 2, 0, 0);
  assertBudget(await f.control("/state"), 2, 2, 3);
  const bytes = Buffer.concat([content, done]);
  for (const request of f.requests) { assert.deepEqual(request.body, raw); request.res.end(bytes); }
  for (const [index, response] of responses.entries()) {
    if (response.statusCode === 200) await f.wait(() => Buffer.concat(clients[index].received).equals(bytes));
  }
  const retry = f.send(raw);
  assert.equal((await retry.response).statusCode, 429);
  await f.wait(() => Buffer.concat(retry.received).length > 0);
  const snapshot = await f.control("/snapshot");
  assertBudget(snapshot, 2, 2, 4);
  assert.equal(f.requests.length, 2, "相同输入重试也不退款或额外转发");
  const denied = snapshot.requests.filter(request => !request.upstream_admitted);
  assert.equal(denied.length, 4);
  for (const request of denied) {
    assert.equal(request.reason, "upstream_request_budget_exhausted");
    assert.equal(request.cause, "upstream_request_budget_exhausted");
    assert.equal(request.forwarded, false);
    assert.equal(request.local_response_status, 429);
    assert.equal(request.response_status, undefined);
    assert.ok(request.ended_at);
    assert.deepEqual(fs.readFileSync(path.join(f.dir, "provider-stream-requests", request.request_id + ".bin")), raw);
    assert.equal(fs.existsSync(path.join(f.dir, "provider-stream-requests", request.request_id + ".received.bin")), false);
  }
  const events = observationEvents(f);
  assert.equal(events.filter(event => event.event === "upstream_request_admitted").length, 2);
  assert.equal(events.filter(event => event.event === "request_budget_rejected").length, 4);
  assertBudget(events.at(-1), 2, 2, 4);
});

test("GET models消耗同一额度，控制读与非法目标不消耗", async t => {
  const f = await setup(t, { mode: "observe", maxUpstreamRequests: 1 });
  for (const route of ["/state", "/snapshot", "/registry"]) assert.equal((await f.control(route)).status, 200);
  for (const requestPath of ["http://127.0.0.1:1/v1/models", "//127.0.0.1:1/v1/models", "/other"]) {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(f.proxy.ready.endpoint, { method: "GET", path: requestPath }, res => {
        res.resume(); res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject); req.end();
    });
    assert.equal(status, 502);
  }
  const client = f.send("", {}, "/models", "GET");
  await client.response;
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].req.method, "GET");
  f.requests[0].res.end('{"data":["literal"]}');
  await f.wait(() => Buffer.concat(client.received).toString() === '{"data":["literal"]}');
  assert.equal((await f.send().response).statusCode, 429);
  for (const route of ["/state", "/snapshot", "/registry"]) assert.equal((await f.control(route)).status, 200);
  assertBudget(await f.control("/state"), 1, 1, 1);
  assert.equal(f.requests.length, 1);
  const snapshot = await f.control("/snapshot");
  assert.equal(snapshot.requests.slice(0, 3).every(request => request.upstream_admitted === false && request.forwarded === false), true);
});

for (const cause of ["upstream_aborted", "downstream_disconnect"]) {
  test(cause + " 已准入额度不退，随后重试在本地拒绝", async t => {
    const f = await setup(t, { mode: "observe", maxUpstreamRequests: 1 });
    const client = f.send();
    await client.response;
    f.requests[0].res.write(content);
    await f.wait(() => Buffer.concat(client.received).equals(content));
    if (cause === "upstream_aborted") f.requests[0].res.destroy();
    else client.req.destroy();
    await f.wait(() => observationEvents(f).some(event => event.event === "request_closed"));
    assert.equal((await f.send().response).statusCode, 429);
    assertBudget(await f.control("/state"), 1, 1, 1);
    assert.equal(f.requests.length, 1);
    assert.equal((await f.control("/snapshot")).requests[0].cause, cause);
  });
}

test("上游真实429原字节透传，与本地额度429事实分离", async t => {
  const f = await setup(t, { mode: "observe", maxUpstreamRequests: 1, responseStatus: 429,
    responseHeaders: { "content-encoding": "gzip", "x-fixture-origin": "upstream" } });
  const first = f.send();
  const response = await first.response;
  const raw = Buffer.from([31, 139, 8, 0, 255, 0, 128]);
  f.requests[0].res.end(raw);
  await f.wait(() => Buffer.concat(first.received).equals(raw));
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["content-encoding"], "gzip");
  assert.equal(response.headers["x-fixture-origin"], "upstream");
  const retry = f.send();
  const denied = await retry.response;
  assert.equal(denied.statusCode, 429);
  assert.equal(denied.headers["x-fixture-origin"], undefined);
  await f.wait(() => Buffer.concat(retry.received).length > 0);
  assert.deepEqual(JSON.parse(Buffer.concat(retry.received)), {
    error: "upstream_request_budget_exhausted", upstream_admitted: false, forwarded: false,
  });
  const snapshot = await f.control("/snapshot");
  assertBudget(snapshot, 1, 1, 1);
  assert.equal(snapshot.requests[0].response_status, 429);
  assert.equal(snapshot.requests[0].local_response_status, undefined);
  assert.equal(snapshot.requests[0].upstream_admitted, true);
  assert.equal(snapshot.requests[0].forwarded, true);
  assert.equal(snapshot.requests[0].delivered_sha256, digest(raw));
  assert.equal(snapshot.requests[1].response_status, undefined);
  assert.equal(snapshot.requests[1].local_response_status, 429);
  assert.equal(f.requests.length, 1);
});

test("两臂proxy独立持有额度，禁止共享或重置另臂计数", async t => {
  const arms = await Promise.all([setup(t, { mode: "observe", maxUpstreamRequests: 1 }),
    setup(t, { mode: "observe", maxUpstreamRequests: 1 })]);
  for (const f of arms) {
    const client = f.send();
    assert.equal((await client.response).statusCode, 200);
    f.requests[0].res.end(content);
    await f.wait(() => Buffer.concat(client.received).equals(content));
    assert.equal((await f.send().response).statusCode, 429);
    assertBudget(await f.control("/state"), 1, 1, 1);
    assert.equal(f.requests.length, 1);
  }
});

test("capped gate拒绝额外请求但保留已准入暂停流及原取消链", async t => {
  const f = await setup(t, { maxUpstreamRequests: 1 });
  await f.control("/window", {});
  const client = f.send();
  await f.wait(() => f.requests.length === 1);
  await arm(f);
  f.requests[0].res.write(content);
  await client.response;
  await f.wait(() => f.proxy.state().gate.paused_at);
  assert.equal((await f.send().response).statusCode, 429);
  assert.equal(f.proxy.state().gate.cause, null);
  assert.equal(f.proxy.state().active_requests.length, 1);
  client.req.destroy();
  await f.wait(() => f.proxy.state().gate.upstream_closed);
  assert.equal((await f.control("/disarm", {})).status, 200);
  assertBudget(await f.control("/state"), 1, 1, 1);
  assert.equal(f.requests.length, 1);
});

for (const mode of ["gate", "observe"]) {
  test(mode + " 省略cap保持既有无上限透传合同并显式报告null", async t => {
    const f = await setup(t, { mode });
    const raw = Buffer.concat([content, done]);
    for (let index = 0; index < 3; index++) {
      const client = f.send();
      assert.equal((await client.response).statusCode, 200);
      f.requests[index].res.end(raw);
      await f.wait(() => Buffer.concat(client.received).equals(raw));
    }
    assertBudget(f.proxy.ready, null, 0, 0);
    assertBudget(await f.control("/state"), null, 3, 0);
    assert.equal(f.requests.length, 3);
  });
}

test("API仅接受正安全整数cap，验证在创建文件及监听前完成", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-invalid-cap-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const value of [null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", true]) {
    await assert.rejects(async () => {
      const proxy = await createProviderStreamProxy({
        upstreamEndpoint: "http://127.0.0.1:1/v1", artifactDir: dir, maxUpstreamRequests: value,
      });
      await proxy.close();
    }, /invalid_max_upstream_requests/u);
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

function startCli(t, upstreamEndpoint, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-cli-cap-"));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./native_provider_stream_proxy.mjs", import.meta.url)),
    upstreamEndpoint, dir, ...args], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", bytes => { stderr += bytes; });
  const closed = once(child, "close");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await closed;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, child, closed, stderr: () => stderr };
}

test("CLI显式cap实际限制HTTP，ready和state与参数一致", async t => {
  const f = await setup(t, { mode: "observe" });
  const cli = startCli(t, f.upstreamEndpoint, ["observe", "--max-upstream-requests", "1"]);
  const readyPath = path.join(cli.dir, "provider-stream-ready.json");
  await f.wait(() => fs.existsSync(readyPath) || cli.child.exitCode !== null);
  assert.equal(fs.existsSync(readyPath), true, cli.stderr());
  const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
  assertBudget(ready, 1, 0, 0);
  const first = fetch(ready.endpoint + "/models");
  await f.wait(() => f.requests.length === 1);
  f.requests[0].res.end("literal models");
  assert.equal(await (await first).text(), "literal models");
  const second = await fetch(ready.endpoint + "/chat/completions", { method: "POST", body: "{}" });
  assert.equal(second.status, 429);
  await second.text();
  assertBudget(await (await fetch(ready.control_endpoint + "/state")).json(), 1, 1, 1);
  assert.equal(f.requests.length, 1);
});

test("CLI拒绝缺值、非规范数字、拼错及多余参数，不能忽略参数假装有限额", async t => {
  const invalid = ["0", "-1", "1.5", "1e3", "", "Infinity", "9007199254740992"]
    .map(value => ["observe", "--max-upstream-requests", value]);
  invalid.push(["observe", "--max-upstream-requests"],
    ["observe", "--max-upstream-request", "1"], ["observe", "--max-upstream-requests", "1", "extra"]);
  for (const args of invalid) {
    const cli = startCli(t, "http://127.0.0.1:1/v1", args);
    const readyPath = path.join(cli.dir, "provider-stream-ready.json");
    for (let index = 0; index < 200 && cli.child.exitCode === null && !fs.existsSync(readyPath); index++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.notEqual(cli.child.exitCode, null, "非法参数应在监听前退出：" + JSON.stringify(args));
    assert.notEqual(cli.child.exitCode, 0);
    await cli.closed;
    assert.match(cli.stderr(), /invalid_max_upstream_requests|usage:/u);
    assert.equal(fs.existsSync(readyPath), false);
  }
});
