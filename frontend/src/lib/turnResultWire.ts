// Design: docs/design/07-workbench-ui-contract.md §4 / ADR-0024 决策 5
// turn_result 线格式校验入口：所有进入前端的 TurnResult payload（Channel 广播、
// transcript 恢复）都经此处 safeParse 做契约漂移检测。
//
// 策略是「校验告警、容错渲染」：校验失败只 console.warn（漂移在开发/测试期可见，
// 配合契约漂移注入测试变红），payload 原样透传——codegen 生成的嵌套对象是
// strip 模式，若采用 parsed.data 会静默丢弃后端新增字段，与容错目标冲突。

import { TurnResultSchema, type TurnResult as WireTurnResult } from "./schemas";

export type { WireTurnResult };

const warnedTurnIds = new Set<string>();

export interface TurnResultParseIssue {
  path: string;
  message: string;
}

export function validateTurnResultPayload(payload: unknown): TurnResultParseIssue[] {
  const parsed = TurnResultSchema.safeParse(payload);
  if (parsed.success) return [];

  return parsed.error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * 校验并透传 turn_result payload。同一 turn_id 只告警一次，避免重渲染刷屏。
 */
export function parseIncomingTurnResult(payload: unknown): WireTurnResult {
  const issues = validateTurnResultPayload(payload);

  if (issues.length > 0) {
    const turnId =
      typeof payload === "object" && payload !== null && "turn_id" in payload
        ? String(payload.turn_id)
        : "(missing turn_id)";

    if (!warnedTurnIds.has(turnId)) {
      warnedTurnIds.add(turnId);
      console.warn(
        "[turn_result contract drift] 与 docs/design/schemas/foundation/turn_result_v3.json 不一致（仍容错渲染）",
        { turn_id: turnId, issues },
      );
    }
  }

  return payload as WireTurnResult;
}
