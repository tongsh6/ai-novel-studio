// B87 §19.28：B28 的独立验收边界；只导入有 CLI guard 的 evidence owner。
// driver 已有 CLI guard；这里只调用注入内存 harness 的纯入口，不连接模型或操作窗口。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as evidence from "../../native_b28_scope_evidence.mjs";
import { observeExternalModelService, runScopeScenario } from "../../native_b28_scope_drive.mjs";
import { toolResultContent } from "./fixtures/authoring_request_ir.mjs";
import { joinNativeCallEvidence } from "./authoring_call_evidence.mjs";
import { sseBase } from "./fixtures/authoring_call_fixture.mjs";
import { buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import { canonTables } from "./fixtures/native_b71_revision_facts.mjs";

const ORIGINAL_INPUTS = [
  ["P3", "把第03章里的「二十五岁」改成「三十岁」，其余逐字不变。"],
  ["N1", "不要整章重写，只改第03章第一段。"],
  ["N2", "通读全文后只修第03章第二段。"],
  ["N3", "整章检查一遍第03章，有问题告诉我，别改。"],
  ["N4", "如果第03章有明显问题就整章改一遍，没有问题就告诉我。"],
  ["P1", "把第03章整章重写一遍，情节不变。"],
  ["P2", "只调整第03章分段和排版，不要改字句。"],
];
const PROFILE = "b87-r01-controlled-splash-high";
const MODEL = "local/Q4-PLE4";
const ENDPOINT = "http://127.0.0.1:8000/v1";
const budget = (inputs = 7) => ({
  max_author_inputs: inputs, max_harness_retries: 0,
  turn_timeout_ms: 330000, ack_timeout_ms: 60000,
});
const runtimeFacts = () => ({
  schema: "b87-r01-runtime-facts/v1", mix_env: "test",
  provider: { selected: "splash", model: MODEL, endpoint: ENDPOINT },
  context_pressure: { provider: "splash", window: 262144, maintenance_ratio: 0.70 },
  auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false,
});
const sha = (value) => createHash("sha256").update(value).digest("hex");
const allPass = (checks) => assert(Object.keys(checks).length > 0 && Object.values(checks).every((v) => v === true),
  "未通过的证据项：" + JSON.stringify(Object.entries(checks).filter(([, value]) => value !== true)));
const rejectsProof = (reader, value) => {
  assert.equal(typeof reader, "function", "B28 evidence 必须导出由 verify 直接消费的纯检查入口");
  const checks = reader(value);
  assert(Object.values(checks).some((v) => v === false), "不完整或冲突证据不得获全绿");
};

function preparedFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b28-scope-prepare-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  fs.mkdirSync(path.join(dir, "database"));
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  db.exec("CREATE TABLE works (id TEXT, title TEXT); INSERT INTO works VALUES ('work-scope', '独立章范围作品')");
  db.close();
  fs.writeFileSync(path.join(dir, "seed.log"),
    "work_id=work-scope session_id=session-scope control_chapter_id=chapter-control target_chapter_id=chapter-target target_title=第03章");
  write("native-driver-ready.json", {
    slice_id: "b28-scope-authorization", driver: "external-system-ui", browser_driver_started: false,
    provider: "splash", run_ref: "native-scope-run", ready_at: "2026-11-23T01:00:00.000Z",
  });
  const runtime = runtimeFacts();
  write("runtime-facts.json", runtime);
  return { dir, runtime, write, config: () =>
    JSON.parse(fs.readFileSync(path.join(dir, "native-b28-scope-config.json"), "utf8")) };
}

test("B28 freezes the seven original inputs, observed Splash runtime and zero unregistered author sends", async (t) => {
  const f = preparedFixture(t);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("prepare must not operate an external model service"); });
  await evidence.prepare(f.dir, { env: {} });
  const config = f.config();
  assert.equal(config.provider, "splash");
  assert.equal(config.model, MODEL);
  assert.equal(config.endpoint, ENDPOINT);
  assert.equal(config.runtime.profile, PROFILE);
  assert.deepEqual(config.runtime.observed, f.runtime);
  assert.deepEqual(config.scenarios.map(({ id, input }) => [id, input]), ORIGINAL_INPUTS);
  assert.deepEqual(config.budget, budget());
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

for (const [name, mutate] of [
  ["missing runtime", (f) => fs.unlinkSync(path.join(f.dir, "runtime-facts.json"))],
  ["other selected provider", (f) => { f.runtime.provider.selected = "strata"; f.write("runtime-facts.json", f.runtime); }],
  ["other observed model", (f) => { f.runtime.provider.model = "unfrozen-model"; f.write("runtime-facts.json", f.runtime); }],
  ["changed maintenance window", (f) => { f.runtime.context_pressure.window = 4096; f.write("runtime-facts.json", f.runtime); }],
]) {
  test(`B28 prepare rejects ${name} before a usable configuration is written`, async (t) => {
    const f = preparedFixture(t);
    mutate(f);
    await assert.rejects(evidence.prepare(f.dir, { env: {} }));
    assert.equal(fs.existsSync(path.join(f.dir, "native-b28-scope-config.json")), false);
  });
}

test("B28 preserves the conditional N4 utterance without declaring its premise false", () => {
  const n4 = evidence.SCENARIOS.find(({ id }) => id === "N4");
  assert.equal(n4.input, "如果第03章有明显问题就整章改一遍，没有问题就告诉我。");
  assert.notEqual(n4.expect.zero_write, true,
    "原话没有证明前提为假；条件成立/不成立的事实须独立冻结，不能全当只读");
});

function providerProof() {
  const input = sseBase();
  input.transcript.messages[0].provenance = "author";
  input.sessionMessages = input.transcript.messages;
  input.providerRuns[0].provider_id = "splash";
  input.providerRuns[0].model = MODEL;
  input.providerRuns[0].purpose = "author_reasoning";
  const record = input.records[0];
  record.provider = "splash";
  record.request.url = `${ENDPOINT}/chat/completions`;
  Object.assign(record.request.body, { model: MODEL, reasoning_effort: "high", max_tokens: 32000 });
  record.request.body.messages[1].content = "核对全章";
  record.response.model = MODEL;
  const runtime = runtimeFacts();
  return {
    input,
    value: {
      config: { provider: "splash", model: MODEL, endpoint: ENDPOINT, budget: budget(1),
        scenarios: [{ id: "N3" }], runtime: { profile: PROFILE, observed: structuredClone(runtime) } },
      ready: { provider: "splash" },
      driverLog: { provider: "splash", model: MODEL, endpoint: ENDPOINT, budget: budget(1) },
      providerStarts: [{ provider: "splash" }], runtimeFacts: runtime,
    },
  };
}
function bindProviderProof(proof) {
  return {
    ...proof.value, llmRecords: proof.input.records,
    runs: [{
      history: { transcript: proof.input.transcript, sessionMessages: proof.input.sessionMessages,
        budget: { provider_calls: proof.input.consumedProviderCalls } },
      calls: joinNativeCallEvidence(proof.input), providerRuns: proof.input.providerRuns,
    }],
  };
}

test("B28 accepts the existing native-call owner's complete Splash request/canonical/SSE binding", () => {
  assert.equal(typeof evidence.providerEvidenceChecks, "function");
  allPass(evidence.providerEvidenceChecks(bindProviderProof(providerProof())));
});

for (const [name, mutate] of [
  ["wrong request URL", (p) => { p.input.records[0].request.url = "http://other/v1/chat/completions"; }],
  ["wrong request model", (p) => { p.input.records[0].request.body.model = "other-model"; }],
  ["wrong reasoning effort", (p) => { p.input.records[0].request.body.reasoning_effort = "low"; }],
  ["unowned compaction output limit", (p) => { p.input.records[0].request.body.max_tokens = 8192; }],
  ["missing provider call identity", (p) => { delete p.input.records[0].provider_call_ref; }],
  ["duplicate native call identity", (p) => { p.input.records.push(structuredClone(p.input.records[0])); }],
  ["cross-session provider row", (p) => { p.input.providerRuns[0].session_id = "other-session"; }],
  ["cross-run canonical history", (p) => { p.input.transcript.run.run_id = "other-run"; }],
  ["unclosed provider run", (p) => { p.input.providerRuns[0].status = "running"; }],
  ["missing canonical response", (p) => { p.input.transcript.messages.pop(); }],
  ["raw request differs from canonical author bytes", (p) => { p.input.records[0].request.body.messages[1].content = "作者未说的另一句话"; }],
  ["non-SSE response", (p) => { p.input.records[0].response.body.source = "fixture"; }],
  ["runtime changed after preparation", (p) => { p.value.runtimeFacts.auto_maintenance.enabled = false; }],
  ["driver silently adds a retry", (p) => { p.value.driverLog.budget.max_harness_retries = 1; }],
]) {
  test(`B28 rejects ${name} even when the driver says the batch completed`, () => {
    const proof = providerProof();
    mutate(proof);
    rejectsProof(evidence.providerEvidenceChecks, bindProviderProof(proof));
  });
}

const AT = "2026-11-23T01:00:00.000Z";
const TOPIC = "workspace:workspace-scope";
function scopeProof() {
  const text = "他二十五岁。\n\n雨没有停。";
  const tables = canonTables();
  const makeSnapshot = () => ({
    chapter_text: { "chapter-target": text, "chapter-control": "对照正文不得修改。" },
    chapter_content_sha: { "chapter-target": sha(text), "chapter-control": sha("对照正文不得修改。") },
    chapters: [
      { chapter_id: "chapter-control", seq: 2, title: "第02章", status: "DRAFT" },
      { chapter_id: "chapter-target", seq: 3, title: "第03章", status: "DRAFT" },
    ],
    accepted_drafts: { "chapter-target": [{ draft_id: "draft-target", scene_id: "scene-target", scene_seq: 1, revision: 4, sha256: sha(text) }] },
    db_production_counts: { chapters: 2, drafts: 2, scenes: 2, memory_items: 0 },
    extra_counts: { drafts: 2, versions: 2, author_action_receipts: 0, chapter_summaries: 0 },
    scope_rows: { drafts: [], mutations: [], versions: [], chapter_summaries: [] },
    action_receipts: [],
    authoring_canon: buildAuthoringCanonSnapshot({ tables, referenceLogs: [], at: AT, includeChapterFacts: false }),
  });
  const input = "整章检查一遍第03章，有问题告诉我，别改。";
  const identity = { topic: TOPIC, turnId: "turn-scope", runId: "run-scope",
    workId: "work-scope", sessionId: "session-scope", since: AT };
  const result = {
    turn_id: "turn-scope:agent:1", status: "conversational", phase: "completed",
    work_id: "work-scope", session_id: "session-scope",
    agent_run: { run_id: "run-scope", parent_turn_ref: "turn-scope" },
    assistant_message: { text: "已读完；我会把发现作为讨论信息，正文仍保持原样。" },
    adoption_state: { pending: [], resolved: [] }, available_actions: [],
  };
  const frame = (direction, event, body, ref = null, join = null) => ({
    at: AT, direction, frame: [join, ref, TOPIC, event, body],
  });
  const wire = [
    frame("sent", "user_message", { turn_id: "turn-scope", text: input, work_id: "work-scope", session_id: "session-scope" }, "request-1", "join-1"),
    frame("received", "phx_reply", { status: "ok", response: { turn_id: "turn-scope", run_id: "run-scope" } }, "request-1", "join-1"),
    frame("received", "turn_result", result),
    frame("received", "agent_run_state", { workspace_id: "workspace-scope", work_id: "work-scope",
      session_id: "session-scope", run_id: "run-scope", parent_turn_ref: "turn-scope", status: "completed", pending_artifact_refs: [] }),
  ];
  return {
    scenario: { id: "N3", input, expect: { action: "none", zero_write: true, adopt: false }, db: "zero_write" },
    target: { work_id: "work-scope", target_chapter_id: "chapter-target", control_chapter_id: "chapter-control" },
    before: makeSnapshot(), after: makeSnapshot(), identity, wire,
    judgment: { action: "reply" },
    driverEntry: { id: "N3", turn_id: "turn-scope", run_id: "run-scope", final_kind: "turn_result",
      turn_status: "conversational", questions: 0, adoption: null },
  };
}

test("B28 accepts a completed real read-only result with complete unchanged canon", () => {
  assert.equal(typeof evidence.scopeEvidenceChecks, "function");
  allPass(evidence.scopeEvidenceChecks(scopeProof()));
});

for (const [name, mutate] of [
  ["missing business result despite completed driver/run markers", (p) => { p.wire.splice(2, 1); p.driverEntry.final_kind = "completed"; }],
  ["failed run despite a natural language reply", (p) => { p.wire[3].frame[4].status = "failed"; p.driverEntry.final_kind = "failed"; }],
  ["waiting author question", (p) => { p.wire[3].frame[4].status = "awaiting_author"; }],
  ["open question inside the final result", (p) => { p.wire[2].frame[4].author_question = { question: "要不要改？", status: "open" }; }],
  ["unregistered author supplement", (p) => { p.driverEntry.questions = 1; }],
  ["foreign topic result", (p) => { p.wire[2].frame[2] = "workspace:other"; }],
  ["foreign run result", (p) => { p.wire[2].frame[4].agent_run.run_id = "other-run"; }],
  ["foreign session result", (p) => { p.wire[2].frame[4].session_id = "other-session"; }],
  ["duplicate request ACK", (p) => { p.wire.push(structuredClone(p.wire[1])); }],
  ["pending candidate concealed by a driver no-op claim", (p) => { p.wire[2].frame[4].adoption_state.pending.push({ artifact_id: "unrequested" }); }],
  ["forged driver-only adoption receipt", (p) => { p.driverEntry.adoption = { receipt: { status: "accepted" } }; }],
  ["changed target bytes with unchanged row counts", (p) => { p.after.chapter_text["chapter-target"] = "内容已经变了"; }],
  ["changed other chapter bytes", (p) => { p.after.chapter_text["chapter-control"] = "越界改动"; }],
  ["changed accepted revision with unchanged text/counts", (p) => { p.after.accepted_drafts["chapter-target"][0].revision = 5; }],
  ["missing canon evidence", (p) => { delete p.after.authoring_canon; }],
]) {
  test(`B28 read-only evidence rejects ${name}`, () => {
    const proof = scopeProof();
    mutate(proof);
    rejectsProof(evidence.scopeEvidenceChecks, proof);
  });
}

test("B28 cannot turn a local execution request into success merely because a reply caused no write", () => {
  const proof = scopeProof();
  proof.scenario = { id: "N1", input: "不要整章重写，只改第03章第一段。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "target_segments",
      effect: "replace_segments", adopt: true }, db: "first_segment_only" };
  proof.wire[0].frame[4].text = proof.scenario.input;
  rejectsProof(evidence.scopeEvidenceChecks, proof);
});


// 两轮真实会话形状：当前执行段只含本轮，composed session 另含前轮原字节。
// 本测试只验证当前段消费；前轮消息不伪造成当前 run 的 Provider 调用。
function addPriorSessionRound(history, record) {
  const run = history.transcript.run;
  const older = [
    { role: "user", provenance: "author", blocks: [{ type: "text", text: "上一轮作者原文：主角名为沈砚。" }],
      source_refs: ["author_input:turn-earlier"], versions: {} },
    { role: "assistant", provenance: "model", blocks: [{ type: "text", text: "我已看到这份原文。" }],
      source_refs: [], versions: {}, provider_call_ref: "pcall-earlier", provider_run_ref: "prun-earlier" },
  ];
  const coordinate = (runId, parent, sequence) => ({
    run_id: runId, run_sequence: sequence, workspace_id: run.workspace_id, work_id: run.work_id,
    session_id: run.session_id, parent_turn_ref: parent, run_status: "completed",
  });
  history.sessionMessages = [
    ...older.map((message, index) => ({ ...message, canonical_ref: coordinate("run-earlier", "turn-earlier", index + 1) })),
    ...history.transcript.messages.map((message, index) => ({
      ...message, canonical_ref: coordinate(run.run_id, run.parent_turn_ref, index + 1),
    })),
  ];
  const messages = record.request.body.messages;
  const offset = messages[0]?.role === "system" ? 1 : 0;
  messages.splice(offset, 0,
    { role: "user", content: "上一轮作者原文：主角名为沈砚。" },
    { role: "assistant", content: "我已看到这份原文。" });
  return offset;
}

test("B28 composed session accepts a bound current provider call with the full earlier author round", () => {
  const p = providerProof();
  const history = { transcript: p.input.transcript };
  addPriorSessionRound(history, p.input.records[0]);
  p.input.sessionMessages = history.sessionMessages;
  const value = bindProviderProof(p);
  allPass(value.runs[0].calls.checks);
  allPass(evidence.providerEvidenceChecks(value));
});
test("B28 composed session rejects missing session proof even when the current provider segment matches", () => {
  const p = providerProof();
  delete p.input.sessionMessages;
  rejectsProof(evidence.providerEvidenceChecks, bindProviderProof(p));
});
test("B28 composed session rejects a current-only session substituted for the complete provider history", () => {
  const p = providerProof();
  const history = { transcript: p.input.transcript };
  addPriorSessionRound(history, p.input.records[0]);
  p.input.sessionMessages = p.input.transcript.messages;
  rejectsProof(evidence.providerEvidenceChecks, bindProviderProof(p));
});
test("B28 composed session rejects changed earlier author bytes with current provider identity intact", () => {
  const p = providerProof();
  const history = { transcript: p.input.transcript };
  const offset = addPriorSessionRound(history, p.input.records[0]);
  p.input.sessionMessages = history.sessionMessages;
  p.input.records[0].request.body.messages[offset].content = "上一轮作者原文：主角名为林渡。";
  rejectsProof(evidence.providerEvidenceChecks, bindProviderProof(p));
});
test("B28 composed session accepts the Writer candidate after an independent earlier author round", () => {
  const p = localCandidateProof();
  addPriorSessionRound(p.history, p.records[0]);
  const result = evidence.candidateScopeChecks(p);
  allPass(result.checks);
  assert.equal(result.expectedText, "他沿着湿门槛停步。\n\n他没有敲门。\n\n雨没有停。");
});
test("B28 composed session rejects missing Writer session proof despite a matching local run segment", () => {
  const p = localCandidateProof();
  delete p.history.sessionMessages;
  rejectsProof((proof) => evidence.candidateScopeChecks(proof).checks, p);
});
test("B28 composed session rejects changed earlier Writer request bytes outside the current run", () => {
  const p = localCandidateProof();
  const offset = addPriorSessionRound(p.history, p.records[0]);
  p.records[0].request.body.messages[offset].content = "上一轮作者原文：主角名为林渡。";
  rejectsProof((proof) => evidence.candidateScopeChecks(proof).checks, p);
});

function localCandidateProof() {
  const p = scopeProof();
  p.scenario = { id: "N1", input: "不要整章重写，只改第03章第一段。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "target_segments",
      effect: "replace_segments", adopt: true }, db: "first_segment_only" };
  p.wire[0].frame[4].text = p.scenario.input;
  p.judgment = { action: "execute", capability: "revise_adopted_content" };
  const raw = "他二十五岁。\n\n";
  const first = "seg_0_" + sha(raw).slice(0, 12);
  const secondRaw = "雨没有停。";
  const second = "seg_1_" + sha(secondRaw).slice(0, 12);
  const body = "他沿着湿门槛停步。\n\n他没有敲门。";
  const versions = [{ ref: "draft:draft-target", version: 4 }];
  const hashes = [{ segment_id: first, sha256: sha(raw) }];
  const covered = ["draft:draft-target:4"];
  const item = { item_id: "local-item", title: "首段修订", body, rationale: "只改首段。",
    target_segment_ids: [first], provider_call_ref: "pcall-writer" };
  const artifact = {
    artifact_id: "local-artifact", artifact_type: "prose_fragment", adoption_status: "TENTATIVE",
    target_chapter_ref: "chapter:chapter-target", source_turn_ref: "turn-scope:agent:1",
    payload: {
      target_chapter_ref: "chapter:chapter-target", modification_scope: "target_segments", items: [item],
      scope: { kind: "target_segments", target_chapter_ref: "chapter:chapter-target",
        base_draft_ref: "draft:draft-target", base_version: 4, base_versions: versions,
        covered, covered_refs: covered, target_segment_ids: [first], expected_segment_hashes: hashes },
      adoption_effect: { mode: "replace_segments", target_chapter_ref: "chapter:chapter-target",
        base_draft_ref: "draft:draft-target", base_version: 4, base_versions: versions,
        covered, target_segment_ids: [first], expected_segment_hashes: hashes },
    },
  };
  const baseText = p.before.chapter_text["chapter-target"];
  const observation = {
    type: "observation", call_id: "read-chapter", status: "ok", source_refs: ["chapter:chapter-target"],
    versions: { "draft:draft-target": 4 },
    coverage: { chapter_ref: "chapter:chapter-target", prose_total_chars: [...baseText].length,
      prose_range: { start: 1, end: [...baseText].length } },
    content: { tool: "chapter_read", observation_ref: "observation:chapter-scope", source_hash: sha(baseText),
      summary: "【正文】\n" + baseText,
      target_segments: [
        { segment_id: first, byte_start: 0, byte_end: Buffer.byteLength("他二十五岁。"), page_range: { start: 1, end: 6 } },
        { segment_id: second, byte_start: Buffer.byteLength(raw), byte_end: Buffer.byteLength(baseText), page_range: { start: 9, end: [...baseText].length } },
      ] },
    retryable: null, budget_after: null,
  };
  const readCall = { type: "tool_call", call_id: "read-chapter", provider_call_id: "read-chapter",
    name: "judgment_decision", arguments: { action: "explore", query: { chapter_ref: "chapter:chapter-target" } } };
  const writerItem = structuredClone(item);
  delete writerItem.provider_call_ref;
  const submit = { type: "tool_call", call_id: "submit-local", provider_call_id: "submit-local",
    name: "submit_tentative_artifact", arguments: { items: [writerItem] } };
  p.history = { transcript: {
    run: { run_id: "run-scope", workspace_id: "workspace-scope", work_id: "work-scope",
      session_id: "session-scope", parent_turn_ref: "turn-scope" },
    messages: [
      { role: "user", provenance: "author", blocks: [{ type: "text", text: p.scenario.input }], source_refs: [], versions: {} },
      { role: "assistant", provenance: "model", provider_call_ref: "pcall-read", provider_run_ref: "prun-read", blocks: [readCall] },
      { role: "tool", provenance: "tool_result", blocks: [observation], source_refs: [], versions: {} },
      { role: "assistant", provenance: "model", provider_call_ref: "pcall-writer", provider_run_ref: "prun-writer", blocks: [submit] },
    ],
  } };
  p.history.sessionMessages = p.history.transcript.messages;
  p.records = [{
    provider: "splash", provider_call_ref: "pcall-writer", provider_run_ref: "prun-writer",
    work_id: "work-scope", session_id: "session-scope", turn_id: "turn-scope:agent:1",
    request: { url: ENDPOINT + "/chat/completions", body: { model: MODEL, tools: [], messages: [
      { role: "user", content: p.scenario.input },
      { role: "assistant", content: "", tool_calls: [{ id: "read-chapter", type: "function",
        function: { name: readCall.name, arguments: JSON.stringify(readCall.arguments) } }] },
      { role: "tool", tool_call_id: "read-chapter", content: toolResultContent(observation) },
    ] } },
    response: { status: 200, body: { source: "sse_decoder", tool_calls: [
      { id: "submit-local", name: submit.name, arguments: submit.arguments },
    ] } },
  }];
  p.wire[2].frame[4].adoption_state.pending = [artifact];
  p.wire[3].frame[4].pending_artifact_refs = [artifact.artifact_id];
  return { ...p, artifact, expectedText: "他沿着湿门槛停步。\n\n他没有敲门。\n\n雨没有停。" };
}

const candidateChecks = (p) => evidence.candidateScopeChecks(p).checks;
test("B28 local scope permits paragraph splitting inside the named interval and preserves every outside byte", () => {
  const proof = localCandidateProof();
  const result = evidence.candidateScopeChecks(proof);
  allPass(result.checks);
  assert.equal(result.expectedText, "他沿着湿门槛停步。\n\n他没有敲门。\n\n雨没有停。");
});
for (const [name, mutate] of [
  ["stale base version", (p) => { p.artifact.payload.scope.base_version = 3; }],
  ["forged selected hash", (p) => { p.artifact.payload.scope.expected_segment_hashes[0].sha256 = "0".repeat(64); }],
  ["other chapter target", (p) => { p.artifact.target_chapter_ref = "chapter:chapter-control"; }],
  ["unmapped writer item", (p) => { p.artifact.payload.items[0].target_segment_ids = ["unseen-segment"]; }],
  ["candidate text changed after Writer", (p) => { p.artifact.payload.items[0].body += "额外文字"; }],
  ["unbound raw observation", (p) => { p.records[0].request.body.messages[2].content = "{}"; }],
  ["incomplete source page", (p) => {
    const observation = p.history.transcript.messages[2].blocks[0];
    observation.coverage.prose_range.end = 2;
    observation.content.summary = "【正文】\n他二";
    p.records[0].request.body.messages[2].content = toolResultContent(observation);
  }],
]) {
  test("B28 candidate rejects " + name, () => {
    const proof = localCandidateProof();
    mutate(proof);
    rejectsProof(candidateChecks, proof);
  });
}


test("B28 rejects an item rebound to a different valid segment after Writer returned", () => {
  const p = localCandidateProof();
  const other = p.history.transcript.messages[2].blocks[0].content.target_segments[1].segment_id;
  p.history.transcript.messages[3].blocks[0].arguments.items[0].target_segment_ids = [other];
  p.records[0].response.body.tool_calls[0].arguments = structuredClone(p.history.transcript.messages[3].blocks[0].arguments);
  const checks = candidateChecks(p);
  assert.equal(checks.item_targets_exact, true, "候选仍指向合法首段；失败须来自 Writer 原范围被改写");
  assert.equal(checks.candidate_writer_scope_fields, false);
});

function formattingCandidateProof() {
  const p = localCandidateProof();
  p.scenario = { id: "P2", input: "只调整第03章分段和排版，不要改字句。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "format_only",
      effect: "format_paragraphs", adopt: true }, db: "format_only" };
  p.wire[0].frame[4].text = p.scenario.input;
  p.history.transcript.messages[0].blocks[0].text = p.scenario.input;
  p.records[0].request.body.messages[0].content = p.scenario.input;
  const base = p.before.chapter_text["chapter-target"];
  const sourceHash = sha(base);
  const boundary = "break_18_" + sha(sourceHash + ":18").slice(0, 12);
  const changes = [{ boundary_id: boundary, lines: 0 }];
  const item = { item_id: "format-item", title: "合并换行", body: "保留所有文字，只去掉首段后的空行。",
    rationale: "调整分段。", line_break_changes: changes, provider_call_ref: "pcall-writer" };
  const covered = ["draft:draft-target:4"];
  p.artifact.artifact_type = "prose_formatting_plan";
  p.artifact.payload = {
    target_chapter_ref: "chapter:chapter-target", modification_scope: "format_only",
    items: [item], base_text: base, formatting_preview: "他二十五岁。雨没有停。",
    scope: { kind: "format_only", target_chapter_ref: "chapter:chapter-target",
      covered, covered_refs: covered, base_versions: null, base_draft_ref: null, base_version: null,
      target_segment_ids: [], expected_segment_hashes: [], preserve_unmentioned_verbatim: false },
    adoption_effect: { mode: "format_paragraphs", covered,
      expected_base_versions: [{ ref: "draft:draft-target", version: 4 }], coverage: "complete",
      source_hash: sourceHash, line_break_changes: structuredClone(changes), preview_hash: sha("他二十五岁。雨没有停。") },
  };
  const writerItem = structuredClone(item);
  delete writerItem.provider_call_ref;
  p.history.transcript.messages[3].blocks[0].arguments = { items: [writerItem] };
  p.records[0].response.body.tool_calls[0].arguments = { items: [structuredClone(writerItem)] };
  return p;
}
test("B28 formatting preserves source versions, Writer line-break plan and every non-newline byte", () => {
  const p = formattingCandidateProof();
  const result = evidence.candidateScopeChecks(p);
  allPass(result.checks);
  assert.equal(result.expectedText, "他二十五岁。雨没有停。");
});
for (const [name, mutate] of [
  ["stale formatting version", (p) => { p.artifact.payload.adoption_effect.expected_base_versions[0].version = 3; }],
  ["incomplete formatting coverage", (p) => { p.artifact.payload.adoption_effect.coverage = "partial"; }],
  ["formatting scope targets another chapter", (p) => { p.artifact.payload.scope.target_chapter_ref = "chapter:chapter-control"; }],
  ["formatting plan changed after Writer", (p) => {
    p.artifact.payload.items[0].line_break_changes[0].lines = 1;
    p.artifact.payload.adoption_effect.line_break_changes[0].lines = 1;
  }],
  ["formatting effect changed alone", (p) => { p.artifact.payload.adoption_effect.line_break_changes[0].lines = 2; }],
  ["formatting preview changed words with a matching forged hash", (p) => {
    p.artifact.payload.formatting_preview = "他三十岁。雨没有停。";
    p.artifact.payload.adoption_effect.preview_hash = sha(p.artifact.payload.formatting_preview);
  }],
]) {
  test("B28 rejects " + name, () => {
    const proof = formattingCandidateProof();
    mutate(proof);
    rejectsProof(candidateChecks, proof);
  });
}


function wholeCandidateProof() {
  const p = localCandidateProof();
  p.scenario = { id: "P1", input: "把第03章整章重写一遍，情节不变。",
    expect: { action: "execute", capability: "revise_adopted_content", scope: "whole_chapter",
      effect: "replace_scope", adopt: true }, db: "whole_chapter" };
  p.wire[0].frame[4].text = p.scenario.input;
  p.history.transcript.messages[0].blocks[0].text = p.scenario.input;
  p.records[0].request.body.messages[0].content = p.scenario.input;
  const ids = p.history.transcript.messages[2].blocks[0].content.target_segments.map((segment) => segment.segment_id);
  const item = { item_id: "whole-item", title: "整章修订", body: "他在夜雨里停下。\n\n旧窗后有灯。",
    rationale: "保留情节的整章候选。", provider_call_ref: "pcall-writer" };
  const covered = ["draft:draft-target:4"];
  p.artifact.payload = {
    target_chapter_ref: "chapter:chapter-target", modification_scope: "whole_chapter", items: [item],
    scope: { kind: "whole_chapter", target_chapter_ref: "chapter:chapter-target",
      base_draft_ref: "draft:draft-target", base_version: 4, base_versions: null, covered, covered_refs: covered,
      target_segment_ids: ids, expected_segment_hashes: [
        { segment_id: ids[0], sha256: sha("他二十五岁。\n\n") },
        { segment_id: ids[1], sha256: sha("雨没有停。") },
      ] },
    adoption_effect: { mode: "replace_scope", covered,
      expected_base_versions: [{ ref: "draft:draft-target", version: 4 }], coverage: "complete" },
  };
  const writerItem = structuredClone(item);
  delete writerItem.provider_call_ref;
  p.history.transcript.messages[3].blocks[0].arguments = { items: [writerItem] };
  p.records[0].response.body.tool_calls[0].arguments = { items: [structuredClone(writerItem)] };
  return p;
}
test("B28 whole scope requires the full observed chapter and unchanged current baseline versions", () => {
  const p = wholeCandidateProof();
  const result = evidence.candidateScopeChecks(p);
  allPass(result.checks);
  assert.equal(result.expectedText, "他在夜雨里停下。\n\n旧窗后有灯。");
});
for (const [name, mutate] of [
  ["a whole candidate omits an existing source segment", (p) => {
    p.artifact.payload.scope.target_segment_ids.pop();
    p.artifact.payload.scope.expected_segment_hashes.pop();
  }],
  ["whole scope has a stale accepted version", (p) => { p.artifact.payload.adoption_effect.expected_base_versions[0].version = 3; }],
  ["whole output secretly carries a local item mapping", (p) => {
    p.artifact.payload.items[0].target_segment_ids = [p.artifact.payload.scope.target_segment_ids[0]];
  }],
]) {
  test("B28 rejects " + name, () => {
    const proof = wholeCandidateProof();
    mutate(proof);
    rejectsProof(candidateChecks, proof);
  });
}
for (const branch of ["reply", "candidate"]) {
  test("B28 N4 " + branch + " remains unadopted and leaves condition truth to independent review", () => {
    const p = branch === "reply" ? scopeProof() : wholeCandidateProof();
    p.scenario = { id: "N4", input: "如果第03章有明显问题就整章改一遍，没有问题就告诉我。",
      expect: { conditional: true, capability: "revise_adopted_content", scope: "whole_chapter",
        effect: "replace_scope", adopt: false }, db: "conditional_review" };
    p.wire[0].frame[4].text = p.scenario.input;
    if (branch === "candidate") {
      p.history.transcript.messages[0].blocks[0].text = p.scenario.input;
      p.records[0].request.body.messages[0].content = p.scenario.input;
    }
    allPass(evidence.scopeEvidenceChecks(p));
  });
}

const ADOPTION_WORK = "11111111-1111-4111-8111-111111111128";
const ADOPTION_MEMORY = "44444444-4444-4444-8444-444444444128";
const PRIOR_MEMORY = "44444444-4444-4444-8444-444444444127";
const BEFORE_ADOPTION_AT = "2026-11-23T01:00:00.500Z";
const AFTER_ADOPTION_AT = "2026-11-23T01:00:01.500Z";
const PERSISTED_AT = "2026-11-23T01:00:01.100Z";

// 独立输入行经真实 canon owner 签名；不伪造 hash，也不从采纳后反推点击前。
function rebuildAdoptionCanon(p, snapshot, tableOverrides = {}) {
  const tables = canonTables();
  tables.works = [{ id: p.identity.workId }];
  tables.chapters = snapshot.chapters.map(({ chapter_id, ...row }) => ({
    id: chapter_id, work_id: p.identity.workId, ...row, inserted_at: AT, updated_at: AT,
  }));
  tables.scenes = [
    { id: "scene-target", chapter_id: "chapter-target", seq: 1 },
    { id: "scene-target-second", chapter_id: "chapter-target", seq: 2 },
    { id: "scene-control", chapter_id: "chapter-control", seq: 1 },
  ].map((row) => ({ ...row, work_id: p.identity.workId, inserted_at: AT, updated_at: AT }));
  tables.drafts = snapshot.scope_rows.drafts;
  tables.memory_items = snapshot.scope_rows.memory_items;
  tables.author_action_receipts = snapshot.action_receipts;
  Object.assign(tables, tableOverrides);
  snapshot.db_production_counts.memory_items = snapshot.scope_rows.memory_items.length;
  snapshot.authoring_canon = buildAuthoringCanonSnapshot({
    tables, referenceLogs: snapshot.authoring_canon?.memory_reference_logs ?? [],
    at: snapshot.at, includeChapterFacts: false,
  });
}

// P3 的持久化合同：两旧稿 revision 1 -> SUPERSEDED/2，新稿 4；记忆只存候选片段。
// P2 走同一采纳事实入口，但 formatting_plan 不创建 memory。
function adoptionProof({ formatOnly = false, existingMemory = false, recall = false } = {}) {
  const p = formatOnly ? formattingCandidateProof() : localCandidateProof();
  p.identity.workId = p.target.work_id = ADOPTION_WORK;
  p.history.transcript.run.work_id = p.records[0].work_id = ADOPTION_WORK;
  for (const entry of p.wire) if (Object.hasOwn(entry.frame[4], "work_id")) entry.frame[4].work_id = ADOPTION_WORK;
  if (!formatOnly) {
    p.scenario = { id: "P3", input: ORIGINAL_INPUTS[0][1], db: "literal_replace",
      expect: { action: "execute", capability: "revise_adopted_content", scope: "target_segments",
        effect: "replace_segments", adopt: true } };
    p.artifact.payload.items[0].body = "他三十岁。";
  }
  p.driverEntry.id = p.scenario.id;
  p.wire[0].frame[4].text = p.history.transcript.messages[0].blocks[0].text =
    p.records[0].request.body.messages[0].content = p.scenario.input;
  const versions = [{ ref: "draft:draft-target", version: 1 }, { ref: "draft:draft-target-second", version: 1 }];
  const covered = ["draft:draft-target:1", "draft:draft-target-second:1"];
  const payload = p.artifact.payload;
  payload.title = "第03章：局部修订";
  Object.assign(payload.scope, { covered, covered_refs: covered });
  payload.adoption_effect.covered = covered;
  if (formatOnly) payload.adoption_effect.expected_base_versions = versions;
  else for (const value of [payload.scope, payload.adoption_effect]) {
    Object.assign(value, { base_draft_ref: "draft:draft-target", base_version: 1, base_versions: versions });
  }
  const observation = p.history.transcript.messages[2].blocks[0];
  observation.versions = { "draft:draft-target": 1, "draft:draft-target-second": 1 };
  p.records[0].request.body.messages[2].content = toolResultContent(observation);
  const writerItem = structuredClone(payload.items[0]);
  delete writerItem.provider_call_ref;
  p.history.transcript.messages[3].blocks[0].arguments = { items: [writerItem] };
  p.records[0].response.body.tool_calls[0].arguments = { items: [structuredClone(writerItem)] };
  p.expectedText = formatOnly ? "他二十五岁。雨没有停。" : "他三十岁。\n\n雨没有停。";
  const result = p.wire[2].frame[4];
  result.assistant_message.text = "修订候选已生成，等待作者确认。";
  const action = { action_id: "accept:local-artifact", action_type: "accept", idempotency_key: "accept-local-once",
    source_turn_ref: result.turn_id, target_ref: p.artifact.artifact_id, enabled: true };
  result.available_actions = [action];
  const mutation = { id: "88888888-8888-4888-8888-888888888128", actor_ref: "author", source_turn_ref: result.turn_id,
    target_scope: "work:" + ADOPTION_WORK, target_object_ref: p.artifact.artifact_id,
    proposed_change_ref: p.artifact.artifact_id, base_revision: 1,
    mutation_type: "adopt_artifact", status: "APPLIED", authority_scope: "author_confirmed_adoption",
    requires_adoption: 0, inserted_at: PERSISTED_AT, updated_at: PERSISTED_AT };
  const projection = { chapter_id: "chapter-target", scene_id: "scene-target", draft_id: "draft-new",
    source_revision_ref: "draft:draft-new:4", mutation_id: mutation.id, adoption_effect: payload.adoption_effect.mode,
    scope: payload.modification_scope, covered_refs: covered, superseded_draft_refs: covered };
  const receipt = {
    action_id: "adopt:local-artifact", action_type: "adopt", artifact_id: "local-artifact",
    artifact_type: p.artifact.artifact_type, status: "accepted",
    decision: { candidate_ref: "local-artifact", decision_type: "adopt_tentative" },
    adoption_effect: { mode: payload.adoption_effect.mode },
    persistence: { mutation_id: mutation.id, mutation_status: "APPLIED", persisted: true,
      source_revision_ref: "mutation:" + mutation.id, reading_projection: projection,
      ...(!formatOnly ? { memory_item_id: ADOPTION_MEMORY, memory_status: "CONFIRMED" } : {}) },
  };
  const sent = { at: "2026-11-23T01:00:01.000Z", direction: "sent",
    frame: ["join-1", "action-request", TOPIC, "author_action", { action }] };
  const ack = { at: "2026-11-23T01:00:01.100Z", direction: "received", frame: ["join-1", "action-request", TOPIC, "phx_reply",
    { status: "ok", response: { received: true, action_status: "accepted" } }] };
  const broadcast = { at: "2026-11-23T01:00:01.200Z", direction: "received",
    frame: [null, null, TOPIC, "action_result", receipt] };
  p.wire.push(sent, ack, broadcast);
  p.driverEntry.adoption = { artifact_id: "local-artifact", button: formatOnly ? "应用分段方案" : "保存为章节正文",
    clicked_at: "2026-11-23T01:00:00.750Z", send: structuredClone(sent.frame[4]), ack: structuredClone(ack.frame[4]),
    receipt: structuredClone(receipt) };
  const draftRow = (id, scene, content) => ({ id, work_id: ADOPTION_WORK, scene_id: scene, status: "ACCEPTED",
    revision: 1, content, inserted_at: AT, updated_at: AT });
  const oldDrafts = [draftRow("draft-target", "scene-target", "他二十五岁。"),
    draftRow("draft-target-second", "scene-target-second", "雨没有停。"),
    draftRow("draft-control", "scene-control", "对照正文不得修改。")];
  const priorMemory = { id: PRIOR_MEMORY, work_id: ADOPTION_WORK, source_id: "prior-mutation", source_type: "AUTHOR_CONFIRMED",
    type: "DRAFT_CONTEXT", status: "CONFIRMED", scope: "WORK", content: "既有资料原文不得改写。", summary: "既有资料",
    tags: '["adopted_artifact","prose_fragment"]', reference_count: 0, last_referenced_at: null,
    inserted_at: AT, updated_at: AT };
  p.before.at = AT;
  p.before.checkpoint = "start";
  p.before.action_receipts = [];
  p.before.scope_rows = { drafts: oldDrafts, mutations: [], versions: [], chapter_summaries: [],
    memory_items: existingMemory || recall ? [priorMemory] : [] };
  p.before.accepted_drafts = {
    "chapter-target": oldDrafts.slice(0, 2).map((row, index) => ({ draft_id: row.id, scene_id: row.scene_id,
      scene_seq: index + 1, revision: 1, sha256: sha(row.content) })),
    "chapter-control": [{ draft_id: "draft-control", scene_id: "scene-control", scene_seq: 1,
      revision: 1, sha256: sha("对照正文不得修改。") }],
  };
  p.before.db_production_counts = { chapters: 2, drafts: 3, scenes: 3, memory_items: p.before.scope_rows.memory_items.length };
  p.before.extra_counts = { drafts: 3, versions: 0, author_action_receipts: 0, chapter_summaries: 0 };
  rebuildAdoptionCanon(p, p.before);
  p.beforeAdoption = structuredClone(p.before);
  p.beforeAdoption.at = BEFORE_ADOPTION_AT;
  p.beforeAdoption.checkpoint = p.scenario.id + "-before-adoption";
  if (recall) {
    const referencedAt = "2026-11-23T01:00:00.250Z";
    Object.assign(p.beforeAdoption.scope_rows.memory_items[0], { reference_count: 1, last_referenced_at: referencedAt });
    p.beforeAdoption.authoring_canon.memory_reference_logs.push({
      id: "99999999-9999-4999-8999-999999999128", memory_id: PRIOR_MEMORY, work_id: ADOPTION_WORK,
      task_id: null, conversation_id: null, reference_scene: "dialogue_context",
      reference_reason: "dialogue context recall", inserted_at: referencedAt,
    });
  }
  rebuildAdoptionCanon(p, p.beforeAdoption);
  p.after = structuredClone(p.beforeAdoption);
  p.after.at = AFTER_ADOPTION_AT;
  p.after.checkpoint = p.scenario.id;
  p.after.scope_rows.drafts = oldDrafts.map((row) => row.id === "draft-control" ? structuredClone(row)
    : { ...row, status: "SUPERSEDED", revision: 2, updated_at: PERSISTED_AT });
  p.after.scope_rows.drafts.push({ ...oldDrafts[0], id: "draft-new", revision: 4, content: p.expectedText,
    inserted_at: PERSISTED_AT, updated_at: PERSISTED_AT });
  p.after.scope_rows.mutations = [mutation];
  if (!formatOnly) p.after.scope_rows.memory_items.push({
    ...priorMemory, id: ADOPTION_MEMORY, source_id: mutation.id,
    content: payload.items.map((item) => item.body).join("\n\n"), summary: payload.title,
    inserted_at: PERSISTED_AT, updated_at: PERSISTED_AT,
  });
  p.after.action_receipts = [{ id: "receipt-local", work_id: ADOPTION_WORK, session_id: "session-scope",
    source_turn_ref: result.turn_id, action_id: action.action_id, action_type: "accept",
    idempotency_key: action.idempotency_key, status: "accepted",
    result: { ...structuredClone(receipt), decision: "ACCEPTED", decided_by: "author", payload_digest: "frozen-action" } }];
  p.after.chapter_text["chapter-target"] = p.expectedText;
  p.after.chapter_content_sha["chapter-target"] = sha(p.expectedText);
  p.after.accepted_drafts["chapter-target"] = [{ draft_id: "draft-new", scene_id: "scene-target",
    scene_seq: 1, revision: 4, sha256: sha(p.expectedText) }];
  p.after.db_production_counts.drafts += 1;
  p.after.db_production_counts.memory_items += formatOnly ? 0 : 1;
  p.after.extra_counts.drafts += 1;
  p.after.extra_counts.author_action_receipts += 1;
  rebuildAdoptionCanon(p, p.after);
  return p;
}
const adoptionChecks = (p) => evidence.adoptionEvidenceChecks(
  p.wire, p.identity, p.wire[2].frame[4], p.artifact, p.before, p.after, p.driverEntry, p.beforeAdoption);

test("B28 adoption binds the original action result to one stored receipt, one mutation and one new draft", () => {
  allPass(adoptionChecks(adoptionProof()));
});
for (const [check, purpose] of [
  ["canon_only_bound_draft_and_receipt", "only the receipt-bound memory joins the permitted canon delta"],
  ["memory_reference_updates_accounted", "new memory starts at zero without an invented reference log"],
  ["superseded_drafts_exact", "old accepted revisions advance from 1 to 2 with original bytes preserved"],
  ["projection_bound_to_new_draft", "new draft revision 4 matches both persisted receipt and projection"],
]) {
  test("B28 adoption P3 accepts " + purpose, () => {
    const p = adoptionProof();
    assert.equal(p.after.scope_rows.memory_items[0].content, "他三十岁。");
    assert.notEqual(p.after.scope_rows.memory_items[0].content, p.after.chapter_text["chapter-target"]);
    assert.equal(adoptionChecks(p)[check], true);
  });
}
test("B28 adoption scope consumer receives the real before-adoption snapshot and closes the exact P3 effect", () => {
  allPass(evidence.scopeEvidenceChecks(adoptionProof()));
});
test("B28 adoption accounts a dialogue reference before the click and creates an unreferenced new memory after it", () => {
  const p = adoptionProof({ recall: true });
  assert.equal(p.before.scope_rows.memory_items[0].reference_count, 0);
  assert.equal(p.beforeAdoption.scope_rows.memory_items[0].reference_count, 1);
  assert.equal(p.after.scope_rows.memory_items.find((row) => row.id === ADOPTION_MEMORY).reference_count, 0);
  allPass(evidence.scopeEvidenceChecks(p));
});
test("B28 adoption formatting persists the exact new draft and mutation with zero memory additions", () => {
  const p = adoptionProof({ formatOnly: true });
  assert.deepEqual(p.after.scope_rows.memory_items, []);
  assert.equal(Object.hasOwn(p.wire.at(-1).frame[4].persistence, "memory_item_id"), false);
  allPass(evidence.scopeEvidenceChecks(p));
});
for (const [name, mutate] of [
  ["a driver-only receipt", (p) => { p.wire.pop(); }],
  ["a foreign topic receipt", (p) => { p.wire.at(-1).frame[2] = "workspace:other"; }],
  ["a duplicate action acknowledgement", (p) => { p.wire.push(structuredClone(p.wire.at(-2))); }],
  ["same identity but different persisted result", (p) => { p.after.action_receipts[0].result.persistence.reading_projection.draft_id = "other-draft"; }],
  ["a receipt naming another mutation", (p) => { p.after.action_receipts[0].result.persistence.mutation_id = "other-mutation"; }],
  ["a foreign mutation target", (p) => { p.after.scope_rows.mutations[0].target_object_ref = "other-artifact"; }],
  ["a pending mutation", (p) => { p.after.scope_rows.mutations[0].status = "PROPOSED"; }],
  ["an extra mutation", (p) => { p.after.scope_rows.mutations.push({ ...p.after.scope_rows.mutations[0], id: "mutation-extra" }); }],
  ["a mutation on an older turn", (p) => { p.after.scope_rows.mutations[0].source_turn_ref = "older-turn"; }],
  ["a forged accepted draft body", (p) => { p.after.scope_rows.drafts.find((row) => row.id === "draft-new").content += "越界改字"; }],
  ["changed old draft bytes", (p) => { p.after.scope_rows.drafts[0].content = "旧稿被偷偷覆盖"; }],
  ["an extra persisted receipt", (p) => { p.after.action_receipts.push({ ...p.after.action_receipts[0], id: "extra-receipt" }); }],
  ["a write to unrelated canon", (p) => { p.after.authoring_canon.tables.characters.canon_sha256 = "a".repeat(64); }],
  ["an unexplained version row", (p) => { p.after.scope_rows.versions.push({ id: "extra-version" }); }],
]) {
  test("B28 adoption rejects " + name, () => {
    const p = adoptionProof();
    mutate(p);
    rejectsProof(adoptionChecks, p);
  });
}
for (const [name, mutate] of [
  ["a memory from another work", (p) => { p.after.scope_rows.memory_items[0].work_id = "11111111-1111-4111-8111-111111111129"; }],
  ["a memory bound to another mutation", (p) => { p.after.scope_rows.memory_items[0].source_id = "other-mutation"; }],
  ["a memory id absent from the actual receipt", (p) => { p.after.scope_rows.memory_items[0].id = PRIOR_MEMORY; }],
  ["an extra memory", (p) => { p.after.scope_rows.memory_items.push({ ...p.after.scope_rows.memory_items[0], id: PRIOR_MEMORY }); }],
  ["a memory containing the full chapter instead of only candidate bodies", (p) => { p.after.scope_rows.memory_items[0].content = p.expectedText; }],
  ["a tentative memory despite accepted prose", (p) => { p.after.scope_rows.memory_items[0].status = "TENTATIVE"; }],
  ["a new memory with an unexplained reference count", (p) => { p.after.scope_rows.memory_items[0].reference_count = 1; }],
  ["a new memory with an unexplained last-reference time", (p) => { p.after.scope_rows.memory_items[0].last_referenced_at = AFTER_ADOPTION_AT; }],
]) {
  test("B28 adoption rejects " + name + " even with a correctly recomputed canon snapshot", () => {
    const p = adoptionProof();
    mutate(p);
    rebuildAdoptionCanon(p, p.after);
    rejectsProof(adoptionChecks, p);
  });
}
test("B28 adoption rejects changes to pre-existing memory while the one new memory remains correctly bound", () => {
  const p = adoptionProof({ existingMemory: true });
  p.after.scope_rows.memory_items.find((row) => row.id === PRIOR_MEMORY).content = "偷偷改写既有资料";
  rebuildAdoptionCanon(p, p.after);
  rejectsProof(adoptionChecks, p);
});
test("B28 adoption rejects an otherwise balanced dialogue reference added during the click-to-receipt stage", () => {
  const p = adoptionProof({ recall: true });
  const row = p.after.scope_rows.memory_items.find((entry) => entry.id === PRIOR_MEMORY);
  row.reference_count = 2;
  row.last_referenced_at = "2026-11-23T01:00:01.050Z";
  p.after.authoring_canon.memory_reference_logs.push({ ...p.beforeAdoption.authoring_canon.memory_reference_logs[0],
    id: "99999999-9999-4999-8999-999999999129", inserted_at: row.last_referenced_at });
  rebuildAdoptionCanon(p, p.after);
  rejectsProof(adoptionChecks, p);
});
test("B28 adoption rejects a dialogue count increase before the click when its real reference log is missing", () => {
  const p = adoptionProof({ recall: true });
  p.beforeAdoption.authoring_canon.memory_reference_logs = [];
  p.after.authoring_canon.memory_reference_logs = [];
  rejectsProof(evidence.scopeEvidenceChecks, p);
});
for (const [name, mutate] of [
  ["missing before-adoption evidence", (p) => { delete p.beforeAdoption; }],
  ["the final state substituted for before-adoption evidence", (p) => {
    p.beforeAdoption = structuredClone(p.after);
    p.beforeAdoption.at = p.beforeAdoption.authoring_canon.at = BEFORE_ADOPTION_AT;
    p.beforeAdoption.checkpoint = p.scenario.id + "-before-adoption";
  }],
  ["unrelated canon briefly changed before adoption", (p) => {
    rebuildAdoptionCanon(p, p.beforeAdoption, {
      characters: [{ id: "unapproved-character", work_id: ADOPTION_WORK, name: "未经采纳的角色" }],
    });
  }],
]) {
  test("B28 adoption scope rejects " + name, () => {
    const p = adoptionProof();
    mutate(p);
    rejectsProof(adoptionChecks, p);
    rejectsProof(evidence.scopeEvidenceChecks, p);
  });
}
test("B28 adoption formatting rejects a memory write even when it carries this action's mutation identity", () => {
  const p = adoptionProof({ formatOnly: true });
  const memory = structuredClone(adoptionProof().after.scope_rows.memory_items[0]);
  memory.source_id = p.after.scope_rows.mutations[0].id;
  memory.content = p.artifact.payload.items.map((item) => item.body).join("\n\n");
  p.after.scope_rows.memory_items.push(memory);
  for (const receipt of [p.wire.at(-1).frame[4], p.driverEntry.adoption.receipt, p.after.action_receipts[0].result]) {
    Object.assign(receipt.persistence, { memory_item_id: memory.id, memory_status: "CONFIRMED" });
  }
  rebuildAdoptionCanon(p, p.after);
  rejectsProof(adoptionChecks, p);
});
test("B28 rejects changed outside bytes even with otherwise valid action and receipt facts", () => {
  const p = adoptionProof();
  p.after.chapter_text["chapter-control"] = "篡改对照章";
  rejectsProof(evidence.scopeEvidenceChecks, p);
});

function memoryHarness(proof) {
  const sent = [], clicked = [], captured = [];
  return {
    sent, clicked, captured, log: [],
    runStep: async (_kind, _label, run) => run(),
    rawWaitInputReady: async () => true, dumpNodes: () => [],
    rawTypeAndSend: async (text) => { sent.push(text); return proof.wire[0]; },
    pollWire: async (read) => { const value = read(proof.wire); assert(value, "fixture 必须给出可观察终态"); return value; },
    transport: () => proof.wire,
    safeClick: (...args) => { clicked.push(args); throw new Error("unexpected author action"); },
    capture: (label) => { captured.push(label); return []; },
  };
}
for (const status of ["awaiting_author", "failed", "cancelled"]) {
  test("B28 driver stops on " + status + " after exactly the frozen author input", async () => {
    const p = scopeProof();
    p.wire[3].frame[4].status = status;
    const harness = memoryHarness(p);
    const result = await runScopeScenario(harness, { target: p.target, budget: budget(1) }, p.scenario, { captureEvidence() {} });
    assert.deepEqual(harness.sent, ["整章检查一遍第03章，有问题告诉我，别改。"]);
    assert.deepEqual(harness.clicked, []);
    assert.equal(result.author_supplements, 0);
    assert.notEqual(result.final_kind, "turn_result");
  });
}
test("B28 driver leaves a conditional N4 candidate for review without inventing an adoption", async () => {
  const p = localCandidateProof();
  p.scenario = { id: "N4", input: "如果第03章有明显问题就整章改一遍，没有问题就告诉我。",
    expect: { conditional: true, adopt: false } };
  p.wire[0].frame[4].text = p.scenario.input;
  const harness = memoryHarness(p);
  const result = await runScopeScenario(harness, { target: p.target, budget: budget(1) }, p.scenario, { captureEvidence() {} });
  assert.deepEqual(harness.sent, [p.scenario.input]);
  assert.deepEqual(harness.clicked, []);
  assert.equal(result.pending_count, 1);
  assert.equal(result.adoption, null);
});
test("B28 uses current run pending refs and retains a byte-identical historical N4 candidate separately", () => {
  const p = localCandidateProof();
  const old = structuredClone(p.artifact);
  old.artifact_id = "older-n4-candidate";
  old.source_turn_ref = "turn-n4";
  const previous = structuredClone(p.wire[2]);
  previous.at = "2026-11-23T00:59:00.000Z";
  previous.frame[4].turn_id = "turn-n4";
  previous.frame[4].adoption_state.pending = [old];
  p.wire.unshift(previous);
  p.wire[3].frame[4].adoption_state.pending.push(structuredClone(old));
  const own = evidence.scopePendingArtifacts(p.wire, p.identity, p.wire[3].frame[4]);
  assert.deepEqual(own.map(({ artifact_id }) => artifact_id), ["local-artifact"]);
  p.wire[3].frame[4].adoption_state.pending[1].payload.items[0].body = "伪称历史的另一个候选";
  assert.equal(evidence.scopePendingArtifacts(p.wire, p.identity, p.wire[3].frame[4]), null);
});
// 2026-11-23 原生 N1：合法 reply_only 省略 adoption_state，
// TurnResult 内 run 尚为 running，随后同一 run 的终态明确 refs=[]。
// 这里只冻结传输事实；N1 是否满足新的局部执行目标仍由独立 scope 验收判断。
function replyOnlyPendingProof(id = "N1", since = AT) {
  const p = scopeProof();
  p.scenario = structuredClone(evidence.SCENARIOS.find((scenario) => scenario.id === id));
  p.identity = { ...p.identity, turnId: "turn-" + id, runId: "run-" + id, since };
  const [send, ack, resultRecord, stateRecord] = p.wire;
  for (const record of p.wire) record.at = since;
  send.frame[1] = ack.frame[1] = "request-" + id;
  Object.assign(send.frame[4], { turn_id: p.identity.turnId, text: p.scenario.input });
  Object.assign(ack.frame[4].response, { turn_id: p.identity.turnId, run_id: p.identity.runId });
  const result = resultRecord.frame[4];
  Object.assign(result, {
    turn_id: p.identity.turnId + ":agent:1", phase: "dialogue",
    agent_run: { run_id: p.identity.runId, parent_turn_ref: p.identity.turnId,
      status: "running", phase: "reasoning" },
    assistant_message: { text: "第03章《潮汐账页》这次没有做整章重写，范围本来就只落在第一段。" },
    orchestrator_decision: { decision_type: "reply_only", required_author_action: null },
    truthfulness: { reason_codes: ["reply_only_no_execution"], decision_type: "reply_only",
      artifact_adopted: false, production_write_performed: false, tool_called: false },
  });
  delete result.adoption_state;
  Object.assign(stateRecord.frame[4], {
    run_id: p.identity.runId, parent_turn_ref: p.identity.turnId,
    status: "completed", phase: "stopped", pending_artifact_refs: [],
  });
  Object.assign(p.driverEntry, { id, turn_id: p.identity.turnId, run_id: p.identity.runId,
    outcome_kind: "reply", pending_count: 0, author_supplements: 0 });
  return { ...p, result, stateRecord };
}

test("B28 explicit-zero pending accepts reply_only without adoption_state only from the current completed run", () => {
  const p = replyOnlyPendingProof();
  assert.equal(Object.hasOwn(p.result, "adoption_state"), false);
  assert.equal(p.result.agent_run.status, "running");
  assert.deepEqual(evidence.scopePendingArtifacts(p.wire, p.identity, p.result), []);
});

test("B28 explicit-zero pending keeps local execution coverage unproved after a legal reply", () => {
  const p = replyOnlyPendingProof();
  assert.deepEqual(evidence.scopePendingArtifacts(p.wire, p.identity, p.result), []);
  assert.equal(p.scenario.expect.action, "execute");
  assert.equal(p.scenario.expect.scope, "target_segments");
  rejectsProof(evidence.scopeEvidenceChecks, p);
});

for (const [name, mutate] of [
  ["missing run state", (p) => { p.wire.pop(); }],
  ["missing refs", (p) => { delete p.stateRecord.frame[4].pending_artifact_refs; }],
  ["null refs", (p) => { p.stateRecord.frame[4].pending_artifact_refs = null; }],
  ["non-array refs", (p) => { p.stateRecord.frame[4].pending_artifact_refs = {}; }],
  ["foreign topic", (p) => { p.stateRecord.frame[2] = "workspace:other"; }],
  ["foreign workspace", (p) => { p.stateRecord.frame[4].workspace_id = "other"; }],
  ["foreign work", (p) => { p.stateRecord.frame[4].work_id = "other"; }],
  ["foreign session", (p) => { p.stateRecord.frame[4].session_id = "other"; }],
  ["foreign turn", (p) => { p.stateRecord.frame[4].parent_turn_ref = "other"; }],
  ["foreign run", (p) => { p.stateRecord.frame[4].run_id = "other"; }],
  ["state older than the input", (p) => { p.stateRecord.at = "2026-11-23T00:59:00.000Z"; }],
  ["sent-only state", (p) => { p.stateRecord.direction = "sent"; }],
  ["missing terminal status", (p) => { delete p.stateRecord.frame[4].status; }],
  ["still-running state", (p) => { p.stateRecord.frame[4].status = "running"; }],
  ["failed state", (p) => { p.stateRecord.frame[4].status = "failed"; }],
  ["awaiting-author state", (p) => { p.stateRecord.frame[4].status = "awaiting_author"; }],
  ["nonempty refs without a candidate payload", (p) => { p.stateRecord.frame[4].pending_artifact_refs = ["missing-artifact"]; }],
  ["duplicate refs", (p) => { p.stateRecord.frame[4].pending_artifact_refs = ["missing-artifact", "missing-artifact"]; }],
  ["latest state contradicts an earlier explicit zero", (p) => {
    const later = structuredClone(p.stateRecord);
    later.at = "2026-11-23T01:00:01.000Z";
    later.frame[4].pending_artifact_refs = ["unexplained-artifact"];
    p.wire.push(later);
  }],
]) {
  test("B28 explicit-zero pending rejects " + name + " for omitted and empty pending payloads", () => {
    for (const mode of ["omitted", "empty"]) {
      const p = replyOnlyPendingProof();
      if (mode === "empty") p.result.adoption_state = { pending: [], resolved: [] };
      mutate(p);
      assert.equal(evidence.scopePendingArtifacts(p.wire, p.identity, p.result), null, mode);
    }
  });
}

test("B28 explicit-zero pending does not treat a malformed adoption_state as an omitted one", () => {
  for (const adoption of [null, {}, { pending: null }, { pending: {} }]) {
    const p = replyOnlyPendingProof();
    p.result.adoption_state = adoption;
    assert.equal(evidence.scopePendingArtifacts(p.wire, p.identity, p.result), null);
  }
});

test("B28 explicit-zero pending rejects an unexplained candidate despite terminal refs=[]", () => {
  const p = replyOnlyPendingProof();
  p.result.adoption_state = { pending: [structuredClone(localCandidateProof().artifact)], resolved: [] };
  assert.equal(evidence.scopePendingArtifacts(p.wire, p.identity, p.result), null);
});

test("B28 explicit-zero pending retains only an unchanged historical candidate and never borrows its payload", () => {
  const p = replyOnlyPendingProof();
  const old = structuredClone(localCandidateProof().artifact);
  old.artifact_id = "older-n4-candidate";
  old.source_turn_ref = "turn-n4";
  const prior = structuredClone(p.wire[2]);
  prior.at = "2026-11-23T00:59:00.000Z";
  Object.assign(prior.frame[4], {
    turn_id: "turn-n4", agent_run: { run_id: "run-n4", parent_turn_ref: "turn-n4" },
    adoption_state: { pending: [structuredClone(old)], resolved: [] },
  });
  p.wire.unshift(prior);
  p.result.adoption_state = { pending: [structuredClone(old)], resolved: [] };
  assert.deepEqual(evidence.scopePendingArtifacts(p.wire, p.identity, p.result), []);
  p.result.adoption_state.pending[0].payload.items[0].body = "改过正文的旧候选";
  assert.equal(evidence.scopePendingArtifacts(p.wire, p.identity, p.result), null);
  delete p.result.adoption_state;
  p.stateRecord.frame[4].pending_artifact_refs = [old.artifact_id];
  assert.equal(evidence.scopePendingArtifacts(p.wire, p.identity, p.result), null,
    "当前非空 refs 不能借前轮 payload 冒充当前完整候选");
});

test("B28 explicit-zero pending lets the real driver record reply and continue with no supplement or adoption", async () => {
  // N2 的回复是内存夹具，仅证明下一次调用可达；不宣称实际原生 N2 已运行或语义通过。
  const proofs = [replyOnlyPendingProof(), replyOnlyPendingProof("N2", "2026-11-23T01:01:00.000Z")];
  proofs[1].result.assistant_message.text = "这里是下一次冻结输入的独立回复夹具。";
  const harness = memoryHarness(proofs[0]);
  const wire = [], checkpoints = [], results = [];
  harness.rawTypeAndSend = async (text) => {
    const p = proofs[harness.sent.length];
    assert(p, "不得增加未登记输入");
    assert.equal(text, p.scenario.input);
    harness.sent.push(text);
    wire.push(...p.wire);
    return p.wire[0];
  };
  harness.transport = () => wire;
  harness.pollWire = async (read) => {
    const value = read(wire);
    assert(value, "当前输入必须具有独立 ACK 与终态");
    return value;
  };
  const config = { target: { ...proofs[0].target, session_id: proofs[0].identity.sessionId }, budget: budget(2) };
  for (const p of proofs) {
    const result = await runScopeScenario(harness, config, p.scenario, {
      captureEvidence: (id) => checkpoints.push(id),
    });
    results.push(result);
    assert.equal(result.final_kind, "turn_result");
  }
  assert.deepEqual(harness.sent, ORIGINAL_INPUTS.filter(([id]) => ["N1", "N2"].includes(id)).map(([, input]) => input));
  assert.deepEqual(harness.clicked, []);
  assert.deepEqual(harness.captured, ["N1-after", "N2-after"]);
  assert.deepEqual(checkpoints, ["N1", "N2"]);
  assert.deepEqual(harness.log, []);
  assert.deepEqual(results.map((result) => ({
    id: result.id, outcome: result.outcome_kind, pending: result.pending_count,
    questions: result.questions, supplements: result.author_supplements, adoption: result.adoption,
  })), ["N1", "N2"].map((id) => ({ id, outcome: "reply", pending: 0, questions: 0, supplements: 0, adoption: null })));
  assert.deepEqual(results.map(({ assistant_text }) => assistant_text), proofs.map(({ result }) => result.assistant_message.text));
});

test("B28 external model ownership observation never sends a lifecycle request", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("external mutation forbidden"); });
  const value = observeExternalModelService({ provider: "splash", model: MODEL, endpoint: ENDPOINT });
  assert.equal(value.lifecycle_action, "none");
  assert.equal(value.read_only, true);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

