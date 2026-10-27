#!/usr/bin/env node
// B41 CP1：质量 manifest 统一 CLI。
//
// quality_manifest_check.sh（门禁）与 quality_accept.sh / e2e 聚合器（执行与报告）
// 都通过本 CLI 读取 scenarios.yml，避免第二份 registry 解析（正则或手工 YAML）。
//
// 用法：
//   node scripts/lib/quality/manifest_cli.mjs validate [--root <dir>]
//   node scripts/lib/quality/manifest_cli.mjs list [--root <dir>]
//   node scripts/lib/quality/manifest_cli.mjs ids-by-tier <tier> [surface] [--root <dir>]
//   node scripts/lib/quality/manifest_cli.mjs field <scenario-id> <field> [--root <dir>]
//   node scripts/lib/quality/manifest_cli.mjs registry-status <scenario-id> [--root <dir>]
//
// 退出码：0 成功；1 校验失败/环境错误；64 用法错误；66 未知 scenario（field）。

import {
  DEFAULT_PROJECT_ROOT,
  TIERS,
  loadRegistryScenarios,
  registryStatus,
  scenarioById,
  scenarioRunner,
  scenarioStatus,
  validate,
} from "./manifest.mjs";

function usage() {
  console.error(
    [
      "用法：node scripts/lib/quality/manifest_cli.mjs <command> [args] [--root <dir>]",
      "  validate",
      "  list",
      "  ids-by-tier <tier> [surface]",
      "  field <scenario-id> <field>",
      "  registry-status <scenario-id>",
    ].join("\n"),
  );
}

function splitArgs(argv) {
  const args = [];
  let root = DEFAULT_PROJECT_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") {
      root = argv[index + 1];
      if (!root) throw new Error("--root 需要目录参数");
      index += 1;
    } else {
      args.push(token);
    }
  }
  return { args, root };
}

function main() {
  let parsed;
  try {
    parsed = splitArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    return 64;
  }
  const { args, root } = parsed;
  const [command, ...rest] = args;
  if (!command) {
    usage();
    return 64;
  }

  try {
    switch (command) {
      case "validate": {
        const { project, errors, warnings } = validate(root);
        for (const warning of warnings) console.warn(`[quality-manifest-check] WARN ${warning}`);
        if (errors.length > 0) {
          console.error("[quality-manifest-check] failed");
          for (const error of errors) console.error(`- ${error}`);
          return 1;
        }
        console.log(
          `[quality-manifest-check] passed（${project.scenarios.length} scenarios / ` +
            `${project.drafts.length} drafts / ${project.files.size} manifests；` +
            `yaml=${project.pyyaml}）`,
        );
        return 0;
      }
      case "list": {
        const project = loadRegistryScenarios(root);
        console.log("id\ttier\tstatus\tsurface\trunner\tdriver\tentrypoint");
        for (const scenario of project.scenarios) {
          console.log(
            [
              scenario.id,
              scenario.tier,
              scenarioStatus(scenario),
              scenario.surface,
              scenarioRunner(scenario),
              scenario.driver,
              scenario.entrypoint,
            ].join("\t"),
          );
        }
        return 0;
      }
      case "ids-by-tier": {
        const [tier, surface] = rest;
        if (!tier) {
          usage();
          return 64;
        }
        if (!TIERS.includes(tier)) {
          console.error(`未知 tier：${tier}（允许：${TIERS.join(", ")}）`);
          return 64;
        }
        const project = loadRegistryScenarios(root);
        const ids = project.scenarios
          .filter((scenario) => scenario.tier === tier)
          .filter((scenario) => !surface || scenario.surface === surface)
          .filter((scenario) => scenarioStatus(scenario) === "active")
          .map((scenario) => scenario.id);
        for (const id of ids) console.log(id);
        return 0;
      }
      case "field": {
        const [id, field] = rest;
        if (!id || !field) {
          usage();
          return 64;
        }
        const project = loadRegistryScenarios(root);
        const scenario = scenarioById(project, id);
        if (!scenario) {
          console.error(`未知 scenario id：${id}`);
          return 66;
        }
        const value = field === "runner" ? scenarioRunner(scenario) : scenario[field];
        console.log(value === undefined || value === null ? "" : String(value));
        return 0;
      }
      case "registry-status": {
        const [id] = rest;
        if (!id) {
          usage();
          return 64;
        }
        const project = loadRegistryScenarios(root);
        console.log(JSON.stringify(registryStatus(project, id)));
        return 0;
      }
      default:
        usage();
        return 64;
    }
  } catch (error) {
    console.error(`[quality-manifest] ${error.message ?? error}`);
    return 1;
  }
}

process.exit(main());
