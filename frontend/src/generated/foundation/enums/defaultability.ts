import { z } from "zod"

export const DefaultabilitySchema = z.enum(["no_default","defaultable"]).describe("Slot 可默认性枚举。defaultable 表示 registry 可给默认值（默认值本身不在本 ADR 冻结）。冻结于 ADR-0010 §3。")
export type Defaultability = z.infer<typeof DefaultabilitySchema>
