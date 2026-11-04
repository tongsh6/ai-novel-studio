// B71 §16.14 工具确认/拒绝原生场景证据与判据（C1–C12，缺证据不得 PASS）。
//
// 本模块只负责批次读取、事实组装、调用具名判据与报告落盘；具体判据按职责位于：
// - authoring_confirmation_facts.mjs：wire/DB/driver 事实归一；
// - authoring_confirmation_action_evidence.mjs：C1–C4；
// - authoring_confirmation_execution_evidence.mjs：C6–C8；
// - authoring_confirmation_observation_evidence.mjs：C5/C9/C10；
// - authoring_confirmation_runtime_evidence.mjs：C11/C12。
//
// 判据硬门禁（独立复核 P0-A/P0-B/P1 修复）：
// - C5 幂等：必须 duplicate 分支真实成立（attempted+duplicate ack，或按钮不可见/disabled
//   且 child run 唯一 + provider/agent_runs/receipts/llm-calls delta=0），否则 fail。
// - C6 拒绝零副作用：采样窗口=点击前→收到决定后（action-scoped），delta 非 null 且全 0；
//   receipt decision=CANCELLED/decided_by=author；decision_traces.decision_type=cancel_waiting。
// - C9 Why：why.opened===true 且 llm-calls 前后实测值、delta=0；null 一律 fail。
// - C10 恢复：决定/创作结果 AX 可见、source 卡关闭、重启前后 provider/agent_runs/receipts/
//   llm-calls delta=0。
// - C11 清理：cleanup remaining=[]、process_observation 无 EPERM 降级；并在批次运行后实测
//   app 进程=0、4657/4661 不监听、llm-calls 与 driver 终止观测一致（不再增长）。
// - C12 子 run 实时启动：本批 received/agent_event、child run_id 精确绑定、第一次终局前
//   run_started（唯一、序号 1）与执行分支 tool_started（可多个不同 id/seq，每个都必须在
//   run_started 之后并按 event_id 与 DB 六字段同源）；gate_blocked 无 DB tool_started 事实时
//   不虚构要求；终局后重放截断忽略。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  writeNativeFrames,
  withDb,
} from "./scenario_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import { locateScopedButton } from "./authoring_pending_evidence.mjs";
import { checkAuthorVisibleTexts } from "./author_visible_check.mjs";
import { buildTarget } from "./input_target.mjs";
import { ownProcesses } from "./process_observation.mjs";
import {
  CONFIRMATION_CHECKPOINTS,
  CONFIRMATION_MODES,
  CONFIRMATION_REQUEST,
} from "./authoring_confirmation_constants.mjs";
import {
  assembleConfirmationFacts,
  executedConfirmationTurnResult,
  field,
  list,
  needsConfirmationTurnResult,
  rejectConfirmationTurnResult,
  selectConfirmationAction,
  textPath,
} from "./authoring_confirmation_facts.mjs";
import {
  authorActionRunBoundCheck,
  behaviorConsumedCheck,
  confirmationAcceptedCheck,
  sourcePersistedCheck,
} from "./authoring_confirmation_action_evidence.mjs";
import {
  authorBytesCheck,
  confirmedChildExecutionCheck,
  rejectZeroSideEffectCheck,
} from "./authoring_confirmation_execution_evidence.mjs";
import {
  duplicateIdempotentCheck,
  restoreCheck,
  whyReplayCheck,
} from "./authoring_confirmation_observation_evidence.mjs";
import {
  childLiveStartupCheck,
  cleanupCheck,
} from "./authoring_confirmation_runtime_evidence.mjs";

export const CONFIRMATION_CHECK_SCHEMA = "b71-confirmation-checks/v1";
export { CONFIRMATION_CHECKPOINTS, CONFIRMATION_MODES, CONFIRMATION_REQUEST };
export {
  executedConfirmationTurnResult,
  needsConfirmationTurnResult,
  rejectConfirmationTurnResult,
  selectConfirmationAction,
};

const CARD_TITLE = "需要确认";
const CARD_BODY_MARKERS = Object.freeze(["确认对象", "确认前不会调用工具", "确认后系统会重新检查当前作品状态"]);

// 确认卡所属消息块定位：用确认卡用户可见文案行 + 真实按钮名；复用 pending 消息块模型。
export function locateConfirmationButton(nodes, { label, cardTitle, cardBody, knownItems = [] } = {}) {
  if (typeof cardTitle !== "string" || cardTitle.trim() === "") return { ok: false, reason: "card_evidence_missing" };
  if (typeof cardBody !== "string" || cardBody.trim() === "") return { ok: false, reason: "card_evidence_missing" };
  const known = Array.isArray(knownItems) && knownItems.length > 0 ? knownItems : [cardTitle, cardBody];
  return locateScopedButton(nodes, { itemTitle: cardTitle, itemBody: cardBody, label, knownItems: known });
}

const isCardTitleLine = (line) => line === CARD_TITLE || line.startsWith(CARD_TITLE);
const isCardBodyLine = (line) => CARD_BODY_MARKERS.some((marker) => line.includes(marker));

// 从 AX 纯文本中提取确认卡可定位文案行（「需要确认」标题行 + 块内唯一正文行）。
export function confirmationCardLines(axText) {
  const lines = String(axText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const titleLine = lines.find(isCardTitleLine);
  if (!titleLine) return null;
  const bodyLine = lines.find((line) => line !== titleLine && isCardBodyLine(line));
  return bodyLine ? { title: titleLine, body: bodyLine } : null;
}

// ── 批次读取（只读）────────────────────────────────────────────────────────────
export function readConfirmationDbFacts(dir) {
  return withDb(dir, (db) => {
    const count = (table) => Number(all(db, `SELECT COUNT(*) AS c FROM ${table}`)[0].c);
    const rows = (table) => all(db, `SELECT * FROM ${table} ORDER BY inserted_at, id`);
    return {
      receipts: rows("author_action_receipts"),
      agent_runs: rows("agent_runs"),
      interactions: rows("interactions"),
      provider_runs: rows("provider_runs"),
      agent_events: rows("agent_events"),
      decision_traces: rows("decision_traces"),
      mutations_count: count("mutations"),
      memory_count: count("memory_items"),
      receipts_count: count("author_action_receipts"),
      provider_runs_count: count("provider_runs"),
      agent_runs_count: count("agent_runs"),
    };
  });
}

function countLlmCallsIn(dir) {
  const logDir = path.join(dir, "llm-calls");
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .reduce(
      (total, file) =>
        total + fs.readFileSync(path.join(logDir, file), "utf8").split("\n").filter((line) => line.includes("{")).length,
      0,
    );
}

const defaultExec = (command, args) => execFileSync(command, args, { encoding: "utf8" });

function portListening(port, exec) {
  try {
    const out = exec("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return out.split("\n").some((line) => line.includes("LISTEN"));
  } catch (error) {
    // lsof 对无匹配 listener 退出码为 1；其它执行错误必须暴露，不能当作“未监听”。
    if (error?.status === 1) return false;
    throw error;
  }
}

// 批次后运行态的唯一 I/O 读取边界：executable 由本批 ready 经既有 target producer 推导，
// 进程归属复用 process_observation；任何观测失败向上抛，不伪造 0/false。
export function observeConfirmationRuntime(dir, ready, { exec = defaultExec } = {}) {
  const target = buildTarget(ready, dir);
  const observation = ownProcesses(target.executable_path, { exec });
  return {
    app_processes: observation.processes.length,
    ports: {
      backend_4657: portListening(4657, exec),
      transport_4661: portListening(4661, exec),
    },
    llm_calls: countLlmCallsIn(dir),
  };
}

// ── AX 断言层 ──────────────────────────────────────────────────────────────────
// 确认/拒绝批次的 AX 断言层：扫描真实 AX dump 与可见文本（全类别，无收窄）。
// 协议 code / 中文内部术语 / 内部标识 / ref 模式 任一命中 → 判红；中文内部术语
// 另单独输出清单（报告用），同样计入 ok。
export const CONFIRMATION_AX_CAPTURES = Object.freeze([
  "01-source",
  "02-card",
  "02-after-confirm",
  "03-after-duplicate",
  "03-why",
  "04-restored",
]);

function captureFiles(dir) {
  const files = [];
  for (const name of CONFIRMATION_AX_CAPTURES) {
    for (const ext of ["ax.txt", "text.txt"]) {
      const file = path.join(dir, `${name}.${ext}`);
      if (fs.existsSync(file)) files.push({ file, ext });
    }
  }
  return files;
}

function captureText(raw, ext) {
  return ext === "ax.txt" ? { axText: raw, visibleText: "" } : { axText: "", visibleText: raw };
}

function scanCaptureFile({ file, ext }) {
  const raw = fs.readFileSync(file, "utf8");
  const scan = checkAuthorVisibleTexts(captureText(raw, ext));
  return list(scan.hits).map((hit) => ({
    file: path.basename(file),
    token: hit.token,
    kind: hit.kind,
    source: hit.source ?? null,
    context: String(hit.text ?? "").slice(0, 240),
  }));
}

export function scanAuthorVisibleBatch(dir) {
  const files = captureFiles(dir);
  const hits = files.flatMap(scanCaptureFile);
  return {
    schema: "b71-author-visible-ax-scan/v1",
    ok: hits.length === 0,
    scanned_files: files.map((entry) => path.basename(entry.file)),
    hits,
    internal_terms_zh_hits: hits.filter((hit) => hit.kind === "internal_term_zh"),
  };
}

// ── 判据编排与报告 ─────────────────────────────────────────────────────────────
export function evaluateConfirmation(input) {
  const facts = assembleConfirmationFacts(input);
  const checks = {
    C1_source_persisted: sourcePersistedCheck(facts),
    C2_confirmation_accepted: confirmationAcceptedCheck(facts),
    C3_author_action_run_bound: authorActionRunBoundCheck(facts),
    C4_behavior_uniquely_consumed: behaviorConsumedCheck(facts),
    C5_duplicate_idempotent: duplicateIdempotentCheck(facts),
    C6_reject_zero_side_effect: rejectZeroSideEffectCheck(facts),
    C7_confirmed_child_execution: confirmedChildExecutionCheck(facts),
    C8_author_bytes: authorBytesCheck(facts),
    C9_why_replay_zero_provider: whyReplayCheck(facts),
    C10_restore_not_actionable: restoreCheck(facts),
    C11_cleanup: cleanupCheck(facts),
    C12_child_live_startup_events: childLiveStartupCheck(facts),
  };
  return confirmationReport(facts, checks);
}

function requiredKeys(checks) {
  return Object.entries(checks)
    .filter(([, check]) => check.ok !== null)
    .map(([key]) => key);
}

function failedKeys(checks) {
  return Object.entries(checks)
    .filter(([, check]) => check.ok === false)
    .map(([key]) => key);
}

function executedModelBehavior(facts) {
  if (!facts.executedBody) return null;
  return {
    turn_id: field(facts.executedBody, "turn_id"),
    tool_name: field(facts.toolResult, "tool_name"),
    tool_status: field(facts.toolResult, "status"),
    pending_artifact_type: facts.pendingArtifactType,
    truthfulness: facts.truthfulness,
    branch: facts.childExecutionBranch,
  };
}

function confirmationReport(facts, checks) {
  return {
    schema: CONFIRMATION_CHECK_SCHEMA,
    mode: facts.mode,
    source_turn_id: facts.sourceTurnId,
    source_run_id: facts.sourceRunId,
    child_run_id: facts.childRunId,
    click_at: facts.clickAt || null,
    action: {
      action_id: facts.action.action_id,
      action_type: facts.action.action_type,
      idempotency_key: facts.action.idempotency_key,
      target_ref: facts.action.target_ref,
      behavior_ref: facts.behaviorRef,
    },
    checks,
    required: requiredKeys(checks),
    failed: failedKeys(checks),
    measured: {
      receipts: facts.receipts.length,
      action_receipts: facts.actionReceipts.length,
      provider_runs: facts.db.provider_runs_count,
      canon: facts.canonAll,
      executed_tool: field(facts.toolResult, "tool_name"),
      pending_artifact_type: facts.pendingArtifactType,
      approval: facts.receiptApproval,
      why_delta: facts.why.delta,
      duplicate_delta: facts.duplicate.delta,
      restart_delta: facts.restore.restartDelta,
      runtime_after_batch: facts.runtime,
    },
    model_behavior: {
      executed: executedModelBehavior(facts),
      gate_blocked: facts.childExecutionBranch === "gate_blocked",
      tool_failed: facts.childExecutionBranch === "tool_failed",
    },
    not_signed: ["I10_literary_quality_not_signed", "G1_G6_full_signed=false", "other_profiles_not_signed"],
  };
}

// ── 批次入口 ────────────────────────────────────────────────────────────────────
function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function parseLogLine(line) {
  try {
    return JSON.parse(line.slice(line.indexOf("{")));
  } catch {
    return null;
  }
}

function readLogFile(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.includes("{"))
    .map(parseLogLine)
    .filter(Boolean);
}

function readLogs(logDir) {
  if (!fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) => readLogFile(path.join(logDir, file)));
}

function readConfirmationBatch(dir) {
  const config = readConfig(dir);
  assert.equal(config.journey, "confirmation", "confirmation verifier 只接受 journey=confirmation");
  const mode = textPath(config, ["confirmation", "mode"]);
  assert(CONFIRMATION_MODES[mode], `未知 confirmation mode: ${mode}`);
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: 4,
    minimumWaits: 8,
    requiredKinds: ["input", "ack", "turn", "maintenance", "restore"],
  });
  const evidence = assertProviderAndWire(dir, {
    minUserMessages: 1,
    minTurnResults: 2,
    minProviderStarts: 0,
    expectProviders: ["slice_verify"],
  });
  return { config, mode, common, evidence };
}

function readConfirmationCheckpoints(dir) {
  const checkpoints = Object.fromEntries(
    CONFIRMATION_CHECKPOINTS.map((name) => [name, readJsonIfExists(path.join(dir, `b71-${name}.json`))]),
  );
  for (const name of ["start", "final"]) {
    assert(checkpoints[name], `缺少 checkpoint b71-${name}.json（canon 快照）`);
  }
  return checkpoints;
}

function readConfirmationInputs(dir, batch) {
  return {
    mode: batch.mode,
    wire: batch.evidence.wire,
    dbFacts: readConfirmationDbFacts(dir),
    checkpoints: readConfirmationCheckpoints(dir),
    driverLog: readJsonIfExists(path.join(dir, "native-b71-driver-log.json")),
    cleanup: readJsonIfExists(path.join(dir, "native-app-cleanup.json")),
    llmRecords: readLogs(path.join(dir, "llm-calls")),
    runtime: observeConfirmationRuntime(dir, batch.common.ready),
  };
}

function appendAuthorVisibleCheck(result, authorVisible) {
  const authorVisibleFailure = authorVisible.ok ? null : "author_visible_no_internal_tokens";
  result.checks.author_visible_no_internal_tokens = {
    ok: authorVisible.ok,
    reason: authorVisibleFailure,
    detail: authorVisible,
  };
  result.required.push("author_visible_no_internal_tokens");
  result.failed.push(...[authorVisibleFailure].filter(Boolean));
}

function evaluateConfirmationBatch(dir, batch, inputs) {
  const result = evaluateConfirmation(inputs);
  // AX 断言层（作者可见泄漏验证）：全类别命中即失败（含中文内部术语）。
  const authorVisible = scanAuthorVisibleBatch(dir);
  appendAuthorVisibleCheck(result, authorVisible);
  writeNativeFrames(dir);
  return { result, authorVisible };
}

function buildConfirmationSummary(batch, result, authorVisible) {
  return {
    schema: "b71-confirmation-summary/v1",
    slice_id: batch.config.slice_id,
    surface: "tauri-native",
    driver: "ax-native-system-ui",
    provider: batch.config.provider,
    mode: batch.mode,
    request: batch.config.message,
    verified_at: new Date().toISOString(),
    checks: Object.fromEntries(Object.entries(result.checks).map(([key, value]) => [key, value.ok])),
    checks_detail: result.checks,
    required: result.required,
    failed: result.failed,
    measured: result.measured,
    model_behavior: result.model_behavior,
    author_visible: authorVisible,
    not_signed: result.not_signed,
    wait_ledger: batch.common.ledger,
    screenshots: batch.common.ui.screenshots,
    verdict: {
      mechanism: result.failed.length === 0 ? "pass" : "fail",
      model_behavior: result.model_behavior,
      full_g1_g6_signed: false,
      i10_signed: false,
    },
  };
}

function writeConfirmationOutputs(dir, result, summary) {
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
}

export function verifyConfirmationBatch(dir) {
  const batch = readConfirmationBatch(dir);
  const inputs = readConfirmationInputs(dir, batch);
  const { result, authorVisible } = evaluateConfirmationBatch(dir, batch, inputs);
  const summary = buildConfirmationSummary(batch, result, authorVisible);
  writeConfirmationOutputs(dir, result, summary);
  assert.equal(result.failed.length, 0, `B71 confirmation 判据失败: ${result.failed.join(", ")}`);
  console.log(
    `B71 confirmation 判据通过: mode=${batch.mode} source_turn=${result.source_turn_id} executed=${result.measured.executed_tool ?? "-"} why_delta=${result.measured.why_delta}`,
  );
  return { result, summary };
}
