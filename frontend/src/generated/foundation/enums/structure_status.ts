import { z } from "zod"

export const StructureStatusSchema = z.enum(["PLANNED","DRAFTING","COMPLETED","ARCHIVED"]).describe("小说结构对象（Volume/Chapter/Scene）的状态。对应 21-novel-object-model.md §5 对象状态。")
export type StructureStatus = z.infer<typeof StructureStatusSchema>
