# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B27-SYSTEMATIC-PROMPT-INTENT | **CP3 已完成并提交**（CP3a–CP3d）。**CP4 执行批与 retest1 均 FAIL（不得标 done）**：协议错误已从 25→0、不可用 27/40→1/40；canonical retest1 仍 FAIL（zero_tolerance M18×2、key_set 6 例、overall 20/40、无谓追问 2>old0）。Tauri 生命周期场景已注册并机制 PASS（`d60f6eb7`，非语义通过）。当前 Round 4 三线修复：task-18 诊断矩阵+harness/judge 证据保真（M11/M13/泄漏）、task-19 judgment 产品修复（M18/M13/M14/M07）、task-20 context/explore 修复（M03/M01/M20/M16/M17/M07-M08）；随后 task-21 retest2 新预注册批次 + 盲评 §6.1。 | [B27](slices/B27-systematic-prompt-and-intent-integration.md) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B31-AUTHOR-REPLY-RUN-BINDING | 一般输入、换话题与旧讨论进入正确任务；复用 B26 明确问题绑定，CP0 可先复现，不反向阻塞 B27。 | [B31](slices/B31-author-reply-run-binding.md) |
| B28-WHOLE-CHAPTER-REVISION | 完整章修订与同章采纳；含 B11D 转出项接单，数据边界不硬等全部提示词迁移。 | [B28](slices/B28-whole-chapter-revision.md) |
| B30-CHAPTER-STRUCTURE-MAINTENANCE | 按稳定身份维护原结构，补 B25 大纲物化 title-first 遗漏；正文与引用保持一致。 | [B30](slices/B30-chapter-structure-maintenance.md) |
| B29-EXISTING-CHARACTER-ROLE-REVISION | 同一角色主档案字段更新，档案、记忆与后续创作一致。 | [B29](slices/B29-existing-character-role-revision.md) |
| P1-AUTHORING-DOGFOOD | 每 3–5 周期插入 10 章级真实创作复验；检验上述能力组合后的体验。 | [真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验) |

## 阻塞

- B26 自身范围已于 2026-10-24 完成；与 B27 专业调用完成后的生命周期/自然表达联合回归由 [B27](slices/B27-systematic-prompt-and-intent-integration.md) CP4 承接，B27 不得因 B26 通过直接标完成。
- B28–B30 的新操作契约需在各自 CP0 冻结；若复现仍可触发的错误 canon 写入，优先调整对应完整任务。
- 凭据、外部探索、人工盲评、durable 等条件项及其承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；它们不因未列为候选而消失。
