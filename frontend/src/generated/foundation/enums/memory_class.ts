import { z } from "zod"

export const MemoryClassSchema = z.enum(["episodic","semantic","procedural","meta"]).describe("记忆分类枚举。Foundation 层定义四类记忆：episodic / semantic / procedural / meta。冻结于 05-memory-retention-and-retrieval.md §5.2。")
export type MemoryClass = z.infer<typeof MemoryClassSchema>
