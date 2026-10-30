# B58：作者批准策略统一与审计

- 状态：**doing（2026-10-31 CP0 对账 done：现有 receipt/trace 可承接大部分批准语义，缺 approval policy registry/risk 映射与部分字段；CP1 最小契约待做，未建新实体）**。
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

## CP0 对账记录（2026-10-31）

### 现有事实源
- `author_action_receipts`（`AuthorActionReceipt`）：work/session/source_turn_ref/action_id/action_type/idempotency_key/status/result + 唯一索引；负责作者动作幂等与结果回执，不区分 approval/adoption 语义。
- `decision_traces`（`DecisionTraceRecord`）：decision_type/gate 结果/context/tool/behavior/state trace refs/redaction/replay policy；承接 why/replay 与 gate 决策，不是批准对象记录。
- `interactions` 内 `turn_result`：behavior 值（confirmation 生命周期）、`adoption_state.pending/resolved`、`truthfulness`；确认/采纳/放弃的页面事实主要在 TurnResult/Interaction。
- `StateTrace`/ledger 状态与 adoption/confirmation 业务结果；`ReplayService` 提供 author-safe why/replay。
- capability registry 的 `risk_class` 仅描述工具风险，不是 approval policy 或批准记录。

### 32 文档节点映射
| 32 节点 | 现有可承接事实 | 缺口 |
|---|---|---|
| §6.1 作品定位 | adoption accepted + action receipt + interaction | `approval_policy_ref/risk_class/base_revision` 未显式落 |
| §6.2 主角/反派重大设定 | adoption + character dossier + receipt | 同左；“已有大量下游内容后修改需 confirmation”未策略化 |
| §6.3 主线/核心冲突/结局方向 | adoption + plan/decision trace | 大修 confirmation policy 未注册；branch 未建模 |
| §6.4/6.5 卷纲/章节细纲 | adoption/ledger + receipt | 同左 |
| §6.6 重大人物命运（死亡/黑化/背叛等） | 无专门消费者；只能靠通用 confirmation/behavior | **真实缺口**：无 death/fate approval policy 与风险矩阵 |
| §6.7 大高潮方向 | 通用 confirmation/adoption | 无卷级高潮 confirmation policy |
| §6.8 结局方向 | 通用 adoption | “永远 human approval”未成为机械 gate；无分支/结局专用审计 |
| §7 低风险自动继续 | capability registry/authoring task policy | 自动继续策略分散，未映射 policy id |
| §11 审批记录字段 | receipt.status/result、decision_traces、adoption resolved | `approval_policy_ref/target_type/decision_note/decided_by/base_revision` 等未统一；无跨 adoption/confirmation/edit 的统一查询 |
| §12/13 UI/bypass | behavior/why/replay/quality finding override | 32 的 bypass_policy 未进入机械门序 |

### CP0 结论
- **不需要先建 `approval_record` 新表**：现有 receipt + decision_trace + interaction/adoption 事实已覆盖动作、对象、结果、幂等与回放；新建第二套批准状态机会与 `author_action_receipts`/TurnResult 冲突。
- 真实缺口是：`approval_policy` 未实现（policy id/risk_class/default_behavior/required_user_action/bypass_policy/audit_level）；死亡/结局/高潮/高预算等节点无机械 policy；approval record 字段未统一映射，尤其 approval_policy_ref、base_revision、decision_note、decided_by、target_type。
- CP1 应优先冻结**additive contract/mapping**（现有 receipt/decision_trace 字段扩展或结果 map 约定 + policy catalog），不建新实体；若 CP1 证明现有 receipt 无法承载，再按“不可替代”论证最小增量。

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
