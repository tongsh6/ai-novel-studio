# Memory 系统契约 v3

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的 Memory 子系统展开文档。
>
> 目标：定义 v2 的记忆 contract——不只是"更大的上下文"，而是一个可治理、可追踪、可失效、可冲突调解的创作事实系统。

---

## 1. 一句话定位

小说工作台的记忆系统不是"更大的上下文"，而是一个：

**可治理、可追踪、可失效、可冲突调解的创作事实系统。**

它要解决的不是"让 AI 记住更多"，而是让 AI 清楚地区分：

1. 什么是铁律
2. 什么是事实
3. 什么是当前状态
4. 什么只是灵感
5. 什么已经过期
6. 什么存在冲突
7. 什么必须交给作者裁决

---

## 2. 设计目标

### 2.1 核心目标

记忆系统需要支持对话式小说创作中的长期一致性，覆盖：

- 作者偏好、作品设定、世界观规则
- 角色设定、当前状态、人物关系
- 剧情事实、伏笔、写作风格、禁止事项
- 当前章节上下文、临时灵感
- 已确认设定、已失效历史事实
- 冲突设定调解

### 2.2 非目标（MVP 明确不做）

1. 不自动覆盖作者确认设定
2. 不把所有对话都沉淀为长期记忆
3. 不让引用次数直接决定记忆重要性
4. 不在续写主链路里同步做重型冲突检测
5. 不让 AI 擅自裁决核心设定冲突
6. 不让临时脑洞污染作品级记忆
7. 不第一版就做完整 EAV 冲突中心

### 2.3 支撑能力

Memory 必须能支撑：长周期、连续性、回放与审计、多视角消费（Router/Executor/LongRunner/Reader/Debugger）。

---

## 3. 核心原则

### 3.1 记忆不是上下文扩容

错误理解：记忆系统 = 把更多内容塞进 prompt。
正确理解：记忆系统 = 对创作事实进行分层、治理、召回、失效、追踪、冲突调解。

### 3.2 referenceCount 与 weight 必须分离

- `referenceCount` = 被使用、命中、引用的次数
- `weight` = 在生成、分析、续写、校验时的重要程度

高频出现的信息不一定重要。低频出现的信息也可能是作品铁律。referenceCount 不能直接等于重要性，weight 不能完全由 referenceCount 自动决定。

### 3.3 铁律不参与普通排序

铁律级记忆不参与普通相关性排序，直接注入 Base Context。铁律的判定条件（详见 §12.1）：weight >= 0.90、status 为 CONFIRMED 或 STABILIZED、且 locked = true 或 source_type = AUTHOR_CONFIRMED。普通记忆才参与相关性排序。

### 3.4 记忆必须有时间维度

剧情事实不是永恒的。支持 validFrom / validUntil / expireCondition / version。失效后转为历史事实，不删除。

### 3.5 locked 代表人类意志

- locked = true 表示作者明确确认或锁定
- AI 不能自动修改、覆盖、废弃 locked 记忆
- 与 locked 冲突的新记忆必须进入拦截或人工确认

### 3.6 LLM 不是最终裁判

LLM 可以辅助判断冲突，但最终裁决权属于作者。AI 只能建议。

---

## 4. 记忆类型体系 (MemoryType)

> **本节属于 Governed Memory 层（创作事实治理层）。** 该层与 Episodic Log 层（交互日志层，§14-§20）的关系见 §15 两层架构总览。

### 4.1 枚举定义

见 `docs/design-v2/schemas/foundation/enums/memory_type.json`。

| 值 | 含义 |
|----|------|
| `WORLD_RULE` | 世界观规则 |
| `CHARACTER_PROFILE` | 角色设定 |
| `CURRENT_STATE` | 当前状态：伤病、位置、阵营、能力、心理状态 |
| `RELATIONSHIP` | 人物关系 |
| `PLOT_FACT` | 剧情事实 |
| `FORESHADOWING` | 伏笔 |
| `STYLE_RULE` | 写作风格 |
| `CONSTRAINT` | 禁止事项 |
| `AUTHOR_PREFERENCE` | 作者偏好 |
| `IDEA` | 临时灵感 |
| `DRAFT_CONTEXT` | 草稿上下文（当前章节/会话） |

### 4.2 类型优先级

| 类型 | 召回优先级 | 治理优先级 | 说明 |
|------|:---:|:---:|------|
| CONSTRAINT | P0 | P0 | 禁止事项必须优先治理 |
| WORLD_RULE | P0 | P0 | 世界观铁律必须强制召回 |
| CHARACTER_PROFILE | P1 | P1 | 角色稳定设定影响续写质量 |
| CURRENT_STATE | P1 | P1 | 当前状态直接影响章节续写 |
| RELATIONSHIP | P1 | P1 | 人物关系影响对话与行为 |
| PLOT_FACT | P1 | P2 | 已发生剧情事实需要参与续写 |
| STYLE_RULE | P1 | P2 | 控制 AI 文风稳定性 |
| FORESHADOWING | P2 | P3 | 伏笔回收需要专门治理 |
| AUTHOR_PREFERENCE | P1 | P1 | 作者偏好影响生成方向 |
| IDEA | P3 | P3 | 灵感默认不污染正式设定 |
| DRAFT_CONTEXT | P0 | P2 | 当前会话/章节短期上下文 |

---

## 5. 记忆作用范围 (MemoryScope)

### 5.1 枚举定义

见 `docs/design-v2/schemas/foundation/enums/memory_scope.json`。

| 值 | 含义 |
|----|------|
| `GLOBAL` | 全局级：作者长期偏好或平台级规则 |
| `WORK` | 作品级：整本小说生效 |
| `VOLUME` | 卷级：当前卷生效 |
| `ARC` | 篇章/情节线级 |
| `CHAPTER` | 章节级 |
| `SESSION` | 会话级：当前对话临时生效 |

### 5.2 Scope 原则

不能简单固定为 `GLOBAL > WORK > VOLUME > ARC > CHAPTER > SESSION`，也不能反过来。正确方式：**任务类型 + 作用范围 + 权重 + 置信度 + 剧情位置 + 语义相关性 综合判断。**

---

## 6. 记忆状态设计 (MemoryStatus)

### 6.1 枚举定义

见 `docs/design-v2/schemas/foundation/enums/memory_status.json`。

**LOCKED 不作为 status。locked 使用独立 Boolean 字段表示。**

| 值 | 含义 |
|----|------|
| `DRAFT` | 草稿态，尚未确认 |
| `CONFIRMED` | 已确认 |
| `STABILIZED` | 多次使用后稳定沉淀 |
| `CONFLICTED` | 存在冲突，需要作者确认 |
| `DEPRECATED` | 已废弃，不参与普通召回 |
| `ARCHIVED` | 已归档，作为历史事实保留 |

### 6.2 状态与召回/修改权限

| 状态 | 参与普通召回 | AI 可自动修改 | 说明 |
|------|:---:|:---:|------|
| DRAFT | 视情况 | 是 | 草稿态，低权威 |
| CONFIRMED | 是 | 否 | 已确认设定 |
| STABILIZED | 是 | 谨慎 | 多次使用后稳定 |
| CONFLICTED | 否 | 否 | 暂停召回，等待处理 |
| DEPRECATED | 否 | 否 | 已废弃 |
| ARCHIVED | 否（除查历史） | 否 | 历史事实 |

### 6.3 locked 字段

- locked = true 表示作者锁定，AI 不允许自动修改、覆盖、废弃
- locked 不是一种状态，而是一种权限约束
- 与 locked 冲突的新记忆必须拦截或进入人工确认

**locked 与 status 的合法组合：**

| status | 允许 locked = true | 说明 |
|--------|:---:|------|
| DRAFT | 否 | 草稿态尚未确认，锁定无意义 |
| CONFIRMED | **是** | 作者确认后可以锁定 |
| STABILIZED | **是** | 稳定沉淀后可以锁定 |
| CONFLICTED | 否 | 冲突态暂停召回，锁定无意义 |
| DEPRECATED | 否 | 废弃时 locked 自动变 false |
| ARCHIVED | 否 | 归档时 locked 自动变 false |

**状态变更对 locked 的影响：**

- CONFIRMED/STABILIZED → DEPRECATED：locked 自动变 false
- CONFIRMED/STABILIZED → ARCHIVED：locked 自动变 false
- CONFIRMED/STABILIZED → CONFLICTED：locked 保持，但 CONFLICTED 本身不参与召回
- DRAFT → CONFIRMED：可以同时设置 locked = true

---

## 7. 来源类型 (MemorySourceType)

### 7.1 枚举定义

见 `docs/design-v2/schemas/foundation/enums/memory_source_type.json`。

| 值 | 含义 |
|----|------|
| `AUTHOR_CONFIRMED` | 作者手动确认 |
| `AUTHOR_CREATED` | 作者手动创建 |
| `AI_EXTRACTED` | AI 自动抽取 |
| `CHAPTER_EXTRACTED` | 章节内容抽取 |
| `WORK_SETTING_IMPORTED` | 作品设定导入 |
| `SESSION_CONTEXT` | 会话临时上下文 |

### 7.2 来源与初始权重

| 来源 | 初始 weight | 初始 confidence |
|------|:---:|:---:|
| AUTHOR_CONFIRMED（作者明确锁定） | 0.95-1.00 | 0.95-1.00 |
| AUTHOR_CREATED（作者确认设定） | 0.80-0.95 | 0.85-0.95 |
| WORK_SETTING_IMPORTED（作品设定导入） | 0.70-0.90 | 0.75-0.90 |
| CHAPTER_EXTRACTED（章节事实抽取） | 0.50-0.75 | 0.50-0.75 |
| AI_EXTRACTED（AI 自动推断） | 0.35-0.60 | 0.35-0.60 |
| SESSION_CONTEXT（会话临时上下文） | 0.20-0.40 | 0.30-0.50 |

---

## 8. 核心字段设计 (MemoryItem)

### 8.1 MemoryItem

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| work_id | UUID | 所属作品（NOT NULL） |
| volume_id | UUID? | 所属卷 |
| arc_id | UUID? | 所属篇章/情节线 |
| chapter_id | UUID? | 所属章节 |
| content | text | 原始记忆内容 |
| summary | text? | 适合注入上下文的压缩摘要 |
| type | MemoryType | 记忆类型 |
| scope | MemoryScope | 作用范围 |
| status | MemoryStatus | 当前状态 |
| source_type | MemorySourceType | 来源类型 |
| source_id | UUID? | 来源 ID |
| reference_count | integer | 引用次数，默认 0 |
| weight | decimal(5,4) | 权重 0.00-1.00，默认 0.5000 |
| confidence | decimal(5,4) | 置信度 0.00-1.00，默认 0.5000 |
| source_confidence | decimal(5,4) | 来源置信度，默认 0.5000 |
| locked | boolean | 是否锁定，默认 false |
| recallable | boolean | 是否允许自动召回，默认 true |
| common_sense | boolean | 是否进入常识库/降噪池，默认 false |
| valid_from | NarrativePosition? | 生效起点 |
| valid_until | NarrativePosition? | 失效终点 |
| expire_condition | text? | 失效条件描述 |
| version | integer | 版本号，默认 1 |
| tags | [string]? | 标签 |
| last_referenced_at | datetime? | 最近一次引用时间 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 8.2 NarrativePosition

| 字段 | 类型 | 说明 |
|------|------|------|
| work_id | UUID | — |
| volume_id | UUID? | — |
| arc_id | UUID? | — |
| chapter_id | UUID? | — |
| scene_index | integer? | 章节内场景序号 |
| narrative_layer | string? | 主线/倒叙/梦境/回忆/番外等 |
| timeline_node_id | UUID? | 真实时间线节点（预留） |

---

## 9. 权重设计

### 9.1 权重含义

weight 表示这条记忆在生成、续写、分析、校验时应该被多大程度优先考虑。范围 0.00-1.00。

| 权重范围 | 含义 | 示例 |
|---|---|---|
| 0.90-1.00 | 铁律级 | 世界没有魔法、禁止血脉设定 |
| 0.70-0.89 | 强设定 | 主角性格底色、核心人物关系 |
| 0.50-0.69 | 常规设定 | 外貌、习惯、当前阶段能力 |
| 0.30-0.49 | 弱偏好 | 常用描写、局部风格倾向 |
| 0.10-0.29 | 临时信息 | 一次性灵感、待确认想法 |
| 0.00-0.09 | 噪音/废弃 | 已被推翻或不再采用 |

### 9.2 权重初始化规则

见 §7.2 来源与初始权重对照表。

---

## 10. referenceCount 设计

### 10.1 referenceCount 的作用

只表示使用频率。适合用于：判断记忆是否常用、临时灵感是否应沉淀、低置信度记忆是否需复核。

不适合用于：直接决定重要性、覆盖 weight、决定上下文注入优先级、自动覆盖作者确认设定、自动推翻低频铁律。

### 10.2 usageBoost

referenceCount 可作为轻微调节因子：

```
usageBoost = min(log(1 + referenceCount) * 0.03, 0.10)
```

限制最大不超过 0.10，避免马太效应（越常引用→越易召回→越继续引用→少数高频信息垄断上下文）。

### 10.3 高频低权重降噪

当 `referenceCount > 50` 且 `weight < 0.60`，转入常识库/降噪池：usageBoost 不再增长，普通任务中不反复注入，仅在语义高度相关时召回。

---

## 11. 记忆有效期

> **本节属于 Governed Memory 层。** 有效期是剧情位置驱动的"失效"（validFrom/validUntil），与 §19 交互日志层的时间/频率驱动的"降级"（hot→warm→cold）是不同维度——前者决定记忆是否仍然"为真"，后者决定日志是否"仍需热存"。

### 11.1 为什么需要有效期

剧情事实具有时效性。"主角右臂受伤"在第 16 章伤愈后不应继续参与普通召回，但仍保留为历史事实。

### 11.2 有效期字段

- `validFrom`：记忆生效起点
- `validUntil`：记忆失效终点
- `expireCondition`：失效条件描述
- `version`：版本号

### 11.3 记忆类型与有效期策略

| 类型 | 需要有效期 | 说明 |
|------|:---:|------|
| WORLD_RULE | 通常不需要 | 世界观铁律长期有效 |
| CONSTRAINT | 通常不需要 | 禁止事项长期有效 |
| CHARACTER_PROFILE | 可能需要 | 性格底色长期有效，状态变化需版本 |
| CURRENT_STATE | **必须** | 当前状态必须支持变化 |
| RELATIONSHIP | 需要 | 人物关系会变化 |
| PLOT_FACT | **强烈需要** | 剧情事实有明显时效性 |
| FORESHADOWING | 需要 | 回收后转为已完成或归档 |
| STYLE_RULE | 通常不需要 | 文风规则通常长期有效 |
| AUTHOR_PREFERENCE | 通常不需要 | 作者偏好长期有效 |
| IDEA | 需要 | 灵感不应长期污染上下文 |
| DRAFT_CONTEXT | **必须** | 会话或章节结束后失效 |

### 11.4 失效后处理

失效不等于删除。失效前参与普通召回，失效后转为 ARCHIVED 或历史事实。历史事实仍可用于时间线回顾、剧情总结、伏笔回收、一致性审查。

---

## 12. 记忆召回流程

本节是 retrieval 侧（§17.1）的完整实现流程，遵循 retrieval/replay 分离原则（§17.3）。终版采用三阶段过滤 + 重排 + 多样性检查 + Token 打包，不使用单一线性公式。

### 12.1 第一阶段：Hard Filter（铁律直接注入）

满足以下条件的记忆直接进入 Base Context：

- weight >= 0.90
- status IN (CONFIRMED, STABILIZED)
- locked = true 或 source_type = AUTHOR_CONFIRMED
- recallable = true
- scope 与当前任务匹配
- 当前剧情位置仍然有效

Hard Filter 覆盖：世界观铁律、禁止事项、作者锁定设定、核心人物身份、核心关系边界。

### 12.2 第二阶段：Candidate Search（候选召回）

MVP 阶段不依赖向量库，使用：

- 关键词匹配
- 类型匹配
- 实体匹配
- 当前章节/情节线匹配
- 作用范围匹配

后续升级：Vector Search → Hybrid Search → Rerank Model → Entity-aware Retrieval。

### 12.3 第三阶段：Rerank（重排序）

仅对普通记忆（非铁律）：

```
Score = Relevance * 0.60 + Weight * 0.30 + Recency * 0.10 + usageBoost
```

其中 `usageBoost = min(log(1 + referenceCount) * 0.03, 0.10)`。

可扩展项：ScopeProximity、EntityMatchBoost、TaskTypeBoost、CurrentStateBoost。

### 12.4 第四阶段：Diversity Check（去重降噪）

去除：语义重复内容、低权重高频废话、已进入常识库但无必要反复注入的信息、同一实体下重复表达的弱设定、已过期但不属于历史查询任务的事实。

### 12.5 第五阶段：Token Budget Pack（上下文打包）

最终上下文按区块组织：

```
【不可违背规则】
- ...

【当前状态】
- ...

【人物关系】
- ...

【剧情事实】
- ...

【伏笔】
- ...

【写作风格约束】
- ...

【作者偏好】
- ...
```

### 12.6 第六阶段：Reference Log（异步引用日志）

异步记录本次记忆引用日志到 `memory_reference_logs` 表，更新 `reference_count` 和 `last_referenced_at`。不在续写主链路同步写入。

---

## 13. 不同任务的召回策略

### 13.1 续写章节

当前章节上下文 > 当前情节线 > 角色当前状态 > 人物关系 > 剧情事实 > 作者风格偏好。作品铁律通过 Hard Filter 强制注入。

### 13.2 检查世界观冲突

作品铁律 > 世界观规则 > 禁止事项 > 剧情事实 > 当前章节文本。

### 13.3 创建角色

世界观规则 > 已有势力结构 > 已有人物关系 > 当前剧情需要 > 作者偏好。

### 13.4 优化文风

作者风格偏好 > 作品文风规则 > 当前章节语气 > 写作技巧 > 禁用表达。

### 13.5 回收伏笔

未回收伏笔 > 历史章节事实 > 相关人物动机 > 当前剧情位置 > 作品铁律。

---

## 14. 三层保留结构

> **本节属于 Episodic Log 层（交互日志层）。** `interactions` 表使用 hot/warm/cold 三级保留，与 Governed Memory 层（`memory_items` 表，§4-§13）是互补关系。两层架构总览见 §15。

Foundation 正式定义三层 retention tier。hot / warm / cold 是语义层，不绑定具体存储实现。

### 14.1 hot tier

当前运行路径的高频访问记忆。低延迟、小体量、强相关、高新鲜度。典型内容：最近若干 turn、活跃 behavior state、当前 task state、最近 accepted artifacts、当前活跃对象摘要。

实现：ETS ordered_set（NovelAgent.Memory.Store）。

### 14.2 warm tier

经过压缩或摘要，仍需高频 retrieval 的中期记忆。可检索、可作为 context assembly 主要来源。典型内容：chapter summaries、task summaries、aggregated interaction summaries、snapshot summaries、curated semantic extracts。

实现：PostgreSQL（NovelPersistence.MemoryLog）。

### 14.3 cold tier

长期归档，用于 audit、replay、深度回查和迁移。默认不进日常 context，必须可按需取回，保真优先于低延迟。典型内容：old turn logs、raw provider outputs、old traces、historical task events、archived artifacts。

### 14.4 核心原则

hot / warm / cold 是语义层，不绑定具体存储实现。但 tier 语义不能变。

---

## 15. 三层保留 vs 记忆治理：两层架构

Memory 系统分为两个互补层面：

| 层 | 职责 | 核心表 | 现有实现 |
|----|------|--------|----------|
| **Episodic Log**（交互日志层） | 记录"发生过什么"——回放、审计、trace | `interactions` | Memory.Store + MemoryLog |
| **Governed Memory**（创作事实治理层） | 管理"什么是真的"——设定、规则、状态、冲突 | `memory_items` | 本次新增 |

两层独立运作，互不替代：

- `interactions` 记录每次 turn 的原始消息（回放 fidelity）
- `memory_items` 管理可治理的创作事实（weight, locked, validity, version）
- 两者通过 `source_type` / `source_id` 关联，但不强制外键

---

## 16. Memory Source Taxonomy（交互日志层）

Memory 必须把来源作为一等元数据。本节适用于 `interactions` 表（episodic log）。

### 16.1 每条 interaction 最小字段

memory_id, memory_class, source_type, source_ref, scope_ref, created_at, updated_at, retention_tier, freshness_score, importance_score, replayable, retrievable。

### 16.2 memory_class（交互日志层）

枚举见 `docs/design-v2/schemas/foundation/enums/memory_class.json`：

- `episodic` — 情景记忆：发生过哪些交互和运行事件
- `semantic` — 语义记忆：系统认定为结构化事实的信息
- `procedural` — 程序记忆：Agent 会什么、能做什么
- `meta` — 元记忆：长期稳定偏好和行为性约束

### 16.3 source_type（交互日志层）

枚举见 `docs/design-v2/schemas/foundation/enums/source_type.json`：turn, task_event, artifact, object_snapshot, object_summary, registry, audit_event, external_import。

注意：此 `source_type` 与 `memory_source_type`（§7，治理层）是两个独立枚举，服务不同表。

---

## 17. Retrieval 与 Replay 的分离

这是 Memory contract 的核心硬骨。

### 17.1 retrieval

回答"为了当前任务，最值得带进来的上下文是什么？"。面向 relevance、freshness、importance、cost efficiency。允许返回 summary、excerpt、object snapshot、ranked refs。不要求保留历史原貌。

### 17.2 replay

回答"当时到底发生了什么？"。面向 fidelity、chronology、traceability、reproducibility boundary。使用 frozen turn result、frozen trace、archived provider raw output、event log。不应为节省 token 而偷偷改写历史。

### 17.3 强制分离规则

1. retrieval 和 replay 不能共用同一个 API 语义
2. retrieval 可优先返回 summary；replay 不能用 summary 冒充原始记录
3. replay 失败时必须明确说明缺失的是哪一层历史
4. retrieval 的排序因子和 replay 的时间顺序因子不能混用

---

## 18. Summarization Contract

Summarization 不是"可选优化"，而是 Memory 的正式组成部分。

### 18.1 summary 的角色

用于 warm tier 压缩、retrieval 加速、continuity recall、context assembly、long-run checkpoint handoff。

### 18.2 summary 最低要求

summary_id, summary_type, source_refs, scope_ref, generated_at, version, fidelity_level, summary_text, structured_facts/structured_refs。

### 18.3 fidelity level

- `lossy`：retrieval 常用
- `balanced`：continuity handoff 常用
- `high_fidelity`：migration/audit 辅助

### 18.4 summary 不能覆盖源记录

summary 是派生物，不是替代物。源记录进入 cold tier 后可降温，但不能因为有 summary 就删除所有源历史。

---

## 19. Retention Policy Contract

> **本节属于 Episodic Log 层。** 保留策略是时间/频率驱动的"降级"（hot→warm→cold），与 §11 Governed Memory 层的剧情位置驱动的"失效"（validFrom/validUntil）是不同维度。

### 19.1 触发因子

age, access frequency, current task relevance, importance score, accepted/tentative state, audit requirement, replay requirement, storage budget pressure。

### 19.2 动作类型

keep_hot, demote_to_warm, archive_to_cold, summarize_and_demote, compact_index, mark_replay_only, delete_if_allowed。

### 19.3 删除必须是显式策略

默认不自动删。删除必须满足：policy 明确允许、不违反 audit requirement、不违反 replay guarantee、不违反 domain retention requirement。

### 19.4 tentative 数据的保留

未采纳 tentative 可更快降温，但在 task 未终结前不能丢失。

---

## 20. 长跑任务的记忆要求

### 20.1 checkpoint summary

每次 checkpoint 至少产出：progress summary、current state refs、pending artifacts refs、unresolved issues、next step context。

### 20.2 resume 不依赖完整旧上下文

默认依赖：task state、checkpoint summaries、active object refs、latest accepted artifacts、unresolved behavior states。

---

## 21. EAV 原子化设计（预留，P4+）

### 21.1 为什么需要 EAV

冲突检测不能只靠文本。需要把记忆拆成 Entity-Attribute-Value 用于结构化比对。

### 21.2 第一阶段只覆盖高风险类型

优先：角色身份、角色生死状态、角色关系、世界观禁忌、当前身体状态、当前能力状态、当前阵营状态。
暂不：性格细节、外貌细节、文风偏好、心理暗示、隐喻表达、普通场景描写。

### 21.3 MemoryAtom

| 字段 | 说明 |
|------|------|
| memory_id | 关联 MemoryItem |
| entity_type | CHARACTER / WORLD / ORGANIZATION / ITEM / LOCATION |
| entity_id / entity_name | 实体标识 |
| attribute_key | 属性 Key |
| attribute_value | 属性值 |
| logical_key | `work_id:entity_type:entity_name:attribute_key` |
| logical_hash | `hash(logical_key + normalized(value))` |
| confidence | 原子置信度 |
| valid_from / valid_until | 时效范围 |

同一 logicalKey 下 logicalHash 不同 → 同一实体属性发生变化 → 进入冲突预检。

---

## 22. 冲突检测设计（预留，P5+）

### 22.1 总体流程

新记忆 → 抽取 EAV atoms → logicalKey 查询已有 atoms → 无匹配直接写入 → 匹配且值相同更新引用 → 匹配但值不同进入预检 → 旧记忆已过期允许版本演进 → 涉及 LOCKED/CONFIRMED 进入高风险处理 → 必要时 LLM 裁决 → 输出冲突结果 → 作者确认或归档。

### 22.2 冲突等级与处理策略

| 等级 | 含义 |
|------|------|
| NONE | 无冲突 |
| SOFT | 潜在冲突，需标记 |
| HARD | 硬冲突，需拦截 |

| 策略 | 说明 |
|------|------|
| BLOCK | 拦截新记忆（与 locked 冲突时） |
| FLAG | 标记为待处理 |
| VERSION_DRIFT | 作为剧情演进，建立版本关系 |
| MERGE | 合并两条记忆 |
| IGNORE | 忽略新记忆 |

### 22.3 LLM 裁决触发条件

只在以下情况调用：新记忆准备沉淀为 CONFIRMED/STABILIZED、涉及核心实体、与已有 logicalKey 发生 value 差异、可能影响 locked/高权重记忆、来源是 AI 自动推断、规则预检无法确定。

---

## 23. MVP 落地范围

### 23.1 第一阶段：基础记忆治理（P0）

- memory_items 表 + CRUD
- MemoryType / MemoryScope / MemoryStatus / MemorySourceType
- referenceCount / weight / confidence / locked / recallable / validFrom-validUntil
- confirm / lock / deprecate / archive 操作
- 前端记忆管理页

### 23.2 第二阶段：记忆召回（P1）

- Hard Filter + Candidate Search + Rerank + Diversity + Token Pack
- MemoryRecallService + 召回 API
- TurnService 集成 memory recall

### 23.3 第三阶段：召回解释与引用日志（P2）

- memory_reference_logs 表
- MemoryReferencedEvent 异步处理
- 召回预览页面

### 23.4 后续阶段（P3-P6）

有效期与状态演进 → EAV 原子化 → 冲突检测 → LLM 裁决 → 冲突调解中心与记忆时间线。

---

## 24. 数据库设计

### 24.1 memory_items

```sql
CREATE TABLE memory_items (
    id UUID PRIMARY KEY,
    work_id UUID NOT NULL,

    volume_id UUID NULL,
    arc_id UUID NULL,
    chapter_id UUID NULL,

    content TEXT NOT NULL,
    summary TEXT NULL,

    type VARCHAR(64) NOT NULL,
    scope VARCHAR(64) NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'DRAFT',
    source_type VARCHAR(64) NOT NULL,

    reference_count INT NOT NULL DEFAULT 0,

    weight DECIMAL(5,4) NOT NULL DEFAULT 0.5000,
    confidence DECIMAL(5,4) NOT NULL DEFAULT 0.5000,
    source_confidence DECIMAL(5,4) NOT NULL DEFAULT 0.5000,

    locked BOOLEAN NOT NULL DEFAULT FALSE,
    recallable BOOLEAN NOT NULL DEFAULT TRUE,
    common_sense BOOLEAN NOT NULL DEFAULT FALSE,

    valid_from JSONB NULL,
    valid_until JSONB NULL,
    expire_condition TEXT NULL,

    version INT NOT NULL DEFAULT 1,

    tags TEXT[] NULL,

    source_id UUID NULL,
    last_referenced_at TIMESTAMPTZ NULL,

    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
```

索引：

```sql
CREATE INDEX idx_memory_items_recall ON memory_items(work_id, status, type, scope, locked, recallable);
CREATE INDEX idx_memory_items_weight ON memory_items(work_id, weight);
CREATE INDEX idx_memory_items_source ON memory_items(work_id, source_type, source_id);
```

### 24.2 memory_reference_logs

```sql
CREATE TABLE memory_reference_logs (
    id UUID PRIMARY KEY,
    memory_id UUID NOT NULL,
    work_id UUID NOT NULL,
    task_id UUID NULL,
    conversation_id UUID NULL,
    reference_scene VARCHAR(64) NOT NULL,
    reference_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
```

### 24.3 预留表（后续阶段）

- `memory_embeddings`：向量独立存储（不塞进主表）
- `memory_atoms`：EAV 原子化
- `memory_conflicts`：冲突记录

---

## 25. API 设计

### 25.1 记忆管理 API（P0）

```
POST   /api/works/:work_id/memories                  # 创建记忆
GET    /api/works/:work_id/memories                  # 搜索记忆
GET    /api/works/:work_id/memories/:memory_id        # 获取详情
POST   /api/works/:work_id/memories/:memory_id/confirm   # 确认
POST   /api/works/:work_id/memories/:memory_id/lock      # 锁定
POST   /api/works/:work_id/memories/:memory_id/unlock    # 解锁
POST   /api/works/:work_id/memories/:memory_id/deprecate # 废弃
POST   /api/works/:work_id/memories/:memory_id/archive   # 归档
PATCH  /api/works/:work_id/memories/:memory_id/weight    # 修改权重
PATCH  /api/works/:work_id/memories/:memory_id/validity  # 修改有效期
```

### 25.2 召回 API（P1）

```
POST /api/works/:work_id/memories/recall
```

请求：taskType, userInput, volumeId, arcId, chapterId, sceneIndex, involvedCharacters, tokenBudget。
响应：hardRules, currentStates, relationships, plotFacts, foreshadowings, styleRules, packedContext, excludedMemories, referenceTrace。

### 25.3 引用记录 API（P2）

```
GET /api/works/:work_id/memories/:memory_id/references
```

### 25.4 冲突 API（P5，预留）

```
GET    /api/works/:work_id/memory-conflicts
GET    /api/works/:work_id/memory-conflicts/:conflict_id
POST   /api/works/:work_id/memory-conflicts/:conflict_id/resolve
```

---

## 26. 前端设计（概要）

### 26.1 记忆管理页（P0）

筛选：类型、作用范围、状态、权重区间、locked、recallable、commonSense、是否过期、来源类型、关键实体/标签。

操作：确认、锁定、解锁、废弃、归档、修改权重、修改有效期、设置可召回。

### 26.2 当前任务召回预览（P2）

第一版最重要的信任感页面。展示：本次注入哪些记忆、哪些是铁律、哪些因过期排除、哪些因 token 不够裁掉、最终注入给 AI 的上下文。

### 26.3 冲突调解中心（P5+，预留）

左侧既有记忆、右侧新记忆、中间 AI 冲突理由、底部处理动作。

---

## 27. 异步事件设计

| 事件 | 用途 | 优先级 |
|------|------|:---:|
| MemoryCreatedEvent | memory_id, work_id, source_type | P1 |
| MemoryReferencedEvent | memory_id, work_id, task_id, reference_scene, reference_reason | P2 |
| MemoryConflictDetectedEvent | conflict_id, work_id, old_memory_id, new_memory_id, conflict_level | P5 |

---

## 28. 最终规则清单

1. referenceCount 只代表使用频率，不代表真理
2. weight 代表重要性，但不能单独决定召回
3. locked 代表人类意志，AI 不能自动覆盖
4. CONFIRMED 高于 STABILIZED
5. AUTHOR_CONFIRMED 高于 AI_EXTRACTED
6. 铁律级记忆不参与普通排序，直接强制注入
7. 普通记忆通过候选召回 + 重排进入上下文
8. 向量检索只解决相关性，不解决冲突
9. 剧情事实必须支持有效期
10. 当前状态必须支持版本演进
11. 失效记忆不删除，转为历史事实
12. 冲突检测先 EAV，再规则预检，最后 LLM 裁决
13. LLM 只做复杂冲突辅助裁决，不做最终设定裁判
14. 作者拥有最终裁决权
15. 引用日志必须异步写入
16. 高频低权重记忆要降噪，不能反复占用上下文
17. 低频高权重记忆不能因为少用而降权
18. 临时灵感不能直接污染作品级设定
19. 会话级记忆默认短期有效
20. 作品级铁律默认长期有效
21. 召回结果必须可解释
22. 上下文打包必须结构化，而不是堆列表
23. EAV 不要第一版就全量泛化
24. 冲突中心不要早于召回预览
25. 记忆系统的目标是治理创作事实，而不是堆上下文

---

## 29. 本文冻结的硬骨

1. 记忆系统 = 创作事实治理系统，不是上下文扩容
2. MemoryType 11 种、MemoryScope 6 级、MemoryStatus 6 态（LOCKED 不作为 status）
3. referenceCount 与 weight 分离；铁律不参与普通排序
4. locked = 人类意志，AI 不可覆盖
5. 剧情事实必须支持有效期（validFrom/validUntil/version）
6. 召回六阶段流程：Hard Filter → Candidate Search → Rerank → Diversity → Token Pack → Reference Log
7. 两层架构：Episodic Log（interactions）+ Governed Memory（memory_items），互补不替代
8. 三层 retention tier（hot/warm/cold）+ retrieval/replay 分离 + summary 是正式产物
9. 冲突检测分阶段：先 EAV → 规则预检 → LLM 裁决，作者最终裁决
10. LLM 不做第一层判断，不做最终裁判

---

## 30. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. importance score / freshness score 精确计算公式
2. embedding / vector store 方案
3. summary 生成 prompt
4. chunking 策略最终参数
5. LLM 裁决 prompt 精确措辞
6. EAV 抽取 prompt / 覆盖范围
7. 冲突调解中心 UI 布局
8. **Rerank Relevance 的精确计算**——MVP 阶段使用简化方案：关键词命中数 / 查询词总数，类型匹配 +0.15，scope 精确匹配 +0.10，实体名匹配 +0.20。后续升级为语义相似度

---

## 31. 与现有实现的关系

| 现有模块 | 归属层 | 本文改动 |
|----------|--------|----------|
| NovelAgent.Memory.Store | Episodic Log (hot tier) | **不动** |
| NovelPersistence.MemoryLog | Episodic Log (warm tier) | **不动** |
| NovelPersistence.Schemas.Interaction | Episodic Log | **不动** |
| NovelFoundation.Enums.MemoryClass | Episodic Log 枚举 | **不动** |
| NovelFoundation.Enums.SourceType | Episodic Log 枚举 | **不动** |
| — | Governed Memory | **新增** MemoryType/Scope/Status/SourceType 枚举 |
| — | Governed Memory | **新增** MemoryItem domain struct + Ecto schema |
| — | Governed Memory | **新增** MemoryService + MemoryRecallService |
| — | Governed Memory | **新增** REST API + 前端页面 |

---

## 32. 下一步

1. 实现 4 个新枚举 codegen
2. Migration + Persistence 层
3. MemoryService CRUD
4. MemoryRecallService
5. Web API + 前端页面
