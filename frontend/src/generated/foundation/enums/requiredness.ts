import { z } from "zod"

export const RequirednessSchema = z.enum(["required_to_execute","optional_preference"]).describe("Slot 必要性枚举。required_to_execute 缺失时必须阻止执行；optional_preference 不得单独触发 clarification。冻结于 ADR-0010 §3。")
export type Requiredness = z.infer<typeof RequirednessSchema>
