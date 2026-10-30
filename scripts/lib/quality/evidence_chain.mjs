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

// replay 证据状态（B42 §12.1，2026-10-28 最小兼容修订）：
// - not_executed  = 明确未运行 replay，不能当作“已验证不调 provider”；
// - no_provider_call = replay 已执行且证明没有重调 provider，可作为 replay 证据；
// - provider_called = replay 重调了 provider，不得作为证据信用（violation）；
// - unknown = 历史 artifact 未表达状态（不得由旧布尔 false 反推“已证明未调用”）。
export const REPLAY_STATUSES = Object.freeze([
  "not_executed",
  "no_provider_call",
  "provider_called",
  "unknown",
]);

// 证据链绑定状态。任何 PASS 相关的模型行为判定都不接受 violated/unknown。
export const BINDING_STATUSES = Object.freeze(["verified", "partial", "unknown", "violated"]);

// B42 §13：请求/观察两侧记录的“有没有写这个字段”三态。
// recorded=数组记录（显式空数组也是记录）；unknown=缺失（旧 artifact/生产尚未写）。
// 缺失不得反推“明确未包含/未被看到”，也不得授包含信用。
export const RECORDING_STATUSES = Object.freeze(["recorded", "unknown"]);

// ---------- 场景必需证据声明（B42 §12.1，additive，同 v1 兼容） ----------
//
// 每个 release-real-llm 场景在运行前声明各证据维度的适用性：
// - required       = 该场景必须提供该证据，缺失即 evidence_missing（hard violation 仍 fail）；
// - not_applicable = 该场景语义上不需要该证据（如 A0 不探索、CP1 未实现准备判断/replay），
//                    缺失只记录，不阻塞；声明需在运行前冻结，不能事后删要求。
// 未声明的维度一律按 required（严格默认），忘记声明永远不会自动放行。
export const EVIDENCE_REQUIREMENTS_SCHEMA_VERSION = "quality-evidence-requirements/v1";
export const EVIDENCE_REQUIREMENTS_FILE = "evidence-requirements.json";

export const EVIDENCE_DIMENSIONS = Object.freeze([
  "base_refs",
  "observations",
  "observation_link",
  "source_metadata",
  "used_context_refs",
  "preparation",
  "restore",
  "replay",
]);

export const EVIDENCE_REQUIREMENT_VALUES = Object.freeze(["required", "not_applicable"]);

// 维度缺失时的原因码；observation_link 缺失是“场景核心断言不成立”，按 fail 处理。
export const EVIDENCE_DIMENSION_REASON_CODES = Object.freeze({
  base_refs: "required_base_refs_missing",
  observations: "required_observations_missing",
  observation_link: "required_observation_link_missing",
  source_metadata: "required_source_metadata_missing",
  used_context_refs: "required_used_context_refs_missing",
  preparation: "required_preparation_missing",
  restore: "required_restore_missing",
  replay: "required_replay_evidence_missing",
});

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
  const observedInCallsRecorded =
    raw?.observed_in_calls !== undefined || raw?.provider_call_refs !== undefined;
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
    observed_in_calls_status: observedInCallsRecorded ? "recorded" : "unknown",
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
  const providerClass = classifyProvider(provider);
  // B42 §13：请求侧“有没有记录观察包含”必须与“记录为空数组”区分。
  // 缺失（旧 artifact / 当前产品尚未写）→ unknown；显式 [] → recorded（明确未包含）。
  const requestRefsRecorded =
    raw?.request_observation_refs !== undefined || raw?.observation_refs !== undefined;
  return {
    provider_call_ref: refToken(raw?.provider_call_ref ?? raw?.call_ref) ?? `provider_call:${index}`,
    at: timestampOrNull(raw?.at ?? raw?.ts ?? raw?.timestamp ?? raw?.emitted_at),
    turn_ref: stringOrNull(raw?.turn_ref ?? raw?.turn_id),
    run_ref: stringOrNull(raw?.run_ref ?? raw?.run_id),
    step: stringOrNull(raw?.step),
    provider,
    provider_class: providerClass,
    model: stringOrNull(raw?.model),
    actual_model: stringOrNull(raw?.actual_model),
    // B42 §13：真实模型身份只由 provider 分类决定；手填 real=true 不能把确定性
    // provider 变成真实模型证据（real_claimed 保留冲突以便判违规）。
    real: providerClass === "real_model",
    real_claimed: raw?.real === true,
    request_observation_refs: uniqueStrings(raw?.request_observation_refs ?? raw?.observation_refs ?? []),
    request_observation_refs_status: requestRefsRecorded ? "recorded" : "unknown",
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

// B42 §13：请求侧观察包含判定。
// - request_observation_refs_status=recorded 才可判 true/false；缺失一律 unknown；
// - observation.observed_in_calls 只是观察侧反声称，单独不能授包含信用。
function requestIncludesObservation(call, observationRef) {
  if (!call || !nonEmptyString(observationRef)) return null;
  if (call.request_observation_refs_status !== "recorded") return null;
  return Array.isArray(call.request_observation_refs)
    ? call.request_observation_refs.includes(observationRef)
    : null;
}

function buildObservationLinks(observations, providerCalls) {
  const links = [];
  const calls = sortedByTime(providerCalls);
  for (const observation of observations) {
    const observationRef = observation.observation_ref;
    const observationTime = observation.observed_at ? Date.parse(observation.observed_at) : null;
    const seen = new Set();
    const pushLink = (call, linkedBy, includesObservation) => {
      const callRef = call ? call.provider_call_ref : null;
      const key = `${callRef ?? "none"}|${linkedBy}`;
      if (seen.has(key)) return;
      seen.add(key);
      const ordered =
        call && observationTime !== null && call.at !== null
          ? Date.parse(call.at) >= observationTime
          : null;
      links.push({
        observation_ref: observationRef,
        provider_call_ref: callRef,
        ordered,
        linked_by: linkedBy,
        includes_observation: includesObservation,
        provider_real: call ? call.real : null,
      });
    };
    // 1) 请求侧同源记录列出该观察 → 唯一的包含信用来源。
    for (const call of calls) {
      if (requestIncludesObservation(call, observationRef) === true) {
        pushLink(call, "request_observation_ref", true);
      }
    }
    // 2) 观察侧反向声称：只作交叉核对；与请求记录矛盾时由判定层保留冲突。
    for (const claimedCallRef of observation.observed_in_calls) {
      const call = calls.find((item) => item.provider_call_ref === claimedCallRef);
      if (!call) {
        const key = `${claimedCallRef}|explicit`;
        if (!seen.has(key)) {
          seen.add(key);
          links.push({
            observation_ref: observationRef,
            provider_call_ref: claimedCallRef,
            ordered: null,
            linked_by: "explicit",
            includes_observation: null,
            provider_real: null,
          });
        }
        continue;
      }
      const includes = requestIncludesObservation(call, observationRef);
      if (includes === true) continue; // 与请求记录一致，已由 1) 建链接
      pushLink(call, "explicit", includes);
    }
    if (links.some((link) => link.observation_ref === observationRef)) continue;
    // 3) 两侧都没有记录：只建立顺序链接；顺序≠包含（inclusion 只能是 unknown/false）。
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
        observation_ref: observationRef,
        provider_call_ref: null,
        ordered: null,
        linked_by: "none",
        includes_observation: null,
        provider_real: null,
      });
      continue;
    }
    pushLink(candidate, "time_order", requestIncludesObservation(candidate, observationRef));
  }
  return links;
}

// ---------- B42 §13：派生事实重算（不信任 artifact 自带缓存） ----------

function eligibleRealCallsFor(observation, realCalls) {
  const observationTime = observation.observed_at ? Date.parse(observation.observed_at) : null;
  return realCalls.filter((call) => {
    const sameTurn =
      observation.turn_ref && call.turn_ref ? observation.turn_ref === call.turn_ref : true;
    if (!sameTurn) return false;
    if (observationTime !== null && call.at !== null) return Date.parse(call.at) >= observationTime;
    return true;
  });
}

function deniedByRequest(call, observation) {
  return requestIncludesObservation(call, observation.observation_ref) === false;
}

function deriveObservationInclusion(observations, links, realCalls, blockers, violations) {
  if (observations.length === 0) return new Set();
  if (realCalls.length === 0) {
    blockers.push("observation_not_linked_to_provider_call");
    return new Set();
  }
  const includedRefs = new Set();
  for (const observation of observations) {
    const own = links.filter((link) => link.observation_ref === observation.observation_ref);
    const included = own.filter(
      (link) => link.includes_observation === true && link.provider_real === true,
    );
    if (included.length === 0) {
      // 否定证据只来自请求侧 recorded 记录；缺失/未记录只能 unknown。
      const eligible = eligibleRealCallsFor(observation, realCalls);
      const denied =
        own.some((link) => link.includes_observation === false) ||
        (eligible.length > 0 &&
          eligible.every((call) => call.request_observation_refs_status === "recorded"));
      blockers.push(
        denied ? "observation_not_included_in_request" : "observation_inclusion_unknown",
      );
      continue;
    }
    includedRefs.add(observation.observation_ref);
    if (included.some((link) => link.ordered === null)) {
      blockers.push("observation_call_order_unknown");
    }
  }
  for (const link of links) {
    // 显式关联但时间逆序 → 否定证据；不能继续标 verified。
    if (link.ordered === false) {
      violations.push({
        code: "observation_after_provider_call",
        observation_ref: link.observation_ref,
        provider_call_ref: link.provider_call_ref,
      });
    }
    // observation 反向声称见到的调用，其请求记录明确没有该观察 → 保留矛盾。
    if (link.linked_by === "explicit" && link.includes_observation === false) {
      violations.push({
        code: "observation_link_conflict",
        observation_ref: link.observation_ref,
        provider_call_ref: link.provider_call_ref,
      });
    }
  }
  return includedRefs;
}

function deriveUsedCredit(chain, facts) {
  const { observations, links, reportCall, baseRecorded, baseRefs, stale, unread } = facts;
  const usedKnown = Array.isArray(chain.used_context_refs);
  const used = usedKnown ? uniqueStrings(chain.used_context_refs) : [];
  const usedSource = chain.used_context_refs_source ?? (usedKnown ? "self_report" : "missing");
  const violations = [];
  const blockers = [];
  const unboundRefs = [];
  const unresolvedRefs = [];
  const observedRefs = new Set();
  for (const observation of observations) {
    for (const ref of observationRefsOf(observation)) observedRefs.add(ref);
  }
  // 只从“产生该自报告的 provider 调用请求里实际包含的观察”授信（不能整 run 并集补证）。
  const reportCredit = new Set();
  if (reportCall) {
    for (const link of links) {
      if (link.provider_call_ref !== reportCall.provider_call_ref) continue;
      if (link.includes_observation !== true || link.provider_real !== true) continue;
      if (link.ordered === false) continue;
      const observation = observations.find((item) => item.observation_ref === link.observation_ref);
      if (!observation) continue;
      for (const ref of observationRefsOf(observation)) reportCredit.add(ref);
    }
  }
  if (usedSource === "inferred_supplied") {
    violations.push({
      code: "used_refs_inferred_from_supplied",
      detail: "used_context_refs 不得由 supplied/Base refs 推导（supplied≠used）",
    });
  }
  const usedBound = [];
  if (!usedKnown) {
    return { usedKnown, used, usedSource, usedBound, violations, blockers, unboundRefs, unresolvedRefs };
  }
  if (used.length > 0 && !reportCall) blockers.push("used_context_refs_call_unknown");
  for (const ref of used) {
    if (stale.has(ref)) {
      violations.push({ code: "stale_observation_credited", ref });
      continue;
    }
    if (unread.has(ref)) {
      violations.push({ code: "unread_ref_credited", ref });
      continue;
    }
    if (baseRefs.has(ref) || reportCredit.has(ref)) {
      usedBound.push(ref);
      continue;
    }
    if (!observedRefs.has(ref)) {
      // 硬边界：Base ∪ 全部观察之外的 ref 永远不能授信。
      if (baseRecorded) {
        violations.push({ code: "unbound_ref", ref, detail: "outside_base_and_observations" });
        unboundRefs.push(ref);
      } else {
        unresolvedRefs.push(ref);
      }
      continue;
    }
    if (!reportCall) continue; // 无法定位报告调用：已记 blocker，不伪判越界。
    const tiedDenied = observations.some(
      (observation) =>
        observationRefsOf(observation).includes(ref) && deniedByRequest(reportCall, observation),
    );
    if (tiedDenied) {
      // 报告调用请求记录明确不含该观察：used 信用只能来自整 run 并集 → 违规。
      violations.push({
        code: "unbound_ref",
        ref,
        provider_call_ref: reportCall.provider_call_ref,
        detail: "not_in_reported_call",
      });
      unboundRefs.push(ref);
    } else if (!baseRecorded) {
      unresolvedRefs.push(ref);
    }
  }
  return { usedKnown, used, usedSource, usedBound, violations, blockers, unboundRefs, unresolvedRefs };
}

/**
 * 从 chain 原始字段重算派生事实（B42 §13）。判定不信任 artifact 自带的
 * links/blockers/violations/binding 缓存；它们只用于与重算结果比对。
 */
function deriveEvidenceFacts(chain) {
  const observations = Array.isArray(chain.observations) ? chain.observations : [];
  const providerCalls = Array.isArray(chain.provider_calls) ? chain.provider_calls : [];
  const calls = sortedByTime(providerCalls);
  const realCalls = calls.filter((call) => call.real === true);
  const baseRefs = new Set(Array.isArray(chain.base_refs) ? chain.base_refs : []);
  const baseRecorded = chain.base_refs_status === "recorded";
  const preparation = PREPARATION_OUTCOMES.includes(chain.preparation_outcome)
    ? chain.preparation_outcome
    : "unknown";
  const staleOnRestore = STALE_ON_RESTORE_VALUES.includes(chain.stale_on_restore)
    ? chain.stale_on_restore
    : "unknown";
  const replayStatus = resolveReplayStatus(chain);
  const violations = [];
  const blockers = [];
  if (!baseRecorded) blockers.push("base_refs_unknown");
  if (!Array.isArray(chain.used_context_refs)) blockers.push("used_context_refs_unknown");
  if (preparation === "unknown") blockers.push("preparation_outcome_unknown");
  if (staleOnRestore === "unknown") blockers.push("stale_on_restore_unknown");
  if (observations.some((observation) => observation.metadata_missing === true)) {
    blockers.push("observation_metadata_missing");
  }

  const { unread, stale } = classifyObservationRefs(observations);
  const links = buildObservationLinks(observations, calls);
  const includedObservationRefs = deriveObservationInclusion(
    observations,
    links,
    realCalls,
    blockers,
    violations,
  );
  for (const observation of observations) {
    if (isCreditableObservation(observation) && observation.source_refs.length === 0) {
      violations.push({ code: "observation_source_missing", observation_ref: observation.observation_ref });
    }
  }
  for (const call of calls) {
    // 确定性 provider 手填 real=true 不能变成真实模型证据。
    if (call.real_claimed === true && call.real !== true) {
      violations.push({
        code: "deterministic_provider_claims_real",
        provider_call_ref: call.provider_call_ref,
        provider: call.provider,
      });
    }
  }
  if (replayStatus === "provider_called") {
    violations.push({
      code: "replay_provider_called",
      detail: "replay 默认不重调模型；重调 provider 的运行不得作为 replay 证据信用",
    });
  }

  const reportCallRef = stringOrNull(chain.used_context_refs_provider_call_ref);
  const reportCall = reportCallRef
    ? calls.find((call) => call.provider_call_ref === reportCallRef) ?? null
    : null;
  const credit = deriveUsedCredit(chain, {
    observations,
    links,
    reportCall,
    baseRecorded,
    baseRefs,
    stale,
    unread,
  });
  const unboundRefs = uniqueStrings(credit.unboundRefs);
  return {
    links,
    violations: [...violations, ...credit.violations],
    blockers: uniqueStrings([...blockers, ...credit.blockers]),
    unbound_refs: unboundRefs,
    unresolved_refs: uniqueStrings(credit.unresolvedRefs),
    used_bound_count: credit.usedBound.length,
    used_unbound_count: unboundRefs.length,
    request_inclusion_link_count: includedObservationRefs.size,
    real_observation_link_count: includedObservationRefs.size,
    used_known: credit.usedKnown,
    used_refs: credit.used,
  };
}

/**
 * 构造并校验一条证据链（纯函数，不读文件）。
 *
 * @param {object} input
 * @param {string|null} [input.base_refs] Base 公开 refs；null/undefined 表示未记录（unknown）
 * @param {Array} [input.observations] 实际观察（observation_ref/outcome/source_refs/source_revision/coverage/observed_at）
 * @param {Array} [input.provider_calls] 后续真实 provider 请求
 * @param {string[]|null} [input.used_context_refs] 模型自报告 used refs；null 表示未返回（unknown）
 * @param {string|null} [input.used_context_refs_provider_call_ref] 产出该自报告的 provider call（B42 §13）
 * @param {"self_report"|"inferred_supplied"|"missing"} [input.used_context_refs_source]
 */
export function buildEvidenceChain(input = {}) {
  const base = normalizeBaseRefs(input.base_refs);
  const observations = normalizeObservations(input.observations);
  const providerCalls = normalizeProviderCalls(input.provider_calls);
  const usedRaw = input.used_context_refs;
  const usedKnown = Array.isArray(usedRaw);
  const used = usedKnown ? uniqueStrings(usedRaw.map(refToken)) : [];
  const usedSource = input.used_context_refs_source ?? (usedKnown ? "self_report" : "missing");
  const preparationOutcome = PREPARATION_OUTCOMES.includes(input.preparation_outcome)
    ? input.preparation_outcome
    : "unknown";
  const staleOnRestore = STALE_ON_RESTORE_VALUES.includes(input.stale_on_restore)
    ? input.stale_on_restore
    : "unknown";
  // B42 §12.1：replay 用三态表达；旧布尔 false 不再被读成“已验证未调 provider”。
  const replayStatus = REPLAY_STATUSES.includes(input.replay_status)
    ? input.replay_status
    : input.replay_provider_called === true
      ? "provider_called"
      : "unknown";
  const suppliedRefs = uniqueStrings(input.supplied_refs ?? []);
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
    observation_to_provider_call: [],
    used_context_refs: usedKnown ? used : null,
    used_context_refs_status: usedKnown ? "reported" : "unknown",
    used_context_refs_source: usedSource,
    used_context_refs_provider_call_ref: stringOrNull(input.used_context_refs_provider_call_ref),
    supplied_refs: suppliedRefs,
    unbound_refs: [],
    unresolved_refs: [],
    preparation_outcome: preparationOutcome,
    stale_on_restore: staleOnRestore,
    replay_provider_called: replayStatus === "provider_called",
    replay_status: replayStatus,
    blockers: [],
    violations: [],
    generated_at: timestampOrNull(input.generated_at) ?? new Date().toISOString(),
  };
  const derived = deriveEvidenceFacts(chain);
  chain.observation_to_provider_call = derived.links;
  chain.unbound_refs = derived.unbound_refs;
  chain.unresolved_refs = derived.unresolved_refs;
  chain.blockers = derived.blockers;
  chain.violations = derived.violations;
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
  if (chain.replay_status !== undefined && !REPLAY_STATUSES.includes(chain.replay_status)) {
    errors.push(`replay_status 必须属于 ${REPLAY_STATUSES.join(" | ")}（可选字段；缺省按历史 artifact 记 unknown）`);
  }
  if (
    chain.used_context_refs_provider_call_ref !== undefined &&
    chain.used_context_refs_provider_call_ref !== null &&
    !nonEmptyString(chain.used_context_refs_provider_call_ref)
  ) {
    errors.push("used_context_refs_provider_call_ref 必须是非空字符串或 null（B42 §13，可选）");
  }
  (chain.observations ?? []).forEach((observation, index) => {
    if (!isPlainObject(observation)) {
      errors.push(`observations[${index}] 必须是 object`);
      return;
    }
    if (!OBSERVATION_OUTCOMES.includes(observation.outcome)) {
      errors.push(`observations[${index}].outcome 必须属于 ${OBSERVATION_OUTCOMES.join(" | ")}`);
    }
    if (
      observation.observed_in_calls_status !== undefined &&
      !RECORDING_STATUSES.includes(observation.observed_in_calls_status)
    ) {
      errors.push(
        `observations[${index}].observed_in_calls_status 必须属于 ${RECORDING_STATUSES.join(" | ")}（B42 §13，可选）`,
      );
    }
  });
  (chain.provider_calls ?? []).forEach((call, index) => {
    if (!isPlainObject(call)) {
      errors.push(`provider_calls[${index}] 必须是 object`);
      return;
    }
    if (
      call.request_observation_refs_status !== undefined &&
      !RECORDING_STATUSES.includes(call.request_observation_refs_status)
    ) {
      errors.push(
        `provider_calls[${index}].request_observation_refs_status 必须属于 ${RECORDING_STATUSES.join(" | ")}（B42 §13，可选）`,
      );
    }
  });
  (chain.observation_to_provider_call ?? []).forEach((link, index) => {
    if (!isPlainObject(link)) {
      errors.push(`observation_to_provider_call[${index}] 必须是 object`);
      return;
    }
    if (
      link.includes_observation !== undefined &&
      link.includes_observation !== null &&
      typeof link.includes_observation !== "boolean"
    ) {
      errors.push(
        `observation_to_provider_call[${index}].includes_observation 必须是 boolean|null（B42 §13，可选）`,
      );
    }
  });
  return errors;
}

function sameStringSet(left, right) {
  return JSON.stringify(uniqueStrings(left).sort()) === JSON.stringify(uniqueStrings(right).sort());
}

/**
 * 判定证据链绑定状态（B42 §13：从原始字段重算派生事实，不信任序列化缓存）。
 *
 * @returns {{binding_status: string, reason_codes: string[], violations: object[], blockers: string[],
 *   observation_link_count: number, real_observation_link_count: number,
 *   request_inclusion_link_count: number, used_bound_count: number, used_unbound_count: number,
 *   derived_mismatch: boolean}}
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
      request_inclusion_link_count: 0,
      used_bound_count: 0,
      used_unbound_count: 0,
      derived_mismatch: false,
    };
  }
  const derived = deriveEvidenceFacts(chain);
  const recordedLinks = Array.isArray(chain.observation_to_provider_call)
    ? chain.observation_to_provider_call
    : [];
  const recordedViolationCodes = (Array.isArray(chain.violations) ? chain.violations : [])
    .map((violation) => (isPlainObject(violation) ? violation.code : null))
    .filter(nonEmptyString);
  // B42 §13：旧 artifact 自带的 links/blockers/violations/unbound 缓存不可信；
  // 以原始字段重算结果为准，不一致时保留 derived_mismatch 且不得 verified。
  const derivedMismatch =
    JSON.stringify(recordedLinks) !== JSON.stringify(derived.links) ||
    !sameStringSet(Array.isArray(chain.blockers) ? chain.blockers : [], derived.blockers) ||
    !sameStringSet(recordedViolationCodes, derived.violations.map((violation) => violation.code)) ||
    !sameStringSet(
      Array.isArray(chain.unbound_refs) ? chain.unbound_refs : [],
      derived.unbound_refs,
    );
  const blockers = derivedMismatch
    ? uniqueStrings([...derived.blockers, "evidence_chain_derived_mismatch"])
    : derived.blockers;
  const violations = derived.violations;
  // B42 §12.2：verified 必须没有任何 blocker；missing/unknown 只能 evidence_missing。
  let bindingStatus;
  if (violations.length > 0) bindingStatus = "violated";
  else if (chain.base_refs_status !== "recorded") bindingStatus = "unknown";
  else if (blockers.length > 0) bindingStatus = "partial";
  else bindingStatus = "verified";
  return {
    binding_status: bindingStatus,
    reason_codes: uniqueStrings([...violations.map((violation) => violation.code), ...blockers]),
    violations,
    blockers,
    replay_status: resolveReplayStatus(chain),
    observation_link_count: derived.links.length,
    real_observation_link_count: derived.real_observation_link_count,
    request_inclusion_link_count: derived.request_inclusion_link_count,
    used_bound_count: derived.used_bound_count,
    used_unbound_count: derived.used_unbound_count,
    derived_mismatch: derivedMismatch,
  };
}

// ---------- 场景必需证据声明与完整性判定（B42 §12） ----------

/**
 * 默认声明：全部维度 required（严格默认）。忘记声明不会自动放行。
 * @returns {{schema_version: string, dimensions: Record<string, "required"|"not_applicable">, note: null}}
 */
export function defaultEvidenceRequirements() {
  const dimensions = {};
  for (const dimension of EVIDENCE_DIMENSIONS) dimensions[dimension] = "required";
  return {
    schema_version: EVIDENCE_REQUIREMENTS_SCHEMA_VERSION,
    dimensions,
    note: null,
  };
}

/**
 * 归一化并校验场景必需证据声明（运行前冻结；只表达 required / not_applicable）。
 *
 * 反缩水约束（结构上禁止把必要条件删没）：
 * - `base_refs`、`used_context_refs` 必须 required（模型行为 PASS 必须能核验 Base 与 self_report；
 *   否则 used refs 无从判定）；
 * - `observation_link` / `source_metadata` required 时 `observations` 必须 required；
 * - 未声明维度按 required，未知维度 / 非法值 / 未知顶层字段直接报错。
 */
export function normalizeEvidenceRequirements(raw) {
  if (raw === null || raw === undefined) return defaultEvidenceRequirements();
  if (!isPlainObject(raw)) {
    throw new EvidenceChainError("evidence_requirements 必须是 object", "invalid_requirements", [
      "evidence_requirements 必须是 object",
    ]);
  }
  const errors = [];
  const allowedTop = new Set(["schema_version", "dimensions", "note"]);
  for (const key of Object.keys(raw)) {
    if (!allowedTop.has(key)) errors.push(`未知字段 ${key}`);
  }
  if (raw.schema_version !== undefined && raw.schema_version !== EVIDENCE_REQUIREMENTS_SCHEMA_VERSION) {
    errors.push(`schema_version 必须为 ${EVIDENCE_REQUIREMENTS_SCHEMA_VERSION}`);
  }
  const source = raw.dimensions;
  if (!isPlainObject(source)) {
    errors.push("dimensions 必须是 object");
  } else {
    for (const key of Object.keys(source)) {
      if (!EVIDENCE_DIMENSIONS.includes(key)) errors.push(`未知证据维度 ${key}`);
    }
  }
  const dimensions = {};
  for (const dimension of EVIDENCE_DIMENSIONS) {
    const value = isPlainObject(source) ? source[dimension] : undefined;
    if (value === undefined) dimensions[dimension] = "required";
    else if (EVIDENCE_REQUIREMENT_VALUES.includes(value)) dimensions[dimension] = value;
    else errors.push(`${dimension} 必须属于 ${EVIDENCE_REQUIREMENT_VALUES.join(" | ")}（actual: ${String(value)}）`);
  }
  if (dimensions.base_refs !== "required") {
    errors.push("base_refs 必须 required：模型行为 PASS 必须有 Base 记录，否则 used refs 无法核验");
  }
  if (dimensions.used_context_refs !== "required") {
    errors.push("used_context_refs 必须 required：必须证明模型实际使用，不能从 supplied/Base 推导");
  }
  if (dimensions.observation_link === "required" && dimensions.observations !== "required") {
    errors.push("observation_link required 时 observations 必须 required");
  }
  if (dimensions.source_metadata === "required" && dimensions.observations !== "required") {
    errors.push("source_metadata required 时 observations 必须 required");
  }
  if (errors.length > 0) {
    throw new EvidenceChainError(`非法 evidence_requirements：${errors.join("; ")}`, "invalid_requirements", errors);
  }
  return {
    schema_version: EVIDENCE_REQUIREMENTS_SCHEMA_VERSION,
    dimensions,
    note: stringOrNull(raw.note),
  };
}

/** 校验声明但不抛错（CLI 友好）：返回错误数组。 */
export function validateEvidenceRequirements(value) {
  try {
    normalizeEvidenceRequirements(value);
    return [];
  } catch (error) {
    if (error instanceof EvidenceChainError && error.errors.length > 0) return error.errors;
    return [error.message];
  }
}

/** 旧 CLI/场景 flag 并入声明：requires_observation_link 强制执行链接证据（多声明不放宽）。 */
export function applyLegacyEvidenceFlags(requirements, { requiresObservationLink = false } = {}) {
  const normalized = normalizeEvidenceRequirements(requirements);
  if (!requiresObservationLink) return normalized;
  const dimensions = {
    ...normalized.dimensions,
    observations: "required",
    observation_link: "required",
    source_metadata: "required",
  };
  return { ...normalized, dimensions };
}

/** replay 三态解析：新字段优先；旧 artifact 的布尔 false 不能反推“已验证未调用”。 */
export function resolveReplayStatus(chain) {
  if (!isPlainObject(chain)) return "unknown";
  if (REPLAY_STATUSES.includes(chain.replay_status)) return chain.replay_status;
  return chain.replay_provider_called === true ? "provider_called" : "unknown";
}

/**
 * 必需证据完整性判定（B42 §12.2 / §13）。纯函数，只读 chain 原始字段 + 声明。
 *
 * - `status=complete` 才允许进入模型行为 PASS 判定；
 * - 必需维度缺失 → 原因码（evidence_missing）；只有“记录之间互相否定”的
 *   observation_link 缺失属于因果断言被证据否定，按 fail 处理（`fail_codes`）。
 */
export function evaluateEvidenceCompleteness(chain, requirements) {
  const normalized = normalizeEvidenceRequirements(requirements);
  const observations = Array.isArray(chain?.observations) ? chain.observations : [];
  const providerCalls = Array.isArray(chain?.provider_calls) ? chain.provider_calls : [];
  const derived = deriveEvidenceFacts(chain);
  const recordedRealCalls = providerCalls.filter((call) => call?.real === true).length;
  const includedRefs = new Set();
  for (const link of derived.links) {
    if (link?.includes_observation !== true || link?.provider_real !== true) continue;
    if (link?.ordered !== true) continue;
    if (nonEmptyString(link.observation_ref)) includedRefs.add(link.observation_ref);
  }
  const allIncluded =
    observations.length > 0 &&
    observations.every((observation) => includedRefs.has(observation?.observation_ref));
  const metadataComplete = observations.filter(
    (observation) => observation?.metadata_missing !== true,
  ).length;
  const usedStatus = chain?.used_context_refs_status ?? "unknown";
  const usedSource = chain?.used_context_refs_source ?? "missing";
  const used = Array.isArray(chain?.used_context_refs) ? chain.used_context_refs : [];
  const reportCallRef = stringOrNull(chain?.used_context_refs_provider_call_ref);
  const reportCallKnown = reportCallRef
    ? providerCalls.some((call) => call?.provider_call_ref === reportCallRef)
    : false;
  const usedFullyCredited =
    used.length === 0
      ? usedStatus === "reported" && usedSource !== "inferred_supplied"
      : reportCallKnown &&
        derived.used_bound_count === used.length &&
        derived.unbound_refs.length === 0;
  const replayStatus = resolveReplayStatus(chain);
  const preparation = chain?.preparation_outcome ?? "unknown";
  const staleOnRestore = chain?.stale_on_restore ?? "unknown";

  const present = {
    base_refs: chain?.base_refs_status === "recorded",
    observations: observations.length > 0,
    observation_link: allIncluded,
    source_metadata: observations.length > 0 && metadataComplete === observations.length,
    used_context_refs:
      usedStatus === "reported" && usedSource !== "inferred_supplied" && usedFullyCredited,
    preparation: preparation !== "unknown",
    restore: staleOnRestore !== "unknown",
    replay: replayStatus === "no_provider_call",
  };
  const observed = {
    base_refs: chain?.base_refs_status ?? "unknown",
    observations: observations.length,
    observation_link: `${includedRefs.size}/${observations.length}`,
    source_metadata: `${metadataComplete}/${observations.length}`,
    used_context_refs: {
      status: usedStatus,
      source: usedSource,
      bound_count: derived.used_bound_count,
      unbound_count: derived.unbound_refs.length,
    },
    preparation,
    restore: staleOnRestore,
    replay: replayStatus,
  };

  const dimensions = {};
  const missingRequired = [];
  const reasonCodes = [];
  const failCodes = [];
  for (const dimension of EVIDENCE_DIMENSIONS) {
    const requirement = normalized.dimensions[dimension];
    const ok = present[dimension];
    dimensions[dimension] = { requirement, present: ok, observed: observed[dimension] };
    if (requirement !== "required" || ok) continue;
    missingRequired.push(dimension);
    reasonCodes.push(EVIDENCE_DIMENSION_REASON_CODES[dimension]);
    if (dimension !== "observation_link" || observations.length === 0) continue;
    if (recordedRealCalls === 0) continue;
    // fail 只来自已记录证据之间的否定：顺序矛盾 / 反向声称冲突 / 请求记录明确未包含。
    const contradiction =
      derived.blockers.includes("observation_not_included_in_request") ||
      derived.violations.some((violation) =>
        ["observation_after_provider_call", "observation_link_conflict"].includes(violation.code),
      );
    if (contradiction) failCodes.push("observation_not_linked");
  }
  return {
    status: missingRequired.length === 0 ? "complete" : "missing",
    requirements: normalized.dimensions,
    dimensions,
    missing_required: missingRequired,
    reason_codes: uniqueStrings(reasonCodes),
    fail_codes: uniqueStrings(failCodes),
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

// 生成参数白名单：只读取真实请求体里的采样参数，不把 messages/正文带进索引。
const REQUEST_PARAM_KEYS = Object.freeze([
  "temperature",
  "top_p",
  "top_k",
  "max_tokens",
  "max_completion_tokens",
  "seed",
  "stop",
  "presence_penalty",
  "frequency_penalty",
]);

function extractRequestParams(body) {
  if (!isPlainObject(body)) return null;
  const params = {};
  for (const key of REQUEST_PARAM_KEYS) {
    if (body[key] !== undefined && body[key] !== null) params[key] = body[key];
  }
  return Object.keys(params).length > 0 ? params : null;
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
      request_params: extractRequestParams(body),
      // B42 §13：真实 artifact 只有在请求侧显式记录观察 refs 时才产出该字段；
      // 未记录保持 undefined → normalizeProviderCall 记 unknown（不得推断包含/未包含）。
      request_observation_refs: Array.isArray(row.request_observation_refs)
        ? uniqueStrings(row.request_observation_refs.map(refToken))
        : Array.isArray(request.observation_refs)
          ? uniqueStrings(request.observation_refs.map(refToken))
          : undefined,
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
        ...(call.request_observation_refs !== undefined
          ? { request_observation_refs: call.request_observation_refs }
          : {}),
      })),
    used_context_refs: usedReported ? usedFlat : null,
    used_context_refs_source: usedReported ? "self_report" : "missing",
    used_context_refs_provider_call_ref: options.used_context_refs_provider_call_ref ?? null,
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

/**
 * 读取 artifact 目录里已记录的证据链（quality-evidence-chain/v1）。
 * 缺文件返回 null；存在但非法抛 EvidenceChainError（调用方按 evidence_missing 处理，不猜）。
 */
export function readRecordedEvidenceChain(artifactDir) {
  const file = path.join(artifactDir, EVIDENCE_CHAIN_FILE);
  if (!fs.existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new EvidenceChainError(
      `evidence-chain.json 不是合法 JSON：${error.message}`,
      "invalid_evidence_chain",
      [error.message],
    );
  }
  const errors = validateEvidenceChain(data);
  if (errors.length > 0) {
    throw new EvidenceChainError(
      `evidence-chain.json 未通过校验：${errors.join("; ")}`,
      "invalid_evidence_chain",
      errors,
    );
  }
  return data;
}

/**
 * 读取运行前冻结的必需证据声明（quality-evidence-requirements/v1）。
 * 缺文件返回 null；存在但非法抛错——不能静默按默认/放宽处理。
 */
export function readRecordedEvidenceRequirements(artifactDir) {
  const file = path.join(artifactDir, EVIDENCE_REQUIREMENTS_FILE);
  if (!fs.existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new EvidenceChainError(
      `evidence-requirements.json 不是合法 JSON：${error.message}`,
      "invalid_requirements",
      [error.message],
    );
  }
  normalizeEvidenceRequirements(data);
  return data;
}
