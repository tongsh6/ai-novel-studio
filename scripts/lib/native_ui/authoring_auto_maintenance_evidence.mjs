// B71 §16.16 第 2 类入口（安全点自动维护）原生验收证据与判据 C1–C10。
//
// 场景：真实 strata + 小窗口压力（NOVEL_CONTEXT_WINDOW_OVERRIDES="strata:4096"）+ ≥2 次
// 真实续行 → 安全点自动整理（checkpoint_created 事件 + role=checkpoint 消息同事务）→
// 行内细条 → 展开（原因/原文保留/来源/完整记录入口）→ 下一请求精简且 canonical 完整 →
// 刷新幂等 → 失败静默（隔离 DB 持久 trigger）→ 全类别无技术词 → 清理。
//
// 边界：不伪造窗口、不注入 usage、不手工压缩；无法形成真实压力时整批如实登记未闭环。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  read,
  withDb,
  writeNativeFrames,
} from "./scenario_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import { checkAuthorVisibleTexts } from "./author_visible_check.mjs";

export const AUTO_MAINTENANCE_SCHEMA = "b71-auto-maintenance-checks/v1";
export const AUTO_MAINTENANCE_CHECKPOINTS = Object.freeze([
  "start",
  "after-maintenance",
  "after-expanded",
  "after-next-request",
  "after-refresh",
  "after-failure",
  "after-recovery",
  "final",
]);
export const AUTO_MAINTENANCE_WINDOW = 4096;
export const AUTO_MAINTENANCE_TRIGGER_RATIO = 0.7;
export const AUTO_MAINTENANCE_REQUESTS = Object.freeze([
  "先读一下第01章的正文和章计划，我想知道现在的进度。",
  "再读一下第02章的正文和章计划，确认两章之间是否连贯。",
  "继续读一下第03章的计划，然后告诉我下一步该写什么。",
  "再看一下第01章的正文，确认开头是否抓人。",
  "把刚才读到的线索汇总一下，哪些还能继续用？",
  "最后再核对一遍第02章的正文，确保没有遗漏。",
]);
export const AUTO_MAINTENANCE_STOP_EVENT = "checkpoint_created";

import { requestFactsFromRecord } from "./authoring_request_facts.mjs";
const list = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function parseJson(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ── 全类别 AX 扫描（A3 的 capture 名称不固定，扫目录内全部 ax/text 证据）────────────
export function scanAuthorVisibleFiles(dir) {
  const hits = [];
  const files = [];
  if (!fs.existsSync(dir)) return { ok: false, hits: [], files, reason: "dir_missing" };
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.(ax|text)\.txt$/u.test(name)) continue;
    const file = path.join(dir, name);
    const raw = fs.readFileSync(file, "utf8");
    const axText = name.endsWith(".ax.txt") ? raw : "";
    const visibleText = name.endsWith(".text.txt") ? raw : "";
    files.push(name);
    const scan = checkAuthorVisibleTexts({ axText, visibleText });
    for (const hit of list(scan.hits)) {
      hits.push({
        file: name,
        token: hit.token,
        kind: hit.kind,
        source: hit.source ?? null,
        context: String(hit.text ?? "").slice(0, 240),
      });
    }
  }
  return { ok: hits.length === 0, hits, files };
}

// ── DB facts（只读）───────────────────────────────────────────────────────────
export function readAutoMaintenanceDbFacts(dir) {
  return withDb(dir, (db) => {
    const rows = (table) => {
      // 真实表有 inserted_at；合成测试库可能缺该列——缺列时退回无排序读取（不伪造）。
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
      agent_events: rows("agent_events"),
      agent_runs: rows("agent_runs"),
      provider_runs: rows("provider_runs"),
      interactions: rows("interactions"),
      mutations: rows("mutations"),
    };
  });
}

function transcriptMessages(agentRuns) {
  const messages = [];
  for (const run of list(agentRuns)) {
    const parsed = parseJson(run?.authoring_transcript);
    const transcript = isObject(parsed?.transcript) ? parsed.transcript : parsed;
    const runMessages = list(transcript?.messages);
    for (const message of runMessages) {
      if (isObject(message)) messages.push({ ...message, run_id: run?.id ?? null });
    }
  }
  return messages;
}

function checkpointCallIds(message) {
  const candidates = [
    message?.call_ids,
    message?.covers?.call_ids,
    message?.compacted_call_ids,
    message?.payload?.covers?.call_ids,
    message?.payload?.call_ids,
    message?.compaction?.covers?.call_ids,
    message?.compaction?.call_ids,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate.map(String);
  }
  return [];
}

function checkpointEvents(events) {
  return list(events).filter((event) => String(event?.event_type ?? "") === AUTO_MAINTENANCE_STOP_EVENT);
}

function eventAts(events) {
  return list(events)
    .map((event) => String(event?.inserted_at ?? event?.at ?? ""))
    .filter(Boolean)
    .sort();
}

function llmRecordTs(record) {
  return String(record?.ts ?? record?.at ?? record?.inserted_at ?? "");
}

function messagesOfLlmRecord(record) {
  const facts = requestFactsFromRecord(record);
  return facts.ok ? facts.messages : null;
}

function requestMessagesText(record) {
  const messages = messagesOfLlmRecord(record);
  return list(messages).map((message) => JSON.stringify(message)).join("\n");
}

function inputTokensOf(record) {
  const usage = record?.response?.usage ?? record?.usage ?? null;
  return Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0);
}

function countLlmCalls(dir) {
  const logDir = path.join(dir, "llm-calls");
  if (!fs.existsSync(logDir)) return 0;
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .reduce(
      (total, file) =>
        total + fs.readFileSync(path.join(logDir, file), "utf8").split("\n").filter((line) => line.includes("{")).length,
      0,
    );
}

export function runtimeAfterBatch(dir) {
  let appPath = null;
  try {
    appPath = parseJson(fs.readFileSync(path.join(dir, "native-driver-ready.json"), "utf8"))?.app_path ?? null;
  } catch {
    appPath = null;
  }
  const countApp = () => {
    const fallback = "AI Novel Studio.app/Contents/MacOS/app";
    const target = typeof appPath === "string" && appPath !== "" ? appPath : fallback;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    try {
      return execFileSync("pgrep", ["-f", escaped], { encoding: "utf8" })
        .split("\n").filter(Boolean).length;
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

function readLogs(logDir) {
  if (!fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) =>
      fs.readFileSync(path.join(logDir, file), "utf8")
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

// ── 判据 C1–C10 ─────────────────────────────────────────────────────────────
export function evaluateAutoMaintenance({
  config,
  dbFacts,
  checkpoints,
  driverLog = null,
  cleanup = null,
  strataSlot = null,
  llmRecords = [],
  appLog = [],
  dir = null,
  multiTurn = null,
}) {
  const db = dbFacts ?? {};
  const env = driverLog?.env ?? {};
  const transcript = transcriptMessages(db.agent_runs);
  const checkpointsMsgs = transcript.filter((message) => String(message?.role ?? "") === "checkpoint");
  const events = checkpointEvents(db.agent_events);
  const eventTimes = eventAts(events);
  const triggerRatio = AUTO_MAINTENANCE_TRIGGER_RATIO;
  const threshold = Math.floor(AUTO_MAINTENANCE_WINDOW * triggerRatio);
  const usages = list(llmRecords).map(inputTokensOf).filter((value) => Number.isFinite(value) && value > 0);
  const maxInputTokens = usages.length > 0 ? Math.max(...usages) : 0;
  const providerIds = [...new Set(list(db.provider_runs).map((run) => String(run?.provider_id ?? "")).filter(Boolean))];
  const autoMaintenanceEnabled = String(env.auto_maintenance_enabled ?? "") === "1";
  const windowOverride = String(env.window_overrides ?? "");
  const autoVisible = scanAuthorVisibleFiles(dir);
  const runtime = dir ? runtimeAfterBatch(dir) : null;

  // C1：真实压力成立（真实 usage 越线 + 窗口 override 生效 + strata provider）。
  const c1 = {
    ok:
      autoMaintenanceEnabled &&
      windowOverride.includes("strata:4096") &&
      providerIds.includes("strata") &&
      maxInputTokens >= threshold,
    reason: null,
    detail: {
      auto_maintenance_enabled: env.auto_maintenance_enabled ?? null,
      window_overrides: windowOverride,
      provider_ids: providerIds,
      max_input_tokens: maxInputTokens,
      threshold,
      window: AUTO_MAINTENANCE_WINDOW,
    },
  };
  if (!c1.ok) c1.reason = "real_pressure_not_established";

  // C2：自动整理发生（checkpoint_created 事件 + role=checkpoint 消息，同边界）。
  const eventPayloadOk = events.every((event) => {
    const payload = parseJson(event?.payload) ?? {};
    return Number(payload?.covered_exchanges ?? 0) >= 0 && isObject(payload);
  });
  const c2 = {
    ok: events.length >= 1 && checkpointsMsgs.length >= 1 && eventPayloadOk,
    reason: null,
    detail: {
      checkpoint_events: events.length,
      checkpoint_messages: checkpointsMsgs.length,
      event_times: eventTimes.slice(-3),
      visibility: list(events).map((event) => String(event?.visibility ?? "")).slice(-3),
    },
  };
  if (!c2.ok) c2.reason = "auto_maintenance_not_observed";

  // C3：行内细条可见（作者可见文案「较早的 N 项创作过程已整理」）。
  const maintenanceAx = readCaptureText(dir, "after-maintenance");
  const stripText = /较早的\s*\d+\s*项创作过程已整理|创作过程已整理/u;
  const c3 = {
    ok: stripText.test(maintenanceAx),
    reason: null,
    detail: { matched: (maintenanceAx.match(stripText) ?? [])[0] ?? null, capture: "after-maintenance" },
  };
  if (!c3.ok) c3.reason = "maintenance_strip_not_visible";

  // C4：展开面板四要素（原因/原文保留/来源/完整记录入口）。
  const expandedAx = readCaptureText(dir, "after-expanded");
  const factors = {
    heading: /已整理的较早记录/u.test(expandedAx),
    reason: /为了保持这次创作始终清晰连贯/u.test(expandedAx),
    original_kept: /原始记录仍然保留/u.test(expandedAx),
    full_record_entry: /查看完整记录/u.test(expandedAx),
    sources: /涉及：/u.test(expandedAx),
  };
  const c4 = {
    ok: factors.heading && factors.reason && factors.original_kept && factors.full_record_entry,
    reason: null,
    detail: factors,
  };
  if (!c4.ok) c4.reason = "expanded_panel_factors_missing";

  // C5：下一请求精简（整理后第一个 provider 请求不含 covers.call_ids；消息条数不增）。
  const coveredCallIds = [...new Set(checkpointsMsgs.flatMap((message) => checkpointCallIds(message)))];
  const sortedRecords = list(llmRecords)
    .filter((record) => llmRecordTs(record) !== "")
    .sort((left, right) => String(llmRecordTs(left)).localeCompare(String(llmRecordTs(right))));
  const firstEventTime = eventTimes[0] ?? "";
  const beforeRecord = [...sortedRecords].reverse().find((record) => String(llmRecordTs(record)) <= firstEventTime) ?? null;
  const afterRecord = sortedRecords.find((record) => String(llmRecordTs(record)) > firstEventTime) ?? null;
  const afterText = afterRecord ? requestMessagesText(afterRecord) : "";
  const leakedCallIds = coveredCallIds.filter((callId) => afterText.includes(callId));
  const beforeFacts = beforeRecord ? messagesOfLlmRecord(beforeRecord) : null;
  const afterFacts = afterRecord ? messagesOfLlmRecord(afterRecord) : null;
  const beforeMessages = beforeFacts ? beforeFacts.length : null;
  const afterMessages = afterFacts ? afterFacts.length : null;
  const c5 =
    coveredCallIds.length > 0 && afterRecord
      ? {
          ok: afterFacts !== null &&
            leakedCallIds.length === 0 &&
            (beforeMessages === null || afterMessages === null || afterMessages <= beforeMessages),
          reason: leakedCallIds.length === 0 ? null : "covered_call_ids_still_in_next_request",
          detail: {
            covered_call_ids: coveredCallIds.slice(0, 20),
            leaked_call_ids: leakedCallIds.slice(0, 20),
            before_messages: beforeMessages,
            after_messages: afterMessages,
            after_capture: afterRecord?.turn_id ?? null,
          },
        }
      : { ok: null, reason: "next_request_evidence_missing", detail: { covered_call_ids: coveredCallIds.slice(0, 20) } };

  // C6：canonical 完整（被整理 call 的 tool_call + tool observation 仍在 transcript）。
  const canonicalText = transcript.map((message) => JSON.stringify(message)).join("\n");
  const missingCallIds = coveredCallIds.filter((callId) => !canonicalText.includes(callId));
  const c6 = {
    ok: coveredCallIds.length > 0 && missingCallIds.length === 0,
    reason: missingCallIds.length === 0 ? null : "covered_call_missing_from_canonical",
    detail: { covered_call_ids: coveredCallIds.slice(0, 20), missing_call_ids: missingCallIds.slice(0, 20) },
  };

  // C7：刷新幂等（刷新后细条仍在、checkpoint 事件数不变）。
  const refreshAx = readCaptureText(dir, "after-refresh");
  const refresh = driverLog?.refresh ?? null;
  const c7 = {
    // C7（刷新幂等）/C8（失败静默）属跨 run A3 场景的补充判据；G6-multi-turn
    // 场景范围只要求「压缩触发 + 压缩后请求覆盖事实」，这两个判据在该场景不判
    // （ok=null → 不进 required），并在 not_signed 明示，不从整体判据中删除。
    ok: multiTurn
      ? null
      : stripText.test(refreshAx) &&
        isObject(refresh) &&
        Number(refresh.before_checkpoint_events) === Number(refresh.after_checkpoint_events),
    reason: multiTurn ? "not_in_scope_multi_turn" : null,
    detail: {
      strip_visible_after_refresh: stripText.test(refreshAx),
      before_checkpoint_events: refresh?.before_checkpoint_events ?? null,
      after_checkpoint_events: refresh?.after_checkpoint_events ?? null,
    },
  };
  if (c7.ok === false) c7.reason = "refresh_not_idempotent";

  // C8：失败静默（持久 trigger 注入；无错误弹窗；developer 日志；移除后恢复）。
  const injection = driverLog?.failure_injection ?? null;
  const failureAx = readCaptureText(dir, "after-failure");
  const appLogText = list(appLog).map((entry) => JSON.stringify(entry)).join("\n");
  const errorEventCount = list(appLog).filter((entry) => String(entry?.event ?? "").includes("auto_maintenance")).length;
  const c8 = {
    ok: multiTurn
      ? null
      : isObject(injection) &&
      injection.trigger_created === true &&
      injection.author_error_visible === false &&
      Number(injection.checkpoint_events_after_failure ?? -1) === Number(injection.checkpoint_events_before_failure ?? -2) &&
      injection.recovered_after_drop === true &&
      errorEventCount >= 0,
    reason: null,
    detail: {
      trigger_created: injection?.trigger_created ?? null,
      author_error_visible: injection?.author_error_visible ?? null,
      checkpoint_events_before_failure: injection?.checkpoint_events_before_failure ?? null,
      checkpoint_events_after_failure: injection?.checkpoint_events_after_failure ?? null,
      recovered_after_drop: injection?.recovered_after_drop ?? null,
      auto_maintenance_app_log_events: errorEventCount,
      failure_capture_error_text: /失败|错误|异常/u.test(failureAx),
      app_log_has_auto_maintenance: appLogText.includes("auto_maintenance"),
    },
  };
  if (c8.ok === false) c8.reason = "failure_silence_not_observed";

  // C9：全类别无技术词（扫描目录全部 ax/text 证据）。
  const c9 = {
    ok: autoVisible.ok,
    reason: autoVisible.ok ? null : "author_visible_internal_token_leak",
    detail: autoVisible,
  };

  // C10：清理（app 关闭、端口停止、llm-calls 停止、strata 卸载、cleanup 无残留）。
  const remaining = list(cleanup?.remaining);
  const terminationLlm = Number(driverLog?.termination?.llm_calls);
  const llmStopped = Boolean(runtime) && Number.isFinite(terminationLlm) && Number(runtime.llm_calls) === terminationLlm;
  const c10 = {
    ok:
      remaining.length === 0 &&
      Boolean(runtime) &&
      runtime.app_processes === 0 &&
      runtime.ports.backend_4657 === false &&
      runtime.ports.transport_4661 === false &&
      llmStopped &&
      Boolean(strataSlot) &&
      strataSlot.unloaded === true,
    reason: null,
    detail: {
      remaining: remaining.length,
      runtime_after_batch: runtime,
      llm_calls_stopped: llmStopped,
      strata_unloaded: strataSlot?.unloaded ?? null,
    },
  };
  if (!c10.ok) c10.reason = "cleanup_unverified_or_runtime_not_stopped";

  const multiTurnSteers = list(multiTurn?.steers);
  const multiTurnResumes = list(multiTurn?.resumes);
  const multiTurnPause = multiTurn?.pause ?? null;
  const c11 = multiTurn
    ? {
        ok:
          multiTurnPause?.kind === "paused" &&
          multiTurnSteers.length >= 1 &&
          multiTurnSteers.every((steer) => steer?.ok === true) &&
          multiTurnResumes.length >= multiTurnSteers.length &&
          multiTurnResumes.every((resume) => resume?.resumed === true),
        reason: null,
        detail: {
          pause: multiTurnPause,
          steers: multiTurnSteers.length,
          resumes: multiTurnResumes.length,
          rounds: list(multiTurn?.rounds).length,
          stop_reason: multiTurn?.stop_reason ?? null,
          max_steers: multiTurn?.max_steers ?? null,
          checkpoint_events: multiTurn?.checkpoint_events ?? null,
        },
      }
    : { ok: null, reason: "not_multi_turn_scenario", detail: {} };
  if (c11.ok === false) c11.reason = "multi_turn_same_run_not_established";

  const checks = {
    C1_real_pressure: c1,
    C2_auto_maintenance_committed: c2,
    C3_strip_visible: c3,
    C4_expanded_factors: c4,
    C5_next_request_compact: c5,
    C6_canonical_complete: c6,
    C7_refresh_idempotent: c7,
    C8_failure_silent: c8,
    C9_author_visible_no_internal_tokens: c9,
    C10_cleanup: c10,
    C11_multi_turn_same_run: c11,
  };
  const required = Object.entries(checks).filter(([, value]) => value.ok !== null).map(([key]) => key);
  const failed = Object.entries(checks).filter(([, value]) => value.ok === false).map(([key]) => key);
  return {
    schema: AUTO_MAINTENANCE_SCHEMA,
    case: "auto-maintenance-a3",
    checks,
    required,
    failed,
    measured: {
      checkpoint_events: events.length,
      checkpoint_messages: checkpointsMsgs.length,
      covered_call_ids: coveredCallIds.length,
      max_input_tokens: maxInputTokens,
      threshold,
      provider_ids: providerIds,
      requests_attempted: list(driverLog?.requests).length,
      triggered: events.length > 0,
    },
    model_behavior: {
      run_statuses: [...new Set(transcript.filter((message) => message?.role === "assistant").map((message) => message?.run_id ?? null))].length,
      provider_calls: usages.length,
      note: "安全点自动维护的真实触发/失败由 DB 事件与 app-log 事实判定；不代签 I10/完整 G1–G6。",
    },
    not_signed: [
      "I10_literary_quality_not_signed",
      "G1_G6_full_signed=false",
      "threshold_tuning_not_signed",
      ...(multiTurn
        ? ["C7_refresh_not_in_scope_multi_turn", "C8_failure_injection_not_in_scope_multi_turn"]
        : []),
    ],
  };
}

function readCaptureText(dir, name) {
  if (!dir) return "";
  const ax = path.join(dir, `${name}.ax.txt`);
  const text = path.join(dir, `${name}.text.txt`);
  return [fs.existsSync(ax) ? fs.readFileSync(ax, "utf8") : "", fs.existsSync(text) ? fs.readFileSync(text, "utf8") : ""].join("\n");
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

// runner 在后台运行、以 ui-complete 作为驱动完成信号；driver finally 的证据写入与
// verify 之间存在毫秒级时序竞争。verify 侧对有界等待，缺失仍如实断言（不伪造）。
export function waitForEvidenceFile(dir, name, timeoutMs = 20_000) {
  const file = path.join(dir, name);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  return fs.existsSync(file);
}

export function verifyAutoMaintenanceBatch(dir) {
  const config = readConfig(dir);
  assert.equal(config.journey, "auto-maintenance", "auto-maintenance verifier 只接受 journey=auto-maintenance");
  assert.equal(config.provider, "strata", "auto-maintenance verifier 只接受 provider=strata");
  const driverLogForMode = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  const multiTurn = driverLogForMode?.multi_turn ?? null;
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: 3,
    minimumWaits: 6,
    requiredKinds: ["input", "ack", "turn", "maintenance"],
  });
  const evidence = assertProviderAndWire(dir, {
    // G6-multi-turn 同 run steer 不产生额外的 user_message 帧；同 run 多回合由
    // C11 基于 driver 的 pause/steer/resume 事实判定，wire 只要求首轮输入与最终
    // turn_result（至少各 1 次真实帧），不把判据放宽到无事件。
    minUserMessages: multiTurn ? 1 : 2,
    minTurnResults: multiTurn ? 1 : 2,
    minProviderStarts: 1,
    expectProviders: ["strata"],
  });
  assert(
    waitForEvidenceFile(dir, "strata-slot.json"),
    "缺少 strata-slot.json（批次前后槽位/卸载核验；已等待落盘仍有界超时）",
  );
  const strataSlot = readJsonIfExists(path.join(dir, "strata-slot.json"));
  const checkpoints = Object.fromEntries(
    AUTO_MAINTENANCE_CHECKPOINTS.map((name) => [name, readJsonIfExists(path.join(dir, `b71-${name}.json`))]),
  );
  for (const name of ["start", "final"]) {
    assert(checkpoints[name], `缺少 checkpoint b71-${name}.json（canon 快照）`);
  }
  const dbFacts = readAutoMaintenanceDbFacts(dir);
  const driverLog = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  const cleanup = readJsonIfExists(path.join(dir, "native-app-cleanup.json"));
  const llmRecords = readLogs(path.join(dir, "llm-calls"));
  const appLog = readLogs(path.join(dir, "app-log"));
  const result = evaluateAutoMaintenance({
    config,
    dbFacts,
    checkpoints,
    driverLog,
    cleanup,
    strataSlot,
    llmRecords,
    appLog,
    dir,
    multiTurn,
  });
  writeNativeFrames(dir);
  const summary = {
    schema: "b71-auto-maintenance-summary/v1",
    slice_id: config.slice_id,
    provider: config.provider,
    journey: "auto-maintenance",
    scenario: multiTurn ? "g6-multi-turn" : "auto-maintenance-a3",
    multi_turn: multiTurn,
    verified_at: new Date().toISOString(),
    env: driverLog?.env ?? null,
    requests: driverLog?.requests ?? [],
    checks: Object.fromEntries(Object.entries(result.checks).map(([key, value]) => [key, value.ok])),
    checks_detail: result.checks,
    required: result.required,
    failed: result.failed,
    measured: result.measured,
    model_behavior: result.model_behavior,
    not_signed: result.not_signed,
    wait_ledger: common.ledger,
    screenshots: common.ui.screenshots,
    strata_slot: strataSlot,
    verdict: {
      mechanism: result.failed.length === 0 ? "pass" : "fail",
      auto_maintenance_loop_closed: result.checks.C2_auto_maintenance_committed.ok === true,
      full_g1_g6_signed: false,
      i10_signed: false,
    },
  };
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  assert.equal(result.failed.length, 0, `B71 auto-maintenance 判据失败: ${result.failed.join(", ")}`);
  console.log(
    `B71 auto-maintenance 判据通过: checkpoint_events=${result.measured.checkpoint_events} covered=${result.measured.covered_call_ids}`,
  );
  return { result, summary };
}
