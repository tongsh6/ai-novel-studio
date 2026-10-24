# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B29-EXISTING-CHARACTER-ROLE-REVISION | **当前任务 / CP0 done（2026-10-25，`201b42cb`）**：真实 Tauri 复现「无已有角色主档案字段修订能力」（自然原话 reply 吞掉、显式措辞诚实 capability_gap、无 memory 冒充；多主角不清空/同名不新建/负例零写入）；冻结 Q01–Q08（`revise_character_profile` 能力、character_ref+base_fingerprint、old→new 候选、narrative_role 白名单/多主角不默认清空、同 id 原子更新+旧值回执、主档案为事实源禁止 memory-only、消费者刷新、场景+实模证据）。**CP1/CP2 完成并提交（`601518e9`）**：revise_character_profile 能力/判断绑定/候选 + 原子修订/采纳 effect，全后端 2179/0。**CP3 消费者进行中**（task-73：roster/档案/判断写作上下文/「谁是主角」以 Character.narrative_role 为当前事实、旧 memory 不冒充）→ CP4 场景+实模+回归（task-74）→ CP5。 | [B29](slices/B29-existing-character-role-revision.md) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| P1-AUTHORING-DOGFOOD | 每 3–5 周期插入 10 章级真实创作复验；检验上述能力组合后的体验。 | [真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验) |

## 阻塞

- **B27 CP4 known-gap（2026-10-25，作者裁决）**：最后一次全量 retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0；key_set 仅 M01r2、overall 34/40=0.85 <0.90 → 不标 CP4 done，记录 known-gap（M01r2/M02/M08r2/M16r1/M18r1）并转入 B31；B27 不再全量 retest，后续 B28（format_only/整章）与产品硬化周期回归。证据见 [B27](slices/B27-systematic-prompt-and-intent-integration.md) retest6 记录；其中 M07 已由 B28 format_only 机制+确定性场景关闭（真实模型语义受 strata known-gap 限制）。
- B26 自身范围已于 2026-10-24 完成；与 B27 专业调用完成后的生命周期/自然表达联合回归由 [B27](slices/B27-systematic-prompt-and-intent-integration.md) CP4 承接，B27 不得因 B26 通过直接标完成。
- B28–B30 的新操作契约需在各自 CP0 冻结；若复现仍可触发的错误 canon 写入，优先调整对应完整任务。
- 凭据、外部探索、人工盲评、durable 等条件项及其承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；它们不因未列为候选而消失。
