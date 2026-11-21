// SU04/B85 release owner 预检的外部进程反例；不启动 app，不占端口，不发信号。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const source=fs.readFileSync(new URL("./release_app_lifecycle_check.sh",import.meta.url),"utf8");
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"release-owner-test-"));
 try{
  fs.mkdirSync(path.join(root,"scripts"));fs.writeFileSync(path.join(root,"scripts/release_app_lifecycle_check.sh"),source);
  const app=path.join(root,"fixture.app");
  fs.mkdirSync(path.join(app,"Contents/MacOS"),{recursive:true});
  fs.mkdirSync(path.join(app,"Contents/Resources"),{recursive:true});
  fs.writeFileSync(path.join(app,"Contents/MacOS/app"),"#!/bin/sh\nexit 93\n",{mode:0o755});
  fs.writeFileSync(path.join(app,"Contents/Resources/sidecar.tar.gz"),"not executed");
  const bin=path.join(root,"bin");fs.mkdirSync(bin);
  // Only an external observation fixture: never spawn a substitute production app.
  fs.writeFileSync(path.join(bin,"lsof"),"#!/bin/sh\nprintf 999999\n",{mode:0o755});
  const run=(scenario,extra={})=>spawnSync("bash",[path.join(root,"scripts/release_app_lifecycle_check.sh"),scenario],
   {env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,SU04_APP_PATH:app,...extra},encoding:"utf8"});
  fn({root,app,run});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test("unknown scenario exits before app/data/cleanup creation",()=>fixture(({root,run})=>{
 const result=run("not-a-scenario");assert.equal(result.status,64);
 assert.equal(fs.existsSync(path.join(root,"artifacts")),false);
}));
test("external occupied listener blocks before launch; evidence HOME survives cleanup",()=>fixture(({root,run})=>{
 const result=run("b85-context-window");assert.equal(result.status,1);
 const parent=path.join(root,"artifacts/slice-verify/su04-release-app");
 const dir=path.join(parent,fs.readdirSync(parent)[0]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,"failure.json"))).reason,"port_already_in_use_before_start");
 assert.ok(fs.statSync(path.join(dir,"home")).isDirectory());
 assert.equal(fs.existsSync(path.join(dir,"generation-1")),false);
 assert.equal(fs.existsSync(path.join(dir,"summary.json")),false);
}));
test("missing bundle is failure, not success via cleanup",()=>fixture(({root,run})=>{
 const result=run("cold-start",{SU04_APP_PATH:path.join(root,"missing.app")});assert.equal(result.status,1);
 const parent=path.join(root,"artifacts/slice-verify/su04-release-app"),dir=path.join(parent,fs.readdirSync(parent)[0]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,"failure.json"))).reason,"missing_release_bundle");
 assert.equal(fs.existsSync(path.join(dir,"summary.json")),false);
}));
test("port flag cannot pretend a different port is product release port",()=>fixture(({root,run})=>{
 const result=run("cold-start",{SU04_SIDECAR_PORT:"7777"});assert.equal(result.status,1);
 const parent=path.join(root,"artifacts/slice-verify/su04-release-app"),dir=path.join(parent,fs.readdirSync(parent)[0]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,"failure.json"))).reason,"release_port_must_match_product_4658");
}));
test("actual owner phase producer feeds current driver contract without UI",async()=>{
 const {validatePhaseInput,assertPhaseEvidence}=await import("./native_b85_context_window_drive.mjs");
 const build=(phase,window,current,saved,source)=> {
  const r=spawnSync("bash",[fileURLToPath(new URL("./release_app_lifecycle_check.sh",import.meta.url)),
   "--phase-input",phase,"contract-case","splash",window,current,saved,source,"/tmp/isolated/preferences.json","Splash Local 模型"],{encoding:"utf8"});
  assert.equal(r.status,0,r.stderr);const input=JSON.parse(r.stdout);validatePhaseInput(input,phase);return input;
 };
 const invalid=build("invalid","0","32000","null","conservative_default");
 assert.equal(invalid.window,"0");
 assert.equal(invalid.provider_label,"Splash Local 模型");
 assert.throws(()=>validatePhaseInput({...invalid,provider_label:undefined},"invalid"));
 const baseline=build("snapshot","","32000","null","conservative_default");
 const observed={runtime:{state:"observed",configuration_sha256:"a".repeat(64),context_window:{effective_tokens:32000,default_tokens:32000,source:"conservative_default"}},
   preferences:{state:"observed",saved:null,sha256:"b".repeat(64),unrelated_sha256:"c".repeat(64)},text:"当前生效：32,000 tokens 来源：保守默认 已保存覆盖：未设置"};
 // 独立固定作者可见预期，不从 options 反推 oracle。
 assertPhaseEvidence(baseline,observed,observed);
 assert.throws(()=>assertPhaseEvidence({...baseline,expected_source:"runtime_override"},observed,observed));
 const unknown=build("runtime-unavailable","64000","null","null","null");
 assert.equal(unknown.expected_current,null);assert.equal(unknown.expected_source,null);assert.equal(unknown.expected_saved,null);
 const failure=build("save-failure","64000","32000","unknown","conservative_default");
 assert.equal(failure.expected_saved,"unknown");
});
test("unregistered spawned child/occupier is unresolved cleanup, never false empty success",()=>fixture(({root})=>{
 const cleanup=source.slice(source.indexOf("cleanup() {"),source.indexOf("\nfail()"));
 const json=source.slice(source.indexOf("json_event() {"),source.indexOf("\nobserve()"));
 const dir=path.join(root,"unresolved");fs.mkdirSync(dir);
 const r=spawnSync("bash",["-c",[
  "set -euo pipefail",
  "CLEANED=0; APP_PID=999998; OWN=''; OCCUPIER_PID=999997; OCCUPIER_OWN=''",
  "DIR="+JSON.stringify(dir),json,cleanup,"cleanup"
 ].join("\n")],{env:process.env,encoding:"utf8"});
 assert.equal(r.status,1,r.stderr);
 assert.ok(fs.existsSync(path.join(dir,"cleanup.json")),r.stderr);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,"cleanup.json"))).status,"fail");
 assert.match(JSON.parse(fs.readFileSync(path.join(dir,"unresolved-spawn.json"))).reason,/no_signal_sent/);
 assert.match(JSON.parse(fs.readFileSync(path.join(dir,"unresolved-occupier.json"))).reason,/no_signal_sent/);
 assert.ok(fs.statSync(dir).isDirectory());
}));

test("actual phase dispatcher invokes driver separately and preserves spaced provider label",()=>fixture(({root})=>{
 const phaseFn=source.slice(source.indexOf("phase() {"),source.indexOf("\nexit_app()"));
 const dir=path.join(root,"generation-1");fs.mkdirSync(dir);
 const probe=path.join(root,"dispatch-probe.mjs");
 fs.writeFileSync(probe,'import fs from "node:fs";const [dir,phase]=process.argv.slice(2);fs.writeFileSync(dir+"/dispatch.json",JSON.stringify({phase,input:JSON.parse(fs.readFileSync(dir+"/b85-phase-input.json"))}));');
 const vars={ROOT:root,GEN_DIR:dir,UI:probe,PROVIDER:"splash",PROVIDER_LABEL:"Splash Local 模型",PREFS:path.join(root,"home/preferences.json")};
 const r=spawnSync("bash",["-c",["set -euo pipefail",...Object.entries(vars).map(([k,v])=>k+"="+JSON.stringify(v)),
  "refresh(){ :; }","fail(){ exit 99; }",phaseFn,'phase snapshot dispatch "" 32000 null conservative_default'].join("\n")],
  {env:process.env,encoding:"utf8"});
 assert.equal(r.status,0,r.stderr);
 const received=JSON.parse(fs.readFileSync(path.join(dir,"dispatch.json")));
 assert.equal(received.phase,"snapshot");
 assert.equal(received.input.provider_label,"Splash Local 模型");
 assert.equal(received.input.expected_source,"conservative_default");
 assert.ok(fs.existsSync(path.join(dir,"b85-input-dispatch.json")));
}));
