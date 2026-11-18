// Design: docs/design/acceptance/model-interaction-coverage.md §5.2
// Execute the actual runner functions with disposable local child processes.
// No model, backend, native app, or user configuration is started or modified.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openTestRunScope } from "./lib/test_env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = fs.readFileSync(path.join(root, "scripts/tauri_slice_verify.sh"), "utf8");
function section(start, end) {
  const from = runner.indexOf(start);
  const to = runner.indexOf(end, from + start.length);
  assert(from >= 0 && to > from);
  return runner.slice(from, to);
}
const startProxy = section("start_owned_provider_stream_proxy() {", "\nstart_owned_backend() {");
const startBackend = section("start_owned_backend() {", "\nrestart_owned_backend() {");
const cleanup = section("cleanup() {", "\ntrap cleanup EXIT");
let scope;
test.before(() => { scope = openTestRunScope(); });
test.after(() => { scope?.close(); });

const fakeProxy = `
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
const [upstream, dir] = process.argv.slice(2);
fs.writeFileSync(path.join(dir,"fixture-owner.json"),JSON.stringify({pid:process.pid}));
if (process.env.CASE === "exit") process.exit(23);
const servers = [http.createServer((q, r) => r.end("local fixture")), http.createServer((q, r) => r.end("control fixture"))];
for (const server of servers) await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const ports = servers.map(server => server.address().port);
const ready = {pid:process.pid, endpoint:"http://127.0.0.1:"+ports[0]+new URL(upstream).pathname,
  control_endpoint:"http://127.0.0.1:"+ports[1], upstream_endpoint:upstream};
if (process.env.CASE === "pid") ready.pid++;
if (process.env.CASE === "upstream") ready.upstream_endpoint = "http://unrelated.invalid/v1";
if (process.env.CASE === "external") ready.endpoint = "http://unrelated.invalid:1234/v1";
if (process.env.CASE === "path") ready.endpoint += "/wrong";
if (process.env.CASE === "ports") ready.control_endpoint = "http://127.0.0.1:"+ports[0];
if (process.env.CASE !== "timeout") fs.writeFileSync(path.join(dir,"provider-stream-ready.json"),JSON.stringify(ready));
process.on("SIGTERM", () => { for (const server of servers) server.close(); });
`;

function run(t, mode = "", overrides = {}, extra = "") {
  const dir = fs.mkdtempSync(path.join(scope.workDir, "provider-runner-"));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,"scripts/lib"),{recursive:true});
  fs.mkdirSync(path.join(dir,"bin"));
  fs.mkdirSync(path.join(dir,"artifacts"));
  fs.writeFileSync(path.join(dir,"scripts/native_provider_stream_proxy.mjs"),fakeProxy);
  fs.writeFileSync(path.join(dir,"scripts/lib/native_app_ownership.mjs"),"// no native app in this fixture\n");
  fs.writeFileSync(path.join(dir,"bin/mix"),'#!/bin/bash\nprintf "%s\\n" "$NOVEL_SPLASH_ENDPOINT" >> "$ARTIFACT_DIR/backend-endpoints"\n');
  fs.chmodSync(path.join(dir,"bin/mix"),0o755);
  if(mode === "stale") fs.writeFileSync(path.join(dir,"artifacts/provider-stream-ready.json"),"{}");
  const script = `set -euo pipefail
set -m
source "${root}/scripts/lib/process_tree.sh"
PHX_PID=""; TAURI_PID=""; UI_DRIVER_PID=""; NATIVE_PROXY_PID=""; TAURI_CONFIG_OVERRIDE=""
PROVIDER_STREAM_PID=""; PROVIDER_STREAM_ENDPOINT=""; PROVIDER_STREAM_PORT=""; PROVIDER_STREAM_CONTROL_PORT=""
reset_test_db() { :; }
${cleanup}
trap cleanup EXIT
${startProxy}
${startBackend}
start_owned_provider_stream_proxy
echo "parent=$NOVEL_SPLASH_ENDPOINT"
echo "route=$PROVIDER_STREAM_ENDPOINT"
echo "owner=$PROVIDER_STREAM_PID"
${extra}
`;
  const result = spawnSync("/bin/bash",["-c",script],{
    encoding:"utf8",timeout:20000,
    env:{...process.env, PATH:path.join(dir,"bin")+":"+process.env.PATH,
      PROJECT_ROOT:dir,ARTIFACT_DIR:path.join(dir,"artifacts"),CASE:mode,
      NATIVE_SYSTEM_DRIVER:"1",B71_AUTO_MAINTENANCE:"1",SLICE_VERIFY_PROVIDER:"splash",
      SLICE_ID:"b71-first-consumer",NOVEL_SPLASH_ENDPOINT:"http://127.0.0.1:8000/v1",
      ...overrides},
  });
  assert.equal(result.error,undefined);
  const readyFile=path.join(dir,"artifacts/provider-stream-ready.json");
  const ready=fs.existsSync(readyFile)?JSON.parse(fs.readFileSync(readyFile,"utf8")):null;
  // PID comes from our own fixture, not an arbitrary process selected by port.
  const ownerFile=path.join(dir,"artifacts/fixture-owner.json");
  if(fs.existsSync(ownerFile)) {
    const owner=JSON.parse(fs.readFileSync(ownerFile,"utf8"));
    assert.throws(()=>process.kill(owner.pid,0),{code:"ESRCH"});
  }
  return {result,dir,ready};
}

test("C8 owns two ephemeral ports and only backend children receive temporary endpoint across restart",t=>{
  const {result,dir,ready}=run(t,"",{},`
PHOENIX_PORT=4657; LLM_LOG_DIR="$ARTIFACT_DIR"; APP_LOG_DIR="$ARTIFACT_DIR"
B71_QUALITY_REVISION_RETRY=0; LMSTUDIO_TIMEOUT_MS=300000; API_URL=http://127.0.0.1:4657
wait_for_url() { wait "$PHX_PID"; }
start_owned_backend "$ARTIFACT_DIR/backend.log" ""
start_owned_backend "$ARTIFACT_DIR/backend-restart.log" ""
echo "parent-after=$NOVEL_SPLASH_ENDPOINT"
`);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/parent-after=http:\/\/127\.0\.0\.1:8000\/v1/);
  assert.deepEqual(fs.readFileSync(path.join(dir,"artifacts/backend-endpoints"),"utf8").trim().split("\n"),[ready.endpoint,ready.endpoint]);
  assert.notEqual(new URL(ready.endpoint).port,new URL(ready.control_endpoint).port);
});
for(const [name,vars] of [["non-native",{NATIVE_SYSTEM_DRIVER:"0"}],["not C8",{B71_AUTO_MAINTENANCE:"0"}]]) {
  test(name+" does not launch proxy or alter endpoint",t=>{
    const {result,ready}=run(t,"",vars);
    assert.equal(result.status,0,result.stderr);
    assert.equal(ready,null);
    assert.match(result.stdout,/route=\nowner=\n/);
  });
}
for(const mode of ["pid","upstream","external","path","ports","stale","exit","timeout"]) {
  test("fail closed and clean owned child: "+mode,t=>{
    const {result}=run(t,mode);
    assert.notEqual(result.status,0);
    assert.doesNotMatch(result.stdout,/route=http/);
  });
}
test("invalid C8 provider fails before launch",t=>{
  const {result,ready}=run(t,"",{SLICE_VERIFY_PROVIDER:"strata"});
  assert.notEqual(result.status,0);
  assert.equal(ready,null);
});
test("actual runner connects supervision, both owned ports and preflight before temporary routing",()=>{
  assert.match(runner,/native_watch_pids\+=\("\$PROVIDER_STREAM_PID"\)/);
  assert.match(runner,/provider_stream: providerStreamPort/);
  assert.match(runner,/provider_stream_control: providerStreamControlPort/);
  assert(runner.indexOf('"${SPLASH_ENDPOINT%/}/models"')<runner.indexOf("\nstart_owned_provider_stream_proxy\n"));
  const restart=section("restart_owned_backend() {",'\nRUNTIME_FACTS_PATH=""');
  assert.match(restart,/start_owned_backend/);
  assert.doesNotMatch(restart,/start_owned_provider_stream_proxy/);
});
