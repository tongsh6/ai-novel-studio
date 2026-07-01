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
}

export interface AgentRunRuntimeStateLike {
  status: string;
}

const TERMINAL_AGENT_RUN_STATUSES = new Set(["completed", "cancelled", "failed"]);

function normalizedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function turnResultAgentRunId(turnResult: AgentRunAnchorTurnResult | undefined): string | null {
  return normalizedString(turnResult?.agent_run?.run_id);
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
    return messages.map((message, index) => (index === existingIndex ? assistantMessage : message));
  }

  const parentTurnId = turnResultParentTurnId(turnResult, messages);
  const agentRunId = turnResultAgentRunId(turnResult);
  const parentIndex = messages.findIndex(
    (message) =>
      message.role === "user" &&
      ((parentTurnId !== null && message.turnId === parentTurnId) ||
        (agentRunId !== null && message.agentRunId === agentRunId)),
  );
  if (parentIndex < 0) return [...messages, assistantMessage];

  return [
    ...messages.slice(0, parentIndex + 1),
    assistantMessage,
    ...messages.slice(parentIndex + 1),
  ];
}

export function messageAnchorsAgentRun(
  message: AgentRunAnchorMessage,
  run: AgentRunAnchorState,
): boolean {
  if (message.role !== "user") return false;
  if (message.agentRunId && message.agentRunId === run.run_id) return true;
  if (message.turnId && run.parent_turn_ref && message.turnId === run.parent_turn_ref) return true;
  return false;
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
