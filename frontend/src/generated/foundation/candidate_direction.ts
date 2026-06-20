import { z } from "zod"

export const CandidateDirectionSchema = z.object({ "direction_id": z.string().min(1).describe("候选方向在本 TurnResult 内的稳定引用。"), "title": z.string().min(1).describe("作者可见候选标题。"), "pitch": z.string().min(1).describe("作者可见候选简介。"), "tone_tags": z.array(z.string().min(1)).describe("作者可见风格标签；没有标签时为空数组。"), "risk_hint": z.enum(["low","medium","high"]).describe("候选后续采纳风险提示。缺省按 low 处理。").optional(), "adoption_status": z.literal("not_adopted").describe("候选方向不是 artifact，探索阶段只能是 not_adopted。") }).strict().describe("创作探索候选方向。候选方向是灵感入口，不是 artifact adoption entry；adoption_status 固定为 not_adopted。")
export type CandidateDirection = z.infer<typeof CandidateDirectionSchema>
