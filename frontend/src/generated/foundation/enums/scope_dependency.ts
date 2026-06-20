import { z } from "zod"

export const ScopeDependencySchema = z.enum(["work","volume","arc","chapter","scene","draft","style","continuity","reading_projection","runtime"]).describe("Slot 作用域依赖枚举。描述 slot 所依赖的业务范围。冻结于 ADR-0010 §5。")
export type ScopeDependency = z.infer<typeof ScopeDependencySchema>
