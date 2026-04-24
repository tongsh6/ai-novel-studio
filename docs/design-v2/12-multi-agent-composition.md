# Multi-Agent Composition Contract v2

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的 Multi-Agent 子系统展开文档，并依赖 `docs/design-v2/06-planning-and-long-run.md` 与 `docs/design-v2/07-consistency-and-concurrency.md`。
>
> 目标：定义 v2 中多 Agent 组合的基础 contract，明确 Agent 身份、消息 envelope、委派生命周期、authority / budget 继承、artifact handoff 和父子 Agent 的边界。

---

## 1. 文档定位

本文回答 8 个问题：

1. 什么情况下系统中会存在多个 Agent
2. Agent 身份如何定义
3. Agent 间消息如何结构化表达
4. 委派任务如何创建、推进、收尾
5. authority 和 budget 如何继承或收缩
6. 子 Agent 产物如何被父 Agent 消费
7. 子 Agent 为什么不能绕过父级 contract 写 production
8. 多 Agent 如何与 long-run、consistency、memory 合作

本文不负责：

- 具体角色组合策略
- 某个角色的 prompt
- UI 上多 Agent 的展示样式

本文只定义多 Agent 的基础组合协议。

---

## 2. 设计目标

### 2.1 多 Agent 不是例外，而是单 Agent contract 的扩展

多 Agent 不是另起一套系统。

它应该建立在已有的：

- canonical result
- task lifecycle
- authority
- budget
- artifact
- revision

之上。

> canonical result 顶层 schema 由 ADR-0001（`adr/0001-turn-result-v2-schema.md`）冻结。Multi-Agent 场景下子 Agent 必须在 TurnResult `agent_id` 字段填自身 id，不得复用父 Agent 或 orchestrator 的 id。

### 2.2 子 Agent 只能是受控委派

子 Agent 不应成为“偷偷开第二套系统”。

任何 delegation 都必须：

- 可追踪
- 可审计
- 可预算
- 可取消
- 可回收产物

### 2.3 角色多样性不能破坏 authoritative 流程

未来可以有：

- Planner
- Writer
- Reviewer
- Continuity Checker
- Style Coach

但无论角色多少，进入 authoritative state 的路径必须仍然统一。

### 2.4 多 Agent 必须能退化为单 Agent

如果某个子 Agent 不启用，系统仍应能运行。

这意味着多 Agent 是组合增强，不是基础依赖。

---

## 3. 多 Agent 的定义

在 v2 中，多 Agent 指的是：

**一个父级 Agent 在某个 turn 或 task 内，基于明确目标和边界，委派一个或多个子 Agent 处理局部任务，并将子 Agent 返回的 artifact、status 和 explanation 纳入统一编排。**

多 Agent 不是：

- 多个 UI 面板各自乱跑
- 多个 provider 结果拼接
- 多线程裸执行

多 Agent 的关键是：

- agent identity
- delegation envelope
- authority inheritance
- budget inheritance
- artifact handoff
- parent-controlled adoption

---

## 4. Agent Identity Contract

每个 Agent 都必须有结构化身份。

### 4.1 最小身份字段

至少包括：

- `agent_id`
- `agent_type`
- `agent_role`
- `owner_ref`
- `parent_agent_ref`（可空）
- `workspace_scope_ref`
- `authority_scope`
- `budget_scope`
- `capability_profile_ref`
- `created_at`

### 4.2 `agent_type`

用于表达该 Agent 的执行形态，例如：

- orchestrator
- delegated_worker
- reviewer
- planner
- validator_agent

Foundation 不冻结最终枚举，但要求必须结构化。

### 4.3 `agent_role`

表示该 Agent 在当前组合中的职责角色。

角色是语义，不等于实现方式。

### 4.4 `parent_agent_ref`

子 Agent 必须明确知道自己是谁派生出来的。

没有 parent ref 的 delegated agent 属于非法状态。

---

## 5. 委派模型

### 5.1 delegation 是一等对象

任何父 Agent -> 子 Agent 的委派都必须形成 delegation record。

至少包括：

- `delegation_id`
- `parent_agent_ref`
- `child_agent_ref`
- `source_turn_ref`
- `source_task_ref`
- `goal`
- `requested_outputs`
- `scope_ref`
- `authority_scope`
- `budget_scope`
- `status`
- `created_at`

### 5.2 delegation 的本质

delegation 是：

- 一个子任务申请
- 一个权限与预算收缩边界
- 一个 artifact handoff 通道

### 5.3 delegation 不是直接执行

父 Agent 不能通过“口头描述”当成 delegation 已完成。  
必须有显式记录和状态。

---

## 6. Multi-Agent Message Envelope

这是本文最核心的硬骨之一。

### 6.1 message envelope 的目标

用于表达：

- 谁发给谁
- 基于哪个 task / turn
- 要求产出什么
- 允许使用什么权限和预算
- 返回了什么

### 6.2 请求 envelope 最小字段

至少包括：

- `message_id`
- `message_type`
- `sender_agent_ref`
- `receiver_agent_ref`
- `delegation_ref`
- `source_turn_ref`
- `source_task_ref`
- `goal`
- `context_refs`
- `requested_artifact_types`
- `authority_scope`
- `budget_scope`
- `base_revision_refs`
- `created_at`

### 6.3 响应 envelope 最小字段

至少包括：

- `message_id`
- `in_reply_to`
- `sender_agent_ref`
- `receiver_agent_ref`
- `delegation_ref`
- `status`
- `artifact_refs`
- `warning_refs`
- `failure_ref`
- `consumed_budget`
- `explanation_summary`
- `created_at`

### 6.4 `message_type`

至少支持：

- `DELEGATE`
- `STATUS_UPDATE`
- `ARTIFACT_RETURN`
- `WARNING`
- `FAILURE`
- `CANCEL`
- `RESUME`

### 6.5 envelope 是运行协议，不是聊天文本

即便内部最终用消息系统、函数调用或本地对象传递，这个 envelope 语义也必须成立。

---

## 7. authority 继承规则

多 Agent 最大的风险之一是权限失控。

### 7.1 默认收缩原则

子 Agent 默认只能获得父 Agent authority 的子集，不能自动放大。

### 7.2 authority 来源

子 Agent 的 authority 应由三者共同决定：

1. 父 Agent 当前 authority
2. delegation 所声明的 authority_scope
3. capability profile 限制

### 7.3 子 Agent 不得自提权

如果子 Agent 发现任务需要更高 authority，必须：

- 返回 escalation required
- 或触发 confirmation / checkpoint

不能自行越权写入。

### 7.4 推荐 authority 分层

至少支持抽象层级：

- `read_only`
- `propose_only`
- `tentative_write`
- `production_write`
- `task_control`

多 Agent 默认常见情形应停在：

- `read_only`
- `propose_only`
- `tentative_write`

---

## 8. budget 继承规则

### 8.1 budget 也是收缩型资源

子 Agent 只能使用父 Agent 或父 task 分配给它的预算子集。

### 8.2 最小 budget 字段

至少包括：

- token budget
- wall time budget
- invocation budget
- cost budget

### 8.3 consumed 必须回传

子 Agent 运行完成后，至少要回传：

- 本次消耗
- 累计消耗
- 是否触发预算告警

### 8.4 budget 超限默认策略

默认不能静默继续。

至少支持：

- stop and return warning
- checkpoint parent
- ask for escalation

---

## 9. 子 Agent 生命周期

### 9.1 最小生命周期

```text
CREATED
  -> READY
  -> RUNNING
  -> PAUSED
  -> COMPLETED
  -> CANCELLED
  -> FAILED
```

### 9.2 与 delegation 的关系

delegation status 与 child agent status 相关但不完全相同。

例如：

- 子 Agent `COMPLETED`
- delegation 仍可能处于 `AWAITING_PARENT_DECISION`

### 9.3 子 Agent 终态

终态至少包括：

- `COMPLETED`
- `CANCELLED`
- `FAILED`

终态不可逆。

---

## 10. delegation 生命周期

### 10.1 建议状态机

```text
PLANNED
  -> DISPATCHED
  -> RUNNING
  -> PAUSED
  -> ARTIFACT_RETURNED
  -> AWAITING_PARENT_DECISION
  -> ACCEPTED
  -> REJECTED
  -> CANCELLED
  -> FAILED
```

### 10.2 状态说明

- `PLANNED`
  - 委派已创建，尚未发给子 Agent

- `DISPATCHED`
  - 请求已发出

- `RUNNING`
  - 子 Agent 正在执行

- `PAUSED`
  - 子 Agent 或父 Agent 在安全点暂停

- `ARTIFACT_RETURNED`
  - 子 Agent 已返回产物

- `AWAITING_PARENT_DECISION`
  - 产物已回收，等待父 Agent 采纳、丢弃、再委派或分支

- `ACCEPTED`
  - 父 Agent 接收结果并继续编排

- `REJECTED`
  - 父 Agent 明确不采用该产物

- `CANCELLED`
  - 委派被取消

- `FAILED`
  - 委派无法继续

### 10.3 子 Agent 完成不代表 delegation 完成

父 Agent 没处理返回物前，delegation 仍未真正闭环。

---

## 11. Artifact handoff Contract

多 Agent 协作的核心不是“返回一段文本”，而是“返回受控 artifact”。

### 11.1 handoff 的最小要求

子 Agent 返回给父 Agent 的至少应是：

- artifact refs
- artifact types
- revision bases
- target scopes
- status
- explanation summary

### 11.2 artifact 默认不是 authoritative

子 Agent 返回的 artifact 默认是：

- tentative
- inspectable
- attributable

除非父 Agent 明确具备并行 production-write authority 且 contract 允许，否则子 Agent 返回物不能直接成为 authoritative state。

### 11.3 handoff 后的父 Agent 选择

至少支持：

- accept and continue
- request revision
- discard
- escalate to user confirmation
- convert to branch candidate

### 11.4 handoff 必须保留来源

任何被父 Agent 接收的 artifact，必须保留：

- producing child agent
- source delegation
- source task / turn

否则后续审计和解释会断。

---

## 12. 子 Agent 写入限制

### 12.1 默认限制

默认情况下，子 Agent 不得直接写 production state。

### 12.2 允许写入的默认范围

默认允许：

- read
- propose
- tentative artifact write

### 12.3 特殊授权

如果确实需要子 Agent 直接进行高等级写入，至少要满足：

1. delegation 明确声明 authority
2. 写入 scope 明确
3. 父 Agent 或系统 policy 允许
4. mutation 仍可追溯到 child agent 与 parent agent

### 12.4 即便特批，也不能绕过一致性检查

直接写 production 的子 Agent 仍必须遵守：

- base revision
- target scope
- adoption / mutation traceability

---

## 13. 父 Agent 的职责

多 Agent 不是把责任下放完就结束。

### 13.1 父 Agent 必须负责

至少包括：

- 选择是否委派
- 设置 delegation 范围
- 分配 authority / budget
- 收集子 Agent 结果
- 做最终整合或上抛
- 保持 canonical result 一致

> 「保持 canonical result 一致」由 ADR-0001 落实：父 Agent 整合时输出的 TurnResult 必须满足 ADR-0001 §决策内容 4 的 7 条跨字段约束（含 phase × next_action 互斥、behavior_state.active 终态 → resolution_ref 必填等）。

### 13.2 父 Agent 不得做的事

至少包括：

- 不记录 delegation 直接偷偷调用子 Agent
- 丢失子 Agent 产物来源
- 把子 Agent tentative 伪装成 authoritative result

### 13.3 父 Agent 是最终整合者

父 Agent 必须对外部系统负责：

- 结果如何呈现
- 产物是否进入 adoption
- 任务是否继续
- 是否需要 checkpoint / confirmation / correction

---

## 14. 与 long-run 的关系

多 Agent 可以嵌入 long-run，也可以被 long-run 驱动。

### 14.1 常见关系

至少包括：

- long-run task 中的某些 unit 委派给子 Agent
- 父 Agent 将一段长跑拆给多个子 Agent 处理局部任务
- Reviewer 作为并行子 Agent 审看生成结果

### 14.2 long-run 下的委派要求

如果 delegation 发生在 long-run 内，至少要继承：

- parent task ref
- checkpoint boundary
- budget slice
- authority slice
- revision base

### 14.3 long-run 中的子 Agent 结果默认回到 checkpoint 语义

子 Agent 的大批量返回不应直接绕过父任务的 checkpoint 设计。

默认应回到：

- pending artifacts
- parent checkpoint review
- parent adoption / discard path

---

## 15. 与一致性系统的关系

### 15.1 子 Agent 也必须携带 revision awareness

delegation 请求至少要带：

- base revision refs
- target scopes

### 15.2 父 Agent 不能假定子 Agent 的结果总是最新

子 Agent 返回 artifact 后，父 Agent 在采纳前仍要重新做一致性检查。

### 15.3 多 Agent 会放大冲突风险

因此系统至少要支持：

- child result stale detection
- branch suggestion
- parent checkpoint on conflict

---

## 16. 与 Memory 的关系

### 16.1 context_refs 必须显式

父 Agent 给子 Agent 的上下文不能靠隐式共享全内存。

必须至少显式提供：

- context refs
- summary refs
- task refs
- relevant object refs

### 16.2 子 Agent 的记忆默认局部化

子 Agent 默认不拥有整个 workspace 全量历史。

它只能访问：

- delegation 允许的上下文
- 其 role 所需的最小必要 memory slice

### 16.3 子 Agent 产出的 summary 也属于 memory artifact

可被后续：

- replay
- audit
- retrieval explanation

消费。

---

## 17. cancel / resume / failure

### 17.1 父级 cancel

父 Agent 或父 task cancel delegation 时：

- 子 Agent 应停止启动新工作
- 已完成 artifact 保留原状态
- 未完成运行要形成 interrupted 或 safe-stop 记录

### 17.2 子级 failure

子 Agent 失败不等于父 task 必然失败。

父 Agent 至少要能选择：

- retry child
- replace child
- branch
- checkpoint
- fail parent

### 17.3 子级 pause / resume

如果子 Agent 支持 pause / resume，其状态也必须回流到 delegation record。

---

## 18. 消息顺序与幂等

### 18.1 顺序性

对同一 delegation，消息至少应有：

- sequence number
- causal ordering ref

### 18.2 幂等

消息 envelope 必须支持幂等处理。

至少应支持：

- 重复 `STATUS_UPDATE` 不导致双重计费
- 重复 `ARTIFACT_RETURN` 不导致重复 adoption

### 18.3 父 Agent 必须能识别重复响应

否则多 Agent 会非常容易出现双重写入和双重消费。

---

## 19. 观测与审计

多 Agent 必须比单 Agent 更强地被观测。

### 19.1 trace 最低要求

至少要能追踪：

- 谁创建了哪个 child agent
- 谁向谁发了什么 delegation
- 谁消耗了多少 budget
- 哪些 artifact 从 child 回到了 parent
- parent 最终如何处置 child 结果

### 19.2 audit 最低要求

至少要保留：

- parent agent
- child agent
- authority delegation
- budget slice
- result handling path

### 19.3 explainability

至少能回答：

- 为什么要委派
- 为什么委派给这个角色
- 为什么子 Agent 的结果被接受或拒绝

---

## 20. 与 Domain 的接口

Domain 可以定义角色语义，但不能改写多 Agent 的基础组合规则。

### 20.1 Domain 可注册项

至少包括：

- agent roles
- delegation templates
- role-specific capability profiles
- handoff artifact expectations
- child result validation rules

### 20.2 Domain 不得改写项

Domain 不得改写：

- delegation 必须结构化记录
- child authority 默认收缩
- child artifact 默认非 authoritative
- parent 必须整合 child 结果
- adoption / mutation 仍需走一致性 contract

---

## 21. 与 UI 的接口

UI 不应该把多 Agent 表现成“多个聊天框乱飞”。

### 21.1 UI 可见内容

至少包括：

- delegation status
- child role
- consumed budget summary
- returned artifact summary
- parent decision summary

### 21.2 UI 不可见实现细节

UI 不应直接依赖：

- 内部消息总线实现
- 子 Agent prompt
- provider routing 细节

### 21.3 UI 关键场景

后续 UI 至少要覆盖：

- 子 Agent 委派中
- 子 Agent 返回产物待父级处理
- 子 Agent 失败后的父级分流
- 多 Agent checkpoint 汇总

---

## 22. 持久化与事件要求

多 Agent 至少要持久化：

- agent identities
- delegation records
- message envelopes
- child artifacts
- parent decision events
- budget slice records
- authority delegation records

### 22.1 最小事件集合

至少包括：

- agent_created
- delegation_created
- delegation_dispatched
- child_status_updated
- child_artifact_returned
- delegation_paused
- delegation_resumed
- delegation_cancelled
- delegation_failed
- delegation_accepted
- delegation_rejected

---

## 23. 契约测试要求

### 23.1 identity tests

验证：

- child agent 必须有 parent ref
- authority / budget scope 必须存在

### 23.2 message envelope tests

验证：

- 请求与响应字段完整
- sequence / idempotency 可工作

### 23.3 authority tests

验证：

- child 默认不能越权
- escalation required 路径存在

### 23.4 artifact handoff tests

验证：

- child artifact 返回后默认不是 authoritative
- parent decision 前不会误入 production

### 23.5 long-run integration tests

验证：

- long-run 内 delegation 正确继承 task / revision / budget
- child failure 不必然导致 parent fail

---

## 24. 本文冻结的硬骨

本文正式冻结以下多 Agent 硬骨：

1. 多 Agent 是单 Agent contract 的扩展，不是另起协议
2. 每个 child agent 必须有结构化 identity 与 parent ref
3. delegation 必须是一等对象
4. agent 间通信必须使用结构化 message envelope
5. child authority 与 budget 默认收缩，不能自提权
6. child artifact 默认非 authoritative
7. child 结果回到 parent 后仍需 parent 决策和一致性检查
8. child 不得绕过父级 contract 直接写 production
9. 多 Agent 必须可审计、可追踪、可解释
10. 多 Agent 必须能退化为单 Agent

---

## 25. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. role 枚举全集
2. message bus 或函数调用的底层实现
3. delegation 调度策略
4. 多 child 的并行 fan-out 上限
5. parent 如何选择某个具体 child provider

---

## 26. 下一步

多 Agent contract 之后，建议优先继续：

1. `13-v1-to-v2-migration.md`

原因：

- 现在 Foundation 的核心硬骨已经比较完整
- 下一步应该把这些 contract 如何落到当前仓库和现有数据上写清楚
