# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B39-EVIDENCE-SEEKING-AUTHORING | 元原则已对账到主链/Context/AgentRun/契约与验收；下一步评审 ADR-0030、VS-00K 和 AU-15，Accepted 后开放正文 run 求证，不先做时间线 schema。 | [B39](slices/B39-evidence-seeking-authoring.md) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B38-WORLD-RULE-SAVE-INTENT | deferred 候选；仅在真实产品链复现或作者请求时触发。 | [B38](slices/B38-world-rule-save-intent.md) |

## 阻塞

- B28/B30/B29/P1 均已完成（2026-10-27，完成审计后的原生补验收口与真实模型 scoped 证据）；B37 随 P1 闭环 done；stage 存量数据（ch1/ch17）保持只读清单，修复需作者单独授权，见 [B28](slices/B28-whole-chapter-revision.md)。
- **B29 known-gap（待作者裁决）**：真实模型在「指定沈砚为主角」（存在两个同名沈砚）时未走 await_author，而按跨轮上下文绑定并产出 old==new 的 no-op 角色修订候选（未采纳、DB 零写入）。待裁决：是否登记 no-op 候选拒绝/同名澄清硬化的产品 slice；B29 确定性 23/23 + T1 真实模型全链已 PASS，T2 不冒充通过。
- **B39（作者 2026-10-27 新登记）**：CP0 设计/契约/验收落地由作者推进（ADR-0030 Proposed、VS-00K、AU-15）；AI 侧在 ADR-0030 Accepted 前不进入产品实现，等待作者裁决。

- B37 验收等待/监督已随 P1 原生实模 scoped 批次闭环 done（模型生命周期 before/after-unload、wait-ledger 35/0 timeout、原生重开清理 164ms remaining=[]）；作者手动 LM embedding 实例保持未动。
- **B27 CP4 known-gap（2026-10-25，作者裁决）**：最后一次全量 retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0；key_set 仅 M01r2、overall 34/40=0.85 <0.90 → 不标 CP4 done，记录 known-gap（M01r2/M02/M08r2/M16r1/M18r1）并转入 B31；B27 不再全量 retest，后续 B28（format_only/整章）与产品硬化周期回归。证据见 [B27](slices/B27-systematic-prompt-and-intent-integration.md) retest6 记录；其中 M07 实际分段由 B28/ADR-0029 继续承接，机制与替身结果不代表真实模型闭环。
- B26 自身范围已于 2026-10-24 完成；与 B27 专业调用完成后的生命周期/自然表达联合回归由 [B27](slices/B27-systematic-prompt-and-intent-integration.md) CP4 承接，B27 不得因 B26 通过直接标完成。
- 原生补验沿各任务已冻结的契约与矩阵；若复现新的 canon 写入缺陷，先登记 CP0、按作者升级规则处理，不直接改断言。
- **I10 文学盲评（待作者安排）**：P1 canonical-3e 与原生 scoped 均只提供可盲评样本/工程证据；文学质量收益判定须作者指定盲评负责人与时机，AI 不代签、不以自动化分数替代。
- 凭据、外部探索、人工盲评、durable 等条件项及其承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；它们不因未列为候选而消失。
