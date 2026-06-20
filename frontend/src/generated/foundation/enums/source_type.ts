import { z } from "zod"

export const SourceTypeSchema = z.enum(["turn","task_event","artifact","object_snapshot","object_summary","registry","audit_event","external_import"]).describe("记忆来源类型枚举。每条 memory entry 必须标记来源类型。冻结于 05-memory-retention-and-retrieval.md §5.3。")
export type SourceType = z.infer<typeof SourceTypeSchema>
