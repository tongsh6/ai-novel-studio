import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { discussionEvidenceChecks, prepare, providerEvidenceChecks } from "../../native_b33_evidence.mjs";
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

function providerFixture(t, provider = "splash") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b33-provider-evidence-"));
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
  return { dir, runtime, write, config: () => JSON.parse(fs.readFileSync(path.join(dir, "native-b33-config.json"))) };
}

test("B33 prepares current Splash from observed runtime before any author input", async (t) => {
  const fixture = providerFixture(t);
  await prepare(fixture.dir, { env: {} });
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
  await prepare(strata.dir, { env: { NOVEL_STRATA_MODEL: "selected-model" } });
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
