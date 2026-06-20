import { z } from "zod"

export const StatusSchema = z.enum(["READY","WAITING_USER","WAITING_SYSTEM","RUNNING","PAUSED","DONE","ERROR","CANCELLED"]).describe("Foundation 通用 status family，turn / task / artifact projection 共用。冻结于 ADR-0002 §2。")
export type Status = z.infer<typeof StatusSchema>
