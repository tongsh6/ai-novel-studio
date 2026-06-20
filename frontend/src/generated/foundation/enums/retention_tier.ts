import { z } from "zod"

export const RetentionTierSchema = z.enum(["hot","warm","cold"]).describe("记忆保留层级枚举。Foundation 层定义三层保留结构：hot / warm / cold。冻结于 05-memory-retention-and-retrieval.md §6。")
export type RetentionTier = z.infer<typeof RetentionTierSchema>
