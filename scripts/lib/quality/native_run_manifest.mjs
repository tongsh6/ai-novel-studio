// B42 CP3：原生证据发现——把一个原生 artifact 目录扫描成统一 run manifest。
//
// 契约（CP0 §6.4 冻结，additive sidecar，不动 B41 quality-verdict/v2）：
//   schema_version = quality-native-run/v1
//
// 目的：让原生系统驱动（AX/CGEvent/CUA + native transport proxy）的 run 证据可机读，
// 不再依赖人工读目录。必须统一暴露：run / final / failure / scoped checks /
// termination / native-transport / AX 截图与文本 / DB snapshot / 生产指纹 /
// driver / provider / model / scope。
//
// 硬规则：
// - final 与 failure 并存时只看 final 写 PASS = 禁止：failure 存在即 fail；
// - termination 非 0/非 EXIT 视为失败（被 TERM/KILL 的 run 不是通过）；
// - scoped 证据不得外推为全矩阵：scope_class=scoped 时 full_matrix_established=false；
// - 缺少 final 与 failure 的目录只能是 evidence_missing，不能默认 PASS；
// - 只读 artifact：不写、不改、不删历史证据。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { classifyProvider } from "./evidence_chain.mjs";

export const NATIVE_RUN_SCHEMA_VERSION = "quality-native-run/v1";
export const NATIVE_RUN_MANIFEST_FILE = "native-run-manifest.json";
export const NATIVE_RUN_STATUSES = Object.freeze(["pass", "fail", "evidence_missing"]);
export const SCOPE_CLASSES = Object.freeze(["full", "scoped", "unknown"]);
export const NATIVE_DRIVERS = Object.freeze([
  "ax-native-system-ui",
  "cua-native-system-ui",
  "external-system-ui",
  "external-ui-driver",
  "playwright",
]);

const FAILURE_REASONS = Object.freeze([
  "failure_present",
  "termination_not_clean",
  "checks_failed",
  "native_check_failed",
  "identity_conflict",
]);

const EVIDENCE_MISSING_REASONS = Object.freeze([
  "run_evidence_missing",
  "final_missing",
  "run_identity_missing",
]);

export class NativeRunManifestError extends Error {
  constructor(message, code = "invalid_native_run", errors = []) {
    super(message);
    this.name = "NativeRunManifestError";
    this.code = code;
    this.errors = errors;
  }
}

// ---------- 基础读取工具（只读） ----------

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

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readJsonlIfExists(file) {
  try {
    const rows = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const start = trimmed.indexOf("{");
      if (start < 0) continue;
      try {
        rows.push(JSON.parse(trimmed.slice(start)));
      } catch {
        // 非 JSON 行不进证据。
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function listFiles(root, predicate, { depth = 4, skipDirs = [] } = {}) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir, level) => {
    if (level > depth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name) || entry.name.endsWith(".app")) continue;
        walk(full, level + 1);
        continue;
      }
      if (predicate(entry.name, full)) out.push(full);
    }
  };
  walk(root, 0);
  out.sort();
  return out;
}

function sha256File(file) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

function statOrNull(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function relative(root, file) {
  return path.relative(root, file);
}

function resolveLayout(artifactDir) {
  const absolute = path.resolve(artifactDir);
  const runDir = fs.existsSync(path.join(absolute, "run")) ? path.join(absolute, "run") : absolute;
  return { artifactDir: absolute, runDir, layout: runDir === absolute ? "flat" : "nested-run" };
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

// ---------- 各证据面扫描 ----------

function scanTermination({ artifactDir, runDir }) {
  const file = firstExisting([path.join(artifactDir, "termination.json"), path.join(runDir, "termination.json")]);
  if (!file) {
    return { found: false, path: null, signal: null, exit_code: null, at: null, last_heartbeat: null };
  }
  const data = readJsonIfExists(file) ?? {};
  return {
    found: true,
    path: relative(artifactDir, file),
    signal: stringOrNull(data.signal),
    exit_code: Number.isInteger(data.exit_code) ? data.exit_code : null,
    at: timestampOrNull(data.at),
    last_heartbeat: isPlainObject(data.last_heartbeat)
      ? { at: timestampOrNull(data.last_heartbeat.at), pid: data.last_heartbeat.pid ?? null }
      : null,
  };
}

function scanDetachedMeta({ artifactDir, runDir }) {
  const file = firstExisting([path.join(artifactDir, "detached-meta.json"), path.join(runDir, "detached-meta.json")]);
  if (!file) {
    return { found: false, path: null, head: null, started_at: null, source_hashes: {}, command: null, env: {} };
  }
  const data = readJsonIfExists(file) ?? {};
  return {
    found: true,
    path: relative(artifactDir, file),
    head: stringOrNull(data.head),
    started_at: timestampOrNull(data.started_at),
    source_hashes: isPlainObject(data.source_hashes) ? data.source_hashes : {},
    command: Array.isArray(data.command) ? data.command : null,
    env: isPlainObject(data.env) ? data.env : {},
  };
}

function scanSummary({ artifactDir, runDir }) {
  const canonical = path.join(runDir, "summary.json");
  const variants = listFiles(runDir, (name) => /^summary.*\.json$/u.test(name) && name !== "summary.json");
  if (!fs.existsSync(canonical)) {
    return {
      found: false,
      path: null,
      variants: variants.map((file) => relative(artifactDir, file)),
      data: null,
    };
  }
  const data = readJsonIfExists(canonical) ?? {};
  return { found: true, path: relative(artifactDir, canonical), variants: variants.map((file) => relative(artifactDir, file)), data };
}

function scanFinalFailure({ artifactDir, runDir }) {
  const finalFile = firstExisting([path.join(runDir, "final.json"), path.join(artifactDir, "final.json")]);
  const failureFile = firstExisting([path.join(runDir, "failure.json"), path.join(artifactDir, "failure.json")]);
  const finalData = finalFile ? readJsonIfExists(finalFile) : null;
  const failureData = failureFile ? readJsonIfExists(failureFile) : null;
  const finalFacts = isPlainObject(finalData?.facts)
    ? finalData.facts
    : isPlainObject(finalData?.main)
      ? finalData.main
      : null;
  return {
    final: finalFile
      ? {
          found: true,
          path: relative(artifactDir, finalFile),
          at: timestampOrNull(finalData?.at),
          checkpoint: stringOrNull(finalData?.checkpoint),
          facts_keys: finalFacts ? Object.keys(finalFacts) : [],
          facts_present: Boolean(finalFacts),
        }
      : { found: false, path: null, at: null, checkpoint: null, facts_keys: [], facts_present: false },
    failure: failureFile
      ? {
          found: true,
          path: relative(artifactDir, failureFile),
          at: timestampOrNull(failureData?.at),
          phase: stringOrNull(failureData?.phase),
          reason: stringOrNull(failureData?.reason),
          detail: stringOrNull(failureData?.detail),
          affected_inputs: Array.isArray(failureData?.affected_inputs) ? failureData.affected_inputs : [],
          remaining_trials: Array.isArray(failureData?.remaining_trials) ? failureData.remaining_trials : [],
        }
      : { found: false, path: null, at: null, phase: null, reason: null, detail: null, affected_inputs: [], remaining_trials: [] },
  };
}

const CANONICAL_CHECK_FILE = /(^|[-_])native-checks\.json$|^native-evidence\.json$/u;
const VARIANT_CHECK_FILE = /(pre-|old|bak|backup)/iu;

function scanChecks({ artifactDir, runDir, summary }) {
  const checkFiles = listFiles(runDir, (name) => CANONICAL_CHECK_FILE.test(name), { depth: 1 });
  const canonicalFiles = checkFiles.filter((file) => !VARIANT_CHECK_FILE.test(path.basename(file)));
  const variantFiles = checkFiles.filter((file) => VARIANT_CHECK_FILE.test(path.basename(file)));
  const merged = {};
  const sources = [];
  for (const file of canonicalFiles) {
    const data = readJsonIfExists(file);
    if (!isPlainObject(data?.checks)) continue;
    sources.push({ path: relative(artifactDir, file), count: Object.keys(data.checks).length });
    for (const [name, value] of Object.entries(data.checks)) {
      if (value === false) merged[name] = false;
      else if (!(name in merged)) merged[name] = true;
    }
  }
  if (isPlainObject(summary.data?.checks)) {
    for (const [name, value] of Object.entries(summary.data.checks)) {
      if (value === false) merged[name] = false;
      else if (!(name in merged)) merged[name] = true;
    }
    sources.push({ path: `${summary.path}#checks`, count: Object.keys(summary.data.checks).length });
  }
  const summaryFailed = Array.isArray(summary.data?.failed_checks) ? summary.data.failed_checks : [];
  for (const name of summaryFailed) merged[name] = false;
  const failed = Object.entries(merged)
    .filter(([, value]) => value === false)
    .map(([name]) => name)
    .sort();
  const variantFailed = [];
  for (const file of variantFiles) {
    const data = readJsonIfExists(file);
    if (!isPlainObject(data?.checks)) continue;
    for (const [name, value] of Object.entries(data.checks)) {
      if (value === false) variantFailed.push(`${relative(artifactDir, file)}:${name}`);
    }
  }
  return {
    sources,
    variant_files: variantFiles.map((file) => relative(artifactDir, file)),
    total: Object.keys(merged).length,
    passed: Object.values(merged).filter((value) => value === true).length,
    names: Object.keys(merged).sort(),
    passed_names: Object.entries(merged)
      .filter(([, value]) => value === true)
      .map(([name]) => name)
      .sort(),
    failed,
    variant_failed: uniqueStrings(variantFailed).sort(),
    summary: summary.found
      ? {
          checks_passed: Number.isInteger(summary.data?.checks_passed) ? summary.data.checks_passed : null,
          checks_total: Number.isInteger(summary.data?.checks_total) ? summary.data.checks_total : null,
          // 三态：true/false/null(未声明)。缺失不能当成 false（否则把未知误判为失败）。
          all_checks_passed:
            typeof summary.data?.all_checks_passed === "boolean"
              ? summary.data.all_checks_passed
              : null,
        }
      : { checks_passed: null, checks_total: null, all_checks_passed: null },
  };
}

function scanNativeTransport({ artifactDir, runDir }) {
  const file = firstExisting([
    path.join(runDir, "native-transport.jsonl"),
    path.join(artifactDir, "native-transport.jsonl"),
  ]);
  if (!file) {
    return {
      found: false,
      path: null,
      total_rows: 0,
      http_requests: 0,
      http_2xx: 0,
      http_failures: [],
      frames: 0,
      first_at: null,
      last_at: null,
    };
  }
  const rows = readJsonlIfExists(file);
  let httpRequests = 0;
  let http2xx = 0;
  let frames = 0;
  const failures = [];
  let firstAt = null;
  let lastAt = null;
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    if (firstAt === null && timestampOrNull(row.at)) firstAt = row.at;
    if (timestampOrNull(row.at)) lastAt = row.at;
    if (Array.isArray(row.frame)) {
      frames += 1;
      continue;
    }
    if (nonEmptyString(row.method) || nonEmptyString(row.path)) {
      httpRequests += 1;
      const status = Number(row.status);
      if (status >= 200 && status < 300) http2xx += 1;
      else failures.push({ method: row.method ?? null, path: row.path ?? null, status: Number.isInteger(status) ? status : null });
    }
  }
  return {
    found: true,
    path: relative(artifactDir, file),
    total_rows: rows.length,
    http_requests: httpRequests,
    http_2xx: http2xx,
    // HTTP 200 只是传输事实，不能证明模型行为；由 evaluate 决定用途。
    http_failures: failures.slice(0, 20),
    frames,
    first_at: firstAt,
    last_at: lastAt,
  };
}

function scanAxAndScreens({ artifactDir, runDir }) {
  const files = listFiles(runDir, () => true, { depth: 1 });
  const axDumps = files.filter((file) => file.endsWith(".ax.txt"));
  const textDumps = files.filter((file) => file.endsWith(".text.txt"));
  const images = files.filter((file) => /\.(jpe?g|png)$/iu.test(file));
  const indexFile = firstExisting([
    path.join(runDir, "native-screenshot-index.json"),
    path.join(runDir, "native-screenshot-index.json"),
  ]);
  const indexData = indexFile ? readJsonIfExists(indexFile) : null;
  return {
    ax_dumps: axDumps.length,
    text_dumps: textDumps.length,
    screenshots: images.length,
    screenshot_index: indexFile ? relative(artifactDir, indexFile) : null,
    screenshot_index_entries: Array.isArray(indexData) ? indexData.length : isPlainObject(indexData) ? Object.keys(indexData).length : 0,
  };
}

function scanDbSnapshot({ artifactDir, runDir }) {
  const files = listFiles(runDir, (name) => /\.(sqlite3?|db)$/iu.test(name), {
    depth: 2,
    skipDirs: ["AI Novel Studio.app"],
  });
  const snapshots = files.map((file) => {
    const stat = statOrNull(file);
    return {
      path: relative(artifactDir, file),
      size_bytes: stat?.size ?? null,
      sha256: sha256File(file),
    };
  });
  const primary = snapshots.find((item) => /database\//u.test(item.path)) ?? snapshots[0] ?? null;
  return { found: snapshots.length > 0, count: snapshots.length, primary, snapshots };
}

function scanProductionFingerprint({ artifactDir, runDir, detachedMeta, checks, summary, runIdentity }) {
  const sourcesFile = firstExisting([
    path.join(runDir, "production-sources-before.json"),
    path.join(artifactDir, "production-sources-before.json"),
  ]);
  const sourcesData = sourcesFile ? readJsonIfExists(sourcesFile) : null;
  // 两种历史格式：扁平 {path: sha256}，或 {head, file_count, files:{path: sha256}}。
  const sourceMap = isPlainObject(sourcesData?.files)
    ? sourcesData.files
    : isPlainObject(sourcesData) && !("head" in sourcesData)
      ? sourcesData
      : {};
  const sourceEntries = Object.entries(sourceMap).filter(([key, value]) => nonEmptyString(key) && nonEmptyString(value));
  const sourcesHead = stringOrNull(sourcesData?.head);
  const nativeInfoFile = firstExisting([path.join(runDir, "native-info.json"), path.join(artifactDir, "native-info.json")]);
  const nativeInfo = nativeInfoFile ? readJsonIfExists(nativeInfoFile) : null;
  const lifecycleBeforeFile = firstExisting([path.join(runDir, "model-lifecycle-before.json")]);
  const lifecycleAfterFile = firstExisting([path.join(runDir, "model-lifecycle-after.json")]);
  const lifecycleBefore = lifecycleBeforeFile ? readJsonIfExists(lifecycleBeforeFile) : null;
  const lifecycleAfter = lifecycleAfterFile ? readJsonIfExists(lifecycleAfterFile) : null;
  const passedNames = new Set(checks.passed_names ?? []);
  const failedNames = new Set(checks.failed ?? []);
  const productionAttestations = {
    production_sources_unchanged: passedNames.has("production_sources_unchanged")
      ? true
      : failedNames.has("production_sources_unchanged")
        ? false
        : null,
    no_acceptance_hooks_added: passedNames.has("no_acceptance_hooks_added")
      ? true
      : failedNames.has("no_acceptance_hooks_added")
        ? false
        : null,
    native_app_bundle_matches: passedNames.has("native_app_bundle_matches")
      ? true
      : failedNames.has("native_app_bundle_matches")
        ? false
        : null,
  };
  return {
    head: detachedMeta.head ?? sourcesHead ?? null,
    detached_head: detachedMeta.head ?? null,
    production_sources_head: sourcesHead,
    harness_source_hashes: Object.keys(detachedMeta.source_hashes ?? {}).length,
    production_sources_snapshot: sourcesFile
      ? {
          path: relative(artifactDir, sourcesFile),
          declared_file_count: Number.isInteger(sourcesData?.file_count) ? sourcesData.file_count : null,
          source_count: sourceEntries.length,
          fingerprint: crypto
            .createHash("sha256")
            .update(JSON.stringify(sourceEntries.sort(([left], [right]) => left.localeCompare(right))))
            .digest("hex"),
        }
      : null,
    production_sources_unchanged: productionAttestations.production_sources_unchanged,
    attestations: productionAttestations,
    app_bundle: {
      identifier: stringOrNull(nativeInfo?.CFBundleIdentifier),
      version: stringOrNull(nativeInfo?.CFBundleShortVersionString),
      name: stringOrNull(nativeInfo?.CFBundleName),
    },
    model_lifecycle: {
      before_present: Boolean(lifecycleBefore),
      after_present: Boolean(lifecycleAfter),
      loaded_before:
        isPlainObject(lifecycleBefore)
          ? lifecycleBefore.loaded !== undefined
            ? lifecycleBefore.loaded
            : lifecycleBefore.loaded_models ?? lifecycleBefore.models ?? null
          : null,
      unloaded_after:
        isPlainObject(lifecycleAfter)
          ? lifecycleAfter.loaded !== undefined
            ? lifecycleAfter.loaded === null
            : lifecycleAfter.loaded_models !== undefined
              ? Array.isArray(lifecycleAfter.loaded_models) && lifecycleAfter.loaded_models.length === 0
              : null
          : null,
      checked: [...passedNames, ...failedNames].filter((name) => /model_loaded|model_unloaded|lifecycle/iu.test(name)).length,
    },
    summary_scope: stringOrNull(summary.data?.scope),
    run_scope: runIdentity.scope,
  };
}

function pickIdentityValue(source, key) {
  return stringOrNull(source?.[key]);
}

function scanRunIdentity({ summary, checks, artifactDir }) {
  const nativeEvidenceFile = firstExisting([path.join(artifactDir, "native-evidence.json")]);
  // native-evidence.json 与 checks 同目录时可能已被 checks 采集；这里独立读取全量字段。
  const nativeEvidence = nativeEvidenceFile ? readJsonIfExists(nativeEvidenceFile) : null;
  const proofs = [];
  for (const file of listFiles(artifactDir, (name) => /^(native-evidence|real-model-proof)\.json$/u.test(name), { depth: 2 })) {
    const data = readJsonIfExists(file);
    if (!isPlainObject(data)) continue;
    proofs.push({ path: relative(artifactDir, file), data });
  }
  const sources = [{ path: summary.path, data: summary.data }, ...proofs];
  const pick = (key) => {
    const values = sources
      .map((source) => ({ path: source.path, value: pickIdentityValue(source.data, key) }))
      .filter((entry) => entry.value);
    return { values, primary: values[0]?.value ?? null };
  };
  const driver = pick("driver");
  const provider = pick("provider");
  const model = pick("model");
  const surface = pick("surface");
  const scope = pick("scope");
  const conflicts = [];
  for (const [key, picked] of Object.entries({ driver, provider, model, surface })) {
    const distinct = uniqueStrings(picked.values.map((entry) => entry.value));
    if (distinct.length > 1) conflicts.push({ field: key, values: picked.values });
  }
  return {
    driver: driver.primary,
    provider: provider.primary,
    provider_class: classifyProvider(provider.primary),
    model: model.primary,
    surface: surface.primary,
    scope: scope.primary,
    scope_sources: scope.values,
    checks,
    conflicts,
    sources: sources.map((source) => source.path).filter(Boolean),
  };
}

function scanReplayAndRestore({ runDir, artifactDir }) {
  const files = listFiles(runDir, () => true, { depth: 2, skipDirs: ["AI Novel Studio.app", "database", "app-log", "llm-calls"] });
  const restoreRefs = files
    .filter((file) => /restore|resume|scoped/iu.test(path.basename(file)))
    .map((file) => relative(artifactDir, file));
  const waitStatsFile = firstExisting([path.join(runDir, "wait-stats.json")]);
  const waitStats = waitStatsFile ? readJsonIfExists(waitStatsFile) : null;
  const waitLedgerFile = firstExisting([path.join(runDir, "final-wait-ledger.json")]);
  const waitLedger = waitLedgerFile ? readJsonIfExists(waitLedgerFile) : null;
  return {
    restore_refs: restoreRefs.slice(0, 40),
    wait_stats: isPlainObject(waitStats) || isPlainObject(waitLedger) ? { ...(waitStats ?? {}), ...(waitLedger ?? {}) } : null,
  };
}

// ---------- 统一 manifest ----------

export function scanNativeArtifactDir(artifactDir, options = {}) {
  if (!nonEmptyString(artifactDir)) {
    throw new NativeRunManifestError("scanNativeArtifactDir 需要 artifactDir", "usage");
  }
  const resolved = resolveLayout(artifactDir);
  if (!fs.existsSync(resolved.artifactDir)) {
    throw new NativeRunManifestError(`artifact 目录不存在：${artifactDir}`, "artifact_dir_missing");
  }
  const termination = scanTermination(resolved);
  const detachedMeta = scanDetachedMeta(resolved);
  const summary = scanSummary(resolved);
  const finalFailure = scanFinalFailure(resolved);
  const checks = scanChecks({ ...resolved, summary });
  const runIdentity = scanRunIdentity({ ...resolved, summary, checks });
  const nativeTransport = scanNativeTransport(resolved);
  const ax = scanAxAndScreens(resolved);
  const db = scanDbSnapshot(resolved);
  const productionFingerprint = scanProductionFingerprint({
    ...resolved,
    detachedMeta,
    checks,
    summary,
    runIdentity,
  });
  const replayRestore = scanReplayAndRestore(resolved);
  const scopeText = summary.data?.scope ?? runIdentity.scope ?? null;
  const limitations = Array.isArray(summary.data?.limitations) ? summary.data.limitations : [];
  const scopeClass = classifyScope(scopeText, limitations, summary);
  const manifest = {
    schema_version: NATIVE_RUN_SCHEMA_VERSION,
    artifact_dir: resolved.artifactDir,
    layout: resolved.layout,
    scanned_at: new Date().toISOString(),
    run: {
      found: summary.found || finalFailure.final.found || finalFailure.failure.found,
      summary_path: summary.path,
      summary_variants: summary.variants,
      slice_id: stringOrNull(summary.data?.slice_id),
      surface: runIdentity.surface ?? stringOrNull(summary.data?.surface),
      driver: runIdentity.driver,
      driver_is_native: runIdentity.driver ? NATIVE_DRIVERS.includes(runIdentity.driver) : null,
      provider: runIdentity.provider,
      provider_class: runIdentity.provider_class,
      model: runIdentity.model,
      scope: scopeText,
      trials: Array.isArray(summary.data?.trials) ? summary.data.trials : [],
      verified_at: timestampOrNull(summary.data?.verified_at),
      ready_at: timestampOrNull(summary.data?.ready_at),
      run_ref: stringOrNull(summary.data?.run_ref),
      real_model_calls: Number.isInteger(summary.data?.real_model_calls) ? summary.data.real_model_calls : null,
      llm_calls: Number.isInteger(summary.data?.llm_calls) ? summary.data.llm_calls : null,
      identity_sources: runIdentity.sources,
      identity_conflicts: runIdentity.conflicts,
      detached_head: detachedMeta.head,
      started_at: detachedMeta.started_at,
    },
    final: finalFailure.final,
    failure: finalFailure.failure,
    scoped: {
      scope_class: scopeClass,
      scope_text: scopeText,
      limitations,
      scoped_checks: (checks.failed ?? []).filter((name) => /scoped|restore|resume/iu.test(name)),
      scoped_refs: replayRestore.restore_refs,
      full_matrix_established: false, // 由 evaluateNativeRun 依 scope_class 重算。
    },
    checks,
    termination,
    native_transport: nativeTransport,
    ax,
    db_snapshot: db,
    production_fingerprint: productionFingerprint,
    run_evidence: {
      wait_stats: replayRestore.wait_stats,
      app_log_files: listFiles(resolved.runDir, (name, full) => name.endsWith(".jsonl") && /app-log/u.test(full)).length,
      llm_call_files: listFiles(resolved.runDir, (name, full) => name.endsWith(".jsonl") && /llm-calls/u.test(full)).length,
      backup_files: listFiles(resolved.runDir, (name) => /\.(bak|orig|bak2)$/iu.test(name)).length,
    },
  };
  const verdict = evaluateNativeRun(manifest);
  return { ...manifest, ...verdict };
}

function classifyScope(scopeText, limitations, summary) {
  const text = [scopeText, ...limitations].filter(nonEmptyString).join(" ");
  if (!text) return "unknown";
  if (/scoped|局部|不重跑|不宣称|subset|partial/iu.test(text)) return "scoped";
  if (/full|完整|canonical/iu.test(text)) return "full";
  // summary 有 trials 且 checks 齐全但没有 scope 文本：仍按 unknown（不外推全矩阵）。
  return summary.found ? "unknown" : "unknown";
}

/**
 * 对已扫描/构造的 manifest 判定运行状态。纯函数，供测试与消费者直接使用。
 *
 * 优先级：fail > evidence_missing > pass。final+failure 并存时 failure 胜出。
 */
export function evaluateNativeRun(manifest) {
  if (!isPlainObject(manifest)) {
    return { status: "evidence_missing", reason_codes: ["invalid_manifest"], pass_scope: null, full_matrix_established: false };
  }
  const reasonCodes = [];
  const failures = [];
  const term = manifest.termination ?? {};
  const failure = manifest.failure ?? {};
  const final = manifest.final ?? {};
  const checks = manifest.checks ?? {};
  const summaryChecks = checks.summary ?? {};

  if (term.found) {
    const signal = (term.signal ?? "").toUpperCase();
    const cleanExit = term.exit_code === 0 && (signal === "EXIT" || signal === "");
    if (!cleanExit) {
      failures.push("termination_not_clean");
      reasonCodes.push("termination_not_clean");
    }
  }
  if (failure.found) {
    failures.push("failure_present");
    reasonCodes.push("failure_present");
    if (failure.reason) reasonCodes.push(`failure_reason:${failure.reason}`);
    if (final.found) reasonCodes.push("final_failure_coexist");
  }
  if (summaryChecks.all_checks_passed === false) {
    failures.push("checks_failed");
    reasonCodes.push("checks_failed");
  }
  for (const name of checks.failed ?? []) {
    failures.push(`native_check_failed:${name}`);
    reasonCodes.push(`native_check_failed:${name}`);
  }
  if ((checks.failed ?? []).length > 0) {
    failures.push("checks_failed");
    reasonCodes.push("checks_failed");
  }
  const conflicts = manifest.run?.identity_conflicts ?? [];
  if (conflicts.length > 0) {
    failures.push("identity_conflict");
    for (const conflict of conflicts) reasonCodes.push(`identity_conflict:${conflict.field}`);
  }

  const missing = [];
  if (!manifest.run?.found) missing.push("run_evidence_missing");
  if (!summaryChecks.all_checks_passed && summaryChecks.all_checks_passed !== false) missing.push("checks_missing");
  if (!final.found && !failure.found) missing.push("final_missing");
  if (!manifest.run?.slice_id && !manifest.run?.driver && !manifest.run?.provider) missing.push("run_identity_missing");

  const scopeClass = manifest.scoped?.scope_class ?? "unknown";
  const fullMatrixEstablished = scopeClass === "full" && failures.length === 0 && missing.length === 0;
  let passScope = null;
  if (failures.length === 0 && missing.length === 0) {
    passScope = scopeClass === "full" ? "full_scope" : scopeClass === "scoped" ? "scoped_scope_only" : "unknown_scope";
  }
  if (failures.length > 0) {
    return {
      status: "fail",
      reason_codes: uniqueStrings(reasonCodes),
      failure_reasons: uniqueStrings(failures),
      pass_scope: null,
      full_matrix_established: false,
    };
  }
  if (missing.length > 0) {
    return {
      status: "evidence_missing",
      reason_codes: uniqueStrings([...reasonCodes, ...missing]),
      failure_reasons: [],
      pass_scope: null,
      full_matrix_established: false,
    };
  }
  return {
    status: "pass",
    reason_codes: uniqueStrings(reasonCodes),
    failure_reasons: [],
    pass_scope: passScope,
    full_matrix_established: fullMatrixEstablished,
  };
}

export function validateNativeRunManifest(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) return ["native run manifest 必须是 JSON object"];
  if (manifest.schema_version !== NATIVE_RUN_SCHEMA_VERSION) {
    errors.push(`schema_version 必须为 ${NATIVE_RUN_SCHEMA_VERSION}`);
  }
  if (!nonEmptyString(manifest.artifact_dir)) errors.push("artifact_dir 必须是非空字符串");
  if (!NATIVE_RUN_STATUSES.includes(manifest.status)) {
    errors.push(`status 必须属于 ${NATIVE_RUN_STATUSES.join(" | ")}`);
  }
  for (const key of ["run", "final", "failure", "scoped", "checks", "termination", "native_transport", "ax", "db_snapshot", "production_fingerprint"]) {
    if (!isPlainObject(manifest[key])) errors.push(`${key} 必须是 object`);
  }
  if (isPlainObject(manifest.scoped) && !SCOPE_CLASSES.includes(manifest.scoped.scope_class)) {
    errors.push(`scoped.scope_class 必须属于 ${SCOPE_CLASSES.join(" | ")}`);
  }
  if (typeof manifest.full_matrix_established !== "boolean") {
    errors.push("full_matrix_established 必须是 boolean");
  }
  // 硬规则自检：fail/evidence_missing 不得带 pass_scope；pass 必须有 pass_scope。
  if (manifest.status === "pass" && !nonEmptyString(manifest.pass_scope)) {
    errors.push("status=pass 必须给出 pass_scope（scoped 结果不得外推全矩阵）");
  }
  if (manifest.status !== "pass" && nonEmptyString(manifest.pass_scope)) {
    errors.push(`status=${manifest.status} 不得声明 pass_scope`);
  }
  if (isPlainObject(manifest.failure) && manifest.failure.found && manifest.status === "pass") {
    errors.push("failure 存在的 run 不得判 pass（final/failure 并存时不得只看 final）");
  }
  if (isPlainObject(manifest.termination) && manifest.termination.found) {
    const signal = (manifest.termination.signal ?? "").toUpperCase();
    const clean = manifest.termination.exit_code === 0 && (signal === "EXIT" || signal === "");
    if (!clean && manifest.status === "pass") {
      errors.push("termination 非 0/非 EXIT 的 run 不得判 pass");
    }
  }
  return errors;
}

export function writeNativeRunManifest(manifest, options = {}) {
  const errors = validateNativeRunManifest(manifest);
  if (errors.length > 0) {
    throw new NativeRunManifestError(
      `拒绝写入无效 native run manifest：${errors.join("; ")}`,
      "invalid_native_run",
      errors,
    );
  }
  const target =
    options.out ?? path.join(manifest.artifact_dir, NATIVE_RUN_MANIFEST_FILE);
  if (fs.existsSync(target) && options.overwrite !== true) {
    throw new NativeRunManifestError(`拒绝覆盖已有 native run manifest：${target}`, "manifest_exists");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, path: target };
}
