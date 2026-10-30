import { z } from "zod"

export const ConflictLedgerStatusSchema = z.enum(["ACTIVE","DORMANT","REVIVED","ABSORBED","ABANDONED","RESOLVED"]).describe("冲突账状态机（VS-00F §2.3 / ADR-0026）：ACTIVE⇄DORMANT 机械，其余为裁决/终态。")
export type ConflictLedgerStatus = z.infer<typeof ConflictLedgerStatusSchema>
