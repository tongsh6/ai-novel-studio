# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| P1-AUTHORING-DOGFOOD | **当前任务 / canonical 实跑完成但验收未过（2026-10-25）**：Strata iq3_s 单次 10 章复验（~43.3min）=10,002 字、7/10 章达标、维护 2/5；暴露真实模型判断误路由 24 次（写正文/设计角色/内容修订返 reply 等）+ P1 runner 维护措辞歧义。**P1 未关闭**；B33 CP0–CP2 已提交（`33077f0e`）；CP4 scoped replay 结果：design/role/S1 写章与 wrong-route 修复 PASS（0 事件），但 **content_revision 采纳整章误替换（1002→116 字，其他段落丢失）** → 新开 B35 修复（候选范围声明+采纳覆盖完整性）；P1 runner 措辞已修（`d5e87d9a`）。B35 修复+scoped replay 后做 P1 canonical-2（一次，post-fix 验收，不因分数重跑）。**B34（作者意图语料/验证覆盖，用户 2026-10-25 指令）CP0 完成**（146 turn→98 条去重作者原话；Top 缺口 progress_query/work_setup/discussion/world_foreshadow 边界/delegation-noise；证据 `artifacts/model-contracts/b34-cp0/`），**CP1/CP2 进行中**（prose task-91：progress_query/work_setup/discussion/设定边界/负例 fixture + 2026-10 窗口重采）；随后 CP3 实模 scoped 验证。证据见 [真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验)。 | [真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B35-REVISION-ADOPTION-SCOPE-INTEGRITY | **新增候选（B33 CP4 暴露）**：内容修订候选只含局部正文，采纳却按整章 replace_scope complete 覆盖 → 章节字数 1002→116、其他段落丢失；修复候选范围声明 + 采纳覆盖完整性校验/拒绝/回滚；真实模型 scoped replay 验证段落替换且其余逐字保留；通过后再做 P1 canonical-2。 | [B35](slices/B35-revision-adoption-scope-integrity.md) |
| B34-AUTHOR-INTENT-CORPUS-VALIDATION | **新增候选（用户 2026-10-25 指令）**：从 2026-06 起 stage 运行日志抽取真实作者意图与系统结果，建意图分类/频次/覆盖率矩阵，沉淀为 test-support fixture + 验收场景 + 真实模型 scoped case，完善验证体系。CP0 语料挖掘（aux）→CP1 契约→CP2 fixture 覆盖→CP3 实模 scoped 验证。 | [B34](slices/B34-author-intent-corpus-validation.md) |
| B33-AUTHORING-INTENT-JUDGMENT-RELIABILITY | **新增候选（P1 暴露）**：真实模型长上下文下判断误路由（24 wrong-route）——写正文/设计角色/内容修订被判 reply/creative_directions/await；CP0 假设 H1–H4（随机性/上下文膨胀/规则不可达/模型边界），冻结「动作意图→execute 绑定或 ask/gap，不得吞掉」+ 上下文预算 + 有界纠错；修复后 scoped 真实模型复验（不整批重跑）。 | [B33](slices/B33-authoring-intent-judgment-reliability.md) |

## 阻塞

- **B27 CP4 known-gap（2026-10-25，作者裁决）**：最后一次全量 retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0；key_set 仅 M01r2、overall 34/40=0.85 <0.90 → 不标 CP4 done，记录 known-gap（M01r2/M02/M08r2/M16r1/M18r1）并转入 B31；B27 不再全量 retest，后续 B28（format_only/整章）与产品硬化周期回归。证据见 [B27](slices/B27-systematic-prompt-and-intent-integration.md) retest6 记录；其中 M07 已由 B28 format_only 机制+确定性场景关闭（真实模型语义受 strata known-gap 限制）。
- B26 自身范围已于 2026-10-24 完成；与 B27 专业调用完成后的生命周期/自然表达联合回归由 [B27](slices/B27-systematic-prompt-and-intent-integration.md) CP4 承接，B27 不得因 B26 通过直接标完成。
- B28–B30 的新操作契约需在各自 CP0 冻结；若复现仍可触发的错误 canon 写入，优先调整对应完整任务。
- 凭据、外部探索、人工盲评、durable 等条件项及其承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；它们不因未列为候选而消失。
