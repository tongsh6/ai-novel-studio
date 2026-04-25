# Novel Intent Catalog v2

> 状态：草案
>
> 角色：`docs/design-v2/20-novel-domain-overview.md` 的小说动作目录文档，并依赖 `docs/design-v2/04-capability-and-intent-registry.md`、`docs/design-v2/21-novel-object-model.md`、`docs/design-v2/22-continuity-model.md`、`docs/design-v2/23-style-and-author-intent.md`。
>
> 目标：定义 v2 小说层的 intent 家族、动作边界、主要读写对象、典型输入输出、常见行为触发、是否适合 long-run、是否会产生 adoption 敏感产物。

---

## 1. 文档定位

本文回答 8 个问题：

1. 小说层到底有哪些核心 intent family
2. 每类 intent 负责什么，不负责什么
3. 它们主要读取哪些对象、写入哪些对象
4. 哪些 intent 更容易触发 clarification / confirmation / correction
5. 哪些 intent 适合单轮完成，哪些适合 long-run
6. 哪些 intent 的产物默认进入 adoption 路径
7. 哪些 intent 更偏结构，哪些更偏文本，哪些更偏维护
8. 后续 capability registry 和 context assembly 应如何依赖这份目录

本文不负责：

- 每个 intent 的完整 slot schema
- 每个 intent 对应的最终 capability 映射细节
- prompt 级别实现

本文是小说层 intent 总目录。

---

## 2. 设计目标

### 2.1 intent catalog 必须覆盖全生命周期

小说系统不能只定义“写正文”。

它至少要覆盖：

- 立项
- 世界观
- 主线
- 分卷
- 章节
- 场景
- 正文
- 改稿
- 维护
- 阅读

### 2.2 intent catalog 必须与对象模型对齐

intent 不是凭空存在的。

每个 intent 至少要能回答：

- 读哪些对象
- 改哪些对象
- 产出什么类型结果

### 2.3 intent catalog 必须与行为和 long-run 对齐

不同 intent 的默认运行方式不同：

- 有的更适合单轮直接出结果
- 有的更适合 clarification
- 有的天然适合 long-run

### 2.4 intent catalog 先定边界，后定参数

本文先冻结目录和职责边界，再在后续具体 slot 表里细化参数要求。

---

## 3. 总览：intent family

小说层 intent family 至少包括：

1. 立项族
2. 世界观族
3. 主线族
4. 分卷族
5. 章节族
6. 场景族
7. 正文族
8. 改稿族
9. 人物族
10. 风格族
11. 长跑族
12. 维护族
13. 阅读族

### 3.1 大致分类

- 偏结构：
  - 立项 / 世界观 / 主线 / 分卷 / 章节 / 场景 / 人物 / 风格

- 偏文本：
  - 正文 / 改稿

- 偏运行控制：
  - 长跑

- 偏维护：
  - 维护

- 偏消费：
  - 阅读

### 3.2 首批 UI intent 集合（ADR-0008）

13 family 中被选为**首批 UI 必须暴露**的 intent 共 20 条，覆盖立项 / 规划 / 产出 / 维护 / 阅读与修订五阶段，由 ADR-0008（`adr/0008-first-batch-intents.md`）冻结。每个 family 内被选中条目的 namespace、family、lifecycle stage、`risk_class`、`default_requires_confirmation`、`long_run_fit` 默认值见 ADR-0008 §3。本目录文档保留全部 13 family 与各 family 的"代表性 intent"作为完整 catalog；扩展批次 intent 的最小 slot schema 由 ADR-0010 配合冻结。

---

## 4. Intent 目录组织原则

### 4.1 family 优先

后续 registry 和 UI 应优先按 family 组织，而不是平铺几十个 intent。

### 4.2 动词开头

具体 intent 建议保持动词开头，例如：

- create
- define
- refine
- split
- generate
- draft
- revise
- continue
- enter
- summarize
- update
- scan

### 4.3 单个 intent 的边界要窄

例如：

- “生成章节大纲” 与 “写章节正文” 不应混成一个万能 intent
- “扫描新伏笔” 与 “确认伏笔回收” 不应混成一个维护黑箱

---

## 5. 立项族

### 5.1 作用

用于从无到有建立作品根对象和最小创作方向。

### 5.2 代表性 intent

- `CREATE_WORK_SEED`
- `REFINE_WORK_POSITIONING`
- `SUMMARIZE_CURRENT_STATE`

运行时注册时使用 `intent.` namespace，例如 `intent.CREATE_WORK_SEED`。

### 5.3 主要读取对象

- 无或少量 work context
- 可能读取 style / preference seeds

### 5.4 主要写入对象

- work
- 初始 worldbuilding / outline seeds（按 policy）

### 5.5 典型行为

- clarification：题材、核心卖点、目标不清
- confirmation：通常较少

### 5.6 long-run 适配

通常不适合 long-run。

### 5.7 adoption 敏感性

中等。  
立项类结果可能直接形成作品根信息，但仍应可修正。

---

## 6. 世界观族

### 6.1 作用

用于定义或修订世界观主体、设定骨架和硬规则提炼来源。

### 6.2 代表性 intent

- `DEFINE_WORLDBUILDING`
- `REFINE_WORLDBUILDING`
- `REFINE_WORLDRULE`
- `ADD_FACTION`
- `ADD_LOCATION`
- `ADD_SYSTEM_ASSET`

### 6.3 主要读取对象

- work
- worldbuilding
- assets
- active worldrules

### 6.4 主要写入对象

- worldbuilding
- faction / location / organization / item / ability
- worldrule（经维护 / adoption）

### 6.5 典型行为

- clarification：规则范围不清、目标对象不清
- correction：旧设定需要重写
- confirmation：影响范围大时需要

### 6.6 long-run 适配

通常不适合长跑批量自动扩写，除非是低风险批量补全。

### 6.7 adoption 敏感性

高。  
因为会影响后续整个作品的一致性。

---

## 7. 主线族

### 7.1 作用

用于建立和修订整书主线骨架。

### 7.2 代表性 intent

- `CREATE_MAIN_OUTLINE`
- `REVISE_MAIN_OUTLINE`
- `DEFINE_CORE_CONFLICT`
- `DEFINE_STORY_ENGINE`

### 7.3 主要读取对象

- work
- worldbuilding
- assets
- style preferences

### 7.4 主要写入对象

- main_outline

### 7.5 典型行为

- clarification：主线目标、题材定位不清
- correction：方向大修
- confirmation：已有大量下游结构时需提醒影响面

### 7.6 long-run 适配

通常不适合。

### 7.7 adoption 敏感性

高。  
主线骨架变动会牵动 volume / chapter / scene。

---

## 8. 分卷族

### 8.1 作用

用于把主线拆成中观结构。

### 8.2 代表性 intent

- `SPLIT_INTO_VOLUMES`
- `CREATE_VOLUME`
- `REVISE_VOLUME`
- `GENERATE_VOLUME_OUTLINE`

### 8.3 主要读取对象

- main_outline
- worldbuilding
- active assets

### 8.4 主要写入对象

> ADR-0004 已冻结 `volume -> arc`：分卷族可写 volume 与其下 arc，不能创建跨 volume 的单一 arc。

- volume
- arc

### 8.5 典型行为

- clarification：拆分粒度不清
- correction：已有卷结构需要重排

### 8.6 long-run 适配

可支持轻度 long-run，例如批量生成分卷草纲，但默认仍应 checkpoint 频繁。

### 8.7 adoption 敏感性

中高。  
因为下游 chapter 依赖它。

---

## 9. 章节族

### 9.1 作用

用于章级结构规划与章级指令设置。

### 9.2 代表性 intent

- `GENERATE_CHAPTER_OUTLINE`
- `REVISE_CHAPTER_OUTLINE`
- `SET_CHAPTER_BRIEF`
- `SELECT_NEXT_CHAPTER_TARGET`

### 9.3 主要读取对象

> ADR-0004 已冻结 chapter-family 至少读取所属 `volume`，若已有 `arc_id` 则必须读取对应 `arc`。

- volume / arc
- main_outline
- continuity objects
- style objects

### 9.4 主要写入对象

- chapter
- chapter-level brief

### 9.5 典型行为

- clarification：写哪一章、目标章节不清
- correction：已有章纲需改方向

### 9.6 long-run 适配

适中。  
可批量生成 backlog 章节骨架，但不应无限制一口气跑很长。

### 9.7 adoption 敏感性

中。  
章纲属于结构对象，通常需明确采纳。

---

## 10. 场景族

### 10.1 作用

用于场景级拆解和场景级文本任务。

### 10.2 代表性 intent

- `GENERATE_SCENE_OUTLINE`
- `REVISE_SCENE_OUTLINE`
- `DRAFT_SCENE`
- `REVISE_SCENE`

### 10.3 主要读取对象

- chapter
- active brief
- continuity objects
- style objects

### 10.4 主要写入对象

- scene
- scene drafts

### 10.5 典型行为

- clarification：场景目标或边界不清
- confirmation：大批量场景生成时

### 10.6 long-run 适配

高。  
scene 是 long-run 默认自然单元之一。

### 10.7 adoption 敏感性

高。  
场景正文和场景结构结果通常都会进入 adoption 敏感路径。

---

## 11. 正文族

### 11.1 作用

用于直接产出正文文本。

### 11.2 代表性 intent

- `DRAFT_CHAPTER`
- `CONTINUE_DRAFT_WITHIN_CHAPTER`

### 11.3 主要读取对象

- chapter / scene
- active continuity layer
- active style layer
- recent accepted drafts

### 11.4 主要写入对象

- draft artifacts

### 11.5 典型行为

- clarification：目标章 / 场不清
- confirmation：高预算或长跑启动时
- correction：已有产出方向需要修正

### 11.6 long-run 适配

很高。  
正文是 long-run 的主战场。

### 11.7 adoption 敏感性

非常高。  
正文默认应先进入 tentative，再走 adoption。

---

## 12. 改稿族

### 12.1 作用

用于对现有草稿进行修订、润色、重构。

### 12.2 代表性 intent

- `REVISE_DRAFT`
- `REWRITE_SECTION`
- `TIGHTEN_PACING`
- `ADJUST_VOICE`

### 12.3 主要读取对象

- draft
- style layer
- continuity layer
- feedback patches

### 12.4 主要写入对象

- new draft artifacts
- revise proposals

### 12.5 典型行为

- clarification：改什么、按什么方向改不清
- correction：当前版本理解错了

### 12.6 long-run 适配

适中。  
局部改稿适合单轮；大规模通改可进入 long-run，但需高频 checkpoint。

### 12.7 adoption 敏感性

高。  
改稿默认不应直接覆盖 accepted 正文。

---

## 13. 人物族

### 13.1 作用

用于建立、筛选和修订人物资产。

### 13.2 代表性 intent

- `CREATE_CHARACTER_CANDIDATES`
- `REFINE_EXISTING_CHARACTER`
- `DEFINE_CHARACTER_ARC`
- `UPDATE_CHARACTER_ROLE`

### 13.3 主要读取对象

- work
- worldbuilding
- main_outline
- existing assets

### 13.4 主要写入对象

- character
- relationship

### 13.5 典型行为

- clarification：目标角色、细化方向不清
- correction：已有人物设定要修

### 13.6 long-run 适配

通常不适合长跑主路径。

### 13.7 adoption 敏感性

中高。  
人物资产一旦变化，会反向影响 continuity。

### 13.8 首批 UI 暴露范围

人物族**未进入首批 UI intent 集合**，由 ADR-0008 §3.1 末段显式说明：人物资产需依赖世界观与主线先行建立后才具备充分上下文，首批建立期优先锚定立项 / 世界观 / 主线 / 风格四骨架。本族 4 条代表性 intent 留待扩展批次 ADR 增补。

---

## 14. 风格族

### 14.1 作用

用于导入样本、设定长期偏好和局部 brief。

### 14.2 代表性 intent

- `LOAD_STYLE_SAMPLE`
- `SET_WRITING_PREFERENCE`
- `SET_BRIEF`
- `APPLY_FEEDBACK_PATCH`

### 14.3 主要读取对象

- style layer
- accepted drafts（可作为样本来源）

### 14.4 主要写入对象

- style_sample
- writing_preferences
- brief
- feedback_patch

### 14.5 典型行为

- clarification：偏好范围不清
- confirmation：修改长期偏好影响大时

### 14.6 long-run 适配

不是主要 long-run 族，但会强影响所有 long-run。

### 14.7 adoption 敏感性

中高。  
长期偏好变更通常应视为 adoption-sensitive。

---

## 15. 长跑族

### 15.1 作用

用于控制连续创作任务，而不是直接产生业务内容本身。

### 15.2 代表性 intent

- `CONTINUE_DRAFTING`
- `RUN_UNTIL_CHECKPOINT`
- `RESUME_LONG_RUN`
- `CANCEL_LONG_RUN`
- `BRANCH_LONG_RUN`

### 15.3 主要读取对象

- task
- plan
- checkpoint summaries
- active continuity layer
- active style layer

### 15.4 主要写入对象

- long-run task state
- checkpoint artifacts
- task events

### 15.5 典型行为

- confirmation：启动高预算任务
- clarification：当前继续范围不清
- cancellation：停止任务
- correction：调整 brief 后继续

### 15.6 long-run 适配

这是 long-run 的原生 family。

### 15.7 adoption 敏感性

自身主要管理运行态；但其产物通常高度 adoption 敏感。

---

## 16. 维护族

### 16.1 作用

用于把正文推进带来的连续性变化显式对象化。

### 16.2 代表性 intent

- `intent.SUMMARIZE_CHAPTER`
- `intent.UPDATE_STATE_SNAPSHOT`
- `intent.SCAN_NEW_FORESHADOWING`
- `intent.SCAN_FORESHADOWING_RESOLUTION`
- `intent.RECORD_TIMELINE_EVENT`

同名自动 hook 使用 `hook.` namespace。

### 16.3 主要读取对象

- accepted or tentative drafts
- chapter / scene
- active continuity layer

### 16.4 主要写入对象

- chapter_summary
- state_snapshot
- foreshadowing
- timeline_event

### 16.5 典型行为

- correction：维护结果与事实不符
- confirmation：一般较少，除非影响面大

### 16.6 long-run 适配

通常作为 hook 或 task 附带运行，不是用户主 long-run family。

### 16.7 adoption 敏感性

高。  
维护结果默认应先 pending，再 adoption。

---

## 17. 阅读族

### 17.1 作用

用于进入或刷新阅读投影，而不是直接创作。

### 17.2 代表性 intent

- `ENTER_READ_MODE`
- `REFRESH_READING_PROJECTION`
- `SUMMARIZE_FOR_READER_RECAP`

### 17.3 主要读取对象

- accepted drafts
- accepted structure ordering
- accepted summaries（按 policy）

### 17.4 主要写入对象

- reading projection artifacts
- reader recap artifacts

### 17.5 典型行为

- clarification：较少
- confirmation：一般不需要

### 17.6 long-run 适配

通常不需要。

### 17.7 adoption 敏感性

低到中。  
阅读投影本身是派生层，但其刷新规则要稳定。

---

## 18. 各 family 的运行特征总结

### 18.1 高 clarification 倾向

通常包括：

- 世界观族
- 主线族
- 章节族
- 场景族
- 改稿族
- 人物族

### 18.2 高 confirmation 倾向

通常包括：

- 长跑族
- 大规模正文族
- 大规模 adoption 的维护族
- 高影响风格变更

### 18.3 高 correction 倾向

通常包括：

- 世界观族
- 主线族
- 改稿族
- 维护族

### 18.4 高 adoption 敏感族

通常包括：

- 正文族
- 改稿族
- 维护族
- 高影响结构族

### 18.5 long-run 原生族

主要包括：

- 正文族
- 场景族
- 长跑族

---

## 19. intent family 与对象模型的关系

### 19.1 结构家族主要作用于主结构对象

- 立项 / 世界观 / 主线 / 分卷 / 章节 / 场景 / 人物 / 风格

### 19.2 文本家族主要作用于 draft

- 正文 / 改稿

### 19.3 维护家族主要作用于连续性对象

- 维护族

### 19.4 控制家族主要作用于 task / artifact

- 长跑族

### 19.5 消费家族主要作用于阅读投影

- 阅读族

---

## 20. intent family 与风格 / 连续性的关系

### 20.1 连续性强依赖族

最强依赖：

- 正文族
- 改稿族
- 场景族
- 长跑族
- 维护族

### 20.2 风格强依赖族

最强依赖：

- 正文族
- 改稿族
- 风格族
- 场景族

### 20.3 弱依赖族

相对弱依赖：

- 阅读族
- 部分立项族

---

## 21. intent family 与 UX 的关系

intent family 不直接决定 UI 布局，但影响 card 类型分布。

### 21.1 常见 card 映射

- 结构族 -> `result_card`
- 长跑族 -> `progress_card` / `checkpoint_card`
- 维护族 -> `adoption_card`
- 风险动作 -> `confirmation_card`
- 冲突或漂移 -> `warning_card` / `failure_card`

### 21.2 主工作台与结构面板

结构族和风格族更多会反映到结构面板；  
正文族、长跑族、维护族更多反映到主工作台卡片流。

---

## 22. catalog 与 registry 的关系

本目录是 Domain 语义目录；真正运行时还需要在 Foundation registry 上注册。

### 22.1 目录的作用

用于定义：

- family
- intent 职责
- 读写对象
- 风险与运行特征

### 22.2 registry 的作用

用于定义：

- slot schema
- candidate capabilities
- policy refs
- hook refs

### 22.3 因此二者关系

```text
catalog = 语义总表
registry = 运行注册表
```

---

## 23. 后续文档依赖

本目录将直接影响：

- `25-maintenance-hooks.md`
- `26-context-assembly-policy.md`
- `27-reading-projection.md`
- `28-authoring-lifecycle.md`

---

## 24. 本文冻结的硬骨

本文正式冻结以下 intent catalog 硬骨：

1. 小说层至少有 13 个 intent family：立项 / 世界观 / 主线 / 分卷 / 章节 / 场景 / 正文 / 改稿 / 人物 / 风格 / 长跑 / 维护 / 阅读
2. 结构族、文本族、维护族、控制族、消费族分工明确
3. 正文族、场景族、长跑族是 long-run 的主要来源
4. 正文族、改稿族、维护族默认高度 adoption 敏感
5. 每个 family 都必须能回答自己读什么、写什么、常见触发什么行为
6. intent catalog 是 Domain 语义目录，不等于最终 registry 配置

---

## 25. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. family 下所有具体 intent 的最终全集
2. 各 intent 的最终 slot schema
3. capability 映射的最终一对一 / 一对多关系
4. 每类 intent 的默认 budget profile

---

## 26. 下一步

intent catalog 之后，最自然的是：

1. `25-maintenance-hooks.md`

因为维护族已经在目录里定下来了，下一步就该把默认 post-hook、adoption 边界和维护 validator 的完整链路写出来。
