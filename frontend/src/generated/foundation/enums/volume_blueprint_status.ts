import { z } from "zod"

export const VolumeBlueprintStatusSchema = z.enum(["TENTATIVE","CONFIRMED","AUTHOR_EDITED"]).describe("卷级蓝图（volumes.blueprint.status）裁决状态。TENTATIVE=模型推导、作者未裁决；CONFIRMED=采纳 outline_draft 即作者定稿（B11A CP1 采纳物化路径写此态）；AUTHOR_EDITED=作者手编（CP3+ 留位）。作废=删除该键或整行 blueprint（无 DISCARDED 态）。与 chapter_mission_status 同款三态。冻结于 VS-00J §2.1 / ADR-0028。")
export type VolumeBlueprintStatus = z.infer<typeof VolumeBlueprintStatusSchema>
