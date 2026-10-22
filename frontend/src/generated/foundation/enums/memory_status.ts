import { z } from "zod"

export const MemoryStatusSchema = z.enum(["DRAFT","CONFIRMED","STABILIZED","CONFLICTED","SUPERSEDED","DEPRECATED","ARCHIVED"]).describe("记忆状态枚举。定义记忆的生命周期状态——从草稿到确认、稳定、冲突、被新版替代、废弃、归档。注意：LOCKED 不是 status，使用独立 locked 字段表示。冻结于 05-memory-retention-and-retrieval.md §6；SUPERSEDED 由 Q1c 已采纳内容修订契约补充。")
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>
