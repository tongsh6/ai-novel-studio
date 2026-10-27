// B61 CP2：AU07×3（au07-tooltrace-registry-redacted-io、e2e-01-readonly-tool-trace、
// e2e-01-replay-report）原生验收证据核验。
//
// 测量动作由外部 macOS AX/CGEvent 驱动真实 Tauri 窗口完成（scripts/native_au07_drive.mjs）：
// 在 seed 作品发送「先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派。」，
// 等待 AgentRun 内部只读 character_roster 步完成与最终回复，再按 step turn_id 查询产品
// 持久 trace（TraceRepository.list_by_turn/1）并由 ReplayService.build_report/1 生成
// no-provider ReplayReport。本文件只消费证据：native-transport / app-log / trace-query /
// AX/截图 / 只读 SQLite。判据 1:1 对齐 frontend/slice-verify/external-ui-driver.mjs 的
// driveE2E01ReadonlyToolTrace / driveE2E01ReplayReport / driveAu07TooltraceRegistryRedactedIo，
// 只把驱动面换成原生窗口，断言不降级。
//
// 模式：
//   prepare <dir>  读 seed、标记最近打开、落生产指纹
//   capture <dir> <checkpoint>  记录只读 DB 生产表计数（start/final 对比证明无生产写入）
//   verify <dir> [slice-id]     核验并写 summary.json / native-au07-checks.json
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  ROOT,
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
  write,
  writeNativeFrames,
  writeNativeSummary,
} from "./lib/native_ui/scenario_evidence.mjs";

const REQUEST_TEXT = "先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派。";
const SLICES = Object.freeze({
  "e2e-01-readonly-tool-trace": {
    expected: [
      "orchestrator_allowed_low_risk_character_roster_tool",
      "trace_repository_list_by_turn_returned_tool_trace_ref",
    ],
    replay: false,
    registry: false,
    captures: ["01-workbench", "02-roster-step", "03-final"],
  },
  "e2e-01-replay-report": {
    expected: [
      "replay_report_answered_vs06_six_required_questions",
      "replay_report_built_from_persisted_trace_without_provider_call",
    ],
    replay: true,
    registry: false,
    captures: ["01-workbench", "02-roster-step", "03-final"],
  },
  "au07-tooltrace-registry-redacted-io": {
    expected: [
      "tool_trace_recorded_registry_snapshot_name_version_status_layer",
      "tool_trace_recorded_input_output_contract_refs",
      "tool_trace_recorded_grants_within_registry_without_write_grants",
      "tool_trace_recorded_redacted_request_result_summaries_without_raw_payload",
      "replay_report_tool_trace_chain_preserved_registry_and_redaction_boundary",
      "replay_report_built_from_persisted_trace_without_provider_call",
    ],
    replay: true,
    registry: true,
    captures: ["01-workbench", "02-roster-step", "03-final"],
  },
});

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

export function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  const sliceId = ready.slice_id;
  const slice = SLICES[sliceId];
  assert(slice, `未知 AU07 slice: ${sliceId ?? "(ready.slice_id 缺失)"}`);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert.equal(ready.provider, "slice_verify");
  assert(fs.existsSync(path.join(dir, "seed.log")), "AU07 seed.log 缺失");

  const workId = seedField(dir, "work_id");
  const workTitle = seedField(dir, "work_title");
  const sessionId = seedField(dir, "session_id");
  const characterId = seedField(dir, "character_id");
  const tentativeCharacterId = seedField(dir, "tentative_character_id");
  const foreignWorkId = seedField(dir, "foreign_work_id");
  const foreignCharacterId = seedField(dir, "foreign_character_id");
  assert(workId, "AU07 seed 缺少 work_id");
  assert(workTitle, "AU07 seed 缺少 work_title");
  assert(sessionId, "AU07 seed 缺少 session_id");
  assert(characterId, "AU07 seed 缺少 character_id");
  assert(tentativeCharacterId, "AU07 seed 缺少 tentative_character_id");
  assert(foreignWorkId, "AU07 seed 缺少 foreign_work_id");
  assert(foreignCharacterId, "AU07 seed 缺少 foreign_character_id");

  markWorkNewest(dir, workId);
  write(dir, "production-sources-before.json", productionFingerprint());
  write(dir, "native-au07-config.json", {
    slice_id: sliceId,
    provider: ready.provider,
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    request_text: REQUEST_TEXT,
    target: {
      work_id: workId,
      work_title: workTitle,
      session_id: sessionId,
      character_id: characterId,
      tentative_character_id: tentativeCharacterId,
      foreign_work_id: foreignWorkId,
      foreign_character_id: foreignCharacterId,
    },
    captures: slice.captures,
  });
  console.log(`AU07 原生证据准备完成: slice=${sliceId} work=${workId} title=${workTitle}`);
}

export function capture(dir, checkpoint) {
  const config = read(dir, "native-au07-config.json");
  assert(
    checkpoint === "start" || checkpoint === "final" || config.captures.includes(checkpoint),
    `未知 checkpoint: ${checkpoint}`,
  );
  rewrite(dir, `au07-${checkpoint}.json`, {
    at: new Date().toISOString(),
    checkpoint,
    db_production_counts: productionTableCounts(dir),
  });
}

// ── 持久 trace 回查（与浏览器 canonical driver 的 queryTraceByTurn 同口径）──────────
const TRACE_QUERY_CODE = String.raw`
repo_config =
  :novel_persistence
  |> Application.get_env(NovelPersistence.Repo, [])
  |> Keyword.put(:pool, DBConnection.ConnectionPool)
  |> Keyword.put(:pool_size, 1)

Application.put_env(:novel_persistence, NovelPersistence.Repo, repo_config)

{:ok, _started} = Application.ensure_all_started(:novel_persistence)

turn_id = System.fetch_env!("TRACE_QUERY_TURN_ID")

defmodule NativeAu07ReplayQuery do
  def trace_from_record(record) do
    %NovelDomain.DecisionTrace{
      trace_id: record.trace_id,
      turn_id: record.turn_id,
      frame_ref: record.frame_ref,
      plan_ref: record.plan_ref,
      decision_type: atomize(record.decision_type),
      no_tool_reason: record.no_tool_reason,
      no_behavior_reason: record.no_behavior_reason,
      no_write_reason: record.no_write_reason,
      turn_result_ref: record.turn_result_ref,
      replay_policy: record.replay_policy,
      redaction_level: atomize(record.redaction_level || "author_safe"),
      tool_trace_refs: record.tool_trace_refs || [],
      behavior_trace_refs: record.behavior_trace_refs || [],
      state_trace_refs: record.state_trace_refs || [],
      event_order: Enum.map(record.event_order || [], &atomize/1)
    }
  end

  def replay_report(record) do
    record
    |> trace_from_record()
    |> NovelApplication.ReplayService.build_report()
    |> Map.from_struct()
  end

  defp atomize(value) when is_atom(value), do: value
  defp atomize(value) when is_binary(value), do: String.to_atom(value)
  defp atomize(_value), do: nil
end

traces =
  turn_id
  |> NovelPersistence.TraceRepository.list_by_turn()
  |> Enum.map(fn record ->
    %{
      trace_id: record.trace_id,
      turn_id: record.turn_id,
      workspace_id: record.workspace_id,
      session_id: Map.get(record, :session_id),
      frame_ref: record.frame_ref,
      plan_ref: record.plan_ref,
      decision_type: record.decision_type,
      tool_trace_refs: Map.get(record, :tool_trace_refs) || [],
      behavior_trace_refs: Map.get(record, :behavior_trace_refs) || [],
      state_trace_refs: Map.get(record, :state_trace_refs) || [],
      replay_report: NativeAu07ReplayQuery.replay_report(record)
    }
  end)

payload = %{turn_id: turn_id, count: length(traces), traces: traces}

File.write!(System.fetch_env!("TRACE_QUERY_OUTPUT"), Jason.encode!(payload) <> "\n")
`;

export function queryTraceByTurn(dir, turnId) {
  const outputPath = path.join(dir, "trace-query.json");
  execFileSync("mix", ["run", "--no-start", "-e", TRACE_QUERY_CODE], {
    cwd: ROOT,
    env: {
      ...process.env,
      MIX_ENV: "test",
      NOVEL_TEST_DB_DIR: path.join(dir, "database"),
      TRACE_QUERY_TURN_ID: turnId,
      TRACE_QUERY_OUTPUT: outputPath,
    },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180_000,
  });
  assert(fs.existsSync(outputPath), "trace 查询未写 trace-query.json");
  return read(dir, "trace-query.json");
}

function isToolTraceRef(ref) {
  if (typeof ref === "string") return ref.startsWith("tool_trace:");
  if (!ref || typeof ref !== "object") return false;
  return Boolean(ref.tool_name && ref.tool_request_ref && ref.tool_result_ref);
}

const firstToolTraceRef = (refs) =>
  Array.isArray(refs) ? (refs.find(isToolTraceRef) ?? null) : null;
const field = (source, key) =>
  source && typeof source === "object" ? source[key] : undefined;

function toolTraceAudit(toolRef) {
  const registrySnapshot = field(toolRef, "registry_snapshot") ?? {};
  const contractRefs = field(toolRef, "contract_refs") ?? {};
  const grantSummary = field(toolRef, "grant_summary") ?? {};
  const requestSummary = field(toolRef, "request_summary") ?? {};
  const resultSummary = field(toolRef, "result_summary") ?? {};
  const ioRedaction = field(toolRef, "io_redaction") ?? {};
  const requestKeys = Array.isArray(field(requestSummary, "keys")) ? field(requestSummary, "keys") : [];
  const resultKeys = Array.isArray(field(resultSummary, "keys")) ? field(resultSummary, "keys") : [];
  const requestedReadScopes = Array.isArray(field(grantSummary, "requested_read_scopes"))
    ? field(grantSummary, "requested_read_scopes")
    : [];
  const requestedWriteScopes = Array.isArray(field(grantSummary, "requested_write_scopes"))
    ? field(grantSummary, "requested_write_scopes")
    : [];
  const serialized = JSON.stringify(toolRef);

  const checks = {
    tool_trace_recorded_registry_snapshot_name_version_status_layer:
      field(registrySnapshot, "tool_name") === "character_roster" &&
      field(registrySnapshot, "tool_version") === "1.0.0" &&
      field(registrySnapshot, "status") === "active" &&
      field(registrySnapshot, "tool_layer") === "memory",
    tool_trace_recorded_input_output_contract_refs:
      field(contractRefs, "input_contract_ref") === "character_roster_query_v1" &&
      field(contractRefs, "output_contract_ref") === "character_roster_result_v1",
    tool_trace_recorded_grants_within_registry_without_write_grants:
      requestedReadScopes.includes("character_list") &&
      requestedWriteScopes.length === 0 &&
      field(grantSummary, "grants_within_registry") === true,
    tool_trace_recorded_redacted_request_result_summaries_without_raw_payload:
      requestKeys.includes("characters") &&
      resultKeys.includes("character_count") &&
      resultKeys.includes("characters") &&
      field(requestSummary, "payload_stored") === false &&
      field(resultSummary, "payload_stored") === false &&
      field(ioRedaction, "input_payload_stored") === false &&
      field(ioRedaction, "output_payload_stored") === false &&
      !["林澈", "未确认影子", "外部角色", "追查灵源矿区真相"].some((token) =>
        serialized.includes(token),
      ),
  };
  return {
    checks,
    registrySnapshot,
    contractRefs,
    grantSummary,
    requestSummary,
    resultSummary,
    ioRedaction,
  };
}

function replayReportChecks(report) {
  const chainSteps = Array.isArray(report?.chain_summary)
    ? report.chain_summary.map((step) => step.step)
    : [];
  const questions = Array.isArray(report?.required_questions) ? report.required_questions : [];
  const missingRefs = Array.isArray(report?.missing_trace_refs) ? report.missing_trace_refs : [];
  const questionStatuses = Object.fromEntries(
    questions.map((question) => [question.id, question.status]),
  );
  const toolChainStep = Array.isArray(report?.chain_summary)
    ? report.chain_summary.find((step) => step.step === "tool_trace")
    : null;
  const checks = {
    replay_report_built_from_persisted_trace_without_provider_call:
      report?.provider_called === false,
    replay_report_result_complete:
      report?.result_status === "complete" &&
      missingRefs.length === 0,
    replay_report_answered_vs06_six_required_questions:
      questions.length === 6 &&
      questions.every((question) => ["answered", "not_applicable"].includes(question.status)) &&
      questionStatuses.tool_approval === "answered" &&
      questionStatuses.adoption_boundary === "answered",
    replay_report_chain_includes_frame_plan_decision_tool_and_turn_result: [
      "frame",
      "plan",
      "decision",
      "tool_trace",
      "turn_result",
    ].every((step) => chainSteps.includes(step)),
    replay_report_tool_trace_chain_preserved_registry_and_redaction_boundary:
      Boolean(toolChainStep) &&
      field(field(toolChainStep, "registry_snapshot") ?? {}, "tool_name") === "character_roster" &&
      field(field(toolChainStep, "io_redaction") ?? {}, "input_payload_stored") === false &&
      field(field(toolChainStep, "io_redaction") ?? {}, "output_payload_stored") === false,
  };
  return { checks, chainSteps, questions, missingRefs, questionStatuses };
}

export function verify(dir, sliceIdArg) {
  const config = read(dir, "native-au07-config.json");
  const sliceId = sliceIdArg ?? config.slice_id;
  assert.equal(sliceId, config.slice_id, "verify slice 参数与 prepare 配置不一致");
  const slice = SLICES[sliceId];
  assert(slice, `未知 AU07 slice: ${sliceId}`);
  const target = config.target;

  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, sliceId, "ready.slice_id 与场景不一致");
  assert.equal(ready.provider, "slice_verify");
  const common = assertCommonEvidence(dir, {
    sliceId,
    minScreenshots: 3,
    minimumWaits: 8,
    requiredKinds: ["input", "ack", "turn", "maintenance"],
  });
  const provider = assertProviderAndWire(dir, {
    minUserMessages: 1,
    minTurnResults: 2,
    minProviderStarts: 1,
  });
  const { appRecords, wire } = provider;
  writeNativeFrames(dir);
  for (const name of slice.captures) assertRecordFresh(dir, name, ready.ready_at);

  // ── 真实工作台输入 + 内部只读 character_roster 步 ─────────────────────────────
  const sent = sentUserMessages(wire, config.request_text);
  assert.equal(sent.length, 1, `真实工作台必须发送一次角色阵容请求，实测 ${sent.length}`);
  const sentBody = sent[0].frame[4];
  assert.equal(String(sentBody?.work_id ?? ""), target.work_id, "user_message 未发往 seed 作品");
  assert.equal(sentBody?.generate_micro_plan, false, "只读请求不得进入 micro plan");

  const rosterFrames = wire
    .filter(
      (record) =>
        record.direction === "received" &&
        Array.isArray(record.frame) &&
        record.frame.length >= 5 &&
        record.frame[3] === "turn_result",
    )
    .map((record) => record.frame[4])
    .filter(
      (body) =>
        String(body?.work_id ?? "") === target.work_id &&
        body?.tool_result?.tool_name === "character_roster" &&
        body?.tool_result?.status === "succeeded" &&
        body?.truthfulness?.production_write_performed === false,
    );
  assert(rosterFrames.length >= 1, "缺少只读 character_roster 工具步 turn_result");
  const rosterTurn = rosterFrames[0];
  const turnId = String(rosterTurn.turn_id ?? "");
  assert(turnId, "roster 步 turn_result 缺 turn_id");

  const decisionDone = appRecords.find(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      record.turn_id === turnId &&
      record.decision_type === "allow_tool",
  );
  const contextCharacters = appRecords.find(
    (record) =>
      record.event === "context.characters.done" &&
      record.turn_id === turnId &&
      record.source_type === "character_dossier" &&
      Number(record.character_count ?? 0) >= 1,
  );
  const toolboxDone = appRecords.find(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === turnId &&
      record.tool_name === "character_roster" &&
      record.tool_outcome === "succeeded",
  );
  const parentUserDone = appRecords.find(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.work_id === target.work_id &&
      record.turn_id !== turnId,
  );
  const authorActionFrames = wire.filter(
    (record) => record.direction === "sent" && record.frame?.[3] === "author_action",
  );
  const adoptionEvents = appRecords.filter(
    (record) =>
      String(record.event ?? "").startsWith("channel.adopt.") ||
      String(record.event ?? "").startsWith("adoption.evaluate.") ||
      String(record.event ?? "").startsWith("channel.author_action."),
  );

  // ── 持久 trace 回查（产品仓储 + ReplayService；no-provider）────────────────────
  const traceQuery = queryTraceByTurn(dir, turnId);
  const traces = Array.isArray(traceQuery.traces) ? traceQuery.traces : [];
  const traceRecord = traces.find(
    (trace) => Array.isArray(trace.tool_trace_refs) && trace.tool_trace_refs.length > 0,
  );
  assert(traceRecord, "持久 trace 未携带 tool_trace_refs");
  assert.equal(
    String(traceRecord.decision_type ?? ""),
    "tool_dispatched",
    `持久 roster trace decision_type 不是 tool_dispatched: ${traceRecord.decision_type}`,
  );
  const toolRef = firstToolTraceRef(traceRecord.tool_trace_refs);
  assert(toolRef, "ToolTrace ref 不可用（registry/redaction 无回查路径）");
  const audit = toolTraceAudit(toolRef);
  const replay = replayReportChecks(traceRecord.replay_report ?? {});

  // ── 可见证据：真实窗口显示只读结果与已确认角色，未泄漏 tentative/外部角色 ──────────
  const workbenchText = axText(dir, "01-workbench");
  const rosterVisibleText = axText(dir, "02-roster-step");
  const finalVisibleText = axText(dir, "03-final");
  const visibleText = `${rosterVisibleText}\n${finalVisibleText}`;
  const toolOutput = rosterTurn.tool_result?.output ?? {};
  const toolCharacters = Array.isArray(toolOutput.characters) ? toolOutput.characters : [];
  const characterNames = toolCharacters.map((character) => String(character?.name ?? ""));
  const dbStart = read(dir, "au07-start.json");
  const dbFinal = read(dir, "au07-final.json");
  const dbUnchanged =
    JSON.stringify(dbStart.db_production_counts) === JSON.stringify(dbFinal.db_production_counts);
  const production = checkProductionFingerprint(dir);
  const registryToolStep =
    traceRecord.replay_report?.chain_summary?.find?.((step) => step.step === "tool_trace") ?? null;

  const baseChecks = {
    native_ax_system_ui_driver:
      common.ui.driver === "ax-native-system-ui" && ready.driver === "external-system-ui",
    native_no_chromium_driver:
      ready.browser_driver_started === false && !fs.existsSync(path.join(dir, "ui-frames.json")),
    native_typed_wait_ledger: common.ledger.waits >= 8 && common.ledger.by_kind.turn >= 1,
    native_screenshots_recorded: common.ui.screenshots.length >= 3,
    visible_chat_input_sent_request_with_readonly_roster_step:
      workbenchText.length > 0 &&
      (rosterVisibleText.includes("角色阵容") || finalVisibleText.includes("角色阵容")),
    real_workbench_sent_character_request_that_runs_readonly_roster_tool_step:
      sent.length === 1 && rosterFrames.length >= 1,
    judgment_agent_run_dispatched_character_roster_through_orchestrator_and_toolbox:
      Boolean(decisionDone) && Boolean(contextCharacters) && Boolean(toolboxDone),
    orchestrator_allowed_low_risk_character_roster_tool:
      Boolean(decisionDone) &&
      field(audit.registrySnapshot, "risk_class") === "low" &&
      field(audit.registrySnapshot, "tool_name") === "character_roster",
    context_characters_loaded_from_character_dossier: Boolean(contextCharacters),
    toolbox_execute_character_roster_succeeded: Boolean(toolboxDone),
    tool_trace_queryable_by_step_turn_id:
      Number(traceQuery.count ?? 0) >= 1 && Boolean(traceRecord?.tool_trace_refs?.length),
    trace_repository_list_by_turn_returned_tool_trace_ref: Boolean(toolRef),
    readonly_roster_tool_step_has_no_state_delta_or_artifact_refs:
      (rosterTurn.tool_result?.state_delta ?? []).length === 0 &&
      (rosterTurn.tool_result?.artifact_refs ?? []).length === 0,
    accepted_character_visible_without_tentative_or_foreign_character_leakage:
      characterNames.includes("林澈") &&
      !characterNames.includes("未确认影子") &&
      !characterNames.includes("外部角色") &&
      visibleText.includes("林澈"),
    readonly_roster_tool_step_reported_tool_called_without_state_delta_or_production_write:
      rosterTurn.truthfulness?.tool_called === true &&
      rosterTurn.truthfulness?.production_write_performed === false &&
      rosterTurn.truthfulness?.artifact_adopted !== true &&
      rosterTurn.truthfulness?.execution_blocked !== true,
    character_design_candidate_was_not_auto_adopted_by_the_harness:
      authorActionFrames.length === 0 && adoptionEvents.length === 0,
    no_author_action_or_adoption_event: authorActionFrames.length === 0 && adoptionEvents.length === 0,
    no_production_write:
      dbUnchanged &&
      production.unchanged &&
      rosterTurn.truthfulness?.production_write_performed === false,
    no_tool_result_adoption_state_on_roster_step:
      rosterTurn.tool_result != null && rosterTurn.adoption_state == null,
    ...audit.checks,
    ...replay.checks,
    deterministic_provider_mechanism_only: ready.provider === "slice_verify",
  };
  // E2E 聚合器按 artifactSpecs.assertions 逐个核对 summary.behavior.assertions；
  // 清单里的名字必须是本次真实核验产生的检查项，不得凭空补 true。
  for (const name of slice.expected) {
    assert(Object.hasOwn(baseChecks, name), `缺少 E2E/manifest 期望断言检查项: ${name}`);
  }
  const checks = baseChecks;

  const measured = {
    turn_id: turnId,
    work_id: target.work_id,
    work_title: target.work_title,
    session_id: target.session_id,
    tool_name: String(rosterTurn.tool_result?.tool_name ?? ""),
    tool_status: String(rosterTurn.tool_result?.status ?? ""),
    character_count: Number(toolOutput.character_count ?? toolCharacters.length),
    character_names: characterNames,
    decision_record: Boolean(decisionDone),
    context_characters_record: contextCharacters ?? null,
    toolbox_record: toolboxDone ?? null,
    parent_user_message_done: Boolean(parentUserDone),
    author_action_frame_count: authorActionFrames.length,
    adoption_event_count: adoptionEvents.length,
    trace_query: {
      turn_id: traceQuery.turn_id,
      count: traceQuery.count,
      trace_ids: traces.map((trace) => trace.trace_id),
      decision_type: traceRecord.decision_type,
      plan_ref: traceRecord.plan_ref,
      frame_ref: traceRecord.frame_ref,
    },
    tool_trace_ref: toolRef,
    replay_report: {
      provider_called: traceRecord.replay_report?.provider_called,
      result_status: traceRecord.replay_report?.result_status,
      chain_steps: replay.chainSteps,
      question_statuses: replay.questionStatuses,
      missing_trace_refs: replay.missingRefs,
    },
    replay_tool_chain_step: registryToolStep,
    visible_text: { roster: rosterVisibleText, final: finalVisibleText },
    db_production_counts: dbFinal.db_production_counts,
    wait_ledger: common.ledger,
  };

  const assertions = Object.keys(checks).filter((key) => checks[key]);
  rewrite(dir, "native-au07-checks.json", {
    slice_id: sliceId,
    at: new Date().toISOString(),
    driver: common.ui.driver,
    checks,
    failed: Object.keys(checks).filter((key) => !checks[key]),
    assertions,
    measured,
  });
  assertAllChecks(checks, "AU07");
  writeNativeSummary(dir, {
    sliceId,
    checks,
    measured,
    extra: {
      turn_id: turnId,
      work_id: target.work_id,
      session_id: target.session_id,
      tool_name: "character_roster",
      trace_query_refs: traceQuery ? `trace-query.json` : null,
      trace_query_tool_trace_refs: traceRecord.tool_trace_refs,
      trace_query_replay_report: traceRecord.replay_report,
      evidence_boundary: evidenceBoundary(),
      wait_ledger: common.ledger,
      screenshots: common.ui.screenshots,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
    },
  });
  console.log(
    `AU07 原生场景通过: ${sliceId} checks ${assertions.length}/${Object.keys(checks).length} ` +
      `turn_id=${turnId} trace_count=${traceQuery.count} waits=${common.ledger.waits}`,
  );
  return { checks, measured };
}

export async function main([mode, artifact, extra]) {
  const dir = path.resolve(artifact ?? "");
  if (!dir) throw new Error("usage: node scripts/native_au07_evidence.mjs <prepare|capture|verify> <dir> [checkpoint|slice-id]");
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
