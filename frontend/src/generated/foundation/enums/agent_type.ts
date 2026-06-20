import { z } from "zod"

export const AgentTypeSchema = z.enum(["orchestrator","writer","reviewer","planner","long_runner","maintainer"]).describe("Agent 类型分类，atom 派系（snake_case）。来源 tech-stack/08-multi-agent §3.1。")
export type AgentType = z.infer<typeof AgentTypeSchema>
