import { z } from "zod"

export const ChapterMissionStatusSchema = z.enum(["TENTATIVE","CONFIRMED","AUTHOR_EDITED"]).describe("本章使命（chapters.plan_direction.chapter_mission）裁决状态。TENTATIVE=模型推导、作者未裁决（下次写作前会被新推导覆盖）；CONFIRMED=作者确认模型版；AUTHOR_EDITED=作者改写。CONFIRMED/AUTHOR_EDITED 为作者版：推理步直接采用、不再调模型、不被覆盖；作废=删除该键（无 DISCARDED 态）。冻结于 VS-00E §16.8 / ADR-0024 S8（WR01b）。")
export type ChapterMissionStatus = z.infer<typeof ChapterMissionStatusSchema>
