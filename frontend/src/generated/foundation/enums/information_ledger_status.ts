import { z } from "zod"

export const InformationLedgerStatusSchema = z.enum(["HIDDEN","PARTIALLY_REVEALED","REVEALED","LEAKED"]).describe("信息账（ledger=information）领域状态机。HIDDEN→PARTIALLY_REVEALED→REVEALED 正向生命周期；LEAKED 为异常态（实现态早于设计揭示点，R4 机械记账）。REVEALED 只能经机械口径（本章正文采纳释放本章计划信息）或作者裁决/采纳回收提议进入——回收是语义判断，模型只提议、作者收账（VS00F 刀④拍板）。冻结于 VS-00F §2.4 / ADR-0026。")
export type InformationLedgerStatus = z.infer<typeof InformationLedgerStatusSchema>
