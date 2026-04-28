# ADR-0004：Volume / Arc 关系

- 状态：Accepted
- 日期：2026-04-24（Accepted 于 2026-04-24，oracle 评审 ACCEPT）
- 涉及范围：Domain 子系统 20（Novel Domain Overview）/ 子系统 21（Novel Object Model）/ 子系统 27（Reading Projection）/ 子系统 28（Authoring Lifecycle）
- 相关文档：
  - `../20-novel-domain-overview.md` §7.1
  - `../21-novel-object-model.md` §6.1 / §6.4 / §10.2 / §16.1 / §21 / §24 / §25
  - `../24-novel-intent-catalog.md` §8 / §9 / §10
  - `../27-reading-projection.md` §5 / §8 / §11 / §12 / §14
  - `../28-authoring-lifecycle.md` §5 / §9 / §13 / §20
  - `../29-design-integrity-review.md` §5.3.1 / §7.1 / §8 / §10
  - `../34-novel-element-field-priority.md` §4.4 / §4.5 / §5 / §7 / §11
  - `../30-contract-glossary.md` §2.3 / §8.3
- 取代：无
- 取代者：无

---

## 背景

`21-novel-object-model.md` 已经把主链写成 `work -> worldbuilding -> main_outline -> volume / arc -> chapter -> scene -> draft`，并明确 `volume` 偏出版 / 连载分卷组织，`arc` 偏故事单元 / 剧情段 / 副本段。当前问题不是二者是否存在，而是二者之间的结构关系尚未冻结。

`21 §6.1` 使用 `volume / arc` 斜线表示法，是因为二者关系当时尚未冻结，而非断言二者为平级；本 ADR 正是要消除这个歧义。

这个关系会直接影响：

1. 结构面板的树形层级。
2. 阅读目录（TOC）的组织方式。
3. 规划阶段默认中层单位。
4. chapter / scene 的归属与排序。
5. W7 / W8 intent 与 slot schema 的读写范围。
6. W10 / W11 reading projection root / toc / refresh 的投影规则。

W6 的目标是冻结 `volume` 与 `arc` 的最小关系，使 UI 与后续 Domain schema 不再猜“卷”和“剧情单元”谁包含谁。

---

## 考虑过的方案

### 方案 A：`arc` 嵌套在 `volume` 内

结构：

```text
work
  -> volume
      -> arc
          -> chapter
              -> scene
```

优点：

- 顺应 reading projection 已依赖 accepted volume ordering 的现状。
- TOC 可保持 volume-first，符合网文连载和分卷阅读习惯。
- `arc` 仍作为卷内故事规划单元存在，不丢失剧情组织能力。
- structure panel 可用稳定单根层级：volume -> arc -> chapter -> scene。
- W7 / W8 slot schema 可先用 `volume_id` 确定边界，再用 `arc_id` 细分剧情段。

缺点：

- 跨卷 arc 不能作为默认结构；需要拆成多个卷内 arc 或用跨卷标签 / strategy artifact 另行表达。
- 对强 story-arc-first 的作品，规划时需要先建立或选择 volume 容器。

### 方案 B：`volume` 嵌套在 `arc` 内

结构：

```text
work
  -> arc
      -> volume
          -> chapter
              -> scene
```

优点：

- 更贴近故事推进逻辑。
- 对副本流、任务流、长剧情段很自然。

缺点：

- reading projection 当前明确依赖 accepted volume ordering；arc-first 会反向改写 TOC 语义。
- UI 目录会难以解释“一个 arc 下多个 volume”的阅读顺序。
- web serial 的分卷发布、卷名、卷级摘要会变成二级派生物。
- 与 `volume` 偏出版组织、`arc` 偏故事单元的既有定义不匹配。

### 方案 C：`volume` 与 `arc` 正交

结构：

```text
work
  -> volume -> chapter -> scene
  -> arc    -> chapter -> scene
```

优点：

- 最灵活，可表达跨卷 arc、多 arc 交织、运营分卷与故事线分离。
- 对复杂长篇作品理论上更完整。

缺点：

- 需要额外冻结 chapter 同时归属 volume 与 arc 的双索引规则。
- 需要排序冲突解决：TOC 按 volume 还是 arc？结构面板默认展开哪条轴？
- W6 的目标是解除 UI 前冻结阻塞，正交方案反而引入新的映射语义。
- W7 / W8 slot schema 会被迫同时处理两个上级维度，增加首批 intent 复杂度。

---

## 最终决策

选择 **方案 A：`arc` 嵌套在 `volume` 内**。

W6 冻结以下关系：

```text
work
  -> volume
      -> arc
          -> chapter
              -> scene
                  -> draft
```

注：上图展示默认 scene 级写作路径。章级草稿仍可直属 `chapter`（见 §决策内容 1），不强制所有 draft 都必须先落到 scene。

规则：

1. `volume` 是 canonical middle-structure parent。
2. `arc` 是 volume 内的 story-planning unit。
3. `chapter` 必须归属一个 `volume`。
4. `chapter` 默认归属一个 `arc`；允许在早期 planning 中暂时 `arc_id = null`，但进入可写章节 / scene 规划前必须归入某个 arc 或显式标记为 `arc_unassigned`。
5. `arc` 不得跨 `volume`。跨卷故事线通过 strategy artifact / motif / foreshadowing / tag 等非结构父子关系表达，不作为 W6 的结构层级。
6. reading projection TOC 使用 `volume_order` 作为一级排序，`chapter_order` 作为最终阅读顺序；`arc` 可作为卷内可选分组或结构面板分组，但不是 reading projection 的一级 TOC authority。
7. planning 默认中层单位为 `volume`，卷内细化时默认使用 `arc` 作为故事推进单元。

本 ADR 显式不冻结：

1. `volume` / `arc` 的完整字段 schema。
2. `volume` / `arc` 的最终 lifecycle enum。
3. reading projection root / toc / chapter 的完整 schema 与 refresh policy（W10 / W11）。
4. 首批 intent 与 slot schema（W7 / W8）。
5. structure panel 的 UI 布局、视觉层级、交互细节。
6. 跨卷主题线、人物线、伏笔线的完整建模方式。
7. chapter / scene 的完整字段优先级。

---

## 决策内容

### 1. 最小对象关系

| 对象 | 必填父级 | 可选父级 / 引用 | 说明 |
| --- | --- | --- | --- |
| `work` | 无 | 无 | 作品根 |
| `volume` | `work_id` | `main_outline_id` | 分卷 / 连载组织一级结构 |
| `arc` | `volume_id` | `strategy_artifact_refs[]` | 卷内故事推进单元 |
| `chapter` | `volume_id` | `arc_id` | 可写章节单元；进入 scene 规划前应有 `arc_id` 或显式 unassigned 标记 |
| `scene` | `chapter_id` | 无 | 默认 long-run 自然执行单元 |
| `draft` | `scene_id` 或 `chapter_id` | 无 | 文本草稿 |

### 2. 排序规则

1. `volume_order` 是 reading projection TOC 的一级排序来源。
2. `chapter_order` 是最终阅读顺序来源。
3. `arc_order` 只在 volume 内有效，用于结构面板与规划视图。
4. `arc_order` 不得覆盖 `chapter_order`；若二者冲突，reading projection 以 accepted `chapter_order` 为准。
5. 任何结构排序变更都必须经过 adoption 后才能进入 reading projection。

### 3. Planning 默认规则

1. 章以上规划默认先定位 `volume`。
2. 在一个 `volume` 内，默认使用 `arc` 组织剧情推进。
3. 若用户直接要求“写下一章”，系统可以从当前 active chapter / scene 推断 volume 与 arc；无法推断时必须 clarification。
4. 若用户要求跨卷故事线，应创建或更新 strategy artifact / motif / foreshadowing，不得让单个 `arc` 跨 volume。

### 4. Intent / slot 影响

W7 / W8 起草时应遵守：

1. volume-family intent 可写 `volume` 与其下 `arc`。
2. chapter-family intent 至少读取 `volume_id`；若已有 `arc_id`，必须读取对应 `arc`。
3. scene-family intent 不直接改写 `volume` / `arc`，但需要读取 chapter 所属 volume / arc 作为上下文。
4. 新建 chapter 的 slot 应优先包含 `volume_id`，并可包含 `arc_id`；若缺 `arc_id`，必须有 unassigned / clarification 策略。

### 5. Reading projection 影响

1. `reading_projection_toc` 以 accepted volume ordering 和 accepted chapter ordering 为主。
2. `arc` 可作为 TOC 中的卷内分组提示，但不得替代 volume 作为一级 projection source。
3. `arc` 变更本身不直接刷新阅读正文；只有当它影响 accepted chapter ordering、title、summary 或 projection source refs 时，才触发 projection refresh。
4. reading projection 不替代 `volume` / `arc` 源对象；结构变更仍走 adoption + refresh。

### 6. Structure panel 影响

默认结构树：

```text
Work
  Volumes
    Volume
      Arcs
        Arc
          Chapters
            Chapter
              Scenes
```

UI 可以提供跨卷视角（例如主题线 / 伏笔线 / 人物线），但这属于 secondary view，不改变 canonical parent-child relation。

### 7. 兼容与迁移规则

1. 若旧数据只有 volume、没有 arc，可为每个 volume 创建默认 arc（如 `default_arc`），或让 chapter 暂时标记 `arc_unassigned`。
2. 若旧数据只有 arc、没有 volume，必须先生成 volume 容器；不能把 arc 提升为 root middle layer。
3. 若旧数据中 arc 跨 volume，应拆分为多个 volume-local arc，并用 strategy artifact / motif / foreshadowing 记录跨卷连续性。
4. 迁移不得改变 accepted chapter order；任何顺序调整必须走 adoption。

---

## 决策原因

选择方案 A 的原因：

1. reading projection 已经明确依赖 accepted volume ordering；volume-first 可以最小化对 TOC 的影响。
2. `volume` 的定义偏出版 / 连载组织，天然适合作为 structure panel 与 reading mode 的一级中层。
3. `arc` 的定义偏故事推进，放在 volume 内更适合作为 planning unit，而不是 reading projection authority。
4. 正交方案虽然更灵活，但会把 W6 从一个关系决策扩大成双索引、排序冲突、投影冲突的复杂 schema 设计。
5. arc-first 会迫使阅读 TOC 从 story arc 反推 volume，违背当前 projection docs 中 volume ordering 的基础地位。
6. 跨卷故事线仍可通过 strategy artifact / motif / foreshadowing 表达，不必用 parent-child 关系承载所有语义。
7. 若未来用户频繁遭遇跨卷 arc 表达障碍，可增补 parallel arc index 或 cross-volume arc tag 作为 secondary view，但无需改动 canonical parent-child relation。

不选择方案 B，因为它会把 story arc 置于 publishing volume 之上，导致 TOC、分卷摘要和阅读模式都要从 arc 派生 volume。

不选择方案 C，因为它虽然表达力最强，但在 UI 前冻结阶段引入过多映射规则，不能快速解除 §29.7.1 第 6 项阻塞。

---

## 影响

### 对 Domain 的影响

- `volume` 成为 canonical middle-structure parent。
- `arc` 成为 volume-local planning unit。
- chapter / scene 的上下文组装必须能读取所属 volume 与 arc。
- 跨卷连续性不再通过跨卷 arc 表达，而通过 strategy / motif / foreshadowing / continuity 对象表达。

### 对 UI 的影响

- 结构面板默认树为 volume -> arc -> chapter -> scene。
- TOC 默认 volume-first。
- UI 可以提供 arc 视图，但 arc 视图是 secondary view，不是 canonical TOC authority。
- 新建章 / 场景引导时，若缺少 volume 或 arc，应分别触发 clarification 或使用 unassigned 策略。

### 对 Reading Projection 的影响

- `reading_projection_toc` 继续以 accepted volume ordering + accepted chapter ordering 为核心。
- arc 可作为卷内分组 metadata，但不会替代 volume ordering。
- arc 变更只有在影响 accepted projection sources 时才触发 refresh。

### 对后续 ADR 的影响

- W7（首批 intent 最小集合）必须把 volume-family intent 放在 chapter-family 之前，且 chapter-family 读取 volume / arc。
- W8（intent slot schema）必须为 chapter creation / planning 设计 `volume_id` 与可选 `arc_id`。
- W10（reading projection 最小字段集）必须保留 volume-first TOC 语义。
- W11（projection refresh 状态与触发语义）必须区分 arc metadata 变更与 actual projection source 变更。

---

## 后续工作

### 必须更新的文档

1. `../29-design-integrity-review.md` §7.1
   - 将 Domain 第 6 项标注为已由 ADR-0004 冻结。
2. `../21-novel-object-model.md` §6.4 / §10.2 / §21 / §24 / §25
   - 将 `volume -> arc -> chapter -> scene` 标注为 canonical relation。
   - 移除 “volume 与 arc 关系未冻结” 的暂不冻结项。
3. `../27-reading-projection.md` §5 / §8 / §14
   - 标注 TOC 使用 volume-first，arc 仅作为卷内分组 metadata / secondary view。
4. `../28-authoring-lifecycle.md` §5 / §20
   - 标注 planning 默认先定位 volume，再在卷内使用 arc 组织剧情推进。
5. `../24-novel-intent-catalog.md` §8 / §9 / §10
   - 标注 volume-family 写 volume/arc，chapter-family 读取 volume/arc，scene-family 读取 chapter 所属上下文。
6. `../34-novel-element-field-priority.md` §4.4 / §5 / §7
   - 将 volume / arc 字段优先级与 adoption sensitivity 对齐本 ADR。
7. `0000-index.md`
   - 新增 ADR-0004 条目。
8. `../00-overview.md` §7
   - 新增 volume / arc 关系已冻结的决策索引。

### 必须补的契约测试

1. object relation 测试：`arc.volume_id` 必填；`chapter.volume_id` 必填；`scene.chapter_id` 必填。
2. chapter planning 测试：进入 scene planning 前，chapter 必须有 `arc_id` 或显式 `arc_unassigned` 标记。
3. cross-volume arc 测试：单个 `arc` 不得引用多个 `volume_id`。
4. reading projection 测试：TOC 一级来源必须是 accepted volume ordering。
5. chapter order 测试：`arc_order` 不得覆盖 accepted `chapter_order`。
6. migration 测试：跨卷 arc 必须拆分为 volume-local arcs，并保留跨卷 strategy / motif / foreshadowing 引用。
7. UI projection 测试：structure panel 默认树必须能按 volume -> arc -> chapter -> scene 渲染。

### 依赖 ADR

- ADR-0001（W1，TurnResult v2 顶层 schema）：本 ADR 的结构变更仍通过 adoption / projection refs 回到 TurnResult。
- ADR-0002（W2，state/status/next_action）：本 ADR 不新增状态枚举。
- ADR-0003（W5，authority/budget/escalation）：本 ADR 的结构变更仍受 authority / budget / escalation 门禁约束。
- W7 / W8 / W10 / W11 后续 ADR 必须消费本 ADR。

---

## 状态

当前状态为 Accepted。oracle 评审已确认：

1. volume-first 没有违反 `21` 与 `27` 的既有语义。
2. arc nested in volume 不会阻断跨卷故事线表达。
3. planning default unit 与 reading TOC authority 没有混用。
4. W7 / W8 / W10 / W11 的依赖边界清楚。
5. W6 没有吞并完整 object schema、projection schema 或 intent slot schema。

## enforced_by

- （pending — Domain layer 尚未实现 Volume / Arc 对象模型）
