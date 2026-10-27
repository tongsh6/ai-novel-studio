# B58：作者批准策略统一与审计

- 状态：**todo（先对账现有 receipt/audit，再决定是否需新实体，未开工）**。
- 登记日期：2026-10-27；来源：`32-human-approval-policy` 仍是草案，统一 approval policy 映射、approval_record 与死亡/结局/高预算等风险矩阵未形成完整证据。
- 上游：`docs/design/quality/32-human-approval-policy.md`、[AU04](AU04-file-level-closure.md)、[AU05](AU05-file-level-closure.md)、[AU13-ledgers-and-reconciliation](../../docs/design/acceptance/author/AU-13-ledgers-and-reconciliation.md)。

## 1. 目标

先回答现有 `author_action / adoption / receipt / StateTrace / DecisionTrace` 已能满足多少“作者批准”语义，再决定是否确实需要新的 approval_record 或独立实体，而不是为草案直接建表。

需要对齐：

- 高风险确认、候选采纳、覆盖、编辑、审读裁决、撤销/放弃的记录；
- 批准对象、基线版本、作者动作、执行结果与失败；
- 死亡、结局、高预算、跨作品、stale、重复、取消等风险矩阵；
- 不可 bypass 的作者主权和可回放审计。

## 2. 开工七问

1. **Contract**：32 的批准策略、VS-04/VS-05/VS-03、ADR-0010/0019/0024、现有 Action/Receipt/StateTrace/DecisionTrace。先比较“复用现有事实”与“需要新实体”的不可共存差异。
2. **Invariant**：高风险动作不能绕过作者批准；批准对象/版本/动作/结果可回放；不得用按钮存在代替真实批准；失败/重复/过期不产生第二次写入；新实体只有在现有事实不足时才创建。
3. **Boundary**：application adoption/confirmation/review、persistence 现有 receipt/trace、web/frontend 现有动作与 why；不先建 approval_record 表或第二套批准状态机。
4. **Consumer**：高风险作者决策、audit/experience、Replay/why 和后续策略维护者。
5. **Proof**：高风险/结局/预算/stale/重复/取消/跨作品矩阵；批准前后版本与结果一致；不可 bypass、no-provider replay、失败无权威 diff。
6. **Acceptance Driver**：外部驱动真实 Tauri 执行高风险确认、采纳、覆盖、审读裁决、取消/重试并回放；产品验收感知逻辑 **no**。
7. **Exploration**：批准对象、版本、动作、回执、失败与历史可从 why/replay 查询；不把 UI 点击日志当完整批准证据。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 对账 32 的每类批准语义与现有 receipt/trace：已满足、缺字段、缺查询、真正缺口；确认无需新实体的部分不建表 | 未开工 |
| CP1 | 若确有缺口，冻结最小 approval contract（对象/版本/动作/结果/来源/失败），优先扩展现有 receipt/trace；只有不可替代时才论证新实体 | 未开工 |
| CP2 | 实现统一审计与风险矩阵：死亡/结局/高预算/stale/重复/取消/跨作品；不可 bypass 与失败回滚 | 未开工 |
| CP3 | 真实 Tauri 与 replay 全链，作者 why 可见批准依据；同步 32 文档，未覆盖类型保持 deferred | 未开工 |

## 4. 非目标

- 不为草案直接建 approval_record 表或第二套批准状态机。
- 不把 author_action 按钮存在、run completed 或工具成功当作批准完成。
- 不把局部 AU04/AU05/AU13 通过外推为完整 policy 完成。
- 不用自动修改正文/设定代替作者批准，不把文学评价 I10 混进审计通过。
- 不把所有确认都强制人工点击；低风险自动通过仍须有明确 policy 和留痕。

## 5. 验证与恢复

- 高风险/结局/预算等场景均有真实批准对象、版本、动作、结果和可回放审计；重复/过期/跨作品不能执行。
- 如果现有 receipt/trace 足够，更新 32 的映射而无需新实体；若不足，先证明不可替代再实施最小增量。
- 恢复时先读 32、AU04/AU05/AU13、ADR-0010/0019/0024；不能从草案直接开始建表。
