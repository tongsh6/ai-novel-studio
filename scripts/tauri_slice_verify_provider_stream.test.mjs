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
const cleanupTraps = section("trap cleanup EXIT", "\nwait_for_url() {");
const verifyNative = section("verify_native_slice() {", "\nprint_native_slice_diagnostics() {");
let scope;
test.before(() => { scope = openTestRunScope(); });
test.after(() => { scope?.close(); });

const fakeProxy = `
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
const [upstream, dir, mode = "gate"] = process.argv.slice(2);
fs.writeFileSync(path.join(dir,"fixture-owner.json"),JSON.stringify({pid:process.pid}));
if (process.env.CASE === "exit") process.exit(23);
const servers = [http.createServer((q, r) => r.end("local fixture")), http.createServer((q, r) => r.end("control fixture"))];
for (const server of servers) await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const ports = servers.map(server => server.address().port);
const ready = {mode, pid:process.pid, endpoint:"http://127.0.0.1:"+ports[0]+new URL(upstream).pathname,
  control_endpoint:"http://127.0.0.1:"+ports[1], upstream_endpoint:upstream};
if (process.env.CASE === "pid") ready.pid++;
if (process.env.CASE === "mode") ready.mode = "unrelated";
if (process.env.CASE === "upstream") ready.upstream_endpoint = "http://unrelated.invalid/v1";
if (process.env.CASE === "external") ready.endpoint = "http://unrelated.invalid:1234/v1";
if (process.env.CASE === "path") ready.endpoint += "/wrong";
if (process.env.CASE === "ports") ready.control_endpoint = "http://127.0.0.1:"+ports[0];
if (process.env.CASE !== "timeout") fs.writeFileSync(path.join(dir,"provider-stream-ready.json"),JSON.stringify(ready));
process.on("SIGTERM", () => { for (const server of servers) server.close(); });
`;

function run(t, mode = "", overrides = {}, extra = "", setup = () => {}) {
  const dir = fs.mkdtempSync(path.join(scope.workDir, "provider-runner-"));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,"scripts/lib"),{recursive:true});
  fs.mkdirSync(path.join(dir,"bin"));
  fs.mkdirSync(path.join(dir,"artifacts"));
  fs.writeFileSync(path.join(dir,"scripts/native_provider_stream_proxy.mjs"),fakeProxy);
  fs.writeFileSync(path.join(dir,"scripts/lib/native_app_ownership.mjs"),"// no native app in this fixture\n");
  fs.writeFileSync(path.join(dir,"scripts/native_request_cost_drive.mjs"),`import fs from "node:fs";const dir=process.argv[2];const pid=JSON.parse(fs.readFileSync(dir+"/fixture-owner.json")).pid;process.kill(pid,0);fs.writeFileSync(dir+"/captured-before-cleanup","owned proxy still alive");`);
  fs.writeFileSync(path.join(dir,"bin/mix"),'#!/bin/bash\nprintf "%s\\n" "$NOVEL_SPLASH_ENDPOINT" >> "$ARTIFACT_DIR/backend-endpoints"\n');
  fs.chmodSync(path.join(dir,"bin/mix"),0o755);
  setup(dir);
  if(mode === "stale") fs.writeFileSync(path.join(dir,"artifacts/provider-stream-ready.json"),"{}");
  const script = `set -euo pipefail
set -m
source "${root}/scripts/lib/process_tree.sh"
PHX_PID=""; TAURI_PID=""; UI_DRIVER_PID=""; NATIVE_PROXY_PID=""; TAURI_CONFIG_OVERRIDE=""
PROVIDER_STREAM_PID=""; PROVIDER_STREAM_ENDPOINT=""; PROVIDER_STREAM_PORT=""; PROVIDER_STREAM_CONTROL_PORT=""
reset_test_db() { :; }
${cleanup}
${cleanupTraps}
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
for(const mode of ["pid","mode","upstream","external","path","ports","stale","exit","timeout"]) {
  test("fail closed and clean owned child: "+mode,t=>{
    const {result}=run(t,mode);
    assert.notEqual(result.status,0);
    assert.doesNotMatch(result.stdout,/route=http/);
  });
}
for (const length of ["10", "20"]) {
  test("ordinary "+length+" explicitly observes without C8 flag", t=>{
    const {result,ready}=run(t,"",{B71_AUTO_MAINTENANCE:"0",SLICE_ID:"b87-r01-request-cost",REQUEST_COST_LENGTH:length});
    assert.equal(result.status,0,result.stderr);
    assert.equal(ready?.mode,"observe");
  });
}
test("ordinary runner failure captures before destroying owned proxy",t=>{
  const {result,dir}=run(t,"",{B71_AUTO_MAINTENANCE:"0",SLICE_ID:"b87-r01-request-cost",REQUEST_COST_LENGTH:"10"},"exit 9");
  assert.equal(result.status,9);
  assert.equal(fs.readFileSync(path.join(dir,"artifacts/captured-before-cleanup"),"utf8"),"owned proxy still alive");
});
test("ordinary low pressure3 does not launch provider observation",t=>{
  const {ready}=run(t,"",{B71_AUTO_MAINTENANCE:"0",SLICE_ID:"b87-r01-request-cost",REQUEST_COST_LENGTH:"3"});
  assert.equal(ready,null);
});
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

// R07: execute the real verifier function in its conditional-call context. The
// disposable proxy is the only live child; native cleanup and verifier are files
// in this test run's owned directory, never the user's app or a model service.
function writeLifecycleFixture(dir, journey) {
  const artifactDir = path.join(dir, "artifacts");
  fs.writeFileSync(path.join(artifactDir, "native-b71-config.json"), JSON.stringify({ journey }));
  fs.writeFileSync(path.join(dir, "scripts/lib/native_app_ownership.mjs"), [
    'import fs from "node:fs";',
    'import path from "node:path";',
    'const dir = process.argv[2];',
    'const countFile = path.join(dir, "cleanup-count");',
    'const count = Number(fs.existsSync(countFile) ? fs.readFileSync(countFile, "utf8") : 0) + 1;',
    'fs.writeFileSync(countFile, String(count));',
    'fs.writeFileSync(path.join(dir, "native-app-cleanup.json"), JSON.stringify({actions:[{event:"fixture_stop",ordinal:count}],remaining:[]}));',
    'if (process.env.CLEANUP_FAILURE === "always" || (process.env.CLEANUP_FAILURE === "once" && count === 1)) {',
    '  const failure = path.join(dir, "failure.json");',
    '  if (!fs.existsSync(failure)) fs.writeFileSync(failure, JSON.stringify({reason:"fixture_cleanup_failure"}));',
    '  process.exit(17);',
    '}',
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "scripts/native_b71_evidence.mjs"), [
    'import fs from "node:fs";',
    'import path from "node:path";',
    'const dir = process.argv[3];',
    'if (process.argv[2] !== "verify") throw new Error("expected the actual verify entry");',
    'const owner = JSON.parse(fs.readFileSync(path.join(dir, "fixture-owner.json"), "utf8"));',
    'let alive = true;',
    'try { process.kill(owner.pid, 0); } catch (error) { if (error.code !== "ESRCH") throw error; alive = false; }',
    'const countFile = path.join(dir, "cleanup-count");',
    'fs.writeFileSync(path.join(dir, "verifier-observation.json"), JSON.stringify({owned_proxy_alive:alive,cleanup_calls:Number(fs.existsSync(countFile) ? fs.readFileSync(countFile,"utf8") : 0)}));',
    'if (process.env.VERIFIER_SIGNAL) process.kill(process.ppid, process.env.VERIFIER_SIGNAL);',
    'process.exit(Number(process.env.VERIFIER_STATUS || "0"));',
  ].join("\n"));
}

function runNativeVerification(t, journey, overrides = {}) {
  return run(t, "", overrides, verifyNative + [
    "",
    "is_b71_family_slice() { return 0; }",
    "if verify_native_slice; then",
    '  echo "verifier function succeeded"',
    "else",
    "  status=$?",
    '  exit "$status"',
    "fi",
  ].join("\n"), (dir) => writeLifecycleFixture(dir, journey));
}

function readLifecycleResult(dir) {
  const artifactDir = path.join(dir, "artifacts");
  const observationFile = path.join(artifactDir, "verifier-observation.json");
  return {
    observation: fs.existsSync(observationFile) ? JSON.parse(fs.readFileSync(observationFile, "utf8")) : null,
    cleanupCalls: Number(fs.readFileSync(path.join(artifactDir, "cleanup-count"), "utf8")),
    cleanup: JSON.parse(fs.readFileSync(path.join(artifactDir, "native-app-cleanup.json"), "utf8")),
  };
}

for (const journey of ["confirmation", "memory-detail", "auto-maintenance", "answer-mode"]) {
  test(journey + " stops owned runtime, reaches verifier and preserves the first cleanup record", (t) => {
    const { result, dir } = runNativeVerification(t, journey);
    assert.equal(result.status, 0, result.stderr);
    const actual = readLifecycleResult(dir);
    assert.deepEqual(actual.observation, { owned_proxy_alive: false, cleanup_calls: 1 });
    assert.equal(actual.cleanupCalls, 1, "EXIT must not overwrite successful pre-verification cleanup");
    assert.deepEqual(actual.cleanup.actions, [{ event: "fixture_stop", ordinal: 1 }]);
  });
}

test("a journey without pre-stop verifies while its owned child is alive, then EXIT cleans it", (t) => {
  const { result, dir } = runNativeVerification(t, "pending");
  assert.equal(result.status, 0, result.stderr);
  const actual = readLifecycleResult(dir);
  assert.deepEqual(actual.observation, { owned_proxy_alive: true, cleanup_calls: 0 });
  assert.equal(actual.cleanupCalls, 1);
});

for (const failure of ["always", "once"]) {
  test("pre-stop failure stays nonzero and never invokes verifier: " + failure, (t) => {
    const { result, dir } = runNativeVerification(t, "confirmation", { CLEANUP_FAILURE: failure });
    assert.notEqual(result.status, 0);
    assert.equal(readLifecycleResult(dir).observation, null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "artifacts/failure.json"), "utf8")).reason, "fixture_cleanup_failure");
  });
}

test("verifier failure survives conditional invocation and EXIT keeps the first cleanup evidence", (t) => {
  const { result, dir } = runNativeVerification(t, "confirmation", { VERIFIER_STATUS: "7" });
  assert.equal(result.status, 7, result.stderr);
  const actual = readLifecycleResult(dir);
  assert.deepEqual(actual.observation, { owned_proxy_alive: false, cleanup_calls: 1 });
  assert.equal(actual.cleanupCalls, 1);
  assert.deepEqual(actual.cleanup.actions, [{ event: "fixture_stop", ordinal: 1 }]);
});

for (const [signal, status] of [["SIGTERM", 143], ["SIGINT", 130]]) {
  test(signal + " remains effective after successful pre-stop", (t) => {
    const { result, dir } = runNativeVerification(t, "confirmation", { VERIFIER_SIGNAL: signal });
    assert.equal(result.status, status, result.stderr);
    assert.equal(readLifecycleResult(dir).cleanupCalls, 1);
  });
}

for (const [original, expected] of [[0, 1], [9, 9]]) {
  test("EXIT cleanup failure preserves the original failure or fails an original success: " + original, (t) => {
    const { result } = run(t, "", { CLEANUP_FAILURE: "always" }, "exit " + original,
      (dir) => writeLifecycleFixture(dir, "confirmation"));
    assert.equal(result.status, expected, result.stderr);
  });
}

test("R01 captures failure before the first reap even when cleanup later fails", (t) => {
  const { result, dir } = run(t, "", {
    B71_AUTO_MAINTENANCE: "0", SLICE_ID: "b87-r01-request-cost", REQUEST_COST_LENGTH: "10", CLEANUP_FAILURE: "always",
  }, 'UI_DRIVER_PID="$PROVIDER_STREAM_PID"\nexit 9', (dir) => writeLifecycleFixture(dir, "confirmation"));
  assert.equal(result.status, 9, result.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "artifacts/captured-before-cleanup"), "utf8"), "owned proxy still alive");
});
