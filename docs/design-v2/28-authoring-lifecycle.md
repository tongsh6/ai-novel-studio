# Authoring Lifecycle v2

> 状态：草案
>
> 角色：`docs/design-v2/20-novel-domain-overview.md` 中创作生命周期的展开文档，并依赖 `docs/design-v2/21-novel-object-model.md`、`docs/design-v2/22-continuity-model.md`、`docs/design-v2/23-style-and-author-intent.md`、`docs/design-v2/24-novel-intent-catalog.md`、`docs/design-v2/25-maintenance-hooks.md`、`docs/design-v2/27-reading-projection.md`。
>
> 目标：定义 v2 中从立项到阅读/修订的创作生命周期，明确每个阶段的主对象、主 intent、主风险、主 UI 面、状态转换条件和阶段间产物流动。

---

## 1. 文档定位

本文回答 8 个问题：

1. 小说创作在系统里分哪些阶段
2. 每个阶段的主对象和主动作是什么
3. 阶段之间如何转移
4. 什么情况下应从一个阶段退回上个阶段修正
5. 长跑在生命周期中主要出现在哪些阶段
6. maintenance 和 reading 在生命周期中处于什么位置
7. UI 后续需要支持哪些阶段性视图
8. 为什么生命周期必须显式建模

本文不负责：

- 页面布局
- 最终阶段枚举的所有 UI 命名
- 具体增长策略和商业化设计

本文只冻结创作生命周期的领域流程。

---

## 2. 为什么生命周期必须显式建模

如果没有生命周期模型，系统会退化成“任何时候都可以干任何事”的对话工具。

结果是：

- 上下文难以聚焦
- UI 没法推荐正确工作模式
- Long-run 无法知道当前最适合推进什么
- 结构维护与阅读投影脱节

生命周期模型的价值是：

1. 给当前阶段提供“主任务”
2. 给上下文组装提供“主焦点”
3. 给 UI 提供“默认工作表面”
4. 给 long-run 提供“默认推进单元”

---

## 3. 生命周期总览

小说创作至少划分为 5 个阶段：

1. 建立期
2. 规划期
3. 产出期
4. 维护期
5. 阅读与修订期

### 3.1 它们的关系

不是严格线性流水线，而是主循环：

```text
建立 -> 规划 -> 产出 -> 维护 -> 阅读/修订
                  ^        |
                  |--------|
```

### 3.2 主循环含义

- 建立 / 规划偏结构
- 产出偏正文
- 维护偏连续性
- 阅读 / 修订偏成品回看与反向修正

### 3.3 首批 UI intent 与生命周期阶段对齐（ADR-0008）

各阶段"主 intent family"的首批 UI intent 集合由 ADR-0008（`adr/0008-first-batch-intents.md`）§3 冻结：

- 建立期 5 条（§3.1）
- 规划期 4 条（§3.2）
- 产出期 5 条（§3.3）
- 维护期 4 条（§3.4）
- 阅读与修订期 2 条（§3.5）

合计 20 条，覆盖 5 阶段全部主 family；每条 intent 的 `risk_class` / `default_requires_confirmation` / `long_run_fit` 默认值见 ADR-0008 §3 各表。slot schema 由 ADR-0010 进一步冻结。本文档各阶段 §X.3 列出的"主 intent family"在 UI 首批阶段以 ADR-0008 为唯一真值表。

---

## 4. 建立期

### 4.1 目标

从模糊想法到最小可写作品。

### 4.2 主对象

- work
- worldbuilding seed
- main_outline seed
- style_sample / writing_preferences 初始对象
- character seeds

### 4.3 主 intent family

- 立项族
- 世界观族
- 主线族
- 人物族
- 风格族

### 4.4 典型产物

- work seed
- 初始世界观骨架
- 初始主线方向
- 初始角色候选
- 初始风格偏好

### 4.5 主风险

- 方向不清
- 题材与目标读者不清
- 风格锚点缺失

### 4.6 默认 UI 面

以对话面为主，结构面可逐步出现。

---

## 5. 规划期

### 5.1 目标

把作品从整书方向拆到卷、章、场。

> ADR-0004 已冻结 planning 默认中层：先定位 `volume`，再在 volume 内用 `arc` 组织剧情推进。

### 5.2 主对象

- main_outline
- volume / arc
- chapter
- scene
- chapter / scene brief

### 5.3 主 intent family

- 主线族
- 分卷族
- 章节族
- 场景族

### 5.4 典型产物

- 分卷骨架
- backlog chapter list
- scene outlines

### 5.5 主风险

- 拆分粒度不当
- 结构跨度太大导致中段乏力
- scene 与 chapter 失配

### 5.6 默认 UI 面

对话面仍为主，但结构面板价值开始上升。

规划期同样不应把“新卷目标 / 章节核心冲突 / 场景边界”简单做成表单。作者只知道“继续写”“开第二卷”时，系统应先基于前文、伏笔、未解决冲突和节奏风险给出推进方向候选，再让作者选择或调整。

---

## 6. 产出期

### 6.1 目标

持续产出正文，并控制节奏与质量。

### 6.2 主对象

- scene
- draft
- task
- brief
- feedback_patch

### 6.3 主 intent family

- 场景族
- 正文族
- 改稿族
- 长跑族

### 6.4 典型产物

- scene drafts
- chapter drafts
- revised drafts
- long-run checkpoint artifacts

### 6.5 主风险

- 风格漂移
- 连续性漂移
- budget 爆炸
- 一口气写太多无法收拾

### 6.6 默认 UI 面

主工作台以对话 + progress / adoption / checkpoint cards 为主。

---

## 7. 维护期

### 7.1 目标

把产出期的文本推进沉淀成连续性权威层。

### 7.2 主对象

- chapter_summary
- state_snapshot
- timeline_event
- foreshadowing

### 7.3 主 intent family

- 维护族
- correction / review 相关行为

### 7.4 典型产物

- pending continuity artifacts
- accepted continuity layer updates

### 7.5 主风险

- 维护结果和正文事实不一致
- 伏笔误判
- 状态抽取过粗

### 7.6 默认 UI 面

adoption card、warning card、checkpoint card 变得高频。

---

## 8. 阅读与修订期

### 8.1 目标

以读者视角回看，并按需要做局部修正或结构回退。

### 8.2 主对象

- reading_projection_root / toc / chapter
- reader_recap
- accepted drafts
- recap objects
- revise targets

### 8.3 主 intent family

- 阅读族
- 改稿族
- correction

### 8.4 典型产物

- refreshed reading projection
- revised accepted drafts（经新一轮 adoption）
- 修订 brief / feedback patch

### 8.5 主风险

- 阅读面与创作层脱节
- 修订后未回刷 continuity
- 只修文本不修结构

### 8.6 默认 UI 面

阅读模式为主，必要时跳回主工作台或结构面板。

---

## 9. 阶段间的主转换

### 9.1 建立 -> 规划

触发条件通常包括：

- work seed 已成型
- 最小世界观与主线方向可用

### 9.2 规划 -> 产出

触发条件通常包括：

- 至少存在当前可写的 chapter / scene 目标

### 9.3 产出 -> 维护

通常在：

- scene / chapter draft 完成
- revise 完成

后自动或半自动触发。

### 9.4 维护 -> 阅读 / 修订

当相关 draft 和 continuity 层达到可读状态后，进入阅读投影刷新与审看。

### 9.5 阅读 / 修订 -> 规划 / 产出

如果阅读后发现：

- 结构问题 -> 回规划期
- 文本问题 -> 回产出 / 改稿期

---

## 10. 阶段不是硬锁

生命周期阶段是主导态，不是排他锁。

### 10.1 允许跨阶段动作

例如：

- 产出期也能改 brief
- 阅读期也能补人物
- 规划期也能试写一场

### 10.2 但要有主导态

系统仍需知道当前主要工作重心在哪。

否则：

- 上下文无法聚焦
- UI 无法合理推荐

---

## 11. 生命周期与长跑

### 11.1 长跑主要发生阶段

主要在：

- 产出期
- 部分规划期（批量拆分）
- 部分维护期（批量提炼）

### 11.2 产出期是长跑主战场

默认长跑多发生在：

- scene drafting
- chapter drafting
- rolling continuation

### 11.3 长跑与阶段切换

长跑结束后通常会引发：

- maintenance phase work
- reading projection refresh

---

## 12. 生命周期与 maintenance

maintenance 是主循环中不可跳过的一环。

### 12.1 产出后必须沉淀

如果只写不维护，生命周期会卡死在产出层。

### 12.2 维护不是“偶尔做”

对长篇连载来说，它是常规阶段性动作。

### 12.3 修订后也必须再维护

改稿不是只改文本，还要重新对齐连续性层。

---

## 13. 生命周期与阅读投影

阅读投影是产出与维护之后的消费层。

### 13.1 默认顺序

```text
产出
  -> 维护
  -> adoption
  -> reading projection refresh
```

### 13.2 不是每次产出都必须立刻进入阅读态

但系统必须能在需要时稳定切换过去。

### 13.3 阅读态的作用

阅读态不是彩蛋，而是帮助作者发现：

- 节奏问题
- 信息重复
- 情绪断裂
- 结构松散

---

## 14. 生命周期与对象主导关系

### 14.1 建立期主导对象

- work
- worldbuilding
- main_outline
- style_sample / preferences

### 14.2 规划期主导对象

- volume / arc
- chapter
- scene

### 14.3 产出期主导对象

- draft
- brief
- task

### 14.4 维护期主导对象

- chapter_summary
- snapshot
- foreshadowing
- timeline_event

### 14.5 阅读 / 修订期主导对象

- reading_projection_root / toc / chapter
- reader_recap
- accepted drafts
- revise targets

---

## 15. 生命周期与 intent 主导关系

### 15.1 建立期

主导 intent：

- 立项
- 世界观
- 主线
- 人物
- 风格

### 15.2 规划期

主导 intent：

- 分卷
- 章节
- 场景

### 15.3 产出期

主导 intent：

- 正文
- 改稿
- 长跑

### 15.4 维护期

主导 intent：

- 维护族
- correction

### 15.5 阅读 / 修订期

主导 intent：

- 阅读
- 改稿

---

## 16. 生命周期中的主风险

### 16.1 建立期风险

- 方向不清
- 风格锚点缺失

### 16.2 规划期风险

- 结构不稳
- 拆分失衡

### 16.3 产出期风险

- 风格漂移
- 连续性漂移
- budget 爆炸

### 16.4 维护期风险

- 提炼错误
- adoption 疲劳
- 冲突未处理

### 16.5 阅读 / 修订期风险

- 只修表面
- 修订后未回刷结构和连续性

---

## 17. 生命周期中的 UI 主表面

### 17.1 建立期

主表面：

- 对话
- 轻结构结果卡

### 17.2 规划期

主表面：

- 对话
- 结构面板开始频繁使用

### 17.3 产出期

主表面：

- 对话
- progress / checkpoint / adoption cards

### 17.4 维护期

主表面：

- adoption / warning / correction cards

### 17.5 阅读 / 修订期

主表面：

- 阅读模式
- 必要时回到工作台

---

## 18. 生命周期与推荐模式

虽然具体 UI 模式后面再设计，但生命周期必须能为 UI 提供“推荐工作模式”。

### 18.1 建立期

更偏对话引导。

### 18.2 规划期

更偏对话 + 结构抽屉。

### 18.3 产出期

更偏主工作台与长跑进度。

### 18.4 阅读 / 修订期

更偏阅读模式与修订跳转。

---

## 19. 生命周期中的回退机制

创作不是单向前进。

### 19.1 从规划回建立

当发现：

- 题材方向错
- 主线骨架不成立

### 19.2 从产出回规划

当发现：

- 当前章节推进不了
- scene 结构不成立

### 19.3 从阅读回产出 / 维护

当发现：

- 文本问题
- continuity 没跟上

### 19.4 回退不等于失败

这是正常创作流程的一部分。

---

## 20. 生命周期中的 done 判定

每个阶段都应有“足以进入下一阶段”的 done 标准，但不是绝对完美标准。

### 20.1 建立期 done

至少有：

- 可识别作品方向
- 最小世界观和主线成立

### 20.2 规划期 done

至少有：

- 当前可写的 chapter / scene 目标

### 20.3 产出期 done

至少有：

- accepted 或待审 draft 可进入维护 / 阅读

### 20.4 维护期 done

至少有：

- continuity artifacts 被处理到可继续写 / 可继续读

### 20.5 阅读 / 修订期 done

至少有：

- 当前阅读投影与 accepted source 对齐

---

## 21. 与 Foundation 的关系

生命周期是 Domain 流程，不是 Foundation 状态机。

### 21.1 依赖 Foundation

至少依赖：

- turn / task
- behaviors
- long-run
- adoption
- memory
- UX contract

### 21.2 不改写 Foundation

生命周期阶段不应直接改写：

- phase / status
- authority / budget
- render mode taxonomy

---

## 22. 后续 UI 设计的直接输入

这份文档会直接影响后续 UI 文档。

### 22.1 影响内容

至少包括：

- 主工作台默认焦点
- 结构面板默认内容
- 阅读模式切换入口
- 长跑进度卡与 adoption 卡频率
- 阶段推荐提示

### 22.2 `pencil` 原型必须覆盖

后续原型至少应覆盖：

- 建立期引导
- 规划期结构抽屉
- 产出期长跑
- 维护期 adoption review
- 阅读 / 修订期切换

---

## 23. 本文冻结的硬骨

本文正式冻结以下 authoring lifecycle 硬骨：

1. 生命周期至少包括：建立期 / 规划期 / 产出期 / 维护期 / 阅读与修订期
2. 生命周期是主导态，不是硬锁
3. 产出 -> 维护 -> adoption -> reading projection refresh 是默认主链
4. 长跑主要发生在产出期，也可少量出现在规划 / 维护期
5. 阅读 / 修订不是附属阶段，而是主循环的一部分
6. 回退到上个阶段是正常流程，不等于失败

---

## 24. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. 阶段提示文案
2. UI 上的阶段可视化形式
3. done 判定的自动化阈值
4. 某些混合阶段是否在 UI 上合并显示

---

## 25. 下一步

到这里，Domain 层的核心设计文档已经基本完整。

下一步更合理的是先做一次全局回顾，确认：

1. Foundation 是否还有缺口
2. Domain 是否还有缺口
3. 然后再进入 UI 设计文档与 `pencil` 原型阶段
