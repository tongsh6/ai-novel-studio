import { z } from "zod"

export const LedgerSchema = z.enum(["arc","conflict","information","emotion_curve","promise"]).describe("五本账分类枚举（08 §4.5 E33-E37 贯穿账本）。分类枚举 lower_snake，对齐 memory_class 风格。冻结于 VS-00F §2.1 / ADR-0026。")
export type Ledger = z.infer<typeof LedgerSchema>
