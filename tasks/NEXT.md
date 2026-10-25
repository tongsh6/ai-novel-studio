# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| P1-AUTHORING-DOGFOOD | **当前任务 / canonical 实跑完成但验收未过（2026-10-25）**：Strata iq3_s 单次 10 章复验（~43.3min）=10,002 字、7/10 章达标、维护 2/5；暴露真实模型判断误路由 24 次（写正文/设计角色/内容修订返 reply 等）+ P1 runner 维护措辞歧义。**P1 未关闭**，下一步候选：**B33 判断路由/上下文可靠性修复**（CP0 复现→契约→修复→scoped 真实模型复验）+ **P1 runner 维护措辞修复**；修复后 scoped 复验再决定 P1 收口。证据见 [真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验)。 | [真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B33-AUTHORING-INTENT-JUDGMENT-RELIABILITY | **新增候选（P1 暴露）**：真实模型长上下文下判断误路由（24 wrong-route）——写正文/设计角色/内容修订被判 reply/creative_directions/await；CP0 假设 H1–H4（随机性/上下文膨胀/规则不可达/模型边界），冻结「动作意图→execute 绑定或 ask/gap，不得吞掉」+ 上下文预算 + 有界纠错；修复后 scoped 真实模型复验（不整批重跑）。 | [B33](slices/B33-authoring-intent-judgment-reliability.md) |
| P1-RUNNER-MAINTENANCE-WORDING | **新增候选（P1 暴露）**：dogfood runner 维护拍措辞歧义——content_revision 未给具体段导致真实模型诚实 await_author；design_character 措辞/等待口径需对齐真实 UI；修 runner 后 scoped 维护拍复验（不整批重跑）。 | `frontend/slice-verify/dogfood-runner.mjs`；[VS00D 真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验) |

## 阻塞

- **B27 CP4 known-gap（2026-10-25，作者裁决）**：最后一次全量 retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0；key_set 仅 M01r2、overall 34/40=0.85 <0.90 → 不标 CP4 done，记录 known-gap（M01r2/M02/M08r2/M16r1/M18r1）并转入 B31；B27 不再全量 retest，后续 B28（format_only/整章）与产品硬化周期回归。证据见 [B27](slices/B27-systematic-prompt-and-intent-integration.md) retest6 记录；其中 M07 已由 B28 format_only 机制+确定性场景关闭（真实模型语义受 strata known-gap 限制）。
- B26 自身范围已于 2026-10-24 完成；与 B27 专业调用完成后的生命周期/自然表达联合回归由 [B27](slices/B27-systematic-prompt-and-intent-integration.md) CP4 承接，B27 不得因 B26 通过直接标完成。
- B28–B30 的新操作契约需在各自 CP0 冻结；若复现仍可触发的错误 canon 写入，优先调整对应完整任务。
- 凭据、外部探索、人工盲评、durable 等条件项及其承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；它们不因未列为候选而消失。
