import { z } from "zod"

export const MemoryScopeSchema = z.enum(["GLOBAL","WORK","VOLUME","ARC","CHAPTER","SESSION"]).describe("记忆作用范围枚举。定义记忆在哪个层级生效——从全局作者偏好到单次会话临时上下文。冻结于 05-memory-retention-and-retrieval.md §5。")
export type MemoryScope = z.infer<typeof MemoryScopeSchema>
