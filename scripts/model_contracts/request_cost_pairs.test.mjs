// R05 配对成本的独立文件证据反例；不调用模型、不构造生产 IR、不运行数据库。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { openTestRunScope } from "../lib/test_env.mjs";
import { scopeWireMessage } from "../lib/native_ui/fixtures/authoring_request_ir.mjs";
import { analyzeConstructedPairs } from "../lib/native_ui/request_cost_pairs_evidence.mjs";

const CASES = [
  ["b87-r05-chapter-count", "initial", "这部作品目前一共有多少章？有正文和还没写正文的各几章？只告诉我这三个数量。"],
  ["b87-r05-quality", "initial", "请先阅读第01章《灵源账单》已经保存的正文，再判断主角的胜利来得是否太容易，指出依据和可改方向。只分析，不生成修订候选，也不要保存。"],
  ["b29-r03-candidate", "initial", "指定老沈为主角"],
  ["b82-g2", "initial", "请先读第02章《灰烬中的手印》已经保存的正文，前后都核对一下，再把发现的重复写法改成一段候选给我看，先不要保存。"],
  ["b87-r05-whole-chapter", "initial", "请先把第02章《灰烬中的手印》已保存的正文从头到尾读完，再给我一份整章修订候选，减少重复描写，保留开头和结尾的线索；先不要保存。"],
  ["b87-r05-style-material", "initial", "请先查看本作品已经确认的风格规则，并阅读第01章《黑市对账夜》已保存的正文。据此把这一章改写成一份修订候选，突出人物之间的试探；先不要保存。"],
  ["b87-r05-whole-chapter", "writer", "请先把第02章《灰烬中的手印》已保存的正文从头到尾读完，再给我一份整章修订候选，减少重复描写，保留开头和结尾的线索；先不要保存。"],
];
const PROSE = "开头保留铜铃。" + "灰".repeat(6986) + "结尾保留手印。";
const RUNTIME = { provider: "splash", model: "local/Q4-PLE4", thinking: "enabled",
  reasoning_effort: "high", max_tokens: 32000, timeout: 300000 };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function asset(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, value);
  return { path: file, sha256: sha(value) };
}
let scope;
test.before(() => { scope = openTestRunScope(); });
test.after(() => { scope?.close(); });

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(scope.workDir, "r05-pairs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recipe = {
    schema: "b87-r05-constructed-request-recipe/v1",
    driver: asset(dir, "driver.exs", "# frozen test driver\n"),
    source_identities: {
      before: asset(dir, "before-source.json", JSON.stringify({
        head: "192a335fa37a3eef79f4a385d422403a073521a3", initial_wip_count: 109 })),
      after: asset(dir, "after-source.json", JSON.stringify({ frozen_source: "after-source" })),
    },
    runtime: RUNTIME,
    pairs: CASES.map(([caseId, request, text], index) => ({
      id: caseId + "-" + request, case_id: caseId, request,
      seed: asset(dir, "seed-" + index + ".exs", "# independent seed " + index + "\n"),
      database_sha256: sha("same immutable initial database " + index),
      workspace_id: "workspace-pair", work_id: "work-pair", session_id: "session-pair",
      author: { ...asset(dir, "author-" + index + ".txt", text), turn_id: "author-turn-" + index },
      ...(request === "writer" ? { source: { chapter_ref: "chapter:second", draft_ref: "draft:accepted",
        revision: 7, expected_graphemes: 7000, prose: asset(dir, "prose.txt", PROSE) } } : {}),
    })),
  };
  const recipePath = path.join(dir, "recipe.json");
  write(recipePath, recipe);
  const beforeDir = path.join(dir, "before");
  const afterDir = path.join(dir, "after");
  for (const arm of ["before", "after"]) {
    for (const pair of recipe.pairs) materializeArm(dir, arm, pair, recipe, sha(fs.readFileSync(recipePath)));
  }
  return { dir, recipe, recipePath, beforeDir, afterDir, outDir: path.join(dir, "report") };
}

function materializeArm(dir, arm, pair, recipe, recipeSha) {
  const leaf = path.join(dir, arm, pair.id);
  const text = fs.readFileSync(pair.author.path, "utf8");
  const run = { run_id: arm + "-run-" + pair.id, workspace_id: pair.workspace_id,
    work_id: pair.work_id, session_id: pair.session_id, parent_turn_ref: pair.author.turn_id,
    run_status: "completed" };
  const coordinate = (sequence) => ({ ...run, run_sequence: sequence });
  const content = { work_id: pair.work_id, goal: { source_input_ref: pair.author.turn_id, version: 1 } };
  const canonicalScope = (value, sequence) => ({ role: "scope_update", provenance: "application",
    canonical_ref: coordinate(sequence), source_refs: [], versions: {},
    blocks: [{ type: "scope", content: value }] });
  const author = { role: "user", provenance: "author", canonical_ref: coordinate(2),
    source_refs: [{ ref: pair.author.turn_id }], versions: {}, blocks: [{ type: "text", text }] };
  const canonical = [canonicalScope(content, 1), author];
  const prefix = [{ role: "system", content: "保留作者原文与真实材料。" },
    scopeWireMessage(content), { role: "user", content: text }];
  const records = [];
  function call(name, sequence) {
    const pcall = arm + "-pcall-" + pair.id + "-" + name;
    const prun = arm + "-prun-" + pair.id + "-" + name;
    const body = { model: RUNTIME.model, reasoning_effort: "high", max_tokens: 32000,
      stream: true, messages: structuredClone(prefix), tools: [{ type: "function", function: {
        name: name === "writer" ? "submit_tentative_artifact" : "judgment_decision",
        parameters: { type: "object", properties: {} },
      } }] };
    records.push({ provider: "splash", workspace_id: run.workspace_id, work_id: run.work_id,
      session_id: run.session_id, turn_id: pair.author.turn_id,
      provider_call_ref: pcall, provider_run_ref: prun, request: { body },
      response: { content: "固定响应，仅供构造请求。" } });
    canonical.push({ role: "assistant", provenance: "model", canonical_ref: coordinate(sequence),
      provider_call_ref: pcall, provider_run_ref: prun, source_refs: [], versions: {},
      blocks: [{ type: "text", text: "固定响应，仅供构造请求。" }] });
  }
  call("initial", 3);
  if (pair.request === "writer") {
    const writer = {
      ...content,
      operation: { role: "creative_execution", capability: "prose_writing", context_text: PROSE },
      authoring_task: { scope: { object_kind: "chapter_prose", modification_scope: "whole_chapter",
        target_chapter_ref: "chapter:second", expected_base_versions: [{ ref: "draft:accepted", version: 7 }] },
        materials: [{ kind: "chapter_prose", ref: "draft:accepted", version: 7, "complete?": true }] },
    };
    canonical.push(canonicalScope(writer, 4));
    prefix.push({ role: "assistant", content: "固定响应，仅供构造请求。" }, scopeWireMessage(writer));
    call("writer", 5);
  }
  const selected = records.at(-1);
  write(path.join(leaf, "capture.json"), {
    schema: "b87-r05-constructed-request-capture/v1",
    pair_id: pair.id, arm, run_id: run.run_id, status: "completed", transport: "scripted_native_response",
    recipe_sha256: recipeSha, driver_sha256: recipe.driver.sha256,
    source_identity_sha256: recipe.source_identities[arm].sha256,
    database_sha256: pair.database_sha256, seed_sha256: pair.seed.sha256,
    author_sha256: pair.author.sha256, turn_id: pair.author.turn_id,
    selected: { provider_call_ref: selected.provider_call_ref, provider_run_ref: selected.provider_run_ref },
    llm_log: "llm.jsonl", transport_file: "transport.json", session_view_file: "session-view.json",
  });
  write(path.join(leaf, "session-view.json"), { run, messages: canonical });
  write(path.join(leaf, "transport.json"), records.map(({ response, ...record }) => record));
  fs.writeFileSync(path.join(leaf, "llm.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function pairFiles(f, index = 6, arm = "after") {
  const dir = path.join(f.dir, arm, f.recipe.pairs[index].id);
  return { capture: path.join(dir, "capture.json"), view: path.join(dir, "session-view.json"),
    transport: path.join(dir, "transport.json"), log: path.join(dir, "llm.jsonl") };
}
function rewriteScope(f, mutate) {
  const files = pairFiles(f);
  const view = read(files.view);
  const latest = view.messages.findLast((message) => message.role === "scope_update");
  mutate(latest.blocks[0].content);
  write(files.view, view);
  const records = fs.readFileSync(files.log, "utf8").trim().split("\n").map(JSON.parse);
  records.at(-1).request.body.messages[4] = scopeWireMessage(latest.blocks[0].content);
  fs.writeFileSync(files.log, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  write(files.transport, records.map(({ response, ...record }) => record));
}
function analyze(f) {
  return analyzeConstructedPairs({
    recipePath: f.recipePath, beforeDir: f.beforeDir, afterDir: f.afterDir, outDir: f.outDir,
  });
}
function rejected(report, index, reason) {
  assert.equal(report.status, "fail");
  assert.equal(report.pairs[index].status, "unpaired");
  assert.equal(report.pairs[index].delta, null);
  assert.ok(report.pairs[index].reasons.includes(reason), JSON.stringify(report.pairs[index]));
}

test("R05 seven pairs keep independently allocated run/call IDs and report bytes only", (t) => {
  const report = analyze(fixture(t));
  assert.equal(report.schema, "b87-r05-constructed-request-pairs/v1");
  assert.equal(report.status, "pass");
  assert.equal(report.pairs.length, 7);
  assert.equal(report.paired_count, 7);
  for (const pair of report.pairs) {
    assert.equal(pair.status, "paired");
    assert.notEqual(pair.before.provider_call_ref, pair.after.provider_call_ref);
    assert.notEqual(pair.before.run_id, pair.after.run_id);
    assert.equal(pair.delta.stable_json_bytes, 0);
    assert.equal(pair.delta.content_utf8_bytes, 0);
    assert.equal(pair.delta.envelope_bytes, 0);
    assert.equal(Object.hasOwn(pair.before, "usage"), false);
    assert.equal(Object.hasOwn(pair.after, "response"), false);
  }
  assert.deepEqual(report.not_measured, ["provider_tokens", "provider_latency", "model_quality"]);
  assert.equal(report.pairs[6].before.writer_material.full_prose_supplied, true);
  assert.equal(report.pairs[6].after.writer_material.full_prose_supplied, true);
});

test("R05 Writer step identity keeps the same frozen author input and real call chain", (t) => {
  const f = fixture(t), files = pairFiles(f);
  const records = fs.readFileSync(files.log, "utf8").trim().split("\n").map(JSON.parse);
  records[1].turn_id = "author-turn-6:agent:7";
  fs.writeFileSync(files.log, records.map(JSON.stringify).join("\n") + "\n");
  write(files.transport, records.map(({ response, ...record }) => record));
  const report = analyze(f);
  assert.equal(report.status, "pass");
  assert.equal(report.paired_count, 7);
  assert.equal(report.pairs[6].after.author_turn_ref, "author-turn-6");
  assert.equal(report.pairs[6].after.writer_material.full_prose_supplied, true);
  assert.equal(report.pairs[6].delta.content_utf8_bytes, 0);
});

test("R05 Writer rejects foreign or malformed step turns with identical request bodies", async (t) => {
  for (const turnId of ["other-author-turn:agent:7", "author-turn-6:agent:0",
    "author-turn-6:agent:01", "author-turn-6:agent:7:extra", "author-turn-6:agent:7\n"]) {
    await t.test(JSON.stringify(turnId), (sub) => {
      const f = fixture(sub), files = pairFiles(f);
      const records = fs.readFileSync(files.log, "utf8").trim().split("\n").map(JSON.parse);
      records[1].turn_id = turnId;
      fs.writeFileSync(files.log, records.map(JSON.stringify).join("\n") + "\n");
      write(files.transport, records.map(({ response, ...record }) => record));
      rejected(analyze(f), 6, "after:author_identity");
    });
  }
});

test("R05 equal author text from another source turn cannot sign the frozen input", (t) => {
  const f = fixture(t), files = pairFiles(f, 0);
  const view = read(files.view);
  view.messages[1].source_refs = [{ ref: "other-author-turn" }];
  write(files.view, view);
  rejected(analyze(f), 0, "after:author_binding");
});

test("R05 changed initial database cannot pair even when request bodies are identical", (t) => {
  const f = fixture(t), files = pairFiles(f, 0), value = read(files.capture);
  value.database_sha256 = sha("different initial database");
  write(files.capture, value);
  rejected(analyze(f), 0, "after:database_identity");
});

test("R05 matching pcall with a different transport body is rejected", (t) => {
  const f = fixture(t), files = pairFiles(f, 0), value = read(files.transport);
  value[0].request.body.messages[2].content = "另一条实际发送的作者原文";
  write(files.transport, value);
  rejected(analyze(f), 0, "after:transport_body");
});

test("R05 whole writer must retain all 7000 characters, not only both anchors", (t) => {
  assert.equal([...PROSE].length, 7000);
  const f = fixture(t);
  rewriteScope(f, (content) => { content.operation.context_text = "开头保留铜铃。结尾保留手印。"; });
  rejected(analyze(f), 6, "after:writer_full_prose");
});

test("R05 identical full prose with another chapter or draft version is unpaired", async (t) => {
  for (const [label, mutate] of [
    ["chapter", (value) => { value.authoring_task.scope.target_chapter_ref = "chapter:first"; }],
    ["version", (value) => { value.authoring_task.scope.expected_base_versions[0].version = 8; }],
  ]) {
    await t.test(label, (sub) => {
      const f = fixture(sub);
      rewriteScope(f, mutate);
      rejected(analyze(f), 6, "after:writer_full_prose");
    });
  }
});

test("R05 same call text cannot replace an unmatched canonical provider run", (t) => {
  const f = fixture(t), files = pairFiles(f, 0), view = read(files.view);
  view.messages.at(-1).provider_run_ref = "unrelated-prun";
  write(files.view, view);
  rejected(analyze(f), 0, "after:canonical_call");
});

test("R05 a foreign first call cannot borrow a valid selected Writer", (t) => {
  const f = fixture(t), files = pairFiles(f), foreign = pairFiles(f, 1);
  const rows = fs.readFileSync(files.log, "utf8").trim().split("\n");
  rows[0] = fs.readFileSync(foreign.log, "utf8").trim();
  fs.writeFileSync(files.log, rows.join("\n") + "\n");
  const transports = read(files.transport);
  transports[0] = read(foreign.transport)[0];
  write(files.transport, transports);
  assert.notEqual(read(files.view).run.run_id, read(foreign.view).run.run_id);
  assert.notEqual(transports[0].turn_id, f.recipe.pairs[6].author.turn_id);
  rejected(analyze(f), 6, "after:canonical_call");
});

test("R05 capture run identity must name the canonical session run", (t) => {
  const f = fixture(t), files = pairFiles(f), value = read(files.capture);
  value.run_id = "capture-run-not-the-session-run";
  write(files.capture, value);
  rejected(analyze(f), 6, "after:run_identity");
});

test("R05 call sequence and selected last-call identity are not inferred from count", async (t) => {
  await t.test("LLM records reversed while transport and selected Writer stay unchanged", (sub) => {
    const f = fixture(sub), files = pairFiles(f);
    const rows = fs.readFileSync(files.log, "utf8").trim().split("\n");
    fs.writeFileSync(files.log, rows.reverse().join("\n") + "\n");
    rejected(analyze(f), 6, "after:call_order");
  });
  await t.test("selected Writer is not the last actual transport call", (sub) => {
    const f = fixture(sub), files = pairFiles(f);
    write(files.transport, read(files.transport).reverse());
    rejected(analyze(f), 6, "after:call_order");
  });
});

test("R05 full unchanged chapter material cannot turn another stage into Writer", async (t) => {
  await t.test("wrong operation role with all prose and references intact", (sub) => {
    const f = fixture(sub);
    rewriteScope(f, (value) => { value.operation.role = "quality_review"; });
    rejected(analyze(f), 6, "after:call_stage");
  });
  await t.test("wrong native tool with canonical Scope and full prose unchanged", (sub) => {
    const f = fixture(sub), files = pairFiles(f);
    const rows = fs.readFileSync(files.log, "utf8").trim().split("\n").map(JSON.parse);
    rows.at(-1).request.body.tools[0].function.name = "submit_quality_review";
    fs.writeFileSync(files.log, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    write(files.transport, rows.map(({ response, ...record }) => record));
    rejected(analyze(f), 6, "after:call_stage");
  });
});

test("R05 synthetic response usage and latency never become measured provider cost", (t) => {
  const f = fixture(t), files = pairFiles(f, 0);
  const rows = fs.readFileSync(files.log, "utf8").trim().split("\n").map(JSON.parse);
  rows[0].response.usage = { prompt_tokens: 999, completion_tokens: 888, latency_ms: 777 };
  rows[0].response.duration_ms = 666;
  fs.writeFileSync(files.log, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const report = analyze(f);
  assert.equal(report.status, "pass");
  const arm = report.pairs[0].after;
  assert.equal(Object.hasOwn(arm, "usage"), false);
  assert.equal(Object.hasOwn(arm, "response"), false);
  assert.equal(Object.hasOwn(arm, "latency_ms"), false);
});

test("R05 changed frozen driver or author bytes cannot silently enter a pair", async (t) => {
  for (const kind of ["driver", "author"]) {
    await t.test(kind, (sub) => {
      const f = fixture(sub);
      const file = kind === "driver" ? f.recipe.driver.path : f.recipe.pairs[0].author.path;
      fs.appendFileSync(file, "\nchanged");
      assert.throws(() => analyze(f), /sha256/);
    });
  }
});
