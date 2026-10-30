# B58：作者批准策略统一与审计

- 状态：**doing（2026-10-31 CP0/CP1 done，CP2 done；CP3 partial：replay/Why 批准依据链路已实现并单测，真实 Tauri AU04 场景两次未产出 needs_confirmation，按预算停止并登记 reanchor）**。
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
| CP0 | 对账 32 的每类批准语义与现有 receipt/trace：已满足、缺字段、缺查询、真正缺口；确认无需新实体的部分不建表 | **done（§CP0）** |
| CP1 | 若确有缺口，冻结最小 approval contract（对象/版本/动作/结果/来源/失败），优先扩展现有 receipt/trace；只有不可替代时才论证新实体 | **done（32 §5.1/§11.1；§CP1）** |
| CP2 | 实现统一审计与风险矩阵：死亡/结局/高预算/stale/重复/取消/跨作品；不可 bypass 与失败回滚 | **done（§CP2）**：approval audit 投影/持久化完成；命运/结局/预算 deferred（无 consumer），页面/replay 归 CP3 |
| CP3 | 真实 Tauri 与 replay 全链，作者 why 可见批准依据；同步 32 文档，未覆盖类型保持 deferred | **partial（§CP3）**：replay API+Why UI 投影/单测完成；真实 AU04 页面确认卡未产出，reanchor |

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

## CP1 冻结记录（2026-10-31）

- 真源：[32 §5.1 最小 policy catalog](../../docs/design/quality/32-human-approval-policy.md#51-最小-policy-catalogb58-cp1-冻结) 与 [§11.1 additive 实现映射](../../docs/design/quality/32-human-approval-policy.md#111-additive-实现映射b58-cp1-冻结)。
- **不建新实体**：`approval_record` 是 `author_action_receipts` + `decision_traces` + interaction 的投影；新表会与幂等 receipt/第二状态机冲突。
- 当前 active policy 仅两条：`approval_policy.high_risk_canon_change`（ADOPTION_REQUIRED）与 `approval_policy.long_run_budget_gate`（CONFIRM_BEFORE_EXECUTE），均由既有 consumer 承接。
- deferred（无真实 consumer，不造假 gate）：人物命运/死亡、结局方向、大高潮方向、高预算具体阈值。
- 字段映射：已有 id/source_turn_ref/target_ref/decided_at 复用；`approval_policy_ref/target_type/risk_class/source_task_ref/decision_note` 走 additive result 键；`base_revision` 复用 adoption revision_base；`decided_by=author`；缺失字段不得补默认伪造。
- **CP2 下一步**：在 receipt result 记录 additive 字段（或复用结果 map），实现 decision 映射与读取；风险矩阵只覆盖已有真实 consumer 的节点；无 producer 的高风险节点保持 deferred；真实页面/回放证明不可 bypass、重复/过期/跨作品不执行。

## CP2 实施记录（2026-10-31，partial）

- 新增 `NovelApplication.ApprovalAudit.enrich/2`（纯函数）：对已有 consumer 的 adoption/confirmation 动作补 32 §11.1 冻结字段：
  - `approval_policy_ref`：canon 动作→`approval_policy.high_risk_canon_change`，确认动作→`approval_policy.long_run_budget_gate`；
  - `risk_class=HIGH`、`target_type`（仅真实 artifact_type/target_type）、`decision`（ACCEPTED/EDITED_ACCEPTED/DISCARDED/REJECTED/CANCELLED/CONFIRMED）、`decided_by=author`；
  - `source_task_ref`（run_id/long_run_task_ref）与 `base_revision`（仅真实字段）；缺失不补默认。
- `ActionIdempotencyService.record/3` 在写 receipt 前调用 enrich，字段随 `author_action_receipts.result` 持久化；重复查找仍返回原 receipt，不产生第二份批准记录。
- 测试：
  - `approval_audit_test`：adopt/edit/discard/confirm/cancel/failed、缺字段不伪造、未知动作不补 policy、base_revision/source_task_ref 透传；4/0；
  - channel 集成测试：真实 `author_action` 后 receipt 含 policy/risk/decision/decided_by，`target_type` 缺失保持 nil；5/0；
  - 全量 mix **1054/0**。
- 未完成/不冒充：
  - 人物命运/结局/大高潮/高预算具体阈值仍无真实 consumer，保持 deferred（32 §5.1），未实现假 gate；
  - 页面/replay 可见批准依据、失败回滚与不可 bypass 的真实页面矩阵归 CP3；stale/重复/取消/跨作品继续由既有 AU04/AU05 场景与测试承接，未在本 CP 重跑；
  - 未改表/schema/前端，approval_record 仍是 receipt/trace 投影。

## CP3 实施记录（2026-10-31，partial）

### 已完成（机制与作者可见投影）
- `AuthorActionReceiptRepo.list_by_source_turn/3`：按 work/session/source_turn 读取批准 receipt；跨 work/session 隔离有测试。
- `ApprovalAudit.project_receipt/1`：receipt → author-safe 批准记录（policy_ref/risk/decision/decided_by/decided_at/base_revision/source_task_ref），缺失字段不补。
- `TraceReplayService.fetch_turn_report/3` 在 `trace_summary.approvals` 返回该 turn 的批准记录；why/replay 仍走既有 author-safe 入口。
- 前端 `traceSummaryView` 把 approvals 映射为 Why 补充说明（「批准依据：作品变更采纳 · 已采纳（作者，风险 HIGH）」等），不泄漏 receipt 内部 id；copy 集中管理。
- 测试：receipt list 隔离、projection 单测、前端 why 映射；backend **1055/0**、frontend **654/654** + typecheck/lint。
- 证据路径（机制）：`artifacts/slice-verify/` 本轮无 PASS；测试为局部证据，不能当 CP3 真实页面完成。

### 真实页面 PASS（2026-10-31，adoption 路径）
- 当前 HEAD 运行并扩展 `au09-memory-taxonomy-write-policy`（真实 Tauri + 外部 driver）**PASS**：角色演化采纳后，候选 turn 的 replay 接口返回
  `trace_summary.approvals=[{approval_policy_ref: high_risk_canon_change, risk_class: HIGH, decision: ACCEPTED, decided_by: author}]`；
  证据 `artifacts/slice-verify/au09-memory-taxonomy-write-policy-tauri/approval-replay.json`。
- 作者可见 why 映射由 `traceSummaryView` 单测覆盖（「批准依据：…」）；replay 报告本身是作者安全入口，不泄漏 receipt 内部 id。
- 该 PASS 覆盖 active policy 的 adoption 路径；confirmation 路径（AU04）仍未闭环。

### 未完成/真实页面重锚
- 尝试当前 HEAD 既有 `au04-confirm-before-execute` 两次：均未收到 `status=needs_confirmation` + `confirm_before_execute` 的 turn_result（driver 200s bounded 超时）。未进入确认/批准动作，故无法取得 approval-replay/Why 页面证据。
- 根因范围：既有 AU04 场景的 seed/driver/判断链在当前 HEAD 未产出确认卡；不是本次 replay/Why 代码路径。按预算（同因 2 次）停止，登记 reanchor，不做第三次盲跑。
- 解除条件：先修/重锚 AU04 确认场景，使其真实产出确认卡与 author_action；再复用本 CP 已加入 driver 的 approval replay/why 断言。
- 未覆盖：失败回滚/不可 bypass 的真实页面矩阵；deferred 节点仍 deferred。

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
