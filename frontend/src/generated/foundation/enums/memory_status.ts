import { z } from "zod"

export const MemoryStatusSchema = z.enum(["DRAFT","CONFIRMED","STABILIZED","CONFLICTED","DEPRECATED","ARCHIVED"]).describe("记忆状态枚举。定义记忆的生命周期状态——从草稿到确认、稳定、冲突、废弃、归档。注意：LOCKED 不是 status，使用独立 locked 字段表示。冻结于 05-memory-retention-and-retrieval.md §6。")
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>
