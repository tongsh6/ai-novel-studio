import { z } from "zod"

export const SlotTypeSchema = z.enum(["text","enum_or_text","object_ref","object_ref_list","scope_ref","anchor_ref","range_ref","integer","boolean"]).describe("Intent slot 类型枚举。首批支持 9 种类型：text / enum_or_text / object_ref / object_ref_list / scope_ref / anchor_ref / range_ref / integer / boolean。冻结于 ADR-0010 §4。")
export type SlotType = z.infer<typeof SlotTypeSchema>
