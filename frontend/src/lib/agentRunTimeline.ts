import { WORKBENCH } from "./copy";
import type { AgentEventData } from "./socket";

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
  planRef: string | null;
  planVersion: number | null;
  planSteps: AgenticLoopPlanStep[];
  narrativeEvents: AgenticLoopNarrativeEvent[];
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
  return {
    planRef: latestPlanEvent ? stringPayloadValue(latestPlanEvent.payload, "plan_ref") : null,
    planVersion: latestPlanEvent
      ? numberPayloadValue(latestPlanEvent.payload, "plan_version")
      : null,
    planSteps: latestPlanEvent ? planStepsFromPayload(latestPlanEvent.payload) : [],
    narrativeEvents,
  };
}

// 46§9.4.4：活动行仅承担进行中指示。最后一个 tool_started 之后若没有对应的
// tool_completed / tool_failed，视为有进行中的工具动作；文案按工具类别取结构词
//（不叙述、不复述完成动作）。
const READING_TOOL_NAMES = new Set([
  "character_roster",
  "context_assemble",
  "readonly_batch",
  "work_profile",
]);

export type AgenticLoopActivityKind = "drafting" | "reading" | "working";

export function activeToolActivity(events: AgentEventData[]): AgenticLoopActivityKind | null {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let active: AgentEventData | null = null;

  for (const event of ordered) {
    if (event.event_type === "tool_started") active = event;
    if (["tool_completed", "tool_failed", "run_completed", "run_failed", "run_cancelled"].includes(
      event.event_type,
    )) {
      active = null;
    }
  }

  if (!active) return null;
  const toolName = stringPayloadValue(active.payload, "tool_name") ?? "";
  return READING_TOOL_NAMES.has(toolName) ? "reading" : toolName ? "drafting" : "working";
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




























