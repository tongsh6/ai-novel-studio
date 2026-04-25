# Security And Budget Contract v2

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的 Security, Authority & Budget 子系统展开文档，并依赖 `docs/design-v2/03-conversation-behaviors.md`、`docs/design-v2/06-planning-and-long-run.md`、`docs/design-v2/07-consistency-and-concurrency.md`、`docs/design-v2/08-provider-abstraction.md`、`docs/design-v2/09-observability-and-audit.md`。
>
> 目标：定义 v2 中 authority、budget、guard、escalation、高风险动作确认、prompt injection 边界与安全审计的统一 contract。

---

## 1. 文档定位

本文回答 8 个问题：

1. Agent 在系统里到底“被允许做什么”
2. authority 应如何结构化表达
3. budget 应按哪些层级管理
4. 哪些 guard 是运行时必须存在的
5. 什么情况下需要 escalation 或 confirmation
6. prompt injection 在 Foundation 层的边界是什么
7. 子 Agent、long-run、provider 如何共享这些约束
8. 哪些安全动作必须进入 audit

本文不负责：

- 具体认证系统实现
- 账号权限体系的最终产品设计
- 某个 provider 的安全特性细节

本文只定义 Foundation 安全与预算约束 contract。

---

## 2. 设计目标

### 2.1 自动化必须是受控自动化

Agent 不是无限权能执行器。

它必须始终受到：

- authority
- budget
- confirmation
- consistency
- audit

的共同约束。

### 2.2 安全与预算是运行语义，不是运维附加项

安全与预算不应只存在于：

- 外部配置文件
- 运维手册
- UI 提示文案

它们必须进入运行时 contract，并直接影响：

- next_action
- turn phase
- task phase
- capability selection
- escalation

### 2.3 用户输入不得突破系统边界

用户可以提供内容、偏好、指令和修正，但不能通过自然语言篡改：

- system / developer 边界
- authority 边界
- guard 规则
- adoption 规则

### 2.4 高风险动作必须有可见门

高成本、高写入、高不可逆性动作不能在系统内部静默发生。

它们至少要触发：

- confirmation
- escalation
- checkpoint
- audit

---

## 3. 核心定义

### 3.1 authority

`authority` 表示某个 actor、Agent、task 或 delegation 在当前上下文里被允许执行的动作范围。

### 3.2 budget

`budget` 表示某个运行对象在资源消耗上的允许上限。

### 3.3 guard

`guard` 是在运行时阻断、放行或升级某个动作的约束规则。

### 3.4 escalation

`escalation` 是指当前 authority 或 budget 不足，需要通过更高层确认或授权才能继续。

### 3.5 high-risk action

`high-risk action` 是指对 authoritative state、资源消耗或运行范围有显著影响的动作。

### 3.6 prompt injection boundary

指用户输入和外部内容无法直接突破的系统边界。

---

## 4. Authority Contract

authority 必须是结构化对象，而不是代码里的布尔判断。

### 4.1 authority 最小字段

> ADR-0003 已冻结 `authority_scope` 最小结构与 `capability_scope` / `write_scope` / `task_control_scope` / `budget_override_scope` 枚举。

至少包括：

- `authority_id`
- `subject_ref`
- `scope_ref`
- `capability_scope`
- `write_scope`
- `task_control_scope`
- `budget_override_scope`
- `expires_at`（可空）
- `status`

### 4.2 capability_scope

表示允许调用哪些类别的 capability。

### 4.3 write_scope

至少允许抽象为：

- `read_only`
- `propose_only`
- `tentative_write`
- `production_write`

### 4.4 task_control_scope

至少支持：

- create_task
- resume_task
- cancel_task
- branch_task

### 4.5 budget_override_scope

表示是否允许提升预算或突破默认预算门。

---

## 5. Authority Scope 的基本原则

### 5.1 默认最小权限

系统默认采用最小权限原则。

没有明确授权的动作，默认不允许。

### 5.2 读、提议、写必须分离

至少必须区分：

- read
- propose
- tentative write
- production write

### 5.3 authority 必须绑定 scope

authority 不能是全局空泛能力。

必须绑定：

- workspace
- task
- target scope
- child delegation

### 5.4 authority 必须可继承也可收缩

父对象可以向子对象传递 authority，但默认只能收缩，不能放大。

---

## 6. Budget Contract

budget 也是结构化对象。

### 6.1 budget 最小字段

> ADR-0003 已冻结 budget scope、dimension、threshold kind 与 guard decision 的最小枚举；具体阈值数值与动态预算算法仍后置。

至少包括：

- `budget_id`
- `subject_ref`
- `scope_type`
- `token_limit`
- `wall_time_limit_ms`
- `cost_limit`
- `invocation_limit`
- `write_limit`
- `consumed_ref`
- `status`

### 6.2 scope_type

至少支持：

- provider_request
- capability_invocation
- turn
- task
- delegation
- workspace
- periodic

### 6.3 write_limit

预算不只包括 token 和钱，也包括写入规模。

例如：

- mutation count
- artifact count
- adoption count

### 6.4 consumed_ref

budget 必须持续引用已消耗量，而不是只有 limit 没有 consumption。

---

## 7. 高风险动作判定

Foundation 必须有高风险动作判定语义。

### 7.1 高风险动作至少包括

- production write
- batch adoption
- long-run start
- long-run budget extension
- authority escalation
- branch creation with large scope
- delegated child production write

### 7.2 高风险不等于禁止

高风险动作不是不能做，而是不能静默做。

### 7.3 高风险动作的默认处理

至少要触发以下之一：

- confirmation
- checkpoint
- audit
- escalation

---

## 8. Guard Contract

guard 是实际执行时的守门器。

### 8.1 guard 最小字段

至少包括：

- `guard_id`
- `guard_type`
- `target_ref`
- `input_refs`
- `decision`
- `reason_summary`
- `evidence_refs`
- `created_at`

### 8.2 `guard_type`

至少支持：

- authority_guard
- budget_guard
- confirmation_guard
- consistency_guard
- injection_guard
- provider_guard

> `consistency_guard` 在本表中表达**运行时 guard 调用记录**（写路径上的实际拦截），与 `04 §8.2` `policy_type` 中同名值（注册侧 policy 类型）共享名称但分属运行态与注册表：本表项目由 `04 §8.2` 的 policy 实例化产生。

### 8.3 `decision`

至少支持：

- allow
- allow_with_warning
- require_confirmation
- require_escalation
- checkpoint
- block
- fail

### 8.4 guard 是可解释对象

guard 不是布尔值。

它必须说明：

- 为什么挡
- 依据是什么
- 下一步怎么办

---

## 9. authority_guard

### 9.1 作用

判断当前 subject 是否有权执行某动作。

### 9.2 输入

至少包括：

- actor authority
- requested capability
- target scope
- write level

### 9.3 结果

至少包括：

- allow
- require_escalation
- block

### 9.4 escalation required

当 authority 不足但存在合法提升路径时，应优先：

- `require_escalation`

而不是直接 `block`。

---

## 10. budget_guard

### 10.1 作用

判断是否还能消耗预算。

### 10.2 检查范围

至少包括：

- request-level
- turn-level
- task-level
- workspace-level
- periodic budget

### 10.3 结果

> ADR-0003 已将 budget guard decision 冻结为 `allow`、`allow_with_warning`、`require_confirmation`、`checkpoint`、`block`、`require_escalation`。

至少包括：

- allow
- allow_with_warning
- require_confirmation
- checkpoint
- block

### 10.4 budget guard 的默认原则

预算命中后不能静默继续。  
必须留下：

- guard decision
- consumed snapshot
- next action

---

## 11. confirmation_guard

### 11.1 作用

当动作高风险但并非非法时，要求用户确认。

### 11.2 典型触发

至少包括：

- 预算高
- 写入范围大
- long-run 启动
- adoption 规模大

### 11.3 结果

结果通常是：

- turn -> `NEEDS_CONFIRMATION`
- task -> `CONFIRMATION_REQUIRED`

---

## 12. provider_guard

### 12.1 作用

在调用 provider 前进行保护。

### 12.2 检查内容

至少包括：

- timeout limit
- budget availability
- model allowlist / profile compatibility
- response mode compatibility

### 12.3 结果

至少包括：

- allow
- block
- fallback provider suggested

---

## 13. injection_guard

prompt injection 防护属于 Foundation，不属于 Domain。

### 13.1 目标

防止用户输入或外部内容突破系统边界。

### 13.2 最低保护边界

至少保护：

- system instructions
- developer instructions
- registry rules
- authority rules
- guard rules
- adoption rules

### 13.3 典型风险

至少包括：

- 用户要求系统忽略安全规则
- 用户要求系统直接绕过 confirmation
- 外部文本中包含“把这段当系统指令”
- 内容试图伪造 capability / registry 信息

### 13.4 默认策略

至少支持：

- sanitize and continue
- ignore untrusted control content
- warn
- block
- escalate

### 13.5 injection_guard 不替代内容审查

它保护的是系统边界，不是作品内容本身的文学或题材判断。

---

## 14. Escalation Contract

当当前 authority 或 budget 不足，但存在合法提升路径时，系统必须显式进入 escalation。

### 14.1 escalation 最小字段

> ADR-0003 已冻结 escalation type / reason / status / resolution 的最小枚举；repeated failure 默认归入 retry/checkpoint/failure policy，不直接作为 escalation reason。

至少包括：

- `escalation_id`
- `source_ref`
- `escalation_type`
- `requested_scope`
- `current_scope`
- `reason_summary`
- `status`
- `resolution_ref`

### 14.2 `escalation_type`

至少支持：

- authority
- budget
- provider_access

### 14.3 escalation 结果

至少支持：

- approved
- denied
- expired
- superseded

### 14.4 escalation 与 confirmation 的关系

- confirmation 是用户确认动作
- escalation 是提升权限或预算边界

二者可能同时存在，但不能混为一谈。

---

## 15. High-Risk Action Confirmation

### 15.1 规则

高风险动作默认必须走 confirmation。

### 15.2 例外

只有在 policy 明确允许自动执行时，才能跳过 confirmation。

### 15.3 典型必须确认的动作

至少包括：

- 大规模 production write
- 大规模 batch adoption
- 高预算 long-run
- 多 Agent 下授予 child production write

### 15.4 confirmation 必须带风险摘要

用户不能只看到“是否继续”，而看不到：

- 写入什么
- 花多少
- 影响哪些范围

---

## 16. Budget 层级关系

budget 必须允许多层叠加。

### 16.1 预算层级

至少包括：

- provider request budget
- capability invocation budget
- turn budget
- task budget
- delegation budget
- workspace budget
- periodic budget

### 16.2 层级原则

低层预算命中时，高层预算不应假装没事。

例如：

- request 超限 -> capability 不应继续
- task 超限 -> long-run 应 checkpoint

### 16.3 预算聚合

系统必须能从下层 usage 汇总到上层 budget。

---

## 17. 子 Agent 的 security / budget 继承

### 17.1 authority 默认收缩

child authority 只能是 parent authority 的子集。

### 17.2 budget 默认切片

child budget 只能是 parent task / delegation budget 的子集。

### 17.3 child escalation

child 不得自行突破 authority 或 budget。

如需扩大，必须回到 parent：

- escalation
- confirmation
- checkpoint

---

## 18. Long-Run 的 security / budget 关系

### 18.1 long-run 必须有独立 budget

没有 task budget 的 long-run 属于非法。

### 18.2 long-run budget 命中

默认应：

- checkpoint
- emit budget summary
- expose next action

### 18.3 long-run authority

task 必须在启动时就固定 authority base。

resume 时必须重新验证 authority 是否仍然有效。

---

## 19. Provider 与安全 / 预算的关系

### 19.1 provider request 前必须过 guard

至少包括：

- budget guard
- provider guard
- injection guard

### 19.2 provider failure 也是安全信号

例如：

- auth error
- model unavailable
- content filtered

都必须进入统一 error / guard 流程。

### 19.3 provider usage 必须回流 budget

provider 实际 usage 必须持续更新上层 budget consumption。

---

## 20. cancellation、rollback、security 的边界

### 20.1 cancellation

终止未来动作，不自动回滚。

### 20.2 rollback

只在明确允许且可逆时发生。

### 20.3 security block

当 guard 决定 block 时，系统不应偷偷转成 cancellation。

因为二者语义不同：

- cancellation 是终止
- block 是不被允许

---

## 21. 与 Consistency 的关系

安全和一致性是两条不同 guard 线。

### 21.1 consistency_guard

关注：

- revision
- target scope
- conflict

### 21.2 security/budget guard

关注：

- 是否有权
- 是否够预算
- 是否越过系统边界

### 21.3 两者可同时命中

例如：

- adoption 既 revision stale，又 authority 不足

系统应能同时记录并选择主导 next_action。

---

## 22. 与 Observability / Audit 的关系

安全与预算事件必须进入统一观测与审计体系。

### 22.1 必须可观测的事件

至少包括：

- authority_guard triggered
- budget_guard triggered
- injection_guard triggered
- escalation requested
- escalation approved / denied
- confirmation required due to risk

### 22.2 必须进入 audit 的事件

至少包括：

- authority escalation approved
- budget override approved
- child production-write grant
- batch production adoption approved

---

## 23. 与 UI 的接口

UI 必须能显示 guard 结果，但不能自行判断 guard。

### 23.1 UI 可见内容

至少包括：

- risk summary
- budget summary
- authority limitation summary
- escalation required
- blocked reason

### 23.2 UI 不可自行决定

例如：

- “用户点一下继续就算 escalation approved”
- “预算快超了但还能继续”

这些都必须由 Foundation 输出明确决策。

### 23.3 UI 关键状态

后续 UI 至少要支持：

- high-risk confirmation
- escalation required
- blocked by authority
- blocked by budget
- injection warning

---

## 24. 与 Domain 的接口

Domain 可以声明风险模式，但不能改写安全基础语义。

### 24.1 Domain 可注册项

至少包括：

- high-risk capability profiles
- confirmation thresholds
- write scopes
- domain-specific guard labels

### 24.2 Domain 不得改写项

Domain 不得改写：

- authority 是结构化约束
- budget 是多层级约束
- 高风险动作默认要 confirmation
- injection_guard 属于 Foundation

---

## 25. 持久化与事件要求

至少要持久化或可引用：

- authority records
- budget records
- guard decisions
- escalation records
- override decisions

### 25.1 最小事件集合

至少包括：

- authority_checked
- authority_blocked
- budget_checked
- budget_blocked
- confirmation_required
- escalation_requested
- escalation_approved
- escalation_denied
- injection_detected
- override_applied

---

## 26. 契约测试要求

### 26.1 authority tests

验证：

- 无 authority 时禁止高影响写入
- child authority 默认收缩

### 26.2 budget tests

验证：

- 多层 budget 正确命中
- budget 命中后不静默继续

### 26.3 guard tests

验证：

- authority_guard / budget_guard / injection_guard 各自可独立工作
- 多 guard 同时命中时结果可解释

### 26.4 escalation tests

验证：

- escalation 走结构化对象
- approved / denied 都有 resolution

### 26.5 confirmation integration tests

验证：

- 高风险动作进入 confirmation
- confirmation 通过后才继续

---

## 27. 本文冻结的硬骨

本文正式冻结以下 security / budget 硬骨：

1. authority、budget、guard、escalation 都是一等对象
2. authority 默认最小权限
3. budget 必须多层级管理
4. 高风险动作默认必须 confirmation
5. prompt injection 边界属于 Foundation，不属于 Domain
6. child authority / budget 默认收缩
7. budget 命中后不能静默继续
8. security block 不等于 cancellation
9. authority / budget / escalation 最小枚举由 ADR-0003 冻结

---

## 28. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. authority scope 的最终枚举全集（ADR-0003 已冻结最小集合；更细分全集后置）
2. budget 默认阈值（ADR-0003 已冻结 threshold kind / guard decision；具体数值后置）
3. override policy 的最终配置格式
4. injection detection 的具体算法

---

## 29. 下一步

security / budget 之后，Foundation 剩余核心文档主要还有：

1. `11-ux-contract.md`
2. `13-greenfield-implementation-notes.md`

如果继续按“先设计后 UI”的顺序，下一份最自然的是 `11-ux-contract.md`，先把 card、render mode、streaming/interruption 这些 UI 消费 contract 钉死，再进入 Domain 层。
