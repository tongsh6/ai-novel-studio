import { z } from "zod"

export const InferabilitySchema = z.enum(["not_inferable","inferable_with_high_confidence"]).describe("Slot 可推断性枚举。inferable_with_high_confidence 表示 Router 可从当前上下文稳定补足但必须保留推断来源。冻结于 ADR-0010 §3。")
export type Inferability = z.infer<typeof InferabilitySchema>
