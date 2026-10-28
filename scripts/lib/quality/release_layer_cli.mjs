#!/usr/bin/env node
// B42 CP1：release / release-real-llm 结果层 CLI。
//
// 把一次 B41 batch（artifacts/quality-accept/batches/<...>/batch.json）+ 每场景
// verdict、CP2 evidence chain、CP3 native run manifest 组装成 quality-release-layer/v1
// 分层结果，并给出显式退出码。写出的结果文件只增不删（拒绝覆盖既有结果）。
//
// 用法：
//   node scripts/lib/quality/release_layer_cli.mjs summarize --tier release-real-llm
//   node scripts/lib/quality/release_layer_cli.mjs summarize --tier release \
//     --batch artifacts/quality-accept/batches/pr-smoke-XXXX/batch.json \
//     --provider slice_verify --json
//   node scripts/lib/quality/release_layer_cli.mjs summarize --tier release-real-llm \
//     --retention-text "把主角写得更狠一点" --retention-ref artifacts/.../retention.md \
//     --requires-observation-link --out artifacts/quality-accept/release-layer
//
// 退出码：0 pass；1 fail；65 空 tier / blocked；67 evidence_missing；69 not_run；
//         64 usage；66 config（tier 非法 / registry 读取失败）。

import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PROJECT_ROOT,
  loadRegistryScenarios,
} from "./manifest.mjs";
import { readVerdict } from "./verdict.mjs";
import {
  readArtifactEvidence,
  readRecordedEvidenceChain,
  readRecordedEvidenceRequirements,
  validateEvidenceRequirements,
} from "./evidence_chain.mjs";
import { scanNativeArtifactDir } from "./native_run_manifest.mjs";
import {
  RELEASE_LAYER_FILE,
  RELEASE_TIERS,
  buildReleaseLayerSummary,
  readBatchSummary,
  tierClassFor,
  validateReleaseLayerSummary,
  writeReleaseLayerSummary,
} from "./release_layer.mjs";

const USAGE = [
  "用法：node scripts/lib/quality/release_layer_cli.mjs summarize --tier <release|release-real-llm> [options]",
  "  --surface <browser|tauri>",
  "  --batch <batch.json|batch-dir>      # 缺省取 artifacts/quality-accept/batches 下最近的同 tier 批次",
  "  --provider <p>",
  "  --planned-runs <n>                  # 默认 release=1 / release-real-llm=2",
  "  --retention-text <text>             # 未参与调词的保留措辞",
  "  --retention-ref <ref>               # 措辞留痕引用",
  "  --requires-observation-link         # 旧 flag：等价于声明 observation_link required",
  "  --requires-full-matrix              # 场景要求全矩阵（scoped 原生证据不算）",
  "  --evidence-requirements <file.json>  # 运行前冻结的必需证据声明（缺省读 artifact/evidence-requirements.json，再缺省按全 required）",
  "  --out <dir>                         # 写 <dir>/release-layer.json（默认只打印）",
  "  --overwrite                         # 明确允许覆盖同目录旧结果（默认拒绝）",
  "  --json                              # stdout 输出 JSON（否则人类可读摘要）",
  "  --root <dir>",
];

function splitArgs(argv) {
  const args = [...argv];
  if (args[0] === "summarize") args.shift();
  else if (args[0] && !args[0].startsWith("--")) {
    throw new Error(`未知子命令：${args[0]}`);
  }
  const options = { flags: new Set() };
  const withValue = new Set([
    "--tier",
    "--surface",
    "--batch",
    "--provider",
    "--planned-runs",
    "--retention-text",
    "--retention-ref",
    "--evidence-requirements",
    "--out",
    "--root",
  ]);
  const flags = new Set(["--requires-observation-link", "--requires-full-matrix", "--overwrite", "--json"]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`未知参数：${token}`);
    if (withValue.has(token)) {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`参数 ${token} 缺少值`);
      options[token.slice(2).replace(/-/g, "_")] = value;
      index += 1;
      continue;
    }
    if (!flags.has(token)) throw new Error(`未知参数：${token}`);
    options.flags.add(token.slice(2));
  }
  return options;
}

function latestBatchForTier(root, tier) {
  const batchRoot = path.join(root, "artifacts/quality-accept/batches");
  if (!fs.existsSync(batchRoot)) return null;
  const candidates = [];
  for (const name of fs.readdirSync(batchRoot)) {
    const file = path.join(batchRoot, name, "batch.json");
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data.tier === tier) {
        candidates.push({ file, stat: fs.statSync(file) });
      }
    } catch {
      // 坏批次不进结果层；调用方可用 --batch 显式指定。
    }
  }
  candidates.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  return candidates[0]?.file ?? null;
}

function looksNativeArtifactDir(artifactDir) {
  if (!artifactDir) return false;
  return (
    fs.existsSync(path.join(artifactDir, "run")) ||
    fs.existsSync(path.join(artifactDir, "termination.json")) ||
    fs.existsSync(path.join(artifactDir, "run", "native-transport.jsonl")) ||
    fs.existsSync(path.join(artifactDir, "native-transport.jsonl"))
  );
}

function readAttempts(artifactDir) {
  const file = path.join(artifactDir, "attempts.json");
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function readRetentionFromArtifact(artifactDir) {
  const file = path.join(artifactDir, "retention-wording.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function loadScenarioResult({ projectRoot, row, scenario, options }) {
  const artifactDirArg = row.artifact_dir ?? null;
  const artifactDir = artifactDirArg
    ? path.isAbsolute(artifactDirArg)
      ? artifactDirArg
      : path.resolve(projectRoot, artifactDirArg)
    : null;
  const verdictRead = artifactDir ? readVerdict(artifactDir) : { ok: false, status: "evidence_missing" };
  const verdict = verdictRead.ok ? verdictRead.verdict : null;
  let evidence = null;
  if (artifactDir && fs.existsSync(artifactDir)) {
    try {
      // 历史 artifact 未记录 Base refs → null=unknown，不能伪报“已知为空”。
      evidence = readArtifactEvidence(artifactDir, { base_refs: null });
    } catch {
      evidence = null;
    }
  }
  let nativeRun = null;
  if (artifactDir && looksNativeArtifactDir(artifactDir)) {
    try {
      nativeRun = scanNativeArtifactDir(artifactDir);
    } catch {
      nativeRun = null;
    }
  }
  // B42 §12：优先读 artifact 里已记录的证据链（quality-evidence-chain/v1），
  // 缺失才退回从原始 artifact 派生（历史 artifact → binding unknown，不会写成 PASS）。
  let chain = evidence?.chain ?? null;
  let chainError = null;
  if (artifactDir && fs.existsSync(artifactDir)) {
    try {
      const recorded = readRecordedEvidenceChain(artifactDir);
      if (recorded) chain = recorded;
    } catch (error) {
      chain = null;
      chainError = error.message;
    }
  }
  // 必需证据声明优先级：CLI 显式文件 > artifact 冻结声明 > registry 场景声明 > 全 required。
  let requirements = null;
  let requirementsError = null;
  if (options.evidence_requirements) {
    const reqPath = path.isAbsolute(options.evidence_requirements)
      ? options.evidence_requirements
      : path.resolve(projectRoot, options.evidence_requirements);
    const raw = fs.readFileSync(reqPath, "utf8");
    const parsed = JSON.parse(raw);
    const errors = validateEvidenceRequirements(parsed);
    if (errors.length > 0) {
      throw new Error(`--evidence-requirements 非法（${reqPath}）：${errors.join("; ")}`);
    }
    requirements = parsed;
  } else if (artifactDir) {
    try {
      requirements = readRecordedEvidenceRequirements(artifactDir);
    } catch (error) {
      requirementsError = error.message;
    }
  }
  if (requirements === null && scenario?.evidence_requirements !== undefined) {
    const errors = validateEvidenceRequirements(scenario.evidence_requirements);
    if (errors.length > 0) {
      throw new Error(
        `registry 场景 ${row.scenario_id} 的 evidence_requirements 非法：${errors.join("; ")}`,
      );
    }
    requirements = scenario.evidence_requirements;
  }
  const llmCalls = evidence?.llm_calls ?? [];
  const realCalls = llmCalls.filter((call) => call.real);
  const artifactRetention = artifactDir ? readRetentionFromArtifact(artifactDir) : null;
  const retention = artifactRetention ?? (options.retention_text
    ? { text: options.retention_text, ref: options.retention_ref ?? null, tuned: false }
    : null);
  const attempts = artifactDir ? readAttempts(artifactDir) : [];
  const driver =
    verdict?.driver ??
    scenario?.driver ??
    null;
  const provider =
    verdict?.provider ??
    scenario?.default_provider ??
    (row.status === "pass" ? options.provider ?? null : null);
  const screenEvidence = evidence?.files?.frames?.length ?? 0;
  return {
    scenario_id: row.scenario_id,
    status: verdict?.status ?? row.status,
    reason: verdict?.reason ?? row.reason ?? null,
    artifact_dir: artifactDir ? path.relative(projectRoot, artifactDir) : null,
    surface: verdict?.surface ?? scenario?.surface ?? options.surface ?? null,
    provider,
    driver,
    model: verdict?.model ?? null,
    actual_model: verdict?.actual_model ?? null,
    attempt: verdict?.attempt ?? null,
    timeouts: verdict?.timeouts ?? 0,
    git_head: verdict?.git_head ?? null,
    generated_at: verdict?.generated_at ?? null,
    started_at: verdict?.started_at ?? null,
    finished_at: verdict?.finished_at ?? null,
    mechanism: verdict?.mechanism ?? { status: "unknown", evidence_refs: [] },
    model_behavior: verdict?.model_behavior ?? { status: "unknown", evidence_refs: [] },
    model_behavior_evidence: {
      real_provider_calls: realCalls.length,
      provider_responses_with_body: realCalls.filter((call) => call.response_has_body).length,
      http_2xx: realCalls.filter((call) => call.http_ok).length,
      evidence_frames: screenEvidence,
      verdict_present: Boolean(verdict),
      verdict_status: verdict?.status ?? null,
    },
    // 采样参数取真实请求体里记录的值（readLlmCalls.request_params）；缺失不伪造 → missing_model_params。
    params: realCalls.map((call) => call.request_params).find(Boolean) ?? null,
    evidence_chain: chain,
    evidence_chain_error: chainError,
    evidence_requirements: requirements,
    evidence_requirements_error: requirementsError,
    native_run: nativeRun,
    requires_observation_link: options.flags.has("requires-observation-link") === true,
    requires_full_matrix: options.flags.has("requires-full-matrix") === true,
    retention_wording: retention ?? null,
    retention_wording_ref: retention?.ref ?? null,
    runs: attempts,
    reason_codes: [],
  };
}

function humanSummary(summary) {
  const lines = [];
  lines.push(`[release-layer] tier=${summary.tier} class=${summary.tier_class} status=${summary.status} exit=${summary.exit_code}`);
  lines.push(`[release-layer] counts: planned=${summary.counts.planned} pass=${summary.counts.pass} fail=${summary.counts.fail} skipped=${summary.counts.skipped} evidence_missing=${summary.counts.evidence_missing} not_run=${summary.counts.not_run}`);
  lines.push(
    `[release-layer] layers: mechanism(pass=${summary.layers.mechanism.pass} fail=${summary.layers.mechanism.fail} unknown=${summary.layers.mechanism.unknown} na=${summary.layers.mechanism.not_applicable}) ` +
      `model_behavior(pass=${summary.layers.model_behavior.pass} fail=${summary.layers.model_behavior.fail} unknown=${summary.layers.model_behavior.unknown} na=${summary.layers.model_behavior.not_applicable})`,
  );
  for (const scene of summary.scenarios) {
    lines.push(
      `[release-layer]   ${scene.scenario_id}: ${scene.layer_status}` +
        (scene.reason_codes.length > 0 ? ` — ${scene.reason_codes.join(",")}` : ""),
    );
  }
  if (summary.known_fact) lines.push(`[release-layer] known fact: ${summary.known_fact}`);
  if (summary.reason_codes.length > 0) lines.push(`[release-layer] reason_codes: ${summary.reason_codes.join(",")}`);
  return lines.join("\n");
}

function main() {
  let options;
  try {
    options = splitArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE.join("\n"));
    return 64;
  }
  const projectRoot = options.root ? path.resolve(options.root) : DEFAULT_PROJECT_ROOT;
  const tier = options.tier ?? null;
  if (!RELEASE_TIERS.includes(tier)) {
    console.error(`[release-layer] tier 必须是 ${RELEASE_TIERS.join(" | ")}（实际 ${tier ?? "缺省"}）`);
    console.error(USAGE.join("\n"));
    return 64;
  }
  if (!tierClassFor(tier)) return 66;

  let registryScenarios = [];
  try {
    const project = loadRegistryScenarios(projectRoot);
    registryScenarios = project.scenarios.filter((scenario) => scenario.tier === tier);
  } catch (error) {
    console.error(`[release-layer] 读取 registry 失败：${error.message}`);
    return 66;
  }

  const batchPath = options.batch ? path.resolve(projectRoot, options.batch) : latestBatchForTier(projectRoot, tier);
  let batch = null;
  if (batchPath && fs.existsSync(batchPath)) {
    try {
      batch = readBatchSummary(batchPath);
    } catch (error) {
      console.error(`[release-layer] 读取 batch 失败：${error.message}`);
      return 66;
    }
    if (batch.tier && batch.tier !== tier) {
      console.error(
        `[release-layer] 批次 tier=${batch.tier} 与请求 tier=${tier} 不一致；跨 tier 结果不得合并成单一 PASS`,
      );
      return 66;
    }
  }

  const registryById = new Map(registryScenarios.map((scenario) => [scenario.id, scenario]));
  const results = [];
  try {
    for (const row of batch?.scenarios ?? []) {
      const scenario = registryById.get(row.scenario_id) ?? null;
      results.push(
        loadScenarioResult({
          projectRoot,
          row,
          scenario,
          options: {
            ...options,
            provider: options.provider ?? batch?.provider ?? null,
            surface: options.surface ?? batch?.surface ?? null,
          },
        }),
      );
    }
  } catch (error) {
    console.error(`[release-layer] 组装场景结果失败：${error.message}`);
    return 66;
  }
  const plannedRuns = options.planned_runs ? Number(options.planned_runs) : null;

  let summary;
  try {
    summary = buildReleaseLayerSummary({
      tier,
      surface: options.surface ?? batch?.surface ?? null,
      provider: options.provider ?? batch?.provider ?? null,
      results,
      batch_id: batch?.batch_id ?? null,
      git_head: batch?.git_head ?? null,
      planned_runs: Number.isInteger(plannedRuns) ? plannedRuns : undefined,
      retention_wording: options.retention_text
        ? { text: options.retention_text, ref: options.retention_ref ?? null, tuned: false }
        : null,
      registered_scenarios: registryScenarios.length,
    });
  } catch (error) {
    console.error(`[release-layer] 构造分层结果失败：${error.message}`);
    return 66;
  }
  const errors = validateReleaseLayerSummary(summary);
  if (errors.length > 0) {
    console.error(`[release-layer] 分层结果未通过校验：\n- ${errors.join("\n- ")}`);
    return 66;
  }

  if (options.out) {
    const outDir = path.isAbsolute(options.out) ? options.out : path.resolve(projectRoot, options.out);
    try {
      const written = writeReleaseLayerSummary(outDir, summary, {
        overwrite: options.flags.has("overwrite"),
      });
      console.error(`[release-layer] wrote ${path.relative(projectRoot, written.path)}`);
    } catch (error) {
      console.error(`[release-layer] 写入失败：${error.message}`);
      return 66;
    }
  }
  if (options.flags.has("json")) console.log(JSON.stringify(summary, null, 2));
  else console.log(humanSummary(summary));
  return summary.exit_code;
}

process.exit(main());
