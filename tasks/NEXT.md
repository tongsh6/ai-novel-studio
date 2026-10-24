# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B31-AUTHOR-REPLY-RUN-BINDING | **CP0 已完成（2026-10-25）**：真实 Tauri 复现两 live awaiting run 时普通主输入被 plain steer 到错误 run（Q 仍 open），根因=前端 visibleAgentRunMap 插入序 + 普通输入只看 selected run + JoinRestore 顺序无契约；显式 author_choice 路径正确。**CP1 进行中**：前端确定性 selectActiveAgentRun + 主输入 steer 条件/目标可见（task-41）；后端 expected_goal_version 校验 + JoinRestore 稳定序 + ack 绑定（task-42）→ CP2 场景复验/注册（task-43）。 | [B31](slices/B31-author-reply-run-binding.md) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B28-WHOLE-CHAPTER-REVISION | 完整章修订与同章采纳；含 B11D 转出项接单，数据边界不硬等全部提示词迁移。 | [B28](slices/B28-whole-chapter-revision.md) |
| B30-CHAPTER-STRUCTURE-MAINTENANCE | 按稳定身份维护原结构，补 B25 大纲物化 title-first 遗漏；正文与引用保持一致。 | [B30](slices/B30-chapter-structure-maintenance.md) |
| B29-EXISTING-CHARACTER-ROLE-REVISION | 同一角色主档案字段更新，档案、记忆与后续创作一致。 | [B29](slices/B29-existing-character-role-revision.md) |
| P1-AUTHORING-DOGFOOD | 每 3–5 周期插入 10 章级真实创作复验；检验上述能力组合后的体验。 | [真实创作复验](slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验) |

## 阻塞

- **B27 CP4 known-gap（2026-10-25，作者裁决）**：最后一次全量 retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0；key_set 仅 M01r2、overall 34/40=0.85 <0.90 → 不标 CP4 done，记录 known-gap（M01r2/M02/M08r2/M16r1/M18r1）并转入 B31；B27 不再全量 retest，后续 B28（format_only/整章）与产品硬化周期回归。证据见 [B27](slices/B27-systematic-prompt-and-intent-integration.md) retest6 记录。
- B26 自身范围已于 2026-10-24 完成；与 B27 专业调用完成后的生命周期/自然表达联合回归由 [B27](slices/B27-systematic-prompt-and-intent-integration.md) CP4 承接，B27 不得因 B26 通过直接标完成。
- B28–B30 的新操作契约需在各自 CP0 冻结；若复现仍可触发的错误 canon 写入，优先调整对应完整任务。
- 凭据、外部探索、人工盲评、durable 等条件项及其承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；它们不因未列为候选而消失。
