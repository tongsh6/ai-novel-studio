export interface AgentRunAnchorMessage<TurnResultShape = unknown> {
  role: "user" | "assistant";
  text: string;
  turnId?: string | null;
  clientMessageId?: string;
  agentRunId?: string | null;
  turnResult?: TurnResultShape;
}

export interface AgentRunAnchorTurnResult {
  turn_id: string;
  parent_turn_id?: string | null;
  assistant_message?: { text?: string };
  agent_run?: {
    run_id?: string | null;
    parent_turn_ref?: string | null;
  };
}

export interface AgentRunAnchorAck {
  run_id?: string;
  turn_id?: string;
}

export interface AgentRunAnchorState {
  run_id: string;
  parent_turn_ref?: string | null;
  trigger?: {
    kind?: string | null;
    source_turn_ref?: string | null;
  } | null;
}

export interface AgentRunRuntimeStateLike {
  status: string;
}

export interface QualityRevisionArtifactLike {
  artifact_id: string;
  artifact_type: string;
  revision_base?: string | null;
}

export interface QualityRevisionTurnResultLike {
  trace_summary?: Record<string, unknown>;
  ui_cards?: Array<{
    artifact_refs?: string[];
    revision_of?: string | null;
  }>;
  agent_run?: {
    trigger?: {
      action_type?: string | null;
    } | null;
  } | null;
  adoption_state?: {
    pending?: Array<{ artifact_id?: string }>;
  };
  available_actions?: Array<{
    action_type?: string;
    target_ref?: string;
  }>;
  quality_review?: {
    findings?: unknown[];
  };
}

export function selectAgentRunActivitySummary<T extends { run_id?: unknown }>(
  agentRuns: T[],
  runId: string | null,
): T | null {
  if (runId !== null) {
    return agentRuns.find((entry) => normalizedString(entry.run_id) === runId) ?? null;
  }

  return agentRuns[0] ?? null;
}

export function qualityRevisionArtifactRole(
  turnResult: QualityRevisionTurnResultLike,
  artifact: QualityRevisionArtifactLike | null,
): "original" | "revision" | null {
  if (
    !artifact ||
    !["prose_fragment", "scene_draft"].includes(artifact.artifact_type)
  ) {
    return null;
  }

  if (normalizedString(artifact.revision_base)) return "revision";
  if (normalizedString(turnResult.trace_summary?.revision_base)) return "revision";

  const revisionCardMatches = (turnResult.ui_cards ?? []).some((card) => {
    const artifactRefs = Array.isArray(card.artifact_refs) ? card.artifact_refs : [];
    return (
      normalizedString(card.revision_of) !== null &&
      artifactRefs.includes(artifact.artifact_id)
    );
  });
  if (revisionCardMatches) return "revision";

  const trigger = turnResult.agent_run?.trigger;
  const artifactIsPending = (turnResult.adoption_state?.pending ?? []).some(
    (pending) => pending.artifact_id === artifact.artifact_id,
  );
  if (trigger?.action_type === "revise_from_findings" && artifactIsPending) return "revision";

  const exposesRevisionAction = (turnResult.available_actions ?? []).some(
    (action) =>
      action.action_type === "revise_from_findings" && action.target_ref === artifact.artifact_id,
  );
  if (exposesRevisionAction) return "original";

  if ((turnResult.quality_review?.findings?.length ?? 0) > 0) return "original";
  return null;
}

const TERMINAL_AGENT_RUN_STATUSES = new Set(["completed", "cancelled", "failed"]);

function normalizedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function turnResultAgentRunId(turnResult: AgentRunAnchorTurnResult | undefined): string | null {
  return normalizedString(turnResult?.agent_run?.run_id);
}

export function assistantMessageTextForAgentRun(
  messages: readonly AgentRunAnchorMessage<AgentRunAnchorTurnResult>[],
  runId: string | null,
): string | undefined {
  if (runId === null) return undefined;

  const texts = Array.from(
    new Set(
      messages
        .filter(
          (message) =>
            message.role === "assistant" && turnResultAgentRunId(message.turnResult) === runId,
        )
        .map((message) => message.text.trim())
        .filter((text) => text !== ""),
    ),
  );

  return texts.length > 0 ? texts.join("\n\n") : undefined;
}

function turnResultParentTurnId(
  turnResult: AgentRunAnchorTurnResult,
  messages: AgentRunAnchorMessage<AgentRunAnchorTurnResult>[],
): string | null {
  const explicitParent = normalizedString(turnResult.parent_turn_id);
  if (explicitParent) return explicitParent;

  const agentRunParent = normalizedString(turnResult.agent_run?.parent_turn_ref);
  if (agentRunParent) return agentRunParent;

  const runId = turnResultAgentRunId(turnResult);
  if (runId) {
    const parentMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user" && message.agentRunId === runId);
    if (parentMessage?.turnId) return parentMessage.turnId;
  }

  const turnId = normalizedString(turnResult.turn_id);
  const agentMarker = ":agent:";
  if (turnId?.includes(agentMarker)) return turnId.slice(0, turnId.indexOf(agentMarker));

  return null;
}

export function bindAgentRunAckToUserMessage<Message extends AgentRunAnchorMessage>(
  messages: Message[],
  response: AgentRunAnchorAck,
  clientMessageId: string | null,
): Message[] {
  if (!response.run_id && !response.turn_id) return messages;

  const index = [...messages]
    .reverse()
    .findIndex(
      (message) =>
        message.role === "user" &&
        (clientMessageId
          ? message.clientMessageId === clientMessageId
          : !message.turnId && !message.agentRunId),
    );
  if (index < 0) return messages;

  const actualIndex = messages.length - 1 - index;
  return messages.map((message, messageIndex) =>
    messageIndex === actualIndex
      ? {
          ...message,
          turnId: response.turn_id ?? message.turnId ?? null,
          agentRunId: response.run_id ?? message.agentRunId ?? null,
        }
      : message,
  );
}

export function upsertAssistantTurnResultMessage<
  TurnResultShape extends AgentRunAnchorTurnResult,
  Message extends AgentRunAnchorMessage<TurnResultShape>,
>(messages: Message[], turnResult: TurnResultShape): Message[] {
  const assistantMessage = {
    role: "assistant" as const,
    text: turnResult.assistant_message?.text ?? "",
    turnId: turnResult.turn_id,
    agentRunId: turnResultAgentRunId(turnResult),
    turnResult,
  } as Message;
  const existingIndex = messages.findIndex(
    (message) => message.turnResult?.turn_id === turnResult.turn_id,
  );
  if (existingIndex >= 0) {
    const updated = messages.map((message, index) =>
      index === existingIndex ? assistantMessage : message,
    );
    const runId = turnResultAgentRunId(turnResult);
    const latestSteerIndex =
      runId === null
        ? -1
        : updated.findLastIndex(
            (message) => message.role === "user" && message.agentRunId === runId,
          );

    if (latestSteerIndex <= existingIndex) return updated;

    const withoutAssistant = updated.filter((_message, index) => index !== existingIndex);
    const adjustedSteerIndex = latestSteerIndex - 1;

    return [
      ...withoutAssistant.slice(0, adjustedSteerIndex + 1),
      assistantMessage,
      ...withoutAssistant.slice(adjustedSteerIndex + 1),
    ];
  }

  const parentTurnId = turnResultParentTurnId(turnResult, messages);
  const agentRunId = turnResultAgentRunId(turnResult);

  // 插入点 = 父 turn 消息链的最后一条：包括父 turn 的用户消息、同 turn 的
  // 既有 assistant 消息（如带候选卡/确认卡的 turn_result），以及先到的兄弟
  // 子结果（同 parent 的 action 子 turn）。只锚定用户消息会把 action 子结果
  // 插进「用户消息与 assistant 卡片之间」，落在长卡片上方的视野外（stage
  // 2026-07-05 choose_candidate「没有反应」事故的根因）。
  let anchorIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const messageParentTurnId = normalizedString(message.turnResult?.parent_turn_id);
    const belongsToParentTurn =
      parentTurnId !== null &&
      (message.turnId === parentTurnId ||
        message.turnResult?.turn_id === parentTurnId ||
        messageParentTurnId === parentTurnId);
    const anchorsSameAgentRun =
      agentRunId !== null && message.role === "user" && message.agentRunId === agentRunId;
    if (belongsToParentTurn || anchorsSameAgentRun) anchorIndex = index;
  }
  if (anchorIndex < 0) return [...messages, assistantMessage];

  return [
    ...messages.slice(0, anchorIndex + 1),
    assistantMessage,
    ...messages.slice(anchorIndex + 1),
  ];
}

export function messageAnchorsAgentRun(
  message: AgentRunAnchorMessage,
  run: AgentRunAnchorState,
): boolean {
  if (message.role === "user") {
    if (run.trigger?.kind === "author_action") return false;
    if (message.agentRunId && message.agentRunId === run.run_id) return true;
    return Boolean(message.turnId && run.parent_turn_ref && message.turnId === run.parent_turn_ref);
  }

  const sourceTurnRef = normalizedString(run.trigger?.source_turn_ref);
  if (run.trigger?.kind !== "author_action" || sourceTurnRef === null) return false;

  const turnResult = message.turnResult as AgentRunAnchorTurnResult | undefined;
  return (
    normalizedString(message.turnId) === sourceTurnRef ||
    normalizedString(turnResult?.turn_id) === sourceTurnRef
  );
}

export function shouldRenderUserAgentRunPlaceholder(
  message: AgentRunAnchorMessage,
  opts: {
    anchoredRun: AgentRunAnchorState | null;
    agentRunIdsRenderedInTurns: Set<string>;
    hasPendingAnchor: boolean;
  },
): boolean {
  if (message.role !== "user") return false;
  if (opts.anchoredRun !== null) return false;
  if (opts.hasPendingAnchor) return true;

  const agentRunId = normalizedString(message.agentRunId);
  return agentRunId !== null && !opts.agentRunIdsRenderedInTurns.has(agentRunId);
}

export function shouldRenderAnchoredAgentRunStatus<
  Run extends AgentRunAnchorState & AgentRunRuntimeStateLike,
>(
  run: Run | null,
  opts: {
    agentRunIdsRenderedInTurns: Set<string>;
    messageIsLatest: boolean;
  },
): boolean {
  if (run === null) return false;
  if (!opts.agentRunIdsRenderedInTurns.has(run.run_id)) return true;

  return opts.messageIsLatest;
}

export function shouldRenderStandaloneAgentRunStatus<
  Run extends AgentRunAnchorState & AgentRunRuntimeStateLike,
>(
  run: Run | null,
  latestMessage: AgentRunAnchorMessage | undefined,
  opts: {
    agentRunIdsRenderedInTurns: Set<string>;
    hasMessageAnchor: boolean;
  },
): boolean {
  if (run === null) return false;
  const runIsTerminal = TERMINAL_AGENT_RUN_STATUSES.has(run.status);
  const latestUserMessageDoesNotAnchorRun =
    latestMessage?.role === "user" && !messageAnchorsAgentRun(latestMessage, run);

  if (opts.agentRunIdsRenderedInTurns.has(run.run_id)) {
    return !runIsTerminal && latestUserMessageDoesNotAnchorRun;
  }

  if (!opts.hasMessageAnchor) return true;
  if (runIsTerminal) return false;

  return latestUserMessageDoesNotAnchorRun;
}

export function mergeAgentRunRuntimeState<State extends AgentRunRuntimeStateLike>(
  previous: State | undefined,
  incoming: State,
): State {
  if (!previous) return incoming;

  const previousIsTerminal = TERMINAL_AGENT_RUN_STATUSES.has(previous.status);
  const incomingIsTerminal = TERMINAL_AGENT_RUN_STATUSES.has(incoming.status);

  if (previousIsTerminal && !incomingIsTerminal) return previous;

  return { ...previous, ...incoming };
}

export type AgentRunRuntimeAuthority = "live" | "dead" | "unknown";

// DS03：历史 TurnResult 只是可读快照，不授予实时命令权限。命令权限的唯一真源是
// 服务端 agent_run_state 帧中的 runtime_live——true 为 live，false 为已失活，
// 缺失（仅历史快照、或 join 恢复尚未完成）时为 unknown，一律不给可提交动作。
export function agentRunRuntimeAuthority(
  run: { runtime_live?: boolean | null } | null | undefined,
): AgentRunRuntimeAuthority {
  if (!run) return "unknown";
  if (run.runtime_live === true) return "live";
  if (run.runtime_live === false) return "dead";
  return "unknown";
}
