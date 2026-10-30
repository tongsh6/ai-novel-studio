// B39 CP1d：AU-15 A0/A1/A2 证据 sidecar 与外部请求字节对账（不运行产品/模型）。
//
// 输入 = 外部 driver/app-log/llm-calls/DB 快照/产品 trace；输出 = 机制证据与模型行为
// 分层 sidecar（B42 可消费的 provider_calls.request_observation_refs/observed_in_calls）。
// 本模块只读证据，不修改 artifact；未执行/缺证据记 unknown/evidence_missing，不补写。
import fs from "node:fs";
import path from "node:path";

export const AU15_SIDECAR_SCHEMA = "au15-evidence-sidecar/v1";

export function parseLlmCalls(text) {
  return String(text ?? "")
    .split("\n")
    .filter((line) => line.includes("{"))
    .flatMap((line) => {
      const start = line.indexOf("{");
      const end = line.lastIndexOf("}");
      if (start < 0 || end <= start) return [];
      try {
        const record = JSON.parse(line.slice(start, end + 1));
        const body = record?.request?.body ?? {};
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const requestText = messages.map((message) => String(message?.content ?? "")).join("\n");
        const response = record?.response?.body ?? record?.response ?? {};
        return [{
          timestamp: line.slice(1, line.indexOf("]")),
          model: response?.model ?? response?.usage?.model ?? null,
          requestText,
          responseText: textOf(response),
        }];
      } catch {
        return [];
      }
    });
}

function textOf(value, acc = []) {
  if (typeof value === "string") acc.push(value);
  else if (Array.isArray(value)) value.forEach((item) => textOf(item, acc));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => textOf(item, acc));
  return acc.join("\n");
}

export function buildAu15Evidence({ scenario, driverLog, llmCalls, dbCounts = null }) {
  const checks = [];
  const add = (id, ok, detail = null, severity = "critical") => {
    checks.push({ id, ok, severity, detail });
  };

  const calls = Array.isArray(llmCalls) ? llmCalls : [];
  const traceSummary = driverLog?.trace_summary ?? driverLog?.traceSummary ?? {};
  const preparation = Array.isArray(driverLog?.preparation_events) ? driverLog.preparation_events : [];
  const observations = Array.isArray(driverLog?.observations) ? driverLog.observations : [];
  const requestObservationRefs = Array.isArray(traceSummary.request_observation_refs)
    ? traceSummary.request_observation_refs
    : [];
  const requestBaseRefs = Array.isArray(traceSummary.request_base_refs) ? traceSummary.request_base_refs : [];
  const usedRefs = Array.isArray(traceSummary.used_context_refs) ? traceSummary.used_context_refs : [];
  const unboundRefs = Array.isArray(traceSummary.unbound_context_refs) ? traceSummary.unbound_context_refs : [];

  add("provider_calls_present", calls.length >= 1, { calls: calls.length });
  add(
    "provider_calls_real_model",
    calls.some((call) => typeof call.model === "string" && call.model.trim() !== ""),
    { models: [...new Set(calls.map((call) => call.model))] },
    "model_behavior",
  );

  const readyEvents = preparation.filter((event) => event?.status === "ready_to_write");
  const continueEvents = preparation.filter((event) => event?.status === "continue_exploration");
  add("preparation_ready_present", readyEvents.length >= 1, { ready: readyEvents.length });

  if (scenario === "A0") {
    add(
      "a0_no_forced_exploration",
      continueEvents.length === 0,
      { continue_exploration: continueEvents.length },
    );
  } else {
    add(
      "a1a2_model_planned_exploration",
      continueEvents.length >= 1,
      { continue_exploration: continueEvents.length, tools: continueEvents.map((event) => event.tool) },
      "model_behavior",
    );
  }

  // 真实请求字节对账：实际 provider 请求必须包含观察内容/ref，而不是只在产品字段声明。
  const observedCalls = calls
    .map((call) => ({
      model: call.model,
      request_observation_refs: requestObservationRefs.filter((ref) => call.requestText.includes(ref)),
      observed_in_calls: requestObservationRefs.some((ref) => call.requestText.includes(ref)),
    }))
    .filter((call) => call.observed_in_calls);

  const observationContents = observations
    .map((observation) => String(observation?.summary ?? "").trim())
    .filter((summary) => summary !== "");

  add(
    "request_observation_refs_present",
    requestObservationRefs.length > 0,
    { refs: requestObservationRefs },
  );
  add(
    "writer_request_contains_observation",
    observedCalls.length >= 1 &&
      (requestObservationRefs.some((ref) => calls.some((call) => call.requestText.includes(ref))) ||
        observationContents.some((summary) => calls.some((call) => call.requestText.includes(summary)))),
    { observed_calls: observedCalls.length, observation_contents: observationContents.length },
  );

  const validation = traceSummary.used_context_refs_validation ?? "unknown";
  const visibleRefs = new Set([...requestBaseRefs, ...requestObservationRefs]);
  const usedOutsideVisible = usedRefs.filter((ref) => !visibleRefs.has(ref));
  add(
    "used_refs_bound_to_visible_sources",
    usedRefs.length === 0 ? validation === "no_claim" : usedOutsideVisible.length === 0,
    { validation, used_refs: usedRefs, unbound_refs: unboundRefs, used_outside_visible: usedOutsideVisible },
  );

  add(
    "zero_canon_write",
    driverLog?.zero_canon_write === true ||
      (dbCounts && dbCounts.receipts === 0 && dbCounts.canon_delta === 0) ||
      false,
    dbCounts,
  );
  add(
    "artifact_bytes_unchanged",
    driverLog?.artifact_bytes_unchanged !== false,
    { artifact_bytes_unchanged: driverLog?.artifact_bytes_unchanged ?? null },
    "mechanism",
  );

  const criticalFailures = checks.filter((check) => check.severity === "critical" && !check.ok);
  const mechanismStatus = criticalFailures.length > 0 ? "fail" : "pass";
  const modelBehaviorStatus =
    scenario === "A0"
      ? "not_applicable"
      : checks.find((check) => check.id === "a1a2_model_planned_exploration")?.ok
        ? "observed"
        : "unknown";

  return {
    schema: AU15_SIDECAR_SCHEMA,
    scenario,
    mechanism: { status: mechanismStatus, checks },
    model_behavior: {
      status: modelBehaviorStatus,
      provider_calls: calls.length,
      observed_in_calls: observedCalls.length,
      used_context_refs_reported: usedRefs.length > 0,
      used_context_refs_validation: validation,
    },
    provider_calls: calls.map((call) => ({
      model: call.model,
      request_observation_refs: requestObservationRefs.filter((ref) => call.requestText.includes(ref)),
      observed_in_calls: requestObservationRefs.some((ref) => call.requestText.includes(ref)),
    })),
    evidence_gaps: [
      ...(calls.length === 0 ? ["no_llm_calls"] : []),
      ...(observedCalls.length === 0 ? ["observation_not_observed_in_request_bytes"] : []),
      ...(usedRefs.length === 0 ? ["used_context_refs_unknown"] : []),
    ],
    generated_at: new Date().toISOString(),
  };
}

export function readAu15Artifacts(artifactDir) {
  const root = path.resolve(artifactDir);
  const driverLogPath = path.join(root, "au15-driver-log.json");
  const driverLog = fs.existsSync(driverLogPath) ? JSON.parse(fs.readFileSync(driverLogPath, "utf8")) : null;
  const llmDir = path.join(root, "llm-calls");
  const llmCalls = fs.existsSync(llmDir)
    ? fs
        .readdirSync(llmDir)
        .filter((file) => file.endsWith(".jsonl"))
        .sort()
        .flatMap((file) => parseLlmCalls(fs.readFileSync(path.join(llmDir, file), "utf8")))
    : [];
  const dbPath = path.join(root, "db-snapshot.json");
  const dbCounts = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, "utf8")) : null;
  return { driverLog, llmCalls, dbCounts };
}
