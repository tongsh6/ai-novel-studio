// Foundation schemas barrel：聚合 generated/ 下各文件的导出。
// generated/ 由 `pnpm codegen:schemas` 重写，不手编。
// codegen 用 PascalCase + Schema 后缀；本文件提供别名，
// 让消费者写 `TurnResultSchema` 而不是文件名 `TurnResultV2Schema`。

export { TurnResultV2Schema, type TurnResultV2 } from "../generated/foundation/turn_result_v2";

export {
  ArtifactAdoptionEntrySchema,
  type ArtifactAdoptionEntry,
} from "../generated/foundation/artifact_adoption_entry";

export {
  CandidateDirectionSchema,
  type CandidateDirection,
} from "../generated/foundation/candidate_direction";

// 别名：去掉版本后缀，跟 backend 模块路径对齐。
export { TurnResultV2Schema as TurnResultSchema } from "../generated/foundation/turn_result_v2";
export type { TurnResultV2 as TurnResult } from "../generated/foundation/turn_result_v2";
