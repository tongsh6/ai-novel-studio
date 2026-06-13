# Style And Author Intent v2

> 状态：草案
>
> 角色：`docs/design/domain/21-novel-object-model.md` 的风格与作者意志子模型展开文档，并依赖 `docs/design/06-memory-context-and-trace.md`、`docs/design/04-execution-orchestrator.md`、`docs/design/07-workbench-ui-contract.md`。
>
> 目标：定义 v2 中 `style_sample`、`writing_preferences`、`brief` 和在线反馈补丁机制，明确作者意志如何作为一等对象进入创作执行、维护长篇风格稳定，并与长期记忆、长跑任务、adoption 流程连接。

---

## 1. 文档定位

本文回答 8 个问题：

1. 为什么风格和作者意志必须独立建模
2. `style_sample`、`writing_preferences`、`brief` 各自负责什么
3. 长期偏好和临时指令如何分层
4. 在线反馈如何累积而不污染基础风格
5. 多层 brief 之间的优先级如何处理
6. 风格对象如何进入 retrieval、execution、long-run
7. 风格对象哪些需要 adoption，哪些可以直接生效
8. UI 后续如何消费这些对象

本文不负责：

- 具体 prompt 模板
- 风格提炼算法
- 某个作者风格是否模仿得像的评价标准

本文只冻结风格与作者意志模型。

---

## 2. 为什么风格必须显式建模

如果没有独立风格层，系统会出现三类问题：

1. 写得越来越不像作者
2. 每一章都像新项目，口吻和节奏漂移
3. 用户每次都得重新说一遍“不要这样写”

如果这些信息只散落在：

- 对话历史
- 某次 prompt 附件
- 某章 brief

系统无法稳定维持：

- 长期语感
- 节奏偏好
- 禁忌和雷区
- 人称、叙述距离、章节尾钩习惯

因此风格必须成为作品层的一等对象，而不是提示词杂项。

---

## 3. 风格层的职责

风格层至少负责：

1. 保存作品级长期风格偏好
2. 保存可参考的风格样本
3. 保存局部阶段的临时创作意图
4. 保存在线反馈形成的增量补丁
5. 为 execution / long-run / revise 提供风格输入

它不负责：

1. 世界事实
2. 连续性状态
3. 时间线
4. 伏笔回收逻辑

也就是说：

- 风格层回答“怎么写”
- 连续性层回答“写的是不是同一本书”

---

## 4. 风格对象总览

风格与作者意志对象至少包括：

1. `style_sample`
2. `writing_preferences`
3. `brief`
4. `feedback_patch`（增量补丁对象，本文引入）

### 4.1 `style_sample`

保存原始样本文本或参考来源。

### 4.2 `writing_preferences`

保存长期稳定偏好。

### 4.3 `brief`

保存局部阶段的临时意图。

### 4.4 `feedback_patch`

保存在线反馈产生的、尚不宜直接并入长期偏好的增量修正。

---

## 5. style_sample

`style_sample` 是风格层的原始输入对象。

### 5.1 定义

它表达：

**“作者本人或作者认可的参考文本样本，用于提炼语感、节奏和文风特征。”**

### 5.2 style_sample 的来源

至少包括：

- 作者自有文本
- 作者认可的参考文本
- 历史已采纳正文片段

### 5.3 style_sample 的作用

至少包括：

- 提炼风格摘要
- 支撑风格一致性
- 为改稿和续写提供语感锚点

### 5.4 style_sample 不应直接当作偏好对象

样本是原始材料，不等于整理后的规则。

例如：

- 一段样本文本不等于“必须用第一人称”
- 一段样本文本也不等于“章节尾必须反转”

这些是后续提炼出的偏好。

### 5.5 style_sample 的状态

建议至少支持：

- `ACTIVE`
- `DISABLED`
- `ARCHIVED`

---

## 6. writing_preferences

`writing_preferences` 是作品级长期偏好对象。

### 6.1 定义

它表达：

**“作者在这个作品上希望长期保持的写法偏好、禁忌和节奏原则。”**

### 6.2 典型内容方向

至少包括：

- narrative distance
- POV preference
- pacing preference
- chapter ending hook preference
- taboo / no-go list
- trope preference / trope avoidance
- dialogue density preference
- emotional texture preference
- exposition tolerance

### 6.3 writing_preferences 不是 brief

- `writing_preferences`：长期稳定，跨卷跨章有效
- `brief`：阶段性、局部性、可频繁替换

### 6.4 writing_preferences 的作用

至少包括：

- default generation constraints
- revise criteria
- long-run style continuity
- preference-aware clarification / confirmation hints

### 6.5 状态

建议至少支持：

- `ACTIVE`
- `SUPERSEDED`
- `ARCHIVED`

---

## 7. brief

`brief` 是局部阶段的临时创作意图对象。

### 7.1 定义

它表达：

**“在某个局部范围内，这一段创作此刻最需要遵守的方向性指令。”**

### 7.2 brief 的典型作用域

至少包括：

- work-level brief
- volume-level brief
- chapter-level brief
- scene-level brief
- task-level brief

### 7.3 brief 的特点

它通常：

- 生命周期短
- 修改频繁
- 强影响当前执行
- 不代表长期偏好

### 7.4 brief 的典型内容方向

至少包括：

- 本章目标
- 本场情绪重点
- 本次长跑不要偏离什么
- 这一段要避免什么写法

### 7.5 brief 必须支持 anchor

至少包括：

- `anchor_type`
- `anchor_ref`

因为 brief 天然是局部对象。

---

## 8. feedback_patch

在线反馈需要正式对象化，而不是直接悄悄改长期偏好。

### 8.1 定义

它表达：

**“作者对某次生成、某段文本、某个阶段给出的增量修正反馈。”**

### 8.2 为什么需要独立对象

如果把在线反馈直接写进 `writing_preferences`，会出现：

- 偏好被瞬时情绪污染
- 长期风格变得不稳定
- 无法区分作品级原则和这次只是不喜欢

### 8.3 feedback_patch 的作用

至少包括：

- 对当前阶段生成施加增量约束
- 记录反复出现的修正模式
- 为未来是否合并进长期偏好提供依据

### 8.4 feedback_patch 的状态

建议至少支持：

- `ACTIVE`
- `MERGED`
- `DISMISSED`
- `EXPIRED`

> 这套状态是 feedback_patch 的**运行态生命周期**（在线反馈补丁是否生效 / 已合入 / 已撤销 / 已过期），与 adoption 7 态（`30 §3.2`）不同抽象层：adoption 7 态描述 artifact 在 adoption boundary 上的采纳生命周期；feedback_patch 在采纳后才进入本节状态机。两套状态独立，不可互相替代。

---

## 9. 风格对象的分层优先级

风格层对象必须有明确优先级。

### 9.1 默认优先级

推荐顺序：

1. active `feedback_patch`
2. active local `brief`
3. parent-level `brief`
4. active `writing_preferences`
5. active `style_sample` derived style cues

### 9.2 解释

- `feedback_patch` 最贴近当前问题
- `brief` 表达当前阶段意图
- `writing_preferences` 表达长期偏好
- `style_sample` 是基础参考材料，不应直接压过更明确指令

### 9.3 冲突处理

如果出现冲突，系统至少应能说明：

- 哪个层级覆盖了哪个层级
- 是否需要 clarification 或 confirmation

---

## 10. 风格对象与 adoption

不是所有风格对象都需要同样的 adoption 路径。

### 10.1 `style_sample`

作为输入样本，通常不需要 adoption 才“生效”，但需要可控启用 / 禁用。

### 10.2 `writing_preferences`

长期偏好对象变更通常影响面大，默认应视为高影响修改。

因此推荐：

- create / revise -> adoption-sensitive

### 10.3 `brief`

brief 通常由作者直接给出，可直接进入当前运行上下文。

但如果是系统草拟 brief，则应先进入 pending 路径。

### 10.4 `feedback_patch`

默认先直接对当前阶段生效，但是否合并入长期偏好应进入单独决策路径。

---

## 11. 风格对象与 Memory 的关系

风格对象是 memory 的重要输入，但使用方式不同。

### 11.1 `style_sample`

通常进入：

- cold / warm tier

因为原文样本可能较长，不应每次都热放。

### 11.2 `writing_preferences`

通常进入：

- warm / hot tier

因为是高密度结构化偏好。

### 11.3 `brief`

通常进入：

- hot tier

因为最直接影响当前执行。

### 11.4 `feedback_patch`

通常进入：

- hot tier（短期）
- warm tier（如果重复出现或被保留）

---

## 12. 风格对象与 Long-Run 的关系

long-run 特别依赖风格层。

### 12.1 启动时

至少读取：

- active writing_preferences
- relevant local brief
- active feedback patches

### 12.2 运行中

如果用户在 long-run 过程中修正风格方向：

- 新 `brief`
- 新 `feedback_patch`

应成为后续 resume 或后续 unit 的输入。

### 12.3 checkpoint

checkpoint 需要能呈现：

- 当前沿用的 brief
- 风格修正是否被吸收

### 12.4 long-run 不应硬复制旧 style context

resume 时应重新读取当前 authoritative style / intent layer，而不是盲目沿用旧 prompt。

---

## 13. 风格对象与执行路径

风格对象会进入多个执行路径。

### 13.1 draft / revise

最直接依赖：

- writing_preferences
- brief
- style-derived cues

### 13.2 summarize / maintenance

通常弱依赖风格层，但可参考：

- summary granularity preference
- reader-facing summary style preference

### 13.3 read projection

阅读投影通常不受风格对象直接改写，但风格对象决定被采纳文本的形成方式。

---

## 14. 风格对象与对象模型的边界

### 14.1 `style_sample` 不等于正文对象

它可能引用正文片段，但它自己不是 draft。

### 14.2 `writing_preferences` 不等于规则对象

它表达偏好，不表达世界硬规则。

### 14.3 `brief` 不等于 chapter / scene 主对象

brief 是局部意图，不是结构节点本身。

### 14.4 `feedback_patch` 不等于 correction

feedback_patch 是风格/偏好增量；  
correction 是运行时修正行为协议。

二者可以关联，但不能混同。

---

## 15. 风格对象的来源追踪

风格对象也必须可追踪来源。

### 15.1 典型来源

至少包括：

- user explicit input
- imported sample
- accepted draft excerpt
- system distilled proposal
- online feedback

### 15.2 必须能回答的问题

至少包括：

- 这个偏好是谁设的
- 这个样本从哪里来
- 这个 brief 作用于哪一层
- 这个 feedback_patch 是针对哪次生成

---

## 16. 在线反馈的合并策略

不是所有 feedback_patch 都应该自动并入长期偏好。

### 16.1 默认策略

推荐：

- patch 先局部生效
- 观察是否重复出现
- 再决定是否提炼成长期 preference

### 16.2 合并条件

至少考虑：

- 反馈是否重复
- 反馈是否跨多个章节仍成立
- 反馈是否与现有长期偏好冲突

### 16.3 合并结果

至少支持：

- merge into writing_preferences
- keep as patch only
- dismiss as local noise

---

## 17. 风格对象与 UI 的关系

### 17.1 结构面板

风格面板主要消费：

- writing_preferences
- active briefs
- active style samples
- active feedback patches

### 17.2 主工作台

主工作台主要通过：

- confirmation / clarification / result cards

间接展示当前生效的 brief 或 patch。

### 17.3 阅读模式

阅读模式通常不直接展示风格对象，但风格对象决定其背后的文本是如何形成的。

---

## 18. 风格对象与 UX Contract 的关系

风格对象会影响 card 内容，但不能改写基础 card taxonomy。

### 18.1 典型 UI 投影

例如：

- 风格样本导入结果 -> `result_card`
- 高影响偏好修改 -> `confirmation_card`
- 当前生效 brief -> `result_card` / `progress_card` 摘要

### 18.2 不应做的事

不应因为某类风格对象就另起一套基础行为语义。

---

## 19. 与 Domain 其他对象的关系

### 19.1 与 continuity

- continuity：写的是不是同一本书
- style：写得像不像这本书 / 这个作者

### 19.2 与 main structure

- structure：写哪一卷哪一章哪一场
- style：用什么写法去写

### 19.3 与 assets

资产对象提供事实内容，风格对象决定呈现方式。

---

## 20. 本文冻结的硬骨

本文正式冻结以下风格与作者意志硬骨：

1. 风格层至少包括：`style_sample / writing_preferences / brief / feedback_patch`
2. `style_sample` 是原始风格输入，不等于长期偏好
3. `writing_preferences` 是作品级长期偏好对象
4. `brief` 是局部阶段性意图对象，必须支持 anchor
5. 在线反馈必须先以 `feedback_patch` 存在，不能默认直接污染长期偏好
6. 风格层有明确优先级：`feedback_patch > local brief > parent brief > writing_preferences > style_sample-derived cues`
7. long-run resume 必须重新读取当前权威风格层，而不是盲用旧 prompt

---

## 21. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. `writing_preferences` 的最终字段全集
2. `feedback_patch` 的最终归并算法
3. 样本提炼的具体方法
4. brief 的最终作用域枚举全集

---

## 22. 下一步

风格模型之后，最自然的是：

1. `24-novel-intent-catalog.md`

因为对象、连续性、风格三层已经有了，下一步就该把小说层到底有哪些动作、这些动作依赖哪些对象和运行边界明确列出来。

