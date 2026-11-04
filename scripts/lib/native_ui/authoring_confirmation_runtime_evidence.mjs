// B71 §16.14 C11/C12：批次运行清理，以及 child run 同源实时启动/工具事件。
// C12 只认本批 wire 中 direction=received、event=agent_event、run_id 精确等于 child
// run 的原始推送；终局后重放（duplicate/reconnect）由第一次终局截断，不参与判定。
import { frameBody, frameEvent } from "./scenario_evidence.mjs";
import { field, firstOrNull, list, numberValue, textField } from "./authoring_confirmation_facts.mjs";

const TERMINAL_AGENT_EVENT_TYPES = Object.freeze(["run_completed", "run_failed", "run_cancelled"]);
const EXECUTION_BRANCHES = Object.freeze(["executed", "tool_failed", "gate_blocked"]);

function runtimeStopped(runtime, llmStopped) {
  return (
    Boolean(runtime) &&
    field(runtime, "app_processes") === 0 &&
    field(field(runtime, "ports"), "backend_4657") === false &&
    field(field(runtime, "ports"), "transport_4661") === false &&
    llmStopped
  );
}

// C11 清理（强化）：remaining=[]、process_observation 有效（EPERM 降级不 pass）、批次后
// 实测 app=0/端口不监听/llm-calls 与 driver 终止观测一致。
export function cleanupCheck(facts) {
  const remaining = list(field(facts.cleanup, "remaining"));
  const processObservation = field(facts.cleanup, "process_observation");
  const fallback = field(processObservation, "fallback_reason");
  const runtime = facts.runtime;
  const terminationLlm = facts.terminationLlmCalls;
  const runtimeLlm = numberValue(field(runtime, "llm_calls"));
  const llmStopped =
    Boolean(runtime) &&
    Number.isFinite(terminationLlm) &&
    Number.isFinite(runtimeLlm) &&
    runtimeLlm === terminationLlm;
  const stopped = runtimeStopped(runtime, llmStopped);
  const ok = remaining.length === 0 && stopped;
  const terminationLlmOrNull = Number.isFinite(terminationLlm) ? terminationLlm : null;
  return {
    ok,
    reason: ok ? null : "cleanup_unverified_or_runtime_not_stopped",
    detail: {
      remaining: remaining.length,
      process_observation: processObservation,
      cleanup_observation_degraded: fallback !== null,
      runtime_after_batch: runtime,
      llm_calls_stopped: llmStopped,
      llm_calls_baseline_termination: terminationLlmOrNull,
      runtime_stopped: stopped,
      driver_termination_snapshot: {
        // 仅记录 driver 结束时的观测；此时 supervisor cleanup 尚未发生，app 仍运行属预期。
        at: field(facts.termination, "at"),
        app_processes: field(facts.termination, "app_processes"),
        ports: field(facts.termination, "ports"),
        llm_calls: terminationLlmOrNull,
      },
    },
  };
}

function isChildAgentEvent(record, childRunId) {
  return (
    field(record, "direction") === "received" &&
    frameEvent(record) === "agent_event" &&
    textField(frameBody(record), "run_id") === childRunId
  );
}

function childWireAgentEvents(wire, childRunId) {
  const events = [];
  for (const record of list(wire)) {
    if (!isChildAgentEvent(record, childRunId)) continue;
    const body = frameBody(record) ?? {};
    events.push({
      order: events.length + 1,
      at: field(record, "at"),
      event_id: textField(body, "event_id"),
      run_id: textField(body, "run_id"),
      run_ref: field(body, "run_ref"),
      sequence: Number(field(body, "sequence")),
      event_type: textField(body, "event_type"),
      summary: field(body, "summary"),
      reason_codes: field(body, "reason_codes"),
      refs: field(body, "refs"),
    });
  }
  return events;
}

function stringArrayEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function startupEventMismatches(wireEvent, dbEvent) {
  const mismatches = [];
  const compare = (name, wireValue, dbValue) => {
    if (wireValue !== dbValue) mismatches.push({ field: name, wire: wireValue, db: dbValue });
  };
  compare("run_id", wireEvent.run_id, dbEvent.run_id);
  compare("sequence", wireEvent.sequence, dbEvent.sequence);
  compare("event_type", wireEvent.event_type, dbEvent.event_type);
  compare("summary", wireEvent.summary, dbEvent.summary);
  if (!stringArrayEqual(wireEvent.reason_codes, dbEvent.reason_codes)) {
    mismatches.push({ field: "reason_codes", wire: wireEvent.reason_codes, db: dbEvent.reason_codes });
  }
  if (!stringArrayEqual(wireEvent.refs, dbEvent.refs)) {
    mismatches.push({ field: "refs", wire: wireEvent.refs, db: dbEvent.refs });
  }
  return mismatches;
}

function verifyStartupEventAgainstDb(wireEvent, dbEvents) {
  const base = {
    order: wireEvent.order,
    event_id: wireEvent.event_id,
    run_id: wireEvent.run_id,
    sequence: wireEvent.sequence,
    event_type: wireEvent.event_type,
    db_ok: false,
    db_reason: null,
    mismatches: [],
    db_event: null,
  };
  if (wireEvent.event_id === "") return { ...base, db_reason: "event_id_missing" };
  const dbEvent = dbEvents.find((row) => row.id === wireEvent.event_id);
  if (!dbEvent) return { ...base, db_reason: "db_event_missing" };
  const mismatches = startupEventMismatches(wireEvent, dbEvent);
  return {
    ...base,
    db_ok: mismatches.length === 0,
    db_reason: mismatches.length === 0 ? null : "db_event_field_mismatch",
    mismatches,
    db_event: {
      run_id: dbEvent.run_id,
      sequence: dbEvent.sequence,
      event_type: dbEvent.event_type,
      summary: dbEvent.summary,
      reason_codes: dbEvent.reason_codes,
      refs: dbEvent.refs,
    },
  };
}

function duplicateStartupFacts(events) {
  const idCounts = new Map();
  const sequenceCounts = new Map();
  for (const event of events) {
    idCounts.set(event.event_id, (idCounts.get(event.event_id) ?? 0) + 1);
    sequenceCounts.set(event.sequence, (sequenceCounts.get(event.sequence) ?? 0) + 1);
  }
  return {
    duplicate_event_ids: [...idCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([eventId]) => eventId),
    duplicate_sequences: [...sequenceCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([sequence]) => sequence),
  };
}

function toolStartedRequiredForBranch(branch, dbHasToolStarted) {
  if (branch === "executed" || branch === "tool_failed") return true;
  return branch === "gate_blocked" && dbHasToolStarted;
}

function terminalCut(events) {
  const index = events.findIndex((event) => TERMINAL_AGENT_EVENT_TYPES.includes(event.event_type));
  if (index < 0) return { terminal: null, beforeTerminal: events, afterTerminal: [] };
  return {
    terminal: events[index],
    beforeTerminal: events.slice(0, index),
    afterTerminal: events.slice(index + 1),
  };
}

const isStartupEvent = (event) => event.event_type === "run_started" || event.event_type === "tool_started";
const isRunStarted = (event) => event.event_type === "run_started";
const isToolStarted = (event) => event.event_type === "tool_started";

function toolStartedFollowsRunStarted(toolStarted, runStarted) {
  if (!runStarted) return true;
  return toolStarted.order > runStarted.order;
}

function startupModel({ wire, childRunId, branch, dbAgentEvents }) {
  const events = childWireAgentEvents(wire, childRunId);
  const dbEvents = list(dbAgentEvents);
  const { terminal, beforeTerminal, afterTerminal } = terminalCut(events);
  const { duplicate_event_ids, duplicate_sequences } = duplicateStartupFacts(beforeTerminal);
  const startupEvents = beforeTerminal.filter(isStartupEvent);
  const runStartedEvents = startupEvents.filter(isRunStarted);
  const toolStartedEvents = startupEvents.filter(isToolStarted);
  const runStarted = firstOrNull(runStartedEvents);
  const dbHasToolStarted = dbEvents.some(
    (event) => event.run_id === childRunId && event.event_type === "tool_started",
  );
  const toolStartedRequired = toolStartedRequiredForBranch(branch, dbHasToolStarted);
  const missing = [];
  if (runStartedEvents.length === 0) missing.push("run_started");
  if (toolStartedRequired && toolStartedEvents.length === 0) missing.push("tool_started");
  return {
    childRunId,
    branch,
    branchKnown: EXECUTION_BRANCHES.includes(branch),
    terminal,
    afterTerminal,
    events,
    startupEvents,
    runStartedEvents,
    toolStartedEvents,
    runStarted,
    dbHasToolStarted,
    toolStartedRequired,
    missing,
    duplicate_event_ids,
    duplicate_sequences,
    runStartedFirst: Boolean(runStarted) && runStarted.order === 1,
    runStartedSequenceOne: Boolean(runStarted) && runStarted.sequence === 1,
    toolStartedAfterRunStarted: toolStartedEvents.every((event) =>
      toolStartedFollowsRunStarted(event, runStarted),
    ),
    verifiedStartupEvents: startupEvents.map((event) => verifyStartupEventAgainstDb(event, dbEvents)),
  };
}

function presenceFailures(model) {
  return [
    model.childRunId === "" && "child_run_id_missing",
    !model.branchKnown && "c7_branch_unavailable",
    !model.terminal && "child_terminal_event_missing",
    model.duplicate_event_ids.length > 0 && "duplicate_event_id_before_terminal",
    model.duplicate_sequences.length > 0 && "duplicate_sequence_before_terminal",
  ].filter(Boolean);
}

function startupShapeFailures(model) {
  return [
    model.runStartedEvents.length > 1 && "startup_event_not_unique",
    model.missing.length > 0 && "child_live_startup_missing",
    !model.runStartedFirst && "run_started_not_first_event",
    !model.runStartedSequenceOne && "run_started_sequence_not_one",
  ].filter(Boolean);
}

function eventOrderFailures(model) {
  return [
    !model.toolStartedAfterRunStarted && "tool_started_before_run_started",
    model.verifiedStartupEvents.some((entry) => !entry.db_ok) && "startup_event_db_mismatch",
  ].filter(Boolean);
}

function startupDetail(model) {
  const { terminal } = model;
  return {
    child_run_id: model.childRunId || null,
    branch: model.branch || null,
    required_types: ["run_started", ...(model.toolStartedRequired ? ["tool_started"] : [])],
    tool_started_required: model.toolStartedRequired,
    db_has_tool_started: model.dbHasToolStarted,
    terminal: terminal
      ? {
          order: terminal.order,
          event_id: terminal.event_id,
          sequence: terminal.sequence,
          event_type: terminal.event_type,
          at: terminal.at,
        }
      : null,
    events: model.events.map((event) => ({
      order: event.order,
      at: event.at,
      event_id: event.event_id,
      run_id: event.run_id,
      sequence: event.sequence,
      event_type: event.event_type,
      summary: event.summary,
      reason_codes: event.reason_codes,
      refs: event.refs,
      pre_terminal: terminal ? event.order < terminal.order : true,
    })),
    startup_events: model.verifiedStartupEvents,
    missing: model.missing,
    duplicate_event_ids: model.duplicate_event_ids,
    duplicate_sequences: model.duplicate_sequences,
    run_started_count: model.runStartedEvents.length,
    run_started_first: model.runStartedFirst,
    run_started_sequence: field(model.runStarted, "sequence"),
    tool_started_count: model.toolStartedEvents.length,
    tool_started_after_run_started: model.toolStartedAfterRunStarted,
    after_terminal_ignored: model.afterTerminal.length,
    payload_compared: false,
  };
}

export function childLiveStartupEvents({ wire, childRunId, branch, dbAgentEvents }) {
  const model = startupModel({ wire, childRunId, branch, dbAgentEvents });
  const reasons = [...presenceFailures(model), ...startupShapeFailures(model), ...eventOrderFailures(model)];
  return {
    ok: reasons.length === 0,
    reason: reasons[0] ?? null,
    detail: startupDetail(model),
  };
}

// C12 在确认分支实际计算；拒绝分支不适用，但 detail 仍记录 child run 身份。
export function childLiveStartupCheck(facts) {
  if (facts.mode !== "confirm") {
    return {
      ok: null,
      reason: "not_applicable",
      detail: { child_run_id: facts.childRunId || null, branch: null },
    };
  }
  return childLiveStartupEvents({
    wire: facts.wire,
    childRunId: facts.childRunId,
    branch: facts.childExecutionBranch,
    dbAgentEvents: facts.dbAgentEvents,
  });
}
