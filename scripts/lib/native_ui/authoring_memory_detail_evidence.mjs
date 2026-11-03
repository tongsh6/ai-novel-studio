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
import {
  assertCommonEvidence,
  assertProviderAndWire,
  read,
  withDb,
  writeNativeFrames,
} from "./scenario_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import { checkAuthorVisibleTexts } from "./author_visible_check.mjs";

export const MEMORY_DETAIL_SCHEMA = "b71-memory-detail-checks/v1";
export const MEMORY_DETAIL_CHECKPOINTS = Object.freeze(["start", "memory-list", "memory-detail", "final"]);
export const MEMORY_DETAIL_STATUS_CODES = Object.freeze([
  "DRAFT",
  "CONFIRMED",
  "STABILIZED",
  "CONFLICTED",
  "SUPERSEDED",
  "DEPRECATED",
  "ARCHIVED",
]);
export const MEMORY_DETAIL_TYPE_CODES = Object.freeze([
  "WORK_DIRECTION",
  "WORLD_RULE",
  "CHARACTER_PROFILE",
  "CURRENT_STATE",
  "RELATIONSHIP",
  "PLOT_FACT",
  "FORESHADOWING",
  "STYLE_RULE",
  "CONSTRAINT",
  "AUTHOR_PREFERENCE",
  "IDEA",
  "DRAFT_CONTEXT",
]);
export const MEMORY_DETAIL_SCOPE_CODES = Object.freeze(["GLOBAL", "WORK", "VOLUME", "ARC", "CHAPTER", "SESSION"]);
export const MEMORY_DETAIL_SOURCE_CODES = Object.freeze([
  "AUTHOR_CONFIRMED",
  "AUTHOR_CREATED",
  "AI_EXTRACTED",
  "CHAPTER_EXTRACTED",
  "WORK_SETTING_IMPORTED",
  "SESSION_CONTEXT",
]);
export const MEMORY_DETAIL_INTERNAL_REF_PREFIXES = Object.freeze([
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
export const MEMORY_DETAIL_DUPLICATE_PREFIX = "candidate_set:candidate_set:";

const list = (value) => (Array.isArray(value) ? value : []);

function readCaptureText(dir, name) {
  const ax = path.join(dir, `${name}.ax.txt`);
  const text = path.join(dir, `${name}.text.txt`);
  return [fs.existsSync(ax) ? fs.readFileSync(ax, "utf8") : "", fs.existsSync(text) ? fs.readFileSync(text, "utf8") : ""].join("\n");
}

// ── 全类别 AX 扫描（除 scan 外，还收集 memory 页面文本供判据）──────────────────
export function scanMemoryDetailTexts(dir) {
  const hits = [];
  const files = [];
  if (!fs.existsSync(dir)) return { ok: false, hits: [], files, memory_text: "" };
  const memoryTexts = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.(ax|text)\.txt$/u.test(name)) continue;
    const file = path.join(dir, name);
    const raw = fs.readFileSync(file, "utf8");
    const axText = name.endsWith(".ax.txt") ? raw : "";
    const visibleText = name.endsWith(".text.txt") ? raw : "";
    files.push(name);
    if (name.startsWith("memory-list.") || name.startsWith("memory-detail.")) memoryTexts.push(raw);
    const scan = checkAuthorVisibleTexts({ axText, visibleText });
    for (const hit of list(scan.hits)) {
      hits.push({
        file: name,
        token: hit.token,
        kind: hit.kind,
        source: hit.source ?? null,
        context: String(hit.text ?? "").slice(0, 240),
      });
    }
  }
  return { ok: hits.length === 0, hits, files, memory_text: memoryTexts.join("\n") };
}

function findCodes(text, codes) {
  return codes.filter((code) => new RegExp(`(^|[^A-Za-z0-9_])${code}([^A-Za-z0-9_]|$)`, "u").test(text));
}

function findRefPrefixes(text, prefixes) {
  return prefixes.filter((prefix) => text.includes(prefix));
}

export function evaluateMemoryDetail({
  config,
  scan,
  driverLog = null,
  cleanup = null,
  termination = null,
  runtime = null,
}) {
  const text = scan.memory_text ?? "";
  const coveredText = [text, readCaptureTextSafe(driverLog, config)].join("\n");

  // D1：全类别作者可见扫描零命中（含 internal_terms_zh）。
  const d1 = {
    ok: scan.ok,
    reason: scan.ok ? null : "author_visible_internal_token_leak",
    detail: { scanned_files: scan.files, hits: scan.hits.slice(0, 20) },
  };

  // D2：状态展示 displayName 中文（已确认/草稿/…），且无内部状态枚举 code。
  const statusCodes = findCodes(coveredText, MEMORY_DETAIL_STATUS_CODES);
  const statusWords = ["已确认", "草稿", "已稳定", "有冲突", "已被新版替代", "已弃用", "已归档"].filter((word) =>
    coveredText.includes(word),
  );
  const d2 = {
    ok: statusWords.length > 0 && statusCodes.length === 0,
    reason: statusWords.length === 0 ? "memory_status_display_missing" : statusCodes.length > 0 ? "memory_status_code_leaked" : null,
    detail: { display_words: statusWords, code_leaks: statusCodes },
  };

  // D3：类型/范围/来源类型展示中文，且无内部枚举 code。
  const typeCodes = findCodes(coveredText, MEMORY_DETAIL_TYPE_CODES);
  const scopeCodes = findCodes(coveredText, MEMORY_DETAIL_SCOPE_CODES);
  const sourceCodes = findCodes(coveredText, MEMORY_DETAIL_SOURCE_CODES);
  const typeWords = ["世界观规则", "伏笔", "创作方向", "人物设定", "当前状态", "人物关系", "剧情事实", "作者偏好", "灵感", "创作约束", "写作风格", "草稿上下文"].filter((word) => coveredText.includes(word));
  const scopeWords = ["整部作品", "全局", "当前卷", "故事线", "当前章", "当前会话"].filter((word) => coveredText.includes(word));
  const sourceWords = ["作者确认", "作者创建", "AI 提取", "章节提取", "作品设定导入", "会话上下文"].filter((word) => coveredText.includes(word));
  const d3 = {
    ok:
      typeWords.length > 0 &&
      scopeWords.length > 0 &&
      sourceWords.length > 0 &&
      typeCodes.length === 0 &&
      scopeCodes.length === 0 &&
      sourceCodes.length === 0,
    reason: null,
    detail: {
      type_words: typeWords,
      scope_words: scopeWords,
      source_words: sourceWords,
      type_code_leaks: typeCodes,
      scope_code_leaks: scopeCodes,
      source_code_leaks: sourceCodes,
    },
  };
  if (!d3.ok) d3.reason = "memory_dimension_display_missing_or_code_leaked";

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
  const d5 = {
    ok: localTime && !isoTime,
    reason: !localTime ? "local_time_missing" : isoTime ? "iso_time_leaked" : null,
    detail: { local_time_found: localTime, iso_found: isoTime },
  };

  // D6：candidate_set:candidate_set: 重复前缀不出现。
  const duplicatePrefix = coveredText.includes(MEMORY_DETAIL_DUPLICATE_PREFIX);
  const d6 = {
    ok: !duplicatePrefix,
    reason: duplicatePrefix ? "duplicate_ref_prefix" : null,
    detail: { duplicate_prefix: MEMORY_DETAIL_DUPLICATE_PREFIX },
  };

  // D7：导航成功（记忆管理页 + 记忆详情抽屉真实可见）。
  const listVisible = text.includes("记忆管理");
  const detailVisible = text.includes("记忆详情");
  const d7 = {
    ok: listVisible && detailVisible,
    reason: !listVisible ? "memory_list_not_visible" : !detailVisible ? "memory_detail_not_visible" : null,
    detail: { memory_list_visible: listVisible, memory_detail_visible: detailVisible },
  };

  // D8：清理（app 关闭、端口停止、llm-calls 停止）。
  const remaining = list(cleanup?.remaining);
  const terminationLlm = Number(termination?.llm_calls);
  const llmStopped = Boolean(runtime) && Number.isFinite(terminationLlm) && Number(runtime.llm_calls) === terminationLlm;
  const d8 = {
    ok:
      remaining.length === 0 &&
      Boolean(runtime) &&
      runtime.app_processes === 0 &&
      runtime.ports.backend_4657 === false &&
      runtime.ports.transport_4661 === false &&
      llmStopped,
    reason: null,
    detail: { remaining: remaining.length, runtime, llm_calls_stopped: llmStopped },
  };
  if (!d8.ok) d8.reason = "cleanup_unverified_or_runtime_not_stopped";

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

function readCaptureTextSafe(_driverLog, _config) {
  return "";
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
  const evidence = assertProviderAndWire(dir, {
    minUserMessages: 0,
    minTurnResults: 0,
    minProviderStarts: 0,
    expectProviders: [],
  });
  const scan = scanMemoryDetailTexts(dir);
  const driverLog = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  const cleanup = readJsonIfExists(path.join(dir, "native-app-cleanup.json"));
  const runtime = runtimeAfterBatch(dir);
  const result = evaluateMemoryDetail({
    config,
    scan,
    driverLog,
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
