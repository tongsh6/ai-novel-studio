# AU-04 执行任务与系统确认

> 作者视角：当我想让 AI 帮我做一些具体工作（如创建角色、生成大纲）时，AI 会给出它的执行建议。对于高风险操作，系统会要求我确认，只有我点头才会真正动手。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 让 AI "创建一个叫林烬的主角" | AI 给出建议方案，并说明即将创建的内容 |
| 提出一个很宏大的要求 | AI 诚实地说"这个太复杂，我只能先做第一步" |
| 看到 AI 的建议计划 | 系统展示 AI 想做的事和影响范围 |
| 点击"确认执行" | 系统真正执行任务，返回结果 |
| 说"先别弄，我想再改改" | 系统取消本次执行计划，回到讨论状态 |

明确不能做的：
- AI 不应在我不确认的情况下悄悄修改小说设定或章节
- AI 不应宣称做了它权限之外的事

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #2 | MicroPlan 只是建议 | C1 — 多步计划被降级 |
| #3 | Orchestrator 唯一门禁 | G1 — 8 个 gate 按序评估，第一个 block 即停止 |
| #4 | 默认只允许下一步 | G2 — `stop_after_next_action=true` |
| #6 | 写入默认 tentative | B1 — 确认前不产生 production write |
| #12 | 确认回答重新进入 gate | D1 — confirm 后重新跑 Orchestrator |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0002 | MicroPlan 最小 schema（字段 + forbidden semantics） |
| ADR-0003 | PlannerOutput Boundary 验证（6 项检查） |
| ADR-0004 | OrchestratorDecision 定义（decision_type × 5 code path） |
| ADR-0005 | Execution Gate Order（gate 0-11，VS-01 证明子集） |
| VS-01 Contract Pack §2 | MicroPlan schema + Proposed Action Shape |
| VS-01 Contract Pack §3 | PlannerOutput Boundary 最小 validation（6 条） |
| VS-01 Contract Pack §4 | Gate Order 子集（gates 0/1/3/5/7/9/10/11） |
| VS-01 Contract Pack §5 | OrchestratorDecision schema |
| VS-01 Contract Pack §6 | TurnResult Truthfulness Rules |
| VS-01 Contract Pack §8 | Proof 草案（7 条） |

---

## 4. 验收场景

### 场景组 A：MicroPlan 生成与校验

#### A1 — MicroPlan 结构完整性

**作为作者**，我不知道的是，AI 给我的每个执行建议背后都有一个结构化的 MicroPlan。它包含以下关键字段：

| 字段 | 类型 | VS-01 约束 |
|------|------|-----------|
| `plan_id` | string | 稳定 ID，可被 decision/trace 引用 |
| `turn_id` | string | 绑定当前 turn |
| `frame_ref` | string | 必须指向当前 primary DialogueFrame |
| `primary` | boolean | VS-01 必须为 true |
| `stop_after_next_action` | boolean | VS-01 必须为 true |
| `risk_hint` | enum | `:low` / `:medium` / `:high` |
| `proposed_actions` | array | 至少 1 项 |
| `state_changes_requested` | array | 只能表达候选变化 |
| `required_capabilities` | array | 只能表达 capability class/key |
| `fallback_strategy` | object | 降级或拒绝时的作者可见回应方向 |

**验证点**：
- [ ] `stop_after_next_action != true` → PlannerBoundary 拒绝
- [ ] `frame_ref` 不匹配 → PlannerBoundary 拒绝
- [ ] `proposed_actions` 为空 → MicroPlan 构造失败

**测试**：`execution_authority_test.exs` — `"rejects stop_after_next_action = false"` ✅、`"rejects frame_ref mismatch"` ✅

---

#### A2 — 禁止语义检查（MicroPlan.check_forbidden）

**作为作者**，Planner（LLM）可能在 MicroPlan 中夹带越权语义。系统必须在 OrchestratorDecision 前拦截。

**check_forbidden 覆盖的禁止语义**：
| 禁止语义 | 对应 gate | 
|----------|----------|
| `approved` / `ready_to_execute` 等执行批准词 | envelope_validation |
| `production_write_allowed` | envelope_validation |
| `tool_request` / `tool_result` id | envelope_validation |
| `adopted_state` | envelope_validation |
| `BehaviorState opened / closed` | envelope_validation |

**验证点**：
- [ ] 包含 `"approved"` 的 plan → `{:error, terms}`
- [ ] 包含 `"production_write_allowed"` 的 action summary → 拒绝
- [ ] `check_forbidden` 通过 → gate_envelope 返回 `:pass`

**测试**：`execution_authority_test.exs` — `"rejects 'approved' in plan content"` ✅、`"rejects 'production_write_allowed' in action summary"` ✅

---

#### A3 — PlannerBoundary 完整校验清单

**作为作者**，PlannerBoundary 在 gate order 之前先跑，验证 Planner 输出不是执行命令。

**PlannerBoundary.validate/2 三项检查**：
1. `frame_ref` 一致性：plan.frame_ref == frame.frame_id
2. `check_forbidden`：MicroPlan 不含禁止语义
3. `stop_after_next`：plan.stop_after_next_action == true

**合同要求但未实现**（VS-01 Contract Pack §3 共 6 条）：
- 第 4 条：`proposed_actions are structurally valid` — 未实现 ❌
- 第 6 条：`state_changes_requested are candidate-only` — 未实现 ❌

**代码**：`planner_boundary.ex:17-21`（3/6 条已实现）

---

### 场景组 B：Gate Order 逐门评估

#### B1 — 8 个 gate 的完整序列

**作为作者**，Orchestrator 按固定顺序跑 8 个 gate，第一个 block 即停止。后面不跑。

```
Gate 0: correlation         — frame_ref / turn_id / plan_id 一致性
Gate 1: envelope_validation — 禁止语义
Gate 3: action_scope        — 多步 > 1 → block
Gate 5: authority           — high_risk → block
Gate 7: budget              — 暂 pass-through（VS-01 不实现）
Gate 9: write_boundary      — production_candidate > 0 → block
Gate 10: trace_readiness     — 暂 pass-through（in-memory trace）
Gate 11: turn_result_compat  — 暂 pass-through
```

**验证点**：
- [ ] 全部 8 个 gate pass → `{:pass, results}` → 进入 `allow_tool_dispatch?` 判定
- [ ] 中间 gate block → `{:block, gate_name, reason, results_so_far}` → 不跑后续 gate
- [ ] Gate 0（correlation）fail → `:fail_with_recovery`
- [ ] Gate 1（envelope_validation）fail → `:fail_with_recovery`
- [ ] Gate 3（action_scope）fail → `:downgrade_to_dialogue`
- [ ] Gate 5（authority）fail → `:require_confirmation` + open behavior
- [ ] Gate 9（write_boundary）fail → `:require_confirmation` + open behavior

**当前实现**：gates 7/10/11 是 pass-through（`gate_budget`、`gate_trace_readiness`、`gate_turn_result_compat` 直接返回 `:pass`）。合同要求保留位置但不实现。⚠️

**测试**：`execution_authority_test.exs` — `"multi-step plan blocked by action_scope gate"` ✅、`"high-risk plan blocked by authority gate"` ✅、`"production_candidate blocked by write_boundary gate"` ✅、`"forbidden semantics blocked by envelope_validation gate"` ✅

---

#### B2 — gate 通过但 plan 不可执行时的降级

**作为作者**，MicroPlan 通过了所有 gate（低风险、单步），但 plan 的 action 不是可调度的工具。此时系统降级为对话。

**allow_tool_dispatch? 三重判断**：
```
not multi_step? AND not high_risk? AND length(actions) == 1 AND tool_dispatchable?
```

**验证点**：
- [ ] gates pass + allow_tool_dispatch? true → `:allow_tool` → 工具调度
- [ ] gates pass + allow_tool_dispatch? false → `:downgrade_to_dialogue`
  
**代码**：`execution_orchestrator.ex:33-39` — 注意 reason 中写了 `"gates passed but plan requires confirmation or is multi-step"`，但实际上 gates 全部 passed 时 plan 必然不是 multi-step/high-risk——这个 reason text 是 misleading。⚠️

---

#### B3 — gate_to_decision_type 映射完整性

**作为作者**，每个 gate block 对应一个 decision_type：

| gate_name | decision_type |
|-----------|--------------|
| `:action_scope` | `:downgrade_to_dialogue` |
| `:authority` | `:require_confirmation` |
| `:write_boundary` | `:require_confirmation` |
| `:envelope_validation` | `:fail_with_recovery` |
| `:correlation` | `:fail_with_recovery` |
| 其他未知 gate | `:require_confirmation`（**静默 fallback**）|

**验证点**：
- [ ] 已知 gate → 正确映射
- [ ] **未知 gate → 应记录 warning（当前静默 fallback 到 `:require_confirmation`）** ❌

**代码**：`execution_orchestrator.ex:145-150`

---

### 场景组 C：降级与拦截

（保持原有场景 C1、C2，已验证）

#### C1 — 超出能力降级
**测试**：`execution_authority_test.exs` — `"multi-step plan → downgrade_to_dialogue"` ✅

#### C2 — 越权请求拦截
**测试**：`execution_authority_test.exs` — `"forbidden semantics blocked by envelope_validation gate"` ✅

---

### 场景组 D：确认与结果

#### D1 — 确认产生 BehaviorState

**作为作者**，高风险操作触发确认后，Orchestrator 打开一个 BehaviorState，其字段必须完整。

**BehaviorState 创建字段验证**：
| 字段 | 值 | 要求 |
|------|-----|------|
| `behavior_type` | `:confirmation` 或 `:clarification` | 与 decision_type 对应 |
| `lifecycle_status` | `:awaiting_author` | 等待作者 |
| `blocking_actor` | `:author` | 阻塞作者 |
| `opened_at_turn_ref` | frame.turn_id | 绑定 turn |
| `opened_by_decision_ref` | decision_id | 绑定 decision |
| `required_next_action` | `"confirm_before_execute"` | 唯一下一步 |
| `available_actions` | 至少 2 个 action | confirm + reject/cancel |

**验证点**：
- [ ] confirmation → `behavior_type = :confirmation`，`required_next_action = "confirm_before_execute"`
- [ ] `lifecycle_status = :awaiting_author`
- [ ] `available_actions` 包含 `confirm_before_execute` 和 `reject_or_cancel_confirmation`

**代码**：`execution_orchestrator.ex:56-76` ✅

---

#### D2 — 确认后重新 gate（regating）

**作为作者**，我点击确认后，系统不是直接执行——而是重新跑 Orchestrator gate。

**验证点**：
- [ ] confirm action 被接收 → behavior 进入 `:resolving`（**当前未实现** ❌）
- [ ] 重新生成 MicroPlan（基于确认后的状态）
- [ ] 重新跑 Gate Order
- [ ] 新 decision 可能仍是 `:allow_tool`（如果条件满足）或新的 block

**当前实现**：`dialogue_gateway.ex` 的 `handle_action/2` 只做 validation，不做 behavior resolution + regating。❌

---

### 场景组 E：结果真实性

#### E1 — TurnResult truthfulness 约束

**作为作者**，不管决策结果是什么，TurnResult 不能谎报。

**truthfulness_constraints 映射**：
| decision_type | 约束 |
|--------------|------|
| `:downgrade_to_dialogue` | `no_action_executed` + `downgraded_to_conversation` |
| `:require_confirmation` | `no_action_executed` + `author_confirmation_required` |
| `:fail_with_recovery` | `no_action_executed` + `system_recovery_needed` |
| `:allow_tool` | `tool_dispatched` + `result_not_adoption` |

**验证点**：
- [ ] TurnResultBuilder 检查 `truthfulness_constraints`
- [ ] 如果 `no_action_executed` 但 assistant_message 声称执行了 → 降级或修正
- [ ] **当前实现：constraints 定义在 OrchestratorDecision 中但 TurnResultBuilder 未消费它们** ❌

**测试**：`execution_authority_test.exs` — `"truthfulness constraints prevent claiming execution"` ✅

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | MicroPlan 结构校验 | ✅ |
| A2 | 禁止语义检查 | ✅ |
| A3 | PlannerBoundary 6/3 校验 | ⚠️ 3/6 实现 |
| B1 | 8 gate 序列 + 逐门映射 | ⚠️ 3 个 pass-through |
| B2 | gate pass 但不可执行降级 | ⚠️ reason text misleading |
| B3 | gate→decision_type 映射 | ⚠️ 未知 gate 静默 fallback |
| C1 | 降级拦截 | ✅ |
| C2 | 越权拦截 | ✅ |
| D1 | 确认产生 BehaviorState | ✅ |
| D2 | 确认后 regating | ❌ 未实现 |
| E1 | TurnResult truthfulness | ⚠️ constraints 未消费 |

**通过率：4/11 完整 + 5/11 部分 = 约 59%**

---

## 6. 缺口

| 缺口 | 发现位置 | 影响 | 建议处理 |
|------|---------|------|---------|
| GAP-01 — PlannerBoundary 缺 3 项校验 | `planner_boundary.ex` | proposed_actions 结构 + state_changes 候选性未验证 | 补齐 `check_proposed_actions` + `check_state_changes` |
| GAP-02 — 3 个 gate 是 pass-through | `gate_order.ex:80-104` | budget / trace / compat 无实际逻辑 | VS-02/06/08 实现时依次接入 |
| GAP-03 — 未知 gate 静默 fallback | `execution_orchestrator.ex:150` | 新增 gate 忘记加映射 → 错误分类为 require_confirmation | 改为 `Logger.warning` + `:fail_with_recovery` |
| GAP-04 — Behavior resolution 未实现 | `dialogue_gateway.ex:179-193` | 作者确认后 behavior 不会 resolving → resolved | 在 `handle_action` 中增加 behavior resolution 分支 |
| GAP-05 — truthfulness constraints 未消费 | `turn_result_builder.ex` | OrchestratorDecision 的约束定义了但不被 TurnResult 检查 | TurnResultBuilder 读取并应用 constraints |
| GAP-06 — allow_tool_dispatch fallback reason text 错误 | `execution_orchestrator.ex:38` | 说"requires confirmation or is multi-step" 但实际两者都不是 | 修正 reason text |
| GAP-07 — 确认幂等性 | `action_validator.ex` | 重复点确认按钮可能产生重复执行 | 基于 `idempotency_key` 去重 |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/execution_authority_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
```
