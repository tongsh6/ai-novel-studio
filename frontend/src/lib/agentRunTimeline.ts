import { WORKBENCH } from "./copy";
import type { AgentEventData } from "./socket";

export interface AgentRunExecutionBrief {
  path: string;
  facts: string[];
}

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

function stringPayloadValue(payload: Record<string, unknown> | undefined, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberPayloadValue(payload: Record<string, unknown> | undefined, key: string): number | null {
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

function providerUsageTokens(payload: Record<string, unknown> | undefined): number | null {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return null;

  const record = usage as Record<string, unknown>;
  for (const key of ["total_tokens", "total", "tokens"]) {
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringRecordValue(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberRecordValue(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringListValue(record: Record<string, unknown> | null | undefined, key: string): string[] {
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

  if (contextRefCount !== null) details.push(WORKBENCH.agentRunDetailContextRefs(contextRefCount));
  if (frameType) details.push(WORKBENCH.agentRunDetailFrameType(frameType));
  if (needsTool !== null) details.push(WORKBENCH.agentRunDetailNeedsTool(needsTool));
  if (candidateCount !== null) details.push(WORKBENCH.agentRunDetailCandidateCount(candidateCount));
  if (planRef) details.push(WORKBENCH.agentRunDetailPlanRef(planRef));
  if (actionCount !== null) details.push(WORKBENCH.agentRunDetailActionCount(actionCount));
  if (decisionRef) details.push(WORKBENCH.agentRunDetailDecisionRef(decisionRef));
  if (decisionType) details.push(WORKBENCH.agentRunDetailDecisionType(decisionType));
  if (firstBlockingGate) details.push(WORKBENCH.agentRunDetailBlockingGate(firstBlockingGate));

  return details;
}

export function agentRunExecutionBrief(
  events: AgentEventData[],
  providerRuns: AgentRunProviderUsageData[] = [],
): AgentRunExecutionBrief | null {
  const authorEvents = events
    .filter((event) => event.visibility === "author" && event.summary.trim() !== "")
    .sort((a, b) => a.sequence - b.sequence);
  if (authorEvents.length === 0) return null;

  const path = briefPath(authorEvents);
  const facts = briefFacts(authorEvents, providerRuns);
  if (path.length === 0 && facts.length === 0) return null;

  return {
    path: WORKBENCH.agentRunBriefPath(path.join(" → ")),
    facts,
  };
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
    providerRuns.map((run) => (typeof run.model === "string" && run.model.trim() !== "" ? run.model : null)),
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
  const contentLength =
    typeof run.content_length === "number" && Number.isFinite(run.content_length)
      ? run.content_length
      : null;

  if (purpose) details.push(WORKBENCH.agentRunDetailProviderPurpose(purpose));
  if (run.status) details.push(WORKBENCH.agentRunDetailProviderStatus(run.status));
  if (run.output_type) details.push(WORKBENCH.agentRunDetailProviderOutputType(run.output_type));
  if (run.provider_run_ref) details.push(WORKBENCH.agentRunDetailProviderRunRef(run.provider_run_ref));
  if (run.provider_call_ref) {
    details.push(WORKBENCH.agentRunDetailProviderCallRef(run.provider_call_ref));
  }
  if (contentLength !== null) {
    details.push(WORKBENCH.agentRunDetailProviderContentLength(contentLength));
  }
  if (tokens !== null) details.push(WORKBENCH.agentRunDetailProviderUsage(tokens));
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
    stringRecordValue(payload, "provider_call_ref") ?? stringRecordValue(event, "provider_call_ref");
  const contentLength = numberRecordValue(payload, "content_length");
  const chunkIndex = numberRecordValue(payload, "chunk_index");
  const accumulatedContentLength = numberRecordValue(payload, "accumulated_content_length");
  const usageTokens = providerUsageTokens(payload ?? undefined);
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
  const refs = stringListValue(output, "refs");
  const finalizedAt = stringRecordValue(output, "finalized_at");

  const details: string[] = [];
  if (status) details.push(WORKBENCH.agentRunDetailProviderStatus(status));
  if (outputType) details.push(WORKBENCH.agentRunDetailProviderOutputType(outputType));
  if (contentLength !== null) {
    details.push(WORKBENCH.agentRunDetailProviderContentLength(contentLength));
  }
  if (tokens !== null) details.push(WORKBENCH.agentRunDetailProviderUsage(tokens));
  if (refs.length > 0) details.push(WORKBENCH.agentRunProviderReplayRefs(refs.join(", ")));
  if (finalizedAt) details.push(WORKBENCH.agentRunProviderReplayFinalizedAt(finalizedAt));

  return details.length > 0 ? details : [WORKBENCH.agentRunProviderReplayNoOutput];
}

function briefPath(events: AgentEventData[]): string[] {
  const path: string[] = [];
  const labels = WORKBENCH.agentRunBriefPathLabels;
  let sawDialogueFrame = false;
  let sawMicroPlan = false;
  let sawToolExecution = false;
  let activeToolName: string | null = null;
  let latestArtifactLabel: string | null = null;

  for (const event of events) {
    const providerEventType = stringPayloadValue(event.payload, "provider_event_type");
    const stage = stringPayloadValue(event.payload, "stage");
    const toolName = stringPayloadValue(event.payload, "tool_name");

    if (isTerminalEvent(event)) continue;
    latestArtifactLabel = artifactPathLabelFromObservation(event.summary) ?? latestArtifactLabel;

    if (isContextEvent(event, stage)) {
      pushPath(path, labels.context);
      continue;
    }

    if (isProviderStartEvent(event, providerEventType, stage)) {
      pushPath(path, providerStartLabel(event, sawDialogueFrame, sawMicroPlan));
      continue;
    }

    if (isDialogueFrameEvent(event, stage)) {
      pushPath(path, labels.modelJudgment);
      sawDialogueFrame = true;
      continue;
    }

    if (isMicroPlanEvent(event, stage)) {
      pushPath(path, labels.planCreated);
      sawMicroPlan = true;
      continue;
    }

    if (isGateEvent(event)) {
      pushPath(path, labels.systemGate);
      continue;
    }

    if (isToolExecutionEvent(event)) {
      activeToolName = toolName ?? activeToolName;
      latestArtifactLabel = artifactPathLabelForTool(activeToolName) ?? latestArtifactLabel;
      if (!sawToolExecution) pushPath(path, toolExecutionPathLabel(activeToolName));
      sawToolExecution = true;
      if (isQualityReviewEvent(event)) pushPath(path, labels.qualityReview);
      continue;
    }

    if (isQualityReviewEvent(event)) {
      pushPath(path, labels.qualityReview);
      continue;
    }

    if (event.event_type === "artifact_created") {
      if (!sawToolExecution) {
        pushPath(path, toolExecutionPathLabel(activeToolName));
        sawToolExecution = true;
      }
      pushPath(path, latestArtifactLabel ?? labels.tentativeArtifact);
    }
  }

  const terminal = terminalPathLabel(events);
  if (terminal) pushPath(path, terminal);

  return path;
}

function toolExecutionPathLabel(toolName: string | null): string {
  const labels = WORKBENCH.agentRunBriefPathLabels;

  if (toolName === "plot_outline") return labels.plotOutlineTool;
  if (toolName === "character_evolution") return labels.characterEvolutionTool;

  return labels.toolExecution;
}

function artifactPathLabelForTool(toolName: string | null): string | null {
  const labels = WORKBENCH.agentRunBriefPathLabels;

  if (toolName === "plot_outline") return labels.plotOutlineArtifact;
  if (toolName === "character_evolution") return labels.characterEvolutionArtifact;

  return null;
}

function artifactPathLabelFromObservation(summary: string): string | null {
  const labels = WORKBENCH.agentRunBriefPathLabels;

  if (summary.includes("大纲草稿")) return labels.plotOutlineArtifact;
  if (summary.includes("角色演化记忆草稿")) return labels.characterEvolutionArtifact;

  return null;
}

function isContextEvent(event: AgentEventData, stage: string | null): boolean {
  if (stage === "context_assembled" || stage?.endsWith("_context_assembled")) return true;
  if (event.event_type === "goal_understood") return true;
  if (event.event_type !== "step_proposed") return false;

  return (
    event.summary.includes("读取") &&
    (event.summary.includes("上下文") ||
      event.summary.includes("角色阵容") ||
      event.summary.includes("作品档案"))
  );
}

function isProviderStartEvent(
  event: AgentEventData,
  providerEventType: string | null,
  stage: string | null,
): boolean {
  if (event.event_type !== "provider_progress") return false;

  return (
    providerEventType === "started" ||
    stage === "provider_call_started" ||
    hasReasonCode(event, "provider_call_started")
  );
}

function providerStartLabel(
  event: AgentEventData,
  sawDialogueFrame: boolean,
  sawMicroPlan: boolean,
): string {
  const purpose = stringPayloadValue(event.payload, "purpose");
  const labels = WORKBENCH.agentRunBriefPathLabels;

  if (purpose === "conversation") {
    return sawDialogueFrame && !sawMicroPlan
      ? labels.providerPlanning
      : labels.providerConversation;
  }
  if (purpose === "planner") return labels.providerAgentPlanner;
  if (purpose === "writer") return labels.providerWriter;
  if (purpose === "evaluator") return labels.providerEvaluator;
  if (purpose === "revision") return labels.providerRevision;
  if (purpose === "tool") return labels.providerTool;
  if (purpose === "narration") return labels.providerNarration;

  return labels.providerOther;
}

function isDialogueFrameEvent(event: AgentEventData, stage: string | null): boolean {
  return (
    stage === "dialogue_frame_formed" ||
    (event.event_type === "plan_created" && stringPayloadValue(event.payload, "frame_type") !== null)
  );
}

function isMicroPlanEvent(event: AgentEventData, stage: string | null): boolean {
  return (
    stage === "micro_plan_created" ||
    stage === "revision_micro_plan_created" ||
    hasReasonCode(event, "micro_plan_created") ||
    hasReasonCode(event, "revision_micro_plan_created") ||
    (event.event_type === "plan_created" && stringPayloadValue(event.payload, "plan_ref") !== null)
  );
}

function isGateEvent(event: AgentEventData): boolean {
  return (
    event.event_type === "gate_decided" ||
    stringPayloadValue(event.payload, "decision_type") !== null
  );
}

function isToolExecutionEvent(event: AgentEventData): boolean {
  if (event.event_type === "tool_started" || event.event_type === "tool_completed") return true;
  if (stringPayloadValue(event.payload, "tool_name") !== null) return true;
  return false;
}

function isQualityReviewEvent(event: AgentEventData): boolean {
  return (
    event.event_type === "quality_review_started" ||
    event.event_type === "quality_finding_created" ||
    hasReasonCode(event, "quality_review_completed") ||
    stringPayloadValue(event.payload, "review_status") !== null ||
    numberPayloadValue(event.payload, "finding_count") !== null
  );
}

function isTerminalEvent(event: AgentEventData): boolean {
  return ["turn_result_ready", "run_completed", "run_cancelled", "run_failed"].includes(
    event.event_type,
  );
}

function terminalPathLabel(events: AgentEventData[]): string | null {
  const labels = WORKBENCH.agentRunBriefPathLabels;
  const terminal = [...events].reverse().find(isTerminalEvent);
  if (!terminal) return null;
  if (terminal.event_type === "run_cancelled") return labels.cancelled;
  if (terminal.event_type === "run_failed") return labels.failed;
  return labels.response;
}

function hasReasonCode(event: AgentEventData, reasonCode: string): boolean {
  return (event.reason_codes ?? []).includes(reasonCode);
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
  if (purposes.length > 0) details.push(WORKBENCH.agentRunProviderFlowPurposes(purposes.join(" / ")));
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
    providerFlowPhase("prepared", WORKBENCH.agentRunProviderFlowPhaseLabels.prepared, prepared, state),
    providerFlowPhase("dispatched", WORKBENCH.agentRunProviderFlowPhaseLabels.dispatched, dispatched, state),
    providerFlowPhase("receiving", WORKBENCH.agentRunProviderFlowPhaseLabels.receiving, receiving, state),
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
      .filter((event) => stringPayloadValue(event.payload, "provider_event_type") === "final_output")
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

function briefFacts(events: AgentEventData[], providerRuns: AgentRunProviderUsageData[]): string[] {
  if (providerRuns.length > 0) return providerRunFacts(providerRuns);

  const providerEvents = events.filter((event) => event.event_type === "provider_progress");
  const providerCallRefs = uniqueStrings(
    providerEvents.map((event) => stringPayloadValue(event.payload, "provider_call_ref")),
  );
  const finalOutputEvents = providerEvents.filter(
    (event) => stringPayloadValue(event.payload, "provider_event_type") === "final_output",
  );
  const totalChars = sumNumbers(
    finalOutputEvents.map((event) => numberPayloadValue(event.payload, "content_length")),
  );
  const totalTokens = sumNumbers(providerEvents.map((event) => providerUsageTokens(event.payload)));

  const facts: string[] = [];
  if (providerCallRefs.length > 0) {
    facts.push(WORKBENCH.agentRunBriefProviderCalls(providerCallRefs.length));
    facts.push(WORKBENCH.agentRunBriefProviderCallRef(providerCallRefs[0]));
  }
  if (totalChars > 0) facts.push(WORKBENCH.agentRunBriefProviderChars(totalChars));
  if (totalTokens > 0) facts.push(WORKBENCH.agentRunBriefProviderTokens(totalTokens));

  return facts;
}

function providerRunFacts(providerRuns: AgentRunProviderUsageData[]): string[] {
  const providerCallRefs = uniqueStrings(
    providerRuns.map((run) => (typeof run.provider_call_ref === "string" ? run.provider_call_ref : null)),
  );
  const totalChars = sumNumbers(
    providerRuns.map((run) =>
      typeof run.content_length === "number" && Number.isFinite(run.content_length)
        ? run.content_length
        : null,
    ),
  );
  const totalTokens = sumNumbers(
    providerRuns.map((run) => providerUsageTokens(run as Record<string, unknown>)),
  );

  const facts: string[] = [];
  if (providerCallRefs.length > 0) {
    facts.push(WORKBENCH.agentRunBriefProviderCalls(providerCallRefs.length));
    facts.push(WORKBENCH.agentRunBriefProviderCallRef(providerCallRefs[0]));
  }
  if (totalChars > 0) facts.push(WORKBENCH.agentRunBriefProviderChars(totalChars));
  if (totalTokens > 0) facts.push(WORKBENCH.agentRunBriefProviderTokens(totalTokens));

  return facts;
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

function pushPath(path: string[], item: string) {
  if (path.at(-1) !== item) path.push(item);
}
