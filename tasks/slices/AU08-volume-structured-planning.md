# AU08-volume-structured-planning：卷结构的规划层结构化生产

**状态**：doing（2026-07-29 开工）
**来源**：Order 8 排查 R1 组首位候选（`docs/design/notes/2026-07-29-container-utilization-survey.md`
§5），用户拍板顺序中的第 ①。收编既有 B11「章全挂第一卷」缺陷与 NEM-GAP-07。

## 0. 现状（Order 8 已坐实）

`volumes` 表三库均 1 行、title 恒「第一卷」、105 章全挂其下。断链在三处，
消费侧**部分就绪**：

| 环节 | 现状 | 位置 |
|---|---|---|
| prompt | 只在骨架段给「预计卷数：N」作背景，**输出格式无卷槽位** | `real.ex:148-177` plot_outline 分支 |
| parser | **无卷概念**，只产扁平章列表 | `chapter_plan_parser.ex:46 parse/1` |
| 物化 | `find_or_create_volume(repo, work_id)` **不接受卷参数**，取不到就建默认卷；两个调用点都只传 work_id | `adoption_repository.ex:609/413/507` |
| 投影 | **已按卷分组**（`volume_with_chapters` 建嵌套结构） | `reading_projection_repo.ex:255` |
| 前端 | **把分组扔掉**：`toc.volumes.flatMap(v => v.chapters)` 两处 | `ReadingMode.tsx:44`、`StructurePanel.tsx:487` |

代码注释自陈根因：「计划是扁平章列表，无卷分组…故用单一默认卷承载」。

## 1. 先解决的隐患：`chapter.seq` 口径（本 slice 的核心不变量）

**`next_chapter_seq(repo, volume_id)` 按卷取 max**（`adoption_repository.ex:683`），
但至少三处消费者**跨全书按 `c.seq` 排序**：

- `ledger_repository.ex:98 accepted_summaries_by_seq/1` —— 五本账维护、R7 末 5 章窗、
  进度计算全靠它
- `reading_projection_repo.ex:185` —— 章列表排序
- `prose_search_repo.ex:129` —— 检索排序

**今天不出事，只因为恰好只有一卷**（m4 实测：105 章 / 105 个 distinct seq / 1 卷）。
一旦建出第二卷，卷二第 1 章的 seq=1 会与卷一第 1 章撞号，上述三处**静默乱序**——
账本会把两章当同一位置、R7 的「末 5 章」会取错窗、检索顺序会错乱。**这是引入多卷
必然踩到的雷，且症状是静默的**，所以必须先拆。

**裁决：`chapter.seq` 收为 work 级全局**，卷序由 `volume.seq` 承担。

理由：书里的章号本来就是全局的（M4 标题实测全是「第12章：…」而非「卷二第2章」），
全局 seq 与产品自身的编号语义一致；且这样三处全局消费者零改动，不变量不破。
反向方案（保持卷内 seq + 所有消费者改按 `(volume.seq, chapter.seq)` 排序）要动
账本/R7/检索/投影四条链，代价远高且每条都是新的出错面。

## 2. 七问

1. **Contract**：消费 VS-00G CP3 冻结的 `works.planned_volumes`（全书规划字段，
   已由 CP4d 落地回写）作为卷分组锚；固化「章计划可携带卷归属」这一规划产出契约，
   与 `narrative_role`（character_seed）、`skeleton_field`（work_skeleton_suggestion）
   同款——**artifact item 上的结构化槽位**，不新增 artifact 家族。
2. **Invariant**：①`chapter.seq` 在 work 内全局唯一且单调（本 slice 新立，机器可测）；
   ②卷归属只经作者采纳进入（ADR-0019 INV-1 不破，卷不是新权威层）；
   ③无卷信息时退化为单卷，与今天行为逐字节一致（存量作品零影响）。
3. **Boundary**：`novel_agent`（plot_outline prompt 输出格式）→ `novel_persistence`
   （parser + 物化 + seq 口径）→ `frontend`（目录分层渲染）。
   **明确不改**：`novel_domain` 五本账与对账规则（靠全局 seq 不变而免疫）、
   `novel_application` 编排、TOC 投影结构（已就绪）。
4. **Consumer**：阅读模式目录（`ReadingMode.tsx`）与结构面板大纲 tab
   （`StructurePanel.tsx`）——两处今天都在 flatMap 扔掉分组，是真实且已存在的消费者。
5. **Proof**：①seq 全局唯一性单测（含多卷场景，今天就能写，先于多卷落地）；
   ②parser 卷分组单测（含无卷退化）；③物化多卷单测；④真实 Tauri 场景——
   作者要求分卷规划 → 采纳 → 阅读目录按卷分层可见。
6. **Acceptance Driver**：并入既有 AU-08 阅读目录场景族（优先扩 `p1-chapter-plan-minimum`
   或 `p1-chapter-adoption-reading`，避免近重复新场景）。产品代码**不新增任何验收
   感知逻辑**——卷分组来自真实规划产出与真实采纳，driver 只按用户可见的卷标题断言。
7. **Exploration**：卷结构须同批进探索面。`exploration_service.ex:255` 已有骨架三行
   （目标体量/预计卷数/连载形态），本 slice 补「当前卷分布」使 AI 判断循环内可读到
   实际卷划分，而非只读到计划卷数（08 §8 探索面同步律）。

## 3. CP 路线

| CP | 内容 | 证明 |
|---|---|---|
| CP1 | **seq 口径收为 work 级全局**（`next_chapter_seq` 改按 work_id）+ 全局唯一性不变量测试。**零行为变化**（当前单卷下逐字节等价），但拆掉多卷必踩的静默乱序雷 | 单测：单卷等价 + 多卷不撞号；全量回归绿 |
| CP2 | 规划产出携带卷归属：plot_outline prompt 增卷槽位（只在 `planned_volumes > 1` 时要求）+ parser 识别卷边界 + 物化建多卷（`find_or_create_volume` 接受卷规格）；无卷信息退化单卷 | parser/物化单测含退化用例 |
| CP3 | 前端目录分层渲染（两处 flatMap 收口）+ 探索面卷分布 | 真实 Tauri 场景：分卷规划 → 采纳 → 目录按卷分层 |

**最小实现步不缩范围**：CP1 单独交付不算 slice done——它只拆雷不产卷。
完整闭环以 CP3 的真实页面验收为准。

## 4. 决策日志

- 2026-07-29 — 用户拍板 Order 8 刀候选顺序，卷结构列第 ①。开工时查出 `chapter.seq`
  卷内作用域与三处全局消费者的冲突，裁决收为全局 seq（理由见 §1）。
