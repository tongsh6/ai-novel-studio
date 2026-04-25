# Continuity Model v2

> 状态：草案
>
> 角色：`docs/design-v2/21-novel-object-model.md` 的连续性子模型展开文档，并依赖 `docs/design-v2/05-memory-retention-and-retrieval.md`、`docs/design-v2/06-planning-and-long-run.md`、`docs/design-v2/07-consistency-and-concurrency.md`。
>
> 目标：定义 v2 小说层的连续性模型，明确 `state_snapshot`、`timeline_event`、`foreshadowing`、`worldrule`、`chapter_summary` 的职责、关系、锚点、生命周期与运行时用途。

---

## 1. 文档定位

本文回答 8 个问题：

1. 小说层为什么必须有独立连续性模型
2. 连续性对象各自负责什么，不负责什么
3. 权威状态如何表达
4. 时间线、伏笔、规则、章节摘要如何协同
5. 这些对象如何与 memory、long-run、adoption 连接
6. 连续性对象应该锚定到哪些结构节点
7. 连续性对象如何进入维护与冲突检测
8. 哪些连续性对象能进入阅读与 UI，哪些只服务内核

本文不负责：

- 人物档案字段全集
- 风格偏好字段全集
- 具体 intent 参数表

本文只冻结连续性模型。

---

## 2. 为什么连续性必须独立建模

长篇小说的失败通常不是“写不出句子”，而是“写着写着不是同一本书了”。

最常见的问题：

- 人物状态前后矛盾
- 时间线错乱
- 设定规则被遗忘
- 伏笔埋了不记得
- 上一章已经解决的问题下一章又当没解决

如果这些只散落在：

- 对话历史
- 一堆正文片段
- 零散备注

系统无法稳定维护。

因此连续性必须成为独立对象层，而不是 prompt 中的一段“记得别写错”。

---

## 3. 连续性模型的职责

连续性模型至少负责：

1. 表达某一时点或某一锚点的有效状态
2. 表达时间线上发生的关键事件
3. 表达伏笔从埋下到回收的生命周期
4. 表达作品必须遵守的硬规则
5. 表达章节级压缩摘要，供回忆、检索和续跑使用

它不负责：

1. 人物档案的全部静态描述
2. 风格偏好
3. UI 阅读投影本身
4. provider prompt 细节

---

## 4. 连续性对象总览

小说层的连续性对象包括：

1. `state_snapshot`
2. `timeline_event`
3. `foreshadowing`
4. `worldrule`
5. `chapter_summary`

### 4.1 它们的关系

可以粗略理解为：

- `worldrule`：这本书不能违背什么
- `timeline_event`：这本书发生了什么
- `state_snapshot`：到某一锚点为止，现在是什么状态
- `foreshadowing`：这本书埋了哪些账、还了哪些账
- `chapter_summary`：这一章到底说了什么，供之后快速调用

---

## 5. 连续性对象的共同特征

这些对象通常共享以下特征：

- 有 `work_ref`
- 有 `anchor_type` / `anchor_ref`
- 强 revision 敏感
- 多数需要 adoption
- 多数来源于 maintenance hook 或修订动作

### 5.1 最小共同字段

建议至少包括：

- `id`
- `object_type`
- `work_ref`
- `anchor_type`
- `anchor_ref`
- `status`
- `created_at`
- `updated_at`
- `source_ref`
- `revision_base`

### 5.2 `source_ref`

用于表示该连续性对象来源于：

- 某章
- 某场景
- 某次长跑 checkpoint
- 某次 correction

---

## 6. state_snapshot

`state_snapshot` 是连续性模型的核心对象。

### 6.1 定义

它表达：

**“到某个锚点为止，某个 scope 当前被系统认定为有效的重要状态切面。”**

### 6.2 scope

常见 scope 至少包括：

- character
- faction
- location
- item
- relationship
- work-global state

### 6.3 snapshot 不是人物档案

人物档案回答：

- 这个人是谁
- 长期设定是什么

snapshot 回答：

- 到第 X 章 / 第 Y 场，这个人现在在哪、伤势如何、知道什么、和谁什么关系

### 6.4 snapshot 不是完整全量复制

snapshot 应优先表达重要且运行时相关的状态切面，而不是把整个对象全文拷贝一遍。

### 6.5 snapshot 的典型内容方向

至少包括：

- location state
- possession / ability state
- revealed / hidden information state
- relationship state
- injury / progress / rank state

### 6.6 snapshot 的锚点

至少应支持：

- chapter
- scene
- volume

默认常用锚点是：

- chapter
- scene

---

## 7. timeline_event

`timeline_event` 用于表达时间线上的关键事件。

### 7.1 定义

它表达：

**“在叙事时间线上发生了一件什么关键事情，并影响了哪些对象或状态。”**

### 7.2 event 不是摘要

event 强调：

- 发生了什么
- 发生在什么时候 / 哪个锚点
- 影响了谁

它不是整章压缩文字。

### 7.3 event 不是 snapshot

- event：变化发生了什么
- snapshot：变化后当前状态是什么

### 7.4 timeline_event 的典型内容方向

至少包括：

- event type
- narrative order ref
- in-world time hint
- affected refs
- causal summary

### 7.5 narrative time 与 world time

时间线至少要允许区分：

- narrative order（读者读到的顺序）
- in-world time（故事内发生时间）

不要求一开始就全精确建模，但必须保留位置。

---

## 8. foreshadowing

`foreshadowing` 是独立的伏笔对象。

### 8.1 定义

它表达：

**“这本书埋下了一个待回收的信息、悬念、关系、规则或承诺。”**

### 8.2 foreshadowing 不是普通备注

备注无法表达：

- 是否已回收
- 回收到了哪一步
- 关联了哪些章节
- 是硬伏笔还是软气氛暗示

### 8.3 foreshadowing 的生命周期

至少应支持：

- `PLANTED`
- `ACTIVE`
- `PARTIALLY_RESOLVED`
- `RESOLVED`
- `INVALIDATED`
- `SUPERSEDED`

### 8.4 planted 与 resolved 的意义

- `PLANTED`：首次明确埋下
- `ACTIVE`：仍在有效等待回收
- `PARTIALLY_RESOLVED`：部分兑现，但还没完全结算
- `RESOLVED`：已完成回收

### 8.5 伏笔类型

至少应允许：

- information foreshadowing
- emotional foreshadowing
- plot foreshadowing
- rule foreshadowing

Foundation 不冻结最终枚举，但 Domain 必须能表达类型。

---

## 9. worldrule

`worldrule` 用于表达必须受约束的硬规则。

### 9.1 定义

它表达：

**“在这个作品中，被系统当作一致性硬边界的规则。”**

### 9.2 worldrule 不是世界观全文

worldbuilding 可以很大、很散。  
worldrule 只抽取其中必须被运行时一致性检查依赖的硬规则。

### 9.3 worldrule 的典型方向

至少包括：

- magic / ability constraints
- political / institutional constraints
- information boundary rules
- hard physical or metaphysical rules

### 9.4 worldrule 的运行时意义

worldrule 会直接参与：

- consistency checks
- long-run checkpoint triggers
- correction / branch suggestions

### 9.5 worldrule 的状态

至少支持：

- `ACTIVE`
- `SUPERSEDED`
- `ARCHIVED`

worldrule 一旦 superseded，不代表旧版本没有历史意义，因此不能无痕覆盖。

---

## 10. chapter_summary

`chapter_summary` 是连续性模型与 memory 模型之间的重要桥梁。

### 10.1 定义

它表达：

**“对某一章内容的高信息密度压缩总结，用于后续检索、连续性维护和长跑续接。”**

### 10.2 chapter_summary 不是 chapter 字段偷懒

如果把摘要只做成 `chapter.summary` 字段：

- 无法表达版本
- 无法表达来源
- 无法表达 adoption
- 无法表达 fidelity level

因此应视为独立对象或独立 summary record。

### 10.3 chapter_summary 的用途

至少包括：

- warm memory retrieval
- long-run checkpoint resume
- current state summarization
- reading-side快速回顾

### 10.4 chapter_summary 与 timeline / snapshot 的关系

- chapter_summary：这一章大致讲了什么
- timeline_event：这一章里有哪些关键事件应进入时间线
- state_snapshot：这一章之后系统认定的重要状态是什么

### 10.5 与 reader_recap 的边界（ADR-0009）

`chapter_summary` 与 `reader_recap`（`27-reading-projection.md` §10）不是同一个对象，二者字段集合由 ADR-0009 §4 显式分离：

- `chapter_summary` 字段（`fidelity_level` / `revision_base` 等）不得被 inline 到 `reader_recap`。
- `reader_recap` 可以把 `chapter_summary` 作为来源之一，但 `recap_text` 不得直接复制 `chapter_summary` 原文。
- adoption 状态各自独立：`chapter_summary` 使用 §13.5 的 7 态；`reader_recap` 不参与维护链路，刷新由 ADR-0011 状态机管理。

---

## 11. 连续性对象之间的关系

### 11.1 event -> snapshot

关键事件发生后，通常会驱动 snapshot 更新。

### 11.2 chapter_summary -> event / snapshot / foreshadowing

章节摘要常是后续 maintenance 的分析入口。

### 11.3 worldrule -> consistency guard

规则对象并不主要用于文本展示，而主要用于 guard 与 correction。

### 11.4 foreshadowing -> chapter_summary / timeline_event

伏笔对象通常会引用：

- 首次埋下的章节或场景
- 后续推进或回收的章节或场景

---

## 12. 锚点规则

连续性对象必须明确锚点。

### 12.1 默认锚点

至少支持：

- volume
- chapter
- scene

### 12.2 默认推荐

- `chapter_summary` -> chapter
- `state_snapshot` -> chapter / scene
- `timeline_event` -> chapter / scene
- `foreshadowing` -> planted_at chapter/scene，另可有 resolved_at refs
- `worldrule` -> work 或 worldbuilding 范围

### 12.3 多锚点关系

有些对象不止一个时间位置。

例如 foreshadowing 至少天然包含：

- planted anchor
- active references
- resolved anchor（可空）

因此模型必须允许对象持有主锚点之外的 related refs。

---

## 13. 生命周期与状态边界

连续性对象必须有明确状态。

### 13.1 state_snapshot

建议至少支持：

- `ACTIVE`
- `SUPERSEDED`
- `INVALIDATED`
- `ARCHIVED`

### 13.2 timeline_event

建议至少支持：

- `ACTIVE`
- `CORRECTED`
- `ARCHIVED`

### 13.3 foreshadowing

建议至少支持：

- `PLANTED`
- `ACTIVE`
- `PARTIALLY_RESOLVED`
- `RESOLVED`
- `INVALIDATED`
- `SUPERSEDED`

### 13.4 worldrule

建议至少支持：

- `ACTIVE`
- `SUPERSEDED`
- `ARCHIVED`

### 13.5 chapter_summary

`chapter_summary` 是 adoption 7 态对象，状态集合必须严格使用 `30-contract-glossary.md §3.2` + ADR-0001 的 canonical 7 态：

- `TENTATIVE`
- `ACCEPTED`
- `EDITED_ACCEPTED`
- `DISCARDED`
- `SUPERSEDED`
- `INVALIDATED`
- `ARCHIVED`

> 取值集合不得改写或删减；`02 §lines 523-533` 已固化合法转换；`06 §11.3` 与 ADR-0007 §2 表对齐使用同一 7 态。

---

## 14. adoption 与维护关系

连续性对象大多数是维护结果，不应默认静默写入权威层。

### 14.1 默认流程

建议默认路径：

```text
正文/场景执行完成
  -> maintenance hook 产出连续性草稿
  -> pending artifacts
  -> adoption
  -> authoritative continuity objects
```

### 14.2 默认 adoption 敏感对象

至少包括：

- chapter_summary
- state_snapshot updates
- foreshadowing scan result
- timeline_event extraction

### 14.3 worldrule 的 adoption

worldrule 变更通常更高风险，默认应比普通维护对象更严格。

---

## 15. 连续性对象与 authoritative state

### 15.1 authoritative continuity layer

当连续性对象被采纳后，它们进入 authoritative continuity layer。

这个 layer 直接服务于：

- retrieval
- consistency checks
- long-run continuation

### 15.2 tentative continuity layer

当维护 hook 先草拟时，这些对象应位于 tentative continuity layer。

### 15.3 authoritative 优先

即使某个新的连续性草稿看起来更合理，没被采纳前也不能覆盖 authoritative continuity state。

---

## 16. 与 Memory 的关系

连续性对象是 Memory 的关键输入。

### 16.1 warm tier 主来源

至少包括：

- chapter_summary
- active worldrules
- active foreshadowings
- latest snapshots

### 16.2 retrieval 优先级

对于继续写作、总结状态、长跑 resume 来说，连续性对象通常比原始对话历史更重要。

### 16.3 replay 边界

连续性对象是结果层，不替代 replay。  
回放时仍需要 trace / logs / archived refs。

---

## 17. 与 Long-Run 的关系

long-run 直接依赖连续性对象。

### 17.1 启动时读取

至少读取：

- relevant chapter summaries
- latest state snapshots
- active worldrules
- active foreshadowings

### 17.2 checkpoint 时生成

checkpoint 常会触发：

- provisional chapter_summary
- provisional state changes
- provisional foreshadowing updates

### 17.3 resume 时依赖

resume 不应依赖全量旧正文，而应优先依赖：

- accepted chapter summaries
- current authoritative snapshots
- unresolved foreshadowings

---

## 18. 与 Consistency 的关系

连续性对象是 consistency guard 的主要业务输入。

### 18.1 state_snapshot

用于判断：

- 当前状态是否矛盾

### 18.2 worldrule

用于判断：

- 是否违反硬规则

### 18.3 foreshadowing

用于判断：

- 是否错误重复使用已解决伏笔
- 是否遗漏关键回收约束

### 18.4 chapter_summary

用于快速回忆上文而不重读整章，但不能替代 revision 检查。

---

## 19. 与 UI 的关系

连续性对象大多不直接成为主工作台主内容，但它们决定了结构面和很多卡片内容。

### 19.1 结构面板

主要消费：

- active worldrules
- active foreshadowings
- timeline events
- state snapshots

### 19.2 工作台卡片

可能直接消费：

- pending adoption 的 continuity artifacts
- checkpoint 中的 continuity deltas
- warning / conflict summary

### 19.3 阅读模式

阅读模式通常不直接展示连续性对象，但可以使用 chapter summary 做导航或回顾增强。

---

## 20. 连续性对象与主结构对象的边界

### 20.1 chapter 不等于 chapter_summary

- chapter：结构节点
- chapter_summary：维护与 memory 对象

`chapter_summary` 与 `reader_recap` 也不是同一个对象，字段边界由 ADR-0009 §4 显式分离（详见 §10.5）。

### 20.2 character 不等于 state_snapshot

- character：长期档案
- state_snapshot：某时点切面

### 20.3 worldbuilding 不等于 worldrule

- worldbuilding：广义设定组织
- worldrule：被系统当作硬规则的提炼层

### 20.4 draft 不等于 timeline_event

- draft：原始文本内容
- timeline_event：从文本提炼出的叙事时间线事件

---

## 21. correction、supersede、invalidate

连续性对象必须允许被修正，而不是只能新增。

### 21.1 correction

当用户或系统发现连续性对象表述不准时，应通过 correction 生成新的对象或 superseding 关系。

### 21.2 supersede

用于表达：

- 新版本替代旧版本
- 旧版本仍保留历史意义

### 21.3 invalidate

用于表达：

- 旧对象建立在错误前提上
- 不能再参与当前运行

例如：

- 旧伏笔判断基于错误理解
- 旧 snapshot 基于被撤销剧情

---

## 22. 对象来源追踪

连续性对象必须可追溯来源。

### 22.1 典型来源

至少包括：

- chapter execution
- scene execution
- maintenance hook
- correction
- user explicit command

### 22.2 必须可回答的问题

至少包括：

- 这个连续性对象是从哪一章提炼出来的
- 是系统草拟还是用户确认
- 基于哪个 revision

---

## 23. 结果分层

连续性结果至少有三层：

1. raw source layer
2. tentative continuity layer
3. authoritative continuity layer

### 23.1 raw source layer

包括：

- draft text
- scene text
- chapter text

### 23.2 tentative continuity layer

包括：

- hook 草拟的 summary / snapshot / foreshadowing results

### 23.3 authoritative continuity layer

包括：

- 已采纳的 continuity objects

---

## 24. 后续文档依赖

本文之后，以下文档会依赖连续性模型：

- `24-novel-intent-catalog.md`
- `25-maintenance-hooks.md`
- `26-context-assembly-policy.md`
- `27-reading-projection.md`
- `28-authoring-lifecycle.md`

---

## 25. 本文冻结的硬骨

本文正式冻结以下连续性模型硬骨：

1. 连续性对象至少包括：`state_snapshot / timeline_event / foreshadowing / worldrule / chapter_summary`
2. `state_snapshot` 是时点状态切面，不是人物或资产主档案
3. `timeline_event` 表达关键事件，不是章节摘要
4. `foreshadowing` 是独立伏笔对象，不是备注
5. `worldrule` 是硬规则提炼层，不是 worldbuilding 全文
6. `chapter_summary` 是独立连续性 / memory 对象，不是 chapter 偷塞一个 summary 字段
7. 连续性对象默认通过 maintenance -> tentative -> adoption -> authoritative 流程进入系统
8. 连续性对象是 long-run、retrieval、consistency 的关键输入

---

## 26. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. timeline_event 的最终时间表达字段
2. foreshadowing type 的最终枚举
3. snapshot scope 的最终子类型全集
4. worldrule 的最终细分类

---

## 27. 下一步

连续性模型之后，最自然的是：

1. `23-style-and-author-intent.md`

因为现在“写的是不是同一本书”已经有了，下一步就该把“写得像不像这个作者、像不像这本书”这部分建模补上。

