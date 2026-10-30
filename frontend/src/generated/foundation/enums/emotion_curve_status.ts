import { z } from "zod"

export const EmotionCurveStatusSchema = z.enum(["MATCHED","DEVIATED","UNPLANNED"]).describe("情绪曲线账每采纳章一条，机械判定 MATCHED/DEVIATED/UNPLANNED（VS-00F §2.5）。")
export type EmotionCurveStatus = z.infer<typeof EmotionCurveStatusSchema>
