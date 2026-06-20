import { z } from "zod"

export const TaskPhaseSchema = z.enum(["PLANNED","ESTIMATED","CONFIRMATION_REQUIRED","CONFIRMED","RUNNING","CHECKPOINT","RESUMING","COMPLETED","CANCELLED","FAILED","BRANCHED"]).describe("Long-run task 流程阶段，11 个值固定。冻结于 ADR-0002 §4。CHECKPOINT 不得合并进 PAUSED。")
export type TaskPhase = z.infer<typeof TaskPhaseSchema>
