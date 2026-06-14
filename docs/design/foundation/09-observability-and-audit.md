# Observability And Audit Contract

> 状态：v3 体系领域层 · 当前权威（横切契约）。归 v3 治理、服从 v3 原则（见 `docs/design/README.md`「整合原则：以 v3 为主体，吸取 v2」）；标题/历史中的 v2 仅为来源标记。
>
> 角色：`docs/design/foundation/00e-architecture.md` 的 Observability & Audit 子系统展开文档，并依赖 `docs/design/06-memory-context-and-trace.md`、`docs/design/04-execution-orchestrator.md`、`docs/design/05-turn-behavior-and-state-model.md`、`docs/design/foundation/08-provider-abstraction.md`。
>
> 目标：定义 v2 中 trace、metrics、structured logs、replay、audit、explainability 的统一 contract，使系统所有关键行为都可追踪、可统计、可复盘、可审计。

---

## 1. 文档定位

本文回答 8 个问题：

1. Observability 和 audit 分别负责什么
2. trace 的最小粒度是什么
3. metrics 统计什么，如何归属
4. structured logs 与 trace、audit 的边界是什么
5. replay 到底能还原什么，不能还原什么
6. explainability 依赖哪些结构化数据
7. 哪些事件必须进入 audit
8. 这些数据如何保留、降温、归档

本文不负责：

- 具体监控平台选型
- 具体日志后端选型
- 具体 dashboard 布局

本文只定义观测与审计 contract。

---

## 2. 设计目标

### 2.1 系统必须可观察，而不是靠猜

Agent 运行不能靠：

- 看 UI 像不像卡住
- 看 assistant_message 猜它做了什么
- 看代码分支猜它为什么失败

系统必须能结构化回答：

- 发生了什么
- 什么时候发生的
- 谁触发的
- 消耗了什么
- 为什么这样决策
- 如果失败，失败在哪一步

### 2.2 trace、metrics、logs、audit 必须分层

这四者目标不同：

- trace：还原一次运行链路
- metrics：聚合统计与趋势
- logs：低层事件与调试细节
- audit：高影响动作留痕

混在一起会导致：

- 要么太重
- 要么太浅
- 要么什么都查不到

### 2.3 replay 不是“再跑一遍”

replay 的目标是还原当时发生过什么，而不是在当前代码和当前模型上重算。

因此 replay 必须建立在：

- frozen result refs
- trace refs
- archived raw refs

上。

### 2.4 explainability 依赖结构化依据

系统可以给用户一句自然语言解释，但真正可依赖的 explainability 必须来自结构化依据：

- route result
- slot resolution
- policy hits
- validation outputs
- provider result
- conflict record

---

## 3. 核心定义

### 3.1 trace

`trace` 是一次 turn、task、delegation 或 provider invocation 的结构化链路记录。

它回答：

- 运行经过了哪些阶段
- 每阶段输入输出是什么摘要
- 用了多久
- 产生了哪些事件和引用

### 3.2 metric

`metric` 是跨多次运行聚合后的统计信号。

它回答：

- 系统整体表现如何
- 哪类路径高频失败
- clarification / confirmation 是否过多
- long-run checkpoint 是否过频

### 3.3 structured log

`structured log` 是低层、事件化、机器可解析的运行日志。

它回答：

- 某个具体子步骤发生了什么
- 当时有哪些上下文、标签、错误、耗时

### 3.4 audit record

`audit record` 是高影响动作的责任留痕。

它回答：

- 谁在什么时候影响了什么对象
- 基于什么权限
- 写入前后是什么 revision

### 3.5 replay

`replay` 是基于冻结历史对一次运行进行复盘的能力。

### 3.6 explainability

`explainability` 是对系统行为做可验证解释的能力，不等于自由聊天式解释。

---

## 4. 分层原则

### 4.1 trace 不等于 log

trace 是“链路视图”。  
log 是“事件流”。

同一个 trace 可以引用多条 structured logs。

### 4.2 audit 不等于 trace

trace 关注运行过程。  
audit 关注责任与影响。

### 4.3 replay 不等于 trace

trace 是一种输入。  
replay 是一种能力。

### 4.4 metrics 来源于事件，不直接来源于 UI

所有 metrics 应由结构化事件、trace 或 usage 汇总得出，而不是从前端埋点文案反推。

---

## 5. Trace Contract

trace 是 Observability 的核心对象。

### 5.1 trace 最小字段

至少包括：

- `trace_id`
- `trace_type`
- `root_ref`
- `parent_trace_ref`（可空）
- `status`
- `started_at`
- `ended_at`
- `duration_ms`
- `step_refs`
- `warning_refs`
- `error_ref`
- `usage_ref`

### 5.2 `trace_type`

至少支持：

- `turn_trace`
- `task_trace`
- `delegation_trace`
- `provider_trace`
- `adoption_trace`

### 5.3 `root_ref`

trace 必须能归属于明确根对象，例如：

- turn
- task
- delegation
- provider request

### 5.4 parent-child trace

trace 必须允许嵌套。

例如：

- turn trace
  - provider trace
  - delegation trace
  - adoption trace

---

## 6. Trace Step Contract

trace 不是只记头尾，它必须有步骤。

### 6.1 step 最小字段

至少包括：

- `step_id`
- `trace_ref`
- `step_type`
- `seq_no`
- `started_at`
- `ended_at`
- `duration_ms`
- `status`
- `input_summary`
- `output_summary`
- `refs`
- `error_ref`

### 6.2 `step_type`

至少支持：

- input_received
- context_loaded
- route_called
- route_validated
- slot_resolved
- behavior_decided
- capability_invoked
- provider_called
- provider_streamed
- validator_called
- checkpoint_created
- mutation_proposed
- adoption_attempted
- result_composed
- persisted

### 6.3 step granularity

step 粒度不要求做到“每个函数一条”，但必须覆盖：

- 运行边界
- 决策边界
- 外部依赖边界
- 状态迁移边界

---

## 7. Structured Log Contract

structured logs 用于低层事件记录。

### 7.1 log 最小字段

至少包括：

- `log_id`
- `log_type`
- `severity`
- `timestamp`
- `trace_ref`
- `entity_ref`
- `message`
- `payload`

### 7.2 `log_type`

至少支持：

- lifecycle
- provider
- policy
- validation
- consistency
- storage
- budget
- security

### 7.3 severity

至少支持：

- DEBUG
- INFO
- WARN
- ERROR

### 7.4 structured log 的定位

它主要服务：

- 调试
- 诊断
- 深度排障

不应直接作为 UI 主呈现数据源。

---

## 8. Metrics Contract

metrics 是聚合层信号。

### 8.1 metric 最小字段

至少包括：

- `metric_name`
- `metric_type`
- `value`
- `timestamp`
- `scope_ref`
- `labels`

### 8.2 `metric_type`

至少支持：

- counter
- gauge
- histogram
- rate

### 8.3 推荐核心 metrics

至少包括：

- turn count
- turn success / failure rate
- clarification rate
- confirmation rate
- cancellation rate
- correction rate
- long-run start / completion / failure rate
- checkpoint rate
- adoption accept / discard rate
- provider latency
- token usage
- estimated cost
- retry rate
- consistency conflict rate

### 8.4 labels

labels 至少应允许：

- intent
- capability
- provider
- model
- workspace
- task_type
- behavior_type

---

## 9. Audit Contract

audit 关注高影响动作与责任链。

### 9.1 audit 最小字段

至少包括：

- `audit_id`
- `event_type`
- `actor_ref`
- `authority_scope`
- `source_turn_ref`
- `source_task_ref`（可空）
- `target_scope_ref`
- `before_revision_ref`
- `after_revision_ref`
- `artifact_refs`
- `created_at`

### 9.2 必须进入 audit 的事件

至少包括：

- authoritative mutation applied
- adoption accepted
- adoption edited accepted
- rollback applied
- compensation applied
- authority escalation approved
- task cancelled
- branch created
- direct production write by delegated agent

### 9.3 不必进入 audit 的事件

例如：

- 普通 token delta
- 低层 debug log
- 无副作用的 provider 调用本身

除非有合规或审计要求。

---

## 10. Replay Contract

replay 是建立在 Memory 和 Trace 基础上的复盘能力。

### 10.1 replay 输入

至少包括：

- `target_ref`
- `replay_level`
- `include_trace`
- `include_raw`
- `include_logs`

### 10.2 replay 输出

至少包括：

- chronological events
- referenced frozen results
- missing pieces warnings
- reconstruction notes

### 10.3 replay level

至少支持：

- `result_only`
- `trace_level`
- `raw_level`

### 10.4 replay 的边界

replay 可以还原：

- 发生过的 turn / task / delegation 路径
- 当时保存的结构化结果
- 当时记录的 trace / logs / raw refs

replay 不保证：

- 重现原模型的随机性
- 在新代码上得到完全一致的新输出

---

## 11. Explainability Contract

explainability 依赖结构化依据。

### 11.1 explainability 最小输入来源

至少包括：

- route result
- slot resolution
- triggered behaviors
- selected capability
- provider result summary
- validator outputs
- consistency decisions

### 11.2 explainability 的最小输出

至少包括：

- `explanation_type`
- `subject_ref`
- `reason_summary`
- `evidence_refs`

### 11.3 推荐 explanation 类型

至少包括：

- route_explanation
- clarification_explanation
- confirmation_explanation
- capability_selection_explanation
- checkpoint_explanation
- conflict_explanation
- failure_explanation

### 11.4 explainability 不等于暴露内部推理链

系统不需要公开原始 chain-of-thought。  
但必须提供足够结构化依据，让用户和开发者理解关键决策。

---

## 12. Trace / Audit / Replay 的关系

### 12.1 trace 是过程视图

关注一次运行是怎么走下来的。

### 12.2 audit 是责任视图

关注谁对正式状态产生了影响。

### 12.3 replay 是消费能力

它把 trace、logs、audit、memory 串起来供复盘使用。

### 12.4 explainability 是解释视图

它消费 trace、policy hits、validator outputs，给出可理解理由。

---

## 13. 归属关系

观测数据必须能归属到运行对象。

### 13.1 最低归属要求

至少能归属到：

- turn
- task
- delegation
- capability invocation
- provider request

### 13.2 跨层聚合

系统应能从 provider trace 一路追到：

- capability
- task
- turn
- workspace

否则 usage、错误和 latency 无法真正定位。

---

## 14. 时间语义

### 14.1 所有观测数据必须有时间戳

时间戳统一使用 Foundation 的时间规范。

### 14.2 duration 必须显式记录

不能事后只靠 started_at / ended_at 差值临时推算，至少对关键 trace/step 要落 `duration_ms`。

### 14.3 排序原则

同一 trace 内：

- step 用 `seq_no`
- 辅以时间戳

同一 replay 输出：

- 以事件时序为主

---

## 15. 与 Provider 的关系

provider trace 必须被纳入统一观测模型。

### 15.1 provider trace 最低要求

至少记录：

- provider_ref
- model_ref
- request_id
- response_mode
- usage
- latency
- finish_reason
- error_ref

### 15.2 streaming provider 的额外要求

至少可观测：

- stream started
- stream completed
- stream failed
- stream cancelled
- partial result existence

---

## 16. 与 Long-Run 的关系

long-run 是 observability 的重点对象。

### 16.1 task trace 最低要求

至少包括：

- task lifecycle
- unit lifecycle
- checkpoint creation
- resume path
- cancellation path
- branch creation

### 16.2 long-run 指标

至少包括：

- average task duration
- completion rate
- checkpoint frequency
- adoption latency
- failure class distribution

### 16.3 checkpoint explainability

每个 checkpoint 至少要能解释：

- 为什么停
- 已完成多少
- 待处理什么

---

## 17. 与 Consistency 的关系

一致性系统的很多决策必须进入 observability。

### 17.1 必须可观测的 consistency 事件

至少包括：

- conflict detected
- adoption blocked
- rebase requested
- rebase completed
- invalidation marked
- compensation applied

### 17.2 conflict explanation

至少要保留：

- conflict type
- affected scope
- base revision
- current revision
- chosen strategy

---

## 18. 与 Security 的关系

安全与权限行为也必须被观测和审计。

### 18.1 必须可观测的安全事件

至少包括：

- authority escalation requested
- authority escalation approved / denied
- budget guard triggered
- provider auth error
- content filter hit

### 18.2 raw data 最小化暴露

observability 需要信息，但不应无边界暴露敏感原文。

因此：

- trace / audit / logs 允许使用 ref
- UI 默认只看 summary

---

## 19. 与 UI 的接口

UI 不直接读取底层 logs，但必须能消费观测摘要。

### 19.1 UI 可见内容

至少包括：

- progress summary
- usage summary
- warning summary
- failure summary
- checkpoint explanation
- replay availability hints

### 19.2 UI 不应直接消费

例如：

- raw structured logs
- provider raw payload
- full audit payload

除非明确进入高级调试视图。

### 19.3 UI 关键视图

后续 UI 至少要支持：

- task progress card
- checkpoint reason card
- failure reason card
- replay available / unavailable state

---

## 20. 与 Domain 的接口

Domain 可以注册自己的 metric labels、audit target types 和 explanation types，但不能改写基础观测结构。

### 20.1 Domain 可注册项

至少包括：

- domain metric labels
- domain-specific audit event types
- domain explanation templates
- domain replay hints

### 20.2 Domain 不得改写项

Domain 不得改写：

- trace / metric / log / audit 的基础分层
- replay level 基本语义
- observability 最低字段

---

## 21. Retention Contract

Observability 数据也需要冷热分层。

### 21.1 hot observability data

适合：

- recent traces
- active task progress
- current warnings

### 21.2 warm observability data

适合：

- summarized traces
- aggregated metrics
- checkpoint histories

### 21.3 cold observability data

适合：

- archived raw logs
- old raw provider refs
- historical audit records

### 21.4 replay 与 retention 的关系

replay 不要求所有 raw data 永远在 hot tier。  
但必须知道某段 replay 是否只能到 `result_only` 或 `trace_level`。

---

## 22. 持久化与事件要求

至少要持久化或可引用：

- trace records
- trace steps
- structured logs
- metrics snapshots or aggregations
- audit records
- replay metadata
- explanation artifacts

### 22.1 最小事件集合

至少包括：

- trace_started
- trace_step_recorded
- trace_completed
- trace_failed
- metric_emitted
- audit_recorded
- replay_requested
- replay_completed
- explanation_generated

---

## 23. 契约测试要求

### 23.1 trace tests

验证：

- turn / task / provider 都能生成 trace
- step 顺序与归属正确

### 23.2 metric tests

验证：

- 核心 metric 可聚合
- label 归属正确

### 23.3 audit tests

验证：

- 高影响动作必有 audit
- before / after revision 可追溯

### 23.4 replay tests

验证：

- result_only / trace_level / raw_level 边界清晰
- 缺失 raw 时有显式 warning

### 23.5 explainability tests

验证：

- 关键行为能生成 explanation summary
- evidence refs 可回查

---

## 24. 本文冻结的硬骨

本文正式冻结以下 observability 硬骨：

1. trace、metrics、structured logs、audit、replay、explainability 必须分层
2. trace 必须有 root、steps、duration、status
3. 高影响动作必须进入 audit
4. replay 是复盘能力，不是重跑
5. explainability 必须依赖结构化依据，而不是自由文本
6. provider、task、consistency、安全事件都必须接入统一观测体系
7. observability 数据也必须支持冷热分层

---

## 25. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. metrics 后端
2. logs 后端
3. audit store 具体存储
4. replay viewer 的最终展示形态
5. explanation artifact 的最终 schema

---

## 26. 下一步

observability 之后，建议继续：

1. `10-security-and-budget.md`

这样 Foundation 的剩余核心约束层就能补齐。

