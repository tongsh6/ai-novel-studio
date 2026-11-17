import { WORKBENCH } from "./copy";
import type { AgentEventData } from "./socket";
import type { WireTurnResult } from "./turnResultWire";

// 运行事件只有一个客户端视图；HTTP activity 与 WS 都归并到它，消息回执不持有事件。
export function isAgentEventData(event: unknown): event is AgentEventData {
  return (
    Boolean(event) &&
    typeof event === "object" &&
    typeof (event as AgentEventData).event_id === "string" &&
    typeof (event as AgentEventData).run_ref === "string" &&
    typeof (event as AgentEventData).event_type === "string" &&
    typeof (event as AgentEventData).visibility === "string" &&
    typeof (event as AgentEventData).summary === "string" &&
    typeof (event as AgentEventData).sequence === "number"
  );
}

export function mergeAgentRunEvents(
  current: AgentEventData[],
  incoming: AgentEventData[],
): AgentEventData[] {
  const byId = new Map<string, AgentEventData>();
  for (const event of [...current, ...incoming]) byId.set(event.event_id, event);
  return Array.from(byId.values()).sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return (a.emitted_at ?? "").localeCompare(b.emitted_at ?? "");
  });
}

export function agentRunEventsFor(events: AgentEventData[], runId: string): AgentEventData[] {
  return events.filter((event) => event.run_ref === runId);
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
  streaming?: boolean;
}

export interface AgenticLoopReasoningFlow {
  planRef: string | null;
  planVersion: number | null;
  planSteps: AgenticLoopPlanStep[];
  narrativeEvents: AgenticLoopNarrativeEvent[];
}

function callSourceKey(runId: unknown, callRef: unknown): string | null {
  return typeof runId === "string" &&
    runId.trim() !== "" &&
    typeof callRef === "string" &&
    callRef.trim() !== ""
    ? JSON.stringify([runId, callRef])
    : null;
}

function deliveredNarrativeSources(results: ReadonlyArray<WireTurnResult>): Set<string> {
  const sources = new Set<string>();
  for (const result of results) {
    if (!result.assistant_message?.text) continue;
    const record = recordValue(result.trace_summary?.reply_record);
    if (record?.response_kind !== "plain_text") continue;
    const source = callSourceKey(result.agent_run?.run_id, record?.provider_call_ref);
    if (source !== null) sources.add(source);
  }
  return sources;
}

function deliveredNarrative(event: AgentEventData, delivered: ReadonlySet<string>): boolean {
  const key = callSourceKey(event.run_ref, event.payload?.provider_call_ref);
  return key !== null && delivered.has(key);
}

interface AgentRunDialogueStatusVisibility {
  status?: string | null;
  runMode?: string | null;
  triggerKind?: string | null;
  narrativeCount: number;
  planStepCount: number;
  pendingArtifactCount: number;
  draftCharCount?: number | null;
}

export function shouldShowAgentRunDialogueStatus({
  status,
  runMode,
  triggerKind,
  narrativeCount,
  planStepCount,
  pendingArtifactCount,
  draftCharCount,
}: AgentRunDialogueStatusVisibility): boolean {
  if (status !== "completed") return true;

  return (
    narrativeCount > 0 ||
    planStepCount > 0 ||
    pendingArtifactCount > 0 ||
    (draftCharCount ?? 0) > 0 ||
    runMode === "durable" ||
    triggerKind === "author_action"
  );
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

export function agentRunReasoningFlow(
  events: AgentEventData[],
  deliveredResults: ReadonlyArray<WireTurnResult> = [],
): AgenticLoopReasoningFlow {
  const delivered = deliveredNarrativeSources(deliveredResults);
  const reasoningEvents = events
    .filter(isAgenticLoopReasoningEvent)
    .sort((a, b) => a.sequence - b.sequence);
  const streamedEvents = streamedAuthorReasoningEvents(
    events,
    boundReasoningProviderRuns(reasoningEvents),
    delivered,
  );
  const narrativeEvents = [
    ...streamedEvents,
    ...narrativeEventsFromReasoning(reasoningEvents),
  ].sort((a, b) => a.sequence - b.sequence);
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

export type AgenticLoopActivityKind = "drafting" | "reading" | "working" | "reasoning";

// 模型调用窗口：provider_started 之后同 call_ref 未见终态（final_output/error/
// cancelled）即视为 AI 接口执行中。事实驱动，不是假占位。
function hasActiveProviderCall(ordered: AgentEventData[]): boolean {
  const open = new Set<string>();

  for (const event of ordered) {
    if (event.event_type !== "provider_progress") continue;
    const callRef =
      stringPayloadValue(event.payload, "provider_call_ref") ??
      stringPayloadValue(event.payload, "provider_run_ref") ??
      event.event_id;
    const reasons = Array.isArray(event.reason_codes) ? event.reason_codes : [];
    if (reasons.includes("provider_started")) open.add(callRef);
    if (
      reasons.some((code) =>
        ["provider_final_output", "provider_error", "provider_cancelled"].includes(String(code)),
      )
    ) {
      open.delete(callRef);
    }
  }

  return open.size > 0;
}

export function activeToolActivity(events: AgentEventData[]): AgenticLoopActivityKind | null {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let active: AgentEventData | null = null;
  let terminal = false;

  for (const event of ordered) {
    if (event.event_type === "tool_started") active = event;
    if (["tool_completed", "tool_failed"].includes(event.event_type)) active = null;
    if (["run_completed", "run_failed", "run_cancelled"].includes(event.event_type)) {
      active = null;
      terminal = true;
    }
  }

  if (terminal) return null;

  if (active) {
    const toolName = stringPayloadValue(active.payload, "tool_name") ?? "";
    return READING_TOOL_NAMES.has(toolName) ? "reading" : toolName ? "drafting" : "working";
  }

  // 工具窗口之外：AI 接口调用进行中（计划结构化、回应生成、模型思考期）。
  return hasActiveProviderCall(ordered) ? "reasoning" : null;
}

function isAgenticLoopReasoningEvent(event: AgentEventData): boolean {
  if (event.visibility !== "author") return false;

  if (
    ![
      "plan_drafted",
      "plan_revised",
      "exploration_observed",
      "evaluation_made",
      "mission_derived",
    ].includes(event.event_type)
  ) {
    return false;
  }
  if (stringPayloadValue(event.payload, "author_narrative") !== null) return true;
  // 判断纪元探索观察（ADR-0025 CP5a）：机械检索的结构词摘要（无模型叙事，
  // N-NARR 叙事族不适用），以事件 summary 渲染探索状态行。
  return event.event_type === "exploration_observed" && typeof event.summary === "string";
}

function narrativeEventsFromReasoning(events: AgentEventData[]): AgenticLoopNarrativeEvent[] {
  return events.map((event) => ({
    key: event.event_id,
    eventType: event.event_type,
    label: WORKBENCH.agenticLoopEventLabels[event.event_type] ?? event.event_type,
    narrative: rawStringPayloadValue(event.payload, "author_narrative") ?? event.summary ?? "",
    sequence: event.sequence,
  }));
}

function streamSourceKey(event: AgentEventData): string {
  return JSON.stringify([
    event.run_ref,
    stringPayloadValue(event.payload, "provider_run_ref") ??
      stringPayloadValue(event.payload, "provider_call_ref") ??
      event.event_id,
  ]);
}

function streamedAuthorReasoningEvents(
  events: AgentEventData[],
  boundProviderRunRefs: Set<string>,
  delivered: ReadonlySet<string>,
): AgenticLoopNarrativeEvent[] {
  const ended = new Set(
    events
      .filter(
        (event) =>
          event.event_type === "provider_progress" &&
          (event.reason_codes ?? []).some((code) =>
            ["provider_final_output", "provider_error", "provider_cancelled"].includes(code),
          ),
      )
      .map(streamSourceKey),
  );
  const groups = new Map<string, { sequence: number; parts: string[] }>();
  for (const event of events
    .filter(isAuthorReasoningDeltaEvent)
    .sort((a, b) => a.sequence - b.sequence)) {
    const groupKey = streamSourceKey(event);
    if (boundProviderRunRefs.has(groupKey) || deliveredNarrative(event, delivered)) continue;
    const delta = rawStringPayloadValue(event.payload, "author_narrative_delta");
    if (delta === null) continue;
    const group = groups.get(groupKey) ?? { sequence: event.sequence, parts: [] };
    group.parts.push(delta);
    groups.set(groupKey, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key: `stream:${key}`,
      eventType: "provider_progress",
      label: WORKBENCH.agenticLoopEventLabels.provider_progress ?? "推理",
      narrative: group.parts.join(""),
      sequence: group.sequence,
      streaming: !ended.has(key),
    }))
    .filter((event) => event.narrative.trim() !== "");
}

export interface AgentRunProseStream {
  /** 已到达的正文增量拼接结果（作者可见预览，未保存）。 */
  text: string;
  /** 是否仍在生成（run 非终态且已有正文增量）。 */
  active: boolean;
  key: string | null;
}

/**
 * 正文流式预览（B71 / 双向审核：正文 token 流开放）：
 * 写作类 Provider 的 JSON 流经后端 `AuthorProseStream` 提取出 `author_content_delta`，
 * 这里按事件顺序累加成作者可见的正文预览；终态 run 不再标记「生成中」。
 */
export function agentRunProseStream(
  events: AgentEventData[],
  runStatus?: string | null,
): AgentRunProseStream {
  const relevant = events.filter(isAuthorContentDeltaEvent).sort((a, b) => a.sequence - b.sequence);

  const parts = relevant
    .map((event) => rawStringPayloadValue(event.payload, "author_content_delta"))
    .filter((delta): delta is string => delta !== null);

  const text = parts.join("");
  const terminal = ["completed", "failed", "cancelled"].includes(String(runStatus ?? ""));

  return {
    text,
    active: text.trim() !== "" && runStatus !== undefined && !terminal,
    key: relevant.at(-1)?.event_id ?? null,
  };
}

function isAuthorContentDeltaEvent(event: AgentEventData): boolean {
  return (
    event.event_type === "provider_progress" &&
    rawStringPayloadValue(event.payload, "author_content_delta") !== null
  );
}

function isAuthorReasoningDeltaEvent(event: AgentEventData): boolean {
  if (event.visibility !== "author") return false;

  return (
    event.event_type === "provider_progress" &&
    rawStringPayloadValue(event.payload, "author_narrative_delta") !== null
  );
}

function boundReasoningProviderRuns(events: AgentEventData[]): Set<string> {
  const refs = new Set<string>();

  events.forEach((event) => {
    const source = recordValue(event.payload?.author_narrative_source);
    if (source?.source_type !== "provider_output") return;
    const providerRunRef = stringRecordValue(source, "provider_run_ref");
    if (providerRunRef) refs.add(JSON.stringify([event.run_ref, providerRunRef]));
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
