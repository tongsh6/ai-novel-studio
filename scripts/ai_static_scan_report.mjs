#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const scanDir = path.resolve(args["scan-dir"] ?? "artifacts/static-scan");
const topN = Number.parseInt(args.top ?? "10", 10);
const baselinePath = args.baseline ? path.resolve(args.baseline) : path.join(scanDir, "baseline.json");
const dispositionsPath = args.dispositions ? path.resolve(args.dispositions) : null;
const writeBaseline = Boolean(args["write-baseline"]);
const rawDir = path.join(scanDir, "raw");
const manifestPath = path.join(scanDir, "manifest.tsv");

const runs = readManifest(manifestPath);
const touchedFiles = getTouchedFiles();
const baseline = readBaseline(baselinePath);
const dispositions = readDispositions(dispositionsPath);
const baselineFingerprints = new Set((baseline.findings ?? baseline.fingerprints ?? []).map((item) => {
  return typeof item === "string" ? item : item.fingerprint;
}).filter(Boolean));

const findings = runs.flatMap((run) => findingsForRun(run, rawDir));

for (const finding of findings) {
  finding.fingerprint = fingerprint(finding);
  finding.is_touched = finding.file ? touchedFiles.has(finding.file) : false;
  finding.is_new = baselineFingerprints.size > 0 ? !baselineFingerprints.has(finding.fingerprint) : null;
  finding.disposition = dispositionFor(finding, dispositions);
  finding.score = scoreFinding(finding);
}

findings.sort((left, right) => right.score - left.score || left.tool.localeCompare(right.tool));

const topFindings = findings.slice(0, topN);
const summary = {
  generated_at: new Date().toISOString(),
  scan_dir: scanDir,
  baseline: existsSync(baselinePath) ? baselinePath : null,
  top: topN,
  runs: {
    total: runs.length,
    passed: runs.filter((run) => run.status === "0").length,
    failed: runs.filter((run) => run.status !== "0" && run.status !== "skipped").length,
    skipped: runs.filter((run) => run.status === "skipped").length,
  },
  findings: {
    total: findings.length,
    new: baselineFingerprints.size > 0 ? findings.filter((finding) => finding.is_new).length : null,
    touched: findings.filter((finding) => finding.is_touched).length,
    by_severity: countBy(findings, "severity"),
    by_category: countBy(findings, "category"),
    by_disposition: countBy(findings.map((finding) => finding.disposition), "status"),
  },
};

const report = {
  summary,
  runs,
  top_findings: topFindings,
  findings,
};

mkdirSync(scanDir, { recursive: true });
writeFileSync(path.join(scanDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(scanDir, "top10.md"), renderMarkdown(report));
writeFileSync(path.join(scanDir, "disposition.md"), renderDispositionMarkdown(report, dispositionsPath));

if (writeBaseline) {
  mkdirSync(path.dirname(baselinePath), { recursive: true });
  writeFileSync(
    baselinePath,
    `${JSON.stringify({
      generated_at: summary.generated_at,
      fingerprints: findings.map((finding) => finding.fingerprint).sort(),
    }, null, 2)}\n`,
  );
}

const hasRequiredFailures = runs.some((run) => run.status !== "0" && run.status !== "skipped");
process.exit(hasRequiredFailures ? 1 : 0);

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function readManifest(file) {
  if (!existsSync(file)) {
    throw new Error(`manifest not found: ${file}`);
  }

  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, name, category, severity, status, duration_ms, raw_file, command] = line.split("\t");
      return {
        id,
        name,
        category,
        severity,
        status,
        duration_ms: Number.parseInt(duration_ms, 10) || 0,
        raw_file,
        command,
      };
    });
}

function readBaseline(file) {
  if (!existsSync(file)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function readDispositions(file) {
  if (!file || !existsSync(file)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function dispositionFor(finding, dispositionsMap) {
  const stored = dispositionsMap[finding.fingerprint] ?? {};

  return {
    status: stored.status ?? "pending",
    handling: stored.handling ?? "",
    recommendation: stored.recommendation ?? "",
    owner: stored.owner ?? "",
    updated_at: stored.updated_at ?? "",
  };
}

function getTouchedFiles() {
  const files = new Set();

  for (const command of [
    "git diff --name-only HEAD --",
    "git ls-files --others --exclude-standard",
  ]) {
    try {
      const output = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const file of output.split("\n").filter(Boolean)) {
        files.add(normalizeFile(file));
      }
    } catch {
      // Git context is an optional ranking signal.
    }
  }

  return files;
}

function findingsForRun(run, rawDirPath) {
  if (run.status === "skipped") {
    return [];
  }

  if (run.id === "credo") {
    return parseCredo(run);
  }

  if (run.id === "sobelow") {
    return parseSobelow(run);
  }

  if (run.id === "gitleaks") {
    return parseGitleaks(run, rawDirPath);
  }

  if (run.id === "semgrep") {
    return parseSemgrep(run, rawDirPath);
  }

  if (run.id === "frontend-lint") {
    return parseEslint(run);
  }

  if (run.id === "design-trace") {
    return parseDesignTrace(run);
  }

  const raw = readRaw(run.raw_file);
  const parsed = parseGenericLines(run, raw);

  if (parsed.length > 0) {
    return parsed;
  }

  if (run.status !== "0") {
    return [commandFailure(run, firstUsefulLine(raw))];
  }

  return [];
}

function parseCredo(run) {
  const raw = readRaw(run.raw_file);
  const data = parseJson(raw);
  if (!data?.issues) {
    return run.status === "0" ? [] : [commandFailure(run, firstUsefulLine(raw))];
  }

  return data.issues.map((issue) => ({
    tool: "credo",
    category: credoCategory(issue.category),
    severity: credoSeverity(issue.priority),
    confidence: "high",
    file: normalizeFile(issue.filename),
    line: issue.line_no ?? null,
    title: shortCheckName(issue.check),
    message: issue.message,
    check: issue.check,
    raw_status: run.status,
  }));
}

function parseSobelow(run) {
  const raw = readRaw(run.raw_file);
  const data = parseJson(raw);
  const issues = data?.findings ?? data?.vulnerabilities ?? data?.issues ?? [];

  if (!Array.isArray(issues) || issues.length === 0) {
    return run.status === "0" ? [] : parseGenericLines(run, raw);
  }

  return issues.map((issue) => ({
    tool: "sobelow",
    category: "security",
    severity: normalizeSeverity(issue.severity ?? issue.type ?? run.severity),
    confidence: normalizeConfidence(issue.confidence),
    file: normalizeFile(issue.file ?? issue.filename),
    line: issue.line ?? issue.line_no ?? null,
    title: issue.title ?? issue.type ?? issue.finding ?? "Sobelow finding",
    message: issue.message ?? issue.details ?? issue.finding ?? "",
    check: issue.check ?? issue.type ?? null,
    raw_status: run.status,
  }));
}

function parseGitleaks(run, rawDirPath) {
  const jsonPath = path.join(rawDirPath, "gitleaks.json");
  const data = existsSync(jsonPath) ? parseJson(readRaw(jsonPath)) : null;
  if (!Array.isArray(data)) {
    const raw = readRaw(run.raw_file);
    return run.status === "0" ? [] : parseGenericLines(run, raw);
  }

  return data.map((issue) => ({
    tool: "gitleaks",
    category: "security",
    severity: "critical",
    confidence: "high",
    file: normalizeFile(issue.File),
    line: issue.StartLine ?? null,
    title: issue.RuleID ?? "Secret leak",
    message: issue.Description ?? "Potential secret detected",
    check: issue.RuleID ?? null,
    raw_status: run.status,
  }));
}

function parseSemgrep(run, rawDirPath) {
  const jsonPath = path.join(rawDirPath, "semgrep.json");
  const data = existsSync(jsonPath) ? parseJson(readRaw(jsonPath)) : null;
  const results = data?.results ?? [];
  if (!Array.isArray(results)) {
    const raw = readRaw(run.raw_file);
    return run.status === "0" ? [] : parseGenericLines(run, raw);
  }

  return results.map((issue) => ({
    tool: "semgrep",
    category: "security",
    severity: normalizeSeverity(issue.extra?.severity ?? run.severity),
    confidence: "medium",
    file: normalizeFile(issue.path),
    line: issue.start?.line ?? null,
    title: issue.check_id ?? "Semgrep finding",
    message: issue.extra?.message ?? "",
    check: issue.check_id ?? null,
    raw_status: run.status,
  }));
}

function parseEslint(run) {
  const raw = readRaw(run.raw_file);
  const findings = [];
  let currentFile = null;

  for (const line of raw.split("\n")) {
    const clean = stripAnsi(line).trimEnd();

    if (clean.startsWith(process.cwd()) && /\.(?:ts|tsx|js|jsx)$/.test(clean)) {
      currentFile = normalizeFile(clean);
      continue;
    }

    const match = clean.match(/^(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}([@\w/-]+)$/);
    if (!match || !currentFile) {
      continue;
    }

    findings.push({
      tool: "eslint",
      category: run.category,
      severity: match[3] === "error" ? "high" : "medium",
      confidence: "high",
      file: currentFile,
      line: Number.parseInt(match[1], 10),
      title: match[5],
      message: match[4],
      check: match[5],
      raw_status: run.status,
    });
  }

  if (findings.length === 0 && run.status !== "0") {
    findings.push(commandFailure(run, firstUsefulLine(raw)));
  }

  return findings;
}

function parseDesignTrace(run) {
  const raw = readRaw(run.raw_file);
  const findings = [];
  const pattern = /(frontend\/src\/components\/[^:]+):\s+(.+)/;

  for (const line of raw.split("\n")) {
    const clean = stripAnsi(line).trim();
    const match = clean.match(pattern);
    if (!match) {
      continue;
    }

    const message = match[2];
    if (!message.includes("缺少")) {
      continue;
    }

    const isFailure = message.includes("缺少");
    findings.push({
      tool: "design-trace",
      category: run.category,
      severity: isFailure ? "medium" : "low",
      confidence: "high",
      file: normalizeFile(match[1]),
      line: null,
      title: isFailure ? "Missing design trace" : "Incomplete design trace",
      message,
      check: "design-trace",
      raw_status: run.status,
    });
  }

  if (findings.length === 0 && run.status !== "0") {
    findings.push(commandFailure(run, firstUsefulLine(raw)));
  }

  return findings;
}

function parseGenericLines(run, raw) {
  const findings = [];
  const lines = raw.split("\n");
  const fileLinePattern = /((?:\/[^\s:]+\/)?(?:apps|config|docs|frontend|lib|priv|scripts|test)[^:\s]*):(\d+)(?::\d+)?/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripAnsi(lines[index]).trim();
    const match = line.match(fileLinePattern);
    if (!match) {
      continue;
    }

    const context = stripAnsi(lines[Math.max(0, index - 1)] ?? "").trim();
    findings.push({
      tool: run.id,
      category: run.category,
      severity: run.severity,
      confidence: "medium",
      file: normalizeFile(match[1]),
      line: Number.parseInt(match[2], 10),
      title: run.name,
      message: context && context !== line ? context : line,
      check: run.id,
      raw_status: run.status,
    });
  }

  if (findings.length === 0 && run.status !== "0") {
    findings.push(commandFailure(run, firstUsefulLine(raw)));
  }

  return findings;
}

function commandFailure(run, message) {
  return {
    tool: run.id,
    category: run.category,
    severity: run.severity,
    confidence: "high",
    file: null,
    line: null,
    title: `${run.name} failed`,
    message: message || `Command exited with status ${run.status}`,
    check: run.id,
    raw_status: run.status,
  };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readRaw(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function firstUsefulLine(raw) {
  const lines = raw
    .split("\n")
    .map((line) => stripAnsi(line).trim())
    .filter((line) => line && !line.startsWith("==>"));

  return lines.find((line) => /error|fail|exception|exit/i.test(line)) ?? lines[0] ?? "";
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function normalizeFile(file) {
  if (!file) {
    return null;
  }

  return file.replaceAll("\\", "/").replace(`${process.cwd()}/`, "");
}

function normalizeSeverity(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (["critical", "high", "medium", "low", "info"].includes(normalized)) {
    return normalized;
  }
  if (["error", "warning"].includes(normalized)) {
    return normalized === "error" ? "high" : "medium";
  }
  return "medium";
}

function normalizeConfidence(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (["high", "medium", "low"].includes(normalized)) {
    return normalized;
  }
  return "medium";
}

function credoCategory(category) {
  if (category === "warning") {
    return "correctness";
  }
  if (category === "readability") {
    return "style";
  }
  return "maintainability";
}

function credoSeverity(priority) {
  if (priority >= 10) {
    return "high";
  }
  if (priority >= 0) {
    return "medium";
  }
  return "low";
}

function shortCheckName(check) {
  return check ? check.split(".").at(-1) : "Static analysis finding";
}

function fingerprint(finding) {
  return [
    finding.tool,
    finding.check,
    finding.file ?? "",
    finding.line ?? "",
    finding.title,
  ].join("|");
}

function scoreFinding(finding) {
  const severityScore = { critical: 400, high: 300, medium: 200, low: 100, info: 0 };
  const categoryScore = { security: 80, correctness: 70, architecture: 60, maintainability: 40, style: 10 };
  const confidenceScore = { high: 30, medium: 15, low: 0 };

  return (
    (finding.is_new === true ? 2000 : 0) +
    (finding.is_touched ? 1000 : 0) +
    (severityScore[finding.severity] ?? 0) +
    (categoryScore[finding.category] ?? 0) +
    (confidenceScore[finding.confidence] ?? 0)
  );
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] ?? "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function renderMarkdown(report) {
  const skipped = report.runs.filter((run) => run.status === "skipped");
  const failed = report.runs.filter((run) => run.status !== "0" && run.status !== "skipped");
  const lines = [
    "# AI Static Scan Top 10",
    "",
    `Generated: ${report.summary.generated_at}`,
    `Runs: ${report.summary.runs.passed} passed, ${report.summary.runs.failed} failed, ${report.summary.runs.skipped} skipped`,
    `Findings: ${report.summary.findings.total} total, ${report.summary.findings.touched} in touched files`,
  ];

  if (report.summary.findings.new !== null) {
    lines.push(`New findings vs baseline: ${report.summary.findings.new}`);
  }

  if (failed.length > 0) {
    lines.push("", "## Failed Checks");
    for (const run of failed) {
      lines.push(`- [${run.severity}] ${run.name}: \`${run.command}\` (${run.duration_ms}ms)`);
    }
  }

  if (skipped.length > 0) {
    lines.push("", "## Skipped Checks");
    for (const run of skipped) {
      lines.push(`- ${run.name}: ${run.command}`);
    }
  }

  lines.push("", "## Top Findings");

  if (report.top_findings.length === 0) {
    lines.push("No findings.");
  } else {
    report.top_findings.forEach((finding, index) => {
      const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "global";
      const flags = [
        finding.is_new === true ? "new" : null,
        finding.is_touched ? "touched" : null,
      ].filter(Boolean);

      lines.push(
        `${index + 1}. [${finding.severity}][${finding.category}][${finding.tool}] ${finding.title}`,
        `   - Location: ${location}`,
        `   - Message: ${finding.message || "(no message)"}`,
        `   - Disposition: ${finding.disposition.status}${finding.disposition.handling ? ` — ${finding.disposition.handling}` : ""}`,
        `   - Fingerprint: \`${finding.fingerprint}\`${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`,
      );
    });
  }

  lines.push(
    "",
    "## AI Action Rule",
    "Fix P0/P1 findings first, then touched-file P2 findings. Re-run this script and report any remaining Top 10 item that cannot be safely fixed in this slice.",
  );

  return `${lines.join("\n")}\n`;
}

function renderDispositionMarkdown(report, dispositionsFile) {
  const lines = [
    "# AI Static Scan Disposition",
    "",
    `Generated: ${report.summary.generated_at}`,
    `Source report: ${path.join(report.summary.scan_dir, "report.json")}`,
    dispositionsFile ? `Disposition DB: ${dispositionsFile}` : "Disposition DB: not configured",
    "",
    "## Status Vocabulary",
    "",
    "| Status | Meaning |",
    "|---|---|",
    "| pending | 新发现或尚未判断 |",
    "| fixed | 已在当前改动中修复 |",
    "| accepted_risk | 确认存在但当前接受风险 |",
    "| false_positive | 工具误报，附原因 |",
    "| deferred | 暂缓处理，附后续建议 |",
    "",
    "## Top Findings Triage",
    "",
  ];

  if (report.top_findings.length === 0) {
    lines.push("No findings.");
  } else {
    lines.push(
      "| # | Finding | Location | Status | Handling | Recommendation | Fingerprint |",
      "|---:|---|---|---|---|---|---|",
    );

    report.top_findings.forEach((finding, index) => {
      const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "global";
      const label = `[${finding.severity}][${finding.category}][${finding.tool}] ${finding.title}`;
      lines.push(
        `| ${index + 1} | ${escapeTable(label)} | ${escapeTable(location)} | ${escapeTable(finding.disposition.status)} | ${escapeTable(finding.disposition.handling)} | ${escapeTable(finding.disposition.recommendation)} | \`${escapeTable(finding.fingerprint)}\` |`,
      );
    });
  }

  lines.push(
    "",
    "## AI Reporting Rule",
    "",
    "Final answers must mention both dimensions: the Top N scan result and the disposition for each unresolved item. When a finding is not fixed, record whether it is accepted_risk, false_positive, or deferred, and explain the handling/recommendation.",
  );

  return `${lines.join("\n")}\n`;
}

function escapeTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}
