# B44：摘要与审读报告的持久化转换边界

- 状态：**todo（Q1CB 相邻持久化强制点，未开工）**。
- 登记日期：2026-10-27；来源：`ChapterSummaryRepo` 与 `ReconciliationReportRepo` 仍有 `update_all`，可绕过 changeset 和 ADR-0019 转换矩阵。
- 上游：ADR-0019、[Q1CB](Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md)、[VS-00F](VS-00F-five-ledgers-three-state.md)、[VS-00C](../../docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md)。

## 1. 问题

Draft 的转换矩阵已落地，但相邻对象仍有直接批量更新：

- `ChapterSummaryRepo.supersede_prior_accepted/2` 直接 `update_all(status=SUPERSEDED)`；`update_status/2` 也未经过统一矩阵校验。
- `ReconciliationReportRepo.insert_superseding/1` 直接批量 SUPERSEDED 既有 TENTATIVE 报告。

合法 accepted→superseded 路径本身合法，问题在于仓储边界不能保证其他非法跃迁必被阻止。不能据此宣称已有非法数据，也不能以“调用方当前合法”豁免持久化不变量。

## 2. 开工七问

1. **Contract**：ADR-0019 与 `NovelDomain.AdoptionStatus.transition_allowed?/2` 的单一矩阵、章摘要和审读报告 adoption 七态。
2. **Invariant**：仓储入口非法转换必须 changeset error/事务回滚；合法 tentative→accepted、accepted→superseded 不回归；批量操作逐行校验，不用 update_all 绕过。
3. **Boundary**：仅 `novel_persistence` 两个 repo 及必要 domain 纯函数/测试；application 只核对调用方；不改 UI、不重做 Draft、不建第二矩阵。
4. **Consumer**：章摘要维护、审读报告当前态、写作/阅读摘要、Replay 与后续持久化维护者。
5. **Proof**：直接仓储注入非法转换（如非法回到 ACCEPTED）失败且事务回滚；合法 supersede 与历史保留正常；现有摘要/审读测试和 D3/D5/AU13/AU14 场景不回归。
6. **Acceptance Driver**：以 persistence 集成测试为主，并选一条真实摘要/审读页面链证明合法行为未变；产品验收感知逻辑 **no**。
7. **Exploration**：当前 accepted/superseded 摘要与报告可从既有读取面查询；历史状态转换可通过 trace/replay 解释，不新增表。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 核对两个 repo 所有写路径、调用方合法前提与 Q1CB 明示相邻项；确认不扩大为“所有 persistence 都已统一” | 未开工 |
| CP1 | 逐行读取→矩阵校验→更新/插入；移除 update_all 绕过；失败事务回滚并保留原值 | 未开工 |
| CP2 | 直接 repo 非法/合法矩阵测试与既有调用回归；审读报告单活跃与历史语义不变 | 未开工 |
| CP3 | 与 VS-00F StateTrace 方案对齐但不合并实现；补真实页面合法回归与文档证据 | 未开工 |

## 4. 非目标

- 不重做 Draft 转换矩阵，不把本任务扩成所有仓储统一改造。
- 不把合法 supersede 当成 bug，不修改历史数据。
- 不新增 UI、卡片或第二套状态机。
- 不把 Q1CB 的其他相邻项（如 revive）提前实现； revive 仍按作者需求触发。

## 5. 验证与恢复

- 非法转换直接注入 repo 必失败且原记录不变；合法状态迁移无回归。
- 两个 repo 均无 `update_all` 绕过 changeset 的路径；批量更新每行均经统一矩阵。
- 恢复时先读 Q1CB、ADR-0019、VS-00F StateTrace 任务；后续维护若发现更多同类写点，另行按真实消费者登记，不默认包含在本任务。
