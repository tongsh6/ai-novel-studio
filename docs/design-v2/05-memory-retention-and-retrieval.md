# Memory Retention And Retrieval Contract v2

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的 Memory 子系统展开文档。
>
> 目标：定义 v2 的记忆 contract，解决长期连载下的上下文爆炸、历史归档、检索优先级、回放边界和保留策略问题。

---

## 1. 文档定位

本文回答 5 个问题：

1. Agent 到底有哪些类型的记忆
2. 这些记忆如何分层保存
3. retrieval 如何为“当前任务”服务
4. replay 如何为“复盘过去”服务
5. 长周期运行下，哪些数据该热存，哪些该降温，哪些该归档

本文不负责：

- 小说领域对象本身的字段设计
- 具体 embedding 模型或向量库实现
- summarization prompt 细节
- continuity object 的业务语义

本文只定义 Memory 子系统的 contract。

---

## 2. 设计目标

### 2.1 支撑长周期

Memory 必须能支撑：

- 长篇
- 长期连载
- 高回合对话
- 多阶段创作
- 长跑任务

不能默认所有历史都常驻上下文窗口。

### 2.2 支撑连续性

Memory 必须让系统在需要时能找回：

- 最近发生了什么
- 当前有效状态是什么
- 哪些旧事实仍然重要
- 哪些旧对话已经可以降温

### 2.3 支撑回放与审计

Memory 不只是为了“给模型塞上下文”，还必须能支撑：

- replay
- debug
- audit
- migration
- explainability

### 2.4 支撑多视角消费

不同消费者需要不同记忆：

- Router 需要最小必要上下文
- Executor 需要任务相关上下文
- LongRunner 需要计划、进度、摘要和连续性上下文
- Reader 需要阅读投影，不需要内部 trace
- Debugger 需要 trace 和原始结果

Memory 必须支持按消费者分层供给。

---

## 3. Memory 的定义

在 v2 中，Memory 不是一个表，也不是“历史消息数组”。

Memory 是一套服务，至少包括：

- memory source taxonomy
- retention policy
- retrieval policy
- summarization policy
- indexing policy
- replay policy
- archive policy

Memory 的基本职责是：

1. 保存
2. 压缩
3. 索引
4. 检索
5. 回放
6. 归档
7. 提供解释

---

## 4. 四类记忆

Foundation 层正式定义四类记忆。

### 4.1 情景记忆

定义：记录“发生过哪些交互和运行事件”。

典型内容：

- user messages
- assistant messages
- turn results
- clarification / confirmation / correction state
- trace refs
- task events

用途：

- recent context
- replay
- debug
- audit

### 4.2 语义记忆

定义：记录“系统当前或历史上认定为结构化事实的信息”。

典型内容：

- domain objects
- object summaries
- continuity objects
- accepted artifacts
- structured metadata

用途：

- task retrieval
- consistency checks
- structured context assembly

### 4.3 程序记忆

定义：记录“Agent 自己会什么、能做什么、当前规则是什么”。

典型内容：

- intent registry
- capability registry
- slot policy
- hook registry
- retention rules
- budget classes

用途：

- runtime decisions
- explainability
- self-description

### 4.4 元记忆

定义：记录“长期稳定偏好和行为性约束”。

典型内容：

- user preferences
- workspace preferences
- domain-level stable preferences
- personalization metadata

用途：

- 默认参数
-风格与交互偏好
- 长期体验一致性

元记忆不能混进短期对话历史里，也不能绑死在某个单一 artifact 上。

---

## 5. Memory Source Taxonomy

Memory 必须把来源作为一等元数据，而不是靠表名暗示。

### 5.1 每条记忆至少要有的来源字段

至少包括：

- `memory_id`
- `memory_class`
- `source_type`
- `source_ref`
- `scope_ref`
- `created_at`
- `updated_at`
- `retention_tier`
- `freshness_score`
- `importance_score`
- `replayable`
- `retrievable`

### 5.2 `memory_class`

枚举至少包括：

- `episodic`
- `semantic`
- `procedural`
- `meta`

### 5.3 `source_type`

可扩展，但至少支持：

- turn
- task_event
- artifact
- object_snapshot
- object_summary
- registry
- audit_event
- external_import

### 5.4 `scope_ref`

Memory 必须绑定作用域。  
Foundation 不强制 scope 名称，但至少支持：

- workspace
- domain root object
- task
- actor

不能让所有记忆堆在全局平面里。

---

## 6. 三层保留结构

Foundation 正式定义三层 retention tier：

1. hot
2. warm
3. cold

### 6.1 hot tier

定义：用于当前运行路径的高频访问记忆。

特征：

- 低延迟
- 小体量
- 强相关
- 高新鲜度

典型内容：

- 最近若干 turn
- 当前未完成 behavior state
- 当前 task state
- 最近 accepted artifacts
- 当前活跃对象摘要

### 6.2 warm tier

定义：经过压缩或摘要，仍需被高频 retrieval 的中期记忆。

特征：

- 可检索
- 可作为 context assembly 的主要来源
- 比 hot 更压缩
- 比 cold 更常用

典型内容：

- chapter summaries
- task summaries
- aggregated interaction summaries
- snapshot summaries
- curated semantic extracts

### 6.3 cold tier

定义：长期归档，用于 audit、replay、深度回查和迁移。

特征：

- 默认不进日常 context
- 必须可按需取回
- 保真优先于低延迟

典型内容：

- old turn logs
- raw provider outputs
- old traces
- historical task events
- archived artifacts

### 6.4 核心原则

hot / warm / cold 是语义层，不绑定具体存储实现。

例如：

- 都存在 SQLite 中也可以
- warm 用 summary table，cold 用 archive table 也可以
- 未来换 PostgreSQL + object storage 也可以

但 tier 语义不能变。

---

## 7. Retrieval 与 Replay 的分离

这是 Memory contract 的核心硬骨。

### 7.1 retrieval 的定义

`retrieval` 用于回答：

**“为了当前任务，最值得带进来的上下文是什么？”**

它面向的是：

- relevance
- freshness
- importance
- cost efficiency

retrieval 允许返回：

- summary
- excerpt
- object snapshot
- ranked refs

retrieval 不要求保留历史原貌。

### 7.2 replay 的定义

`replay` 用于回答：

**“当时到底发生了什么？”**

它面向的是：

- fidelity
- chronology
- traceability
- reproducibility boundary

replay 允许使用：

- frozen turn result
- frozen trace
- archived provider raw output
- event log

replay 不应为了节省 token 而偷偷改写历史。

### 7.3 强制分离规则

以下规则是硬骨：

1. `retrieval` 和 `replay` 不能共用同一个 API 语义。
2. retrieval 可以优先返回 summary；replay 不能用 summary 冒充原始记录。
3. replay 失败时必须明确说明缺失的是哪一层历史。
4. retrieval 的排序因子和 replay 的时间顺序因子不能混用。

---

## 8. Memory 单位与索引单位

Memory 不应默认“整条 turn 就是唯一索引单位”。

### 8.1 最小 memory unit

允许的基础单位至少包括：

- turn
- task event
- assistant message
- artifact
- object snapshot
- summary block
- excerpt chunk

### 8.2 索引单位与存储单位可以不同

例如：

- 一整章正文作为存储单位
- 按 scene 或 chunk 作为检索单位

这是允许且推荐的。

### 8.3 索引必须带语义标签

索引项至少要支持：

- source ref
- scope ref
- time anchor
- topic / type labels
- revision ref
- acceptance state

否则后续无法做受控 retrieval。

---

## 9. Summarization Contract

Summarization 不是“可选优化”，而是 Memory 的正式组成部分。

### 9.1 summary 的角色

summary 用于：

- warm tier 压缩
- retrieval 加速
- continuity recall
- context assembly
- long-run checkpoint handoff

### 9.2 summary 的最低要求

每份 summary 至少要有：

- `summary_id`
- `summary_type`
- `source_refs`
- `scope_ref`
- `generated_at`
- `version`
- `fidelity_level`
- `summary_text`
- `structured_facts` 或 `structured_refs`

### 9.3 fidelity level

summary 必须显式标出保真级别，至少支持：

- `lossy`
- `balanced`
- `high_fidelity`

因为不同 summary 的用途不同：

- retrieval 常可接受 `lossy`
- continuity handoff 往往需要 `balanced`
- migration / audit 辅助可能要求 `high_fidelity`

### 9.4 summary 不能覆盖源记录

summary 是派生物，不是替代物。

源记录进入 cold tier 后可以降温，但不能因为有 summary 就删除所有源历史，除非 retention policy 明确允许且不影响审计要求。

---

## 10. Retention Policy Contract

Retention policy 决定记忆如何从 hot 降到 warm，再到 cold。

### 10.1 policy 触发因子

至少应支持以下触发因子：

- age
- access frequency
- current task relevance
- importance score
- accepted / tentative state
- audit requirement
- replay requirement
- storage budget pressure

### 10.2 retention 动作类型

至少包括：

- keep_hot
- demote_to_warm
- archive_to_cold
- summarize_and_demote
- compact_index
- mark_replay_only
- delete_if_allowed

### 10.3 删除必须是显式策略

Memory 默认不是“过期自动删”。

删除必须满足：

- policy 明确允许
- 不违反 audit requirement
- 不违反 replay guarantee
- 不违反 domain retention requirement

### 10.4 tentative 数据的保留

tentative artifact 与 production artifact 必须可区分保留策略。

默认原则：

- 未采纳 tentative 可以更快降温
- 但在 task 未终结前不能丢失
- cancellation / failure 后的 tentative 清理要遵循 task policy

---

## 11. Retrieval Policy Contract

retrieval 不是裸检索，而是受 policy 控制的上下文组装过程。

### 11.1 retrieval 请求最小结构

至少包括：

- `consumer_type`
- `goal`
- `scope_ref`
- `time_horizon`
- `budget`
- `required_memory_classes`
- `excluded_sources`

### 11.2 consumer_type

至少支持：

- router
- executor
- long_runner
- validator
- reader
- debugger
- migration_tool

### 11.3 retrieval 输出最小结构

至少包括：

- ranked items
- item type
- relevance score
- source refs
- truncation notes
- omitted classes
- retrieval explanation summary

### 11.4 retrieval 的排序因子

至少允许综合：

- relevance
- recency
- importance
- authority
- acceptance state
- fidelity level
- cost to include

### 11.5 Retrieval 是“选择 + 解释”

retrieval 不只是返回内容，还必须能解释：

- 为什么选了这些
- 为什么没选某类历史
- 是否使用了 summary 代替源记录

---

## 12. Replay Policy Contract

Replay 是单独的 memory service。

### 12.1 replay 请求最小结构

至少包括：

- target ref
- replay scope
- fidelity requirement
- include trace or not
- include raw provider output or not

### 12.2 replay 输出最小结构

至少包括：

- chronological event list
- frozen result refs
- missing data warnings
- reconstruction notes

### 12.3 replay fidelity

至少支持：

- `result_only`
- `trace_level`
- `raw_level`

说明：

- `result_only`：仅还原用户可见结果和主要状态。
- `trace_level`：包含 route / validate / execute / persist 等链路。
- `raw_level`：尽可能带原始 provider 输入输出和底层日志。

### 12.4 replay 缺失必须显式

如果某层历史已不可用，replay 必须明确报告：

- 缺了什么
- 为什么缺
- 是否存在 summary 或替代引用

---

## 13. Freshness 与 Importance

Memory 不能只按“新近程度”工作。

### 13.1 freshness

表示某条记忆对当前运行时是否足够新。

典型高 freshness：

- 最近 turn
- 当前 task 状态
- 刚更新的对象

### 13.2 importance

表示某条记忆是否长期关键。

典型高 importance：

- 核心规则
- 已采纳的重要产物
- 结构化摘要
- 高价值决策

### 13.3 freshness 与 importance 必须分离

旧但关键的记忆应可：

- freshness 低
- importance 高

这正是 warm tier 存在的理由。

---

## 14. Context Window Budget Contract

Memory 必须服从上下文预算，而不是相反。

### 14.1 budget 维度

至少包括：

- token budget
- retrieval count budget
- latency budget
- summary expansion budget

### 14.2 budget 内的优先级

预算不足时，默认优先顺序应为：

1. 当前运行必要状态
2. 高 importance 的结构化摘要
3. 当前目标强相关内容
4. 最近局部对话
5. 低优先级背景

### 14.3 Retrieval 必须允许降级

例如：

- 源记录降级为 summary
- 多段历史压缩为一个 aggregate summary
- 省略低 relevance 内容

但降级必须被记录到 retrieval explanation 中。

---

## 15. Long-Run Task 的记忆要求

长跑任务对 Memory 有额外要求。

### 15.1 checkpoint summary

每次 checkpoint 至少需要产出：

- progress summary
- current state refs
- pending artifacts refs
- unresolved issues
- next step context

### 15.2 resume 不依赖完整旧上下文

长跑续跑不能依赖把历史所有 turn 重新塞回模型。

resume 默认应依赖：

- task state
- checkpoint summaries
- active object refs
- latest accepted artifacts
- unresolved behavior states

### 15.3 long-run 失败后的记忆保留

任务失败后至少应保留：

- last successful checkpoint
- failed step trace summary
- pending tentative artifacts
- cancellation / failure reason

---

## 16. 记忆与 Domain 的接口

Memory 是 Foundation 服务，但 Domain 可以注册自己的策略。

### 16.1 Domain 可注册项

至少包括：

- memory scopes
- importance heuristics
- summarization triggers
- retrieval hints
- retention exceptions

### 16.2 Domain 不得改写项

Domain 不得改写：

- hot / warm / cold tier 语义
- retrieval / replay 分离原则
- replay fidelity 等级
- retention 动作基本类型

### 16.3 Domain 只能补规则，不能改服务职责

例如 Domain 可以说：

- “chapter summary 是 warm tier 主来源”
- “worldrule importance 高”

但不能说：

- “以后 replay 也直接读 summary 就行”

---

## 17. 记忆与 UI 的接口

UI 不直接操作 Memory 内部实现，只消费其稳定产物。

### 17.1 UI 可见内容

UI 可以消费：

- current context summary
- retrieval explanation summary
- replay result
- archive availability hints
- memory warnings

### 17.2 UI 不可见实现细节

UI 不应直接依赖：

- vector index internals
- embedding ids
- raw ranking formulas
- archive backend implementation

### 17.3 UI 的使用原则

UI 可以显示：

- “已引用 3 条章节摘要，省略 12 条旧对话”
- “当前回放不含 raw provider 输出”

但不能自己决定检索结果排序。

---

## 18. 记忆事件

Memory 不只是状态，还应有显式事件。

### 18.1 至少支持的 memory events

- memory_created
- memory_accessed
- memory_summarized
- memory_demoted
- memory_archived
- memory_compacted
- memory_deleted
- replay_requested
- retrieval_requested

### 18.2 事件用途

这些事件用于：

- observability
- audit
- migration
- retention tuning

---

## 19. 迁移与兼容

Memory contract 必须允许从 v1 的 interaction log 逐步升级。

### 19.1 v1 可复用资产

至少包括：

- interaction logs
- clarification states
- turn results
- object records

### 19.2 v2 的新增要求

需要逐步补上：

- retention tier
- summary records
- replay fidelity metadata
- source taxonomy
- retrieval explanation

### 19.3 兼容策略

允许一段时间内：

- 旧记录没有 tier 字段
- 旧记录没有 summary ref
- 旧 replay 只有 result_only

但新系统必须能识别这种兼容状态，而不是假装这些字段天然存在。

---

## 20. 契约测试要求

Memory contract 至少要有以下测试。

### 20.1 retention tests

验证：

- hot -> warm -> cold 的迁移规则
- deletion guard
- tentative retention rules

### 20.2 retrieval tests

验证：

- 不同 consumer_type 的检索差异
- budget 下的降级行为
- explanation 输出

### 20.3 replay tests

验证：

- result_only / trace_level / raw_level
- 历史缺失时的显式告警
- replay 与 retrieval 不混淆

### 20.4 compatibility tests

验证：

- v1 记录可被读取
- 缺失 tier / summary / fidelity 字段时的兼容行为

---

## 21. 本文冻结的硬骨

本文正式冻结以下 Memory 硬骨：

1. 四类记忆：episodic / semantic / procedural / meta
2. 三层 retention tier：hot / warm / cold
3. retrieval 与 replay 必须分离
4. summary 是正式 Memory 产物，而不是临时文本
5. retention policy、retrieval policy、replay policy 都是一等 contract
6. memory source taxonomy 必须结构化
7. freshness 与 importance 必须分离
8. 长跑续跑依赖 checkpoint summary，不依赖完整旧上下文重灌
9. Domain 可以注册 Memory 规则，但不能改写 tier 和 replay 语义

---

## 22. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. importance score 计算公式
2. freshness score 计算公式
3. embedding / vector store 方案
4. summary 生成 prompt
5. chunking 策略的最终参数
6. archive backend 选型

---

## 23. 下一步

在 Memory contract 基础上，优先继续：

1. `06-planning-and-long-run.md`
2. `07-consistency-and-concurrency.md`

因为：

- long-run 决定 checkpoint 与 tentative 的副作用边界
- consistency 决定 Memory 引回来的状态如何安全写回系统

