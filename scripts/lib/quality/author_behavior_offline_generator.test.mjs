import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GENERATOR_VERSION,
  createOfflineExecutor,
  generateBatch,
  loadPersonaSidecar,
  validateCandidatePack,
  validateGenerationManifest,
  validatePersonaSidecar,
  writeGenerationArtifacts,
} from "./author_behavior_offline_generator.mjs";

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const ROOT = process.cwd();

const corpus = {
  targets: { targets: [{ id: "F1-progress-query" }, { id: "F5-setting-boundary" }] },
  states: { states: [{ id: "S1-empty" }, { id: "S2-partial" }] },
  cases: {
    cases: [
      {
        id: "seed-f1",
        target_id: "F1-progress-query",
        state_id: "S1-empty",
        split: "dev",
        expression: "现在写到哪一步了？",
        expected: { allowed_actions: ["reply"], allowed_effects: [], forbidden_behaviors: ["write"], oracle_refs: ["O1"] },
      },
      {
        id: "seed-f5",
        target_id: "F5-setting-boundary",
        state_id: "S2-partial",
        split: "dev",
        expression: "这条世界观设定先别保存。",
        expected: { allowed_actions: ["reply"], allowed_effects: [], forbidden_behaviors: ["write"], oracle_refs: ["O5"] },
      },
    ],
  },
};

function manifestFixture() {
  return {
    schema: "author-behavior-generation-manifest/v1",
    generation_id: "ab-20261031-test01",
    created_at: "2026-10-31T00:00:00Z",
    git_head: "test-head",
    base_corpus_sha: SHA,
    generator: {
      generator_version: GENERATOR_VERSION,
      provider: "offline",
      model: "deterministic-template",
      actual_model: "offline-deterministic",
      params: { seed: 7 },
      prompt_template_sha: OTHER_SHA,
    },
    input: {
      stage: "calibration",
      asset_layer: "core",
      target_ids: ["F1-progress-query", "F5-setting-boundary"],
      state_ids: ["S1-empty", "S2-partial"],
      persona_ids: ["p-brief-direct", "p-fuzzy-explorer", "p-frequent-corrector"],
      semantic_cells: [
        {
          semantic_cell_id: "cell-f1-readonly",
          target_id: "F1-progress-query",
          state_id: "S1-empty",
          boundary_tags: ["progress_query", "readonly"],
          persona_ids: ["p-brief-direct", "p-fuzzy-explorer"],
          styles: ["brief", "hesitant"],
          max_variants: 2,
          review_value: "new_boundary",
          split: "dev",
        },
        {
          semantic_cell_id: "cell-f5-holdout",
          target_id: "F5-setting-boundary",
          state_id: "S2-partial",
          boundary_tags: ["setting_boundary", "holdout"],
          persona_ids: ["p-frequent-corrector"],
          styles: ["self_correcting"],
          max_variants: 1,
          review_value: "new_persona_behavior",
          split: "holdout",
        },
      ],
      source_case_ids: ["seed-f1", "seed-f5"],
      max_candidates: 3,
    },
    privacy: { synthetic_only: true, real_work_data: false },
    budget: { max_calls: 3, max_duration_minutes: 1 },
    output: { candidate_uri: "artifacts/author-behavior/test/candidates.json", status: "preregistered" },
  };
}

function expectedFor(seedId) {
  return corpus.cases.cases.find((testCase) => testCase.id === seedId).expected;
}

test("persona sidecar 提供 12 个有行为差异的合法画像", () => {
  const sidecar = loadPersonaSidecar(ROOT);
  assert.equal(sidecar.schema, "author-behavior-personas/v1");
  assert.equal(sidecar.personas.length, 12);
  assert.equal(new Set(sidecar.personas.map((persona) => persona.persona_id)).size, 12);
  for (const persona of sidecar.personas) {
    assert(persona.multi_turn_tendency.length > 0);
    assert(persona.write_sensitivity.length > 0);
    assert(persona.expression.reference_style.length > 0);
  }
});

test("manifest 校验拒绝隐私破坏、未知 persona 与校准超预算", () => {
  const personas = loadPersonaSidecar(ROOT).personas;
  assert.deepEqual(validateGenerationManifest(manifestFixture(), { corpus, personas }).errors, []);
  const privacy = manifestFixture();
  privacy.privacy.real_work_data = true;
  assert(validateGenerationManifest(privacy, { corpus, personas }).errors.some((error) => error.code === "privacy_violation"));
  const unknown = manifestFixture();
  unknown.input.persona_ids = ["p-unknown"];
  assert(validateGenerationManifest(unknown, { corpus, personas }).errors.some((error) => error.code === "persona_unknown"));
  const tooMany = manifestFixture();
  tooMany.input.max_candidates = 61;
  tooMany.budget.max_calls = 61;
  assert(validateGenerationManifest(tooMany, { corpus, personas }).errors.some((error) => error.code === "calibration_budget_exceeded"));
});

test("离线批次生成完整候选且生成≠accepted/executed/PASS，输入不被修改", async () => {
  const manifest = manifestFixture();
  const before = JSON.stringify({ manifest, corpus });
  const result = await generateBatch(manifest, {
    corpus,
    personas: loadPersonaSidecar(ROOT).personas,
    executeCell: createOfflineExecutor(),
    now: () => "2026-10-31T01:02:03Z",
  });

  assert.equal(result.manifest.output.status, "completed");
  assert.equal(result.manifest.output.candidate_count, 3);
  assert.equal(result.manifest.output.call_count, 3);
  assert.equal(result.manifest.output.failure_count, 0);
  assert.equal(result.pack.candidates.length, 3);
  assert.equal(JSON.stringify({ manifest, corpus }), before);

  for (const candidate of result.pack.candidates) {
    assert.equal(candidate.generation_id, manifest.generation_id);
    assert.equal(candidate.review.status, "pending");
    assert.equal(candidate.review.reviewer, null);
    assert.equal(candidate.review.reviewed_at, null);
    assert(candidate.semantic_cell_id.length > 0);
    assert(candidate.boundary_tags.length > 0);
    assert(candidate.normalized_expression_sha.length === 64);
    assert(candidate.raw_response.length > 0);
  }
  assert.deepEqual(result.pack.candidates[0].expected, expectedFor("seed-f1"));
  assert.deepEqual(result.pack.candidates[2].expected, expectedFor("seed-f5"));
  assert.equal(result.pack.candidates[2].split_suggestion, "holdout");
  assert.equal(result.pack.coverage.declared.candidates, 3);
  assert.equal(result.pack.coverage.declared.pending, 3);
  assert.deepEqual(result.pack.coverage.executed, {});
  assert.deepEqual(result.pack.coverage.evaluated, {});
  assert.equal(result.pack.coverage.personas.length, 3);
  assert.deepEqual(validateCandidatePack(result.pack, { corpus }).errors, []);
});

test("精确重复与 holdout 泄漏只标记并留证，不自动接受或删除", async () => {
  const result = await generateBatch(manifestFixture(), {
    corpus,
    personas: loadPersonaSidecar(ROOT).personas,
    executeCell: async () => "同一句话。",
    now: () => "2026-10-31T01:02:03Z",
  });
  assert(result.pack.candidates.every((candidate) => candidate.review.status === "pending"));
  assert(result.pack.candidates.some((candidate) => candidate.flags.includes("duplicate_exact")));
  assert(result.pack.candidates[2].flags.includes("holdout_leak"));
  const validation = validateCandidatePack(result.pack, { corpus });
  assert(validation.errors.some((error) => error.code === "candidate_holdout_leak"));
});

test("单个执行失败保留失败记录和其他候选，不伪装完整成功", async () => {
  let call = 0;
  const result = await generateBatch(manifestFixture(), {
    corpus,
    personas: loadPersonaSidecar(ROOT).personas,
    executeCell: async () => {
      call += 1;
      if (call === 2) throw new Error("controlled failure");
      return "有效表达。";
    },
    now: () => "2026-10-31T01:02:03Z",
  });
  assert.equal(result.manifest.output.status, "completed_with_failures");
  assert.equal(result.manifest.output.call_count, 3);
  assert.equal(result.manifest.output.failure_count, 1);
  assert.equal(result.manifest.failures.length, 1);
  assert.equal(result.manifest.failures[0].error, "controlled failure");
  assert.equal(result.pack.candidates.length, 2);
});

test("accepted 必须有人工审核，缺 boundary 的候选被拒绝", async () => {
  const result = await generateBatch(manifestFixture(), {
    corpus,
    personas: loadPersonaSidecar(ROOT).personas,
    executeCell: createOfflineExecutor(),
  });
  const accepted = structuredClone(result.pack.candidates[0]);
  accepted.review.status = "accepted";
  assert(validateCandidatePack({ ...result.pack, candidates: [accepted] }, { corpus }).errors.some((error) => error.code === "candidate_review_incomplete"));
  const missingBoundary = structuredClone(result.pack.candidates[0]);
  missingBoundary.boundary_tags = [];
  assert(validateCandidatePack({ ...result.pack, candidates: [missingBoundary] }, { corpus }).errors.some((error) => error.code === "candidate_boundary_missing"));
});

test("generation artifacts 原子落盘且旧 manifest/候选包不可覆盖", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b72-offline-"));
  const result = await generateBatch(manifestFixture(), {
    corpus,
    personas: loadPersonaSidecar(ROOT).personas,
    executeCell: createOfflineExecutor(),
  });
  writeGenerationArtifacts(dir, result);
  assert(fs.existsSync(path.join(dir, "generation-manifest.json")));
  assert(fs.existsSync(path.join(dir, "candidates.json")));
  assert.throws(() => writeGenerationArtifacts(dir, result), /不可覆盖/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("manifest 结构、预算与引用负例矩阵均有稳定错误码", () => {
  const personas = loadPersonaSidecar(ROOT).personas;
  const variants = [
    ["manifest_schema_mismatch", (value) => { value.schema = "wrong"; }],
    ["generation_id_invalid", (value) => { value.generation_id = "bad"; }],
    ["manifest_provenance_missing", (value) => { value.created_at = ""; }],
    ["base_corpus_sha_invalid", (value) => { value.base_corpus_sha = "bad"; }],
    ["prompt_template_sha_invalid", (value) => { value.generator.prompt_template_sha = "bad"; }],
    ["generator_field_missing", (value) => { delete value.generator.provider; }],
    ["generation_stage_invalid", (value) => { value.input.stage = "wrong"; }],
    ["asset_layer_invalid", (value) => { value.input.asset_layer = "wrong"; }],
    ["candidate_budget_invalid", (value) => { value.input.max_candidates = 0; }],
    ["call_budget_invalid", (value) => { value.budget.max_calls = 0; }],
    ["duration_budget_invalid", (value) => { value.budget.max_duration_minutes = 121; }],
    ["manifest_output_preregistration_required", (value) => { value.output.status = "completed"; }],
    ["target_unknown", (value) => { value.input.target_ids = ["F-unknown"]; }],
    ["state_unknown", (value) => { value.input.state_ids = ["S-unknown"]; }],
    ["source_case_unknown", (value) => { value.input.source_case_ids = ["seed-unknown"]; }],
    ["semantic_cell_invalid", (value) => { value.input.semantic_cells[1].semantic_cell_id = "cell-f1-readonly"; }],
    ["review_value_invalid", (value) => { value.input.semantic_cells[0].review_value = "wrong"; }],
    ["split_invalid", (value) => { value.input.semantic_cells[0].split = "regression"; }],
    ["cell_budget_invalid", (value) => { value.input.semantic_cells[0].max_variants = 0; }],
    ["cell_styles_missing", (value) => { value.input.semantic_cells[0].styles = []; }],
    ["persona_not_declared", (value) => { value.input.semantic_cells[0].persona_ids = ["p-careful-controller"]; }],
    ["semantic_cell_seed_missing", (value) => { value.input.semantic_cells[0].state_id = "S2-partial"; }],
  ];
  for (const [code, mutate] of variants) {
    const manifest = manifestFixture();
    mutate(manifest);
    const result = validateGenerationManifest(manifest, { corpus, personas });
    assert.equal(result.ok, false, code);
    assert(result.errors.some((error) => error.code === code), `${code}: ${JSON.stringify(result.errors)}`);
  }
});

test("persona sidecar 负例拒绝坏 id、重复、缺字段和空集合", () => {
  const valid = loadPersonaSidecar(ROOT);
  assert.deepEqual(validatePersonaSidecar(valid), []);
  const invalid = structuredClone(valid);
  invalid.schema = "wrong";
  invalid.frozen_at = "";
  invalid.personas[0].persona_id = "bad";
  invalid.personas[1].persona_id = "bad";
  delete invalid.personas[0].experience;
  delete invalid.personas[0].expression.brevity;
  delete invalid.personas[0].common_goals;
  const codes = validatePersonaSidecar(invalid).map((error) => error.code);
  for (const code of ["persona_schema_mismatch", "persona_freeze_metadata_missing", "persona_id_invalid", "persona_duplicate", "persona_field_missing", "persona_expression_missing"]) {
    assert(codes.includes(code), code);
  }
  assert(validatePersonaSidecar({ ...valid, personas: [] }).some((error) => error.code === "persona_empty"));
});

test("candidate pack 拒绝坏 schema/provenance/review 与缺执行上下文", async () => {
  const result = await generateBatch(manifestFixture(), {
    corpus,
    personas: loadPersonaSidecar(ROOT).personas,
    executeCell: createOfflineExecutor(),
  });
  const badSchema = { ...result.pack, schema: "wrong" };
  assert(validateCandidatePack(badSchema, { corpus }).errors.some((error) => error.code === "candidate_pack_schema_mismatch"));
  const noProvenance = { ...result.pack, generated_at: "" };
  assert(validateCandidatePack(noProvenance, { corpus }).errors.some((error) => error.code === "candidate_pack_provenance_missing"));
  const invalidStatus = structuredClone(result.pack.candidates[0]);
  invalidStatus.review.status = "wrong";
  assert(validateCandidatePack({ ...result.pack, candidates: [invalidStatus] }, { corpus }).errors.some((error) => error.code === "candidate_review_status_invalid"));
  const noCell = structuredClone(result.pack.candidates[0]);
  noCell.semantic_cell_id = "";
  assert(validateCandidatePack({ ...result.pack, candidates: [noCell] }, { corpus }).errors.some((error) => error.code === "semantic_cell_missing"));
  const noResponse = structuredClone(result.pack.candidates[0]);
  noResponse.raw_response = "";
  assert(validateCandidatePack({ ...result.pack, candidates: [noResponse] }, { corpus }).errors.some((error) => error.code === "candidate_metadata_missing"));
});

test("multi_turn candidate 保留 journey 层和候选序列类型，不冒称已执行旅程", async () => {
  const manifest = manifestFixture();
  manifest.input.stage = "multi_turn";
  manifest.input.asset_layer = "journey";
  const result = await generateBatch(manifest, {
    corpus,
    personas: loadPersonaSidecar(ROOT).personas,
    executeCell: createOfflineExecutor(),
  });
  assert(result.pack.candidates.every((candidate) => candidate.asset_layer === "journey"));
  assert(result.pack.candidates.every((candidate) => candidate.sequence_kind === "multi_turn_candidate"));
  assert.equal(result.pack.coverage.declared.layers.journey, 3);
  assert.deepEqual(result.pack.coverage.executed, {});
  assert.deepEqual(result.pack.coverage.evaluated, {});
});

test("无效 manifest 与缺执行器都 fail-fast，不产生隐式模型调用", async () => {
  const personas = loadPersonaSidecar(ROOT).personas;
  const invalid = manifestFixture();
  delete invalid.input.semantic_cells;
  await assert.rejects(() => generateBatch(invalid, { corpus, personas, executeCell: createOfflineExecutor() }), /semantic_cells_missing/);
  await assert.rejects(() => generateBatch(manifestFixture(), { corpus, personas }), /executeCell is required/);
});
