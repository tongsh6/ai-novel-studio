import { z } from "zod"

export const TurnPhaseSchema = z.enum(["RECEIVED","ROUTED","NEEDS_CLARIFICATION","NEEDS_CONFIRMATION","READY_TO_EXECUTE","EXECUTING","COMPLETED","FAILED","CANCELLED"]).describe("Turn 流程阶段，9 个值固定。冻结于 ADR-0002 §3。")
export type TurnPhase = z.infer<typeof TurnPhaseSchema>
