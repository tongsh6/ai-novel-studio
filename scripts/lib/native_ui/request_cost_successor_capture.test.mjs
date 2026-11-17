// Successor IO boundaries use only sealed copies and isolated synthetic SQLite.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openTestRunScope } from "../test_env.mjs";
import { captureSubjectWindow, readCostWindowFacts, readSuccessorAuthor } from "./request_cost_capture.mjs";
import { nativeManifest } from "./fixtures/request_cost_manifest_fixture.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const root = path.resolve(import.meta.dirname, "../../..");
const tables = ["agent_events","agent_runs","authoring_session_messages","provider_runs",
  "provider_outputs","provider_events","interactions","mutations"];
let scope;
test.before(() => { scope = openTestRunScope(); });
test.after(() => { scope?.close(); });
function leaf(t) {
  const dir = fs.mkdtempSync(path.join(scope.workDir,"successor-capture-"));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function database(dir) {
  fs.mkdirSync(path.join(dir,"database"));
  const file=path.join(dir,"database","ai_novel_studio_test.sqlite3"), db=new DatabaseSync(file);
  try { for(const table of tables) db.exec("CREATE TABLE "+table+" (id TEXT PRIMARY KEY)"); }
  finally { db.close(); }
  return file;
}
function registration(t) {
  const dir=leaf(t);
  const sourcePath="scripts/lib/native_ui/fixtures/r03-discussion-author-inputs.json";
  const nextPath="scripts/lib/native_ui/fixtures/r03-successor-author-input.json";
  const raw=fs.readFileSync(path.join(root,sourcePath)), nextRaw=fs.readFileSync(path.join(root,nextPath));
  const authors=JSON.parse(raw).turns, next=JSON.parse(nextRaw).turns[0];
  const manifest={...nativeManifest(),schema:"b87-r01-request-cost-manifest/v2",
    source:{kind:"preregistered_author_inputs",path:sourcePath,sha256:sha(raw),expected_turns:20},
    authors:authors.map((a,input_index)=>({id:a.id,sha256:a.sha256,input_index})),
    successor_observation:{source:{path:nextPath,sha256:sha(nextRaw),expected_turns:1},
      author:{id:next.id,sha256:next.sha256},lengths:[10,20],count:1}};
  const file=path.join(dir,"manifest.json"), encoded=JSON.stringify(manifest);
  fs.writeFileSync(file,encoded);
  fs.writeFileSync(path.join(dir,"request-cost-successor-input.json"),nextRaw);
  const config={length:10,work:{id:"work"},session_id:"session",model:manifest.model,
    seed:{source_content_sha256:manifest.snapshot.business_content_sha256},snapshot:{content_sha256:manifest.snapshot.content_sha256},
    manifest:{path:file,sha256:sha(encoded)},successor_observation:structuredClone(manifest.successor_observation),
    plan:authors.slice(0,10).map((a,i)=>({turn:i+1,author_id:a.id,author_sha256:a.sha256,target:a.target})),
    compaction_history_check:{required:true,require_outside_initial_page:false},
    preregistered_obligations:authors.slice(0,10).flatMap(a=>a.obligations.map(o=>({author_id:a.id,author_sha256:a.sha256,...o})))};
  return {dir,config,manifest,file,sourcePath,nextPath,sourceHash:sha(raw),nextHash:sha(nextRaw),next,authors};
}
test("封存输入核文件/作者/文本hash，读操作不改冻结原文", t => {
  const s=registration(t), file=path.join(s.dir,"request-cost-successor-input.json");
  assert.deepEqual(readSuccessorAuthor(s.dir,s.config),s.next);
  for(const mutate of [
    c=>c.successor_observation.source.sha256="0".repeat(64),
    c=>c.successor_observation.author.id="other",
    c=>c.successor_observation.author.sha256="0".repeat(64),
    c=>delete c.successor_observation,
  ]) {
    const config=structuredClone(s.config);mutate(config);
    assert.throws(()=>readSuccessorAuthor(s.dir,config));
  }
  const input=JSON.parse(fs.readFileSync(file));input.turns[0].text+="改";
  const changed=JSON.stringify(input);fs.writeFileSync(file,changed);
  assert.throws(()=>readSuccessorAuthor(s.dir,s.config),/file hash/);
  s.config.successor_observation.source.sha256=sha(changed);
  assert.throws(()=>readSuccessorAuthor(s.dir,s.config),/bytes mismatch/);
  assert.equal(sha(fs.readFileSync(path.join(root,s.nextPath))),s.nextHash);
});
test("同一只读事务取8表；无SQLite sidecar或原库改写且连接关闭", t => {
  const dir=leaf(t), file=database(dir), before=sha(fs.readFileSync(file));
  const files=fs.readdirSync(path.dirname(file));
  assert.deepEqual(readCostWindowFacts(dir),Object.fromEntries(tables.map(table=>[table,[]])));
  assert.equal(sha(fs.readFileSync(file)),before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)),files);
  const db=new DatabaseSync(file);
  try { db.exec("INSERT INTO agent_runs VALUES ('after-reader')"); } finally { db.close(); }
  assert.deepEqual(readCostWindowFacts(dir).agent_runs,[{id:"after-reader"}]);
});
test("未知主体仅落一次partial边界，原库与冻结输入保留", t => {
  const s=registration(t), file=database(s.dir), before=sha(fs.readFileSync(file));
  const result=captureSubjectWindow({batchDir:s.dir,config:s.config});
  assert.equal(result.audit.ok,null);
  assert.equal(result.audit.reason,"subject_author_boundary_mismatch");
  assert.equal(sha(fs.readFileSync(file)),before);
  assert.equal(sha(fs.readFileSync(path.join(root,s.sourcePath))),s.sourceHash);
  assert.equal(sha(fs.readFileSync(path.join(root,s.nextPath))),s.nextHash);
  assert.throws(()=>captureSubjectWindow({batchDir:s.dir,config:s.config}),/already captured/);
});
test("配置篡改和v1/3轮后继注入在读DB或发送前拒绝", t => {
  for(const mutate of [
    s=>s.config.successor_observation.count=2,
    s=>s.config.model={...s.config.model,model:"different"},
    s=>{s.manifest.schema="b87-r01-request-cost-manifest/v1";delete s.manifest.successor_observation;
      const raw=JSON.stringify(s.manifest);fs.writeFileSync(s.file,raw);s.config.manifest.sha256=sha(raw);},
    s=>{s.config.length=3;s.config.plan=s.config.plan.slice(0,3);
      s.config.compaction_history_check={required:false,require_outside_initial_page:false};
      s.config.preregistered_obligations=s.authors.slice(0,3).flatMap(a=>a.obligations.map(o=>({author_id:a.id,author_sha256:a.sha256,...o})));},
    s=>{const file=path.join(s.dir,"request-cost-successor-input.json"), input=JSON.parse(fs.readFileSync(file));
      input.turns[0].text+="改";input.turns[0].sha256=sha(input.turns[0].text);
      const raw=JSON.stringify(input);fs.writeFileSync(file,raw);
      s.config.successor_observation.source.sha256=sha(raw);s.config.successor_observation.author.sha256=input.turns[0].sha256;},
  ]) {
    const s=registration(t);mutate(s);
    assert.throws(()=>captureSubjectWindow({batchDir:s.dir,config:s.config}),/config|successor/i);
    assert.equal(fs.existsSync(path.join(s.dir,"request-cost-subject-window.json")),false);
    assert.equal(fs.existsSync(path.join(s.dir,"database")),false);
  }
});
