// Design: docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md §16.10
// Design: docs/design/ui/46-state-and-feedback.md §9.8
import type { AuthorActionResult } from "../generated/foundation/author_action_result";
import type { AuthorActionPayload } from "./socket";
import { readAuthorActionReceipt } from "./authorActionReceipt";
import type {
  AuthorActionCommitScope,
  AuthorActionCurrentScope,
  AuthorActionReceiptFacts,
  AuthorActionReceiptIssue,
} from "./authorActionReceipt";
import type { AgentRunStateData } from "./agentRunStateWire";
import type { TurnResult } from "./schemas";

export interface AuthorActionDeliveryEffects {
  publishDuplicate: () => void;
  publishFailure: () => void;
  publishUnverifiable?: () => void;
  applyTurnResult: (result: TurnResult) => void;
  applyRuntime: (state: AgentRunStateData) => void;
  settle: () => void;
}

export interface AuthorActionSubmission {
  action: AuthorActionPayload;
  committed: AuthorActionCommitScope;
  send: (action: AuthorActionPayload) => Promise<AuthorActionResult>;
  getCurrentScope: () => AuthorActionCurrentScope;
  effects: AuthorActionDeliveryEffects;
}

export type AuthorActionSubmissionResult =
  | { status: "accepted"; response: AuthorActionResult }
  | { status: "duplicate" }
  | { status: "failed" };

/**
 * 一次作者动作提交的唯一异步所有权边界。
 *
 * 提交前由调用方捕获 committed scope；send 完成后用同一个 getCurrentScope 重新核验。
 * scope 一旦变化（作品/会话/连接切换），本次提交返回 null，且不发布任何回执、
 * duplicate、failure 或 settled 视图效果；新视图的 loading/request 状态不被旧请求触碰。
 */
export async function submitAndDeliverAuthorAction(
  submission: AuthorActionSubmission,
): Promise<AuthorActionSubmissionResult | null> {
  let response: AuthorActionResult | null;
  try {
    response = await submission.send(submission.action);
  } catch {
    response = null;
  }

  const current = submission.getCurrentScope();
  if (!sameCommittedScope(submission.committed, current)) return null;

  if (response === null) {
    submission.effects.publishFailure();
    submission.effects.settle();
    return { status: "failed" };
  }

  // duplicate 不是跳过事实/校验的授权：重传不再次执行，但首次与重复必须走同一条
  // 回执读取与交付路径。合法 duplicate 先按既有 merge/upsert 刷新 runtime/results，
  // 再给作者 duplicate 反馈；错绑的 duplicate 在读取阶段失败闭合，不发布“已处理”。
  const read = readAuthorActionReceipt(response, submission.committed, current);
  if (!read.ok) {
    if (isUnverifiableIssue(read.issue) && submission.effects.publishUnverifiable) {
      submission.effects.publishUnverifiable();
    } else {
      submission.effects.publishFailure();
    }
    submission.effects.settle();
    return { status: "failed" };
  }

  const duplicate = response.duplicate === true;
  deliverReceipt(read.receipt, submission.effects, duplicate);
  return duplicate ? { status: "duplicate" } : { status: "accepted", response };
}

export function isAuthorActionDelivered(result: AuthorActionSubmissionResult | null): boolean {
  return result?.status === "accepted" || result?.status === "duplicate";
}

function isUnverifiableIssue(issue: AuthorActionReceiptIssue): boolean {
  return issue === "receipt_invalid" || issue === "runtime_invalid";
}

function deliverReceipt(
  receipt: AuthorActionReceiptFacts,
  effects: AuthorActionDeliveryEffects,
  duplicate: boolean,
): void {
  for (const result of receipt.turnResults) effects.applyTurnResult(result);
  if (receipt.runtime !== null) effects.applyRuntime(receipt.runtime);
  if (duplicate) effects.publishDuplicate();
  effects.settle();
}

function sameCommittedScope(
  committed: AuthorActionCommitScope,
  current: AuthorActionCurrentScope,
): boolean {
  return (
    committed.connectionToken === current.connectionToken &&
    committed.workId === current.workId &&
    committed.sessionId === current.sessionId
  );
}
