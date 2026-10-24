# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B30-CHAPTER-STRUCTURE-MAINTENANCE | **当前任务 / CP0 done（2026-10-25，`0f756e2b`）**：真实 Tauri 复现结构维护能力缺失（reply/target_not_available/plot_outline 误路由）、采纳按 title 新建章、标题号≠seq；标准 B11A 蓝图路径安全但持久层无类型防护。CP0 冻结 Q01–Q08（`maintain_chapter_structure` 能力/只重编号首闭环/old→new 映射/两阶段 seq 事务/蓝图类型边界/seq 权威展示/消费者迁移/证据回归）。**CP1/CP2 完成并提交（`a5581f35`）**：maintain_chapter_structure 能力/判断/change_plan + 原子 renumber/采纳 effect/蓝图类型防护，全后端 2138/0。**CP3 大部分提交（`dbdb7770`）**：ChapterDisplay/写作坐标/章使命/探索/判断上下文 ref-first、账本伏笔 seq remap、检索/TOC 审计；**计划物化 ref-first 成对补进行中**（task-65 parser/物化 + task-66 plot_outline 契约）→ CP4 两场景+实模（task-64，依赖 62/63/65/66）→ CP5。 | [B30](slices/B30-chapter-structure-maintenance.md) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B29-EXISTING-CHARACTER-ROLE-REVISION | 同一角色主档案字段更新，档案、记忆与后续创作一致。 | [B29](slices/B29-existing-character-role-revision.md) |
| P1-AUTHORING-DOGFOOD | 每 3–5 周期插入 10 章级真实创作复验；检验上述能力组合后的体验。 | [真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验) |

## 阻塞

- **B27 CP4 known-gap（2026-10-25，作者裁决）**：最后一次全量 retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0；key_set 仅 M01r2、overall 34/40=0.85 <0.90 → 不标 CP4 done，记录 known-gap（M01r2/M02/M08r2/M16r1/M18r1）并转入 B31；B27 不再全量 retest，后续 B28（format_only/整章）与产品硬化周期回归。证据见 [B27](slices/B27-systematic-prompt-and-intent-integration.md) retest6 记录；其中 M07 已由 B28 format_only 机制+确定性场景关闭（真实模型语义受 strata known-gap 限制）。
- B26 自身范围已于 2026-10-24 完成；与 B27 专业调用完成后的生命周期/自然表达联合回归由 [B27](slices/B27-systematic-prompt-and-intent-integration.md) CP4 承接，B27 不得因 B26 通过直接标完成。
- B28–B30 的新操作契约需在各自 CP0 冻结；若复现仍可触发的错误 canon 写入，优先调整对应完整任务。
- 凭据、外部探索、人工盲评、durable 等条件项及其承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；它们不因未列为候选而消失。
