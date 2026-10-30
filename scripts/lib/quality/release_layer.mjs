// B42 CP1：release / release-real-llm 结果层。
//
// 契约（CP0 §6.4 冻结，additive sidecar，不动 B41 quality-verdict/v2）：
//   schema_version = quality-release-layer/v1
//
// 职责：
// - 把一次 release-tier（确定性 provider）或 release-real-llm（真实模型 provider）运行
//   汇总成**分层**结果：机制证据（mechanism）与模型行为证据（model_behavior）分开，
//   确定性 provider 结果与真实模型结果分开，不合并成单一 PASS；
// - 每个结果保留可回放身份：provider / provider_class / model / actual_model / driver /
//   surface / params / attempt / timeouts / git_head / artifact_dir / 输入与保留措辞 ref；
// - 真实 provider PASS 反假绿：HTTP 200、局部证据、单次运行、缺保留措辞、缺
//   actual_model/driver/params、观察未进入后续真实请求（CP2 evidence chain）、原生 run
//   为 fail/scoped（CP3 native run manifest）都不得写成模型语义 PASS；
// - B42 §12 必需证据完整性：证据链一律重算（不信任输入携带的 binding 摘要），按场景
//   声明逐维度判定 required / not_applicable；必需证据缺失/未执行/未知 → evidence_missing，
//   硬违规仍 fail，只有各字段完整且适用条件满足才 PASS；
// - 当前 release/release-real-llm 均 0 注册场景是已知事实：空 tier 必须报
//   not_run + empty_tier（exit 65），不能当 PASS 或"全过"。
//
// 本模块是纯函数层；读 batch/verdict/artifact 的 I/O 在 release_layer_cli.mjs。

import fs from "node:fs";
import path from "node:path";
import {
  applyLegacyEvidenceFlags,
  classifyProvider,
  evaluateEvidenceChain,
  evaluateEvidenceCompleteness,
} from "./evidence_chain.mjs";
import { NATIVE_DRIVERS } from "./native_run_manifest.mjs";

export const RELEASE_LAYER_SCHEMA_VERSION = "quality-release-layer/v1";
export const RELEASE_LAYER_FILE = "release-layer.json";

export const RELEASE_TIERS = Object.freeze(["release", "release-real-llm"]);

// tier 固定的结果层归属：release 只承载确定性机制证据；release-real-llm 承载真实模型行为证据。
export const TIER_CLASS = Object.freeze({
  release: "deterministic",
  "release-real-llm": "real_model",
});

export const RELEASE_LAYER_STATUSES = Object.freeze([
  "pass",
  "fail",
  "skipped",
  "not_run",
  "evidence_missing",
]);

export const MODEL_BEHAVIOR_ELIGIBILITY = Object.freeze([
  "eligible",
  "ineligible",
  "not_applicable",
  "unknown",
]);

// 默认独立重复次数：关键缺事实场景至少 2 次且全过（AU-15 §2 冻结）。
export const DEFAULT_PLANNED_RUNS = Object.freeze({ release: 1, "release-real-llm": 2 });

export const EXIT_CODES = Object.freeze({
  pass: 0,
  fail: 1,
  skipped: 65,
  not_run: 69,
  evidence_missing: 67,
  usage: 64,
  config: 66,
});

export const REASON_CODES = Object.freeze([
  "empty_tier",
  "known_fact_empty_tier",
  "tier_provider_class_mismatch",
  "deterministic_tier_model_behavior_pass",
  "provider_not_real_model",
  "no_real_provider_call",
  "http_200_only",
  "provider_response_body_missing",
  "model_behavior_layer_missing",
  "insufficient_repeats",
  "repeat_failure_in_denominator",
  "missing_retention_wording",
  "missing_model_identity",
  "missing_model_params",
  "missing_driver_identity",
  "driver_not_native",
  "observation_not_linked",
  "evidence_chain_missing",
  "evidence_chain_violated",
  "evidence_chain_unknown",
  "native_run_not_pass",
  "native_failure_present",
  "native_scope_not_full",
  "mechanism_layer_missing",
  "mechanism_not_pass",
  "blocked_scenarios_present",
  "batch_failure",
  "batch_missing",
  "timeouts_in_denominator",
  // B42 §12：必需证据完整性（缺必需证据 = evidence_missing，不得 PASS）。
  "required_evidence_missing",
  "required_base_refs_missing",
  "required_observations_missing",
  "required_observation_link_missing",
  "required_source_metadata_missing",
  "required_used_context_refs_missing",
  "required_preparation_missing",
  "required_restore_missing",
  "required_replay_evidence_missing",
  "evidence_chain_partial",
  "evidence_chain_invalid",
  "evidence_requirements_invalid",
  // B42 §13：实际请求输入绑定（缺失/未知 → evidence_missing；矛盾 → fail）。
  "evidence_chain_derived_mismatch",
  "observation_inclusion_unknown",
  "observation_call_order_unknown",
  "observation_not_included_in_request",
  "used_context_refs_call_unknown",
]);

// 证据链 blocker → 场景声明维度（B42 §12/§13）：声明 not_applicable 的维度不阻塞 PASS。
const BLOCKER_DIMENSION = Object.freeze({
  base_refs_unknown: "base_refs",
  used_context_refs_unknown: "used_context_refs",
  observation_metadata_missing: "source_metadata",
  preparation_outcome_unknown: "preparation",
  stale_on_restore_unknown: "restore",
  observation_not_linked_to_provider_call: "observation_link",
  // B42 §13：请求侧包含/顺序未记录或无请求侧同源证据 → observation_link 维度不足。
  observation_inclusion_unknown: "observation_link",
  observation_call_order_unknown: "observation_link",
  observation_not_included_in_request: "observation_link",
  used_context_refs_call_unknown: "used_context_refs",
});

export class ReleaseLayerError extends Error {
  constructor(message, code = "invalid_release_layer", errors = []) {
    super(message);
    this.name = "ReleaseLayerError";
    this.code = code;
    this.errors = errors;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function stringOrNull(value) {
  return nonEmptyString(value) ? value.trim() : null;
}

function timestampOrNull(value) {
  if (!nonEmptyString(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value.trim();
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!nonEmptyString(value)) continue;
    const token = value.trim();
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function tierClassFor(tier) {
  return TIER_CLASS[tier] ?? null;
}

export function exitCodeForReleaseStatus(status) {
  const code = EXIT_CODES[status];
  if (code === undefined) {
    throw new ReleaseLayerError(`未知 release layer status：${status}`, "invalid_status");
  }
  return code;
}

// ---------- 模型行为证据门（CP1 反假绿 + CP2/CP3 接入） ----------

/**
 * 判断一条结果是否具备“模型语义 PASS”资格。任何一项不满足都不得 PASS。
 *
 * @param {object} input
 * @param {string} input.tier release | release-real-llm
 * @param {object} input.result 单场景结果（见 buildReleaseLayerSummary）
 * @param {number} [input.plannedRuns] 该场景独立重复次数要求
 * @param {object|null} [input.retentionWording] {text, ref, tuned:false}
 */
export function evaluateModelBehaviorEvidence(input = {}) {
  const tier = input.tier;
  const result = isPlainObject(input.result) ? input.result : {};
  const plannedRuns = Number.isInteger(input.plannedRuns)
    ? input.plannedRuns
    : DEFAULT_PLANNED_RUNS[tier];
  const retention = isPlainObject(result.retention_wording)
    ? result.retention_wording
    : isPlainObject(input.retentionWording)
      ? input.retentionWording
      : null;
  const codes = [];
  const details = {};

  if (tier === "release") {
    // 确定性 provider 的 release 层只能承载机制证据；模型行为必须显式 not_applicable。
    const layer = result.model_behavior;
    if (isPlainObject(layer) && layer.status === "pass") {
      codes.push("deterministic_tier_model_behavior_pass");
    }
    return {
      eligibility: codes.length > 0 ? "ineligible" : "not_applicable",
      status: codes.length > 0 ? "fail" : "not_applicable",
      reason_codes: uniqueStrings(codes),
      checks: { deterministic_tier: true },
    };
  }

  if (tier !== "release-real-llm") {
    throw new ReleaseLayerError(`未知 release tier：${tier}`, "config", [`未知 tier ${tier}`]);
  }

  const provider = stringOrNull(result.provider);
  const providerClass = classifyProvider(provider);
  details.provider_class = providerClass;
  if (providerClass !== "real_model") {
    codes.push("provider_not_real_model");
  }

  const behavior = isPlainObject(result.model_behavior) ? result.model_behavior : null;
  if (!behavior || !nonEmptyString(behavior.status)) {
    codes.push("model_behavior_layer_missing");
  } else if (behavior.status !== "pass") {
    // unknown/fail/not_applicable 都不能成为真实模型语义 PASS。
    if (behavior.status === "not_applicable") codes.push("model_behavior_layer_missing");
  }

  // 真实 provider 请求与响应正文：HTTP 200 只是传输事实，不是模型行为证据。
  const evidence = isPlainObject(result.model_behavior_evidence) ? result.model_behavior_evidence : {};
  const realProviderCalls = numberOrNull(evidence.real_provider_calls) ?? 0;
  const responsesWithBody = numberOrNull(evidence.provider_responses_with_body) ?? 0;
  const http2xx = numberOrNull(evidence.http_2xx) ?? 0;
  details.real_provider_calls = realProviderCalls;
  details.provider_responses_with_body = responsesWithBody;
  details.http_2xx = http2xx;
  if (realProviderCalls < 1) codes.push("no_real_provider_call");
  if (responsesWithBody < 1) {
    codes.push(http2xx > 0 ? "http_200_only" : "provider_response_body_missing");
  }

  // 重复与失败分母：独立 run 计分母，timeout/格式失败也算失败，不能被重试洗掉。
  const runs = Array.isArray(result.runs) ? result.runs : [];
  const attempt = Number.isInteger(result.attempt) ? result.attempt : null;
  const attempted = Math.max(runs.length, attempt ?? 0);
  const runStatuses = runs.map((run) => stringOrNull(run?.status)).filter(Boolean);
  const failedRuns = runStatuses.filter((status) => status !== "pass");
  const passRuns = runStatuses.filter((status) => status === "pass");
  const planned = Number.isInteger(plannedRuns) ? plannedRuns : DEFAULT_PLANNED_RUNS["release-real-llm"];
  details.planned_runs = planned;
  details.attempted_runs = attempted;
  details.failed_runs = failedRuns.length;
  details.passed_runs = passRuns.length;
  if (attempted < planned) codes.push("insufficient_repeats");
  if (failedRuns.length > 0) codes.push("repeat_failure_in_denominator");
  const timeouts = Number.isInteger(result.timeouts) ? result.timeouts : 0;
  details.timeouts = timeouts;
  if (timeouts > 0 && behavior?.status === "pass") codes.push("timeouts_in_denominator");

  // 保留措辞：至少一种未参与调词的措辞必须留痕。
  if (!retention || !nonEmptyString(retention.text) || !nonEmptyString(retention.ref)) {
    codes.push("missing_retention_wording");
  } else if (retention.tuned === true) {
    codes.push("missing_retention_wording");
    details.retention_wording = "tuned_wording_only";
  } else {
    details.retention_wording = retention.text;
  }

  // 身份可回放：model/actual_model 必须如实记录；driver 必须是真实原生/外部驱动。
  const model = stringOrNull(result.model);
  const actualModel = stringOrNull(result.actual_model);
  details.model = model;
  details.actual_model = actualModel;
  if (!model || !actualModel) {
    codes.push("missing_model_identity");
  } else if (model !== actualModel && !nonEmptyString(result.actual_model_mismatch_reason)) {
    codes.push("missing_model_identity");
  }
  const driver = stringOrNull(result.driver);
  details.driver = driver;
  if (!driver) {
    codes.push("missing_driver_identity");
  } else if (!NATIVE_DRIVERS.includes(driver)) {
    codes.push("driver_not_native");
  }
  const params = result.params;
  if (!isPlainObject(params) || Object.keys(params).length === 0) {
    codes.push("missing_model_params");
  } else {
    details.params = params;
  }

  // CP2 + B42 §12：证据链必须“重算”，不能只信任输入携带的 binding 摘要；
  // 必需证据按场景声明判定完整性（缺必需字段 → evidence_missing，硬违规 → fail）。
  const chain = isPlainObject(result.evidence_chain) ? result.evidence_chain : null;
  const requirementsError = stringOrNull(result.evidence_requirements_error);
  if (requirementsError) codes.push("evidence_requirements_invalid");
  if (stringOrNull(result.evidence_chain_error)) codes.push("evidence_chain_invalid");
  if (chain) {
    let requirements = null;
    if (!requirementsError) {
      try {
        requirements = applyLegacyEvidenceFlags(result.evidence_requirements ?? null, {
          requiresObservationLink: result.requires_observation_link === true,
        });
      } catch (error) {
        throw new ReleaseLayerError(
          `场景 evidence_requirements 非法：${error.message}`,
          "config",
          Array.isArray(error.errors) && error.errors.length > 0 ? error.errors : [error.message],
        );
      }
    }
    const binding = evaluateEvidenceChain(chain);
    details.evidence_binding = binding.binding_status;
    if (isPlainObject(chain.binding) && chain.binding.binding_status !== binding.binding_status) {
      details.evidence_binding_summary_mismatch = true;
    }
    // B42 §13：序列化的 links/blockers/violations 缓存与原始字段重算不一致 → 不能 PASS。
    if (binding.derived_mismatch === true) {
      details.evidence_chain_derived_mismatch = true;
      codes.push("evidence_chain_derived_mismatch");
    }
    if (binding.violations.length > 0) {
      codes.push("evidence_chain_violated");
      for (const violation of binding.violations) codes.push(violation.code);
    }
    // blocker 按场景声明归因：声明 not_applicable 的维度不阻塞 PASS，但仍记入明细可审计；
    // required 维度或无法归因的 blocker 仍阻塞（原因传播，不吞）。
    const blockingBlockers = binding.blockers.filter((blocker) => {
      const dimension = BLOCKER_DIMENSION[blocker];
      return dimension === undefined || requirements === null || requirements.dimensions[dimension] !== "not_applicable";
    });
    details.evidence_blockers = binding.blockers;
    details.evidence_blocking_blockers = blockingBlockers;
    for (const blocker of blockingBlockers) codes.push(blocker);
    if (requirements) {
      const completeness = evaluateEvidenceCompleteness(chain, requirements);
      details.evidence_requirements = completeness.requirements;
      details.evidence_completeness = {
        status: completeness.status,
        missing_required: completeness.missing_required,
      };
      codes.push(...completeness.reason_codes);
      codes.push(...completeness.fail_codes);
      if (completeness.status !== "complete") {
        codes.push("required_evidence_missing");
      } else if (blockingBlockers.length > 0) {
        // 必需维度齐但仍有未被声明覆盖的 blocker：保守按证据不全，不写 PASS。
        codes.push("evidence_chain_partial");
      }
    } else {
      // 声明不可用（artifact 声明损坏）→ 无法判定完整性，只能 evidence_missing。
      details.evidence_completeness = { status: "unknown", missing_required: [] };
      codes.push("required_evidence_missing");
    }
  } else {
    // 真模行为 PASS 必须有 CP2 证据链：没有链就是“局部证据”，不能写成模型语义 PASS。
    codes.push("evidence_chain_missing");
  }

  // CP3：原生 run manifest 为 fail 时不得 PASS；scoped 结果不能当全矩阵。
  const nativeRun = isPlainObject(result.native_run) ? result.native_run : null;
  if (nativeRun) {
    details.native_run_status = nativeRun.status;
    if (nativeRun.failure?.found === true) codes.push("native_failure_present");
    if (nativeRun.status !== "pass") codes.push("native_run_not_pass");
    if (nativeRun.status === "pass" && nativeRun.full_matrix_established !== true && result.requires_full_matrix === true) {
      codes.push("native_scope_not_full");
    }
  }

  // 判定语义：
  // ineligible = 已有证据直接否定“模型语义 PASS”声明（假绿/违反冻结判据），必须 fail；
  // unknown    = 证据不足以支持声明（缺字段/缺观察链），必须 evidence_missing；
  // eligible   = 全部判据满足。
  const ineligibleCodes = [
    "provider_not_real_model",
    "deterministic_tier_model_behavior_pass",
    "no_real_provider_call",
    "http_200_only",
    "provider_response_body_missing",
    "repeat_failure_in_denominator",
    "insufficient_repeats",
    "missing_retention_wording",
    "evidence_chain_violated",
    "native_failure_present",
    "native_run_not_pass",
    "native_scope_not_full",
    "timeouts_in_denominator",
    "driver_not_native",
    "observation_not_linked",
  ];
  let eligibility;
  if (codes.length === 0) eligibility = "eligible";
  else if (codes.some((code) => ineligibleCodes.includes(code))) eligibility = "ineligible";
  else eligibility = "unknown";

  return {
    eligibility,
    status: eligibility === "eligible" ? "pass" : eligibility === "ineligible" ? "fail" : "evidence_missing",
    reason_codes: uniqueStrings(codes),
    checks: details,
  };
}

// ---------- 分层汇总 ----------

function normalizeLayer(layer) {
  if (!isPlainObject(layer)) return { status: "unknown", evidence_refs: [] };
  return {
    status: ["pass", "fail", "unknown", "not_applicable"].includes(layer.status) ? layer.status : "unknown",
    evidence_refs: uniqueStrings(layer.evidence_refs ?? []),
  };
}

function normalizeRun(run, index) {
  if (!isPlainObject(run)) return null;
  return {
    attempt: Number.isInteger(run.attempt) ? run.attempt : index + 1,
    status: ["pass", "fail", "skipped", "not_run", "evidence_missing"].includes(run.status)
      ? run.status
      : "evidence_missing",
    artifact_dir: stringOrNull(run.artifact_dir),
    git_head: stringOrNull(run.git_head),
    started_at: timestampOrNull(run.started_at),
    finished_at: timestampOrNull(run.finished_at),
    reason: stringOrNull(run.reason),
  };
}

function normalizeResult(raw) {
  const result = isPlainObject(raw) ? raw : {};
  return {
    scenario_id: stringOrNull(result.scenario_id) ?? "unknown",
    status: ["pass", "fail", "skipped", "not_run", "evidence_missing"].includes(result.status)
      ? result.status
      : "evidence_missing",
    reason: stringOrNull(result.reason),
    artifact_dir: stringOrNull(result.artifact_dir),
    surface: stringOrNull(result.surface),
    provider: stringOrNull(result.provider),
    provider_class: classifyProvider(result.provider),
    driver: stringOrNull(result.driver),
    model: stringOrNull(result.model),
    actual_model: stringOrNull(result.actual_model),
    actual_model_mismatch_reason: stringOrNull(result.actual_model_mismatch_reason),
    attempt: Number.isInteger(result.attempt) ? result.attempt : null,
    timeouts: Number.isInteger(result.timeouts) ? result.timeouts : 0,
    git_head: stringOrNull(result.git_head),
    generated_at: timestampOrNull(result.generated_at),
    started_at: timestampOrNull(result.started_at),
    finished_at: timestampOrNull(result.finished_at),
    params: isPlainObject(result.params) ? result.params : null,
    input_ref: stringOrNull(result.input_ref ?? result.input_set_ref),
    retention_wording_ref: stringOrNull(result.retention_wording_ref),
    retention_wording: isPlainObject(result.retention_wording) ? result.retention_wording : null,
    mechanism: normalizeLayer(result.mechanism),
    model_behavior: normalizeLayer(result.model_behavior),
    model_behavior_evidence: isPlainObject(result.model_behavior_evidence)
      ? result.model_behavior_evidence
      : null,
    evidence_chain: isPlainObject(result.evidence_chain) ? result.evidence_chain : null,
    evidence_chain_error: stringOrNull(result.evidence_chain_error),
    evidence_requirements: isPlainObject(result.evidence_requirements) ? result.evidence_requirements : null,
    evidence_requirements_error: stringOrNull(result.evidence_requirements_error),
    native_run: isPlainObject(result.native_run) ? result.native_run : null,
    requires_observation_link: result.requires_observation_link === true,
    requires_full_matrix: result.requires_full_matrix === true,
    runs: Array.isArray(result.runs) ? result.runs.map(normalizeRun).filter(Boolean) : [],
    reason_codes: uniqueStrings(result.reason_codes ?? []),
  };
}

function evaluateResult({ tier, result, plannedRuns, retentionWording, batchProvider }) {
  const effectiveProvider = result.provider ?? batchProvider ?? null;
  const providerClass = classifyProvider(effectiveProvider);
  const reasons = [...result.reason_codes];
  let status = result.status;

  if (["fail", "skipped", "not_run", "evidence_missing"].includes(status)) {
    return { state: status === "skipped" ? "skipped" : status, reasons, behavior: null };
  }
  // 执行层 pass 之后，仍需满足分层与身份要求才能算本结果层 PASS。
  const mechanism = result.mechanism;
  if (!mechanism || mechanism.status === "unknown") {
    reasons.push("mechanism_layer_missing");
    return { state: "evidence_missing", reasons, behavior: null };
  }
  if (mechanism.status === "fail") {
    reasons.push("mechanism_not_pass");
    return { state: "fail", reasons, behavior: null };
  }
  if (tier === "release") {
    if (providerClass !== "deterministic") {
      reasons.push("tier_provider_class_mismatch");
      return { state: "fail", reasons, behavior: null };
    }
    const behavior = evaluateModelBehaviorEvidence({ tier, result, plannedRuns, retentionWording });
    if (behavior.eligibility === "ineligible") {
      reasons.push(...behavior.reason_codes);
      return { state: "fail", reasons, behavior };
    }
    if (!result.git_head) reasons.push("missing_replay_identity");
    if (!result.driver) reasons.push("missing_driver_identity");
    if (!result.model) reasons.push("missing_model_identity");
    if (reasons.some((code) => code.startsWith("missing_"))) {
      return { state: "evidence_missing", reasons, behavior };
    }
    return { state: "pass", reasons, behavior };
  }

  // release-real-llm：真实模型行为层必须单独满足证据门。
  if (providerClass !== "real_model") {
    reasons.push("tier_provider_class_mismatch");
    return { state: "fail", reasons, behavior: null };
  }
  const behavior = evaluateModelBehaviorEvidence({ tier, result, plannedRuns, retentionWording });
  if (behavior.status === "fail") {
    reasons.push(...behavior.reason_codes);
    return { state: "fail", reasons, behavior };
  }
  if (behavior.status !== "pass") {
    reasons.push(...behavior.reason_codes);
    return { state: "evidence_missing", reasons, behavior };
  }
  return { state: "pass", reasons, behavior };
}

function emptyCounts() {
  return { planned: 0, executed: 0, pass: 0, fail: 0, skipped: 0, not_run: 0, evidence_missing: 0 };
}

function emptyLayerCounts() {
  return { pass: 0, fail: 0, unknown: 0, not_applicable: 0 };
}

/**
 * 构造 release / release-real-llm 分层结果汇总。纯函数：不读文件。
 *
 * @param {object} input
 * @param {string} input.tier release | release-real-llm
 * @param {Array} [input.results] 单场景结果（已由 CLI 从 batch/verdict/evidence chain/native run 组装）
 * @param {string|null} [input.surface]
 * @param {string|null} [input.provider] 批次级 provider
 * @param {string|null} [input.batch_id]
 * @param {string|null} [input.git_head]
 * @param {object|null} [input.retention_wording] {text, ref, tuned:false}
 * @param {number|null} [input.planned_runs]
 * @param {boolean} [input.known_empty_fact] 当前 release tier 0 场景的已知事实标记
 */
export function buildReleaseLayerSummary(input = {}) {
  const tier = input.tier;
  if (!RELEASE_TIERS.includes(tier)) {
    throw new ReleaseLayerError(
      `release layer 只接受 tier=${RELEASE_TIERS.join("|")}（实际 ${tier}）`,
      "config",
      ["不支持的 tier"],
    );
  }
  const tierClass = tierClassFor(tier);
  const provider = stringOrNull(input.provider);
  const batchProvider = provider;
  const plannedRuns = Number.isInteger(input.planned_runs)
    ? input.planned_runs
    : DEFAULT_PLANNED_RUNS[tier];
  const results = Array.isArray(input.results) ? input.results.map(normalizeResult) : [];
  const counts = emptyCounts();
  const layers = { mechanism: emptyLayerCounts(), model_behavior: emptyLayerCounts() };
  const scenarioRows = [];
  const replayScenes = [];
  const reasonCodes = [];
  const blocked = [];
  const notRun = [];
  const evidenceMissing = [];
  const failureRefs = [];
  const providers = new Set();
  const providerClasses = new Set();
  const denominator = {
    planned_runs_per_scenario: plannedRuns,
    planned_total: 0,
    attempted: 0,
    passed_runs: 0,
    failed_runs: 0,
    timeouts: 0,
    format_failures: 0,
    pass_requires_all_planned_runs_pass: true,
  };

  for (const result of results) {
    const effectiveProvider = result.provider ?? batchProvider ?? null;
    const providerClass = classifyProvider(effectiveProvider);
    if (effectiveProvider) providers.add(effectiveProvider);
    if (effectiveProvider) providerClasses.add(providerClass);
    const evaluation = evaluateResult({
      tier,
      result,
      plannedRuns,
      retentionWording: input.retention_wording ?? null,
      batchProvider,
    });
    const state = evaluation.state;
    counts.planned += 1;
    if (state !== "skipped" && state !== "not_run") counts.executed += 1;
    counts[state] = (counts[state] ?? 0) + 1;
    layers.mechanism[result.mechanism.status] = (layers.mechanism[result.mechanism.status] ?? 0) + 1;
    layers.model_behavior[result.model_behavior.status] =
      (layers.model_behavior[result.model_behavior.status] ?? 0) + 1;

    const runAttempts = result.runs.length > 0 ? result.runs.length : result.attempt ?? 1;
    denominator.planned_total += plannedRuns;
    denominator.attempted += runAttempts;
    denominator.passed_runs += state === "pass" ? runAttempts : 0;
    denominator.failed_runs += state === "fail" ? runAttempts : 0;
    denominator.timeouts += result.timeouts;
    denominator.format_failures += result.runs.filter((run) =>
      /format|invalid_json|json_parse/iu.test(run.reason ?? ""),
    ).length;

    const codes = uniqueStrings([...evaluation.reasons]);
    reasonCodes.push(...codes);
    if (state === "fail") {
      for (const link of result.model_behavior?.evidence_refs ?? []) failureRefs.push(link);
      if (result.artifact_dir && result.status === "fail") failureRefs.push(result.artifact_dir);
    }
    if (state === "skipped") blocked.push({ scenario_id: result.scenario_id, reason: result.reason ?? codes[0] ?? "blocked" });
    if (state === "not_run") notRun.push(result.scenario_id);
    if (state === "evidence_missing") {
      evidenceMissing.push(result.scenario_id);
      if (result.artifact_dir) failureRefs.push(result.artifact_dir);
    }

    replayScenes.push({
      scenario_id: result.scenario_id,
      status: state,
      provider: effectiveProvider,
      provider_class: providerClass,
      driver: result.driver,
      surface: result.surface,
      model: result.model,
      actual_model: result.actual_model,
      params: result.params,
      attempt: result.attempt,
      runs: result.runs.length,
      timeouts: result.timeouts,
      git_head: result.git_head,
      generated_at: result.generated_at,
      artifact_dir: result.artifact_dir,
      input_ref: result.input_ref,
      retention_wording_ref: result.retention_wording_ref ?? input.retention_wording?.ref ?? null,
      evidence_binding: evaluation.behavior?.checks?.evidence_binding ?? null,
      evidence_completeness: evaluation.behavior?.checks?.evidence_completeness?.status ?? null,
      reason_codes: codes,
    });

    scenarioRows.push({
      scenario_id: result.scenario_id,
      execution_status: result.status,
      layer_status: state,
      reason_codes: codes,
      mechanism: result.mechanism,
      model_behavior: result.model_behavior,
      provider: effectiveProvider,
      provider_class: providerClass,
      artifact_dir: result.artifact_dir,
      evidence_requirements: evaluation.behavior?.checks?.evidence_requirements ?? null,
      evidence_completeness: evaluation.behavior?.checks?.evidence_completeness ?? null,
    });
  }

  const registeredScenarios = Number.isInteger(input.registered_scenarios) ? input.registered_scenarios : null;
  const allSkipped = counts.planned > 0 && counts.skipped === counts.planned;
  const allNotRun = counts.planned > 0 && counts.not_run === counts.planned;
  const hasFail = counts.fail > 0;
  const hasMissing = counts.evidence_missing > 0;
  const hasSkipped = counts.skipped > 0;
  const hasNotRun = counts.not_run > 0;

  let status;
  if (counts.planned === 0) status = "not_run";
  else if (hasFail) status = "fail";
  else if (hasMissing) status = "evidence_missing";
  else if (allNotRun) status = "not_run";
  else if (allSkipped) status = "skipped";
  else if (hasSkipped || hasNotRun) status = "skipped";
  else status = "pass";

  const aggregateCodes = [...reasonCodes];
  if (counts.planned === 0) {
    aggregateCodes.push("empty_tier");
    if (registeredScenarios !== null && registeredScenarios > 0) {
      aggregateCodes.push("batch_missing");
    } else if (input.known_empty_fact !== false) {
      aggregateCodes.push("known_fact_empty_tier");
    }
  }
  if (hasSkipped) aggregateCodes.push("blocked_scenarios_present");
  if (hasFail) aggregateCodes.push("batch_failure");
  const mixedClasses = providerClasses.size > 1;
  const mixedWithTier =
    (tierClass === "deterministic" && providerClasses.has("real_model")) ||
    (tierClass === "real_model" && providerClasses.has("deterministic"));
  if (mixedClasses || mixedWithTier) aggregateCodes.push("tier_provider_class_mismatch");

  const summary = {
    schema_version: RELEASE_LAYER_SCHEMA_VERSION,
    generated_at: timestampOrNull(input.generated_at) ?? new Date().toISOString(),
    tier,
    tier_class: tierClass,
    surface: stringOrNull(input.surface),
    provider,
    batch_id: stringOrNull(input.batch_id),
    git_head: stringOrNull(input.git_head),
    status,
    // 空 tier 沿用 B41 入口约定：无场景可执行 = exit 65（not_run 语义在 reason_codes 显式）。
    exit_code: counts.planned === 0 ? 65 : exitCodeForReleaseStatus(status),
    reason: describeStatus(status, counts),
    reason_codes: uniqueStrings(aggregateCodes),
    known_fact:
      counts.planned === 0 && (registeredScenarios === null || registeredScenarios === 0)
        ? "release / release-real-llm 当前均 0 注册场景是已知事实；空 tier 状态为 not_run（exit 65），不是 PASS，也不是全部通过。"
        : null,
    registered_scenarios: registeredScenarios,
    counts,
    layers,
    separation: {
      tier_class: tierClass,
      providers: [...providers].sort(),
      provider_classes: [...providerClasses].sort(),
      mixed_provider_classes: mixedClasses,
      deterministic_results_mixed_with_real: mixedWithTier,
      single_verdict_allowed: false,
      note: "机制证据与模型行为证据、确定性 provider 与真实模型 provider 分别汇总，不合并成单一 PASS。",
    },
    replay: {
      required_fields: [
        "scenario_id",
        "provider",
        "provider_class",
        "driver",
        "surface",
        "model",
        "actual_model",
        "params",
        "attempt",
        "timeouts",
        "git_head",
        "generated_at",
        "artifact_dir",
        "input_ref",
        "retention_wording_ref",
      ],
      scenes: replayScenes,
    },
    retention: input.retention_wording
      ? {
          text: stringOrNull(input.retention_wording.text),
          ref: stringOrNull(input.retention_wording.ref),
          tuned: input.retention_wording.tuned !== false,
        }
      : null,
    failure_denominator: denominator,
    blocked_scenarios: blocked,
    not_run_scenarios: notRun,
    evidence_missing_scenarios: evidenceMissing,
    failure_refs: uniqueStrings(failureRefs),
    scenarios: scenarioRows,
    open_gaps: openGaps({ tier, status, counts, layers, behaviorEligibility: scenarioRows }),
  };
  const errors = validateReleaseLayerSummary(summary);
  if (errors.length > 0) {
    throw new ReleaseLayerError(
      `构造的 release layer summary 未通过校验：${errors.join("; ")}`,
      "invalid_summary",
      errors,
    );
  }
  return summary;
}

function describeStatus(status, counts) {
  switch (status) {
    case "pass":
      return `tier 内 ${counts.planned} 个场景分层证据完整且全部通过（机制/模型行为分别记录）`;
    case "fail":
      return `tier 内存在 fail 结果（${counts.fail} 个），不得据此判 PASS`;
    case "evidence_missing":
      return `tier 内存在证据缺失结果（${counts.evidence_missing} 个），不得据此判 PASS`;
    case "skipped":
      return `tier 内存在 blocked/skipped 场景（skipped=${counts.skipped} not_run=${counts.not_run}），凭据/前置缺失只能 blocked，不能 PASS`;
    case "not_run":
      return "tier 内没有任何可执行结果（空 tier 或全部未执行），不是 PASS";
    default:
      return "unknown";
  }
}

function openGaps({ tier, status, counts, layers, behaviorEligibility }) {
  const gaps = [];
  if (counts.planned === 0) gaps.push("tier 当前 0 场景：release 结果层已冻结，但场景注册/真实运行未闭环。");
  if (status !== "pass" && counts.planned > 0) gaps.push("tier 未 PASS：不得用局部/HTTP 200/单次运行替代分层证据。");
  if (tier === "release-real-llm" && layers.model_behavior.pass === 0) {
    gaps.push("尚无真实模型行为证据（model_behavior=pass）覆盖本 tier。");
  }
  if (behaviorEligibility.some((row) => row.reason_codes.includes("missing_retention_wording"))) {
    gaps.push("缺少未参与调词的保留措辞记录；模型行为 PASS 资格不成立。");
  }
  if (behaviorEligibility.some((row) => row.reason_codes.includes("required_evidence_missing"))) {
    gaps.push("存在必需证据不完整（required evidence missing）的场景；缺失/未执行/不适用必须按声明判定，不得 PASS。");
  }
  return gaps;
}

export function validateReleaseLayerSummary(summary) {
  const errors = [];
  if (!isPlainObject(summary)) return ["release layer summary 必须是 JSON object"];
  if (summary.schema_version !== RELEASE_LAYER_SCHEMA_VERSION) {
    errors.push(`schema_version 必须为 ${RELEASE_LAYER_SCHEMA_VERSION}`);
  }
  if (!RELEASE_TIERS.includes(summary.tier)) errors.push(`tier 必须属于 ${RELEASE_TIERS.join(" | ")}`);
  if (!RELEASE_LAYER_STATUSES.includes(summary.status)) {
    errors.push(`status 必须属于 ${RELEASE_LAYER_STATUSES.join(" | ")}`);
  }
  if (!isPlainObject(summary.counts)) errors.push("counts 必须是 object");
  if (!isPlainObject(summary.layers)) errors.push("layers 必须是 object");
  if (!isPlainObject(summary.separation)) errors.push("separation 必须是 object");
  if (!isPlainObject(summary.replay) || !Array.isArray(summary.replay?.scenes)) {
    errors.push("replay.scenes 必须是数组");
  }
  if (!isPlainObject(summary.failure_denominator)) errors.push("failure_denominator 必须是 object");
  if (!Array.isArray(summary.blocked_scenarios)) errors.push("blocked_scenarios 必须是数组");
  // 反假绿硬规则：pass 要求计数一致且模型行为层无 fail/unknown，且不得有 blocked。
  if (summary.status === "pass") {
    const counts = summary.counts ?? {};
    if (counts.pass !== counts.planned || counts.fail > 0 || counts.evidence_missing > 0) {
      errors.push("status=pass 时 tier 内全部场景必须 pass（不得有 fail/evidence_missing/skipped）");
    }
    if ((counts.skipped ?? 0) > 0 || (counts.not_run ?? 0) > 0) {
      errors.push("status=pass 不得含 blocked/skipped/not_run 场景（凭据 blocked 不能 PASS）");
    }
    if (summary.tier === "release-real-llm") {
      if ((summary.layers?.model_behavior?.fail ?? 0) > 0 || (summary.layers?.model_behavior?.unknown ?? 0) > 0) {
        errors.push("release-real-llm 的 PASS 不得含 model_behavior=fail/unknown");
      }
      if (summary.layers?.model_behavior?.pass !== counts.pass) {
        errors.push("release-real-llm 的每个 pass 场景都必须有 model_behavior=pass");
      }
      // B42 §12：PASS 场景的必需证据必须逐场景完整；缺声明/缺必需字段不得 PASS。
      for (const scene of summary.scenarios ?? []) {
        if (scene.layer_status !== "pass") continue;
        if (scene.evidence_completeness?.status !== "complete") {
          errors.push(
            `release-real-llm PASS 场景 ${scene.scenario_id} 的必需证据必须完整（evidence_completeness=complete）`,
          );
        }
      }
    }
    if (summary.tier === "release" && (summary.layers?.model_behavior?.pass ?? 0) > 0) {
      errors.push("release（确定性 provider）层不得出现 model_behavior=pass");
    }
    if (summary.separation?.deterministic_results_mixed_with_real === true) {
      errors.push("status=pass 时不得混入另一类 provider 结果");
    }
  }
  if (summary.status === "not_run" && (summary.reason_codes ?? []).includes("empty_tier") && summary.counts?.planned !== 0) {
    errors.push("empty_tier 的 counts.planned 必须为 0");
  }
  if ((summary.reason_codes ?? []).includes("empty_tier") && summary.exit_code !== 65) {
    errors.push("空 tier 必须是 exit 65（not_run + empty_tier），不能是 PASS");
  }
  if (summary.status === "pass" && summary.exit_code !== 0) {
    errors.push("status=pass 的 exit_code 必须为 0");
  }
  return errors;
}

/** 读取 B41 batch.json 并转成 release layer 的 results 骨架（无 verdict/证据时的诚实缺省）。 */
export function resultsFromBatch(batch, options = {}) {
  if (!isPlainObject(batch) || !Array.isArray(batch.scenarios)) {
    throw new ReleaseLayerError("resultsFromBatch 需要 B41 batch.json（含 scenarios 数组）", "config");
  }
  return batch.scenarios.map((row) => ({
    scenario_id: row.scenario_id,
    status: ["pass", "fail", "skipped", "not_run", "evidence_missing"].includes(row.status)
      ? row.status
      : "evidence_missing",
    reason: row.reason ?? null,
    artifact_dir: row.artifact_dir ?? null,
    provider: options.provider ?? batch.provider ?? null,
    surface: options.surface ?? batch.surface ?? null,
    git_head: options.git_head ?? batch.git_head ?? null,
    generated_at: options.generated_at ?? null,
    mechanism: options.mechanismByScenario?.[row.scenario_id] ?? null,
    model_behavior: options.modelBehaviorByScenario?.[row.scenario_id] ?? null,
  }));
}

export function writeReleaseLayerSummary(targetDir, summary, options = {}) {
  const errors = validateReleaseLayerSummary(summary);
  if (errors.length > 0) {
    throw new ReleaseLayerError(`拒绝写入无效 release layer summary：${errors.join("; ")}`, "invalid_summary", errors);
  }
  const file = options.file ?? `${RELEASE_LAYER_FILE}`;
  const target = path.isAbsolute(file) ? file : path.join(targetDir, file);
  if (fsExists(target) && options.overwrite !== true) {
    throw new ReleaseLayerError(`拒绝覆盖已有 release layer 结果：${target}`, "summary_exists");
  }
  fsMkdir(pathDirname(target));
  fsWrite(target, `${JSON.stringify(summary, null, 2)}\n`);
  return { ok: true, path: target };
}

// 极简 fs 包装（带拒绝覆盖保护；artifact 写入只增不删）。
function fsExists(target) {
  return fs.existsSync(target);
}
function fsMkdir(target) {
  fs.mkdirSync(target, { recursive: true });
}
function fsWrite(target, content) {
  fs.writeFileSync(target, content);
}
function pathDirname(file) {
  return path.dirname(file);
}

export function readBatchSummary(batchPath) {
  const absolute = path.resolve(batchPath);
  const file = fs.existsSync(absolute) && fs.statSync(absolute).isDirectory() ? path.join(absolute, "batch.json") : absolute;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isPlainObject(data) || !Array.isArray(data.scenarios)) {
    throw new ReleaseLayerError(`不是合法 B41 batch summary：${file}`, "config");
  }
  return data;
}
