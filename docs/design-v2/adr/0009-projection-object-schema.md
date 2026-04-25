# ADR-0009：Reading Projection 对象最小字段集

- 状态：Accepted (2026-04-25)
- 日期：2026-04-25
- 涉及范围：Domain 子系统 27（Reading Projection）/ 子系统 22（Continuity Model）/ Foundation 子系统 1（Agent Foundation Contract）
- 相关文档：
  - `../27-reading-projection.md` §6 / §7 / §8 / §9 / §10 / §12 / §13 / §23
  - `../22-continuity-model.md` §10 / §20.1 / §25
  - `../30-contract-glossary.md` §2.3 / §8.3
  - `adr/0004-volume-arc-relation.md` §决策内容 §2 §5
  - `../29-design-integrity-review.md` §5.3.3 / §5.3.9 / §7.1 第 10 条
- 取代：无
- 取代者：无

---

## 背景

`27-reading-projection.md` §23 已冻结 7 条 reading projection 硬骨，其中第 4 条明确了 4 个基础投影对象的命名（`reading_projection_root / toc / chapter / reader_recap`），第 5 条明确 `reader_recap` 与 `chapter_summary` 不是同一个对象，第 6 条明确投影刷新必须由系统显式管理。

然而，`27 §24` 第 1 条显式声明"projection object 的最终字段 schema"暂不冻结，`29-design-integrity-review.md` §5.3.9 将其列为中风险未决项，§7.1 第 10 条将其列为 UI 前必须冻结的阻塞项。

`30-contract-glossary.md` §8.3 已命名 4 个投影对象族，§2.3 已冻结 `source_revision_refs` 为派生投影的 canonical revision 字段。`adr/0004-volume-arc-relation.md` 已冻结 `volume -> arc -> chapter -> scene` 层级，并明确 reading projection TOC 以 accepted volume ordering 为一级来源，arc 仅作为卷内可选分组。

W10 的任务是把这些前置约定收口成 4 个对象各自的最小字段集，使阅读模式 UI 不再猜"这个投影对象到底有哪些字段"。

---

## 考虑过的方案

### 方案 A：只冻结对象命名，不冻结字段

优点：改动最小，保留实现自由度。

缺点：与 `29 §7.1` 第 10 条"阅读模式 UI 前必须冻结"的阻塞判断直接冲突；UI 仍无法稳定消费投影对象；`source_revision_refs` 的挂载位置仍不确定，导致 stale 检测无法实现。

### 方案 B：冻结 4 个对象各自的最小字段集，不冻结 refresh 状态机与 aggregate summary schema

优点：
- 闭合 `29 §7.1` 第 10 条阻塞项。
- 保留 ADR-0011（W11）冻结 projection refresh 状态机的空间。
- 保留 `29 §5.3.3` 已显式 defer 的 aggregate summary schema 的演化空间。
- 明确 `reader_recap` 与 `chapter_summary` 的边界，防止 UI 混用。
- 明确 `source_revision_refs` 挂载位置，使 stale 检测有稳定锚点。

缺点：需要明确多个边界声明，避免字段表被误读为完整 schema。

### 方案 C：冻结完整 JSON Schema，包含 refresh 状态机与所有子类型

优点：最严格，实现最少猜测。

缺点：过早绑定 projection refresh 触发语义（W11 范围）、aggregate summary schema（`29 §5.3.3` 显式 defer）、UI 渲染细节；会把 W11 与 UI 原型阶段内容提前塞进 W10。

---

## 最终决策

选择 **方案 B：冻结 4 个对象各自的最小字段集，不冻结 refresh 状态机与 aggregate summary schema**。

本 ADR 冻结：

1. `reading_projection_root` 最小字段集。
2. `reading_projection_toc` 最小字段集（volume-first，arc 为 optional secondary group）。
3. `reading_projection_chapter` 最小字段集。
4. `reader_recap` 最小字段集。
5. 每个对象的 `source_revision_refs` 挂载位置（$ref `30 §2.3`，不重定义）。
6. `reader_recap` 与 `chapter_summary` 的边界声明。
7. `reader_recap` 与 aggregate summary 的边界声明。

本 ADR 显式不冻结（deferred）：

1. **projection refresh 的状态与触发语义**：留给 ADR-0011 / W11。`27 §12` 已给出方向，但触发条件、stale 自动/手动策略、`FRESH / STALE / REBUILDING / FAILED` 状态机的完整语义由 W11 收口。
2. **tentative vs accepted 投影策略**：已在 `27` 现有契约中定义原则，不在本 ADR 重复冻结。
3. **aggregate summary 本体 schema**：`29 §5.3.3` 已显式 defer；本 ADR 只管 `reader_recap`，不定义 aggregate summary 的最终格式。
4. **目录 UI 渲染细节**：字体、颜色、展开/折叠交互、分页策略等属于 UI 层，不在本 ADR 冻结。

---

## 决策内容

### 1. `reading_projection_root` 最小字段集

`reading_projection_root` 表示某作品在某一时刻的阅读投影根对象。它是阅读面的入口，回答"这个阅读面属于哪部作品、基于哪些 accepted source revisions 构建、当前投影状态是什么"。

来源依据：`27 §7.1` / `27 §7.2` / `30 §2.3`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projection_id` | string | 是 | 投影根实例 id；用于 stale 检测、diff、测试定位 |
| `work_id` | string | 是 | 所属作品 id；$ref `21-novel-object-model.md` work 对象（本 ADR 将 `27 §7.2` 字段方向中的 `work_ref` 规范化为 `work_id`，对齐 Domain 命名惯例） |
| `toc_ref` | string | 是 | 指向对应 `reading_projection_toc` 实例 id |
| `status` | enum | 是 | 投影状态；最小取值方向见 `27 §13.1`；完整状态机由 ADR-0011 冻结 |
| `projected_at` | string (ISO 8601) | 是 | 本次投影生成时间戳（本 ADR 将 `27 §7.2` 字段方向中的 `generated_at` 规范化为 `projected_at`，与本对象语义"投影实例化"对齐） |
| `source_revision_refs` | object | 是 | 本投影基于哪些 accepted / authoritative source revisions 生成；$ref `30 §2.3`，不重定义；至少覆盖 accepted draft revisions、accepted chapter ordering revision、accepted volume ordering revision、accepted title/heading revisions |

约束：

1. `source_revision_refs` 字段名不得改写；canonical 定义在 `30 §2.3`。
2. `status` 最小取值集合（`FRESH / STALE / REBUILDING / FAILED`）的完整语义由 ADR-0011 冻结；本 ADR 只冻结字段位置。
3. `toc_ref` 必须能定位对应 `reading_projection_toc` 实例；不得只依赖 `work_id` 隐式推断。

---

### 2. `reading_projection_toc` 最小字段集

`reading_projection_toc` 表示阅读目录视图，不是创作结构编辑对象。它回答"这部作品当前可阅读的卷与章是什么、顺序如何"。

来源依据：`27 §8` / `adr/0004 §决策内容 §2 §5` / `30 §8.3`。

> ADR-0004 已冻结：reading projection TOC 以 accepted volume ordering 为一级来源，arc 仅作为卷内可选分组 metadata / secondary view，不得替代 volume 作为一级 projection source。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `toc_id` | string | 是 | TOC 实例 id |
| `work_id` | string | 是 | 所属作品 id |
| `volumes` | `volume_entry[]` | 是 | 按 accepted volume ordering 排列的卷列表；每个 entry 至少含 `volume_id`、`title`、`volume_order`、`chapter_refs[]` |
| `chapters` | `chapter_entry[]` | 是 | 按 accepted chapter ordering 排列的章列表；每个 entry 至少含 `chapter_id`、`title`、`chapter_order`、`volume_id`、`projection_status` |
| `source_revision_refs` | object | 是 | 本 TOC 基于哪些 accepted source revisions 生成；$ref `30 §2.3` |

`volume_entry` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `volume_id` | string | 是 | 卷 id |
| `title` | string | 是 | 卷标题 |
| `volume_order` | integer | 是 | 卷排序；来源于 accepted volume ordering |
| `chapter_refs` | string[] | 是 | 本卷下的章 id 列表，按 accepted chapter ordering |
| `arc_groups` | `arc_group[]` | 否 | 卷内 arc 分组；仅作为 secondary view，不得替代 volume 作为一级 TOC authority |

`chapter_entry` 最小字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `chapter_id` | string | 是 | 章 id |
| `title` | string | 是 | 章标题 |
| `chapter_order` | integer | 是 | 章排序；来源于 accepted chapter ordering |
| `volume_id` | string | 是 | 所属卷 id；$ref ADR-0004 `chapter.volume_id` 必填规则 |
| `projection_status` | enum | 是 | 该章在阅读面的状态；最小取值：`readable` / `hidden` / `not_yet_projected` |

约束：

1. `arc` 不得出现在 TOC 的一级层级；`arc_groups` 是 `volume_entry` 的可选 secondary 字段。
2. `chapter_order` 是最终阅读顺序权威；`arc_order` 不得覆盖 `chapter_order`（$ref ADR-0004 §2 排序规则第 4 条）。
3. `source_revision_refs` 字段名不得改写；canonical 定义在 `30 §2.3`。

---

### 3. `reading_projection_chapter` 最小字段集

`reading_projection_chapter` 表示章级阅读内容视图。它回答"这一章的阅读面正文是什么、来源于哪些 accepted drafts"。

来源依据：`27 §9` / `30 §2.3`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `chapter_projection_id` | string | 是 | 章投影实例 id |
| `chapter_id` | string | 是 | 对应源 chapter 对象 id |
| `volume_id` | string | 是 | 所属卷 id；$ref ADR-0004 `chapter.volume_id` 必填规则 |
| `title` | string | 是 | 章标题；来源于 accepted chapter metadata |
| `body_refs` | string[] | 是 | 构成本章阅读正文的 accepted draft id 列表；按 scene_ordering 排列 |
| `scene_ordering` | integer[] | 是 | 对应 `body_refs` 的场景排序序列；来源于 accepted scene ordering |
| `recap_ref` | string/null | 否 | 指向对应 `reader_recap` 实例 id；可为 null（无 recap 时） |
| `source_revision_refs` | object | 是 | 本章投影基于哪些 accepted source revisions 生成；$ref `30 §2.3` |

约束：

1. `body_refs` 只能引用 accepted draft；tentative draft 不得进入 `body_refs`（$ref `27 §11.1`）。
2. `chapter_summary` 不得作为本对象的字段；`chapter_summary` 是独立连续性对象，canonical 定义在 `22-continuity-model.md §10`，禁止在本 ADR 重定义为 `reading_projection_chapter.summary` 字段（$ref `22 §25` 第 6 条）。
3. `recap_ref` 是可选引用，不是 inline 内容；`reader_recap` 的字段由本 ADR §4 独立定义。
4. `source_revision_refs` 字段名不得改写；canonical 定义在 `30 §2.3`。

---

### 4. `reader_recap` 最小字段集

`reader_recap` 是面向阅读的辅助对象，帮助读者回顾上一章、进入新卷前快速找回上下文、长篇连载下的断点续读。

来源依据：`27 §10` / `27 §23` 第 5 条 / `22 §10` / `30 §2.3`。

> **边界声明 1（reader_recap ≠ chapter_summary）**：`reader_recap` 偏阅读辅助 / 读者可见；`chapter_summary` 偏连续性 / memory / 工作流，是独立连续性对象（$ref `22 §10`、`22 §25` 第 6 条）。本 ADR 不重定义 `chapter_summary`，不把 `chapter_summary` 内容 inline 到 `reader_recap` 字段表。`reader_recap` 可以以 `chapter_summary` 为来源之一，但二者不是同一个对象（$ref `27 §23` 第 5 条）。

> **边界声明 2（reader_recap ≠ aggregate summary）**：本 ADR 只管 `reader_recap`。aggregate summary 的本体 schema 已在 `29 §5.3.3` 显式 defer，不在本 ADR 冻结。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `recap_id` | string | 是 | recap 实例 id |
| `scope` | enum | 是 | recap 覆盖范围；最小取值：`chapter` / `volume` / `global` |
| `scope_ref` | string | 是 | 对应 scope 的源对象 id（chapter_id / volume_id / work_id） |
| `recap_text` | string | 是 | 面向读者的回顾文本；由系统生成或作者确认；不得 inline `chapter_summary` 原文 |
| `source_revision_refs` | object | 是 | 本 recap 基于哪些 accepted source revisions 生成；$ref `30 §2.3` |
| `generated_at` | string (ISO 8601) | 是 | recap 生成时间戳 |

约束：

1. `recap_text` 是面向读者的阅读辅助文本，不是 `chapter_summary` 的直接复制；二者来源边界由 `27 §10.3` 定义。
2. `source_revision_refs` 字段名不得改写；canonical 定义在 `30 §2.3`。
3. `reader_recap` 不得包含 `chapter_summary` 的字段（如 `fidelity_level`、`revision_base` 等连续性字段）；这些字段属于 `chapter_summary` 对象，不属于 `reader_recap`。
4. recap 来源边界测试（$ref `27 §606-611`）：`reader_recap` 与 `chapter_summary` 不混淆；recap 来源边界正确。

---

### 5. 对象间关系

```text
reading_projection_root
  -> toc_ref -> reading_projection_toc
                  -> volumes[] -> volume_entry
                                    -> chapter_refs[] -> reading_projection_chapter
                  -> chapters[] -> chapter_entry
                                     -> chapter_id -> reading_projection_chapter
reading_projection_chapter
  -> recap_ref (optional) -> reader_recap
```

所有对象均通过 `source_revision_refs` 追踪其 accepted source revisions，使 stale 检测有稳定锚点（$ref `27 §12.3`）。

---

## 决策原因

1. **闭合 `29 §7.1` 第 10 条阻塞项**：projection object schema 是阅读模式 UI 前必须冻结的阻塞项；不给出字段集，UI 无法稳定消费投影对象。

2. **`source_revision_refs` 挂载位置必须明确**：`30 §2.3` 已冻结 canonical 字段名，但未指定挂载到哪些对象；本 ADR 明确 4 个对象均挂载 `source_revision_refs`，使 stale 检测（`27 §12.3`）有稳定锚点。

3. **`reader_recap` 与 `chapter_summary` 边界必须显式声明**：`27 §23` 第 5 条已冻结"二者不是同一个对象"，但未给出字段级边界；本 ADR 通过字段表和约束条款把边界落实到 schema 层，防止 UI 或实现层混用。

4. **TOC 一级层级必须 volume-first**：ADR-0004 已冻结 volume-first TOC 语义；本 ADR 在字段表中落实：`arc` 只能出现在 `volume_entry.arc_groups`（optional），不得出现在 TOC 一级层级。

5. **不冻结 refresh 状态机与 aggregate summary**：projection refresh 触发语义（W11）和 aggregate summary schema（`29 §5.3.3` defer）的演化空间必须保留；本 ADR 只冻结字段位置，不冻结完整状态机语义。

---

## 影响

### 对 Foundation 的影响

- 无新增 Foundation 公共字段；`source_revision_refs` 已在 `30 §2.3` 冻结，本 ADR 只引用不重定义。

### 对 Domain 的影响

- `27-reading-projection.md` §6 / §7 / §8 / §9 / §10：相关章节应标注"最小字段集由 ADR-0009 冻结"，并移除"最终字段 schema 暂不冻结"的表述。
- `22-continuity-model.md` §10 / §20.1：应标注"`reader_recap` 与 `chapter_summary` 的字段边界由 ADR-0009 显式分离；`chapter_summary` 不得被 inline 到 `reader_recap`"。
- `reading_projection_chapter` 明确不含 `chapter_summary` 字段，防止实现层把 `chapter.summary` 当作 `chapter_summary` 对象的替代。

### 对 UI 的影响

- UI 可依赖 4 个投影对象的最小字段集进行阅读模式渲染、stale 提示与 refresh CTA。
- UI 仍保留布局、视觉层级、copy 本地化与组件实现自由。
- `reading_projection_toc` 的 `arc_groups` 是 optional secondary view；UI 可选择是否渲染 arc 分组，但不得把 arc 作为 TOC 一级导航。

### 回写目标

以下文档已在本 ADR Accepted 后回写：

1. `00-overview.md` §7：新增 D2-026 条目，标注"reading projection 4 对象最小字段集由 ADR-0009 冻结"。
2. `30-contract-glossary.md` §10：新增条目，标注"reading projection 4 对象字段集由 ADR-0009 冻结；`source_revision_refs` 挂载位置见 ADR-0009 §1~§4"。
3. `30-contract-glossary.md` §2.3：将 `source_revision_refs` 适用对象列表从 3 个（reading projection root / reader recap / aggregate summaries）扩展到 4 个，新增 `reading_projection_toc` 与 `reading_projection_chapter`，对齐 ADR-0009 全 4 对象挂载策略。
3. `0000-index.md` §2.1：新增 ADR-0009 行。
4. `29-design-integrity-review.md` §7.1 第 10 条：标注 ✅ 已由 ADR-0009 冻结（Accepted 2026-04-25）。
5. `27-reading-projection.md` §6 / §7 / §8 / §9 / §10：标注最小字段集由 ADR-0009 冻结；`reader_recap` 与 `chapter_summary` 边界由 ADR-0009 显式分离。
6. `22-continuity-model.md` §10 / §20.1：标注 `chapter_summary` 不得被 inline 到 `reader_recap`；边界由 ADR-0009 显式分离。

---

## 后续工作

### 必须更新的文档

见"影响 → 回写目标"清单（共 6 项）。

### 必须补的契约测试

1. `reading_projection_root` 必须包含 `projection_id` / `work_id` / `toc_ref` / `status` / `projected_at` / `source_revision_refs`。
2. `reading_projection_toc` 的 `volumes[]` 必须按 accepted volume ordering 排列；`arc` 不得出现在 TOC 一级层级。
3. `reading_projection_toc` 的 `chapter_entry.chapter_order` 不得被 `arc_order` 覆盖（$ref ADR-0004 §2 第 4 条）。
4. `reading_projection_chapter.body_refs` 只能引用 accepted draft；tentative draft 不得进入。
5. `reading_projection_chapter` 不得包含 `chapter_summary` 字段或其内容 inline。
6. `reader_recap.recap_text` 不得直接复制 `chapter_summary` 原文；二者来源边界可测试（$ref `27 §606-611`）。
7. 所有 4 个对象均必须包含 `source_revision_refs`；字段名不得改写。
8. `reader_recap.scope` 取值必须在 `chapter` / `volume` / `global` 范围内。

### 依赖 ADR

- ADR-0004（W6，Volume / Arc 关系）：本 ADR 的 TOC 字段设计消费 ADR-0004 的 volume-first 决议。
- ADR-0001（W1，TurnResult v2 顶层 schema）：reading projection 对象通过 adoption / projection refresh 回到 TurnResult 链路。
- ADR-0011（W11，projection refresh 状态与触发语义）：本 ADR 的 `status` 字段位置已冻结，完整状态机语义由 ADR-0011 冻结。

---

## 引用源行号清单

| 源文档 | 行号 / 章节 | 引用内容 |
| --- | --- | --- |
| `27-reading-projection.md` | 615-626 | 7 条 reading projection 硬骨（第 4 条 4 对象命名、第 5 条 reader_recap ≠ chapter_summary、第 6 条 refresh 由系统显式管理） |
| `27-reading-projection.md` | 606-611 | recap tests（reader_recap 与 chapter_summary 不混淆；recap 来源边界正确） |
| `27-reading-projection.md` | 162-187 | reading_projection_root 最小字段方向 |
| `27-reading-projection.md` | 190-217 | reading_projection_toc 来源与默认内容 |
| `27-reading-projection.md` | 220-248 | reading_projection_chapter 来源与章级组成 |
| `27-reading-projection.md` | 251-276 | reader_recap 作用与与 chapter_summary 的区别 |
| `30-contract-glossary.md` | §2.3（54-68 行） | source_revision_refs canonical 字段定义 |
| `30-contract-glossary.md` | §8.3（296-303 行） | 4 对象命名条款 |
| `adr/0004-volume-arc-relation.md` | §决策内容 §2（166-172 行） | 排序规则；arc_order 不得覆盖 chapter_order |
| `adr/0004-volume-arc-relation.md` | §决策内容 §5（190-195 行） | reading projection TOC 以 volume ordering 为主；arc 为卷内分组 |
| `22-continuity-model.md` | §10（336-372 行） | chapter_summary 独立 object 定义 |
| `22-continuity-model.md` | §25 第 6 条（775 行） | chapter_summary 是独立连续性对象，不是 chapter 偷塞一个 summary 字段 |
| `22-continuity-model.md` | §20.1（649-651 行） | chapter ≠ chapter_summary 边界 |
| `29-design-integrity-review.md` | §5.3.3（269-282 行） | aggregate summary deferred 状态 |
| `29-design-integrity-review.md` | §5.3.9（363-377 行） | projection object schema 未收口，阅读模式 UI 前必须冻结 |
| `29-design-integrity-review.md` | §7.1 第 10 条（458 行） | reading_projection_root / toc / chapter / reader_recap 最小字段集为阻塞项 |
