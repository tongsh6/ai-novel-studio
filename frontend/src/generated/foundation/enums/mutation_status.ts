import { z } from "zod"

export const MutationStatusSchema = z.enum(["PROPOSED","VALIDATING","BLOCKED","APPLIED","SUPERSEDED","CANCELLED"]).describe("Mutation 生命周期状态枚举。Foundation 层定义 6 个阶段：PROPOSED / VALIDATING / BLOCKED / APPLIED / SUPERSEDED / CANCELLED。冻结于 07-consistency-and-concurrency.md §7.2。")
export type MutationStatus = z.infer<typeof MutationStatusSchema>
