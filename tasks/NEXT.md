# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B27-SYSTEMATIC-PROMPT-INTENT | **CP3 已完成**（CP3a–CP3d）。**CP4 retest1/retest2 均 FAIL**（retest2：unavailable 1/40、追问 0/34 已 PASS；zero_tolerance 4、key_set 7、overall 16/40 FAIL）。retest2 残余：① **上下文作品事实投影/fetch 链**（repo 数据正确但 prompt 事实块 0/0/unknown，最高杠杆，影响 M01/M06/M07/M10/M16/M20）；② 零容忍对象/版本纪律（M06/M07r1/M17r2）；③ 修订范围/收束（M07r2/M08/M09r1/M13r2/M15/M20/M03r2）；④ harness M12 历史来源字节证据。下一步：产品+harness 修复批 → retest3 新预注册批次；M07 仅排版目标与 B28 format_only 边界需裁决。 | [B27](slices/B27-systematic-prompt-and-intent-integration.md) |

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
