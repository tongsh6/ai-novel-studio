# Novel Domain Overview v2

> 状态：草案
>
> 角色：v2 Domain Layer 的总览文档。它建立在 `docs/design-v2/01-agent-foundation-contract.md` 到 `11-ux-contract.md` 的 Foundation contract 之上。
>
> 目标：定义小说业务层的总体边界、核心维度、生命周期主线、与 Foundation 的依赖关系，以及后续 Domain 子文档的组织方式。

---

## 1. 文档定位

本文回答 6 个问题：

1. 小说 Domain Layer 到底负责什么
2. 小说层与 Foundation 的边界在哪里
3. 小说层内部应该如何分维度组织
4. 小说创作的全生命周期主线是什么
5. 为什么“长篇连载”要求 Domain 层显式建模，而不是只靠 prompt
6. 后续 Domain 文档应该如何展开

本文不负责：

- 具体对象字段全集
- 具体 intent 参数表
- UI 页面和原型

本文是 Domain 层的总纲。

---

## 2. Domain Layer 的定义

`Novel Domain Layer` 是建立在通用 Agent Foundation 之上的小说业务特化层。

它负责把“通用 Agent 能力”落实为“小说创作能力”。

Foundation 解决的是：

- turn / task / behavior / capability / memory / budget / consistency / provider / UX contract

Novel Domain 解决的是：

- 写的是什么书
- 书有哪些层级结构
- 连续性如何建模
- 作者意志如何沉淀
- 创作任务如何按小说语义拆分
- 阅读投影如何成立

---

## 3. Domain Layer 的职责

小说层至少负责以下 8 类职责：

1. 生命周期对象建模
2. 时序连续性对象建模
3. 风格与作者意志建模
4. 小说 intent catalog
5. 小说 capability / hook / validator 注册
6. 小说上下文组装策略
7. 小说阅读投影
8. 小说创作生命周期流程

### 3.1 生命周期对象建模

回答：

- 一部小说由哪些层级构成
- 哪些对象是主链
- 哪些对象是跨层资产

### 3.2 时序连续性对象建模

回答：

- 什么是当前有效状态
- 时间线如何表达
- 伏笔如何追踪
- 规则如何约束

### 3.3 风格与作者意志建模

回答：

- 作者偏好存在哪里
- 风格样本怎么进入系统
- brief 如何影响执行

### 3.4 小说 intent catalog

回答：

- 这个领域里有哪些高频创作动作
- 每类动作需要哪些输入
- 每类动作对应什么能力路径

### 3.5 capability / hook / validator 注册

回答：

- 哪些能力是小说层特有的
- 哪些维护流程要自动触发
- 哪些产物需要特定 validator

### 3.6 上下文组装策略

回答：

- Router、Executor、LongRunner、Reader 各自要看什么
- 结构化对象、summary、原文片段怎么组合

### 3.7 阅读投影

回答：

- 哪些内容能进入阅读模式
- accepted / tentative 的边界在哪

### 3.8 创作生命周期流程

回答：

- 从立项到阅读，各阶段如何切换
- 各阶段的主对象、主 intent、主风险是什么

---

## 4. Domain Layer 的非职责

小说层不负责：

1. turn / task 基础状态机定义
2. provider 抽象
3. authority / budget / guard 基础机制
4. observability 基础结构
5. render mode / card taxonomy 基础语义
6. multi-agent 的基础委派协议

这些属于 Foundation。

小说层可以注册实例和业务规则，但不能改写这些基础机制。

---

## 5. 为什么小说层必须显式建模

如果只是让模型“写小说”，系统会退化成：

- 单轮惊艳
- 长程漂移
- 设定遗忘
- 风格不稳
- 连续性崩坏

长篇连载要求的不是一次输出好看，而是：

- 数百回合之后仍然记得这本书
- 多卷多章多场景之间逻辑不散
- 作者的偏好和禁忌持续有效
- 读者可阅读的成品层稳定存在

因此小说层必须把以下内容显式对象化：

- 层级结构
- 时序状态
- 风格偏好
- 维护动作

---

## 6. 三大维度

小说层不应只按“表”来组织，而应按三大维度理解。

### 6.1 生命周期维度

回答：

**“这本书有哪些层级对象，它们如何组成主结构？”**

核心对象链：

```text
work
  -> worldbuilding
  -> main_outline
  -> volume / arc
  -> chapter
  -> scene
  -> draft
```

跨层对象：

- character
- faction
- organization
- location
- relationship
- item
- ability

### 6.2 时序连续性维度

回答：

**“随着创作推进，这本书的有效状态如何变化？”**

核心对象：

- state_snapshot
- timeline_event
- foreshadowing
- worldrule
- chapter_summary

### 6.3 风格与作者意志维度

回答：

**“这本书应该以什么方式被写出来？”**

核心对象：

- style_sample
- writing_preferences
- brief
- feedback_patch

---

## 7. 生命周期主链

小说层的主链不是“直接吐正文”，而是逐层缩放。

### 7.1 从大到小的结构链

```text
作品构想
  -> 世界观与主线骨架
  -> 分卷 / 分弧
  -> 章节目标
  -> 场景计划
  -> 正文草稿
  -> 改稿
  -> 阅读投影
```

### 7.2 主链的意义

这个主链决定了：

- 长跑默认推进单元
- 维护 hook 的触发边界
- summary 的聚合层级
- UI 后续的结构面板层次

### 7.3 不是所有作品都必须层层完整

系统可以支持：

- 从简略 work seed 直接进入写章
- 从既有 brief 直接生成 scene

但底层结构位置仍然要存在，不然无法长期维护。

---

## 8. 全生命周期阶段

小说创作至少可分为 5 个阶段。

### 8.1 建立期

目标：

- 立项
- 明确题材、主线、风格方向
- 形成最小世界观与角色骨架

主对象：

- work
- worldbuilding
- main_outline
- style_sample / preferences

### 8.2 规划期

目标：

- 分卷
- 章节规划
- 场景拆解

主对象：

- volume / arc
- chapter
- scene

### 8.3 产出期

目标：

- 写正文
- 推动场景和章节完成
- 进行长跑生成与局部改稿

主对象：

- scene
- draft
- task
- artifact

### 8.4 维护期

目标：

- 总结章节
- 更新状态
- 登记伏笔
- 解决连续性问题

主对象：

- chapter_summary
- state_snapshot
- timeline_event
- foreshadowing

### 8.5 阅读与修订期

目标：

- 阅读投影
- 局部修订
- 回看结构

主对象：

- accepted drafts
- reading projection
- correction / revise intents

---

## 9. 小说层的核心运行表面

小说层最终通过四类运行表面与用户接触。

### 9.1 对话面

用户通过自然语言提出：

- 立项
- 推进
- 追问
- 修正
- 改稿

### 9.2 结构面

用户主动打开结构面板时，可以查看：

- 世界观
- 主线
- 卷树
- 章节树
- 场景树
- 人物
- 伏笔
- 时间线

### 9.3 长跑面

用户通过：

- 继续写
- 跑到 checkpoint
- 批量采纳

控制持续创作。

### 9.4 阅读面

用户进入阅读模式，消费的是被采纳后的阅读投影。

---

## 10. 小说层与 Foundation 的依赖

小说层依赖 Foundation，但只能通过开放接口依赖。

### 10.1 依赖的 Foundation 能力

至少包括：

- turn / task runtime
- behavior protocol
- capability / intent registry
- memory contract
- long-run contract
- consistency contract
- provider abstraction
- observability / audit
- security / budget
- UX contract

### 10.2 依赖方式

小说层通过以下方式接入：

- 注册 novel intents
- 注册 novel capabilities
- 注册 novel hooks
- 注册 novel validators
- 注册 domain retrieval / retention hints
- 注册 domain-specific cards 和 result payloads

### 10.3 不允许的依赖方式

不允许：

- 直接改写 Foundation phase
- 直接改写 authority 机制
- 直接改写 provider request/result
- 直接新增 UI 自创的运行状态

---

## 11. 小说层的基础对象分组

后续对象模型建议按 4 组组织，而不是杂糅成一张大全。

### 11.1 主结构对象

- work
- worldbuilding
- main_outline
- volume / arc
- chapter
- scene
- draft

### 11.2 资产对象

- character
- faction
- organization
- location
- relationship
- item
- ability

### 11.3 连续性对象

- state_snapshot
- timeline_event
- foreshadowing
- worldrule
- chapter_summary

### 11.4 风格对象

- style_sample
- writing_preferences
- brief
- feedback_patch

---

## 12. 小说层的基础行为面

Foundation 定义了行为协议，小说层定义在小说场景中这些行为通常出现在哪。

### 12.1 clarification

常见于：

- 立项信息不够
- 要写哪一章 / 哪个角色不明确
- 场景范围不清

### 12.2 confirmation

常见于：

- 启动长跑
- 大批量采纳
- 高预算写作

### 12.3 correction

常见于：

- 改设定
- 改方向
- 改上一章理解

### 12.4 cancellation

常见于：

- 停止当前长跑
- 放弃当前批量生成

### 12.5 rejection

常见于：

- 当前上下文不允许该动作
- authority / budget / consistency 不允许继续

---

## 13. 小说层的维护逻辑

小说层不是只负责“生成”，还负责“维护”。

### 13.1 维护不是附属功能

如果没有维护层，长篇会在：

- 状态漂移
- 伏笔遗失
- 规则冲突

上迅速失控。

### 13.2 维护的基本方向

至少包括：

- summarize chapter
- update state snapshot
- scan new foreshadowing
- detect foreshadow resolution
- record timeline events

### 13.3 维护应默认走 post-hook + adoption

维护不应要求作者每次显式发命令，但维护结果也不能静默写 production。

因此默认路径应为：

```text
execution complete
  -> maintenance hook
  -> pending artifacts
  -> adoption
```

---

## 14. 小说层的上下文需求

小说层对上下文的要求比普通业务更复杂。

### 14.1 最小原则

仍然遵循 Foundation 的最小必要上下文原则。

### 14.2 常见上下文来源

至少包括：

- active work summary
- outline summaries
- active chapter / scene
- continuity objects
- style objects
- recent accepted drafts
- checkpoint summaries

### 14.3 不允许的做法

不允许长期依赖：

- “把整本书所有内容都塞进 prompt”

小说层必须建立在 memory + retrieval + summary contract 上。

---

## 15. 小说层的结果类型

小说层最终会产生 4 类结果。

### 15.1 结构结果

例如：

- 角色设定
- 章节大纲
- 场景计划

### 15.2 文本结果

例如：

- 正文草稿
- 改稿结果
- 阅读投影

### 15.3 维护结果

例如：

- chapter summary
- state snapshot delta
- foreshadowing entries

### 15.4 运行结果

例如：

- task progress
- checkpoint summary
- adoption queue

后续 UI 设计必须把这 4 类结果映射到不同层次，而不能都挤成聊天泡泡。

---

## 16. 小说层的风险面

小说层相比通用 Agent，有几个额外高风险面。

### 16.1 长程漂移

写到几十章后：

- 世界规则变了
- 人物状态忘了
- 前面埋的伏笔丢了

### 16.2 风格漂移

没有 style layer 时：

- 越写越不像作者
- 节奏失真
- 口癖和禁忌失守

### 16.3 结构坍塌

没有 lifecycle 对象时：

- 卷、章、场景之间断裂

### 16.4 维护失效

没有 maintenance layer 时：

- 连续性对象跟不上正文推进

这也是为什么小说层必须完整存在，而不是只写几个 executor。

---

## 17. 后续 Domain 文档组织

小说层后续文档建议按以下顺序展开：

1. `21-novel-object-model.md`
2. `22-continuity-model.md`
3. `23-style-and-author-intent.md`
4. `24-novel-intent-catalog.md`
5. `25-maintenance-hooks.md`
6. `26-context-assembly-policy.md`
7. `27-reading-projection.md`
8. `28-authoring-lifecycle.md`

这个顺序是：

```text
对象 -> 连续性 -> 风格 -> 动作 -> 维护 -> 上下文 -> 阅读 -> 生命周期
```

先把对象和状态定住，再谈动作和 UI。

---

## 18. 本文冻结的硬骨

本文正式冻结以下 Domain 总纲硬骨：

1. Novel Domain Layer 是建立在 Foundation 上的小说业务特化层
2. 小说层至少负责：生命周期对象、连续性对象、风格对象、intent catalog、hooks、validators、上下文组装、阅读投影、生命周期流程
3. 小说层内部按三大维度理解：生命周期 / 时序连续性 / 风格与作者意志
4. 小说创作不是单步吐正文，而是从结构到文本到维护再到阅读投影的主链
5. 小说层必须显式建模，不能只靠 prompt
6. 小说层只能通过 Foundation 开放接口扩展，不能改写 Foundation 基础机制

---

## 19. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. 各对象字段全集
2. 各对象之间的最终外键策略
3. intent family 的最终全集
4. 阅读投影的最终产物结构

---

## 20. 下一步

接下来最自然的是：

1. `21-novel-object-model.md`

因为总纲已经把 Domain 的职责、三大维度和生命周期主链定下来了，下一步就该把对象模型真正展开。
