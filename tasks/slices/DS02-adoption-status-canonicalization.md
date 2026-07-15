# DS02 adoption_status 序列化口径全链路统一

- 状态：todo（2026-07-15 立项，待排期；用户原则确认：不允许"放宽为 string"成为终态）
- 类型：Contract Slice / Data Flow Correction
- 父契约：`docs/design/foundation/30` §3.2（大写 7 态 canonical）、ADR-0019（转换矩阵）、ADR-0024（决策面 schema 闸门）

## 1. 问题（系统内部口径分裂，非表层 bug）

- `NovelDomain.AdoptionStatus` 与 `NovelPersistence...ArtifactAdoptionEntry` Ecto 枚举使用 30 §3.2 冻结的大写 7 态（`TENTATIVE`...）。
- `NovelDomain.TentativeArtifactSet.adoption_status` 使用小写 atom `:tentative`，随 TurnResult 序列化为小写字符串，前端与外部 driver 均按小写消费（`adoption_status === "tentative"`）。
- DS01 CP1 的 schema 闸门因此被迫在前端 barrel 将 `adoption_status` 放宽为 `z.string()`（`frontend/src/lib/schemas.ts`），使 `artifact_adoption_entry.json` 的枚举校验对线上流量失效——这是登记在案的临时放宽，本 slice 的存在目的就是消灭它。

## 2. 修正方向（从数据流出发，单一权威）

统一到 canonical 大写 7 态（契约权威优先，30 §3.2 / ADR-0019 不动）：

1. `TentativeArtifactSet` 的 `adoption_status` 对齐 `NovelDomain.AdoptionStatus`（领域层单一权威，消灭第二套小写枚举）。
2. TurnResult 序列化（`turn_result_builder` `unit_pending_entry` 等）随之输出大写。
3. 前端消费点（adoptionDecision / candidateSelection / WorkspaceChat 等 `"tentative"` 字面量）与外部 driver/verifier 断言同步迁移。
4. 前端 barrel 撤销 `adoption_status: z.string()` 放宽，恢复 codegen 枚举校验（DS01 闸门在此收口）。
5. 兼容层：持久化历史 turn_result（transcript）中已有小写值——恢复路径需要一次性归一（读取时 upcase）或迁移脚本；方向在开工检查时定，不做双轨长存。

## 3. 开工检查（六问，开工时补全 Proof 细节）

- Contract：30 §3.2 / ADR-0019 / `artifact_adoption_entry.json` 枚举；ADR-0024 决策 5。
- Invariant：`00c` §7 #18（schema 闸门真实生效）；ADR-0019 转换矩阵。
- Boundary：novel_domain（TentativeArtifactSet）、novel_application（序列化）、frontend、slice-verify 资产；novel_persistence 枚举不动（已是 canonical）。
- Consumer：前端采纳链路 + I1/I3 driver + Tauri 采纳场景。
- Proof：mix 全套 + I1/I2/I3 + schemas.test（撤销放宽后枚举校验用例）+ Tauri 采纳链路回归；transcript 恢复归一用例。
- Acceptance Driver：复用 `agent-bounded-roster-to-character-design`（含 pending_artifact_tentative 断言迁移）。

## 4. 决策日志

- 2026-07-15：立项。源于 DS01 CP1 闸门落地时发现的口径分裂与临时放宽；用户明确原则"开发阶段不允许补丁式绕过"，本 slice 是该放宽的系统性收口。
