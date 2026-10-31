import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const GENERATOR_VERSION = "author-behavior-offline-generator/v1";
const MANIFEST_SCHEMA = "author-behavior-generation-manifest/v1";
const CANDIDATE_SCHEMA = "author-behavior-generation-candidates/v1";
const PERSONA_SCHEMA = "author-behavior-personas/v1";
const STAGES = ["calibration", "core_semantic", "persona_exploration", "multi_turn"];
const LAYERS = ["core", "exploration", "journey"];
const REVIEW_VALUES = ["new_boundary", "new_persona_behavior", "wording_variant"];
const REVIEW_STATUSES = ["pending", "shortlisted", "accepted", "rejected", "unknown"];
const SPLITS = ["dev", "holdout", "explore"];

const normalize = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const sha = (value) => createHash("sha256").update(String(value)).digest("hex");
const error = (code, detail) => ({ code, detail });

export function normalizedExpressionSha(expression) {
  return sha(normalize(expression));
}

function validatePersona(persona) {
  const errors = [];
  for (const field of [
    "experience",
    "delegation",
    "clarification_patience",
    "adoption_habits",
    "write_sensitivity",
    "correction_frequency",
    "long_input_habit",
    "multi_work_behavior",
    "multi_turn_tendency",
  ]) {
    if (!persona[field]) errors.push(error("persona_field_missing", `${persona.persona_id}:${field}`));
  }
  for (const field of ["narrative_preferences", "common_goals"]) {
    if (!Array.isArray(persona[field]) || persona[field].length === 0) {
      errors.push(error("persona_field_missing", `${persona.persona_id}:${field}`));
    }
  }
  return errors;
}

function validatePersonaExpression(persona) {
  return ["brevity", "formality", "reference_style", "language_mix", "typo_habit"]
    .filter((field) => !persona.expression?.[field])
    .map((field) => error("persona_expression_missing", `${persona.persona_id}:${field}`));
}

export function validatePersonaSidecar(sidecar) {
  const errors = [];
  if (sidecar?.schema !== PERSONA_SCHEMA) errors.push(error("persona_schema_mismatch", String(sidecar?.schema)));
  if (!sidecar?.frozen_at || !sidecar?.frozen_by) errors.push(error("persona_freeze_metadata_missing", ""));
  const ids = new Set();
  for (const persona of sidecar?.personas ?? []) {
    if (!/^p-[a-z0-9-]+$/.test(persona.persona_id ?? "")) {
      errors.push(error("persona_id_invalid", String(persona.persona_id)));
    }
    if (ids.has(persona.persona_id)) errors.push(error("persona_duplicate", persona.persona_id));
    ids.add(persona.persona_id);
    errors.push(...validatePersona(persona), ...validatePersonaExpression(persona));
  }
  if (!Array.isArray(sidecar?.personas) || sidecar.personas.length === 0) {
    errors.push(error("persona_empty", ""));
  }
  return errors;
}

export function loadPersonaSidecar(projectRoot) {
  const file = path.join(projectRoot, "quality/acceptance/author-behavior/personas.json");
  const sidecar = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = validatePersonaSidecar(sidecar);
  if (errors.length > 0) throw new Error(`persona sidecar invalid: ${JSON.stringify(errors)}`);
  return sidecar;
}

function validateManifestIdentity(manifest) {
  const errors = [];
  if (manifest?.schema !== MANIFEST_SCHEMA) errors.push(error("manifest_schema_mismatch", String(manifest?.schema)));
  if (!/^ab-[A-Za-z0-9-]+$/.test(manifest?.generation_id ?? "")) errors.push(error("generation_id_invalid", ""));
  if (!manifest.created_at || !manifest.git_head) errors.push(error("manifest_provenance_missing", ""));
  if (!/^[a-f0-9]{64}$/.test(manifest.base_corpus_sha ?? "")) errors.push(error("base_corpus_sha_invalid", ""));
  if (!/^[a-f0-9]{64}$/.test(manifest.generator?.prompt_template_sha ?? "")) errors.push(error("prompt_template_sha_invalid", ""));
  return errors;
}

function validateGenerator(generator) {
  return ["generator_version", "provider", "model", "actual_model"]
    .filter((field) => !generator?.[field])
    .map((field) => error("generator_field_missing", field));
}

function validateManifestShape(manifest) {
  const errors = [];
  if (!STAGES.includes(manifest.input?.stage)) errors.push(error("generation_stage_invalid", String(manifest.input?.stage)));
  if (!LAYERS.includes(manifest.input?.asset_layer)) errors.push(error("asset_layer_invalid", String(manifest.input?.asset_layer)));
  if (manifest.privacy?.synthetic_only !== true || manifest.privacy?.real_work_data !== false) {
    errors.push(error("privacy_violation", "only synthetic assets are allowed"));
  }
  if (!manifest.output?.candidate_uri || manifest.output.status !== "preregistered") {
    errors.push(error("manifest_output_preregistration_required", ""));
  }
  return errors;
}

function validateManifestBudget(manifest) {
  const errors = [];
  if (!Number.isInteger(manifest.input?.max_candidates) || manifest.input.max_candidates < 1 || manifest.input.max_candidates > 500) {
    errors.push(error("candidate_budget_invalid", String(manifest.input?.max_candidates)));
  }
  if (manifest.input?.stage === "calibration" && manifest.input.max_candidates > 60) {
    errors.push(error("calibration_budget_exceeded", String(manifest.input.max_candidates)));
  }
  if (!Number.isInteger(manifest.budget?.max_calls) || manifest.budget.max_calls < manifest.input?.max_candidates) {
    errors.push(error("call_budget_invalid", String(manifest.budget?.max_calls)));
  }
  if (!Number.isInteger(manifest.budget?.max_duration_minutes) || manifest.budget.max_duration_minutes < 1 || manifest.budget.max_duration_minutes > 120) {
    errors.push(error("duration_budget_invalid", String(manifest.budget?.max_duration_minutes)));
  }
  return errors;
}

function validateManifestBasics(manifest) {
  return [
    ...validateManifestIdentity(manifest),
    ...validateGenerator(manifest.generator),
    ...validateManifestShape(manifest),
    ...validateManifestBudget(manifest),
  ];
}

function validateManifestReferences(manifest, corpus, personas) {
  const errors = [];
  const targetIds = new Set((corpus.targets?.targets ?? []).map((target) => target.id));
  const stateIds = new Set((corpus.states?.states ?? []).map((state) => state.id));
  const personaIds = new Set(personas.map((persona) => persona.persona_id));
  const sourceCases = corpus.cases?.cases ?? [];
  for (const targetId of manifest.input.target_ids ?? []) {
    if (!targetIds.has(targetId)) errors.push(error("target_unknown", targetId));
  }
  for (const stateId of manifest.input.state_ids ?? []) {
    if (!stateIds.has(stateId)) errors.push(error("state_unknown", stateId));
  }
  for (const personaId of manifest.input.persona_ids ?? []) {
    if (!personaIds.has(personaId)) errors.push(error("persona_unknown", personaId));
  }
  for (const sourceId of manifest.input.source_case_ids ?? []) {
    if (!sourceCases.some((testCase) => testCase.id === sourceId)) errors.push(error("source_case_unknown", sourceId));
  }
  return errors;
}

function validateCellShape(cell) {
  const errors = [];
  if (!Array.isArray(cell.boundary_tags) || cell.boundary_tags.length === 0) {
    errors.push(error("candidate_boundary_missing", cell.semantic_cell_id));
  }
  if (!REVIEW_VALUES.includes(cell.review_value)) errors.push(error("review_value_invalid", cell.semantic_cell_id));
  if (cell.split && !SPLITS.includes(cell.split)) errors.push(error("split_invalid", cell.semantic_cell_id));
  if (!Number.isInteger(cell.max_variants) || cell.max_variants < 1 || cell.max_variants > 20) {
    errors.push(error("cell_budget_invalid", cell.semantic_cell_id));
  }
  if (!Array.isArray(cell.styles) || cell.styles.length === 0) errors.push(error("cell_styles_missing", cell.semantic_cell_id));
  return errors;
}

function validateCellReferences(cell, manifest, corpus, personas) {
  const errors = [];
  const targetIds = new Set((corpus.targets?.targets ?? []).map((target) => target.id));
  const stateIds = new Set((corpus.states?.states ?? []).map((state) => state.id));
  const personaIds = new Set(personas.map((persona) => persona.persona_id));
  const declaredPersonaIds = new Set(manifest.input.persona_ids ?? []);
  const sourceIds = new Set(manifest.input.source_case_ids ?? []);
  const sourceCases = corpus.cases?.cases ?? [];
  if (!targetIds.has(cell.target_id)) errors.push(error("target_unknown", cell.target_id));
  if (!stateIds.has(cell.state_id)) errors.push(error("state_unknown", cell.state_id));
  for (const personaId of cell.persona_ids ?? []) {
    if (!personaIds.has(personaId)) errors.push(error("persona_unknown", personaId));
    if (!declaredPersonaIds.has(personaId)) errors.push(error("persona_not_declared", personaId));
  }
  if (!sourceCases.some((testCase) => sourceIds.has(testCase.id) && testCase.target_id === cell.target_id && testCase.state_id === cell.state_id)) {
    errors.push(error("semantic_cell_seed_missing", cell.semantic_cell_id));
  }
  return errors;
}

function validateManifestInputs(manifest, corpus, personas) {
  const errors = validateManifestReferences(manifest, corpus, personas);
  const cellIds = new Set();
  for (const cell of manifest.input.semantic_cells ?? []) {
    if (!cell.semantic_cell_id || cellIds.has(cell.semantic_cell_id)) errors.push(error("semantic_cell_invalid", String(cell.semantic_cell_id)));
    cellIds.add(cell.semantic_cell_id);
    errors.push(...validateCellShape(cell), ...validateCellReferences(cell, manifest, corpus, personas));
  }
  if (!Array.isArray(manifest.input.semantic_cells) || manifest.input.semantic_cells.length === 0) {
    errors.push(error("semantic_cells_missing", ""));
  }
  return errors;
}

export function validateGenerationManifest(manifest, { corpus, personas }) {
  return {
    ok: validateManifestBasics(manifest).length + validateManifestInputs(manifest, corpus, personas).length === 0,
    errors: [...validateManifestBasics(manifest), ...validateManifestInputs(manifest, corpus, personas)],
  };
}

function selectSeedCase(corpus, cell) {
  const sourceIds = new Set(cell.source_case_ids ?? []);
  const allowed = (corpus.cases?.cases ?? []).filter(
    (testCase) =>
      testCase.target_id === cell.target_id &&
      testCase.state_id === cell.state_id &&
      (sourceIds.size === 0 || sourceIds.has(testCase.id)),
  );
  return allowed[0] ?? null;
}

function makeCandidate({ manifest, cell, persona, style, seedCase, rawResponse, index }) {
  const expression = normalize(rawResponse);
  return {
    candidate_id: `${manifest.generation_id}-${String(index).padStart(3, "0")}`,
    generation_id: manifest.generation_id,
    target_id: cell.target_id,
    state_id: cell.state_id,
    persona_id: persona.persona_id,
    asset_layer: manifest.input.asset_layer,
    expression,
    style,
    source_refs: [
      `generation:${manifest.generation_id}`,
      `seed-case:${seedCase.id}`,
      `persona:${persona.persona_id}`,
      `semantic-cell:${cell.semantic_cell_id}`,
    ],
    sequence_kind: manifest.input.stage === "multi_turn" ? "multi_turn_candidate" : "single_turn",
    boundary_tags: [...cell.boundary_tags],
    semantic_cell_id: cell.semantic_cell_id,
    expected: structuredClone(seedCase.expected),
    normalized_expression_sha: normalizedExpressionSha(expression),
    review: { status: "pending", value: cell.review_value, reviewer: null, reviewed_at: null, notes: "" },
    flags: [],
    split_suggestion: cell.split ?? "dev",
    raw_response: String(rawResponse ?? ""),
  };
}

function markDuplicates(candidates, corpus) {
  const existing = new Map();
  for (const testCase of corpus.cases?.cases ?? []) {
    const key = normalize(testCase.expression);
    existing.set(key, [...(existing.get(key) ?? []), testCase.split]);
  }
  const generated = new Map();
  return candidates.map((candidate) => {
    const key = normalize(candidate.expression);
    const previousSplits = generated.get(key) ?? [];
    const existingSplits = existing.get(key) ?? [];
    const flags = new Set(candidate.flags);
    if (previousSplits.length > 0 || existingSplits.length > 0) flags.add("duplicate_exact");
    const splits = [candidate.split_suggestion, ...previousSplits, ...existingSplits];
    if (splits.includes("holdout") && (splits.includes("dev") || splits.includes("regression"))) {
      flags.add("holdout_leak");
    }
    generated.set(key, [...previousSplits, candidate.split_suggestion]);
    return { ...candidate, flags: [...flags].sort() };
  });
}

function buildCoverage(candidates) {
  const layers = Object.fromEntries(
    LAYERS.map((layer) => [layer, candidates.filter((candidate) => candidate.asset_layer === layer).length]),
  );
  const statuses = Object.fromEntries(
    REVIEW_STATUSES.map((status) => [
      status,
      candidates.filter((candidate) => candidate.review.status === status).length,
    ]),
  );
  const personas = [...new Set(candidates.map((candidate) => candidate.persona_id))].map((personaId) => {
    const rows = candidates.filter((candidate) => candidate.persona_id === personaId);
    return {
      persona_id: personaId,
      candidates: rows.length,
      target_ids: [...new Set(rows.map((row) => row.target_id))],
      state_ids: [...new Set(rows.map((row) => row.state_id))],
      boundary_tags: [...new Set(rows.flatMap((row) => row.boundary_tags))],
      styles: [...new Set(rows.map((row) => row.style))],
      splits: [...new Set(rows.map((row) => row.split_suggestion))],
      accepted: rows.filter((row) => row.review.status === "accepted").length,
    };
  });
  const cells = [...new Set(candidates.map((candidate) => candidate.semantic_cell_id))].map((cellId) => {
    const rows = candidates.filter((candidate) => candidate.semantic_cell_id === cellId);
    return {
      semantic_cell_id: cellId,
      candidates: rows.length,
      persona_ids: [...new Set(rows.map((row) => row.persona_id))],
      boundary_tags: [...new Set(rows.flatMap((row) => row.boundary_tags))],
      splits: [...new Set(rows.map((row) => row.split_suggestion))],
    };
  });
  return {
    declared: {
      candidates: candidates.length,
      ...statuses,
      layers,
      review_values: Object.fromEntries(REVIEW_VALUES.map((value) => [value, candidates.filter((candidate) => candidate.review.value === value).length])),
    },
    personas,
    semantic_cells: cells,
    executed: {},
    evaluated: {},
  };
}

export async function generateBatch(manifest, { corpus, personas, executeCell, now = () => new Date().toISOString() }) {
  const validation = validateGenerationManifest(manifest, { corpus, personas });
  if (!validation.ok) throw new Error(`generation manifest invalid: ${JSON.stringify(validation.errors)}`);
  if (typeof executeCell !== "function") throw new Error("executeCell is required; no default model is invoked");

  const candidates = [];
  const failures = [];
  let calls = 0;
  outer: for (const cell of manifest.input.semantic_cells) {
    const seedCase = selectSeedCase(corpus, { ...cell, source_case_ids: manifest.input.source_case_ids });
    let cellVariants = 0;
    cellLoop: for (const style of cell.styles) {
      for (const personaId of cell.persona_ids) {
        const persona = personas.find((entry) => entry.persona_id === personaId);
        if (cellVariants >= cell.max_variants) break cellLoop;
        if (calls >= manifest.input.max_candidates || calls >= manifest.budget.max_calls) break outer;
        calls += 1;
        cellVariants += 1;
        try {
          const rawResponse = await executeCell({ manifest, cell, persona, style, seedCase });
          candidates.push(makeCandidate({ manifest, cell, persona, style, seedCase, rawResponse, index: candidates.length + 1 }));
        } catch (cause) {
          failures.push({
            semantic_cell_id: cell.semantic_cell_id,
            persona_id: personaId,
            style,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    }
  }

  const marked = markDuplicates(candidates, corpus);
  const status = failures.length > 0 ? "completed_with_failures" : "completed";
  const pack = {
    schema: CANDIDATE_SCHEMA,
    generation_id: manifest.generation_id,
    generated_at: now(),
    candidates: marked,
    coverage: buildCoverage(marked),
  };
  const finalized = {
    ...manifest,
    output: {
      ...manifest.output,
      status,
      candidate_count: marked.length,
      call_count: calls,
      failure_count: failures.length,
      candidate_sha: sha(JSON.stringify(pack)),
      finished_at: now(),
    },
    failures,
  };
  return { manifest: finalized, pack };
}

function validateCandidateReview(candidate) {
  const errors = [];
  if (candidate.review?.status === "accepted" && (!candidate.review.reviewer || !candidate.review.reviewed_at)) {
    errors.push(error("candidate_review_incomplete", candidate.candidate_id));
  }
  if (!REVIEW_STATUSES.includes(candidate.review?.status)) errors.push(error("candidate_review_status_invalid", candidate.candidate_id));
  if (candidate.flags?.includes("holdout_leak")) errors.push(error("candidate_holdout_leak", candidate.candidate_id));
  return errors;
}

function validateCandidate(candidate) {
  const errors = [];
  if (!Array.isArray(candidate.boundary_tags) || candidate.boundary_tags.length === 0) {
    errors.push(error("candidate_boundary_missing", candidate.candidate_id));
  }
  if (!candidate.semantic_cell_id) errors.push(error("semantic_cell_missing", candidate.candidate_id));
  if (!candidate.persona_id || !candidate.asset_layer || !candidate.raw_response) {
    errors.push(error("candidate_metadata_missing", candidate.candidate_id));
  }
  errors.push(...validateCandidateReview(candidate));
  return errors;
}

export function validateCandidatePack(pack, { corpus: _corpus }) {
  const errors = [];
  if (pack?.schema !== CANDIDATE_SCHEMA) errors.push(error("candidate_pack_schema_mismatch", String(pack?.schema)));
  if (!pack?.generation_id || !pack.generated_at) errors.push(error("candidate_pack_provenance_missing", ""));
  for (const candidate of pack?.candidates ?? []) errors.push(...validateCandidate(candidate));
  return { ok: errors.length === 0, errors };
}

export function createOfflineExecutor() {
  const styles = {
    brief: { prefix: "", suffix: "" },
    hesitant: { prefix: "我有点不确定，", suffix: "" },
    self_correcting: { prefix: "先等等，", suffix: "，按这个来。" },
  };
  return async ({ seedCase, style }) => {
    const rule = styles[style] ?? { prefix: `${style}：`, suffix: "" };
    return normalize(`${rule.prefix}${seedCase.expression}${rule.suffix}`);
  };
}

export function writeGenerationArtifacts(dir, result) {
  const manifestPath = path.join(dir, "generation-manifest.json");
  const candidatesPath = path.join(dir, "candidates.json");
  if (fs.existsSync(manifestPath) || fs.existsSync(candidatesPath)) {
    throw new Error(`旧 manifest/候选包不可覆盖: ${dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    ...result.manifest,
    output: { ...result.manifest.output, candidate_uri: candidatesPath },
  };
  try {
    fs.writeFileSync(candidatesPath, `${JSON.stringify(result.pack, null, 2)}\n`, { flag: "wx" });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  } catch (cause) {
    fs.rmSync(manifestPath, { force: true });
    fs.rmSync(candidatesPath, { force: true });
    throw cause;
  }
  return { manifestPath, candidatesPath };
}
