import { z } from "zod"

export const ArcLedgerStatusSchema = z.enum(["ON_TRACK","STALLED","DRIFTED","RESUMED","COMPLETED","RETIRED"]).describe("弧光账（ledger=arc）领域状态机。UPPER_SNAKE 对齐全仓 *_status 约定；与采纳 7 态（adoption_status）正交分层。DRIFTED/RESUMED 只能经作者裁决进入（VS-00F §3.3）。冻结于 VS-00F §2.2 / ADR-0026。")
export type ArcLedgerStatus = z.infer<typeof ArcLedgerStatusSchema>
