import { z } from "zod"

export const MemorySourceTypeSchema = z.enum(["AUTHOR_CONFIRMED","AUTHOR_CREATED","AI_EXTRACTED","CHAPTER_EXTRACTED","WORK_SETTING_IMPORTED","SESSION_CONTEXT"]).describe("记忆来源类型枚举。区分记忆的权威来源——作者确认高于文档导入高于 AI 推断。冻结于 05-memory-retention-and-retrieval.md §7。")
export type MemorySourceType = z.infer<typeof MemorySourceTypeSchema>
