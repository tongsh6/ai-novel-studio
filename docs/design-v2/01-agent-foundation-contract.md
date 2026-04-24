# Agent Foundation Contract v2

> 状态：草案
>
> 角色：`docs/design-v2/00-overview.md` 的第一份展开文档。
>
> 目标：定义 Layer 1 `Agent Foundation Layer` 的正式 contract。本文回答的不是“小说怎么写”，而是“一个完整的 Agent 基础层必须提供什么语义、什么边界、什么开放接口，以及绝不能承担什么业务责任”。

---

## 1. 文档定位

本文是 v2 的 Foundation 总契约。

它的作用有四个：

1. 为后续 Foundation 文档提供总边界。
2. 为 Domain 层提供可依赖的稳定接口。
3. 为 UI 层提供可投影的稳定语义。
4. 为 v1 -> v2 的迁移提供判断标准。

本文不展开以下细节，这些会在后续独立文档中细化：

- 各状态机的完整迁移表
- 记忆缩减算法
- 长跑副作用处理
- 并发与一致性细节
- Provider 接口细节
- UI card schema 细节

本文只定义这些细节必须落在什么边界内。

---

## 2. Foundation 的定义

`Agent Foundation Layer` 是一个业务无关的 Agent 基础设施层。

它不关心“章节”“伏笔”“人物”“卷”“正文”等小说术语。  
它只关心：

- 一次 turn 如何进入、决策、执行、结束
- 一个 task 如何规划、暂停、续跑、取消
- 一个 capability 如何注册、调用、校验、计量
- 一个 structured object 如何读写、版本化、审计
- 一个 Agent 如何被观测、受预算约束、接受中断、返回统一结果

Foundation 解决的是“Agent 工程问题”，不是“小说业务问题”。

---

## 3. 设计目标

Foundation 必须同时满足以下目标：

### 3.1 统一交互语义

无论是：

- 单轮对话
- clarification
- confirmation
- long-run checkpoint
- cancellation
- failure

都必须落回统一的 canonical result 语义。

### 3.2 统一编排语义

无论 Agent 最终是：

- 单 Agent
- 父子 Agent
- 同步执行
- 异步长跑

都必须共享一致的编排边界和状态机原则。

### 3.3 统一副作用语义

Foundation 必须明确：

- 什么算读
- 什么算写
- 什么算 tentative
- 什么算 production
- 什么算 rollback
- 什么算 adoption

不能把这些语义留给具体业务 executor 临时决定。

### 3.4 统一可观测语义

任何一次 Agent 行为都应能够被：

- 追踪
- 统计
- 回放
- 审计
- 解释

### 3.5 保持业务无关

Foundation 可以暴露 object store、intent registry、capability registry、hook 机制等抽象，但不能内置小说业务对象或小说业务判断。

---

## 4. 非目标

Foundation 当前不负责：

1. 小说对象定义
2. 小说连续性规则
3. 小说 prompt 设计
4. 小说 intent catalog
5. 阅读模式具体页面
6. 结构面板具体字段
7. 任何特定业务的 worldrule 语义

这些都属于 Domain 层或 UI 层。

---

## 5. 分层关系

基础分层如下：

```text
Layer 3: UI Layer
  workbench / cards / structure panel / reading mode

Layer 2: Domain Layer
  novel objects / novel intents / domain validators / context policies / domain hooks

Layer 1: Foundation Layer
  contracts / orchestration / state machines / capability / memory / provider / observability / security
```

依赖规则：

```text
UI -> Domain -> Foundation
Foundation -/-> Domain
Foundation -/-> UI
Domain -/-> UI
```

含义：

- UI 只能消费 Domain 和 Foundation 已定义好的语义，不能发明新的运行时状态。
- Domain 只能注册 Foundation 提供的扩展点，不能改写 Foundation 的工作流语义。
- Foundation 不得感知任何业务名词。

---

## 6. Foundation 的 12 个子系统

Foundation 由 12 个子系统组成。它们是并列模块，但不是完全独立；依赖方向要固定。

### 6.1 子系统清单

1. Interaction Contract
2. Turn & Task State Machines
3. Conversation Behaviors
4. Capability & Intent Registry
5. Memory Model
6. Planning & Orchestration
7. Provider Abstraction
8. Observability & Audit
9. Security, Authority & Budget
10. Evolution Governance
11. UX Contract
12. Multi-Agent Composition

### 6.2 顶层依赖方向

建议依赖关系：

```text
Interaction Contract
  -> Turn & Task State Machines
  -> Conversation Behaviors
  -> UX Contract

Capability & Intent Registry
  -> Planning & Orchestration
  -> Memory Model
  -> Security, Authority & Budget

Provider Abstraction
  -> Capability & Intent Registry
  -> Planning & Orchestration
  -> Observability & Audit

Turn & Task State Machines
  -> Planning & Orchestration
  -> UX Contract
  -> Observability & Audit

Memory Model
  -> Planning & Orchestration
  -> Observability & Audit
  -> Multi-Agent Composition

Security, Authority & Budget
  -> Planning & Orchestration
  -> Capability & Intent Registry
  -> Multi-Agent Composition

Evolution Governance
  -> all subsystems
```

约束：

- `Evolution Governance` 对所有子系统生效，但不拥有运行时职责。
- `UX Contract` 只能消费其他子系统定义出的状态与结果，不能反向定义状态机。
- `Multi-Agent Composition` 只能建立在单 Agent contract 已成立的前提上。

---

## 7. 顶层运行模型

Foundation 定义的最小运行单元有 5 类：

1. `turn`
2. `task`
3. `capability invocation`
4. `artifact`
5. `object mutation`

它们之间的关系如下：

```text
user input
  -> turn
    -> route / resolve / behavior decision
    -> optional capability invocation(s)
    -> optional task creation or task continuation
    -> zero or more artifact writes
    -> optional object mutation proposals
    -> canonical result
```

### 7.1 turn

`turn` 是一次用户与 Agent 的最小交互闭环。

它必须满足：

- 有唯一 id
- 有输入
- 有运行 phase
- 有状态
- 有可回放结果
- 有可追踪 trace

### 7.2 task

`task` 是可以跨多个 turn 存续的工作单元。

它可以是：

- long-run task
- multi-step planning task
- future multi-agent delegated task

`task` 不能脱离 turn 存在。  
任何 task 的创建、恢复、取消、分支、完成，都必须由某个 turn 驱动并被记录。

### 7.3 capability invocation

`capability invocation` 是一次可执行能力调用。

它可以是：

- 调模型
- 调工具
- 调存储层
- 调子 Agent

但必须被标准化为统一的可追踪调用记录。

### 7.4 artifact

`artifact` 是 Agent 产生的中间或最终产物。

它可以是：

- assistant message
- structured card
- tentative text
- proposed object patch
- generated plan
- trace snapshot

并非所有 artifact 都是 production state。

### 7.5 object mutation

`object mutation` 是对结构化对象的状态变更。

Foundation 要求：

- mutation 必须可审计
- mutation 必须可版本化
- mutation 必须归属某个 turn 或 task
- mutation 可以是 tentative 或 adopted
- mutation 不能是 UI 无痕直接写入

---

## 8. Foundation 的全局不变量

以下规则适用于整个 Foundation。它们属于硬骨。

### 8.1 单一 canonical result

任何 turn 最终都必须产出统一顶层结果对象。  
不能出现：

- 某些路径只返回纯文本
- 某些路径只返回 route packet
- 某些路径只返回 execute packet

### 8.2 Orchestrator 是 turn 的唯一编排入口

单轮 turn 只能从 Orchestrator 进入。  
任何 capability、task、clarification、confirmation、cancellation、correction，都不能绕开它直接写生产结果。

### 8.3 Foundation 不创作业务内容

Foundation 可以组织、校验、记忆、预算、审计，但不能承担小说业务创作决策。

### 8.4 结构化写入必须可追溯

任何对 object store 的写入，都必须至少能追溯到：

- source turn id
- source task id（如有）
- actor
- authority scope
- timestamp
- revision base

### 8.5 状态迁移必须显式

所有 turn、task、artifact、clarification 等状态变更都必须是显式事件，而不是通过“覆盖整条记录”隐式发生。

### 8.6 高风险动作必须可确认

高消耗、高写入量、高不可逆性的动作不能直接执行，必须支持 confirmation gate。

### 8.7 UI 不能发明语义

UI 可以选择如何呈现，但不能凭自己推断：

- 当前是否处于 checkpoint
- 某个 artifact 是否已 adopted
- 某个 cancellation 是否真的生效

这些必须由 Foundation contract 明确给出。

### 8.8 Domain 只能扩展，不得改写

Domain 可以注册新的：

- object types
- intents
- validators
- hooks
- context policies

但不能改写：

- canonical result 顶层形状
- turn 基础 phase 语义
- authority / budget contract
- observability contract

---

## 9. Interaction Contract 边界

Foundation 必须定义统一的 interaction contract。

至少包含：

- `TurnInput`
- `TurnResult`
- `NextAction`
- `AssistantMessage`
- `ValidationEnvelope`
- `UsageEnvelope`
- `TraceRef`

### 9.1 TurnInput 最小字段

最小输入 contract 必须支持：

- `work_id` 或 domain scope id
- `user_message`
- `request_meta`
- `active_behavior_context`
- `idempotency_key`
- `workspace_context_ref`

说明：

- 这里的 `work_id` 只是 domain scope id 的一个示例，不应被 Foundation 写死为小说术语。
- `active_behavior_context` 用于承载 clarification / confirmation / correction 的续轮语义。

### 9.2 TurnResult 最小职责

`TurnResult` 至少要表达：

- 这轮发生了什么
- 当前系统处于什么状态
- 用户接下来应该做什么
- 是否已产生可展示结果
- 是否已产生未采纳产物
- 是否存在风险、错误、重试建议

> 顶层 schema 已由 ADR-0001（`adr/0001-turn-result-v2-schema.md`）冻结为 14 必填 + 5 可选字段、5 条 canonical 路径、7 条跨字段约束。本节仅描述职责边界；字段级 schema 与 `$ref` 占位以 ADR-0001 为权威。

### 9.3 NextAction 不是 UI 提示，而是运行语义

`NextAction` 表示运行时下一步语义，例如：

- ask user
- confirm before execute
- show result
- retry system
- resume task
- no further action

UI 只能投影它，不能自造新的下一步类型。

---

## 10. State Machine Contract 边界

Foundation 必须为以下对象定义正式状态机：

- turn
- clarification
- confirmation
- task
- artifact adoption

### 10.1 必须区分 phase 与 status

`phase` 表示工作流位置。  
`status` 表示当前是否仍需外部动作或系统动作。

二者不能混用。

### 10.2 终态不可逆

以下终态一旦进入，必须通过新实体或新事件处理后续变化，而不是原地改回：

- completed
- failed
- cancelled
- discarded
- expired

### 10.3 恢复必须表现为新事件

例如：

- `CHECKPOINT -> RESUMING -> RUNNING`
- `OPEN -> RESOLVED`
- `TENTATIVE -> EDITED_ACCEPTED`

不能通过简单字段覆盖假装恢复。

---

## 11. Conversation Behavior Contract 边界

Foundation 必须把以下行为看作第一等公民，而不是 prompt 里的话术：

- clarification
- confirmation
- rejection
- cancellation
- correction

### 11.1 clarification

用于缺失必要执行信息时的追问。

最小 contract：

- source turn
- target intent / target action
- required fields
- current resolved fields
- prompt message
- expiry policy

### 11.2 confirmation

用于信息足够但动作高风险时的确认。

最小 contract：

- proposed action
- risk summary
- budget estimate
- affected scope
- accept / reject / modify paths

### 11.3 rejection

用于不允许或不应执行的请求。

最小 contract：

- rejection reason code
- user-facing explanation
- allowed alternatives

### 11.4 cancellation

用于终止 turn 或 task。

最小 contract：

- target entity
- cancellation scope
- effect summary
- residual artifacts handling policy

### 11.5 correction

用于推翻上一轮识别、参数、结果或 mutation。

最小 contract：

- corrected target
- correction source
- whether rollback is possible
- whether new compensating event is required

---

## 12. Capability & Intent Contract 边界

Foundation 必须同时支持 `intent` 和 `capability`，但二者职责不同。

### 12.1 intent

`intent` 是用户意图的结构化分类。

它回答：

- 用户想让系统做什么
- 要走哪类业务能力
- 需要哪些 slots

### 12.2 capability

`capability` 是系统可执行能力的注册项。

它回答：

- 系统会做什么
- 怎么执行
- 会消耗什么
- 会写什么
- 能不能中断 / 重试 / 流式输出

### 12.3 强制边界

- Router 负责意图识别，不负责执行业务。
- Capability 负责执行，不负责理解用户最终目的。
- Validator 负责校验，不负责弥补业务设计缺陷。

### 12.4 Registry 是一等对象

Foundation 必须把 registry 本身设计为可查询对象，而不是散落在代码里的常量。

至少包括：

- intent metadata
- slot metadata
- capability metadata
- hook metadata
- authority requirements
- budget class

---

## 13. Memory Contract 边界

Foundation 只定义记忆机制，不定义具体业务对象内容。

### 13.1 四类记忆

Foundation 至少支持：

1. 情景记忆
2. 语义记忆
3. 程序记忆
4. 元记忆

### 13.2 记忆系统必须支持冷热分层

Foundation 必须允许：

- hot path retrieval
- warm summary retrieval
- cold archive retrieval

否则长周期 Agent 无法持续运行。

### 13.3 replay 与 retrieval 分离

`replay` 的目标是还原当时发生了什么。  
`retrieval` 的目标是为当前任务找最有用的上下文。

两者不能混成同一接口。

### 13.4 Memory 是服务，不是对象堆

Foundation 需要定义：

- memory source taxonomy
- retrieval policy hook
- retention policy hook
- summarization trigger hook

而不是只定义几个表名。

---

## 14. Planning & Orchestration Contract 边界

Foundation 的编排层必须覆盖两类运行：

1. 单 turn
2. 跨 turn task

### 14.1 单 turn 编排

最小流程：

```text
receive
  -> load behavior context
  -> route
  -> validate route
  -> resolve slots / policies
  -> decide behavior
  -> execute if allowed
  -> validate execution
  -> compose result
  -> persist
  -> return
```

### 14.2 task 编排

task 编排至少支持：

- create
- estimate
- confirm
- run
- checkpoint
- resume
- cancel
- complete
- fail
- branch

### 14.3 Orchestrator 不承担业务判断

Orchestrator 可以：

- 组织运行顺序
- 应用 policy
- 驱动状态迁移
- 写日志和结果

但不能：

- 替代 domain executor 生成业务内容
- 替代 domain validator 判断业务好坏
- 直接定义业务 object schema

---

## 15. Provider Contract 边界

Foundation 必须把模型提供者视为可替换依赖。

### 15.1 Provider 抽象职责

至少统一：

- complete
- stream
- usage
- latency
- error class
- retryability

### 15.2 Provider 不暴露到 Domain

Domain 不应直接依赖具体 provider SDK。

Domain 只能依赖 Foundation 暴露的统一模型能力接口。

### 15.3 Stub 是一等实现

为了测试和迁移，Foundation 必须允许 stub provider 成为正式实现，而不只是临时 mock。

---

## 16. Observability & Audit Contract 边界

Foundation 必须定义可观测和审计的最低要求。

### 16.1 Trace

每个 turn / task 至少要能追踪：

- routing
- validation
- capability invocations
- provider calls
- retries
- persistence
- final result composition

### 16.2 Metric

至少要有：

- success / failure rate
- clarification rate
- confirmation rate
- retry rate
- cancellation rate
- long-run checkpoint rate
- adoption rate
- latency
- usage

### 16.3 Audit

所有高影响动作至少需要：

- actor
- target
- authority
- scope
- timestamp
- before / after revision ref

### 16.4 Explainability

Foundation 不要求把所有推理链暴露给用户，但必须保留足够的结构化解释信息，支撑：

- 为什么路由到这个 intent
- 为什么需要 clarification
- 为什么触发 confirmation
- 为什么暂停
- 为什么重试失败

---

## 17. Security, Authority & Budget Contract 边界

Foundation 必须定义受控自动化，而不是无限自动化。

### 17.1 authority scope

任何可写动作都必须带 authority scope。

示例维度：

- capability_scope
- write_scope
- task_control_scope
- budget_override_scope

其中 `write_scope` 至少支持：

- `read_only`
- `propose_only`
- `tentative_write`
- `production_write`

完整 authority / budget / escalation 最小枚举由 ADR-0003（`adr/0003-authority-budget-escalation.md`）冻结；“权限范围必须结构化表达”属于硬骨。

### 17.2 budget scope

预算必须支持多层：

- per capability invocation
- per turn
- per task
- per workspace / project
- periodic budget

budget scope、dimension、threshold kind 与 guard decision 的最小枚举由 ADR-0003 冻结；具体阈值数值与动态预算算法仍不在本文冻结。

### 17.3 prompt injection 防护属于 Foundation

因为这是通用 Agent 问题，不是小说领域问题。

至少需要：

- system / developer boundary protection
- tool-call guard
- object-write guard
- confirmation escalation path

---

## 18. UX Contract 边界

Foundation 不设计页面，但必须设计可被 UI 稳定投影的交互语义。

### 18.1 Foundation 负责什么

Foundation 负责定义：

- render modes
- card types
- progress semantics
- warning semantics
- interruption semantics
- adoption semantics

### 18.2 UI 负责什么

UI 负责决定：

- 布局
- 视觉层次
- 动画
- 列表呈现方式
- 面板展开方式

### 18.3 不允许 UI 自推状态

例如 UI 不能通过“看到某个按钮还在 spinning”就断定任务是 `RUNNING`。  
必须由 Foundation 输出显式运行状态。

---

## 19. Multi-Agent Contract 边界

Foundation 必须为未来多 Agent 保留合法组合方式。

### 19.1 多 Agent 不是特殊 case

多 Agent 只是：

- 一个 Agent 触发另一个 Agent
- 子 Agent 产生 artifact
- 父 Agent 消费 artifact
- 预算与 authority 被继承或收缩

不应另起一套完全独立协议。

### 19.2 子 Agent 不得直写生产状态

除非父级显式授予更高 authority，并且 mutation 仍被审计。

### 19.3 Agent message envelope 必须标准化

至少应包含：

- sender
- receiver
- parent task ref
- authority scope
- budget scope
- requested artifact
- reply artifact

---

## 20. Foundation 对 Domain 的开放接口

Foundation 需要向 Domain 暴露一组稳定扩展点。

### 20.1 可注册项

Domain 至少可以注册：

- object types
- intents
- slots
- capabilities
- validators
- context policies
- retention policies
- retrieval policies
- hooks
- card mappers

### 20.2 Domain 禁止改写项

Domain 不得改写：

- canonical result 顶层结构
- turn 基础状态机语义
- authority 基础语义
- budget 计量语义
- trace / audit 的最低字段

### 20.3 扩展原则

Foundation 暴露的是“机制”而不是“实例”。

例如：

- Foundation 暴露 `HookRegistry`
- Domain 注册“写完章后跑摘要 hook”

而不是：

- Foundation 直接内置“章节摘要”

---

## 21. Foundation 对 UI 的开放接口

UI 只能消费 Foundation 与 Domain 已定义好的 contract。

### 21.1 UI 可直接依赖的 Foundation 语义

- turn result
- next action
- task state
- artifact adoption state
- usage summary
- warning / error envelope
- trace explanation summary

### 21.2 UI 不可直接依赖的实现细节

- provider 原始返回
- 内部 prompt
- 内部 retry 栈
- 原始 validator 细节
- 存储层表结构

### 21.3 Foundation 必须保证的 UI 稳定性

只要 major version 不变，UI 不应因为：

- executor 换实现
- provider 换模型
- retrieval 策略变更

就被迫重写主交互逻辑。

---

## 22. 持久化与事件边界

Foundation 不直接绑定某个数据库，但必须绑定持久化语义。

### 22.1 必须持久化的实体

至少包括：

- turns
- behavior states
- tasks
- artifacts
- mutation events
- traces
- audits
- registry snapshots 或 version refs

### 22.2 建议事件化

Foundation 更推荐“状态对象 + 事件日志”并存，而不是只保留最新快照。

原因：

- replay
- audit
- rollback / compensation
- explainability
- migration

都依赖事件历史。

### 22.3 持久化后端可替换

可以从 SQLite 迁移到 PostgreSQL 或其他后端，但持久化语义不能变。

---

## 23. 版本化与演化规则

Foundation 的所有硬骨都必须可版本化。

### 23.1 需要版本号的对象

至少包括：

- TurnResult
- registry schemas
- task schema
- artifact schema
- event schema
- domain registration schema

### 23.2 破坏性变更规则

breaking change 必须：

1. 升 major
2. 写 ADR
3. 定迁移策略
4. 给兼容窗口
5. 补 contract tests

### 23.3 加法优先

默认顺序：

```text
add new field / object / enum
  -> dual read or compatibility handling
  -> deprecate old path
  -> remove in next major
```

---

## 24. 契约测试要求

Foundation 的 contract 不是文档装饰，必须能被测试。

### 24.1 必测类别

至少包括：

- canonical result shape tests
- phase / status transition tests
- behavior protocol tests
- registry validation tests
- authority / budget guard tests
- persistence traceability tests
- version compatibility tests

### 24.2 Domain 不能绕过 Foundation contract tests

任何 Domain 扩展只要使用了 Foundation 扩展点，就必须满足 Foundation 的基础契约测试。

---

## 25. 与 v1 的关系

v1 已有若干内容可直接视为 Foundation 雏形：

- AgentTurnResult
- Orchestrator runtime
- Slot policy
- Clarification state
- Interaction log
- Router / Executor / Validator 分工

但它们当前仍偏“小说工作台实现文档”，尚未完全抽象为业务无关 contract。

v2 的工作不是否定 v1，而是：

1. 把可复用的部分抽象为通用层
2. 把业务相关部分下沉到 Domain
3. 为未来 UI 和多 Agent 留出稳定接口

---

## 26. 本文冻结的硬骨

本文正式冻结以下内容为 Foundation 硬骨：

1. Foundation 是业务无关 Agent 基础层
2. Foundation / Domain / UI 的依赖方向
3. Foundation 的 12 子系统划分
4. turn / task / capability invocation / artifact / object mutation 五类运行单元
5. canonical result 唯一性
6. Orchestrator 作为单 turn 唯一编排入口
7. 显式状态迁移原则
8. authority / budget / audit / trace 的基础地位
9. intent 与 capability 的职责分离
10. Foundation 通过 registry / policy / hook 等机制向 Domain 开放扩展点
11. UI 只能投影 contract，不能发明运行语义
12. Multi-Agent 必须复用单 Agent contract，而不是另起协议

---

## 27. 本文暂不冻结的内容

以下内容在本文中只定边界，不定最终字段：

1. ~~TurnResult v2 的完整 JSON schema~~（已由 ADR-0001 冻结，见 `adr/0001-turn-result-v2-schema.md`）
2. ~~phase / status 的完整枚举表~~（已由 ADR-0002 冻结，见 `adr/0002-state-enums.md`）
3. ~~authority scope 的完整枚举~~（已由 ADR-0003 冻结，见 `adr/0003-authority-budget-escalation.md`）
4. budget class 的完整计算规则（ADR-0003 已冻结最小枚举；具体阈值数值与动态预算算法仍后置）
5. message envelope 的完整字段
6. retention / retrieval / summary 算法
7. compensation / rollback 的详细机制

这些将由后续文档细化。

---

## 28. 后续文档依赖

后续文档必须遵守本文。

直接依赖本文的文档：

- `02-turn-and-task-state-machines.md`
- `03-conversation-behaviors.md`
- `04-capability-and-intent-registry.md`
- `05-memory-retention-and-retrieval.md`
- `06-planning-and-long-run.md`
- `07-consistency-and-concurrency.md`
- `08-provider-abstraction.md`
- `09-observability-and-audit.md`
- `10-security-and-budget.md`
- `11-ux-contract.md`
- `12-multi-agent-composition.md`
- `13-v1-to-v2-migration.md`

如果后续文档与本文冲突，以 ADR 变更本文，而不是静默偏离。

---

## 29. 下一步

本文之后，优先级最高的文档是：

1. `05-memory-retention-and-retrieval.md`
2. `06-planning-and-long-run.md`
3. `07-consistency-and-concurrency.md`

原因不是它们最容易，而是它们决定：

- 长期连载是否真的能跑
- 长跑任务是否真的可控
- UI 后续是否有稳定状态可映射
