import { z } from "zod"

export const PhaseNextActionCompatSchema = z.any().describe("ADR-0002 §7 phase × next_action 兼容矩阵 + §7 规则。key 形如 'turn:<TurnPhase>' 或 'task:<TaskPhase>'。allowed 是该 phase 唯一可出 next_action 集合（未列入 allowed 一律禁止）；forbidden 仅作高风险显式拦截 + 测试输入。")
export type PhaseNextActionCompat = z.infer<typeof PhaseNextActionCompatSchema>
