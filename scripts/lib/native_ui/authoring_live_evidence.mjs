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
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  frameBody,
  frameEvent,
  read,
  withDb,
  writeNativeFrames,
} from "./scenario_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import {
  NATIVE_CHAT_WIRE,
  requestFactsFromRecord,
} from "./authoring_request_facts.mjs";
import {
  notSignedSlices,
  recordResponseToolCalls,
  recordUsageFacts,
  summarizeModelBehavior,
} from "./live_run_wait.mjs";
import { liveRefsCheck } from "./authoring_live_refs.mjs";

export const LIVE_CHECKS_SCHEMA = "b71-live-checks/v1";
export const LIVE_CHECKPOINTS = Object.freeze(["start", "final"]);
export const DEFAULT_LIVE_MODEL = "iq3_s";

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
  return messages
    .filter((message) => message?.role === "tool")
    .map((message) => ({
      tool_call_id: message.tool_call_id ?? message.tool_call ?? null,
      content: messageContent(message),
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

  // L7 used_context_refs ⊆ base_refs ∪ observation_refs：Lead 03 裁定从产品持久结构读取
  // （transcript self_report.used_context_refs / decision_traces.context_refs +
  // agent_events.refs + 请求应用数据消息）；wire 启发式只作观测辅助，不参与判定；
  // 无法提取 used 时 ok=null（unknown，不假过）。
  const refsCheck = liveRefsCheck({
    llmRecords: strataRecords,
    agentEvents: Array.isArray(dbFacts?.agent_events) ? dbFacts.agent_events : [],
    decisionTraces: Array.isArray(dbFacts?.decision_traces) ? dbFacts.decision_traces : [],
    transcriptText: String(dbFacts?.transcript_text ?? ""),
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

export function verifyLiveBatch(dir) {
  const config = readConfig(dir);
  assert.equal(config.journey, "live", "live verifier 只接受 journey=live");
  assert.equal(config.provider, "strata", "live verifier 只接受 provider=strata");
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
  const dbFacts = withDb(dir, (db) => {
    const tableCount = (table) => {
      try {
        return Number(all(db, `SELECT COUNT(*) AS c FROM ${table}`)[0]?.c ?? 0);
      } catch {
        return 0;
      }
    };
    const transcripts = all(db, "SELECT authoring_transcript FROM agent_runs");
    return {
      mutations_count: tableCount("mutations"),
      chapters_rows: all(db, "SELECT * FROM chapters"),
      agent_events: all(db, "SELECT event_type, refs FROM agent_events"),
      decision_traces: all(db, "SELECT trace_id, turn_id, context_refs FROM decision_traces"),
      transcripts,
      transcript_text: transcripts.map((row) => String(row?.authoring_transcript ?? "")).join("\n"),
    };
  });
  const checks = b71LiveModelBehavior({
    dir,
    config,
    llmRecords: evidence.llmRecords,
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
    measured: checks.measured,
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
