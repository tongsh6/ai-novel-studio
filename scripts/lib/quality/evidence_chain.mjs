// B42 CP2：求证证据链（Base → Observation → 后续真实 provider 请求 → used refs）的
// 归一化、集合校验与历史 artifact 读取。
//
// 契约（CP0 §6.4 冻结，additive sidecar，不动 B41 quality-verdict/v2）：
//   schema_version = quality-evidence-chain/v1
//
// 硬规则（对应 AU-15 §2/§9、VS-00K §3.2/§4.3、00c 候选不变量 #20/#21）：
// - used_context_refs ⊆ Base refs ∪ 实际观察到的 refs；未读取 ref 不得成为 used evidence；
// - supplied ≠ used：不得从 Base/supplied refs 反推 used refs；未返回自报告一律 unknown，
//   不能伪报“确定没有使用”，也不能把“工具日志里有”写成“模型已读”；
// - 观察 → 后续真实 provider 请求的顺序必须可判（observation_at ≤ provider_call_at）；
// - stale 观察不得冒充当前事实；越界引用只记录与降级，不改写旧 artifact 字节；
// - replay 默认不重调模型：重调过 provider 的“replay”不得作为证据信用。
//
// 本模块只读 artifact、只做纯函数判定；不写旧证据、不修改模型输出字节、无外部依赖。

import fs from "node:fs";
import path from "node:path";

export const EVIDENCE_CHAIN_SCHEMA_VERSION = "quality-evidence-chain/v1";
export const EVIDENCE_CHAIN_FILE = "evidence-chain.json";

// 观察结果分类（未知必须显式，不得默认 observed）。
export const OBSERVATION_OUTCOMES = Object.freeze([
  "observed",
  "empty",
  "ambiguous",
  "conflict",
  "stale",
  "error",
  "unknown",
]);

// 准备判断结果（VS-00K §4.2）：必须能表达“还缺什么”的出口。
export const PREPARATION_OUTCOMES = Object.freeze([
  "ready",
  "continue_seeking",
  "degraded",
  "awaiting_author",
  "blocked",
  "unknown",
]);

// 恢复后 stale 语义（VS-00K §4.4）。
export const STALE_ON_RESTORE_VALUES = Object.freeze(["none", "stale_detected", "unknown"]);

// 证据链绑定状态。任何 PASS 相关的模型行为判定都不接受 violated/unknown。
export const BINDING_STATUSES = Object.freeze(["verified", "partial", "unknown", "violated"]);

// 确定性 provider（只能证明机制，不能证明模型行为）。
export const DETERMINISTIC_PROVIDERS = Object.freeze([
  "slice_verify",
  "fake",
  "stub",
  "script",
  "deterministic",
  "mock",
]);

// 真实模型 provider（区分本地/自托管与远端 API）。未知 provider 一律 unknown，
// 不得默认按真实模型处理。
export const REAL_MODEL_PROVIDERS = Object.freeze([
  "lmstudio",
  "strata",
  "deepseek",
  "openai",
  "anthropic",
  "zhipu",
  "minimax",
  "kimi",
  "gemini",
]);

// 只有这些观察结果证明“真实读取到了内容”，其 ref 才能获得证据信用。
export const CREDITABLE_OUTCOMES = Object.freeze(["observed", "empty", "ambiguous", "conflict"]);

export const OBSERVATION_ARTIFACT_NAMES = Object.freeze([
  "ui-frames.json",
  "frames.json",
  "native-transport.jsonl",
  "protocol-seed.jsonl",
]);

const JSONL_ARTIFACT_DIRS = Object.freeze(["app-log", "llm-calls"]);

// 观察 outcome 缺失 / 非真实 provider 等导致的阻塞码；它们不放行 PASS，但不是伪造。
export const BLOCKER_CODES = Object.freeze([
  "base_refs_unknown",
  "used_context_refs_unknown",
  "observation_metadata_missing",
  "preparation_outcome_unknown",
  "stale_on_restore_unknown",
  "observation_not_linked_to_provider_call",
  "provider_not_real_model",
]);

// 硬违规码：一旦出现即 binding_status=violated，不得获得证据信用。
export const VIOLATION_CODES = Object.freeze([
  "unbound_ref",
  "unread_ref_credited",
  "stale_observation_credited",
  "observation_after_provider_call",
  "used_refs_inferred_from_supplied",
  "replay_provider_called",
  "observation_source_missing",
]);

export class EvidenceChainError extends Error {
  constructor(message, code = "invalid_evidence_chain", errors = []) {
    super(message);
    this.name = "EvidenceChainError";
    this.code = code;
    this.errors = errors;
  }
}

// ---------- provider 分类 ----------

export function classifyProvider(provider) {
  const value = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  if (!value) return "unknown";
  if (DETERMINISTIC_PROVIDERS.includes(value)) return "deterministic";
  if (REAL_MODEL_PROVIDERS.includes(value)) return "real_model";
  return "unknown";
}

export function isRealModelProvider(provider) {
  return classifyProvider(provider) === "real_model";
}

// ---------- 归一化 ----------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function stringOrNull(value) {
  return nonEmptyString(value) ? value : null;
}

function timestampOrNull(value) {
  if (!nonEmptyString(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
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

function refToken(value) {
  if (nonEmptyString(value)) return value.trim();
  if (isPlainObject(value)) {
    if (nonEmptyString(value.ref)) return value.ref.trim();
    if (nonEmptyString(value.id)) return value.id.trim();
  }
  return null;
}

function normalizeRefEntry(value) {
  const ref = refToken(value);
  if (!ref) return null;
  if (!isPlainObject(value)) return { ref, source: null, version: null };
  return {
    ref,
    source: stringOrNull(value.source),
    version: stringOrNull(value.version),
  };
}

function normalizeBaseRefs(baseRefs) {
  if (baseRefs === null || baseRefs === undefined) {
    return { status: "unknown", refs: [], entries: [] };
  }
  if (!Array.isArray(baseRefs)) {
    return { status: "unknown", refs: [], entries: [] };
  }
  const entries = baseRefs.map(normalizeRefEntry).filter(Boolean);
  return { status: "recorded", refs: uniqueStrings(entries.map((entry) => entry.ref)), entries };
}

function normalizeObservation(raw, index) {
  const observationRef = refToken(raw?.observation_ref ?? raw?.ref ?? raw?.observation_id);
  const sourceRefs = uniqueStrings([
    ...(Array.isArray(raw?.source_refs) ? raw.source_refs.map(refToken) : []),
    ...(Array.isArray(raw?.sources) ? raw.sources.map(refToken) : []),
    stringOrNull(raw?.source_ref) ? raw.source_ref : null,
  ]);
  const outcome = OBSERVATION_OUTCOMES.includes(raw?.outcome)
    ? raw.outcome
    : raw?.read === false || raw?.outcome === "unread"
      ? "error"
      : "unknown";
  const coverageRaw = raw?.coverage;
  const coverage = isPlainObject(coverageRaw)
    ? {
        kind: nonEmptyString(coverageRaw.kind) ? coverageRaw.kind : "unknown",
        detail: stringOrNull(coverageRaw.detail),
      }
    : nonEmptyString(coverageRaw)
      ? { kind: coverageRaw, detail: null }
      : { kind: "unknown", detail: null };
  const observedInCalls = uniqueStrings(raw?.observed_in_calls ?? raw?.provider_call_refs ?? []);
  const observation = {
    observation_ref: observationRef,
    query: stringOrNull(raw?.query),
    tool: stringOrNull(raw?.tool ?? raw?.target_tool_ref),
    outcome,
    source_refs: sourceRefs,
    source_revision: stringOrNull(raw?.source_revision ?? raw?.version),
    coverage,
    observed_at: timestampOrNull(raw?.observed_at ?? raw?.at ?? raw?.emitted_at),
    run_ref: stringOrNull(raw?.run_ref ?? raw?.run_id),
    turn_ref: stringOrNull(raw?.turn_ref ?? raw?.turn_id),
    observed_in_calls: observedInCalls,
    stale:
      raw?.stale === true ||
      raw?.is_stale === true ||
      outcome === "stale",
    metadata_missing:
      raw?.metadata_missing === true ||
      (!OBSERVATION_OUTCOMES.includes(raw?.outcome) ||
        (!isPlainObject(coverageRaw) && !nonEmptyString(coverageRaw)) ||
        !nonEmptyString(raw?.source_revision)),
  };
  if (!observationRef && sourceRefs.length === 0) {
    observation.observation_ref = null;
  }
  if (!observation.observation_ref) observation.observation_ref = `observation:${index}`;
  return observation;
}

function normalizeObservations(observations) {
  if (!Array.isArray(observations)) return [];
  return observations.map(normalizeObservation);
}

function normalizeProviderCall(raw, index) {
  const provider = stringOrNull(raw?.provider) ?? "unknown";
  return {
    provider_call_ref: refToken(raw?.provider_call_ref ?? raw?.call_ref) ?? `provider_call:${index}`,
    at: timestampOrNull(raw?.at ?? raw?.ts ?? raw?.timestamp ?? raw?.emitted_at),
    turn_ref: stringOrNull(raw?.turn_ref ?? raw?.turn_id),
    run_ref: stringOrNull(raw?.run_ref ?? raw?.run_id),
    step: stringOrNull(raw?.step),
    provider,
    provider_class: classifyProvider(provider),
    model: stringOrNull(raw?.model),
    actual_model: stringOrNull(raw?.actual_model),
    real: raw?.real === true || classifyProvider(provider) === "real_model",
    request_observation_refs: uniqueStrings(raw?.request_observation_refs ?? raw?.observation_refs ?? []),
  };
}

function normalizeProviderCalls(calls) {
  if (!Array.isArray(calls)) return [];
  return calls.map(normalizeProviderCall);
}

function sortedByTime(items) {
  return [...items].sort((left, right) => {
    const leftTime = left.at ? Date.parse(left.at) : Number.POSITIVE_INFINITY;
    const rightTime = right.at ? Date.parse(right.at) : Number.POSITIVE_INFINITY;
    return leftTime - rightTime;
  });
}

function observationRefsOf(observation) {
  const refs = [];
  if (nonEmptyString(observation.observation_ref)) refs.push(observation.observation_ref);
  for (const ref of observation.source_refs) refs.push(ref);
  return uniqueStrings(refs);
}

function isCreditableObservation(observation) {
  if (observation.stale) return false;
  return CREDITABLE_OUTCOMES.includes(observation.outcome);
}

// 从观察派生“已读到”的 ref 集合与“已知未读/stale”的 ref 集合，用于越界判定。
function classifyObservationRefs(observations) {
  const creditable = new Set();
  const unread = new Set();
  const stale = new Set();
  const unknownMetadata = new Set();
  for (const observation of observations) {
    const refs = observationRefsOf(observation);
    if (observation.stale) {
      for (const ref of refs) stale.add(ref);
      continue;
    }
    if (observation.outcome === "error") {
      for (const ref of refs) unread.add(ref);
      continue;
    }
    if (CREDITABLE_OUTCOMES.includes(observation.outcome)) {
      for (const ref of refs) creditable.add(ref);
      continue;
    }
    for (const ref of refs) unknownMetadata.add(ref);
  }
  return { creditable, unread, stale, unknownMetadata };
}

function buildObservationLinks(observations, providerCalls) {
  const links = [];
  const calls = sortedByTime(providerCalls);
  for (const observation of observations) {
    const observationTime = observation.observed_at ? Date.parse(observation.observed_at) : null;
    const explicitCallRefs = uniqueStrings([
      ...observation.observed_in_calls,
      ...calls
        .filter((call) => call.request_observation_refs.includes(observation.observation_ref))
        .map((call) => call.provider_call_ref),
    ]);
    const explicitCalls = explicitCallRefs
      .map((ref) => calls.find((call) => call.provider_call_ref === ref))
      .filter(Boolean);
    if (explicitCalls.length > 0) {
      for (const call of explicitCalls) {
        const ordered =
          observationTime !== null && call.at !== null
            ? Date.parse(call.at) >= observationTime
            : null;
        links.push({
          observation_ref: observation.observation_ref,
          provider_call_ref: call.provider_call_ref,
          ordered,
          linked_by:
            call.request_observation_refs.includes(observation.observation_ref)
              ? "request_observation_ref"
              : "explicit",
          provider_real: call.real,
        });
      }
      continue;
    }
    // 没有显式引用时按“同 turn 或全体真实 provider call 中最早的后续调用”建立顺序链接。
    const candidates = calls.filter((call) => {
      const sameTurn =
        observation.turn_ref && call.turn_ref ? observation.turn_ref === call.turn_ref : true;
      if (!sameTurn) return false;
      if (observationTime !== null && call.at !== null) return Date.parse(call.at) >= observationTime;
      return true;
    });
    const candidate = candidates[0];
    if (!candidate) {
      links.push({
        observation_ref: observation.observation_ref,
        provider_call_ref: null,
        ordered: null,
        linked_by: "none",
        provider_real: null,
      });
      continue;
    }
    const ordered =
      observationTime !== null && candidate.at !== null
        ? Date.parse(candidate.at) >= observationTime
        : null;
    links.push({
      observation_ref: observation.observation_ref,
      provider_call_ref: candidate.provider_call_ref,
      ordered,
      linked_by: "time_order",
      provider_real: candidate.real,
    });
  }
  return links;
}

/**
 * 构造并校验一条证据链（纯函数，不读文件）。
 *
 * @param {object} input
 * @param {string|null} [input.base_refs] Base 公开 refs；null/undefined 表示未记录（unknown）
 * @param {Array} [input.observations] 实际观察（observation_ref/outcome/source_refs/source_revision/coverage/observed_at）
 * @param {Array} [input.provider_calls] 后续真实 provider 请求
 * @param {string[]|null} [input.used_context_refs] 模型自报告 used refs；null 表示未返回（unknown）
 * @param {"self_report"|"inferred_supplied"|"missing"} [input.used_context_refs_source]
 */
export function buildEvidenceChain(input = {}) {
  const base = normalizeBaseRefs(input.base_refs);
  const observations = normalizeObservations(input.observations);
  const providerCalls = normalizeProviderCalls(input.provider_calls);
  const usedRaw = input.used_context_refs;
  const usedKnown = Array.isArray(usedRaw);
  const used = usedKnown ? uniqueStrings(usedRaw.map(refToken)) : [];
  const usedSource =
    input.used_context_refs_source ??
    (usedKnown ? "self_report" : "missing");
  const preparationOutcome = PREPARATION_OUTCOMES.includes(input.preparation_outcome)
    ? input.preparation_outcome
    : "unknown";
  const staleOnRestore = STALE_ON_RESTORE_VALUES.includes(input.stale_on_restore)
    ? input.stale_on_restore
    : "unknown";
  const replayProviderCalled = input.replay_provider_called === true;
  const baseRefSet = new Set(base.refs);
  const { creditable, unread, stale, unknownMetadata } = classifyObservationRefs(observations);

  const violations = [];
  const blockers = [];
  const unboundRefs = [];
  const unresolvedRefs = [];

  if (base.status === "unknown") blockers.push("base_refs_unknown");
  if (!usedKnown) blockers.push("used_context_refs_unknown");
  if (preparationOutcome === "unknown") blockers.push("preparation_outcome_unknown");
  if (staleOnRestore === "unknown") blockers.push("stale_on_restore_unknown");
  if (observations.some((observation) => observation.metadata_missing)) {
    blockers.push("observation_metadata_missing");
  }

  for (const ref of used) {
    if (stale.has(ref)) {
      violations.push({ code: "stale_observation_credited", ref });
      continue;
    }
    if (unread.has(ref)) {
      violations.push({ code: "unread_ref_credited", ref });
      continue;
    }
    if (baseRefSet.has(ref) || creditable.has(ref)) continue;
    if (unknownMetadata.has(ref)) {
      // 观察确实存在，但缺少 outcome/coverage/source_revision，不能获得“已读到”信用。
      blockers.push("observation_metadata_missing");
      if (!blockers.includes("observation_not_linked_to_provider_call")) {
        // 留待链接判定，这里不重复。
      }
      continue;
    }
    if (base.status === "recorded") {
      violations.push({ code: "unbound_ref", ref });
      unboundRefs.push(ref);
    } else {
      // Base 未记录时无法判断该 ref 是越界还是 Base/观察来源；如实记 unresolved。
      unresolvedRefs.push(ref);
    }
  }

  // supplied refs 只说明“APP 提供了什么”，绝不参与 used 推导（supplied≠used）。
  const suppliedRefs = uniqueStrings(input.supplied_refs ?? []);
  if (usedSource === "inferred_supplied") {
    violations.push({
      code: "used_refs_inferred_from_supplied",
      detail: "used_context_refs 不得由 supplied/Base refs 推导（supplied≠used）",
    });
  }

  const observationLinks = buildObservationLinks(observations, providerCalls);
  for (const link of observationLinks) {
    if (link.ordered === false) {
      violations.push({
        code: "observation_after_provider_call",
        observation_ref: link.observation_ref,
        provider_call_ref: link.provider_call_ref,
      });
    }
  }
  const realLinked = observationLinks.filter(
    (link) => link.ordered === true && link.provider_real === true,
  );
  if (observations.length > 0 && realLinked.length === 0) {
    blockers.push("observation_not_linked_to_provider_call");
  }
  for (const observation of observations) {
    if (isCreditableObservation(observation) && observation.source_refs.length === 0) {
      violations.push({
        code: "observation_source_missing",
        observation_ref: observation.observation_ref,
      });
    }
  }
  if (replayProviderCalled) {
    violations.push({
      code: "replay_provider_called",
      detail: "replay 默认不重调模型；重调 provider 的运行不得作为 replay 证据信用",
    });
  }

  const chain = {
    schema_version: EVIDENCE_CHAIN_SCHEMA_VERSION,
    run_ref: stringOrNull(input.run_ref),
    scenario_id: stringOrNull(input.scenario_id),
    base_refs: base.refs,
    base_refs_status: base.status,
    base_ref_entries: base.entries,
    observations,
    observation_refs: uniqueStrings(observations.flatMap(observationRefsOf)),
    provider_calls: providerCalls,
    observation_to_provider_call: observationLinks,
    used_context_refs: usedKnown ? used : null,
    used_context_refs_status: usedKnown ? "reported" : "unknown",
    used_context_refs_source: usedSource,
    supplied_refs: suppliedRefs,
    unbound_refs: uniqueStrings(unboundRefs),
    unresolved_refs: uniqueStrings(unresolvedRefs),
    preparation_outcome: preparationOutcome,
    stale_on_restore: staleOnRestore,
    replay_provider_called: replayProviderCalled,
    blockers: uniqueStrings(blockers),
    violations,
    generated_at: timestampOrNull(input.generated_at) ?? new Date().toISOString(),
  };
  chain.binding = evaluateEvidenceChain(chain);
  return chain;
}

// ---------- 校验与判定 ----------

export function validateEvidenceChain(chain) {
  const errors = [];
  if (!isPlainObject(chain)) return ["evidence chain 必须是 JSON object"];
  if (chain.schema_version !== EVIDENCE_CHAIN_SCHEMA_VERSION) {
    errors.push(`schema_version 必须为 ${EVIDENCE_CHAIN_SCHEMA_VERSION}`);
  }
  for (const key of [
    "base_refs",
    "observations",
    "provider_calls",
    "observation_to_provider_call",
    "blockers",
    "violations",
  ]) {
    if (!Array.isArray(chain[key])) errors.push(`${key} 必须是数组`);
  }
  if (!["recorded", "unknown"].includes(chain.base_refs_status)) {
    errors.push("base_refs_status 必须属于 recorded|unknown");
  }
  if (!["reported", "unknown"].includes(chain.used_context_refs_status)) {
    errors.push("used_context_refs_status 必须属于 reported|unknown");
  }
  if (
    chain.used_context_refs !== null &&
    chain.used_context_refs !== undefined &&
    !Array.isArray(chain.used_context_refs)
  ) {
    errors.push("used_context_refs 必须是字符串数组或 null（null=未返回，记 unknown）");
  }
  if (!PREPARATION_OUTCOMES.includes(chain.preparation_outcome)) {
    errors.push(`preparation_outcome 必须属于 ${PREPARATION_OUTCOMES.join(" | ")}`);
  }
  if (!STALE_ON_RESTORE_VALUES.includes(chain.stale_on_restore)) {
    errors.push(`stale_on_restore 必须属于 ${STALE_ON_RESTORE_VALUES.join(" | ")}`);
  }
  if (typeof chain.replay_provider_called !== "boolean") {
    errors.push("replay_provider_called 必须是 boolean");
  }
  (chain.observations ?? []).forEach((observation, index) => {
    if (!isPlainObject(observation)) {
      errors.push(`observations[${index}] 必须是 object`);
      return;
    }
    if (!OBSERVATION_OUTCOMES.includes(observation.outcome)) {
      errors.push(`observations[${index}].outcome 必须属于 ${OBSERVATION_OUTCOMES.join(" | ")}`);
    }
  });
  return errors;
}

/**
 * 判定证据链绑定状态。纯读取 chain 上的归一化字段。
 *
 * @returns {{binding_status: string, reason_codes: string[], violations: object[], blockers: string[],
 *   observation_link_count: number, real_observation_link_count: number,
 *   used_bound_count: number, used_unbound_count: number}}
 */
export function evaluateEvidenceChain(chain) {
  if (!isPlainObject(chain)) {
    return {
      binding_status: "unknown",
      reason_codes: ["invalid_chain"],
      violations: [],
      blockers: ["invalid_chain"],
      observation_link_count: 0,
      real_observation_link_count: 0,
      used_bound_count: 0,
      used_unbound_count: 0,
    };
  }
  const violations = Array.isArray(chain.violations) ? chain.violations : [];
  const blockers = uniqueStrings(chain.blockers ?? []);
  const links = Array.isArray(chain.observation_to_provider_call)
    ? chain.observation_to_provider_call
    : [];
  const realLinks = links.filter((link) => link.ordered === true && link.provider_real === true);
  const used = Array.isArray(chain.used_context_refs) ? chain.used_context_refs : [];
  const unbound = new Set(uniqueStrings(chain.unbound_refs ?? []));
  const usedBound = used.filter((ref) => !unbound.has(ref));

  let bindingStatus;
  if (violations.length > 0) bindingStatus = "violated";
  else if (chain.base_refs_status !== "recorded") bindingStatus = "unknown";
  else if (chain.used_context_refs_status !== "reported") bindingStatus = "partial";
  else if (['observation_metadata_missing'].some((code) => blockers.includes(code))) bindingStatus = "partial";
  else bindingStatus = "verified";

  const reasonCodes = [
    ...violations.map((violation) => violation.code),
    ...blockers,
  ];
  return {
    binding_status: bindingStatus,
    reason_codes: uniqueStrings(reasonCodes),
    violations,
    blockers,
    observation_link_count: links.length,
    real_observation_link_count: realLinks.length,
    used_bound_count: usedBound.length,
    used_unbound_count: unbound.size,
  };
}

// ---------- 历史 artifact 读取（只读） ----------

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonlRows(file) {
  const rows = [];
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const start = trimmed.indexOf("{");
    if (start < 0) continue;
    try {
      rows.push(JSON.parse(trimmed.slice(start)));
    } catch {
      // 历史 artifact 可能夹杂非 JSON 行；跳过但不能把它当证据。
    }
  }
  return rows;
}

export function listEvidenceFiles(artifactDir) {
  const result = { frames: [], app_log: [], llm_calls: [] };
  if (!fs.existsSync(artifactDir)) return result;
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "database" || entry.name.endsWith(".app")) continue;
        walk(full, depth + 1);
        continue;
      }
      const relative = path.relative(artifactDir, full);
      if (
        OBSERVATION_ARTIFACT_NAMES.includes(entry.name) ||
        (entry.name.endsWith(".json") && /frames/i.test(entry.name))
      ) {
        result.frames.push({ file: full, relative });
      } else if (/(^|\/)app-log\//u.test(relative) && entry.name.endsWith(".jsonl")) {
        result.app_log.push({ file: full, relative });
      } else if (/(^|\/)llm-calls\//u.test(relative) && entry.name.endsWith(".jsonl")) {
        result.llm_calls.push({ file: full, relative });
      }
    }
  };
  walk(artifactDir, 0);
  result.frames.sort((left, right) => left.relative.localeCompare(right.relative));
  result.app_log.sort((left, right) => left.relative.localeCompare(right.relative));
  result.llm_calls.sort((left, right) => left.relative.localeCompare(right.relative));
  return result;
}

function frameRowsFromFile(file, relative) {
  const rows = relative.endsWith(".json") ? readJsonFile(file) : readJsonlRows(file);
  if (!Array.isArray(rows)) return [];
  return rows;
}

// 历史 artifact 有两种帧格式：
// 1) websocket frames：{direction,topic,event,body}（ui-frames.json / protocol-seed.jsonl）
// 2) 原生传输代理：{at,direction,frame:[join,ref,topic,event,payload], dropped?}
//    （native-transport.jsonl；同时含 {method,path,status} 的 HTTP 行，忽略）
function normalizeFrames(rows, relative) {
  const frames = [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    if (Array.isArray(row.frame)) {
      const frame = row.frame;
      const event = nonEmptyString(frame[3]) ? frame[3].trim() : null;
      if (!event) continue;
      const payload = event === "phx_reply" && isPlainObject(frame[4]) ? frame[4].response : frame[4];
      frames.push({ at: timestampOrNull(row.at), event, payload: payload ?? null, relative });
      continue;
    }
    if (nonEmptyString(row.event) && isPlainObject(row.body)) {
      const body = row.body;
      frames.push({
        at: timestampOrNull(row.at ?? body.emitted_at),
        event: row.event,
        payload: isPlainObject(body.payload) ? body.payload : body,
        body,
        relative,
      });
      continue;
    }
    if (isPlainObject(row.body) && nonEmptyString(row.body.phase)) {
      // 旧 TurnResult 直接行（无 event 字段）按 turn_result 处理。
      frames.push({
        at: timestampOrNull(row.at ?? row.body.emitted_at),
        event: "turn_result",
        payload: row.body,
        relative,
      });
    }
  }
  return frames;
}

function walkValues(value, visitor, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkValues(item, visitor, [...keyPath, index]));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child, keyPath);
    walkValues(child, visitor, [...keyPath, key]);
  }
}

/**
 * 从一批帧中抽取观察 refs / used_context_refs / provider_call_refs 出现记录。
 * 只读取 artifact，不修改。
 */
export function extractFrameEvidence({ file, relative = null, rows }) {
  const frames = normalizeFrames(rows ?? frameRowsFromFile(file, relative ?? file), relative ?? file);
  const observations = [];
  const usedOccurrences = [];
  const providerCallRefs = [];
  for (const frame of frames) {
    const payload = frame.payload;
    walkValues(payload, (key, child) => {
      if (key === "observation_refs" && Array.isArray(child)) {
        for (const ref of uniqueStrings(child)) {
          observations.push({
            observation_ref: ref,
            at: timestampOrNull(payload?.emitted_at) ?? frame.at,
            run_ref: stringOrNull(payload?.run_ref ?? payload?.run_id),
            turn_ref: stringOrNull(payload?.turn_id ?? frame.body?.turn_id),
            kind: stringOrNull(payload?.event_type ?? frame.event),
            source_file: relative ?? file,
          });
        }
      }
      if (key === "used_context_refs" && Array.isArray(child)) {
        usedOccurrences.push({
          refs: uniqueStrings(child),
          at: timestampOrNull(payload?.emitted_at) ?? frame.at,
          turn_ref: stringOrNull(payload?.turn_id ?? frame.body?.turn_id),
          run_ref: stringOrNull(payload?.run_ref ?? payload?.run_id),
          source_file: relative ?? file,
        });
      }
      if (key === "provider_call_ref" && nonEmptyString(child)) {
        providerCallRefs.push({
          provider_call_ref: child.trim(),
          at: timestampOrNull(payload?.emitted_at) ?? frame.at,
          turn_ref: stringOrNull(payload?.turn_id ?? frame.body?.turn_id),
          run_ref: stringOrNull(payload?.run_ref ?? payload?.run_id),
          source_file: relative ?? file,
        });
      }
    });
  }
  return { file: relative ?? file, frames, observations, used_occurrences: usedOccurrences, provider_call_refs: providerCallRefs };
}

/** 读取 llm-calls JSONL：真实 provider 请求/响应索引（不含响应正文大文本）。 */
export function readLlmCalls(file, relative = null) {
  const rows = readJsonlRows(file);
  const calls = [];
  rows.forEach((row, index) => {
    if (!isPlainObject(row)) return;
    const request = isPlainObject(row.request) ? row.request : {};
    const body = isPlainObject(request.body) ? request.body : {};
    const response = isPlainObject(row.response) ? row.response : {};
    const provider = stringOrNull(row.provider) ?? "unknown";
    calls.push({
      provider_call_ref:
        refToken(row.provider_call_ref ?? row.call_ref) ??
        `${relative ?? path.basename(file)}#${index}`,
      at: timestampOrNull(row.ts ?? row.at),
      turn_ref: stringOrNull(row.turn_id ?? row.turn_ref),
      run_ref: stringOrNull(row.run_ref),
      step: stringOrNull(row.step),
      provider,
      provider_class: classifyProvider(provider),
      requested_model: stringOrNull(body.model),
      model: stringOrNull(body.model),
      actual_model: stringOrNull(response.model),
      status: response.status ?? null,
      http_ok:
        response.status === undefined ||
        response.status === null ||
        Number(response.status) === 200,
      request_message_count: Array.isArray(body.messages) ? body.messages.length : 0,
      response_has_body: isPlainObject(response.body) || nonEmptyString(response.body),
      real: classifyProvider(provider) === "real_model",
      source_file: relative ?? file,
    });
  });
  return calls;
}

/** 读取 app JSONL：事件时间线（observation / provider call 顺序的独立旁证）。 */
export function readAppLogEvents(file, relative = null) {
  return readJsonlRows(file)
    .filter(isPlainObject)
    .map((row) => ({
      at: timestampOrNull(row.timestamp ?? row.at),
      event: stringOrNull(row.event),
      outcome: stringOrNull(row.outcome),
      turn_ref: stringOrNull(row.turn_id),
      run_ref: stringOrNull(row.run_ref),
      source_file: relative ?? file,
    }));
}

/**
 * 从历史 artifact 目录构造 evidence chain。只读；不写旧证据。
 *
 * 注意：历史 artifact 通常没有记录 base_refs / observation outcome / coverage /
 * source_revision / preparation_outcome，这些字段保持 unknown（不伪报），
 * 因此只能得到 binding_status=unknown/partial 与显式 blocker，不能据此写 PASS。
 */
export function readArtifactEvidence(artifactDir, options = {}) {
  const files = listEvidenceFiles(artifactDir);
  const frameEvidence = [];
  for (const entry of files.frames) {
    try {
      frameEvidence.push(
        extractFrameEvidence({ file: entry.file, relative: entry.relative }),
      );
    } catch {
      // 读取失败不作为证据；由调用方记录 artifact 不可读。
    }
  }
  const llmCalls = [];
  for (const entry of files.llm_calls) {
    try {
      llmCalls.push(...readLlmCalls(entry.file, entry.relative));
    } catch {
      // 同上。
    }
  }
  const appEvents = [];
  for (const entry of files.app_log) {
    try {
      appEvents.push(...readAppLogEvents(entry.file, entry.relative));
    } catch {
      // 同上。
    }
  }

  const observations = [];
  const usedOccurrences = [];
  const providerCallRefs = [];
  for (const evidence of frameEvidence) {
    observations.push(...evidence.observations);
    usedOccurrences.push(...evidence.used_occurrences);
    providerCallRefs.push(...evidence.provider_call_refs);
  }
  const usedFlat = uniqueStrings(usedOccurrences.flatMap((occurrence) => occurrence.refs));
  const usedReported = usedOccurrences.length > 0;

  const chain = buildEvidenceChain({
    scenario_id: options.scenario_id ?? path.basename(path.resolve(artifactDir)),
    run_ref: options.run_ref ?? null,
    base_refs: options.base_refs ?? null,
    observations: observations.map((observation) => ({
      observation_ref: observation.observation_ref,
      observed_at: observation.at,
      run_ref: observation.run_ref,
      turn_ref: observation.turn_ref,
      outcome: options.observation_outcome ?? "unknown",
      source_revision: options.source_revision ?? null,
      coverage: options.coverage,
      stale: options.stale ?? false,
    })),
    provider_calls: llmCalls
      .filter((call) => call.real)
      .map((call) => ({
        provider_call_ref: call.provider_call_ref,
        at: call.at,
        turn_ref: call.turn_ref,
        step: call.step,
        provider: call.provider,
        model: call.model,
        actual_model: call.actual_model,
      })),
    used_context_refs: usedReported ? usedFlat : null,
    used_context_refs_source: usedReported ? "self_report" : "missing",
    preparation_outcome: options.preparation_outcome ?? "unknown",
    stale_on_restore: options.stale_on_restore ?? "unknown",
    replay_provider_called: options.replay_provider_called === true,
    generated_at: options.generated_at,
  });

  return {
    artifact_dir: artifactDir,
    files,
    frame_files: frameEvidence.map((evidence) => evidence.file),
    app_event_count: appEvents.length,
    app_events: appEvents,
    provider_call_refs: uniqueStrings(providerCallRefs.map((item) => item.provider_call_ref)),
    used_occurrences: usedOccurrences,
    llm_calls: llmCalls,
    llm_call_count: llmCalls.length,
    real_provider_call_count: llmCalls.filter((call) => call.real).length,
    chain,
    binding: chain.binding,
  };
}

export function writeEvidenceChain(artifactDir, chain, options = {}) {
  const errors = validateEvidenceChain(chain);
  if (errors.length > 0) {
    throw new EvidenceChainError(`拒绝写入无效 evidence chain：${errors.join("; ")}`, "invalid_evidence_chain", errors);
  }
  const target = options.file ?? path.join(artifactDir, EVIDENCE_CHAIN_FILE);
  if (fs.existsSync(target) && options.overwrite !== true) {
    throw new EvidenceChainError(`拒绝覆盖已有证据链（失败证据只增不删）：${target}`, "evidence_chain_exists");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(chain, null, 2)}\n`);
  return { ok: true, path: target };
}
