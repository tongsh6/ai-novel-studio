// B71 记忆详情/列表 P0 泄漏回归（journey=memory-detail）：真实 Tauri 页面打开
// 「记忆管理」→ 选中一条记忆 → 打开「记忆详情」抽屉，采集 AX/文本截图。
//
// 断言：
// - 全类别作者可见扫描（author_visible_check 全类别，含 internal_terms_zh）hits=[];
// - 状态/类型/范围/来源类型显示中文 displayName（无内部枚举 code）；
// - tags 不出现 candidate:/candidate_set:/decision: 等内部 ref，且无 candidate_set:candidate_set: 重复前缀；
// - 时间显示 YYYY-MM-DD HH:mm（非 ISO）；
// - 导航成功（记忆管理页 + 记忆详情抽屉真实可见）；
// - 清理（app 关闭、端口停止、llm-calls 停止）。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertCommonEvidence, writeNativeFrames } from "./scenario_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import { checkAuthorVisibleTexts } from "./author_visible_check.mjs";

const MEMORY_DETAIL_SCHEMA = "b71-memory-detail-checks/v1";

// 四类记忆维度直接消费既有作者可见展示名 SSOT（其 domains 由 codegen 校验）。
const DISPLAY_NAMES_SSOT = JSON.parse(
  fs.readFileSync(
    new URL("../../../docs/design/schemas/author_visible/display_names.json", import.meta.url),
    "utf8",
  ),
);
const MEMORY_DETAIL_DISPLAY_NAMES = Object.freeze({
  status: DISPLAY_NAMES_SSOT.domains.memory_status,
  type: DISPLAY_NAMES_SSOT.domains.memory_type,
  scope: DISPLAY_NAMES_SSOT.domains.memory_scope,
  source: DISPLAY_NAMES_SSOT.domains.memory_source_type,
});
const MEMORY_DETAIL_STATUS_CODES = Object.freeze(Object.keys(MEMORY_DETAIL_DISPLAY_NAMES.status));
const MEMORY_DETAIL_TYPE_CODES = Object.freeze(Object.keys(MEMORY_DETAIL_DISPLAY_NAMES.type));
const MEMORY_DETAIL_SCOPE_CODES = Object.freeze(Object.keys(MEMORY_DETAIL_DISPLAY_NAMES.scope));
const MEMORY_DETAIL_SOURCE_CODES = Object.freeze(Object.keys(MEMORY_DETAIL_DISPLAY_NAMES.source));
const MEMORY_DETAIL_STATUS_WORDS = Object.freeze(Object.values(MEMORY_DETAIL_DISPLAY_NAMES.status));
const MEMORY_DETAIL_TYPE_WORDS = Object.freeze(Object.values(MEMORY_DETAIL_DISPLAY_NAMES.type));
const MEMORY_DETAIL_SCOPE_WORDS = Object.freeze(Object.values(MEMORY_DETAIL_DISPLAY_NAMES.scope));
const MEMORY_DETAIL_SOURCE_WORDS = Object.freeze(Object.values(MEMORY_DETAIL_DISPLAY_NAMES.source));

const MEMORY_DETAIL_INTERNAL_REF_PREFIXES = Object.freeze([
  "candidate:",
  "candidate_set:",
  "decision:",
  "pcall:",
  "prun:",
  "trace:",
  "artifact:",
  "behavior:",
  "frame:",
  "plan:",
]);
const MEMORY_DETAIL_DUPLICATE_PREFIX = "candidate_set:candidate_set:";

const list = (value) => (Array.isArray(value) ? value : []);

const ASCII_IDENTIFIER = /[A-Za-z0-9_]+/gu;

function tokenizeAsciiIdentifiers(text) {
  return new Set(text.match(ASCII_IDENTIFIER) ?? []);
}

function findCodes(tokens, codes) {
  return codes.filter((code) => tokens.has(code));
}

function findDisplayWords(text, words) {
  return words.filter((word) => text.includes(word));
}

function scanFileHits(name, raw) {
  const axText = name.endsWith(".ax.txt") ? raw : "";
  const visibleText = name.endsWith(".text.txt") ? raw : "";
  return checkAuthorVisibleTexts({ axText, visibleText }).hits.map((hit) => ({
    file: name,
    token: hit.token,
    kind: hit.kind,
    source: hit.source,
    context: hit.text.slice(0, 240),
  }));
}

// ── 全类别 AX 扫描（除 scan 外，还收集 memory 页面文本供判据）──────────────────
export function scanMemoryDetailTexts(dir) {
  const hits = [];
  const files = [];
  if (!fs.existsSync(dir)) return { ok: false, hits: [], files, memory_text: "" };
  const memoryTexts = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.(ax|text)\.txt$/u.test(name)) continue;
    const raw = fs.readFileSync(path.join(dir, name), "utf8");
    files.push(name);
    if (name.startsWith("memory-list.") || name.startsWith("memory-detail.")) memoryTexts.push(raw);
    hits.push(...scanFileHits(name, raw));
  }
  return { ok: hits.length === 0, hits, files, memory_text: memoryTexts.join("\n") };
}

function findRefPrefixes(text, prefixes) {
  return prefixes.filter((prefix) => text.includes(prefix));
}

function memoryStatusCheck(statusCodes, statusWords) {
  const ok = statusWords.length > 0 && statusCodes.length === 0;
  return {
    ok,
    reason: statusWords.length === 0 ? "memory_status_display_missing" : statusCodes.length > 0 ? "memory_status_code_leaked" : null,
    detail: { display_words: statusWords, code_leaks: statusCodes },
  };
}

function memoryDimensionsCheck({ typeCodes, scopeCodes, sourceCodes, typeWords, scopeWords, sourceWords }) {
  const displaysPresent = [typeWords, scopeWords, sourceWords].every((words) => words.length > 0);
  const codesAbsent = [typeCodes, scopeCodes, sourceCodes].every((codes) => codes.length === 0);
  const ok = displaysPresent && codesAbsent;
  return {
    ok,
    reason: ok ? null : "memory_dimension_display_missing_or_code_leaked",
    detail: {
      type_words: typeWords,
      scope_words: scopeWords,
      source_words: sourceWords,
      type_code_leaks: typeCodes,
      scope_code_leaks: scopeCodes,
      source_code_leaks: sourceCodes,
    },
  };
}

function localTimeCheck(localTime, isoTime) {
  return {
    ok: localTime && !isoTime,
    reason: !localTime ? "local_time_missing" : isoTime ? "iso_time_leaked" : null,
    detail: { local_time_found: localTime, iso_found: isoTime },
  };
}

function navigationCheck(listVisible, detailVisible) {
  return {
    ok: listVisible && detailVisible,
    reason: !listVisible ? "memory_list_not_visible" : !detailVisible ? "memory_detail_not_visible" : null,
    detail: { memory_list_visible: listVisible, memory_detail_visible: detailVisible },
  };
}

function runtimeStopped(runtime, terminationLlm) {
  if (!runtime) return false;
  return (
    runtime.app_processes === 0 &&
    runtime.ports.backend_4657 === false &&
    runtime.ports.transport_4661 === false &&
    Number.isFinite(terminationLlm) &&
    Number(runtime.llm_calls) === terminationLlm
  );
}

function cleanupCheck(cleanup, termination, runtime) {
  const remaining = list(cleanup?.remaining);
  const terminationLlm = Number(termination?.llm_calls);
  const llmStopped = Boolean(runtime) && Number(runtime.llm_calls) === terminationLlm;
  const ok = remaining.length === 0 && runtimeStopped(runtime, terminationLlm);
  return {
    ok,
    reason: ok ? null : "cleanup_unverified_or_runtime_not_stopped",
    detail: { remaining: remaining.length, runtime, llm_calls_stopped: llmStopped },
  };
}

export function evaluateMemoryDetail({ scan, cleanup = null, termination = null, runtime = null }) {
  const coveredText = scan.memory_text ?? "";
  const tokens = tokenizeAsciiIdentifiers(coveredText);

  // D1：全类别作者可见扫描零命中（含 internal_terms_zh）。
  const d1 = {
    ok: scan.ok,
    reason: scan.ok ? null : "author_visible_internal_token_leak",
    detail: { scanned_files: scan.files, hits: scan.hits.slice(0, 20) },
  };

  // D2：状态展示 displayName 中文（已确认/草稿/…），且无内部状态枚举 code。
  const d2 = memoryStatusCheck(
    findCodes(tokens, MEMORY_DETAIL_STATUS_CODES),
    findDisplayWords(coveredText, MEMORY_DETAIL_STATUS_WORDS),
  );

  // D3：类型/范围/来源类型展示中文，且无内部枚举 code。
  const d3 = memoryDimensionsCheck({
    typeCodes: findCodes(tokens, MEMORY_DETAIL_TYPE_CODES),
    scopeCodes: findCodes(tokens, MEMORY_DETAIL_SCOPE_CODES),
    sourceCodes: findCodes(tokens, MEMORY_DETAIL_SOURCE_CODES),
    typeWords: findDisplayWords(coveredText, MEMORY_DETAIL_TYPE_WORDS),
    scopeWords: findDisplayWords(coveredText, MEMORY_DETAIL_SCOPE_WORDS),
    sourceWords: findDisplayWords(coveredText, MEMORY_DETAIL_SOURCE_WORDS),
  });

  // D4：tags 不出现内部 ref 前缀（candidate:/candidate_set:/decision: 等）。
  const refPrefixes = findRefPrefixes(coveredText, MEMORY_DETAIL_INTERNAL_REF_PREFIXES);
  const d4 = {
    ok: refPrefixes.length === 0,
    reason: refPrefixes.length === 0 ? null : "internal_ref_tag_leaked",
    detail: { leaked_prefixes: refPrefixes },
  };

  // D5：时间显示 YYYY-MM-DD HH:mm（非 ISO）。
  const localTime = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u.test(coveredText);
  const isoTime = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(coveredText);
  const d5 = localTimeCheck(localTime, isoTime);

  // D6：candidate_set:candidate_set: 重复前缀不出现。
  const duplicatePrefix = coveredText.includes(MEMORY_DETAIL_DUPLICATE_PREFIX);
  const d6 = {
    ok: !duplicatePrefix,
    reason: duplicatePrefix ? "duplicate_ref_prefix" : null,
    detail: { duplicate_prefix: MEMORY_DETAIL_DUPLICATE_PREFIX },
  };

  // D7：导航成功（记忆管理页 + 记忆详情抽屉真实可见）。
  const listVisible = coveredText.includes("记忆管理");
  const detailVisible = coveredText.includes("记忆详情");
  const d7 = navigationCheck(listVisible, detailVisible);

  // D8：清理（app 关闭、端口停止、llm-calls 停止）。
  const d8 = cleanupCheck(cleanup, termination, runtime);

  const checks = {
    D1_author_visible_no_internal_tokens: d1,
    D2_memory_status_display: d2,
    D3_memory_dimensions_display: d3,
    D4_tags_no_internal_ref: d4,
    D5_local_time_format: d5,
    D6_no_duplicate_ref_prefix: d6,
    D7_navigation_visible: d7,
    D8_cleanup: d8,
  };
  const required = Object.entries(checks).filter(([, value]) => value.ok !== null).map(([key]) => key);
  const failed = Object.entries(checks).filter(([, value]) => value.ok === false).map(([key]) => key);
  return {
    schema: MEMORY_DETAIL_SCHEMA,
    case: "memory-detail-p0-leak",
    checks,
    required,
    failed,
    measured: {
      scanned_files: scan.files.length,
      scan_hits: scan.hits.length,
      memory_list_visible: listVisible,
      memory_detail_visible: detailVisible,
      local_time_found: localTime,
      iso_found: isoTime,
      ref_prefix_leaks: refPrefixes,
      duplicate_prefix: duplicatePrefix,
    },
    not_signed: ["memory_write_flow_not_covered", "G1_G6_full_signed=false", "I10_literary_quality_not_signed"],
  };
}

export function runtimeAfterBatch(dir) {
  let appPath = null;
  try {
    appPath = JSON.parse(fs.readFileSync(path.join(dir, "native-driver-ready.json"), "utf8"))?.app_path ?? null;
  } catch {
    appPath = null;
  }
  const countApp = () => {
    const fallback = "AI Novel Studio.app/Contents/MacOS/app";
    const target = typeof appPath === "string" && appPath !== "" ? appPath : fallback;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    try {
      return execFileSync("pgrep", ["-f", escaped], { encoding: "utf8" }).split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };
  const port = (value) => {
    try {
      return execFileSync("lsof", ["-nP", `-iTCP:${value}`, "-sTCP:LISTEN"], { encoding: "utf8" })
        .split("\n").filter((line) => line.includes("LISTEN")).length > 0;
    } catch {
      return false;
    }
  };
  const countLlm = () => {
    const logDir = path.join(dir, "llm-calls");
    if (!fs.existsSync(logDir)) return 0;
    return fs.readdirSync(logDir)
      .filter((file) => file.endsWith(".jsonl"))
      .reduce((total, file) => total + fs.readFileSync(path.join(logDir, file), "utf8").split("\n").filter((line) => line.includes("{")).length, 0);
  };
  return {
    app_processes: countApp(),
    ports: { backend_4657: port(4657), transport_4661: port(4661) },
    llm_calls: countLlm(),
  };
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

export function verifyMemoryDetailBatch(dir) {
  const config = readConfig(dir);
  assert.equal(config.journey, "memory-detail", "memory-detail verifier 只接受 journey=memory-detail");
  assert.equal(config.provider, "slice_verify", "memory-detail verifier 只接受确定性 slice_verify");
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: 2,
    minimumWaits: 3,
    requiredKinds: ["maintenance"],
  });
  // memory-detail 是纯 UI 导航回归（无 LLM/provider 交互），不做 provider/wire 断言；
  // 清理判据 D8 已覆盖运行态与 llm-calls 停止。
  const scan = scanMemoryDetailTexts(dir);
  const driverLog = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  const cleanup = readJsonIfExists(path.join(dir, "native-app-cleanup.json"));
  const runtime = runtimeAfterBatch(dir);
  const result = evaluateMemoryDetail({
    scan,
    cleanup,
    termination: driverLog?.termination ?? null,
    runtime,
  });
  writeNativeFrames(dir);
  const summary = {
    schema: "b71-memory-detail-summary/v1",
    slice_id: config.slice_id,
    provider: config.provider,
    journey: "memory-detail",
    verified_at: new Date().toISOString(),
    checks: Object.fromEntries(Object.entries(result.checks).map(([key, value]) => [key, value.ok])),
    checks_detail: result.checks,
    required: result.required,
    failed: result.failed,
    measured: result.measured,
    not_signed: result.not_signed,
    wait_ledger: common.ledger,
    screenshots: common.ui.screenshots,
    navigation: driverLog?.navigation ?? null,
    memory_rows: driverLog?.memory_rows ?? null,
    verdict: {
      mechanism: result.failed.length === 0 ? "pass" : "fail",
      p0_leak_fixed: result.checks.D1_author_visible_no_internal_tokens.ok === true,
      full_g1_g6_signed: false,
      i10_signed: false,
    },
  };
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  assert.equal(result.failed.length, 0, `B71 memory-detail 判据失败: ${result.failed.join(", ")}`);
  console.log(
    `B71 memory-detail 判据通过: scan_hits=${result.measured.scan_hits} list=${result.measured.memory_list_visible} detail=${result.measured.memory_detail_visible}`,
  );
  return { result, summary };
}
