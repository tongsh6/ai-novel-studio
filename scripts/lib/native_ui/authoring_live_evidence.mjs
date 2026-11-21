// B71 CP3b 实模（真实 provider=strata）行为的原生证据判据。
//
// 真实模型行为不确定：驱动只负责像用户一样操作与等待终局，本模块只验证「结构事实」：
// canonical IR wire 投影结构、无 giant user、无 user/user 伪纠错、追加式前缀、
// tool_call/result call_id 绑定、观察回流、作者字节、未采纳零写入、usage、Why 零调用；
// 不要求固定文本或固定调用次数。判据分层输出 mechanism / model_behavior / not_signed，
// 模型未触发的切片如实登记，不伪造覆盖、不代签 G2–G5 与 I10。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isVisibleNode } from "./scenario_driver.mjs";
import { checkAuthorVisibleTexts } from "./author_visible_check.mjs";
import { missionSourceChecks } from "./authoring_chapter_mission_evidence.mjs";
import { assistantCalls, sourceMissionEvents, sourceMissionNarrativeContext, validations } from "./authoring_revision_evidence.mjs";
import { canonicalRequestBindingsForProviderCall, scopeForProviderCall } from "./authoring_call_evidence.mjs";
import { actionLabelsFor, locatePendingItem, locateScopedButton, selectPendingAction, writerArtifactMatch } from "./authoring_pending_evidence.mjs";
import { providerFreeInterval } from "./authoring_planning_evidence.mjs";
import {
  all,
  assertAllChecks,
  assertCommonEvidence,
  assertProviderAndWire,
  assertRecordFresh,
  frameBody,
  frameEvent,
  frameOf,
  read,
  sha256,
  shaFile,
  withDb,
  writeNativeFrames,
  writeNativeSummary,
} from "./scenario_evidence.mjs";
import { authorVisibleScenario, readConfig } from "./authoring_capture_evidence.mjs";
import {
  bindNativeCalls,
  fingerprintUnchanged,
  lastCompletedTurn,
  readR05Inputs,
  g2CandidateReport,
  g2PageReport,
  g2UsageReport,
} from "./authoring_run_evidence.mjs";
import { authorBoundary, axTurnOutcome, countAxAuthorMessages, g2VisibleEvidence, g3VisibleEvidence } from "./authoring_g2_evidence.mjs";
import {
  NATIVE_CHAT_WIRE,
  requestFactsFromBody,
  requestFactsFromRecord,
} from "./authoring_request_facts.mjs";
import {
  notSignedSlices,
  recordResponseToolCalls,
  recordUsageFacts,
  summarizeModelBehavior,
} from "./live_run_wait.mjs";
import { liveRefsCheck } from "./authoring_live_refs.mjs";
import { readBatchAuthoringHistory, readRunRefFacts } from "./authoring_history_evidence.mjs";
import { r05GoalEvidence, r05VisibleEvidence, r05ReplyEdgeVisible, renderedNarrativeNodes } from "./authoring_r05_evidence.mjs";
import { compareAuthoringCanonSnapshots, compareSourceDesignSnapshots } from "./authoring_canon_evidence.mjs";

export const LIVE_CHECKS_SCHEMA = "b71-live-checks/v1";
export const LIVE_CHECKPOINTS = Object.freeze(["start", "final"]);
// 2026-11-07 作者裁决 A：实模批次按当前 Strata 可用模型重冻结；默认保持历史 iq3_s。
export const DEFAULT_LIVE_MODEL = process.env.B71_STRATA_MODEL || "iq3_s";

const APPLICATION_PREFIX = "【应用数据 · ";
const APPLICATION_BASE_PREFIX = "【应用数据 · application_base";
const APPLICATION_SCOPE_PREFIX = "【应用数据 · scope_update";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";

function messageContent(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

// 实模只消费真实原生 wire；fixture IR 是另一条现役来源，不能被当作 Chat wire。
function nativeRequest(record) {
  const facts = requestFactsFromRecord(record);
  return facts.ok && facts.format === NATIVE_CHAT_WIRE ? facts : null;
}

function messagesOf(record) {
  const facts = nativeRequest(record);
  assert(
    facts !== null,
    `llm-calls 记录缺可读原生 request messages：${record?.provider_call_ref ?? "unknown"}`,
  );
  return facts.messages;
}

function isApplicationMessage(message) {
  return messageContent(message).startsWith(APPLICATION_PREFIX);
}

function isApplicationBase(message) {
  return messageContent(message).startsWith(APPLICATION_BASE_PREFIX);
}

function isApplicationScope(message) {
  return messageContent(message).startsWith(APPLICATION_SCOPE_PREFIX);
}

function isAuthorMessage(message, authorText) {
  return message?.role === "user" && messageContent(message) === authorText;
}

function toolCallsOf(messages) {
  const calls = [];
  for (const message of messages) {
    if (message?.role !== "assistant") continue;
    const messageCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const call of messageCalls) {
      calls.push({
        id: call?.id ?? null,
        name: call?.function?.name ?? call?.name ?? null,
        arguments: call?.function?.arguments ?? call?.arguments ?? null,
      });
    }
  }
  return calls;
}

function toolMessagesOf(messages) {
  const facts = requestFactsFromBody({ messages });
  if (!facts.ok) return [];
  return facts.toolResults.map((result) => ({
    tool_call_id: result.toolCallId,
    content: messageContent(result.raw),
  }));
}

function extractRefs(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const refs = new Set();
  // 仅收集键名以 ref 结尾的字符串字段（ref/chapter_ref/pending_artifact_ref/…）；
  // 不猜测其它字段语义。
  for (const match of text.matchAll(/"([^"]*ref)"\s*:\s*"([^"]+)"/gu)) {
    if (nonBlank(match[2])) refs.add(match[2]);
  }
  return refs;
}

function orderedRecords(records, turnId) {
  // 实模只认真实 strata 记录的 request.body 原生 wire；fixture canonical IR
  // 由 authoring_request_facts 的 explicit source format 分支消费，不能混作 Chat。
  return records
    .filter((record) => record?.turn_id === turnId && nativeRequest(record) !== null)
    .sort((left, right) => String(left.ts ?? "").localeCompare(String(right.ts ?? "")));
}

// 同一创作 run 的请求链：真实 B71 bounded run 的工具步 turn 形如
// `<parent_turn>:agent:<N>`，它们与 parent turn 共享同一条追加式 transcript；
// 判据必须按 run 合并比较，不能按 turn_id 分段（否则前缀/回放会被真空跳过）。
function runKeyOf(turnId) {
  return String(turnId ?? "").replace(/:agent:\d+$/u, "");
}

function runSequences(records) {
  const byRun = new Map();
  for (const record of records) {
    if (nativeRequest(record) === null) continue;
    const key = runKeyOf(record.turn_id);
    const list = byRun.get(key) ?? [];
    list.push(record);
    byRun.set(key, list);
  }
  for (const list of byRun.values()) {
    list.sort((left, right) => String(left.ts ?? "").localeCompare(String(right.ts ?? "")));
  }
  return byRun;
}

function samePrefix(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next)) return false;
  if (next.length < previous.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (JSON.stringify(previous[index]) !== JSON.stringify(next[index])) return false;
  }
  return true;
}

function canonSnapshotOf(checkpoint) {
  assert(isObject(checkpoint?.authoring_canon), `live checkpoint 缺 authoring_canon 快照：${checkpoint?.checkpoint ?? "unknown"}`);
  return checkpoint.authoring_canon;
}

function canonTablesEqual(left, right) {
  const leftTables = left?.tables ?? {};
  const rightTables = right?.tables ?? {};
  const names = new Set([...Object.keys(leftTables), ...Object.keys(rightTables)]);
  for (const name of names) {
    const a = leftTables[name];
    const b = rightTables[name];
    if (!a || !b) return { equal: false, changed: [name] };
    if (a.row_count !== b.row_count || a.canon_sha256 !== b.canon_sha256) {
      return { equal: false, changed: [name] };
    }
  }
  return { equal: true, changed: [] };
}

function countOf(table, checkpoint) {
  const counts = checkpoint?.db_production_counts ?? {};
  return typeof counts[table] === "number" ? counts[table] : null;
}

// L9（Lead 03 裁定）：机制硬条件 + 允许并如实记录有支撑的 TENTATIVE 设计态派生。
// - 硬条件：无 receipt/adoption、无 mutations、无 CONFIRMED/已采纳内容变化（章节行级
//   approved hash 不变）、正文/其它 canon 表 hash 不变、无内存绑定新增；
// - 允许：chapters.plan_direction 的 model/TENTATIVE mission 派生，但每条必须有真实
//   pcall（在真实 llm-calls 中）+ decision_trace + basis_ref（observation/plan）支撑；
//   无 pcall 或来源不明 → invalid，L9 失败。
export function liveZeroWriteLayers({ startCanon, finalCanon, startCounts, finalCounts, dbFacts = null, strataRecords = [], pendingArtifacts = [] } = {}) {
  const startTables = startCanon?.tables ?? {};
  const finalTables = finalCanon?.tables ?? {};
  const changedTables = [];
  for (const name of new Set([...Object.keys(startTables), ...Object.keys(finalTables)])) {
    if (name === "chapters") continue; // chapters 单独按行级证据判定（允许设计态派生）
    const a = startTables[name];
    const b = finalTables[name];
    if (!a || !b) {
      changedTables.push(name);
      continue;
    }
    if (a.row_count !== b.row_count || a.canon_sha256 !== b.canon_sha256) changedTables.push(name);
  }
  const otherTablesEqual = changedTables.length === 0;

  const startChapters = isObject(startCanon?.chapters) ? startCanon.chapters : {};
  const finalChapters = isObject(finalCanon?.chapters) ? finalCanon.chapters : {};
  const startIds = Object.keys(startChapters).sort();
  const finalIds = Object.keys(finalChapters).sort();
  const sameIdSet = startIds.length === finalIds.length && startIds.every((id, index) => id === finalIds[index]);
  let chaptersApprovedEqual = sameIdSet;
  for (const id of finalIds) {
    const startRow = startChapters[id];
    const finalRow = finalChapters[id];
    if (!startRow || !finalRow || startRow.approved_sha256 !== finalRow.approved_sha256) {
      chaptersApprovedEqual = false;
    }
  }

  // B3 修复：canon 零写改为 start→final delta（states.yml 声明的 memory/pending 是基线，
  // 不是违规）；无 start 快照的旧批次回退绝对零（保持旧语义）。
  const counts = finalCounts ?? {};
  const startCountsObj = startCounts ?? {};
  const hasStartCounts = Object.keys(startCountsObj).length > 0;
  const delta = (startValue, finalValue) => Number(finalValue ?? 0) - Number(startValue ?? 0);
  const noReceipts = hasStartCounts
    ? delta(startTables.author_action_receipts?.row_count, finalTables.author_action_receipts?.row_count) === 0
    : (counts.author_action_receipts ?? 0) === 0 && (finalTables.author_action_receipts?.row_count ?? 0) === 0;
  const noMemoryRows = hasStartCounts
    ? delta(startTables.memory_items?.row_count, finalTables.memory_items?.row_count) === 0
    : (finalTables.memory_items?.row_count ?? 0) === 0;
  const noMutations = hasStartCounts || dbFacts?.mutations_count !== undefined
    ? delta(startCountsObj.mutations, dbFacts?.mutations_count ?? counts.mutations) <= 0
    : Number(counts.mutations ?? 0) === 0;
  const pendingTentative = pendingArtifacts.every(
    (artifact) => String(artifact?.adoption_status ?? "") === "TENTATIVE",
  );

  const pcallSet = new Set(strataRecords.map((record) => record.provider_call_ref).filter(Boolean));
  const traceRows = Array.isArray(dbFacts?.decision_traces) ? dbFacts.decision_traces : [];
  const traceIds = traceRows.map((row) => String(row?.trace_id ?? "")).filter(Boolean);
  // 章节设计态变化必须由 start/final 的行级证据证明；旧快照（chapters 为 {} 或非行级
  // 证据）无法证明变化时不做派生判定、也不据此 fail（记 design_state_evidence=missing）。
  const hasRowLevelEvidence = (chapters) =>
    isObject(chapters) &&
    Object.values(chapters).some(
      (entry) => isObject(entry) && typeof entry.design_state_sha256 === "string",
    );
  const rowLevelEvidenceAvailable = hasRowLevelEvidence(startChapters) && hasRowLevelEvidence(finalChapters);
  const derivations = [];
  const invalid = [];
  for (const row of Array.isArray(dbFacts?.chapters_rows) ? dbFacts.chapters_rows : []) {
    let planDirection = null;
    try {
      planDirection = JSON.parse(String(row?.plan_direction ?? ""));
    } catch {
      planDirection = null;
    }
    const mission = isObject(planDirection?.chapter_mission) ? planDirection.chapter_mission : null;
    if (!mission) continue;
    if (!rowLevelEvidenceAvailable) continue; // 无行级证据：无法证明本轮设计态变化，不判派生
    const startRow = startChapters[row.id];
    const finalRow = finalChapters[row.id];
    if (!startRow || !finalRow) continue; // 新增/缺失章节行不在派生判定范围（由 approved 行集判定覆盖）
    if (startRow.design_state_sha256 === finalRow.design_state_sha256) continue; // 本轮未变化的设计态不计派生
    const basisRefs = [...(mission.must_advance ?? []), ...(mission.must_avoid ?? [])]
      .map((item) => item?.basis_ref ?? null)
      .filter((ref) => typeof ref === "string" && ref !== "");
    const providerCallRef = mission.provider_call_ref ?? null;
    const source = String(mission.source ?? "");
    const status = String(mission.status ?? "");
    const reasons = [];
    if (source !== "model") reasons.push(`source_not_model:${source}`);
    if (status !== "TENTATIVE") reasons.push(`status_not_tentative:${status}`);
    if (!providerCallRef || !pcallSet.has(providerCallRef)) reasons.push(`pcall_not_in_real_calls:${providerCallRef}`);
    if (basisRefs.length === 0 || !basisRefs.every((ref) => /^(?:observation|plan):/u.test(ref))) {
      reasons.push("basis_ref_not_from_observation_or_plan");
    }
    if (traceIds.length === 0) reasons.push("decision_trace_missing");
    const entry = {
      chapter_id: row.id,
      chapter_title: row.title ?? null,
      mission_id: mission.mission_id ?? null,
      statement: String(mission.statement ?? "").slice(0, 240),
      source,
      status,
      provider_call_ref: providerCallRef,
      basis_refs: basisRefs,
      decision_trace_refs: traceIds,
      approved_unchanged:
        startChapters[row.id]?.approved_sha256 === finalChapters[row.id]?.approved_sha256,
      valid: reasons.length === 0,
      reason: reasons.length === 0 ? null : reasons.join(","),
      why_not_canon:
        "model/TENTATIVE 设计态派生（VS-00E §16.8 推理完成即存暂定），有真实 pcall/basis/decision_trace 支撑；非作者采纳、不写正文/canon 已采纳字段",
    };
    if (entry.valid) derivations.push(entry);
    else invalid.push(entry);
  }

  return {
    ok:
      otherTablesEqual &&
      chaptersApprovedEqual &&
      noReceipts &&
      noMemoryRows &&
      noMutations === true &&
      pendingTentative &&
      invalid.length === 0,
    other_tables_equal: otherTablesEqual,
    changed_tables: changedTables,
    chapters_approved_equal: chaptersApprovedEqual,
    no_receipts: noReceipts,
    no_memory_rows: noMemoryRows,
    no_mutations: noMutations,
    pending_tentative: pendingTentative,
    design_state_evidence: rowLevelEvidenceAvailable ? "row_level" : "missing",
    tentative_design_derivations: derivations,
    invalid_design_derivations: invalid,
  };
}

// L1–L12：真实 provider 记录的纯判据。返回 mechanism 必过项、model_behavior 事实与
// not_signed 切片；未触发项为 null，不以“未发生”冒充成立。
export function b71LiveModelBehavior({ dir, config, llmRecords, wire, startCheckpoint, finalCheckpoint, driverLog, dbFacts = null, model = DEFAULT_LIVE_MODEL }) {
  const authorText = String(config?.message ?? "");
  const records = Array.isArray(llmRecords) ? llmRecords : [];
  const strataRecords = records.filter((record) => record?.provider === "strata");
  assert(strataRecords.length > 0, "live verifier 需要至少一条 provider=strata 的真实调用记录");

  const turnIds = [...new Set(strataRecords.map((record) => record.turn_id).filter(nonBlank))];
  const requestMessages = strataRecords.map((record) => ({ record, messages: messagesOf(record), turnId: record.turn_id }));
  const wireRecords = Array.isArray(wire) ? wire : [];
  const turnResultRecords = wireRecords.filter(
    (record) => record?.direction === "received" && frameEvent(record) === "turn_result" && turnIds.includes(String(frameBody(record)?.turn_id ?? "")),
  );
  const turnBodies = turnResultRecords.map((record) => frameBody(record) ?? {});
  const turnBody = turnBodies.at(-1) ?? null;

  // L1 结构：system/application_base 与独立 author user 消息齐全。
  const l1 = requestMessages.every(
    (entry) =>
      entry.messages.some((message) => message?.role === "system") &&
      entry.messages.some((message) => isApplicationBase(message)) &&
      entry.messages.some((message) => isAuthorMessage(message, authorText)),
  );

  // L2 无 giant user：不存在同时包含 application_base 标记与作者原话的 user 消息。
  const l2 = requestMessages.every(
    (entry) =>
      !entry.messages.some(
        (message) =>
          message?.role === "user" &&
          messageContent(message).includes(APPLICATION_BASE_PREFIX) &&
          authorText !== "" &&
          messageContent(message).includes(authorText),
      ),
  );

  // L3 无 user/user 伪纠错：author 之后只允许应用数据 user 消息；assistant/tool 之后
  // 也不允许作者纠错型 user 消息；每条请求里 author 原话恰好一条。
  const l3 = requestMessages.every((entry) => {
    const messages = entry.messages;
    const authorIndexes = messages
      .map((message, index) => (isAuthorMessage(message, authorText) ? index : -1))
      .filter((index) => index >= 0);
    if (authorIndexes.length !== 1) return false;
    const authorIndex = authorIndexes[0];
    for (let index = authorIndex + 1; index < messages.length; index += 1) {
      const message = messages[index];
      if (message?.role !== "user") continue;
      if (isApplicationScope(message) || isApplicationMessage(message)) continue;
      return false;
    }
    return true;
  });

  // L4 追加式前缀：同一创作 run（含 <turn>:agent:N step turn）的连续真实请求，
  // 后续请求 messages 必须严格以先前为前缀。
  const runs = runSequences(strataRecords);
  const l4Failures = [];
  for (const [runKey, ordered] of runs) {
    const messagesList = ordered.map((record) => messagesOf(record));
    for (let index = 1; index < messagesList.length; index += 1) {
      if (!samePrefix(messagesList[index - 1], messagesList[index])) {
        l4Failures.push({ run_key: runKey, index });
      }
    }
  }
  const l4 = l4Failures.length === 0;

  // L5/L6 工具调用/结果绑定与观察回流：唯一事实源 = 实时 provider 响应里的 tool_calls。
  // 请求 messages 里的 assistant.tool_calls 是追加式历史回放，只累加回放观测，不建立
  // 新绑定；因此用 call_id 主键的 Map 前置归并，而不是事后过滤重复项。
  // 跨 turn 的 step turn（<turn>:agent:N）按同一 run 合并：否则父 turn 最后一条调用的
  // 结果会落在子 turn 的请求里而被误判「未回流」。
  const toolBinding = new Map();
  let replayOnlyCalls = 0;
  for (const [runKey, ordered] of runs) {
    ordered.forEach((record, index) => {
      const messages = messagesOf(record);
      const responseCalls = recordResponseToolCalls(record);
      for (const call of responseCalls) {
        const callId = call?.id ?? null;
        if (!callId || toolBinding.has(callId)) continue;
        toolBinding.set(callId, {
          run_key: runKey,
          turn_id: record.turn_id,
          call_id: callId,
          name: call?.function?.name ?? call?.name ?? null,
          first_request_index: index,
          last_request_in_run: index === ordered.length - 1,
          first_provider_call_ref: record.provider_call_ref ?? null,
          replayed_in_requests: 0,
          bound_in_later_request: false,
          terminal_without_replay: false,
          observation_length: 0,
        });
      }
      for (const call of toolCallsOf(messages)) {
        if (!call.id) continue;
        const binding = toolBinding.get(call.id);
        if (binding) binding.replayed_in_requests += 1;
        else replayOnlyCalls += 1;
      }
      const toolMessages = toolMessagesOf(messages);
      for (const binding of toolBinding.values()) {
        if (binding.run_key !== runKey || binding.bound_in_later_request) continue;
        if (binding.first_request_index >= index) continue;
        const hit = toolMessages.find((message) => message.tool_call_id === binding.call_id);
        if (hit) {
          binding.bound_in_later_request = true;
          binding.observation_length = hit.content.length;
        }
      }
    });
  }
  const toolBindings = [...toolBinding.values()];
  // 真实 agent 边界：run 内最后一次请求发出的工具调用不会再有「后续真实请求」——
  // 其结果由 run 终局（completed）与产品链处理证明，不要求回放到下一次模型请求；
  // 其余所有调用都必须按 call_id 绑定 tool result 并出现在后续请求中。
  for (const binding of toolBindings) {
    binding.terminal_without_replay = binding.last_request_in_run && !binding.bound_in_later_request;
  }
  const nonTerminalBindings = toolBindings.filter((entry) => !entry.terminal_without_replay);
  const l5 = toolBinding.size === 0 ? null : nonTerminalBindings.every((entry) => entry.bound_in_later_request);
  const l6 =
    toolBinding.size === 0
      ? null
      : nonTerminalBindings.length > 0 &&
        nonTerminalBindings.every((entry) => entry.bound_in_later_request && entry.observation_length > 0);

  // L7 逐调用 used_refs ⊆ 同次 Base ∪ 同次 observation（VS-00L §7 G2/§16.9）：
  // canonical assistant(model) 的 self_report 按顶层 pcall+prun 配对唯一真实
  // llm record，边界只从该 record 的明确 application_base/scope 正式条目与唯一
  // 成功 observation 读取；checkpoint/notice/作者原文不授信，段头 used_refs、
  // decision_traces、agent_events 不参与正判，无法配对/解析记 null（不假过）。
  const refsCheck = liveRefsCheck({
    llmRecords: strataRecords,
    transcript: dbFacts?.segment_transcript ?? null,
    sessionMessages: dbFacts?.sessionMessages ?? null,
  });
  const l7 = refsCheck.ok;

  // L8 作者字节：每条真实请求中作者原话逐字出现且独立成 user 消息。
  const l8 = nonBlank(authorText) && requestMessages.every((entry) => entry.messages.some((message) => isAuthorMessage(message, authorText)));

  // L9 未采纳零写入（Lead 03 裁定的分层口径）：其它 canon 表/正文 hash 不变、
  // 章节已采纳字段不变、无 receipt/mutation/memory 行；允许并如实记录有 pcall/
  // decision_trace/basis_ref 支撑的 model/TENTATIVE chapter_mission 派生。
  const startCanon = canonSnapshotOf(startCheckpoint);
  const finalCanon = canonSnapshotOf(finalCheckpoint);
  const pendingArtifacts = turnBodies.flatMap((body) =>
    Array.isArray(body?.adoption_state?.pending) ? body.adoption_state.pending : [],
  );
  const zeroWrite = liveZeroWriteLayers({
    startCanon,
    finalCanon,
    startCounts: startCheckpoint.db_production_counts ?? {},
    finalCounts: finalCheckpoint.db_production_counts ?? {},
    dbFacts,
    strataRecords,
    pendingArtifacts,
  });
  const l9 = zeroWrite.ok;

  // L10 usage：每次真实调用都有 usage（prompt/completion 或 provider 原生字段）。
  const usage = strataRecords.map((record) => ({ provider_call_ref: record.provider_call_ref ?? null, ...recordUsageFacts(record) }));
  const l10 = usage.every((entry) => entry.present === true);

  // L11 Why 零 Provider：仅当驱动真实打开 Why 时判定。
  const why = driverLog?.why ?? null;
  const l11 =
    why?.opened === true
      ? Number(why?.after?.llm_records ?? NaN) === Number(why?.before?.llm_records ?? NaN) &&
        Number(why?.after?.provider_runs ?? NaN) === Number(why?.before?.provider_runs ?? NaN)
      : null;

  const behavior = summarizeModelBehavior({
    turnBody,
    llmRecords: strataRecords,
    runStatus: driverLog?.run?.status ?? null,
  });

  const mechanism = {
    ir_projection_structure: l1,
    no_giant_user_document: l2,
    no_user_pseudo_correction: l3,
    append_only_prefix: l4,
    tool_call_result_binding: l5,
    observation_reaches_next_request: l6,
    used_context_refs_within_boundary: l7,
    author_bytes_exact: l8,
    unadopted_zero_write: l9,
    usage_collected: l10,
    why_replay_zero_provider: l11,
  };
  const required = Object.entries(mechanism).filter(([, value]) => value !== null);
  const failed = required.filter(([, value]) => value !== true).map(([key]) => key);

  return {
    schema: LIVE_CHECKS_SCHEMA,
    model,
    checks: { mechanism },
    required_mechanism: required.map(([key]) => key),
    failed_mechanism: failed,
    model_behavior: behavior,
    not_signed: notSignedSlices(behavior),
    measured: {
      provider: "strata",
      model,
      turn_ids: turnIds,
      provider_calls: strataRecords.length,
      provider_call_refs: strataRecords.map((record) => record.provider_call_ref ?? null).filter(Boolean),
      request_message_counts: requestMessages.map((entry) => entry.messages.length),
      tool_calls_verified: toolBinding.size,
      replay_only_tool_calls: replayOnlyCalls,
      tool_binding: toolBindings,
      refs: refsCheck,
      canon: {
        equal: zeroWrite.other_tables_equal && zeroWrite.chapters_approved_equal,
        other_tables_equal: zeroWrite.other_tables_equal,
        changed_tables: zeroWrite.changed_tables,
        chapters_approved_equal: zeroWrite.chapters_approved_equal,
        no_receipts: zeroWrite.no_receipts,
        no_memory_rows: zeroWrite.no_memory_rows,
        no_mutations: zeroWrite.no_mutations,
        tentative_design_derivations: zeroWrite.tentative_design_derivations,
        invalid_design_derivations: zeroWrite.invalid_design_derivations,
      },
      db_production_counts: finalCheckpoint.db_production_counts ?? {},
      pending_artifacts: pendingArtifacts.map((artifact) => ({
        artifact_id: artifact?.artifact_id ?? null,
        artifact_type: artifact?.artifact_type ?? null,
        adoption_status: artifact?.adoption_status ?? null,
      })),
      usage,
      why,
    },
  };
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

// B82 §16.9：只有带预注册标记的冻结普通 live 批次要求真实 SSE 逐调用对账。
// scope 只取 readBatchAuthoringHistory 已精确绑定的 run 身份；对账要求全部既有
// checks 成立（缺响应/错属/占位都不签），且只有对账后的 records 才能进入
// b71LiveModelBehavior 签证。G2 分页是否发生与页级使用仍由专项 gate 判定。
function reconcileNativeCalls(dir, config, history, records) {
  if (!config.preregistration) return null;
  const calls = bindNativeCalls(dir, history.transcript.run, history, records);
  assertAllChecks(calls.checks, "B82 §16.9 逐调用对账");
  // 共享对账同时接受 fixture 与 SSE：冻结真实批次要求每个已绑定 ProviderRun 都有
  // 真实 SSE tool-only 记录，合法 fixture 替身不能冒充；格式解析仍只在共享层。
  assert.equal(
    calls.measured.sse_decoder_tool_only_count,
    calls.measured.bound_request_count,
    "B82 §16.9 冻结 live 只接受真实 SSE 来源：fixture 替身不能冒充真实调用",
  );
  return calls;
}

export function assertCapturedNodes(dir, name, nodes, log, common) {
  assert(Array.isArray(nodes), "AX 观察缺少原始节点");
  const captures = log.captures.filter((entry) => entry.name === name);
  assert.equal(captures.length, 1, "AX 观察必须唯一绑定 capture");
  const capture = captures[0], shot = capture.screenshot;
  assert.equal(capture.nodes, nodes.length, "AX 节点数与 capture 不一致");
  assert.equal(capture.ax_sha256, sha256(JSON.stringify(nodes)), "AX 原始节点与 capture 内容不一致");
  assert(common.ui.screenshots.includes(name + ".jpg") && shot?.ok === true &&
    shot.fallback !== true, "截图必须来自本批窗口");
  assert.equal(shot.sha256, shaFile(path.join(dir, name + ".jpg")), "截图与 capture 内容不一致");
  const textFile = path.join(dir, name + ".text.txt");
  // 缺 final 可见文本由页面判据保留缺证报告；已存在的文本必须属于同一 capture。
  if (fs.existsSync(textFile)) assert.equal(capture.text_sha256, shaFile(textFile),
    "可见文本与 capture 内容不一致");
  assert(Date.parse(capture.at) >= Date.parse(common.ready.ready_at), "AX capture 早于本批窗口");
  return capture;
}

function visibleTurnObservation(dir, config, common) {
  const observation = read(dir, "native-b71-turn-observation.json");
  assert.equal(observation.schema, "native-turn-observation/v1", "缺少真实 AX 回合观察");
  assert.equal(observation.harness_run_ref, common.ready.run_ref, "AX 观察不属于本批目标");
  assert.equal(observation.author_message, config.message, "AX 观察作者原话不一致");
  assert(Number.isInteger(observation.baseline_author_count) && observation.baseline_author_count >= 0,
    "AX 观察缺少发送前作者节点基线");
  assert.equal(observation.baseline_capture, "before-input", "AX 观察未绑定发送前截图");
  assert.equal(observation.capture, "final", "AX 观察未与最终截图绑定");
  assert.equal(observation.terminal, true, "AX 观察未完成最终采集");
  const log = read(dir, "native-b71-driver-log.json"), nodes = observation.last?.nodes;
  for (const [name, raw] of [["before-input", observation.baseline_nodes], ["final", nodes]]) {
    assertCapturedNodes(dir, name, raw, log, common);
    const works = raw.filter((node) => node.role === "AXPopUpButton" && node.desc === "作品");
    assert(works.length === 1 && works[0].title === config.author_visible_target.work_title,
      "AX 观察作品不一致");
  }
  assert.equal(observation.last.signature, sha256(JSON.stringify(nodes)), "AX 原始节点签名不一致");
  assert(Date.parse(observation.last.at) >= Date.parse(common.ready.ready_at), "最终 AX 观察早于本批窗口");
  assert.equal(observation.baseline_author_count,
    countAxAuthorMessages(observation.baseline_nodes, config.message), "AX 作者基线与发送前观察不一致");
  return { finalNodes: nodes, baselineAuthorCount: observation.baseline_author_count };
}
function visibleTextIfExists(dir, name) {
  const file = path.join(dir, `${name}.text.txt`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

// B82 G2/G3 页面消费真实 AX 归属与作者可见文本，不以内部 ref/版本/DB/wire 代签终局。
// 截图来源、驱动与等待账仍由既有 assertCommonEvidence 核对；真实模型单槽仍由
// Strata 核槽位卸载，Splash 核同进程 runtime；原始 wire/llm-calls/DB 保持原样，供独立机制审计。
function verifyAuthorVisibleBatch(dir, config, mode) {
  const target = config.author_visible_target;
  assert(target, `${config.scenario_id} 缺少冻结的作者可见目标；旧缺 visible_target 的批次只能读取既有报告，不能重新签页面`);
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: 4,
    minimumWaits: 6,
    requiredKinds: ["input", "turn", "maintenance"],
  });
  const driverLog = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  assert(driverLog, "缺少 native-b71-driver-log.json");
  assert.equal(common.ready.provider, config.provider, "ready provider 与冻结配置不一致");
  assert.equal(driverLog.provider, config.provider, "driver provider 与冻结配置不一致");
  const model = config.preregistration.model;
  assert.equal(driverLog.model, model, "driver model 与冻结模型不一致");
  let lifecycle;
  if (config.provider === "strata") {
    const strataSlot = readJsonIfExists(path.join(dir, "strata-slot.json"));
    assert(strataSlot, "缺少 strata-slot.json（批次前后槽位/卸载核验）");
    assert.equal(strataSlot.unloaded, true, "strata 批次结束必须核验 loaded=null");
    assert.equal(strataSlot.model, model, "strata 单槽模型与冻结模型不一致");
    lifecycle = { strata_slot: strataSlot };
  } else {
    // 外部 Splash 无本批模型生命周期；实际后端 facts 已由 readConfig 严格绑定。
    lifecycle = { runtime: config.runtime };
  }
  const evidenceInput = {
    ...visibleTurnObservation(dir, config, common),
    target,
    message: config.message,
    afterInputText: visibleTextIfExists(dir, "after-input"),
    finalText: visibleTextIfExists(dir, "final"),
    readingBeforeText: visibleTextIfExists(dir, "02-reading-before"),
    readingAfterText: visibleTextIfExists(dir, "03-reading-after"),
  };
  const visible = mode === "read_only" ? g3VisibleEvidence(evidenceInput) : g2VisibleEvidence(evidenceInput);
  // C9 同时覆盖原始 AX 接缝和全部实际截图文字，不按模型正文/固定文案筛掉失败。
  const scan = capturedSurfaceScan(dir, common);
  visible.captured_surface_scan = scan;
  visible.observed.all_captured_surfaces_clean = scan.ok;
  if (!scan.ok) {
    visible.ok = false;
    if (scan.captures.some((capture) => capture.missing.length > 0)) visible.failures.push("captured_surface_missing");
    if (scan.captures.some((capture) => capture.read_errors.length > 0)) visible.failures.push("captured_surface_read_error");
    if (scan.captures.some((capture) => capture.hits.length > 0)) visible.failures.push("captured_surface_internal_token_leak");
  }
  const checks = {
    schema: LIVE_CHECKS_SCHEMA,
    scenario_id: config.scenario_id,
    model,
    checks: { author_visible: visible.observed },
    required: ["author_visible"],
    failed: visible.ok ? [] : ["author_visible"],
    author_visible: visible,
    measured: {
      provider: config.provider,
      model,
      surface: "tauri-native",
      driver: common.ui.driver,
      scenario_mode: mode,
      screenshots: common.ui.screenshots,
      wait_ledger: common.ledger,
      visible_texts: ["after-input", "final", "02-reading-before", "03-reading-after"],
      ...lifecycle,
    },
    not_signed: ["mechanism", "I10_literary_quality_not_signed",
      ...(mode === "read_only" ? ["g3_validation_result_not_signed"] : [])],
  };
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(checks, null, 2));
  const summary = writeNativeSummary(dir, {
    sliceId: common.ready.slice_id,
    provider: config.provider,
    driver: common.ui.driver,
    scope: common.ui.scope,
    checks: { author_visible: visible.ok },
    measured: checks.measured,
    status: visible.ok ? "pass" : "fail",
    extra: {
      scenario_id: config.scenario_id,
      surface: "tauri-native",
      model,
      checkpoints: Object.fromEntries(LIVE_CHECKPOINTS.map((name) => [
        name, readJsonIfExists(path.join(dir, `b71-${name}.json`))?.at ?? null,
      ])),
      author_visible_target: target,
      author_visible: visible,
      verdict: { author_visible: visible.ok ? "pass" : "fail", full_g1_g6_signed: false },
      not_signed: checks.not_signed,
      screenshots: common.ui.screenshots,
      wait_ledger: common.ledger,
      ...lifecycle,
    },
  });
  assert(visible.ok, `B82 ${config.scenario_id} 作者可见证据未成立: ${visible.failures.join(", ")}`);
  console.log(`B82 ${config.scenario_id} 作者可见判据通过`);
  return { checks, summary };
}

function capturedSurfaceScan(dir, common) {
  const checks = common.ui.screenshots.map((file) => {
    const name = file.replace(/\.jpg$/u, "");
    const texts = {}, missing = [], readErrors = [];
    for (const [field, suffix] of [["axText", ".ax.txt"], ["visibleText", ".text.txt"]]) {
      const evidenceFile = name + suffix;
      try {
        texts[field] = fs.readFileSync(path.join(dir, evidenceFile), "utf8");
      } catch (error) {
        if (error.code === "ENOENT") missing.push(evidenceFile);
        else readErrors.push({ file: evidenceFile, code: error.code ?? "unknown" });
      }
    }
    const scan = checkAuthorVisibleTexts(texts);
    return {
      capture: name, ...scan, missing, read_errors: readErrors,
      ok: missing.length === 0 && readErrors.length === 0 && scan.ok,
    };
  });
  return { ok: checks.every((check) => check.ok), captures: checks };
}

function missionViewChecks(dir, config, common, driver, context, baselineAuthorCount) {
  const options = { ...context, message: config.message, baselineAuthorCount };
  const first = renderedNarrativeNodes(driver.mission?.initial_views?.[0]?.nodes ?? [], options);
  const count = first.matches.length, result = {};
  for (const phase of ["initial", "restored"]) {
    const views = driver.mission?.[phase + "_views"];
    result[phase] = first.ok && count > 0 && Array.isArray(views) && views.length === count * 2 &&
      Array.from({ length: count }, (_, index) => index).every(index =>
        ["start", "end"].every(edge => {
          const matches = views.filter(view => view.unit === index && view.edge === edge);
          if (matches.length !== 1 || matches[0].capture !== `mission-${phase}-${index + 1}-${edge}`) return false;
          const view = matches[0];
          assertCapturedNodes(dir, view.capture, view.nodes, driver, common);
          const report = renderedNarrativeNodes(view.nodes, options);
          const work = view.nodes.filter(node => node.role === "AXPopUpButton" && node.desc === "作品");
          return report.ok && report.matches.length === count && work.length === 1 &&
            work[0].title === config.author_visible_target.work_title &&
            axTurnOutcome(view.nodes, options).kind === "completed" &&
            r05ReplyEdgeVisible(view.nodes, report.matches[index], edge);
        }));
  }
  return result;
}
function missionCandidateViews(dir, common, driver, artifact, body, message, baselineAuthorCount) {
  const pending = body.adoption_state?.pending ?? [];
  const items = artifact?.payload?.items ?? [];
  selectPendingAction(body, { artifactId: artifact.artifact_id, actionType: "accept" });
  const label = actionLabelsFor(artifact, body).accept;
  return ["candidate_views", "restored_candidate_views"].every(key => {
    const views = driver.mission?.[key];
    if (!Array.isArray(views) || items.length === 0 || views.length !== items.length * 2) return false;
    return items.every((item, index) => {
      const prefix = key === "candidate_views" ? "mission-candidate" : "mission-restored-candidate";
      return ["entry", "action"].every(kind => {
        const matches = views.filter(view => view.capture === `${prefix}-${index + 1}-${kind}`);
        if (matches.length !== 1) return false;
        const view = matches[0];
        assertCapturedNodes(dir, view.capture, view.nodes, driver, common);
        const options = { itemTitle: item.title, itemBody: item.body, artifact, knownArtifacts: pending, label,
          authorBoundary: authorBoundary(view.nodes, message, baselineAuthorCount) };
        const located = kind === "entry" ? locatePendingItem(view.nodes, options) : locateScopedButton(view.nodes, options);
        if (!located.ok) return false;
        const node = kind === "entry" ? view.nodes.find(node =>
          node.path?.startsWith(located.scope.path + "/") && [node.title, node.value, node.desc].includes(item.title))
          : located.button;
        return Boolean(node && isVisibleNode(node));
      });
    });
  });
}

function missionNativeExchange(history, calls, mission, kind, correction) {
  const name = kind === "planning" ? "planning_mission" : "chapter_mission";
  const attempts = assistantCalls(history.transcript).filter(call => call.name === name);
  const results = validations(history.transcript);
  const accepted = attempts.filter(call => call.pcall === mission?.provider_call_ref);
  const passed = accepted.length === 1 && results.filter(result =>
    result.call_id === accepted[0].call_id && result.status === "passed" &&
    result.messageIndex > accepted[0].messageIndex).length === 1;
  const bounded = attempts.length >= 1 && attempts.length <= 2;
  if (!correction) return { ok: Boolean(passed && bounded), attempts: attempts.length };
  const first = attempts[0], second = attempts[1];
  const rejected = first && results.find(result => result.call_id === first.call_id && result.status === "failed");
  const record = second && calls.records.find(record =>
    record.provider_call_ref === second.pcall && record.provider_run_ref === second.prun);
  const bindings = record ? canonicalRequestBindingsForProviderCall(record, { messages: history.sessionMessages }) : null;
  const inheritedFailure = bindings?.some(binding => binding.canonical.role === "tool" &&
    binding.canonical.blocks?.some(block => block.type === "validation_result" &&
      block.call_id === first?.call_id && block.status === "failed"));
  return { ok: Boolean(passed && attempts.length === 2 && rejected &&
    rejected.messageIndex < second.messageIndex && accepted[0] === second && inheritedFailure),
    attempts: attempts.length, rejected_call_id: first?.call_id ?? null, inherited_failure: Boolean(inheritedFailure) };
}

export function missionWriterMaterial(history, calls, mission, kind, writer, targetChapterRef = null) {
  const candidates = assistantCalls(history.transcript).filter(call => call.pcall === writer.provider_call_ref &&
    call.name === "submit_tentative_artifact");
  if (candidates.length !== 1) return { ok: false };
  const call = candidates[0];
  const record = calls.records.find(record => record.provider_call_ref === call.pcall && record.provider_run_ref === call.prun);
  const content = scopeForProviderCall(record, { messages: history.sessionMessages })?.scopeContent;
  const operation = content?.operation;
  const expectedCapability = kind === "planning" ? "plot_outline" : "prose_writing";
  const material = operation?.[kind === "planning" ? "planning_mission" : "execution_brief"];
  const targetMatches = content?.work_id === history.record.work_id &&
    (kind === "planning" || (nonBlank(targetChapterRef) && content?.authoring_task?.scope?.target_chapter_ref === targetChapterRef));
  const missionCalls = assistantCalls(history.transcript).filter(item => item.pcall === mission?.provider_call_ref &&
    item.name === (kind === "planning" ? "planning_mission" : "chapter_mission"));
  const accepted = missionCalls[0];
  const passed = validations(history.transcript).filter(result => result.call_id === accepted?.call_id && result.status === "passed");
  const bindings = canonicalRequestBindingsForProviderCall(record, { messages: history.sessionMessages });
  const inheritedAcceptance = bindings?.some(binding => binding.canonical.role === "tool" &&
    binding.canonical.blocks?.some(block => block.type === "validation_result" &&
      block.call_id === accepted?.call_id && block.status === "passed"));
  const acceptedBeforeWriter = missionCalls.length === 1 && passed.length === 1 &&
    accepted.messageIndex < passed[0].messageIndex && passed[0].messageIndex < call.messageIndex &&
    Boolean(inheritedAcceptance);
  const text = [mission?.statement, ...(mission?.must_advance ?? []).map(item => item.text),
    ...(mission?.must_avoid ?? []).map(item => item.text)];
  return { ok: targetMatches && acceptedBeforeWriter && operation?.role === "creative_execution" &&
    operation.capability === expectedCapability && typeof material === "string" &&
    text.every(value => nonBlank(value) && material.includes(value)),
    target_matches: targetMatches, accepted_before_writer: acceptedBeforeWriter,
    provider_call_ref: call.pcall, provider_run_ref: call.prun,
    material_field: kind === "planning" ? "planning_mission" : "execution_brief" };
}
// WR01/WR02 的实际消费者共用原 native/live owner；无需再造 runner 或让空调用集合代签。
export function verifyMissionBatch(dir) {
  const config = readConfig(dir);
  assert.equal(config.journey, "mission", "使命 verifier 必须来自已登记 mission journey");
  assert(["chapter", "planning"].includes(config.mission_kind), "缺少已登记使命种类");
  const common = assertCommonEvidence(dir, { sliceId: config.slice_id, minScreenshots: 7,
    minimumWaits: 8, requiredKinds: ["input", "turn", "maintenance", "restore"] });
  const driver = read(dir, "native-b71-driver-log.json");
  assert.equal(common.ready.provider, config.provider);
  assert.equal(driver.provider, config.provider);
  const evidence = assertProviderAndWire(dir, { expectProviders: [config.provider] });
  const workId = frozenWorkId(dir, config.author_visible_target.work_title);
  const history = readBatchAuthoringHistory(dir, { wire: evidence.wire, messageText: config.message, workId });
  const calls = config.provider === "splash" ? reconcileNativeCalls(dir, config, history, evidence.llmRecords) :
    bindNativeCalls(dir, history.transcript.run, history, evidence.llmRecords);
  const sent = evidence.userMessages.find(frame => frameBody(frame)?.text === config.message);
  const identity = { runId: history.record.id, turnId: history.record.parent_turn_ref, workId,
    sessionId: history.record.session_id, topic: frameOf(sent)[2], since: sent.at };
  const body = lastCompletedTurn(evidence.wire, identity, "使命消费者缺少同 run 完成结果");
  const events = sourceMissionEvents(evidence.wire, identity).map(frameBody);
  const start = canonSnapshotOf(read(dir, "b71-start.json")), final = canonSnapshotOf(read(dir, "b71-final.json"));
  const planning = config.mission_kind === "planning";
  const targets = planning ? [workId] : Object.keys(start.chapters).filter(id =>
    start.chapters[id].work_id === workId && start.chapters[id].title === config.author_visible_target.chapter_title);
  assert.equal(targets.length, 1, "使命目标必须唯一命中冻结作品/章节");
  const target = targets[0];
  const beforeEntity = planning ? start.works?.[target] : start.chapters[target];
  const afterEntity = planning ? final.works?.[target] : final.chapters[target];
  const mission = afterEntity?.mission;
  const source = missionSourceChecks({
    missionKind: config.mission_kind, requireDerivation: true,
    ...(planning ? { startWork: beforeEntity, beforeWork: afterEntity, targetWorkId: target,
      artifactTargetWork: config.author_visible_target.work_title } :
      { startChapter: beforeEntity, beforeChapter: afterEntity, targetChapterId: target,
        targetChapterRef: `chapter:${target}`, artifactTargetChapter: config.author_visible_target.chapter_title }),
    sourceRunId: history.record.id, sourceWorkId: workId, sourceRunRecord: history.record,
    transcript: history.transcript, sessionMessages: history.sessionMessages, records: calls.records,
    joinedRefs: calls.refs, missionEvents: events, window: { startAt: start.at, beforeAt: final.at },
  });
  const canon = compareSourceDesignSnapshots(start, final,
    planning ? { targetWorkId: workId } : { targetChapterId: target });
  const persisted = withDb(dir, db => all(db,
    "SELECT payload FROM agent_events WHERE run_id = ? AND event_type = 'mission_derived'", [history.record.id]))
    .map(row => JSON.parse(row.payload));
  const pending = body.adoption_state?.pending ?? [];
  const artifacts = pending.filter(artifact => artifact.artifact_type === (planning ? "outline_draft" : "prose_fragment") &&
    artifact.adoption_status === "TENTATIVE");
  assert.equal(artifacts.length, 1, "使命消费者必须真实产生对应 tentative 候选");
  const writer = writerArtifactMatch({ artifact: artifacts[0], records: calls.records });
  const material = missionWriterMaterial(history, calls, mission, config.mission_kind, writer,
    planning ? null : `chapter:${target}`);
  const exchange = missionNativeExchange(history, calls, mission, config.mission_kind,
    config.provider === "slice_verify" && config.mission_correction === "reject_then_valid");
  const observation = visibleTurnObservation(dir, config, common);
  const observedTimeline = read(dir, "native-b71-turn-observation.json");
  const rejectionHidden = config.provider !== "slice_verify" ||
    (observedTimeline.rejected_narrative_probe === "R06MISSIONREJECTED" &&
      observedTimeline.changes.some(change => change.rejected_narrative_visible === false) &&
      observedTimeline.changes.every(change => change.rejected_narrative_visible !== true));
  const context = sourceMissionNarrativeContext(evidence.wire, { ...identity, missionEventId: events[0]?.event_id });
  const views = missionViewChecks(dir, config, common, driver, context, observation.baselineAuthorCount);
  const scan = capturedSurfaceScan(dir, common);
  const interval = driver.mission?.read_only;
  const readOnly = interval && isDeepStrictEqual(interval.before, interval.after) &&
    providerFreeInterval({ appRecords: evidence.appRecords, llmRecords: evidence.llmRecords,
      start: interval.start, end: interval.end });
  const checks = {
    one_author_send: evidence.userMessages.length === 1 && frameBody(evidence.userMessages[0])?.text === config.message,
    native_calls: Object.values(calls.checks).every(value => value === true),
    mission_source_bound: Object.values(source.checks).every(value => value === true),
    mission_persisted_from_same_event: events.length === 1 && persisted.length === 1 &&
      isDeepStrictEqual(events[0].payload, persisted[0]),
    mission_exchange_bounded_and_corrected: exchange.ok,
    rejected_narrative_not_visible: rejectionHidden,
    mission_reaches_actual_writer: writer.ok && material.ok,
    mission_design_only: Object.values(canon.checks).every(value => value === true),
    no_adoption: body.truthfulness?.artifact_adopted === false && body.truthfulness?.production_write_performed === false,
    narrative_visible_and_restored: views.initial && views.restored,
    candidate_visible_and_restored: missionCandidateViews(dir, common, driver, artifacts[0], body,
      config.message, observation.baselineAuthorCount),
    why_and_restore_read_only: Boolean(driver.mission?.why?.opened && !driver.mission.why.close_error && readOnly),
    author_visible_no_internal_tokens: scan.ok,
    production_source_unchanged: fingerprintUnchanged(dir),
  };
  const report = { ok: Object.values(checks).every(value => value === true), scenario_id: config.scenario_id,
    checks, source, canon, exchange, writer_material: material, views, scan,
    semantic_review: "pending_independent_review_of_raw_narrative_and_captured_page",
    not_signed: ["R08_literary_quality_and_capability_exam"] };
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(report, null, 2));
  const summary = writeNativeSummary(dir, { sliceId: config.slice_id, provider: config.provider,
    driver: common.ui.driver, scope: common.ui.scope, checks, measured: { mission: source.measured,
      provider_calls: calls.measured, screenshots: common.ui.screenshots, wait_ledger: common.ledger },
    status: report.ok ? "pass" : "fail", extra: { scenario_id: config.scenario_id,
      semantic_review: report.semantic_review, not_signed: report.not_signed } });
  assert(report.ok, `使命原生证据未成立: ${JSON.stringify(checks)}`);
  return { checks: report, summary };
}

export function verifyLiveBatch(dir) {
  const config = readConfig(dir);
  assert.equal(config.journey, "live", "live verifier 只接受 journey=live");
  assert(["strata", "splash"].includes(config.provider), "live verifier provider 未注册");
  if (config.r05_goal) return verifyR05Batch(dir);
  // b82-g2/b82-g3 新批次只签作者可见页面；内部对账/旧 G2 报告保留为独立诊断，不再同步卡 UI。
  const visibleMode = authorVisibleScenario(config.scenario_id);
  if (visibleMode !== null) return verifyAuthorVisibleBatch(dir, config, visibleMode);
  // live 驱动的固定等待步：launch_app/workbench_ready/select_work/input_ready/
  // author_creation_request/user_message_ack/live_run_terminal = 7 条（Why 触发再加）。
  // 不能沿用 pending/revision 的 8 条门槛，否则会把正常 live 路径误杀；6 条已覆盖
  // 输入/ack/终局/维护四个分型的真实等待。
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: 3,
    minimumWaits: 6,
    requiredKinds: ["input", "ack", "turn", "maintenance"],
  });
  const evidence = assertProviderAndWire(dir, {
    minUserMessages: 1,
    minTurnResults: 1,
    minProviderStarts: 1,
    expectProviders: ["strata"],
  });
  const checkpoints = Object.fromEntries(
    LIVE_CHECKPOINTS.map((name) => [
      name,
      read(dir, `b71-${name}.json`),
    ]),
  );
  const driverLog = readJsonIfExists(path.join(dir, "native-b71-driver-log.json"));
  const strataSlot = readJsonIfExists(path.join(dir, "strata-slot.json"));
  assert(strataSlot, "缺少 strata-slot.json（批次前后槽位/卸载核验）");
  assert.equal(strataSlot.unloaded, true, "strata 批次结束必须核验 loaded=null");

  // L7/L9 的真实数据源：产品持久结构（DB），不在 wire 投影层猜。
  // 本批段消费同一只读入口：作者输入帧 + join + ACK 绑定唯一 run，
  // 再由 canonical 段头/消息表精确读取；不扫 agent_runs 全表。
  const history = readBatchAuthoringHistory(dir, {
    wire: evidence.wire,
    messageText: config.message,
    workId: config.target?.work_id,
  });
  const nativeCalls = reconcileNativeCalls(dir, config, history, evidence.llmRecords);
  const dbFacts = withDb(dir, (db) => {
    const tableCount = (table) => {
      try {
        return Number(all(db, `SELECT COUNT(*) AS c FROM ${table}`)[0]?.c ?? 0);
      } catch {
        return 0;
      }
    };
    return {
      mutations_count: tableCount("mutations"),
      chapters_rows: all(db, "SELECT * FROM chapters"),
      ...readRunRefFacts(db, history.record),
      segment_transcript: history.transcript,
      sessionMessages: history.sessionMessages,
    };
  });
  const checks = b71LiveModelBehavior({
    dir,
    config,
    // 冻结批次只把精确对账内的真实 SSE 记录交给行为判据；普通 live 入口不变。
    llmRecords: nativeCalls ? nativeCalls.records : evidence.llmRecords,
    wire: evidence.wire,
    startCheckpoint: checkpoints.start,
    finalCheckpoint: checkpoints.final,
    driverLog,
    dbFacts,
    model: driverLog?.model ?? DEFAULT_LIVE_MODEL,
  });
  assert.equal(
    checks.failed_mechanism.length,
    0,
    `B71 live mechanism 断言失败: ${checks.failed_mechanism.join(", ")}`,
  );
  writeNativeFrames(dir);
  const summary = {
    slice_id: config.slice_id,
    surface: "tauri-native",
    driver: "ax-native-system-ui",
    provider: "strata",
    model: checks.model,
    verified_at: new Date().toISOString(),
    checkpoints: Object.fromEntries(LIVE_CHECKPOINTS.map((name) => [name, checkpoints[name].at ?? null])),
    mechanism: checks.checks.mechanism,
    required_mechanism: checks.required_mechanism,
    model_behavior: checks.model_behavior,
    not_signed: checks.not_signed,
    measured: {
      ...checks.measured,
      native_call: nativeCalls ? nativeCalls.measured : null,
    },
    refs: checks.measured?.refs ?? null,
    tentative_design_derivations: checks.measured?.canon?.tentative_design_derivations ?? [],
    strata_slot: strataSlot,
    wait_ledger: common.ledger,
    screenshots: common.ui.screenshots,
    verdict: {
      mechanism: "pass",
      model_behavior: checks.model_behavior,
      not_signed: checks.not_signed,
      full_g1_g6_signed: false,
    },
  };
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(checks, null, 2));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`B71 CP3b 实模机制判据通过: ${checks.required_mechanism.length}/${checks.required_mechanism.length}`);
  return { checks, summary };
}

// ── B82 G2 事后可复跑技术审计 ───────────────────────────────────────────────
// 直接组合既有只读入口；前置采集异常交给 CLI 既有错误出口，不另造
// schema/fallback/reasons。只看子结果表达缺证，不写 summary/checks/capture。
function frozenWorkId(dir, workTitle) {
  assert(nonBlank(workTitle), "audit-g2 缺少冻结可见作品名");
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT id FROM works WHERE title = ?", [workTitle]);
    assert.equal(rows.length, 1, "audit-g2 冻结可见作品名必须唯一命中作品");
    return rows[0].id;
  });
}


export function r05CapturedViews(dir, common, kind) {
  const log = read(dir, "native-b71-driver-log.json"), views = log[`r05_${kind}_views`];
  assert(Array.isArray(views), `R05 缺少 ${kind} 视图采集记录`);
  const names = kind === "candidate" ? /^r05-candidate-\d+-(entry|action)$/u : /^r05-reply-(start|end)$/u;
  return views.map((view) => {
    assert(names.test(view.capture), `R05 ${kind} 视图名称不属于本入口`);
    const capture = assertCapturedNodes(dir, view.capture, view.nodes, log, common);
    assertRecordFresh(dir, view.capture, common.ready.ready_at);
    return { capture: view.capture, nodes: view.nodes, ...(kind === "reply" ? { edge: view.edge } : {}),
      screenshot_present: common.ui.screenshots.includes(view.capture + ".jpg") && capture.screenshot?.ok === true,
      window_capture: capture.screenshot?.ok === true && capture.screenshot.fallback !== true };
  });
}

// R05 四目标独立审计：每个判断都消费同一已绑定 run 的真实输入、终局与请求。
export function auditR05Batch(dir) {
  const config = readConfig(dir);
  assert(config.r05_goal && config.journey === "live" && config.provider === "splash",
    "audit-r05 只接受已冻结的四个 R05 Splash 场景");
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id, minScreenshots: 4, minimumWaits: 6,
    requiredKinds: ["input", "turn", "maintenance"],
  });
  const evidence = assertProviderAndWire(dir, {
    minUserMessages: 1, minTurnResults: 1, minProviderStarts: 1, expectProviders: ["splash"],
  });
  const history = readBatchAuthoringHistory(dir, {
    wire: evidence.wire, messageText: config.message,
    workId: frozenWorkId(dir, config.author_visible_target.work_title),
  });
  const calls = reconcileNativeCalls(dir, config, history, evidence.llmRecords);
  const input = readR05Inputs(dir, { config, history, records: calls.records, wire: evidence.wire });
  const refs = liveRefsCheck({ llmRecords: calls.records, transcript: history.transcript,
    sessionMessages: history.sessionMessages });
  const start = read(dir, "b71-start.json"), final = read(dir, "b71-final.json");
  const startCanon = canonSnapshotOf(start), finalCanon = canonSnapshotOf(final);
  const zeroWrite = liveZeroWriteLayers({
    startCanon, finalCanon, startCounts: start.db_production_counts,
    finalCounts: final.db_production_counts, strataRecords: calls.records,
    pendingArtifacts: input.candidate ? [input.candidate] : [],
  });
  const canon = compareAuthoringCanonSnapshots(startCanon, finalCanon);
  const goal = r05GoalEvidence({ ...input, goal: config.r05_goal, refs,
    zero_write: { ...zeroWrite, ok: zeroWrite.ok && Object.values(canon.checks).every((value) => value === true) } });
  const visible = r05VisibleEvidence({
    ...visibleTurnObservation(dir, config, common),
    goal: config.r05_goal, target: config.author_visible_target, message: config.message,
    reply: input.reply, candidate: input.candidate, turn_result: input.turn_result,
    candidate_views: r05CapturedViews(dir, common, "candidate"),
    reply_views: r05CapturedViews(dir, common, "reply"),
    afterInputText: visibleTextIfExists(dir, "after-input"),
    finalText: visibleTextIfExists(dir, "final"),
    readingBeforeText: visibleTextIfExists(dir, "02-reading-before"),
    readingAfterText: visibleTextIfExists(dir, "03-reading-after"),
  });
  const checks = {
    one_author_send: evidence.userMessages.length === config.budget.author_sends &&
      String(frameBody(evidence.userMessages[0])?.text ?? "") === config.message,
    native_calls: Object.values(calls.checks).every((value) => value === true),
    production_source_unchanged: fingerprintUnchanged(dir),
    author_visible: visible.ok, target_materials_and_scope: goal.ok,
    cost_bytes_classified: input.cost.calls.every((call) => call.analysis.ok === true),
  };
  return { ok: Object.values(checks).every((value) => value === true),
    scenario_id: config.scenario_id, checks, goal, visible, refs,
    source: { chapter_ref: input.source.chapter_ref, draft_ref: input.source.draft_ref,
      revision: input.source.revision,
      style: input.source.style ? { ref: input.source.style.ref, version: input.source.style.version } : null },
    native_call: { checks: calls.checks, measured: calls.measured },
    zero_write: zeroWrite, canon, cost: input.cost,
    screenshots: common.ui.screenshots, wait_ledger: common.ledger,
    semantic_review: goal.semantic_review, not_signed: goal.not_signed };
}

function verifyR05Batch(dir) {
  const report = auditR05Batch(dir);
  fs.writeFileSync(path.join(dir, "native-b71-checks.json"), JSON.stringify(report, null, 2));
  const config = readConfig(dir);
  const summary = writeNativeSummary(dir, {
    sliceId: config.slice_id, provider: config.provider, driver: "ax-native-system-ui",
    scope: "b87-r05-materials", checks: report.checks, measured: { cost: report.cost.summary },
    status: report.ok ? "pass" : "fail",
    extra: { scenario_id: config.scenario_id, author_visible: report.visible,
      goal: report.goal, semantic_review: report.semantic_review, not_signed: report.not_signed,
      verdict: { mechanism: report.ok ? "pass" : "fail", model_semantics: "pending_independent_review" } },
  });
  assert(report.ok, `R05 独立材料/范围判据失败: ${JSON.stringify(report.checks)}`);
  return { checks: report, summary };
}

export function auditG2Batch(dir) {
  const batchDir = path.resolve(dir);
  const config = readConfig(batchDir);
  assert.equal(config.scenario_id, "b82-g2", "audit-g2 只接受冻结的 b82-g2 批次");
  assert.equal(config.journey, "live", "audit-g2 只接受 journey=live");
  assert(["strata", "splash"].includes(config.provider), "audit-g2 provider 未注册");
  assert(isObject(config.author_visible_target), "b82-g2 缺少冻结作者可见目标");
  const evidence = assertProviderAndWire(batchDir, {
    minUserMessages: 1,
    minTurnResults: 1,
    minProviderStarts: 1,
    expectProviders: [config.provider],
  });
  // work 只由冻结可见作品名唯一解析；run 再由实际作者原文/ACK 精确定位。
  const workId = frozenWorkId(batchDir, config.author_visible_target.work_title);
  const history = readBatchAuthoringHistory(batchDir, {
    wire: evidence.wire,
    messageText: config.message,
    workId,
  });
  const nativeCalls = reconcileNativeCalls(batchDir, config, history, evidence.llmRecords);
  const pages = g2PageReport({ dir: batchDir, config, history, records: nativeCalls.records });
  const candidate = g2CandidateReport({
    dir: batchDir,
    config,
    history,
    records: nativeCalls.records,
    chapterRef: pages.chapter_ref,
  });
  const refs = liveRefsCheck({
    llmRecords: nativeCalls.records,
    transcript: history.transcript,
    sessionMessages: history.sessionMessages,
  });
  const usage = g2UsageReport({ config, pages, candidate, refs });
  const checks = {
    native_calls: Object.values(nativeCalls.checks).every((value) => value === true),
    pages: pages.ok === true,
    candidate: candidate.ok === true,
    refs: refs.ok === true,
    usage: usage.ok === true,
  };
  const failed = Object.keys(checks).filter((name) => checks[name] !== true);
  return {
    ok: failed.length === 0,
    checks,
    failed,
    native_call: { checks: nativeCalls.checks, measured: nativeCalls.measured },
    pages,
    candidate,
    refs,
    usage,
  };
}
