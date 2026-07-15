import { z } from "zod"

export const NarrativeRoleSchema = z.enum(["PROTAGONIST","ANTAGONIST","SUPPORTING","MINOR","ENSEMBLE_POV"]).describe("角色叙事功能分类。主角等叙事角色是 Character 的结构化分类（叙事功能层），不是作品立项字段，也不只是关系。允许多个 PROTAGONIST（群像/双主角）。无标记时主角必须诚实报缺口，不把第一个角色默认当主角。")
export type NarrativeRole = z.infer<typeof NarrativeRoleSchema>
