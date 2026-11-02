// Design: docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md §16.10
// Design: docs/design/ui/46-state-and-feedback.md §9.8
//
// author_action 回执的唯一读取/归属边界。这里只搬运服务端已提交的事实：
// - agent_run_state 复用 parseAgentRunState（漂移时 runtime_live 降 unknown）；
// - turn_results 复用 parseIncomingTurnResult（漂移容错，不误判已受理动作）；
// - 不根据 run_id 合成 running/executing/runtime_live=true，也不把 ACK.turn_id
//   当作运行的 parent（parent 只来自 actual agent_run_state）。
// run/source/work/session 任一身份错绑都失败闭合，整份回执不进入当前视图。

import {
  AuthorActionResultSchema,
  type AuthorActionResult,
} from "../generated/foundation/author_action_result";
import type { TurnResult } from "./schemas";
import { parseAgentRunState, type AgentRunStateData } from "./agentRunStateWire";
import { parseIncomingTurnResult } from "./turnResultWire";

// 基础 envelope 复用 codegen schema；agent_run_state / turn_results 在下方按
// 既有 parser 的容错口径单独校验——TurnResult 字段漂移仍容错，但成员必须是记录。
const RECEIPT_ENVELOPE_SCHEMA = AuthorActionResultSchema.omit({
  agent_run_state: true,
  turn_results: true,
});

export interface AuthorActionCommitScope {
  connectionToken: number;
  workId: string | null;
  sessionId: string | null;
  sourceTurnRef: string;
}

export interface AuthorActionCurrentScope {
  connectionToken: number;
  workId: string | null;
  sessionId: string | null;
}

export type AuthorActionReceiptIssue =
  | "receipt_invalid"
  | "not_received"
  | "connection_changed"
  | "work_changed"
  | "session_changed"
  | "source_mismatch"
  | "run_mismatch"
  | "runtime_invalid"
  | "result_scope_mismatch"
  | "result_run_mismatch"
  | "result_source_mismatch";

export interface AuthorActionReceiptFacts {
  actionStatus: string;
  runtime: AgentRunStateData | null;
  turnResults: TurnResult[];
}

export type AuthorActionReceiptRead =
  | { ok: true; receipt: AuthorActionReceiptFacts }
  | { ok: false; issue: AuthorActionReceiptIssue };

type RuntimeRead =
  | { ok: true; runtime: AgentRunStateData | null }
  | { ok: false; issue: AuthorActionReceiptIssue };

type TurnResultsRead =
  | { ok: true; results: TurnResult[] }
  | { ok: false; issue: AuthorActionReceiptIssue };

export function readAuthorActionReceipt(
  response: unknown,
  committed: AuthorActionCommitScope,
  current: AuthorActionCurrentScope,
): AuthorActionReceiptRead {
  const envelope = readEnvelope(response);
  if (!envelope.ok) return envelope;
  const acknowledgment = envelope.response;

  if (acknowledgment.received !== true) return rejected("not_received");

  const scopeIssue = currentScopeIssue(committed, current);
  if (scopeIssue !== null) return rejected(scopeIssue);
  const sourceIssue = acknowledgmentSourceIssue(acknowledgment, committed);
  if (sourceIssue !== null) return rejected(sourceIssue);

  const runId = identityBytes(acknowledgment.run_id);
  const runtime = readRuntime(acknowledgment.agent_run_state, runId, committed);
  if (!runtime.ok) return runtime;

  const turnResults = readTurnResults(
    acknowledgment.turn_results === undefined ? [] : acknowledgment.turn_results,
    runId,
    committed,
  );
  if (!turnResults.ok) return turnResults;

  return {
    ok: true,
    receipt: {
      actionStatus: acknowledgment.action_status,
      runtime: runtime.runtime,
      turnResults: turnResults.results,
    },
  };
}

// 网络层只做了 `as AuthorActionResult` 的静态断言，成员形状仍不可信。这里是
// 回执事实进入域模型的唯一解析点：envelope 字段、turn_results 数组与成员记录
// 形状不合格时整份回执拒绝，绝不把半份回执当成可用事实。
function readEnvelope(
  payload: unknown,
): { ok: true; response: AuthorActionResult } | { ok: false; issue: AuthorActionReceiptIssue } {
  if (!isRecord(payload)) return rejected("receipt_invalid");
  if (!RECEIPT_ENVELOPE_SCHEMA.safeParse(payload).success) return rejected("receipt_invalid");

  if (payload.turn_results !== undefined) {
    if (!Array.isArray(payload.turn_results) || !payload.turn_results.every(isRecord)) {
      return rejected("receipt_invalid");
    }
  }

  if (
    payload.agent_run_state !== undefined &&
    payload.agent_run_state !== null &&
    !isRecord(payload.agent_run_state)
  ) {
    return rejected("runtime_invalid");
  }

  return { ok: true, response: payload as AuthorActionResult };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentScopeIssue(
  committed: AuthorActionCommitScope,
  current: AuthorActionCurrentScope,
): AuthorActionReceiptIssue | null {
  if (current.connectionToken !== committed.connectionToken) return "connection_changed";
  if (current.workId !== committed.workId) return "work_changed";
  if (current.sessionId !== committed.sessionId) return "session_changed";
  return null;
}

function sourceAliasConflict(value: unknown, expected: string): boolean {
  const source = identityBytes(value);
  return source !== null && source !== expected;
}

function acknowledgmentSourceIssue(
  acknowledgment: AuthorActionResult,
  committed: AuthorActionCommitScope,
): AuthorActionReceiptIssue | null {
  if (sourceAliasConflict(acknowledgment.source_turn_ref, committed.sourceTurnRef)) {
    return "source_mismatch";
  }
  if (sourceAliasConflict(acknowledgment.trigger?.source_turn_ref, committed.sourceTurnRef)) {
    return "source_mismatch";
  }
  return null;
}

function readRuntime(
  payload: unknown,
  runId: string | null,
  committed: AuthorActionCommitScope,
): RuntimeRead {
  if (payload === undefined || payload === null) return { ok: true, runtime: null };

  const runtime = parseAgentRunState(payload);
  if (runtime === null) return rejected("runtime_invalid");

  const issue = runtimeIdentityIssue(runtime, runId, committed);
  if (issue !== null) return rejected(issue);

  return { ok: true, runtime };
}

function runtimeIdentityIssue(
  runtime: AgentRunStateData,
  runId: string | null,
  committed: AuthorActionCommitScope,
): AuthorActionReceiptIssue | null {
  return (
    runtimeRunIssue(runtime, runId) ??
    scopeIssue(runtime.work_id, runtime.session_id, committed, "work_changed", "session_changed") ??
    runtimeSourceIssue(runtime, committed)
  );
}

function runtimeRunIssue(
  runtime: AgentRunStateData,
  runId: string | null,
): AuthorActionReceiptIssue | null {
  if (runId === null || identityBytes(runtime.run_id) !== runId) return "run_mismatch";
  return null;
}

// 每个显式 source 别名独立核验；不能用 trigger.source_turn_ref 的匹配掩盖
// parent_turn_ref 的冲突，也不能反过来用 parent 掩盖 trigger。
function runtimeSourceIssue(
  runtime: AgentRunStateData,
  committed: AuthorActionCommitScope,
): AuthorActionReceiptIssue | null {
  if (
    sourceAliasConflict(runtime.trigger?.source_turn_ref, committed.sourceTurnRef) ||
    sourceAliasConflict(runtime.parent_turn_ref, committed.sourceTurnRef)
  ) {
    return "source_mismatch";
  }

  return null;
}

function readTurnResults(
  payload: TurnResult[],
  runId: string | null,
  committed: AuthorActionCommitScope,
): TurnResultsRead {
  const results: TurnResult[] = [];
  for (const rawResult of payload) {
    const result = parseIncomingTurnResult(rawResult);
    const issue = resultIdentityIssue(result, runId, committed);
    if (issue !== null) return rejected(issue);
    results.push(result);
  }

  return { ok: true, results };
}

function resultIdentityIssue(
  result: TurnResult,
  runId: string | null,
  committed: AuthorActionCommitScope,
): AuthorActionReceiptIssue | null {
  return (
    resultRunIssue(result, runId) ??
    scopeIssue(
      result.work_id,
      result.session_id,
      committed,
      "result_scope_mismatch",
      "result_scope_mismatch",
    ) ??
    resultSourceIssue(result, committed)
  );
}

function scopeIssue(
  workId: unknown,
  sessionId: unknown,
  committed: AuthorActionCommitScope,
  workIssue: AuthorActionReceiptIssue,
  sessionIssue: AuthorActionReceiptIssue,
): AuthorActionReceiptIssue | null {
  const work = identityBytes(workId);
  if (work !== null && work !== committed.workId) return workIssue;

  const session = identityBytes(sessionId);
  if (session !== null && session !== committed.sessionId) return sessionIssue;

  return null;
}

function resultRunIssue(result: TurnResult, runId: string | null): AuthorActionReceiptIssue | null {
  const resultRunId = identityBytes(result.agent_run?.run_id);
  if (resultRunId !== null && (runId === null || resultRunId !== runId)) {
    return "result_run_mismatch";
  }
  return null;
}

function resultSourceIssue(
  result: TurnResult,
  committed: AuthorActionCommitScope,
): AuthorActionReceiptIssue | null {
  const conflicts =
    sourceAliasConflict(result.parent_turn_id, committed.sourceTurnRef) ||
    sourceAliasConflict(result.agent_run?.parent_turn_ref, committed.sourceTurnRef) ||
    sourceAliasConflict(result.agent_run?.trigger?.source_turn_ref, committed.sourceTurnRef);

  return conflicts ? "result_source_mismatch" : null;
}

function rejected(issue: AuthorActionReceiptIssue): { ok: false; issue: AuthorActionReceiptIssue } {
  return { ok: false, issue };
}

// trim 只用于判断“是否为空/缺失”；身份比较和后续保存必须保留 wire 原字节。
function identityBytes(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value;
}
