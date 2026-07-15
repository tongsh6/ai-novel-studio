// Foundation schemas barrel：聚合 generated/ 下各文件的导出。
// generated/ 由 `pnpm codegen:schemas` 重写，不手编。
// codegen 用 PascalCase + Schema 后缀；本文件提供别名，
// 让消费者写 `TurnResultSchema` 而不是文件名 `TurnResultV3Schema`。
//
// 组合点（ADR-0024 决策 5）：codegen 不解析跨文件 $ref（ui_cards /
// candidate_directions 在 turn_result_v3 生成物中降级为 any），
// 本 barrel 用各自的 codegen 生成物在此收紧。这里只做组合，不手写形状。

import { z } from "zod";

import { ArtifactAdoptionEntrySchema } from "../generated/foundation/artifact_adoption_entry";
import { CandidateDirectionSchema } from "../generated/foundation/candidate_direction";
import { TurnResultV3Schema } from "../generated/foundation/turn_result_v3";
import { UiCardSchema } from "../generated/foundation/ui_card";

export {
  ArtifactAdoptionEntrySchema,
  type ArtifactAdoptionEntry,
} from "../generated/foundation/artifact_adoption_entry";

export {
  CandidateDirectionSchema,
  type CandidateDirection,
} from "../generated/foundation/candidate_direction";

export { UiCardSchema, type UiCard } from "../generated/foundation/ui_card";

// 历史冻结的 v2 schema 保留导出（ADR-0015 时代），现行线格式用 v3。
export { TurnResultV2Schema, type TurnResultV2 } from "../generated/foundation/turn_result_v2";

// 线上 adoption_status 序列化为小写（:tentative），而 artifact_adoption_entry.json
// 的大写 7 态枚举（30 §3.2）与线格式存在大小写漂移——已登记 DS01 决策日志，
// 枚举收敛前此处放宽为 string，避免已知漂移刷屏掩盖新漂移。
const TurnAdoptionEntrySchema = ArtifactAdoptionEntrySchema.extend({
  adoption_status: z.string(),
  // TurnResult adoption_state 条目必含 payload（unit_pending_entry 注入）。
  payload: z.record(z.string(), z.unknown()),
});

// 现行 TurnResult 线格式：v3 顶层 + 决策面条目收紧（ui_cards / candidate_directions / adoption_state）。
export const TurnResultSchema = TurnResultV3Schema.extend({
  ui_cards: z.array(UiCardSchema).optional(),
  candidate_directions: z.array(CandidateDirectionSchema).optional(),
  adoption_state: z
    .object({
      pending: z.array(TurnAdoptionEntrySchema),
      resolved: z.array(TurnAdoptionEntrySchema),
    })
    .optional(),
});

export type TurnResult = z.infer<typeof TurnResultSchema>;
