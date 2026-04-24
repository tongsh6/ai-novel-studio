# Capability And Intent Registry Contract v2

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的 Capability & Intent Registry 子系统展开文档，并依赖 `docs/design-v2/03-conversation-behaviors.md`。
>
> 目标：定义 v2 中 intent、capability、slot、policy、hook 的注册机制，明确 Router / Executor / Validator / Orchestrator 在运行时如何依赖注册表工作，以及这些注册对象如何成为系统的可查询程序记忆。

---

## 1. 文档定位

本文回答 8 个问题：

1. 什么是 intent，什么是 capability
2. 为什么 intent 和 capability 不能混成一个枚举
3. slot 元数据应如何注册
4. Router、Executor、Validator 的职责边界如何落到 registry
5. policy 与 hook 如何挂接 registry
6. Domain 如何在 Foundation 上注册自己的能力
7. UI 与 explainability 如何消费 registry
8. registry 如何成为程序记忆的一部分

本文不负责：

- 具体业务 intent 的最终全集
- 具体 prompt 文案
- Provider 级别参数细节

本文只定义 registry contract。

---

## 2. 设计目标

### 2.1 系统必须知道自己会什么

Agent 不应把“自己会什么”藏在代码分支或 prompt 模板里。

系统必须能结构化表达：

- 有哪些 intent
- 每个 intent 需要什么 slots
- 每个 intent 对应哪些 capability
- capability 能做什么、不能做什么
- 哪些行为、policy、hook 会参与

### 2.2 intent 和 capability 必须解耦

一个用户意图不等于一个执行器。

例如：

- 一个 intent 可能分发到多个 capability
- 一个 capability 可能被多个 intent 复用
- 一个 intent 可能只产生行为，不触发 capability

### 2.3 registry 必须可查询、可版本化

registry 不是散落在代码里的常量表。

它必须：

- 可序列化
- 可审计
- 可被测试
- 可被系统查询
- 可被 Domain 扩展

### 2.4 registry 是程序记忆

registry 不只是开发期配置，它属于运行时程序记忆的一部分。

Agent 在 explainability、self-description、调度和 guard 决策时都应能访问它。

---

## 3. 核心定义

### 3.1 intent

`intent` 是对用户意图的结构化分类。

它回答：

- 用户想让系统完成什么类型的工作
- 需要补哪些信息
- 可能触发哪些行为
- 默认应走哪条执行路径

### 3.2 capability

`capability` 是系统可执行的能力注册项。

它回答：

- 系统实际上可以做什么
- 这个能力会消耗什么
- 会产生什么 artifact
- 会不会写 production
- 支不支持 retry / streaming / cancellation

### 3.3 slot

`slot` 是 intent 在进入执行前需要解决的结构化参数位。

它回答：

- 参数名是什么
- 类型是什么
- 是否 required
- 是否可默认
- 是否可高置信推断

### 3.4 policy

`policy` 是运行时约束与决策规则。

它回答：

- 何时 clarification
- 何时 confirmation
- 何时允许执行
- 何时触发 hook
- 何时预算阻断

### 3.5 hook

`hook` 是在某个运行边界被自动触发的附加行为或能力调用。

例如：

- post-execution summarize
- checkpoint maintenance
- adoption validation

---

## 4. intent 与 capability 的关系

### 4.1 一对一不是前提

intent 和 capability 之间不能假设总是一对一。

可能关系：

- 1 个 intent -> 1 个 capability
- 1 个 intent -> 多个 capability
- 多个 intent -> 1 个 capability
- 1 个 intent -> 0 个 capability（只产生行为）

### 4.2 intent 是“要做什么”

它偏用户侧和编排侧。

### 4.3 capability 是“怎么做”

它偏系统侧和执行侧。

### 4.4 registry 必须显式记录映射

不能依赖：

- 函数名碰巧同名
- 文件名隐式约定
- prompt 里临时说明

---

## 5. Intent Registry Contract

每个 intent 至少要有一个 registry entry。

### 5.1 intent 最小字段

至少包括：

- `intent_name`
- `intent_version`
- `intent_family`
- `description`
- `slot_schema_ref`
- `default_behavior_policy_ref`
- `candidate_capability_refs`
- `default_next_action`
- `allowed_scopes`
- `authority_profile_ref`
- `status`

`intent_name` 必须使用 `intent.<NAME>` namespace，避免与 hook 或 capability 同名。

### 5.2 `intent_family`

用于按语义聚类。

例如：

- create
- refine
- summarize
- continue
- review
- read

Foundation 不冻结最终分类集，但要求有结构化分组。

### 5.3 `candidate_capability_refs`

必须是显式列表。

如果一个 intent 暂时不会执行 capability，也必须显式表达为空，而不是省略。

### 5.4 `status`

至少支持：

- `ACTIVE`
- `DEPRECATED`
- `DISABLED`

---

## 6. Slot Registry Contract

slot 元数据必须独立于 Router prompt 存在。

### 6.1 slot 最小字段

至少包括：

- `slot_name`
- `slot_type`
- `description`
- `requiredness`
- `inferability`
- `defaultability`
- `allowed_values_ref`（可空）
- `validation_rules_ref`
- `scope_dependency`

### 6.2 `requiredness`

至少支持：

- `required_to_execute`
- `optional_preference`

### 6.3 `inferability`

至少支持：

- `not_inferable`
- `inferable_with_high_confidence`

### 6.4 `defaultability`

至少支持：

- `no_default`
- `defaultable`

### 6.5 Slot Policy 四级映射

为兼容既有思想，Foundation 仍保留四级语义：

1. `required_to_execute`
2. `inferable_with_high_confidence`
3. `defaultable`
4. `optional_preference`

但它们应通过结构化字段表达，而不是硬编码在 Router 逻辑里。

---

## 7. Capability Registry Contract

每个 capability 至少要有一个 registry entry。

### 7.1 capability 最小字段

至少包括：

- `capability_name`
- `capability_version`
- `description`
- `input_schema_ref`
- `output_schema_ref`
- `artifact_types`
- `authority_required`
- `budget_profile_ref`
- `supports_streaming`
- `supports_retry`
- `supports_cancellation`
- `supports_long_run`
- `produces_tentative_artifacts`
- `writes_authoritative_state`
- `default_validator_refs`
- `status`

`capability_name` 必须使用 `capability.<name>` namespace。

### 7.2 `writes_authoritative_state`

这个字段必须显式存在。

否则系统无法知道：

- 何时需要 confirmation
- 何时需要 adoption boundary
- 何时要做严格一致性检查

### 7.3 `supports_long_run`

表示它是否可以作为 long-run unit 的执行能力。

### 7.4 capability 与 provider 解耦

registry 不应直接把 capability 绑死到某个 provider SDK。

capability 描述的是系统能力，不是供应商实现。

---

## 8. Policy Registry Contract

policy 是运行时 guard 和决策的注册项。

### 8.1 policy 最小字段

至少包括：

- `policy_name`
- `policy_type`
- `description`
- `trigger_conditions_ref`
- `decision_outputs`
- `priority`
- `status`

### 8.2 `policy_type`

至少支持：

- slot_resolution
- clarification
- confirmation
- budget_guard
- authority_guard
- consistency_guard
- retry_policy
- retention_policy

### 8.3 policy 的作用

policy 不是 capability，也不是 intent。

它是介于“识别”和“执行”之间的守门规则。

---

## 9. Hook Registry Contract

hook 是自动附加行为。

### 9.1 hook 最小字段

至少包括：

- `hook_name`
- `hook_type`
- `trigger_ref`
- `target_capability_ref`
- `execution_mode`
- `produces_artifacts`
- `requires_adoption`
- `status`

`hook_name` 必须使用 `hook.<NAME>` namespace，避免与显式 intent 同名。

### 9.2 `hook_type`

至少支持：

- pre_execute
- post_execute
- post_checkpoint
- pre_adoption
- post_adoption

### 9.3 `execution_mode`

至少支持：

- synchronous
- asynchronous
- deferred

### 9.4 hook 不得偷改主流程语义

hook 可以附加工作，不能悄悄改写：

- turn phase
- task phase
- authoritative write rules

除非通过显式事件回流主流程。

---

## 10. Router / Executor / Validator / Orchestrator 的职责落点

registry 的核心价值之一，是让四者边界变得可执行。

### 10.1 Router

Router 读取：

- intent registry
- slot registry
- routing hints

Router 负责：

- 识别 intent
- 抽取 slots
- 给出候选行为方向

Router 不负责：

- 执行 capability
- 最终 budget 判断
- 写 production

### 10.2 Executor

Executor 读取：

- capability registry
- input/output schema refs
- validator refs

Executor 负责：

- 执行具体能力
- 返回 artifacts / action result / usage

Executor 不负责：

- 识别用户意图
- 决定 clarification / confirmation

### 10.3 Validator

Validator 读取：

- slot rules
- capability output schema
- adoption rules
- consistency guard refs

Validator 负责：

- 校验结构合法性
- 输出可执行的错误或 warning

Validator 不负责：

- 创作内容
- 偷偷修业务语义

### 10.4 Orchestrator

Orchestrator 读取：

- intent registry
- capability registry
- policy registry
- hook registry

Orchestrator 负责：

- 编排执行顺序
- 应用 policy
- 调用 capability
- 驱动状态迁移
- 统一返回 canonical result

---

## 11. Registry 作为程序记忆

registry 必须进入程序记忆层。

### 11.1 可查询性

系统至少应能查询：

- 当前有哪些 active intents
- 某个 intent 需要哪些 slots
- 某个 capability 会不会写 production
- 某个 policy 在什么时候触发
- 某个 hook 会在什么节点执行

### 11.2 explainability

registry 必须支撑回答：

- 为什么识别成这个 intent
- 为什么这个 slot 被认为 required
- 为什么这个 capability 被选中
- 为什么需要 clarification / confirmation

### 11.3 self-description

未来系统可基于 registry 回答：

- 我能做什么
- 我不能做什么
- 现在为什么不能继续

---

## 12. 版本化与 deprecation

registry 是硬骨，必须可版本化。

### 12.1 version 字段

至少以下对象要带 version：

- intent
- capability
- slot schema
- policy
- hook

### 12.2 deprecation 规则

intent 或 capability 废弃时，至少要保留：

- `status = DEPRECATED`
- `replacement_ref`（可空）
- `sunset_policy_ref`（可空）

### 12.3 兼容期

只要 major 不变，旧 registry entry 不应被无声删除。

---

## 13. registry 与 Domain 的接口

Domain 正是通过 registry 在 Foundation 上注册自己的能力。

### 13.1 Domain 可注册项

至少包括：

- novel intents
- novel slot schemas
- novel capabilities
- novel hooks
- novel policy refinements

### 13.2 Domain 不得改写项

Domain 不得改写：

- intent / capability 的分离原则
- slot 四级语义
- capability 写 authoritative state 的显式声明要求
- hook 不能绕过主流程

### 13.3 Domain 是填实例，不是改机制

例如：

- Domain 可以注册 `DRAFT_CHAPTER`
- Foundation 不应内置 `DRAFT_CHAPTER`

---

## 14. registry 与 UI 的接口

UI 不应直接依赖代码实现，而应消费 registry 暴露的稳定语义。

### 14.1 UI 可用信息

至少包括：

- intent labels / descriptions
- slot labels / requiredness
- behavior hints
- capability risk hints
- allowed actions

### 14.2 UI 不应依赖的内容

例如：

- 某个 executor 的 Python 文件名
- 某个 capability 的内部 prompt 名
- provider 绑定细节

### 14.3 UI 的基本用途

例如：

- 渲染 clarification 所需字段提示
- 渲染 confirmation 的风险摘要
- 渲染可执行动作和受限动作

---

## 15. registry 与 long-run 的接口

long-run 依赖 registry 才能知道哪些 capability 能成为 unit。

### 15.1 long-run 需要从 registry 获取

至少包括：

- capability 是否支持 long-run
- 默认 budget profile
- retry policy refs
- cancellation support
- artifact types

### 15.2 unit dispatch 必须经过 registry

不能在 long-run 里直接硬编码：

- “这个任务就调某个函数”

而应通过 capability registry 决定可调能力。

---

## 16. registry 与 consistency 的接口

一致性与权限 guard 也依赖 registry。

### 16.1 consistency 需要从 registry 获取

至少包括：

- authority required
- writes_authoritative_state
- target scope hints
- validator refs

### 16.2 adoption guard 需要 registry

如果 capability 产物默认需要 adoption，这应来自 registry，而不是 UI 猜测。

---

## 17. 持久化与事件要求

registry 不一定全都存数据库，但必须有可持久化语义。

### 17.1 至少需要可持久化的内容

- registry snapshots
- registry versions
- deprecation metadata
- policy refs
- hook refs

### 17.2 最小事件集合

至少包括：

- intent_registered
- capability_registered
- slot_schema_registered
- policy_registered
- hook_registered
- registry_entry_deprecated
- registry_entry_disabled

---

## 18. 契约测试要求

### 18.1 registry completeness tests

验证：

- active intent 必须有 slot schema ref
- active capability 必须有 input/output schema ref

### 18.2 boundary tests

验证：

- Router 不能直接依赖 capability 实现
- Executor 不能冒充 intent classifier

### 18.3 policy linkage tests

验证：

- clarification / confirmation / retry / hook 的 policy refs 可解析

### 18.4 explainability tests

验证：

- registry 足以支撑 intent / slot / capability 的解释信息输出

### 18.5 TurnResult 兼容性 tests

验证：

- 任意 capability 的 output schema 必须能映射进 ADR-0001 冻结的 TurnResult v2 顶层（`adr/0001-turn-result-v2-schema.md`）
- 任意 intent / capability 的扩展属性必须使用 `domain_ext.` 前缀，否则 reject（与 ADR-0001 §对 Domain 影响 一致）
- intent / capability / hook 的 `next_action` 输出必须落在 ADR-0002 冻结的 8 个 canonical 值内，不得输出非 canonical `EXECUTE_DIRECTLY`

---

## 19. 本文冻结的硬骨

本文正式冻结以下 registry 硬骨：

1. intent、capability、slot、policy、hook 都是一等注册对象
2. intent 与 capability 必须分离
3. slot 四级语义必须结构化表达
4. capability 必须显式声明是否写 authoritative state
5. Router / Executor / Validator / Orchestrator 的职责边界必须经由 registry 落地
6. registry 是程序记忆的一部分，必须可查询、可版本化
7. Domain 通过 registry 注册实例，不能改写 Foundation 机制

---

## 20. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. registry 存储在 YAML、DB 还是混合
2. registry snapshot 的最终序列化格式
3. intent_family 的最终枚举全集
4. policy trigger DSL 的具体语法

---

## 21. 下一步

registry 之后，建议继续：

1. `08-provider-abstraction.md`
2. `09-observability-and-audit.md`
3. `10-security-and-budget.md`

这样 Foundation 剩下的几个核心子系统就能基本闭环。
