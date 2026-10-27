#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVIDER="lmstudio"
ARTIFACT_DIR="$PROJECT_ROOT/artifacts/slice-verify/e2e-01-full-chain"
# B41 CP3：证据判定必须消费 CP1 registry 与 CP4 verdict 的单一查询实现，不再用
# 正则/旧 summary 存在性判断。两个 CLI 的默认落点由 B41 CP1/CP4 冻结；下面两个
# 环境变量只用于 fixture 隔离回归（集成前/离线复跑），不是门禁语义开关。
MANIFEST_CLI="$PROJECT_ROOT/scripts/lib/quality/manifest_cli.mjs"
VERDICT_CLI="$PROJECT_ROOT/scripts/lib/quality/verdict_cli.mjs"
GIT_HEAD="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || true)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/e2e_01_full_chain_check.sh
  bash scripts/e2e_01_full_chain_check.sh --provider lmstudio
  bash scripts/e2e_01_full_chain_check.sh --provider slice_verify

聚合 verdict 是聚合专有 quality-aggregate/v1（不是 CP4 quality-verdict/v2）：
blocked 是 manifest 状态不是执行结果，批内 blocked 场景记为 skipped，但聚合 summary
必须显式列出 blocked_scenarios / stale_scenarios / reason；场景行仍保留 blocked 内部状态。

Exit codes（B41 CP3 + CP0 §6.2 item 8 批量语义）:
  0   pass：无 fail/stale/缺失，且至少 1 个场景证据 current（批内 blocked/skipped 不拉低；
            summary 必须列出 blocked_scenarios）
  1   fail：命令失败或场景证据内容断言/provider 不匹配（有 fail 优先 1）
  65  skipped(blocked)：整批场景全部 registry blocked、没有任何验收执行（如 E4 未重锚）
  66  usage/config：registry/verdict CLI 缺失或查询失败
  67  evidence_missing：存在 stale/缺失证据（旧 summary.json 存在不等于 PASS）
  69  not_run/skipped：没有任何场景执行或没有场景 pass（非 blocked 的批量跳过）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider)
      PROVIDER="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unexpected argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

case "$PROVIDER" in
  lmstudio|slice_verify)
    ;;
  *)
    echo "[e2e-01] provider must be lmstudio|slice_verify, got $PROVIDER" >&2
    exit 64
    ;;
esac

mkdir -p "$ARTIFACT_DIR"
COMMANDS_TSV="$ARTIFACT_DIR/commands.tsv"
: > "$COMMANDS_TSV"

run_command() {
  local name="$1"
  shift
  local log_rel="artifacts/slice-verify/e2e-01-full-chain/${name}.log"
  local log_abs="$PROJECT_ROOT/$log_rel"
  local command

  printf -v command '%q ' "$@"
  echo "[e2e-01] running $name: $command"

  set +e
  (
    cd "$PROJECT_ROOT"
    "$@"
  ) >"$log_abs" 2>&1
  local exit_code=$?
  set -e

  printf '%s\t%s\t%s\t%s\n' "$name" "$exit_code" "$log_rel" "$command" >>"$COMMANDS_TSV"

  if [[ "$exit_code" -ne 0 ]]; then
    echo "[e2e-01] failed $name, inspect $log_rel" >&2
  fi
}

run_command \
  mix-e2e-integration \
  mix test --include integration apps/novel_e2e/test/novel_e2e/v3_full_chain_test.exs

run_command \
  mix-application-real-loop \
  mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs

run_command \
  mix-channel-replay-trace \
  mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs \
    apps/novel_application/test/novel_application/replay_service_test.exs \
    apps/novel_persistence/test/novel_persistence/trace_repository_test.exs

if [[ "$PROVIDER" == "lmstudio" ]]; then
  run_command \
    mix-real-lmstudio \
    mix test --include real_llm apps/novel_application/test/novel_application/planner_real_llm_test.exs
fi

node --input-type=module - \
  "$PROJECT_ROOT" "$ARTIFACT_DIR" "$PROVIDER" "$COMMANDS_TSV" \
  "$GIT_HEAD" "$MANIFEST_CLI" "$VERDICT_CLI" "$STARTED_AT" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [
  projectRoot,
  artifactDir,
  provider,
  commandsTsv,
  gitHead,
  manifestCli,
  verdictCli,
  startedAt,
] = process.argv.slice(2);

const generatedAt = new Date().toISOString();
const statusLib = await import(
  pathToFileURL(path.join(projectRoot, "scripts/lib/quality/e2e_status.mjs")).href
);

function relPath(absPath) {
  return path.relative(projectRoot, absPath);
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readCommands(tsvPath) {
  if (!fs.existsSync(tsvPath)) return [];

  return fs
    .readFileSync(tsvPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, exitCode, log, command] = line.split("\t");
      return {
        name,
        exit_code: Number(exitCode),
        log,
        command,
      };
    });
}

// B41 CP3：E1-E13 只声明「证据要求」（哪些场景 manifest / artifact / 命令），
// 状态一律由 e2e_status.mjs 按真实证据计算；这里不出现任何「已验收/已测试」。
const artifactSpecs = [
  {
    key: "au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio",
    rel_path:
      "artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio/summary.json",
    expectations: {
      slice_ids: ["au01-ordinary-chat-two-turn-roundtrip"],
      provider: "lmstudio",
      surface: "tauri",
      assertions: ["lmstudio_form_frame_called_per_turn"],
    },
  },
  {
    key: "au02-natural-exploration-no-slot-form-tauri-lmstudio",
    rel_path:
      "artifacts/slice-verify/au02-natural-exploration-no-slot-form-tauri-lmstudio/summary.json",
    expectations: {
      slice_ids: ["au02-natural-exploration-no-slot-form"],
      provider: "lmstudio",
      surface: "tauri",
      assertions: [
        "natural_assistant_reply_visible",
        "candidate_panel_rendered_from_turn_result",
        "lmstudio_form_frame_called_for_source_candidate_turn",
      ],
    },
  },
  {
    key: "au03-current-work-context-ssot-tauri-lmstudio",
    rel_path:
      "artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json",
    expectations: {
      slice_ids: ["au03-current-work-context-ssot"],
      provider: "lmstudio",
      surface: "tauri",
      assertions: [
        "context_assembler_attached_current_work_snapshot",
        "historical_session_transcript_did_not_replace_current_work_facts",
      ],
    },
  },
  {
    key: "e2e-01-downgrade-real-page-tauri-lmstudio",
    rel_path:
      "artifacts/slice-verify/e2e-01-downgrade-real-page-tauri-lmstudio/summary.json",
    expectations: {
      slice_ids: ["e2e-01-downgrade-real-page"],
      provider: "lmstudio",
      surface: "tauri",
      assertions: [
        "orchestrator_downgraded_multi_step_plan_at_action_scope",
        "turn_result_reported_execution_blocked",
        "no_toolbox_execute_event",
        "no_author_action_sent",
        "downgrade_badge_visible_without_generation_badge",
        "lmstudio_frame_and_micro_plan_called_for_downgrade_turn",
      ],
    },
  },
  {
    key: "au04-confirm-before-execute-tauri-lmstudio",
    rel_path:
      "artifacts/slice-verify/au04-confirm-before-execute-tauri-lmstudio/summary.json",
    expectations: {
      slice_ids: ["au04-confirm-before-execute"],
      provider: "lmstudio",
      surface: "tauri",
      assertions: [
        "no_tool_call_or_production_write_before_confirm",
        "re_gate_allows_and_dispatches_prose_writing_same_turn",
      ],
    },
  },
  {
    key: "e2e-01-readonly-tool-trace-tauri-lmstudio",
    rel_path:
      "artifacts/slice-verify/e2e-01-readonly-tool-trace-tauri-lmstudio/summary.json",
    expectations: {
      slice_ids: ["e2e-01-readonly-tool-trace"],
      provider: "lmstudio",
      surface: "tauri",
      assertions: [
        "orchestrator_allowed_low_risk_character_roster_tool",
        "toolbox_executed_character_roster_successfully",
        "turn_result_reported_tool_called_without_adoption_or_production_write",
        "trace_repository_list_by_turn_returned_tool_trace_ref",
        "lmstudio_frame_and_micro_plan_called_for_readonly_tool_turn",
      ],
    },
  },
  {
    key: "e2e-01-replay-report-tauri-lmstudio",
    rel_path:
      "artifacts/slice-verify/e2e-01-replay-report-tauri-lmstudio/summary.json",
    expectations: {
      slice_ids: ["e2e-01-replay-report"],
      provider: "lmstudio",
      surface: "tauri",
      assertions: [
        "replay_report_built_from_persisted_trace_without_provider_call",
        "replay_report_answered_vs06_six_required_questions",
        "replay_report_chain_includes_frame_plan_decision_tool_and_turn_result",
        "lmstudio_frame_and_micro_plan_called_for_readonly_tool_turn",
      ],
    },
  },
  {
    key: "p1-chapter-draft-generation-tauri",
    rel_path: "artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json",
    expectations: {
      slice_ids: ["p1-chapter-draft-generation"],
      provider: "slice_verify",
      surface: "tauri",
      assertions: [
        "prose_fragment_remained_pending_for_author_adoption",
        "unadopted_prose_fragment_did_not_materialize_reading_projection",
      ],
    },
  },
  {
    key: "p1-chapter-adoption-reading-tauri-lmstudio",
    rel_path:
      "artifacts/slice-verify/p1-chapter-adoption-reading-tauri-lmstudio/summary.json",
    expectations: {
      slice_ids: ["p1-chapter-adoption-reading"],
      provider: "lmstudio",
      surface: "tauri",
      assertions: [
        "accept_author_action_routed_through_adoption_boundary",
        "adopted_prose_materialized_reading_projection",
        "reading_mode_loaded_toc_and_chapter_content_from_channel",
      ],
    },
  },
  {
    key: "e2e-01-channel-action-security-tauri",
    rel_path:
      "artifacts/slice-verify/e2e-01-channel-action-security-tauri/summary.json",
    expectations: {
      slice_ids: ["e2e-01-channel-action-security"],
      provider: "slice_verify",
      surface: "tauri",
      assertions: [
        "client_supplied_source_turn_result_did_not_authorize_invented_action",
        "stale_source_turn_ref_rejected_after_current_turn_advanced",
        "forged_author_actions_emitted_channel_author_action_error",
        "forged_author_actions_did_not_broadcast_action_result",
        "forged_author_actions_did_not_log_author_action_done",
      ],
    },
  },
  {
    key: "au01-garbage-json-recovery-tauri",
    rel_path: "artifacts/slice-verify/au01-garbage-json-recovery-tauri/summary.json",
    expectations: {
      slice_ids: ["au01-garbage-json-recovery"],
      provider: "slice_verify",
      surface: "tauri",
      assertions: [
        "malformed_provider_json_rendered_friendly_fallback",
        "channel_remained_connected_after_malformed_json",
      ],
    },
  },
  {
    key: "au10-workbench-recovery-provider-timeout-tauri",
    rel_path:
      "artifacts/slice-verify/au10-workbench-recovery-provider-timeout-tauri/summary.json",
    expectations: {
      slice_ids: ["au10-workbench-recovery-provider-timeout"],
      provider: "slice_verify",
      surface: "tauri",
      assertions: [
        "provider_timeout_returned_timeout_fallback_turn_result",
        "following_turn_completed_after_provider_timeout_recovery",
      ],
    },
  },
];

const scenarios = [
  {
    id: "E1",
    name: "普通聊天全链路",
    slices: ["au01-ordinary-chat-two-turn-roundtrip"],
    artifacts: ["au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio"],
    surface: "tauri",
    commands: ["mix-e2e-integration"],
  },
  {
    id: "E2",
    name: "探索式创作全链路",
    slices: ["au02-natural-exploration-no-slot-form"],
    artifacts: ["au02-natural-exploration-no-slot-form-tauri-lmstudio"],
    surface: "tauri",
    commands: ["mix-e2e-integration"],
  },
  {
    id: "E3",
    name: "上下文组装",
    slices: ["au03-current-work-context-ssot"],
    artifacts: ["au03-current-work-context-ssot-tauri-lmstudio"],
    surface: "tauri",
    commands: ["mix-application-real-loop"],
  },
  {
    id: "E4",
    name: "Provider 策略降级",
    slices: ["e2e-01-downgrade-real-page"],
    artifacts: ["e2e-01-downgrade-real-page-tauri-lmstudio"],
    surface: "tauri",
    commands: ["mix-e2e-integration"],
  },
  {
    id: "E5",
    name: "确认式执行",
    slices: ["au04-confirm-before-execute"],
    artifacts: ["au04-confirm-before-execute-tauri-lmstudio"],
    surface: "tauri",
    commands: ["mix-e2e-integration"],
  },
  {
    id: "E6",
    name: "Tool dispatch 与 Trace",
    slices: ["e2e-01-readonly-tool-trace"],
    artifacts: ["e2e-01-readonly-tool-trace-tauri-lmstudio"],
    surface: "tauri",
    commands: ["mix-channel-replay-trace", "mix-application-real-loop"],
  },
  {
    id: "E7",
    name: "Artifact adoption",
    slices: ["p1-chapter-draft-generation", "p1-chapter-adoption-reading"],
    artifacts: [
      "p1-chapter-draft-generation-tauri",
      "p1-chapter-adoption-reading-tauri-lmstudio",
    ],
    surface: "tauri",
    commands: [],
  },
  {
    id: "E8",
    name: "幂等与安全",
    slices: ["e2e-01-channel-action-security"],
    artifacts: ["e2e-01-channel-action-security-tauri"],
    surface: "tauri",
    commands: ["mix-channel-replay-trace"],
  },
  {
    id: "E9",
    name: "ReplayReport",
    slices: ["e2e-01-replay-report"],
    artifacts: ["e2e-01-replay-report-tauri-lmstudio"],
    surface: "tauri",
    commands: ["mix-channel-replay-trace"],
  },
  {
    id: "E10",
    name: "Persistence roundtrip",
    slices: [],
    artifacts: [],
    surface: null,
    commands: ["mix-e2e-integration", "mix-application-real-loop"],
  },
  {
    id: "E11",
    name: "异常恢复",
    slices: ["au01-garbage-json-recovery", "au10-workbench-recovery-provider-timeout"],
    artifacts: [
      "au01-garbage-json-recovery-tauri",
      "au10-workbench-recovery-provider-timeout-tauri",
    ],
    surface: "tauri",
    commands: [],
  },
  {
    id: "E12",
    name: "真实两轮回路",
    slices: ["au01-ordinary-chat-two-turn-roundtrip", "au03-current-work-context-ssot"],
    artifacts: [
      "au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio",
      "au03-current-work-context-ssot-tauri-lmstudio",
    ],
    surface: "tauri",
    commands: [],
  },
  {
    id: "E13",
    name: "Action 来源校验",
    slices: ["e2e-01-channel-action-security"],
    artifacts: ["e2e-01-channel-action-security-tauri"],
    surface: "tauri",
    commands: ["mix-e2e-integration", "mix-real-lmstudio"],
  },
];

function configError(message) {
  console.error(`[e2e-01] config error: ${message}`);
  process.exit(66);
}

for (const [label, cliPath] of [
  ["registry CLI（B41 CP1 manifest_cli.mjs）", manifestCli],
  ["verdict CLI（B41 CP4 verdict_cli.mjs）", verdictCli],
]) {
  if (!fs.existsSync(cliPath)) {
    configError(`${label} 不存在：${relPath(cliPath)}；先完成 B41 CP1/CP4 再运行聚合器`);
  }
}

function runJsonCli(cliPath, args, { allowNonZeroStdout = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, data: JSON.parse(stdout) };
  } catch (error) {
    const stdout = String(error.stdout ?? "").trim();
    if (allowNonZeroStdout && stdout) {
      try {
        return { ok: true, data: JSON.parse(stdout), exit_code: error.status ?? null };
      } catch (parseError) {
        return { ok: false, error: `stdout 不是 JSON：${parseError.message}` };
      }
    }
    const stderr = String(error.stderr ?? "").trim();
    return {
      ok: false,
      error: `exit=${error.status ?? "?"}${stderr ? ` stderr=${stderr.slice(0, 500)}` : ""}`,
    };
  }
}

const registryCache = new Map();
function registryEntry(scenarioId) {
  if (!registryCache.has(scenarioId)) {
    const result = runJsonCli(manifestCli, ["registry-status", scenarioId]);
    registryCache.set(
      scenarioId,
      result.ok
        ? { scenario_id: scenarioId, entry: result.data }
        : { scenario_id: scenarioId, query_error: result.error },
    );
  }
  return registryCache.get(scenarioId);
}

const artifactByKey = new Map(artifactSpecs.map((spec) => [spec.key, spec]));

function fetchArtifact(key) {
  const spec = artifactByKey.get(key);
  if (!spec) throw new Error(`未知 artifact spec: ${key}`);

  const summaryAbs = path.join(projectRoot, spec.rel_path);
  const dirAbs = path.dirname(summaryAbs);
  const verdictAbs = path.join(dirAbs, "verdict.json");
  const summaryExists = fs.existsSync(summaryAbs);
  const found = summaryExists || fs.existsSync(verdictAbs);

  const input = {
    rel_path: spec.rel_path,
    found,
    expectations: spec.expectations,
  };
  if (!found) return input;

  if (summaryExists) {
    try {
      input.summary = readJson(summaryAbs);
    } catch (error) {
      input.summary_read_error = error.message;
    }
  }

  // verdict 读取只走 CP4 单一实现：缺 verdict 时 CLI 自身返回
  // {"status":"evidence_missing","legacy_summary":true,...}，legacy summary
  // 只在携带 git_head/current 标记时才可能 pass。
  const verdictRead = runJsonCli(verdictCli, ["read", dirAbs], { allowNonZeroStdout: true });
  if (!verdictRead.ok) {
    configError(`verdict CLI read ${relPath(dirAbs)} 失败：${verdictRead.error}`);
  }
  input.verdict = verdictRead.data;
  input.legacy_summary = verdictRead.data?.legacy_summary === true;
  return input;
}

const commands = readCommands(commandsTsv);
const skippedCommands =
  provider === "lmstudio"
    ? []
    : [
        {
          name: "mix-real-lmstudio",
          status: "skipped",
          reason: "provider is slice_verify",
        },
      ];

const registryFailures = scenarios
  .flatMap((scenario) => scenario.slices)
  .map(registryEntry)
  .filter((entry) => entry.query_error);
if (registryFailures.length > 0) {
  configError(
    `registry CLI 查询失败：${registryFailures
      .map((entry) => `${entry.scenario_id}: ${entry.query_error}`)
      .join("; ")}`,
  );
}

function commandInputs(names) {
  return names.map((name) => {
    const executed = commands.find((command) => command.name === name);
    if (executed) return executed;
    const skipped = skippedCommands.find((command) => command.name === name);
    if (skipped) return { name, skipped_reason: skipped.reason };
    return { name };
  });
}

const scenarioResults = scenarios.map((scenario) =>
  statusLib.evaluateScenario({
    id: scenario.id,
    name: scenario.name,
    registry_entries: scenario.slices.map(registryEntry),
    artifacts: scenario.artifacts.map(fetchArtifact),
    commands: commandInputs(scenario.commands),
    current_head: gitHead || null,
    expected_surface: scenario.surface,
  }),
);

const summary = statusLib.buildAggregateSummary({
  scenarios: scenarioResults,
  commands,
  skipped_commands: skippedCommands,
  provider,
  git_head: gitHead || null,
  generated_at: generatedAt,
  started_at: startedAt,
  artifact_dir: relPath(artifactDir),
});

const summaryPath = path.join(artifactDir, "summary.json");
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

const exitCode = summary.exit_code;
const counts = summary.scenario_status_counts;
console.log(
  `[e2e-01] aggregate verdict=${summary.verdict.status} exit=${exitCode} ` +
    `scenarios={${Object.entries(counts)
      .map(([status, count]) => `${status}:${count}`)
      .join(",")}}`,
);
console.log(`[e2e-01] summary=${relPath(summaryPath)}`);

for (const scenario of scenarioResults) {
  console.log(`[e2e-01]   ${scenario.id} ${scenario.status}: ${scenario.reason}`);
}

if (exitCode === 1) {
  console.error("[e2e-01] aggregate verdict fail");
  for (const command of commands.filter((item) => item.exit_code !== 0)) {
    console.error(`- command failed: ${command.name}, inspect ${command.log}`);
  }
  for (const scenario of scenarioResults.filter((item) => item.status === "fail")) {
    console.error(`- scenario failed: ${scenario.id}: ${scenario.reason}`);
  }
} else if (exitCode === 65 || exitCode === 69) {
  console.error(
    `[e2e-01] aggregate verdict ${summary.verdict.status}：没有可判定的通过证据`,
  );
  for (const scenario of scenarioResults.filter((item) =>
    ["blocked", "not_run"].includes(item.status),
  )) {
    console.error(
      `- ${scenario.status}: ${scenario.id}: ${scenario.blocked_reason ?? scenario.reason}`,
    );
  }
} else if (exitCode === 67) {
  console.error("[e2e-01] aggregate verdict evidence_missing：没有当前 HEAD 可判定的完整证据");
  for (const scenario of scenarioResults.filter((item) =>
    ["stale", "evidence_missing"].includes(item.status),
  )) {
    console.error(`- ${scenario.status}: ${scenario.id}: ${scenario.reason}`);
  }
  for (const scenario of scenarioResults.filter((item) => item.status === "blocked")) {
    console.error(
      `- blocked（按 batches 语义 skipped，不冒充通过）: ${scenario.id}: ${scenario.blocked_reason ?? scenario.reason}`,
    );
  }
}

process.exit(exitCode);
NODE
