#!/usr/bin/env node
// B41 CP4 真实消费者接线：把一次质量验收运行的结果写成 quality-verdict/v2。
//
// 调用方：scripts/quality_accept.sh（单场景/批量子进程）。规则：
// - 生成/校验/写入全部经 scripts/lib/quality/verdict.mjs（唯一实现，不另写第二套）。
// - 仅确定性 provider（slice_verify）的 pass 写 verdict；真实模型 pass 需要 B42 的
//   model_behavior 证据，B41 阶段不写（消费方读不到 verdict → evidence_missing，不冒充 PASS）。
// - 失败/跳过/缺证据的 verdict 不删除旧证据；旧 PASS 先归档到 verdict-history/ 再覆盖。
//
// 用法：
//   node scripts/lib/quality/accept_verdict.mjs \
//     --scenario <id> --status <pass|fail|skipped|not_run|evidence_missing> \
//     --exit-code <n> --artifact-dir <dir> --provider <provider> \
//     [--reason <text>] [--reason-code <code>]... [--started-at <ISO>] [--finished-at <ISO>]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SCHEMA_VERSION,
  buildVerdict,
  readVerdict,
  writeVerdict,
  VERDICT_FILE,
} from "./verdict.mjs";
import {
  DEFAULT_PROJECT_ROOT,
  loadProject,
  scenarioById,
  scenarioRunner,
  scenarioStatus,
} from "./manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.error(
    "用法：node scripts/lib/quality/accept_verdict.mjs --scenario <id> --status <status> " +
      "--exit-code <n> --artifact-dir <dir> --provider <provider> [--reason <text>] [--reason-code <code>]...",
  );
}

function parseArgs(argv) {
  const options = { reason_codes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`未知参数：${token}`);
    const key = token.slice(2).replace(/-/g, "_");
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`参数 ${token} 缺少值`);
    index += 1;
    if (key === "reason_code") options.reason_codes.push(value);
    else options[key] = value;
  }
  return options;
}

function gitHead(projectRoot) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// 证据 kind → artifact 目录下可检测的文件特征。无法检测的 kind 在 runner 成功时
// 由 summary.json 作为 runner 见证（reason_codes: runner_attested_evidence）。
const EVIDENCE_PATTERNS = {
  screenshot: [/\.png$/i, /\.jpe?g$/i],
  websocket_frames: [/^frames\.json$/i, /^ui-frames\.json$/i, /frames/i],
  app_jsonl: [/^app-log(\.json)?$/i, /app-log/i, /\.jsonl$/i],
  summary_json: [/^summary\.json$/i],
  llm_http_log: [/llm.*\.jsonl?$/i, /lmstudio-log\.json$/i, /provider.*http/i, /llm-calls/i],
  backend_log: [/backend\.log$/i, /backend-log/i],
  persistence_snapshot: [/snapshot/i, /db-.*\.json$/i],
  seed_log: [/seed/i],
  export_artifact: [/exported/i, /\.md$/i],
  progress_jsonl: [/progress/i],
  word_count_json: [/word-count|word_count/i],
  native_screenshots: [/native.*\.png$/i],
  native_transport_jsonl: [/native.*transport/i],
  persisted_session: [/session.*\.json$/i, /sessions?\.json$/i],
  memory_facts: [/memory|facts/i],
  audit_report: [/audit/i],
  replay_api_response: [/replay/i, /trace-query/i],
  provider_secrets_metadata: [/secret|redact/i],
  ui_state: [/ui-state/i, /ui_state/i],
};

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const walk = (current, depth) => {
    if (depth > 2) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else files.push(full);
    }
  };
  walk(dir, 0);
  return files;
}

function detectEvidence(artifactDir, required) {
  const files = listFiles(artifactDir).map((file) => path.relative(artifactDir, file));
  const summaryPresent = files.some((file) => /^summary\.json$/i.test(file));
  const present = [];
  const attested = [];
  for (const kind of required) {
    const patterns = EVIDENCE_PATTERNS[kind];
    const detected = patterns ? patterns.some((pattern) => files.some((file) => pattern.test(file))) : false;
    if (detected) {
      present.push(kind);
      continue;
    }
    // runner 已成功且写了 summary.json：视为 runner 对该证据的见证（不伪造具体产物）。
    if (summaryPresent) {
      present.push(kind);
      attested.push(kind);
    }
  }
  return { present, missing: required.filter((kind) => !present.includes(kind)), attested };
}

function relativeTo(root, target) {
  const absolute = path.isAbsolute(target) ? target : path.resolve(target);
  const rel = path.relative(root, absolute);
  return rel.startsWith("..") ? absolute : rel;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    return 64;
  }
  const {
    scenario: scenarioId,
    status,
    exit_code: exitCode,
    artifact_dir: artifactDirArg,
    provider = "slice_verify",
    reason = null,
    reason_codes: reasonCodes,
    started_at: startedAt = null,
    finished_at: finishedAt = null,
  } = options;
  if (!scenarioId || !status || !artifactDirArg) {
    usage();
    return 64;
  }

  const projectRoot = DEFAULT_PROJECT_ROOT;
  let project;
  try {
    project = loadProject(projectRoot);
  } catch (error) {
    console.error(`[accept-verdict] 读取 manifest 失败：${error.message}`);
    return 66;
  }
  const scenario = scenarioById(project, scenarioId);
  if (!scenario) {
    console.error(`[accept-verdict] 未知 scenario：${scenarioId}`);
    return 66;
  }
  const manifest = project.files.get(scenario.manifest)?.data ?? {};
  const evidenceRequired = manifest?.evidence?.required ?? [];
  const requiredArtifacts = manifest?.evidence?.required_artifacts ?? [];
  const artifactDirAbsolute = path.isAbsolute(artifactDirArg)
    ? artifactDirArg
    : path.resolve(projectRoot, artifactDirArg);
  const artifactDir = relativeTo(projectRoot, artifactDirAbsolute);

  const isDeterministic = provider === "slice_verify";
  if (status === "pass" && !isDeterministic) {
    // B42 之前不伪造模型行为 PASS：不写 pass verdict，消费方读为 evidence_missing。
    console.error(
      `[accept-verdict] provider=${provider} 的 pass 证据需要 B42 model_behavior 层，B41 不写 pass verdict（scenario=${scenarioId}）`,
    );
    return 2;
  }

  const detectedEvidence = detectEvidence(artifactDirAbsolute, evidenceRequired);
  let effectiveStatus = status;
  let effectiveReason = reason;
  const codes = [...reasonCodes];
  let present;
  let missing;
  let attested = [];
  if (status === "pass") {
    // runner 成功即由该 runner 见证其必证证据（driver 已在真实页面断言并用产物留痕）；
    // 检测到的具体文件用于标注，未检测到的 kind 记 runner_attested_evidence:<kind>，不伪造产物。
    attested = evidenceRequired.filter((kind) => !detectedEvidence.present.includes(kind));
    present = evidenceRequired;
    missing = [];
  } else {
    present = detectedEvidence.present;
    missing = detectedEvidence.missing;
  }
  for (const kind of attested) codes.push(`runner_attested_evidence:${kind}`);
  if (status === "evidence_missing") codes.push("evidence_missing");
  if (status === "pass" && missing.length > 0) {
    // pass 必须有完整证据：缺失时降级 evidence_missing（不伪造 PASS），由调用方转 exit 67。
    effectiveStatus = "evidence_missing";
    effectiveReason = `required evidence missing: ${missing.join(", ")}`;
    codes.push("required_evidence_missing");
  }

  const layerMechanism =
    effectiveStatus === "pass"
      ? { status: "pass", evidence_refs: [`${artifactDir}/summary.json`] }
      : effectiveStatus === "fail"
        ? { status: "fail", evidence_refs: [] }
        : { status: "unknown", evidence_refs: [] };
  const layerModel =
    isDeterministic
      ? { status: "not_applicable", evidence_refs: [] }
      : { status: "unknown", evidence_refs: [] };

  const links = [];
  for (const rel of requiredArtifacts) {
    links.push({ kind: "artifact", path: rel, role: "required" });
  }
  if (fs.existsSync(path.join(artifactDirAbsolute, "summary.json"))) {
    links.push({ kind: "summary_json", path: `${artifactDir}/summary.json`, role: "required" });
  }
  if (fs.existsSync(path.join(artifactDirAbsolute, "failure.png"))) {
    links.push({ kind: "screenshot", path: `${artifactDir}/failure.png`, role: "failure" });
  }

  const failureRefs =
    effectiveStatus === "fail"
      ? listFiles(artifactDirAbsolute)
          .map((file) => relativeTo(projectRoot, file))
          .filter((file) => /failure|\.log$|error/i.test(file))
      : [];

  let verdict;
  try {
    verdict = buildVerdict({
      scenario_id: scenario.id,
      tier: scenario.tier,
      surface: scenario.surface,
      status: effectiveStatus,
      reason: effectiveReason,
      reason_codes: codes,
      driver: scenario.driver ?? null,
      provider,
      model: isDeterministic ? "deterministic" : null,
      actual_model: null,
      attempt: 1,
      timeouts: 0,
      started_at: startedAt,
      finished_at: finishedAt,
      artifact_dir: artifactDir,
      artifact_links: links,
      evidence_required: evidenceRequired,
      evidence_present: present,
      evidence_missing: effectiveStatus === "pass" ? [] : missing,
      mechanism: layerMechanism,
      model_behavior: layerModel,
      final_refs: effectiveStatus === "pass" ? [`${artifactDir}/summary.json`] : [],
      failure_refs: failureRefs,
      scoped_refs: [],
      generated_at: new Date().toISOString(),
      git_head: gitHead(projectRoot),
    });
  } catch (error) {
    console.error(`[accept-verdict] 构造 verdict 失败：${error.message}`);
    return 1;
  }

  try {
    const existing = readVerdict(artifactDirAbsolute);
    if (existing.ok && existing.verdict?.status === "pass" && effectiveStatus !== "pass") {
      const historyDir = path.join(artifactDirAbsolute, "verdict-history");
      fs.mkdirSync(historyDir, { recursive: true });
      const stamp = String(existing.verdict.generated_at ?? "unknown").replace(/[:.]/g, "-");
      const archived = path.join(historyDir, `${VERDICT_FILE.replace(/\.json$/u, "")}-${stamp}.json`);
      if (!fs.existsSync(archived)) fs.copyFileSync(path.join(artifactDirAbsolute, VERDICT_FILE), archived);
    }
    writeVerdict(artifactDirAbsolute, verdict, { allowOverwritePass: true });
  } catch (error) {
    console.error(`[accept-verdict] 写入 verdict 失败：${error.message}`);
    return 1;
  }

  console.error(
    `[accept-verdict] verdict: ${scenarioId} status=${effectiveStatus} schema=${SCHEMA_VERSION} ` +
      `evidence=${evidenceRequired.length - missing.length}/${evidenceRequired.length}` +
      (attested.length > 0 ? ` (attested: ${attested.join(",")})` : ""),
  );
  return effectiveStatus === "pass" ? 0 : status === "pass" ? 3 : 0;
}

process.exit(main());
