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
  assertCommonEvidence,
  assertProviderAndWire,
  frameBody,
  frameEvent,
  read,
  writeNativeFrames,
} from "./scenario_evidence.mjs";
import { readConfig } from "./authoring_capture_evidence.mjs";
import { summarizeModelBehavior, notSignedSlices } from "./live_run_wait.mjs";

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

function messagesOf(record) {
  const body = record?.request_body;
  assert(isObject(body), `llm-calls 记录缺 request_body：${record?.provider_call_ref ?? "unknown"}`);
  assert(Array.isArray(body.messages), `llm-calls request_body 缺 messages：${record?.provider_call_ref ?? "unknown"}`);
  return body.messages;
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
  return records
    .filter((record) => record?.turn_id === turnId && isObject(record.request_body))
    .sort((left, right) => String(left.ts ?? "").localeCompare(String(right.ts ?? "")));
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

function usageFacts(record) {
  const body = record?.response?.body ?? record?.response ?? {};
  const usage = body?.usage ?? record?.usage ?? null;
  if (!isObject(usage)) return { present: false, fields: [] };
  const fields = Object.keys(usage).filter((key) => usage[key] !== null && usage[key] !== undefined);
  const hasKnownPair =
    (typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number") ||
    (typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number") ||
    typeof usage.total_tokens === "number";
  return { present: fields.length > 0, known_pair: hasKnownPair, fields };
}

function countOf(table, checkpoint) {
  const counts = checkpoint?.db_production_counts ?? {};
  return typeof counts[table] === "number" ? counts[table] : null;
}

// L1–L12：真实 provider 记录的纯判据。返回 mechanism 必过项、model_behavior 事实与
// not_signed 切片；未触发项为 null，不以“未发生”冒充成立。
export function b71LiveModelBehavior({ dir, config, llmRecords, wire, startCheckpoint, finalCheckpoint, driverLog, model = DEFAULT_LIVE_MODEL }) {
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

  // L4 追加式前缀：同一 turn 的后续真实请求以先前 messages 为严格前缀。
  const l4Failures = [];
  for (const turnId of turnIds) {
    const ordered = orderedRecords(strataRecords, turnId).map((record) => messagesOf(record));
    for (let index = 1; index < ordered.length; index += 1) {
      if (!samePrefix(ordered[index - 1], ordered[index])) l4Failures.push({ turnId, index });
    }
  }
  const l4 = l4Failures.length === 0;

  // L5/L6 工具调用/结果绑定与观察回流：唯一事实源 = 实时 provider 响应里的 tool_calls。
  // 请求 messages 里的 assistant.tool_calls 是追加式历史回放，只累加回放观测，不建立
  // 新绑定；因此这里用 call_id 主键的 Map 前置归并，而不是事后过滤重复项。
  const toolBinding = new Map();
  let replayOnlyCalls = 0;
  for (const turnId of turnIds) {
    const ordered = orderedRecords(strataRecords, turnId);
    ordered.forEach((record, index) => {
      const messages = messagesOf(record);
      const responseCalls = Array.isArray(record?.response?.body?.tool_calls)
        ? record.response.body.tool_calls
        : [];
      for (const call of responseCalls) {
        const callId = call?.id ?? null;
        if (!callId || toolBinding.has(callId)) continue;
        toolBinding.set(callId, {
          turn_id: turnId,
          call_id: callId,
          name: call?.function?.name ?? call?.name ?? null,
          first_request_index: index,
          first_provider_call_ref: record.provider_call_ref ?? null,
          replayed_in_requests: 0,
          bound_in_later_request: false,
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
        if (binding.bound_in_later_request || binding.first_request_index >= index) continue;
        const hit = toolMessages.find((message) => message.tool_call_id === binding.call_id);
        if (hit) {
          binding.bound_in_later_request = true;
          binding.observation_length = hit.content.length;
        }
      }
    });
  }
  const toolBindings = [...toolBinding.values()];
  const l5 = toolBinding.size === 0 ? null : toolBindings.every((entry) => entry.bound_in_later_request);
  const l6 = toolBinding.size === 0 ? null : toolBindings.every((entry) => entry.bound_in_later_request && entry.observation_length > 0);

  // L7 used_context_refs ⊆ base_refs ∪ observation_refs：仅当能从真实请求文本提取 refs 时判定；
  // 否则如实记 not_observable，不当作通过。
  const l7Facts = [];
  for (const entry of requestMessages) {
    const baseRefs = new Set();
    const observedRefs = new Set();
    for (const message of entry.messages) {
      if (isApplicationBase(message)) {
        for (const ref of extractRefs(messageContent(message))) baseRefs.add(ref);
      }
      if (message?.role === "tool") {
        for (const ref of extractRefs(messageContent(message))) observedRefs.add(ref);
      }
    }
    const toolArgsRefs = new Set();
    for (const call of toolCallsOf(entry.messages)) {
      for (const ref of extractRefs(call.arguments)) toolArgsRefs.add(ref);
    }
    if (baseRefs.size === 0) continue;
    const allowed = new Set([...baseRefs, ...observedRefs]);
    const violations = [...toolArgsRefs].filter((ref) => !allowed.has(ref));
    l7Facts.push({ turn_id: entry.turnId, base_refs: baseRefs.size, observation_refs: observedRefs.size, used_refs: toolArgsRefs.size, violations });
  }
  const l7 = l7Facts.length === 0 ? null : l7Facts.every((facts) => facts.violations.length === 0);

  // L8 作者字节：每条真实请求中作者原话逐字出现且独立成 user 消息。
  const l8 = nonBlank(authorText) && requestMessages.every((entry) => entry.messages.some((message) => isAuthorMessage(message, authorText)));

  // L9 未采纳前零写入：canon 内容签名不变 + 无 mutations/receipts/memory/正文行；
  // 若有 pending 候选必须全部 TENTATIVE。
  const startCanon = canonSnapshotOf(startCheckpoint);
  const finalCanon = canonSnapshotOf(finalCheckpoint);
  const canonCompare = canonTablesEqual(startCanon, finalCanon);
  const finalCounts = finalCheckpoint.db_production_counts ?? {};
  const zeroWriteTables = ["mutations", "author_action_receipts", "memory_items", "chapters", "drafts"];
  const zeroWrites = zeroWriteTables.every((table) => (countOf(table, finalCheckpoint) ?? 0) === 0);
  const pendingArtifacts = turnBodies.flatMap((body) =>
    Array.isArray(body?.adoption_state?.pending) ? body.adoption_state.pending : [],
  );
  const pendingTentative = pendingArtifacts.every((artifact) => String(artifact?.adoption_status ?? "") === "TENTATIVE");
  const l9 = canonCompare.equal && zeroWrites && pendingTentative;

  // L10 usage：每次真实调用都有 usage（prompt/completion 或 provider 原生字段）。
  const usage = strataRecords.map((record) => ({ provider_call_ref: record.provider_call_ref ?? null, ...usageFacts(record) }));
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
      refs: l7Facts,
      canon: { equal: canonCompare.equal, changed_tables: canonCompare.changed },
      db_production_counts: finalCounts,
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
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: 3,
    minimumWaits: 8,
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

  const checks = b71LiveModelBehavior({
    dir,
    config,
    llmRecords: evidence.llmRecords,
    wire: evidence.wire,
    startCheckpoint: checkpoints.start,
    finalCheckpoint: checkpoints.final,
    driverLog,
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
