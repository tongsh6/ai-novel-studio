// Design: docs/design/schemas/foundation/agent_run_state.json
// DS01 §9：agent_run_state 帧/恢复快照的唯一前端校验入口。
//
// 策略：校验告警、容错透传；任何校验失败都强制 runtime_live=null（unknown），
// 绝不能让漂移字段或历史快照被当作 live 授予实时命令。历史快照缺 runtime_live
// 是合法 optional，仍按 unknown 处理（由 agentRunRuntimeAuthority 决定）。

import {
  AgentRunStateSchema,
  type AgentRunState,
} from "../generated/foundation/agent_run_state";

export type AgentRunStateData = AgentRunState;

const warnedRunIds = new Set<string>();

export interface AgentRunStateParseIssue {
  path: string;
  message: string;
}

export function validateAgentRunStatePayload(payload: unknown): AgentRunStateParseIssue[] {
  const parsed = AgentRunStateSchema.safeParse(payload);
  if (parsed.success) return [];
  return parsed.error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function parseAgentRunState(payload: unknown): AgentRunStateData | null {
  if (typeof payload !== "object" || payload === null) return null;

  const issues = validateAgentRunStatePayload(payload);

  if (issues.length > 0) {
    const runId = "run_id" in payload ? String(payload.run_id) : "(missing run_id)";
    if (!warnedRunIds.has(runId)) {
      warnedRunIds.add(runId);
      console.warn(
        "[agent_run_state contract drift] 与 docs/design/schemas/foundation/agent_run_state.json 不一致（容错透传，runtime_live 降为 unknown）",
        { run_id: runId, issues },
      );
    }
    return { ...payload, runtime_live: null } as AgentRunStateData;
  }

  return payload as AgentRunStateData;
}
