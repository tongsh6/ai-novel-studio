import { z } from "zod"

export const PromiseLedgerStatusSchema = z.enum(["OPEN","PROGRESSING","FULFILLED","BROKEN","RELEASED"]).describe("承诺账状态机（VS-00F §2.6 / ADR-0026）：OPEN/PROGRESSING/FULFILLED/BROKEN/RELEASED。")
export type PromiseLedgerStatus = z.infer<typeof PromiseLedgerStatusSchema>
