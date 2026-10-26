# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B28-WHOLE-CHAPTER-REVISION | 分段/采纳/阅读重开实模已验；补缺目标、旧验收driver与投影状态显示后收口。 | [B28](slices/B28-whole-chapter-revision.md) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B30-CHAPTER-STRUCTURE-MAINTENANCE | 以真实模型贯通原生重编号及卷章类型边界。 | [B30](slices/B30-chapter-structure-maintenance.md) |
| B29-EXISTING-CHARACTER-ROLE-REVISION | 以真实模型贯通原生角色身份更新、采纳与后续消费。 | [B29](slices/B29-existing-character-role-revision.md) |
| P1-AUTHORING-DOGFOOD | 补原生创作/维护/恢复/导出证据；B37 承接实际驱动标识及监督，原 canonical-3e 作为浏览器实模证据保留。 | [真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验)、[B37](slices/B37-acceptance-wait-supervision.md) |
| B38-WORLD-RULE-SAVE-INTENT | deferred 候选；仅在真实产品链复现或作者请求时触发。 | [B38](slices/B38-world-rule-save-intent.md) |

## 阻塞

- B28 R3单次scoped复验已结束；完整矩阵与显示缺口仍见 [B28](slices/B28-whole-chapter-revision.md)，不以局部通过结案。

- P1 原生实模复验前须闭环本批模型归属与两运行时清理，保留作者手动实例；见 [B37](slices/B37-acceptance-wait-supervision.md)。
- **B27 CP4 known-gap（2026-10-25，作者裁决）**：最后一次全量 retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0；key_set 仅 M01r2、overall 34/40=0.85 <0.90 → 不标 CP4 done，记录 known-gap（M01r2/M02/M08r2/M16r1/M18r1）并转入 B31；B27 不再全量 retest，后续 B28（format_only/整章）与产品硬化周期回归。证据见 [B27](slices/B27-systematic-prompt-and-intent-integration.md) retest6 记录；其中 M07 实际分段由 B28/ADR-0029 继续承接，机制与替身结果不代表真实模型闭环。
- B26 自身范围已于 2026-10-24 完成；与 B27 专业调用完成后的生命周期/自然表达联合回归由 [B27](slices/B27-systematic-prompt-and-intent-integration.md) CP4 承接，B27 不得因 B26 通过直接标完成。
- 原生补验沿各任务已冻结的契约与矩阵；若复现新的 canon 写入缺陷，先登记 CP0、按作者升级规则处理，不直接改断言。
- 凭据、外部探索、人工盲评、durable 等条件项及其承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；它们不因未列为候选而消失。
