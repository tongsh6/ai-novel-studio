#!/usr/bin/env node
/**
 * 模块规模治理门禁（docs/coding-standards/03-module-boundaries.md §3.2）。
 *
 * 设计原则：
 * - 不写死「多少行算大」的美学红线。行数只是代理指标，本质判据是职责/变更理由（review 定性）。
 * - 机器只做两件事：
 *   R1 软 ratchet：已登记文件允许「正常功能增量」（净增 ≤ max(30, 5% 上限)）；超过才 fail，
 *      要求真正拆分或登记理由。**禁止为过门禁机械压缩行数**（删注释/空行、压行、堆表达式）——
 *      行数只是观察信号，不是开发约束；为凑数字损害可读性属于反模式。
 *   R2 新债登记：出现超过关注门槛、但未登记也未豁免的文件 → fail（要求拆分，或登记豁免并写理由）。
 * - `outlier_floor` 是「进入观察名单」的关注门槛，**不是行数红线**：它只决定「何时需要登记」，
 *   不决定「多大算不合格」。门禁的 fail 条件只有 ratchet 与未登记，没有「超过 K 行即 fail」。
 * - P90 只用于报告里的相对规模参考，不参与门控判定。
 * - 显式豁免（exemptions）：本质聚合型文件（如 UI 文案 SSOT、schema 契约样本），
 *   规范要求集中，拆散反而是反模式；豁免仍要登记理由与复核日期。
 *
 * 用法：
 *   node scripts/check_module_size.mjs --check                 # 门禁（CI / ai_static_scan）
 *   node scripts/check_module_size.mjs --report                # 离群报告（拆分排期用，不退出非零）
 *   node scripts/check_module_size.mjs --write-baseline        # 首次生成 baseline
 *   node scripts/check_module_size.mjs --write-baseline --register-new   # 登记新的观察文件
 *
 * baseline：quality/module-size-baseline.json
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(rootDir, "quality", "module-size-baseline.json");
const BASELINE_SCHEMA = "module-size-baseline/v1";

/** 默认策略：空 baseline 首次生成时写入，之后以 baseline 内 policy 为准。 */
export const DEFAULT_POLICY = {
  prod: { outlier_floor: 500 },
  test: { outlier_floor: 800 },
};

/**
 * 软 ratchet 的允许增量：净增 ≤ max(allowed_delta_abs, ceil(max_lines × allowed_delta_ratio))
 * 视为正常功能增量（不要求等量对冲）；超过才要求拆分。
 * 目的：避免「为过行数门禁而删注释/压缩可读性」的机械行为。
 */
export const DEFAULT_DELTA_POLICY = Object.freeze({
  allowed_delta_abs: 30,
  allowed_delta_ratio: 0.05,
});

export function allowedDeltaFor(record, policy = {}) {
  const abs = Number.isFinite(policy?.allowed_delta_abs)
    ? policy.allowed_delta_abs
    : DEFAULT_DELTA_POLICY.allowed_delta_abs;
  const ratio = Number.isFinite(policy?.allowed_delta_ratio)
    ? policy.allowed_delta_ratio
    : DEFAULT_DELTA_POLICY.allowed_delta_ratio;
  const maxLines = Number.isFinite(record?.max_lines) ? record.max_lines : 0;
  return Math.max(abs, Math.ceil(maxLines * ratio));
}

// ── 纯函数区（供 node --test 直接测试）────────────────────────────────────────

/** nearest-rank 百分位；仅供报告参考，不参与门控。空数组返回 null。 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

/**
 * 扫描结果按 scope × kind 分组，超过关注门槛的文件进入观察名单。
 * 返回 Map<`scope\0kind`, { scope, kind, fileCount, p90, floor, outliers: Set<path> }>。
 * P90 只作报告参考，不参与 outliers 判定。
 */
export function detectOutliers(scan, policy = DEFAULT_POLICY) {
  const groups = new Map();
  for (const entry of scan) {
    const key = `${entry.scope}\u0000${entry.kind}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const result = new Map();
  for (const [key, entries] of groups) {
    const [scope, kind] = key.split("\u0000");
    const kindPolicy = policy?.[kind] ?? DEFAULT_POLICY[kind] ?? DEFAULT_POLICY.prod;
    const floor = kindPolicy.outlier_floor ?? 500;
    result.set(key, {
      scope,
      kind,
      fileCount: entries.length,
      p90: percentile(entries.map((entry) => entry.lines), 90),
      floor,
      outliers: new Set(
        entries
          .filter((entry) => entry.lines > floor)
          .map((entry) => entry.path)
          .sort(),
      ),
    });
  }
  return result;
}

/**
 * 校验当前扫描结果与 baseline。
 * 返回 { failures: string[], warnings: string[], registeredCount, exemptionCount }。
 */
export function validateBaseline(scan, baseline) {
  const failures = [];
  const warnings = [];

  if (!baseline || baseline.schema !== BASELINE_SCHEMA) {
    return {
      failures: [`baseline 缺失或 schema 不符（期望 ${BASELINE_SCHEMA}）：请先运行 --write-baseline`],
      warnings,
      registeredCount: 0,
      exemptionCount: 0,
    };
  }

  const files = baseline.files ?? {};
  const exemptions = baseline.exemptions ?? {};
  const current = new Map(scan.map((entry) => [entry.path, entry]));

  // R1：已登记文件只减不增（baseline 由本工具生成，内部信任其结构，不做二次防御）
  for (const [filePath, record] of Object.entries(files)) {
    const entry = current.get(filePath);
    if (!entry) {
      warnings.push(`baseline 记录的文件已不存在：${filePath}（可在下次 --write-baseline 时清理）`);
      continue;
    }
    const maxLines = record.max_lines;
    const allowedDelta = allowedDeltaFor(record, baseline.policy);
    if (entry.lines > maxLines + allowedDelta) {
      failures.push(
        `ratchet：${filePath} 当前 ${entry.lines} 行 > 登记上限 ${maxLines} 行 + 允许增量 ${allowedDelta} 行。` +
          "请真正拆分到职责单一的新模块，或在 baseline 登记理由；" +
          "不要把功能塞进超限文件，也**不要为过门禁机械压缩行数（删注释/空行、压行）**。",
      );
    }
  }

  // R2：超过关注门槛但未登记也未豁免的文件
  for (const group of detectOutliers(scan, baseline.policy).values()) {
    for (const filePath of group.outliers) {
      if (files[filePath] || exemptions[filePath]) continue;
      const entry = current.get(filePath);
      failures.push(
        `未登记：${filePath}（${entry?.lines ?? "?"} 行，${group.scope}/${group.kind}，` +
          `关注门槛 ${group.floor} 行）。请拆分到职责单一的新模块；` +
          "确属本质聚合型文件时，在 quality/module-size-baseline.json 的 exemptions 登记理由与复核日期。",
      );
    }
  }

  return {
    failures,
    warnings,
    registeredCount: Object.keys(files).length,
    exemptionCount: Object.keys(exemptions).length,
  };
}

/**
 * 生成/更新 baseline。规则：
 * - 首次生成：写入全部当前观察文件，max_lines = 当前行数。
 * - 更新：已登记文件 max_lines = min(旧上限, 当前行数)（只降不升）；
 *   新观察文件仅在 registerNew=true 时登记；已不存在的记录清理。
 * - exemptions 原样保留（人工维护）。
 */
export function buildBaseline(
  scan,
  previous,
  { policy = DEFAULT_POLICY, registerNew = false, now = new Date() } = {},
) {
  const effectivePolicy = previous?.policy ?? policy;
  const outliers = detectOutliers(scan, effectivePolicy);
  const current = new Map(scan.map((entry) => [entry.path, entry]));
  const previousFiles = previous?.files ?? {};
  const exemptions = previous?.exemptions ?? {};
  // 首次生成不存在「新债」概念：直接登记当前全部观察文件。
  const initial = !previous;

  const files = {};
  const unregistered = [];

  for (const group of outliers.values()) {
    for (const filePath of group.outliers) {
      if (exemptions[filePath]) continue;
      const entry = current.get(filePath);
      const previousMax = previousFiles[filePath]?.max_lines ?? previousFiles[filePath]?.lines;
      if (previousMax === undefined && !initial) {
        unregistered.push({ filePath, lines: entry.lines, scope: group.scope, kind: group.kind });
        if (!registerNew) continue;
      }
      const maxLines = previousMax === undefined ? entry.lines : Math.min(previousMax, entry.lines);
      files[filePath] = {
        lines: entry.lines,
        max_lines: maxLines,
        scope: group.scope,
        kind: group.kind,
        class: "watched",
      };
    }
  }

  const baseline = {
    schema: BASELINE_SCHEMA,
    generated_at: now.toISOString(),
    policy: effectivePolicy,
    note:
      "outlier_floor 是进入观察名单的关注门槛，不是行数红线；门禁 fail 只有 ratchet 与未登记两种。" +
      "exemptions 是本质聚合型文件（规范要求集中），豁免 ratchet 但必须登记理由与复核日期。" +
      "更新 baseline 时 max_lines 只降不升；新增观察文件需显式 --register-new。",
    files,
    exemptions,
  };

  return { baseline, unregistered };
}

// ── 文件扫描 ────────────────────────────────────────────────────────────────

function walkFiles(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "deps" || name === "_build" || name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkFiles(full, predicate, acc);
    } else if (predicate(full)) {
      acc.push(full);
    }
  }
  return acc;
}

function countLines(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (content.length === 0) return 0;
  const newlines = (content.match(/\n/g) ?? []).length;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

function isFrontendTest(filePath) {
  return (
    /\.(test|spec)\.(ts|tsx)$/.test(filePath) ||
    filePath.includes(`${path.sep}__tests__${path.sep}`)
  );
}

export function collectScanEntries(root = rootDir) {
  const entries = [];
  const appsDir = path.join(root, "apps");
  const appNames = existsSync(appsDir)
    ? readdirSync(appsDir).filter((name) => statSync(path.join(appsDir, name)).isDirectory())
    : [];

  for (const app of appNames) {
    const libDir = path.join(appsDir, app, "lib");
    for (const file of walkFiles(libDir, (filePath) => filePath.endsWith(".ex"))) {
      entries.push({
        path: path.relative(root, file),
        lines: countLines(file),
        scope: app,
        kind: "prod",
      });
    }
    const testDir = path.join(appsDir, app, "test");
    for (const file of walkFiles(testDir, (filePath) => filePath.endsWith(".exs"))) {
      entries.push({
        path: path.relative(root, file),
        lines: countLines(file),
        scope: app,
        kind: "test",
      });
    }
  }

  const srcDir = path.join(root, "frontend", "src");
  for (const file of walkFiles(
    srcDir,
    (filePath) => /\.(ts|tsx)$/.test(filePath) && !filePath.endsWith(".d.ts"),
  )) {
    const relative = path.relative(root, file);
    entries.push({
      path: relative,
      lines: countLines(file),
      scope: "frontend",
      kind: isFrontendTest(relative) ? "test" : "prod",
    });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function loadBaseline(readPath = BASELINE_PATH) {
  if (!existsSync(readPath)) return null;
  try {
    return JSON.parse(readFileSync(readPath, "utf8"));
  } catch (error) {
    console.error(`[module-size] baseline 解析失败：${error.message}`);
    return { schema: "invalid" };
  }
}

function printReport(scan, baseline) {
  const outliers = detectOutliers(scan, baseline?.policy ?? DEFAULT_POLICY);
  const files = baseline?.files ?? {};
  const exemptions = baseline?.exemptions ?? {};
  const rows = [];
  for (const group of outliers.values()) {
    for (const filePath of group.outliers) {
      const entry = scan.find((item) => item.path === filePath);
      rows.push({
        path: filePath,
        lines: entry?.lines ?? 0,
        scope: group.scope,
        kind: group.kind,
        p90: group.p90,
        registered: Boolean(files[filePath]),
        maxLines: files[filePath]?.max_lines,
        exempt: Boolean(exemptions[filePath]),
      });
    }
  }
  rows.sort((a, b) => b.lines - a.lines);

  console.log(`# 模块规模观察报告（${rows.length} 个文件超过关注门槛）\n`);
  console.log("| 文件 | 行数 | scope | kind | 分组 P90 | 登记上限 | 状态 |");
  console.log("|---|---:|---|---|---:|---:|---|");
  for (const row of rows) {
    const status = row.exempt ? "豁免" : row.registered ? "已登记" : "未登记";
    console.log(
      `| \`${row.path}\` | ${row.lines} | ${row.scope} | ${row.kind} | ${row.p90} | ${row.maxLines ?? "—"} | ${status} |`,
    );
  }
  const scopeSummary = [...outliers.values()]
    .map((group) => `${group.scope}/${group.kind}: ${group.fileCount} 文件, P90=${group.p90}, 门槛=${group.floor}`)
    .sort();
  console.log("\n## 分组统计（P90 仅作相对规模参考）\n");
  for (const line of scopeSummary) console.log(`- ${line}`);
}

function writeBaselineFile(baseline) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

function main(argv) {
  const check = argv.includes("--check");
  const report = argv.includes("--report");
  const write = argv.includes("--write-baseline");
  const registerNew = argv.includes("--register-new");

  if (!check && !report && !write) {
    console.error(
      "用法：node scripts/check_module_size.mjs --check | --report | --write-baseline [--register-new]",
    );
    return 2;
  }

  const scan = collectScanEntries();
  const baseline = loadBaseline();

  if (report) {
    printReport(scan, baseline);
    return 0;
  }

  if (write) {
    const { baseline: next, unregistered } = buildBaseline(scan, baseline, { registerNew });
    if (unregistered.length > 0) {
      console.error("[module-size] 发现未登记的新观察文件，拒绝写入 baseline：");
      for (const item of unregistered) {
        console.error(`  - ${item.filePath}（${item.lines} 行，${item.scope}/${item.kind}）`);
      }
      console.error(
        "  请先拆分到职责单一的新模块；确属本质聚合型文件时，人工加入 exemptions 并写明理由与复核日期。",
      );
      console.error("  如确认要登记为债务，显式追加 --register-new。");
      return 1;
    }
    writeBaselineFile(next);
    const count = Object.keys(next.files).length;
    console.log(
      `[module-size] baseline 已写入 ${path.relative(rootDir, BASELINE_PATH)}（${count} 个观察文件）`,
    );
    return 0;
  }

  const { failures, warnings, registeredCount, exemptionCount } = validateBaseline(scan, baseline);
  for (const warning of warnings) console.warn(`WARN ${warning}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error(
      `\n[module-size] 失败 ${failures.length} 项（登记 ${registeredCount} / 豁免 ${exemptionCount}）。` +
        "规则见 docs/coding-standards/03-module-boundaries.md §3.2。",
    );
    return 1;
  }
  console.log(
    `[module-size] 通过：扫描 ${scan.length} 个文件，登记 ${registeredCount} 个观察文件未增长，豁免 ${exemptionCount} 个。`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
