import { z } from "zod"

export const ProvisionalSourceSchema = z.literal("AI_ASSUMPTION").describe("暂用态来源标注（VS-00G §2.3 工作假定）。区分「AI 假定」（盘点/分析产出、可被系统带【暂定】标注注入）与普通作者候选（provisional_source 为空的 tentative 对象）。零新实体：这是既有 tentative 对象上的来源标注字段，不是新状态机。")
export type ProvisionalSource = z.infer<typeof ProvisionalSourceSchema>
