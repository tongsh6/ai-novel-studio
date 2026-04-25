# Planning And Long-Run Contract v2

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的 Planning & Orchestration 子系统展开文档，并依赖 `docs/design-v2/05-memory-retention-and-retrieval.md`。
>
> 目标：定义 v2 的 long-run task contract，明确跨多个 turn 持续运行的任务如何被创建、确认、执行、暂停、续跑、取消、分支、失败和完成，以及这些过程中的副作用如何被受控管理。

---

## 1. 文档定位

本文回答 7 个问题：

1. 什么是 long-run task
2. long-run task 如何建模
3. long-run task 的状态机是什么
4. checkpoint 的精确定义是什么
5. tentative artifact 如何与 long-run task 绑定
6. retry / resume / cancel / branch 如何工作
7. 失败、取消、预算命中时副作用如何处理

本文不负责：

- 具体小说领域的章节 / 场景业务语义
- 最终 UI 布局
- 并发写入冲突的完整技术机制

并发冲突的底层处理会在 `07-consistency-and-concurrency.md` 细化；本文只定义 long-run 运行时对一致性系统提出什么要求。

---

## 2. 设计目标

### 2.1 长跑必须是一等运行对象

long-run 不是“循环调用单轮 executor”的实现细节。

它必须是：

- 可持久化的 task
- 可解释的运行状态
- 可预算的执行过程
- 可暂停 / 可续跑 / 可取消的工作单元

### 2.2 长跑必须可控

系统不能在用户一句“继续写”后无边界地黑箱运行。

long-run 必须显式暴露：

- 目标
- 范围
- 计划
- 预算
- 已完成项
- checkpoint 原因
- 当前消耗
- 待采纳产物
- 风险与失败信息

### 2.3 长跑必须把副作用做成受控写入

long-run 过程中产生的大多数内容都不应立即成为 production state。

必须通过：

- tentative artifact
- checkpoint
- adoption
- compensating event

来控制副作用。

### 2.4 长跑必须支持中断后恢复

恢复不能依赖“把历史所有上下文再塞一遍”。

resume 必须依赖：

- persisted task state
- checkpoint summary
- unresolved behavior states
- retained tentative artifacts
- current authoritative object refs

---

## 3. Long-Run 的定义

`long-run task` 是一个跨多个 turn 持续存在、由用户或父级 Agent 驱动、包含多个执行单元和多个可能副作用的结构化任务对象。

它与单 turn 的区别在于：

- 生命周期跨 turn
- 可能包含多个 execution step
- 可能产出多个 tentative artifact
- 可能多次进入 checkpoint
- 必须有独立预算与恢复语义

示例方向：

- 按既定大纲继续写多个场景
- 按计划生成多个章节草稿
- 对一批对象逐个执行整理 / 转写 / 修订

Foundation 不关心任务的业务内容，只关心它的运行 contract。

---

## 4. Long-Run 的运行模型

最小运行模型：

```text
turn
  -> create or continue long-run task
  -> estimate
  -> confirm if required
  -> run one or more execution units
  -> emit artifacts
  -> update task state
  -> hit checkpoint / complete / fail / cancel
  -> return canonical result
```

> 「return canonical result」严格遵循 ADR-0001（`adr/0001-turn-result-v2-schema.md`）冻结的 TurnResult v2 顶层 schema：long-run 关联的 turn 必须填 `task_id`，且 turn `phase` 与 task `phase` 的相容性受 ADR-0001 §决策内容 4 约束 4 约束。task phase / status 映射由 ADR-0002（`adr/0002-state-enums.md`）冻结；例如 task RUNNING + 执行 → turn `phase=EXECUTING`，task CHECKPOINT + 触发 clarification → turn `phase=NEEDS_CLARIFICATION`。

### 4.1 execution unit

long-run 的内部最小执行单元称为 `execution unit`。

它是一个抽象运行步，不绑定小说术语。

它可以是：

- 一个 scene generation
- 一个 chapter refinement
- 一个 object batch update
- 一个 delegated sub-task

### 4.2 checkpoint

checkpoint 不是错误，也不是仅供 UI 展示的暂停态。

checkpoint 是：

- 一个显式 task 状态
- 一个记忆压缩边界
- 一个副作用确认边界
- 一个预算与风险再评估边界

### 4.3 adoption boundary

long-run 的大部分写入先进入 artifact 层。  
是否进入 production，要受 adoption boundary 控制。

Foundation 只定义机制：

- tentative
- adopted
- discarded
- superseded

业务上哪些内容需要 adoption，由 Domain 决定。

---

## 5. Long-Run Task 的最小模型

每个 long-run task 至少要有以下结构化字段：

- `task_id`
- `task_type`
- `status`
- `phase`
- `goal`
- `scope_ref`
- `created_by`
- `parent_turn_ref`
- `parent_task_ref`（可空）
- `plan_ref`
- `estimated_budget`
- `consumed_budget`
- `checkpoint_policy_ref`
- `authority_scope`
- `current_unit_ref`
- `completed_unit_refs`
- `pending_artifact_refs`
- `accepted_artifact_refs`
- `warning_refs`
- `failure_ref`
- `resume_ref`
- `branch_parent_ref`
- `created_at`
- `updated_at`

### 5.1 `goal`

表示这条 task 的人类可理解目标。

它不是 UI 文案，而是结构化任务说明的简表述。

### 5.2 `plan_ref`

long-run 不能只有 goal，没有 plan。

计划可以粗或细，但必须以结构化计划对象存在，而不是只在 prompt 里隐含。

### 5.3 `estimated_budget`

> ADR-0003 已冻结 budget dimension 最小集合；本节的 token / wall time / execution unit count / cost / write volume 分别映射到 `token` / `wall_time` / `execution_unit_count` / `cost` / `write_count`。

`estimated_budget` 表示启动前或继续执行前的预算预估，至少要支持：

- token
- wall time
- execution unit count
- cost
- write volume

### 5.4 `consumed_budget`

`consumed_budget` 表示任务实际消耗。任务必须持续累计消耗，而不是只有启动前预估。

### 5.5 `authority_scope`

> ADR-0003 已冻结 authority_scope 最小结构与子枚举。

任务必须继承或收缩启动它的 authority。

没有 authority scope 的 long-run task 属于非法状态。

---

## 6. 状态机

### 6.1 基础状态机

```text
PLANNED
  -> ESTIMATED
  -> CONFIRMATION_REQUIRED
  -> CONFIRMED
  -> RUNNING
  -> CHECKPOINT
  -> RESUMING
  -> RUNNING
  -> COMPLETED
  -> CANCELLED
  -> FAILED
  -> BRANCHED
```

### 6.2 状态说明

- `PLANNED`
  - 已创建任务骨架
  - 尚未完成预算估计

- `ESTIMATED`
  - 已完成资源预估
  - 尚未真正执行

- `CONFIRMATION_REQUIRED`
  - 因预算、写入范围或 authority 触发确认门

- `CONFIRMED`
  - 已获准进入执行

- `RUNNING`
  - 正在执行一个或多个 unit

- `CHECKPOINT`
  - 主动或被动暂停
  - 已形成 checkpoint summary
  - 可等待用户、系统、预算或一致性处理

- `RESUMING`
  - 正在从 checkpoint 恢复运行态

- `COMPLETED`
  - 任务执行路径结束
  - 可能仍有未采纳 artifact，但不会再继续生成新 unit

- `CANCELLED`
  - 任务被显式终止
  - 不再继续生成新 unit

- `FAILED`
  - 任务因不可恢复失败退出

- `BRANCHED`
  - 当前任务被分叉为一个或多个新任务
  - 原任务不再继续推进原路径

### 6.3 终态

终态包括：

- `COMPLETED`
- `CANCELLED`
- `FAILED`
- `BRANCHED`

终态不可逆。  
后续操作必须通过新任务或新事件进行。

---

## 7. 状态迁移规则

### 7.1 create

```text
null -> PLANNED
```

### 7.2 estimate

```text
PLANNED -> ESTIMATED
```

### 7.3 confirmation

```text
ESTIMATED -> CONFIRMATION_REQUIRED -> CONFIRMED
ESTIMATED -> CONFIRMED
```

如果不需要确认，可直接从 `ESTIMATED` 进入 `CONFIRMED`。

### 7.4 start running

```text
CONFIRMED -> RUNNING
```

### 7.5 checkpoint

```text
RUNNING -> CHECKPOINT
```

### 7.6 resume

```text
CHECKPOINT -> RESUMING -> RUNNING
```

### 7.7 completion

```text
RUNNING -> COMPLETED
CHECKPOINT -> COMPLETED
```

允许任务在 checkpoint 态被直接收尾。

### 7.8 cancellation

```text
PLANNED -> CANCELLED
ESTIMATED -> CANCELLED
CONFIRMATION_REQUIRED -> CANCELLED
CONFIRMED -> CANCELLED
RUNNING -> CANCELLED
CHECKPOINT -> CANCELLED
RESUMING -> CANCELLED
```

### 7.9 failure

```text
ESTIMATED -> FAILED
CONFIRMED -> FAILED
RUNNING -> FAILED
CHECKPOINT -> FAILED
RESUMING -> FAILED
```

### 7.10 branch

```text
CHECKPOINT -> BRANCHED
RUNNING -> CHECKPOINT -> BRANCHED
```

默认不允许在纯 `RUNNING` 中无 checkpoint 分叉。

---

## 8. checkpoint Contract

checkpoint 是 long-run 的核心边界。

### 8.1 checkpoint 必须产出什么

每次 checkpoint 至少必须产出：

- `checkpoint_id`
- `task_ref`
- `trigger_reason`
- `checkpoint_summary`
- `current_consumed`
- `pending_artifact_refs`
- `accepted_artifact_refs`
- `warning_refs`
- `unresolved_refs`
- `recommended_next_actions`
- `created_at`

### 8.2 checkpoint 的语义

checkpoint 代表：

1. 当前执行步已经到达可安全暂停点
2. 之后恢复不依赖完整旧上下文重灌
3. 当前副作用边界已被记录
4. 当前预算与风险信息可见

### 8.3 checkpoint 的触发原因

至少支持：

- `UNIT_COMPLETED`
- `BUDGET_LIMIT_REACHED`
- `CONFIRMATION_REQUIRED`
- `CLARIFICATION_REQUIRED`
- `VALIDATOR_FAILED`
- `CONSISTENCY_CONFLICT`
- `USER_PAUSED`
- `RETRY_LIMIT_REACHED`
- `AUTHORITY_ESCALATION_REQUIRED`

### 8.4 checkpoint 必须是安全暂停点

进入 checkpoint 前，系统必须保证至少一项成立：

1. 当前 execution unit 已自然完成
2. 当前 execution unit 已被标记为 interrupted 且其 artifact 不会被误认为完整产物
3. 当前 side effects 已形成可审计边界

不能在半个未标注状态中直接挂起。

---

## 9. 预算与预估

### 9.1 启动前必须有 estimate

long-run 启动前，至少应尝试估计：

- token
- wall time
- cost
- planned units
- expected writes

### 9.2 预估不是承诺

estimate 只是一种运行前预测。  
因此每个 task 都必须同时维护：

- `estimated_budget`
- `consumed_budget`

### 9.3 预算门

> ADR-0003 已冻结 budget threshold kind 与 guard decision；本节只描述触发语义，不定义具体阈值数值。

以下情形必须触发 confirmation 或 checkpoint：

- 预计成本超过默认阈值
- 预计写入范围超过默认阈值
- 单次连续运行步数超过默认阈值
- authority scope 不足

### 9.4 预算命中的处理

预算命中后默认不允许静默继续。  
系统必须：

1. 进入 checkpoint
2. 记录命中的预算项
3. 提供 resume 或 adjust budget 的路径

---

## 10. execution unit Contract

### 10.1 unit 是一等对象

每个 long-run 内部的执行单元必须可追踪。

至少包含：

- `unit_id`
- `task_ref`
- `sequence_no`
- `unit_type`
- `goal`
- `input_refs`
- `output_artifact_refs`
- `status`
- `started_at`
- `ended_at`
- `usage`

### 10.2 unit 状态

建议至少支持：

- `QUEUED`
- `RUNNING`
- `SUCCEEDED`
- `INTERRUPTED`
- `FAILED`
- `SKIPPED`

### 10.3 task 与 unit 的关系

- task 是容器
- unit 是实际推进步

task 的状态不能直接替代 unit 状态。

---

## 11. tentative artifact Contract

long-run 中产生的产物默认应先走 tentative。

### 11.1 tentative 的作用

tentative 用于保证：

- 大批量生成内容不会直接污染 production
- cancel / fail 后还有可审查残留
- checkpoint 时可以逐批采纳或丢弃

### 11.2 artifact 最小字段

至少包括：

- `artifact_id`
- `task_ref`
- `unit_ref`
- `artifact_type`
- `status`
- `source_refs`
- `target_scope_ref`
- `requires_adoption`
- `content_ref`
- `revision_base`
- `created_at`

### 11.3 artifact 状态

至少支持：

- `TENTATIVE`
- `ACCEPTED`
- `EDITED_ACCEPTED`
- `DISCARDED`
- `SUPERSEDED`
- `INVALIDATED`
- `ARCHIVED`

> 7 态由 `30 §3.2` + ADR-0001 唯一权威；合法转换见 `02 §lines 523-533`。
> 与 task phase 的折叠映射（如 `TENTATIVE -> PAUSED` / `INVALIDATED -> ERROR`）见 `02 §lines 507-512`；artifact 7 态是 adoption 生命周期，不是 task 运行 phase，二者不得混用。

### 11.4 requires_adoption

artifact 必须能通过 `requires_adoption` 表达自己是否需要 adoption gate。

这样 Foundation 才能支持：

- 某些 artifact 自动成为 production-safe summary
- 某些 artifact 必须等待人工采纳

### 11.5 task 结束后 artifact 可继续存在

任务终结不等于 artifact 消失。

例如：

- `COMPLETED` 后仍可有未采纳 artifact
- `CANCELLED` 后仍可保留待审产物
- `FAILED` 后可保留最后成功单元的 tentative

---

## 12. adoption boundary

### 12.1 adoption 是独立动作

adoption 不能被任务完成自动隐含。

任务完成只表示不再继续执行新 unit，不表示所有 tentative 已进入 production。

### 12.2 adoption 的三种主路径

至少支持：

- accept as-is
- edit then accept
- discard

### 12.3 batch adoption

long-run 必须允许：

- 单 artifact 采纳
- 单 checkpoint 批量采纳
- 单 task 批量采纳

但所有 batch adoption 仍必须生成逐项可追踪事件。

---

## 13. retry Contract

retry 是 long-run 的内置恢复机制，但必须受限。

### 13.1 retry 适用范围

优先用于：

- provider transient errors
- tool transient errors
- parse / schema repair
- executor non-deterministic recoverable failures

### 13.2 不应自动 retry 的情况

至少包括：

- authority 不足
- budget 已硬性命中
- consistency conflict
- confirmation / clarification required
- 明确的 domain validator hard failure

### 13.3 retry 记录

每次 retry 至少记录：

- target unit
- retry reason
- retry count
- retry strategy
- outcome

### 13.4 retry 上限

每个 unit 必须有 retry limit。  
达到上限后默认：

```text
RUNNING -> CHECKPOINT
```

触发原因：

- `RETRY_LIMIT_REACHED`

---

## 14. cancel Contract

cancel 必须是正式语义，而不是“停止继续生成”这一句自然语言。

### 14.1 cancel 的目标

至少应支持取消：

- whole task
- current checkpoint continuation
- specific future units

### 14.2 cancel 的结果

任务进入 `CANCELLED` 后：

- 不再启动新 unit
- 已完成 unit 的 artifact 保留原状态
- 正在运行 unit 必须形成 interrupted 或 safe-stop 记录
- checkpoint summary 必须补一条 cancellation summary

### 14.3 cancel 后的 artifact policy

默认规则：

- 已 accepted artifact 保持 accepted
- 已完成 unit 的 tentative artifact 默认保留待审
- 半完成 unit 的 artifact 若不完整，必须标记不可采纳或自动丢弃

### 14.4 cancel 不是 rollback

cancel 终止未来执行。  
是否回滚既有 mutation，需要走独立 rollback / compensation policy。

---

## 15. resume Contract

resume 必须是结构化恢复，而不是“继续上次任务”的模糊命令。

### 15.1 resume 前提

只有处于 `CHECKPOINT` 的任务默认可 resume。

终态任务不可直接 resume。

### 15.2 resume 输入

至少包括：

- task ref
- target checkpoint ref
- resume options
- revised budget（可空）
- revised authority（可空）
- revised brief / goal adjustments（可空）

### 15.3 resume 的处理

系统至少应做：

1. 验证 checkpoint 是否仍有效
2. 验证 authority 是否足够
3. 验证 budget 是否足够
4. 装载 checkpoint summary
5. 检查是否存在 external changes
6. 生成 resume plan delta

### 15.4 resume 不是 blind continuation

如果 checkpoint 之后外部状态已变更，resume 必须：

- 重新验证前提
- 必要时强制新 checkpoint
- 或要求 confirmation / correction

---

## 16. branch Contract

branch 用于让 task 在 checkpoint 处产生新路径。

### 16.1 branch 的适用时机

默认只允许在 checkpoint 处分支。

### 16.2 branch 的效果

branch 后：

- 原任务进入 `BRANCHED` 或保留为已终结父任务
- 新任务继承部分上下文、计划和 artifact refs
- 新任务必须有新的 task id

### 16.3 branch 的继承范围

至少要明确：

- 继承哪些 accepted artifacts
- 继承哪些 tentative artifacts
- 是否继承 budget
- 是否继承 authority
- 是否继承 checkpoint summary

### 16.4 branch 不是覆盖

branch 的存在是为了避免“改方向 = 篡改旧历史”。

---

## 17. failure Contract

### 17.1 失败分级

long-run 至少区分三类失败：

1. `PROTOCOL_FAILURE`
2. `CONTENT_FAILURE`
3. `CONSISTENCY_FAILURE`

### 17.2 protocol failure

例如：

- schema parse failure
- malformed provider output
- tool protocol mismatch

默认处理：

- 可先 retry
- 达上限后 checkpoint 或 fail

### 17.3 content failure

例如：

- validator 判定结果不可接受
- 质量明显偏离当前任务要求

默认处理：

- 优先 checkpoint
- 等待人工确认、修改参数或改 brief

### 17.4 consistency failure

例如：

- 基于旧 revision 写入
- 发现 authoritative state 已冲突
- adoption target 已被外部修改

默认处理：

- 强制 checkpoint
- 不自动继续

### 17.5 fail 的最低保留

任务进入 `FAILED` 前，至少要落盘：

- failure reason
- last successful unit ref
- pending artifact refs
- last checkpoint summary ref（如有）
- retry history

---

## 18. 与 Memory 的关系

long-run 强依赖 Memory。

### 18.1 启动依赖

创建 long-run task 时，至少需要：

- scoped retrieval
- current authoritative summaries
- recent behavior context

### 18.2 checkpoint 依赖

每次 checkpoint 必须生成：

- checkpoint summary
- unresolved refs
- budget snapshot

这些都进入 warm tier 或 hot tier，供 resume 使用。

### 18.3 冷热分层要求

长跑不能把所有 unit 的全量输出都放在 hot tier。

默认原则：

- 当前 unit 与最近 checkpoint 留 hot
- 历史 checkpoint summary 留 warm
- 旧 trace 和 raw outputs 进 cold

---

## 19. 与一致性系统的关系

本文不定义底层锁机制，但 long-run 对一致性系统提出以下刚性要求。

### 19.1 revision awareness

每个 long-run task 至少要记录：

- planning base revision
- current authoritative revision seen
- artifact revision base

### 19.2 external changes

如果在 task 运行期间，相关作用域发生外部变化，系统必须能检测到并在 resume 或 write 前处理。

### 19.3 conflict handling

至少支持：

- soft warn
- forced checkpoint
- adoption blocked
- branch suggested

---

## 20. 与 Domain 的接口

Domain 可以决定 long-run 运行的业务粒度，但不能改写其基础运行 contract。

### 20.1 Domain 可注册项

至少包括：

- task types
- unit types
- checkpoint triggers
- default budget profiles
- adoption requirements
- validator hooks
- branch templates

### 20.2 Domain 不得改写项

Domain 不得改写：

- long-run 必须有 task object
- checkpoint 必须是显式状态
- task 终态不可逆
- cancel 不等于 rollback
- resume 需基于 checkpoint summary
- tentative artifact 需要独立生命周期

---

## 21. 与 UI 的接口

UI 必须能稳定投影 long-run state。

### 21.1 UI 可直接消费的字段

至少包括：

- task status / phase
- goal
- budget estimate / consumed
- checkpoint reason
- progress summary
- pending artifact counts
- warnings
- next actions

### 21.2 UI 不可自行推断的内容

UI 不应自己猜：

- 当前 unit 是否可安全打断
- 某个 artifact 是否可以采纳
- 当前 budget 是否真的超限

这些必须由 long-run contract 明确输出。

### 21.3 UI 关键投影场景

后续 UI 至少要覆盖：

- task startup confirmation
- running progress
- checkpoint pause
- resume options
- cancel summary
- failure summary
- batch adoption

---

## 22. 持久化要求

long-run 至少需要持久化以下实体：

- task record
- unit records
- checkpoint records
- retry records
- failure records
- artifact records
- budget snapshots
- task events

### 22.1 事件优先

建议保留：

- 状态快照
- 事件日志

双轨持久化。

### 22.2 事件最小集合

至少包括：

- task_created
- task_estimated
- task_confirmed
- task_started
- unit_started
- unit_succeeded
- unit_interrupted
- unit_failed
- checkpoint_created
- task_resumed
- task_cancelled
- task_failed
- task_completed
- task_branched
- artifact_emitted
- artifact_adopted
- artifact_discarded

---

## 23. 契约测试要求

### 23.1 state machine tests

验证：

- 合法状态迁移
- 非法状态迁移被拒绝
- 终态不可逆

### 23.2 checkpoint tests

验证：

- 各类触发原因
- checkpoint summary 产出完整
- resume 依赖 checkpoint，而不是全历史

### 23.3 side-effect tests

验证：

- tentative artifact 生命周期
- cancel 后 artifact 保留规则
- completed 不等于 adopted

### 23.4 failure tests

验证：

- protocol / content / consistency failure 分流
- retry 达上限进入 checkpoint
- hard failure 必要保留信息完整

### 23.5 compatibility tests

验证：

- 单 turn executor 能被包进 long-run unit
- long-run result 可映射为 canonical result

---

## 24. 本文冻结的硬骨

本文正式冻结以下 long-run 硬骨：

1. long-run 是一等 task，不是循环调用实现细节
2. task 必须有独立状态机、计划、预算、authority 和副作用边界
3. checkpoint 是显式状态，不是错误
4. checkpoint 必须形成 summary、预算快照和 pending artifact refs
5. tentative artifact 是 long-run 默认安全写入路径
6. completed 不等于 adopted
7. cancel 不等于 rollback
8. resume 必须基于 checkpoint summary 和当前 authoritative state
9. branch 只能在显式边界发生，默认基于 checkpoint
10. failure 至少分为 protocol / content / consistency 三类
11. long-run turn 输出必须满足 ADR-0001（`adr/0001-turn-result-v2-schema.md`）冻结的 TurnResult v2 顶层 schema：`task_id` 必填、`projection_refs[].source_revision_refs` 非空数组、turn phase 与 task phase 相容（详见 ADR-0001 §决策内容 4），且 task phase / status 映射遵守 ADR-0002。
12. long-run task 的 authority / budget / escalation 最小枚举遵守 ADR-0003；budget 命中必须产生 consumed snapshot，并进入 confirmation / checkpoint / block / escalation 中的合法路径。

---

## 25. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. checkpoint summary 的最终字段 schema
2. budget 阈值默认值
3. 各类 unit 的默认粒度
4. branch 的默认继承策略
5. hard failure 到 fail 之间的精确超时 / 重试策略

---

## 26. 下一步

long-run contract 之后，优先继续：

1. `07-consistency-and-concurrency.md`

因为 long-run 已经把 task、artifact、checkpoint 和 external changes 的要求提出来了，下一步必须把 revision、冲突检测、写入阻断和 rebase contract 定死。
