// Design: docs/design/schemas/foundation/ledger_threads.json
// VS-00F B06：脉络面板 DTO 的唯一前端校验入口。合法空账=五个空数组；
// schema 校验失败必须显式失败（reject），不能伪装成空账。

import {
  LedgerThreadsSchema,
  type LedgerThreads,
} from "../generated/foundation/ledger_threads";

export type { LedgerThreads };
export type { LedgerThreadEntry } from "../generated/foundation/ledger_thread_entry";

export class LedgerThreadsContractError extends Error {
  readonly issues: Array<{ path: string; message: string }>;

  constructor(issues: Array<{ path: string; message: string }>) {
    super("ledger_threads contract invalid");
    this.name = "LedgerThreadsContractError";
    this.issues = issues;
  }
}

export function parseLedgerThreads(payload: unknown): LedgerThreads {
  const parsed = LedgerThreadsSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    console.warn(
      "[ledger_threads contract drift] 与 docs/design/schemas/foundation/ledger_threads.json 不一致（显式失败，不伪造空账）",
      { issues },
    );
    throw new LedgerThreadsContractError(issues);
  }
  // 容错保留后端新增字段：生成物对象为 strip 模式时不能用 parsed.data。
  return payload as LedgerThreads;
}
