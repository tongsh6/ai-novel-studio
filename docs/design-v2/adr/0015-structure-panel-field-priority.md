# ADR-0015：结构面板字段优先级与渐进披露

- 状态：Accepted (2026-04-25)
- 日期：2026-04-25
- 涉及范围：Domain 子系统 34（Novel Element Field Priority）/ UI 阶段 43 / Pencil 原型结构面板
- 相关文档：
  - `../34-novel-element-field-priority.md` §3 / §5 / §6 / §7 / §11 / §12
  - `../29-design-integrity-review.md` §7.1 第 15 条
  - `../39-ui-design-implementation-plan.md` §4.2
  - `0004-volume-arc-relation.md`
  - `0012-quality-finding-ui-projection.md`
  - `0013-approval-policy-record-ui-projection.md`
  - `0014-experience-ui-context-boundary.md`
- 取代：无
- 取代者：无

---

## 背景

`29-design-integrity-review.md` §7.1 第 15 条将“首批结构面板对象的字段优先级与渐进披露规则”列为 UI 前 Blocking 项。

`34-novel-element-field-priority.md` 已说明小说要素清单不是一次性表单，并给出必须结构化、半结构化、文档层三类落位。但在本 ADR 之前，UI 仍可能把结构面板画成巨型后台管理表单，或自造对象字段和编辑入口。

本 ADR 冻结首批结构面板对象、字段优先级和渐进披露边界，使 `43-structure-panel.md` 与 `.pen` 原型有稳定输入。

---

## 考虑过的方案

### 方案 A：UI 阶段自行决定结构面板字段

优点：视觉设计自由度最大。

缺点：违反 UI 不反向发明 schema 的纪律，且容易把 Domain object 与 document memory 混写。

### 方案 B：冻结首批对象 + 三层优先级 + 渐进披露规则，不冻结完整字段 schema

优点：解除 UI 前阻塞，同时避免过早把所有小说要素变成数据库字段。

缺点：后续仍需为必须结构化对象补完整 schema。

### 方案 C：冻结所有对象完整字段 schema

优点：结构面板实现最确定。

缺点：过早绑定领域模型，超出 UI 前冻结包范围。

---

## 最终决策

选择 **方案 B：冻结首批对象 + 三层优先级 + 渐进披露规则，不冻结完整字段 schema**。

本 ADR 冻结：

1. 小说要素三层优先级。
2. 首批结构面板对象集合。
3. 首批对象的默认展示层级。
4. 渐进披露规则。
5. UI 不得自造 schema / 子类型 / 编辑表单的边界。

本 ADR 显式不冻结：

1. 每个对象的完整数据库字段 schema。
2. 半结构化 strategy artifact 类型全集。
3. document memory 的 source metadata 与 retrieval policy。
4. UI 视觉布局、图标、拖拽细节和具体文案。

---

## 决策内容

### 1. 三层优先级

小说要素清单分三层：

| 优先级 | 含义 | 默认处理 |
| --- | --- | --- |
| 必须结构化 | 后续生成、一致性、adoption、revision、long-run resume 或 reading projection 依赖的对象 | 进入 Domain object / continuity object / style object，受 revision 与 adoption 约束 |
| 建议半结构化 | 需要被检索和复用、影响 prompt / validator / quality gate，但不适合立即拆成强 schema | 进入 strategy artifact / semi-structured artifact / document memory 引用 |
| 暂留文档层 | 自由度高、变化频繁、主要供作者思考 | 进入 document memory，不默认成为 authoritative constraint |

结构面板可以展示三层，但不得把三层都渲染为同等可编辑的 canon 字段。

### 2. 首批结构面板对象集合

首批结构面板至少覆盖以下对象族：

#### 2.1 Work / planning

- `work`
- `main_outline`
- `volume`
- `arc`
- `chapter`
- `scene`

#### 2.2 Assets

- `character`
- `location`
- `faction`
- `organization`
- `relationship`
- `item`
- `ability`

#### 2.3 Continuity

- `state_snapshot`
- `timeline_event`
- `foreshadowing`
- `worldrule`
- `chapter_summary`

#### 2.4 Style / author intent

- `style_sample`
- `writing_preferences`
- `brief`
- `feedback_patch`

#### 2.5 Runtime / review support

- `quality_finding`
- `approval_record`
- `experience_rule`
- pending maintenance artifacts

### 3. 默认展示层级

结构面板采用渐进披露，不是巨型表单。

| 层级 | 默认展示 | 说明 |
| --- | --- | --- |
| L1 概览 | work、当前 volume / chapter、long-run / risk 摘要、pending adoption 数量 | 默认可见或一键展开 |
| L2 列表 | volumes、chapters、characters、foreshadowings、worldrules、quality findings | 折叠列表，按当前上下文优先排序 |
| L3 详情 | 单对象字段、source refs、revision、adoption status、related findings | 点击对象后展示 |
| L4 审计 / 来源 | source_revision_refs、approval records、experience evidence、trace refs | 默认隐藏，仅在解释 / debug / review 时显示 |

### 4. 阶段化展示规则

| 创作阶段 | 默认重点 |
| --- | --- |
| 建立期 | `work` / positioning / protagonist / main conflict |
| 规划期 | `volume` / `arc` / `chapter` / `foreshadowing` |
| 产出期 | 当前 `chapter` / `scene` / `brief` / continuity warnings |
| 维护期 | pending maintenance artifacts / `quality_finding` / adoption review |
| 阅读与修订期 | accepted reading projection refs / stale status / revision impact |

### 5. 字段优先级规则

结构面板字段优先级按以下顺序判定：

1. 会影响后续生成的字段优先展示。
2. 会参与一致性检查的字段优先展示。
3. 会改变 canon、需要 adoption / approval / revision 的字段必须显示状态和来源。
4. 只是表达倾向的字段默认半结构化展示。
5. 只是探索材料的字段默认放入 document memory，不进入结构面板主层。

### 6. UI 不得自造的内容

UI 阶段不得：

1. 新增 Domain object type。
2. 新增 canonical 字段语义。
3. 把 document memory 当作 authoritative state。
4. 把 tentative artifact 默认显示成 accepted object。
5. 绕过 adoption / approval 直接编辑 authoritative object。
6. 把 `arc` 提升为 reading projection TOC 一级 authority；一级来源仍是 `volume`（ADR-0004）。
7. 把 `quality_finding` / `approval_record` / `experience_rule` 混成普通文本 note。

### 7. 可安全 deferred 的内容

以下内容不阻塞 `43-structure-panel.md` 和 `.pen` 原型：

1. 每个对象完整字段全集。
2. 资产对象更细粒度子类型。
3. strategy artifact 类型全集。
4. document memory retrieval UI。
5. 拖拽排序、批量编辑、快捷键等高级交互。

---

## 影响

### 对 Domain 的影响

1. `34-novel-element-field-priority.md` 的字段优先级硬骨升级为 ADR 冻结 contract。
2. 首批结构面板对象可作为 UI 文档和原型的稳定输入。

### 对 UI 的影响

1. `43-structure-panel.md` 可以开始设计完整结构面板。
2. `.pen` 原型不得自造字段、子类型或编辑表单。
3. 结构面板默认折叠，不得压倒对话主入口。

### 对 Foundation 的影响

无新增 Foundation runtime 语义。

---

## 回写目标

本 ADR Accepted 后需回写：

1. `adr/0000-index.md` §2.1 / §5：新增 ADR-0015。
2. `00-overview.md` §7：新增 D2 条目。
3. `29-design-integrity-review.md` §7.1 第 15 条：标记已冻结。
4. `30-contract-glossary.md` §10：追加本 ADR 硬骨。
5. `34-novel-element-field-priority.md`：标注结构面板字段优先级与渐进披露已由本 ADR 冻结。
6. `39-ui-design-implementation-plan.md` §4：移入已冻结输入。

---

## 后续工作

1. 在 `43-structure-panel.md` 中把本 ADR 映射为具体信息架构。
2. 在 `.pen` 原型中体现 L1-L4 渐进披露。
3. 后续为必须结构化对象补完整字段 schema。

## enforced_by

- （pending — structure panel 尚未实现，属于 UI 层）
