# Novel Object Model v2

> 状态：草案
>
> 角色：`docs/design-v2/20-novel-domain-overview.md` 的对象模型展开文档，并依赖 `docs/design-v2/01-agent-foundation-contract.md`、`docs/design-v2/05-memory-retention-and-retrieval.md`、`docs/design-v2/07-consistency-and-concurrency.md`。
>
> 目标：定义 v2 小说层的对象体系，包括主结构对象、资产对象、连续性对象、风格对象的分组方式、身份规则、归属关系、引用规则、锚点规则和生命周期边界。

---

## 1. 文档定位

本文回答 8 个问题：

1. 小说层到底有哪些核心对象
2. 这些对象应如何分组
3. 对象 id、归属、父子关系如何表达
4. 对象之间应该用什么引用规则，而不是任意内嵌
5. 哪些对象是主结构，哪些是资产，哪些是派生物
6. 哪些对象会进入阅读投影，哪些只存在于工作台内核
7. 对象生命周期与状态边界如何定义
8. 哪些对象必须支持 revision、anchor、summary、adoption

本文不负责：

- 每个对象的完整字段全集
- 连续性对象的细节规则
- 风格对象的细节规则
- intent 的参数表

本文只冻结对象模型的骨架。

---

## 2. 设计目标

### 2.1 对象模型必须服务长篇连载

对象模型不是为了数据库好看，而是为了支撑：

- 长程记忆
- 连续性维护
- 长跑创作
- 阅读投影

### 2.2 对象模型必须分层

如果把：

- work
- chapter
- foreshadowing
- style_sample
- checkpoint
- reading projection

全塞进一层，会很快失去边界。

因此小说层对象必须分组、分维度。

### 2.3 主结构与派生物必须分开

例如：

- `draft` 是主创作对象
- `chapter_summary` 是维护对象
- `reading_projection_root / toc / chapter / reader_recap` 是投影对象族

它们不能混成“都是文本”。

### 2.4 对象关系必须稳定而克制

默认原则：

- 跨对象用 id 引用
- 深层嵌套尽量避免
- 派生信息不要写回源对象

---

## 3. 对象分组总览

小说层对象分为 4 组：

1. 主结构对象
2. 资产对象
3. 连续性对象
4. 风格对象

### 3.1 主结构对象

用于表达这本书的主创作骨架。

包括：

- `work`
- `worldbuilding`
- `main_outline`
- `volume`
- `arc`
- `chapter`
- `scene`
- `draft`

### 3.2 资产对象

用于表达跨层复用的世界和叙事资产。

包括：

- `character`
- `faction`
- `location`
- `relationship`
- `item`
- `ability`
- `organization`

### 3.3 连续性对象

用于表达时序演化和长期一致性。

包括：

- `state_snapshot`
- `timeline_event`
- `foreshadowing`
- `worldrule`
- `chapter_summary`

### 3.4 风格对象

用于表达作者意志和写作偏好。

包括：

- `style_sample`
- `writing_preferences`
- `brief`
- `feedback_patch`

---

## 4. 对象身份规则

所有小说层对象都必须具备稳定身份。

### 4.1 最小身份字段

至少包括：

- `id`
- `object_type`
- `work_ref`
- `status`
- `created_at`
- `updated_at`

### 4.2 `work_ref`

小说层对象默认归属于某个 `work`。

即便对象位于更细层级，也应可向上追溯到作品根对象。

### 4.3 `object_type`

必须显式存在，不能只靠表名或代码类型推断。

### 4.4 ID 规则

建议遵循 Foundation id 规范：

```text
<type>_<stable_unique_id>
```

例如：

- `work_xxx`
- `chapter_xxx`
- `foreshadow_xxx`

---

## 5. work 作为根对象

`work` 是小说层的根对象。

### 5.1 work 的职责

至少包括：

- 作品身份
- 当前活动上下文
- 作品级元信息
- domain root scope

### 5.2 work 不应承担的职责

不应把所有细节都塞进 `work`。

例如不应把：

- 所有人物完整档案
- 所有章节正文
- 所有连续性状态

都直接内嵌在 work 中。

### 5.3 作品级作用域

下列对象默认向 work 归属：

- all main structure objects
- all asset objects
- all continuity objects
- all style objects

---

## 6. 主结构链

主结构链决定了创作主路径。

### 6.1 推荐主链

```text
work
  -> worldbuilding
  -> main_outline
  -> volume / arc
  -> chapter
  -> scene
  -> draft
```

### 6.2 `worldbuilding`

表示作品级世界观主体，不等于所有设定碎片。

它更像：

- 世界观总览
- 设定组织容器

### 6.3 `main_outline`

表示整书级主线骨架，不等于卷级或章级细纲。

### 6.4 `volume` 与 `arc`

二者用于中观结构。

建议：

- `volume` 更偏出版 / 连载卷级组织
- `arc` 更偏剧情弧 / 副本弧

二者不要求每个项目都同时强依赖，但模型上都应留位置。

### 6.5 `chapter`

表示章级创作单元与章级结构节点。

### 6.6 `scene`

表示场景级创作单元。

场景是默认细粒度写作和长跑 checkpoint 的自然候选边界。

### 6.7 `draft`

表示正文稿件对象。

draft 是源文本对象，不等于最终阅读投影。

---

## 7. 资产对象

资产对象是跨层复用的叙事资产。

### 7.1 资产对象的特征

它们通常：

- 不从属于单章
- 可跨卷、跨章反复引用
- 既是结构引用对象，也是连续性依赖对象

### 7.2 `character`

人物对象是资产层核心对象。

它应承载：

- 相对稳定的人物档案
- 当前状态引用入口

但不直接承担全部时序演化；时序变化应更多通过连续性对象表达。

### 7.3 `faction` / `organization`

用于表达势力、组织、阵营。

### 7.4 `location`

用于表达地点和空间锚点。

### 7.5 `relationship`

用于表达人物或资产之间的重要关系。

### 7.6 `item` / `ability`

用于表达物件、能力、体系等高复用设定资产。

---

## 8. 连续性对象

连续性对象用于表达“这本书现在是什么状态”。

### 8.1 连续性对象的共同特征

它们通常：

- 带时间或阶段含义
- 带 anchor
- 带 revision 敏感性
- 多为维护产物或维护驱动对象

### 8.2 `state_snapshot`

表达某个锚点下的重要状态切面。

### 8.3 `timeline_event`

表达时间线上发生了什么。

### 8.4 `foreshadowing`

表达伏笔的埋下、延续、回收状态。

### 8.5 `worldrule`

表达必须受约束的硬规则。

### 8.6 `chapter_summary`

表达章级压缩摘要，属于连续性与 memory 的关键桥梁对象。

---

## 9. 风格对象

风格对象表达作者意志，而不是作品事实。

### 9.1 `style_sample`

保存风格样本或参考文本来源。

### 9.2 `writing_preferences`

保存长期稳定的风格偏好、禁忌、节奏偏好、口癖偏好。

### 9.3 `brief`

保存局部阶段的临时意图。

例如：

- 某卷 brief
- 某章 brief
- 某次长跑 brief

### 9.4 `feedback_patch`

保存在线反馈产生的增量修正。

它作用于当前阶段或局部范围，不等于长期 `writing_preferences`。

### 9.5 风格对象与连续性对象分离

风格对象决定“怎么写”，  
连续性对象决定“写的是不是同一本书”。

---

## 10. 对象归属关系

对象之间必须有明确归属。

### 10.1 work 级归属

默认直接归属于 work 的对象：

- worldbuilding
- main_outline
- all asset objects
- all style objects

### 10.2 volume / arc 级归属

归属于中观结构的对象：

- volume
- arc
- chapter

### 10.3 chapter 级归属

默认直接归属于 chapter 的对象：

- scene
- chapter-scoped briefs
- chapter summaries
- chapter drafts

### 10.4 scene 级归属

默认直接归属于 scene 的对象：

- scene drafts
- scene-specific maintenance outputs（如有）

### 10.5 连续性对象的归属

连续性对象不一定有单一父对象，但必须至少有：

- `work_ref`
- `anchor_type`
- `anchor_ref`

---

## 11. 引用规则

### 11.1 默认规则：跨对象用 id 引用

对象之间默认只持有对方 id 或 ref，而不是深层内嵌快照。

### 11.2 可以使用的 ref 类型

至少支持：

- `work_ref`
- `parent_ref`
- `owner_ref`
- `anchor_ref`
- `related_refs`

### 11.3 内嵌的限制

允许少量：

- summary
- denormalized preview
- cached labels

但这些必须被视为派生信息，而不是权威源。

### 11.4 不允许的默认做法

不建议：

- 在 chapter 里内嵌完整角色对象
- 在 character 里内嵌所有场景历史
- 在 worldbuilding 里内嵌所有规则和地点全文

---

## 12. anchor 规则

anchor 是小说层的重要建模手段。

### 12.1 anchor 的作用

回答：

**“这个对象是相对于哪一个结构节点成立的？”**

### 12.2 anchor 最小字段

至少包括：

- `anchor_type`
- `anchor_ref`

### 12.3 典型 anchor

至少支持：

- work
- volume
- arc
- chapter
- scene

### 12.4 哪些对象必须支持 anchor

至少包括：

- state_snapshot
- timeline_event
- foreshadowing
- chapter_summary
- brief

### 12.5 哪些对象通常不需要 anchor

通常不需要：

- work
- character 的主档案层
- writing_preferences

---

## 13. 生命周期状态边界

对象必须有基本状态，但 Domain 不应把所有状态复杂化。

### 13.1 推荐通用对象状态

至少支持抽象状态：

- `DRAFT`
- `ACTIVE`
- `ARCHIVED`
- `SUPERSEDED`

### 13.2 主结构对象

主结构对象一般经历：

- 创建
- 活跃编辑
- 被替换或归档

### 13.3 连续性对象

连续性对象更常见：

- active
- resolved
- invalidated
- archived

### 13.4 风格对象

风格对象更常见：

- active
- superseded
- archived

---

## 14. revision 敏感对象

不是所有对象都必须同等 revision 敏感。

### 14.1 高 revision 敏感对象

至少包括：

- draft
- chapter
- scene
- state_snapshot
- foreshadowing
- worldrule
- brief

### 14.2 中等 revision 敏感对象

至少包括：

- main_outline
- volume
- character
- relationship

### 14.3 低 revision 敏感对象

至少包括：

- style_sample 原始样本记录
- archived summaries

说明：

低敏感不代表无 revision，只是冲突处理频率较低。

---

## 15. adoption 敏感对象

不是所有对象都要走 adoption。

### 15.1 默认应 adoption 的对象

至少包括：

- draft
- chapter_summary
- state_snapshot updates
- foreshadowing entries
- reading projection refresh artifacts

### 15.2 可直接成为权威记录的对象

视 policy 而定，但某些低风险维护产物可在特定条件下自动进入权威层。

### 15.3 adoption 规则必须对象化感知

对象模型至少要让系统知道某个对象：

- 是否需要 adoption
- 是否来自 tentative artifact

---

## 16. 阅读投影边界

对象模型必须服务阅读模式，但不能把阅读投影当成创作源对象。

阅读投影在对象模型中表现为对象族，而不是单个对象：

- `reading_projection_root`
- `reading_projection_toc`
- `reading_projection_chapter`
- `reader_recap`

### 16.1 可进入阅读投影的核心源

至少包括：

- accepted drafts
- accepted chapter ordering
- accepted volume ordering

### 16.2 不应直接进入阅读投影的对象

至少包括：

- tentative drafts
- raw checkpoint summaries
- style preferences
- unresolved foreshadow maintenance records

### 16.3 阅读投影是派生层

阅读投影应被视为：

- accepted 源对象的投影

而不是新的创作源权威。

---

## 17. memory 与 summary 关系

对象模型必须允许 summary 成为一等派生对象。

### 17.1 哪些对象常需要 summary

至少包括：

- work
- main_outline
- volume
- chapter
- draft
- long-run checkpoints

### 17.2 summary 的位置

summary 不是把全文覆盖掉，而是：

- 作为独立对象
- 或作为独立 summary record

### 17.3 不应混淆

`chapter_summary` 是连续性对象，  
不是对 `chapter` 主对象的字段偷懒塞一个摘要就完了。

---

## 18. 对象与 maintenance 的关系

很多对象并不是用户手工创建的，而是维护流程产出。

### 18.1 典型 maintenance 产物

至少包括：

- chapter_summary
- state_snapshot
- timeline_event
- foreshadowing scan result

### 18.2 maintenance 产物的特点

它们：

- 通常由 hook 自动草拟
- 默认先进入 pending / tentative 路径
- 之后通过 adoption 进入权威层

### 18.3 因此对象模型必须支持来源追踪

至少要能回答：

- 这个对象是谁产生的
- 是用户直接创建，还是 hook 草拟
- 基于哪个源对象和哪个 turn / task

---

## 19. 对象与 long-run 的关系

long-run 本质上就是围绕这些对象推进。

### 19.1 long-run 主要读哪些对象

至少包括：

- work
- outline / volume / chapter / scene
- active assets
- active continuity objects
- active style objects

### 19.2 long-run 主要写哪些对象

至少包括：

- draft artifacts
- maintenance artifacts
- checkpoint summaries

### 19.3 对象模型必须适配长跑

例如：

- scene 作为自然 unit
- brief 可绑定到 chapter / scene / task
- continuity 对象可在 checkpoint 后维护

---

## 20. 与 Foundation 的接口

对象模型必须通过 Foundation 机制接入。

### 20.1 依赖的 Foundation 机制

至少包括：

- identity rules
- authority / budget
- memory tiering
- consistency / revision
- adoption
- audit

### 20.2 对象模型不能改写的 Foundation 规则

包括：

- authoritative state 与 tentative 的边界
- revision / base revision 原则
- adoption / mutation 的可追溯性
- task / turn 的基础状态机

---

## 21. 与 UI 的接口

对象模型不直接决定 UI 布局，但决定 UI 能看见哪些结构面。

### 21.1 结构面板主要消费的对象

至少包括：

- worldbuilding
- main_outline
- volume / arc
- chapter
- scene
- character
- foreshadowing
- timeline_event
- worldrule
- style objects

### 21.2 阅读模式主要消费的对象

至少包括：

- accepted drafts
- accepted chapter / volume ordering

### 21.3 主工作台主要消费的对象

主要通过：

- result cards
- adoption cards
- progress cards

间接消费对象，而不是总是直接浏览对象表。

---

## 22. 对象模型与数据库实现的边界

本文定义的是领域对象模型，不是最终表结构。

### 22.1 允许的实现差异

未来实现中可以：

- 一个对象一张表
- 多对象共享一类表
- 某些对象先用文档化 JSON 存储

### 22.2 不允许破坏的语义

无论如何实现，都不能破坏：

- 对象分组
- work 根归属
- anchor 语义
- adoption 边界
- revision 归属
- 阅读投影边界

---

## 23. 后续文档依赖

后续文档将基于本文展开：

- `22-continuity-model.md`
- `23-style-and-author-intent.md`
- `24-novel-intent-catalog.md`
- `25-maintenance-hooks.md`
- `26-context-assembly-policy.md`
- `27-reading-projection.md`
- `28-authoring-lifecycle.md`

如果后续文档和本文冲突，应回到本文修订，而不是各写各的。

---

## 24. 本文冻结的硬骨

本文正式冻结以下对象模型硬骨：

1. 小说层对象分为 4 组：主结构 / 资产 / 连续性 / 风格
2. `work` 是小说层根对象
3. 主结构链默认是 `work -> worldbuilding -> main_outline -> volume/arc -> chapter -> scene -> draft`
4. 对象默认通过 ref 建立关系，而不是深层内嵌
5. 连续性对象和风格对象与主结构对象分离
6. anchor 是连续性与局部风格对象的重要机制
7. 阅读投影只消费被采纳的权威创作源，不直接消费 tentative
8. 对象模型服务领域语义，不等于最终数据库表结构

---

## 25. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. 每个对象的最终字段全集
2. volume 与 arc 的最终实现关系
3. relationship / item / ability 的最终精度
4. summary 对象是单独表还是统一 summary 机制

---

## 26. 下一步

对象模型之后，最自然的是：

1. `22-continuity-model.md`

因为现在主结构、资产、风格、连续性对象的分组已经定了，下一步就该把连续性对象的细节和它们之间的关系真正展开。
