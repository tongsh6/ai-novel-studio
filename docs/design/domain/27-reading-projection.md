# Reading Projection v2

> 状态：草案
>
> 角色：`docs/design/domain/20-novel-domain-overview.md` 中阅读层的展开文档，并依赖 `docs/design/07-workbench-ui-contract.md`、`docs/design/domain/21-novel-object-model.md`、`docs/design/domain/22-continuity-model.md`、`docs/design/domain/25-maintenance-hooks.md`、`docs/design/domain/26-context-assembly-policy.md`。
>
> 目标：定义 v2 中阅读投影的来源边界、投影规则、刷新条件、recap 对象、tentative 排除原则，以及阅读模式与创作模式之间的稳定接口。

---

## 1. 文档定位

本文回答 8 个问题：

1. 什么是阅读投影
2. 阅读投影和正文源对象是什么关系
3. 哪些对象能进入阅读面，哪些不能
4. 阅读投影如何组织卷、章、正文与 recap
5. 阅读投影什么时候刷新
6. tentative / pending adoption 为什么不能默认进入阅读面
7. 阅读模式与结构面、主工作台的边界是什么
8. UI 和后续 `pencil` 原型必须依赖哪些稳定语义

本文不负责：

- 页面视觉设计
- 阅读器具体排版细节
- 搜索、批注等高级阅读功能

本文只冻结阅读投影 contract。

---

## 2. 为什么需要阅读投影

如果系统只有创作对象，没有阅读投影，产品会退化成：

- 会写字的策划工具
- 对话驱动的结构编辑器

但不是一个真正可阅读、可审看、可复盘作品成品的写作工作台。

阅读投影的作用是：

1. 把被采纳的创作结果投影成稳定成品层
2. 让作者能以“读者视角”回看作品
3. 为 recap、目录、章节浏览提供清晰目标层
4. 把创作中的 tentative 噪音隔离在工作流之外

---

## 3. 阅读投影的定义

`reading_projection` 是：

**由已采纳的结构对象和已采纳的正文对象派生出的阅读层表示。**

它不是：

- draft 本身
- 一条 assistant message
- 结构面板的另一种显示方式

它是成品视角下的投影层。

---

## 4. 核心原则

### 4.1 accepted-first

阅读投影默认只消费 accepted / authoritative 源。

### 4.2 投影不是源对象

阅读投影是派生层，不是新的创作权威源。

### 4.3 目录与正文分离

阅读投影至少应区分：

- 结构目录层
- 正文内容层

### 4.4 recap 是阅读辅助，不是正文正文

recap 可以帮助阅读，但不应混成章正文的一部分。

---

## 5. 投影来源

### 5.1 可进入阅读投影的核心来源

> ADR-0004 已冻结 reading projection 的中观结构前提：TOC 以 accepted volume ordering 为一级来源，arc 仅作为卷内分组 metadata / secondary view。

至少包括：

- accepted volume ordering
- accepted chapter ordering
- accepted drafts
- accepted titles / headings

### 5.2 可选进入阅读投影的辅助来源

按 policy 允许：

- accepted chapter summaries
- reader-facing recap artifacts
- accepted scene breaks / markers

### 5.3 默认不得进入阅读投影的来源

至少包括：

- tentative drafts
- pending adoption artifacts
- raw maintenance artifacts
- open clarification / confirmation
- debug traces
- provider raw output

---

## 6. 阅读投影对象

阅读投影建议至少拆为 4 类对象：

1. `reading_projection_root`
2. `reading_projection_toc`
3. `reading_projection_chapter`
4. `reader_recap`

### 6.1 `reading_projection_root`

表示某作品在某一时刻的阅读投影根对象。

### 6.2 `reading_projection_toc`

表示目录结构视图。

### 6.3 `reading_projection_chapter`

表示章级阅读视图对象。

### 6.4 `reader_recap`

表示面向阅读的回顾文本对象。

---

## 7. reading_projection_root

### 7.1 作用

用于表达：

- 投影属于哪部作品
- 投影基于哪一批 accepted 源
- 当前版本是什么

### 7.2 最小字段方向

至少包括：

- `projection_id`
- `work_ref`
- `source_revision_refs`
- `status`
- `generated_at`
- `toc_ref`

### 7.3 `source_revision_refs`

很关键。

它回答：

**“这个阅读面到底是基于哪些 accepted source revisions 构建的？”**

至少应能覆盖：

- accepted draft revisions
- accepted chapter ordering revision
- accepted volume ordering revision
- accepted title / heading revisions

---

## 8. reading_projection_toc

### 8.1 作用

用于表达阅读目录，而不是创作结构编辑对象。

### 8.2 来源

> ADR-0004 已冻结 volume-first TOC 语义；arc ordering 不得覆盖 accepted chapter ordering。

主要来自：

- accepted volume ordering
- accepted chapter ordering

### 8.3 与结构面板的区别

- 结构面板：可查看创作层和工作层信息
- 阅读目录：只关注读者视角的可阅读结构

### 8.4 默认内容

至少包括：

- volume list（如有）
- chapter list
- chapter status（readable / hidden / not yet projected）

---

## 9. reading_projection_chapter

### 9.1 作用

表达章级阅读内容。

### 9.2 来源

主要来源于：

- accepted draft
- accepted chapter metadata

### 9.3 不应直接来源于

不应直接来自：

- chapter object 自带字段拼接
- pending revised draft

### 9.4 章级组成

建议至少包括：

- title
- body
- optional recap ref
- projection metadata

---

## 10. reader_recap

`reader_recap` 是面向阅读的辅助对象。

### 10.1 作用

用于帮助：

- 回顾上一章
- 进入新卷前快速找回上下文
- 长篇连载下的断点续读

### 10.2 来源

通常来源于：

- accepted chapter_summary
- reader-facing recap generation

### 10.3 与 chapter_summary 的区别

- `chapter_summary`：偏连续性 / memory / 工作流
- `reader_recap`：偏阅读辅助 / 读者可见

不能混为一谈。字段集合的边界由 ADR-0009 §4 显式分离：`reader_recap` 不得 inline `chapter_summary` 字段（如 `fidelity_level` / `revision_base`）；`recap_text` 不得直接复制 `chapter_summary` 原文。

---

## 11. accepted 边界

### 11.1 默认规则

只有 accepted 或 authoritative 的创作结果，才应进入阅读投影主路径。

### 11.2 典型 accepted 源

至少包括：

- accepted draft
- accepted chapter ordering
- accepted chapter title

### 11.3 tentative 默认排除

tentative 结果只在以下场景才可进入：

- 明确的“预览未采纳版本”
- 对比模式
- debug / review 模式

### 11.4 默认阅读模式不是预览模式

这一点必须清楚。

用户进入阅读模式时，默认看到的是“当前成品层”，不是“工作草稿池”。

---

## 12. 刷新策略

阅读投影不是每次对话都必须重算，但也不能永远落后。

### 12.1 触发刷新

至少包括：

- draft adoption
- chapter ordering adoption
- title update adoption
- explicit refresh intent

### 12.2 可延迟刷新

如果系统采用惰性刷新策略，至少要能表达：

- projection stale
- refresh recommended

### 12.3 不应由 UI 猜刷新时机

UI 不应自己比较几个字段决定阅读面是否过期。

必须由系统显式告知：

- current projection status
- source revision refs

---

## 13. 投影状态

阅读投影本身也应有状态。

### 13.1 推荐状态

至少支持：

- `FRESH`
- `STALE`
- `REBUILDING`
- `FAILED`

### 13.2 含义

- `FRESH`
  - 与当前 accepted source 对齐

- `STALE`
  - accepted source 已变，投影未刷新

- `REBUILDING`
  - 正在刷新投影

- `FAILED`
  - 刷新失败

### 13.3 UI 要求

UI 至少要能区分：

- 这章现在可读
- 这章是旧投影
- 这章刷新失败

---

## 14. 与结构对象的关系

### 14.1 chapter / volume 仍是源

> ADR-0004 已冻结 `volume -> arc -> chapter -> scene` 的源对象关系；reading projection 不替代 volume / arc 源对象。

阅读投影不替代 chapter / volume 对象本身。

### 14.2 结构对象变更不会自动等于投影变更

它们要经过：

- adoption
- projection refresh

### 14.3 目录与创作树的边界

创作树可能包含：

- backlog
- draft-only nodes
- tentative scene plans

阅读目录通常不应暴露这些。

---

## 15. 与 continuous recap 的关系

长篇阅读通常需要 recap。

### 15.1 recap 来源优先级

推荐优先级：

1. accepted reader_recap
2. accepted chapter_summary 的 reader-facing 投影
3. 即时生成的只读 recap（作为降级）

### 15.2 recap 不应污染正文

recap 只应作为辅助层，而不是直接拼进章正文 body。

### 15.3 recap 也要有边界

默认 recap 应受：

- accepted continuity layer
- reading projection source revision refs

约束。

---

## 16. 与 context assembly 的关系

Reader 上下文应尽量干净。

### 16.1 Reader 默认读取

至少包括：

- accepted projection root
- selected chapter projection
- accepted recap

### 16.2 Reader 默认排除

至少包括：

- open tasks
- pending adoption
- raw maintenance artifacts
- active feedback patches

### 16.3 预览模式例外

如果未来支持“预览未采纳稿”，那应作为显式模式，而不是默认 reader contract。

---

## 17. 与 maintenance 的关系

maintenance 不直接生成阅读投影，但它会生成阅读投影的重要辅助源。

### 17.1 maintenance 对阅读投影的间接支持

至少包括：

- chapter_summary
- reader recap source
- timeline recap source

### 17.2 维护结果必须先经过 accepted 边界

否则 reader 会看到未经确认的 recap 和状态理解。

---

## 18. 与 UX Contract 的关系

阅读投影最终会进入 `read_projection` render mode。

### 18.1 主要 render mode

默认应使用：

- `read_projection`

### 18.2 常见 card

阅读模式中常见的 card 辅助对象可能包括：

- `replay_card`（高级）
- `warning_card`（投影 stale / failed）
- `result_card`（reader recap）

### 18.3 阅读模式不是调试面

默认阅读模式不应暴露：

- debug refs
- raw trace
- provider info

---

## 19. 与 long-run 的关系

long-run 主要产出 draft，不直接产出最终阅读投影。

### 19.1 long-run -> adoption -> projection

默认路径应是：

```text
long-run draft artifacts
  -> adoption
  -> accepted drafts
  -> projection refresh
```

### 19.2 checkpoint 不等于可读成品

checkpoint 时的 tentative 不应自动进入阅读面。

### 19.3 预览例外

如果支持“边写边看预览”，也应作为显式 preview path，不应污染默认阅读层。

---

## 20. 与 UI 的接口

阅读投影是后续阅读模式设计的直接输入。

### 20.1 UI 必须可见的内容

至少包括：

- 目录
- 章正文
- 投影状态（fresh / stale / rebuilding / failed）
- recap 可用性

### 20.2 UI 可选显示的内容

例如：

- 上一章 recap
- 卷级 recap
- 仅阅读模式下的导航辅助

### 20.3 UI 不应直接决定

例如：

- 哪个 draft 是当前可读版本
- stale 时是否自动刷新

这些应由投影 contract 明确给出。

---

## 21. 持久化与事件要求

至少要持久化或可引用：

- projection root
- projection chapter refs
- TOC snapshot
- reader recap refs
- source revision refs

### 21.1 最小事件集合

至少包括：

- projection_built
- projection_refreshed
- projection_marked_stale
- projection_failed
- recap_generated

---

## 22. 契约测试要求

### 22.1 source boundary tests

验证：

- tentative source 默认不进阅读投影
- accepted source 能进入阅读投影

### 22.2 refresh tests

验证：

- adoption 后投影可刷新
- stale 标记正确

### 22.3 reader cleanliness tests

验证：

- reader 默认不带调试信息
- reader 默认不带 open-task 信息

### 22.4 recap tests

验证：

- reader_recap 与 chapter_summary 不混淆
- recap 来源边界正确

---

## 23. 本文冻结的硬骨

本文正式冻结以下 reading projection 硬骨：

1. 阅读投影是由 accepted source 派生出的成品层
2. 阅读投影不是创作源对象
3. 默认阅读模式只消费 authoritative / accepted 源
4. `reading_projection_root / toc / chapter / reader_recap` 是建议的基础投影对象分层
5. `reader_recap` 与 `chapter_summary` 不是同一个对象
6. 投影刷新必须由系统显式管理，UI 不应自己猜
7. 默认阅读模式不是 tentative 预览模式

---

## 24. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. projection object 的最终字段 schema（最小字段集已由 ADR-0009 冻结）
2. recap 的最终生成策略
3. stale 自动刷新还是手动刷新的产品默认策略（refresh 四态与最小触发语义已由 ADR-0011 冻结）
4. 未来预览模式的具体交互

---

## 25. 下一步

阅读投影之后，最自然的是：

1. `28-authoring-lifecycle.md`

这样 Domain 层最后一份总流程文档就能把立项、规划、产出、维护、阅读全部串起来。
