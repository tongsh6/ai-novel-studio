import type { AgentRunStateData } from "./socket";

const TERMINAL_AGENT_RUN_STATUSES = new Set(["completed", "cancelled", "failed"]);
const STEERABLE_AGENT_RUN_STATUSES = new Set([
  "running",
  "pausing",
  "paused",
  "awaiting_author",
]);

export interface AgentRunInputRoutingContext {
  latestAgentRun: AgentRunStateData | null;
  pendingAnswerBehaviorId?: string | null;
  generateMicroPlan?: boolean;
}

export function shouldRouteInputToAgentSteer({
  latestAgentRun,
  pendingAnswerBehaviorId,
  generateMicroPlan = false,
}: AgentRunInputRoutingContext): boolean {
  if (!latestAgentRun) return false;
  if (generateMicroPlan) return false;
  if (pendingAnswerBehaviorId) return false;
  if (TERMINAL_AGENT_RUN_STATUSES.has(latestAgentRun.status)) return false;
  // DS03：runtime 已失活的任务不能再被 steer——输入应回到普通消息、发起新任务。
  if (latestAgentRun.runtime_live === false) return false;

  return STEERABLE_AGENT_RUN_STATUSES.has(latestAgentRun.status);
}
