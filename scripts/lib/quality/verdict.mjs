// B41 CP4：quality verdict v2 的唯一生成/读取/校验实现；纯 Node ESM，无外部依赖。
// 契约：quality/acceptance/verdict-schema.json（quality-verdict/v2）。
// 硬规则：缺 verdict.json / 缺 status / 结构无效一律 evidence_missing，绝不默认 PASS；
// 旧 summary.json 只算 artifact，读取时 legacy_summary=true 且 status=evidence_missing。
import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = "quality-verdict/v2";
export const VERDICT_FILE = "verdict.json";
export const LEGACY_SUMMARY_FILE = "summary.json";
export const STATUSES = Object.freeze(["pass", "fail", "skipped", "not_run", "evidence_missing"]);
export const ARTIFACT_ROLES = Object.freeze(["required", "optional", "failure", "scoped"]);
export const LAYER_STATUSES = Object.freeze(["pass", "fail", "unknown", "not_applicable"]);
export const SURFACES = Object.freeze(["browser", "tauri"]);
export const REQUIRED_FIELDS = Object.freeze([
  "schema_version",
  "scenario_id",
  "tier",
  "surface",
  "status",
  "artifact_dir",
  "generated_at",
  "git_head",
]);
// read CLI 退出码映射；blocked 不是 verdict 状态，skipped 承担批次 blocked 语义（65）。
export const EXIT_CODES = Object.freeze({
  pass: 0,
  fail: 1,
  skipped: 65,
  evidence_missing: 67,
  not_run: 69,
  usage: 64,
  config: 66,
});

const TOP_LEVEL_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  "reason",
  "reason_codes",
  "driver",
  "provider",
  "model",
  "actual_model",
  "attempt",
  "timeouts",
  "started_at",
  "finished_at",
  "duration_ms",
  "artifact_links",
  "evidence_required",
  "evidence_present",
  "evidence_missing",
  "mechanism",
  "model_behavior",
  "final_refs",
  "failure_refs",
  "scoped_refs",
  "batch",
]);
const TOKEN_ARRAY_FIELDS = [
  "reason_codes",
  "evidence_required",
  "evidence_present",
  "evidence_missing",
  "final_refs",
  "failure_refs",
  "scoped_refs",
];
const LAYER_FIELDS = ["mechanism", "model_behavior"];

export class VerdictError extends Error {
  constructor(message, code = "invalid_verdict", errors = []) {
    super(message);
    this.name = "VerdictError";
    this.code = code;
    this.errors = errors;
  }
}

export function exitCodeForStatus(status) {
  const code = EXIT_CODES[status];
  if (code === undefined) throw new VerdictError(`未知 verdict status：${status}`, "invalid_status");
  return code;
}

export function buildVerdict(opts = {}) {
  const verdict = {
    schema_version: SCHEMA_VERSION,
    scenario_id: opts.scenario_id,
    tier: opts.tier,
    surface: opts.surface,
    status: opts.status,
    reason: opts.reason ?? null,
    reason_codes: stringList(opts.reason_codes),
    driver: opts.driver ?? null,
    provider: opts.provider ?? null,
    model: opts.model ?? null,
    actual_model: opts.actual_model ?? null,
    attempt: opts.attempt ?? 1,
    timeouts: opts.timeouts ?? 0,
    started_at: opts.started_at ?? null,
    finished_at: opts.finished_at ?? null,
    duration_ms: deriveDuration(opts),
    artifact_dir: opts.artifact_dir,
    artifact_links: normalizeLinks(opts.artifact_links),
    evidence_required: stringList(opts.evidence_required),
    evidence_present: stringList(opts.evidence_present),
    evidence_missing: deriveMissing(opts),
    mechanism: normalizeLayer(opts.mechanism),
    model_behavior: normalizeLayer(opts.model_behavior),
    final_refs: stringList(opts.final_refs),
    failure_refs: stringList(opts.failure_refs),
    scoped_refs: stringList(opts.scoped_refs),
    generated_at: opts.generated_at ?? new Date().toISOString(),
    git_head: opts.git_head ?? null,
  };
  if (opts.batch !== undefined) verdict.batch = normalizeBatch(opts.batch);
  const errors = validateVerdict(verdict);
  if (errors.length > 0) {
    throw new VerdictError(`构造的 verdict 未通过结构校验：${errors.join("; ")}`, "invalid_verdict", errors);
  }
  return verdict;
}

export function validateVerdict(value) {
  if (!isPlainObject(value)) return ["verdict 必须是 JSON object"];
  const errors = [];
  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_FIELDS.has(key)) errors.push(`未知字段 ${key}（additionalProperties=false）`);
  }
  for (const key of REQUIRED_FIELDS) {
    if (!(key in value)) errors.push(`缺少必填字段 ${key}`);
  }

  if ("schema_version" in value && value.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version 必须为 ${SCHEMA_VERSION}`);
  }
  for (const key of ["scenario_id", "tier", "artifact_dir"]) {
    if (key in value && !isNonEmptyString(value[key])) errors.push(`${key} 必须是非空字符串`);
  }
  if ("surface" in value && !SURFACES.includes(value.surface)) {
    errors.push(`surface 必须属于 ${SURFACES.join(" | ")}`);
  }
  if ("status" in value && !STATUSES.includes(value.status)) {
    errors.push(`status 必须属于 ${STATUSES.join(" | ")}`);
  }
  for (const key of ["reason", "driver", "provider", "model", "actual_model"]) {
    if (key in value && !isNullableString(value[key])) errors.push(`${key} 必须是字符串或 null`);
  }
  for (const key of ["started_at", "finished_at"]) {
    if (key in value && value[key] !== null && !isTimestamp(value[key])) {
      errors.push(`${key} 必须是 ISO 8601 时间字符串或 null`);
    }
  }
  if ("generated_at" in value && !isTimestamp(value.generated_at)) {
    errors.push("generated_at 必须是 ISO 8601 时间字符串");
  }
  if ("git_head" in value && !isNullableString(value.git_head)) {
    errors.push("git_head 必须是 commit 字符串或 null（无法取得时写 null，读取方按 stale 处理）");
  }
  if ("attempt" in value && !isIntegerAtLeast(value.attempt, 1)) errors.push("attempt 必须是 >=1 的整数");
  if ("timeouts" in value && !isIntegerAtLeast(value.timeouts, 0)) errors.push("timeouts 必须是 >=0 的整数");
  if ("duration_ms" in value && value.duration_ms !== null && !isIntegerAtLeast(value.duration_ms, 0)) {
    errors.push("duration_ms 必须是 >=0 的整数或 null");
  }
  for (const key of TOKEN_ARRAY_FIELDS) {
    if (key in value) validateStringArray(value, key, errors);
  }
  validateEvidenceSubset(value, errors);
  if ("artifact_links" in value) validateArtifactLinks(value.artifact_links, errors);
  for (const key of LAYER_FIELDS) {
    if (key in value) validateLayer(key, value[key], errors);
  }
  if ("batch" in value) validateBatch(value.batch, errors);
  validateStatusRules(value, errors);
  return errors;
}

export function writeVerdict(artifactDir, verdict, opts = {}) {
  if (!isNonEmptyString(artifactDir)) {
    throw new VerdictError("writeVerdict 需要 artifact_dir 非空字符串", "usage");
  }
  const errors = validateVerdict(verdict);
  if (errors.length > 0) {
    throw new VerdictError(`拒绝写入无效 verdict：${errors.join("; ")}`, "invalid_verdict", errors);
  }
  const target = path.join(artifactDir, VERDICT_FILE);
  const previous = readExistingVerdict(target);
  // 失败证据不得删除，PASS 也不得被后续失败运行静默覆盖：先归档旧运行，或显式 allowOverwritePass。
  if (previous?.status === "pass" && verdict.status !== "pass" && opts.allowOverwritePass !== true) {
    throw new VerdictError(
      `拒绝用 ${verdict.status} verdict 覆盖已有 PASS verdict（${target}）；请先把旧运行归档到 failure/scoped，或显式传 allowOverwritePass`,
      "pass_verdict_protected",
    );
  }
  fs.mkdirSync(artifactDir, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(verdict, null, 2)}\n`);
  fs.renameSync(tmp, target);
  return { ok: true, path: target, previous_status: previous?.status ?? null };
}

export function readVerdict(artifactDir) {
  if (!isNonEmptyString(artifactDir)) {
    throw new VerdictError("readVerdict 需要 artifact_dir 非空字符串", "usage");
  }
  const verdictPath = path.join(artifactDir, VERDICT_FILE);
  const legacySummary = fs.existsSync(path.join(artifactDir, LEGACY_SUMMARY_FILE));
  const fallback = (reason, reasonCodes) => ({
    ok: false,
    status: "evidence_missing",
    reason,
    reason_codes: reasonCodes,
    legacy_summary: legacySummary,
    artifact_dir: artifactDir,
  });

  if (!fs.existsSync(artifactDir)) {
    return fallback(`artifact 目录不存在：${artifactDir}`, ["artifact_dir_missing", "verdict_missing"]);
  }
  let text;
  try {
    text = fs.readFileSync(verdictPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback(
        legacySummary
          ? `缺少 ${VERDICT_FILE}；仅有 legacy ${LEGACY_SUMMARY_FILE}，不能据此判定 PASS`
          : `缺少 ${VERDICT_FILE}`,
        legacySummary ? ["verdict_missing", "legacy_summary"] : ["verdict_missing"],
      );
    }
    return fallback(`读取 ${VERDICT_FILE} 失败：${error.message}`, ["verdict_unreadable"]);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return fallback(`${VERDICT_FILE} 不是合法 JSON：${error.message}`, ["verdict_invalid_json"]);
  }
  const errors = validateVerdict(parsed);
  if (errors.length > 0) {
    return {
      ...fallback(
        `${VERDICT_FILE} 未通过结构校验（缺 status 或字段非法时一律 evidence_missing，不得默认 PASS）`,
        ["verdict_invalid"],
      ),
      errors,
    };
  }
  return { ok: true, verdict: parsed };
}

function deriveMissing(opts) {
  if (opts.evidence_missing !== undefined) return stringList(opts.evidence_missing);
  const required = stringList(opts.evidence_required);
  const present = stringList(opts.evidence_present);
  if (!Array.isArray(required) || !Array.isArray(present)) return [];
  return required.filter((kind) => !present.includes(kind));
}

function deriveDuration(opts) {
  if (opts.duration_ms !== undefined) return opts.duration_ms;
  const start = Date.parse(opts.started_at ?? "");
  const end = Date.parse(opts.finished_at ?? "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function normalizeLayer(layer) {
  if (layer === undefined) return { status: "unknown", evidence_refs: [] };
  if (!isPlainObject(layer)) return layer;
  return { status: layer.status, evidence_refs: stringList(layer.evidence_refs) };
}

function normalizeLinks(links) {
  if (links === undefined) return [];
  if (!Array.isArray(links)) return links;
  return links.map((link) =>
    isPlainObject(link) ? { kind: link.kind, path: link.path, role: link.role } : link,
  );
}

function normalizeBatch(batch) {
  if (!isPlainObject(batch)) return batch;
  return { id: batch.id, index: batch.index, total: batch.total };
}

function stringList(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return value;
  return [...new Set(value)];
}

function readExistingVerdict(target) {
  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validateStringArray(value, key, errors, prefix = "") {
  const label = `${prefix}${key}`;
  const list = value[key];
  if (!Array.isArray(list)) {
    errors.push(`${label} 必须是字符串数组`);
    return;
  }
  const seen = new Set();
  for (const item of list) {
    if (!isNonEmptyString(item)) errors.push(`${label} 含非字符串或空值`);
    else if (seen.has(item)) errors.push(`${label} 含重复项 ${item}`);
    else seen.add(item);
  }
}

function validateEvidenceSubset(value, errors) {
  if (!Array.isArray(value.evidence_required) || !Array.isArray(value.evidence_missing)) return;
  const required = new Set(value.evidence_required);
  for (const missing of value.evidence_missing) {
    if (!required.has(missing)) {
      errors.push(`evidence_missing 含未在 evidence_required 声明的证据 ${missing}`);
    }
  }
}

function validateArtifactLinks(links, errors) {
  if (!Array.isArray(links)) {
    errors.push("artifact_links 必须是数组");
    return;
  }
  links.forEach((link, index) => {
    if (!isPlainObject(link)) {
      errors.push(`artifact_links[${index}] 必须是 object`);
      return;
    }
    for (const key of Object.keys(link)) {
      if (!["kind", "path", "role"].includes(key)) errors.push(`artifact_links[${index}] 未知字段 ${key}`);
    }
    for (const key of ["kind", "path", "role"]) {
      if (!(key in link)) errors.push(`artifact_links[${index}] 缺少 ${key}`);
    }
    if ("kind" in link && !isNonEmptyString(link.kind)) errors.push(`artifact_links[${index}].kind 必须是非空字符串`);
    if ("path" in link && !isNonEmptyString(link.path)) errors.push(`artifact_links[${index}].path 必须是非空字符串`);
    if ("role" in link && !ARTIFACT_ROLES.includes(link.role)) {
      errors.push(`artifact_links[${index}].role 必须属于 ${ARTIFACT_ROLES.join(" | ")}`);
    }
  });
}

function validateLayer(field, layer, errors) {
  if (!isPlainObject(layer)) {
    errors.push(`${field} 必须是 object`);
    return;
  }
  for (const key of Object.keys(layer)) {
    if (!["status", "evidence_refs"].includes(key)) errors.push(`${field} 未知字段 ${key}`);
  }
  if (!("status" in layer)) errors.push(`${field}.status 缺失`);
  else if (!LAYER_STATUSES.includes(layer.status)) {
    errors.push(`${field}.status 必须属于 ${LAYER_STATUSES.join(" | ")}`);
  }
  if (!("evidence_refs" in layer)) errors.push(`${field}.evidence_refs 缺失`);
  else validateStringArray(layer, "evidence_refs", errors, `${field}.`);
}

function validateBatch(batch, errors) {
  if (!isPlainObject(batch)) {
    errors.push("batch 必须是 object");
    return;
  }
  for (const key of Object.keys(batch)) {
    if (!["id", "index", "total"].includes(key)) errors.push(`batch 未知字段 ${key}`);
  }
  for (const key of ["id", "index", "total"]) {
    if (!(key in batch)) errors.push(`batch.${key} 缺失`);
  }
  if ("id" in batch && !isNonEmptyString(batch.id)) errors.push("batch.id 必须是非空字符串");
  if ("index" in batch && !isIntegerAtLeast(batch.index, 0)) errors.push("batch.index 必须是 >=0 的整数");
  if ("total" in batch && !isIntegerAtLeast(batch.total, 1)) errors.push("batch.total 必须是 >=1 的整数");
  if (isIntegerAtLeast(batch.index, 0) && isIntegerAtLeast(batch.total, 1) && batch.index >= batch.total) {
    errors.push("batch.index 必须小于 batch.total（0-based）");
  }
}

function validateStatusRules(value, errors) {
  if (!STATUSES.includes(value.status)) return;
  if (["fail", "skipped", "evidence_missing"].includes(value.status) && !isNonEmptyString(value.reason)) {
    errors.push(`status=${value.status} 必须提供非空 reason`);
  }
  if (value.status !== "pass") return;
  for (const field of LAYER_FIELDS) {
    const layer = value[field];
    if (!isPlainObject(layer)) {
      errors.push(`status=pass 必须显式提供 ${field}（机制/模型行为不得合并成单一 PASS）`);
    } else if (!["pass", "not_applicable"].includes(layer.status)) {
      errors.push(`status=pass 时 ${field}.status 只能是 pass 或 not_applicable，当前 ${layer.status}`);
    }
  }
  if (Array.isArray(value.evidence_missing) && value.evidence_missing.length > 0) {
    errors.push("status=pass 不得声明 evidence_missing（缺证据不得默认 PASS）");
  }
  // 显式传 evidence_missing=[] 不能绕过缺证据检查：PASS 时 required 必须全部 present。
  if (Array.isArray(value.evidence_required) && Array.isArray(value.evidence_present)) {
    const present = new Set(value.evidence_present);
    for (const kind of value.evidence_required) {
      if (!present.has(kind)) {
        errors.push(`status=pass 时 evidence_required 中的 ${kind} 必须出现在 evidence_present（缺证据不得默认 PASS）`);
      }
    }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value) {
  return value === null || isNonEmptyString(value);
}

function isTimestamp(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isIntegerAtLeast(value, minimum) {
  return Number.isInteger(value) && value >= minimum;
}
