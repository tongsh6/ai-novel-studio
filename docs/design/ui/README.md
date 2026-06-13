# UI Design Workspace

> 状态：计划入口
>
> 角色：集中承载当前 UI 设计文档、Pencil 原型、导出物和追溯材料。

---

## 1. 目录定位

本目录是当前唯一 UI 设计工作区。

它负责承载：

- `40`-`47` UI 设计文档
- `pencil` 原型 source file
- 原型导出图 / PDF
- UI 文档与原型之间的追溯说明

它不负责：

- 新增 Foundation / Domain contract
- 新增 intent、状态、card type、action type 或对象语义
- 替代 `../README.md`、`../07-workbench-ui-contract.md` 或当前 ADR / contract pack

如果 UI 设计发现新语义需求，必须回到 `../README.md` §6 的 ADR 流程。

---

## 2. 推荐目录结构

```text
docs/design/ui/
  README.md

  40-ui-overview.md
  41-workbench-layout.md
  42-card-system.md
  43-structure-panel.md
  44-reading-mode.md
  45-guided-conversation-flows.md
  46-state-and-feedback.md
  47-ui-copy-guidelines.md

  freeze-review.md

  novel-studio.pen

  exports/
    README.md
    png/
    pdf/

  traceability/
    README.md
    screen-to-doc-map.md
```

说明：

1. `40`-`47` 仍保留编号，表示它们属于 design 第三阶段 UI 文档。
2. `freeze-review.md` 记录冻结前评审状态、PNG 评审包和暂缓项。
3. `.pen` 文件与 UI 文档放在同一工作区，避免文档和原型分离。
4. `exports/` 只放从 `.pen` 导出的阅读产物，不作为 source of truth。
5. `traceability/` 用于记录 screen frame 与文档章节、ADR 来源的对应关系。

---

## 3. 文档写作顺序

按当前 UI 设计资料的依赖顺序执行：

```text
40-ui-overview
  -> 41-workbench-layout
  -> 42-card-system
  -> 43-structure-panel
  -> 44-reading-mode
  -> 45-guided-conversation-flows
  -> 46-state-and-feedback
  -> 47-ui-copy-guidelines
  -> novel-studio.pen
```

原则：

1. 文档先于原型。
2. 原型必须能回链到文档章节。
3. UI 文档只能投影当前 ADR、contract pack、Domain / Foundation 文档，不得新增运行语义。
4. 若某个画面需要未冻结语义，先暂停该画面并走 ADR，不在 UI 文档中临时命名。

---

## 4. Pencil 原型约定

source of truth：

```text
docs/design/ui/novel-studio.pen
```

最小画面集合：

1. 主工作台主视图
2. 长跑启动确认
3. checkpoint 暂停态
4. tentative adoption
5. 结构面板展开态
6. 阅读模式
7. 立项引导流
8. 新卷 / 新章工作流

顶层 screen frame 命名必须包含文档编号与章节号，例如：

```text
41§3-main-workbench
42§4-adoption-card-states
43§5-structure-panel-expanded
44§3-reading-mode-stale
45§2-work-seed-guided-flow
46§6-checkpoint-feedback
```

---

## 5. 追溯要求

每份 UI 文档必须包含：

1. `语义来源`
2. `不负责范围`
3. `不得反向驱动的边界`
4. `对应原型画面`

每个原型 screen 必须能追溯到：

1. UI 文档章节
2. ADR 或 Foundation / Domain 来源
3. 关键状态 / card / action 的 canonical 来源

---

## 6. 完成定义

本目录完成时必须满足：

1. `40`-`47` 全部存在。
2. `novel-studio.pen` 覆盖最小 8 个画面。
3. `traceability/screen-to-doc-map.md` 能列出每个 screen 的文档与 ADR 来源。
4. `exports/` 至少包含可阅读的静态导出图或 PDF。
5. 不存在“文档有状态，原型没体现”的断层。
6. 不存在“原型有交互，Foundation / Domain 没定义语义”的越界。
