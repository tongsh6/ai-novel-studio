#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVIDER="lmstudio"
ARTIFACT_DIR="$PROJECT_ROOT/artifacts/slice-verify/e2e-01-full-chain"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/e2e_01_full_chain_check.sh
  bash scripts/e2e_01_full_chain_check.sh --provider lmstudio
  bash scripts/e2e_01_full_chain_check.sh --provider slice_verify
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

node --input-type=module - "$PROJECT_ROOT" "$ARTIFACT_DIR" "$PROVIDER" "$COMMANDS_TSV" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const [projectRoot, artifactDir, provider, commandsTsv] = process.argv.slice(2);

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relPath), "utf8"));
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

function collectAssertions(summary) {
  const assertions = summary?.behavior?.assertions ?? summary?.assertions ?? [];
  return Array.isArray(assertions) ? assertions : [];
}

const requiredArtifacts = [
  {
    scenario_ids: ["E1", "E12"],
    rel_path: "artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio/summary.json",
    slice_id: "au01-ordinary-chat-two-turn-roundtrip",
    provider: "lmstudio",
    assertions: ["lmstudio_form_frame_called_per_turn"],
  },
  {
    scenario_ids: ["E2"],
    rel_path: "artifacts/slice-verify/au02-natural-exploration-no-slot-form-tauri-lmstudio/summary.json",
    slice_id: "au02-natural-exploration-no-slot-form",
    provider: "lmstudio",
    assertions: [
      "natural_assistant_reply_visible",
      "candidate_panel_rendered_from_turn_result",
      "lmstudio_form_frame_called_for_source_candidate_turn",
    ],
  },
  {
    scenario_ids: ["E3", "E12"],
    rel_path: "artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json",
    slice_id: "au03-current-work-context-ssot",
    provider: "lmstudio",
    assertions: [
      "context_assembler_attached_current_work_snapshot",
      "historical_session_transcript_did_not_replace_current_work_facts",
    ],
  },
  {
    scenario_ids: ["E4"],
    rel_path: "artifacts/slice-verify/e2e-01-downgrade-real-page-tauri-lmstudio/summary.json",
    slice_id: "e2e-01-downgrade-real-page",
    provider: "lmstudio",
    assertions: [
      "orchestrator_downgraded_multi_step_plan_at_action_scope",
      "turn_result_reported_execution_blocked",
      "no_toolbox_execute_event",
      "no_author_action_sent",
      "downgrade_badge_visible_without_generation_badge",
      "lmstudio_frame_and_micro_plan_called_for_downgrade_turn",
    ],
  },
  {
    scenario_ids: ["E5"],
    rel_path: "artifacts/slice-verify/au04-confirm-before-execute-tauri-lmstudio/summary.json",
    slice_id: "au04-confirm-before-execute",
    provider: "lmstudio",
    assertions: [
      "no_tool_call_or_production_write_before_confirm",
      "re_gate_allows_and_dispatches_prose_writing_same_turn",
    ],
  },
  {
    scenario_ids: ["E6"],
    rel_path: "artifacts/slice-verify/e2e-01-readonly-tool-trace-tauri-lmstudio/summary.json",
    slice_id: "e2e-01-readonly-tool-trace",
    provider: "lmstudio",
    assertions: [
      "orchestrator_allowed_low_risk_character_roster_tool",
      "toolbox_executed_character_roster_successfully",
      "turn_result_reported_tool_called_without_adoption_or_production_write",
      "trace_repository_list_by_turn_returned_tool_trace_ref",
      "lmstudio_frame_and_micro_plan_called_for_readonly_tool_turn",
    ],
  },
  {
    scenario_ids: ["E9"],
    rel_path: "artifacts/slice-verify/e2e-01-replay-report-tauri-lmstudio/summary.json",
    slice_id: "e2e-01-replay-report",
    provider: "lmstudio",
    assertions: [
      "replay_report_built_from_persisted_trace_without_provider_call",
      "replay_report_answered_vs06_six_required_questions",
      "replay_report_chain_includes_frame_plan_decision_tool_and_turn_result",
      "lmstudio_frame_and_micro_plan_called_for_readonly_tool_turn",
    ],
  },
  {
    scenario_ids: ["E7"],
    rel_path: "artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json",
    slice_id: "p1-chapter-draft-generation",
    provider: "slice_verify",
    assertions: [
      "prose_fragment_remained_pending_for_author_adoption",
      "unadopted_prose_fragment_did_not_materialize_reading_projection",
    ],
  },
  {
    scenario_ids: ["E7"],
    rel_path: "artifacts/slice-verify/p1-chapter-adoption-reading-tauri-lmstudio/summary.json",
    slice_id: "p1-chapter-adoption-reading",
    provider: "lmstudio",
    assertions: [
      "accept_author_action_routed_through_adoption_boundary",
      "adopted_prose_materialized_reading_projection",
      "reading_mode_loaded_toc_and_chapter_content_from_channel",
    ],
  },
  {
    scenario_ids: ["E11"],
    rel_path: "artifacts/slice-verify/au01-garbage-json-recovery-tauri/summary.json",
    slice_id: "au01-garbage-json-recovery",
    provider: "slice_verify",
    assertions: [
      "malformed_provider_json_rendered_friendly_fallback",
      "channel_remained_connected_after_malformed_json",
    ],
  },
  {
    scenario_ids: ["E11"],
    rel_path: "artifacts/slice-verify/au10-workbench-recovery-provider-timeout-tauri/summary.json",
    slice_id: "au10-workbench-recovery-provider-timeout",
    provider: "slice_verify",
    assertions: [
      "provider_timeout_returned_timeout_fallback_turn_result",
      "following_turn_completed_after_provider_timeout_recovery",
    ],
  },
];

const artifactChecks = requiredArtifacts.map((check) => {
  const result = {
    ...check,
    ok: false,
    errors: [],
  };

  try {
    const summary = readJson(check.rel_path);
    const assertions = collectAssertions(summary);

    result.observed = {
      slice_id: summary.slice_id,
      provider: summary.provider,
      lmstudio_request_count: summary.lmstudio?.request_count ?? null,
      assertions,
    };

    if (summary.slice_id !== check.slice_id) {
      result.errors.push(`expected slice_id ${check.slice_id}, got ${summary.slice_id}`);
    }
    if (summary.provider !== check.provider) {
      result.errors.push(`expected provider ${check.provider}, got ${summary.provider}`);
    }
    for (const assertion of check.assertions) {
      if (!assertions.includes(assertion)) {
        result.errors.push(`missing assertion ${assertion}`);
      }
    }
    if (check.provider === "lmstudio" && Number(summary.lmstudio?.request_count ?? 0) < 1) {
      result.errors.push("expected lmstudio.request_count >= 1");
    }

    result.ok = result.errors.length === 0;
  } catch (error) {
    result.errors.push(error.message);
  }

  return result;
});

const commands = readCommands(commandsTsv);
const skippedCommands = provider === "lmstudio"
  ? []
  : [
      {
        name: "mix-real-lmstudio",
        status: "skipped",
        reason: "provider is slice_verify",
      },
    ];

const scenarioMatrix = [
  {
    id: "E1",
    name: "普通聊天全链路",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio/summary.json",
      "mix-e2e-integration",
    ],
  },
  {
    id: "E2",
    name: "探索式创作全链路",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/au02-natural-exploration-no-slot-form-tauri-lmstudio/summary.json",
      "mix-e2e-integration",
    ],
  },
  {
    id: "E3",
    name: "上下文组装",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json",
      "mix-application-real-loop",
    ],
  },
  {
    id: "E4",
    name: "Provider 策略降级",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/e2e-01-downgrade-real-page-tauri-lmstudio/summary.json",
      "mix-e2e-integration",
    ],
  },
  {
    id: "E5",
    name: "确认式执行",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/au04-confirm-before-execute-tauri-lmstudio/summary.json",
      "mix-e2e-integration",
    ],
  },
  {
    id: "E6",
    name: "Tool dispatch 与 Trace",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/e2e-01-readonly-tool-trace-tauri-lmstudio/summary.json",
      "mix-channel-replay-trace",
      "mix-application-real-loop",
    ],
  },
  {
    id: "E7",
    name: "Artifact adoption",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json",
      "artifacts/slice-verify/p1-chapter-adoption-reading-tauri-lmstudio/summary.json",
    ],
  },
  {
    id: "E8",
    name: "幂等与安全",
    status: "部分实现",
    evidence: ["mix-channel-replay-trace"],
  },
  {
    id: "E9",
    name: "ReplayReport",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/e2e-01-replay-report-tauri-lmstudio/summary.json",
      "mix-channel-replay-trace",
    ],
  },
  {
    id: "E10",
    name: "Persistence roundtrip",
    status: "已测试",
    evidence: ["mix-e2e-integration", "mix-application-real-loop"],
  },
  {
    id: "E11",
    name: "异常恢复",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/au01-garbage-json-recovery-tauri/summary.json",
      "artifacts/slice-verify/au10-workbench-recovery-provider-timeout-tauri/summary.json",
    ],
  },
  {
    id: "E12",
    name: "前端一致性",
    status: "已验收",
    evidence: [
      "artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio/summary.json",
      "artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json",
    ],
  },
  {
    id: "E13",
    name: "无 Stub 完成路径",
    status: "已测试",
    evidence: ["mix-e2e-integration", "mix-real-lmstudio"],
  },
];

const counts = scenarioMatrix.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] ?? 0) + 1;
  return acc;
}, {});

const failedCommands = commands.filter((command) => command.exit_code !== 0);
const failedArtifacts = artifactChecks.filter((check) => !check.ok);
const status = failedCommands.length === 0 && failedArtifacts.length === 0 ? "passed" : "failed";

const summary = {
  scenario_id: "e2e-01-full-chain",
  title: "E2E-01 端到端全链路聚合验收",
  generated_at: new Date().toISOString(),
  provider,
  status,
  artifact_dir: path.relative(projectRoot, artifactDir),
  scenario_status_counts: counts,
  e2e_scenarios: scenarioMatrix,
  commands,
  skipped_commands: skippedCommands,
  artifact_checks: artifactChecks,
  assertions: [
    "aggregate_runner_executed",
    "local_e2e_and_replay_tests_executed",
    ...(provider === "lmstudio" ? ["real_lmstudio_tests_executed"] : []),
    "required_true_page_tauri_artifacts_checked",
    "no_product_acceptance_logic_added",
  ],
  remaining_gaps: [
    {
      scenario_id: "E8",
      status: "部分实现",
      gap: "invented / forged source negative 属恶意 Channel payload，正常 UI 不提供构造入口；继续由 Channel security regression 覆盖。",
      priority: "P2",
    },
  ],
};

fs.writeFileSync(
  path.join(artifactDir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

if (status !== "passed") {
  console.error("[e2e-01] aggregate check failed");
  for (const command of failedCommands) {
    console.error(`- command failed: ${command.name}, inspect ${command.log}`);
  }
  for (const check of failedArtifacts) {
    console.error(`- artifact check failed: ${check.rel_path}: ${check.errors.join("; ")}`);
  }
  process.exit(1);
}

console.log(`[e2e-01] aggregate check passed: ${path.relative(projectRoot, path.join(artifactDir, "summary.json"))}`);
NODE
