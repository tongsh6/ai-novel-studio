import { z } from "zod"

export const BehaviorStatusSchema = z.enum(["OPEN","WAITING_USER","RESOLVED","CANCELLED","EXPIRED"]).describe("Durable behavior 状态最小集合。冻结于 ADR-0002 §8。behavior_state.active 只允许 OPEN / WAITING_USER；终态值只能出现在 history。")
export type BehaviorStatus = z.infer<typeof BehaviorStatusSchema>
