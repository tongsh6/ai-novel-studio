// B61 CP1：AU11×2（质量诊断普通回复来源/覆盖、缺 WorkState 诚实不编造）原生验收证据核验。
//
// 测量动作全部由外部 macOS AX/CGEvent 驱动真实 Tauri 窗口完成（scripts/native_au11_drive.mjs）；
// 本文件只消费隔离批次的既有证据：ready/ui-complete/等待账/AX/截图/native-transport/app-log/
// llm-calls/只读 SQLite。判据 1:1 对齐 frontend/slice-verify/external-ui-driver.mjs 的
// driveAu11QualityDiagnosisMessageEnvelope / driveAu11MissingWorkstatePolicy 与
// native-tauri-verifier.mjs 的 au11* behavior，只把驱动面换成原生窗口，断言不降级。
//
// 模式：
//   prepare <dir>  真实 Chrome 无参与：读 seed/创建空白作品、标记最近打开、落生产指纹与 DB 基线
//   capture <dir> <checkpoint>  记录只读 DB 生产表计数（start/final 对比证明无生产写入）
//   verify <dir> [slice-id]     核验并写 summary.json / native-au11-checks.json
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  all,
  assertAllChecks,
  assertCommonEvidence,
  assertProviderAndWire,
  assertRecordFresh,
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

const SLICES = Object.freeze({
  "au11-quality-diagnosis-message-envelope": {
    scenario: "quality_diagnosis",
    message: "这一章感觉不够爽，主角赢得太轻了。",
    seedWork: true,
    captures: ["01-workbench", "02-reply", "03-why", "04-final"],
  },
  "au11-missing-workstate-policy": {
    scenario: "missing_workstate",
    message: "帮我看看这一章哪里不成立。",
    seedWork: false,
    captures: ["01-workbench", "02-reply", "03-why", "04-final"],
  },
});

const UNSAFE_WHY = /raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i;

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

function workTitleInDb(dir, workId) {
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT title FROM works WHERE id = ?", [workId]);
    assert.equal(rows.length, 1, `作品不存在于隔离 DB: ${workId}`);
    return String(rows[0].title);
  });
}

async function createBlankWork(dir, ready) {
  const title = `AU11空白诊断作品-${Date.now()}`;
  const response = await fetch(`${ready.api_url}/api/works`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  assert(response.ok, `创建空白作品失败: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id, "创建空白作品响应缺少 work id");
  return { workId: body.work.id, workTitle: String(body.work.title ?? title) };
}

export async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  const sliceId = ready.slice_id;
  const slice = SLICES[sliceId];
  assert(slice, `未知 AU11 slice: ${sliceId ?? "(ready.slice_id 缺失)"}`);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert.equal(ready.provider, "slice_verify");

  let target;
  if (slice.seedWork) {
    const field = (name) => {
      const tokens = fs.readFileSync(path.join(dir, "seed.log"), "utf8").split(/\s+/);
      const token = tokens.find((part) => part.startsWith(`${name}=`));
      return token ? token.slice(name.length + 1) : null;
    };
    const workId = field("work_id");
    const sessionId = field("session_id");
    assert(workId, "AU11 质量诊断 seed 缺少 work_id");
    assert(sessionId, "AU11 质量诊断 seed 缺少 session_id");
    target = { work_id: workId, work_title: workTitleInDb(dir, workId), session_id: sessionId };
  } else {
    const created = await createBlankWork(dir, ready);
    target = { work_id: created.workId, work_title: created.workTitle, session_id: null };
  }

  markWorkNewest(dir, target.work_id);
  write(dir, "production-sources-before.json", productionFingerprint());
  write(dir, "native-au11-config.json", {
    slice_id: sliceId,
    scenario: slice.scenario,
    provider: ready.provider,
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    message_text: slice.message,
    target,
    captures: slice.captures,
  });
  console.log(
    `AU11 原生证据准备完成: slice=${sliceId} scenario=${slice.scenario} work=${target.work_id} ` +
      `title=${target.work_title}`,
  );
}

export function capture(dir, checkpoint) {
  const config = read(dir, "native-au11-config.json");
  assert(
    checkpoint === "start" || checkpoint === "final" || config.captures.includes(checkpoint),
    `未知 checkpoint: ${checkpoint}`,
  );
  rewrite(dir, `au11-${checkpoint}.json`, {
    at: new Date().toISOString(),
    checkpoint,
    db_production_counts: productionTableCounts(dir),
  });
}

function findPlainTurnResult(wire, turnId) {
  return wire
    .filter(
      (record) =>
        record.direction === "received" &&
        Array.isArray(record.frame) &&
        record.frame.length >= 5 &&
        record.frame[3] === "turn_result",
    )
    .map((record) => record.frame[4])
    .find((body) => String(body?.turn_id ?? "") === turnId);
}

function appEvent(appRecords, turnId, event, predicate = () => true) {
  return appRecords.find(
    (record) => record.event === event && record.turn_id === turnId && predicate(record),
  );
}

function promptFor(llmRecords, turnId, messageText) {
  return llmRecords.find(
    (record) =>
      String(record.turn_id ?? "") === turnId &&
      typeof record.prompt === "string" &&
      record.prompt.includes("创作判断器") &&
      record.prompt.includes(messageText),
  );
}

export function verify(dir, sliceIdArg) {
  const config = read(dir, "native-au11-config.json");
  const sliceId = sliceIdArg ?? config.slice_id;
  assert.equal(sliceId, config.slice_id, "verify slice 参数与 prepare 配置不一致");
  const slice = SLICES[sliceId];
  assert(slice, `未知 AU11 slice: ${sliceId}`);
  const quality = config.scenario === "quality_diagnosis";

  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, sliceId, "ready.slice_id 与场景不一致");
  assert.equal(ready.provider, "slice_verify");
  const common = assertCommonEvidence(dir, {
    sliceId,
    minScreenshots: 4,
    minimumWaits: 9,
    requiredKinds: ["input", "ack", "turn", "maintenance"],
  });
  const provider = assertProviderAndWire(dir, {
    minUserMessages: 1,
    minTurnResults: 1,
    minProviderStarts: 1,
  });
  const { appRecords, llmRecords, wire } = provider;
  writeNativeFrames(dir);
  for (const name of config.captures) assertRecordFresh(dir, name, ready.ready_at);

  const target = config.target;
  const messageText = config.message_text;

  // ── 真实窗口发送的 user_message（外部传输代理见证）───────────────────────────
  const sent = sentUserMessages(wire, messageText);
  assert.equal(sent.length, 1, `真实工作台必须发送一次场景用户话术，实测 ${sent.length}`);
  const sentBody = sent[0].frame[4];
  const { turnId, ack } = turnFacts(wire, sent[0]);
  const turnResult = findPlainTurnResult(wire, turnId);
  assert(turnResult, `缺少本轮 turn_result: ${turnId}`);
  const traceSummary = turnResult.trace_summary ?? {};
  const replyRecord = traceSummary.reply_record ?? {};
  const frameSummary = turnResult.frame_summary ?? {};
  const contextRefs = Array.isArray(traceSummary.context_refs) ? traceSummary.context_refs : [];
  const contextSourceTypes = contextRefs.map((ref) => String(ref.source_type ?? ""));
  const suppliedContextRefs = Array.isArray(replyRecord.supplied_context_refs)
    ? replyRecord.supplied_context_refs.map(String)
    : [];
  const assistantText = String(turnResult.assistant_message?.text ?? "");

  const contextDone = appEvent(
    appRecords,
    turnId,
    "context.assemble.done",
    (record) => record.has_snapshot === true && record.work_id === target.work_id,
  );
  const judgmentDone = appEvent(
    appRecords,
    turnId,
    "judgment.decided.done",
    (record) => record.action === "reply" && record.frame_type === "casual_reply",
  );
  const userMessageDone = appEvent(appRecords, turnId, "channel.user_message.done");
  const sessionId = String(contextDone?.session_id ?? sentBody?.session_id ?? "");
  const prompt = promptFor(llmRecords, turnId, messageText);

  // ── prompt 外部证据（判断 prompt 的作品事实口径）──────────────────────────────
  const writtenMatch = prompt ? /已写\s*(\d+)\s*章/u.exec(prompt.prompt) : null;
  const promptWrittenChapters = writtenMatch ? Number(writtenMatch[1]) : null;
  const promptChecks = quality
    ? {
        prompt_recorded: Boolean(prompt),
        prompt_has_current_work_section: Boolean(prompt) && prompt.prompt.includes("## 当前作品上下文"),
        prompt_has_seeded_work_title:
          Boolean(prompt) && prompt.prompt.includes(`title: ${target.work_title}`),
        prompt_has_written_chapter_fact: promptWrittenChapters !== null && promptWrittenChapters >= 1,
        prompt_has_real_work_fact: Boolean(prompt) && prompt.prompt.includes("林烬"),
        prompt_has_author_input: Boolean(prompt) && prompt.prompt.includes(messageText),
      }
    : {
        prompt_recorded: Boolean(prompt),
        prompt_has_current_work_section: Boolean(prompt) && prompt.prompt.includes("## 当前作品上下文"),
        prompt_zero_written_chapter_fact: promptWrittenChapters === 0,
        prompt_without_fabricated_chapter_list:
          Boolean(prompt) && !prompt.prompt.includes("## 章节列表"),
        prompt_without_fabricated_chapter_fact:
          Boolean(prompt) && !prompt.prompt.includes("霓虹地牢") && !prompt.prompt.includes("林烬"),
        prompt_has_author_input: Boolean(prompt) && prompt.prompt.includes(messageText),
      };

  // ── 原生窗口可见证据（回复 + 「为什么」面板）─────────────────────────────────
  const workbenchText = axText(dir, "01-workbench");
  const replyVisibleText = axText(dir, "02-reply");
  const whyVisibleText = axText(dir, "03-why");
  const finalVisibleText = axText(dir, "04-final");
  const unsafeWhy = UNSAFE_WHY.test(whyVisibleText);
  const uiReplyFragment = quality
    ? ["阻力", "代价", "读者回报"].every((token) => replyVisibleText.includes(token))
    : replyVisibleText.includes("缺少当前章节摘要或正文");
  const whyPanelNewlyVisible =
    !replyVisibleText.includes("参考来源") && !replyVisibleText.includes("不会重新调用模型");
  const whyShowsReplyDecision = whyVisibleText.includes("AI 回应");
  const whyStatesNoProviderReplay = whyVisibleText.includes("不会重新调用模型");

  // ── 无生产写入：DB 生产事实表与生产源码指纹在本轮前后不变 ─────────────────────
  const dbStart = read(dir, "au11-start.json");
  const dbFinal = read(dir, "au11-final.json");
  const dbUnchanged = JSON.stringify(dbStart.db_production_counts) === JSON.stringify(dbFinal.db_production_counts);
  const production = checkProductionFingerprint(dir);

  const checks = {
    // 交付面/驱动面
    native_ax_system_ui_driver: common.ui.driver === "ax-native-system-ui" && ready.driver === "external-system-ui",
    native_no_chromium_driver: ready.browser_driver_started === false && !fs.existsSync(path.join(dir, "ui-frames.json")),
    native_typed_wait_ledger: common.ledger.waits >= 9 && common.ledger.kinds.includes("turn"),
    native_screenshots_recorded: common.ui.screenshots.length >= 4,
    // 真实工作台发送
    message_sent_from_real_workbench: sent.length === 1,
    sent_to_target_work: String(sentBody?.work_id ?? "") === target.work_id && String(contextDone?.work_id ?? "") === target.work_id,
    ordinary_chat_without_plan_request: sentBody?.generate_micro_plan === false,
    // 判断纪元普通回复字段
    turn_result_frame_type_casual_reply: frameSummary.frame_type === "casual_reply",
    trace_decision_type_reply_only: traceSummary.decision_type === "reply_only",
    no_tool_reason_no_tool_requested: String(traceSummary.no_tool_reason ?? "") === "no_tool_requested",
    dialogue_goal_recorded: String(traceSummary.dialogue_goal ?? "").trim().length > 0,
    reply_record_response_kind_plain_text: replyRecord.response_kind === "plain_text",
    reply_record_records_task_policy_and_protocol_versions:
      typeof replyRecord.task_policy_version === "string" &&
      replyRecord.task_policy_version.length > 0 &&
      typeof replyRecord.protocol_version === "string" &&
      replyRecord.protocol_version.length > 0,
    reply_record_model_interpretation_status_not_provided: replyRecord.model_interpretation_status === "not_provided",
    assistant_reply_is_exact_provider_output_bytes: String(replyRecord.raw_content ?? "") === assistantText,
    judgment_decided_done_action_reply_casual_reply: Boolean(judgmentDone),
    context_assemble_done_selected_work_snapshot: Boolean(contextDone),
    channel_user_message_done_recorded: Boolean(userMessageDone),
    // 会话/来源覆盖
    reply_record_records_supplied_context_refs_coverage: quality ? suppliedContextRefs.length >= 1 : suppliedContextRefs.length === 0,
    trace_context_source_types_expected: quality
      ? contextSourceTypes.includes("current_work")
      : contextSourceTypes.length === 0,
    // 回复内容（确定性 provider 的机制语义，不冒充模型行为质量）
    assistant_reply_visible_in_native_window: uiReplyFragment,
    assistant_gives_concrete_quality_tradeoffs: quality
      ? ["阻力", "代价", "读者回报"].every((token) => assistantText.includes(token))
      : true,
    assistant_asks_for_target_material_without_claiming_read: quality
      ? true
      : assistantText.includes("缺少当前章节摘要或正文") &&
        assistantText.includes("不会改写正文或写入作品事实") &&
        !assistantText.includes("已经读过") &&
        !assistantText.includes("林烬"),
    // 「为什么」作者安全回放
    why_panel_shows_reply_decision: whyShowsReplyDecision,
    why_panel_states_provider_free_replay: whyStatesNoProviderReplay,
    why_panel_does_not_expose_raw_prompt_or_trace_ids: !unsafeWhy,
    why_panel_visible_only_after_click: whyPanelNewlyVisible,
    // 无工具/无采纳/无生产写入
    no_tool_result: turnResult.tool_result == null,
    no_adoption_state: turnResult.adoption_state == null,
    no_truthfulness_tool_call: turnResult.truthfulness?.tool_called !== true,
    no_truthfulness_production_write: turnResult.truthfulness?.production_write_performed === false,
    db_production_tables_unchanged: dbUnchanged,
    product_sources_unchanged: production.unchanged,
    // 判断 prompt 作品事实口径
    ...prefixed("judgment_prompt", promptChecks),
    // 机制层边界（模型行为语义归 B42）
    deterministic_provider_mechanism_only: ready.provider === "slice_verify",
  };
  if (quality) {
    checks.prompt_current_work_facts_with_written_chapter =
      promptChecks.prompt_has_current_work_section && promptChecks.prompt_has_written_chapter_fact;
    checks.prompt_has_real_work_fact = promptChecks.prompt_has_real_work_fact;
  } else {
    checks.prompt_zero_written_chapter_without_fabrication =
      promptChecks.prompt_zero_written_chapter_fact &&
      promptChecks.prompt_without_fabricated_chapter_list &&
      promptChecks.prompt_without_fabricated_chapter_fact;
  }

  const measured = {
    scenario: config.scenario,
    turn_id: turnId,
    work_id: target.work_id,
    work_title: target.work_title,
    session_id: sessionId,
    ack_received: Boolean(ack),
    frame_type: frameSummary.frame_type,
    trace_decision_type: traceSummary.decision_type,
    no_tool_reason: String(traceSummary.no_tool_reason ?? ""),
    dialogue_goal: String(traceSummary.dialogue_goal ?? ""),
    reply_record: {
      response_kind: replyRecord.response_kind,
      task_policy_version: replyRecord.task_policy_version,
      protocol_version: replyRecord.protocol_version,
      source_input_ref: replyRecord.source_input_ref,
      model_interpretation_status: replyRecord.model_interpretation_status,
      supplied_context_refs: suppliedContextRefs,
      raw_content_sha256: assistantText
        ? createHash("sha256").update(assistantText).digest("hex")
        : null,
    },
    context_source_types: contextSourceTypes,
    assistant_text: assistantText,
    judgment_prompt_written_chapters: promptWrittenChapters,
    prompt_length: prompt ? prompt.prompt.length : null,
    why_text: whyVisibleText,
    reply_visible_text: replyVisibleText,
    final_visible_text: finalVisibleText,
    workbench_visible_text: workbenchText.slice(0, 2000),
    db_production_counts: dbFinal.db_production_counts,
    wait_ledger: common.ledger,
  };

  const assertions = Object.keys(checks).filter((key) => checks[key]);
  rewrite(dir, "native-au11-checks.json", {
    slice_id: sliceId,
    at: new Date().toISOString(),
    driver: common.ui.driver,
    checks,
    failed: Object.keys(checks).filter((key) => !checks[key]),
    assertions,
    measured,
  });
  assertAllChecks(checks, "AU11");
  writeNativeSummary(dir, {
    sliceId,
    checks,
    measured,
    extra: {
      scenario: config.scenario,
      turn_id: turnId,
      work_id: target.work_id,
      session_id: sessionId,
      evidence_boundary: evidenceBoundary(),
      wait_ledger: common.ledger,
      screenshots: common.ui.screenshots,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
    },
  });
  console.log(
    `AU11 原生场景通过: ${sliceId} checks ${assertions.length}/${Object.keys(checks).length} ` +
      `turn_id=${turnId} waits=${common.ledger.waits}`,
  );
  return { checks, measured };
}

function prefixed(prefix, object) {
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [`${prefix}_${key.replace(/^prompt_/, "")}`, value]),
  );
}

export async function main([mode, artifact, extra]) {
  const dir = path.resolve(artifact ?? "");
  if (!dir) throw new Error("usage: node scripts/native_au11_evidence.mjs <prepare|capture|verify> <dir> [checkpoint|slice-id]");
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
