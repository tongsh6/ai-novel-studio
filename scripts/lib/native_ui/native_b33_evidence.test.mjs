import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  adoptionEvidenceChecks, discussionEvidenceChecks, prepare, providerEvidenceChecks,
} from "../../native_b33_evidence.mjs";
import { observeExternalModelService } from "../../native_b33_drive.mjs";
import { buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import { canonTables } from "./fixtures/native_b71_revision_facts.mjs";

function fixture() {
  const tables = canonTables();
  const snapshot = (rows, at) => ({
    extra_counts: { draft_versions: 0, action_receipts: 0 },
    authoring_canon: buildAuthoringCanonSnapshot({
      tables: rows, referenceLogs: [], at, includeChapterFacts: false,
    }),
  });
  return {
    tables,
    snapshot,
    evidence: {
      before: snapshot(tables, "2026-11-22T01:00:00.000Z"),
      after: snapshot(tables, "2026-11-22T01:01:00.000Z"),
      turnResult: { status: "completed", adoption_state: { pending: [] } },
      judgment: { action: "reply" },
      driverEntry: { final_kind: "turn_result", turn_status: "completed", questions: 0 },
    },
  };
}

test("B33 discussion accepts a completed reply with complete unchanged canon evidence", () => {
  const { evidence } = fixture();
  assert(Object.values(discussionEvidenceChecks(evidence)).every((value) => value === true));
});

test("B33 discussion rejects an in-place content change even when every row count stays equal", () => {
  const { tables, snapshot, evidence } = fixture();
  tables.chapters[0].title = "这一章已被悄悄改名";
  evidence.after = snapshot(tables, "2026-11-22T01:01:00.000Z");
  assert.deepEqual(
    Object.values(evidence.before.authoring_canon.tables).map((table) => table.row_count),
    Object.values(evidence.after.authoring_canon.tables).map((table) => table.row_count),
  );
  assert.equal(discussionEvidenceChecks(evidence).zero_production_write, false);
});

test("B33 discussion rejects a candidate even if a driver reports no stored row change", () => {
  const { evidence } = fixture();
  evidence.turnResult.adoption_state.pending.push({ artifact_id: "unrequested-candidate" });
  assert.equal(discussionEvidenceChecks(evidence).no_pending_candidate, false);
});

test("B33 discussion cannot become a pass through an unregistered author answer", () => {
  const { evidence } = fixture();
  evidence.driverEntry.questions = 1;
  assert.equal(discussionEvidenceChecks(evidence).no_author_supplement, false);
  evidence.driverEntry.questions = 0;
  evidence.turnResult.author_question = { question_ref: "actual-question", status: "open" };
  assert.equal(discussionEvidenceChecks(evidence).no_author_question, false);
});

test("B33 discussion does not treat a failed run or an exploration result as a final reply", () => {
  const { evidence } = fixture();
  evidence.turnResult.status = "failed";
  assert.equal(discussionEvidenceChecks(evidence).no_failed_result, false);
  evidence.turnResult.status = "completed";
  evidence.judgment.action = "explore";
  assert.equal(discussionEvidenceChecks(evidence).judgment_action_reply, false);
});

test("B33 discussion requires full snapshots and explicit candidate counts", () => {
  const { evidence } = fixture();
  delete evidence.after.extra_counts;
  assert.equal(discussionEvidenceChecks(evidence).zero_candidate_write, false);
  delete evidence.after.authoring_canon;
  assert.throws(() => discussionEvidenceChecks(evidence));
});

test("B33 discussion keeps memory reference accounting separate from canon content equality", () => {
  const { tables, snapshot, evidence } = fixture();
  tables.memory_items[0].reference_count = 1;
  tables.memory_items[0].last_referenced_at = "2026-11-22T01:00:30.000Z";
  evidence.after = snapshot(tables, "2026-11-22T01:01:00.000Z");
  const checks = discussionEvidenceChecks(evidence);
  assert.equal(checks.zero_production_write, true);
  assert.equal(checks.memory_reference_updates_accounted, false);
});

const FROZEN_B33_SCENARIOS = [
  { id: "S1", kind: "conditional_noop",
    input: "帮我修改第03章正文中的错别字；如果没有错别字，就告诉我无需修改。",
    expect_action: "reply", zero_write: true },
  { id: "S2", kind: "explain_only",
    input: "解释一下第03章为什么采用全书连续编号，只解释，不要修改。",
    expect_action: "reply", zero_write: true },
  { id: "S3", kind: "discussion_character",
    input: "讨论一下把陆晨指定为主角是否合理，先不要生成候选。",
    expect_action: "reply", zero_write: true },
  { id: "S6", kind: "discussion_ending",
    input: "只聊第03章结尾怎么处理，先别动笔。",
    expect_action: "reply", zero_write: true },
  { id: "S5", kind: "execute_maintenance",
    input: "把全书章节编号理顺，只改列表编号，内容不要动。",
    expect_action: "execute", expect_capability: "maintain_chapter_structure", adopt: true },
  { id: "S4", kind: "execute_prose",
    input: "第07章的正文还没写，帮我写出来吧。",
    expect_action: "execute", expect_capability: "prose_writing", adopt: true },
];

function providerFixture(t, provider = "splash") {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "b33-provider-evidence-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  fs.mkdirSync(path.join(dir, "database"));
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  db.exec("CREATE TABLE works (id TEXT, title TEXT); INSERT INTO works VALUES ('work-b33', 'B33实际作品')");
  db.close();
  fs.writeFileSync(path.join(dir, "seed.log"), "work_id=work-b33 session_id=session-b33");
  write("native-driver-ready.json", {
    slice_id: "b33-authoring-intent-judgment-reliability", driver: "external-system-ui",
    browser_driver_started: false, provider, run_ref: "native-b33-run", ready_at: "2026-11-22T01:00:00Z",
  });
  const runtime = {
    schema: "b87-r01-runtime-facts/v1", mix_env: "test",
    provider: { selected: provider, model: "local/Q4-PLE4", endpoint: "http://127.0.0.1:8000/v1" },
    context_pressure: { provider, window: 262144, maintenance_ratio: 0.70 },
    auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false,
  };
  write("runtime-facts.json", runtime);
  const endpoint = provider === "splash" ? runtime.provider.endpoint : "http://127.0.0.1:47831/v1";
  const model = provider === "splash" ? runtime.provider.model : "selected-model";
  const proxyDir = path.join(dir, "proxy-01");
  fs.mkdirSync(proxyDir);
  write("proxy-01/provider-stream-ready.json", {
    mode: "observe", pid: 12345, endpoint, upstream_endpoint: "http://127.0.0.1:7999/v1",
    max_upstream_requests: 128, upstream_requests_admitted: 0, budget_requests_rejected: 0,
  });
  const preregistration = path.join(dir, "preregistration.json");
  write("preregistration.json", {
    provider, runtime: { provider, model }, artifact_dir: dir, proxy_dir: proxyDir,
    upstream_endpoint: "http://127.0.0.1:7999/v1",
    scenarios: FROZEN_B33_SCENARIOS.map((scenario) => ({
      ...scenario, input_sha256: createHash("sha256").update(scenario.input).digest("hex"),
    })),
    budget: { max_author_inputs: 6, max_harness_retries: 0, max_manual_retries: 0,
      turn_timeout_ms: 330000, ack_timeout_ms: 60000, max_upstream_requests: 128 },
  });
  return { dir, runtime, write, env: { B33_NATIVE_PREREGISTRATION: preregistration },
    config: () => JSON.parse(fs.readFileSync(path.join(dir, "native-b33-config.json"))) };
}

test("B33 prepares current Splash from observed runtime before any author input", async (t) => {
  const fixture = providerFixture(t);
  await prepare(fixture.dir, { env: fixture.env });
  const config = fixture.config();
  assert.equal(config.provider, "splash");
  assert.equal(config.model, "local/Q4-PLE4");
  assert.equal(config.runtime.profile, "b87-r01-controlled-splash-high");
  assert.deepEqual(config.scenarios.map(({ id, input }) => [id, input]), [
    ["S1", "帮我修改第03章正文中的错别字；如果没有错别字，就告诉我无需修改。"],
    ["S2", "解释一下第03章为什么采用全书连续编号，只解释，不要修改。"],
    ["S3", "讨论一下把陆晨指定为主角是否合理，先不要生成候选。"],
    ["S6", "只聊第03章结尾怎么处理，先别动笔。"],
    ["S5", "把全书章节编号理顺，只改列表编号，内容不要动。"],
    ["S4", "第07章的正文还没写，帮我写出来吧。"],
  ]);
  assert.equal(config.budget.max_harness_retries, 0);
  assert.equal(config.budget.max_author_inputs, 6);
});

test("B33 rejects a Splash runtime that actually selected another provider", async (t) => {
  const fixture = providerFixture(t);
  fixture.runtime.provider.selected = "strata";
  fixture.write("runtime-facts.json", fixture.runtime);
  await assert.rejects(prepare(fixture.dir, { env: {} }), /runtime facts provider.selected/);
  assert.equal(fs.existsSync(path.join(fixture.dir, "native-b33-config.json")), false);
});

test("B33 refuses missing runtime and does not infer a historical Strata model", async (t) => {
  const splash = providerFixture(t);
  fs.unlinkSync(path.join(splash.dir, "runtime-facts.json"));
  await assert.rejects(prepare(splash.dir, { env: {} }), /runtime-facts.json/);
  const strata = providerFixture(t, "strata");
  await assert.rejects(prepare(strata.dir, { env: {} }), /必须明确本批模型/);
  await prepare(strata.dir, { env: { ...strata.env, NOVEL_STRATA_MODEL: "selected-model" } });
  assert.equal(strata.config().model, "selected-model");
  assert.equal(strata.config().runtime, null);
});

function providerProof(provider = "splash") {
  const model = provider === "splash" ? "local/Q4-PLE4" : "selected-model";
  const endpoint = "http://127.0.0.1:8000/v1";
  const budget = { max_author_inputs: 6, max_harness_retries: 0, turn_timeout_ms: 330000, ack_timeout_ms: 60000 };
  const runtimeFacts = {
    schema: "b87-r01-runtime-facts/v1", mix_env: "test", provider: { selected: provider, model, endpoint },
    context_pressure: { provider, window: 262144, maintenance_ratio: 0.70 },
    auto_maintenance: { enabled: true, keep_recent_items: 4 }, sync_summary_maintenance: false,
  };
  return {
    config: { provider, model, endpoint, budget, runtime: provider === "splash" ? {
      profile: "b87-r01-controlled-splash-high", observed: structuredClone(runtimeFacts),
    } : null },
    ready: { provider }, driverLog: { provider, model, endpoint, budget: structuredClone(budget) },
    providerStarts: [{ provider }], runtimeFacts,
    scenarioScopes: [{
      runId: "run-current", turnId: "turn-current", workspaceId: "workspace-current",
      workId: "work-current", sessionId: "session-current",
    }],
    providerRuns: [{
      id: "prun-current", provider_call_ref: "pcall-current", provider_id: provider, model,
      agent_run_id: "run-current", parent_turn_ref: "turn-current", workspace_id: "workspace-current",
      work_id: "work-current", session_id: "session-current", status: "completed", purpose: "author_reasoning",
    }],
    llmRecords: [{ provider, provider_call_ref: "pcall-current", provider_run_ref: "prun-current",
      work_id: "work-current", session_id: "session-current", turn_id: "turn-current:agent:1",
      request: { url: `${endpoint}/chat/completions`, body: { model, reasoning_effort: "high", max_tokens: 32000,
        messages: [{ role: "user", content: "只解释，不要修改。" }] } },
      response: { status: 200, body: { source: "sse_decoder", tool_calls: [] } } }],
  };
}

for (const provider of ["splash", "strata"]) {
  test(`B33 binds ${provider} to actual native request identity`, () => {
    assert(Object.values(providerEvidenceChecks(providerProof(provider))).every(Boolean));
  });
}

for (const [name, mutate, check] of [
  ["wrong ready provider", (proof) => { proof.ready.provider = "strata"; }, "provider_identity_matches"],
  ["wrong driver model", (proof) => { proof.driverLog.model = "different-model"; }, "provider_identity_matches"],
  ["wrong driver endpoint", (proof) => { proof.driverLog.endpoint = "http://other/v1"; }, "provider_identity_matches"],
  ["mixed provider starts", (proof) => { proof.providerStarts.push({ provider: "strata" }); }, "provider_starts_match"],
  ["empty calls", (proof) => { proof.llmRecords = []; }, "provider_requests_match"],
  ["wrong actual model", (proof) => { proof.llmRecords[0].request.body.model = "different-model"; }, "provider_requests_match"],
  ["missing native body", (proof) => { delete proof.llmRecords[0].request.body; }, "provider_requests_match"],
  ["fixture disguised as a real call", (proof) => { proof.llmRecords[0].request_format = "authoring-request-ir/v1"; }, "provider_requests_match"],
  ["missing call identity", (proof) => { delete proof.llmRecords[0].provider_call_ref; }, "provider_requests_match"],
  ["duplicate execution identity", (proof) => { proof.llmRecords.push(structuredClone(proof.llmRecords[0])); }, "provider_call_identities_unique"],
  ["missing runtime", (proof) => { proof.runtimeFacts = null; }, "runtime_facts_match"],
  ["changed runtime model", (proof) => { proof.runtimeFacts.provider.model = "another-model"; }, "runtime_facts_match"],
  ["wrong actual effort", (proof) => { proof.llmRecords[0].request.body.reasoning_effort = "low"; }, "provider_request_settings_match"],
  ["unbound compaction output limit", (proof) => { proof.llmRecords[0].request.body.max_tokens = 8192; }, "provider_request_settings_match"],
  ["additional harness retry", (proof) => { proof.driverLog.budget.max_harness_retries = 1; }, "execution_budget_matches"],
]) {
  test(`B33 rejects ${name}`, () => {
    const proof = providerProof();
    mutate(proof);
    assert.equal(providerEvidenceChecks(proof)[check], false);
  });
}

for (const [name, mutate] of [
  ["missing persisted execution", (proof) => { proof.providerRuns = []; }],
  ["wrong persisted provider", (proof) => { proof.providerRuns[0].provider_id = "strata"; }],
  ["wrong persisted model", (proof) => { proof.providerRuns[0].model = "different-model"; }],
  ["foreign persisted run", (proof) => { proof.providerRuns[0].agent_run_id = "run-other"; }],
  ["foreign persisted parent", (proof) => { proof.providerRuns[0].parent_turn_ref = "turn-other"; }],
  ["foreign persisted workspace", (proof) => { proof.providerRuns[0].workspace_id = "workspace-other"; }],
  ["foreign persisted work", (proof) => { proof.providerRuns[0].work_id = "work-other"; }],
  ["foreign persisted session", (proof) => { proof.providerRuns[0].session_id = "session-other"; }],
  ["wrong persisted call reference", (proof) => { proof.providerRuns[0].provider_call_ref = "pcall-other"; }],
  ["wrong persisted run reference", (proof) => { proof.providerRuns[0].id = "prun-other"; }],
  ["duplicate persisted execution", (proof) => { proof.providerRuns.push(structuredClone(proof.providerRuns[0])); }],
  ["duplicate persisted pcall", (proof) => { proof.providerRuns.push({ ...proof.providerRuns[0], id: "prun-other" }); }],
  ["duplicate persisted prun", (proof) => { proof.providerRuns.push({ ...proof.providerRuns[0], provider_call_ref: "pcall-other" }); }],
  ["unlogged persisted call", (proof) => { proof.providerRuns.push({ ...proof.providerRuns[0], id: "prun-other", provider_call_ref: "pcall-other" }); }],
  ["missing observed scenario identity", (proof) => { proof.scenarioScopes = []; }],
  ["foreign logged work", (proof) => { proof.llmRecords[0].work_id = "work-other"; }],
  ["foreign logged session", (proof) => { proof.llmRecords[0].session_id = "session-other"; }],
  ["foreign logged workspace", (proof) => { proof.llmRecords[0].workspace_id = "workspace-other"; }],
  ["foreign logged turn", (proof) => { proof.llmRecords[0].turn_id = "turn-other:agent:1"; }],
  ["missing logged work", (proof) => { delete proof.llmRecords[0].work_id; }],
  ["missing logged session", (proof) => { delete proof.llmRecords[0].session_id; }],
  ["missing logged turn", (proof) => { delete proof.llmRecords[0].turn_id; }],
  ["missing request URL", (proof) => { delete proof.llmRecords[0].request.url; }],
  ["wrong request host", (proof) => { proof.llmRecords[0].request.url = "http://other:8000/v1/chat/completions"; }],
  ["wrong request port", (proof) => { proof.llmRecords[0].request.url = "http://127.0.0.1:8001/v1/chat/completions"; }],
  ["wrong request route", (proof) => { proof.llmRecords[0].request.url = "http://127.0.0.1:8000/v1/responses"; }],
  ["config and calls drifted from runtime model", (proof) => {
    proof.config.model = proof.driverLog.model = proof.providerRuns[0].model =
      proof.llmRecords[0].request.body.model = "different-model";
  }],
  ["config and calls drifted from runtime endpoint", (proof) => {
    proof.config.endpoint = proof.driverLog.endpoint = "http://127.0.0.1:8001/v1";
    proof.llmRecords[0].request.url = "http://127.0.0.1:8001/v1/chat/completions";
  }],
]) {
  test(`B33 fails closed for ${name}`, () => {
    const proof = providerProof();
    mutate(proof);
    assert.equal(Object.values(providerEvidenceChecks(proof)).every(Boolean), false);
  });
}

for (const status of ["initialized", "running", "cancel_requested"]) {
  test(`B33 rejects persisted nonterminal ${status} despite HTTP 200`, () => {
    const proof = providerProof();
    proof.providerRuns[0].status = status;
    assert.equal(Object.values(providerEvidenceChecks(proof)).every(Boolean), false);
  });
}

test("B33 preserves recovered failed and cancelled calls as terminal facts", () => {
  const proof = providerProof();
  for (const status of ["failed", "cancelled"]) {
    proof.providerRuns.push({ ...proof.providerRuns[0], id: `prun-${status}`, provider_call_ref: `pcall-${status}`, status });
    proof.llmRecords.push({ ...structuredClone(proof.llmRecords[0]), provider_run_ref: `prun-${status}`,
      provider_call_ref: `pcall-${status}`, response: { status: 0, body: { source: "event_stream" } } });
  }
  assert(Object.values(providerEvidenceChecks(proof)).every(Boolean));
  proof.providerRuns[0].status = "failed";
  assert.equal(Object.values(providerEvidenceChecks(proof)).every(Boolean), false);
});

test("B33 accepts the observed local proxy endpoint and provider trailing slash semantics", () => {
  const proof = providerProof();
  const endpoint = "http://127.0.0.1:54321/v1/";
  proof.config.endpoint = proof.driverLog.endpoint = proof.runtimeFacts.provider.endpoint =
    proof.config.runtime.observed.provider.endpoint = endpoint;
  proof.llmRecords[0].request.url = "http://127.0.0.1:54321/v1/chat/completions";
  assert(Object.values(providerEvidenceChecks(proof)).every(Boolean));
});

test("B33 accepts compaction output budget only for the matching persisted operation and scope", () => {
  const proof = providerProof();
  const row = { ...proof.providerRuns[0], id: "prun-compaction", provider_call_ref: "pcall-compaction",
    purpose: "other", owner_refs: { operation: "transcript_compaction" } };
  const record = { ...structuredClone(proof.llmRecords[0]),
    provider_run_ref: row.id, provider_call_ref: row.provider_call_ref };
  record.request.body.max_tokens = 8192;
  proof.providerRuns.push(row);
  proof.llmRecords.push(record);
  assert(Object.values(providerEvidenceChecks(proof)).every(Boolean));
  for (const [field, value] of [
    ["provider_call_ref", "pcall-unrelated"], ["agent_run_id", "run-unrelated"], ["purpose", "writer"],
  ]) {
    const invalid = structuredClone(proof);
    invalid.providerRuns[1][field] = value;
    assert.equal(providerEvidenceChecks(invalid).provider_request_settings_match, false, field);
  }
});

test("B33 observes externally owned Splash without any lifecycle request", async () => {
  const config = providerProof().config;
  const observation = await observeExternalModelService(config, {
    readState: async () => { throw new Error("external lifecycle must not be called"); },
  });
  assert.equal(observation.status, "not_observed");
  assert.equal(observation.lifecycle_action, "none");
  assert.equal(observation.read_only, true);
  assert.equal(Object.hasOwn(observation, "unloaded"), false);
});

test("B33 preserves unavailable Strata observations without inferring successful unload", async () => {
  const config = { ...providerProof("strata").config, endpoint: "http://127.0.0.1:47831/v1" };
  let reads = 0;
  const observation = await observeExternalModelService(config, {
    readState: async ({ endpoint }) => {
      reads += 1;
      assert.equal(endpoint, "http://127.0.0.1:47831");
      return { models_ok: false, api_ok: false, loaded: null, error: "unreachable" };
    },
  });
  assert.equal(reads, 1);
  assert.equal(observation.status, "unavailable");
  assert.equal(observation.state.error, "unreachable");
  assert.equal(observation.lifecycle_action, "none");
  assert.equal(Object.hasOwn(observation, "unloaded"), false);
});

const SUMMARY_CHAPTER = "77777777-7777-4777-8777-777777777777";
const SUMMARY_SOURCE = "灯楼夜账翻到第七页，顾青挑亮灯芯。";
const SUMMARY_TEXT = "【情节推进】顾青翻看夜账。\n【人物状态与弧光】顾青保持警觉。\n【伏笔动作】（无）\n【情绪基调】安静而紧张。";
const streamSha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function rawSummaryStream(text, id = "chat-summary") {
  return Buffer.from([
    "data: " + JSON.stringify({ id, model: "local/Q4-PLE4",
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] }),
    "data: " + JSON.stringify({ id, model: "local/Q4-PLE4",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    "data: [DONE]",
    "",
  ].join("\n\n"));
}

// Original proxy event/file shapes. Bytes and expected summary below are handwritten fixture facts.
function summaryTransport(proof, rawAux = rawSummaryStream(SUMMARY_TEXT), {
  status = 200, rawPrimary = rawSummaryStream("已说明当前编号。", "chat-author"), windows = {},
} = {}) {
  const bytes = new Map();
  const events = [];
  const stream = {
    directory: proof.config.preregistration.proxy_dir,
    ready: { mode: "observe", pid: 12345, endpoint: proof.config.endpoint,
      upstream_endpoint: "http://127.0.0.1:7999/v1", max_upstream_requests: 128,
      upstream_requests_admitted: 0, budget_requests_rejected: 0 },
    events,
    readBytes(name) {
      assert(bytes.has(name), "Missing original proxy file: " + name);
      return bytes.get(name);
    },
  };
  proof.providerStream = stream;
  proof.transportBytes = bytes;
  const capture = (id, request, response, method, requestPath, responseStatus, contentType) => {
    const admitted = events.filter((e) => e.event === "upstream_request_forwarded").length;
    const window = windows[id] ?? { requested_at: "2026-11-23T01:00:02.000Z", completed_at: "2026-11-23T01:00:02.000Z" };
    const emit = (event, fields = {}) => events.push({
      sequence: events.length + 1,
      at: ["upstream_end", "transparent_complete"].includes(event) ? window.completed_at : window.requested_at,
      event,
      request_id: id, max_upstream_requests: 128, upstream_requests_admitted: admitted + 1,
      budget_requests_rejected: 0, ...fields,
    });
    bytes.set(id + ".bin", request);
    bytes.set(id + ".received.bin", response);
    bytes.set(id + ".delivered.bin", Buffer.from(response));
    emit("request_registered", { method, path: requestPath, request_sha256: streamSha(request),
      upstream_admitted: false, forwarded: false, upstream_requests_admitted: admitted });
    emit("upstream_request_forwarded", { upstream_admitted: true, forwarded: true });
    emit("response_headers", { response_status: responseStatus, content_type: contentType,
      response_encoding: "identity" });
    emit("upstream_end");
    emit("transparent_complete", { response_complete: true, received_bytes: response.length,
      delivered_bytes: response.length, received_sha256: streamSha(response), delivered_sha256: streamSha(response) });
  };
  capture("request-1", Buffer.from(JSON.stringify(proof.llmRecords[0].request.body)),
    rawPrimary, "POST", "/v1/chat/completions", 200, "text/event-stream");
  capture("request-2", Buffer.from(JSON.stringify(proof.llmRecords[1].request.body)),
    rawAux, "POST", "/v1/chat/completions", status, status === 200 ? "text/event-stream" : "application/json");
  proof.addObservedGet = (id) => capture(id, Buffer.alloc(0), Buffer.from('{"data":[]}'),
    "GET", "/v1/models", 200, "application/json");
  proof.addObservedGet("request-3");
}

function summaryProviderProof() {
  const proof = providerProof();
  proof.config.target = { work_id: "work-current", session_id: "session-current" };
  proof.config.preregistration = {
    path: "/frozen/b33/preregistration.json", sha256: "a".repeat(64),
    proxy_dir: "/frozen/b33/proxy-01", max_upstream_requests: 128,
  };
  proof.llmRecords[0].request.method = "POST";
  proof.llmRecords[0].request.body.stream = true;
  proof.llmRecords.push({
    provider: "splash", provider_call_ref: "pcall-summary", provider_run_ref: "prun-summary",
    step: "chapter_summary", turn_id: "unknown", ts: "2026-11-23T01:00:02.000Z",
    request: { method: "POST", url: proof.config.endpoint + "/chat/completions",
      refs: { base_refs: ["summary_repair:" + SUMMARY_CHAPTER, "chapter:" + SUMMARY_CHAPTER],
        observation_refs: [], used_refs: [] },
      body: { model: proof.config.model, reasoning_effort: "high", max_tokens: 32000, stream: true,
        messages: [
          { role: "system", content: "本轮任务：章节摘要。目标章 ref：chapter:" + SUMMARY_CHAPTER +
            "\n严格按【情节推进】【人物状态与弧光】【伏笔动作】【情绪基调】四栏纯文本输出。" },
          { role: "user", content: "【应用数据 · application_base · 非作者原话】\n## 本次材料正文\n已采纳正文：\n" + SUMMARY_SOURCE },
        ] } },
    response: { status: 200, body: { source: "sse_decoder", tool_calls: [] } },
  });
  proof.providerStarts.push({ provider: "splash" });
  proof.appRecords = [{ event: "chapter_summary_maintenance.run.done", outcome: "ok",
    timestamp: "2026-11-23T01:00:03.000Z",
    work_id: "work-current", chapter_id: SUMMARY_CHAPTER, status: "ACCEPTED", four_column: true }];
  const initial = {
    at: "2026-11-23T01:00:00.000Z",
    chapters: [{ chapter_id: SUMMARY_CHAPTER, work_id: "work-current", seq: 1, title: "第01章：灯楼夜账", status: "DRAFTING" }],
    chapter_content_sha: { [SUMMARY_CHAPTER]: streamSha(Buffer.from(SUMMARY_SOURCE)) },
    scope_rows: {
      scenes: [{ id: "scene-summary", chapter_id: SUMMARY_CHAPTER, seq: 1 }],
      drafts: [{ id: "draft-summary", work_id: "work-current", scene_id: "scene-summary",
        status: "ACCEPTED", revision: 2, content: SUMMARY_SOURCE }],
      chapter_summaries: [],
    },
  };
  const final = structuredClone(initial);
  final.at = "2026-11-23T01:00:04.000Z";
  final.scope_rows.chapter_summaries.push({ id: "summary-new", work_id: "work-current",
    chapter_id: SUMMARY_CHAPTER, source_ref: "summary_repair:" + SUMMARY_CHAPTER,
    status: "ACCEPTED", summary_text: SUMMARY_TEXT, revision_base: null,
    inserted_at: "2026-11-23T01:00:03.000000Z", updated_at: "2026-11-23T01:00:03.000000Z" });
  proof.snapshots = { start: initial, final };
  summaryTransport(proof);
  return proof;
}

function summaryEvidencePasses(proof) {
  try { return Object.values(providerEvidenceChecks(proof)).every(Boolean); }
  catch { return false; }
}

test("B33 binds one real author ProviderRun and one source-backed summary without inventing an AgentRun", () => {
  const proof = summaryProviderProof();
  const checks = providerEvidenceChecks(proof);
  assert(Object.values(checks).every(Boolean), JSON.stringify(checks));
  assert.equal(proof.llmRecords.length, 2);
  assert.equal(proof.providerRuns.length, 1);
  assert.equal(proof.providerStream.events.filter((e) => e.event === "request_registered").length, 3);
  assert.equal(Object.hasOwn(proof.llmRecords[1], "agent_run_id"), false);
});

test("B33 raw summary accepts producer-supported CRLF, trailing LF and per-column trim", () => {
  const proof = summaryProviderProof();
  const raw = "【情节推进】  顾青翻看夜账。  \r\n【人物状态与弧光】 顾青保持警觉。\r\n" +
    "【伏笔动作】 （无） \r\n【情绪基调】 安静而紧张。 \r\n";
  summaryTransport(proof, rawSummaryStream(raw));
  assert.equal(proof.snapshots.final.scope_rows.chapter_summaries[0].summary_text, SUMMARY_TEXT);
  assert.equal(summaryEvidencePasses(proof), true);
});

for (const kind of ["provider-failed", "degraded"]) {
  test("B33 accounts for a proven " + kind + " auxiliary outcome without an accepted result", () => {
    const proof = summaryProviderProof();
    proof.appRecords = [{ event: "chapter_summary_maintenance.run.error", outcome: "error",
      timestamp: "2026-11-23T01:00:03.000Z",
      work_id: "work-current", chapter_id: SUMMARY_CHAPTER, reason_code: "generation_failed",
      outcome_detail: kind === "provider-failed" ? "%{type: :provider_error, status: 503}" : ":summary_sections_unparseable" }];
    const old = { ...proof.snapshots.final.scope_rows.chapter_summaries[0], id: "summary-old",
      inserted_at: "2026-11-22T01:00:00.000000Z", updated_at: "2026-11-22T01:00:00.000000Z",
      summary_text: "【情节推进】旧事件。\n【人物状态与弧光】（无）\n【伏笔动作】（无）\n【情绪基调】平静。" };
    proof.snapshots.start.scope_rows.chapter_summaries = [structuredClone(old)];
    proof.snapshots.final.scope_rows.chapter_summaries = [structuredClone(old)];
    if (kind === "provider-failed") {
      proof.llmRecords[1].response = { status: 503, body: "event_stream" };
      summaryTransport(proof, Buffer.from('{"error":{"message":"temporarily unavailable"}}'), { status: 503 });
    } else {
      summaryTransport(proof, rawSummaryStream("摘要暂不可用。"));
    }
    assert.equal(summaryEvidencePasses(proof), true);
    assert.deepEqual(proof.snapshots.final.scope_rows.chapter_summaries, proof.snapshots.start.scope_rows.chapter_summaries);
    assert.equal(proof.providerStream.events.filter((e) => e.event === "upstream_request_forwarded").length, 3);
  });
}

for (const [name, change] of [
  ["an unknown auxiliary role", (p) => { p.llmRecords[1].step = "unknown_task"; }],
  ["summary_repair text without the real chapter source ref", (p) => { p.llmRecords[1].request.refs.base_refs.pop(); }],
  ["a chapter ref for a different target", (p) => { p.llmRecords[1].request.refs.base_refs[1] = "chapter:other"; }],
  ["a source draft from another work", (p) => { p.snapshots.final.scope_rows.drafts[0].work_id = "work-other"; }],
  ["a candidate draft presented as accepted source", (p) => { p.snapshots.final.scope_rows.drafts[0].status = "TENTATIVE"; }],
  ["a result from another work", (p) => { p.snapshots.final.scope_rows.chapter_summaries[0].work_id = "work-other"; }],
  ["a result from another chapter", (p) => { p.snapshots.final.scope_rows.chapter_summaries[0].chapter_id = "chapter-other"; }],
  ["a summary source not bound to this operation", (p) => { p.snapshots.final.scope_rows.chapter_summaries[0].source_ref = "manual:elsewhere"; }],
  ["a missing business outcome", (p) => { p.appRecords = []; }],
  ["duplicate business outcomes", (p) => { p.appRecords.push(structuredClone(p.appRecords[0])); }],
  ["an outcome from another work", (p) => { p.appRecords[0].work_id = "work-other"; }],
  ["an outcome from another chapter", (p) => { p.appRecords[0].chapter_id = "chapter-other"; }],
  ["an old row presented as this call's result", (p) => {
    p.snapshots.start.scope_rows.chapter_summaries = structuredClone(p.snapshots.final.scope_rows.chapter_summaries);
  }],
  ["a changed raw-to-persisted summary", (p) => { p.snapshots.final.scope_rows.chapter_summaries[0].summary_text += "补写。"; }],
  ["a degraded call falsely presented as accepted", (p) => {
    p.appRecords[0] = { event: "chapter_summary_maintenance.run.error", outcome: "error",
      timestamp: "2026-11-23T01:00:03.000Z",
      work_id: "work-current", chapter_id: SUMMARY_CHAPTER, reason_code: "generation_failed",
      outcome_detail: ":summary_sections_unparseable" };
  }],
  ["a failed provider falsely presented as accepted", (p) => {
    p.llmRecords[1].response = { status: 503, body: "event_stream" };
    summaryTransport(p, Buffer.from('{"error":{"message":"unavailable"}}'), { status: 503 });
  }],
  ["a manufactured author ProviderRun for the independent summary", (p) => {
    p.providerRuns.push({ ...structuredClone(p.providerRuns[0]), id: "prun-summary", provider_call_ref: "pcall-summary" });
  }],
  ["duplicate pcall even with separate prun", (p) => { p.llmRecords[1].provider_call_ref = "pcall-current"; }],
  ["duplicate prun even with separate pcall", (p) => { p.llmRecords[1].provider_run_ref = "prun-current"; }],
  ["an unregistered observation directory", (p) => { p.providerStream.directory = "/another/proxy"; }],
  ["request bytes absent from the original observation", (p) => { p.transportBytes.delete("request-2.bin"); }],
  ["received bytes absent from the original observation", (p) => { p.transportBytes.delete("request-2.received.bin"); }],
  ["delivered bytes absent from the original observation", (p) => { p.transportBytes.delete("request-2.delivered.bin"); }],
  ["an observation of another runtime endpoint", (p) => { p.providerStream.ready.endpoint = "http://127.0.0.1:9999/v1"; }],
  ["a mutated body behind an unchanged request seal", (p) => {
    p.transportBytes.set("request-2.bin", Buffer.from('{"messages":[]}'));
  }],
  ["an unobserved POST omitted from the HTTP denominator", (p) => {
    p.providerStream.events = p.providerStream.events.filter((e) => e.request_id !== "request-2");
  }],
]) {
  test("B33 auxiliary evidence rejects " + name, () => {
    const proof = summaryProviderProof();
    change(proof);
    assert.equal(summaryEvidencePasses(proof), false);
  });
}

test("B33 binds the actual accepted source bytes, even when modified requests have valid raw hashes", () => {
  const proof = summaryProviderProof();
  proof.llmRecords[1].request.body.messages[1].content += "这是未采纳的新增句。";
  summaryTransport(proof);
  assert.equal(summaryEvidencePasses(proof), false);
});

test("B33 rejects incomplete SSE even if the observation claims a complete matching byte seal", () => {
  for (const raw of [
    Buffer.from('data: {"choices":[{"index":0,"delta":{"content":"未结束"}}]}\n\n'),
    Buffer.from("data: {broken-json}\n\ndata: [DONE]\n\n"),
  ]) {
    const proof = summaryProviderProof();
    summaryTransport(proof, raw);
    assert.equal(summaryEvidencePasses(proof), false);
  }
});

test("B33 HTTP budget counts all observed author, auxiliary and GET requests", () => {
  const proof = summaryProviderProof();
  for (let index = 4; index <= 129; index += 1) proof.addObservedGet("request-" + index);
  assert.equal(proof.llmRecords.length, 2);
  assert.equal(proof.providerStream.events.filter((e) => e.event === "request_registered").length, 129);
  assert.equal(summaryEvidencePasses(proof), false);
});
const S4_SOURCE_TURN = "turn-current:agent:2";
const S4_PROSE = "顾青停在门边，等铜铃第二次响起。\n\n她把账册翻到第七页，露出夹在纸缝里的旧票。";
const S4_REVISION = "draft:draft-s4:1";
const S4_OLD_CHAPTER = "66666666-6666-4666-8666-666666666666";

function adoptionSummaryTransport(proof) {
  summaryTransport(proof, rawSummaryStream(SUMMARY_TEXT), {
    rawPrimary: rawSummaryStream(S4_PROSE, "chat-s4-author"),
    windows: {
      "request-1": { requested_at: "2026-11-23T01:00:01.100Z", completed_at: "2026-11-23T01:00:01.600Z" },
      "request-2": { requested_at: "2026-11-23T01:00:02.100Z", completed_at: "2026-11-23T01:00:02.800Z" },
      "request-3": { requested_at: "2026-11-23T01:00:03.500Z", completed_at: "2026-11-23T01:00:03.500Z" },
    },
  });
}

// Handwritten S4 facts use the existing wire and checkpoint formats. The fixture does not run an agent
// or turn a driver claim into an adoption: source/result rows, request ACK and stored receipt are separate.
function adoptionSummaryProviderProof({ auxiliaryBeforeAck = false } = {}) {
  const proof = summaryProviderProof();
  const scope = proof.scenarioScopes[0];
  Object.assign(scope, {
    workspaceId: "22222222-2222-4222-8222-222222222222",
    workId: "11111111-1111-4111-8111-111111111111",
    sessionId: "33333333-3333-4333-8333-333333333333",
  });
  Object.assign(proof.config.target, { work_id: scope.workId, session_id: scope.sessionId });
  Object.assign(proof.providerRuns[0], {
    workspace_id: scope.workspaceId, work_id: scope.workId, session_id: scope.sessionId,
  });
  Object.assign(proof.llmRecords[0], { work_id: scope.workId, session_id: scope.sessionId });
  proof.appRecords[0].work_id = scope.workId;
  scope.topic = "workspace:" + scope.workspaceId;
  scope.since = "2026-11-23T01:00:01.000Z";
  proof.config.scenarios = structuredClone(FROZEN_B33_SCENARIOS);
  const artifact = {
    artifact_id: "as-s4-prose", artifact_type: "prose_fragment", adoption_status: "TENTATIVE",
    requires_adoption: true, source_tool_result_ref: "tr-s4-writer",
    target_chapter: "第07章：空章待写", target_chapter_ref: "chapter:" + SUMMARY_CHAPTER,
    payload: { title: "门边的铜铃", item_count: 2, adoption_effect: { mode: "append" }, items: [
      { item_id: "s4-item-1", title: "等铃", body: "顾青停在门边，等铜铃第二次响起。" },
      { item_id: "s4-item-2", title: "旧票", body: "她把账册翻到第七页，露出夹在纸缝里的旧票。" },
    ] },
  };
  const action = { action_id: "accept:as-s4-prose", action_type: "accept", target_ref: "as-s4-prose",
    source_turn_ref: S4_SOURCE_TURN, idempotency_key: "accept-s4-once", enabled: true };
  const source = {
    turn_id: S4_SOURCE_TURN, workspace_id: scope.workspaceId, work_id: scope.workId, session_id: scope.sessionId,
    status: "conversational", agent_run: { run_id: scope.runId, parent_turn_ref: scope.turnId, status: "running" },
    adoption_state: { pending: [artifact], resolved: [] }, available_actions: [action],
  };
  const mutationId = "99999999-9999-4999-8999-999999999999";
  const memoryId = "88888888-8888-4888-8888-888888888888";
  const projection = { chapter_id: SUMMARY_CHAPTER, scene_id: "scene-s4", draft_id: "draft-s4",
    source_revision_ref: S4_REVISION, mutation_id: mutationId };
  const receipt = {
    action_id: "adopt:as-s4-prose", action_type: "adopt", artifact_id: "as-s4-prose",
    artifact_type: "prose_fragment", status: "accepted", adoption_effect: { mode: "append" },
    decision: { candidate_ref: "as-s4-prose", decision_type: "adopt_tentative" },
    persistence: { persisted: true, mutation_id: mutationId, mutation_status: "APPLIED",
      source_revision_ref: "mutation:" + mutationId, memory_item_id: memoryId, memory_status: "CONFIRMED",
      adoption_effect: { mode: "append" }, reading_projection: projection },
  };
  const resolved = { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type,
    adoption_status: "ACCEPTED", requires_adoption: false, source_artifact_ref: artifact.artifact_id,
    adopted_state_ref: "adopted:as-s4-prose", mutation_ref: mutationId, payload: structuredClone(artifact.payload) };
  const actionResult = {
    turn_id: "turn-adopt-s4", parent_turn_id: S4_SOURCE_TURN, workspace_id: scope.workspaceId,
    work_id: scope.workId, session_id: scope.sessionId, phase: "completed", status: "conversational",
    adoption_state: { pending: [], resolved: [resolved] },
  };
  const sendBody = { work_id: scope.workId, session_id: scope.sessionId, action };
  const ackBody = { status: "ok", response: { received: true, action_status: "accepted" } };
  const ackAt = auxiliaryBeforeAck ? "2026-11-23T01:00:02.900Z" : "2026-11-23T01:00:02.050Z";
  const received = (at, event, body) => ({ at, direction: "received", frame: [null, null, scope.topic, event, body] });
  proof.wire = [
    { at: scope.since, direction: "sent", frame: ["join-s4", "author-s4", scope.topic, "user_message", {
      turn_id: scope.turnId, work_id: scope.workId, session_id: scope.sessionId,
      text: "第07章的正文还没写，帮我写出来吧。",
    }] },
    { at: "2026-11-23T01:00:01.050Z", direction: "received",
      frame: ["join-s4", "author-s4", scope.topic, "phx_reply",
        { status: "ok", response: { received: true, turn_id: scope.turnId, run_id: scope.runId } }] },
    received("2026-11-23T01:00:01.700Z", "turn_result", source),
    received("2026-11-23T01:00:01.800Z", "agent_run_state", {
      status: "completed", run_id: scope.runId, parent_turn_ref: scope.turnId,
      workspace_id: scope.workspaceId, work_id: scope.workId, session_id: scope.sessionId,
      pending_artifact_refs: [artifact.artifact_id],
    }),
    { at: "2026-11-23T01:00:02.000Z", direction: "sent",
      frame: ["join-s4", "accept-s4", scope.topic, "author_action", sendBody] },
    { at: ackAt, direction: "received", frame: ["join-s4", "accept-s4", scope.topic, "phx_reply", ackBody] },
    received(ackAt, "action_result", receipt),
    received(ackAt, "turn_result", actionResult),
  ];
  proof.driverLog.scenarios = [{
    id: "S4", turn_id: scope.turnId, final_kind: "turn_result", questions: 0,
    adoption: { artifact_id: artifact.artifact_id, button: "保存为章节正文",
      clicked_at: "2026-11-23T01:00:01.900Z",
      send: structuredClone(sendBody), ack: structuredClone(ackBody), receipt: structuredClone(receipt) },
  }];
  const storedTurn = (body) => Object.fromEntries(Object.entries(structuredClone(body))
    .filter(([key]) => !["workspace_id", "work_id", "session_id"].includes(key)));
  const sourceRow = { id: "interaction-s4-source", role: "assistant", workspace_id: scope.workspaceId,
    session_id: scope.sessionId, turn_id: S4_SOURCE_TURN,
    content: { agent_run_id: scope.runId, turn_result: storedTurn(source) } };
  const actionRow = { id: "interaction-s4-adopt", role: "assistant", workspace_id: scope.workspaceId,
    session_id: scope.sessionId, turn_id: actionResult.turn_id,
    content: { turn_result: storedTurn(actionResult) } };
  const storedReceipt = { id: "receipt-s4", work_id: scope.workId, session_id: scope.sessionId,
    source_turn_ref: S4_SOURCE_TURN, action_id: action.action_id, action_type: "accept",
    idempotency_key: action.idempotency_key, status: "accepted",
    result: { ...structuredClone(receipt), decision: "ACCEPTED", decided_by: "author" } };
  const mutation = { id: mutationId, actor_ref: "author", source_turn_ref: S4_SOURCE_TURN,
    target_scope: "work:" + scope.workId, target_object_ref: artifact.artifact_id,
    proposed_change_ref: artifact.artifact_id, mutation_type: "adopt_artifact", status: "APPLIED",
    authority_scope: "author_confirmed_adoption", requires_adoption: false, base_revision: 1 };
  const memory = { id: memoryId, work_id: scope.workId, source_id: mutationId,
    source_type: "AUTHOR_CONFIRMED", type: "DRAFT_CONTEXT", status: "CONFIRMED",
    summary: artifact.target_chapter, content: S4_PROSE, tags: ["adopted_artifact", "prose_fragment"],
    reference_count: 0, last_referenced_at: null };
  const tables = canonTables();
  tables.works = [{ id: scope.workId }];
  tables.chapters = [
    { id: S4_OLD_CHAPTER, work_id: scope.workId, seq: 1, title: "第01章：灯楼夜账", status: "DRAFTING" },
    { id: SUMMARY_CHAPTER, work_id: scope.workId, seq: 4, title: "第07章：空章待写", status: "PLANNED" },
  ];
  tables.scenes = [{ id: "scene-summary", chapter_id: S4_OLD_CHAPTER, seq: 1 }];
  tables.drafts = [{ id: "draft-summary", work_id: scope.workId, scene_id: "scene-summary",
    revision: 2, status: "ACCEPTED", content: SUMMARY_SOURCE }];
  tables.memory_items = [];
  const snapshot = (rows, at, interactions, mutations, summaries = []) => ({
    at,
    chapters: rows.chapters.map(({ id, work_id, seq, title, status }) =>
      ({ chapter_id: id, work_id, seq, title, status })),
    chapter_content_sha: {
      [S4_OLD_CHAPTER]: streamSha(Buffer.from(SUMMARY_SOURCE)),
      [SUMMARY_CHAPTER]: streamSha(Buffer.from(rows.drafts.some((row) => row.id === "draft-s4") ? S4_PROSE : "")),
    },
    action_receipts: structuredClone(rows.author_action_receipts),
    scope_rows: { drafts: structuredClone(rows.drafts), scenes: structuredClone(rows.scenes),
      memory_items: structuredClone(rows.memory_items), mutations: structuredClone(mutations),
      interactions: structuredClone(interactions), versions: [], chapter_summaries: structuredClone(summaries) },
    authoring_canon: buildAuthoringCanonSnapshot({ tables: rows, referenceLogs: [], at, includeChapterFacts: false }),
  });
  const initialTables = structuredClone(tables);
  initialTables.chapters[1].seq = 7;
  const initial = snapshot(initialTables, "2026-11-23T01:00:00.000Z", [], []);
  const before = snapshot(tables, "2026-11-23T01:00:01.850Z", [sourceRow], []);
  const afterTables = structuredClone(tables);
  afterTables.chapters[1].status = "DRAFTING";
  afterTables.scenes.push({ id: "scene-s4", chapter_id: SUMMARY_CHAPTER, seq: 1, title: "门边的铜铃" });
  afterTables.drafts.push({ id: "draft-s4", work_id: scope.workId, scene_id: "scene-s4",
    revision: 1, status: "ACCEPTED", content: S4_PROSE });
  afterTables.memory_items.push(memory);
  afterTables.author_action_receipts.push(storedReceipt);
  const summary = { id: "summary-s4", work_id: scope.workId, chapter_id: SUMMARY_CHAPTER,
    source_ref: S4_SOURCE_TURN, revision_base: S4_REVISION, status: "ACCEPTED", summary_text: SUMMARY_TEXT,
    inserted_at: "2026-11-23T01:00:03.000000Z", updated_at: "2026-11-23T01:00:03.000000Z" };
  const after = snapshot(afterTables, "2026-11-23T01:00:04.000Z", [sourceRow, actionRow], [mutation], [summary]);
  const final = snapshot(afterTables, "2026-11-23T01:00:04.100Z", [sourceRow, actionRow], [mutation], [summary]);
  proof.snapshots = { start: initial, "S4-before-adoption": before, S4: after, final };
  proof.llmRecords[0].turn_id = S4_SOURCE_TURN;
  proof.llmRecords[0].ts = "2026-11-23T01:00:01.600Z";
  proof.llmRecords[0].request.body.messages[0].content = "第07章的正文还没写，帮我写出来吧。";
  proof.llmRecords[1].ts = "2026-11-23T01:00:02.800Z";
  proof.llmRecords[1].request.refs.base_refs = [S4_SOURCE_TURN, "chapter:" + SUMMARY_CHAPTER];
  proof.llmRecords[1].request.body.messages = [
    { role: "system", content: "本次你承担连续性维护助手的角色。\n本轮任务：章节摘要。\n" +
      "## 对象与范围\n- 目标对象 refs：chapter:" + SUMMARY_CHAPTER + "\n- 对象类型：chapter\n" +
      "- 覆盖范围：单对象/单段\n- 目标章 ref：chapter:" + SUMMARY_CHAPTER +
      "\n## 材料与覆盖\n- chapter_prose：chapter:" + SUMMARY_CHAPTER + "（版本 " + S4_REVISION +
      "；不完整；省略说明：本次材料为单次采纳片段，不是整章已采纳正文）\n" +
      "严格按【情节推进】【人物状态与弧光】【伏笔动作】【情绪基调】四栏纯文本输出。" },
    { role: "user", content: "【应用数据 · application_base · 非作者原话】\n## 本次材料正文\n已采纳正文：\n" + S4_PROSE },
  ];
  proof.appRecords.push({ event: "ledger.update.done", outcome: "ok", timestamp: "2026-11-23T01:00:03.100Z",
    work_id: scope.workId, chapter_id: SUMMARY_CHAPTER });
  adoptionSummaryTransport(proof);
  return proof;
}

function mutateS4After(proof, change) {
  for (const key of ["S4", "final"]) change(proof.snapshots[key]);
}

for (const auxiliaryBeforeAck of [false, true]) {
  test("B33 adoption summary binds the actual S4 fragment and terminal background work, aux before ACK " + auxiliaryBeforeAck, () => {
    const proof = adoptionSummaryProviderProof({ auxiliaryBeforeAck });
    const checks = providerEvidenceChecks(proof);
    assert(Object.values(checks).every(Boolean), JSON.stringify(Object.entries(checks).filter(([, value]) => !value)));
    assert.equal(proof.llmRecords.length, 2);
    assert.equal(proof.providerRuns.length, 1);
    assert.equal(proof.providerStream.events.filter((event) => event.event === "request_registered").length, 3);
    assert.equal(Object.hasOwn(proof.llmRecords[1], "agent_run_id"), false);
    assert.equal(proof.snapshots.S4.scope_rows.chapter_summaries[0].revision_base, S4_REVISION);
    assert.equal(proof.llmRecords[1].request.body.messages[1].content,
      "【应用数据 · application_base · 非作者原话】\n## 本次材料正文\n已采纳正文：\n" + S4_PROSE);
    if (auxiliaryBeforeAck) {
      const requested = proof.providerStream.events.find((event) =>
        event.request_id === "request-2" && event.event === "request_registered");
      const ack = proof.wire.find((record) => record.frame[1] === "accept-s4" && record.frame[3] === "phx_reply");
      assert(requested.at < ack.at);
      assert(proof.llmRecords[1].ts < ack.at);
    }
  });
}

for (const [name, change] of [
  ["the author parent as the auxiliary source instead of the Writer child", (p) => {
    p.llmRecords[1].request.refs.base_refs[0] = "turn-current";
    mutateS4After(p, (snapshot) => { snapshot.scope_rows.chapter_summaries[0].source_ref = "turn-current"; });
  }],
  ["a different chapter in the auxiliary refs", (p) => {
    p.llmRecords[1].request.refs.base_refs[1] = "chapter:" + S4_OLD_CHAPTER;
  }],
  ["a different auxiliary work", (p) => { p.llmRecords[1].work_id = "work-other"; }],
  ["no actual accept send despite the driver's unchanged claim", (p) => {
    p.wire = p.wire.filter((record) => record.frame[3] !== "author_action");
  }],
  ["a stored receipt with a different projection", (p) => {
    mutateS4After(p, (snapshot) => {
      snapshot.action_receipts[0].result.persistence.reading_projection.draft_id = "draft-other";
    });
  }],
  ["the persistent receipt missing", (p) => {
    mutateS4After(p, (snapshot) => { snapshot.action_receipts = []; });
  }],
  ["a wrong summary revision_base", (p) => {
    mutateS4After(p, (snapshot) => { snapshot.scope_rows.chapter_summaries[0].revision_base = "draft:draft-s4:99"; });
  }],
  ["a title prepended to the accepted fragment", (p) => {
    p.llmRecords[1].request.body.messages[1].content =
      p.llmRecords[1].request.body.messages[1].content.replace(S4_PROSE, "门边的铜铃: " + S4_PROSE);
  }],
  ["single LF instead of the actual two-item material bytes", (p) => {
    p.llmRecords[1].request.body.messages[1].content =
      p.llmRecords[1].request.body.messages[1].content.replace(S4_PROSE, S4_PROSE.replace("\n\n", "\n"));
  }],
  ["whole-work prose substituted for this one adoption fragment", (p) => {
    p.llmRecords[1].request.body.messages[1].content += "\n" + SUMMARY_SOURCE;
  }],
  ["no adjacent before-adoption checkpoint", (p) => { delete p.snapshots["S4-before-adoption"]; }],
  ["an auxiliary call beginning before the actual accept", (p) => {
    p.llmRecords[1].ts = "2026-11-23T01:00:01.950Z";
  }],
  ["no summary business terminal", (p) => {
    p.appRecords = p.appRecords.filter((row) => row.event !== "chapter_summary_maintenance.run.done");
  }],
  ["no ledger business terminal", (p) => {
    p.appRecords = p.appRecords.filter((row) => row.event !== "ledger.update.done");
  }],
  ["a ledger terminal later than the actual final checkpoint", (p) => {
    p.appRecords[1].timestamp = "2026-11-23T01:00:05.000Z";
  }],
]) {
  test("B33 adoption auxiliary evidence rejects " + name, () => {
    const proof = adoptionSummaryProviderProof();
    change(proof);
    adoptionSummaryTransport(proof);
    if (name === "an auxiliary call beginning before the actual accept") {
      for (const event of proof.providerStream.events.filter((row) => row.request_id === "request-2")) {
        event.at = "2026-11-23T01:00:01.950Z";
      }
    }
    assert.equal(summaryEvidencePasses(proof), false);
  });
}

test("B33 raw summary accepts a separate empty-choice usage and metrics frame after stop", () => {
  const proof = summaryProviderProof();
  const usage = "data: " + JSON.stringify({
    id: "chat-summary", object: "chat.completion.chunk", created: 1795437799, model: "local/Q4-PLE4",
    choices: [], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30,
      prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 4 } },
    metrics: { request_latency: 1, prefill: 0.1, decode: 0.9 },
  });
  const raw = rawSummaryStream(SUMMARY_TEXT).toString("utf8").replace("data: [DONE]", usage + "\n\ndata: [DONE]");
  summaryTransport(proof, Buffer.from(raw));
  const checks = providerEvidenceChecks(proof);
  assert(Object.values(checks).every(Boolean), JSON.stringify(checks));
});

test("B33 raw summary rejects new content after the real stop even when final bytes and DONE agree", () => {
  const proof = summaryProviderProof();
  const late = "data: " + JSON.stringify({ id: "chat-summary", model: "local/Q4-PLE4",
    choices: [{ index: 0, delta: { content: "未授权的终结后正文" }, finish_reason: null }] });
  const raw = rawSummaryStream(SUMMARY_TEXT).toString("utf8").replace("data: [DONE]", late + "\n\ndata: [DONE]");
  summaryTransport(proof, Buffer.from(raw));
  assert.equal(summaryEvidencePasses(proof), false);
});

function summaryPersistenceFailureProof() {
  const proof = summaryProviderProof();
  const old = {
    id: "summary-previous", work_id: "work-current", chapter_id: SUMMARY_CHAPTER,
    source_ref: "turn-previous:agent:2", revision_base: "draft:draft-previous:1", status: "ACCEPTED",
    summary_text: "【情节推进】旧事件。\n【人物状态与弧光】（无）\n【伏笔动作】（无）\n【情绪基调】平静。",
    inserted_at: "2026-11-22T01:00:00.000000Z", updated_at: "2026-11-22T01:00:00.000000Z",
  };
  const tentative = { ...proof.snapshots.final.scope_rows.chapter_summaries[0], status: "TENTATIVE" };
  proof.snapshots.start.scope_rows.chapter_summaries = [structuredClone(old)];
  proof.snapshots.final.scope_rows.chapter_summaries = [
    { ...structuredClone(old), status: "SUPERSEDED", updated_at: "2026-11-23T01:00:03.000000Z" }, tentative,
  ];
  proof.appRecords = [{ event: "chapter_summary_maintenance.run.error", outcome: "error",
    timestamp: "2026-11-23T01:00:03.100Z", work_id: "work-current", chapter_id: SUMMARY_CHAPTER,
    reason_code: "persistence_failed", outcome_detail: ":update_status_failed" }];
  return proof;
}

test("B33 persistence-failed summary accounts for lawful supersede and the exact tentative raw result", () => {
  const proof = summaryPersistenceFailureProof();
  const checks = providerEvidenceChecks(proof);
  assert(Object.values(checks).every(Boolean), JSON.stringify(checks));
  const [old, tentative] = proof.snapshots.final.scope_rows.chapter_summaries;
  assert.equal(old.status, "SUPERSEDED");
  assert.equal(old.summary_text, proof.snapshots.start.scope_rows.chapter_summaries[0].summary_text);
  assert.equal(tentative.status, "TENTATIVE");
  assert.equal(tentative.revision_base, null);
  assert.equal(tentative.summary_text, SUMMARY_TEXT);
});

for (const [name, change] of [
  ["deleting the previous accepted row", (rows) => { rows.shift(); }],
  ["rewriting the previous summary body", (rows) => { rows[0].summary_text += "悄悄改写。"; }],
  ["replacing the previous row identity", (rows) => { rows[0].id = "summary-replaced"; }],
  ["changing the previous source ref", (rows) => { rows[0].source_ref = "turn-elsewhere"; }],
  ["a tentative row with text absent from the raw response", (rows) => { rows[1].summary_text += "补写。"; }],
  ["a tentative row with a different revision_base", (rows) => { rows[1].revision_base = "draft:draft-other:9"; }],
  ["a tentative row with another source", (rows) => { rows[1].source_ref = "turn-elsewhere"; }],
]) {
  test("B33 persistence-failed summary rejects " + name, () => {
    const proof = summaryPersistenceFailureProof();
    change(proof.snapshots.final.scope_rows.chapter_summaries);
    assert.equal(summaryEvidencePasses(proof), false);
  });
}
function refreshS4LedgerCanon(proof) {
  for (const snapshot of Object.values(proof.snapshots)) {
    const tables = canonTables();
    tables.works = [{ id: proof.scenarioScopes[0].workId }];
    tables.chapters = snapshot.chapters.map(({ chapter_id, ...fields }) => ({ id: chapter_id, ...fields }));
    for (const table of ["drafts", "scenes", "memory_items", "ledger_entries"]) {
      tables[table] = structuredClone(snapshot.scope_rows[table]);
    }
    tables.author_action_receipts = structuredClone(snapshot.action_receipts);
    snapshot.authoring_canon = buildAuthoringCanonSnapshot({
      tables, referenceLogs: [], at: snapshot.at, includeChapterFacts: false,
    });
  }
}

function adoptionLedgerProof() {
  const proof = adoptionSummaryProviderProof();
  const workId = proof.scenarioScopes[0].workId;
  // These are the actual LedgerEntry schema columns. Old data is a preserved checkpoint fact.
  const old = {
    id: "55555555-5555-4555-8555-555555555555", work_id: workId, ledger: "emotion_curve",
    subject_kind: "chapter", subject_ref: S4_OLD_CHAPTER, subject_label: "第01章：灯楼夜账·情绪",
    design_ref: null, status: "UNPLANNED", payload: { intended: null, realized: "平静。", seq: 1 },
    source_refs: ["chapter_summary:" + S4_OLD_CHAPTER + "@draft:draft-summary:2"],
    last_event_chapter: S4_OLD_CHAPTER, adoption_status: "ACCEPTED", revision: 1,
    inserted_at: "2026-11-22T01:00:00.000000Z", updated_at: "2026-11-22T01:00:00.000000Z",
  };
  // The new mood is handwritten from this fixture's original SUMMARY_TEXT response; no parser builds it.
  const emotion = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", work_id: workId, ledger: "emotion_curve",
    subject_kind: "chapter", subject_ref: SUMMARY_CHAPTER, subject_label: "第07章：空章待写·情绪",
    design_ref: null, status: "UNPLANNED", payload: { intended: null, realized: "安静而紧张。", seq: 4 },
    source_refs: ["chapter_summary:" + SUMMARY_CHAPTER + "@" + S4_REVISION],
    last_event_chapter: SUMMARY_CHAPTER, adoption_status: "ACCEPTED", revision: 1,
    inserted_at: "2026-11-23T01:00:03.050000Z", updated_at: "2026-11-23T01:00:03.060000Z",
  };
  // Genre comes from the frozen B33 work profile, not from a chapter or another model call.
  const genre = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", work_id: workId, ledger: "promise",
    subject_kind: "promise", subject_ref: "genre", subject_label: "类型承诺：雨港悬疑",
    design_ref: null, status: "OPEN", payload: { promise_kind: "genre", content: "雨港悬疑" },
    source_refs: ["work_profile:" + workId], last_event_chapter: null,
    adoption_status: "ACCEPTED", revision: 1,
    inserted_at: "2026-11-23T01:00:03.020000Z", updated_at: "2026-11-23T01:00:03.030000Z",
  };
  for (const [key, snapshot] of Object.entries(proof.snapshots)) {
    snapshot.scope_rows.ledger_entries = structuredClone(
      ["S4", "final"].includes(key) ? [old, emotion, genre] : [old],
    );
  }
  proof.appRecords.find((row) => row.event === "ledger.update.done").emotion = "UNPLANNED";
  refreshS4LedgerCanon(proof);
  return proof;
}

function s4AdoptionLedgerChecks(proof) {
  const identity = proof.scenarioScopes[0];
  const source = proof.wire.find((record) =>
    record.frame[3] === "turn_result" && record.frame[4].turn_id === S4_SOURCE_TURN).frame[4];
  const terminalRecord = proof.wire.find((record) =>
    record.frame[3] === "agent_run_state" && record.frame[4].run_id === identity.runId);
  // Exercise the real post-selection consumer; the source contains exactly one handwritten candidate.
  assert.equal(source.adoption_state.pending.length, 1);
  return adoptionEvidenceChecks({
    unique: true, artifact: source.adoption_state.pending[0], turnResult: source, identity,
    terminal: { kind: terminalRecord.frame[4].status, record: terminalRecord },
    driverEntry: proof.driverLog.scenarios[0], wire: proof.wire,
    before: proof.snapshots["S4-before-adoption"], after: proof.snapshots.S4,
    appRecords: proof.appRecords,
  });
}

test("B33 adoption ledger accepts this summary's emotion plus work-level genre without a chapter-summary genre ref", () => {
  const proof = adoptionLedgerProof();
  const checks = s4AdoptionLedgerChecks(proof);
  assert(Object.values(checks).every(Boolean), JSON.stringify(Object.entries(checks).filter(([, value]) => !value)));
  const genre = proof.snapshots.S4.scope_rows.ledger_entries.find((row) => row.subject_ref === "genre");
  assert.deepEqual(genre.source_refs, ["work_profile:11111111-1111-4111-8111-111111111111"]);
  assert.equal(genre.last_event_chapter, null);
  assert.equal(proof.llmRecords.length, 2);
});

for (const [name, change] of [
  ["a new ledger row written into another work", (rows) => {
    rows[1].work_id = "44444444-4444-4444-8444-444444444444";
  }],
  ["replacing the immutable identity of an existing ledger row", (rows) => {
    rows[0].id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  }],
  ["an emotion row for another chapter", (rows) => {
    rows[1].subject_ref = rows[1].last_event_chapter = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  }],
  ["a new source not bound to the adopted summary", (rows) => {
    rows[1].source_refs = ["chapter_summary:" + SUMMARY_CHAPTER + "@draft:draft-unrelated:9"];
  }],
]) {
  test("B33 adoption ledger rejects " + name, () => {
    const proof = adoptionLedgerProof();
    mutateS4After(proof, (snapshot) => change(snapshot.scope_rows.ledger_entries));
    refreshS4LedgerCanon(proof);
    assert.equal(Object.values(s4AdoptionLedgerChecks(proof)).every(Boolean), false);
  });
}
