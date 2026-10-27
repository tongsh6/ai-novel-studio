// B62 CP1/CP2：B40 CP3 家族 6 个 tauri 场景的原生验收证据核验。
//
// 测量动作由外部 macOS AX/CGEvent 驱动真实 Tauri 窗口完成（scripts/native_b40_family_drive.mjs）；
// 本文件只消费隔离批次的既有证据：native-driver-ready/ui-complete/等待账/AX/截图/
// native-transport/app-log/llm-calls/只读 SQLite。判据 1:1 对齐
// frontend/slice-verify/external-ui-driver.mjs 的对应 canonical driver 与
// frontend/slice-verify/native-tauri-verifier.mjs 的 behavior，只把驱动面从 Chromium 页面
// 换成真实原生窗口，断言语义不降级；各场景 manifest 的 ui/network/data 断言逐项有 native 等价物。
//
// 场景：
//   au01-ordinary-chat-two-turn-roundtrip / pr-smoke-core-reply  普通聊天两轮 + 无计划/工具/卡片
//   au01-empty-message-guard                                     空输入发送不可用 → 恢复轮完成
//   au01-frame-validation-friendly-error                         协议损坏安全失败 → 恢复轮完成
//   au02-natural-exploration-no-slot-form                        creative_exploration 候选卡、无 slot 表单
//   agent-step-regate                                            AgentRun 多步 12 门 allow + author-safe why
//
// 模式：
//   prepare <dir>  读 seed / 建空白作品、标最近打开、落生产指纹与 DB 基线
//   capture <dir> <checkpoint>  记录只读 DB 生产表计数（start/final 对比证明无生产写入）
//   verify <dir> [slice-id]     核验并写 summary.json / native-b40-checks.json
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  all,
  assertAllChecks,
  assertCommonEvidence,
  assertProviderAndWire,
  assertRecordFresh,
  axDump,
  axText,
  checkProductionFingerprint,
  evidenceBoundary,
  productionFingerprint,
  productionTableCounts,
  read,
  rewrite,
  sentUserMessages,
  turnFacts,
  withDb,
  write,
  writeNativeFrames,
  writeNativeSummary,
} from "./lib/native_ui/scenario_evidence.mjs";

const ORDINARY_MESSAGES = [
  "我想写一个雨夜开场的悬疑故事，先聊聊气质。",
  "这种雨夜气质会让读者产生什么第一印象？",
];
const RECOVERY_EMPTY = "空消息后继续聊一个雨夜开场的悬疑气质。";
const INVALID_FRAME_MESSAGE =
  "AU01BADFRAME：请模拟创作引擎产出带禁止语义的 frame，工作台应拦截并友好提示。";
const RECOVERY_FRAME = "frame 校验失败后继续聊一个雨夜开场的悬疑气质。";
const EXPLORATION_MESSAGE = "我想写一个赛博修仙故事，但还没想好小说创作方向。";
const AGENT_MESSAGE = "先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派。";

const SLICES = Object.freeze({
  "au01-ordinary-chat-two-turn-roundtrip": {
    scenario: "ordinary_chat_two_turn",
    work: "seed_or_default",
    messages: ORDINARY_MESSAGES,
    captures: ["01-workbench", "02-turn1", "03-turn2", "04-final"],
    minScreenshots: 4,
    minimumWaits: 10,
    minUserMessages: 2,
    minTurnResults: 2,
    expected: [
      "two_user_turns_completed",
      "real_workbench_rendered_two_user_and_two_assistant_turns_in_order",
      "micro_plan_not_requested",
      "deterministic_provider_judgment_called_per_turn",
    ],
  },
  "pr-smoke-core-reply": {
    scenario: "ordinary_chat_two_turn",
    work: "seed_or_default",
    messages: ORDINARY_MESSAGES,
    captures: ["01-workbench", "02-turn1", "03-turn2", "04-final"],
    minScreenshots: 4,
    minimumWaits: 10,
    minUserMessages: 2,
    minTurnResults: 2,
    expected: [
      "two_user_turns_completed",
      "real_workbench_rendered_two_user_and_two_assistant_turns_in_order",
      "micro_plan_not_requested",
      "deterministic_provider_judgment_called_per_turn",
    ],
  },
  "au01-empty-message-guard": {
    scenario: "empty_message_guard",
    work: "seed_or_default",
    blank_text: "   ",
    recovery_message: RECOVERY_EMPTY,
    captures: ["01-workbench", "02-blank", "03-recovery", "04-final"],
    minScreenshots: 4,
    minimumWaits: 8,
    minUserMessages: 1,
    minTurnResults: 1,
    expected: [
      "blank_input_sent_no_user_message_frame",
      "blank_input_did_not_append_visible_messages",
      "blank_input_left_thinking_hidden",
      "input_remained_available_after_blank",
      "following_valid_chat_completed_without_micro_plan",
    ],
  },
  "au01-frame-validation-friendly-error": {
    scenario: "frame_validation_friendly_error",
    work: "seed_or_default",
    invalid_message: INVALID_FRAME_MESSAGE,
    recovery_message: RECOVERY_FRAME,
    captures: ["01-workbench", "02-fallback", "03-recovery", "04-final"],
    minScreenshots: 4,
    minimumWaits: 10,
    minUserMessages: 2,
    minTurnResults: 2,
    expected: [
      "invalid_judgment_action_settled_as_safe_failure",
      "author_visible_fallback_is_friendly",
      "internal_validation_reason_not_visible",
      "following_valid_chat_completed_without_micro_plan",
    ],
  },
  "au02-natural-exploration-no-slot-form": {
    scenario: "natural_exploration",
    work: "seed_or_default",
    message: EXPLORATION_MESSAGE,
    captures: ["01-workbench", "02-candidates", "03-final"],
    minScreenshots: 3,
    minimumWaits: 7,
    minUserMessages: 1,
    minTurnResults: 1,
    expected: [
      "natural_assistant_reply_visible",
      "candidate_panel_rendered_from_turn_result",
      "mechanical_slot_form_not_rendered",
      "deterministic_provider_form_frame_called_for_source_candidate_turn",
    ],
  },
  "agent-step-regate": {
    scenario: "agent_step_regate",
    work: "created",
    message: AGENT_MESSAGE,
    captures: ["01-workbench", "02-roster-step", "03-final", "04-why", "05-final-after-why"],
    minScreenshots: 5,
    minimumWaits: 9,
    minUserMessages: 1,
    minTurnResults: 2,
    expected: [
      "each_internal_step_recorded_ordered_twelve_gate_results",
      "author_safe_why_states_replay_does_not_call_provider",
      "author_safe_why_hides_raw_prompt_and_internal_gate_codes",
    ],
  },
});

const GATE_ORDER = [
  "correlation",
  "envelope_validation",
  "behavior_compatibility",
  "action_scope",
  "slot_contract_validation",
  "authority",
  "policy_safety",
  "budget",
  "toolbox_availability",
  "write_boundary",
  "trace_readiness",
  "turn_result_compat",
];

const UNSAFE_WHY =
  /raw prompt|provider raw|hidden policy|debug|trace_|ctx_|downgrade_to_dialogue|action_scope|multi-step plan requires downgrade/i;
const INTERNAL_VALIDATION_REASONS = [
  "frame validation failed",
  "forbidden semantics",
  "ready_to_execute",
  "approved and ready_to_execute",
  "slice_verify raw provider payload",
  "creative_exploration_frame",
  "model_still_speaks_frame_language",
  "judgment_decision_unparseable",
];
const FALLBACK_MARKERS = ["无法连接", "格式不符合工作台契约", "这次处理失败", "请稍后再试"];
const NO_CARD_PATTERN =
  /候选方向|可讨论方向|继续讨论|待保存设定草稿|保存所选方案|放弃所选方案|待确认的创作材料|确认执行/;
const SLOT_FORM_PATTERN = /必填字段|字段表单|请填写字段|slot_schema|required_slots|missing_slots/i;
const EXECUTION_CARD_PATTERN = /确认执行|待确认的创作材料|保存为章节正文|工具执行|MicroPlan/i;

// ── 隔离副本 DB 准备 ────────────────────────────────────────────────────────
function markWorkNewest(dir, workId) {
  execFileSync(
    "python3",
    [
      "-c",
      [
        "import sqlite3,sys,datetime",
        "db=sqlite3.connect(sys.argv[1], timeout=10)",
        "ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'",
        "db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2]))",
        "db.commit(); db.close()",
      ].join("\n"),
      path.join(dir, "database", "ai_novel_studio_test.sqlite3"),
      workId,
    ],
    { stdio: "ignore" },
  );
}

function seedField(dir, name) {
  const file = path.join(dir, "seed.log");
  if (!fs.existsSync(file)) return null;
  const tokens = fs.readFileSync(file, "utf8").split(/\s+/);
  const token = tokens.find((part) => part.startsWith(`${name}=`));
  return token ? token.slice(name.length + 1) : null;
}

function workTitleInDb(dir, workId) {
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT title FROM works WHERE id = ?", [workId]);
    assert.equal(rows.length, 1, `作品不存在于隔离 DB: ${workId}`);
    return String(rows[0].title);
  });
}

// seed 脚本为空时真实服务端会创建唯一默认作品；本批复用它（与浏览器 canonical 同口径）。
function onlyWork(dir) {
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT id, title FROM works ORDER BY updated_at DESC");
    assert(rows.length >= 1, "隔离 DB 没有任何作品（服务端默认 seed 缺失）");
    return { work_id: String(rows[0].id), work_title: String(rows[0].title), session_id: null };
  });
}

async function createWork(dir, ready) {
  const title = `B62 AgentRun native-${Date.now()}`;
  const response = await fetch(`${ready.api_url}/api/works`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      genre: "赛博修仙",
      core_selling_point: "验证 bounded AgentRun 从角色阵容读取到角色设计的真实工作台链路",
      target_reader: "需要可打断多步创作过程的作者",
      tone_preference: "冷静、清晰",
    }),
  });
  assert(response.ok, `创建 AgentRun 作品失败: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id, "创建 AgentRun 作品响应缺少 work id");
  return { work_id: String(body.work.id), work_title: String(body.work.title ?? title), session_id: null };
}

// ── prepare / capture ──────────────────────────────────────────────────────
export async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  const sliceId = ready.slice_id;
  const slice = SLICES[sliceId];
  assert(slice, `未知 B40 家族 slice: ${sliceId ?? "(ready.slice_id 缺失)"}`);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert.equal(ready.provider, "slice_verify");

  let target;
  if (slice.work === "created") {
    target = await createWork(dir, ready);
  } else {
    const seedWorkId = seedField(dir, "work_id");
    if (seedWorkId) {
      target = {
        work_id: seedWorkId,
        work_title: workTitleInDb(dir, seedWorkId),
        session_id: seedField(dir, "session_id"),
      };
    } else {
      target = onlyWork(dir);
    }
  }

  markWorkNewest(dir, target.work_id);
  write(dir, "production-sources-before.json", productionFingerprint());
  write(dir, "native-b40-config.json", {
    slice_id: sliceId,
    scenario: slice.scenario,
    provider: ready.provider,
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    messages: slice.messages ?? null,
    blank_text: slice.blank_text ?? null,
    recovery_message: slice.recovery_message ?? null,
    invalid_message: slice.invalid_message ?? null,
    message: slice.message ?? null,
    target,
    captures: slice.captures,
  });
  console.log(
    `B40 家族原生证据准备完成: slice=${sliceId} scenario=${slice.scenario} ` +
      `work=${target.work_id} title=${target.work_title}`,
  );
}

export function capture(dir, checkpoint) {
  const config = read(dir, "native-b40-config.json");
  assert(
    checkpoint === "start" || checkpoint === "final" || config.captures.includes(checkpoint),
    `未知 checkpoint: ${checkpoint}`,
  );
  rewrite(dir, `b40-${checkpoint}.json`, {
    at: new Date().toISOString(),
    checkpoint,
    db_production_counts: productionTableCounts(dir),
  });
}

// ── 通用证据读取 ────────────────────────────────────────────────────────────
const receivedTurnResults = (wire) =>
  wire
    .filter(
      (record) =>
        record.direction === "received" &&
        Array.isArray(record.frame) &&
        record.frame.length >= 5 &&
        record.frame[3] === "turn_result",
    )
    .map((record) => record.frame[4]);

function findTurnResult(wire, turnId) {
  return receivedTurnResults(wire).find((body) => String(body?.turn_id ?? "") === turnId) ?? null;
}

function findAgentEvent(wire, predicate) {
  return (
    wire.find(
      (record) =>
        record.direction === "received" &&
        Array.isArray(record.frame) &&
        record.frame.length >= 5 &&
        record.frame[3] === "agent_event" &&
        predicate(record.frame[4]),
    ) ?? null
  );
}

function findAgentRunState(wire, runId, status) {
  return (
    wire.find(
      (record) =>
        record.direction === "received" &&
        Array.isArray(record.frame) &&
        record.frame.length >= 5 &&
        record.frame[3] === "agent_run_state" &&
        String(record.frame[4]?.run_id ?? "") === runId &&
        record.frame[4]?.status === status,
    ) ?? null
  );
}

const appRecordsFor = (appRecords, turnId) =>
  appRecords.filter((record) => String(record.turn_id ?? "") === String(turnId));

function appEvent(appRecords, turnId, event, predicate = () => true) {
  return appRecordsFor(appRecords, turnId).find(
    (record) => record.event === event && predicate(record),
  );
}

const plannerFormEvents = (appRecords, turnIds) =>
  appRecords.filter(
    (record) =>
      turnIds.includes(record.turn_id) &&
      /^planner\.(form_micro_plan|form_frame)\./.test(String(record.event ?? "")),
  );

function errorEvents(appRecords, turnIds) {
  return appRecordsFor(appRecords, turnIds).filter((record) => {
    const event = String(record.event ?? "");
    return event.endsWith(".error") || event.endsWith(".failed") || record.level === "error";
  });
}

const userBubbleCount = (text) =>
  String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line === "你").length;
const assistantBubbleCount = (text) =>
  String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line === "AI").length;

const visibleMessageCount = (text) => userBubbleCount(text) + assistantBubbleCount(text);

function orderAnchored(text, tokens) {
  const indexes = tokens.map((token) => String(text).indexOf(token));
  if (indexes.some((index) => index < 0)) return { ok: false, indexes };
  const ordered = indexes.every((index, position) => position === 0 || index > indexes[position - 1]);
  return { ok: ordered, indexes };
}

const replyAnchor = (assistantText) => {
  const text = String(assistantText ?? "").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  return last.length >= 8 ? last.slice(-18) : text.slice(-12);
};

// AXButton「发送」disabled 状态是真实可访问性语义；writeAX 落盘为 disabled=true。
function sendButtonDisabledInDump(dumpText) {
  const line = String(dumpText ?? "")
    .split("\n")
    .find((entry) => entry.includes("AXButton") && entry.includes("发送"));
  return line ? line.includes("disabled=true") : null;
}

function composerDisabledInDump(dumpText) {
  const line = String(dumpText ?? "")
    .split("\n")
    .find((entry) => entry.includes("AXTextField") && entry.includes("输入"));
  return line ? line.includes("disabled=true") : null;
}

function noFallbackText(turnResults) {
  const serialized = JSON.stringify(turnResults);
  return FALLBACK_MARKERS.every((marker) => !serialized.includes(marker));
}

function commonChecks({ dir, slice, common, ready }) {
  return {
    native_ax_system_ui_driver:
      common.ui.driver === "ax-native-system-ui" && ready.driver === "external-system-ui",
    native_no_chromium_driver:
      ready.browser_driver_started === false && !fs.existsSync(path.join(dir, "ui-frames.json")),
    native_typed_wait_ledger:
      common.ledger.waits >= slice.minimumWaits && common.ledger.kinds.includes("turn"),
    native_screenshots_recorded: common.ui.screenshots.length >= slice.minScreenshots,
    deterministic_provider_mechanism_only: ready.provider === "slice_verify",
  };
}

function noProductionWriteChecks({ dir, turnResults, expectedProductions }) {
  const dbStart = read(dir, "b40-start.json");
  const dbFinal = read(dir, "b40-final.json");
  const dbUnchanged =
    JSON.stringify(dbStart.db_production_counts) === JSON.stringify(dbFinal.db_production_counts);
  const production = checkProductionFingerprint(dir);
  const truthfulnessOk = turnResults.every(
    (turnResult) => turnResult?.truthfulness?.production_write_performed === false,
  );
  return {
    db_production_tables_unchanged: dbUnchanged,
    product_sources_unchanged: production.unchanged,
    no_production_write_claimed: truthfulnessOk,
    expected_production_write_flags: expectedProductions,
  };
}

// ── 场景 1/2：普通聊天两轮（au01-ordinary-chat / pr-smoke-core-reply）────────────────
function verifyOrdinaryChat({ dir, slice, config }) {
  const ready = read(dir, "native-driver-ready.json");
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: slice.minScreenshots,
    minimumWaits: slice.minimumWaits,
  });
  const provider = assertProviderAndWire(dir, {
    minUserMessages: slice.minUserMessages,
    minTurnResults: slice.minTurnResults,
    minProviderStarts: 1,
  });
  const { appRecords, wire } = provider;
  writeNativeFrames(dir);
  for (const name of slice.captures) assertRecordFresh(dir, name, ready.ready_at);

  const finalText = axText(dir, "04-final");
  const turn1Text = axText(dir, "02-turn1");
  const sent = config.messages.map((message) => sentUserMessages(wire, message));
  const turns = sent.map((records, index) => {
    assert.equal(records.length, 1, `第 ${index + 1} 轮必须从真实工作台发送一次，实测 ${records.length}`);
    const facts = turnFacts(wire, records[0]);
    const turnResult = findTurnResult(wire, facts.turnId);
    assert(turnResult, `缺少第 ${index + 1} 轮 turn_result: ${facts.turnId}`);
    const traceSummary = turnResult.trace_summary ?? {};
    const frameSummary = turnResult.frame_summary ?? {};
    const replyRecord = traceSummary.reply_record ?? {};
    const assistantText = String(turnResult.assistant_message?.text ?? "");
    const judgmentDone = appEvent(
      appRecords,
      facts.turnId,
      "judgment.decided.done",
      (record) => record.action === "reply" && record.frame_type === "casual_reply",
    );
    const contextDone = appEvent(appRecords, facts.turnId, "context.assemble.done");
    const userMessageDone = appEvent(appRecords, facts.turnId, "channel.user_message.done");
    return {
      index,
      message: config.messages[index],
      sentRecord: records[0],
      sentBody: records[0].frame[4],
      turnId: facts.turnId,
      ack: facts.ack,
      turnResult,
      traceSummary,
      frameSummary,
      replyRecord,
      assistantText,
      judgmentDone,
      contextDone,
      userMessageDone,
    };
  });

  const turnIds = turns.map((turn) => turn.turnId);
  const anchors = orderAnchored(finalText, [
    config.messages[0],
    turns[0].assistantText,
    config.messages[1],
    turns[1].assistantText,
  ]);
  const bothRepliesVisible = turns.every((turn) =>
    `${turn1Text}\n${finalText}`.includes(replyAnchor(turn.assistantText)),
  );
  // AgentRun 活动条是运行窗口内的瞬态可见状态：浏览器 canonical 用 DOM observer 捕捉，
  // native 由外部驱动在点击发送后立即采样 AX 并落 driver-log；核验只读该采样（按 turn_id
  // 绑定），并交叉核对与传输帧 turn_id 一致，不接受其它来源的布尔值。
  const ordinaryDriverLogPath = path.join(dir, "native-b40-driver-log.json");
  const ordinaryDriverLog = fs.existsSync(ordinaryDriverLogPath)
    ? read(dir, "native-b40-driver-log.json")
    : null;
  const driverTurns = Array.isArray(ordinaryDriverLog?.turns) ? ordinaryDriverLog.turns : [];
  const activityFor = (turnId) => {
    const driverTurn = driverTurns.find((entry) => String(entry.turn_id ?? "") === turnId);
    return driverTurn?.activity_observed === true;
  };
  const activityObservedEveryTurn =
    driverTurns.length === turns.length && turns.every((turn) => activityFor(turn.turnId));
  const activitySamplingBoundToSameTurns =
    driverTurns.length === turns.length &&
    turns.every((turn) =>
      driverTurns.some((entry) => String(entry.turn_id ?? "") === turn.turnId),
    );
  const cardActionCount = turns.every(
    (turn) => (turn.turnResult?.available_actions ?? []).length === 0,
  );
  const noCardUi =
    !NO_CARD_PATTERN.test(finalText) &&
    !NO_CARD_PATTERN.test(turn1Text) &&
    cardActionCount &&
    !wire.some(
      (record) => record.direction === "sent" && record.frame?.[3] === "author_action",
    ) &&
    !appRecordsFor(appRecords, turnIds).some((record) =>
      /^adoption\.evaluate\.|^channel\.adopt\.|^channel\.author_action\./.test(
        String(record.event ?? ""),
      ),
    );
  const plannerEvents = plannerFormEvents(appRecords, turnIds);
  const providerStarts = appRecords.filter(
    (record) => record.event === "provider_gateway.complete.start",
  );

  const checks = {
    ...commonChecks({ dir, slice, common, ready }),
    message_sent_from_real_workbench: sent.every((records) => records.length === 1),
    sent_to_target_work: turns.every(
      (turn) => String(turn.sentBody?.work_id ?? "") === config.target.work_id,
    ),
    // ── manifest network/data：判断纪元普通回复链 ──────────────────────────────
    two_user_turns_completed: turns.length === 2,
    turn_ids_are_distinct: new Set(turnIds).size === 2,
    each_turn_received_ack: turns.every((turn) => Boolean(turn.ack)),
    each_turn_received_turn_result: turns.every((turn) => Boolean(turn.turnResult)),
    micro_plan_not_requested:
      turns.every((turn) => turn.sentBody?.generate_micro_plan === false) &&
      !framesPlanDrafted(wire) &&
      plannerEvents.length === 0,
    no_retired_planner_form_event: plannerEvents.length === 0,
    each_turn_records_judgment_decided_done: turns.every((turn) => Boolean(turn.judgmentDone)),
    each_turn_records_user_message_done: turns.every((turn) => Boolean(turn.userMessageDone)),
    each_turn_assembles_selected_work_context: turns.every(
      (turn) => Boolean(turn.contextDone) && String(turn.contextDone?.work_id ?? "") === config.target.work_id,
    ),
    turn_result_frame_type_casual_reply: turns.every(
      (turn) => turn.frameSummary.frame_type === "casual_reply",
    ),
    trace_decision_type_reply_only: turns.every(
      (turn) => turn.traceSummary.decision_type === "reply_only",
    ),
    no_tool_reason_no_tool_requested: turns.every(
      (turn) => String(turn.traceSummary.no_tool_reason ?? "") === "no_tool_requested",
    ),
    reply_record_response_kind_plain_text: turns.every(
      (turn) => turn.replyRecord.response_kind === "plain_text",
    ),
    assistant_reply_is_exact_provider_output_bytes: turns.every(
      (turn) =>
        String(turn.replyRecord.raw_content ?? "") === turn.assistantText &&
        turn.assistantText.trim().length > 0,
    ),
    assistant_messages_not_fallback: noFallbackText(turns.map((turn) => turn.turnResult)),
    // ── manifest ui：真实窗口可见顺序/输入可用/无卡片 ───────────────────────────
    real_workbench_rendered_two_user_and_two_assistant_turns_in_order: anchors.ok,
    two_user_and_two_assistant_replies_visible: bothRepliesVisible,
    input_usable_for_second_turn: sent[1].length === 1,
    agent_run_activity_appeared_during_each_turn_and_legacy_thinking_cleared:
      activitySamplingBoundToSameTurns &&
      activityObservedEveryTurn &&
      !finalText.includes("思考中"),
    trivial_completed_agent_run_summaries_cleared_after_reply:
      !finalText.includes("当前创作请求的工作过程") && !finalText.includes("创作执行"),
    no_action_candidate_or_adoption_cards_rendered: noCardUi,
    no_error_events: errorEvents(appRecords, turnIds).length === 0,
    deterministic_provider_judgment_called_per_turn:
      turns.every((turn) => Boolean(turn.judgmentDone)) && providerStarts.length >= 2,
    // ── 无工具/无采纳/无生产写入 ───────────────────────────────────────────────
    no_tool_result: turns.every((turn) => turn.turnResult.tool_result == null),
    no_adoption_state: turns.every((turn) => turn.turnResult.adoption_state == null),
    no_truthfulness_tool_call: turns.every((turn) => turn.turnResult.truthfulness?.tool_called !== true),
    no_truthfulness_production_write: turns.every(
      (turn) => turn.turnResult.truthfulness?.production_write_performed === false,
    ),
    ...(() => {
      const writeChecks = noProductionWriteChecks({
        dir,
        turnResults: turns.map((turn) => turn.turnResult),
        expectedProductions: true,
      });
      delete writeChecks.expected_production_write_flags;
      return writeChecks;
    })(),
  };

  const measured = {
    turn_ids: turnIds,
    assistant_texts: turns.map((turn) => turn.assistantText),
    message_text_order_anchored: anchors.ok,
    message_text_indexes: anchors.indexes,
    activity_observed_each_turn: activityObservedEveryTurn,
    activity_sampling_bound_to_same_turns: activitySamplingBoundToSameTurns,
    driver_turn_activity_probes: driverTurns.map((entry) => ({
      turn_id: entry.turn_id,
      activity_observed: entry.activity_observed === true,
      activity_probes: entry.activity_probes ?? [],
    })),
    provider_start_count: providerStarts.length,
    planner_form_event_count: plannerEvents.length,
    visible_text: { final: finalText, turn1: turn1Text },
  };
  for (const name of slice.expected) {
    assert(Object.hasOwn(checks, name), `缺少 E2E/manifest 期望断言检查项: ${name}`);
  }
  return { checks, measured, common, turnIds };
}

function framesPlanDrafted(wire) {
  return wire.some(
    (record) =>
      record.direction === "received" &&
      record.frame?.[3] === "agent_event" &&
      record.frame?.[4]?.event_type === "plan_drafted",
  );
}

// ── 场景 3：空消息守卫 ───────────────────────────────────────────────────────
function verifyEmptyMessageGuard({ dir, slice, config }) {
  const ready = read(dir, "native-driver-ready.json");
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: slice.minScreenshots,
    minimumWaits: slice.minimumWaits,
  });
  const provider = assertProviderAndWire(dir, {
    minUserMessages: slice.minUserMessages,
    minTurnResults: slice.minTurnResults,
    minProviderStarts: 1,
  });
  const { appRecords, wire } = provider;
  writeNativeFrames(dir);
  for (const name of slice.captures) assertRecordFresh(dir, name, ready.ready_at);

  const workbenchText = axText(dir, "01-workbench");
  const blankText = axText(dir, "02-blank");
  const recoveryText = axText(dir, "03-recovery");
  const finalText = axText(dir, "04-final");
  const blankSendDisabled = sendButtonDisabledInDump(axDump(dir, "02-blank"));
  const blankComposerDisabled = composerDisabledInDump(axDump(dir, "02-blank"));
  const recoveryComposerDisabled = composerDisabledInDump(axDump(dir, "04-final"));

  const allSentUserMessages = wire.filter(
    (record) =>
      record.direction === "sent" &&
      Array.isArray(record.frame) &&
      record.frame.length >= 5 &&
      record.frame[3] === "user_message",
  );
  const recoveryMessages = sentUserMessages(wire, config.recovery_message);
  assert.equal(recoveryMessages.length, 1, `恢复轮必须发送一次，实测 ${recoveryMessages.length}`);
  const recoveryFacts = turnFacts(wire, recoveryMessages[0]);
  const recoveryTurn = findTurnResult(wire, recoveryFacts.turnId);
  assert(recoveryTurn, `缺少恢复轮 turn_result: ${recoveryFacts.turnId}`);
  const recoveryTrace = recoveryTurn.trace_summary ?? {};
  const recoveryFrame = recoveryTurn.frame_summary ?? {};
  const recoveryReplyRecord = recoveryTrace.reply_record ?? {};
  const recoveryAssistant = String(recoveryTurn.assistant_message?.text ?? "");
  const recoveryJudgment = appEvent(
    appRecords,
    recoveryFacts.turnId,
    "judgment.decided.done",
    (record) => record.frame_type === "casual_reply",
  );
  const recoveryContext = appEvent(appRecords, recoveryFacts.turnId, "context.assemble.done");
  const recoveryUserDone = appEvent(appRecords, recoveryFacts.turnId, "channel.user_message.done");

  const blankAddedMessages =
    userBubbleCount(blankText) !== userBubbleCount(workbenchText) ||
    assistantBubbleCount(blankText) !== assistantBubbleCount(workbenchText);
  const blankSentUserMessageFrames = allSentUserMessages.length - recoveryMessages.length;
  const driverLogPath = path.join(dir, "native-b40-driver-log.json");
  const driverLog = fs.existsSync(driverLogPath) ? read(dir, "native-b40-driver-log.json") : null;
  const driverBlank = driverLog?.blank ?? null;
  const plannerEvents = plannerFormEvents(appRecords, [recoveryFacts.turnId]);

  const checks = {
    ...commonChecks({ dir, slice, common, ready }),
    message_sent_from_real_workbench: recoveryMessages.length === 1,
    // ── manifest ui：空输入发送不可用/不追加消息/思考不出现/输入仍可用 ─────────────
    blank_input_sent_no_user_message_frame: blankSentUserMessageFrames === 0,
    blank_input_did_not_append_visible_messages: !blankAddedMessages,
    blank_input_left_thinking_hidden: !blankText.includes("思考中"),
    input_remained_available_after_blank:
      blankComposerDisabled === false &&
      recoveryComposerDisabled === false &&
      recoveryMessages.length === 1,
    blank_send_button_disabled: blankSendDisabled === true,
    following_valid_chat_completed_without_micro_plan:
      recoveryMessages.length === 1 &&
      recoveryMessages[0].frame[4]?.generate_micro_plan === false &&
      plannerEvents.length === 0 &&
      !framesPlanDrafted(wire),
    // ── manifest network/data：恢复轮判断纪元链 ────────────────────────────────
    recovery_turn_received_ack: Boolean(recoveryFacts.ack),
    recovery_turn_received_turn_result: Boolean(recoveryTurn),
    recovery_assistant_reply_visible: `${recoveryText}\n${finalText}`.includes(
      replyAnchor(recoveryAssistant),
    ),
    recovery_turn_frame_type_casual_reply: recoveryFrame.frame_type === "casual_reply",
    recovery_trace_decision_type_reply_only: recoveryTrace.decision_type === "reply_only",
    recovery_assistant_is_exact_provider_output_bytes:
      String(recoveryReplyRecord.raw_content ?? "") === recoveryAssistant &&
      recoveryAssistant.trim().length > 0,
    deterministic_provider_judgment_called_for_recovery_turn: Boolean(recoveryJudgment),
    recovery_turn_records_judgment_decided_done: Boolean(recoveryJudgment),
    recovery_turn_records_user_message_done: Boolean(recoveryUserDone),
    recovery_turn_assembles_selected_work_context:
      Boolean(recoveryContext) && String(recoveryContext?.work_id ?? "") === config.target.work_id,
    no_retired_planner_form_event: plannerEvents.length === 0,
    no_tool_result: recoveryTurn.tool_result == null,
    no_adoption_state: recoveryTurn.adoption_state == null,
    no_truthfulness_tool_call: recoveryTurn.truthfulness?.tool_called !== true,
    no_truthfulness_production_write:
      recoveryTurn.truthfulness?.production_write_performed === false,
    no_error_events: errorEvents(appRecords, [recoveryFacts.turnId]).length === 0,
    ...(() => {
      const writeChecks = noProductionWriteChecks({
        dir,
        turnResults: [recoveryTurn],
        expectedProductions: true,
      });
      delete writeChecks.expected_production_write_flags;
      return writeChecks;
    })(),
  };
  // 驱动侧观察到的一致证据（发送按钮 disabled 状态）必须与 AX 落盘一致。
  if (driverBlank) {
    checks.blank_send_disabled_matches_driver_observation =
      driverBlank.send_button_disabled === (blankSendDisabled === true);
    checks.blank_driver_counts_no_visible_message_append =
      driverBlank.user_bubbles_before === driverBlank.user_bubbles_after &&
      driverBlank.assistant_bubbles_before === driverBlank.assistant_bubbles_after;
  }

  const measured = {
    blank_text: config.blank_text,
    blank_send_button_disabled: blankSendDisabled,
    blank_composer_disabled: blankComposerDisabled,
    blank_user_message_frames: blankSentUserMessageFrames,
    blank_visible_message_count_before: visibleMessageCount(workbenchText),
    blank_visible_message_count_after: visibleMessageCount(blankText),
    recovery_turn_id: recoveryFacts.turnId,
    recovery_assistant_text: recoveryAssistant,
    driver_log_blank: driverBlank,
    visible_text: { workbench: workbenchText, blank: blankText, recovery: recoveryText, final: finalText },
  };
  for (const name of slice.expected) {
    assert(Object.hasOwn(checks, name), `缺少 E2E/manifest 期望断言检查项: ${name}`);
  }
  return { checks, measured, common, turnIds: [recoveryFacts.turnId] };
}

// ── 场景 4：frame 校验友好错误 ───────────────────────────────────────────────
function verifyFrameValidation({ dir, slice, config }) {
  const ready = read(dir, "native-driver-ready.json");
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: slice.minScreenshots,
    minimumWaits: slice.minimumWaits,
  });
  const provider = assertProviderAndWire(dir, {
    minUserMessages: slice.minUserMessages,
    minTurnResults: slice.minTurnResults,
    minProviderStarts: 1,
  });
  const { appRecords, wire } = provider;
  writeNativeFrames(dir);
  for (const name of slice.captures) assertRecordFresh(dir, name, ready.ready_at);

  const fallbackText = axText(dir, "02-fallback");
  const recoveryText = axText(dir, "03-recovery");
  const finalText = axText(dir, "04-final");
  const allVisible = `${fallbackText}\n${recoveryText}\n${finalText}`;

  const invalidMessages = sentUserMessages(wire, config.invalid_message);
  const recoveryMessages = sentUserMessages(wire, config.recovery_message);
  assert.equal(invalidMessages.length, 1, `协议损坏轮必须发送一次，实测 ${invalidMessages.length}`);
  assert.equal(recoveryMessages.length, 1, `恢复轮必须发送一次，实测 ${recoveryMessages.length}`);

  const invalidFacts = turnFacts(wire, invalidMessages[0]);
  const invalidTurn = findTurnResult(wire, invalidFacts.turnId);
  assert(invalidTurn, `缺少协议损坏轮 turn_result: ${invalidFacts.turnId}`);
  const recoveryFacts = turnFacts(wire, recoveryMessages[0]);
  const recoveryTurn = findTurnResult(wire, recoveryFacts.turnId);
  assert(recoveryTurn, `缺少恢复轮 turn_result: ${recoveryFacts.turnId}`);

  const invalidAssistant = String(invalidTurn.assistant_message?.text ?? "");
  const recoveryTrace = recoveryTurn.trace_summary ?? {};
  const recoveryFrame = recoveryTurn.frame_summary ?? {};
  const recoveryReplyRecord = recoveryTrace.reply_record ?? {};
  const recoveryAssistant = String(recoveryTurn.assistant_message?.text ?? "");
  const recoveryJudgment = appEvent(
    appRecords,
    recoveryFacts.turnId,
    "judgment.decided.done",
    (record) => record.frame_type === "casual_reply",
  );
  const invalidJudgment = appEvent(appRecords, invalidFacts.turnId, "judgment.decided.done");
  const invalidSerialized = JSON.stringify(invalidTurn);
  const allTurnsSerialized = JSON.stringify([invalidTurn, recoveryTurn]);
  const internalReasonVisible = INTERNAL_VALIDATION_REASONS.some((token) =>
    allVisible.includes(token),
  );
  const internalReasonInTurnResult = INTERNAL_VALIDATION_REASONS.some((token) =>
    allTurnsSerialized.includes(token),
  );
  const friendlyFallback =
    invalidAssistant.trim().length > 0 &&
    invalidAssistant.includes("重试") &&
    !invalidAssistant.includes("not valid json") &&
    !invalidAssistant.includes("{{{") &&
    !FALLBACK_MARKERS.some((marker) => invalidAssistant.includes(marker));
  const recoveryIsNotFallback =
    !recoveryAssistant.includes("格式不符合") &&
    !recoveryAssistant.includes("没有通过校验") &&
    !recoveryAssistant.includes("重试");
  const plannerEvents = plannerFormEvents(appRecords, [invalidFacts.turnId, recoveryFacts.turnId]);
  const recoveryComposerDisabled = composerDisabledInDump(axDump(dir, "04-final"));

  const checks = {
    ...commonChecks({ dir, slice, common, ready }),
    message_sent_from_real_workbench: invalidMessages.length === 1 && recoveryMessages.length === 1,
    // ── manifest ui/network/data：S7 安全失败 + 友好可重试 + 无内部原因泄漏 ──────
    invalid_judgment_action_settled_as_safe_failure:
      invalidTurn.status === "failed_recoverable" &&
      invalidTurn.phase === "failed" &&
      !invalidJudgment,
    author_visible_fallback_is_friendly: friendlyFallback,
    fallback_message_visible_in_native_window: fallbackText.includes(replyAnchor(invalidAssistant)),
    internal_validation_reason_not_visible: !internalReasonVisible,
    internal_validation_reason_not_in_turn_result: !internalReasonInTurnResult,
    input_remained_available_after_frame_validation_failure:
      recoveryComposerDisabled === false && recoveryMessages.length === 1,
    thinking_cleared_after_fallback: !fallbackText.includes("思考中"),
    invalid_frame_turn_sent_user_message_without_micro_plan:
      invalidMessages[0].frame[4]?.generate_micro_plan === false,
    recovery_turn_sent_user_message_without_micro_plan:
      recoveryMessages[0].frame[4]?.generate_micro_plan === false,
    following_valid_chat_completed_without_micro_plan:
      recoveryMessages.length === 1 &&
      recoveryMessages[0].frame[4]?.generate_micro_plan === false &&
      plannerEvents.length === 0 &&
      !framesPlanDrafted(wire),
    recovery_turn_received_ack: Boolean(recoveryFacts.ack),
    recovery_turn_frame_type_casual_reply: recoveryFrame.frame_type === "casual_reply",
    recovery_turn_records_judgment_decided_done: Boolean(recoveryJudgment),
    recovery_assistant_reply_visible: `${recoveryText}\n${finalText}`.includes(
      replyAnchor(recoveryAssistant),
    ),
    recovery_assistant_is_exact_provider_output_bytes:
      String(recoveryReplyRecord.raw_content ?? "") === recoveryAssistant &&
      recoveryAssistant.trim().length > 0,
    recovery_assistant_is_not_fallback: recoveryIsNotFallback,
    deterministic_provider_recovery_turn_completed: Boolean(recoveryJudgment),
    no_retired_planner_form_event: plannerEvents.length === 0,
    invalid_turn_has_no_tool_or_adoption:
      invalidTurn.tool_result == null && invalidTurn.adoption_state == null,
    no_truthfulness_production_write:
      invalidTurn.truthfulness?.production_write_performed === false &&
      recoveryTurn.truthfulness?.production_write_performed === false,
    ...(() => {
      const writeChecks = noProductionWriteChecks({
        dir,
        turnResults: [invalidTurn, recoveryTurn],
        expectedProductions: true,
      });
      delete writeChecks.expected_production_write_flags;
      return writeChecks;
    })(),
  };

  const measured = {
    invalid_frame_turn_id: invalidFacts.turnId,
    invalid_turn_status: invalidTurn.status,
    invalid_turn_phase: invalidTurn.phase,
    fallback_text: invalidAssistant,
    recovery_turn_id: recoveryFacts.turnId,
    recovery_assistant_text: recoveryAssistant,
    internal_validation_reason_visible: internalReasonVisible,
    internal_validation_reason_in_turn_result: internalReasonInTurnResult,
    visible_text: { fallback: fallbackText, recovery: recoveryText, final: finalText },
  };
  for (const name of slice.expected) {
    assert(Object.hasOwn(checks, name), `缺少 E2E/manifest 期望断言检查项: ${name}`);
  }
  return {
    checks,
    measured,
    common,
    turnIds: [invalidFacts.turnId, recoveryFacts.turnId],
  };
}

// ── 场景 5：au02 自然探索候选方向（无 slot 表单）───────────────────────────────
function verifyNaturalExploration({ dir, slice, config }) {
  const ready = read(dir, "native-driver-ready.json");
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: slice.minScreenshots,
    minimumWaits: slice.minimumWaits,
  });
  const provider = assertProviderAndWire(dir, {
    minUserMessages: slice.minUserMessages,
    minTurnResults: slice.minTurnResults,
    minProviderStarts: 1,
  });
  const { appRecords, wire } = provider;
  writeNativeFrames(dir);
  for (const name of slice.captures) assertRecordFresh(dir, name, ready.ready_at);

  const candidateText = axText(dir, "02-candidates");
  const finalText = axText(dir, "03-final");
  const sent = sentUserMessages(wire, config.message);
  assert.equal(sent.length, 1, `模糊创作输入必须从真实工作台发送一次，实测 ${sent.length}`);
  const facts = turnFacts(wire, sent[0]);
  const turnResult = findTurnResult(wire, facts.turnId);
  assert(turnResult, `缺少候选轮 turn_result: ${facts.turnId}`);
  const candidates = Array.isArray(turnResult.candidate_directions)
    ? turnResult.candidate_directions
    : [];
  assert(candidates.length > 0, "候选轮 turn_result 没有 candidate_directions");
  const assistantText = String(turnResult.assistant_message?.text ?? "");
  const judgmentDone = appEvent(
    appRecords,
    facts.turnId,
    "judgment.decided.done",
    (record) =>
      record.frame_type === "creative_exploration" && Number(record.candidate_count ?? 0) > 0,
  );
  const contextDone = appEvent(appRecords, facts.turnId, "context.assemble.done");
  const userMessageDone = appEvent(appRecords, facts.turnId, "channel.user_message.done");
  const plannerEvents = plannerFormEvents(appRecords, [facts.turnId]);
  const forbiddenSlotFields = ["required_slots", "missing_slots", "slot_schema", "slot_form"];
  const forbiddenSlotFieldsAbsent = forbiddenSlotFields.every(
    (key) => turnResult[key] == null,
  );
  const candidateTitles = candidates.map((item) => String(item?.title ?? ""));
  const candidatePitches = candidates.map((item) => String(item?.pitch ?? ""));
  const titlesVisible = candidateTitles.filter(Boolean).every((title) => candidateText.includes(title));
  const pitchesVisible = candidatePitches.filter(Boolean).every((pitch) => candidateText.includes(pitch));
  const replyVisible = `${candidateText}\n${finalText}`.includes(replyAnchor(assistantText));
  const authorActionFrames = wire.filter(
    (record) => record.direction === "sent" && record.frame?.[3] === "author_action",
  );
  const actionResultFrames = wire.filter(
    (record) => record.direction === "received" && record.frame?.[3] === "action_result",
  );

  const checks = {
    ...commonChecks({ dir, slice, common, ready }),
    real_workbench_sent_fuzzy_creative_input:
      sent.length === 1 && String(sent[0].frame[4]?.text ?? "") === config.message,
    sent_to_target_work: String(sent[0].frame[4]?.work_id ?? "") === config.target.work_id,
    micro_plan_not_requested:
      sent[0].frame[4]?.generate_micro_plan === false &&
      plannerEvents.length === 0 &&
      !framesPlanDrafted(wire),
    judgment_returns_creative_exploration_frame: Boolean(judgmentDone),
    judgment_candidate_count_positive: Number(judgmentDone?.candidate_count ?? 0) > 0,
    // ── manifest ui：自然回复可见 + 候选卡真实渲染 + 无机械表单/执行卡 ──────────────
    natural_assistant_reply_visible: replyVisible,
    candidate_panel_rendered_from_turn_result:
      candidates.length > 0 && titlesVisible && pitchesVisible && candidateText.includes("可讨论方向"),
    candidate_titles_and_pitches_exposed_by_turn_result:
      candidateTitles.every((title) => title.trim() !== "") &&
      candidatePitches.every((pitch) => pitch.trim() !== ""),
    mechanical_slot_form_not_rendered:
      !SLOT_FORM_PATTERN.test(`${candidateText}\n${finalText}`) && forbiddenSlotFieldsAbsent,
    execution_or_confirmation_card_not_rendered:
      !EXECUTION_CARD_PATTERN.test(`${candidateText}\n${finalText}`),
    // ── manifest network/data：无工具/采纳/生产写入/author_action ──────────────────
    no_tool_result: turnResult.tool_result == null,
    no_adoption_decision: turnResult.adoption_state == null && !turnResult.adoption_decision,
    candidate_not_selected_or_adopted:
      turnResult.truthfulness?.candidate_selected !== true &&
      turnResult.truthfulness?.candidate_adopted !== true,
    production_write_not_claimed:
      turnResult.truthfulness?.production_write_performed === false,
    no_author_action_sent: authorActionFrames.length === 0,
    no_action_result_received: actionResultFrames.length === 0,
    deterministic_provider_form_frame_called_for_source_candidate_turn: Boolean(judgmentDone),
    turn_records_judgment_decided_done: Boolean(judgmentDone),
    turn_records_user_message_done: Boolean(userMessageDone),
    turn_assembles_selected_work_context: Boolean(contextDone),
    no_retired_planner_form_event: plannerEvents.length === 0,
    no_error_events: errorEvents(appRecords, [facts.turnId]).length === 0,
    ...(() => {
      const writeChecks = noProductionWriteChecks({
        dir,
        turnResults: [turnResult],
        expectedProductions: true,
      });
      delete writeChecks.expected_production_write_flags;
      return writeChecks;
    })(),
  };

  const measured = {
    turn_id: facts.turnId,
    frame_type: judgmentDone?.frame_type ?? null,
    candidate_count: Number(judgmentDone?.candidate_count ?? 0),
    candidate_titles: candidateTitles,
    candidate_pitches: candidatePitches,
    assistant_text: assistantText,
    candidate_panel_visible: candidateText.includes("可讨论方向"),
    slot_form_visible: SLOT_FORM_PATTERN.test(`${candidateText}\n${finalText}`),
    execution_card_visible: EXECUTION_CARD_PATTERN.test(`${candidateText}\n${finalText}`),
    author_action_frame_count: authorActionFrames.length,
    action_result_frame_count: actionResultFrames.length,
    visible_text: { candidates: candidateText, final: finalText },
  };
  for (const name of slice.expected) {
    assert(Object.hasOwn(checks, name), `缺少 E2E/manifest 期望断言检查项: ${name}`);
  }
  return { checks, measured, common, turnIds: [facts.turnId] };
}

// ── 场景 6：agent-step-regate（AgentRun 多步 12 门 allow + author-safe why）─────────
function verifyAgentStepRegate({ dir, slice, config }) {
  const ready = read(dir, "native-driver-ready.json");
  const common = assertCommonEvidence(dir, {
    sliceId: config.slice_id,
    minScreenshots: slice.minScreenshots,
    minimumWaits: slice.minimumWaits,
  });
  const provider = assertProviderAndWire(dir, {
    minUserMessages: slice.minUserMessages,
    minTurnResults: slice.minTurnResults,
    minProviderStarts: 1,
  });
  const { appRecords, wire } = provider;
  writeNativeFrames(dir);
  for (const name of slice.captures) assertRecordFresh(dir, name, ready.ready_at);

  const sent = sentUserMessages(wire, config.message);
  assert.equal(sent.length, 1, `复合 AgentRun 请求必须从真实工作台发送一次，实测 ${sent.length}`);
  const sentBody = sent[0].frame[4];
  const ack = turnFacts(wire, sent[0]).ack;
  assert(ack, "缺少 bounded AgentRun 快速 ack");
  const ackBody = ack.frame[4];
  const runId = String(ackBody?.response?.run_id ?? "");
  assert(runId, "bounded AgentRun ack 缺 run_id");

  const rosterTurn = receivedTurnResults(wire).find(
    (body) =>
      String(body?.work_id ?? "") === config.target.work_id &&
      body?.tool_result?.tool_name === "character_roster" &&
      body?.tool_result?.status === "succeeded",
  );
  assert(rosterTurn, "缺少内部 character_roster 工具步 turn_result");
  const finalTurn = receivedTurnResults(wire).find(
    (body) =>
      String(body?.work_id ?? "") === config.target.work_id &&
      body?.agent_run?.run_id === runId &&
      body?.tool_result?.tool_name === "character_design" &&
      body?.tool_result?.status === "succeeded",
  );
  assert(finalTurn, "缺少内部 character_design 最终 turn_result");
  const rosterTurnId = String(rosterTurn.turn_id ?? "");
  const finalTurnId = String(finalTurn.turn_id ?? "");
  const pending = finalTurn.adoption_state?.pending?.[0] ?? null;
  const rosterTrace = rosterTurn.trace_summary ?? {};
  const finalTrace = finalTurn.trace_summary ?? {};

  const runStarted = findAgentEvent(
    wire,
    (body) => body?.run_ref === runId && body?.event_type === "run_started",
  );
  const runCompleted = findAgentEvent(
    wire,
    (body) => body?.run_ref === runId && body?.event_type === "run_completed",
  );
  const gateDecidedEvents = wire
    .filter(
      (record) =>
        record.direction === "received" &&
        Array.isArray(record.frame) &&
        record.frame.length >= 5 &&
        record.frame[3] === "agent_event" &&
        record.frame[4]?.run_ref === runId &&
        record.frame[4]?.event_type === "gate_decided",
    )
    .map((record) => record.frame[4]);
  const planDraftedCount = wire.filter(
    (record) =>
      record.direction === "received" &&
      record.frame?.[3] === "agent_event" &&
      record.frame?.[4]?.run_ref === runId &&
      record.frame?.[4]?.event_type === "plan_drafted",
  ).length;
  const completedState = findAgentRunState(wire, runId, "completed");
  const consumedBudget = completedState?.frame?.[4]?.consumed_budget ?? {};

  // ── app JSONL：父消息 + 两个内部步的 12 门 allow lineage ──────────────────────
  const parentUserDone = appRecords.find(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.turn_id === String(sentBody?.turn_id ?? "") &&
      record.run_id === runId &&
      String(record.run_mode ?? "") === "bounded",
  );
  const allowDecisions = appRecords.filter(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool" &&
      record.turn_id === rosterTurnId,
  );
  const allowDecisionsDesign = appRecords.filter(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      String(record.decision_type ?? "") === "allow_tool" &&
      record.turn_id === finalTurnId,
  );
  const toolboxRoster = appEvent(
    appRecords,
    rosterTurnId,
    "toolbox.execute.done",
    (record) => record.tool_name === "character_roster",
  );
  const toolboxDesign = appEvent(
    appRecords,
    finalTurnId,
    "toolbox.execute.done",
    (record) => record.tool_name === "character_design",
  );
  const gateDecisions = [...allowDecisions, ...allowDecisionsDesign];
  const lineageChecks = (decision) => {
    const lineage = Array.isArray(decision?.gate_outcomes) ? decision.gate_outcomes : [];
    return (
      decision != null &&
      String(decision.gate_order_version ?? "") === "adr-0005-v1" &&
      Number(decision.gate_count ?? -1) === GATE_ORDER.length &&
      lineage.length === GATE_ORDER.length &&
      lineage.every(
        (entry, index) => entry.gate === GATE_ORDER[index] && entry.order === index,
      ) &&
      lineage.every((entry) => ["pass", "pass_with_note"].includes(entry.outcome)) &&
      decision.first_blocking_gate == null
    );
  };
  const stepGateLineages = gateDecisions.map((decision) => decision.gate_outcomes ?? []);
  const budgetGate = stepGateLineages[0]?.find((entry) => entry.gate === "budget");
  const traceReadinessGate = stepGateLineages[0]?.find((entry) => entry.gate === "trace_readiness");
  const distinctDecisionIds =
    new Set(gateDecisions.map((decision) => String(decision.decision_id ?? ""))).size ===
    gateDecisions.length;
  const gateEventChecks = gateDecidedEvents.length === 2 &&
    gateDecidedEvents.every((event) => {
      const payload = event.payload ?? {};
      const results = Array.isArray(payload.gate_results) ? payload.gate_results : [];
      return (
        String(payload.gate_order_version ?? "") === "adr-0005-v1" &&
        results.length === GATE_ORDER.length &&
        payload.first_blocking_gate == null
      );
    });
  const stepTraceChecks = [rosterTrace, finalTrace].every(
    (trace) =>
      String(trace.gate_order_version ?? "") === "adr-0005-v1" &&
      Array.isArray(trace.gate_results) &&
      trace.gate_results.length === GATE_ORDER.length,
  );
  const noAuthorActionOrAdoption =
    !wire.some((record) => record.direction === "sent" && record.frame?.[3] === "author_action") &&
    !appRecordsFor(appRecords, [rosterTurnId, finalTurnId]).some((record) =>
      /^channel\.adopt\.|^adoption\.evaluate\.|^channel\.author_action\./.test(
        String(record.event ?? ""),
      ),
    );

  // ── author-safe「为什么」面板（工具决定 + 回放不调模型 + 无 raw/gate 文本）────────
  const whyText = axText(dir, "04-why");
  const preWhyText = axText(dir, "03-final");
  const whyPanelNewlyVisible =
    !preWhyText.includes("参考来源") && !preWhyText.includes("不会重新调用模型");
  const whyShowsToolDecision =
    whyText.includes("本轮使用了工具") || whyText.includes("已调用工具");
  const whyStatesNoProviderReplay = whyText.includes("不会重新调用模型");
  const whyLeaksUnsafe = UNSAFE_WHY.test(whyText);

  const checks = {
    ...commonChecks({ dir, slice, common, ready }),
    message_sent_from_real_workbench: sent.length === 1,
    sent_to_target_work: String(sentBody?.work_id ?? "") === config.target.work_id,
    micro_plan_not_requested: sentBody?.generate_micro_plan === false,
    // ── manifest data：bounded run ack + 两步 allow_tool + 12 门 lineage ──────────
    parent_user_message_returned_bounded_run_id_without_sync_turn_fallback:
      Boolean(runId) && String(ackBody?.response?.run_mode ?? "") === "bounded",
    bounded_run_started_and_completed_events_broadcast:
      Boolean(runStarted) && Boolean(runCompleted),
    channel_user_message_done_records_bounded_run:
      Boolean(parentUserDone),
    internal_roster_step_crossed_allow_tool_gate:
      allowDecisions.length === 1 && Boolean(toolboxRoster),
    internal_character_design_step_crossed_allow_tool_gate:
      allowDecisionsDesign.length === 1 && Boolean(toolboxDesign),
    character_roster_tool_executed_after_gate:
      Boolean(toolboxRoster) && Boolean(allowDecisions[0]),
    character_design_tool_executed_after_gate:
      Boolean(toolboxDesign) && Boolean(allowDecisionsDesign[0]),
    each_internal_step_recorded_ordered_twelve_gate_results:
      gateDecisions.length === 2 && gateDecisions.every(lineageChecks),
    gate_order_version_recorded_per_step:
      gateDecisions.every((decision) => String(decision.gate_order_version ?? "") === "adr-0005-v1"),
    no_allow_step_contains_blocking_gate_outcome:
      stepGateLineages.every((lineage) =>
        lineage.every((entry) => ["pass", "pass_with_note"].includes(entry.outcome)),
      ),
    step_gate_results_written_to_decision_trace: stepTraceChecks,
    run_budget_gate_used_real_remaining_budget:
      budgetGate?.outcome === "pass_with_note" &&
      (budgetGate?.notes ?? []).includes("run_budget_remaining"),
    trace_readiness_gate_used_real_persistence_channel: traceReadinessGate?.outcome === "pass",
    two_steps_used_distinct_decision_lineage: distinctDecisionIds,
    each_step_broadcast_gate_decided_event: gateEventChecks,
    no_mechanical_plan_drafted_pseudo_plan: planDraftedCount === 0,
    bounded_run_consumed_budget_matches_contract:
      Number(consumedBudget.steps ?? 0) === 4 &&
      Number(consumedBudget.tool_calls ?? 0) === 2 &&
      Number(consumedBudget.provider_calls ?? 0) === 2,
    // ── manifest data：最终候选是待采纳（不自动采纳/不生产写入）──────────────────
    final_character_design_candidate_is_pending:
      pending?.artifact_type === "character_seed" &&
      pending?.requires_adoption === true &&
      String(pending?.adoption_status ?? "") === "TENTATIVE",
    character_design_candidate_was_not_auto_adopted:
      finalTurn.truthfulness?.artifact_adopted === false && noAuthorActionOrAdoption,
    no_production_write:
      finalTurn.truthfulness?.production_write_performed === false &&
      rosterTurn.truthfulness?.production_write_performed === false,
    roster_step_is_read_only:
      rosterTurn.tool_result?.tool_name === "character_roster" &&
      rosterTurn.truthfulness?.tool_called === true,
    // ── author-safe why（E4 期望断言名）──────────────────────────────────────────
    author_safe_why_dialog_shows_tool_decision: whyShowsToolDecision,
    author_safe_why_states_replay_does_not_call_provider: whyStatesNoProviderReplay,
    author_safe_why_hides_raw_prompt_and_internal_gate_codes: !whyLeaksUnsafe,
    why_panel_visible_only_after_click: whyPanelNewlyVisible,
    candidate_card_rendered_in_native_window: axText(dir, "03-final").includes(
      String(pending?.payload?.items?.[0]?.title ?? ""),
    ),
    no_error_events: errorEvents(appRecords, [rosterTurnId, finalTurnId]).length === 0,
    ...(() => {
      const writeChecks = noProductionWriteChecks({
        dir,
        turnResults: [rosterTurn, finalTurn],
        expectedProductions: true,
      });
      delete writeChecks.expected_production_write_flags;
      return writeChecks;
    })(),
  };

  const measured = {
    parent_turn_id: String(sentBody?.turn_id ?? ""),
    run_id: runId,
    run_mode: String(ackBody?.response?.run_mode ?? ""),
    roster_turn_id: rosterTurnId,
    final_turn_id: finalTurnId,
    consumed_budget: consumedBudget,
    allow_tool_decision_count: gateDecisions.length,
    decision_ids: gateDecisions.map((decision) => String(decision.decision_id ?? "")),
    gate_order_version: gateDecisions.map((decision) => decision.gate_order_version ?? null),
    gate_counts: gateDecisions.map((decision) => decision.gate_count ?? null),
    gate_decided_event_count: gateDecidedEvents.length,
    plan_drafted_count: planDraftedCount,
    budget_gate: budgetGate ?? null,
    trace_readiness_gate: traceReadinessGate ?? null,
    roster_gate_results: stepGateLineages[0] ?? null,
    final_gate_results: stepGateLineages[1] ?? null,
    pending_artifact: pending,
    why_text: whyText,
    why_shows_tool_decision: whyShowsToolDecision,
    why_unsafe_leak: whyLeaksUnsafe,
    visible_text: { roster: axText(dir, "02-roster-step"), final: axText(dir, "03-final") },
  };
  for (const name of slice.expected) {
    assert(Object.hasOwn(checks, name), `缺少 E2E/manifest 期望断言检查项: ${name}`);
  }
  return { checks, measured, common, turnIds: [rosterTurnId, finalTurnId] };
}

const VERIFIERS = {
  ordinary_chat_two_turn: verifyOrdinaryChat,
  empty_message_guard: verifyEmptyMessageGuard,
  frame_validation_friendly_error: verifyFrameValidation,
  natural_exploration: verifyNaturalExploration,
  agent_step_regate: verifyAgentStepRegate,
};

export function verify(dir, sliceIdArg) {
  const config = read(dir, "native-b40-config.json");
  const sliceId = sliceIdArg ?? config.slice_id;
  assert.equal(sliceId, config.slice_id, "verify slice 参数与 prepare 配置不一致");
  const slice = SLICES[sliceId];
  assert(slice, `未知 B40 家族 slice: ${sliceId}`);
  assert.equal(config.scenario, slice.scenario, "prepare 场景配置不一致");

  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, sliceId, "ready.slice_id 与场景不一致");
  assert.equal(ready.provider, "slice_verify");
  const verifier = VERIFIERS[config.scenario];
  assert(verifier, `未知场景核验器: ${config.scenario}`);
  const { checks, measured, common, turnIds } = verifier({ dir, slice, config });

  const assertions = Object.keys(checks).filter((key) => checks[key]);
  rewrite(dir, "native-b40-checks.json", {
    slice_id: sliceId,
    scenario: config.scenario,
    at: new Date().toISOString(),
    driver: common.ui.driver,
    checks,
    failed: Object.keys(checks).filter((key) => !checks[key]),
    assertions,
    measured,
  });
  assertAllChecks(checks, `B40 家族 ${sliceId}`);
  writeNativeSummary(dir, {
    sliceId,
    checks,
    measured,
    extra: {
      scenario: config.scenario,
      turn_id: turnIds[0] ?? null,
      turn_ids: turnIds,
      work_id: config.target.work_id,
      work_title: config.target.work_title,
      evidence_boundary: evidenceBoundary(),
      wait_ledger: common.ledger,
      screenshots: common.ui.screenshots,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
    },
  });
  console.log(
    `B40 家族原生场景通过: ${sliceId} checks ${assertions.length}/${Object.keys(checks).length} ` +
      `turns=${turnIds.join(",")} waits=${common.ledger.waits}`,
  );
  return { checks, measured };
}

export async function main([mode, artifact, extra]) {
  const dir = path.resolve(artifact ?? "");
  if (!dir) {
    throw new Error(
      "usage: node scripts/native_b40_family_evidence.mjs <prepare|capture|verify> <dir> [checkpoint|slice-id]",
    );
  }
  if (mode === "prepare") return prepare(dir);
  if (mode === "capture") return capture(dir, extra);
  if (mode === "verify") return verify(dir, extra);
  throw new Error(`unknown mode: ${mode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
