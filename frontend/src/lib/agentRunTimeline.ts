import { WORKBENCH } from "./copy";
import type { AgentEventData } from "./socket";

export type AgentRunProviderFlowPhaseStatus = "pending" | "active" | "done" | "failed";

export interface AgentRunProviderFlowPhase {
  key: string;
  label: string;
  status: AgentRunProviderFlowPhaseStatus;
}

export interface AgentRunProviderFlowSummary {
  headline: string;
  details: string[];
  phases: AgentRunProviderFlowPhase[];
}

export interface AgentRunProviderUsageData {
  run_id?: string;
  provider_run_ref?: string;
  provider_call_ref?: string;
  purpose?: string;
  status?: string;
  output_type?: string;
  content_length?: number;
  usage?: Record<string, unknown>;
  provider_id?: string;
  model?: string;
  events?: Record<string, unknown>[];
  output?: Record<string, unknown>;
}

export interface AgentRunProviderReplayEvent {
  title: string;
  details: string[];
}

export interface AgentRunProviderReplayDetails {
  events: AgentRunProviderReplayEvent[];
  output: string[];
  boundary: string;
}

export type AgenticLoopPlanStepStatus = "pending" | "active" | "done" | "skipped";

export interface AgenticLoopPlanStep {
  stepRef: string;
  kind: "explore" | "act";
  status: AgenticLoopPlanStepStatus;
  description: string;
}

export interface AgenticLoopNarrativeEvent {
  key: string;
  eventType: string;
  label: string;
  narrative: string;
  sequence: number;
}

export interface AgenticLoopReasoningFlow {
  statusLine: string | null;
  planRef: string | null;
  planVersion: number | null;
  planSteps: AgenticLoopPlanStep[];
  narrativeEvents: AgenticLoopNarrativeEvent[];
  resultLine: string | null;
}

interface ProviderUsageBreakdown {
  inputTokens: number | null;
  outputTokens: number | null;
}

export function selectAgentRunVisibleEvents(
  events: AgentEventData[],
  limit: number,
): AgentEventData[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  if (ordered.length <= limit) return ordered;

  const latestChunkByCall = new Map<string, AgentEventData>();

  for (const event of ordered) {
    if (!isProviderChunkEvent(event)) continue;
    latestChunkByCall.set(providerChunkGroupKey(event), event);
  }

  const compacted = ordered.filter((event) => {
    if (!isProviderChunkEvent(event)) return true;
    return latestChunkByCall.get(providerChunkGroupKey(event)) === event;
  });

  return compacted.length <= limit ? compacted : compacted.slice(-limit);
}

function stringPayloadValue(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function rawStringPayloadValue(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function numberPayloadValue(
  payload: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanPayloadValue(
  payload: Record<string, unknown> | undefined,
  key: string,
): boolean | null {
  const value = payload?.[key];
  return typeof value === "boolean" ? value : null;
}

export function agentRunReasoningFlow(events: AgentEventData[]): AgenticLoopReasoningFlow {
  const reasoningEvents = events
    .filter(isAgenticLoopReasoningEvent)
    .sort((a, b) => a.sequence - b.sequence);
  const streamedEvents = streamedAuthorReasoningEvents(
    events,
    boundReasoningProviderRuns(reasoningEvents),
  );
  const narrativeEvents = compactAdjacentNarrativeEvents(
    [...streamedEvents, ...narrativeEventsFromReasoning(reasoningEvents)].sort(
      (a, b) => a.sequence - b.sequence,
    ),
  );
  const latestPlanEvent =
    [...reasoningEvents]
      .reverse()
      .find((event) => planStepsFromPayload(event.payload).length > 0) ?? null;
  const terminal = [...events]
    .reverse()
    .find((event) =>
      [
        "turn_result_ready",
        "run_completed",
        "run_cancelled",
        "run_failed",
        "awaiting_author",
      ].includes(event.event_type),
    );

  return {
    statusLine: null,
    planRef: latestPlanEvent ? stringPayloadValue(latestPlanEvent.payload, "plan_ref") : null,
    planVersion: latestPlanEvent
      ? numberPayloadValue(latestPlanEvent.payload, "plan_version")
      : null,
    planSteps: latestPlanEvent ? planStepsFromPayload(latestPlanEvent.payload) : [],
    narrativeEvents,
    resultLine: terminal
      ? (WORKBENCH.agenticLoopTerminalLabels[terminal.event_type] ?? terminal.event_type)
      : null,
  };
}

function isAgenticLoopReasoningEvent(event: AgentEventData): boolean {
  return (
    ["plan_drafted", "plan_revised", "exploration_observed", "evaluation_made"].includes(
      event.event_type,
    ) && stringPayloadValue(event.payload, "author_narrative") !== null
  );
}

function narrativeEventsFromReasoning(events: AgentEventData[]): AgenticLoopNarrativeEvent[] {
  return events.map((event) => ({
    key: event.event_id,
    eventType: event.event_type,
    label: WORKBENCH.agenticLoopEventLabels[event.event_type] ?? event.event_type,
    narrative: stringPayloadValue(event.payload, "author_narrative") ?? "",
    sequence: event.sequence,
  }));
}

function compactAdjacentNarrativeEvents(
  events: AgenticLoopNarrativeEvent[],
): AgenticLoopNarrativeEvent[] {
  return events.reduce<AgenticLoopNarrativeEvent[]>((compacted, event) => {
    const previous = compacted.at(-1);

    if (previous?.narrative === event.narrative) {
      compacted[compacted.length - 1] = {
        ...event,
        key: `${previous.key}:${event.key}`,
      };
      return compacted;
    }

    compacted.push(event);
    return compacted;
  }, []);
}

function streamedAuthorReasoningEvents(
  events: AgentEventData[],
  boundProviderRunRefs: Set<string>,
): AgenticLoopNarrativeEvent[] {
  const groups = new Map<
    string,
    {
      key: string;
      sequence: number;
      parts: string[];
    }
  >();

  events
    .filter(isAuthorReasoningDeltaEvent)
    .sort((a, b) => a.sequence - b.sequence)
    .forEach((event) => {
      const providerRunRef = stringPayloadValue(event.payload, "provider_run_ref");
      const providerCallRef = stringPayloadValue(event.payload, "provider_call_ref");
      const groupKey = providerRunRef ?? providerCallRef ?? event.event_id;

      if (providerRunRef && boundProviderRunRefs.has(providerRunRef)) return;

      const delta = rawStringPayloadValue(event.payload, "author_narrative_delta");
      if (delta === null) return;

      const existing =
        groups.get(groupKey) ??
        ({
          key: `stream:${groupKey}`,
          sequence: event.sequence,
          parts: [],
        } satisfies { key: string; sequence: number; parts: string[] });

      existing.sequence = event.sequence;
      existing.parts.push(delta);
      groups.set(groupKey, existing);
    });

  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      eventType: "provider_progress",
      label: WORKBENCH.agenticLoopEventLabels.provider_progress ?? "推理",
      narrative: group.parts.join(""),
      sequence: group.sequence,
    }))
    .filter((event) => event.narrative.trim() !== "");
}

function isAuthorReasoningDeltaEvent(event: AgentEventData): boolean {
  return (
    event.event_type === "provider_progress" &&
    stringPayloadValue(event.payload, "purpose") === "author_reasoning" &&
    rawStringPayloadValue(event.payload, "author_narrative_delta") !== null
  );
}

function boundReasoningProviderRuns(events: AgentEventData[]): Set<string> {
  const refs = new Set<string>();

  events.forEach((event) => {
    const source = recordValue(event.payload?.author_narrative_source);
    const providerRunRef = stringRecordValue(source, "provider_run_ref");
    if (providerRunRef) refs.add(providerRunRef);
  });

  return refs;
}

function planStepsFromPayload(payload: Record<string, unknown> | undefined): AgenticLoopPlanStep[] {
  const value = payload?.plan_steps;
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => recordValue(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => {
      const stepRef = stringRecordValue(item, "step_ref");
      const description = stringRecordValue(item, "description");
      if (!stepRef || !description) return null;

      return {
        stepRef,
        kind: stringRecordValue(item, "kind") === "act" ? "act" : "explore",
        status: normalizePlanStepStatus(stringRecordValue(item, "status")),
        description,
      };
    })
    .filter((item): item is AgenticLoopPlanStep => item !== null);
}

function normalizePlanStepStatus(status: string | null): AgenticLoopPlanStepStatus {
  if (status === "active" || status === "done" || status === "skipped") return status;
  return "pending";
}

function providerUsageTokens(payload: Record<string, unknown> | undefined): number | null {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return null;

  const record = usage as Record<string, unknown>;
  return firstUsageNumber(record, ["total_tokens", "total", "tokens"]);
}

function providerUsageBreakdown(
  payload: Record<string, unknown> | undefined,
): ProviderUsageBreakdown {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") {
    return { inputTokens: null, outputTokens: null };
  }

  const record = usage as Record<string, unknown>;

  return {
    inputTokens: firstUsageNumber(record, ["input_tokens", "prompt_tokens"]),
    outputTokens: firstUsageNumber(record, ["output_tokens", "completion_tokens"]),
  };
}

function firstUsageNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return null;
}

function providerRunUsageTokens(run: AgentRunProviderUsageData): number | null {
  const outputUsage =
    run.output && typeof run.output.usage === "object"
      ? (run.output.usage as Record<string, unknown>)
      : null;

  return providerUsageTokens({ usage: outputUsage ?? run.usage });
}

function providerRunUsageBreakdown(run: AgentRunProviderUsageData): ProviderUsageBreakdown {
  const outputUsage =
    run.output && typeof run.output.usage === "object"
      ? (run.output.usage as Record<string, unknown>)
      : null;

  return providerUsageBreakdown({ usage: outputUsage ?? run.usage });
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringRecordValue(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberRecordValue(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringListValue(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim());
}

function labelForRecord(
  labels: Record<string, string>,
  value: string | null,
  fallback: string | null = value,
): string | null {
  if (!value) return null;
  return labels[value] ?? fallback;
}

export function agentRunEventDetailItems(event: AgentEventData): string[] {
  const payload = event.payload ?? {};
  const details: string[] = [];

  if (event.event_type === "provider_progress") {
    const providerEvent = labelForRecord(
      WORKBENCH.agentRunProviderEventLabels,
      stringPayloadValue(payload, "provider_event_type"),
    );
    const purpose = labelForRecord(
      WORKBENCH.agentRunProviderPurposeLabels,
      stringPayloadValue(payload, "purpose"),
      WORKBENCH.agentRunProviderPurposeLabels.other,
    );
    const status = stringPayloadValue(payload, "status");
    const outputType = stringPayloadValue(payload, "output_type");
    const providerProgressPhase = stringPayloadValue(payload, "provider_progress_phase");
    const providerRunRef = stringPayloadValue(payload, "provider_run_ref");
    const providerCallRef = stringPayloadValue(payload, "provider_call_ref");
    const contentLength = numberPayloadValue(payload, "content_length");
    const chunkIndex = numberPayloadValue(payload, "chunk_index");
    const chunkContentLength = numberPayloadValue(payload, "chunk_content_length");
    const accumulatedContentLength = numberPayloadValue(payload, "accumulated_content_length");
    const usageTokens = providerUsageTokens(payload);
    const usageBreakdown = providerUsageBreakdown(payload);

    if (providerEvent) details.push(WORKBENCH.agentRunDetailProviderEvent(providerEvent));
    if (purpose) details.push(WORKBENCH.agentRunDetailProviderPurpose(purpose));
    if (status) details.push(WORKBENCH.agentRunDetailProviderStatus(status));
    if (outputType) details.push(WORKBENCH.agentRunDetailProviderOutputType(outputType));
    if (providerProgressPhase) {
      details.push(WORKBENCH.agentRunDetailProviderPhase(providerProgressPhase));
    }
    if (providerRunRef) details.push(WORKBENCH.agentRunDetailProviderRunRef(providerRunRef));
    if (providerCallRef) details.push(WORKBENCH.agentRunDetailProviderCallRef(providerCallRef));
    if (contentLength !== null) {
      details.push(WORKBENCH.agentRunDetailProviderContentLength(contentLength));
    }
    if (chunkIndex !== null) {
      details.push(WORKBENCH.agentRunDetailProviderChunkIndex(chunkIndex));
    }
    if (chunkContentLength !== null) {
      details.push(WORKBENCH.agentRunDetailProviderChunkLength(chunkContentLength));
    }
    if (accumulatedContentLength !== null) {
      details.push(WORKBENCH.agentRunDetailProviderAccumulatedLength(accumulatedContentLength));
    }
    if (usageTokens !== null) details.push(WORKBENCH.agentRunDetailProviderUsage(usageTokens));
    if (usageBreakdown.inputTokens !== null) {
      details.push(WORKBENCH.agentRunDetailProviderInputUsage(usageBreakdown.inputTokens));
    }
    if (usageBreakdown.outputTokens !== null) {
      details.push(WORKBENCH.agentRunDetailProviderOutputUsage(usageBreakdown.outputTokens));
    }

    return details;
  }

  const contextRefCount = numberPayloadValue(payload, "context_ref_count");
  const frameType = stringPayloadValue(payload, "frame_type");
  const needsTool = booleanPayloadValue(payload, "needs_tool");
  const candidateCount = numberPayloadValue(payload, "candidate_count");
  const planRef = stringPayloadValue(payload, "plan_ref");
  const actionCount = numberPayloadValue(payload, "action_count");
  const decisionRef = stringPayloadValue(payload, "decision_ref");
  const decisionType = stringPayloadValue(payload, "decision_type");
  const firstBlockingGate = stringPayloadValue(payload, "first_blocking_gate");
  const profileRef = stringPayloadValue(payload, "profile_ref");
  const profileSelection = recordValue(payload.profile_selection);
  const profileSource = stringRecordValue(profileSelection, "source");
  const profileReasonCodes = stringListValue(profileSelection, "reason_codes");
  const profileMatchedTerms = stringListValue(profileSelection, "matched_terms");

  if (contextRefCount !== null) details.push(WORKBENCH.agentRunDetailContextRefs(contextRefCount));
  if (frameType) details.push(WORKBENCH.agentRunDetailFrameType(frameType));
  if (needsTool !== null) details.push(WORKBENCH.agentRunDetailNeedsTool(needsTool));
  if (candidateCount !== null) details.push(WORKBENCH.agentRunDetailCandidateCount(candidateCount));
  if (planRef) details.push(WORKBENCH.agentRunDetailPlanRef(planRef));
  if (actionCount !== null) details.push(WORKBENCH.agentRunDetailActionCount(actionCount));
  if (decisionRef) details.push(WORKBENCH.agentRunDetailDecisionRef(decisionRef));
  if (decisionType) details.push(WORKBENCH.agentRunDetailDecisionType(decisionType));
  if (firstBlockingGate) details.push(WORKBENCH.agentRunDetailBlockingGate(firstBlockingGate));
  if (profileRef) details.push(WORKBENCH.agentRunDetailProfileRef(profileRef));
  if (profileSource) details.push(WORKBENCH.agentRunDetailProfileSource(profileSource));
  if (profileReasonCodes.length > 0) {
    details.push(WORKBENCH.agentRunDetailProfileReasons(profileReasonCodes.join(", ")));
  }
  if (profileMatchedTerms.length > 0) {
    details.push(WORKBENCH.agentRunDetailProfileTerms(profileMatchedTerms.join(", ")));
  }

  return details;
}

export function agentRunProviderFlowSummary(
  events: AgentEventData[],
  providerRuns: AgentRunProviderUsageData[] = [],
): AgentRunProviderFlowSummary | null {
  const providerEvents = events
    .filter((event) => event.event_type === "provider_progress")
    .sort((a, b) => a.sequence - b.sequence);

  if (providerEvents.length === 0 && providerRuns.length === 0) return null;

  const eventTypes = providerEvents
    .map((event) => stringPayloadValue(event.payload, "provider_event_type"))
    .filter((value): value is string => value !== null);
  const latestProviderEvent = providerEvents.at(-1) ?? null;
  const latestEventType = latestProviderEvent
    ? stringPayloadValue(latestProviderEvent.payload, "provider_event_type")
    : null;
  const latestPhase = latestProviderEvent
    ? stringPayloadValue(latestProviderEvent.payload, "provider_progress_phase")
    : null;
  const latestStatus = latestProviderEvent
    ? stringPayloadValue(latestProviderEvent.payload, "status")
    : null;

  const chunkEvents = providerEvents.filter(
    (event) =>
      stringPayloadValue(event.payload, "provider_event_type") === "chunk" ||
      hasReasonCode(event, "provider_chunk"),
  );
  const chunkCount = providerChunkCount(chunkEvents);
  const accumulatedLength = maxNumbers(
    chunkEvents.map((event) => numberPayloadValue(event.payload, "accumulated_content_length")),
  );
  const finalLength = providerFinalContentLength(providerEvents, providerRuns);
  const totalTokens = providerTotalTokens(providerEvents, providerRuns);
  const providerCallRefs = providerFlowCallRefs(providerEvents, providerRuns);
  const purposes = providerFlowPurposes(providerEvents, providerRuns);
  const models = uniqueStrings(
    providerRuns.map((run) =>
      typeof run.model === "string" && run.model.trim() !== "" ? run.model : null,
    ),
  );
  const failed = providerFlowFailed(eventTypes, latestStatus, providerRuns);
  const cancelled = providerFlowCancelled(eventTypes, latestStatus, providerRuns);
  const completed = providerFlowCompleted(eventTypes, providerRuns);

  return {
    headline: providerFlowHeadline({
      latestEventType,
      latestPhase,
      chunkCount,
      accumulatedLength,
      failed,
      cancelled,
      completed,
    }),
    details: providerFlowDetailItems({
      purposes,
      providerCallRefs,
      chunkCount,
      accumulatedLength,
      finalLength,
      totalTokens,
      models,
    }),
    phases: providerFlowPhases(providerEvents, providerRuns, {
      failed,
      cancelled,
      completed,
      latestEventType,
      latestPhase,
    }),
  };
}

export function agentRunProviderRunDetailItems(run: AgentRunProviderUsageData): string[] {
  const details: string[] = [];
  const purpose = labelForRecord(
    WORKBENCH.agentRunProviderPurposeLabels,
    run.purpose ?? null,
    WORKBENCH.agentRunProviderPurposeLabels.other,
  );
  const tokens = providerRunUsageTokens(run);
  const usageBreakdown = providerRunUsageBreakdown(run);
  const contentLength =
    typeof run.content_length === "number" && Number.isFinite(run.content_length)
      ? run.content_length
      : null;

  if (purpose) details.push(WORKBENCH.agentRunDetailProviderPurpose(purpose));
  if (run.status) details.push(WORKBENCH.agentRunDetailProviderStatus(run.status));
  if (run.output_type) details.push(WORKBENCH.agentRunDetailProviderOutputType(run.output_type));
  if (run.provider_run_ref)
    details.push(WORKBENCH.agentRunDetailProviderRunRef(run.provider_run_ref));
  if (run.provider_call_ref) {
    details.push(WORKBENCH.agentRunDetailProviderCallRef(run.provider_call_ref));
  }
  if (contentLength !== null) {
    details.push(WORKBENCH.agentRunDetailProviderContentLength(contentLength));
  }
  if (tokens !== null) details.push(WORKBENCH.agentRunDetailProviderUsage(tokens));
  if (usageBreakdown.inputTokens !== null) {
    details.push(WORKBENCH.agentRunDetailProviderInputUsage(usageBreakdown.inputTokens));
  }
  if (usageBreakdown.outputTokens !== null) {
    details.push(WORKBENCH.agentRunDetailProviderOutputUsage(usageBreakdown.outputTokens));
  }
  if (run.model) details.push(WORKBENCH.agentRunDetailProviderModel(run.model));

  return details;
}

export function agentRunProviderRunReplayDetails(
  run: AgentRunProviderUsageData,
): AgentRunProviderReplayDetails {
  const output = recordValue(run.output);

  return {
    events: (run.events ?? [])
      .map((event, index) => providerRunReplayEvent(event, index))
      .filter((event): event is AgentRunProviderReplayEvent => event !== null),
    output: providerRunReplayOutputDetails(run, output),
    boundary: WORKBENCH.agentRunProviderReplayBoundary,
  };
}

function providerRunReplayEvent(
  event: Record<string, unknown>,
  index: number,
): AgentRunProviderReplayEvent | null {
  const payload = recordValue(event.payload);
  const summary = stringRecordValue(event, "summary");
  const eventType = stringRecordValue(event, "event_type");
  const providerEventType = stringRecordValue(payload, "provider_event_type") ?? eventType;
  const providerEvent = labelForRecord(WORKBENCH.agentRunProviderEventLabels, providerEventType);
  const sequence = numberRecordValue(event, "sequence");
  const status = stringRecordValue(payload, "status");
  const outputType = stringRecordValue(payload, "output_type");
  const providerProgressPhase = stringRecordValue(payload, "phase");
  const providerRunRef =
    stringRecordValue(payload, "provider_run_ref") ?? stringRecordValue(event, "provider_run_ref");
  const providerCallRef =
    stringRecordValue(payload, "provider_call_ref") ??
    stringRecordValue(event, "provider_call_ref");
  const contentLength = numberRecordValue(payload, "content_length");
  const chunkIndex = numberRecordValue(payload, "chunk_index");
  const accumulatedContentLength = numberRecordValue(payload, "accumulated_content_length");
  const usageTokens = providerUsageTokens(payload ?? undefined);
  const usageBreakdown = providerUsageBreakdown(payload ?? undefined);
  const emittedAt = stringRecordValue(event, "emitted_at");
  const isChunkEvent = providerEventType === "chunk";

  const details: string[] = [];
  if (sequence !== null) details.push(WORKBENCH.agentRunProviderReplaySequence(sequence));
  if (eventType) details.push(WORKBENCH.agentRunProviderReplayEventType(eventType));
  if (providerEvent) details.push(WORKBENCH.agentRunDetailProviderEvent(providerEvent));
  if (status) details.push(WORKBENCH.agentRunDetailProviderStatus(status));
  if (outputType) details.push(WORKBENCH.agentRunDetailProviderOutputType(outputType));
  if (providerProgressPhase) {
    details.push(WORKBENCH.agentRunDetailProviderPhase(providerProgressPhase));
  }
  if (providerRunRef) details.push(WORKBENCH.agentRunDetailProviderRunRef(providerRunRef));
  if (providerCallRef) details.push(WORKBENCH.agentRunDetailProviderCallRef(providerCallRef));
  if (contentLength !== null) {
    details.push(
      isChunkEvent
        ? WORKBENCH.agentRunDetailProviderChunkLength(contentLength)
        : WORKBENCH.agentRunDetailProviderContentLength(contentLength),
    );
  }
  if (chunkIndex !== null) {
    details.push(WORKBENCH.agentRunDetailProviderChunkIndex(chunkIndex));
  }
  if (accumulatedContentLength !== null) {
    details.push(WORKBENCH.agentRunDetailProviderAccumulatedLength(accumulatedContentLength));
  }
  if (usageTokens !== null) details.push(WORKBENCH.agentRunDetailProviderUsage(usageTokens));
  if (usageBreakdown.inputTokens !== null) {
    details.push(WORKBENCH.agentRunDetailProviderInputUsage(usageBreakdown.inputTokens));
  }
  if (usageBreakdown.outputTokens !== null) {
    details.push(WORKBENCH.agentRunDetailProviderOutputUsage(usageBreakdown.outputTokens));
  }
  if (emittedAt) details.push(WORKBENCH.agentRunProviderReplayEmittedAt(emittedAt));

  const title =
    summary ??
    providerEvent ??
    eventType ??
    WORKBENCH.agentRunProviderReplayEventFallback(index + 1);

  return { title, details };
}

function providerRunReplayOutputDetails(
  run: AgentRunProviderUsageData,
  output: Record<string, unknown> | null,
): string[] {
  const contentSummary = recordValue(output?.content_summary);
  const status = stringRecordValue(output, "status") ?? run.status ?? null;
  const outputType = stringRecordValue(output, "output_type") ?? run.output_type ?? null;
  const contentLength =
    numberRecordValue(output, "content_length") ??
    numberRecordValue(contentSummary, "content_length") ??
    (typeof run.content_length === "number" && Number.isFinite(run.content_length)
      ? run.content_length
      : null);
  const tokens = providerRunUsageTokens(run);
  const usageBreakdown = providerRunUsageBreakdown(run);
  const refs = stringListValue(output, "refs");
  const finalizedAt = stringRecordValue(output, "finalized_at");

  const details: string[] = [];
  if (status) details.push(WORKBENCH.agentRunDetailProviderStatus(status));
  if (outputType) details.push(WORKBENCH.agentRunDetailProviderOutputType(outputType));
  if (contentLength !== null) {
    details.push(WORKBENCH.agentRunDetailProviderContentLength(contentLength));
  }
  if (tokens !== null) details.push(WORKBENCH.agentRunDetailProviderUsage(tokens));
  if (usageBreakdown.inputTokens !== null) {
    details.push(WORKBENCH.agentRunDetailProviderInputUsage(usageBreakdown.inputTokens));
  }
  if (usageBreakdown.outputTokens !== null) {
    details.push(WORKBENCH.agentRunDetailProviderOutputUsage(usageBreakdown.outputTokens));
  }
  if (refs.length > 0) details.push(WORKBENCH.agentRunProviderReplayRefs(refs.join(", ")));
  if (finalizedAt) details.push(WORKBENCH.agentRunProviderReplayFinalizedAt(finalizedAt));

  return details.length > 0 ? details : [WORKBENCH.agentRunProviderReplayNoOutput];
}

function hasReasonCode(event: AgentEventData, reasonCode: string): boolean {
  return (event.reason_codes ?? []).includes(reasonCode);
}

function isProviderChunkEvent(event: AgentEventData): boolean {
  if (event.event_type !== "provider_progress") return false;

  return (
    stringPayloadValue(event.payload, "provider_event_type") === "chunk" ||
    hasReasonCode(event, "provider_chunk")
  );
}

function providerChunkGroupKey(event: AgentEventData): string {
  return (
    stringPayloadValue(event.payload, "provider_call_ref") ??
    stringPayloadValue(event.payload, "provider_run_ref") ??
    event.step_ref ??
    event.run_ref
  );
}

function providerFlowHeadline({
  latestEventType,
  latestPhase,
  chunkCount,
  accumulatedLength,
  failed,
  cancelled,
  completed,
}: {
  latestEventType: string | null;
  latestPhase: string | null;
  chunkCount: number;
  accumulatedLength: number;
  failed: boolean;
  cancelled: boolean;
  completed: boolean;
}): string {
  if (failed) return WORKBENCH.agentRunProviderFlowFailed;
  if (cancelled) return WORKBENCH.agentRunProviderFlowCancelled;
  if (latestEventType === "chunk" && !completed) {
    return WORKBENCH.agentRunProviderFlowReceiving(chunkCount, accumulatedLength);
  }
  if (latestPhase === "response_received" && !completed) {
    return WORKBENCH.agentRunProviderFlowReceiving(chunkCount, accumulatedLength);
  }
  if (latestPhase === "request_dispatched" && !completed) {
    return WORKBENCH.agentRunProviderFlowDispatched;
  }
  if (latestPhase === "request_prepared" && !completed) {
    return WORKBENCH.agentRunProviderFlowPrepared;
  }
  if (latestEventType === "started" && !completed) return WORKBENCH.agentRunProviderFlowStarted;
  if (completed) return WORKBENCH.agentRunProviderFlowCompleted;

  return WORKBENCH.agentRunProviderFlowActive;
}

function providerFlowDetailItems({
  purposes,
  providerCallRefs,
  chunkCount,
  accumulatedLength,
  finalLength,
  totalTokens,
  models,
}: {
  purposes: string[];
  providerCallRefs: string[];
  chunkCount: number;
  accumulatedLength: number;
  finalLength: number;
  totalTokens: number;
  models: string[];
}): string[] {
  const details: string[] = [];
  if (purposes.length > 0)
    details.push(WORKBENCH.agentRunProviderFlowPurposes(purposes.join(" / ")));
  if (providerCallRefs.length > 0) {
    details.push(WORKBENCH.agentRunProviderFlowCalls(providerCallRefs.length, providerCallRefs[0]));
  }
  if (chunkCount > 0) details.push(WORKBENCH.agentRunProviderFlowChunks(chunkCount));
  if (accumulatedLength > 0) {
    details.push(WORKBENCH.agentRunProviderFlowReceivedLength(accumulatedLength));
  }
  if (finalLength > 0) details.push(WORKBENCH.agentRunProviderFlowResultLength(finalLength));
  if (totalTokens > 0) details.push(WORKBENCH.agentRunProviderFlowUsage(totalTokens));
  if (models.length > 0) details.push(WORKBENCH.agentRunProviderFlowModels(models.join(" / ")));

  return details;
}

function providerFlowPhases(
  providerEvents: AgentEventData[],
  providerRuns: AgentRunProviderUsageData[],
  state: {
    failed: boolean;
    cancelled: boolean;
    completed: boolean;
    latestEventType: string | null;
    latestPhase: string | null;
  },
): AgentRunProviderFlowPhase[] {
  const prepared = providerEvents.some(
    (event) =>
      stringPayloadValue(event.payload, "provider_progress_phase") === "request_prepared" ||
      hasReasonCode(event, "provider_request_prepared"),
  );
  const dispatched = providerEvents.some(
    (event) =>
      stringPayloadValue(event.payload, "provider_progress_phase") === "request_dispatched" ||
      hasReasonCode(event, "provider_request_dispatched"),
  );
  const receiving = providerEvents.some(
    (event) =>
      stringPayloadValue(event.payload, "provider_event_type") === "chunk" ||
      stringPayloadValue(event.payload, "provider_progress_phase") === "response_received" ||
      hasReasonCode(event, "provider_chunk") ||
      hasReasonCode(event, "provider_response_received"),
  );
  const finalized =
    state.completed ||
    state.failed ||
    state.cancelled ||
    providerRuns.some((run) => typeof run.status === "string" && run.status.trim() !== "");

  const terminalLabel =
    state.failed || state.cancelled
      ? WORKBENCH.agentRunProviderFlowPhaseLabels.boundary
      : WORKBENCH.agentRunProviderFlowPhaseLabels.finalized;

  return [
    providerFlowPhase(
      "prepared",
      WORKBENCH.agentRunProviderFlowPhaseLabels.prepared,
      prepared,
      state,
    ),
    providerFlowPhase(
      "dispatched",
      WORKBENCH.agentRunProviderFlowPhaseLabels.dispatched,
      dispatched,
      state,
    ),
    providerFlowPhase(
      "receiving",
      WORKBENCH.agentRunProviderFlowPhaseLabels.receiving,
      receiving,
      state,
    ),
    providerFlowPhase("finalized", terminalLabel, finalized, state),
  ];
}

function providerFlowPhase(
  key: string,
  label: string,
  reached: boolean,
  state: {
    failed: boolean;
    cancelled: boolean;
    completed: boolean;
    latestEventType: string | null;
    latestPhase: string | null;
  },
): AgentRunProviderFlowPhase {
  if (key === "finalized" && (state.failed || state.cancelled)) {
    return { key, label, status: reached ? "failed" : "pending" };
  }
  if (providerFlowPhaseActive(key, state)) return { key, label, status: "active" };
  return { key, label, status: reached ? "done" : "pending" };
}

function providerFlowPhaseActive(
  key: string,
  state: {
    failed: boolean;
    cancelled: boolean;
    completed: boolean;
    latestEventType: string | null;
    latestPhase: string | null;
  },
): boolean {
  if (state.completed || state.failed || state.cancelled) return false;
  if (key === "prepared") {
    return state.latestEventType === "started" || state.latestPhase === "request_prepared";
  }
  if (key === "dispatched") return state.latestPhase === "request_dispatched";
  if (key === "receiving") {
    return state.latestEventType === "chunk" || state.latestPhase === "response_received";
  }
  return false;
}

function providerChunkCount(chunkEvents: AgentEventData[]): number {
  const maxChunkIndex = maxNumbers(
    chunkEvents.map((event) => numberPayloadValue(event.payload, "chunk_index")),
  );

  return Math.max(chunkEvents.length, maxChunkIndex);
}

function providerFinalContentLength(
  providerEvents: AgentEventData[],
  providerRuns: AgentRunProviderUsageData[],
): number {
  if (providerRuns.length > 0) {
    return sumNumbers(
      providerRuns.map((run) =>
        typeof run.content_length === "number" && Number.isFinite(run.content_length)
          ? run.content_length
          : null,
      ),
    );
  }

  return sumNumbers(
    providerEvents
      .filter(
        (event) => stringPayloadValue(event.payload, "provider_event_type") === "final_output",
      )
      .map((event) => numberPayloadValue(event.payload, "content_length")),
  );
}

function providerTotalTokens(
  providerEvents: AgentEventData[],
  providerRuns: AgentRunProviderUsageData[],
): number {
  if (providerRuns.length > 0) {
    return sumNumbers(providerRuns.map(providerRunUsageTokens));
  }

  return sumNumbers(providerEvents.map((event) => providerUsageTokens(event.payload)));
}

function providerFlowCallRefs(
  providerEvents: AgentEventData[],
  providerRuns: AgentRunProviderUsageData[],
): string[] {
  return uniqueStrings([
    ...providerEvents.map((event) => stringPayloadValue(event.payload, "provider_call_ref")),
    ...providerRuns.map((run) =>
      typeof run.provider_call_ref === "string" && run.provider_call_ref.trim() !== ""
        ? run.provider_call_ref
        : null,
    ),
  ]);
}

function providerFlowPurposes(
  providerEvents: AgentEventData[],
  providerRuns: AgentRunProviderUsageData[],
): string[] {
  return uniqueStrings([
    ...providerEvents.map((event) =>
      labelForRecord(
        WORKBENCH.agentRunProviderPurposeLabels,
        stringPayloadValue(event.payload, "purpose"),
        null,
      ),
    ),
    ...providerRuns.map((run) =>
      labelForRecord(WORKBENCH.agentRunProviderPurposeLabels, run.purpose ?? null, null),
    ),
  ]);
}

function providerFlowFailed(
  eventTypes: string[],
  latestStatus: string | null,
  providerRuns: AgentRunProviderUsageData[],
): boolean {
  return (
    eventTypes.includes("error") ||
    latestStatus === "error" ||
    latestStatus === "failed" ||
    providerRuns.some((run) => run.status === "error" || run.status === "failed")
  );
}

function providerFlowCancelled(
  eventTypes: string[],
  latestStatus: string | null,
  providerRuns: AgentRunProviderUsageData[],
): boolean {
  return (
    eventTypes.includes("cancelled") ||
    latestStatus === "cancelled" ||
    providerRuns.some((run) => run.status === "cancelled")
  );
}

function providerFlowCompleted(
  eventTypes: string[],
  providerRuns: AgentRunProviderUsageData[],
): boolean {
  return (
    eventTypes.includes("final_output") ||
    providerRuns.some((run) => run.status === "ok" || run.status === "completed")
  );
}

function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => value !== null)));
}

function sumNumbers(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function maxNumbers(values: Array<number | null>): number {
  return values.reduce<number>((max, value) => Math.max(max, value ?? 0), 0);
}
