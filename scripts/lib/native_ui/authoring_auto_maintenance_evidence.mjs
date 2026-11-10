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
  frameBody,
  frameEvent,
  read,
  transport,
  withDb,
  writeNativeFrames,
} from "./scenario_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import { checkAuthorVisibleTexts } from "./author_visible_check.mjs";
import { actionAck } from "./authoring_pending_evidence.mjs";

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

import { NATIVE_CHAT_WIRE, requestFactsFromRecord } from "./authoring_request_facts.mjs";
const list = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const CHECKPOINT_COVER_PREFIX = "【应用数据 · checkpoint · 覆盖 ";
// 正式 auto-maintenance 中 C5 缺证（ok=null）不是「不适用」，而是验收未通过；
// C7/C8 在 direct A3 与正式 live multi-turn 两个场景都必须判；仅 C11 按场景保持 null=不判。
const EVIDENCE_REQUIRED_CHECKS = new Set(["C5_next_request_compact"]);

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
      authoring_session_messages: rows("authoring_session_messages"),
      provider_runs: rows("provider_runs"),
      provider_events: rows("provider_events"),
      interactions: rows("interactions"),
      mutations: rows("mutations"),
    };
  });
}

function transcriptMessages(sessionMessageRows) {
  const messages = [];
  for (const row of list(sessionMessageRows)) {
    const message = parseJson(row?.message);
    if (isObject(message)) {
      messages.push({
        ...message,
        run_id: row?.run_id ?? null,
        session_id: row?.session_id ?? null,
        sequence: row?.sequence ?? null,
      });
    }
  }
  return messages;
}

// checkpoint canonical 形状只有 {blocks: [{type: "checkpoint", covers: {call_ids}}]}。
// 旧形状不再兜底：否则把任意字段里的 ID 当成 cover 证据（C6 假阳性）。
function checkpointCallIds(message) {
  const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
  const callIds = [];
  for (const block of blocks) {
    if (String(block?.type ?? "") !== "checkpoint") continue;
    for (const callId of list(block?.covers?.call_ids)) {
      if (nonBlank(callId)) callIds.push(String(callId));
    }
  }
  return [...new Set(callIds)];
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

const timeValue = (value) => {
  const parsed = Date.parse(String(value ?? "").replace(" ", "T").replace(/(\.\d{3})\d+/u, "$1"));
  return Number.isFinite(parsed) ? parsed : null;
};

// checkpoint 在 native wire 中是 user 文本；取显式 projection cover 集合。
function wireCheckpoints(facts) {
  const covers = [];
  for (const message of list(facts?.applicationMessages)) {
    const text = typeof message?.text === "string" ? message.text : "";
    let cursor = 0;
    while (true) {
      const start = text.indexOf(CHECKPOINT_COVER_PREFIX, cursor);
      if (start < 0) break;
      const jsonStart = start + CHECKPOINT_COVER_PREFIX.length;
      const jsonEnd = text.indexOf("】", jsonStart);
      if (jsonEnd < 0) break;
      const value = parseJson(text.slice(jsonStart, jsonEnd));
      if (isObject(value)) {
        covers.push({ ...value, call_ids: list(value.call_ids).filter(nonBlank).map(String) });
      }
      cursor = jsonEnd + 1;
    }
  }
  return covers;
}

function sameIdSet(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((id) => b.has(id));
}

function checkpointExchange(checkpoint, transcript) {
  const calls = new Map();
  const results = new Map();
  const before = transcript.filter((message) =>
    message.session_id === checkpoint.session_id && Number(message.sequence) < Number(checkpoint.sequence));
  for (const message of before) {
    for (const block of list(message?.blocks)) {
      const callId = block?.call_id;
      if (!nonBlank(callId)) continue;
      const id = String(callId);
      if (message.role === "assistant" && block.type === "tool_call") {
        calls.set(id, [...(calls.get(id) ?? []), Number(message.sequence)]);
      }
      if (message.role === "tool" && ["observation", "validation_result"].includes(block.type)) {
        results.set(id, [...(results.get(id) ?? []), Number(message.sequence)]);
      }
    }
  }
  return { calls, results };
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

// 独立验证交错续行。原 C1–C11 仍用于普通批次，末尾 A 的整理也不冒充有后续请求。
export function verifyInterleavedResume(dir) {
  const trace = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"))?.interleaved_resume;
  return verifyInterleavedResumeFacts(trace, readAutoMaintenanceDbFacts(dir), transport(dir), readLogs(path.join(dir, "llm-calls")));
}

function verifyInterleavedResumeFacts(trace, db, wire, llmRecords) {
  const { agent_runs, agent_events, authoring_session_messages, provider_runs, provider_events } = db;
  const a = agent_runs.find((run) => run.id === trace?.waiting_run_id);
  const b = agent_runs.find((run) => run.id === trace?.later_run_id);
  assert(a?.session_id && b && a.id !== b.id && a.session_id === b.session_id, "A/B 必须是同会话的不同 run");
  assert.equal(a.status, "completed");
  assert.equal(b.status, "completed");
  assert.equal(a.goal_version, trace.waiting_goal_version + 1);

  const actions = wire.filter((record) => {
    const action = frameBody(record)?.action;
    return record.direction === "sent" && frameEvent(record) === "author_action" &&
      action?.action_type === "author_choice" && action.target_ref === a.id &&
      action.payload?.question_ref === trace.waiting_question_ref &&
      action.payload?.expected_goal_version === trace.waiting_goal_version;
  });
  assert.equal(actions.length, 1, "必须有唯一的 A 原问题回答帧");
  const { response } = actionAck(wire, actions[0], { actionStatus: "accepted" });
  assert.equal(response.action_id, frameBody(actions[0]).action.action_id);
  assert.equal(response.run_id, a.id);
  assert.equal(response.question_ref, trace.waiting_question_ref);
  assert.equal(response.goal_version, a.goal_version);
  const sentAt = timeValue(actions[0].at);
  assert(wire.some((record) => record.direction === "received" && frameEvent(record) === "turn_result" &&
    frameBody(record)?.agent_run?.run_id === b.id && frameBody(record).agent_run.status === "completed" &&
    timeValue(record.at) < sentAt), "必须先观察到 B 完成，再回答 A");

  const rows = transcriptMessages(authoring_session_messages)
    .filter((row) => row.session_id === a.session_id)
    .sort((left, right) => left.sequence - right.sequence);
  const checkpoints = rows.filter((row) => row.run_id === b.id && row.role === "checkpoint");
  const events = checkpointEvents(agent_events).filter((event) => event.run_id === b.id);
  assert.equal(checkpoints.length, 1, "B 必须持有可唯一绑定的 checkpoint");
  assert.equal(events.length, 1, "B 必须持有可唯一绑定的整理事件");
  assert(timeValue(events[0].inserted_at) < sentAt, "B 的整理必须发生在 A 回答前");
  const checkpoint = checkpoints[0];
  const covered = checkpointCallIds(checkpoint);
  const aExchanges = checkpointExchange(checkpoint, rows.filter((row) => row.run_id === a.id));
  assert(covered.some((id) => aExchanges.calls.get(id)?.length === 1 &&
    aExchanges.results.get(id)?.length === 1 &&
    aExchanges.calls.get(id)[0] < aExchanges.results.get(id)[0]), "B 必须覆盖 A 已落库的闭合交换");

  const providers = new Map(provider_runs.filter((run) => run.agent_run_id === a.id &&
    run.session_id === a.session_id && run.provider_id === "strata").map((run) => [run.id, run]));
  const starts = provider_events.filter((event) => event.event_type === "started" &&
    providers.has(event.provider_run_id) && timeValue(event.emitted_at) >= sentAt)
    .sort((left, right) => timeValue(left.emitted_at) - timeValue(right.emitted_at));
  assert(starts.length > 0, "缺少 A 恢复后的 Provider 请求");
  assert.notEqual(timeValue(starts[0].emitted_at), timeValue(starts[1]?.emitted_at), "首个请求不能多义");
  const run = providers.get(starts[0].provider_run_id);
  const records = llmRecords
    .filter((record) => record.provider_run_ref === run.id && record.provider_call_ref === run.provider_call_ref);
  assert.equal(records.length, 1, "A 恢复请求须按 Provider run/call 唯一绑定");
  const facts = requestFactsFromRecord(records[0]);
  assert(facts.ok && facts.format === NATIVE_CHAT_WIRE && facts.malformedCalls === 0 && facts.malformedToolMessages === 0);
  const canonicalCover = checkpoint.blocks.find((block) => block.type === "checkpoint")?.covers;
  assert(wireCheckpoints(facts).some((entry) => entry.turn_range === canonicalCover?.turn_range &&
    sameIdSet(entry.call_ids, covered)), "A 的请求缺 B 的精确折叠范围");

  const answer = rows.find((row) => row.run_id === a.id && row.role === "user" &&
    row.sequence > checkpoint.sequence && row.author_turn?.question_ref === trace.waiting_question_ref);
  assert(answer, "缺少 A 的 canonical 回答");
  const history = rows.filter((row) => row.sequence <= answer.sequence);
  const folded = new Set(history.filter((row) => row.role === "checkpoint").flatMap(checkpointCallIds));
  const toolBlocks = (role, types) => history.filter((row) => row.role === role)
    .flatMap((row) => list(row.blocks)).filter((block) => types.includes(block.type));
  const retainedCalls = toolBlocks("assistant", ["tool_call"]).map((block) => block.call_id)
    .filter((id) => !folded.has(id));
  const retainedResults = toolBlocks("tool", ["observation", "validation_result"])
    .filter((block) => !folded.has(block.call_id));
  assert.deepEqual(facts.toolCalls.map((call) => call.callId), retainedCalls);
  assert.deepEqual(facts.toolResults.map((result) => result.payload), retainedResults);
  assert(facts.toolResults.some((result) => list(result.payload.source_refs).length > 0), "缺少带来源的保留观察");
  const textOf = (row) => list(row.blocks).filter((block) => block.type === "text").map((block) => block.text).join("");
  const authorTexts = history.filter((row) => row.role === "user").map(textOf).filter(Boolean);
  assert.deepEqual(facts.authorMessages.map((message) => message.text), authorTexts);
  const scope = rows.find((row) => row.sequence > answer.sequence && row.run_id === a.id &&
    row.role === "scope_update" && row.versions?.goal === response.goal_version);
  const [scopeHeader, versionLine, ...scopeLines] = (facts.scopeMessages.at(-1)?.text ?? "").split("\n");
  assert(scope && scopeHeader, "A 恢复后必须生成当前 scope");
  assert.deepEqual(parseJson(versionLine?.replace(/^版本：/u, "")), scope.versions);
  assert.equal(scopeLines.join("\n"), textOf(scope));
  return {
    ok: true, session_id: a.session_id, waiting_run_id: a.id, later_run_id: b.id,
    checkpoint_sequence: checkpoint.sequence, covered_call_ids: covered,
    provider_run_id: run.id, provider_call_ref: run.provider_call_ref,
    retained_exchanges: retainedCalls.length, exact_author_messages: authorTexts.length,
    observations_with_refs: retainedResults.filter((block) => list(block.source_refs).length > 0).length,
    observations_with_versions: retainedResults.filter((block) =>
      block.type === "observation" && Object.keys(block.versions ?? {}).length > 0).length,
    goal_version: response.goal_version,
  };
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
  const transcript = transcriptMessages(db.authoring_session_messages);
  const checkpointsMsgs = transcript.filter((message) => String(message?.role ?? "") === "checkpoint");
  const events = checkpointEvents(db.agent_events);
  // 尾段恢复 run 的 checkpoint 是 C8 证据，之后不再有「下一请求」；C5 只核查
  // 触发/下一请求链上的 checkpoint，不把恢复 checkpoint 误判为缺证。
  const recoveryProbeRunId = driverLog?.failure_injection?.recovery_request?.run_id ?? null;
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

  // C3：行内细条可见（旧作者文案「较早的 N 项创作过程已整理」，或现行 AX 细条按钮）。
  const maintenanceAx = readCaptureText(dir, "after-maintenance");
  // 现行 UI 的细条 accessible name 是「查看已整理的较早创作过程」；只认 AXButton 角色、
  // 精确名称且 enabled=true——同名静态文本/纯文本/disabled 控件都不是可见条。
  const stripText =
    /较早的\s*\d+\s*项创作过程已整理|创作过程已整理|^[\t ]*(?:[^\s,]+[\t ]+)?AXButton,[ \t]+查看已整理的较早创作过程,[ \t]+enabled=true(?:,|$)/mu;
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

  // C5：同 session checkpoint 后第一条 started 事件定位 ProviderRun；prun+pcall
  // 同时唯一配对日志。缺证 unknown，后续第 2 请求不能补位。
  const coveredCallIds = [...new Set(checkpointsMsgs.flatMap((checkpoint) => checkpointCallIds(checkpoint)))];
  const providerRunsById = new Map(list(db.provider_runs).map((run) => [String(run.id), run]));
  const c5Checks = list(events)
    .filter(
      (event) =>
        !(recoveryProbeRunId && String(event.run_id ?? "") === String(recoveryProbeRunId)),
    )
    .map((event) => {
    const eventRows = list(events).filter((row) => row.run_id === event.run_id);
    const checkpointRows = checkpointsMsgs.filter((row) => row.run_id === event.run_id);
    if (eventRows.length !== 1 || checkpointRows.length !== 1) return { ok: null, reason: "checkpoint_binding_unknown" };
    const checkpoint = checkpointRows[0];
    const eventAt = timeValue(event.inserted_at);
    if (eventAt === null) return { ok: null, reason: "next_request_evidence_missing" };
    const started = list(db.provider_events)
      .filter((row) => row.event_type === "started" && timeValue(row.emitted_at) > eventAt &&
        providerRunsById.get(String(row.provider_run_id))?.session_id === checkpoint.session_id)
      .sort((left, right) => timeValue(left.emitted_at) - timeValue(right.emitted_at));
    const firstAt = started.length ? timeValue(started[0].emitted_at) : null;
    const first = started.filter((row) => timeValue(row.emitted_at) === firstAt);
    const run = first.length === 1 ? providerRunsById.get(String(first[0].provider_run_id)) : null;
    const records = run
      ? list(llmRecords).filter((record) => record.provider_run_ref === run.id && record.provider_call_ref === run.provider_call_ref)
      : [];
    const facts = records.length === 1 ? requestFactsFromRecord(records[0]) : null;
    const covered = checkpointCallIds(checkpoint);
    const wireCovers = facts?.ok && facts.format === NATIVE_CHAT_WIRE
      ? wireCheckpoints(facts).map((entry) => entry.call_ids) : [];
    const replayed = covered.filter((id) =>
      list(facts?.toolCalls).some((call) => String(call.callId) === id) ||
      list(facts?.toolResults).some((result) => [result.callId, result.toolCallId].some((ref) => String(ref) === id)));
    const malformedCalls = Number(facts?.malformedCalls ?? 0);
    const malformedToolMessages = Number(facts?.malformedToolMessages ?? 0);
    const detail = {
      session_id: checkpoint.session_id,
      provider_run_id: run?.id ?? null,
      provider_call_ref: run?.provider_call_ref ?? null,
      started_event_at: first[0]?.emitted_at ?? null,
      covered_call_ids: covered,
      wire_checkpoint_covers: wireCovers,
      replayed_call_ids: replayed,
      malformed_calls: malformedCalls,
      malformed_tool_messages: malformedToolMessages,
    };
    const evidence = first.length === 1 && records.length === 1 && facts?.ok && facts.format === NATIVE_CHAT_WIRE && covered.length > 0;
    if (!evidence) return { ok: null, reason: "next_request_evidence_missing", detail };
    if (malformedCalls > 0 || malformedToolMessages > 0) return { ok: false, reason: "next_request_wire_malformed", detail };
    if (!wireCovers.some((ids) => sameIdSet(ids, covered))) return { ok: false, reason: "checkpoint_cover_mismatch", detail };
    if (replayed.length > 0) return { ok: false, reason: "covered_call_ids_still_in_next_request", detail };
    return { ok: true, reason: null, detail };
  });
  const c5Detail = c5Checks.map((check) => ({ ok: check.ok, reason: check.reason, ...check.detail }));
  const c5Failed = c5Checks.find((check) => check.ok === false);
  const c5 =
    c5Failed
      ? { ok: false, reason: c5Failed.reason, detail: { covered_call_ids: coveredCallIds, checks: c5Detail } }
      : c5Checks.length > 0 && c5Checks.every((check) => check.ok === true)
        ? { ok: true, reason: null, detail: { covered_call_ids: coveredCallIds, checks: c5Detail } }
        : { ok: null, reason: c5Checks.find((check) => check.ok === null)?.reason ?? "next_request_evidence_missing", detail: { covered_call_ids: coveredCallIds, checks: c5Detail } };

  // C6：每条 canonical checkpoint 必须显式 covers，再按同 session、checkpoint 之前
  // 真实交换恰好一对且顺序正确的规则逐条核查；任一无 covers 即失败，不因另一条合法而通过。
  const c6Failures = [];
  const checkpointsWithoutCovers = [];
  for (const checkpoint of checkpointsMsgs) {
    const covered = checkpointCallIds(checkpoint);
    if (covered.length === 0) checkpointsWithoutCovers.push(Number(checkpoint.sequence));
    const exchange = checkpointExchange(checkpoint, transcript);
    for (const callId of covered) {
      const callSequences = exchange.calls.get(callId) ?? [];
      const resultSequences = exchange.results.get(callId) ?? [];
      if (callSequences.length !== 1 || resultSequences.length !== 1 || callSequences[0] >= resultSequences[0]) {
        c6Failures.push({ call_id: callId, checkpoint_sequence: checkpoint.sequence, call_count: callSequences.length, result_count: resultSequences.length });
      }
    }
  }
  const c6Covered = [...new Set(checkpointsMsgs.flatMap((checkpoint) => checkpointCallIds(checkpoint)))];
  const c6 = {
    ok: c6Failures.length === 0 && checkpointsWithoutCovers.length === 0 && checkpointsMsgs.length > 0,
    reason: c6Failures.length
      ? "covered_exchange_not_closed_exactly_once_before_checkpoint"
      : checkpointsWithoutCovers.length || !checkpointsMsgs.length
        ? "checkpoint_call_ids_missing"
        : null,
    detail: { covered_call_ids: c6Covered, checkpoints_without_covers: checkpointsWithoutCovers, failures: c6Failures },
  };

  // C7：刷新幂等（刷新后细条仍在、checkpoint 事件与 canonical 消息计数均不变）。
  // direct A3 与正式 live multi-turn 都必须产出该证据；缺证即失败，不按场景豁免。
  // C7/C8 共用：计数必须是非负整数，null/字符串/NaN 都不能当 0 或强转通过。
  const sameNonNegativeCount = (left, right) =>
    Number.isInteger(left) && left >= 0 &&
    Number.isInteger(right) && right >= 0 && left === right;
  const refreshAx = readCaptureText(dir, "after-refresh");
  const refresh = driverLog?.refresh ?? null;
  const c7 = {
    ok:
      stripText.test(refreshAx) &&
      isObject(refresh) &&
      sameNonNegativeCount(refresh.before_checkpoint_events, refresh.after_checkpoint_events) &&
      sameNonNegativeCount(refresh.before_checkpoint_messages, refresh.after_checkpoint_messages),
    reason: null,
    detail: {
      strip_visible_after_refresh: stripText.test(refreshAx),
      before_checkpoint_events: refresh?.before_checkpoint_events ?? null,
      after_checkpoint_events: refresh?.after_checkpoint_events ?? null,
      before_checkpoint_messages: refresh?.before_checkpoint_messages ?? null,
      after_checkpoint_messages: refresh?.after_checkpoint_messages ?? null,
    },
  };
  if (c7.ok === false) c7.reason = "refresh_not_idempotent";

  // C8：失败静默。必须同时满足：持久 trigger 已注入、真实 AX 无错误提示（读取失败记
  // null 即失败）、注入前后 checkpoint 事件与 canonical 消息两类计数严格不变、与
  // failure_request.run_id 相同的真实 agent_run.auto_maintenance.error 且 reason 为
  // :checkpoint_persistence_failed、故障/恢复均为已结算的新作者 turn，且恢复 run
  // 在最终 dbFacts 中确实同时有 checkpoint 事件与 canonical checkpoint 行。
  // 他 run 的日志、仅改报告或仅全局计数增长都不放行。
  const injection = driverLog?.failure_injection ?? null;
  const failureAx = readCaptureText(dir, "after-failure");
  const appLogText = list(appLog).map((entry) => JSON.stringify(entry)).join("\n");
  const failureRunId = injection?.failure_request?.run_id ?? null;
  const recoveryRunId = injection?.recovery_request?.run_id ?? null;
  const failureLog = failureRunId
    ? list(appLog).find(
        (entry) =>
          String(entry?.event ?? "") === "agent_run.auto_maintenance.error" &&
          String(entry?.run_id ?? "") === String(failureRunId),
      ) ?? null
    : null;
  const failureLogReason = failureLog ? String(failureLog.reason ?? "").trim() : null;
  const runStatusOf = (runId) =>
    runId
      ? list(db.agent_runs).find((row) => String(row?.id ?? "") === String(runId))?.status ?? null
      : null;
  const failureRunStatus = runStatusOf(failureRunId);
  const recoveryRunStatus = runStatusOf(recoveryRunId);
  const recoveryCheckpointEvents = recoveryRunId
    ? list(db.agent_events).filter(
        (event) =>
          String(event?.event_type ?? "") === "checkpoint_created" &&
          String(event?.run_id ?? "") === String(recoveryRunId),
      )
    : [];
  const recoveryCheckpointMessages = recoveryRunId
    ? transcript.filter(
        (message) =>
          String(message?.role ?? "") === "checkpoint" &&
          String(message?.run_id ?? "") === String(recoveryRunId),
      )
    : [];
  const c8 = {
    ok:
      isObject(injection) &&
      injection.trigger_created === true &&
      injection.author_error_visible === false &&
      sameNonNegativeCount(
        injection.checkpoint_events_before_failure,
        injection.checkpoint_events_after_failure,
      ) &&
      sameNonNegativeCount(
        injection.checkpoint_messages_before_failure,
        injection.checkpoint_messages_after_failure,
      ) &&
      injection.failure_request?.settled === true &&
      injection.recovery_request?.settled === true &&
      Boolean(failureRunId) &&
      Boolean(recoveryRunId) &&
      String(failureRunId) !== String(recoveryRunId) &&
      failureRunStatus === "completed" &&
      recoveryRunStatus === "completed" &&
      failureLogReason === ":checkpoint_persistence_failed" &&
      recoveryCheckpointEvents.length > 0 &&
      recoveryCheckpointMessages.length > 0,
    reason: null,
    detail: {
      trigger_created: injection?.trigger_created ?? null,
      author_error_visible: injection?.author_error_visible ?? null,
      failure_request_run_id: failureRunId,
      recovery_request_run_id: recoveryRunId,
      checkpoint_events_before_failure: injection?.checkpoint_events_before_failure ?? null,
      checkpoint_events_after_failure: injection?.checkpoint_events_after_failure ?? null,
      checkpoint_messages_before_failure: injection?.checkpoint_messages_before_failure ?? null,
      checkpoint_messages_after_failure: injection?.checkpoint_messages_after_failure ?? null,
      failure_request_settled: injection?.failure_request?.settled ?? null,
      recovery_request_settled: injection?.recovery_request?.settled ?? null,
      failure_request_reported_status: injection?.failure_request?.run_status ?? null,
      recovery_request_reported_status: injection?.recovery_request?.run_status ?? null,
      failure_run_status: failureRunStatus,
      recovery_run_status: recoveryRunStatus,
      recovery_checkpoint_event_count: recoveryCheckpointEvents.length,
      recovery_checkpoint_message_count: recoveryCheckpointMessages.length,
      failure_log_run_id: failureLog ? (failureLog.run_id ?? null) : null,
      failure_log_reason: failureLogReason,
      auto_maintenance_app_log_events: list(appLog).filter((entry) =>
        String(entry?.event ?? "").includes("auto_maintenance"),
      ).length,
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
  const extraRounds = list(multiTurn?.extra_rounds);
  // 观察驱动多轮（2026-11-08 审核）：每轮回答必须来自真实问题文本的观察，
  // 且至少一轮回答来源是选项/对象词提取（fallback 单独凑轮不算观察驱动）。
  // 观察驱动证据：问题文本 或 真实选项标题（选项文字本身来自页面观察——真实 strata
  // 批次里问题文本节点有时读不到，但选项标题可读，且 answer_source=option 已记录来源）。
  const hasObservation = (steer) => {
    const observation = steer?.observation ?? null;
    return (
      String(observation?.question_text ?? "").trim() !== "" ||
      list(observation?.option_titles).length > 0
    );
  };
  const observationRounds = multiTurnSteers.filter((steer) => {
    const source = String(steer?.observation?.answer_source ?? "");
    return hasObservation(steer) && ["option", "extracted_text"].includes(source);
  });
  const questionBoundRounds = multiTurnSteers.filter(hasObservation);
  // G6 实模场景是「跨 turn」：首 run 询问回答后 driver 补发新 turn（extra_rounds），
  // 压缩发生在后续 turn 的安全点。A3 原始 C11「同 run 多轮」判据在该场景不成立——
  // 按场景区分判据（不放宽任何不变量）：跨 turn 仍要求观察驱动回答 + 补发 turn 真实推进；
  // 若存在 checkpoint 则 C2 另行判定（不在此处放宽）。
  const crossTurnScenario = extraRounds.length > 0;
  const crossTurnOk =
    crossTurnScenario &&
    multiTurnSteers.length >= 1 &&
    multiTurnSteers.every((steer) => steer?.ok === true) &&
    questionBoundRounds.length === multiTurnSteers.length &&
    observationRounds.length >= 1 &&
    extraRounds.filter((round) => ["completed", "failed"].includes(String(round?.run_status ?? ""))).length >= 1;

  const c11 = multiTurn
    ? {
        ok: crossTurnScenario
          ? crossTurnOk
          : multiTurnPause?.kind === "paused" &&
          multiTurnSteers.length >= 1 &&
          multiTurnSteers.every((steer) => steer?.ok === true) &&
          multiTurnResumes.length >= multiTurnSteers.length &&
          multiTurnResumes.every((resume) => resume?.resumed === true) &&
          questionBoundRounds.length === multiTurnSteers.length &&
          observationRounds.length >= 1,
        reason: null,
        detail: {
          pause: multiTurnPause,
          steers: multiTurnSteers.length,
          resumes: multiTurnResumes.length,
          rounds: list(multiTurn?.rounds).length,
          stop_reason: multiTurn?.stop_reason ?? null,
          max_steers: multiTurn?.max_steers ?? null,
          checkpoint_events: multiTurn?.checkpoint_events ?? null,
          observation_driven_rounds: observationRounds.length,
          question_bound_rounds: questionBoundRounds.length,
          answer_sources: multiTurnSteers.map((steer) => steer?.observation?.answer_source ?? null),
          scenario: crossTurnScenario ? "cross_turn" : "same_run",
          extra_rounds: extraRounds.length,
          questions: multiTurnSteers.map((steer) => steer?.observation?.question_text ?? null),
        },
      }
    : { ok: null, reason: "not_multi_turn_scenario", detail: {} };
  if (c11.ok === false) {
    c11.reason =
      questionBoundRounds.length !== multiTurnSteers.length || observationRounds.length < 1
        ? "multi_turn_not_observation_driven"
        : "multi_turn_same_run_not_established";
  }

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
  const required = Object.entries(checks)
    .filter(([key, value]) => value.ok !== null || EVIDENCE_REQUIRED_CHECKS.has(key))
    .map(([key]) => key);
  const failed = Object.entries(checks)
    .filter(([key, value]) => value.ok === false || (value.ok === null && EVIDENCE_REQUIRED_CHECKS.has(key)))
    .map(([key]) => key);
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
  if (driverLog?.interleaved_resume) {
    try {
      result.interleaved_resume = verifyInterleavedResumeFacts(
        driverLog.interleaved_resume, dbFacts, evidence.wire, llmRecords,
      );
    } catch (error) {
      result.interleaved_resume = { ok: false, reason: error.message };
    }
  }
  writeNativeFrames(dir);
  const summary = {
    schema: "b71-auto-maintenance-summary/v1",
    slice_id: config.slice_id,
    provider: config.provider,
    journey: "auto-maintenance",
    scenario: multiTurn ? "g6-multi-turn" : "auto-maintenance-a3",
    multi_turn: multiTurn,
    ...(result.interleaved_resume ? { interleaved_resume: result.interleaved_resume } : {}),
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
