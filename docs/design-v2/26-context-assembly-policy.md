# Context Assembly Policy v2

> 状态：草案
>
> 角色：`docs/design-v2/20-novel-domain-overview.md` 之后的上下文组装策略文档，并依赖 `docs/design-v2/05-memory-retention-and-retrieval.md`、`docs/design-v2/21-novel-object-model.md`、`docs/design-v2/22-continuity-model.md`、`docs/design-v2/23-style-and-author-intent.md`、`docs/design-v2/24-novel-intent-catalog.md`、`docs/design-v2/25-maintenance-hooks.md`。
>
> 目标：定义 v2 中 Router、Executor、LongRunner、Validator、Reader 等不同消费者的上下文组装策略，明确上下文来源、优先级、预算约束、降级路径和排除规则。

---

## 1. 文档定位

本文回答 8 个问题：

1. 为什么上下文组装必须独立成策略层
2. 不同消费者各自需要什么上下文
3. 结构化对象、summary、原文片段应该按什么顺序组合
4. 预算不足时如何降级
5. 哪些内容绝不应该默认进入某类上下文
6. 长跑恢复应优先读取什么
7. 阅读模式应消费什么，不消费什么
8. 后续 capability registry 和 UI 如何依赖这份策略

本文不负责：

- 具体 prompt 模板
- embedding / vector store 具体实现
- UI 布局

本文只冻结小说层上下文组装策略。

---

## 2. 为什么上下文组装必须独立建模

如果没有独立策略层，系统很容易退回成：

- 把所有对象都塞进 prompt
- 把最近所有对话都塞进 prompt
- 写一章就重读所有正文

结果是：

- 成本爆炸
- latency 爆炸
- 关键信息反而被淹没
- 长篇运行越来越不稳定

因此上下文组装必须是：

- 面向消费者
- 面向预算
- 面向任务目标
- 面向 memory tier

的独立策略层。

---

## 3. 设计目标

### 3.1 最小必要上下文

默认原则仍是：

**只给当前消费者完成当前任务所必需的上下文。**

### 3.2 结构优先于原文堆叠

在长篇连载里，结构化对象和高质量 summary 通常比海量原文更重要。

### 3.3 上下文必须可解释

系统至少要能说明：

- 为什么选了这些上下文
- 为什么省略了那些
- 是否使用了 summary 替代原文

### 3.4 同一作品，不同消费者拿到的上下文应明显不同

Router、Executor、LongRunner、Reader 不应共享同一份“万能上下文包”。

---

## 4. 消费者类型

小说层至少有以下上下文消费者：

1. Router
2. Executor
3. LongRunner
4. Validator
5. Maintenance
6. Reader
7. Debug / Replay

### 4.1 Router

目标：

- 识别用户意图
- 提取 slot
- 决定行为方向

### 4.2 Executor

目标：

- 产出结构或文本结果

### 4.3 LongRunner

目标：

- 推进跨多个 unit 的持续任务

### 4.4 Validator

目标：

- 校验结构、连续性、adoption、冲突

### 4.5 Maintenance

目标：

- 从正文推进提炼连续性对象

### 4.6 Reader

目标：

- 消费阅读投影

### 4.7 Debug / Replay

目标：

- 复盘与诊断

---

## 5. 上下文来源总览

小说层上下文来源至少包括：

1. work-level summary
2. main structure objects
3. asset objects
4. continuity objects
5. style objects
6. accepted drafts
7. chapter / scene summaries
8. recent interaction summaries
9. checkpoint summaries
10. pending artifacts（受限）

### 5.1 work-level summary

作品根层信息与最小定位信息。

### 5.2 main structure objects

- worldbuilding
- main_outline
- volume / arc
- chapter
- scene

### 5.3 asset objects

- character
- faction
- organization
- location
- relationship
- item / ability

### 5.4 continuity objects

- state_snapshot
- timeline_event
- foreshadowing
- worldrule
- chapter_summary

### 5.5 style objects

- style_sample-derived cues
- writing_preferences
- brief
- feedback_patch

### 5.6 accepted drafts

已采纳正文及其局部片段。

### 5.7 interaction summaries

对话层摘要，而非全量历史。

### 5.8 checkpoint summaries

长跑恢复和继续的重要来源。

---

## 6. 组装层级原则

上下文组装应遵循固定层级顺序。

### 6.1 推荐顺序

默认顺序：

1. 当前任务元信息
2. 当前锚点结构对象
3. 当前权威连续性对象
4. 当前权威风格对象
5. 相关 summary
6. 必要原文片段
7. 最近运行态上下文

### 6.2 解释

- 任务元信息决定本轮要干什么
- 结构对象决定当前写哪一层
- 连续性对象决定不能写错什么
- 风格对象决定怎么写
- summary 提供压缩背景
- 原文片段只在必要时补血肉

### 6.3 不允许的默认顺序

不建议：

1. 先塞所有正文
2. 再塞所有对话
3. 最后再塞结构对象

这会让最重要的约束被原文淹没。

---

## 7. Router Context Policy

Router 是最小上下文消费者。

### 7.1 Router 应读取的内容

至少包括：

- active work summary
- active structure focus（当前卷 / 章 / 场）
- 当前 open behaviors
- 最小风格与阶段提示

### 7.2 Router 不应默认读取的内容

至少包括：

- 大段 accepted drafts
- 大量连续性原始对象全文
- 大量 style samples 原文

### 7.3 Router 的关键目标

Router 需要的是“判断方向”，不是“写正文”。

因此它需要：

- 小而稳的上下文
- 当前焦点
- 当前任务范围

而不是全书记忆包。

---

## 8. Executor Context Policy

Executor 是最典型的内容消费者。

### 8.1 Executor 应读取的内容

至少包括：

- target structure objects
- relevant continuity layer
- active style layer
- local accepted text context
- task / brief context

### 8.2 结构对象优先

对于写章、写场、改稿来说：

优先读取：

- 当前 chapter / scene
- 上游 outline / volume

### 8.3 continuity 优先级高于大段旧对话

至少优先于：

- 旧聊天记录
- 无关章节原文

### 8.4 style 层必须进入 Executor

尤其对：

- drafting
- revising

否则风格模型等于白建。

### 8.5 Executor 的原文片段策略

只读取与当前目标直接相邻或强相关的 accepted text excerpts，而不是整本书。

---

## 9. LongRunner Context Policy

LongRunner 不是“更大的 Executor”，它需要不同的上下文。

### 9.1 LongRunner 应读取的内容

至少包括：

- task state
- plan
- latest checkpoint summary
- target structure window
- active continuity layer
- active style layer
- pending / accepted artifacts summary

### 9.2 checkpoint summary 优先

长跑恢复时优先读取：

- checkpoint summary
- accepted continuity updates

而不是回灌所有旧 turn。

### 9.3 LongRunner 不应默认读取

至少包括：

- 全量 interaction history
- 所有 style sample 原文
- 全书所有 draft 全文

### 9.4 unit window

LongRunner 每次推进应限定在当前 unit window 内：

- 当前 scene
- 当前 chapter
- 当前 batch

而不是把整本书当一个大上下文任务。

---

## 10. Validator Context Policy

Validator 不是创作者，因此上下文要求不同。

### 10.1 Validator 应读取的内容

至少包括：

- target artifact
- target scope summary
- relevant continuity objects
- relevant style constraints（必要时）
- revision / authority / adoption metadata

### 10.2 Validator 不应默认读取

至少包括：

- 无关大段原文
- 大量历史对话

### 10.3 Validator 的重点

它更需要：

- 结构化依据
- current authoritative state
- target artifact

而不是叙事沉浸。

---

## 11. Maintenance Context Policy

Maintenance 的上下文与写正文不同。

### 11.1 Maintenance 应读取的内容

至少包括：

- source chapter / scene text or excerpt
- current continuity layer
- current anchor context
- accepted previous summaries

### 11.2 Maintenance 的重点

它需要的是：

- 提炼变化
- 对齐现有连续性层

而不是丰富生成风格。

### 11.3 Maintenance 对 style 的依赖

通常较弱，仅在 summary 风格或 reader-facing recap 时可弱引用 style 层。

---

## 12. Reader Context Policy

Reader 是最特殊的消费者。

### 12.1 Reader 应读取的内容

至少包括：

- accepted reading projection
- accepted structure ordering
- accepted recap / summary（按需）

### 12.2 Reader 不应默认读取

至少包括：

- tentative artifacts
- open clarification / confirmation
- raw maintenance artifacts
- raw provider traces

### 12.3 Reader 的目标

Reader 不是为了生成，而是为了消费成品。

因此它的上下文应尽量干净。

---

## 13. Debug / Replay Context Policy

调试与回放可以看得更多，但也不能无限制乱取。

### 13.1 应读取的内容

至少包括：

- trace refs
- behavior states
- task history
- relevant artifacts
- raw refs（按 replay level）

### 13.2 与 Reader 的区别

Reader 看成品，Debug 看运行。

---

## 14. 上下文预算原则

上下文组装必须服从预算，而不是相反。

### 14.1 预算维度

至少包括：

- token budget
- source count budget
- latency budget

### 14.2 预算内优先级

默认优先顺序：

1. 当前结构目标
2. 当前权威连续性对象
3. 当前权威风格对象
4. 相关 summaries
5. 局部 accepted text excerpts
6. 最近 interaction summaries

### 14.3 降级路径

预算不足时，默认降级顺序应为：

- 原文片段 -> summary
- 多个 summary -> aggregate summary
- 无关历史 -> 直接省略

### 14.4 禁止降级的内容

通常不应降级掉：

- 当前 target object
- 必要 worldrules
- active brief
- blocking behavior context

---

## 15. 结构化对象 vs summary vs 原文片段

这是上下文组装的核心权重问题。

### 15.1 结构化对象

优先表达：

- 当前焦点
- 当前权威状态
- 当前约束

### 15.2 summary

优先表达：

- 压缩背景
- 近期相关进展
- 历史局部 recap

### 15.3 原文片段

优先表达：

- 局部文风
- 上下句承接
- 必须引用的细节

### 15.4 默认权重顺序

对大多数执行消费者，推荐：

```text
structured objects > summaries > raw text excerpts
```

对 Reader 则不同：

```text
accepted projection > recap summary
```

---

## 16. exclusion rules

上下文组装必须明确“哪些不该进来”。

### 16.1 默认排除项

至少包括：

- unrelated drafts
- stale tentative artifacts
- superseded / invalidated continuity objects
- archived style patches
- resolved but no longer relevant behaviors

### 16.2 Reader 默认排除项

尤其包括：

- open tasks
- pending adoption items
- debug traces

### 16.3 Router 默认排除项

尤其包括：

- 大段正文全文
- 长篇连续性全量对象

---

## 17. stale / tentative / authoritative 区分

上下文组装必须显式知道对象层次。

### 17.1 authoritative 优先

默认情况下：

- authoritative objects
- accepted artifacts

优先进入上下文。

### 17.2 tentative 受限进入

tentative artifact 只有在以下情况下才应进入：

- 当前用户正在 review / adopt
- 当前 task 仍在 checkpoint review
- debug / replay 视图

### 17.3 stale 对象处理

stale、superseded、invalidated 对象默认排除，除非：

- replay
- debug
- correction context

---

## 18. 多层 brief 与 style patch 的组装

风格层需要特殊拼装规则。

### 18.1 brief 组装顺序

推荐：

- local brief
- parent brief
- work-level brief

### 18.2 feedback patch

active patch 应在当前目标范围内优先于长期 preference。

### 18.3 style sample

原始样本通常不直接进上下文，除非：

- revise / imitate-like task
- style extraction task

否则优先使用 derived style cues。

---

## 19. context explanation

上下文组装必须可解释。

### 19.1 至少能说明

- 选了哪些来源
- 省略了哪些层
- 是否用 summary 替代了原文
- 是否排除了 tentative / stale 对象

### 19.2 explainability 的消费者

至少包括：

- debug
- observability
- advanced UI diagnostics

---

## 20. 与 Intent Catalog 的关系

不同 intent family 决定不同上下文策略偏重。

### 20.1 结构族

更依赖：

- main structure objects
- selected assets
- limited continuity

### 20.2 正文 / 改稿族

更依赖：

- local structure
- continuity
- style
- local accepted text

### 20.3 维护族

更依赖：

- source text
- current continuity layer

### 20.4 阅读族

更依赖：

- accepted projection
- accepted summaries

---

## 21. 与 Long-Run 的关系

long-run 需要最稳定的上下文策略。

### 21.1 create

启动时应组装：

- plan context
- target structure window
- active continuity layer
- active style layer

### 21.2 checkpoint

checkpoint 后应优先生成可复用 summary，而不是指望下一次再重组全量上下文。

### 21.3 resume

恢复时应优先读取：

- checkpoint summary
- authoritative deltas
- unresolved refs

---

## 22. 与 Maintenance 的关系

maintenance 是另一类特殊消费者。

### 22.1 source-heavy

它对 source text 的依赖通常比 Router 更强。

### 22.2 style-light

它对 style 的依赖通常比 drafting 更弱。

### 22.3 continuity-aware

它必须读取当前 continuity layer，否则无法正确判断新增、更新、回收。

---

## 23. 与 UX 的关系

上下文组装本身不是 UI 直接对象，但其结果影响 UI 解释能力。

### 23.1 UI 可见摘要

后续 UI 可展示：

- 当前引用了哪些层
- 省略了多少历史
- 当前依据的 brief / summary / rule

### 23.2 UI 不应直接控制组装排序

UI 可以影响显示偏好，但不应直接决定：

- “先读哪几章”
- “这次省略哪些 worldrule”

这些属于策略层。

---

## 24. 与 Foundation 的接口

上下文组装依赖 Foundation 的 memory、registry、budget、behavior、UX contract。

### 24.1 依赖项

至少包括：

- consumer_type
- memory tiers
- retrieval policy
- behavior context
- budget guard

### 24.2 不可改写项

小说层不能改写：

- retrieval / replay 分离原则
- hot / warm / cold 语义
- budget 为第一约束的原则

---

## 25. 持久化与事件要求

上下文组装结果至少要留下可审计摘要，而不一定要保存完整 prompt 包。

### 25.1 建议保留

至少包括：

- context assembly summary
- selected source refs
- omitted source refs summary
- downgrade notes

### 25.2 最小事件集合

至少包括：

- context_assembled
- context_downgraded
- stale_source_excluded
- tentative_source_included

---

## 26. 契约测试要求

### 26.1 consumer tests

验证：

- Router / Executor / LongRunner / Reader 拿到的上下文明显不同

### 26.2 budget tests

验证：

- 预算不足时按策略降级
- 必要对象不会被错误剔除

### 26.3 authority / status tests

验证：

- stale / tentative / invalidated 对象不会错误进入主执行路径

### 26.4 long-run resume tests

验证：

- resume 依赖 checkpoint summary 和权威对象，不依赖全量重灌

---

## 27. 本文冻结的硬骨

本文正式冻结以下 context assembly 硬骨：

1. 上下文组装必须按消费者分策略，而不是一份万能上下文包
2. 默认组装顺序是：任务元信息 -> 结构对象 -> 连续性对象 -> 风格对象 -> summaries -> 原文片段 -> 近期运行态
3. 对大多数执行消费者，默认优先级是 `structured objects > summaries > raw text excerpts`
4. Router 只拿最小必要上下文
5. LongRunner resume 优先依赖 checkpoint summary 和权威对象
6. Reader 不应默认读取 tentative、debug、open-task 信息
7. stale / superseded / invalidated 对象默认排除
8. style_sample 原文通常不直接进入常规执行上下文，优先使用 derived cues

---

## 28. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. 各消费者的最终 token 配额
2. aggregate summary 的具体格式
3. context assembly summary 的最终 schema
4. 片段切分策略的最终参数

---

## 29. 下一步

context assembly 之后，最自然的是：

1. `27-reading-projection.md`

因为上下文如何喂系统已经定了，下一步就该把 accepted drafts 和结构对象如何投影成阅读面正式定下来。
