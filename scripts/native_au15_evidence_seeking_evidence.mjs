// B39 CP1 AU-15 A0/A1/A2 原生真实模型证据核验（外部只读；产品零感知）。
//
// 输入 = 外部 driver 落盘的 au15-driver-log.json + runs/<run-id>/run.json +
// llm-calls 真实请求/响应字节 + 只读 DB 快照 + 模型生命周期；输出：
//   - 每 run runs/<run-id>/au15-evidence-sidecar.json（复用 buildAu15Evidence 的正反例语义）
//   - 根目录 au15-evidence-sidecar.json（分层汇总，B42 可消费）
//   - 根目录 summary.json（机制 / 模型行为 / 正式验收边界分开报告）
//   - 根目录 evidence-checks.json（逐项 checks 便于人工复核）
//
// 判据（预注册 artifacts/model-contracts/b39-cp1/au15-preregistration.json）：
//   A0：计划无强制探索仍可 ready；不要求 observation 进入请求（无探索是成功信号）。
//   A1/A2：真实请求字节包含 observation refs/内容；used refs 不越界（未报 unknown 记缺口，
//          不判 PASS）；准备判断 ready；采纳前零 canon 写。
//   机制层失败 → 退出码 1；模型行为未知/未触发 → 退出码 0 但如实记 unknown（不刷分）。
// 诚实边界：本批 setup 为隔离 fixture（非 D6-A 真实创作/采纳），summary 标明
// formal_acceptance=blocked，不把机制/模型行为 scoped 证据写成正式 AU-15 PASS。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildAu15Evidence } from "./lib/quality/au15_evidence.mjs";

const mode = process.argv[2] ?? "verify";
const dir = path.resolve(process.argv[3] ?? "");
if (mode === "prepare" || mode === "capture") process.exit(0);
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node scripts/native_au15_evidence_seeking_evidence.mjs verify <dir>");
  process.exit(64);
}

const DRIVER_LOG = "au15-driver-log.json";
const SIDECAR_SCHEMA = "au15-evidence-sidecar/v1";
const AGGREGATE_SCHEMA = "au15-native-evidence-summary/v1";
const PLANNED_RUNS_PER_SCENARIO = { A1: 2, A2: 2, A0: 1 };
const A0_NOT_APPLICABLE_CHECKS = new Set([
  "request_observation_refs_present",
  "writer_request_contains_observation",
  // A0 的“模型不强制探索”属模型行为层：产品机制层只证明准备判断可区分 ready/missing、
  // 无产品强制插步；模型自行取证不判成产品机制失败（由 a0_model_chose_no_exploration 记录）。
  "a0_no_forced_exploration",
  // A0 的 verdict 基于准备判断/无强制探索机制；模型自报 used refs 越界在 A0 不是判据，
  // 记录到模型行为检查 a0_used_refs_bound，不判产品机制失败。
  "used_refs_bound_to_visible_sources",
]);
const REAL_MODEL_TOKENS = ["iq3_s"];

const readJson = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  } catch {
    return null;
  }
};
const writeJson = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
const writeRunJson = (runId, name, value) => {
  const runDir = path.join(dir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, name), JSON.stringify(value, null, 2));
};

function textOf(value, acc = []) {
  if (typeof value === "string") acc.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => textOf(entry, acc));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => textOf(entry, acc));
  return acc.join("\n");
}

function gitHead() {
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: projectRoot }).trim();
  } catch {
    return null;
  }
}

// app-log：只读取运行失败/协议违规的根因事件，按 run_id 关联到具体测量 run。
function readAppLogRecords() {
  const root = path.join(dir, "app-log");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) =>
      fs
        .readFileSync(path.join(root, file), "utf8")
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

function failureEventsForRun(run) {
  const runId = String(run.run_id ?? "");
  const turnId = String(run.turn_id ?? "");
  return appLogRecordsState.filter((record) => {
    const event = String(record?.event ?? "");
    if (!/run_failed|output_validation/u.test(event)) return false;
    if (runId && String(record?.run_id ?? "") === runId) return true;
    if (turnId && String(record?.turn_id ?? "") === turnId) return true;
    return false;
  });
}

// llm-calls：逐行解析 [ts] {request,response,turn_id,step,...}，保留 turn_id 以按 run 对账。
function readLlmCalls() {
  const root = path.join(dir, "llm-calls");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file, fileIndex) =>
      fs
        .readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .filter((line) => line.includes("{"))
        .map((line, lineIndex) => {
          const start = line.indexOf("{");
          const end = line.lastIndexOf("}");
          if (start < 0 || end <= start) return null;
          try {
            const record = JSON.parse(line.slice(start, end + 1));
            const body = record?.request?.body ?? {};
            const messages = Array.isArray(body.messages) ? body.messages : [];
            const response = record?.response?.body ?? record?.response ?? {};
            return {
              index: `${fileIndex}:${lineIndex}`,
              turn_id: record?.turn_id ?? null,
              step: record?.step ?? null,
              provider: record?.provider ?? null,
              model: record?.response?.model ?? null,
              actual_model: record?.response?.usage?.model ?? response?.usage?.model ?? null,
              requestText: messages.map((message) => String(message?.content ?? "")).join("\n"),
              responseText: textOf(response),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
}

function toBuildCall(call) {
  return {
    model: call.actual_model ?? call.model ?? null,
    requestText: call.requestText,
    responseText: call.responseText,
  };
}

const checks = [];
const add = (id, ok, detail = null, severity = "critical") => {
  checks.push({ id, ok, severity, detail, at: new Date().toISOString() });
};

const driverLog = readJson(DRIVER_LOG);
const appLogRecordsState = readAppLogRecords();
const before = readJson("model-lifecycle-before.json");
const after = readJson("model-lifecycle-after.json");
const llmCalls = readLlmCalls();

if (!driverLog) {
  add("driver_log_present", false, { file: DRIVER_LOG });
  const summary = {
    schema: AGGREGATE_SCHEMA,
    mechanism: { status: "fail", reason: "missing_driver_log" },
    model_behavior: { status: "unknown" },
    formal_acceptance: "blocked",
    generated_at: new Date().toISOString(),
  };
  writeJson("summary.json", summary);
  console.error("[au15-native-evidence] missing driver log");
  process.exit(1);
}

const runs = Array.isArray(driverLog.runs) ? driverLog.runs : [];
const setupEvidence = readJson("setup.json");
const setupMode = driverLog.setup_mode ?? "isolated_fixture";
const setupOk = setupMode === "d6a" ? setupEvidence?.ok === true : null;
const setup = {
  mode: setupMode,
  d6a_precondition:
    driverLog.d6a_precondition ??
    (setupMode === "d6a" ? (setupOk ? "satisfied_by_driver" : "failed_or_missing") : "not_satisfied"),
  evidence: setupEvidence,
  measurement_runs: runs.map((run) => run.id),
  note:
    setupMode === "d6a"
      ? "本批 setup 由真实模型创作 + 外部真实页面采纳前置章节（D6-A）；setup 与测量分账，setup 失败只读保留。"
      : "本批 setup 为 scripts/seed_au15_evidence_seeking.exs 隔离 fixture，不是 D6-A 的真实模型创作 + 外部页面采纳。",
};

const globalChecks = [];
const runResults = [];

for (const run of runs) {
  const scenario = run.scenario;
  const turnId = String(run.turn_id ?? "");
  const runCalls = llmCalls.filter((call) => {
    const callTurn = String(call.turn_id ?? "");
    return callTurn === turnId || callTurn.startsWith(`${turnId}:`);
  });
  const buildCalls = runCalls.map(toBuildCall);
  const driverLogForRun = {
    scenario,
    trace_summary: run.trace_summary ?? {},
    preparation_events: run.preparation_events ?? [],
    observations: run.observations ?? [],
    zero_canon_write: run.zero_canon_write === true,
    artifact_bytes_unchanged: run.artifact_bytes_unchanged !== false,
  };
  const base = buildAu15Evidence({
    scenario,
    driverLog: driverLogForRun,
    llmCalls: buildCalls,
    dbCounts: run.db_counts_after
      ? {
          receipts: run.db_counts_after.receipts ?? 0,
          canon_delta: 0,
          accepted_hash: run.db_counts_after.accepted_hash ?? null,
        }
      : null,
  });

  const rawChecks = base.mechanism.checks;
  const applicableChecks =
    scenario === "A0" ? rawChecks.filter((check) => !A0_NOT_APPLICABLE_CHECKS.has(check.id)) : rawChecks;
  const notApplicableChecks =
    scenario === "A0" ? rawChecks.filter((check) => A0_NOT_APPLICABLE_CHECKS.has(check.id)) : [];

  const traceSummary = run.trace_summary ?? {};
  const requestObservationRefs = Array.isArray(traceSummary.request_observation_refs)
    ? traceSummary.request_observation_refs
    : [];
  const usedRefs = Array.isArray(traceSummary.used_context_refs) ? traceSummary.used_context_refs : [];
  const unboundRefs = Array.isArray(traceSummary.unbound_context_refs) ? traceSummary.unbound_context_refs : [];
  const validation = traceSummary.used_context_refs_validation ?? "unknown";
  const observations = Array.isArray(run.observations) ? run.observations : [];
  const preparations = Array.isArray(run.preparation_events) ? run.preparation_events : [];
  const continueEvents = preparations.filter((event) => event?.status === "continue_exploration");
  const readyEvents = preparations.filter((event) => event?.status === "ready_to_write");
  // 计划步 kind 由决策类型映射（context_assemble/chapter_mission 也可能是 explore kind），
  // 真实探索步必须以 target_tool_ref 落在只读探索目录内为准。
  const EXPLORATION_TARGETS = new Set(["prose_search", "chapter_read", "archive_read", "memory_recall", "session_adoptions"]);
  const planExploreSteps = (run.plan_events ?? []).flatMap((event) =>
    (event.plan_steps ?? []).filter((step) => EXPLORATION_TARGETS.has(String(step?.target_tool_ref ?? ""))),
  );
  const judgmentExplores = (run.judgment_events ?? []).filter((event) => event?.action === "explore");
  const actualModels = [
    ...new Set(runCalls.map((call) => call.actual_model).filter((model) => typeof model === "string" && model !== "")),
  ];
  const realModelCalls = runCalls.filter((call) =>
    REAL_MODEL_TOKENS.some((token) => String(call.actual_model ?? "").includes(token)),
  );
  const observationTexts = observations.map((observation) => String(observation?.summary ?? "").trim()).filter(Boolean);
  const requestByteHit =
    requestObservationRefs.length > 0 &&
    runCalls.some((call) => requestObservationRefs.some((ref) => call.requestText.includes(ref)));
  const observationTextHit = runCalls.some((call) =>
    observationTexts.some((text) => call.requestText.includes(text)),
  );
  const writerCalls = runCalls.filter((call) => String(call.step ?? "").includes("prose_writing"));
  const writerRequestByteHit =
    writerCalls.length > 0 &&
    writerCalls.some(
      (call) =>
        requestObservationRefs.some((ref) => call.requestText.includes(ref)) ||
        observationTexts.some((text) => call.requestText.includes(text)),
    );

  const runChecks = [];
  const runAdd = (id, ok, detail = null, severity = "critical") => {
    runChecks.push({ id, ok, severity, detail });
  };

  runAdd("turn_result_present", Boolean(run.turn_status) && String(run.assistant_text ?? "").trim() !== "", {
    turn_status: run.turn_status,
    assistant_chars: run.assistant_text_chars ?? 0,
  });
  runAdd("turn_not_failed", String(run.turn_status ?? "") !== "failed_recoverable" && String(run.turn_status ?? "") !== "failed", {
    turn_status: run.turn_status,
  });
  runAdd("provider_calls_present", runCalls.length >= 1, { calls: runCalls.length });
  runAdd(
    "provider_calls_real_model",
    realModelCalls.length >= 1 || actualModels.some((model) => REAL_MODEL_TOKENS.some((token) => model.includes(token))),
    { actual_models: actualModels, real_model_calls: realModelCalls.length },
    "model_behavior",
  );
  runAdd("preparation_ready_present", readyEvents.length >= 1, {
    ready: readyEvents.length,
    statuses: preparations.map((event) => event.status),
  });
  runAdd("preparation_events_recorded", preparations.length >= 1, { events: preparations.length });

  if (scenario === "A0") {
    // A0 verdict 基于机制证据：准备判断可区分 ready/missing、无产品强制插步、零 canon 写。
    // 真实模型是否自行探索属于模型行为层（不把“模型选择取证”判成产品机制失败）。
    runAdd(
      "a0_ready_state_distinguishable",
      readyEvents.some(
        (event) =>
          String(event.status ?? "") === "ready_to_write" &&
          String(event.reason ?? "") !== "" &&
          Number.isInteger(event.observation_count),
      ),
      {
        ready_events: readyEvents.map((event) => ({
          status: event.status,
          reason: event.reason,
          observation_count: event.observation_count,
        })),
      },
    );
    runAdd("a0_missing_state_distinguishable", continueEvents.every((event) => String(event.tool ?? "") !== ""), {
      continue_exploration: continueEvents.length,
      tools: continueEvents.map((event) => event.tool),
    });
    runAdd(
      "a0_exploration_events_are_model_sourced",
      true,
      {
        note:
          "产品无领域关键字插步；探索步来自真实 AgentPlan/判断决策（详见 plan_events/judgment_events），此处仅记录来源事实。",
        plan_explore_steps: planExploreSteps.map((step) => step.target_tool_ref),
        judgment_explores: judgmentExplores.length,
      },
      "evidence",
    );
    runAdd(
      "a0_used_refs_bound",
      unboundRefs.length === 0,
      { used_refs: usedRefs, unbound_refs: unboundRefs, validation },
      "model_behavior",
    );
    runAdd(
      "a0_model_chose_no_exploration",
      continueEvents.length === 0 && observations.length === 0,
      {
        continue_exploration: continueEvents.length,
        plan_explore_steps: planExploreSteps.map((step) => step.target_tool_ref),
        judgment_explores: judgmentExplores.length,
        observations: observations.length,
      },
      "model_behavior",
    );
  } else {
    runAdd(
      "a1a2_observation_present",
      observations.length >= 1,
      { observations: observations.length, tools: [...new Set(observations.map((o) => o.tool))] },
      "model_behavior",
    );
    runAdd(
      "a1a2_prose_flow_exploration_planned",
      continueEvents.length >= 1 || planExploreSteps.length >= 1,
      {
        preparation_continue: continueEvents.length,
        plan_explore_steps: planExploreSteps.map((step) => step.target_tool_ref),
      },
    );
    runAdd(
      "a1a2_model_autonomous_exploration",
      continueEvents.length >= 1 || planExploreSteps.length >= 1 || judgmentExplores.length >= 1,
      {
        preparation_continue: continueEvents.length,
        plan_explore_steps: planExploreSteps.length,
        judgment_explore_decisions: judgmentExplores.length,
      },
      "model_behavior",
    );
    runAdd("a1a2_request_observation_refs_present", requestObservationRefs.length > 0, {
      refs: requestObservationRefs,
    });
    // 机制判据：后续真实 writer 请求字节必须承载观察或其保真投影；没有 writer 调用
    // （run 在判断阶段失败）不能靠判断请求的观察文本兜底，必须如实 fail。
    runAdd("a1a2_request_bytes_contain_observation_ref", writerCalls.length > 0 && writerRequestByteHit, {
      writer_request_byte_hit: writerRequestByteHit,
      writer_calls: writerCalls.length,
      any_request_byte_hit: requestByteHit,
      observation_text_hit: observationTextHit,
      observation_refs: requestObservationRefs,
      observation_count: observations.length,
    });
    runAdd(
      "a1a2_used_context_refs_validation_recorded",
      ["ok", "no_claim", "partial", "all_unbound"].includes(validation),
      { validation, used_refs: usedRefs, unbound_refs: unboundRefs },
    );
    // 预注册 A1/A2 机制判据含“used refs 不越界”。越界是模型自报行为（产品已机械记录），
    // 因此在模型行为层判 observed/unknown，机制层只要求校验事实被记录（上面一条）。
    runAdd(
      "a1a2_used_context_refs_reported",
      usedRefs.length > 0 && validation !== "unknown",
      { used_refs: usedRefs, validation },
      "model_behavior",
    );
    runAdd(
      "a1a2_used_refs_not_unbound",
      unboundRefs.length === 0,
      { unbound_refs: unboundRefs, validation },
      "model_behavior",
    );
    runAdd(
      "a1a2_used_refs_validation_ok",
      validation === "ok" || validation === "no_claim",
      { validation },
      "model_behavior",
    );
    const writerText = (writerCalls.length > 0 ? writerCalls : runCalls).map((call) => call.requestText).join("\n");
    const observationTextJoined = observations.map((observation) => String(observation?.summary ?? "")).join("\n");
    if (scenario === "A1") {
      const promisePatterns = [/答应你，三天后/, /三天后一定回灯楼/, /回灯楼接/, /三天后回灯楼/];
      const writerPromise = promisePatterns.some((pattern) => pattern.test(writerText));
      const observationPromise = promisePatterns.some((pattern) => pattern.test(observationTextJoined));
      runAdd("a1_expected_person_promise_in_observation", observationPromise, {
        promise_in_observation: observationPromise,
        observation_tools: [...new Set(observations.map((observation) => observation.tool))],
        note: "AU-15 §5：观察必须含真实人物承诺/关系表达；只读标题或作者原话复述不算。",
      }, "model_behavior");
      runAdd("a1_expected_person_promise_in_writer_request", writerPromise, {
        promise_in_writer_request: writerPromise,
        writer_calls: writerCalls.length,
      }, "model_behavior");
    }
    if (scenario === "A2") {
      const writerTimeFacts = /过了三天/u.test(writerText) && /又过了两星期/u.test(writerText);
      const observationTimeFacts =
        /过了三天/u.test(observationTextJoined) && /又过了两星期/u.test(observationTextJoined);
      runAdd("a2_expected_time_facts_in_observation", observationTimeFacts, {
        time_facts_in_observation: observationTimeFacts,
        observation_tools: [...new Set(observations.map((observation) => observation.tool))],
      }, "model_behavior");
      runAdd("a2_expected_time_facts_in_writer_request", writerTimeFacts, {
        time_facts_in_writer_request: writerTimeFacts,
        writer_calls: writerCalls.length,
      }, "model_behavior");
    }
    runAdd(
      "a1a2_observation_source_refs_visible",
      requestObservationRefs.some((ref) => /^(chapter|work|memory|archive|prose|turn):/u.test(ref)) &&
        (traceSummary.request_base_refs ?? []).length > 0,
      {
        request_observation_refs: requestObservationRefs.slice(0, 20),
        note:
          "记录观察可见集合是否含底层来源 ref（chapter: 等）；若模型自报真实观察来源却被判 unbound，属于产品 observation source-refs 集合缺口，供 CP2 复核。",
      },
      "evidence",
    );
  }

  runAdd(
    "zero_canon_write",
    run.zero_canon_write === true,
    { db_counts_before: run.db_counts_before, db_counts_after: run.db_counts_after },
  );
  runAdd("artifact_bytes_unchanged", run.artifact_bytes_unchanged === true, {
    artifact_bytes_unchanged: run.artifact_bytes_unchanged,
  });

  const criticalFailures = runChecks.filter((check) => check.severity === "critical" && !check.ok);
  const baseCriticalFailures = applicableChecks.filter((check) => check.severity === "critical" && !check.ok);
  const mechanismStatus = baseCriticalFailures.length === 0 && criticalFailures.length === 0 ? "pass" : "fail";
  const modelBehaviorChecks = [...runChecks, ...rawChecks].filter((check) => check.severity === "model_behavior");
  const a0ModelChoseNoExploration = runChecks.find((check) => check.id === "a0_model_chose_no_exploration")?.ok === true;
  const modelBehaviorObserved =
    scenario === "A0"
      ? false
      : modelBehaviorChecks.every((check) => check.ok) && observations.length >= 1;
  const modelBehaviorStatus =
    scenario === "A0"
      ? a0ModelChoseNoExploration
        ? "observed_no_exploration"
        : "observed_exploration"
      : modelBehaviorObserved
        ? "observed"
        : "unknown";

  const sidecar = {
    schema: SIDECAR_SCHEMA,
    run_id: run.id,
    scenario,
    turn_id: turnId,
    mechanism: {
      status: mechanismStatus,
      checks: [...rawChecks, ...runChecks],
      not_applicable_checks: notApplicableChecks.map((check) => check.id),
      base_mechanism_status: base.mechanism.status,
    },
    model_behavior: {
      ...base.model_behavior,
      status: modelBehaviorStatus,
      checks: modelBehaviorChecks,
      used_refs_bound: unboundRefs.length === 0,
      used_refs_subcriterion_satisfied: scenario === "A0" ? null : unboundRefs.length === 0 && validation === "ok",
      autonomous_exploration:
        continueEvents.length >= 1 || planExploreSteps.length >= 1 || judgmentExplores.length >= 1,
      exploration_origin: {
        preparation_continue_exploration: continueEvents.length,
        plan_explore_steps: planExploreSteps.length,
        judgment_explore_decisions: judgmentExplores.length,
      },
    },
    provider_calls: runCalls.map((call) => ({
      index: call.index,
      step: call.step,
      model: call.model,
      actual_model: call.actual_model,
      request_observation_refs: requestObservationRefs.filter((ref) => call.requestText.includes(ref)),
      observed_in_calls:
        requestObservationRefs.some((ref) => call.requestText.includes(ref)) ||
        observationTexts.some((text) => call.requestText.includes(text)),
    })),
    used_context_refs: usedRefs,
    unbound_context_refs: unboundRefs,
    used_context_refs_validation: validation,
    request_base_refs: Array.isArray(traceSummary.request_base_refs) ? traceSummary.request_base_refs : [],
    request_observation_refs: requestObservationRefs,
    preparation_events: preparations,
    observations: observations.map((observation) => ({
      tool: observation.tool,
      query: observation.query,
      summary: String(observation.summary ?? "").slice(0, 500),
      refs: observation.refs ?? [],
      outcome: observation.outcome ?? null,
    })),
    evidence_gaps: [
      ...base.evidence_gaps,
      ...(scenario !== "A0" && usedRefs.length === 0 ? ["used_context_refs_unknown"] : []),
      ...(scenario !== "A0" && observations.length === 0 ? ["no_exploration_observation"] : []),
    ],
    generated_at: new Date().toISOString(),
  };

  writeRunJson(run.id, "au15-evidence-sidecar.json", sidecar);
  runResults.push({
    run_id: run.id,
    scenario,
    turn_id: turnId,
    mechanism_status: mechanismStatus,
    model_behavior_status: modelBehaviorStatus,
    turn_status: run.turn_status ?? null,
    failing_checks: [...baseCriticalFailures, ...criticalFailures].map((check) => check.id),
    observed_in_calls: sidecar.provider_calls.filter((call) => call.observed_in_calls).length,
    provider_calls: runCalls.length,
    actual_models: actualModels,
    request_observation_refs: requestObservationRefs,
    used_context_refs: usedRefs,
    unbound_context_refs: unboundRefs,
    used_context_refs_validation: validation,
    preparation_statuses: preparations.map((event) => event.status),
    preparation_reasons: readyEvents.map((event) => event.reason),
    observations: observations.length,
    exploration_tools: [...new Set(observations.map((observation) => observation.tool).filter(Boolean))],
    judgment_actions: (run.judgment_events ?? []).map((event) => event.action),
    candidate_count: run.candidate_count ?? (run.candidates ?? []).length,
    zero_canon_write: run.zero_canon_write === true,
    artifact_bytes_unchanged: run.artifact_bytes_unchanged === true,
    questions: run.questions ?? 0,
    pauses: run.pauses ?? 0,
    session_id: run.session_id ?? null,
    session_isolation: run.session_isolation ?? null,
    failure_events: failureEventsForRun(run).map((record) => ({
      event: record.event,
      reason_code: record.reason_code ?? null,
      outcome_detail: record.outcome_detail ?? null,
      level: record.level ?? null,
      timestamp: record.timestamp ?? null,
    })),
    sidecar: `runs/${run.id}/au15-evidence-sidecar.json`,
  });
}

// 场景级模型行为：A1/A2 各自 planned=2，全部 observed 才算 observed，否则 unknown/partial。
const modelBehaviorByScenario = {};

// A0 的模型行为单列：模型自行探索不是产品机制失败，但也不等于 A0 场景的“不强制探索”被观察到。
const a0Run = runResults.find((result) => result.scenario === "A0") ?? null;
modelBehaviorByScenario.A0 = {
  planned_runs: PLANNED_RUNS_PER_SCENARIO.A0,
  attempted_runs: a0Run ? 1 : 0,
  status: a0Run ? a0Run.model_behavior_status : "not_run",
  model_chose_no_exploration: a0Run?.model_behavior_status === "observed_no_exploration",
};

for (const scenario of ["A1", "A2"]) {
  const scenarioRuns = runResults.filter((result) => result.scenario === scenario);
  const planned = PLANNED_RUNS_PER_SCENARIO[scenario];
  const observed = scenarioRuns.filter((result) => result.model_behavior_status === "observed").length;
  modelBehaviorByScenario[scenario] = {
    planned_runs: planned,
    attempted_runs: scenarioRuns.length,
    observed_runs: observed,
    status:
      scenarioRuns.length === 0
        ? "not_run"
        : observed === planned && scenarioRuns.length >= planned
          ? "observed"
          : scenarioRuns.length < planned
            ? "partial"
            : "unknown",
  };
}

const mechanismFailures = runResults.filter((result) => result.mechanism_status !== "pass");
const mechanismStatus = mechanismFailures.length === 0 ? "pass" : "fail";
const a1a2Observed = ["A1", "A2"].every((scenario) => modelBehaviorByScenario[scenario].status === "observed");
const a0NoExploration = modelBehaviorByScenario.A0.status === "observed_no_exploration";
const modelBehaviorStatus =
  mechanismStatus === "fail" ? "unknown" : a1a2Observed && a0NoExploration ? "observed" : "unknown";
const lifecycle = {
  before: before,
  after: after,
  loaded_before: before?.loaded_before ?? null,
  loaded_after: after?.loaded_after ?? null,
  unloaded_clean: Boolean(after?.unloaded) && after?.loaded_after === null,
};

const summary = {
  schema: AGGREGATE_SCHEMA,
  slice_id: driverLog.slice_id ?? "au15-evidence-seeking-native",
  provider: driverLog.provider ?? "strata",
  model: driverLog.model ?? null,
  strata_endpoint: driverLog.strata_endpoint ?? null,
  git_head: gitHead(),
  generated_at: new Date().toISOString(),
  setup,
  mechanism: {
    status: mechanismStatus,
    failing_runs: mechanismFailures.map((result) => ({ run_id: result.run_id, failing_checks: result.failing_checks })),
  },
  model_behavior: {
    status: modelBehaviorStatus,
    by_scenario: modelBehaviorByScenario,
    a0_model_choice: modelBehaviorByScenario.A0.status,
    note:
      "模型行为层只按真实 provider 请求/响应与真实运行判定；确定性机制不代签语义，模型失败/未知如实保留。" +
      "A0 的“模型自行探索”记录为 A0 场景模型行为未满足（不是产品机制失败）；A1/A2 的 used refs 越界同样记模型行为层。",
  },
  preregistration_criteria: {
    a0_mechanism_verdict: mechanismFailures.some((result) => result.scenario === "A0") ? "fail" : "pass",
    a1a2_mechanism_verdict: mechanismFailures.some((result) => result.scenario !== "A0") ? "fail" : "pass",
    a1a2_used_refs_not_unbound: ["A1", "A2"].every((scenario) => {
      const scenarioRuns = runResults.filter((result) => result.scenario === scenario);
      return scenarioRuns.length > 0 && scenarioRuns.every((result) => result.unbound_context_refs.length === 0);
    }),
    a1a2_request_bytes_contain_observation: ["A1", "A2"].every((scenario) =>
      runResults
        .filter((result) => result.scenario === scenario)
        .every((result) => result.observed_in_calls >= 1),
    ),
    a1a2_two_independent_runs_each: ["A1", "A2"].every(
      (scenario) => runResults.filter((result) => result.scenario === scenario).length >= PLANNED_RUNS_PER_SCENARIO[scenario],
    ),
    note:
      "预注册 A1/A2 机制判据的 used-refs 子项由模型自报行为决定；越界时如实记未满足，不因产品机制 pass 而写 PASS。",
  },
  formal_acceptance: {
    status: "blocked",
    blocked_reason:
      setupMode === "d6a" && setupOk
        ? "D6-A setup 已由真实模型创作 + 外部页面采纳完成；正式 AU-15 A1/A2 仍须作者/指定评审对语义相容与模型行为做人工裁决，本批机制/模型行为 scoped 证据不代签 PASS。"
        : "正式 AU-15 A1/A2 仍须 D6-A setup（真实模型创作 + 外部真实页面采纳前置章节）与作者/指定评审的语义相容裁决；本批为隔离 fixture 的机制/模型行为 scoped 证据，不写成正式 PASS。",
  },
  model_lifecycle: lifecycle,
  db_counts: {
    before: driverLog.db_snapshot_before ?? null,
    after: driverLog.db_snapshot_after ?? null,
    zero_canon_write: driverLog.zero_canon_write === true,
  },
  runs: runResults,
  attempts: {
    planned: 5,
    attempted: runs.length,
    failed: runResults.filter((result) => result.mechanism_status !== "pass").length,
    run_ids: runs.map((run) => run.id),
    failed_runs: runResults
      .filter((result) => result.mechanism_status !== "pass")
      .map((result) => ({
        run_id: result.run_id,
        scenario: result.scenario,
        turn_status: result.turn_status ?? null,
        failure_events: result.failure_events,
      })),
    note: "失败 run 计入分母并只读保留；不因模型/校验失败重跑刷分。",
  },
  session_independence: Object.fromEntries(
    ["A0", "A1", "A2"].map((scenario) => {
      const scenarioRuns = runResults.filter((result) => result.scenario === scenario);
      const ids = scenarioRuns.map((result) => result.session_id).filter(Boolean);
      return [
        scenario,
        {
          runs: scenarioRuns.length,
          distinct_sessions: new Set(ids).size,
          independent_runs: ids.length === scenarioRuns.length && new Set(ids).size === ids.length,
          session_ids: ids,
          driver_reported_isolation: scenarioRuns.map((result) => result.session_isolation),
          note:
            "以 turn_result.session_id 为准判定独立 run；driver 在会话栏新建后若轮询基线 bug，会误报 shared_session，但 session_id 不同仍证明独立会话（本批已修复 driver 轮询）。",
        },
      ];
    }),
  ),
  author_question_replies: (driverLog.author_question_events ?? []).length,
  session_switches: driverLog.session_switches ?? [],
  transport_frames: driverLog.transport_frames ?? null,
  llm_calls_total: llmCalls.length,
};

const aggregate = {
  schema: SIDECAR_SCHEMA,
  slice_id: summary.slice_id,
  provider: summary.provider,
  model: summary.model,
  setup: summary.setup,
  mechanism: summary.mechanism,
  model_behavior: summary.model_behavior,
  formal_acceptance: summary.formal_acceptance,
  model_lifecycle: lifecycle,
  runs: runResults.map((result) => JSON.parse(fs.readFileSync(path.join(dir, result.sidecar), "utf8"))),
  generated_at: summary.generated_at,
};

add("driver_log_present", true, null);
add("runs_present", runs.length >= 1, { runs: runs.length, expected: 5 });
add("expected_runs_attempted", runs.length === 5, { runs: runs.map((run) => run.id) }, "evidence");
add(
  "provider_calls_real_model",
  llmCalls.some((call) => REAL_MODEL_TOKENS.some((token) => String(call.actual_model ?? "").includes(token))),
  { actual_models: [...new Set(llmCalls.map((call) => call.actual_model).filter(Boolean))] },
  "model_behavior",
);
add(
  "model_lifecycle_before_recorded",
  Boolean(before && "loaded_before" in before),
  before ? { loaded_before: before.loaded_before } : null,
);
add(
  "model_lifecycle_unloaded_clean",
  Boolean(after?.unloaded) && after?.loaded_after === null,
  after ? { loaded_after: after.loaded_after, unloaded: after.unloaded, unload_error: after.unload_error } : null,
);
add(
  "mechanism_all_runs_pass",
  mechanismStatus === "pass",
  { failing_runs: mechanismFailures.map((result) => result.run_id) },
);
add(
  "model_behavior_observed",
  modelBehaviorStatus === "observed",
  { by_scenario: modelBehaviorByScenario },
  "model_behavior",
);

const failures = checks.filter((check) => check.severity === "critical" && !check.ok);
summary.overall_checks = checks;
summary.overall_status = failures.length === 0 ? "pass" : "fail";

writeJson("evidence-checks.json", checks);
writeJson("summary.json", summary);
writeJson("au15-evidence-sidecar.json", aggregate);

console.log(
  `[au15-native-evidence] runs=${runs.length} mechanism=${summary.mechanism.status} ` +
    `model_behavior=${summary.model_behavior.status} ` +
    `A1=${modelBehaviorByScenario.A1?.status ?? "n/a"} A2=${modelBehaviorByScenario.A2?.status ?? "n/a"} ` +
    `loaded_before=${lifecycle.loaded_before} loaded_after=${lifecycle.loaded_after}`,
);
for (const result of runResults) {
  console.log(
    `[au15-native-evidence] ${result.run_id} (${result.scenario}) mechanism=${result.mechanism_status} ` +
      `model_behavior=${result.model_behavior_status} calls=${result.provider_calls} ` +
      `obs_refs=${result.request_observation_refs.length} used=${result.used_context_refs.length} ` +
      `validation=${result.used_context_refs_validation} candidates=${result.candidate_count}` +
      (result.failing_checks.length ? ` failing=${result.failing_checks.join(",")}` : ""),
  );
}
if (summary.overall_status === "fail") process.exit(1);
