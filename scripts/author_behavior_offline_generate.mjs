#!/usr/bin/env node
// B72 离线生成入口：只有显式 --offline 才运行确定性执行器；真实模型校准未接线。
import fs from "node:fs";
import path from "node:path";
import {
  createOfflineExecutor,
  generateBatch,
  loadPersonaSidecar,
  writeGenerationArtifacts,
} from "./lib/quality/author_behavior_offline_generator.mjs";
import {
  DEFAULT_PROJECT_ROOT,
  AuthorBehaviorError,
  loadAuthorBehaviorCorpus,
} from "./lib/quality/author_behavior.mjs";

function parseArgs(argv) {
  const options = { root: DEFAULT_PROJECT_ROOT, manifest: null, offline: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = path.resolve(argv[(index += 1)] ?? "");
    else if (arg === "--manifest") options.manifest = path.resolve(argv[(index += 1)] ?? "");
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.manifest) {
    console.log("usage: node scripts/author_behavior_offline_generate.mjs --manifest <generation.json> --offline [--root <repo>]");
    return options.help ? 0 : 64;
  }
  if (!options.offline) {
    console.error("仅支持显式 --offline 确定性自检；真实模型校准执行器尚未接线，不会默认调用模型。");
    return 65;
  }

  const manifest = JSON.parse(fs.readFileSync(options.manifest, "utf8"));
  const candidatePath = path.resolve(options.root, manifest.output?.candidate_uri ?? "");
  const evidenceRoot = path.join(options.root, "artifacts", "author-behavior");
  const relative = path.relative(evidenceRoot, candidatePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    console.error(`candidate_uri 必须位于 artifacts/author-behavior/ 内: ${candidatePath}`);
    return 66;
  }

  let corpus;
  try {
    corpus = loadAuthorBehaviorCorpus(options.root);
  } catch (error) {
    if (error instanceof AuthorBehaviorError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  const personas = loadPersonaSidecar(options.root).personas;
  return generateBatch(manifest, {
    corpus,
    personas,
    executeCell: createOfflineExecutor(),
  }).then((result) => {
    const written = writeGenerationArtifacts(path.dirname(candidatePath), result);
    console.log(JSON.stringify({
      ok: result.manifest.output.failure_count === 0,
      status: result.manifest.output.status,
      candidate_count: result.manifest.output.candidate_count,
      call_count: result.manifest.output.call_count,
      failure_count: result.manifest.output.failure_count,
      declared: result.pack.coverage.declared,
      persona_count: result.pack.coverage.personas.length,
      manifest: written.manifestPath,
      candidates: written.candidatesPath,
    }, null, 2));
    return result.manifest.output.failure_count === 0 ? 0 : 1;
  });
}

try {
  process.exit(await main());
} catch (error) {
  console.error(error?.stack ?? error);
  process.exit(1);
}
