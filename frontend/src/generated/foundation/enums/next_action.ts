import { z } from "zod"

export const NextActionSchema = z.enum(["ASK_USER","CONFIRM_BEFORE_EXECUTE","SHOW_RESULT","RETRY_SYSTEM","RESUME_TASK","ADOPT_ARTIFACTS","CANCEL_TASK","NO_FURTHER_ACTION"]).describe("Runtime 下一步语义，不是 UI 按钮文案。冻结于 ADR-0002 §6。EXECUTE_DIRECTLY 不属于 canonical 集合。")
export type NextAction = z.infer<typeof NextActionSchema>
