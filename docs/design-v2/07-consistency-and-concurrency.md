# Consistency And Concurrency Contract v2

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的一致性与并发子系统展开文档，并依赖 `docs/design-v2/05-memory-retention-and-retrieval.md` 与 `docs/design-v2/06-planning-and-long-run.md`。
>
> 目标：定义 v2 中结构化对象、task、artifact 与 adoption 的一致性 contract，明确 revision 基线、冲突检测、外部变更、写入阻断、无损分支和补偿边界。

---

## 1. 文档定位

本文回答 8 个问题：

1. 系统如何判断“当前写入仍然基于有效前提”
2. 什么是 authoritative state
3. revision 模型如何设计
4. 并发写入如何被检测和约束
5. long-run 运行过程中外部变更如何被处理
6. adoption 为什么不能是无条件落库
7. 什么情况下应 rebase、checkpoint、branch、fail
8. rollback 与 compensation 的边界是什么

本文不负责：

- 数据库事务实现细节
- 分布式锁实现细节
- 某个对象的具体业务字段

本文只定义系统层的一致性 contract。

---

## 2. 设计目标

### 2.1 任何写入都必须有前提

系统中的写入不是“最后写入覆盖前一个值”。

每次写入都必须有显式前提：

- 我基于哪个 revision 读到的状态
- 我假设哪些关键事实没变
- 我准备写入什么目标范围

### 2.2 并发存在必须被承认

即便 v1 暂时限制单作品单 long-run task，并发仍然存在：

- 前台用户改对象
- 后台 task 继续跑
- post-hook 在异步草拟
- adoption 在另一条 UI 交互中发生
- 未来多 Agent 角色并行工作

因此一致性 contract 不能建立在“反正不会并发”的假设上。

### 2.3 冲突不应静默吞掉

如果写入前提已经失效，系统必须显式表现为：

- warn
- block
- checkpoint
- rebase required
- branch suggested
- fail

不能偷偷覆盖 authoritative state。

### 2.4 修正要优先于回滚

在创作系统里，很多变更不是“回滚到旧状态”，而是“基于新状态重新生成、重新采纳或显式修正”。

因此 contract 必须区分：

- cancel
- rollback
- compensation
- correction
- rebase
- branch

---

## 3. 核心定义

### 3.1 authoritative state

`authoritative state` 指系统当前认定为有效、可被后续运行依赖的正式状态。

它至少包括：

- 已采纳的对象状态
- 已采纳的 artifact 投影
- 当前有效的 registry / policy version
- 当前任务运行所依赖的权威摘要

authoritative state 不等于：

- 最新生成的内容
- 最新 tentative artifact
- 最新 UI 显示内容

### 3.2 revision

`revision` 是对 authoritative state 或其子范围的版本标识。

revision 必须是结构化字段，而不是仅依赖 `updated_at`。

### 3.3 base revision

`base revision` 是某次运行或写入开始时所依赖的状态版本。

它回答：

**“这次产物是基于哪个版本的世界生成出来的？”**

### 3.4 target scope

`target scope` 是一次 mutation 预期影响的对象范围。

例如：

- 一个对象
- 一个对象集合
- 一个 task 所关联的 artifact 集
- 一个 adoption target

### 3.5 conflict

`conflict` 指写入前提或 adoption 前提与当前 authoritative state 不再兼容。

冲突不是单一概念，至少分：

- revision conflict
- semantic conflict
- authority conflict
- lifecycle conflict

---

## 4. 一致性层的基本原则

### 4.1 所有 mutation 都必须基于 base revision

任何写入提议、adoption 或 task 恢复，都必须带：

- `base_revision`
- `target_scope`

没有 base revision 的 mutation 属于非法。

### 4.2 authoritative state 永远优先

如果 tentative artifact 与当前 authoritative state 冲突，默认原则是：

- 不更新 authoritative state 以迁就 tentative
- 先处理 tentative：重算、作废、修正或分支

### 4.3 accepted 才能进入 authoritative state

tentative artifact、draft summary、pending hook result 都不是 authoritative state。

### 4.4 更新必须先检查，再提交

一致性路径至少包含：

```text
load authoritative revision
  -> compare with base revision
  -> validate scope
  -> detect conflicts
  -> choose strategy
  -> commit accepted change or block
```

### 4.5 不做隐式覆盖

如果冲突存在，系统不能做：

- 静默覆盖
- 静默丢弃旧变更
- 静默把 tentative 当 accepted

---

## 5. revision 模型

### 5.1 revision 的层级

Foundation 至少支持三层 revision：

1. object revision
2. scope revision
3. task-seen revision

### 5.2 object revision

对象级 revision 用于保护单对象写入。

适用：

- 单对象 patch
- adoption target 是某个对象
- post-hook 更新单对象摘要

### 5.3 scope revision

范围级 revision 用于保护一组对象的整体一致性。

适用：

- 一组对象协同变化
- task 运行期间依赖某个作用域的整体稳定性
- 章节、场景、人物关系等跨对象一致性

### 5.4 task-seen revision

任务级 revision 用于记录某个 long-run 在启动或 checkpoint 时看到的 authoritative snapshot。

作用：

- 恢复时知道“我上次看的是哪个版本”
- 检测外部变化是否发生

### 5.5 revision 不等于时间戳

时间戳可以辅助排序，但不能代替 revision 语义。

---

## 6. scope 模型

一致性系统必须知道“冲突发生在哪个范围”。

### 6.1 scope 的最低要求

scope 至少应包含：

- `scope_type`
- `scope_ref`
- `parent_scope_ref`
- `revision`

### 6.2 典型 scope

Foundation 不定义小说对象名，但允许 Domain 注册自己的 scope 类型。

Foundation 至少支持抽象 scope：

- workspace scope
- root entity scope
- object scope
- task scope
- artifact scope

### 6.3 conflict 可以局部化

不是所有外部变化都应该打断整个 task。

因此系统必须能判断：

- 变化是否命中当前 target scope
- 变化是否命中依赖 scope
- 变化是否只影响无关 scope

---

## 7. mutation Contract

### 7.1 mutation 是显式对象

任何写入都应表现为显式 mutation request 或 mutation event。

至少包括：

- `mutation_id`
- `actor_ref`
- `source_turn_ref`
- `source_task_ref`（可空）
- `target_scope`
- `base_revision`
- `proposed_change_ref`
- `authority_scope`
- `requires_adoption`
- `created_at`

### 7.2 mutation 的阶段

至少支持：

- `PROPOSED`
- `VALIDATING`
- `BLOCKED`
- `APPLIED`
- `SUPERSEDED`
- `CANCELLED`

### 7.3 mutation 与 artifact 的关系

artifact 是产物。  
mutation 是对 authoritative state 的变更申请或变更事件。

两者不能混为一谈。

同一 artifact 可以：

- 不产生 mutation
- 产生一个或多个 mutation proposals

---

## 8. adoption Contract 的一致性要求

adoption 是一致性系统里风险最高的写入之一。

### 8.1 adoption 必须检查 base revision

采纳某个 artifact 前，至少要验证：

- artifact 的 `revision_base`
- 当前 target scope revision
- artifact 的 target scope 是否仍有效

### 8.2 adoption 不能只看 artifact 内容本身

即使 artifact 本身“写得很好”，如果其前提世界已经变了，仍不能直接采纳。

### 8.3 adoption 的结果分流

至少支持：

- `APPLIED`
- `BLOCKED_BY_CONFLICT`
- `REQUIRES_REBASE`
- `REQUIRES_CORRECTION`
- `SUGGEST_BRANCH`

### 8.4 批量 adoption 逐项判断

batch adoption 不能因为用户点了“全部采纳”就跳过逐项 revision 检查。

---

## 9. 冲突分类

### 9.1 revision conflict

定义：base revision 与当前 authoritative revision 不一致。

典型场景：

- long-run 在旧对象版本上生成了内容
- post-hook 基于旧摘要尝试写回

默认处理：

- block 或 checkpoint

### 9.2 semantic conflict

定义：revision 可能一致，但依赖语义已变得不兼容。

典型场景：

- 目标对象没变，但上游规则对象变了
- 角色设定变更导致旧正文不再成立

默认处理：

- warn、block 或 branch suggested

### 9.3 authority conflict

定义：当前 actor 或 task 的 authority 不足以完成写入。

默认处理：

- confirmation
- escalation required
- block

### 9.4 lifecycle conflict

定义：目标对象或 artifact 已进入不兼容生命周期状态。

典型场景：

- 想采纳一个已被 superseded 的 artifact
- 想继续 resume 一个终态 task

默认处理：

- block

---

## 10. 冲突检测时机

### 10.1 创建 task 时

至少检查：

- scope 是否存在
- authority 是否足够
- 当前 base revision 是否可记录

### 10.2 每个 execution unit 启动前

至少检查：

- task-seen revision 是否仍可接受
- 当前 unit target scope 是否发生外部变化

### 10.3 每次 checkpoint 时

至少记录：

- current seen revision
- current authoritative revision
- diff summary

### 10.4 每次 resume 时

resume 是冲突检测高峰点。  
至少要重新验证：

- checkpoint base revision
- 当前 authoritative revision
- pending artifact revision_base
- unresolved refs

### 10.5 每次 adoption 前

这是强制检测点。  
不能跳过。

---

## 11. 外部变更模型

`external change` 指 task 或 artifact 产生之后，目标或依赖 scope 被其他 actor、其他 turn、其他 task 或系统维护流程改变。

### 11.1 外部变更来源

至少包括：

- user direct action via agent
- another long-run task
- post-hook adoption
- correction / rollback / compensation event
- future sub-agent

### 11.2 外部变更的影响级别

至少支持：

- `NO_EFFECT`
- `SOFT_WARNING`
- `REBASE_REQUIRED`
- `ADOPTION_BLOCKED`
- `TASK_CHECKPOINT_REQUIRED`

### 11.3 外部变更不等于立即失败

很多变更可以通过：

- rebase
- correction
- new checkpoint
- branch

来吸收。

---

## 12. optimistic concurrency 与 lease

Foundation 不强制唯一实现，但必须允许两类机制：

1. optimistic concurrency
2. scoped lease

### 12.1 optimistic concurrency

默认首选。

机制：

- 读取时记录 base revision
- 写入时检查当前 revision
- 不一致则 block 或 rebase

适用：

- 大多数 adoption
- 单对象更新
- 低争用环境

### 12.2 scoped lease

用于短时间内减少高风险竞争写入。

机制：

- 在某个 scope 上声明短时 lease
- lease 不是绝对锁，只是受控写入优先权或协调信号

适用：

- 高价值批量写入
- 长跑进入关键 adoption 阶段
- 未来多 Agent 分工协作

### 12.3 lease 不能替代 revision 检查

即使持有 lease，写入时仍需检查 revision。

lease 只是降低竞争，不保证前提永远有效。

---

## 13. rebase Contract

rebase 用于在 base revision 过期后，让 task 或 artifact 在新 authoritative state 上重建前提。

### 13.1 rebase 的定义

rebase 不是简单重试。

rebase 至少包括：

- 读取新 authoritative state
- 比较旧 base revision 与新 revision
- 评估旧 artifact / old plan 是否仍可用
- 生成 delta 或要求重算

### 13.2 rebase 的适用对象

至少包括：

- pending artifact
- checkpointed task
- unadopted mutation proposal

### 13.3 rebase 的结果

至少支持：

- `REBASABLE_NO_CHANGE`
- `REBASABLE_WITH_DELTA`
- `REGENERATE_REQUIRED`
- `NOT_REBASABLE`

### 13.4 自动 rebase 的边界

默认只对低风险、局部 scope 变更考虑自动 rebase。

以下情况不应自动 rebase：

- authority 不足
- semantic conflict 高风险
- 批量高影响 adoption
- 上游规则被重定义

---

## 14. invalidation Contract

当旧 artifact 或旧 plan 已经不再可信时，系统必须能显式失效化。

### 14.1 invalidation 的目标

至少支持失效：

- pending artifact
- checkpoint summary
- plan step
- derived summary

### 14.2 invalidation 的原因

至少包括：

- stale revision
- semantic drift
- superseded by correction
- branch divergence
- authority withdrawn

### 14.3 invalidation 结果

被失效的对象不能再被静默当作可采纳输入。

系统至少要能表达：

- invalid but inspectable
- invalid and blocked

---

## 15. long-run 与并发

### 15.1 task 运行期间的最小一致性要求

每个 task 至少要维护：

- planning base revision
- latest seen revision
- per-artifact revision_base
- dependency scope refs

### 15.2 后台跑、前台改的处理原则

如果后台 task 在运行，前台又改了相关 scope，默认优先级是：

1. authoritative state 先更新
2. 后台 task 看到外部变化后不能继续盲写
3. 下一个写入点或 resume 点必须重检

### 15.3 长跑不应长期持有硬锁

long-run 是长生命周期对象，不应通过长期数据库硬锁维持一致性。

应优先依赖：

- revision checks
- short lease
- checkpoint boundaries

---

## 16. correction、rollback、compensation 的边界

### 16.1 correction

用于修正识别、参数、结果理解或业务语义。

它通常：

- 创建新事件
- 可能触发 supersede
- 不一定撤销既有 authoritative state

### 16.2 rollback

用于撤销某次已应用 mutation 的效果。

rollback 只适用于满足明确可逆条件的变更。

### 16.3 compensation

用于当 rollback 不可行时，通过新变更抵消旧影响。

在创作系统里，compensation 往往比 rollback 更常见。

例如：

- 不是删掉旧正文，而是追加修订事件
- 不是抹掉旧关系，而是写入新关系状态

### 16.4 cancel 不触发自动 rollback

这条必须再次强调：

- task cancel 终止未来执行
- rollback / compensation 是独立语义

---

## 17. write strategy 决策矩阵

当系统检测到冲突时，至少应能做出以下决策之一：

- proceed
- proceed_with_warning
- checkpoint_required
- confirmation_required
- rebase_required
- branch_suggested
- block
- fail

### 17.1 proceed

适用：

- 无冲突
- 或冲突不影响 target scope

### 17.2 proceed_with_warning

适用：

- 发现低风险 drift
- 当前写入仍可接受

### 17.3 checkpoint_required

适用：

- 需要用户或系统在安全边界处理变化

### 17.4 rebase_required

适用：

- base revision 已过期但仍可能重建

### 17.5 branch_suggested

适用：

- 新旧路径都值得保留
- 不适合简单覆盖

### 17.6 block

适用：

- authority 不足
- lifecycle 不兼容
- adoption target 已无效

### 17.7 fail

适用：

- 前提损坏且无法恢复

---

## 18. consistency explanation

一致性系统不只是阻断写入，还必须给出可解释结果。

### 18.1 最低解释内容

至少包括：

- 哪个 scope 发生冲突
- 当前 revision 与 base revision 的关系
- 触发了哪类 conflict
- 系统建议的下一步动作

### 18.2 explanation 的消费者

至少包括：

- UI
- audit
- debug
- migration tooling

---

## 19. 与 Memory 的关系

一致性系统依赖 Memory 来获知“旧前提是什么”和“当前权威状态是什么”。

### 19.1 依赖项

至少包括：

- checkpoint summaries
- authoritative summaries
- revisioned object snapshots
- invalidation events

### 19.2 Memory summary 不能替代 revision

summary 可以辅助理解，但不能单独作为写入合法性的依据。

写入合法性必须回到 revision / scope / authority contract。

---

## 20. 与 Domain 的接口

Domain 可以定义哪些对象、哪些 scope、哪些变更被视为高价值或高风险，但不能改写基础一致性机制。

### 20.1 Domain 可注册项

至少包括：

- scope types
- semantic conflict heuristics
- rebase hints
- branch suggestion rules
- compensation templates

### 20.2 Domain 不得改写项

Domain 不得改写：

- base revision 必填原则
- adoption 前必须检查 revision
- authoritative state 优先
- cancel 不等于 rollback
- revision conflict 不得静默吞掉

---

## 21. 与 UI 的接口

UI 必须能看到一致性结果，但不能自己实现一致性逻辑。

### 21.1 UI 可见内容

至少包括：

- conflict type
- affected scope summary
- suggested next action
- rebase required flag
- adoption blocked flag
- branch suggestion

### 21.2 UI 不可做的事

UI 不应自己决定：

- 某个冲突是否可忽略
- 某个 adoption 是否还能强行通过
- 某个 revision 是否“看起来差不多”

### 21.3 UI 关键场景

后续 UI 至少要投影：

- adoption blocked 卡
- rebase required 卡
- branch suggestion 卡
- external changes 警示

---

## 22. 持久化与事件要求

一致性系统至少应持久化：

- revisioned object state refs
- mutation requests
- mutation apply events
- conflict events
- invalidation events
- compensation events
- lease refs（如有）

### 22.1 最小事件集合

至少包括：

- revision_observed
- mutation_proposed
- mutation_blocked
- mutation_applied
- conflict_detected
- rebase_requested
- rebase_completed
- rebase_failed
- invalidation_marked
- compensation_applied

---

## 23. 契约测试要求

### 23.1 revision tests

验证：

- base revision 缺失时拒绝写入
- revision mismatch 被检测

### 23.2 adoption tests

验证：

- adoption 前强制 revision 检查
- batch adoption 逐项判断

### 23.3 conflict routing tests

验证：

- revision / semantic / authority / lifecycle 冲突被正确分流
- 正确给出 proceed / checkpoint / rebase / block / fail

### 23.4 long-run interaction tests

验证：

- task 运行中发生外部变化时，下一个关键边界触发正确处理
- resume 前进行 external change 检测

### 23.5 compensation tests

验证：

- cancel 不自动 rollback
- rollback 与 compensation 是独立事件

---

## 24. 本文冻结的硬骨

本文正式冻结以下一致性硬骨：

1. 所有 mutation 都必须带 base revision 与 target scope
2. authoritative state 永远优先于 tentative 产物
3. adoption 前必须做 revision 检查
4. revision conflict 不得静默吞掉
5. 允许 optimistic concurrency 与 scoped lease 并存
6. lease 不能替代 revision check
7. rebase 是独立语义，不等于 retry
8. invalidation 必须可显式标注
9. cancel 不等于 rollback，rollback 不等于 compensation
10. long-run 在外部变更下必须重检，不能盲写

---

## 25. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. revision id 的编码形式
2. lease 的具体超时策略
3. semantic conflict 的最终判定算法
4. 自动 rebase 的默认阈值
5. compensation template 的具体结构

---

## 26. 下一步

一致性 contract 之后，建议优先继续：

1. `12-multi-agent-composition.md`
2. `13-v1-to-v2-migration.md`

原因：

- 多 Agent 必须建立在 revision、authority、artifact handoff 都已明确的基础上
- 迁移文档需要把 revision、summary、task、artifact、adoption 这些新 contract 安全落到现有仓库上

