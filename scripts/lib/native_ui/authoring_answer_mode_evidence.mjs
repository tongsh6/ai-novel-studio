// 回答模式（等待即回答）正式 gate 证据与判据 D1–D5。
//
// 场景：确定性 slice_verify + ask_author fixture：
// - 真实请求「第01章结尾有两个方向，先让我选择。」→ 产品进入 awaiting_author（问题卡/回答提示条）；
// - 真实点击选项「保留悬念」→ author_choice 回答 → 同一 run 继续（run_resumed + plan_adjusted）；
// - 验证同 run 第二作者回合、run 继续执行、全类别无技术词、消息流问题记录只读、资源清理。
//
// 产出：native-b71-checks.json + summary.json + verdict.json（quality-verdict/v2，与既有 72 个同格式）。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  all,
  assertCommonEvidence,
  writeNativeFrames,
  withDb,
} from "./scenario_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import { scanAuthorVisibleFiles } from "./authoring_auto_maintenance_evidence.mjs";

export const ANSWER_MODE_SCHEMA = "b71-answer-mode-checks/v1";
export const ANSWER_MODE_VERDICT_SCHEMA = "quality-verdict/v2";
export const ANSWER_MODE_CHECKPOINTS = Object.freeze(["start", "final"]);

const list = (value) => (Array.isArray(value) ? value : []);

function parseTranscript(text) {
  try {
    const parsed = JSON.parse(text);
    return list(parsed?.transcript?.messages);
  } catch {
    return [];
  }
}

function readAnswerModeDbFacts(dir) {
  return withDb(dir, (db) => {
    const rows = (table) => {
      try {
        return all(db, `SELECT * FROM ${table} ORDER BY inserted_at, id`);
      } catch {
        try {
          return all(db, `SELECT * FROM ${table}`);
        } catch {
          return [];
        }
      }
    };
    return {
      agent_runs: rows("agent_runs"),
      agent_events: rows("agent_events"),
      provider_runs: rows("provider_runs"),
      interactions: rows("interactions"),
      // B81 CP1 后 canonical 创作历史在会话级消息表；answer-mode 判据只读当前批次。
      authoring_session_messages: rows("authoring_session_messages"),
    };
  });
}

function readLogs(dir) {
  const logDir = path.join(dir, "llm-calls");
  if (!fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) =>
      fs
        .readFileSync(path.join(logDir, file), "utf8")
        .split("\n")
        .filter((line) => line.includes("{"))
        .map((line) => {
          try {
            return JSON.parse(line.slice(line.indexOf("{")));
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
}

function countLlmCalls(dir) {
  return readLogs(dir).filter((record) => record?.response?.status === 200).length;
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
  return {
    app_processes: countApp(),
    ports: { backend_4657: port(4657), transport_4661: port(4661) },
    llm_calls: countLlmCalls(dir),
  };
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function evaluateAnswerMode({ dbFacts, driverLog = null, cleanup = null, runtime = null, scan, llmCalls = 0, dir = null }) {
  const runs = list(dbFacts?.agent_runs);
  const events = list(dbFacts?.agent_events);
  const providerRuns = list(dbFacts?.provider_runs);
  // CP1/B81：agent_runs.authoring_transcript 已退役，canonical 消息在会话级消息表。
  const messages = list(dbFacts?.authoring_session_messages)
    .map((row) => (typeof row?.message === "string" ? JSON.parse(row.message) : row?.message))
    .filter((message) => message && typeof message === "object");
  const userTurns = messages.filter((message) => message?.role === "user").length;
  const eventTypes = events.map((event) => String(event?.event_type ?? ""));
  const runCount = runs.length;
  const hasResumed = eventTypes.includes("run_resumed");
  const hasPlanAdjusted = eventTypes.includes("plan_adjusted");
  const multiTurn = driverLog?.answer_mode?.multi_turn ?? driverLog?.multi_turn ?? null;

  // D1：同一 run 出现第二作者回合（user_turns=2 + run_resumed/plan_adjusted + 无新 run）。
  const d1 = {
    ok: userTurns === 2 && runCount === 1 && hasResumed && hasPlanAdjusted,
    reason: null,
    detail: {
      user_turns: userTurns,
      run_count: runCount,
      run_resumed: hasResumed,
      plan_adjusted: hasPlanAdjusted,
      run_statuses: runs.map((run) => String(run?.status ?? "")),
    },
  };
  if (!d1.ok) d1.reason = "same_run_second_author_turn_not_observed";

  // D2：run 继续执行（回答后 provider 调用增加 + driver 观测 resumed）。
  const resumedAfterAnswer = multiTurn?.after_steer?.resumed === true;
  const d2 = {
    ok: providerRuns.length >= 2 && llmCalls >= 2 && resumedAfterAnswer,
    reason: null,
    detail: {
      provider_runs: providerRuns.length,
      llm_calls: llmCalls,
      after_steer: multiTurn?.after_steer ?? null,
    },
  };
  if (!d2.ok) d2.reason = "run_not_continued_after_answer";

  // D3：全类别作者可见扫描（含 internal_terms_zh）hits=[]。
  const d3 = {
    ok: Boolean(scan?.ok),
    reason: scan?.ok ? null : "author_visible_internal_token_leak",
    detail: { scanned_files: scan?.files?.length ?? 0, hits: list(scan?.hits).slice(0, 20) },
  };

  // D4：消息流问题记录只读（「创作问题记录」区域无操作按钮）。
  const record = multiTurn?.problem_record ?? null;
  const d4 = {
    ok: Boolean(record) && record.group_found === true && Number(record.child_button_count) === 0,
    reason: null,
    detail: record ?? {},
  };
  if (!d4.ok) d4.reason = "problem_record_not_readonly";

  // D5：资源清理（app/端口停止、llm-calls 停止、cleanup 无残留）。
  const remaining = list(cleanup?.remaining);
  const terminationLlm = Number(driverLog?.termination?.llm_calls);
  const llmStopped = Boolean(runtime) && Number.isFinite(terminationLlm) && Number(runtime.llm_calls) === terminationLlm;
  const d5 = {
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
  if (!d5.ok) d5.reason = "cleanup_unverified_or_runtime_not_stopped";

  const checks = {
    D1_same_run_second_author_turn: d1,
    D2_run_continued: d2,
    D3_author_visible_no_internal_tokens: d3,
    D4_problem_record_readonly: d4,
    D5_cleanup: d5,
  };
  const failed = Object.entries(checks).filter(([, value]) => value.ok === false).map(([key]) => key);
  return {
    schema: ANSWER_MODE_SCHEMA,
    scenario: "answer-mode-gate",
    checks,
    failed,
    measured: {
      user_turns: userTurns,
      run_count: runCount,
      provider_runs: providerRuns.length,
      llm_calls: llmCalls,
      scan_hits: list(scan?.hits).length,
      record_buttons: record?.child_button_count ?? null,
    },
    not_signed: ["l4b_real_model_behavior_not_covered"],
  };
}

function buildVerdict({ dir, config, result, startedAt, finishedAt, gitHeadValue }) {
  const passed = result.failed.length === 0;
  const artifactDir = path.relative(process.cwd(), dir);
  return {
    schema_version: ANSWER_MODE_VERDICT_SCHEMA,
    scenario_id: "b71-answer-mode-gate",
    tier: "local",
    surface: "native",
    status: passed ? "pass" : "fail",
    reason: passed ? null : `${result.failed[0]} failed`,
    reason_codes: passed ? ["quality_accept_pass"] : result.failed.map((key) => `${key.toLowerCase()}_failed`),
    driver: "scripts/native_b71_auto_maintenance_drive.mjs",
    provider: config.provider,
    model: "deterministic",
    actual_model: null,
    attempt: 1,
    timeouts: 0,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    artifact_dir: artifactDir,
    artifact_links: [
      { kind: "summary_json", path: `${artifactDir}/summary.json`, role: "required" },
      { kind: "checks_json", path: `${artifactDir}/native-b71-checks.json`, role: "required" },
    ],
    evidence_required: ["screenshot", "backend_log", "summary_json", "persistence_snapshot"],
    evidence_present: ["screenshot", "backend_log", "summary_json", "persistence_snapshot"],
    evidence_missing: [],
    mechanism: {
      status: passed ? "pass" : "fail",
      evidence_refs: [`${artifactDir}/native-b71-checks.json`],
    },
    model_behavior: {
      status: "not_signed",
      reason_codes: ["l4b_real_model_behavior_not_covered"],
      evidence_refs: [],
    },
    final_refs: [`${artifactDir}/summary.json`],
    failure_refs: passed ? [] : [`${artifactDir}/native-b71-checks.json`],
    scoped_refs: [],
    generated_at: new Date().toISOString(),
    git_head: gitHeadValue,
    not_signed: result.not_signed,
  };
}

export function verifyAnswerModeBatch(dir) {
  const startedAt = new Date().toISOString();
  const config = readConfig(dir);
  assert.equal(config.journey, "answer-mode", "answer-mode verifier 只接受 journey=answer-mode");
  assert.equal(config.provider, "slice_verify", "answer-mode verifier 只接受确定性 slice_verify");
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: 2,
    minimumWaits: 4,
    requiredKinds: ["maintenance"],
  });
  const dbFacts = readAnswerModeDbFacts(dir);
  const driverLog = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  const cleanup = readJsonIfExists(path.join(dir, "native-app-cleanup.json"));
  const runtime = runtimeAfterBatch(dir);
  const scan = scanAuthorVisibleFiles(dir);
  const llmCalls = countLlmCalls(dir);
  const result = evaluateAnswerMode({ dbFacts, driverLog, cleanup, runtime, scan, llmCalls, dir });
  writeNativeFrames(dir);
  const finishedAt = new Date().toISOString();
  const summary = {
    schema: "b71-answer-mode-summary/v1",
    scenario: "answer-mode-gate",
    slice_id: config.slice_id,
    provider: config.provider,
    verified_at: finishedAt,
    request: driverLog?.answer_mode?.request ?? null,
    choice: driverLog?.answer_mode?.choice ?? null,
    checks: Object.fromEntries(Object.entries(result.checks).map(([key, value]) => [key, value.ok])),
    checks_detail: result.checks,
    failed: result.failed,
    measured: result.measured,
    not_signed: result.not_signed,
    wait_ledger: common.ledger,
    screenshots: common.ui.screenshots,
    verdict: {
      mechanism: result.failed.length === 0 ? "pass" : "fail",
      l4b_signed: false,
    },
  };
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  const verdict = buildVerdict({
    dir,
    config,
    result,
    startedAt,
    finishedAt,
    gitHeadValue: gitHead(),
  });
  fs.writeFileSync(path.join(dir, "verdict.json"), JSON.stringify(verdict, null, 2));
  assert.equal(result.failed.length, 0, `B71 answer-mode 判据失败: ${result.failed.join(", ")}`);
  console.log(
    `B71 answer-mode 判据通过: user_turns=${result.measured.user_turns} runs=${result.measured.run_count} provider_runs=${result.measured.provider_runs} scan_hits=${result.measured.scan_hits}`,
  );
  return { result, summary, verdict };
}
