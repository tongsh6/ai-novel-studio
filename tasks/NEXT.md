# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

**队列已清空（2026-10-25）**：P1 canonical-3e final PASS；B33/B34/B35/B36/B37 done。残余：I10 文学盲评待作者指定负责人/时机（AI 不代签）；B38 世界规则保存判断候选 deferred（见下）。

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B38-WORLD-RULE-SAVE-INTENT | **deferred 候选（B34 CP3 模型级观察，未确认产品缺口）**：作者「保存X为世界规则」单次 replay 无结构化 tool_calls（畸形 tool XML），未 execute world_building/未写库；单次调用未跑产品纠错 loop，不能定为产品缺口。trigger=真实产品链复现或作者真实请求；当前不排期，登记为已知限制。 | [B38](slices/B38-world-rule-save-intent.md) |

## 阻塞

- **B27 CP4 known-gap（2026-10-25，作者裁决）**：最后一次全量 retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0；key_set 仅 M01r2、overall 34/40=0.85 <0.90 → 不标 CP4 done，记录 known-gap（M01r2/M02/M08r2/M16r1/M18r1）并转入 B31；B27 不再全量 retest，后续 B28（format_only/整章）与产品硬化周期回归。证据见 [B27](slices/B27-systematic-prompt-and-intent-integration.md) retest6 记录；其中 M07 已由 B28 format_only 机制+确定性场景关闭（真实模型语义受 strata known-gap 限制）。
- B26 自身范围已于 2026-10-24 完成；与 B27 专业调用完成后的生命周期/自然表达联合回归由 [B27](slices/B27-systematic-prompt-and-intent-integration.md) CP4 承接，B27 不得因 B26 通过直接标完成。
- B28–B30 的新操作契约需在各自 CP0 冻结；若复现仍可触发的错误 canon 写入，优先调整对应完整任务。
- 凭据、外部探索、人工盲评、durable 等条件项及其承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；它们不因未列为候选而消失。
