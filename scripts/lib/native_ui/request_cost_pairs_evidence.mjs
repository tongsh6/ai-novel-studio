// B87 R05 固定同输入请求构造的离线配对证据：recipe、两臂调用链、必要材料与差值报告。
// 只读取冻结资产与真实 transport/LLM/canonical；不运行模型、UI、driver 或 DB。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { requestFactsFromRecord } from "./authoring_request_facts.mjs";
import { r05GoalEvidence } from "./authoring_r05_evidence.mjs";
import { bodyToolNames } from "./authoring_scenario_evidence.mjs";
import { analyzeRequestCost } from "./request_cost_evidence.mjs";
import { canonicalAuthorMessage } from "./request_cost_batch_evidence.mjs";
import {
  canonicalCoverageForProviderCall,
  providerTurnMatchesParent,
  scopeForProviderCall,
} from "./authoring_call_evidence.mjs";
import {
  ROOT,
  jsonl,
  markdownTable,
  read,
  shaFile,
  writeDerivedJson,
  writeDerivedText,
} from "./scenario_evidence.mjs";

const list = (value) => (Array.isArray(value) ? value : []);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";

export const CONSTRUCTED_PAIRS_SCHEMA = "b87-r05-constructed-request-pairs/v1";
const CONSTRUCTED_RECIPE_SCHEMA = "b87-r05-constructed-request-recipe/v1";
const CONSTRUCTED_CAPTURE_SCHEMA = "b87-r05-constructed-request-capture/v1";

function constructedAsset(recipeFile, value) {
  assert(nonBlank(value?.path) && nonBlank(value?.sha256), "frozen asset needs path/sha256");
  const file = path.resolve(path.dirname(recipeFile), value.path);
  const bytes = fs.readFileSync(file);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), value.sha256,
    "sha256 mismatch: " + file);
  return { path: file, sha256: value.sha256, text: bytes.toString("utf8") };
}

function constructedRecipe(recipePath) {
  const file = path.resolve(ROOT, recipePath);
  const recipe = read(path.dirname(file), path.basename(file));
  assert.equal(recipe.schema, CONSTRUCTED_RECIPE_SCHEMA, "unknown constructed recipe");
  assert.equal(recipe.pairs?.length, 7, "R05 requires exactly seven pairs");
  assert.equal(new Set(recipe.pairs.map((pair) => pair.id)).size, 7, "duplicate pair identity");
  assert.equal(recipe.pairs.filter((pair) => pair.request === "initial").length, 6);
  assert.equal(recipe.pairs.filter((pair) => pair.request === "writer").length, 1);
  assert.equal(recipe.runtime?.provider, "splash");
  const driver = constructedAsset(file, recipe.driver);
  const sources = Object.fromEntries(["before", "after"].map((arm) =>
    [arm, constructedAsset(file, recipe.source_identities?.[arm])]));
  const pairs = recipe.pairs.map((pair) => {
    assert(nonBlank(pair.id) && path.basename(pair.id) === pair.id, "invalid pair path");
    assert(["initial", "writer"].includes(pair.request), "unknown constructed request");
    for (const key of ["workspace_id", "work_id", "session_id", "database_sha256"]) {
      assert(nonBlank(pair[key]), "missing pair identity: " + key);
    }
    assert(nonBlank(pair.author?.turn_id), "missing frozen author turn");
    const author = constructedAsset(file, pair.author);
    const seed = constructedAsset(file, pair.seed);
    const prose = pair.request === "writer" ? constructedAsset(file, pair.source?.prose) : null;
    if (prose) {
      assert.equal(pair.source.expected_graphemes, 7000, "whole writer source must be frozen at 7000");
      assert.equal([...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(prose.text)].length,
        7000, "whole writer source must contain 7000 graphemes");
    }
    return { ...pair, author: { ...pair.author, text: author.text }, seed, prose };
  });
  return { file, sha256: shaFile(file), recipe, driver, sources, pairs };
}

function constructedCallMatches(record, selected) {
  return record?.provider_call_ref === selected?.provider_call_ref &&
    record?.provider_run_ref === selected?.provider_run_ref;
}

function constructedParameters(body) {
  return Object.fromEntries(Object.entries(body).filter(([key]) =>
    !["messages", "tools", "tool_choice"].includes(key)));
}

function constructedArm(loaded, pair, arm, dir, reasons) {
  const fail = (reason) => reasons.push(arm + ":" + reason);
  try {
    const leaf = path.join(path.resolve(ROOT, dir), pair.id);
    const captured = read(leaf, "capture.json");
    if (captured.schema !== CONSTRUCTED_CAPTURE_SCHEMA || captured.status !== "completed" ||
      captured.transport !== "scripted_native_response") fail("capture_status");
    for (const [key, value, reason] of [
      ["pair_id", pair.id, "pair_identity"],
      ["arm", arm, "arm_identity"],
      ["recipe_sha256", loaded.sha256, "recipe_identity"],
      ["driver_sha256", loaded.driver.sha256, "driver_identity"],
      ["source_identity_sha256", loaded.sources[arm].sha256, "source_identity"],
      ["database_sha256", pair.database_sha256, "database_identity"],
      ["seed_sha256", pair.seed.sha256, "seed_identity"],
      ["author_sha256", pair.author.sha256, "author_identity"],
      ["turn_id", pair.author.turn_id, "author_identity"],
    ]) if (captured[key] !== value) fail(reason);

    const records = jsonl(path.join(leaf, captured.llm_log));
    const transports = read(leaf, captured.transport_file);
    const view = read(leaf, captured.session_view_file);
    const selected = captured.selected;
    if (!nonBlank(selected?.provider_call_ref) || !nonBlank(selected?.provider_run_ref)) {
      fail("call_identity");
      return null;
    }
    const expectedCalls = pair.request === "writer" ? 2 : 1;
    if (!nonBlank(captured.run_id) || captured.run_id !== view.run?.run_id) fail("run_identity");
    const replies = list(view.messages).filter((message) => message?.role === "assistant" &&
      message.provenance === "model" && message.canonical_ref?.run_id === captured.run_id);
    if (records.length !== expectedCalls || transports.length !== expectedCalls ||
      replies.length !== expectedCalls) fail("call_count");
    if (!constructedCallMatches(records.at(-1), selected) ||
      !constructedCallMatches(transports.at(-1), selected) || records.some((record, index) =>
        !constructedCallMatches(record, transports[index]) ||
        !constructedCallMatches(record, replies[index]))) fail("call_order");
    for (const transportRecord of transports) {
      const matches = records.filter((record) => constructedCallMatches(record, transportRecord));
      if (matches.length !== 1) fail("transport_call");
      else {
        if (!isDeepStrictEqual(matches[0].request?.body, transportRecord.request?.body)) fail("transport_body");
        for (const key of ["workspace_id", "work_id", "session_id", "turn_id"]) {
          if (matches[0][key] !== transportRecord[key]) fail("transport_identity");
        }
      }
    }
    const matches = records.filter((record) => constructedCallMatches(record, selected));
    if (matches.length !== 1 ||
      transports.filter((record) => constructedCallMatches(record, selected)).length !== 1) {
      fail("call_identity");
      return null;
    }
    const record = matches[0];
    const boundCalls = records.map((call, index) => {
      const reply = replies[index];
      for (const key of ["workspace_id", "work_id", "session_id"]) {
        if (call[key] !== pair[key] || view.run?.[key] !== pair[key] ||
          reply?.canonical_ref?.[key] !== pair[key]) fail("request_identity");
      }
      if (!providerTurnMatchesParent(call.turn_id, pair.author.turn_id) ||
        view.run?.parent_turn_ref !== pair.author.turn_id ||
        reply?.canonical_ref?.parent_turn_ref !== pair.author.turn_id) fail("author_identity");
      if (call.provider !== "splash" || call.request?.body?.model !== loaded.recipe.runtime.model ||
        call.request?.body?.reasoning_effort !== loaded.recipe.runtime.reasoning_effort) fail("runtime");
      const coverage = canonicalCoverageForProviderCall(call, view);
      if (coverage?.ok !== true) fail("canonical_call");
      const found = canonicalAuthorMessage(call, pair.author, view);
      if (!found) fail("author_binding");
      const scope = scopeForProviderCall(call, view);
      if (!scope) fail("canonical_scope");
      const goalRef = scope?.scopeContent?.goal?.source_input_ref;
      if (goalRef != null && goalRef !== pair.author.turn_id) fail("goal_source");
      const facts = requestFactsFromRecord(call);
      const names = bodyToolNames(facts);
      const operation = scope?.scopeContent?.operation;
      const writer = pair.request === "writer" && index === 1;
      const stageMatches = writer
        ? operation?.role === "creative_execution" && operation.capability === "prose_writing" &&
          names.includes("submit_tentative_artifact") && !names.includes("judgment_decision")
        : names.includes("judgment_decision") && !names.includes("submit_tentative_artifact");
      if (!stageMatches) fail("call_stage");
      return { found, scope, facts };
    });
    const { found, scope, facts } = boundCalls[records.indexOf(record)];
    const writerMaterial = pair.request === "writer"
      ? constructedWriterEvidence(record, facts, scope, pair, fail) : null;
    const analysis = analyzeRequestCost(record, {
      authorBinding: found ? { messageIndex: found.index, text: pair.author.text, sha256: pair.author.sha256 } : null,
      purpose: pair.request === "writer" ? "writer" : "planner",
    });
    if (!analysis.ok) fail("request_cost");

    // 只取请求量度。fixture response 的 usage/latency 即使存在也不能冒充实模测量。
    return {
      run_id: view.run?.run_id ?? null,
      provider_call_ref: record.provider_call_ref,
      provider_run_ref: record.provider_run_ref,
      author_turn_ref: pair.author.turn_id,
      request: analysis.request,
      totals: analysis.totals,
      category_bytes: analysis.category_bytes,
      cross: analysis.cross,
      provenance: analysis.provenance,
      parameters: constructedParameters(record.request.body),
      ...(writerMaterial ? { writer_material: writerMaterial } : {}),
    };
  } catch (error) {
    fail("evidence_read:" + error.message);
    return null;
  }
}

function constructedWriterEvidence(record, facts, scope, pair, fail) {
  const source = { ...pair.source, prose: pair.prose.text };
  const material = r05GoalEvidence({
    goal: "whole",
    source,
    requests: [{ provider_call_ref: record.provider_call_ref,
      provider_run_ref: record.provider_run_ref, facts, scope }],
    consumer_call_ref: record.provider_call_ref,
  });
  const full = material.checks.full_prose_supplied === true;
  const whole = scope?.scopeContent?.authoring_task?.scope?.modification_scope === "whole_chapter";
  if (!full) fail("writer_full_prose");
  if (!whole) fail("writer_scope");
  // 重复仍须如实计量；once 是产品材料目标分项，不把旧版重复偷偷排除出成本对照。
  return { full_prose_supplied: full, scope_baseline_once: material.checks.baseline_once === true,
    whole_scope: whole, chapter_ref: source.chapter_ref, draft_ref: source.draft_ref,
    revision: source.revision, prose_sha256: pair.source.prose.sha256 };
}

function constructedPair(loaded, pair, beforeDir, afterDir) {
  const reasons = [];
  const before = constructedArm(loaded, pair, "before", beforeDir, reasons);
  const after = constructedArm(loaded, pair, "after", afterDir, reasons);
  if (before && after && !isDeepStrictEqual(before.parameters, after.parameters)) {
    reasons.push("request_parameters_differ");
  }
  const paired = reasons.length === 0 && before !== null && after !== null;
  const delta = paired ? {
    stable_json_bytes: after.totals.stable_json_bytes - before.totals.stable_json_bytes,
    content_utf8_bytes: after.totals.content_utf8_bytes - before.totals.content_utf8_bytes,
    envelope_bytes: after.totals.envelope_bytes - before.totals.envelope_bytes,
    category_bytes: Object.fromEntries(Object.keys(before.category_bytes).map((key) =>
      [key, after.category_bytes[key] - before.category_bytes[key]])),
  } : null;
  return { id: pair.id, case_id: pair.case_id, request: pair.request,
    request_path: pair.request === "writer" ? "judgment_direct_execute_to_writer_without_prior_exploration" : "first_judgment",
    status: paired ? "paired" : "unpaired", reasons: [...new Set(reasons)], before, after, delta };
}

// 只核同输入构造的配对资格与字节差；不扩 history/native manifest，不重算单请求量度。
export function analyzeConstructedPairs({ recipePath, beforeDir, afterDir, outDir }) {
  const loaded = constructedRecipe(recipePath);
  const pairs = loaded.pairs.map((pair) => constructedPair(loaded, pair, beforeDir, afterDir));
  const report = {
    schema: CONSTRUCTED_PAIRS_SCHEMA,
    generated_at: new Date().toISOString(),
    measurement: "production_request_construction_with_scripted_transport",
    recipe: { path: loaded.file, sha256: loaded.sha256 },
    source_identities: Object.fromEntries(Object.entries(loaded.sources).map(([arm, source]) =>
      [arm, { path: source.path, sha256: source.sha256 }])),
    driver_sha256: loaded.driver.sha256,
    status: pairs.every((pair) => pair.status === "paired") ? "pass" : "fail",
    paired_count: pairs.filter((pair) => pair.status === "paired").length,
    unpaired_count: pairs.filter((pair) => pair.status === "unpaired").length,
    not_measured: ["provider_tokens", "provider_latency", "model_quality"],
    pairs,
  };
  const output = path.resolve(ROOT, outDir);
  writeDerivedJson(path.join(output, "request-cost-pairs.json"), report);
  const rows = pairs.map((pair) => [pair.id, pair.status,
    pair.before?.totals.stable_json_bytes ?? "unknown",
    pair.after?.totals.stable_json_bytes ?? "unknown",
    pair.delta?.stable_json_bytes ?? "unpaired", pair.reasons.join("; ")]);
  writeDerivedText(path.join(output, "request-cost-pairs.md"), [
    "# R05 同输入请求构造字节对照", "",
    "固定原生响应只结束构造；未执行 before 实模，不推断 Token、延迟、缓存或文学质量收益。", "",
    "Writer 对固定走首次 Judgment 直接执行，没有前置探索。Scope 的基线分项不代签原生多页探索后整条请求的材料唯一性。", "",
    markdownTable(rows, ["Pair", "Status", "Before JSON bytes", "After JSON bytes", "Delta bytes", "Reasons"]),
    "", "完整分类、来源/调用绑定与必要正文检查见同目录 JSON。原始 body/日志保留。", "",
  ].join("\n"));
  return report;
}
