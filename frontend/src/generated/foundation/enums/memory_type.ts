import { z } from "zod"

export const MemoryTypeSchema = z.enum(["WORLD_RULE","CHARACTER_PROFILE","CURRENT_STATE","RELATIONSHIP","PLOT_FACT","FORESHADOWING","STYLE_RULE","CONSTRAINT","AUTHOR_PREFERENCE","IDEA","DRAFT_CONTEXT"]).describe("记忆类型枚举。定义可治理的创作事实分类——区分铁律、事实、状态、灵感、约束等不同性质的记忆。冻结于 05-memory-retention-and-retrieval.md §4。")
export type MemoryType = z.infer<typeof MemoryTypeSchema>
